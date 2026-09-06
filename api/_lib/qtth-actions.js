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
    const e = new Error('Bạn không có quyền quản lý phân quyền QTTH.');
    e.statusCode = 403; e.code = 'QTTH_MANAGE_DENIED';
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

async function dispatchQtthAction(session, payload) {
  const action = String((payload && payload.action) || '').trim();

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
]);

module.exports = { dispatchQtthAction, QTTH_ACTION_MANIFEST };
