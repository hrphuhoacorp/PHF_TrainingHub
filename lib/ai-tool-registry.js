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
const {
  searchEmployees, getEmployeeProfile, getEmployeeManager, getDirectReportsOf,
  getManagementChainOf, getDepartmentDirectory, getBranchDirectory
} = require('./ai-employee-tools');
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
      description: 'Tìm nhân viên trong Cơ cấu tổ chức PHF (thông tin dùng chung, KHÔNG phải dữ liệu nhạy cảm) theo tên, mã, chức danh, phòng ban, chi nhánh hoặc tên quản lý trực tiếp. Dùng khi được hỏi tìm một hoặc vài nhân viên theo điều kiện, kể cả câu hỏi dạng "X hiện có bao nhiêu người / là những ai", "Trưởng ca chi nhánh Y là ai" (dùng tham số title cho đúng chức danh, không đoán từ query chung chung), "A thuộc phòng nào" (dùng query=tên A). Nếu tên khớp nhiều người, kết quả sẽ trả về nhiều dòng - hỏi lại người dùng để xác định đúng người, không tự chọn đại 1 người. Với một số chức danh dạng vai trò quản lý (Trợ lý Giám đốc, Trưởng bộ phận, Trưởng ca...), nếu trường chức danh không có kết quả, hệ thống có thể tự bổ sung theo quyền Checklist tương ứng đã cấp làm tín hiệu phụ, hoặc báo 2 nguồn lệch nhau - LUÔN đọc evidence.note để biết chính xác kết quả đến từ trường chức danh hay từ quyền được cấp, không tự nhận nhầm quyền được cấp là chức danh chính thức. Nguồn là bảng nhân sự rộng nhất hệ thống hiện có nhưng CHƯA có bằng chứng bao phủ 100% nhân viên PHF - luôn đọc evidence.note trước khi trả lời câu hỏi tổng số/toàn công ty.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Từ khoá tên hoặc mã nhân viên.' },
          title: { type: 'string', description: 'Lọc theo đúng chức danh, ví dụ "Trợ lý Giám đốc", "Trưởng ca".' },
          department: { type: 'string', description: 'Lọc theo phòng ban.' },
          branch: { type: 'string', description: 'Lọc theo chi nhánh.' },
          manager: { type: 'string', description: 'Lọc theo tên hoặc mã quản lý trực tiếp.' },
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
      description: 'Lấy hồ sơ cơ cấu tổ chức cơ bản (chức danh, phòng ban, chi nhánh, trạng thái) của MỘT nhân viên theo mã chính xác đã biết. Dùng khi được hỏi thông tin/hồ sơ/đang làm ở đâu của một người cụ thể đã biết mã. Nếu chưa biết mã, dùng search_employees theo tên trước.',
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
      name: 'get_employee_manager',
      description: 'Cơ cấu tổ chức: cho biết ai là quản lý trực tiếp của MỘT nhân viên ("A báo cáo cho ai", "ai quản lý A"). Chấp nhận mã nhân viên chính xác hoặc tên. Nếu tên khớp nhiều người, kết quả trả về ambiguous:true kèm danh sách candidates - PHẢI hỏi lại người dùng để xác định đúng người, không tự chọn đại.',
      parameters: {
        type: 'object',
        properties: {
          employeeCode: { type: 'string', description: 'Mã nhân viên chính xác nếu đã biết.' },
          name: { type: 'string', description: 'Tên nhân viên nếu chưa biết mã.' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_direct_reports',
      description: 'Cơ cấu tổ chức: cho biết những ai báo cáo trực tiếp cho MỘT người quản lý ("B quản lý những ai", "ai dưới B", "team của B gồm ai"). Chấp nhận mã nhân viên chính xác hoặc tên. Nếu tên khớp nhiều người, kết quả trả về ambiguous:true kèm candidates - PHẢI hỏi lại người dùng, không tự chọn đại.',
      parameters: {
        type: 'object',
        properties: {
          employeeCode: { type: 'string', description: 'Mã nhân viên chính xác nếu đã biết.' },
          name: { type: 'string', description: 'Tên người quản lý nếu chưa biết mã.' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_management_chain',
      description: 'Cơ cấu tổ chức: cho biết tuyến quản lý của MỘT nhân viên đi từ quản lý trực tiếp lên các cấp cao hơn ("từ nhân viên A lên cấp quản lý gồm những ai", "cho tôi tuyến quản lý của A"). Chấp nhận mã nhân viên chính xác hoặc tên. Nếu tên khớp nhiều người, hỏi lại người dùng, không tự chọn đại.',
      parameters: {
        type: 'object',
        properties: {
          employeeCode: { type: 'string', description: 'Mã nhân viên chính xác nếu đã biết.' },
          name: { type: 'string', description: 'Tên nhân viên nếu chưa biết mã.' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_department_directory',
      description: 'Cơ cấu tổ chức: liệt kê toàn bộ nhân sự và các chức danh đang có trong MỘT phòng ban/bộ phận cụ thể ("phòng Kế toán có những ai", "cơ cấu phòng Kế toán thế nào"). Dùng đúng tên phòng ban người dùng nêu, không đoán tên gần giống.',
      parameters: {
        type: 'object',
        properties: { department: { type: 'string', description: 'Tên phòng ban/bộ phận, ví dụ "Kế toán", "Bán hàng".' } },
        required: ['department']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_branch_directory',
      description: 'Cơ cấu tổ chức: liệt kê toàn bộ nhân sự và các chức danh đang có tại MỘT chi nhánh cụ thể ("Phú Lợi có những nhân viên nào", "Phú Lợi có những chức danh nào"). Dùng đúng tên chi nhánh người dùng nêu (đã chuẩn hóa alias như PL/NQ/LT nếu có), không đoán tên gần giống.',
      parameters: {
        type: 'object',
        properties: { branch: { type: 'string', description: 'Tên chi nhánh, ví dụ "Phú Lợi", "Ngô Quyền", "Lái Thiêu".' } },
        required: ['branch']
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
      description: 'Lấy tổng quan chương trình đào tạo Training Hub, TÁCH RIÊNG Giai đoạn 1 - Hội nhập chung (áp dụng mọi phòng ban/nhân viên mới phù hợp chương trình hội nhập) khỏi phần chuyên môn riêng của từng chương trình (hiện chỉ có dữ liệu chi tiết cho Bán hàng). KHÔNG được tự cộng gộp 2 phần này cho phòng ban khác Bán hàng nếu tool báo không có dữ liệu chuyên môn. Dùng khi được hỏi nhân viên mới/nhân viên một phòng ban cụ thể phải học tổng bao nhiêu bài, chương trình hội nhập gồm những gì/mấy giai đoạn.',
      parameters: {
        type: 'object',
        properties: { programId: { type: 'string', description: 'Mã chương trình (vd new_sales) hoặc tên phòng ban/đối tượng bằng tiếng Việt (vd "Bán hàng", "Kho", "Kế toán"). Để trống nếu câu hỏi không nêu rõ phòng ban - hệ thống sẽ mặc định xét chương trình Bán hàng nhưng đánh dấu rõ đây là mặc định.' } },
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
  get_employee_manager: getEmployeeManager,
  get_direct_reports: getDirectReportsOf,
  get_management_chain: getManagementChainOf,
  get_department_directory: getDepartmentDirectory,
  get_branch_directory: getBranchDirectory,
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
/* extra (tuy chon) - metadata GROUNDING CONTRACT bo sung, KHONG thay doi
   3 trang thai status hien co: isCompletePopulation (co phai 100% quan the
   duoc hoi hay chi 1 tap con - vd checklist_employee_assignments KHONG phai
   toan bo nhan vien PHF) va groundingReplacement (cau chu dong BACKEND tu
   viet, dung de THAY THE nguyen van cau tra loi cua model khi phat hien
   model noi trai voi scope that - xem enforceGrounding() trong
   lib/ai-sandbox.js). Model khong bao gio thay/doc duoc groundingReplacement
   - day la an toan phia server, khong phai prompt. */
function buildEvidence(status, source, asOf, note, extra) {
  const base = {
    status: status,
    source: Array.isArray(source) ? source : [],
    asOf: asOf || new Date().toISOString(),
    note: note || ''
  };
  if (extra && typeof extra === 'object') Object.assign(base, extra);
  return base;
}

const SCOPE_NOTE_CHECKLIST_ONLY = 'Phạm vi: nhân sự đang được phân công theo dõi Checklist (checklist_employee_assignments). Số liệu này KHÔNG đại diện cho toàn bộ nhân viên PHF - có thể còn nhân viên chưa được phân Checklist.';

// SCOPE_NOTE_ORG_DIRECTORY - dung cho cac tool Co cau to chuc (search_employees,
// get_employee_profile, get_employee_manager, get_direct_reports,
// get_management_chain, get_department_directory, get_branch_directory).
// Cung nguon bang voi SCOPE_NOTE_CHECKLIST_ONLY (checklist_employee_assignments)
// nhung KHONG con gan voi quyen Checklist - tool nay mo cho ca 3 role theo
// chinh sach "Organization Directory = thong tin dung chung" da chot. Van
// giu nguyen canh bao CHUA chung minh bao phu 100% nhan vien PHF.
const SCOPE_NOTE_ORG_DIRECTORY = 'Phạm vi: nguồn cơ cấu tổ chức rộng nhất hệ thống hiện có (bảng phân công nhân sự dùng chung). Đây KHÔNG phải dữ liệu nhạy cảm (lương/thu nhập/BHXH/đánh giá cá nhân vẫn theo đúng quyền riêng, không đi qua đây), nhưng CŨNG CHƯA có bằng chứng bao phủ 100% nhân viên PHF - không suy ra đây là tổng toàn công ty nếu không có xác nhận thêm.';

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
      evidence: buildEvidence('VERIFIED', ['checklist_employee_assignments', 'checklist_violation_records'], result.asOf || nowIso, SCOPE_NOTE_CHECKLIST_ONLY, { isCompletePopulation: false }),
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
    const conflict = result.conflict;
    const fallbackUsed = result.titleSource === 'permission_grant_preset';

    // CONFLICTED: title-text va preset-grant (xem ROLE_PRESET_HINTS trong
    // lib/org-directory.js) tra ve 2 tap nguoi KHAC NHAU cho cung 1 cau hoi.
    // Liet ke ca 2 nguon kem cot "Khớp theo" - KHONG tu chon 1 ben la dung,
    // de model/nguoi dung tu doi chieu va yeu cau xac nhan lai du lieu.
    if (conflict) {
      const titleEmployees = conflict.titleEmployees || [];
      const presetEmployees = conflict.presetEmployees || [];
      const presetCodes = new Set(presetEmployees.map(e => e.employeeCode));
      const merged = new Map();
      titleEmployees.forEach(e => merged.set(e.employeeCode, { ...e, matchSource: presetCodes.has(e.employeeCode) ? 'Cả 2 nguồn' : 'Chức danh (title)' }));
      presetEmployees.forEach(e => { if (!merged.has(e.employeeCode)) merged.set(e.employeeCode, { ...e, matchSource: 'Quyền Checklist (preset)' }); });
      const rows = [...merged.values()];
      return {
        type: 'ranking',
        title: `Kết quả tìm nhân viên - 2 nguồn lệch nhau (${rows.length})`,
        scope: '',
        count: rows.length,
        asOf: result.asOf || nowIso,
        evidence: buildEvidence('CONFLICTED', ['checklist_employee_assignments', 'checklist_permission_grants'], result.asOf || nowIso,
          `Trường chức danh (title) và quyền Checklist đã cấp (preset_code=${conflict.presetCode}) trả về danh sách người KHÁC NHAU cho cùng điều kiện tìm kiếm này - có thể do trường chức danh chưa được nhập đúng, hoặc quyền đã cấp không đúng người. Liệt kê đủ cả 2 nguồn kèm cột "Khớp theo" - KHÔNG tự chọn 1 nguồn làm đáp án cuối, cần người có thẩm quyền xác nhận lại dữ liệu gốc.`,
          { isCompletePopulation: false }),
        data: {
          columns: [
            { key: 'employeeName', label: 'Nhân viên', align: 'left' },
            { key: 'employeeCode', label: 'Mã nhân viên', align: 'left' },
            { key: 'title', label: 'Chức danh (title)', align: 'left' },
            { key: 'department', label: 'Bộ phận', align: 'left' },
            { key: 'branch', label: 'Chi nhánh', align: 'left' },
            { key: 'matchSource', label: 'Khớp theo', align: 'left' }
          ],
          rows: rows.map(e => ({
            employeeCode: e.employeeCode || '', employeeName: e.employeeName || '',
            title: e.title || '', department: e.department || '', branch: e.branch || '',
            matchSource: e.matchSource
          }))
        }
      };
    }

    if (!employees.length) return null;
    const total = result.total || employees.length;
    return {
      type: 'ranking',
      title: fallbackUsed ? `Kết quả tìm theo quyền Checklist tương ứng (${total})` : `Kết quả tìm nhân viên (${total})`,
      scope: '',
      count: total,
      asOf: result.asOf || nowIso,
      // groundingReplacement: neu model tra loi trai voi scope (vd bien
      // "38 nguoi trong pham vi Checklist" thanh "38 nhan vien toan PHF"),
      // lib/ai-sandbox.js#enforceGrounding se THAY THE nguyen cau tra loi
      // bang cau nay - khong bao gio de reply sai lot qua.
      evidence: buildEvidence('VERIFIED',
        fallbackUsed ? ['checklist_employee_assignments', 'checklist_permission_grants'] : ['checklist_employee_assignments'],
        result.asOf || nowIso,
        fallbackUsed
          ? `KHÔNG tìm thấy ai khớp đúng trường chức danh (title) cho điều kiện này. Danh sách dưới đây lấy từ quyền Checklist tương ứng đã được cấp (preset) như MỘT TÍN HIỆU BỔ SUNG - đây KHÔNG PHẢI trường chức danh chính thức, chỉ phản ánh ai đang được cấp quyền tương ứng vai trò này. ${SCOPE_NOTE_ORG_DIRECTORY}`
          : SCOPE_NOTE_ORG_DIRECTORY,
        {
          isCompletePopulation: false,
          groundingReplacement: `Trong phạm vi dữ liệu hiện có, hệ thống tìm thấy ${total} người khớp điều kiện tìm kiếm${fallbackUsed ? ' (theo quyền Checklist tương ứng, không phải trường chức danh)' : ''}. ${SCOPE_NOTE_ORG_DIRECTORY}`
        }),
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

  if (toolName === 'get_employee_profile') {
    if (!result.employeeCode) return null; // thieu input

    if (!result.found || !result.profile) {
      return {
        type: 'employee_profile',
        title: `Không tìm thấy ${result.employeeCode}`,
        scope: result.employeeCode || '',
        asOf: result.asOf || nowIso,
        evidence: buildEvidence('INCOMPLETE', ['checklist_employee_assignments'], result.asOf || nowIso, `Không tìm thấy mã ${result.employeeCode} trong nguồn cơ cấu tổ chức hiện có - có thể do nhân viên chưa được nhập vào nguồn này, đã nghỉ việc, hoặc mã không đúng. Đây KHÔNG có nghĩa vị trí đang trống - chỉ là chưa tìm thấy trong nguồn dữ liệu.`),
        data: { employeeCode: result.employeeCode || '', employeeName: '', fields: [] }
      };
    }

    const p = result.profile;
    return {
      type: 'employee_profile',
      title: p.employeeName || result.employeeCode || '',
      scope: result.employeeCode || '',
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['checklist_employee_assignments'], result.asOf || nowIso, SCOPE_NOTE_ORG_DIRECTORY, { isCompletePopulation: false }),
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

  // Card cho truong hop ambiguous (ten khop nhieu nguoi) - dung chung cho
  // get_employee_manager/get_direct_reports/get_management_chain. INCOMPLETE
  // (khong phai VERIFIED) vi day la danh sach ung vien can nguoi dung tu
  // chon, khong phai ket qua da xac dinh.
  function buildAmbiguousCard(candidates, titleText) {
    const rows = (Array.isArray(candidates) ? candidates : []);
    if (!rows.length) return null;
    return {
      type: 'ranking',
      title: titleText,
      scope: '',
      asOf: nowIso,
      evidence: buildEvidence('INCOMPLETE', ['checklist_employee_assignments'], nowIso, 'Tên khớp nhiều người trong nguồn cơ cấu tổ chức - cần xác định đúng người trước khi trả lời, không tự chọn đại 1 người.'),
      data: {
        columns: [
          { key: 'employeeName', label: 'Nhân viên', align: 'left' },
          { key: 'employeeCode', label: 'Mã nhân viên', align: 'left' },
          { key: 'title', label: 'Chức danh', align: 'left' },
          { key: 'department', label: 'Bộ phận', align: 'left' },
          { key: 'branch', label: 'Chi nhánh', align: 'left' }
        ],
        rows: rows.map(e => ({
          employeeCode: e.employeeCode || '', employeeName: e.employeeName || '',
          title: e.title || '', department: e.department || '', branch: e.branch || ''
        }))
      }
    };
  }

  if (toolName === 'get_employee_manager') {
    if (result.ambiguous) return buildAmbiguousCard(result.candidates, 'Nhiều nhân sự trùng tên - cần xác định người cần hỏi');
    if (!result.found || !result.employee) return null;
    const employee = result.employee;
    const manager = result.manager;
    if (!manager) {
      return {
        type: 'employee_profile',
        title: `Quản lý trực tiếp của ${employee.employeeName || employee.employeeCode}`,
        scope: employee.employeeCode || '',
        asOf: result.asOf || nowIso,
        evidence: buildEvidence('INCOMPLETE', ['checklist_employee_assignments'], result.asOf || nowIso, 'Không có thông tin quản lý trực tiếp trong nguồn dữ liệu - có thể đây là vị trí cao nhất trong cơ cấu, hoặc dữ liệu quản lý của người này chưa được cập nhật đầy đủ. Không suy ra kết luận nào khác ngoài việc chưa có dữ liệu.'),
        data: { employeeCode: '', employeeName: '—', fields: [{ label: 'Nhân viên', value: `${employee.employeeName || ''} (${employee.employeeCode || ''})` }] }
      };
    }
    return {
      type: 'employee_profile',
      title: `Quản lý trực tiếp của ${employee.employeeName || employee.employeeCode}`,
      scope: employee.employeeCode || '',
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['checklist_employee_assignments'], result.asOf || nowIso, SCOPE_NOTE_ORG_DIRECTORY, { isCompletePopulation: false }),
      data: {
        employeeCode: manager.employeeCode || '',
        employeeName: manager.employeeName || '',
        fields: [
          { label: 'Chức danh', value: manager.title || '—' },
          { label: 'Bộ phận', value: manager.department || '—' },
          { label: 'Chi nhánh', value: manager.branch || '—' },
          { label: 'Nhân viên', value: `${employee.employeeName || ''} (${employee.employeeCode || ''})` }
        ]
      }
    };
  }

  if (toolName === 'get_direct_reports') {
    if (result.ambiguous) return buildAmbiguousCard(result.candidates, 'Nhiều nhân sự trùng tên - cần xác định người cần hỏi');
    if (!result.found || !result.manager) return null;
    const reports = Array.isArray(result.reports) ? result.reports : [];
    if (!reports.length) return null; // khong the ket luan "khong ai bao cao" - de model tu dien giai tu raw JSON theo huong dan he thong
    return {
      type: 'ranking',
      title: `${reports.length} người báo cáo trực tiếp cho ${result.manager.employeeName || result.manager.employeeCode}`,
      scope: result.manager.employeeCode || '',
      count: reports.length,
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['checklist_employee_assignments'], result.asOf || nowIso, SCOPE_NOTE_ORG_DIRECTORY, { isCompletePopulation: false }),
      data: {
        columns: [
          { key: 'employeeName', label: 'Nhân viên', align: 'left' },
          { key: 'employeeCode', label: 'Mã nhân viên', align: 'left' },
          { key: 'title', label: 'Chức danh', align: 'left' },
          { key: 'department', label: 'Bộ phận', align: 'left' },
          { key: 'branch', label: 'Chi nhánh', align: 'left' }
        ],
        rows: reports.map(e => ({
          employeeCode: e.employeeCode || '', employeeName: e.employeeName || '',
          title: e.title || '', department: e.department || '', branch: e.branch || ''
        }))
      }
    };
  }

  if (toolName === 'get_management_chain') {
    if (result.ambiguous) return buildAmbiguousCard(result.candidates, 'Nhiều nhân sự trùng tên - cần xác định người cần hỏi');
    if (!result.found || !result.employee) return null;
    const chain = Array.isArray(result.chain) ? result.chain : [];
    if (!chain.length) return null;
    return {
      type: 'ranking',
      title: `Tuyến quản lý của ${result.employee.employeeName || result.employee.employeeCode}`,
      scope: result.employee.employeeCode || '',
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['checklist_employee_assignments'], result.asOf || nowIso,
        SCOPE_NOTE_ORG_DIRECTORY + (result.truncated ? ' Tuyến quản lý có thể còn tiếp tục nhưng đã đạt giới hạn hiển thị.' : ''),
        { isCompletePopulation: false }),
      data: {
        columns: [
          { key: 'rank', label: 'Cấp', align: 'left' },
          { key: 'employeeName', label: 'Nhân viên', align: 'left' },
          { key: 'employeeCode', label: 'Mã nhân viên', align: 'left' },
          { key: 'title', label: 'Chức danh', align: 'left' }
        ],
        rows: chain.map((e, i) => ({
          rank: i + 1, employeeCode: e.employeeCode || '', employeeName: e.employeeName || '', title: e.title || ''
        }))
      }
    };
  }

  if (toolName === 'get_department_directory' || toolName === 'get_branch_directory') {
    const isDept = toolName === 'get_department_directory';
    const label = isDept ? result.department : result.branch;
    if (!label) return null; // thieu input
    if (!result.available) {
      return {
        type: 'ranking',
        title: `Không tìm thấy nhân sự nào cho ${isDept ? 'phòng ban' : 'chi nhánh'} "${label}"`,
        scope: label,
        asOf: result.asOf || nowIso,
        evidence: buildEvidence('INCOMPLETE', ['checklist_employee_assignments'], result.asOf || nowIso,
          `Không tìm thấy nhân sự nào khớp đúng tên ${isDept ? 'phòng ban' : 'chi nhánh'} "${label}" trong nguồn cơ cấu tổ chức hiện có. Có thể do tên chưa khớp chính xác hoặc dữ liệu chưa đầy đủ - KHÔNG suy ra đây là ${isDept ? 'phòng ban' : 'chi nhánh'} không tồn tại hay không có nhân sự nào.`),
        data: { columns: [], rows: [] }
      };
    }
    const members = Array.isArray(result.members) ? result.members : [];
    const titles = Array.isArray(result.titles) ? result.titles : [];
    return {
      type: 'ranking',
      title: `Nhân sự ${isDept ? 'phòng' : 'chi nhánh'} ${label} (${result.total})`,
      scope: label,
      count: result.total,
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['checklist_employee_assignments'], result.asOf || nowIso,
        SCOPE_NOTE_ORG_DIRECTORY + (titles.length ? ` Các chức danh hiện có: ${titles.join(', ')}.` : ''),
        { isCompletePopulation: false }),
      data: {
        columns: [
          { key: 'employeeName', label: 'Nhân viên', align: 'left' },
          { key: 'employeeCode', label: 'Mã nhân viên', align: 'left' },
          { key: 'title', label: 'Chức danh', align: 'left' },
          { key: isDept ? 'branch' : 'department', label: isDept ? 'Chi nhánh' : 'Bộ phận', align: 'left' }
        ],
        rows: members.map(e => ({
          employeeCode: e.employeeCode || '', employeeName: e.employeeName || '',
          title: e.title || '', branch: e.branch || '', department: e.department || ''
        }))
      }
    };
  }

  if (toolName === 'get_knl_profile') {
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
    return {
      type: 'employee_profile',
      title: p.employeeName || result.employeeCode || '',
      scope: result.employeeCode || '',
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['checklist_employee_assignments'], result.asOf || nowIso, 'Chỉ có thông tin tổ chức cơ bản (chức danh/phòng ban/chi nhánh). CHƯA có dữ liệu đánh giá năng lực hay điểm gap (phần đánh giá chi tiết của Khung năng lực chưa triển khai).', { isCompletePopulation: false }),
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
    const total = result.total || people.length;
    return {
      type: 'ranking',
      title: `Kết quả tìm nhân sự Khung năng lực (${total})`,
      scope: '',
      count: total,
      asOf: result.asOf || nowIso,
      evidence: buildEvidence('VERIFIED', ['checklist_employee_assignments'], result.asOf || nowIso, SCOPE_NOTE_CHECKLIST_ONLY, {
        isCompletePopulation: false,
        groundingReplacement: `Trong phạm vi dữ liệu hiện có, hệ thống tìm thấy ${total} người khớp điều kiện tìm kiếm. ${SCOPE_NOTE_CHECKLIST_ONLY}`
      }),
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
        title: 'Chương trình đào tạo hội nhập',
        scope: '',
        asOf: result.asOf || nowIso,
        evidence: buildEvidence('INCOMPLETE', [], result.asOf || nowIso, 'Chưa có nội dung chương trình hội nhập trong Training Hub.'),
        data: { metrics: [], sections: [] }
      };
    }
    const spec = result.specialization;
    const commonLabel = result.commonStageLabel || 'Giai đoạn 1 - Hội nhập chung';
    const commonLessons = result.commonLessons || 0;
    const metrics = [
      { label: `${commonLabel} (áp dụng mọi phòng ban)`, value: `${commonLessons} bài` }
    ];
    let note;
    let title;
    if (spec) {
      const totalWithSpec = commonLessons + spec.lessonCount;
      metrics.push({ label: `Chuyên môn ${spec.programLabel}`, value: `${spec.lessonCount} bài` });
      metrics.push({ label: `Tổng chương trình đầy đủ ${spec.programLabel}`, value: `${totalWithSpec} bài` });
      title = `Chương trình đào tạo ${spec.programLabel}`;
      note = `${commonLabel} (${commonLessons} bài) áp dụng cho mọi phòng ban/nhân viên mới phù hợp chương trình hội nhập, không riêng ${spec.programLabel}. Phần chuyên môn ${spec.lessonCount} bài ở các giai đoạn tiếp theo chỉ dành riêng cho ${spec.programLabel}; tổng chương trình đầy đủ ${spec.programLabel} là ${totalWithSpec} bài.` +
        (result.isDefaultAssumption ? ` Câu hỏi không nêu rõ phòng ban nên hệ thống mặc định xét chương trình ${spec.programLabel} - nếu người hỏi thuộc phòng ban khác, chỉ chắc chắn áp dụng ${commonLessons} bài ${commonLabel}.` : '');
    } else {
      title = 'Chương trình đào tạo hội nhập chung';
      note = `Phòng ban/chương trình được hỏi hiện chưa có dữ liệu chương trình chuyên môn riêng trong Training Hub. Chỉ xác nhận được ${commonLessons} bài ${commonLabel}, áp dụng cho mọi phòng ban/nhân viên mới phù hợp chương trình hội nhập - KHÔNG được suy ra tổng 120 bài (đó là tổng riêng của chương trình Bán hàng).`;
    }
    return {
      type: 'summary',
      title,
      scope: spec ? spec.programId : '',
      asOf: result.asOf || nowIso,
      // groundingReplacement chi kich hoat khi khong co du lieu chuyen mon
      // (spec=null) va model van lo noi 120 bai - day la dung case P1 "43
      // bai != 120 bai" trong batch nay.
      evidence: buildEvidence('VERIFIED', ['phf-lessons-new-sales'], result.asOf || nowIso, note, {
        isCompletePopulation: true,
        hasSpecialization: !!spec,
        groundingReplacement: !spec ? note : null
      }),
      data: {
        metrics,
        sections: spec && spec.stages.length ? [{
          label: `Số bài chuyên môn ${spec.programLabel} theo giai đoạn`,
          items: spec.stages.map(s => ({ label: s.badge || `Giai đoạn ${s.stage + 1}`, value: `${s.lessonCount} bài` }))
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
