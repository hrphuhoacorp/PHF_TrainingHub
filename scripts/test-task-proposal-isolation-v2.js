'use strict';

// STATIC checks — Proposal V2 isolation guarantees. KHÔNG chạy DB/network,
// chỉ đọc source thật (fs.readFileSync) và assert cấu trúc/không có chuỗi
// cấm — bổ sung cho các test hành vi (mock harness) đã có, phủ 2 mục
// TEST_PLAN không thể chứng minh bằng cách gọi hàm:
//
//   REPORTING_V2_SEMANTICS_PRESERVED — dòng resolve flowType cho relation
//     'received' (dùng bởi Overview/Reporting V2) vẫn hardcode 'giao_viec',
//     KHÔNG bị Proposal V2 đổi (file này KHÔNG bị Edit trong toàn bộ session
//     Proposal V2 — chỉ Read/Grep).
//   NO_SUPABASE_TASK_DATA_PATH — services/phf-hr-api/lib/task-write.js
//     (nơi 3 hàm Proposal V2 mới sống: acceptTaskProposal/rejectTaskProposal/
//     cancelTaskProposal + nhánh de_xuat trong publishTask) hoàn toàn KHÔNG
//     có chuỗi "supabase" nào — mọi write đi qua PostgreSQL (task.* schema)
//     qua node-postgres client thuần. api/_lib/task-permissions.js's Proposal
//     gate (resolveProposalRecipientEmployeeCodes/listProposalRecipientEmployees/
//     canProposeTo) CHỈ đọc Employee/Permission data (ASSIGNMENTS_TABLE +
//     loadOrgRows(), đã là Supabase từ trước Proposal V2 — KHÔNG phải Task
//     data) — không tham chiếu TASKS_TABLE.
//
// Chạy: node scripts/test-task-proposal-isolation-v2.js

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, detail !== undefined ? detail : '');
}

// -----------------------------------------------------------------------
// REPORTING_V2_SEMANTICS_PRESERVED
// -----------------------------------------------------------------------
{
  const src = fs.readFileSync(path.join(REPO_ROOT, 'api', '_lib', 'task-query-descriptor-builder.js'), 'utf8');
  const hasLine = /flowType\s*=\s*\(relation === 'proposal_sent' \|\| relation === 'proposal_received'\)\s*\?\s*'de_xuat'\s*:\s*'giao_viec'/.test(src);
  record('REPORTING_V2_flowType_resolution_line_unchanged', hasLine, 'relation=\'received\' (Overview/Reporting V2) vẫn resolve flowType=\'giao_viec\' — Proposal (de_xuat) không bao giờ lọt vào Reporting V2, kể cả sau accepted (proposal gốc KHÔNG đổi flow_type — xem migrations/phf_hr_task_proposal_v2.sql)');
}
{
  const src = fs.readFileSync(path.join(REPO_ROOT, 'api', '_lib', 'task-overview-query-descriptor-builder.js'), 'utf8');
  const usesReceivedRelation = /resolveAuthorizedTaskEmployeeScope\(actorContext, scope, 'received',/.test(src);
  record('REPORTING_V2_overview_still_uses_received_relation_only', usesReceivedRelation, 'Overview builder vẫn cố định relation=\'received\' -> flowType luôn giao_viec qua đường trên, không có code path Proposal V2 nào mới trong Overview builder');
}

// -----------------------------------------------------------------------
// NO_SUPABASE_TASK_DATA_PATH
// -----------------------------------------------------------------------
// Chỉ chặn USAGE thật (require/createClient/.from(...) client call) — KHÔNG
// chặn chuỗi "Supabase" trong comment tiếng Việt (file này có vài comment
// giải thích lịch sử "legacy Supabase path" hoàn toàn hợp lệ, không phải
// code call nào).
const SUPABASE_USAGE_RE = /require\(['"]@supabase|createClient\(|supabase\s*\.\s*from\(/i;
{
  const src = fs.readFileSync(path.join(REPO_ROOT, 'services', 'phf-hr-api', 'lib', 'task-write.js'), 'utf8');
  const hasSupabaseUsage = SUPABASE_USAGE_RE.test(src);
  const hasProposalFns = /async function acceptTaskProposal/.test(src) && /async function rejectTaskProposal/.test(src) && /async function cancelTaskProposal/.test(src);
  record('NO_SUPABASE_TASK_DATA_PATH_task_write_zero_supabase_client_calls', !hasSupabaseUsage && hasProposalFns, { hasSupabaseUsage, hasProposalFns });
}
{
  const src = fs.readFileSync(path.join(REPO_ROOT, 'services', 'phf-hr-api', 'server.js'), 'utf8');
  const hasSupabaseUsage = SUPABASE_USAGE_RE.test(src);
  const hasProposalRoutes = /TASK_PROPOSAL_ACCEPT_RE/.test(src) && /TASK_PROPOSAL_REJECT_RE/.test(src) && /TASK_PROPOSAL_CANCEL_RE/.test(src);
  record('NO_SUPABASE_TASK_DATA_PATH_phf_hr_server_zero_supabase_client_calls', !hasSupabaseUsage && hasProposalRoutes, { hasSupabaseUsage, hasProposalRoutes });
}
{
  const src = fs.readFileSync(path.join(REPO_ROOT, 'api', '_lib', 'task-permissions.js'), 'utf8');
  // Chỉ 3 hàm mới (resolveProposalRecipientEmployeeCodes/listProposalRecipientEmployees/canProposeTo)
  // — trích riêng vùng source giữa marker comment và export block để không
  // false-positive vì phần còn lại của file (canAssignTaskTo etc.) vốn đã
  // dùng TASKS_TABLE-adjacent identifiers ở chỗ khác không liên quan.
  const startMarker = 'async function resolveProposalRecipientEmployeeCodes';
  const endMarker = 'module.exports = {';
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  const proposalSection = start >= 0 && end > start ? src.slice(start, end) : '';
  const touchesTasksTable = /TASKS_TABLE/.test(proposalSection);
  const usesEmployeeScopeOnly = /loadOrgRows\(\)/.test(proposalSection) && /listHubAccountSummaries\(\)/.test(proposalSection);
  record(
    'NO_SUPABASE_TASK_DATA_PATH_permission_gate_reads_employee_data_only',
    proposalSection.length > 0 && !touchesTasksTable && usesEmployeeScopeOnly,
    { sectionFound: proposalSection.length > 0, touchesTasksTable, usesEmployeeScopeOnly }
  );
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.error('FAILED:', failed.map(f => f.name).join(', '));
  process.exit(1);
}
