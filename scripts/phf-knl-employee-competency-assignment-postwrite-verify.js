'use strict';
require('dotenv').config();
const assert = require('assert');
const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SECRET_KEY.trim(), { auth: { persistSession: false, autoRefreshToken: false } });

const EXCLUDED = ['PHF002', 'PHF004', 'PHF010', 'PHF035', 'PHF064'];
const SPOT_CHECK = [
  { code: 'PHF041', framework: 'KNL_NHAN_VIEN_BAN_HANG_TAI_CUA_HANG_34BEF9', grade: 3 },
  { code: 'PHF012', framework: 'KNL_TP_HCNS_PHF_1063C7', grade: 3 },
  { code: 'PHF028', framework: 'KNL_LEADER_MKT_PHF_3C02BD', grade: 3 },
  { code: 'PHF032', framework: 'KNL_TN_GIAMSAT_V2_138CAA', grade: 3 },
  { code: 'PHF051', framework: 'KNL_TP_THU_MUA_PHF_V2_FA9A20', grade: 1 },
  { code: 'PHF026', framework: 'KNL_NV_BAN_HANG_ONLINE_PHF', grade: 3 },
  { code: 'PHF090', framework: 'KNL_NV_BAN_HANG_ONLINE_PHF', grade: 1 },
  { code: 'PHF081', framework: 'KNL_NV_BAN_HANG_ONLINE_PHF', grade: 1 }
];

(async () => {
  const { data: active, error: activeErr } = await db.from('knl_employee_competency_assignments').select('*').eq('is_active', true);
  if (activeErr) throw activeErr;
  console.log('Active assignments count:', active.length);
  assert.strictEqual(active.length, 34, 'Expected exactly 34 active assignments');

  active.forEach(a => {
    assert.strictEqual(a.status, 'PROVISIONAL', `${a.employee_code} status not PROVISIONAL`);
    assert.strictEqual(a.effective_from, '2026-08-01', `${a.employee_code} effective_from mismatch`);
    assert.strictEqual(a.effective_to, null, `${a.employee_code} effective_to should be null`);
    assert(a.note && a.note.length > 0, `${a.employee_code} missing note`);
    assert(a.reason && a.reason.length > 0, `${a.employee_code} missing reason`);
  });
  console.log('All 34 rows: status=PROVISIONAL, effective_from=2026-08-01, effective_to=null, note/reason present — OK');

  const codes = active.map(a => a.employee_code);
  const uniqueCodes = new Set(codes);
  assert.strictEqual(uniqueCodes.size, codes.length, 'Duplicate employee_code among active rows — overlap violation');
  console.log('No duplicate employee (1 current assignment per employee) — OK');

  EXCLUDED.forEach(code => assert(!uniqueCodes.has(code), `${code} must NOT have an assignment`));
  console.log('Excluded codes (PHF002/004/010/035/064) confirmed absent — OK');

  const { data: fw } = await db.from('knl_frameworks').select('id,code');
  const { data: fv } = await db.from('knl_framework_versions').select('id,framework_id,version_number');
  const { data: gd } = await db.from('knl_grade_definitions').select('id,version_id,grade_number');
  const byId = new Map(active.map(a => [a.employee_code, a]));
  for (const spot of SPOT_CHECK) {
    const row = byId.get(spot.code);
    assert(row, `${spot.code} missing from active assignments`);
    const framework = fw.find(f => f.code === spot.framework);
    const version = fv.find(v => v.id === row.framework_version_id);
    assert.strictEqual(version.framework_id, framework.id, `${spot.code} framework mismatch`);
    const grade = gd.find(g => g.id === row.competency_grade_id);
    assert.strictEqual(grade.grade_number, spot.grade, `${spot.code} grade mismatch (expected B${spot.grade})`);
  }
  console.log('Spot-check (8/8) framework+grade match — OK');

  const { data: history, error: histErr } = await db.from('knl_employee_competency_assignment_history').select('*').in('employee_code', codes);
  if (histErr) throw histErr;
  const createCount = history.filter(h => h.action === 'CREATE').length;
  assert.strictEqual(createCount, 34, 'Expected 34 CREATE history rows');
  assert.strictEqual(history.length, 34, 'History should contain exactly 34 rows (no extras)');
  console.log('History: 34 CREATE rows, no extras — OK');

  const { count: totalCount } = await db.from('knl_employee_competency_assignments').select('*', { head: true, count: 'exact' });
  assert.strictEqual(totalCount, 34, 'Total row count (including inactive) should be 34 — no stray rows');
  console.log('Total assignment table row count = 34 (no stray/duplicate rows) — OK');

  console.log('');
  console.log('POST-WRITE VERIFY: PASS');
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
