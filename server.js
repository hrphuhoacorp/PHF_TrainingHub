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
const { login, readSession, requireSession, cookieHeader, clearCookieHeader, syncAccounts, bootstrapFromLocal, authorizePayload } = require('./lib/auth');

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
  const blockedSegments = new Set(['.git', 'api', 'lib', 'scripts', 'node_modules', 'backups', 'private']);
  if (segments.some(segment => blockedSegments.has(segment.toLowerCase()))) return null;
  const blockedFiles = new Set(['.env', 'data.json', 'server.js', 'package-lock.json', 'package.json']);
  if (segments.some(segment => segment.startsWith('.')) || blockedFiles.has(String(segments.at(-1) || '').toLowerCase())) return null;
  const filePath = path.resolve(ROOT, relative);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) return null;
  return filePath;
}


function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function filterDataForRequest(data, scope, employeeId, phone) {
  if (String(scope || '').toLowerCase() !== 'learner') return data;
  const id = String(employeeId || '').trim();
  const cleanPhone = normalizePhone(phone);
  const employees = Array.isArray(data.employees) ? data.employees : [];
  const own = employees.find(e =>
    (id && String(e.id || '') === id) ||
    (cleanPhone && normalizePhone(e.phone) === cleanPhone)
  );
  const ownId = own ? String(own.id || '') : id;
  const sameEmployee = row => row && ownId && String(row.employeeId || row.employee_id || '') === ownId;
  return {
    settings: data.settings || {},
    employees: own ? [own] : [],
    progress: ownId && data.progress ? { [ownId]: data.progress[ownId] || {} } : {},
    testResults: (data.testResults || []).filter(sameEmployee),
    activityLog: (data.activityLog || []).filter(sameEmployee),
    activityLogMeta: {
      ...(data.activityLogMeta || {}),
      scope: 'employee'
    },
    evaluationRecords: (data.evaluationRecords || []).filter(sameEmployee),
    confidentialityCommitments: (data.confidentialityCommitments || []).filter(sameEmployee),
    probationRecords: (data.probationRecords || []).filter(sameEmployee),
    systemNotifications: (data.systemNotifications || []).filter(sameEmployee)
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = String(req.url || '/').split('?')[0];

    if (pathname === '/api/auth/session' && req.method === 'GET') {
      const session = readSession(req);
      return sendJson(res, 200, { ok:true, authenticated:!!session, user:session ? session.account : null });
    }
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
      const raw = await readBody(req); let body={};
      try { body=JSON.parse(raw||'{}'); } catch { throw new RequestError('Dữ liệu đăng nhập không hợp lệ.',400,'JSON_INVALID'); }
      let result=login(body.email, body.password);
      if(!result.ok && Array.isArray(body.localAccounts) && bootstrapFromLocal(req, body.localAccounts)) result=login(body.email, body.password);
      if(!result.ok) return sendJson(res, 401, {ok:false,error:result.message,code:result.code});
      res.setHeader('Set-Cookie', cookieHeader(result.token));
      return sendJson(res, 200, {ok:true,user:result.user});
    }
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      assertSameOrigin(req); res.setHeader('Set-Cookie', clearCookieHeader());
      return sendJson(res, 200, {ok:true});
    }
    if (pathname === '/api/auth/accounts/sync' && req.method === 'POST') {
      assertSameOrigin(req); const session=requireSession(req,['admin']);
      assertJsonContentType(req); assertContentLength(req);
      const raw=await readBody(req); let body={};
      try{body=JSON.parse(raw||'{}')}catch{throw new RequestError('Dữ liệu tài khoản không hợp lệ.',400,'JSON_INVALID')}
      const accounts=syncAccounts(body.accounts||[]);
      return sendJson(res,200,{ok:true,count:accounts.length});
    }

    if (pathname === '/api/data') {
      assertSameOrigin(req);
      if (req.method === 'GET') {
        const session = requireSession(req, ['learner','manager','admin']);
        const data = await readData({
          role: session.role,
          employeeId: session.role === 'learner' ? session.employeeId : '',
          activityLimit: session.role === 'learner' ? 100 : 200
        });
        const scoped = session.role === 'learner'
          ? filterDataForRequest(data, 'learner', session.employeeId, session.phone)
          : data;
        return sendJson(res, 200, scoped);
      }
      if (req.method === 'POST') {
        assertJsonContentType(req);
        assertContentLength(req);
        const body = await readBody(req);
        let payload;
        try { payload = JSON.parse(body || '{}'); }
        catch { throw new RequestError('Dữ liệu JSON không hợp lệ.', 400, 'JSON_INVALID'); }
        const session = requireSession(req, ['learner','manager','admin']);
        payload = authorizePayload(session, payload);
        payload.actorName = session.account?.name || session.account?.email || '';
        validatePayload(payload);
        const result = await saveData(payload);
        if (result && result.data && session.role === 'learner') {
          result.data = filterDataForRequest(result.data, 'learner', session.employeeId, session.phone);
        }
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
