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
const { upsertKnlPermissionGrant } = require('../lib/knl-permissions');

const APPLY = process.argv.includes('--apply');
const db = createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), { auth: { persistSession: false, autoRefreshToken: false } });

const SESSION = { role: 'admin', sub: 'system-knl-grade-promotion-permission-init', account: { id: 'system-knl-grade-promotion-permission-init', name: 'PHF KNL Grade Promotion Proposal — permission init plan (batch 2.1)' } };
const REASON = 'KNL Đề xuất nâng bậc — permission initialization theo policy đã chốt, verify lại batch 2.2 (không hard-code theo employee_code). Không đổi income_view/incomeScope.';

/* BATCH 2.2 FIX: gỡ toàn bộ hard-code theo employee_code (kể cả nhánh Giám
 * đốc riêng — "Giám đốc không cần tạo ngoại lệ hard-code riêng", mục 3 batch
 * 2.2). Rule bây giờ áp dụng ĐỒNG NHẤT cho mọi account, chỉ phân nhánh theo
 * preset_code (dữ liệu, không phải danh sách mã nhân viên viết tay) đúng 1
 * chỗ duy nhất — cho agree_proposal:
 *
 *   Rule 1 (MỌI account, không ngoại lệ): propose:true + view_proposals:true
 *   + proposalScope MIRROR đúng people_scope hiện có (đã đánh giá semantic ở
 *   mục 4 batch 2.1). Giám đốc (preset TRO_LY_GD, people_scope=all_company,
 *   agree_proposal=false SẴN CÓ trong data) nhận đúng propose/view_proposals/
 *   proposalScope=all_company như MỌI account khác cùng shape — không có
 *   nhánh code riêng nào kiểm tra employee_code của bà.
 *
 *   Rule 2 (agree_proposal — CHỈ đụng khi thật sự thiếu): chỉ bổ sung
 *   agree_proposal:true cho preset_code==='TRUONG_BO_PHAN' hiện đang false
 *   (đúng policy "TBP: agree_proposal đúng department", xác nhận lại bằng
 *   query trực tiếp ở batch 2.2). KHÔNG đụng agree_proposal của preset nào
 *   khác — 3 Trợ lý GĐ (PHF004/010/032) CŨNG preset TRUONG_BO_PHAN nhưng đã
 *   true sẵn trong data thật nên set() không ghi gì (no-op, không phải bị bỏ
 *   qua có chủ đích); TRO_LY_GD (chỉ Giám đốc dùng preset này trong data thật
 *   — xem TRACE REPORT batch 1 mục preset mislabeling) và TRUONG_CA_CHTR (3
 *   Trưởng ca, đã true sẵn) không nằm trong Rule 2 nên giữ nguyên giá trị
 *   agree_proposal đang có — đây chính là lý do Giám đốc không cần nhánh
 *   riêng: preset TRO_LY_GD của bà chưa từng bị Rule 2 chạm tới. */
function planFor(grant) {
  const cap = grant.capabilities || {};
  const scope = grant.people_scope || { type: 'self', values: [] };
  const patch = { capabilities: { ...cap }, changed: [] };
  function set(key, value) { if (patch.capabilities[key] !== value) { patch.capabilities[key] = value; patch.changed.push(key + ': ' + cap[key] + ' -> ' + value); } }

  set('propose', true);
  set('view_proposals', true);
  const proposalScope = { type: scope.type, values: scope.values || [] };
  if (JSON.stringify(patch.capabilities.proposalScope) !== JSON.stringify(proposalScope)) { patch.capabilities.proposalScope = proposalScope; patch.changed.push('proposalScope: -> ' + JSON.stringify(proposalScope)); }

  if (grant.preset_code === 'TRUONG_BO_PHAN') set('agree_proposal', true);

  return patch;
}

async function main() {
  const result = await db.from('knl_permission_grants').select('account_id,employee_code,employee_name,preset_code,capabilities,people_scope,is_active').eq('is_active', true).order('employee_code');
  if (result.error) { console.error(result.error.message); process.exit(1); }
  const grants = result.data || [];

  console.log(APPLY ? '=== APPLYING PERMISSION INIT PLAN ===' : '=== DRY RUN — PLAN ONLY (pass --apply to write) ===');
  console.log('Total active grants scanned:', grants.length, '\n');

  let changedCount = 0;
  for (const grant of grants) {
    const plan = planFor(grant);
    if (!plan.changed.length) continue;
    changedCount++;
    console.log(grant.employee_code, grant.employee_name, '(' + grant.preset_code + ')');
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
  console.log('\nAccounts requiring changes:', changedCount, '/', grants.length);
  console.log('Accounts unchanged (already correct or no plan rule matched):', grants.length - changedCount);
  if (!APPLY) console.log('\nNo writes performed. Re-run with --apply after PHF/Technical Lead review AND after the migration has been applied to Production.');
}
main().catch(e => { console.error(e); process.exit(1); });
