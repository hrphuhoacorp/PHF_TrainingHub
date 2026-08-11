'use strict';
/*
 * PHF KNL "Đề xuất nâng bậc" — Permission Initialization PLAN (mục 3 batch 2.1).
 *
 * REVIEWABLE nhưng CHƯA APPLY — dry-run mặc định, chỉ in ra đúng những gì sẽ
 * đổi cho từng account theo policy đã chốt (mục 3), KHÔNG tự chạy --apply ở
 * batch này. Không đụng income_view/incomeScope ở bất kỳ dòng nào — mọi patch
 * dưới đây chỉ set access_knl/propose/agree_proposal/approve/view_proposals/
 * proposalScope, income giữ nguyên y hệt giá trị đang có trên mỗi account.
 *
 * Ghi qua đúng lib/knl-permissions.js#upsertKnlPermissionGrant (audit đầy đủ
 * vào knl_permission_grant_history), KHÔNG ghi thẳng bảng — cùng convention
 * đã dùng ở scripts/phf-org-master-seed-from-checklist-1.50.7.js.
 *
 * Policy nguồn (mục 3 batch 2.1):
 *   Creation : NV=self; TBP/Trợ lý/Trưởng ca=self+phạm vi phụ trách (reuse
 *              people_scope, đã đánh giá ở mục 4 — xem lib/knl-grade-
 *              proposals.js#creationAuthorized); Admin=all company (đường
 *              cứu hộ, không cần grant).
 *   Visibility: NV=self; Trưởng ca Bán hàng=Sales 3 CN; TBP=department;
 *              Trợ lý=các department/mảng phụ trách; Giám đốc=all_company
 *              view-only; Admin=all_company (đường cứu hộ).
 *   Processing: Trưởng ca Bán hàng hợp lệ=agree_proposal trong Sales scope;
 *              TBP=agree_proposal đúng department; Ngọc/Tiên/Vinh=agree_
 *              proposal đúng mảng đã chốt (đã có sẵn trong data thật); Giám
 *              đốc=false; Admin=final authority (đường cứu hộ, approve chỉ
 *              cần cho Admin — KHÔNG grant approve=true cho ai khác ở plan
 *              này, đúng "Admin: final authority").
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
const REASON = 'KNL Đề xuất nâng bậc — permission initialization theo policy đã chốt (mục 3, batch 2.1). Không đổi income_view/incomeScope.';

// TBP 6 phòng ban (mục 3: "TBP: agree_proposal đúng department") — dùng đúng
// people_scope hiện có của từng account làm proposalScope (đã đánh giá ở mục
// 4: cùng semantic "phạm vi phụ trách").
const TBP_CODES = new Set(['PHF012', 'PHF028', 'PHF034', 'PHF038', 'PHF051', 'PHF071']);
// Ngọc/Tiên/Vinh (mục 3: "Ngọc/Tiên/Vinh: agree_proposal đúng mảng đã chốt")
// — agree_proposal đã = true sẵn trong data thật, chỉ cần bổ sung propose +
// view_proposals/proposalScope.
const ASSISTANT_CODES = new Set(['PHF004', 'PHF010', 'PHF032']);
const SALES_LEADER_CODES = new Set(['PHF018', 'PHF041', 'PHF042']);
const DIRECTOR_CODE = 'PHF002';

function planFor(grant) {
  const code = grant.employee_code;
  const cap = grant.capabilities || {};
  const scope = grant.people_scope || { type: 'self', values: [] };
  const patch = { capabilities: { ...cap }, peopleScope: grant.people_scope, changed: [] };

  function set(key, value) { if (patch.capabilities[key] !== value) { patch.capabilities[key] = value; patch.changed.push(key + ': ' + cap[key] + ' -> ' + value); } }

  if (code === DIRECTOR_CODE) {
    // Giám đốc: view-only — propose/agree_proposal/approve giữ nguyên false,
    // chỉ thêm visibility toàn công ty.
    set('view_proposals', true);
    if (JSON.stringify(patch.capabilities.proposalScope) !== JSON.stringify({ type: 'all_company', values: [] })) { patch.capabilities.proposalScope = { type: 'all_company', values: [] }; patch.changed.push('proposalScope: -> all_company'); }
  } else if (ASSISTANT_CODES.has(code) || SALES_LEADER_CODES.has(code) || TBP_CODES.has(code)) {
    set('propose', true);
    set('agree_proposal', true); // đã true sẵn cho ASSISTANT/SALES_LEADER; TBP là thay đổi thật
    set('view_proposals', true);
    const proposalScope = { type: scope.type, values: scope.values || [] };
    if (JSON.stringify(patch.capabilities.proposalScope) !== JSON.stringify(proposalScope)) { patch.capabilities.proposalScope = proposalScope; patch.changed.push('proposalScope: -> ' + JSON.stringify(proposalScope)); }
  } else {
    // NHAN_VIEN mặc định (self) — propose:true (NV được tự đề xuất cho chính
    // mình), view_proposals:true+self để đúng matrix "NV: self" tường minh
    // (không bắt buộc kỹ thuật vì "Đề xuất của tôi" không cần capability này,
    // nhưng PHF liệt kê NV trong Visibility matrix nên set tường minh cho khớp).
    set('propose', true);
    set('view_proposals', true);
    if (JSON.stringify(patch.capabilities.proposalScope) !== JSON.stringify({ type: 'self', values: [] })) { patch.capabilities.proposalScope = { type: 'self', values: [] }; patch.changed.push('proposalScope: -> self'); }
  }
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
