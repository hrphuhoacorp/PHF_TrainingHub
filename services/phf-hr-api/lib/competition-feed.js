'use strict';

// PHF HR — Competition V1 · anonymous feed + reactions ("thả tim").
//
// Feed shows ONLY approved / finalized submissions. While the campaign is not
// published, the author is shown by alias only — no real identity. After
// finalize + publish, real names may be revealed. Rejected / submitted /
// needs_revision never appear. A lower->higher upgrade keeps the same feed
// post (it is the same submission row).
//
// Reactions never touch score / leaderboard / awards / approval level — there
// is no column or FK linking them.

const { readTx, writeTx, cErr, auditActor } = require('./competition-common');

// Server-side keyset pagination. The feed's business ordering is unchanged
// (newest approved/finalized first, by COALESCE(approved_at, submitted_at));
// the only addition is a stable id tie-break so a cursor can page through it
// without gaps/duplicates even when two posts share the same timestamp.
const FEED_PAGE_DEFAULT = 20;
const FEED_PAGE_MAX = 50;

function clampLimit(v, def, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(max, Math.floor(n));
}

// Opaque cursor: { t: <ISO order-timestamp>, i: <submission uuid> }. Base64url
// so the client only ever echoes it back verbatim.
function encodeCursor(orderTs, id) {
  if (!orderTs || !id) return null;
  const ts = (orderTs instanceof Date) ? orderTs.toISOString() : String(orderTs);
  return Buffer.from(JSON.stringify({ t: ts, i: String(id) }), 'utf8').toString('base64url');
}
function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    if (!o || !o.t || !o.i) return null;
    return { t: String(o.t), i: String(o.i) };
  } catch (e) {
    throw cErr('COMPETITION_FEED_CURSOR_INVALID', 'Con trỏ bảng tin không hợp lệ.', 400);
  }
}

async function getFeed(config, actor, params) {
  const campaignId = params.campaignId;
  const limit = clampLimit(params.limit, FEED_PAGE_DEFAULT, FEED_PAGE_MAX);
  const cursor = decodeCursor(params.cursor);
  return readTx(config, async (client) => {
    const c = await client.query('SELECT status, publication_state FROM competition.campaigns WHERE id = $1', [campaignId]);
    if (!c.rowCount) throw cErr('COMPETITION_CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình.', 404);
    const published = c.rows[0].publication_state === 'published';

    // Payload projection: the feed card only renders customer_question /
    // answer / actual_result (see qaFieldsHtml — evidence_reference is NOT
    // shown on a feed post). Returning only those keys keeps the row small
    // and future-proof against larger form schemas, without changing any
    // visible content.
    const rows = await client.query(
      `SELECT s.id, s.current_level_order, s.current_score, s.submitted_at, s.status,
              jsonb_strip_nulls(jsonb_build_object(
                'customer_question', s.payload->'customer_question',
                'answer',            s.payload->'answer',
                'actual_result',     s.payload->'actual_result'
              )) AS payload,
              COALESCE(s.approved_at, s.submitted_at)::text AS order_ts_cursor,
              al.name AS level_name,
              pa.alias,
              CASE WHEN $2::boolean THEN s.author_display_name_snapshot ELSE NULL END AS revealed_name,
              ( SELECT count(*) FROM competition.reactions r WHERE r.submission_id = s.id AND r.is_active ) AS reaction_total,
              EXISTS ( SELECT 1 FROM competition.reactions r
                        WHERE r.submission_id = s.id AND r.is_active
                          AND ( ($3 <> '' AND r.account_id = $3) OR ($4 <> '' AND r.employee_code = $4) ) ) AS viewer_reacted
         FROM competition.submissions s
         LEFT JOIN competition.approval_levels al ON al.campaign_id = s.campaign_id AND al.level_order = s.current_level_order
         LEFT JOIN competition.participant_aliases pa ON pa.campaign_id = s.campaign_id
               AND pa.account_id = s.author_account_id
        WHERE s.campaign_id = $1 AND s.status IN ('approved','finalized')
          AND ( $5::timestamptz IS NULL
                OR ( COALESCE(s.approved_at, s.submitted_at), s.id ) < ( $5::timestamptz, $6::uuid ) )
        ORDER BY COALESCE(s.approved_at, s.submitted_at) DESC, s.id DESC
        LIMIT $7`,
      [campaignId, published, actor.accountId || '', actor.employeeCode || '',
       cursor ? cursor.t : null, cursor ? cursor.i : null, limit + 1]);

    const hasMore = rows.rows.length > limit;
    const page = hasMore ? rows.rows.slice(0, limit) : rows.rows;
    const last = page.length ? page[page.length - 1] : null;

    return {
      campaignStatus: c.rows[0].status,
      published,
      nextCursor: hasMore && last ? encodeCursor(last.order_ts_cursor, last.id) : null,
      posts: page.map((x) => ({
        submissionId: x.id,
        anonAlias: x.alias || 'Người tham gia',
        authorName: x.revealed_name || null,     // null unless published
        payload: x.payload,
        approvalLevel: x.current_level_order,
        approvalLevelName: x.level_name,
        currentScore: x.current_score == null ? null : Number(x.current_score),
        reactionTotal: Number(x.reaction_total),
        viewerReacted: x.viewer_reacted,
        submittedAt: x.submitted_at,
        status: x.status,
      })),
    };
  });
}

async function setReaction(config, actor, params) {
  const on = params.on !== false;
  const aa = auditActor(actor);
  const acc = aa.account_id || ('ACC_' + aa.employee_code);
  const emp = aa.employee_code || ('EMP_' + aa.account_id);
  return writeTx(config, async (client) => {
    const s = await client.query('SELECT id, status FROM competition.submissions WHERE id = $1', [params.submissionId]);
    if (!s.rowCount) throw cErr('COMPETITION_SUBMISSION_NOT_FOUND', 'Không tìm thấy bài.', 404);
    if (!['approved', 'finalized'].includes(s.rows[0].status)) {
      throw cErr('COMPETITION_REACTION_NOT_ALLOWED', 'Chỉ thả tim cho bài đã duyệt.', 409);
    }
    if (on) {
      await client.query(
        `INSERT INTO competition.reactions (submission_id, account_id, employee_code, is_active)
         VALUES ($1,$2,$3,true)
         ON CONFLICT (submission_id, account_id) WHERE is_active DO NOTHING`,
        [params.submissionId, acc, emp]);
    } else {
      await client.query(
        `UPDATE competition.reactions SET is_active = false
          WHERE submission_id = $1 AND account_id = $2 AND is_active`,
        [params.submissionId, acc]);
    }
    const total = await client.query(
      'SELECT count(*)::int n FROM competition.reactions WHERE submission_id = $1 AND is_active', [params.submissionId]);
    return { submissionId: params.submissionId, reactionTotal: total.rows[0].n, viewerReacted: on };
  });
}

module.exports = { getFeed, setReaction };
