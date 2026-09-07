(function(){
'use strict';
/* PHF HR — THÔNG BÁO QUẢN TRỊ V1 · Batch 01.
 *
 * UI: full-viewport application shell (QTTH Batch 01D pattern — sticky full-bleed
 * header, fixed sidebar rail + minmax(0,1fr) fluid main, NO global max-width /
 * margin:auto). Theme = PHF green. Sidebar = the 3 module screens; +Đăng thông
 * báo is an ACTION in the feed head, not a nav item; Search/Loại/Trạng thái/
 * Áp dụng are filters inside the feed content.
 *
 * Transport: the SAME /api/data POST channel every other PHF HR module uses
 * (session cookie). Browser sends only action + business fields — actor
 * (account_id, employee_code, name, systemRole) is resolved SERVER-SIDE from
 * the real session (api/_lib/notice-identity.js). No business logic here; the
 * server decides manage-vs-view + dev gate.  NOTHING in this change touches
 * notice business rules / schema / API / datastore.
 */

var API_URL='/api/data';
var NT_TYPES=[['regulation','Quy định'],['policy','Chính sách'],['process','Quy trình'],['guide','Hướng dẫn']];
function typeLabel(t){for(var i=0;i<NT_TYPES.length;i++)if(NT_TYPES[i][0]===t)return NT_TYPES[i][1];return t||'';}
var ST_LABEL={active:'Đang hiệu lực',upcoming:'Sắp hiệu lực',expired:'Hết hiệu lực',draft:'Bản nháp',deleted:'Đã xóa'};

function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function role(){try{return window.phfGetSessionRole?window.phfGetSessionRole():'learner';}catch(e){return 'learner';}}
function prefix(){var r=role();return r==='admin'?'/admin':(r==='manager'?'/ql':'/hv');}
function go(path){if(window.phfNavigate)return window.phfNavigate(path);location.href=path;}
function toast(kind,title,msg){
  if(typeof window.phfToast==='function'){window.phfToast(kind||'info',title||'',msg||'',3600,'phf-notice-toast');return;}
  try{var el=document.createElement('div');el.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1E2430;color:#fff;padding:10px 16px;border-radius:8px;z-index:3000;font-size:13px';el.textContent=(title?title+': ':'')+(msg||'');document.body.appendChild(el);setTimeout(function(){el.remove();},3600);}catch(e){}
}
function fmtDate(v){if(!v)return '—';try{var d=new Date(v);if(isNaN(d.getTime()))return '—';return d.toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'});}catch(e){return '—';}}
function fmtDateTime(v){if(!v)return '—';try{var d=new Date(v);if(isNaN(d.getTime()))return '—';return d.toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}catch(e){return '—';}}
function todayInput(){var d=new Date(Date.now()+7*3600*1000);return d.toISOString().slice(0,10);}

var ICON={
  search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  feed:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16M4 12h16M4 19h10"/></svg>',
  report:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19V5m5 14V9m5 10V4m5 15v-7"/></svg>',
  shield:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z"/></svg>',
  tag:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 2.8 12V4a2 2 0 0 1 2-2h8a2 2 0 0 1 1.4.6l6.4 6.4a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  file:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  link:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>'
};

async function noticeApi(payload){
  var res;
  try{res=await fetch(API_URL,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload)});}
  catch(e){var ne=new Error('Không kết nối được máy chủ PHF HR.');ne.code='NOTICE_NETWORK_ERROR';throw ne;}
  var json={};try{json=await res.json();}catch(e){}
  if(!res.ok||json.ok===false){var err=new Error(noticeErrMsg(json));err.code=json.code||'';err.status=res.status;throw err;}
  return Object.prototype.hasOwnProperty.call(json,'result')?json.result:json;
}
function noticeErrMsg(json){
  var code=String(json&&json.code||'');var raw=json&&(json.error||json.message);
  if(code==='NOTICE_BRIDGE_DISABLED')return 'Thông báo Quản trị chưa được bật kết nối dữ liệu trên môi trường này (PHF_NOTICE_BRIDGE_ENABLED).';
  if(code==='NOTICE_BRIDGE_UNREACHABLE'||code==='NOTICE_BRIDGE_TIMEOUT')return 'Không kết nối được phf-hr-api. Vui lòng thử lại.';
  if(code==='NOTICE_DEV_LOCKED')return raw||'Thông báo Quản trị đang trong giai đoạn phát triển — bạn chưa được cấp quyền truy cập.';
  if(code==='NOTICE_MANAGE_DENIED')return 'Bạn không có quyền quản trị nội dung Thông báo Quản trị.';
  if(code==='NOTICE_ADMIN_REQUIRED')return 'Chỉ Admin được thực hiện thao tác này.';
  if(code==='NOTICE_IDENTITY_INACTIVE'||code==='NOTICE_EMPLOYEE_NOT_FOUND')return 'Tài khoản chưa liên kết hồ sơ nhân sự thật hoặc không còn hoạt động.';
  if(code==='NOTICE_NOT_FOUND')return 'Không tìm thấy thông báo.';
  return String(raw||'Không thể xử lý yêu cầu.');
}
function call(action,fields){return noticeApi(Object.assign({},fields||{},{action:action}));}

/* ================= shell ================= */
var STATE={boot:null,categories:null};
var NT_PRIO=[['normal','Thông thường'],['important','Quan trọng'],['urgent','Hỏa tốc']];
function prioLabel(v){for(var i=0;i<NT_PRIO.length;i++)if(NT_PRIO[i][0]===v)return NT_PRIO[i][1];return 'Thông thường';}
async function loadCategories(force){
  if(STATE.categories&&!force)return STATE.categories;
  try{var r=await call('noticeCategoriesList',{});STATE.categories=r.categories||[];}catch(e){STATE.categories=[];}
  return STATE.categories;
}
function catName(slug){var l=STATE.categories||[];for(var i=0;i<l.length;i++)if(l[i].slug===slug)return l[i].name;return typeLabel(slug);}

function screenForPath(p){
  var m=String(p||'').match(/\/thong-bao(?:\/(bao-cao|quyen|danh-muc|n\/([^/?#]+)))?/);
  if(!m)return {key:'feed'};
  if(m[1]==='bao-cao')return {key:'bao-cao'};
  if(m[1]==='danh-muc')return {key:'danh-muc'};
  if(m[1]==='quyen')return {key:'quyen'};
  if(m[2])return {key:'detail',id:decodeURIComponent(m[2])};
  return {key:'feed'};
}

function sessionUser(){try{return (window.phfGetAuthenticatedUser&&window.phfGetAuthenticatedUser())||(window.phfGetCurrentUser&&window.phfGetCurrentUser())||null;}catch(e){return null;}}
function viewerName(boot){var v=boot&&boot.viewer;if(v&&v.displayName)return v.displayName;var u=sessionUser();return (u&&(u.fullName||u.name||u.displayName||u.email))||'Người dùng';}
function viewerRoleLabel(boot){
  var v=(boot&&boot.viewer)||{};
  if(v.isAdmin)return 'Quản trị hệ thống · Control Tower';
  if(boot&&boot.devOperator)return 'Người vận hành (phát triển)';
  if(v.systemRole==='manager')return 'Quản lý';
  return (boot&&boot.capabilities&&boot.capabilities.canManage)?'Quản trị nội dung':'Chỉ xem';
}
function userBlockHtml(boot){
  return '<span>Xin chào,</span><strong>'+esc(viewerName(boot))+'</strong><em>'+esc(viewerRoleLabel(boot))+'</em>';
}
function navItems(boot){
  var manage=boot&&boot.capabilities&&boot.capabilities.canManage;
  var items=[{key:'feed',label:'Thông báo',icon:ICON.feed,href:prefix()+'/thong-bao'}];
  if(manage){
    items.push({key:'danh-muc',label:'Danh mục',icon:ICON.tag,href:prefix()+'/thong-bao/danh-muc'});
    items.push({key:'bao-cao',label:'Báo cáo tiếp nhận',icon:ICON.report,href:prefix()+'/thong-bao/bao-cao'});
    items.push({key:'quyen',label:'Cài đặt quyền',icon:ICON.shield,href:prefix()+'/thong-bao/quyen'});
  }
  return items;
}
function sidebarHtml(boot,activeKey){
  var items=navItems(boot);
  var out='<nav class="phf-notice-nav" aria-label="Menu Thông báo Quản trị">'
    +'<button type="button" class="phf-notice-nav-back" data-nt-home>'+ICON.home+'<span>Về Trang chủ PHF HR</span></button>'
    +'<div class="phf-notice-nav-title">Thông báo Quản trị</div>'
    +'<div class="phf-notice-nav-items">';
  items.forEach(function(it){
    out+='<button type="button" class="'+(it.key===activeKey||(activeKey==='detail'&&it.key==='feed')?'is-active':'')+'" data-nt-nav="'+esc(it.href)+'">'+it.icon+'<span>'+esc(it.label)+'</span></button>';
  });
  out+='</div></nav>';
  return out;
}

window.phfRenderNotice=async function(requestedPath){
  var actual=String((window.location&&window.location.pathname)||'/').split('?')[0].split('#')[0];
  var main=document.getElementById('phfHrRoot');
  if(!main)return false;
  document.body.classList.add('phf-hr-gateway-mode');
  var scr=screenForPath(requestedPath||actual);
  var p=prefix();

  main.innerHTML='<div class="phf-notice">'
    +'<header class="phf-notice-top">'
      +'<img src="assets/logo/phf-logo-white.png" alt="PHUHOA FRESH" class="phf-notice-logo" width="220" height="44" decoding="async" onerror="this.style.display=\'none\'">'
      +'<span class="phf-notice-brand"><b>Thông báo Quản Trị</b><small>PHF HR</small></span>'
      +'<div class="phf-notice-user" data-nt-user>'+userBlockHtml(null)+'</div>'
    +'</header>'
    +'<div class="phf-notice-shell"><div class="phf-notice-layout">'
      +'<div data-nt-nav-slot>'+sidebarHtml(null,scr.key)+'</div>'
      +'<main class="phf-notice-work" data-nt-work><div class="phf-notice-work-inner"><div class="phf-notice-skel"></div><div class="phf-notice-skel"></div><div class="phf-notice-skel"></div></div></main>'
    +'</div></div></div>';

  var navSlot=main.querySelector('[data-nt-nav-slot]');
  var work=main.querySelector('[data-nt-work]');
  function wireNav(){
    navSlot.querySelectorAll('[data-nt-home]').forEach(function(b){b.onclick=function(e){e.preventDefault();var home=(typeof window.phfGetRoleHomePath==='function'&&window.phfGetRoleHomePath())||(p+'/home');go(home);};});
    navSlot.querySelectorAll('[data-nt-nav]').forEach(function(b){b.onclick=function(e){if(e.metaKey||e.ctrlKey||e.shiftKey)return;e.preventDefault();go(b.getAttribute('data-nt-nav'));};});
  }
  wireNav();

  var boot;
  try{boot=STATE.boot=await call('noticeBootstrap',{});}
  catch(err){
    work.innerHTML='<div class="phf-notice-work-inner"><div class="phf-notice-warn">'+esc(noticeErrMsg({code:err.code,message:err.message}))+'</div><button class="phf-notice-btn" data-nt-retry>Thử lại</button></div>';
    work.querySelector('[data-nt-retry]').onclick=function(){window.phfRenderNotice(requestedPath);};
    document.title='Thông báo Quản trị · PHF HR';
    return true;
  }
  main.querySelector('[data-nt-user]').innerHTML=userBlockHtml(boot);
  navSlot.innerHTML=sidebarHtml(boot,scr.key);
  wireNav();

  if(boot.devLocked&&!boot.capabilities.canManage&&!boot.devOperator){
    work.innerHTML='<div class="phf-notice-work-inner"><div class="phf-notice-warn info">'+esc(boot.lockReason||'Module đang trong giai đoạn phát triển.')+'</div></div>';
    document.title='Thông báo Quản trị · PHF HR';
    return true;
  }

  await loadCategories(true);
  var ctx={main:main,work:work,p:p,requestedPath:requestedPath,boot:boot};
  if(scr.key==='danh-muc'){ if(!boot.capabilities.canManage){go(p+'/thong-bao');return true;} await renderCategories(ctx); }
  else if(scr.key==='quyen'){ if(!boot.capabilities.canManage){go(p+'/thong-bao');return true;} await renderPermission(ctx); }
  else if(scr.key==='bao-cao'){ if(!boot.capabilities.canManage){go(p+'/thong-bao');return true;} await renderReportIndex(ctx); }
  else if(scr.key==='detail'){ await renderDetail(ctx,scr.id); }
  else{ await renderFeed(ctx); }

  document.title='Thông báo Quản trị · PHF HR';
  try{window.scrollTo({top:0,behavior:'instant'});}catch(e){window.scrollTo(0,0);}
  return true;
};
function setWork(ctx,html){ctx.work.innerHTML='<div class="phf-notice-work-inner">'+html+'</div>';return ctx.work.querySelector('.phf-notice-work-inner');}

/* ================= FEED ================= */
var FEED_FILTER={q:'',type:'',status:'',scope:'',includeDrafts:false};
async function renderFeed(ctx){
  var boot=ctx.boot,manage=boot.capabilities.canManage;
  var inner=setWork(ctx,
    '<div class="phf-notice-head"><div><h1>Thông báo</h1><p>Nơi tra cứu chính thức các quy định, chính sách, quy trình và hướng dẫn đang áp dụng.</p></div>'
    +'<div class="phf-notice-head-actions">'+(manage?'<button class="phf-notice-btn is-primary" data-nt-create>+ Đăng thông báo</button>':'')+'</div></div>'
    +'<div class="phf-notice-search">'+ICON.search+'<input type="text" data-nt-q placeholder="Tìm quy định, hướng dẫn, cách xử lý..." value="'+esc(FEED_FILTER.q)+'"></div>'
    +'<div class="phf-notice-filters" data-nt-filters>'+typeChips()+'<span class="sep"></span>'+statusChips()+'<span class="sep"></span>'
      +'<input type="text" data-nt-scope placeholder="Lọc phòng ban / chi nhánh" value="'+esc(FEED_FILTER.scope)+'">'
      +(manage?'<label class="phf-notice-check" style="margin-left:8px"><input type="checkbox" data-nt-drafts '+(FEED_FILTER.includeDrafts?'checked':'')+'> Hiện bản nháp</label>':'')
    +'</div>'
    +'<div class="phf-notice-feed" data-nt-feed><div class="phf-notice-skel"></div><div class="phf-notice-skel"></div></div>');

  if(manage)inner.querySelector('[data-nt-create]').onclick=function(){openWizard(ctx.p,null);};
  var q=inner.querySelector('[data-nt-q]'),deb;
  q.addEventListener('input',function(){clearTimeout(deb);deb=setTimeout(function(){FEED_FILTER.q=q.value.trim();loadFeed(ctx);},280);});
  inner.querySelector('[data-nt-filters]').addEventListener('click',function(e){
    var c=e.target.closest('[data-nt-type],[data-nt-status]');if(!c)return;
    if(c.hasAttribute('data-nt-type'))FEED_FILTER.type=c.getAttribute('data-nt-type');else FEED_FILTER.status=c.getAttribute('data-nt-status');
    renderFeed(ctx);
  });
  var sc=inner.querySelector('[data-nt-scope]');
  sc.addEventListener('input',function(){clearTimeout(deb);deb=setTimeout(function(){FEED_FILTER.scope=sc.value.trim();loadFeed(ctx);},280);});
  var dr=inner.querySelector('[data-nt-drafts]');if(dr)dr.addEventListener('change',function(){FEED_FILTER.includeDrafts=dr.checked;loadFeed(ctx);});
  await loadFeed(ctx);
}
function typeChips(){
  var out='<button class="phf-notice-chip'+(!FEED_FILTER.type?' is-on':'')+'" data-nt-type="">Tất cả</button>';
  (STATE.categories||[]).filter(function(c){return c.isActive!==false;}).forEach(function(c){
    out+='<button class="phf-notice-chip'+(FEED_FILTER.type===c.slug?' is-on':'')+'" data-nt-type="'+esc(c.slug)+'">'+esc(c.name)+'</button>';
  });
  return out;
}
function statusChips(){
  return [['','Mọi trạng thái'],['active','Đang hiệu lực'],['upcoming','Sắp hiệu lực'],['expired','Hết hiệu lực']]
    .map(function(x){return '<button class="phf-notice-chip'+(FEED_FILTER.status===x[0]?' is-on':'')+'" data-nt-status="'+x[0]+'">'+esc(x[1])+'</button>';}).join('');
}
async function loadFeed(ctx){
  var wrap=ctx.work.querySelector('[data-nt-feed]');if(!wrap)return;
  wrap.innerHTML='<div class="phf-notice-skel"></div><div class="phf-notice-skel"></div>';
  var res;
  try{res=await call('noticeFeed',{q:FEED_FILTER.q,type:FEED_FILTER.type,status:FEED_FILTER.status,scope:FEED_FILTER.scope,include_drafts:FEED_FILTER.includeDrafts});}
  catch(err){wrap.innerHTML='<div class="phf-notice-warn">'+esc(noticeErrMsg({code:err.code,message:err.message}))+'</div>';return;}
  if(!res.notices.length){
    wrap.innerHTML='<div class="phf-notice-empty">'+ICON.bell+'<p>'+((FEED_FILTER.q||FEED_FILTER.type||FEED_FILTER.status||FEED_FILTER.scope)?'Không có thông báo khớp bộ lọc.':'Chưa có thông báo nào.')+'</p></div>';
    return;
  }
  wrap.innerHTML=res.notices.map(cardHtml).join('');
  wrap.querySelectorAll('[data-nt-card]').forEach(function(el){el.onclick=function(){go(ctx.p+'/thong-bao/n/'+encodeURIComponent(el.getAttribute('data-nt-card')));};});
}
function scopeText(scopes){return (scopes||[]).map(function(s){return s.scopeType==='company'?'Toàn công ty':s.scopeValue;}).join(', ')||'Toàn công ty';}
function prioBadge(pr){
  if(pr==='urgent')return '<span class="phf-notice-badge prio-urgent">Hỏa tốc</span>';
  if(pr==='important')return '<span class="phf-notice-badge prio-important">Quan trọng</span>';
  return '';
}
function cardHtml(n){
  var st=n.effectiveStatus,state='';
  var reackNeeded=n.viewer.acknowledged&&!n.viewer.acknowledgedRevisionIsCurrent;
  if(reackNeeded)state='<span class="phf-notice-need-ack">Cần xác nhận lại</span>';
  else if(n.viewer.acknowledged)state='<span class="phf-notice-tick">✓ Đã xác nhận</span>';
  else if(n.requireAcknowledgement)state='<span class="phf-notice-need-ack">Cần xác nhận</span>';
  else if(n.viewer.viewed)state='<span class="phf-notice-seen">Đã xem</span>';
  return '<article class="phf-notice-card'+(n.isPinned?' is-pinned':'')+(n.priority==='urgent'&&st==='active'?' is-urgent':'')+'" data-nt-card="'+esc(n.id)+'">'
    +'<div class="phf-notice-card-top">'
      +(n.isPinned?'<span class="phf-notice-badge pin">📌 Ghim</span>':'')
      +prioBadge(n.priority)
      +'<span class="phf-notice-badge type">'+esc(n.categoryName||catName(n.noticeType))+'</span>'
      +'<span class="phf-notice-badge st-'+st+'">'+esc(ST_LABEL[st]||st)+(st==='upcoming'&&n.effectiveFrom?' · từ '+fmtDate(n.effectiveFrom):'')+'</span>'
      +(n.status==='draft'?'<span class="phf-notice-badge st-draft">Nháp</span>':'')
    +'</div>'
    +'<h3>'+esc(n.title)+'</h3><p class="excerpt">'+esc(n.excerpt)+'</p>'
    +'<div class="phf-notice-card-meta">'
      +'<span class="phf-notice-scope">'+esc(scopeText(n.scopes))+'</span>'
      +'<span class="dot"></span><span>'+(n.edited?'Đã cập nhật '+fmtDate(n.updatedAt):fmtDate(n.publishedAt||n.updatedAt))+'</span>'
      +(n.attachmentCount?'<span class="dot"></span><span>'+ICON.file+' '+n.attachmentCount+' tệp</span>':'')
      +'<span class="phf-notice-card-state">'+state+'</span>'
    +'</div></article>';
}

/* ================= DETAIL ================= */
async function renderDetail(ctx,id){
  var p=ctx.p;
  setWork(ctx,'<div class="phf-notice-loading">Đang tải…</div>');
  var res;
  try{res=await call('noticeDetail',{id:id});}
  catch(err){
    var i=setWork(ctx,'<button class="phf-notice-btn is-ghost back" data-nt-back>← Quay lại feed</button><div class="phf-notice-warn">'+esc(noticeErrMsg({code:err.code,message:err.message}))+'</div>');
    i.querySelector('[data-nt-back]').onclick=function(){go(p+'/thong-bao');};
    return;
  }
  var n=res.notice,v=res.viewer,st=n.effectiveStatus;
  var warn='';
  if(n.status==='draft')warn+='<div class="phf-notice-warn info">BẢN NHÁP — chưa công bố.</div>';
  if(st==='expired')warn+='<div class="phf-notice-warn">HẾT HIỆU LỰC — Nội dung này không còn áp dụng.'+(res.replacement?' Đã được thay thế bởi: <a href="#" data-nt-goto="'+esc(res.replacement.id)+'">'+esc(res.replacement.title)+'</a>.':'')+'</div>';
  else if(st==='upcoming')warn+='<div class="phf-notice-warn info">SẮP HIỆU LỰC — áp dụng từ '+fmtDate(n.effectiveFrom)+'.</div>';
  else if(n.supersededByNoticeId&&res.replacement)warn+='<div class="phf-notice-warn">Đã được thay thế bởi: <a href="#" data-nt-goto="'+esc(res.replacement.id)+'">'+esc(res.replacement.title)+'</a>.</div>';

  var toc=(n.toc||[]).length?'<nav class="phf-notice-toc"><b>Mục lục</b><ul>'
    +n.toc.map(function(h){return '<li class="lv'+h.level+'"><a href="#'+esc(h.id)+'" data-nt-toc="'+esc(h.id)+'">'+esc(h.text)+'</a></li>';}).join('')+'</ul></nav>':'';
  var atts=(n.attachments||[]).filter(function(a){return true;});
  var attList=atts.length?'<div class="phf-notice-attach"><h4>Tệp / liên kết đính kèm</h4>'
    +atts.map(function(a){return '<span class="phf-notice-att-row">'+(a.kind==='link'
      ?'<a href="'+esc(a.linkUrl)+'" target="_blank" rel="noopener">'+ICON.link+' '+esc(a.linkUrl)+'</a>'
      :'<a href="#" data-nt-att="'+esc(a.id)+'" data-nt-att-name="'+esc(a.fileName||'tep')+'">'+ICON.file+' '+esc(a.fileName||'Tệp đính kèm')+(a.byteSize?' <em>('+Math.max(1,Math.round(a.byteSize/1024))+' KB)</em>':'')+'</a>')
      +(res.canManage?' <button type="button" class="phf-notice-att-rm" data-nt-att-rm="'+esc(a.id)+'" title="Xóa tệp">×</button>':'')+'</span>';}).join('')+'</div>':'';
  var attManage=res.canManage?'<div class="phf-notice-attach phf-notice-att-manage"><h4>Quản lý tệp đính kèm</h4>'
    +'<div class="phf-notice-att-add"><label class="phf-notice-btn is-small">'+ICON.file+' Tải tệp lên<input type="file" data-nt-att-file hidden accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx"></label>'
    +'<input type="text" data-nt-att-link placeholder="hoặc dán liên kết https://..."><button type="button" class="phf-notice-btn is-small" data-nt-att-addlink>Thêm liên kết</button></div>'
    +'<p class="hint">Ảnh / PDF / Word / Excel ≤ 4 MB. Nội dung chính trên web vẫn bắt buộc — đính kèm chỉ là tài liệu tham chiếu. Mọi thêm/xóa/thay tệp đều được ghi vết.</p></div>':'';
  var att=toc+attList+attManage;

  var ackNeedsNew=v.acknowledged&&!v.acknowledgedRevisionIsCurrent;
  var ackHtml='';
  if(n.status==='published'&&st!=='deleted'){
    if(v.acknowledged&&!ackNeedsNew){
      ackHtml='<div class="phf-notice-ackbar done"><label><input type="checkbox" checked disabled> Tôi đã đọc và nắm thông tin</label><span class="ack-note">Đã xác nhận lúc '+fmtDateTime(v.acknowledgedAt||n.updatedAt)+' — không thể bỏ xác nhận.</span></div>';
    }else{
      ackHtml='<div class="phf-notice-ackbar"><label><input type="checkbox" data-nt-ack> Tôi đã đọc và nắm thông tin</label><span class="ack-note">'+(ackNeedsNew?'Nội dung đã thay đổi — cần xác nhận lại phiên bản mới.':'Xác nhận này ghi nhận một sự kiện đã xảy ra, không thể hoàn tác.')+'</span></div>';
    }
  }
  var mgr=res.canManage?'<div class="phf-notice-head-actions" style="margin:16px 0 0">'
    +'<button class="phf-notice-btn is-small" data-nt-edit>Chỉnh sửa</button>'
    +'<button class="phf-notice-btn is-small" data-nt-pin>'+(n.isPinned?'Bỏ ghim':'Ghim')+'</button>'
    +'<button class="phf-notice-btn is-small" data-nt-report>Báo cáo tiếp nhận</button>'
    +'<button class="phf-notice-btn is-small" data-nt-audit>Lịch sử</button>'
    +'<button class="phf-notice-btn is-small is-ghost" data-nt-del>Xóa</button></div>':'';

  var i=setWork(ctx,'<div class="phf-notice-detail">'
    +'<button class="phf-notice-btn is-ghost back" data-nt-back>← Quay lại feed</button>'
    +'<div class="phf-notice-card-top">'+(n.isPinned?'<span class="phf-notice-badge pin">📌 Ghim</span>':'')
      +prioBadge(n.priority)
      +'<span class="phf-notice-badge type">'+esc(n.categoryName||catName(n.noticeType))+'</span><span class="phf-notice-badge st-'+st+'">'+esc(ST_LABEL[st]||st)+'</span>'
      +(ackNeedsNew?'<span class="phf-notice-badge prio-important">Cần xác nhận lại</span>':(v.acknowledged?'<span class="phf-notice-badge st-active">Đã xác nhận</span>':''))+'</div>'
    +'<h1>'+esc(n.title)+'</h1>'
    +'<div class="phf-notice-detail-meta"><span>Áp dụng: <b>'+esc(scopeText(n.scopes))+'</b></span>'
      +'<span>Hiệu lực: '+fmtDate(n.effectiveFrom)+(n.effectiveTo?' → '+fmtDate(n.effectiveTo):' → không thời hạn')+'</span>'
      +'<span>Công bố: '+fmtDate(n.publishedAt)+'</span>'
      +(n.edited?'<span>Cập nhật lần cuối: '+fmtDateTime(n.lastUpdatedAt)+'</span>':'')
      +(n.keywords.length?'<span>Từ khóa bổ sung: '+esc(n.keywords.join(', '))+'</span>':'')+'</div>'
    +warn
    +'<div class="phf-notice-body" data-nt-body>'+(n.contentHtml||('<p>'+esc(n.contentText).replace(/\n/g,'<br>')+'</p>'))+'</div>'
    +att+ackHtml+mgr+'</div>');

  i.querySelector('[data-nt-back]').onclick=function(){go(p+'/thong-bao');};
  i.querySelectorAll('[data-nt-goto]').forEach(function(a){a.onclick=function(e){e.preventDefault();go(p+'/thong-bao/n/'+encodeURIComponent(a.getAttribute('data-nt-goto')));};});
  i.querySelectorAll('[data-nt-toc]').forEach(function(a){a.onclick=function(e){e.preventDefault();var t=i.querySelector('#'+CSS.escape(a.getAttribute('data-nt-toc')));if(t)t.scrollIntoView({behavior:'smooth',block:'start'});};});
  if(FEED_FILTER.q){
    var body=i.querySelector('[data-nt-body]'),term=FEED_FILTER.q.trim();
    if(body&&term.length>=2){
      try{
        var rx=new RegExp('('+term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi'),first=null;
        (function walk(node){for(var c=node.firstChild;c;c=c.nextSibling){if(c.nodeType===3&&rx.test(c.nodeValue)){var span=document.createElement('span');span.innerHTML=c.nodeValue.replace(rx,'<mark class="phf-notice-hit">$1</mark>');if(!first)first=span;node.replaceChild(span,c);}else if(c.nodeType===1&&c.tagName!=='MARK')walk(c);}})(body);
        if(first)setTimeout(function(){first.scrollIntoView({behavior:'smooth',block:'center'});},120);
      }catch(e){}
    }
  }
  i.querySelectorAll('[data-nt-att]').forEach(function(a){a.onclick=async function(e){
    e.preventDefault();a.style.opacity='.5';
    try{
      var r=await call('noticeAttachmentDownload',{notice_id:n.id,attachment_id:a.getAttribute('data-nt-att')});
      if(r.kind==='link'){window.open(r.linkUrl,'_blank','noopener');return;}
      var bin=atob(r.base64),arr=new Uint8Array(bin.length);for(var k=0;k<bin.length;k++)arr[k]=bin.charCodeAt(k);
      var url=URL.createObjectURL(new Blob([arr]));var dl=document.createElement('a');dl.href=url;dl.download=r.fileName||a.getAttribute('data-nt-att-name')||'tep';document.body.appendChild(dl);dl.click();dl.remove();setTimeout(function(){URL.revokeObjectURL(url);},2000);
    }catch(err){toast('error','Không tải được tệp',err.message);}
    finally{a.style.opacity='';}
  };});
  var ack=i.querySelector('[data-nt-ack]');
  if(ack)ack.onchange=async function(){
    if(!ack.checked)return;ack.disabled=true;
    try{await call('noticeAcknowledge',{id:n.id});toast('success','Đã ghi nhận','Cảm ơn bạn đã xác nhận.');renderDetail(ctx,id);}
    catch(err){ack.checked=false;ack.disabled=false;toast('error','Không xác nhận được',err.message);}
  };
  if(res.canManage){
    i.querySelector('[data-nt-edit]').onclick=function(){openWizard(p,n);};
    i.querySelector('[data-nt-pin]').onclick=async function(){try{await call('noticeSetPin',{id:n.id,pinned:!n.isPinned});renderDetail(ctx,id);}catch(err){toast('error','Lỗi',err.message);}};
    i.querySelector('[data-nt-report]').onclick=function(){openReport(p,n.id,n.title);};
    i.querySelector('[data-nt-audit]').onclick=function(){openAudit(p,n.id,n.title);};
    i.querySelector('[data-nt-del]').onclick=async function(){
      if(!confirm('Xóa thông báo này? Bản đã công bố sẽ ẩn khỏi feed nhưng dữ liệu + lịch sử vẫn được giữ (soft delete).'))return;
      try{var r=await call('noticeDelete',{id:n.id});toast('success','Đã xóa',r.mode==='hard'?'Đã xóa bản nháp.':'Đã ẩn khỏi feed.');go(p+'/thong-bao');}catch(err){toast('error','Lỗi',err.message);}
    };
    function askReack(){return n.status==='published'?confirm('Yêu cầu người đọc xác nhận lại vì tệp đính kèm thay đổi? (OK = tạo phiên bản mới, người dùng phải xác nhận lại)'):false;}
    var fileInp=i.querySelector('[data-nt-att-file]');
    if(fileInp)fileInp.onchange=async function(){
      var f=fileInp.files&&fileInp.files[0];if(!f)return;
      if(f.size>4*1024*1024){toast('error','Tệp quá lớn','Tối đa 4 MB.');fileInp.value='';return;}
      var rr=askReack();
      var b64=await new Promise(function(rs,rj){var fr=new FileReader();fr.onload=function(){rs(String(fr.result).split(',')[1]);};fr.onerror=rj;fr.readAsDataURL(f);});
      try{await call('noticeAttachmentAdd',{notice_id:n.id,kind:'file',file_name:f.name,mime_type:f.type,base64:b64,require_reacknowledgement:rr});toast('success','Đã thêm tệp','');renderDetail(ctx,id);}
      catch(err){toast('error','Không thêm được tệp',err.message);}
      finally{fileInp.value='';}
    };
    var addLink=i.querySelector('[data-nt-att-addlink]');
    if(addLink)addLink.onclick=async function(){
      var url=(i.querySelector('[data-nt-att-link]')||{}).value||'';if(!/^https?:\/\//i.test(url.trim())){toast('error','Liên kết không hợp lệ','Bắt đầu bằng http:// hoặc https://');return;}
      var rr=askReack();
      try{await call('noticeAttachmentAdd',{notice_id:n.id,kind:'link',link_url:url.trim(),require_reacknowledgement:rr});toast('success','Đã thêm liên kết','');renderDetail(ctx,id);}
      catch(err){toast('error','Không thêm được',err.message);}
    };
    i.querySelectorAll('[data-nt-att-rm]').forEach(function(b){b.onclick=async function(){
      if(!confirm('Xóa tệp đính kèm này? Thao tác được ghi vết.'))return;
      var rr=askReack();
      try{await call('noticeAttachmentRemove',{notice_id:n.id,attachment_id:b.getAttribute('data-nt-att-rm'),require_reacknowledgement:rr});toast('success','Đã xóa tệp','');renderDetail(ctx,id);}
      catch(err){toast('error','Không xóa được',err.message);}
    };});
  }
}

/* ================= REPORT INDEX (sidebar screen) ================= */
async function renderReportIndex(ctx){
  var inner=setWork(ctx,'<div class="phf-notice-head"><div><h1>Báo cáo tiếp nhận</h1><p>Chọn một thông báo để xem ai đã xem / đã xác nhận / chưa xác nhận trong nhóm áp dụng.</p></div></div><div class="phf-notice-rlist" data-nt-rlist><div class="phf-notice-skel"></div></div>');
  var res;
  try{res=await call('noticeFeed',{q:'',include_drafts:true});}
  catch(err){inner.querySelector('[data-nt-rlist]').innerHTML='<div class="phf-notice-warn">'+esc(noticeErrMsg({code:err.code,message:err.message}))+'</div>';return;}
  var list=res.notices.filter(function(n){return n.status==='published';});
  if(!list.length){inner.querySelector('[data-nt-rlist]').innerHTML='<div class="phf-notice-empty">'+ICON.report+'<p>Chưa có thông báo đã công bố.</p></div>';return;}
  inner.querySelector('[data-nt-rlist]').innerHTML=list.map(function(n){
    return '<button type="button" data-nt-r="'+esc(n.id)+'" data-nt-t="'+esc(n.title)+'"><b>'+esc(n.title)+'</b><small>'+esc(typeLabel(n.noticeType))+' · '+esc(ST_LABEL[n.effectiveStatus]||n.effectiveStatus)+' · '+esc(scopeText(n.scopes))+'</small></button>';
  }).join('');
  inner.querySelectorAll('[data-nt-r]').forEach(function(b){b.onclick=function(){openReport(ctx.p,b.getAttribute('data-nt-r'),b.getAttribute('data-nt-t'));};});
}

/* ================= CREATE / EDIT WIZARD ================= */
function fileToB64(f){return new Promise(function(rs,rj){var fr=new FileReader();fr.onload=function(){rs(String(fr.result).split(',')[1]);};fr.onerror=rj;fr.readAsDataURL(f);});}
function openWizard(p,existing){
  var edit=!!existing,d=existing||{};
  var cats=(STATE.categories||[]).filter(function(c){return c.isActive!==false||c.slug===d.noticeType;});
  var model={
    title:d.title||'',contentText:d.contentText||'',
    noticeType:d.noticeType||(cats[0]&&cats[0].slug)||'guide',
    priority:d.priority||'normal',
    scopeMode:(d.scopes&&d.scopes.some(function(s){return s.scopeType!=='company';}))?'custom':'company',
    scopeText:(d.scopes||[]).filter(function(s){return s.scopeType!=='company';}).map(function(s){return s.scopeValue;}).join(', '),
    effectiveFrom:d.effectiveFrom||todayInput(),effectiveTo:d.effectiveTo||'',
    requireAcknowledgement:!!d.requireAcknowledgement,keywords:(d.keywords||[]).join(', '),
    requireReack:false, pendingAtts:[]
  };
  var STEPS = edit
    ? ['Nội dung','Thiết lập','Xem trước']
    : ['Nội dung','Tệp đính kèm','Thiết lập','Xem trước'];
  var step=1;
  var ov=document.createElement('div');ov.className='phf-notice-ov';document.body.appendChild(ov);
  function close(){ov.remove();}
  var isLast=function(){return step===STEPS.length;};
  var settingsStep=function(){return edit?2:3;};
  function draw(){
    var stepsHtml=STEPS.map(function(l,i){return '<span class="'+(step>=i+1?'on':'')+'"></span>';}).join('');
    ov.innerHTML='<div class="phf-notice-ov-panel"><div class="phf-notice-ov-head"><h2>'+(edit?'Chỉnh sửa thông báo':'Đăng thông báo mới')+' · '+esc(STEPS[step-1])+'</h2><button class="x" data-x>×</button></div>'
      +'<div class="phf-notice-ov-body"><div class="phf-notice-steps">'+stepsHtml+'</div><div data-body></div></div>'
      +'<div class="phf-notice-ov-foot" data-foot></div></div>';
    ov.querySelector('[data-x]').onclick=close;
    var body=ov.querySelector('[data-body]'),foot=ov.querySelector('[data-foot]');
    if(step===1){
      body.innerHTML=''
        +'<div class="phf-notice-field"><label>Tiêu đề *</label><input type="text" data-f-title value="'+esc(model.title)+'" placeholder="VD: Cập nhật cách bấm bill khi khách sử dụng Voucher"></div>'
        +'<div class="phf-notice-inline">'
          +'<div class="phf-notice-field"><label>Danh mục *</label><select data-f-type>'+cats.map(function(c){return '<option value="'+esc(c.slug)+'"'+(model.noticeType===c.slug?' selected':'')+'>'+esc(c.name)+(c.isActive===false?' (ngừng)':'')+'</option>';}).join('')+'</select></div>'
          +'<div class="phf-notice-field"><label>Mức ưu tiên</label><select data-f-prio>'+NT_PRIO.map(function(x){return '<option value="'+x[0]+'"'+(model.priority===x[0]?' selected':'')+'>'+esc(x[1])+'</option>';}).join('')+'</select></div>'
        +'</div>'
        +'<div class="phf-notice-field"><label>Áp dụng</label><select data-f-scopemode><option value="company"'+(model.scopeMode==='company'?' selected':'')+'>Toàn công ty</option><option value="custom"'+(model.scopeMode==='custom'?' selected':'')+'>Chọn phòng ban / chi nhánh</option></select></div>'
        +'<div class="phf-notice-field" data-scope-wrap style="'+(model.scopeMode==='custom'?'':'display:none')+'"><input type="text" data-f-scopetext value="'+esc(model.scopeText)+'" placeholder="VD: Bán hàng, Kho — phân tách bằng dấu phẩy"><div class="hint">"Áp dụng" chỉ là nhãn + mẫu số báo cáo — KHÔNG giới hạn quyền xem. Mọi tài khoản vẫn đọc và xác nhận được.</div></div>'
        +'<div class="phf-notice-field"><label>Nội dung chính (hiển thị trên web) *</label><textarea data-f-content placeholder="Dán nguyên văn từ Zalo hoặc tài liệu cũ.">'+esc(model.contentText)+'</textarea><div class="hint">Nội quy / chính sách dài: đưa TOÀN VĂN lên đây (tìm được từng đoạn). Gõ "## " / "### " đầu dòng cho tiêu đề mục — hệ thống tự tạo Mục lục.</div></div>'
        +'<div class="phf-notice-field"><label>Từ khóa bổ sung (tùy chọn)</label><input type="text" data-f-kw value="'+esc(model.keywords)+'" placeholder="voucher sinh nhật, F6, mã giảm giá"><div class="hint">Giúp bổ sung các cách gọi khác mà nội dung bài chưa nhắc đến. Tìm kiếm vẫn tự động chạy trên tiêu đề + toàn văn dù để trống.</div></div>';
      var sm=body.querySelector('[data-f-scopemode]');
      sm.onchange=function(){body.querySelector('[data-scope-wrap]').style.display=sm.value==='custom'?'':'none';};
    }else if(!edit&&step===2){
      body.innerHTML='<p class="hint" style="margin-top:0">Ảnh / PDF / Word / Excel ≤ 4 MB, hoặc liên kết. Nội dung chính trên web vẫn bắt buộc — đính kèm chỉ là tài liệu tham chiếu. Bài + tệp được công bố cùng lúc.</p>'
        +'<div class="phf-notice-att-add"><label class="phf-notice-btn is-small">'+ICON.file+' Chọn tệp<input type="file" data-f-file hidden accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx"></label>'
        +'<input type="text" data-f-linkinput placeholder="hoặc dán liên kết https://..."><button type="button" class="phf-notice-btn is-small" data-f-addlink>Thêm liên kết</button></div>'
        +'<div class="phf-notice-att-pending" data-pending></div>';
      drawPending(body.querySelector('[data-pending]'));
      var fi=body.querySelector('[data-f-file]');
      fi.onchange=async function(){
        var f=fi.files&&fi.files[0];if(!f)return;
        if(f.size>4*1024*1024){toast('error','Tệp quá lớn','Tối đa 4 MB.');fi.value='';return;}
        try{var b64=await fileToB64(f);
          var thumb=/^image\//.test(f.type)?('data:'+f.type+';base64,'+b64):'';
          model.pendingAtts.push({kind:'file',name:f.name,size:f.size,mime:f.type,b64:b64,thumb:thumb});
          drawPending(body.querySelector('[data-pending]'));
        }catch(e){toast('error','Không đọc được tệp','');}
        fi.value='';
      };
      body.querySelector('[data-f-addlink]').onclick=function(){
        var v=(body.querySelector('[data-f-linkinput]')||{}).value||'';
        if(!/^https?:\/\//i.test(v.trim())){toast('error','Liên kết không hợp lệ','Bắt đầu bằng http:// hoặc https://');return;}
        model.pendingAtts.push({kind:'link',linkUrl:v.trim()});
        body.querySelector('[data-f-linkinput]').value='';
        drawPending(body.querySelector('[data-pending]'));
      };
    }else if(step===settingsStep()){
      body.innerHTML='<div class="phf-notice-inline">'
        +'<div class="phf-notice-field"><label>Hiệu lực từ *</label><input type="date" data-f-from value="'+esc(model.effectiveFrom)+'"></div>'
        +'<div class="phf-notice-field"><label>Hết hiệu lực (tùy chọn)</label><input type="date" data-f-to value="'+esc(model.effectiveTo)+'"><div class="hint">Bỏ trống = không thời hạn. Trạng thái Sắp/Đang/Hết hiệu lực do hệ thống tự suy.</div></div>'
        +'</div>'
        +'<div class="phf-notice-field"><label class="phf-notice-check"><input type="checkbox" data-f-ack '+(model.requireAcknowledgement?'checked':'')+'> Yêu cầu người đọc xác nhận "Tôi đã đọc và nắm thông tin"</label><div class="hint">Độc lập với mức ưu tiên — "Hỏa tốc" KHÔNG tự bắt xác nhận.</div></div>'
        +(edit&&d.status==='published'?'<div class="phf-notice-field"><label class="phf-notice-check"><input type="checkbox" data-f-reack '+(model.requireReack?'checked':'')+'> Nội dung thay đổi quan trọng — yêu cầu mọi người xác nhận lại</label><div class="hint">Bỏ trống = xác nhận cũ vẫn được tính là hoàn thành. Bật = tạo phiên bản mới, xác nhận cũ lưu lịch sử, người dùng chuyển sang "Cần xác nhận lại".</div></div>':'')
        +'<div data-dup></div>';
    }else{
      var ss=model.scopeMode==='company'?'Toàn công ty':(model.scopeText||'(chưa chọn)');
      var attSummary=(edit?[]:model.pendingAtts).map(function(a){return a.kind==='link'?('🔗 '+a.linkUrl):(a.name+' ('+Math.max(1,Math.round(a.size/1024))+' KB)');});
      body.innerHTML='<div class="phf-notice-summary"><dl>'
        +'<dt>Tiêu đề</dt><dd>'+esc(model.title||'(trống)')+'</dd>'
        +'<dt>Danh mục</dt><dd>'+esc(catName(model.noticeType))+'</dd>'
        +'<dt>Mức ưu tiên</dt><dd>'+esc(prioLabel(model.priority))+'</dd>'
        +'<dt>Áp dụng</dt><dd>'+esc(ss)+'</dd>'
        +'<dt>Hiệu lực</dt><dd>'+fmtDate(model.effectiveFrom)+(model.effectiveTo?' → '+fmtDate(model.effectiveTo):' → không thời hạn')+'</dd>'
        +'<dt>Yêu cầu xác nhận</dt><dd>'+(model.requireAcknowledgement?'Có':'Không')+'</dd>'
        +(attSummary.length?'<dt>Đính kèm</dt><dd>'+attSummary.map(esc).join('<br>')+'</dd>':'')
        +'</dl></div>'
        +'<div class="phf-notice-preview-body"><b class="phf-notice-preview-lbl">Xem trước nội dung</b><div class="phf-notice-body">'+(model.contentText?htmlFromTextFE(model.contentText):'<p class="hint">(chưa có nội dung)</p>')+'</div></div>'
        +'<p class="hint" style="margin-top:12px">Không có hẹn giờ công bố. "Công bố" = hiện lên feed ngay. Ngày hiệu lực tương lai → bài vẫn hiện ngay với nhãn "Sắp hiệu lực".</p><div data-err></div>';
    }
    foot.innerHTML=(step>1?'<button class="phf-notice-btn is-ghost" data-back>Quay lại</button>':'')
      +(!isLast()?'<button class="phf-notice-btn is-primary" data-next>Tiếp tục</button>'
        :'<button class="phf-notice-btn" data-save>Lưu nháp</button><button class="phf-notice-btn is-primary" data-publish>'+(edit&&d.status==='published'?'Lưu chỉnh sửa':'Công bố')+'</button>');
    if(step>1)foot.querySelector('[data-back]').onclick=function(){harvest(body);step--;draw();};
    if(!isLast())foot.querySelector('[data-next]').onclick=function(){
      harvest(body);
      if(step===1&&(!model.title.trim()||!model.contentText.trim())){toast('error','Thiếu thông tin','Tiêu đề và nội dung là bắt buộc.');return;}
      step++;draw();
      if(step===settingsStep())runDupCheck();
    };
    if(isLast()){foot.querySelector('[data-save]').onclick=function(){harvest(body);submit(false);};foot.querySelector('[data-publish]').onclick=function(){harvest(body);submit(true);};}
  }
  function drawPending(host){
    if(!host)return;
    if(!model.pendingAtts.length){host.innerHTML='<p class="hint">Chưa chọn tệp nào.</p>';return;}
    host.innerHTML=model.pendingAtts.map(function(a,i){
      var inner=a.kind==='link'
        ? (ICON.link+' <span>'+esc(a.linkUrl)+'</span>')
        : ((a.thumb?'<img src="'+a.thumb+'" alt="" class="phf-notice-att-thumb">':ICON.file)+' <span>'+esc(a.name)+' <em>('+Math.max(1,Math.round(a.size/1024))+' KB)</em></span>');
      return '<div class="phf-notice-att-pend-row">'+inner+'<button type="button" class="phf-notice-att-rm" data-rm="'+i+'">×</button></div>';
    }).join('');
    host.querySelectorAll('[data-rm]').forEach(function(b){b.onclick=function(){model.pendingAtts.splice(Number(b.getAttribute('data-rm')),1);drawPending(host);};});
  }
  async function runDupCheck(){
    var host=ov.querySelector('[data-dup]');if(!host)return;
    host.innerHTML='<p class="hint">Đang kiểm tra nội dung tương tự…</p>';
    try{
      var r=await call('noticeSimilar',{title:model.title,content_text:model.contentText,keywords:model.keywords.split(',').map(function(x){return x.trim();}).filter(Boolean),exclude_id:edit?d.id:''});
      if(!r.candidates||!r.candidates.length){host.innerHTML='';return;}
      host.innerHTML='<div class="phf-notice-dup"><b>⚠ Có thể trùng nội dung</b><p class="hint">Bạn vẫn có thể tiếp tục công bố. Kiểm tra các bài đang hiệu lực bên dưới:</p>'
        +r.candidates.map(function(x){return '<a href="#" data-dup-open="'+esc(x.id)+'">'+esc(x.title)+' <small>· '+esc(x.categoryName)+' · '+esc(ST_LABEL[x.effectiveStatus]||x.effectiveStatus)+'</small></a>';}).join('')+'</div>';
      host.querySelectorAll('[data-dup-open]').forEach(function(a){a.onclick=function(e){e.preventDefault();window.open(prefix()+'/thong-bao/n/'+encodeURIComponent(a.getAttribute('data-dup-open')),'_blank');};});
    }catch(e){host.innerHTML='';}
  }
  function harvest(body){
    var g=function(sel){return body.querySelector(sel);};
    if(g('[data-f-title]'))model.title=g('[data-f-title]').value;
    if(g('[data-f-content]'))model.contentText=g('[data-f-content]').value;
    if(g('[data-f-type]'))model.noticeType=g('[data-f-type]').value;
    if(g('[data-f-prio]'))model.priority=g('[data-f-prio]').value;
    if(g('[data-f-scopemode]'))model.scopeMode=g('[data-f-scopemode]').value;
    if(g('[data-f-scopetext]'))model.scopeText=g('[data-f-scopetext]').value;
    if(g('[data-f-from]'))model.effectiveFrom=g('[data-f-from]').value;
    if(g('[data-f-to]'))model.effectiveTo=g('[data-f-to]').value;
    if(g('[data-f-ack]'))model.requireAcknowledgement=g('[data-f-ack]').checked;
    if(g('[data-f-kw]'))model.keywords=g('[data-f-kw]').value;
    if(g('[data-f-reack]'))model.requireReack=g('[data-f-reack]').checked;
  }
  function scopesPayload(){
    if(model.scopeMode==='company')return [{scope_type:'company'}];
    var parts=model.scopeText.split(',').map(function(x){return x.trim();}).filter(Boolean);
    return parts.length?parts.map(function(v){return {scope_type:'department',scope_value:v};}):[{scope_type:'company'}];
  }
  async function submit(publish){
    var kws=model.keywords.split(',').map(function(x){return x.trim();}).filter(Boolean);
    var base={title:model.title,content_text:model.contentText,notice_type:model.noticeType,priority:model.priority,
      effective_from:model.effectiveFrom,effective_to:model.effectiveTo||'',require_acknowledgement:model.requireAcknowledgement,scopes:scopesPayload(),keywords:kws};
    var errBox=ov.querySelector('[data-err]');
    function fail(m){if(errBox)errBox.innerHTML='<div class="phf-notice-err">'+esc(m)+'</div>';else toast('error','Lỗi',m);}
    try{
      var id;
      if(edit){
        base.id=d.id;base.require_reacknowledgement=model.requireReack;
        await call('noticeUpdate',base);id=d.id;
        if(publish&&d.status!=='published')await call('noticePublish',{id:id});
      }else{
        var cr=await call('noticeCreate',base);id=cr.id;
        // attachments belong to this draft — upload BEFORE publish; abort on failure
        for(var k=0;k<model.pendingAtts.length;k++){
          var a=model.pendingAtts[k];
          try{
            if(a.kind==='link')await call('noticeAttachmentAdd',{notice_id:id,kind:'link',link_url:a.linkUrl});
            else await call('noticeAttachmentAdd',{notice_id:id,kind:'file',file_name:a.name,mime_type:a.mime,base64:a.b64});
          }catch(ae){
            fail('Tải tệp đính kèm "'+(a.name||a.linkUrl)+'" thất bại: '+noticeErrMsg({code:ae.code,message:ae.message})+'. Bài đã lưu ở dạng NHÁP — chưa công bố. Bạn có thể thử lại ở màn chi tiết.');
            close();go(prefix()+'/thong-bao/n/'+encodeURIComponent(id));return;
          }
        }
        if(publish)await call('noticePublish',{id:id});
      }
      close();toast('success',publish?'Đã công bố':'Đã lưu nháp','');
      go(prefix()+'/thong-bao/n/'+encodeURIComponent(id));
    }catch(err){fail(noticeErrMsg({code:err.code,message:err.message}));}
  }
  draw();
}
// lightweight client mirror of the server htmlFromText for the preview only.
function htmlFromTextFE(txt){
  var out=[],para=[];
  function flush(){if(para.length){out.push('<p>'+para.join('<br>')+'</p>');para=[];}}
  String(txt).replace(/\r\n?/g,'\n').split('\n').forEach(function(line){
    var h=line.match(/^(#{2,4})\s+(.*\S)\s*$/);
    if(h){flush();out.push('<h'+h[1].length+'>'+esc(h[2])+'</h'+h[1].length+'>');}
    else if(!line.trim())flush();
    else para.push(esc(line));
  });
  flush();return out.join('')||'<p></p>';
}

/* ================= CATEGORIES (manager) ================= */
async function renderCategories(ctx){
  var inner=setWork(ctx,'<div class="phf-notice-head"><div><h1>Danh mục</h1>'
    +'<p>Phân loại nội dung của thông báo — KHÔNG giới hạn quyền xem. Danh mục đã có bài không thể xóa, chỉ có thể ngừng sử dụng. Tìm kiếm vẫn tự động chạy bất kể danh mục.</p></div>'
    +'<div class="phf-notice-head-actions"><button class="phf-notice-btn is-primary" data-nt-cat-add>+ Thêm danh mục</button></div></div>'
    +'<div class="phf-notice-tablewrap" data-nt-cattable><div class="phf-notice-loading">Đang tải…</div></div>');
  async function reload(){
    await loadCategories(true);
    var l=STATE.categories||[];
    inner.querySelector('[data-nt-cattable]').innerHTML='<table class="phf-notice-table"><thead><tr><th>Thứ tự</th><th>Tên danh mục</th><th>Slug</th><th>Số bài</th><th>Trạng thái</th><th></th></tr></thead><tbody>'
      +l.map(function(c,i){return '<tr>'
        +'<td><button class="phf-notice-btn is-small" data-up="'+i+'" '+(i===0?'disabled':'')+'>↑</button> <button class="phf-notice-btn is-small" data-down="'+i+'" '+(i===l.length-1?'disabled':'')+'>↓</button></td>'
        +'<td><input type="text" class="phf-notice-cat-name" data-name="'+esc(c.slug)+'" value="'+esc(c.name)+'"></td>'
        +'<td class="muted">'+esc(c.slug)+(c.isSystem?' <em>(mặc định)</em>':'')+'</td>'
        +'<td>'+(c.useCount||0)+'</td>'
        +'<td><span class="phf-notice-toggle"><input type="checkbox" data-active="'+esc(c.slug)+'" '+(c.isActive?'checked':'')+'><span></span></span></td>'
        +'<td><button class="phf-notice-btn is-small" data-rename="'+esc(c.slug)+'">Lưu tên</button></td>'
      +'</tr>';}).join('')+'</tbody></table>';
    var tbl=inner.querySelector('[data-nt-cattable]');
    tbl.querySelectorAll('[data-rename]').forEach(function(b){b.onclick=async function(){
      var slug=b.getAttribute('data-rename');var val=(tbl.querySelector('[data-name="'+slug+'"]')||{}).value||'';
      try{await call('noticeCategoriesUpsert',{slug:slug,name:val});toast('success','Đã đổi tên','');reload();}catch(e){toast('error','Lỗi',e.message);}
    };});
    tbl.querySelectorAll('[data-active]').forEach(function(inp){inp.onchange=async function(){
      try{await call('noticeCategoriesUpsert',{slug:inp.getAttribute('data-active'),is_active:inp.checked});toast('success',inp.checked?'Đã bật danh mục':'Đã ngừng danh mục','');reload();}catch(e){inp.checked=!inp.checked;toast('error','Lỗi',e.message);}
    };});
    function move(i,j){var order=l.map(function(c){return c.slug;});var t=order[i];order[i]=order[j];order[j]=t;call('noticeCategoriesReorder',{order:order}).then(reload).catch(function(e){toast('error','Lỗi',e.message);});}
    tbl.querySelectorAll('[data-up]').forEach(function(b){b.onclick=function(){var i=Number(b.getAttribute('data-up'));move(i,i-1);};});
    tbl.querySelectorAll('[data-down]').forEach(function(b){b.onclick=function(){var i=Number(b.getAttribute('data-down'));move(i,i+1);};});
  }
  inner.querySelector('[data-nt-cat-add]').onclick=function(){
    var name=prompt('Tên danh mục mới:');if(!name||!name.trim())return;
    call('noticeCategoriesUpsert',{name:name.trim()}).then(function(){toast('success','Đã thêm danh mục','');reload();}).catch(function(e){toast('error','Lỗi',e.message);});
  };
  await reload();
}

/* ================= REPORT / AUDIT OVERLAYS ================= */
function openReport(p,id,title){
  var ov=document.createElement('div');ov.className='phf-notice-ov';document.body.appendChild(ov);
  ov.innerHTML='<div class="phf-notice-ov-panel wide"><div class="phf-notice-ov-head"><h2>Báo cáo tiếp nhận</h2><button class="x" data-x>×</button></div><div class="phf-notice-ov-body"><div class="phf-notice-loading">Đang tính…</div></div></div>';
  ov.querySelector('[data-x]').onclick=function(){ov.remove();};
  call('noticeReport',{id:id}).then(function(r){
    var s=r.summary;
    ov.querySelector('.phf-notice-ov-body').innerHTML='<p class="hint" style="margin:0 0 12px">'+esc(title)+' · Nhóm áp dụng chính: '+(r.scope.company?'Toàn công ty':esc(r.scope.values.join(', ')||'—'))+(r.requireReackPending?' · <b style="color:#A5342A">Có người cần xác nhận lại phiên bản mới</b>':'')+'</p>'
      +'<div class="phf-notice-report-kpis">'+kpi(s.denominator,'Tài khoản đang hoạt động')+kpi(s.viewed,'Đã xem')+kpi(s.acknowledged,'Đã xác nhận')+kpi(s.notViewed,'Chưa xem')+kpi(s.viewedNotAcknowledged,'Đã xem, chưa xác nhận')+'</div>'
      +'<div class="phf-notice-subhead">Chi tiết nhóm áp dụng chính ('+r.primary.length+')</div><div class="phf-notice-scroll">'+peopleTable(r.primary)+'</div>'
      +(r.others.length?'<div class="phf-notice-subhead">Người khác đã xem / xác nhận ('+r.others.length+')</div><div class="phf-notice-scroll">'+peopleTable(r.others)+'</div>':'');
  }).catch(function(err){ov.querySelector('.phf-notice-ov-body').innerHTML='<div class="phf-notice-warn">'+esc(noticeErrMsg({code:err.code,message:err.message}))+'</div>';});
}
function kpi(v,l){return '<div class="phf-notice-kpi"><b>'+v+'</b><span>'+esc(l)+'</span></div>';}
function peopleTable(rows){
  if(!rows.length)return '<div class="phf-notice-empty" style="padding:24px">Không có dữ liệu.</div>';
  return '<div class="phf-notice-tablewrap"><table class="phf-notice-table"><thead><tr><th>Họ tên</th><th>Mã NV</th><th>Phòng ban/CN</th><th>Chức danh</th><th>TT</th><th>Đã xem</th><th>Xác nhận</th></tr></thead><tbody>'
    +rows.map(function(x){return '<tr><td>'+esc(x.fullName)+'</td><td>'+esc(x.employeeCode)+'</td><td>'+esc([x.department,x.branch].filter(Boolean).join(' / '))+'</td><td>'+esc(x.title)+'</td>'
      +'<td'+(x.active?'':' class="muted"')+'>'+(x.active?'HĐ':'Nghỉ')+'</td>'
      +'<td class="'+(x.viewedAt?'ok':'no')+'">'+(x.viewedAt?fmtDate(x.viewedAt):'—')+'</td>'
      +'<td class="'+(x.acknowledgedAt?(x.acknowledgedCurrent?'ok':''):'no')+'">'+(x.acknowledgedAt?fmtDate(x.acknowledgedAt)+(x.acknowledgedCurrent?'':' (cũ)'):'—')+'</td></tr>';}).join('')
    +'</tbody></table></div>';
}
function openAudit(p,id,title){
  var ov=document.createElement('div');ov.className='phf-notice-ov';document.body.appendChild(ov);
  ov.innerHTML='<div class="phf-notice-ov-panel"><div class="phf-notice-ov-head"><h2>Lịch sử thay đổi</h2><button class="x" data-x>×</button></div><div class="phf-notice-ov-body"><div class="phf-notice-loading">Đang tải…</div></div></div>';
  ov.querySelector('[data-x]').onclick=function(){ov.remove();};
  call('noticeAuditLog',{id:id}).then(function(r){
    ov.querySelector('.phf-notice-ov-body').innerHTML=r.entries.length?'<div class="phf-notice-tablewrap"><table class="phf-notice-table"><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Thao tác</th></tr></thead><tbody>'
      +r.entries.map(function(e){return '<tr><td>'+fmtDateTime(e.createdAt)+'</td><td>'+esc(e.actorName)+'</td><td>'+esc(e.actionType)+'</td></tr>';}).join('')+'</tbody></table></div>'
      :'<div class="phf-notice-empty" style="padding:24px">Chưa có lịch sử.</div>';
  }).catch(function(err){ov.querySelector('.phf-notice-ov-body').innerHTML='<div class="phf-notice-warn">'+esc(err.message)+'</div>';});
}

/* ================= PERMISSION SCREEN ================= */
async function renderPermission(ctx){
  var inner=setWork(ctx,'<div class="phf-notice-head"><div><h1>Cài đặt quyền</h1>'
    +'<p>Tài khoản được bật = <b>Quản trị nội dung</b> (tạo/sửa/xóa/ghim/xem báo cáo). Tắt = <b>Chỉ xem</b> (mặc định mọi tài khoản). Admin luôn có toàn quyền, không thể bị gỡ bằng nút gạt. Chỉ Admin đổi được quyền này. Mọi thay đổi đều được ghi vết.</p></div></div>'
    +'<div class="phf-notice-perm-search"><input type="text" data-nt-psearch placeholder="Tìm theo tên / mã NV / phòng ban"></div>'
    +'<div class="phf-notice-tablewrap" data-nt-ptable><div class="phf-notice-loading">Đang tải danh sách…</div></div>');
  var data;
  try{data=await call('noticePermissionRoster',{});}
  catch(err){inner.querySelector('[data-nt-ptable]').innerHTML='<div class="phf-notice-warn">'+esc(noticeErrMsg({code:err.code,message:err.message}))+'</div>';return;}
  var isAdmin=ctx.boot.viewer.isAdmin,q='';
  function paint(){
    var rows=data.roster.filter(function(x){if(!q)return true;return (x.fullName+' '+x.employeeCode+' '+x.department+' '+x.branch).toLowerCase().indexOf(q)>=0;});
    inner.querySelector('[data-nt-ptable]').innerHTML='<table class="phf-notice-table"><thead><tr><th>Họ tên</th><th>Mã NV</th><th>Chức danh</th><th>Phòng ban</th><th>Trạng thái</th><th>Quản trị nội dung</th></tr></thead><tbody>'
      +rows.map(function(x){return '<tr><td>'+esc(x.fullName)+'</td><td>'+esc(x.employeeCode)+'</td><td>'+esc(x.title)+'</td><td>'+esc([x.department,x.branch].filter(Boolean).join(' / '))+'</td>'
        +'<td'+(x.status==='active'?'':' class="muted"')+'>'+(x.status==='active'?'Đang làm':'Đã nghỉ')+'</td>'
        +'<td><span class="phf-notice-toggle"><input type="checkbox" data-nt-tog="'+esc(x.employeeCode)+'" '+(x.canManage?'checked':'')+' '+(isAdmin?'':'disabled')+'><span></span></span></td></tr>';}).join('')
      +'</tbody></table>'+(isAdmin?'':'<p class="hint" style="padding:8px 10px">Bạn quản trị nội dung nhưng không phải Admin — chỉ Admin đổi được quyền.</p>');
    inner.querySelectorAll('[data-nt-tog]').forEach(function(inp){
      inp.onchange=async function(){
        var code=inp.getAttribute('data-nt-tog');inp.disabled=true;
        try{await call('noticeSetPermission',{employee_code:code,can_manage:inp.checked});
          var row=data.roster.find(function(r){return r.employeeCode===code;});if(row)row.canManage=inp.checked;
          toast('success','Đã cập nhật quyền','');}
        catch(err){inp.checked=!inp.checked;toast('error','Không đổi được quyền',err.message);}
        finally{inp.disabled=!isAdmin;}
      };
    });
  }
  var se=inner.querySelector('[data-nt-psearch]');
  se.oninput=function(){q=se.value.trim().toLowerCase();paint();};
  paint();
}

window.__phfNoticeTestHooks={screenForPath:screenForPath,typeLabel:typeLabel,noticeErrMsg:noticeErrMsg,cardHtml:cardHtml,navItems:navItems,prioLabel:prioLabel,htmlFromTextFE:htmlFromTextFE};
})();
