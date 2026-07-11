'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const ROOT = path.resolve(__dirname, '..');
const PRIVATE_DIR = path.resolve(
  String(process.env.PHF_PRIVATE_DIR || '').trim() || path.join(ROOT, 'private')
);
const ACCOUNTS_FILE = path.join(PRIVATE_DIR, 'accounts.json');
const SECRET_FILE = path.join(PRIVATE_DIR, 'session-secret.txt');
const COOKIE_NAME = 'phf_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PASSWORD_ITERATIONS = 120000;

const hasSupabaseEnv = Boolean(
  String(process.env.SUPABASE_URL || '').trim() &&
  String(process.env.SUPABASE_SECRET_KEY || '').trim()
);
const allowFileAccounts = String(process.env.PHF_ALLOW_FILE_ACCOUNTS || '').trim().toLowerCase() === 'true';

let supabase = null;
if (hasSupabaseEnv) {
  supabase = createClient(
    String(process.env.SUPABASE_URL).trim(),
    String(process.env.SUPABASE_SECRET_KEY).trim(),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

function ensurePrivateDir(){ fs.mkdirSync(PRIVATE_DIR, { recursive:true }); }
function cleanEmail(v){ return String(v || '').trim().toLowerCase(); }
function cleanPhone(v){ return String(v || '').replace(/\D/g, ''); }
function cleanRole(v){
  const role = String(v || 'learner').trim().toLowerCase();
  return ['learner','manager','admin'].includes(role) ? role : 'learner';
}
function cleanStatus(v){
  const status = String(v || 'active').trim().toLowerCase();
  return ['active','locked','inactive'].includes(status) ? status : 'active';
}
function safeEqual(a,b){
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function hashPassword(password, salt, iterations){
  const finalSalt = salt || crypto.randomBytes(16).toString('hex');
  const rounds = Math.max(Number(iterations) || PASSWORD_ITERATIONS, 100000);
  const hash = crypto.pbkdf2Sync(
    String(password || ''),
    finalSalt,
    rounds,
    32,
    'sha256'
  ).toString('hex');
  return { salt: finalSalt, hash, iterations: rounds };
}
function verifyPassword(password, account){
  if (!account || !account.passwordHash || !account.passwordSalt) return false;
  const result = hashPassword(password, account.passwordSalt, account.passwordIterations);
  return safeEqual(result.hash, account.passwordHash);
}
function publicAccount(a){
  return {
    id:a.id,
    employeeId:a.employeeId || '',
    employeeCode:a.employeeCode || '',
    name:a.name || '',
    email:a.email || '',
    phone:a.phone || '',
    role:a.role || 'learner',
    status:a.status || 'active',
    branch:a.branch || '',
    department:a.department || '',
    position:a.position || '',
    trainingAudience:a.trainingAudience || '',
    defaultProgram:a.defaultProgram || '',
    mustChangePassword:!!a.mustChangePassword
  };
}
function normalizeAccount(input, old){
  const a = input || {};
  const previous = old || {};
  const id = String(previous.id || a.id || `acct-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`);
  const out = {
    id,
    employeeId:String(a.employeeId || a.linkedEmployeeId || previous.employeeId || ''),
    employeeCode:String(a.employeeCode || previous.employeeCode || ''),
    name:String(a.name || a.fullName || previous.name || a.email || ''),
    email:cleanEmail(a.email || previous.email),
    phone:cleanPhone(a.phone || a.mobile || previous.phone),
    role:cleanRole(a.role || previous.role),
    status:cleanStatus(a.status || previous.status),
    branch:String(a.branch || a.location || previous.branch || ''),
    department:String(a.department || previous.department || ''),
    position:String(a.position || previous.position || ''),
    trainingAudience:String(a.trainingAudience || a.audience || previous.trainingAudience || ''),
    defaultProgram:String(a.defaultProgram || a.program || previous.defaultProgram || ''),
    mustChangePassword:!!(a.mustChangePassword ?? previous.mustChangePassword),
    passwordAlgorithm:String(previous.passwordAlgorithm || a.passwordAlgorithm || 'pbkdf2-sha256'),
    passwordIterations:Number(previous.passwordIterations || a.passwordIterations || PASSWORD_ITERATIONS),
    passwordSalt:String(previous.passwordSalt || a.passwordSalt || ''),
    passwordHash:String(previous.passwordHash || a.passwordHash || ''),
    createdAt:String(previous.createdAt || a.createdAt || new Date().toISOString()),
    updatedAt:new Date().toISOString(),
    metadata:{...(previous.metadata || {}), ...(a.metadata || {})}
  };

  const raw = String(a.password || a.tempPassword || '');
  if (raw) {
    const hashed = hashPassword(raw);
    out.passwordSalt = hashed.salt;
    out.passwordHash = hashed.hash;
    out.passwordIterations = hashed.iterations;
    out.passwordAlgorithm = 'pbkdf2-sha256';
  }
  return out;
}
function dbRowToAccount(row){
  if (!row) return null;
  return {
    id:String(row.id || ''),
    employeeId:String(row.employee_id || ''),
    employeeCode:String(row.employee_code || ''),
    name:String(row.name || ''),
    email:cleanEmail(row.email),
    phone:cleanPhone(row.phone),
    role:cleanRole(row.role),
    status:cleanStatus(row.status),
    branch:String(row.branch || ''),
    department:String(row.department || ''),
    position:String(row.position || ''),
    trainingAudience:String(row.training_audience || ''),
    defaultProgram:String(row.default_program || ''),
    mustChangePassword:!!row.must_change_password,
    passwordAlgorithm:String(row.password_algorithm || 'pbkdf2-sha256'),
    passwordIterations:Number(row.password_iterations || PASSWORD_ITERATIONS),
    passwordSalt:String(row.password_salt || ''),
    passwordHash:String(row.password_hash || ''),
    lastLoginAt:String(row.last_login_at || ''),
    passwordChangedAt:String(row.password_changed_at || ''),
    createdAt:String(row.created_at || ''),
    updatedAt:String(row.updated_at || ''),
    metadata:row.metadata || {}
  };
}
function accountToDbRow(account){
  return {
    id:account.id,
    employee_id:account.employeeId || null,
    employee_code:account.employeeCode || '',
    name:account.name || account.email,
    email:cleanEmail(account.email),
    phone:cleanPhone(account.phone),
    role:cleanRole(account.role),
    status:cleanStatus(account.status),
    branch:account.branch || '',
    department:account.department || '',
    position:account.position || '',
    training_audience:account.trainingAudience || '',
    default_program:account.defaultProgram || '',
    must_change_password:!!account.mustChangePassword,
    password_algorithm:account.passwordAlgorithm || 'pbkdf2-sha256',
    password_iterations:Number(account.passwordIterations || PASSWORD_ITERATIONS),
    password_salt:account.passwordSalt,
    password_hash:account.passwordHash,
    created_at:account.createdAt || new Date().toISOString(),
    updated_at:new Date().toISOString(),
    metadata:account.metadata || {}
  };
}

function ensureFileStore(){
  if (!allowFileAccounts) {
    throw new Error('Kho tài khoản dạng file đang tắt. Hãy cấu hình Supabase hoặc PHF_ALLOW_FILE_ACCOUNTS=true để chạy local.');
  }
  ensurePrivateDir();
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    fs.writeFileSync(
      ACCOUNTS_FILE,
      JSON.stringify({version:2,bootstrapped:false,accounts:[]}, null, 2)
    );
  }
}
function readFileStore(){
  ensureFileStore();
  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  } catch {
    return {version:2,bootstrapped:false,accounts:[]};
  }
}
function writeFileStore(store){
  ensurePrivateDir();
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(store, null, 2));
}

async function getAccountByEmail(email){
  const normalized = cleanEmail(email);
  if (!normalized) return null;

  if (supabase) {
    const { data, error } = await supabase
      .from('user_accounts')
      .select('*')
      .eq('email', normalized)
      .maybeSingle();
    if (error) throw error;
    return dbRowToAccount(data);
  }

  const store = readFileStore();
  return (store.accounts || []).find(a => cleanEmail(a.email) === normalized) || null;
}
async function getAccountById(id){
  const accountId = String(id || '').trim();
  if (!accountId) return null;

  if (supabase) {
    const { data, error } = await supabase
      .from('user_accounts')
      .select('*')
      .eq('id', accountId)
      .maybeSingle();
    if (error) throw error;
    return dbRowToAccount(data);
  }

  const store = readFileStore();
  return (store.accounts || []).find(a => String(a.id || '') === accountId) || null;
}

function getSecret(){
  const env = String(process.env.PHF_SESSION_SECRET || '').trim();
  if (env) return env;

  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    throw new Error('Thiếu PHF_SESSION_SECRET trên môi trường production.');
  }

  ensurePrivateDir();
  if (!fs.existsSync(SECRET_FILE)) {
    fs.writeFileSync(SECRET_FILE, crypto.randomBytes(48).toString('hex'));
  }
  return fs.readFileSync(SECRET_FILE, 'utf8').trim();
}
function b64url(input){ return Buffer.from(input).toString('base64url'); }
function sign(value){ return crypto.createHmac('sha256', getSecret()).update(value).digest('base64url'); }
function makeSession(account){
  const payload = {
    v:2,
    sub:account.id,
    email:account.email,
    role:account.role,
    phone:account.phone || '',
    employeeId:account.employeeId || '',
    iat:Date.now(),
    exp:Date.now() + SESSION_TTL_MS,
    nonce:crypto.randomBytes(8).toString('hex')
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}
function parseCookies(req){
  const out = {};
  String(req.headers && req.headers.cookie || '').split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index > 0) {
      out[part.slice(0,index).trim()] = decodeURIComponent(part.slice(index+1).trim());
    }
  });
  return out;
}
async function readSession(req){
  try {
    const token = parseCookies(req)[COOKIE_NAME] || '';
    const [body, signature] = token.split('.');
    if (!body || !signature || !safeEqual(sign(body), signature)) return null;

    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;

    const account = await getAccountById(payload.sub);
    if (!account || account.email !== payload.email) return null;
    if (account.status !== 'active' || account.role !== payload.role) return null;

    return {...payload, account:publicAccount(account)};
  } catch (error) {
    console.warn('[PHF Auth] readSession:', error && error.message ? error.message : error);
    return null;
  }
}
function cookieHeader(token){
  const secure = String(process.env.NODE_ENV || '').toLowerCase() === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS/1000)}${secure}`;
}
function clearCookieHeader(){
  const secure = String(process.env.NODE_ENV || '').toLowerCase() === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

async function login(email, password){
  const account = await getAccountByEmail(email);
  if (!account) return {ok:false,code:'ACCOUNT_NOT_FOUND',message:'Không tìm thấy tài khoản này.'};
  if (account.status === 'locked') return {ok:false,code:'ACCOUNT_LOCKED',message:'Tài khoản này đang tạm khóa.'};
  if (account.status !== 'active') return {ok:false,code:'ACCOUNT_INACTIVE',message:'Tài khoản này đã ngừng sử dụng.'};
  if (!verifyPassword(password, account)) return {ok:false,code:'PASSWORD_INVALID',message:'Mật khẩu chưa đúng.'};

  if (supabase) {
    const { error } = await supabase
      .from('user_accounts')
      .update({last_login_at:new Date().toISOString()})
      .eq('id', account.id);
    if (error) console.warn('[PHF Auth] Không cập nhật được last_login_at:', error.message);
  }

  return {ok:true,token:makeSession(account),user:publicAccount(account)};
}

async function syncAccounts(list){
  const incoming = Array.isArray(list) ? list : [];

  if (supabase) {
    const { data:existingRows, error:readError } = await supabase
      .from('user_accounts')
      .select('*');
    if (readError) throw readError;

    const oldByEmail = new Map(
      (existingRows || []).map(row => {
        const account = dbRowToAccount(row);
        return [account.email, account];
      })
    );

    const rows = [];
    for (const item of incoming) {
      const email = cleanEmail(item && item.email);
      if (!email) continue;
      const old = oldByEmail.get(email) || null;
      const normalized = normalizeAccount(item, old);
      if (!normalized.passwordHash || !normalized.passwordSalt) continue;
      rows.push(accountToDbRow(normalized));
    }

    if (rows.length) {
      const { error } = await supabase
        .from('user_accounts')
        .upsert(rows, {onConflict:'id'});
      if (error) throw error;
    }

    const { data:finalRows, error:finalError } = await supabase
      .from('user_accounts')
      .select('*')
      .order('name', {ascending:true});
    if (finalError) throw finalError;
    return (finalRows || []).map(dbRowToAccount).map(publicAccount);
  }

  const store = readFileStore();
  const oldMap = new Map((store.accounts || []).map(a => [cleanEmail(a.email), a]));
  const accounts = incoming
    .map(a => normalizeAccount(a, oldMap.get(cleanEmail(a && a.email))))
    .filter(a => a.email && a.passwordHash && a.passwordSalt);
  store.accounts = accounts;
  store.bootstrapped = true;
  store.updatedAt = new Date().toISOString();
  writeFileStore(store);
  return accounts.map(publicAccount);
}

async function bootstrapFromLocal(req, list){
  if (supabase) return false;
  const remote = String(req.socket && req.socket.remoteAddress || '');
  const local = /127\.0\.0\.1|::1|::ffff:127\.0\.0\.1/.test(remote);
  if (!local || !allowFileAccounts) return false;
  const store = readFileStore();
  if (store.bootstrapped) return false;
  await syncAccounts(list);
  return true;
}
async function requireSession(req, roles){
  const session = await readSession(req);
  if (!session) {
    const error = new Error('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    error.statusCode = 401;
    error.code = 'AUTH_REQUIRED';
    throw error;
  }
  if (roles && roles.length && !roles.includes(session.role)) {
    const error = new Error('Tài khoản không có quyền thực hiện thao tác này.');
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }
  return session;
}
function matchesOwnEmployee(session, employee){
  const target = employee || {};
  const sessionId = String(session.employeeId || '').trim();
  const employeeId = String(target.id || target.employeeId || '').trim();
  const sessionPhone = cleanPhone(session.phone);
  const employeePhone = cleanPhone(target.phone);
  return !!(
    (sessionId && employeeId && sessionId === employeeId) ||
    (sessionPhone && employeePhone && sessionPhone === employeePhone)
  );
}
function authorizePayload(session, payload){
  const data = payload || {};
  if (session.role === 'admin') {
    data.adminMode = true;
    data.managerMode = false;
    return data;
  }
  if (session.role === 'manager') {
    if (data.action === 'deleteEmployee') {
      const error = new Error('Chỉ Admin được xóa học viên.');
      error.statusCode = 403;
      error.code = 'ADMIN_REQUIRED';
      throw error;
    }
    data.adminMode = false;
    data.managerMode = true;
    return data;
  }
  if (['deleteEmployee','saveProbation','resolveNotification'].includes(data.action)) {
    const error = new Error('Học viên không có quyền thực hiện thao tác này.');
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }
  if (['markNotificationRead','markAllNotificationsRead'].includes(data.action)) {
    data.adminMode = false;
    data.managerMode = false;
    return data;
  }
  if (!matchesOwnEmployee(session, data.employee)) {
    const error = new Error('Học viên chỉ được cập nhật dữ liệu của chính mình.');
    error.statusCode = 403;
    error.code = 'EMPLOYEE_SCOPE_FORBIDDEN';
    throw error;
  }
  data.adminMode = false;
  data.managerMode = false;
  return data;
}

module.exports = {
  COOKIE_NAME,
  login,
  readSession,
  requireSession,
  cookieHeader,
  clearCookieHeader,
  syncAccounts,
  bootstrapFromLocal,
  authorizePayload,
  publicAccount,
  cleanPhone,
  cleanEmail,
  hashPassword,
  dbRowToAccount,
  accountToDbRow,
  hasSupabaseEnv
};
