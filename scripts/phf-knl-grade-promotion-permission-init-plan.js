'use strict';
/*
 * PHF KNL "Đề xuất nâng bậc" — Permission Initialization PLAN.
 * Gốc: mục 3 batch 2.1. SỬA ở batch 2.2: gỡ hard-code theo employee_code
 * (bao gồm nhánh Giám đốc riêng) sau khi Technical Lead chỉ ra Batch 1 từng
 * BÁO SAI rằng 3 Trưởng ca Bán hàng chưa có agree_proposal — đã verify lại
 * bằng query trực tiếp (batch 2.2): PHF018/041/042 THẬT SỰ đã có
 * agree_proposal:true từ trước (không phải do batch nào của tôi ghi — xem
 * updated_at ~2026-08-11T02:40 UTC, trước cả batch 1). Rule giờ derive từ
 * preset_code (dữ liệu), không phải danh sách mã nhân viên viết tay.
 *
 * REVIEWABLE nhưng CHƯA APPLY — dry-run mặc định, chỉ in ra đúng những gì sẽ
 * đổi cho từng account theo policy đã chốt, KHÔNG tự chạy --apply ở batch
 * này. Không đụng income_view/incomeScope ở bất kỳ dòng nào — mọi patch dưới
 * đây chỉ set propose/agree_proposal/view_proposals/proposalScope, income
 * giữ nguyên y hệt giá trị đang có trên mỗi account. approve KHÔNG được set
 * cho bất kỳ ai (Admin dùng đường cứu hộ role='admin', không cần grant).
 *
 * Ghi qua đúng lib/knl-permissions.js#upsertKnlPermissionGrant (audit đầy đủ
 * vào knl_permission_grant_history), KHÔNG ghi thẳng bảng — cùng convention
 * đã dùng ở scripts/phf-org-master-seed-from-checklist-1.50.7.js.
 *
 * Chạy xem plan (KHÔNG ghi gì):
 *   node scripts/phf-knl-grade-promotion-permission-init-plan.js
 * Chạy apply thật (CHỈ khi PHF/Technical Lead đã duyệt plan này VÀ migration
 * scripts/PHF_KNL_GRADE_PROMOTION_PROPOSAL_1.51.0.sql đã apply Production):
 *   node scripts/phf-knl-grade-promotion-permission-init-plan.js --apply
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { upsertKnlPermissionGrant } = require('../api/_lib/knl-permissions');

const APPLY = process.argv.includes('--apply');
const db = createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), { auth: { persistSession: false, autoRefreshToken: false } });

const SESSION = { role: 'admin', sub: 'system-knl-grade-promotion-permission-init', account: { id: 'system-knl-grade-promotion-permission-init', name: 'PHF KNL Grade Promotion Proposal — permission init plan (batch 2.1)' } };
const REASON = 'KNL Đề xuất nâng bậc — permission initialization theo policy đã chốt, verify lại batch 2.2 (không hard-code theo employee_code). Không đổi income_view/incomeScope.';

/* PRODUCTION GATE FIX (rollout batch): PHF chốt tường minh Giám đốc KHÔNG
 * được propose=true (chỉ xem, không tự đề xuất) — khác với rule "đồng nhất"
 * ở batch 2.2. Phân loại vẫn HOÀN TOÀN DATA-DRIVEN qua people_scope.type,
 * KHÔNG hard-code employee_code nào:
 *
 *   - people_scope.type === 'all_company'  -> nhóm "view-only toàn công ty"
 *     (Giám đốc là account DUY NHẤT có shape này trong data thật — verify
 *     lại ngay trước khi apply, xem guardAllCompanyGroup() bên dưới):
 *     propose GIỮ NGUYÊN (không set true), view_proposals=true,
 *     proposalScope=all_company, agree_proposal GIỮ NGUYÊN (không đụng).
 *   - Mọi type khác (department/sales_all_branches/self/employees):
 *     propose=true, view_proposals=true, proposalScope mirror people_scope,
 *     agree_proposal=true CHỈ khi preset_code==='TRUONG_BO_PHAN' còn false
 *     (đúng policy TBP) — không đụng agree_proposal của preset khác.
 *
 * approve KHÔNG set cho ai (Admin dùng đường cứu hộ role='admin').
 * income_view/incomeScope KHÔNG đọc/ghi ở bất kỳ đâu trong file này. */
function planFor(grant) {
  const cap = grant.capabilities || {};
  const scope = grant.people_scope || { type: 'self', values: [] };
  const patch = { capabilities: { ...cap }, changed: [] };
  function set(key, value) { if (patch.capabilities[key] !== value) { patch.capabilities[key] = value; patch.changed.push(key + ': ' + cap[key] + ' -> ' + value); } }

  const isViewOnlyAllCompany = scope.type === 'all_company';

  if (!isViewOnlyAllCompany) set('propose', true);
  set('view_proposals', true);
  const proposalScope = { type: scope.type, values: scope.values || [] };
  if (JSON.stringify(patch.capabilities.proposalScope) !== JSON.stringify(proposalScope)) { patch.capabilities.proposalScope = proposalScope; patch.changed.push('proposalScope: -> ' + JSON.stringify(proposalScope)); }

  if (!isViewOnlyAllCompany && grant.preset_code === 'TRUONG_BO_PHAN') set('agree_proposal', true);

  return patch;
}

// Guard: nhóm "all_company" phải ĐÚNG 1 account (Giám đốc) và account đó phải
// đang agree_proposal=false — nếu khác, dữ liệu đã đổi so với báo cáo batch
// 2.2 -> STOP, không apply mù theo rule cũ.
function guardAllCompanyGroup(grants) {
  const group = grants.filter(g => (g.people_scope || {}).type === 'all_company');
  if (group.length !== 1) return 'Nhóm all_company có ' + group.length + ' account (kỳ vọng đúng 1 = Giám đốc) — dữ liệu khác báo cáo batch 2.2.';
  const g = group[0];
  if (g.capabilities && g.capabilities.agree_proposal === true) return 'Account all_company (' + g.employee_code + ') đang agree_proposal=true — khác báo cáo batch 2.2 (kỳ vọng false).';
  return null;
}

async function main() {
  const result = await db.from('knl_permission_grants').select('account_id,employee_code,employee_name,preset_code,capabilities,people_scope,is_active').eq('is_active', true).order('employee_code');
  if (result.error) { console.error(result.error.message); process.exit(1); }
  const grants = result.data || [];

  const guardError = guardAllCompanyGroup(grants);
  if (guardError) { console.error('STOP — GUARD FAILED:', guardError); process.exit(1); }

  console.log(APPLY ? '=== APPLYING PERMISSION INIT PLAN ===' : '=== DRY RUN — PLAN ONLY (pass --apply to write) ===');
  console.log('Total active grants scanned:', grants.length, '\n');

  let changedCount = 0, proposeTrueCount = 0, viewProposalsTrueCount = 0, agreeProposalTrueCount = 0;
  const incomeFieldTouched = [];
  for (const grant of grants) {
    const plan = planFor(grant);
    if (plan.capabilities.propose === true) proposeTrueCount++;
    if (plan.capabilities.view_proposals === true) viewProposalsTrueCount++;
    if (plan.capabilities.agree_proposal === true) agreeProposalTrueCount++;
    if (plan.changed.some(line => /income_view|incomeScope/i.test(line))) incomeFieldTouched.push(grant.employee_code);
    if (!plan.changed.length) continue;
    changedCount++;
    console.log(grant.employee_code, grant.employee_name, '(' + grant.preset_code + ', scope=' + (grant.people_scope || {}).type + ')');
    plan.changed.forEach(line => console.log('  ' + line));
    if (APPLY) {
      const { capabilities } = plan;
      delete capabilities.changed;
      const { grant: saved } = await upsertKnlPermissionGrant(SESSION, {
        accountId: grant.account_id, employeeCode: grant.employee_code, employeeName: grant.employee_name,
        presetCode: grant.preset_code, capabilities, peopleScope: grant.people_scope, reason: REASON
      });
      console.log('  WRITTEN. new capabilities:', JSON.stringify(saved.capabilities));
    }
  }
  console.log('\n=== SUMMARY ===');
  console.log('Accounts requiring changes:', changedCount, '/', grants.length);
  console.log('Accounts unchanged (already correct or no plan rule matched):', grants.length - changedCount);
  console.log('Final propose=true count:', proposeTrueCount, '/', grants.length, '(expected 36/37 — PHF002 excluded)');
  console.log('Final view_proposals=true count:', viewProposalsTrueCount, '/', grants.length, '(expected 37/37)');
  console.log('Final agree_proposal=true count:', agreeProposalTrueCount, '/', grants.length, '(expected 12/37 — 3 Trợ lý + 3 Trưởng ca + 6 TBP)');
  console.log('income_view/incomeScope touched on any account:', incomeFieldTouched.length ? incomeFieldTouched.join(',') : 'NONE (confirmed untouched)');
  if (!APPLY) console.log('\nNo writes performed. Re-run with --apply after PHF/Technical Lead review AND after the migration has been applied to Production.');
}
main().catch(e => { console.error(e); process.exit(1); });
