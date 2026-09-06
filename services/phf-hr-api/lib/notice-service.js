'use strict';

// PHF HR — THÔNG BÁO QUẢN TRỊ V1 · Batch 01 · phf-hr-api action dispatcher.
//
// ONE canonical action map, shared by the phf-hr-api HTTP route (POST /v1/notice)
// and the Vercel bridge (api/_lib/notice-bridge.js) so the action list never
// drifts between layers. Mirrors services/phf-hr-api/lib/qtth-service.js.
//
// Every handler is (config, actor, params). `actor` is the VERIFIED actor
// resolved on the Vercel side against the People Master (Supabase MAIN). This
// service never resolves identity itself and the client can never supply an
// authoritative actor.
//
// Company PostgreSQL phf_hr / schema notice.* ONLY (dev/throwaway: phf_hr_e2e).
// Every DB call goes through the Task runtime-identity helpers
// (withTaskReadTransaction / withTaskWriteTransaction: BEGIN -> SET LOCAL ROLE
// phf_hr_app -> work -> COMMIT/ROLLBACK). No Supabase here, no People Master.
//
// AUTHORIZATION IS SERVER-AUTHORITATIVE HERE:
//   - PUBLIC business read: every VERIFIED actor may read every published,
//     non-deleted notice, search it, open it (records a view), acknowledge it —
//     regardless of the notice's "Áp dụng" scope (§7 of the brief).
//   - MANAGE (create/edit/publish/pin/delete/report/permission/audit):
//       system Admin (actor.systemRole === 'admin')      -> always
//       an explicit notice.notice_permissions.can_manage -> yes
//       anyone else                                      -> denied
//     Manage authority is NEVER inferred from job title / department / Task /
//     Competition / Checklist / QTTH.
//   - DEVELOPMENT ACCESS LOCK (NOTICE_DEV_ACCESS_ALLOW): while the module is not
//     final, EVERY action except notice.bootstrap is refused for a caller who is
//     neither system Admin nor on the allow-list. Entirely env-controlled;
//     GO-LIVE = unset the env, no code change, no permission-data change.

const { withTaskReadTransaction, withTaskWriteTransaction } = require('./db');

const NOTICE_TYPES = ['regulation', 'policy', 'process', 'guide'];

class NoticeError extends Error {
  constructor(code, message, statusCode) {
    super(message || code);
    this.code = code;
    this.statusCode = statusCode || 400;
    this.isNoticeError = true;
  }
}
function nErr(code, message, statusCode) { return new NoticeError(code, message, statusCode); }

function mapPgError(err) {
  const code = String((err && err.code) || '');
  if (code === '23505') return nErr('NOTICE_DUPLICATE', 'Bản ghi trùng.', 409);
  if (code === '23503') return nErr('NOTICE_FK_VIOLATION', 'Tham chiếu không hợp lệ.', 409);
  if (code === '23514') return nErr('NOTICE_CHECK_VIOLATION', 'Dữ liệu không hợp lệ.', 400);
  if (code === '42P01' || code === '3F000') return nErr('NOTICE_SCHEMA_MISSING', 'Schema notice chưa được cài đặt. Hãy chạy migrations/phf_hr_notice_v1.sql.', 503);
  if (code === '42501') return nErr('NOTICE_PERMISSION_DENIED', 'Thiếu quyền truy cập dữ liệu Thông báo ở tầng CSDL.', 500);
  if (code === '57014') return nErr('NOTICE_READ_TIMEOUT', 'Truy vấn Thông báo quá thời gian chờ.', 504);
  if (code === 'P0001' && /APPEND_ONLY/.test(String(err.message || ''))) return nErr('NOTICE_IMMUTABLE', 'Không thể sửa/xóa dữ liệu lịch sử.', 409);
  return null;
}
async function readTx(config, fn) {
  try { return await withTaskReadTransaction(config, fn); } catch (e) { throw mapPgError(e) || e; }
}
async function writeTx(config, fn) {
  try { return await withTaskWriteTransaction(config, fn); } catch (e) { throw mapPgError(e) || e; }
}

function text(v) { const s = v == null ? '' : String(v).trim(); return s === '' ? null : s; }
function upperCode(v) { const s = text(v); return s ? s.toUpperCase() : null; }
function boolish(v) { return v === true || v === 'true'; }
function assertActor(actor) {
  if (!actor || typeof actor !== 'object') throw nErr('NOTICE_ACTOR_REQUIRED', 'Thiếu actor đã xác thực.', 401);
  const accountId = text(actor.accountId);
  const employeeCode = upperCode(actor.employeeCode);
  if (!accountId && !employeeCode) throw nErr('NOTICE_ACTOR_REQUIRED', 'Actor không có định danh.', 401);
  return {
    accountId, employeeCode,
    displayName: text(actor.displayName),
    systemRole: String(actor.systemRole || 'learner'),
  };
}
function isAdmin(actor) { return actor.systemRole === 'admin'; }
function viewerKey(actor) { return actor.employeeCode ? 'EMP:' + actor.employeeCode : 'ACC:' + actor.accountId; }

// --- DEVELOPMENT ACCESS LOCK -------------------------------------------------
function devAccessAllowList() {
  return String(process.env.NOTICE_DEV_ACCESS_ALLOW || '')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}
function evalDevAccess(actor) {
  const list = devAccessAllowList();
  if (!list.length) return { locked: false, allowed: true, operator: false };
  if (isAdmin(actor)) return { locked: true, allowed: true, operator: false };
  const acc = String(actor.accountId || '').toUpperCase();
  const emp = String(actor.employeeCode || '').toUpperCase();
  const allowed = (acc && list.indexOf(acc) >= 0) || (emp && list.indexOf(emp) >= 0);
  return { locked: true, allowed: !!allowed, operator: !!allowed };
}

// --- authority -------------------------------------------------------------
async function isContentManager(config, actor) {
  if (isAdmin(actor)) return true;
  if (actor._devOperator) return true;
  if (!actor.employeeCode) return false;
  return readTx(config, async (c) => {
    const r = await c.query('SELECT can_manage FROM notice.notice_permissions WHERE employee_code = $1', [actor.employeeCode]);
    return r.rowCount > 0 && r.rows[0].can_manage === true;
  });
}
async function requireManage(config, actor) {
  if (await isContentManager(config, actor)) return;
  throw nErr('NOTICE_MANAGE_DENIED', 'Bạn không có quyền quản trị nội dung Thông báo Quản trị.', 403);
}
function requireAdmin(actor) {
  if (!isAdmin(actor)) throw nErr('NOTICE_ADMIN_REQUIRED', 'Chỉ Admin được thực hiện thao tác này.', 403);
}

function auditActor(actor) { return [actor.accountId || null, actor.employeeCode || null, actor.displayName || actor.employeeCode || actor.accountId || null]; }
async function writeAudit(c, actor, noticeId, actionType, beforeJson, afterJson) {
  const [a, e, n] = auditActor(actor);
  await c.query(
    `INSERT INTO notice.notice_audit_logs (notice_id, actor_account_id, actor_employee_code, actor_name, action_type, before_json, after_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [noticeId, a, e, n, actionType, beforeJson ? JSON.stringify(beforeJson) : null, afterJson ? JSON.stringify(afterJson) : null]
  );
}

// --- effective status (DERIVED, never stored) ------------------------------
function todayISO() { const d = new Date(Date.now() + 7 * 3600 * 1000); return d.toISOString().slice(0, 10); }
function effectiveStatus(row, today) {
  if (row.deleted_at) return 'deleted';
  if (row.status !== 'published') return 'draft';
  const t = today || todayISO();
  const from = row.effective_from instanceof Date ? row.effective_from.toISOString().slice(0, 10) : String(row.effective_from).slice(0, 10);
  const to = row.effective_to ? (row.effective_to instanceof Date ? row.effective_to.toISOString().slice(0, 10) : String(row.effective_to).slice(0, 10)) : null;
  if (t < from) return 'upcoming';
  if (to && t > to) return 'expired';
  return 'active';
}
function statusRank(s) { return s === 'active' ? 0 : s === 'upcoming' ? 1 : s === 'expired' ? 2 : 3; }

function dateOnly(v) {
  const s = text(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw nErr('NOTICE_DATE_INVALID', 'Ngày phải theo định dạng YYYY-MM-DD.', 400);
  return s;
}
function assertType(v) {
  const s = text(v);
  if (!s || NOTICE_TYPES.indexOf(s) < 0) throw nErr('NOTICE_TYPE_INVALID', 'Loại thông báo không hợp lệ.', 400);
  return s;
}
function normScopes(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const s of arr) {
    const type = text(s && s.scopeType);
    if (['company', 'department', 'branch'].indexOf(type) < 0) continue;
    const value = type === 'company' ? null : text(s && s.scopeValue);
    if (type !== 'company' && !value) continue;
    const key = type + '|' + (value || '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ scopeType: type, scopeValue: value });
  }
  if (!out.length) out.push({ scopeType: 'company', scopeValue: null });
  return out;
}
function normKeywords(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const k of arr) {
    const v = text(k);
    if (!v) continue;
    const lk = v.toLowerCase();
    if (seen.has(lk)) continue;
    seen.add(lk);
    out.push(v);
  }
  return out;
}
function excerpt(t, n) {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length > (n || 240) ? s.slice(0, n || 240) + '…' : s;
}

async function loadFullNotice(c, id) {
  const nr = await c.query('SELECT * FROM notice.notices WHERE id = $1', [id]);
  if (!nr.rowCount) throw nErr('NOTICE_NOT_FOUND', 'Không tìm thấy thông báo.', 404);
  const [sc, kw, at, rv] = await Promise.all([
    c.query('SELECT scope_type, scope_value FROM notice.notice_scopes WHERE notice_id = $1 ORDER BY scope_type, scope_value', [id]),
    c.query('SELECT keyword FROM notice.notice_keywords WHERE notice_id = $1 ORDER BY lower(keyword)', [id]),
    c.query('SELECT id, kind, file_type, file_name, storage_key, link_url, byte_size, created_at FROM notice.notice_attachments WHERE notice_id = $1 AND deleted_at IS NULL ORDER BY created_at', [id]),
    c.query('SELECT id, revision_no, require_reacknowledgement, change_summary, created_by_name, created_at FROM notice.notice_revisions WHERE notice_id = $1 ORDER BY revision_no DESC', [id]),
  ]);
  return { row: nr.rows[0], scopes: sc.rows, keywords: kw.rows.map((r) => r.keyword), attachments: at.rows, revisions: rv.rows };
}
function shapeNotice(full, today) {
  const r = full.row;
  return {
    id: r.id,
    title: r.title,
    contentHtml: r.content_html || '',
    contentText: r.content_text || '',
    noticeType: r.notice_type,
    effectiveFrom: r.effective_from ? String(r.effective_from).slice(0, 10) : null,
    effectiveTo: r.effective_to ? String(r.effective_to).slice(0, 10) : null,
    requireAcknowledgement: r.require_acknowledgement === true,
    isPinned: r.is_pinned === true,
    status: r.status,
    publishedAt: r.published_at,
    effectiveStatus: effectiveStatus(r, today),
    replacedNoticeId: r.replaced_notice_id || null,
    supersededByNoticeId: r.superseded_by_notice_id || null,
    currentRevisionId: r.current_revision_id || null,
    deletedAt: r.deleted_at || null,
    createdByName: r.created_by_name || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    scopes: (full.scopes || []).map((s) => ({ scopeType: s.scope_type, scopeValue: s.scope_value })),
    keywords: full.keywords || [],
    attachments: (full.attachments || []).map((a) => ({
      id: a.id, kind: a.kind, fileType: a.file_type, fileName: a.file_name,
      storageKey: a.storage_key, linkUrl: a.link_url, byteSize: a.byte_size, createdAt: a.created_at,
    })),
    revisions: (full.revisions || []).map((v) => ({
      id: v.id, revisionNo: v.revision_no, requireReacknowledgement: v.require_reacknowledgement === true,
      changeSummary: v.change_summary || '', createdByName: v.created_by_name || '', createdAt: v.created_at,
    })),
  };
}

async function snapshotRevisionMeta(c, id) {
  const full = await loadFullNotice(c, id);
  const r = full.row;
  return {
    notice_type: r.notice_type,
    effective_from: r.effective_from ? String(r.effective_from).slice(0, 10) : null,
    effective_to: r.effective_to ? String(r.effective_to).slice(0, 10) : null,
    require_acknowledgement: r.require_acknowledgement === true,
    scopes: full.scopes.map((s) => ({ scopeType: s.scope_type, scopeValue: s.scope_value })),
    keywords: full.keywords,
  };
}

// Create a revision row for a notice, bump current_revision_id.
async function createRevision(c, actor, id, requireReack, changeSummary) {
  const full = await loadFullNotice(c, id);
  const r = full.row;
  const noRes = await c.query('SELECT COALESCE(MAX(revision_no),0)+1 AS n FROM notice.notice_revisions WHERE notice_id = $1', [id]);
  const revisionNo = noRes.rows[0].n;
  const [a, e, n] = auditActor(actor);
  const meta = await snapshotRevisionMeta(c, id);
  const ins = await c.query(
    `INSERT INTO notice.notice_revisions
       (notice_id, revision_no, title_snapshot, content_html_snapshot, content_text_snapshot, metadata_snapshot, require_reacknowledgement, change_summary, created_by_account_id, created_by_employee_code, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [id, revisionNo, r.title, r.content_html || '', r.content_text || '', JSON.stringify(meta), !!requireReack, text(changeSummary), a, e, n]
  );
  const revId = ins.rows[0].id;
  await c.query('UPDATE notice.notices SET current_revision_id = $1 WHERE id = $2', [revId, id]);
  return { revisionId: revId, revisionNo };
}

// =========================================================================
const HANDLERS = {
  'notice.bootstrap': async (config, actor, params, devGate) => {
    const admin = isAdmin(actor);
    const dg = devGate || evalDevAccess(actor);
    if (dg.locked && !dg.allowed) {
      return {
        viewer: { accountId: actor.accountId, employeeCode: actor.employeeCode, displayName: actor.displayName, systemRole: actor.systemRole, isAdmin: admin },
        capabilities: { canManage: false },
        devLocked: true,
        lockReason: 'Thông báo Quản trị đang trong giai đoạn phát triển — chỉ Admin và người vận hành được chỉ định mới truy cập được cho đến khi GO-LIVE.',
      };
    }
    let canManage = admin || (dg.locked && dg.operator);
    if (!canManage && actor.employeeCode) {
      canManage = await readTx(config, async (c) => {
        const r = await c.query('SELECT can_manage FROM notice.notice_permissions WHERE employee_code = $1', [actor.employeeCode]);
        return r.rowCount > 0 && r.rows[0].can_manage === true;
      });
    }
    return {
      viewer: { accountId: actor.accountId, employeeCode: actor.employeeCode, displayName: actor.displayName, systemRole: actor.systemRole, isAdmin: admin },
      capabilities: { canManage: !!canManage },
      devLocked: !!dg.locked,
      devOperator: !!(dg.locked && dg.operator && !admin),
    };
  },

  // ---- FEED (public business read) ---------------------------------------
  'notice.feed': async (config, actor, params) => {
    const canManage = await isContentManager(config, actor);
    const today = todayISO();
    const q = text(params && params.q);
    const typeFilter = text(params && params.type);
    const statusFilter = text(params && params.status); // active | upcoming | expired
    const scopeFilter = text(params && params.scope);   // department/branch label
    const includeDrafts = canManage && boolish(params && params.includeDrafts);

    return readTx(config, async (c) => {
      const where = ['n.deleted_at IS NULL'];
      const vals = [];
      if (includeDrafts) {
        where.push("(n.status = 'published' OR n.status = 'draft')");
      } else {
        where.push("n.status = 'published'");
      }
      if (typeFilter && NOTICE_TYPES.indexOf(typeFilter) >= 0) { vals.push(typeFilter); where.push('n.notice_type = $' + vals.length); }
      let rankSql = '0';
      if (q) {
        vals.push(q);
        rankSql = `ts_rank(n.search_tsv, websearch_to_tsquery('simple', notice.vn_unaccent($${vals.length})))`;
        where.push(`n.search_tsv @@ websearch_to_tsquery('simple', notice.vn_unaccent($${vals.length}))`);
      }
      if (scopeFilter) {
        vals.push(scopeFilter);
        where.push(`EXISTS (SELECT 1 FROM notice.notice_scopes s WHERE s.notice_id = n.id AND (s.scope_type = 'company' OR s.scope_value = $${vals.length}))`);
      }
      const rows = (await c.query(
        `SELECT n.*, ${rankSql} AS rank_score FROM notice.notices n WHERE ${where.join(' AND ')} LIMIT 500`, vals
      )).rows;
      if (!rows.length) return { today, notices: [], total: 0 };

      const ids = rows.map((r) => r.id);
      const vkey = viewerKey(actor);
      const [scopeRows, kwRows, viewRows, ackRows, attCount] = await Promise.all([
        c.query('SELECT notice_id, scope_type, scope_value FROM notice.notice_scopes WHERE notice_id = ANY($1)', [ids]),
        c.query('SELECT notice_id, keyword FROM notice.notice_keywords WHERE notice_id = ANY($1)', [ids]),
        c.query('SELECT notice_id, first_viewed_at, last_viewed_at FROM notice.notice_views WHERE notice_id = ANY($1) AND viewer_key = $2', [ids, vkey]),
        c.query('SELECT a.notice_id, a.revision_id FROM notice.notice_acknowledgements a WHERE a.notice_id = ANY($1) AND a.acker_key = $2', [ids, vkey]),
        c.query('SELECT notice_id, count(*)::int AS n FROM notice.notice_attachments WHERE notice_id = ANY($1) AND deleted_at IS NULL GROUP BY notice_id', [ids]),
      ]);
      const scopeBy = new Map(); scopeRows.rows.forEach((r) => { (scopeBy.get(r.notice_id) || scopeBy.set(r.notice_id, []).get(r.notice_id)).push({ scopeType: r.scope_type, scopeValue: r.scope_value }); });
      const kwBy = new Map(); kwRows.rows.forEach((r) => { (kwBy.get(r.notice_id) || kwBy.set(r.notice_id, []).get(r.notice_id)).push(r.keyword); });
      const viewBy = new Map(viewRows.rows.map((r) => [r.notice_id, r]));
      const ackBy = new Map(ackRows.rows.map((r) => [r.notice_id, r.revision_id]));
      const attBy = new Map(attCount.rows.map((r) => [r.notice_id, r.n]));

      const list = rows.map((r) => {
        const es = effectiveStatus(r, today);
        const ackRev = ackBy.get(r.id) || null;
        return {
          id: r.id,
          title: r.title,
          excerpt: excerpt(r.content_text, 240),
          noticeType: r.notice_type,
          effectiveFrom: r.effective_from ? String(r.effective_from).slice(0, 10) : null,
          effectiveTo: r.effective_to ? String(r.effective_to).slice(0, 10) : null,
          effectiveStatus: es,
          status: r.status,
          isPinned: r.is_pinned === true,
          requireAcknowledgement: r.require_acknowledgement === true,
          publishedAt: r.published_at,
          updatedAt: r.updated_at,
          scopes: scopeBy.get(r.id) || [],
          keywords: kwBy.get(r.id) || [],
          attachmentCount: attBy.get(r.id) || 0,
          supersededByNoticeId: r.superseded_by_notice_id || null,
          replacedNoticeId: r.replaced_notice_id || null,
          viewer: {
            viewed: viewBy.has(r.id),
            firstViewedAt: viewBy.has(r.id) ? viewBy.get(r.id).first_viewed_at : null,
            acknowledged: !!ackRev,
            acknowledgedRevisionIsCurrent: ackRev ? ackRev === r.current_revision_id : false,
          },
          rankScore: Number(r.rank_score) || 0,
        };
      });

      list.sort((x, y) => {
        if (x.isPinned !== y.isPinned) return x.isPinned ? -1 : 1;
        const sr = statusRank(x.effectiveStatus) - statusRank(y.effectiveStatus);
        if (sr !== 0) return sr;
        if (q && y.rankScore !== x.rankScore) return y.rankScore - x.rankScore;
        return new Date(y.publishedAt || y.updatedAt) - new Date(x.publishedAt || x.updatedAt);
      });

      let filtered = list;
      if (statusFilter && ['active', 'upcoming', 'expired'].indexOf(statusFilter) >= 0) {
        filtered = list.filter((n) => n.effectiveStatus === statusFilter);
      }
      return { today, notices: filtered, total: filtered.length };
    });
  },

  // Open detail — records a view (first/last), returns full notice + viewer state.
  'notice.detail': async (config, actor, params) => {
    const id = text(params && params.id);
    if (!id) throw nErr('NOTICE_ID_REQUIRED', 'Thiếu mã thông báo.', 400);
    const today = todayISO();
    return writeTx(config, async (c) => {
      const full = await loadFullNotice(c, id);
      if (full.row.deleted_at && !(await isContentManager(config, actor))) {
        throw nErr('NOTICE_NOT_FOUND', 'Không tìm thấy thông báo.', 404);
      }
      if (full.row.status !== 'published' && !(await isContentManager(config, actor))) {
        throw nErr('NOTICE_NOT_FOUND', 'Không tìm thấy thông báo.', 404);
      }
      // record view (only for published, non-deleted — a manager previewing a
      // draft does not create a "Đã xem" event)
      let viewerState = { viewed: false, firstViewedAt: null, lastViewedAt: null, acknowledged: false, acknowledgedRevisionId: null, acknowledgedRevisionIsCurrent: false };
      if (full.row.status === 'published' && !full.row.deleted_at) {
        const vkey = viewerKey(actor);
        const up = await c.query(
          `INSERT INTO notice.notice_views (notice_id, viewer_key, account_id, employee_code)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (notice_id, viewer_key) DO UPDATE SET last_viewed_at = now(), view_count = notice.notice_views.view_count + 1
           RETURNING first_viewed_at, last_viewed_at`,
          [id, vkey, actor.accountId || null, actor.employeeCode || null]
        );
        const ack = await c.query('SELECT revision_id FROM notice.notice_acknowledgements WHERE notice_id = $1 AND acker_key = $2 ORDER BY acknowledged_at DESC LIMIT 1', [id, vkey]);
        viewerState = {
          viewed: true,
          firstViewedAt: up.rows[0].first_viewed_at,
          lastViewedAt: up.rows[0].last_viewed_at,
          acknowledged: ack.rowCount > 0,
          acknowledgedRevisionId: ack.rowCount ? ack.rows[0].revision_id : null,
          acknowledgedRevisionIsCurrent: ack.rowCount ? ack.rows[0].revision_id === full.row.current_revision_id : false,
        };
      }
      const shaped = shapeNotice(full, today);
      let replacement = null;
      if (full.row.superseded_by_notice_id) {
        const rp = await c.query('SELECT id, title FROM notice.notices WHERE id = $1', [full.row.superseded_by_notice_id]);
        if (rp.rowCount) replacement = { id: rp.rows[0].id, title: rp.rows[0].title };
      }
      let replaces = null;
      if (full.row.replaced_notice_id) {
        const rp = await c.query('SELECT id, title FROM notice.notices WHERE id = $1', [full.row.replaced_notice_id]);
        if (rp.rowCount) replaces = { id: rp.rows[0].id, title: rp.rows[0].title };
      }
      return { today, notice: shaped, viewer: viewerState, replacement, replaces, canManage: await isContentManager(config, actor) };
    });
  },

  'notice.acknowledge': async (config, actor, params) => {
    const id = text(params && params.id);
    if (!id) throw nErr('NOTICE_ID_REQUIRED', 'Thiếu mã thông báo.', 400);
    return writeTx(config, async (c) => {
      const r = await c.query('SELECT id, status, deleted_at, current_revision_id FROM notice.notices WHERE id = $1', [id]);
      if (!r.rowCount || r.rows[0].deleted_at || r.rows[0].status !== 'published') throw nErr('NOTICE_NOT_FOUND', 'Không tìm thấy thông báo.', 404);
      const revId = r.rows[0].current_revision_id;
      if (!revId) throw nErr('NOTICE_NO_REVISION', 'Thông báo chưa có phiên bản để xác nhận.', 409);
      const vkey = viewerKey(actor);
      const ins = await c.query(
        `INSERT INTO notice.notice_acknowledgements (notice_id, revision_id, acker_key, account_id, employee_code, acker_name)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (revision_id, acker_key) DO NOTHING
         RETURNING acknowledged_at`,
        [id, revId, vkey, actor.accountId || null, actor.employeeCode || null, actor.displayName || null]
      );
      // ensure a view row exists too
      await c.query(
        `INSERT INTO notice.notice_views (notice_id, viewer_key, account_id, employee_code)
         VALUES ($1,$2,$3,$4) ON CONFLICT (notice_id, viewer_key) DO UPDATE SET last_viewed_at = now()`,
        [id, vkey, actor.accountId || null, actor.employeeCode || null]
      );
      return { id, revisionId: revId, acknowledged: true, alreadyAcknowledged: ins.rowCount === 0 };
    });
  },

  // ---- MANAGE: create / update / publish --------------------------------
  'notice.create': async (config, actor, params) => {
    await requireManage(config, actor);
    const title = text(params && params.title);
    if (!title) throw nErr('NOTICE_TITLE_REQUIRED', 'Tiêu đề là bắt buộc.', 400);
    const contentHtml = params && params.contentHtml != null ? String(params.contentHtml) : '';
    const contentText = text(params && params.contentText) || String(contentHtml).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!contentText) throw nErr('NOTICE_CONTENT_REQUIRED', 'Nội dung trên web là bắt buộc.', 400);
    const noticeType = assertType(params && params.noticeType);
    const effectiveFrom = dateOnly(params && params.effectiveFrom) || todayISO();
    const effectiveTo = dateOnly(params && params.effectiveTo);
    if (effectiveTo && effectiveTo < effectiveFrom) throw nErr('NOTICE_DATE_RANGE', 'Ngày hết hiệu lực phải sau ngày hiệu lực.', 400);
    const requireAck = boolish(params && params.requireAcknowledgement);
    const scopes = normScopes(params && params.scopes);
    const keywords = normKeywords(params && params.keywords);
    const replacedNoticeId = text(params && params.replacedNoticeId);

    return writeTx(config, async (c) => {
      const [a, e, n] = auditActor(actor);
      const ins = await c.query(
        `INSERT INTO notice.notices
           (title, content_html, content_text, notice_type, effective_from, effective_to, require_acknowledgement, status, replaced_notice_id, created_by_account_id, created_by_employee_code, created_by_name, updated_by_account_id, updated_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11,$9,$11) RETURNING id`,
        [title, contentHtml, contentText, noticeType, effectiveFrom, effectiveTo, requireAck, replacedNoticeId, a, e, n]
      );
      const id = ins.rows[0].id;
      for (const s of scopes) await c.query('INSERT INTO notice.notice_scopes (notice_id, scope_type, scope_value) VALUES ($1,$2,$3)', [id, s.scopeType, s.scopeValue]);
      for (const k of keywords) await c.query('INSERT INTO notice.notice_keywords (notice_id, keyword) VALUES ($1,$2)', [id, k]);
      await writeAudit(c, actor, id, 'create', null, { title, noticeType, effectiveFrom, effectiveTo, requireAck, scopes, keywords, replacedNoticeId: replacedNoticeId || null });
      return { id, status: 'draft' };
    });
  },

  'notice.update': async (config, actor, params) => {
    await requireManage(config, actor);
    const id = text(params && params.id);
    if (!id) throw nErr('NOTICE_ID_REQUIRED', 'Thiếu mã thông báo.', 400);
    const requireReack = boolish(params && params.requireReacknowledgement);
    const changeSummary = text(params && params.changeSummary);

    return writeTx(config, async (c) => {
      const before = await loadFullNotice(c, id);
      if (before.row.deleted_at) throw nErr('NOTICE_DELETED', 'Thông báo đã bị xóa.', 409);
      const b = before.row;
      const set = [];
      const vals = [];
      const beforeJson = {};
      const afterJson = {};
      const put = (col, val, key) => { vals.push(val); set.push(col + ' = $' + vals.length); beforeJson[key] = b[col] instanceof Date ? String(b[col]).slice(0, 10) : b[col]; afterJson[key] = val; };

      if (params && params.title != null) { const t = text(params.title); if (!t) throw nErr('NOTICE_TITLE_REQUIRED', 'Tiêu đề là bắt buộc.', 400); if (t !== b.title) put('title', t, 'title'); }
      if ((params && params.contentHtml != null) || (params && params.contentText != null)) {
        const html = params.contentHtml != null ? String(params.contentHtml)
          : (text(params.contentText) ? '<p>' + text(params.contentText).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>') + '</p>' : b.content_html);
        const txt = text(params.contentText) || String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!txt) throw nErr('NOTICE_CONTENT_REQUIRED', 'Nội dung trên web là bắt buộc.', 400);
        if (html !== b.content_html) put('content_html', html, 'contentHtml');
        if (txt !== b.content_text) put('content_text', txt, 'contentText');
      }
      if (params && params.noticeType != null) { const ty = assertType(params.noticeType); if (ty !== b.notice_type) put('notice_type', ty, 'noticeType'); }
      let effFrom = b.effective_from ? String(b.effective_from).slice(0, 10) : null;
      let effTo = b.effective_to ? String(b.effective_to).slice(0, 10) : null;
      if (params && params.effectiveFrom != null) { const d = dateOnly(params.effectiveFrom); if (d && d !== effFrom) { put('effective_from', d, 'effectiveFrom'); effFrom = d; } }
      if (params && Object.prototype.hasOwnProperty.call(params, 'effectiveTo')) { const d = dateOnly(params.effectiveTo); if (d !== effTo) { put('effective_to', d, 'effectiveTo'); effTo = d; } }
      if (effTo && effFrom && effTo < effFrom) throw nErr('NOTICE_DATE_RANGE', 'Ngày hết hiệu lực phải sau ngày hiệu lực.', 400);
      if (params && Object.prototype.hasOwnProperty.call(params, 'requireAcknowledgement')) {
        const ra = boolish(params.requireAcknowledgement);
        if (ra !== (b.require_acknowledgement === true)) put('require_acknowledgement', ra, 'requireAcknowledgement');
      }

      let scopesChanged = false;
      let keywordsChanged = false;
      if (params && Array.isArray(params.scopes)) {
        const scopes = normScopes(params.scopes);
        await c.query('DELETE FROM notice.notice_scopes WHERE notice_id = $1', [id]);
        for (const s of scopes) await c.query('INSERT INTO notice.notice_scopes (notice_id, scope_type, scope_value) VALUES ($1,$2,$3)', [id, s.scopeType, s.scopeValue]);
        scopesChanged = true;
        beforeJson.scopes = before.scopes.map((s) => ({ scopeType: s.scope_type, scopeValue: s.scope_value }));
        afterJson.scopes = scopes;
      }
      if (params && Array.isArray(params.keywords)) {
        const keywords = normKeywords(params.keywords);
        await c.query('DELETE FROM notice.notice_keywords WHERE notice_id = $1', [id]);
        for (const k of keywords) await c.query('INSERT INTO notice.notice_keywords (notice_id, keyword) VALUES ($1,$2)', [id, k]);
        keywordsChanged = true;
        beforeJson.keywords = before.keywords;
        afterJson.keywords = keywords;
      }

      if (set.length) {
        const [a, n] = [actor.accountId || null, actor.displayName || actor.employeeCode || null];
        vals.push(a); set.push('updated_by_account_id = $' + vals.length);
        vals.push(n); set.push('updated_by_name = $' + vals.length);
        vals.push(id);
        await c.query('UPDATE notice.notices SET ' + set.join(', ') + ' WHERE id = $' + vals.length, vals);
      }

      const anyChange = set.length || scopesChanged || keywordsChanged;
      if (!anyChange) return { id, changed: false };

      await writeAudit(c, actor, id, 'edit', beforeJson, afterJson);

      // For a PUBLISHED notice: cut a new revision. require_reacknowledgement
      // marks whether existing acks are invalidated for the new revision.
      let revision = null;
      if (b.status === 'published') {
        revision = await createRevision(c, actor, id, requireReack, changeSummary);
        if (requireReack) await writeAudit(c, actor, id, 'require_reack', null, { revisionNo: revision.revisionNo });
      }
      return { id, changed: true, revision, requireReack: b.status === 'published' ? !!requireReack : null };
    });
  },

  'notice.publish': async (config, actor, params) => {
    await requireManage(config, actor);
    const id = text(params && params.id);
    if (!id) throw nErr('NOTICE_ID_REQUIRED', 'Thiếu mã thông báo.', 400);
    const today = todayISO();
    return writeTx(config, async (c) => {
      const before = await loadFullNotice(c, id);
      const b = before.row;
      if (b.deleted_at) throw nErr('NOTICE_DELETED', 'Thông báo đã bị xóa.', 409);
      if (b.status === 'published') throw nErr('NOTICE_ALREADY_PUBLISHED', 'Thông báo đã được công bố.', 409);
      if (!b.content_text) throw nErr('NOTICE_CONTENT_REQUIRED', 'Nội dung trên web là bắt buộc.', 400);
      await c.query("UPDATE notice.notices SET status = 'published', published_at = now(), updated_by_account_id = $2, updated_by_name = $3 WHERE id = $1",
        [id, actor.accountId || null, actor.displayName || actor.employeeCode || null]);
      const revision = await createRevision(c, actor, id, false, 'Công bố lần đầu');
      await writeAudit(c, actor, id, 'publish', { status: 'draft' }, { status: 'published', revisionNo: revision.revisionNo });

      // Replacement: if this notice replaces an older one AND is effective now,
      // supersede the old one (§13). If effective in the future, defer — a
      // later batch's scheduler/read-path handles the flip; V1 records the link.
      let supersededOld = null;
      if (b.replaced_notice_id) {
        const es = effectiveStatus(Object.assign({}, b, { status: 'published' }), today);
        if (es === 'active' || es === 'expired') {
          const old = await c.query('SELECT id, status, deleted_at, effective_to FROM notice.notices WHERE id = $1', [b.replaced_notice_id]);
          if (old.rowCount && old.rows[0].status === 'published' && !old.rows[0].deleted_at) {
            await c.query('UPDATE notice.notices SET superseded_by_notice_id = $1, effective_to = LEAST(COALESCE(effective_to, $2::date), $2::date) WHERE id = $3', [id, today, b.replaced_notice_id]);
            await writeAudit(c, actor, b.replaced_notice_id, 'superseded', { effectiveTo: old.rows[0].effective_to }, { supersededByNoticeId: id, effectiveTo: today });
            supersededOld = b.replaced_notice_id;
          }
        }
      }
      return { id, status: 'published', revision, supersededOld };
    });
  },

  'notice.setPin': async (config, actor, params) => {
    await requireManage(config, actor);
    const id = text(params && params.id);
    const pinned = boolish(params && params.pinned);
    if (!id) throw nErr('NOTICE_ID_REQUIRED', 'Thiếu mã thông báo.', 400);
    return writeTx(config, async (c) => {
      const cur = await c.query('SELECT is_pinned FROM notice.notices WHERE id = $1 AND deleted_at IS NULL', [id]);
      if (!cur.rowCount) throw nErr('NOTICE_NOT_FOUND', 'Không tìm thấy thông báo.', 404);
      if ((cur.rows[0].is_pinned === true) === pinned) return { id, pinned, changed: false };
      await c.query('UPDATE notice.notices SET is_pinned = $1 WHERE id = $2', [pinned, id]);
      await writeAudit(c, actor, id, pinned ? 'pin' : 'unpin', { isPinned: cur.rows[0].is_pinned === true }, { isPinned: pinned });
      return { id, pinned, changed: true };
    });
  },

  'notice.delete': async (config, actor, params) => {
    await requireManage(config, actor);
    const id = text(params && params.id);
    if (!id) throw nErr('NOTICE_ID_REQUIRED', 'Thiếu mã thông báo.', 400);
    return writeTx(config, async (c) => {
      const cur = await c.query('SELECT id, status, deleted_at FROM notice.notices WHERE id = $1', [id]);
      if (!cur.rowCount) throw nErr('NOTICE_NOT_FOUND', 'Không tìm thấy thông báo.', 404);
      if (cur.rows[0].deleted_at) return { id, deleted: true, mode: 'already' };
      if (cur.rows[0].status === 'draft') {
        // draft with no revisions/acks -> hard delete allowed (§12.1)
        const rev = await c.query('SELECT 1 FROM notice.notice_revisions WHERE notice_id = $1 LIMIT 1', [id]);
        if (!rev.rowCount) {
          await writeAudit(c, actor, id, 'delete_draft', { status: 'draft' }, null);
          await c.query('DELETE FROM notice.notice_scopes WHERE notice_id = $1', [id]);
          await c.query('DELETE FROM notice.notice_keywords WHERE notice_id = $1', [id]);
          await c.query('DELETE FROM notice.notices WHERE id = $1', [id]);
          return { id, deleted: true, mode: 'hard' };
        }
      }
      const [a, n] = [actor.accountId || null, actor.displayName || actor.employeeCode || null];
      await c.query('UPDATE notice.notices SET deleted_at = now(), deleted_by_account_id = $2, deleted_by_name = $3 WHERE id = $1', [id, a, n]);
      await writeAudit(c, actor, id, 'soft_delete', { status: cur.rows[0].status }, { deletedAt: 'now' });
      return { id, deleted: true, mode: 'soft' };
    });
  },

  'notice.revisions': async (config, actor, params) => {
    await requireManage(config, actor);
    const id = text(params && params.id);
    if (!id) throw nErr('NOTICE_ID_REQUIRED', 'Thiếu mã thông báo.', 400);
    return readTx(config, async (c) => {
      const r = await c.query(
        `SELECT id, revision_no, title_snapshot, metadata_snapshot, require_reacknowledgement, change_summary, created_by_name, created_at
         FROM notice.notice_revisions WHERE notice_id = $1 ORDER BY revision_no DESC`, [id]);
      return { id, revisions: r.rows.map((v) => ({
        id: v.id, revisionNo: v.revision_no, titleSnapshot: v.title_snapshot, metadata: v.metadata_snapshot,
        requireReacknowledgement: v.require_reacknowledgement === true, changeSummary: v.change_summary || '',
        createdByName: v.created_by_name || '', createdAt: v.created_at,
      })) };
    });
  },

  'notice.auditLog': async (config, actor, params) => {
    await requireManage(config, actor);
    const id = text(params && params.id);
    return readTx(config, async (c) => {
      const r = await c.query(
        `SELECT id, notice_id, actor_name, actor_employee_code, action_type, before_json, after_json, created_at
         FROM notice.notice_audit_logs ${id ? 'WHERE notice_id = $1' : ''} ORDER BY created_at DESC LIMIT 300`,
        id ? [id] : []);
      return { entries: r.rows.map((x) => ({
        id: x.id, noticeId: x.notice_id, actorName: x.actor_name || '', actorEmployeeCode: x.actor_employee_code || '',
        actionType: x.action_type, before: x.before_json, after: x.after_json, createdAt: x.created_at,
      })) };
    });
  },

  // ---- REPORT: viewed / acknowledged / not-viewed ----------------------
  // roster is supplied by the Vercel layer (People Master): array of
  //   { employeeCode, fullName, department, branch, title, active }
  'notice.report': async (config, actor, params) => {
    await requireManage(config, actor);
    const id = text(params && params.id);
    if (!id) throw nErr('NOTICE_ID_REQUIRED', 'Thiếu mã thông báo.', 400);
    const roster = Array.isArray(params && params.roster) ? params.roster : [];
    return readTx(config, async (c) => {
      const nr = await c.query('SELECT id, current_revision_id, status FROM notice.notices WHERE id = $1', [id]);
      if (!nr.rowCount) throw nErr('NOTICE_NOT_FOUND', 'Không tìm thấy thông báo.', 404);
      const currentRev = nr.rows[0].current_revision_id;
      const scopeRows = (await c.query('SELECT scope_type, scope_value FROM notice.notice_scopes WHERE notice_id = $1', [id])).rows;
      const isCompany = scopeRows.some((s) => s.scope_type === 'company');
      const scopeVals = new Set(scopeRows.filter((s) => s.scope_value).map((s) => String(s.scope_value).toLowerCase()));
      const inScope = (p) => isCompany || scopeVals.has(String(p.department || '').toLowerCase()) || scopeVals.has(String(p.branch || '').toLowerCase());

      const [views, acks] = await Promise.all([
        c.query('SELECT viewer_key, employee_code, first_viewed_at, last_viewed_at FROM notice.notice_views WHERE notice_id = $1', [id]),
        c.query('SELECT acker_key, employee_code, revision_id, acknowledged_at FROM notice.notice_acknowledgements WHERE notice_id = $1', [id]),
      ]);
      const viewByEmp = new Map(); views.rows.forEach((v) => { if (v.employee_code) viewByEmp.set(v.employee_code, v); });
      const ackByEmp = new Map();
      acks.rows.forEach((a) => {
        if (!a.employee_code) return;
        const cur = ackByEmp.get(a.employee_code);
        if (!cur || new Date(a.acknowledged_at) > new Date(cur.acknowledged_at)) ackByEmp.set(a.employee_code, a);
      });

      const primary = [];
      const others = [];
      for (const p of roster) {
        const code = String(p.employeeCode || '').toUpperCase();
        if (!code) continue;
        const v = viewByEmp.get(code) || null;
        const a = ackByEmp.get(code) || null;
        const rec = {
          employeeCode: code, fullName: p.fullName || '', department: p.department || '', branch: p.branch || '',
          title: p.title || '', active: p.active !== false,
          viewedAt: v ? v.first_viewed_at : null, lastViewedAt: v ? v.last_viewed_at : null,
          acknowledgedAt: a ? a.acknowledged_at : null,
          acknowledgedCurrent: a ? a.revision_id === currentRev : false,
        };
        if (inScope(p)) primary.push(rec); else if (v || a) others.push(rec);
      }
      // people who viewed/acked but are not in the roster at all (e.g. since-left)
      const rosterCodes = new Set(roster.map((p) => String(p.employeeCode || '').toUpperCase()));
      const strayCodes = new Set();
      views.rows.forEach((v) => { if (v.employee_code && !rosterCodes.has(v.employee_code)) strayCodes.add(v.employee_code); });
      acks.rows.forEach((a) => { if (a.employee_code && !rosterCodes.has(a.employee_code)) strayCodes.add(a.employee_code); });
      strayCodes.forEach((code) => {
        const v = viewByEmp.get(code) || null;
        const a = ackByEmp.get(code) || null;
        others.push({
          employeeCode: code, fullName: '(không còn trong danh sách)', department: '', branch: '', title: '', active: false,
          viewedAt: v ? v.first_viewed_at : null, lastViewedAt: v ? v.last_viewed_at : null,
          acknowledgedAt: a ? a.acknowledged_at : null, acknowledgedCurrent: a ? a.revision_id === currentRev : false,
        });
      });

      const activePrimary = primary.filter((p) => p.active);
      const summary = {
        denominator: activePrimary.length,
        viewed: activePrimary.filter((p) => p.viewedAt).length,
        acknowledged: activePrimary.filter((p) => p.acknowledgedAt).length,
        acknowledgedCurrent: activePrimary.filter((p) => p.acknowledgedCurrent).length,
        notViewed: activePrimary.filter((p) => !p.viewedAt).length,
        viewedNotAcknowledged: activePrimary.filter((p) => p.viewedAt && !p.acknowledgedAt).length,
      };
      return {
        id, currentRevisionId: currentRev, requireReackPending: primary.some((p) => p.acknowledgedAt && !p.acknowledgedCurrent),
        scope: { company: isCompany, values: Array.from(scopeVals) },
        summary,
        primary: primary.sort((x, y) => x.fullName.localeCompare(y.fullName, 'vi')),
        others: others.sort((x, y) => x.fullName.localeCompare(y.fullName, 'vi')),
      };
    });
  },

  // ---- MODULE PERMISSIONS ---------------------------------------------
  'notice.permissions.list': async (config, actor) => {
    await requireManage(config, actor);
    return readTx(config, async (c) => {
      const r = await c.query('SELECT employee_code, can_manage, updated_at, updated_by_name FROM notice.notice_permissions ORDER BY employee_code');
      return { permissions: r.rows.map((x) => ({ employeeCode: x.employee_code, canManage: x.can_manage === true, updatedAt: x.updated_at, updatedByName: x.updated_by_name || '' })) };
    });
  },
  'notice.permissions.set': async (config, actor, params) => {
    await requireManage(config, actor);
    const employeeCode = upperCode(params && params.employeeCode);
    const canManage = boolish(params && params.canManage);
    if (!employeeCode) throw nErr('NOTICE_EMPLOYEE_REQUIRED', 'Thiếu mã nhân viên.', 400);
    // Only a system Admin may GRANT manage authority; an existing content
    // manager may still be able to revoke — but to keep V1 unambiguous and
    // match the brief (§6: Admin authority cannot be removed by a toggle),
    // both grant and revoke require Admin. Content managers manage notices,
    // not the manager roster.
    requireAdmin(actor);
    return writeTx(config, async (c) => {
      const cur = await c.query('SELECT can_manage FROM notice.notice_permissions WHERE employee_code = $1 FOR UPDATE', [employeeCode]);
      const before = cur.rowCount ? cur.rows[0].can_manage === true : false;
      if (before === canManage) return { employeeCode, canManage, changed: false };
      const [a, , n] = auditActor(actor);
      await c.query(
        `INSERT INTO notice.notice_permissions (employee_code, can_manage, updated_by_account_id, updated_by_name)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (employee_code) DO UPDATE SET can_manage = EXCLUDED.can_manage, updated_by_account_id = EXCLUDED.updated_by_account_id, updated_by_name = EXCLUDED.updated_by_name`,
        [employeeCode, canManage, a, n]
      );
      await c.query(
        `INSERT INTO notice.notice_permission_history (employee_code, before_value, after_value, changed_by_account_id, changed_by_name)
         VALUES ($1,$2,$3,$4,$5)`,
        [employeeCode, before, canManage, a, n]
      );
      await writeAudit(c, actor, null, 'permission_change', { employeeCode, canManage: before }, { employeeCode, canManage });
      return { employeeCode, canManage, changed: true };
    });
  },
  'notice.permissions.history': async (config, actor, params) => {
    await requireManage(config, actor);
    const employeeCode = upperCode(params && params.employeeCode);
    return readTx(config, async (c) => {
      const r = await c.query(
        `SELECT employee_code, before_value, after_value, changed_by_name, changed_at FROM notice.notice_permission_history
         ${employeeCode ? 'WHERE employee_code = $1' : ''} ORDER BY changed_at DESC LIMIT 200`,
        employeeCode ? [employeeCode] : []);
      return { entries: r.rows.map((x) => ({ employeeCode: x.employee_code, before: x.before_value, after: x.after_value, changedByName: x.changed_by_name || '', changedAt: x.changed_at })) };
    });
  },
};

const ACTIONS = Object.freeze(Object.keys(HANDLERS));

async function dispatch(config, rawActor, action, params) {
  const handler = HANDLERS[action];
  if (!handler) throw nErr('NOTICE_ACTION_UNKNOWN', 'Hành động Thông báo không hợp lệ: ' + action, 400);
  const actor = assertActor(rawActor);

  const devGate = evalDevAccess(actor);
  if (devGate.locked && !devGate.allowed && action !== 'notice.bootstrap') {
    throw nErr('NOTICE_DEV_LOCKED', 'Thông báo Quản trị đang trong giai đoạn phát triển — bạn chưa được cấp quyền truy cập.', 403);
  }
  if (devGate.locked && devGate.operator && !isAdmin(actor)) actor._devOperator = true;

  return handler(config, actor, params || {}, devGate);
}

module.exports = { dispatch, ACTIONS, HANDLERS, NoticeError, NOTICE_TYPES };
