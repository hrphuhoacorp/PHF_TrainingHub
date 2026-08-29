'use strict';

// Structured logger tối giản — KHÔNG dùng thư viện ngoài (đúng convention
// "no dependency" của repo chính). Luôn strip các key nhạy cảm trước khi log,
// phòng thủ ngay cả khi caller vô tình truyền field không nên log.

const SENSITIVE_KEYS = new Set([
  'authorization', 'token', 'secret', 'key', 'password', 'apikey',
  'supabase_secret_key', 'phf_hr_api_service_token',
]);

function sanitize(fields) {
  if (!fields || typeof fields !== 'object') return fields;
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object') {
      out[k] = sanitize(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function log(level, event, fields) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...sanitize(fields || {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  info: (event, fields) => log('info', event, fields),
  warn: (event, fields) => log('warn', event, fields),
  error: (event, fields) => log('error', event, fields),
};
