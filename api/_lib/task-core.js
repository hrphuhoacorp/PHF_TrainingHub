'use strict';

/*
 * PHF Task V1 — Batch 2: command-based write layer cho SINGLE TASK.
 *
 * KHÔNG có generic saveTask(taskObject) — mỗi command dưới đây là 1 hàm rõ
 * ràng, tự validate input + tự resolve field nào được ghi. Client không bao
 * giờ là authority: mọi command đều (1) resolve actor qua
 * lib/task-employee-scope.js, (2) check permission qua
 * lib/task-permissions.js (KHÔNG duplicate permission logic ở đây), (3)
 * validate expected row_version, (4) ghi qua RPC atomic khi cần 2+ statement
 * (xem scripts/PHF_TASK_CORE_RPC_1.67.0.sql — LOCAL CANDIDATE, CHƯA APPLY).
 *
 * ATOMICITY: publish/progress/complete/reopen/cancel/deadline_change/transfer
 * đi qua RPC (1 transaction thật). createDraft/updateDraft là 1 statement
 * PostgREST duy nhất nên tự atomic, không cần RPC. addRelated/removeRelated/
 * addComment/addLink/removeLink là 2 call rời (ghi bảng con + ghi task_events)
 * — CHƯA fully atomic, xem Output mục F (Atomicity analysis) — chấp nhận cho
 * batch này vì không nằm trong danh sách "Critical" của yêu cầu Batch 2.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { resolveActorContext, loadOrgRows, findByCode } = require('./task-employee-scope');
const {
  resolveEffectiveTaskScope,
  requireTaskCapability,
  classifyTaskRelation,
  canViewTask,
  canAssignTaskTo,
  subjectMatchesTaskScope
} = require('./task-permissions');

const configured = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const supabase = configured
  ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

const TASKS_TABLE = 'task_tasks';
const ASSIGNEES_TABLE = 'task_assignees';
const EVENTS_TABLE = 'task_events';
const COMMENTS_TABLE = 'task_comments';
const LINKS_TABLE = 'task_links';
const CATEGORIES_TABLE = 'task_categories';

function text(value) { return String(value == null ? '' : value).trim(); }
function code(value) { return text(value).toUpperCase(); }
function fail(message, statusCode, errorCode) {
  const e = new Error(message);
  e.statusCode = statusCode || 400;
  e.code = errorCode || 'TASK_CORE_INVALID';
  throw e;
}
function ensureDb() { if (!supabase) fail('Supabase chưa được cấu hình cho PHF Task.', 503, 'SUPABASE_NOT_CONFIGURED'); }

function throwDb(error) {
  if (!error) return;
  const errCode = text(error.code);
  const message = text(error.message);
  if (errCode === 'PGRST205' || errCode === '42P01' || /relation .* does not exist/i.test(message) || /Could not find the table/i.test(message)) {
    fail('Bảng PHF Task chưa sẵn sàng. Vui lòng kiểm tra migration Foundation/Permissions đã apply chưa.', 503, 'TASK_SCHEMA_MISSING');
  }
  fail('Lỗi hệ thống PHF Task: ' + message, 500, 'TASK_DB_ERROR');
}

// Dịch RAISE EXCEPTION message từ scripts/PHF_TASK_CORE_RPC_1.67.0.sql thành
// lỗi JS có statusCode/code rõ ràng — KHÔNG lộ nguyên văn Postgres error ra client.
const RPC_ERROR_MAP = {
  TASK_NOT_FOUND: [404, 'Không tìm thấy task.'],
  TASK_VERSION_CONFLICT: [409, 'Task đã được cập nhật ở nơi khác. Vui lòng tải lại trước khi thao tác tiếp.'],
  TASK_NOT_DRAFT: [409, 'Task không còn ở trạng thái draft.'],
  TASK_PRIMARY_REQUIRED: [400, 'Task cần đúng 1 người nhận chính (primary) trước khi phát hành.'],
  TASK_NOT_ACTIVE: [409, 'Task không ở trạng thái đang hoạt động (published/in_progress).'],
  TASK_PROGRESS_PERCENT_INVALID: [400, 'progress_percent phải trong khoảng 0-100.'],
  TASK_PROGRESS_STATUS_INVALID: [400, 'progress_status không hợp lệ.'],
  TASK_COMPLETION_RESULT_REQUIRED: [400, 'Bắt buộc nhập Kết quả thực hiện khi hoàn thành task.'],
  TASK_NOT_COMPLETED: [409, 'Chỉ task đã hoàn thành mới mở lại được.'],
  TASK_REOPEN_REASON_REQUIRED: [400, 'Bắt buộc nhập lý do khi mở lại task.'],
  TASK_DRAFT_USE_DELETE: [409, 'Task đang là draft — dùng xóa thay vì hủy.'],
  TASK_ALREADY_CANCELLED: [409, 'Task đã bị hủy trước đó.'],
  TASK_MUST_REOPEN_BEFORE_CANCEL: [409, 'Task đã hoàn thành — cần mở lại (reopen) trước khi hủy.'],
  TASK_CANCEL_REASON_REQUIRED: [400, 'Bắt buộc nhập lý do khi hủy task.'],
  TASK_CANCELLED_IMMUTABLE: [409, 'Task đã hủy — không thể đổi deadline.'],
  TASK_DEADLINE_REQUIRED: [400, 'Deadline mới là bắt buộc.'],
  TASK_DEADLINE_REASON_REQUIRED: [400, 'Bắt buộc nhập lý do khi đổi deadline.'],
  TASK_TRANSFER_REASON_REQUIRED: [400, 'Bắt buộc nhập lý do khi chuyển người phụ trách.'],
  TASK_TRANSFER_TARGET_REQUIRED: [400, 'Thiếu người phụ trách mới.'],
  TASK_PRIMARY_NOT_FOUND: [409, 'Task hiện chưa có primary active để chuyển.'],
  TASK_TRANSFER_SAME_EMPLOYEE: [400, 'Người phụ trách mới trùng người hiện tại.']
};

function throwRpc(error) {
  if (!error) return;
  const msg = text(error.message);
  const known = Object.keys(RPC_ERROR_MAP).find(k => msg.indexOf(k) !== -1);
  if (known) {
    const [statusCode, friendly] = RPC_ERROR_MAP[known];
    fail(friendly, statusCode, known);
  }
  throwDb(error);
}

async function callRpc(fnName, params) {
  ensureDb();
  const { data, error } = await supabase.rpc(fnName, params);
  if (error) throwRpc(error);
  return data;
}

function actorFrom(actorContext) { return actorContext.employeeCode; }

async function loadTaskRow(taskId) {
  ensureDb();
  const { data, error } = await supabase.from(TASKS_TABLE).select('*').eq('id', taskId).maybeSingle();
  if (error) throwDb(error);
  if (!data) fail('Không tìm thấy task.', 404, 'TASK_NOT_FOUND');
  return data;
}

async function loadAssignees(taskId) {
  ensureDb();
  const { data, error } = await supabase.from(ASSIGNEES_TABLE).select('*').eq('task_id', taskId);
  if (error) throwDb(error);
  return data || [];
}

function toRelationAssignees(rows) {
  return (rows || []).map(r => ({ employeeCode: r.employee_code, role: r.role, isActive: r.is_active }));
}

async function requireView(session, taskRow, assigneeRows) {
  const relationTask = { createdByEmployeeCode: taskRow.created_by_employee_code };
  const allowed = await canViewTask(session, relationTask, toRelationAssignees(assigneeRows));
  if (!allowed) fail('Không có quyền xem task này.', 403, 'TASK_VIEW_DENIED');
}

async function categoryActive(categoryCode) {
  ensureDb();
  const { data, error } = await supabase.from(CATEGORIES_TABLE).select('category_code,is_active').eq('category_code', categoryCode).maybeSingle();
  if (error) throwDb(error);
  if (!data) fail('Category không tồn tại: ' + categoryCode, 400, 'TASK_CATEGORY_NOT_FOUND');
  if (!data.is_active) fail('Category đã ngừng dùng: ' + categoryCode, 400, 'TASK_CATEGORY_INACTIVE');
}

// ---------------------------------------------------------------------------
// 1) CREATE DRAFT — single INSERT, tự atomic, KHÔNG event (draft = pre-audit,
//    đúng chủ ý Foundation: event_type enum bắt đầu từ 'published').
// ---------------------------------------------------------------------------
async function createTaskDraft(session, input) {
  ensureDb();
  const actorContext = await resolveActorContext(session);
  const flowType = text(input.flowType);
  if (!['giao_viec', 'de_xuat'].includes(flowType)) fail('flow_type không hợp lệ.', 400, 'TASK_FLOW_TYPE_INVALID');
  const title = text(input.title);
  if (!title) fail('Tiêu đề là bắt buộc.', 400, 'TASK_TITLE_REQUIRED');
  const categoryCode = code(input.categoryCode);
  if (!categoryCode) fail('Category là bắt buộc.', 400, 'TASK_CATEGORY_REQUIRED');
  await categoryActive(categoryCode);
  const priority = text(input.priority) || 'thuong';
  if (!['thuong', 'quan_trong', 'khan_cap'].includes(priority)) fail('priority không hợp lệ.', 400, 'TASK_PRIORITY_INVALID');
  const deadline = text(input.deadline);
  if (!deadline) fail('Deadline là bắt buộc.', 400, 'TASK_DEADLINE_REQUIRED');

  const primaryEmployeeCode = input.primaryEmployeeCode ? code(input.primaryEmployeeCode) : '';
  if (primaryEmployeeCode) {
    // self-task luôn hợp lệ; giao người khác cần capability assign + scope —
    // dùng đúng permission engine Batch 1, không tự viết lại logic.
    const allowed = await canAssignTaskTo(session, primaryEmployeeCode);
    if (!allowed) fail('Không có quyền giao task cho nhân sự này.', 403, 'TASK_ASSIGN_DENIED');
  }

  const row = {
    flow_type: flowType,
    status: 'draft',
    title,
    content: text(input.content),
    category_code: categoryCode,
    priority,
    start_at: input.startAt ? text(input.startAt) : null,
    deadline,
    created_by_employee_code: actorContext.employeeCode
  };
  const { data, error } = await supabase.from(TASKS_TABLE).insert(row).select('*').single();
  if (error) throwDb(error);

  if (primaryEmployeeCode) {
    const { error: assigneeError } = await supabase.from(ASSIGNEES_TABLE).insert({
      task_id: data.id, employee_code: primaryEmployeeCode, role: 'primary', assigned_by_employee_code: actorContext.employeeCode
    });
    if (assigneeError) throwDb(assigneeError);
  }

  return data;
}

// ---------------------------------------------------------------------------
// 2) UPDATE DRAFT — single UPDATE với WHERE status='draft' AND row_version=?,
//    tự atomic (1 statement). Chỉ creator/actor có capability update mới sửa.
// ---------------------------------------------------------------------------
async function updateTaskDraft(session, taskId, expectedRowVersion, patch) {
  ensureDb();
  const actorContext = await resolveActorContext(session);
  const current = await loadTaskRow(taskId);
  if (current.status !== 'draft') fail('Chỉ sửa được task đang ở trạng thái draft.', 409, 'TASK_NOT_DRAFT');
  if (current.created_by_employee_code !== actorContext.employeeCode) {
    const { scope } = await resolveEffectiveTaskScope(session);
    requireTaskCapability({ scope }, 'update');
  }

  const patchRow = {};
  if (patch.title !== undefined) {
    const title = text(patch.title);
    if (!title) fail('Tiêu đề không được rỗng.', 400, 'TASK_TITLE_REQUIRED');
    patchRow.title = title;
  }
  if (patch.content !== undefined) patchRow.content = text(patch.content);
  if (patch.categoryCode !== undefined) {
    const categoryCode = code(patch.categoryCode);
    await categoryActive(categoryCode);
    patchRow.category_code = categoryCode;
  }
  if (patch.priority !== undefined) {
    if (!['thuong', 'quan_trong', 'khan_cap'].includes(patch.priority)) fail('priority không hợp lệ.', 400, 'TASK_PRIORITY_INVALID');
    patchRow.priority = patch.priority;
  }
  if (patch.startAt !== undefined) patchRow.start_at = patch.startAt || null;
  if (patch.deadline !== undefined) {
    if (!text(patch.deadline)) fail('Deadline không được rỗng.', 400, 'TASK_DEADLINE_REQUIRED');
    patchRow.deadline = patch.deadline;
  }
  patchRow.updated_at = new Date().toISOString();
  patchRow.row_version = expectedRowVersion + 1;

  const { data, error } = await supabase.from(TASKS_TABLE)
    .update(patchRow)
    .eq('id', taskId).eq('status', 'draft').eq('row_version', expectedRowVersion)
    .select('*').maybeSingle();
  if (error) throwDb(error);
  if (!data) {
    const recheck = await loadTaskRow(taskId);
    if (recheck.status !== 'draft') fail('Chỉ sửa được task đang ở trạng thái draft.', 409, 'TASK_NOT_DRAFT');
    fail('Task đã được cập nhật ở nơi khác. Vui lòng tải lại trước khi thao tác tiếp.', 409, 'TASK_VERSION_CONFLICT');
  }
  return data;
}

// ---------------------------------------------------------------------------
// 3) PUBLISH — atomic qua RPC task_publish (2 statement: update + event).
// ---------------------------------------------------------------------------
async function publishTask(session, taskId, expectedRowVersion) {
  const actorContext = await resolveActorContext(session);
  const current = await loadTaskRow(taskId);
  if (current.created_by_employee_code !== actorContext.employeeCode) {
    const { scope } = await resolveEffectiveTaskScope(session);
    requireTaskCapability({ scope }, 'assign');
  }
  return callRpc('task_publish', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorContext.employeeCode
  });
}

// ---------------------------------------------------------------------------
// 4) READ / DETAIL — canViewTask() TRƯỚC khi trả bất kỳ dữ liệu nào.
// ---------------------------------------------------------------------------
async function getTaskDetail(session, taskId) {
  const task = await loadTaskRow(taskId);
  const assigneeRows = await loadAssignees(taskId);
  await requireView(session, task, assigneeRows);

  ensureDb();
  const [commentsRes, linksRes, eventsRes] = await Promise.all([
    supabase.from(COMMENTS_TABLE).select('*').eq('task_id', taskId).order('created_at', { ascending: true }),
    supabase.from(LINKS_TABLE).select('*').eq('task_id', taskId).order('created_at', { ascending: true }),
    supabase.from(EVENTS_TABLE).select('*').eq('task_id', taskId).order('occurred_at', { ascending: false })
  ]);
  if (commentsRes.error) throwDb(commentsRes.error);
  if (linksRes.error) throwDb(linksRes.error);
  if (eventsRes.error) throwDb(eventsRes.error);

  // "Xóa" link = ghi event payload.action='remove' (KHÔNG hard-delete row,
  // KHÔNG cần cột soft-delete mới — xem lib/task-core.js:removeTaskLink()).
  // Ở đây lọc link đã bị remove ra khỏi danh sách hiển thị hiện hành.
  const removedLinkIds = new Set(
    (eventsRes.data || [])
      .filter(e => e.event_type === 'link' && e.payload && e.payload.action === 'remove' && e.payload.link_id)
      .map(e => e.payload.link_id)
  );
  const activeLinks = (linksRes.data || []).filter(l => !removedLinkIds.has(l.id));

  return {
    task,
    primary: assigneeRows.find(a => a.role === 'primary' && a.is_active) || null,
    related: assigneeRows.filter(a => a.role === 'related' && a.is_active),
    comments: commentsRes.data || [],
    links: activeLinks,
    events: eventsRes.data || []
  };
}

// ---------------------------------------------------------------------------
// 5) PROGRESS UPDATE — atomic qua RPC.
// ---------------------------------------------------------------------------
async function updateTaskProgress(session, taskId, expectedRowVersion, progressPercent, progressStatus) {
  const actorContext = await resolveActorContext(session);
  const assigneeRows = await loadAssignees(taskId);
  const activePrimary = assigneeRows.find(a => a.role === 'primary' && a.is_active);
  if (!activePrimary || activePrimary.employee_code !== actorContext.employeeCode) {
    fail('Chỉ primary hiện hành mới cập nhật tiến độ.', 403, 'TASK_PROGRESS_ACTOR_DENIED');
  }
  return callRpc('task_update_progress', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorContext.employeeCode,
    p_progress_percent: progressPercent, p_progress_status: progressStatus
  });
}

// ---------------------------------------------------------------------------
// 6) COMPLETE — explicit, primary hiện hành, atomic qua RPC.
// ---------------------------------------------------------------------------
async function completeTask(session, taskId, expectedRowVersion, resultText) {
  const actorContext = await resolveActorContext(session);
  const assigneeRows = await loadAssignees(taskId);
  const activePrimary = assigneeRows.find(a => a.role === 'primary' && a.is_active);
  if (!activePrimary || activePrimary.employee_code !== actorContext.employeeCode) {
    fail('Chỉ primary hiện hành mới bấm Hoàn thành.', 403, 'TASK_COMPLETE_ACTOR_DENIED');
  }
  return callRpc('task_complete', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorContext.employeeCode,
    p_result_text: resultText
  });
}

// ---------------------------------------------------------------------------
// 7) REOPEN — creator hoặc capability update, atomic qua RPC.
// ---------------------------------------------------------------------------
async function reopenTask(session, taskId, expectedRowVersion, reason) {
  const actorContext = await resolveActorContext(session);
  const current = await loadTaskRow(taskId);
  if (current.created_by_employee_code !== actorContext.employeeCode) {
    const { scope } = await resolveEffectiveTaskScope(session);
    requireTaskCapability({ scope }, 'update');
  }
  return callRpc('task_reopen', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorContext.employeeCode, p_reason: reason
  });
}

// ---------------------------------------------------------------------------
// 8) CANCEL — creator hoặc capability update, atomic qua RPC.
// ---------------------------------------------------------------------------
async function cancelTask(session, taskId, expectedRowVersion, reason) {
  const actorContext = await resolveActorContext(session);
  const current = await loadTaskRow(taskId);
  if (current.created_by_employee_code !== actorContext.employeeCode) {
    const { scope } = await resolveEffectiveTaskScope(session);
    requireTaskCapability({ scope }, 'update');
  }
  return callRpc('task_cancel', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorContext.employeeCode, p_reason: reason
  });
}

// ---------------------------------------------------------------------------
// 9) DEADLINE CHANGE — creator/capability update, atomic qua RPC.
// ---------------------------------------------------------------------------
async function changeTaskDeadline(session, taskId, expectedRowVersion, newDeadline, reason) {
  const actorContext = await resolveActorContext(session);
  const current = await loadTaskRow(taskId);
  if (current.created_by_employee_code !== actorContext.employeeCode) {
    const { scope } = await resolveEffectiveTaskScope(session);
    requireTaskCapability({ scope }, 'update');
  }
  return callRpc('task_change_deadline', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorContext.employeeCode,
    p_new_deadline: newDeadline, p_reason: reason
  });
}

// ---------------------------------------------------------------------------
// 10) TRANSFER PRIMARY — atomic qua RPC. Scope target verify TRƯỚC ở JS.
// ---------------------------------------------------------------------------
async function transferTaskPrimary(session, taskId, expectedRowVersion, newPrimaryEmployeeCode, reason) {
  const actorContext = await resolveActorContext(session);
  const current = await loadTaskRow(taskId);
  if (current.created_by_employee_code !== actorContext.employeeCode) {
    const { scope } = await resolveEffectiveTaskScope(session);
    requireTaskCapability({ scope }, 'update');
  }
  const allowedTarget = await canAssignTaskTo(session, newPrimaryEmployeeCode);
  if (!allowedTarget) fail('Người phụ trách mới nằm ngoài phạm vi giao việc của bạn.', 403, 'TASK_TRANSFER_TARGET_DENIED');
  return callRpc('task_transfer_primary', {
    p_task_id: taskId, p_expected_row_version: expectedRowVersion, p_actor_employee_code: actorContext.employeeCode,
    p_new_primary_employee_code: code(newPrimaryEmployeeCode), p_reason: reason
  });
}

// ---------------------------------------------------------------------------
// 11) RELATED PEOPLE — 2 call rời (insert/deactivate + event), CHƯA fully
//     atomic (không nằm trong danh sách Critical — xem Output mục F).
// ---------------------------------------------------------------------------
async function addTaskRelated(session, taskId, targetEmployeeCode) {
  ensureDb();
  const actorContext = await resolveActorContext(session);
  const current = await loadTaskRow(taskId);
  if (current.created_by_employee_code !== actorContext.employeeCode) {
    const { scope } = await resolveEffectiveTaskScope(session);
    requireTaskCapability({ scope }, 'update');
  }
  const target = code(targetEmployeeCode);
  const assigneeRows = await loadAssignees(taskId);
  const activePrimary = assigneeRows.find(a => a.role === 'primary' && a.is_active);
  if (activePrimary && activePrimary.employee_code === target) {
    fail('Không thể thêm primary hiện hành làm related.', 400, 'TASK_RELATED_IS_PRIMARY');
  }
  const allowedTarget = await canAssignTaskTo(session, target);
  if (!allowedTarget) fail('Nhân sự này nằm ngoài phạm vi của bạn.', 403, 'TASK_RELATED_TARGET_DENIED');

  const { data, error } = await supabase.from(ASSIGNEES_TABLE).insert({
    task_id: taskId, employee_code: target, role: 'related', assigned_by_employee_code: actorContext.employeeCode
  }).select('*').single();
  if (error) {
    if (String(error.code) === '23505') fail('Nhân sự này đã là related active trên task.', 409, 'TASK_RELATED_DUPLICATE');
    throwDb(error);
  }

  const { error: evError } = await supabase.from(EVENTS_TABLE).insert({
    task_id: taskId, event_type: 'assignment', actor_employee_code: actorContext.employeeCode,
    payload: { action: 'add', role: 'related', employee_code: target }
  });
  if (evError) throwDb(evError);

  return data;
}

async function removeTaskRelated(session, taskId, targetEmployeeCode) {
  ensureDb();
  const actorContext = await resolveActorContext(session);
  const current = await loadTaskRow(taskId);
  if (current.created_by_employee_code !== actorContext.employeeCode) {
    const { scope } = await resolveEffectiveTaskScope(session);
    requireTaskCapability({ scope }, 'update');
  }
  const target = code(targetEmployeeCode);
  const { data, error } = await supabase.from(ASSIGNEES_TABLE)
    .update({ is_active: false, deactivated_at: new Date().toISOString() })
    .eq('task_id', taskId).eq('employee_code', target).eq('role', 'related').eq('is_active', true)
    .select('*').maybeSingle();
  if (error) throwDb(error);
  if (!data) fail('Không tìm thấy related active để gỡ.', 404, 'TASK_RELATED_NOT_FOUND');

  const { error: evError } = await supabase.from(EVENTS_TABLE).insert({
    task_id: taskId, event_type: 'assignment', actor_employee_code: actorContext.employeeCode,
    payload: { action: 'remove', role: 'related', employee_code: target }
  });
  if (evError) throwDb(evError);

  return data;
}

// ---------------------------------------------------------------------------
// 12) COMMENTS — append-only theo convention (V1 không sửa/xóa). task_comments
//     CHƯA có DB trigger append-only (KHÁC task_events) — GAP đã biết, không
//     tự thêm migration ở Batch 2 (xem Output mục F/report riêng).
// ---------------------------------------------------------------------------
async function addTaskComment(session, taskId, body) {
  ensureDb();
  const actorContext = await resolveActorContext(session);
  const task = await loadTaskRow(taskId);
  const assigneeRows = await loadAssignees(taskId);
  await requireView(session, task, assigneeRows);
  const trimmed = text(body);
  if (!trimmed) fail('Nội dung comment không được rỗng.', 400, 'TASK_COMMENT_BODY_REQUIRED');

  const { data, error } = await supabase.from(COMMENTS_TABLE).insert({
    task_id: taskId, author_employee_code: actorContext.employeeCode, body: trimmed
  }).select('*').single();
  if (error) throwDb(error);

  const { error: evError } = await supabase.from(EVENTS_TABLE).insert({
    task_id: taskId, event_type: 'comment', actor_employee_code: actorContext.employeeCode,
    payload: { comment_id: data.id }
  });
  if (evError) throwDb(evError);

  return data;
}

// ---------------------------------------------------------------------------
// 13) LINKS — "xóa" = event payload.action='remove', KHÔNG hard-delete row
//     (giữ đúng "không được làm mất dấu rằng link từng tồn tại" mà KHÔNG cần
//     thêm cột soft-delete/migration mới — xem getTaskDetail() lọc theo event).
// ---------------------------------------------------------------------------
const LINK_SIDES = ['input_reference', 'output_result', 'coordination'];
function isValidUrl(value) {
  try { const u = new URL(text(value)); return u.protocol === 'http:' || u.protocol === 'https:'; } catch (e) { return false; }
}

async function addTaskLink(session, taskId, side, url, label) {
  ensureDb();
  const actorContext = await resolveActorContext(session);
  const task = await loadTaskRow(taskId);
  const assigneeRows = await loadAssignees(taskId);
  await requireView(session, task, assigneeRows);
  if (!LINK_SIDES.includes(side)) fail('side không hợp lệ.', 400, 'TASK_LINK_SIDE_INVALID');
  if (!isValidUrl(url)) fail('URL không hợp lệ.', 400, 'TASK_LINK_URL_INVALID');

  const { data, error } = await supabase.from(LINKS_TABLE).insert({
    task_id: taskId, side, url: text(url), label: label ? text(label) : null, added_by_employee_code: actorContext.employeeCode
  }).select('*').single();
  if (error) throwDb(error);

  const { error: evError } = await supabase.from(EVENTS_TABLE).insert({
    task_id: taskId, event_type: 'link', actor_employee_code: actorContext.employeeCode,
    payload: { action: 'add', link_id: data.id, side, url: data.url }
  });
  if (evError) throwDb(evError);

  return data;
}

async function removeTaskLink(session, taskId, linkId) {
  ensureDb();
  const actorContext = await resolveActorContext(session);
  const task = await loadTaskRow(taskId);
  const assigneeRows = await loadAssignees(taskId);
  await requireView(session, task, assigneeRows);

  const { data: link, error: linkError } = await supabase.from(LINKS_TABLE).select('*').eq('id', linkId).eq('task_id', taskId).maybeSingle();
  if (linkError) throwDb(linkError);
  if (!link) fail('Không tìm thấy link.', 404, 'TASK_LINK_NOT_FOUND');

  const { error: evError } = await supabase.from(EVENTS_TABLE).insert({
    task_id: taskId, event_type: 'link', actor_employee_code: actorContext.employeeCode,
    payload: { action: 'remove', link_id: link.id, side: link.side, url: link.url }
  });
  if (evError) throwDb(evError);

  return { removed: true, link_id: link.id };
}

module.exports = {
  createTaskDraft,
  updateTaskDraft,
  publishTask,
  getTaskDetail,
  updateTaskProgress,
  completeTask,
  reopenTask,
  cancelTask,
  changeTaskDeadline,
  transferTaskPrimary,
  addTaskRelated,
  removeTaskRelated,
  addTaskComment,
  addTaskLink,
  removeTaskLink
};
