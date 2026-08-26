'use strict';
/* PHF KNL Employee Competency Assignment Baseline 08/2026 — bulk-init CREATE.
 * ROWS transcribed literally from scripts/phf-knl-employee-baseline-dryrun-2026-08.js
 * (34 READY / 3 SKIP / 2 BLOCKED / 0 AMBIGUOUS, re-verified against Production
 * after migration 1.52.0 applied). Calls canonical RPC
 * knl_set_employee_competency_assignment — no direct table write.
 *
 * DRY-RUN (default, không ghi gì): node scripts/phf-knl-employee-competency-assignment-baseline-2026-08.js
 * APPLY: node scripts/phf-knl-employee-competency-assignment-baseline-2026-08.js --apply */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SECRET_KEY.trim(), { auth: { persistSession: false, autoRefreshToken: false } });
require('../api/_lib/env-identity-guard').logSupabaseIdentityOnce('(scripts/phf-knl-employee-competency-assignment-baseline-2026-08.js)');
const APPLY = process.argv.includes('--apply');

const ROWS = [
  { code: 'PHF002', framework: null, grade: null, note: 'Giám đốc - không áp dụng KNL' },
  { code: 'PHF084', framework: 'KNL_NHAN_VIEN_BAN_HANG_TAI_CUA_HANG_34BEF9', grade: 1 },
  { code: 'PHF085', framework: 'KNL_NHAN_VIEN_BAN_HANG_TAI_CUA_HANG_34BEF9', grade: 1 },
  { code: 'PHF020', framework: 'KNL_NHAN_VIEN_BAN_HANG_TAI_CUA_HANG_34BEF9', grade: 3 },
  { code: 'PHF042', framework: 'KNL_NHAN_VIEN_BAN_HANG_TAI_CUA_HANG_34BEF9', grade: 3 },
  { code: 'PHF018', framework: 'KNL_NHAN_VIEN_BAN_HANG_TAI_CUA_HANG_34BEF9', grade: 3 },
  { code: 'PHF041', framework: 'KNL_NHAN_VIEN_BAN_HANG_TAI_CUA_HANG_34BEF9', grade: 3 },
  { code: 'PHF060', framework: 'KNL_NHAN_VIEN_BAN_HANG_TAI_CUA_HANG_34BEF9', grade: 2 },
  { code: 'PHF087', framework: 'KNL_NHAN_VIEN_BAN_HANG_TAI_CUA_HANG_34BEF9', grade: 1 },
  { code: 'PHF076', framework: 'KNL_NHAN_VIEN_BAN_HANG_TAI_CUA_HANG_34BEF9', grade: 1 },
  { code: 'PHF077', framework: 'KNL_NHAN_VIEN_BAN_HANG_TAI_CUA_HANG_34BEF9', grade: 1 },
  { code: 'PHF089', framework: 'KNL_NHAN_VIEN_BAN_HANG_TAI_CUA_HANG_34BEF9', grade: 1 },
  { code: 'PHF079', framework: 'KNL_NHAN_VIEN_BAN_HANG_TAI_CUA_HANG_34BEF9', grade: 1 },
  { code: 'PHF082', framework: 'KNL_NV_HCNS_PHF_1EC4DF', grade: 1 },
  { code: 'PHF078', framework: 'KNL_NHAN_VIEN_BAN_HANG_TAI_CUA_HANG_34BEF9', grade: 1 },
  { code: 'PHF091', framework: 'KNL_NHAN_VIEN_BAN_HANG_TAI_CUA_HANG_34BEF9', grade: 1 },
  { code: 'PHF092', framework: 'KNL_NHAN_VIEN_BAN_HANG_TAI_CUA_HANG_34BEF9', grade: 1, note: 'Thử việc - vẫn gán KNL bậc 1 theo file (không phải bậc lương)' },
  { code: 'PHF090', framework: 'KNL_NV_BAN_HANG_ONLINE_PHF', grade: 1 },
  { code: 'PHF081', framework: 'KNL_NV_BAN_HANG_ONLINE_PHF', grade: 1 },
  { code: 'PHF026', framework: 'KNL_NV_BAN_HANG_ONLINE_PHF', grade: 3 },
  { code: 'PHF038', framework: 'KNL_NV_GOI_QUA_PHF_212318', grade: 1 },
  { code: 'PHF080', framework: 'KNL_NV_GOI_QUA_PHF_212318', grade: 1 },
  { code: 'PHF036', framework: 'KNL_NV_GOI_QUA_PHF_212318', grade: 3 },
  { code: 'PHF012', framework: 'KNL_TP_HCNS_PHF_1063C7', grade: 3, note: 'PHF override: B3 (không dùng B6 như file gốc)' },
  { code: 'PHF056', framework: 'KNL_KT_CHI_2F89A7', grade: 3 },
  { code: 'PHF007', framework: 'KNL_KTTH_5036BB', grade: 1 },
  { code: 'PHF071', framework: 'KNL_KTT_465216', grade: 3 },
  { code: 'PHF008', framework: 'KNL_KT_THU_49A231', grade: 3 },
  { code: 'PHF034', framework: 'KNL_TRUONG_KHO_PHF_V2_0E47A5', grade: 1 },
  { code: 'PHF005', framework: 'KNL_NV_KHO_PHF_EADB74', grade: 3 },
  { code: 'PHF035', framework: 'KNL_NV_KHO_PHF_EADB74', grade: 3, note: 'employee_code không tồn tại trong employee_profiles (đã biết từ Salary Baseline)' },
  { code: 'PHF073', framework: 'KNL_NV_KHO_PHF_EADB74', grade: 1 },
  { code: 'PHF064', framework: 'KNL_NV_KHO_PHF_EADB74', grade: 2, note: 'employee_code không tồn tại trong employee_profiles (đã biết từ Salary Baseline)' },
  { code: 'PHF069', framework: 'KNL_NV_MEDIA_PHF_0306B5', grade: 1 },
  { code: 'PHF028', framework: 'KNL_LEADER_MKT_PHF_3C02BD', grade: 3 },
  { code: 'PHF051', framework: 'KNL_TP_THU_MUA_PHF_V2_FA9A20', grade: 1 },
  { code: 'PHF010', framework: null, grade: null, note: 'Tiên - KNL chưa có, SKIP' },
  { code: 'PHF004', framework: null, grade: null, note: 'Ngọc - KNL chưa có, SKIP' },
  { code: 'PHF032', framework: 'KNL_TN_GIAMSAT_V2_138CAA', grade: 3 }
];

const EFFECTIVE_FROM = '2026-08-01';
const NOTE = 'Khung năng lực/bậc được gán ban đầu để vận hành hệ thống, chưa phải kết quả đánh giá năng lực chính thức.';
const REASON = 'PHF KNL baseline 08/2026 theo danh sách đối soát ban đầu.';
const ACTOR_ID = 'system-phf-baseline-2026-08';
const ACTOR_NAME = 'PHF KNL/Salary Baseline 08/2026 — batch script';

(async () => {
  const [{ data: profiles }, { data: fw }, { data: fv }, { data: gd }] = await Promise.all([
    db.from('employee_profiles').select('employee_code,full_name,title,department,branch,employment_status').in('employee_code', ROWS.map(r => r.code)),
    db.from('knl_frameworks').select('id,code,name'),
    db.from('knl_framework_versions').select('id,framework_id,version_number'),
    db.from('knl_grade_definitions').select('id,version_id,grade_code,grade_number')
  ]);
  const profByCode = new Map(profiles.map(p => [p.employee_code, p]));

  const summary = { total: ROWS.length, ready: 0, skip: 0, blocked: 0, applied: 0, failed: 0 };
  const applied = [];
  const failed = [];

  for (const row of ROWS) {
    if (!row.framework) { summary.skip++; console.log(`${row.code} | SKIP (${row.note})`); continue; }
    const profile = profByCode.get(row.code);
    if (!profile) { summary.blocked++; console.log(`${row.code} | BLOCKED (${row.note})`); continue; }
    const framework = fw.find(f => f.code === row.framework);
    if (!framework) { summary.blocked++; console.log(`${row.code} | BLOCKED (framework missing)`); continue; }
    const version = fv.filter(v => v.framework_id === framework.id).sort((a, b) => b.version_number - a.version_number)[0];
    const grade = gd.find(g => g.version_id === version.id && g.grade_number === row.grade);
    if (!grade) { summary.blocked++; console.log(`${row.code} | BLOCKED (grade B${row.grade} not found)`); continue; }

    summary.ready++;
    const orgSnapshot = { title: profile.title || null, department: profile.department || null, branch: profile.branch || null };

    if (!APPLY) {
      console.log(`${row.code} | ${framework.code} | v${version.version_number} | ${grade.grade_code} | DRY-RUN READY`);
      continue;
    }

    const { data, error } = await db.rpc('knl_set_employee_competency_assignment', {
      p_employee_code: row.code,
      p_employee_name: profile.full_name,
      p_framework_version_id: version.id,
      p_competency_grade_id: grade.id,
      p_status: 'PROVISIONAL',
      p_effective_from: EFFECTIVE_FROM,
      p_note: NOTE,
      p_organization_snapshot: orgSnapshot,
      p_reason: REASON,
      p_actor_id: ACTOR_ID,
      p_actor_name: ACTOR_NAME
    });
    if (error) {
      summary.failed++;
      failed.push({ code: row.code, error: error.message });
      console.log(`${row.code} | FAILED: ${error.message}`);
    } else {
      summary.applied++;
      applied.push({ code: row.code, framework: framework.code, grade: grade.grade_code, action: data.action, assignmentId: data.assignmentId });
      console.log(`${row.code} | ${framework.code} | ${grade.grade_code} | APPLIED action=${data.action} id=${data.assignmentId}`);
    }
  }

  console.log('');
  console.log('=== TỔNG ===', JSON.stringify(summary));
  if (failed.length) { console.log('=== FAILED ===', JSON.stringify(failed, null, 2)); }
  if (APPLY && summary.failed > 0) process.exitCode = 1;
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
