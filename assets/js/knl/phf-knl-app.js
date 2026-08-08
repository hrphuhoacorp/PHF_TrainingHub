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

async function apiPost(action, extra){
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
  { key:'nhan-su', label:'Nhân sự', desc:'Nhân sự thuộc phạm vi', icon:'◍', needs:'access_knl' },
  { key:'phan-quyen', label:'Phân quyền', desc:'Quản lý quyền truy cập KNL', icon:'⚙', needs:'manage_permissions' }
];

function shellFrame(activeTab, capabilities, isAdmin, bodyHtml){
  var items = SIDEBAR_ITEMS.filter(function(item){ return isAdmin || (capabilities && capabilities[item.needs]); });
  var icons = {
    'nhan-su':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg>',
    'phan-quyen':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>'
  };
  var navHtml = items.map(function(item){
    var desc=item.key==='nhan-su'?'Danh sách & phạm vi':'Quyền thao tác & scope';
    return '<button type="button" class="phfk-nav-item'+(activeTab===item.key?' active':'')+'" data-knl-tab="'+item.key+'">' +
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

function noAccessSection(message){
  return '<section class="phfk-empty"><p>' + esc(message) + '</p></section>';
}

/* ===================== NHÂN SỰ ===================== */

var peopleState = { filters:{ search:'', department:'', branch:'', status:'active' }, rows:[], loading:false, searchTimer:null };

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
    return '<tr><td>'+esc(p.employeeCode)+'</td><td>'+esc(p.employeeName)+'</td><td>'+esc(p.title)+'</td><td>'+esc(p.department)+'</td><td>'+esc(p.branch)+'</td><td>'+esc(p.status)+'</td></tr>';
  }).join('');
  return '' +
    '<div class="phfk-table-wrap"><table class="phfk-table">' +
      '<thead><tr><th>Mã NV</th><th>Họ và tên</th><th>Chức vụ/Chức danh</th><th>Phòng ban</th><th>Chi nhánh</th><th>Trạng thái</th></tr></thead>' +
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
  renderPeopleBody(root);
}

/* ===================== PHÂN QUYỀN ===================== */

var ACCOUNT_PAGE_SIZE = 20;
var permState = {
  grants:[], presets:[], accounts:[], loading:false,
  selectedAccountId:'', accountSearch:'', accountPage:0,
  editing:null, saving:false, advancedOpen:false,
  subordinate:{ search:'', rows:[], loading:false, error:'', searchTimer:null }
};

function emptyGrantFor(acc){
  return { id:null, accountId:acc.id, employeeCode:acc.employeeCode||'', employeeName:acc.name||'', presetCode:'', capabilities:{}, peopleScope:{type:'self',values:[]}, reason:'', isActive:true };
}

/* Chọn 1 tài khoản ở cột trái -> nạp đúng grant đang có (nếu có) làm state
   sống duy nhất (permState.editing) cho cột phải. Không tạo dữ liệu giả -
   tài khoản chưa có grant thì bắt đầu từ khung rỗng, chưa chọn vai trò nào. */
function selectAccount(root, accountId){
  var acc = permState.accounts.find(function(a){ return a.id===accountId; });
  if(!acc) return;
  permState.selectedAccountId = accountId;
  var grant = permState.grants.find(function(g){ return g.accountId===accountId; });
  permState.editing = grant
    ? Object.assign({}, grant, { capabilities: Object.assign({}, grant.capabilities), peopleScope: Object.assign({}, grant.peopleScope) })
    : emptyGrantFor(acc);
  permState.subordinate = { search:'', rows:[], loading:false, error:'', searchTimer:null };
  permState.advancedOpen = false;
  renderPermissionsBody(root);
  if(businessRoleForAccount(acc, permState.editing)==='tbp') loadSubordinates(root);
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
  var selectedSet = {}; selected.forEach(function(c){ selectedSet[String(c).toUpperCase()] = true; });
  var listHtml;
  if(s.loading) listHtml = '<div class="phfk-loading">Đang tải danh sách nhân sự…</div>';
  else if(s.error) listHtml = '<p class="phfk-perm-subordinate-empty">'+esc(s.error)+'</p>';
  else if(!s.rows.length) listHtml = '<p class="phfk-perm-subordinate-empty">Không tìm thấy nhân sự phù hợp.</p>';
  else listHtml = '<div class="phfk-perm-subordinate-list">' + s.rows.map(function(p){
    var checked = selectedSet[String(p.employeeCode).toUpperCase()];
    return '<label class="phfk-perm-subordinate-row"><input type="checkbox" data-knl-subordinate="'+esc(p.employeeCode)+'"'+(checked?' checked':'')+'>' +
      '<span class="phfk-perm-subordinate-code">'+esc(p.employeeCode)+'</span>' +
      '<span class="phfk-perm-subordinate-name">'+esc(p.employeeName)+'</span>' +
      '<span class="phfk-perm-subordinate-dept">'+esc(p.department)+'</span>' +
    '</label>';
  }).join('') + '</div>';
  return '' +
    '<div class="phfk-field phfk-perm-subordinate" data-knl-subordinate-section>' +
      '<span>Nhân viên cấp dưới</span>' +
      '<input type="search" class="phfk-input" placeholder="Tìm mã NV hoặc họ tên…" value="'+esc(s.search)+'" data-knl-subordinate-search>' +
      listHtml +
      '<p class="phfk-perm-subordinate-count" data-knl-subordinate-count>Đã chọn '+selected.length+' nhân viên</p>' +
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

function permConfigPanel(){
  if(!permState.selectedAccountId || !permState.editing) return '<section class="phfk-panel phfk-perm-config phfk-perm-config-empty"><p>Chọn một nhân sự bên trái để cấu hình quyền KNL.</p></section>';
  var acc = permState.accounts.find(function(a){ return a.id===permState.selectedAccountId; });
  if(!acc) return '';
  var g = permState.editing;
  var isHubAdmin = String(acc.role).toLowerCase()==='admin';
  var roleKey = businessRoleForAccount(acc, g);
  var incomeChecked = !!(g.capabilities && g.capabilities.income_view);

  var head = '<div class="phfk-perm-config-head"><small>2. VAI TRÒ KNL — ĐANG CẤU HÌNH</small><h2>'+esc(acc.name||acc.email)+'</h2><p>'+esc(acc.employeeCode||acc.email||'')+(acc.position?' · '+esc(acc.position):'')+'</p></div>';

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
  var incomeSection = '<div class="phfk-field"><span>3. Quyền bổ sung</span><label class="phfk-check"><input type="checkbox" data-knl-income-view'+(incomeChecked?' checked':'')+'> Truy cập mục Thu nhập</label></div>';
  var activeSection = isHubAdmin ? '' : '<label class="phfk-check phfk-perm-active-toggle"><input type="checkbox" data-knl-active'+(g.isActive!==false?' checked':'')+'> Đang cấp quyền KNL</label>';
  var reasonSection = '<label class="phfk-field"><span>Lý do cấp/thay đổi quyền</span><textarea class="phfk-input" rows="2" placeholder="Bắt buộc — ví dụ: Bổ nhiệm TBP Kho tháng 8" data-knl-reason>'+esc(g.reason||'')+'</textarea></label>';

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

/* Chỉ thay lại đúng khối "Nhân viên cấp dưới" (không render lại toàn bộ
   panel) để không mất focus ô tìm kiếm/vị trí cuộn khi gõ tìm hoặc tick. */
function refreshSubordinateSection(root){
  var section = root.querySelector('[data-knl-subordinate-section]');
  if(!section) return;
  var wrap = document.createElement('div');
  wrap.innerHTML = subordinatePickerHtml();
  section.replaceWith(wrap.firstElementChild);
  bindSubordinateSection(root);
}

function loadSubordinates(root){
  var s = permState.subordinate;
  s.loading = true; s.error = '';
  if(root.querySelector('[data-knl-subordinate-section]')) refreshSubordinateSection(root);
  apiPost('listKnlPeople', { search:s.search, status:'active' }).then(function(data){
    s.rows = data.people || []; s.loading = false;
    refreshSubordinateSection(root);
  }).catch(function(e){
    s.rows = []; s.loading = false; s.error = e.message;
    refreshSubordinateSection(root);
  });
}

function bindSubordinateSection(root){
  var search = root.querySelector('[data-knl-subordinate-search]');
  if(search) search.addEventListener('input', function(){
    permState.subordinate.search = search.value;
    clearTimeout(permState.subordinate.searchTimer);
    permState.subordinate.searchTimer = setTimeout(function(){ loadSubordinates(root); }, 300);
  });
  root.querySelectorAll('[data-knl-subordinate]').forEach(function(box){
    box.addEventListener('change', function(){
      var g = permState.editing; if(!g) return;
      var code = box.getAttribute('data-knl-subordinate');
      var values = (g.peopleScope && Array.isArray(g.peopleScope.values)) ? g.peopleScope.values.slice() : [];
      var upper = String(code).toUpperCase();
      var idx = values.findIndex(function(v){ return String(v).toUpperCase()===upper; });
      if(box.checked){ if(idx<0) values.push(code); }
      else if(idx>=0) values.splice(idx,1);
      g.peopleScope = { type:'employees', values:values };
      var countEl = root.querySelector('[data-knl-subordinate-count]');
      if(countEl) countEl.textContent = 'Đã chọn '+values.length+' nhân viên';
    });
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

  var incomeBox = root.querySelector('[data-knl-income-view]');
  if(incomeBox) incomeBox.addEventListener('change', function(){
    var g = permState.editing; if(!g) return;
    g.capabilities = Object.assign({}, g.capabilities, { income_view: incomeBox.checked });
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
    permState.saving = false;
    renderPermissionsBody(root);
    if(roleKeyFromPreset(saved.presetCode)==='tbp') loadSubordinates(root);
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
    var grantData = await apiPost('listKnlPermissionGrants');
    permState.grants = grantData.grants || [];
    permState.presets = grantData.presets || [];
    var accountData = await apiPost('listKnlAccountsForPermission');
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

/* ===================== ENTRY ===================== */

window.phfRenderKnl = async function(path){
  if(window.PHFAppShell) window.PHFAppShell.activateKnl(path);
  var root = document.getElementById('phfKnlRoot');
  if(!root) return false;
  document.title = 'PHF Khung năng lực';
  root.innerHTML = '<div class="phfk-loading">Đang tải…</div>';

  var capData;
  try{
    capData = await apiPost('getKnlCapabilities');
  }catch(e){
    root.innerHTML = '<main class="phf-knl-placeholder"><section>' + noAccessSection(e.message) + '</section></main>';
    return true;
  }

  var isAdmin = capData.isAdmin === true;
  var capabilities = capData.capabilities || {};
  var tab = /\/phan-quyen$/.test(path) ? 'phan-quyen' : 'nhan-su';
  var canPeople = isAdmin || capabilities.access_knl;
  var canPermissions = isAdmin || capabilities.manage_permissions;

  if(tab === 'phan-quyen' && !canPermissions){
    root.innerHTML = '<div class="phf-knl-root-shell">' + shellFrame(tab, capabilities, isAdmin, noAccessSection('Bạn chưa được cấp quyền "Quản lý phân quyền KNL".')) + '</div>';
    bindShell(root);
    return true;
  }
  if(tab === 'nhan-su' && !canPeople){
    root.innerHTML = '<div class="phf-knl-root-shell">' + shellFrame('nhan-su', capabilities, isAdmin, noAccessSection('Tài khoản chưa được cấp quyền truy cập KNL. Vui lòng liên hệ Admin.')) + '</div>';
    bindShell(root);
    return true;
  }

  root.innerHTML = '<div class="phf-knl-root-shell">' + shellFrame(tab, capabilities, isAdmin, '') + '</div>';
  bindShell(root);

  if(tab === 'phan-quyen'){
    permState.editing = null;
    await loadPermissions(root);
  }else{
    peopleState.filters = { search:'', department:'', branch:'', status:'active' };
    await loadPeople(root);
  }
  return true;
};
})();
