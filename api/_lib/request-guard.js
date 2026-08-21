'use strict';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_STRING = 10000;
const MAX_ARRAY = 5000;
const MAX_OBJECT_KEYS = 300;

class RequestError extends Error {
  constructor(message, statusCode = 400, code = 'BAD_REQUEST') {
    super(message);
    this.name = 'RequestError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/\.$/, '');
}

function assertSameOrigin(req) {
  const origin = String(req.headers?.origin || '').trim();
  if (!origin) return;
  let parsed;
  try { parsed = new URL(origin); }
  catch { throw new RequestError('Nguồn yêu cầu không hợp lệ.', 403, 'ORIGIN_INVALID'); }
  const requestHost = normalizeHost(req.headers?.['x-forwarded-host'] || req.headers?.host);
  if (requestHost && normalizeHost(parsed.host) !== requestHost) {
    throw new RequestError('Yêu cầu từ nguồn khác không được chấp nhận.', 403, 'ORIGIN_DENIED');
  }
}

function assertJsonContentType(req) {
  const type = String(req.headers?.['content-type'] || '').toLowerCase();
  if (!type.startsWith('application/json')) {
    throw new RequestError('Dữ liệu gửi lên phải ở định dạng JSON.', 415, 'CONTENT_TYPE');
  }
}

function assertContentLength(req) {
  const raw = req.headers?.['content-length'];
  if (!raw) return;
  const length = Number(raw);
  if (!Number.isFinite(length) || length < 0) {
    throw new RequestError('Kích thước dữ liệu không hợp lệ.', 400, 'CONTENT_LENGTH');
  }
  if (length > MAX_BODY_BYTES) {
    throw new RequestError('Dữ liệu gửi lên vượt quá giới hạn cho phép.', 413, 'PAYLOAD_TOO_LARGE');
  }
}

function validateDepth(value, path = 'payload', depth = 0, seen = new WeakSet()) {
  if (depth > 12) throw new RequestError(`Dữ liệu tại ${path} lồng quá sâu.`, 400, 'PAYLOAD_DEPTH');
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (value.length > MAX_STRING) throw new RequestError(`Nội dung tại ${path} quá dài.`, 400, 'STRING_TOO_LONG');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RequestError(`Giá trị số tại ${path} không hợp lệ.`, 400, 'NUMBER_INVALID');
    return;
  }
  if (typeof value === 'boolean') return;
  if (typeof value !== 'object') throw new RequestError(`Kiểu dữ liệu tại ${path} không hợp lệ.`, 400, 'TYPE_INVALID');
  if (seen.has(value)) throw new RequestError('Dữ liệu có tham chiếu vòng.', 400, 'CYCLIC_DATA');
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) throw new RequestError(`Danh sách tại ${path} vượt quá giới hạn.`, 400, 'ARRAY_TOO_LARGE');
    value.forEach((item, index) => validateDepth(item, `${path}[${index}]`, depth + 1, seen));
  } else {
    const keys = Object.keys(value);
    if (keys.length > MAX_OBJECT_KEYS) throw new RequestError(`Đối tượng tại ${path} có quá nhiều trường.`, 400, 'OBJECT_TOO_LARGE');
    keys.forEach(key => validateDepth(value[key], `${path}.${key}`, depth + 1, seen));
  }
  seen.delete(value);
}

function cleanEmployeeId(value) {
  return String(value || '').trim();
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RequestError('Dữ liệu gửi lên không hợp lệ.', 400, 'PAYLOAD_INVALID');
  }
  validateDepth(payload);


  if (payload.action === 'saveProbation') {
    if (!payload.adminMode && !payload.managerMode) {
      throw new RequestError('Chỉ Quản lý hoặc Admin được cập nhật thử việc.', 403, 'MANAGER_REQUIRED');
    }
    const record = payload.probationRecord;
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new RequestError('Thiếu dữ liệu thử việc.', 400, 'PROBATION_REQUIRED');
    }
    if (!cleanEmployeeId(record.employeeId || payload?.employee?.id)) {
      throw new RequestError('Không xác định được nhân viên thử việc.', 400, 'EMPLOYEE_ID_REQUIRED');
    }
    return payload;
  }

  if (['markNotificationRead','markAllNotificationsRead','resolveNotification'].includes(payload.action)) {
    return payload;
  }

  if (payload.action === 'deleteEmployee') {
    if (!payload.adminMode) {
      throw new RequestError('Chỉ Admin được xóa học viên.', 403, 'ADMIN_REQUIRED');
    }
    const deleteEmployee = payload.employee;
    if (!deleteEmployee || typeof deleteEmployee !== 'object' || Array.isArray(deleteEmployee)) {
      throw new RequestError('Thiếu thông tin học viên cần xóa.', 400, 'EMPLOYEE_REQUIRED');
    }
    const deleteEmployeeId = cleanEmployeeId(deleteEmployee.id);
    if (!deleteEmployeeId) {
      throw new RequestError('Không xác định được học viên cần xóa.', 400, 'EMPLOYEE_ID_REQUIRED');
    }
    if (deleteEmployeeId.length > 160 || /[\u0000-\u001f]/.test(deleteEmployeeId)) {
      throw new RequestError('Mã học viên không hợp lệ.', 400, 'EMPLOYEE_ID_INVALID');
    }
    return payload;
  }

  const employee = payload.employee;
  if (!employee || typeof employee !== 'object' || Array.isArray(employee)) {
    throw new RequestError('Thiếu thông tin học viên cần lưu.', 400, 'EMPLOYEE_REQUIRED');
  }
  const employeeId = cleanEmployeeId(employee.id);
  if (!employeeId) {
    throw new RequestError('Không xác định được mã học viên. Hệ thống chưa ghi dữ liệu.', 400, 'EMPLOYEE_ID_REQUIRED');
  }
  if (employeeId.length > 160 || /[\u0000-\u001f]/.test(employeeId)) {
    throw new RequestError('Mã học viên không hợp lệ.', 400, 'EMPLOYEE_ID_INVALID');
  }
  if (payload.currentPage != null && String(payload.currentPage).length > 10000) {
    throw new RequestError('Thông tin màn hiện tại quá dài.', 400, 'CURRENT_PAGE_TOO_LONG');
  }
  if (payload.unlockedSteps != null && !Array.isArray(payload.unlockedSteps)) {
    throw new RequestError('Danh sách bước đã mở không hợp lệ.', 400, 'UNLOCKED_STEPS_INVALID');
  }
  if (payload.completedPages != null && !Array.isArray(payload.completedPages)) {
    throw new RequestError('Danh sách nội dung hoàn thành không hợp lệ.', 400, 'COMPLETED_PAGES_INVALID');
  }
  return payload;
}

function publicError(err) {
  const status = Number(err?.statusCode) || 500;
  if (status >= 400 && status < 500) {
    /* err.details la truong PHU, tuy chon (vi du normalizeCanonical() trong
       lib/checklist-violations.js gan {index, requestId} de client biet CHINH
       XAC dong nao trong batch lam that bai) - chi dua vao body khi thuc su co
       de KHONG doi hanh vi/shape cho moi loi khac trong toan bo app chua tung
       gan .details (spread rong khi err.details falsy khong them key nao, JSON
       cung se tu drop field undefined). */
    return { status, body: { ok: false, error: err.message || 'Yêu cầu không hợp lệ.', code: err.code || 'BAD_REQUEST', ...(err.details ? { details: err.details } : {}) } };
  }
  return { status: 500, body: { ok: false, error: 'Hệ thống chưa thể xử lý yêu cầu. Vui lòng thử lại.', code: 'INTERNAL_ERROR' } };
}

module.exports = {
  MAX_BODY_BYTES,
  RequestError,
  assertSameOrigin,
  assertJsonContentType,
  assertContentLength,
  validatePayload,
  publicError
};
