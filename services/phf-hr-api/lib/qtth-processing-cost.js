'use strict';

// PHF HR — QTTH Truth Data · "Chi phí xử lý" (Processing cost) · phf-hr-api service.
//
// V1 scope: upload foundation + template ONLY. NO income report, NO advance/
// deduction logic, NO personal income tax logic, NO Total Personnel Cost
// aggregation — this source is intentionally NOT wired into payroll's
// costTruth aggregation in this batch.
//
// Company PostgreSQL phf_hr / schema processing_cost ONLY (dev/throwaway:
// phf_hr_e2e). Every DB call via the Task runtime-identity helpers (SET LOCAL
// ROLE phf_hr_app). Authorization decided upstream (qtth-service dev-lock +
// permission-manager); this module trusts the verified actor.
//
// Each SQL statement below carries a leading `/* TAG */` comment purely so it
// can be exercised by an in-memory fake db in tests (scripts/test-qtth-*.js)
// without a live Postgres — Postgres itself ignores the comment. The tag is
// NEVER read by production code.

const crypto = require('crypto');
const { withTaskReadTransaction, withTaskWriteTransaction } = require('./db');
const { readWorkbook } = require('./xlsx-lite');
const TPL = require('./qtth-processing-cost-template');
const { normalizeGrid, diffVersions } = require('./qtth-processing-cost-normalize');

class ProcessingCostError extends Error {
  constructor(code, message, statusCode) { super(message || code); this.code = code; this.statusCode = statusCode || 400; this.isProcessingCostError = true; }
}
function pErr(code, message, statusCode) { return new ProcessingCostError(code, message, statusCode); }
function mapPg(e) {
  const c = String((e && e.code) || '');
  if (c === '23505') return pErr('PROCESSING_COST_DUPLICATE', 'Bản ghi trùng.', 409);
  if (c === '42P01' || c === '3F000') return pErr('PROCESSING_COST_SCHEMA_MISSING', 'Schema processing_cost chưa được cài đặt (migrations/phf_hr_qtth_processing_cost_v1.sql).', 503);
  if (c === '42501') return pErr('PROCESSING_COST_PERMISSION_DENIED', 'Thiếu quyền CSDL processing_cost.', 500);
  return null;
}
// validation.blockers → {duplicateEmployeeCodes:[], unknownEmployeeCodes:[]}.
// validation may come back as a JS object (pg jsonb auto-parse) or, in some
// pool configs, a JSON string — accept both, never trust a client-supplied copy.
function unresolvedBlockers(validation) {
  let v = validation;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = null; } }
  const b = (v && v.blockers) || {};
  return {
    duplicateEmployeeCodes: Array.isArray(b.duplicateEmployeeCodes) ? b.duplicateEmployeeCodes : [],
    unknownEmployeeCodes: Array.isArray(b.unknownEmployeeCodes) ? b.unknownEmployeeCodes : [],
  };
}
async function readTx(config, fn) { try { return await withTaskReadTransaction(config, fn); } catch (e) { throw mapPg(e) || e; } }
async function writeTx(config, fn) { try { return await withTaskWriteTransaction(config, fn); } catch (e) { throw mapPg(e) || e; } }

function period(p) { const s = String(p || '').trim(); if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(s)) throw pErr('PROCESSING_COST_PERIOD_INVALID', 'Kỳ phải theo YYYY-MM.', 400); return s; }
function actorCols(a) { return [String(a && a.accountId || '') || null, String(a && (a.displayName || a.employeeCode) || '') || null]; }

function parseWorkbookBuffer(buffer) {
  const wb = readWorkbook(buffer);
  let sheet = wb.sheets.find((s) => s.rows.some((row) => row.some((c) => TPL.norm(c) === 'ma nv')));
  if (!sheet) sheet = wb.sheets[0];
  return { sheetName: sheet.name, rows: sheet.rows };
}

// ---- pure report builder (no DB) — kept separate so it is independently
// unit-testable (scripts/test-qtth-processing-cost-*.js). ----------------
function buildValidationReport(input) {
  const { periodMonth, fileName, sha256, byteSize, sheetName, nm, knownCodes, prevRecords } = input;
  const unknownCodes = knownCodes && knownCodes.size
    ? nm.records.filter((r) => !knownCodes.has(r.employeeCode)).map((r) => r.employeeCode)
    : [];
  const vdiff = prevRecords ? diffVersions(prevRecords, nm.records) : { deltas: [], missing: [], added: nm.records.map((r) => r.employeeCode) };
  // LOCKED blocking rules (tightened, cannot be bypassed client-side —
  // confirmImport() re-derives this same shape from the persisted validation
  // report, never trusts a client-supplied canConfirm):
  //  - any duplicate employee_code within the file → blocks confirm
  //  - any employee_code not found in People Master → blocks confirm until
  //    the source file is corrected/removed and re-uploaded (name is never
  //    used to resolve it — employee_code is the only identity key)
  const blockers = {
    duplicateEmployeeCodes: nm.duplicateCodes || [],
    unknownEmployeeCodes: unknownCodes,
  };
  return {
    periodMonth, fileName, sha256, byteSize, sheetName,
    totals: {
      rows: nm.rowCount,
      matchedEmployeeCodes: nm.rowCount - unknownCodes.length,
      unknownEmployeeCodes: unknownCodes,
      duplicateInFile: nm.fileWarnings,
      missingAmount: nm.missingAmount,
    },
    blockers,
    canConfirm: blockers.duplicateEmployeeCodes.length === 0 && blockers.unknownEmployeeCodes.length === 0,
    versionDiff: {
      isFirstVersion: !prevRecords,
      added: vdiff.added,
      changed: vdiff.deltas.filter((d) => d.changeType === 'changed'),
      missingFromNewVersion: vdiff.missing,
    },
  };
}

// ---- VALIDATE + PREVIEW ---------------------------------------------------
async function validatePreview(config, actor, params) {
  const pm = period(params && params.periodMonth);
  const fileName = String((params && params.fileName) || 'chi-phi-xu-ly.xlsx').slice(0, 200);
  const b64 = String((params && params.fileBase64) || '');
  if (!b64) throw pErr('PROCESSING_COST_FILE_REQUIRED', 'Chưa có file để kiểm tra.', 400);
  let buffer;
  try { buffer = Buffer.from(b64, 'base64'); } catch (_) { throw pErr('PROCESSING_COST_FILE_BASE64', 'Nội dung file không hợp lệ.', 400); }
  if (buffer.length < 4 || buffer.readUInt16LE(0) !== 0x4b50) throw pErr('PROCESSING_COST_NOT_XLSX', 'File không phải .xlsx hợp lệ.', 400);
  const knownCodes = new Set((Array.isArray(params && params.knownEmployeeCodes) ? params.knownEmployeeCodes : []).map((c) => String(c).toUpperCase()));

  let grid;
  try { grid = parseWorkbookBuffer(buffer); }
  catch (e) { throw pErr(e.code || 'PROCESSING_COST_PARSE_FAILED', e.message || 'Không đọc được file .xlsx.', 400); }

  const fp = TPL.fingerprint(grid.rows);
  if (!fp.ok) throw pErr('PROCESSING_COST_HEADER_NOT_FOUND', 'Không tìm thấy hàng tiêu đề (MÃ NV / HỌ VÀ TÊN / CHI PHÍ XỬ LÝ).', 400);

  const nm = normalizeGrid(grid.rows, fp.columnMap);
  if (!nm.ok) throw pErr('PROCESSING_COST_NORMALIZE_FAILED', 'Không chuẩn hóa được dữ liệu.', 400);
  if (!nm.rowCount) throw pErr('PROCESSING_COST_NO_ROWS', 'File không có dòng dữ liệu hợp lệ.', 400);

  const prev = await loadActiveNormalized(config, pm);
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');

  const report = buildValidationReport({
    periodMonth: pm, fileName, sha256: sha, byteSize: buffer.length, sheetName: grid.sheetName,
    nm, knownCodes, prevRecords: prev ? prev.records : null,
  });

  const [aid, aname] = actorCols(actor);
  const persisted = await writeTx(config, async (c) => {
    let imp = (await c.query('/* Q_GET_IMPORT_BY_PERIOD */ SELECT * FROM processing_cost.import WHERE period_month = $1', [pm])).rows[0];
    if (!imp) imp = (await c.query('/* Q_INSERT_IMPORT */ INSERT INTO processing_cost.import (period_month, created_by_account_id, created_by_name) VALUES ($1,$2,$3) RETURNING *', [pm, aid, aname])).rows[0];

    const existing = (await c.query('/* Q_GET_FILE_BY_SHA */ SELECT * FROM processing_cost.import_file WHERE import_id = $1 AND sha256 = $2', [imp.id, sha])).rows[0];
    if (existing) {
      await c.query('/* Q_REVALIDATE_FILE */ UPDATE processing_cost.import_file SET validation = $2, row_count = $3, warning_count = $4 WHERE id = $1',
        [existing.id, report, nm.rowCount, report.totals.unknownEmployeeCodes.length + report.totals.duplicateInFile.length]);
      return { fileId: existing.id, version: existing.version, replayed: true, importId: imp.id };
    }
    const nextVer = ((await c.query('/* Q_NEXT_VERSION */ SELECT COALESCE(MAX(version),0) v FROM processing_cost.import_file WHERE import_id = $1', [imp.id])).rows[0].v) + 1;
    const file = (await c.query(
      `/* Q_INSERT_FILE */ INSERT INTO processing_cost.import_file
        (import_id, version, file_name, sha256, byte_size, status, row_count, warning_count, validation, uploaded_by_account_id, uploaded_by_name)
       VALUES ($1,$2,$3,$4,$5,'previewed',$6,$7,$8,$9,$10) RETURNING id, version`,
      [imp.id, nextVer, fileName, sha, buffer.length, nm.rowCount,
       report.totals.unknownEmployeeCodes.length + report.totals.duplicateInFile.length, report, aid, aname])).rows[0];

    for (const rec of nm.records) {
      await c.query(
        '/* Q_INSERT_NORMALIZED */ INSERT INTO processing_cost.normalized (file_id, employee_code, period_month, employee_name, amount, people_master_matched) VALUES ($1,$2,$3,$4,$5,$6)',
        [file.id, rec.employeeCode, pm, rec.employeeName, rec.amount, knownCodes.size ? knownCodes.has(rec.employeeCode) : false]);
    }
    return { fileId: file.id, version: file.version, replayed: false, importId: imp.id };
  });

  return Object.assign(report, { fileId: persisted.fileId, version: persisted.version, importId: persisted.importId, replayed: persisted.replayed });
}

// ---- CONFIRM ------------------------------------------------------------
async function confirmImport(config, actor, params) {
  const fileId = String((params && params.fileId) || '');
  if (!fileId) throw pErr('PROCESSING_COST_FILE_ID_REQUIRED', 'Thiếu fileId.', 400);
  return writeTx(config, async (c) => {
    const file = (await c.query('/* Q_GET_FILE_FOR_UPDATE */ SELECT * FROM processing_cost.import_file WHERE id = $1 FOR UPDATE', [fileId])).rows[0];
    if (!file) throw pErr('PROCESSING_COST_FILE_NOT_FOUND', 'Không tìm thấy phiên bản file.', 404);
    if (file.status === 'confirmed') return { fileId, version: file.version, alreadyConfirmed: true };

    // Server-side re-derivation, never trust a client-supplied canConfirm:
    // confirm is refused while the file's OWN stored validation report still
    // carries a duplicate-employee_code or unknown-employee_code blocker.
    const blockers = unresolvedBlockers(file.validation);
    if (blockers.duplicateEmployeeCodes.length || blockers.unknownEmployeeCodes.length) {
      const parts = [];
      if (blockers.duplicateEmployeeCodes.length) parts.push('mã NV trùng trong file: ' + blockers.duplicateEmployeeCodes.join(', '));
      if (blockers.unknownEmployeeCodes.length) parts.push('mã NV chưa xác định trong People Master: ' + blockers.unknownEmployeeCodes.join(', '));
      throw pErr('PROCESSING_COST_CONFIRM_BLOCKED', 'Không thể xác nhận — còn ' + parts.join(' · ') + '. Sửa file nguồn và tải lại.', 409);
    }

    const imp = (await c.query('/* Q_GET_IMPORT_FOR_UPDATE */ SELECT * FROM processing_cost.import WHERE id = $1 FOR UPDATE', [file.import_id])).rows[0];

    const prevFile = (await c.query(
      "/* Q_GET_PREV_CONFIRMED */ SELECT * FROM processing_cost.import_file WHERE import_id = $1 AND status = 'confirmed' ORDER BY version DESC LIMIT 1", [imp.id])).rows[0];

    // deterministic version supersede: never a silent overwrite-in-place —
    // the previous confirmed version is marked 'superseded' and kept (audit
    // trail); the new version becomes current/active.
    if (prevFile) await c.query("/* Q_SUPERSEDE_FILE */ UPDATE processing_cost.import_file SET status = 'superseded' WHERE id = $1", [prevFile.id]);
    await c.query("/* Q_CONFIRM_FILE */ UPDATE processing_cost.import_file SET status = 'confirmed', confirmed_at = now() WHERE id = $1", [fileId]);
    await c.query('/* Q_DEFER */ SET CONSTRAINTS ALL DEFERRED');
    await c.query("/* Q_ACTIVATE_IMPORT */ UPDATE processing_cost.import SET status = 'active', current_file_id = $2 WHERE id = $1", [imp.id, fileId]);

    return { fileId, version: file.version, alreadyConfirmed: false, previousVersion: prevFile ? prevFile.version : null };
  });
}

// ---- READ / STATUS -----------------------------------------------------
async function loadActiveNormalized(config, pm) {
  return readTx(config, async (c) => {
    const imp = (await c.query('/* Q_GET_IMPORT_BY_PERIOD */ SELECT * FROM processing_cost.import WHERE period_month = $1', [pm])).rows[0];
    if (!imp || !imp.current_file_id) return null;
    const file = (await c.query('/* Q_GET_FILE_BY_ID */ SELECT * FROM processing_cost.import_file WHERE id = $1', [imp.current_file_id])).rows[0];
    const rows = (await c.query('/* Q_GET_NORMALIZED_BY_FILE */ SELECT * FROM processing_cost.normalized WHERE file_id = $1 ORDER BY employee_code', [imp.current_file_id])).rows;
    return { version: file.version, fileId: file.id, records: rows.map(toRec) };
  });
}
function toRec(row) { return { employeeCode: row.employee_code, employeeName: row.employee_name, amount: row.amount == null ? null : Number(row.amount) }; }

async function status(config, actor, params) {
  const pm = period(params && params.periodMonth);
  return readTx(config, async (c) => {
    const imp = (await c.query('/* Q_GET_IMPORT_BY_PERIOD */ SELECT * FROM processing_cost.import WHERE period_month = $1', [pm])).rows[0];
    if (!imp) return { periodMonth: pm, exists: false, versions: [] };
    const files = (await c.query(
      '/* Q_LIST_FILES */ SELECT id, version, file_name, sha256, byte_size, status, row_count, warning_count, uploaded_by_name, uploaded_at, confirmed_at FROM processing_cost.import_file WHERE import_id = $1 ORDER BY version DESC', [imp.id])).rows;
    const current = files.find((f) => f.id === imp.current_file_id) || null;
    return {
      periodMonth: pm, exists: true, importStatus: imp.status,
      current: current && {
        version: current.version, fileName: current.file_name, rowCount: current.row_count,
        warningCount: current.warning_count, uploadedBy: current.uploaded_by_name,
        uploadedAt: current.uploaded_at, confirmedAt: current.confirmed_at,
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
    const rows = (await c.query('/* Q_GET_NORMALIZED_BY_FILE */ SELECT * FROM processing_cost.normalized WHERE file_id = $1 ORDER BY employee_code', [active.fileId])).rows;
    return {
      periodMonth: pm, version: active.version, fileId: active.fileId,
      rows: rows.map((r) => ({
        employeeCode: r.employee_code, employeeName: r.employee_name,
        amount: r.amount == null ? null : Number(r.amount), peopleMasterMatched: r.people_master_matched,
      })),
    };
  });
}

// ---- dispatch --------------------------------------------------------
const HANDLERS = {
  'processingCost.validatePreview': validatePreview,
  'processingCost.confirm': confirmImport,
  'processingCost.status': status,
  'processingCost.listNormalized': listNormalized,
};
const ACTIONS = Object.freeze(Object.keys(HANDLERS));
async function dispatch(config, actor, action, params) {
  const h = HANDLERS[action];
  if (!h) throw pErr('PROCESSING_COST_ACTION_UNKNOWN', 'Hành động processing cost không hợp lệ: ' + action, 400);
  return h(config, actor, params || {});
}

module.exports = { dispatch, ACTIONS, HANDLERS, ProcessingCostError, buildValidationReport, loadActiveNormalized, unresolvedBlockers };
