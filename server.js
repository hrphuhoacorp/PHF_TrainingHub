const http = require('http');
const fs = require('fs');
const path = require('path');
const { readData, saveData } = require('./lib/db');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) { req.destroy(); reject(new Error('Payload quá lớn')); }
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
    '.svg': 'image/svg+xml; charset=utf-8'
  }[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function safeStaticPath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const requested = clean === '/' ? '/index.html' : clean;
  const filePath = path.normalize(path.join(ROOT, requested));
  if (!filePath.startsWith(ROOT)) return null;
  // Không serve các file nhạy cảm
  const blocked = ['.env', '.json', 'server.js', 'lib/', 'scripts/', 'api/'];
  if (blocked.some(b => filePath.includes(b))) return null;
  return filePath;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/data') {
      const data = await readData();
      return sendJson(res, 200, data);
    }

    if (req.method === 'POST' && req.url === '/api/data') {
      const body = await readBody(req);
      const payload = JSON.parse(body || '{}');
      const result = await saveData(payload);
      return sendJson(res, 200, result);
    }

    const filePath = safeStaticPath(req.url || '/');
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 - Không tìm thấy');
    }
    res.writeHead(200, { 'Content-Type': getMime(filePath) });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`PHF Training Hub: http://localhost:${PORT}`);
  console.log('Dữ liệu lưu trên Supabase.');
});
