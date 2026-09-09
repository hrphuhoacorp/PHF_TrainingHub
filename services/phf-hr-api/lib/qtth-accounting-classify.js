'use strict';

// PHF HR — QTTH Truth Data · Accounting · classification / exclusion engine.
//
// Centralized rule engine (Operator handover §8/§9):
//   broad INCLUDE (641*/642* debit)  ->  explicit EXCLUDE  ->  unknown = NEEDS_REVIEW
// Unknown is NEVER dropped and NEVER silently included.
//
// A row reaches the engine only if it is DEBIT-SIDE (phatSinhNo > 0) and in the
// broad cost scope (Tài khoản starts 641 or 642). Everything else is out of
// scope for V1 (no revenue / COGS / cash / payable ingestion — §3).
//
// Priority ASC = evaluated first; first matching active rule wins. The seed set
// below is the SAME rule set the migration seeds into
// accounting.classification_rule — kept here so offline tests and a first run
// with an empty table still classify identically.

const RULE_VERSION = 'v1';

// Department master (FAST `Mã bp`). Out-of-master values are KEPT + flagged,
// never remapped, never dropped (§13).
const MASTER_DEPARTMENTS = ['BP01', 'BP02', 'CN1', 'CN2', 'CN3', 'CN4'];

const SEED_RULES = [
  { id: 'v1-exclude-closing-911', priority: 10, matchKind: 'contra_prefix', matchValue: { prefixes: ['911'] }, action: 'EXCLUDE',
    note: 'Kết chuyển 641/642 -> 911 (KQKD). Không phải chi phí phát sinh — double-count guard.' },
  ...['6414', '6422', '6423', '64177', '64178', '64188', '64273', '64274'].map((a) => ({
    id: 'v1-review-' + a, priority: 20, matchKind: 'account_exact', matchValue: { accounts: [a] }, action: 'NEEDS_REVIEW',
    note: 'Không có Mã số tương ứng trong BC Chi Phí QTTH — chờ KTT xem bằng chứng dòng thật.',
  })),
  { id: 'v1-include-bc-641', priority: 30, matchKind: 'account_exact', action: 'INCLUDE',
    note: 'Chi phí bán hàng — Mã số BC Chi Phí QTTH (IX / 641).',
    matchValue: { accounts: ['64111', '64112', '64113', '64114', '64115', '64116', '64117', '64121', '64122', '64123', '64124', '64131', '64132', '64133', '64134', '64135', '64141', '64171', '64172', '64173', '64174', '64175', '64176', '64181', '64182', '64183', '64184', '64185', '64186', '64187'] } },
  { id: 'v1-include-bc-642', priority: 30, matchKind: 'account_exact', action: 'INCLUDE',
    note: 'Chi phí quản lý doanh nghiệp — Mã số BC Chi Phí QTTH (X / 642).',
    matchValue: { accounts: ['64211', '64212', '64213', '64214', '64215', '64216', '64217', '64221', '64222', '64223', '64224', '64241', '64251', '64271', '64272', '64281', '64282', '64283', '64284', '64285', '64286', '64287', '64288'] } },
  { id: 'v1-safety-641', priority: 90, matchKind: 'account_prefix', matchValue: { prefixes: ['641'] }, action: 'NEEDS_REVIEW',
    note: 'Bất kỳ 641* phát sinh Nợ nào chưa có rule -> chờ Operator xem bằng chứng dòng thật.' },
  { id: 'v1-safety-642', priority: 90, matchKind: 'account_prefix', matchValue: { prefixes: ['642'] }, action: 'NEEDS_REVIEW',
    note: 'Bất kỳ 642* phát sinh Nợ nào chưa có rule -> chờ Operator xem bằng chứng dòng thật.' },
];

function inCostScope(row) {
  return row.phatSinhNo > 0 && /^(641|642)/.test(String(row.taiKhoan || ''));
}

function ruleMatches(rule, row) {
  const mv = rule.matchValue || {};
  const acct = String(row.taiKhoan || '').trim();
  const contra = String(row.tkDoiUng || '').trim();
  const dept = String(row.maBp || '').trim().toUpperCase();
  const voucher = String(row.maCt || '').trim().toUpperCase();
  const desc = String(row.dienGiai || '');
  switch (rule.matchKind) {
    case 'account_exact': return Array.isArray(mv.accounts) && mv.accounts.indexOf(acct) >= 0;
    case 'account_prefix': return Array.isArray(mv.prefixes) && mv.prefixes.some((p) => acct.startsWith(p));
    case 'contra_prefix': return Array.isArray(mv.prefixes) && mv.prefixes.some((p) => contra.startsWith(p));
    case 'department': return Array.isArray(mv.departments) && mv.departments.map(String).map((s) => s.toUpperCase()).indexOf(dept) >= 0;
    case 'voucher': return Array.isArray(mv.vouchers) && mv.vouchers.map(String).map((s) => s.toUpperCase()).indexOf(voucher) >= 0;
    case 'description': {
      if (mv.regex) { try { return new RegExp(mv.regex, mv.flags || 'i').test(desc); } catch (_) { return false; } }
      return Array.isArray(mv.contains) && mv.contains.some((s) => desc.toLowerCase().includes(String(s).toLowerCase()));
    }
    case 'combo': return Array.isArray(mv.all) && mv.all.every((sub) => ruleMatches({ matchKind: sub.matchKind, matchValue: sub.matchValue }, row));
    default: return false;
  }
}

// buildClassifier(rules?) -> { classify(row), ruleVersion, rules }
// rules: array of { id, priority, matchKind, matchValue, action, note, isActive }
// (DB rows use snake_case — normalize before passing, or pass nothing for SEED).
function buildClassifier(rules) {
  const active = (Array.isArray(rules) && rules.length ? rules : SEED_RULES)
    .filter((r) => r.isActive !== false)
    .slice()
    .sort((a, b) => (a.priority || 100) - (b.priority || 100) || String(a.id).localeCompare(String(b.id)));
  const ver = active.length && active[0].ruleVersion ? active[0].ruleVersion : RULE_VERSION;

  function classify(row) {
    for (const rule of active) {
      if (ruleMatches(rule, row)) {
        return { classification: rule.action, ruleId: rule.id, ruleNote: rule.note || null };
      }
    }
    // defence in depth — the priority-90 safety rules should always catch a
    // cost-scope row, but an unknown is NEEDS_REVIEW, never dropped/included.
    return { classification: 'NEEDS_REVIEW', ruleId: null, ruleNote: 'Không khớp rule nào — giữ lại để Operator xem.' };
  }
  return { classify, ruleVersion: ver, rules: active };
}

function isOutOfMasterDepartment(maBp) {
  const v = String(maBp || '').trim().toUpperCase();
  if (!v) return false;
  return MASTER_DEPARTMENTS.indexOf(v) < 0;
}

module.exports = {
  RULE_VERSION, MASTER_DEPARTMENTS, SEED_RULES,
  inCostScope, buildClassifier, isOutOfMasterDepartment, ruleMatches,
};
