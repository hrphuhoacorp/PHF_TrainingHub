'use strict';

const { readData, saveData } = require('../lib/db');
const { listClasses, getClass, saveClass, listAttendance, saveAttendance } = require('../lib/classroom-db');
const { getLearning, saveLessons, updateProgress } = require('../lib/classroom-learning');
const { getMaterials, saveGroups, createUpload, finalizeUpload, updateMaterial, materialUrl, confirmMaterial } = require('../lib/classroom-materials');
const { listTests, saveTest, saveAssignment, startAttempt, submitAttempt, gradeAttempt } = require('../lib/classroom-tests');
const { listClassroomUsers } = require('../lib/classroom-users');
const { listProposals, saveProposal, reviewProposal } = require('../lib/classroom-proposals');
const { listNotifications, saveNotification, markNotificationRead, markAllNotificationsRead, hideNotification } = require('../lib/classroom-notifications');
const { getSettings, saveSettings, resetSettings, softDelete, restore, purge, listAudit } = require('../lib/classroom-settings');
const {
  assertSameOrigin,
  assertJsonContentType,
  assertContentLength,
  validatePayload,
  publicError
} = require('../lib/request-guard');
const { requireSession, authorizePayload, listHubAccountSummaries } = require('../lib/auth');


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

function setHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
}

module.exports = async function handler(req, res) {
  setHeaders(res);
  try {
    assertSameOrigin(req);
    if (req.method === 'GET') {
      const session = await requireSession(req, ['learner','manager','admin']);
      const classroomMode = String(req.query?.classroom || '') === '1';
      const classroomUsersMode = String(req.query?.classroomUsers || '') === '1';
      const classroomAttendanceMode = String(req.query?.classroomAttendance || '') === '1';
      const classroomLearningMode = String(req.query?.classroomLearning || '') === '1';
      const classroomMaterialsMode = String(req.query?.classroomMaterials || '') === '1';
      const classroomTestsMode = String(req.query?.classroomTests || '') === '1';
      const classroomProposalsMode = String(req.query?.classroomProposals || '') === '1';
      const classroomNotificationsMode = String(req.query?.classroomNotifications || '') === '1';
      const classroomSettingsMode = String(req.query?.classroomSettings || '') === '1';
      // Classroom 1.10: xử lý danh sách user chuyên biệt trước GET /api/data chung.
      // Nếu bỏ nhánh này, Vercel sẽ trả toàn bộ payload Training Hub dù HTTP vẫn là 200.
      if (classroomSettingsMode) return res.status(200).json({ok:true,...await getSettings(session)});
      if (classroomNotificationsMode) return res.status(200).json({ok:true,...await listNotifications(session)});
      if (classroomUsersMode) {
        return res.status(200).json({ ok: true, users: await listClassroomUsers(session) });
      }
      if (classroomProposalsMode) return res.status(200).json({ok:true,...await listProposals(session)});
      if (classroomTestsMode) return res.status(200).json({ok:true,...await listTests(session)});
      if (classroomMaterialsMode) {
        const classId=String(req.query?.classId||'').trim(),action=String(req.query?.action||'').trim();
        if(action==='url')return res.status(200).json({ok:true,...await materialUrl(session,classId,String(req.query?.materialId||''))});
        return res.status(200).json({ok:true,...await getMaterials(session,classId)});
      }
      if (classroomLearningMode) {
        const classId=String(req.query?.classId||'').trim();
        if(!classId)return res.status(400).json({ok:false,code:'CLASSROOM_CLASS_REQUIRED',message:'Thiếu mã khóa học.'});
        return res.status(200).json({ok:true,...await getLearning(session,classId)});
      }
      if (classroomAttendanceMode) {
        const sessionId=String(req.query?.sessionId||'').trim();
        if(!sessionId)return res.status(400).json({ok:false,code:'CLASSROOM_SESSION_REQUIRED',message:'Thiếu mã buổi học.'});
        return res.status(200).json({ok:true,...await listAttendance(session,sessionId)});
      }
      if (classroomMode) {
        const classId=String(req.query?.id||'').trim();
        if(classId)return res.status(200).json({ok:true,classroomClass:await getClass(session,classId)});
        return res.status(200).json({ok:true,classes:await listClasses(session)});
      }
      const data = await readData({
        role: session.role,
        employeeId: session.role === 'learner' ? session.employeeId : '',
        activityLimit: session.role === 'learner' ? 100 : 200
      });
      const scoped = session.role === 'learner' ? filterDataForRequest(data, 'learner', session.employeeId, session.phone) : data;
      // PHF 62.24: Học viên/Báo cáo Hub cần trạng thái phân công thật từ user_accounts.
      // Chỉ công bố các trường tối thiểu để ghép hồ sơ và lọc Hub; không trả dữ liệu mật khẩu.
      if (session.role === 'admin' || session.role === 'manager') {
        try {
          const accounts = await listHubAccountSummaries();
          scoped.hubAccounts = (accounts || []).map(account => ({
            id: account.id || '',
            employeeId: account.employeeId || '',
            employeeCode: account.employeeCode || '',
            email: account.email || '',
            phone: account.phone || '',
            role: account.role || 'learner',
            status: account.status || 'active',
            accountType: account.accountType || 'employee',
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
      return res.status(200).json(scoped);
    }
    if (req.method === 'POST') {
      assertJsonContentType(req);
      assertContentLength(req);
      const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const session = await requireSession(req, ['learner','manager','admin']);
      const classroomMode = String(req.query?.classroom || '') === '1';
      const classroomAttendanceMode = String(req.query?.classroomAttendance || '') === '1';
      const classroomLearningMode = String(req.query?.classroomLearning || '') === '1';
      const classroomMaterialsMode = String(req.query?.classroomMaterials || '') === '1';
      const classroomTestsMode = String(req.query?.classroomTests || '') === '1';
      const classroomProposalsMode = String(req.query?.classroomProposals || '') === '1';
      const classroomNotificationsMode = String(req.query?.classroomNotifications || '') === '1';
      const classroomSettingsMode = String(req.query?.classroomSettings || '') === '1';
      if(classroomSettingsMode){
        const action=String(payload.action||'').trim();
        if(action==='saveSettings') return res.status(200).json({ok:true,...await saveSettings(session,payload)});
        if(action==='resetSettings') return res.status(200).json({ok:true,...await resetSettings(session,payload)});
        if(action==='softDelete') return res.status(200).json({ok:true,...await softDelete(session,payload)});
        if(action==='restore') return res.status(200).json({ok:true,...await restore(session,payload)});
        if(action==='purge') return res.status(200).json({ok:true,...await purge(session,payload)});
        if(action==='history') return res.status(200).json({ok:true,...await listAudit(session)});
        throw new RequestError('Thao tác Cấu hình Classroom không hợp lệ.',400,'CLASSROOM_SETTINGS_ACTION_INVALID');
      }
      if(classroomNotificationsMode){
        const action=String(payload.action||'').trim();
        if(action==='saveDraft'||action==='send') return res.status(200).json({ok:true,...await saveNotification(session,{...payload,action})});
        if(action==='markRead') return res.status(200).json({ok:true,...await markNotificationRead(session,payload)});
        if(action==='markAllRead') return res.status(200).json({ok:true,...await markAllNotificationsRead(session)});
        if(action==='hide') return res.status(200).json({ok:true,...await hideNotification(session,payload)});
        throw new RequestError('Thao tác thông báo Classroom không hợp lệ.',400,'CLASSROOM_NOTIFICATION_ACTION_INVALID');
      }
      if(classroomProposalsMode){
        const action=String(payload.action||'').trim();
        if(action==='saveDraft'||action==='submit') return res.status(200).json({ok:true,...await saveProposal(session,{...payload,action})});
        if(['approve','requestRevision','reject','linkClass','complete'].includes(action)) return res.status(200).json({ok:true,...await reviewProposal(session,payload)});
        const e=new Error('Thao tác đề xuất đào tạo không hợp lệ.');e.statusCode=400;e.code='CLASSROOM_PROPOSAL_ACTION_INVALID';throw e;
      }
      if(classroomTestsMode){
        const action=String(payload.action||'').trim();
        if(action==='saveTest') return res.status(200).json({ok:true,...await saveTest(session,payload)});
        if(action==='saveAssignment') return res.status(200).json({ok:true,...await saveAssignment(session,payload)});
        if(action==='startAttempt') return res.status(200).json({ok:true,...await startAttempt(session,payload)});
        if(action==='submitAttempt') return res.status(200).json({ok:true,...await submitAttempt(session,payload)});
        if(action==='gradeAttempt') return res.status(200).json({ok:true,...await gradeAttempt(session,payload)});
        throw new RequestError('Thao tác bài kiểm tra Classroom không hợp lệ.',400,'CLASSROOM_TEST_ACTION_INVALID');
      }
      if(classroomMaterialsMode){
        const action=String(payload.action||'').trim();
        if(action==='saveGroups')return res.status(200).json({ok:true,...await saveGroups(session,payload.classId,payload.groups)});
        if(action==='createUpload')return res.status(200).json({ok:true,...await createUpload(session,payload)});
        if(action==='finalizeUpload')return res.status(200).json({ok:true,...await finalizeUpload(session,payload)});
        if(action==='updateMaterial')return res.status(200).json({ok:true,...await updateMaterial(session,payload)});
        if(action==='confirmMaterial')return res.status(200).json({ok:true,...await confirmMaterial(session,payload)});
        const e=new Error('Thao tác tài liệu Classroom không hợp lệ.');e.statusCode=400;e.code='CLASSROOM_MATERIAL_ACTION_INVALID';throw e;
      }
      if(classroomLearningMode){
        const classId=String(payload.classId||req.query?.classId||'').trim(),action=String(payload.action||'').trim();
        if(action==='saveLessons')return res.status(200).json({ok:true,...await saveLessons(session,classId,payload.lessons)});
        if(action==='openLesson'||action==='completeLesson')return res.status(200).json({ok:true,...await updateProgress(session,classId,String(payload.lessonId||''),action==='completeLesson'?'complete':'open')});
        const e=new Error('Thao tác bài học Classroom không hợp lệ.');e.statusCode=400;e.code='CLASSROOM_LEARNING_ACTION_INVALID';throw e;
      }
      if(classroomAttendanceMode){
        const saved=await saveAttendance(session,payload);
        return res.status(200).json({ok:true,...saved});
      }
      if(classroomMode){
        const action=String(payload.action||'saveDraft');
        if(!['saveDraft','publish'].includes(action)){const e=new Error('Thao tác Classroom không hợp lệ.');e.statusCode=400;e.code='CLASSROOM_ACTION_INVALID';throw e;}
        const saved=await saveClass(session,payload.classroomClass||payload,{publish:action==='publish'});
        return res.status(action==='publish'?200:201).json({ok:true,classroomClass:saved});
      }
      authorizePayload(session, payload);
      payload.actorName = session.account?.name || session.account?.email || '';
      payload.actorRole = session.role;
      payload.actorEmail = session.account?.email || session.email || '';
      payload.actorAccountId = session.account?.id || session.sub || '';
      if (session.role === 'learner') {
        const officialEmployeeId = String(session.employeeId || session.account?.employeeId || '').trim();
        if (!officialEmployeeId) {
          const error = new Error('Tài khoản học viên chưa liên kết với hồ sơ nhân viên. Vui lòng liên hệ Admin kiểm tra mã nhân viên hoặc số điện thoại.');
          error.statusCode = 409;
          error.code = 'EMPLOYEE_ACCOUNT_NOT_LINKED';
          throw error;
        }
        payload.employee = {...(payload.employee || {}), id: officialEmployeeId};
      } else if (payload.confidentialityCommitment) {
        payload.employee = {...(payload.employee || {}), id: payload.employee && payload.employee.id};
      }
      validatePayload(payload);
      const result = await saveData(payload);
      if (result && result.data && session.role === 'learner') {
        result.data = filterDataForRequest(result.data, 'learner', session.employeeId, session.phone);
      }
      return res.status(200).json(result);
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Phương thức không được hỗ trợ.', code: 'METHOD_NOT_ALLOWED' });
  } catch (err) {
    console.error('[PHF API]', err?.code || err?.name || 'ERROR', err?.message || err);
    const response = publicError(err);
    return res.status(response.status).json(response.body);
  }
};
