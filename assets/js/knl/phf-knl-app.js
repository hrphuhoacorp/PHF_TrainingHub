(function(){
'use strict';

/* PHF KNL (Khung năng lực) — Step 1: Nhân sự + Phân quyền foundation.
   Đọc nhân sự CHỈ qua action listKnlPeople (KNL People Adapter ở
   lib/knl-people.js) — không gọi thẳng logic Checklist từ đây. */

function esc(value){
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function roleHome(){
  var r='learner';
  try{ r = window.phfGetSessionRole ? window.phfGetSessionRole() : 'learner'; }catch(e){}
  return r==='admin' ? '/admin' : (r==='manager' ? '/ql' : '/hv');
}
function knlPath(suffix){
  return roleHome() + '/knl' + (suffix ? '/' + suffix : '');
}
function goHub(){ if(typeof window.phfNavigate==='function') window.phfNavigate(roleHome() + '/home'); }
function goTab(suffix){ if(typeof window.phfNavigate==='function') window.phfNavigate(knlPath(suffix)); }
function currentUser(){ try{ return (window.phfGetCurrentUser&&window.phfGetCurrentUser())||(window.phfGetAuthenticatedUser&&window.phfGetAuthenticatedUser())||{}; }catch(e){ return {}; } }
function currentEmployeeCode(){ var u=currentUser(); return String(u.employeeCode||u.employee_code||u.code||'').trim().toUpperCase(); }
function goIncomeEmployee(employeeCode){ var path=knlPath('co-cau-thu-nhap'),code=String(employeeCode||'').trim().toUpperCase();if(code)path+='?employee_code='+encodeURIComponent(code);if(typeof window.phfNavigate==='function')window.phfNavigate(path); }
function goIncomePicker(){ var path=knlPath('co-cau-thu-nhap')+'?choose_employee=1';if(typeof window.phfNavigate==='function')window.phfNavigate(path); }
function currentUserName(){ var u=currentUser(); return String(u.fullName||u.full_name||u.name||u.displayName||u.display_name||u.email||'Người dùng').trim(); }
function currentUserTitle(){ var u=currentUser(); return String(u.title||u.position||u.roleName||u.role_name||(roleHome()==='/admin'?'Quản trị hệ thống':(roleHome()==='/ql'?'Quản lý':'Nhân viên'))).trim(); }
function sidebarRoleLabel(capabilities, isAdmin){
  /* UI label only. Permission/scope enforcement remains backend/API-driven. */
  if(isAdmin === true) return 'Quản trị hệ thống';
  var caps = capabilities || {};
  if(caps.manage_permissions === true) return 'Quản trị hệ thống';

  var title = currentUserTitle().toLowerCase();
  if(title.indexOf('trợ lý giám đốc') !== -1 || title.indexOf('tro ly giam doc') !== -1) return 'Quản trị Khung năng lực';
  if(title.indexOf('trưởng bộ phận') !== -1 || title.indexOf('truong bo phan') !== -1 ||
     title.indexOf('trưởng ca') !== -1 || title.indexOf('truong ca') !== -1 ||
     title.indexOf('cửa hàng trưởng') !== -1 || title.indexOf('cua hang truong') !== -1 ||
     title.indexOf('quản lý') !== -1 || title.indexOf('quan ly') !== -1) return 'Quản lý năng lực';
  return 'Khung năng lực cá nhân';
}

var KNL_READ_CACHE_TTL = 30000;
var knlReadCache = new Map();
var knlAuthorizationSignature = '';
var KNL_CACHEABLE_ACTIONS = new Set(['listKnlFrameworks','getKnlGradeMatrix','listKnlCompensationStandards','previewKnlCompensationFoundation','listKnlIncomeTargets','getKnlEmployeeIncome','listKnlAssignmentTargets','listKnlFrameworkAssignments','listKnlSourceManifests','previewKnlSourceSeed','listKnlPeople','listKnlSurveyCampaigns','getKnlSurveySetup','listKnlCompensationAssignmentTargets','getKnlCompensationVersionAudit','listKnlEmployeeCompensationHistory']);
var KNL_INVALIDATING_ACTIONS = new Set(['createKnlFramework','saveKnlFramework','cloneKnlVersion','publishKnlVersion','saveKnlGroup','saveKnlItem','saveKnlColumn','deleteKnlStructure','disableKnlStructure','reorderKnlStructure','saveKnlLevelContent','saveKnlGradeMatrix','setKnlVersionEffectivity','applyKnlCompensationFoundation','saveKnlEmployeeIncome','seedKnlSourceManifest','saveKnlFrameworkAssignment','saveKnlSurveyCampaign','openKnlSurveyCampaign','closeKnlSurveyCampaign','cloneKnlSurveyVersionToDraft','cloneKnlCompensationVersion','saveKnlCompensationGrades','scheduleKnlCompensationVersion']);
function knlCacheOwner(){var u=currentUser();return String(u.id||u.accountId||u.email||u.employeeCode||u.employee_code||roleHome())+'|'+knlAuthorizationSignature;}
function clearKnlReadCache(){knlReadCache.clear();}
function invalidateKnlViewState(action){
  if(/^((create|save)Knl|cloneKnl|publishKnl|deleteKnl|disableKnl|reorderKnl)/.test(action)&&typeof frameworkState!=='undefined')frameworkState.loaded=false;
  if((action==='seedKnlSourceManifest'||action==='saveKnlFrameworkAssignment')&&typeof assignmentState!=='undefined')assignmentState.loaded=false;
  if((/Survey/.test(action)||action==='saveKnlFrameworkAssignment')&&typeof surveyState!=='undefined')surveyState.loaded=false;
}
async function apiPostUncached(action, extra){
  var response = await fetch('/api/data', {
    method:'POST', credentials:'same-origin', cache:'no-store',
    headers:{'Content-Type':'application/json','Accept':'application/json'},
    body: JSON.stringify(Object.assign({action:action}, extra || {}))
  });
  var data = null;
  try{ data = await response.json(); }catch(e){ data = null; }
  if(!response.ok || !data || data.ok !== true){
    var message = (data && data.error) || 'Không thể xử lý yêu cầu. Vui lòng thử lại.';
    var error = new Error(message);
    error.code = data && data.code;
    throw error;
  }
  return data;
}
function apiPost(action, extra){
  if(KNL_INVALIDATING_ACTIONS.has(action)){clearKnlReadCache();invalidateKnlViewState(action);}
  if(!KNL_CACHEABLE_ACTIONS.has(action))return apiPostUncached(action,extra);
  var key=knlCacheOwner()+'|'+action+'|'+JSON.stringify(extra||{}),now=Date.now(),hit=knlReadCache.get(key);
  if(hit&&now-hit.at<KNL_READ_CACHE_TTL)return hit.promise;
  var promise=apiPostUncached(action,extra).catch(function(error){knlReadCache.delete(key);throw error;});
  knlReadCache.set(key,{at:now,promise:promise});
  return promise;
}

var CAPABILITY_LABELS = {
  access_knl:'Truy cập KNL',
  view_people:'Xem Nhân sự',
  manage_permissions:'Quản lý phân quyền KNL',
  income_view:'Truy cập mục Thu nhập',
  propose:'Đề xuất năng lực (chưa mở nghiệp vụ)',
  agree_proposal:'Đồng ý đề xuất (chưa mở nghiệp vụ)',
  approve:'Duyệt (chưa mở nghiệp vụ)',
  manage_framework:'Quản lý khung năng lực (chưa mở nghiệp vụ)'
};
var SCOPE_LABELS = {
  self:'Chỉ chính mình',
  sales_all_branches:'Bán hàng — cả 3 chi nhánh',
  department:'Theo bộ phận',
  employees:'Nhân sự cụ thể',
  all_company:'Toàn công ty'
};
var STATUS_LABELS = { active:'Đang làm việc', inactive:'Ngừng làm việc', all:'Tất cả' };

/* Vai trò nghiệp vụ KNL đã chốt (PHF HR – KNL PERMISSION ADMIN UX) — CHỈ 3 vai
   trò gán được qua form đơn giản, map thẳng 1-1 vào preset kỹ thuật hiện có
   (engine 1.44.8, không đổi). "Admin" KHÔNG nằm trong danh sách này vì quyền
   Admin KNL đến từ session.role==='admin' ở Hub (đường cứu hộ trong
   resolveActorGrant()), không phải từ 1 dòng grant/preset — sửa cái đó là sửa
   Auth/session (ngoài phạm vi KNL). "Trưởng ca/CHT" (TRUONG_CA_CHTR) và
   "Tuỳ chỉnh" (CUSTOM) là preset kỹ thuật cũ, không còn hiển thị ở đây nữa
   theo đúng yêu cầu — vẫn chọn được qua "Thiết lập nâng cao" nếu cần. */
var BUSINESS_ROLES = [
  { key:'assistant', label:'Trợ lý GĐ', presetCode:'TRO_LY_GD' },
  { key:'tbp', label:'TBP', presetCode:'TRUONG_BO_PHAN' },
  { key:'employee', label:'Nhân viên', presetCode:'NHAN_VIEN' }
];
var BUSINESS_ROLE_LABELS = { admin:'Admin', assistant:'Trợ lý GĐ', tbp:'TBP', employee:'Nhân viên', unknown:'Tuỳ chỉnh' };
function roleKeyFromPreset(presetCode){
  if(!presetCode) return ''; // chưa chọn vai trò nào (tài khoản mới, chưa có grant) - khác với "unknown" (đã có preset nhưng không map được 1 trong 3 vai trò)
  if(presetCode==='TRO_LY_GD') return 'assistant';
  if(presetCode==='TRUONG_BO_PHAN') return 'tbp';
  if(presetCode==='NHAN_VIEN') return 'employee';
  return 'unknown';
}
function businessRoleForAccount(acc, grant){
  if(acc && String(acc.role).toLowerCase()==='admin') return 'admin';
  if(!grant) return '';
  return roleKeyFromPreset(grant.presetCode);
}

/* Layout: topbar 3 cột (back trái / brand giữa / spacer phải) + sidebar trái
   (menu dọc) + content phải. Cấu trúc, spacing, kích thước sidebar, hành vi
   active/hover COPY đúng khung quản trị Checklist (.phfck-topbar/.phfck-layout/
   .phfck-sidebar/.phfck-nav) — class/màu/nội dung hoàn toàn riêng của KNL,
   không đụng file/CSS Checklist, không kéo nghiệp vụ Checklist sang đây. */
var SIDEBAR_ITEMS = [
  { key:'bo-knl', label:'Bộ KNL', desc:'Framework & cấu trúc Draft', icon:'▦', needs:'manage_framework' },
  { key:'khao-sat', label:'Khảo sát & đánh giá', desc:'Đợt khảo sát và kết quả', icon:'◫', needs:'access_knl' },
  { key:'nhan-su', label:'Nhân sự', desc:'Nhân sự thuộc phạm vi', icon:'◍', needs:'access_knl' },
  { key:'co-cau-thu-nhap', label:'Bậc & Cơ cấu thu nhập', desc:'Thông tin tham chiếu cá nhân', icon:'◍', ownAlways:true },
  { key:'phan-quyen', label:'Phân quyền', desc:'Quản lý quyền truy cập KNL', icon:'⚙', needs:'manage_permissions' }
];

function shellFrame(activeTab, capabilities, isAdmin, bodyHtml){
  var activeSidebarTab=activeTab==='gan-ap-dung'?'bo-knl':activeTab;
  if(['tieu-chuan-bac','phien-ban-lich-su'].indexOf(activeTab)>=0)activeSidebarTab='bo-knl';
  if(['ngach-bac-luong','gan-thu-nhap','lich-su-thu-nhap'].indexOf(activeTab)>=0)activeSidebarTab='co-cau-thu-nhap';
  if(activeTab==='ket-qua-khao-sat')activeSidebarTab='khao-sat';
  var items = SIDEBAR_ITEMS.filter(function(item){ if(item.ownAlways)return true;if(item.adminOnly)return isAdmin===true;return isAdmin || (capabilities && capabilities[item.needs]); });
  var icons = {
    'bo-knl':'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>',
    'khao-sat':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5"/></svg>',
    'nhan-su':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg>',
    'co-cau-thu-nhap':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M6 3h12v18H6zM9 12h6M9 16h4"/></svg>',
    'phan-quyen':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>'
  };
  var navHtml = items.map(function(item){
    var desc=item.key==='nhan-su'?'Danh sách & phạm vi':'Quyền thao tác & scope';
    return '<button type="button" class="phfk-nav-item'+(activeSidebarTab===item.key?' active':'')+'" data-knl-tab="'+item.key+'">' +
      '<span class="phfk-nav-icon">'+(icons[item.key]||'')+'</span>' +
      '<span><b>'+item.label+'</b><small>'+desc+'</small></span></button>';
  }).join('');
  return '' +
    '<header class="phfk-topbar">' +
      '<div class="phfk-top-left"><button type="button" class="phfk-back" data-knl-back><span aria-hidden="true">←</span><span>PHF HR / Home</span></button></div>' +
      '<div class="phfk-brand-lockup"><strong>PHF HR - KHUNG NĂNG LỰC</strong></div>' +
      '<div class="phfk-top-actions"><span class="phfk-user-avatar"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></span><span class="phfk-user-copy"><b>'+esc(currentUserName())+'</b><small>'+esc(currentUserTitle())+'</small></span></div>' +
    '</header>' +
    '<div class="phfk-layout">' +
      (navHtml ? '<aside class="phfk-sidebar"><div class="phfk-sidebar-head"><img src="assets/logo/phf-logo.png" alt="PHUHOA fresh"><strong>'+esc(sidebarRoleLabel(capabilities, isAdmin))+'</strong></div><nav class="phfk-nav">'+navHtml+'</nav><section class="phfk-guide"><b>Hướng dẫn</b><p>Quản lý danh sách nhân sự và phân quyền truy cập Khung năng lực.</p><button type="button" disabled>Xem hướng dẫn</button></section></aside>' : '') +
      '<main class="phfk-main" data-knl-body>' + (bodyHtml || '') + '</main>' +
    '</div>';
}
function bindShell(root){
  root.querySelectorAll('[data-knl-back]').forEach(function(el){ el.addEventListener('click', goHub); });
  root.querySelectorAll('[data-knl-tab]').forEach(function(el){ el.addEventListener('click', function(){ goTab(el.getAttribute('data-knl-tab')); }); });
}
var knlActivePath = '';
var knlScrollMemory = {};
var knlLastIsAdmin = false;
function activeSidebarTab(tab){ if(['ngach-bac-luong','gan-thu-nhap','lich-su-thu-nhap'].indexOf(tab)>=0)return'co-cau-thu-nhap';return ['gan-ap-dung','tieu-chuan-bac','phien-ban-lich-su'].indexOf(tab)>=0?'bo-knl':(tab==='ket-qua-khao-sat'?'khao-sat':tab); }
function shellSignature(capabilities,isAdmin){
  return JSON.stringify({admin:isAdmin===true,access:capabilities&&capabilities.access_knl===true,framework:capabilities&&capabilities.manage_framework===true,permissions:capabilities&&capabilities.manage_permissions===true});
}
function setShellActiveTab(root,tab){
  var active=activeSidebarTab(tab);
  root.querySelectorAll('[data-knl-tab]').forEach(function(el){el.classList.toggle('active',el.getAttribute('data-knl-tab')===active);});
}
function ensureKnlShell(root,tab,capabilities,isAdmin,bodyHtml){
  var shell=root.querySelector('.phf-knl-root-shell'),signature=shellSignature(capabilities,isAdmin);
  if(!shell||shell.dataset.signature!==signature){
    root.innerHTML='<div class="phf-knl-root-shell">'+shellFrame(tab,capabilities,isAdmin,bodyHtml||'')+'</div>';
    shell=root.querySelector('.phf-knl-root-shell');
    shell.dataset.signature=signature;
    bindShell(root);
  }else{
    setShellActiveTab(root,tab);
    var body=root.querySelector('[data-knl-body]');
    if(body&&bodyHtml!==undefined)body.innerHTML=bodyHtml;
  }
  root.dataset.knlTab=tab;
  return shell;
}
function showKnlPanelLoading(root,tab){
  if(!root.querySelector('.phf-knl-root-shell'))return;
  setShellActiveTab(root,tab);
  root.dataset.knlTab=tab;
  var body=root.querySelector('[data-knl-body]');
  if(body)body.innerHTML='<div class="phfk-loading">Đang tải nội dung…</div>';
}
function restoreKnlScroll(path){
  var top=Number(knlScrollMemory[path]||0);
  requestAnimationFrame(function(){window.scrollTo(0,top);});
}

function frameworkDomainNav(activeTab){
  return '<nav class="phfk-domain-tabs" aria-label="Bộ KNL">'+
    '<button type="button" class="'+(activeTab==='bo-knl'?'active':'')+'" data-knl-domain-tab="bo-knl">Cấu trúc bộ KNL</button>'+
    '<button type="button" class="'+(activeTab==='tieu-chuan-bac'?'active':'')+'" data-knl-domain-tab="tieu-chuan-bac">Tiêu chuẩn bậc</button>'+
    '<button type="button" class="'+(activeTab==='gan-ap-dung'?'active':'')+'" data-knl-domain-tab="gan-ap-dung">Gán & áp dụng</button>'+
    '<button type="button" class="'+(activeTab==='phien-ban-lich-su'?'active':'')+'" data-knl-domain-tab="phien-ban-lich-su">Phiên bản & lịch sử</button></nav>';
}
function bindFrameworkDomainNav(root){root.querySelectorAll('[data-knl-domain-tab]').forEach(function(el){el.addEventListener('click',function(){goTab(el.getAttribute('data-knl-domain-tab'));});});}

function compensationDomainNav(activeTab,isAdmin){if(!isAdmin)return'';return '<nav class="phfk-domain-tabs" aria-label="Bậc & Cơ cấu thu nhập">'+
  '<button type="button" class="'+(activeTab==='ngach-bac-luong'?'active':'')+'" data-knl-compensation-tab="ngach-bac-luong">Cơ cấu ngạch & bậc</button>'+
  '<button type="button" class="'+(activeTab==='gan-thu-nhap'?'active':'')+'" data-knl-compensation-tab="gan-thu-nhap">Gán cho nhân viên</button>'+
  '<button type="button" class="'+(activeTab==='co-cau-thu-nhap'?'active':'')+'" data-knl-compensation-tab="co-cau-thu-nhap">Hồ sơ thu nhập</button>'+
  '<button type="button" class="'+(activeTab==='lich-su-thu-nhap'?'active':'')+'" data-knl-compensation-tab="lich-su-thu-nhap">Lịch sử</button></nav>';}
function bindCompensationDomainNav(root){root.querySelectorAll('[data-knl-compensation-tab]').forEach(function(el){el.addEventListener('click',function(){goTab(el.getAttribute('data-knl-compensation-tab'));});});}

function noAccessSection(message){
  return '<section class="phfk-empty"><p>' + esc(message) + '</p></section>';
}

/* ===================== NHÂN SỰ ===================== */

var peopleState = { filters:{ search:'', department:'', branch:'', status:'active' }, rows:[], loading:false, loaded:false, loadedAt:0, searchTimer:null };
var peopleCanViewIncome = false;

function peopleFilterBar(){
  var f = peopleState.filters;
  var departments = Array.from(new Set(peopleState.rows.map(function(r){ return r.department; }).filter(Boolean))).sort();
  var branches = Array.from(new Set(peopleState.rows.map(function(r){ return r.branch; }).filter(Boolean))).sort();
  var deptOptions = '<option value="">Tất cả phòng ban</option>' + departments.map(function(d){ return '<option value="'+esc(d)+'"'+(f.department===d?' selected':'')+'>'+esc(d)+'</option>'; }).join('');
  var branchOptions = '<option value="">Tất cả chi nhánh</option>' + branches.map(function(b){ return '<option value="'+esc(b)+'"'+(f.branch===b?' selected':'')+'>'+esc(b)+'</option>'; }).join('');
  var statusOptions = ['active','inactive','all'].map(function(s){ return '<option value="'+s+'"'+(f.status===s?' selected':'')+'>'+STATUS_LABELS[s]+'</option>'; }).join('');
  return '' +
    '<div class="phfk-filters">' +
      '<input type="search" class="phfk-input" placeholder="Tìm mã NV hoặc họ tên…" value="'+esc(f.search)+'" data-knl-people-search>' +
      '<select class="phfk-input" data-knl-people-department>'+deptOptions+'</select>' +
      '<select class="phfk-input" data-knl-people-branch>'+branchOptions+'</select>' +
      '<select class="phfk-input" data-knl-people-status>'+statusOptions+'</select>' +
    '</div>';
}

function peopleTable(){
  if(peopleState.loading) return '<div class="phfk-loading">Đang tải danh sách nhân sự…</div>';
  if(!peopleState.rows.length) return noAccessSection('Không có nhân sự nào thuộc phạm vi của bạn với bộ lọc hiện tại.');
  var rows = peopleState.rows.map(function(p){
    return '<tr><td>'+esc(p.employeeCode)+'</td><td>'+esc(p.employeeName)+'</td><td>'+esc(p.title)+'</td><td>'+esc(p.department)+'</td><td>'+esc(p.branch)+'</td><td>'+esc(p.status)+'</td>'+(peopleCanViewIncome?'<td><button type="button" class="phfk-link" data-knl-person-income="'+esc(p.employeeCode)+'">Xem thu nhập</button></td>':'')+'</tr>';
  }).join('');
  return '' +
    '<div class="phfk-table-wrap"><table class="phfk-table">' +
      '<thead><tr><th>Mã NV</th><th>Họ và tên</th><th>Chức vụ/Chức danh</th><th>Phòng ban</th><th>Chi nhánh</th><th>Trạng thái</th>'+(peopleCanViewIncome?'<th>Thu nhập</th>':'')+'</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div>' +
    '<p class="phfk-count">' + peopleState.rows.length + ' nhân sự</p>';
}

function renderPeopleBody(root){
  var body = root.querySelector('[data-knl-body]');
  if(!body) return;
  body.innerHTML = '<div class="phfk-page-head"><div><small>KNL &middot; NHÂN SỰ</small><h1>Nhân sự thuộc phạm vi</h1></div></div>' + peopleFilterBar() + peopleTable();
  bindPeopleFilters(root);
}

function bindPeopleFilters(root){
  root.querySelectorAll('[data-knl-person-income]').forEach(function(button){button.addEventListener('click',function(){goIncomeEmployee(button.getAttribute('data-knl-person-income'));});});
  var search = root.querySelector('[data-knl-people-search]');
  if(search) search.addEventListener('input', function(){
    peopleState.filters.search = search.value;
    clearTimeout(peopleState.searchTimer);
    peopleState.searchTimer = setTimeout(function(){ loadPeople(root); }, 300);
  });
  var dept = root.querySelector('[data-knl-people-department]');
  if(dept) dept.addEventListener('change', function(){ peopleState.filters.department = dept.value; loadPeople(root); });
  var branch = root.querySelector('[data-knl-people-branch]');
  if(branch) branch.addEventListener('change', function(){ peopleState.filters.branch = branch.value; loadPeople(root); });
  var status = root.querySelector('[data-knl-people-status]');
  if(status) status.addEventListener('change', function(){ peopleState.filters.status = status.value; loadPeople(root); });
}

async function loadPeople(root){
  peopleState.loading = true;
  renderPeopleBody(root);
  try{
    var data = await apiPost('listKnlPeople', peopleState.filters);
    peopleState.rows = data.people || [];
  }catch(e){
    peopleState.rows = [];
    var body = root.querySelector('[data-knl-body]');
    if(body) body.innerHTML = '<div class="phfk-page-head"><div><small>KNL &middot; NHÂN SỰ</small><h1>Nhân sự thuộc phạm vi</h1></div></div>' + noAccessSection(e.message);
    peopleState.loading = false;
    return;
  }
  peopleState.loading = false;
  peopleState.loaded = true;
  peopleState.loadedAt = Date.now();
  renderPeopleBody(root);
}

/* ===================== PHÂN QUYỀN ===================== */

var ACCOUNT_PAGE_SIZE = 20;
function emptyPickerState(){ return { search:'', department:'', branch:'', rows:[], loading:false, error:'', searchTimer:null }; }
var permState = {
  grants:[], presets:[], accounts:[], loading:false,
  selectedAccountId:'', accountSearch:'', accountPage:0,
  editing:null, saving:false, advancedOpen:false, incomeConfigOpen:false,
  subordinate: emptyPickerState(),
  incomeEmp: emptyPickerState()
};

function emptyGrantFor(acc){
  return { id:null, accountId:acc.id, employeeCode:acc.employeeCode||'', employeeName:acc.name||'', presetCode:'', capabilities:{}, peopleScope:{type:'self',values:[]}, reason:'', isActive:true };
}

/* Chọn 1 tài khoản ở cột trái -> nạp đúng grant đang có (nếu có) làm state
   sống duy nhất (permState.editing) cho cột phải. Không tạo dữ liệu giả -
   tài khoản chưa có grant thì bắt đầu từ khung rỗng, chưa chọn vai trò nào.
   incomeConfigOpen mặc định MỞ nếu tài khoản đã có income_view+incomeScope
   thật (đúng yêu cầu read-back "phải đọc lại đúng"), đóng nếu chưa cấu hình. */
function selectAccount(root, accountId){
  var acc = permState.accounts.find(function(a){ return a.id===accountId; });
  if(!acc) return;
  permState.selectedAccountId = accountId;
  var grant = permState.grants.find(function(g){ return g.accountId===accountId; });
  permState.editing = grant
    ? Object.assign({}, grant, { capabilities: Object.assign({}, grant.capabilities), peopleScope: Object.assign({}, grant.peopleScope) })
    : emptyGrantFor(acc);
  var g = permState.editing;
  permState.subordinate = emptyPickerState();
  permState.incomeEmp = emptyPickerState();
  permState.advancedOpen = false;
  permState.incomeConfigOpen = !!(g.capabilities && g.capabilities.income_view && g.capabilities.incomeScope);
  renderPermissionsBody(root);
  if(businessRoleForAccount(acc, g)==='tbp') loadSubordinates(root);
  if(g.capabilities && g.capabilities.income_view && g.capabilities.incomeScope && g.capabilities.incomeScope.type==='employees') loadIncomeEmp(root);
}

/* ---- Picker nhân sự dùng chung (search + Phòng ban/Chi nhánh từ dữ liệu
   thật, không nhập tay) — dùng cho cả "Nhân viên cấp dưới" (TBP) và "Chọn
   nhân sự cụ thể" (phạm vi Thu nhập). prefix phân biệt data-attribute giữa
   2 nơi dùng để không giẫm chân nhau trong cùng 1 DOM. Danh mục Phòng ban/
   Chi nhánh derive từ chính roster đã tải (đúng kỹ thuật peopleFilterBar()
   đang dùng ở tab Nhân sự) — không hard-code, không API danh mục riêng. */
function employeePickerFiltersHtml(prefix, state){
  var departments = Array.from(new Set(state.rows.map(function(r){ return r.department; }).filter(Boolean))).sort();
  var branches = Array.from(new Set(state.rows.map(function(r){ return r.branch; }).filter(Boolean))).sort();
  var deptOptions = '<option value="">Tất cả phòng ban</option>' + departments.map(function(d){ return '<option value="'+esc(d)+'"'+(state.department===d?' selected':'')+'>'+esc(d)+'</option>'; }).join('');
  var branchOptions = '<option value="">Tất cả chi nhánh</option>' + branches.map(function(b){ return '<option value="'+esc(b)+'"'+(state.branch===b?' selected':'')+'>'+esc(b)+'</option>'; }).join('');
  return '' +
    '<div class="phfk-perm-picker-filters">' +
      '<input type="search" class="phfk-input" placeholder="Tìm mã NV hoặc họ tên…" value="'+esc(state.search)+'" data-'+prefix+'-search>' +
      '<select class="phfk-input" data-'+prefix+'-department>'+deptOptions+'</select>' +
      '<select class="phfk-input" data-'+prefix+'-branch>'+branchOptions+'</select>' +
    '</div>';
}
function employeePickerListHtml(prefix, state, selectedValues){
  var selectedSet = {}; selectedValues.forEach(function(c){ selectedSet[String(c).toUpperCase()] = true; });
  if(state.loading) return '<div class="phfk-loading">Đang tải danh sách nhân sự…</div>';
  if(state.error) return '<p class="phfk-perm-subordinate-empty">'+esc(state.error)+'</p>';
  if(!state.rows.length) return '<p class="phfk-perm-subordinate-empty">Không tìm thấy nhân sự phù hợp.</p>';
  return '<div class="phfk-perm-subordinate-list">' + state.rows.map(function(p){
    var checked = selectedSet[String(p.employeeCode).toUpperCase()];
    return '<label class="phfk-perm-subordinate-row"><input type="checkbox" data-'+prefix+'-toggle="'+esc(p.employeeCode)+'"'+(checked?' checked':'')+'>' +
      '<span class="phfk-perm-subordinate-code">'+esc(p.employeeCode)+'</span>' +
      '<span class="phfk-perm-subordinate-name">'+esc(p.employeeName)+'</span>' +
      '<span class="phfk-perm-subordinate-dept">'+esc(p.department)+(p.branch?' · '+esc(p.branch):'')+'</span>' +
    '</label>';
  }).join('') + '</div>';
}
function bindEmployeePickerFilters(root, prefix, state, onChange){
  var search = root.querySelector('[data-'+prefix+'-search]');
  if(search) search.addEventListener('input', function(){
    state.search = search.value;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(onChange, 300);
  });
  var dept = root.querySelector('[data-'+prefix+'-department]');
  if(dept) dept.addEventListener('change', function(){ state.department = dept.value; onChange(); });
  var branch = root.querySelector('[data-'+prefix+'-branch]');
  if(branch) branch.addEventListener('change', function(){ state.branch = branch.value; onChange(); });
}
function bindEmployeePickerToggles(root, prefix, onToggle){
  root.querySelectorAll('[data-'+prefix+'-toggle]').forEach(function(box){
    box.addEventListener('change', function(){ onToggle(box.getAttribute('data-'+prefix+'-toggle'), box.checked); });
  });
}
function loadEmployeePicker(root, prefix, state, sectionSelector, refreshFn){
  state.loading = true; state.error = '';
  if(root.querySelector(sectionSelector)) refreshFn(root);
  apiPost('listKnlPeople', { search:state.search, department:state.department, branch:state.branch, status:'active' }).then(function(data){
    state.rows = data.people || []; state.loading = false;
    refreshFn(root);
  }).catch(function(e){
    state.rows = []; state.loading = false; state.error = e.message;
    refreshFn(root);
  });
}

/* ---- Cột trái: Chọn nhân sự (tài khoản Hub) ---- */
function filteredAccounts(){
  var search = (permState.accountSearch||'').trim().toLowerCase();
  if(!search) return permState.accounts;
  return permState.accounts.filter(function(a){
    return (String(a.name)+' '+String(a.email)+' '+String(a.employeeCode)+' '+String(a.position)).toLowerCase().indexOf(search) !== -1;
  });
}
function accountRoleBadgeHtml(acc){
  if(String(acc.role).toLowerCase()==='admin') return '<span class="phfk-badge phfk-badge-role is-admin">Admin</span>';
  var grant = permState.grants.find(function(g){ return g.accountId===acc.id; });
  if(!grant || grant.isActive===false) return '';
  var label = BUSINESS_ROLE_LABELS[roleKeyFromPreset(grant.presetCode)];
  return label ? '<span class="phfk-badge phfk-badge-role">'+esc(label)+'</span>' : '';
}
function accountPickerHtml(){
  var list = filteredAccounts();
  var totalPages = Math.max(1, Math.ceil(list.length / ACCOUNT_PAGE_SIZE));
  if(permState.accountPage >= totalPages) permState.accountPage = totalPages - 1;
  if(permState.accountPage < 0) permState.accountPage = 0;
  var pageItems = list.slice(permState.accountPage*ACCOUNT_PAGE_SIZE, permState.accountPage*ACCOUNT_PAGE_SIZE + ACCOUNT_PAGE_SIZE);
  var rowsHtml = pageItems.length ? pageItems.map(function(a){
    var selected = a.id === permState.selectedAccountId;
    return '<button type="button" class="phfk-perm-account-row'+(selected?' is-selected':'')+'" data-knl-select-account="'+esc(a.id)+'">' +
      '<span class="phfk-perm-account-main"><b>'+esc(a.name||a.email||'—')+'</b><small>'+esc(a.employeeCode||a.email||'')+(a.position?' · '+esc(a.position):'')+(a.department?' · '+esc(a.department):'')+'</small></span>' +
      accountRoleBadgeHtml(a) +
    '</button>';
  }).join('') : '<p class="phfk-perm-account-empty">Không tìm thấy nhân sự phù hợp.</p>';
  var pagination = totalPages>1 ? (
    '<div class="phfk-perm-account-pagination">' +
      '<button type="button" data-knl-account-page="-1"'+(permState.accountPage<=0?' disabled':'')+'>‹ Trước</button>' +
      '<span>Trang '+(permState.accountPage+1)+'/'+totalPages+'</span>' +
      '<button type="button" data-knl-account-page="1"'+(permState.accountPage>=totalPages-1?' disabled':'')+'>Sau ›</button>' +
    '</div>'
  ) : '';
  return '' +
    '<section class="phfk-panel phfk-perm-account-picker">' +
      '<div class="phfk-perm-picker-head"><small>1. CHỌN NHÂN SỰ</small></div>' +
      '<input type="search" class="phfk-input" placeholder="Tìm mã NV hoặc họ tên…" value="'+esc(permState.accountSearch)+'" data-knl-account-search>' +
      '<div class="phfk-perm-account-list">' + rowsHtml + '</div>' +
      pagination +
    '</section>';
}

/* ---- Cột phải: cấu hình quyền cho tài khoản đang chọn ---- */
function subordinatePickerHtml(){
  var s = permState.subordinate, g = permState.editing;
  var selected = (g && g.peopleScope && Array.isArray(g.peopleScope.values)) ? g.peopleScope.values : [];
  return '' +
    '<div class="phfk-field phfk-perm-subordinate" data-knl-subordinate-section>' +
      '<span>Nhân viên cấp dưới</span>' +
      employeePickerFiltersHtml('knl-subordinate', s) +
      employeePickerListHtml('knl-subordinate', s, selected) +
      '<p class="phfk-perm-subordinate-count" data-knl-subordinate-count>Đã chọn '+selected.length+' nhân viên</p>' +
    '</div>';
}
function incomeEmployeePickerHtml(){
  var s = permState.incomeEmp, g = permState.editing;
  var selected = (g && g.capabilities && g.capabilities.incomeScope && Array.isArray(g.capabilities.incomeScope.values)) ? g.capabilities.incomeScope.values : [];
  return '' +
    '<div class="phfk-perm-income-emp" data-knl-income-emp-section>' +
      employeePickerFiltersHtml('knl-income-emp', s) +
      employeePickerListHtml('knl-income-emp', s, selected) +
      '<p class="phfk-perm-subordinate-count" data-knl-income-emp-count>Đã chọn '+selected.length+' nhân sự</p>' +
    '</div>';
}

function advancedSectionHtml(g){
  var presetOptions = permState.presets.map(function(p){ return '<option value="'+esc(p.code)+'"'+(g.presetCode===p.code?' selected':'')+'>'+esc(p.name)+'</option>'; }).join('');
  var capabilityKeys = Object.keys(CAPABILITY_LABELS);
  var capabilityBoxes = capabilityKeys.map(function(key){
    var checked = g.capabilities && g.capabilities[key] ? ' checked' : '';
    return '<label class="phfk-check"><input type="checkbox" data-knl-adv-cap="'+key+'"'+checked+'> '+CAPABILITY_LABELS[key]+'</label>';
  }).join('');
  var scopeOptions = Object.keys(SCOPE_LABELS).map(function(t){ return '<option value="'+t+'"'+(g.peopleScope && g.peopleScope.type===t?' selected':'')+'>'+SCOPE_LABELS[t]+'</option>'; }).join('');
  var scopeValues = (g.peopleScope && Array.isArray(g.peopleScope.values)) ? g.peopleScope.values.join(', ') : '';
  var scopeType = g.peopleScope && g.peopleScope.type;
  var scopeValuesShown = scopeType==='department' || scopeType==='employees';
  var scopeValuesLabel = scopeType==='employees' ? 'Mã nhân sự (phân cách bởi dấu phẩy)' : 'Phòng ban (phân cách bởi dấu phẩy)';
  return '' +
    '<details class="phfk-perm-advanced" data-knl-advanced'+(permState.advancedOpen?' open':'')+'>' +
      '<summary>Thiết lập nâng cao</summary>' +
      '<div class="phfk-perm-advanced-body">' +
        '<label class="phfk-field"><span>Nhóm quyền (preset kỹ thuật)</span><select class="phfk-input" data-knl-adv-preset>'+presetOptions+'</select></label>' +
        '<div class="phfk-field"><span>Năng lực</span><div class="phfk-checklist">'+capabilityBoxes+'</div></div>' +
        '<label class="phfk-field"><span>Phạm vi Nhân sự (scope kỹ thuật)</span><select class="phfk-input" data-knl-adv-scope-type>'+scopeOptions+'</select></label>' +
        '<label class="phfk-field" data-knl-adv-scope-values-field'+(scopeValuesShown?'':' hidden')+'><span data-knl-adv-scope-values-label>'+esc(scopeValuesLabel)+'</span><input type="text" class="phfk-input" data-knl-adv-scope-values value="'+esc(scopeValues)+'"></label>' +
      '</div>' +
    '</details>';
}

/* Thu nhập: checkbox -> (nếu bật) link "Thiết lập phạm vi" -> (nếu mở) radio
   Tất cả nhân sự / Chọn nhân sự cụ thể -> (nếu specific) picker nhân sự.
   KHÔNG có trạng thái ngầm định "chưa chọn = tất cả" — cả 2 radio đều có
   thể để trống lúc mới bật, Lưu sẽ chặn (client + backend) tới khi chọn rõ. */
function incomeSectionHtml(g){
  var incomeChecked = !!(g.capabilities && g.capabilities.income_view);
  var scopeObj = g.capabilities && g.capabilities.incomeScope;
  var scopeType = scopeObj && scopeObj.type;
  var html = '<div class="phfk-field phfk-perm-income"><span>Quyền bổ sung</span>' +
    '<label class="phfk-check"><input type="checkbox" data-knl-income-view'+(incomeChecked?' checked':'')+'> Truy cập mục Thu nhập</label>';
  if(incomeChecked){
    html += '<button type="button" class="phfk-link phfk-perm-income-toggle" data-knl-income-config-toggle>'+(permState.incomeConfigOpen?'Ẩn phạm vi ▴':'Thiết lập phạm vi ▾')+'</button>';
    if(permState.incomeConfigOpen){
      html += '<div class="phfk-perm-income-config">' +
        '<small>PHẠM VI XEM THU NHẬP</small>' +
        '<label class="phfk-radio"><input type="radio" name="knl-income-scope-type" data-knl-income-scope-type value="all_company"'+(scopeType==='all_company'?' checked':'')+'> Tất cả nhân sự</label>' +
        '<label class="phfk-radio"><input type="radio" name="knl-income-scope-type" data-knl-income-scope-type value="employees"'+(scopeType==='employees'?' checked':'')+'> Chọn nhân sự cụ thể</label>' +
        (scopeType==='employees' ? incomeEmployeePickerHtml() : '') +
      '</div>';
    }
  }
  html += '</div>';
  return html;
}

function permConfigPanel(){
  if(!permState.selectedAccountId || !permState.editing) return '<section class="phfk-panel phfk-perm-config phfk-perm-config-empty"><p>Chọn một nhân sự bên trái để cấu hình quyền KNL.</p></section>';
  var acc = permState.accounts.find(function(a){ return a.id===permState.selectedAccountId; });
  if(!acc) return '';
  var g = permState.editing;
  var isHubAdmin = String(acc.role).toLowerCase()==='admin';
  var roleKey = businessRoleForAccount(acc, g);

  var head = '<div class="phfk-perm-config-head"><small>ĐANG CẤU HÌNH</small><h2>'+esc(acc.name||acc.email)+'</h2><p>'+esc(acc.employeeCode||acc.email||'')+(acc.position?' · '+esc(acc.position):'')+'</p></div>';

  var roleSection;
  if(isHubAdmin){
    roleSection = '<div class="phfk-perm-role-readonly"><small>VAI TRÒ KNL</small><strong>Admin</strong><p>Toàn quyền KNL theo tài khoản Hub (đường cứu hộ) — không cấu hình được ở màn này.</p></div>';
  }else{
    roleSection = '<div class="phfk-field"><span>Vai trò KNL</span><div class="phfk-perm-role-options">' +
      BUSINESS_ROLES.map(function(r){ return '<button type="button" class="phfk-perm-role-btn'+(roleKey===r.key?' active':'')+'" data-knl-role="'+r.key+'">'+esc(r.label)+'</button>'; }).join('') +
      '<button type="button" class="phfk-perm-role-btn is-disabled" disabled title="Cấp qua tài khoản Hub, không cấu hình ở đây">Admin</button>' +
      '</div>' +
      (roleKey==='unknown' ? '<p class="phfk-perm-role-hint">Tài khoản đang dùng cấu hình nâng cao (không khớp 3 vai trò trên) — chọn 1 vai trò để chuẩn hoá, hoặc xem "Thiết lập nâng cao".</p>' : '') +
    '</div>';
  }

  var subordinateSection = (!isHubAdmin && roleKey==='tbp') ? subordinatePickerHtml() : '';
  var incomeSection = incomeSectionHtml(g);
  var activeSection = isHubAdmin ? '' : '<label class="phfk-check phfk-perm-active-toggle"><input type="checkbox" data-knl-active'+(g.isActive!==false?' checked':'')+'> Đang cấp quyền KNL</label>';
  var reasonSection = '<label class="phfk-field phfk-perm-reason"><span>Lý do thay đổi quyền</span><textarea class="phfk-input" rows="2" placeholder="Ví dụ: Bổ nhiệm TBP Kho tháng 8" data-knl-reason>'+esc(g.reason||'')+'</textarea></label>';

  return '' +
    '<section class="phfk-panel phfk-perm-config">' +
      head + roleSection + subordinateSection + incomeSection + activeSection + reasonSection +
      '<p class="phfk-error" data-knl-form-error hidden></p>' +
      '<div class="phfk-form-actions"><button type="button" class="phfk-btn-primary" data-knl-save-grant'+(permState.saving?' disabled':'')+'>Lưu</button></div>' +
      advancedSectionHtml(g) +
    '</section>';
}

function renderPermissionsBody(root){
  var body = root.querySelector('[data-knl-body]');
  if(!body) return;
  body.innerHTML = '' +
    '<div class="phfk-page-head"><div><small>KNL &middot; PHÂN QUYỀN</small><h1>Phân quyền KNL</h1></div></div>' +
    (permState.loading ? '<div class="phfk-loading">Đang tải…</div>' : ('<div class="phfk-perm-workspace">' + accountPickerHtml() + permConfigPanel() + '</div>'));
  bindPermissionsForm(root);
}

/* Chỉ thay lại đúng khối picker (không render lại toàn bộ panel) để không
   mất focus ô tìm kiếm/vị trí cuộn khi gõ tìm, đổi filter hoặc tick. */
function refreshSubordinateSection(root){
  var section = root.querySelector('[data-knl-subordinate-section]');
  if(!section) return;
  var wrap = document.createElement('div');
  wrap.innerHTML = subordinatePickerHtml();
  section.replaceWith(wrap.firstElementChild);
  bindSubordinateSection(root);
}
function loadSubordinates(root){
  loadEmployeePicker(root, 'knl-subordinate', permState.subordinate, '[data-knl-subordinate-section]', refreshSubordinateSection);
}
function bindSubordinateSection(root){
  bindEmployeePickerFilters(root, 'knl-subordinate', permState.subordinate, function(){ loadSubordinates(root); });
  bindEmployeePickerToggles(root, 'knl-subordinate', function(code, checked){
    var g = permState.editing; if(!g) return;
    var values = (g.peopleScope && Array.isArray(g.peopleScope.values)) ? g.peopleScope.values.slice() : [];
    var upper = String(code).toUpperCase();
    var idx = values.findIndex(function(v){ return String(v).toUpperCase()===upper; });
    if(checked){ if(idx<0) values.push(code); }
    else if(idx>=0) values.splice(idx,1);
    g.peopleScope = { type:'employees', values:values };
    var countEl = root.querySelector('[data-knl-subordinate-count]');
    if(countEl) countEl.textContent = 'Đã chọn '+values.length+' nhân viên';
  });
}

function refreshIncomeEmpSection(root){
  var section = root.querySelector('[data-knl-income-emp-section]');
  if(!section) return;
  var wrap = document.createElement('div');
  wrap.innerHTML = incomeEmployeePickerHtml();
  section.replaceWith(wrap.firstElementChild);
  bindIncomeEmpSection(root);
}
function loadIncomeEmp(root){
  loadEmployeePicker(root, 'knl-income-emp', permState.incomeEmp, '[data-knl-income-emp-section]', refreshIncomeEmpSection);
}
function bindIncomeEmpSection(root){
  bindEmployeePickerFilters(root, 'knl-income-emp', permState.incomeEmp, function(){ loadIncomeEmp(root); });
  bindEmployeePickerToggles(root, 'knl-income-emp', function(code, checked){
    var g = permState.editing; if(!g) return;
    var scopeObj = (g.capabilities && g.capabilities.incomeScope) || { type:'employees', values:[] };
    var values = Array.isArray(scopeObj.values) ? scopeObj.values.slice() : [];
    var upper = String(code).toUpperCase();
    var idx = values.findIndex(function(v){ return String(v).toUpperCase()===upper; });
    if(checked){ if(idx<0) values.push(code); }
    else if(idx>=0) values.splice(idx,1);
    g.capabilities = Object.assign({}, g.capabilities, { incomeScope:{ type:'employees', values:values } });
    var countEl = root.querySelector('[data-knl-income-emp-count]');
    if(countEl) countEl.textContent = 'Đã chọn '+values.length+' nhân sự';
  });
}

/* g (permState.editing) LUÔN là nguồn dữ liệu sống duy nhất — mọi control (vai
   trò, tick cấp dưới, quyền bổ sung, nâng cao) mutate thẳng vào g khi người
   dùng thao tác, không có bước "đọc lại toàn bộ form" riêng lúc Lưu. */
function bindPermissionsForm(root){
  var accountSearch = root.querySelector('[data-knl-account-search]');
  if(accountSearch) accountSearch.addEventListener('input', function(){
    permState.accountSearch = accountSearch.value;
    permState.accountPage = 0;
    renderPermissionsBody(root);
  });
  root.querySelectorAll('[data-knl-account-page]').forEach(function(btn){
    btn.addEventListener('click', function(){
      permState.accountPage += Number(btn.getAttribute('data-knl-account-page'));
      renderPermissionsBody(root);
    });
  });
  root.querySelectorAll('[data-knl-select-account]').forEach(function(btn){
    btn.addEventListener('click', function(){ selectAccount(root, btn.getAttribute('data-knl-select-account')); });
  });

  root.querySelectorAll('[data-knl-role]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var g = permState.editing; if(!g) return;
      var roleDef = BUSINESS_ROLES.find(function(r){ return r.key===btn.getAttribute('data-knl-role'); });
      if(!roleDef) return;
      g.presetCode = roleDef.presetCode;
      g.capabilities = Object.assign({}, g.capabilities, { access_knl:true, view_people:true });
      if(roleDef.key==='tbp') g.peopleScope = (g.peopleScope && g.peopleScope.type==='employees') ? g.peopleScope : { type:'employees', values:[] };
      else if(roleDef.key==='assistant') g.peopleScope = { type:'all_company', values:[] };
      else g.peopleScope = { type:'self', values:[] };
      renderPermissionsBody(root);
      if(roleDef.key==='tbp') loadSubordinates(root);
    });
  });

  bindSubordinateSection(root);
  bindIncomeEmpSection(root);

  /* Bật/tắt income_view đổi hẳn cấu trúc panel (hiện/ẩn link + radio + picker)
     nên cần render lại toàn bộ, không chỉ mutate — khác các checkbox/tick đơn
     lẻ khác. Tắt thì đóng luôn phần cấu hình (không giữ mở 1 khối rỗng). */
  var incomeBox = root.querySelector('[data-knl-income-view]');
  if(incomeBox) incomeBox.addEventListener('change', function(){
    var g = permState.editing; if(!g) return;
    g.capabilities = Object.assign({}, g.capabilities, { income_view: incomeBox.checked });
    if(!incomeBox.checked) permState.incomeConfigOpen = false;
    renderPermissionsBody(root);
  });
  var incomeConfigToggle = root.querySelector('[data-knl-income-config-toggle]');
  if(incomeConfigToggle) incomeConfigToggle.addEventListener('click', function(){
    permState.incomeConfigOpen = !permState.incomeConfigOpen;
    renderPermissionsBody(root);
  });
  root.querySelectorAll('[data-knl-income-scope-type]').forEach(function(radio){
    radio.addEventListener('change', function(){
      if(!radio.checked) return;
      var g = permState.editing; if(!g) return;
      var type = radio.value;
      var prior = (g.capabilities && g.capabilities.incomeScope && Array.isArray(g.capabilities.incomeScope.values)) ? g.capabilities.incomeScope.values : [];
      g.capabilities = Object.assign({}, g.capabilities, { incomeScope: { type:type, values: type==='employees' ? prior : [] } });
      renderPermissionsBody(root);
      if(type==='employees') loadIncomeEmp(root);
    });
  });

  var activeBox = root.querySelector('[data-knl-active]');
  if(activeBox) activeBox.addEventListener('change', function(){ if(permState.editing) permState.editing.isActive = activeBox.checked; });
  var reasonBox = root.querySelector('[data-knl-reason]');
  if(reasonBox) reasonBox.addEventListener('input', function(){ if(permState.editing) permState.editing.reason = reasonBox.value; });

  var advancedDetails = root.querySelector('[data-knl-advanced]');
  if(advancedDetails) advancedDetails.addEventListener('toggle', function(){ permState.advancedOpen = advancedDetails.open; });

  var advPreset = root.querySelector('[data-knl-adv-preset]');
  if(advPreset) advPreset.addEventListener('change', function(){
    var g = permState.editing; var preset = permState.presets.find(function(p){ return p.code===advPreset.value; });
    if(!g || !preset) return;
    g.presetCode = preset.code;
    g.capabilities = Object.assign({}, preset.capabilities);
    g.peopleScope = Object.assign({}, preset.peopleScope);
    permState.advancedOpen = true;
    renderPermissionsBody(root);
  });
  root.querySelectorAll('[data-knl-adv-cap]').forEach(function(box){
    box.addEventListener('change', function(){
      var g = permState.editing; if(!g) return;
      g.capabilities = Object.assign({}, g.capabilities); g.capabilities[box.getAttribute('data-knl-adv-cap')] = box.checked;
    });
  });
  var advScopeType = root.querySelector('[data-knl-adv-scope-type]');
  if(advScopeType) advScopeType.addEventListener('change', function(){
    var g = permState.editing; if(!g) return;
    g.peopleScope = { type: advScopeType.value, values: (g.peopleScope && g.peopleScope.values) || [] };
    permState.advancedOpen = true;
    renderPermissionsBody(root);
  });
  var advScopeValues = root.querySelector('[data-knl-adv-scope-values]');
  if(advScopeValues) advScopeValues.addEventListener('input', function(){
    var g = permState.editing; if(!g) return;
    g.peopleScope = { type: (g.peopleScope && g.peopleScope.type) || 'self', values: advScopeValues.value.split(',').map(function(v){ return v.trim(); }).filter(Boolean) };
  });

  var saveBtn = root.querySelector('[data-knl-save-grant]');
  if(saveBtn) saveBtn.addEventListener('click', function(){ saveGrant(root); });
}

async function saveGrant(root){
  var g = permState.editing;
  var errorEl = root.querySelector('[data-knl-form-error]');
  if(errorEl){ errorEl.hidden = true; errorEl.textContent = ''; }
  if(!g || !g.accountId){ if(errorEl){ errorEl.hidden=false; errorEl.textContent='Vui lòng chọn nhân sự.'; } return; }
  var acc = permState.accounts.find(function(a){ return a.id===g.accountId; });
  var isHubAdmin = !!(acc && String(acc.role).toLowerCase()==='admin');
  if(!isHubAdmin && !g.presetCode){ if(errorEl){ errorEl.hidden=false; errorEl.textContent='Vui lòng chọn vai trò KNL.'; } return; }
  if(g.capabilities && g.capabilities.income_view){
    var incomeScopeCheck = g.capabilities.incomeScope;
    if(!incomeScopeCheck || !incomeScopeCheck.type){ if(errorEl){ errorEl.hidden=false; errorEl.textContent='Vui lòng chọn phạm vi xem Thu nhập (Tất cả nhân sự hoặc Chọn nhân sự cụ thể).'; } return; }
    if(incomeScopeCheck.type==='employees' && (!Array.isArray(incomeScopeCheck.values) || !incomeScopeCheck.values.length)){ if(errorEl){ errorEl.hidden=false; errorEl.textContent='Vui lòng chọn ít nhất một nhân sự cho phạm vi Thu nhập.'; } return; }
  }
  if(!g.reason || g.reason.trim().length<5){ if(errorEl){ errorEl.hidden=false; errorEl.textContent='Vui lòng nhập lý do (tối thiểu 5 ký tự).'; } return; }
  var saveBtn = root.querySelector('[data-knl-save-grant]');
  if(saveBtn) saveBtn.disabled = true;
  permState.saving = true;
  try{
    var payload = {
      id: g.id, accountId: g.accountId, employeeCode: g.employeeCode, employeeName: g.employeeName,
      presetCode: g.presetCode || 'CUSTOM', capabilities: g.capabilities, peopleScope: g.peopleScope,
      reason: g.reason, isActive: g.isActive !== false
    };
    var response = await apiPost('upsertKnlPermissionGrant', { grant: payload });
    var saved = response.grant;
    var idx = permState.grants.findIndex(function(x){ return x.accountId===saved.accountId; });
    if(idx>=0) permState.grants[idx] = saved; else permState.grants.push(saved);
    /* Nạp lại editing TỪ ĐÚNG dữ liệu backend vừa trả (không phải state cũ ở
       client) — đây là lúc reservedEmployees (nếu có) đã được engine 1.44.8
       tự phục hồi vào values, UI phải phản ánh đúng ngay, không cần F5. */
    permState.editing = Object.assign({}, saved, { capabilities:Object.assign({}, saved.capabilities), peopleScope:Object.assign({}, saved.peopleScope) });
    permState.incomeConfigOpen = !!(saved.capabilities && saved.capabilities.income_view && saved.capabilities.incomeScope);
    permState.saving = false;
    renderPermissionsBody(root);
    if(roleKeyFromPreset(saved.presetCode)==='tbp') loadSubordinates(root);
    if(saved.capabilities && saved.capabilities.income_view && saved.capabilities.incomeScope && saved.capabilities.incomeScope.type==='employees') loadIncomeEmp(root);
  }catch(e){
    permState.saving = false;
    if(saveBtn) saveBtn.disabled = false;
    var errorEl2 = root.querySelector('[data-knl-form-error]');
    if(errorEl2){ errorEl2.hidden = false; errorEl2.textContent = e.message; }
  }
}

async function loadPermissions(root){
  permState.loading = true;
  renderPermissionsBody(root);
  try{
    var permissionData = await Promise.all([apiPost('listKnlPermissionGrants'),apiPost('listKnlAccountsForPermission')]);
    var grantData = permissionData[0];
    permState.grants = grantData.grants || [];
    permState.presets = grantData.presets || [];
    var accountData = permissionData[1];
    permState.accounts = accountData.accounts || [];
  }catch(e){
    permState.loading = false;
    var body = root.querySelector('[data-knl-body]');
    if(body) body.innerHTML = '<div class="phfk-page-head"><div><small>KNL &middot; PHÂN QUYỀN</small><h1>Phân quyền KNL</h1></div></div>' + noAccessSection(e.message);
    return;
  }
  permState.loading = false;
  /* Đọc lại đúng từ backend mỗi lần vào tab — không giữ selectedAccountId
     giả qua lượt tải mới (F5/deep-link luôn bắt đầu từ chưa chọn ai, đúng
     yêu cầu "không giữ state giả ở frontend"). */
  permState.selectedAccountId = '';
  permState.editing = null;
  renderPermissionsBody(root);
}

/* ===================== BỘ KNL / DRAFT STRUCTURE (BATCH 1) ===================== */

var frameworkState={frameworks:[],selectedVersionId:'',detail:null,loading:false,loaded:false,loadedAt:0,error:''};
function statusLabel(value){return value==='published'?'Đã phát hành':(value==='inactive'?'Ngừng áp dụng':'Bản nháp');}
function findFrameworkForVersion(versionId){return frameworkState.frameworks.find(function(f){return (f.versions||[]).some(function(v){return v.id===versionId;});});}
function orderedActive(rows){return (rows||[]).filter(function(row){return row.isActive!==false;}).slice().sort(function(a,b){return a.sortOrder-b.sortOrder;});}
function frameworkListHtml(){
  if(!frameworkState.frameworks.length)return '<div class="phfk-framework-empty">Chưa có bộ KNL. Batch này không nạp dữ liệu demo.</div>';
  return frameworkState.frameworks.map(function(f){
    var versions=f.versions||[];
    return '<section class="phfk-framework-card"><div><b>'+esc(f.name)+'</b><small>'+esc(f.code)+' · '+statusLabel(f.status)+'</small></div>'+
      '<div class="phfk-version-list">'+versions.map(function(v){return '<button type="button" class="phfk-version-btn'+(frameworkState.selectedVersionId===v.id?' active':'')+'" data-knl-version="'+esc(v.id)+'">v'+v.versionNumber+' · '+esc(v.name)+'<small>'+statusLabel(v.status)+(v.isLocked?' · Đã khóa':'')+'</small></button>';}).join('')+'</div></section>';
  }).join('');
}
function structureColumnsHtml(detail){
  var columns=orderedActive(detail.columns),mutable=detail.version.status==='draft'&&!detail.version.isLocked;
  return '<section class="phfk-panel phfk-structure-panel"><div class="phfk-section-head"><div><small>HÀNG 4</small><h2>Cấu hình cột & mức độ</h2></div>'+(mutable?'<button class="phfk-btn-secondary" type="button" data-knl-add-column>+ Thêm cột</button>':'')+'</div>'+
    '<div class="phfk-column-chips">'+columns.map(function(c,index){return '<div class="phfk-column-chip"><span><b>'+esc(c.label)+'</b><small>'+esc(c.type==='level'?'Mức '+c.levelNumber:(c.type==='description'?'Mô tả tùy chọn':'Hạng mục'))+'</small></span>'+(mutable?'<span class="phfk-mini-actions"><button data-knl-column-move="'+esc(c.id)+'" data-direction="-1"'+(index===0?' disabled':'')+'>←</button><button data-knl-column-move="'+esc(c.id)+'" data-direction="1"'+(index===columns.length-1?' disabled':'')+'>→</button><button data-knl-edit-column="'+esc(c.id)+'">Sửa</button><button data-knl-delete="column:'+esc(c.id)+'">Xóa</button></span>':'')+'</div>';}).join('')+'</div></section>';
}
function competencyTableHtml(detail){
  var columns=orderedActive(detail.columns),groups=orderedActive(detail.groups),items=orderedActive(detail.items),mutable=detail.version.status==='draft'&&!detail.version.isLocked;
  var itemColumn=columns.find(function(c){return c.type==='item';}),descriptionColumn=columns.find(function(c){return c.type==='description';}),levels=columns.filter(function(c){return c.type==='level';});
  var contentMap={};(detail.levelContents||[]).forEach(function(x){contentMap[x.itemId+':'+x.columnId]=x.content||'';});
  return '<section class="phfk-panel phfk-structure-panel"><div class="phfk-section-head"><div><small>CẤU TRÚC DRAFT</small><h2>Nhóm & hạng mục năng lực</h2></div>'+(mutable?'<button class="phfk-btn-primary" type="button" data-knl-add-group>+ Thêm nhóm</button>':'')+'</div>'+
    (!itemColumn?'<p class="phfk-warning">Draft đang thiếu cột Hạng mục. Thêm lại trước khi phát hành.</p>':'')+
    groups.map(function(g,gIndex){var groupItems=items.filter(function(i){return i.groupId===g.id;});return '<article class="phfk-group-block"><header><div><b>'+esc(g.name)+'</b><small>'+esc(g.description||'Không có mô tả nhóm')+'</small></div>'+(mutable?'<span class="phfk-mini-actions"><button data-knl-group-move="'+esc(g.id)+'" data-direction="-1"'+(gIndex===0?' disabled':'')+'>↑</button><button data-knl-group-move="'+esc(g.id)+'" data-direction="1"'+(gIndex===groups.length-1?' disabled':'')+'>↓</button><button data-knl-edit-group="'+esc(g.id)+'">Sửa</button><button data-knl-add-item="'+esc(g.id)+'">+ Hạng mục</button><button data-knl-delete="group:'+esc(g.id)+'">Xóa</button></span>':'')+'</header>'+
      '<div class="phfk-dynamic-table-wrap"><table class="phfk-dynamic-table"><thead><tr>'+(itemColumn?'<th>'+esc(itemColumn.label)+'</th>':'')+(descriptionColumn?'<th>'+esc(descriptionColumn.label)+'</th>':'')+levels.map(function(c){return '<th>'+esc(c.label)+'</th>';}).join('')+(mutable?'<th>Thao tác</th>':'')+'</tr></thead><tbody>'+
      (groupItems.length?groupItems.map(function(item,index){return '<tr>'+(itemColumn?'<td><b>'+esc(item.name)+'</b></td>':'')+(descriptionColumn?'<td>'+esc(item.description||'—')+'</td>':'')+levels.map(function(c){return '<td>'+(mutable?'<textarea data-knl-level-content="'+esc(item.id)+':'+esc(c.id)+'" aria-label="'+esc(item.name+' - '+c.label)+'">'+esc(contentMap[item.id+':'+c.id]||'')+'</textarea>':esc(contentMap[item.id+':'+c.id]||'—'))+'</td>';}).join('')+(mutable?'<td><span class="phfk-mini-actions"><button data-knl-item-move="'+esc(item.id)+'" data-group-id="'+esc(g.id)+'" data-direction="-1"'+(index===0?' disabled':'')+'>↑</button><button data-knl-item-move="'+esc(item.id)+'" data-group-id="'+esc(g.id)+'" data-direction="1"'+(index===groupItems.length-1?' disabled':'')+'>↓</button><button data-knl-edit-item="'+esc(item.id)+'">Sửa</button><button data-knl-delete="item:'+esc(item.id)+'">Xóa</button></span></td>':'')+'</tr>';}).join(''):'<tr><td colspan="'+Math.max(1,(itemColumn?1:0)+(descriptionColumn?1:0)+levels.length+(mutable?1:0))+'">Chưa có hạng mục.</td></tr>')+'</tbody></table></div></article>';}).join('')+
    (!groups.length?'<div class="phfk-empty">Chưa có nhóm năng lực trong Draft.</div>':'')+'</section>';
}
function frameworkWorkspaceHtml(){
  var detail=frameworkState.detail;
  return frameworkDomainNav('bo-knl')+'<div class="phfk-page-head"><div><small>KNL · BATCH 1</small><h1>Bộ KNL & cấu trúc động</h1></div><button type="button" class="phfk-btn-primary" data-knl-create-framework>+ Tạo bộ KNL</button></div>'+
    '<p class="phfk-batch-note">Chỉ quản trị cấu trúc Draft. Không có Survey, Assessment, nhân sự, organization hay dữ liệu demo trong batch này.</p>'+
    '<div class="phfk-framework-workspace"><aside class="phfk-panel phfk-framework-list">'+frameworkListHtml()+'</aside><div class="phfk-framework-detail">'+
    (!detail?'<div class="phfk-empty">Chọn một version để quản trị cấu trúc.</div>':'<section class="phfk-panel phfk-version-head"><div><small>'+esc(detail.framework.code)+' · VERSION '+detail.version.versionNumber+'</small><h2>'+esc(detail.framework.name)+' — '+esc(detail.version.name)+'</h2><p>'+statusLabel(detail.framework.status)+' · '+statusLabel(detail.version.status)+(detail.version.isLocked?' · Version bất biến':' · Có thể chỉnh sửa')+'</p></div><div class="phfk-form-actions">'+(detail.version.status==='draft'&&!detail.version.isLocked?'<button class="phfk-btn-secondary" data-knl-publish-version>Phát hành & khóa</button>':'<button class="phfk-btn-primary" data-knl-clone-version>Tạo version mới</button>')+(detail.framework.status==='published'?'<button class="phfk-btn-secondary" data-knl-inactivate-framework>Ngừng áp dụng</button>':'')+'</div></section>'+structureColumnsHtml(detail)+competencyTableHtml(detail))+'</div></div>'+
    (frameworkState.error?'<p class="phfk-error">'+esc(frameworkState.error)+'</p>':'');
}
function renderFrameworkBody(root){var body=root.querySelector('[data-knl-body]');if(body)body.innerHTML=frameworkState.loading?'<div class="phfk-loading">Đang tải cấu trúc KNL…</div>':frameworkWorkspaceHtml();bindFrameworkEvents(root);}
async function loadFrameworkDetail(root,versionId){frameworkState.selectedVersionId=versionId||'';frameworkState.detail=null;if(!versionId){renderFrameworkBody(root);return;}frameworkState.loading=true;renderFrameworkBody(root);try{frameworkState.detail=await apiPost('getKnlFrameworkVersion',{versionId:versionId});frameworkState.error='';}catch(e){frameworkState.error=e.message;}frameworkState.loading=false;renderFrameworkBody(root);}
async function loadFrameworks(root){frameworkState.loading=true;renderFrameworkBody(root);try{var data=await apiPost('listKnlFrameworks');frameworkState.frameworks=data.frameworks||[];var exists=frameworkState.frameworks.some(function(f){return (f.versions||[]).some(function(v){return v.id===frameworkState.selectedVersionId;});});if(!exists){var first=frameworkState.frameworks.reduce(function(found,f){return found||(f.versions||[]).find(function(v){return v.status==='draft';})||(f.versions||[])[0];},null);frameworkState.selectedVersionId=first?first.id:'';}frameworkState.error='';frameworkState.loaded=true;frameworkState.loadedAt=Date.now();}catch(e){frameworkState.error=e.message;frameworkState.frameworks=[];}frameworkState.loading=false;if(frameworkState.selectedVersionId)return loadFrameworkDetail(root,frameworkState.selectedVersionId);renderFrameworkBody(root);}
function moveIds(rows,id,direction){var active=orderedActive(rows),index=active.findIndex(function(x){return x.id===id;}),target=index+Number(direction);if(index<0||target<0||target>=active.length)return null;var tmp=active[index];active[index]=active[target];active[target]=tmp;return active.map(function(x){return x.id;});}
async function runFrameworkAction(root,action,extra){frameworkState.error='';try{await apiPost(action,extra||{});await loadFrameworks(root);}catch(e){frameworkState.error=e.message;renderFrameworkBody(root);}}
function bindFrameworkEvents(root){
  bindFrameworkDomainNav(root);
  root.querySelectorAll('[data-knl-version]').forEach(function(el){el.addEventListener('click',function(){loadFrameworkDetail(root,el.getAttribute('data-knl-version'));});});
  var create=root.querySelector('[data-knl-create-framework]');if(create)create.addEventListener('click',async function(){var code=prompt('Mã bộ KNL (A-Z, 0-9, _ hoặc -):','');if(code===null)return;var name=prompt('Tên bộ KNL:','');if(name===null)return;var count=prompt('Số mức khởi tạo (có thể thêm/bớt ở Draft):','4');if(count===null)return;await runFrameworkAction(root,'createKnlFramework',{framework:{code:code,name:name,levelCount:Number(count),includeDescription:true}});});
  var addGroup=root.querySelector('[data-knl-add-group]');if(addGroup)addGroup.addEventListener('click',function(){var name=prompt('Tên nhóm năng lực:','');if(name)runFrameworkAction(root,'saveKnlGroup',{group:{versionId:frameworkState.selectedVersionId,name:name}});});
  root.querySelectorAll('[data-knl-edit-group]').forEach(function(el){el.addEventListener('click',function(){var row=frameworkState.detail.groups.find(function(x){return x.id===el.getAttribute('data-knl-edit-group');});var name=prompt('Tên nhóm năng lực:',row.name);if(name)runFrameworkAction(root,'saveKnlGroup',{group:{id:row.id,versionId:row.versionId,name:name,description:row.description}});});});
  root.querySelectorAll('[data-knl-add-item]').forEach(function(el){el.addEventListener('click',function(){var name=prompt('Tên hạng mục năng lực:','');if(name)runFrameworkAction(root,'saveKnlItem',{item:{versionId:frameworkState.selectedVersionId,groupId:el.getAttribute('data-knl-add-item'),name:name}});});});
  root.querySelectorAll('[data-knl-edit-item]').forEach(function(el){el.addEventListener('click',function(){var row=frameworkState.detail.items.find(function(x){return x.id===el.getAttribute('data-knl-edit-item');});var name=prompt('Tên hạng mục:',row.name);if(name===null||!name.trim())return;var description=prompt('Mô tả (tùy chọn):',row.description||'');if(description===null)return;runFrameworkAction(root,'saveKnlItem',{item:{id:row.id,versionId:row.versionId,groupId:row.groupId,name:name,description:description}});});});
  var addColumn=root.querySelector('[data-knl-add-column]');if(addColumn)addColumn.addEventListener('click',function(){var type=prompt('Loại cột: item / description / level','level');if(type===null)return;type=type.trim().toLowerCase();var levels=frameworkState.detail.columns.filter(function(c){return c.type==='level';});var levelNumber=type==='level'?Number(prompt('Số mức:',String(levels.length+1))):null;var label=prompt('Nhãn cột:',type==='level'?'MỨC ĐỘ '+levelNumber:(type==='description'?'MÔ TẢ':'HẠNG MỤC'));if(label)runFrameworkAction(root,'saveKnlColumn',{column:{versionId:frameworkState.selectedVersionId,type:type,label:label,levelNumber:levelNumber}});});
  root.querySelectorAll('[data-knl-edit-column]').forEach(function(el){el.addEventListener('click',function(){var row=frameworkState.detail.columns.find(function(x){return x.id===el.getAttribute('data-knl-edit-column');});var label=prompt('Nhãn cột:',row.label);if(label)runFrameworkAction(root,'saveKnlColumn',{column:{id:row.id,versionId:row.versionId,type:row.type,label:label,levelNumber:row.levelNumber}});});});
  root.querySelectorAll('[data-knl-delete]').forEach(function(el){el.addEventListener('click',function(){var parts=el.getAttribute('data-knl-delete').split(':');if(confirm('Xóa vật lý khỏi Draft chưa sử dụng?'))runFrameworkAction(root,'deleteKnlStructure',{entity:parts[0],id:parts[1]});});});
  root.querySelectorAll('[data-knl-group-move]').forEach(function(el){el.addEventListener('click',function(){var ids=moveIds(frameworkState.detail.groups,el.getAttribute('data-knl-group-move'),el.getAttribute('data-direction'));if(ids)runFrameworkAction(root,'reorderKnlStructure',{entity:'group',parentId:frameworkState.selectedVersionId,orderedIds:ids});});});
  root.querySelectorAll('[data-knl-item-move]').forEach(function(el){el.addEventListener('click',function(){var groupId=el.getAttribute('data-group-id'),ids=moveIds(frameworkState.detail.items.filter(function(x){return x.groupId===groupId;}),el.getAttribute('data-knl-item-move'),el.getAttribute('data-direction'));if(ids)runFrameworkAction(root,'reorderKnlStructure',{entity:'item',parentId:groupId,orderedIds:ids});});});
  root.querySelectorAll('[data-knl-column-move]').forEach(function(el){el.addEventListener('click',function(){var ids=moveIds(frameworkState.detail.columns,el.getAttribute('data-knl-column-move'),el.getAttribute('data-direction'));if(ids)runFrameworkAction(root,'reorderKnlStructure',{entity:'column',parentId:frameworkState.selectedVersionId,orderedIds:ids});});});
  root.querySelectorAll('[data-knl-level-content]').forEach(function(el){el.addEventListener('change',function(){var ids=el.getAttribute('data-knl-level-content').split(':');runFrameworkAction(root,'saveKnlLevelContent',{levelContent:{versionId:frameworkState.selectedVersionId,itemId:ids[0],columnId:ids[1],content:el.value}});});});
  var publish=root.querySelector('[data-knl-publish-version]');if(publish)publish.addEventListener('click',function(){if(confirm('Phát hành sẽ khóa bất biến version này. Tiếp tục?'))runFrameworkAction(root,'publishKnlVersion',{versionId:frameworkState.selectedVersionId});});
  var clone=root.querySelector('[data-knl-clone-version]');if(clone)clone.addEventListener('click',function(){var name=prompt('Tên version mới:',frameworkState.detail.version.name+' (bản mới)');if(name)runFrameworkAction(root,'cloneKnlVersion',{versionId:frameworkState.selectedVersionId,name:name});});
  var inactivate=root.querySelector('[data-knl-inactivate-framework]');if(inactivate)inactivate.addEventListener('click',function(){if(confirm('Ngừng áp dụng bộ KNL này? Version đã phát hành vẫn được giữ bất biến.'))runFrameworkAction(root,'saveKnlFramework',{framework:{id:frameworkState.detail.framework.id,name:frameworkState.detail.framework.name,description:frameworkState.detail.framework.description,status:'inactive'}});});
}

/* ===================== SOURCE THẬT + ASSIGNMENT (BATCH 2) ===================== */

var assignmentState={loading:false,loaded:false,loadedAt:0,preview:null,manifests:[],targets:{people:[],positions:[],organizationConflict:null},assignments:[],frameworks:[],error:'',result:''};
function assignmentVersionOptions(){var options=[];(assignmentState.frameworks||[]).forEach(function(f){(f.versions||[]).forEach(function(v){options.push('<option value="'+esc(v.id)+'">'+esc(f.name)+' · v'+v.versionNumber+' · '+statusLabel(v.status)+'</option>');});});return options.join('');}
function sourceRows(rows,statusClass){return (rows||[]).map(function(row){var saved=(assignmentState.manifests||[]).find(function(item){return item.manifestKey===row.manifestKey;});var label=saved?(saved.importStatus+' · '+saved.candidateStatus):(row.reason||'Sẵn sàng');return '<tr><td>'+esc(row.sourceSheet)+'</td><td>'+esc(row.sourcePosition||'—')+'</td><td>'+esc(row.levelCount||'—')+'</td><td><span class="phfk-source-status '+statusClass+'">'+esc(label)+'</span></td></tr>';}).join('');}
function assignmentPageHtml(){
  var p=assignmentState.preview||{totals:{},ready:[],needsReview:[],excluded:[]},t=assignmentState.targets||{},positionDisabled=!(t.positions||[]).length;
  var peopleOptions=(t.people||[]).map(function(person){return '<option value="'+esc(person.employeeCode)+'">'+esc(person.employeeCode+' · '+person.employeeName+' · '+(person.title||'Chưa có chức danh'))+'</option>';}).join('');
  var positionOptions=(t.positions||[]).map(function(pos){return '<option value="'+esc(pos.positionRef)+'">'+esc([pos.position,pos.department,pos.branch].filter(Boolean).join(' · '))+'</option>';}).join('');
  return frameworkDomainNav('gan-ap-dung')+'<div class="phfk-page-head"><div><small>KNL · BATCH 2</small><h1>Gán vị trí & áp dụng</h1></div></div>'+
    '<section class="phfk-panel phfk-source-panel"><div class="phfk-section-head"><div><small>SOURCE MANIFEST</small><h2>Nạp nội dung PHF đã chốt</h2></div><button type="button" class="phfk-btn-primary" data-knl-seed-source>Nạp / kiểm tra lại idempotent</button></div><p class="phfk-batch-note">Sẽ tạo '+Number(p.totals.frameworks||0)+' framework, '+Number(p.totals.groups||0)+' nhóm, '+Number(p.totals.items||0)+' hạng mục và '+Number(p.totals.contents||0)+' nội dung mức. Không tự chọn source đang conflict.</p>'+
    '<details open><summary>Sẵn sàng nạp ('+(p.ready||[]).length+')</summary><div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Source</th><th>Vị trí nguồn</th><th>Mức</th><th>Trạng thái</th></tr></thead><tbody>'+sourceRows(p.ready||[],'is-ready')+'</tbody></table></div></details>'+
    '<details><summary>Needs review ('+(p.needsReview||[]).length+')</summary><div class="phfk-table-wrap"><table class="phfk-table"><tbody>'+sourceRows(p.needsReview||[],'is-review')+'</tbody></table></div></details><p class="phfk-source-excluded">Loại khỏi scope: '+esc((p.excluded||[]).map(function(x){return x.sourceSheet;}).join(', '))+'</p></section>'+
    '<section class="phfk-panel"><div class="phfk-section-head"><div><small>ASSIGNMENT</small><h2>Gán version cho nhân sự hoặc vị trí</h2></div></div><form class="phfk-assignment-form" data-knl-assignment-form><label class="phfk-field"><span>Framework version</span><select class="phfk-input" name="versionId" required><option value="">Chọn version</option>'+assignmentVersionOptions()+'</select></label><label class="phfk-field"><span>Đối tượng</span><select class="phfk-input" name="targetType" data-knl-target-type><option value="employee">Nhân sự cụ thể</option><option value="position"'+(positionDisabled?' disabled':'')+'>Vị trí organization</option></select></label><label class="phfk-field" data-knl-employee-target><span>Nhân sự</span><select class="phfk-input" name="employeeRef"><option value="">Chọn employee_code</option>'+peopleOptions+'</select></label><label class="phfk-field" data-knl-position-target hidden><span>Vị trí</span><select class="phfk-input" name="positionRef"><option value="">Chọn position reference</option>'+positionOptions+'</select></label><label class="phfk-check"><input type="checkbox" name="isPrimary"> Khung chính</label><label class="phfk-field"><span>Lý do gán</span><input class="phfk-input" name="reason" required minlength="5" placeholder="Tối thiểu 5 ký tự"></label><button class="phfk-btn-primary" type="submit">Lưu assignment</button></form>'+
    (t.organizationConflict?'<p class="phfk-warning">Conflict organization: '+esc(t.organizationConflict.message)+'</p>':'')+'</section>'+
    '<section class="phfk-panel"><div class="phfk-section-head"><div><small>ĐANG ÁP DỤNG</small><h2>Assignment hiện có</h2></div></div><div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Framework</th><th>Version</th><th>Đối tượng</th><th>Chính/phụ</th><th>Trạng thái</th><th>Thu nhập</th></tr></thead><tbody>'+((assignmentState.assignments||[]).map(function(a){var snap=a.organizationSnapshot||{};return '<tr><td>'+esc(a.frameworkName||a.frameworkCode)+'</td><td>v'+esc(a.versionNumber)+'</td><td>'+esc(a.targetType==='employee'?(a.employeeCode+' · '+(snap.employeeName||'')):(snap.position||a.positionRef))+'</td><td>'+(a.isPrimary?'Chính':'Phụ')+'</td><td>'+esc(a.status)+'</td><td>'+(a.targetType==='employee'?'<button type="button" class="phfk-link" data-knl-assignment-income="'+esc(a.employeeCode)+'">Xem</button>':'—')+'</td></tr>';}).join('')||'<tr><td colspan="6">Chưa có assignment.</td></tr>')+'</tbody></table></div></section>'+
    (assignmentState.result?'<p class="phfk-success">'+esc(assignmentState.result)+'</p>':'')+(assignmentState.error?'<p class="phfk-error">'+esc(assignmentState.error)+'</p>':'');
}
function renderAssignmentBody(root){var body=root.querySelector('[data-knl-body]');if(body)body.innerHTML=assignmentState.loading?'<div class="phfk-loading">Đang tải source và assignment…</div>':assignmentPageHtml();bindAssignmentEvents(root);}
async function loadAssignments(root){assignmentState.loading=true;renderAssignmentBody(root);try{var results=await Promise.all([apiPost('previewKnlSourceSeed'),apiPost('listKnlAssignmentTargets'),apiPost('listKnlFrameworkAssignments'),apiPost('listKnlFrameworks'),apiPost('listKnlSourceManifests')]);assignmentState.preview=results[0];assignmentState.targets=results[1];assignmentState.assignments=results[2].assignments||[];assignmentState.frameworks=results[3].frameworks||[];assignmentState.manifests=results[4].manifests||[];assignmentState.error='';assignmentState.loaded=true;assignmentState.loadedAt=Date.now();}catch(e){assignmentState.error=e.message;}assignmentState.loading=false;renderAssignmentBody(root);}
function bindAssignmentEvents(root){
  bindFrameworkDomainNav(root);
  root.querySelectorAll('[data-knl-assignment-income]').forEach(function(button){button.addEventListener('click',function(){goIncomeEmployee(button.getAttribute('data-knl-assignment-income'));});});
  var seed=root.querySelector('[data-knl-seed-source]');if(seed)seed.addEventListener('click',async function(){if(!confirm('Nạp đúng 11 source READY? Các source NEEDS_REVIEW/EXCLUDED sẽ không được xử lý. Chạy lại sẽ không tạo duplicate.'))return;assignmentState.loading=true;renderAssignmentBody(root);try{var result=await apiPost('seedKnlSourceManifest');assignmentState.result='Seed hoàn tất: '+JSON.stringify(result.summary||{});assignmentState.error='';await loadAssignments(root);}catch(e){assignmentState.loading=false;assignmentState.error=e.message;renderAssignmentBody(root);}});
  var type=root.querySelector('[data-knl-target-type]');if(type)type.addEventListener('change',function(){var employee=root.querySelector('[data-knl-employee-target]'),position=root.querySelector('[data-knl-position-target]');if(employee)employee.hidden=type.value!=='employee';if(position)position.hidden=type.value!=='position';});
  var form=root.querySelector('[data-knl-assignment-form]');if(form)form.addEventListener('submit',async function(event){event.preventDefault();var data=new FormData(form),targetType=String(data.get('targetType')||'employee'),targetRef=targetType==='employee'?data.get('employeeRef'):data.get('positionRef');try{await apiPost('saveKnlFrameworkAssignment',{assignment:{versionId:data.get('versionId'),targetType:targetType,targetRef:targetRef,isPrimary:data.get('isPrimary')==='on',reason:data.get('reason')}});assignmentState.result='Đã lưu assignment theo version và '+(targetType==='employee'?'employee_code':'position reference')+'.';assignmentState.error='';await loadAssignments(root);}catch(e){assignmentState.error=e.message;renderAssignmentBody(root);}});
}

/* ===================== SURVEY V1 ===================== */
var surveyState={loading:false,loaded:false,loadedAt:0,campaigns:[],tickets:[],setup:null,detail:null,results:null,resultFilters:{},error:'',message:'',autosaveTimer:null};
function surveyNav(active){return '<nav class="phfk-domain-tabs" aria-label="Khảo sát & đánh giá"><button type="button" class="'+(active==='khao-sat'?'active':'')+'" data-survey-nav="khao-sat">Đợt khảo sát</button><button type="button" class="'+(active==='ket-qua-khao-sat'?'active':'')+'" data-survey-nav="ket-qua-khao-sat">Kết quả khảo sát</button></nav>';}
function bindSurveyNav(root){root.querySelectorAll('[data-survey-nav]').forEach(function(b){b.onclick=function(){goTab(b.getAttribute('data-survey-nav'));};});}
function fmtDate(v){if(!v)return '—';try{return new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short'}).format(new Date(v));}catch(e){return v;}}
function progressHtml(p){p=p||{};return '<div class="phfk-survey-progress"><span><b>'+Number(p.total||0)+'</b>Tổng phiếu</span><span><b>'+Number(p.notStarted||0)+'</b>Chưa làm</span><span><b>'+Number(p.inProgress||0)+'</b>Đang làm</span><span><b>'+Number(p.submitted||0)+'</b>Đã gửi</span><span><b>'+Number(p.overdue||0)+'</b>Quá hạn</span></div>';}
function surveyCampaignCards(){return surveyState.campaigns.map(function(c){var own=surveyState.tickets.filter(function(t){return t.campaignId===c.id;});return '<article class="phfk-panel phfk-survey-card"><header><div><small>'+esc(c.status)+'</small><h2>'+esc(c.name)+'</h2><p>'+fmtDate(c.startsAt)+' → '+fmtDate(c.endsAt)+'</p></div>'+(c.status==='DRAFT'?'<button class="phfk-btn-primary" data-open-survey="'+esc(c.id)+'">Mở khảo sát</button>':(c.status==='OPEN'?'<button class="phfk-btn-secondary" data-close-survey="'+esc(c.id)+'">Đóng đợt</button>':''))+'</header>'+progressHtml(c.progress)+'<div class="phfk-survey-ticket-list">'+(own.map(function(t){return '<button type="button" data-survey-ticket="'+esc(t.id)+'"><b>'+esc(t.frameworkSnapshot.frameworkName||'Bộ KNL')+' · v'+esc(t.frameworkSnapshot.versionNumber||'')+'</b><span>'+esc(t.employeeName)+' · '+esc(t.status)+'</span></button>';}).join('')||'<p>Chưa có phiếu trong phạm vi.</p>')+'</div></article>';}).join('')||'<section class="phfk-empty"><p>Chưa có đợt khảo sát.</p></section>';}
function campaignWizardHtml(){if(!surveyState.setup)return'';var versions=surveyState.setup.versions||[],people=surveyState.setup.people||[];function options(key,label){return '<option value="">Tất cả '+label+'</option>'+Array.from(new Set(people.map(function(p){return p[key];}).filter(Boolean))).sort().map(function(v){return '<option>'+esc(v)+'</option>';}).join('');}return '<details class="phfk-panel phfk-survey-create"><summary>Tạo đợt khảo sát mới</summary><form data-survey-campaign-form><div class="phfk-survey-steps"><b>Thông tin</b><b>Chọn Bộ KNL/version</b><b>Chọn đối tượng</b><b>Xem trước</b><b>Mở khảo sát</b></div><div class="phfk-assignment-form"><label class="phfk-field"><span>Tên đợt</span><input class="phfk-input" name="name" minlength="3" required></label><label class="phfk-field"><span>Mô tả</span><input class="phfk-input" name="description"></label><label class="phfk-field"><span>Bắt đầu</span><input class="phfk-input" type="datetime-local" name="startsAt" required></label><label class="phfk-field"><span>Hạn hoàn thành</span><input class="phfk-input" type="datetime-local" name="endsAt" required></label></div><fieldset><legend>Bộ KNL/version đã phát hành</legend><div class="phfk-survey-picks">'+versions.map(function(v){return '<label><input type="checkbox" name="versionId" value="'+esc(v.id)+'"> '+esc(v.frameworkName)+' · v'+esc(v.versionNumber)+'</label>';}).join('')+'</div></fieldset><div class="phfk-filters"><input class="phfk-input" type="search" placeholder="Nhân sự" data-survey-person-search><select class="phfk-input" data-survey-dept>'+options('department','phòng ban')+'</select><select class="phfk-input" data-survey-branch>'+options('branch','chi nhánh')+'</select><select class="phfk-input" data-survey-title>'+options('title','chức danh')+'</select><select class="phfk-input" data-survey-position>'+options('position','chức vụ')+'</select></div><fieldset><legend>Đối tượng từ organization hiện hành</legend><div class="phfk-survey-picks phfk-survey-people">'+people.map(function(p){return '<label data-survey-person-row data-search="'+esc((p.employeeCode+' '+p.employeeName).toLowerCase())+'" data-dept="'+esc(p.department)+'" data-branch="'+esc(p.branch)+'" data-title="'+esc(p.title)+'" data-position="'+esc(p.position)+'"><input type="checkbox" name="employeeCode" value="'+esc(p.employeeCode)+'"> <b>'+esc(p.employeeCode)+'</b> · '+esc(p.employeeName)+' <small>'+esc([p.department,p.branch,p.title,p.position].filter(Boolean).join(' · '))+'</small></label>';}).join('')+'</div></fieldset><div class="phfk-survey-preview" data-survey-preview>Chọn version và nhân sự để xem trước số phiếu thực tế.</div><div class="phfk-form-actions"><button class="phfk-btn-secondary" type="button" data-survey-preview-btn>Xem trước</button><button class="phfk-btn-primary" type="submit">Lưu Draft</button></div></form></details>';}
function renderSurveyList(root,isAdmin){var body=root.querySelector('[data-knl-body]');if(!body)return;body.innerHTML=surveyNav('khao-sat')+(isAdmin?campaignWizardHtml():'')+surveyCampaignCards()+(surveyState.message?'<p class="phfk-success">'+esc(surveyState.message)+'</p>':'')+(surveyState.error?'<p class="phfk-error">'+esc(surveyState.error)+'</p>':'');bindSurveyList(root,isAdmin);}
function selectedValues(form,name){return Array.from(form.querySelectorAll('[name="'+name+'"]:checked')).map(function(x){return x.value;});}
function bindSurveyList(root,isAdmin){bindSurveyNav(root);root.querySelectorAll('[data-survey-ticket]').forEach(function(b){b.onclick=function(){var u=new URL(location.href);u.searchParams.set('ticket',b.getAttribute('data-survey-ticket'));history.pushState({},'',u.pathname+u.search);loadSurveyTicket(root,b.getAttribute('data-survey-ticket'));};});root.querySelectorAll('[data-open-survey]').forEach(function(b){b.onclick=async function(){if(!confirm('Mở khảo sát và sinh các phiếu theo assignment hiện hành?'))return;try{var r=await apiPost('openKnlSurveyCampaign',{campaignId:b.getAttribute('data-open-survey')});surveyState.message='Đã mở khảo sát; tạo mới '+r.createdTickets+' phiếu (retry không tạo trùng).';await loadSurveyList(root,isAdmin);}catch(e){surveyState.error=e.message;renderSurveyList(root,isAdmin);}};});root.querySelectorAll('[data-close-survey]').forEach(function(b){b.onclick=async function(){if(!confirm('Đóng đợt sẽ khóa toàn bộ phiếu. Tiếp tục?'))return;try{await apiPost('closeKnlSurveyCampaign',{campaignId:b.getAttribute('data-close-survey')});await loadSurveyList(root,isAdmin);}catch(e){surveyState.error=e.message;renderSurveyList(root,isAdmin);}};});var form=root.querySelector('[data-survey-campaign-form]');if(!form)return;function filterPeople(){var q=String(root.querySelector('[data-survey-person-search]').value||'').toLowerCase(),d=root.querySelector('[data-survey-dept]').value,b=root.querySelector('[data-survey-branch]').value,t=root.querySelector('[data-survey-title]').value,p=root.querySelector('[data-survey-position]').value;root.querySelectorAll('[data-survey-person-row]').forEach(function(row){row.hidden=!!((q&&!row.dataset.search.includes(q))||(d&&row.dataset.dept!==d)||(b&&row.dataset.branch!==b)||(t&&row.dataset.title!==t)||(p&&row.dataset.position!==p));});}['[data-survey-person-search]','[data-survey-dept]','[data-survey-branch]','[data-survey-title]','[data-survey-position]'].forEach(function(s){var el=root.querySelector(s);el[el.tagName==='INPUT'?'oninput':'onchange']=filterPeople;});root.querySelector('[data-survey-preview-btn]').onclick=async function(){try{var r=await apiPost('getKnlSurveySetup',{versionIds:selectedValues(form,'versionId'),employeeCodes:selectedValues(form,'employeeCode')}),p=r.preview||{};root.querySelector('[data-survey-preview]').innerHTML='<b>'+Number(p.employeeCount||0)+'</b> nhân sự · <b>'+Number(p.versionCount||0)+'</b> framework/version · <b>'+Number(p.ticketCount||0)+'</b> phiếu thực tế sẽ sinh'+(p.unassignedCount?' · '+p.unassignedCount+' cặp không có assignment':'');}catch(e){root.querySelector('[data-survey-preview]').textContent=e.message;}};form.onsubmit=async function(ev){ev.preventDefault();var fd=new FormData(form);try{var r=await apiPost('saveKnlSurveyCampaign',{campaign:{name:fd.get('name'),description:fd.get('description'),startsAt:fd.get('startsAt'),endsAt:fd.get('endsAt'),versionIds:selectedValues(form,'versionId'),employeeCodes:selectedValues(form,'employeeCode')}});surveyState.message='Đã lưu Draft: '+r.preview.employeeCount+' nhân sự, '+r.preview.versionCount+' version, '+r.preview.ticketCount+' phiếu dự kiến.';await loadSurveyList(root,isAdmin);}catch(e){surveyState.error=e.message;renderSurveyList(root,isAdmin);}};}
async function loadSurveyList(root,isAdmin){surveyState.loading=true;try{var calls=[apiPost('listKnlSurveyCampaigns')];if(isAdmin)calls.push(apiPost('getKnlSurveySetup'));var r=await Promise.all(calls);surveyState.campaigns=r[0].campaigns||[];surveyState.tickets=r[0].tickets||[];surveyState.setup=isAdmin?r[1]:null;surveyState.error='';surveyState.loaded=true;surveyState.loadedAt=Date.now();}catch(e){surveyState.error=e.message;}surveyState.loading=false;renderSurveyList(root,isAdmin);}

function responseValue(itemId,key){var r=(surveyState.detail.responses||[]).find(function(x){return x.itemId===itemId;});return r?r[key]||'':'';}
function ticketFormHtml(){var d=surveyState.detail,t=d.ticket,c=d.campaign,answered=d.items.filter(function(i){return responseValue(i.id,'selectedColumnId')&&responseValue(i.id,'suitability');}).length;return '<button class="phfk-link" data-survey-back>← Danh sách phiếu</button><section class="phfk-panel phfk-survey-form-head"><small>'+esc(c.name)+'</small><h1>'+esc(t.frameworkSnapshot.frameworkName)+' · Version '+esc(t.frameworkSnapshot.versionNumber)+'</h1><p>Hạn hoàn thành: '+fmtDate(c.endsAt)+' · Tiến độ '+answered+'/'+d.items.length+(d.readOnly?' · Chỉ đọc':'')+'</p></section><form data-survey-ticket-form>'+d.groups.map(function(g){var items=d.items.filter(function(i){return i.groupId===g.id;});return '<section class="phfk-panel phfk-survey-group"><header><h2>'+esc(g.name)+'</h2><p>'+esc(g.description)+'</p></header>'+items.map(function(item){var selected=responseValue(item.id,'selectedColumnId'),suit=responseValue(item.id,'suitability'),comment=responseValue(item.id,'comment');return '<article class="phfk-survey-item" id="survey-item-'+esc(item.id)+'" data-survey-item="'+esc(item.id)+'"><h3>'+esc(item.name)+'</h3>'+(item.description?'<p>'+esc(item.description)+'</p>':'')+'<fieldset><legend>Mức tự đánh giá <em>*</em></legend><div class="phfk-level-options">'+d.levels.map(function(l){var content=(d.levelContents.find(function(x){return x.itemId===item.id&&x.columnId===l.id;})||{}).content||'Chưa có mô tả';return '<label title="'+esc(content)+'"><input type="radio" name="level-'+esc(item.id)+'" value="'+esc(l.id)+'" data-level-number="'+l.levelNumber+'"'+(selected===l.id?' checked':'')+(d.readOnly?' disabled':'')+'><b>Mức '+l.levelNumber+'</b><span>'+esc(content)+'</span></label>';}).join('')+'</div></fieldset><fieldset><legend>Mức phù hợp <em>*</em></legend><div class="phfk-suit-options">'+[['SUITABLE','Phù hợp'],['UNCLEAR','Chưa rõ'],['UNSUITABLE','Không phù hợp']].map(function(x){return '<label><input type="radio" name="suit-'+esc(item.id)+'" value="'+x[0]+'"'+(suit===x[0]?' checked':'')+(d.readOnly?' disabled':'')+'> '+x[1]+'</label>';}).join('')+'</div></fieldset><label class="phfk-field"><span>Góp ý <small>(bắt buộc nếu Chưa rõ/Không phù hợp)</small></span><textarea class="phfk-input" name="comment-'+esc(item.id)+'"'+(d.readOnly?' disabled':'')+'>'+esc(comment)+'</textarea></label><p class="phfk-error" data-item-error hidden></p></article>';}).join('')+'</section>';}).join('')+'<section class="phfk-panel"><label class="phfk-field"><span>Theo bạn, công việc/năng lực quan trọng nào của vị trí hiện chưa được phản ánh trong khung này?</span><textarea class="phfk-input" name="generalFeedback"'+(d.readOnly?' disabled':'')+'>'+esc(t.generalFeedback||'')+'</textarea></label></section>'+(d.readOnly?'': '<div class="phfk-survey-sticky"><span data-autosave-status></span><button type="button" class="phfk-btn-secondary" data-save-draft>Lưu nháp</button><button type="submit" class="phfk-btn-primary">'+(t.status==='SUBMITTED'?'Gửi lại phản hồi':'Gửi khảo sát')+'</button></div>')+'</form>'+(d.history.length?'<section class="phfk-panel"><h2>Lịch sử gửi</h2>'+d.history.map(function(h){return '<p>Lần '+h.revision+' · '+esc(h.action)+' · '+fmtDate(h.submitted_at)+' · '+esc(h.submitted_by_name||'')+'</p>';}).join('')+'</section>':'');}
function collectTicket(root,validate){var responses=[],firstInvalid=null;surveyState.detail.items.forEach(function(item){var block=root.querySelector('[data-survey-item="'+item.id+'"]'),level=block.querySelector('[name="level-'+item.id+'"]:checked'),suit=block.querySelector('[name="suit-'+item.id+'"]:checked'),comment=block.querySelector('[name="comment-'+item.id+'"]').value.trim(),invalid=validate&&(!level||!suit||((suit.value==='UNCLEAR'||suit.value==='UNSUITABLE')&&!comment));block.classList.toggle('is-invalid',!!invalid);var err=block.querySelector('[data-item-error]');err.hidden=!invalid;if(invalid)err.textContent=!level?'Vui lòng chọn mức tự đánh giá.':(!suit?'Vui lòng chọn mức phù hợp.':'Vui lòng nhập góp ý cho lựa chọn này.');if(invalid&&!firstInvalid)firstInvalid=block;responses.push({itemId:item.id,selectedColumnId:level?level.value:'',selectedLevelNumber:level?Number(level.dataset.levelNumber):null,suitability:suit?suit.value:'',comment:comment});});return{responses:responses,generalFeedback:root.querySelector('[name="generalFeedback"]').value.trim(),firstInvalid:firstInvalid};}
async function saveTicketFromForm(root,submit,silent){var payload=collectTicket(root,submit);if(payload.firstInvalid){payload.firstInvalid.scrollIntoView({behavior:'smooth',block:'center'});payload.firstInvalid.querySelector('input,textarea').focus();return false;}var status=root.querySelector('[data-autosave-status]');if(status)status.textContent=submit?'Đang gửi…':'Đang lưu…';try{await apiPost('saveKnlSurveyTicket',{ticketId:surveyState.detail.ticket.id,responses:payload.responses,generalFeedback:payload.generalFeedback,submit:submit});if(status)status.textContent=submit?'Đã gửi':'Đã tự động lưu';if(submit&&!silent){surveyState.message='Đã gửi phản hồi và lưu lịch sử revision.';await loadSurveyTicket(root,surveyState.detail.ticket.id);}return true;}catch(e){if(status)status.textContent=e.message;return false;}}
function bindTicket(root){var back=root.querySelector('[data-survey-back]');if(back)back.onclick=function(){var u=new URL(location.href);u.searchParams.delete('ticket');history.pushState({},'',u.pathname+u.search);if(surveyState.loaded&&Date.now()-surveyState.loadedAt<KNL_READ_CACHE_TTL)renderSurveyList(root,knlLastIsAdmin);else loadSurveyList(root,knlLastIsAdmin);};var form=root.querySelector('[data-survey-ticket-form]');if(!form||surveyState.detail.readOnly)return;form.onchange=function(){clearTimeout(surveyState.autosaveTimer);surveyState.autosaveTimer=setTimeout(function(){saveTicketFromForm(root,false,true);},900);};var save=root.querySelector('[data-save-draft]');if(save)save.onclick=function(){saveTicketFromForm(root,false,false);};form.onsubmit=function(e){e.preventDefault();saveTicketFromForm(root,true,false);};}
async function loadSurveyTicket(root,ticketId){try{surveyState.detail=await apiPost('getKnlSurveyTicket',{ticketId:ticketId});var body=root.querySelector('[data-knl-body]');body.innerHTML=ticketFormHtml();bindTicket(root);}catch(e){surveyState.error=e.message;renderSurveyList(root,false);}}

function resultFiltersHtml(r){var o=r.filterOptions||{},f=surveyState.resultFilters;function select(key,label,rows,value,labelFn){return '<select class="phfk-input" data-result-filter="'+key+'"><option value="">Tất cả '+label+'</option>'+rows.map(function(x){var v=value(x);return '<option value="'+esc(v)+'"'+(f[key]===v?' selected':'')+'>'+esc(labelFn(x))+'</option>';}).join('')+'</select>';}return '<div class="phfk-filters phfk-survey-result-filters">'+select('versionId','Bộ KNL',o.versions||[],function(x){return x.id;},function(x){return x.name+' · v'+x.versionNumber;})+select('department','phòng ban',o.departments||[],String,String)+select('branch','chi nhánh',o.branches||[],String,String)+select('title','chức danh',o.titles||[],String,String)+select('position','chức vụ',o.positions||[],String,String)+select('employeeCode','nhân sự',o.people||[],function(x){return x.employeeCode;},function(x){return x.employeeCode+' · '+x.employeeName;})+'</div>';}
function resultsHtml(){var r=surveyState.results;if(!r)return'<section class="phfk-empty"><p>Chọn một đợt để xem kết quả.</p></section>';var clone=r.canClone?'<section class="phfk-panel"><div class="phfk-section-head"><div><small>VERSIONING AN TOÀN</small><h2>Tạo Draft mới từ kết quả khảo sát</h2></div></div><div class="phfk-mini-actions">'+(r.versions||[]).map(function(v){return '<button type="button" data-clone-survey-version="'+esc(v.id)+'">Clone '+esc(v.frameworkName||v.name)+' · v'+esc(v.versionNumber)+'</button>';}).join('')+'</div></section>':'';return resultFiltersHtml(r)+progressHtml(r.progress)+'<section class="phfk-panel"><div class="phfk-section-head"><div><small>CHẤT LƯỢNG BỘ KNL</small><h2>Phản hồi theo hạng mục</h2></div><label class="phfk-check"><input type="checkbox" data-needs-review> Chỉ hiện Cần xem xét</label></div><div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Nhóm / Hạng mục</th><th>% Phù hợp</th><th>% Chưa rõ</th><th>% Không phù hợp</th><th>Phân bố mức</th><th>Góp ý</th></tr></thead><tbody>'+r.quality.map(function(q){return '<tr data-quality-row data-needs="'+q.needsReview+'"><td><details><summary><b>'+esc(q.groupName)+'</b><br>'+esc(q.itemName)+'</summary>'+q.details.map(function(d){return '<p><b>'+esc(d.employeeCode)+' · '+esc(d.employeeName)+'</b>: Mức '+esc(d.selectedLevelNumber)+' · '+esc(d.suitability)+(d.comment?' · '+esc(d.comment):'')+'</p>';}).join('')+'</details></td><td>'+q.suitablePct+'%</td><td>'+q.unclearPct+'%</td><td>'+q.unsuitablePct+'%</td><td>'+esc(Object.keys(q.levelDistribution).map(function(k){return 'M'+k+': '+q.levelDistribution[k];}).join(' · '))+'</td><td>'+q.commentCount+'</td></tr>';}).join('')+'</tbody></table></div></section>'+clone;}
async function loadSurveyResults(root){var body=root.querySelector('[data-knl-body]');try{var list=await apiPost('listKnlSurveyCampaigns'),campaignId=new URL(location.href).searchParams.get('campaign')||(list.campaigns[0]||{}).id;surveyState.campaigns=list.campaigns||[];if(campaignId)surveyState.results=await apiPost('getKnlSurveyResults',{campaignId:campaignId,filters:surveyState.resultFilters});body.innerHTML=surveyNav('ket-qua-khao-sat')+'<label class="phfk-field phfk-survey-result-select"><span>Đợt khảo sát</span><select class="phfk-input" data-result-campaign>'+surveyState.campaigns.map(function(c){return '<option value="'+esc(c.id)+'"'+(c.id===campaignId?' selected':'')+'>'+esc(c.name)+'</option>';}).join('')+'</select></label>'+resultsHtml();bindSurveyNav(root);var select=root.querySelector('[data-result-campaign]');if(select)select.onchange=function(){surveyState.resultFilters={};var u=new URL(location.href);u.searchParams.set('campaign',select.value);history.pushState({},'',u.pathname+u.search);loadSurveyResults(root);};root.querySelectorAll('[data-result-filter]').forEach(function(el){el.onchange=function(){surveyState.resultFilters[el.getAttribute('data-result-filter')]=el.value;loadSurveyResults(root);};});var review=root.querySelector('[data-needs-review]');if(review)review.onchange=function(){root.querySelectorAll('[data-quality-row]').forEach(function(row){row.hidden=review.checked&&row.dataset.needs!=='true';});};root.querySelectorAll('[data-clone-survey-version]').forEach(function(b){b.onclick=async function(){var name=prompt('Tên Draft mới:','Draft từ kết quả khảo sát');if(!name)return;try{await apiPost('cloneKnlSurveyVersionToDraft',{campaignId:campaignId,versionId:b.getAttribute('data-clone-survey-version'),name:name});alert('Đã tạo Draft mới; version đã khảo sát không bị thay đổi.');}catch(e){alert(e.message);}};});}catch(e){body.innerHTML=surveyNav('ket-qua-khao-sat')+noAccessSection(e.message);bindSurveyNav(root);}}

/* ===================== GRADE + EFFECTIVE VERSION + REFERENCE INCOME ===================== */

var foundationState={frameworks:[],detail:null,matrix:null,standards:null,preview:null,income:null,incomeTargets:[],incomeTargetsLoaded:false,incomeCanSelect:false,incomeIsAdmin:false,error:''};
var compensationState={standards:null,ladderId:'',versionId:'',pendingGrades:{},expandedGradeId:'',error:'',message:''};
var assignState={targets:[],targetsLoaded:false,standards:null,selectedCode:'',current:null,form:null,error:'',message:''};
var historyState={versionAudit:[],employeeHistory:[],employeeFilter:'',error:''};
function money(value){return new Intl.NumberFormat('vi-VN').format(Number(value||0))+' đ';}
function pctChange(base,value){base=Number(base);value=Number(value);if(!base)return 0;return (value-base)/base*100;}
function pctText(value){return (value>=0?'+':'')+value.toFixed(1)+'%';}
function foundationVersionOptions(){return (foundationState.frameworks||[]).reduce(function(rows,f){return rows.concat((f.versions||[]).map(function(v){return '<option value="'+esc(v.id)+'">'+esc(f.code+' · v'+v.versionNumber+' · '+v.name)+'</option>';}));},[]).join('');}
async function loadFoundationVersion(versionId){var id=versionId||new URL(location.href).searchParams.get('version');if(!foundationState.frameworks.length){var list=await apiPost('listKnlFrameworks');foundationState.frameworks=list.frameworks||[];}if(!id){var first=(foundationState.frameworks[0]&&foundationState.frameworks[0].versions||[])[0];id=first&&first.id;}if(!id)return null;var pair=await Promise.all([apiPost('getKnlFrameworkVersion',{versionId:id}),apiPost('getKnlGradeMatrix',{versionId:id})]);foundationState.detail=pair[0];foundationState.matrix=pair[1];return id;}
function gradeMatrixHtml(){var d=foundationState.detail,m=foundationState.matrix;if(!d||!m)return noAccessSection('Chưa có Framework Version để cấu hình.');var levels=orderedActive(d.columns).filter(function(c){return c.type==='level';}),items=orderedActive(d.items),grades=m.grades||[],byKey={};(m.requirements||[]).forEach(function(r){byKey[r.itemId+':'+r.gradeId]=r;});var warning=false;items.forEach(function(item){var prior=0;grades.forEach(function(g){var r=byKey[item.id+':'+g.id],n=Number(r&&r.requiredLevelNumber||1);if(prior&&n<prior)warning=true;prior=n;});});return frameworkDomainNav('tieu-chuan-bac')+'<div class="phfk-page-head"><div><small>KNL · GRADE STANDARD</small><h1>Tiêu chuẩn bậc năng lực</h1></div></div><label class="phfk-field phfk-foundation-select"><span>Framework Version</span><select class="phfk-input" data-foundation-version>'+foundationVersionOptions()+'</select></label><section class="phfk-panel"><div class="phfk-section-head"><div><small>'+esc(d.framework.code+' · v'+d.version.versionNumber)+'</small><h2>Item × Bậc = Mức bắt buộc</h2></div><button class="phfk-btn-primary" data-grade-save'+(!grades.length||d.version.lifecycleStatus!=='DRAFT'||d.version.isLocked?' disabled':'')+'>Lưu ma trận</button></div><p class="phfk-batch-note">Mỗi ô là yêu cầu độc lập; không tính trung bình. Số bậc B1..Bn và mức M1..Mn lấy động theo version.</p>'+(!grades.length?'<p class="phfk-warning">Version chưa có grade definitions. Không tự dựng B1–B4.</p>':'')+(warning?'<p class="phfk-warning">Có bậc sau thấp hơn bậc trước. Hệ thống chỉ cảnh báo, không tự sửa nghiệp vụ.</p>':'')+'<div class="phfk-dynamic-table-wrap"><table class="phfk-dynamic-table phfk-grade-table"><thead><tr><th>Hạng mục</th>'+grades.map(function(g){return'<th>'+esc(g.gradeCode)+'</th>';}).join('')+'</tr></thead><tbody>'+items.map(function(item){return'<tr><td><b>'+esc(item.name)+'</b></td>'+grades.map(function(g){var r=byKey[item.id+':'+g.id],selected=Number(r&&r.requiredLevelNumber||1);return'<td><select class="phfk-input" data-grade-cell="'+esc(item.id)+':'+esc(g.gradeCode)+'">'+levels.map(function(l){return'<option value="'+esc(l.id)+'|'+l.levelNumber+'"'+(l.levelNumber===selected?' selected':'')+'>M'+l.levelNumber+'</option>';}).join('')+'</select></td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div></section>'+(foundationState.error?'<p class="phfk-error">'+esc(foundationState.error)+'</p>':'');}
async function renderGradeMatrix(root,versionId){var body=root.querySelector('[data-knl-body]');try{var id=await loadFoundationVersion(versionId);body.innerHTML=gradeMatrixHtml();bindFrameworkDomainNav(root);var select=root.querySelector('[data-foundation-version]');if(select){select.value=id;select.onchange=function(){renderGradeMatrix(root,select.value);};}var save=root.querySelector('[data-grade-save]');if(save)save.onclick=async function(){var grades=foundationState.matrix.grades||[],requirements=[];root.querySelectorAll('[data-grade-cell]').forEach(function(el){var key=el.dataset.gradeCell.split(':'),value=el.value.split('|');requirements.push({itemId:key[0],gradeCode:key[1],requiredColumnId:value[0],requiredLevelNumber:Number(value[1])});});try{await apiPost('saveKnlGradeMatrix',{versionId:id,grades:grades,requirements:requirements});foundationState.matrix=null;await renderGradeMatrix(root,id);}catch(e){foundationState.error=e.message;body.innerHTML=gradeMatrixHtml();}};}catch(e){body.innerHTML=frameworkDomainNav('tieu-chuan-bac')+noAccessSection(e.message);bindFrameworkDomainNav(root);}}
function versionHistoryHtml(){return frameworkDomainNav('phien-ban-lich-su')+'<div class="phfk-page-head"><div><small>KNL · EFFECTIVE VERSION</small><h1>Phiên bản & lịch sử hiệu lực</h1></div></div><section class="phfk-panel"><div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Bộ KNL</th><th>Version</th><th>Content</th><th>Lifecycle</th><th>Hiệu lực từ</th><th>Thao tác</th></tr></thead><tbody>'+(foundationState.frameworks||[]).reduce(function(rows,f){return rows.concat((f.versions||[]).map(function(v){return'<tr><td>'+esc(f.code+' · '+f.name)+'</td><td>v'+v.versionNumber+' · '+esc(v.name)+'</td><td>'+esc(v.status)+(v.isLocked?' · locked':'')+'</td><td><span class="phfk-source-status is-ready">'+esc(v.lifecycleStatus)+'</span></td><td>'+esc(v.effectiveFrom||'—')+'</td><td>'+(v.status==='published'&&v.isLocked&&['DRAFT','SCHEDULED'].indexOf(v.lifecycleStatus)>=0?'<button class="phfk-btn-secondary" data-version-effective="'+esc(v.id)+'">Đặt hiệu lực</button>':'—')+'</td></tr>'; }));},[]).join('')+'</tbody></table></div></section>';}
async function renderVersionHistory(root){var body=root.querySelector('[data-knl-body]');try{var data=await apiPost('listKnlFrameworks');foundationState.frameworks=data.frameworks||[];body.innerHTML=versionHistoryHtml();bindFrameworkDomainNav(root);root.querySelectorAll('[data-version-effective]').forEach(function(btn){btn.onclick=async function(){var value=prompt('Thời điểm hiệu lực (ISO hoặc YYYY-MM-DD):','');if(!value)return;try{await apiPost('setKnlVersionEffectivity',{versionId:btn.dataset.versionEffective,effectiveFrom:value});await renderVersionHistory(root);}catch(e){alert(e.message);}};});}catch(e){body.innerHTML=frameworkDomainNav('phien-ban-lich-su')+noAccessSection(e.message);bindFrameworkDomainNav(root);}}
/* ===== Cơ cấu ngạch & bậc — Admin CRUD (versioned; Active/scheduled immutable, Draft only editable) ===== */
function compensationLadderList(){return (compensationState.standards&&compensationState.standards.ladders)||[];}
function compensationSelectedLadder(){var ladders=compensationLadderList();return ladders.find(function(l){return l.id===compensationState.ladderId;})||ladders[0]||null;}
function compensationSortedVersions(ladder){return ladder?(ladder.versions||[]).slice().sort(function(a,b){return b.version_number-a.version_number;}):[];}
function compensationSelectedVersion(ladder){var versions=compensationSortedVersions(ladder);if(!versions.length)return null;var byId=versions.find(function(v){return v.id===compensationState.versionId;});if(byId)return byId;var active=versions.find(function(v){return v.status==='ACTIVE';});return active||versions[0];}
function compensationSortedGrades(version){return version?(version.grades||[]).slice().sort(function(a,b){return a.grade_number-b.grade_number;}):[];}
function compensationGradeValue(g,field){var pending=compensationState.pendingGrades[g.id];if(pending&&pending[field]!=null)return Number(pending[field]);var map={baseSalary:'base_salary',hqcv:'hqcv',professionalAllowance:'professional_allowance',managementAllowance:'management_allowance'};return Number(g[map[field]]);}
function compensationDisplayGrades(grades){return grades.map(function(g){return{id:g.id,grade_code:g.grade_code,grade_number:g.grade_number,employeeCount:g.employeeCount,base_salary:compensationGradeValue(g,'baseSalary'),hqcv:compensationGradeValue(g,'hqcv'),professional_allowance:compensationGradeValue(g,'professionalAllowance'),management_allowance:compensationGradeValue(g,'managementAllowance')};});}
function compensationKpis(grades){if(!grades.length)return{min:'—',max:'—',totalPct:0,avgPct:0};var first=grades[0],last=grades[grades.length-1];var firstTotal=first.base_salary+first.hqcv,lastTotal=last.base_salary+last.hqcv;var steps=[];for(var i=1;i<grades.length;i++){var pt=grades[i-1].base_salary+grades[i-1].hqcv,t=grades[i].base_salary+grades[i].hqcv;steps.push(pctChange(pt,t));}return{min:first.grade_code,max:last.grade_code,totalPct:pctChange(firstTotal,lastTotal),avgPct:steps.length?steps.reduce(function(a,b){return a+b;},0)/steps.length:0};}
function compensationLadderSelectorHtml(ladders,selectedId){return '<div class="phfk-mini-actions phfk-comp-ladder-select">'+ladders.map(function(l){return '<button type="button" class="'+(l.id===selectedId?'is-active':'')+'" data-comp-select-ladder="'+esc(l.id)+'">'+esc(l.code)+'</button>';}).join('')+'</div>';}
function compensationVersionListHtml(ladder,selectedId){var versions=compensationSortedVersions(ladder);return '<div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Version</th><th>Kỳ hiệu lực</th><th>Trạng thái</th><th></th></tr></thead><tbody>'+versions.map(function(v){return '<tr'+(v.id===selectedId?' class="is-selected"':'')+'><td>v'+v.version_number+' · '+esc(v.name)+'</td><td>'+esc(v.effective_period||'—')+'</td><td><span class="phfk-source-status '+(v.status==='ACTIVE'?'is-ready':(v.status==='DRAFT'?'is-review':''))+'">'+esc(v.status)+'</span></td><td><button type="button" class="phfk-btn-secondary" data-comp-view-version="'+esc(v.id)+'">Xem</button></td></tr>';}).join('')+'</tbody></table></div>';}
function compensationGradeTableHtml(version,grades){
  var editable=version&&version.status==='DRAFT';
  var rows=grades.map(function(g,idx){
    var total=g.base_salary+g.hqcv,prev=idx>0?grades[idx-1]:null,prevTotal=prev?prev.base_salary+prev.hqcv:null;
    var pctBase=prev?pctChange(prev.base_salary,g.base_salary):null,pctHqcv=prev?pctChange(prev.hqcv,g.hqcv):null;
    var deltaTotal=prev?total-prevTotal:null,pctTotal=prev?pctChange(prevTotal,total):null;
    var warn=pctTotal!==null&&(pctTotal<0||pctTotal>50),expanded=compensationState.expandedGradeId===g.id;
    var row='<tr class="phfk-comp-grade-row'+(warn?' is-warning':'')+(expanded?' is-expanded':'')+'" data-comp-grade-row="'+esc(g.id)+'">'+
      '<td><b>'+esc(g.grade_code)+'</b></td><td>'+money(g.base_salary)+'</td><td>'+(pctBase===null?'—':pctText(pctBase))+'</td>'+
      '<td>'+money(g.hqcv)+'</td><td>'+(pctHqcv===null?'—':pctText(pctHqcv))+'</td><td>'+money(total)+'</td>'+
      '<td>'+(deltaTotal===null?'—':money(deltaTotal))+'</td><td>'+(pctTotal===null?'—':pctText(pctTotal)+(warn?' ⚠':''))+'</td>'+
      '<td>'+money(g.professional_allowance)+'</td><td>'+money(g.management_allowance)+'</td><td>'+Number(g.employeeCount||0)+'</td></tr>';
    if(expanded){
      row+='<tr class="phfk-comp-grade-detail"><td colspan="11"><div class="phfk-comp-grade-edit">'+(editable?(
        '<label class="phfk-field"><span>LCB</span><input type="number" min="0" step="1000" class="phfk-input" data-comp-edit="baseSalary" value="'+g.base_salary+'"></label>'+
        '<label class="phfk-field"><span>HQCV</span><input type="number" min="0" step="1000" class="phfk-input" data-comp-edit="hqcv" value="'+g.hqcv+'"></label>'+
        '<label class="phfk-field"><span>PC nghiệp vụ chuẩn</span><input type="number" min="0" step="1000" class="phfk-input" data-comp-edit="professionalAllowance" value="'+g.professional_allowance+'"></label>'+
        '<label class="phfk-field"><span>PC QL/trách nhiệm chuẩn</span><input type="number" min="0" step="1000" class="phfk-input" data-comp-edit="managementAllowance" value="'+g.management_allowance+'"></label>'
      ):(
        '<p class="phfk-batch-note">Version không phải Draft; chỉ xem. Bấm "Tạo phiên bản mới từ phiên bản này" để tạo Draft chỉnh sửa.</p>'+
        '<p>Tổng lương vị trí = LCB + HQCV = '+money(total)+'. PC nghiệp vụ/QL chuẩn chỉ áp dụng khi HR bật stick tương ứng lúc gán cho nhân viên.</p>'
      ))+'</div></td></tr>';
    }
    return row;
  }).join('');
  return '<div class="phfk-table-wrap"><table class="phfk-table phfk-comp-table"><thead><tr><th>Bậc</th><th>LCB</th><th>% tăng LCB</th><th>HQCV</th><th>% tăng HQCV</th><th>Tổng lương vị trí</th><th>Tăng so bậc trước</th><th>% tăng tổng</th><th>PC nghiệp vụ chuẩn</th><th>PC QL/trách nhiệm chuẩn</th><th>Số NV đang ở bậc</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
function compensationSlopeHtml(grades){if(grades.length<2)return'';var items=[];for(var i=1;i<grades.length;i++){var pt=grades[i-1].base_salary+grades[i-1].hqcv,t=grades[i].base_salary+grades[i].hqcv;items.push('<div class="phfk-comp-slope-item"><b>'+esc(grades[i-1].grade_code)+' → '+esc(grades[i].grade_code)+'</b><span>'+money(t-pt)+' · '+pctText(pctChange(pt,t))+'</span></div>');}return '<section class="phfk-panel"><div class="phfk-section-head"><h2>Độ dốc giữa các bậc</h2></div><div class="phfk-comp-slope">'+items.join('')+'</div></section>';}
function compensationStructureHtml(){
  var ladders=compensationLadderList();
  if(!ladders.length)return compensationDomainNav('ngach-bac-luong',true)+noAccessSection('Chưa có ngạch nào. Foundation chưa được seed.');
  var ladder=compensationSelectedLadder(),version=compensationSelectedVersion(ladder),rawGrades=compensationSortedGrades(version),grades=compensationDisplayGrades(rawGrades),kpi=compensationKpis(grades);
  var pendingCount=Object.keys(compensationState.pendingGrades).length,isDraft=version&&version.status==='DRAFT';
  return compensationDomainNav('ngach-bac-luong',true)+
    '<div class="phfk-page-head"><div><small>KNL · CƠ CẤU NGẠCH & BẬC</small><h1>'+esc(ladder?ladder.name:'')+' ('+esc(ladder?ladder.code:'')+')</h1></div>'+
      '<div class="phfk-mini-actions">'+(version?'<button type="button" class="phfk-btn-secondary" data-comp-clone-version="'+esc(version.id)+'">Tạo phiên bản mới từ phiên bản này</button>':'')+'</div></div>'+
    compensationLadderSelectorHtml(ladders,ladder?ladder.id:'')+
    '<section class="phfk-panel"><div class="phfk-section-head"><div><small>PHIÊN BẢN</small><h2>Version & lịch sử hiệu lực</h2></div></div>'+compensationVersionListHtml(ladder,version?version.id:'')+'</section>'+
    (version?(
      '<div class="phfk-foundation-kpis">'+
        '<section class="phfk-panel"><small>BẬC THẤP NHẤT · CAO NHẤT</small><b>'+esc(kpi.min)+' – '+esc(kpi.max)+'</b></section>'+
        '<section class="phfk-panel"><small>% TĂNG TOÀN THANG</small><b>'+pctText(kpi.totalPct)+'</b></section>'+
        '<section class="phfk-panel"><small>% TĂNG BÌNH QUÂN/BẬC</small><b>'+pctText(kpi.avgPct)+'</b></section>'+
        '<section class="phfk-panel"><small>TRẠNG THÁI</small><b>'+esc(version.status)+'</b></section></div>'+
      '<section class="phfk-panel"><div class="phfk-section-head"><div><small>v'+version.version_number+' · '+esc(version.name)+'</small><h2>Bảng bậc lương</h2></div>'+
        '<div class="phfk-mini-actions">'+
          (isDraft?'<button type="button" class="phfk-btn-primary" data-comp-save-grades'+(pendingCount?'':' disabled')+'>Lưu thay đổi ('+pendingCount+')</button>':'')+
          (isDraft?'<button type="button" class="phfk-btn-secondary" data-comp-schedule-version="'+esc(version.id)+'">Đặt hiệu lực</button>':'')+
        '</div></div>'+
      '<p class="phfk-batch-note">Bấm vào một bậc để xem cấu phần và (nếu Draft) chỉnh LCB/HQCV/PC chuẩn. Tổng lương vị trí = LCB + HQCV.</p>'+
      compensationGradeTableHtml(version,grades)+'</section>'+compensationSlopeHtml(grades)
    ):noAccessSection('Ngạch này chưa có version nào.'))+
    (compensationState.message?'<p class="phfk-success">'+esc(compensationState.message)+'</p>':'')+
    (compensationState.error?'<p class="phfk-error">'+esc(compensationState.error)+'</p>':'');
}
function bindCompensationStructure(root){
  bindCompensationDomainNav(root);
  root.querySelectorAll('[data-comp-select-ladder]').forEach(function(btn){btn.onclick=function(){compensationState.ladderId=btn.getAttribute('data-comp-select-ladder');compensationState.versionId='';compensationState.pendingGrades={};compensationState.expandedGradeId='';compensationState.message='';compensationState.error='';renderCompensationBody(root);};});
  root.querySelectorAll('[data-comp-view-version]').forEach(function(btn){btn.onclick=function(){compensationState.versionId=btn.getAttribute('data-comp-view-version');compensationState.pendingGrades={};compensationState.expandedGradeId='';compensationState.message='';compensationState.error='';renderCompensationBody(root);};});
  root.querySelectorAll('[data-comp-grade-row]').forEach(function(row){row.onclick=function(){var id=row.getAttribute('data-comp-grade-row');compensationState.expandedGradeId=compensationState.expandedGradeId===id?'':id;renderCompensationBody(root);};});
  root.querySelectorAll('[data-comp-edit]').forEach(function(input){input.addEventListener('change',function(){var gradeId=compensationState.expandedGradeId,field=input.getAttribute('data-comp-edit'),patch={};patch[field]=Number(input.value||0);compensationState.pendingGrades[gradeId]=Object.assign({},compensationState.pendingGrades[gradeId],patch);renderCompensationBody(root);});});
  var cloneBtn=root.querySelector('[data-comp-clone-version]');
  if(cloneBtn)cloneBtn.onclick=async function(){
    var name=prompt('Tên phiên bản Draft mới (bỏ trống để tự đặt tên):','');if(name===null)return;
    try{var r=await apiPost('cloneKnlCompensationVersion',{versionId:cloneBtn.getAttribute('data-comp-clone-version'),name:name});compensationState.standards=null;compensationState.versionId=r.version.id;compensationState.pendingGrades={};compensationState.expandedGradeId='';compensationState.message='Đã tạo Draft mới v'+r.version.versionNumber+'.';compensationState.error='';await renderCompensationStructure(root);}
    catch(e){compensationState.error=e.message;renderCompensationBody(root);}
  };
  var saveBtn=root.querySelector('[data-comp-save-grades]');
  if(saveBtn)saveBtn.onclick=async function(){
    var ladder=compensationSelectedLadder(),version=compensationSelectedVersion(ladder),grades=compensationSortedGrades(version);
    var payload=grades.map(function(g){return{id:g.id,baseSalary:compensationGradeValue(g,'baseSalary'),hqcv:compensationGradeValue(g,'hqcv'),professionalAllowance:compensationGradeValue(g,'professionalAllowance'),managementAllowance:compensationGradeValue(g,'managementAllowance')};});
    try{await apiPost('saveKnlCompensationGrades',{versionId:version.id,grades:payload});compensationState.pendingGrades={};compensationState.standards=null;compensationState.message='Đã lưu thay đổi bậc lương Draft.';compensationState.error='';await renderCompensationStructure(root);}
    catch(e){compensationState.error=e.message;renderCompensationBody(root);}
  };
  var scheduleBtn=root.querySelector('[data-comp-schedule-version]');
  if(scheduleBtn)scheduleBtn.onclick=async function(){
    var period=prompt('Kỳ hiệu lực áp dụng (YYYY-MM):','');if(!period)return;
    var effectiveFrom=prompt('Ngày hiệu lực (YYYY-MM-DD, để trống = ngày 01 của kỳ):','')||(period+'-01');
    try{var r=await apiPost('scheduleKnlCompensationVersion',{versionId:scheduleBtn.getAttribute('data-comp-schedule-version'),effectivePeriod:period,effectiveFrom:effectiveFrom});compensationState.standards=null;compensationState.message='Đã đặt hiệu lực: '+r.scheduled.status+' từ '+r.scheduled.effectiveFrom+'.';compensationState.error='';await renderCompensationStructure(root);}
    catch(e){compensationState.error=e.message;renderCompensationBody(root);}
  };
}
function renderCompensationBody(root){var body=root.querySelector('[data-knl-body]');body.innerHTML=compensationStructureHtml();bindCompensationStructure(root);}
async function renderCompensationStructure(root){var body=root.querySelector('[data-knl-body]');try{if(!compensationState.standards)compensationState.standards=await apiPost('listKnlCompensationStandards');renderCompensationBody(root);}catch(e){body.innerHTML=compensationDomainNav('ngach-bac-luong',true)+noAccessSection(e.message);bindCompensationDomainNav(root);}}
function incomePickerHtml(message){var people=foundationState.incomeTargets||[];return compensationDomainNav('co-cau-thu-nhap',foundationState.incomeIsAdmin)+'<div class="phfk-page-head"><div><small>KNL · THU NHẬP THAM CHIẾU</small><h1>Chọn nhân sự</h1><p>Danh sách được lọc theo quyền Thu nhập trên backend.</p></div></div>'+(message?'<p class="phfk-warning">'+esc(message)+'</p>':'')+'<section class="phfk-panel phfk-income-picker"><label class="phfk-field"><span>Tìm nhân sự</span><input type="search" class="phfk-input" data-knl-income-search placeholder="Mã NV, họ tên, phòng ban…"></label><div class="phfk-income-targets">'+people.map(function(p){return'<button type="button" data-knl-income-target="'+esc(p.employeeCode)+'" data-search="'+esc([p.employeeCode,p.employeeName,p.department,p.branch,p.title].join(' ').toLowerCase())+'"><b>'+esc(p.employeeName)+'</b><span>'+esc(p.employeeCode)+' · '+esc(p.title||p.department||'Nhân sự')+'</span><small>'+esc([p.department,p.branch].filter(Boolean).join(' · '))+'</small></button>';}).join('')+'</div>'+(people.length?'':'<p class="phfk-empty">Không có nhân sự nào trong phạm vi được phép xem.</p>')+'</section>';}
function bindIncomePicker(root){var search=root.querySelector('[data-knl-income-search]');if(search)search.addEventListener('input',function(){var q=String(search.value||'').trim().toLowerCase();root.querySelectorAll('[data-knl-income-target]').forEach(function(row){row.hidden=!!(q&&String(row.dataset.search||'').indexOf(q)===-1);});});root.querySelectorAll('[data-knl-income-target]').forEach(function(row){row.addEventListener('click',function(){goIncomeEmployee(row.getAttribute('data-knl-income-target'));});});}
async function showIncomePicker(root,message){var body=root.querySelector('[data-knl-body]');try{if(!foundationState.incomeTargetsLoaded){var result=await apiPost('listKnlIncomeTargets');foundationState.incomeTargets=result.people||[];foundationState.incomeTargetsLoaded=true;}body.innerHTML=incomePickerHtml(message);bindIncomePicker(root);bindCompensationDomainNav(root);}catch(e){body.innerHTML=noAccessSection(e.message);}}
function incomeHtml(){
  var i=foundationState.income,current=i&&i.current,nav=compensationDomainNav('co-cau-thu-nhap',foundationState.incomeIsAdmin),change=foundationState.incomeCanSelect?'<button type="button" class="phfk-btn-secondary" data-knl-change-income>Chọn nhân sự khác</button>':'';
  if(!current)return nav+'<div class="phfk-page-head"><div><small>KNL · CÁ NHÂN</small><h1>Bậc & Cơ cấu thu nhập</h1><p>'+esc(i&&i.employeeCode||'')+'</p></div>'+change+'</div>'+noAccessSection('Chưa có cơ cấu thu nhập tham chiếu đang áp dụng.');
  var isOfficial=current.employmentType==='OFFICIAL',totalPosition=current.baseSalary+current.hqcv;
  var head='<div class="phfk-page-head"><div><small>KNL · HỒ SƠ CÁ NHÂN</small><h1>'+esc(current.employeeName||current.employeeCode)+' · '+esc(current.employeeCode)+'</h1><p>Bậc & Cơ cấu thu nhập hiện tại</p></div><div class="phfk-income-head-actions"><span class="phfk-source-status is-ready">'+(isOfficial?'Chính thức':'Thử việc')+'</span>'+change+'</div></div>';
  var card;
  if(!isOfficial){
    card='<section class="phfk-panel phfk-income-card"><div class="phfk-income-summary"><div><small>LOẠI</small><b>Thử việc</b></div><div><small>KỲ LƯƠNG ÁP DỤNG</small><b>'+esc(current.payrollPeriod)+'</b></div><div><small>MỨC LƯƠNG THỬ VIỆC</small><b>'+money(current.probationAmount)+'</b></div></div><p class="phfk-batch-note">Nhân sự thử việc chưa gán Ngạch/Bậc/PC; không dựng cơ cấu chính thức giả định.</p></section>';
  }else{
    card='<section class="phfk-panel phfk-income-card"><div class="phfk-income-summary"><div><small>NGẠCH</small><b>'+esc(current.ladderName||current.ladderCode||'—')+'</b></div><div><small>BẬC</small><b>'+esc(current.gradeCode||'—')+'</b></div><div><small>VERSION</small><b>v'+esc(current.versionNumber||'—')+'</b></div><div><small>KỲ LƯƠNG ÁP DỤNG</small><b>'+esc(current.payrollPeriod)+'</b></div></div>'+
      '<div class="phfk-table-wrap"><table class="phfk-table"><tbody>'+
      '<tr><th>Lương cơ bản (LCB)</th><td>'+money(current.baseSalary)+'</td></tr>'+
      '<tr><th>HQCV</th><td>'+money(current.hqcv)+'</td></tr>'+
      '<tr><th>Tổng lương vị trí</th><td>'+money(totalPosition)+'</td></tr>'+
      '<tr><th>PC nghiệp vụ</th><td>'+(current.isProfessionalAllowance?'Hưởng · '+money(current.professionalAllowance):'Không hưởng')+' <small>(chuẩn '+money(current.standardProfessionalAllowance)+')</small></td></tr>'+
      '<tr><th>PC quản lý/trách nhiệm</th><td>'+(current.isManagementAllowance?'Hưởng · '+money(current.managementAllowance):'Không hưởng')+' <small>(chuẩn '+money(current.standardManagementAllowance)+')</small></td></tr>'+
      '<tr><th>Cơm</th><td>'+(current.isMealAllowance?money(current.mealAllowance):'Không hưởng')+'</td></tr>'+
      '<tr><th>PC khác</th><td>'+((current.extraAllowances||[]).length?current.extraAllowances.map(function(x){return esc(x.name)+': '+money(x.amount);}).join('<br>'):'—')+'</td></tr>'+
      '<tr><th><b>Tổng cơ cấu thu nhập</b></th><td><b>'+money(current.totalReferenceIncome)+'</b></td></tr>'+
      '</tbody></table></div><p class="phfk-batch-note">Thông tin tham chiếu theo ngạch/bậc và chính sách hiện hành; không phải bảng lương thực trả.</p></section>';
  }
  var history='<section class="phfk-panel"><div class="phfk-section-head"><h2>Lịch sử thay đổi</h2></div><div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Kỳ</th><th>Thay đổi</th><th>Thời điểm</th><th>Người thực hiện</th></tr></thead><tbody>'+(i.history||[]).map(function(h){return'<tr><td>'+esc(h.payrollPeriod)+'</td><td>'+esc(h.action)+'</td><td>'+esc(h.changedAt)+'</td><td>'+esc(h.changedByName||'—')+'</td></tr>';}).join('')+'</tbody></table></div></section>';
  return nav+head+card+history;
}
async function renderIncome(root,isAdmin,capabilities){var body=root.querySelector('[data-knl-body]'),url=new URL(location.href),queryCode=String(url.searchParams.get('employee_code')||'').trim().toUpperCase(),choose=url.searchParams.get('choose_employee')==='1';foundationState.incomeIsAdmin=isAdmin===true;foundationState.incomeCanSelect=isAdmin===true||(capabilities&&capabilities.income_view===true);if(!queryCode&&(isAdmin||choose&&foundationState.incomeCanSelect)){await showIncomePicker(root);return;}try{foundationState.income=await apiPost('getKnlEmployeeIncome',queryCode?{employeeCode:queryCode}:undefined);body.innerHTML=incomeHtml();bindCompensationDomainNav(root);var change=body.querySelector('[data-knl-change-income]');if(change)change.addEventListener('click',goIncomePicker);}catch(e){if(!queryCode&&foundationState.incomeCanSelect&&e.code==='KNL_EMPLOYEE_CODE_REQUIRED')await showIncomePicker(root,e.message);else body.innerHTML=noAccessSection(e.message);}}

/* ===== Gán cho nhân viên — Official (lookup master, no personal override) / Probation (fixed-only) ===== */
function assignLadderOptions(selectedId){return ((assignState.standards&&assignState.standards.ladders)||[]).map(function(l){return '<option value="'+esc(l.id)+'"'+(l.id===selectedId?' selected':'')+'>'+esc(l.code+' · '+l.name)+'</option>';}).join('');}
function assignVersionsForLadder(ladderId){var ladders=(assignState.standards&&assignState.standards.ladders)||[],ladder=ladders.find(function(l){return l.id===ladderId;});return ladder?(ladder.versions||[]).filter(function(v){return v.status!=='DRAFT'&&v.effective_period;}).sort(function(a,b){return b.version_number-a.version_number;}):[];}
function assignGradesForVersion(ladderId,versionId){var version=assignVersionsForLadder(ladderId).find(function(v){return v.id===versionId;});return version?(version.grades||[]).slice().sort(function(a,b){return a.grade_number-b.grade_number;}):[];}
function assignExtraAllowanceRowsHtml(){var rows=assignState.form.extraAllowances||[];return rows.map(function(row,idx){return '<div class="phfk-comp-extra-row"><input type="text" class="phfk-input" data-assign-extra-name="'+idx+'" placeholder="Tên phụ cấp" value="'+esc(row.name||'')+'"><input type="number" min="0" step="1000" class="phfk-input" data-assign-extra-amount="'+idx+'" placeholder="Số tiền" value="'+esc(row.amount||'')+'"><button type="button" class="phfk-btn-secondary" data-assign-extra-remove="'+idx+'">Xoá</button></div>';}).join('')+(rows.length<3?'<button type="button" class="phfk-btn-secondary" data-assign-extra-add>+ Thêm phụ cấp khác ('+rows.length+'/3)</button>':'<p class="phfk-batch-note">Đã đạt tối đa 3 phụ cấp khác.</p>');}
function assignPickerHtml(){var people=assignState.targets||[];return compensationDomainNav('gan-thu-nhap',true)+'<div class="phfk-page-head"><div><small>KNL · GÁN CHO NHÂN VIÊN</small><h1>Chọn nhân sự</h1><p>Chỉ nhân sự đang làm việc.</p></div></div><section class="phfk-panel phfk-income-picker"><label class="phfk-field"><span>Tìm nhân sự</span><input type="search" class="phfk-input" data-assign-search placeholder="Mã NV, họ tên, phòng ban…"></label><div class="phfk-income-targets">'+people.map(function(p){return '<button type="button" data-assign-target="'+esc(p.employeeCode)+'" data-search="'+esc([p.employeeCode,p.employeeName,p.department,p.branch,p.title].join(' ').toLowerCase())+'"><b>'+esc(p.employeeName)+'</b><span>'+esc(p.employeeCode)+' · '+esc(p.title||p.department||'Nhân sự')+'</span><small>'+esc([p.department,p.branch].filter(Boolean).join(' · '))+'</small></button>';}).join('')+'</div>'+(people.length?'':'<p class="phfk-empty">Không có nhân sự đang làm việc.</p>')+'</section>';}
function bindAssignPicker(root){bindCompensationDomainNav(root);var search=root.querySelector('[data-assign-search]');if(search)search.addEventListener('input',function(){var q=String(search.value||'').trim().toLowerCase();root.querySelectorAll('[data-assign-target]').forEach(function(row){row.hidden=!!(q&&String(row.dataset.search||'').indexOf(q)===-1);});});root.querySelectorAll('[data-assign-target]').forEach(function(btn){btn.addEventListener('click',function(){assignState.selectedCode=btn.getAttribute('data-assign-target');assignState.current=null;assignState.form={employmentType:'OFFICIAL',ladderId:'',versionId:'',gradeId:'',extraAllowances:[]};assignState.message='';assignState.error='';renderCompensationAssign(root);});});}
function assignFormHtml(person){
  var f=assignState.form,current=assignState.current&&assignState.current.current,isOfficial=f.employmentType==='OFFICIAL';
  var versions=isOfficial?assignVersionsForLadder(f.ladderId):[],grades=isOfficial?assignGradesForVersion(f.ladderId,f.versionId):[],selectedGrade=grades.find(function(g){return g.id===f.gradeId;});
  var currentCard=current?('<section class="phfk-panel phfk-income-card"><div class="phfk-section-head"><h2>Cơ cấu đang áp dụng</h2></div><div class="phfk-income-summary"><div><small>NGẠCH · BẬC</small><b>'+esc(current.ladderCode||'—')+' · '+esc(current.gradeCode||'—')+'</b></div><div><small>VERSION</small><b>v'+esc(current.versionNumber||'—')+'</b></div><div><small>KỲ LƯƠNG</small><b>'+esc(current.payrollPeriod)+'</b></div></div></section>'):'<p class="phfk-batch-note">Nhân sự này chưa có cơ cấu thu nhập nào.</p>';
  return compensationDomainNav('gan-thu-nhap',true)+
    '<div class="phfk-page-head"><div><small>KNL · GÁN CHO NHÂN VIÊN</small><h1>'+esc(person.employeeName)+' · '+esc(person.employeeCode)+'</h1></div><button type="button" class="phfk-btn-secondary" data-assign-change>Chọn nhân sự khác</button></div>'+
    currentCard+
    '<section class="phfk-panel"><div class="phfk-section-head"><h2>Gán cơ cấu kỳ mới</h2></div><form data-assign-form>'+
    '<div class="phfk-checklist" style="margin-bottom:12px">'+
      '<label class="phfk-check"><input type="radio" name="employmentTypeRadio" value="OFFICIAL" data-assign-type'+(isOfficial?' checked':'')+'> Chính thức</label>'+
      '<label class="phfk-check"><input type="radio" name="employmentTypeRadio" value="PROBATION" data-assign-type'+(!isOfficial?' checked':'')+'> Thử việc</label>'+
    '</div>'+
    '<div class="phfk-assignment-form">'+
    '<label class="phfk-field"><span>Kỳ lương áp dụng</span><input type="month" class="phfk-input" name="payrollPeriod" required></label>'+
    (isOfficial?(
      '<label class="phfk-field"><span>Ngạch</span><select class="phfk-input" data-assign-ladder><option value="">— Chọn ngạch —</option>'+assignLadderOptions(f.ladderId)+'</select></label>'+
      '<label class="phfk-field"><span>Version</span><select class="phfk-input" data-assign-version'+(!f.ladderId?' disabled':'')+'><option value="">— Chọn version —</option>'+versions.map(function(v){return '<option value="'+esc(v.id)+'"'+(v.id===f.versionId?' selected':'')+'>v'+v.version_number+' · '+esc(v.status)+' · '+esc(v.effective_period)+'</option>';}).join('')+'</select></label>'+
      '<label class="phfk-field"><span>Bậc</span><select class="phfk-input" data-assign-grade'+(!f.versionId?' disabled':'')+'><option value="">— Chọn bậc —</option>'+grades.map(function(g){return '<option value="'+esc(g.id)+'"'+(g.id===f.gradeId?' selected':'')+'>'+esc(g.grade_code)+' · LCB '+money(g.base_salary)+' · HQCV '+money(g.hqcv)+'</option>';}).join('')+'</select></label>'+
      (selectedGrade?('<p class="phfk-batch-note">LCB '+money(selectedGrade.base_salary)+' · HQCV '+money(selectedGrade.hqcv)+' · PC nghiệp vụ chuẩn '+money(selectedGrade.professional_allowance)+' · PC QL/trách nhiệm chuẩn '+money(selectedGrade.management_allowance)+' (lookup master, không override cá nhân).</p>'):'')+
      '<label class="phfk-check"><input type="checkbox" name="isProfessionalAllowance"> Hưởng PC nghiệp vụ</label>'+
      '<label class="phfk-check"><input type="checkbox" name="isManagementAllowance"> Hưởng PC quản lý/trách nhiệm</label>'+
      '<label class="phfk-check"><input type="checkbox" name="isMealAllowance"> Hưởng tiền cơm</label>'+
      '<label class="phfk-field"><span>Tiền cơm (gợi ý 910.000, cho phép ngoại lệ)</span><input type="number" min="0" step="1000" class="phfk-input" name="mealOverride" value="910000"></label>'
    ):(
      '<label class="phfk-field"><span>Mức lương thử việc</span><input type="number" min="1" step="1000" class="phfk-input" name="probationAmount" required></label>'
    ))+'</div>'+
    (isOfficial?('<div class="phfk-field"><span>Phụ cấp khác (tối đa 3)</span><div data-assign-extra-list>'+assignExtraAllowanceRowsHtml()+'</div></div>'):'')+
    '<label class="phfk-field"><span>Lý do / ghi chú (tuỳ chọn)</span><textarea class="phfk-input" name="reason"></textarea></label>'+
    '<div class="phfk-form-actions"><button type="submit" class="phfk-btn-primary">Lưu cơ cấu kỳ này</button></div>'+
    '</form>'+
    (assignState.message?'<p class="phfk-success">'+esc(assignState.message)+'</p>':'')+
    (assignState.error?'<p class="phfk-error">'+esc(assignState.error)+'</p>':'')+
    '</section>';
}
function renderCompensationAssignBody(root,person){var body=root.querySelector('[data-knl-body]');body.innerHTML=assignFormHtml(person);bindAssignForm(root,person);}
function bindAssignForm(root,person){
  bindCompensationDomainNav(root);
  var change=root.querySelector('[data-assign-change]');if(change)change.onclick=function(){assignState.selectedCode='';renderCompensationAssign(root);};
  root.querySelectorAll('[data-assign-type]').forEach(function(radio){radio.onchange=function(){assignState.form.employmentType=radio.value;renderCompensationAssignBody(root,person);};});
  var ladderSel=root.querySelector('[data-assign-ladder]');if(ladderSel)ladderSel.onchange=function(){assignState.form.ladderId=ladderSel.value;assignState.form.versionId='';assignState.form.gradeId='';renderCompensationAssignBody(root,person);};
  var versionSel=root.querySelector('[data-assign-version]');if(versionSel)versionSel.onchange=function(){assignState.form.versionId=versionSel.value;assignState.form.gradeId='';renderCompensationAssignBody(root,person);};
  var gradeSel=root.querySelector('[data-assign-grade]');if(gradeSel)gradeSel.onchange=function(){assignState.form.gradeId=gradeSel.value;renderCompensationAssignBody(root,person);};
  var addExtra=root.querySelector('[data-assign-extra-add]');if(addExtra)addExtra.onclick=function(){if((assignState.form.extraAllowances||[]).length>=3)return;assignState.form.extraAllowances=(assignState.form.extraAllowances||[]).concat([{name:'',amount:''}]);renderCompensationAssignBody(root,person);};
  root.querySelectorAll('[data-assign-extra-remove]').forEach(function(btn){btn.onclick=function(){assignState.form.extraAllowances.splice(Number(btn.getAttribute('data-assign-extra-remove')),1);renderCompensationAssignBody(root,person);};});
  root.querySelectorAll('[data-assign-extra-name],[data-assign-extra-amount]').forEach(function(input){input.addEventListener('change',function(){var isName=input.hasAttribute('data-assign-extra-name'),idx=Number(input.getAttribute(isName?'data-assign-extra-name':'data-assign-extra-amount'));assignState.form.extraAllowances[idx][isName?'name':'amount']=input.value;});});
  var form=root.querySelector('[data-assign-form]');if(!form)return;
  form.onsubmit=async function(ev){
    ev.preventDefault();
    var fd=new FormData(form),type=assignState.form.employmentType,payload={employeeCode:person.employeeCode,payrollPeriod:fd.get('payrollPeriod'),employmentType:type,reason:fd.get('reason')};
    if(type==='OFFICIAL'){
      if(!assignState.form.gradeId){assignState.error='Vui lòng chọn Ngạch/Version/Bậc.';renderCompensationAssignBody(root,person);return;}
      payload.gradeId=assignState.form.gradeId;
      payload.isProfessionalAllowance=!!fd.get('isProfessionalAllowance');
      payload.isManagementAllowance=!!fd.get('isManagementAllowance');
      payload.isMealAllowance=!!fd.get('isMealAllowance');
      payload.mealOverride=Number(fd.get('mealOverride')||0);
      payload.extraAllowances=(assignState.form.extraAllowances||[]).filter(function(x){return x.name&&x.amount;}).map(function(x){return{name:x.name,amount:Number(x.amount)};});
    }else{
      payload.probationAmount=Number(fd.get('probationAmount')||0);
    }
    try{
      await apiPost('saveKnlEmployeeIncome',payload);
      assignState.message='Đã lưu cơ cấu kỳ '+payload.payrollPeriod+'.';assignState.error='';
      assignState.current=await apiPost('getKnlEmployeeIncome',{employeeCode:person.employeeCode});
      assignState.form={employmentType:type,ladderId:'',versionId:'',gradeId:'',extraAllowances:[]};
      renderCompensationAssignBody(root,person);
    }catch(e){assignState.error=e.message;renderCompensationAssignBody(root,person);}
  };
}
async function renderCompensationAssign(root){
  var body=root.querySelector('[data-knl-body]');
  try{
    var calls=[apiPost('listKnlCompensationStandards')];if(!assignState.targetsLoaded)calls.push(apiPost('listKnlCompensationAssignmentTargets'));
    var results=await Promise.all(calls);
    assignState.standards=results[0];
    if(results[1]){assignState.targets=results[1].people||[];assignState.targetsLoaded=true;}
    if(!assignState.selectedCode){body.innerHTML=assignPickerHtml();bindAssignPicker(root);return;}
    var person=assignState.targets.find(function(p){return p.employeeCode===assignState.selectedCode;})||{employeeCode:assignState.selectedCode,employeeName:assignState.selectedCode};
    if(!assignState.form)assignState.form={employmentType:'OFFICIAL',ladderId:'',versionId:'',gradeId:'',extraAllowances:[]};
    if(!assignState.current)assignState.current=await apiPost('getKnlEmployeeIncome',{employeeCode:person.employeeCode}).catch(function(){return null;});
    renderCompensationAssignBody(root,person);
  }catch(e){body.innerHTML=compensationDomainNav('gan-thu-nhap',true)+noAccessSection(e.message);bindCompensationDomainNav(root);}
}

/* ===== Lịch sử — master version audit (không lookup current để dựng quá khứ) + employee history ===== */
function compensationAuditSummary(entry){
  if(entry.entityType==='compensation_version'){
    if(entry.action==='clone')return 'Tạo Draft mới từ v'+((entry.beforeData&&entry.beforeData.sourceVersionNumber)||'?');
    if(entry.action==='schedule')return 'Đặt hiệu lực: '+((entry.afterData&&entry.afterData.status)||'')+' từ '+((entry.afterData&&entry.afterData.effectiveFrom)||'');
    return entry.action;
  }
  return 'Sửa '+((entry.afterData&&entry.afterData.grades&&entry.afterData.grades.length)||0)+' bậc';
}
function compensationHistoryHtml(){
  var versionRows=historyState.versionAudit.map(function(e){return '<tr><td>'+esc(e.ladderCode||'—')+'</td><td>v'+esc(e.versionNumber||'—')+'</td><td>'+esc(compensationAuditSummary(e))+'</td><td>'+esc(e.actorName||'—')+'</td><td>'+esc(e.createdAt)+'</td></tr>';}).join('')||'<tr><td colspan="5">Chưa có thay đổi nào.</td></tr>';
  var empRows=historyState.employeeHistory.map(function(h){var s=h.afterData||{},snap=s.structure_snapshot||{};return '<tr><td>'+esc(h.employeeCode)+'</td><td>'+esc(h.payrollPeriod)+'</td><td>'+esc(h.action)+'</td><td>'+esc(s.employment_type||snap.employmentType||'')+' · '+esc(snap.gradeCode||'')+'</td><td>'+esc(h.changedByName||'—')+'</td><td>'+esc(h.changedAt)+'</td></tr>';}).join('')||'<tr><td colspan="6">Chưa có thay đổi nào.</td></tr>';
  return compensationDomainNav('lich-su-thu-nhap',true)+
    '<div class="phfk-page-head"><div><small>KNL · LỊCH SỬ</small><h1>Lịch sử cơ cấu ngạch, bậc & thu nhập</h1></div></div>'+
    '<section class="phfk-panel"><div class="phfk-section-head"><h2>Thay đổi cơ cấu ngạch & bậc (master)</h2></div><div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Ngạch</th><th>Version</th><th>Thay đổi</th><th>Người thực hiện</th><th>Thời điểm</th></tr></thead><tbody>'+versionRows+'</tbody></table></div></section>'+
    '<section class="phfk-panel"><div class="phfk-section-head"><div><small>NHÂN VIÊN</small><h2>Thay đổi cơ cấu thu nhập nhân viên</h2></div></div><label class="phfk-field" style="max-width:280px"><span>Lọc theo mã nhân viên</span><input type="text" class="phfk-input" data-history-employee-filter value="'+esc(historyState.employeeFilter)+'" placeholder="VD: PHF001"></label><div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Mã NV</th><th>Kỳ</th><th>Hành động</th><th>Chi tiết</th><th>Người thực hiện</th><th>Thời điểm</th></tr></thead><tbody>'+empRows+'</tbody></table></div></section>';
}
function bindCompensationHistory(root){bindCompensationDomainNav(root);var filter=root.querySelector('[data-history-employee-filter]');if(filter)filter.addEventListener('change',function(){historyState.employeeFilter=String(filter.value||'').trim().toUpperCase();renderCompensationHistory(root);});}
async function renderCompensationHistory(root){
  var body=root.querySelector('[data-knl-body]');
  try{
    var pair=await Promise.all([apiPost('getKnlCompensationVersionAudit'),apiPost('listKnlEmployeeCompensationHistory',historyState.employeeFilter?{employeeCode:historyState.employeeFilter}:undefined)]);
    historyState.versionAudit=pair[0].entries||[];historyState.employeeHistory=pair[1].history||[];
    body.innerHTML=compensationHistoryHtml();bindCompensationHistory(root);
  }catch(e){body.innerHTML=compensationDomainNav('lich-su-thu-nhap',true)+noAccessSection(e.message);bindCompensationDomainNav(root);}
}

/* ===================== ENTRY ===================== */

window.phfRenderKnl = async function(path){
  if(window.PHFAppShell) window.PHFAppShell.activateKnl(path);
  var root = document.getElementById('phfKnlRoot');
  if(!root) return false;
  document.title = 'PHF Khung năng lực';
  if(knlActivePath)knlScrollMemory[knlActivePath]=window.scrollY||0;
  knlActivePath=path;
  var tab = /\/tieu-chuan-bac$/.test(path)?'tieu-chuan-bac':(/\/phien-ban-lich-su$/.test(path)?'phien-ban-lich-su':(/\/ngach-bac-luong$/.test(path)?'ngach-bac-luong':(/\/gan-thu-nhap$/.test(path)?'gan-thu-nhap':(/\/lich-su-thu-nhap$/.test(path)?'lich-su-thu-nhap':(/\/co-cau-thu-nhap$/.test(path)?'co-cau-thu-nhap':(/\/gan-ap-dung$/.test(path) ? 'gan-ap-dung' : (/\/bo-knl$/.test(path) ? 'bo-knl' : (/\/ket-qua-khao-sat$/.test(path) ? 'ket-qua-khao-sat' : (/\/khao-sat$/.test(path) ? 'khao-sat' : (/\/phan-quyen$/.test(path) ? 'phan-quyen' : 'nhan-su'))))))))));
  if(root.querySelector('.phf-knl-root-shell'))showKnlPanelLoading(root,tab);
  else root.innerHTML = '<div class="phfk-loading">Đang tải…</div>';

  var capData;
  try{
    capData = await apiPost('getKnlCapabilities');
  }catch(e){
    if(root.querySelector('.phf-knl-root-shell')){
      var deniedBody=root.querySelector('[data-knl-body]');
      if(deniedBody)deniedBody.innerHTML=noAccessSection(e.message);
    }else root.innerHTML = '<main class="phf-knl-placeholder"><section>' + noAccessSection(e.message) + '</section></main>';
    return true;
  }

  var isAdmin = capData.isAdmin === true;
  knlLastIsAdmin = isAdmin;
  var capabilities = capData.capabilities || {};
  var authorizationSignature=JSON.stringify({admin:isAdmin,preset:capData.presetCode||'',capabilities:capabilities,peopleScope:capData.peopleScope||{}});
  if(knlAuthorizationSignature&&knlAuthorizationSignature!==authorizationSignature){
    clearKnlReadCache();
    peopleState.loaded=false;
    frameworkState.loaded=false;
    assignmentState.loaded=false;
    surveyState.loaded=false;
  }
  knlAuthorizationSignature=authorizationSignature;
  var canPeople = isAdmin || capabilities.access_knl;
  var canPermissions = isAdmin || capabilities.manage_permissions;
  var canFrameworks = isAdmin || capabilities.manage_framework;
  peopleCanViewIncome = isAdmin || capabilities.income_view === true;

  if(tab === 'phan-quyen' && !canPermissions){
    ensureKnlShell(root,tab,capabilities,isAdmin,noAccessSection('Bạn chưa được cấp quyền "Quản lý phân quyền KNL".'));
    return true;
  }
  if(['bo-knl','tieu-chuan-bac','phien-ban-lich-su'].indexOf(tab)>=0 && !canFrameworks){
    ensureKnlShell(root,tab,capabilities,isAdmin,noAccessSection('Bạn chưa được cấp quyền quản lý cấu trúc KNL.'));
    return true;
  }
  if((tab === 'gan-ap-dung'||tab === 'ngach-bac-luong'||tab === 'gan-thu-nhap'||tab === 'lich-su-thu-nhap') && !isAdmin){
    ensureKnlShell(root,tab,capabilities,isAdmin,noAccessSection('Chỉ Admin được nạp source và quản trị assignment KNL.'));
    return true;
  }
  if(tab === 'nhan-su' && !canPeople){
    ensureKnlShell(root,'nhan-su',capabilities,isAdmin,noAccessSection('Tài khoản chưa được cấp quyền truy cập KNL. Vui lòng liên hệ Admin.'));
    return true;
  }

  ensureKnlShell(root,tab,capabilities,isAdmin,'');

  if(tab === 'co-cau-thu-nhap'){
    await renderIncome(root,isAdmin,capabilities);
  }else if(tab === 'tieu-chuan-bac'){
    await renderGradeMatrix(root);
  }else if(tab === 'phien-ban-lich-su'){
    await renderVersionHistory(root);
  }else if(tab === 'ngach-bac-luong'){
    await renderCompensationStructure(root);
  }else if(tab === 'gan-thu-nhap'){
    await renderCompensationAssign(root);
  }else if(tab === 'lich-su-thu-nhap'){
    await renderCompensationHistory(root);
  }else if(tab === 'khao-sat'){
    var ticketId=new URL(location.href).searchParams.get('ticket');
    if(ticketId) await loadSurveyTicket(root,ticketId);
    else if(surveyState.loaded&&Date.now()-surveyState.loadedAt<KNL_READ_CACHE_TTL)renderSurveyList(root,isAdmin);
    else await loadSurveyList(root,isAdmin);
  }else if(tab === 'ket-qua-khao-sat'){
    await loadSurveyResults(root);
  }else if(tab === 'gan-ap-dung'){
    if(assignmentState.loaded&&Date.now()-assignmentState.loadedAt<KNL_READ_CACHE_TTL)renderAssignmentBody(root);else await loadAssignments(root);
  }else if(tab === 'bo-knl'){
    if(frameworkState.loaded&&Date.now()-frameworkState.loadedAt<KNL_READ_CACHE_TTL)renderFrameworkBody(root);else await loadFrameworks(root);
  }else if(tab === 'phan-quyen'){
    await loadPermissions(root);
  }else{
    if(peopleState.loaded&&Date.now()-peopleState.loadedAt<KNL_READ_CACHE_TTL)renderPeopleBody(root);else await loadPeople(root);
  }
  restoreKnlScroll(path);
  return true;
};
})();
