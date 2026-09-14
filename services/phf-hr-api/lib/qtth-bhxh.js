'use strict';

// PHF HR — QTTH Truth Data · BHXH (chi phí BHXH doanh nghiệp) · phf-hr-api service.
//
// XLSX -> Upload -> Validate -> Normalize -> Preview (period-mismatch evidence
// surfaced, NEVER silently resolved) -> Admin acknowledges period (if
// mismatched) -> Xác nhận nhập dữ liệu -> RAW + NORMALIZED + VERSION/DELTA/AUDIT.
// Missing/malformed employee_code rows are NEVER dropped — persisted with
// classification=NEEDS_REVIEW, resolvable later via mapIdentity (append-only
// audit trail), amount always visible in reconciliation.
//
// Company PostgreSQL phf_hr / schema bhxh ONLY (dev/throwaway: phf_hr_e2e).
// employer_cost_source is verbatim from source column "TK 642 (21.5%)" —
// never recalculated, never inferred from TK334/employee-side columns.

const crypto = require('crypto');
const { withTaskReadTransaction, withTaskWriteTransaction } = require('./db');
const { readWorkbook } = require('./xlsx-lite');
const TPL = require('./qtth-bhxh-template');
const { normalizeGrid, diffVersions } = require('./qtth-bhxh-normalize');
const storage = require('./qtth-bhxh-storage');

class BhxhError extends Error {
  constructor(code, message, statusCode) { super(message || code); this.code = code; this.statusCode = statusCode || 400; this.isBhxhError = true; }
}
function bErr(code, message, statusCode) { return new BhxhError(code, message, statusCode); }
function mapPg(e) {
  const c = String((e && e.code) || '');
  if (c === '23505') return bErr('BHXH_DUPLICATE', 'Bản ghi trùng.', 409);
  if (c === '42P01' || c === '3F000') return bErr('BHXH_SCHEMA_MISSING', 'Schema bhxh chưa được cài đặt (migrations/phf_hr_qtth_bhxh_v1.sql).', 503);
  if (c === '42501') return bErr('BHXH_PERMISSION_DENIED', 'Thiếu quyền CSDL bhxh.', 500);
  return null;
}
async function readTx(config, fn) { try { return await withTaskReadTransaction(config, fn); } catch (e) { throw mapPg(e) || e; } }
async function writeTx(config, fn) { try { return await withTaskWriteTransaction(config, fn); } catch (e) { throw mapPg(e) || e; } }

function period(p) { const s = String(p || '').trim(); if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(s)) throw bErr('BHXH_PERIOD_INVALID', 'Kỳ BHXH phải theo YYYY-MM.', 400); return s; }
// normalized name key for identity-registry carry-forward matching — reuses
// the same diacritics-insensitive normalizer the template uses for headers.
function matchKey(name) { return TPL.norm(name); }

// "match chắc -> auto; không chắc -> Admin xác nhận" (locked identity rule).
// Mutates NEEDS_REVIEW records in place: exactly one active registry hit for
// the row's normalized full_name auto-resolves it (classification, identity
// kind/target, department/branch inherited only when this period's own
// source is blank); zero or >1 hits (name collision) leave it untouched —
// never guessed. Must run BEFORE totals/report are computed so counts
// reflect the final, post-memory state.
async function applyIdentityMemory(config, records) {
  const candidates = records.filter((r) => r.classification === 'NEEDS_REVIEW' && r.fullName);
  if (!candidates.length) return;
  const keys = Array.from(new Set(candidates.map((r) => matchKey(r.fullName))));
  const rows = await readTx(config, (c) => c.query(
    "SELECT * FROM bhxh.identity_registry WHERE status = 'active' AND match_key = ANY($1)", [keys]));
  const byKey = new Map();
  for (const reg of rows.rows) {
    if (!byKey.has(reg.match_key)) byKey.set(reg.match_key, []);
    byKey.get(reg.match_key).push(reg);
  }
  for (const r of candidates) {
    const hits = byKey.get(matchKey(r.fullName)) || [];
    r.identityKind = null; r.localIdentityId = null; r.identityAutoResolved = false;
    if (hits.length === 1) {
      const reg = hits[0];
      r.classification = 'MATCHED'; r.reviewReason = null;
      r.identityKind = reg.kind; r.identityAutoResolved = true;
      if (reg.kind === 'employee_code') { r.employeeCode = reg.employee_code; }
      else { r.employeeCode = null; r.localIdentityId = reg.id; }
      if (!r.fields.source_department && reg.last_department) r.fields.source_department = reg.last_department;
      if (!r.fields.source_branch && reg.last_branch) r.fields.source_branch = reg.last_branch;
    }
    // hits.length === 0 -> genuinely new, stays NEEDS_REVIEW.
    // hits.length > 1   -> name collision across identities, stays NEEDS_REVIEW.
  }
}
function actorCols(a) { return [String(a && a.accountId || '') || null, String(a && (a.displayName || a.employeeCode) || '') || null]; }
function n(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
function round2(x) { return Math.round(x * 100) / 100; }

function looksMojibake(rows) {
  const head = rows.slice(0, 12).map((r) => r.join(' ')).join(' ');
  return /Ã.|Ä.|á»|â€|Æ°/.test(head) && !/Ổ|Ầ|Ự|Ế/.test(head);
}
function demojibake(rows) {
  return rows.map((r) => r.map((c) => { try { return Buffer.from(String(c), 'latin1').toString('utf8'); } catch (_) { return c; } }));
}
function parseWorkbookBuffer(buffer) {
  const wb = readWorkbook(buffer);
  let sheet = wb.sheets.find((s) => /TONG.?BHXH|TỔNG.?BHXH/i.test(s.name));
  if (!sheet) sheet = wb.sheets[0];
  let rows = sheet.rows;
  if (looksMojibake(rows)) rows = demojibake(rows);
  return { sheetName: sheet.name, rows };
}

function diffKey(rec) { return rec.employeeCode || ('row:' + rec.sourceRowIndex); }

// Locked versioning contract: every row in the new upload classifies as
// exactly one of UNCHANGED / CHANGED / NEW / MISSING against the current
// confirmed version (compared by stable natural key = employee_code, or
// source_row_index when the code itself is unresolved). UNCHANGED rows are
// never listed as noise; CHANGED carries field-level before/after; NEW and
// MISSING are always explicit (never silently dropped).
function buildVersionDiffReport(prev, nextRecords, vdiff) {
  if (!prev) {
    return {
      isFirstVersion: true, previousVersion: null,
      unchanged: [], added: nextRecords.map((r) => ({ employeeCode: r.employeeCode, sourceRowIndex: r.sourceRowIndex })),
      changed: [], missing: [],
    };
  }
  const addedKeys = new Set(vdiff.added.map((d) => d.key));
  const changedByKey = new Map();
  for (const d of vdiff.deltas) {
    if (d.changeType !== 'changed') continue;
    if (!changedByKey.has(d.key)) changedByKey.set(d.key, { employeeCode: d.employeeCode, sourceRowIndex: d.sourceRowIndex, changes: [] });
    changedByKey.get(d.key).changes.push({ field: d.field, before: d.before == null ? null : d.before, after: d.after == null ? null : d.after });
  }
  const unchanged = [];
  for (const r of nextRecords) {
    const key = diffKey(r);
    if (addedKeys.has(key) || changedByKey.has(key)) continue;
    unchanged.push({ employeeCode: r.employeeCode, sourceRowIndex: r.sourceRowIndex });
  }
  return {
    isFirstVersion: false, previousVersion: prev.version,
    unchanged,
    added: vdiff.added.map((d) => ({ employeeCode: d.employeeCode, sourceRowIndex: d.sourceRowIndex })),
    changed: [...changedByKey.values()],
    missing: vdiff.missing.map((m) => ({ employeeCode: m.employeeCode, sourceRowIndex: m.sourceRowIndex })),
  };
}

// Period-in-content evidence (locked adjustment #2). Never throws, never
// blocks — only ever supplies evidence the caller compares to the
// Operator-selected period.
function parseSourcePeriod(rows) {
  const head = rows.slice(0, 8).map((r) => r.join(' ')).join(' \n ');
  const m = head.match(/TH[ÁA]NG\s*(0[1-9]|1[0-2])\s*\/\s*(20\d{2})/i);
  if (!m) return { sourcePeriodLabel: null, sourcePeriodMonth: null };
  return { sourcePeriodLabel: 'THÁNG ' + m[1] + '/' + m[2], sourcePeriodMonth: m[2] + '-' + m[1] };
}

// ---- VALIDATE + PREVIEW ----------------------------------------------------
async function validatePreview(config, actor, params) {
  const pm = period(params && params.periodMonth);
  const fileName = String((params && params.fileName) || 'bhxh.xlsx').slice(0, 200);
  const b64 = String((params && params.fileBase64) || '');
  if (!b64) throw bErr('BHXH_FILE_REQUIRED', 'Chưa có file để kiểm tra.', 400);
  let buffer;
  try { buffer = Buffer.from(b64, 'base64'); } catch (_) { throw bErr('BHXH_FILE_BASE64', 'Nội dung file không hợp lệ.', 400); }
  if (buffer.length < 4 || buffer.readUInt16LE(0) !== 0x4b50) throw bErr('BHXH_NOT_XLSX', 'File không phải .xlsx hợp lệ.', 400);
  const knownCodes = new Set((Array.isArray(params && params.knownEmployeeCodes) ? params.knownEmployeeCodes : []).map((c) => String(c).toUpperCase()));

  let grid;
  try { grid = parseWorkbookBuffer(buffer); }
  catch (e) { throw bErr(e.code || 'BHXH_PARSE_FAILED', e.message || 'Không đọc được file .xlsx.', 400); }

  const fp = TPL.fingerprint(grid.rows);
  if (!fp.columnMap) throw bErr('BHXH_HEADER_NOT_FOUND', 'Không tìm thấy hàng tiêu đề BHXH (ID / Họ và tên).', 400);

  const nm = normalizeGrid(grid.rows, fp.columnMap, fp.totalRow, knownCodes);
  if (!nm.ok) throw bErr('BHXH_NORMALIZE_FAILED', 'Không chuẩn hóa được dữ liệu.', 400);

  await applyIdentityMemory(config, nm.records);
  // recompute post-memory: some NEEDS_REVIEW rows may have auto-resolved above
  const stillReview = nm.records.filter((r) => r.classification === 'NEEDS_REVIEW');
  nm.needsReviewCount = stillReview.length;
  nm.needsReviewAmount = Math.round(stillReview.reduce((s, x) => s + (x.employerCostSource || 0), 0) * 100) / 100;
  const autoResolvedCount = nm.records.filter((r) => r.identityAutoResolved).length;

  const srcPeriod = parseSourcePeriod(grid.rows);
  const periodMismatch = !!(srcPeriod.sourcePeriodMonth && srcPeriod.sourcePeriodMonth !== pm);

  const sourceTotal = fp.totalRow ? fp.totalRow.sourceTotalEmployerCost : null;
  const computedTotal = nm.employerCostTotal;
  const reconciled = sourceTotal != null ? Math.abs(sourceTotal - computedTotal) < 1 : null;

  const unknownCodes = knownCodes.size
    ? nm.records.filter((r) => r.employeeCode && !knownCodes.has(r.employeeCode)).map((r) => r.employeeCode)
    : [];
  const dupInFile = nm.fileWarnings.filter((w) => w.type === 'DUPLICATE_EMPLOYEE_IN_FILE');

  const prev = await loadActiveNormalized(config, pm);
  const vdiff = prev ? diffVersions(prev.records, nm.records) : { deltas: [], missing: [], added: nm.records.map((r) => ({ employeeCode: r.employeeCode })) };

  const sha = crypto.createHash('sha256').update(buffer).digest('hex');

  const report = {
    periodMonth: pm, fileName, sha256: sha, byteSize: buffer.length, sheetName: grid.sheetName,
    templateFingerprint: fp.fingerprint, columnMap: fp.columnMap, missingColumns: fp.missingCore || [],
    periodMismatch: {
      selectedPeriod: pm,
      sourcePeriodLabel: srcPeriod.sourcePeriodLabel,
      sourcePeriodMonth: srcPeriod.sourcePeriodMonth,
      filenameEvidence: fileName,
      mismatch: periodMismatch,
    },
    employerCost: {
      sourceTotal, computedTotal, reconciled,
      needsReviewCount: nm.needsReviewCount, needsReviewAmount: nm.needsReviewAmount,
    },
    totals: {
      rows: nm.rowCount,
      matched: nm.rowCount - nm.needsReviewCount,
      needsReview: nm.needsReviewCount,
      autoResolvedFromMemory: autoResolvedCount,
      unknownEmployeeCodes: unknownCodes,
      duplicateInFile: dupInFile,
    },
    versionDiff: buildVersionDiffReport(prev, nm.records, vdiff),
  };

  const [aid, aname] = actorCols(actor);
  const persisted = await writeTx(config, async (c) => {
    let imp = (await c.query("SELECT * FROM bhxh.import WHERE period_month = $1", [pm])).rows[0];
    if (!imp) imp = (await c.query(
      "INSERT INTO bhxh.import (period_month, created_by_account_id, created_by_name) VALUES ($1,$2,$3) RETURNING *", [pm, aid, aname])).rows[0];

    const existing = (await c.query(
      "SELECT * FROM bhxh.import_file WHERE import_id = $1 AND sha256 = $2", [imp.id, sha])).rows[0];
    if (existing) {
      await c.query(
        `UPDATE bhxh.import_file SET validation = $2, row_count = $3, warning_count = $4, template_fingerprint = $5,
          source_period_label = $6, source_period_month = $7, period_mismatch = $8,
          source_total_employer_cost = $9, computed_total_employer_cost = $10, employer_cost_reconciled = $11,
          needs_review_row_count = $12, needs_review_amount = $13, uploaded_at = now()
         WHERE id = $1`,
        [existing.id, report, nm.rowCount, unknownCodes.length + dupInFile.length, fp.fingerprint,
         srcPeriod.sourcePeriodLabel, srcPeriod.sourcePeriodMonth, periodMismatch,
         sourceTotal, computedTotal, reconciled, nm.needsReviewCount, nm.needsReviewAmount]);
      return { fileId: existing.id, version: existing.version, replayed: true, importId: imp.id };
    }
    const nextVer = ((await c.query("SELECT COALESCE(MAX(version),0) v FROM bhxh.import_file WHERE import_id = $1", [imp.id])).rows[0].v) + 1;
    const st = await storage.store(config.PHF_HR_ATTACHMENT_ROOT, { period: pm, version: nextVer, fileName, buffer });
    const file = (await c.query(
      `INSERT INTO bhxh.import_file
        (import_id, version, file_name, sha256, byte_size, storage_ref, template_fingerprint, template_matched, status,
         row_count, warning_count, validation, selected_period_month, source_period_label, source_period_month,
         source_file_name, period_mismatch, source_total_employer_cost, computed_total_employer_cost,
         employer_cost_reconciled, needs_review_row_count, needs_review_amount, uploaded_by_account_id, uploaded_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,'previewed',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING id, version`,
      [imp.id, nextVer, fileName, st.sha256, st.byteSize, st.storageRef, fp.fingerprint,
       nm.rowCount, unknownCodes.length + dupInFile.length, report, pm,
       srcPeriod.sourcePeriodLabel, srcPeriod.sourcePeriodMonth, fileName, periodMismatch,
       sourceTotal, computedTotal, reconciled, nm.needsReviewCount, nm.needsReviewAmount, aid, aname])).rows[0];

    for (const rec of nm.records) {
      await c.query("INSERT INTO bhxh.raw_row (file_id, source_row_index, employee_code, cells) VALUES ($1,$2,$3,$4)",
        [file.id, rec.sourceRowIndex, rec.employeeCode, JSON.stringify(rec.rawCells || {})]);
      const f = rec.fields;
      // Identity already resolved above (source ID valid, or auto-carried-forward
      // via applyIdentityMemory) — persist as-is, never re-decided here.
      const identityKind = rec.identityKind || (rec.classification === 'MATCHED' ? 'employee_code' : null);
      const autoResolved = !!rec.identityAutoResolved;
      await c.query(
        `INSERT INTO bhxh.normalized
          (file_id, period_month, source_row_index, employee_code, employee_code_resolved, full_name_source,
           source_department, source_branch, base_salary_bhxh, employer_cost_source, employee_bhxh_tk334,
           bhxh_amount, bhyt_employer_45pct, bhyt_prepaid, employee_total_contribution, source_detail,
           classification, review_reason, validation_status, identity_kind, local_identity_id, identity_auto_resolved)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'ok',$19,$20,$21)`,
        [file.id, pm, rec.sourceRowIndex, rec.employeeCode, autoResolved, rec.fullName,
         f.source_department || null, f.source_branch || null, n(f.base_salary_bhxh),
         rec.employerCostSource, n(f.employee_bhxh_tk334), n(f.bhxh_amount), n(f.bhyt_employer_45pct),
         n(f.bhyt_prepaid), n(f.employee_total_contribution), JSON.stringify(rec.sourceDetail || {}),
         rec.classification, rec.reviewReason, identityKind, rec.localIdentityId || null, autoResolved]);
    }
    return { fileId: file.id, version: file.version, replayed: false, importId: imp.id, storageReplayed: st.replayed };
  });

  return Object.assign(report, { fileId: persisted.fileId, version: persisted.version, importId: persisted.importId, replayed: persisted.replayed });
}

// ---- ACKNOWLEDGE PERIOD (locked adjustment #2 — explicit, deliberate step) --
async function acknowledgePeriod(config, actor, params) {
  const fileId = String((params && params.fileId) || '');
  const ackPeriod = String((params && params.acknowledgedPeriodMonth) || '');
  if (!fileId) throw bErr('BHXH_FILE_ID_REQUIRED', 'Thiếu fileId.', 400);
  const [aid, aname] = actorCols(actor);
  return writeTx(config, async (c) => {
    const file = (await c.query("SELECT * FROM bhxh.import_file WHERE id = $1 FOR UPDATE", [fileId])).rows[0];
    if (!file) throw bErr('BHXH_FILE_NOT_FOUND', 'Không tìm thấy phiên bản file.', 404);
    if (file.status !== 'previewed') throw bErr('BHXH_FILE_NOT_PREVIEWED', 'Chỉ xác nhận kỳ báo cáo cho phiên bản đang xem trước.', 400);
    if (ackPeriod !== file.selected_period_month) throw bErr('BHXH_PERIOD_ACK_MISMATCH', 'Kỳ xác nhận không khớp kỳ đã chọn khi tải lên.', 400);
    await c.query(
      `UPDATE bhxh.import_file SET period_mismatch_ack = true, period_mismatch_ack_by_account_id = $2,
        period_mismatch_ack_by_name = $3, period_mismatch_ack_at = now() WHERE id = $1`,
      [fileId, aid, aname]);
    return { fileId, acknowledged: true, acknowledgedPeriodMonth: ackPeriod };
  });
}

// ---- CONFIRM ----------------------------------------------------------------
async function confirmImport(config, actor, params) {
  const fileId = String((params && params.fileId) || '');
  if (!fileId) throw bErr('BHXH_FILE_ID_REQUIRED', 'Thiếu fileId.', 400);
  return writeTx(config, async (c) => {
    const file = (await c.query("SELECT * FROM bhxh.import_file WHERE id = $1 FOR UPDATE", [fileId])).rows[0];
    if (!file) throw bErr('BHXH_FILE_NOT_FOUND', 'Không tìm thấy phiên bản file.', 404);
    if (file.status === 'confirmed') return { fileId, version: file.version, alreadyConfirmed: true };
    if (file.period_mismatch && !file.period_mismatch_ack) {
      throw bErr('BHXH_PERIOD_NOT_ACKNOWLEDGED', 'Phải xác nhận kỳ báo cáo trước khi xác nhận nhập liệu (nội dung file khác kỳ đã chọn).', 400);
    }
    const imp = (await c.query("SELECT * FROM bhxh.import WHERE id = $1 FOR UPDATE", [file.import_id])).rows[0];

    const prevFile = (await c.query(
      "SELECT * FROM bhxh.import_file WHERE import_id = $1 AND status = 'confirmed' ORDER BY version DESC LIMIT 1", [imp.id])).rows[0];

    const nextRows = (await c.query("SELECT * FROM bhxh.normalized WHERE file_id = $1", [fileId])).rows;
    let deltas = [], missing = [], added = nextRows.map(toRecKey);
    if (prevFile) {
      const prevRows = (await c.query("SELECT * FROM bhxh.normalized WHERE file_id = $1", [prevFile.id])).rows;
      const d = diffVersions(prevRows.map(toRec), nextRows.map(toRec));
      deltas = d.deltas; missing = d.missing; added = d.added;
    }
    for (const dd of deltas) {
      if (dd.changeType === 'added') {
        await c.query("INSERT INTO bhxh.delta (import_id, from_version, to_version, employee_code, source_row_index, change_type) VALUES ($1,$2,$3,$4,$5,'added')",
          [imp.id, prevFile ? prevFile.version : null, file.version, dd.employeeCode, dd.sourceRowIndex]);
      } else if (dd.changeType === 'changed') {
        await c.query("INSERT INTO bhxh.delta (import_id, from_version, to_version, employee_code, source_row_index, change_type, field, before_value, after_value) VALUES ($1,$2,$3,$4,$5,'changed',$6,$7,$8)",
          [imp.id, prevFile.version, file.version, dd.employeeCode, dd.sourceRowIndex, dd.field, dd.before == null ? null : String(dd.before), dd.after == null ? null : String(dd.after)]);
      }
    }
    for (const m of missing) {
      await c.query("INSERT INTO bhxh.delta (import_id, from_version, to_version, employee_code, source_row_index, change_type) VALUES ($1,$2,$3,$4,$5,'removed_missing')",
        [imp.id, prevFile.version, file.version, m.employeeCode, m.sourceRowIndex]);
    }

    if (prevFile) await c.query("UPDATE bhxh.import_file SET status = 'superseded' WHERE id = $1", [prevFile.id]);
    await c.query("UPDATE bhxh.import_file SET status = 'confirmed', confirmed_at = now() WHERE id = $1", [fileId]);
    await c.query("SET CONSTRAINTS ALL DEFERRED");
    await c.query("UPDATE bhxh.import SET status = 'active', current_file_id = $2 WHERE id = $1", [imp.id, fileId]);

    const hasCanon = (await c.query("SELECT 1 FROM bhxh.template WHERE is_canonical = true LIMIT 1")).rowCount > 0;
    await c.query(
      `INSERT INTO bhxh.template (fingerprint, label, is_canonical, column_map, first_seen_period)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (fingerprint) DO NOTHING`,
      [file.template_fingerprint, hasCanon ? 'PHF BHXH (kỳ ' + imp.period_month + ')' : 'PHF BHXH Canonical Template V1',
       !hasCanon, (file.validation && file.validation.columnMap) || {}, imp.period_month]);

    return {
      fileId, version: file.version, alreadyConfirmed: false,
      sourceTotalEmployerCost: file.source_total_employer_cost != null ? Number(file.source_total_employer_cost) : null,
      needsReviewCount: file.needs_review_row_count, needsReviewAmount: Number(file.needs_review_amount || 0),
      deltaCounts: { added: added.length, changed: deltas.filter((d) => d.changeType === 'changed').length, removedMissing: missing.length },
    };
  });
}
function toRecKey(row) { return { employeeCode: row.employee_code, sourceRowIndex: row.source_row_index }; }
function toRec(row) {
  return {
    employeeCode: row.employee_code, sourceRowIndex: row.source_row_index,
    employerCostSource: row.employer_cost_source == null ? null : Number(row.employer_cost_source),
    fields: {
      base_salary_bhxh: numOut(row.base_salary_bhxh), employee_bhxh_tk334: numOut(row.employee_bhxh_tk334),
      bhxh_amount: numOut(row.bhxh_amount), bhyt_employer_45pct: numOut(row.bhyt_employer_45pct),
      bhyt_prepaid: numOut(row.bhyt_prepaid), employee_total_contribution: numOut(row.employee_total_contribution),
      source_department: row.source_department, source_branch: row.source_branch,
    },
    sourceDetail: row.source_detail || {},
  };
}
function numOut(v) { return v == null ? null : Number(v); }

// ---- MAP IDENTITY (locked adjustment #3 — Admin resolves NEEDS_REVIEW) ------
// Two modes:
//  - 'employee_code' (default): resolve to a real People Master employee.
//  - 'local_identity': Admin declares a valid person with NO system account
//    (e.g. an ex-employee never on-boarded) — no account/People Master
//    record is ever created; a QTTH-local identity is registered instead.
// Both modes register (or reuse) a bhxh.identity_registry entry keyed by the
// row's normalized full_name, so the SAME person auto-resolves in later
// periods ("quyết định đủ tin cậy -> nhớ lại"). Source amounts are never
// touched — only identity columns change; the row's own department/branch
// for THIS period stay as read from source (or already-inherited).
async function mapIdentity(config, actor, params) {
  const normalizedId = Number(params && params.normalizedId);
  const mode = (params && params.mode) === 'local_identity' ? 'local_identity' : 'employee_code';
  const note = params && params.note != null ? String(params.note).slice(0, 500) : null;
  if (!normalizedId) throw bErr('BHXH_NORMALIZED_ID_REQUIRED', 'Thiếu normalizedId.', 400);

  let employeeCode = null, displayName = null;
  if (mode === 'employee_code') {
    employeeCode = String((params && params.employeeCode) || '').trim().toUpperCase();
    if (!/^PHF[0-9]{3,6}$/i.test(employeeCode)) throw bErr('BHXH_EMPLOYEE_CODE_INVALID', 'Mã nhân viên không hợp lệ.', 400);
    const knownCodes = new Set((Array.isArray(params && params.knownEmployeeCodes) ? params.knownEmployeeCodes : []).map((c) => String(c).toUpperCase()));
    if (knownCodes.size && !knownCodes.has(employeeCode)) throw bErr('BHXH_EMPLOYEE_CODE_UNKNOWN', 'Mã nhân viên không có trong People Master.', 400);
  } else {
    displayName = String((params && params.displayName) || '').trim().slice(0, 200);
    if (!displayName) throw bErr('BHXH_DISPLAY_NAME_REQUIRED', 'Cần nhập họ tên để xác nhận nhân sự hợp lệ không có tài khoản.', 400);
    if (!note) throw bErr('BHXH_LOCAL_IDENTITY_NOTE_REQUIRED', 'Cần ghi chú lý do (VD: đã nghỉ việc, chưa từng có tài khoản hệ thống).', 400);
  }
  const [aid, aname] = actorCols(actor);

  return writeTx(config, async (c) => {
    const row = (await c.query("SELECT * FROM bhxh.normalized WHERE id = $1 FOR UPDATE", [normalizedId])).rows[0];
    if (!row) throw bErr('BHXH_NORMALIZED_NOT_FOUND', 'Không tìm thấy dòng dữ liệu.', 404);
    const fromCode = row.employee_code;
    const nameForKey = mode === 'local_identity' ? displayName : (row.full_name_source || displayName || employeeCode);
    const mk = matchKey(nameForKey);

    // Reuse an existing registry entry that already targets the SAME identity
    // (same kind + same target) to avoid duplicate registrations; otherwise
    // create a new one. Never silently merge into a DIFFERENT person's entry.
    let reg = mode === 'employee_code'
      ? (await c.query("SELECT * FROM bhxh.identity_registry WHERE kind='employee_code' AND employee_code=$1 AND status='active' LIMIT 1", [employeeCode])).rows[0]
      : (await c.query("SELECT * FROM bhxh.identity_registry WHERE kind='local_identity' AND match_key=$1 AND status='active' LIMIT 1", [mk])).rows[0];

    if (reg) {
      await c.query("UPDATE bhxh.identity_registry SET last_department=COALESCE($2,last_department), last_branch=COALESCE($3,last_branch) WHERE id=$1",
        [reg.id, row.source_department, row.source_branch]);
    } else {
      reg = (await c.query(
        `INSERT INTO bhxh.identity_registry (kind, employee_code, display_name, match_key, note, last_department, last_branch, created_by_account_id, created_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [mode, mode === 'employee_code' ? employeeCode : null, mode === 'employee_code' ? (row.full_name_source || employeeCode) : displayName,
         mk, note, row.source_department, row.source_branch, aid, aname])).rows[0];
    }

    const toCodeForRow = mode === 'employee_code' ? employeeCode : null;
    await c.query(
      `UPDATE bhxh.normalized SET employee_code = $2, employee_code_resolved = true, classification = 'MATCHED',
        review_reason = NULL, identity_kind = $3, local_identity_id = $4, identity_auto_resolved = false WHERE id = $1`,
      [normalizedId, toCodeForRow, mode, mode === 'local_identity' ? reg.id : null]);
    await c.query(
      `INSERT INTO bhxh.identity_mapping_history
        (import_id, file_id, normalized_id, period_month, source_row_index, from_employee_code, to_employee_code,
         mode, to_local_identity_id, full_name_source, employer_cost_source, note, mapped_by_account_id, mapped_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [(await c.query("SELECT import_id FROM bhxh.import_file WHERE id = $1", [row.file_id])).rows[0].import_id,
       row.file_id, normalizedId, row.period_month, row.source_row_index, fromCode, toCodeForRow,
       mode, mode === 'local_identity' ? reg.id : null,
       row.full_name_source, row.employer_cost_source, note, aid, aname]);

    const file = (await c.query("SELECT import_id FROM bhxh.import_file WHERE id = $1", [row.file_id])).rows[0];
    const counts = (await c.query(
      "SELECT COUNT(*) FILTER (WHERE classification = 'NEEDS_REVIEW') cnt, COALESCE(SUM(employer_cost_source) FILTER (WHERE classification = 'NEEDS_REVIEW'), 0) amt FROM bhxh.normalized WHERE file_id = $1",
      [row.file_id])).rows[0];
    await c.query("UPDATE bhxh.import_file SET needs_review_row_count = $2, needs_review_amount = $3 WHERE id = $1",
      [row.file_id, counts.cnt, counts.amt]);

    return {
      normalizedId, fromEmployeeCode: fromCode, mode,
      toEmployeeCode: toCodeForRow, localIdentityId: mode === 'local_identity' ? reg.id : null,
      displayName: mode === 'local_identity' ? displayName : null, classification: 'MATCHED',
    };
  });
}

// ---- READ / STATUS -----------------------------------------------------
async function loadActiveNormalized(config, pm) {
  return readTx(config, async (c) => {
    const imp = (await c.query("SELECT * FROM bhxh.import WHERE period_month = $1", [pm])).rows[0];
    if (!imp || !imp.current_file_id) return null;
    const file = (await c.query("SELECT * FROM bhxh.import_file WHERE id = $1", [imp.current_file_id])).rows[0];
    const rows = (await c.query("SELECT * FROM bhxh.normalized WHERE file_id = $1", [imp.current_file_id])).rows;
    return { version: file.version, fileId: file.id, records: rows.map(toRec) };
  });
}

async function status(config, actor, params) {
  const pm = period(params && params.periodMonth);
  return readTx(config, async (c) => {
    const imp = (await c.query("SELECT * FROM bhxh.import WHERE period_month = $1", [pm])).rows[0];
    if (!imp) return { periodMonth: pm, exists: false, versions: [] };
    const files = (await c.query(
      `SELECT id, version, file_name, sha256, byte_size, status, row_count, warning_count, template_matched,
         source_period_label, source_period_month, period_mismatch, period_mismatch_ack,
         source_total_employer_cost, computed_total_employer_cost, employer_cost_reconciled,
         needs_review_row_count, needs_review_amount, uploaded_by_name, uploaded_at, confirmed_at
       FROM bhxh.import_file WHERE import_id = $1 ORDER BY version DESC`, [imp.id])).rows;
    const current = files.find((f) => f.id === imp.current_file_id) || null;
    return {
      periodMonth: pm, exists: true, importStatus: imp.status,
      current: current && {
        version: current.version, fileName: current.file_name, rowCount: current.row_count,
        sourceTotalEmployerCost: numOut(current.source_total_employer_cost),
        needsReviewCount: current.needs_review_row_count, needsReviewAmount: numOut(current.needs_review_amount),
        periodMismatch: current.period_mismatch, periodMismatchAck: current.period_mismatch_ack,
        uploadedBy: current.uploaded_by_name, uploadedAt: current.uploaded_at, confirmedAt: current.confirmed_at,
      },
      versions: files.map((f) => ({
        fileId: f.id, version: f.version, fileName: f.file_name, status: f.status,
        rowCount: f.row_count, sourcePeriodLabel: f.source_period_label, periodMismatch: f.period_mismatch,
        periodMismatchAck: f.period_mismatch_ack, sourceTotalEmployerCost: numOut(f.source_total_employer_cost),
        needsReviewCount: f.needs_review_row_count, needsReviewAmount: numOut(f.needs_review_amount),
        uploadedBy: f.uploaded_by_name, uploadedAt: f.uploaded_at, confirmedAt: f.confirmed_at,
        isCurrent: f.id === imp.current_file_id,
      })),
    };
  });
}

async function listNormalized(config, actor, params) {
  const pm = period(params && params.periodMonth);
  const classification = params && params.classification ? String(params.classification).toUpperCase() : null;
  // "Nhân sự đã nghỉ nhưng kỳ sau vẫn phát sinh chi phí" -> warn, never
  // auto-exclude the cost (locked identity rule).
  const inactiveCodes = new Set((Array.isArray(params && params.inactiveEmployeeCodes) ? params.inactiveEmployeeCodes : []).map((c) => String(c).toUpperCase()));
  // QTTH Phân quyền's own canonical department (unit/group), supplied live
  // per-request by the caller (never stored in bhxh.* — this stays the
  // single live source of reporting-truth department, BHXH's own
  // source_department/source_branch remain reference/warning only).
  const qtthDepartments = (params && params.qtthDepartments && typeof params.qtthDepartments === 'object') ? params.qtthDepartments : {};
  const active = await loadActiveNormalized(config, pm);
  if (!active) return { periodMonth: pm, version: null, rows: [] };
  return readTx(config, async (c) => {
    const rows = (await c.query(
      classification
        ? "SELECT * FROM bhxh.normalized WHERE file_id = $1 AND classification = $2 ORDER BY source_row_index"
        : "SELECT * FROM bhxh.normalized WHERE file_id = $1 ORDER BY source_row_index",
      classification ? [active.fileId, classification] : [active.fileId])).rows;
    return {
      periodMonth: pm, version: active.version, fileId: active.fileId,
      rows: rows.map((r) => {
        const qd = r.employee_code ? qtthDepartments[String(r.employee_code).toUpperCase()] : null;
        return {
          normalizedId: r.id, sourceRowIndex: r.source_row_index, employeeCode: r.employee_code,
          employeeCodeResolved: r.employee_code_resolved, fullNameSource: r.full_name_source,
          sourceDepartment: r.source_department, sourceBranch: r.source_branch,
          qtthUnitName: qd ? qd.unitName : null, qtthGroupName: qd ? qd.groupName : null,
          baseSalaryBhxh: numOut(r.base_salary_bhxh), employerCostSource: numOut(r.employer_cost_source),
          classification: r.classification, reviewReason: r.review_reason,
          identityKind: r.identity_kind, identityAutoResolved: r.identity_auto_resolved,
          employeeInactiveWarning: !!(r.employee_code && inactiveCodes.has(String(r.employee_code).toUpperCase())),
        };
      }),
    };
  });
}

async function employeeDetail(config, actor, params) {
  const pm = period(params && params.periodMonth);
  const normalizedId = Number(params && params.normalizedId);
  if (!normalizedId) throw bErr('BHXH_NORMALIZED_ID_REQUIRED', 'Thiếu normalizedId.', 400);
  return readTx(config, async (c) => {
    const nr = (await c.query("SELECT * FROM bhxh.normalized WHERE id = $1 AND period_month = $2", [normalizedId, pm])).rows[0];
    if (!nr) throw bErr('BHXH_ROW_NOT_FOUND', 'Không tìm thấy dòng dữ liệu.', 404);
    const raw = (await c.query("SELECT source_row_index, cells FROM bhxh.raw_row WHERE file_id = $1 AND source_row_index = $2", [nr.file_id, nr.source_row_index])).rows[0];
    const history = (await c.query(
      "SELECT from_employee_code, to_employee_code, note, mapped_by_name, mapped_at FROM bhxh.identity_mapping_history WHERE normalized_id = $1 ORDER BY mapped_at DESC", [normalizedId])).rows;
    return { periodMonth: pm, normalized: nr, sourceDetail: nr.source_detail, rawCells: raw ? raw.cells : null, mappingHistory: history };
  });
}

async function reconciliation(config, actor, params) {
  const pm = period(params && params.periodMonth);
  const active = await loadActiveNormalized(config, pm);
  if (!active) return { periodMonth: pm, exists: false };
  return readTx(config, async (c) => {
    const file = (await c.query("SELECT * FROM bhxh.import_file WHERE id = $1", [active.fileId])).rows[0];
    const agg = (await c.query(
      `SELECT
         COALESCE(SUM(employer_cost_source) FILTER (WHERE classification = 'MATCHED'), 0) matched_amount,
         COALESCE(SUM(employer_cost_source) FILTER (WHERE classification = 'NEEDS_REVIEW'), 0) needs_review_amount,
         COUNT(*) FILTER (WHERE classification = 'NEEDS_REVIEW') needs_review_count
       FROM bhxh.normalized WHERE file_id = $1`, [active.fileId])).rows[0];
    return {
      periodMonth: pm, exists: true, version: active.version,
      sourceTotal: numOut(file.source_total_employer_cost),
      computedTotal: numOut(file.computed_total_employer_cost),
      reconciled: file.employer_cost_reconciled,
      matchedAmount: numOut(agg.matched_amount),
      needsReviewAmount: numOut(agg.needs_review_amount),
      needsReviewCount: Number(agg.needs_review_count),
    };
  });
}

// Plain read helper (NOT HANDLERS-routed) for payroll.costTruth() to merge
// BHXH's confirmed total into Personnel Cost. Only a CONFIRMED version counts
// (locked adjustment #4) — a previewed/draft version, even the latest, never
// feeds Personnel Cost.
async function confirmedEmployerCostForPeriod(config, pm) {
  return readTx(config, async (c) => {
    const imp = (await c.query("SELECT * FROM bhxh.import WHERE period_month = $1", [pm])).rows[0];
    if (!imp || !imp.current_file_id) return { available: false };
    const file = (await c.query("SELECT * FROM bhxh.import_file WHERE id = $1 AND status = 'confirmed'", [imp.current_file_id])).rows[0];
    if (!file) return { available: false };
    return {
      available: true, total: numOut(file.source_total_employer_cost), version: file.version,
      reconciled: file.employer_cost_reconciled, needsReviewAmount: numOut(file.needs_review_amount),
    };
  });
}

// ---- dispatch --------------------------------------------------------
const HANDLERS = {
  'bhxh.validatePreview': validatePreview,
  'bhxh.acknowledgePeriod': acknowledgePeriod,
  'bhxh.confirm': confirmImport,
  'bhxh.status': status,
  'bhxh.listNormalized': listNormalized,
  'bhxh.employeeDetail': employeeDetail,
  'bhxh.mapIdentity': mapIdentity,
  'bhxh.reconciliation': reconciliation,
};
const ACTIONS = Object.freeze(Object.keys(HANDLERS));
async function dispatch(config, actor, action, params) {
  const h = HANDLERS[action];
  if (!h) throw bErr('BHXH_ACTION_UNKNOWN', 'Hành động BHXH không hợp lệ: ' + action, 400);
  return h(config, actor, params || {});
}

module.exports = { dispatch, ACTIONS, HANDLERS, BhxhError, confirmedEmployerCostForPeriod };
