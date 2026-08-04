'use strict';

require('dotenv').config();
const crypto = require('crypto');
const { Readable } = require('node:stream');
const { createClient } = require('@supabase/supabase-js');
const { requireViolationPermission } = require('./checklist-violations');

const okEnv = Boolean(
  String(process.env.SUPABASE_URL || '').trim() &&
  String(process.env.SUPABASE_SECRET_KEY || '').trim()
);
const supabase = okEnv
  ? createClient(
      String(process.env.SUPABASE_URL).trim(),
      String(process.env.SUPABASE_SECRET_KEY).trim(),
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
  : null;

const BUCKET = String(process.env.PHF_CHECKLIST_EVIDENCE_BUCKET || 'phf-checklist-evidence').trim();
const TABLE = 'checklist_violation_evidence';
const VIOLATION_TABLE = 'checklist_violation_records';
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const ORPHAN_DRAFT_MAX_AGE_HOURS = 24;
// Dùng riêng cho route xem branded /evidence/:id: signed URL này chỉ sống đủ
// lâu để server tự fetch object rồi pipe ngay, không bao giờ rời khỏi máy chủ.
const DOWNLOAD_SIGNED_URL_TTL_SECONDS = 120;

function t(value) {
  return String(value == null ? '' : value).trim();
}

function safeName(name) {
  return t(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'file';
}

function fail(message, statusCode = 400, code = 'CHECKLIST_EVIDENCE_ERROR', details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details) error.details = details;
  throw error;
}

function db() {
  if (!supabase) fail('Supabase chưa được cấu hình.', 503, 'CHECKLIST_EVIDENCE_STORAGE_NOT_CONFIGURED');
  return supabase;
}

function actor(session) {
  return {
    id: t(session && session.account && session.account.id || session && session.sub),
    name: t(session && session.account && (session.account.name || session.account.email) || session && session.email)
  };
}

function mapEvidence(row) {
  return {
    id: row.id,
    violationId: row.violation_id || null,
    requestId: row.request_id || '',
    originalName: row.original_name || '',
    mimeType: row.mime_type || '',
    sizeBytes: Number(row.size_bytes || 0),
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: row.created_at || ''
  };
}

/**
 * Bước 1/2 của upload: chỉ phát signed upload URL, CHƯA ghi row nào vào DB.
 * evidenceId sinh trước ở đây để dùng chung làm phần path + primary key khi finalize.
 */
async function createChecklistEvidenceUpload(session, payload) {
  const employeeCode = t(payload && payload.employeeCode).toUpperCase();
  if (!employeeCode) fail('Thiếu mã nhân viên để kiểm tra phạm vi tải minh chứng.', 400, 'CHECKLIST_EVIDENCE_EMPLOYEE_REQUIRED');
  await requireViolationPermission(session, 'record', [{ employee_code: employeeCode }]);

  const fileName = t(payload && payload.fileName);
  const mimeType = t(payload && payload.mimeType);
  const sizeBytes = Number(payload && payload.sizeBytes || 0);
  if (!fileName) fail('Thiếu tên file.', 400, 'CHECKLIST_EVIDENCE_NAME_REQUIRED');
  if (!ALLOWED_MIME.has(mimeType)) fail('Chỉ chấp nhận ảnh JPG/PNG/WEBP hoặc PDF.', 400, 'CHECKLIST_EVIDENCE_TYPE_INVALID');
  if (sizeBytes <= 0 || sizeBytes > MAX_BYTES) fail('Mỗi file phải có dung lượng từ 1 byte đến 10MB.', 400, 'CHECKLIST_EVIDENCE_SIZE_INVALID');

  const currentActor = actor(session);
  const evidenceId = crypto.randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  const storagePath = `violations/${currentActor.id || 'unknown'}/${today}/${evidenceId}/${safeName(fileName)}`;

  const signed = await db().storage.from(BUCKET).createSignedUploadUrl(storagePath);
  if (signed.error) fail('Không tạo được đường dẫn tải lên.', 502, 'CHECKLIST_EVIDENCE_SIGN_FAILED');

  return {
    evidenceId,
    storagePath,
    token: signed.data.token,
    signedUrl: signed.data.signedUrl,
    bucket: BUCKET,
    maxBytes: MAX_BYTES
  };
}

/**
 * Bước 2/2 của upload: xác minh object thật đã có trong Storage (không tin
 * size/mime client khai báo), rồi mới ghi 1 row draft (violation_id = null).
 */
async function finalizeChecklistEvidenceUpload(session, payload) {
  const employeeCode = t(payload && payload.employeeCode).toUpperCase();
  if (!employeeCode) fail('Thiếu mã nhân viên để kiểm tra phạm vi tải minh chứng.', 400, 'CHECKLIST_EVIDENCE_EMPLOYEE_REQUIRED');
  await requireViolationPermission(session, 'record', [{ employee_code: employeeCode }]);

  const evidenceId = t(payload && payload.evidenceId);
  const storagePath = t(payload && payload.storagePath);
  const requestId = t(payload && payload.requestId);
  if (!evidenceId || !storagePath) fail('Thiếu thông tin file vừa tải lên.', 400, 'CHECKLIST_EVIDENCE_UPLOAD_REF_REQUIRED');
  if (!storagePath.startsWith('violations/') || !storagePath.includes(`/${evidenceId}/`)) {
    fail('Đường dẫn file không hợp lệ.', 400, 'CHECKLIST_EVIDENCE_PATH_INVALID');
  }

  const slashIndex = storagePath.lastIndexOf('/');
  const folder = storagePath.slice(0, slashIndex);
  const baseName = storagePath.slice(slashIndex + 1);
  const list = await db().storage.from(BUCKET).list(folder, { search: baseName, limit: 5 });
  if (list.error) fail('Không xác minh được file trên Storage.', 502, 'CHECKLIST_EVIDENCE_VERIFY_FAILED');
  const found = (list.data || []).find(entry => entry.name === baseName);
  if (!found) fail('Chưa tìm thấy file đã tải lên trong Storage. Vui lòng thử lại.', 409, 'CHECKLIST_EVIDENCE_OBJECT_NOT_FOUND');

  const verifiedSize = Number((found.metadata && found.metadata.size) || 0);
  const verifiedMime = t((found.metadata && found.metadata.mimetype) || payload.mimeType);
  if (!ALLOWED_MIME.has(verifiedMime)) fail('Định dạng file không hợp lệ sau khi xác minh.', 400, 'CHECKLIST_EVIDENCE_TYPE_INVALID');
  if (verifiedSize <= 0 || verifiedSize > MAX_BYTES) fail('Dung lượng file không hợp lệ sau khi xác minh.', 400, 'CHECKLIST_EVIDENCE_SIZE_INVALID');

  const currentActor = actor(session);
  const row = {
    id: evidenceId,
    violation_id: null,
    request_id: requestId,
    storage_path: storagePath,
    original_name: safeName(t(payload.fileName) || baseName),
    mime_type: verifiedMime,
    size_bytes: verifiedSize,
    created_by: currentActor.id,
    created_by_name: currentActor.name
  };
  const { data, error } = await db().from(TABLE).insert(row).select('*').single();
  if (error) {
    if (error.code === '23505') fail('Minh chứng này đã được xác nhận trước đó.', 409, 'CHECKLIST_EVIDENCE_ALREADY_FINALIZED');
    throw error;
  }
  return { evidenceDraftId: data.id, evidence: mapEvidence(data) };
}

/**
 * Chạy SAU khi saveChecklistViolations trả savedRows. Client chỉ gửi requestId +
 * danh sách evidenceDraftId - KHÔNG gửi violationId. Backend tự tra lại
 * violation_id thật theo request_id, không tin bất kỳ id nào client có thể gửi
 * kèm trước khi bản ghi thực sự tồn tại.
 */
async function attachChecklistEvidence(session, payload) {
  const links = Array.isArray(payload && payload.links) ? payload.links : [];
  if (!links.length) fail('Không có minh chứng nào cần đính kèm.', 400, 'CHECKLIST_EVIDENCE_LINKS_EMPTY');
  const requestIds = [...new Set(links.map(link => t(link.requestId)).filter(Boolean))];
  if (!requestIds.length) fail('Thiếu requestId để xác định đúng bản ghi lỗi.', 400, 'CHECKLIST_EVIDENCE_REQUEST_ID_REQUIRED');

  const { data: violations, error: violationError } = await db()
    .from(VIOLATION_TABLE)
    .select('id,request_id,employee_code')
    .in('request_id', requestIds);
  if (violationError) throw violationError;

  const currentActor = actor(session);
  await requireViolationPermission(session, 'record', (violations || []).map(v => ({ employee_code: v.employee_code })));

  const violationByRequestId = new Map((violations || []).map(v => [v.request_id, v]));
  const resolvedLinks = [];
  const skipped = [];
  for (const link of links) {
    const requestId = t(link.requestId);
    const violation = violationByRequestId.get(requestId);
    if (!violation) {
      skipped.push({ requestId, evidenceDraftIds: link.evidenceDraftIds || [], code: 'CHECKLIST_EVIDENCE_VIOLATION_NOT_SAVED' });
      continue;
    }
    const draftIds = Array.isArray(link.evidenceDraftIds) ? link.evidenceDraftIds : [];
    for (const draftId of draftIds) {
      if (!t(draftId)) continue;
      resolvedLinks.push({ evidenceId: t(draftId), violationId: violation.id, requestId });
    }
  }

  const checkViolationIds = [...new Set((violations || []).map(v => v.id))];
  if (!checkViolationIds.length) {
    return { ok: true, attached: [], failed: [], skipped, autoCancelledViolationIds: [] };
  }

  const { data, error } = await db().rpc('phf_attach_checklist_evidence', {
    p_links: resolvedLinks,
    p_check_violation_ids: checkViolationIds,
    p_actor_id: currentActor.id,
    p_actor_name: currentActor.name
  });
  if (error) throw error;
  if (!data || data.ok !== true) fail((data && data.message) || 'Không thể đính kèm minh chứng.', 500, (data && data.code) || 'CHECKLIST_EVIDENCE_ATTACH_FAILED');
  return { ...data, skipped };
}

/** Người xem phải cùng scope xem bản ghi (dùng lại đúng logic action='view'). */
async function listChecklistEvidence(session, payload) {
  const violationIds = Array.isArray(payload && payload.violationIds)
    ? payload.violationIds.map(t).filter(Boolean)
    : [t(payload && payload.violationId)].filter(Boolean);
  if (!violationIds.length) fail('Thiếu violationId.', 400, 'CHECKLIST_EVIDENCE_VIOLATION_ID_REQUIRED');

  const { data: violations, error: violationError } = await db()
    .from(VIOLATION_TABLE)
    .select('id,employee_code')
    .in('id', violationIds);
  if (violationError) throw violationError;
  if (!violations || !violations.length) return { items: [] };

  await requireViolationPermission(session, 'view', violations.map(v => ({ employee_code: v.employee_code })));

  const { data, error } = await db()
    .from(TABLE)
    .select('*')
    .in('violation_id', violationIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;

  // Không còn ký signed URL Supabase ở đây: UI dùng route thương hiệu hóa
  // GET /evidence/:id (xem streamChecklistEvidenceDownload bên dưới), route
  // đó tự tạo signed URL riêng ngay trước khi phục vụ và không bao giờ trả
  // nó ra ngoài - nên danh sách này không cần (và không nên) mang theo bất
  // kỳ signed URL nào tới trình duyệt.
  const items = (data || []).map(mapEvidence);
  return { items };
}

/**
 * Xoá mềm metadata qua RPC (RPC tự chặn nếu đây là minh chứng bắt buộc cuối
 * cùng và không có replacement). Object Storage chỉ bị xoá thật nếu RPC xác
 * nhận không còn dòng nào khác dùng chung storage_path (evidence tái sử dụng).
 */
async function deleteChecklistEvidence(session, payload) {
  const evidenceId = t(payload && payload.evidenceId);
  if (!evidenceId) fail('Thiếu evidenceId.', 400, 'CHECKLIST_EVIDENCE_ID_REQUIRED');
  const replacementEvidenceId = t(payload && payload.replacementEvidenceDraftId) || null;

  const { data: evidenceRow, error: evidenceError } = await db()
    .from(TABLE)
    .select('id,violation_id')
    .eq('id', evidenceId)
    .is('deleted_at', null)
    .maybeSingle();
  if (evidenceError) throw evidenceError;
  if (!evidenceRow) fail('Không tìm thấy minh chứng.', 404, 'CHECKLIST_EVIDENCE_NOT_FOUND');

  if (evidenceRow.violation_id) {
    const { data: violation, error: violationError } = await db()
      .from(VIOLATION_TABLE)
      .select('employee_code')
      .eq('id', evidenceRow.violation_id)
      .maybeSingle();
    if (violationError) throw violationError;
    if (violation) await requireViolationPermission(session, 'record', [{ employee_code: violation.employee_code }]);
  }

  const currentActor = actor(session);
  const { data, error } = await db().rpc('phf_delete_checklist_evidence', {
    p_evidence_id: evidenceId,
    p_replacement_evidence_id: replacementEvidenceId,
    p_actor_id: currentActor.id,
    p_actor_name: currentActor.name
  });
  if (error) throw error;
  if (!data || data.ok !== true) fail('Không thể xoá minh chứng.', 400, (data && data.code) || 'CHECKLIST_EVIDENCE_DELETE_FAILED');

  if (data.purgeStorageObject && data.storagePath) {
    await db().storage.from(BUCKET).remove([data.storagePath]).catch(() => {});
  }
  return { ok: true, evidenceId: data.evidenceId };
}

/**
 * Dọn draft mồ côi (violation_id vẫn null quá 24h - nghĩa là lưu violation đã
 * thất bại hoặc người dùng bỏ dở). CHƯA có cron nào trong repo tự gọi hàm này -
 * giống hệt hiện trạng của checklist-monthly-cron, cần cấu hình `crons` trong
 * vercel.json (hoặc dịch vụ cron ngoài) kèm CHECKLIST_CRON_SECRET để tự động.
 */
async function cleanupOrphanChecklistEvidence() {
  const cutoff = new Date(Date.now() - ORPHAN_DRAFT_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await db()
    .from(TABLE)
    .select('id,storage_path')
    .is('violation_id', null)
    .is('deleted_at', null)
    .lt('created_at', cutoff)
    .limit(200);
  if (error) throw error;
  const rows = data || [];
  if (!rows.length) return { cleaned: 0 };

  const paths = rows.map(row => row.storage_path);
  await db().storage.from(BUCKET).remove(paths).catch(() => {});
  const { error: deleteError } = await db().from(TABLE).delete().in('id', rows.map(row => row.id));
  if (deleteError) throw deleteError;
  return { cleaned: rows.length };
}

/**
 * Dùng cho route thương hiệu hóa GET /evidence/:id. Chỉ nhận evidenceId từ
 * URL path - không tin storage_path/signed URL nào từ client. Dùng lại
 * nguyên logic quyền action='view' của requireViolationPermission (đúng
 * scope thật của người xem: Admin toàn bộ, Trợ lý/Ban Giám sát theo
 * view_scope, TBP/Trưởng ca/QL trực tiếp theo scope được cấp, nhân viên chỉ
 * lỗi của chính mình) - không có logic quyền riêng ở đây.
 */
async function resolveChecklistEvidenceForDownload(session, evidenceId) {
  const id = t(evidenceId);
  if (!id) fail('Thiếu mã minh chứng.', 400, 'CHECKLIST_EVIDENCE_ID_REQUIRED');

  const { data: row, error } = await db()
    .from(TABLE)
    .select('id,violation_id,storage_path,original_name,mime_type,size_bytes')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  // Draft chưa gắn violation_id (chưa attach xong) không có scope nào để kiểm
  // tra quyền, nên coi như không tồn tại đối với route xem công khai này.
  if (!row || !row.violation_id) fail('Không tìm thấy minh chứng.', 404, 'CHECKLIST_EVIDENCE_NOT_FOUND');

  const { data: violation, error: violationError } = await db()
    .from(VIOLATION_TABLE)
    .select('id,employee_code')
    .eq('id', row.violation_id)
    .maybeSingle();
  if (violationError) throw violationError;
  if (!violation) fail('Không tìm thấy minh chứng.', 404, 'CHECKLIST_EVIDENCE_NOT_FOUND');

  await requireViolationPermission(session, 'view', [{ employee_code: violation.employee_code }]);

  const signed = await db().storage.from(BUCKET).createSignedUrl(row.storage_path, DOWNLOAD_SIGNED_URL_TTL_SECONDS);
  if (signed.error || !signed.data || !signed.data.signedUrl) {
    fail('Không tìm thấy minh chứng trên hệ thống lưu trữ.', 404, 'CHECKLIST_EVIDENCE_OBJECT_NOT_FOUND');
  }

  return {
    signedUrl: signed.data.signedUrl,
    mimeType: row.mime_type || 'application/octet-stream',
    originalName: row.original_name || 'evidence',
    sizeBytes: Number(row.size_bytes || 0)
  };
}

/**
 * Fetch object qua signed URL nội bộ rồi pipe thẳng về client - thanh địa chỉ
 * trình duyệt luôn giữ nguyên domain PHF (training.phuhoafresh.info.vn/evidence/:id),
 * signed URL Supabase không bao giờ lộ ra ngoài response header/body. Không
 * buffer toàn bộ file vào RAM - stream trực tiếp qua Readable.fromWeb.
 */
async function streamChecklistEvidenceDownload(req, res, session, evidenceId) {
  const download = await resolveChecklistEvidenceForDownload(session, evidenceId);

  let upstream;
  try {
    upstream = await fetch(download.signedUrl);
  } catch (e) {
    fail('Không thể mở minh chứng.', 502, 'CHECKLIST_EVIDENCE_FETCH_FAILED');
  }
  if (!upstream.ok || !upstream.body) {
    fail('Không tìm thấy minh chứng trên hệ thống lưu trữ.', upstream.status === 404 ? 404 : 502, 'CHECKLIST_EVIDENCE_OBJECT_NOT_FOUND');
  }

  const headers = {
    'Content-Type': download.mimeType,
    'Content-Disposition': 'inline; filename="' + safeName(download.originalName) + '"',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin'
  };
  const upstreamLength = upstream.headers.get('content-length');
  if (upstreamLength) headers['Content-Length'] = upstreamLength;

  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();

  const nodeStream = Readable.fromWeb(upstream.body);
  const onAbort = () => { try { nodeStream.destroy(); } catch (_e) {} };
  req.on('close', onAbort);
  nodeStream.on('error', () => { try { res.end(); } catch (_e) {} });
  nodeStream.pipe(res);
}

module.exports = {
  createChecklistEvidenceUpload,
  finalizeChecklistEvidenceUpload,
  attachChecklistEvidence,
  listChecklistEvidence,
  deleteChecklistEvidence,
  cleanupOrphanChecklistEvidence,
  streamChecklistEvidenceDownload
};
