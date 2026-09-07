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

// The 4 seeded system categories (slugs). Categories are now a managed table
// (notice.notice_categories) — this list is only the migration/default seed.
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
// TWO independent layers (Operator §F): (1) NOTICE_DEV_ACCESS_ALLOW is LOCAL/DEV
// only and controls whether the caller may ENTER the module — it NEVER confers a
// business role. (2) Business permission = system Admin OR
// notice.notice_permissions.can_manage. So `_devOperator` is NOT consulted here:
// an allow-listed non-Admin is a Viewer until an Admin turns on "Quản trị nội dung".
async function isContentManager(config, actor) {
  if (isAdmin(actor)) return true;
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
// node-pg returns a `date` column as a JS Date at LOCAL midnight — .toISOString()
// then shifts the calendar day in any non-UTC timezone (the off-by-one that made
// a future-dated replacement supersede its predecessor immediately). Format from
// LOCAL components, or slice a plain 'YYYY-MM-DD' string as-is.
function ymd(v) {
  if (!v) return null;
  if (v instanceof Date) {
    return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  }
  return String(v).slice(0, 10);
}
function effectiveStatus(row, today) {
  if (row.deleted_at) return 'deleted';
  if (row.status !== 'published') return 'draft';
  const t = today || todayISO();
  const from = ymd(row.effective_from);
  const to = ymd(row.effective_to);
  if (from && t < from) return 'upcoming';
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
const PRIORITIES = ['normal', 'important', 'urgent'];
function assertPriority(v, dflt) {
  const s = text(v);
  if (!s) return dflt || 'normal';
  if (PRIORITIES.indexOf(s) < 0) throw nErr('NOTICE_PRIORITY_INVALID', 'Mức ưu tiên không hợp lệ.', 400);
  return s;
}
function slugifyCat(s) {
  const base = String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return base || null;
}
// Category slug must exist; for a create / a category change it must also be
// active. `c` is an open transaction client.
async function assertCategory(c, slug, mustBeActive) {
  const s = text(slug);
  if (!s) throw nErr('NOTICE_CATEGORY_REQUIRED', 'Danh mục là bắt buộc.', 400);
  const r = await c.query('SELECT slug, is_active FROM notice.notice_categories WHERE slug = $1', [s]);
  if (!r.rowCount) throw nErr('NOTICE_CATEGORY_INVALID', 'Danh mục không tồn tại.', 400);
  if (mustBeActive && r.rows[0].is_active !== true) throw nErr('NOTICE_CATEGORY_INACTIVE', 'Danh mục đã ngừng sử dụng.', 400);
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
function escHtml(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
function slugify(s) {
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 64) || 'muc';
}
// Long-form (§18): plain text -> structured HTML. Lines beginning "## " / "### "
// / "#### " become headings with a stable id (for auto-TOC + anchor jump); the
// rest is paragraph text with line breaks preserved. No Word importer.
function htmlFromText(txt) {
  const src = String(txt == null ? '' : txt).replace(/\r\n?/g, '\n');
  const out = [];
  const usedIds = {};
  let para = [];
  const flush = () => { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; } };
  src.split('\n').forEach((line) => {
    const h = line.match(/^(#{2,4})\s+(.*\S)\s*$/);
    if (h) {
      flush();
      const level = h[1].length; // 2..4
      let id = slugify(h[2]);
      if (usedIds[id]) { usedIds[id]++; id = id + '-' + usedIds[id]; } else usedIds[id] = 1;
      out.push('<h' + level + ' id="' + id + '">' + escHtml(h[2]) + '</h' + level + '>');
    } else if (!line.trim()) {
      flush();
    } else {
      para.push(escHtml(line));
    }
  });
  flush();
  return out.join('\n') || '<p></p>';
}
// ---- CONTROLLED RICH TEXT (§3) ------------------------------------------
// The web body may now arrive as HTML from a constrained WYSIWYG editor. The
// SERVER is authoritative: this is a strict ALLOWLIST sanitizer — unknown tags
// are unwrapped (kept as text/children), script/style/etc are dropped whole,
// every attribute is discarded except `href` (scheme-checked) on <a> and a
// single normalised `text-align` on block elements. No class/id/on*/style
// beyond that, no <img>/<iframe>/<span>/<font>/colour/font-family. PHF keeps
// typography. content_text is then DERIVED from the sanitised HTML for FTS.
const RT_BLOCK = { p: 1, h2: 1, h3: 1, ul: 1, ol: 1, li: 1, blockquote: 1 };
const RT_INLINE = { strong: 1, em: 1, u: 1, s: 1, a: 1, br: 1 };
const RT_REMAP = { b: 'strong', i: 'em', strike: 's', del: 's', h1: 'h2', h4: 'h3', h5: 'h3', h6: 'h3', div: 'p', pre: 'p' };
const RT_DROP_WHOLE = { script: 1, style: 1, head: 1, title: 1, noscript: 1, template: 1, svg: 1, math: 1, iframe: 1, object: 1, embed: 1 };
const RT_VOID = { br: 1 };
function rtEscText(s) {
  return String(s)
    .replace(/&(?!(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,30});)/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function rtAlign(styleAttr) {
  const m = String(styleAttr || '').match(/text-align\s*:\s*(left|right|center|justify)/i);
  if (!m) return '';
  const v = m[1].toLowerCase();
  return v === 'left' ? '' : ' style="text-align:' + v + '"';
}
function rtHref(raw) {
  var v = String(raw == null ? '' : raw).replace(/[^!-~]/g, '');
  if (/^(https?:[/][/]|mailto:)/i.test(v)) return v.replace(/"/g, '%22').slice(0, 2000);
  return '';
}
function sanitizeNoticeHtml(rawHtml) {
  const src = String(rawHtml == null ? '' : rawHtml);
  if (!src.trim()) return '';
  const tokenRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^">]|"[^"]*")*)>|([^<]+)/g;
  const out = [];
  const stack = [];
  let dropDepth = 0;
  let dropTag = '';
  let m;
  while ((m = tokenRe.exec(src))) {
    const raw = m[0];
    if (raw.slice(0, 4) === '<!--') continue;
    const tagName = m[1] ? m[1].toLowerCase() : null;
    if (tagName == null) {
      if (dropDepth) continue;
      const t = m[3];
      if (t) out.push(rtEscText(t));
      continue;
    }
    const closing = raw[1] === '/';
    if (dropDepth) {
      if (closing && tagName === dropTag) { dropDepth--; if (!dropDepth) dropTag = ''; }
      else if (!closing && tagName === dropTag && !/\/>\s*$/.test(raw)) dropDepth++;
      continue;
    }
    if (!closing && RT_DROP_WHOLE[tagName]) {
      if (!/\/>\s*$/.test(raw)) { dropDepth = 1; dropTag = tagName; }
      continue;
    }
    const mapped = RT_REMAP[tagName] || tagName;
    const allowed = RT_BLOCK[mapped] || RT_INLINE[mapped];
    if (closing) {
      if (!allowed) continue; // unwrap: ignore stray close
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i] === mapped) {
          for (let k = stack.length - 1; k >= i; k--) out.push('</' + stack[k] + '>');
          stack.length = i;
          break;
        }
      }
      continue;
    }
    // opening
    if (!allowed) continue; // unwrap unknown/disallowed — keep its children
    if (RT_VOID[mapped]) { out.push('<br>'); continue; }
    let attrs = '';
    const attrSrc = m[2] || '';
    if (mapped === 'a') {
      const h = attrSrc.match(/\bhref\s*=\s*"([^"]*)"|\bhref\s*=\s*'([^']*)'|\bhref\s*=\s*([^\s">]+)/i);
      const href = h ? rtHref(h[1] || h[2] || h[3]) : '';
      if (!href) continue; // an anchor with no safe href → unwrap to text
      attrs = ' href="' + href + '" target="_blank" rel="noopener nofollow"';
    } else if (RT_BLOCK[mapped]) {
      const st = attrSrc.match(/\bstyle\s*=\s*"([^"]*)"|\bstyle\s*=\s*'([^']*)'/i);
      attrs = rtAlign(st ? (st[1] || st[2]) : '');
    }
    out.push('<' + mapped + attrs + '>');
    stack.push(mapped);
  }
  for (let k = stack.length - 1; k >= 0; k--) out.push('</' + stack[k] + '>');

  let html = out.join('');
  // strip empties + fix block model (a <p> may not contain block elements —
  // unwrap those, drop the orphaned </p>) + collapse runs
  for (let i = 0; i < 5; i++) {
    html = html
      .replace(/<p>\s*(<(?:p|h2|h3|ul|ol|blockquote)\b[^>]*>)/gi, '$1')
      .replace(/(<\/(?:p|h2|h3|ul|ol|blockquote)>)\s*<\/p>/gi, '$1')
      .replace(/<(p|h2|h3|li|blockquote)([^>]*)>(?:\s|&nbsp;|<br>)*<\/\1>/gi, '')
      .replace(/<(ul|ol)>\s*<\/\1>/gi, '')
      .replace(/(<br>\s*){3,}/gi, '<br><br>');
  }
  html = html.trim();
  if (!html) return '';
  // assign stable ids to headings (for auto-TOC / anchor jump)
  const usedIds = {};
  html = html.replace(/<(h[23])>([\s\S]*?)<\/\1>/gi, (whole, tag, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    let id = slugify(text);
    if (usedIds[id]) { usedIds[id]++; id = id + '-' + usedIds[id]; } else usedIds[id] = 1;
    return '<' + tag + ' id="' + id + '">' + inner + '</' + tag + '>';
  });
  return html;
}
// Plain text derived from the sanitised HTML — feeds notices.search_tsv (FTS)
// and the feed excerpt. Block boundaries become newlines so search still works
// clause-by-clause and the excerpt reads sensibly.
function noticeHtmlToText(html) {
  return String(html || '')
    .replace(/<\/(p|h2|h3|li|ul|ol|blockquote|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
// A web body may arrive as (a) rich HTML from the WYSIWYG editor → sanitise it
// and derive the text, or (b) plain text (API / paste-only) → the existing
// "## " heading convention. Returns { html, text }.
function resolveNoticeBody(params, fallbackText) {
  const rawHtml = params && params.contentHtml != null ? String(params.contentHtml) : '';
  const looksRich = /<(p|h2|h3|ul|ol|li|strong|em|u|a|br|b|i|div)[\s>]/i.test(rawHtml);
  if (looksRich) {
    const html = sanitizeNoticeHtml(rawHtml);
    const textFromHtml = noticeHtmlToText(html);
    if (html && textFromHtml) return { html, text: textFromHtml };
  }
  const text = text_(params && params.contentText) || fallbackText || '';
  if (!text) return { html: '', text: '' };
  return { html: htmlFromText(text), text };
}
function text_(v) { const s = v == null ? '' : String(v).trim(); return s === '' ? '' : s; }

// Auto table-of-contents (§15/§18): pull h2/h3/h4 + their id out of the stored HTML.
function tocFromHtml(html) {
  const out = [];
  const re = /<h([234])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h[234]>/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    out.push({ level: Number(m[1]), id: m[2], text: String(m[3]).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() });
  }
  return out;
}

// An acknowledgement stays valid unless a revision AFTER the one the viewer
// acked was published with require_reacknowledgement = true (§9 / AC12 default:
// a plain edit does NOT invalidate the old acknowledgement).
async function ackStillCurrent(c, noticeId, ackRevisionId) {
  if (!ackRevisionId) return false;
  const r = await c.query(
    `SELECT
       (SELECT revision_no FROM notice.notice_revisions WHERE id = $2) AS acked_no,
       (SELECT COALESCE(MAX(revision_no), 0) FROM notice.notice_revisions
          WHERE notice_id = $1 AND require_reacknowledgement = true) AS reack_no`,
    [noticeId, ackRevisionId]
  );
  const row = r.rows[0] || {};
  if (row.acked_no == null) return false;
  return Number(row.acked_no) >= Number(row.reack_no || 0);
}

async function loadFullNotice(c, id) {
  const nr = await c.query(
    `SELECT n.*, cat.name AS category_name, cat.is_active AS category_active
       FROM notice.notices n LEFT JOIN notice.notice_categories cat ON cat.slug = n.notice_type
      WHERE n.id = $1`, [id]);
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
    categoryName: r.category_name || r.notice_type,
    categoryActive: r.category_active !== false,
    priority: r.priority || 'normal',
    effectiveFrom: ymd(r.effective_from),
    effectiveTo: ymd(r.effective_to),
    requireAcknowledgement: r.require_acknowledgement === true,
    isPinned: r.is_pinned === true,
    status: r.status,
    publishedAt: r.published_at,
    lastUpdatedAt: r.updated_at,
    edited: (full.revisions || []).length > 1,
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
    toc: tocFromHtml(r.content_html || ''),
    attachments: (full.attachments || []).map((a) => ({
      id: a.id, kind: a.kind, fileType: a.file_type, fileName: a.file_name,
      linkUrl: a.link_url, byteSize: a.byte_size, createdAt: a.created_at,
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
    effective_from: ymd(r.effective_from),
    effective_to: ymd(r.effective_to),
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

// §13 replacement: a published notice B that replaces A takes effect on its own
// effective_from. Batch 01 handled the "already effective at publish" case; this
// lazily flips a replacement whose effective_from was in the FUTURE at publish
// and has now arrived — run before every feed/detail read (idempotent, bounded:
// only rows with replaced_notice_id, published, effective_from <= today, whose
// target is not yet superseded). No scheduler needed.
// Replacement flips are DATE-based (daily granularity) — re-checking on every
// feed/detail read opened a write transaction for nothing on virtually every
// request. Throttle the sweep to once per REPLACEMENT_SWEEP_TTL_MS process-wide;
// the "lazy flip on read" contract already tolerates a small delay, and every
// write path (publish/update) still handles its own replacement synchronously.
const DUE_REPLACEMENT_PROBE =
  `SELECT 1
     FROM notice.notices b
     JOIN notice.notices a ON a.id = b.replaced_notice_id
    WHERE b.status = 'published' AND b.deleted_at IS NULL
      AND b.replaced_notice_id IS NOT NULL
      AND b.effective_from <= $1::date
      AND a.status = 'published' AND a.deleted_at IS NULL
      AND a.superseded_by_notice_id IS NULL
    LIMIT 1`;
async function resolveDueReplacements(config, today) {
  const anyDue = await readTx(config, async (c) => (await c.query(DUE_REPLACEMENT_PROBE, [today])).rowCount > 0);
  if (!anyDue) return;
  await writeTx(config, async (c) => {
    const due = await c.query(
      `SELECT b.id AS new_id, b.replaced_notice_id AS old_id, b.effective_from AS new_from
         FROM notice.notices b
         JOIN notice.notices a ON a.id = b.replaced_notice_id
        WHERE b.status = 'published' AND b.deleted_at IS NULL
          AND b.replaced_notice_id IS NOT NULL
          AND b.effective_from <= $1::date
          AND a.status = 'published' AND a.deleted_at IS NULL
          AND a.superseded_by_notice_id IS NULL`,
      [today]
    );
    for (const r of due.rows) {
      const old = await c.query('SELECT effective_to FROM notice.notices WHERE id = $1 FOR UPDATE', [r.old_id]);
      // old notice ends the day BEFORE the replacement takes effect (so on the
      // replacement's effective day the old one is already EXPIRED — §13).
      await c.query(
        `UPDATE notice.notices
            SET superseded_by_notice_id = $1,
                effective_to = LEAST(COALESCE(effective_to, ($2::date - 1)), ($2::date - 1))
          WHERE id = $3`,
        [r.new_id, ymd(r.new_from), r.old_id]
      );
      await c.query(
        `INSERT INTO notice.notice_audit_logs (notice_id, actor_account_id, actor_employee_code, actor_name, action_type, before_json, after_json)
         VALUES ($1, NULL, NULL, 'Hệ thống', 'superseded', $2, $3)`,
        [r.old_id, JSON.stringify({ effectiveTo: old.rows[0] && ymd(old.rows[0].effective_to) }), JSON.stringify({ supersededByNoticeId: r.new_id, trigger: 'replacement-effective' })]
      );
    }
    return due.rowCount;
  });
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
    // Dev-allow (dg.operator) grants ENTRY only — never a business role (§F).
    let canManage = admin;
    // One read transaction resolves BOTH the grant check and the viewer's
    // "Cần tiếp nhận" inbox count (published notices that require this viewer's
    // acknowledgement or re-acknowledgement and are not yet satisfied, expired
    // ones excluded). Additive read — the acknowledgement contract is unchanged.
    const today = todayISO();
    const vkey = viewerKey(actor);
    const boot = await readTx(config, async (c) => {
      let grant = false;
      if (!canManage && actor.employeeCode) {
        const r = await c.query('SELECT can_manage FROM notice.notice_permissions WHERE employee_code = $1', [actor.employeeCode]);
        grant = r.rowCount > 0 && r.rows[0].can_manage === true;
      }
      let inboxPending = 0;
      try {
        const p = await c.query(
          `SELECT count(*)::int AS pending
             FROM notice.notices n
            WHERE n.deleted_at IS NULL AND n.status = 'published'
              AND n.require_acknowledgement = true
              AND (n.effective_to IS NULL OR n.effective_to >= $1::date)
              AND NOT EXISTS (
                SELECT 1 FROM notice.notice_acknowledgements a
                  JOIN notice.notice_revisions rv ON rv.id = a.revision_id
                 WHERE a.notice_id = n.id AND a.acker_key = $2
                   AND rv.revision_no >= COALESCE(
                     (SELECT MAX(r2.revision_no) FROM notice.notice_revisions r2
                       WHERE r2.notice_id = n.id AND r2.require_reacknowledgement = true), 0))`,
          [today, vkey]
        );
        inboxPending = Number(p.rows[0] && p.rows[0].pending) || 0;
      } catch (e) { inboxPending = 0; }
      // Bell badge (§5): recent published, non-deleted, non-expired notices this
      // viewer has NOT opened yet (bounded 90-day window). Counts "chưa đọc";
      // "cần xác nhận" is inboxPending. Same one read transaction — no new path.
      let bellUnread = 0;
      try {
        const u = await c.query(
          `SELECT count(*)::int AS n
             FROM notice.notices n
            WHERE n.deleted_at IS NULL AND n.status = 'published'
              AND (n.effective_to IS NULL OR n.effective_to >= $1::date)
              AND n.published_at >= (now() - interval '90 days')
              AND NOT EXISTS (SELECT 1 FROM notice.notice_views v WHERE v.notice_id = n.id AND v.viewer_key = $2)`,
          [today, vkey]
        );
        bellUnread = Number(u.rows[0] && u.rows[0].n) || 0;
      } catch (e) { bellUnread = 0; }
      return { grant, inboxPending, bellUnread };
    });
    if (boot.grant) canManage = true;
    return {
      viewer: { accountId: actor.accountId, employeeCode: actor.employeeCode, displayName: actor.displayName, systemRole: actor.systemRole, isAdmin: admin },
      capabilities: {
        canManage: !!canManage,          // đăng / sửa / xóa / ghim / danh mục / báo cáo
        canManagePermissions: admin,     // "Cài đặt quyền" — system Admin ONLY (§C/§D)
        grant: !!boot.grant,             // the module toggle state for this user
      },
      inbox: { pendingCount: boot.inboxPending },
      bell: { unreadCount: boot.bellUnread, pendingCount: boot.inboxPending },
      devLocked: !!dg.locked,
      devOperator: !!(dg.locked && dg.operator && !admin),
    };
  },

  // ---- FEED (public business read) ---------------------------------------
  'notice.feed': async (config, actor, params) => {
    const canManage = await isContentManager(config, actor);
    const today = todayISO();
    await resolveDueReplacements(config, today);
    const q = text(params && params.q);
    const typeFilter = text(params && params.type);
    const statusFilter = text(params && params.status); // active | upcoming | expired
    const scopeFilter = text(params && params.scope);   // department/branch label
    const includeDrafts = canManage && boolish(params && params.includeDrafts);
    const mode = String((params && params.mode) || '');
    const inboxMode = mode === 'inbox'; // "Cần tiếp nhận"
    const bellMode = mode === 'bell';   // chuông thông báo — recent, bounded

    return readTx(config, async (c) => {
      const where = ['n.deleted_at IS NULL'];
      const vals = [];
      if (includeDrafts) {
        where.push("(n.status = 'published' OR n.status = 'draft')");
      } else {
        where.push("n.status = 'published'");
      }
      // category filter — accepts any slug (custom categories included); a
      // bad slug simply matches nothing.
      if (typeFilter) { vals.push(typeFilter); where.push('n.notice_type = $' + vals.length); }
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
      if (bellMode) {
        where.push("(n.effective_to IS NULL OR n.effective_to >= now()::date)",
          "n.published_at >= (now() - interval '120 days')");
      }
      const rows = (await c.query(
        `SELECT n.*, cat.name AS category_name, ${rankSql} AS rank_score,
                (SELECT count(*)::int FROM notice.notice_revisions rv WHERE rv.notice_id = n.id) AS rev_count
           FROM notice.notices n LEFT JOIN notice.notice_categories cat ON cat.slug = n.notice_type
          WHERE ${where.join(' AND ')}
          ${bellMode ? 'ORDER BY n.is_pinned DESC, n.published_at DESC NULLS LAST LIMIT 12' : 'LIMIT 500'}`, vals
      )).rows;
      if (!rows.length) return { today, notices: [], total: 0 };

      const ids = rows.map((r) => r.id);
      const vkey = viewerKey(actor);
      const [scopeRows, kwRows, viewRows, ackRows, attCount] = await Promise.all([
        c.query('SELECT notice_id, scope_type, scope_value FROM notice.notice_scopes WHERE notice_id = ANY($1)', [ids]),
        c.query('SELECT notice_id, keyword FROM notice.notice_keywords WHERE notice_id = ANY($1)', [ids]),
        c.query('SELECT notice_id, first_viewed_at, last_viewed_at FROM notice.notice_views WHERE notice_id = ANY($1) AND viewer_key = $2', [ids, vkey]),
        c.query(`SELECT a.notice_id, a.revision_id, rv.revision_no AS acked_no,
                        (SELECT COALESCE(MAX(r2.revision_no),0) FROM notice.notice_revisions r2 WHERE r2.notice_id = a.notice_id AND r2.require_reacknowledgement = true) AS reack_no
                   FROM notice.notice_acknowledgements a JOIN notice.notice_revisions rv ON rv.id = a.revision_id
                  WHERE a.notice_id = ANY($1) AND a.acker_key = $2`, [ids, vkey]),
        c.query(`SELECT notice_id,
                        count(*)::int AS n,
                        count(*) FILTER (WHERE kind = 'file')::int AS files,
                        count(*) FILTER (WHERE kind = 'link')::int AS links
                   FROM notice.notice_attachments
                  WHERE notice_id = ANY($1) AND deleted_at IS NULL GROUP BY notice_id`, [ids]),
      ]);
      const scopeBy = new Map(); scopeRows.rows.forEach((r) => { (scopeBy.get(r.notice_id) || scopeBy.set(r.notice_id, []).get(r.notice_id)).push({ scopeType: r.scope_type, scopeValue: r.scope_value }); });
      const kwBy = new Map(); kwRows.rows.forEach((r) => { (kwBy.get(r.notice_id) || kwBy.set(r.notice_id, []).get(r.notice_id)).push(r.keyword); });
      const viewBy = new Map(viewRows.rows.map((r) => [r.notice_id, r]));
      const ackBy = new Map(ackRows.rows.map((r) => [r.notice_id, { revId: r.revision_id, valid: Number(r.acked_no) >= Number(r.reack_no || 0) }]));
      const attBy = new Map(attCount.rows.map((r) => [r.notice_id, r]));

      const list = rows.map((r) => {
        const es = effectiveStatus(r, today);
        const ackInfo = ackBy.get(r.id) || null;
        return {
          id: r.id,
          title: r.title,
          excerpt: excerpt(r.content_text, 240),
          noticeType: r.notice_type,
          categoryName: r.category_name || r.notice_type,
          priority: r.priority || 'normal',
          effectiveFrom: ymd(r.effective_from),
          effectiveTo: ymd(r.effective_to),
          effectiveStatus: es,
          status: r.status,
          isPinned: r.is_pinned === true,
          requireAcknowledgement: r.require_acknowledgement === true,
          publishedAt: r.published_at,
          updatedAt: r.updated_at,
          edited: Number(r.rev_count || 0) > 1,
          scopes: scopeBy.get(r.id) || [],
          keywords: kwBy.get(r.id) || [],
          attachmentCount: (attBy.get(r.id) && attBy.get(r.id).n) || 0,
          attachmentFileCount: (attBy.get(r.id) && attBy.get(r.id).files) || 0,
          attachmentLinkCount: (attBy.get(r.id) && attBy.get(r.id).links) || 0,
          supersededByNoticeId: r.superseded_by_notice_id || null,
          replacedNoticeId: r.replaced_notice_id || null,
          viewer: {
            viewed: viewBy.has(r.id),
            firstViewedAt: viewBy.has(r.id) ? viewBy.get(r.id).first_viewed_at : null,
            acknowledged: !!ackInfo,
            acknowledgedRevisionIsCurrent: ackInfo ? ackInfo.valid : false,
          },
          rankScore: Number(r.rank_score) || 0,
        };
      });

      // Ordering: explicit pin first (unchanged, separate function) -> then an
      // ACTIVE "Hỏa tốc" (urgent) advantage that an expired notice loses -> then
      // status (active/upcoming/expired) -> search relevance -> recency.
      if (bellMode) {
        return { today, notices: list, total: list.length, bellMode: true };
      }
      const urgentActive = (n) => (n.priority === 'urgent' && n.effectiveStatus === 'active') ? 0 : 1;
      list.sort((x, y) => {
        if (x.isPinned !== y.isPinned) return x.isPinned ? -1 : 1;
        const ua = urgentActive(x) - urgentActive(y);
        if (ua !== 0) return ua;
        const sr = statusRank(x.effectiveStatus) - statusRank(y.effectiveStatus);
        if (sr !== 0) return sr;
        if (q && y.rankScore !== x.rankScore) return y.rankScore - x.rankScore;
        return new Date(y.publishedAt || y.updatedAt) - new Date(x.publishedAt || x.updatedAt);
      });

      let filtered = list;
      if (statusFilter && ['active', 'upcoming', 'expired'].indexOf(statusFilter) >= 0) {
        filtered = list.filter((n) => n.effectiveStatus === statusFilter);
      }
      // "Cần tiếp nhận" — the viewer's personal work inbox: published notices
      // that ask for this viewer's acknowledgement and are not yet satisfied
      // (never acked, or acked an older revision that a later re-ack invalidated).
      // Expired notices drop out. Does NOT change the acknowledgement contract.
      if (inboxMode) {
        filtered = filtered.filter((n) => n.requireAcknowledgement
          && n.effectiveStatus !== 'expired'
          && (!n.viewer.acknowledged || !n.viewer.acknowledgedRevisionIsCurrent));
      }
      return { today, notices: filtered, total: filtered.length, inboxMode };
    });
  },

  // Open detail — records a view (first/last), returns full notice + viewer state.
  'notice.detail': async (config, actor, params) => {
    const id = text(params && params.id);
    if (!id) throw nErr('NOTICE_ID_REQUIRED', 'Thiếu mã thông báo.', 400);
    const today = todayISO();
    await resolveDueReplacements(config, today);
    // resolve manage authority ONCE (was 3 separate readTx round-trips per open)
    const canManage = await isContentManager(config, actor);
    return writeTx(config, async (c) => {
      const full = await loadFullNotice(c, id);
      if (full.row.deleted_at && !canManage) {
        throw nErr('NOTICE_NOT_FOUND', 'Không tìm thấy thông báo.', 404);
      }
      if (full.row.status !== 'published' && !canManage) {
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
          acknowledgedRevisionIsCurrent: ack.rowCount ? await ackStillCurrent(c, id, ack.rows[0].revision_id) : false,
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
      return { today, notice: shaped, viewer: viewerState, replacement, replaces, canManage };
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
    // Web body is mandatory (§14/§18). The plain text is canonical; the stored
    // HTML is always DERIVED from it server-side (htmlFromText: "## " headings +
    // paragraphs + stable ids for the auto-TOC / anchor jump). A client-sent
    // contentHtml is only a fallback when no text is provided.
    // Web body is mandatory (§14/§18). It arrives EITHER as rich HTML from the
    // constrained editor — server-sanitised to a strict allowlist, then plain
    // text DERIVED from it for FTS — OR as plain text (API / paste), which keeps
    // the "## " heading convention. Either way headings get stable ids for the
    // auto-TOC. resolveNoticeBody() picks the branch.
    const body = resolveNoticeBody(params, '');
    if (!body.html || !body.text) throw nErr('NOTICE_CONTENT_REQUIRED', 'Nội dung trên web là bắt buộc.', 400);
    const contentText = body.text;
    const contentHtml = body.html;
    const pinnedOnCreate = boolish(params && params.pinned);
    const effectiveFrom = dateOnly(params && params.effectiveFrom) || todayISO();
    const effectiveTo = dateOnly(params && params.effectiveTo);
    if (effectiveTo && effectiveTo < effectiveFrom) throw nErr('NOTICE_DATE_RANGE', 'Ngày hết hiệu lực phải sau ngày hiệu lực.', 400);
    const requireAck = boolish(params && params.requireAcknowledgement);
    const priority = assertPriority(params && params.priority);
    const scopes = normScopes(params && params.scopes);
    const keywords = normKeywords(params && params.keywords);
    const replacedNoticeId = text(params && params.replacedNoticeId);

    return writeTx(config, async (c) => {
      const noticeType = await assertCategory(c, params && params.noticeType, true);
      const [a, e, n] = auditActor(actor);
      const ins = await c.query(
        `INSERT INTO notice.notices
           (title, content_html, content_text, notice_type, priority, effective_from, effective_to, require_acknowledgement, status, replaced_notice_id, created_by_account_id, created_by_employee_code, created_by_name, updated_by_account_id, updated_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10,$11,$12,$10,$12) RETURNING id`,
        [title, contentHtml, contentText, noticeType, priority, effectiveFrom, effectiveTo, requireAck, replacedNoticeId, a, e, n]
      );
      const id = ins.rows[0].id;
      for (const s of scopes) await c.query('INSERT INTO notice.notice_scopes (notice_id, scope_type, scope_value) VALUES ($1,$2,$3)', [id, s.scopeType, s.scopeValue]);
      for (const k of keywords) await c.query('INSERT INTO notice.notice_keywords (notice_id, keyword) VALUES ($1,$2)', [id, k]);
      // Ghim is set at create/edit time now (§6). Pin is independent of priority.
      if (pinnedOnCreate) {
        await c.query('UPDATE notice.notices SET is_pinned = true WHERE id = $1', [id]);
        await writeAudit(c, actor, id, 'pin', { isPinned: false }, { isPinned: true });
      }
      await writeAudit(c, actor, id, 'create', null, { title, noticeType, priority, effectiveFrom, effectiveTo, requireAck, isPinned: !!pinnedOnCreate, scopes, keywords, replacedNoticeId: replacedNoticeId || null });
      return { id, status: 'draft', pinned: !!pinnedOnCreate };
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
      const put = (col, val, key) => { vals.push(val); set.push(col + ' = $' + vals.length); beforeJson[key] = ymd(b[col]) || b[col]; afterJson[key] = val; };

      if (params && params.title != null) { const t = text(params.title); if (!t) throw nErr('NOTICE_TITLE_REQUIRED', 'Tiêu đề là bắt buộc.', 400); if (t !== b.title) put('title', t, 'title'); }
      if ((params && params.contentHtml != null) || (params && params.contentText != null)) {
        const rb = resolveNoticeBody(params, b.content_text);
        if (!rb.html || !rb.text) throw nErr('NOTICE_CONTENT_REQUIRED', 'Nội dung trên web là bắt buộc.', 400);
        if (rb.html !== b.content_html) put('content_html', rb.html, 'contentHtml');
        if (rb.text !== b.content_text) put('content_text', rb.text, 'contentText');
      }
      if (params && params.noticeType != null) {
        const raw = text(params.noticeType);
        const ty = await assertCategory(c, raw, raw && raw !== b.notice_type); // active only required when actually switching
        if (ty !== b.notice_type) put('notice_type', ty, 'noticeType');
      }
      if (params && params.priority != null) { const pr = assertPriority(params.priority); if (pr !== (b.priority || 'normal')) put('priority', pr, 'priority'); }
      let effFrom = ymd(b.effective_from);
      let effTo = ymd(b.effective_to);
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

      // §6: Ghim can also be toggled from the edit form. Pin stays independent of
      // priority and keeps its own pin/unpin audit line.
      let pinChanged = false;
      if (params && Object.prototype.hasOwnProperty.call(params, 'pinned')) {
        const want = boolish(params.pinned);
        if (want !== (b.is_pinned === true)) {
          await c.query('UPDATE notice.notices SET is_pinned = $1 WHERE id = $2', [want, id]);
          await writeAudit(c, actor, id, want ? 'pin' : 'unpin', { isPinned: b.is_pinned === true }, { isPinned: want });
          pinChanged = true;
        }
      }

      const contentChanged = set.length || scopesChanged || keywordsChanged;
      // A published notice can get an explicit re-ack even when only the
      // attachments changed (applied live via notice.attachment.*): the Content
      // Manager ticks the box and we cut one re-ack revision here.
      const reackOnly = !contentChanged && requireReack && b.status === 'published';
      if (!contentChanged && !pinChanged && !reackOnly) return { id, changed: false };
      // A pin-only change is NOT a content edit: no 'edit' audit, no new revision.
      if (!contentChanged && !reackOnly) return { id, changed: true, revision: null, requireReack: null, pinChanged: true };
      if (reackOnly) {
        const rv = await createRevision(c, actor, id, true, changeSummary || 'Yêu cầu xác nhận lại (thay đổi tài liệu/đính kèm)');
        await writeAudit(c, actor, id, 'require_reack', null, { revisionNo: rv.revisionNo, reason: 'manual' });
        return { id, changed: true, revision: rv, requireReack: true, pinChanged };
      }

      await writeAudit(c, actor, id, 'edit', beforeJson, afterJson);

      // For a PUBLISHED notice: cut a new revision. require_reacknowledgement
      // marks whether existing acks are invalidated for the new revision.
      let revision = null;
      if (b.status === 'published') {
        revision = await createRevision(c, actor, id, requireReack, changeSummary);
        if (requireReack) await writeAudit(c, actor, id, 'require_reack', null, { revisionNo: revision.revisionNo });
      }
      return { id, changed: true, revision, requireReack: b.status === 'published' ? !!requireReack : null, pinChanged };
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
            await c.query(
              `UPDATE notice.notices
                  SET superseded_by_notice_id = $1,
                      effective_to = LEAST(COALESCE(effective_to, ($2::date - 1)), ($2::date - 1))
                WHERE id = $3`,
              [id, ymd(b.effective_from), b.replaced_notice_id]
            );
            await writeAudit(c, actor, b.replaced_notice_id, 'superseded', { effectiveTo: ymd(old.rows[0].effective_to) }, { supersededByNoticeId: id });
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

  // ---- ATTACHMENTS (§19) — file/link, revision-scoped, audited -----------
  'notice.attachment.add': async (config, actor, params) => {
    await requireManage(config, actor);
    const noticeId = text(params && params.noticeId);
    if (!noticeId) throw nErr('NOTICE_ID_REQUIRED', 'Thiếu mã thông báo.', 400);
    const kind = text(params && params.kind) === 'link' ? 'link' : 'file';
    const requireReack = boolish(params && params.requireReacknowledgement);
    const [a, e, n] = auditActor(actor);
    return writeTx(config, async (c) => {
      const nr = await c.query('SELECT id, status, deleted_at, current_revision_id FROM notice.notices WHERE id = $1', [noticeId]);
      if (!nr.rowCount || nr.rows[0].deleted_at) throw nErr('NOTICE_NOT_FOUND', 'Không tìm thấy thông báo.', 404);
      const notice = nr.rows[0];
      let row;
      if (kind === 'link') {
        const url = text(params && params.linkUrl);
        if (!url || !/^https?:\/\//i.test(url)) throw nErr('NOTICE_ATTACH_LINK', 'Liên kết phải bắt đầu bằng http:// hoặc https://', 400);
        row = (await c.query(
          `INSERT INTO notice.notice_attachments (notice_id, revision_id, kind, link_url, created_by_account_id, created_by_name)
           VALUES ($1,$2,'link',$3,$4,$5) RETURNING id`, [noticeId, notice.current_revision_id, url, a, n]
        )).rows[0];
        await writeAudit(c, actor, noticeId, 'attachment_add', null, { kind: 'link', linkUrl: url, attachmentId: row.id });
      } else {
        const store = require('./notice-attachment-store');
        const fileName = text(params && params.fileName) || 'tep-dinh-kem';
        const put = await store.putFile(config.PHF_HR_ATTACHMENT_ROOT, noticeId, fileName, params && params.mimeType, params && params.base64);
        row = (await c.query(
          `INSERT INTO notice.notice_attachments (id, notice_id, revision_id, kind, file_type, file_name, storage_key, byte_size, created_by_account_id, created_by_name)
           VALUES ($1,$2,$3,'file',$4,$5,$6,$7,$8,$9) RETURNING id`,
          [put.attachmentId, noticeId, notice.current_revision_id, put.fileType, fileName, 'notice/' + noticeId + '/' + put.attachmentId, put.byteSize, a, n]
        )).rows[0];
        await writeAudit(c, actor, noticeId, 'attachment_add', null, { kind: 'file', fileName, fileType: put.fileType, byteSize: put.byteSize, attachmentId: row.id });
      }
      let revision = null;
      if (notice.status === 'published' && requireReack) {
        revision = await createRevision(c, actor, noticeId, true, 'Thay đổi tệp đính kèm');
        await writeAudit(c, actor, noticeId, 'require_reack', null, { revisionNo: revision.revisionNo, reason: 'attachment' });
      }
      return { attachmentId: row.id, kind, revision };
    });
  },
  'notice.attachment.remove': async (config, actor, params) => {
    await requireManage(config, actor);
    const noticeId = text(params && params.noticeId);
    const attachmentId = text(params && params.attachmentId);
    if (!noticeId || !attachmentId) throw nErr('NOTICE_ATTACH_KEY', 'Thiếu mã thông báo hoặc mã tệp.', 400);
    const requireReack = boolish(params && params.requireReacknowledgement);
    const [a, e, n] = auditActor(actor);
    return writeTx(config, async (c) => {
      const ar = await c.query('SELECT id, kind, file_name, link_url, deleted_at FROM notice.notice_attachments WHERE id = $1 AND notice_id = $2', [attachmentId, noticeId]);
      if (!ar.rowCount) throw nErr('NOTICE_ATTACH_NOT_FOUND', 'Không tìm thấy tệp.', 404);
      if (ar.rows[0].deleted_at) return { attachmentId, removed: true, already: true };
      await c.query('UPDATE notice.notice_attachments SET deleted_at = now(), deleted_by_account_id = $2, deleted_by_name = $3 WHERE id = $1', [attachmentId, a, n]);
      await writeAudit(c, actor, noticeId, 'attachment_remove', { kind: ar.rows[0].kind, fileName: ar.rows[0].file_name, linkUrl: ar.rows[0].link_url, attachmentId }, null);
      let revision = null;
      const ns = await c.query('SELECT status FROM notice.notices WHERE id = $1', [noticeId]);
      if (ns.rowCount && ns.rows[0].status === 'published' && requireReack) {
        revision = await createRevision(c, actor, noticeId, true, 'Thay đổi tệp đính kèm');
        await writeAudit(c, actor, noticeId, 'require_reack', null, { revisionNo: revision.revisionNo, reason: 'attachment' });
      }
      return { attachmentId, removed: true, revision };
    });
  },
  // Download — PUBLIC business read (any verified actor who can read the notice).
  'notice.attachment.download': async (config, actor, params) => {
    const noticeId = text(params && params.noticeId);
    const attachmentId = text(params && params.attachmentId);
    if (!noticeId || !attachmentId) throw nErr('NOTICE_ATTACH_KEY', 'Thiếu mã thông báo hoặc mã tệp.', 400);
    const canManage = await isContentManager(config, actor);
    const row = await readTx(config, async (c) => {
      const nr = await c.query('SELECT status, deleted_at FROM notice.notices WHERE id = $1', [noticeId]);
      if (!nr.rowCount) throw nErr('NOTICE_NOT_FOUND', 'Không tìm thấy thông báo.', 404);
      if ((nr.rows[0].deleted_at || nr.rows[0].status !== 'published') && !canManage) throw nErr('NOTICE_NOT_FOUND', 'Không tìm thấy thông báo.', 404);
      const ar = await c.query('SELECT id, kind, file_type, file_name, link_url FROM notice.notice_attachments WHERE id = $1 AND notice_id = $2 AND deleted_at IS NULL', [attachmentId, noticeId]);
      if (!ar.rowCount) throw nErr('NOTICE_ATTACH_NOT_FOUND', 'Không tìm thấy tệp.', 404);
      return ar.rows[0];
    });
    if (row.kind === 'link') return { kind: 'link', linkUrl: row.link_url };
    const store = require('./notice-attachment-store');
    const f = await store.getFile(config.PHF_HR_ATTACHMENT_ROOT, noticeId, attachmentId);
    return { kind: 'file', fileName: row.file_name, fileType: row.file_type, byteSize: f.byteSize, base64: f.base64 };
  },

  'notice.delete': async (config, actor, params) => {
    await requireManage(config, actor);
    const id = text(params && params.id);
    if (!id) throw nErr('NOTICE_ID_REQUIRED', 'Thiếu mã thông báo.', 400);
    return writeTx(config, async (c) => {
      const cur = await c.query('SELECT id, status, deleted_at FROM notice.notices WHERE id = $1', [id]);
      if (!cur.rowCount) throw nErr('NOTICE_NOT_FOUND', 'Không tìm thấy thông báo.', 404);
      if (cur.rows[0].deleted_at) return { id, deleted: true, mode: 'already' };
      // §12: published -> soft delete only. A draft "can be deleted" too — we
      // soft-delete it as well (one consistent model; keeps audit + history
      // intact, which the append-only audit design requires anyway). Either way
      // the row leaves the feed/search (deleted_at IS NULL filter) and the
      // manager can still reach its history.
      const wasDraft = cur.rows[0].status === 'draft';
      const [a, n] = [actor.accountId || null, actor.displayName || actor.employeeCode || null];
      await c.query('UPDATE notice.notices SET deleted_at = now(), deleted_by_account_id = $2, deleted_by_name = $3 WHERE id = $1', [id, a, n]);
      await writeAudit(c, actor, id, wasDraft ? 'delete_draft' : 'soft_delete', { status: cur.rows[0].status }, { deletedAt: 'now' });
      return { id, deleted: true, mode: 'soft', wasDraft };
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

  // ---- CATEGORIES (§1) — content classification, not a visibility ACL ----
  'notice.categories.list': async (config, actor, params) => {
    // any verified actor may READ the active list (feed filter needs it);
    // managers additionally see inactive ones + usage counts.
    const canManage = await isContentManager(config, actor);
    return readTx(config, async (c) => {
      const r = await c.query(
        `SELECT cat.slug, cat.name, cat.sort_order, cat.is_active, cat.is_system, cat.updated_by_name, cat.updated_at,
                (SELECT count(*)::int FROM notice.notices n WHERE n.notice_type = cat.slug AND n.deleted_at IS NULL) AS use_count
           FROM notice.notice_categories cat ORDER BY cat.sort_order, lower(cat.name)`);
      const rows = r.rows
        .filter((x) => canManage || x.is_active === true)
        .map((x) => ({
          slug: x.slug, name: x.name, sortOrder: x.sort_order, isActive: x.is_active === true, isSystem: x.is_system === true,
          useCount: canManage ? x.use_count : undefined,
          updatedByName: canManage ? (x.updated_by_name || '') : undefined, updatedAt: canManage ? x.updated_at : undefined,
        }));
      return { categories: rows, canManage: !!canManage };
    });
  },
  'notice.categories.upsert': async (config, actor, params) => {
    await requireManage(config, actor);
    const [a, , n] = auditActor(actor);
    const slugIn = text(params && params.slug);
    const name = text(params && params.name);
    return writeTx(config, async (c) => {
      if (!slugIn) {
        // create
        if (!name) throw nErr('NOTICE_CATEGORY_NAME', 'Tên danh mục là bắt buộc.', 400);
        let slug = slugifyCat(name);
        if (!slug) throw nErr('NOTICE_CATEGORY_NAME', 'Tên danh mục không hợp lệ.', 400);
        // de-collide the slug
        const exists = await c.query('SELECT 1 FROM notice.notice_categories WHERE slug LIKE $1', [slug + '%']);
        if (exists.rowCount) slug = slug + '-' + (exists.rowCount + 1);
        const so = Number.isFinite(Number(params && params.sortOrder)) ? Math.trunc(Number(params.sortOrder))
          : ((await c.query('SELECT COALESCE(MAX(sort_order),0)+10 AS s FROM notice.notice_categories')).rows[0].s);
        try {
          await c.query(
            `INSERT INTO notice.notice_categories (slug, name, sort_order, created_by_account_id, created_by_name, updated_by_account_id, updated_by_name)
             VALUES ($1,$2,$3,$4,$5,$4,$5)`, [slug, name, so, a, n]);
        } catch (e) {
          if (String(e && e.code) === '23505') throw nErr('NOTICE_CATEGORY_DUP', 'Đã có danh mục cùng tên.', 409);
          throw e;
        }
        await writeAudit(c, actor, null, 'category_create', null, { slug, name, sortOrder: so });
        return { slug, created: true };
      }
      // update
      const cur = await c.query('SELECT slug, name, sort_order, is_active, is_system FROM notice.notice_categories WHERE slug = $1 FOR UPDATE', [slugIn]);
      if (!cur.rowCount) throw nErr('NOTICE_CATEGORY_INVALID', 'Danh mục không tồn tại.', 404);
      const b = cur.rows[0];
      const sets = []; const v = []; const changes = [];
      if (name != null && name !== b.name) { v.push(name); sets.push('name = $' + v.length); changes.push(['category_rename', { slug: slugIn, from: b.name, to: name }]); }
      if (params && Object.prototype.hasOwnProperty.call(params, 'sortOrder')) {
        const so = Math.trunc(Number(params.sortOrder));
        if (Number.isFinite(so) && so !== b.sort_order) { v.push(so); sets.push('sort_order = $' + v.length); changes.push(['category_reorder', { slug: slugIn, from: b.sort_order, to: so }]); }
      }
      if (params && Object.prototype.hasOwnProperty.call(params, 'isActive')) {
        const ia = params.isActive === true || params.isActive === 'true';
        if (ia !== (b.is_active === true)) {
          v.push(ia); sets.push('is_active = $' + v.length);
          changes.push([ia ? 'category_enable' : 'category_disable', { slug: slugIn }]);
        }
      }
      if (!sets.length) return { slug: slugIn, changed: false };
      v.push(a); sets.push('updated_by_account_id = $' + v.length);
      v.push(n); sets.push('updated_by_name = $' + v.length);
      v.push(slugIn);
      await c.query(`UPDATE notice.notice_categories SET ${sets.join(', ')} WHERE slug = $${v.length}`, v);
      for (const [act, payload] of changes) await writeAudit(c, actor, null, act, null, payload);
      return { slug: slugIn, changed: true };
    });
  },
  'notice.categories.reorder': async (config, actor, params) => {
    await requireManage(config, actor);
    const order = Array.isArray(params && params.order) ? params.order.map(text).filter(Boolean) : [];
    if (!order.length) throw nErr('NOTICE_CATEGORY_ORDER', 'Thiếu thứ tự danh mục.', 400);
    return writeTx(config, async (c) => {
      let i = 10;
      for (const slug of order) {
        await c.query('UPDATE notice.notice_categories SET sort_order = $1, updated_by_name = $3 WHERE slug = $2', [i, slug, actor.displayName || actor.employeeCode || null]);
        i += 10;
      }
      await writeAudit(c, actor, null, 'category_reorder', null, { order });
      return { reordered: order.length };
    });
  },

  // ---- DUPLICATE WARNING while composing (§5) — read-only, non-blocking ----
  'notice.similar': async (config, actor, params) => {
    await requireManage(config, actor);
    const title = text(params && params.title) || '';
    const body = text(params && params.contentText) || '';
    const kws = (Array.isArray(params && params.keywords) ? params.keywords : []).map(text).filter(Boolean).join(' ');
    const excludeId = text(params && params.excludeId);
    const probe = (title + ' ' + kws + ' ' + body).replace(/\s+/g, ' ').trim().split(' ').slice(0, 40).join(' ');
    if (probe.length < 3) return { candidates: [] };
    const today = todayISO();
    return readTx(config, async (c) => {
      // OR the distinct significant terms — websearch_to_tsquery ANDs, which
      // almost never matches a *different* notice. Build a `t1 | t2 | ...` query.
      const terms = Array.from(new Set(
        probe.split(/[^\p{L}\p{N}]+/u).map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2)
      )).slice(0, 14);
      if (!terms.length) return { candidates: [] };
      const orQuery = terms.join(' | ');
      const r = await c.query(
        `SELECT n.id, n.title, n.notice_type, n.effective_from, n.effective_to, n.status, cat.name AS category_name,
                ts_rank(n.search_tsv, to_tsquery('simple', notice.vn_unaccent($1))) AS score
           FROM notice.notices n LEFT JOIN notice.notice_categories cat ON cat.slug = n.notice_type
          WHERE n.deleted_at IS NULL AND n.status = 'published'
            AND ($2 = '' OR n.id <> $2::uuid)
            AND n.search_tsv @@ to_tsquery('simple', notice.vn_unaccent($1))
          ORDER BY score DESC LIMIT 6`,
        [orQuery, excludeId || '']
      );
      return {
        candidates: r.rows.map((x) => ({
          id: x.id, title: x.title, categoryName: x.category_name || x.notice_type,
          effectiveStatus: effectiveStatus(x, today), score: Number(x.score) || 0,
        })).filter((x) => x.score > 0.01),
      };
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

  // ---- MODULE PERMISSIONS — ADMIN ONLY (Operator §C/§D) ----------------
  // Reading OR writing the manager roster is a system-Admin action. A "Quản trị
  // nội dung" grantee manages notices, never the permission roster.
  'notice.permissions.list': async (config, actor) => {
    requireAdmin(actor);
    return readTx(config, async (c) => {
      const r = await c.query('SELECT employee_code, can_manage, updated_at, updated_by_name FROM notice.notice_permissions ORDER BY employee_code');
      return { permissions: r.rows.map((x) => ({ employeeCode: x.employee_code, canManage: x.can_manage === true, updatedAt: x.updated_at, updatedByName: x.updated_by_name || '' })) };
    });
  },
  'notice.permissions.set': async (config, actor, params) => {
    requireAdmin(actor); // grant/revoke "Quản trị nội dung" — system Admin only
    const employeeCode = upperCode(params && params.employeeCode);
    const canManage = boolish(params && params.canManage);
    if (!employeeCode) throw nErr('NOTICE_EMPLOYEE_REQUIRED', 'Thiếu mã nhân viên.', 400);
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
    requireAdmin(actor);
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
  // NOTE (§F): dev-allow only lets the caller PAST the lock above. It confers no
  // business role — `_devOperator` is intentionally NOT set on the actor.

  return handler(config, actor, params || {}, devGate);
}

module.exports = { dispatch, ACTIONS, HANDLERS, NoticeError, NOTICE_TYPES, PRIORITIES, sanitizeNoticeHtml, noticeHtmlToText, htmlFromText, tocFromHtml };
