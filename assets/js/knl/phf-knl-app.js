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

function scopeText(scope){
  if(!scope || !scope.type) return '—';
  var label = SCOPE_LABELS[scope.type] || scope.type;
  if((scope.type==='department' || scope.type==='employees') && Array.isArray(scope.values) && scope.values.length) return label + ': ' + scope.values.map(esc).join(', ');
  return label;
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

var permState = { grants:[], presets:[], accounts:[], loading:false, editing:null, accountSearch:'' };

function permGrantsTable(){
  if(!permState.grants.length) return noAccessSection('Chưa có phân quyền KNL nào được cấp.');
  var rows = permState.grants.map(function(g){
    var preset = permState.presets.find(function(p){ return p.code===g.presetCode; });
    return '<tr>' +
      '<td>'+esc(g.employeeName || g.accountId)+'</td>' +
      '<td>'+esc(g.employeeCode)+'</td>' +
      '<td>'+esc(preset ? preset.name : g.presetCode)+'</td>' +
      '<td>'+scopeText(g.peopleScope)+'</td>' +
      '<td>'+(g.isActive ? '<span class="phfk-badge phfk-badge-on">Đang hoạt động</span>' : '<span class="phfk-badge phfk-badge-off">Đã ngừng</span>')+'</td>' +
      '<td><button type="button" class="phfk-link" data-knl-edit-grant="'+esc(g.id)+'">Sửa</button></td>' +
    '</tr>';
  }).join('');
  return '' +
    '<div class="phfk-table-wrap"><table class="phfk-table">' +
      '<thead><tr><th>Tài khoản</th><th>Mã NV</th><th>Nhóm quyền</th><th>Phạm vi Nhân sự</th><th>Trạng thái</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div>';
}

function accountOptions(){
  var search = (permState.accountSearch || '').trim().toLowerCase();
  var list = permState.accounts.filter(function(a){
    if(!search) return true;
    return (a.name+' '+a.email+' '+a.employeeCode).toLowerCase().indexOf(search) !== -1;
  }).slice(0, 50);
  return list.map(function(a){
    return '<option value="'+esc(a.id)+'">'+esc(a.name || a.email)+(a.employeeCode ? ' — '+esc(a.employeeCode) : '')+(a.position ? ' — '+esc(a.position) : '')+'</option>';
  }).join('');
}

function permEditForm(){
  var g = permState.editing || { id:null, accountId:'', employeeCode:'', employeeName:'', presetCode:'CUSTOM', capabilities:{}, peopleScope:{type:'self',values:[]}, reason:'', isActive:true };
  var presetOptions = permState.presets.map(function(p){ return '<option value="'+esc(p.code)+'"'+(g.presetCode===p.code?' selected':'')+'>'+esc(p.name)+'</option>'; }).join('');
  var capabilityKeys = Object.keys(CAPABILITY_LABELS);
  var capabilityBoxes = capabilityKeys.map(function(key){
    var checked = g.capabilities && g.capabilities[key] ? ' checked' : '';
    return '<label class="phfk-check"><input type="checkbox" data-knl-cap="'+key+'"'+checked+'> '+CAPABILITY_LABELS[key]+'</label>';
  }).join('');
  var scopeOptions = Object.keys(SCOPE_LABELS).map(function(t){ return '<option value="'+t+'"'+(g.peopleScope && g.peopleScope.type===t?' selected':'')+'>'+SCOPE_LABELS[t]+'</option>'; }).join('');
  var scopeValues = (g.peopleScope && Array.isArray(g.peopleScope.values)) ? g.peopleScope.values.join(', ') : '';
  var scopeType = g.peopleScope && g.peopleScope.type;
  var scopeValuesShown = scopeType==='department' || scopeType==='employees';
  var scopeValuesLabel = scopeType==='employees' ? 'Mã nhân sự (phân cách bởi dấu phẩy)' : 'Phòng ban (phân cách bởi dấu phẩy)';
  return '' +
    '<section class="phfk-panel phfk-form" data-knl-grant-form>' +
      '<h2>'+(g.id ? 'Sửa quyền KNL' : 'Cấp quyền KNL mới')+'</h2>' +
      (g.id ? '' : '' +
        '<label class="phfk-field"><span>Tìm tài khoản (Hub)</span><input type="search" class="phfk-input" placeholder="Tên, email hoặc mã NV…" data-knl-account-search value="'+esc(permState.accountSearch)+'"></label>' +
        '<label class="phfk-field"><span>Tài khoản</span><select class="phfk-input" data-knl-account-select><option value="">— Chọn tài khoản —</option>'+accountOptions()+'</select></label>'
      ) +
      (g.id ? '<p class="phfk-readonly">Tài khoản: <strong>'+esc(g.employeeName || g.accountId)+'</strong> ('+esc(g.employeeCode)+')</p>' : '') +
      '<label class="phfk-field"><span>Nhóm quyền gợi ý</span><select class="phfk-input" data-knl-preset>'+presetOptions+'</select></label>' +
      '<div class="phfk-field"><span>Năng lực</span><div class="phfk-checklist">'+capabilityBoxes+'</div></div>' +
      '<label class="phfk-field"><span>Phạm vi xem Nhân sự</span><select class="phfk-input" data-knl-scope-type>'+scopeOptions+'</select></label>' +
      '<label class="phfk-field" data-knl-scope-values-field'+(scopeValuesShown ? '' : ' hidden')+'><span data-knl-scope-values-label>'+esc(scopeValuesLabel)+'</span><input type="text" class="phfk-input" data-knl-scope-values value="'+esc(scopeValues)+'"></label>' +
      '<label class="phfk-field"><span>Lý do cấp/thay đổi quyền</span><textarea class="phfk-input" rows="2" data-knl-reason>'+esc(g.reason)+'</textarea></label>' +
      '<label class="phfk-check"><input type="checkbox" data-knl-active'+(g.isActive!==false?' checked':'')+'> Đang hoạt động</label>' +
      '<p class="phfk-error" data-knl-form-error hidden></p>' +
      '<div class="phfk-form-actions">' +
        '<button type="button" class="phfk-btn-primary" data-knl-save-grant>Lưu</button>' +
        '<button type="button" class="phfk-btn-secondary" data-knl-cancel-grant>Hủy</button>' +
      '</div>' +
    '</section>';
}

function renderPermissionsBody(root){
  var body = root.querySelector('[data-knl-body]');
  if(!body) return;
  var addButton = permState.editing ? '' : '<button type="button" class="phfk-btn-primary" data-knl-add-grant>+ Cấp quyền mới</button>';
  body.innerHTML = '' +
    '<div class="phfk-page-head"><div><small>KNL &middot; PHÂN QUYỀN</small><h1>Phân quyền KNL</h1></div>' + addButton + '</div>' +
    (permState.loading ? '<div class="phfk-loading">Đang tải…</div>' : permGrantsTable()) +
    (permState.editing ? permEditForm() : '');
  bindPermissionsForm(root);
}

function updateEditingFromForm(root){
  var g = permState.editing;
  if(!g) return;
  var capabilityKeys = Object.keys(CAPABILITY_LABELS);
  g.capabilities = g.capabilities || {};
  capabilityKeys.forEach(function(key){
    var box = root.querySelector('[data-knl-cap="'+key+'"]');
    if(box) g.capabilities[key] = box.checked;
  });
  var scopeType = root.querySelector('[data-knl-scope-type]');
  var scopeValues = root.querySelector('[data-knl-scope-values]');
  g.peopleScope = { type: scopeType ? scopeType.value : 'self', values: scopeValues ? scopeValues.value.split(',').map(function(v){ return v.trim(); }).filter(Boolean) : [] };
  var reason = root.querySelector('[data-knl-reason]');
  if(reason) g.reason = reason.value;
  var active = root.querySelector('[data-knl-active]');
  if(active) g.isActive = active.checked;
}

function bindPermissionsForm(root){
  var addBtn = root.querySelector('[data-knl-add-grant]');
  if(addBtn) addBtn.addEventListener('click', function(){
    permState.editing = { id:null, accountId:'', employeeCode:'', employeeName:'', presetCode:'CUSTOM', capabilities:{}, peopleScope:{type:'self',values:[]}, reason:'', isActive:true };
    permState.accountSearch = '';
    renderPermissionsBody(root);
  });
  root.querySelectorAll('[data-knl-edit-grant]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.getAttribute('data-knl-edit-grant');
      var found = permState.grants.find(function(g){ return g.id===id; });
      if(found) permState.editing = Object.assign({}, found, { capabilities: Object.assign({}, found.capabilities), peopleScope: Object.assign({}, found.peopleScope) });
      renderPermissionsBody(root);
    });
  });
  var cancelBtn = root.querySelector('[data-knl-cancel-grant]');
  if(cancelBtn) cancelBtn.addEventListener('click', function(){ permState.editing = null; renderPermissionsBody(root); });

  var accountSearch = root.querySelector('[data-knl-account-search]');
  if(accountSearch) accountSearch.addEventListener('input', function(){ permState.accountSearch = accountSearch.value; renderPermissionsBody(root); });

  var accountSelect = root.querySelector('[data-knl-account-select]');
  if(accountSelect) accountSelect.addEventListener('change', function(){
    var acc = permState.accounts.find(function(a){ return a.id===accountSelect.value; });
    if(acc && permState.editing){
      permState.editing.accountId = acc.id;
      permState.editing.employeeCode = acc.employeeCode;
      permState.editing.employeeName = acc.name;
    }
  });

  var presetSelect = root.querySelector('[data-knl-preset]');
  if(presetSelect) presetSelect.addEventListener('change', function(){
    var preset = permState.presets.find(function(p){ return p.code===presetSelect.value; });
    if(preset && permState.editing){
      permState.editing.presetCode = preset.code;
      permState.editing.capabilities = Object.assign({}, preset.capabilities);
      permState.editing.peopleScope = Object.assign({}, preset.peopleScope);
      renderPermissionsBody(root);
    }
  });

  var scopeTypeSelect = root.querySelector('[data-knl-scope-type]');
  if(scopeTypeSelect) scopeTypeSelect.addEventListener('change', function(){
    var field = root.querySelector('[data-knl-scope-values-field]');
    var isEmployees = scopeTypeSelect.value === 'employees';
    var shown = isEmployees || scopeTypeSelect.value === 'department';
    if(field) field.hidden = !shown;
    var label = root.querySelector('[data-knl-scope-values-label]');
    if(label) label.textContent = isEmployees ? 'Mã nhân sự (phân cách bởi dấu phẩy)' : 'Phòng ban (phân cách bởi dấu phẩy)';
  });

  var saveBtn = root.querySelector('[data-knl-save-grant]');
  if(saveBtn) saveBtn.addEventListener('click', async function(){
    updateEditingFromForm(root);
    var g = permState.editing;
    var errorEl = root.querySelector('[data-knl-form-error]');
    if(errorEl){ errorEl.hidden = true; errorEl.textContent = ''; }
    if(!g.accountId){ if(errorEl){ errorEl.hidden = false; errorEl.textContent = 'Vui lòng chọn tài khoản.'; } return; }
    saveBtn.disabled = true;
    try{
      await apiPost('upsertKnlPermissionGrant', { grant: g });
      permState.editing = null;
      await loadPermissions(root);
    }catch(e){
      if(errorEl){ errorEl.hidden = false; errorEl.textContent = e.message; }
    }finally{
      saveBtn.disabled = false;
    }
  });
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
