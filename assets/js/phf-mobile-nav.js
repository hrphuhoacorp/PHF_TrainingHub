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
  return b.contains('phf-hr-gateway-mode')||b.contains('phf-main-shell-mode')||b.contains('phf-classroom-mode')||b.contains('phf-checklist-mode')||b.contains('phf-knl-mode');
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
  if(lastCaps&&lastCaps.canRecordViolation){
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
    mainBtn.classList.toggle('is-cta',!!(lastCaps&&lastCaps.canRecordViolation));
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

function boot(){
  ensureRoot();
  render();
  if(sessionRole()&&!capsRequested)refreshCapabilities();
  /* Body class thay đổi ở mọi lượt render route (PHFAppShell/các module gán
     trực tiếp) — theo dõi bằng MutationObserver thay vì sửa router, để cập
     nhật hiện/ẩn + trạng thái active mà không đụng logic điều hướng. */
  if(window.MutationObserver){
    new MutationObserver(render).observe(document.body,{attributes:true,attributeFilter:['class']});
  }
  window.addEventListener('popstate',render);
  window.addEventListener('phf-auth-changed',onAuthChanged);
}

window.phfRefreshMobileNav=render;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
})();
