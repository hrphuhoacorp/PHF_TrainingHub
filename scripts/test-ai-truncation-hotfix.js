'use strict';
/* PHF AI - Hotfix regression: DeepSeek finish_reason='length' (Production
   smoke bao mid-sentence truncation, 2/2 lap lai). Xac nhan:
   1) request that gui max_tokens da nang len (khong con 1024 cu);
   2) finish_reason DUOC DOC (khong con bi bo qua nhu code cu);
   3) khi finish_reason='length', reply KHONG con dung giua tu, co ghi chu
      ngan bao con thieu;
   4) finish_reason binh thuong ('stop') KHONG bi dong den (khong them ghi
      chu thua khi khong can).

   Stub network qua global.fetch (KHONG goi DeepSeek that) - cung ky thuat
   voi scripts/test-ai-org-directory.js case 6h. Chay thu cong:
   node scripts/test-ai-truncation-hotfix.js */
const assert = require('assert');
const { runChatSandbox, softenLengthTruncation } = require('../lib/ai-sandbox');

async function run() {
  // ---- A. softenLengthTruncation() don vi ----
  const midWord = 'Bạn có thể trao đổi thêm với quản lý trực tiếp để anh chỉ điều chỉnh cho kh';
  const softenedMidWord = softenLengthTruncation(midWord);
  assert.ok(!softenedMidWord.startsWith(midWord), 'phai cat lui, khong giu nguyen phan cut giua tu');
  assert.ok(/để anh chỉ điều chỉnh cho\n\n/.test(softenedMidWord) || /cho\n\n\(Câu trả lời/.test(softenedMidWord),
    'phai cat lui ve khoang trang gan nhat truoc tu dang do dang "kh"');
  assert.ok(/tiếp tục/.test(softenedMidWord), 'phai co ghi chu ngan huong dan hoi tiep');
  console.log('[PASS] A1: softenLengthTruncation() cắt lùi đúng về từ hoàn chỉnh gần nhất khi dừng giữa từ, kèm ghi chú ngắn');

  const completeSentence = 'Checklist đo hiệu quả công việc theo kỳ, KNL đánh giá năng lực nghề nghiệp.';
  const softenedComplete = softenLengthTruncation(completeSentence);
  assert.ok(softenedComplete.startsWith(completeSentence), 'cau da hoan chinh (ket thuc bang dau cham) khong duoc bi cat lui mat noi dung');
  assert.ok(/tiếp tục/.test(softenedComplete), 'van phai co ghi chu vi ham nay chi goi khi finish_reason=length that su');
  console.log('[PASS] A2: câu đã hoàn chỉnh (kết thúc đúng dấu câu) không bị cắt mất nội dung, chỉ thêm ghi chú');

  // ---- B. Tich hop qua runChatSandbox - finish_reason='length' tren luot
  // khong-tool (truong hop don gian nhat, dung dung 2 case Production report:
  // cau hoi HCNS general khong can goi tool) ----
  const originalFetch = global.fetch;
  const originalApiKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-fake-key-not-used-network-stubbed';
  let capturedBody = null;
  const cutContent = 'Trước tiên, hãy trao đổi riêng với nhân viên để hiểu rõ nguyên nhân, sau đó anh chỉ điều chỉnh cho kh';

  global.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: cutContent }, finish_reason: 'length' }] })
    };
  };
  try {
    const session = { account: { id: 'admin-truncation-1' }, role: 'admin' };
    const result = await runChatSandbox(session, [{ role: 'user', content: 'Trưởng nhóm nên làm gì khi nhân viên liên tục đi trễ?' }]);
    assert.ok(capturedBody.max_tokens > 1024, 'max_tokens gui len DeepSeek phai duoc nang len, khong con la 1024 cu (goc re gay cat cau)');
    assert.ok(!result.reply.endsWith('cho kh'), 'reply cuoi cung KHONG duoc ket thuc giua tu "kh" - phai da qua softenLengthTruncation');
    assert.ok(/tiếp tục/.test(result.reply), 'reply phai co ghi chu ngan bao co the chua day du');
    console.log('[PASS] B1: finish_reason=length qua runChatSandbox (luot không-tool) -> reply không còn cắt giữa từ, có ghi chú, max_tokens đã nâng');
  } finally {
    global.fetch = originalFetch;
  }

  // ---- C. finish_reason='stop' (binh thuong) - KHONG duoc them ghi chu thua ----
  const normalContent = 'KPI đo hiệu suất công việc theo mục tiêu cụ thể, còn KNL đánh giá năng lực nghề nghiệp - hai khái niệm khác nhau.';
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: normalContent }, finish_reason: 'stop' }] })
  });
  try {
    const session = { account: { id: 'admin-truncation-2' }, role: 'admin' };
    const result = await runChatSandbox(session, [{ role: 'user', content: 'KPI và KNL khác nhau như thế nào?' }]);
    assert.strictEqual(result.reply, normalContent, 'finish_reason=stop binh thuong KHONG duoc bi doi noi dung/them ghi chu thua');
    console.log('[PASS] C1: finish_reason=stop (bình thường) giữ nguyên reply, không thêm ghi chú thừa');
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = originalApiKey;
  }

  console.log('\nALL PASS - test-ai-truncation-hotfix.js');
}

run().catch(err => {
  console.error('[FAIL]', err && err.stack || err);
  process.exitCode = 1;
});
