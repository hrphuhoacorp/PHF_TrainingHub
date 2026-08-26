'use strict';

// Config loader + validation cho phf-hr-api.
//
// THỨ TỰ ƯU TIÊN (cao → thấp) — SỬA sau khi phát hiện lỗi thật trên server:
//   1) process.env.*  — Docker `env_file` (docker-compose) chỉ bơm biến vào
//      process.env của container, KHÔNG tạo ra file .env vật lý bên trong
//      image (Dockerfile/.dockerignore cố ý KHÔNG copy .env vào image). Bản
//      trước chỉ đọc file vật lý qua parseEnvFile() nên trên container
//      SERVICE_ENV luôn rỗng — đây LÀ nguyên nhân phải hotfix tay trên
//      server. Ưu tiên process.env đầu tiên sửa đúng gốc vấn đề này.
//   2) devEnv  — .env.test ở ROOT repo (chỉ tồn tại khi chạy local trong
//      monorepo; không tồn tại khi deploy standalone → parseEnvFile trả {}
//      an toàn).
//   3) serviceEnv — services/phf-hr-api/.env đọc trực tiếp bằng file (dùng
//      khi chạy `node server.js` thủ công, KHÔNG qua Docker, trên server hay
//      local).
//
// Không bao giờ log giá trị secret — chỉ log "có/không có" + độ dài.

const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ROOT_ENV_TEST = path.join(REPO_ROOT, '.env.test');
const SERVICE_ENV = path.join(__dirname, '..', '.env');

// Production project ref — DÙNG ĐỂ CHẶN CỨNG, không phải chỉ dựa vào kỷ luật
// vận hành. Nếu SUPABASE_URL trỏ đúng project này, service KHÔNG ĐƯỢC boot.
//
// Exact-hostname match (WHATWG URL), KHÔNG phải substring/.includes() —
// nâng cấp theo PHF_HR_ENVIRONMENT_SUPABASE_SOURCE_OF_TRUTH_2026-08-26.md
// mục 17/18 (S6/R3): substring-match cũ có thể bỏ lọt hoặc chặn nhầm các
// biến thể URL (subdomain giả mạo, domain nối đuôi, ref nằm trong path/
// query của host khác) — cùng chuẩn đã dùng ở scripts/task-oracle-dev-only.js.
// PRODUCTION_PROJECT_REF_FRAGMENT giữ nguyên tên/giá trị export cho tương
// thích ngược (test harness/caller hiện có tham chiếu tên này) — chỉ đổi
// CÁCH SO KHỚP bên dưới (isProductionSupabaseUrl), không đổi giá trị ref.
const PRODUCTION_PROJECT_REF_FRAGMENT = 'byhpcexmjzqpctyvfczd';
const PRODUCTION_HOSTNAME = PRODUCTION_PROJECT_REF_FRAGMENT + '.supabase.co';

function isProductionSupabaseUrl(rawUrl) {
  const text = String(rawUrl == null ? '' : rawUrl).trim();
  if (!text) return false;
  let parsed;
  try {
    parsed = new URL(text);
  } catch (e) {
    // Malformed URL không tự động = an toàn — nhưng cũng không khớp
    // ĐÚNG hostname Production, nên không tự gắn nhãn "Production" ở đây.
    // Case malformed vẫn bị validate lỗi bởi phần errors chung phía dưới.
    return false;
  }
  return String(parsed.hostname || '').toLowerCase() === PRODUCTION_HOSTNAME;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, 'utf8');
  const out = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function maskLen(v) {
  if (!v) return '(missing)';
  return `(set, len=${v.length})`;
}

function loadConfig() {
  const devEnv = parseEnvFile(ROOT_ENV_TEST);
  const serviceEnv = parseEnvFile(SERVICE_ENV);

  const SUPABASE_URL = process.env.SUPABASE_URL || devEnv.SUPABASE_URL || serviceEnv.SUPABASE_URL || '';
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || devEnv.SUPABASE_SECRET_KEY || serviceEnv.SUPABASE_SECRET_KEY || '';
  const PORT = Number(process.env.PORT || serviceEnv.PORT || process.env.PHF_HR_API_PORT || 8791);
  const SERVICE_TOKEN = process.env.PHF_HR_API_SERVICE_TOKEN || serviceEnv.PHF_HR_API_SERVICE_TOKEN || '';
  // Mặc định 127.0.0.1 (an toàn nhất — dùng khi chạy trực tiếp bằng `node
  // server.js`, không qua container). Trong container trên server,
  // PHF_HR_API_BIND_HOST=0.0.0.0 được bơm qua process.env (docker-compose
  // env_file) — an toàn vì ranh giới cách ly thật sự nằm ở docker-compose
  // "127.0.0.1:11000:11000" (host chỉ publish loopback), KHÔNG phải ở việc
  // process bind địa chỉ nào bên trong network namespace của riêng container
  // (namespace đó vốn đã bị Docker cô lập khỏi mạng ngoài, bind 0.0.0.0 chỉ
  // có nghĩa "mọi interface trong namespace đó").
  const BIND_HOST = process.env.PHF_HR_API_BIND_HOST || serviceEnv.PHF_HR_API_BIND_HOST || '127.0.0.1';
  // Secret RIÊNG để verify RESOLVED_TASK_QUERY_DESCRIPTOR_V1 (khác hẳn
  // SERVICE_TOKEN — token xác thực "server nào được gọi", secret này xác
  // thực "request cụ thể này được main app resolve/ký hợp lệ"). Optional ở
  // tầng config: thiếu secret không chặn boot server (endpoint /v1/task/categories
  // vẫn hoạt động bình thường), nhưng route descriptor-aware phải tự fail-closed
  // nếu thiếu — xem server.js.
  const DESCRIPTOR_SIGNING_SECRET = process.env.TASK_QUERY_DESCRIPTOR_SIGNING_SECRET || serviceEnv.TASK_QUERY_DESCRIPTOR_SIGNING_SECRET || '';

  // Runtime DB identity (Option B, S4 correction — xem
  // BAN_GIAO_PHF_HR_RUNTIME_IDENTITY_RUNBOOK). phf_hr_runtime là role
  // LOGIN-only, KHÔNG có grant trực tiếp trên schema task — mọi quyền
  // runtime chỉ đạt được qua `SET LOCAL ROLE phf_hr_app` bên trong 1
  // transaction tường minh (xem lib/db.js). KHÔNG BAO GIỜ log
  // PHF_HR_DB_RUNTIME_PASSWORD — chỉ maskLen() như các secret khác.
  const PHF_HR_DB_HOST = process.env.PHF_HR_DB_HOST || devEnv.PHF_HR_DB_HOST || serviceEnv.PHF_HR_DB_HOST || '';
  const PHF_HR_DB_PORT = Number(process.env.PHF_HR_DB_PORT || devEnv.PHF_HR_DB_PORT || serviceEnv.PHF_HR_DB_PORT || 5432);
  const PHF_HR_DB_NAME = process.env.PHF_HR_DB_NAME || devEnv.PHF_HR_DB_NAME || serviceEnv.PHF_HR_DB_NAME || '';
  const PHF_HR_DB_RUNTIME_USER = process.env.PHF_HR_DB_RUNTIME_USER || devEnv.PHF_HR_DB_RUNTIME_USER || serviceEnv.PHF_HR_DB_RUNTIME_USER || '';
  const PHF_HR_DB_RUNTIME_PASSWORD = process.env.PHF_HR_DB_RUNTIME_PASSWORD || devEnv.PHF_HR_DB_RUNTIME_PASSWORD || serviceEnv.PHF_HR_DB_RUNTIME_PASSWORD || '';

  // Gate 5.6A — attachment storage root (G5.3 CLOSED design: attachment-
  // storage.js KHÔNG tự đọc process.env, root PHẢI do caller/config truyền
  // vào). QUYẾT ĐỊNH (audit): repo KHÔNG có feature-flag nào cho "attachment
  // routes enabled/disabled" ở đâu cả (grep xác nhận) — server.js LUÔN wire
  // 3 route upload/download/remove vô điều kiện mỗi lần boot (từ G5.6), nên
  // KHÔNG có phạm vi "chỉ bắt buộc khi feature bật" để tách riêng — chọn
  // phương án A: bắt buộc LUÔN LUÔN khi boot, cùng nhóm validate bắt buộc với
  // PHF_HR_DB_* phía trên (không phát minh field/flag mới ngoài phạm vi GO).
  const PHF_HR_ATTACHMENT_ROOT_RAW = process.env.PHF_HR_ATTACHMENT_ROOT || devEnv.PHF_HR_ATTACHMENT_ROOT || serviceEnv.PHF_HR_ATTACHMENT_ROOT || '';
  let PHF_HR_ATTACHMENT_ROOT = '';
  let attachmentRootError = '';
  if (!PHF_HR_ATTACHMENT_ROOT_RAW.trim()) {
    attachmentRootError = 'Thiếu PHF_HR_ATTACHMENT_ROOT — bắt buộc vì service LUÔN wire attachment routes (upload/download/remove) khi boot, không có cách tắt riêng.';
  } else {
    const trimmedRoot = PHF_HR_ATTACHMENT_ROOT_RAW.trim();
    if (!path.isAbsolute(trimmedRoot)) {
      attachmentRootError = 'PHF_HR_ATTACHMENT_ROOT phải là absolute path (đường dẫn tương đối không được chấp nhận).';
    } else {
      const normalizedRoot = path.normalize(trimmedRoot);
      // Chặn "quá rộng": root chính là filesystem root ('/', 'C:\', ...) —
      // path.parse(x).root === x đúng CHỈ KHI x tự nó đã là root, KHÔNG hề
      // có subpath riêng nào để cô lập attachment storage.
      if (normalizedRoot === path.parse(normalizedRoot).root) {
        attachmentRootError = 'PHF_HR_ATTACHMENT_ROOT không được là filesystem root (vd "/") — phạm vi quá rộng, không an toàn để làm attachment storage root.';
      } else {
        // path.normalize() giữ nguyên trailing separator nếu input có (KHÔNG
        // tự strip) — cắt bỏ ở đây để có 1 dạng canonical DUY NHẤT, tránh
        // 2 giá trị hợp lệ khác nhau ("/a/b" và "/a/b/") cùng trỏ 1 nơi.
        PHF_HR_ATTACHMENT_ROOT = normalizedRoot.endsWith(path.sep) ? normalizedRoot.slice(0, -path.sep.length) : normalizedRoot;
      }
    }
  }

  const errors = [];
  if (!SUPABASE_URL) errors.push('Thiếu SUPABASE_URL — không tìm thấy trong .env.test (root repo) lẫn services/phf-hr-api/.env.');
  if (!SUPABASE_SECRET_KEY) errors.push('Thiếu SUPABASE_SECRET_KEY — không tìm thấy trong .env.test (root repo) lẫn services/phf-hr-api/.env.');
  if (!SERVICE_TOKEN) errors.push('Thiếu PHF_HR_API_SERVICE_TOKEN trong services/phf-hr-api/.env — service không có cách xác thực server-to-server nào an toàn nếu thiếu.');
  if (SERVICE_TOKEN && SERVICE_TOKEN.length < 32) errors.push('PHF_HR_API_SERVICE_TOKEN quá ngắn (<32 ký tự) — không đủ entropy cho service token.');
  if (!PHF_HR_DB_HOST) errors.push('Thiếu PHF_HR_DB_HOST trong services/phf-hr-api/.env.');
  if (!PHF_HR_DB_NAME) errors.push('Thiếu PHF_HR_DB_NAME trong services/phf-hr-api/.env.');
  if (!PHF_HR_DB_RUNTIME_USER) errors.push('Thiếu PHF_HR_DB_RUNTIME_USER trong services/phf-hr-api/.env.');
  if (!PHF_HR_DB_RUNTIME_PASSWORD) errors.push('Thiếu PHF_HR_DB_RUNTIME_PASSWORD trong services/phf-hr-api/.env.');
  if (attachmentRootError) errors.push(attachmentRootError);

  if (isProductionSupabaseUrl(SUPABASE_URL)) {
    errors.push('HARD STOP: SUPABASE_URL trỏ tới project ref TRÙNG với Production đã biết. Service này CHỈ được phép chạy với Supabase project DEV. Từ chối boot.');
  }

  return {
    ok: errors.length === 0,
    errors,
    SUPABASE_URL,
    SUPABASE_SECRET_KEY,
    SERVICE_TOKEN,
    DESCRIPTOR_SIGNING_SECRET,
    PORT,
    BIND_HOST,
    PHF_HR_DB_HOST,
    PHF_HR_DB_PORT,
    PHF_HR_DB_NAME,
    PHF_HR_DB_RUNTIME_USER,
    PHF_HR_DB_RUNTIME_PASSWORD,
    PHF_HR_ATTACHMENT_ROOT,
    summary: {
      supabaseUrl: maskLen(SUPABASE_URL),
      supabaseSecretKey: maskLen(SUPABASE_SECRET_KEY),
      serviceToken: maskLen(SERVICE_TOKEN),
      descriptorSigningSecret: maskLen(DESCRIPTOR_SIGNING_SECRET),
      port: PORT,
      bindHost: BIND_HOST,
      devEnvSource: ROOT_ENV_TEST,
      serviceEnvSource: SERVICE_ENV,
      // KHÔNG log full path (Technical Lead chỉ định "không log path nội bộ
      // quá chi tiết") — chỉ set/missing + độ dài, cùng cách xử lý secret.
      phfHrAttachmentRoot: maskLen(PHF_HR_ATTACHMENT_ROOT),
      phfHrDbHost: PHF_HR_DB_HOST || '(missing)',
      phfHrDbPort: PHF_HR_DB_PORT,
      phfHrDbName: PHF_HR_DB_NAME || '(missing)',
      phfHrDbRuntimeUser: PHF_HR_DB_RUNTIME_USER || '(missing)',
      phfHrDbRuntimePassword: maskLen(PHF_HR_DB_RUNTIME_PASSWORD),
    },
  };
}

module.exports = { loadConfig, PRODUCTION_PROJECT_REF_FRAGMENT };
