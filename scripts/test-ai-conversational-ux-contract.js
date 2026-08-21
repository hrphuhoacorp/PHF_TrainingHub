'use strict';
/* PHF AI - Conversational UX contract (golden/static test).

   QUAN TRONG - day la PROMPT-CONTRACT test, KHONG PHAI behavioral test tren
   output that cua DeepSeek: khong co live model call nao o day (tranh ton
   chi phi goi DeepSeek nhieu lan chi de kiem tra tone). Test nay xac nhan
   SYSTEM_PROMPT (lib/ai-sandbox.js) CO chua dung cac chi dan hanh vi bat
   buoc cho 6 dang cau hoi (casual/general, HR advice, PHF fact lookup, PHF+
   reasoning, complaint/conflict, missing evidence) - tuc "hop dong" ma model
   PHAI tuan theo, khong phai xac nhan model THUC SU lam dung 100% moi lan
   (dieu do can Admin tu smoke test that tren Production voi 1 live call).

   Chay thu cong: node scripts/test-ai-conversational-ux-contract.js */
const assert = require('assert');
const { runChatSandbox, SYSTEM_PROMPT } = require('../api/_lib/ai-sandbox');
assert.ok(typeof SYSTEM_PROMPT === 'string' && SYSTEM_PROMPT.length > 500, 'SYSTEM_PROMPT phai la chuoi noi dung day du');

// Prompt duoc noi dong bang \n de de doc trong source (~80 ky tu/dong), nen
// 1 cum tu co the bi ngat dong giua chung - CHUAN HOA whitespace (moi \n/\s+
// -> 1 khoang trang) truoc khi match, tranh test lech gia vi phu thuoc cach
// ngat dong trong source thay vi noi dung ngu nghia that.
const flatPrompt = SYSTEM_PROMPT.replace(/\s+/g, ' ');
function assertContains(pattern, label) {
  assert.ok(pattern.test(flatPrompt), 'SYSTEM_PROMPT PHAI chua chi dan: ' + label);
}

// ---- A. casual/general: khong mo bai sao rong, do dai co gian ----
assertContains(/VÀO THẲNG VẤN ĐỀ/, 'cấm mở bài sáo rỗng kiểu "Đây là câu hỏi rất trọng tâm..."');
assertContains(/Độ dài co giãn theo độ phức tạp/, 'độ dài co giãn theo độ phức tạp câu hỏi (SIMPLE/NORMAL/COMPLEX)');
assertContains(/KHÔNG kết luận hai lần/, 'cấm lặp kết luận 2 lần (mở bài + cuối bài)');
console.log('[PASS] A. casual/general: prompt cấm mở bài sáo rỗng, yêu cầu độ dài co giãn, không lặp kết luận');

// ---- B. HR advice (kien thuc chung) ----
assertContains(/KHÔNG bắt buộc phải gọi tool PHF/, 'câu hỏi HCNS chung được trả lời bằng suy luận, không ép gọi tool');
console.log('[PASS] B. HR advice: prompt cho phép trả lời bằng kiến thức chung, không ép tool-call');

// ---- C. PHF fact lookup (silent tool call, wording tu nhien) ----
assertContains(/ẨN CƠ CHẾ KỸ THUẬT KHỎI NGƯỜI DÙNG/, 'ẩn việc gọi tool khỏi người dùng, không nói "tôi sẽ gọi tool X"');
assertContains(/Trong dữ liệu PHF hiện có/, 'wording tự nhiên "Trong dữ liệu PHF hiện có..." thay cho thuật ngữ kỹ thuật');
console.log('[PASS] C. PHF fact lookup: prompt ẩn cơ chế tool, dùng wording tự nhiên hướng người dùng');

// ---- D. PHF + reasoning (tach bach dung muc, khong gan nhan moi cau) ----
assertContains(/MỨC ĐỘ CẦN TÁCH BẠCH/, 'chỉ tách rõ dữ kiện/phân tích khi thực sự cần, không gắn nhãn mọi câu');
assertContains(/không phải câu nào cũng cần tách rõ dữ kiện\/phân tích/, 'câu trả lời đơn giản không bị ép văn phong tách nhãn cứng nhắc');
console.log('[PASS] D. PHF + reasoning: prompt chỉ yêu cầu tách bạch dữ kiện/phân tích khi thực sự cần thiết');

// ---- E. complaint/conflict (khong hua theo, khong bao che mu quang) ----
assertContains(/không hùa theo công kích cá nhân/, 'không hùa theo khi người dùng bức xúc/phàn nàn');
assertContains(/không bênh vực tổ chức một cách mù quáng/, 'không bênh vực tổ chức mù quáng, không dùng "lợi ích tập thể" để né sai phạm');
console.log('[PASS] E. complaint/conflict: prompt yêu cầu khách quan, không hùa theo, không bao che mù quáng');

// ---- F. missing evidence (phan biet 3 loai, khong bo cuoc) ----
assertContains(/KHÔNG BỎ CUỘC KHI TOOL THIẾU DỮ LIỆU/, 'không biến câu trả lời thành từ chối máy móc khi tool thiếu dữ liệu');
assertContains(/KHÔNG CÓ DỮ LIỆU vs CHƯA ĐƯỢC HỖ TRỢ/, 'phân biệt "không có dữ liệu" vs "chưa hỗ trợ tra cứu"');
assertContains(/PHẠM VI DỮ LIỆU THEO QUYỀN/, 'phân biệt giới hạn quyền xem với không có dữ liệu');
console.log('[PASS] F. missing evidence: prompt phân biệt rõ không-có-dữ-liệu / chưa-hỗ-trợ / không-có-quyền, không bỏ cuộc');

// ---- G. Khong con nhan "AI" cu, khong tu xung AI ----
assert.ok(!/'Nhận định AI:'\s*hoặc/.test(SYSTEM_PROMPT), 'khong duoc con yeu cau dung heading "Nhận định AI:" mac dinh');
assertContains(/KHÔNG tự nhắc mình là "AI"/, 'cấm tự xưng AI trừ khi user hỏi thẳng bản chất hệ thống');
console.log('[PASS] G. Không còn ép heading "Nhận định AI:"/"Gợi ý AI:", không tự xưng AI trừ khi được hỏi thẳng');

// ---- H. Regression: runChatSandbox van hoat dong binh thuong sau khi sua prompt (khong loi cu phap) ----
(async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ choices: [{ message: { content: 'Câu trả lời kiểm tra.' }, finish_reason: 'stop' }] })
  });
  process.env.DEEPSEEK_API_KEY = 'test-fake-key-not-used-network-stubbed';
  try {
    const result = await runChatSandbox({ account: { id: 'admin-contract-1' }, role: 'admin' }, [{ role: 'user', content: 'KPI là gì?' }]);
    assert.strictEqual(result.reply, 'Câu trả lời kiểm tra.');
    console.log('[PASS] H. runChatSandbox chạy bình thường sau khi sửa SYSTEM_PROMPT (không lỗi cú pháp/khởi tạo)');
  } finally {
    global.fetch = originalFetch;
  }
  console.log('\nALL PASS - test-ai-conversational-ux-contract.js');
})();
