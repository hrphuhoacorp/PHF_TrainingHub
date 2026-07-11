'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PRIVATE_DIR = path.join(ROOT, 'private');
const ACCOUNTS_FILE = path.join(PRIVATE_DIR, 'accounts.json');
const SECRET_FILE = path.join(PRIVATE_DIR, 'session-secret.txt');
const COOKIE_NAME = 'phf_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function ensurePrivateDir(){ fs.mkdirSync(PRIVATE_DIR, { recursive:true }); }
function cleanEmail(v){ return String(v || '').trim().toLowerCase(); }
function cleanPhone(v){ return String(v || '').replace(/\D/g, ''); }
function cleanRole(v){ v=String(v||'learner').toLowerCase(); return ['learner','manager','admin'].includes(v)?v:'learner'; }
function safeEqual(a,b){
  const aa=Buffer.from(String(a||'')); const bb=Buffer.from(String(b||''));
  return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}
function hashPassword(password, salt){
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password||''), salt, 120000, 32, 'sha256').toString('hex');
  return { salt, hash };
}
function verifyPassword(password, account){
  if(!account || !account.passwordHash || !account.passwordSalt) return false;
  return safeEqual(hashPassword(password, account.passwordSalt).hash, account.passwordHash);
}
function builtIns(){
  return [
    {id:'acct-learner-test',name:'Nhân viên Test',email:'nv.test@phf.local',phone:'0900000001',role:'learner',status:'active',password:'123456',position:'Nhân viên bán hàng',branch:'Phú Lợi',department:'Bán hàng'},
    {id:'acct-manager-test',name:'Trưởng ca Test',email:'truongca.test@phf.local',phone:'0900000002',role:'manager',status:'active',password:'123456',position:'Trưởng ca / CHT / Quản lý',branch:'Phú Lợi',department:'Bán hàng'},
    {id:'acct-admin-test',name:'Admin Test',email:'admin.test@phf.local',phone:'0900000003',role:'admin',status:'active',password:'123456',position:'Quản trị đào tạo',branch:'Phú Lợi',department:'HCNS'}
  ];
}
function normalizeAccount(a, old){
  a=a||{}; old=old||{};
  const out={
    id:String(old.id||a.id||('acct-'+Date.now())), employeeId:String(a.employeeId||a.linkedEmployeeId||old.employeeId||''),
    employeeCode:String(a.employeeCode||old.employeeCode||''), name:String(a.name||a.fullName||old.name||a.email||''),
    email:cleanEmail(a.email||old.email), phone:cleanPhone(a.phone||a.mobile||old.phone), role:cleanRole(a.role||old.role),
    status:String(a.status||old.status||'active').toLowerCase(), branch:String(a.branch||a.location||old.branch||''),
    department:String(a.department||old.department||''), position:String(a.position||old.position||''),
    trainingAudience:String(a.trainingAudience||a.audience||old.trainingAudience||''), defaultProgram:String(a.defaultProgram||a.program||old.defaultProgram||''),
    mustChangePassword:!!(a.mustChangePassword ?? old.mustChangePassword), updatedAt:new Date().toISOString()
  };
  const raw=String(a.password||a.tempPassword||'');
  if(raw){ const h=hashPassword(raw); out.passwordSalt=h.salt; out.passwordHash=h.hash; }
  else { out.passwordSalt=old.passwordSalt||''; out.passwordHash=old.passwordHash||''; }
  return out;
}
function ensureStore(){
  ensurePrivateDir();
  if(!fs.existsSync(ACCOUNTS_FILE)){
    const accounts=builtIns().map(a=>normalizeAccount(a));
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({version:1,bootstrapped:false,accounts},null,2));
  }
}
function readStore(){ ensureStore(); try{return JSON.parse(fs.readFileSync(ACCOUNTS_FILE,'utf8'))}catch{return {version:1,bootstrapped:false,accounts:[]}} }
function writeStore(store){ ensurePrivateDir(); fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(store,null,2)); }
function publicAccount(a){
  return {id:a.id,employeeId:a.employeeId||'',employeeCode:a.employeeCode||'',name:a.name,email:a.email,phone:a.phone,role:a.role,status:a.status,branch:a.branch,department:a.department,position:a.position,trainingAudience:a.trainingAudience,defaultProgram:a.defaultProgram,mustChangePassword:!!a.mustChangePassword};
}
function getSecret(){
  ensurePrivateDir();
  const env=String(process.env.PHF_SESSION_SECRET||'').trim(); if(env) return env;
  if(!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(48).toString('hex'));
  return fs.readFileSync(SECRET_FILE,'utf8').trim();
}
function b64url(input){ return Buffer.from(input).toString('base64url'); }
function sign(value){ return crypto.createHmac('sha256',getSecret()).update(value).digest('base64url'); }
function makeSession(account){
  const payload={v:1,sub:account.id,email:account.email,role:account.role,phone:account.phone||'',employeeId:account.employeeId||'',iat:Date.now(),exp:Date.now()+SESSION_TTL_MS,nonce:crypto.randomBytes(8).toString('hex')};
  const body=b64url(JSON.stringify(payload)); return body+'.'+sign(body);
}
function parseCookies(req){
  const out={}; String(req.headers&&req.headers.cookie||'').split(';').forEach(p=>{const i=p.indexOf('=');if(i>0)out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim())}); return out;
}
function readSession(req){
  try{
    const token=parseCookies(req)[COOKIE_NAME]||''; const [body,sig]=token.split('.'); if(!body||!sig||!safeEqual(sign(body),sig)) return null;
    const p=JSON.parse(Buffer.from(body,'base64url').toString('utf8')); if(!p.exp||Date.now()>p.exp) return null;
    const store=readStore(); const a=(store.accounts||[]).find(x=>x.id===p.sub && x.email===p.email);
    if(!a || a.status!=='active' || a.role!==p.role) return null;
    return {...p,account:publicAccount(a)};
  }catch{return null;}
}
function cookieHeader(token){
  const secure=String(process.env.NODE_ENV||'').toLowerCase()==='production'?'; Secure':'';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS/1000)}${secure}`;
}
function clearCookieHeader(){ return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`; }
function findAccount(email){ const s=readStore(); return (s.accounts||[]).find(a=>a.email===cleanEmail(email)); }
function login(email,password){
  const a=findAccount(email); if(!a) return {ok:false,code:'ACCOUNT_NOT_FOUND',message:'Không tìm thấy tài khoản này.'};
  if(a.status==='locked') return {ok:false,code:'ACCOUNT_LOCKED',message:'Tài khoản này đang tạm khóa.'};
  if(a.status!=='active') return {ok:false,code:'ACCOUNT_INACTIVE',message:'Tài khoản này đã ngừng sử dụng.'};
  if(!verifyPassword(password,a)) return {ok:false,code:'PASSWORD_INVALID',message:'Mật khẩu chưa đúng.'};
  return {ok:true,token:makeSession(a),user:publicAccount(a)};
}
function syncAccounts(list){
  const store=readStore(); const oldMap=new Map((store.accounts||[]).map(a=>[a.email,a]));
  const incoming=(Array.isArray(list)?list:[]).map(a=>normalizeAccount(a,oldMap.get(cleanEmail(a&&a.email)))).filter(a=>a.email&&a.passwordHash);
  const built=builtIns().map(a=>normalizeAccount(a,oldMap.get(cleanEmail(a.email))));
  const map=new Map(); [...built,...incoming].forEach(a=>map.set(a.email,a));
  store.accounts=[...map.values()]; store.bootstrapped=true; store.updatedAt=new Date().toISOString(); writeStore(store);
  return store.accounts.map(publicAccount);
}
function bootstrapFromLocal(req, list){
  const remote=String(req.socket&&req.socket.remoteAddress||'');
  const local=/127\.0\.0\.1|::1|::ffff:127\.0\.0\.1/.test(remote);
  const store=readStore(); if(!local || store.bootstrapped) return false;
  syncAccounts(list); return true;
}
function requireSession(req, roles){
  const s=readSession(req); if(!s){const e=new Error('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');e.statusCode=401;e.code='AUTH_REQUIRED';throw e;}
  if(roles&&roles.length&&!roles.includes(s.role)){const e=new Error('Tài khoản không có quyền thực hiện thao tác này.');e.statusCode=403;e.code='FORBIDDEN';throw e;}
  return s;
}
function matchesOwnEmployee(session, employee){
  employee=employee||{};
  const sid=String(session.employeeId||'').trim(), eid=String(employee.id||employee.employeeId||'').trim();
  const sp=cleanPhone(session.phone), ep=cleanPhone(employee.phone);
  return !!((sid&&eid&&sid===eid)||(sp&&ep&&sp===ep));
}
function authorizePayload(session,payload){
  payload=payload||{};
  if(session.role==='admin'){ payload.adminMode=true; payload.managerMode=false; return payload; }
  if(session.role==='manager'){
    if(payload.action==='deleteEmployee'){const e=new Error('Chỉ Admin được xóa học viên.');e.statusCode=403;e.code='ADMIN_REQUIRED';throw e;}
    payload.adminMode=false; payload.managerMode=true; return payload;
  }
  if(payload.action==='deleteEmployee' || payload.action==='saveProbation' || payload.action==='resolveNotification'){const e=new Error('Học viên không có quyền thực hiện thao tác này.');e.statusCode=403;e.code='FORBIDDEN';throw e;}
  if(['markNotificationRead','markAllNotificationsRead'].includes(payload.action)){payload.adminMode=false;payload.managerMode=false;return payload;}
  if(!matchesOwnEmployee(session,payload.employee)){const e=new Error('Học viên chỉ được cập nhật dữ liệu của chính mình.');e.statusCode=403;e.code='EMPLOYEE_SCOPE_FORBIDDEN';throw e;}
  payload.adminMode=false; payload.managerMode=false; return payload;
}
module.exports={COOKIE_NAME,login,readSession,requireSession,cookieHeader,clearCookieHeader,syncAccounts,bootstrapFromLocal,authorizePayload,publicAccount,cleanPhone};
