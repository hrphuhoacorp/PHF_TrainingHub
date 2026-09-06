/* PHF Mobile App Shell — Bottom Navigation.
   Global chrome shown only on mobile (CSS-gated), only while an authenticated
   app route is active (Home/Hub/Classroom/Checklist/KNL). Uses only the
   existing public navigation API (window.phfNavigate) and the capability
   data already loaded/cached by phf-hr-home.js (window.phfEnsureChecklistWorkspace/
   phfDeriveChecklistCapabilities) — no new route, no new API, no router change. */
(function(){
'use strict';

function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function sessionRole(){try{return String((window.phfGetSessionRole&&window.phfGetSessionRole())||'').toLowerCase();}catch(e){return '';}}
function prefixFor(r){return r==='admin'?'/admin':(r==='manager'?'/ql':'/hv');}
function cleanPath(){return String(location.pathname||'/').replace(/\/{2,}/g,'/').replace(/\/$/,'')||'/';}
function isChecklistRoute(){return /^\/(admin|ql|hv)\/checklist(?:\/|$)/.test(cleanPath());}
function currentUser(){try{return (window.phfGetCurrentUser&&window.phfGetCurrentUser())||(window.phfGetAuthenticatedUser&&window.phfGetAuthenticatedUser())||null;}catch(e){return null;}}
function userName(){var u=currentUser()||{};return String(u.fullName||u.full_name||u.name||u.displayName||u.display_name||u.email||'Anh/chị').trim();}
function initials(){var n=userName().replace(/@.*$/,'').trim().split(/\s+/).filter(Boolean);if(!n.length)return 'PH';return (n.length===1?n[0].slice(0,2):n[0].charAt(0)+n[n.length-1].charAt(0)).toUpperCase();}
function roleLabel(r){return r==='admin'?'Quản trị hệ thống':(r==='manager'?'Quản lý':'Nhân viên');}
function go(path){if(window.phfNavigate)return window.phfNavigate(path);location.href=path;}
async function logout(){try{if(typeof window.phfLogoutSession==='function')await window.phfLogoutSession();else location.href='/';}catch(e){location.href='/';}}

/* Vỏ ứng dụng chỉ hiện khi đang ở một route đã đăng nhập thật (không hiện ở
   intro/login) — tái dùng đúng các class body đã có sẵn do PHFAppShell/các
   module gán khi kích hoạt, không thêm cơ chế phát hiện route mới. */
function isAppRouteActive(){
  var b=document.body.classList;
  return b.contains('phf-hr-gateway-mode')||b.contains('phf-hr-mode')||b.contains('phf-main-shell-mode')||b.contains('phf-classroom-mode')||b.contains('phf-checklist-mode')||b.contains('phf-knl-mode')||b.contains('phf-task-mode');
}

var root=null,lastCaps=null,capsRequested=false;

function ensureRoot(){
  if(root)return root;
  root=document.createElement('nav');
  root.id='phfMobileBottomNav';
  root.className='phf-mnav-bottom';
  root.setAttribute('aria-label','Điều hướng nhanh');
  root.hidden=true;
  root.innerHTML=
    '<button type="button" class="phf-mnav-btn" data-phf-mnav="menu"><span class="phf-mnav-icon" aria-hidden="true">☰</span><span class="phf-mnav-label">Menu</span></button>'+
    '<button type="button" class="phf-mnav-btn phf-mnav-main" data-phf-mnav="main"><span class="phf-mnav-icon" aria-hidden="true">＋</span><span class="phf-mnav-label">Trang chủ</span></button>'+
    '<button type="button" class="phf-mnav-btn" data-phf-mnav="account"><span class="phf-mnav-icon" aria-hidden="true">◍</span><span class="phf-mnav-label">Cá nhân</span></button>';
  document.body.appendChild(root);
  root.addEventListener('click',onNavClick);
  return root;
}

function mainAction(){
  var r=sessionRole(),p=prefixFor(r);
  if(isChecklistRoute()&&lastCaps&&lastCaps.canRecordViolation){
    return {label:'Ghi nhận lỗi',icon:'!',route:r==='admin'?'/admin/checklist/ghi-nhan-loi':'/ql/checklist?section=violations'};
  }
  return {label:'Trang chủ',icon:'⌂',route:p+'/home'};
}

function render(){
  var el=ensureRoot();
  var active=isAppRouteActive();
  el.hidden=!active;
  if(!active)return;
  var main=mainAction();
  var mainBtn=el.querySelector('[data-phf-mnav="main"]');
  if(mainBtn){
    mainBtn.querySelector('.phf-mnav-icon').textContent=main.icon;
    mainBtn.querySelector('.phf-mnav-label').textContent=main.label;
    mainBtn.setAttribute('data-phf-mnav-route',main.route);
    mainBtn.classList.toggle('is-cta',!!(isChecklistRoute()&&lastCaps&&lastCaps.canRecordViolation));
  }
}

function onNavClick(ev){
  var btn=ev.target&&ev.target.closest?ev.target.closest('[data-phf-mnav]'):null;
  if(!btn)return;
  var action=btn.getAttribute('data-phf-mnav');
  if(action==='main'){
    var route=btn.getAttribute('data-phf-mnav-route');
    if(route)go(route);
  }else if(action==='menu'){
    if(typeof window.phfOpenMobileSlideMenu==='function')window.phfOpenMobileSlideMenu();
  }else if(action==='account'){
    if(typeof window.phfToggleMobileAccountMenu==='function')window.phfToggleMobileAccountMenu(btn);
  }
}

/* Slide Menu — mở rộng đúng pattern của phf-hub-mobile-shell.js (drawer +
   backdrop + Escape + đóng khi đổi route) nhưng là controller RIÊNG, độc lập
   với drawer của Hub topbar (không đụng .phf-mobile-open/.phf-main-nav của
   Hub) để không có 2 bộ điều khiển giẫm chân nhau. Menu render theo đúng
   capability thật (lastCaps, cùng dữ liệu đã cache) - không hiện mục nào
   không có quyền rồi mới chặn khi bấm, ẩn hẳn ngay từ UI. */
function menuItemsFor(caps,r){
  var p=prefixFor(r),isAdminRoute=r==='admin';
  var violationsRoute=isAdminRoute?'/admin/checklist/ghi-nhan-loi':'/ql/checklist?section=violations';
  var reviewRoute=isAdminRoute?'/admin/checklist/phieu-danh-gia-thang':'/ql/checklist?section=reviews';
  var reportRoute=isAdminRoute?'/admin/checklist/bao-cao':'/ql/checklist/bao-cao';
  /* Sidebar quản lý (managerSidebarHtml trong phf-checklist-app.js) không còn
     render trên mobile - "Nhân sự"/"Phiếu của tôi" (2 mục không gate theo
     capability trong sidebar gốc) cần lối vào tương đương ở đây, chỉ cho tài
     khoản quản lý đang có grant thật (caps.experience==='operator'), không áp
     dụng cho Admin - Admin có mục quản trị RIÊNG ngay bên dưới (Nhân sự &
     phân công/Cài đặt), gate đúng theo caps.canManageUsers/canManageSystem
     (phfDeriveChecklistCapabilities trong phf-hr-home.js: luôn true cho
     admin, luôn false cho manager/learner) - không hard-code theo chức danh.
     "Phiếu của tôi" không có route thật cho Admin (Admin không có Checklist
     cá nhân) nên không thêm. */
  var inChecklist=isChecklistRoute();
  var isManagerWorkspace=!isAdminRoute&&caps&&caps.experience==='operator';
  var items=[];
  /* Module-context section (chỉ trong Checklist) — giữ nguyên: sidebar quản lý
     của Checklist không render trên mobile nên cần lối vào tương đương ở đây. */
  if(inChecklist){
    items.push({group:'CHECKLIST'});
    items.push({label:'Tổng quan',route:p+'/checklist',icon:'⌂'});
    if(caps&&caps.canRecordViolation)items.push({label:'Ghi nhận lỗi',route:violationsRoute,icon:'!'});
    if(isAdminRoute&&caps&&caps.canManageUsers)items.push({label:'Nhân sự & phân công',route:'/admin/checklist/nhan-su',icon:'♙'});
    if(caps&&caps.canReview)items.push({label:'Thẩm định',route:reviewRoute,icon:'✓'});
    if(caps&&caps.canViewReport)items.push({label:'Báo cáo',route:reportRoute,icon:'▥'});
    if(isManagerWorkspace)items.push({label:'Nhân sự',route:'/ql/checklist?section=people',icon:'♙'});
    if(isManagerWorkspace)items.push({label:'Phiếu của tôi',route:'/ql/checklist?section=my-work',icon:'▧'});
    if(!isManagerWorkspace&&!isAdminRoute)items.push({label:'Checklist của tôi',route:p+'/checklist',icon:'☰'});
    if(isAdminRoute&&caps&&caps.canManageSystem)items.push({label:'Cài đặt',route:'/admin/checklist/cai-dat',icon:'⚙'});
  }
  /* "Trang chủ" luôn đứng riêng ở trên (mục 3 của brief). */
  items.push({label:'Trang chủ',route:p+'/home',icon:'⌂'});
  /* Phần còn lại = CHIẾU (projection) của cây điều hướng web PHF HR sang dạng
     accordion cha→con, KHÔNG duy trì taxonomy phẳng riêng. Nguồn sự thật =
     window.phfHrNavModel() (hrNavModel trong phf-hr-home.js). Chỉ hiện con có
     route thật + được phép; bỏ mục 'soon'/'disabled' (Thưởng Hành động V.2,
     Lịch chấm công, QTTH, Báo cáo & Thống kê…) — không phơi làm đích đến. */
  var model=null;
  try{model=(typeof window.phfHrNavModel==='function')?window.phfHrNavModel():null;}catch(e){model=null;}
  if(model&&model.length){
    model.forEach(function(grp){
      var kids=(grp.children||[]).filter(function(c){return c&&c.href&&!c.soon&&!c.disabled;})
        .map(function(c){return {label:c.label,route:c.href,icon:NAV_ICON[c.icon]||'•'};});
      if(kids.length)items.push({accordion:true,key:grp.key,label:grp.label,children:kids});
    });
  }else{
    /* Fallback (phf-hr-home.js chưa nạp) — cây tối thiểu, cùng cấu trúc. */
    items.push({accordion:true,key:'cong-viec',label:'Công việc',children:[{label:'PHF Task',route:p+'/task',icon:'✔'}]});
    items.push({accordion:true,key:'phat-trien',label:'Đào tạo & Phát triển',children:[
      {label:'Training Hub',route:p,icon:'▦'},{label:'Classroom',route:p+'/classroom',icon:'▤'},{label:'Khung năng lực',route:p+'/knl',icon:'◆'}]});
    items.push({accordion:true,key:'danh-gia',label:'Đánh giá',children:[{label:'Checklist',route:p+'/checklist',icon:'☰'}]});
    items.push({accordion:true,key:'thi-dua',label:'Thi đua & Thưởng',children:[{label:'Chương trình thi đua',route:p+'/thi-dua',icon:'♛'}]});
    if(isAdminRoute)items.push({accordion:true,key:'quan-tri',label:'Quản trị',children:[{label:'Quản trị hệ thống',route:'/admin/nhan-su',icon:'♙'}]});
  }
  return items;
}
var NAV_ICON={tasks:'✔',calendar:'▦',gear:'⚙',notice:'✦',hub:'▦',classroom:'▤',knl:'◆',book:'▤',checklist:'☰',trophy:'♛',sparkles:'✦',chart:'▥'};
/* Duyệt phẳng mọi route (kể cả con accordion) để chọn route khớp dài nhất. */
function flattenRoutes(items){
  var out=[];
  items.forEach(function(it){
    if(it.route)out.push(it);
    if(it.children)it.children.forEach(function(c){out.push(c);});
  });
  return out;
}
var drawerRoot=null;
function ensureDrawer(){
  if(drawerRoot)return drawerRoot;
  drawerRoot=document.createElement('div');
  drawerRoot.id='phfMobileSlideMenu';
  drawerRoot.className='phf-mnav-drawer';
  drawerRoot.hidden=true;
  drawerRoot.innerHTML=
    '<div class="phf-mnav-drawer-backdrop" data-phf-mnav-close></div>'+
    '<nav class="phf-mnav-drawer-panel" role="dialog" aria-modal="true" aria-label="Menu điều hướng">'+
      '<div class="phf-mnav-drawer-head"><span class="phf-mnav-drawer-avatar"></span><div class="phf-mnav-drawer-who"><strong></strong><small></small></div><button type="button" class="phf-mnav-drawer-close" data-phf-mnav-close aria-label="Đóng menu">✕</button></div>'+
      '<div class="phf-mnav-drawer-items"></div>'+
    '</nav>';
  document.body.appendChild(drawerRoot);
  drawerRoot.addEventListener('click',function(ev){
    if(ev.target.closest('[data-phf-mnav-close]')){closeDrawer();return;}
    var acc=ev.target.closest('[data-phf-mnav-acc]');
    if(acc){
      var body=acc.nextElementSibling,open=acc.getAttribute('aria-expanded')==='true';
      acc.setAttribute('aria-expanded',open?'false':'true');
      if(body)body.hidden=open;
      return;
    }
    var item=ev.target.closest('[data-phf-mnav-item]');
    if(item){var r=item.getAttribute('data-phf-mnav-item');closeDrawer();if(r)go(r);}
  });
  return drawerRoot;
}
/* Route hiện tại: chọn item có route khớp dài nhất (prefix theo segment) để
   tô sáng — không đụng router, chỉ đọc location.pathname. */
function currentItemRoute(routes){
  var here=cleanPath(),best='',bestLen=-1;
  routes.forEach(function(it){
    if(!it.route)return;
    var base=String(it.route).split('?')[0].replace(/\/$/,'')||'/';
    var hit=(here===base)||(base!=='/'&&here.indexOf(base+'/')===0);
    if(hit&&base.length>bestLen){best=it.route;bestLen=base.length;}
  });
  return best;
}
function drawerItemHtml(it,cur){
  var on=it.route===cur;
  return '<button type="button" class="phf-mnav-drawer-item'+(on?' is-current':'')+'"'+(on?' aria-current="page"':'')+' data-phf-mnav-item="'+esc(it.route)+'"><span aria-hidden="true">'+esc(it.icon||'•')+'</span>'+esc(it.label)+'</button>';
}
function renderDrawerContent(){
  var el=ensureDrawer(),r=sessionRole();
  el.querySelector('.phf-mnav-drawer-avatar').textContent=initials();
  el.querySelector('.phf-mnav-drawer-who strong').textContent=userName();
  el.querySelector('.phf-mnav-drawer-who small').textContent=roleLabel(r);
  var items=menuItemsFor(lastCaps,r),cur=currentItemRoute(flattenRoutes(items));
  el.querySelector('.phf-mnav-drawer-items').innerHTML=items.map(function(it){
    if(it.group)return '<div class="phf-mnav-drawer-group">'+esc(it.group)+'</div>';
    if(it.accordion){
      var hasCur=(it.children||[]).some(function(c){return c.route===cur;});
      return '<div class="phf-mnav-acc'+(hasCur?' has-current':'')+'">'+
        '<button type="button" class="phf-mnav-acc-toggle" data-phf-mnav-acc="'+esc(it.key||'')+'" aria-expanded="'+(hasCur?'true':'false')+'"><span>'+esc(it.label)+'</span><span class="phf-mnav-acc-chev" aria-hidden="true">▾</span></button>'+
        '<div class="phf-mnav-acc-body"'+(hasCur?'':' hidden')+'>'+it.children.map(function(c){return drawerItemHtml(c,cur);}).join('')+'</div>'+
      '</div>';
    }
    return drawerItemHtml(it,cur);
  }).join('');
}
/* SỬA LỖI (hotfix): openDrawer()/closeDrawer() trước đây gọi
   document.body.classList.add/remove('phf-mnav-drawer-locked') - đúng ngay
   thuộc tính mà MutationObserver bên dưới đang theo dõi (attributeFilter:
   ['class'] trên document.body) để tự đóng Slide Menu khi đổi route. Kết quả:
   mở Menu tự kích hoạt observer gọi closeDrawer() gần như ngay lập tức, đua
   với hiệu ứng mở (rAF) và để lại setTimeout ẩn cưỡng bức không được huỷ -
   bấm nhanh nhiều lần chồng nhiều timeout ẩn, khiến Menu/backdrop rơi vào
   trạng thái không đoán trước được (không mở được, hoặc lớp phủ toàn màn
   hình treo lại chặn thao tác phía trên). Bỏ hẳn việc mutate class body (class
   phf-mnav-drawer-locked chưa từng có CSS effect nên bỏ không mất chức năng
   nào) và huỷ timeout ẩn đang chờ trước khi đặt cái mới. */
var drawerHideTimer=null;
function openDrawer(){
  /* Hub topbar có drawer riêng (phf-hub-mobile-shell.js) độc lập với Slide
     Menu này - đóng drawer đó trước khi mở, để không có 2 lớp phủ/2 drawer
     cùng hiện chồng nhau nếu người dùng từng mở hamburger của Hub trước đó. */
  try{if(typeof window.phfCloseHubMobileDrawer==='function')window.phfCloseHubMobileDrawer();}catch(e){}
  renderDrawerContent();
  var el=ensureDrawer();
  if(drawerHideTimer){clearTimeout(drawerHideTimer);drawerHideTimer=null;}
  el.hidden=false;
  requestAnimationFrame(function(){el.classList.add('is-open');});
}
function closeDrawer(){
  if(!drawerRoot||drawerRoot.hidden)return;
  drawerRoot.classList.remove('is-open');
  if(drawerHideTimer)clearTimeout(drawerHideTimer);
  drawerHideTimer=setTimeout(function(){drawerHideTimer=null;if(drawerRoot)drawerRoot.hidden=true;},220);
}
window.phfOpenMobileSlideMenu=openDrawer;

/* Popup tài khoản gọn cho nút "Cá nhân" — độc lập với .phf-hr-account-menu
   của Home (menu đó chỉ tồn tại khi đang render Home), để nút Cá nhân hoạt
   động nhất quán trên mọi route (Hub/Classroom/Checklist/KNL). */
var accountPop=null;
function ensureAccountPop(){
  if(accountPop)return accountPop;
  accountPop=document.createElement('div');
  accountPop.id='phfMobileAccountPop';
  accountPop.className='phf-mnav-account-pop';
  accountPop.hidden=true;
  accountPop.innerHTML='<div class="phf-mnav-account-pop-head"><strong></strong><small></small></div><button type="button" class="is-danger" data-phf-mnav-logout>Đăng xuất</button>';
  document.body.appendChild(accountPop);
  accountPop.addEventListener('click',function(ev){
    if(ev.target.closest('[data-phf-mnav-logout]')){accountPop.hidden=true;logout();}
  });
  document.addEventListener('click',function(ev){
    if(accountPop&&!accountPop.hidden&&!ev.target.closest('#phfMobileAccountPop')&&!ev.target.closest('[data-phf-mnav="account"]'))accountPop.hidden=true;
  });
  return accountPop;
}
window.phfToggleMobileAccountMenu=function(){
  var el=ensureAccountPop();
  if(!el.hidden){el.hidden=true;return;}
  el.querySelector('strong').textContent=userName();
  el.querySelector('small').textContent=roleLabel(sessionRole());
  el.hidden=false;
};

function refreshCapabilities(){
  if(typeof window.phfEnsureChecklistWorkspace!=='function')return;
  capsRequested=true;
  window.phfEnsureChecklistWorkspace().then(function(workspace){
    lastCaps=window.phfDeriveChecklistCapabilities?window.phfDeriveChecklistCapabilities(workspace):null;
    render();
  });
}

function onAuthChanged(){
  lastCaps=null;capsRequested=false;
  render();
  if(sessionRole())refreshCapabilities();
}

function onRouteOrAuthMutation(){closeDrawer();render();}
function boot(){
  ensureRoot();
  render();
  if(sessionRole()&&!capsRequested)refreshCapabilities();
  /* Body class thay đổi ở mọi lượt render route (PHFAppShell/các module gán
     trực tiếp) — theo dõi bằng MutationObserver thay vì sửa router, để cập
     nhật hiện/ẩn + trạng thái active mà không đụng logic điều hướng. Đóng
     Slide Menu mỗi khi route đổi (cùng observer). */
  if(window.MutationObserver){
    new MutationObserver(onRouteOrAuthMutation).observe(document.body,{attributes:true,attributeFilter:['class']});
  }
  window.addEventListener('popstate',onRouteOrAuthMutation);
  window.addEventListener('phf-auth-changed',onAuthChanged);
  document.addEventListener('keydown',function(ev){if(ev.key==='Escape')closeDrawer();});
}

window.phfRefreshMobileNav=render;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
})();
