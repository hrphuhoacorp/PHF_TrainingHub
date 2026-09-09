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
function round0(x) { return Math.round(Number(x) || 0); }
function decodeBase64Xlsx(b64) {
  if (!b64) throw aErr('ACCOUNTING_FILE_REQUIRED', 'Chưa có file để xử lý.', 400);
  let buf;
  try { buf = Buffer.from(String(b64), 'base64'); } catch (_) { throw aErr('ACCOUNTING_FILE_BASE64', 'Nội dung file không hợp lệ.', 400); }
  if (buf.length < 4 || buf.readUInt16LE(0) !== 0x4b50) throw aErr('ACCOUNTING_NOT_XLSX', 'File không phải .xlsx hợp lệ.', 400);
  return buf;
}

// ---- classification rules (DB with SEED fallback) ----------------------
function ruleCols() {
  // v2 columns (origin/cost_code/...) may not exist yet on a v1-only DB — probe once.
  return 'id, priority, match_kind, match_value, action, note, rule_version, is_active'
    + ", COALESCE(origin,'seed') AS origin, cost_code, cost_code_name";
}
async function loadRules(config) {
  try {
    let r;
    try {
      r = await readTx(config, (c) => c.query(
        'SELECT ' + ruleCols() + ' FROM accounting.classification_rule WHERE is_active = true ORDER BY priority, id'));
    } catch (e) {
      if (String(e && e.message || '').includes('origin')) {
        r = await readTx(config, (c) => c.query(
          'SELECT id, priority, match_kind, match_value, action, note, rule_version, is_active FROM accounting.classification_rule WHERE is_active = true ORDER BY priority, id'));
      } else throw e;
    }
    if (r.rows.length) {
      return r.rows.map((x) => ({
        id: x.id, priority: x.priority, matchKind: x.match_kind,
        matchValue: typeof x.match_value === 'string' ? JSON.parse(x.match_value) : x.match_value,
        action: x.action, note: x.note, ruleVersion: x.rule_version, isActive: x.is_active,
        origin: x.origin || 'seed', costCode: x.cost_code || null, costCodeName: x.cost_code_name || null,
      }));
    }
  } catch (e) { if (String(e && e.code) !== 'ACCOUNTING_SCHEMA_MISSING') throw e; }
  return SEED_RULES.map((r) => Object.assign({ origin: 'seed' }, r));
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

    const hasV2 = await c.query("SELECT 1 FROM information_schema.columns WHERE table_schema='accounting' AND table_name='normalized' AND column_name='decision_source'").then((x) => x.rowCount > 0);
    for (const row of funnel.normalizedRows) {
      const rs = row.costCode ? 'RESOLVED' : 'UNRESOLVED';
      if (hasV2) {
        await c.query(
          `INSERT INTO accounting.normalized
            (file_id, period_month, source_row_index, ngay_ct, ma_ct, so_ct, ma_khach, ten_khach, dien_giai,
             tai_khoan, tk_doi_ung, phat_sinh_no, ma_bp, ma_bp_out_of_master,
             classification, classified_by_rule_id, rule_version, cost_code, cost_code_status, decision_source, warnings)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
          [file.id, pm, row.sourceRowIndex, row.ngayCt || null, row.maCt || null, row.soCt || null, row.maKhach || null, row.tenKhach || null, row.dienGiai || null,
           row.taiKhoan, row.tkDoiUng || null, row.phatSinhNo, row.maBp || null, !!row.maBpOutOfMaster,
           row.classification, row.classifiedByRuleId || null, rep.meta.ruleVersion, row.costCode || null, rs, row.decisionSource || 'engine', JSON.stringify(row.warnings || [])]);
      } else {
        await c.query(
          `INSERT INTO accounting.normalized
            (file_id, period_month, source_row_index, ngay_ct, ma_ct, so_ct, ma_khach, ten_khach, dien_giai,
             tai_khoan, tk_doi_ung, phat_sinh_no, ma_bp, ma_bp_out_of_master,
             classification, classified_by_rule_id, rule_version, cost_code_status, warnings)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [file.id, pm, row.sourceRowIndex, row.ngayCt || null, row.maCt || null, row.soCt || null, row.maKhach || null, row.tenKhach || null, row.dienGiai || null,
           row.taiKhoan, row.tkDoiUng || null, row.phatSinhNo, row.maBp || null, !!row.maBpOutOfMaster,
           row.classification, row.classifiedByRuleId || null, rep.meta.ruleVersion, rs, JSON.stringify(row.warnings || [])]);
      }
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
    const live = await recount(c, file.id);
    return { exists: true, fileId: file.id, version: file.version, status: file.status, report: file.report, live };
  });
}

// ---- OPERATOR DECISION LAYER V2 -----------------------------------------
async function hasNormalizedV2(c) {
  const r = await c.query("SELECT 1 FROM information_schema.columns WHERE table_schema='accounting' AND table_name='normalized' AND column_name='decision_source'");
  return r.rowCount > 0;
}
async function hasRuleV2(c) {
  const r = await c.query("SELECT 1 FROM information_schema.columns WHERE table_schema='accounting' AND table_name='classification_rule' AND column_name='origin'");
  return r.rowCount > 0;
}

// live funnel recount straight from accounting.normalized for one file — the
// §8 reconciliation surface. INCLUDE + EXCLUDE + NEEDS_REVIEW === costScope,
// always, for both rows and amounts.
async function recount(c, fileId) {
  const ds = await hasNormalizedV2(c);
  const g = (await c.query(
    `SELECT classification, count(*) n, COALESCE(SUM(phat_sinh_no),0)::numeric amt
       FROM accounting.normalized WHERE file_id = $1 GROUP BY classification`, [fileId])).rows;
  const by = { INCLUDE: { n: 0, amt: 0 }, EXCLUDE: { n: 0, amt: 0 }, NEEDS_REVIEW: { n: 0, amt: 0 } };
  for (const x of g) by[x.classification] = { n: Number(x.n), amt: Number(x.amt) };
  const decided = ds
    ? Number((await c.query("SELECT count(*) n FROM accounting.normalized WHERE file_id = $1 AND decision_source LIKE 'operator%'", [fileId])).rows[0].n)
    : 0;
  const totalRows = by.INCLUDE.n + by.EXCLUDE.n + by.NEEDS_REVIEW.n;
  const totalAmt = round0(by.INCLUDE.amt + by.EXCLUDE.amt + by.NEEDS_REVIEW.amt);
  return {
    totals: { costScopeRows: totalRows, included: by.INCLUDE.n, excluded: by.EXCLUDE.n, needsReview: by.NEEDS_REVIEW.n, operatorDecided: decided },
    amounts: { costScope: totalAmt, included: round0(by.INCLUDE.amt), excluded: round0(by.EXCLUDE.amt), needsReview: round0(by.NEEDS_REVIEW.amt) },
    reconciles: (by.INCLUDE.n + by.EXCLUDE.n + by.NEEDS_REVIEW.n) === totalRows,
  };
}

async function syncFileCounters(c, fileId) {
  const r = await recount(c, fileId);
  await c.query(
    `UPDATE accounting.import_file SET
       cost_scope_row_count = $2, included_row_count = $3, excluded_row_count = $4, needs_review_row_count = $5,
       included_amount = $6, needs_review_amount = $7, excluded_amount = $8
     WHERE id = $1`,
    [fileId, r.totals.costScopeRows, r.totals.included, r.totals.excluded, r.totals.needsReview,
     r.amounts.included, r.amounts.needsReview, r.amounts.excluded]);
  return r;
}

// categories for an INCLUDE decision — the imported Cost Dictionary D/E groups
// (641* vs 642*). NEVER a parallel taxonomy: if no dictionary is imported the
// list is empty and the UI must say so.
async function listCategories(config, actor, params) {
  const acctPrefix = String((params && params.account) || '').slice(0, 3);
  return readTx(config, async (c) => {
    const d = (await c.query('SELECT id, version FROM accounting.cost_dictionary WHERE is_current = true')).rows[0];
    if (!d) return { hasDictionary: false, categories: [] };
    const rows = (await c.query(
      `SELECT ma_phi, ten_phi, nhom1, ten_nhom1, nhom2, ten_nhom2
         FROM accounting.cost_dictionary_entry
        WHERE dictionary_id = $1 AND nhom1 IN ('D','E')
        ORDER BY ma_phi`, [d.id])).rows;
    const wantGroup = acctPrefix === '641' ? 'D' : acctPrefix === '642' ? 'E' : null;
    const cats = rows
      .filter((r) => !wantGroup || r.nhom1 === wantGroup)
      .map((r) => ({ maPhi: r.ma_phi, tenPhi: r.ten_phi, group: r.nhom1, groupName: r.ten_nhom1, sub: r.ten_nhom2 }));
    return { hasDictionary: true, dictionaryVersion: d.version, filteredBy: wantGroup, categories: cats };
  });
}

function ruleSignature(account, tokens) {
  const key = String(account).trim() + '|' + tokens.slice().sort().join(' ');
  return crypto.createHash('sha1').update(key).digest('hex');
}

// The core action. { fileId, sourceRowIndexes:[...], decision:'INCLUDE'|'EXCLUDE',
//   costCode?, costCodeName?, note?, remember?:bool, matchText? }
// - Always records an append-only item_decision per row and updates that row's
//   classification (decision_source='operator_item').
// - If remember: builds a deterministic combo rule (account_exact + description
//   allTokens from matchText, default = the row's own description), stores it
//   (origin='operator') + rule_history, and RE-APPLIES it to every still-
//   NEEDS_REVIEW row in this file that deterministically matches
//   (decision_source='operator_rule').
async function decideItem(config, actor, params) {
  const fileId = String((params && params.fileId) || '');
  if (!fileId) throw aErr('ACCOUNTING_FILE_ID_REQUIRED', 'Thiếu fileId.', 400);
  const decision = String((params && params.decision) || '').toUpperCase();
  if (decision !== 'INCLUDE' && decision !== 'EXCLUDE') throw aErr('ACCOUNTING_DECISION_INVALID', 'Quyết định phải là INCLUDE hoặc EXCLUDE.', 400);
  let idxs = params && (params.sourceRowIndexes || params.sourceRowIndex);
  idxs = Array.isArray(idxs) ? idxs.map(Number).filter(Number.isFinite) : (Number.isFinite(Number(idxs)) ? [Number(idxs)] : []);
  if (!idxs.length) throw aErr('ACCOUNTING_ROWS_REQUIRED', 'Chưa chọn khoản nào.', 400);
  const remember = (params && params.remember) === true;
  const costCode = decision === 'INCLUDE' ? (params && params.costCode ? String(params.costCode).trim() : null) : null;
  const costCodeName = params && params.costCodeName ? String(params.costCodeName).trim() : null;
  const note = params && params.note ? String(params.note).slice(0, 500) : null;
  const [aid, aname] = actorCols(actor);
  const { normalizeDesc, descTokens } = require('./qtth-accounting-classify');

  return writeTx(config, async (c) => {
    const v2n = await hasNormalizedV2(c);
    const v2r = await hasRuleV2(c);
    if (!v2n || !v2r) throw aErr('ACCOUNTING_V2_MISSING', 'Lớp quyết định (V2) chưa được cài đặt (migrations/phf_hr_qtth_accounting_v2.sql).', 503);

    const file = (await c.query('SELECT * FROM accounting.import_file WHERE id = $1 FOR UPDATE', [fileId])).rows[0];
    if (!file) throw aErr('ACCOUNTING_FILE_NOT_FOUND', 'Không tìm thấy phiên bản.', 404);

    const rows = (await c.query(
      `SELECT * FROM accounting.normalized WHERE file_id = $1 AND source_row_index = ANY($2::int[])`, [fileId, idxs])).rows;
    if (!rows.length) throw aErr('ACCOUNTING_ROW_NOT_FOUND', 'Không tìm thấy khoản đã chọn.', 404);
    const account = rows[0].tai_khoan;
    if (!rows.every((r) => r.tai_khoan === account)) {
      throw aErr('ACCOUNTING_MIXED_ACCOUNT', 'Chỉ quyết định cho các khoản cùng một tài khoản mỗi lần.', 400);
    }

    let rememberedRuleId = null;
    let ruleAffected = 0;
    if (remember) {
      const matchText = (params && params.matchText ? String(params.matchText) : rows[0].dien_giai) || '';
      const tokens = descTokens(matchText);
      if (tokens.length < 1) throw aErr('ACCOUNTING_PATTERN_EMPTY', 'Không có nội dung để ghi nhớ — nhập cụm nội dung nhận diện.', 400);
      const sig = ruleSignature(account, tokens);
      const existing = (await c.query('SELECT * FROM accounting.classification_rule WHERE match_signature = $1', [sig])).rows[0];
      const matchValue = { all: [
        { matchKind: 'account_exact', matchValue: { accounts: [account] } },
        { matchKind: 'description', matchValue: { allTokens: tokens } },
      ] };
      const noteText = 'Ghi nhớ: tài khoản ' + account + ' + nội dung có "' + normalizeDesc(matchText) + '"';
      if (existing) {
        if (existing.action !== decision) {
          throw aErr('ACCOUNTING_RULE_CONFLICT',
            'Đã có quy tắc ghi nhớ khác (' + (existing.action === 'INCLUDE' ? 'Đưa vào' : 'Không đưa vào') + ') cho cùng nội dung này. '
            + 'Hãy mở "Quy tắc đã ghi nhớ" để xem lại trước khi ghi quyết định khác.', 409);
        }
        rememberedRuleId = existing.id;
        if (!existing.is_active) {
          await c.query('UPDATE accounting.classification_rule SET is_active = true WHERE id = $1', [existing.id]);
          await logRule(c, existing.id, 'enable', existing, 'Bật lại khi ghi nhớ quyết định', aid, aname);
        }
      } else {
        rememberedRuleId = 'op-' + sig.slice(0, 12);
        await c.query(
          `INSERT INTO accounting.classification_rule
             (id, priority, match_kind, match_value, action, note, rule_version, is_active, origin, cost_code, cost_code_name, created_from, match_signature, created_by_account_id, created_by_name)
           VALUES ($1, 15, 'combo', $2, $3, $4, 'v2', true, 'operator', $5, $6, $7, $8, $9, $10)`,
          [rememberedRuleId, JSON.stringify(matchValue), decision, noteText, costCode, costCodeName, null, sig, aid, aname]);
        const snap = (await c.query('SELECT * FROM accounting.classification_rule WHERE id = $1', [rememberedRuleId])).rows[0];
        await logRule(c, rememberedRuleId, 'create', snap, note, aid, aname);
      }
      // re-apply the remembered rule to every still-NEEDS_REVIEW row in this file
      // that deterministically matches (same account + all tokens present).
      const candidates = (await c.query(
        "SELECT * FROM accounting.normalized WHERE file_id = $1 AND tai_khoan = $2 AND classification = 'NEEDS_REVIEW'", [fileId, account])).rows;
      for (const cand of candidates) {
        const have = new Set(descTokens(cand.dien_giai || ''));
        if (!tokens.every((t) => have.has(t))) continue;
        await c.query(
          `UPDATE accounting.normalized SET classification = $2, classified_by_rule_id = $3,
             cost_code = $4, cost_code_status = $5, decision_source = 'operator_rule' WHERE id = $1`,
          [cand.id, decision, rememberedRuleId, costCode, costCode ? 'RESOLVED' : 'UNRESOLVED']);
        ruleAffected++;
      }
    }

    // always: explicit per-row decision (append-only log + row update)
    for (const r of rows) {
      await c.query(
        `INSERT INTO accounting.item_decision
           (import_id, file_id, period_month, source_row_index, tai_khoan, dien_giai, phat_sinh_no,
            decision, cost_code, cost_code_name, remembered_rule_id, note, decided_by_account_id, decided_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [file.import_id, fileId, r.period_month, r.source_row_index, r.tai_khoan, r.dien_giai, r.phat_sinh_no,
         decision, costCode, costCodeName, rememberedRuleId, note, aid, aname]);
      await c.query(
        `UPDATE accounting.normalized SET classification = $2, cost_code = $3, cost_code_status = $4,
           classified_by_rule_id = $5, decision_source = 'operator_item' WHERE id = $1`,
        [r.id, decision, costCode, costCode ? 'RESOLVED' : 'UNRESOLVED', rememberedRuleId]);
    }

    const live = await syncFileCounters(c, fileId);
    return {
      fileId, account, decided: rows.length, decision, costCode,
      remembered: !!rememberedRuleId, rememberedRuleId, ruleAlsoAppliedTo: ruleAffected,
      live,
    };
  });
}

async function logRule(c, ruleId, action, snapshotRow, reason, aid, aname) {
  await c.query(
    `INSERT INTO accounting.rule_history (rule_id, action, snapshot, reason, changed_by_account_id, changed_by_name)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [ruleId, action, JSON.stringify(snapshotRow || {}), reason || null, aid || null, aname || null]);
}

async function listRememberedRules(config) {
  return readTx(config, async (c) => {
    if (!(await hasRuleV2(c))) return { rules: [] };
    const r = (await c.query(
      `SELECT id, match_value, action, note, cost_code, cost_code_name, is_active, created_by_name, created_at, updated_at
         FROM accounting.classification_rule WHERE origin = 'operator' ORDER BY created_at DESC`)).rows;
    return {
      rules: r.map((x) => {
        const mv = typeof x.match_value === 'string' ? JSON.parse(x.match_value) : x.match_value;
        const acc = (((mv.all || []).find((s) => s.matchKind === 'account_exact') || {}).matchValue || {}).accounts || [];
        const tok = (((mv.all || []).find((s) => s.matchKind === 'description') || {}).matchValue || {}).allTokens || [];
        return {
          id: x.id, account: acc[0] || '', matchTokens: tok, matchText: tok.join(' '),
          decision: x.action, costCode: x.cost_code || null, costCodeName: x.cost_code_name || null,
          isActive: x.is_active, createdByName: x.created_by_name || '', createdAt: x.created_at, updatedAt: x.updated_at,
        };
      }),
    };
  });
}

async function ruleHistory(config, actor, params) {
  const ruleId = String((params && params.ruleId) || '');
  return readTx(config, async (c) => {
    const r = (await c.query(
      'SELECT action, snapshot, reason, changed_by_name, changed_at FROM accounting.rule_history WHERE rule_id = $1 ORDER BY changed_at DESC LIMIT 100', [ruleId])).rows;
    return { ruleId, entries: r.map((x) => ({ action: x.action, reason: x.reason, changedByName: x.changed_by_name || '', changedAt: x.changed_at })) };
  });
}

// enable / disable a remembered rule. Disabling does NOT retro-revert rows
// already classified by it in a CONFIRMED version (history is preserved); it
// stops the rule from firing on future imports / re-previews, and reverts any
// still-previewed rows it set back to NEEDS_REVIEW.
async function setRuleActive(config, actor, params) {
  const ruleId = String((params && params.ruleId) || '');
  const isActive = (params && params.isActive) === true;
  const reason = params && params.reason ? String(params.reason).slice(0, 300) : null;
  const [aid, aname] = actorCols(actor);
  if (!ruleId) throw aErr('ACCOUNTING_RULE_ID_REQUIRED', 'Thiếu ruleId.', 400);
  return writeTx(config, async (c) => {
    if (!(await hasRuleV2(c))) throw aErr('ACCOUNTING_V2_MISSING', 'Lớp quyết định (V2) chưa được cài đặt.', 503);
    const rule = (await c.query("SELECT * FROM accounting.classification_rule WHERE id = $1 AND origin = 'operator' FOR UPDATE", [ruleId])).rows[0];
    if (!rule) throw aErr('ACCOUNTING_RULE_NOT_FOUND', 'Không tìm thấy quy tắc đã ghi nhớ.', 404);
    if (rule.is_active === isActive) return { ruleId, isActive, changed: false };
    await c.query('UPDATE accounting.classification_rule SET is_active = $2 WHERE id = $1', [ruleId, isActive]);
    const snap = (await c.query('SELECT * FROM accounting.classification_rule WHERE id = $1', [ruleId])).rows[0];
    await logRule(c, ruleId, isActive ? 'enable' : 'disable', snap, reason, aid, aname);
    let reverted = 0;
    if (!isActive) {
      const upd = await c.query(
        `UPDATE accounting.normalized n SET classification = 'NEEDS_REVIEW', cost_code = NULL, cost_code_status = 'UNRESOLVED',
           classified_by_rule_id = NULL, decision_source = 'engine'
         FROM accounting.import_file f
         WHERE n.file_id = f.id AND f.status = 'previewed'
           AND n.classified_by_rule_id = $1 AND n.decision_source = 'operator_rule'`, [ruleId]);
      reverted = upd.rowCount;
      const files = (await c.query(
        "SELECT DISTINCT n.file_id FROM accounting.normalized n JOIN accounting.import_file f ON f.id = n.file_id WHERE f.status = 'previewed'")).rows;
      for (const f of files) await syncFileCounters(c, f.file_id);
    }
    return { ruleId, isActive, changed: true, previewRowsReverted: reverted };
  });
}

async function listNormalized(config, actor, params) {
  const pm = period(params && params.periodMonth);
  const cls = params && params.classification;
  const account = params && params.account ? String(params.account).trim() : null;
  return readTx(config, async (c) => {
    const imp = (await c.query('SELECT * FROM accounting.import WHERE period_month = $1', [pm])).rows[0];
    if (!imp) return { periodMonth: pm, version: null, status: null, rows: [] };
    // Prefer the confirmed current version; before confirm, fall back to the
    // latest previewed version so the Operator can review NEEDS_REVIEW evidence
    // line-by-line BEFORE deciding to confirm.
    let file = imp.current_file_id
      ? (await c.query('SELECT id, version, status FROM accounting.import_file WHERE id = $1', [imp.current_file_id])).rows[0]
      : (await c.query("SELECT id, version, status FROM accounting.import_file WHERE import_id = $1 ORDER BY (status='previewed') DESC, version DESC LIMIT 1", [imp.id])).rows[0];
    if (!file) return { periodMonth: pm, version: null, status: null, rows: [] };
    const conds = ['file_id = $1'];
    const vals = [file.id];
    if (cls && ['INCLUDE', 'EXCLUDE', 'NEEDS_REVIEW'].indexOf(cls) >= 0) { vals.push(cls); conds.push('classification = $' + vals.length); }
    if (account) { vals.push(account); conds.push('tai_khoan = $' + vals.length); }
    const dsCol = await hasNormalizedV2(c);
    const r = (await c.query(
      `SELECT source_row_index,
              to_char(ngay_ct, 'DD/MM/YYYY') AS ngay_ct, ngay_ct AS ngay_ct_iso,
              ma_ct, so_ct, ma_khach, ten_khach, dien_giai, tai_khoan, tk_doi_ung,
              phat_sinh_no, ma_bp, ma_bp_out_of_master, classification, classified_by_rule_id,
              cost_code, cost_code_status${dsCol ? ', decision_source' : ''}, warnings
       FROM accounting.normalized WHERE ${conds.join(' AND ')} ORDER BY tai_khoan, source_row_index LIMIT 5000`, vals)).rows;
    return {
      periodMonth: pm, version: file.version, status: file.status, isConfirmed: file.status === 'confirmed', rowCount: r.length,
      rows: r.map((x) => ({
        sourceRowIndex: x.source_row_index, ngayCt: x.ngay_ct, ngayCtIso: x.ngay_ct_iso, maCt: x.ma_ct, soCt: x.so_ct,
        maKhach: x.ma_khach, tenKhach: x.ten_khach, dienGiai: x.dien_giai,
        taiKhoan: x.tai_khoan, tkDoiUng: x.tk_doi_ung, phatSinhNo: Number(x.phat_sinh_no),
        maBp: x.ma_bp, maBpOutOfMaster: x.ma_bp_out_of_master,
        classification: x.classification, ruleId: x.classified_by_rule_id,
        costCode: x.cost_code || null, costCodeStatus: x.cost_code_status,
        decisionSource: x.decision_source || 'engine',
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
  'accounting.listCategories': listCategories,
  'accounting.decideItem': decideItem,
  'accounting.listRememberedRules': (config) => listRememberedRules(config),
  'accounting.ruleHistory': ruleHistory,
  'accounting.setRuleActive': setRuleActive,
};
const ACTIONS = Object.freeze(Object.keys(HANDLERS));
async function dispatch(config, actor, action, params) {
  const h = HANDLERS[action];
  if (!h) throw aErr('ACCOUNTING_ACTION_UNKNOWN', 'Hành động accounting không hợp lệ: ' + action, 400);
  return h(config, actor, params || {});
}

module.exports = { dispatch, ACTIONS, HANDLERS, AccountingError };
