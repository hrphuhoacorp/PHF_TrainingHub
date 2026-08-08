'use strict';

/* PHF AI Sandbox - TOOL REGISTRY duy nhat cho DeepSeek tool-calling.
   Day la NOI DUY NHAT quyet dinh tool nao model duoc goi. Moi adapter o
   day chi doc (READ-ONLY), tu resolve quyen tu `session` that (khong bao
   gio tin field actor/role/scope do model hoac client gui kem args) va
   deu la lop mong goi LAI engine/permission da co san cua tung module -
   khong tao permission engine moi, khong tu query Supabase/SQL, khong
   nhan table/URL tuy y. Xem TRACE report cho boi canh nguon du lieu +
   quyen tung module.

   THEM TOOL MOI: chi duoc them vao ADAPTERS + AI_TOOLS + (neu can)
   buildStructuredResult() o day. Khong noi nao khac trong lib/ai-sandbox.js
   duoc phep tu thuc thi tool ngoai registry nay. */

const { getChecklistLowestEmployees, getChecklistEmployeeIssues, getChecklistViolationSummary } = require('./ai-checklist-tools');
const { searchEmployees, getEmployeeProfile } = require('./ai-employee-tools');
const { getKnlProfile } = require('./ai-knl-tools');

const AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_checklist_lowest_employees',
      description: 'Lấy danh sách nhân viên có điểm Checklist hiện tại (kỳ hiện hành) thấp nhất, đã được PHF backend tính sẵn đúng công thức Checklist chính thức. Dùng khi được hỏi về điểm Checklist thấp nhất, xếp hạng điểm thấp, hoặc nhân viên có nguy cơ điểm kém.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Số lượng nhân viên cần lấy (điểm thấp nhất trước), mặc định 1.' },
          department: { type: 'string', description: 'Lọc theo phòng ban, để trống nếu không cần lọc.' },
          branch: { type: 'string', description: 'Lọc theo chi nhánh, để trống nếu không cần lọc.' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_checklist_employee_issues',
      description: 'Lấy danh sách lỗi Checklist đang làm giảm điểm của MỘT nhân viên cụ thể trong kỳ hiện tại, kèm tiêu chí, điểm trừ, ngày, có lặp trong ngày hay không. Dùng khi được hỏi một nhân viên bị trừ điểm vì lỗi gì / đang mắc lỗi gì.',
      parameters: {
        type: 'object',
        properties: {
          employeeCode: { type: 'string', description: 'Mã nhân viên, ví dụ PHF079.' }
        },
        required: ['employeeCode']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_checklist_violation_summary',
      description: 'Lấy tổng quan tình trạng xử lý lỗi Checklist trong kỳ hiện tại (số ghi nhận, đã chính thức, đã hủy, đang mở...) và danh sách tiêu chí lỗi lặp nhiều nhất trong kỳ. Dùng khi được hỏi lỗi nào đang lặp nhiều nhất, hoặc tổng quan tình hình Checklist.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_employees',
      description: 'Tìm nhân viên theo tên, mã, phòng ban hoặc chi nhánh. Dùng khi được hỏi tìm một hoặc vài nhân viên theo điều kiện, không biết trước mã chính xác.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Từ khoá tên hoặc mã nhân viên.' },
          department: { type: 'string', description: 'Lọc theo phòng ban.' },
          branch: { type: 'string', description: 'Lọc theo chi nhánh.' },
          limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Số kết quả tối đa, mặc định 5.' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_employee_profile',
      description: 'Lấy hồ sơ nghiệp vụ cơ bản (chức danh, phòng ban, chi nhánh, trạng thái) của MỘT nhân viên theo mã chính xác. Dùng khi được hỏi thông tin/hồ sơ/đang làm ở đâu của một người cụ thể đã biết mã.',
      parameters: {
        type: 'object',
        properties: { employeeCode: { type: 'string', description: 'Mã nhân viên, ví dụ PHF079.' } },
        required: ['employeeCode']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_knl_profile',
      description: 'Lấy hồ sơ Khung năng lực (KNL) cơ bản của MỘT nhân viên theo mã. Hiện chỉ có thông tin tổ chức cơ bản (chức danh, phòng ban, chi nhánh) - CHƯA có dữ liệu đánh giá năng lực hay điểm gap, không được suy đoán các số liệu đó.',
      parameters: {
        type: 'object',
        properties: { employeeCode: { type: 'string', description: 'Mã nhân viên, ví dụ PHF079.' } },
        required: ['employeeCode']
      }
    }
  }
];

const ADAPTERS = {
  get_checklist_lowest_employees: getChecklistLowestEmployees,
  get_checklist_employee_issues: getChecklistEmployeeIssues,
  get_checklist_violation_summary: getChecklistViolationSummary,
  search_employees: searchEmployees,
  get_employee_profile: getEmployeeProfile,
  get_knl_profile: getKnlProfile
};

const ALLOWED_TOOL_NAMES = new Set(Object.keys(ADAPTERS));

// Chi thuc thi dung tool da whitelist trong ADAPTERS. Bat ky ten tool nao
// khac (model tu bia, hoac co gang goi write action nhu update_employee/
// run_sql/read_salary...) deu bi tu choi ngay o day, KHONG bao gio cham
// toi Supabase hay bat ky nguon ghi/doc nao khac.
async function executeToolCall(session, call) {
  const name = String(call?.function?.name || '');
  let args = {};
  try { args = JSON.parse(call?.function?.arguments || '{}'); } catch (e) { args = {}; }

  const adapter = ALLOWED_TOOL_NAMES.has(name) ? ADAPTERS[name] : null;
  if (!adapter) return { error: 'TOOL_NOT_ALLOWED' };

  try {
    return await adapter(session, args);
  } catch (error) {
    console.error('[PHF AI Sandbox] tool error:', name, error && (error.code || error.message));
    return { error: 'TOOL_UNAVAILABLE' };
  }
}

function round2(value) { return Math.round((Number(value) || 0) * 100) / 100; }

/* EVIDENCE STATUS GATE - metadata bang chung do BACKEND tao, gan vao MOI
   structured result truoc khi dua cho DeepSeek/UI. Xem PATCH "Evidence
   Status / Fact Gate":
   - VERIFIED: tool lay du lieu thanh cong tu source of truth, permission
     pass, ket qua (ke ca rong) la mot su that da xac nhan TRONG PHAM VI
     da neu o `note`/`source`. Khong bao gio suy ra "toan bo nhan vien PHF"
     tu nguon chi bao phu checklist_employee_assignments - note luon phai
     noi ro pham vi de model/UI khong overclaim.
   - INCOMPLETE: thieu input (vd khong co employeeCode), khong tim thay
     trong nguon, hoac khong du quyen/du lieu de tra loi day du.
   - CONFLICTED: dat cho tuong lai khi co 2 nguon doc lap lech nhau cho
     cung 1 field - CHUA co tool nao trong batch nay tao ra trang thai
     nay that (khong co 2 nguon doc lap de doi chieu), duoc test bang mock
     o test suite de dam bao contract/UI san sang khi co tool sinh ra no. */
function buildEvidence(status, source, asOf, note) {
  return {
    status: status,
    source: Array.isArray(source) ? source : [],
    asOf: asOf || new Date().toISOString(),
    note: note || ''
  };
}

const SCOPE_NOTE_CHECKLIST_ONLY = 'Phạm vi: nhân sự đang được phân công theo dõi Checklist (checklist_employee_assignments). Số liệu này KHÔNG đại diện cho toàn bộ nhân viên PHF - có thể còn nhân viên chưa được phân Checklist.';

/* Chuyen tool result (da permission-scoped/whitelist san tu adapter) thanh
   structured response contract cho UI (result.type/data/evidence). KHONG
   doc lai tu Supabase o day - chi reshape du lieu adapter da tra. Neu tool
   loi -> tra null, frontend chi hien text (khong card rong, khong evidence
   gia). */
function buildStructuredResult(toolName, result) {
  if (!result || result.error) return null;
  const nowIso = new Date().toISOString();

  if (toolName === 'get_checklist_lowest_employees') {
    const employees = Array.isArray(result.employees) ? result.employees : [];
    if (!employees.length) return null;
    return {
      type: 'ranking',
      title: `${employees.length} nhân viên có điểm Checklist thấp nhất`,
      scope: result.scope || '',
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['checklist_employee_assignments', 'checklist_violation_records'], result.asOf || nowIso, SCOPE_NOTE_CHECKLIST_ONLY),
      data: {
        columns: [
          { key: 'rank', label: '#', align: 'left' },
          { key: 'employeeName', label: 'Nhân viên', align: 'left' },
          { key: 'employeeCode', label: 'Mã NV', align: 'left' },
          { key: 'department', label: 'Bộ phận', align: 'left' },
          { key: 'branch', label: 'Chi nhánh', align: 'left' },
          { key: 'checklistScore', label: 'Điểm', align: 'right' }
        ],
        rows: employees.map((e, i) => ({
          rank: i + 1,
          employeeCode: e.employeeCode || '',
          employeeName: e.employeeName || '',
          department: e.department || '',
          branch: e.branch || '',
          checklistScore: round2(e.checklistScore)
        }))
      }
    };
  }

  if (toolName === 'get_checklist_employee_issues') {
    if (!result.employeeCode) return null; // thieu input - khong du du lieu de dung mot card co y nghia
    const issues = Array.isArray(result.issues) ? result.issues : [];
    return {
      type: 'alert_list',
      title: `Lỗi Checklist của ${result.employeeCode || ''}${result.month ? ' (kỳ ' + result.month + ')' : ''}`,
      scope: result.employeeCode || '',
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['checklist_violation_records'], result.asOf || nowIso, 'Chỉ tính lỗi đã chính thức (record_status=official, không tính nháp/đã hủy/thử nghiệm) trong kỳ hiện tại.'),
      data: {
        summary: `Tổng ${result.issueCount || 0} lỗi · trừ ${round2(result.totalPointsDeducted)} điểm`,
        items: issues.map(issue => ({
          title: issue.criterionName || issue.criterionCode || 'Lỗi',
          detail: `-${round2(issue.points)} điểm · ${issue.occurredDate}` + (issue.repeatSameDayCount > 1 ? ` · lặp ${issue.repeatSameDayCount} lần trong ngày` : ''),
          meta: issue.group || ''
        }))
      }
    };
  }

  if (toolName === 'get_checklist_violation_summary') {
    const hasTotals = !!result.totals;
    const totals = result.totals || {};
    const topRepeatedCriteria = Array.isArray(result.topRepeatedCriteria) ? result.topRepeatedCriteria : [];
    return {
      type: 'summary',
      title: `Tổng quan xử lý lỗi Checklist${result.month ? ' kỳ ' + result.month : ''}`,
      scope: 'checklist',
      asOf: result.asOf || nowIso,
      evidence: hasTotals
        ? buildEvidence('VERIFIED', ['checklist_violation_records', 'checklist_violation_tasks'], result.asOf || nowIso, 'Phạm vi: kỳ hiện tại, theo đúng quyền xem của tài khoản.')
        : buildEvidence('INCOMPLETE', [], result.asOf || nowIso, 'Tài khoản chưa đủ quyền xem hoặc chưa có dữ liệu vi phạm trong kỳ này.'),
      data: {
        metrics: [
          { label: 'Tổng ghi nhận', value: totals.total ?? '—' },
          { label: 'Đã chính thức', value: totals.official ?? '—' },
          { label: 'Đã hủy', value: totals.cancelled ?? '—' },
          { label: 'Đang mở', value: totals.open ?? '—' }
        ],
        sections: topRepeatedCriteria.length ? [{
          label: 'Tiêu chí lặp nhiều nhất',
          items: topRepeatedCriteria.map(c => ({
            label: c.criterionName || c.criterionCode || '',
            value: `${c.occurrenceCount} lần · -${round2(c.totalPoints)}đ`
          }))
        }] : []
      }
    };
  }

  if (toolName === 'search_employees') {
    const employees = Array.isArray(result.employees) ? result.employees : [];
    if (!employees.length) return null;
    return {
      type: 'ranking',
      title: `Kết quả tìm nhân viên (${result.total || employees.length})`,
      scope: '',
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['checklist_employee_assignments'], result.asOf || nowIso, SCOPE_NOTE_CHECKLIST_ONLY),
      data: {
        columns: [
          { key: 'employeeName', label: 'Nhân viên', align: 'left' },
          { key: 'employeeCode', label: 'Mã NV', align: 'left' },
          { key: 'title', label: 'Chức danh', align: 'left' },
          { key: 'department', label: 'Bộ phận', align: 'left' },
          { key: 'branch', label: 'Chi nhánh', align: 'left' }
        ],
        rows: employees.map(e => ({
          employeeCode: e.employeeCode || '',
          employeeName: e.employeeName || '',
          title: e.title || '',
          department: e.department || '',
          branch: e.branch || ''
        }))
      }
    };
  }

  if (toolName === 'get_employee_profile' || toolName === 'get_knl_profile') {
    const isKnl = toolName === 'get_knl_profile';
    if (!result.employeeCode) return null; // thieu input

    if (!result.found || !result.profile) {
      return {
        type: 'employee_profile',
        title: `Không tìm thấy ${result.employeeCode}`,
        scope: result.employeeCode || '',
        asOf: result.asOf || nowIso,
        evidence: buildEvidence('INCOMPLETE', ['checklist_employee_assignments'], result.asOf || nowIso, `Không tìm thấy mã ${result.employeeCode} trong phạm vi nhân sự Checklist hiện tại - có thể do nhân viên chưa được phân Checklist, đã nghỉ việc, hoặc mã không đúng.`),
        data: { employeeCode: result.employeeCode || '', employeeName: '', fields: [] }
      };
    }

    const p = result.profile;
    const note = isKnl
      ? 'Chỉ có thông tin tổ chức cơ bản (chức danh/phòng ban/chi nhánh). CHƯA có dữ liệu đánh giá năng lực hay điểm gap (KNL Step 2 chưa triển khai).'
      : SCOPE_NOTE_CHECKLIST_ONLY;
    return {
      type: 'employee_profile',
      title: p.employeeName || result.employeeCode || '',
      scope: result.employeeCode || '',
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['checklist_employee_assignments'], result.asOf || nowIso, note),
      data: {
        employeeCode: result.employeeCode || '',
        employeeName: p.employeeName || '',
        fields: [
          { label: 'Chức danh', value: p.title || '—' },
          { label: 'Bộ phận', value: p.department || '—' },
          { label: 'Chi nhánh', value: p.branch || '—' },
          { label: 'Trạng thái', value: p.employeeStatus || p.status || '—' }
        ]
      }
    };
  }

  return null;
}

module.exports = { AI_TOOLS, ALLOWED_TOOL_NAMES, executeToolCall, buildStructuredResult, buildEvidence };
