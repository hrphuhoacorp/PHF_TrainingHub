'use strict';
/* Regression: PHF AI - "Organization Directory + Natural Conversation
   Hardening" batch. Chay logic san xuat that (lib/org-directory.js qua
   lib/ai-employee-tools.js, lib/ai-tool-registry.js#buildStructuredResult,
   lib/ai-sandbox.js DSML leak guard + conversation compaction) - khong goi
   DeepSeek that. @supabase/supabase-js duoc stub qua require.cache (xem
   stubSupabaseRows) de logic that cua org-directory.js (filter/resolve/
   management chain) chay tren fixture, khong phai code test tu viet lai. */

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

// Fixture 1 cay to chuc nho: PHF001 (Giam doc, dinh cay) <- PHF002 (Truong
// ca, Ban hang/Phu Loi) <- PHF003 (Nhan vien, Ban hang/Phu Loi). PHF001
// cung quan ly truc tiep PHF004 va PHF005 (cung ten "Le Van C" voi PHF... -
// dung de test ambiguous). PHF005 = Ke toan truong (Ke toan/Tru so).
const FIXTURE_ROWS = [
  { employee_id: 'e1', employee_code: 'PHF001', employee_name: 'Nguyễn Văn A', title: 'Giám đốc', department: 'Ban giám đốc', branch: 'Trụ sở', manager_code: '', manager_name: '', employee_status: 'Đang làm việc' },
  { employee_id: 'e2', employee_code: 'PHF002', employee_name: 'Trần Thị B', title: 'Trưởng ca', department: 'Bán hàng', branch: 'Phú Lợi', manager_code: 'PHF001', manager_name: 'Nguyễn Văn A', employee_status: 'Đang làm việc' },
  { employee_id: 'e3', employee_code: 'PHF003', employee_name: 'Lê Văn C', title: 'Nhân viên', department: 'Bán hàng', branch: 'Phú Lợi', manager_code: 'PHF002', manager_name: 'Trần Thị B', employee_status: 'Đang làm việc' },
  { employee_id: 'e4', employee_code: 'PHF004', employee_name: 'Lê Văn C', title: 'Nhân viên', department: 'Kho', branch: 'Ngô Quyền', manager_code: 'PHF001', manager_name: 'Nguyễn Văn A', employee_status: 'Đang làm việc' },
  { employee_id: 'e5', employee_code: 'PHF005', employee_name: 'Phạm Thị D', title: 'Kế toán trưởng', department: 'Kế toán', branch: 'Trụ sở', manager_code: 'PHF001', manager_name: 'Nguyễn Văn A', employee_status: 'Đang làm việc' }
];

async function run() {
  stubSupabaseRows(FIXTURE_ROWS);
  const {
    getEmployeeManager, getDirectReportsOf, getManagementChainOf,
    getDepartmentDirectory, getBranchDirectory
  } = require('../lib/ai-employee-tools');
  const { buildStructuredResult } = require('../lib/ai-tool-registry');

  // Tai khoan hoc vien thuong, KHONG grant Checklist/KNL nao - dung xuyen
  // suot de xac nhan chinh sach "Organization Directory mo cho TAT CA role".
  const learnerSession = { account: { id: 'learner-1' }, role: 'learner' };

  // ---- 1. getEmployeeManager ("A báo cáo cho ai / ai quản lý A") ----
  const managerOfC3 = await getEmployeeManager(learnerSession, { employeeCode: 'PHF003' });
  assert.strictEqual(managerOfC3.found, true);
  assert.strictEqual(managerOfC3.ambiguous, false);
  assert.strictEqual(managerOfC3.manager.employeeCode, 'PHF002');
  assert.strictEqual(managerOfC3.manager.employeeName, 'Trần Thị B');
  console.log('[PASS] 1a: get_employee_manager(PHF003) -> Trần Thị B (PHF002)');

  const managerOfTopBoss = await getEmployeeManager(learnerSession, { employeeCode: 'PHF001' });
  assert.strictEqual(managerOfTopBoss.found, true);
  assert.strictEqual(managerOfTopBoss.manager, null, 'nguoi dung dau cay (khong co manager_code) phai tra manager:null, KHONG bia ra 1 nguoi');
  console.log('[PASS] 1b: get_employee_manager(PHF001, đỉnh cây) -> manager null, không bịa');

  // ---- 2. getDirectReportsOf ("B quản lý những ai") ----
  const reportsOfBoss = await getDirectReportsOf(learnerSession, { employeeCode: 'PHF001' });
  assert.strictEqual(reportsOfBoss.found, true);
  assert.strictEqual(reportsOfBoss.reports.length, 3, 'PHF001 quan ly truc tiep 3 nguoi (PHF002/PHF004/PHF005)');
  const reportCodes = reportsOfBoss.reports.map(r => r.employeeCode).sort();
  assert.deepStrictEqual(reportCodes, ['PHF002', 'PHF004', 'PHF005']);
  console.log('[PASS] 2: get_direct_reports(PHF001) -> đúng 3 người (PHF002/PHF004/PHF005)');

  // ---- 3. getManagementChainOf ("tuyến quản lý của A") ----
  const chainOfC3 = await getManagementChainOf(learnerSession, { employeeCode: 'PHF003' });
  assert.strictEqual(chainOfC3.found, true);
  assert.deepStrictEqual(chainOfC3.chain.map(c => c.employeeCode), ['PHF002', 'PHF001'], 'tuyen quan ly PHF003 -> PHF002 -> PHF001');
  console.log('[PASS] 3: get_management_chain(PHF003) -> [PHF002, PHF001] đúng thứ tự');

  // ---- 4. Ambiguous name ("Lê Văn C" trùng ở PHF003 và PHF004) ----
  const ambiguousManager = await getEmployeeManager(learnerSession, { name: 'Lê Văn C' });
  assert.strictEqual(ambiguousManager.found, false);
  assert.strictEqual(ambiguousManager.ambiguous, true, 'ten trung nhieu nguoi PHAI tra ambiguous:true, khong tu chon dai 1 nguoi');
  assert.strictEqual(ambiguousManager.candidates.length, 2);
  console.log('[PASS] 4a: get_employee_manager(name="Lê Văn C") -> ambiguous:true kèm 2 candidates, không tự đoán');

  const ambiguousStructured = buildStructuredResult('get_employee_manager', ambiguousManager);
  assert.ok(ambiguousStructured, 'ambiguous case van phai co structured card cho UI hien candidates');
  assert.strictEqual(ambiguousStructured.evidence.status, 'INCOMPLETE');
  assert.strictEqual(ambiguousStructured.data.rows.length, 2);
  console.log('[PASS] 4b: buildStructuredResult hiển thị đúng 2 candidates khi ambiguous');

  // ---- 5. Department / branch directory ----
  const salesDept = await getDepartmentDirectory(learnerSession, { department: 'Bán hàng' });
  assert.strictEqual(salesDept.available, true);
  assert.strictEqual(salesDept.total, 2);
  assert.deepStrictEqual(salesDept.titles.sort(), ['Nhân viên', 'Trưởng ca'].sort());
  console.log('[PASS] 5a: get_department_directory("Bán hàng") -> 2 người, đúng 2 chức danh');

  const phuLoiBranch = await getBranchDirectory(learnerSession, { branch: 'Phú Lợi' });
  assert.strictEqual(phuLoiBranch.total, 2);
  console.log('[PASS] 5b: get_branch_directory("Phú Lợi") -> 2 người');

  const unknownBranch = await getBranchDirectory(learnerSession, { branch: 'Chi nhánh không tồn tại' });
  assert.strictEqual(unknownBranch.available, false);
  const unknownStructured = buildStructuredResult('get_branch_directory', unknownBranch);
  assert.strictEqual(unknownStructured.evidence.status, 'INCOMPLETE');
  assert.ok(!/không tồn tại|đang trống|chưa bổ nhiệm/i.test(unknownStructured.evidence.note) || /KHÔNG suy ra/i.test(unknownStructured.evidence.note),
    'note zero-result KHONG duoc tu ket luan chi nhanh khong ton tai/dang trong - phai chi noi chua tim thay trong nguon');
  console.log('[PASS] 5c: chi nhánh không khớp dữ liệu -> INCOMPLETE, note không tự kết luận "không tồn tại/đang trống"');

  // ---- 6. DSML / tool-call protocol leak guard (P0 Production) ----
  const { looksLikeLeakedToolProtocol, extractLeakedToolCall, sanitizeFinalReply } = require('../lib/ai-sandbox');

  const leakedFull = '<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name="search_employees">\n<parameter name="title">Trợ lý</parameter>\n</invoke>';
  assert.strictEqual(looksLikeLeakedToolProtocol(leakedFull), true, 'phai nhan dien dung mau leak that tu Production');
  const extractedFull = extractLeakedToolCall(leakedFull);
  assert.strictEqual(extractedFull.name, 'search_employees');
  assert.strictEqual(extractedFull.args.title, 'Trợ lý');
  console.log('[PASS] 6a: nhận diện + parse đúng mẫu leak DSML thật từ Production (search_employees, title=Trợ lý)');

  const leakedTruncated = '<｜｜DSML｜｜invoke name="get_department_directory">\n<parameter name="department">Kế toán';
  assert.strictEqual(looksLikeLeakedToolProtocol(leakedTruncated), true);
  const extractedTruncated = extractLeakedToolCall(leakedTruncated);
  assert.strictEqual(extractedTruncated.name, 'get_department_directory');
  assert.strictEqual(extractedTruncated.args.department, 'Kế toán', 'phai parse duoc ca khi output bi cat ngang, thieu the dong');
  console.log('[PASS] 6b: parse được cả khi output bị cắt ngang (thiếu thẻ đóng)');

  const normalReply = 'Trợ lý Giám đốc hiện có 1 người, là chị Nguyễn Thị Hoa, thuộc Ban giám đốc.';
  assert.strictEqual(looksLikeLeakedToolProtocol(normalReply), false, 'reply tu nhien binh thuong KHONG duoc bi nham la leak (false positive)');
  assert.strictEqual(sanitizeFinalReply(normalReply), normalReply, 'reply sach thi giu nguyen, khong sua gi');
  console.log('[PASS] 6c: reply tự nhiên bình thường không bị coi nhầm là leak (không false-positive)');

  const sanitized = sanitizeFinalReply(leakedFull);
  assert.notStrictEqual(sanitized, leakedFull, 'final reply con leak PHAI bi thay bang fallback sach');
  assert.strictEqual(looksLikeLeakedToolProtocol(sanitized), false, 'fallback text phai sach, khong con dau hieu leak');
  console.log('[PASS] 6d: final reply còn sót leak bị thay bằng fallback sạch (không hiện nguyên văn cho người dùng)');

  // ---- 7. Conversation compaction (khong ep "bat dau chat moi") ----
  const { compactMessagesForModel, validateChatMessages } = require('../lib/ai-sandbox');

  const shortConvo = [{ role: 'user', content: 'Câu hỏi 1' }, { role: 'assistant', content: 'Trả lời 1' }];
  const shortResult = compactMessagesForModel(shortConvo);
  assert.strictEqual(shortResult.compactionNote, null, 'hoi thoai ngan khong duoc nen');
  assert.strictEqual(shortResult.messages.length, shortConvo.length);
  console.log('[PASS] 7a: hội thoại ngắn (dưới ngưỡng) không bị nén, giữ nguyên');

  const longConvo = [];
  for (let i = 1; i <= 40; i++) {
    longConvo.push({ role: 'user', content: `Câu hỏi số ${i} về nhân sự phòng Kế toán` });
    longConvo.push({ role: 'assistant', content: `Trả lời số ${i}` });
  }
  const longResult = compactMessagesForModel(longConvo);
  assert.ok(longResult.compactionNote, 'hoi thoai dai PHAI duoc nen thanh 1 system note');
  assert.ok(/TÓM TẮT/i.test(longResult.compactionNote));
  assert.ok(/KHÔNG PHẢI dữ liệu đã xác nhận/i.test(longResult.compactionNote), 'note phai canh bao ro khong phai du lieu xac nhan');
  assert.ok(longResult.messages.length < longConvo.length, 'phan gan nhat gui di phai it hon toan bo hoi thoai');
  const lastKept = longResult.messages[longResult.messages.length - 1];
  assert.strictEqual(lastKept.content, longConvo[longConvo.length - 1].content, 'tin nhan cuoi cung (cau hoi hien tai) phai duoc giu nguyen van, khong bi nen mat');
  console.log('[PASS] 7b: hội thoại dài được nén (giữ gần nhất nguyên văn + tóm tắt phần cũ đánh dấu rõ không phải dữ liệu xác nhận)');

  // Validate input van chap nhan hoi thoai dai hon nguong cu (20 tin nhan) -
  // khong con chan "Cuoc tro chuyen qua dai" o muc binh thuong. Tin nhan
  // cuoi phai la user (rang buoc rieng, khong lien quan compaction).
  const longConvoEndingWithUser = longConvo.concat([{ role: 'user', content: 'Câu hỏi mới nhất' }]);
  const validated = validateChatMessages(longConvoEndingWithUser);
  assert.strictEqual(validated.length, longConvoEndingWithUser.length, 'hoi thoai hon 80 tin nhan khong duoc bi tu choi o input validation');
  console.log('[PASS] 7c: validateChatMessages không còn chặn hội thoại dài (ngưỡng cũ 20 đã lỗi thời)');

  console.log('\nALL PASS - test-ai-org-directory.js');
}

run().catch(err => {
  console.error('[FAIL]', err && err.stack || err);
  process.exitCode = 1;
});
