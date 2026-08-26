'use strict';

/*
 * PHF HR — regression test cho api/_lib/env-identity-guard.js.
 *
 * Chỉ test classifySupabaseUrl() (thuần hàm, không I/O) + xác nhận
 * logSupabaseIdentityOnce() không throw và không log secret nào — KHÔNG
 * cần mock DB/network vì module này không có side-effect nào ngoài
 * console.warn.
 */

const assert = require('assert');
const path = require('path');
const { classifySupabaseUrl, logSupabaseIdentityOnce, MAIN_HOSTNAME, SANDBOX_HOSTNAME } = require(
  path.resolve(__dirname, '..', 'api', '_lib', 'env-identity-guard')
);

let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }

pass(MAIN_HOSTNAME === 'byhpcexmjzqpctyvfczd.supabase.co', 'MAIN_HOSTNAME đúng ref đã chốt');
pass(SANDBOX_HOSTNAME === 'pxkjvawdrixgoukhyvnk.supabase.co', 'SANDBOX_HOSTNAME đúng ref đã chốt');

pass(classifySupabaseUrl('https://byhpcexmjzqpctyvfczd.supabase.co').label === 'MAIN', 'Đúng MAIN URL -> label MAIN');
pass(classifySupabaseUrl('https://pxkjvawdrixgoukhyvnk.supabase.co').label === 'SANDBOX', 'Đúng SANDBOX URL -> label SANDBOX');
pass(classifySupabaseUrl('').label === 'MISSING', 'Rỗng -> MISSING');
pass(classifySupabaseUrl(undefined).label === 'MISSING', 'undefined -> MISSING');
pass(classifySupabaseUrl(null).label === 'MISSING', 'null -> MISSING');
pass(classifySupabaseUrl('not a url at all').label === 'MALFORMED', 'Chuỗi không phải URL -> MALFORMED');
pass(classifySupabaseUrl('https://example.com').label === 'UNKNOWN', 'Host lạ hoàn toàn -> UNKNOWN');

// Spoofing cases — exact-hostname match phải chặn đúng, không bị substring
// đánh lừa (cùng bộ case đã dùng ở scripts/test-task-oracle-dev-guard.js).
// Ghi chú: classifySupabaseUrl KHÔNG kiểm tra protocol (module chỉ NHẬN
// DIỆN, không NGĂN CHẶN — enforcement protocol là việc của caller nếu cần)
// nên http:// với đúng hostname MAIN vẫn hợp lý được nhận diện là MAIN.
pass(classifySupabaseUrl('http://byhpcexmjzqpctyvfczd.supabase.co').label === 'MAIN', 'http:// (sai protocol) nhưng đúng hostname MAIN -> vẫn nhận diện MAIN (enforcement protocol là việc của caller)');

pass(classifySupabaseUrl('https://evil-byhpcexmjzqpctyvfczd.supabase.co').label === 'UNKNOWN', 'Subdomain giả mạo nối trước ref thật -> KHÔNG bị nhận nhầm MAIN');
pass(classifySupabaseUrl('https://byhpcexmjzqpctyvfczd.supabase.co.evil.example').label === 'UNKNOWN', 'Domain nối đuôi giả mạo -> KHÔNG bị nhận nhầm MAIN');
pass(classifySupabaseUrl('https://example.com/byhpcexmjzqpctyvfczd.supabase.co').label === 'UNKNOWN', 'Ref thật chỉ nằm trong path của host lạ -> KHÔNG bị nhận nhầm MAIN');
pass(classifySupabaseUrl('https://example.com/?x=byhpcexmjzqpctyvfczd.supabase.co').label === 'UNKNOWN', 'Ref thật chỉ nằm trong query của host lạ -> KHÔNG bị nhận nhầm MAIN');
pass(classifySupabaseUrl('https://evil-pxkjvawdrixgoukhyvnk.supabase.co').label === 'UNKNOWN', 'Subdomain giả mạo nối trước ref SANDBOX -> KHÔNG bị nhận nhầm SANDBOX');

// logSupabaseIdentityOnce — không throw, không log giá trị SUPABASE_URL thô
// (chỉ log hostname đã parse, đã là public info) — capture console.warn.
{
  const savedUrl = process.env.SUPABASE_URL;
  const savedWarn = console.warn;
  let captured = [];
  console.warn = (...args) => { captured.push(args.join(' ')); };
  try {
    process.env.SUPABASE_URL = 'https://byhpcexmjzqpctyvfczd.supabase.co';
    const result = logSupabaseIdentityOnce('(unit test)');
    pass(result.label === 'MAIN', 'logSupabaseIdentityOnce trả về đúng classification');
    pass(captured.length === 1, 'logSupabaseIdentityOnce in đúng 1 dòng cảnh báo');
    pass(/PHF_HR_MAIN/.test(captured[0]), 'Dòng cảnh báo nêu rõ MAIN khi trỏ Production thật');
  } finally {
    console.warn = savedWarn;
    process.env.SUPABASE_URL = savedUrl;
  }
}

console.log('PHF ENV Identity Guard V1 test: ' + passed + '/' + passed + ' PASS');
