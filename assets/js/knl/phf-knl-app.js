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
var KNL_CACHEABLE_ACTIONS = new Set(['getKnlCapabilities','listKnlFrameworks','getKnlGradeMatrix','listKnlCompensationStandards','previewKnlCompensationFoundation','listKnlIncomeTargets','getKnlEmployeeIncome','listKnlAssignmentTargets','listKnlFrameworkAssignments','listKnlSourceManifests','previewKnlSourceSeed','listKnlPeople','listKnlSurveyCampaigns','getKnlSurveySetup','listKnlCompensationAssignmentTargets','getKnlCompensationVersionAudit','listKnlEmployeeCompensationHistory','listMyKnlGradePromotionProposals','listKnlGradePromotionProposalsAwaitingMyAction','listVisibleKnlGradePromotionProposals','getKnlGradePromotionProposalDetail','getKnlGradeOptionsForSubject','getKnlDashboardOverview']);
/* upsertKnlPermissionGrant phải nằm trong set này: getKnlCapabilities giờ
 * được cache (KNL-09 fix#1) nên nếu thiếu, quyền vừa đổi có thể hiển thị
 * capabilities cũ tới 30s (KNL_READ_CACHE_TTL) trên tab đang mở. */
var KNL_INVALIDATING_ACTIONS = new Set(['createKnlFramework','saveKnlFramework','cloneKnlVersion','publishKnlVersion','saveKnlGroup','saveKnlItem','saveKnlColumn','deleteKnlStructure','disableKnlStructure','reorderKnlStructure','saveKnlLevelContent','saveKnlGradeMatrix','setKnlVersionEffectivity','applyKnlCompensationFoundation','saveKnlEmployeeIncome','seedKnlSourceManifest','saveKnlFrameworkAssignment','saveKnlSurveyCampaign','openKnlSurveyCampaign','closeKnlSurveyCampaign','cloneKnlSurveyVersionToDraft','cloneKnlCompensationVersion','saveKnlCompensationGrades','scheduleKnlCompensationVersion','createKnlGradePromotionProposal','agreeKnlGradePromotionProposal','rejectKnlGradePromotionProposal','withdrawKnlGradePromotionProposal','correctKnlEmployeeCompensationPeriod','upsertKnlPermissionGrant','setKnlEmployeeCompetencyAssignment']);
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
  view_proposals:'Xem đề xuất nâng bậc',
  dashboard_view:'Xem Dashboard KNL',
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
  { key:'employee', label:'Nhân viên', subtitle:'Sử dụng KNL cá nhân', presetCode:'NHAN_VIEN' },
  { key:'tbp', label:'Trưởng bộ phận', subtitle:'Quản lý nhân sự được phân công', presetCode:'TRUONG_BO_PHAN' },
  { key:'assistant', label:'Trợ lý Giám đốc', subtitle:'Quyền theo phạm vi được cấp', presetCode:'TRO_LY_GD' }
];
var BUSINESS_ROLE_LABELS = { admin:'Admin', assistant:'Trợ lý Giám đốc', tbp:'Trưởng bộ phận', employee:'Nhân viên', unknown:'Tuỳ chỉnh' };
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
  { key:'dashboard', label:'Tổng quan', desc:'Nguồn lực · Năng lực · Thu nhập', icon:'◧', dashboardOnly:true },
  { key:'bo-knl', label:'Bộ KNL', desc:'Cấu trúc, tiêu chuẩn bậc & phiên bản', icon:'▦', needs:'manage_framework' },
  { key:'khao-sat', label:'Khảo sát & đánh giá', desc:'Đợt khảo sát và kết quả', icon:'◫', needs:'access_knl' },
  { key:'nhan-su', label:'Nhân sự', desc:'Nhân sự thuộc phạm vi', icon:'◍', needs:'access_knl' },
  { key:'co-cau-thu-nhap', label:'Bậc & Cơ cấu thu nhập', desc:'Thông tin tham chiếu cá nhân', icon:'◍', ownAlways:true },
  // KNL Grade Promotion Proposal batch 2: 4 capability riêng biệt
  // (view_proposals/propose/agree_proposal/approve) — bất kỳ capability nào
  // trong 4 cái cũng đủ để THẤY menu (mỗi sub-view bên trong tự gate theo
  // đúng capability của nó, xem renderGradePromotionSection()).
  { key:'de-xuat-nang-bac', label:'Đề xuất nâng bậc', desc:'Nâng bậc & phê duyệt', icon:'◔', needsAny:['view_proposals','propose','agree_proposal','approve'] },
  { key:'phan-quyen', label:'Phân quyền', desc:'Quản lý quyền truy cập KNL', icon:'⚙', needs:'manage_permissions' }
];

function shellFrame(activeTab, capabilities, isAdmin, bodyHtml, canDashboard){
  var activeSidebarTab=activeTab==='gan-ap-dung'?'bo-knl':activeTab;
  if(['tieu-chuan-bac','phien-ban-lich-su'].indexOf(activeTab)>=0)activeSidebarTab='bo-knl';
  if(['ngach-bac-luong','gan-thu-nhap','lich-su-thu-nhap'].indexOf(activeTab)>=0)activeSidebarTab='co-cau-thu-nhap';
  if(activeTab==='ket-qua-khao-sat')activeSidebarTab='khao-sat';
  var items = SIDEBAR_ITEMS.filter(function(item){ if(item.dashboardOnly)return canDashboard===true;if(item.ownAlways)return true;if(item.adminOnly)return isAdmin===true;if(item.needsAny)return isAdmin||item.needsAny.some(function(k){return capabilities&&capabilities[k]===true;});return isAdmin || (capabilities && capabilities[item.needs]); });
  var icons = {
    'dashboard':'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    'bo-knl':'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>',
    'khao-sat':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5"/></svg>',
    'nhan-su':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg>',
    'co-cau-thu-nhap':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M6 3h12v18H6zM9 12h6M9 16h4"/></svg>',
    'de-xuat-nang-bac':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    'phan-quyen':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>'
  };
  var navHtml = items.map(function(item){
    var desc=item.key==='nhan-su'?'Danh sách & phạm vi':(item.key==='dashboard'?'Tổng quan nguồn lực':'Quyền thao tác & scope');
    return '<button type="button" class="phfk-nav-item'+(activeSidebarTab===item.key?' active':'')+'" data-knl-tab="'+item.key+'">' +
      '<span class="phfk-nav-icon">'+(icons[item.key]||'')+'</span>' +
      '<span><b>'+item.label+'</b><small>'+desc+'</small></span></button>';
  }).join('');
  return '' +
    '<header class="phfk-topbar">' +
      '<div class="phfk-top-left"><button type="button" class="phfk-back" data-knl-back><span aria-hidden="true">←</span><span>PHF HR / Home</span></button></div>' +
      '<div class="phfk-brand-lockup"><strong>PHF HR - KHUNG NĂNG LỰC</strong></div>' +
      '<div class="phfk-top-actions"><div class="phfk-notif-wrap">'+knlNotifBellHtml()+knlNotifPanelHtml()+'</div><span class="phfk-user-avatar"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></span><span class="phfk-user-copy"><b>'+esc(currentUserName())+'</b><small>'+esc(currentUserTitle())+'</small></span></div>' +
    '</header>' +
    '<div class="phfk-layout">' +
      (navHtml ? '<aside class="phfk-sidebar"><div class="phfk-sidebar-head"><img src="assets/logo/phf-logo.png" alt="PHUHOA fresh"><strong>'+esc(sidebarRoleLabel(capabilities, isAdmin))+'</strong></div><nav class="phfk-nav">'+navHtml+'</nav><section class="phfk-guide"><b>Hướng dẫn</b><p>Quản lý danh sách nhân sự và phân quyền truy cập Khung năng lực.</p><button type="button" disabled>Xem hướng dẫn</button></section></aside>' : '') +
      '<main class="phfk-main" data-knl-body>' + (bodyHtml || '') + '</main>' +
    '</div>';
}
function bindShell(root){
  root.querySelectorAll('[data-knl-back]').forEach(function(el){ el.addEventListener('click', goHub); });
  root.querySelectorAll('[data-knl-tab]').forEach(function(el){ el.addEventListener('click', function(){ goTab(el.getAttribute('data-knl-tab')); }); });
  bindKnlNotif(root);
}

/* ===================== KNL NOTIFICATION (Phase N1) =====================
 * Thông báo nội bộ RIÊNG của module KNL — chỉ phục vụ Đề xuất nâng bậc.
 * KHÔNG dùng chung UI/state với notification Checklist, KHÔNG hiện ngoài
 * DOM/layout KNL (chuông + panel nằm HẲN trong .phfk-topbar, chỉ render khi
 * shellFrame() của KNL được dựng). Recipient/permission hoàn toàn do backend
 * (lib/knl-notifications.js) quyết định qua session — panel này chỉ hiển
 * thị đúng những gì API trả về cho actor hiện tại, không tự lọc/mở rộng. */
var KNL_NOTIF_EVENT_LABELS = {
  GRADE_PROPOSAL_ACTION_REQUIRED: 'Cần bạn xử lý',
  GRADE_PROPOSAL_APPROVED: 'Đã duyệt',
  GRADE_PROPOSAL_REJECTED: 'Đã từ chối',
  GRADE_PROPOSAL_WITHDRAWN: 'Đã rút',
  GRADE_PROPOSAL_REASSIGNED: 'Đổi người xử lý'
};
var knlNotifState = { loading:false, loaded:false, loadedAt:0, notifications:[], unreadCount:0, open:false };
var knlNotifLoadToken = 0;

function knlNotifBellHtml(){
  var count = knlNotifState.unreadCount;
  return '<button type="button" class="phfk-notif-bell" data-knl-notif-toggle aria-label="Thông báo KNL" aria-expanded="'+(knlNotifState.open?'true':'false')+'">'+
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>'+
    (count>0?'<span class="phfk-notif-badge">'+(count>99?'99+':count)+'</span>':'') +
  '</button>';
}
function knlNotifPanelHtml(){
  var list = knlNotifState.notifications, body;
  if(knlNotifState.loading && !knlNotifState.loaded) body='<div class="phfk-notif-empty">Đang tải…</div>';
  else if(!list.length) body='<div class="phfk-notif-empty">Không có thông báo nào.</div>';
  else body = list.map(function(n){
    return '<button type="button" class="phfk-notif-item'+(n.status==='new'?' unread':'')+'" data-knl-notif-item="'+esc(n.id)+'" data-knl-notif-proposal="'+esc(n.proposalId||'')+'">'+
      '<span class="phfk-notif-item-tag">'+esc(KNL_NOTIF_EVENT_LABELS[n.eventCode]||'')+'</span>'+
      '<span class="phfk-notif-item-title">'+esc(n.title)+'</span>'+
      '<span class="phfk-notif-item-msg">'+esc(n.message)+'</span>'+
      '<span class="phfk-notif-item-time">'+esc(fmtDate(n.createdAt))+'</span>'+
    '</button>';
  }).join('');
  return '<div class="phfk-notif-panel" data-knl-notif-panel'+(knlNotifState.open?'':' hidden')+'>'+
    '<div class="phfk-notif-panel-head"><b>Thông báo KNL</b>'+(knlNotifState.unreadCount>0?'<button type="button" data-knl-notif-mark-all>Đánh dấu đã đọc tất cả</button>':'')+'</div>'+
    '<div class="phfk-notif-panel-body">'+body+'</div>'+
  '</div>';
}
function goKnlNotifProposal(proposalId){
  var path = knlPath('de-xuat-nang-bac') + '?proposal=' + encodeURIComponent(proposalId);
  if(typeof window.phfNavigate==='function') window.phfNavigate(path);
}
function bindKnlNotifDomHandlers(root){
  var wrap = root.querySelector('.phfk-notif-wrap');
  if(!wrap) return;
  var toggle = wrap.querySelector('[data-knl-notif-toggle]');
  if(toggle) toggle.onclick = function(e){
    e.stopPropagation();
    knlNotifState.open = !knlNotifState.open;
    renderKnlNotifDom(root);
    if(knlNotifState.open) loadKnlNotifications(root, true);
  };
  wrap.querySelectorAll('[data-knl-notif-item]').forEach(function(el){
    el.onclick = function(){
      var id = el.getAttribute('data-knl-notif-item'), proposalId = el.getAttribute('data-knl-notif-proposal');
      knlNotifState.open = false;
      var n = knlNotifState.notifications.find(function(x){ return x.id===id; });
      if(n && n.status==='new'){ n.status='read'; n.readAt=n.readAt||new Date().toISOString(); knlNotifState.unreadCount=Math.max(0,knlNotifState.unreadCount-1); }
      renderKnlNotifDom(root);
      apiPost('markKnlNotificationRead',{id:id}).catch(function(){});
      if(proposalId) goKnlNotifProposal(proposalId);
    };
  });
  var markAll = wrap.querySelector('[data-knl-notif-mark-all]');
  if(markAll) markAll.onclick = function(ev){
    ev.stopPropagation();
    knlNotifState.notifications.forEach(function(n){ n.status='read'; n.readAt=n.readAt||new Date().toISOString(); });
    knlNotifState.unreadCount = 0;
    renderKnlNotifDom(root);
    apiPost('markAllKnlNotificationsRead').catch(function(){});
  };
}
function renderKnlNotifDom(root){
  var wrap = root.querySelector('.phfk-notif-wrap');
  if(!wrap) return;
  wrap.innerHTML = knlNotifBellHtml() + knlNotifPanelHtml();
  bindKnlNotifDomHandlers(root);
}
function bindKnlNotif(root){
  bindKnlNotifDomHandlers(root);
  document.addEventListener('click', function(e){
    if(!knlNotifState.open) return;
    var wrap = root.querySelector('.phfk-notif-wrap');
    if(wrap && !wrap.contains(e.target)){ knlNotifState.open=false; renderKnlNotifDom(root); }
  });
}
/* loadKnlNotifications — fetch danh sách CỦA CHÍNH actor hiện tại (backend tự
 * resolve từ session, xem lib/knl-notifications.js:actor()) — không truyền
 * employee_code/account_id nào từ client. force=true bỏ qua TTL (dùng khi mở
 * panel); không force thì tái dùng cache trong KNL_READ_CACHE_TTL, gọi lại
 * mỗi lần shell KNL render (điều hướng tab) để badge không bị cũ quá lâu mà
 * không cần dựng thêm 1 bộ polling/scheduler riêng. */
async function loadKnlNotifications(root, force){
  if(knlNotifState.loading) return;
  if(!force && knlNotifState.loaded && Date.now()-knlNotifState.loadedAt<KNL_READ_CACHE_TTL) return;
  knlNotifState.loading = true;
  var myToken = ++knlNotifLoadToken;
  renderKnlNotifDom(root);
  try{
    var r = await apiPostUncached('listMyKnlNotifications',{limit:30});
    if(myToken!==knlNotifLoadToken) return;
    knlNotifState.notifications = r.notifications||[];
    knlNotifState.unreadCount = r.unreadCount||0;
    knlNotifState.loaded = true; knlNotifState.loadedAt = Date.now();
  }catch(e){ /* im lặng: bell không phải luồng nghiệp vụ chính, không chặn phần còn lại của KNL */ }
  if(myToken!==knlNotifLoadToken) return;
  knlNotifState.loading = false;
  renderKnlNotifDom(root);
}
var knlActivePath = '';
var knlScrollMemory = {};
var knlLastIsAdmin = false;
function activeSidebarTab(tab){ if(['ngach-bac-luong','gan-thu-nhap','lich-su-thu-nhap'].indexOf(tab)>=0)return'co-cau-thu-nhap';return ['gan-ap-dung','tieu-chuan-bac','phien-ban-lich-su'].indexOf(tab)>=0?'bo-knl':(tab==='ket-qua-khao-sat'?'khao-sat':tab); }
function shellSignature(capabilities,isAdmin,canDashboard){
  return JSON.stringify({admin:isAdmin===true,access:capabilities&&capabilities.access_knl===true,framework:capabilities&&capabilities.manage_framework===true,permissions:capabilities&&capabilities.manage_permissions===true,dashboard:canDashboard===true});
}
function setShellActiveTab(root,tab){
  var active=activeSidebarTab(tab);
  root.querySelectorAll('[data-knl-tab]').forEach(function(el){el.classList.toggle('active',el.getAttribute('data-knl-tab')===active);});
}
function ensureKnlShell(root,tab,capabilities,isAdmin,bodyHtml,canDashboard){
  var shell=root.querySelector('.phf-knl-root-shell'),signature=shellSignature(capabilities,isAdmin,canDashboard);
  if(!shell||shell.dataset.signature!==signature){
    root.innerHTML='<div class="phf-knl-root-shell">'+shellFrame(tab,capabilities,isAdmin,bodyHtml||'',canDashboard)+'</div>';
    shell=root.querySelector('.phf-knl-root-shell');
    shell.dataset.signature=signature;
    bindShell(root);
  }else{
    setShellActiveTab(root,tab);
    var body=root.querySelector('[data-knl-body]');
    if(body&&bodyHtml!==undefined)body.innerHTML=bodyHtml;
  }
  root.dataset.knlTab=tab;
  loadKnlNotifications(root, false); // fire-and-forget, không chặn render tab hiện tại
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

/* Modal dùng chung thay cho confirm()/prompt() của browser — UI/UX polish. */
function closeKnlModal(){var el=document.querySelector('.phfk-modal-overlay');if(el)el.remove();}
function openKnlModal(bodyHtml){
  closeKnlModal();
  var overlay=document.createElement('div');
  overlay.className='phfk-modal-overlay';
  overlay.innerHTML='<div class="phfk-modal" role="dialog" aria-modal="true">'+bodyHtml+'</div>';
  overlay.addEventListener('click',function(e){if(e.target===overlay)closeKnlModal();});
  overlay.addEventListener('keydown',function(e){if(e.key==='Escape')closeKnlModal();});
  document.body.appendChild(overlay);
  var focusable=overlay.querySelector('input,button');if(focusable)focusable.focus();
  return overlay;
}
function openKnlConfirmModal(opts){
  var overlay=openKnlModal(
    '<div class="phfk-modal-icon">!</div>'+
    '<h3>'+esc(opts.title)+'</h3>'+
    '<p>'+esc(opts.body)+'</p>'+
    (opts.note?'<p class="phfk-modal-note">'+esc(opts.note)+'</p>':'')+
    '<div class="phfk-modal-actions"><button type="button" class="phfk-btn-secondary" data-modal-cancel>Hủy</button><button type="button" class="phfk-btn-danger" data-modal-confirm>'+esc(opts.confirmLabel||'Xác nhận')+'</button></div>'
  );
  // Batch 1E Phase B: guard against onConfirm firing twice. Removing the
  // overlay from the DOM (closeKnlModal) normally prevents a real second
  // physical click from reaching a gone element, but a handler stays bound
  // to a detached node — a fast double-click/double-tap whose 2nd event was
  // already queued before removal, or any programmatic double-invoke, could
  // still run onConfirm() twice and double-submit. `settled` makes it a
  // true one-shot regardless of DOM/event-queue timing.
  var settled=false;
  overlay.querySelector('[data-modal-cancel]').onclick=function(){if(settled)return;settled=true;closeKnlModal();};
  overlay.querySelector('[data-modal-confirm]').onclick=function(){if(settled)return;settled=true;closeKnlModal();if(opts.onConfirm)opts.onConfirm();};
}

/* Batch 1E (Phase A) — primitives dùng chung để dần thay 27 native
 * alert()/confirm()/prompt() rải rác trong file này bằng UI trong app.
 * KHÔNG đổi hành vi nghiệp vụ ở các call site — Phase A chỉ thêm hạ tầng,
 * chưa gắn vào 27 điểm gọi (việc đó thuộc Phase B, xem
 * scripts/knl-native-popup-inventory-2026-08.md). */

/* knlToast — wrapper mỏng tái dùng window.phfToast (đã có sẵn, định nghĩa ở
 * assets/js/phf-learner-app.js) để mọi màn KNL (không chỉ export Excel) có
 * thể bắn toast thay cho alert(). Không tạo framework toast mới. */
function knlToast(type,title,message,timeout,key){
  if(typeof window.phfToast==='function') window.phfToast(type,title,message,timeout,key);
}

/* setKnlButtonBusy — disable + đổi nhãn nút khi đang xử lý async, chống double
 * click (idempotent: gọi busy=true khi đã busy thì no-op; busy=false khi
 * không ở trạng thái busy do primitive này set thì cũng no-op để không đụng
 * nhãn gốc của nút không liên quan). */
function setKnlButtonBusy(button,busy,text){
  if(!button)return;
  if(busy){
    if(button.dataset.knlBusy==='1')return;
    button.dataset.knlBusy='1';
    button.dataset.knlBusyOriginalText=button.textContent;
    button.disabled=true;
    button.textContent=text||'Đang xử lý…';
  }else{
    if(button.dataset.knlBusy!=='1')return;
    button.disabled=false;
    button.textContent=button.dataset.knlBusyOriginalText||'';
    delete button.dataset.knlBusy;
    delete button.dataset.knlBusyOriginalText;
  }
}

/* openKnlPromptModal — thay cho prompt() của browser, dựng trên openKnlModal
 * sẵn có. opts = {
 *   title, body(optional intro text),
 *   fields:[{name,label,value,type('text'|'textarea'|'date'|'month'|'number'|'select'),
 *            options(chỉ dùng khi type==='select', [{value,label}]),
 *            placeholder,required,trim(default true),validate(value,values)->msg|null,
 *            showIf(values)->bool (ẩn field khi false, không validate field đang ẩn)}],
 *   confirmLabel, cancelLabel,
 *   onFieldChange(name,value,values,setValue) — gọi mỗi khi 1 field đổi giá
 *     trị (input/change), TRƯỚC khi tính lại showIf; dùng setValue(otherName,v)
 *     để tự đề xuất giá trị field khác (vd tự tính nhãn cột gợi ý theo loại
 *     cột, hoặc tự tính "ngày hiệu lực" mặc định theo "kỳ hiệu lực" — logic
 *     gợi ý cụ thể nằm ở call site Phase B, primitive chỉ cấp cơ chế chung).
 * }
 * Trả về Promise: resolve({name:value,...}) khi bấm Xác nhận hợp lệ,
 * resolve(null) khi Hủy / bấm ra ngoài overlay / Esc — cùng semantics với
 * prompt() trả về null khi Cancel. Nhiều field trong 1 modal (Phase B gộp
 * nhiều prompt() tuần tự thành 1 modal multi-field) là all-or-nothing submit
 * — validate lỗi field nào thì báo rõ field đó, không đóng modal. */
function openKnlPromptModal(opts){
  opts=opts||{};
  var fields=(opts.fields||[]).map(function(f,i){
    return Object.assign({name:f.name||('field'+i),trim:f.trim!==false},f);
  });
  return new Promise(function(resolve){
    var settled=false;
    var values={};fields.forEach(function(f){values[f.name]=f.value!=null?f.value:'';});
    function finish(value){
      if(settled)return;
      settled=true;
      closeKnlModal();
      resolve(value);
    }
    function fieldInputHtml(f){
      var val=esc(values[f.name]!=null?values[f.name]:'');
      if(f.type==='textarea')
        return '<textarea class="phfk-input" data-prompt-field="'+esc(f.name)+'" placeholder="'+esc(f.placeholder||'')+'">'+val+'</textarea>';
      if(f.type==='select')
        return '<select class="phfk-input" data-prompt-field="'+esc(f.name)+'">'+(f.options||[]).map(function(o){return '<option value="'+esc(o.value)+'"'+(String(values[f.name])===String(o.value)?' selected':'')+'>'+esc(o.label)+'</option>';}).join('')+'</select>';
      return '<input class="phfk-input" type="'+esc(f.type||'text')+'" data-prompt-field="'+esc(f.name)+'" value="'+val+'" placeholder="'+esc(f.placeholder||'')+'">';
    }
    function fieldWrapHtml(f){
      var hidden=typeof f.showIf==='function'&&!f.showIf(values);
      return '<label class="phfk-field" data-prompt-field-wrap="'+esc(f.name)+'"'+(hidden?' hidden':'')+'><span>'+esc(f.label||'')+'</span>'+fieldInputHtml(f)+'<p class="phfk-error" data-prompt-error="'+esc(f.name)+'" hidden></p></label>';
    }
    var bodyHtml=
      '<h3>'+esc(opts.title||'')+'</h3>'+
      (opts.body?'<p>'+esc(opts.body)+'</p>':'')+
      '<div class="phfk-modal-fields">'+fields.map(fieldWrapHtml).join('')+'</div>'+
      '<div class="phfk-modal-actions"><button type="button" class="phfk-btn-secondary" data-modal-cancel>'+esc(opts.cancelLabel||'Hủy')+'</button><button type="button" class="phfk-btn-primary" data-modal-confirm>'+esc(opts.confirmLabel||'Xác nhận')+'</button></div>';
    var overlay=openKnlModal(bodyHtml);
    // openKnlModal đã tự đóng khi click ra ngoài / Esc — bắt thêm ở đây để
    // Promise vẫn resolve(null), không treo lời gọi await ở Phase B.
    overlay.addEventListener('click',function(e){if(e.target===overlay)finish(null);});
    overlay.addEventListener('keydown',function(e){if(e.key==='Escape')finish(null);});
    overlay.querySelector('[data-modal-cancel]').onclick=function(){finish(null);};
    function refreshVisibility(){
      fields.forEach(function(f){
        var wrap=overlay.querySelector('[data-prompt-field-wrap="'+f.name+'"]');
        if(wrap)wrap.hidden=typeof f.showIf==='function'&&!f.showIf(values);
      });
    }
    function syncDomFromValues(){
      fields.forEach(function(f){
        var el=overlay.querySelector('[data-prompt-field="'+f.name+'"]');
        // Không ghi đè field người dùng đang gõ dở (giữ đúng yêu cầu "tự gợi
        // ý nhưng không ép" — field khác focus vẫn được set lại bình thường).
        if(el&&overlay.ownerDocument.activeElement!==el)el.value=values[f.name]!=null?values[f.name]:'';
      });
    }
    overlay.querySelectorAll('[data-prompt-field]').forEach(function(el){
      var evtName=el.tagName==='SELECT'?'change':'input';
      el.addEventListener(evtName,function(){
        var name=el.getAttribute('data-prompt-field');
        values[name]=el.value;
        if(typeof opts.onFieldChange==='function'){
          opts.onFieldChange(name,el.value,values,function(otherName,v){values[otherName]=v;});
        }
        syncDomFromValues();
        refreshVisibility();
      });
    });
    overlay.querySelector('[data-modal-confirm]').onclick=function(){
      var out={},firstInvalid=null;
      fields.forEach(function(f){
        var wrap=overlay.querySelector('[data-prompt-field-wrap="'+f.name+'"]');
        var isHidden=wrap&&wrap.hidden;
        var el=overlay.querySelector('[data-prompt-field="'+f.name+'"]');
        var v=el?el.value:'';
        if(f.trim)v=String(v).trim();
        var errEl=overlay.querySelector('[data-prompt-error="'+f.name+'"]');
        var errMsg=null;
        if(!isHidden){
          if(f.required&&!v)errMsg='Vui lòng nhập '+(f.label||'giá trị')+'.';
          else if(typeof f.validate==='function')errMsg=f.validate(v,out);
        }
        if(errMsg){
          if(errEl){errEl.textContent=errMsg;errEl.hidden=false;}
          if(el)el.classList.add('is-invalid');
          if(!firstInvalid)firstInvalid=el;
        }else{
          if(errEl)errEl.hidden=true;
          if(el)el.classList.remove('is-invalid');
        }
        out[f.name]=v;
      });
      if(firstInvalid){firstInvalid.focus();return;}
      finish(out);
    };
    var firstField=overlay.querySelector('[data-prompt-field]');
    if(firstField)firstField.focus();
  });
}

/* Batch 1D — "Điều chỉnh kỳ hiệu lực" (vd Huỳnh: 08/2026 lẽ ra 09/2026).
 * Admin-only (nút chỉ render khi foundationState.incomeIsAdmin — backend
 * correctKnlEmployeeCompensationPeriod cũng tự requireAdmin, UI không phải
 * đường chặn duy nhất). KHÔNG bắt nhập lại LCB/HQCV/phụ cấp — RPC copy
 * nguyên cơ cấu từ kỳ nguồn, modal chỉ hỏi kỳ mới + lý do. Preview read-only,
 * không prompt/confirm/alert của browser. */
var correctionState={pending:false,error:'',targetPeriod:'',reason:''};
function correctionSummaryHtml(current){
  var rows=[];
  if(current.employmentType==='OFFICIAL'){
    rows.push(['Lương cơ bản (LCB)',current.baseSalary]);
    rows.push(['Hệ số chất lượng công việc (HQCV)',current.hqcv]);
    if(current.isProfessionalAllowance)rows.push(['Phụ cấp nghiệp vụ',current.professionalAllowance]);
    if(current.isManagementAllowance)rows.push(['Phụ cấp quản lý/trách nhiệm',current.managementAllowance]);
    if(current.isMealAllowance)rows.push(['Tiền cơm',current.mealAllowance]);
    (current.extraAllowances||[]).forEach(function(x){if(x&&x.name)rows.push(['Phụ cấp khác — '+x.name,x.amount]);});
  }else{
    rows.push(['Mức lương thử việc',current.probationAmount]);
  }
  return '<ul class="phfk-correction-summary">'+rows.map(function(r){return '<li>'+esc(r[0])+': <b>'+esc(money(r[1])+'/tháng')+'</b></li>';}).join('')+
    '<li class="phfk-correction-summary-total">Tổng thu nhập: <b>'+esc(money(current.totalReferenceIncome)+'/tháng')+'</b></li></ul>';
}
function correctionPeriodWarningHtml(period){
  if(!period)return '';
  var nowYm=new Date().toISOString().slice(0,7);
  if(period<nowYm)return '<p class="phfk-modal-note">Kỳ này đã qua. Điều chỉnh có thể ảnh hưởng báo cáo lịch sử.</p>';
  if(period>nowYm)return '<p class="phfk-modal-note">Kỳ này chưa hiệu lực.</p>';
  return '';
}
function renderCorrectionModal(root,current){
  var targetLabel=correctionState.targetPeriod?dashPeriodText(correctionState.targetPeriod):'—';
  var body=
    '<h3>Điều chỉnh kỳ hiệu lực</h3>'+
    '<div class="phfk-modal-fields">'+
      '<label class="phfk-field"><span>Nhân viên</span><input class="phfk-input" value="'+esc((current.employeeName||current.employeeCode)+' · '+current.employeeCode)+'" disabled></label>'+
      '<label class="phfk-field"><span>Kỳ hiện tại</span><input class="phfk-input" value="'+esc(dashPeriodText(current.payrollPeriod))+'" disabled></label>'+
      '<label class="phfk-field"><span>Kỳ mới</span><input type="month" class="phfk-input" data-correction-target value="'+esc(correctionState.targetPeriod)+'"></label>'+
      '<label class="phfk-field"><span>Lý do điều chỉnh</span><textarea class="phfk-input" data-correction-reason placeholder="VD: Nhập nhầm kỳ hiệu lực, đúng áp dụng từ kỳ mới.">'+esc(correctionState.reason)+'</textarea></label>'+
    '</div>'+
    '<div class="phfk-correction-preview"><p><small>HIỆN TẠI</small><b>'+esc(dashPeriodText(current.payrollPeriod))+'</b></p><span class="phfk-correction-arrow">→</span><p><small>SAU ĐIỀU CHỈNH</small><b>'+esc(targetLabel)+'</b></p></div>'+
    '<p class="phfk-batch-note">Cơ cấu thu nhập được giữ nguyên, chỉ đổi kỳ hiệu lực:</p>'+
    correctionSummaryHtml(current)+
    correctionPeriodWarningHtml(correctionState.targetPeriod)+
    (correctionState.error?'<p class="phfk-error">'+esc(correctionState.error)+'</p>':'')+
    '<div class="phfk-modal-actions"><button type="button" class="phfk-btn-secondary" data-modal-cancel>Hủy</button><button type="button" class="phfk-btn-primary" data-correction-confirm'+(correctionState.pending?' disabled':'')+'>'+(correctionState.pending?'Đang lưu…':'Xác nhận điều chỉnh')+'</button></div>';
  var overlay=openKnlModal(body);
  overlay.querySelector('[data-modal-cancel]').onclick=closeKnlModal;
  var targetInput=overlay.querySelector('[data-correction-target]');
  if(targetInput)targetInput.onchange=function(){correctionState.targetPeriod=targetInput.value;correctionState.error='';renderCorrectionModal(root,current);};
  var reasonInput=overlay.querySelector('[data-correction-reason]');
  if(reasonInput)reasonInput.onchange=function(){correctionState.reason=reasonInput.value;};
  var confirmBtn=overlay.querySelector('[data-correction-confirm]');
  if(confirmBtn)confirmBtn.onclick=function(){submitCorrection(root,current);};
}
async function submitCorrection(root,current){
  var targetPeriod=String(correctionState.targetPeriod||'').trim();
  var reason=String(correctionState.reason||'').trim();
  if(!targetPeriod){correctionState.error='Phải chọn kỳ mới.';renderCorrectionModal(root,current);return;}
  if(targetPeriod===current.payrollPeriod){correctionState.error='Kỳ mới phải khác kỳ hiện tại.';renderCorrectionModal(root,current);return;}
  if(reason.length<5){correctionState.error='Phải nhập lý do điều chỉnh (tối thiểu 5 ký tự).';renderCorrectionModal(root,current);return;}
  correctionState.pending=true;correctionState.error='';renderCorrectionModal(root,current);
  try{
    await apiPost('correctKnlEmployeeCompensationPeriod',{employeeCode:current.employeeCode,sourcePeriod:current.payrollPeriod,targetPeriod:targetPeriod,reason:reason});
    correctionState={pending:false,error:'',targetPeriod:'',reason:''};
    closeKnlModal();
    await renderIncome(root,true,{});
  }catch(e){
    correctionState.pending=false;
    correctionState.error=(e&&e.message)||'Không thể điều chỉnh kỳ hiệu lực. Vui lòng thử lại.';
    renderCorrectionModal(root,current);
  }
}

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

var peopleState = { filters:{ search:'', department:'', branch:'', status:'active' }, rows:[], loading:false, loaded:false, loadedAt:0, searchTimer:null, page:0, error:'' };
var peopleCanViewIncome = false;
var PEOPLE_PAGE_SIZE = 20;

function peopleFilterBar(){
  var f = peopleState.filters;
  var departments = Array.from(new Set(peopleState.rows.map(function(r){ return r.department; }).filter(Boolean))).sort();
  var branches = Array.from(new Set(peopleState.rows.map(function(r){ return r.branch; }).filter(Boolean))).sort();
  var deptOptions = '<option value="">Tất cả phòng ban</option>' + departments.map(function(d){ return '<option value="'+esc(d)+'"'+(f.department===d?' selected':'')+'>'+esc(d)+'</option>'; }).join('');
  var branchOptions = '<option value="">Tất cả chi nhánh</option>' + branches.map(function(b){ return '<option value="'+esc(b)+'"'+(f.branch===b?' selected':'')+'>'+esc(b)+'</option>'; }).join('');
  var statusOptions = ['active','inactive','all'].map(function(s){ return '<option value="'+s+'"'+(f.status===s?' selected':'')+'>'+STATUS_LABELS[s]+'</option>'; }).join('');
  return '' +
    '<div class="phfk-filters phfk-people-filters">' +
      '<input type="search" class="phfk-input" placeholder="Tìm mã NV hoặc họ tên…" value="'+esc(f.search)+'" data-knl-people-search>' +
      '<select class="phfk-input" data-knl-people-department>'+deptOptions+'</select>' +
      '<select class="phfk-input" data-knl-people-branch>'+branchOptions+'</select>' +
      '<select class="phfk-input" data-knl-people-status>'+statusOptions+'</select>' +
    '</div>';
}

/* Trạng thái: badge nhẹ, semantic — "Đang làm việc" xanh nhẹ, còn lại
 * (Đã nghỉ việc/khác) trung tính, KHÔNG đỏ (không phải trạng thái cảnh báo,
 * chỉ là nhân sự không còn active — đúng yêu cầu PHF mục 5). */
function peopleStatusBadgeHtml(status){
  var isActive = status === STATUS_LABELS.active;
  return '<span class="phfk-people-status'+(isActive?' is-active':' is-neutral')+'">'+esc(status||'—')+'</span>';
}

function peopleTable(){
  if(peopleState.loading) return '<div class="phfk-loading">Đang tải danh sách nhân sự…</div>';
  // Fix gap: trước đây lỗi tải xóa luôn thanh bộ lọc và không có cách thử
  // lại — nay giữ nguyên bộ lọc (renderPeopleBody luôn render peopleFilterBar()
  // trước peopleTable()) và thêm nút "Thử lại" ngay tại chỗ.
  if(peopleState.error) return '<section class="phfk-empty"><p>'+esc(peopleState.error)+'</p><button type="button" class="phfk-btn-secondary" data-knl-people-retry>Thử lại</button></section>';
  if(!peopleState.rows.length) return noAccessSection('Không có nhân sự nào thuộc phạm vi của bạn với bộ lọc hiện tại.');
  var totalPages = Math.max(1, Math.ceil(peopleState.rows.length / PEOPLE_PAGE_SIZE));
  if(peopleState.page >= totalPages) peopleState.page = totalPages - 1;
  if(peopleState.page < 0) peopleState.page = 0;
  var pageItems = peopleState.rows.slice(peopleState.page*PEOPLE_PAGE_SIZE, peopleState.page*PEOPLE_PAGE_SIZE + PEOPLE_PAGE_SIZE);
  /* Hierarchy: Họ tên (primary, bold) + Mã NV (secondary, nhỏ/neutral, gộp
   * cùng ô) đứng đầu — Mã NV không còn là cột riêng đầu bảng. "Xem thu nhập"
   * per-row: cột (peopleCanViewIncome) chỉ quyết định CÓ hiện cột "Thao tác"
   * hay không (layout) — nút bên trong từng row PHẢI theo đúng
   * p.canViewIncome do BACKEND tính sẵn (incomeScopeAllows,
   * lib/knl-people.js:listKnlPeople), KHÔNG tự suy từ capability phẳng.
   * false -> ô rỗng, không placeholder giả. */
  var rows = pageItems.map(function(p){
    return '<tr><td class="phfk-people-name-cell"><b>'+esc(p.employeeName)+'</b><small>'+esc(p.employeeCode)+'</small></td><td>'+esc(p.title)+'</td><td>'+esc(p.department)+'</td><td>'+esc(p.branch)+'</td><td>'+peopleStatusBadgeHtml(p.status)+'</td>'+(peopleCanViewIncome?'<td>'+(p.canViewIncome===true?'<button type="button" class="phfk-link" data-knl-person-income="'+esc(p.employeeCode)+'">Xem thu nhập</button>':'')+'</td>':'')+'</tr>';
  }).join('');
  var pagination = totalPages>1 ? (
    '<div class="phfk-perm-account-pagination phfk-people-pagination">' +
      '<button type="button" data-knl-people-page="-1"'+(peopleState.page<=0?' disabled':'')+'>‹ Trước</button>' +
      '<span>Trang '+(peopleState.page+1)+'/'+totalPages+'</span>' +
      '<button type="button" data-knl-people-page="1"'+(peopleState.page>=totalPages-1?' disabled':'')+'>Sau ›</button>' +
    '</div>'
  ) : '';
  return '' +
    '<div class="phfk-table-wrap phfk-people-table-wrap"><table class="phfk-table phfk-people-table">' +
      '<thead><tr><th>Họ và tên</th><th>Chức vụ/Chức danh</th><th>Phòng ban</th><th>Chi nhánh</th><th>Trạng thái</th>'+(peopleCanViewIncome?'<th>Thao tác</th>':'')+'</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div>' +
    '<div class="phfk-people-table-foot"><p class="phfk-count">' + peopleState.rows.length + ' nhân sự</p>' + pagination + '</div>';
}

function renderPeopleBody(root){
  var body = root.querySelector('[data-knl-body]');
  if(!body) return;
  body.innerHTML = '<div class="phfk-people-screen"><div class="phfk-page-head phfk-people-page-head"><div><small>KNL &middot; NHÂN SỰ</small><h1>Nhân sự thuộc phạm vi</h1></div></div>' + peopleFilterBar() + peopleTable() + '</div>';
  bindPeopleFilters(root);
}

function bindPeopleFilters(root){
  root.querySelectorAll('[data-knl-person-income]').forEach(function(button){button.addEventListener('click',function(){goIncomeEmployee(button.getAttribute('data-knl-person-income'));});});
  var retry=root.querySelector('[data-knl-people-retry]');if(retry)retry.addEventListener('click',function(){loadPeople(root);});
  root.querySelectorAll('[data-knl-people-page]').forEach(function(button){button.addEventListener('click',function(){
    peopleState.page += Number(button.getAttribute('data-knl-people-page'));
    renderPeopleBody(root);
  });});
  var search = root.querySelector('[data-knl-people-search]');
  if(search) search.addEventListener('input', function(){
    peopleState.filters.search = search.value;
    clearTimeout(peopleState.searchTimer);
    peopleState.searchTimer = setTimeout(function(){ peopleState.page = 0; loadPeople(root); }, 300);
  });
  var dept = root.querySelector('[data-knl-people-department]');
  if(dept) dept.addEventListener('change', function(){ peopleState.filters.department = dept.value; peopleState.page = 0; loadPeople(root); });
  var branch = root.querySelector('[data-knl-people-branch]');
  if(branch) branch.addEventListener('change', function(){ peopleState.filters.branch = branch.value; peopleState.page = 0; loadPeople(root); });
  var status = root.querySelector('[data-knl-people-status]');
  if(status) status.addEventListener('change', function(){ peopleState.filters.status = status.value; peopleState.page = 0; loadPeople(root); });
}

async function loadPeople(root){
  peopleState.loading = true;
  peopleState.error = '';
  renderPeopleBody(root);
  try{
    var data = await apiPost('listKnlPeople', peopleState.filters);
    peopleState.rows = data.people || [];
  }catch(e){
    peopleState.rows = [];
    peopleState.error = e.message || 'Không thể tải danh sách nhân sự. Vui lòng thử lại.';
    peopleState.loading = false;
    renderPeopleBody(root);
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
  accountFilters:{department:'',branch:'',position:''}, pickerExpanded:true,
  editing:null, saving:false, advancedOpen:false, incomeConfigOpen:false,
  subordinate: emptyPickerState(),
  incomeEmp: emptyPickerState(),
  advEmployees: emptyPickerState(),
  incomeValues: { rows:[], loading:false, error:'', pendingCallbacks:[] }
};
var INCOME_VALUE_SCOPE_LABELS = { department:'phòng ban', branch:'chi nhánh', title:'chức danh' };

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
  permState.advEmployees = emptyPickerState();
  permState.advancedOpen = false;
  permState.incomeConfigOpen = !!(g.capabilities && g.capabilities.income_view && g.capabilities.incomeScope);
  /* Chọn xong -> thu gọn bước 1 thành summary bar, nhường toàn bộ chiều
     rộng cho các bước cấu hình bên dưới (flow dọc full-width). */
  permState.pickerExpanded = false;
  renderPermissionsBody(root);
  if(businessRoleForAccount(acc, g)==='tbp') loadSubordinates(root);
  if(g.capabilities && g.capabilities.income_view && g.capabilities.incomeScope){
    var openScopeType = g.capabilities.incomeScope.type;
    if(openScopeType==='employees') loadIncomeEmp(root);
    else if(INCOME_VALUE_SCOPE_LABELS[openScopeType]) loadIncomeValues(root, function(){ refreshIncomeValueSection(root); });
  }
  /* peopleScope.type='department' (vd Trợ lý Giám đốc phụ trách nhiều
     phòng ban) hoặc 'employees' cấu hình qua Thiết lập nâng cao (không
     phải TBP) — nạp sẵn danh mục/roster ngay khi chọn tài khoản để
     checkbox/picker đọc lại đúng giá trị đã lưu, không cần Admin tự mở
     "Thiết lập nâng cao" trước mới thấy đúng trạng thái. */
  if(g.peopleScope && g.peopleScope.type==='department') loadIncomeValues(root, function(){ refreshAdvDeptSection(root); });
  else if(g.peopleScope && g.peopleScope.type==='employees') loadAdvEmployees(root);
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
/* Filter cascading/facet — cùng kỹ thuật knlEmployeePickerHtml/
   bindKnlEmployeePicker (batch c22dced): option của 1 filter luôn tính lại
   từ tập tài khoản khớp CÁC filter/search KHÁC (trừ chính nó, exceptKey) —
   không hard-code danh mục, không gọi API riêng vì listKnlAccountsForPermission
   đã trả về toàn bộ tài khoản 1 lần. Không reuse thẳng component đó vì đây là
   chọn-1-account-để-cấu-hình (không phải multi-select/navigate như 2 nơi kia)
   — chỉ reuse logic facet, không copy nguyên implementation. */
var ACCOUNT_FACET_LABELS = { department:'Phòng ban', branch:'Chi nhánh', position:'Chức danh' };
function accountMatchesFilters(a, filters, exceptKey, search){
  if(search){
    var hay = (String(a.name)+' '+String(a.email)+' '+String(a.employeeCode)+' '+String(a.position)).toLowerCase();
    if(hay.indexOf(search) === -1) return false;
  }
  if(exceptKey!=='department' && filters.department && a.department!==filters.department) return false;
  if(exceptKey!=='branch' && filters.branch && a.branch!==filters.branch) return false;
  if(exceptKey!=='position' && filters.position && a.position!==filters.position) return false;
  return true;
}
function accountFacetOptions(key, filters, search){
  var pool = permState.accounts.filter(function(a){ return accountMatchesFilters(a, filters, key, search); });
  return Array.from(new Set(pool.map(function(a){ return a[key]; }).filter(Boolean))).sort();
}
/* Nếu 1 filter đang chọn không còn nằm trong tập option hợp lệ (do search/
   filter khác vừa thu hẹp) thì tự bỏ chọn — tránh filter "chọn" 1 giá trị
   nhưng danh sách kết quả luôn rỗng không rõ lý do. */
function normalizeAccountFilters(){
  var search = (permState.accountSearch||'').trim().toLowerCase();
  var filters = permState.accountFilters;
  Object.keys(ACCOUNT_FACET_LABELS).forEach(function(key){
    if(!filters[key]) return;
    if(accountFacetOptions(key, filters, search).indexOf(filters[key]) === -1) filters[key] = '';
  });
}
function filteredAccounts(){
  var search = (permState.accountSearch||'').trim().toLowerCase();
  var filters = permState.accountFilters;
  return permState.accounts.filter(function(a){ return accountMatchesFilters(a, filters, null, search); });
}
function accountRoleBadgeHtml(acc){
  if(String(acc.role).toLowerCase()==='admin') return '<span class="phfk-badge phfk-badge-role is-admin">Admin</span>';
  var grant = permState.grants.find(function(g){ return g.accountId===acc.id; });
  if(!grant || grant.isActive===false) return '';
  var label = BUSINESS_ROLE_LABELS[roleKeyFromPreset(grant.presetCode)];
  return label ? '<span class="phfk-badge phfk-badge-role">'+esc(label)+'</span>' : '';
}
function accountFacetSelectHtml(key){
  var search = (permState.accountSearch||'').trim().toLowerCase();
  var filters = permState.accountFilters;
  var current = filters[key] || '';
  var options = accountFacetOptions(key, filters, search);
  var opts = '<option value="">Tất cả '+esc(ACCOUNT_FACET_LABELS[key])+'</option>' +
    options.map(function(v){ return '<option value="'+esc(v)+'"'+(v===current?' selected':'')+'>'+esc(v)+'</option>'; }).join('');
  return '<select class="phfk-input" data-knl-account-filter="'+key+'">'+opts+'</select>';
}
/* Chỉ khối này refresh khi gõ tìm/đổi filter (không phải toàn bộ
   .phfk-perm-account-picker) để KHÔNG mất focus ô tìm kiếm giữa lúc gõ. */
function accountResultsHtml(){
  normalizeAccountFilters();
  var list = filteredAccounts();
  var totalPages = Math.max(1, Math.ceil(list.length / ACCOUNT_PAGE_SIZE));
  if(permState.accountPage >= totalPages) permState.accountPage = totalPages - 1;
  if(permState.accountPage < 0) permState.accountPage = 0;
  var pageItems = list.slice(permState.accountPage*ACCOUNT_PAGE_SIZE, permState.accountPage*ACCOUNT_PAGE_SIZE + ACCOUNT_PAGE_SIZE);
  /* Grid card thay vì list dọc — tận dụng chiều ngang desktop khi flow đã
     full-width (không còn bị bó trong cột sidebar 340px như trước). */
  var cardsHtml = pageItems.length ? '<div class="phfk-perm-account-grid">' + pageItems.map(function(a){
    var selected = a.id === permState.selectedAccountId;
    return '<button type="button" class="phfk-perm-account-card'+(selected?' is-selected':'')+'" data-knl-select-account="'+esc(a.id)+'">' +
      '<div class="phfk-perm-account-card-top"><b>'+esc(a.name||a.email||'—')+'</b>'+accountRoleBadgeHtml(a)+'</div>' +
      '<small>'+esc(a.employeeCode||a.email||'')+(a.position?' · '+esc(a.position):'')+'</small>' +
      (a.department?'<small class="phfk-perm-account-card-dept">'+esc(a.department)+(a.branch?' · '+esc(a.branch):'')+'</small>':'') +
    '</button>';
  }).join('') + '</div>' : '<p class="phfk-perm-account-empty">Không tìm thấy nhân sự phù hợp.</p>';
  var pagination = totalPages>1 ? (
    '<div class="phfk-perm-account-pagination">' +
      '<button type="button" data-knl-account-page="-1"'+(permState.accountPage<=0?' disabled':'')+'>‹ Trước</button>' +
      '<span>Trang '+(permState.accountPage+1)+'/'+totalPages+'</span>' +
      '<button type="button" data-knl-account-page="1"'+(permState.accountPage>=totalPages-1?' disabled':'')+'>Sau ›</button>' +
    '</div>'
  ) : '';
  return '' +
    '<div data-knl-account-results>' +
      '<div class="phfk-perm-account-filters">' +
        accountFacetSelectHtml('department') + accountFacetSelectHtml('branch') + accountFacetSelectHtml('position') +
      '</div>' +
      cardsHtml +
      pagination +
    '</div>';
}
function refreshAccountResults(root){
  var section = root.querySelector('[data-knl-account-results]');
  if(!section) return;
  var wrap = document.createElement('div');
  wrap.innerHTML = accountResultsHtml();
  section.replaceWith(wrap.firstElementChild);
  bindAccountResults(root);
}
function bindAccountResults(root){
  root.querySelectorAll('[data-knl-account-page]').forEach(function(btn){
    btn.addEventListener('click', function(){
      permState.accountPage += Number(btn.getAttribute('data-knl-account-page'));
      refreshAccountResults(root);
    });
  });
  root.querySelectorAll('[data-knl-select-account]').forEach(function(btn){
    btn.addEventListener('click', function(){ selectAccount(root, btn.getAttribute('data-knl-select-account')); });
  });
  root.querySelectorAll('[data-knl-account-filter]').forEach(function(sel){
    sel.addEventListener('change', function(){
      permState.accountFilters[sel.getAttribute('data-knl-account-filter')] = sel.value;
      permState.accountPage = 0;
      refreshAccountResults(root);
    });
  });
}
function accountPickerExpandedHtml(){
  return '' +
    '<section class="phfk-panel phfk-perm-account-picker">' +
      '<div class="phfk-perm-picker-head"><small>1. CHỌN NHÂN SỰ</small></div>' +
      '<input type="search" class="phfk-input" placeholder="Tìm mã NV hoặc họ tên…" value="'+esc(permState.accountSearch)+'" data-knl-account-search>' +
      accountResultsHtml() +
    '</section>';
}
/* Sau khi đã chọn 1 người, thu gọn bước 1 thành 1 dòng summary + nút "Đổi
   nhân sự" (mở lại picker đầy đủ) — KHÔNG xoá permState.selectedAccountId/
   editing khi mở lại picker, để các bước cấu hình bên dưới vẫn giữ nguyên
   cho tới khi Admin thật sự bấm chọn 1 người khác (selectAccount()). */
function accountSummaryBarHtml(acc){
  return '' +
    '<section class="phfk-panel phfk-perm-account-summary">' +
      '<div class="phfk-perm-picker-head"><small>1. NHÂN SỰ ĐANG CẤU HÌNH</small></div>' +
      '<div class="phfk-perm-account-summary-row">' +
        '<div class="phfk-perm-account-summary-main">' +
          '<b>'+esc(acc.name||acc.email||'—')+'</b>' +
          accountRoleBadgeHtml(acc) +
          '<small>'+esc(acc.employeeCode||acc.email||'')+(acc.position?' · '+esc(acc.position):'')+(acc.department?' · '+esc(acc.department):'')+(acc.branch?' · '+esc(acc.branch):'')+'</small>' +
        '</div>' +
        '<button type="button" class="phfk-btn-secondary phfk-perm-change-account" data-knl-change-account>Đổi nhân sự</button>' +
      '</div>' +
    '</section>';
}
function accountStepHtml(){
  if(!permState.pickerExpanded && permState.selectedAccountId){
    var acc = permState.accounts.find(function(a){ return a.id===permState.selectedAccountId; });
    if(acc) return accountSummaryBarHtml(acc);
  }
  return accountPickerExpandedHtml();
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
/* Picker đa lựa chọn cho phạm vi Thu nhập theo phòng ban/chi nhánh/chức danh
   — danh mục derive từ chính roster employee_profiles đã tải (permState.
   incomeValues.rows, nạp 1 lần qua listKnlPeople), KHÔNG nhập tay/API danh
   mục riêng, cùng nguyên tắc với employeePickerFiltersHtml() ở trên. */
function incomeValuePickerHtml(scopeType){
  var s = permState.incomeValues, g = permState.editing;
  var selected = (g && g.capabilities && g.capabilities.incomeScope && Array.isArray(g.capabilities.incomeScope.values)) ? g.capabilities.incomeScope.values : [];
  var selectedSet = {}; selected.forEach(function(v){ selectedSet[String(v).toUpperCase()] = true; });
  var label = INCOME_VALUE_SCOPE_LABELS[scopeType] || scopeType;
  var body;
  if(s.loading) body = '<div class="phfk-loading">Đang tải danh mục '+esc(label)+'…</div>';
  else if(s.error) body = '<p class="phfk-perm-subordinate-empty">'+esc(s.error)+'</p>';
  else {
    var values = Array.from(new Set(s.rows.map(function(r){ return r[scopeType]; }).filter(Boolean))).sort();
    body = !values.length ? '<p class="phfk-perm-subordinate-empty">Không có dữ liệu '+esc(label)+' để chọn.</p>' :
      '<div class="phfk-perm-subordinate-list">' + values.map(function(v){
        var checked = selectedSet[String(v).toUpperCase()];
        return '<label class="phfk-perm-subordinate-row"><input type="checkbox" data-knl-income-value-toggle="'+esc(v)+'"'+(checked?' checked':'')+'><span class="phfk-perm-subordinate-name">'+esc(v)+'</span></label>';
      }).join('') + '</div>';
  }
  return '<div class="phfk-perm-income-emp" data-knl-income-value-section>' + body +
    '<p class="phfk-perm-subordinate-count" data-knl-income-value-count>Đã chọn '+selected.length+' '+esc(label)+'</p>' +
  '</div>';
}

/* "Phạm vi nhân sự" trong Thiết lập nâng cao — khi type=department/employees,
   chọn từ danh mục Organization Master thật (roster listKnlPeople), KHÔNG
   nhập text tự do/raw comma-separated. Phần department dùng CHUNG roster đã
   tải cho Phạm vi Thu nhập (permState.incomeValues) vì cùng 1 nguồn dữ liệu
   (employee_profiles đang hoạt động) — chỉ khác selected values đọc từ
   g.peopleScope thay vì g.capabilities.incomeScope, 2 khái niệm này KHÔNG hề
   liên hệ nhau (đã xác nhận qua trace normalizeGrant()/normalizeIncomeScope()/
   scope() không đọc chéo). Stored contract KHÔNG đổi: peopleScope.values vẫn
   là mảng string như backend (scope()) đã hỗ trợ sẵn — multi-select chỉ đổi
   CÁCH NHẬP, không đổi shape lưu trữ, round-trip an toàn tuyệt đối. */
function advScopeDepartmentPickerHtml(){
  var s = permState.incomeValues, g = permState.editing;
  var selected = (g && g.peopleScope && Array.isArray(g.peopleScope.values)) ? g.peopleScope.values : [];
  var selectedSet = {}; selected.forEach(function(v){ selectedSet[String(v).toUpperCase()] = true; });
  var body;
  if(s.loading) body = '<div class="phfk-loading">Đang tải danh mục phòng ban…</div>';
  else if(s.error) body = '<p class="phfk-perm-subordinate-empty">'+esc(s.error)+'</p>';
  else {
    var values = Array.from(new Set(s.rows.map(function(r){ return r.department; }).filter(Boolean))).sort();
    body = !values.length ? '<p class="phfk-perm-subordinate-empty">Không có dữ liệu phòng ban để chọn.</p>' :
      '<div class="phfk-perm-subordinate-list">' + values.map(function(v){
        var checked = selectedSet[String(v).toUpperCase()];
        return '<label class="phfk-perm-subordinate-row"><input type="checkbox" data-knl-adv-dept-toggle="'+esc(v)+'"'+(checked?' checked':'')+'><span class="phfk-perm-subordinate-name">'+esc(v)+'</span></label>';
      }).join('') + '</div>';
  }
  return '<div class="phfk-field phfk-perm-income-emp" data-knl-adv-dept-section><span>Chọn phòng ban</span>' + body +
    '<p class="phfk-perm-subordinate-count" data-knl-adv-dept-count>Đã chọn '+selected.length+' phòng ban</p>' +
  '</div>';
}
function refreshAdvDeptSection(root){
  var section = root.querySelector('[data-knl-adv-dept-section]');
  if(!section) return;
  var wrap = document.createElement('div');
  wrap.innerHTML = advScopeDepartmentPickerHtml();
  section.replaceWith(wrap.firstElementChild);
  bindAdvDeptSection(root);
}
function bindAdvDeptSection(root){
  root.querySelectorAll('[data-knl-adv-dept-toggle]').forEach(function(box){
    box.addEventListener('change', function(){
      var g = permState.editing; if(!g) return;
      var values = (g.peopleScope && Array.isArray(g.peopleScope.values)) ? g.peopleScope.values.slice() : [];
      var val = box.getAttribute('data-knl-adv-dept-toggle');
      var upper = String(val).toUpperCase();
      var idx = values.findIndex(function(v){ return String(v).toUpperCase()===upper; });
      if(box.checked){ if(idx<0) values.push(val); } else if(idx>=0) values.splice(idx,1);
      g.peopleScope = Object.assign({}, g.peopleScope, { type:'department', values:values });
      var countEl = root.querySelector('[data-knl-adv-dept-count]');
      if(countEl) countEl.textContent = 'Đã chọn '+values.length+' phòng ban';
    });
  });
}
function advScopeEmployeePickerHtml(){
  var s = permState.advEmployees, g = permState.editing;
  var selected = (g && g.peopleScope && Array.isArray(g.peopleScope.values)) ? g.peopleScope.values : [];
  return '' +
    '<div class="phfk-field phfk-perm-subordinate" data-knl-adv-emp-section>' +
      '<span>Chọn nhân sự cụ thể</span>' +
      employeePickerFiltersHtml('knl-adv-emp', s) +
      employeePickerListHtml('knl-adv-emp', s, selected) +
      '<p class="phfk-perm-subordinate-count" data-knl-adv-emp-count>Đã chọn '+selected.length+' nhân sự</p>' +
    '</div>';
}
function refreshAdvEmpSection(root){
  var section = root.querySelector('[data-knl-adv-emp-section]');
  if(!section) return;
  var wrap = document.createElement('div');
  wrap.innerHTML = advScopeEmployeePickerHtml();
  section.replaceWith(wrap.firstElementChild);
  bindAdvEmpSection(root);
}
function loadAdvEmployees(root){
  loadEmployeePicker(root, 'knl-adv-emp', permState.advEmployees, '[data-knl-adv-emp-section]', refreshAdvEmpSection);
}
function bindAdvEmpSection(root){
  bindEmployeePickerFilters(root, 'knl-adv-emp', permState.advEmployees, function(){ loadAdvEmployees(root); });
  bindEmployeePickerToggles(root, 'knl-adv-emp', function(code, checked){
    var g = permState.editing; if(!g) return;
    var values = (g.peopleScope && Array.isArray(g.peopleScope.values)) ? g.peopleScope.values.slice() : [];
    var upper = String(code).toUpperCase();
    var idx = values.findIndex(function(v){ return String(v).toUpperCase()===upper; });
    if(checked){ if(idx<0) values.push(code); } else if(idx>=0) values.splice(idx,1);
    g.peopleScope = Object.assign({}, g.peopleScope, { type:'employees', values:values });
    var countEl = root.querySelector('[data-knl-adv-emp-count]');
    if(countEl) countEl.textContent = 'Đã chọn '+values.length+' nhân sự';
  });
}

function advancedSectionHtml(g, stepNum){
  var presetOptions = permState.presets.map(function(p){ return '<option value="'+esc(p.code)+'"'+(g.presetCode===p.code?' selected':'')+'>'+esc(p.name)+'</option>'; }).join('');
  var capabilityKeys = Object.keys(CAPABILITY_LABELS);
  var capabilityBoxes = capabilityKeys.map(function(key){
    var checked = g.capabilities && g.capabilities[key] ? ' checked' : '';
    return '<label class="phfk-check"><input type="checkbox" data-knl-adv-cap="'+key+'"'+checked+'> '+CAPABILITY_LABELS[key]+'</label>';
  }).join('');
  var scopeOptions = Object.keys(SCOPE_LABELS).map(function(t){ return '<option value="'+t+'"'+(g.peopleScope && g.peopleScope.type===t?' selected':'')+'>'+SCOPE_LABELS[t]+'</option>'; }).join('');
  var scopeType = g.peopleScope && g.peopleScope.type;
  return '' +
    '<details class="phfk-perm-advanced" data-knl-advanced'+(permState.advancedOpen?' open':'')+'>' +
      '<summary>'+stepNum+'. Thiết lập nâng cao</summary>' +
      '<div class="phfk-perm-advanced-body">' +
        '<label class="phfk-field"><span>Mẫu quyền</span><select class="phfk-input" data-knl-adv-preset>'+presetOptions+'</select></label>' +
        '<div class="phfk-field"><span>Năng lực</span><div class="phfk-checklist">'+capabilityBoxes+'</div></div>' +
        '<label class="phfk-field"><span>Phạm vi nhân sự</span><select class="phfk-input" data-knl-adv-scope-type>'+scopeOptions+'</select></label>' +
        (scopeType==='department' ? advScopeDepartmentPickerHtml() : '') +
        (scopeType==='employees' ? advScopeEmployeePickerHtml() : '') +
      '</div>' +
    '</details>';
}

/* Đọc-hiểu "Phạm vi nhân sự được quản lý" (peopleScope) — CHỈ trực quan hoá
   giá trị peopleScope đang có (do vai trò quyết định tự động), KHÔNG thêm
   lựa chọn mới. Radio hiển thị readonly (không click được) trừ trường hợp
   type==='employees' (TBP) — nơi peopleScope thật sự do Admin chọn qua
   picker nhân sự cụ thể bên dưới, giữ nguyên đúng hành vi cũ. */
var PEOPLE_SCOPE_READOUT_ORDER = ['all_company','department','sales_all_branches','employees','self'];
function peopleScopeSectionHtml(roleKey, g){
  var scopeType = (g.peopleScope && g.peopleScope.type) || 'self';
  var rows = PEOPLE_SCOPE_READOUT_ORDER.filter(function(t){ return t===scopeType || t==='all_company' || t==='department' || t==='employees'; })
    .map(function(t){
      var active = t===scopeType;
      return '<label class="phfk-radio phfk-perm-scope-readout-row'+(active?' is-active':'')+'"><input type="radio" disabled'+(active?' checked':'')+'> '+esc(SCOPE_LABELS[t]||t)+'</label>';
    }).join('');
  var hint = scopeType==='employees'
    ? 'Chọn danh sách nhân sự cụ thể bên dưới.'
    : 'Phạm vi này do vai trò KNL ở trên quyết định. Cần loại phạm vi khác (theo chi nhánh…) thì dùng "Thiết lập nâng cao".';
  return '' +
    '<div class="phfk-perm-scope-readout">' +
      '<span>Phạm vi được quản lý</span>' +
      rows +
      '<p class="phfk-perm-scope-hint">'+esc(hint)+'</p>' +
      (scopeType==='employees' ? subordinatePickerHtml() : '') +
    '</div>';
}

/* Thu nhập: checkbox -> (nếu bật) link "Thiết lập phạm vi" -> (nếu mở) radio
   Tất cả nhân sự / Chọn nhân sự cụ thể -> (nếu specific) picker nhân sự.
   KHÔNG có trạng thái ngầm định "chưa chọn = tất cả" — cả 2 radio đều có
   thể để trống lúc mới bật, Lưu sẽ chặn (client + backend) tới khi chọn rõ. */
/* "4. Phạm vi Thu nhập" gắn với income_view ĐANG BẬT (không gắn với việc
   accordion đang mở/đóng) — đóng/mở "Thiết lập phạm vi" chỉ ẩn/hiện phần
   radio chi tiết, KHÔNG được làm số bước 5/6 phía sau nhảy số theo trạng
   thái mở/đóng đó. */
function incomeSectionHtml(g){
  var incomeChecked = !!(g.capabilities && g.capabilities.income_view);
  var scopeObj = g.capabilities && g.capabilities.incomeScope;
  var scopeType = scopeObj && scopeObj.type;
  var html = '<div class="phfk-field phfk-perm-income"><span>3. Quyền chức năng</span>' +
    '<label class="phfk-check phfk-perm-income-check"><input type="checkbox" data-knl-income-view'+(incomeChecked?' checked':'')+'> Xem Thu nhập <span class="phfk-badge phfk-badge-warning">Nhạy cảm</span></label>' +
    '<p class="phfk-perm-income-helper">Cho phép xem thông tin thu nhập theo phạm vi được cấp.</p>';
  if(incomeChecked){
    html += '<div class="phfk-perm-income-config-head"><small>4. PHẠM VI THU NHẬP</small>' +
      '<button type="button" class="phfk-link phfk-perm-income-toggle" data-knl-income-config-toggle>'+(permState.incomeConfigOpen?'Ẩn phạm vi ▴':'Thiết lập phạm vi ▾')+'</button></div>';
    if(permState.incomeConfigOpen){
      html += '<div class="phfk-perm-income-config">' +
        '<label class="phfk-radio"><input type="radio" name="knl-income-scope-type" data-knl-income-scope-type value="all_company"'+(scopeType==='all_company'?' checked':'')+'> Toàn công ty</label>' +
        '<label class="phfk-radio"><input type="radio" name="knl-income-scope-type" data-knl-income-scope-type value="department"'+(scopeType==='department'?' checked':'')+'> Theo phòng ban</label>' +
        '<label class="phfk-radio"><input type="radio" name="knl-income-scope-type" data-knl-income-scope-type value="branch"'+(scopeType==='branch'?' checked':'')+'> Theo chi nhánh</label>' +
        '<label class="phfk-radio"><input type="radio" name="knl-income-scope-type" data-knl-income-scope-type value="title"'+(scopeType==='title'?' checked':'')+'> Theo chức danh</label>' +
        '<label class="phfk-radio"><input type="radio" name="knl-income-scope-type" data-knl-income-scope-type value="employees"'+(scopeType==='employees'?' checked':'')+'> Chọn nhân sự cụ thể</label>' +
        (scopeType==='employees' ? incomeEmployeePickerHtml() : (INCOME_VALUE_SCOPE_LABELS[scopeType] ? incomeValuePickerHtml(scopeType) : '')) +
      '</div>';
    }
  }
  html += '</div>';
  return html;
}

function permConfigPanel(){
  if(!permState.selectedAccountId || !permState.editing) return '<section class="phfk-panel phfk-perm-config phfk-perm-config-empty"><p>Chọn một nhân sự ở bước 1 để cấu hình quyền KNL.</p></section>';
  var acc = permState.accounts.find(function(a){ return a.id===permState.selectedAccountId; });
  if(!acc) return '';
  var g = permState.editing;
  var isHubAdmin = String(acc.role).toLowerCase()==='admin';
  var roleKey = businessRoleForAccount(acc, g);

  var head = '<div class="phfk-perm-config-head"><small>ĐANG CẤU HÌNH</small><h2>'+esc(acc.name||acc.email)+'</h2><p>'+esc(acc.employeeCode||acc.email||'')+(acc.position?' · '+esc(acc.position):'')+(acc.department?' · '+esc(acc.department):'')+(acc.branch?' · '+esc(acc.branch):'')+'</p></div>';

  var roleSection;
  if(isHubAdmin){
    roleSection = '<div class="phfk-perm-role-readonly"><small>2. VAI TRÒ KNL</small><strong>Admin <span class="phfk-badge phfk-badge-warning">Quyền rất cao</span></strong><p>Toàn quyền KNL theo tài khoản Hub (đường cứu hộ) — không cấu hình được ở màn này.</p></div>';
  }else{
    roleSection = '<div class="phfk-field"><span>2. Vai trò KNL</span><div class="phfk-perm-role-cards">' +
      BUSINESS_ROLES.map(function(r){
        return '<button type="button" class="phfk-perm-role-card'+(roleKey===r.key?' active':'')+'" data-knl-role="'+r.key+'">' +
          '<b>'+esc(r.label)+'</b><small>'+esc(r.subtitle)+'</small>' +
        '</button>';
      }).join('') +
      '<button type="button" class="phfk-perm-role-card is-disabled" disabled title="Cấp qua tài khoản Hub, không cấu hình ở đây"><b>Admin</b><small>Quản trị hệ thống</small></button>' +
      '</div>' +
      (roleKey==='unknown' ? '<p class="phfk-perm-role-hint">Tài khoản đang dùng cấu hình nâng cao (không khớp 3 vai trò trên) — chọn 1 vai trò để chuẩn hoá, hoặc xem "Thiết lập nâng cao".</p>' : '') +
    '</div>';
  }

  var scopeSection = (!isHubAdmin && roleKey) ? peopleScopeSectionHtml(roleKey, g) : '';
  var incomeSection = incomeSectionHtml(g);
  var activeSection = isHubAdmin ? '' : '<label class="phfk-check phfk-perm-active-toggle"><input type="checkbox" data-knl-active'+(g.isActive!==false?' checked':'')+'> Đang cấp quyền KNL</label>';
  /* Numbering render đúng theo trạng thái thực tế — "4. Phạm vi Thu nhập"
     chỉ tồn tại khi income_view đang bật (không phụ thuộc accordion mở/
     đóng, xem incomeSectionHtml). Có mục đó thì Lý do/Nâng cao lùi xuống
     5/6, không có thì giữ 4/5 — không fake bằng CSS. */
  var hasIncomeStep = !!(g.capabilities && g.capabilities.income_view);
  var reasonStepNum = hasIncomeStep ? 5 : 4;
  var advancedStepNum = hasIncomeStep ? 6 : 5;
  var reasonSection = '<label class="phfk-field phfk-perm-reason"><span>'+reasonStepNum+'. Lý do thay đổi quyền</span><textarea class="phfk-input" rows="2" placeholder="Nhập lý do thay đổi quyền..." data-knl-reason>'+esc(g.reason||'')+'</textarea></label>';

  /* PHF UX fix (2026-08-13, smoke-test blocker): CHỈ MỘT save boundary cho
     toàn bộ form (bước 2->6) — nút Lưu trước đây render TRƯỚC "6. Thiết lập
     nâng cao" khiến người dùng hiểu nhầm Advanced là khối tách biệt/tự lưu
     riêng (dù về mặt state, checkbox trong Advanced vẫn ghi thẳng vào đúng
     permState.editing.capabilities mà saveGrant() đọc — đã verify round-trip
     đúng ở cả backend lẫn DOM thật, xem scripts/test-knl-dashboard-view-
     capability-roundtrip-2026-08.js và scripts/test-knl-permission-advanced-
     save-boundary-2026-08.js). Fix ở đây thuần UX: chuyển "Hủy | Lưu thay
     đổi" xuống CUỐI form, sau Advanced — không có CTA nào khác, không đổi
     event wiring/permission contract. */
  return '' +
    '<section class="phfk-panel phfk-perm-config">' +
      head + roleSection + scopeSection + incomeSection + activeSection + reasonSection +
      advancedSectionHtml(g, advancedStepNum) +
      '<p class="phfk-error" data-knl-form-error hidden></p>' +
      '<div class="phfk-form-actions">' +
        '<button type="button" class="phfk-btn-secondary" data-knl-cancel-grant'+(permState.saving?' disabled':'')+'>Hủy</button>' +
        '<button type="button" class="phfk-btn-primary" data-knl-save-grant'+(permState.saving?' disabled':'')+'>Lưu thay đổi</button>' +
      '</div>' +
    '</section>';
}

/* Flow dọc full-width (không còn master-detail 2 cột): bước 1 trên cùng
   (picker mở rộng hoặc summary bar khi đã chọn), các bước cấu hình quyền
   chỉ render bên dưới khi đã có nhân sự đang chọn — không để lại khối
   "Chọn một nhân sự để cấu hình" trống chiếm chỗ khi bước 1 đang mở sẵn. */
function renderPermissionsBody(root){
  var body = root.querySelector('[data-knl-body]');
  if(!body) return;
  var configHtml = (permState.selectedAccountId && permState.editing) ? permConfigPanel() : '';
  body.innerHTML = '' +
    '<div class="phfk-page-head"><div><small>KNL &middot; PHÂN QUYỀN</small><h1>Phân quyền KNL</h1></div></div>' +
    (permState.loading ? '<div class="phfk-loading">Đang tải…</div>' : ('<div class="phfk-perm-flow">' + accountStepHtml() + configHtml + '</div>'));
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

/* Danh mục phòng ban/chi nhánh/chức danh cho phạm vi Thu nhập — tải 1 lần từ
   roster thật (listKnlPeople, cùng nguồn employee_profiles đã dùng cho picker
   nhân sự), dùng chung cho cả 3 loại scope (department/branch/title) nên
   không cần tải lại khi Admin đổi qua lại giữa 3 radio này. */
function refreshIncomeValueSection(root){
  var section = root.querySelector('[data-knl-income-value-section]');
  var g = permState.editing;
  if(!section || !g || !g.capabilities || !g.capabilities.incomeScope) return;
  var wrap = document.createElement('div');
  wrap.innerHTML = incomeValuePickerHtml(g.capabilities.incomeScope.type);
  section.replaceWith(wrap.firstElementChild);
  bindIncomeValueSection(root);
}
/* permState.incomeValues là roster DÙNG CHUNG cho nhiều picker độc lập (Phạm
   vi Thu nhập VÀ Phạm vi nhân sự ở Thiết lập nâng cao — 2 field khác nhau,
   cùng 1 nguồn Organization Master nên chỉ tải 1 lần). Một tài khoản có thể
   cần CẢ HAI cùng lúc (vd Trợ lý Giám đốc có incomeScope.type=department VÀ
   peopleScope.type=department) -> loadIncomeValues() bị gọi 2 lần liên tiếp
   trong cùng 1 tick khi selectAccount() chạy. Nếu lượt gọi thứ 2 thấy
   s.loading=true mà gọi onReady() ngay (fetch lượt 1 CHƯA XONG) thì picker
   của lượt 2 sẽ chốt HTML "Đang tải…" và không bao giờ được refresh lại nữa
   vì chỉ đúng 1 onReady (của lượt 1) được fetch .then() gọi khi xong — đây
   chính là bug "Đang tải danh mục phòng ban…" bị kẹt dù values đã có sẵn.
   Fix: xếp hàng onReady của các lượt gọi khi đang có fetch chạy dở, gọi lại
   TẤT CẢ khi fetch thật sự xong (thành công lẫn lỗi). */
function loadIncomeValues(root, onReady){
  var s = permState.incomeValues;
  if(s.rows.length){ if(onReady) onReady(); return; }
  if(s.loading){ if(onReady) s.pendingCallbacks.push(onReady); return; }
  s.loading = true; s.error = ''; s.pendingCallbacks = [];
  function settle(){
    var callbacks = s.pendingCallbacks; s.pendingCallbacks = [];
    if(onReady) onReady();
    callbacks.forEach(function(cb){ cb(); });
  }
  apiPost('listKnlPeople', { status:'active' }).then(function(data){
    s.rows = data.people || []; s.loading = false;
    settle();
  }).catch(function(e){
    s.error = e.message; s.loading = false;
    settle();
  });
}
function bindIncomeValueSection(root){
  root.querySelectorAll('[data-knl-income-value-toggle]').forEach(function(box){
    box.addEventListener('change', function(){
      var g = permState.editing; if(!g) return;
      var scopeObj = (g.capabilities && g.capabilities.incomeScope) || { type:'department', values:[] };
      var values = Array.isArray(scopeObj.values) ? scopeObj.values.slice() : [];
      var val = box.getAttribute('data-knl-income-value-toggle');
      var upper = String(val).toUpperCase();
      var idx = values.findIndex(function(v){ return String(v).toUpperCase()===upper; });
      if(box.checked){ if(idx<0) values.push(val); }
      else if(idx>=0) values.splice(idx,1);
      g.capabilities = Object.assign({}, g.capabilities, { incomeScope: Object.assign({}, scopeObj, { values:values }) });
      var countEl = root.querySelector('[data-knl-income-value-count]');
      if(countEl) countEl.textContent = 'Đã chọn '+values.length+' '+esc(INCOME_VALUE_SCOPE_LABELS[scopeObj.type]||scopeObj.type);
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
    refreshAccountResults(root);
  });
  bindAccountResults(root);
  var changeAccountBtn = root.querySelector('[data-knl-change-account]');
  if(changeAccountBtn) changeAccountBtn.addEventListener('click', function(){
    permState.pickerExpanded = true;
    renderPermissionsBody(root);
  });

  /* Chỉ áp peopleScope mặc định theo vai trò khi vai trò THỰC SỰ đổi
     (roleChanged) — bấm lại đúng role card đang active (vd Admin chỉ đổi
     Xem Thu nhập/Lý do rồi lỡ chạm lại thẻ vai trò) KHÔNG được xoá scope
     tuỳ biến đã cấu hình sẵn (vd Trợ lý Giám đốc với peopleScope theo danh
     sách phòng ban cụ thể) — trước đây luôn ghi đè vô điều kiện, đây là bug
     rủi ro mất cấu hình thật đã phát hiện qua trace. */
  root.querySelectorAll('[data-knl-role]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var g = permState.editing; if(!g) return;
      var roleDef = BUSINESS_ROLES.find(function(r){ return r.key===btn.getAttribute('data-knl-role'); });
      if(!roleDef) return;
      var roleChanged = roleKeyFromPreset(g.presetCode) !== roleDef.key;
      g.presetCode = roleDef.presetCode;
      g.capabilities = Object.assign({}, g.capabilities, { access_knl:true, view_people:true });
      if(roleDef.key==='tbp'){
        g.peopleScope = (g.peopleScope && g.peopleScope.type==='employees') ? g.peopleScope : { type:'employees', values:[] };
      }else if(roleDef.key==='assistant'){
        if(roleChanged) g.peopleScope = { type:'all_company', values:[] };
      }else{
        if(roleChanged) g.peopleScope = { type:'self', values:[] };
      }
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
  bindIncomeValueSection(root);
  root.querySelectorAll('[data-knl-income-scope-type]').forEach(function(radio){
    radio.addEventListener('change', function(){
      if(!radio.checked) return;
      var g = permState.editing; if(!g) return;
      var type = radio.value;
      /* Đổi loại phạm vi luôn reset values về rỗng — không mang giá trị của
         loại cũ sang loại mới (vd tên phòng ban không được lẫn vào chi
         nhánh), Admin phải tự chọn lại rõ ràng cho loại vừa đổi sang. */
      g.capabilities = Object.assign({}, g.capabilities, { incomeScope: { type:type, values: [] } });
      renderPermissionsBody(root);
      if(type==='employees') loadIncomeEmp(root);
      else if(INCOME_VALUE_SCOPE_LABELS[type]) loadIncomeValues(root, function(){ refreshIncomeValueSection(root); });
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
    if(g.peopleScope && g.peopleScope.type==='department') loadIncomeValues(root, function(){ refreshAdvDeptSection(root); });
    else if(g.peopleScope && g.peopleScope.type==='employees') loadAdvEmployees(root);
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
    var newType = advScopeType.value;
    var priorType = g.peopleScope && g.peopleScope.type;
    /* Đổi loại phạm vi luôn reset values về rỗng — không mang giá trị của
       loại cũ sang loại mới (vd mã nhân sự cũ lẫn vào danh sách phòng ban
       mới), cùng nguyên tắc đã áp dụng cho incomeScope-type. */
    g.peopleScope = { type: newType, values: newType===priorType ? ((g.peopleScope && g.peopleScope.values) || []) : [] };
    permState.advancedOpen = true;
    renderPermissionsBody(root);
    if(newType==='department') loadIncomeValues(root, function(){ refreshAdvDeptSection(root); });
    else if(newType==='employees') loadAdvEmployees(root);
  });
  bindAdvDeptSection(root);
  bindAdvEmpSection(root);

  var saveBtn = root.querySelector('[data-knl-save-grant]');
  if(saveBtn) saveBtn.addEventListener('click', function(){ saveGrant(root); });
  /* Hủy: bỏ mọi thay đổi CHƯA Lưu, nạp lại đúng permState.editing từ dữ liệu
     đã lưu gần nhất (permState.grants, y hệt lúc chọn tài khoản lần đầu) —
     tái dùng selectAccount() thay vì tạo khái niệm "revert" mới. */
  var cancelBtn = root.querySelector('[data-knl-cancel-grant]');
  if(cancelBtn) cancelBtn.addEventListener('click', function(){
    if(!permState.selectedAccountId) return;
    selectAccount(root, permState.selectedAccountId);
  });
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
    if(!incomeScopeCheck || !incomeScopeCheck.type){ if(errorEl){ errorEl.hidden=false; errorEl.textContent='Vui lòng chọn phạm vi xem Thu nhập (Toàn công ty, Phòng ban, Chi nhánh, Chức danh hoặc Chọn nhân sự cụ thể).'; } return; }
    if(INCOME_VALUE_SCOPE_LABELS[incomeScopeCheck.type] && (!Array.isArray(incomeScopeCheck.values) || !incomeScopeCheck.values.length)){ if(errorEl){ errorEl.hidden=false; errorEl.textContent='Vui lòng chọn ít nhất một '+INCOME_VALUE_SCOPE_LABELS[incomeScopeCheck.type]+' cho phạm vi Thu nhập.'; } return; }
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
    if(saved.capabilities && saved.capabilities.income_view && saved.capabilities.incomeScope){
      var savedScopeType = saved.capabilities.incomeScope.type;
      if(savedScopeType==='employees') loadIncomeEmp(root);
      else if(INCOME_VALUE_SCOPE_LABELS[savedScopeType]) loadIncomeValues(root, function(){ refreshIncomeValueSection(root); });
    }
    if(saved.peopleScope && saved.peopleScope.type==='department') loadIncomeValues(root, function(){ refreshAdvDeptSection(root); });
    else if(saved.peopleScope && saved.peopleScope.type==='employees' && roleKeyFromPreset(saved.presetCode)!=='tbp') loadAdvEmployees(root);
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
  permState.pickerExpanded = true;
  renderPermissionsBody(root);
}

/* ===================== BỘ KNL / DRAFT STRUCTURE (BATCH 1) ===================== */

var frameworkState={frameworks:[],selectedVersionId:'',detail:null,loading:false,loaded:false,loadedAt:0,error:''};
function statusLabel(value){return value==='published'?'Đang áp dụng':(value==='inactive'?'Ngưng áp dụng':'Chưa áp dụng');}
function findFrameworkForVersion(versionId){return frameworkState.frameworks.find(function(f){return (f.versions||[]).some(function(v){return v.id===versionId;});});}
function orderedActive(rows){return (rows||[]).filter(function(row){return row.isActive!==false;}).slice().sort(function(a,b){return a.sortOrder-b.sortOrder;});}
function frameworkSelectorHtml(){
  var frameworks=frameworkState.frameworks||[];
  var currentFramework=findFrameworkForVersion(frameworkState.selectedVersionId)||frameworks[0];
  var fwOptions=frameworks.map(function(f){return '<option value="'+esc(f.id)+'"'+(currentFramework&&currentFramework.id===f.id?' selected':'')+'>'+esc(f.name)+'</option>';}).join('');
  var versions=(currentFramework&&currentFramework.versions||[]).slice().sort(function(a,b){return b.versionNumber-a.versionNumber;});
  var verOptions=versions.map(function(v){return '<option value="'+esc(v.id)+'"'+(frameworkState.selectedVersionId===v.id?' selected':'')+'>v'+v.versionNumber+' · '+statusLabel(v.status)+(v.isLocked?' · Đã khóa':'')+'</option>';}).join('');
  var breadcrumb='Bộ KNL'+(currentFramework?' › '+esc(currentFramework.name):'')+(frameworkState.detail?' › Phiên bản v'+esc(frameworkState.detail.version.versionNumber):'');
  if(!frameworks.length)return '<p class="phfk-empty">Chưa có bộ KNL nào. Bấm "+ Tạo bộ KNL" để bắt đầu.</p>';
  return '<div class="phfk-selector-bar">'+
    '<label class="phfk-field"><span>Chọn Bộ KNL</span><select class="phfk-input" data-knl-framework-select>'+fwOptions+'</select></label>'+
    '<label class="phfk-field"><span>Phiên bản</span><select class="phfk-input" data-knl-version-select'+(!versions.length?' disabled':'')+'>'+(versions.length?verOptions:'<option>Chưa có phiên bản</option>')+'</select></label>'+
    '</div><p class="phfk-breadcrumb">'+breadcrumb+'</p>';
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
  return '<section class="phfk-panel phfk-structure-panel"><div class="phfk-section-head"><div><small>CẤU TRÚC DỰ THẢO</small><h2>Nhóm & hạng mục năng lực</h2></div>'+(mutable?'<button class="phfk-btn-primary" type="button" data-knl-add-group>+ Thêm nhóm</button>':'')+'</div>'+
    (!itemColumn?'<p class="phfk-warning">Dự thảo đang thiếu cột Hạng mục. Thêm lại trước khi phát hành.</p>':'')+
    groups.map(function(g,gIndex){var groupItems=items.filter(function(i){return i.groupId===g.id;});return '<article class="phfk-group-block"><header><div><b>'+esc(g.name)+'</b><small>'+esc(g.description||'Không có mô tả nhóm')+'</small></div>'+(mutable?'<span class="phfk-mini-actions"><button data-knl-group-move="'+esc(g.id)+'" data-direction="-1"'+(gIndex===0?' disabled':'')+'>↑</button><button data-knl-group-move="'+esc(g.id)+'" data-direction="1"'+(gIndex===groups.length-1?' disabled':'')+'>↓</button><button data-knl-edit-group="'+esc(g.id)+'">Sửa</button><button data-knl-add-item="'+esc(g.id)+'">+ Hạng mục</button><button data-knl-delete="group:'+esc(g.id)+'">Xóa</button></span>':'')+'</header>'+
      '<div class="phfk-dynamic-table-wrap"><table class="phfk-dynamic-table"><thead><tr>'+(itemColumn?'<th>'+esc(itemColumn.label)+'</th>':'')+(descriptionColumn?'<th>'+esc(descriptionColumn.label)+'</th>':'')+levels.map(function(c){return '<th>'+esc(c.label)+'</th>';}).join('')+(mutable?'<th>Thao tác</th>':'')+'</tr></thead><tbody>'+
      (groupItems.length?groupItems.map(function(item,index){return '<tr>'+(itemColumn?'<td><b>'+esc(item.name)+'</b></td>':'')+(descriptionColumn?'<td>'+esc(item.description||'—')+'</td>':'')+levels.map(function(c){return '<td>'+(mutable?'<textarea data-knl-level-content="'+esc(item.id)+':'+esc(c.id)+'" aria-label="'+esc(item.name+' - '+c.label)+'">'+esc(contentMap[item.id+':'+c.id]||'')+'</textarea>':esc(contentMap[item.id+':'+c.id]||'—'))+'</td>';}).join('')+(mutable?'<td><span class="phfk-mini-actions"><button data-knl-item-move="'+esc(item.id)+'" data-group-id="'+esc(g.id)+'" data-direction="-1"'+(index===0?' disabled':'')+'>↑</button><button data-knl-item-move="'+esc(item.id)+'" data-group-id="'+esc(g.id)+'" data-direction="1"'+(index===groupItems.length-1?' disabled':'')+'>↓</button><button data-knl-edit-item="'+esc(item.id)+'">Sửa</button><button data-knl-delete="item:'+esc(item.id)+'">Xóa</button></span></td>':'')+'</tr>';}).join(''):'<tr><td colspan="'+Math.max(1,(itemColumn?1:0)+(descriptionColumn?1:0)+levels.length+(mutable?1:0))+'">Chưa có hạng mục.</td></tr>')+'</tbody></table></div></article>';}).join('')+
    (!groups.length?'<div class="phfk-empty">Chưa có nhóm năng lực trong Dự thảo.</div>':'')+'</section>';
}
function frameworkWorkspaceHtml(){
  var detail=frameworkState.detail;
  return frameworkDomainNav('bo-knl')+'<div class="phfk-page-head"><div><small>KNL · CẤU TRÚC</small><h1>Bộ KNL &amp; cấu trúc động</h1></div><button type="button" class="phfk-btn-primary" data-knl-create-framework>+ Tạo bộ KNL</button></div>'+
    frameworkSelectorHtml()+
    (!frameworkState.frameworks.length?'':
      (!detail?'<div class="phfk-empty">Chọn một phiên bản để quản trị cấu trúc.</div>':
        '<section class="phfk-panel phfk-version-head"><div><h2>'+esc(detail.framework.name)+' <span class="phfk-source-status '+(detail.version.status==='published'&&detail.version.isLocked?'is-ready':'is-review')+'">'+statusLabel(detail.version.status)+'</span></h2><p>Phiên bản '+detail.version.versionNumber+(detail.version.isLocked?' · Đã khóa':' · Có thể chỉnh sửa')+'</p></div><div class="phfk-form-actions">'+(detail.version.status==='draft'&&!detail.version.isLocked?'<button class="phfk-btn-secondary" data-knl-publish-version>Phát hành & khóa</button>':'<button class="phfk-btn-primary" data-knl-clone-version>Tạo phiên bản mới</button>')+(detail.framework.status==='published'?'<button class="phfk-btn-secondary" data-knl-inactivate-framework>Ngưng áp dụng</button>':'')+'</div></section>'+
        structureColumnsHtml(detail)+competencyTableHtml(detail)))+
    (frameworkState.error?'<p class="phfk-error">'+esc(frameworkState.error)+'</p>':'');
}
function renderFrameworkBody(root){var body=root.querySelector('[data-knl-body]');if(body)body.innerHTML=frameworkState.loading?'<div class="phfk-loading">Đang tải cấu trúc KNL…</div>':frameworkWorkspaceHtml();bindFrameworkEvents(root);}
async function loadFrameworkDetail(root,versionId){frameworkState.selectedVersionId=versionId||'';frameworkState.detail=null;if(!versionId){renderFrameworkBody(root);return;}frameworkState.loading=true;renderFrameworkBody(root);try{frameworkState.detail=await apiPost('getKnlFrameworkVersion',{versionId:versionId});frameworkState.error='';}catch(e){frameworkState.error=e.message;}frameworkState.loading=false;renderFrameworkBody(root);}
async function loadFrameworks(root){frameworkState.loading=true;renderFrameworkBody(root);try{var data=await apiPost('listKnlFrameworks');frameworkState.frameworks=data.frameworks||[];var exists=frameworkState.frameworks.some(function(f){return (f.versions||[]).some(function(v){return v.id===frameworkState.selectedVersionId;});});if(!exists){var first=frameworkState.frameworks.reduce(function(found,f){return found||(f.versions||[]).find(function(v){return v.status==='draft';})||(f.versions||[])[0];},null);frameworkState.selectedVersionId=first?first.id:'';}frameworkState.error='';frameworkState.loaded=true;frameworkState.loadedAt=Date.now();}catch(e){frameworkState.error=e.message;frameworkState.frameworks=[];}frameworkState.loading=false;if(frameworkState.selectedVersionId)return loadFrameworkDetail(root,frameworkState.selectedVersionId);renderFrameworkBody(root);}
function moveIds(rows,id,direction){var active=orderedActive(rows),index=active.findIndex(function(x){return x.id===id;}),target=index+Number(direction);if(index<0||target<0||target>=active.length)return null;var tmp=active[index];active[index]=active[target];active[target]=tmp;return active.map(function(x){return x.id;});}
async function runFrameworkAction(root,action,extra,button){
  frameworkState.error='';
  if(button)setKnlButtonBusy(button,true,'Đang xử lý…');
  try{
    await apiPost(action,extra||{});
    // Thành công -> loadFrameworks() render lại toàn bộ body (kể cả button),
    // nên không cần khôi phục thủ công; nhưng vẫn gọi để an toàn nếu tương
    // lai có action không kèm re-render.
    await loadFrameworks(root);
    knlToast('success','Đã lưu thay đổi','Cấu trúc Bộ KNL đã được cập nhật.',2600,'knl-framework-action');
  }catch(e){
    frameworkState.error=e.message;
    renderFrameworkBody(root);
    knlToast('error','Chưa thể lưu thay đổi',e.message||'Vui lòng thử lại.',4800,'knl-framework-action');
  }finally{
    if(button)setKnlButtonBusy(button,false);
  }
}
function bindFrameworkEvents(root){
  bindFrameworkDomainNav(root);
  var fwSelect=root.querySelector('[data-knl-framework-select]');
  if(fwSelect)fwSelect.addEventListener('change',function(){
    var fw=frameworkState.frameworks.find(function(f){return f.id===fwSelect.value;});
    var versions=(fw&&fw.versions||[]).slice().sort(function(a,b){return b.versionNumber-a.versionNumber;});
    loadFrameworkDetail(root,versions[0]?versions[0].id:'');
  });
  var verSelect=root.querySelector('[data-knl-version-select]');
  if(verSelect)verSelect.addEventListener('change',function(){loadFrameworkDetail(root,verSelect.value);});
  var create=root.querySelector('[data-knl-create-framework]');if(create)create.addEventListener('click',async function(){
    var values=await openKnlPromptModal({
      title:'Tạo bộ KNL mới',
      fields:[
        {name:'code',label:'Mã bộ KNL (A-Z, 0-9, _ hoặc -)',value:'',required:true},
        {name:'name',label:'Tên bộ KNL',value:'',required:true},
        {name:'levelCount',label:'Số mức khởi tạo (có thể thêm/bớt ở Dự thảo)',type:'number',value:'4',required:true}
      ]
    });
    if(!values)return;
    await runFrameworkAction(root,'createKnlFramework',{framework:{code:values.code,name:values.name,levelCount:Number(values.levelCount),includeDescription:true}},create);
  });
  var addGroup=root.querySelector('[data-knl-add-group]');if(addGroup)addGroup.addEventListener('click',async function(){
    var values=await openKnlPromptModal({title:'Thêm nhóm năng lực',fields:[{name:'name',label:'Tên nhóm năng lực',value:'',required:true}]});
    if(!values)return;
    runFrameworkAction(root,'saveKnlGroup',{group:{versionId:frameworkState.selectedVersionId,name:values.name}},addGroup);
  });
  root.querySelectorAll('[data-knl-edit-group]').forEach(function(el){el.addEventListener('click',async function(){
    var row=frameworkState.detail.groups.find(function(x){return x.id===el.getAttribute('data-knl-edit-group');});
    var values=await openKnlPromptModal({title:'Sửa nhóm năng lực',fields:[{name:'name',label:'Tên nhóm năng lực',value:row.name,required:true}]});
    if(!values)return;
    runFrameworkAction(root,'saveKnlGroup',{group:{id:row.id,versionId:row.versionId,name:values.name,description:row.description}},el);
  });});
  root.querySelectorAll('[data-knl-add-item]').forEach(function(el){el.addEventListener('click',async function(){
    var values=await openKnlPromptModal({title:'Thêm hạng mục năng lực',fields:[{name:'name',label:'Tên hạng mục năng lực',value:'',required:true}]});
    if(!values)return;
    runFrameworkAction(root,'saveKnlItem',{item:{versionId:frameworkState.selectedVersionId,groupId:el.getAttribute('data-knl-add-item'),name:values.name}},el);
  });});
  root.querySelectorAll('[data-knl-edit-item]').forEach(function(el){el.addEventListener('click',async function(){
    var row=frameworkState.detail.items.find(function(x){return x.id===el.getAttribute('data-knl-edit-item');});
    var values=await openKnlPromptModal({title:'Sửa hạng mục',fields:[
      {name:'name',label:'Tên hạng mục',value:row.name,required:true},
      {name:'description',label:'Mô tả (tùy chọn)',value:row.description||'',type:'textarea'}
    ]});
    if(!values)return;
    runFrameworkAction(root,'saveKnlItem',{item:{id:row.id,versionId:row.versionId,groupId:row.groupId,name:values.name,description:values.description}},el);
  });});
  var addColumn=root.querySelector('[data-knl-add-column]');if(addColumn)addColumn.addEventListener('click',async function(){
    var levels=frameworkState.detail.columns.filter(function(c){return c.type==='level';});
    function computeLabel(type,levelNumber){return type==='level'?('MỨC ĐỘ '+levelNumber):(type==='description'?'MÔ TẢ':'HẠNG MỤC');}
    var labelSynced=true;
    var defaultLevelNumber=levels.length+1;
    var values=await openKnlPromptModal({
      title:'Thêm cột',
      fields:[
        {name:'type',label:'Loại cột',type:'select',value:'level',options:[
          {value:'item',label:'Hạng mục (item)'},
          {value:'description',label:'Mô tả (description)'},
          {value:'level',label:'Mức (level)'}
        ]},
        {name:'levelNumber',label:'Số mức',type:'number',value:String(defaultLevelNumber),required:true,
          showIf:function(v){return v.type==='level';}},
        {name:'label',label:'Nhãn cột',value:computeLabel('level',defaultLevelNumber),required:true}
      ],
      onFieldChange:function(name,value,v,setValue){
        if(name==='label'){labelSynced=false;return;}
        if(!labelSynced)return;
        var ln=v.type==='level'?Number(v.levelNumber||defaultLevelNumber):null;
        setValue('label',computeLabel(v.type,ln));
      }
    });
    if(!values)return;
    var type=String(values.type||'level').trim().toLowerCase();
    var levelNumber=type==='level'?Number(values.levelNumber||defaultLevelNumber):null;
    runFrameworkAction(root,'saveKnlColumn',{column:{versionId:frameworkState.selectedVersionId,type:type,label:values.label,levelNumber:levelNumber}},addColumn);
  });
  root.querySelectorAll('[data-knl-edit-column]').forEach(function(el){el.addEventListener('click',async function(){
    var row=frameworkState.detail.columns.find(function(x){return x.id===el.getAttribute('data-knl-edit-column');});
    var values=await openKnlPromptModal({title:'Sửa nhãn cột',fields:[{name:'label',label:'Nhãn cột',value:row.label,required:true}]});
    if(!values)return;
    runFrameworkAction(root,'saveKnlColumn',{column:{id:row.id,versionId:row.versionId,type:row.type,label:values.label,levelNumber:row.levelNumber}},el);
  });});
  root.querySelectorAll('[data-knl-delete]').forEach(function(el){el.addEventListener('click',function(){
    var parts=el.getAttribute('data-knl-delete').split(':');
    openKnlConfirmModal({title:'Xóa cấu trúc',body:'Xóa vật lý khỏi Dự thảo chưa sử dụng?',confirmLabel:'Xóa',onConfirm:function(){runFrameworkAction(root,'deleteKnlStructure',{entity:parts[0],id:parts[1]},el);}});
  });});
  root.querySelectorAll('[data-knl-group-move]').forEach(function(el){el.addEventListener('click',function(){var ids=moveIds(frameworkState.detail.groups,el.getAttribute('data-knl-group-move'),el.getAttribute('data-direction'));if(ids)runFrameworkAction(root,'reorderKnlStructure',{entity:'group',parentId:frameworkState.selectedVersionId,orderedIds:ids});});});
  root.querySelectorAll('[data-knl-item-move]').forEach(function(el){el.addEventListener('click',function(){var groupId=el.getAttribute('data-group-id'),ids=moveIds(frameworkState.detail.items.filter(function(x){return x.groupId===groupId;}),el.getAttribute('data-knl-item-move'),el.getAttribute('data-direction'));if(ids)runFrameworkAction(root,'reorderKnlStructure',{entity:'item',parentId:groupId,orderedIds:ids});});});
  root.querySelectorAll('[data-knl-column-move]').forEach(function(el){el.addEventListener('click',function(){var ids=moveIds(frameworkState.detail.columns,el.getAttribute('data-knl-column-move'),el.getAttribute('data-direction'));if(ids)runFrameworkAction(root,'reorderKnlStructure',{entity:'column',parentId:frameworkState.selectedVersionId,orderedIds:ids});});});
  root.querySelectorAll('[data-knl-level-content]').forEach(function(el){el.addEventListener('change',function(){var ids=el.getAttribute('data-knl-level-content').split(':');runFrameworkAction(root,'saveKnlLevelContent',{levelContent:{versionId:frameworkState.selectedVersionId,itemId:ids[0],columnId:ids[1],content:el.value}});});});
  var publish=root.querySelector('[data-knl-publish-version]');if(publish)publish.addEventListener('click',function(){
    openKnlConfirmModal({title:'Phát hành phiên bản',body:'Phát hành sẽ khóa bất biến version này. Tiếp tục?',confirmLabel:'Phát hành',onConfirm:function(){runFrameworkAction(root,'publishKnlVersion',{versionId:frameworkState.selectedVersionId},publish);}});
  });
  var clone=root.querySelector('[data-knl-clone-version]');if(clone)clone.addEventListener('click',async function(){
    var values=await openKnlPromptModal({title:'Tạo phiên bản mới',fields:[{name:'name',label:'Tên version mới',value:frameworkState.detail.version.name+' (bản mới)',required:true}]});
    if(!values)return;
    runFrameworkAction(root,'cloneKnlVersion',{versionId:frameworkState.selectedVersionId,name:values.name},clone);
  });
  var inactivate=root.querySelector('[data-knl-inactivate-framework]');if(inactivate)inactivate.addEventListener('click',function(){
    openKnlConfirmModal({title:'Ngừng áp dụng bộ KNL',body:'Ngừng áp dụng bộ KNL này? Phiên bản đã phát hành vẫn được giữ bất biến.',confirmLabel:'Ngừng áp dụng',onConfirm:function(){runFrameworkAction(root,'saveKnlFramework',{framework:{id:frameworkState.detail.framework.id,name:frameworkState.detail.framework.name,description:frameworkState.detail.framework.description,status:'inactive'}},inactivate);}});
  });
}

/* ===================== SOURCE THẬT + ASSIGNMENT (BATCH 2) ===================== */

var assignmentState={loading:false,loaded:false,loadedAt:0,subTab:'gan-cho-nhan-su',preview:null,manifests:[],targets:{people:[],positions:[],organizationConflict:null},assignments:[],frameworks:[],error:'',result:''};
var competencyAssignState={selectedCode:'',current:null,loadingCurrent:false,grades:[],gradesVersionId:'',gradesLoading:false,requestSeq:0,gradesRequestSeq:0,message:'',error:''};
var assignmentTargetTypeMode='employee';
var bulkAssignState={selectedCodes:[],search:'',preview:null,previewSignature:'',submitting:false,results:null,error:''};
function resetBulkAssignState(){bulkAssignState.selectedCodes=[];bulkAssignState.search='';bulkAssignState.preview=null;bulkAssignState.previewSignature='';bulkAssignState.submitting=false;bulkAssignState.results=null;bulkAssignState.error='';}
var BULK_ASSIGN_CLASS_LABEL={READY:'Sẵn sàng',UPDATE:'Đã có — sẽ cập nhật',REACTIVATE:'Đang ngưng — sẽ kích hoạt lại',PRIMARY_CONFLICT_RISK:'Có nguy cơ xung đột Bộ chính'};
var BULK_ASSIGN_CLASS_BADGE={READY:'is-ready',UPDATE:'is-review',REACTIVATE:'is-review',PRIMARY_CONFLICT_RISK:'is-review'};
function assignmentSubTabNav(active){
  return '<nav class="phfk-subtabs" aria-label="Gán & áp dụng">'+
    '<button type="button" class="'+(active==='gan-cho-nhan-su'?'active':'')+'" data-knl-assign-subtab="gan-cho-nhan-su">Gán cho nhân sự</button>'+
    '<button type="button" class="'+(active==='dang-ap-dung'?'active':'')+'" data-knl-assign-subtab="dang-ap-dung">Đang áp dụng</button>'+
    '<button type="button" class="'+(active==='chuan-bi-du-lieu'?'active':'')+'" data-knl-assign-subtab="chuan-bi-du-lieu">Chuẩn bị dữ liệu</button>'+
    '<button type="button" class="'+(active==='bac-nang-luc'?'active':'')+'" data-knl-assign-subtab="bac-nang-luc">Gán bậc năng lực</button>'+
    '</nav>';
}
function assignmentFrameworkOptions(selectedId){return (assignmentState.frameworks||[]).map(function(f){return '<option value="'+esc(f.id)+'"'+(selectedId&&f.id===selectedId?' selected':'')+'>'+esc(f.name)+'</option>';}).join('');}
function assignmentVersionOptionsForFramework(frameworkId,selectedId){var f=(assignmentState.frameworks||[]).find(function(x){return x.id===frameworkId;});return (f&&f.versions||[]).slice().sort(function(a,b){return b.versionNumber-a.versionNumber;}).map(function(v){return '<option value="'+esc(v.id)+'"'+(selectedId&&v.id===selectedId?' selected':'')+'>v'+v.versionNumber+' · '+esc(statusLabel(v.status))+'</option>';}).join('');}
/* Framework Assignment (Nhân sự cụ thể / Vị trí tổ chức / Nhiều nhân sự — cả
 * 3 dùng chung 1 <select data-knl-assign-version>) chỉ được chọn version đã
 * published + is_locked=true — đúng invariant Survey đang dùng
 * (listPublishedVersions, lib/knl-surveys.js) và backend giờ đã enforce ở
 * saveKnlFrameworkAssignment (KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED). Đây là
 * lớp prevention ở UI, backend vẫn là authoritative guard. KHÔNG dùng hàm
 * này cho Competency Grade Assignment (data-comp-assign-version) — feature
 * đó vẫn dùng assignmentVersionOptionsForFramework() nguyên trạng, ngoài
 * scope của guard này. */
function assignmentEligibleVersionOptionsForFramework(frameworkId,selectedId){var f=(assignmentState.frameworks||[]).find(function(x){return x.id===frameworkId;});return (f&&f.versions||[]).filter(function(v){return v.status==='published'&&v.isLocked===true;}).slice().sort(function(a,b){return b.versionNumber-a.versionNumber;}).map(function(v){return '<option value="'+esc(v.id)+'"'+(selectedId&&v.id===selectedId?' selected':'')+'>v'+v.versionNumber+' · '+esc(statusLabel(v.status))+'</option>';}).join('');}
function assignmentStatusLabel(status){return status==='inactive'?'Ngưng áp dụng':'Đang áp dụng';}
function assignmentStatusBadge(status){return '<span class="phfk-source-status '+(status==='inactive'?'is-review':'is-ready')+'">'+esc(assignmentStatusLabel(status))+'</span>';}
function manifestCandidateLabel(v){return {READY:'Sẵn sàng',NEEDS_REVIEW:'Cần kiểm tra',EXCLUDED:'Không thuộc phạm vi'}[v]||(v||'—');}
function manifestImportLabel(v){return {PENDING:'Chưa nạp',SEEDED:'Đã nạp',SKIPPED:'Đã bỏ qua',CONFLICT:'Xung đột dữ liệu'}[v]||(v||'—');}
function sourceRows(rows,statusClass){return (rows||[]).map(function(row){var saved=(assignmentState.manifests||[]).find(function(item){return item.manifestKey===row.manifestKey;});var label=saved?(manifestImportLabel(saved.importStatus)+' · '+manifestCandidateLabel(saved.candidateStatus)):(row.reason||'Sẵn sàng');return '<tr><td>'+esc(row.sourceSheet)+'</td><td>'+esc(row.sourcePosition||'—')+'</td><td>'+esc(row.levelCount||'—')+'</td><td><span class="phfk-source-status '+statusClass+'">'+esc(label)+'</span></td></tr>';}).join('');}
function assignmentPrepHtml(){
  var p=assignmentState.preview||{totals:{},ready:[],needsReview:[],excluded:[]};
  return '<section class="phfk-panel phfk-source-panel"><div class="phfk-section-head"><div><small>CHUẨN BỊ DỮ LIỆU</small><h2>Nạp dữ liệu Bộ KNL đã chuẩn bị</h2></div><button type="button" class="phfk-btn-primary" data-knl-seed-source>Nạp dữ liệu (không tạo trùng)</button></div>'+
    '<div class="phfk-prep-summary-row"><div class="phfk-prep-summary-card is-ready"><b>'+(p.ready||[]).length+' bộ sẵn sàng</b><small>Sẵn sàng để nạp</small></div><div class="phfk-prep-summary-card is-review"><b>'+(p.needsReview||[]).length+' bộ cần kiểm tra</b><small>Cần rà soát trước khi nạp</small></div></div>'+
    '<p class="phfk-batch-note">Sẽ tạo '+Number(p.totals.frameworks||0)+' Bộ KNL, '+Number(p.totals.groups||0)+' nhóm, '+Number(p.totals.items||0)+' hạng mục và '+Number(p.totals.contents||0)+' nội dung mức. Các mục đang có xung đột sẽ không được tự động chọn.</p>'+
    '<details open><summary>Sẵn sàng nạp ('+(p.ready||[]).length+')</summary><div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Nguồn dữ liệu</th><th>Vị trí nguồn</th><th>Mức</th><th>Trạng thái</th></tr></thead><tbody>'+sourceRows(p.ready||[],'is-ready')+'</tbody></table></div></details>'+
    '<details><summary>Cần kiểm tra ('+(p.needsReview||[]).length+')</summary><div class="phfk-table-wrap"><table class="phfk-table"><tbody>'+sourceRows(p.needsReview||[],'is-review')+'</tbody></table></div></details><p class="phfk-source-excluded">Không thuộc phạm vi xử lý: '+esc((p.excluded||[]).map(function(x){return x.sourceSheet;}).join(', ')||'Không có')+'</p></section>';
}
function bulkAssignPeopleRowsHtml(){
  var t=assignmentState.targets||{};
  return (t.people||[]).map(function(p){
    var checked=bulkAssignState.selectedCodes.indexOf(p.employeeCode)>=0;
    return '<label data-knl-bulk-person-row data-code="'+esc(p.employeeCode)+'"><input type="checkbox" data-knl-bulk-check value="'+esc(p.employeeCode)+'"'+(checked?' checked':'')+'> <b>'+esc(p.employeeCode)+'</b> · '+esc(p.employeeName)+' <small>'+esc(p.title||'Chưa có chức danh')+'</small></label>';
  }).join('')||'<p class="phfk-batch-note">Không có nhân sự trong dữ liệu tổ chức.</p>';
}
function classifyBulkAssignTarget(employeeCode,versionId,wantPrimary){
  var rows=(assignmentState.assignments||[]).filter(function(a){return a.targetType==='employee'&&a.employeeCode===employeeCode;});
  var sameVersionRow=rows.find(function(a){return a.versionId===versionId;});
  if(sameVersionRow)return sameVersionRow.status==='inactive'?'REACTIVATE':'UPDATE';
  if(wantPrimary){
    var conflictRow=rows.find(function(a){return a.isPrimary===true&&a.status==='active';});
    if(conflictRow)return 'PRIMARY_CONFLICT_RISK';
  }
  return 'READY';
}
function bulkAssignConfigSignature(root){
  var form=root.querySelector('[data-knl-assignment-form]');if(!form)return '';
  var data=new FormData(form);
  return [String(data.get('versionId')||''),String(data.get('assignRole')||''),String(data.get('reason')||'').trim(),bulkAssignState.selectedCodes.slice().sort().join(',')].join('|');
}
function bulkAssignPreviewHtml(){
  var p=bulkAssignState.preview;
  if(bulkAssignState.results)return '';
  if(!p)return bulkAssignState.error?'<div class="phfk-panel"><p class="phfk-error">'+esc(bulkAssignState.error)+'</p></div>':'';
  var counts={READY:0,UPDATE:0,REACTIVATE:0,PRIMARY_CONFLICT_RISK:0};
  p.rows.forEach(function(r){counts[r.cls]=(counts[r.cls]||0)+1;});
  var rowsHtml=p.rows.map(function(r){return '<tr><td>'+esc(r.employeeCode+' · '+r.employeeName)+'</td><td><span class="phfk-source-status '+BULK_ASSIGN_CLASS_BADGE[r.cls]+'">'+esc(BULK_ASSIGN_CLASS_LABEL[r.cls])+'</span></td></tr>';}).join('');
  return '<div class="phfk-panel" data-knl-bulk-preview><div class="phfk-section-head"><div><small>XEM TRƯỚC</small><h2>Xem trước '+p.rows.length+' nhân sự</h2></div></div>'+
    '<p class="phfk-batch-note">Sẵn sàng: '+counts.READY+' · Đã có — sẽ cập nhật: '+counts.UPDATE+' · Đang ngưng — sẽ kích hoạt lại: '+counts.REACTIVATE+' · Có nguy cơ xung đột Bộ chính: '+counts.PRIMARY_CONFLICT_RISK+'</p>'+
    '<div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Nhân sự</th><th>Phân loại</th></tr></thead><tbody>'+rowsHtml+'</tbody></table></div>'+
    '<button type="button" class="phfk-btn-primary" data-knl-bulk-confirm>Xác nhận &amp; Gán cho '+p.rows.length+' nhân sự</button>'+
    (bulkAssignState.error?'<p class="phfk-error">'+esc(bulkAssignState.error)+'</p>':'')+
    '</div>';
}
function bulkAssignResultHtml(){
  var r=bulkAssignState.results;
  if(!r)return '';
  if(bulkAssignState.submitting){
    return '<div class="phfk-panel"><p class="phfk-batch-note" data-knl-bulk-progress>Đang xử lý '+r.done+'/'+r.total+'…</p></div>';
  }
  var successCount=r.rows.filter(function(x){return x.status==='success';}).length,failCount=r.rows.length-successCount;
  var summary=successCount+'/'+r.rows.length+' nhân sự đã gán thành công.'+(failCount?' '+failCount+' nhân sự chưa xử lý được.':'');
  var rowsHtml=r.rows.map(function(x){return '<tr><td>'+esc(x.employeeCode+' · '+x.employeeName)+'</td><td>'+(x.status==='success'?'<span class="phfk-source-status is-ready">Thành công</span>':'<span class="phfk-source-status is-review">Thất bại</span>')+'</td><td>'+esc(x.message||'—')+'</td></tr>';}).join('');
  return '<div class="phfk-panel"><div class="phfk-section-head"><div><small>KẾT QUẢ GÁN HÀNG LOẠT</small><h2>'+esc(summary)+'</h2></div></div>'+
    '<div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Nhân sự</th><th>Kết quả</th><th>Chi tiết</th></tr></thead><tbody>'+rowsHtml+'</tbody></table></div>'+
    '<button type="button" class="phfk-btn-secondary" data-knl-bulk-close-result>Đóng kết quả</button> '+
    '<button type="button" class="phfk-link" data-knl-bulk-view-applied>Xem trong "Đang áp dụng"</button>'+
    '</div>';
}
function assignmentFormHtml(){
  var t=assignmentState.targets||{},positionDisabled=!(t.positions||[]).length,bulkDisabled=!(t.people||[]).length;
  var peopleOptions=(t.people||[]).map(function(person){return '<option value="'+esc(person.employeeCode)+'">'+esc(person.employeeCode+' · '+person.employeeName+' · '+(person.title||'Chưa có chức danh'))+'</option>';}).join('');
  var positionOptions=(t.positions||[]).map(function(pos){return '<option value="'+esc(pos.positionRef)+'">'+esc([pos.position,pos.department,pos.branch].filter(Boolean).join(' · '))+'</option>';}).join('');
  var mode=assignmentTargetTypeMode;
  /* Preview (Xem trước) kích hoạt 1 lần renderAssignmentBody đầy đủ để hiện
   * bảng preview — vì các <select> Bộ KNL/Phiên bản vốn build lại từ đầu mỗi
   * lần render (không tự giữ value cũ như input thường), phải chủ động
   * prefill lại từ bulkAssignState.preview đã lưu, nếu không Phiên bản sẽ
   * rớt về rỗng ngay sau khi bấm Xem trước (đồng thời làm sai luôn chữ ký
   * cấu hình dùng để chặn Xác nhận khi cấu hình đã đổi). */
  var pv=bulkAssignState.preview;
  var prefillFrameworkId=pv?findFrameworkIdForVersion(pv.versionId):'';
  return '<section class="phfk-panel"><div class="phfk-section-head"><div><small>GÁN BỘ KNL CHO NHÂN SỰ</small><h2>Gán Bộ KNL cho nhân sự hoặc vị trí</h2></div></div><form class="phfk-assignment-form" data-knl-assignment-form><fieldset'+(bulkAssignState.submitting?' disabled':'')+' style="display:contents">'+
    '<label class="phfk-field"><span>Bộ KNL</span><select class="phfk-input" name="frameworkId" data-knl-assign-framework required><option value="">Chọn Bộ KNL</option>'+assignmentFrameworkOptions(prefillFrameworkId)+'</select></label>'+
    '<label class="phfk-field"><span>Phiên bản</span><select class="phfk-input" name="versionId" data-knl-assign-version required><option value="">Chọn phiên bản</option>'+(prefillFrameworkId?assignmentEligibleVersionOptionsForFramework(prefillFrameworkId,pv.versionId):'')+'</select></label>'+
    '<label class="phfk-field"><span>Đối tượng</span><select class="phfk-input" name="targetType" data-knl-target-type>'+
      '<option value="employee"'+(mode==='employee'?' selected':'')+'>Nhân sự cụ thể</option>'+
      '<option value="position"'+(positionDisabled?' disabled':'')+(mode==='position'?' selected':'')+'>Vị trí tổ chức</option>'+
      '<option value="bulk"'+(bulkDisabled?' disabled':'')+(mode==='bulk'?' selected':'')+'>Nhiều nhân sự</option>'+
    '</select></label>'+
    '<label class="phfk-field" data-knl-employee-target'+(mode!=='employee'?' hidden':'')+'><span>Nhân sự</span><select class="phfk-input" name="employeeRef" data-knl-assign-target><option value="">Chọn nhân sự</option>'+peopleOptions+'</select></label>'+
    '<label class="phfk-field" data-knl-position-target'+(mode!=='position'?' hidden':'')+'><span>Vị trí</span><select class="phfk-input" name="positionRef" data-knl-assign-target><option value="">Chọn vị trí</option>'+positionOptions+'</select>'+
      '<small class="phfk-batch-note">Vị trí tổ chức hiện là một đối tượng gán riêng, không tự tạo gán cho từng nhân sự đang giữ vị trí này.</small></label>'+
    '<div class="phfk-field" data-knl-bulk-target'+(mode!=='bulk'?' hidden':'')+'><span>Nhiều nhân sự</span>'+
      '<input class="phfk-input" type="search" placeholder="Tìm theo tên hoặc mã nhân sự" data-knl-bulk-search value="'+esc(bulkAssignState.search)+'">'+
      '<p class="phfk-survey-target-count"><span data-knl-bulk-match-count>'+(t.people||[]).length+' nhân sự phù hợp</span> · <span data-knl-bulk-selected-count>Đã chọn '+bulkAssignState.selectedCodes.length+' nhân sự</span></p>'+
      '<div class="phfk-survey-picks" data-knl-bulk-list>'+bulkAssignPeopleRowsHtml()+'</div>'+
    '</div>'+
    '<div class="phfk-field"><span>Vai trò của Bộ KNL</span>'+
      '<label class="phfk-radio"><input type="radio" name="assignRole" value="primary" data-knl-assign-role'+(pv&&pv.isPrimary?' checked':'')+'><span>Bộ KNL chính<small>Dùng làm cơ sở đánh giá chính theo vị trí hiện tại.</small></span></label>'+
      '<label class="phfk-radio"><input type="radio" name="assignRole" value="supplementary" data-knl-assign-role'+(!pv||!pv.isPrimary?' checked':'')+'><span>Bộ KNL bổ sung<small>Hỗ trợ đánh giá thêm năng lực khác, không phải khung chính.</small></span></label>'+
    '</div>'+
    '<label class="phfk-field"><span>Lý do gán</span><input class="phfk-input" name="reason" required minlength="5" placeholder="Tối thiểu 5 ký tự" data-knl-assign-reason value="'+esc(pv?pv.reason:'')+'"></label>'+
    '<p class="phfk-assign-summary" data-knl-assign-summary hidden></p>'+
    '<button class="phfk-btn-primary" type="submit">'+(mode==='bulk'?'Xem trước':'Gán Bộ KNL')+'</button>'+
    '</fieldset></form>'+
    (t.organizationConflict?'<p class="phfk-warning">Xung đột dữ liệu tổ chức: '+esc(t.organizationConflict.message)+'</p>':'')+'</section>'+
    bulkAssignPreviewHtml()+bulkAssignResultHtml();
}
function assignmentAppliedHtml(){
  return '<section class="phfk-panel"><div class="phfk-section-head"><div><small>ĐANG ÁP DỤNG</small><h2>Bộ KNL đang áp dụng</h2></div></div><div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Bộ KNL</th><th>Phiên bản</th><th>Đối tượng</th><th>Vai trò</th><th>Trạng thái</th><th>Thu nhập</th></tr></thead><tbody>'+((assignmentState.assignments||[]).map(function(a){var snap=a.organizationSnapshot||{};return '<tr><td>'+esc(a.frameworkName||a.frameworkCode)+'</td><td>v'+esc(a.versionNumber)+'</td><td>'+esc(a.targetType==='employee'?(a.employeeCode+' · '+(snap.employeeName||'')):(snap.position||a.positionRef))+'</td><td>'+(a.isPrimary?'Bộ chính':'Bộ bổ sung')+'</td><td>'+assignmentStatusBadge(a.status)+'</td><td>'+(a.targetType==='employee'?'<button type="button" class="phfk-link" data-knl-assignment-income="'+esc(a.employeeCode)+'">Xem</button>':'—')+'</td></tr>';}).join('')||'<tr><td colspan="6">Chưa có Bộ KNL nào đang áp dụng.</td></tr>')+'</tbody></table></div></section>';
}
function competencyStatusLabel(v){return {PROVISIONAL:'Tạm thời',CONFIRMED:'Đã xác nhận'}[v]||(v||'—');}
function findFrameworkIdForVersion(frameworkVersionId){
  var match=(assignmentState.frameworks||[]).find(function(f){return (f.versions||[]).some(function(v){return v.id===frameworkVersionId;});});
  return match?match.id:'';
}
function competencyGradeOptions(){
  return (competencyAssignState.grades||[]).slice().sort(function(a,b){return Number(a.sortOrder||0)-Number(b.sortOrder||0);}).map(function(g){return '<option value="'+esc(g.id)+'">'+esc(g.label||g.gradeCode)+'</option>';}).join('');
}
function competencyCurrentSummaryHtml(){
  var c=competencyAssignState;
  if(!c.selectedCode)return '';
  if(c.loadingCurrent)return '<p class="phfk-loading">Đang tải bậc năng lực hiện tại…</p>';
  if(!c.current||c.current.hasAssignment===false)return '<p class="phfk-batch-note">Nhân sự này chưa có bậc năng lực nào được gán.</p>';
  var a=c.current.assignment,fw=c.current.framework,g=c.current.currentGrade;
  return '<div class="phfk-panel phfk-competency-current"><div class="phfk-section-head"><div><small>BẬC NĂNG LỰC HIỆN TẠI</small></div></div>'+
    '<p><b>'+esc(fw.name)+'</b> · v'+esc(fw.versionNumber)+'</p>'+
    '<p>Bậc: <b>'+esc(g.label||g.code)+'</b></p>'+
    '<p>Trạng thái: <b>'+esc(competencyStatusLabel(a.status))+'</b></p>'+
    '<p>Ngày hiệu lực: <b>'+esc(a.effectiveFrom||'—')+'</b></p></div>';
}
function competencyAssignFormHtml(){
  var t=assignmentState.targets||{};
  var peopleOptions=(t.people||[]).map(function(person){return '<option value="'+esc(person.employeeCode)+'"'+(competencyAssignState.selectedCode===person.employeeCode?' selected':'')+'>'+esc(person.employeeCode+' · '+person.employeeName+' · '+(person.title||'Chưa có chức danh'))+'</option>';}).join('');
  var hasEmployee=!!competencyAssignState.selectedCode;
  var todayStr=new Date().toISOString().slice(0,10);
  return '<section class="phfk-panel"><div class="phfk-section-head"><div><small>GÁN BẬC NĂNG LỰC</small><h2>Gán / đổi / xác nhận bậc năng lực</h2></div></div>'+
    '<label class="phfk-field"><span>Nhân sự</span><select class="phfk-input" data-comp-employee-select><option value="">Chọn nhân sự</option>'+peopleOptions+'</select></label>'+
    competencyCurrentSummaryHtml()+
    (!hasEmployee?'':(
    '<form class="phfk-assignment-form" data-comp-assign-form>'+
      '<label class="phfk-field"><span>Bộ KNL</span><select class="phfk-input" data-comp-assign-framework required><option value="">Chọn Bộ KNL</option>'+assignmentFrameworkOptions()+'</select></label>'+
      '<label class="phfk-field"><span>Phiên bản</span><select class="phfk-input" data-comp-assign-version required><option value="">Chọn phiên bản</option></select></label>'+
      '<label class="phfk-field"><span>Bậc năng lực</span><select class="phfk-input" data-comp-assign-grade required><option value="">Chọn bậc</option>'+competencyGradeOptions()+'</select></label>'+
      '<label class="phfk-field"><span>Trạng thái</span><select class="phfk-input" data-comp-assign-status required><option value="PROVISIONAL">Tạm thời</option><option value="CONFIRMED">Đã xác nhận</option></select></label>'+
      '<label class="phfk-field"><span>Ngày hiệu lực</span><input class="phfk-input" type="date" data-comp-assign-effective required min="'+todayStr+'" value="'+todayStr+'"></label>'+
      '<label class="phfk-field"><span>Lý do</span><input class="phfk-input" data-comp-assign-reason required minlength="5" placeholder="Tối thiểu 5 ký tự"></label>'+
      '<label class="phfk-field"><span>Ghi chú</span><input class="phfk-input" data-comp-assign-note placeholder="Không bắt buộc"></label>'+
      '<button class="phfk-btn-primary" type="submit">Lưu bậc năng lực</button>'+
    '</form>'))+
    (competencyAssignState.message?'<p class="phfk-success">'+esc(competencyAssignState.message)+'</p>':'')+
    (competencyAssignState.error?'<p class="phfk-error">'+esc(competencyAssignState.error)+'</p>':'')+
    '</section>';
}
function assignmentPageHtml(){
  var sub=assignmentState.subTab||'gan-cho-nhan-su';
  var content=sub==='dang-ap-dung'?assignmentAppliedHtml():(sub==='chuan-bi-du-lieu'?assignmentPrepHtml():(sub==='bac-nang-luc'?competencyAssignFormHtml():assignmentFormHtml()));
  return frameworkDomainNav('gan-ap-dung')+'<div class="phfk-page-head"><div><small>KNL · GÁN &amp; ÁP DỤNG</small><h1>Gán vị trí &amp; áp dụng</h1></div></div>'+
    assignmentSubTabNav(sub)+content+
    (assignmentState.result?'<p class="phfk-success">'+esc(assignmentState.result)+'</p>':'')+(assignmentState.error?'<p class="phfk-error">'+esc(assignmentState.error)+'</p>':'');
}
function renderAssignmentBody(root){var body=root.querySelector('[data-knl-body]');if(body)body.innerHTML=assignmentState.loading?'<div class="phfk-loading">Đang tải source và assignment…</div>':assignmentPageHtml();bindAssignmentEvents(root);}
async function loadAssignments(root){assignmentState.loading=true;renderAssignmentBody(root);try{var results=await Promise.all([apiPost('previewKnlSourceSeed'),apiPost('listKnlAssignmentTargets'),apiPost('listKnlFrameworkAssignments'),apiPost('listKnlFrameworks'),apiPost('listKnlSourceManifests')]);assignmentState.preview=results[0];assignmentState.targets=results[1];assignmentState.assignments=results[2].assignments||[];assignmentState.frameworks=results[3].frameworks||[];assignmentState.manifests=results[4].manifests||[];assignmentState.error='';assignmentState.loaded=true;assignmentState.loadedAt=Date.now();}catch(e){assignmentState.error=e.message;}assignmentState.loading=false;renderAssignmentBody(root);}
function bindAssignmentEvents(root){
  bindFrameworkDomainNav(root);
  root.querySelectorAll('[data-knl-assign-subtab]').forEach(function(btn){btn.addEventListener('click',function(){
    if(bulkAssignState.submitting)return;
    assignmentState.subTab=btn.getAttribute('data-knl-assign-subtab');
    assignmentState.result='';assignmentState.error='';
    competencyAssignState.message='';competencyAssignState.error='';
    assignmentTargetTypeMode='employee';
    resetBulkAssignState();
    renderAssignmentBody(root);
  });});
  root.querySelectorAll('[data-knl-assignment-income]').forEach(function(button){button.addEventListener('click',function(){goIncomeEmployee(button.getAttribute('data-knl-assignment-income'));});});
  var seed=root.querySelector('[data-knl-seed-source]');if(seed)seed.addEventListener('click',function(){
    var readyCount=((assignmentState.preview||{}).ready||[]).length;
    openKnlConfirmModal({title:'Nạp dữ liệu nguồn',body:'Nạp '+readyCount+' bộ dữ liệu đang sẵn sàng? Các bộ cần kiểm tra sẽ không được xử lý. Chạy lại sẽ không tạo trùng.',confirmLabel:'Nạp dữ liệu',onConfirm:async function(){
      setKnlButtonBusy(seed,true,'Đang nạp…');
      assignmentState.loading=true;renderAssignmentBody(root);
      try{
        var result=await apiPost('seedKnlSourceManifest');
        assignmentState.result='Nạp dữ liệu hoàn tất: '+JSON.stringify(result.summary||{});
        assignmentState.error='';
        await loadAssignments(root);
        knlToast('success','Đã nạp dữ liệu nguồn',assignmentState.result,3200,'knl-seed-source');
      }catch(e){
        assignmentState.loading=false;assignmentState.error=e.message;renderAssignmentBody(root);
        knlToast('error','Chưa thể nạp dữ liệu',e.message||'Vui lòng thử lại.',4800,'knl-seed-source');
      }finally{
        setKnlButtonBusy(seed,false);
      }
    }});
  });
  var type=root.querySelector('[data-knl-target-type]');if(type)type.addEventListener('change',function(){
    var employee=root.querySelector('[data-knl-employee-target]'),position=root.querySelector('[data-knl-position-target]'),bulk=root.querySelector('[data-knl-bulk-target]');
    assignmentTargetTypeMode=type.value;
    if(employee)employee.hidden=type.value!=='employee';
    if(position)position.hidden=type.value!=='position';
    if(bulk)bulk.hidden=type.value!=='bulk';
    var submitBtn=root.querySelector('[data-knl-assignment-form] button[type="submit"]');
    if(submitBtn)submitBtn.textContent=type.value==='bulk'?'Xem trước':'Gán Bộ KNL';
    updateAssignmentSummary(root);
  });
  var fwSelect=root.querySelector('[data-knl-assign-framework]'),verSelect=root.querySelector('[data-knl-assign-version]');
  if(fwSelect&&verSelect)fwSelect.addEventListener('change',function(){verSelect.innerHTML='<option value="">Chọn phiên bản</option>'+assignmentEligibleVersionOptionsForFramework(fwSelect.value);updateAssignmentSummary(root);});
  root.querySelectorAll('[data-knl-assign-version],[data-knl-assign-target],[data-knl-assign-role]').forEach(function(el){el.addEventListener('change',function(){updateAssignmentSummary(root);});});
  updateAssignmentSummary(root);
  var bulkSearch=root.querySelector('[data-knl-bulk-search]');if(bulkSearch){bulkSearch.addEventListener('input',function(){refreshBulkAssignFilter(root);});if(bulkAssignState.search)refreshBulkAssignFilter(root);}
  var bulkList=root.querySelector('[data-knl-bulk-list]');if(bulkList)bulkList.addEventListener('change',function(e){
    if(!e.target||!e.target.matches('[data-knl-bulk-check]'))return;
    var code=e.target.value;
    if(e.target.checked){if(bulkAssignState.selectedCodes.indexOf(code)<0)bulkAssignState.selectedCodes.push(code);}
    else{bulkAssignState.selectedCodes=bulkAssignState.selectedCodes.filter(function(c){return c!==code;});}
    var selEl=root.querySelector('[data-knl-bulk-selected-count]');if(selEl)selEl.textContent='Đã chọn '+bulkAssignState.selectedCodes.length+' nhân sự';
  });
  var bulkConfirm=root.querySelector('[data-knl-bulk-confirm]');if(bulkConfirm)bulkConfirm.addEventListener('click',function(){
    if(!bulkAssignState.preview)return;
    if(bulkAssignConfigSignature(root)!==bulkAssignState.previewSignature){
      bulkAssignState.error='Cấu hình hoặc danh sách đã thay đổi kể từ lúc Xem trước — vui lòng Xem trước lại.';
      bulkAssignState.preview=null;bulkAssignState.previewSignature='';
      renderAssignmentBody(root);
      return;
    }
    var n=bulkAssignState.preview.rows.length,warnCount=bulkAssignState.preview.rows.filter(function(r){return r.cls!=='READY';}).length;
    openKnlConfirmModal({
      title:'Xác nhận gán hàng loạt',
      body:'Sẽ xử lý '+n+' nhân sự'+(warnCount?' ('+warnCount+' dòng có cảnh báo — xem lại bảng xem trước phía trên)':'')+'. Kết quả sẽ hiển thị theo từng người — có thể có người thành công, có người không, không phải toàn bộ hoặc không có gì.',
      confirmLabel:'Xác nhận & Gán',
      onConfirm:function(){runBulkAssignment(root);}
    });
  });
  var bulkCloseResult=root.querySelector('[data-knl-bulk-close-result]');if(bulkCloseResult)bulkCloseResult.addEventListener('click',function(){
    resetBulkAssignState();
    renderAssignmentBody(root);
  });
  var bulkViewApplied=root.querySelector('[data-knl-bulk-view-applied]');if(bulkViewApplied)bulkViewApplied.addEventListener('click',function(){
    resetBulkAssignState();
    assignmentState.subTab='dang-ap-dung';
    renderAssignmentBody(root);
  });
  var form=root.querySelector('[data-knl-assignment-form]');if(form)form.addEventListener('submit',async function(event){
    event.preventDefault();
    var data=new FormData(form),targetType=String(data.get('targetType')||'employee');
    if(targetType==='bulk'){
      bulkAssignState.error='';
      var versionId=String(data.get('versionId')||''),wantPrimary=data.get('assignRole')==='primary',reason=String(data.get('reason')||'').trim();
      var codes=Array.from(new Set(bulkAssignState.selectedCodes));
      if(!versionId){bulkAssignState.error='Vui lòng chọn Bộ KNL và Phiên bản.';renderAssignmentBody(root);return;}
      if(!codes.length){bulkAssignState.error='Vui lòng chọn ít nhất 1 nhân sự.';renderAssignmentBody(root);return;}
      if(reason.length<5){bulkAssignState.error='Lý do gán cần tối thiểu 5 ký tự.';renderAssignmentBody(root);return;}
      var peopleByCode={};(assignmentState.targets.people||[]).forEach(function(p){peopleByCode[p.employeeCode]=p;});
      var rows=codes.map(function(code){return {employeeCode:code,employeeName:(peopleByCode[code]||{}).employeeName||code,cls:classifyBulkAssignTarget(code,versionId,wantPrimary)};});
      bulkAssignState.preview={versionId:versionId,isPrimary:wantPrimary,reason:reason,rows:rows};
      bulkAssignState.previewSignature=bulkAssignConfigSignature(root);
      bulkAssignState.results=null;
      renderAssignmentBody(root);
      return;
    }
    var targetRef=targetType==='employee'?data.get('employeeRef'):data.get('positionRef');
    try{await apiPost('saveKnlFrameworkAssignment',{assignment:{versionId:data.get('versionId'),targetType:targetType,targetRef:targetRef,isPrimary:data.get('assignRole')==='primary',reason:data.get('reason')}});assignmentState.result='Đã gán Bộ KNL cho '+(targetType==='employee'?'nhân sự đã chọn':'vị trí đã chọn')+'.';assignmentState.error='';await loadAssignments(root);}catch(e){assignmentState.error=e.message;renderAssignmentBody(root);}
  });
  bindCompetencyAssignEvents(root);
}
function refreshBulkAssignFilter(root){
  var searchEl=root.querySelector('[data-knl-bulk-search]');if(!searchEl)return;
  var q=String(searchEl.value||'').toLowerCase();
  bulkAssignState.search=searchEl.value||'';
  var matchCount=0;
  root.querySelectorAll('[data-knl-bulk-person-row]').forEach(function(row){
    var visible=!q||row.textContent.toLowerCase().indexOf(q)>=0;
    row.hidden=!visible;
    if(visible)matchCount++;
  });
  var countEl=root.querySelector('[data-knl-bulk-match-count]');if(countEl)countEl.textContent=matchCount+' nhân sự phù hợp';
}
function mapBulkAssignError(e){
  var code=String(e&&e.code||''),message=String(e&&e.message||'');
  if(code==='KNL_ASSIGNMENT_EMPLOYEE_NOT_FOUND')return 'Không tìm thấy nhân sự trong dữ liệu tổ chức hiện tại.';
  if(code==='23505'||/knl_assignment_primary_target_uq|duplicate key/i.test(message))return 'Nhân sự đã có Bộ KNL chính đang áp dụng.';
  if(code==='KNL_ASSIGNMENT_VERSION_NOT_PUBLISHED')return message||'Phiên bản Bộ KNL này chưa ở trạng thái có thể áp dụng.';
  if(code==='KNL_ASSIGNMENT_VERSION_INVALID'||code==='KNL_ASSIGNMENT_VERSION_NOT_FOUND'||code==='KNL_ASSIGNMENT_REASON_REQUIRED'||code==='KNL_ORG_POSITION_UNAVAILABLE')return message||'Dữ liệu gán không hợp lệ.';
  if(/relation .* does not exist|Could not find the table|Could not find the function/i.test(message))return 'Hệ thống chưa sẵn sàng xử lý gán KNL. Vui lòng liên hệ kỹ thuật.';
  return 'Không thể xử lý nhân sự này. Vui lòng thử lại.';
}
async function runBulkAssignment(root){
  var preview=bulkAssignState.preview;if(!preview)return;
  bulkAssignState.submitting=true;
  bulkAssignState.results={done:0,total:preview.rows.length,rows:[]};
  renderAssignmentBody(root);
  for(var i=0;i<preview.rows.length;i++){
    var row=preview.rows[i];
    var outcome={employeeCode:row.employeeCode,employeeName:row.employeeName,status:'success',message:''};
    try{
      await apiPost('saveKnlFrameworkAssignment',{assignment:{versionId:preview.versionId,targetType:'employee',targetRef:row.employeeCode,isPrimary:preview.isPrimary,reason:preview.reason}});
    }catch(e){
      outcome.status='failed';
      outcome.message=mapBulkAssignError(e);
    }
    bulkAssignState.results.rows.push(outcome);
    bulkAssignState.results.done=i+1;
    var progressEl=root.querySelector('[data-knl-bulk-progress]');
    if(progressEl)progressEl.textContent='Đang xử lý '+(i+1)+'/'+preview.rows.length+'…';
  }
  bulkAssignState.submitting=false;
  bulkAssignState.preview=null;
  bulkAssignState.previewSignature='';
  try{var refreshed=await apiPost('listKnlFrameworkAssignments');assignmentState.assignments=refreshed.assignments||[];}catch(e){}
  renderAssignmentBody(root);
}
async function loadCompetencyCurrent(root,employeeCode){
  var seq=++competencyAssignState.requestSeq;
  competencyAssignState.loadingCurrent=true;
  renderAssignmentBody(root);
  try{
    var result=await apiPost('getKnlEmployeeCompetencyStandard',{employeeCode:employeeCode});
    if(seq!==competencyAssignState.requestSeq)return;
    competencyAssignState.current=result;
    competencyAssignState.loadingCurrent=false;
    competencyAssignState.error='';
    renderAssignmentBody(root);
  }catch(e){
    if(seq!==competencyAssignState.requestSeq)return;
    competencyAssignState.loadingCurrent=false;
    competencyAssignState.error=e.message;
    renderAssignmentBody(root);
  }
}
function updateCompetencyGradeSelect(root){
  var gradeSelect=root.querySelector('[data-comp-assign-grade]');
  if(!gradeSelect)return;
  var keep=gradeSelect.value;
  gradeSelect.disabled=false;
  gradeSelect.innerHTML='<option value="">Chọn bậc</option>'+competencyGradeOptions();
  if(keep)gradeSelect.value=keep;
}
function resetCompetencyGradeSelectLoading(root){
  var gradeSelect=root.querySelector('[data-comp-assign-grade]');
  if(!gradeSelect)return;
  gradeSelect.disabled=true;
  gradeSelect.innerHTML='<option value="">Đang tải…</option>';
}
function markCompetencyGradeSelectError(root){
  var gradeSelect=root.querySelector('[data-comp-assign-grade]');
  if(!gradeSelect)return;
  gradeSelect.disabled=true;
  gradeSelect.innerHTML='<option value="">Không tải được danh sách bậc</option>';
}
/* Đổi Phiên bản phải xóa option bậc cũ NGAY (không chờ response) để không bao
 * giờ hiển thị bậc thuộc phiên bản khác đang được chọn — gradesRequestSeq
 * chặn response trễ (đổi version nhanh 2 lần) ghi đè kết quả của lần chọn sau
 * cùng, tương tự requestSeq đã dùng cho loadCompetencyCurrent. */
async function loadCompetencyGradesForVersion(root,versionId){
  var seq=++competencyAssignState.gradesRequestSeq;
  if(!versionId){
    competencyAssignState.grades=[];competencyAssignState.gradesVersionId='';competencyAssignState.gradesLoading=false;
    updateCompetencyGradeSelect(root);
    return;
  }
  if(competencyAssignState.gradesVersionId===versionId&&competencyAssignState.grades.length){
    updateCompetencyGradeSelect(root);
    return;
  }
  competencyAssignState.gradesLoading=true;
  resetCompetencyGradeSelectLoading(root);
  try{
    var result=await apiPost('getKnlGradeMatrix',{versionId:versionId});
    if(seq!==competencyAssignState.gradesRequestSeq)return;
    competencyAssignState.grades=result.grades||[];
    competencyAssignState.gradesVersionId=versionId;
    competencyAssignState.gradesLoading=false;
    updateCompetencyGradeSelect(root);
  }catch(e){
    if(seq!==competencyAssignState.gradesRequestSeq)return;
    competencyAssignState.grades=[];
    competencyAssignState.gradesVersionId='';
    competencyAssignState.gradesLoading=false;
    competencyAssignState.error=e.message;
    markCompetencyGradeSelectError(root);
  }
}
function applyCompetencyPrefill(root){
  var c=competencyAssignState.current;
  if(!c||c.hasAssignment===false)return;
  var fwSelect=root.querySelector('[data-comp-assign-framework]'),verSelect=root.querySelector('[data-comp-assign-version]'),statusSelect=root.querySelector('[data-comp-assign-status]');
  if(!fwSelect||!verSelect)return;
  var frameworkId=findFrameworkIdForVersion(c.assignment.frameworkVersionId);
  if(frameworkId){
    fwSelect.value=frameworkId;
    verSelect.innerHTML='<option value="">Chọn phiên bản</option>'+assignmentVersionOptionsForFramework(frameworkId);
    verSelect.value=c.assignment.frameworkVersionId;
    loadCompetencyGradesForVersion(root,c.assignment.frameworkVersionId).then(function(){
      var gradeSelect=root.querySelector('[data-comp-assign-grade]');
      if(gradeSelect)gradeSelect.value=c.assignment.competencyGradeId;
    });
  }
  if(statusSelect)statusSelect.value=c.assignment.status==='CONFIRMED'?'CONFIRMED':'PROVISIONAL';
}
function bindCompetencyAssignEvents(root){
  var empSelect=root.querySelector('[data-comp-employee-select]');
  if(empSelect)empSelect.addEventListener('change',function(){
    competencyAssignState.selectedCode=empSelect.value;
    competencyAssignState.current=null;
    competencyAssignState.message='';competencyAssignState.error='';
    competencyAssignState.grades=[];competencyAssignState.gradesVersionId='';
    if(competencyAssignState.selectedCode)loadCompetencyCurrent(root,competencyAssignState.selectedCode);
    else renderAssignmentBody(root);
  });
  var fwSelect=root.querySelector('[data-comp-assign-framework]'),verSelect=root.querySelector('[data-comp-assign-version]'),gradeSelect=root.querySelector('[data-comp-assign-grade]');
  if(fwSelect&&verSelect)fwSelect.addEventListener('change',function(){
    verSelect.innerHTML='<option value="">Chọn phiên bản</option>'+assignmentVersionOptionsForFramework(fwSelect.value);
    competencyAssignState.grades=[];competencyAssignState.gradesVersionId='';
    updateCompetencyGradeSelect(root);
  });
  if(verSelect)verSelect.addEventListener('change',function(){loadCompetencyGradesForVersion(root,verSelect.value);});
  var form=root.querySelector('[data-comp-assign-form]');
  if(form)form.addEventListener('submit',async function(event){
    event.preventDefault();
    var btn=form.querySelector('button[type="submit"]');
    var versionId=verSelect?verSelect.value:'',gradeId=gradeSelect?gradeSelect.value:'';
    var status=root.querySelector('[data-comp-assign-status]').value;
    var effectiveFrom=root.querySelector('[data-comp-assign-effective]').value;
    var reason=root.querySelector('[data-comp-assign-reason]').value;
    var note=root.querySelector('[data-comp-assign-note]').value;
    if(!versionId||!gradeId){competencyAssignState.error='Vui lòng chọn Bộ KNL, phiên bản và bậc năng lực.';renderAssignmentBody(root);return;}
    setKnlButtonBusy(btn,true,'Đang lưu…');
    try{
      await apiPost('setKnlEmployeeCompetencyAssignment',{employeeCode:competencyAssignState.selectedCode,frameworkVersionId:versionId,competencyGradeId:gradeId,status:status,effectiveFrom:effectiveFrom,reason:reason,note:note});
      competencyAssignState.message='Đã lưu bậc năng lực cho nhân sự đã chọn.';
      competencyAssignState.error='';
      knlToast('success','Đã lưu bậc năng lực',competencyAssignState.message,3200,'knl-competency-assign');
      await loadCompetencyCurrent(root,competencyAssignState.selectedCode);
    }catch(e){
      competencyAssignState.error=e.message;
      renderAssignmentBody(root);
      knlToast('error','Chưa thể lưu bậc năng lực',e.message||'Vui lòng thử lại.',4800,'knl-competency-assign');
    }finally{
      setKnlButtonBusy(btn,false);
    }
  });
  applyCompetencyPrefill(root);
}
function updateAssignmentSummary(root){
  var summaryEl=root.querySelector('[data-knl-assign-summary]');if(!summaryEl)return;
  var fwSelect=root.querySelector('[data-knl-assign-framework]'),verSelect=root.querySelector('[data-knl-assign-version]'),type=root.querySelector('[data-knl-target-type]');
  var targetSelect=root.querySelector(type&&type.value==='position'?'[name="positionRef"]':'[name="employeeRef"]');
  var fwName=fwSelect&&fwSelect.value&&fwSelect.selectedOptions[0].textContent;
  var verName=verSelect&&verSelect.value&&verSelect.selectedOptions[0].textContent;
  var targetName=targetSelect&&targetSelect.value&&targetSelect.selectedOptions[0].textContent;
  if(!fwName||!verName||!targetName){summaryEl.hidden=true;return;}
  summaryEl.hidden=false;
  summaryEl.textContent='Bạn đang gán '+fwName+' · '+verName+' cho '+targetName+'.';
}

/* ===================== SURVEY V1 ===================== */
function emptyWizardForm(){return {name:'',description:'',startsAt:'',endsAt:'',versionIds:[],employeeCodes:[]};}
var surveyState={loading:false,loaded:false,loadedAt:0,campaigns:[],tickets:[],setup:null,detail:null,results:null,resultFilters:{},error:'',message:'',autosaveTimer:null,
  wizardOpen:false,wizardStep:1,wizardForm:emptyWizardForm(),wizardPreview:null,wizardError:'',wizardTargetFilters:{department:'',branch:'',title:'',position:'',search:''}};
function campaignStatusLabel(v){return {DRAFT:'Dự thảo',OPEN:'Đang mở',CLOSED:'Đã đóng'}[v]||(v||'—');}
function ticketStatusLabel(v){return {NOT_STARTED:'Chưa làm',IN_PROGRESS:'Đang làm',SUBMITTED:'Đã gửi'}[v]||(v||'—');}
function submissionActionLabel(v){return {SUBMIT:'Gửi lần đầu',RESUBMIT:'Gửi lại'}[v]||(v||'—');}
function surveyNav(active){return '<nav class="phfk-domain-tabs" aria-label="Khảo sát & đánh giá"><button type="button" class="'+(active==='khao-sat'?'active':'')+'" data-survey-nav="khao-sat">Đợt khảo sát</button><button type="button" class="'+(active==='ket-qua-khao-sat'?'active':'')+'" data-survey-nav="ket-qua-khao-sat">Kết quả khảo sát</button></nav>';}
function bindSurveyNav(root){root.querySelectorAll('[data-survey-nav]').forEach(function(b){b.onclick=function(){goTab(b.getAttribute('data-survey-nav'));};});}
function fmtDate(v){if(!v)return '—';try{return new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short'}).format(new Date(v));}catch(e){return v;}}
function progressHtml(p){p=p||{};return '<div class="phfk-survey-progress"><span><b>'+Number(p.total||0)+'</b>Tổng phiếu</span><span><b>'+Number(p.notStarted||0)+'</b>Chưa làm</span><span><b>'+Number(p.inProgress||0)+'</b>Đang làm</span><span><b>'+Number(p.submitted||0)+'</b>Đã gửi</span><span><b>'+Number(p.overdue||0)+'</b>Quá hạn</span></div>';}
function surveyCampaignCards(isAdmin){
  if(!surveyState.campaigns.length)return '<section class="phfk-empty phfk-survey-empty"><h3>Chưa có đợt khảo sát</h3><p>Tạo đợt đầu tiên để bắt đầu đánh giá năng lực nhân sự theo Bộ KNL đang áp dụng.</p>'+
    (isAdmin?'<button type="button" class="phfk-btn-primary" data-survey-open-wizard>+ Tạo đợt khảo sát</button>':'')+
    '<div class="phfk-survey-empty-steps"><span>1. Chọn Bộ KNL</span><span>→</span><span>2. Chọn nhân sự</span><span>→</span><span>3. Mở khảo sát</span></div></section>';
  return surveyState.campaigns.map(function(c){var own=surveyState.tickets.filter(function(t){return t.campaignId===c.id;});return '<article class="phfk-panel phfk-survey-card"><header><div><span class="phfk-source-status '+(c.status==='OPEN'?'is-ready':(c.status==='CLOSED'?'':'is-review'))+'">'+esc(campaignStatusLabel(c.status))+'</span><h2>'+esc(c.name)+'</h2><p>'+fmtDate(c.startsAt)+' → '+fmtDate(c.endsAt)+'</p></div>'+(c.status==='DRAFT'?'<button class="phfk-btn-primary" data-open-survey="'+esc(c.id)+'">Mở khảo sát</button>':(c.status==='OPEN'?'<button class="phfk-btn-secondary" data-close-survey="'+esc(c.id)+'">Đóng đợt</button>':''))+'</header>'+progressHtml(c.progress)+'<div class="phfk-survey-ticket-list">'+(own.map(function(t){return '<button type="button" data-survey-ticket="'+esc(t.id)+'"><b>'+esc(t.frameworkSnapshot.frameworkName||'Bộ KNL')+' · v'+esc(t.frameworkSnapshot.versionNumber||'')+'</b><span>'+esc(t.employeeName)+' · '+esc(ticketStatusLabel(t.status))+'</span></button>';}).join('')||'<p>Chưa có phiếu trong phạm vi.</p>')+'</div></article>';}).join('');
}
function surveyWizardStepsNav(){
  var labels=['Thông tin','Chọn Bộ KNL','Chọn đối tượng','Xem trước','Mở khảo sát'];
  return '<div class="phfk-survey-steps">'+labels.map(function(l,i){var n=i+1,cls=surveyState.wizardStep===n?'active':(surveyState.wizardStep>n?'is-done':'');return '<b class="'+cls+'">'+n+'. '+l+'</b>';}).join('')+'</div>';
}
function campaignWizardHtml(){
  if(!surveyState.setup)return'';
  var versions=surveyState.setup.versions||[],people=surveyState.setup.people||[],step=surveyState.wizardStep,wf=surveyState.wizardForm;
  var step1=step===1?('<div class="phfk-assignment-form">'+
      '<label class="phfk-field"><span>Tên đợt *</span><input class="phfk-input" name="name" minlength="3" required value="'+esc(wf.name)+'"></label>'+
      '<label class="phfk-field"><span>Mô tả</span><input class="phfk-input" name="description" value="'+esc(wf.description)+'"></label>'+
      '<label class="phfk-field"><span>Ngày bắt đầu *</span><input class="phfk-input" type="datetime-local" name="startsAt" required value="'+esc(wf.startsAt)+'"></label>'+
      '<label class="phfk-field"><span>Hạn hoàn thành *</span><input class="phfk-input" type="datetime-local" name="endsAt" required value="'+esc(wf.endsAt)+'"></label>'+
    '</div>'):'';
  var step2=step===2?(!versions.length?
      '<div class="phfk-empty"><p><b>Chưa có phiên bản Bộ KNL đủ điều kiện để tạo khảo sát.</b></p><p>Hãy phát hành phiên bản Bộ KNL trước khi tạo đợt khảo sát.</p><button type="button" class="phfk-btn-secondary" data-survey-goto-versions>Đi tới quản lý phiên bản</button></div>'
    :'<fieldset><legend>Bộ KNL &amp; phiên bản đã phát hành</legend><div class="phfk-survey-picks">'+versions.map(function(v){return '<label><input type="checkbox" name="versionId" value="'+esc(v.id)+'"'+(wf.versionIds.indexOf(v.id)>=0?' checked':'')+'> '+esc(v.frameworkName)+' · v'+esc(v.versionNumber)+'</label>';}).join('')+'</div></fieldset>'):'';
  var step3='';
  if(step===3){
    var filterLabels={department:'phòng ban',branch:'chi nhánh',title:'chức danh',position:'chức vụ'};
    step3='<div class="phfk-survey-target-filters"><input class="phfk-input" type="search" placeholder="Tìm theo tên hoặc mã nhân sự" data-survey-person-search value="'+esc(surveyState.wizardTargetFilters.search)+'">'+
      Object.keys(filterLabels).map(function(key){return '<select class="phfk-input" data-survey-filter="'+key+'"><option value="">Tất cả '+filterLabels[key]+'</option></select>';}).join('')+
      '</div><p class="phfk-survey-target-count"><span data-survey-match-count>—</span> · <span data-survey-selected-count>Đã chọn 0 nhân sự</span></p>'+
      '<div class="phfk-survey-picks phfk-survey-people">'+people.map(function(p){return '<label data-survey-person-row data-code="'+esc(p.employeeCode)+'"><input type="checkbox" name="employeeCode" value="'+esc(p.employeeCode)+'"'+(wf.employeeCodes.indexOf(p.employeeCode)>=0?' checked':'')+'> <b>'+esc(p.employeeCode)+'</b> · '+esc(p.employeeName)+' <small>'+esc([p.department,p.branch,p.title,p.position].filter(Boolean).join(' · '))+'</small></label>';}).join('')+'</div>';
  }
  var step4='';
  if(step===4){
    var p=surveyState.wizardPreview;
    step4=!p?'<div class="phfk-loading">Đang tính số phiếu thực tế…</div>':(
      '<div class="phfk-survey-review"><div><small>Tên đợt</small><b>'+esc(wf.name)+'</b></div>'+
      '<div><small>Bộ KNL</small><b>'+wf.versionIds.length+' phiên bản đã chọn</b></div>'+
      '<div><small>Đối tượng</small><b>'+Number(p.employeeCount||0)+' nhân sự</b></div>'+
      '<div><small>Thời gian</small><b>'+esc(fmtDate(wf.startsAt))+' → '+esc(fmtDate(wf.endsAt))+'</b></div>'+
      '<div><small>Phiếu dự kiến</small><b>'+Number(p.ticketCount||0)+' phiếu</b></div></div>'+
      (p.unassignedCount?'<p class="phfk-warning">'+Number(p.unassignedCount)+' nhân sự chưa có Bộ KNL phù hợp đang áp dụng cho phiên bản đã chọn và sẽ không được tạo phiếu.</p>':'')
    );
  }
  var step5=step===5?(
    '<div class="phfk-survey-review"><div><small>Tên đợt</small><b>'+esc(wf.name)+'</b></div>'+
    '<div><small>Đối tượng</small><b>'+wf.employeeCodes.length+' nhân sự</b></div>'+
    '<div><small>Thời gian</small><b>'+esc(fmtDate(wf.startsAt))+' → '+esc(fmtDate(wf.endsAt))+'</b></div></div>'+
    '<p class="phfk-batch-note">Sau khi mở, đợt khảo sát sẽ sinh phiếu cho các nhân sự có Bộ KNL phù hợp đang áp dụng; tên đợt, thời gian và đối tượng sẽ không sửa được nữa. Chạy lại thao tác này sẽ không tạo phiếu trùng.</p>'
  ):'';
  var footer='<div class="phfk-form-actions phfk-survey-wizard-actions">'+
    (step>1?'<button type="button" class="phfk-btn-secondary" data-wizard-back>← Quay lại</button>':'')+
    '<button type="button" class="phfk-btn-secondary" data-wizard-save-draft>Lưu nháp</button>'+
    (step<5?'<button type="button" class="phfk-btn-primary" data-wizard-next'+(step===2&&!versions.length?' disabled':'')+'>Tiếp tục →</button>':'<button type="button" class="phfk-btn-primary" data-wizard-open>Mở đợt khảo sát</button>')+
    '</div>';
  return '<section class="phfk-panel phfk-survey-create"><div class="phfk-section-head"><div><small>TẠO ĐỢT KHẢO SÁT</small><h2>Tạo đợt khảo sát mới</h2></div><button type="button" class="phfk-link" data-survey-cancel-wizard>Hủy</button></div>'+
    surveyWizardStepsNav()+
    '<form data-survey-campaign-form>'+step1+step2+step3+step4+step5+
    (surveyState.wizardError?'<p class="phfk-error">'+esc(surveyState.wizardError)+'</p>':'')+
    footer+'</form></section>';
}
function renderSurveyList(root,isAdmin){
  var body=root.querySelector('[data-knl-body]');if(!body)return;
  body.innerHTML=surveyNav('khao-sat')+
    '<div class="phfk-page-head"><div><small>KNL · KHẢO SÁT</small><h1>Đợt khảo sát</h1></div>'+(isAdmin&&!surveyState.wizardOpen?'<button type="button" class="phfk-btn-primary" data-survey-open-wizard>+ Tạo đợt khảo sát</button>':'')+'</div>'+
    (isAdmin&&surveyState.wizardOpen?campaignWizardHtml():'')+
    surveyCampaignCards(isAdmin)+
    (surveyState.message?'<p class="phfk-success">'+esc(surveyState.message)+'</p>':'')+(surveyState.error?'<p class="phfk-error">'+esc(surveyState.error)+'</p>':'');
  bindSurveyList(root,isAdmin);
}
function selectedValues(form,name){return Array.from(form.querySelectorAll('[name="'+name+'"]:checked')).map(function(x){return x.value;});}
function syncWizardForm(root){
  var form=root.querySelector('[data-survey-campaign-form]');if(!form)return;
  var fd=new FormData(form);
  if(form.querySelector('[name="name"]')){surveyState.wizardForm.name=fd.get('name')||'';surveyState.wizardForm.description=fd.get('description')||'';surveyState.wizardForm.startsAt=fd.get('startsAt')||'';surveyState.wizardForm.endsAt=fd.get('endsAt')||'';}
  if(form.querySelector('[name="versionId"]'))surveyState.wizardForm.versionIds=selectedValues(form,'versionId');
  if(form.querySelector('[name="employeeCode"]'))surveyState.wizardForm.employeeCodes=selectedValues(form,'employeeCode');
}
function validateWizardStep(step){
  var wf=surveyState.wizardForm;
  if(step===1){
    if(!wf.name||wf.name.trim().length<3)return 'Vui lòng nhập tên đợt (tối thiểu 3 ký tự).';
    if(!wf.startsAt||!wf.endsAt)return 'Vui lòng chọn ngày bắt đầu và hạn hoàn thành.';
    if(wf.endsAt<=wf.startsAt)return 'Hạn hoàn thành phải sau ngày bắt đầu.';
  }else if(step===2){
    if(!wf.versionIds.length)return 'Vui lòng chọn ít nhất một Bộ KNL/phiên bản.';
  }else if(step===3){
    if(!wf.employeeCodes.length)return 'Vui lòng chọn ít nhất một nhân sự.';
  }
  return '';
}
function resetWizard(){surveyState.wizardOpen=false;surveyState.wizardStep=1;surveyState.wizardForm=emptyWizardForm();surveyState.wizardPreview=null;surveyState.wizardError='';surveyState.wizardTargetFilters={department:'',branch:'',title:'',position:'',search:''};}
async function fetchWizardPreview(root,isAdmin){
  surveyState.wizardPreview=null;
  renderSurveyList(root,isAdmin);
  try{var r=await apiPost('getKnlSurveySetup',{versionIds:surveyState.wizardForm.versionIds,employeeCodes:surveyState.wizardForm.employeeCodes});surveyState.wizardPreview=r.preview||{};}
  catch(e){surveyState.wizardError=e.message;}
  renderSurveyList(root,isAdmin);
}
function goWizardStep(root,isAdmin,delta){
  syncWizardForm(root);
  if(delta>0){var err=validateWizardStep(surveyState.wizardStep);if(err){surveyState.wizardError=err;renderSurveyList(root,isAdmin);return;}}
  surveyState.wizardError='';
  surveyState.wizardStep=Math.min(5,Math.max(1,surveyState.wizardStep+delta));
  if(surveyState.wizardStep===4)fetchWizardPreview(root,isAdmin);else renderSurveyList(root,isAdmin);
}
async function submitWizardDraft(root,isAdmin){
  syncWizardForm(root);
  var err=validateWizardStep(1);if(err){surveyState.wizardError=err;renderSurveyList(root,isAdmin);return;}
  var wf=surveyState.wizardForm;
  try{
    var r=await apiPost('saveKnlSurveyCampaign',{campaign:{name:wf.name,description:wf.description,startsAt:wf.startsAt,endsAt:wf.endsAt,versionIds:wf.versionIds,employeeCodes:wf.employeeCodes}});
    surveyState.message='Đã lưu Dự thảo: '+r.preview.employeeCount+' nhân sự, '+r.preview.versionCount+' Bộ KNL/phiên bản, '+r.preview.ticketCount+' phiếu dự kiến.';
    resetWizard();
    await loadSurveyList(root,isAdmin);
  }catch(e){surveyState.wizardError=e.message;renderSurveyList(root,isAdmin);}
}
async function submitWizardOpen(root,isAdmin){
  syncWizardForm(root);
  var err=validateWizardStep(1)||validateWizardStep(2)||validateWizardStep(3);
  if(err){surveyState.wizardError=err;renderSurveyList(root,isAdmin);return;}
  var wf=surveyState.wizardForm;
  try{
    var save=await apiPost('saveKnlSurveyCampaign',{campaign:{name:wf.name,description:wf.description,startsAt:wf.startsAt,endsAt:wf.endsAt,versionIds:wf.versionIds,employeeCodes:wf.employeeCodes}});
    var open=await apiPost('openKnlSurveyCampaign',{campaignId:save.campaignId});
    surveyState.message='Đã mở đợt khảo sát; tạo mới '+open.createdTickets+' phiếu (chạy lại không tạo trùng).';
    resetWizard();
    await loadSurveyList(root,isAdmin);
  }catch(e){surveyState.wizardError=e.message;renderSurveyList(root,isAdmin);}
}
function refreshTargetFilters(root){
  if(!surveyState.setup)return;
  var searchEl=root.querySelector('[data-survey-person-search]');if(!searchEl)return;
  var selects={department:root.querySelector('[data-survey-filter="department"]'),branch:root.querySelector('[data-survey-filter="branch"]'),title:root.querySelector('[data-survey-filter="title"]'),position:root.querySelector('[data-survey-filter="position"]')};
  var labels={department:'phòng ban',branch:'chi nhánh',title:'chức danh',position:'chức vụ'};
  var q=String(searchEl.value||'').toLowerCase();
  surveyState.wizardTargetFilters.search=searchEl.value||'';
  var current={department:selects.department.value,branch:selects.branch.value,title:selects.title.value,position:selects.position.value};
  var people=surveyState.setup.people||[];
  function matches(p,exceptKey){
    if(q&&!(p.employeeCode+' '+p.employeeName).toLowerCase().includes(q))return false;
    return Object.keys(current).every(function(k){if(k===exceptKey)return true;if(!current[k])return true;return p[k]===current[k];});
  }
  Object.keys(selects).forEach(function(key){
    var eligible=people.filter(function(p){return matches(p,key);});
    var values=Array.from(new Set(eligible.map(function(p){return p[key];}).filter(Boolean))).sort();
    if(current[key]&&values.indexOf(current[key])===-1)current[key]='';
    var sel=selects[key],value=current[key];
    sel.innerHTML='<option value="">Tất cả '+labels[key]+'</option>'+values.map(function(v){return '<option value="'+esc(v)+'"'+(v===value?' selected':'')+'>'+esc(v)+'</option>';}).join('');
    sel.value=value;
    surveyState.wizardTargetFilters[key]=value;
  });
  var matchCount=0;
  root.querySelectorAll('[data-survey-person-row]').forEach(function(row){
    var p=people.find(function(x){return x.employeeCode===row.dataset.code;});
    var visible=p&&matches(p,null);
    row.hidden=!visible;
    if(visible)matchCount++;
  });
  var countEl=root.querySelector('[data-survey-match-count]');if(countEl)countEl.textContent=matchCount+' nhân sự phù hợp';
  var selectedEl=root.querySelector('[data-survey-selected-count]');
  if(selectedEl){var n=root.querySelectorAll('[data-survey-person-row] input:checked').length;selectedEl.textContent='Đã chọn '+n+' nhân sự';}
}
function bindSurveyList(root,isAdmin){
  bindSurveyNav(root);
  root.querySelectorAll('[data-survey-ticket]').forEach(function(b){b.onclick=function(){var u=new URL(location.href);u.searchParams.set('ticket',b.getAttribute('data-survey-ticket'));history.pushState({},'',u.pathname+u.search);loadSurveyTicket(root,b.getAttribute('data-survey-ticket'));};});
  root.querySelectorAll('[data-open-survey]').forEach(function(b){b.onclick=function(){
    openKnlConfirmModal({title:'Mở khảo sát',body:'Mở khảo sát và sinh các phiếu theo Bộ KNL đang áp dụng?',confirmLabel:'Mở khảo sát',onConfirm:async function(){
      setKnlButtonBusy(b,true,'Đang mở…');
      try{
        var r=await apiPost('openKnlSurveyCampaign',{campaignId:b.getAttribute('data-open-survey')});
        surveyState.message='Đã mở khảo sát; tạo mới '+r.createdTickets+' phiếu (chạy lại không tạo trùng).';
        await loadSurveyList(root,isAdmin);
        knlToast('success','Đã mở khảo sát',surveyState.message,3200,'knl-survey-open');
      }catch(e){
        surveyState.error=e.message;renderSurveyList(root,isAdmin);
        knlToast('error','Chưa thể mở khảo sát',e.message||'Vui lòng thử lại.',4800,'knl-survey-open');
      }finally{
        setKnlButtonBusy(b,false);
      }
    }});
  };});
  root.querySelectorAll('[data-close-survey]').forEach(function(b){b.onclick=function(){
    openKnlConfirmModal({title:'Đóng đợt khảo sát',body:'Đóng đợt sẽ khóa toàn bộ phiếu. Tiếp tục?',confirmLabel:'Đóng đợt',onConfirm:async function(){
      setKnlButtonBusy(b,true,'Đang đóng…');
      try{
        await apiPost('closeKnlSurveyCampaign',{campaignId:b.getAttribute('data-close-survey')});
        await loadSurveyList(root,isAdmin);
        knlToast('success','Đã đóng đợt khảo sát','Toàn bộ phiếu trong đợt đã được khóa.',3200,'knl-survey-close');
      }catch(e){
        surveyState.error=e.message;renderSurveyList(root,isAdmin);
        knlToast('error','Chưa thể đóng đợt',e.message||'Vui lòng thử lại.',4800,'knl-survey-close');
      }finally{
        setKnlButtonBusy(b,false);
      }
    }});
  };});
  if(!isAdmin)return;
  root.querySelectorAll('[data-survey-open-wizard]').forEach(function(b){b.onclick=function(){surveyState.wizardOpen=true;renderSurveyList(root,isAdmin);};});
  var cancel=root.querySelector('[data-survey-cancel-wizard]');if(cancel)cancel.onclick=function(){resetWizard();renderSurveyList(root,isAdmin);};
  var form=root.querySelector('[data-survey-campaign-form]');if(!form)return;
  var back=root.querySelector('[data-wizard-back]');if(back)back.onclick=function(){goWizardStep(root,isAdmin,-1);};
  var next=root.querySelector('[data-wizard-next]');if(next)next.onclick=function(){goWizardStep(root,isAdmin,1);};
  var draft=root.querySelector('[data-wizard-save-draft]');if(draft)draft.onclick=function(){submitWizardDraft(root,isAdmin);};
  var open=root.querySelector('[data-wizard-open]');if(open)open.onclick=function(){submitWizardOpen(root,isAdmin);};
  var gotoVersions=root.querySelector('[data-survey-goto-versions]');if(gotoVersions)gotoVersions.onclick=function(){if(typeof window.phfNavigate==='function')window.phfNavigate(knlPath('phien-ban-lich-su'));};
  if(root.querySelector('[data-survey-person-search]')){
    refreshTargetFilters(root);
    ['[data-survey-person-search]','[data-survey-filter="department"]','[data-survey-filter="branch"]','[data-survey-filter="title"]','[data-survey-filter="position"]'].forEach(function(sel){
      var el=root.querySelector(sel);if(el)el[el.tagName==='INPUT'?'oninput':'onchange']=function(){refreshTargetFilters(root);};
    });
    var picks=root.querySelector('.phfk-survey-people');
    if(picks)picks.addEventListener('change',function(e){if(e.target&&e.target.name==='employeeCode'){var n=picks.querySelectorAll('input:checked').length;var el=root.querySelector('[data-survey-selected-count]');if(el)el.textContent='Đã chọn '+n+' nhân sự';}});
  }
}
async function loadSurveyList(root,isAdmin){surveyState.loading=true;try{var calls=[apiPost('listKnlSurveyCampaigns')];if(isAdmin)calls.push(apiPost('getKnlSurveySetup'));var r=await Promise.all(calls);surveyState.campaigns=r[0].campaigns||[];surveyState.tickets=r[0].tickets||[];surveyState.setup=isAdmin?r[1]:null;surveyState.error='';surveyState.loaded=true;surveyState.loadedAt=Date.now();}catch(e){surveyState.error=e.message;}surveyState.loading=false;renderSurveyList(root,isAdmin);}

function responseValue(itemId,key){var r=(surveyState.detail.responses||[]).find(function(x){return x.itemId===itemId;});return r?r[key]||'':'';}
function ticketFormHtml(){var d=surveyState.detail,t=d.ticket,c=d.campaign,answered=d.items.filter(function(i){return responseValue(i.id,'selectedColumnId')&&responseValue(i.id,'suitability');}).length;return '<button class="phfk-link" data-survey-back>← Danh sách phiếu</button><section class="phfk-panel phfk-survey-form-head"><small>'+esc(c.name)+'</small><h1>'+esc(t.frameworkSnapshot.frameworkName)+' · Phiên bản '+esc(t.frameworkSnapshot.versionNumber)+'</h1><p>Hạn hoàn thành: '+fmtDate(c.endsAt)+' · Tiến độ '+answered+'/'+d.items.length+(d.readOnly?' · Chỉ đọc':'')+'</p></section><form data-survey-ticket-form>'+d.groups.map(function(g){var items=d.items.filter(function(i){return i.groupId===g.id;});return '<section class="phfk-panel phfk-survey-group"><header><h2>'+esc(g.name)+'</h2><p>'+esc(g.description)+'</p></header>'+items.map(function(item){var selected=responseValue(item.id,'selectedColumnId'),suit=responseValue(item.id,'suitability'),comment=responseValue(item.id,'comment');return '<article class="phfk-survey-item" id="survey-item-'+esc(item.id)+'" data-survey-item="'+esc(item.id)+'"><h3>'+esc(item.name)+'</h3>'+(item.description?'<p>'+esc(item.description)+'</p>':'')+'<fieldset><legend>Mức tự đánh giá <em>*</em></legend><div class="phfk-level-options">'+d.levels.map(function(l){var content=(d.levelContents.find(function(x){return x.itemId===item.id&&x.columnId===l.id;})||{}).content||'Chưa có mô tả';return '<label title="'+esc(content)+'"><input type="radio" name="level-'+esc(item.id)+'" value="'+esc(l.id)+'" data-level-number="'+l.levelNumber+'"'+(selected===l.id?' checked':'')+(d.readOnly?' disabled':'')+'><b>Mức '+l.levelNumber+'</b><span>'+esc(content)+'</span></label>';}).join('')+'</div></fieldset><fieldset><legend>Mức phù hợp <em>*</em></legend><div class="phfk-suit-options">'+[['SUITABLE','Phù hợp'],['UNCLEAR','Chưa rõ'],['UNSUITABLE','Không phù hợp']].map(function(x){return '<label><input type="radio" name="suit-'+esc(item.id)+'" value="'+x[0]+'"'+(suit===x[0]?' checked':'')+(d.readOnly?' disabled':'')+'> '+x[1]+'</label>';}).join('')+'</div></fieldset><label class="phfk-field"><span>Góp ý <small>(bắt buộc nếu Chưa rõ/Không phù hợp)</small></span><textarea class="phfk-input" name="comment-'+esc(item.id)+'"'+(d.readOnly?' disabled':'')+'>'+esc(comment)+'</textarea></label><p class="phfk-error" data-item-error hidden></p></article>';}).join('')+'</section>';}).join('')+'<section class="phfk-panel"><label class="phfk-field"><span>Theo bạn, công việc/năng lực quan trọng nào của vị trí hiện chưa được phản ánh trong khung này?</span><textarea class="phfk-input" name="generalFeedback"'+(d.readOnly?' disabled':'')+'>'+esc(t.generalFeedback||'')+'</textarea></label></section>'+(d.readOnly?'': '<div class="phfk-survey-sticky"><span data-autosave-status></span><button type="button" class="phfk-btn-secondary" data-save-draft>Lưu nháp</button><button type="submit" class="phfk-btn-primary">'+(t.status==='SUBMITTED'?'Gửi lại phản hồi':'Gửi khảo sát')+'</button></div>')+'</form>'+(d.history.length?'<section class="phfk-panel"><h2>Lịch sử gửi</h2>'+d.history.map(function(h){return '<p>Lần '+h.revision+' · '+esc(submissionActionLabel(h.action))+' · '+fmtDate(h.submitted_at)+' · '+esc(h.submitted_by_name||'')+'</p>';}).join('')+'</section>':'');}
function collectTicket(root,validate){var responses=[],firstInvalid=null;surveyState.detail.items.forEach(function(item){var block=root.querySelector('[data-survey-item="'+item.id+'"]'),level=block.querySelector('[name="level-'+item.id+'"]:checked'),suit=block.querySelector('[name="suit-'+item.id+'"]:checked'),comment=block.querySelector('[name="comment-'+item.id+'"]').value.trim(),invalid=validate&&(!level||!suit||((suit.value==='UNCLEAR'||suit.value==='UNSUITABLE')&&!comment));block.classList.toggle('is-invalid',!!invalid);var err=block.querySelector('[data-item-error]');err.hidden=!invalid;if(invalid)err.textContent=!level?'Vui lòng chọn mức tự đánh giá.':(!suit?'Vui lòng chọn mức phù hợp.':'Vui lòng nhập góp ý cho lựa chọn này.');if(invalid&&!firstInvalid)firstInvalid=block;responses.push({itemId:item.id,selectedColumnId:level?level.value:'',selectedLevelNumber:level?Number(level.dataset.levelNumber):null,suitability:suit?suit.value:'',comment:comment});});return{responses:responses,generalFeedback:root.querySelector('[name="generalFeedback"]').value.trim(),firstInvalid:firstInvalid};}
async function saveTicketFromForm(root,submit,silent){var payload=collectTicket(root,submit);if(payload.firstInvalid){payload.firstInvalid.scrollIntoView({behavior:'smooth',block:'center'});payload.firstInvalid.querySelector('input,textarea').focus();return false;}var status=root.querySelector('[data-autosave-status]');if(status)status.textContent=submit?'Đang gửi…':'Đang lưu…';try{await apiPost('saveKnlSurveyTicket',{ticketId:surveyState.detail.ticket.id,responses:payload.responses,generalFeedback:payload.generalFeedback,submit:submit});if(status)status.textContent=submit?'Đã gửi':'Đã tự động lưu';if(submit&&!silent){surveyState.message='Đã gửi phản hồi và lưu lịch sử revision.';await loadSurveyTicket(root,surveyState.detail.ticket.id);}return true;}catch(e){if(status)status.textContent=e.message;return false;}}
function bindTicket(root){var back=root.querySelector('[data-survey-back]');if(back)back.onclick=function(){var u=new URL(location.href);u.searchParams.delete('ticket');history.pushState({},'',u.pathname+u.search);if(surveyState.loaded&&Date.now()-surveyState.loadedAt<KNL_READ_CACHE_TTL)renderSurveyList(root,knlLastIsAdmin);else loadSurveyList(root,knlLastIsAdmin);};var form=root.querySelector('[data-survey-ticket-form]');if(!form||surveyState.detail.readOnly)return;form.onchange=function(){clearTimeout(surveyState.autosaveTimer);surveyState.autosaveTimer=setTimeout(function(){saveTicketFromForm(root,false,true);},900);};var save=root.querySelector('[data-save-draft]');if(save)save.onclick=function(){saveTicketFromForm(root,false,false);};form.onsubmit=function(e){e.preventDefault();saveTicketFromForm(root,true,false);};}
async function loadSurveyTicket(root,ticketId){try{surveyState.detail=await apiPost('getKnlSurveyTicket',{ticketId:ticketId});var body=root.querySelector('[data-knl-body]');body.innerHTML=ticketFormHtml();bindTicket(root);}catch(e){surveyState.error=e.message;renderSurveyList(root,false);}}

function resultFiltersHtml(r){var o=r.filterOptions||{},f=surveyState.resultFilters;function select(key,label,rows,value,labelFn){return '<select class="phfk-input" data-result-filter="'+key+'"><option value="">Tất cả '+label+'</option>'+rows.map(function(x){var v=value(x);return '<option value="'+esc(v)+'"'+(f[key]===v?' selected':'')+'>'+esc(labelFn(x))+'</option>';}).join('')+'</select>';}return '<div class="phfk-filters phfk-survey-result-filters">'+select('versionId','Bộ KNL',o.versions||[],function(x){return x.id;},function(x){return x.name+' · v'+x.versionNumber;})+select('department','phòng ban',o.departments||[],String,String)+select('branch','chi nhánh',o.branches||[],String,String)+select('title','chức danh',o.titles||[],String,String)+select('position','chức vụ',o.positions||[],String,String)+select('employeeCode','nhân sự',o.people||[],function(x){return x.employeeCode;},function(x){return x.employeeCode+' · '+x.employeeName;})+'</div>';}
function suitabilityLabel(v){return {SUITABLE:'Phù hợp',UNCLEAR:'Chưa rõ',UNSUITABLE:'Không phù hợp'}[v]||(v||'—');}
function resultsHtml(){
  var r=surveyState.results;
  if(!r)return'<section class="phfk-empty"><p>Chọn một đợt để xem kết quả.</p></section>';
  if(Number(r.progress&&r.progress.submitted||0)===0){
    return progressHtml(r.progress)+'<section class="phfk-empty"><h3>Chưa có kết quả khảo sát</h3><p>Kết quả sẽ xuất hiện khi đợt khảo sát có phiếu đánh giá được hoàn thành.</p></section>';
  }
  var clone=r.canClone?'<section class="phfk-panel"><div class="phfk-section-head"><div><small>PHIÊN BẢN AN TOÀN</small><h2>Tạo phiên bản Dự thảo mới từ kết quả khảo sát</h2></div></div><div class="phfk-mini-actions">'+(r.versions||[]).map(function(v){return '<button type="button" data-clone-survey-version="'+esc(v.id)+'">Sao chép '+esc(v.frameworkName||v.name)+' · v'+esc(v.versionNumber)+'</button>';}).join('')+'</div></section>':'';
  return resultFiltersHtml(r)+progressHtml(r.progress)+'<section class="phfk-panel"><div class="phfk-section-head"><div><small>CHẤT LƯỢNG BỘ KNL</small><h2>Phản hồi theo hạng mục</h2></div><label class="phfk-check"><input type="checkbox" data-needs-review> Chỉ hiện Cần xem xét</label></div><div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Nhóm / Hạng mục</th><th>% Phù hợp</th><th>% Chưa rõ</th><th>% Không phù hợp</th><th>Phân bố mức</th><th>Góp ý</th></tr></thead><tbody>'+r.quality.map(function(q){return '<tr data-quality-row data-needs="'+q.needsReview+'"><td><details><summary><b>'+esc(q.groupName)+'</b><br>'+esc(q.itemName)+'</summary>'+q.details.map(function(d){return '<p><b>'+esc(d.employeeCode)+' · '+esc(d.employeeName)+'</b>: Mức '+esc(d.selectedLevelNumber)+' · '+esc(suitabilityLabel(d.suitability))+(d.comment?' · '+esc(d.comment):'')+'</p>';}).join('')+'</details></td><td>'+q.suitablePct+'%</td><td>'+q.unclearPct+'%</td><td>'+q.unsuitablePct+'%</td><td>'+esc(Object.keys(q.levelDistribution).map(function(k){return 'M'+k+': '+q.levelDistribution[k];}).join(' · '))+'</td><td>'+q.commentCount+'</td></tr>';}).join('')+'</tbody></table></div></section>'+clone;
}
async function loadSurveyResults(root){
  var body=root.querySelector('[data-knl-body]');
  // Fix gap: trước đây khi đổi bộ lọc/đợt khảo sát, màn hình đứng im không
  // báo hiệu gì cho tới khi API trả về — nay luôn hiện .phfk-loading trong
  // lúc chờ, kể cả trên các lần đổi filter/campaign sau lần tải đầu.
  body.innerHTML=surveyNav('ket-qua-khao-sat')+'<div class="phfk-loading">Đang tải kết quả khảo sát…</div>';
  try{
    var list=await apiPost('listKnlSurveyCampaigns'),campaignId=new URL(location.href).searchParams.get('campaign')||(list.campaigns[0]||{}).id;
    surveyState.campaigns=list.campaigns||[];
    if(campaignId)surveyState.results=await apiPost('getKnlSurveyResults',{campaignId:campaignId,filters:surveyState.resultFilters});
    body.innerHTML=surveyNav('ket-qua-khao-sat')+'<label class="phfk-field phfk-survey-result-select"><span>Đợt khảo sát</span><select class="phfk-input" data-result-campaign>'+surveyState.campaigns.map(function(c){return '<option value="'+esc(c.id)+'"'+(c.id===campaignId?' selected':'')+'>'+esc(c.name)+'</option>';}).join('')+'</select></label>'+resultsHtml();
    bindSurveyNav(root);
    var select=root.querySelector('[data-result-campaign]');if(select)select.onchange=function(){surveyState.resultFilters={};var u=new URL(location.href);u.searchParams.set('campaign',select.value);history.pushState({},'',u.pathname+u.search);loadSurveyResults(root);};
    root.querySelectorAll('[data-result-filter]').forEach(function(el){el.onchange=function(){surveyState.resultFilters[el.getAttribute('data-result-filter')]=el.value;loadSurveyResults(root);};});
    var review=root.querySelector('[data-needs-review]');if(review)review.onchange=function(){root.querySelectorAll('[data-quality-row]').forEach(function(row){row.hidden=review.checked&&row.dataset.needs!=='true';});};
    root.querySelectorAll('[data-clone-survey-version]').forEach(function(b){b.onclick=async function(){
      var values=await openKnlPromptModal({title:'Tạo phiên bản Dự thảo mới',body:'Sao chép từ kết quả khảo sát — phiên bản đã khảo sát không bị thay đổi.',fields:[{name:'name',label:'Tên phiên bản Dự thảo mới',value:'Dự thảo từ kết quả khảo sát',required:true}]});
      if(!values)return;
      setKnlButtonBusy(b,true,'Đang sao chép…');
      try{
        await apiPost('cloneKnlSurveyVersionToDraft',{campaignId:campaignId,versionId:b.getAttribute('data-clone-survey-version'),name:values.name});
        knlToast('success','Đã tạo phiên bản Dự thảo mới','Phiên bản đã khảo sát không bị thay đổi.',3200,'knl-clone-survey-version');
      }catch(e){
        knlToast('error','Chưa thể tạo phiên bản Dự thảo',e.message||'Vui lòng thử lại.',4800,'knl-clone-survey-version');
      }finally{
        setKnlButtonBusy(b,false);
      }
    };});
  }catch(e){
    body.innerHTML=surveyNav('ket-qua-khao-sat')+noAccessSection(e.message);
    bindSurveyNav(root);
  }
}

/* ===================== GRADE + EFFECTIVE VERSION + REFERENCE INCOME ===================== */

var foundationState={frameworks:[],detail:null,matrix:null,standards:null,preview:null,income:null,incomeLoading:false,incomeTargets:[],incomeTargetsLoaded:false,incomeCanSelect:false,incomeIsAdmin:false,error:'',pendingNewGrades:[],gradeSaving:false,gradeMessage:'',gradeDirty:false,competency:null,competencyGradeSequence:[],competencyWindowStart:0,competencyHistory:null,profile:null};
var compensationState={standards:null,ladderId:'',versionId:'',pendingGrades:{},expandedGradeId:'',error:'',message:''};
var assignState={targets:[],targetsLoaded:false,standards:null,selectedCode:'',current:null,form:null,error:'',message:''};
var historyState={versionAudit:[],employeeHistory:[],employeeFilter:'',error:''};
function money(value){return new Intl.NumberFormat('vi-VN').format(Number(value||0))+' đ';}
function pctChange(base,value){base=Number(base);value=Number(value);if(!base)return 0;return (value-base)/base*100;}
function pctText(value){return (value>=0?'+':'')+value.toFixed(1)+'%';}
/* Ngưỡng độ dốc thang lương theo UX baseline đã duyệt — thuần trình bày,
   không phải rule dữ liệu/nghiệp vụ: ≤8% Thấp, 8–18% Hợp lý, >18% Cao. */
function pctTier(value){var abs=Math.abs(value);if(value<0)return'is-pct-negative';if(abs<=8)return'is-pct-low';if(abs<=18)return'is-pct-normal';return'is-pct-high';}
function pctBadge(value){return '<span class="phfk-pct '+pctTier(value)+'">'+pctText(value)+(pctTier(value)==='is-pct-high'?' ⚠':'')+'</span>';}
var MEAL_SUGGESTION=910000;
var PROBATION_SUGGESTION=6800000;
/* Kỳ khuyến nghị = tháng hiện tại (theo đồng hồ máy) + 1 - mục 4 Batch 2. Chỉ
   là gợi ý mặc định trên form, Admin vẫn chọn được kỳ khác (mục 17: "N+1 chỉ
   là default, không hard-lock"). So sánh chuỗi YYYY-MM hoạt động đúng theo
   thời gian vì định dạng đã cố định độ dài. */
function assignRecommendedPeriod(){var d=new Date(),y=d.getFullYear(),m=d.getMonth()+2;if(m>12){m-=12;y+=1;}return y+'-'+(m<10?'0'+m:''+m);}
function assignIsRetroactive(period){return !!period&&period<assignRecommendedPeriod();}
function foundationVersionOptions(){return (foundationState.frameworks||[]).filter(function(f){return f.status!=='inactive';}).reduce(function(rows,f){return rows.concat((f.versions||[]).map(function(v){return '<option value="'+esc(v.id)+'">'+esc(f.code+' · v'+v.versionNumber+' · '+v.name)+'</option>';}));},[]).join('');}
async function loadFoundationVersion(versionId){var id=versionId||new URL(location.href).searchParams.get('version');if(!foundationState.frameworks.length){var list=await apiPost('listKnlFrameworks');foundationState.frameworks=list.frameworks||[];}if(!id){var firstFramework=(foundationState.frameworks||[]).filter(function(f){return f.status!=='inactive';})[0];var first=(firstFramework&&firstFramework.versions||[])[0];id=first&&first.id;}if(!id)return null;
  var previousId=foundationState.detail&&foundationState.detail.version&&foundationState.detail.version.id;if(id!==previousId){foundationState.pendingNewGrades=[];foundationState.gradeMessage='';foundationState.error='';foundationState.gradeDirty=false;}
  var pair=await Promise.all([apiPost('getKnlFrameworkVersion',{versionId:id}),apiPost('getKnlGradeMatrix',{versionId:id})]);foundationState.detail=pair[0];foundationState.matrix=pair[1];
  if(!foundationState.pendingNewGrades.length){
    var savedForDraft=foundationState.matrix.grades||[];
    if(savedForDraft.length){foundationState.pendingNewGrades=savedForDraft.map(function(g){return{id:g.id,gradeCode:g.gradeCode,gradeNumber:g.gradeNumber,label:g.label,sortOrder:g.sortOrder};});}
    else{var levelCols=orderedActive(foundationState.detail.columns).filter(function(c){return c.type==='level';});foundationState.pendingNewGrades=levelCols.map(function(c,index){var n=index+1;return{gradeCode:'B'+n,gradeNumber:n,label:'Bậc '+n,sortOrder:n};});}
  }
  return id;}
function gradeMatrixHtml(){var d=foundationState.detail,m=foundationState.matrix;if(!d||!m)return noAccessSection('Chưa có phiên bản Khung năng lực để cấu hình.');var levels=orderedActive(d.columns).filter(function(c){return c.type==='level';}),items=orderedActive(d.items),savedGrades=m.grades||[],grades=foundationState.pendingNewGrades,byKey={};(m.requirements||[]).forEach(function(r){byKey[r.itemId+':'+r.gradeId]=r;});var warning=false;items.forEach(function(item){var prior=0;savedGrades.forEach(function(g){var r=byKey[item.id+':'+g.id],n=Number(r&&r.requiredLevelNumber||1);if(prior&&n<prior)warning=true;prior=n;});});
  var mutable=d.version.lifecycleStatus==='DRAFT'&&!d.version.isLocked;
  var saving=foundationState.gradeSaving===true;
  var interactive=mutable&&!saving;
  var addGradeBtn=interactive?'<button type="button" class="phfk-btn-secondary" data-grade-add>+ Thêm bậc</button>':'';
  var dirty=foundationState.gradeDirty===true;
  var saveLabel=saving?'Đang lưu…':'Lưu ma trận';
  var savebarState=!savedGrades.length?'is-new':(dirty?'is-dirty':'is-saved');
  var savebarLabel=!savedGrades.length?'Chưa lưu · baseline khởi tạo':(dirty?'Có thay đổi chưa lưu':'Đã lưu');
  var savebarHtml='<div class="phfk-grade-savebar '+savebarState+'" data-grade-status-badge><span class="phfk-grade-savebar-label">'+esc(savebarLabel)+'</span><small>Thay đổi chỉ được lưu lại khi bạn bấm "Lưu ma trận".</small></div>';
  var statusLine=saving?'<p class="phfk-batch-note" data-grade-status>Đang lưu ma trận…</p>':(foundationState.gradeMessage?'<p class="phfk-success" data-grade-status>'+esc(foundationState.gradeMessage)+'</p>':(foundationState.error?'<p class="phfk-error" data-grade-status>'+esc(foundationState.error)+'</p>':''));
  return frameworkDomainNav('tieu-chuan-bac')+'<div class="phfk-page-head"><div><small>KNL · TIÊU CHUẨN BẬC</small><h1>Tiêu chuẩn bậc năng lực</h1></div></div><label class="phfk-field phfk-foundation-select"><span>Chọn phiên bản</span><select class="phfk-input" data-foundation-version'+(saving?' disabled':'')+'>'+foundationVersionOptions()+'</select></label><section class="phfk-panel"><div class="phfk-section-head"><div><small>'+esc(d.framework.code+' · v'+d.version.versionNumber)+'</small><h2>Item × Bậc = Mức bắt buộc</h2></div><div class="phfk-mini-actions">'+addGradeBtn+'<button class="phfk-btn-primary'+((dirty&&!saving)?' phfk-btn-attention':'')+'" data-grade-save'+(!grades.length||!interactive?' disabled':'')+'>'+esc(saveLabel)+'</button></div></div>'+savebarHtml+statusLine+'<p class="phfk-batch-note">Mỗi ô là yêu cầu độc lập; không tính trung bình. Số bậc B1..Bn và mức M1..Mn lấy động theo phiên bản.</p>'+(!savedGrades.length?'<p class="phfk-warning">Phiên bản CHƯA có tiêu chuẩn bậc chính thức — đây KHÔNG phải tiêu chuẩn đã được PHF duyệt. Đây chỉ là gợi ý sẵn B1–B'+levels.length+' (khớp số mức M) với mặc định đường chéo B1→M1, B2→M2… B'+levels.length+'→M'+levels.length+' để Admin có điểm khởi đầu chỉnh sửa, hoàn toàn ở phía trình duyệt, chưa được lưu. Hãy tự đặt tên bậc, thêm/bớt bậc, chọn đúng mức yêu cầu từng ô rồi bấm "Lưu ma trận" mới thành dữ liệu chính thức.</p>':'')+(warning?'<p class="phfk-warning">Có bậc sau thấp hơn bậc trước. Đây chỉ là cảnh báo, không tự động sửa.</p>':'')+(!grades.length?'':'<div class="phfk-dynamic-table-wrap"><table class="phfk-dynamic-table phfk-grade-table"><thead><tr><th>Hạng mục</th>'+grades.map(function(g){return'<th><span class="phfk-grade-head"><b>'+esc(g.label||g.gradeCode)+'</b>'+(interactive?'<button type="button" class="phfk-grade-remove-btn" data-grade-remove="'+esc(g.gradeCode)+'" title="Xóa bậc" aria-label="Xóa bậc '+esc(g.label||g.gradeCode)+'">🗑</button>':'')+'</span></th>';}).join('')+'</tr></thead><tbody>'+items.map(function(item){return'<tr><td><b>'+esc(item.name)+'</b></td>'+grades.map(function(g){var r=byKey[item.id+':'+g.id],diagonalDefault=savedGrades.length?1:Math.min(g.gradeNumber,levels.length||1),selected=Number(r&&r.requiredLevelNumber||diagonalDefault);return'<td><select class="phfk-input" data-grade-cell="'+esc(item.id)+':'+esc(g.gradeCode)+'"'+(interactive?'':' disabled')+'>'+levels.map(function(l){return'<option value="'+esc(l.id)+'|'+l.levelNumber+'"'+(l.levelNumber===selected?' selected':'')+'>M'+l.levelNumber+'</option>';}).join('')+'</select></td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div>')+'</section>';}
function rerenderGradeMatrixLocal(root,id){var body=root.querySelector('[data-knl-body]');if(body)body.innerHTML=gradeMatrixHtml();bindGradeMatrixInteractions(root,id);}
function bindGradeMatrixInteractions(root,id){bindFrameworkDomainNav(root);var body=root.querySelector('[data-knl-body]');
    var select=root.querySelector('[data-foundation-version]');if(select){select.value=id;select.onchange=function(){renderGradeMatrix(root,select.value);};}
    var addGrade=root.querySelector('[data-grade-add]');if(addGrade)addGrade.onclick=async function(){
      var n=foundationState.pendingNewGrades.length+1;
      var values=await openKnlPromptModal({title:'Thêm bậc B'+n,body:'Admin tự đặt tên; không tự động sinh.',fields:[{name:'label',label:'Tên bậc B'+n,value:'Bậc '+n}]});
      if(values===null)return;
      foundationState.pendingNewGrades.push({gradeCode:'B'+n,gradeNumber:n,label:values.label||('Bậc '+n),sortOrder:n});
      foundationState.gradeDirty=true;rerenderGradeMatrixLocal(root,id);
    };
    root.querySelectorAll('[data-grade-remove]').forEach(function(el){el.onclick=function(){
      var code=el.dataset.gradeRemove,target=foundationState.pendingNewGrades.find(function(g){return g.gradeCode===code;});
      if(!target)return;
      var hasSavedData=!!target.id;
      openKnlConfirmModal({
        title:'Xóa bậc "'+(target.label||target.gradeCode)+' ('+target.gradeCode+')"?',
        body:hasSavedData?'Bậc này đã có mức bắt buộc (M-level) đã được lưu. Các mức đó sẽ bị xóa khi bạn bấm "Lưu ma trận" — thao tác này CHƯA được lưu ngay bây giờ.':'Bậc này chưa có dữ liệu đã lưu; bỏ khỏi danh sách không ảnh hưởng tới dữ liệu đã ghi.',
        note:'Bấm "Lưu ma trận" mới chính thức ghi thay đổi này. Bấm Hủy để giữ nguyên.',
        confirmLabel:'Xóa bậc',
        onConfirm:function(){
          foundationState.pendingNewGrades=foundationState.pendingNewGrades.filter(function(g){return g.gradeCode!==code;}).map(function(g,index){var n=index+1;return{id:g.id,gradeCode:'B'+n,gradeNumber:n,label:g.label,sortOrder:n};});
          foundationState.gradeDirty=true;
          rerenderGradeMatrixLocal(root,id);
        }
      });
    };});
    root.querySelectorAll('[data-grade-cell]').forEach(function(el){el.onchange=function(){
      if(!(foundationState.matrix.grades||[]).length)return;
      foundationState.gradeDirty=true;
      var bar=root.querySelector('[data-grade-status-badge]');
      if(bar){
        bar.className='phfk-grade-savebar is-dirty';
        var label=bar.querySelector('.phfk-grade-savebar-label');
        if(label)label.textContent='Có thay đổi chưa lưu';
      }
      var saveBtn=root.querySelector('[data-grade-save]');
      if(saveBtn)saveBtn.classList.add('phfk-btn-attention');
    };});
    var save=root.querySelector('[data-grade-save]');if(save)save.onclick=async function(){
      if(foundationState.gradeSaving)return;
      var grades=foundationState.pendingNewGrades;if(!grades.length)return;
      var requirements=[];root.querySelectorAll('[data-grade-cell]').forEach(function(el){var key=el.dataset.gradeCell.split(':'),value=el.value.split('|');requirements.push({itemId:key[0],gradeCode:key[1],requiredColumnId:value[0],requiredLevelNumber:Number(value[1])});});
      foundationState.gradeSaving=true;foundationState.gradeMessage='';foundationState.error='';
      rerenderGradeMatrixLocal(root,id);
      try{
        await apiPost('saveKnlGradeMatrix',{versionId:id,grades:grades,requirements:requirements});
        foundationState.matrix=null;foundationState.pendingNewGrades=[];foundationState.gradeSaving=false;foundationState.gradeDirty=false;foundationState.gradeMessage='Đã lưu ma trận thành công.';
        await renderGradeMatrix(root,id);
      }catch(e){
        foundationState.gradeSaving=false;foundationState.error=e.message||'Không thể lưu ma trận. Vui lòng thử lại.';
        rerenderGradeMatrixLocal(root,id);
      }
    };
  }
async function renderGradeMatrix(root,versionId){var body=root.querySelector('[data-knl-body]');try{var id=await loadFoundationVersion(versionId);body.innerHTML=gradeMatrixHtml();bindGradeMatrixInteractions(root,id);}catch(e){body.innerHTML=frameworkDomainNav('tieu-chuan-bac')+noAccessSection(e.message);bindFrameworkDomainNav(root);}}
function lifecycleStatusLabel(v){return {DRAFT:'Chưa đặt hiệu lực',SCHEDULED:'Đã lên lịch hiệu lực',ACTIVE:'Đang có hiệu lực',INACTIVE:'Hết hiệu lực'}[v]||(v||'—');}
function fmtKnlDateTime(v){
  if(!v)return '—';
  if(/^\d{4}-\d{2}-\d{2}$/.test(v)){var parts=v.split('-');return parts[2]+'/'+parts[1]+'/'+parts[0];}
  var d=new Date(v);
  if(isNaN(d.getTime()))return v;
  var dd=String(d.getDate()).padStart(2,'0'),mm=String(d.getMonth()+1).padStart(2,'0'),yyyy=d.getFullYear();
  var hh=String(d.getHours()).padStart(2,'0'),mi=String(d.getMinutes()).padStart(2,'0');
  return dd+'/'+mm+'/'+yyyy+' · '+hh+':'+mi;
}
var vhState={frameworks:[],selectedFrameworkId:'',selectedVersionId:'',detail:null,detailLoading:false,error:''};
function vhCurrentFramework(){return (vhState.frameworks||[]).find(function(f){return f.id===vhState.selectedFrameworkId;});}
function vhVersionsForSelectedFramework(){var f=vhCurrentFramework();return (f&&f.versions||[]).slice().sort(function(a,b){return b.versionNumber-a.versionNumber;});}
function vhSelectorHtml(){
  var fwOptions=(vhState.frameworks||[]).map(function(f){return '<option value="'+esc(f.id)+'"'+(vhState.selectedFrameworkId===f.id?' selected':'')+'>'+esc(f.name)+'</option>';}).join('');
  return '<label class="phfk-field phfk-vh-select"><span>Chọn Bộ KNL</span><select class="phfk-input" data-vh-framework-select>'+fwOptions+'</select></label>';
}
function vhListHtml(){
  var versions=vhVersionsForSelectedFramework();
  if(!versions.length)return '<div class="phfk-empty">Chưa có phiên bản.</div>';
  return '<div class="phfk-vh-list">'+versions.map(function(v){
    var badgeClass=v.status==='published'&&v.isLocked?'is-ready':'is-review';
    return '<button type="button" class="phfk-vh-list-item'+(vhState.selectedVersionId===v.id?' active':'')+'" data-vh-version="'+esc(v.id)+'">'+
      '<div class="phfk-vh-list-item-head"><b>v'+v.versionNumber+' · '+esc(v.name)+'</b><span class="phfk-source-status '+badgeClass+'">'+esc(statusLabel(v.status))+'</span></div>'+
      '<small>Hiệu lực từ: '+esc(fmtKnlDateTime(v.effectiveFrom))+'</small>'+
      '</button>';
  }).join('')+'</div>';
}
function vhDetailHtml(){
  if(vhState.detailLoading)return '<div class="phfk-loading">Đang tải chi tiết phiên bản…</div>';
  var d=vhState.detail;
  if(!d)return '<div class="phfk-empty">Chọn một phiên bản để xem chi tiết.</div>';
  var v=d.version,f=d.framework;
  var groupCount=(d.groups||[]).length,itemCount=(d.items||[]).length,levelCount=(d.columns||[]).filter(function(c){return c.type==='level';}).length;
  var canSetEffective=v.status==='published'&&v.isLocked&&['DRAFT','SCHEDULED'].indexOf(v.lifecycleStatus)>=0;
  var badgeClass=v.status==='published'&&v.isLocked?'is-ready':'is-review';
  return '<section class="phfk-panel phfk-vh-detail-head"><div><h2>v'+v.versionNumber+' · '+esc(v.name)+'</h2><span class="phfk-source-status '+badgeClass+'">'+esc(statusLabel(v.status))+(v.isLocked?' · Đã khóa':'')+'</span></div>'+(canSetEffective?'<button type="button" class="phfk-btn-secondary" data-vh-set-effective>Đặt hiệu lực</button>':'')+'</section>'+
    '<div class="phfk-foundation-kpis"><div class="phfk-panel"><small>MỨC ĐỘ</small><b>'+levelCount+'</b></div><div class="phfk-panel"><small>NHÓM NĂNG LỰC</small><b>'+groupCount+'</b></div><div class="phfk-panel"><small>HẠNG MỤC</small><b>'+itemCount+'</b></div></div>'+
    '<section class="phfk-panel"><h2>Thông tin phiên bản</h2><div class="phfk-vh-info-grid">'+
      '<div><small>Bộ KNL</small><b>'+esc(f.name)+'</b></div>'+
      '<div><small>Trạng thái</small><b>'+esc(statusLabel(v.status))+(v.isLocked?' · Đã khóa':'')+'</b></div>'+
      '<div><small>Trạng thái hiệu lực</small><b>'+esc(lifecycleStatusLabel(v.lifecycleStatus))+'</b></div>'+
      '<div><small>Hiệu lực từ</small><b>'+esc(fmtKnlDateTime(v.effectiveFrom))+'</b></div>'+
      '<div><small>Cập nhật lúc</small><b>'+esc(fmtKnlDateTime(v.updatedAt))+'</b></div>'+
    '</div></section>';
}
function versionHistoryHtml(){
  return frameworkDomainNav('phien-ban-lich-su')+
    '<div class="phfk-page-head"><div><small>KNL · PHIÊN BẢN</small><h1>Phiên bản &amp; lịch sử hiệu lực</h1></div></div>'+
    '<p class="phfk-batch-note">Quản lý phiên bản của Bộ KNL và xem thông tin hiệu lực.</p>'+
    vhSelectorHtml()+
    (!vhState.frameworks.length?'<div class="phfk-empty">Chưa có bộ KNL nào.</div>':
      '<div class="phfk-vh-workspace"><aside class="phfk-panel phfk-vh-list-panel"><h2>Danh sách phiên bản</h2>'+vhListHtml()+'</aside><div class="phfk-vh-detail">'+vhDetailHtml()+'</div></div>')+
    (vhState.error?'<p class="phfk-error">'+esc(vhState.error)+'</p>':'');
}
function bindVersionHistoryEvents(root){
  bindFrameworkDomainNav(root);
  var fwSelect=root.querySelector('[data-vh-framework-select]');
  if(fwSelect)fwSelect.onchange=function(){vhState.selectedFrameworkId=fwSelect.value;vhState.selectedVersionId='';vhState.detail=null;renderVersionHistoryBody(root);};
  root.querySelectorAll('[data-vh-version]').forEach(function(btn){btn.onclick=function(){loadVhDetail(root,btn.getAttribute('data-vh-version'));};});
  var effBtn=root.querySelector('[data-vh-set-effective]');
  if(effBtn)effBtn.onclick=function(){
    var v=vhState.detail.version,f=vhState.detail.framework;
    var overlay=openKnlModal(
      '<h3>Đặt thời điểm hiệu lực</h3>'+
      '<p class="phfk-modal-note">Áp dụng cho phiên bản v'+esc(v.versionNumber)+' · '+esc(f.name)+'.</p>'+
      '<label class="phfk-field"><span>Ngày hiệu lực</span><input class="phfk-input" type="date" data-vh-effective-input required></label>'+
      '<p class="phfk-error" data-vh-effective-error hidden></p>'+
      '<div class="phfk-modal-actions"><button type="button" class="phfk-btn-secondary" data-modal-cancel>Hủy</button><button type="button" class="phfk-btn-primary" data-vh-effective-confirm>Xác nhận</button></div>'
    );
    overlay.querySelector('[data-modal-cancel]').onclick=closeKnlModal;
    overlay.querySelector('[data-vh-effective-confirm]').onclick=async function(){
      var value=overlay.querySelector('[data-vh-effective-input]').value;
      var errEl=overlay.querySelector('[data-vh-effective-error]');
      if(!value){errEl.textContent='Vui lòng chọn ngày hiệu lực.';errEl.hidden=false;return;}
      try{
        await apiPost('setKnlVersionEffectivity',{versionId:v.id,effectiveFrom:value});
        closeKnlModal();
        await renderVersionHistory(root);
      }catch(e){errEl.textContent=e.message;errEl.hidden=false;}
    };
  };
}
function renderVersionHistoryBody(root){var body=root.querySelector('[data-knl-body]');if(body)body.innerHTML=versionHistoryHtml();bindVersionHistoryEvents(root);}
async function renderVersionHistoryList(root){
  var versions=vhVersionsForSelectedFramework();
  if(!versions.some(function(v){return v.id===vhState.selectedVersionId;}))vhState.selectedVersionId=(versions[0]||{}).id||'';
  if(vhState.selectedVersionId)await loadVhDetail(root,vhState.selectedVersionId);else{vhState.detail=null;renderVersionHistoryBody(root);}
}
async function loadVhDetail(root,versionId){
  vhState.selectedVersionId=versionId;
  vhState.detailLoading=true;
  renderVersionHistoryBody(root);
  try{vhState.detail=await apiPost('getKnlFrameworkVersion',{versionId:versionId});vhState.error='';}
  catch(e){vhState.detail=null;vhState.error=e.message;}
  vhState.detailLoading=false;
  renderVersionHistoryBody(root);
}
async function renderVersionHistory(root){
  var body=root.querySelector('[data-knl-body]');
  try{
    var data=await apiPost('listKnlFrameworks');
    vhState.frameworks=data.frameworks||[];
    if(!vhCurrentFramework())vhState.selectedFrameworkId=(vhState.frameworks[0]||{}).id||'';
    vhState.error='';
    await renderVersionHistoryList(root);
  }catch(e){body.innerHTML=frameworkDomainNav('phien-ban-lich-su')+noAccessSection(e.message);bindFrameworkDomainNav(root);}
}
/* ===== Cơ cấu ngạch & bậc — Admin CRUD (versioned; Active/scheduled immutable, Draft only editable) ===== */
function compensationLadderList(){return (compensationState.standards&&compensationState.standards.ladders)||[];}
function compensationSelectedLadder(){var ladders=compensationLadderList();return ladders.find(function(l){return l.id===compensationState.ladderId;})||ladders[0]||null;}
function compensationSortedVersions(ladder){return ladder?(ladder.versions||[]).slice().sort(function(a,b){return b.version_number-a.version_number;}):[];}
function compensationSelectedVersion(ladder){var versions=compensationSortedVersions(ladder);if(!versions.length)return null;var byId=versions.find(function(v){return v.id===compensationState.versionId;});if(byId)return byId;var active=versions.find(function(v){return v.status==='ACTIVE';});return active||versions[0];}
function compensationSortedGrades(version){return version?(version.grades||[]).slice().sort(function(a,b){return a.grade_number-b.grade_number;}):[];}
function compensationGradeValue(g,field){var pending=compensationState.pendingGrades[g.id];if(pending&&pending[field]!=null)return Number(pending[field]);var map={baseSalary:'base_salary',hqcv:'hqcv',professionalAllowance:'professional_allowance',managementAllowance:'management_allowance'};return Number(g[map[field]]);}
function compensationDisplayGrades(grades){return grades.map(function(g){return{id:g.id,grade_code:g.grade_code,grade_number:g.grade_number,employeeCount:g.employeeCount,base_salary:compensationGradeValue(g,'baseSalary'),hqcv:compensationGradeValue(g,'hqcv'),professional_allowance:compensationGradeValue(g,'professionalAllowance'),management_allowance:compensationGradeValue(g,'managementAllowance')};});}
function compensationKpis(grades){
  if(!grades.length)return{min:'—',max:'—',minTotal:0,maxTotal:0,totalPct:0,totalDelta:0,avgPct:0,avgDelta:0};
  var first=grades[0],last=grades[grades.length-1];
  var firstTotal=first.base_salary+first.hqcv,lastTotal=last.base_salary+last.hqcv;
  var steps=[],stepDeltas=[];
  for(var i=1;i<grades.length;i++){var pt=grades[i-1].base_salary+grades[i-1].hqcv,t=grades[i].base_salary+grades[i].hqcv;steps.push(pctChange(pt,t));stepDeltas.push(t-pt);}
  return{min:first.grade_code,max:last.grade_code,minTotal:firstTotal,maxTotal:lastTotal,
    totalPct:pctChange(firstTotal,lastTotal),totalDelta:lastTotal-firstTotal,
    avgPct:steps.length?steps.reduce(function(a,b){return a+b;},0)/steps.length:0,
    avgDelta:stepDeltas.length?stepDeltas.reduce(function(a,b){return a+b;},0)/stepDeltas.length:0};
}
function compensationContextBarHtml(ladder,version){
  return '<div class="phfk-comp-context-bar">'+
    '<div><small>NGẠCH</small><b>'+esc(ladder.code)+' · '+esc(ladder.name)+'</b></div>'+
    '<div><small>PHIÊN BẢN</small><b>v'+version.version_number+' · '+esc(version.name)+'</b></div>'+
    '<div><small>KỲ HIỆU LỰC</small><b>'+esc(version.effective_period||'—')+'</b></div>'+
    '<div><small>TRẠNG THÁI</small><span class="phfk-source-status '+(version.status==='ACTIVE'?'is-ready':(version.status==='DRAFT'?'is-review':''))+'">'+esc(lifecycleStatusLabel(version.status))+'</span></div>'+
    '</div><p class="phfk-batch-note">Đây là cấu hình cơ cấu tham chiếu theo Ngạch-Bậc, không phải bảng lương thực trả.</p>';
}
/* ladder.name lưu nguyên 1 chuỗi kiểu "CUNG ỨNG (Kho vận; Thu mua; Vận
   chuyển)" — tách phần ngoặc cuối để trình bày 2 dòng (tiêu đề chính + mô tả
   nhỏ), KHÔNG đổi/mutate ladder.name gốc, chỉ xử lý tại thời điểm render. */
function compensationLadderTitle(ladder){
  if(!ladder)return{main:'',detail:''};
  var name=String(ladder.name||''),m=name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  return m?{main:m[1],detail:m[2].split(/\s*;\s*/).join(' · ')}:{main:name,detail:''};
}
function compensationLadderSelectorHtml(ladders,selectedId){return '<div class="phfk-mini-actions phfk-comp-ladder-select">'+ladders.map(function(l){return '<button type="button" class="'+(l.id===selectedId?'is-active':'')+'" data-comp-select-ladder="'+esc(l.id)+'">'+esc(l.code)+'</button>';}).join('')+'</div>';}
function compensationVersionListHtml(ladder,selectedId){var versions=compensationSortedVersions(ladder);return '<div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Phiên bản</th><th>Ký hiệu lực</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>'+versions.map(function(v){return '<tr'+(v.id===selectedId?' class="is-selected"':'')+'><td>v'+v.version_number+' · '+esc(v.name)+'</td><td>'+esc(v.effective_period||'—')+'</td><td><span class="phfk-source-status '+(v.status==='ACTIVE'?'is-ready':(v.status==='DRAFT'?'is-review':''))+'">'+esc(lifecycleStatusLabel(v.status))+'</span></td><td><button type="button" class="phfk-btn-secondary" data-comp-view-version="'+esc(v.id)+'">Xem</button></td></tr>';}).join('')+'</tbody></table></div>';}
function compensationScenarioRows(g){
  var base=g.base_salary+g.hqcv;
  var scenarios=[
    {name:'Không phụ cấp',pcNv:false,pcQl:false,meal:false},
    {name:'Có PC nghiệp vụ',pcNv:true,pcQl:false,meal:true},
    {name:'Có PC quản lý/trách nhiệm',pcNv:false,pcQl:true,meal:true},
    {name:'Có cả PC NV + PC QL',pcNv:true,pcQl:true,meal:true}
  ];
  return scenarios.map(function(s){
    var total=base+(s.pcNv?g.professional_allowance:0)+(s.pcQl?g.management_allowance:0)+(s.meal?MEAL_SUGGESTION:0);
    return '<tr><td>'+esc(s.name)+'</td><td>'+(s.pcNv?'✓':'×')+'</td><td>'+(s.pcQl?'✓':'×')+'</td><td>'+(s.meal?'✓':'×')+'</td><td>'+money(total)+'</td></tr>';
  }).join('');
}
function compensationGradeDetailRowHtml(g,total,editable){
  var body='<div class="phfk-comp-grade-detail-grid">'+
    '<div class="phfk-comp-detail-parts"><h3>Chi tiết cấu phần — '+esc(g.grade_code)+'</h3><ol class="phfk-comp-parts-list">'+
      '<li><span>1. Lương cơ bản (LCB)</span>'+(editable?'<input type="number" min="0" step="1000" class="phfk-input" data-comp-edit="baseSalary" value="'+g.base_salary+'">':'<b>'+money(g.base_salary)+'</b>')+'</li>'+
      '<li><span>2. Hệ số chất lượng công việc (HQCV)</span>'+(editable?'<input type="number" min="0" step="1000" class="phfk-input" data-comp-edit="hqcv" value="'+g.hqcv+'">':'<b>'+money(g.hqcv)+'</b>')+'</li>'+
      '<li class="phfk-comp-parts-subtotal"><span>Tổng lương vị trí (1+2)</span><b>'+money(total)+'</b></li>'+
      '<li class="phfk-comp-parts-group">Khoản bổ sung (điều kiện — chỉ áp dụng khi được gán ở "Gán cho nhân viên")</li>'+
      '<li><span>3. Phụ cấp nghiệp vụ (chuẩn theo bậc)</span>'+(editable?'<input type="number" min="0" step="1000" class="phfk-input" data-comp-edit="professionalAllowance" value="'+g.professional_allowance+'">':'<b>'+money(g.professional_allowance)+'</b>')+'</li>'+
      '<li><span>4. Phụ cấp quản lý/trách nhiệm (chuẩn theo bậc)</span>'+(editable?'<input type="number" min="0" step="1000" class="phfk-input" data-comp-edit="managementAllowance" value="'+g.management_allowance+'">':'<b>'+money(g.management_allowance)+'</b>')+'</li>'+
      '<li class="phfk-comp-parts-group">Khoản chung</li>'+
      '<li><span>5. Tiền cơm (gợi ý chính sách — không thuộc bậc lương)</span><b>'+money(MEAL_SUGGESTION)+'</b></li>'+
    '</ol>'+(editable?'':'<p class="phfk-batch-note">Phiên bản này không phải Dự thảo; chỉ xem. Bấm "Tạo phiên bản mới từ phiên bản này" để tạo Dự thảo chỉnh sửa được.</p>')+'</div>'+
    '<div class="phfk-comp-detail-scenarios"><h3>Các kịch bản tổng thu nhập cơ cấu</h3>'+
      '<div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Kịch bản</th><th>PC NV</th><th>PC QL</th><th>Cơm</th><th>Tổng cơ cấu</th></tr></thead><tbody>'+compensationScenarioRows(g)+'</tbody></table></div>'+
      '<p class="phfk-batch-note">Kịch bản minh hoạ nhóm phổ biến. PC nghiệp vụ/PC quản lý/Cơm thực tế được bật độc lập theo từng nhân viên ở tab "Gán cho nhân viên" — đây không phải rule cố định hay payroll simulation.</p>'+
    '</div></div>';
  return '<tr class="phfk-comp-grade-detail"><td colspan="12">'+body+'</td></tr>';
}
function compensationGradeTableHtml(version,grades){
  var editable=version&&version.status==='DRAFT';
  var rows=grades.map(function(g,idx){
    var total=g.base_salary+g.hqcv,prev=idx>0?grades[idx-1]:null,prevTotal=prev?prev.base_salary+prev.hqcv:null;
    var pctBase=prev?pctChange(prev.base_salary,g.base_salary):null,pctHqcv=prev?pctChange(prev.hqcv,g.hqcv):null;
    var deltaTotal=prev?total-prevTotal:null,pctTotal=prev?pctChange(prevTotal,total):null;
    var warn=pctTotal!==null&&pctTier(pctTotal)==='is-pct-high',expanded=compensationState.expandedGradeId===g.id;
    var row='<tr class="phfk-comp-grade-row'+(warn?' is-warning':'')+(expanded?' is-expanded':'')+'" data-comp-grade-row="'+esc(g.id)+'">'+
      '<td><b>'+esc(g.grade_code)+'</b></td><td>'+money(g.base_salary)+'</td><td>'+(pctBase===null?'—':pctBadge(pctBase))+'</td>'+
      '<td>'+money(g.hqcv)+'</td><td>'+(pctHqcv===null?'—':pctBadge(pctHqcv))+'</td><td>'+money(total)+'</td>'+
      '<td>'+(deltaTotal===null?'—':money(deltaTotal))+'</td><td>'+(pctTotal===null?'—':pctBadge(pctTotal))+'</td>'+
      '<td>'+money(g.professional_allowance)+'</td><td>'+money(g.management_allowance)+'</td>'+
      '<td>'+money(MEAL_SUGGESTION)+' <small>(gợi ý)</small></td><td>'+Number(g.employeeCount||0)+'</td></tr>';
    if(expanded)row+=compensationGradeDetailRowHtml(g,total,editable);
    return row;
  }).join('');
  return '<div class="phfk-table-wrap"><table class="phfk-table phfk-comp-table"><thead><tr><th>Bậc</th><th>LCB</th><th>% tăng LCB</th><th>HQCV</th><th>% tăng HQCV</th><th>Tổng lương vị trí</th><th>Tăng so bậc trước</th><th>% tăng tổng</th><th>PC nghiệp vụ chuẩn</th><th>PC QL/trách nhiệm chuẩn</th><th>Cơm (gợi ý)</th><th>Số NV hiện tại</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
function compensationSlopeHtml(grades){
  if(grades.length<2)return'';
  var items=[];
  for(var i=1;i<grades.length;i++){var pt=grades[i-1].base_salary+grades[i-1].hqcv,t=grades[i].base_salary+grades[i].hqcv,pct=pctChange(pt,t);items.push('<div class="phfk-comp-slope-item"><b>'+esc(grades[i-1].grade_code)+' → '+esc(grades[i].grade_code)+'</b><span>'+pctBadge(pct)+'</span></div>');}
  return '<section class="phfk-panel"><div class="phfk-section-head"><div><small>ĐỘ DỐC</small><h2>Độ dốc thang lương</h2></div>'+
    '<div class="phfk-comp-slope-legend"><small>Ghi chú:</small><span class="is-pct-low">● ≤8%: Thấp</span><span class="is-pct-normal">● 8–18%: Hợp lý</span><span class="is-pct-high">● &gt;18%: Cao</span></div></div>'+
    '<div class="phfk-comp-slope">'+items.join('')+'</div></section>';
}
function compensationStructureHtml(){
  var ladders=compensationLadderList();
  if(!ladders.length)return compensationDomainNav('ngach-bac-luong',true)+noAccessSection('Chưa có ngạch nào. Foundation chưa được seed.');
  var ladder=compensationSelectedLadder(),version=compensationSelectedVersion(ladder),rawGrades=compensationSortedGrades(version),grades=compensationDisplayGrades(rawGrades),kpi=compensationKpis(grades);
  var pendingCount=Object.keys(compensationState.pendingGrades).length,isDraft=version&&version.status==='DRAFT';
  var ladderTitle=compensationLadderTitle(ladder);
  return compensationDomainNav('ngach-bac-luong',true)+
    '<div class="phfk-page-head"><div><small>KNL · CƠ CẤU NGẠCH & BẬC</small><h1>'+esc(ladderTitle.main)+'</h1>'+(ladderTitle.detail?'<p class="phfk-ladder-subtitle">'+esc(ladderTitle.detail)+'</p>':'')+(ladder?'<span class="phfk-source-status is-ready">Mã ngạch: '+esc(ladder.code)+'</span>':'')+'</div>'+
      '<div class="phfk-mini-actions">'+(version?'<button type="button" class="phfk-btn-secondary" data-comp-clone-version="'+esc(version.id)+'">Tạo phiên bản mới từ phiên bản này</button>':'')+'</div></div>'+
    compensationLadderSelectorHtml(ladders,ladder?ladder.id:'')+
    '<section class="phfk-panel"><div class="phfk-section-head"><div><small>PHIÊN BẢN</small><h2>Phiên bản & lịch sử hiệu lực</h2></div></div>'+compensationVersionListHtml(ladder,version?version.id:'')+'</section>'+
    (version?(
      compensationContextBarHtml(ladder,version)+
      '<div class="phfk-foundation-kpis">'+
        '<section class="phfk-panel"><small>BẬC THẤP NHẤT</small><b>'+esc(kpi.min)+'</b><span class="phfk-kpi-sub">'+money(kpi.minTotal)+'</span></section>'+
        '<section class="phfk-panel"><small>BẬC CAO NHẤT</small><b>'+esc(kpi.max)+'</b><span class="phfk-kpi-sub">'+money(kpi.maxTotal)+'</span></section>'+
        '<section class="phfk-panel"><small>KHOẢNG CÁCH ('+esc(kpi.min)+' → '+esc(kpi.max)+')</small><b>'+pctText(kpi.totalPct)+'</b><span class="phfk-kpi-sub">('+(kpi.totalDelta>=0?'+':'')+money(kpi.totalDelta)+')</span></section>'+
        '<section class="phfk-panel"><small>MỨC TĂNG BÌNH QUÂN/BẬC</small><b>'+pctText(kpi.avgPct)+'</b><span class="phfk-kpi-sub">(~'+(kpi.avgDelta>=0?'+':'')+money(Math.round(kpi.avgDelta))+')</span></section></div>'+
      '<section class="phfk-panel"><div class="phfk-section-head"><div><small>v'+version.version_number+' · '+esc(version.name)+'</small><h2>Bảng cơ cấu bậc lương</h2></div>'+
        '<div class="phfk-mini-actions">'+
          (isDraft?'<button type="button" class="phfk-btn-primary" data-comp-save-grades'+(pendingCount?'':' disabled')+'>Lưu thay đổi ('+pendingCount+')</button>':'')+
          (isDraft?'<button type="button" class="phfk-btn-secondary" data-comp-schedule-version="'+esc(version.id)+'">Đặt hiệu lực</button>':'')+
        '</div></div>'+
      '<p class="phfk-batch-note">Bấm vào một bậc để xem chi tiết cấu phần và kịch bản tổng thu nhập'+(isDraft?'; Dự thảo nên chỉnh được LCB/HQCV/PC chuẩn ngay tại đây':'')+'. Tổng lương vị trí = LCB + HQCV.</p>'+
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
    var values=await openKnlPromptModal({title:'Tạo phiên bản Dự thảo mới',fields:[{name:'name',label:'Tên phiên bản Dự thảo mới (bỏ trống để tự đặt tên)',value:''}]});
    if(values===null)return;
    setKnlButtonBusy(cloneBtn,true,'Đang tạo…');
    try{
      var r=await apiPost('cloneKnlCompensationVersion',{versionId:cloneBtn.getAttribute('data-comp-clone-version'),name:values.name});
      compensationState.standards=null;compensationState.versionId=r.version.id;compensationState.pendingGrades={};compensationState.expandedGradeId='';compensationState.message='Đã tạo phiên bản Dự thảo mới v'+r.version.versionNumber+'.';compensationState.error='';
      await renderCompensationStructure(root);
      knlToast('success','Đã tạo phiên bản Dự thảo mới',compensationState.message,3200,'knl-comp-clone');
    }catch(e){
      compensationState.error=e.message;renderCompensationBody(root);
      knlToast('error','Chưa thể tạo phiên bản Dự thảo',e.message||'Vui lòng thử lại.',4800,'knl-comp-clone');
    }finally{
      setKnlButtonBusy(cloneBtn,false);
    }
  };
  var saveBtn=root.querySelector('[data-comp-save-grades]');
  if(saveBtn)saveBtn.onclick=async function(){
    var ladder=compensationSelectedLadder(),version=compensationSelectedVersion(ladder),grades=compensationSortedGrades(version);
    var payload=grades.map(function(g){return{id:g.id,baseSalary:compensationGradeValue(g,'baseSalary'),hqcv:compensationGradeValue(g,'hqcv'),professionalAllowance:compensationGradeValue(g,'professionalAllowance'),managementAllowance:compensationGradeValue(g,'managementAllowance')};});
    setKnlButtonBusy(saveBtn,true,'Đang lưu…');
    try{
      await apiPost('saveKnlCompensationGrades',{versionId:version.id,grades:payload});
      compensationState.pendingGrades={};compensationState.standards=null;compensationState.message='Đã lưu thay đổi bậc lương Dự thảo.';compensationState.error='';
      await renderCompensationStructure(root);
      knlToast('success','Đã lưu thay đổi',compensationState.message,3200,'knl-comp-save');
    }catch(e){
      compensationState.error=e.message;renderCompensationBody(root);
      knlToast('error','Chưa thể lưu thay đổi',e.message||'Vui lòng thử lại.',4800,'knl-comp-save');
    }finally{
      setKnlButtonBusy(saveBtn,false);
    }
  };
  var scheduleBtn=root.querySelector('[data-comp-schedule-version]');
  if(scheduleBtn)scheduleBtn.onclick=async function(){
    var values=await openKnlPromptModal({
      title:'Đặt hiệu lực áp dụng',
      fields:[
        {name:'period',label:'Kỳ hiệu lực áp dụng',type:'month',value:'',required:true},
        {name:'effectiveFrom',label:'Ngày hiệu lực (để trống = ngày 01 của kỳ)',type:'date',value:''}
      ],
      onFieldChange:function(name,value,v,setValue){
        // Batch 1E Phase B — quyết định: tự tính lại mặc định effectiveFrom
        // theo period mỗi khi period đổi, nhưng field vẫn luôn sửa được
        // (không disable/lock), đúng yêu cầu "gợi ý, không ép".
        if(name!=='period')return;
        setValue('effectiveFrom',value?(value+'-01'):'');
      }
    });
    if(!values)return;
    var period=values.period;
    var effectiveFrom=values.effectiveFrom||(period+'-01');
    setKnlButtonBusy(scheduleBtn,true,'Đang đặt hiệu lực…');
    try{
      var r=await apiPost('scheduleKnlCompensationVersion',{versionId:scheduleBtn.getAttribute('data-comp-schedule-version'),effectivePeriod:period,effectiveFrom:effectiveFrom});
      compensationState.standards=null;compensationState.message='Đã đặt hiệu lực: '+r.scheduled.status+' từ '+r.scheduled.effectiveFrom+'.';compensationState.error='';
      await renderCompensationStructure(root);
      knlToast('success','Đã đặt hiệu lực',compensationState.message,3200,'knl-comp-schedule');
    }catch(e){
      compensationState.error=e.message;renderCompensationBody(root);
      knlToast('error','Chưa thể đặt hiệu lực',e.message||'Vui lòng thử lại.',4800,'knl-comp-schedule');
    }finally{
      setKnlButtonBusy(scheduleBtn,false);
    }
  };
}
function renderCompensationBody(root){var body=root.querySelector('[data-knl-body]');body.innerHTML=compensationStructureHtml();bindCompensationStructure(root);}
async function renderCompensationStructure(root){var body=root.querySelector('[data-knl-body]');try{if(!compensationState.standards)compensationState.standards=await apiPost('listKnlCompensationStandards');renderCompensationBody(root);}catch(e){body.innerHTML=compensationDomainNav('ngach-bac-luong',true)+noAccessSection(e.message);bindCompensationDomainNav(root);}}
/* Shared "Chọn nhân sự" picker — dùng chung giữa Hồ sơ thu nhập và Gán cho
   nhân viên (mục 4/6 batch polish). Action sau khi click khác nhau theo
   onSelect truyền vào từ nơi gọi, style/component dùng chung 100%. Filter
   Phòng ban/Chi nhánh/Chức danh tính lại option theo facet của 2 filter còn
   lại + search (không hardcode option, đúng data thật của danh sách đã được
   backend lọc theo quyền). */
var KNL_PEOPLE_FILTER_LABELS={department:'Phòng ban',branch:'Chi nhánh',title:'Chức danh'};
function knlEmployeePickerHtml(opts){
  var people=opts.people||[];
  var filterBar='<div class="phfk-people-picker-filters"><input type="search" class="phfk-input" placeholder="Tìm theo tên hoặc mã nhân sự" data-picker-search="'+opts.ns+'">'+
    Object.keys(KNL_PEOPLE_FILTER_LABELS).map(function(key){return '<select class="phfk-input" data-picker-filter="'+opts.ns+':'+key+'"><option value="">Tất cả '+KNL_PEOPLE_FILTER_LABELS[key]+'</option></select>';}).join('')+
    '</div>';
  var cards='<div class="phfk-people-grid">'+people.map(function(p){
    return '<button type="button" class="phfk-people-card" data-picker-target="'+opts.ns+'" data-code="'+esc(p.employeeCode)+'" data-search="'+esc([p.employeeCode,p.employeeName,p.department,p.branch,p.title].join(' ').toLowerCase())+'" data-department="'+esc(p.department||'')+'" data-branch="'+esc(p.branch||'')+'" data-title="'+esc(p.title||'')+'">'+
      '<b>'+esc(p.employeeName)+'</b><span>'+esc(p.employeeCode)+' · '+esc(p.title||p.department||'Nhân sự')+'</span><small>'+esc([p.department,p.branch].filter(Boolean).join(' · '))+'</small></button>';
  }).join('')+'</div>';
  return '<section class="phfk-panel phfk-people-picker">'+filterBar+
    '<p class="phfk-people-picker-count" data-picker-count="'+opts.ns+'"></p>'+
    (people.length?cards:'<p class="phfk-empty">'+esc(opts.emptyText||'Không có nhân sự phù hợp.')+'</p>')+
    '</section>';
}
function bindKnlEmployeePicker(root,ns,onSelect){
  var searchEl=root.querySelector('[data-picker-search="'+ns+'"]');if(!searchEl)return;
  var filterSelects={};Object.keys(KNL_PEOPLE_FILTER_LABELS).forEach(function(key){filterSelects[key]=root.querySelector('[data-picker-filter="'+ns+':'+key+'"]');});
  var cardEls=Array.prototype.slice.call(root.querySelectorAll('[data-picker-target="'+ns+'"]'));
  function refresh(){
    var q=String(searchEl.value||'').trim().toLowerCase();
    var current={};Object.keys(filterSelects).forEach(function(key){current[key]=filterSelects[key]?filterSelects[key].value:'';});
    function matches(el,exceptKey){
      if(q&&el.dataset.search.indexOf(q)===-1)return false;
      return Object.keys(current).every(function(k){if(k===exceptKey)return true;if(!current[k])return true;return el.dataset[k]===current[k];});
    }
    Object.keys(filterSelects).forEach(function(key){
      var sel=filterSelects[key];if(!sel)return;
      var eligible=cardEls.filter(function(el){return matches(el,key);});
      var values=Array.from(new Set(eligible.map(function(el){return el.dataset[key];}).filter(Boolean))).sort();
      if(current[key]&&values.indexOf(current[key])===-1)current[key]='';
      sel.innerHTML='<option value="">Tất cả '+KNL_PEOPLE_FILTER_LABELS[key]+'</option>'+values.map(function(v){return '<option value="'+esc(v)+'"'+(v===current[key]?' selected':'')+'>'+esc(v)+'</option>';}).join('');
      sel.value=current[key];
    });
    var count=0;
    cardEls.forEach(function(el){var visible=matches(el,null);el.hidden=!visible;if(visible)count++;});
    var countEl=root.querySelector('[data-picker-count="'+ns+'"]');if(countEl)countEl.textContent=count+' nhân sự phù hợp';
  }
  refresh();
  searchEl.oninput=refresh;
  Object.keys(filterSelects).forEach(function(key){if(filterSelects[key])filterSelects[key].onchange=refresh;});
  cardEls.forEach(function(el){el.onclick=function(){onSelect(el.getAttribute('data-code'));};});
}
function incomePickerHtml(message){var people=foundationState.incomeTargets||[];return compensationDomainNav('co-cau-thu-nhap',foundationState.incomeIsAdmin)+'<div class="phfk-page-head"><div><small>KNL · THU NHẬP THAM CHIẾU</small><h1>Chọn nhân sự</h1><p>Danh sách được lọc theo quyền Thu nhập trên backend.</p></div></div>'+(message?'<p class="phfk-warning">'+esc(message)+'</p>':'')+knlEmployeePickerHtml({ns:'income',people:people,emptyText:'Không có nhân sự nào trong phạm vi được phép xem.'});}
function bindIncomePicker(root){bindKnlEmployeePicker(root,'income',function(code){goIncomeEmployee(code);});}
async function showIncomePicker(root,message){var body=root.querySelector('[data-knl-body]');try{if(!foundationState.incomeTargetsLoaded){var result=await apiPost('listKnlIncomeTargets');foundationState.incomeTargets=result.people||[];foundationState.incomeTargetsLoaded=true;}body.innerHTML=incomePickerHtml(message);bindIncomePicker(root);bindCompensationDomainNav(root);}catch(e){body.innerHTML=noAccessSection(e.message);}}
function compensationInitials(name){var parts=String(name||'').trim().split(/\s+/);return parts.length&&parts[parts.length-1]?parts[parts.length-1][0].toUpperCase():'?';}
function pad2(n){return n<10?'0'+n:''+n;}
function formatDateVN(dateStr){var s=String(dateStr||'').trim(),m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:s;}
function formatDateTimeVN(isoStr){var s=String(isoStr||'').trim();if(!s)return '—';var d=new Date(s);if(isNaN(d.getTime()))return s;return pad2(d.getDate())+'/'+pad2(d.getMonth()+1)+'/'+d.getFullYear()+' '+pad2(d.getHours())+':'+pad2(d.getMinutes());}
function computeSeniorityLabel(hireDateStr){
  var s=String(hireDateStr||'').trim();if(!s)return '';
  var d=new Date(s);if(isNaN(d.getTime()))return '';
  var now=new Date(),months=(now.getFullYear()-d.getFullYear())*12+(now.getMonth()-d.getMonth());
  if(now.getDate()<d.getDate())months--;
  if(months<0)return '';
  var years=Math.floor(months/12),remMonths=months%12;
  if(years<=0&&remMonths<=0)return 'Dưới 1 tháng';
  var parts=[];if(years>0)parts.push(years+' năm');if(remMonths>0)parts.push(remMonths+' tháng');
  return parts.join(' ');
}
function employmentStatusLabelVN(status){var s=String(status||'').toLowerCase();if(s==='active')return 'Đang làm việc';if(s==='inactive')return 'Đã nghỉ việc';return status||'—';}
/* Nhận diện actor là batch/seed/baseline hệ thống — DÙNG CHUNG cho cả nhãn
 * actor (friendlyActorLabel) lẫn phân loại event baseline/seed (Residual 2,
 * competencyHistoryLabel/competencyHistoryHtml) để không có 2 định nghĩa
 * "là hệ thống" khác nhau trong cùng màn. Chỉ nhận diện đúng pattern thật
 * đang có trong DB (vd ACTOR_NAME='PHF KNL/Salary Baseline 08/2026 — batch
 * script' ở scripts/phf-knl-employee-competency-assignment-baseline-2026-08.js)
 * - không đoán; tên người thật hiển thị/xử lý nguyên văn, không đổi. */
function isSystemBaselineActor(name){return /batch script|baseline|foundation \d|seed/i.test(String(name||'').trim());}
/* Actor kỹ thuật/hệ thống -> nhãn thân thiện cho UI. KHÔNG sửa raw data
 * backend (changedByName gốc vẫn nguyên trong payload) - chỉ đổi cách hiển
 * thị. Tên người thật (nhân sự/admin) hiển thị nguyên tên, không đổi. */
function friendlyActorLabel(name){
  var s=String(name||'').trim();
  if(!s)return '—';
  if(isSystemBaselineActor(s))return 'Hệ thống (khởi tạo dữ liệu)';
  return s;
}
/* Tách level_content thành từng dòng riêng CHỈ khi chắc chắn là danh sách:
 * đánh số "1. 2. 3." hoặc gạch đầu dòng "- "/"• " ở ĐẦU MỖI dòng (yêu cầu
 * content có xuống dòng thật giữa các mục — đúng format thật trong DB, xem
 * sample "1. Giám sát...\n2. Giám sát..."). Dấu "-" giữa câu (vd "Từ 1 - 3
 * năm", "CCDC - cơ sở vật chất", "mục tiêu - ngân sách - hành động") không
 * có xuống dòng nên KHÔNG rơi vào nhánh tách danh sách - giữ nguyên nguyên
 * văn, không sửa nghĩa, không rewrite. Nếu không chắc (nhiều dòng nhưng
 * không phải markers nhất quán) -> vẫn tách theo dòng thật có sẵn (không
 * gộp lại thành 1 đoạn), chỉ không strip prefix vì không chắc đó là list. */
function splitStructuredContentLines(content){
  var raw=String(content||'').trim();
  if(!raw)return null;
  var lines=raw.split(/\n/).map(function(l){return l.trim();}).filter(function(l){return l.length;});
  if(lines.length>=2){
    if(lines.every(function(l){return /^\d+[.)]\s*/.test(l);}))return lines.map(function(l){return l.replace(/^\d+[.)]\s*/,'');});
    if(lines.every(function(l){return /^[-•]\s+/.test(l);}))return lines.map(function(l){return l.replace(/^[-•]\s+/,'');});
    return lines;
  }
  /* 1 dòng duy nhất: vẫn bóc prefix liệt kê Ở ĐẦU CHUỖI nếu có (leftover
   * enumeration artifact khi chỉ còn 1 yêu cầu, vd "1. Tiết kiệm được chi
   * phí..." — PHF chốt phải hiện "✓ Tiết kiệm được chi phí..." chứ không
   * còn "1."). Regex yêu cầu marker + khoảng trắng NGAY ĐẦU chuỗi nên không
   * đụng dash/số nằm giữa câu (vd "Từ 1 - 3 năm", "CCDC - cơ sở vật chất",
   * "...Tết - Trung Thu - 8/3." đều không khớp vì không bắt đầu bằng marker). */
  var single=lines[0]||raw;
  return [single.replace(/^\d+[.)]\s+/,'').replace(/^[-•]\s+/,'')];
}
/* Visual language DUY NHẤT cho mọi requirement content trong comparison
 * matrix (mục C của batch UI/UX delta): 1 ý -> 1 dòng ✓; nhiều ý -> mỗi ý 1
 * dòng ✓ riêng. Dấu ✓ vẽ bằng CSS ::before (xem assets/css/phf-knl.css
 * .phfk-comp-content-list li), không chèn ký tự ✓ vào text để giữ nguyên
 * text gốc tuyệt đối. */
function formatLevelContentHtml(content){
  var lines=splitStructuredContentLines(content);
  if(!lines)return '<span class="phfk-comp-content-empty">—</span>';
  return '<ul class="phfk-comp-content-list">'+lines.map(function(l){return '<li>'+esc(l)+'</li>';}).join('')+'</ul>';
}
function compensationIdentityCardHtml(current){
  var org=current.organizationSnapshot||{},fields=[];
  if(org.department)fields.push(['PHÒNG BAN',org.department]);
  if(org.title||org.position)fields.push(['CHỨC DANH',org.title||org.position]);
  if(org.branch)fields.push(['CHI NHÁNH',org.branch]);
  fields.push(['TRẠNG THÁI',current.employmentType==='OFFICIAL'?'Chính thức':'Thử việc']);
  return '<section class="phfk-panel phfk-comp-identity"><div class="phfk-comp-identity-avatar">'+esc(compensationInitials(current.employeeName))+'</div>'+
    '<div class="phfk-comp-identity-fields"><div><small>MÃ NHÂN VIÊN</small><b>'+esc(current.employeeCode)+'</b></div>'+
    fields.map(function(f){return '<div><small>'+f[0]+'</small><b>'+esc(f[1])+'</b></div>';}).join('')+'</div></section>';
}
/* Hồ sơ cá nhân đầy đủ ở đầu màn cá nhân — nguồn employee_profiles thật qua
 * getKnlEmployeeProfile (KHÔNG suy diễn field không có, KHÔNG lấy từ
 * organizationSnapshot của compensation vì đó là snapshot lúc gán lương, có
 * thể khác hồ sơ hiện hành). Fallback về card cũ (từ income) nếu profile
 * fetch lỗi/không có quyền, để không bao giờ để trắng khối này. */
function profileCardHtml(profile,fallbackCurrent){
  if(!profile)return fallbackCurrent?compensationIdentityCardHtml(fallbackCurrent):'';
  var avatar=profile.avatarUrl
    ?'<img class="phfk-comp-identity-avatar-img" src="'+esc(profile.avatarUrl)+'" alt="">'
    :esc(compensationInitials(profile.fullName));
  var fields=[];
  if(profile.title)fields.push(['CHỨC DANH',profile.title]);
  if(profile.department)fields.push(['PHÒNG BAN',profile.department]);
  if(profile.branch)fields.push(['CHI NHÁNH',profile.branch]);
  if(profile.hireDate)fields.push(['NGÀY VÀO CÔNG TY',formatDateVN(profile.hireDate)]);
  var seniority=computeSeniorityLabel(profile.hireDate);
  if(seniority)fields.push(['THÂM NIÊN',seniority]);
  fields.push(['TRẠNG THÁI',employmentStatusLabelVN(profile.employmentStatus)]);
  return '<section class="phfk-panel phfk-comp-identity"><div class="phfk-comp-identity-avatar'+(profile.avatarUrl?' has-image':'')+'">'+avatar+'</div>'+
    '<div class="phfk-comp-identity-fields"><div><small>HỌ VÀ TÊN</small><b>'+esc(profile.fullName||profile.employeeCode)+'</b></div>'+
    '<div><small>MÃ NHÂN VIÊN</small><b>'+esc(profile.employeeCode)+'</b></div>'+
    fields.map(function(f){return '<div><small>'+f[0]+'</small><b>'+esc(f[1])+'</b></div>';}).join('')+
    '</div></section>';
}
/* Suy nhãn thay đổi (semantic) và trước/sau từ snapshot before/after đã lưu —
   KHÔNG lookup master hiện tại để dựng lại lịch sử. */
function compensationChangeSummary(h){
  var before=h.beforeData||{},after=h.afterData||{},beforeSnap=before.structure_snapshot||{},afterSnap=after.structure_snapshot||{};
  if(h.action==='CREATE')return after.employment_type==='PROBATION'?'Bắt đầu thử việc':'Tạo cơ cấu chính thức';
  if(before.employment_type==='PROBATION'&&after.employment_type==='OFFICIAL')return'Chuyển chính thức';
  if(afterSnap.gradeCode&&beforeSnap.gradeCode&&afterSnap.gradeCode!==beforeSnap.gradeCode){
    if(beforeSnap.ladderCode!==afterSnap.ladderCode)return'Đổi ngạch';
    return Number(afterSnap.gradeNumber||0)>Number(beforeSnap.gradeNumber||0)?'Nâng bậc':'Giảm bậc';
  }
  if(before.has_professional_allowance!==after.has_professional_allowance||before.has_management_allowance!==after.has_management_allowance||before.has_meal_allowance!==after.has_meal_allowance||JSON.stringify(before.extra_allowances||[])!==JSON.stringify(after.extra_allowances||[]))return'Thay đổi phụ cấp';
  return'Cập nhật cơ cấu';
}
function compensationChangeTransition(h){
  var before=h.beforeData||{},after=h.afterData||{},beforeSnap=before.structure_snapshot||{},afterSnap=after.structure_snapshot||{};
  var afterLabel=after.employment_type==='PROBATION'?'Thử việc':(afterSnap.ladderCode||afterSnap.gradeCode?(afterSnap.ladderCode||'')+'-'+(afterSnap.gradeCode||''):'—');
  if(h.action==='CREATE')return{from:'—',to:afterLabel};
  var beforeLabel=before.employment_type==='PROBATION'?'Thử việc':(beforeSnap.ladderCode||beforeSnap.gradeCode?(beforeSnap.ladderCode||'')+'-'+(beforeSnap.gradeCode||''):'—');
  if(beforeLabel===afterLabel)return{from:'—',to:'—'};
  return{from:beforeLabel,to:afterLabel};
}
/*
 * Batch 1B FINAL REWORK — Lịch sử thay đổi cơ cấu thu nhập (màn cá nhân, mục 6
 * incomeHtml()) đổi từ "audit diff before→after" sang "cơ cấu mới đang áp dụng
 * theo từng kỳ" (user đã chốt lại nghiệp vụ). Mỗi entry chỉ đọc after_data của
 * chính nó (full-row snapshot đã lưu — xem
 * scripts/PHF_KNL_COMPETENCY_GRADE_COMPENSATION_FOUNDATION_1.50.0.sql:501-502)
 * — KHÔNG còn đọc before_data để dựng arrow, nên residual "Chưa áp dụng →
 * 910.000" lặp lại mỗi kỳ (do action=CREATE mỗi kỳ nhưng khoản không đổi) tự
 * nhiên biến mất: mỗi kỳ chỉ nói "hiện đang có gì", không nói "trước đó có gì".
 * reference_total dùng nguyên (đã tính sẵn bởi knl_save_employee_compensation(),
 * KHÔNG tự cộng công thức khác). Không có % thay đổi, không before total (đã
 * chốt bỏ ở presentation chính — mục 10).
 *
 * Event heading KHÔNG suy "Đổi ngạch/Nâng bậc/Giảm bậc" từ compensation
 * snapshot (đó là domain Bậc KNL — mục 5 competencyHistoryHtml() mới là
 * authoritative source, xem comment ở đó). Chỉ 2 heading an toàn: kỳ sớm nhất
 * trong toàn bộ history = "Thiết lập cơ cấu thu nhập ban đầu", mọi kỳ khác =
 * "Cơ cấu thu nhập áp dụng" — không kết luận lý do thay đổi nếu không có
 * evidence rõ (reason field, nếu có, hiển thị riêng).
 */
function compensationMoneyMonthly(v){return money(v)+'/tháng';}
/* Thứ tự nghiệp vụ cố định: LCB, HQCV, PC nghiệp vụ, PC quản lý, Tiền cơm, PC
 * khác, Thử việc — chỉ render component ĐANG áp dụng trong chính snapshot này
 * (has_*_allowance=true / employment_type tương ứng), không carry-forward từ
 * kỳ khác, không render khoản không áp dụng. */
function compensationSnapshotComponents(after){
  var snap=after.structure_snapshot||{},type=after.employment_type||null,rows=[];
  if(type==='OFFICIAL'){
    rows.push({label:'Lương cơ bản (LCB)',value:compensationMoneyMonthly(snap.baseSalary||0)});
    rows.push({label:'Hệ số chất lượng công việc (HQCV)',value:compensationMoneyMonthly(snap.hqcv||0)});
    if(after.has_professional_allowance)rows.push({label:'Phụ cấp nghiệp vụ',value:compensationMoneyMonthly(snap.professionalAllowance||0)});
    if(after.has_management_allowance)rows.push({label:'Phụ cấp quản lý/trách nhiệm',value:compensationMoneyMonthly(snap.managementAllowance||0)});
    if(after.has_meal_allowance)rows.push({label:'Tiền cơm',value:compensationMoneyMonthly(after.meal_allowance||0)});
    (Array.isArray(after.extra_allowances)?after.extra_allowances:[]).forEach(function(x){if(x&&x.name)rows.push({label:'Phụ cấp khác — '+x.name,value:compensationMoneyMonthly(x.amount||0)});});
  }else if(type==='PROBATION'){
    rows.push({label:'Mức lương thử việc',value:compensationMoneyMonthly(after.probation_amount||0)});
  }
  return rows;
}
/* Batch 1D — action='CORRECT_EFFECTIVE_PERIOD' là event AUTHORITATIVE ghi bởi
 * RPC knl_correct_employee_compensation_period() (server tự suy, không tin
 * client) khi Admin sửa kỳ hiệu lực sai. before_data.payroll_period = kỳ cũ
 * thật (đã lưu lúc source còn ACTIVE), h.payrollPeriod = kỳ mới thật — dùng
 * thẳng, KHÔNG suy diễn. Mọi action khác giữ nguyên logic isFirstEver hiện
 * hữu (Batch 1B rework), KHÔNG đổi. */
function buildCompensationCurrentEntry(h,isFirstEver){
  var after=h.afterData||{};
  var eventLabel;
  if(h.action==='CORRECT_EFFECTIVE_PERIOD'){
    var oldPeriod=(h.beforeData&&h.beforeData.payroll_period)||'';
    eventLabel='Điều chỉnh kỳ hiệu lực: '+(oldPeriod?dashPeriodText(oldPeriod):'—')+' → '+dashPeriodText(h.payrollPeriod);
  }else{
    eventLabel=isFirstEver?'Thiết lập cơ cấu thu nhập ban đầu':'Cơ cấu thu nhập áp dụng';
  }
  return{
    eventLabel:eventLabel,
    payrollPeriod:h.payrollPeriod,components:compensationSnapshotComponents(after),
    total:Number(after.reference_total||0),
    reason:h.reason||'',changedByName:h.changedByName||'',changedAt:h.changedAt
  };
}
/* Blocker fix (Release Gate recheck) — một assignment bị VOIDED bởi
 * knl_correct_employee_compensation_period() vẫn có history row CREATE/UPDATE
 * gốc của chính nó (ghi lúc còn ACTIVE) — nếu render thẳng, row đó hiện lại
 * y hệt một kỳ "Cơ cấu thu nhập áp dụng" bình thường dù đã bị thay thế.
 * Xác định deterministic (KHÔNG heuristic theo ngày/array-neighbor): mọi
 * before_data/after_data đều là to_jsonb(row) đầy đủ nên LUÔN mang theo cột
 * `id` (PK thật của assignment) — history row CORRECT_EFFECTIVE_PERIOD có
 * before_data.id = id của chính assignment nguồn vừa bị void (xem RPC step 5,
 * before_data=to_jsonb(v_source) chụp NGAY TRƯỚC khi update status='VOIDED').
 * Bất kỳ history row nào khác (CREATE/UPDATE) mà after_data.id trùng đúng id
 * đó chính là snapshot của assignment đã bị supersede -> suppress khỏi
 * presentation "Cơ cấu thu nhập áp dụng", KHÔNG xoá khỏi payload/history gốc
 * (audit vẫn nguyên vẹn ở server), chỉ không hiển thị lại như một kỳ current.
 * Event CORRECT_EFFECTIVE_PERIOD tự nó KHÔNG bị suppress — đó chính là bằng
 * chứng correction cần giữ hiển thị. Nếu before_data.id vắng mặt (payload cũ/
 * thiếu field) thì KHÔNG suy đoán — record liên quan giữ nguyên hiển thị. */
function supersededCompensationAssignmentIds(history){
  var ids=new Set();
  (history||[]).forEach(function(h){
    if(h.action==='CORRECT_EFFECTIVE_PERIOD'&&h.beforeData&&h.beforeData.id)ids.add(h.beforeData.id);
  });
  return ids;
}
function compensationHistoryTimelineHtml(history){
  var supersededIds=supersededCompensationAssignmentIds(history);
  var visible=(history||[]).filter(function(h){
    if(h.action==='CORRECT_EFFECTIVE_PERIOD')return true;
    var ownId=h.afterData&&h.afterData.id;
    return !(ownId&&supersededIds.has(ownId));
  });
  var periods=visible.map(function(h){return h.payrollPeriod;}).filter(Boolean);
  var minPeriod=periods.length?periods.reduce(function(a,b){return a<b?a:b;}):null;
  return visible.map(function(h){
    var entry=buildCompensationCurrentEntry(h,Boolean(minPeriod)&&h.payrollPeriod===minPeriod);
    var periodText='Áp dụng từ kỳ '+dashPeriodText(entry.payrollPeriod);
    var componentsHtml=entry.components.length
      ?entry.components.map(function(c){return '<p class="phfk-comp-history-transition">'+esc(c.label)+': <b>'+esc(c.value)+'</b></p>';}).join('')
      :'<p class="phfk-comp-history-transition">Chưa có khoản thu nhập nào được ghi nhận trong kỳ này.</p>';
    var reasonHtml=entry.reason?'<p class="phfk-comp-history-reason">Lý do: '+esc(entry.reason)+'</p>':'';
    return '<div class="phfk-comp-history-item"><div class="phfk-comp-history-dot"></div><div class="phfk-comp-history-body">'+
      '<div class="phfk-comp-history-head"><b>'+esc(dashPeriodText(entry.payrollPeriod))+' — '+esc(entry.eventLabel)+'</b></div>'+
      '<p class="phfk-comp-history-meta">'+esc(periodText)+'</p>'+
      componentsHtml+
      '<p class="phfk-comp-history-transition"><b>Tổng thu nhập: '+esc(money(entry.total)+'/tháng')+'</b></p>'+
      reasonHtml+
      '<p class="phfk-comp-history-actor">Người thực hiện: '+esc(friendlyActorLabel(entry.changedByName))+' · '+esc(formatDateTimeVN(entry.changedAt))+'</p>'+
      '</div></div>';
  }).join('');
}
/* "Thu nhập tham chiếu Bậc lương kế tiếp" — PREVIEW thuần, đọc đúng
 * getKnlEmployeeNextCompensationGrade (hệ Compensation, KHÔNG liên quan
 * competency B1-B5). Whitelist cho PC nghiệp vụ/PC quản lý do BACKEND đã áp
 * (preview.isProfessionalAllowance/isManagementAllowance carry-forward từ
 * chính assignment hiện tại) — frontend chỉ render đúng cờ đã nhận.
 * Tiền cơm KHÔNG có trong preview backend vì knl_compensation_grades không
 * có cột meal_allowance — đây là khoản CỐ ĐỊNH gán trực tiếp trên assignment
 * (has_meal_allowance/meal_allowance), không đổi theo bậc lương. Vì vậy
 * frontend tự carry-forward ĐÚNG giá trị hiện tại (currentIncome.mealAllowance)
 * sang preview khi currentIncome.isMealAllowance=true — cùng nguyên tắc
 * whitelist "đang hưởng gì thì giữ đó", KHÔNG phải bug thiếu dữ liệu backend,
 * KHÔNG cần sửa schema/RPC (trace 2026-08-12, PHF mục 6). */
function compensationNextGradeHtml(){
  var n=foundationState.nextCompensationGrade;
  if(n===undefined)return '<section class="phfk-panel phfk-comp-next-grade"><div class="phfk-loading">Đang tải…</div></section>';
  if(!n||!n.hasCurrentGrade)return '';
  var head='<div class="phfk-section-head"><h2>2. Thu nhập tham chiếu Bậc lương kế tiếp</h2></div>';
  if(n.isMaxGrade){
    return '<section class="phfk-panel phfk-comp-next-grade">'+head+'<p class="phfk-batch-note">Bạn đang ở bậc lương cao nhất của ngạch hiện tại.</p></section>';
  }
  var p=n.preview;
  if(!p||!n.nextGrade)return '';
  var nextLabel=n.nextGrade.code,curLabel=(n.currentGrade&&n.currentGrade.code)||'—';
  var currentIncome=foundationState.income&&foundationState.income.current;
  var hasMeal=!!(currentIncome&&currentIncome.isMealAllowance===true);
  var mealAmount=hasMeal?Number(currentIncome.mealAllowance||0):0;
  var totalPosition=p.baseSalary+p.hqcv;
  var totalReference=totalPosition+(p.isProfessionalAllowance?p.professionalAllowance:0)+(p.isManagementAllowance?p.managementAllowance:0)+mealAmount;
  /* Flow "Tổng hiện tại -> Tổng tham chiếu -> Mức tăng" — currentTotal LUÔN
   * lấy từ current.totalReferenceIncome thật (foundationState.income, đã
   * fetch sẵn cho card thu nhập hiện tại, đã bao gồm Tiền cơm), KHÔNG tự
   * cộng lại từ preview. Guard currentTotal null/0 trước khi chia %. */
  var currentTotal=currentIncome?Number(currentIncome.totalReferenceIncome||0):null;
  var flow='';
  if(currentTotal!=null){
    var increaseAmount=totalReference-currentTotal;
    var increasePercent=currentTotal>0?(increaseAmount/currentTotal*100):null;
    var sign=increaseAmount>0?'+':(increaseAmount<0?'−':'');
    var pctText=increasePercent==null?'':(' · '+sign+Math.abs(increasePercent).toFixed(2).replace('.',',')+'%');
    flow='<div class="phfk-comp-next-flow">'+
      '<div class="phfk-comp-next-flow-item is-current"><small>Tổng hiện tại</small><b>'+money(currentTotal)+'</b></div>'+
      '<div class="phfk-comp-next-flow-item is-reference"><small>Tổng tham chiếu</small><b>'+money(totalReference)+'</b></div>'+
      '<div class="phfk-comp-next-flow-item is-delta"><small>Mức tăng tham chiếu</small><b>'+sign+money(Math.abs(increaseAmount))+'<span>'+esc(pctText)+'</span></b></div>'+
      '</div>';
  }
  var chip='<span class="phfk-comp-block-tag is-next">BẬC TIẾP THEO: '+esc(nextLabel)+'</span>';
  var summary='<div class="phfk-income-summary"><div><small>NGẠCH</small><b>'+esc((n.currentGrade&&(n.currentGrade.ladderName||n.currentGrade.ladderCode))||'—')+'</b></div><div class="phfk-comp-summary-highlight is-next"><small>BẬC KẾ TIẾP</small><b>'+esc(nextLabel)+'</b></div><div><small>BẬC HIỆN TẠI</small><b>'+esc(curLabel)+'</b></div></div>';
  var rows='<tr><td>1. Lương cơ bản (LCB)</td><td>Theo ngạch-bậc kế tiếp ('+esc(nextLabel)+')</td><td>'+money(p.baseSalary)+'</td></tr>'+
    '<tr><td>2. Hệ số chất lượng công việc (HQCV)</td><td>Theo ngạch-bậc kế tiếp ('+esc(nextLabel)+')</td><td>'+money(p.hqcv)+'</td></tr>'+
    '<tr class="phfk-comp-parts-subtotal"><td colspan="2">Tổng lương vị trí (1+2)</td><td><b>'+money(totalPosition)+'</b></td></tr>'+
    (p.isProfessionalAllowance?'<tr><td>3. Phụ cấp nghiệp vụ</td><td>Theo ngạch-bậc kế tiếp ('+esc(nextLabel)+')</td><td>'+money(p.professionalAllowance)+'</td></tr>':'')+
    (p.isManagementAllowance?'<tr><td>4. Phụ cấp quản lý/trách nhiệm</td><td>Theo ngạch-bậc kế tiếp ('+esc(nextLabel)+')</td><td>'+money(p.managementAllowance)+'</td></tr>':'')+
    (hasMeal?'<tr><td>5. Tiền cơm</td><td>Giữ nguyên mức đang hưởng (không đổi theo bậc lương)</td><td>'+money(mealAmount)+'</td></tr>':'')+
    '<tr class="phfk-comp-next-total"><td colspan="2"><b>Tổng thu nhập tham chiếu (Bậc '+esc(nextLabel)+')</b></td><td><b>'+money(totalReference)+'</b></td></tr>';
  return '<section class="phfk-panel phfk-comp-next-grade"><div class="phfk-section-head"><h2>2. Thu nhập tham chiếu Bậc lương kế tiếp</h2>'+chip+'</div>'+flow+summary+
    '<div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Khoản mục</th><th>Cách xác định</th><th>Mức tiền (VND)</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '</section>';
}
/* "Nguyên tắc điều chỉnh thu nhập" — nội dung TĨNH áp dụng cho TOÀN BỘ nhân
 * sự PHF (không riêng employee đang xem), wording giữ NGUYÊN VĂN theo PHF đã
 * chốt (không tự diễn giải "đủ điều kiện sẽ được tăng lương"). Không
 * state/persistence/workflow riêng — collapsed mặc định (details không có
 * open). Đặt giữa khu Thu nhập tham chiếu và khu KNL đang áp dụng. */
function incomeAdjustmentPolicyHtml(){
  return '<section class="phfk-panel"><details class="phfk-income-policy"><summary><span class="phfk-income-policy-title">Nguyên tắc điều chỉnh thu nhập</span><span><span class="phfk-target-toggle-collapsed">+ Xem nguyên tắc</span><span class="phfk-target-toggle-expanded">− Thu gọn</span></span></summary>'+
    '<div class="phfk-income-policy-body">'+
      '<div class="phfk-income-policy-col"><h3>Thời gian xét điều chỉnh</h3>'+
        '<p>Công ty xem xét thu nhập định kỳ 01 lần/năm, hoặc sớm hơn khi có yêu cầu hay kết quả vượt trội.</p>'+
        '<p>Đây là thời điểm xem xét, không đồng nghĩa nhân sự mặc nhiên được tăng lương sau một năm làm việc.</p>'+
      '</div>'+
      '<div class="phfk-income-policy-col"><h3>Thu nhập được xem xét điều chỉnh tăng khi nhân sự:</h3>'+
        '<ul>'+
        '<li>Phát triển đầy đủ tiêu chuẩn của vị trí, phù hợp với khung năng lực cao hơn.</li>'+
        '<li>Hoàn thành tốt hoặc vượt mục tiêu được giao.</li>'+
        '<li>Sẵn sàng đảm nhận trách nhiệm ở mức cao hơn.</li>'+
        '</ul>'+
      '</div>'+
    '</div>'+
  '</details></section>';
}
function incomeHtml(){
  var i=foundationState.income,current=i&&i.current,nav=compensationDomainNav('co-cau-thu-nhap',foundationState.incomeIsAdmin),change=foundationState.incomeCanSelect?'<button type="button" class="phfk-btn-secondary" data-knl-change-income>Chọn nhân sự khác</button>':'';
  if(!current){
    // KNL-09B: phân biệt "đang tải" (chưa có kết quả getKnlEmployeeIncome)
    // với "đã tải xong nhưng thật sự không có cơ cấu" — tránh flash sai
    // "Chưa có cơ cấu thu nhập" trong lúc income vẫn đang chạy song song
    // với capabilities/profile (renderIncomeRoute). Header dùng tên đã biết
    // (profile nếu có, không thì mã nhân sự từ route) để hiện ngay, không
    // chờ income.
    if(foundationState.incomeLoading){
      var loadingQueryCode=String(new URL(location.href).searchParams.get('employee_code')||'').trim().toUpperCase();
      var loadingName=(foundationState.profile&&foundationState.profile.fullName)||loadingQueryCode;
      return nav+'<div class="phfk-page-head"><div><small>KNL · CÁ NHÂN</small><h1>'+esc(loadingName||'Bậc & Cơ cấu thu nhập')+'</h1><p></p></div>'+change+'</div>'+profileCardHtml(foundationState.profile,null)+'<section class="phfk-panel"><div class="phfk-loading">Đang tải dữ liệu thu nhập…</div></section>';
    }
    return nav+'<div class="phfk-page-head"><div><small>KNL · CÁ NHÂN</small><h1>Bậc & Cơ cấu thu nhập</h1><p>'+esc(i&&i.employeeCode||'')+'</p></div>'+change+'</div>'+noAccessSection('Chưa có cơ cấu thu nhập tham chiếu đang áp dụng.');
  }
  var isOfficial=current.employmentType==='OFFICIAL',totalPosition=current.baseSalary+current.hqcv;
  var p=foundationState.profile;
  var head='<div class="phfk-page-head"><div><small>KNL · HỒ SƠ CÁ NHÂN</small><h1>'+esc((p&&p.fullName)||current.employeeName||current.employeeCode)+' · '+esc(current.employeeCode)+'</h1><p>Hồ sơ cá nhân, Bậc & Cơ cấu thu nhập và Khung năng lực đang áp dụng</p></div><div class="phfk-income-head-actions"><span class="phfk-source-status is-ready">Đang áp dụng</span>'+change+'</div></div>';
  var identity=profileCardHtml(p,current);
  var gradeRef=esc((current.ladderCode||'')+'-'+(current.gradeCode||''));
  var cardHead='<div class="phfk-section-head"><h2>1. Bậc & Cơ cấu thu nhập hiện tại</h2><span class="phfk-source-status is-ready">Đang áp dụng</span>'+(foundationState.incomeIsAdmin?'<button type="button" class="phfk-btn-secondary" data-knl-correct-period>Điều chỉnh kỳ hiệu lực</button>':'')+'</div>';
  var card;
  if(!isOfficial){
    card='<section class="phfk-panel phfk-income-card">'+cardHead+'<div class="phfk-income-summary"><div><small>LOẠI</small><b>Thử việc</b></div><div><small>KỲ LƯƠNG ÁP DỤNG</small><b>'+esc(current.payrollPeriod)+'</b></div><div><small>MỨC LƯƠNG THỬ VIỆC</small><b>'+money(current.probationAmount)+'</b></div></div><p class="phfk-batch-note">Nhân sự thử việc chưa gán Ngạch/Bậc/PC; không dựng cơ cấu chính thức giả định.</p></section>';
  }else{
    card='<section class="phfk-panel phfk-income-card">'+cardHead+'<div class="phfk-income-summary"><div><small>NGẠCH</small><b>'+esc(current.ladderName||current.ladderCode||'—')+'</b></div><div class="phfk-comp-summary-highlight"><small>BẬC</small><b>'+esc(current.gradeCode||'—')+'</b></div><div><small>VERSION</small><b>v'+esc(current.versionNumber||'—')+'</b></div><div><small>KỲ LƯƠNG ÁP DỤNG</small><b>'+esc(current.payrollPeriod)+'</b></div></div>'+
      '<div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Khoản mục</th><th>Cách xác định</th><th>Mức tiền (VND)</th><th>Ghi chú</th></tr></thead><tbody>'+
      '<tr><td>1. Lương cơ bản (LCB)</td><td>Theo ngạch-bậc ('+gradeRef+')</td><td>'+money(current.baseSalary)+'</td><td>Cấu hình hệ thống</td></tr>'+
      '<tr><td>2. Hệ số chất lượng công việc (HQCV)</td><td>Theo ngạch-bậc ('+gradeRef+')</td><td>'+money(current.hqcv)+'</td><td>Cấu hình hệ thống</td></tr>'+
      '<tr class="phfk-comp-parts-subtotal"><td colspan="2">Tổng lương vị trí (1+2)</td><td><b>'+money(totalPosition)+'</b></td><td></td></tr>'+
      (current.isProfessionalAllowance?'<tr><td>3. Phụ cấp nghiệp vụ</td><td>Theo ngạch-bậc ('+gradeRef+', chuẩn '+money(current.standardProfessionalAllowance)+')</td><td>'+money(current.professionalAllowance)+'</td><td></td></tr>':'')+
      (current.isManagementAllowance?'<tr><td>4. Phụ cấp quản lý/trách nhiệm</td><td>Theo ngạch-bậc ('+gradeRef+', chuẩn '+money(current.standardManagementAllowance)+')</td><td>'+money(current.managementAllowance)+'</td><td></td></tr>':'')+
      (current.isMealAllowance?'<tr><td>5. Tiền cơm</td><td>Theo cấu hình gán (gợi ý '+money(MEAL_SUGGESTION)+')</td><td>'+money(current.mealAllowance)+'</td><td></td></tr>':'')+
      ((current.extraAllowances||[]).length?'<tr><td>6. PC khác</td><td>Theo cấu hình gán (tối đa 3 khoản)</td><td>'+current.extraAllowances.map(function(x){return esc(x.name)+': '+money(x.amount);}).join('<br>')+'</td><td></td></tr>':'')+
      '<tr class="phfk-comp-final-total"><td colspan="2"><b>Tổng thu nhập hiện tại</b></td><td><b>'+money(current.totalReferenceIncome)+'</b></td><td></td></tr>'+
      '</tbody></table></div><p class="phfk-batch-note">Đây là cơ cấu thu nhập tham chiếu theo Ngạch-Bậc và chính sách hiện hành. Không phải bảng lương và không bao gồm OT, thưởng, khấu trừ hay các khoản payroll thực tế.</p></section>';
  }
  var history=(i.history||[]).length
    ?'<section class="phfk-panel phfk-history-panel"><div class="phfk-section-head"><h2>6. Lịch sử thay đổi cơ cấu thu nhập</h2></div><div class="phfk-comp-history-timeline">'+compensationHistoryTimelineHtml(i.history)+'</div></section>'
    :'<section class="phfk-panel"><div class="phfk-section-head"><h2>6. Lịch sử thay đổi cơ cấu thu nhập</h2></div>'+noAccessSection('Chưa có lịch sử thay đổi cơ cấu thu nhập.')+'</section>';
  var historyGrid='<div class="phfk-history-grid">'+competencyHistoryHtml()+history+'</div>';
  return nav+head+identity+card+compensationNextGradeHtml()+incomeAdjustmentPolicyHtml()+competencyStandardHtml()+historyGrid;
}
/* Khối "KNL đang áp dụng" — gắn vào màn cá nhân hiện có (Bậc & Cơ cấu thu
 * nhập), KHÔNG tạo route riêng (đúng chỉ đạo: ưu tiên gắn vào self-view hiện
 * hành). Toàn bộ business logic (current/next grade, isMaxGrade) do server
 * resolve qua getKnlEmployeeCompetencyStandard; frontend chỉ render. */
function competencyStatusLabel(status){return status==='CONFIRMED'?'Chính thức':'Tạm áp dụng';}
/* Comparison matrix ngang (thay 2 block dọc cũ) — join current/next/further
 * theo ĐÚNG item.id thật (ổn định, cùng 1 item xuyên suốt các bậc trong
 * cùng version), KHÔNG join theo tên. Giữ đúng thứ tự group/item xuất hiện
 * đầu tiên trong dữ liệu thật (không tự sắp xếp lại theo alphabet). */
function buildCompetencyMatrixGroups(columns){
  var groupOrder=[],groupById={};
  columns.forEach(function(col){
    if(!col.standard||!col.standard.groups)return;
    col.standard.groups.forEach(function(g){
      if(!groupById[g.id]){groupById[g.id]={id:g.id,name:g.name,itemOrder:[],itemById:{}};groupOrder.push(g.id);}
      var bucket=groupById[g.id];
      g.items.forEach(function(it){
        if(!bucket.itemById[it.id]){bucket.itemById[it.id]={id:it.id,name:it.name,cells:{}};bucket.itemOrder.push(it.id);}
        bucket.itemById[it.id].cells[col.key]=it;
      });
    });
  });
  return groupOrder.map(function(gid){
    var g=groupById[gid];
    return {id:g.id,name:g.name,items:g.itemOrder.map(function(iid){return g.itemById[iid];})};
  });
}
function competencyMatrixHtml(columns){
  var groups=buildCompetencyMatrixGroups(columns);
  if(!groups.length)return '<p class="phfk-empty">Chưa có tiêu chuẩn chi tiết cho các bậc này.</p>';
  /* Header: "Bậc X · QUAN HỆ" gộp 1 khối, phân biệt Hiện tại/Kế tiếp/Bậc xa
   * hơn bằng top-accent 2-3px + màu chữ/badge viền (KHÔNG nền tô) trên
   * header — không bịa text "Đạt ✓" nào (chưa có canonical assessment, xem
   * wording safeguard ở buildCompetencyTargetDiff). Body cell luôn TRẮNG,
   * không tint theo cột (điều chỉnh PHF chốt 2026-08-12 — tránh cảm giác
   * spreadsheet, màu chỉ chạm header/badge). */
  var head='<tr><th class="phfk-comp-matrix-label-col">Nhóm / Năng lực</th>'+columns.map(function(col){
    return '<th class="phfk-comp-matrix-col '+col.accentClass+'"><span class="phfk-comp-col-grade">'+esc(col.label)+'</span> <span class="phfk-comp-block-tag '+col.accentClass+'">'+esc(col.tag)+'</span></th>';
  }).join('')+'</tr>';
  var body=groups.map(function(g){
    return '<tr class="phfk-comp-matrix-group-row"><td colspan="'+(columns.length+1)+'">'+esc(g.name)+'</td></tr>'+
      g.items.map(function(it){
        return '<tr><td data-label="Năng lực">'+esc(it.name)+'</td>'+columns.map(function(col){
          var cellLabel=col.tag+(col.label?' — '+col.label:'');
          var cell=it.cells[col.key];
          if(!cell)return '<td class="phfk-comp-cell-neutral" data-label="'+esc(cellLabel)+'">Không áp dụng ở bậc này</td>';
          return '<td class="phfk-comp-content-cell" data-label="'+esc(cellLabel)+'">'+formatLevelContentHtml(cell.content)+'</td>';
        }).join('')+'</tr>';
      }).join('');
  }).join('');
  return '<div class="phfk-table-wrap phfk-comp-matrix-wrap"><table class="phfk-table phfk-comp-matrix"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>';
}
/* "Mục tiêu hướng tới bậc kế tiếp" — SO SÁNH TIÊU CHUẨN currentStandard vs
 * nextStandard theo ĐÚNG item.id thật (cùng pattern buildCompetencyMatrixGroups),
 * hoàn toàn client-side, KHÔNG gọi API mới. Đây là so tiêu chuẩn văn bản
 * (requiredLevelNumber/content), TUYỆT ĐỐI không phải kết luận nhân viên đã
 * "đạt"/"chưa đạt" — chưa có canonical assessment (xem Implementation Gate
 * đã duyệt). 4 nhánh: raise (next>current) / hold (next=current) / new (item
 * chỉ có ở next) / changed (next<current hoặc bất thường, trung tính, không
 * diễn giải "giảm chuẩn"). Item chỉ có ở current (không có ở next) không
 * thuộc mục tiêu bậc kế tiếp nên bị loại khỏi diff này. */
function buildCompetencyTargetDiff(c){
  var next=c.nextStandard;
  if(!next||!next.groups)return null;
  var cur=c.currentStandard;
  var groupOrder=[],groupById={};
  function ensureGroup(g){
    if(!groupById[g.id]){groupById[g.id]={id:g.id,name:g.name,itemOrder:[],itemById:{}};groupOrder.push(g.id);}
    return groupById[g.id];
  }
  (cur&&cur.groups||[]).forEach(function(g){
    var bucket=ensureGroup(g);
    g.items.forEach(function(it){
      if(!bucket.itemById[it.id]){bucket.itemById[it.id]={curItem:it,nextItem:null};bucket.itemOrder.push(it.id);}
    });
  });
  next.groups.forEach(function(g){
    var bucket=ensureGroup(g);
    g.items.forEach(function(it){
      if(!bucket.itemById[it.id]){bucket.itemById[it.id]={curItem:null,nextItem:null};bucket.itemOrder.push(it.id);}
      bucket.itemById[it.id].nextItem=it;
    });
  });
  var counts={raise:0,hold:0,new:0,changed:0};
  var groups=groupOrder.map(function(gid){
    var g=groupById[gid];
    var items=g.itemOrder.map(function(iid){
      var e=g.itemById[iid],curIt=e.curItem,nextIt=e.nextItem;
      if(!nextIt)return null;
      var nextLevel=Number(nextIt.requiredLevelNumber||0);
      var kind,curLevel=null,curLabel=null;
      if(!curIt)kind='new';
      else{
        curLevel=Number(curIt.requiredLevelNumber||0);curLabel=curIt.requiredColumnLabel||('Mức '+curLevel);
        if(nextLevel>curLevel)kind='raise';
        else if(nextLevel===curLevel)kind='hold';
        else kind='changed';
      }
      counts[kind]++;
      return {id:iid,name:nextIt.name,content:nextIt.content,kind:kind,curLevel:curLevel,curLabel:curLabel,nextLevel:nextLevel,nextLabel:nextIt.requiredColumnLabel||('Mức '+nextLevel)};
    }).filter(Boolean);
    return items.length?{id:g.id,name:g.name,items:items}:null;
  }).filter(Boolean);
  var total=counts.raise+counts.hold+counts.new+counts.changed;
  return {groups:groups,counts:counts,total:total};
}
var COMPETENCY_TARGET_KIND_LABEL={raise:'Cần nâng chuẩn',hold:'Duy trì chuẩn',new:'Yêu cầu mới',changed:'Chuẩn thay đổi'};
function competencyTargetItemTransition(it){
  if(it.kind==='new')return esc(COMPETENCY_TARGET_KIND_LABEL.new)+' ở '+esc(it.nextLabel);
  if(it.kind==='hold')return esc(COMPETENCY_TARGET_KIND_LABEL.hold)+' · '+esc(it.curLabel);
  return esc(COMPETENCY_TARGET_KIND_LABEL[it.kind])+' · '+esc(it.curLabel)+' → '+esc(it.nextLabel);
}
function competencyTargetItemRow(it){
  return '<div class="phfk-target-item is-'+it.kind+'">'+
    '<div class="phfk-target-item-head"><span class="phfk-target-tag is-'+it.kind+'">'+esc(COMPETENCY_TARGET_KIND_LABEL[it.kind])+'</span>'+
    '<b>'+esc(it.name)+'</b></div>'+
    '<p class="phfk-target-item-transition">'+competencyTargetItemTransition(it)+'</p>'+
    formatLevelContentHtml(it.content)+
    '</div>';
}
function competencyTargetHtml(c){
  if(c.isMaxGrade||!c.nextGrade){
    return '<section class="phfk-panel phfk-competency-target"><div class="phfk-section-head"><h2>4. Mục tiêu hướng tới bậc kế tiếp</h2></div>'+
      '<p class="phfk-batch-note">Bạn đang ở bậc cao nhất của Khung năng lực hiện tại.</p></section>';
  }
  var diff=buildCompetencyTargetDiff(c);
  var nextLabel=c.nextGrade.label||c.nextGrade.code,curLabel=(c.currentGrade&&(c.currentGrade.label||c.currentGrade.code))||'';
  if(!diff||!diff.groups.length){
    return '<section class="phfk-panel phfk-competency-target"><div class="phfk-section-head"><h2>4. Mục tiêu hướng tới '+esc(nextLabel)+'</h2></div>'+
      '<p class="phfk-batch-note">Chưa có tiêu chuẩn chi tiết để so sánh cho bậc này.</p></section>';
  }
  var counts=diff.counts;
  var summaryParts=[];
  if(counts.raise)summaryParts.push(counts.raise+' cần nâng chuẩn');
  if(counts.new)summaryParts.push(counts.new+' yêu cầu mới');
  if(counts.changed)summaryParts.push(counts.changed+' chuẩn thay đổi');
  if(counts.hold)summaryParts.push(counts.hold+' duy trì chuẩn');
  var changedTotal=counts.raise+counts.new+counts.changed;
  var summary='<p class="phfk-target-summary">'+changedTotal+'/'+diff.total+' năng lực có tiêu chuẩn thay đổi khi chuyển từ '+esc(curLabel)+' lên '+esc(nextLabel)+'</p>'+
    (summaryParts.length?'<p class="phfk-target-summary-breakdown">'+esc(summaryParts.join(' · '))+'</p>':'');
  var note='<p class="phfk-batch-note phfk-target-note">Đây là so sánh <b>tiêu chuẩn '+esc(curLabel)+' → '+esc(nextLabel)+'</b>, không phải đánh giá năng lực thực tế của bạn.</p>';
  var body=diff.groups.map(function(g){
    var main=g.items.filter(function(it){return it.kind!=='hold';});
    var hold=g.items.filter(function(it){return it.kind==='hold';});
    var mainHtml=main.map(competencyTargetItemRow).join('');
    var holdHtml=hold.length?'<details class="phfk-target-hold"><summary>Duy trì chuẩn ('+hold.length+')</summary>'+hold.map(competencyTargetItemRow).join('')+'</details>':'';
    if(!mainHtml&&!holdHtml)return '';
    return '<div class="phfk-target-group"><h3 class="phfk-target-group-name">'+esc(g.name)+'</h3>'+(mainHtml||'<p class="phfk-empty">Không có yêu cầu tăng chuẩn trong nhóm này.</p>')+holdHtml+'</div>';
  }).join('');
  /* Collapse toàn block bằng <details> thuần HTML (không JS/API riêng) —
   * <summary> luôn hiển thị (title/note/summary đã nằm NGOÀI details, phía
   * trên), mặc định collapsed (không có thuộc tính open). Business logic
   * structural diff giữ nguyên 100%, chỉ đổi UX hiển thị. */
  return '<section class="phfk-panel phfk-competency-target"><div class="phfk-section-head"><h2>4. Mục tiêu hướng tới '+esc(nextLabel)+'</h2></div>'+
    note+summary+
    '<details class="phfk-target-detail-toggle"><summary><span class="phfk-target-toggle-collapsed">+ Xem chi tiết</span><span class="phfk-target-toggle-expanded">− Thu gọn</span></summary>'+body+'</details>'+
    '</section>';
}
/* Dựng "chuỗi bậc" đầy đủ 1 lần khi load nhân sự: [current, next, ...further].
 * current/next đã có standard đầy đủ sẵn (từ getKnlEmployeeCompetencyStandard);
 * further chỉ có code/number/label, standard=null cho tới khi thật sự cần
 * (lazy-load khi trượt cửa sổ tới đó) — KHÔNG fetch trước toàn bộ để tránh
 * query thừa cho các bậc user có thể không bao giờ xem. */
/* Chuỗi bậc = TOÀN BỘ allGrades thật của version (cả trước lẫn sau current) —
 * standard chỉ có sẵn cho current/next (đã fetch cùng lúc); các bậc còn lại
 * standard=null, lazy-load khi user trượt cửa sổ tới đó qua đúng
 * getKnlEmployeeCompetencyGradeStandard (tự resolve version từ assignment,
 * không tin gradeCode/version từ đâu khác). Không invent bậc ngoài allGrades. */
function buildCompetencyGradeSequence(c){
  return (c.allGrades||[]).map(function(g){
    var node={code:g.code,number:g.number,label:g.label,standard:null};
    if(g.code===c.currentGrade.code){node.standard=c.currentStandard;node.isRealCurrent=true;}
    else if(c.nextGrade&&g.code===c.nextGrade.code){node.standard=c.nextStandard;node.isRealNext=true;}
    return node;
  });
}
/* Nhãn theo QUAN HỆ THẬT với current/next của nhân sự (không phụ thuộc vị
 * trí cửa sổ đang xem) — đúng 4 trạng thái đã chốt: Hiện tại / Kế tiếp /
 * Bậc trước (mọi bậc nhỏ hơn current) / Bậc tiếp theo (mọi bậc lớn hơn next,
 * hoặc lớn hơn current nếu không có next vì đang ở bậc cao nhất). */
function competencyGradeTag(node,c){
  if(node.code===c.currentGrade.code)return{tag:'Hiện tại',accentClass:'is-current'};
  if(c.nextGrade&&node.code===c.nextGrade.code)return{tag:'Kế tiếp',accentClass:'is-next'};
  if(Number(node.number)<Number(c.currentGrade.number))return{tag:'Bậc trước',accentClass:'is-previous'};
  return{tag:'Bậc tiếp theo',accentClass:'is-further'};
}
function competencyStandardHtml(){
  var c=foundationState.competency;
  if(c===undefined)return '<section class="phfk-panel phfk-competency-panel"><div class="phfk-loading">Đang tải…</div></section>';
  if(!c||!c.hasAssignment){
    return '<section class="phfk-panel phfk-competency-panel"><div class="phfk-section-head"><h2>3. KNL đang áp dụng</h2></div>'+noAccessSection('Chưa được thiết lập Khung năng lực.')+'</section>';
  }
  var a=c.assignment||{};
  var head='<div class="phfk-section-head"><h2>3. KNL đang áp dụng</h2><span class="phfk-source-status '+(a.status==='CONFIRMED'?'is-ready':'is-review')+'">'+esc(competencyStatusLabel(a.status))+'</span></div>';
  var summary='<div class="phfk-income-summary"><div><small>KHUNG NĂNG LỰC</small><b>'+esc((c.framework&&c.framework.name)||'—')+'</b></div><div><small>BẬC HIỆN TẠI</small><b>'+esc((c.currentGrade&&c.currentGrade.label)||(c.currentGrade&&c.currentGrade.code)||'—')+'</b></div><div><small>HIỆU LỰC TỪ</small><b>'+esc(formatDateVN(a.effectiveFrom))+'</b></div></div>';

  var target=competencyTargetHtml(c);

  var seq=foundationState.competencyGradeSequence||[];
  if(seq.length<2){
    return '<section class="phfk-panel phfk-competency-panel">'+head+summary+'<p class="phfk-batch-note">Khung năng lực hiện chỉ có 1 bậc, không có bậc liền kề để so sánh.</p></section>'+target;
  }
  var w=foundationState.competencyWindowStart||0;
  var left=seq[w],right=seq[w+1];
  var leftTag=competencyGradeTag(left,c),rightTag=competencyGradeTag(right,c);
  var columns=[
    {key:'left',tag:leftTag.tag,accentClass:leftTag.accentClass,label:left.label||left.code,standard:left.standard},
    {key:'right',tag:rightTag.tag,accentClass:rightTag.accentClass,label:right.label||right.code,standard:right.standard}
  ];

  var backBtn=w>0
    ?'<button type="button" class="phfk-btn-secondary" data-knl-comp-nav="back" data-knl-comp-nav-grade="'+esc(seq[w-1].code)+'">+ Xem '+esc(seq[w-1].label||seq[w-1].code)+'</button>'
    :'<span></span>';
  var moreBtn=(w+2<seq.length)
    ?'<button type="button" class="phfk-btn-secondary" data-knl-comp-nav="forward" data-knl-comp-nav-grade="'+esc(seq[w+2].code)+'">+ Xem '+esc(seq[w+2].label||seq[w+2].code)+'</button>'
    :'<span></span>';

  return '<section class="phfk-panel phfk-competency-panel">'+head+summary+
    '<div class="phfk-comp-matrix-toolbar">'+backBtn+moreBtn+'</div>'+
    competencyMatrixHtml(columns)+
    '</section>'+target;
}
async function loadCompetencyGradeNav(root,direction,gradeCode){
  var btn=root.querySelector('[data-knl-comp-nav="'+direction+'"]');
  if(btn){btn.disabled=true;btn.textContent='Đang tải…';}
  try{
    var seq=foundationState.competencyGradeSequence,w=foundationState.competencyWindowStart||0;
    var targetIdx=direction==='forward'?w+2:w-1;
    var node=seq[targetIdx];
    if(node&&!node.standard){
      var queryCode=String(new URL(location.href).searchParams.get('employee_code')||'').trim().toUpperCase();
      var result=await apiPost('getKnlEmployeeCompetencyGradeStandard',Object.assign({gradeCode:gradeCode},queryCode?{employeeCode:queryCode}:{}));
      node.standard=result.standard;
    }
    foundationState.competencyWindowStart=direction==='forward'?w+1:w-1;
    var body=root.querySelector('[data-knl-body]');
    body.innerHTML=incomeHtml();
    bindIncomeSection(root);
  }catch(e){
    if(btn){btn.disabled=false;btn.textContent='+ Xem '+gradeCode;}
  }
}
function bindCompetencyMatrix(root){
  root.querySelectorAll('[data-knl-comp-nav]').forEach(function(btn){
    btn.addEventListener('click',function(){
      loadCompetencyGradeNav(root,btn.getAttribute('data-knl-comp-nav'),btn.getAttribute('data-knl-comp-nav-grade'));
    });
  });
}
/* Batch 1C — Lịch sử thay đổi bậc KNL. Dùng listKnlEmployeeCompetencyHistory
 * (đã bổ sung action/beforeGradeSnapshot từ knl_employee_competency_assignment_history
 * — audit log AUTHORITATIVE ghi bởi RPC duy nhất knl_set_employee_competency_
 * assignment(), server tự suy action, xem lib/knl-competency.js). KHÔNG còn so
 * 2 phần tử liền kề trong mảng periods để "suy" nâng/giảm bậc — action và
 * before_data.grade_snapshot đọc THẲNG từ chính event đã ghi lúc thao tác xảy
 * ra, không suy diễn ở tầng UI. isBaselineSeed=true CHỈ khi action==='CREATE'
 * (authoritative, không phụ thuộc vị trí trong mảng đã sort/limit) VÀ actor
 * là pattern hệ thống/batch/seed đã xác nhận (isSystemBaselineActor). */
function competencyEventTransitionHtml(p,isBaselineSeed){
  var ag=p.gradeSnapshot||{},bg=p.beforeGradeSnapshot||null,toLabel=ag.gradeCode||'—';
  if(isBaselineSeed)return '<p class="phfk-comp-history-transition">Trạng thái ban đầu khi thiết lập dữ liệu: <b>'+esc(toLabel)+'</b></p>';
  if(p.action==='CREATE')return '<p class="phfk-comp-history-transition">Bắt đầu áp dụng bậc <b>'+esc(toLabel)+'</b></p>';
  if(p.action==='CONFIRM')return '<p class="phfk-comp-history-transition">Xác nhận Chính thức: <b>'+esc(toLabel)+'</b></p>';
  if(p.action==='SUPERSEDE'||p.action==='RETROACTIVE_CHANGE'){
    var prefix=p.action==='RETROACTIVE_CHANGE'?'Điều chỉnh hồi tố — ':'';
    if(bg&&ag.frameworkCode&&bg.frameworkCode&&ag.frameworkCode!==bg.frameworkCode){
      return '<p class="phfk-comp-history-transition">'+esc(prefix+'Đổi Khung năng lực')+': <b>'+esc(bg.frameworkName||bg.frameworkCode||'—')+'</b> → <b>'+esc(ag.frameworkName||ag.frameworkCode||'—')+'</b></p>';
    }
    if(bg&&ag.gradeCode&&bg.gradeCode&&ag.gradeCode!==bg.gradeCode){
      return '<p class="phfk-comp-history-transition">'+esc(prefix+'Chuyển bậc')+': <b>'+esc(bg.gradeCode)+'</b> → <b>'+esc(ag.gradeCode)+'</b></p>';
    }
    return '<p class="phfk-comp-history-transition">'+esc(prefix+'Cập nhật')+': <b>'+esc(toLabel)+'</b></p>';
  }
  // action null/không khớp event nào (không có history row tương ứng) —
  // KHÔNG suy nâng/giảm bậc từ snapshot, chỉ nói "Cập nhật" trung tính.
  return '<p class="phfk-comp-history-transition">Cập nhật: <b>'+esc(toLabel)+'</b></p>';
}
function competencyHistoryHtml(){
  if(foundationState.competencyHistory===undefined)return '<section class="phfk-panel"><div class="phfk-loading">Đang tải…</div></section>';
  var periods=(foundationState.competencyHistory&&foundationState.competencyHistory.periods)||null;
  if(!periods)return '';
  var sorted=periods.slice().sort(function(x,y){return x.effectiveFrom<y.effectiveFrom?-1:x.effectiveFrom>y.effectiveFrom?1:0;});
  if(!sorted.length){
    return '<section class="phfk-panel"><div class="phfk-section-head"><h2>5. Lịch sử thay đổi bậc KNL</h2></div>'+noAccessSection('Chưa có lịch sử thay đổi Bậc KNL.')+'</section>';
  }
  var rows=sorted.map(function(p){
    var ag=p.gradeSnapshot||{};
    var actorRaw=p.updatedByName||p.createdByName;
    var isBaselineSeed=p.action==='CREATE'&&isSystemBaselineActor(actorRaw);
    return '<div class="phfk-comp-history-item"><div class="phfk-comp-history-dot'+(p.isActive?' is-current':'')+'"></div><div class="phfk-comp-history-body">'+
      '<div class="phfk-comp-history-head"><b>'+esc(formatDateVN(p.effectiveFrom))+'</b>'+(isBaselineSeed?'<span class="phfk-source-status is-review">Mốc khởi tạo</span>':'')+'<span class="phfk-source-status '+(p.status==='CONFIRMED'?'is-ready':'is-review')+'">'+esc(competencyStatusLabel(p.status))+'</span></div>'+
      competencyEventTransitionHtml(p,isBaselineSeed)+
      '<p class="phfk-comp-history-meta">'+esc(ag.frameworkName||'')+(ag.versionNumber?' · v'+esc(ag.versionNumber):'')+'</p>'+
      (p.reason?'<p class="phfk-comp-history-reason">Lý do: '+esc(p.reason)+'</p>':'')+
      '<p class="phfk-comp-history-actor">Người thực hiện: '+esc(friendlyActorLabel(actorRaw))+'</p>'+
      '</div></div>';
  }).reverse().join('');
  return '<section class="phfk-panel phfk-history-panel"><div class="phfk-section-head"><h2>5. Lịch sử thay đổi bậc KNL</h2></div><div class="phfk-comp-history-timeline">'+rows+'</div></section>';
}
function bindIncomeSection(root){
  bindCompensationDomainNav(root);
  var change=root.querySelector('[data-knl-change-income]');
  if(change)change.addEventListener('click',goIncomePicker);
  var correctBtn=root.querySelector('[data-knl-correct-period]');
  if(correctBtn)correctBtn.addEventListener('click',function(){
    var current=foundationState.income&&foundationState.income.current;
    if(!current)return;
    correctionState={pending:false,error:'',targetPeriod:'',reason:''};
    renderCorrectionModal(root,current);
  });
  bindCompetencyMatrix(root);
}
var knlIncomeLoadToken=0;
async function renderIncome(root,isAdmin,capabilities){
  var body=root.querySelector('[data-knl-body]'),url=new URL(location.href),queryCode=String(url.searchParams.get('employee_code')||'').trim().toUpperCase(),choose=url.searchParams.get('choose_employee')==='1';
  foundationState.incomeIsAdmin=isAdmin===true;
  foundationState.incomeCanSelect=isAdmin===true||(capabilities&&capabilities.income_view===true);
  if(!queryCode&&(isAdmin||choose&&foundationState.incomeCanSelect)){await showIncomePicker(root);return;}
  foundationState.competencyGradeSequence=[];
  foundationState.competencyWindowStart=0;
  // Fix gap: chuyển nhân sự (đổi employee_code) trước đây giữ nguyên hồ sơ cũ
  // im lặng trên màn hình cho tới khi toàn bộ chuỗi API tuần tự bên dưới trả
  // về — nay báo loading ngay khi bắt đầu tải hồ sơ mới.
  body.innerHTML='<div class="phfk-loading">Đang tải hồ sơ thu nhập…</div>';
  // Token chặn stale response: nếu người dùng đổi nhân sự trước khi lượt
  // tải này xong, lượt cũ phải không được ghi đè body của lượt mới hơn.
  var myToken=++knlIncomeLoadToken;
  var reqPayload=queryCode?{employeeCode:queryCode}:undefined;
  try{
    var incomeResult=await apiPost('getKnlEmployeeIncome',reqPayload);
    if(myToken!==knlIncomeLoadToken)return; // response chậm của lượt tải cũ -> bỏ qua, không ghi vào foundationState
    foundationState.income=incomeResult;
    // 4 call còn lại độc lập với nhau và với income (không đọc dữ liệu của
    // nhau trước khi dùng) -> chạy song song thay vì await tuần tự từng cái.
    var settled=await Promise.allSettled([
      apiPost('getKnlEmployeeNextCompensationGrade',reqPayload),
      apiPost('getKnlEmployeeCompetencyStandard',reqPayload),
      apiPost('listKnlEmployeeCompetencyHistory',reqPayload),
      apiPost('getKnlEmployeeProfile',reqPayload)
    ]);
    if(myToken!==knlIncomeLoadToken)return;
    var nextGradeSettled=settled[0],competencySettled=settled[1],historySettled=settled[2],profileSettled=settled[3];
    foundationState.nextCompensationGrade=nextGradeSettled.status==='fulfilled'?nextGradeSettled.value:null;
    foundationState.competency=competencySettled.status==='fulfilled'?competencySettled.value:null;
    if(foundationState.competency&&foundationState.competency.hasAssignment){
      var seqBuilt=buildCompetencyGradeSequence(foundationState.competency);
      foundationState.competencyGradeSequence=seqBuilt;
      var curIdx=seqBuilt.findIndex(function(n){return n.isRealCurrent;});
      /* Mặc định: current↔next (curIdx). Nếu đang ở bậc cao nhất (không có
       * next) thì không có gì để hiện bên phải -> mặc định lùi 1 bước để
       * vẫn hiện được 1 cặp so sánh (previous↔current), đúng yêu cầu "current
       * = B5 -> mặc định B4↔B5 HIỆN TẠI". */
      foundationState.competencyWindowStart=foundationState.competency.isMaxGrade?Math.max(0,curIdx-1):curIdx;
    }
    foundationState.competencyHistory=historySettled.status==='fulfilled'?historySettled.value:null;
    foundationState.profile=profileSettled.status==='fulfilled'?profileSettled.value.profile:null;
    body.innerHTML=incomeHtml();
    bindIncomeSection(root);
  }catch(e){
    if(myToken!==knlIncomeLoadToken)return;
    if(!queryCode&&foundationState.incomeCanSelect&&e.code==='KNL_EMPLOYEE_CODE_REQUIRED')await showIncomePicker(root,e.message);
    else body.innerHTML=noAccessSection(e.message);
  }
}

/* ===== Gán cho nhân viên — Official (lookup master, no personal override) / Probation (fixed-only) ===== */
function assignLadderOptions(selectedId){return ((assignState.standards&&assignState.standards.ladders)||[]).map(function(l){return '<option value="'+esc(l.id)+'"'+(l.id===selectedId?' selected':'')+'>'+esc(l.code+' · '+l.name)+'</option>';}).join('');}
function assignVersionsForLadder(ladderId){var ladders=(assignState.standards&&assignState.standards.ladders)||[],ladder=ladders.find(function(l){return l.id===ladderId;});return ladder?(ladder.versions||[]).filter(function(v){return v.status!=='DRAFT'&&v.effective_period;}).sort(function(a,b){return b.version_number-a.version_number;}):[];}
function assignGradesForVersion(ladderId,versionId){var version=assignVersionsForLadder(ladderId).find(function(v){return v.id===versionId;});return version?(version.grades||[]).slice().sort(function(a,b){return a.grade_number-b.grade_number;}):[];}
function assignDefaultForm(){return{employmentType:'OFFICIAL',payrollPeriod:assignRecommendedPeriod(),ladderId:'',versionId:'',gradeId:'',isProfessionalAllowance:false,isManagementAllowance:false,isMealAllowance:false,mealOverride:MEAL_SUGGESTION,probationAmount:PROBATION_SUGGESTION,extraAllowances:[],reason:''};}
/* Tính trước tổng/cơ cấu kỳ mới thuần phía client (đúng công thức RPC
   knl_save_employee_compensation) để hiện Preview trước khi lưu - mục 6 Batch
   2. Không gọi thêm API, không đổi dữ liệu server. */
function assignComputeNew(f,selectedGrade){
  if(f.employmentType==='PROBATION')return{isOfficial:false,total:Number(f.probationAmount||0)};
  if(!selectedGrade)return null;
  var extra=(f.extraAllowances||[]).filter(function(x){return x.name&&x.amount;}).reduce(function(s,x){return s+Number(x.amount||0);},0);
  var prof=f.isProfessionalAllowance?Number(selectedGrade.professional_allowance||0):0;
  var mgmt=f.isManagementAllowance?Number(selectedGrade.management_allowance||0):0;
  var meal=f.isMealAllowance?Number(f.mealOverride||0):0;
  var base=Number(selectedGrade.base_salary||0),hqcv=Number(selectedGrade.hqcv||0);
  return{isOfficial:true,base:base,hqcv:hqcv,prof:prof,mgmt:mgmt,meal:meal,extra:extra,total:base+hqcv+prof+mgmt+meal+extra};
}
function assignPreviewHtml(current,f,selectedGrade){
  var proposed=assignComputeNew(f,selectedGrade);
  if(!proposed)return '';
  var rows=proposed.isOfficial?(
    '<tr><td>Lương cơ bản + HQCV</td><td>'+money(proposed.base+proposed.hqcv)+'</td></tr>'+
    (f.isProfessionalAllowance?'<tr><td>Phụ cấp nghiệp vụ</td><td>'+money(proposed.prof)+'</td></tr>':'')+
    (f.isManagementAllowance?'<tr><td>Phụ cấp quản lý/trách nhiệm</td><td>'+money(proposed.mgmt)+'</td></tr>':'')+
    (f.isMealAllowance?'<tr><td>Tiền cơm</td><td>'+money(proposed.meal)+'</td></tr>':'')+
    (proposed.extra?'<tr><td>Phụ cấp khác</td><td>'+money(proposed.extra)+'</td></tr>':'')
  ):('<tr><td>Mức lương thử việc</td><td>'+money(proposed.total)+'</td></tr>');
  var oldTotal=current?Number(current.totalReferenceIncome||0):0,delta=proposed.total-oldTotal;
  var retro=assignIsRetroactive(f.payrollPeriod);
  var samePeriodAsCurrent=current&&current.payrollPeriod===f.payrollPeriod;
  return '<section class="phfk-panel phfk-income-card phfk-assign-block"><div class="phfk-section-head"><div><span class="phfk-assign-step">4</span><h2>Tóm tắt thay đổi (dự kiến) — kỳ '+esc(f.payrollPeriod||'—')+'</h2></div></div>'+
    (retro?('<p class="phfk-error">⚠ Kỳ áp dụng ('+esc(f.payrollPeriod)+') trước kỳ khuyến nghị ('+esc(assignRecommendedPeriod())+') — đây là điều chỉnh HỒI TỐ. Bắt buộc nhập lý do hồi tố ở ô "Lý do" bên dưới.</p>'):'')+
    (samePeriodAsCurrent?'<p class="phfk-batch-note">Kỳ '+esc(f.payrollPeriod)+' đã có cơ cấu đang áp dụng — lưu sẽ CẬP NHẬT (ghi đè) đúng bản ghi kỳ này, không tạo kỳ mới.</p>':'')+
    '<div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Khoản mục kỳ mới</th><th>Mức tiền (VND)</th></tr></thead><tbody>'+rows+
    '<tr class="phfk-comp-parts-subtotal"><td>Tổng kỳ mới</td><td><b>'+money(proposed.total)+'</b></td></tr>'+
    (current?(
      '<tr><td>Tổng kỳ hiện tại ('+esc(current.payrollPeriod)+')</td><td>'+money(oldTotal)+'</td></tr>'+
      '<tr><td>Chênh lệch</td><td><b class="'+(delta>0?'phfk-assign-delta-up':(delta<0?'phfk-assign-delta-down':''))+'">'+(delta>=0?'+':'')+money(delta)+'</b></td></tr>'
    ):'')+
    '</tbody></table></div></section>';
}
function assignExtraAllowanceRowsHtml(){var rows=assignState.form.extraAllowances||[];return rows.map(function(row,idx){return '<div class="phfk-comp-extra-row"><input type="text" class="phfk-input" data-assign-extra-name="'+idx+'" placeholder="Tên phụ cấp" value="'+esc(row.name||'')+'"><input type="number" min="0" step="1000" class="phfk-input" data-assign-extra-amount="'+idx+'" placeholder="Số tiền" value="'+esc(row.amount||'')+'"><button type="button" class="phfk-btn-secondary" data-assign-extra-remove="'+idx+'">Xoá</button></div>';}).join('')+(rows.length<3?'<button type="button" class="phfk-btn-secondary" data-assign-extra-add>+ Thêm phụ cấp khác ('+rows.length+'/3)</button>':'<p class="phfk-batch-note">Đã đạt tối đa 3 phụ cấp khác.</p>');}
function assignPickerHtml(){var people=assignState.targets||[];return compensationDomainNav('gan-thu-nhap',true)+'<div class="phfk-page-head"><div><small>KNL · GÁN CHO NHÂN VIÊN</small><h1>Chọn nhân sự</h1><p>Chỉ nhân sự đang làm việc.</p></div></div>'+knlEmployeePickerHtml({ns:'assign',people:people,emptyText:'Không có nhân sự đang làm việc.'});}
function bindAssignPicker(root){bindCompensationDomainNav(root);bindKnlEmployeePicker(root,'assign',function(code){assignState.selectedCode=code;assignState.current=null;assignState.form=assignDefaultForm();assignState.message='';assignState.error='';renderCompensationAssign(root);});}
function assignFormHtml(person){
  var f=assignState.form,current=assignState.current&&assignState.current.current,isOfficial=f.employmentType==='OFFICIAL';
  var versions=isOfficial?assignVersionsForLadder(f.ladderId):[],grades=isOfficial?assignGradesForVersion(f.ladderId,f.versionId):[],selectedGrade=grades.find(function(g){return g.id===f.gradeId;});
  var wasProbation=current&&current.employmentType==='PROBATION';
  var retro=assignIsRetroactive(f.payrollPeriod);
  var block1=current?('<section class="phfk-panel phfk-income-card phfk-assign-block"><div class="phfk-section-head"><div><span class="phfk-assign-step">1</span><h2>Cơ cấu hiện tại</h2></div></div><div class="phfk-income-summary"><div><small>NGẠCH · BẬC</small><b>'+esc(current.ladderCode||'—')+' · '+esc(current.gradeCode||'—')+'</b></div><div><small>PHIÊN BẢN</small><b>v'+esc(current.versionNumber||'—')+'</b></div><div><small>KỲ LƯƠNG</small><b>'+esc(current.payrollPeriod)+'</b></div></div></section>')
    :('<section class="phfk-panel phfk-assign-block"><div class="phfk-section-head"><div><span class="phfk-assign-step">1</span><h2>Cơ cấu hiện tại</h2></div></div><p class="phfk-batch-note">Nhân sự này chưa có cơ cấu thu nhập nào.</p></section>');
  return compensationDomainNav('gan-thu-nhap',true)+
    '<div class="phfk-page-head"><div><small>KNL · GÁN CHO NHÂN VIÊN</small><h1>'+esc(person.employeeName)+' · '+esc(person.employeeCode)+'</h1></div><button type="button" class="phfk-btn-secondary" data-assign-change>Chọn nhân sự khác</button></div>'+
    '<form data-assign-form>'+
    block1+
    '<section class="phfk-panel phfk-assign-block"><div class="phfk-section-head"><div><span class="phfk-assign-step">2</span><h2>Chọn cơ cấu mới</h2></div></div>'+
    '<div class="phfk-checklist" style="margin-bottom:12px">'+
      '<label class="phfk-check"><input type="radio" name="employmentTypeRadio" value="OFFICIAL" data-assign-type'+(isOfficial?' checked':'')+'> Chính thức</label>'+
      '<label class="phfk-check"><input type="radio" name="employmentTypeRadio" value="PROBATION" data-assign-type'+(!isOfficial?' checked':'')+'> Thử việc</label>'+
    '</div>'+
    (isOfficial&&wasProbation?'<p class="phfk-batch-note">Nhân sự đang thử việc. Hệ thống gợi ý bắt đầu từ Bậc 1 phù hợp Ngạch/Phiên bản vừa chọn — vui lòng tự xác nhận lại Ngạch/Phiên bản/Bậc trước khi lưu, không mặc nhiên coi Bậc 1 là quyết định cuối.</p>':'')+
    '<div class="phfk-assignment-form">'+
    (isOfficial?(
      '<label class="phfk-field"><span>Ngạch</span><select class="phfk-input" data-assign-ladder><option value="">— Chọn ngạch —</option>'+assignLadderOptions(f.ladderId)+'</select></label>'+
      '<label class="phfk-field"><span>Phiên bản</span><select class="phfk-input" data-assign-version'+(!f.ladderId?' disabled':'')+'><option value="">— Chọn phiên bản —</option>'+versions.map(function(v){return '<option value="'+esc(v.id)+'"'+(v.id===f.versionId?' selected':'')+'>v'+v.version_number+' · '+esc(lifecycleStatusLabel(v.status))+' · '+esc(v.effective_period)+'</option>';}).join('')+'</select></label>'+
      '<label class="phfk-field"><span>Bậc</span><select class="phfk-input" data-assign-grade'+(!f.versionId?' disabled':'')+'><option value="">— Chọn bậc —</option>'+grades.map(function(g){return '<option value="'+esc(g.id)+'"'+(g.id===f.gradeId?' selected':'')+'>'+esc(g.grade_code)+' · LCB '+money(g.base_salary)+' · HQCV '+money(g.hqcv)+'</option>';}).join('')+'</select></label>'+
      (selectedGrade?('<p class="phfk-batch-note">LCB '+money(selectedGrade.base_salary)+' · HQCV '+money(selectedGrade.hqcv)+' · PC nghiệp vụ chuẩn '+money(selectedGrade.professional_allowance)+' · PC QL/trách nhiệm chuẩn '+money(selectedGrade.management_allowance)+' (lookup master, không override cá nhân). Đã tick sẵn các khoản chuẩn — bỏ tick khoản nào không áp dụng cho nhân sự này.</p>'):'')+
      '<label class="phfk-check"><input type="checkbox" data-assign-prof'+(f.isProfessionalAllowance?' checked':'')+'> Hưởng PC nghiệp vụ</label>'+
      '<label class="phfk-check"><input type="checkbox" data-assign-mgmt'+(f.isManagementAllowance?' checked':'')+'> Hưởng PC quản lý/trách nhiệm</label>'+
      '<label class="phfk-check"><input type="checkbox" data-assign-meal'+(f.isMealAllowance?' checked':'')+'> Hưởng tiền cơm</label>'
    ):(
      '<label class="phfk-field"><span>Mức lương thử việc (gợi ý '+money(PROBATION_SUGGESTION)+', cho phép điều chỉnh)</span><input type="number" min="1" step="1000" class="phfk-input" data-assign-probation-amount value="'+esc(f.probationAmount!=null?f.probationAmount:PROBATION_SUGGESTION)+'" required></label>'
    ))+'</div></section>'+
    '<section class="phfk-panel phfk-assign-block"><div class="phfk-section-head"><div><span class="phfk-assign-step">3</span><h2>Thời điểm &amp; khoản đi kèm</h2></div></div>'+
    '<div class="phfk-assignment-form">'+
    '<label class="phfk-field"><span>Kỳ lương áp dụng (khuyến nghị '+esc(assignRecommendedPeriod())+')</span><input type="month" class="phfk-input" data-assign-period value="'+esc(f.payrollPeriod||'')+'" required></label>'+
    (isOfficial?'<label class="phfk-field"><span>Tiền cơm (gợi ý '+money(MEAL_SUGGESTION)+', cho phép ngoại lệ)</span><input type="number" min="0" step="1000" class="phfk-input" data-assign-meal-amount value="'+esc(f.mealOverride!=null?f.mealOverride:MEAL_SUGGESTION)+'"></label>':'')+
    '</div>'+
    (isOfficial?('<div class="phfk-field"><span>Phụ cấp khác (tối đa 3)</span><div data-assign-extra-list>'+assignExtraAllowanceRowsHtml()+'</div></div>'):'')+
    '<label class="phfk-field"><span>Lý do / ghi chú'+(retro?' (BẮT BUỘC — điều chỉnh hồi tố)':' (tuỳ chọn)')+'</span><textarea class="phfk-input" data-assign-reason'+(retro?' required':'')+'>'+esc(f.reason||'')+'</textarea></label>'+
    '<div class="phfk-form-actions"><button type="submit" class="phfk-btn-primary">Lưu cơ cấu kỳ này</button></div>'+
    (assignState.message?'<p class="phfk-success">'+esc(assignState.message)+'</p>':'')+
    (assignState.error?'<p class="phfk-error">'+esc(assignState.error)+'</p>':'')+
    '</section>'+
    '</form>'+
    assignPreviewHtml(current,f,selectedGrade);
}
function renderCompensationAssignBody(root,person){var body=root.querySelector('[data-knl-body]');body.innerHTML=assignFormHtml(person);bindAssignForm(root,person);}
function bindAssignForm(root,person){
  bindCompensationDomainNav(root);
  var change=root.querySelector('[data-assign-change]');if(change)change.onclick=function(){assignState.selectedCode='';renderCompensationAssign(root);};
  root.querySelectorAll('[data-assign-type]').forEach(function(radio){radio.onchange=function(){assignState.form.employmentType=radio.value;if(radio.value==='PROBATION'&&assignState.form.probationAmount==null)assignState.form.probationAmount=PROBATION_SUGGESTION;renderCompensationAssignBody(root,person);};});
  var periodInput=root.querySelector('[data-assign-period]');if(periodInput)periodInput.onchange=function(){assignState.form.payrollPeriod=periodInput.value;renderCompensationAssignBody(root,person);};
  var ladderSel=root.querySelector('[data-assign-ladder]');if(ladderSel)ladderSel.onchange=function(){assignState.form.ladderId=ladderSel.value;assignState.form.versionId='';assignState.form.gradeId='';renderCompensationAssignBody(root,person);};
  var versionSel=root.querySelector('[data-assign-version]');if(versionSel)versionSel.onchange=function(){
    assignState.form.versionId=versionSel.value;assignState.form.gradeId='';
    /* Mục 9 Batch 2: nhân sự đang thử việc chuyển chính thức -> gợi ý sẵn Bậc 1
       của Version vừa chọn (Admin vẫn xem lại/đổi được trước khi lưu, đúng
       "không mặc nhiên coi Bậc 1 là quyết định cuối"). */
    var wasProbation=assignState.current&&assignState.current.current&&assignState.current.current.employmentType==='PROBATION';
    if(wasProbation){
      var grade1=assignGradesForVersion(assignState.form.ladderId,assignState.form.versionId).find(function(g){return Number(g.grade_number)===1;});
      if(grade1){assignState.form.gradeId=grade1.id;assignState.form.isProfessionalAllowance=true;assignState.form.isManagementAllowance=true;assignState.form.isMealAllowance=true;}
    }
    renderCompensationAssignBody(root,person);
  };
  var gradeSel=root.querySelector('[data-assign-grade]');if(gradeSel)gradeSel.onchange=function(){
    assignState.form.gradeId=gradeSel.value;
    /* Mục 2 Batch 2: chọn Bậc -> tự tick sẵn các khoản chuẩn; Admin bỏ tick
       khoản không áp dụng cho nhân sự này (không auto-áp mọi khoản vĩnh viễn,
       chỉ là gợi ý ban đầu mỗi lần đổi Bậc). */
    if(gradeSel.value){assignState.form.isProfessionalAllowance=true;assignState.form.isManagementAllowance=true;assignState.form.isMealAllowance=true;}
    renderCompensationAssignBody(root,person);
  };
  var profChk=root.querySelector('[data-assign-prof]');if(profChk)profChk.onchange=function(){assignState.form.isProfessionalAllowance=profChk.checked;renderCompensationAssignBody(root,person);};
  var mgmtChk=root.querySelector('[data-assign-mgmt]');if(mgmtChk)mgmtChk.onchange=function(){assignState.form.isManagementAllowance=mgmtChk.checked;renderCompensationAssignBody(root,person);};
  var mealChk=root.querySelector('[data-assign-meal]');if(mealChk)mealChk.onchange=function(){assignState.form.isMealAllowance=mealChk.checked;renderCompensationAssignBody(root,person);};
  var mealAmount=root.querySelector('[data-assign-meal-amount]');if(mealAmount)mealAmount.onchange=function(){assignState.form.mealOverride=Number(mealAmount.value||0);renderCompensationAssignBody(root,person);};
  var probationAmount=root.querySelector('[data-assign-probation-amount]');if(probationAmount)probationAmount.onchange=function(){assignState.form.probationAmount=Number(probationAmount.value||0);renderCompensationAssignBody(root,person);};
  var reasonInput=root.querySelector('[data-assign-reason]');if(reasonInput)reasonInput.addEventListener('input',function(){assignState.form.reason=reasonInput.value;});
  var addExtra=root.querySelector('[data-assign-extra-add]');if(addExtra)addExtra.onclick=function(){if((assignState.form.extraAllowances||[]).length>=3)return;assignState.form.extraAllowances=(assignState.form.extraAllowances||[]).concat([{name:'',amount:''}]);renderCompensationAssignBody(root,person);};
  root.querySelectorAll('[data-assign-extra-remove]').forEach(function(btn){btn.onclick=function(){assignState.form.extraAllowances.splice(Number(btn.getAttribute('data-assign-extra-remove')),1);renderCompensationAssignBody(root,person);};});
  root.querySelectorAll('[data-assign-extra-name],[data-assign-extra-amount]').forEach(function(input){input.addEventListener('change',function(){var isName=input.hasAttribute('data-assign-extra-name'),idx=Number(input.getAttribute(isName?'data-assign-extra-name':'data-assign-extra-amount'));assignState.form.extraAllowances[idx][isName?'name':'amount']=input.value;renderCompensationAssignBody(root,person);});});
  var form=root.querySelector('[data-assign-form]');if(!form)return;
  form.onsubmit=async function(ev){
    ev.preventDefault();
    var f=assignState.form,type=f.employmentType,payload={employeeCode:person.employeeCode,payrollPeriod:f.payrollPeriod,employmentType:type,reason:f.reason||''};
    if(assignIsRetroactive(f.payrollPeriod)&&String(f.reason||'').trim().length<5){assignState.error='Điều chỉnh hồi tố (kỳ trước '+assignRecommendedPeriod()+') bắt buộc nhập lý do hồi tố (tối thiểu 5 ký tự).';renderCompensationAssignBody(root,person);return;}
    if(type==='OFFICIAL'){
      if(!f.gradeId){assignState.error='Vui lòng chọn Ngạch/Phiên bản/Bậc.';renderCompensationAssignBody(root,person);return;}
      payload.gradeId=f.gradeId;
      payload.isProfessionalAllowance=!!f.isProfessionalAllowance;
      payload.isManagementAllowance=!!f.isManagementAllowance;
      payload.isMealAllowance=!!f.isMealAllowance;
      payload.mealOverride=Number(f.mealOverride||0);
      payload.extraAllowances=(f.extraAllowances||[]).filter(function(x){return x.name&&x.amount;}).map(function(x){return{name:x.name,amount:Number(x.amount)};});
    }else{
      payload.probationAmount=Number(f.probationAmount||0);
    }
    try{
      await apiPost('saveKnlEmployeeIncome',payload);
      assignState.message='Đã lưu cơ cấu kỳ '+payload.payrollPeriod+'.';assignState.error='';
      assignState.current=await apiPost('getKnlEmployeeIncome',{employeeCode:person.employeeCode});
      assignState.form=assignDefaultForm();assignState.form.employmentType=type;
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
    if(!assignState.form)assignState.form=assignDefaultForm();
    if(!assignState.current)assignState.current=await apiPost('getKnlEmployeeIncome',{employeeCode:person.employeeCode}).catch(function(){return null;});
    renderCompensationAssignBody(root,person);
  }catch(e){body.innerHTML=compensationDomainNav('gan-thu-nhap',true)+noAccessSection(e.message);bindCompensationDomainNav(root);}
}

/* ===== Lịch sử — master version audit (không lookup current để dựng quá khứ) + employee history ===== */
function compensationAuditSummary(entry){
  if(entry.entityType==='compensation_version'){
    if(entry.action==='clone')return 'Tạo phiên bản Dự thảo mới từ v'+((entry.beforeData&&entry.beforeData.sourceVersionNumber)||'?');
    if(entry.action==='schedule')return 'Đặt hiệu lực: '+lifecycleStatusLabel((entry.afterData&&entry.afterData.status)||'')+' từ '+((entry.afterData&&entry.afterData.effectiveFrom)||'');
    return 'Cập nhật phiên bản';
  }
  return 'Sửa '+((entry.afterData&&entry.afterData.grades&&entry.afterData.grades.length)||0)+' bậc';
}
/* Schema chỉ có 1 field tên (actor_name/changed_by_name) — không có cột
   "nguồn" riêng. Với record do batch/seed script ghi (tên kiểu mô tả kỹ
   thuật, không phải tên người), tách trình bày thành "Hệ thống" + giữ
   nguyên chuỗi gốc làm "Nguồn" (không bịa, không rewrite DB, chỉ khác cách
   đọc 1 field có sẵn tại thời điểm render). */
function compensationActorPresentation(rawName){
  var name=String(rawName||'').trim();
  if(!name)return{who:'Hệ thống',source:'Không có thông tin'};
  if(/batch|script|seed|import|migration|automation|baseline|manifest/i.test(name))return{who:'Hệ thống',source:name};
  return{who:name,source:'Thao tác thủ công'};
}
function compensationHistoryActorCell(rawName){var p=compensationActorPresentation(rawName);return '<b>'+esc(p.who)+'</b><small>'+esc(p.source)+'</small>';}
function compensationHistoryHtml(){
  var versionRows=historyState.versionAudit.map(function(e){return '<tr><td>'+esc(e.ladderCode||'—')+'</td><td>v'+esc(e.versionNumber||'—')+'</td><td>'+esc(compensationAuditSummary(e))+'</td><td class="phfk-history-actor">'+compensationHistoryActorCell(e.actorName)+'</td><td>'+esc(fmtKnlDateTime(e.createdAt))+'</td></tr>';}).join('')||'<tr><td colspan="5">Chưa có thay đổi nào.</td></tr>';
  var empRows=historyState.employeeHistory.map(function(h){var t=compensationChangeTransition(h);return '<tr><td>'+esc(h.employeeCode)+'</td><td>'+esc(h.payrollPeriod)+'</td><td>'+esc(compensationChangeSummary(h))+'</td><td>'+esc(t.from)+'</td><td>'+esc(t.to)+'</td><td class="phfk-history-actor">'+compensationHistoryActorCell(h.changedByName)+'</td><td>'+esc(fmtKnlDateTime(h.changedAt))+'</td></tr>';}).join('')||'<tr><td colspan="7">Chưa có thay đổi nào.</td></tr>';
  return compensationDomainNav('lich-su-thu-nhap',true)+
    '<div class="phfk-page-head"><div><small>KNL · LỊCH SỬ</small><h1>Lịch sử cơ cấu ngạch, bậc & thu nhập</h1></div></div>'+
    '<section class="phfk-panel"><div class="phfk-section-head"><h2>Thay đổi cơ cấu ngạch & bậc (master)</h2></div><div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Ngạch</th><th>Phiên bản</th><th>Thay đổi</th><th>Người thực hiện</th><th>Thời điểm</th></tr></thead><tbody>'+versionRows+'</tbody></table></div></section>'+
    '<section class="phfk-panel"><div class="phfk-section-head"><div><small>NHÂN VIÊN</small><h2>Thay đổi cơ cấu thu nhập nhân viên</h2></div></div><label class="phfk-field" style="max-width:280px"><span>Lọc theo mã nhân viên</span><input type="text" class="phfk-input" data-history-employee-filter value="'+esc(historyState.employeeFilter)+'" placeholder="VD: PHF001"></label><div class="phfk-table-wrap"><table class="phfk-table"><thead><tr><th>Mã NV</th><th>Kỳ</th><th>Loại thay đổi</th><th>Trước</th><th>Sau</th><th>Người thực hiện</th><th>Thời điểm</th></tr></thead><tbody>'+empRows+'</tbody></table></div></section>';
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

/* ===================== ĐỀ XUẤT NÂNG BẬC (KNL Grade Promotion Proposal, batch 2) =====================
   Functional-first theo đúng chỉ đạo Technical Lead (mục 13 batch 2) — chưa
   polish. Không hiển thị bất kỳ số tiền nào (base_salary/hqcv/allowance) ở
   bất kỳ đâu trong section này — API backend (lib/knl-grade-proposals.js)
   vốn cũng không bao giờ trả các field đó. */
/* create state — TRACE 2026-08-12 (batch redesign "Tạo đề xuất"): payload
 * gửi lên createKnlGradePromotionProposal (employeeCode/reason/
 * proposedGradeId/selectedFirstApproverEmployeeCode) và toàn bộ business
 * rule KHÔNG đổi so với form cũ — chỉ đổi CÁCH chọn giá trị (picker thay vì
 * gõ tay). Employee picker dùng lại NGUYÊN listKnlPeople (đã lọc đúng
 * peopleScope, cùng nguồn màn Nhân sự) — không phải toàn bộ tổ chức, đúng
 * tập "creationAuthorized" cho phép (self hoặc peopleScope match, xem
 * lib/knl-grade-proposals.js). Receiver picker dùng action MỚI
 * getKnlGradePromotionApproverOptions (lib/knl-grade-proposals.js) — THUẦN
 * READ, liệt kê lại ĐÚNG cùng 1 predicate mà resolveApprovalChain() nhánh
 * Sales đã dùng để validate lúc submit (capabilities.agree_proposal===true +
 * subjectMatchesScope(subject, grant.people_scope,...)) — không phải rule
 * mới, không mở rộng ai được chọn. Backend vẫn tự re-validate độc lập lúc
 * tạo proposal, picker chỉ hỗ trợ UI. */
function gpCreateInitialState(){
  return { pool:null, poolLoading:false, poolLoaded:false, poolError:'',
    employeeQuery:'', employeeSelected:null,
    gradeOptions:null, gradeLoading:false, gradeSelectedId:'',
    criteriaStandard:null, criteriaLoading:false, criteriaError:'', assessment:{},
    approverOptions:null, approverLoading:false, approverQuery:'', approverSelectedCode:'',
    reason:'', submitting:false, error:'' };
}
var GP_CRITERIA_MAPPING_ERROR_LABELS = {
  no_framework_assignment: 'Nhân sự chưa có Khung năng lực (KNL) đang áp dụng — chưa thể tạo Đề xuất nâng bậc.',
  grade_not_mapped: 'Bậc đề xuất không khớp với bất kỳ bậc nào trong Khung năng lực đang áp dụng của nhân sự — vui lòng liên hệ Admin kiểm tra mapping bậc lương/bậc năng lực.',
  no_requirements: 'Bậc đề xuất chưa có tiêu chí năng lực nào được thiết lập trong Khung năng lực — chưa thể tạo Đề xuất nâng bậc.'
};
/* 3 dataset (awaiting/mine/visible) đều có loading/loaded/loadError RIÊNG —
 * bắt buộc để gpListBodyHtml() phân biệt được "chưa fetch bao giờ"/"đang
 * fetch" với "đã fetch xong và rỗng thật" (mục 4 báo cáo bug initial-load).
 * KHÔNG dùng gpState.error/gpState.message chung cho việc này — 2 field đó
 * vẫn giữ nguyên nghĩa cũ (thông báo sau hành động agree/reject/withdraw/tạo
 * đề xuất), tách biệt khỏi lỗi tải danh sách. */
var gpState = { loaded:false, loadedAt:0, view:'awaiting',
  mine:[], mineLoading:false, mineLoaded:false, mineLoadError:'',
  awaiting:[], awaitingLoading:false, awaitingLoaded:false, awaitingLoadError:'',
  visible:[], visibleLoading:false, visibleLoaded:false, visibleLoadError:'',
  visibleStatus:'', detail:null, detailId:'', error:'', message:'', detailActionBusy:false, create:gpCreateInitialState() };
var GP_STATUS_LABELS = { pending:'Đang xử lý', approved:'Đã duyệt', rejected:'Không đồng ý', withdrawn:'Đã rút' };
var GP_ACTION_LABELS = { propose:'Tạo đề xuất', agree:'Đồng ý', approve:'Duyệt (Admin)', reject:'Không đồng ý', withdraw:'Rút đề xuất', reassign:'Route lại (tự động)' };

function gpNav(activeView, capabilities, isAdmin){
  var canView = isAdmin || capabilities.view_proposals === true;
  var canPropose = isAdmin || capabilities.propose === true;
  var tabs = [['awaiting','Cần tôi xử lý'],['mine','Đề xuất của tôi']];
  if(canView) tabs.push(['visible','Danh sách']);
  if(canPropose) tabs.push(['create','Tạo đề xuất']);
  return '<nav class="phfk-domain-tabs" aria-label="Đề xuất nâng bậc">'+tabs.map(function(t){return '<button type="button" class="'+(activeView===t[0]?'active':'')+'" data-gp-nav="'+t[0]+'">'+t[1]+'</button>';}).join('')+'</nav>';
}
function bindGpNav(root){root.querySelectorAll('[data-gp-nav]').forEach(function(b){b.onclick=function(){
  gpState.view=b.getAttribute('data-gp-nav');gpState.error='';
  var u=new URL(location.href);u.searchParams.delete('proposal');history.pushState({},'',u.pathname+u.search);
  gpLoadActiveView(root); // bấm tab nào -> loader đúng của tab đó chạy ngay, không chờ mount lại (xem gpLoadActiveView())
};});}

function gpGradeLine(currentCode,currentNumber,proposedCode,proposedNumber){return esc(currentCode||'—')+' <span class="phfk-gp-grade-arrow-mini" aria-hidden="true">→</span> <b class="phfk-gp-grade-target-mini">'+esc(proposedCode||'—')+'</b>';}

/* Workflow progress — DUY NHẤT dựa vào routing_snapshot/liveChain +
 * current_step_index + status thật đã persist (không invent, không hardcode
 * số tầng/tên người). Dùng chung cho cả "Tiến trình" (compact, list) và
 * "TIẾN TRÌNH XỬ LÝ" (block đầy đủ, detail) — xem gpChainCompactHtml() /
 * gpWorkflowOverviewHtml() bên dưới, cùng đọc qua gpStepStatus(). */
function gpStepStatus(i, currentStepIndex, status){
  if(i < currentStepIndex) return 'done';
  if(i === currentStepIndex){
    if(status === 'pending') return 'current';
    if(status === 'rejected') return 'rejected';
    if(status === 'withdrawn') return 'withdrawn';
  }
  return 'future';
}
function gpShortName(name){
  var parts = String(name||'').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length-1] : '';
}
/* "Đang chờ": resolve THẲNG từ routing_snapshot[current_step_index] đã
 * persist — không đoán khi index không hợp lệ (mục 5: hiển thị an toàn
 * "Chưa xác định người xử lý" thay vì suy diễn). */
function gpWaitingStep(p){
  if(p.status !== 'pending') return null;
  var chain = p.routingSnapshot || [];
  return chain[p.currentStepIndex] || undefined; // undefined = index không resolve được (khác null = đã kết thúc)
}
function gpWaitingCellHtml(p){
  if(p.status !== 'pending') return '<span class="phfk-gp-waiting-none">—</span>';
  var step = gpWaitingStep(p);
  if(!step) return '<span class="phfk-gp-waiting-unknown">Chưa xác định người xử lý</span>';
  var name = step.tier==='final' ? 'Admin' : (step.employeeName || step.employeeCode || 'Không xác định');
  var sub = step.tier==='final' ? 'Duyệt cuối' : 'Đồng ý';
  return '<b>'+esc(name)+'</b><small>'+esc(sub)+'</small>';
}
function gpChainCompactHtml(p){
  var chain = p.routingSnapshot || [];
  if(!chain.length) return '<span class="phfk-gp-waiting-none">—</span>';
  return '<div class="phfk-gp-chain">'+chain.map(function(step,i){
    var st = gpStepStatus(i, p.currentStepIndex, p.status);
    var label = step.tier==='final' ? 'Admin' : gpShortName(step.employeeName || step.employeeCode || '?');
    var sub = st==='current' ? (step.tier==='final'?'Chờ duyệt':'Đang chờ') : (st==='rejected'?'Từ chối':(st==='withdrawn'?'Đã rút':''));
    return '<span class="phfk-gp-chain-node is-'+st+'">'+esc(label)+(sub?'<i>'+esc(sub)+'</i>':'')+'</span>'+(i<chain.length-1?'<span class="phfk-gp-chain-arrow" aria-hidden="true">→</span>':'');
  }).join('')+'</div>';
}

function gpRow(p){
  var subjMeta = [p.subjectEmployeeCode, p.subjectTitle].filter(Boolean).join(' · ');
  var creatorMeta = [p.createdByEmployeeCode, p.createdByTitle].filter(Boolean).join(' · ');
  return '<tr><td><b>'+esc(p.subjectEmployeeName)+'</b><small>'+esc(subjMeta)+'</small></td>'+
    '<td class="phfk-gp-grade-cell">'+gpGradeLine(p.currentGradeCode,p.currentGradeNumber,p.proposedGradeCode,p.proposedGradeNumber)+'</td>'+
    '<td><b>'+esc(p.createdByName)+'</b><small>'+esc(creatorMeta)+'</small></td>'+
    '<td class="phfk-gp-chain-cell">'+gpChainCompactHtml(p)+'</td>'+
    '<td class="phfk-gp-waiting-cell">'+gpWaitingCellHtml(p)+'</td>'+
    '<td><span class="phfk-pill phfk-pill-'+esc(p.status)+'">'+esc(GP_STATUS_LABELS[p.status]||'Chưa xác định')+'</span><small>'+fmtDate(p.createdAt)+'</small></td>'+
    '<td><button type="button" class="phfk-link" data-gp-open="'+esc(p.id)+'">Xem</button></td></tr>';
}
function gpTable(list,emptyText){
  if(!list||!list.length) return '<section class="phfk-empty"><p>'+esc(emptyText)+'</p></section>';
  return '<div class="phfk-table-wrap"><table class="phfk-table phfk-gp-table"><thead><tr><th>Nhân sự</th><th>Bậc</th><th>Người đề xuất</th><th>Tiến trình</th><th>Đang chờ</th><th>Trạng thái</th><th></th></tr></thead><tbody>'+list.map(gpRow).join('')+'</tbody></table></div>';
}

/* loading > loadError > list rỗng thật — 3 trạng thái KHÔNG được lẫn vào
 * nhau (mục "loaded-empty thật" vs "API error" vs "chưa fetch xong" trong
 * báo cáo bug). loading ưu tiên cao nhất vì loadError của lần fetch TRƯỚC có
 * thể còn treo trong lúc đang fetch lại. */
function gpDatasetBodyHtml(loading,loadError,list,emptyText){
  if(loading) return '<div class="phfk-loading">Đang tải…</div>';
  if(loadError) return '<p class="phfk-error">'+esc(loadError)+'</p>';
  return gpTable(list,emptyText);
}
function gpListBodyHtml(capabilities,isAdmin){
  var head = gpNav(gpState.view,capabilities,isAdmin);
  var msg = (gpState.message?'<p class="phfk-success">'+esc(gpState.message)+'</p>':'')+(gpState.error?'<p class="phfk-error">'+esc(gpState.error)+'</p>':'');
  if(gpState.view==='mine') return head+msg+gpDatasetBodyHtml(gpState.mineLoading,gpState.mineLoadError,gpState.mine,'Bạn chưa tạo hoặc chưa là nhân sự của Đề xuất nâng bậc nào.');
  if(gpState.view==='visible'){
    var statusFilter='<div class="phfk-filters"><select class="phfk-input" data-gp-status-filter>'+['','pending','approved','rejected','withdrawn'].map(function(s){return '<option value="'+s+'"'+(gpState.visibleStatus===s?' selected':'')+'>'+(s?esc(GP_STATUS_LABELS[s]):'Tất cả trạng thái')+'</option>';}).join('')+'</select></div>';
    return head+statusFilter+msg+gpDatasetBodyHtml(gpState.visibleLoading,gpState.visibleLoadError,gpState.visible,'Chưa có Đề xuất nâng bậc nào trong phạm vi xem của bạn.');
  }
  if(gpState.view==='create') return head+msg+gpCreateFormHtml();
  return head+msg+gpDatasetBodyHtml(gpState.awaitingLoading,gpState.awaitingLoadError,gpState.awaiting,'Hiện không có Đề xuất nâng bậc nào cần bạn xử lý.');
}

function gpNormalizeSearch(v){
  return String(v==null?'':v).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');
}
function gpFilterDirectory(list,query,excludeCode){
  var q=gpNormalizeSearch(query);
  if(!q)return [];
  return (list||[]).filter(function(p){
    if(excludeCode && p.employeeCode===excludeCode)return false;
    return gpNormalizeSearch(p.employeeName+' '+p.employeeCode).indexOf(q)>=0;
  }).slice(0,8);
}
function gpPersonMetaLine(p){
  return [p.title,p.department,p.branch].filter(Boolean).map(esc).join(' · ');
}

/* 01 — Nhân sự được đề xuất: searchable picker trên đúng listKnlPeople đã
 * fetch (peopleScope), không free text. */
function gpEmployeePickerHtml(){
  var c=gpState.create;
  var body;
  if(c.employeeSelected){
    var p=c.employeeSelected;
    body='<div class="phfk-gp-selected-person"><div><b>'+esc(p.employeeName)+'</b><small>'+esc(p.employeeCode)+(gpPersonMetaLine(p)?' · '+gpPersonMetaLine(p):'')+'</small></div>'+
      '<button type="button" class="phfk-link" data-gp-employee-clear>Đổi nhân sự</button></div>';
  }else{
    var results=gpFilterDirectory(c.pool,c.employeeQuery);
    body='<div class="phfk-gp-combobox">'+
      '<input type="text" class="phfk-input" placeholder="Tìm theo họ tên hoặc mã nhân viên…" value="'+esc(c.employeeQuery)+'" data-gp-employee-search autocomplete="off">'+
      (c.poolLoading?'<p class="phfk-batch-note">Đang tải danh sách nhân sự…</p>':'')+
      (c.poolError?'<p class="phfk-error">'+esc(c.poolError)+'</p>':'')+
      (c.employeeQuery&&results.length?'<div class="phfk-gp-suggestions">'+results.map(function(p){
        return '<button type="button" class="phfk-gp-suggestion" data-gp-employee-pick="'+esc(p.employeeCode)+'"><b>'+esc(p.employeeName)+'</b><small>'+esc(p.employeeCode)+(gpPersonMetaLine(p)?' · '+gpPersonMetaLine(p):'')+'</small></button>';
      }).join('')+'</div>':'')+
      (c.employeeQuery&&!results.length&&!c.poolLoading?'<p class="phfk-empty">Không tìm thấy nhân sự phù hợp trong phạm vi bạn được phép đề xuất.</p>':'')+
      '</div>';
  }
  return '<div class="phfk-gp-block"><div class="phfk-gp-block-head"><span class="phfk-gp-step">01</span><h3>Nhân sự được đề xuất</h3></div>'+body+'</div>';
}

/* 02 — Bậc hiện tại → Bậc đề xuất: card so sánh, chip chọn bậc (input radio
 * ẩn giữ semantic/keyboard, style qua :has(input:checked) — cùng pattern đã
 * dùng ở .phfk-suit-options). KHÔNG đổi thuật toán lấy grade (vẫn
 * getKnlGradeOptionsForSubject / tối đa 4 bậc kế tiếp), KHÔNG đổi value
 * submit (vẫn g.id). */
function gpGradeBlockHtml(){
  var c=gpState.create;
  if(!c.employeeSelected)return '';
  var head='<div class="phfk-gp-block-head"><span class="phfk-gp-step">02</span><h3>Bậc hiện tại → Bậc đề xuất</h3></div>';
  if(c.gradeLoading)return '<div class="phfk-gp-block">'+head+'<p class="phfk-loading">Đang tải bậc hiện tại…</p></div>';
  var opts=c.gradeOptions;
  if(!opts)return '';
  if(opts.hasBaseline===false){
    var msg=opts.reason==='probation'?'Nhân sự đang trong thời gian thử việc, chưa thiết lập bậc hiện tại — chưa thể tạo đề xuất.':'Chưa thiết lập bậc hiện tại cho nhân sự này — chưa thể tạo đề xuất.';
    return '<div class="phfk-gp-block">'+head+'<p class="phfk-error">'+esc(msg)+'</p></div>';
  }
  var cards=(opts.nextGrades||[]).map(function(g){
    return '<label class="phfk-gp-grade-card"><input type="radio" name="proposedGradeId" value="'+esc(g.id)+'" class="phfk-sr-only" data-gp-grade-radio'+(c.gradeSelectedId===g.id?' checked':'')+'><span>'+esc(g.gradeCode)+'</span></label>';
  }).join('');
  return '<div class="phfk-gp-block">'+head+
    '<div class="phfk-gp-grade-flow">'+
      '<div class="phfk-gp-grade-current"><small>BẬC HIỆN TẠI</small><b>'+esc(opts.currentGradeCode)+'</b></div>'+
      '<div class="phfk-gp-grade-arrow" aria-hidden="true">→</div>'+
      '<div class="phfk-gp-grade-target"><small>BẬC ĐỀ XUẤT</small>'+((opts.nextGrades||[]).length?'<div class="phfk-gp-grade-cards">'+cards+'</div>':'<p class="phfk-error">Không còn bậc kế tiếp hợp lệ trong ladder.</p>')+'</div>'+
    '</div></div>';
}

/* 03 — Đánh giá theo tiêu chí bậc đề xuất (Phase 2, Assessment V1): hệ thống
 * kéo đúng tiêu chí/chuẩn của bậc đề xuất qua getKnlGradePromotionCriteriaStandard
 * (bridge compensation grade_code -> competency knl_grade_definitions, xem
 * lib/knl-competency.js:resolveCompetencyStandardForGradeCode). Người khởi
 * tạo đánh giá GỌN Đạt/Chưa đạt + ghi chú (bắt buộc khi Chưa đạt) từng tiêu
 * chí — KHÔNG cho gửi khi chưa đánh giá đủ (xem gpCreateCanSubmit()). Không
 * resolve được mapping / bậc chưa có tiêu chí nào -> BLOCK hẳn (không có
 * checklist để render), đúng business decision đã chốt "không cho proposal
 * rỗng". */
function gpCriteriaBlockHtml(){
  var c=gpState.create;
  if(!c.gradeSelectedId)return '';
  var head='<div class="phfk-gp-block-head"><span class="phfk-gp-step">03</span><h3>Đánh giá theo tiêu chí bậc đề xuất</h3></div>';
  if(c.criteriaLoading)return '<div class="phfk-gp-block">'+head+'<p class="phfk-loading">Đang tải tiêu chí…</p></div>';
  if(c.criteriaError)return '<div class="phfk-gp-block">'+head+'<p class="phfk-error">'+esc(c.criteriaError)+'</p></div>';
  var std=c.criteriaStandard;
  if(!std)return '';
  var groupsHtml=(std.groups||[]).map(function(g){
    var itemsHtml=(g.items||[]).map(function(it){
      var a=c.assessment[it.id]||{result:'',note:''};
      return '<div class="phfk-gp-criteria-item">'+
        '<div class="phfk-gp-criteria-item-head"><b>'+esc(it.name)+'</b>'+(it.requiredColumnLabel?'<small>Yêu cầu: '+esc(it.requiredColumnLabel)+'</small>':'')+'</div>'+
        (it.content?'<p class="phfk-gp-criteria-content">'+esc(it.content)+'</p>':'')+
        '<div class="phfk-gp-criteria-toggle" role="group">'+
          '<label class="'+(a.result==='met'?'is-active':'')+'"><input type="radio" name="gp-criteria-result-'+esc(it.id)+'" value="met" class="phfk-sr-only" data-gp-criteria-result="'+esc(it.id)+'"'+(a.result==='met'?' checked':'')+'>Đạt</label>'+
          '<label class="'+(a.result==='not_met'?'is-active':'')+'"><input type="radio" name="gp-criteria-result-'+esc(it.id)+'" value="not_met" class="phfk-sr-only" data-gp-criteria-result="'+esc(it.id)+'"'+(a.result==='not_met'?' checked':'')+'>Chưa đạt</label>'+
        '</div>'+
        (a.result==='not_met'
          ?'<textarea class="phfk-input phfk-gp-criteria-note" placeholder="Ghi chú/minh chứng (bắt buộc khi Chưa đạt)…" data-gp-criteria-note="'+esc(it.id)+'">'+esc(a.note)+'</textarea>'
          :'<input type="text" class="phfk-input phfk-gp-criteria-note" placeholder="Ghi chú/minh chứng (không bắt buộc)…" data-gp-criteria-note="'+esc(it.id)+'" value="'+esc(a.note)+'">')+
        '</div>';
    }).join('');
    return '<div class="phfk-gp-criteria-group"><h4>'+esc(g.name)+'</h4>'+itemsHtml+'</div>';
  }).join('');
  return '<div class="phfk-gp-block">'+head+'<p class="phfk-gp-hint">Khung: '+esc(std.framework?std.framework.name:'')+' · Bậc: '+esc(std.gradeCode)+'</p>'+groupsHtml+'</div>';
}

/* 04 — Người nhận xử lý: CHỈ render khi backend báo required=true (đúng điều
 * kiện cũ "thuộc Bán hàng và bản thân không phải Trưởng ca"). Picker chỉ từ
 * approverOptions.approvers (getKnlGradePromotionApproverOptions) — không
 * free text, không thể gõ mã tuỳ ý. */
function gpApproverBlockHtml(){
  var c=gpState.create;
  if(!c.employeeSelected||!c.gradeOptions||c.gradeOptions.hasBaseline!==true)return '';
  var head='<div class="phfk-gp-block-head"><span class="phfk-gp-step">04</span><h3>Người nhận xử lý</h3></div>';
  if(c.approverLoading)return '<div class="phfk-gp-block">'+head+'<p class="phfk-loading">Đang kiểm tra người nhận xử lý…</p></div>';
  var ao=c.approverOptions;
  if(!ao||ao.required!==true)return '';
  if(ao.configured===false){
    return '<div class="phfk-gp-block">'+head+'<p class="phfk-error">Chưa có Trưởng ca Bán hàng nào được Admin cấp quyền xử lý Đề xuất nâng bậc. Vui lòng liên hệ Admin cấu hình quyền trước khi tạo đề xuất.</p></div>';
  }
  var selected=c.approverSelectedCode&&(ao.approvers||[]).find(function(a){return a.employeeCode===c.approverSelectedCode;});
  var body;
  if(selected){
    body='<div class="phfk-gp-selected-person"><div><b>'+esc(selected.employeeName)+'</b><small>'+esc(selected.employeeCode)+(gpPersonMetaLine(selected)?' · '+gpPersonMetaLine(selected):'')+'</small></div>'+
      '<button type="button" class="phfk-link" data-gp-approver-clear>Đổi người nhận</button></div>';
  }else{
    var list=c.approverQuery?gpFilterDirectory(ao.approvers,c.approverQuery):(ao.approvers||[]);
    body='<div class="phfk-gp-combobox">'+
      '<input type="text" class="phfk-input" placeholder="Tìm Trưởng ca theo tên hoặc mã…" value="'+esc(c.approverQuery)+'" data-gp-approver-search autocomplete="off">'+
      '<div class="phfk-gp-suggestions is-static">'+(list.length?list.map(function(a){
        return '<button type="button" class="phfk-gp-suggestion" data-gp-approver-pick="'+esc(a.employeeCode)+'"><b>'+esc(a.employeeName)+'</b><small>'+esc(a.employeeCode)+(gpPersonMetaLine(a)?' · '+gpPersonMetaLine(a):'')+'</small></button>';
      }).join(''):'<p class="phfk-empty">Không tìm thấy Trưởng ca phù hợp.</p>')+'</div>'+
      '</div>';
  }
  return '<div class="phfk-gp-block">'+head+'<p class="phfk-gp-hint">Bắt buộc — nhân sự thuộc Bán hàng và bản thân bạn không phải Trưởng ca.</p>'+body+'</div>';
}

/* 05 — Lý do đề xuất: textarea, chỉ thêm helper text hướng dẫn nhập liệu
 * (không tự sinh nội dung), giữ nguyên validation backend (min 5 ký tự). */
function gpReasonBlockHtml(){
  var c=gpState.create;
  if(!c.employeeSelected)return '';
  return '<div class="phfk-gp-block"><div class="phfk-gp-block-head"><span class="phfk-gp-step">05</span><h3>Lý do đề xuất</h3></div>'+
    '<p class="phfk-gp-hint">Nêu kết quả công việc, sự phát triển năng lực, trách nhiệm hoặc căn cứ cho đề xuất nâng bậc.</p>'+
    '<textarea class="phfk-input phfk-gp-reason" data-gp-reason placeholder="Nhập lý do đề xuất…" minlength="5">'+esc(c.reason)+'</textarea>'+
    '</div>';
}

function gpCriteriaFlatItems(c){
  var items=[]; (c.criteriaStandard&&c.criteriaStandard.groups||[]).forEach(function(g){items=items.concat(g.items||[]);});
  return items;
}
function gpCreateCanSubmit(){
  var c=gpState.create;
  if(!c.employeeSelected)return false;
  if(!c.gradeOptions||c.gradeOptions.hasBaseline!==true)return false;
  if(!c.gradeSelectedId)return false;
  if(!c.criteriaStandard)return false; // chưa resolve được mapping tiêu chí -> không cho gửi (BLOCK)
  var items=gpCriteriaFlatItems(c);
  if(!items.length)return false;
  for(var i=0;i<items.length;i++){
    var a=c.assessment[items[i].id];
    if(!a||!a.result)return false;
    if(a.result==='not_met'&&String(a.note||'').trim().length<3)return false;
  }
  if(String(c.reason||'').trim().length<5)return false;
  if(c.approverOptions&&c.approverOptions.required===true){
    if(c.approverOptions.configured===false)return false;
    if(!c.approverSelectedCode)return false;
  }
  return true;
}

/* Tóm tắt đề xuất — chỉ render từ dữ liệu đã chọn thật, không invent
 * workflow status nào (không hiện "Đang chờ xử lý"/step gì — proposal
 * chưa tồn tại tới khi submit thành công). */
function gpSummaryBlockHtml(){
  var c=gpState.create;
  if(!c.employeeSelected||!c.gradeOptions||c.gradeOptions.hasBaseline!==true||!c.gradeSelectedId)return '';
  var grade=(c.gradeOptions.nextGrades||[]).find(function(g){return g.id===c.gradeSelectedId;});
  if(!grade)return '';
  var receiverLine='';
  if(c.approverOptions&&c.approverOptions.required===true){
    var sel=c.approverSelectedCode&&(c.approverOptions.approvers||[]).find(function(a){return a.employeeCode===c.approverSelectedCode;});
    receiverLine='<p>Người nhận xử lý: <b>'+(sel?esc(sel.employeeName)+' ('+esc(sel.employeeCode)+')':'<span class="phfk-error">Chưa chọn</span>')+'</b></p>';
  }
  return '<div class="phfk-gp-summary"><small>TÓM TẮT ĐỀ XUẤT</small>'+
    '<p>'+esc(c.employeeSelected.employeeName)+' · '+esc(c.employeeSelected.employeeCode)+'</p>'+
    '<p class="phfk-gp-summary-grade">'+esc(c.gradeOptions.currentGradeCode)+' → <b>'+esc(grade.gradeCode)+'</b></p>'+
    receiverLine+
    '</div>';
}

function gpCreateFormHtml(){
  var c=gpState.create;
  return '<form class="phfk-panel phfk-gp-create-form" data-gp-create-form>'+
    gpEmployeePickerHtml()+
    gpGradeBlockHtml()+
    gpCriteriaBlockHtml()+
    gpApproverBlockHtml()+
    gpReasonBlockHtml()+
    gpSummaryBlockHtml()+
    (c.error?'<p class="phfk-error">'+esc(c.error)+'</p>':'')+
    '<div class="phfk-form-actions"><button type="submit" class="phfk-btn-primary"'+(gpCreateCanSubmit()?'':' disabled')+(c.submitting?' disabled':'')+'>'+(c.submitting?'Đang tạo…':'Tạo đề xuất')+'</button></div>'+
    '</form>';
}

/* Danh tính hiển thị (mục 3 batch visual cleanup): employeeCode CHUẨN
 * (PHFxxx) giờ được BACKEND resolve sẵn từ user_accounts.employee_code
 * (getGradePromotionProposalDetail()/listVisibleGradePromotionProposals(),
 * lib/knl-grade-proposals.js) — createdByEmployeeCode/step.actorEmployeeCode
 * nhận được ở đây LUÔN là mã chuẩn hoặc rỗng, KHÔNG BAO GIỜ còn là internal
 * id (HV-xxx/emp-xxx) như trước batch này. Frontend vì vậy KHÔNG cần tự
 * validate/lọc bằng regex nữa — chỉ render thẳng, rỗng thì không hiện gì
 * (không tự bịa fallback). */
function gpDetailHtml(){
  var d = gpState.detail; if(!d) return '';
  var p = d.proposal;
  var subjectMeta = [p.subjectEmployeeCode].filter(Boolean).join(' · ');
  var creatorMeta = [p.createdByName, p.createdByEmployeeCode].filter(Boolean).join(' · ') || '—';
  var head = '<button type="button" class="phfk-link phfk-gp-back" data-gp-back>← Quay lại</button>'+
    '<section class="phfk-panel phfk-gp-detail-head">'+
    '<span class="phfk-pill phfk-pill-'+esc(p.status)+'">'+esc(GP_STATUS_LABELS[p.status]||'Chưa xác định')+'</span>'+
    '<h1 class="phfk-gp-detail-title">'+esc(p.subjectEmployeeName)+' <small>'+esc(subjectMeta)+'</small></h1>'+
    '<div class="phfk-gp-detail-grade">'+esc(p.currentGradeCode||'—')+' <span aria-hidden="true">→</span> <b>'+esc(p.proposedGradeCode||'—')+'</b></div>'+
    '<dl class="phfk-gp-detail-meta">'+
      '<div><dt>Người đề xuất</dt><dd>'+esc(creatorMeta)+'</dd></div>'+
      '<div><dt>Ngày tạo</dt><dd>'+fmtDate(p.createdAt)+'</dd></div>'+
    '</dl>'+
    (p.reason?'<p class="phfk-gp-detail-reason"><b>Lý do:</b> '+esc(p.reason)+'</p>':'')+
    (p.status==='approved'?'<p class="phfk-success">Admin đã chấp thuận, bậc chốt cuối: <b>'+esc(p.finalDecidedGradeCode)+'</b> ('+esc(p.finalDecidedByName)+', '+fmtDate(p.finalDecidedAt)+')</p>':'')+
    (p.status==='rejected'?'<p class="phfk-error">Không đồng ý bởi '+esc(p.rejectedByName)+' — '+esc(p.rejectedReason)+' ('+fmtDate(p.rejectedAt)+')</p>':'')+
    (p.status==='withdrawn'?'<p class="phfk-gp-detail-note">Đã rút bởi người tạo — '+esc(p.withdrawnReason)+' ('+fmtDate(p.withdrawnAt)+')</p>':'')+
    '</section>';

  var workflowOverview = gpWorkflowOverviewHtml(d);
  var criteriaSnapshotBlock = gpCriteriaSnapshotHtml(d.criteriaSnapshot);

  var steps = d.steps||[];
  var historyOpen = steps.length<=3;
  var history = '<details class="phfk-panel phfk-gp-history"'+(historyOpen?' open':'')+'><summary>Lịch sử xử lý</summary><ol class="phfk-gp-timeline">'+steps.map(function(s){
    var line = esc(GP_ACTION_LABELS[s.action]||s.action);
    if(s.action==='reassign') line += ' — chuyển từ '+esc(s.reassignedFromEmployeeCode)+' sang '+esc(s.reassignedToEmployeeCode);
    else if(s.actorName) line += ' bởi '+esc(s.actorName)+(s.actorEmployeeCode?' ('+esc(s.actorEmployeeCode)+')':'');
    if(s.suggestedGradeCode) line += ' · bậc kiến nghị: '+esc(s.suggestedGradeCode);
    if(s.reason) line += ' · '+esc(s.reason);
    return '<li>'+line+'<small>'+fmtDate(s.actedAt)+'</small></li>';
  }).join('')+'</ol></details>';

  var actions = '';
  if(p.status==='pending' && d.isMyTurn){
    var eligible = (gpState.detailGradeOptions||[]).filter(function(g){return g.gradeNumber<=p.proposedGradeNumber;});
    var busy = gpState.detailActionBusy===true;
    actions = '<section class="phfk-panel phfk-gp-decision"><h2>Quyết định của bạn</h2>'+
      '<form data-gp-agree-form class="phfk-gp-decision-agree"><label class="phfk-field"><span>Bậc kiến nghị (phải > bậc hiện tại, không vượt quá bậc đề xuất ban đầu)</span><select class="phfk-input" name="suggestedGradeId" required'+(busy?' disabled':'')+'>'+
      eligible.map(function(g){return '<option value="'+esc(g.id)+'"'+(g.gradeCode===p.proposedGradeCode?' selected':'')+'>'+esc(g.gradeCode)+'</option>';}).join('')+
      '</select></label><label class="phfk-field"><span>Ghi chú (không bắt buộc)</span><textarea class="phfk-input" name="note"'+(busy?' disabled':'')+'></textarea></label>'+
      '<div class="phfk-form-actions"><button type="submit" class="phfk-btn-primary"'+(busy?' disabled':'')+'>'+(busy?'Đang xử lý…':'Đồng ý')+'</button></div></form>'+
      '<details class="phfk-gp-decision-reject"><summary class="phfk-btn-ghost-danger">Không đồng ý</summary>'+
      '<form data-gp-reject-form><label class="phfk-field"><span>Lý do không đồng ý</span><textarea class="phfk-input" name="reason" minlength="5" required'+(busy?' disabled':'')+'></textarea></label>'+
      '<div class="phfk-form-actions"><button type="submit" class="phfk-btn-secondary"'+(busy?' disabled':'')+'>'+(busy?'Đang xử lý…':'Xác nhận không đồng ý')+'</button></div></form></details>'+
      '</section>';
  }
  var withdrawBlock = '';
  if(p.status==='pending' && p.createdBy && currentUser() && (currentUser().id===p.createdBy || currentUser().accountId===p.createdBy)){
    var wBusy = gpState.detailActionBusy===true;
    withdrawBlock = '<details class="phfk-gp-withdraw"><summary>Rút đề xuất</summary>'+
      '<form data-gp-withdraw-form><label class="phfk-field"><span>Lý do rút đề xuất</span><textarea class="phfk-input" name="reason" minlength="5" required'+(wBusy?' disabled':'')+'></textarea></label>'+
      '<div class="phfk-form-actions"><button type="submit" class="phfk-btn-secondary"'+(wBusy?' disabled':'')+'>'+(wBusy?'Đang xử lý…':'Xác nhận rút đề xuất')+'</button></div></form></details>';
  }
  return '<div class="phfk-gp-detail">'+head+(gpState.error?'<p class="phfk-error">'+esc(gpState.error)+'</p>':'')+(gpState.message?'<p class="phfk-success">'+esc(gpState.message)+'</p>':'')+criteriaSnapshotBlock+workflowOverview+history+actions+withdrawBlock+'</div>';
}

/* Snapshot Đánh giá theo tiêu chí — READ-ONLY, người duyệt/thẩm định xem lại
 * ĐÚNG bảng người tạo đã đánh giá lúc gửi (business decision: agree/approve
 * CHỈ xem, không sửa — không có form nào ở đây). d.criteriaSnapshot đến từ
 * getKnlGradePromotionProposalDetail() (lib/knl-grade-proposals.js), null nếu
 * proposal cũ (tạo trước batch này, chưa có snapshot) hoặc chưa apply migration. */
function gpCriteriaSnapshotHtml(snapshot){
  if(!snapshot||!Array.isArray(snapshot.groups)||!snapshot.groups.length)return '';
  var groupsHtml=snapshot.groups.map(function(g){
    var itemsHtml=(g.items||[]).map(function(it){
      var resLabel = it.result==='met' ? 'Đạt' : (it.result==='not_met' ? 'Chưa đạt' : '—');
      var pillClass = it.result==='met' ? 'phfk-pill-approved' : 'phfk-pill-rejected';
      return '<div class="phfk-gp-criteria-item is-readonly"><div class="phfk-gp-criteria-item-head"><b>'+esc(it.name)+'</b><span class="phfk-pill '+pillClass+'">'+esc(resLabel)+'</span></div>'+
        (it.note?'<p class="phfk-gp-criteria-note-view">'+esc(it.note)+'</p>':'')+'</div>';
    }).join('');
    return '<div class="phfk-gp-criteria-group"><h4>'+esc(g.name)+'</h4>'+itemsHtml+'</div>';
  }).join('');
  return '<section class="phfk-panel phfk-gp-criteria-snapshot"><h2>Đánh giá theo tiêu chí ('+esc(snapshot.gradeCode||'')+')</h2>'+groupsHtml+'</section>';
}

/* "TIẾN TRÌNH XỬ LÝ" (mục 7 batch giám sát Admin) — tách biệt hoàn toàn khỏi
 * Timeline audit bên dưới: đây là "proposal đang ở đâu" (workflow overview,
 * render từ liveChain [live re-resolve, ĐÚNG cùng nguồn isMyTurn đã dùng] +
 * currentStepIndex + status), Timeline là "đã xảy ra sự kiện gì" (steps audit
 * append-only, giữ nguyên không đổi). d.liveChain lấy từ
 * getGradePromotionProposalDetail() (lib/knl-grade-proposals.js) — có thể
 * rỗng nếu chain không resolve được (vd subject rời Organization Master),
 * khi đó fallback về routing_snapshot đã persist thay vì ẩn hẳn block. Tên
 * người "đã xử lý" ưu tiên đọc từ steps thật (agree/approve theo đúng thứ tự
 * — mỗi vị trí chain tương ứng đúng 1 step agree/approve, kể cả khi có
 * reassign xen giữa) thay vì suy từ liveChain, để không hiển thị sai người
 * trong case route bị đổi (mục 7 batch 2 — broken-route reassign). */
function gpCompletedActors(steps){
  return (steps||[]).filter(function(s){return s.action==='agree'||s.action==='approve';});
}
function gpWorkflowOverviewHtml(d){
  var p = d.proposal;
  var chain = (d.liveChain && d.liveChain.length) ? d.liveChain : (p.routingSnapshot||[]);
  if(!chain.length) return '';
  var doneActors = gpCompletedActors(d.steps);
  var icons = {done:'✓',current:'●',future:'○',rejected:'✕',withdrawn:'–'};
  var rows = chain.map(function(step,i){
    var st = gpStepStatus(i, p.currentStepIndex, p.status);
    var name = step.tier==='final' ? 'Admin' : (step.employeeName || step.employeeCode || 'Không xác định');
    var sub;
    if(st==='done'){
      var doer = doneActors[i];
      if(doer && doer.actorName) name = doer.actorName;
      sub = step.tier==='final' ? 'Đã duyệt' : 'Đã đồng ý';
    }else if(st==='current'){
      sub = step.tier==='final' ? 'Đang chờ Duyệt' : 'Đang chờ đồng ý';
    }else if(st==='rejected'){
      name = p.rejectedByName || name;
      sub = 'Không đồng ý'+(p.rejectedReason?' — '+p.rejectedReason:'');
    }else if(st==='withdrawn'){
      sub = 'Đã rút trước khi xử lý';
    }else{
      sub = step.tier==='final' ? 'Chưa tới lượt · Duyệt cuối' : 'Chưa tới lượt';
    }
    return '<li class="phfk-gp-wf-node is-'+st+'"><span class="phfk-gp-wf-icon" aria-hidden="true">'+(icons[st]||'○')+'</span><div><b>'+esc(name)+'</b><small>'+esc(sub)+'</small></div></li>';
  }).join('');
  return '<section class="phfk-panel"><h2>Tiến trình xử lý</h2><ol class="phfk-gp-workflow">'+rows+'</ol></section>';
}

function renderGpBody(root){
  var body = root.querySelector('[data-knl-body]'); if(!body) return;
  if(gpState.detail){ body.innerHTML = gpDetailHtml(); bindGpDetail(root); return; }
  body.innerHTML = gpListBodyHtml(gpState.lastCapabilities||{}, gpState.lastIsAdmin===true);
  bindGpNav(root);
  bindGpList(root);
}

function bindGpList(root){
  root.querySelectorAll('[data-gp-open]').forEach(function(b){b.onclick=function(){openGpDetail(root,b.getAttribute('data-gp-open'));};});
  var statusFilter = root.querySelector('[data-gp-status-filter]');
  if(statusFilter) statusFilter.onchange=function(){gpState.visibleStatus=statusFilter.value;loadGpVisible(root);};
  if(gpState.view==='create') bindGpCreateForm(root);
}

/* Giữ focus/con trỏ khi re-render do gõ tìm kiếm (employee/approver combobox)
 * — innerHTML replace toàn bộ form nên phải tự khôi phục, tránh mất focus
 * giữa chừng khi gõ (UX combobox cơ bản). */
function gpRerenderPreserveFocus(root){
  var active=document.activeElement,marker=null,selStart=null,selEnd=null;
  if(active&&active.hasAttribute){
    ['data-gp-employee-search','data-gp-approver-search'].forEach(function(attr){ if(active.hasAttribute(attr))marker=attr; });
    if(marker&&typeof active.selectionStart==='number'){selStart=active.selectionStart;selEnd=active.selectionEnd;}
  }
  renderGpBody(root);
  if(marker){
    var el=root.querySelector('['+marker+']');
    if(el){ el.focus(); if(selStart!=null&&el.setSelectionRange){ try{ el.setSelectionRange(selStart,selEnd); }catch(e){} } }
  }
}

async function loadGpCreatePool(root){
  var c=gpState.create;
  if(c.poolLoaded||c.poolLoading)return;
  c.poolLoading=true;
  try{ c.pool=(await apiPost('listKnlPeople',{status:'active'})).people||[]; c.poolError=''; }
  catch(e){ c.pool=[]; c.poolError=e.message; }
  c.poolLoading=false; c.poolLoaded=true;
  renderGpBody(root);
}

async function loadGpGradeAndApproverOptions(root,employeeCode){
  var c=gpState.create;
  c.gradeLoading=true; c.error='';
  renderGpBody(root);
  try{ c.gradeOptions=await apiPost('getKnlGradeOptionsForSubject',{employeeCode:employeeCode}); }
  catch(e){ c.error=e.message; c.gradeOptions=null; }
  c.gradeLoading=false;
  renderGpBody(root);
  if(c.gradeOptions&&c.gradeOptions.hasBaseline===true){
    c.approverLoading=true;
    renderGpBody(root);
    try{ c.approverOptions=await apiPost('getKnlGradePromotionApproverOptions',{employeeCode:employeeCode}); }
    catch(e){ c.approverOptions=null; }
    c.approverLoading=false;
    renderGpBody(root);
  }
}

async function loadGpCriteriaStandard(root,employeeCode,gradeId){
  var c=gpState.create;
  c.criteriaLoading=true; c.criteriaError=''; c.criteriaStandard=null;
  renderGpBody(root);
  try{
    var res=await apiPost('getKnlGradePromotionCriteriaStandard',{employeeCode:employeeCode,proposedGradeId:gradeId});
    if(res.mapped===true){
      c.criteriaStandard=res;
      var assessment={};
      (res.groups||[]).forEach(function(g){(g.items||[]).forEach(function(it){assessment[it.id]={result:'',note:''};});});
      c.assessment=assessment;
    }else{
      c.criteriaError=GP_CRITERIA_MAPPING_ERROR_LABELS[res.reason]||'Không thể xác định tiêu chí năng lực cho bậc đề xuất.';
    }
  }catch(e){ c.criteriaError=e.message; }
  c.criteriaLoading=false;
  renderGpBody(root);
}

function bindGpCreateForm(root){
  var form=root.querySelector('[data-gp-create-form]');
  if(!form)return;
  var c=gpState.create;

  var empSearch=form.querySelector('[data-gp-employee-search]');
  if(empSearch)empSearch.addEventListener('input',function(){c.employeeQuery=empSearch.value;gpRerenderPreserveFocus(root);});
  form.querySelectorAll('[data-gp-employee-pick]').forEach(function(btn){btn.addEventListener('click',function(){
    var pickedCode=btn.getAttribute('data-gp-employee-pick');
    var person=(c.pool||[]).find(function(p){return p.employeeCode===pickedCode;});
    if(!person)return;
    c.employeeSelected=person; c.employeeQuery=''; c.gradeOptions=null; c.gradeSelectedId=''; c.criteriaStandard=null; c.criteriaError=''; c.assessment={}; c.approverOptions=null; c.approverSelectedCode=''; c.approverQuery=''; c.error='';
    renderGpBody(root);
    loadGpGradeAndApproverOptions(root,person.employeeCode);
  });});
  var empClear=form.querySelector('[data-gp-employee-clear]');
  if(empClear)empClear.addEventListener('click',function(){
    c.employeeSelected=null; c.employeeQuery=''; c.gradeOptions=null; c.gradeSelectedId=''; c.criteriaStandard=null; c.criteriaError=''; c.assessment={}; c.approverOptions=null; c.approverSelectedCode=''; c.approverQuery=''; c.error='';
    renderGpBody(root);
  });

  form.querySelectorAll('[data-gp-grade-radio]').forEach(function(radio){radio.addEventListener('change',function(){
    c.gradeSelectedId=radio.value; c.criteriaStandard=null; c.criteriaError=''; c.assessment={};
    renderGpBody(root);
    if(c.gradeSelectedId) loadGpCriteriaStandard(root, c.employeeSelected.employeeCode, c.gradeSelectedId);
  });});
  form.querySelectorAll('[data-gp-criteria-result]').forEach(function(radio){radio.addEventListener('change',function(){
    var id=radio.getAttribute('data-gp-criteria-result');
    if(!c.assessment[id])c.assessment[id]={result:'',note:''};
    c.assessment[id].result=radio.value;
    renderGpBody(root);
  });});
  form.querySelectorAll('[data-gp-criteria-note]').forEach(function(input){input.addEventListener('input',function(){
    var id=input.getAttribute('data-gp-criteria-note');
    if(!c.assessment[id])c.assessment[id]={result:'',note:''};
    c.assessment[id].note=input.value;
    if(submitBtn)submitBtn.disabled=!gpCreateCanSubmit();
  });});

  var apprSearch=form.querySelector('[data-gp-approver-search]');
  if(apprSearch)apprSearch.addEventListener('input',function(){c.approverQuery=apprSearch.value;gpRerenderPreserveFocus(root);});
  form.querySelectorAll('[data-gp-approver-pick]').forEach(function(btn){btn.addEventListener('click',function(){
    c.approverSelectedCode=btn.getAttribute('data-gp-approver-pick'); c.approverQuery=''; renderGpBody(root);
  });});
  var apprClear=form.querySelector('[data-gp-approver-clear]');
  if(apprClear)apprClear.addEventListener('click',function(){ c.approverSelectedCode=''; renderGpBody(root); });

  var reasonEl=form.querySelector('[data-gp-reason]');
  var submitBtn=form.querySelector('button[type="submit"]');
  if(reasonEl)reasonEl.addEventListener('input',function(){
    c.reason=reasonEl.value;
    if(submitBtn)submitBtn.disabled=!gpCreateCanSubmit();
  });

  form.addEventListener('submit',async function(ev){
    ev.preventDefault();
    if(!gpCreateCanSubmit())return;
    c.submitting=true; c.error='';
    if(submitBtn){ submitBtn.disabled=true; submitBtn.textContent='Đang tạo…'; }
    try{
      var assessment=gpCriteriaFlatItems(c).map(function(it){
        var a=c.assessment[it.id]||{};
        return {itemId:it.id, result:a.result, note:a.note||''};
      });
      await apiPost('createKnlGradePromotionProposal',{proposal:{
        employeeCode:c.employeeSelected.employeeCode,
        reason:c.reason,
        proposedGradeId:c.gradeSelectedId,
        selectedFirstApproverEmployeeCode:c.approverSelectedCode||undefined,
        assessment:assessment
      }});
      gpState.message='Đã tạo Đề xuất nâng bậc.'; gpState.create=gpCreateInitialState(); gpState.view='mine';
      await loadGpMine(root);
    }catch(e){ c.submitting=false; c.error=e.message; renderGpBody(root); }
  });
}

/* Chống double-submit (mục 6): 1 flag DUY NHẤT gpState.detailActionBusy cho
 * cả 3 form agree/reject/withdraw (không thể chạy đồng thời > 1 hành động
 * trên CÙNG 1 proposal đang mở) — early-return nếu đã busy, và
 * gpDetailHtml() tự disable nút/field khi busy=true (đọc lại flag mỗi lần
 * render, cùng pattern c.submitting đã dùng ở form Tạo đề xuất). FormData
 * PHẢI đọc TRƯỚC khi set busy+render (render sẽ thay innerHTML, hủy chính
 * form đang submit). */
function bindGpDetail(root){
  var back = root.querySelector('[data-gp-back]');
  if(back) back.onclick=function(){
    gpState.detail=null;gpState.error='';gpState.message='';
    var u=new URL(location.href);u.searchParams.delete('proposal');history.pushState({},'',u.pathname+u.search);
    gpLoadActiveView(root); // mục 6: quay lại list phải refetch, không hiện dataset cũ trước khi vào detail
  };
  var agreeForm = root.querySelector('[data-gp-agree-form]');
  if(agreeForm) agreeForm.onsubmit=async function(ev){
    ev.preventDefault();
    if(gpState.detailActionBusy)return;
    var fd=new FormData(agreeForm);
    gpState.detailActionBusy=true; renderGpBody(root);
    try{
      await apiPost('agreeKnlGradePromotionProposal',{proposalId:gpState.detail.proposal.id,suggestedGradeId:fd.get('suggestedGradeId'),note:fd.get('note')});
      gpState.message='Đã ghi nhận xử lý.'; gpState.detailActionBusy=false;
      await openGpDetail(root,gpState.detail.proposal.id);
    }catch(e){ gpState.detailActionBusy=false; gpState.error=e.message; renderGpBody(root); }
  };
  var rejectForm = root.querySelector('[data-gp-reject-form]');
  if(rejectForm) rejectForm.onsubmit=async function(ev){
    ev.preventDefault();
    if(gpState.detailActionBusy)return;
    var fd=new FormData(rejectForm);
    gpState.detailActionBusy=true; renderGpBody(root);
    try{
      await apiPost('rejectKnlGradePromotionProposal',{proposalId:gpState.detail.proposal.id,reason:fd.get('reason')});
      gpState.message='Đã ghi nhận Không đồng ý.'; gpState.detailActionBusy=false;
      await openGpDetail(root,gpState.detail.proposal.id);
    }catch(e){ gpState.detailActionBusy=false; gpState.error=e.message; renderGpBody(root); }
  };
  var withdrawForm = root.querySelector('[data-gp-withdraw-form]');
  if(withdrawForm) withdrawForm.onsubmit=async function(ev){
    ev.preventDefault();
    if(gpState.detailActionBusy)return;
    var fd=new FormData(withdrawForm);
    gpState.detailActionBusy=true; renderGpBody(root);
    try{
      await apiPost('withdrawKnlGradePromotionProposal',{proposalId:gpState.detail.proposal.id,reason:fd.get('reason')});
      gpState.message='Đã rút đề xuất.'; gpState.detailActionBusy=false;
      await openGpDetail(root,gpState.detail.proposal.id);
    }catch(e){ gpState.detailActionBusy=false; gpState.error=e.message; renderGpBody(root); }
  };
}

async function openGpDetail(root,proposalId){
  gpState.error='';gpState.message='';gpState.detailActionBusy=false;
  var u=new URL(location.href);u.searchParams.set('proposal',proposalId);history.pushState({},'',u.pathname+u.search);
  try{
    gpState.detail = await apiPost('getKnlGradePromotionProposalDetail',{proposalId:proposalId});
    var opts = await apiPost('getKnlGradeOptionsForSubject',{employeeCode:gpState.detail.proposal.subjectEmployeeCode}).catch(function(){return null;});
    gpState.detailGradeOptions = (opts && opts.nextGrades) || [];
  }catch(e){ gpState.error=e.message; gpState.detail=null; }
  renderGpBody(root);
}

/* Guard bằng chính flag Loading (không token/request-id riêng): mỗi loader
 * ghi CHỈ vào field state của chính nó (mine/awaiting/visible tách biệt),
 * và gpListBodyHtml() luôn render theo gpState.view HIỆN TẠI + state của
 * đúng dataset đó tại thời điểm render — nên 1 request cũ resolve trễ không
 * bao giờ đè nhầm data sang tab khác đang active (mục "chuyển tab nhanh" /
 * race condition trong báo cáo bug). Nếu đã có 1 lượt đang fetch thì bỏ qua
 * lượt gọi trùng (tránh double-fetch vô nghĩa khi user bấm nhanh 2 lần). */
async function loadGpAwaiting(root){
  if(gpState.awaitingLoading)return;
  gpState.awaitingLoading=true; gpState.awaitingLoadError=''; renderGpBody(root);
  try{ gpState.awaiting=(await apiPost('listKnlGradePromotionProposalsAwaitingMyAction')).proposals||[]; gpState.awaitingLoaded=true; }
  catch(e){ gpState.awaitingLoadError=e.message; }
  gpState.awaitingLoading=false; renderGpBody(root);
}
async function loadGpMine(root){
  if(gpState.mineLoading)return;
  gpState.mineLoading=true; gpState.mineLoadError=''; renderGpBody(root);
  try{ gpState.mine=(await apiPost('listMyKnlGradePromotionProposals')).proposals||[]; gpState.mineLoaded=true; }
  catch(e){ gpState.mineLoadError=e.message; }
  gpState.mineLoading=false; renderGpBody(root);
}
async function loadGpVisible(root){
  if(gpState.visibleLoading)return;
  gpState.visibleLoading=true; gpState.visibleLoadError=''; renderGpBody(root);
  try{ gpState.visible=(await apiPost('listVisibleKnlGradePromotionProposals',{status:gpState.visibleStatus})).proposals||[]; gpState.visibleLoaded=true; }
  catch(e){ gpState.visibleLoadError=e.message; }
  gpState.visibleLoading=false; renderGpBody(root);
}

/* Dispatch loader ĐÚNG cho gpState.view hiện hành — DUY NHẤT 1 nơi quyết
 * định "view nào cần load gì", dùng chung cho cả lần mount đầu tiên
 * (renderGradePromotionSection) VÀ mỗi lần bấm tab trong bindGpNav(). Trước
 * đây bindGpNav chỉ đổi gpState.view rồi render lại — không gọi loader nào —
 * nên tab vừa bấm hiện "trống"/thông báo rỗng sai cho tới khi có 1 lượt
 * mount lại (chuyển sang màn KNL khác rồi quay lại) tình cờ gọi đúng hàm
 * này. Sửa tại đây (lifecycle dùng chung), không vá riêng theo role/tab. */
async function gpLoadActiveView(root){
  var capabilities = gpState.lastCapabilities||{}, isAdmin = gpState.lastIsAdmin===true;
  if(gpState.view==='mine') await loadGpMine(root);
  else if(gpState.view==='visible' && (isAdmin || capabilities.view_proposals)) await loadGpVisible(root);
  else if(gpState.view==='create' && (isAdmin || capabilities.propose)){ renderGpBody(root); bindGpList(root); await loadGpCreatePool(root); }
  else { gpState.view='awaiting'; await loadGpAwaiting(root); }
}

async function renderGradePromotionSection(root, capabilities, isAdmin){
  gpState.lastCapabilities = capabilities; gpState.lastIsAdmin = isAdmin;
  var proposalId = new URL(location.href).searchParams.get('proposal');
  if(proposalId){ await openGpDetail(root, proposalId); return; }
  gpState.detail = null;
  await gpLoadActiveView(root);
}

/* ===================== ENTRY ===================== */

/* ===================== TỔNG QUAN KNL =====================
   Dữ liệu chính chỉ đi qua getKnlDashboardOverview (lib/knl-dashboard.js):
   backend enforce people_scope/incomeScope, frontend chỉ trình bày payload
   được phép xem và không tự lọc/mở rộng scope. AI giữ action riêng hiện có. */
var dashboardState = { loaded:false, loadedAt:0, data:null, error:'', rangeError:'', exporting:false,
  filters:{ department:'', branch:'', title:'', knlGradeCode:'', period:'', periodFrom:'', periodTo:'', rangePreset:'', rangeChoice:'month' },
  openDept:'', compareDetailed:false, selectedFramework:'', selectedKnlDept:'', missingKnlOpen:false, matrixQuickView:null,
  ai:{ pending:false, error:'', reply:'', contextSummary:[], question:'' } };
// rangeChoice là field UI-only ('month'|'last3'|'quarter_current'|'quarter_previous'|
// 'custom'), KHÔNG gửi lên backend — dashboardRequestFilters() loại field này khỏi
// payload, giữ đúng contract Phase 1 (periodFrom/periodTo/rangePreset).
function dashboardRequestFilters(filters){
  return { department:filters.department, branch:filters.branch, title:filters.title, knlGradeCode:filters.knlGradeCode,
    period:filters.period, periodFrom:filters.periodFrom, periodTo:filters.periodTo, rangePreset:filters.rangePreset };
}
function dashMoney(v){ return v==null ? '—' : money(v); }
function dashPct(v){ return v==null ? '—' : ((v>0?'+':'')+v+'%'); }
function dashDeltaClass(v){ return v==null ? '' : (v>0 ? 'phfk-dash-delta-up' : (v<0 ? 'phfk-dash-delta-down' : 'phfk-dash-delta-flat')); }
function dashDeltaOf(current,previous){
  if(current==null||previous==null||Number(previous)===0) return {amount:null,pct:null};
  var amount=Number(current)-Number(previous);
  return {amount:amount,pct:Math.round((amount/Number(previous))*1000)/10};
}
function dashSharePct(value, total){ return total>0 && value!=null ? Math.round((Number(value)/Number(total))*1000)/10 : null; }
function dashShareText(value){ return value==null ? '—' : value.toLocaleString('vi-VN',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'; }
function dashPointText(value){ return value==null ? '—' : (value===0?'0':(value>0?'+':'')+value.toLocaleString('vi-VN',{minimumFractionDigits:1,maximumFractionDigits:1}))+' điểm %'; }
function dashDirectionalText(value,formatter){
  if(value==null)return '—';
  return (value>0?'▲ ':value<0?'▼ ':'— ')+formatter(value);
}
function dashPeriodText(value){ var parts=String(value||'').split('-');return parts.length===2?parts[1]+'/'+parts[0]:String(value||''); }

/* Batch 2B Phase 2 — range/quý control. KHÔNG tự tính business semantics ở
   frontend: last3/quarter_current/quarter_previous chỉ gửi rangePreset,
   backend (resolveRangeWindow, lib/knl-dashboard.js) mới là nguồn tính toán
   duy nhất — UI chỉ trình bày lại kết quả (rangeStart/rangeEnd/snapshotPeriod/
   comparisonBase/periodCoverage) trả về trong meta. Danh sách tháng cho 2
   dropdown "Tùy chỉnh" dùng meta.generatedAt (đồng hồ SERVER, không phải
   client) làm mốc, thuần để có đủ option cho <select> — không phải tính toán
   nghiệp vụ (validate from<=to/12 tháng vẫn do backend chốt, client chỉ chặn
   sớm để UX tốt hơn, không thay thế backend). */
function dashboardYmAdd(ym, delta){
  var parts=String(ym).split('-'); var y=Number(parts[0]), m=Number(parts[1]);
  var total=y*12+(m-1)+delta; var ny=Math.floor(total/12), nm=((total%12)+12)%12+1;
  return ny+'-'+(nm<10?'0'+nm:''+nm);
}
function dashboardYmDiffMonths(a,b){
  var pa=String(a).split('-').map(Number), pb=String(b).split('-').map(Number);
  return (pb[0]*12+pb[1])-(pa[0]*12+pa[1]);
}
function dashboardServerNowYm(meta){
  var iso=meta&&meta.generatedAt, d=iso?new Date(iso):null;
  if(d&&!isNaN(d.getTime())) return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
  var now=new Date(); return now.getUTCFullYear()+'-'+String(now.getUTCMonth()+1).padStart(2,'0');
}
function dashboardCustomRangeOptions(meta){
  var now=dashboardServerNowYm(meta), out=[];
  for(var i=-23;i<=3;i++){ var p=dashboardYmAdd(now,i); out.push({code:p,label:dashPeriodText(p)}); }
  return out;
}
var DASHBOARD_RANGE_MODE_LABELS={month:'Theo tháng',last3:'3 tháng gần nhất',quarter_current:'Quý hiện tại',quarter_previous:'Quý trước',custom:'Tùy chỉnh'};
function dashboardRangeModeSelectHtml(rangeChoice){
  var opts=['month','last3','quarter_current','quarter_previous','custom'].map(function(v){
    return '<option value="'+v+'" '+(rangeChoice===v?'selected':'')+'>'+esc(DASHBOARD_RANGE_MODE_LABELS[v])+'</option>';
  }).join('');
  return '<select class="phfk-input" data-dash-range-mode>'+opts+'</select>';
}
function dashboardRangeMonthSelectHtml(attr, label, options, selectedValue){
  // Cố ý KHÔNG dùng data-dash-filter (generic filter listener) — cặp Từ
  // tháng/Đến tháng cần validate (from<=to, tối đa 12 tháng) TRƯỚC khi
  // refetch, khác hành vi "đổi filter là gọi ngay" của các dropdown khác.
  var opts='<option value="">'+esc(label)+'</option>'+options.map(function(o){
    return '<option value="'+esc(o.code)+'" '+(selectedValue===o.code?'selected':'')+'>'+esc(o.label)+'</option>';
  }).join('');
  return '<select class="phfk-input'+(selectedValue?' is-active':'')+'" data-dash-range-'+attr+'>'+opts+'</select>';
}
function dashboardCustomRangeControlsHtml(filters, meta){
  var options=dashboardCustomRangeOptions(meta);
  var fromSelect=dashboardRangeMonthSelectHtml('from','Từ tháng',options,filters.periodFrom);
  var toSelect=dashboardRangeMonthSelectHtml('to','Đến tháng',options,filters.periodTo);
  return '<div class="phfk-dash-range-custom">'+fromSelect+'<span class="phfk-dash-range-sep">→</span>'+toSelect+'</div>';
}
function dashboardRangeErrorHtml(message){
  return message ? '<p class="phfk-dash-range-error" data-dash-range-error role="alert">'+esc(message)+'</p>' : '';
}
// Diễn giải rõ meta.rangeMode==='range': đang xem khoảng nào, KPI thật sự
// dùng kỳ nào (snapshotPeriod, có thể KHÁC rangeEnd nếu rangeEnd future/thiếu
// dữ liệu), so sánh biến động dùng cặp kỳ nào — không để nhãn KPI khiến người
// dùng hiểu nhầm snapshot=rangeEnd. Đồng thời liệt kê mọi kỳ partial/future/
// empty trong periodCoverage[] (mỗi kỳ tự mang coverageStatus riêng).
function dashboardRangeSummaryHtml(meta){
  if(!meta||meta.rangeMode!=='range') return '';
  var parts=[];
  var rangeLabel='Đang xem: '+dashPeriodText(meta.rangeStart)+' → '+dashPeriodText(meta.rangeEnd)+'.';
  parts.push(rangeLabel);
  if(meta.snapshotPeriod){
    parts.push('Chỉ số nhanh (KPI) dùng số liệu kỳ '+dashPeriodText(meta.snapshotPeriod)+'.');
    if(meta.snapshotPeriod!==meta.rangeEnd){
      var why=meta.currentPeriodIsFuture?'là kỳ tương lai':'chưa đủ dữ liệu';
      parts.push('Kỳ '+dashPeriodText(meta.rangeEnd)+' (cuối khoảng đang chọn) '+why+' — KPI đang dùng kỳ gần nhất đã hoàn chỉnh trong khoảng là '+dashPeriodText(meta.snapshotPeriod)+'.');
    }
  } else {
    parts.push('Chưa có kỳ nào đủ dữ liệu trong khoảng đang chọn.');
  }
  if(meta.comparisonBase){
    parts.push('So sánh biến động: kỳ '+dashPeriodText(meta.comparisonBase)+' → kỳ '+dashPeriodText(meta.snapshotPeriod)+'.');
  } else if(meta.snapshotPeriod){
    parts.push('Chưa đủ dữ liệu để so sánh biến động trong khoảng này.');
  }
  var roster=(meta.periodCoverage||[]).filter(function(p){return p.coverageStatus!=='complete';});
  var rosterHtml='';
  if(roster.length){
    rosterHtml='<ul class="phfk-dash-range-roster">'+roster.map(function(p){
      var label=dashPeriodText(p.period), text;
      if(p.isFuture) text='Kỳ '+label+': kỳ tương lai, chưa có dữ liệu chính thức.';
      else if(p.coverageStatus==='empty') text='Kỳ '+label+': chưa có dữ liệu.';
      else text='Kỳ '+label+': dữ liệu một phần ('+p.coveredCount+'/'+p.expectedCount+' nhân sự).';
      return '<li>'+esc(text)+'</li>';
    }).join('')+'</ul>';
  }
  return '<div class="phfk-dash-range-summary" data-dash-range-summary><p class="phfk-dash-empty-note phfk-dash-scope-note">'+parts.map(esc).join(' ')+'</p>'+rosterHtml+'</div>';
}
// Batch 1A.2: 1 banner duy nhất, ghép đúng ngữ nghĩa future/partial/empty từ
// meta.currentPeriodStatus + expectedCount/coveredCount (deterministic, không %).
function dashboardPeriodStatusNoteHtml(meta){
  if(!meta.currentPeriod) return '';
  var isFuture = meta.currentPeriodIsFuture===true;
  var isShort = meta.currentPeriodStatus==='partial' || meta.currentPeriodStatus==='empty';
  var label = dashPeriodText(meta.currentPeriod);
  var coverageText = (meta.expectedCount!=null && meta.coveredCount!=null) ? (meta.coveredCount+'/'+meta.expectedCount+' nhân sự đã có cơ cấu thu nhập') : '';
  var message;
  if(isFuture && isShort && coverageText){
    message = 'Kỳ '+label+' là kỳ tương lai và dữ liệu chưa đầy đủ ('+coverageText+').';
  } else if(isFuture){
    message = 'Kỳ '+label+' đang được chuẩn bị và chưa phải kỳ hiện hành.';
  } else if(isShort && coverageText){
    message = 'Dữ liệu kỳ '+label+' chưa đầy đủ: '+coverageText+'.';
  } else {
    return '';
  }
  return '<p class="phfk-dash-empty-note phfk-dash-scope-note">'+esc(message)+'</p>';
}
function dashboardShareCellHtml(value, tone){
  if(value==null) return '<span class="phfk-dash-share-empty">—</span>';
  var width=Math.max(0,Math.min(100,value));
  return '<div class="phfk-dash-share is-'+(tone||'people')+'"><b>'+dashShareText(value)+'</b><span aria-hidden="true"><i style="width:'+width+'%"></i></span></div>';
}

function dashboardKpiSparklineHtml(series,tone,label){
  var rows=(series||[]).filter(function(item){return item&&item.period&&Number.isFinite(Number(item.value));});
  if(rows.length<3)return '';
  var values=rows.map(function(item){return Number(item.value);});var max=Math.max.apply(null,values);var min=Math.min.apply(null,values);var range=Math.max(1,max-min);
  var coords=values.map(function(value,index){var x=3+(index/(values.length-1))*106;var y=5+((max-value)/range)*30;return {x:x.toFixed(2),y:y.toFixed(2)};});
  var points=coords.map(function(point){return point.x+','+point.y;}).join(' ');var area='3,39 '+points+' 109,39';
  return '<svg class="phfk-dash-kpi-spark is-'+esc(tone||'income')+'" viewBox="0 0 112 42" preserveAspectRatio="none" role="img" aria-label="'+esc(label)+' theo '+rows.length+' kỳ dữ liệu thật"><polygon points="'+area+'"/><polyline points="'+points+'"/>'+coords.map(function(point){return '<circle cx="'+point.x+'" cy="'+point.y+'" r="1.65"/>';}).join('')+'</svg>';
}
function dashboardKpiTileHtml(icon, label, tone, value, subtitle, delta, options){
  options=options||{};
  var deltaHtml=delta&&delta.pct!=null?'<span class="phfk-dash-kpi-change '+dashDeltaClass(delta.pct)+'">'+(delta.pct>0?'↑ ':delta.pct<0?'↓ ':'')+dashPct(delta.pct)+' so kỳ trước</span>':'';
  var progress=options.progress==null?'':'<span class="phfk-dash-kpi-progress" aria-label="'+esc(dashShareText(options.progress))+'"><i style="width:'+Math.max(0,Math.min(100,options.progress))+'%"></i></span>';
  var spark=dashboardKpiSparklineHtml(options.series,options.sparkTone||tone,options.sparkLabel||label);
  return '' +
    '<div class="phfk-dash-kpi is-'+(tone||'income')+(spark?' has-spark':'')+'">' +
      '<div class="phfk-dash-kpi-top"><span class="phfk-dash-kpi-icon is-'+(tone||'income')+'">'+icon+'</span><span class="phfk-dash-kpi-label">'+esc(label)+'</span></div>' +
      '<div class="phfk-dash-kpi-value">'+esc(value==null?'—':value)+(options.unit?'<small>'+esc(options.unit)+'</small>':'')+'</div>' +
      '<p class="phfk-dash-kpi-delta">'+deltaHtml+'<span>'+esc(subtitle)+'</span></p>' +
      progress+spark+
    '</div>';
}
// Batch 2B Phase 2: mỗi điểm trend giờ mang coverageStatus/isFuture/isComplete
// (backend, lib/knl-dashboard.js). KHÔNG redesign chart — chỉ đánh dấu nhãn
// điểm không complete để người dùng không đọc nhầm xu hướng qua 1 điểm
// partial/tương lai bị vẽ liền mạch không phân biệt.
function dashboardTrendFlagHtml(row){
  if(!row || row.isComplete !== false) return '';
  var text = row.isFuture ? 'kỳ tương lai' : 'chưa đủ dữ liệu';
  return ' <em class="phfk-dash-trend-flag" title="Kỳ '+esc(dashPeriodText(row.period))+' '+esc(text)+', không nên đọc như kỳ chuẩn">'+esc(text)+'</em>';
}
function dashboardIncomeMovementHtml(trend,meta){
  var rows=(trend||[]).filter(function(row){return row&&row.period&&row.fund!=null;});
  if(rows.length>=3){
    var max=Math.max.apply(null,rows.map(function(row){return Number(row.fund)||0;}))||1;
    var min=Math.min.apply(null,rows.map(function(row){return Number(row.fund)||0;}));
    var range=Math.max(1,max-min);
    var points=rows.map(function(row,index){var x=rows.length===1?50:4+(index/(rows.length-1))*92;var y=10+((max-Number(row.fund||0))/range)*64;return x.toFixed(2)+','+y.toFixed(2);}).join(' ');
    return '<div class="phfk-dash-trend-visual"><svg viewBox="0 0 100 84" preserveAspectRatio="none" role="img" aria-label="Biến động tổng quỹ theo '+rows.length+' kỳ dữ liệu thật"><line x1="4" y1="74" x2="96" y2="74" class="phfk-dash-trend-axis"/><polyline points="'+points+'" class="phfk-dash-trend-line"/></svg><div class="phfk-dash-trend-labels">'+rows.map(function(row){return '<span class="'+(row.isComplete===false?'is-incomplete':'')+'"><small>'+esc(row.period)+'</small><b>'+dashMoney(row.fund)+'</b>'+dashboardTrendFlagHtml(row)+'</span>';}).join('')+'</div></div>';
  }
  if(rows.length===2){
    var previous=rows.find(function(row){return row.period===meta.previousPeriod;})||rows[0];
    var current=rows.find(function(row){return row.period===meta.currentPeriod;})||rows[1];
    var delta=dashDeltaOf(current.fund,previous.fund);
    var maxFund=Math.max(Number(previous.fund)||0,Number(current.fund)||0)||1;
    return '<div class="phfk-dash-period-compare"><div class="'+(previous.isComplete===false?'is-incomplete':'')+'"><small>KỲ TRƯỚC · '+esc(dashPeriodText(previous.period))+'</small><b>'+dashMoney(previous.fund)+'</b><span class="phfk-dash-period-bar"><i style="width:'+Math.round((previous.fund/maxFund)*100)+'%"></i></span>'+dashboardTrendFlagHtml(previous)+'</div><span class="phfk-dash-period-arrow">→</span><div class="'+(current.isComplete===false?'is-incomplete':'')+'"><small>KỲ HIỆN TẠI · '+esc(dashPeriodText(current.period))+'</small><b>'+dashMoney(current.fund)+'</b><span class="phfk-dash-period-bar is-current"><i style="width:'+Math.round((current.fund/maxFund)*100)+'%"></i></span>'+dashboardTrendFlagHtml(current)+'</div><div class="phfk-dash-period-delta '+dashDeltaClass(delta.pct)+'"><span><small>THAY ĐỔI QUỸ</small><b>'+(delta.amount==null?'—':(delta.amount>0?'+':'')+dashMoney(delta.amount))+'</b></span><span><b>'+dashPct(delta.pct)+'</b><small>so với kỳ trước</small></span></div></div>';
  }
  return '<p class="phfk-dash-empty-note">Chưa đủ lịch sử thực tế để hiển thị biến động theo kỳ.</p>';
}
function dashboardRankedBarsHtml(items){
  if(!items.length) return '<p class="phfk-dash-empty-note">Chưa có dữ liệu quỹ thu nhập trong phạm vi này.</p>';
  var ranked=items.slice().sort(function(a,b){return (Number(b.fund)||0)-(Number(a.fund)||0);});
  return '<div class="phfk-dash-ranked-bars">'+ranked.map(function(it,index){
    var pct=it.sharePct==null?0:Math.max(0,Math.min(100,it.sharePct));
    return '<div class="phfk-dash-ranked-row"><span class="phfk-dash-rank">'+(index+1)+'</span><span class="phfk-dash-ranked-label">'+esc(it.department)+'</span>'+
      '<span class="phfk-dash-ranked-track" aria-hidden="true"><i style="width:'+pct+'%"></i></span><b>'+dashShareText(it.sharePct)+'</b><em>'+dashMoney(it.fund)+'</em></div>';
  }).join('')+'</div>';
}
function dashboardEmptyTableHtml(headers, note){
  return '' +
    '<div class="phfk-table-wrap phfk-dash-table-wrap"><table class="phfk-table">' +
      '<thead><tr>' + headers.map(function(h){ return '<th>'+esc(h)+'</th>'; }).join('') + '</tr></thead>' +
      '<tbody><tr><td colspan="'+headers.length+'" class="phfk-dash-table-empty">'+esc(note)+'</td></tr></tbody>' +
    '</table></div>';
}
function dashboardCompareTableHtml(rows, incomeVisible, openDept, totalHeadcount, totalFund){
  var headers = ['Phòng ban','Nhân sự','Tỷ trọng nhân sự','Quỹ thu nhập','Tỷ trọng quỹ','Thu nhập bình quân','Biến động quỹ','Xem'];
  if(!rows.length) return dashboardEmptyTableHtml(headers, 'Không có phòng ban nào trong phạm vi được xem.');
  var body = rows.map(function(r){
    var isOpen = r.department===openDept;
    var headcountSharePct = dashSharePct(r.headcount,totalHeadcount);
    var fundSharePct = incomeVisible ? dashSharePct(r.fund,totalFund) : null;
    return '<tr class="'+(isOpen?'is-open':'')+'">' +
      '<td>'+esc(r.department)+'</td>' +
      '<td>'+r.headcount+'</td>' +
      '<td>'+dashboardShareCellHtml(headcountSharePct,'people')+'</td>'+
      '<td>'+dashMoney(r.fund)+'</td>' +
      '<td>'+dashboardShareCellHtml(fundSharePct,'fund')+'</td>'+
      '<td>'+dashMoney(r.avgIncome)+'</td>' +
      '<td class="'+dashDeltaClass(r.deltaPct)+'">'+dashDirectionalText(r.deltaPct,dashPct)+'</td>' +
      '<td><button type="button" class="phfk-btn-secondary phfk-dash-drill-btn phfk-dash-view-action" data-dash-dept="'+esc(r.department)+'">'+(isOpen?'Ẩn':'Xem')+'</button></td>' +
    '</tr>';
  }).join('');
  return '<div class="phfk-table-wrap phfk-dash-table-wrap"><table class="phfk-table">' +
    '<thead><tr>' + headers.map(function(h){ return '<th>'+esc(h)+'</th>'; }).join('') + '</tr></thead>' +
    '<tbody>'+body+'</tbody></table></div>';
}
function dashboardCompareChartHtml(rows, incomeVisible, openDept, totalHeadcount, totalFund){
  if(!rows.length) return '<p class="phfk-dash-empty-note">Không có phòng ban nào trong phạm vi được xem.</p>';
  return '<div class="phfk-dash-compare-legend"><span class="is-people">Tỷ trọng nhân sự</span><span class="is-fund">Tỷ trọng quỹ thu nhập</span></div><div class="phfk-dash-compare-chart"><div class="phfk-dash-compare-header phfk-dash-table-head"><span>Phòng ban</span><span>Tỷ trọng nhân sự</span><span>Tỷ trọng quỹ</span><span>Quỹ so với nhân sự</span><span>Biến động quỹ</span><span>Xem</span></div>'+rows.map(function(r){
    var peoplePct=dashSharePct(r.headcount,totalHeadcount);
    var fundPct=incomeVisible?dashSharePct(r.fund,totalFund):null;
    var spread=peoplePct!=null&&fundPct!=null?Math.round((fundPct-peoplePct)*10)/10:null;
    var isOpen=r.department===openDept;
    return '<button type="button" class="phfk-dash-compare-row'+(isOpen?' is-open':'')+'" data-dash-dept="'+esc(r.department)+'" aria-expanded="'+(isOpen?'true':'false')+'">'+
      '<span class="phfk-dash-compare-name">'+esc(r.department)+'</span>'+
      '<span class="phfk-dash-compare-series"><b>'+dashShareText(peoplePct)+'</b><span class="phfk-dash-compare-track"><i class="is-people" style="width:'+Math.max(0,Math.min(100,peoplePct||0))+'%"></i></span></span>'+
      '<span class="phfk-dash-compare-series"><b>'+dashShareText(fundPct)+'</b><span class="phfk-dash-compare-track"><i class="is-fund" style="width:'+Math.max(0,Math.min(100,fundPct||0))+'%"></i></span></span>'+
      '<span class="phfk-dash-compare-spread '+dashDeltaClass(spread)+'">'+dashDirectionalText(spread,dashPointText)+'</span><span class="phfk-dash-compare-delta '+dashDeltaClass(r.deltaPct)+'">'+dashDirectionalText(r.deltaPct,dashPct)+'</span><span class="phfk-dash-compare-open phfk-dash-view-action">'+(isOpen?'Ẩn':'Xem')+'</span></button>';
  }).join('')+'</div>';
}
function dashboardDrillDownHtml(dept, rows){
  var headers = ['Nhân sự','Chức danh','Bậc KNL','Tổng thu nhập','Biến động','Thao tác'];
  if(!rows || !rows.length) return dashboardEmptyTableHtml(headers, 'Không có nhân sự nào trong phòng ban "'+dept+'" thuộc phạm vi được xem.');
  var body = rows.map(function(r){
    var grade = r.knlGrade ? ((r.knlGrade.frameworkName ? r.knlGrade.frameworkName + ' · ' : '') + r.knlGrade.label) : '—';
    return '<tr>' +
      '<td>'+esc(r.employeeName)+' <small>('+esc(r.employeeCode)+')</small></td>' +
      '<td>'+esc(r.title||'—')+'</td>' +
      '<td>'+esc(grade)+'</td>' +
      '<td>'+dashMoney(r.currentIncome)+'</td>' +
      '<td class="'+dashDeltaClass(r.deltaPct)+'">'+dashPct(r.deltaPct)+'</td>' +
      '<td><button type="button" class="phfk-btn-secondary phfk-dash-profile-btn" data-dash-employee="'+esc(r.employeeCode)+'">Xem hồ sơ</button></td>' +
    '</tr>';
  }).join('');
  return '<section class="phfk-panel phfk-dash-panel phfk-dash-drilldown">' +
    '<div class="phfk-dash-panel-head"><h2>Chi tiết nhân sự — '+esc(dept)+'</h2></div>' +
    '<div class="phfk-table-wrap phfk-dash-table-wrap"><table class="phfk-table"><thead><tr>' + headers.map(function(h){ return '<th>'+esc(h)+'</th>'; }).join('') + '</tr></thead><tbody>'+body+'</tbody></table></div>' +
  '</section>';
}
function dashboardIncomeByGradeTableHtml(rows, frameworkNames){
  var headers = ['Bậc KNL','Nhân sự','Thu nhập bình quân','Biến động'];
  if(!rows.length) return dashboardEmptyTableHtml(headers, 'Chưa đủ dữ liệu để nối bảng này.');
  var body = rows.map(function(r){
    var frameworkName=(frameworkNames&&frameworkNames[r.frameworkCode])||'';
    var displayLabel=frameworkName ? frameworkName+' · '+r.label : r.label;
    return '<tr>' +
      '<td>'+esc(displayLabel)+'</td>' +
      '<td>'+r.count+'</td>' +
      '<td>'+dashMoney(r.avgIncome)+'</td>' +
      '<td class="'+dashDeltaClass(r.avgDeltaPct)+'">'+dashPct(r.avgDeltaPct)+'</td>' +
    '</tr>';
  }).join('');
  return '<div class="phfk-table-wrap phfk-dash-table-wrap"><table class="phfk-table"><thead><tr>' + headers.map(function(h){ return '<th>'+esc(h)+'</th>'; }).join('') + '</tr></thead><tbody>'+body+'</tbody></table></div>';
}
function dashboardFrameworkLabel(item){ return item.frameworkName||item.frameworkCode||'Bộ KNL'; }
function dashboardDepartmentKnlModel(drillDown){
  return Object.keys(drillDown||{}).map(function(department){
    var seen={};
    var people=(drillDown[department]||[]).filter(function(row){var key=String(row.employeeCode||'').toUpperCase();if(!key||seen[key])return false;seen[key]=true;return true;});
    var frameworkMap={};
    people.forEach(function(row){
      var grade=row.knlGrade;if(!grade)return;
      var key=grade.frameworkCode||'__NO_FRAMEWORK__';
      if(!frameworkMap[key])frameworkMap[key]={code:key,name:dashboardFrameworkLabel(grade),people:[],grades:{}};
      frameworkMap[key].people.push(row);
      var gradeKey=grade.gradeCode||grade.label||'__NO_GRADE__';
      if(!frameworkMap[key].grades[gradeKey])frameworkMap[key].grades[gradeKey]={gradeCode:grade.gradeCode||'',label:grade.label||grade.gradeCode||'Chưa xác định',people:[]};
      frameworkMap[key].grades[gradeKey].people.push(row);
    });
    var frameworks=Object.keys(frameworkMap).map(function(key){return frameworkMap[key];}).sort(function(a,b){return b.people.length-a.people.length||a.name.localeCompare(b.name,'vi')||a.code.localeCompare(b.code);});
    var assigned=people.filter(function(row){return !!row.knlGrade;}).length;
    return {department:department,people:people,total:people.length,assigned:assigned,missing:people.length-assigned,coverage:people.length?Math.round((assigned/people.length)*1000)/10:0,frameworks:frameworks};
  }).sort(function(a,b){return a.department.localeCompare(b.department,'vi');});
}
function dashboardDepartmentOverviewHtml(departments){
  if(!departments.length)return '<p class="phfk-dash-empty-note">Không có phòng ban nào trong phạm vi đang xem.</p>';
  return '<div class="phfk-dash-dept-overview"><div class="phfk-dash-dept-head phfk-dash-table-head"><span>Phòng ban</span><span>Nhân sự</span><span>Bao phủ KNL</span><span>Trạng thái</span><span>Bộ KNL</span><span>Xem</span></div>'+departments.map(function(dept){
    var tone=dept.coverage>=100?'is-complete':(dept.coverage>=70?'is-partial':'is-low');
    return '<div class="phfk-dash-dept-row'+(dept.missing?' has-exception':'')+'"><strong>'+esc(dept.department)+'</strong><span>'+dept.total+' người</span><span class="phfk-dash-dept-coverage '+tone+'"><b>'+dept.assigned+'/'+dept.total+' · '+dashShareText(dept.coverage)+'</b><i><em style="width:'+Math.max(0,Math.min(100,dept.coverage))+'%"></em></i></span><span class="phfk-dash-dept-status '+(dept.missing?'is-warning':'is-success')+'">'+(dept.missing?'Thiếu '+dept.missing:'Đủ KNL')+'</span><span>'+dept.frameworks.length+' Bộ KNL</span><button type="button" class="phfk-dash-dept-open" data-dash-knl-dept="'+esc(dept.department)+'">Xem phân tích <span aria-hidden="true">→</span></button></div>';
  }).join('')+'</div>';
}
function dashboardCompensationMatrixGradeCells(department,ladder,gradeNumbers){
  return gradeNumbers.map(function(gradeNumber){
    var grade=((ladder&&ladder.grades)||[]).find(function(item){return Number(item.gradeNumber)===Number(gradeNumber);});
    var count=grade&&Array.isArray(grade.people)?grade.people.length:0;
    var active=count&&dashboardState.matrixQuickView&&dashboardState.matrixQuickView.department===department&&dashboardState.matrixQuickView.ladderCode===ladder.ladderCode&&Number(dashboardState.matrixQuickView.gradeNumber)===Number(gradeNumber);
    var control=count?'<button type="button" class="phfk-dash-matrix-count-btn'+(active?' is-active':'')+'" data-dash-matrix-open data-dash-matrix-department="'+esc(department)+'" data-dash-matrix-ladder="'+esc(ladder.ladderCode)+'" data-dash-matrix-grade-number="'+gradeNumber+'" aria-controls="phfkDashMatrixQuick" aria-expanded="'+(active?'true':'false')+'" aria-label="'+esc('Xem '+count+' nhân sự · '+department+' · '+ladder.ladderName+' · Bậc '+gradeNumber)+'">'+count+'</button>':'–';
    return '<td class="phfk-dash-matrix-grade" data-dash-matrix-grade="'+gradeNumber+'" data-dash-matrix-count="'+count+'">'+control+'</td>';
  }).join('');
}
function dashboardCompensationMatrixQuickPanelHtml(matrix){
  var current=dashboardState.matrixQuickView;if(!current)return '';
  var dept=((matrix&&matrix.departments)||[]).find(function(item){return item.department===current.department;});
  var ladder=dept&&dept.ladders.find(function(item){return item.ladderCode===current.ladderCode;});
  var grade=ladder&&ladder.grades.find(function(item){return Number(item.gradeNumber)===Number(current.gradeNumber);});
  if(!dept||!ladder||!grade){dashboardState.matrixQuickView=null;return '';}
  var seen={};var people=(grade.people||[]).filter(function(row){var code=String(row.employeeCode||'').trim().toUpperCase();if(!code||seen[code])return false;seen[code]=true;return true;});
  var title=dept.department+' · '+ladder.ladderName+' · Bậc '+grade.gradeNumber+' · '+people.length+' người';
  return '<section class="phfk-dash-matrix-quick" id="phfkDashMatrixQuick" data-dash-matrix-panel tabindex="-1" aria-labelledby="phfkDashMatrixQuickTitle"><div class="phfk-dash-matrix-quick-head"><div><small>'+esc(matrix.period?('Kỳ '+dashPeriodText(matrix.period)):'Kỳ đang xem')+'</small><h4 id="phfkDashMatrixQuickTitle">'+esc(title)+'</h4></div><button type="button" class="phfk-dash-matrix-quick-close" data-dash-matrix-close aria-label="Đóng danh sách nhân sự">×</button></div><ul class="phfk-dash-matrix-people">'+people.map(function(row){return '<li><b>'+esc(row.employeeName)+'</b><span>'+esc(row.employeeCode)+'</span><small>'+esc(row.title||'—')+'</small></li>';}).join('')+'</ul></section>';
}
function dashboardCompensationGradeMatrixHtml(matrix,incomeVisible){
  var heading='<div class="phfk-dash-panel-head"><div><h2 class="phfk-dash-panel-title">Phân bố bậc lương theo phòng ban</h2><p>Tổng hợp nhân sự theo ngạch và bậc lương trong kỳ đang xem.</p></div></div>';
  if(!incomeVisible)return '<section class="phfk-panel phfk-dash-panel phfk-dash-grade-matrix">'+heading+'<p class="phfk-dash-empty-note">Không có quyền xem dữ liệu ngạch và bậc lương.</p></section>';
  matrix=matrix||{gradeNumbers:[],departments:[],unassignedCount:0};
  var warning=Number(matrix.unassignedCount)>0?'<p class="phfk-warning phfk-dash-matrix-warning">'+Number(matrix.unassignedCount)+' người chưa được gán bậc lương trong kỳ.</p>':'';
  var gradeNumbers=(matrix.gradeNumbers||[]).map(Number).filter(function(number){return Number.isInteger(number)&&number>0;}).sort(function(a,b){return a-b;});
  if(!gradeNumbers.length)return '<section class="phfk-panel phfk-dash-panel phfk-dash-grade-matrix">'+heading+warning+'<p class="phfk-dash-empty-note">Chưa có assignment bậc lương hợp lệ trong kỳ '+esc(matrix.period?dashPeriodText(matrix.period):'đang xem')+'.</p></section>';
  var rows=(matrix.departments||[]).map(function(dept){
    if((dept.ladders||[]).length<=1){
      var ladder=(dept.ladders||[])[0]||{ladderCode:'',ladderName:'',grades:[]};
      return '<tr class="phfk-dash-matrix-dept is-single" data-dash-matrix-dept="'+esc(dept.department)+'"><td><b>'+esc(dept.department)+'</b>'+(ladder.ladderName?'<small>'+esc(ladder.ladderName)+'</small>':'')+'</td><td>'+dept.total+'</td>'+dashboardCompensationMatrixGradeCells(dept.department,ladder,gradeNumbers)+'</tr>';
    }
    var parent='<tr class="phfk-dash-matrix-dept is-parent" data-dash-matrix-dept="'+esc(dept.department)+'"><td><b>'+esc(dept.department)+'</b><small>'+dept.ladders.length+' ngạch lương</small></td><td>'+dept.total+'</td>'+gradeNumbers.map(function(){return '<td class="phfk-dash-matrix-grade">–</td>';}).join('')+'</tr>';
    var children=dept.ladders.map(function(ladder){return '<tr class="phfk-dash-matrix-ladder"><td><span>↳ '+esc(ladder.ladderName)+'</span></td><td>'+ladder.people.length+'</td>'+dashboardCompensationMatrixGradeCells(dept.department,ladder,gradeNumbers)+'</tr>';}).join('');
    return parent+children;
  }).join('');
  var headers='<th>Phòng ban</th><th>Nhân sự</th>'+gradeNumbers.map(function(number){return '<th>Bậc '+number+'</th>';}).join('');
  return '<section class="phfk-panel phfk-dash-panel phfk-dash-grade-matrix">'+heading+warning+'<div class="phfk-table-wrap phfk-dash-table-wrap"><table class="phfk-table"><thead class="phfk-dash-table-head"><tr>'+headers+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+dashboardCompensationMatrixQuickPanelHtml(matrix)+'</section>';
}
function dashboardDepartmentGradeStructureHtml(dept){
  if(!dept.frameworks.length)return '<div class="phfk-dash-dept-grades"><div class="phfk-dash-dept-grades-head"><div><h3>Cơ cấu bậc KNL theo phòng ban</h3><p>Chưa có dữ liệu bậc KNL hợp lệ để phân bố.</p></div></div></div>';
  var multiple=dept.frameworks.length>1;
  var groups=dept.frameworks.map(function(framework){
    var grades=Object.keys(framework.grades).map(function(key){return framework.grades[key];}).sort(function(a,b){return String(a.gradeCode||a.label).localeCompare(String(b.gradeCode||b.label),'vi',{numeric:true});});
    if(multiple){
      return '<article class="phfk-dash-dept-grade-group"><div><strong>'+esc(framework.name)+'</strong><small>'+framework.people.length+' người</small></div><div class="phfk-dash-dept-grade-tags">'+grades.map(function(grade){return '<span>'+esc(grade.label)+' <b data-dash-grade-count="'+grade.people.length+'">'+grade.people.length+' người</b></span>';}).join('')+'</div></article>';
    }
    return '<div class="phfk-dash-dept-grade-ranked">'+grades.map(function(grade){var pct=framework.people.length?Math.round((grade.people.length/framework.people.length)*1000)/10:0;return '<div class="phfk-dash-dept-grade-row"><span>'+esc(grade.label)+'</span><i aria-hidden="true"><em style="width:'+Math.max(0,Math.min(100,pct))+'%"></em></i><b data-dash-grade-count="'+grade.people.length+'">'+grade.people.length+' người</b><small>'+dashShareText(pct)+'</small></div>';}).join('')+'</div>';
  }).join('');
  var missing=dept.missing?'<small class="phfk-dash-dept-grades-missing">'+dept.missing+' người chưa có KNL, không tính vào cơ cấu bậc.</small>':'';
  return '<div class="phfk-dash-dept-grades is-'+(multiple?'multiple':'single')+'"><div class="phfk-dash-dept-grades-head"><div><h3>Cơ cấu bậc KNL theo phòng ban</h3><p>'+(multiple?'Tách theo từng Bộ KNL đang áp dụng; không gộp bậc giữa các Bộ KNL.':'Phân bố '+dept.assigned+' nhân sự có KNL trong '+dept.frameworks[0].name+'.')+'</p></div>'+missing+'</div><div class="phfk-dash-dept-grades-body">'+groups+'</div></div>';
}
function dashboardDepartmentDetailHtml(dept,incomeVisible,filterLocked){
  var selected=dept.frameworks.find(function(item){return item.code===dashboardState.selectedFramework;})||dept.frameworks[0]||null;
  if(selected)dashboardState.selectedFramework=selected.code;
  var summary='<p class="phfk-dash-knl-detail-summary">'+dept.total+' người <i>·</i> '+dept.assigned+'/'+dept.total+' đã có KNL <i>·</i> Bao phủ '+dashShareText(dept.coverage)+' <i>·</i> '+dept.frameworks.length+' Bộ KNL</p>';
  var selector=dept.frameworks.length?'<div class="phfk-dash-framework-list" role="tablist" aria-label="Bộ KNL đang áp dụng trong '+esc(dept.department)+'">'+dept.frameworks.map(function(f){return '<button type="button" role="tab" aria-selected="'+(selected&&selected.code===f.code?'true':'false')+'" class="phfk-dash-framework-option'+(selected&&selected.code===f.code?' is-active':'')+'" data-dash-framework="'+esc(f.code)+'"><span>'+esc(f.name)+'</span><b>'+f.people.length+' người</b></button>';}).join('')+'</div>':'<p class="phfk-dash-empty-note">Phòng ban này chưa có Bộ KNL được gán.</p>';
  var gradeVisual='';var incomeVisual='';
  if(selected){
    var grades=Object.keys(selected.grades).map(function(key){return selected.grades[key];}).sort(function(a,b){return String(a.gradeCode||a.label).localeCompare(String(b.gradeCode||b.label),'vi',{numeric:true});});
    var max=Math.max.apply(null,grades.map(function(g){return g.people.length;}))||1;
    gradeVisual='<div class="phfk-dash-subsection-head"><h3>Phân bố bậc — '+esc(selected.name)+'</h3></div><div class="phfk-dash-grade-ranked">'+grades.map(function(g){return '<div class="phfk-dash-grade-row"><span>'+esc(g.label)+'</span><span class="phfk-dash-grade-track" aria-hidden="true"><i style="width:'+Math.round((g.people.length/max)*100)+'%"></i></span><b>'+g.people.length+' người</b></div>';}).join('')+'</div>';
    var incomeRows=grades.map(function(g){var rows=g.people.filter(function(row){return row.currentIncome!=null;});var deltas=rows.filter(function(row){return row.deltaPct!=null;});return {frameworkCode:selected.code,gradeCode:g.gradeCode,label:g.label,count:rows.length,avgIncome:rows.length?Math.round(rows.reduce(function(sum,row){return sum+Number(row.currentIncome||0);},0)/rows.length):null,avgDeltaPct:deltas.length?Math.round((deltas.reduce(function(sum,row){return sum+Number(row.deltaPct||0);},0)/deltas.length)*10)/10:null};}).filter(function(row){return row.count>0;});
    incomeVisual='<div class="phfk-dash-subsection-head"><h3>Thu nhập theo bậc — '+esc(selected.name)+'</h3></div>'+(incomeVisible?dashboardIncomeByGradeTableHtml(incomeRows,{}):'<p class="phfk-dash-empty-note">Không có quyền xem Thu nhập.</p>');
  }
  return '<div class="phfk-dash-knl-detail-head"><div><h2>Năng lực đội ngũ — '+esc(dept.department)+'</h2>'+summary+'</div>'+(!filterLocked?'<button type="button" class="phfk-btn-secondary phfk-dash-knl-back" data-dash-knl-overview>← Tất cả phòng ban</button>':'')+'</div>'+dashboardDepartmentGradeStructureHtml(dept)+'<div class="phfk-dash-knl-detail-grid"><section><div class="phfk-dash-framework-head"><span>Bộ KNL đang áp dụng</span><small>'+dept.frameworks.length+' Bộ KNL</small></div>'+selector+'</section><section>'+gradeVisual+'</section><section>'+incomeVisual+'</section></div>';
}
function dashboardKnlSectionHtml(drillDown,incomeVisible,filteredDepartment,assignedTotal,missingTotal,headcountTotal){
  var departments=dashboardDepartmentKnlModel(drillDown);
  var selectedDepartment=filteredDepartment||dashboardState.selectedKnlDept;
  var selected=departments.find(function(item){return item.department===selectedDepartment;})||null;
  if(selected)dashboardState.selectedKnlDept=selected.department;
  var detailTotal=departments.reduce(function(sum,dept){return sum+dept.total;},0);var detailAssigned=departments.reduce(function(sum,dept){return sum+dept.assigned;},0);
  var total=headcountTotal==null?detailTotal:Number(headcountTotal);var assigned=assignedTotal==null?detailAssigned:Number(assignedTotal);var missing=missingTotal==null?Math.max(0,total-assigned):Number(missingTotal);var complete=departments.filter(function(dept){return dept.total>0&&dept.coverage>=100;}).length;var coverage=total?Math.round((assigned/total)*1000)/10:0;
  var summary='<div class="phfk-dash-knl-exec-summary"><div class="is-assigned"><small>ĐÃ GÁN KNL</small><b>'+assigned+'/'+total+' người</b></div><div class="is-missing"><small>CHƯA CÓ KNL</small><b>'+missing+' người</b></div><div class="is-coverage"><small>TỶ LỆ BAO PHỦ</small><b>'+dashShareText(coverage)+'</b></div><div class="is-departments"><small>PHÒNG BAN ĐẠT 100%</small><b>'+complete+'/'+departments.length+' phòng ban</b></div></div>';
  return '<section class="phfk-panel phfk-dash-panel phfk-dash-knl" id="phfkDashKnl">'+(selected?dashboardDepartmentDetailHtml(selected,incomeVisible,!!filteredDepartment):'<div class="phfk-dash-panel-head"><div><h2>Năng lực đội ngũ</h2><p>Tổng quan KNL theo phòng ban trong phạm vi đang xem</p></div></div>'+summary+dashboardDepartmentOverviewHtml(departments))+'</section>';
}
function dashboardMissingKnlPanelHtml(drillDown,meta){
  if(!dashboardState.missingKnlOpen)return '';
  var rows=Object.keys(drillDown||{}).reduce(function(all,department){return all.concat((drillDown[department]||[]).filter(function(row){return !row.knlGrade;}).map(function(row){return Object.assign({department:department},row);}));},[]);
  var body=rows.map(function(row){var canProfile=meta.isAdmin===true||meta.isFullCompanyIncome===true||row.currentIncome!=null;return '<tr><td><b>'+esc(row.employeeName)+'</b></td><td>'+esc(row.employeeCode)+'</td><td>'+esc(row.department)+'</td><td>'+esc(row.title||'—')+'</td><td><span class="phfk-dash-knl-unassigned">Chưa gán KNL</span></td><td>'+(canProfile?'<button type="button" class="phfk-btn-secondary phfk-dash-profile-btn" data-dash-employee="'+esc(row.employeeCode)+'">Xem hồ sơ</button>':'—')+'</td></tr>';}).join('');
  return '<section class="phfk-panel phfk-dash-panel phfk-dash-missing-panel" data-dash-missing-panel><div class="phfk-dash-panel-head"><div><h2>Nhân sự chưa có KNL</h2><p>'+rows.length+' người</p></div><button type="button" class="phfk-btn-secondary" data-dash-missing-close>Đóng</button></div><div class="phfk-table-wrap phfk-dash-table-wrap"><table class="phfk-table"><thead><tr><th>Nhân sự</th><th>Mã NV</th><th>Phòng ban</th><th>Chức danh</th><th>Trạng thái</th><th>Xem hồ sơ</th></tr></thead><tbody>'+body+'</tbody></table></div></section>';
}
function dashboardAttentionHtml(insights,actionStats){
  var items=[];
  var missing=actionStats&&actionStats.missingKnl;
  if(missing!=null&&Number(missing)>0) items.push({level:'attention',icon:'!',headline:'Nhân sự chưa có KNL',value:String(missing)+' người',detail:String(missing)+' người cần bổ sung Bộ KNL đang áp dụng',action:'missing-knl'});
  (insights||[]).filter(function(i){return i&&i.code!=='MISSING_KNL';}).forEach(function(i){var detail=i.message||'';if(i.code==='FUND_SHARE_AHEAD_OF_HEADCOUNT')detail=String(detail).replace(/^Có chênh lệch:\s*/i,'');items.push({level:i.level||'info',icon:i.level==='attention'?'!':'i',headline:i.code==='FUND_SHARE_AHEAD_OF_HEADCOUNT'?'Quỹ so với nhân sự':'Điểm cần xem thêm',value:'',detail:detail});});
  if(!items.length) return '<section class="phfk-panel phfk-dash-panel phfk-dash-attention"><div class="phfk-dash-panel-head"><h2>Điểm cần chú ý</h2></div><p class="phfk-dash-empty-note">Chưa phát hiện điểm cần chú ý từ dữ liệu hiện có.</p></section>';
  return '<section class="phfk-panel phfk-dash-panel phfk-dash-attention"><div class="phfk-dash-panel-head"><h2>Điểm cần chú ý</h2><span>'+items.length+' mục</span></div><div class="phfk-dash-attention-list">'+items.map(function(item){return '<article class="phfk-dash-attention-row is-'+esc(item.level)+'"><span class="phfk-dash-attention-icon">'+esc(item.icon)+'</span><div><h3>'+esc(item.headline)+'</h3><p>'+esc(item.detail)+'</p></div>'+(item.value?(item.action?'<button type="button" class="phfk-dash-attention-value" data-dash-attention="'+item.action+'">'+esc(item.value)+'</button>':'<b>'+esc(item.value)+'</b>'):'')+(item.action?'<button type="button" class="phfk-link" data-dash-attention="'+item.action+'">Xem danh sách <span aria-hidden="true">→</span></button>':'')+'</article>';}).join('')+'</div></section>';
}
function dashboardFilterSelect(name, label, options, selectedValue){
  var opts = '<option value="">'+esc(label)+'</option>' + options.map(function(o){
    var value = typeof o==='object' ? o.code : o;
    var text = typeof o==='object' ? o.label : o;
    return '<option value="'+esc(value)+'" '+(selectedValue===value?'selected':'')+'>'+esc(text)+'</option>';
  }).join('');
  return '<select class="phfk-input'+(selectedValue?' is-active':'')+'" data-dash-filter="'+esc(name)+'">'+opts+'</select>';
}

/* AI panel — Gate 3. Render NGẮN GỌN đúng format mục 11 (kết luận + vài gạch
   đầu dòng), KHÔNG cần markdown đầy đủ như AI Sandbox (assets/js/ai/phf-ai-
   engine.js) — model đã được yêu cầu không dùng markdown phức tạp. Chỉ tách
   đoạn theo dòng trống và nhận diện gạch đầu dòng "- "/"• " đơn giản. */
function dashAiRenderReply(text){
  var raw = String(text||'').replace(/\r\n/g,'\n').trim();
  if(!raw) return '';
  var blocks = raw.split(/\n{2,}/);
  return blocks.map(function(block){
    var lines = block.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
    if(!lines.length) return '';
    var isList = lines.every(function(l){ return /^[-•]\s+/.test(l); });
    if(isList) return '<ul class="phfk-dash-ai-list">'+lines.map(function(l){ return '<li>'+esc(l.replace(/^[-•]\s+/,''))+'</li>'; }).join('')+'</ul>';
    return '<p>'+lines.map(esc).join('<br>')+'</p>';
  }).join('');
}
function dashboardAiPanelHtml(){
  var ai = dashboardState.ai;
  var aiPrompts = [
    'Phòng ban nào đang chiếm tỷ trọng thu nhập lớn nhất?',
    'Thu nhập tháng này biến động thế nào?',
    'Nhóm nào cần tôi xem kỹ hơn?',
    'Tình hình KNL hiện tại có điểm gì đáng chú ý?',
    'Phòng ban nào có thay đổi thu nhập đáng kể?'
  ];
  var resultHtml;
  if(ai.pending){
    resultHtml = '<div class="phfk-dash-ai-result-block"><small>NHẬN ĐỊNH</small><p class="phfk-dash-empty-note">Đang phân tích…</p></div>' +
      '<div class="phfk-dash-ai-result-block"><small>SỐ LIỆU SỬ DỤNG</small><p class="phfk-dash-empty-note">—</p></div>';
  }else if(ai.error){
    resultHtml = '<div class="phfk-dash-ai-result-block"><small>NHẬN ĐỊNH</small><p class="phfk-dash-ai-error" data-dash-ai-error>'+esc(ai.error)+'</p></div>' +
      '<div class="phfk-dash-ai-result-block"><small>SỐ LIỆU SỬ DỤNG</small><p class="phfk-dash-empty-note">—</p></div>';
  }else if(ai.reply){
    resultHtml = '<div class="phfk-dash-ai-result-block"><small>NHẬN ĐỊNH</small><div class="phfk-dash-ai-answer" data-dash-ai-answer>'+dashAiRenderReply(ai.reply)+'</div></div>' +
      '<div class="phfk-dash-ai-result-block"><small>SỐ LIỆU SỬ DỤNG</small>' +
      (ai.contextSummary&&ai.contextSummary.length ? '<ul class="phfk-dash-ai-context-list">'+ai.contextSummary.map(function(l){ return '<li>'+esc(l)+'</li>'; }).join('')+'</ul>' : '<p class="phfk-dash-empty-note">—</p>') +
      '</div>';
  }else{ resultHtml = ''; }
  return '' +
    '<section class="phfk-panel phfk-dash-panel phfk-dash-panel-compact phfk-dash-ai-panel" id="phfkDashAi" tabindex="-1">' +
      '<div class="phfk-dash-panel-head"><div><small class="phfk-dash-panel-kicker">TRỢ LÝ PHÂN TÍCH</small><h2 class="phfk-dash-panel-title">Hỏi AI về dữ liệu tổng quan</h2></div></div>' +
      '<p class="phfk-dash-ai-intro">AI hỗ trợ diễn giải các số liệu tổng hợp đang hiển thị; không thay thế quyết định nghiệp vụ.</p>'+
      '<p class="phfk-dash-ai-helper">Gợi ý câu hỏi:</p>' +
      '<div class="phfk-dash-ai-prompts">' + aiPrompts.map(function(p){ return '<button type="button" class="phfk-dash-ai-prompt" data-dash-ai-prompt'+(ai.pending?' disabled':'')+'>'+esc(p)+'</button>'; }).join('') + '</div>' +
      (resultHtml?'<div class="phfk-dash-ai-result">' + resultHtml + '</div>':'') +
    '</section>';
}
async function dashboardAskAi(root, question){
  var ai = dashboardState.ai;
  if(ai.pending) return;
  var q = String(question||'').trim();
  if(!q) return;
  ai.pending = true; ai.error = ''; ai.reply = ''; ai.question = q;
  renderKnlDashboardBody(root);
  try{
    var res = await apiPost('askKnlDashboardAi', { question:q, filters:dashboardState.filters });
    ai.pending = false;
    ai.reply = res.reply || '';
    ai.contextSummary = res.contextSummary || [];
  }catch(error){
    ai.pending = false;
    var code = error && error.code;
    if(code === 'KNL_DASHBOARD_AI_QUESTION_REQUIRED' || code === 'KNL_DASHBOARD_AI_QUESTION_TOO_LONG' || code === 'AI_RATE_LIMITED' || code === 'AI_REQUEST_IN_PROGRESS'){
      ai.error = (error && error.message) || 'Không thể gửi câu hỏi lúc này.';
    }else{
      ai.error = 'Trợ lý AI tạm thời chưa phản hồi. Dữ liệu tổng quan vẫn được cập nhật bình thường.';
    }
  }
  renderKnlDashboardBody(root);
}

function renderKnlDashboardError(root, error){
  var body = root.querySelector('[data-knl-body]');
  if(!body) return;
  body.innerHTML = '<div class="phfk-empty">Không tải được dữ liệu tổng quan KNL: '+esc((error&&error.message)||'Lỗi không xác định')+'</div>';
}

var DASHBOARD_RANGE_ERROR_CODES={KNL_DASHBOARD_RANGE_INVALID:1,KNL_DASHBOARD_RANGE_TOO_LONG:1};
async function loadKnlDashboard(root){
  var body = root.querySelector('[data-knl-body]');
  var hadPriorData = Boolean(dashboardState.loaded && dashboardState.data);
  if(body) body.innerHTML = '<div class="phfk-loading">Đang tải dữ liệu tổng quan KNL…</div>';
  try{
    var res = await apiPost('getKnlDashboardOverview', dashboardRequestFilters(dashboardState.filters));
    dashboardState.data = res;
    dashboardState.loaded = true;
    dashboardState.loadedAt = Date.now();
    dashboardState.error = '';
    dashboardState.rangeError = '';
    renderKnlDashboardBody(root);
  }catch(error){
    var code = error && error.code;
    // Lỗi chọn khoảng thời gian (from>to/quá 12 tháng) là lỗi input, không
    // phải lỗi hệ thống — hiển thị inline ngay cạnh bộ chọn, GIỮ NGUYÊN
    // dashboard đang xem (không alert(), không xoá toàn bộ body).
    if(DASHBOARD_RANGE_ERROR_CODES[code] && hadPriorData){
      dashboardState.rangeError = (error && error.message) || 'Khoảng thời gian không hợp lệ.';
      renderKnlDashboardBody(root);
      return;
    }
    dashboardState.error = (error && error.message) || 'Lỗi không xác định';
    renderKnlDashboardError(root, error);
  }
}

/* ===================== Batch 2C / KNL-07 — Xuất Excel =====================
 * Kiến trúc 2 lớp đã chốt:
 *  - buildKnlExportModel(data,filters): PURE, không gọi ExcelJS, không DOM
 *    side-effect, chứa TOÀN BỘ mapping Web -> Excel + permission hard gate
 *    (income). Test độc lập không cần ExcelJS. Gắn lên window để test JSDOM
 *    gọi trực tiếp (cùng convention window.phfRenderKnl đã có).
 *  - renderKnlExportWorkbook(model): CHỈ build workbook/style/freeze/
 *    autofilter/download qua ExcelJS, KHÔNG chứa business semantics nào —
 *    mọi quyết định "có/không có field/sheet nào" đã chốt xong ở model.
 * Export dùng TRỰC TIẾP dashboardState.data (đúng cái đang xem trên web),
 * KHÔNG fetch lại, KHÔNG query DB, KHÔNG tính lại carry-forward — mọi giá
 * trị (snapshotPeriod/comparisonBase/periodCoverage/trend/currentIncome...)
 * lấy nguyên từ response getKnlDashboardOverview đã có sẵn. */
function knlExportPeriodLabel(period){ return period ? dashPeriodText(period) : '—'; }
function knlExportCoverageLabel(status, isFuture){
  if(isFuture) return 'Kỳ tương lai';
  if(status==='complete') return 'Đủ dữ liệu';
  if(status==='partial') return 'Một phần';
  if(status==='empty') return 'Chưa có dữ liệu';
  return '—';
}
function knlExportFileName(meta, filters){
  meta = meta || {}; filters = filters || {};
  var rangeMode = meta.rangeMode || 'single';
  var periodPart = (rangeMode==='range' && meta.rangeStart && meta.rangeEnd)
    ? meta.rangeStart+'_'+meta.rangeEnd
    : (meta.snapshotPeriod || meta.currentPeriod || 'khong-ky');
  var deptSuffix = filters.department
    ? '_'+String(filters.department).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^0-9A-Za-z]+/g,'_')
    : '';
  return 'PHF_KNL_Dashboard_'+periodPart+deptSuffix+'.xlsx';
}
function buildKnlExportModel(data, filters){
  data = data || {}; filters = filters || {};
  var meta = data.meta || {}, kpis = data.kpis || {};
  var incomeVisible = meta.incomeVisible === true;
  var rangeMode = meta.rangeMode || 'single';
  var snapshotPeriod = meta.snapshotPeriod || meta.currentPeriod || null;
  var comparisonBase = meta.comparisonBase || meta.previousPeriod || null;

  var periodBlock = {
    rangeMode: rangeMode,
    rangeStart: meta.rangeStart || null,
    rangeEnd: meta.rangeEnd || null,
    snapshotPeriod: snapshotPeriod,
    comparisonBase: comparisonBase,
    snapshotDiffersFromRangeEnd: Boolean(rangeMode==='range' && meta.rangeEnd && snapshotPeriod && snapshotPeriod!==meta.rangeEnd)
  };
  var coverageBlock = {
    status: meta.currentPeriodStatus || null,
    isFuture: meta.currentPeriodIsFuture === true,
    expectedCount: meta.expectedCount==null?null:meta.expectedCount,
    coveredCount: meta.coveredCount==null?null:meta.coveredCount,
    missingCount: meta.missingCount==null?null:meta.missingCount
  };

  // ---- 01 Tổng quan: KPI (chỉ headcount luôn có; tiền chỉ nếu incomeVisible) ----
  var kpiRows = [{ label:'Tổng nhân sự trong phạm vi', value: kpis.totalHeadcount==null?null:kpis.totalHeadcount, isMoney:false }];
  if(incomeVisible){
    kpiRows.push({ label:'Tổng quỹ thu nhập (kỳ '+knlExportPeriodLabel(snapshotPeriod)+')', value: kpis.totalFund, isMoney:true });
    kpiRows.push({ label:'Thu nhập bình quân/người', value: kpis.avgIncome, isMoney:true });
    kpiRows.push({ label:'Số người có dữ liệu thu nhập', value: kpis.incomePopulation==null?null:kpis.incomePopulation, isMoney:false });
  }
  // Biến động — KHÔNG cộng dồn thành tổng (stock metric theo từng kỳ, không phải flow).
  var trendRows = incomeVisible ? (data.trend||[]).map(function(row){
    return { period: row.period, fund: row.fund, headcount: row.headcount, avgIncome: row.avgIncome, status: knlExportCoverageLabel(row.coverageStatus, row.isFuture) };
  }) : [];

  // ---- 02 Phòng ban ----
  var deptComparisonByDept = {};
  (data.deptComparison||[]).forEach(function(row){ deptComparisonByDept[row.department] = row; });
  var departmentRows = (data.deptComposition||[]).map(function(row){
    var cmp = deptComparisonByDept[row.department] || {};
    var out = { department: row.department, headcount: row.headcount };
    if(incomeVisible){
      out.fund = row.fund; out.sharePct = row.sharePct;
      out.avgIncome = cmp.avgIncome==null?null:cmp.avgIncome;
      out.previousFund = cmp.previousFund==null?null:cmp.previousFund;
      out.deltaAmount = cmp.deltaAmount==null?null:cmp.deltaAmount;
      out.deltaPct = cmp.deltaPct==null?null:cmp.deltaPct;
    }
    return out;
  });

  // ---- 03 Bậc lương ----
  var knlDistributionRows = (data.knlDistribution||[]).map(function(row){
    return { frameworkName: row.frameworkName||row.frameworkCode||'', gradeLabel: row.label||row.gradeCode||'', count: row.count };
  });
  var incomeByGradeRows = incomeVisible ? (data.incomeByGrade||[]).map(function(row){
    return { frameworkCode: row.frameworkCode||'', gradeLabel: row.label||row.gradeCode||'', count: row.count, avgIncome: row.avgIncome, avgDeltaPct: row.avgDeltaPct==null?null:row.avgDeltaPct };
  }) : [];
  var matrixRows = [];
  if(incomeVisible && data.compensationGradeMatrix){
    (data.compensationGradeMatrix.departments||[]).forEach(function(dept){
      (dept.ladders||[]).forEach(function(ladder){
        (ladder.grades||[]).forEach(function(grade){
          matrixRows.push({ department: dept.department, ladderName: ladder.ladderName||ladder.ladderCode||'', gradeLabel: grade.gradeCode||'', count: (grade.people||[]).length });
        });
      });
      if(dept.unassigned) matrixRows.push({ department: dept.department, ladderName: '(Chưa gán bậc)', gradeLabel: '—', count: dept.unassigned });
    });
  }

  // ---- 04 Chi tiết nhân sự — LUÔN có (peopleScope, không phụ thuộc income_view),
  // cột tiền/"Trạng thái dữ liệu" chỉ thêm khi incomeVisible. genuinely-missing
  // (currentIncome===null dù incomeVisible=true) PHẢI ghi rõ "Thiếu dữ liệu",
  // KHÔNG hiển thị 0/carry-forward giả — carry-forward THẬT đã nằm sẵn trong
  // currentIncome nếu resolver tìm thấy, null chỉ còn nghĩa là genuinely missing. ----
  var peopleRows = [];
  var drillDown = data.drillDown || {};
  Object.keys(drillDown).sort(function(a,b){return a.localeCompare(b,'vi');}).forEach(function(dept){
    (drillDown[dept]||[]).forEach(function(person){
      var row = {
        department: dept, employeeCode: person.employeeCode, employeeName: person.employeeName,
        title: person.title || '',
        knlGrade: person.knlGrade ? ((person.knlGrade.frameworkName||person.knlGrade.frameworkCode||'')+' · '+(person.knlGrade.label||person.knlGrade.gradeCode||'')) : ''
      };
      if(incomeVisible){
        row.currentIncome = person.currentIncome==null?null:person.currentIncome;
        row.previousIncome = person.previousIncome==null?null:person.previousIncome;
        row.deltaAmount = person.deltaAmount==null?null:person.deltaAmount;
        row.deltaPct = person.deltaPct==null?null:person.deltaPct;
        row.dataStatus = person.currentIncome==null
          ? 'Thiếu dữ liệu — chưa có cơ cấu thu nhập hiệu lực đến kỳ này'
          : 'Có dữ liệu';
      }
      peopleRows.push(row);
    });
  });

  // ---- 05 Thông tin báo cáo ----
  var filterRows = [
    { label:'Phòng ban', value: filters.department || 'Tất cả' },
    { label:'Chi nhánh', value: filters.branch || 'Tất cả' },
    { label:'Chức danh', value: filters.title || 'Tất cả' },
    { label:'Bậc KNL', value: filters.knlGradeCode || 'Tất cả' },
    { label:'Chế độ thời gian', value: DASHBOARD_RANGE_MODE_LABELS[filters.rangeChoice] || filters.rangeChoice || 'Theo tháng' }
  ];
  var scopeRows = [
    { label:'Phạm vi nhân sự', value: meta.peopleScopeType ? (SCOPE_LABELS[meta.peopleScopeType]||meta.peopleScopeType) : '—' },
    { label:'Phạm vi thu nhập', value: incomeVisible ? (meta.incomeScopeType ? (SCOPE_LABELS[meta.incomeScopeType]||meta.incomeScopeType) : '—') : 'Không có quyền xem Thu nhập' },
    { label:'Ghi chú phạm vi', value: meta.scopeNote || '' }
  ];
  var coverageRosterRows = (meta.periodCoverage||[]).map(function(p){
    return { period: p.period, status: knlExportCoverageLabel(p.coverageStatus,p.isFuture), expectedCount: p.expectedCount, coveredCount: p.coveredCount, missingCount: p.missingCount };
  });

  return {
    fileName: knlExportFileName(meta, filters),
    incomeVisible: incomeVisible,
    generatedAt: meta.generatedAt || null,
    exportedByName: (typeof currentUserName==='function' ? currentUserName() : ''),
    overview: { periodBlock: periodBlock, coverageBlock: coverageBlock, kpiRows: kpiRows, trendRows: trendRows },
    department: { rows: departmentRows },
    grade: { knlDistributionRows: knlDistributionRows, incomeByGradeRows: incomeByGradeRows, matrixRows: matrixRows },
    people: { rows: peopleRows },
    reportInfo: { filterRows: filterRows, scopeRows: scopeRows, coverageRosterRows: coverageRosterRows, availablePeriods: meta.availablePeriods||[] }
  };
}
if(typeof window!=='undefined') window.buildKnlExportModel = buildKnlExportModel;

function ensureKnlExcelJs(){
  if(window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if(window.__phfKnlExcelJsLoadingPromise) return window.__phfKnlExcelJsLoadingPromise;
  window.__phfKnlExcelJsLoadingPromise = new Promise(function(resolve,reject){
    var script = document.createElement('script');
    script.src = 'assets/vendor/exceljs.min.js?v=4.4.0_phf_knl_1.58.0';
    script.async = true;
    script.onload = function(){ window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('Không khởi tạo được thư viện tạo Excel.')); };
    script.onerror = function(){ reject(new Error('Không tải được thư viện tạo Excel.')); };
    document.head.appendChild(script);
  }).catch(function(error){ window.__phfKnlExcelJsLoadingPromise=null; throw error; });
  return window.__phfKnlExcelJsLoadingPromise;
}
function knlExportSheetTitle(sheet, title, columnCount){
  sheet.mergeCells(1,1,1,Math.max(2,columnCount));
  var cell = sheet.getCell(1,1);
  cell.value = title;
  cell.font = { name:'Arial', size:15, bold:true, color:{argb:'FFFFFFFF'} };
  cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF0B5D47'} };
  cell.alignment = { vertical:'middle' };
  sheet.getRow(1).height = 30;
}
function knlExportHeaderRow(sheet, rowNumber, headers){
  var row = sheet.getRow(rowNumber);
  row.values = headers;
  row.height = 24;
  row.font = { name:'Arial', size:10, bold:true, color:{argb:'FFFFFFFF'} };
  row.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF0B5D47'} };
  row.alignment = { vertical:'middle', horizontal:'center', wrapText:true };
  sheet.autoFilter = { from:{row:rowNumber,column:1}, to:{row:rowNumber,column:headers.length} };
  sheet.views = [{ state:'frozen', ySplit: rowNumber, showGridLines:false }];
}
function knlExportSetWidths(sheet, widths){ widths.forEach(function(w,i){ sheet.getColumn(i+1).width=w; }); }
function knlExportDownloadBuffer(buffer, fileName){
  var blob = new Blob([buffer], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
}
async function renderKnlExportWorkbook(model){
  var ExcelJS = await ensureKnlExcelJs();
  var wb = new ExcelJS.Workbook();
  wb.creator='PHF KNL'; wb.company='PHUHOA FRESH';
  wb.created = model.generatedAt ? new Date(model.generatedAt) : new Date();
  wb.modified = new Date();

  var s1 = wb.addWorksheet('01_Tổng quan', {properties:{defaultRowHeight:20}});
  knlExportSheetTitle(s1, 'PHF KNL · Báo cáo Tổng quan Dashboard', 5);
  s1.mergeCells(2,1,2,5);
  s1.getCell(2,1).value = 'Xuất lúc '+(model.generatedAt?new Date(model.generatedAt).toLocaleString('vi-VN'):'')+' · Người xuất: '+(model.exportedByName||'—');
  s1.getCell(2,1).font = { italic:true, size:10, color:{argb:'FF527268'} };
  var r = 4, pb = model.overview.periodBlock, cb = model.overview.coverageBlock;
  function line(label,value){ s1.getCell(r,1).value=label; s1.getCell(r,1).font={bold:true}; s1.getCell(r,2).value=value; r++; }
  line('Chế độ thời gian', pb.rangeMode==='range' ? ('Khoảng '+knlExportPeriodLabel(pb.rangeStart)+' → '+knlExportPeriodLabel(pb.rangeEnd)) : ('Theo tháng '+knlExportPeriodLabel(pb.snapshotPeriod)));
  line('Kỳ dùng cho số liệu (snapshot)', knlExportPeriodLabel(pb.snapshotPeriod));
  line('Kỳ so sánh biến động', pb.comparisonBase ? knlExportPeriodLabel(pb.comparisonBase) : 'Chưa đủ dữ liệu để so sánh');
  if(pb.snapshotDiffersFromRangeEnd) line('Lưu ý', 'Kỳ cuối khoảng đang chọn ('+knlExportPeriodLabel(pb.rangeEnd)+') chưa đủ dữ liệu/là kỳ tương lai — số liệu dùng kỳ gần nhất đã hoàn chỉnh: '+knlExportPeriodLabel(pb.snapshotPeriod)+'.');
  line('Trạng thái dữ liệu kỳ snapshot', knlExportCoverageLabel(cb.status, cb.isFuture));
  if(cb.expectedCount!=null) line('Độ phủ dữ liệu', cb.coveredCount+'/'+cb.expectedCount+' nhân sự ('+cb.missingCount+' thiếu dữ liệu thật)');
  r++;
  knlExportHeaderRow(s1, r, ['Chỉ số','Giá trị']); r++;
  model.overview.kpiRows.forEach(function(item){ var row=s1.getRow(r); row.getCell(1).value=item.label; row.getCell(2).value=item.value; if(item.isMoney) row.getCell(2).numFmt='#,##0'; r++; });
  r+=1;
  if(model.overview.trendRows.length){
    s1.getCell(r,1).value='Biến động theo kỳ'; s1.getCell(r,1).font={bold:true,color:{argb:'FF0B5D47'}}; r++;
    knlExportHeaderRow(s1, r, ['Kỳ','Tổng quỹ','Nhân sự','Bình quân/người','Trạng thái']); r++;
    model.overview.trendRows.forEach(function(t){ var row=s1.getRow(r); row.values=[knlExportPeriodLabel(t.period),t.fund,t.headcount,t.avgIncome,t.status]; row.getCell(2).numFmt='#,##0'; row.getCell(4).numFmt='#,##0'; r++; });
  }
  s1.getCell(r+1,1).value='Ghi chú: số liệu "kỳ hiện tại" áp dụng cơ cấu ACTIVE gần nhất tính đến kỳ đó nếu nhân sự không có thay đổi trong kỳ (không phải kỳ bị thiếu dữ liệu).';
  s1.getCell(r+1,1).font={italic:true,size:9,color:{argb:'FF789087'}};
  knlExportSetWidths(s1, [34,26,16,20,18]);

  var s2 = wb.addWorksheet('02_Phòng ban');
  var deptHeaders = model.incomeVisible
    ? ['Phòng ban','Tổng nhân sự','Quỹ thu nhập','Tỷ trọng quỹ (%)','Bình quân/người','Quỹ kỳ trước','Biến động (số tiền)','Biến động (%)']
    : ['Phòng ban','Tổng nhân sự'];
  knlExportSheetTitle(s2, '02 · So sánh phòng ban', deptHeaders.length);
  knlExportHeaderRow(s2, 3, deptHeaders);
  model.department.rows.forEach(function(row,i){
    var excelRow = s2.getRow(4+i);
    excelRow.values = model.incomeVisible
      ? [row.department,row.headcount,row.fund,row.sharePct,row.avgIncome,row.previousFund,row.deltaAmount,row.deltaPct]
      : [row.department,row.headcount];
    if(model.incomeVisible){
      [3,5,6,7].forEach(function(c){ excelRow.getCell(c).numFmt='#,##0'; });
      [4,8].forEach(function(c){ excelRow.getCell(c).numFmt='0.0"%"'; });
    }
  });
  knlExportSetWidths(s2, model.incomeVisible ? [22,14,18,16,18,18,18,14] : [26,16]);

  var s3 = wb.addWorksheet('03_Bậc lương');
  knlExportSheetTitle(s3, '03 · Phân bố & Ma trận bậc lương', 5);
  var rr=3;
  s3.getCell(rr,1).value='Phân bố bậc KNL (năng lực)'; s3.getCell(rr,1).font={bold:true,color:{argb:'FF0B5D47'}}; rr++;
  knlExportHeaderRow(s3, rr, ['Bộ KNL','Bậc','Số người']); rr++;
  model.grade.knlDistributionRows.forEach(function(g){ s3.getRow(rr).values=[g.frameworkName,g.gradeLabel,g.count]; rr++; });
  rr+=1;
  if(model.incomeVisible){
    s3.getCell(rr,1).value='Thu nhập theo bậc KNL'; s3.getCell(rr,1).font={bold:true,color:{argb:'FF0B5D47'}}; rr++;
    knlExportHeaderRow(s3, rr, ['Ngạch/Bộ','Bậc','Số người','Bình quân/người','Biến động TB (%)']); rr++;
    model.grade.incomeByGradeRows.forEach(function(g){ var row=s3.getRow(rr); row.values=[g.frameworkCode,g.gradeLabel,g.count,g.avgIncome,g.avgDeltaPct]; row.getCell(4).numFmt='#,##0'; if(g.avgDeltaPct!=null)row.getCell(5).numFmt='0.0"%"'; rr++; });
    rr+=1;
    s3.getCell(rr,1).value='Ma trận bậc lương — tổng hợp theo phòng ban/ngạch/bậc'; s3.getCell(rr,1).font={bold:true,color:{argb:'FF0B5D47'}}; rr++;
    knlExportHeaderRow(s3, rr, ['Phòng ban','Ngạch','Bậc','Số người']); rr++;
    model.grade.matrixRows.forEach(function(m){ s3.getRow(rr).values=[m.department,m.ladderName,m.gradeLabel,m.count]; rr++; });
  }
  knlExportSetWidths(s3, [26,18,14,20,18]);

  var s4 = wb.addWorksheet('04_Chi tiết nhân sự');
  var peopleHeaders = model.incomeVisible
    ? ['Phòng ban','Mã NV','Họ tên','Chức danh','Bậc KNL','Thu nhập kỳ hiện tại','Thu nhập kỳ so sánh','Biến động (số tiền)','Biến động (%)','Trạng thái dữ liệu']
    : ['Phòng ban','Mã NV','Họ tên','Chức danh','Bậc KNL'];
  knlExportSheetTitle(s4, '04 · Chi tiết nhân sự', peopleHeaders.length);
  knlExportHeaderRow(s4, 3, peopleHeaders);
  model.people.rows.forEach(function(p,i){
    var row = s4.getRow(4+i);
    row.values = model.incomeVisible
      ? [p.department,p.employeeCode,p.employeeName,p.title,p.knlGrade,p.currentIncome,p.previousIncome,p.deltaAmount,p.deltaPct,p.dataStatus]
      : [p.department,p.employeeCode,p.employeeName,p.title,p.knlGrade];
    if(model.incomeVisible){
      [6,7,8].forEach(function(c){ row.getCell(c).numFmt='#,##0'; });
      if(p.deltaPct!=null) row.getCell(9).numFmt='0.0"%"';
    }
  });
  knlExportSetWidths(s4, model.incomeVisible ? [22,12,24,20,26,18,18,18,14,42] : [24,12,24,20,26]);

  var s5 = wb.addWorksheet('05_Thông tin báo cáo');
  knlExportSheetTitle(s5, '05 · Thông tin báo cáo', 5);
  var r5=3;
  s5.getCell(r5,1).value='Bộ lọc áp dụng'; s5.getCell(r5,1).font={bold:true,color:{argb:'FF0B5D47'}}; r5++;
  model.reportInfo.filterRows.forEach(function(f){ s5.getRow(r5).values=[f.label,f.value]; r5++; });
  r5+=1;
  s5.getCell(r5,1).value='Phạm vi quyền'; s5.getCell(r5,1).font={bold:true,color:{argb:'FF0B5D47'}}; r5++;
  model.reportInfo.scopeRows.forEach(function(sc){ s5.getRow(r5).values=[sc.label,sc.value]; r5++; });
  r5+=1;
  if(model.reportInfo.coverageRosterRows.length){
    s5.getCell(r5,1).value='Độ phủ dữ liệu theo từng kỳ trong phạm vi xuất'; s5.getCell(r5,1).font={bold:true,color:{argb:'FF0B5D47'}}; r5++;
    knlExportHeaderRow(s5, r5, ['Kỳ','Trạng thái','Kỳ vọng','Đã có dữ liệu','Thiếu dữ liệu']); r5++;
    model.reportInfo.coverageRosterRows.forEach(function(c){ s5.getRow(r5).values=[knlExportPeriodLabel(c.period),c.status,c.expectedCount,c.coveredCount,c.missingCount]; r5++; });
    r5+=1;
  }
  s5.getCell(r5,1).value='Đây là bản xuất báo cáo quản trị đúng phạm vi/quyền/khoảng thời gian người xuất đang xem trên Dashboard tại thời điểm xuất — không phải database dump.';
  s5.getCell(r5,1).font={italic:true,size:9,color:{argb:'FF789087'}};
  knlExportSetWidths(s5, [30,40,16,16,16]);

  [s1,s2,s3,s4,s5].forEach(function(sheet){
    sheet.eachRow(function(row){ row.eachCell(function(cell){ cell.alignment=Object.assign({vertical:'middle'},cell.alignment||{}); if(!cell.font)cell.font={name:'Arial',size:10}; }); });
  });

  var buffer = await wb.xlsx.writeBuffer();
  knlExportDownloadBuffer(buffer, model.fileName);
}
function knlExportToast(type,title,message){ knlToast(type,title,message); }
async function exportKnlDashboardWorkbook(root){
  if(dashboardState.exporting || !dashboardState.data) return;
  dashboardState.exporting = true;
  renderKnlDashboardBody(root);
  try{
    var model = buildKnlExportModel(dashboardState.data, dashboardState.filters);
    await renderKnlExportWorkbook(model);
    knlExportToast('success','Đã tạo file Excel','Đã xuất đúng phạm vi/kỳ đang xem trên Dashboard ('+model.fileName+').');
  }catch(error){
    knlExportToast('error','Chưa thể xuất Excel',(error&&error.message)||'Vui lòng thử lại.');
  }finally{
    dashboardState.exporting = false;
    renderKnlDashboardBody(root);
  }
}

function renderKnlDashboardBody(root){
  var body = root.querySelector('[data-knl-body]');
  if(!body || !dashboardState.data) return;
  var d = dashboardState.data, meta = d.meta||{}, kpis = d.kpis||{}, filterOptions = meta.filterOptions||{departments:[],branches:[],titles:[],knlGrades:[]};
  var incomeVisible = meta.incomeVisible === true;
  var scopeNoteHtml = meta.scopeNote ? '<p class="phfk-dash-empty-note phfk-dash-scope-note">Lưu ý: '+esc(meta.scopeNote)+'.</p>' : '';
  var incomeOffNoteHtml = !incomeVisible ? '<p class="phfk-dash-empty-note phfk-dash-scope-note">Tài khoản chưa được cấp quyền "Truy cập mục Thu nhập" — các số liệu thu nhập hiển thị "—".</p>' : '';
  var periodStatusNoteHtml = dashboardPeriodStatusNoteHtml(meta);
  var totalHeadcountShown = kpis.totalHeadcount!=null ? String(kpis.totalHeadcount) : '—';

  var actionStats = d.actionStats || {};
  var totalHeadcount = Number(kpis.totalHeadcount)||0;
  var missingKnl = actionStats.missingKnl==null ? null : Math.max(0,Number(actionStats.missingKnl)||0);
  var assignedKnl = missingKnl==null ? null : Math.max(0,totalHeadcount-missingKnl);
  var assignedKnlPct = totalHeadcount>0 && assignedKnl!=null ? Math.round((assignedKnl/totalHeadcount)*1000)/10 : null;
  var assignedKnlValue = assignedKnl==null ? '—' : assignedKnl+'/'+totalHeadcount+' người';
  var assignedKnlNote = assignedKnlPct==null ? 'Chưa đủ dữ liệu để tính tỷ lệ' : dashShareText(assignedKnlPct)+' nhân sự trong phạm vi đã có Bậc KNL';
  var currentTrend=(d.trend||[]).find(function(row){return row.period===meta.currentPeriod;})||null;
  var previousTrend=(d.trend||[]).find(function(row){return row.period===meta.previousPeriod;})||null;
  var fundDelta=dashDeltaOf(currentTrend&&currentTrend.fund,previousTrend&&previousTrend.fund);
  var avgDelta=dashDeltaOf(currentTrend&&currentTrend.avgIncome,previousTrend&&previousTrend.avgIncome);
  var fundSeries=(d.trend||[]).map(function(row){return {period:row.period,value:row.fund};});
  var avgSeries=(d.trend||[]).map(function(row){return {period:row.period,value:row.avgIncome};});
  var generatedLabel=meta.generatedAt?fmtKnlDateTime(meta.generatedAt):'';
  var periodOptions=(meta.availablePeriods||[]).map(function(period){var parts=String(period).split('-');return {code:period,label:parts.length===2?(parts[1]+'/'+parts[0]):period};});
  var knlFilterOptions=(filterOptions.knlGrades||[]).map(function(option,index){
    var grade=(d.knlDistribution||[])[index];
    if(!grade) return option;
    return {code:option.code,label:(grade.frameworkName||grade.frameworkCode||'Bộ KNL')+' · '+(grade.label||grade.gradeCode)};
  });

  body.innerHTML = '' +
    '<div class="phfk-dash">' +
      '<div class="phfk-page-head phfk-dash-head">' +
        '<div><h1>Tổng quan KNL</h1><p class="phfk-dash-subtitle">Nhân lực · Năng lực · Thu nhập</p></div>' +
        '<div class="phfk-dash-head-actions"><div class="phfk-dash-period phfk-dash-range">' +
          dashboardRangeModeSelectHtml(dashboardState.filters.rangeChoice) +
          (dashboardState.filters.rangeChoice==='custom'
            ? dashboardCustomRangeControlsHtml(dashboardState.filters, meta)
            : (dashboardState.filters.rangeChoice==='month' ? dashboardFilterSelect('period', 'Kỳ dữ liệu', periodOptions, dashboardState.filters.period) : '')) +
          (generatedLabel?'<small>Cập nhật: '+esc(generatedLabel)+'</small>':'') +
          dashboardRangeErrorHtml(dashboardState.rangeError) +
        '</div><button type="button" class="phfk-btn-secondary" data-dash-export'+(dashboardState.exporting?' disabled':'')+'>'+(dashboardState.exporting?'Đang tạo Excel…':'Xuất Excel')+'</button><button type="button" class="phfk-btn-secondary phfk-dash-ai-jump" data-dash-ai-jump>✦&nbsp; Gợi ý phân tích AI</button></div>' +
      '</div>' +

      '<div class="phfk-filters phfk-dash-filters">' +
        dashboardFilterSelect('department', 'Tất cả phòng ban', filterOptions.departments||[], dashboardState.filters.department) +
        dashboardFilterSelect('branch', 'Tất cả chi nhánh', filterOptions.branches||[], dashboardState.filters.branch) +
        dashboardFilterSelect('title', 'Tất cả chức danh', filterOptions.titles||[], dashboardState.filters.title) +
        dashboardFilterSelect('knlGradeCode', 'Tất cả bậc KNL', knlFilterOptions, dashboardState.filters.knlGradeCode) +
      '</div>' +
      scopeNoteHtml + incomeOffNoteHtml + periodStatusNoteHtml + dashboardRangeSummaryHtml(meta) +

      '<div class="phfk-dash-kpis">' +
        dashboardKpiTileHtml('◈', 'Tổng quỹ thu nhập', 'income', dashMoney(kpis.totalFund), meta.currentPeriod?('Kỳ '+meta.currentPeriod):'Chưa có kỳ lương nào trong phạm vi',fundDelta,{series:fundSeries,sparkTone:'income',sparkLabel:'Tổng quỹ thu nhập'}) +
        dashboardKpiTileHtml('◍', 'Tổng nhân sự', 'people', totalHeadcountShown, 'Trong phạm vi được xem',null,{unit:'người'}) +
        dashboardKpiTileHtml('◎', 'Thu nhập bình quân / người', 'average', dashMoney(kpis.avgIncome), kpis.incomePopulation!=null?(kpis.incomePopulation+'/'+totalHeadcountShown+' người có dữ liệu thu nhập'): 'Chưa có kỳ lương nào trong phạm vi',avgDelta,{series:avgSeries,sparkTone:'average',sparkLabel:'Thu nhập bình quân trên người'}) +
        dashboardKpiTileHtml('✓', 'Đã gán KNL', 'competency', assignedKnlValue, assignedKnlNote,null,{progress:assignedKnlPct}) +
      '</div>' +

      '<div class="phfk-dash-structure-grid"><section class="phfk-panel phfk-dash-panel phfk-dash-income-movement"><div class="phfk-dash-panel-head"><div><h2>Thu nhập &amp; biến động</h2><p>So sánh theo các kỳ lương thực tế có trong phạm vi</p></div></div>'+dashboardIncomeMovementHtml(d.trend||[],meta)+'</section>'+

      '<section class="phfk-panel phfk-dash-panel phfk-dash-panel-compact phfk-dash-composition">' +
          '<div class="phfk-dash-panel-head"><div><h2>Cơ cấu quỹ thu nhập theo phòng ban</h2><p>Tỷ trọng trên tổng quỹ thu nhập'+(meta.currentPeriod?' ('+esc(dashPeriodText(meta.currentPeriod))+')':'')+'</p></div></div>' +
          (incomeVisible ? dashboardRankedBarsHtml((d.deptComposition||[]).filter(function(x){return x.fund;}))
            : '<p class="phfk-dash-empty-note">Không có quyền xem Thu nhập.</p>') +
      '</section></div>' +

      '<section class="phfk-panel phfk-dash-panel phfk-dash-panel-primary">' +
        '<div class="phfk-dash-panel-head"><h2 class="phfk-dash-panel-title">So sánh phòng ban</h2><button type="button" class="phfk-btn-secondary phfk-dash-detail-toggle" data-dash-compare-details>'+(dashboardState.compareDetailed?'Ẩn chi tiết':'Xem chi tiết')+'</button></div>' +
        '<p class="phfk-dash-panel-note">Đối chiếu tỷ trọng nhân sự với tỷ trọng quỹ thu nhập trong cùng phạm vi.</p>'+
        dashboardCompareChartHtml(d.deptComparison||[], incomeVisible, dashboardState.openDept, kpis.totalHeadcount, kpis.totalFund) +
        ((dashboardState.compareDetailed||dashboardState.openDept) ? '<div class="phfk-dash-detail-table">'+dashboardCompareTableHtml(d.deptComparison||[], incomeVisible, dashboardState.openDept, kpis.totalHeadcount, kpis.totalFund)+'</div>' : '') +
      '</section>' +
      '<div class="phfk-dash-detail-layout'+(dashboardState.openDept?' is-open':'')+'">'+dashboardAttentionHtml(d.insights||[],actionStats)+
      (dashboardState.openDept ? dashboardDrillDownHtml(dashboardState.openDept, (d.drillDown||{})[dashboardState.openDept]) : '') +'</div>'+
      dashboardMissingKnlPanelHtml(d.drillDown||{},meta)+
      dashboardKnlSectionHtml(d.drillDown||{},incomeVisible,dashboardState.filters.department,assignedKnl,missingKnl,totalHeadcount)+
      dashboardCompensationGradeMatrixHtml(d.compensationGradeMatrix,incomeVisible)+
      dashboardAiPanelHtml() +
    '</div>';

  body.querySelectorAll('[data-dash-filter]').forEach(function(el){
    el.addEventListener('change', function(){
      dashboardState.filters[el.getAttribute('data-dash-filter')] = el.value;
      dashboardState.openDept = '';
      dashboardState.compareDetailed = false;
      dashboardState.selectedKnlDept = '';
      dashboardState.selectedFramework = '';
      dashboardState.missingKnlOpen = false;
      dashboardState.matrixQuickView = null;
      dashboardState.ai = { pending:false, error:'', reply:'', contextSummary:[], question:'' };
      loadKnlDashboard(root);
    });
  });
  function dashboardResetDrillState(){
    dashboardState.openDept = '';
    dashboardState.compareDetailed = false;
    dashboardState.selectedKnlDept = '';
    dashboardState.selectedFramework = '';
    dashboardState.missingKnlOpen = false;
    dashboardState.matrixQuickView = null;
    dashboardState.ai = { pending:false, error:'', reply:'', contextSummary:[], question:'' };
  }
  var rangeModeEl = body.querySelector('[data-dash-range-mode]');
  if(rangeModeEl) rangeModeEl.addEventListener('change', function(){
    var mode = rangeModeEl.value;
    dashboardState.filters.rangeChoice = mode;
    dashboardState.rangeError = '';
    dashboardResetDrillState();
    if(mode==='month'){
      dashboardState.filters.periodFrom = ''; dashboardState.filters.periodTo = ''; dashboardState.filters.rangePreset = '';
      loadKnlDashboard(root);
    } else if(mode==='last3' || mode==='quarter_current' || mode==='quarter_previous'){
      // Gửi đúng contract Phase 1: chỉ rangePreset, KHÔNG tự tính periodFrom/
      // periodTo ở frontend — backend (resolveRangeWindow) là nguồn duy nhất.
      dashboardState.filters.period = ''; dashboardState.filters.periodFrom = ''; dashboardState.filters.periodTo = '';
      dashboardState.filters.rangePreset = mode;
      loadKnlDashboard(root);
    } else if(mode==='custom'){
      // Chưa đủ 2 đầu -> chỉ render lại control, KHÔNG gọi API cho tới khi
      // người dùng chọn đủ Từ tháng/Đến tháng hợp lệ.
      dashboardState.filters.rangePreset = '';
      renderKnlDashboardBody(root);
    }
  });
  function dashboardValidateCustomRange(from, to){
    if(!from || !to) return null; // chưa đủ 2 đầu -> chưa validate, chưa gọi API
    if(from > to) return 'Từ tháng phải trước hoặc bằng Đến tháng.';
    var span = dashboardYmDiffMonths(from, to) + 1;
    if(span > 12) return 'Khoảng thời gian tối đa 12 tháng.';
    return null;
  }
  function dashboardOnCustomRangeChange(){
    var from = dashboardState.filters.periodFrom, to = dashboardState.filters.periodTo;
    var error = dashboardValidateCustomRange(from, to);
    if(error){
      dashboardState.rangeError = error;
      renderKnlDashboardBody(root); // lỗi inline, KHÔNG alert(), KHÔNG gọi API với range sai
      return;
    }
    dashboardState.rangeError = '';
    if(from && to){
      dashboardResetDrillState();
      loadKnlDashboard(root);
    } else {
      renderKnlDashboardBody(root);
    }
  }
  var rangeFromEl = body.querySelector('[data-dash-range-from]');
  if(rangeFromEl) rangeFromEl.addEventListener('change', function(){ dashboardState.filters.periodFrom = rangeFromEl.value; dashboardOnCustomRangeChange(); });
  var rangeToEl = body.querySelector('[data-dash-range-to]');
  if(rangeToEl) rangeToEl.addEventListener('change', function(){ dashboardState.filters.periodTo = rangeToEl.value; dashboardOnCustomRangeChange(); });
  var exportBtn = body.querySelector('[data-dash-export]');
  if(exportBtn) exportBtn.addEventListener('click', function(){ exportKnlDashboardWorkbook(root); });

  var compareDetails=body.querySelector('[data-dash-compare-details]');
  if(compareDetails) compareDetails.addEventListener('click',function(){ dashboardState.matrixQuickView=null;dashboardState.compareDetailed=!dashboardState.compareDetailed; renderKnlDashboardBody(root); });
  body.querySelectorAll('[data-dash-framework]').forEach(function(el){ el.addEventListener('click',function(){ dashboardState.matrixQuickView=null;dashboardState.selectedFramework=el.getAttribute('data-dash-framework'); renderKnlDashboardBody(root); }); });
  body.querySelectorAll('[data-dash-knl-dept]').forEach(function(el){el.addEventListener('click',function(){dashboardState.matrixQuickView=null;dashboardState.selectedKnlDept=el.getAttribute('data-dash-knl-dept');dashboardState.selectedFramework='';renderKnlDashboardBody(root);});});
  var knlOverview=body.querySelector('[data-dash-knl-overview]');if(knlOverview)knlOverview.addEventListener('click',function(){dashboardState.matrixQuickView=null;dashboardState.selectedKnlDept='';dashboardState.selectedFramework='';renderKnlDashboardBody(root);});
  body.querySelectorAll('[data-dash-matrix-open]').forEach(function(el){el.addEventListener('click',function(){dashboardState.matrixQuickView={department:el.getAttribute('data-dash-matrix-department'),ladderCode:el.getAttribute('data-dash-matrix-ladder'),gradeNumber:Number(el.getAttribute('data-dash-matrix-grade-number'))};renderKnlDashboardBody(root);var panel=body.querySelector('[data-dash-matrix-panel]');if(panel)panel.focus();});});
  var matrixPanel=body.querySelector('[data-dash-matrix-panel]');
  function closeMatrixQuick(){var current=dashboardState.matrixQuickView;dashboardState.matrixQuickView=null;renderKnlDashboardBody(root);if(current){var trigger=Array.prototype.find.call(body.querySelectorAll('[data-dash-matrix-open]'),function(el){return el.getAttribute('data-dash-matrix-department')===current.department&&el.getAttribute('data-dash-matrix-ladder')===current.ladderCode&&Number(el.getAttribute('data-dash-matrix-grade-number'))===Number(current.gradeNumber);});if(trigger)trigger.focus();}}
  var matrixClose=body.querySelector('[data-dash-matrix-close]');if(matrixClose)matrixClose.addEventListener('click',closeMatrixQuick);
  if(matrixPanel)matrixPanel.addEventListener('keydown',function(event){if(event.key==='Escape'){event.preventDefault();closeMatrixQuick();}});
  var aiJump=body.querySelector('[data-dash-ai-jump]');
  if(aiJump) aiJump.addEventListener('click',function(){ var panel=body.querySelector('#phfkDashAi');if(panel){panel.scrollIntoView({behavior:'smooth',block:'start'});setTimeout(function(){panel.focus({preventScroll:true});},250);} });
  body.querySelectorAll('[data-dash-attention="missing-knl"]').forEach(function(el){el.addEventListener('click',function(){dashboardState.matrixQuickView=null;dashboardState.missingKnlOpen=true;renderKnlDashboardBody(root);var panel=body.querySelector('[data-dash-missing-panel]');if(panel&&typeof panel.scrollIntoView==='function')panel.scrollIntoView({behavior:'smooth',block:'nearest'});});});
  var missingClose=body.querySelector('[data-dash-missing-close]');if(missingClose)missingClose.addEventListener('click',function(){dashboardState.missingKnlOpen=false;renderKnlDashboardBody(root);});
  body.querySelectorAll('[data-dash-dept]').forEach(function(el){
    el.addEventListener('click', function(){
      var dept = el.getAttribute('data-dash-dept');
      dashboardState.matrixQuickView = null;
      dashboardState.openDept = dashboardState.openDept===dept ? '' : dept;
      renderKnlDashboardBody(root);
    });
  });
  body.querySelectorAll('[data-dash-employee]').forEach(function(el){
    el.addEventListener('click', function(){ goIncomeEmployee(el.getAttribute('data-dash-employee')); });
  });
  body.querySelectorAll('[data-dash-ai-prompt]').forEach(function(el){
    el.addEventListener('click', function(){ dashboardAskAi(root, el.textContent); });
  });
}

/* Extract-method thuần từ phfRenderKnl (KNL-09B) — KHÔNG đổi logic, chỉ tách
 * ra để renderIncomeRoute() (flow tải riêng cho income) dùng chung được,
 * không phải copy lại xử lý capabilities/authorizationSignature/cache
 * invalidation. Mọi tab khác vẫn gọi hàm này y hệt trước đây. */
function applyKnlCapabilities(capData){
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
    dashboardState.loaded=false;
    dashboardState.openDept='';
    dashboardState.compareDetailed=false;
    dashboardState.selectedKnlDept='';
    dashboardState.selectedFramework='';
    dashboardState.missingKnlOpen=false;
    dashboardState.matrixQuickView=null;
    dashboardState.ai={ pending:false, error:'', reply:'', contextSummary:[], question:'' };
  }
  knlAuthorizationSignature=authorizationSignature;
  var canPeople = isAdmin || capabilities.access_knl;
  var canPermissions = isAdmin || capabilities.manage_permissions;
  var canFrameworks = isAdmin || capabilities.manage_framework;
  peopleCanViewIncome = isAdmin || capabilities.income_view === true;
  /* Dashboard KNL (Gate 2): gate CHÍNH THỨC bằng capability dashboard_view —
     THAY THẾ hoàn toàn cách gate tạm theo tên preset ở Gate 1 (preset không
     phản ánh đúng vai trò thật, xem lib/knl-permissions.js). Admin có mặc
     định qua đường cứu hộ; Giám đốc/Trợ lý Tiên được PHF cấp thủ công qua
     màn Phân quyền KNL — KHÔNG hardcode employee_code/tên/preset ở đây.
     dashboard_view chỉ quyết định VÀO được Dashboard hay không; phạm vi dữ
     liệu bên trong vẫn do people_scope/incomeScope enforce ở backend
     (lib/knl-dashboard.js), không suy từ đây. */
  var canDashboard = isAdmin || capabilities.dashboard_view === true;
  return {isAdmin:isAdmin,capabilities:capabilities,canPeople:canPeople,canPermissions:canPermissions,canFrameworks:canFrameworks,canDashboard:canDashboard};
}

/* KNL-09B — flow tải riêng cho "Bậc & Cơ cấu thu nhập" (route co-cau-thu-nhap),
 * thay cho việc đi qua dispatcher chung + renderIncome() tuần tự cũ (giữ
 * nguyên renderIncome() bên dưới, chỉ dùng lại cho submitCorrection() refresh
 * sau khi Admin điều chỉnh kỳ hiệu lực — KHÔNG đổi hành vi hàm đó).
 *
 * Patch 1 (bỏ blank flash): nếu đã có shell + đã biết employee_code, vẽ
 * skeleton (incomeHtml() ở trạng thái incomeLoading=true) NGAY, tái dùng
 * chrome hiện có — không đợi capabilities, không có bước body='' nào ở giữa.
 * Patch 2 (gộp waterfall capabilities+income): 2 request này bắn cùng lúc
 * ngay đầu hàm (income cũng cần biết employee_code, đã có sẵn từ URL, không
 * cần đợi capabilities mới biết fetch ai — backend tự enforce quyền độc lập
 * cho từng action). Nếu capabilities reject, kết quả income dù đã fetch xong
 * KHÔNG được đọc vào foundationState/không render (không gắn .then() nào ở
 * nhánh lỗi).
 * Patch 3 (progressive): profile/income/nextGrade/competency/history mỗi cái
 * tự cập nhật đúng phần DOM của nó ngay khi resolve, không đợi nhau — income
 * vẫn là "gate" cho next grade/competency/history (giữ đúng test KNL-09 fix#2
 * cũ: income lỗi -> KHÔNG bắn 3 call đó, y hệt trước) nhưng KHÔNG còn gate
 * profile (profile bắn song song với income, cập nhật header độc lập).
 * knlIncomeLoadToken (đã có từ KNL-09) bảo vệ MỌI progressive update ở đây,
 * cộng thêm cờ incomeDenied cục bộ để chặn trường hợp profile resolve SAU khi
 * income đã fail (không được vẽ đè lên noAccessSection vừa hiện). */
async function renderIncomeRoute(root,tab){
  var url=new URL(location.href),queryCode=String(url.searchParams.get('employee_code')||'').trim().toUpperCase(),choose=url.searchParams.get('choose_employee')==='1';
  var myToken=++knlIncomeLoadToken;
  var existingShell=root.querySelector('.phf-knl-root-shell');
  var reqPayload=queryCode?{employeeCode:queryCode}:undefined;
  var incomeDenied=false;

  foundationState.income=null;
  foundationState.incomeLoading=true;
  foundationState.nextCompensationGrade=undefined;
  foundationState.competency=undefined;
  foundationState.competencyHistory=undefined;
  foundationState.competencyGradeSequence=[];
  foundationState.competencyWindowStart=0;
  foundationState.profile=(queryCode&&foundationState.profile&&foundationState.profile.employeeCode===queryCode)?foundationState.profile:null;

  var capPromise=apiPost('getKnlCapabilities');
  var incomePromise=queryCode?apiPost('getKnlEmployeeIncome',reqPayload):null;
  var profilePromise=queryCode?apiPost('getKnlEmployeeProfile',reqPayload):null;
  if(incomePromise)incomePromise.catch(function(){});
  if(profilePromise)profilePromise.catch(function(){});

  if(existingShell&&queryCode){
    setShellActiveTab(root,tab);
    root.dataset.knlTab=tab;
    var skelBody=root.querySelector('[data-knl-body]');
    if(skelBody)skelBody.innerHTML=incomeHtml();
  }

  var capData;
  try{
    capData=await capPromise;
  }catch(e){
    if(myToken!==knlIncomeLoadToken)return true;
    if(root.querySelector('.phf-knl-root-shell')){
      var deniedBody=root.querySelector('[data-knl-body]');
      if(deniedBody)deniedBody.innerHTML=noAccessSection(e.message);
    }else root.innerHTML='<main class="phf-knl-placeholder"><section>'+noAccessSection(e.message)+'</section></main>';
    return true;
  }
  if(myToken!==knlIncomeLoadToken)return true;

  var capState=applyKnlCapabilities(capData);
  var isAdmin=capState.isAdmin,capabilities=capState.capabilities,canDashboard=capState.canDashboard;

  ensureKnlShell(root,tab,capabilities,isAdmin,incomeHtml(),canDashboard);
  bindIncomeSection(root);

  foundationState.incomeIsAdmin=isAdmin===true;
  foundationState.incomeCanSelect=isAdmin===true||(capabilities&&capabilities.income_view===true);

  if(!queryCode){
    if(isAdmin||(choose&&foundationState.incomeCanSelect)){
      foundationState.incomeLoading=false;
      await showIncomePicker(root);
      return true;
    }
    // Chưa biết employee lúc kick-off (cần capabilities mới biết đây là
    // self-view, không phải picker) -> fetch bây giờ, đúng 1 lần, không
    // duplicate (incomePromise/profilePromise trước đó vẫn null).
    incomePromise=apiPost('getKnlEmployeeIncome',undefined);
    profilePromise=apiPost('getKnlEmployeeProfile',undefined);
    incomePromise.catch(function(){});
    profilePromise.catch(function(){});
  }

  var pending=[];
  pending.push(profilePromise.then(function(r){
    if(myToken!==knlIncomeLoadToken||incomeDenied)return;
    foundationState.profile=r.profile;
    renderIncomeProgressive(root);
  },function(){
    if(myToken!==knlIncomeLoadToken||incomeDenied)return;
    foundationState.profile=null;
    renderIncomeProgressive(root);
  }));

  var incomeResult;
  try{
    incomeResult=await incomePromise;
  }catch(e){
    incomeDenied=true;
    foundationState.incomeLoading=false;
    if(myToken!==knlIncomeLoadToken)return true;
    if(!queryCode&&foundationState.incomeCanSelect&&e.code==='KNL_EMPLOYEE_CODE_REQUIRED'){
      await showIncomePicker(root,e.message);
    }else{
      var b=root.querySelector('[data-knl-body]');
      if(b)b.innerHTML=noAccessSection(e.message);
    }
    return true;
  }
  if(myToken!==knlIncomeLoadToken)return true;
  foundationState.income=incomeResult;
  foundationState.incomeLoading=false;
  renderIncomeProgressive(root);

  pending.push(apiPost('getKnlEmployeeNextCompensationGrade',reqPayload).then(function(r){
    if(myToken!==knlIncomeLoadToken)return;
    foundationState.nextCompensationGrade=r;
    renderIncomeProgressive(root);
  },function(){
    if(myToken!==knlIncomeLoadToken)return;
    foundationState.nextCompensationGrade=null;
    renderIncomeProgressive(root);
  }));

  pending.push(apiPost('getKnlEmployeeCompetencyStandard',reqPayload).then(function(r){
    if(myToken!==knlIncomeLoadToken)return;
    foundationState.competency=r;
    if(r&&r.hasAssignment){
      var seqBuilt=buildCompetencyGradeSequence(r);
      foundationState.competencyGradeSequence=seqBuilt;
      var curIdx=seqBuilt.findIndex(function(n){return n.isRealCurrent;});
      foundationState.competencyWindowStart=r.isMaxGrade?Math.max(0,curIdx-1):curIdx;
    }
    renderIncomeProgressive(root);
  },function(){
    if(myToken!==knlIncomeLoadToken)return;
    foundationState.competency=null;
    renderIncomeProgressive(root);
  }));

  pending.push(apiPost('listKnlEmployeeCompetencyHistory',reqPayload).then(function(r){
    if(myToken!==knlIncomeLoadToken)return;
    foundationState.competencyHistory=r;
    renderIncomeProgressive(root);
  },function(){
    if(myToken!==knlIncomeLoadToken)return;
    foundationState.competencyHistory=null;
    renderIncomeProgressive(root);
  }));

  await Promise.allSettled(pending);
  return true;
}
function renderIncomeProgressive(root){
  var body=root.querySelector('[data-knl-body]');
  if(!body)return;
  body.innerHTML=incomeHtml();
  bindIncomeSection(root);
}

window.phfRenderKnl = async function(path){
  if(window.PHFAppShell) window.PHFAppShell.activateKnl(path);
  var root = document.getElementById('phfKnlRoot');
  if(!root) return false;
  document.title = 'PHF Khung năng lực';
  if(knlActivePath)knlScrollMemory[knlActivePath]=window.scrollY||0;
  knlActivePath=path;
  var tab = /\/tieu-chuan-bac$/.test(path)?'tieu-chuan-bac':(/\/phien-ban-lich-su$/.test(path)?'phien-ban-lich-su':(/\/ngach-bac-luong$/.test(path)?'ngach-bac-luong':(/\/gan-thu-nhap$/.test(path)?'gan-thu-nhap':(/\/lich-su-thu-nhap$/.test(path)?'lich-su-thu-nhap':(/\/co-cau-thu-nhap$/.test(path)?'co-cau-thu-nhap':(/\/gan-ap-dung$/.test(path) ? 'gan-ap-dung' : (/\/bo-knl$/.test(path) ? 'bo-knl' : (/\/ket-qua-khao-sat$/.test(path) ? 'ket-qua-khao-sat' : (/\/khao-sat$/.test(path) ? 'khao-sat' : (/\/de-xuat-nang-bac$/.test(path) ? 'de-xuat-nang-bac' : (/\/phan-quyen$/.test(path) ? 'phan-quyen' : (/\/dashboard$/.test(path) ? 'dashboard' : 'nhan-su'))))))))))));
  if(root.querySelector('.phf-knl-root-shell'))showKnlPanelLoading(root,tab);
  else root.innerHTML = '<div class="phfk-loading">Đang tải…</div>';

  /* KNL-09B: "co-cau-thu-nhap" (Bậc & Cơ cấu thu nhập / Hồ sơ thu nhập) có
   * flow tải riêng (renderIncomeRoute) — capabilities + income + profile bắt
   * đầu song song, render tiến triển từng phần thay vì đợi cả 5 API xong mới
   * paint 1 lần. KHÔNG tab nào khác bị đụng — mọi tab còn lại vẫn đi qua
   * đúng dispatcher chung bên dưới, không đổi. */
  if(tab === 'co-cau-thu-nhap'){
    return await renderIncomeRoute(root,tab);
  }

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

  var capState = applyKnlCapabilities(capData);
  var isAdmin = capState.isAdmin, capabilities = capState.capabilities, canPeople = capState.canPeople, canPermissions = capState.canPermissions, canFrameworks = capState.canFrameworks, canDashboard = capState.canDashboard;

  if(tab === 'phan-quyen' && !canPermissions){
    ensureKnlShell(root,tab,capabilities,isAdmin,noAccessSection('Bạn chưa được cấp quyền "Quản lý phân quyền KNL".'),canDashboard);
    return true;
  }
  if(['bo-knl','tieu-chuan-bac','phien-ban-lich-su'].indexOf(tab)>=0 && !canFrameworks){
    ensureKnlShell(root,tab,capabilities,isAdmin,noAccessSection('Bạn chưa được cấp quyền quản lý cấu trúc KNL.'),canDashboard);
    return true;
  }
  if((tab === 'gan-ap-dung'||tab === 'ngach-bac-luong'||tab === 'gan-thu-nhap'||tab === 'lich-su-thu-nhap') && !isAdmin){
    ensureKnlShell(root,tab,capabilities,isAdmin,noAccessSection('Chỉ Admin được nạp source và quản trị assignment KNL.'),canDashboard);
    return true;
  }
  if(tab === 'nhan-su' && !canPeople){
    ensureKnlShell(root,'nhan-su',capabilities,isAdmin,noAccessSection('Tài khoản chưa được cấp quyền truy cập KNL. Vui lòng liên hệ Admin.'),canDashboard);
    return true;
  }
  var canProposalAny = isAdmin || capabilities.view_proposals === true || capabilities.propose === true || capabilities.agree_proposal === true || capabilities.approve === true;
  if(tab === 'de-xuat-nang-bac' && !canProposalAny){
    ensureKnlShell(root,tab,capabilities,isAdmin,noAccessSection('Tài khoản chưa được cấp quyền nào liên quan Đề xuất nâng bậc (xem/tạo/xử lý).'),canDashboard);
    return true;
  }
  if(tab === 'dashboard' && !canDashboard){
    ensureKnlShell(root,tab,capabilities,isAdmin,noAccessSection('Bạn chưa được cấp quyền xem Tổng quan KNL.'),canDashboard);
    return true;
  }

  ensureKnlShell(root,tab,capabilities,isAdmin,'',canDashboard);

  if(tab === 'tieu-chuan-bac'){
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
  }else if(tab === 'de-xuat-nang-bac'){
    await renderGradePromotionSection(root, capabilities, isAdmin);
  }else if(tab === 'dashboard'){
    if(dashboardState.loaded && Date.now()-dashboardState.loadedAt<KNL_READ_CACHE_TTL) renderKnlDashboardBody(root); else await loadKnlDashboard(root);
  }else{
    if(peopleState.loaded&&Date.now()-peopleState.loadedAt<KNL_READ_CACHE_TTL)renderPeopleBody(root);else await loadPeople(root);
  }
  restoreKnlScroll(path);
  return true;
};
})();
