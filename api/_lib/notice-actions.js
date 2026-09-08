'use strict';

// PHF HR — THÔNG BÁO QUẢN TRỊ V1 · Batch 01 action dispatcher.
//
// Shared by BOTH api/data.js (Vercel) and server.js (local :3000):
//   const noticeDispatch = await dispatchNoticeAction(session, payload);
//   if (noticeDispatch.handled) return <sendJson>(res, 200, {ok:true, result: noticeDispatch.result});
//
// Every handler here:
//   1. resolves the VERIFIED actor from the PHF HR session via notice-identity.js
//      (People Master — client can NEVER supply actor / role),
//   2. picks an EXPLICIT whitelist of fields off the client payload (never `...payload`),
//   3. calls the phf-hr-api action via notice-bridge.js.
//
// notice.report + the permission roster are COMPOSITE: the People Master roster
// (Supabase) is joined to notice-owned rows (Company PostgreSQL / phf-hr-api).
// Business authorization is server-authoritative inside phf-hr-api — never
// re-implemented here.

const { resolveNoticeActor } = require('./notice-identity');
const { callNoticeAction } = require('./notice-bridge');
const { loadOrgRows } = require('./task-employee-scope');
const { listAdminEmployeeCodes } = require('./auth');

function str(v) { return v == null ? undefined : String(v); }
function code(v) { const s = v == null ? '' : String(v).trim().toUpperCase(); return s || undefined; }
function bool(v) { return v === true || v === 'true'; }
function arr(v) { return Array.isArray(v) ? v : []; }

const INACTIVE_TOKENS = ['inactive', 'terminated', 'nghỉ', 'nghi viec', 'nghỉ việc', 'đã nghỉ'];
function isActiveStatus(status) {
  const s = String(status || 'active').toLowerCase();
  return !INACTIVE_TOKENS.some((t) => s.includes(t));
}

function scopesIn(p) {
  return arr(p && p.scopes).map((s) => ({
    scopeType: str(s && (s.scopeType || s.scope_type)),
    scopeValue: str(s && (s.scopeValue || s.scope_value)),
  }));
}
function keywordsIn(p) { return arr(p && p.keywords).map(str).filter(Boolean); }

// Straight passthroughs: action -> params(payload)
const PASSTHROUGH = {
  noticeBootstrap:   { remote: 'notice.bootstrap', params: () => ({}) },
  noticeFeed:        { remote: 'notice.feed', params: (p) => ({
    q: str(p.q), type: str(p.type), status: str(p.status), scope: str(p.scope),
    includeDrafts: bool(p.include_drafts),
    mode: (str(p.mode) === 'inbox' || str(p.mode) === 'bell') ? str(p.mode) : undefined,
  }) },
  noticeDetail:      { remote: 'notice.detail', params: (p) => ({ id: str(p.id) }) },
  noticeAcknowledge: { remote: 'notice.acknowledge', params: (p) => ({ id: str(p.id) }) },
  noticeCreate:      { remote: 'notice.create', params: (p) => ({
    title: str(p.title), contentHtml: str(p.content_html), contentText: str(p.content_text),
    noticeType: str(p.notice_type), priority: str(p.priority), effectiveFrom: str(p.effective_from), effectiveTo: str(p.effective_to),
    requireAcknowledgement: bool(p.require_acknowledgement), scopes: scopesIn(p), keywords: keywordsIn(p),
    pinned: bool(p.pinned),
    replacedNoticeId: str(p.replaced_notice_id),
  }) },
  noticeUpdate:      { remote: 'notice.update', params: (p) => {
    const out = { id: str(p.id) };
    if (Object.prototype.hasOwnProperty.call(p, 'title')) out.title = str(p.title);
    if (Object.prototype.hasOwnProperty.call(p, 'content_html')) out.contentHtml = str(p.content_html);
    if (Object.prototype.hasOwnProperty.call(p, 'content_text')) out.contentText = str(p.content_text);
    if (Object.prototype.hasOwnProperty.call(p, 'notice_type')) out.noticeType = str(p.notice_type);
    if (Object.prototype.hasOwnProperty.call(p, 'priority')) out.priority = str(p.priority);
    if (Object.prototype.hasOwnProperty.call(p, 'effective_from')) out.effectiveFrom = str(p.effective_from);
    if (Object.prototype.hasOwnProperty.call(p, 'effective_to')) out.effectiveTo = str(p.effective_to);
    if (Object.prototype.hasOwnProperty.call(p, 'require_acknowledgement')) out.requireAcknowledgement = bool(p.require_acknowledgement);
    if (Object.prototype.hasOwnProperty.call(p, 'pinned')) out.pinned = bool(p.pinned);
    if (Array.isArray(p.scopes)) out.scopes = scopesIn(p);
    if (Array.isArray(p.keywords)) out.keywords = keywordsIn(p);
    out.requireReacknowledgement = bool(p.require_reacknowledgement);
    if (Object.prototype.hasOwnProperty.call(p, 'change_summary')) out.changeSummary = str(p.change_summary);
    return out;
  } },
  noticePublish:     { remote: 'notice.publish', params: (p) => ({ id: str(p.id) }) },
  noticeSetPin:      { remote: 'notice.setPin', params: (p) => ({ id: str(p.id), pinned: bool(p.pinned) }) },
  noticeDelete:      { remote: 'notice.delete', params: (p) => ({ id: str(p.id) }) },
  noticeRevisions:   { remote: 'notice.revisions', params: (p) => ({ id: str(p.id) }) },
  noticeAuditLog:    { remote: 'notice.auditLog', params: (p) => ({ id: str(p.id) }) },
  noticeAttachmentAdd: { remote: 'notice.attachment.add', params: (p) => ({
    noticeId: str(p.notice_id), kind: str(p.kind), fileName: str(p.file_name), mimeType: str(p.mime_type),
    base64: str(p.base64), linkUrl: str(p.link_url), requireReacknowledgement: bool(p.require_reacknowledgement),
  }) },
  noticeAttachmentRemove: { remote: 'notice.attachment.remove', params: (p) => ({
    noticeId: str(p.notice_id), attachmentId: str(p.attachment_id), requireReacknowledgement: bool(p.require_reacknowledgement),
  }) },
  noticeAttachmentDownload: { remote: 'notice.attachment.download', params: (p) => ({ noticeId: str(p.notice_id), attachmentId: str(p.attachment_id) }) },
  noticeCategoriesList: { remote: 'notice.categories.list', params: () => ({}) },
  noticeCategoriesUpsert: { remote: 'notice.categories.upsert', params: (p) => ({
    slug: str(p.slug), name: str(p.name),
    sortOrder: (p.sort_order == null || p.sort_order === '') ? undefined : Number(p.sort_order),
    isActive: Object.prototype.hasOwnProperty.call(p, 'is_active') ? bool(p.is_active) : undefined,
  }) },
  noticeCategoriesReorder: { remote: 'notice.categories.reorder', params: (p) => ({ order: Array.isArray(p.order) ? p.order.map(str) : [] }) },
  noticeSimilar: { remote: 'notice.similar', params: (p) => ({
    title: str(p.title), contentText: str(p.content_text), keywords: keywordsIn(p), excludeId: str(p.exclude_id),
  }) },
  noticeSetPermission: { remote: 'notice.permissions.set', params: (p) => ({ employeeCode: code(p.employee_code), canManage: bool(p.can_manage) }) },
  noticePermissionHistory: { remote: 'notice.permissions.history', params: (p) => ({ employeeCode: code(p.employee_code) }) },
};

// Composite: report — joins People Master roster to notice view/ack ledger.
async function report(session, payload) {
  const actor = await resolveNoticeActor(session);
  const rows = await loadOrgRows();
  const roster = rows.map((r) => ({
    employeeCode: r.employeeCode, fullName: r.fullName,
    department: r.department || '', branch: r.branch || '', title: r.title || r.position || '',
    active: isActiveStatus(r.status),
  }));
  return callNoticeAction('notice.report', actor, { id: str(payload && payload.id), roster });
}

// Composite: report INDEX — People Master roster joined to per-notice view/ack
// aggregates so "Báo cáo tiếp nhận" scales to 100+ notices in one round trip.
// Read-only aggregate; same manage gate as noticeReport.
async function reportIndex(session) {
  const actor = await resolveNoticeActor(session);
  const rows = await loadOrgRows();
  const roster = rows.map((r) => ({
    employeeCode: r.employeeCode,
    department: r.department || '', branch: r.branch || '',
    active: isActiveStatus(r.status),
  }));
  return callNoticeAction('notice.report.index', actor, { roster });
}

// Composite: the permission screen roster — People Master active list + current
// notice.notice_permissions merged (like qtth listRoster).
async function permissionRoster(session) {
  const actor = await resolveNoticeActor(session);
  // "Cài đặt quyền" is system-Admin ONLY (§C/§D). Fail here before touching the
  // People Master roster; phf-hr-api's notice.permissions.list also enforces it.
  if (String(actor.systemRole || '') !== 'admin') {
    const e = new Error('Chỉ Admin hệ thống được mở Cài đặt quyền.');
    e.code = 'NOTICE_ADMIN_REQUIRED'; e.statusCode = 403;
    throw e;
  }
  const [rows, perms, adminCodes] = await Promise.all([
    loadOrgRows(),
    callNoticeAction('notice.permissions.list', actor, {}),
    listAdminEmployeeCodes().catch(() => new Set()),
  ]);
  const permByCode = new Map((perms.permissions || []).map((p) => [p.employeeCode, p]));
  let noManage = 0;
  const roster = rows.map((r) => {
    const active = isActiveStatus(r.status);
    const p = permByCode.get(r.employeeCode) || null;
    const grant = !!(p && p.canManage);
    // A system Admin ALWAYS has full Thông báo authority (server-authoritative
    // in phf-hr-api: isAdmin(actor) short-circuits every manage check). The
    // module grant toggle is only for NON-admins — so the row must read
    // "Toàn quyền (Admin hệ thống)", never an OFF toggle that misleads.
    const isSystemAdmin = adminCodes.has(String(r.employeeCode || '').toUpperCase());
    const canManage = grant || isSystemAdmin;
    if (active && !canManage) noManage++;
    return {
      employeeCode: r.employeeCode, fullName: r.fullName,
      status: active ? 'active' : 'inactive',
      department: r.department || '', branch: r.branch || '', title: r.title || r.position || '',
      canManage, grant, isSystemAdmin,
      permissionUpdatedByName: p ? p.updatedByName || '' : '',
      permissionUpdatedAt: p ? p.updatedAt : null,
    };
  });
  return { roster, warnings: { activeWithoutManage: noManage } };
}

// "Áp dụng" picker options — distinct active department / branch labels from the
// People Master (the existing loadOrgRows source; no schema, no new datastore).
// Values are the same strings a notice.scope stores, so semantics are unchanged:
// "Áp dụng" stays a label + report denominator, NOT a visibility ACL.
async function orgScopes(session) {
  const actor = await resolveNoticeActor(session);
  if (String(actor.systemRole || '') !== 'admin' && !actor.employeeCode) {
    const e = new Error('Chưa xác định danh tính.'); e.code = 'NOTICE_IDENTITY_REQUIRED'; e.statusCode = 401; throw e;
  }
  const rows = await loadOrgRows();
  const dep = new Set(), br = new Set();
  for (const r of rows) {
    if (!isActiveStatus(r.status)) continue;
    const d = str(r.department); if (d) dep.add(d.trim());
    const b = str(r.branch); if (b) br.add(b.trim());
  }
  const vi = (a, z) => a.localeCompare(z, 'vi');
  return { departments: Array.from(dep).sort(vi), branches: Array.from(br).sort(vi) };
}

async function dispatchNoticeAction(session, payload) {
  const action = String((payload && payload.action) || '').trim();

  if (action === 'noticeReport') {
    return { handled: true, result: await report(session, payload || {}) };
  }
  if (action === 'noticeReportIndex') {
    return { handled: true, result: await reportIndex(session) };
  }
  if (action === 'noticePermissionRoster') {
    return { handled: true, result: await permissionRoster(session) };
  }
  if (action === 'noticeOrgScopes') {
    return { handled: true, result: await orgScopes(session) };
  }

  const entry = PASSTHROUGH[action];
  if (!entry) return { handled: false };

  const actor = await resolveNoticeActor(session);
  const result = await callNoticeAction(entry.remote, actor, entry.params(payload || {}));
  return { handled: true, result };
}

const NOTICE_ACTION_MANIFEST = Object.freeze([
  'noticeBootstrap', 'noticeFeed', 'noticeDetail', 'noticeAcknowledge',
  'noticeCreate', 'noticeUpdate', 'noticePublish', 'noticeSetPin', 'noticeDelete',
  'noticeRevisions', 'noticeAuditLog', 'noticeReport', 'noticeReportIndex',
  'noticeAttachmentAdd', 'noticeAttachmentRemove', 'noticeAttachmentDownload',
  'noticeCategoriesList', 'noticeCategoriesUpsert', 'noticeCategoriesReorder', 'noticeSimilar',
  'noticePermissionRoster', 'noticeSetPermission', 'noticePermissionHistory',
  'noticeOrgScopes',
]);

module.exports = { dispatchNoticeAction, NOTICE_ACTION_MANIFEST };
