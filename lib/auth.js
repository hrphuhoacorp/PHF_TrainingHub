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
function cleanHubAssignmentStatus(v, trainingAudience){
  const raw = String(v || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const aliases = {
    not_active:'not_activated',
    inactive:'not_activated',
    not_activated:'not_activated',
    active:'active',
    in_progress:'active',
    studying:'active',
    paused:'paused',
    completed:'completed',
    revoked:'revoked'
  };
  if (aliases[raw]) return aliases[raw];
  return String(trainingAudience || '').trim() === 'Nhân sự mới' ? 'active' : 'not_activated';
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
    hubAssignmentStatus:cleanHubAssignmentStatus(a.hubAssignmentStatus, a.trainingAudience),
    mustChangePassword:!!a.mustChangePassword,
    accountType:String((a.metadata && a.metadata.accountType) || a.accountType || 'employee')
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
    hubAssignmentStatus:cleanHubAssignmentStatus(a.hubAssignmentStatus || a.hub_assignment_status || previous.hubAssignmentStatus, a.trainingAudience || a.audience || previous.trainingAudience),
    mustChangePassword:!!(a.mustChangePassword ?? previous.mustChangePassword),
    passwordAlgorithm:String(previous.passwordAlgorithm || a.passwordAlgorithm || 'pbkdf2-sha256'),
    passwordIterations:Number(previous.passwordIterations || a.passwordIterations || PASSWORD_ITERATIONS),
    passwordSalt:String(previous.passwordSalt || a.passwordSalt || ''),
    passwordHash:String(previous.passwordHash || a.passwordHash || ''),
    createdAt:String(previous.createdAt || a.createdAt || new Date().toISOString()),
    updatedAt:new Date().toISOString(),
    metadata:{...(previous.metadata || {}), ...(a.metadata || {})}
  };
  if (a.accountType) out.metadata.accountType = String(a.accountType);

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
    hubAssignmentStatus:cleanHubAssignmentStatus(row.hub_assignment_status || (row.metadata && row.metadata.hubAssignmentStatus), row.training_audience),
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
    hub_assignment_status:cleanHubAssignmentStatus(account.hubAssignmentStatus, account.trainingAudience),
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

/* Bulk employeeCode lookup by account id — THUẦN READ, dùng cho các màn
 * nghiệp vụ (vd KNL Đề xuất nâng bậc) cần hiển thị mã nhân viên CHUẨN
 * (PHFxxx, user_accounts.employee_code) của người tạo/actor thay vì
 * employeeId nội bộ (Training Hub). Trả {accountId: employeeCode}, bỏ qua
 * account không có employee_code (caller tự quyết định fallback — KHÔNG bao
 * giờ fallback về employeeId ở đây). */
async function getEmployeeCodesByAccountIds(ids){
  const list = Array.from(new Set((ids || []).map(id => String(id || '').trim()).filter(Boolean)));
  if (!list.length) return {};
  const map = {};
  if (supabase) {
    const { data, error } = await supabase.from('user_accounts').select('id,employee_code').in('id', list);
    if (error) throw error;
    (data || []).forEach(row => { if (row.employee_code) map[String(row.id)] = String(row.employee_code); });
    return map;
  }
  const store = readFileStore();
  (store.accounts || []).forEach(a => {
    if (list.includes(String(a.id || '')) && a.employeeCode) map[String(a.id)] = String(a.employeeCode);
  });
  return map;
}

async function resolveUniqueEmployeeIdByPhone(phone){
  const normalizedPhone = cleanPhone(phone);
  if (normalizedPhone.length < 8) return '';

  if (supabase) {
    let rows = [];
    const exact = await supabase
      .from('employees')
      .select('id,phone')
      .eq('phone', normalizedPhone)
      .limit(3);
    if (!exact.error) rows = exact.data || [];
    if (exact.error && !/column|schema cache|could not find|phone/i.test(exact.error.message || '')) {
      console.warn('[PHF Auth] Không thể đối chiếu hồ sơ theo SĐT:', exact.error.message || exact.error);
      return '';
    }
    const matches = rows.filter(row => cleanPhone(row && row.phone) === normalizedPhone);
    return matches.length === 1 ? String(matches[0].id || '').trim() : '';
  }

  try {
    const dataFile = path.join(ROOT, 'data.json');
    if (!fs.existsSync(dataFile)) return '';
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const matches = (Array.isArray(data.employees) ? data.employees : [])
      .filter(row => cleanPhone(row && row.phone) === normalizedPhone);
    return matches.length === 1 ? String(matches[0].id || '').trim() : '';
  } catch (error) {
    console.warn('[PHF Auth] Không thể đọc hồ sơ Local để liên kết tài khoản:', error && error.message ? error.message : error);
    return '';
  }
}
function normalizeEmployeeCodeForId(value){
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

async function employeeExistsById(employeeId){
  const id = String(employeeId || '').trim();
  if (!id) return false;
  if (supabase) {
    const { data, error } = await supabase.from('employees').select('id').eq('id', id).limit(1);
    if (error) throw error;
    return Array.isArray(data) && data.length === 1;
  }
  try {
    const dataFile = path.join(ROOT, 'data.json');
    if (!fs.existsSync(dataFile)) return false;
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return (Array.isArray(data.employees) ? data.employees : []).some(row => String(row && row.id || '') === id);
  } catch (_) { return false; }
}

async function resolveUniqueEmployeeIdByPhoneStrict(phone){
  const normalizedPhone = cleanPhone(phone);
  if (!normalizedPhone) return '';
  if (supabase) {
    const { data, error } = await supabase.from('employees').select('id,phone');
    if (error) throw error;
    const matches = (data || []).filter(row => cleanPhone(row && row.phone) === normalizedPhone);
    return matches.length === 1 ? String(matches[0].id || '').trim() : '';
  }
  return resolveUniqueEmployeeIdByPhone(normalizedPhone);
}

function cleanEmployeeTrainingScope(value){
  const scope = String(value || '').trim().toLowerCase();
  return scope === 'new_sales' || scope === 'phf_class' ? scope : '';
}
function requireEmployeeTrainingScope(value){
  const scope = cleanEmployeeTrainingScope(value);
  if (!scope) {
    const error = new Error('Phạm vi đào tạo là bắt buộc. Vui lòng chọn Training Hub + PHF Classroom hoặc Chỉ PHF Classroom.');
    error.statusCode = 400;
    error.code = 'TRAINING_SCOPE_REQUIRED';
    throw error;
  }
  return scope;
}

async function createEmployeeProfileForAccount(account){
  if (!account || !supabase) return '';
  const employeeCode = String(account.employeeCode || '').trim();
  const phone = cleanPhone(account.phone);
  const codePart = normalizeEmployeeCodeForId(employeeCode);
  const phonePart = phone ? phone.replace(/\D/g, '') : '';
  const base = codePart || phonePart || crypto.randomUUID().slice(0, 12);
  let employeeId = `emp-${base}`;
  let suffix = 1;
  while (await employeeExistsById(employeeId)) {
    suffix += 1;
    employeeId = `emp-${base}-${suffix}`;
  }
  const row = {
    id: employeeId,
    full_name: String(account.name || '').trim() || employeeCode || 'Nhân viên PHF',
    phone: phone || null,
    branch: String(account.branch || '').trim() || 'Chưa phân chi nhánh',
    department: String(account.department || '').trim() || null,
    position: String(account.position || '').trim() || 'Nhân viên',
    program_id: requireEmployeeTrainingScope(account.defaultProgram),
    created_at: new Date().toISOString(),
    last_active_at: new Date().toISOString()
  };
  const { data, error } = await supabase.from('employees').insert(row).select('id').single();
  if (error) throw error;
  return String(data && data.id || employeeId).trim();
}

async function resolveEmployeeIdForAccount(account, options){
  if (!account) return '';
  const opts = options || {};
  const direct = String(account.employeeId || '').trim();
  let invalidDirect = '';
  if (direct) {
    if (await employeeExistsById(direct)) return direct;
    invalidDirect = direct;
  }

  const employeeCode = String(account.employeeCode || '').trim();
  if (supabase && employeeCode) {
    // Hỗ trợ dữ liệu cũ nơi employees.id chính là mã nhân viên.
    const byLegacyId = await supabase.from('employees').select('id').eq('id', employeeCode).limit(2);
    if (byLegacyId.error) throw byLegacyId.error;
    if (Array.isArray(byLegacyId.data) && byLegacyId.data.length === 1) {
      return String(byLegacyId.data[0].id || '').trim();
    }
  }

  const byPhone = await resolveUniqueEmployeeIdByPhoneStrict(account.phone);
  if (byPhone) return byPhone;

  if (opts.createIfMissing) return createEmployeeProfileForAccount(account);
  if (invalidDirect && opts.rejectInvalidDirect) {
    const error = new Error('Hồ sơ nhân viên được chọn không còn tồn tại. Vui lòng chọn lại nhân sự.');
    error.statusCode = 400;
    error.code = 'EMPLOYEE_LINK_INVALID';
    throw error;
  }
  return '';
}
function isStandaloneSystemAccount(account){
  if (!account) return false;
  const accountType = String(account.metadata && account.metadata.accountType || '').trim().toLowerCase();
  if (accountType === 'system_admin') return true;
  if (cleanEmail(account.email) === 'hr.phuhoacorp@gmail.com') return true;
  // Hỗ trợ các Admin hệ thống cũ chưa có metadata accountType.
  return cleanRole(account.role) === 'admin' &&
    !String(account.employeeCode || '').trim() &&
    !cleanPhone(account.phone) &&
    !String(account.employeeId || '').trim();
}

async function ensureLearnerEmployeeLink(account){
  // Giữ tên hàm cũ để không ảnh hưởng các nơi đang gọi, nhưng áp dụng cho mọi
  // tài khoản nhân sự. Chỉ tài khoản Admin hệ thống độc lập được phép không có employee_id.
  if (!account || isStandaloneSystemAccount(account)) return account;
  const employeeId = await resolveEmployeeIdForAccount(account, {createIfMissing:true, rejectInvalidDirect:false});
  if (!employeeId || employeeId === String(account.employeeId || '').trim()) return account;

  const updated = {...account, employeeId, updatedAt:new Date().toISOString()};
  if (supabase) {
    const { error } = await supabase
      .from('user_accounts')
      .update({employee_id:employeeId, updated_at:new Date().toISOString()})
      .eq('id', account.id);
    if (error) {
      console.warn('[PHF Auth] Không thể tự liên kết tài khoản với hồ sơ:', error.message || error);
      return account;
    }
    return updated;
  }

  const store = readFileStore();
  const index = (store.accounts || []).findIndex(item => String(item.id || '') === String(account.id || ''));
  if (index < 0) return account;
  store.accounts[index] = updated;
  store.updatedAt = new Date().toISOString();
  writeFileStore(store);
  return updated;
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
function makeSession(account, options){
  const sessionOptions = options || {};
  const payload = {
    v:2,
    sub:account.id,
    email:account.email,
    role:account.role,
    phone:account.phone || '',
    employeeId:account.employeeId || '',
    iat:Date.now(),
    exp:Date.now() + SESSION_TTL_MS,
    nonce:crypto.randomBytes(8).toString('hex'),
    pwdv:Number(account.metadata && account.metadata.passwordVersion || 0),
    provider:String(sessionOptions.provider || 'password')
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
    const passwordVersion = Number(account.metadata && account.metadata.passwordVersion || 0);
    if (Number(payload.pwdv || 0) !== passwordVersion) return null;

    return {
      ...payload,
      employeeId:String(account.employeeId || payload.employeeId || ''),
      phone:String(account.phone || payload.phone || ''),
      account:{...publicAccount(account), authProvider:String(payload.provider || 'password')}
    };
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
  let account = await getAccountByEmail(email);
  if (!account) return {ok:false,code:'ACCOUNT_NOT_FOUND',message:'Không tìm thấy tài khoản này.'};
  if (account.status === 'locked') return {ok:false,code:'ACCOUNT_LOCKED',message:'Tài khoản này đang tạm khóa.'};
  if (account.status !== 'active') return {ok:false,code:'ACCOUNT_INACTIVE',message:'Tài khoản này đã ngừng sử dụng.'};
  if (!verifyPassword(password, account)) return {ok:false,code:'PASSWORD_INVALID',message:'Mật khẩu chưa đúng.'};

  account = await ensureLearnerEmployeeLink(account);

  if (supabase) {
    const { error } = await supabase
      .from('user_accounts')
      .update({last_login_at:new Date().toISOString()})
      .eq('id', account.id);
    if (error) console.warn('[PHF Auth] Không cập nhật được last_login_at:', error.message);
  }

  return {ok:true,token:makeSession(account),user:publicAccount(account)};
}


const GOOGLE_CLIENT_ID = String(
  process.env.GOOGLE_CLIENT_ID ||
  '200519533754-vurcguk5um83admhrhd7kps6qjq7rrqs.apps.googleusercontent.com'
).trim();

function googleAuthError(message, statusCode, code){
  const error = new Error(message);
  error.statusCode = statusCode || 401;
  error.code = code || 'GOOGLE_LOGIN_FAILED';
  return error;
}

async function verifyGoogleCredential(credential){
  const token = String(credential || '').trim();
  if (!token) throw googleAuthError('Google chưa trả về thông tin xác minh.', 400, 'GOOGLE_CREDENTIAL_MISSING');
  if (!GOOGLE_CLIENT_ID) throw googleAuthError('Google Login chưa được cấu hình trên máy chủ.', 503, 'GOOGLE_CLIENT_NOT_CONFIGURED');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let response;
  try {
    response = await fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
      {signal:controller.signal, headers:{'Accept':'application/json'}}
    );
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw googleAuthError('Google phản hồi quá lâu. Vui lòng thử lại.', 408, 'GOOGLE_VERIFY_TIMEOUT');
    }
    throw googleAuthError('Chưa thể kết nối Google để xác minh tài khoản.', 424, 'GOOGLE_VERIFY_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }

  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    throw googleAuthError('Phiên xác minh Google không hợp lệ hoặc đã hết hạn.', 401, 'GOOGLE_TOKEN_INVALID');
  }

  const issuer = String(payload.iss || '');
  const audience = String(payload.aud || '');
  const email = cleanEmail(payload.email);
  const verified = payload.email_verified === true || String(payload.email_verified || '').toLowerCase() === 'true';
  const expiresAt = Number(payload.exp || 0) * 1000;

  if (!['accounts.google.com','https://accounts.google.com'].includes(issuer)) {
    throw googleAuthError('Nguồn xác minh Google không hợp lệ.', 401, 'GOOGLE_ISSUER_INVALID');
  }
  if (audience !== GOOGLE_CLIENT_ID) {
    throw googleAuthError('Tài khoản Google không thuộc ứng dụng PHF Training Hub.', 401, 'GOOGLE_AUDIENCE_INVALID');
  }
  if (!email || !verified) {
    throw googleAuthError('Google chưa xác minh email của tài khoản này.', 401, 'GOOGLE_EMAIL_NOT_VERIFIED');
  }
  if (!expiresAt || Date.now() >= expiresAt) {
    throw googleAuthError('Phiên xác minh Google đã hết hạn. Vui lòng thử lại.', 401, 'GOOGLE_TOKEN_EXPIRED');
  }

  return {
    sub:String(payload.sub || ''),
    email,
    name:String(payload.name || ''),
    picture:String(payload.picture || '')
  };
}

async function loginWithGoogle(credential){
  const identity = await verifyGoogleCredential(credential);
  let account = await getAccountByEmail(identity.email);

  if (!account) {
    throw googleAuthError(
      'Gmail này chưa được cấp tài khoản PHF Training Hub. Vui lòng liên hệ Admin.',
      403,
      'GOOGLE_ACCOUNT_NOT_REGISTERED'
    );
  }
  if (account.status === 'locked') {
    throw googleAuthError('Tài khoản PHF này đang tạm khóa.', 403, 'ACCOUNT_LOCKED');
  }
  if (account.status !== 'active') {
    throw googleAuthError('Tài khoản PHF này đã ngừng sử dụng.', 403, 'ACCOUNT_INACTIVE');
  }

  account = await ensureLearnerEmployeeLink(account);

  if (supabase) {
    const { error } = await supabase
      .from('user_accounts')
      .update({last_login_at:new Date().toISOString()})
      .eq('id', account.id);
    if (error) console.warn('[PHF Auth] Không cập nhật được Google last_login_at:', error.message);
  }

  return {
    ok:true,
    token:makeSession(account,{provider:'google'}),
    user:{...publicAccount(account),authProvider:'google'}
  };
}

function googleClientConfig(){
  return {enabled:!!GOOGLE_CLIENT_ID, clientId:GOOGLE_CLIENT_ID};
}


function assertPasswordPolicy(value){
  const password = String(value || '');
  if (password.length < 8 || !/[A-Za-zÀ-ỹ]/.test(password) || !/\d/.test(password)) {
    const error = new Error('Mật khẩu cần ít nhất 8 ký tự, có chữ và số.');
    error.statusCode = 400;
    error.code = 'PASSWORD_WEAK';
    throw error;
  }
  return password;
}
function generateTemporaryPassword(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(8);
  let out = 'PHF@';
  for (let i=0;i<bytes.length;i++) out += chars[bytes[i] % chars.length];
  return out;
}
async function persistPassword(account, newPassword, mustChangePassword){
  const hashed = hashPassword(assertPasswordPolicy(newPassword));
  const nextVersion = Number(account.metadata && account.metadata.passwordVersion || 0) + 1;
  const updated = {
    ...account,
    passwordSalt:hashed.salt,
    passwordHash:hashed.hash,
    passwordIterations:hashed.iterations,
    passwordAlgorithm:'pbkdf2-sha256',
    mustChangePassword:!!mustChangePassword,
    updatedAt:new Date().toISOString(),
    metadata:{...(account.metadata || {}), passwordVersion:nextVersion}
  };
  if (supabase) {
    const row = accountToDbRow(updated);
    row.password_changed_at = new Date().toISOString();
    const { error } = await supabase.from('user_accounts').update(row).eq('id', account.id);
    if (error) throw error;
    return updated;
  }
  const store = readFileStore();
  const index = (store.accounts || []).findIndex(a => String(a.id || '') === String(account.id));
  if (index < 0) throw new Error('Không tìm thấy tài khoản cần cập nhật.');
  store.accounts[index] = updated;
  store.updatedAt = new Date().toISOString();
  writeFileStore(store);
  return updated;
}
async function changeOwnPassword(session, currentPassword, newPassword){
  const account = await getAccountById(session && session.sub);
  if (!account || !verifyPassword(currentPassword, account)) {
    const error = new Error('Mật khẩu hiện tại chưa đúng.');
    error.statusCode = 400;
    error.code = 'CURRENT_PASSWORD_INVALID';
    throw error;
  }
  if (verifyPassword(newPassword, account)) {
    const error = new Error('Mật khẩu mới phải khác mật khẩu hiện tại.');
    error.statusCode = 400;
    error.code = 'PASSWORD_UNCHANGED';
    throw error;
  }
  return persistPassword(account, newPassword, false);
}

async function listHubAccountSummaries(){
  if (supabase) {
    const { data, error } = await supabase
      .from('user_accounts')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map(dbRowToAccount).map(publicAccount);
  }
  const store = readFileStore();
  return (store.accounts || []).map(normalizeAccount).map(publicAccount);
}

async function listAccountsForAdmin(){
  if (supabase) {
    const { data, error } = await supabase
      .from('user_accounts')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw error;
    const accounts = (data || []).map(dbRowToAccount);

    // Batch-verify existing employee links in one query thay vì gọi
    // employeeExistsById tuần tự cho từng tài khoản (N+1 round-trip khiến
    // màn Account Admin tải rất chậm khi số tài khoản tăng lên).
    const directIds = Array.from(new Set(
      accounts
        .filter(account => !isStandaloneSystemAccount(account))
        .map(account => String(account.employeeId || '').trim())
        .filter(Boolean)
    ));
    let validEmployeeIds = new Set();
    if (directIds.length) {
      const { data: existingEmployees, error: existErr } = await supabase
        .from('employees').select('id').in('id', directIds);
      if (existErr) throw existErr;
      validEmployeeIds = new Set((existingEmployees || []).map(row => String(row.id || '').trim()));
    }

    const repaired = await Promise.all(accounts.map(async (account) => {
      if (isStandaloneSystemAccount(account)) return account;
      const direct = String(account.employeeId || '').trim();
      if (direct && validEmployeeIds.has(direct)) return account;
      try { return await ensureLearnerEmployeeLink(account); }
      catch (linkError) {
        console.warn('[PHF Auth] Chưa thể liên kết tài khoản', account && account.email, linkError && linkError.message ? linkError.message : linkError);
        return account;
      }
    }));
    return repaired.map(publicAccount);
  }
  const store = readFileStore();
  return (store.accounts || []).map(normalizeAccount).map(publicAccount);
}

function mapAccountDatabaseError(error){
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '23505') {
    const duplicate = new Error('Email, số điện thoại hoặc mã nhân viên đang được dùng cho tài khoản khác.');
    duplicate.statusCode = 409;
    duplicate.code = 'ACCOUNT_DUPLICATE';
    return duplicate;
  }
  if (/schema cache|column .* does not exist|could not find/i.test(message)) {
    const schema = new Error('Cấu trúc dữ liệu tài khoản chưa đồng bộ. Vui lòng báo Admin kỹ thuật kiểm tra.');
    schema.statusCode = 500;
    schema.code = 'ACCOUNT_SCHEMA_MISMATCH';
    return schema;
  }
  return error;
}

async function updateAccountByAdmin(accountId, input){
  const id = String(accountId || '').trim();
  const current = await getAccountById(id);
  if (!current) {
    const error = new Error('Không tìm thấy tài khoản cần cập nhật.');
    error.statusCode = 404;
    error.code = 'ACCOUNT_NOT_FOUND';
    throw error;
  }
  const data = input || {};
  const rootAdminEmail = 'hr.phuhoacorp@gmail.com';
  if (cleanEmail(current.email) === rootAdminEmail) {
    const requestedStatus = cleanStatus(data.status || current.status);
    const requestedRole = cleanRole(data.role || current.role);
    if (requestedStatus !== 'active' || requestedRole !== 'admin' || cleanEmail(data.email || current.email) !== rootAdminEmail) {
      const error = new Error('Tài khoản Admin gốc được bảo vệ và không thể khóa, ngừng sử dụng hoặc đổi quyền/email.');
      error.statusCode = 409;
      error.code = 'ROOT_ADMIN_PROTECTED';
      throw error;
    }
  }
  const email = cleanEmail(data.email || current.email);
  const phone = cleanPhone(data.phone || current.phone);
  const employeeCode = String(data.employeeCode ?? current.employeeCode ?? '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error('Email đăng nhập chưa đúng định dạng.');
    error.statusCode = 400;
    error.code = 'EMAIL_INVALID';
    throw error;
  }
  if (phone && (phone.length < 9 || phone.length > 11)) {
    const error = new Error('Số điện thoại chưa đúng định dạng.');
    error.statusCode = 400;
    error.code = 'PHONE_INVALID';
    throw error;
  }
  if (supabase) {
    const requestedEmployeeId = String(data.employeeId ?? current.employeeId ?? '').trim();
    const checks = await Promise.all([
      supabase.from('user_accounts').select('id,name,email').eq('email', email).neq('id', id).limit(1),
      phone ? supabase.from('user_accounts').select('id,name,email').eq('phone', phone).neq('id', id).limit(1) : Promise.resolve({data:[],error:null}),
      employeeCode ? supabase.from('user_accounts').select('id,name,email').eq('employee_code', employeeCode).neq('id', id).limit(1) : Promise.resolve({data:[],error:null}),
      requestedEmployeeId ? supabase.from('user_accounts').select('id,name,email').eq('employee_id', requestedEmployeeId).neq('id', id).limit(1) : Promise.resolve({data:[],error:null})
    ]);
    const labels = ['Email này đã được dùng cho tài khoản khác.','Số điện thoại này đã được liên kết với tài khoản khác.','Mã nhân viên này đã được dùng cho tài khoản khác.','Hồ sơ nhân sự này đã được liên kết với tài khoản khác.'];
    for (let i=0;i<checks.length;i++) {
      if (checks[i].error) throw checks[i].error;
      if (checks[i].data && checks[i].data.length) {
        const error = new Error(labels[i]);
        error.statusCode = 409;
        error.code = i===0 ? 'EMAIL_DUPLICATE' : (i===1 ? 'PHONE_DUPLICATE' : (i===2 ? 'EMPLOYEE_CODE_DUPLICATE' : 'EMPLOYEE_LINK_DUPLICATE'));
        throw error;
      }
    }
  } else {
    const store = readFileStore();
    const others = (store.accounts || []).filter(a => String(a.id || '') !== id);
    if (others.some(a => cleanEmail(a.email) === email)) { const e=new Error('Email này đã được dùng cho tài khoản khác.');e.statusCode=409;e.code='EMAIL_DUPLICATE';throw e; }
    if (phone && others.some(a => cleanPhone(a.phone) === phone)) { const e=new Error('Số điện thoại này đã được liên kết với tài khoản khác.');e.statusCode=409;e.code='PHONE_DUPLICATE';throw e; }
    if (employeeCode && others.some(a => String(a.employeeCode || '').trim().toLowerCase() === employeeCode.toLowerCase())) { const e=new Error('Mã nhân viên này đã được dùng cho tài khoản khác.');e.statusCode=409;e.code='EMPLOYEE_CODE_DUPLICATE';throw e; }
    const requestedEmployeeId = String(data.employeeId ?? current.employeeId ?? '').trim();
    if (requestedEmployeeId && others.some(a => String(a.employeeId || '').trim() === requestedEmployeeId)) { const e=new Error('Hồ sơ nhân sự này đã được liên kết với tài khoản khác.');e.statusCode=409;e.code='EMPLOYEE_LINK_DUPLICATE';throw e; }
  }
  const currentAccountType = String(data.accountType || current.accountType || (current.metadata && current.metadata.accountType) || 'employee').trim().toLowerCase();
  const isSystemAccount = currentAccountType === 'system_admin';
  if (!isSystemAccount) {
    data.defaultProgram = requireEmployeeTrainingScope(data.defaultProgram ?? current.defaultProgram);
    if (data.defaultProgram === 'phf_class') data.hubAssignmentStatus = 'not_activated';
  } else {
    data.defaultProgram = 'none';
    data.hubAssignmentStatus = 'not_activated';
  }
  const isReviewLink = !isSystemAccount && String(data.linkReviewTargetCode || '').trim() !== '';
  if (isReviewLink && String(data.linkReviewTargetCode || '').trim().toLowerCase() !== employeeCode.toLowerCase()) {
    const error = new Error('Mã nhân viên rà soát không khớp với tài khoản. Vui lòng tải lại và kiểm tra.');
    error.statusCode = 409;
    error.code = 'EMPLOYEE_LINK_REVIEW_MISMATCH';
    throw error;
  }
  let resolvedEmployeeId = '';
  if (!isSystemAccount) {
    resolvedEmployeeId = await resolveEmployeeIdForAccount({
      employeeId: String(data.employeeId || current.employeeId || ''),
      employeeCode,
      name: String(data.name || current.name || '').trim(),
      phone,
      branch: String(data.branch ?? current.branch ?? ''),
      department: String(data.department ?? current.department ?? ''),
      position: String(data.position ?? current.position ?? ''),
      defaultProgram: String(data.defaultProgram ?? current.defaultProgram ?? '')
    }, {createIfMissing:!isReviewLink, rejectInvalidDirect:!isReviewLink});
    if (isReviewLink && !resolvedEmployeeId) {
      const currentLinkedId = String(current.employeeId || '').trim();
      if (currentLinkedId && await employeeExistsById(currentLinkedId)) resolvedEmployeeId = currentLinkedId;
    }
  }
  if (!isSystemAccount && !resolvedEmployeeId) {
    const error = new Error('Tài khoản nhân viên phải được liên kết với một hồ sơ nhân viên hợp lệ.');
    error.statusCode = 400; error.code = 'EMPLOYEE_LINK_REQUIRED'; throw error;
  }
  const updated = normalizeAccount({
    ...current,
    ...data,
    id: current.id,
    employeeId: resolvedEmployeeId,
    email,
    phone,
    employeeCode,
    metadata: current.metadata
  }, current);
  if (supabase) {
    // Chỉ cập nhật các trường Admin được phép sửa. Không ghi đè hash mật khẩu,
    // metadata hay employee_id khi người dùng chỉ đổi tên/email trên giao diện.
    const patch = {
      employee_id: updated.employeeId || null,
      employee_code: updated.employeeCode || '',
      name: updated.name || updated.email,
      email: cleanEmail(updated.email),
      phone: cleanPhone(updated.phone),
      role: cleanRole(updated.role),
      status: cleanStatus(updated.status),
      branch: updated.branch || '',
      department: updated.department || '',
      position: updated.position || '',
      training_audience: updated.trainingAudience || '',
      default_program: updated.defaultProgram || '',
      hub_assignment_status: cleanHubAssignmentStatus(updated.hubAssignmentStatus, updated.trainingAudience),
      must_change_password: !!updated.mustChangePassword,
      updated_at: new Date().toISOString()
    };
    const { data: savedRows, error } = await supabase
      .from('user_accounts')
      .update(patch)
      .eq('id', id)
      .select('*')
      .limit(1);
    if (error) throw mapAccountDatabaseError(error);
    if (!savedRows || savedRows.length !== 1) {
      const missing = new Error('Không tìm thấy tài khoản cần cập nhật trên máy chủ. Vui lòng tải lại danh sách.');
      missing.statusCode = 404;
      missing.code = 'ACCOUNT_NOT_FOUND_AFTER_UPDATE';
      throw missing;
    }
    return publicAccount(dbRowToAccount(savedRows[0]));
  } else {
    const store = readFileStore();
    const index = (store.accounts || []).findIndex(a => String(a.id || '') === id);
    if (index < 0) throw new Error('Không tìm thấy tài khoản cần cập nhật.');
    store.accounts[index] = updated;
    store.updatedAt = new Date().toISOString();
    writeFileStore(store);
  }
  return publicAccount(updated);
}

async function deleteAccountByAdmin(accountId, actorSession){
  const id = String(accountId || '').trim();
  if (!id) {
    const error = new Error('Thiếu mã tài khoản cần xóa.');
    error.statusCode = 400;
    error.code = 'ACCOUNT_ID_REQUIRED';
    throw error;
  }

  const account = await getAccountById(id);
  if (!account) {
    const error = new Error('Không tìm thấy tài khoản cần xóa.');
    error.statusCode = 404;
    error.code = 'ACCOUNT_NOT_FOUND';
    throw error;
  }

  if (cleanEmail(account.email) === 'hr.phuhoacorp@gmail.com') {
    const error = new Error('Không thể xóa tài khoản Admin gốc của hệ thống.');
    error.statusCode = 409;
    error.code = 'ROOT_ADMIN_PROTECTED';
    throw error;
  }

  const actorId = String(actorSession && actorSession.sub || '').trim();
  if (actorId && actorId === String(account.id || '')) {
    const error = new Error('Không thể xóa tài khoản Admin đang đăng nhập.');
    error.statusCode = 409;
    error.code = 'CURRENT_ACCOUNT_PROTECTED';
    throw error;
  }


  let allAccounts = [];
  if (supabase) {
    const { data, error } = await supabase.from('user_accounts').select('*');
    if (error) throw mapAccountDatabaseError(error);
    allAccounts = (data || []).map(dbRowToAccount);
  } else {
    const store = readFileStore();
    allAccounts = (store.accounts || []).map(normalizeAccount);
  }

  if (account.role === 'admin' && account.status === 'active') {
    const remainingActiveAdmins = allAccounts.filter(item =>
      String(item.id || '') !== String(account.id || '') &&
      item.role === 'admin' && item.status === 'active'
    );
    if (!remainingActiveAdmins.length) {
      const error = new Error('Không thể xóa Admin hoạt động cuối cùng của hệ thống.');
      error.statusCode = 409;
      error.code = 'LAST_ADMIN_PROTECTED';
      throw error;
    }
  }

  if (supabase) {
    const { data, error } = await supabase
      .from('user_accounts')
      .delete()
      .eq('id', account.id)
      .select('id');
    if (error) throw mapAccountDatabaseError(error);
    if (!data || data.length !== 1) {
      const missing = new Error('Máy chủ chưa xác nhận đã xóa tài khoản. Vui lòng tải lại danh sách và thử lại.');
      missing.statusCode = 409;
      missing.code = 'ACCOUNT_DELETE_NOT_CONFIRMED';
      throw missing;
    }
  } else {
    const store = readFileStore();
    const before = (store.accounts || []).length;
    store.accounts = (store.accounts || []).filter(item => String(item.id || '') !== String(account.id || ''));
    if (store.accounts.length === before) {
      const missing = new Error('Không tìm thấy tài khoản cần xóa trong dữ liệu Local.');
      missing.statusCode = 404;
      missing.code = 'ACCOUNT_NOT_FOUND';
      throw missing;
    }
    store.updatedAt = new Date().toISOString();
    writeFileStore(store);
  }

  return publicAccount(account);
}

async function resetPasswordByAdmin(accountId){
  const account = await getAccountById(accountId);
  if (!account) {
    const error = new Error('Không tìm thấy tài khoản cần đặt lại mật khẩu.');
    error.statusCode = 404;
    error.code = 'ACCOUNT_NOT_FOUND';
    throw error;
  }
  const temporaryPassword = generateTemporaryPassword();
  const updated = await persistPassword(account, temporaryPassword, true);
  return {account:publicAccount(updated), temporaryPassword};
}


async function createAccountByAdmin(input){
  const data = input || {};
  const email = cleanEmail(data.email);
  const accountType = String(data.accountType || (data.metadata && data.metadata.accountType) || 'employee').trim().toLowerCase();
  const isSystemAccount = accountType === 'system_admin';
  const phone = isSystemAccount ? '' : cleanPhone(data.phone);
  const employeeCode = isSystemAccount ? '' : String(data.employeeCode || '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error('Email đăng nhập chưa đúng định dạng.');
    error.statusCode = 400; error.code = 'EMAIL_INVALID'; throw error;
  }
  if (!isSystemAccount && (!phone || phone.replace(/\D/g,'').length < 9 || phone.replace(/\D/g,'').length > 11)) {
    const error = new Error('Số điện thoại liên kết chưa đúng định dạng.');
    error.statusCode = 400; error.code = 'PHONE_INVALID'; throw error;
  }
  if (isSystemAccount && cleanRole(data.role) !== 'admin') {
    const error = new Error('Tài khoản hệ thống chỉ được tạo với quyền Admin.');
    error.statusCode = 400; error.code = 'SYSTEM_ACCOUNT_ADMIN_ONLY'; throw error;
  }
  if (!String(data.name || '').trim()) {
    const error = new Error('Vui lòng nhập họ tên tài khoản.');
    error.statusCode = 400; error.code = 'NAME_REQUIRED'; throw error;
  }
  const employeeTrainingScope = isSystemAccount ? 'none' : requireEmployeeTrainingScope(data.defaultProgram);
  if (!isSystemAccount && employeeTrainingScope === 'phf_class') data.hubAssignmentStatus = 'not_activated';

  let existing = [];
  if (supabase) {
    const {data:rows,error} = await supabase.from('user_accounts').select('*');
    if (error) throw error;
    existing = (rows || []).map(dbRowToAccount);
  } else {
    existing = readFileStore().accounts || [];
  }
  const duplicateEmail = existing.find(a => cleanEmail(a.email) === email);
  if (duplicateEmail) {
    const error = new Error('Email này đã được dùng cho một tài khoản khác.');
    error.statusCode = 409; error.code = 'EMAIL_DUPLICATE'; throw error;
  }
  const duplicatePhone = phone ? existing.find(a => cleanPhone(a.phone) && cleanPhone(a.phone) === phone) : null;
  if (duplicatePhone) {
    const error = new Error('Số điện thoại này đã được liên kết với một tài khoản khác.');
    error.statusCode = 409; error.code = 'PHONE_DUPLICATE'; throw error;
  }
  if (employeeCode) {
    const duplicateCode = existing.find(a => String(a.employeeCode || '').trim().toLowerCase() === employeeCode.toLowerCase());
    if (duplicateCode) {
      const error = new Error('Mã nhân viên này đã được dùng cho một tài khoản khác.');
      error.statusCode = 409; error.code = 'EMPLOYEE_CODE_DUPLICATE'; throw error;
    }
  }

  const temporaryPassword = generateTemporaryPassword();
  const requestedEmployee = {
    employeeId:isSystemAccount ? '' : String(data.employeeId || ''),
    employeeCode,
    name:String(data.name || '').trim(),
    phone,
    branch:String(data.branch || ''),
    department:String(data.department || ''),
    position:String(data.position || ''),
    defaultProgram:isSystemAccount ? 'none' : employeeTrainingScope
  };
  const resolvedEmployeeId = isSystemAccount ? '' : await resolveEmployeeIdForAccount(requestedEmployee, {createIfMissing:true, rejectInvalidDirect:true});
  if (!isSystemAccount && !resolvedEmployeeId) {
    const error = new Error('Không thể tạo hoặc liên kết hồ sơ nhân viên cho tài khoản này.');
    error.statusCode = 400; error.code = 'EMPLOYEE_LINK_REQUIRED'; throw error;
  }
  const account = normalizeAccount({
    id:String(data.id || `acct-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`),
    employeeId:resolvedEmployeeId,
    employeeCode,
    name:String(data.name || '').trim(),
    email,
    phone,
    role:isSystemAccount ? 'admin' : data.role,
    status:data.status || 'active',
    branch:isSystemAccount ? '' : String(data.branch || ''),
    department:isSystemAccount ? '' : String(data.department || ''),
    position:isSystemAccount ? '' : String(data.position || ''),
    trainingAudience:isSystemAccount ? '' : String(data.trainingAudience || ''),
    defaultProgram:isSystemAccount ? 'none' : employeeTrainingScope,
    hubAssignmentStatus:isSystemAccount ? 'not_activated' : cleanHubAssignmentStatus(data.hubAssignmentStatus, data.trainingAudience),
    mustChangePassword:true,
    tempPassword:temporaryPassword,
    metadata:{passwordVersion:1, createdByAdmin:true, accountType:isSystemAccount ? 'system_admin' : 'employee'}
  });

  if (supabase) {
    const {error} = await supabase.from('user_accounts').insert(accountToDbRow(account));
    if (error) {
      if (String(error.code || '') === '23505') {
        const duplicate = new Error('Tài khoản đã tồn tại hoặc trùng dữ liệu liên kết.');
        duplicate.statusCode = 409; duplicate.code = 'ACCOUNT_DUPLICATE'; throw duplicate;
      }
      throw error;
    }
  } else {
    const store = readFileStore();
    store.accounts = [account].concat(store.accounts || []);
    store.bootstrapped = true;
    store.updatedAt = new Date().toISOString();
    writeFileStore(store);
  }
  return {account:publicAccount(account), temporaryPassword};
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
  loginWithGoogle,
  googleClientConfig,
  readSession,
  requireSession,
  cookieHeader,
  clearCookieHeader,
  syncAccounts,
  bootstrapFromLocal,
  authorizePayload,
  publicAccount,
  getAccountById,
  getEmployeeCodesByAccountIds,
  cleanPhone,
  cleanEmail,
  hashPassword,
  dbRowToAccount,
  accountToDbRow,
  hasSupabaseEnv,
  changeOwnPassword,
  resetPasswordByAdmin,
  createAccountByAdmin,
  updateAccountByAdmin,
  deleteAccountByAdmin,
  listAccountsForAdmin,
  listHubAccountSummaries,
  generateTemporaryPassword,
  makeSession
};
