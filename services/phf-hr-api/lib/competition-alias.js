'use strict';

// PHF HR — Competition V1 · anonymous alias assignment.
//
// One system-assigned alias per participant per campaign. Stable through the
// campaign; a new campaign gets a new alias. Users cannot choose their alias.
// Real identity stays on competition.participant_aliases for auditability —
// reviewer-facing reads must never select account_id / employee_code from it.
//
// Pool = friendly PHF fruit x positive sales/service trait. If the campaign
// grows past pool size, we append a deterministic numeric suffix so uniqueness
// never breaks (e.g. "Táo Tư Vấn #2").

const { cErr } = require('./competition-common');

const FRUITS = ['Táo', 'Cam', 'Nho', 'Kiwi', 'Dâu', 'Bơ', 'Xoài', 'Cherry', 'Dừa', 'Thanh Long',
  'Mận', 'Ổi', 'Vải', 'Nhãn', 'Chuối', 'Dưa Lưới', 'Bưởi', 'Hồng', 'Lê', 'Mít'];
const TRAITS = ['Tư Vấn', 'Chốt Đơn', 'Tận Tâm', 'Nhanh Nhẹn', 'Thân Thiện', 'Chu Đáo',
  'Khéo Léo', 'Tươi Tắn', 'Nhiệt Tình', 'Kiên Nhẫn', 'Chuyên Nghiệp', 'Lắng Nghe'];

// deterministic order of the full fruit x trait grid, seeded by campaign id so
// two campaigns don't hand out aliases in the same sequence.
function seededOrder(campaignId) {
  let h = 2166136261;
  for (let i = 0; i < String(campaignId).length; i++) {
    h ^= String(campaignId).charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const combos = [];
  for (const f of FRUITS) for (const t of TRAITS) combos.push(f + ' ' + t);
  // Fisher–Yates with a tiny LCG seeded by h
  let s = h || 1;
  for (let i = combos.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = combos[i]; combos[i] = combos[j]; combos[j] = tmp;
  }
  return combos;
}

// Ensure the actor has an alias for the campaign. Returns { alias, created }.
// MUST be called inside an open write transaction (client), typically as part
// of "submit" so membership + alias are atomic.
async function ensureAlias(client, campaignId, actor) {
  const accountId = actor.accountId || '';
  const employeeCode = actor.employeeCode || '';
  if (!accountId && !employeeCode) throw cErr('COMPETITION_ACTOR_REQUIRED', 'Actor không có định danh.', 401);

  const existing = await client.query(
    `SELECT alias FROM competition.participant_aliases
      WHERE campaign_id = $1
        AND ( ($2 <> '' AND account_id = $2) OR ($3 <> '' AND employee_code = $3) )
      LIMIT 1`,
    [campaignId, accountId, employeeCode]);
  if (existing.rowCount > 0) return { alias: existing.rows[0].alias, created: false };

  const takenR = await client.query(
    'SELECT alias FROM competition.participant_aliases WHERE campaign_id = $1', [campaignId]);
  const taken = new Set(takenR.rows.map((r) => r.alias));

  const order = seededOrder(campaignId);
  let chosen = null;
  for (const base of order) { if (!taken.has(base)) { chosen = base; break; } }
  if (!chosen) {
    // pool exhausted — deterministic suffixing, smallest free suffix on the
    // first base in seeded order.
    outer: for (let suffix = 2; suffix < 10000; suffix++) {
      for (const base of order) {
        const cand = base + ' #' + suffix;
        if (!taken.has(cand)) { chosen = cand; break outer; }
      }
    }
  }
  if (!chosen) throw cErr('COMPETITION_ALIAS_POOL_EXHAUSTED', 'Không thể cấp bí danh.', 500);

  const ins = await client.query(
    `INSERT INTO competition.participant_aliases (campaign_id, account_id, employee_code, alias)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (campaign_id, account_id) DO NOTHING
     RETURNING alias`,
    [campaignId, accountId || ('ACC_MISSING_' + employeeCode), employeeCode || ('EMP_MISSING_' + accountId), chosen]);
  if (ins.rowCount === 0) {
    // lost a race — re-read
    const again = await client.query(
      `SELECT alias FROM competition.participant_aliases
        WHERE campaign_id = $1 AND account_id = $2 LIMIT 1`,
      [campaignId, accountId || ('ACC_MISSING_' + employeeCode)]);
    return { alias: again.rows[0].alias, created: false };
  }
  return { alias: ins.rows[0].alias, created: true };
}

module.exports = { ensureAlias, seededOrder, FRUITS, TRAITS };
