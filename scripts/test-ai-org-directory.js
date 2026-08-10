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

// stubSupabaseRows: nhan tablesMap {tableName: rows} de ho tro nhieu bang
// (checklist_employee_assignments + checklist_permission_grants cho preset
// cross-reference batch nay). Chuoi filter (eq/neq/lte/order...) deu bo qua
// va tra ve nguyen fixture cua dung bang - fixture da duoc chuan bi san
// dung dieu kien can test, khong can gia lap that logic SQL filter.
function stubSupabaseRows(tablesMap) {
  function fakeQueryFor(table) {
    const rows = (tablesMap && tablesMap[table]) || [];
    return {
      select() { return this; },
      neq() { return this; },
      eq() { return this; },
      lte() { return this; },
      gte() { return this; },
      or() { return this; },
      order() { return this; },
      limit() { return Promise.resolve({ data: rows, error: null }); }
    };
  }
  require.cache[SUPABASE_MODULE_PATH] = {
    id: SUPABASE_MODULE_PATH,
    filename: SUPABASE_MODULE_PATH,
    loaded: true,
    exports: { createClient: () => ({ from: (table) => fakeQueryFor(table) }) }
  };
  delete require.cache[require.resolve('../lib/org-directory')];
  delete require.cache[require.resolve('../lib/ai-employee-tools')];
  delete require.cache[require.resolve('../lib/ai-tool-registry')];
}

// Fixture 1 cay to chuc nho: PHF001 (Giam doc, dinh cay) <- PHF002 (Truong
// ca, Ban hang/Phu Loi) <- PHF003 (Nhan vien, Ban hang/Phu Loi). PHF001
// cung quan ly truc tiep PHF004 va PHF005 (cung ten "Le Van C" voi PHF... -
// dung de test ambiguous). PHF005 = Ke toan truong (Ke toan/Tru so).
const FIXTURE_ROWS = [
  { employee_id: 'e1', employee_code: 'PHF001', full_name: 'Nguyễn Văn A', title: 'Giám đốc', department: 'Ban giám đốc', branch: 'Trụ sở', manager_employee_code: '', employment_status: 'active' },
  { employee_id: 'e2', employee_code: 'PHF002', full_name: 'Trần Thị B', title: 'Trưởng ca', department: 'Bán hàng', branch: 'Phú Lợi', manager_employee_code: 'PHF001', employment_status: 'active' },
  { employee_id: 'e3', employee_code: 'PHF003', full_name: 'Lê Văn C', title: 'Nhân viên', department: 'Bán hàng', branch: 'Phú Lợi', manager_employee_code: 'PHF002', employment_status: 'active' },
  { employee_id: 'e4', employee_code: 'PHF004', full_name: 'Lê Văn C', title: 'Nhân viên', department: 'Kho', branch: 'Ngô Quyền', manager_employee_code: 'PHF001', employment_status: 'active' },
  { employee_id: 'e5', employee_code: 'PHF005', full_name: 'Phạm Thị D', title: 'Kế toán trưởng', department: 'Kế toán', branch: 'Trụ sở', manager_employee_code: 'PHF001', employment_status: 'active' }
];

// Fixture phan quyen Checklist (checklist_permission_grants) cho test preset
// cross-reference: PHF002 (title="Quản lý" trong FIXTURE_ROWS - KHONG co
// chu "Trợ lý") giu preset TRO_LY_GD -> mo phong dung root cause that da
// xac nhan tren Production (4 tai khoan TRO_LY_GD co title="Quản lý"). PHF002
// (title="Trưởng ca") giu preset TRUONG_CA_BH -> 2 nguon KHOP nhau, khong
// conflict. PHF004 (title="Nhân viên") giu preset TRUONG_BO_PHAN -> 2 nguon
// LECH nhau (title-text "Trưởng bộ phận" khong khop ai, preset lai chi ra
// PHF004) - dung de test nhanh CONFLICTED khi ket hop voi 1 nguoi khac co
// title that la "Trưởng bộ phận".
const PERMISSION_GRANT_ROWS = [
  { employee_code: 'PHF001', preset_code: 'TRO_LY_GD', is_active: true, effective_from: '2020-01-01', effective_to: null },
  { employee_code: 'PHF002', preset_code: 'TRUONG_CA_BH', is_active: true, effective_from: '2020-01-01', effective_to: null },
  { employee_code: 'PHF004', preset_code: 'TRUONG_BO_PHAN', is_active: true, effective_from: '2020-01-01', effective_to: null }
];
// Fixture rieng cho case CONFLICTED: PHF006 co title that "Trưởng bộ phận"
// (title-text-search se tim thay), CONG THEM PHF004 (title="Nhân viên") giu
// preset TRUONG_BO_PHAN o tren -> 2 nguon lech nhau (PHF006 chi co trong
// title, PHF004 chi co trong preset).
const FIXTURE_ROWS_WITH_CONFLICT = FIXTURE_ROWS.concat([
  { employee_id: 'e6', employee_code: 'PHF006', full_name: 'Đỗ Văn E', title: 'Trưởng bộ phận', department: 'Kho', branch: 'Ngô Quyền', manager_employee_code: 'PHF001', employment_status: 'active' }
]);

async function run() {
  stubSupabaseRows({ employee_profiles: FIXTURE_ROWS, checklist_permission_grants: PERMISSION_GRANT_ROWS });
  const {
    getEmployeeManager, getDirectReportsOf, getManagementChainOf,
    getDepartmentDirectory, getBranchDirectory, searchEmployees
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

  // ---- 5d. Preset cross-reference: FALLBACK khi title-text ra rong (mô
  // phỏng đúng root cause thật đã xác nhận trên Production - 4 tài khoản
  // giữ preset TRO_LY_GD có title="Quản lý", KHÔNG phải "Trợ lý Giám đốc") ----
  const troLyFallback = await searchEmployees(learnerSession, { title: 'Trợ lý Giám đốc' });
  assert.strictEqual(troLyFallback.titleSource, 'permission_grant_preset', 'title-text rong -> phai fallback sang preset');
  assert.strictEqual(troLyFallback.total, 1);
  assert.strictEqual(troLyFallback.employees[0].employeeCode, 'PHF001');
  assert.strictEqual(troLyFallback.conflict, null);
  const troLyStructured = buildStructuredResult('search_employees', troLyFallback);
  assert.strictEqual(troLyStructured.evidence.status, 'VERIFIED');
  assert.ok(/KHÔNG PHẢI trường chức danh chính thức/i.test(troLyStructured.evidence.note), 'note phai canh bao ro day la tin hieu tu preset, khong phai title that');
  console.log('[PASS] 5d: search_employees(title="Trợ lý Giám đốc") -> title-text rỗng, fallback đúng sang preset TRO_LY_GD (PHF001), note cảnh báo rõ');

  // ---- 5e. Preset cross-reference: 2 nguồn KHỚP nhau -> không fallback,
  // không conflict (PHF002 vừa có title="Trưởng ca" vừa giữ preset TRUONG_CA_BH) ----
  const truongCaAligned = await searchEmployees(learnerSession, { title: 'Trưởng ca' });
  assert.strictEqual(truongCaAligned.titleSource, 'title_field', '2 nguon khop nhau -> van dung ket qua title-text, khong can fallback');
  assert.strictEqual(truongCaAligned.conflict, null);
  assert.strictEqual(truongCaAligned.total, 1);
  assert.strictEqual(truongCaAligned.employees[0].employeeCode, 'PHF002');
  console.log('[PASS] 5e: search_employees(title="Trưởng ca") -> title-text và preset TRUONG_CA_BH khớp nhau, giữ nguồn title, không fallback/conflict');

  // ---- 5f. Preset cross-reference: 2 nguồn LỆCH nhau -> CONFLICTED (PHF006
  // có title thật "Trưởng bộ phận" nhưng PHF004 mới là người giữ preset
  // TRUONG_BO_PHAN với title="Nhân viên" - dùng fixture riêng có PHF006) ----
  stubSupabaseRows({ employee_profiles: FIXTURE_ROWS_WITH_CONFLICT, checklist_permission_grants: PERMISSION_GRANT_ROWS });
  const { searchEmployees: searchEmployeesConflictFixture } = require('../lib/ai-employee-tools');
  const { buildStructuredResult: buildStructuredResultConflictFixture } = require('../lib/ai-tool-registry');
  const conflictResult = await searchEmployeesConflictFixture(learnerSession, { title: 'Trưởng bộ phận' });
  assert.strictEqual(conflictResult.titleSource, 'title_field');
  assert.ok(conflictResult.conflict, '2 nguon lech nhau PHAI tra ve conflict, khong duoc am tham chon 1 ben');
  assert.strictEqual(conflictResult.conflict.presetCode, 'TRUONG_BO_PHAN');
  assert.deepStrictEqual(conflictResult.conflict.titleEmployees.map(e => e.employeeCode), ['PHF006']);
  assert.deepStrictEqual(conflictResult.conflict.presetEmployees.map(e => e.employeeCode), ['PHF004']);
  const conflictStructured = buildStructuredResultConflictFixture('search_employees', conflictResult);
  assert.strictEqual(conflictStructured.evidence.status, 'CONFLICTED');
  assert.strictEqual(conflictStructured.data.rows.length, 2, 'phai liet ke ca 2 nguoi tu 2 nguon, khong bo sot ben nao');
  const matchSources = conflictStructured.data.rows.map(r => r.matchSource).sort();
  assert.deepStrictEqual(matchSources, ['Chức danh (title)', 'Quyền Checklist (preset)']);
  console.log('[PASS] 5f: search_employees(title="Trưởng bộ phận") -> 2 nguồn lệch nhau -> CONFLICTED, liệt kê đủ cả 2 người kèm cột "Khớp theo"');

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

  // ---- 6e-6h. P0 HOTFIX (đợt 2): biến thể leak MỚI - MỌI thẻ đều mang
  // marker DSML (kể cả parameter/thẻ đóng), khác với mẫu đợt 1 (chỉ thẻ
  // ngoài tool_calls/invoke mang marker) - đây CHÍNH XÁC là mẫu chụp màn
  // hình Production thật đã báo (get_employee_manager, employeeCode PHF078,
  // hiện ra nguyên văn giao thức ở 1 bong bóng chat riêng sau câu trả lời
  // tự nhiên trước đó). Regex đợt 1 KHÔNG khớp biến thể này (đòi hỏi "<invoke"/
  // "<parameter" nguyên văn hoặc kết thúc bằng "｜>") -> looksLikeLeakedToolProtocol
  // trả về FALSE SAI -> nhánh "reply sạch" ở callDeepSeekWithTools() trả
  // thẳng rawContent, KHÔNG hề đi qua sanitizeFinalReply() - đây là lỗ hổng
  // kép (vừa thiếu nhận diện, vừa thiếu 1 chặn cuối cùng bắt buộc).
  const leakedNewVariantFull =
    '<｜｜DSML｜｜tool_calls>\n' +
    '<｜｜DSML｜｜invoke name="get_employee_manager">\n' +
    '<｜｜DSML｜｜parameter name="employee" string="true">PHF078</｜｜DSML｜｜parameter>\n' +
    '<｜｜DSML｜｜/invoke>\n' +
    '<｜｜DSML｜｜/tool_calls>';
  assert.strictEqual(looksLikeLeakedToolProtocol(leakedNewVariantFull), true,
    'PHAI nhan dien duoc bien the leak MOI (moi the deu mang marker DSML, ke ca parameter/the dong) - day la mau leak that tu Production dot 2');
  const extractedNewVariant = extractLeakedToolCall(leakedNewVariantFull);
  assert.strictEqual(extractedNewVariant.name, 'get_employee_manager');
  assert.strictEqual(extractedNewVariant.args.employee, 'PHF078', 'phai parse duoc gia tri du the dong cung mang marker DSML (</｜｜DSML｜｜parameter>), khong doi "</parameter>" nguyen van');
  console.log('[PASS] 6e: nhận diện + parse đúng biến thể leak MỚI (mọi thẻ mang marker DSML, kể cả parameter/thẻ đóng) - đúng mẫu Production đợt 2');

  const naturalAnswerThenLeak = 'PHF078 báo cáo trực tiếp cho quản lý phụ trách bộ phận tương ứng.';
  const naturalPlusLeakedTail = naturalAnswerThenLeak + '\n\n' + leakedNewVariantFull;
  const sanitizedNaturalPlusLeak = sanitizeFinalReply(naturalPlusLeakedTail);
  assert.strictEqual(sanitizedNaturalPlusLeak, naturalAnswerThenLeak,
    'khi cau tra loi tu nhien THAT + leak cung ton tai trong 1 reply, PHAI chi giu phan tu nhien, cat bo phan leak - khong duoc vut ca cau tra loi tot');
  assert.strictEqual(looksLikeLeakedToolProtocol(sanitizedNaturalPlusLeak), false);
  console.log('[PASS] 6f: reply có cả câu trả lời tự nhiên THẬT lẫn leak đuôi -> chỉ giữ phần tự nhiên, cắt bỏ phần leak (không vứt cả câu trả lời tốt)');

  const sanitizedNewVariantOnly = sanitizeFinalReply(leakedNewVariantFull);
  assert.notStrictEqual(sanitizedNewVariantOnly, leakedNewVariantFull);
  assert.strictEqual(looksLikeLeakedToolProtocol(sanitizedNewVariantOnly), false, 'khi TOAN BO la leak (khong co phan tu nhien nao), fallback sach - khong hien nguyen van');
  console.log('[PASS] 6g: reply TOÀN BỘ là biến thể leak mới (không có phần tự nhiên) -> fallback sạch, không hiện nguyên văn');

  // ---- 6h. Regression THẬT của lỗ hổng dot 2: goi qua chinh
  // callDeepSeekWithTools() (qua runChatSandbox) voi fetch bi stub tra ve
  // dung format leak Production - xac nhan diem return SOM (khi DeepSeek
  // khong dung truong tool_calls chuan) KHONG CON duong nao bo qua
  // sanitizeFinalReply(). Truoc fix, nhanh nay tra thang rawContent (dot 2
  // that su xay ra tren Production) - test nay se FAIL tren code cu.
  const { runChatSandbox } = require('../lib/ai-sandbox');
  const originalFetch = global.fetch;
  const originalApiKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-fake-key-not-used-network-stubbed';
  let fetchCallCount = 0;
  global.fetch = async () => {
    fetchCallCount += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: naturalPlusLeakedTail } }] })
    };
  };
  try {
    const integrationSession = { account: { id: 'admin-dsml-integration-1' }, role: 'admin' };
    const chatResult = await runChatSandbox(integrationSession, [{ role: 'user', content: 'PHF078 báo cáo cho ai?' }]);
    assert.strictEqual(chatResult.reply, naturalAnswerThenLeak, 'reply cuoi cung tra ve nguoi dung PHAI la phan tu nhien da cat bo leak, khong duoc la rawContent nguyen van (loi dot 2)');
    assert.strictEqual(looksLikeLeakedToolProtocol(chatResult.reply), false, 'reply cuoi cung TUYET DOI khong duoc con dau hieu giao thuc noi bo');
    assert.strictEqual(fetchCallCount, 1, 'da co san cau tra loi tu nhien tu luot dau -> khong can goi them luot 2, tranh phi pham');
    console.log('[PASS] 6h: regression thật qua callDeepSeekWithTools/runChatSandbox - điểm return sớm (không có tool_calls chuẩn) không còn đường nào bỏ qua sanitizeFinalReply()');
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = originalApiKey;
  }

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
