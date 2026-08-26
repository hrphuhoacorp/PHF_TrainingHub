'use strict';

/*
 * PHF HR — Phase 2C Hard Gate proof test.
 *
 * Chứng minh: scripts/phf-knl-content-baseline-2026-08.js và
 * scripts/phf-knl-library-seed-needs-review-1.50.9.js — 2 script "NEEDS
 * GUARD" phát hiện ở PHF_HR_ENVIRONMENT_SCRIPT_FORENSIC_PHASE2B_2026-08-26.md
 * (write thật, KHÔNG có flag/dry-run gate nào trước Phase 2C) — giờ:
 *
 *   1) FAIL-CLOSED nếu SUPABASE_URL KHÔNG đúng MAIN (project được khai báo
 *      tường minh trong code là project ĐƯỢC PHÉP cho 2 script này —
 *      assertDeclaredTargetOrFailClosed('MAIN', ...)).
 *   2) ALLOW require() khi SUPABASE_URL đúng MAIN — nhưng KHÔNG tự ghi gì,
 *      vì main()/run() giờ chỉ tự chạy khi require.main===module (không
 *      đúng trong ngữ cảnh test này) VÀ mặc định DRY-RUN (chỉ ghi khi có
 *      --apply, không truyền trong test này).
 *
 * KHÔNG network, KHÔNG ghi bất kỳ DB nào (kể cả MAIN) — chỉ chứng minh
 * guard checkpoint, giống hệt phương pháp scripts/test-env-write-scripts-
 * sandbox-guard-v1.js (Phase 2A) và scripts/test-task-oracle-dev-guard.js.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_BASELINE_PATH = path.join(ROOT, 'scripts', 'phf-knl-content-baseline-2026-08.js');
const LIBRARY_SEED_PATH = path.join(ROOT, 'scripts', 'phf-knl-library-seed-needs-review-1.50.9.js');
const NODE_BIN = process.execPath;

let passed = 0;
let failed = 0;

function runRequireCase(label, scriptPath, env, expectAllow) {
  const childEnv = Object.assign({}, process.env, env);
  if (!('SUPABASE_URL' in env)) delete childEnv.SUPABASE_URL;
  if (!('SUPABASE_SECRET_KEY' in env)) delete childEnv.SUPABASE_SECRET_KEY;

  const script = "try { require(" + JSON.stringify(scriptPath) + "); " +
    "process.stdout.write('REQUIRE_OK'); process.exit(0); } " +
    "catch (e) { process.stderr.write(String(e && e.message || e)); process.exit(1); }";

  const result = spawnSync(NODE_BIN, ['-e', script], { env: childEnv, encoding: 'utf8', timeout: 10000 });

  const allowed = result.status === 0 && String(result.stdout).includes('REQUIRE_OK');
  const blockedWithFailClosedMessage = result.status !== 0 &&
    String(result.stderr).includes('PHF_ENV_GUARD_FAIL_CLOSED');

  if (expectAllow) {
    if (allowed) {
      console.log('PASS — ' + label + ' — guard cho phép require (đúng kỳ vọng, KHÔNG có DB operation nào chạy vì main()/run() không được gọi trong test này — mặc định cũng là dry-run, không truyền --apply).');
      passed += 1;
    } else {
      console.log('FAIL — ' + label + ' — kỳ vọng ALLOW nhưng bị chặn hoặc lỗi khác. status=' + result.status + ' stderr=' + result.stderr);
      failed += 1;
    }
  } else if (blockedWithFailClosedMessage) {
    console.log('PASS — ' + label + ' — guard từ chối đúng bằng PHF_ENV_GUARD_FAIL_CLOSED (đúng kỳ vọng).');
    passed += 1;
  } else if (allowed) {
    console.log('FAIL — ' + label + ' — guard LẼ RA phải từ chối nhưng lại cho phép require. NGHIÊM TRỌNG.');
    failed += 1;
  } else {
    console.log('FAIL — ' + label + ' — bị chặn nhưng KHÔNG đúng message PHF_ENV_GUARD_FAIL_CLOSED. status=' + result.status + ' stderr=' + result.stderr);
    failed += 1;
  }
}

[
  { file: 'scripts/phf-knl-content-baseline-2026-08.js', path: CONTENT_BASELINE_PATH },
  { file: 'scripts/phf-knl-library-seed-needs-review-1.50.9.js', path: LIBRARY_SEED_PATH },
].forEach(({ file, path: scriptPath }) => {
  // Case 1: MAIN thật -> phải ALLOW (đây LÀ project được khai báo cho 2 script này).
  runRequireCase(
    file + ' — MAIN target (byhpcexmjzqpctyvfczd) — project được khai báo, phải ALLOW',
    scriptPath,
    { SUPABASE_URL: 'https://byhpcexmjzqpctyvfczd.supabase.co', SUPABASE_SECRET_KEY: 'fake-main-secret-for-guard-test-only' },
    true
  );

  // Case 2: SANDBOX -> phải BLOCK (lệch khỏi project đã khai báo — dù SANDBOX
  // "an toàn hơn" về mặt dữ liệu, guard vẫn từ chối vì KHÔNG khớp khai báo,
  // tránh vô tình seed nội dung KNL thật vào nhầm project).
  runRequireCase(
    file + ' — SANDBOX target (pxkjvawdrixgoukhyvnk) — lệch khai báo, phải BLOCK',
    scriptPath,
    { SUPABASE_URL: 'https://pxkjvawdrixgoukhyvnk.supabase.co', SUPABASE_SECRET_KEY: 'fake-sandbox-secret-for-guard-test-only' },
    false
  );

  // Case 3: SUPABASE_URL rỗng tường minh -> phải BLOCK. Dùng '' (không phải
  // xoá biến hoàn toàn) vì 2 script này gọi dotenv.config() ở đầu file —
  // nếu XOÁ hẳn SUPABASE_URL khỏi env con, dotenv sẽ tự nạp lại .env root
  // thật (đúng là MAIN, vì đây chính là project được khai báo cho 2 script
  // này) khiến case "thiếu" vô tình trùng khớp "đúng" — không phải guard bị
  // qua mặt, mà là dotenv fallback CHÍNH XÁC ra project được phép. '' tường
  // minh mới thật sự kiểm tra được nhánh MISSING (dotenv không override giá
  // trị đã được SET, kể cả rỗng).
  runRequireCase(file + ' — Empty string SUPABASE_URL', scriptPath, { SUPABASE_URL: '' }, false);

  // Case 4: malformed URL -> phải BLOCK.
  runRequireCase(
    file + ' — Malformed SUPABASE_URL',
    scriptPath,
    { SUPABASE_URL: 'not a url at all', SUPABASE_SECRET_KEY: 'x' },
    false
  );

  // Case 5: project lạ/không xác định -> phải BLOCK.
  runRequireCase(
    file + ' — Unknown target (project ref lạ)',
    scriptPath,
    { SUPABASE_URL: 'https://totallyunknownref000000.supabase.co', SUPABASE_SECRET_KEY: 'fake-secret' },
    false
  );

  // Case 6: subdomain giả mạo nối trước ref MAIN thật -> phải BLOCK (exact-
  // hostname match, không phải substring).
  runRequireCase(
    file + ' — Subdomain giả mạo (evil-byhpcexmjzqpctyvfczd.supabase.co)',
    scriptPath,
    { SUPABASE_URL: 'https://evil-byhpcexmjzqpctyvfczd.supabase.co', SUPABASE_SECRET_KEY: 'x' },
    false
  );
});

console.log('');
console.log('TOTAL: ' + (passed + failed) + ' cases, PASS=' + passed + ', FAIL=' + failed);
if (failed > 0) {
  console.log('OVERALL: FAIL — 1 hoặc nhiều guard KHÔNG đảm bảo fail-closed đúng — DỪNG, không coi Phase 2C đã xong.');
  process.exit(1);
} else {
  console.log('OVERALL: PASS — cả 2 script (content-baseline, library-seed) fail-closed đúng khi lệch khai báo, cho phép đúng khi đúng MAIN đã khai báo.');
  process.exit(0);
}
