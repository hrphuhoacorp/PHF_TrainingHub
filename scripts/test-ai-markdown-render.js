'use strict';
/* PHF AI - Hotfix regression: Markdown-lite rendering (renderMessageContent)
   trong assets/js/ai/phf-ai-engine.js. File nguon la 1 IIFE gan vao
   `window` (khong phai CommonJS module) - chay no trong 1 vm context voi
   `window` gia de goi truc tiep window.PHFAiEngine.renderMessageContent(),
   dung logic san xuat that, khong viet lai parser rieng cho test.

   Chay thu cong: node scripts/test-ai-markdown-render.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'ai', 'phf-ai-engine.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const engine = sandbox.window.PHFAiEngine;
assert.ok(engine && typeof engine.renderMessageContent === 'function', 'PHFAiEngine.renderMessageContent phai duoc export');

// ---- Case 1: dung doan Production da bao cao (bold heading + bullet list) ----
const productionSample =
  '**Nhận định AI:**\n\n' +
  '- **Nhân viên mới ~3 tháng** – đây là giai đoạn onboarding, cần thời gian thích nghi.\n' +
  '- **Huyền không né tránh trách nhiệm** – đã chủ động trao đổi.\n' +
  '- **Nguồn áp lực được chỉ đích danh** – cần làm rõ với quản lý trực tiếp.';
const html1 = engine.renderMessageContent(productionSample);
assert.ok(!html1.includes('**'), 'khong duoc con ky tu ** tho trong HTML: ' + html1);
assert.ok(!/^-\s|<br>-\s|<li>-\s/.test(html1), 'khong duoc con dau "- " tho o dau bullet');
assert.ok(/<ul>/.test(html1) && /<\/ul>/.test(html1), 'phai render ra <ul>');
assert.ok((html1.match(/<li>/g) || []).length === 3, 'phai co dung 3 <li>');
assert.ok(/<strong>Nhân viên mới ~3 tháng<\/strong>/.test(html1), 'bold trong bullet phai thanh <strong>');
assert.ok(/<strong>Nhận định AI:<\/strong>/.test(html1), 'dong bold rieng (khong phai OPINION_PREFIXES cu vi co ** bao quanh) van phai render bold binh thuong');
console.log('[PASS] Case 1: đoạn Production thật (heading bold + bullet 3 dòng) render sạch, không còn ký tự markdown thô');

// ---- Case 2: XSS - model KHONG duoc inject HTML/script du dung cu phap gi ----
const xssAttempts = [
  '<script>alert(1)</script>',
  '**bold with <img src=x onerror=alert(1)>**',
  '- item với <a href="javascript:alert(1)">click</a>',
  '`code <b>bold-in-code</b>`'
];
xssAttempts.forEach(function(payload){
  const html = engine.renderMessageContent(payload);
  assert.ok(!/<script/i.test(html), 'khong duoc lot <script qua: ' + payload + ' => ' + html);
  assert.ok(!/<img/i.test(html), 'khong duoc lot <img qua: ' + payload + ' => ' + html);
  assert.ok(!/<a\s/i.test(html), 'khong duoc lot <a qua: ' + payload + ' => ' + html);
  assert.ok(!/<b>/i.test(html), 'khong duoc lot the <b> tho tu trong inline code qua: ' + payload + ' => ' + html);
});
console.log('[PASS] Case 2: mọi biến thể chèn HTML/script qua markdown đều bị escape sạch, không XSS');

// ---- Case 3: nhan cu "Nhận định AI:"/"Gợi ý AI:" (hoi thoai da luu TRUOC hotfix) van render dung tag, khong vo layout ----
const legacy1 = engine.renderMessageContent('Nhận định AI: nên ưu tiên xử lý theo hướng A.');
assert.ok(/phf-ai-opinion-tag/.test(legacy1) && /Nhận định AI/.test(legacy1), 'legacy prefix "Nhận định AI:" van phai duoc nhan dien');
const legacy2 = engine.renderMessageContent('Gợi ý AI: cân nhắc thêm phương án B.');
assert.ok(/phf-ai-opinion-tag/.test(legacy2), 'legacy prefix "Gợi ý AI:" van phai duoc nhan dien');
console.log('[PASS] Case 3: nhãn cũ "Nhận định AI:"/"Gợi ý AI:" (hội thoại đã lưu trước hotfix) vẫn render đúng tag, không vỡ');

// ---- Case 4: nhan moi tu nhien ----
const naturalNew = engine.renderMessageContent('Phân tích & đề xuất: nên trao đổi trực tiếp với quản lý.');
assert.ok(/phf-ai-opinion-tag/.test(naturalNew) && /Phân tích &amp; đề xuất/.test(naturalNew), 'nhan tu nhien moi phai duoc nhan dien va escape dung (& -> &amp;)');
console.log('[PASS] Case 4: nhãn tự nhiên mới "Phân tích & đề xuất:" được nhận diện và escape đúng');

// ---- Case 5: doan van thuong (khong markdown), nhieu dong -> <p> + <br>, khong bullet nham ----
const plain = engine.renderMessageContent('Dòng một.\nDòng hai.\n\nĐoạn mới.');
assert.ok(/<p>Dòng một\.<br>Dòng hai\.<\/p>/.test(plain), 'doan van thuong phai giu <br> giua cac dong cung 1 doan');
assert.ok(/<p>Đoạn mới\.<\/p>/.test(plain), 'doan van moi (cach 1 dong trong) phai la <p> rieng');
console.log('[PASS] Case 5: đoạn văn thường (không markdown) vẫn xuống dòng đúng qua <p>/<br>, không đổi hành vi cũ');

// ---- Case 6: danh sach so thu tu + inline code ----
const ordered = engine.renderMessageContent('1. Bước một\n2. Bước hai với `mã lệnh`');
assert.ok(/<ol>/.test(ordered) && (ordered.match(/<li>/g) || []).length === 2, 'phai render dung <ol> 2 muc');
assert.ok(/<code>mã lệnh<\/code>/.test(ordered), 'inline code phai thanh <code>');
console.log('[PASS] Case 6: danh sách số thứ tự + inline code render đúng');

// ---- Case 7: EXACT Production regression fixture (report "literal **/---")
// - hr, bold nhieu doan, khong con markdown tho ----
const productionFixture =
  'Đây là câu hỏi rất trọng tâm, vì hai hệ thống này hay bị nhầm là "cùng đo lường nhân viên", nhưng thực ra chúng phục vụ hai mục đích hoàn toàn khác nhau trong nghiệp vụ PHF.\n\n' +
  '---\n\n' +
  '**Checklist** là công cụ đo lường **mức độ tuân thủ và thực thi công việc theo kỳ**. Nó hoạt động theo cơ chế: mỗi kỳ, nhân viên bắt đầu với điểm tối đa, và bị trừ điểm mỗi khi có lỗi vi phạm được ghi nhận chính thức.\n\n' +
  '**Khung năng lực** lại đo lường **năng lực nghề nghiệp** – tức kiến thức, kỹ năng, khả năng xử lý công việc ở chiều sâu.';
const htmlFixture = engine.renderMessageContent(productionFixture);
assert.ok(!htmlFixture.includes('**'), 'fixture Production KHONG duoc con ky tu ** tho: ' + htmlFixture);
assert.ok(!/(^|<p>)---/.test(htmlFixture) && !htmlFixture.includes('<p>---</p>'), 'fixture Production KHONG duoc con "---" tho');
assert.ok(/<hr>/.test(htmlFixture), '"---" phai render thanh <hr>');
assert.ok(/<strong>Checklist<\/strong>/.test(htmlFixture) && /<strong>Khung năng lực<\/strong>/.test(htmlFixture), 'bold Checklist/Khung năng lực phai render dung');
console.log('[PASS] Case 7: đúng fixture Production báo lỗi (heading mở bài + --- + 2 đoạn bold) render sạch hoàn toàn - không còn **/---');

// ---- Case 8: italic (* và _), code fence nhieu dong, heading gia (#) ----
const italic1 = engine.renderMessageContent('Đây là *nhấn mạnh* trong câu.');
assert.ok(/<em>nhấn mạnh<\/em>/.test(italic1), 'italic bang * don phai thanh <em>');
const italic2 = engine.renderMessageContent('Đây là _nhấn mạnh_ trong câu.');
assert.ok(/<em>nhấn mạnh<\/em>/.test(italic2), 'italic bang _ don phai thanh <em>');
const boldStillWorks = engine.renderMessageContent('**In đậm** và *in nghiêng* cùng câu.');
assert.ok(/<strong>In đậm<\/strong>/.test(boldStillWorks) && /<em>in nghiêng<\/em>/.test(boldStillWorks), 'bold va italic cung xuat hien trong 1 cau phai deu dung, khong xung dot');

const fence = engine.renderMessageContent('Ví dụ lệnh:\n\n```\nconst x = 1;\nconsole.log(x);\n```\n\nSau đoạn code.');
assert.ok(/<pre><code>/.test(fence) && /<\/code><\/pre>/.test(fence), 'code fence nhieu dong phai thanh <pre><code>');
assert.ok(/const x = 1;/.test(fence) && /console\.log\(x\);/.test(fence), 'noi dung code fence phai giu nguyen (khong bi tach thanh nhieu <p> boi dong trong ben trong)');
assert.ok(/Sau đoạn code\./.test(fence), 'doan van sau code fence van phai render binh thuong');

const heading = engine.renderMessageContent('## Tổng quan\n\nNội dung bên dưới.');
assert.ok(/phf-ai-heading/.test(heading) && /<strong>Tổng quan<\/strong>/.test(heading), 'heading gia (##) phai bold nhe, khong dung the h1-h6 that');
assert.ok(!/<h[1-6]/.test(heading), 'khong duoc dung the heading that (h1-h6) - tranh bien bubble thanh document');
console.log('[PASS] Case 8: italic (*/_), code fence nhiều dòng, heading giả (#) render đúng, không xung đột với bold/list');

// ---- Case 9: XSS qua cu phap moi (code fence, italic, heading) ----
const xssNew = [
  '```\n<script>alert(1)</script>\n```',
  '# <img src=x onerror=alert(1)>',
  '*<a href="javascript:alert(1)">click</a>*'
];
xssNew.forEach(function(payload){
  const html = engine.renderMessageContent(payload);
  assert.ok(!/<script/i.test(html), 'code fence khong duoc lot <script qua: ' + payload + ' => ' + html);
  assert.ok(!/<img/i.test(html), 'heading khong duoc lot <img qua: ' + payload + ' => ' + html);
  assert.ok(!/<a\s/i.test(html), 'italic khong duoc lot <a qua: ' + payload + ' => ' + html);
});
console.log('[PASS] Case 9: cú pháp markdown mới (code fence/heading/italic) vẫn escape sạch, không XSS');

console.log('\nALL PASS - test-ai-markdown-render.js');
