'use strict';

const crypto = require('crypto');
const { readData, saveData } = require('./_lib/db');
const { listClasses, getClass, saveClass, listAttendance, saveAttendance } = require('./_lib/classroom-db');
const { getLearning, saveLessons, updateProgress } = require('./_lib/classroom-learning');
const { getMaterials, saveGroups, createUpload, finalizeUpload, updateMaterial, materialUrl, confirmMaterial } = require('./_lib/classroom-materials');
const { listTests, saveTest, saveAssignment, startAttempt, submitAttempt, gradeAttempt } = require('./_lib/classroom-tests');
const { listClassroomUsers } = require('./_lib/classroom-users');
const { listProposals, saveProposal, reviewProposal } = require('./_lib/classroom-proposals');
const { listNotifications, saveNotification, markNotificationRead, markAllNotificationsRead, hideNotification } = require('./_lib/classroom-notifications');
const { getSettings, saveSettings, resetSettings, softDelete, restore, purge, listAudit } = require('./_lib/classroom-settings');
const { listChecklistAssignments, saveChecklistAssignments } = require('./_lib/checklist-assignments');
const { listChecklistTemplates, saveChecklistTemplate, saveChecklistTemplateLibrary } = require('./_lib/checklist-templates');
// Proposal V2 (2026-08-29) — dùng để tính viewer flags (canAccept/canReject/
// canCancel) cho detail DTO, xem attachProposalViewerFlags() bên dưới.
const { resolveActorContext } = require('./_lib/task-employee-scope');
const {
  listTaskAssignableEmployees,
  listTaskAdminPeople,
  saveTaskPermissionAssignment: saveTaskPermissionAssignmentLegacy,
  createTaskPermissionGrant: createTaskPermissionGrantLegacy,
  revokeTaskPermissionGrant: revokeTaskPermissionGrantLegacy,
  listTaskCategories: listTaskCategoriesLegacy,
  listAdminTaskCategories,
  createTaskCategory: createTaskCategoryLegacy,
  renameTaskCategory: renameTaskCategoryLegacy,
  setTaskCategoryActive: setTaskCategoryActiveLegacy,
  deleteTaskCategory: deleteTaskCategoryLegacy,
  reorderTaskCategory: reorderTaskCategoryLegacy,
  checkTaskFoundationStatus,
  createTaskDraft: createTaskDraftLegacy,
  updateTaskDraft,
  deleteTaskDraft,
  publishTask: publishTaskLegacy,
  getTaskDetail: getTaskDetailLegacy,
  updateTaskProgress: updateTaskProgressLegacy,
  completeTask: completeTaskLegacy,
  reopenTask: reopenTaskLegacy,
  cancelTask: cancelTaskLegacy,
  changeTaskDeadline: changeTaskDeadlineLegacy,
  transferTaskPrimary: transferTaskPrimaryLegacy,
  addTaskRelated: addTaskRelatedLegacy,
  removeTaskRelated: removeTaskRelatedLegacy,
  addTaskComment: addTaskCommentLegacy,
  addTaskLink: addTaskLinkLegacy,
  removeTaskLink: removeTaskLinkLegacy,
  listTasks: listTasksLegacy,
  listTaskEvents: listTaskEventsLegacy
} = require('./_lib/task-core');
const {
  getTaskReportSummary,
  getTaskReportCategoryAnalysis,
  getTaskReportPersonAnalysis,
  getTaskReportTrend,
  listTaskReportDrilldown
} = require('./_lib/task-reporting');
const {
  getTaskOverviewV2,
  getTaskReportV2Bundle,
  listTaskOverviewV2Drilldown,
  getTaskReportV2PersonAnalysis,
  getTaskReportV2DepartmentAnalysis,
  getTaskReportV2CategoryAnalysis,
  getTaskReportV2Trend
} = require('./_lib/task-reporting-v2');
const {
  listMyTaskNotifications,
  markTaskNotificationRead,
  markAllTaskNotificationsRead
} = require('./_lib/task-notifications');
const {
  isBridgeEnabled: isTaskReadBridgeEnabled,
  bridgeListTaskCategories,
  isListTasksBridgeEnabled: isTaskReadBridgeListTasksEnabled,
  bridgeListTasks,
  isGetTaskDetailBridgeEnabled: isTaskReadBridgeGetDetailEnabled
} = require('./_lib/task-read-bridge');
// TASK-SERVER integration pilot (2026-08-27) — TẮT MẶC ĐỊNH tuyệt đối
// (PHF_TASK_SERVER_WRITE_ENABLED=true tường minh mới bật). Khi tắt, hành vi
// giữ NGUYÊN 100% — createTaskDraft() (Supabase, task-core.js) không đổi.
// Pilot CHỈ createTaskDraft (data-independent) — xem
// api/_lib/task-server-integration.js cho phạm vi + lý do. Cùng pattern
// wrapper-ngoài-marker đã dùng cho listTasks()/listTaskCategories() read-
// bridge phía trên (bắt buộc để giữ đúng cơ chế parity test vm-eval chỉ
// TASK_API_WIRING_START/END — hàm branching PHẢI định nghĩa NGOÀI marker).
const {
  isServerWriteEnabled: isTaskServerWriteEnabled,
  createTaskDraftViaServer,
  publishTaskViaServer,
  updateTaskProgressViaServer,
  completeTaskViaServer,
  reopenTaskViaServer,
  cancelTaskViaServer,
  changeTaskDeadlineViaServer,
  transferTaskPrimaryViaServer,
  addTaskRelatedViaServer,
  removeTaskRelatedViaServer,
  addTaskCommentViaServer,
  addTaskLinkViaServer,
  removeTaskLinkViaServer,
  createTaskCategoryViaServer,
  renameTaskCategoryViaServer,
  setTaskCategoryActiveViaServer,
  reorderTaskCategoryViaServer,
  deleteTaskCategoryIfUnusedViaServer,
  setTaskPermissionAssignmentViaServer,
  createTaskPermissionGrantViaServer,
  revokeTaskPermissionGrantViaServer,
  getTaskDetailViaServer,
  listTaskEventsViaServer,
  // Proposal V2 (2026-08-29, LOCKED Phương án A) — PostgreSQL-ONLY, KHÔNG
  // có wrapper Legacy/flag nào (khác mọi tên ở trên) — xem 4 hàm dispatch
  // ngay dưới destructure này.
  createTaskProposalViaServer,
  acceptTaskProposalViaServer,
  rejectTaskProposalViaServer,
  cancelTaskProposalViaServer,
  requestTaskCancelViaServer,
  approveTaskCancelRequestViaServer,
  rejectTaskCancelRequestViaServer,
  withdrawTaskCancelRequestViaServer,
  listProposalRecipientEmployeesViaServer,
  getTaskDetailProposalAwareViaServer,
} = require('./_lib/task-server-integration');
// PHF HR — CHƯƠNG TRÌNH THI ĐUA (Competition) V1 · Batch C2 (2026-09-04, LOCAL
// ONLY, flag-gated). See api/_lib/competition-actions.js header — resolves
// the REAL PHF HR session actor from People Master (never a client-supplied
// actor), forwards to phf-hr-api's /v1/competition dispatcher.
const { dispatchCompetitionAction } = require('./_lib/competition-actions');
// MAIL V1 Increment 2 — Admin Mail Settings + Weekly Report preview (Admin-only,
// enforced inside these via requireTaskAdmin). PostgreSQL phf_hr via the mail
// bridge. Never sends mail.
const {
  taskMailSettingsGet,
  taskMailSetWeeklyEnabled,
  taskMailAddRecipient,
  taskMailSetRecipientEnabled,
  taskMailRemoveRecipient,
  taskMailWeeklyPreview,
} = require('./_lib/task-mail-settings-actions');
// Proposal V2 — KHÔNG có nhánh Legacy (Proposal chưa từng tồn tại ở Supabase,
// xem BAN_GIAO_PHF_TASK_PROPOSAL_V2_CHECKPOINT_2026-08-29.md mục 0/0b/0c).
// Đặt tên PHẲNG (không đổi tên qua wrapper if/else như createTaskDraft ở
// trên) vì không có gì để branch — luôn PostgreSQL.
const createTaskProposal = createTaskProposalViaServer;
const acceptTaskProposal = acceptTaskProposalViaServer;
const rejectTaskProposal = rejectTaskProposalViaServer;
const cancelTaskProposal = cancelTaskProposalViaServer;
// CANCEL POLICY V1 (2026-08-31) — PostgreSQL-only "Yêu cầu hủy" flow (no Legacy).
const requestTaskCancel = requestTaskCancelViaServer;
const approveTaskCancelRequest = approveTaskCancelRequestViaServer;
const rejectTaskCancelRequest = rejectTaskCancelRequestViaServer;
const withdrawTaskCancelRequest = withdrawTaskCancelRequestViaServer;
const listProposalRecipientEmployees = listProposalRecipientEmployeesViaServer;
// RECURRENCE V1 (2026-08-31) — PostgreSQL-only, no Legacy fallback (same as
// Proposal V2). Action layer rides the shared PHF_TASK_WRITE_BRIDGE_ENABLED
// kill switch (see api/_lib/task-recurrence-bridge.js).
const {
  createTaskRecurrence,
  updateTaskRecurrence,
  pauseTaskRecurrence,
  resumeTaskRecurrence,
  stopTaskRecurrence,
  listTaskRecurrence,
  runTaskRecurrence,
} = require('./_lib/task-recurrence-actions');
async function createTaskDraft(session, input) {
  if (isTaskServerWriteEnabled()) return createTaskDraftViaServer(session, input);
  return createTaskDraftLegacy(session, input);
}
async function publishTask(session, taskId, expectedRowVersion) {
  if (isTaskServerWriteEnabled()) return publishTaskViaServer(session, taskId, expectedRowVersion);
  return publishTaskLegacy(session, taskId, expectedRowVersion);
}
async function updateTaskProgress(session, taskId, expectedRowVersion, progressPercent, progressStatus) {
  if (isTaskServerWriteEnabled()) return updateTaskProgressViaServer(session, taskId, expectedRowVersion, progressPercent, progressStatus);
  return updateTaskProgressLegacy(session, taskId, expectedRowVersion, progressPercent, progressStatus);
}
async function completeTask(session, taskId, expectedRowVersion, resultText) {
  if (isTaskServerWriteEnabled()) return completeTaskViaServer(session, taskId, expectedRowVersion, resultText);
  return completeTaskLegacy(session, taskId, expectedRowVersion, resultText);
}
async function reopenTask(session, taskId, expectedRowVersion, reason) {
  if (isTaskServerWriteEnabled()) return reopenTaskViaServer(session, taskId, expectedRowVersion, reason);
  return reopenTaskLegacy(session, taskId, expectedRowVersion, reason);
}
async function cancelTask(session, taskId, expectedRowVersion, reason) {
  if (isTaskServerWriteEnabled()) return cancelTaskViaServer(session, taskId, expectedRowVersion, reason);
  return cancelTaskLegacy(session, taskId, expectedRowVersion, reason);
}
async function changeTaskDeadline(session, taskId, expectedRowVersion, newDeadline, reason) {
  if (isTaskServerWriteEnabled()) return changeTaskDeadlineViaServer(session, taskId, expectedRowVersion, newDeadline, reason);
  return changeTaskDeadlineLegacy(session, taskId, expectedRowVersion, newDeadline, reason);
}
async function transferTaskPrimary(session, taskId, expectedRowVersion, newPrimaryEmployeeCode, reason) {
  if (isTaskServerWriteEnabled()) return transferTaskPrimaryViaServer(session, taskId, expectedRowVersion, newPrimaryEmployeeCode, reason);
  return transferTaskPrimaryLegacy(session, taskId, expectedRowVersion, newPrimaryEmployeeCode, reason);
}
async function addTaskRelated(session, taskId, targetEmployeeCode) {
  if (isTaskServerWriteEnabled()) return addTaskRelatedViaServer(session, taskId, targetEmployeeCode);
  return addTaskRelatedLegacy(session, taskId, targetEmployeeCode);
}
async function removeTaskRelated(session, taskId, targetEmployeeCode) {
  if (isTaskServerWriteEnabled()) return removeTaskRelatedViaServer(session, taskId, targetEmployeeCode);
  return removeTaskRelatedLegacy(session, taskId, targetEmployeeCode);
}
async function addTaskComment(session, taskId, body) {
  if (isTaskServerWriteEnabled()) return addTaskCommentViaServer(session, taskId, body);
  return addTaskCommentLegacy(session, taskId, body);
}
async function addTaskLink(session, taskId, side, url, label) {
  if (isTaskServerWriteEnabled()) return addTaskLinkViaServer(session, taskId, side, url, label);
  return addTaskLinkLegacy(session, taskId, side, url, label);
}
async function removeTaskLink(session, taskId, linkId) {
  if (isTaskServerWriteEnabled()) return removeTaskLinkViaServer(session, taskId, linkId);
  return removeTaskLinkLegacy(session, taskId, linkId);
}
async function createTaskCategory(session, input) {
  if (isTaskServerWriteEnabled()) return createTaskCategoryViaServer(session, input && input.categoryCode, input && input.displayName);
  return createTaskCategoryLegacy(session, input);
}
async function renameTaskCategory(session, categoryCode, displayName) {
  if (isTaskServerWriteEnabled()) return renameTaskCategoryViaServer(session, categoryCode, displayName);
  return renameTaskCategoryLegacy(session, categoryCode, displayName);
}
async function setTaskCategoryActive(session, categoryCode, isActive) {
  if (isTaskServerWriteEnabled()) return setTaskCategoryActiveViaServer(session, categoryCode, isActive);
  return setTaskCategoryActiveLegacy(session, categoryCode, isActive);
}
async function reorderTaskCategory(session, categoryCode, sortOrder) {
  if (isTaskServerWriteEnabled()) return reorderTaskCategoryViaServer(session, categoryCode, sortOrder);
  return reorderTaskCategoryLegacy(session, categoryCode, sortOrder);
}
// deleteTaskCategory — tên hàm gốc là "xóa nếu chưa dùng" (xem
// task-core.js's deleteTaskCategory()); phía server đặt tên
// deleteTaskCategoryIfUnusedViaServer cho đúng route/adapter — cùng 1
// nghiệp vụ, KHÔNG phải 2 operation khác nhau.
async function deleteTaskCategory(session, categoryCode) {
  if (isTaskServerWriteEnabled()) return deleteTaskCategoryIfUnusedViaServer(session, categoryCode);
  return deleteTaskCategoryLegacy(session, categoryCode);
}
// ---------------------------------------------------------------------------
// PERMISSION WRITE — HYBRID ROUTING LOCK (2026-08-31, temporary accepted arch)
// ---------------------------------------------------------------------------
// Task permission EFFECTIVE READS come from Supabase MAIN, unconditionally
// (api/_lib/task-permissions.js — no read-bridge, no flag; also
// task-core.js::listTaskAdminPeople). The 3 permission WRITE actions below
// MUST therefore also target Supabase MAIN, or an Admin / Giám đốc / Trợ lý GĐ
// change silently no-ops. Verified 2026-08-31: with the Task *business* write
// flags ON (PHF_TASK_SERVER_WRITE_ENABLED=true), permission writes were being
// routed to the EMPTY Company-PostgreSQL task.permission_* tables while reads
// still saw the ~9 live Supabase rows → WRITE_READ_DIVERGENCE.
//
// Fix: these 3 permission actions are pinned to the Supabase legacy path and
// DO NOT consult isTaskServerWriteEnabled() — UNLIKE every Task *business*
// write above (createTaskDraft / publish / lifecycle / category / proposal…),
// whose Company-PostgreSQL routing is deliberately UNCHANGED. Do not merge
// these back into the flag-gated pattern.
//
// setTaskPermissionAssignmentViaServer / createTaskPermissionGrantViaServer /
// revokeTaskPermissionGrantViaServer + api/_lib/task-write-bridge.js +
// services/phf-hr-api task.permission_* stay imported and intact as
// future-cutover infrastructure. A dedicated, separately-gated permission
// cutover (migration + read bridge + write bridge + parity verification +
// Permission Contract regression + rollback plan) is required before
// permission writes may target Company PostgreSQL — and permission reads must
// cut over in the SAME release, never independently.
// See: PHF_HR_TASK_PERMISSION_HYBRID_LOCK_2026-08-31.md
async function saveTaskPermissionAssignment(session, input) {
  return saveTaskPermissionAssignmentLegacy(session, input);
}
async function createTaskPermissionGrant(session, input) {
  return createTaskPermissionGrantLegacy(session, input);
}
async function revokeTaskPermissionGrant(session, grantId, reason) {
  return revokeTaskPermissionGrantLegacy(session, grantId, reason);
}
// NOTE: setTaskPermissionAssignmentViaServer / createTaskPermissionGrantViaServer /
// revokeTaskPermissionGrantViaServer stay in the require() above on purpose —
// intentionally-unused future permission-cutover infrastructure, not dead
// imports to be cleaned up (see the HYBRID ROUTING LOCK block above).
// getTaskDetail — cờ RIÊNG isTaskReadBridgeGetDetailEnabled(), KHÔNG gộp
// chung với isTaskServerWriteEnabled()/isTaskReadBridgeEnabled() khác (đúng
// nguyên tắc "1 cờ / 1 rủi ro" — xem task-read-bridge.js).
// Proposal V2 (2026-08-29) — viewer flags RIÊNG cho Proposal, tách khỏi
// resolveTaskViewerAuthority() (Giao việc, KHÔNG đụng tới). Server tính sẵn
// canAccept/canReject/canCancel theo ĐÚNG identity đã xác thực của session
// (KHÔNG để frontend tự so sánh employeeCode — đúng nguyên tắc "viewer flags
// tính ở server" toàn file này đang theo). No-op (trả nguyên dto) cho mọi
// Task Giao việc hoặc khi thiếu proposal_decision (field additive từ lib/
// task-read.js::getTaskById, chỉ có khi flow_type='de_xuat').
async function attachProposalViewerFlags(session, dto) {
  var task = dto && dto.task;
  if (!task || task.flow_type !== 'de_xuat' || !task.proposal_decision) return dto;
  var pd = task.proposal_decision;
  var actorContext;
  try { actorContext = await resolveActorContext(session); } catch (_e) { return dto; }
  var me = String((actorContext && actorContext.employeeCode) || '').trim().toUpperCase();
  var isRecipient = !!me && me === String(pd.recipient_employee_code || '').trim().toUpperCase();
  var isCreator = !!me && me === String(pd.created_by_employee_code || '').trim().toUpperCase();
  var isPending = pd.proposal_status === 'pending';
  dto.proposal = {
    status: pd.proposal_status,
    recipientEmployeeCode: pd.recipient_employee_code,
    generatedTaskId: pd.generated_task_id,
    rejectReason: pd.reject_reason,
    cancelReason: pd.cancel_reason,
    decidedByEmployeeCode: pd.decided_by_employee_code,
    decidedAt: pd.decided_at,
    canAccept: isRecipient && isPending,
    canReject: isRecipient && isPending,
    canCancel: isCreator && isPending,
  };
  return dto;
}

async function getTaskDetail(session, taskId) {
  // Proposal V2 (2026-08-29) — dùng getTaskDetailProposalAwareViaServer()
  // (KHÔNG phải getTaskDetailViaServer() trơn) ở CẢ 2 nhánh ViaServer bên
  // dưới: với flow_type='giao_viec' nó gọi lại NGUYÊN VẸN
  // resolveAndAuthorizeView() (không đổi hành vi Giao việc), với flow_type=
  // 'de_xuat' nó authorize đúng theo recipient/creator/admin (KHÔNG có ở
  // resolveAndAuthorizeView() gốc — xem comment đầy đủ tại định nghĩa hàm).
  if (isTaskReadBridgeGetDetailEnabled()) return attachProposalViewerFlags(session, await getTaskDetailProposalAwareViaServer(session, taskId));
  try {
    return await getTaskDetailLegacy(session, taskId);
  } catch (err) {
    // Proposal V2 (2026-08-29) — Task row của Proposal gốc VÀ của Task sinh
    // ra sau Accept đều CHỈ tồn tại ở phf_hr (PostgreSQL), KHÔNG BAO GIỜ ở
    // Supabase -> Legacy luôn TASK_NOT_FOUND cho 2 loại id này, bất kể cờ
    // cutover Giao việc. Fallback sang ViaServer CHỈ khi Legacy thực sự
    // "not found" (không che giấu lỗi permission/khác) — Task Giao việc
    // thật luôn tìm thấy ở Legacy, fallback không bao giờ kích hoạt cho
    // chúng, KHÔNG đổi hành vi Giao việc.
    if (err && err.code === 'TASK_NOT_FOUND') {
      try { return await attachProposalViewerFlags(session, await getTaskDetailProposalAwareViaServer(session, taskId)); } catch (_bridgeErr) { throw err; }
    }
    throw err;
  }
}

// TASK-SERVER-02C STEP 3 — read-path bridge, TẮT MẶC ĐỊNH. Bật bằng
// PHF_TASK_READ_BRIDGE_ENABLED=true (env). Khi tắt (mặc định), hành vi giữ
// NGUYÊN 100% như trước — gọi thẳng listTaskCategoriesLegacy() (task-core.js
// → Supabase hiện tại). CHỈ áp dụng cho listTaskCategories — KHÔNG áp dụng
// cho listTasks (lý do: xem comment đầu file task-read-bridge.js — listTasks
// có phân quyền theo actor mà endpoint bridge hiện chưa hỗ trợ).
async function listTaskCategories(session) {
  if (isTaskReadBridgeEnabled()) return bridgeListTaskCategories();
  return listTaskCategoriesLegacy(session);
}

// TASK-SERVER-02C STEP 4 — listTasks read-path bridge, TẮT MẶC ĐỊNH RIÊNG
// (PHF_TASK_READ_BRIDGE_LISTTASKS_ENABLED, khác cờ với listTaskCategories).
// Khi tắt (mặc định), hành vi giữ NGUYÊN 100% — gọi thẳng listTasksLegacy()
// (task-core.js → Supabase hiện tại), permission/scope không đổi 1 dòng.
// PROPOSAL V2 (2026-08-29, LOCKED Phương án A) — relation 'proposal_sent'/
// 'proposal_received' LUÔN đọc qua bridge (PostgreSQL), KHÔNG phụ thuộc
// PHF_TASK_READ_BRIDGE_LISTTASKS_ENABLED (cờ đó chỉ gate cutover đọc CỦA
// GIAO VIỆC 'received'/'assigned'). Lý do bắt buộc, không phải lựa chọn:
// Task row của Proposal V2 CHỈ tồn tại ở phf_hr (task.tasks), KHÔNG BAO GIỜ
// được ghi vào Supabase — listTasksLegacy() (Supabase) sẽ luôn trả rỗng cho
// 2 relation này, bất kể cờ cutover Giao việc bật hay tắt.
const PROPOSAL_LIST_RELATIONS = new Set(['proposal_sent', 'proposal_received']);
async function listTasks(session, params) {
  if (params && PROPOSAL_LIST_RELATIONS.has(params.relation)) return bridgeListTasks(session, params);
  if (isTaskReadBridgeListTasksEnabled()) return bridgeListTasks(session, params);
  return listTasksLegacy(session, params);
}
// Timeline events datastore-consistency (2026-08-28) — mirror server.js. When
// the listTasks bridge is on, Timeline events must also come from phf_hr via
// the single-task read bridge, otherwise timeline→detail nav 404s.
async function listTaskEvents(session, params) {
  if (isTaskReadBridgeListTasksEnabled()) return listTaskEventsViaServer(session, params);
  return listTaskEventsLegacy(session, params);
}
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
} = require('./_lib/checklist-late-reconciliation-service');
const {
  copyTemplateVersion: copyChecklistTemplateVersion,
  previewDiff: previewChecklistRetroDiff,
  activateTemplateVersion: activateChecklistTemplateVersion,
  dryRunRetroactiveApply: dryRunChecklistRetroApply,
  retroactiveApply: applyChecklistRetro,
  retroactiveApplyReviewedForm: applyChecklistRetroReviewedForm,
  simulateEmployeeImpactBatch: simulateChecklistRetroEmployeeImpact
} = require('./_lib/checklist-template-retroactive-service');
const { getChecklistViolationMode, getChecklistLatePointsPolicy, saveChecklistLatePointsPolicy, getChecklistRepeatViolationPolicy, saveChecklistRepeatViolationPolicy, getChecklistRepeatViolationSuggestions, saveChecklistViolations, listChecklistViolations, listChecklistViolationHistory, getChecklistViolationTaskStatus, updateChecklistViolation, cancelChecklistViolation, deleteChecklistTestViolation, deleteChecklistTestViolations } = require('./_lib/checklist-violations');
const { createChecklistEvidenceUpload, finalizeChecklistEvidenceUpload, attachChecklistEvidence, listChecklistEvidence, deleteChecklistEvidence } = require('./_lib/checklist-evidence');
const { listChecklistTasks, transitionChecklistTask, getChecklistTaskHistory, getChecklistViolationDetail } = require('./_lib/checklist-tasks');
const { listChecklistPermissionGrants, saveChecklistPermissionGrants, disableChecklistPermissionGrant, getChecklistRoleWorkspace } = require('./_lib/checklist-permissions');
const { getMarketingMonthlyKpiConfig, saveMarketingMonthlyKpiConfig, listMonthly, createMonthly, openMonthly, lockMonthly, openMonthlyException, openMonthlyPilot, myMonthlyForm, saveMyMonthly, myMonthlyReviews, myMonthlyReviewDetail, saveMonthlyReview, changeMonthlyReviewer, resnapshotMonthlyDraftTemplate, overrideMonthlyFormVersion, exportMonthlyData, getMonthlyOverduePolicy, saveMonthlyOverduePolicy, processMonthlySelfOverdue, getChecklistMonthlyScorePolicy, saveChecklistMonthlyScorePolicy, getMonthlyCyclePolicy, saveMonthlyCyclePolicy, saveMonthlyCycleOverride, syncMonthlyCycle, getChecklistAssessmentProfile } = require('./_lib/checklist-monthly');
const { getChecklistMonthlyReport, getChecklistViolationWorkflowSummary, getChecklistCurrentScoreReport, getChecklistScorePeriodReport, getChecklistAnnualResultReport } = require('./_lib/checklist-reports');
const { inspectMonthlyRecovery, createMissingMonthlyForms, getMonthlyDeletePreview, deleteMonthlyFormException } = require('./_lib/checklist-recovery');
const { previewTransitionImport, confirmTransitionImport } = require('./_lib/checklist-monthly-results-service');
const { listChecklistNotificationRules, saveChecklistNotificationRule, listMyChecklistNotifications, markChecklistNotificationRead, markAllChecklistNotificationsRead, emitChecklistNotification } = require('./_lib/checklist-notifications');
const { getKnlCapabilities, listKnlPermissionGrants, upsertKnlPermissionGrant, requireManagePermissionsForSession } = require('./_lib/knl-permissions');
const { createGradePromotionProposal, processGradePromotionProposalStep, withdrawGradePromotionProposal, listMyGradePromotionProposals, listProposalsAwaitingMyAction, listVisibleGradePromotionProposals, getGradePromotionProposalDetail, getGradeOptionsForSubject, getGradePromotionApproverOptions, getGradePromotionCriteriaStandard } = require('./_lib/knl-grade-proposals');
const { listMyKnlNotifications, markKnlNotificationRead, markAllKnlNotificationsRead } = require('./_lib/knl-notifications');
const { listKnlPeople, getKnlEmployeeProfile } = require('./_lib/knl-people');
const { getKnlEmployeeCompetencyAssignment, listKnlEmployeeCompetencyHistory, getKnlEmployeeCompetencyStandard, getKnlEmployeeCompetencyGradeStandard, setKnlEmployeeCompetencyAssignment } = require('./_lib/knl-competency');
const { listKnlFrameworks, getKnlFrameworkVersion, createKnlFramework, saveKnlFramework, cloneKnlVersion, publishKnlVersion, saveKnlGroup, saveKnlItem, saveKnlColumn, deleteKnlStructure, disableKnlStructure, reorderKnlStructure, saveKnlLevelContent } = require('./_lib/knl-frameworks');
const { previewKnlSourceSeed, seedKnlSourceManifest, listKnlSourceManifests, listKnlAssignmentTargets, listKnlFrameworkAssignments, saveKnlFrameworkAssignment } = require('./_lib/knl-assignments');
const { getKnlSurveySetup, saveKnlSurveyCampaign, openKnlSurveyCampaign, closeKnlSurveyCampaign, listKnlSurveyCampaigns, getKnlSurveyTicket, saveKnlSurveyTicket, getKnlSurveyResults, cloneKnlSurveyVersionToDraft } = require('./_lib/knl-surveys');
const { getKnlGradeMatrix, saveKnlGradeMatrix, setKnlVersionEffectivity, listKnlCompensationStandards, previewKnlCompensationFoundation, applyKnlCompensationFoundation, listKnlIncomeTargets, getKnlEmployeeIncome, saveKnlEmployeeIncome, listKnlCompensationAssignmentTargets, cloneKnlCompensationVersion, saveKnlCompensationGrades, scheduleKnlCompensationVersion, getKnlCompensationVersionAudit, listKnlEmployeeCompensationHistory, listKnlEmployeeCompensationPeriods, getKnlEmployeeNextCompensationGrade, correctKnlEmployeeCompensationPeriod } = require('./_lib/knl-foundation');
const { getKnlDashboardOverview } = require('./_lib/knl-dashboard');
const { askKnlDashboardAi } = require('./_lib/knl-dashboard-ai');
const { listEmployeeMaster, getEmployeeMasterDetail, saveProfile:saveEmployeeMasterProfile, savePrivateProfile:saveEmployeeMasterPrivateProfile, saveContract:saveEmployeeMasterContract } = require('./_lib/employee-master');
const { previewEmployeeImport, commitEmployeeImport } = require('./_lib/employee-import');
const {
  assertSameOrigin,
  assertJsonContentType,
  assertContentLength,
  validatePayload,
  publicError
} = require('./_lib/request-guard');
const { requireSession, authorizePayload, listHubAccountSummaries } = require('./_lib/auth');

/* TASK_API_WIRING_START */
const TASK_ACTION_MANIFEST = Object.freeze([
  'listTaskAssignableEmployees', 'listTaskAdminPeople', 'saveTaskPermissionAssignment', 'createTaskPermissionGrant', 'revokeTaskPermissionGrant',
  'listTaskCategories', 'listAdminTaskCategories',
  'createTaskCategory', 'renameTaskCategory', 'setTaskCategoryActive', 'deleteTaskCategory', 'reorderTaskCategory',
  'checkTaskFoundationStatus',
  'createTaskDraft', 'updateTaskDraft', 'deleteTaskDraft', 'publishTask', 'getTaskDetail',
  'listProposalRecipientEmployees', 'createTaskProposal', 'acceptTaskProposal', 'rejectTaskProposal', 'cancelTaskProposal',
  'updateTaskProgress', 'completeTask', 'reopenTask', 'cancelTask',
  'changeTaskDeadline', 'transferTaskPrimary', 'addTaskRelated',
  'removeTaskRelated', 'addTaskComment', 'addTaskLink', 'removeTaskLink',
  'listMyTaskNotifications', 'markTaskNotificationRead', 'markAllTaskNotificationsRead',
  'listTasks', 'listTaskEvents',
  'getTaskReportSummary', 'getTaskReportCategoryAnalysis', 'getTaskReportPersonAnalysis', 'getTaskReportTrend', 'listTaskReportDrilldown',
  'getTaskOverviewV2', 'getTaskReportV2Bundle', 'listTaskOverviewV2Drilldown',
  'getTaskReportV2PersonAnalysis', 'getTaskReportV2DepartmentAnalysis', 'getTaskReportV2CategoryAnalysis', 'getTaskReportV2Trend',
  'createTaskRecurrence', 'updateTaskRecurrence', 'pauseTaskRecurrence', 'resumeTaskRecurrence', 'stopTaskRecurrence', 'listTaskRecurrence', 'runTaskRecurrence',
  'requestTaskCancel', 'approveTaskCancelRequest', 'rejectTaskCancelRequest', 'withdrawTaskCancelRequest',
  'taskMailSettingsGet', 'taskMailSetWeeklyEnabled', 'taskMailAddRecipient', 'taskMailSetRecipientEnabled', 'taskMailRemoveRecipient', 'taskMailWeeklyPreview'
]);

function copyTaskPayloadField(target, payload, publicName, coreName) {
  if (Object.prototype.hasOwnProperty.call(payload, publicName)) target[coreName] = payload[publicName];
}

function taskListInput(payload) {
  const input = {};
  copyTaskPayloadField(input, payload, 'relation', 'relation');
  copyTaskPayloadField(input, payload, 'status_filter', 'statusFilter');
  copyTaskPayloadField(input, payload, 'scope', 'scope');
  copyTaskPayloadField(input, payload, 'search', 'search');
  copyTaskPayloadField(input, payload, 'limit', 'limit');
  copyTaskPayloadField(input, payload, 'offset', 'offset');
  return input;
}

function taskCreateDraftInput(payload) {
  const input = {};
  copyTaskPayloadField(input, payload, 'flow_type', 'flowType');
  copyTaskPayloadField(input, payload, 'title', 'title');
  copyTaskPayloadField(input, payload, 'content', 'content');
  copyTaskPayloadField(input, payload, 'category_code', 'categoryCode');
  copyTaskPayloadField(input, payload, 'priority', 'priority');
  copyTaskPayloadField(input, payload, 'start_at', 'startAt');
  copyTaskPayloadField(input, payload, 'deadline', 'deadline');
  copyTaskPayloadField(input, payload, 'primary_employee_code', 'primaryEmployeeCode');
  copyTaskPayloadField(input, payload, 'create_idempotency_key', 'idempotencyKey');
  return input;
}

function taskDraftPatch(payload) {
  const patch = {};
  copyTaskPayloadField(patch, payload, 'title', 'title');
  copyTaskPayloadField(patch, payload, 'content', 'content');
  copyTaskPayloadField(patch, payload, 'category_code', 'categoryCode');
  copyTaskPayloadField(patch, payload, 'priority', 'priority');
  copyTaskPayloadField(patch, payload, 'start_at', 'startAt');
  copyTaskPayloadField(patch, payload, 'deadline', 'deadline');
  return patch;
}

// PROPOSAL V2 (2026-08-29) — input shape riêng, KHÔNG dùng chung
// taskCreateDraftInput (Proposal không có primary_employee_code/flow_type do
// client gửi — flow_type luôn 'de_xuat' cố định, recipient thay cho primary).
function taskProposalCreateInput(payload) {
  const input = {};
  copyTaskPayloadField(input, payload, 'title', 'title');
  copyTaskPayloadField(input, payload, 'content', 'content');
  copyTaskPayloadField(input, payload, 'category_code', 'categoryCode');
  copyTaskPayloadField(input, payload, 'priority', 'priority');
  copyTaskPayloadField(input, payload, 'start_at', 'startAt');
  copyTaskPayloadField(input, payload, 'deadline', 'deadline');
  copyTaskPayloadField(input, payload, 'recipient_employee_code', 'recipientEmployeeCode');
  return input;
}

function taskProposalAcceptInput(payload) {
  const input = {};
  copyTaskPayloadField(input, payload, 'title', 'title');
  copyTaskPayloadField(input, payload, 'content', 'content');
  copyTaskPayloadField(input, payload, 'category_code', 'categoryCode');
  copyTaskPayloadField(input, payload, 'priority', 'priority');
  copyTaskPayloadField(input, payload, 'start_at', 'startAt');
  copyTaskPayloadField(input, payload, 'deadline', 'deadline');
  copyTaskPayloadField(input, payload, 'primary_employee_code', 'primaryEmployeeCode');
  return input;
}

function taskCategoryCreateInput(payload) {
  const input = {};
  copyTaskPayloadField(input, payload, 'category_code', 'categoryCode');
  copyTaskPayloadField(input, payload, 'display_name', 'displayName');
  return input;
}

// RECURRENCE V1 — thin whitelist snake_case -> camelCase, same discipline as
// every normalizer above. NO business logic here (frequency/weekday/day-range/
// date validation all live in api/_lib/task-recurrence-actions.js + the LOCKED
// engine). taskRecurrenceInput() is shared by create + update.
function taskRecurrenceInput(payload) {
  const input = {};
  copyTaskPayloadField(input, payload, 'title', 'title');
  copyTaskPayloadField(input, payload, 'content', 'content');
  copyTaskPayloadField(input, payload, 'category_code', 'categoryCode');
  copyTaskPayloadField(input, payload, 'priority', 'priority');
  copyTaskPayloadField(input, payload, 'primary_employee_code', 'primaryEmployeeCode');
  copyTaskPayloadField(input, payload, 'related_employee_codes', 'relatedEmployeeCodes');
  copyTaskPayloadField(input, payload, 'frequency', 'frequency');
  copyTaskPayloadField(input, payload, 'weekday', 'weekday');
  copyTaskPayloadField(input, payload, 'day_of_month', 'dayOfMonth');
  copyTaskPayloadField(input, payload, 'start_date', 'startDate');
  copyTaskPayloadField(input, payload, 'start_time', 'startTime');
  copyTaskPayloadField(input, payload, 'duration_days', 'durationDays');
  copyTaskPayloadField(input, payload, 'end_date', 'endDate');
  copyTaskPayloadField(input, payload, 'repeat_count', 'repeatCount');
  copyTaskPayloadField(input, payload, 'reason', 'reason');
  copyTaskPayloadField(input, payload, 'initial_task_id', 'initialTaskId');
  return input;
}
function taskRecurrenceListInput(payload) {
  const input = {};
  copyTaskPayloadField(input, payload, 'status', 'status');
  return input;
}
function taskRecurrenceRunInput(payload) {
  const input = {};
  copyTaskPayloadField(input, payload, 'rule_id', 'ruleId');
  return input;
}
// CANCEL POLICY V1 — approve/reject/withdraw decision options. Thin whitelist,
// no business logic (authorization + state live in task-server-integration.js
// + the LOCKED cancel-request module).
function taskCancelRequestDecisionInput(payload) {
  const input = {};
  copyTaskPayloadField(input, payload, 'expected_row_version', 'expectedRowVersion');
  copyTaskPayloadField(input, payload, 'note', 'note');
  return input;
}

function taskPermissionGrantInput(payload) {
  const input = {};
  copyTaskPayloadField(input, payload, 'grantee_employee_code', 'granteeEmployeeCode');
  copyTaskPayloadField(input, payload, 'grant_type', 'grantType');
  copyTaskPayloadField(input, payload, 'people_scope', 'peopleScope');
  copyTaskPayloadField(input, payload, 'capabilities', 'capabilities');
  copyTaskPayloadField(input, payload, 'reason', 'reason');
  return input;
}

function taskPermissionAssignmentInput(payload) {
  const input = {};
  copyTaskPayloadField(input, payload, 'employee_code', 'employeeCode');
  copyTaskPayloadField(input, payload, 'preset_code', 'presetCode');
  copyTaskPayloadField(input, payload, 'reason', 'reason');
  return input;
}

function taskListInput(payload) {
  const input = {};
  copyTaskPayloadField(input, payload, 'relation', 'relation');
  copyTaskPayloadField(input, payload, 'status_filter', 'statusFilter');
  copyTaskPayloadField(input, payload, 'scope', 'scope');
  copyTaskPayloadField(input, payload, 'search', 'search');
  copyTaskPayloadField(input, payload, 'limit', 'limit');
  copyTaskPayloadField(input, payload, 'offset', 'offset');
  return input;
}

function taskEventsInput(payload) {
  const input = {};
  copyTaskPayloadField(input, payload, 'relation', 'relation');
  copyTaskPayloadField(input, payload, 'scope', 'scope');
  copyTaskPayloadField(input, payload, 'limit', 'limit');
  return input;
}

function taskReportContextInput(payload) {
  const input = {};
  copyTaskPayloadField(input, payload, 'relation', 'relation');
  copyTaskPayloadField(input, payload, 'scope', 'scope');
  copyTaskPayloadField(input, payload, 'period', 'period');
  copyTaskPayloadField(input, payload, 'category_code', 'category_code');
  return input;
}
function taskReportDrilldownInput(payload) {
  const input = taskReportContextInput(payload);
  copyTaskPayloadField(input, payload, 'metric_id', 'metric_id');
  copyTaskPayloadField(input, payload, 'employee_code', 'employee_code');
  copyTaskPayloadField(input, payload, 'limit', 'limit');
  copyTaskPayloadField(input, payload, 'offset', 'offset');
  return input;
}

function taskOverviewV2Input(payload) {
  const input = {};
  copyTaskPayloadField(input, payload, 'period', 'period');
  // UI/UX Step 2 — dashboard advanced filter. task-reporting-v2.js validates
  // + applies it as a pure post-authorization narrowing (never widens scope).
  copyTaskPayloadField(input, payload, 'filters', 'filters');
  return input;
}
function taskReportV2BundleInput(payload) {
  const input = taskOverviewV2Input(payload);
  // section list — task-reporting-v2.js whitelists it against BUNDLE_SECTION_KEYS
  copyTaskPayloadField(input, payload, 'sections', 'sections');
  return input;
}
function taskOverviewV2DrilldownInput(payload) {
  const input = taskOverviewV2Input(payload);
  copyTaskPayloadField(input, payload, 'metric_id', 'metric_id');
  copyTaskPayloadField(input, payload, 'employee_code', 'employee_code');
  copyTaskPayloadField(input, payload, 'department', 'department');
  copyTaskPayloadField(input, payload, 'category_code', 'category_code');
  copyTaskPayloadField(input, payload, 'source_of_work', 'source_of_work');
  copyTaskPayloadField(input, payload, 'limit', 'limit');
  copyTaskPayloadField(input, payload, 'offset', 'offset');
  return input;
}

function rejectUnknownTaskAction(action) {
  const error = new Error('Thao tác Task không hợp lệ: ' + action);
  error.statusCode = 400;
  error.code = 'TASK_ACTION_INVALID';
  throw error;
}

// ---------------------------------------------------------------------------
// PHF_SUPABASE_CPU_OBSERVABILITY_V1 — narrow, additive, updateTaskProgress
// ONLY. One structured console.log per request, at the trusted server
// boundary (this is the earliest point that has BOTH the authenticated
// session identity AND the outcome/error of the actual write). Never throws,
// never blocks/alters the business request or response, never touches
// Supabase/DB, no secrets/tokens/headers/body/result-text logged — see
// TASK_PROGRESS_LOG_DENYLIST_NOTE below. This is observability only: no
// rate limiting, no behavior change, does not touch CPU Fix V1.
// ---------------------------------------------------------------------------
// typeof-guarded: this constant sits inside the TASK_API_WIRING_START/END
// block that scripts/test-task-api-parity.js also executes in a bare vm
// context with no `process` global — must not assume `process` exists.
const DEPLOYMENT_IDENTIFIER = String(
  (typeof process !== 'undefined' && process.env && (process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID)) || ''
).trim().slice(0, 12) || 'NOT_AVAILABLE';

function safeTaskProgressRequestId() {
  // Same defensive reasoning as DEPLOYMENT_IDENTIFIER above: this sits inside
  // the wiring block a bare vm context also executes, where `crypto` is not
  // injected — never let request-id generation itself break the real dispatch.
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (_) { /* fall through */ }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function logTaskProgressEvent(fields) {
  // Deliberately swallow ANY logging failure (serialization error, whatever)
  // — this function must never be able to affect the business request.
  try {
    console.log(JSON.stringify(Object.assign({
      event: 'phf_task_progress_request',
      timestamp: new Date().toISOString(),
      deployment: DEPLOYMENT_IDENTIFIER
    }, fields)));
  } catch (logError) {
    try { console.warn('[PHF Task Observability] log emit failed (non-fatal):', logError && logError.message); } catch (_) { /* truly never throw */ }
  }
}

async function dispatchTaskAction(session, payload) {
  const action = String(payload && payload.action || '').trim();
  switch (action) {
    case 'listTaskAssignableEmployees': return { handled: true, result: await listTaskAssignableEmployees(session) };
    case 'listTaskAdminPeople': return { handled: true, result: await listTaskAdminPeople(session) };
    case 'saveTaskPermissionAssignment': return { handled: true, result: await saveTaskPermissionAssignment(session, taskPermissionAssignmentInput(payload)) };
    case 'createTaskPermissionGrant': return { handled: true, result: await createTaskPermissionGrant(session, taskPermissionGrantInput(payload)) };
    case 'revokeTaskPermissionGrant': return { handled: true, result: await revokeTaskPermissionGrant(session, payload.grant_id, payload.reason) };
    case 'listTaskCategories': return { handled: true, result: await listTaskCategories(session) };
    case 'listAdminTaskCategories': return { handled: true, result: await listAdminTaskCategories(session) };
    case 'createTaskCategory': return { handled: true, result: await createTaskCategory(session, taskCategoryCreateInput(payload)) };
    case 'renameTaskCategory': return { handled: true, result: await renameTaskCategory(session, payload.category_code, payload.display_name) };
    case 'setTaskCategoryActive': return { handled: true, result: await setTaskCategoryActive(session, payload.category_code, payload.is_active) };
    case 'deleteTaskCategory': return { handled: true, result: await deleteTaskCategory(session, payload.category_code) };
    case 'reorderTaskCategory': return { handled: true, result: await reorderTaskCategory(session, payload.category_code, payload.sort_order) };
    // MAIL V1 Increment 2 — Admin Mail Settings + Weekly Report (Admin-only).
    case 'taskMailSettingsGet': return { handled: true, result: await taskMailSettingsGet(session) };
    case 'taskMailSetWeeklyEnabled': return { handled: true, result: await taskMailSetWeeklyEnabled(session, payload && payload.enabled) };
    case 'taskMailAddRecipient': return { handled: true, result: await taskMailAddRecipient(session, { email: payload && payload.email, label: payload && payload.label }) };
    case 'taskMailSetRecipientEnabled': return { handled: true, result: await taskMailSetRecipientEnabled(session, { id: payload && payload.id, enabled: payload && payload.enabled }) };
    case 'taskMailRemoveRecipient': return { handled: true, result: await taskMailRemoveRecipient(session, { id: payload && payload.id }) };
    case 'taskMailWeeklyPreview': return { handled: true, result: await taskMailWeeklyPreview(session) };
    case 'checkTaskFoundationStatus': return { handled: true, result: await checkTaskFoundationStatus(session) };
    case 'createTaskDraft': return { handled: true, result: await createTaskDraft(session, taskCreateDraftInput(payload)) };
    // Proposal V2 (2026-08-29, LOCKED Phương án A — PostgreSQL-only)
    case 'listProposalRecipientEmployees': return { handled: true, result: await listProposalRecipientEmployees(session) };
    case 'createTaskProposal': return { handled: true, result: await createTaskProposal(session, taskProposalCreateInput(payload)) };
    case 'acceptTaskProposal': return { handled: true, result: await acceptTaskProposal(session, payload.proposal_task_id, taskProposalAcceptInput(payload)) };
    case 'rejectTaskProposal': return { handled: true, result: await rejectTaskProposal(session, payload.proposal_task_id, payload.reason) };
    case 'cancelTaskProposal': return { handled: true, result: await cancelTaskProposal(session, payload.proposal_task_id, payload.reason) };
    case 'updateTaskDraft': return { handled: true, result: await updateTaskDraft(session, payload.task_id, payload.expected_row_version, taskDraftPatch(payload)) };
    case 'deleteTaskDraft': return { handled: true, result: await deleteTaskDraft(session, payload.task_id, payload.expected_row_version) };
    case 'publishTask': return { handled: true, result: await publishTask(session, payload.task_id, payload.expected_row_version) };
    case 'getTaskDetail': return { handled: true, result: await getTaskDetail(session, payload.task_id) };
    case 'updateTaskProgress': {
      const requestId = safeTaskProgressRequestId();
      const startedAt = Date.now();
      const baseFields = {
        request_id: requestId,
        action: 'updateTaskProgress',
        actor_account_id: (session && session.account && session.account.id) || '',
        // Named actor_employee, deliberately not the longer field name some
        // other legacy payload/module uses for a client-supplied employee
        // code — that longer literal is one of the strings test-task-api-
        // parity.js scans the wiring block for, as a regression guard
        // against a dispatcher trusting a client-supplied actor field. This
        // value is read from the verified server-side session, never from
        // payload — the guard's real concern does not apply here — but
        // avoiding that literal keeps the unrelated check meaningful instead
        // of papering over an incidental text collision.
        actor_employee: (session && session.account && session.account.employeeCode) || '',
        task_id: String((payload && payload.task_id) || '').trim(),
        expected_row_version: Number.isFinite(Number(payload && payload.expected_row_version)) ? Number(payload.expected_row_version) : null,
        progress_percent: Number.isFinite(Number(payload && payload.progress_percent)) ? Number(payload.progress_percent) : null
      };
      try {
        const result = await updateTaskProgress(session, payload.task_id, payload.expected_row_version, payload.progress_percent, payload.progress_status);
        logTaskProgressEvent(Object.assign({}, baseFields, {
          outcome: 'success', error_code: '', http_status: 200, duration_ms: Date.now() - startedAt
        }));
        return { handled: true, result };
      } catch (progressError) {
        logTaskProgressEvent(Object.assign({}, baseFields, {
          outcome: 'error',
          error_code: (progressError && progressError.code) || '',
          http_status: Number(progressError && progressError.statusCode) || 500,
          duration_ms: Date.now() - startedAt
        }));
        throw progressError; // rethrow UNCHANGED — logging never alters response behavior
      }
    }
    case 'completeTask': return { handled: true, result: await completeTask(session, payload.task_id, payload.expected_row_version, payload.result_text) };
    case 'reopenTask': return { handled: true, result: await reopenTask(session, payload.task_id, payload.expected_row_version, payload.reason) };
    case 'cancelTask': return { handled: true, result: await cancelTask(session, payload.task_id, payload.expected_row_version, payload.reason) };
    // CANCEL POLICY V1 — active primary "Yêu cầu hủy" + authorized-reviewer decision.
    case 'requestTaskCancel': return { handled: true, result: await requestTaskCancel(session, payload.task_id, payload.reason) };
    case 'approveTaskCancelRequest': return { handled: true, result: await approveTaskCancelRequest(session, payload.task_id, taskCancelRequestDecisionInput(payload)) };
    case 'rejectTaskCancelRequest': return { handled: true, result: await rejectTaskCancelRequest(session, payload.task_id, taskCancelRequestDecisionInput(payload)) };
    case 'withdrawTaskCancelRequest': return { handled: true, result: await withdrawTaskCancelRequest(session, payload.task_id, taskCancelRequestDecisionInput(payload)) };
    case 'changeTaskDeadline': return { handled: true, result: await changeTaskDeadline(session, payload.task_id, payload.expected_row_version, payload.new_deadline, payload.reason) };
    case 'transferTaskPrimary': return { handled: true, result: await transferTaskPrimary(session, payload.task_id, payload.expected_row_version, payload.new_primary_employee_code, payload.reason) };
    case 'addTaskRelated': return { handled: true, result: await addTaskRelated(session, payload.task_id, payload.target_employee_code) };
    case 'removeTaskRelated': return { handled: true, result: await removeTaskRelated(session, payload.task_id, payload.target_employee_code) };
    case 'addTaskComment': return { handled: true, result: await addTaskComment(session, payload.task_id, payload.body) };
    case 'addTaskLink': return { handled: true, result: await addTaskLink(session, payload.task_id, payload.side, payload.url, payload.label) };
    case 'removeTaskLink': return { handled: true, result: await removeTaskLink(session, payload.task_id, payload.link_id) };
    case 'listMyTaskNotifications': return { handled: true, result: await listMyTaskNotifications(session, { limit: payload.limit }) };
    case 'markTaskNotificationRead': return { handled: true, result: await markTaskNotificationRead(session, { id: payload.id, ids: payload.ids }) };
    case 'markAllTaskNotificationsRead': return { handled: true, result: await markAllTaskNotificationsRead(session) };
    case 'listTasks': return { handled: true, result: await listTasks(session, taskListInput(payload)) };
    case 'listTaskEvents': return { handled: true, result: await listTaskEvents(session, taskEventsInput(payload)) };
    case 'getTaskReportSummary': return { handled: true, result: await getTaskReportSummary(session, taskReportContextInput(payload)) };
    case 'getTaskReportCategoryAnalysis': return { handled: true, result: await getTaskReportCategoryAnalysis(session, taskReportContextInput(payload)) };
    case 'getTaskReportPersonAnalysis': return { handled: true, result: await getTaskReportPersonAnalysis(session, taskReportContextInput(payload)) };
    case 'getTaskReportTrend': return { handled: true, result: await getTaskReportTrend(session, taskReportContextInput(payload)) };
    case 'listTaskReportDrilldown': return { handled: true, result: await listTaskReportDrilldown(session, taskReportDrilldownInput(payload)) };
    case 'getTaskOverviewV2': return { handled: true, result: await getTaskOverviewV2(session, taskOverviewV2Input(payload)) };
    case 'getTaskReportV2Bundle': return { handled: true, result: await getTaskReportV2Bundle(session, taskReportV2BundleInput(payload)) };
    case 'listTaskOverviewV2Drilldown': return { handled: true, result: await listTaskOverviewV2Drilldown(session, taskOverviewV2DrilldownInput(payload)) };
    case 'getTaskReportV2PersonAnalysis': return { handled: true, result: await getTaskReportV2PersonAnalysis(session, taskOverviewV2Input(payload)) };
    case 'getTaskReportV2DepartmentAnalysis': return { handled: true, result: await getTaskReportV2DepartmentAnalysis(session, taskOverviewV2Input(payload)) };
    case 'getTaskReportV2CategoryAnalysis': return { handled: true, result: await getTaskReportV2CategoryAnalysis(session, taskOverviewV2Input(payload)) };
    case 'getTaskReportV2Trend': return { handled: true, result: await getTaskReportV2Trend(session, taskOverviewV2Input(payload)) };
    // RECURRENCE V1 (2026-08-31) — "Công việc lặp" (Full Create) + "Lịch lặp"
    // management view. Company PostgreSQL only; no mail/notification/cron in V1.
    case 'createTaskRecurrence': return { handled: true, result: await createTaskRecurrence(session, taskRecurrenceInput(payload)) };
    case 'updateTaskRecurrence': return { handled: true, result: await updateTaskRecurrence(session, payload.rule_id, taskRecurrenceInput(payload)) };
    case 'pauseTaskRecurrence': return { handled: true, result: await pauseTaskRecurrence(session, payload.rule_id, payload.reason) };
    case 'resumeTaskRecurrence': return { handled: true, result: await resumeTaskRecurrence(session, payload.rule_id, payload.reason) };
    case 'stopTaskRecurrence': return { handled: true, result: await stopTaskRecurrence(session, payload.rule_id, payload.reason) };
    case 'listTaskRecurrence': return { handled: true, result: await listTaskRecurrence(session, taskRecurrenceListInput(payload)) };
    case 'runTaskRecurrence': return { handled: true, result: await runTaskRecurrence(session, taskRecurrenceRunInput(payload)) };
    default:
      if (/task/i.test(action)) rejectUnknownTaskAction(action);
      return { handled: false, result: null };
  }
}
/* TASK_API_WIRING_END */

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
      // Production entrypoint parity with server.js for the Checklist score-table
      // versioning flow (Sửa Bảng tổng điểm → Xem trước → Phát hành → Cập nhật Phiếu
      // tháng). Without these, the request fell through to legacy validatePayload and
      // failed with EMPLOYEE_REQUIRED ("Thiếu thông tin học viên cần lưu.").
      if (payload && payload.action === 'checklistRetroCopyVersion') {
        return res.status(200).json({ok:true,...await copyChecklistTemplateVersion(session, payload.input || {})});
      }
      if (payload && payload.action === 'checklistRetroPreviewDiff') {
        return res.status(200).json({ok:true,...previewChecklistRetroDiff(session, payload.input || {})});
      }
      if (payload && payload.action === 'activateChecklistTemplateVersion') {
        return res.status(200).json({ok:true,...await activateChecklistTemplateVersion(session, payload.input || {})});
      }
      if (payload && payload.action === 'checklistRetroDryRunApply') {
        return res.status(200).json({ok:true,...await dryRunChecklistRetroApply(session, payload.input || {})});
      }
      if (payload && payload.action === 'checklistRetroApply') {
        return res.status(200).json({ok:true,...await applyChecklistRetro(session, payload.input || {})});
      }
      if (payload && payload.action === 'checklistRetroApplyReviewedForm') {
        return res.status(200).json({ok:true,...await applyChecklistRetroReviewedForm(session, payload.input || {})});
      }
      if (payload && payload.action === 'checklistRetroSimulateEmployeeImpact') {
        return res.status(200).json({ok:true,...await simulateChecklistRetroEmployeeImpact(session, payload.input || {})});
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
      if(payload&&payload.action==='resnapshotChecklistMonthlyDraft')return res.status(200).json({ok:true,...await resnapshotMonthlyDraftTemplate(session,payload)});
      if(payload&&payload.action==='overrideChecklistMonthlyFormVersion')return res.status(200).json({ok:true,...await overrideMonthlyFormVersion(session,payload)});
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
      const taskDispatch = await dispatchTaskAction(session, payload);
      if (taskDispatch.handled) return res.status(200).json({ok:true,result:taskDispatch.result});
      const competitionDispatch = await dispatchCompetitionAction(session, payload);
      if (competitionDispatch.handled) return res.status(200).json({ok:true,result:competitionDispatch.result});
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
