'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { readData, saveData } = require('./lib/db');
const {
  MAX_BODY_BYTES,
  RequestError,
  assertSameOrigin,
  assertJsonContentType,
  assertContentLength,
  validatePayload,
  publicError
} = require('./lib/request-guard');

const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(__dirname);

function baseHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
    ...extra
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, baseHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      size += Buffer.byteLength(chunk, 'utf8');
      if (size > MAX_BODY_BYTES) {
        reject(new RequestError('Dữ liệu gửi lên vượt quá giới hạn cho phép.', 413, 'PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function getMime(filePath) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
    '.webmanifest': 'application/manifest+json',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function safeStaticPath(rawUrl) {
  let clean;
  try { clean = decodeURIComponent(String(rawUrl || '/').split('?')[0]); }
  catch { return null; }
  const requested = clean === '/' ? '/index.html' : clean;
  const relative = requested.replace(/^[/\\]+/, '');
  const segments = relative.split(/[\\/]+/).filter(Boolean);
  const blockedSegments = new Set(['.git', 'api', 'lib', 'scripts', 'node_modules', 'backups']);
  if (segments.some(segment => blockedSegments.has(segment.toLowerCase()))) return null;
  const blockedFiles = new Set(['.env', 'data.json', 'server.js', 'package-lock.json', 'package.json']);
  if (segments.some(segment => segment.startsWith('.')) || blockedFiles.has(String(segments.at(-1) || '').toLowerCase())) return null;
  const filePath = path.resolve(ROOT, relative);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) return null;
  return filePath;
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = String(req.url || '/').split('?')[0];

    if (pathname === '/api/data') {
      assertSameOrigin(req);
      if (req.method === 'GET') {
        const data = await readData();
        return sendJson(res, 200, data);
      }
      if (req.method === 'POST') {
        assertJsonContentType(req);
        assertContentLength(req);
        const body = await readBody(req);
        let payload;
        try { payload = JSON.parse(body || '{}'); }
        catch { throw new RequestError('Dữ liệu JSON không hợp lệ.', 400, 'JSON_INVALID'); }
        validatePayload(payload);
        const result = await saveData(payload);
        return sendJson(res, 200, result);
      }
      res.setHeader('Allow', 'GET, POST');
      return sendJson(res, 405, { ok: false, error: 'Phương thức không được hỗ trợ.', code: 'METHOD_NOT_ALLOWED' });
    }

    if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
      return sendJson(res, 405, { ok: false, error: 'Phương thức không được hỗ trợ.', code: 'METHOD_NOT_ALLOWED' });
    }

    const filePath = safeStaticPath(req.url || '/');
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, baseHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
      return res.end('404 - Không tìm thấy');
    }
    const stat = fs.statSync(filePath);
    const headers = baseHeaders({
      'Content-Type': getMime(filePath),
      'Content-Length': stat.size,
      'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=3600'
    });
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('[PHF API]', err?.code || err?.name || 'ERROR', err?.message || err);
    const response = publicError(err);
    sendJson(res, response.status, response.body);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`PHF Training Hub: http://localhost:${PORT}`);
  const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
  const allowLocalData = String(process.env.PHF_ALLOW_LOCAL_DATA || '').trim().toLowerCase() === 'true';
  if (hasSupabase) console.log('Dữ liệu lưu trên Supabase.');
  else if (allowLocalData) console.warn('Dữ liệu đang lưu local theo PHF_ALLOW_LOCAL_DATA=true. Chỉ dùng khi chủ động chạy thử.');
  else console.error('Thiếu cấu hình Supabase: API dữ liệu sẽ báo lỗi rõ ràng và không tự lưu sang data.json.');
});
