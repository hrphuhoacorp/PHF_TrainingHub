'use strict';
/* Regression: PHF AI - grounding guard (P0 "38 nhan vien" bug) + Training
   Hub 43 vs 120 bai semantics (P1). Chay logic san xuat that
   (lib/ai-sandbox.js#enforceGrounding, lib/ai-tool-registry.js#
   buildStructuredResult, lib/ai-training-tools.js#getTrainingProgramOverview,
   lib/ai-employee-tools.js#searchEmployees -> lib/org-directory.js) - khong
   goi DeepSeek/Supabase that. lib/org-directory.js tu goi createClient()
   cua @supabase/supabase-js, nen o day stub THANG module do qua
   require.cache (xem stubSupabaseRows) de logic filter/search THAT cua
   org-directory.js chay tren fixture, khong phai code test tu viet lai. */

const assert = require('assert');

const SUPABASE_MODULE_PATH = require.resolve('@supabase/supabase-js');

function stubSupabaseRows(rows) {
  const fakeQuery = {
    select() { return this; },
    neq() { return this; },
    order() { return this; },
    limit() { return Promise.resolve({ data: rows, error: null }); }
  };
  require.cache[SUPABASE_MODULE_PATH] = {
    id: SUPABASE_MODULE_PATH,
    filename: SUPABASE_MODULE_PATH,
    loaded: true,
    exports: { createClient: () => ({ from: () => fakeQuery }) }
  };
  delete require.cache[require.resolve('../lib/org-directory')];
  delete require.cache[require.resolve('../lib/ai-employee-tools')];
}

// Row shape THAT dung tren Supabase (snake_case) - khop dung cot
// lib/org-directory.js#loadDirectoryRows dang select, khong phai shape
// camelCase cua publicPerson() (do la output, khong phai input).
function fixtureRows(total) {
  const list = [];
  for (let i = 0; i < total; i++) {
    list.push({
      employee_id: 'emp-' + (i + 1),
      employee_code: 'PHF' + String(i + 1).padStart(3, '0'),
      employee_name: 'Nhân viên ' + (i + 1),
      title: i === 0 ? 'Trợ lý Giám đốc' : (i === 1 ? 'Trưởng ca' : 'Nhân viên'),
      department: 'Bán hàng',
      branch: i === 1 ? 'Phú Lợi' : 'Ngô Quyền',
      manager_code: '', manager_name: '',
      employee_status: 'Đang làm việc'
    });
  }
  return list;
}

async function run() {
  // ---- A. Employee grounding guard (P0 "38 nhan vien" repro) ----
  stubSupabaseRows(fixtureRows(38));
  const { searchEmployees } = require('../lib/ai-employee-tools');
  const { buildStructuredResult } = require('../lib/ai-tool-registry');
  const { enforceGrounding } = require('../lib/ai-sandbox');

  // Session hoc vien thuong (KHONG phai admin, KHONG co grant Checklist
  // nao) - xac nhan chinh sach "Organization Directory mo cho TAT CA role"
  // ngay trong test P0 nay (org-directory.js#ensureSession chi doi hoi
  // session ton tai, khong doi hoi role/grant).
  const learnerSession = { account: { id: 'learner-1' }, role: 'learner' };

  const searchResult = await searchEmployees(learnerSession, { limit: 10 });
  assert.strictEqual(searchResult.total, 38, 'fixture total phai la 38');
  const structured = buildStructuredResult('search_employees', searchResult);
  assert.ok(structured, 'buildStructuredResult khong duoc null voi fixture co du lieu');
  assert.strictEqual(structured.evidence.isCompletePopulation, false, 'search_employees phai danh dau isCompletePopulation=false');
  assert.ok(structured.evidence.groundingReplacement, 'search_employees phai co groundingReplacement');

  const badReply = 'Theo dữ liệu, hệ thống ghi nhận tổng cộng 38 nhân viên đang làm việc tại PHF.';
  const fixed = enforceGrounding('search_employees', structured, badReply);
  assert.notStrictEqual(fixed, badReply, 'reply overclaim PHAI bi thay the');
  assert.ok(!/toàn\s*công\s*ty|toàn\s*bộ\s*nhân\s*viên|tất\s*cả\s*nhân\s*viên/i.test(fixed) || /checklist|phạm vi/i.test(fixed),
    'reply sau khi sua khong duoc con khang dinh toan cong ty ma khong co caveat');
  assert.ok(/38/.test(fixed), 'reply sau sua van phai giu dung con so 38');
  console.log('[PASS] A1: overclaim "38 nhân viên toàn PHF" bi backend thay the dung');

  const goodReply = 'Trong phạm vi nhân sự đang theo dõi Checklist, có 38 người - đây KHÔNG phải tổng số nhân viên PHF.';
  const unchanged = enforceGrounding('search_employees', structured, goodReply);
  assert.strictEqual(unchanged, goodReply, 'reply da co caveat dung khong duoc bi ghi de');
  console.log('[PASS] A2: reply da co caveat dung thi giu nguyen, khong ghi de thua');

  // Title filter (chuc danh) - "Truong ca Phu Loi hien tai la ai"
  const titleResult = await searchEmployees(learnerSession, { title: 'Trưởng ca', branch: 'Phú Lợi' });
  assert.strictEqual(titleResult.total, 1, 'loc theo title+branch phai ra dung 1 nguoi');
  assert.strictEqual(titleResult.employees[0].employeeName, 'Nhân viên 2');
  console.log('[PASS] A3: search_employees loc dung theo title+branch (Truong ca Phu Loi), tai khoan hoc vien thuong van goi duoc (khong can grant Checklist)');

  // ---- B. Training Hub 43 vs 120 (P1) ----
  const { getTrainingProgramOverview } = require('../lib/ai-training-tools');

  const defaultOverview = await getTrainingProgramOverview(null, {});
  assert.strictEqual(defaultOverview.commonLessons, 43, 'Giai doan 1 hoi nhap chung phai la 43 bai');
  assert.ok(defaultOverview.isDefaultAssumption, 'khong nhap phong ban -> phai danh dau isDefaultAssumption');
  assert.strictEqual(defaultOverview.specialization.lessonCount, 77, 'chuyen mon Ban hang phai la 77 bai');
  assert.strictEqual(defaultOverview.specialization.totalWithCommon, 120, 'tong chuong trinh Ban hang day du phai la 120 bai');
  console.log('[PASS] B1: mac dinh (khong neu phong ban) tra dung 43 (chung) + 77 (chuyen mon) = 120');

  const salesOverview = await getTrainingProgramOverview(null, { programId: 'Nhân viên bán hàng' });
  assert.strictEqual(salesOverview.matchedProgram, true);
  assert.strictEqual(salesOverview.specialization.programId, 'Bán hàng', 'phai khop dung tag "Bán hàng" that trong du lieu bai hoc (khong phai ma programId gia dinh)');
  console.log('[PASS] B2: alias "Nhân viên bán hàng" khop dung tag "Bán hàng" trong du lieu bai hoc that');

  const ketoanOverview = await getTrainingProgramOverview(null, { programId: 'Kế toán' });
  assert.strictEqual(ketoanOverview.commonLessons, 43, 'Ke toan van phai thay 43 bai chung');
  assert.strictEqual(ketoanOverview.specialization, null, 'Ke toan KHONG duoc co du lieu chuyen mon (chua co trong Training Hub)');
  console.log('[PASS] B3: phòng ban không khớp chương trình nào (Kế toán) -> chỉ 43 bài chung, không suy ra 120');

  // "Kho" khop alias phong ban that (Kho) nhung du lieu bai hoc hien CHUA co
  // bai nao gan tag "Kho" - phai ra ket qua giong het Ke toan (chi 43 bai
  // chung), khop dung ket qua "Kho=43" da duoc xac nhan boi
  // scripts/test-training-hub-common-program.js (Admin UI, nguon doc lap).
  const khoOverview = await getTrainingProgramOverview(null, { programId: 'Kho' });
  assert.strictEqual(khoOverview.commonLessons, 43);
  assert.strictEqual(khoOverview.specialization, null, 'Kho chua co bai chuyen mon rieng trong du lieu that -> khong duoc bia 120');
  console.log('[PASS] B3b: "Kho" khớp alias phòng ban nhưng chưa có bài chuyên môn thật -> chỉ 43 bài, khớp test-training-hub-common-program.js');

  const ketoanStructured = buildStructuredResult('get_training_program_overview', ketoanOverview);
  assert.strictEqual(ketoanStructured.evidence.hasSpecialization, false);
  assert.ok(ketoanStructured.evidence.groundingReplacement, 'Ke toan phai co groundingReplacement de chan reply noi 120');
  assert.ok(!/GĐ\d/.test(JSON.stringify(ketoanStructured)), 'structured result KHONG duoc con abbreviation GĐ');
  const wrongTrainingReply = 'Nhân viên phòng Kế toán phải học tổng cộng 120 bài theo chương trình Bán hàng.';
  const fixedTraining = enforceGrounding('get_training_program_overview', ketoanStructured, wrongTrainingReply);
  assert.notStrictEqual(fixedTraining, wrongTrainingReply, '"Ke toan hoc 120 bai" PHAI bi thay the');
  // Ghi chu sua co the VAN nhac "120" nhung CHI trong khung "khong ap dung/
  // do la tong rieng Ban hang" - khac voi cau sai goc khang dinh Ke toan
  // phai hoc 120. Kiem tra dung noi dung xac nhan (43) + phu nhan ro rang,
  // khong kiem tra tuyet doi vang mat chu so "120".
  assert.ok(/43/.test(fixedTraining), 'reply sua xong phai xac nhan 43 bai');
  assert.ok(/không được suy ra tổng 120|riêng của chương trình Bán hàng/i.test(fixedTraining), 'reply sua xong phai noi ro 120 la rieng Ban hang, khong ap dung Ke toan');
  console.log('[PASS] B4: reply sai "Kế toán học 120 bài" bị backend thay thế đúng bằng 43 bài Giai đoạn 1 (kèm giải thích 120 chỉ riêng Bán hàng)');

  const salesStructured = buildStructuredResult('get_training_program_overview', salesOverview);
  const okSalesReply = 'Chương trình đầy đủ Nhân viên bán hàng gồm 120 bài (43 bài Giai đoạn 1 Hội nhập chung + 77 bài chuyên môn).';
  const salesUnchanged = enforceGrounding('get_training_program_overview', salesStructured, okSalesReply);
  assert.strictEqual(salesUnchanged, okSalesReply, 'chuong trinh Ban hang co du lieu chuyen mon thi 120 la dung, khong duoc ghi de');
  console.log('[PASS] B5: chương trình Bán hàng (có specialization) nói 120 bài là đúng, không bị ghi đè');

  // Badge "GĐ1"/"GĐ4"/"GĐ5" phai duoc mo rong thanh "Giai đoạn N"
  const stageLabels = salesOverview.specialization.stages.map(s => s.badge).join(' | ');
  assert.ok(!/\bGĐ\d/.test(stageLabels), 'nhan giai doan KHONG duoc con viet tat GĐ: ' + stageLabels);
  assert.ok(/Giai đoạn 4/.test(stageLabels) && /Giai đoạn 5/.test(stageLabels), 'phai co "Giai đoạn 4"/"Giai đoạn 5" day du: ' + stageLabels);
  console.log('[PASS] B6: nhãn giai đoạn không còn viết tắt GĐ, đã mở rộng thành "Giai đoạn N"');

  console.log('\nALL PASS - test-ai-grounding-guard.js');
}

run().catch(err => {
  console.error('[FAIL]', err && err.stack || err);
  process.exitCode = 1;
});
