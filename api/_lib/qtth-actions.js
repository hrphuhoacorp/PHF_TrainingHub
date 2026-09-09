'use strict';

// PHF HR — QUẢN TRỊ TỔNG HỢP (QTTH) V1 · Batch 01 action dispatcher.
//
// Shared by BOTH api/data.js (Vercel) and server.js (local :3000):
//   const qtthDispatch = await dispatchQtthAction(session, payload);
//   if (qtthDispatch.handled) return <sendJson>(res, 200, {ok:true, result: qtthDispatch.result});
//
// Every handler here:
//   1. resolves the VERIFIED actor from the PHF HR session via qtth-identity.js
//      (People Master, Supabase MAIN — client can NEVER supply actor / role),
//   2. picks an EXPLICIT whitelist of fields off the client payload (never
//      `...payload`),
//   3. calls the phf-hr-api action via qtth-bridge.js.
//
// The ROSTER + a few writes are COMPOSITE: the People Master roster + the live
// employee department come from Supabase MAIN, the QTTH-owned rows from
// Company PostgreSQL (phf-hr-api). This layer is the only place already
// reading both. Business authorization is server-authoritative inside
// phf-hr-api (system Admin OR active qtth.permission_manager_grant), never
// re-implemented here — we call qtth.bootstrap first so a caller without
// authority fails closed (403) before any People Master read runs.

const { resolveQtthActor } = require('./qtth-identity');
const { callQtthAction } = require('./qtth-bridge');
const { loadOrgRows } = require('./task-employee-scope');

function str(v) { return v == null ? undefined : String(v); }
function code(v) { const s = v == null ? '' : String(v).trim().toUpperCase(); return s || undefined; }
function bool(v) { return v === true || v === 'true'; }

const INACTIVE_TOKENS = ['inactive', 'terminated', 'nghỉ', 'nghi viec', 'nghỉ việc', 'đã nghỉ'];
function isActiveStatus(status) {
  const s = String(status || 'active').toLowerCase();
  return !INACTIVE_TOKENS.some((t) => s.includes(t));
}

// Current management period = current month in ICT (UTC+7), YYYY-MM.
function currentPeriod() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  const m = d.getUTCMonth() + 1;
  return d.getUTCFullYear() + '-' + (m < 10 ? '0' + m : '' + m);
}
function normPeriod(v) {
  const s = String(v || '').trim();
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(s) ? s : currentPeriod();
}

async function ensureManageAuthority(actor) {
  const boot = await callQtthAction('qtth.bootstrap', actor, {});
  if (!boot || !boot.capabilities || boot.capabilities.canManagePermissions !== true) {
    const e = new Error(
      boot && boot.devLocked
        ? (boot.lockReason || 'QTTH đang trong giai đoạn phát triển — bạn chưa được cấp quyền truy cập.')
        : 'Bạn không có quyền quản lý phân quyền QTTH.'
    );
    e.statusCode = 403;
    e.code = boot && boot.devLocked ? 'QTTH_DEV_LOCKED' : 'QTTH_MANAGE_DENIED';
    throw e;
  }
  return boot;
}

// ---- composite: the Phân quyền roster --------------------------------------
async function listRoster(session, rawPeriod) {
  const actor = await resolveQtthActor(session);
  const period = normPeriod(rawPeriod);
  await ensureManageAuthority(actor);

  const [orgRows, perm, dict, cls] = await Promise.all([
    loadOrgRows(),
    callQtthAction('qtth.permissions.list', actor, {}),
    callQtthAction('qtth.dict.list', actor, {}),
    callQtthAction('qtth.classification.list', actor, { period }),
  ]);

  const permByCode = new Map((perm.permissions || []).map((p) => [p.employeeCode, p]));
  const mgrByCode = new Map((perm.permissionManagers || []).map((m) => [m.employeeCode, m]));
  const clsByCode = new Map((cls.rows || []).map((r) => [r.employeeCode, r]));

  let newNoPermission = 0;
  let incompleteClassification = 0;
  let sourceDepartmentChanged = 0;

  const roster = orgRows.map((r) => {
    const active = isActiveStatus(r.status);
    const p = permByCode.get(r.employeeCode) || null;
    const c = clsByCode.get(r.employeeCode) || null;
    const canViewQtth = !!(p && p.canViewQtth);
    const canViewOperations = !!(p && p.canViewOperations);
    const unitId = c ? c.unitId || null : null;
    const groupId = c ? c.groupId || null : null;
    const staffKind = c ? c.staffKind || null : null;
    const deptChanged = !!(c && c.sourceDepartmentSnapshot && c.sourceDepartmentSnapshot !== (r.department || ''));

    if (active && !p && !canViewQtth && !canViewOperations) newNoPermission++;
    if (active && (!unitId || !groupId || !staffKind)) incompleteClassification++;
    if (active && deptChanged) sourceDepartmentChanged++;

    return {
      employeeCode: r.employeeCode,
      fullName: r.fullName,
      status: active ? 'active' : 'inactive',
      sourceDepartment: r.department || '',
      unitId, groupId, staffKind,
      sourceDepartmentSnapshot: c ? c.sourceDepartmentSnapshot || '' : '',
      sourceDepartmentChanged: deptChanged,
      canViewQtth, canViewOperations,
      isPermissionManager: !!(mgrByCode.get(r.employeeCode) && mgrByCode.get(r.employeeCode).isActive),
      classificationUpdatedByName: c ? c.updatedByName || '' : '',
      permissionUpdatedByName: p ? p.updatedByName || '' : '',
    };
  });

  return {
    period,
    units: dict.units || [],
    groups: dict.groups || [],
    roster,
    permissionManagers: perm.permissionManagers || [],
    warnings: {
      newNoPermission,
      incompleteClassification,
      sourceDepartmentChanged,
    },
  };
}

async function setClassification(session, payload) {
  const actor = await resolveQtthActor(session);
  await ensureManageAuthority(actor);
  const employeeCode = code(payload && payload.employee_code);
  const period = normPeriod(payload && payload.period);
  // sourceDepartment is picked from People Master server-side, never the client.
  let sourceDepartment;
  if (employeeCode) {
    const rows = await loadOrgRows();
    const rec = rows.find((r) => r.employeeCode === employeeCode);
    if (rec) sourceDepartment = rec.department || '';
  }
  const params = { employeeCode, period, sourceDepartment };
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'unit_id')) params.unitId = str(payload.unit_id) || '';
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'group_id')) params.groupId = str(payload.group_id) || '';
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'staff_kind')) params.staffKind = str(payload.staff_kind) || '';
  return callQtthAction('qtth.classification.set', actor, params);
}

async function bulkSetClassification(session, payload) {
  const actor = await resolveQtthActor(session);
  await ensureManageAuthority(actor);
  const period = normPeriod(payload && payload.period);
  const codes = Array.isArray(payload && payload.employee_codes)
    ? payload.employee_codes.map(code).filter(Boolean) : [];
  return callQtthAction('qtth.classification.bulkSet', actor, {
    period,
    field: str(payload && payload.field),
    value: str(payload && payload.value) || '',
    employeeCodes: codes,
  });
}

async function inheritMonth(session, payload) {
  const actor = await resolveQtthActor(session);
  await ensureManageAuthority(actor);
  const orgRows = await loadOrgRows();
  const activeEmployeeCodes = orgRows.filter((r) => isActiveStatus(r.status)).map((r) => r.employeeCode);
  return callQtthAction('qtth.classification.inheritMonth', actor, {
    fromPeriod: normPeriod(payload && payload.from_period),
    toPeriod: normPeriod(payload && payload.to_period),
    activeEmployeeCodes,
  });
}

// action -> { remote, params(payload) } — straight passthroughs only.
const ACTION_MAP = {
  qtthBootstrap: { remote: 'qtth.bootstrap', params: () => ({}) },
  qtthListDictionaries: { remote: 'qtth.dict.list', params: () => ({}) },
  qtthUpsertDictionary: {
    remote: 'qtth.dict.upsert',
    params: (p) => ({
      kind: str(p.kind), id: str(p.id), name: str(p.name),
      sortOrder: p.sort_order == null || p.sort_order === '' ? undefined : Number(p.sort_order),
      isActive: Object.prototype.hasOwnProperty.call(p, 'is_active') ? bool(p.is_active) : undefined,
    }),
  },
  qtthSetPermission: {
    remote: 'qtth.permissions.set',
    params: (p) => ({ employeeCode: code(p.employee_code), field: str(p.field), value: bool(p.value) }),
  },
  qtthSetPermissionManager: {
    remote: 'qtth.permissionManager.set',
    params: (p) => ({ employeeCode: code(p.employee_code), isActive: bool(p.is_active) }),
  },
  qtthPermissionHistory: {
    remote: 'qtth.history.permission',
    params: (p) => ({ employeeCode: code(p.employee_code) }),
  },
  qtthClassificationHistory: {
    remote: 'qtth.history.classification',
    params: (p) => ({ employeeCode: code(p.employee_code), period: str(p.period) }),
  },
};

const INACTIVE_TOKENS2 = INACTIVE_TOKENS;
// QTTH Truth Data · Bảng lương (Batch 02). Payroll import runs through the same
// verified-actor + phf-hr-api bridge. validatePreview also supplies the active
// People Master employee codes so the importer can flag unknown codes without
// this layer re-implementing identity.
const PAYROLL_ACTION_MAP = {
  qtthPayrollStatus: (p) => ({ remote: 'payroll.status', params: { periodMonth: str(p.period_month || p.period) } }),
  qtthPayrollValidatePreview: (p) => ({ remote: 'payroll.validatePreview', params: {
    periodMonth: str(p.period_month || p.period), fileName: str(p.file_name), fileBase64: str(p.file_base64),
  }, withKnownCodes: true }),
  qtthPayrollConfirm: (p) => ({ remote: 'payroll.confirm', params: { fileId: str(p.file_id) } }),
  qtthPayrollListNormalized: (p) => ({ remote: 'payroll.listNormalized', params: { periodMonth: str(p.period_month || p.period) } }),
  qtthPayrollEmployeeDetail: (p) => ({ remote: 'payroll.employeeDetail', params: { periodMonth: str(p.period_month || p.period), employeeCode: code(p.employee_code) } }),
  qtthPayrollCostTruth: (p) => ({ remote: 'payroll.costTruth', params: {
    periodMonth: str(p.period_month || p.period),
    version: (p.version === 0 || p.version) ? Number(p.version) : undefined,
  } }),
};

async function dispatchPayroll(session, payload, action) {
  const actor = await resolveQtthActor(session);
  await ensureManageAuthority(actor);
  const build = PAYROLL_ACTION_MAP[action](payload || {});
  const params = build.params;
  if (build.withKnownCodes) {
    const rows = await loadOrgRows();
    params.knownEmployeeCodes = rows.filter((r) => !INACTIVE_TOKENS2.some((t) => String(r.status || '').toLowerCase().includes(t)))
      .map((r) => r.employeeCode);
    // also pass ALL codes (active + inactive) so a payroll row for a since-left
    // employee is still "known" — payroll is historical.
    params.knownEmployeeCodes = Array.from(new Set(params.knownEmployeeCodes.concat(rows.map((r) => r.employeeCode))));
  }
  return callQtthAction(build.remote, actor, params);
}

// QTTH Truth Data · Dữ liệu chi phí kế toán (Accounting Data V1). Small JSON
// actions only — the FAST source upload (~5.5MB base64) goes through the
// dedicated binary endpoint api/qtth-accounting-upload.js, NOT /api/data.
const ACCOUNTING_ACTION_MAP = {
  qtthAccountingStatus: (p) => ({ remote: 'accounting.status', params: { periodMonth: str(p.period_month || p.period) } }),
  qtthAccountingPreview: (p) => ({ remote: 'accounting.preview', params: {
    fileId: str(p.file_id), periodMonth: str(p.period_month || p.period),
    version: (p.version === 0 || p.version) ? Number(p.version) : undefined } }),
  qtthAccountingConfirm: (p) => ({ remote: 'accounting.confirm', params: { fileId: str(p.file_id) } }),
  qtthAccountingListNormalized: (p) => ({ remote: 'accounting.listNormalized', params: {
    periodMonth: str(p.period_month || p.period), classification: str(p.classification), account: str(p.account) } }),
  qtthAccountingListRules: () => ({ remote: 'accounting.listRules', params: {} }),
  qtthAccountingDictionaryStatus: () => ({ remote: 'accounting.dictionaryStatus', params: {} }),
  qtthAccountingImportDictionary: (p) => ({ remote: 'accounting.importDictionary', params: {
    fileName: str(p.file_name), fileBase64: str(p.file_base64) } }),
  qtthAccountingListCategories: (p) => ({ remote: 'accounting.listCategories', params: { account: str(p.account) } }),
  qtthAccountingDecideItem: (p) => ({ remote: 'accounting.decideItem', params: {
    fileId: str(p.file_id),
    sourceRowIndexes: Array.isArray(p.source_row_indexes) ? p.source_row_indexes.map(Number).filter(Number.isFinite)
      : (p.source_row_index != null && p.source_row_index !== '' ? [Number(p.source_row_index)] : []),
    decision: str(p.decision),
    costCode: str(p.cost_code), costCodeName: str(p.cost_code_name),
    note: str(p.note),
    remember: p.remember === true || p.remember === 'true',
    matchText: str(p.match_text),
  } }),
  qtthAccountingListRememberedRules: () => ({ remote: 'accounting.listRememberedRules', params: {} }),
  qtthAccountingRuleHistory: (p) => ({ remote: 'accounting.ruleHistory', params: { ruleId: str(p.rule_id) } }),
  qtthAccountingSetRuleActive: (p) => ({ remote: 'accounting.setRuleActive', params: {
    ruleId: str(p.rule_id), isActive: p.is_active === true || p.is_active === 'true', reason: str(p.reason) } }),
};

async function dispatchAccounting(session, payload, action) {
  const actor = await resolveQtthActor(session);
  await ensureManageAuthority(actor);
  const build = ACCOUNTING_ACTION_MAP[action](payload || {});
  return callQtthAction(build.remote, actor, build.params);
}

async function dispatchQtthAction(session, payload) {
  const action = String((payload && payload.action) || '').trim();

  if (PAYROLL_ACTION_MAP[action]) {
    return { handled: true, result: await dispatchPayroll(session, payload || {}, action) };
  }
  if (ACCOUNTING_ACTION_MAP[action]) {
    return { handled: true, result: await dispatchAccounting(session, payload || {}, action) };
  }

  if (action === 'qtthListRoster') {
    return { handled: true, result: await listRoster(session, payload && payload.period) };
  }
  if (action === 'qtthSetClassification') {
    return { handled: true, result: await setClassification(session, payload || {}) };
  }
  if (action === 'qtthBulkSetClassification') {
    return { handled: true, result: await bulkSetClassification(session, payload || {}) };
  }
  if (action === 'qtthInheritMonth') {
    return { handled: true, result: await inheritMonth(session, payload || {}) };
  }

  const entry = ACTION_MAP[action];
  if (!entry) return { handled: false };

  const actor = await resolveQtthActor(session);
  const result = await callQtthAction(entry.remote, actor, entry.params(payload || {}));
  return { handled: true, result };
}

const QTTH_ACTION_MANIFEST = Object.freeze([
  'qtthBootstrap', 'qtthListRoster', 'qtthListDictionaries', 'qtthUpsertDictionary',
  'qtthSetPermission', 'qtthSetPermissionManager',
  'qtthSetClassification', 'qtthBulkSetClassification', 'qtthInheritMonth',
  'qtthPermissionHistory', 'qtthClassificationHistory',
  'qtthPayrollStatus', 'qtthPayrollValidatePreview', 'qtthPayrollConfirm',
  'qtthPayrollListNormalized', 'qtthPayrollEmployeeDetail', 'qtthPayrollCostTruth',
  'qtthAccountingStatus', 'qtthAccountingPreview', 'qtthAccountingConfirm',
  'qtthAccountingListNormalized', 'qtthAccountingListRules',
  'qtthAccountingDictionaryStatus', 'qtthAccountingImportDictionary',
  'qtthAccountingListCategories', 'qtthAccountingDecideItem',
  'qtthAccountingListRememberedRules', 'qtthAccountingRuleHistory', 'qtthAccountingSetRuleActive',
]);

// The dedicated binary upload endpoint (api/qtth-accounting-upload.js) needs the
// same verified-actor + manage-authority + bridge path without going through
// /api/data. Exported for that endpoint only.
async function accountingUploadPreviewViaBridge(session, { periodMonth, fileName, buffer }) {
  const actor = await resolveQtthActor(session);
  await ensureManageAuthority(actor);
  return callQtthAction('accounting.uploadPreview', actor, {
    periodMonth: str(periodMonth),
    fileName: str(fileName),
    fileBase64: Buffer.isBuffer(buffer) ? buffer.toString('base64') : String(buffer || ''),
  });
}

module.exports = { dispatchQtthAction, QTTH_ACTION_MANIFEST, accountingUploadPreviewViaBridge };
