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
const { listChecklistAssignments, saveChecklistAssignments } = require('../lib/checklist-assignments');
const { listChecklistTemplates, saveChecklistTemplate, saveChecklistTemplateLibrary } = require('../lib/checklist-templates');
const {
  recordManagerLateObservation,
  listManagerLateObservations,
  listAdminLateManagerObservations: listAdminChecklistLateManagerObservations,
  recordShiftLeadLateObservation,
  listShiftLeadLateObservations,
  previewBccUpload: previewChecklistLateBccUpload,
  createBccImport: createChecklistLateBccImport,
  reconcileBccImport: reconcileChecklistLateBccImport,
  approveLateEvents: approveChecklistLateEvents,
  createLinkedAdjustment: createChecklistLateLinkedAdjustment,
  exportLateReconciliation: exportChecklistLateReconciliation
} = require('../lib/checklist-late-reconciliation-service');
const { getChecklistViolationMode, getChecklistLatePointsPolicy, saveChecklistLatePointsPolicy, getChecklistRepeatViolationPolicy, saveChecklistRepeatViolationPolicy, getChecklistRepeatViolationSuggestions, saveChecklistViolations, listChecklistViolations, listChecklistViolationHistory, getChecklistViolationTaskStatus, updateChecklistViolation, cancelChecklistViolation, deleteChecklistTestViolation, deleteChecklistTestViolations } = require('../lib/checklist-violations');
const { createChecklistEvidenceUpload, finalizeChecklistEvidenceUpload, attachChecklistEvidence, listChecklistEvidence, deleteChecklistEvidence } = require('../lib/checklist-evidence');
const { listChecklistTasks, transitionChecklistTask, getChecklistTaskHistory, getChecklistViolationDetail } = require('../lib/checklist-tasks');
const { listChecklistPermissionGrants, saveChecklistPermissionGrants, disableChecklistPermissionGrant, getChecklistRoleWorkspace } = require('../lib/checklist-permissions');
const { getMarketingMonthlyKpiConfig, saveMarketingMonthlyKpiConfig, listMonthly, createMonthly, openMonthly, lockMonthly, openMonthlyException, openMonthlyPilot, myMonthlyForm, saveMyMonthly, myMonthlyReviews, myMonthlyReviewDetail, saveMonthlyReview, changeMonthlyReviewer, exportMonthlyData, getMonthlyOverduePolicy, saveMonthlyOverduePolicy, processMonthlySelfOverdue, getChecklistMonthlyScorePolicy, saveChecklistMonthlyScorePolicy, getMonthlyCyclePolicy, saveMonthlyCyclePolicy, saveMonthlyCycleOverride, syncMonthlyCycle, getChecklistAssessmentProfile } = require('../lib/checklist-monthly');
const { getChecklistMonthlyReport, getChecklistViolationWorkflowSummary, getChecklistCurrentScoreReport, getChecklistScorePeriodReport, getChecklistAnnualResultReport } = require('../lib/checklist-reports');
const { inspectMonthlyRecovery, createMissingMonthlyForms, getMonthlyDeletePreview, deleteMonthlyFormException } = require('../lib/checklist-recovery');
const { previewTransitionImport, confirmTransitionImport } = require('../lib/checklist-monthly-results-service');
const { listChecklistNotificationRules, saveChecklistNotificationRule, listMyChecklistNotifications, markChecklistNotificationRead, markAllChecklistNotificationsRead, emitChecklistNotification } = require('../lib/checklist-notifications');
const { getKnlCapabilities, listKnlPermissionGrants, upsertKnlPermissionGrant, requireManagePermissionsForSession } = require('../lib/knl-permissions');
const { createGradePromotionProposal, processGradePromotionProposalStep, withdrawGradePromotionProposal, listMyGradePromotionProposals, listProposalsAwaitingMyAction, listVisibleGradePromotionProposals, getGradePromotionProposalDetail, getGradeOptionsForSubject, getGradePromotionApproverOptions, getGradePromotionCriteriaStandard } = require('../lib/knl-grade-proposals');
const { listMyKnlNotifications, markKnlNotificationRead, markAllKnlNotificationsRead } = require('../lib/knl-notifications');
const { listKnlPeople, getKnlEmployeeProfile } = require('../lib/knl-people');
const { getKnlEmployeeCompetencyAssignment, listKnlEmployeeCompetencyHistory, getKnlEmployeeCompetencyStandard, getKnlEmployeeCompetencyGradeStandard, setKnlEmployeeCompetencyAssignment } = require('../lib/knl-competency');
const { listKnlFrameworks, getKnlFrameworkVersion, createKnlFramework, saveKnlFramework, cloneKnlVersion, publishKnlVersion, saveKnlGroup, saveKnlItem, saveKnlColumn, deleteKnlStructure, disableKnlStructure, reorderKnlStructure, saveKnlLevelContent } = require('../lib/knl-frameworks');
const { previewKnlSourceSeed, seedKnlSourceManifest, listKnlSourceManifests, listKnlAssignmentTargets, listKnlFrameworkAssignments, saveKnlFrameworkAssignment } = require('../lib/knl-assignments');
const { getKnlSurveySetup, saveKnlSurveyCampaign, openKnlSurveyCampaign, closeKnlSurveyCampaign, listKnlSurveyCampaigns, getKnlSurveyTicket, saveKnlSurveyTicket, getKnlSurveyResults, cloneKnlSurveyVersionToDraft } = require('../lib/knl-surveys');
const { getKnlGradeMatrix, saveKnlGradeMatrix, setKnlVersionEffectivity, listKnlCompensationStandards, previewKnlCompensationFoundation, applyKnlCompensationFoundation, listKnlIncomeTargets, getKnlEmployeeIncome, saveKnlEmployeeIncome, listKnlCompensationAssignmentTargets, cloneKnlCompensationVersion, saveKnlCompensationGrades, scheduleKnlCompensationVersion, getKnlCompensationVersionAudit, listKnlEmployeeCompensationHistory, listKnlEmployeeCompensationPeriods, getKnlEmployeeNextCompensationGrade, correctKnlEmployeeCompensationPeriod } = require('../lib/knl-foundation');
const { getKnlDashboardOverview } = require('../lib/knl-dashboard');
const { askKnlDashboardAi } = require('../lib/knl-dashboard-ai');
const { listEmployeeMaster, getEmployeeMasterDetail, saveProfile:saveEmployeeMasterProfile, savePrivateProfile:saveEmployeeMasterPrivateProfile, saveContract:saveEmployeeMasterContract } = require('../lib/employee-master');
const { previewEmployeeImport, commitEmployeeImport } = require('../lib/employee-import');
const {
  assertSameOrigin,
  assertJsonContentType,
  assertContentLength,
  validatePayload,
  publicError
} = require('../lib/request-guard');
const { requireSession, authorizePayload, listHubAccountSummaries } = require('../lib/auth');

async function emitChecklistNotificationSafe(eventCode,input){
  try{return await emitChecklistNotification(eventCode,input);}
  catch(error){console.warn('[PHF Checklist] notification emit skipped',eventCode,error?.message||error);return {created:0,skipped:'error'};}
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
      const checklistWorkspaceMode = String(req.query?.checklistWorkspace || '') === '1';
      const employeeMasterMode = String(req.query?.employeeMaster || '') === '1';
      if(employeeMasterMode){
        const key=String(req.query?.key||'').trim();
        return res.status(200).json({ok:true,...(key?await getEmployeeMasterDetail(session,{key}):await listEmployeeMaster(session))});
      }
      if (checklistWorkspaceMode) {
        const [workspace, templateData, violationMode] = await Promise.all([
          getChecklistRoleWorkspace(session),
          listChecklistTemplates({compact:true}),
          getChecklistViolationMode()
        ]);
        return res.status(200).json({
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
        // Perf Sprint 1 / Commit 1: 5 nguồn dưới đây độc lập với nhau (không nguồn
        // nào dùng kết quả của nguồn khác) nên chạy song song bằng Promise.allSettled
        // thay vì await tuần tự. Giữ nguyên từng khối fallback/log lỗi theo đúng
        // hành vi cũ - một nguồn lỗi không được làm hỏng các nguồn còn lại.
        const [
          hubAccountsResult,
          assignmentResult,
          templateResult,
          violationModeResult,
          permissionResult
        ] = await Promise.allSettled([
          listHubAccountSummaries(),
          listChecklistAssignments(),
          listChecklistTemplates(),
          getChecklistViolationMode(),
          listChecklistPermissionGrants(session)
        ]);

        if (hubAccountsResult.status === 'fulfilled') {
          const accounts = hubAccountsResult.value;
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
        } else {
          const accountError = hubAccountsResult.reason;
          console.warn('[PHF API] hub account summary unavailable', accountError?.message || accountError);
          scoped.hubAccounts = [];
          scoped.hubAccountsReady = false;
          scoped.hubAccountsError = 'HUB_ACCOUNT_SUMMARY_UNAVAILABLE';
        }

        if (assignmentResult.status === 'fulfilled') {
          const assignmentData = assignmentResult.value;
          scoped.checklistAssignments = assignmentData.assignments;
          scoped.checklistAssignmentsReady = assignmentData.ready;
          scoped.checklistAssignmentsError = assignmentData.error;
        } else {
          const assignmentError = assignmentResult.reason;
          console.warn('[PHF Checklist] assignment data unavailable', assignmentError?.message || assignmentError);
          scoped.checklistAssignments = [];
          scoped.checklistAssignmentsReady = false;
          scoped.checklistAssignmentsError = assignmentError?.code || 'CHECKLIST_ASSIGNMENTS_UNAVAILABLE';
        }

        if (templateResult.status === 'fulfilled') {
          const templateData = templateResult.value;
          scoped.checklistTemplates = templateData.templates;
          scoped.checklistTemplatesReady = templateData.ready;
          scoped.checklistTemplatesError = templateData.error;
        } else {
          const templateError = templateResult.reason;
          console.warn('[PHF Checklist] template library unavailable', templateError?.message || templateError);
          scoped.checklistTemplates = [];
          scoped.checklistTemplatesReady = false;
          scoped.checklistTemplatesError = templateError?.code || 'CHECKLIST_TEMPLATES_UNAVAILABLE';
        }

        if (violationModeResult.status === 'fulfilled') {
          const violationMode = violationModeResult.value;
          scoped.checklistViolationMode = violationMode.mode;
          scoped.checklistViolationModeReady = violationMode.ready;
          scoped.checklistViolationModeError = violationMode.error;
        } else {
          const modeError = violationModeResult.reason;
          scoped.checklistViolationMode = 'test';
          scoped.checklistViolationModeReady = false;
          scoped.checklistViolationModeError = modeError?.code || 'CHECKLIST_VIOLATION_MODE_UNAVAILABLE';
        }

        if (permissionResult.status === 'fulfilled') {
          const permissionData = permissionResult.value;
          scoped.checklistPermissionGrants = permissionData.grants;
          scoped.checklistPermissionPresets = permissionData.presets;
          scoped.checklistPermissionScopeTypes = permissionData.scopeTypes;
          scoped.checklistPermissionsReady = true;
          scoped.checklistPermissionsError = '';
        } else {
          const permissionError = permissionResult.reason;
          console.warn('[PHF Checklist] permission data unavailable', permissionError?.message || permissionError);
          scoped.checklistPermissionGrants = [];
          scoped.checklistPermissionPresets = [];
          scoped.checklistPermissionsReady = false;
          scoped.checklistPermissionsError = permissionError?.code || 'CHECKLIST_PERMISSIONS_UNAVAILABLE';
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
      const checklistWorkspaceMode = String(req.query?.checklistWorkspace || '') === '1';
      const employeeMasterMode = String(req.query?.employeeMaster || '') === '1';
      if(employeeMasterMode){
        const action=String(payload.action||'').trim();
        if(action==='saveProfile')return res.status(200).json({ok:true,...await saveEmployeeMasterProfile(session,payload)});
        if(action==='savePrivateProfile')return res.status(200).json({ok:true,...await saveEmployeeMasterPrivateProfile(session,payload)});
        if(action==='saveContract')return res.status(200).json({ok:true,...await saveEmployeeMasterContract(session,payload)});
        if(action==='saveCompensation'){
          const error=new Error('Thu nhập đã chuyển sang KNL > Bậc & Cơ cấu thu nhập; không cập nhật trực tiếp mức lương legacy.');
          error.statusCode=409;error.code='EMPLOYEE_COMPENSATION_LEGACY_READ_ONLY';throw error;
        }
        if(action==='previewImport')return res.status(200).json({ok:true,...await previewEmployeeImport(session,payload)});
        if(action==='commitImport')return res.status(200).json({ok:true,...await commitEmployeeImport(session,payload)});
        throw new RequestError('Thao tác Employee Master không hợp lệ.',400,'EMPLOYEE_MASTER_ACTION_INVALID');
      }
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
        return res.status(200).json({ok:true,...saved});
      }
      if (payload && payload.action === 'listChecklistViolations') {
        return res.status(200).json({ok:true,...await listChecklistViolations(session, payload)});
      }
      if (payload && payload.action === 'listChecklistTasks') {
        return res.status(200).json({ok:true,...await listChecklistTasks(session, payload)});
      }
      if(payload&&payload.action==='getChecklistTaskHistory')return res.status(200).json({ok:true,...await getChecklistTaskHistory(session,payload)});
      if(payload&&payload.action==='getChecklistViolationDetail')return res.status(200).json({ok:true,...await getChecklistViolationDetail(session,payload)});
      if(payload&&payload.action==='transitionChecklistTask'){
        const result=await transitionChecklistTask(session,payload),task=result.task||{};
        if(payload.taskAction==='employee_explain')await emitChecklistNotificationSafe('EXPLANATION_SUBMITTED',{recipient:{accountId:task.current_assignee_id,employeeCode:task.current_assignee_code},title:'Có giải trình lỗi cần phản hồi',message:'Nhân viên đã gửi giải trình; vui lòng phản hồi.',targetPath:'/admin/checklist/viec-can-xu-ly?focus=violation&violation_id='+encodeURIComponent(task.violation_id||''),subjectType:'violation',subjectId:task.violation_id||'',dedupeKey:'task|'+task.id+'|'+task.status+'|'+task.updated_at});
        return res.status(200).json({ok:true,...result});
      }
      if (payload && payload.action === 'listChecklistViolationHistory') {
        return res.status(200).json({ok:true,...await listChecklistViolationHistory(session, payload)});
      }
      if (payload && payload.action === 'getChecklistViolationTaskStatus') {
        return res.status(200).json({ok:true,...await getChecklistViolationTaskStatus(session, payload)});
      }
      if (payload && payload.action === 'deleteChecklistTestViolations') {
        return res.status(200).json({ok:true,...await deleteChecklistTestViolations(session, payload)});
      }
      if (payload && payload.action === 'updateChecklistViolation') {
        return res.status(200).json({ok:true,...await updateChecklistViolation(session, payload)});
      }
      if (payload && payload.action === 'cancelChecklistViolation') {
        return res.status(200).json({ok:true,...await cancelChecklistViolation(session, payload)});
      }
      if (payload && payload.action === 'deleteChecklistTestViolation') {
        return res.status(200).json({ok:true,...await deleteChecklistTestViolation(session, payload)});
      }
      if (payload && payload.action === 'createChecklistEvidenceUpload') {
        return res.status(200).json({ok:true,...await createChecklistEvidenceUpload(session, payload)});
      }
      if (payload && payload.action === 'finalizeChecklistEvidenceUpload') {
        return res.status(200).json({ok:true,...await finalizeChecklistEvidenceUpload(session, payload)});
      }
      if (payload && payload.action === 'attachChecklistEvidence') {
        return res.status(200).json({ok:true,...await attachChecklistEvidence(session, payload)});
      }
      if (payload && payload.action === 'listChecklistEvidence') {
        return res.status(200).json({ok:true,...await listChecklistEvidence(session, payload)});
      }
      if (payload && payload.action === 'deleteChecklistEvidence') {
        return res.status(200).json({ok:true,...await deleteChecklistEvidence(session, payload)});
      }
      if (payload && payload.action === 'saveChecklistAssignments') {
        const saved = await saveChecklistAssignments(session, payload.assignments || []);
        return res.status(200).json({ok:true,...saved});
      }
      if (payload && payload.action === 'saveChecklistTemplate') {
        const saved = await saveChecklistTemplate(session, payload.template || {});
        return res.status(200).json({ok:true,...saved});
      }
      if (payload && payload.action === 'saveChecklistTemplateLibrary') {
        const saved = await saveChecklistTemplateLibrary(session, payload.templates || []);
        return res.status(200).json({ok:true,...saved});
      }
      if (payload && payload.action === 'recordChecklistLateManagerObservation') {
        return res.status(200).json({ok:true,...await recordManagerLateObservation(session, payload.input || {})});
      }
      if (payload && payload.action === 'recordChecklistLateShiftLeadObservation') {
        return res.status(200).json({ok:true,...await recordShiftLeadLateObservation(session, payload.input || {})});
      }
      if (payload && payload.action === 'listChecklistLateManagerObservations') {
        return res.status(200).json({ok:true,...await listManagerLateObservations(session, payload.input || {})});
      }
      if (payload && payload.action === 'listChecklistLateShiftLeadObservations') {
        return res.status(200).json({ok:true,...await listShiftLeadLateObservations(session, payload.input || {})});
      }
      if (payload && payload.action === 'listAdminChecklistLateManagerObservations') {
        return res.status(200).json({ok:true,...await listAdminChecklistLateManagerObservations(session, payload.input || {})});
      }
      if (payload && payload.action === 'previewChecklistLateBccUpload') {
        return res.status(200).json({ok:true,...await previewChecklistLateBccUpload(session, payload.rows || [])});
      }
      if (payload && payload.action === 'createChecklistLateBccImport') {
        return res.status(200).json({ok:true,...await createChecklistLateBccImport(session, payload.input || {})});
      }
      if (payload && payload.action === 'reconcileChecklistLateBccImport') {
        return res.status(200).json({ok:true,...await reconcileChecklistLateBccImport(session, payload.input || {})});
      }
      if (payload && payload.action === 'approveChecklistLateEvents') {
        return res.status(200).json({ok:true,...await approveChecklistLateEvents(session, payload.decisions || [])});
      }
      if (payload && payload.action === 'createChecklistLateLinkedAdjustment') {
        return res.status(200).json({ok:true,...await createChecklistLateLinkedAdjustment(session, payload.input || {})});
      }
      if (payload && payload.action === 'exportChecklistLateReconciliation') {
        return res.status(200).json({ok:true,...await exportChecklistLateReconciliation(session, payload.filters || {})});
      }
      if (payload && payload.action === 'listChecklistPermissionGrants') {
        return res.status(200).json({ok:true,...await listChecklistPermissionGrants(session,{includeInactive:payload.includeInactive===true})});
      }
      if (payload && payload.action === 'saveChecklistPermissionGrants') {
        const saved=await saveChecklistPermissionGrants(session,payload.grants || []);
        for(const grant of saved.grants||[])await emitChecklistNotificationSafe('PERMISSION_CHANGED',{recipient:{accountId:grant.accountId,employeeCode:grant.employeeCode},title:'Quyền Checklist đã thay đổi',message:'Quyền Checklist của bạn đã được cập nhật.',targetPath:'/ql/checklist',subjectType:'permission_grant',subjectId:grant.id,dedupeKey:'permission|'+grant.id+'|'+grant.updatedAt});
        return res.status(200).json({ok:true,...saved});
      }
      if (payload && payload.action === 'disableChecklistPermissionGrant') {
        return res.status(200).json({ok:true,...await disableChecklistPermissionGrant(session,payload)});
      }
      if (payload && payload.action === 'getChecklistRoleWorkspace') {
        return res.status(200).json({ok:true,...await getChecklistRoleWorkspace(session)});
      }
      if(payload&&payload.action==='listChecklistNotificationRules')return res.status(200).json({ok:true,...await listChecklistNotificationRules(session)});
      if(payload&&payload.action==='saveChecklistNotificationRule')return res.status(200).json({ok:true,...await saveChecklistNotificationRule(session,payload)});
      if(payload&&payload.action==='listMyChecklistNotifications')return res.status(200).json({ok:true,...await listMyChecklistNotifications(session,payload)});
      if(payload&&payload.action==='markChecklistNotificationRead')return res.status(200).json({ok:true,...await markChecklistNotificationRead(session,payload)});
      if(payload&&payload.action==='markAllChecklistNotificationsRead')return res.status(200).json({ok:true,...await markAllChecklistNotificationsRead(session)});
      if(payload&&payload.action==='getMarketingMonthlyKpiConfig')return res.status(200).json({ok:true,...await getMarketingMonthlyKpiConfig(session,payload)});
      if(payload&&payload.action==='saveMarketingMonthlyKpiConfig')return res.status(200).json({ok:true,...await saveMarketingMonthlyKpiConfig(session,payload)});
      if(payload&&payload.action==='listChecklistMonthly')return res.status(200).json({ok:true,...await listMonthly(session,payload)});
      if(payload&&payload.action==='createChecklistMonthly')return res.status(200).json({ok:true,...await createMonthly(session,payload)});
      if(payload&&payload.action==='openChecklistMonthly')return res.status(200).json({ok:true,...await openMonthly(session,payload)});
      if(payload&&payload.action==='lockChecklistMonthly')return res.status(200).json({ok:true,...await lockMonthly(session,payload)});
      if(payload&&payload.action==='openChecklistMonthlyException')return res.status(200).json({ok:true,...await openMonthlyException(session,payload)});
      if(payload&&payload.action==='openChecklistMonthlyPilot')return res.status(200).json({ok:true,...await openMonthlyPilot(session,payload)});
      if(payload&&payload.action==='getMyChecklistMonthly')return res.status(200).json({ok:true,...await myMonthlyForm(session,payload)});
      if(payload&&payload.action==='getChecklistAssessmentProfile')return res.status(200).json({ok:true,...await getChecklistAssessmentProfile(session,payload)});
      if(payload&&payload.action==='saveMyChecklistMonthly'){
        const saved=await saveMyMonthly(session,payload);
        if(payload.submit===true&&saved.form)await emitChecklistNotificationSafe('SELF_REVIEW_SUBMITTED',{recipient:{accountId:saved.form.reviewer_id,employeeCode:saved.form.reviewer_code},title:'Có phiếu tháng chờ thẩm định',targetPath:'/ql/checklist/phieu-danh-gia-thang',subjectType:'monthly_form',subjectId:saved.form.id,dedupeKey:'monthly-self|'+saved.form.id+'|'+(saved.form.self_submitted_at||Date.now()),variables:{TEN_NHAN_VIEN:saved.form.employee_name,KY_DANH_GIA:saved.form.period_month}});
        return res.status(200).json({ok:true,...saved});
      }
      if(payload&&payload.action==='listMyChecklistMonthlyReviews')return res.status(200).json({ok:true,...await myMonthlyReviews(session,{...payload,summary:true})});
      if(payload&&payload.action==='getMyChecklistMonthlyReviewDetail')return res.status(200).json({ok:true,...await myMonthlyReviewDetail(session,payload)});
      if(payload&&payload.action==='saveChecklistMonthlyReview')return res.status(200).json({ok:true,...await saveMonthlyReview(session,payload)});
      if(payload&&payload.action==='changeChecklistMonthlyReviewer')return res.status(200).json({ok:true,...await changeMonthlyReviewer(session,payload)});
      if(payload&&payload.action==='exportChecklistMonthlyData')return res.status(200).json({ok:true,...await exportMonthlyData(session,payload)});
      if(payload&&payload.action==='getChecklistMonthlyReport')return res.status(200).json({ok:true,...await getChecklistMonthlyReport(session,payload)});
      if(payload&&payload.action==='getChecklistCurrentScoreReport')return res.status(200).json({ok:true,...await getChecklistCurrentScoreReport(session,payload)});
      if(payload&&payload.action==='getChecklistScorePeriodReport')return res.status(200).json({ok:true,...await getChecklistScorePeriodReport(session,payload)});
      if(payload&&payload.action==='getChecklistAnnualResultReport')return res.status(200).json({ok:true,...await getChecklistAnnualResultReport(session,payload)});
      if(payload&&payload.action==='previewChecklistTransitionImport')return res.status(200).json({ok:true,...await previewTransitionImport(session,payload)});
      if(payload&&payload.action==='confirmChecklistTransitionImport')return res.status(200).json({ok:true,...await confirmTransitionImport(session,payload)});
      if(payload&&payload.action==='getChecklistViolationWorkflowSummary')return res.status(200).json({ok:true,...await getChecklistViolationWorkflowSummary(session,payload)});
      if(payload&&payload.action==='inspectChecklistMonthlyRecovery')return res.status(200).json({ok:true,...await inspectMonthlyRecovery(session,payload)});
      if(payload&&payload.action==='createMissingChecklistMonthlyForms')return res.status(200).json({ok:true,...await createMissingMonthlyForms(session,payload)});
      if(payload&&payload.action==='getChecklistMonthlyDeletePreview')return res.status(200).json({ok:true,...await getMonthlyDeletePreview(session,payload)});
      if(payload&&payload.action==='deleteChecklistMonthlyFormException')return res.status(200).json({ok:true,...await deleteMonthlyFormException(session,payload)});
      if(payload&&payload.action==='getChecklistLatePointsPolicy')return res.status(200).json({ok:true,...await getChecklistLatePointsPolicy(session,payload)});
      if(payload&&payload.action==='saveChecklistLatePointsPolicy')return res.status(200).json({ok:true,...await saveChecklistLatePointsPolicy(session,payload)});
      if(payload&&payload.action==='getChecklistRepeatViolationPolicy')return res.status(200).json({ok:true,...await getChecklistRepeatViolationPolicy(session,payload)});
      if(payload&&payload.action==='saveChecklistRepeatViolationPolicy')return res.status(200).json({ok:true,...await saveChecklistRepeatViolationPolicy(session,payload)});
      if(payload&&payload.action==='getChecklistRepeatViolationSuggestions')return res.status(200).json({ok:true,...await getChecklistRepeatViolationSuggestions(session,payload)});
      if(payload&&payload.action==='getChecklistMonthlyScorePolicy')return res.status(200).json({ok:true,...await getChecklistMonthlyScorePolicy(session,payload)});
      if(payload&&payload.action==='saveChecklistMonthlyScorePolicy')return res.status(200).json({ok:true,...await saveChecklistMonthlyScorePolicy(session,payload)});
      if(payload&&payload.action==='getChecklistMonthlyCyclePolicy')return res.status(200).json({ok:true,...await getMonthlyCyclePolicy(session,payload)});
      if(payload&&payload.action==='saveChecklistMonthlyCyclePolicy')return res.status(200).json({ok:true,...await saveMonthlyCyclePolicy(session,payload)});
      if(payload&&payload.action==='saveChecklistMonthlyCycleOverride')return res.status(200).json({ok:true,...await saveMonthlyCycleOverride(session,payload)});
      if(payload&&payload.action==='syncChecklistMonthlyCycle')return res.status(200).json({ok:true,...await syncMonthlyCycle(session,payload)});
      if(payload&&payload.action==='getChecklistMonthlyOverduePolicy')return res.status(200).json({ok:true,...await getMonthlyOverduePolicy(session,payload)});
      if(payload&&payload.action==='saveChecklistMonthlyOverduePolicy')return res.status(200).json({ok:true,...await saveMonthlyOverduePolicy(session,payload)});
      if(payload&&payload.action==='processChecklistMonthlyOverdue')return res.status(200).json({ok:true,...await processMonthlySelfOverdue(session,payload)});
      if(payload&&payload.action==='getKnlCapabilities')return res.status(200).json({ok:true,...await getKnlCapabilities(session)});
      if(payload&&payload.action==='listKnlPeople')return res.status(200).json({ok:true,...await listKnlPeople(session,payload)});
      if(payload&&payload.action==='listKnlPermissionGrants')return res.status(200).json({ok:true,...await listKnlPermissionGrants(session)});
      if(payload&&payload.action==='upsertKnlPermissionGrant')return res.status(200).json({ok:true,...await upsertKnlPermissionGrant(session,payload.grant||{})});
      if(payload&&payload.action==='listKnlAccountsForPermission'){
        await requireManagePermissionsForSession(session);
        const accounts=(await listHubAccountSummaries()).map(a=>({id:a.id||'',name:a.name||'',email:a.email||'',employeeCode:a.employeeCode||'',role:a.role||'',department:a.department||'',branch:a.branch||'',position:a.position||''}));
        return res.status(200).json({ok:true,accounts});
      }
      if(payload&&payload.action==='listKnlFrameworks')return res.status(200).json({ok:true,...await listKnlFrameworks(session)});
      if(payload&&payload.action==='getKnlFrameworkVersion')return res.status(200).json({ok:true,...await getKnlFrameworkVersion(session,payload)});
      if(payload&&payload.action==='createKnlFramework')return res.status(200).json({ok:true,...await createKnlFramework(session,payload.framework||{})});
      if(payload&&payload.action==='saveKnlFramework')return res.status(200).json({ok:true,...await saveKnlFramework(session,payload.framework||{})});
      if(payload&&payload.action==='cloneKnlVersion')return res.status(200).json({ok:true,...await cloneKnlVersion(session,payload)});
      if(payload&&payload.action==='publishKnlVersion')return res.status(200).json({ok:true,...await publishKnlVersion(session,payload)});
      if(payload&&payload.action==='saveKnlGroup')return res.status(200).json({ok:true,...await saveKnlGroup(session,payload.group||{})});
      if(payload&&payload.action==='saveKnlItem')return res.status(200).json({ok:true,...await saveKnlItem(session,payload.item||{})});
      if(payload&&payload.action==='saveKnlColumn')return res.status(200).json({ok:true,...await saveKnlColumn(session,payload.column||{})});
      if(payload&&payload.action==='deleteKnlStructure')return res.status(200).json({ok:true,...await deleteKnlStructure(session,payload)});
      if(payload&&payload.action==='disableKnlStructure')return res.status(200).json({ok:true,...await disableKnlStructure(session,payload)});
      if(payload&&payload.action==='reorderKnlStructure')return res.status(200).json({ok:true,...await reorderKnlStructure(session,payload)});
      if(payload&&payload.action==='saveKnlLevelContent')return res.status(200).json({ok:true,...await saveKnlLevelContent(session,payload.levelContent||{})});
      if(payload&&payload.action==='getKnlGradeMatrix')return res.status(200).json({ok:true,...await getKnlGradeMatrix(session,payload)});
      if(payload&&payload.action==='saveKnlGradeMatrix')return res.status(200).json({ok:true,...await saveKnlGradeMatrix(session,payload)});
      if(payload&&payload.action==='setKnlVersionEffectivity')return res.status(200).json({ok:true,...await setKnlVersionEffectivity(session,payload)});
      if(payload&&payload.action==='listKnlCompensationStandards')return res.status(200).json({ok:true,...await listKnlCompensationStandards(session)});
      if(payload&&payload.action==='previewKnlCompensationFoundation')return res.status(200).json({ok:true,...await previewKnlCompensationFoundation(session)});
      if(payload&&payload.action==='applyKnlCompensationFoundation')return res.status(200).json({ok:true,...await applyKnlCompensationFoundation(session,payload)});
      if(payload&&payload.action==='listKnlIncomeTargets')return res.status(200).json({ok:true,...await listKnlIncomeTargets(session)});
      if(payload&&payload.action==='getKnlEmployeeIncome')return res.status(200).json({ok:true,...await getKnlEmployeeIncome(session,payload)});
      if(payload&&payload.action==='getKnlDashboardOverview')return res.status(200).json({ok:true,...await getKnlDashboardOverview(session,payload)});
      if(payload&&payload.action==='askKnlDashboardAi')return res.status(200).json({ok:true,...await askKnlDashboardAi(session,payload)});
      if(payload&&payload.action==='getKnlEmployeeNextCompensationGrade')return res.status(200).json({ok:true,...await getKnlEmployeeNextCompensationGrade(session,payload)});
      if(payload&&payload.action==='saveKnlEmployeeIncome')return res.status(200).json({ok:true,...await saveKnlEmployeeIncome(session,payload)});
      if(payload&&payload.action==='correctKnlEmployeeCompensationPeriod')return res.status(200).json({ok:true,...await correctKnlEmployeeCompensationPeriod(session,payload)});
      if(payload&&payload.action==='listKnlCompensationAssignmentTargets')return res.status(200).json({ok:true,...await listKnlCompensationAssignmentTargets(session)});
      if(payload&&payload.action==='cloneKnlCompensationVersion')return res.status(200).json({ok:true,...await cloneKnlCompensationVersion(session,payload)});
      if(payload&&payload.action==='saveKnlCompensationGrades')return res.status(200).json({ok:true,...await saveKnlCompensationGrades(session,payload)});
      if(payload&&payload.action==='scheduleKnlCompensationVersion')return res.status(200).json({ok:true,...await scheduleKnlCompensationVersion(session,payload)});
      if(payload&&payload.action==='getKnlCompensationVersionAudit')return res.status(200).json({ok:true,...await getKnlCompensationVersionAudit(session)});
      if(payload&&payload.action==='listKnlEmployeeCompensationHistory')return res.status(200).json({ok:true,...await listKnlEmployeeCompensationHistory(session,payload)});
      if(payload&&payload.action==='listKnlEmployeeCompensationPeriods')return res.status(200).json({ok:true,...await listKnlEmployeeCompensationPeriods(session,payload)});
      if(payload&&payload.action==='getKnlEmployeeCompetencyAssignment')return res.status(200).json({ok:true,...await getKnlEmployeeCompetencyAssignment(session,payload)});
      if(payload&&payload.action==='listKnlEmployeeCompetencyHistory')return res.status(200).json({ok:true,...await listKnlEmployeeCompetencyHistory(session,payload)});
      if(payload&&payload.action==='getKnlEmployeeCompetencyStandard')return res.status(200).json({ok:true,...await getKnlEmployeeCompetencyStandard(session,payload)});
      if(payload&&payload.action==='getKnlEmployeeCompetencyGradeStandard')return res.status(200).json({ok:true,...await getKnlEmployeeCompetencyGradeStandard(session,payload)});
      if(payload&&payload.action==='getKnlEmployeeProfile')return res.status(200).json({ok:true,profile:await getKnlEmployeeProfile(session,payload)});
      if(payload&&payload.action==='setKnlEmployeeCompetencyAssignment')return res.status(200).json({ok:true,...await setKnlEmployeeCompetencyAssignment(session,payload)});
      if(payload&&payload.action==='getKnlGradeOptionsForSubject')return res.status(200).json({ok:true,...await getGradeOptionsForSubject(session,payload)});
      if(payload&&payload.action==='getKnlGradePromotionApproverOptions')return res.status(200).json({ok:true,...await getGradePromotionApproverOptions(session,payload)});
      if(payload&&payload.action==='getKnlGradePromotionCriteriaStandard')return res.status(200).json({ok:true,...await getGradePromotionCriteriaStandard(session,payload)});
      if(payload&&payload.action==='createKnlGradePromotionProposal')return res.status(200).json({ok:true,...await createGradePromotionProposal(session,payload.proposal||{})});
      if(payload&&payload.action==='agreeKnlGradePromotionProposal')return res.status(200).json({ok:true,...await processGradePromotionProposalStep(session,{...payload,action:'agree'})});
      if(payload&&payload.action==='rejectKnlGradePromotionProposal')return res.status(200).json({ok:true,...await processGradePromotionProposalStep(session,{...payload,action:'reject'})});
      if(payload&&payload.action==='withdrawKnlGradePromotionProposal')return res.status(200).json({ok:true,...await withdrawGradePromotionProposal(session,payload)});
      if(payload&&payload.action==='listMyKnlGradePromotionProposals')return res.status(200).json({ok:true,...await listMyGradePromotionProposals(session)});
      if(payload&&payload.action==='listKnlGradePromotionProposalsAwaitingMyAction')return res.status(200).json({ok:true,...await listProposalsAwaitingMyAction(session)});
      if(payload&&payload.action==='listVisibleKnlGradePromotionProposals')return res.status(200).json({ok:true,...await listVisibleGradePromotionProposals(session,payload)});
      if(payload&&payload.action==='getKnlGradePromotionProposalDetail')return res.status(200).json({ok:true,...await getGradePromotionProposalDetail(session,payload)});
      if(payload&&payload.action==='listMyKnlNotifications')return res.status(200).json({ok:true,...await listMyKnlNotifications(session,payload)});
      if(payload&&payload.action==='markKnlNotificationRead')return res.status(200).json({ok:true,...await markKnlNotificationRead(session,payload)});
      if(payload&&payload.action==='markAllKnlNotificationsRead')return res.status(200).json({ok:true,...await markAllKnlNotificationsRead(session)});
      if(payload&&payload.action==='previewKnlSourceSeed')return res.status(200).json({ok:true,...await previewKnlSourceSeed(session)});
      if(payload&&payload.action==='seedKnlSourceManifest')return res.status(200).json({ok:true,...await seedKnlSourceManifest(session)});
      if(payload&&payload.action==='listKnlSourceManifests')return res.status(200).json({ok:true,...await listKnlSourceManifests(session)});
      if(payload&&payload.action==='listKnlAssignmentTargets')return res.status(200).json({ok:true,...await listKnlAssignmentTargets(session)});
      if(payload&&payload.action==='listKnlFrameworkAssignments')return res.status(200).json({ok:true,...await listKnlFrameworkAssignments(session)});
      if(payload&&payload.action==='saveKnlFrameworkAssignment')return res.status(200).json({ok:true,...await saveKnlFrameworkAssignment(session,payload.assignment||{})});
      if(payload&&payload.action==='getKnlSurveySetup')return res.status(200).json({ok:true,...await getKnlSurveySetup(session,payload)});
      if(payload&&payload.action==='saveKnlSurveyCampaign')return res.status(200).json({ok:true,...await saveKnlSurveyCampaign(session,payload.campaign||{})});
      if(payload&&payload.action==='openKnlSurveyCampaign')return res.status(200).json({ok:true,...await openKnlSurveyCampaign(session,payload)});
      if(payload&&payload.action==='closeKnlSurveyCampaign')return res.status(200).json({ok:true,...await closeKnlSurveyCampaign(session,payload)});
      if(payload&&payload.action==='listKnlSurveyCampaigns')return res.status(200).json({ok:true,...await listKnlSurveyCampaigns(session,payload)});
      if(payload&&payload.action==='getKnlSurveyTicket')return res.status(200).json({ok:true,...await getKnlSurveyTicket(session,payload)});
      if(payload&&payload.action==='saveKnlSurveyTicket')return res.status(200).json({ok:true,...await saveKnlSurveyTicket(session,payload)});
      if(payload&&payload.action==='getKnlSurveyResults')return res.status(200).json({ok:true,...await getKnlSurveyResults(session,payload)});
      if(payload&&payload.action==='cloneKnlSurveyVersionToDraft')return res.status(200).json({ok:true,...await cloneKnlSurveyVersionToDraft(session,payload)});
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
