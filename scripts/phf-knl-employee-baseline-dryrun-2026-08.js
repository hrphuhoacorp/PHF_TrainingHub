'use strict';
/* READ-ONLY dry-run. Không ghi employee assignment nào (chưa có persistence). */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SECRET_KEY.trim(), { auth: { persistSession: false, autoRefreshToken: false } });

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

(async () => {
  const { data: profiles } = await db.from('employee_profiles').select('employee_code,full_name,employment_status').in('employee_code', ROWS.map(r => r.code));
  const profByCode = new Map((profiles || []).map(p => [p.employee_code, p]));
  const { data: fw } = await db.from('knl_frameworks').select('id,code,name');
  const { data: fv } = await db.from('knl_framework_versions').select('id,framework_id,version_number');
  const { data: gd } = await db.from('knl_grade_definitions').select('id,version_id,grade_code,grade_number');

  console.log('MaNV | Framework | Version | Grade | Status | Effective_from | Action');
  console.log('-'.repeat(120));
  const summary = { total: ROWS.length, ready: 0, skip: 0, blocked: 0 };
  for (const row of ROWS) {
    const profile = profByCode.get(row.code);
    if (!row.framework) {
      console.log(`${row.code} | - | - | - | - | - | SKIP (${row.note})`);
      summary.skip++;
      continue;
    }
    if (!profile) {
      console.log(`${row.code} | ${row.framework} | - | B${row.grade} | - | - | BLOCKED (${row.note})`);
      summary.blocked++;
      continue;
    }
    const framework = fw.find(f => f.code === row.framework);
    if (!framework) { console.log(`${row.code} | ${row.framework} | NOT FOUND | - | - | - | BLOCKED (framework missing)`); summary.blocked++; continue; }
    const version = fv.filter(v => v.framework_id === framework.id).sort((a, b) => b.version_number - a.version_number)[0];
    const grade = gd.find(g => g.version_id === version.id && g.grade_number === row.grade);
    if (!grade) { console.log(`${row.code} | ${framework.code} | v${version.version_number} | B${row.grade} | - | - | BLOCKED (grade B${row.grade} not found in this version)`); summary.blocked++; continue; }
    console.log(`${row.code} | ${framework.code} | v${version.version_number} | ${grade.grade_code} | PROVISIONAL | 2026-08-01 | READY${row.note ? ' (' + row.note + ')' : ''}`);
    summary.ready++;
  }
  console.log('');
  console.log('=== TỔNG ===', JSON.stringify(summary));
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
