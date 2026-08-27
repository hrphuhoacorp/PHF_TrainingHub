'use strict';

// TEST/MOCK HARNESS cho lib/config.js — Gate 5.6A: PHF_HR_ATTACHMENT_ROOT
// hardening (validated, bắt buộc, absolute, normalized, không phải
// filesystem root). KHÔNG DB thật, KHÔNG filesystem thật, KHÔNG network.
//
// Kỹ thuật: gọi thẳng loadConfig() (không cần mock require.cache — hàm này
// đọc process.env/file .env trực tiếp mỗi lần gọi, không cache module-level)
// với process.env được set/xóa tạm thời cho từng scenario, LUÔN khôi phục
// nguyên trạng process.env sau mỗi test (kể cả khi assertion fail) để không
// làm nhiễu các test khác chạy chung tiến trình.
//
// Chạy: node test-config-mock-harness.js

const assert = require('assert');
const { loadConfig } = require('./lib/config');

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, detail !== undefined ? detail : '');
}

// Baseline — mọi field BẮT BUỘC khác (đã CLOSED trước G5.6A) phải hợp lệ để
// cô lập test CHỈ vào PHF_HR_ATTACHMENT_ROOT, không lẫn lỗi khác.
const REQUIRED_BASE_ENV = {
  SUPABASE_URL: 'https://mock-dev-project-not-real.supabase.co',
  SUPABASE_SECRET_KEY: 'mock-secret-key-not-real',
  PHF_HR_API_SERVICE_TOKEN: 'mock-service-token-not-real-0123456789abcdef',
  PHF_HR_DB_HOST: 'mock-db-host-not-real',
  PHF_HR_DB_NAME: 'mock-db-name-not-real',
  PHF_HR_DB_RUNTIME_USER: 'mock-db-user-not-real',
  PHF_HR_DB_RUNTIME_PASSWORD: 'mock-db-password-not-real',
};

const ATTACHMENT_ENV_KEY = 'PHF_HR_ATTACHMENT_ROOT';
const ALL_MANAGED_KEYS = Object.keys(REQUIRED_BASE_ENV).concat([ATTACHMENT_ENV_KEY]);

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of ALL_MANAGED_KEYS) saved[key] = process.env[key];
  try {
    for (const key of Object.keys(REQUIRED_BASE_ENV)) process.env[key] = REQUIRED_BASE_ENV[key];
    if (Object.prototype.hasOwnProperty.call(overrides, ATTACHMENT_ENV_KEY)) {
      const v = overrides[ATTACHMENT_ENV_KEY];
      if (v === undefined) delete process.env[ATTACHMENT_ENV_KEY];
      else process.env[ATTACHMENT_ENV_KEY] = v;
    } else {
      delete process.env[ATTACHMENT_ENV_KEY];
    }
    return fn();
  } finally {
    for (const key of ALL_MANAGED_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const isWindows = process.platform === 'win32';
// absolute path hợp lệ cross-platform cho test — Windows cần ổ đĩa, POSIX chỉ cần '/'.
const VALID_ABS_ROOT = isWindows ? 'C:\\phf-attachments-mock-root' : '/var/phf-attachments-mock-root';
const FS_ROOT_PATH = isWindows ? 'C:\\' : '/';

(async () => {
  // 1) valid absolute root -> PASS, ok=true, field set đúng
  {
    const config = withEnv({ [ATTACHMENT_ENV_KEY]: VALID_ABS_ROOT }, () => loadConfig());
    record(
      'config_1_validAbsoluteRoot_ok',
      config.ok === true && config.PHF_HR_ATTACHMENT_ROOT === require('path').normalize(VALID_ABS_ROOT),
      { ok: config.ok, root: config.PHF_HR_ATTACHMENT_ROOT, errors: config.errors }
    );
  }

  // 2) missing root -> ok=false, error rõ ràng, KHÔNG silent fallback về '' coi như hợp lệ
  {
    const config = withEnv({ [ATTACHMENT_ENV_KEY]: undefined }, () => loadConfig());
    record(
      'config_2_missingRoot_failsClosed',
      config.ok === false && config.PHF_HR_ATTACHMENT_ROOT === '' &&
        config.errors.some((e) => e.includes('PHF_HR_ATTACHMENT_ROOT')),
      { ok: config.ok, root: config.PHF_HR_ATTACHMENT_ROOT, errors: config.errors }
    );
  }

  // 3) relative path -> reject
  {
    const config = withEnv({ [ATTACHMENT_ENV_KEY]: 'relative/attachments/dir' }, () => loadConfig());
    record(
      'config_3_relativePath_rejected',
      config.ok === false && config.PHF_HR_ATTACHMENT_ROOT === '' &&
        config.errors.some((e) => e.includes('absolute path')),
      { ok: config.ok, errors: config.errors }
    );
  }

  // 4) root = filesystem root ('/' hoặc 'C:\\') -> reject (quá rộng)
  {
    const config = withEnv({ [ATTACHMENT_ENV_KEY]: FS_ROOT_PATH }, () => loadConfig());
    record(
      'config_4_filesystemRoot_rejected_tooBroad',
      config.ok === false && config.PHF_HR_ATTACHMENT_ROOT === '' &&
        config.errors.some((e) => e.includes('filesystem root')),
      { ok: config.ok, errors: config.errors }
    );
  }

  // 4b) POSIX '/' luôn bị chặn kể cả trên Windows (kiểm tra logic thuần, không phụ thuộc path.sep)
  {
    const config = withEnv({ [ATTACHMENT_ENV_KEY]: '/' }, () => loadConfig());
    record(
      'config_4b_posixSlashRoot_rejected',
      config.ok === false && config.errors.some((e) => e.includes('filesystem root') || e.includes('absolute path')),
      { ok: config.ok, errors: config.errors, platform: process.platform }
    );
  }

  // 5) normalized path — trailing slash / redundant segments bị chuẩn hoá đúng
  {
    const messy = isWindows ? 'C:\\phf-attachments-mock-root\\sub\\..\\sub2\\' : '/var/phf-attachments-mock-root/sub/../sub2/';
    const path = require('path');
    const normalized = path.normalize(messy);
    const expected = normalized.endsWith(path.sep) ? normalized.slice(0, -path.sep.length) : normalized;
    const config = withEnv({ [ATTACHMENT_ENV_KEY]: messy }, () => loadConfig());
    record(
      'config_5_normalizedPath_correct',
      config.ok === true && config.PHF_HR_ATTACHMENT_ROOT === expected && !config.PHF_HR_ATTACHMENT_ROOT.endsWith(isWindows ? '\\' : '/'),
      { root: config.PHF_HR_ATTACHMENT_ROOT, expected, errors: config.errors }
    );
  }

  // 6) existing config regression — field/behavior khác (SUPABASE_URL, PORT default,
  // production project ref hard-stop, DB fields) KHÔNG bị ảnh hưởng bởi thay đổi này.
  {
    const config = withEnv({ [ATTACHMENT_ENV_KEY]: VALID_ABS_ROOT }, () => loadConfig());
    const prodBlockConfig = withEnv({ [ATTACHMENT_ENV_KEY]: VALID_ABS_ROOT }, () => {
      const saved = process.env.SUPABASE_URL;
      process.env.SUPABASE_URL = 'https://byhpcexmjzqpctyvfczd.supabase.co';
      const c = loadConfig();
      process.env.SUPABASE_URL = saved;
      return c;
    });
    record(
      'config_6_existingFieldsRegression_unaffected',
      config.ok === true &&
        config.SUPABASE_URL === REQUIRED_BASE_ENV.SUPABASE_URL &&
        config.PHF_HR_DB_HOST === REQUIRED_BASE_ENV.PHF_HR_DB_HOST &&
        typeof config.PORT === 'number' &&
        prodBlockConfig.ok === false &&
        prodBlockConfig.errors.some((e) => e.includes('HARD STOP')),
      { ok: config.ok, port: config.PORT, prodBlockOk: prodBlockConfig.ok }
    );
  }

  // 7) summary KHÔNG lộ full path — chỉ set/missing + length
  {
    const config = withEnv({ [ATTACHMENT_ENV_KEY]: VALID_ABS_ROOT }, () => loadConfig());
    const summaryStr = JSON.stringify(config.summary);
    record(
      'config_7_summary_noFullPathLeak',
      !summaryStr.includes(VALID_ABS_ROOT) && typeof config.summary.phfHrAttachmentRoot === 'string' && config.summary.phfHrAttachmentRoot.startsWith('(set'),
      { summaryField: config.summary.phfHrAttachmentRoot }
    );
  }

  // 8) empty string (whitespace-only) -> reject giống missing, KHÔNG silent-pass
  {
    const config = withEnv({ [ATTACHMENT_ENV_KEY]: '   ' }, () => loadConfig());
    record(
      'config_8_whitespaceOnly_treatedAsMissing',
      config.ok === false && config.PHF_HR_ATTACHMENT_ROOT === '' && config.errors.some((e) => e.includes('PHF_HR_ATTACHMENT_ROOT')),
      { ok: config.ok, errors: config.errors }
    );
  }

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${total} PASS`);
  if (passed !== total) {
    console.log('FAILED:', results.filter((r) => !r.pass).map((r) => r.name));
    process.exitCode = 1;
  }
})().catch((err) => {
  console.error('HARNESS_CRASH', err);
  process.exitCode = 1;
});
