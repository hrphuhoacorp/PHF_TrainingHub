'use strict';

/*
 * PHF HR — Phase 2A Hard Gate proof test.
 *
 * Chứng minh: scripts/seed.js và scripts/phf-migrate-user-accounts-to-supabase.js
 * KHÔNG BAO GIỜ chạy tới bất kỳ createClient()/DB operation nào khi
 * SUPABASE_URL không phải ĐÚNG PHF_HR_SANDBOX (pxkjvawdrixgoukhyvnk), và
 * KHÔNG bị chặn oan khi SUPABASE_URL đúng SANDBOX.
 *
 * KHÔNG gọi seed()/main() thật (2 file này export hàm nhưng chỉ tự chạy
 * khi require.main===module — require() trong test này KHÔNG kích hoạt
 * seed()/main()) — nên test này KHÔNG network, KHÔNG ghi bất kỳ DB nào,
 * kể cả SANDBOX. Chỉ chứng minh đúng 1 điều: GUARD CHECKPOINT chạy TRƯỚC
 * mọi thứ khác và fail-closed đúng theo classification.
 *
 * Mỗi case chạy trong 1 tiến trình Node con RIÊNG (child_process) vì guard
 * throw ngay lúc require() lần đầu — không thể re-require trong cùng
 * process (Node cache module sau lần đầu).
 */

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SEED_PATH = path.join(ROOT, 'scripts', 'seed.js');
const MIGRATE_PATH = path.join(ROOT, 'scripts', 'phf-migrate-user-accounts-to-supabase.js');
const NODE_BIN = process.execPath;

let passed = 0;
let failed = 0;

function runRequireCase(label, scriptPath, env, expectAllow) {
  const childEnv = Object.assign({}, process.env, env);
  if (!('SUPABASE_URL' in env)) delete childEnv.SUPABASE_URL;
  if (!('SUPABASE_SECRET_KEY' in env)) delete childEnv.SUPABASE_SECRET_KEY;

  // require() thôi, KHÔNG gọi seed()/main() — require.main !== module trong
  // ngữ cảnh -e nên script tự nhận biết không phải invoke trực tiếp, đúng
  // với gate require.main===module đã thêm ở cả 2 file.
  const script = "try { require(" + JSON.stringify(scriptPath) + "); " +
    "process.stdout.write('REQUIRE_OK'); process.exit(0); } " +
    "catch (e) { process.stderr.write(String(e && e.message || e)); process.exit(1); }";

  const result = spawnSync(NODE_BIN, ['-e', script], { env: childEnv, encoding: 'utf8', timeout: 10000 });

  const allowed = result.status === 0 && String(result.stdout).includes('REQUIRE_OK');
  const blockedWithFailClosedMessage = result.status !== 0 &&
    String(result.stderr).includes('PHF_ENV_GUARD_FAIL_CLOSED');

  if (expectAllow) {
    if (allowed) {
      console.log('PASS — ' + label + ' — guard cho phép require (đúng kỳ vọng, KHÔNG có DB operation nào chạy vì main()/seed() không được gọi trong test này).');
      passed += 1;
    } else {
      console.log('FAIL — ' + label + ' — kỳ vọng ALLOW nhưng bị chặn hoặc lỗi khác. status=' + result.status + ' stderr=' + result.stderr);
      failed += 1;
    }
  } else if (blockedWithFailClosedMessage) {
    console.log('PASS — ' + label + ' — guard từ chối đúng bằng PHF_ENV_GUARD_FAIL_CLOSED (đúng kỳ vọng).');
    passed += 1;
  } else if (allowed) {
    console.log('FAIL — ' + label + ' — guard LẼ RA phải từ chối nhưng lại cho phép require. NGHIÊM TRỌNG — MAIN có thể bị ghi.');
    failed += 1;
  } else {
    console.log('FAIL — ' + label + ' — bị chặn nhưng KHÔNG đúng message PHF_ENV_GUARD_FAIL_CLOSED (có thể lỗi khác). status=' + result.status + ' stderr=' + result.stderr);
    failed += 1;
  }
}

[
  { file: 'scripts/seed.js', path: SEED_PATH },
  { file: 'scripts/phf-migrate-user-accounts-to-supabase.js', path: MIGRATE_PATH },
].forEach(({ file, path: scriptPath }) => {
  // Case 1: SANDBOX thật -> phải ALLOW.
  runRequireCase(
    file + ' — SANDBOX target (pxkjvawdrixgoukhyvnk)',
    scriptPath,
    { SUPABASE_URL: 'https://pxkjvawdrixgoukhyvnk.supabase.co', SUPABASE_SECRET_KEY: 'fake-sandbox-secret-for-guard-test-only' },
    true
  );

  // Case 2: MAIN thật -> phải BLOCK. Đây chính là case đã phát hiện nguy
  // hiểm ở PHF_HR_ENVIRONMENT_ACCESS_MATRIX_PHASE2_2026-08-26.md.
  runRequireCase(
    file + ' — MAIN target (byhpcexmjzqpctyvfczd) — case NGUY HIỂM đã phát hiện',
    scriptPath,
    { SUPABASE_URL: 'https://byhpcexmjzqpctyvfczd.supabase.co', SUPABASE_SECRET_KEY: 'fake-main-secret-for-guard-test-only' },
    false
  );

  // Case 3: thiếu SUPABASE_URL hoàn toàn (đúng nghĩa "quên set", root cause
  // gốc — dotenv.config() sẽ fallback về .env thật = MAIN nếu KHÔNG guard) -> phải BLOCK.
  runRequireCase(file + ' — Missing SUPABASE_URL (root cause gốc của bug)', scriptPath, {}, false);

  // Case 4: project lạ/không xác định -> phải BLOCK.
  runRequireCase(
    file + ' — Unknown target (project ref lạ)',
    scriptPath,
    { SUPABASE_URL: 'https://totallyunknownref000000.supabase.co', SUPABASE_SECRET_KEY: 'fake-secret' },
    false
  );

  // Case 5: subdomain giả mạo nối trước ref SANDBOX thật -> phải BLOCK
  // (exact-hostname match phải đúng, không phải substring).
  runRequireCase(
    file + ' — Subdomain giả mạo (evil-pxkjvawdrixgoukhyvnk.supabase.co)',
    scriptPath,
    { SUPABASE_URL: 'https://evil-pxkjvawdrixgoukhyvnk.supabase.co', SUPABASE_SECRET_KEY: 'x' },
    false
  );
});

console.log('');
console.log('TOTAL: ' + (passed + failed) + ' cases, PASS=' + passed + ', FAIL=' + failed);
if (failed > 0) {
  console.log('OVERALL: FAIL — 1 hoặc nhiều guard KHÔNG đảm bảo fail-closed đúng — DỪNG, không coi Phase 2A đã xong.');
  process.exit(1);
} else {
  console.log('OVERALL: PASS — cả 2 script (seed.js, phf-migrate-user-accounts-to-supabase.js) fail-closed đúng cho MAIN/Missing/Unknown/Spoofed, cho phép đúng SANDBOX.');
  process.exit(0);
}
