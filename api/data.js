'use strict';

const { readData, saveData } = require('../lib/db');
const {
  assertSameOrigin,
  assertJsonContentType,
  assertContentLength,
  validatePayload,
  publicError
} = require('../lib/request-guard');
const { requireSession, authorizePayload } = require('../lib/auth');


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
      const data = await readData({
        role: session.role,
        employeeId: session.role === 'learner' ? session.employeeId : '',
        activityLimit: session.role === 'learner' ? 100 : 200
      });
      const scoped = session.role === 'learner' ? filterDataForRequest(data, 'learner', session.employeeId, session.phone) : data;
      return res.status(200).json(scoped);
    }
    if (req.method === 'POST') {
      assertJsonContentType(req);
      assertContentLength(req);
      const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const session = await requireSession(req, ['learner','manager','admin']);
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
