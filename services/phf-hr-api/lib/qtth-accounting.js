'use strict';

// PHF HR — QTTH Truth Data · ACCOUNTING (CHI PHÍ QUẢN TRỊ) · phf-hr-api service.
//
// FAST export -> streaming parse -> debit filter -> broad cost scope ->
// classification/exclusion engine -> NEEDS_REVIEW preservation -> Preview ->
// Xác nhận / version -> normalized Accounting Truth.
//
// Company PostgreSQL phf_hr / schema `accounting` ONLY (dev/throwaway: phf_hr_e2e).
// Every DB call via the Task runtime-identity helpers (SET LOCAL ROLE phf_hr_app).
// NO dashboard, NO report, NO allocation, NO cost-code keyword mapping.
// Authorization decided upstream (qtth-service dev-lock + permission-manager).
// RAW_ROWS_SAVED_AS_FACT = 0 — only cost-scope normalized rows are persisted.

const crypto = require('crypto');
const { withTaskReadTransaction, withTaskWriteTransaction } = require('./db');
const { runFunnel } = require('./qtth-accounting-normalize');
const { SEED_RULES } = require('./qtth-accounting-classify');
const { parseCostDictionary } = require('./qtth-accounting-dictionary');
const storage = require('./qtth-accounting-storage');

class AccountingError extends Error {
  constructor(code, message, statusCode) { super(message || code); this.code = code; this.statusCode = statusCode || 400; this.isAccountingError = true; }
}
function aErr(code, message, statusCode) { return new AccountingError(code, message, statusCode); }
function mapPg(e) {
  const c = String((e && e.code) || '');
  if (c === '23505') return aErr('ACCOUNTING_DUPLICATE', 'Bản ghi trùng.', 409);
  if (c === '42P01' || c === '3F000') return aErr('ACCOUNTING_SCHEMA_MISSING', 'Schema accounting chưa được cài đặt (migrations/phf_hr_qtth_accounting_v1.sql).', 503);
  if (c === '42501') return aErr('ACCOUNTING_PERMISSION_DENIED', 'Thiếu quyền CSDL accounting.', 500);
  return null;
}
async function readTx(config, fn) { try { return await withTaskReadTransaction(config, fn); } catch (e) { throw mapPg(e) || e; } }
async function writeTx(config, fn) { try { return await withTaskWriteTransaction(config, fn); } catch (e) { throw mapPg(e) || e; } }

function period(p) { const s = String(p || '').trim(); if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(s)) throw aErr('ACCOUNTING_PERIOD_INVALID', 'Kỳ quản trị phải theo YYYY-MM.', 400); return s; }
function actorCols(a) { return [String(a && a.accountId || '') || null, String(a && (a.displayName || a.employeeCode) || '') || null]; }
function decodeBase64Xlsx(b64) {
  if (!b64) throw aErr('ACCOUNTING_FILE_REQUIRED', 'Chưa có file để xử lý.', 400);
  let buf;
  try { buf = Buffer.from(String(b64), 'base64'); } catch (_) { throw aErr('ACCOUNTING_FILE_BASE64', 'Nội dung file không hợp lệ.', 400); }
  if (buf.length < 4 || buf.readUInt16LE(0) !== 0x4b50) throw aErr('ACCOUNTING_NOT_XLSX', 'File không phải .xlsx hợp lệ.', 400);
  return buf;
}

// ---- classification rules (DB with SEED fallback) ----------------------
async function loadRules(config) {
  try {
    const r = await readTx(config, (c) => c.query(
      'SELECT id, priority, match_kind, match_value, action, note, rule_version, is_active FROM accounting.classification_rule WHERE is_active = true ORDER BY priority, id'));
    if (r.rows.length) {
      return r.rows.map((x) => ({
        id: x.id, priority: x.priority, matchKind: x.match_kind,
        matchValue: typeof x.match_value === 'string' ? JSON.parse(x.match_value) : x.match_value,
        action: x.action, note: x.note, ruleVersion: x.rule_version, isActive: x.is_active,
      }));
    }
  } catch (e) { if (String(e && e.code) !== 'ACCOUNTING_SCHEMA_MISSING') throw e; }
  return SEED_RULES;
}

// ---- UPLOAD + PREVIEW -------------------------------------------------
async function uploadPreview(config, actor, params) {
  const pm = period(params && params.periodMonth);
  const fileName = String((params && params.fileName) || 'ban-ke-fast.xlsx').slice(0, 200);
  const buffer = decodeBase64Xlsx(params && params.fileBase64);
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');

  const rules = await loadRules(config);
  const funnel = await runFunnel(buffer, { rules });
  const rep = funnel.report;
  const [aid, aname] = actorCols(actor);

  const persisted = await writeTx(config, async (c) => {
    let imp = (await c.query('SELECT * FROM accounting.import WHERE period_month = $1', [pm])).rows[0];
    if (!imp) imp = (await c.query(
      'INSERT INTO accounting.import (period_month, created_by_account_id, created_by_name) VALUES ($1,$2,$3) RETURNING *', [pm, aid, aname])).rows[0];

    const existing = (await c.query('SELECT * FROM accounting.import_file WHERE import_id = $1 AND sha256 = $2', [imp.id, sha])).rows[0];
    let file;
    if (existing) {
      if (existing.status === 'confirmed') return { fileId: existing.id, version: existing.version, replayed: true, importId: imp.id, alreadyConfirmed: true };
      await c.query('DELETE FROM accounting.normalized WHERE file_id = $1', [existing.id]);
      file = (await c.query(
        `UPDATE accounting.import_file SET report=$2, rule_version=$3, sheet_name=$4, source_from_date=$5, source_to_date=$6,
           source_row_count=$7, debit_row_count=$8, credit_row_count=$9, cost_scope_row_count=$10,
           included_row_count=$11, excluded_row_count=$12, needs_review_row_count=$13,
           included_amount=$14, needs_review_amount=$15, excluded_amount=$16, warning_count=$17, uploaded_at=now()
         WHERE id=$1 RETURNING id, version`,
        [existing.id, rep, rep.meta.ruleVersion, funnel.meta.sheetName, funnel.meta.fromDate, funnel.meta.toDate,
         rep.totals.sourceRows, rep.totals.debitRows, rep.totals.creditRows, rep.totals.costScopeRows,
         rep.totals.included, rep.totals.excluded, rep.totals.needsReview,
         rep.amounts.included, rep.amounts.needsReview, rep.amounts.excluded, rep.warnings.length])).rows[0];
    } else {
      const nextVer = ((await c.query('SELECT COALESCE(MAX(version),0) v FROM accounting.import_file WHERE import_id = $1', [imp.id])).rows[0].v) + 1;
      const st = await storage.store(config.PHF_HR_ATTACHMENT_ROOT, { period: pm, version: nextVer, fileName, buffer });
      file = (await c.query(
        `INSERT INTO accounting.import_file
          (import_id, version, file_name, sha256, byte_size, storage_ref, sheet_name, source_from_date, source_to_date, rule_version, status,
           source_row_count, debit_row_count, credit_row_count, cost_scope_row_count,
           included_row_count, excluded_row_count, needs_review_row_count,
           included_amount, needs_review_amount, excluded_amount, warning_count, report, uploaded_by_account_id, uploaded_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'previewed',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         RETURNING id, version`,
        [imp.id, nextVer, fileName, st.sha256, st.byteSize, st.storageRef, funnel.meta.sheetName, funnel.meta.fromDate, funnel.meta.toDate, rep.meta.ruleVersion,
         rep.totals.sourceRows, rep.totals.debitRows, rep.totals.creditRows, rep.totals.costScopeRows,
         rep.totals.included, rep.totals.excluded, rep.totals.needsReview,
         rep.amounts.included, rep.amounts.needsReview, rep.amounts.excluded, rep.warnings.length, rep, aid, aname])).rows[0];
    }

    for (const row of funnel.normalizedRows) {
      await c.query(
        `INSERT INTO accounting.normalized
          (file_id, period_month, source_row_index, ngay_ct, ma_ct, so_ct, ma_khach, ten_khach, dien_giai,
           tai_khoan, tk_doi_ung, phat_sinh_no, ma_bp, ma_bp_out_of_master,
           classification, classified_by_rule_id, rule_version, cost_code_status, warnings)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'UNRESOLVED',$18)`,
        [file.id, pm, row.sourceRowIndex, row.ngayCt || null, row.maCt || null, row.soCt || null, row.maKhach || null, row.tenKhach || null, row.dienGiai || null,
         row.taiKhoan, row.tkDoiUng || null, row.phatSinhNo, row.maBp || null, !!row.maBpOutOfMaster,
         row.classification, row.classifiedByRuleId || null, rep.meta.ruleVersion, JSON.stringify(row.warnings || [])]);
    }
    return { fileId: file.id, version: file.version, replayed: !!existing, importId: imp.id };
  });

  return Object.assign({ periodMonth: pm, sha256: sha, byteSize: buffer.length }, persisted, rep);
}

// ---- CONFIRM --------------------------------------------------------
async function confirmImport(config, actor, params) {
  const fileId = String((params && params.fileId) || '');
  if (!fileId) throw aErr('ACCOUNTING_FILE_ID_REQUIRED', 'Thiếu fileId.', 400);
  return writeTx(config, async (c) => {
    const file = (await c.query('SELECT * FROM accounting.import_file WHERE id = $1 FOR UPDATE', [fileId])).rows[0];
    if (!file) throw aErr('ACCOUNTING_FILE_NOT_FOUND', 'Không tìm thấy phiên bản file.', 404);
    if (file.status === 'confirmed') return { fileId, version: file.version, alreadyConfirmed: true };
    const imp = (await c.query('SELECT * FROM accounting.import WHERE id = $1 FOR UPDATE', [file.import_id])).rows[0];
    const prev = (await c.query(
      "SELECT * FROM accounting.import_file WHERE import_id = $1 AND status = 'confirmed' ORDER BY version DESC LIMIT 1", [imp.id])).rows[0];

    if (prev) {
      const metrics = [
        ['included_row_count', prev.included_row_count, file.included_row_count],
        ['excluded_row_count', prev.excluded_row_count, file.excluded_row_count],
        ['needs_review_row_count', prev.needs_review_row_count, file.needs_review_row_count],
        ['included_amount', prev.included_amount, file.included_amount],
        ['needs_review_amount', prev.needs_review_amount, file.needs_review_amount],
      ];
      for (const [m, b, a] of metrics) {
        if (String(b) !== String(a)) {
          await c.query('INSERT INTO accounting.delta (import_id, from_version, to_version, metric, before_value, after_value) VALUES ($1,$2,$3,$4,$5,$6)',
            [imp.id, prev.version, file.version, m, b == null ? null : String(b), a == null ? null : String(a)]);
        }
      }
      await c.query("UPDATE accounting.import_file SET status = 'superseded' WHERE id = $1", [prev.id]);
    }
    await c.query("UPDATE accounting.import_file SET status = 'confirmed', confirmed_at = now() WHERE id = $1", [fileId]);
    await c.query('SET CONSTRAINTS ALL DEFERRED');
    await c.query("UPDATE accounting.import SET status = 'active', current_file_id = $2 WHERE id = $1", [imp.id, fileId]);
    return { fileId, version: file.version, alreadyConfirmed: false, supersededVersion: prev ? prev.version : null };
  });
}

// ---- READ / STATUS -------------------------------------------------
function fileSummary(f, currentId) {
  return {
    fileId: f.id, version: f.version, fileName: f.file_name, status: f.status,
    sha256: f.sha256.slice(0, 12), byteSize: Number(f.byte_size),
    sourceFromDate: f.source_from_date, sourceToDate: f.source_to_date, ruleVersion: f.rule_version,
    sourceRows: f.source_row_count, debitRows: f.debit_row_count, creditRows: f.credit_row_count,
    costScopeRows: f.cost_scope_row_count,
    included: f.included_row_count, excluded: f.excluded_row_count, needsReview: f.needs_review_row_count,
    includedAmount: Number(f.included_amount), needsReviewAmount: Number(f.needs_review_amount), excludedAmount: Number(f.excluded_amount),
    warningCount: f.warning_count,
    uploadedBy: f.uploaded_by_name, uploadedAt: f.uploaded_at, confirmedAt: f.confirmed_at,
    isCurrent: f.id === currentId,
  };
}

async function status(config, actor, params) {
  const pm = period(params && params.periodMonth);
  return readTx(config, async (c) => {
    const imp = (await c.query('SELECT * FROM accounting.import WHERE period_month = $1', [pm])).rows[0];
    if (!imp) return { periodMonth: pm, exists: false, versions: [] };
    const files = (await c.query('SELECT * FROM accounting.import_file WHERE import_id = $1 ORDER BY version DESC', [imp.id])).rows;
    const current = files.find((f) => f.id === imp.current_file_id) || null;
    return {
      periodMonth: pm, exists: true, importStatus: imp.status,
      current: current ? fileSummary(current, imp.current_file_id) : null,
      versions: files.map((f) => fileSummary(f, imp.current_file_id)),
    };
  });
}

async function preview(config, actor, params) {
  const fileId = String((params && params.fileId) || '');
  return readTx(config, async (c) => {
    let file;
    if (fileId) file = (await c.query('SELECT * FROM accounting.import_file WHERE id = $1', [fileId])).rows[0];
    else {
      const pm = period(params && params.periodMonth);
      const imp = (await c.query('SELECT * FROM accounting.import WHERE period_month = $1', [pm])).rows[0];
      if (!imp) return { exists: false };
      const v = params && params.version;
      file = v
        ? (await c.query('SELECT * FROM accounting.import_file WHERE import_id = $1 AND version = $2', [imp.id, Number(v)])).rows[0]
        : (await c.query('SELECT * FROM accounting.import_file WHERE import_id = $1 ORDER BY version DESC LIMIT 1', [imp.id])).rows[0];
    }
    if (!file) return { exists: false };
    return { exists: true, fileId: file.id, version: file.version, status: file.status, report: file.report };
  });
}

async function listNormalized(config, actor, params) {
  const pm = period(params && params.periodMonth);
  const cls = params && params.classification;
  const account = params && params.account ? String(params.account).trim() : null;
  return readTx(config, async (c) => {
    const imp = (await c.query('SELECT * FROM accounting.import WHERE period_month = $1', [pm])).rows[0];
    if (!imp || !imp.current_file_id) return { periodMonth: pm, version: null, rows: [] };
    const file = (await c.query('SELECT version FROM accounting.import_file WHERE id = $1', [imp.current_file_id])).rows[0];
    const conds = ['file_id = $1'];
    const vals = [imp.current_file_id];
    if (cls && ['INCLUDE', 'EXCLUDE', 'NEEDS_REVIEW'].indexOf(cls) >= 0) { vals.push(cls); conds.push('classification = $' + vals.length); }
    if (account) { vals.push(account); conds.push('tai_khoan = $' + vals.length); }
    const r = (await c.query(
      `SELECT source_row_index, ngay_ct, ma_ct, so_ct, ma_khach, ten_khach, dien_giai, tai_khoan, tk_doi_ung,
              phat_sinh_no, ma_bp, ma_bp_out_of_master, classification, classified_by_rule_id, cost_code_status, warnings
       FROM accounting.normalized WHERE ${conds.join(' AND ')} ORDER BY tai_khoan, source_row_index LIMIT 5000`, vals)).rows;
    return {
      periodMonth: pm, version: file ? file.version : null, rowCount: r.length,
      rows: r.map((x) => ({
        sourceRowIndex: x.source_row_index, ngayCt: x.ngay_ct, maCt: x.ma_ct, soCt: x.so_ct,
        maKhach: x.ma_khach, tenKhach: x.ten_khach, dienGiai: x.dien_giai,
        taiKhoan: x.tai_khoan, tkDoiUng: x.tk_doi_ung, phatSinhNo: Number(x.phat_sinh_no),
        maBp: x.ma_bp, maBpOutOfMaster: x.ma_bp_out_of_master,
        classification: x.classification, ruleId: x.classified_by_rule_id, costCodeStatus: x.cost_code_status,
        warnings: x.warnings,
      })),
    };
  });
}

async function listRules(config) {
  const rules = await loadRules(config);
  return { ruleVersion: (rules[0] && (rules[0].ruleVersion || rules[0].rule_version)) || 'v1', rules };
}

// ---- COST DICTIONARY ---------------------------------------------
async function importDictionary(config, actor, params) {
  const fileName = String((params && params.fileName) || 'danh-muc-phi.xlsx').slice(0, 200);
  const buffer = decodeBase64Xlsx(params && params.fileBase64);
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const parsed = parseCostDictionary(buffer);
  const [aid, aname] = actorCols(actor);
  return writeTx(config, async (c) => {
    const dup = (await c.query('SELECT id, version FROM accounting.cost_dictionary WHERE source_sha256 = $1', [sha])).rows[0];
    if (dup) return { dictionaryId: dup.id, version: dup.version, entryCount: parsed.entries.length, replayed: true };
    const nextVer = ((await c.query('SELECT COALESCE(MAX(version),0) v FROM accounting.cost_dictionary')).rows[0].v) + 1;
    await c.query('UPDATE accounting.cost_dictionary SET is_current = false WHERE is_current = true');
    const dict = (await c.query(
      `INSERT INTO accounting.cost_dictionary (version, source_file_name, source_sha256, entry_count, is_current, imported_by_account_id, imported_by_name)
       VALUES ($1,$2,$3,$4,true,$5,$6) RETURNING id, version`, [nextVer, fileName, sha, parsed.entries.length, aid, aname])).rows[0];
    for (const e of parsed.entries) {
      await c.query(
        `INSERT INTO accounting.cost_dictionary_entry (dictionary_id, ma_phi, ten_phi, bo_phan, nhom1, ten_nhom1, nhom2, ten_nhom2, nhom3, ten_nhom3, ghi_chu)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [dict.id, e.maPhi, e.tenPhi, e.boPhan, e.nhom1, e.tenNhom1, e.nhom2, e.tenNhom2, e.nhom3, e.tenNhom3, e.ghiChu]);
    }
    return { dictionaryId: dict.id, version: dict.version, entryCount: parsed.entries.length, replayed: false };
  });
}

async function dictionaryStatus(config) {
  return readTx(config, async (c) => {
    const d = (await c.query('SELECT * FROM accounting.cost_dictionary WHERE is_current = true')).rows[0];
    if (!d) return { exists: false };
    const groups = (await c.query(
      'SELECT nhom1, ten_nhom1, count(*) n FROM accounting.cost_dictionary_entry WHERE dictionary_id = $1 GROUP BY nhom1, ten_nhom1 ORDER BY nhom1', [d.id])).rows;
    return {
      exists: true, version: d.version, entryCount: d.entry_count, sourceFileName: d.source_file_name,
      importedBy: d.imported_by_name, importedAt: d.imported_at,
      groups: groups.map((g) => ({ nhom1: g.nhom1, tenNhom1: g.ten_nhom1, count: Number(g.n) })),
    };
  });
}

// ---- dispatch ---------------------------------------------------
const HANDLERS = {
  'accounting.uploadPreview': uploadPreview,
  'accounting.confirm': confirmImport,
  'accounting.status': status,
  'accounting.preview': preview,
  'accounting.listNormalized': listNormalized,
  'accounting.listRules': (config) => listRules(config),
  'accounting.importDictionary': importDictionary,
  'accounting.dictionaryStatus': (config) => dictionaryStatus(config),
};
const ACTIONS = Object.freeze(Object.keys(HANDLERS));
async function dispatch(config, actor, action, params) {
  const h = HANDLERS[action];
  if (!h) throw aErr('ACCOUNTING_ACTION_UNKNOWN', 'Hành động accounting không hợp lệ: ' + action, 400);
  return h(config, actor, params || {});
}

module.exports = { dispatch, ACTIONS, HANDLERS, AccountingError };
