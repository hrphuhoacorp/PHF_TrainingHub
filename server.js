'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { readData, saveData } = require('./lib/db');
const { listClasses, getClass, saveClass, listAttendance, saveAttendance } = require('./lib/classroom-db');
const { getLearning, saveLessons, updateProgress } = require('./lib/classroom-learning');
const { getMaterials, saveGroups, createUpload, finalizeUpload, updateMaterial, materialUrl, confirmMaterial } = require('./lib/classroom-materials');
const { listTests, saveTest, saveAssignment, startAttempt, submitAttempt, gradeAttempt } = require('./lib/classroom-tests');
const { listClassroomUsers } = require('./lib/classroom-users');
const { listProposals, saveProposal, reviewProposal } = require('./lib/classroom-proposals');
const { listNotifications, saveNotification, markNotificationRead, markAllNotificationsRead, hideNotification } = require('./lib/classroom-notifications');
const { getSettings, saveSettings, resetSettings, softDelete, restore, purge, listAudit } = require('./lib/classroom-settings');
const { listChecklistAssignments, saveChecklistAssignments } = require('./lib/checklist-assignments');
const { listChecklistTemplates, saveChecklistTemplate, saveChecklistTemplateLibrary } = require('./lib/checklist-templates');
const { getChecklistViolationMode, getChecklistLatePointsPolicy, saveChecklistLatePointsPolicy, getChecklistRepeatViolationPolicy, saveChecklistRepeatViolationPolicy, getChecklistRepeatViolationSuggestions, saveChecklistViolations, listChecklistViolations, listChecklistViolationHistory, getChecklistViolationTaskStatus, updateChecklistViolation, cancelChecklistViolation, deleteChecklistTestViolation, deleteChecklistTestViolations } = require('./lib/checklist-violations');
const { createChecklistEvidenceUpload, finalizeChecklistEvidenceUpload, attachChecklistEvidence, listChecklistEvidence, deleteChecklistEvidence, streamChecklistEvidenceDownload } = require('./lib/checklist-evidence');
const { listChecklistTasks, transitionChecklistTask, getChecklistTaskHistory, getChecklistViolationDetail } = require('./lib/checklist-tasks');
const { listChecklistPermissionGrants, saveChecklistPermissionGrants, disableChecklistPermissionGrant, getChecklistRoleWorkspace, requireChecklistWebOperator, isChecklistWebOperator } = require('./lib/checklist-permissions');
const { getMarketingMonthlyKpiConfig, saveMarketingMonthlyKpiConfig, listMonthly, createMonthly, openMonthly, lockMonthly, openMonthlyException, openMonthlyPilot, myMonthlyForm, saveMyMonthly, myMonthlyReviews, myMonthlyReviewDetail, saveMonthlyReview, changeMonthlyReviewer, exportMonthlyData, getMonthlyOverduePolicy, saveMonthlyOverduePolicy, processMonthlySelfOverdue, getChecklistMonthlyScorePolicy, saveChecklistMonthlyScorePolicy, getMonthlyCyclePolicy, saveMonthlyCyclePolicy, saveMonthlyCycleOverride, syncMonthlyCycle, getChecklistAssessmentProfile } = require('./lib/checklist-monthly');
const { getChecklistMonthlyReport, getChecklistViolationWorkflowSummary, getChecklistCurrentScoreReport, getChecklistScorePeriodReport } = require('./lib/checklist-reports');
const { inspectMonthlyRecovery, createMissingMonthlyForms, getMonthlyDeletePreview, deleteMonthlyFormException } = require('./lib/checklist-recovery');
const { listChecklistNotificationRules, saveChecklistNotificationRule, listMyChecklistNotifications, markChecklistNotificationRead, markAllChecklistNotificationsRead, emitChecklistNotification } = require('./lib/checklist-notifications');
const { getKnlCapabilities, listKnlPermissionGrants, upsertKnlPermissionGrant, requireManagePermissionsForSession } = require('./lib/knl-permissions');
const { listKnlPeople } = require('./lib/knl-people');
const { listKnlFrameworks, getKnlFrameworkVersion, createKnlFramework, saveKnlFramework, cloneKnlVersion, publishKnlVersion, saveKnlGroup, saveKnlItem, saveKnlColumn, deleteKnlStructure, disableKnlStructure, reorderKnlStructure, saveKnlLevelContent } = require('./lib/knl-frameworks');
const { listEmployeeMaster, getEmployeeMasterDetail, saveProfile:saveEmployeeMasterProfile, savePrivateProfile:saveEmployeeMasterPrivateProfile, saveContract:saveEmployeeMasterContract, saveCompensation:saveEmployeeMasterCompensation } = require('./lib/employee-master');
const { previewEmployeeImport, commitEmployeeImport } = require('./lib/employee-import');
const { runChatSandbox } = require('./lib/ai-sandbox');
const { listConversations, getConversation, createConversation, appendMessages, deleteConversation } = require('./lib/ai-conversations');
const {
  MAX_BODY_BYTES,
  RequestError,
  assertSameOrigin,
  assertJsonContentType,
  assertContentLength,
  validatePayload,
  publicError
} = require('./lib/request-guard');
const { assertLoginAllowed, recordLoginFailure, clearLoginFailures, checkSupabaseHealth } = require('./lib/production-hardening');
const { login, loginWithGoogle, googleClientConfig, readSession, requireSession, cookieHeader, clearCookieHeader, syncAccounts, bootstrapFromLocal, authorizePayload, changeOwnPassword, resetPasswordByAdmin, createAccountByAdmin, updateAccountByAdmin, deleteAccountByAdmin, listAccountsForAdmin, listHubAccountSummaries, makeSession, publicAccount, getAccountById } = require('./lib/auth');


async function requireWebOperatorSession(req){
  const session=await requireSession(req,['manager','admin']);
  await requireChecklistWebOperator(session);
  return session;
}
async function assertAccountMutationAllowed(session,input={},targetId=''){
  if(session.role==='admin')return;
  const requestedRole=String(input.role||'').trim().toLowerCase();
  const requestedType=String(input.accountType||input.account_type||'').trim().toLowerCase();
  if(requestedRole==='admin'||requestedType==='system_admin'){
    const error=new Error('Trợ lý điều hành không được tạo hoặc nâng tài khoản thành Admin hệ thống.');error.statusCode=403;error.code='ADMIN_ACCOUNT_PROTECTED';throw error;
  }
  if(targetId){
    const target=await getAccountById(targetId);
    if(!target){const error=new Error('Không tìm thấy tài khoản cần xử lý.');error.statusCode=404;error.code='ACCOUNT_NOT_FOUND';throw error;}
    if(String(target.role||'').toLowerCase()==='admin'||String(target.accountType||target.metadata?.accountType||'').toLowerCase()==='system_admin'){
      const error=new Error('Trợ lý điều hành không được sửa tài khoản Admin hệ thống.');error.statusCode=403;error.code='ADMIN_ACCOUNT_PROTECTED';throw error;
    }
    const targetSession={role:target.role,sub:target.id,account:target,employeeCode:target.employeeCode,employeeId:target.employeeId,email:target.email};
    if(await isChecklistWebOperator(targetSession)){
      const error=new Error('Chỉ Admin hệ thống được sửa tài khoản Trợ lý Giám đốc – Điều hành web.');error.statusCode=403;error.code='ASSISTANT_ACCOUNT_PROTECTED';throw error;
    }
  }
}

const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(__dirname);
const INDEX_HTML_PATH = path.join(ROOT, 'index.html');
const BUILD_INFO_PATH = path.join(ROOT, 'build-info.json');
const BUILD_FALLBACK = Object.freeze({version:'1.37.6',fingerprint:'1376-version-single-source-hot-refresh',builtAt:null,release:'Single Source Version + Runtime Hot Refresh'});
let buildInfoCache = BUILD_FALLBACK;
let buildInfoMtimeMs = -1;
let indexHtmlBuffer = null;
let indexHtmlMtimeMs = -1;

function readBuildInfoFresh() {
  try {
    const stat = fs.statSync(BUILD_INFO_PATH);
    if (stat.mtimeMs !== buildInfoMtimeMs) {
      buildInfoCache = Object.freeze(JSON.parse(fs.readFileSync(BUILD_INFO_PATH, 'utf8')));
      buildInfoMtimeMs = stat.mtimeMs;
    }
  } catch (error) {
    console.warn('[PHF BUILD] Không đọc được build-info.json:', error?.message || error);
  }
  return buildInfoCache || BUILD_FALLBACK;
}

function readIndexHtmlFresh() {
  const stat = fs.statSync(INDEX_HTML_PATH);
  if (!indexHtmlBuffer || stat.mtimeMs !== indexHtmlMtimeMs) {
    indexHtmlBuffer = fs.readFileSync(INDEX_HTML_PATH);
    indexHtmlMtimeMs = stat.mtimeMs;
  }
  return indexHtmlBuffer;
}

function baseHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
    'X-PHF-Build': `${readBuildInfoFresh().version || 'unknown'}-${readBuildInfoFresh().fingerprint || 'unknown'}`,
    ...(String(process.env.NODE_ENV || '').toLowerCase() === 'production' ? {'Strict-Transport-Security':'max-age=31536000; includeSubDomains'} : {}),
    'Content-Security-Policy-Report-Only': "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https://*.supabase.co https://accounts.google.com; frame-src 'self' https://accounts.google.com https://docs.google.com; script-src 'self' 'unsafe-inline' https://accounts.google.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
    ...extra
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, baseHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
  res.end(body);
}
async function emitChecklistNotificationSafe(eventCode,input){
  try{return await emitChecklistNotification(eventCode,input);}
  catch(error){console.warn('[PHF Checklist] notification emit skipped',eventCode,error?.message||error);return {created:0,skipped:'error'};}
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

function staticCacheControl(filePath, rawUrl, pathname) {
  const ext = path.extname(filePath).toLowerCase();
  const urlText = String(rawUrl || '');
  const isPrintPage = filePath.endsWith('print-commitment.html') ||
    filePath.endsWith('print-evaluation.html') ||
    filePath.endsWith('print-form.html') ||
    /^\/print\//.test(String(pathname || '')) ||
    /^\/forms\/[^/]+\/print$/.test(String(pathname || ''));

  // HTML shell và trang in luôn lấy bản mới; API đã dùng baseHeaders no-store.
  if (filePath.endsWith('index.html') || isPrintPage || ext === '.html') return 'no-store';

  // File JS/CSS có mã phiên bản (?v=...) được phép cache. Khi phát hành bản mới,
  // index.html đổi v= nên trình duyệt tự tải URL mới, không cần xóa cache.
  if ((ext === '.js' || ext === '.css') && /(?:[?&])v=[^&]+/i.test(urlText)) {
    return 'public, max-age=3600, must-revalidate';
  }

  // File tĩnh không có version vẫn phải kiểm tra lại để tránh giữ nhầm code cũ.
  if (ext === '.js' || ext === '.css' || ext === '.webmanifest' || ext === '.json') {
    return 'no-cache, must-revalidate';
  }

  // Ảnh, font, video và tài liệu lớn ít thay đổi: cache dài hơn để giảm tải lại.
  if (['.png','.jpg','.jpeg','.gif','.webp','.svg','.ico','.mp4','.webm','.woff','.woff2','.ttf','.otf','.xlsx'].includes(ext)) {
    return 'public, max-age=604800, stale-while-revalidate=86400';
  }

  return 'no-cache, must-revalidate';
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

    if (pathname === '/api/health' && req.method === 'GET') {
      const health = await checkSupabaseHealth({timeoutMs:4000});
      return sendJson(res, health.ok ? 200 : 503, {
        ...health,
        service: 'PHF Training Hub',
        build: readBuildInfoFresh(),
        time: new Date().toISOString()
      });
    }

    if (pathname === '/api/build-info' && req.method === 'GET') {
      return sendJson(res, 200, { ok:true, build:readBuildInfoFresh() });
    }

    if (pathname === '/api/auth/session' && req.method === 'GET') {
      const session = await readSession(req);
      return sendJson(res, 200, { ok:true, authenticated:!!session, user:session ? session.account : null });
    }
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
      const raw = await readBody(req); let body={};
      try { body=JSON.parse(raw||'{}'); } catch { throw new RequestError('Dữ liệu đăng nhập không hợp lệ.',400,'JSON_INVALID'); }
      assertLoginAllowed(req, body.email);
      let result=await login(body.email, body.password);
      if(!result.ok && Array.isArray(body.localAccounts) && await bootstrapFromLocal(req, body.localAccounts)) result=await login(body.email, body.password);
      if(!result.ok) {
        const attempt=recordLoginFailure(req, body.email);
        if (attempt.blockedUntil && attempt.blockedUntil > Date.now()) res.setHeader('Retry-After', String(Math.ceil((attempt.blockedUntil-Date.now())/1000)));
        return sendJson(res, attempt.blockedUntil && attempt.blockedUntil > Date.now() ? 429 : 401, {ok:false,error:'Email hoặc mật khẩu chưa đúng, hoặc đăng nhập tạm thời bị giới hạn.',code:attempt.blockedUntil && attempt.blockedUntil > Date.now()?'LOGIN_RATE_LIMITED':'LOGIN_INVALID'});
      }
      clearLoginFailures(req, body.email);
      res.setHeader('Set-Cookie', cookieHeader(result.token));
      return sendJson(res, 200, {ok:true,user:result.user});
    }
    if ((pathname === '/api/auth/google/config' || pathname === '/api/auth/google/login') && req.method === 'GET') {
      return sendJson(res, 200, {ok:true, ...googleClientConfig()});
    }
    if (pathname === '/api/auth/google/login' && req.method === 'POST') {
      assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
      const raw = await readBody(req); let body={};
      try { body=JSON.parse(raw||'{}'); } catch { throw new RequestError('Dữ liệu Google Login không hợp lệ.',400,'JSON_INVALID'); }
      const result = await loginWithGoogle(body.credential);
      res.setHeader('Set-Cookie', cookieHeader(result.token));
      return sendJson(res, 200, {ok:true,user:result.user});
    }
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      assertSameOrigin(req); res.setHeader('Set-Cookie', clearCookieHeader());
      return sendJson(res, 200, {ok:true});
    }
    if (pathname === '/api/auth/change-password' && req.method === 'POST') {
      assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
      const session=await requireSession(req,['learner','manager','admin']);
      const raw=await readBody(req); let body={};
      try{body=JSON.parse(raw||'{}')}catch{throw new RequestError('Dữ liệu đổi mật khẩu không hợp lệ.',400,'JSON_INVALID')}
      const updated=await changeOwnPassword(session,body.currentPassword,body.newPassword);
      res.setHeader('Set-Cookie',cookieHeader(makeSession(updated)));
      return sendJson(res,200,{ok:true,user:publicAccount(updated)});
    }
    if ((pathname === '/api/auth/accounts' || pathname === '/api/auth/accounts/list') && req.method === 'GET') {
      await requireWebOperatorSession(req);
      const accounts = await listAccountsForAdmin();
      return sendJson(res,200,{ok:true,accounts});
    }
    if (pathname === '/api/auth/accounts/create' && req.method === 'POST') {
      assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
      const session=await requireWebOperatorSession(req);
      const raw=await readBody(req); let body={};
      try{body=JSON.parse(raw||'{}')}catch{throw new RequestError('Dữ liệu tạo tài khoản không hợp lệ.',400,'JSON_INVALID')}
      await assertAccountMutationAllowed(session,body.account||body);
      const result=await createAccountByAdmin(body.account||body);
      return sendJson(res,201,{ok:true,user:result.account,temporaryPassword:result.temporaryPassword});
    }
    if (pathname === '/api/auth/accounts/update' && req.method === 'POST') {
      assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
      const session=await requireWebOperatorSession(req);
      const raw=await readBody(req); let body={};
      try{body=JSON.parse(raw||'{}')}catch{throw new RequestError('Dữ liệu cập nhật tài khoản không hợp lệ.',400,'JSON_INVALID')}
      await assertAccountMutationAllowed(session,body.account||body,body.accountId);
      const user=await updateAccountByAdmin(body.accountId, body.account||body);
      const reauthRequired=String(session.sub||'')===String(user.id||'') && (session.email!==user.email || session.role!==user.role || user.status!=='active');
      if(reauthRequired) res.setHeader('Set-Cookie', clearCookieHeader());
      return sendJson(res,200,{ok:true,user,reauthRequired});
    }
    if (pathname === '/api/auth/accounts/delete' && req.method === 'POST') {
      assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
      const session = await requireWebOperatorSession(req);
      const raw = await readBody(req); let body = {};
      try { body = JSON.parse(raw || '{}'); }
      catch { throw new RequestError('Dữ liệu xóa tài khoản không hợp lệ.',400,'JSON_INVALID'); }
      await assertAccountMutationAllowed(session,{},body.accountId);
      const user = await deleteAccountByAdmin(body.accountId, session);
      return sendJson(res,200,{ok:true,user});
    }
    if (pathname === '/api/auth/accounts/reset-password' && req.method === 'POST') {
      assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
      const session=await requireWebOperatorSession(req);
      const raw=await readBody(req); let body={};
      try{body=JSON.parse(raw||'{}')}catch{throw new RequestError('Dữ liệu đặt lại mật khẩu không hợp lệ.',400,'JSON_INVALID')}
      await assertAccountMutationAllowed(session,{},body.accountId);
      const result=await resetPasswordByAdmin(body.accountId);
      return sendJson(res,200,{ok:true,user:result.account,temporaryPassword:result.temporaryPassword});
    }
    if (pathname === '/api/auth/accounts/sync' && req.method === 'POST') {
      assertSameOrigin(req); const session=await requireSession(req,['admin']);
      assertJsonContentType(req); assertContentLength(req);
      const raw=await readBody(req); let body={};
      try{body=JSON.parse(raw||'{}')}catch{throw new RequestError('Dữ liệu tài khoản không hợp lệ.',400,'JSON_INVALID')}
      const accounts=await syncAccounts(body.accounts||[]);
      return sendJson(res,200,{ok:true,count:accounts.length});
    }


    if (pathname === '/api/ai/chat' && req.method === 'POST') {
      assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
      const session = await requireSession(req, ['admin']);
      const raw = await readBody(req); let body = {};
      try { body = JSON.parse(raw || '{}'); }
      catch { throw new RequestError('Dữ liệu gửi lên không hợp lệ.', 400, 'JSON_INVALID'); }
      const outcome = await runChatSandbox(session, body.messages);
      return sendJson(res, 200, {ok:true,reply:outcome.reply,result:outcome.result || null,actions:outcome.actions || null});
    }

    if (pathname === '/api/ai/conversations' && req.method === 'POST') {
      assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
      const session = await requireSession(req, ['admin']);
      const raw = await readBody(req); let body = {};
      try { body = JSON.parse(raw || '{}'); }
      catch { throw new RequestError('Dữ liệu gửi lên không hợp lệ.', 400, 'JSON_INVALID'); }
      const conversationActions = { list: listConversations, get: getConversation, create: createConversation, append: appendMessages, delete: deleteConversation };
      const action = String(body.action || '').trim();
      const run = conversationActions[action];
      if (!run) return sendJson(res, 400, {ok:false,error:'Hành động không hợp lệ.',code:'AI_CONVERSATION_ACTION_INVALID'});
      const result = await run(session, body);
      return sendJson(res, 200, {ok:true, ...result});
    }

    if (pathname === '/api/data') {
      assertSameOrigin(req);
      const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const classroomMode = requestUrl.searchParams.get('classroom') === '1';
      const classroomUsersMode = requestUrl.searchParams.get('classroomUsers') === '1';
      const classroomAttendanceMode = requestUrl.searchParams.get('classroomAttendance') === '1';
      const classroomLearningMode = requestUrl.searchParams.get('classroomLearning') === '1';
      const classroomMaterialsMode = requestUrl.searchParams.get('classroomMaterials') === '1';
      const classroomTestsMode = requestUrl.searchParams.get('classroomTests') === '1';
      const classroomProposalsMode = requestUrl.searchParams.get('classroomProposals') === '1';
      const classroomNotificationsMode = requestUrl.searchParams.get('classroomNotifications') === '1';
      const classroomSettingsMode = requestUrl.searchParams.get('classroomSettings') === '1';
      const checklistWorkspaceMode = requestUrl.searchParams.get('checklistWorkspace') === '1';
      const employeeMasterMode = requestUrl.searchParams.get('employeeMaster') === '1';
      if (req.method === 'GET') {
        const session = await requireSession(req, ['learner','manager','admin']);
        if(employeeMasterMode){
          const key=String(requestUrl.searchParams.get('key')||'').trim();
          return sendJson(res,200,{ok:true,...(key?await getEmployeeMasterDetail(session,{key}):await listEmployeeMaster(session))});
        }
        if (checklistWorkspaceMode) {
          const [workspace, templateData, violationMode] = await Promise.all([
            getChecklistRoleWorkspace(session),
            listChecklistTemplates({compact:true}),
            getChecklistViolationMode()
          ]);
          return sendJson(res,200,{
            ok:true,
            checklistWorkspace:true,
            employees:Array.isArray(workspace.people)?workspace.people.map(person=>({id:person.employeeId||'',employeeId:person.employeeId||'',code:person.employeeCode||'',employeeCode:person.employeeCode||'',name:person.employeeName||'',employeeName:person.employeeName||'',department:person.department||'',title:person.title||'',branch:person.branch||'',managerId:person.managerId||'',managerCode:person.managerCode||'',managerName:person.managerName||'',employeeStatus:person.employeeStatus||'',templateId:person.templateId||'',templateVersion:person.templateVersion||'',effectiveDate:person.effectiveDate||''})):[],
            checklistWorkspaceCompact:true,
            checklistAssignmentsReady:true,
            checklistAssignmentsError:'',
            checklistTemplates:Array.isArray(templateData.templates)?templateData.templates:[],
            checklistTemplatesReady:templateData.ready===true,
            checklistTemplatesError:templateData.error||'',
            checklistViolationMode:violationMode.mode||'test',
            checklistViolationModeReady:violationMode.ready===true,
            checklistViolationModeError:violationMode.error||'',
            generatedAt:new Date().toISOString()
          });
        }
        if (classroomUsersMode) {
          return sendJson(res, 200, { ok:true, users:await listClassroomUsers(session) });
        }
        if (classroomSettingsMode) return sendJson(res,200,{ok:true,...await getSettings(session)});
        if (classroomNotificationsMode) return sendJson(res,200,{ok:true,...await listNotifications(session)});
        if (classroomProposalsMode) return sendJson(res,200,{ok:true,...await listProposals(session)});
        if (classroomTestsMode) {
          return sendJson(res,200,{ok:true,...await listTests(session)});
        }
        if (classroomMaterialsMode) {
          const classId=String(requestUrl.searchParams.get('classId')||'').trim();
          const action=String(requestUrl.searchParams.get('action')||'').trim();
          if(action==='url') return sendJson(res,200,{ok:true,...await materialUrl(session,classId,String(requestUrl.searchParams.get('materialId')||''))});
          return sendJson(res,200,{ok:true,...await getMaterials(session,classId)});
        }
        if (classroomLearningMode) {
          const classId=String(requestUrl.searchParams.get('classId')||'').trim();
          if(!classId) throw new RequestError('Thiếu mã khóa học.',400,'CLASSROOM_CLASS_REQUIRED');
          return sendJson(res,200,{ok:true,...await getLearning(session,classId)});
        }
        if (classroomAttendanceMode) {
          const sessionId=String(requestUrl.searchParams.get('sessionId')||'').trim();
          if(!sessionId) throw new RequestError('Thiếu mã buổi học.',400,'CLASSROOM_SESSION_REQUIRED');
          return sendJson(res,200,{ok:true,...await listAttendance(session,sessionId)});
        }
        if (classroomMode) {
          const classId = String(requestUrl.searchParams.get('id') || '').trim();
          if (classId) return sendJson(res, 200, { ok:true, classroomClass:await getClass(session, classId) });
          return sendJson(res, 200, { ok:true, classes:await listClasses(session) });
        }
        const data = await readData({
          role: session.role,
          employeeId: session.role === 'learner' ? session.employeeId : '',
          activityLimit: session.role === 'learner' ? 100 : 200
        });
        const scoped = session.role === 'learner'
          ? filterDataForRequest(data, 'learner', session.employeeId, session.phone)
          : data;
        // Học viên/Báo cáo Training Hub phải dùng trạng thái phân công thật từ user_accounts.
        // Chỉ công bố các trường tối thiểu để ghép hồ sơ; không trả dữ liệu mật khẩu.
        if (session.role === 'admin' || session.role === 'manager') {
          try {
            const accounts = await listHubAccountSummaries();
            scoped.hubAccounts = (accounts || []).map(account => ({
              id: account.id || '',
              employeeId: account.employeeId || '',
              employeeCode: account.employeeCode || '',
              name: account.name || '',
              email: account.email || '',
              phone: account.phone || '',
              role: account.role || 'learner',
              status: account.status || 'active',
              accountType: account.accountType || 'employee',
              branch: account.branch || '',
              department: account.department || '',
              position: account.position || '',
              trainingAudience: account.trainingAudience || '',
              defaultProgram: account.defaultProgram || '',
              hubAssignmentStatus: account.hubAssignmentStatus || 'not_activated'
            }));
            scoped.hubAccountsReady = true;
            scoped.hubAccountsError = '';
          } catch (accountError) {
            console.warn('[PHF API] hub account summary unavailable', accountError?.message || accountError);
            scoped.hubAccounts = [];
            scoped.hubAccountsReady = false;
            scoped.hubAccountsError = 'HUB_ACCOUNT_SUMMARY_UNAVAILABLE';
          }
        }
        if (session.role === 'admin' || session.role === 'manager') {
          try {
            const assignmentData = await listChecklistAssignments();
            scoped.checklistAssignments = assignmentData.assignments;
            scoped.checklistAssignmentsReady = assignmentData.ready;
            scoped.checklistAssignmentsError = assignmentData.error;
          } catch (assignmentError) {
            console.warn('[PHF Checklist] assignment data unavailable', assignmentError?.message || assignmentError);
            scoped.checklistAssignments = [];
            scoped.checklistAssignmentsReady = false;
            scoped.checklistAssignmentsError = assignmentError?.code || 'CHECKLIST_ASSIGNMENTS_UNAVAILABLE';
          }
          try {
            const templateData = await listChecklistTemplates();
            scoped.checklistTemplates = templateData.templates;
            scoped.checklistTemplatesReady = templateData.ready;
            scoped.checklistTemplatesError = templateData.error;
          } catch (templateError) {
            console.warn('[PHF Checklist] template library unavailable', templateError?.message || templateError);
            scoped.checklistTemplates = [];
            scoped.checklistTemplatesReady = false;
            scoped.checklistTemplatesError = templateError?.code || 'CHECKLIST_TEMPLATES_UNAVAILABLE';
          }
          try {
            const violationMode = await getChecklistViolationMode();
            scoped.checklistViolationMode = violationMode.mode;
            scoped.checklistViolationModeReady = violationMode.ready;
            scoped.checklistViolationModeError = violationMode.error;
          } catch (modeError) {
            scoped.checklistViolationMode = 'test';
            scoped.checklistViolationModeReady = false;
            scoped.checklistViolationModeError = modeError?.code || 'CHECKLIST_VIOLATION_MODE_UNAVAILABLE';
          }
          try {
            const permissionData = await listChecklistPermissionGrants(session);
            scoped.checklistPermissionGrants = permissionData.grants;
            scoped.checklistPermissionPresets = permissionData.presets;
            scoped.checklistPermissionScopeTypes = permissionData.scopeTypes;
            scoped.checklistPermissionsReady = true;
            scoped.checklistPermissionsError = '';
          } catch (permissionError) {
            console.warn('[PHF Checklist] permission data unavailable', permissionError?.message || permissionError);
            scoped.checklistPermissionGrants = [];
            scoped.checklistPermissionPresets = [];
            scoped.checklistPermissionsReady = false;
            scoped.checklistPermissionsError = permissionError?.code || 'CHECKLIST_PERMISSIONS_UNAVAILABLE';
          }
        }
        return sendJson(res, 200, scoped);
      }
      if (req.method === 'POST') {
        assertJsonContentType(req);
        assertContentLength(req);
        const body = await readBody(req);
        let payload;
        try { payload = JSON.parse(body || '{}'); }
        catch { throw new RequestError('Dữ liệu JSON không hợp lệ.', 400, 'JSON_INVALID'); }
        const session = await requireSession(req, ['learner','manager','admin']);
        if(employeeMasterMode){
          const action=String(payload.action||'').trim();
          if(action==='saveProfile')return sendJson(res,200,{ok:true,...await saveEmployeeMasterProfile(session,payload)});
          if(action==='savePrivateProfile')return sendJson(res,200,{ok:true,...await saveEmployeeMasterPrivateProfile(session,payload)});
          if(action==='saveContract')return sendJson(res,200,{ok:true,...await saveEmployeeMasterContract(session,payload)});
          if(action==='saveCompensation')return sendJson(res,200,{ok:true,...await saveEmployeeMasterCompensation(session,payload)});
          if(action==='previewImport')return sendJson(res,200,{ok:true,...await previewEmployeeImport(session,payload)});
          if(action==='commitImport')return sendJson(res,200,{ok:true,...await commitEmployeeImport(session,payload)});
          throw new RequestError('Thao tác Employee Master không hợp lệ.',400,'EMPLOYEE_MASTER_ACTION_INVALID');
        }
        if (classroomUsersMode) {
          return sendJson(res, 200, { ok:true, users:await listClassroomUsers(session) });
        }
        if (classroomSettingsMode) {
          const action=String(payload.action||'').trim();
          if(action==='saveSettings') return sendJson(res,200,{ok:true,...await saveSettings(session,payload)});
          if(action==='resetSettings') return sendJson(res,200,{ok:true,...await resetSettings(session,payload)});
          if(action==='softDelete') return sendJson(res,200,{ok:true,...await softDelete(session,payload)});
          if(action==='restore') return sendJson(res,200,{ok:true,...await restore(session,payload)});
          if(action==='purge') return sendJson(res,200,{ok:true,...await purge(session,payload)});
          if(action==='history') return sendJson(res,200,{ok:true,...await listAudit(session)});
          throw new RequestError('Thao tác Cấu hình Classroom không hợp lệ.',400,'CLASSROOM_SETTINGS_ACTION_INVALID');
        }
        if (classroomNotificationsMode) {
          const action=String(payload.action||'').trim();
          if(action==='saveDraft'||action==='send') return sendJson(res,200,{ok:true,...await saveNotification(session,{...payload,action})});
          if(action==='markRead') return sendJson(res,200,{ok:true,...await markNotificationRead(session,payload)});
          if(action==='markAllRead') return sendJson(res,200,{ok:true,...await markAllNotificationsRead(session)});
          if(action==='hide') return sendJson(res,200,{ok:true,...await hideNotification(session,payload)});
          throw new RequestError('Thao tác thông báo Classroom không hợp lệ.',400,'CLASSROOM_NOTIFICATION_ACTION_INVALID');
        }
        if (classroomProposalsMode) {
          const action=String(payload.action||'').trim();
          if(action==='saveDraft'||action==='submit') return sendJson(res,200,{ok:true,...await saveProposal(session,{...payload,action})});
          if(['approve','requestRevision','reject','linkClass','complete'].includes(action)) return sendJson(res,200,{ok:true,...await reviewProposal(session,payload)});
          throw new RequestError('Thao tác đề xuất đào tạo không hợp lệ.',400,'CLASSROOM_PROPOSAL_ACTION_INVALID');
        }
        if (classroomTestsMode) {
          const action=String(payload.action||'').trim();
          if(action==='saveTest') return sendJson(res,200,{ok:true,...await saveTest(session,payload)});
          if(action==='saveAssignment') return sendJson(res,200,{ok:true,...await saveAssignment(session,payload)});
          if(action==='startAttempt') return sendJson(res,200,{ok:true,...await startAttempt(session,payload)});
          if(action==='submitAttempt') return sendJson(res,200,{ok:true,...await submitAttempt(session,payload)});
          if(action==='gradeAttempt') return sendJson(res,200,{ok:true,...await gradeAttempt(session,payload)});
          throw new RequestError('Thao tác bài kiểm tra Classroom không hợp lệ.',400,'CLASSROOM_TEST_ACTION_INVALID');
        }
        if (classroomMaterialsMode) {
          const action=String(payload.action||'').trim();
          if(action==='saveGroups') return sendJson(res,200,{ok:true,...await saveGroups(session,payload.classId,payload.groups)});
          if(action==='createUpload') return sendJson(res,200,{ok:true,...await createUpload(session,payload)});
          if(action==='finalizeUpload') return sendJson(res,200,{ok:true,...await finalizeUpload(session,payload)});
          if(action==='updateMaterial') return sendJson(res,200,{ok:true,...await updateMaterial(session,payload)});
          if(action==='confirmMaterial') return sendJson(res,200,{ok:true,...await confirmMaterial(session,payload)});
          throw new RequestError('Thao tác tài liệu Classroom không hợp lệ.',400,'CLASSROOM_MATERIAL_ACTION_INVALID');
        }
        if (classroomLearningMode) {
          const classId=String(payload.classId||requestUrl.searchParams.get('classId')||'').trim();
          const action=String(payload.action||'').trim();
          if(action==='saveLessons') return sendJson(res,200,{ok:true,...await saveLessons(session,classId,payload.lessons)});
          if(action==='openLesson'||action==='completeLesson') return sendJson(res,200,{ok:true,...await updateProgress(session,classId,String(payload.lessonId||''),action==='completeLesson'?'complete':'open')});
          throw new RequestError('Thao tác bài học Classroom không hợp lệ.',400,'CLASSROOM_LEARNING_ACTION_INVALID');
        }
        if (classroomAttendanceMode) {
          const saved=await saveAttendance(session,payload);
          return sendJson(res,200,{ok:true,...saved});
        }
        if (classroomMode) {
          const action=String(payload.action||'saveDraft');
          if (!['saveDraft','publish'].includes(action)) throw new RequestError('Thao tác Classroom không hợp lệ.',400,'CLASSROOM_ACTION_INVALID');
          const saved=await saveClass(session, payload.classroomClass||payload, { publish:action==='publish' });
          return sendJson(res, action==='publish'?200:201, {ok:true, classroomClass:saved});
        }
        if (payload && (payload.action === 'saveChecklistViolations' || payload.action === 'saveChecklistTestViolations')) {
          const saved=await saveChecklistViolations(session, payload.violations || []);
          if(saved.isTest!==true){
            const rowsByEmployee=new Map();
            for(const row of (saved.savedRows||[]).filter(row=>row.isNew===true)){
              const code=String(row.employeeCode||'').trim().toUpperCase();
              if(!code)continue;
              if(!rowsByEmployee.has(code))rowsByEmployee.set(code,[]);
              rowsByEmployee.get(code).push(row);
            }
            for(const [employeeCode,rows] of rowsByEmployee){
              const violationIds=rows.map(row=>String(row.id||'')).filter(Boolean);
              const period=(rows.map(row=>String(row.occurredDate||'')).filter(Boolean).sort().pop()||'').slice(0,7);
              const periodLabel=period?('Checklist tháng '+period.slice(5,7)+'/'+period.slice(0,4)+' · '+violationIds.length+' lỗi cần xác nhận.'):'';
              const targetPath='/hv/checklist?focus=violation&violation_id='+encodeURIComponent(violationIds.join(','))+(period?'&period='+period:'');
              await emitChecklistNotificationSafe('VIOLATION_CREATED',{recipient:{employeeCode},title:'Có lỗi Checklist mới',message:'Bạn có lỗi mới cần xác nhận hoặc giải trình.'+(periodLabel?' '+periodLabel:''),targetPath,subjectType:'violation',subjectId:violationIds.join(','),dedupeKey:'violation|'+employeeCode+'|'+Date.now()});
            }
          }
          return sendJson(res, 200, {ok:true,...saved});
        }
        if (payload && payload.action === 'listChecklistViolations') {
          return sendJson(res, 200, {ok:true,...await listChecklistViolations(session, payload)});
        }
        if (payload && payload.action === 'listChecklistTasks') {
          return sendJson(res, 200, {ok:true,...await listChecklistTasks(session, payload)});
        }
        if(payload&&payload.action==='getChecklistTaskHistory')return sendJson(res,200,{ok:true,...await getChecklistTaskHistory(session,payload)});
        if(payload&&payload.action==='getChecklistViolationDetail')return sendJson(res,200,{ok:true,...await getChecklistViolationDetail(session,payload)});
        if(payload&&payload.action==='transitionChecklistTask'){
          const result=await transitionChecklistTask(session,payload),task=result.task||{},event=payload.taskAction==='employee_explain'?'EXPLANATION_SUBMITTED':'VIOLATION_DUE_SOON';
          if(payload.taskAction==='employee_explain')await emitChecklistNotificationSafe(event,{recipient:{accountId:task.current_assignee_id,employeeCode:task.current_assignee_code},title:'Có giải trình lỗi cần phản hồi',message:'Nhân viên đã gửi giải trình; vui lòng phản hồi.',targetPath:'/admin/checklist/viec-can-xu-ly?focus=violation&violation_id='+encodeURIComponent(task.violation_id||''),subjectType:'violation',subjectId:task.violation_id||'',dedupeKey:'task|'+task.id+'|'+task.status+'|'+task.updated_at});
          return sendJson(res,200,{ok:true,...result});
        }
        if (payload && payload.action === 'listChecklistViolationHistory') {
          return sendJson(res, 200, {ok:true,...await listChecklistViolationHistory(session, payload)});
        }
        if (payload && payload.action === 'getChecklistViolationTaskStatus') {
          return sendJson(res, 200, {ok:true,...await getChecklistViolationTaskStatus(session, payload)});
        }
        if (payload && payload.action === 'deleteChecklistTestViolations') {
          return sendJson(res, 200, {ok:true,...await deleteChecklistTestViolations(session, payload)});
        }
        if (payload && payload.action === 'updateChecklistViolation') {
          return sendJson(res, 200, {ok:true,...await updateChecklistViolation(session, payload)});
        }
        if (payload && payload.action === 'cancelChecklistViolation') {
          return sendJson(res, 200, {ok:true,...await cancelChecklistViolation(session, payload)});
        }
        if (payload && payload.action === 'deleteChecklistTestViolation') {
          return sendJson(res, 200, {ok:true,...await deleteChecklistTestViolation(session, payload)});
        }
        if (payload && payload.action === 'createChecklistEvidenceUpload') {
          return sendJson(res, 200, {ok:true,...await createChecklistEvidenceUpload(session, payload)});
        }
        if (payload && payload.action === 'finalizeChecklistEvidenceUpload') {
          return sendJson(res, 200, {ok:true,...await finalizeChecklistEvidenceUpload(session, payload)});
        }
        if (payload && payload.action === 'attachChecklistEvidence') {
          return sendJson(res, 200, {ok:true,...await attachChecklistEvidence(session, payload)});
        }
        if (payload && payload.action === 'listChecklistEvidence') {
          return sendJson(res, 200, {ok:true,...await listChecklistEvidence(session, payload)});
        }
        if (payload && payload.action === 'deleteChecklistEvidence') {
          return sendJson(res, 200, {ok:true,...await deleteChecklistEvidence(session, payload)});
        }
        if (payload && payload.action === 'saveChecklistAssignments') {
          const saved = await saveChecklistAssignments(session, payload.assignments || []);
          return sendJson(res, 200, {ok:true,...saved});
        }
        if (payload && payload.action === 'saveChecklistTemplate') {
          const saved = await saveChecklistTemplate(session, payload.template || {});
          return sendJson(res, 200, {ok:true,...saved});
        }
        if (payload && payload.action === 'saveChecklistTemplateLibrary') {
          const saved = await saveChecklistTemplateLibrary(session, payload.templates || []);
          return sendJson(res, 200, {ok:true,...saved});
        }
        if (payload && payload.action === 'listChecklistPermissionGrants') {
          return sendJson(res, 200, {ok:true,...await listChecklistPermissionGrants(session,{includeInactive:payload.includeInactive===true})});
        }
        if (payload && payload.action === 'saveChecklistPermissionGrants') {
          const saved=await saveChecklistPermissionGrants(session,payload.grants || []);
          for(const grant of saved.grants||[])await emitChecklistNotificationSafe('PERMISSION_CHANGED',{recipient:{accountId:grant.accountId,employeeCode:grant.employeeCode},title:'Quyền Checklist đã thay đổi',message:'Quyền Checklist của bạn đã được cập nhật.',targetPath:'/ql/checklist',subjectType:'permission_grant',subjectId:grant.id,dedupeKey:'permission|'+grant.id+'|'+grant.updatedAt});
          return sendJson(res, 200, {ok:true,...saved});
        }
        if (payload && payload.action === 'disableChecklistPermissionGrant') {
          return sendJson(res, 200, {ok:true,...await disableChecklistPermissionGrant(session,payload)});
        }
        if (payload && payload.action === 'getChecklistRoleWorkspace') {
          return sendJson(res, 200, {ok:true,...await getChecklistRoleWorkspace(session)});
        }
        if(payload&&payload.action==='listChecklistNotificationRules')return sendJson(res,200,{ok:true,...await listChecklistNotificationRules(session)});
        if(payload&&payload.action==='saveChecklistNotificationRule')return sendJson(res,200,{ok:true,...await saveChecklistNotificationRule(session,payload)});
        if(payload&&payload.action==='listMyChecklistNotifications')return sendJson(res,200,{ok:true,...await listMyChecklistNotifications(session,payload)});
        if(payload&&payload.action==='markChecklistNotificationRead')return sendJson(res,200,{ok:true,...await markChecklistNotificationRead(session,payload)});
        if(payload&&payload.action==='markAllChecklistNotificationsRead')return sendJson(res,200,{ok:true,...await markAllChecklistNotificationsRead(session)});
        if(payload&&payload.action==='getMarketingMonthlyKpiConfig')return sendJson(res,200,{ok:true,...await getMarketingMonthlyKpiConfig(session,payload)});
        if(payload&&payload.action==='saveMarketingMonthlyKpiConfig')return sendJson(res,200,{ok:true,...await saveMarketingMonthlyKpiConfig(session,payload)});
        if(payload&&payload.action==='listChecklistMonthly')return sendJson(res,200,{ok:true,...await listMonthly(session,payload)});
        if(payload&&payload.action==='createChecklistMonthly')return sendJson(res,200,{ok:true,...await createMonthly(session,payload)});
        if(payload&&payload.action==='openChecklistMonthly')return sendJson(res,200,{ok:true,...await openMonthly(session,payload)});
        if(payload&&payload.action==='lockChecklistMonthly')return sendJson(res,200,{ok:true,...await lockMonthly(session,payload)});
        if(payload&&payload.action==='openChecklistMonthlyException')return sendJson(res,200,{ok:true,...await openMonthlyException(session,payload)});
        if(payload&&payload.action==='openChecklistMonthlyPilot')return sendJson(res,200,{ok:true,...await openMonthlyPilot(session,payload)});
        if(payload&&payload.action==='getMyChecklistMonthly')return sendJson(res,200,{ok:true,...await myMonthlyForm(session,payload)});
        if(payload&&payload.action==='getChecklistAssessmentProfile')return sendJson(res,200,{ok:true,...await getChecklistAssessmentProfile(session,payload)});
        if(payload&&payload.action==='saveMyChecklistMonthly'){
          const saved=await saveMyMonthly(session,payload);
          if(payload.submit===true&&saved.form)await emitChecklistNotificationSafe('SELF_REVIEW_SUBMITTED',{recipient:{accountId:saved.form.reviewer_id,employeeCode:saved.form.reviewer_code},title:'Có phiếu tháng chờ thẩm định',targetPath:'/ql/checklist/phieu-danh-gia-thang',subjectType:'monthly_form',subjectId:saved.form.id,dedupeKey:'monthly-self|'+saved.form.id+'|'+(saved.form.self_submitted_at||Date.now()),variables:{TEN_NHAN_VIEN:saved.form.employee_name,KY_DANH_GIA:saved.form.period_month}});
          return sendJson(res,200,{ok:true,...saved});
        }
        if(payload&&payload.action==='listMyChecklistMonthlyReviews')return sendJson(res,200,{ok:true,...await myMonthlyReviews(session,{...payload,summary:true})});
        if(payload&&payload.action==='getMyChecklistMonthlyReviewDetail')return sendJson(res,200,{ok:true,...await myMonthlyReviewDetail(session,payload)});
        if(payload&&payload.action==='saveChecklistMonthlyReview')return sendJson(res,200,{ok:true,...await saveMonthlyReview(session,payload)});
        if(payload&&payload.action==='changeChecklistMonthlyReviewer')return sendJson(res,200,{ok:true,...await changeMonthlyReviewer(session,payload)});
        if(payload&&payload.action==='exportChecklistMonthlyData')return sendJson(res,200,{ok:true,...await exportMonthlyData(session,payload)});
        if(payload&&payload.action==='getChecklistMonthlyReport')return sendJson(res,200,{ok:true,...await getChecklistMonthlyReport(session,payload)});
        if(payload&&payload.action==='getChecklistCurrentScoreReport')return sendJson(res,200,{ok:true,...await getChecklistCurrentScoreReport(session,payload)});
        if(payload&&payload.action==='getChecklistScorePeriodReport')return sendJson(res,200,{ok:true,...await getChecklistScorePeriodReport(session,payload)});
        if(payload&&payload.action==='getChecklistViolationWorkflowSummary')return sendJson(res,200,{ok:true,...await getChecklistViolationWorkflowSummary(session,payload)});
        if(payload&&payload.action==='inspectChecklistMonthlyRecovery')return sendJson(res,200,{ok:true,...await inspectMonthlyRecovery(session,payload)});
        if(payload&&payload.action==='createMissingChecklistMonthlyForms')return sendJson(res,200,{ok:true,...await createMissingMonthlyForms(session,payload)});
        if(payload&&payload.action==='getChecklistMonthlyDeletePreview')return sendJson(res,200,{ok:true,...await getMonthlyDeletePreview(session,payload)});
        if(payload&&payload.action==='deleteChecklistMonthlyFormException')return sendJson(res,200,{ok:true,...await deleteMonthlyFormException(session,payload)});
      if(payload&&payload.action==='getChecklistLatePointsPolicy')return sendJson(res,200,{ok:true,...await getChecklistLatePointsPolicy(session,payload)});
      if(payload&&payload.action==='saveChecklistLatePointsPolicy')return sendJson(res,200,{ok:true,...await saveChecklistLatePointsPolicy(session,payload)});
      if(payload&&payload.action==='getChecklistRepeatViolationPolicy')return sendJson(res,200,{ok:true,...await getChecklistRepeatViolationPolicy(session,payload)});
      if(payload&&payload.action==='saveChecklistRepeatViolationPolicy')return sendJson(res,200,{ok:true,...await saveChecklistRepeatViolationPolicy(session,payload)});
      if(payload&&payload.action==='getChecklistRepeatViolationSuggestions')return sendJson(res,200,{ok:true,...await getChecklistRepeatViolationSuggestions(session,payload)});
      if(payload&&payload.action==='getChecklistMonthlyScorePolicy')return sendJson(res,200,{ok:true,...await getChecklistMonthlyScorePolicy(session,payload)});
      if(payload&&payload.action==='saveChecklistMonthlyScorePolicy')return sendJson(res,200,{ok:true,...await saveChecklistMonthlyScorePolicy(session,payload)});
      if(payload&&payload.action==='getChecklistMonthlyCyclePolicy')return sendJson(res,200,({ok:true,...await getMonthlyCyclePolicy(session,payload)}));
      if(payload&&payload.action==='saveChecklistMonthlyCyclePolicy')return sendJson(res,200,({ok:true,...await saveMonthlyCyclePolicy(session,payload)}));
      if(payload&&payload.action==='saveChecklistMonthlyCycleOverride')return sendJson(res,200,({ok:true,...await saveMonthlyCycleOverride(session,payload)}));
      if(payload&&payload.action==='syncChecklistMonthlyCycle')return sendJson(res,200,({ok:true,...await syncMonthlyCycle(session,payload)}));
      if(payload&&payload.action==='getChecklistMonthlyOverduePolicy')return sendJson(res,200,{ok:true,...await getMonthlyOverduePolicy(session,payload)});
      if(payload&&payload.action==='saveChecklistMonthlyOverduePolicy')return sendJson(res,200,{ok:true,...await saveMonthlyOverduePolicy(session,payload)});
      if(payload&&payload.action==='processChecklistMonthlyOverdue')return sendJson(res,200,{ok:true,...await processMonthlySelfOverdue(session,payload)});
      if(payload&&payload.action==='getKnlCapabilities')return sendJson(res,200,{ok:true,...await getKnlCapabilities(session)});
      if(payload&&payload.action==='listKnlPeople')return sendJson(res,200,{ok:true,...await listKnlPeople(session,payload)});
      if(payload&&payload.action==='listKnlPermissionGrants')return sendJson(res,200,{ok:true,...await listKnlPermissionGrants(session)});
      if(payload&&payload.action==='upsertKnlPermissionGrant')return sendJson(res,200,{ok:true,...await upsertKnlPermissionGrant(session,payload.grant||{})});
      if(payload&&payload.action==='listKnlAccountsForPermission'){
        await requireManagePermissionsForSession(session);
        const accounts=(await listHubAccountSummaries()).map(a=>({id:a.id||'',name:a.name||'',email:a.email||'',employeeCode:a.employeeCode||'',role:a.role||'',department:a.department||'',branch:a.branch||'',position:a.position||''}));
        return sendJson(res,200,{ok:true,accounts});
      }
      if(payload&&payload.action==='listKnlFrameworks')return sendJson(res,200,{ok:true,...await listKnlFrameworks(session)});
      if(payload&&payload.action==='getKnlFrameworkVersion')return sendJson(res,200,{ok:true,...await getKnlFrameworkVersion(session,payload)});
      if(payload&&payload.action==='createKnlFramework')return sendJson(res,200,{ok:true,...await createKnlFramework(session,payload.framework||{})});
      if(payload&&payload.action==='saveKnlFramework')return sendJson(res,200,{ok:true,...await saveKnlFramework(session,payload.framework||{})});
      if(payload&&payload.action==='cloneKnlVersion')return sendJson(res,200,{ok:true,...await cloneKnlVersion(session,payload)});
      if(payload&&payload.action==='publishKnlVersion')return sendJson(res,200,{ok:true,...await publishKnlVersion(session,payload)});
      if(payload&&payload.action==='saveKnlGroup')return sendJson(res,200,{ok:true,...await saveKnlGroup(session,payload.group||{})});
      if(payload&&payload.action==='saveKnlItem')return sendJson(res,200,{ok:true,...await saveKnlItem(session,payload.item||{})});
      if(payload&&payload.action==='saveKnlColumn')return sendJson(res,200,{ok:true,...await saveKnlColumn(session,payload.column||{})});
      if(payload&&payload.action==='deleteKnlStructure')return sendJson(res,200,{ok:true,...await deleteKnlStructure(session,payload)});
      if(payload&&payload.action==='disableKnlStructure')return sendJson(res,200,{ok:true,...await disableKnlStructure(session,payload)});
      if(payload&&payload.action==='reorderKnlStructure')return sendJson(res,200,{ok:true,...await reorderKnlStructure(session,payload)});
      if(payload&&payload.action==='saveKnlLevelContent')return sendJson(res,200,{ok:true,...await saveKnlLevelContent(session,payload.levelContent||{})});
        payload = authorizePayload(session, payload);
        payload.actorName = session.account?.name || session.account?.email || '';
        payload.actorRole = session.role;
        payload.actorEmail = session.account?.email || session.email || '';
        payload.actorAccountId = session.account?.id || session.sub || '';
        if (payload.confidentialityCommitment) {
          payload.employee = {
            ...(payload.employee || {}),
            id: session.role === 'learner'
              ? session.employeeId
              : (payload.employee && payload.employee.id)
          };
        }
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

    const evidenceMatch = pathname.match(/^\/evidence\/([^/]+)$/);
    if (evidenceMatch) {
      const session = await requireSession(req, ['learner', 'manager', 'admin']);
      return streamChecklistEvidenceDownload(req, res, session, decodeURIComponent(evidenceMatch[1]));
    }

    let filePath = /^\/print\/commitments\/[^/]+$/.test(pathname)
      ? path.join(ROOT, 'print-commitment.html')
      : /^\/print\/evaluations\/[^/]+$/.test(pathname)
        ? path.join(ROOT, 'print-evaluation.html')
        : /^\/forms\/[^/]+\/print$/.test(pathname)
          ? path.join(ROOT, 'print-form.html')
          : safeStaticPath(req.url || '/');
    let isIndexShell = Boolean(filePath && path.resolve(filePath) === INDEX_HTML_PATH);
    if (!filePath || (!isIndexShell && (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()))) {
      const acceptsHtml = String(req.headers.accept || '').includes('text/html');
      const isUiRoute = acceptsHtml && !pathname.startsWith('/api/') && !path.extname(pathname);
      if (isUiRoute) {
        filePath = INDEX_HTML_PATH;
        isIndexShell = true;
      }
      else {
        res.writeHead(404, baseHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
        return res.end('404 - Không tìm thấy');
      }
    }
    const indexBuffer = isIndexShell ? readIndexHtmlFresh() : null;
    const contentLength = isIndexShell ? indexBuffer.length : fs.statSync(filePath).size;
    const headers = baseHeaders({
      'Content-Type': getMime(filePath),
      'Content-Length': contentLength,
      'Cache-Control': staticCacheControl(filePath, req.url, pathname)
    });
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    if (isIndexShell) return res.end(indexBuffer);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('[PHF API]', err?.code || err?.name || 'ERROR', err?.message || err);
    const response = publicError(err);
    sendJson(res, response.status, response.body);
  }
});

const HOST = process.env.HOST || '0.0.0.0';


async function runChecklistMonthlyScheduler(){
  if(String(process.env.CHECKLIST_MONTHLY_SCHEDULER_ENABLED||'true').toLowerCase()==='false')return;
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SECRET_KEY)return;
  try{
    const month=new Date().toISOString().slice(0,7);
    const session={role:'admin',sub:'system-checklist-scheduler',account:{id:'system-checklist-scheduler',name:'PHF Checklist Scheduler',employeeCode:'SYSTEM'}};
    const result=await syncMonthlyCycle(session,{month,automatic:true});
    console.log('[PHF Checklist scheduler]',month,result.synced===false?result.skipped:('created='+Number(result.created||0)+', opened='+Boolean(result.opened)+', locked='+Boolean(result.locked)+', lockBlocked='+Boolean(result.lockBlocked)));
  }catch(error){console.error('[PHF Checklist scheduler]',error&&error.message||error);}
}

server.listen(PORT, HOST, () => {
  const publicUrl = String(process.env.PHF_PUBLIC_URL || '').trim();
  console.log(`PHF Training Hub đang chạy tại ${publicUrl || `http://${HOST}:${PORT}`}`);
  const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
  const allowLocalData = String(process.env.PHF_ALLOW_LOCAL_DATA || '').trim().toLowerCase() === 'true';
  if (hasSupabase) console.log('Dữ liệu lưu trên Supabase.');
  else if (allowLocalData) console.warn('Dữ liệu đang lưu local theo PHF_ALLOW_LOCAL_DATA=true. Chỉ dùng khi chủ động chạy thử.');
  else console.error('Thiếu cấu hình Supabase: API dữ liệu sẽ báo lỗi rõ ràng và không tự lưu sang data.json.');
  if(hasSupabase&&String(process.env.CHECKLIST_MONTHLY_SCHEDULER_ENABLED||'true').toLowerCase()!=='false'){setTimeout(runChecklistMonthlyScheduler,30000);setInterval(runChecklistMonthlyScheduler,60*60*1000);}
});
