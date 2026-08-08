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

const {
  getChecklistLowestEmployees, getChecklistEmployeeIssues, getChecklistViolationSummary,
  getMyChecklistMonthlyForm, getMyChecklistTasks, getMyChecklistNotifications
} = require('./ai-checklist-tools');
const { searchEmployees, getEmployeeProfile } = require('./ai-employee-tools');
const { getKnlProfile, searchKnlPeople } = require('./ai-knl-tools');
const { getTrainingProgramOverview, getMyTrainingProgress, getEmployeeTrainingProgress } = require('./ai-training-tools');
const { searchClassroomClasses, getClassroomClassLearning } = require('./ai-classroom-tools');

/* DIEU HUONG THONG MINH - whitelist route-key duy nhat cho phep AI de xuat
   nut dieu huong. Day KHONG phai URL that - chi la 1 khoa duoc phep, front-
   end (assets/js/ai/phf-ai-engine.js, bang NAV_MODULE_SEGMENT tuong ung)
   se tu resolve khoa nay sang path that theo role cua tung nguoi dung ROI
   doi chieu lai voi window.PHF_ROUTE_REGISTRY that (assets/js/phf-url-
   router.js) truoc khi cho phep bam - model KHONG BAO GIO duoc tu sinh
   URL. Doi 5 khoa nay thi phai doi dong bo ca 2 phia (backend + frontend). */
const NAV_TARGETS = {
  hub_home: { label: 'Về trang chủ PHF HR' },
  training_hub: { label: 'Đi tới Training Hub' },
  classroom: { label: 'Mở Classroom' },
  checklist: { label: 'Đi tới Checklist' },
  knl: { label: 'Đi tới Khung năng lực' }
};

async function navigateTo(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const target = String(input.target || '').trim();
  if (!NAV_TARGETS[target]) return { ok: false, target: '' };
  return { ok: true, target, label: NAV_TARGETS[target].label };
}

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
  },
  {
    type: 'function',
    function: {
      name: 'search_knl_people',
      description: 'Tìm nhiều nhân sự trong phạm vi Khung năng lực theo tên, mã, phòng ban hoặc chi nhánh. Dùng khi được hỏi danh sách nhiều người trong Khung năng lực, không phải một mã cụ thể.',
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
      name: 'get_training_program_overview',
      description: 'Lấy tổng quan chương trình đào tạo hội nhập Training Hub: tổng số bài học và số bài theo từng giai đoạn. Dùng khi được hỏi nhân viên mới phải học tổng bao nhiêu bài, chương trình hội nhập gồm những gì/mấy giai đoạn.',
      parameters: {
        type: 'object',
        properties: { programId: { type: 'string', description: 'Mã chương trình, mặc định new_sales (nhân viên bán hàng) - để trống nếu không rõ.' } },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_my_training_progress',
      description: 'Lấy tiến độ học Training Hub của CHÍNH tài khoản đang hỏi (trang hiện tại, số bài đã hoàn thành, bước đã mở khoá, kết quả kiểm tra gần đây). Dùng khi người dùng hỏi "tôi học tới đâu rồi", "tôi còn bao nhiêu bài chưa học".',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_employee_training_progress',
      description: 'Lấy tiến độ học Training Hub của MỘT nhân viên khác theo mã, trong phạm vi quyền xem báo cáo của tài khoản đang hỏi. Dùng khi được hỏi một người cụ thể (không phải chính mình) đã học tới đâu.',
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
      name: 'search_classroom_classes',
      description: 'Tìm lớp Classroom theo tên hoặc mã lớp. Dùng khi được hỏi có lớp đào tạo nào, tìm một lớp cụ thể, hoặc làm bước đầu trước khi xem tiến độ học của lớp đó.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Từ khoá tên hoặc mã lớp.' },
          limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Số kết quả tối đa, mặc định 5.' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_classroom_class_learning',
      description: 'Lấy tiến độ học của MỘT lớp Classroom cụ thể theo classId (lấy từ kết quả search_classroom_classes trước đó). Nếu người hỏi là học viên, trả tiến độ của chính họ trong lớp; nếu là quản lý, trả tổng hợp tiến độ mọi học viên trong lớp.',
      parameters: {
        type: 'object',
        properties: { classId: { type: 'string', description: 'Mã lớp Classroom, lấy từ kết quả search_classroom_classes.' } },
        required: ['classId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_my_checklist_monthly_form',
      description: 'Lấy phiếu tự đánh giá Checklist tháng hiện tại của CHÍNH tài khoản đang hỏi (điểm Checklist tự động, điểm tự đánh giá, trạng thái phiếu). Dùng khi được hỏi "điểm Checklist tháng này của tôi bao nhiêu", "phiếu đánh giá tháng của tôi thế nào".',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_my_checklist_tasks',
      description: 'Lấy danh sách việc Checklist đang chờ CHÍNH tài khoản đang hỏi xử lý (xác nhận lỗi, giải trình, phản hồi...). Dùng khi được hỏi "tôi còn việc nào cần xử lý trong Checklist".',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_my_checklist_notifications',
      description: 'Lấy thông báo Checklist gửi riêng cho CHÍNH tài khoản đang hỏi. Dùng khi được hỏi có thông báo Checklist nào mới không.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'navigate_to',
      description: 'Đề xuất một nút điều hướng tới đúng khu vực trong PHF HR khi người dùng muốn vào một chức năng, hoặc khi kết quả vừa trả lời có màn hình tương ứng để xem chi tiết đầy đủ hơn. CHỈ được chọn đúng 1 giá trị trong enum cho phép - không tự nghĩ ra URL hay tên khu vực khác.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', enum: Object.keys(NAV_TARGETS), description: 'Khu vực cần điều hướng tới: hub_home (trang chủ PHF HR), training_hub, classroom, checklist, knl (Khung năng lực).' }
        },
        required: ['target']
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
  get_knl_profile: getKnlProfile,
  search_knl_people: searchKnlPeople,
  get_training_program_overview: getTrainingProgramOverview,
  get_my_training_progress: getMyTrainingProgress,
  get_employee_training_progress: getEmployeeTrainingProgress,
  search_classroom_classes: searchClassroomClasses,
  get_classroom_class_learning: getClassroomClassLearning,
  get_my_checklist_monthly_form: getMyChecklistMonthlyForm,
  get_my_checklist_tasks: getMyChecklistTasks,
  get_my_checklist_notifications: getMyChecklistNotifications,
  navigate_to: navigateTo
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
          { key: 'employeeCode', label: 'Mã nhân viên', align: 'left' },
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
          { key: 'employeeCode', label: 'Mã nhân viên', align: 'left' },
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
      ? 'Chỉ có thông tin tổ chức cơ bản (chức danh/phòng ban/chi nhánh). CHƯA có dữ liệu đánh giá năng lực hay điểm gap (phần đánh giá chi tiết của Khung năng lực chưa triển khai).'
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

  if (toolName === 'search_knl_people') {
    const people = Array.isArray(result.people) ? result.people : [];
    if (!people.length) return null;
    return {
      type: 'ranking',
      title: `Kết quả tìm nhân sự Khung năng lực (${result.total || people.length})`,
      scope: '',
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['checklist_employee_assignments'], result.asOf || nowIso, SCOPE_NOTE_CHECKLIST_ONLY),
      data: {
        columns: [
          { key: 'employeeName', label: 'Nhân viên', align: 'left' },
          { key: 'employeeCode', label: 'Mã nhân viên', align: 'left' },
          { key: 'title', label: 'Chức danh', align: 'left' },
          { key: 'department', label: 'Bộ phận', align: 'left' },
          { key: 'branch', label: 'Chi nhánh', align: 'left' }
        ],
        rows: people.map(p => ({
          employeeCode: p.employeeCode || '',
          employeeName: p.employeeName || '',
          title: p.title || '',
          department: p.department || '',
          branch: p.branch || ''
        }))
      }
    };
  }

  if (toolName === 'get_training_program_overview') {
    if (!result.available) {
      return {
        type: 'summary',
        title: `Chương trình đào tạo ${result.programLabel || result.programId || ''}`,
        scope: result.programId || '',
        asOf: result.asOf || nowIso,
        evidence: buildEvidence('INCOMPLETE', [], result.asOf || nowIso, 'Chưa có nội dung chương trình chi tiết cho chương trình này trong Training Hub.'),
        data: { metrics: [], sections: [] }
      };
    }
    const stages = Array.isArray(result.stages) ? result.stages : [];
    return {
      type: 'summary',
      title: `Chương trình đào tạo ${result.programLabel || result.programId || ''}`,
      scope: result.programId || '',
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['phf-lessons-new-sales'], result.asOf || nowIso, 'Nguồn: nội dung chương trình học hiện đang hiển thị thật trong Training Hub, không phải số liệu ước tính.'),
      data: {
        metrics: [{ label: 'Tổng số bài học', value: result.totalLessons || 0 }],
        sections: stages.length ? [{
          label: 'Số bài theo giai đoạn',
          items: stages.map(s => ({ label: s.badge || `Giai đoạn ${s.stage + 1}`, value: `${s.lessonCount} bài` }))
        }] : []
      }
    };
  }

  if (toolName === 'get_my_training_progress' || toolName === 'get_employee_training_progress') {
    const isSelf = toolName === 'get_my_training_progress';
    if (!result.found) {
      return {
        type: 'employee_profile',
        title: isSelf ? 'Tiến độ Training Hub của bạn' : `Không tìm thấy ${result.employeeCode || ''}`,
        scope: result.employeeCode || '',
        asOf: result.asOf || nowIso,
        evidence: buildEvidence('INCOMPLETE', ['employees', 'progress'], result.asOf || nowIso, isSelf
          ? 'Tài khoản chưa liên kết hồ sơ Training Hub hoặc chưa có dữ liệu tiến độ.'
          : `Không tìm thấy ${result.employeeCode} trong phạm vi được phép xem, hoặc người này chưa có hồ sơ Training Hub.`),
        data: { employeeCode: result.employeeCode || '', employeeName: '', fields: [] }
      };
    }
    const progress = result.progress || {};
    const tests = Array.isArray(result.testResults) ? result.testResults : [];
    const lastTest = tests[0];
    return {
      type: 'employee_profile',
      title: result.fullName || result.employeeCode || 'Tiến độ Training Hub',
      scope: result.employeeCode || '',
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['employees', 'progress', 'test_results'], result.asOf || nowIso, 'Tiến độ đọc trực tiếp từ Training Hub - trang hiện tại và bước mở khoá do hệ thống tự ghi nhận theo hoạt động học thật.'),
      data: {
        employeeCode: result.employeeCode || '',
        employeeName: result.fullName || '',
        fields: [
          { label: 'Chương trình', value: result.programLabel || result.programId || '—' },
          { label: 'Trang hiện tại', value: progress.currentPage || '—' },
          { label: 'Số bài đã hoàn thành', value: progress.completedPagesCount ?? '—' },
          { label: 'Kết quả kiểm tra gần nhất', value: lastTest ? `${lastTest.status === 'passed' ? 'Đạt' : 'Chưa đạt'} · ${lastTest.score ?? '—'}/${lastTest.passScore ?? '—'}` : '—' }
        ]
      }
    };
  }

  if (toolName === 'search_classroom_classes') {
    const classes = Array.isArray(result.classes) ? result.classes : [];
    if (!classes.length) return null;
    return {
      type: 'ranking',
      title: `Kết quả tìm lớp Classroom (${result.total || classes.length})`,
      scope: '',
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['classroom_classes'], result.asOf || nowIso, 'Danh sách lớp trong phạm vi tài khoản được phép xem (học viên chỉ thấy lớp mình ghi danh).'),
      data: {
        columns: [
          { key: 'className', label: 'Lớp', align: 'left' },
          { key: 'classCode', label: 'Mã lớp', align: 'left' },
          { key: 'status', label: 'Trạng thái', align: 'left' },
          { key: 'enrolledCount', label: 'Học viên', align: 'right' }
        ],
        rows: classes.map(c => ({
          classId: c.classId,
          className: c.className || '',
          classCode: c.classCode || '',
          status: c.status || '',
          enrolledCount: c.enrolledCount || 0
        }))
      }
    };
  }

  if (toolName === 'get_classroom_class_learning') {
    if (!result.found) {
      return {
        type: 'employee_profile',
        title: 'Không tìm thấy lớp',
        scope: result.classId || '',
        asOf: result.asOf || nowIso,
        evidence: buildEvidence('INCOMPLETE', ['classroom_classes'], result.asOf || nowIso, 'Không tìm thấy lớp hoặc tài khoản không có quyền xem lớp này.'),
        data: { employeeCode: '', employeeName: '', fields: [] }
      };
    }
    if (result.mode === 'roster') {
      const rows = Array.isArray(result.learnerSummaries) ? result.learnerSummaries : [];
      if (!rows.length) return null;
      return {
        type: 'ranking',
        title: `Tiến độ học viên lớp ${result.className || ''}`,
        scope: result.classId || '',
        asOf: result.asOf || nowIso,
        evidence: buildEvidence('VERIFIED', ['classroom_lessons', 'classroom_lesson_progress'], result.asOf || nowIso, 'Phạm vi: toàn bộ học viên trong lớp, theo đúng quyền quản lý Classroom hiện tại.'),
        data: {
          columns: [
            { key: 'employeeName', label: 'Học viên', align: 'left' },
            { key: 'status', label: 'Trạng thái', align: 'left' },
            { key: 'percent', label: 'Hoàn thành', align: 'right' }
          ],
          rows: rows.map(r => ({
            employeeName: r.employeeName || r.employeeId || '',
            status: r.status || '',
            percent: `${r.percent ?? 0}%`
          }))
        }
      };
    }
    const summary = result.summary || {};
    return {
      type: 'summary',
      title: `Tiến độ của bạn trong lớp ${result.className || ''}`,
      scope: result.classId || '',
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['classroom_lessons', 'classroom_lesson_progress'], result.asOf || nowIso, 'Tiến độ của chính tài khoản đang hỏi trong lớp này.'),
      data: {
        metrics: [
          { label: 'Hoàn thành', value: `${summary.percent ?? 0}%` },
          { label: 'Bài bắt buộc đã xong', value: `${summary.completedRequired ?? 0}/${summary.requiredLessons ?? 0}` }
        ],
        sections: []
      }
    };
  }

  if (toolName === 'get_my_checklist_monthly_form') {
    if (!result.found) {
      return {
        type: 'summary',
        title: 'Phiếu Checklist tháng này của bạn',
        scope: '',
        asOf: result.asOf || nowIso,
        evidence: buildEvidence('INCOMPLETE', ['checklist_monthly_forms'], result.asOf || nowIso, 'Chưa có phiếu tự đánh giá tháng nào đang mở/đã ghi nhận cho tài khoản này.'),
        data: { metrics: [], sections: [] }
      };
    }
    return {
      type: 'summary',
      title: `Phiếu Checklist kỳ ${result.periodMonth || ''} của bạn`,
      scope: result.periodMonth || '',
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['checklist_monthly_forms'], result.asOf || nowIso, 'Dữ liệu phiếu tự đánh giá tháng của chính tài khoản đang hỏi.'),
      data: {
        metrics: [
          { label: 'Điểm Checklist', value: result.checklistScore ?? '—' },
          { label: 'Điểm tự đánh giá', value: result.selfTotalScore ?? '—' },
          { label: 'Điểm thẩm định', value: result.reviewTotalScore ?? '—' },
          { label: 'Điểm chốt', value: result.finalScore ?? '—' }
        ],
        sections: [{ label: 'Trạng thái phiếu', items: [{ label: 'Trạng thái', value: result.status || '—' }] }]
      }
    };
  }

  if (toolName === 'get_my_checklist_tasks') {
    const tasks = Array.isArray(result.tasks) ? result.tasks : [];
    const summary = result.summary || {};
    return {
      type: 'alert_list',
      title: 'Việc Checklist cần bạn xử lý',
      scope: '',
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['checklist_violation_tasks'], result.asOf || nowIso, 'Danh sách việc đang chờ chính tài khoản đang hỏi xử lý.'),
      data: {
        summary: `Tổng ${summary.mine ?? tasks.length} việc`,
        items: tasks.map(t => ({
          title: t.criterionName || 'Việc Checklist',
          detail: `${t.status || ''}${t.dueAt ? ' · hạn ' + t.dueAt : ''}`,
          meta: t.priority || ''
        }))
      }
    };
  }

  if (toolName === 'get_my_checklist_notifications') {
    const notifications = Array.isArray(result.notifications) ? result.notifications : [];
    return {
      type: 'alert_list',
      title: 'Thông báo Checklist của bạn',
      scope: '',
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['checklist_notifications'], result.asOf || nowIso, `Chưa đọc: ${result.unreadCount || 0}.`),
      data: {
        summary: `${result.unreadCount || 0} thông báo chưa đọc`,
        items: notifications.map(n => ({
          title: n.title || 'Thông báo',
          detail: n.createdAt || '',
          meta: n.readAt ? 'Đã đọc' : 'Chưa đọc'
        }))
      }
    };
  }

  return null;
}

/* Tach rieng khoi buildStructuredResult() vi navigate_to KHONG phai du
   lieu nghiep vu (khong co evidence/type card) - chi la 1 de xuat dieu
   huong. Frontend van phai tu doi chieu target voi PHF_ROUTE_REGISTRY
   that truoc khi cho bam (xem NAV_TARGETS o tren) - o day chi dam bao
   target nam trong whitelist da khai bao, KHONG biet gi ve path/quyen
   route thuc te (thuoc frontend). */
function buildAction(toolName, result) {
  if (toolName !== 'navigate_to') return null;
  if (!result || !result.ok || !NAV_TARGETS[result.target]) return null;
  return { type: 'navigate', target: result.target, label: result.label || NAV_TARGETS[result.target].label };
}

module.exports = { AI_TOOLS, ALLOWED_TOOL_NAMES, executeToolCall, buildStructuredResult, buildAction, buildEvidence };
