'use strict';
/* PHF KNL/Salary Baseline 08/2026 — đã APPLY vào Production 2026-08-11.
 * Nguồn: "nội dung gán KNL và bậc lương tháng 8.xlsx" (PHF đã duyệt), transcribed
 * literally vào mảng ROWS bên dưới. Giữ lại file này làm audit record của batch,
 * theo đúng convention các script baseline/seed khác trong scripts/.
 *
 * Kết quả: 36/39 rows applied (34 APPLY SALARY + 1 PROBATION + 1 CONFIRM no-diff
 * cho PHF041), 3 SKIP (PHF002: grade_code "QLCC-B4" không tồn tại — không fuzzy-match
 * sang QLCT; PHF035/PHF064: employee_code không tồn tại trong employee_profiles).
 * KNL competency-grade KHÔNG được ghi trong batch này — không có bảng persistence
 * employee→competency grade trong schema (xem TRACE 6 khối màn cá nhân trước đó).
 *
 * DRY-RUN (default, không ghi gì): node scripts/phf-knl-salary-baseline-2026-08.js
 * APPLY (đã chạy 1 lần, --apply là idempotent qua RPC upsert-by-period nếu cần chạy lại):
 *   node scripts/phf-knl-salary-baseline-2026-08.js --apply */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SECRET_KEY.trim(), { auth: { persistSession: false, autoRefreshToken: false } });
const APPLY = process.argv.includes('--apply');

/* Transcribed literally from "nội dung gán KNL và bậc lương tháng 8.xlsx" (PHF-approved,
 * PHF041 override per section 1 of the batch instruction already matches the file as attached). */
const ROWS = [
  { code: 'PHF002', name: 'Trần Thu Thủy', gradeCode: 'QLCC-B4', prof: true, mgmt: true, knl: null, note: 'không áp dụng do giám đốc' },
  { code: 'PHF084', name: 'Đặng Thị Duy', gradeCode: 'KDTT-B1', prof: false, mgmt: false, knl: 'nhân viên bán hàng bậc 1' },
  { code: 'PHF085', name: 'Nguyễn Thị Huyền', gradeCode: 'KDTT-B1', prof: false, mgmt: false, knl: 'nhân viên bán hàng bậc 1' },
  { code: 'PHF020', name: 'Trần Thị Phương Huỳnh', gradeCode: 'KDTT-B3', prof: true, mgmt: false, knl: 'nhân viên bán hàng bậc 3' },
  { code: 'PHF042', name: 'Nguyễn Hoàng Khang', gradeCode: 'KDTT-B3', prof: true, mgmt: true, knl: 'nhân viên bán hàng bậc 3' },
  { code: 'PHF018', name: 'Nguyễn Thị Lệ', gradeCode: 'KDTT-B3', prof: true, mgmt: true, knl: 'nhân viên bán hàng bậc 3' },
  { code: 'PHF041', name: 'Đặng Thị Diễm', gradeCode: 'KDTT-B3', prof: true, mgmt: true, knl: 'nhân viên bán hàng bậc 3', override: true },
  { code: 'PHF060', name: 'Nguyễn Thiên Trúc', gradeCode: 'KDTT-B2', prof: false, mgmt: false, knl: 'nhân viên bán hàng bậc 2' },
  { code: 'PHF087', name: 'Trịnh Đình Trường', gradeCode: 'KDTT-B1', prof: false, mgmt: false, knl: 'nhân viên bán hàng bậc 1' },
  { code: 'PHF076', name: 'Võ Phương Diệu', gradeCode: 'KDTT-B1', prof: false, mgmt: false, knl: 'nhân viên bán hàng bậc 1' },
  { code: 'PHF077', name: 'Phạm Thị Như Quỳnh', gradeCode: 'KDTT-B1', prof: false, mgmt: false, knl: 'nhân viên bán hàng bậc 1' },
  { code: 'PHF089', name: 'Lê Bình Phương Uyên', gradeCode: 'KDTT-B1', prof: false, mgmt: false, knl: 'nhân viên bán hàng bậc 1' },
  { code: 'PHF079', name: 'Nguyễn Thanh Lợi', gradeCode: 'KDTT-B1', prof: false, mgmt: false, knl: 'nhân viên bán hàng bậc 1' },
  { code: 'PHF082', name: 'Lý Minh Phước', gradeCode: 'NSGT-B1', prof: false, mgmt: false, knl: 'nhân viên QTTH bậc 1' },
  { code: 'PHF078', name: 'Châu Quỳnh Như', gradeCode: 'KDTT-B1', prof: false, mgmt: false, knl: 'nhân viên bán hàng bậc 1' },
  { code: 'PHF091', name: 'Phan Thị Cẩm Tiên', gradeCode: 'KDTT-B1', prof: false, mgmt: false, knl: 'nhân viên bán hàng bậc 1' },
  { code: 'PHF092', name: 'Huỳnh Nhật Toàn', gradeCode: 'TV', prof: false, mgmt: false, knl: 'nhân viên bán hàng bậc 1', probation: true, probationAmount: 6800000 },
  { code: 'PHF090', name: 'Nguyễn Thị Khánh Vân', gradeCode: 'KDTT-B1', prof: false, mgmt: false, knl: 'nhân viên bán hàng online bậc 1' },
  { code: 'PHF081', name: 'Trần Châu Phương Dung', gradeCode: 'KDTT-B1', prof: false, mgmt: false, knl: 'nhân viên bán hàng online bậc 1' },
  { code: 'PHF026', name: 'Đinh Thị Như Quyên', gradeCode: 'KDTT-B3', prof: true, mgmt: true, knl: 'nhân viên bán hàng online bậc 3' },
  { code: 'PHF038', name: 'Dương Sô Phát', gradeCode: 'KDTT-B2', prof: true, mgmt: false, knl: 'Nhân viên gói quà bậc 1' },
  { code: 'PHF080', name: 'Nguyễn Thị Trúc Ly', gradeCode: 'KDTT-B1', prof: false, mgmt: false, knl: 'Nhân viên gói quà bậc 1' },
  { code: 'PHF036', name: 'Trần Trung Hải', gradeCode: 'NSGQ-B6', prof: true, mgmt: true, knl: 'Nhân viên gói quà bậc 3' },
  { code: 'PHF012', name: 'Lê Vĩnh Thắng', gradeCode: 'NSGT-B6', prof: true, mgmt: true, knl: 'nhân viên QTTH bậc 6' },
  { code: 'PHF056', name: 'Lê Ngọc Diễm', gradeCode: 'NSGT-B3', prof: true, mgmt: false, knl: 'kế toán chi bậc 3' },
  { code: 'PHF007', name: 'Nguyễn Thị Bích', gradeCode: 'NSGT-B4', prof: false, mgmt: false, knl: 'kế toán tổng hợp bậc 1' },
  { code: 'PHF071', name: 'Hà Viết Nguyên Thanh', gradeCode: 'QLCT-B5', prof: false, mgmt: true, knl: 'kế toán trưởng bậc 3' },
  { code: 'PHF008', name: 'Nguyễn Ngọc Diệu Linh', gradeCode: 'NSGT-B2', prof: true, mgmt: false, knl: 'kế toán chi thu bậc 3' },
  { code: 'PHF034', name: 'Nguyễn Duy Hải', gradeCode: 'CUNG-B3', prof: true, mgmt: true, knl: 'tbp kho bậc 1' },
  { code: 'PHF005', name: 'Nguyễn Minh Nhật', gradeCode: 'CUNG-B3', prof: false, mgmt: false, knl: 'nhân viên kho bậc 3' },
  { code: 'PHF035', name: 'Trần Văn Út', gradeCode: 'NSSC-B3', prof: true, mgmt: false, knl: 'nhân viên kho bậc 3' },
  { code: 'PHF073', name: 'Nguyễn Huỳnh Phước Huy', gradeCode: 'CUNG-B1', prof: false, mgmt: false, knl: 'nhân viên kho bậc 1' },
  { code: 'PHF064', name: 'Hà Thị Lan', gradeCode: 'NSSC-B2', prof: false, mgmt: false, knl: 'nhân viên kho bậc 2' },
  { code: 'PHF069', name: 'Lê Thị Thanh Chúc', gradeCode: 'KDGT-B1', prof: false, mgmt: false, knl: 'nhân viên media bậc 1' },
  { code: 'PHF028', name: 'Tạ Ngọc Linh Thi', gradeCode: 'KDGT-B5', prof: true, mgmt: true, knl: 'tbp mkt bậc 3' },
  { code: 'PHF051', name: 'Trịnh Thị Ngọc Linh', gradeCode: 'CUNG-B3', prof: true, mgmt: false, knl: 'tbp thu mua bậc 1' },
  { code: 'PHF010', name: 'Nguyễn Thủy Tiên', gradeCode: 'QLCT-B4', prof: true, mgmt: true, knl: null },
  { code: 'PHF004', name: 'Trần Gia Bảo Ngọc', gradeCode: 'QLCT-B3', prof: false, mgmt: true, knl: null },
  { code: 'PHF032', name: 'Trần Hữu Vinh', gradeCode: 'CUNG-B6', prof: true, mgmt: true, knl: 'tn giám sát bậc 3' }
];

const PAYROLL_PERIOD = '2026-08';
const REASON = 'PHF baseline 08/2026 theo danh sách đối soát ban đầu (nội dung gán KNL và bậc lương tháng 8.xlsx, PHF đã duyệt).';
const ACTOR_ID = 'system-phf-baseline-2026-08';
const ACTOR_NAME = 'PHF KNL/Salary Baseline 08/2026 — batch script';

(async () => {
  const [{ data: profiles }, { data: grades }, { data: assignments }] = await Promise.all([
    db.from('employee_profiles').select('employee_code,full_name,title,department,branch,employment_status').in('employee_code', ROWS.map(r => r.code)),
    db.from('knl_compensation_grades').select('id,grade_code,version_id'),
    db.from('knl_employee_compensation_assignments').select('*').in('employee_code', ROWS.map(r => r.code)).order('payroll_period', { ascending: false })
  ]);
  const profByCode = new Map(profiles.map(p => [p.employee_code, p]));
  const gradeByCode = new Map(grades.map(g => [g.grade_code, g]));
  const latestByCode = new Map();
  assignments.forEach(a => { if (!latestByCode.has(a.employee_code)) latestByCode.set(a.employee_code, a); });

  console.log('Mode:', APPLY ? '*** APPLY (Production write) ***' : 'DRY-RUN (no write)');
  console.log('');
  console.log('MaNV | Ten | Salary target | Current salary grade | PC NV | PC QL | KNL target | Status | Action');
  console.log('-'.repeat(140));

  const summary = { total: ROWS.length, applySalary: 0, skip: 0, probation: 0, alreadyMatches: 0 };
  const toApply = [];

  for (const row of ROWS) {
    const profile = profByCode.get(row.code);
    const latest = latestByCode.get(row.code);
    let action = '', statusNote = '';

    if (!profile) {
      action = 'SKIP/AMBIGUOUS';
      statusNote = 'employee_code KHÔNG tồn tại trong employee_profiles';
      summary.skip++;
    } else if (row.probation) {
      action = 'APPLY (PROBATION)';
      statusNote = `PROBATION ${row.probationAmount.toLocaleString('vi-VN')}đ`;
      summary.probation++;
      toApply.push({ row, profile, mode: 'PROBATION' });
    } else if (!gradeByCode.has(row.gradeCode)) {
      action = 'SKIP/AMBIGUOUS';
      statusNote = `grade_code "${row.gradeCode}" KHÔNG tồn tại (không fuzzy-match)`;
      summary.skip++;
    } else {
      const grade = gradeByCode.get(row.gradeCode);
      const matchesExisting = latest && latest.compensation_grade_id === grade.id && latest.has_professional_allowance === row.prof && latest.has_management_allowance === row.mgmt && latest.payroll_period === PAYROLL_PERIOD;
      if (matchesExisting) {
        action = 'CONFIRM (no diff)';
        statusNote = `2026-08 đã có, khớp đúng target (${row.gradeCode})`;
        summary.alreadyMatches++;
      } else {
        action = 'APPLY SALARY';
        statusNote = latest ? `${latest.payroll_period}: ${gradeIdToCode(grades, latest.compensation_grade_id) || latest.employment_type} -> ${row.gradeCode}` : 'Chưa từng có assignment';
        summary.applySalary++;
      }
      /* Carry-forward mục "Các khoản khác không có chỉ đạo rõ từ file: không tự
       * invent" - file không có cột tiền cơm/PC khác nên giữ nguyên từ
       * assignment gần nhất (nếu có và là OFFICIAL); không có tiền lệ OFFICIAL
       * nào thì mặc định false/0/[] (không suy đoán). */
      const carryMeal = latest && latest.employment_type === 'OFFICIAL' ? { hasMeal: latest.has_meal_allowance, mealAmount: latest.meal_allowance, extra: latest.extra_allowances || [] } : { hasMeal: false, mealAmount: 0, extra: [] };
      toApply.push({ row, profile, mode: 'OFFICIAL', gradeId: grade.id, carryMeal });
    }
    console.log(`${row.code} | ${row.name} | ${row.gradeCode} | ${latest ? (gradeIdToCode(grades, latest.compensation_grade_id) || latest.employment_type) + '@' + latest.payroll_period : '(none)'} | ${row.prof} | ${row.mgmt} | ${row.knl || '(trống)'} | ${statusNote} | ${action}`);
  }

  console.log('');
  console.log('=== TỔNG ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('Rows to write:', toApply.length);

  function gradeIdToCode(gradesArr, id) { const g = gradesArr.find(x => x.id === id); return g ? g.grade_code : null; }

  if (!APPLY) { console.log('\nDRY-RUN only — không có write nào. Chạy lại với --apply để ghi Production.'); return; }

  console.log('\n=== APPLYING TO PRODUCTION ===');
  let ok = 0, fail = 0;
  for (const item of toApply) {
    const { row, profile, mode, gradeId, carryMeal } = item;
    const params = mode === 'PROBATION' ? {
      p_employee_code: row.code, p_employee_name: profile.full_name, p_payroll_period: PAYROLL_PERIOD,
      p_employment_type: 'PROBATION', p_grade_id: null,
      p_has_professional: false, p_has_management: false, p_has_meal: false, p_meal_amount: 0,
      p_probation_amount: row.probationAmount, p_extra_allowances: [],
      p_organization_snapshot: { employeeCode: row.code, employeeName: profile.full_name, department: profile.department, branch: profile.branch, position: '', title: profile.title },
      p_reason: REASON, p_actor_id: ACTOR_ID, p_actor_name: ACTOR_NAME
    } : {
      p_employee_code: row.code, p_employee_name: profile.full_name, p_payroll_period: PAYROLL_PERIOD,
      p_employment_type: 'OFFICIAL', p_grade_id: gradeId,
      p_has_professional: row.prof, p_has_management: row.mgmt, p_has_meal: carryMeal.hasMeal, p_meal_amount: carryMeal.mealAmount,
      p_probation_amount: 0, p_extra_allowances: carryMeal.extra,
      p_organization_snapshot: { employeeCode: row.code, employeeName: profile.full_name, department: profile.department, branch: profile.branch, position: '', title: profile.title },
      p_reason: REASON, p_actor_id: ACTOR_ID, p_actor_name: ACTOR_NAME
    };
    const { data, error } = await db.rpc('knl_save_employee_compensation', params);
    if (error) { console.error('FAIL', row.code, error.message); fail++; }
    else { console.log('OK', row.code, JSON.stringify(data)); ok++; }
  }
  console.log(`\nDone. OK=${ok} FAIL=${fail}`);
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
