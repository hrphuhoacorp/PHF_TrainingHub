'use strict';

// PHF HR — QTTH Truth Data · Bảng lương · phf-hr-api service.
//
// XLSX -> Upload -> Validate -> Normalize -> (Mapping only if schema drift) ->
// Preview -> Xác nhận nhập dữ liệu -> RAW + NORMALIZED + VERSION/DELTA/AUDIT.
//
// Company PostgreSQL phf_hr / schema payroll ONLY (dev/throwaway: phf_hr_e2e).
// Every DB call via the Task runtime-identity helpers (SET LOCAL ROLE phf_hr_app).
// No payroll calculation, no analytics — import + Truth Data only.
// Authorization decided upstream (qtth-service dev-lock + permission-manager);
// this module trusts the verified actor across the service-token boundary.

const crypto = require('crypto');
const { withTaskReadTransaction, withTaskWriteTransaction } = require('./db');
const { readWorkbook } = require('./xlsx-lite');
const TPL = require('./qtth-payroll-template');
const { normalizeGrid, diffVersions } = require('./qtth-payroll-normalize');
const storage = require('./qtth-payroll-storage');

class PayrollError extends Error {
  constructor(code, message, statusCode) { super(message || code); this.code = code; this.statusCode = statusCode || 400; this.isPayrollError = true; }
}
function pErr(code, message, statusCode) { return new PayrollError(code, message, statusCode); }
function mapPg(e) {
  const c = String((e && e.code) || '');
  if (c === '23505') return pErr('PAYROLL_DUPLICATE', 'Bản ghi trùng.', 409);
  if (c === '42P01' || c === '3F000') return pErr('PAYROLL_SCHEMA_MISSING', 'Schema payroll chưa được cài đặt (migrations/phf_hr_qtth_payroll_v1.sql).', 503);
  if (c === '42501') return pErr('PAYROLL_PERMISSION_DENIED', 'Thiếu quyền CSDL payroll.', 500);
  return null;
}
async function readTx(config, fn) { try { return await withTaskReadTransaction(config, fn); } catch (e) { throw mapPg(e) || e; } }
async function writeTx(config, fn) { try { return await withTaskWriteTransaction(config, fn); } catch (e) { throw mapPg(e) || e; } }

function period(p) { const s = String(p || '').trim(); if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(s)) throw pErr('PAYROLL_PERIOD_INVALID', 'Kỳ lương phải theo YYYY-MM.', 400); return s; }
function actorCols(a) { return [String(a && a.accountId || '') || null, String(a && (a.displayName || a.employeeCode) || '') || null]; }

// mojibake guard: if a grid still looks double-encoded (many 'Ã'/'á»' sequences
// in the header area), fix it. Real .xlsx are clean UTF-8 — this is a no-op there.
function looksMojibake(rows) {
  const head = rows.slice(0, 12).map((r) => r.join(' ')).join(' ');
  return /Ã.|Ä.|á»|â€|Æ°/.test(head) && !/Ổ|Ầ|Ự|Ế/.test(head);
}
function demojibake(rows) {
  return rows.map((r) => r.map((c) => { try { return Buffer.from(String(c), 'latin1').toString('utf8'); } catch (_) { return c; } }));
}

// Parse an .xlsx buffer -> the first data sheet's dense grid.
function parseWorkbookBuffer(buffer) {
  const wb = readWorkbook(buffer);
  // payroll workbook: pick the sheet whose rows contain a "MÃ NV" header
  let sheet = wb.sheets.find((s) => s.rows.some((row) => row.some((c) => TPL.norm(c) === 'ma nv')));
  if (!sheet) sheet = wb.sheets[0];
  let rows = sheet.rows;
  if (looksMojibake(rows)) rows = demojibake(rows);
  return { sheetName: sheet.name, rows };
}

// ---- VALIDATE + PREVIEW ---------------------------------------------------
// Stores the file + raw + normalized rows as a NON-confirmed version, and
// returns the full report (template match, counts, unknown codes, dup codes,
// missing columns, schema drift, reconciliation warnings, version diff).
async function validatePreview(config, actor, params) {
  const pm = period(params && params.periodMonth);
  const fileName = String((params && params.fileName) || 'bang-luong.xlsx').slice(0, 200);
  const b64 = String((params && params.fileBase64) || '');
  if (!b64) throw pErr('PAYROLL_FILE_REQUIRED', 'Chưa có file để kiểm tra.', 400);
  let buffer;
  try { buffer = Buffer.from(b64, 'base64'); } catch (_) { throw pErr('PAYROLL_FILE_BASE64', 'Nội dung file không hợp lệ.', 400); }
  if (buffer.length < 4 || buffer.readUInt16LE(0) !== 0x4b50) throw pErr('PAYROLL_NOT_XLSX', 'File không phải .xlsx hợp lệ.', 400);
  const knownCodes = new Set((Array.isArray(params && params.knownEmployeeCodes) ? params.knownEmployeeCodes : []).map((c) => String(c).toUpperCase()));

  let grid;
  try { grid = parseWorkbookBuffer(buffer); }
  catch (e) { throw pErr(e.code || 'PAYROLL_PARSE_FAILED', e.message || 'Không đọc được file .xlsx.', 400); }

  const fp = TPL.fingerprint(grid.rows);
  if (!fp.columnMap) throw pErr('PAYROLL_HEADER_NOT_FOUND', 'Không tìm thấy hàng tiêu đề bảng lương (MÃ NV / các cột (1)…(9)).', 400);

  const nm = normalizeGrid(grid.rows, fp.columnMap);
  if (!nm.ok) throw pErr('PAYROLL_NORMALIZE_FAILED', 'Không chuẩn hóa được dữ liệu.', 400);

  // schema drift vs the canonical template (T7)
  const canonical = await readTx(config, (c) => c.query("SELECT fingerprint, column_map FROM payroll.template WHERE is_canonical = true LIMIT 1"));
  const canonMap = canonical.rows[0] ? canonical.rows[0].column_map : null;
  const drift = canonMap ? diffColumnMaps(canonMap, fp.columnMap) : null;
  const templateMatched = canonMap ? (canonical.rows[0].fingerprint === fp.fingerprint) : false;

  // unknown / duplicate employee codes
  const unknownCodes = knownCodes.size
    ? nm.records.filter((r) => !knownCodes.has(r.employeeCode)).map((r) => r.employeeCode)
    : [];
  const dupInFile = nm.fileWarnings.filter((w) => w.type === 'DUPLICATE_EMPLOYEE_IN_FILE');

  // version diff vs current active version of this period
  const prev = await loadActiveNormalized(config, pm);
  const vdiff = prev ? diffVersions(prev.records, nm.records) : { deltas: [], missing: [], added: nm.records.map((r) => r.employeeCode) };

  const sha = crypto.createHash('sha256').update(buffer).digest('hex');

  const report = {
    periodMonth: pm, fileName, sha256: sha, byteSize: buffer.length, sheetName: grid.sheetName,
    templateMatched, templateFingerprint: fp.fingerprint,
    schemaDrift: drift && (drift.added.length || drift.removed.length || drift.moved.length) ? drift : null,
    missingColumns: fp.missingCore || [],
    totals: {
      rows: nm.rowCount,
      matchedEmployeeCodes: nm.rowCount - unknownCodes.length,
      unknownEmployeeCodes: unknownCodes,
      duplicateInFile: dupInFile,
      reconciliationWarnings: nm.reconciliationWarningCount,
    },
    reconciliationWarnings: nm.records.filter((r) => r.reconciliation.length)
      .map((r) => ({ employeeCode: r.employeeCode, checks: r.reconciliation })),
    versionDiff: {
      isFirstVersion: !prev,
      previousVersion: prev ? prev.version : null,
      added: vdiff.added,
      changed: dedupeChanged(vdiff.deltas),
      unchanged: prev ? nm.records.filter((r) => !vdiff.added.includes(r.employeeCode) && !vdiff.deltas.some((d) => d.employeeCode === r.employeeCode && d.changeType === 'changed')).map((r) => r.employeeCode) : [],
      missingFromNewVersion: vdiff.missing,
    },
  };

  // persist as a NON-confirmed version (so Preview shows real rows, Confirm just flips status)
  const [aid, aname] = actorCols(actor);
  const persisted = await writeTx(config, async (c) => {
    let imp = (await c.query("SELECT * FROM payroll.import WHERE period_month = $1", [pm])).rows[0];
    if (!imp) imp = (await c.query(
      "INSERT INTO payroll.import (period_month, created_by_account_id, created_by_name) VALUES ($1,$2,$3) RETURNING *", [pm, aid, aname])).rows[0];

    const existing = (await c.query(
      "SELECT * FROM payroll.import_file WHERE import_id = $1 AND sha256 = $2", [imp.id, sha])).rows[0];
    if (existing) {
      await c.query("UPDATE payroll.import_file SET validation = $2, row_count = $3, warning_count = $4, template_fingerprint = $5, template_matched = $6, uploaded_at = now() WHERE id = $1",
        [existing.id, report, nm.rowCount, report.totals.unknownEmployeeCodes.length + report.totals.reconciliationWarnings + report.versionDiff.missingFromNewVersion.length, fp.fingerprint, templateMatched]);
      return { fileId: existing.id, version: existing.version, replayed: true, importId: imp.id };
    }
    const nextVer = ((await c.query("SELECT COALESCE(MAX(version),0) v FROM payroll.import_file WHERE import_id = $1", [imp.id])).rows[0].v) + 1;
    const st = await storage.store(config.PHF_HR_ATTACHMENT_ROOT, { period: pm, version: nextVer, fileName, buffer });
    const file = (await c.query(
      `INSERT INTO payroll.import_file
        (import_id, version, file_name, sha256, byte_size, storage_ref, template_fingerprint, template_matched, status, row_count, warning_count, validation, uploaded_by_account_id, uploaded_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'previewed',$9,$10,$11,$12,$13) RETURNING id, version`,
      [imp.id, nextVer, fileName, st.sha256, st.byteSize, st.storageRef, fp.fingerprint, templateMatched, nm.rowCount,
       report.totals.unknownEmployeeCodes.length + report.totals.reconciliationWarnings + report.versionDiff.missingFromNewVersion.length, report, aid, aname])).rows[0];

    for (const rec of nm.records) {
      await c.query("INSERT INTO payroll.raw_row (file_id, source_row_index, employee_code, cells) VALUES ($1,$2,$3,$4)",
        [file.id, rec.sourceRowIndex, rec.employeeCode, rec.rawCells]);
      const f = rec.fields;
      await c.query(
        `INSERT INTO payroll.normalized
          (file_id, employee_code, period_month, full_name_source, source_branch, salary_grade, people_master_matched,
           base_salary_bhxh, job_allowance, base_standard_total_1, std_income_total_1to9, worked_salary_total_1,
           allowance_actual_total_2, bonus_total_3, grand_total_4, internal_deduct_total_5, income_after_internal_5,
           statutory_deduct_total_6, income_after_deduct_6, tax_taxable_income, tax_assessable_income, tax_dependents,
           tax_pit_amount, final_net_after_tax, t13_revenue_bonus, reconcile_adjust, source_detail, validation_status, validation_notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
        [file.id, rec.employeeCode, pm, rec.fullName, f.source_branch || null, f.salary_grade || null,
         knownCodes.size ? knownCodes.has(rec.employeeCode) : false,
         n(f.base_salary_bhxh), n(f.job_allowance), n(f.base_standard_total_1), n(f.std_income_total_1to9), n(f.worked_salary_total_1),
         n(f.allowance_actual_total_2), n(f.bonus_total_3), n(f.grand_total_4), n(f.internal_deduct_total_5), n(f.income_after_internal_5),
         n(f.statutory_deduct_total_6), n(f.income_after_deduct_6), n(f.tax_taxable_income), n(f.tax_assessable_income), n(f.tax_dependents),
         n(f.tax_pit_amount), n(f.final_net_after_tax), n(f.t13_revenue_bonus), n(f.reconcile_adjust),
         rec.sourceDetail, rec.reconciliation.length ? 'warn' : 'ok', rec.reconciliation]);
    }
    return { fileId: file.id, version: file.version, replayed: false, importId: imp.id, storageReplayed: st.replayed };
  });

  return Object.assign(report, { fileId: persisted.fileId, version: persisted.version, importId: persisted.importId, replayed: persisted.replayed });
}
function n(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

// ---- CONFIRM ------------------------------------------------------------
async function confirmImport(config, actor, params) {
  const fileId = String((params && params.fileId) || '');
  if (!fileId) throw pErr('PAYROLL_FILE_ID_REQUIRED', 'Thiếu fileId.', 400);
  const [aid] = actorCols(actor);
  return writeTx(config, async (c) => {
    const file = (await c.query("SELECT * FROM payroll.import_file WHERE id = $1 FOR UPDATE", [fileId])).rows[0];
    if (!file) throw pErr('PAYROLL_FILE_NOT_FOUND', 'Không tìm thấy phiên bản file.', 404);
    if (file.status === 'confirmed') return { fileId, version: file.version, alreadyConfirmed: true };
    const imp = (await c.query("SELECT * FROM payroll.import WHERE id = $1 FOR UPDATE", [file.import_id])).rows[0];

    const prevFile = (await c.query(
      "SELECT * FROM payroll.import_file WHERE import_id = $1 AND status = 'confirmed' ORDER BY version DESC LIMIT 1", [imp.id])).rows[0];

    // compute deltas prev-confirmed -> this
    const nextRows = (await c.query("SELECT * FROM payroll.normalized WHERE file_id = $1", [fileId])).rows;
    let deltas = [], missing = [], added = nextRows.map((r) => r.employee_code);
    if (prevFile) {
      const prevRows = (await c.query("SELECT * FROM payroll.normalized WHERE file_id = $1", [prevFile.id])).rows;
      const d = diffVersions(prevRows.map(toRec), nextRows.map(toRec));
      deltas = d.deltas; missing = d.missing; added = d.added;
    }
    for (const dd of deltas) {
      if (dd.changeType === 'added') {
        await c.query("INSERT INTO payroll.delta (import_id, from_version, to_version, employee_code, change_type) VALUES ($1,$2,$3,$4,'added')",
          [imp.id, prevFile ? prevFile.version : null, file.version, dd.employeeCode]);
      } else if (dd.changeType === 'changed') {
        await c.query("INSERT INTO payroll.delta (import_id, from_version, to_version, employee_code, change_type, field, before_value, after_value) VALUES ($1,$2,$3,$4,'changed',$5,$6,$7)",
          [imp.id, prevFile.version, file.version, dd.employeeCode, dd.field, dd.before == null ? null : String(dd.before), dd.after == null ? null : String(dd.after)]);
      }
    }
    for (const code of missing) {
      await c.query("INSERT INTO payroll.delta (import_id, from_version, to_version, employee_code, change_type) VALUES ($1,$2,$3,$4,'removed_missing')",
        [imp.id, prevFile.version, file.version, code]);
    }

    if (prevFile) await c.query("UPDATE payroll.import_file SET status = 'superseded' WHERE id = $1", [prevFile.id]);
    await c.query("UPDATE payroll.import_file SET status = 'confirmed', confirmed_at = now() WHERE id = $1", [fileId]);
    await c.query("SET CONSTRAINTS ALL DEFERRED");
    await c.query("UPDATE payroll.import SET status = 'active', current_file_id = $2 WHERE id = $1", [imp.id, fileId]);

    // register template fingerprint (first canonical if none yet)
    const hasCanon = (await c.query("SELECT 1 FROM payroll.template WHERE is_canonical = true LIMIT 1")).rowCount > 0;
    await c.query(
      `INSERT INTO payroll.template (fingerprint, label, is_canonical, column_map, first_seen_period)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (fingerprint) DO NOTHING`,
      [file.template_fingerprint, hasCanon ? 'PHF Payroll (kỳ ' + imp.period_month + ')' : 'PHF Payroll Canonical Template V1',
       !hasCanon, (file.validation && file.validation.columnMap) || columnMapOf(file), imp.period_month]);

    return {
      fileId, version: file.version, alreadyConfirmed: false,
      deltaCounts: { added: added.length, changed: deltas.filter((d) => d.changeType === 'changed').length, removedMissing: missing.length },
    };
  });
}
function columnMapOf() { return {}; }
function toRec(row) {
  const fields = {};
  for (const k of ['base_salary_bhxh','job_allowance','base_standard_total_1','std_income_total_1to9','worked_salary_total_1','allowance_actual_total_2','bonus_total_3','grand_total_4','internal_deduct_total_5','income_after_internal_5','statutory_deduct_total_6','income_after_deduct_6','tax_taxable_income','tax_assessable_income','tax_dependents','tax_pit_amount','final_net_after_tax','t13_revenue_bonus','reconcile_adjust','source_branch','salary_grade']) {
    if (row[k] != null) fields[k] = typeof row[k] === 'string' && !isNaN(Number(row[k])) && k !== 'source_branch' && k !== 'salary_grade' ? Number(row[k]) : row[k];
  }
  return { employeeCode: row.employee_code, fields, sourceDetail: row.source_detail || {} };
}

// ---- READ / STATUS -----------------------------------------------------
async function loadActiveNormalized(config, pm) {
  return readTx(config, async (c) => {
    const imp = (await c.query("SELECT * FROM payroll.import WHERE period_month = $1", [pm])).rows[0];
    if (!imp || !imp.current_file_id) return null;
    const file = (await c.query("SELECT * FROM payroll.import_file WHERE id = $1", [imp.current_file_id])).rows[0];
    const rows = (await c.query("SELECT * FROM payroll.normalized WHERE file_id = $1", [imp.current_file_id])).rows;
    return { version: file.version, fileId: file.id, records: rows.map(toRec) };
  });
}

async function status(config, actor, params) {
  const pm = period(params && params.periodMonth);
  return readTx(config, async (c) => {
    const imp = (await c.query("SELECT * FROM payroll.import WHERE period_month = $1", [pm])).rows[0];
    if (!imp) return { periodMonth: pm, exists: false, versions: [] };
    const files = (await c.query(
      "SELECT id, version, file_name, sha256, byte_size, status, row_count, warning_count, template_matched, uploaded_by_name, uploaded_at, confirmed_at FROM payroll.import_file WHERE import_id = $1 ORDER BY version DESC", [imp.id])).rows;
    const current = files.find((f) => f.id === imp.current_file_id) || null;
    return {
      periodMonth: pm, exists: true, importStatus: imp.status,
      current: current && {
        version: current.version, fileName: current.file_name, rowCount: current.row_count,
        warningCount: current.warning_count, templateMatched: current.template_matched,
        uploadedBy: current.uploaded_by_name, uploadedAt: current.uploaded_at, confirmedAt: current.confirmed_at,
      },
      versions: files.map((f) => ({
        fileId: f.id, version: f.version, fileName: f.file_name, status: f.status,
        rowCount: f.row_count, warningCount: f.warning_count, sha256: f.sha256.slice(0, 12),
        uploadedBy: f.uploaded_by_name, uploadedAt: f.uploaded_at, confirmedAt: f.confirmed_at,
        isCurrent: f.id === imp.current_file_id,
      })),
    };
  });
}

async function listNormalized(config, actor, params) {
  const pm = period(params && params.periodMonth);
  const active = await loadActiveNormalized(config, pm);
  if (!active) return { periodMonth: pm, version: null, rows: [] };
  return readTx(config, async (c) => {
    const rows = (await c.query(
      "SELECT * FROM payroll.normalized WHERE file_id = $1 ORDER BY employee_code", [active.fileId])).rows;
    return {
      periodMonth: pm, version: active.version, fileId: active.fileId,
      rows: rows.map((r) => ({
        employeeCode: r.employee_code, fullNameSource: r.full_name_source, sourceBranch: r.source_branch,
        salaryGrade: r.salary_grade, peopleMasterMatched: r.people_master_matched,
        baseSalaryBhxh: numOut(r.base_salary_bhxh), jobAllowance: numOut(r.job_allowance),
        baseStandardTotal1: numOut(r.base_standard_total_1), workedSalaryTotal1: numOut(r.worked_salary_total_1),
        allowanceActualTotal2: numOut(r.allowance_actual_total_2), bonusTotal3: numOut(r.bonus_total_3),
        grandTotal4: numOut(r.grand_total_4), statutoryDeductTotal6: numOut(r.statutory_deduct_total_6),
        incomeAfterDeduct6: numOut(r.income_after_deduct_6), taxTaxableIncome: numOut(r.tax_taxable_income),
        pitAmount: numOut(r.tax_pit_amount), finalNetAfterTax: numOut(r.final_net_after_tax),
        t13RevenueBonus: numOut(r.t13_revenue_bonus), reconcileAdjust: numOut(r.reconcile_adjust),
        validationStatus: r.validation_status,
      })),
    };
  });
}

async function employeeDetail(config, actor, params) {
  const pm = period(params && params.periodMonth);
  const code = String((params && params.employeeCode) || '').toUpperCase();
  if (!code) throw pErr('PAYROLL_EMPLOYEE_REQUIRED', 'Thiếu mã nhân viên.', 400);
  const active = await loadActiveNormalized(config, pm);
  if (!active) throw pErr('PAYROLL_NO_ACTIVE_VERSION', 'Kỳ này chưa có dữ liệu chuẩn hóa.', 404);
  return readTx(config, async (c) => {
    const nr = (await c.query("SELECT * FROM payroll.normalized WHERE file_id = $1 AND employee_code = $2", [active.fileId, code])).rows[0];
    if (!nr) throw pErr('PAYROLL_EMPLOYEE_NOT_IN_PERIOD', 'Nhân viên không có trong kỳ này.', 404);
    const raw = (await c.query("SELECT source_row_index, cells FROM payroll.raw_row WHERE file_id = $1 AND employee_code = $2", [active.fileId, code])).rows[0];
    const history = (await c.query(
      "SELECT from_version, to_version, change_type, field, before_value, after_value, detected_at FROM payroll.delta WHERE import_id = (SELECT import_id FROM payroll.import_file WHERE id = $1) AND employee_code = $2 ORDER BY to_version DESC, id DESC", [active.fileId, code])).rows;
    return { periodMonth: pm, version: active.version, employeeCode: code, normalized: nr, sourceDetail: nr.source_detail, rawCells: raw ? raw.cells : null, validationNotes: nr.validation_notes, history };
  });
}
function numOut(v) { return v == null ? null : Number(v); }

// ---- helpers -----------------------------------------------------------
function diffColumnMaps(a, b) {
  const ka = new Set(Object.keys(a || {})), kb = new Set(Object.keys(b || {}));
  const added = [...kb].filter((k) => !ka.has(k));
  const removed = [...ka].filter((k) => !kb.has(k));
  const moved = [...kb].filter((k) => ka.has(k) && a[k] !== b[k]).map((k) => ({ field: k, from: a[k], to: b[k] }));
  return { added, removed, moved };
}
function dedupeChanged(deltas) {
  const byEmp = new Map();
  for (const d of deltas.filter((x) => x.changeType === 'changed')) {
    if (!byEmp.has(d.employeeCode)) byEmp.set(d.employeeCode, []);
    byEmp.get(d.employeeCode).push({ field: d.field, before: d.before, after: d.after });
  }
  return [...byEmp.entries()].map(([employeeCode, changes]) => ({ employeeCode, changes }));
}

// ---- dispatch --------------------------------------------------------
const HANDLERS = {
  'payroll.validatePreview': validatePreview,
  'payroll.confirm': confirmImport,
  'payroll.status': status,
  'payroll.listNormalized': listNormalized,
  'payroll.employeeDetail': employeeDetail,
};
const ACTIONS = Object.freeze(Object.keys(HANDLERS));
async function dispatch(config, actor, action, params) {
  const h = HANDLERS[action];
  if (!h) throw pErr('PAYROLL_ACTION_UNKNOWN', 'Hành động payroll không hợp lệ: ' + action, 400);
  return h(config, actor, params || {});
}

module.exports = { dispatch, ACTIONS, HANDLERS, PayrollError };
