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
var STATE={boot:null};

function screenForPath(p){
  var m=String(p||'').match(/\/thong-bao(?:\/(bao-cao|quyen|n\/([^/?#]+)))?/);
  if(!m)return {key:'feed'};
  if(m[1]==='bao-cao')return {key:'bao-cao'};
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

  var ctx={main:main,work:work,p:p,requestedPath:requestedPath,boot:boot};
  if(scr.key==='quyen'){ if(!boot.capabilities.canManage){go(p+'/thong-bao');return true;} await renderPermission(ctx); }
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
  NT_TYPES.forEach(function(t){out+='<button class="phf-notice-chip'+(FEED_FILTER.type===t[0]?' is-on':'')+'" data-nt-type="'+t[0]+'">'+esc(t[1])+'</button>';});
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
function cardHtml(n){
  var st=n.effectiveStatus,state='';
  if(n.viewer.acknowledged)state='<span class="phf-notice-tick">✓ Đã xác nhận'+(n.viewer.acknowledgedRevisionIsCurrent?'':' (bản cũ)')+'</span>';
  else if(n.requireAcknowledgement)state='<span class="phf-notice-need-ack">Cần xác nhận</span>';
  else if(n.viewer.viewed)state='<span class="phf-notice-seen">Đã xem</span>';
  return '<article class="phf-notice-card'+(n.isPinned?' is-pinned':'')+'" data-nt-card="'+esc(n.id)+'">'
    +'<div class="phf-notice-card-top">'
      +(n.isPinned?'<span class="phf-notice-badge pin">📌 Ghim</span>':'')
      +'<span class="phf-notice-badge type">'+esc(typeLabel(n.noticeType))+'</span>'
      +'<span class="phf-notice-badge st-'+st+'">'+esc(ST_LABEL[st]||st)+(st==='upcoming'&&n.effectiveFrom?' · từ '+fmtDate(n.effectiveFrom):'')+'</span>'
      +(n.status==='draft'?'<span class="phf-notice-badge st-draft">Nháp</span>':'')
    +'</div>'
    +'<h3>'+esc(n.title)+'</h3><p class="excerpt">'+esc(n.excerpt)+'</p>'
    +'<div class="phf-notice-card-meta">'
      +'<span class="phf-notice-scope">'+esc(scopeText(n.scopes))+'</span>'
      +'<span class="dot"></span><span>'+fmtDate(n.publishedAt||n.updatedAt)+'</span>'
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

  var att=(n.attachments||[]).length?'<div class="phf-notice-attach"><h4>Tệp / liên kết đính kèm</h4>'
    +n.attachments.map(function(a){return a.kind==='link'
      ?'<a href="'+esc(a.linkUrl)+'" target="_blank" rel="noopener">'+ICON.link+' '+esc(a.linkUrl)+'</a>'
      :'<a href="#" data-nt-att="'+esc(a.id)+'">'+ICON.file+' '+esc(a.fileName||'Tệp đính kèm')+'</a>';}).join('')+'</div>':'';

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
      +'<span class="phf-notice-badge type">'+esc(typeLabel(n.noticeType))+'</span><span class="phf-notice-badge st-'+st+'">'+esc(ST_LABEL[st]||st)+'</span></div>'
    +'<h1>'+esc(n.title)+'</h1>'
    +'<div class="phf-notice-detail-meta"><span>Áp dụng: <b>'+esc(scopeText(n.scopes))+'</b></span>'
      +'<span>Hiệu lực: '+fmtDate(n.effectiveFrom)+(n.effectiveTo?' → '+fmtDate(n.effectiveTo):' → không thời hạn')+'</span>'
      +'<span>Công bố: '+fmtDate(n.publishedAt)+'</span>'
      +(n.keywords.length?'<span>Từ khóa: '+esc(n.keywords.join(', '))+'</span>':'')+'</div>'
    +warn
    +'<div class="phf-notice-body">'+(n.contentHtml||('<p>'+esc(n.contentText).replace(/\n/g,'<br>')+'</p>'))+'</div>'
    +att+ackHtml+mgr+'</div>');

  i.querySelector('[data-nt-back]').onclick=function(){go(p+'/thong-bao');};
  i.querySelectorAll('[data-nt-goto]').forEach(function(a){a.onclick=function(e){e.preventDefault();go(p+'/thong-bao/n/'+encodeURIComponent(a.getAttribute('data-nt-goto')));};});
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
function openWizard(p,existing){
  var edit=!!existing,d=existing||{};
  var model={
    title:d.title||'',contentText:d.contentText||'',contentHtml:d.contentHtml||'',
    noticeType:d.noticeType||'guide',
    scopeMode:(d.scopes&&d.scopes.some(function(s){return s.scopeType!=='company';}))?'custom':'company',
    scopeText:(d.scopes||[]).filter(function(s){return s.scopeType!=='company';}).map(function(s){return s.scopeValue;}).join(', '),
    effectiveFrom:d.effectiveFrom||todayInput(),effectiveTo:d.effectiveTo||'',
    requireAcknowledgement:!!d.requireAcknowledgement,keywords:(d.keywords||[]).join(', '),requireReack:false
  };
  var step=1;
  var ov=document.createElement('div');ov.className='phf-notice-ov';document.body.appendChild(ov);
  function close(){ov.remove();}
  function draw(){
    ov.innerHTML='<div class="phf-notice-ov-panel"><div class="phf-notice-ov-head"><h2>'+(edit?'Chỉnh sửa thông báo':'Đăng thông báo mới')+'</h2><button class="x" data-x>×</button></div>'
      +'<div class="phf-notice-ov-body"><div class="phf-notice-steps"><span class="'+(step>=1?'on':'')+'"></span><span class="'+(step>=2?'on':'')+'"></span><span class="'+(step>=3?'on':'')+'"></span></div><div data-body></div></div>'
      +'<div class="phf-notice-ov-foot" data-foot></div></div>';
    ov.querySelector('[data-x]').onclick=close;
    var body=ov.querySelector('[data-body]'),foot=ov.querySelector('[data-foot]');
    if(step===1){
      body.innerHTML='<div class="phf-notice-field"><label>Tiêu đề *</label><input type="text" data-f-title value="'+esc(model.title)+'" placeholder="VD: Cập nhật cách bấm bill khi khách sử dụng Voucher"></div>'
        +'<div class="phf-notice-field"><label>Nội dung chính (hiển thị trên web) *</label><textarea data-f-content placeholder="Dán nguyên văn từ Zalo hoặc tài liệu cũ.">'+esc(model.contentText||model.contentHtml.replace(/<[^>]+>/g,''))+'</textarea><div class="hint">V1: nhập văn bản thuần; xuống dòng được giữ. Trình soạn thảo giàu định dạng + đính kèm bổ sung ở bản sau.</div></div>';
    }else if(step===2){
      body.innerHTML='<div class="phf-notice-inline"><div class="phf-notice-field"><label>Loại *</label><select data-f-type>'+NT_TYPES.map(function(t){return '<option value="'+t[0]+'"'+(model.noticeType===t[0]?' selected':'')+'>'+esc(t[1])+'</option>';}).join('')+'</select></div>'
        +'<div class="phf-notice-field"><label>Áp dụng</label><select data-f-scopemode><option value="company"'+(model.scopeMode==='company'?' selected':'')+'>Toàn công ty</option><option value="custom"'+(model.scopeMode==='custom'?' selected':'')+'>Chọn phòng ban / chi nhánh</option></select></div></div>'
        +'<div class="phf-notice-field" data-scope-wrap style="'+(model.scopeMode==='custom'?'':'display:none')+'"><label>Phòng ban / chi nhánh áp dụng</label><input type="text" data-f-scopetext value="'+esc(model.scopeText)+'" placeholder="VD: Bán hàng, Kho"><div class="hint">"Áp dụng" chỉ là nhãn + mẫu số báo cáo — KHÔNG giới hạn quyền xem. Mọi tài khoản vẫn đọc và xác nhận được.</div></div>'
        +'<div class="phf-notice-inline"><div class="phf-notice-field"><label>Hiệu lực từ *</label><input type="date" data-f-from value="'+esc(model.effectiveFrom)+'"></div>'
        +'<div class="phf-notice-field"><label>Hết hiệu lực (tùy chọn)</label><input type="date" data-f-to value="'+esc(model.effectiveTo)+'"><div class="hint">Bỏ trống = không thời hạn.</div></div></div>'
        +'<div class="phf-notice-field"><label class="phf-notice-check"><input type="checkbox" data-f-ack '+(model.requireAcknowledgement?'checked':'')+'> Yêu cầu người đọc xác nhận "Tôi đã đọc và nắm thông tin"</label></div>'
        +'<div class="phf-notice-field"><label>Từ khóa (tùy chọn)</label><input type="text" data-f-kw value="'+esc(model.keywords)+'" placeholder="voucher, bấm bill, F6, chiết khấu, mã giảm giá, POS"></div>'
        +(edit&&d.status==='published'?'<div class="phf-notice-field"><label class="phf-notice-check"><input type="checkbox" data-f-reack '+(model.requireReack?'checked':'')+'> Yêu cầu xác nhận lại vì nội dung thay đổi</label><div class="hint">Bật = tạo phiên bản mới; xác nhận cũ vẫn lưu lịch sử, người dùng phải xác nhận lại.</div></div>':'');
      var sm=body.querySelector('[data-f-scopemode]');
      sm.onchange=function(){body.querySelector('[data-scope-wrap]').style.display=sm.value==='custom'?'':'none';};
    }else{
      var ss=model.scopeMode==='company'?'Toàn công ty':(model.scopeText||'(chưa chọn)');
      body.innerHTML='<div class="phf-notice-summary"><dl>'
        +'<dt>Tiêu đề</dt><dd>'+esc(model.title||'(trống)')+'</dd><dt>Loại</dt><dd>'+esc(typeLabel(model.noticeType))+'</dd>'
        +'<dt>Áp dụng</dt><dd>'+esc(ss)+'</dd><dt>Hiệu lực</dt><dd>'+fmtDate(model.effectiveFrom)+(model.effectiveTo?' → '+fmtDate(model.effectiveTo):' → không thời hạn')+'</dd>'
        +'<dt>Yêu cầu xác nhận</dt><dd>'+(model.requireAcknowledgement?'Có':'Không')+'</dd></dl></div>'
        +'<p class="hint" style="margin-top:12px">Không có hẹn giờ công bố. "Công bố" = hiện lên feed ngay. Nếu ngày hiệu lực ở tương lai, bài vẫn hiện ngay với nhãn "Sắp hiệu lực".</p><div data-err></div>';
    }
    foot.innerHTML=(step>1?'<button class="phf-notice-btn is-ghost" data-back>Quay lại</button>':'')
      +(step<3?'<button class="phf-notice-btn is-primary" data-next>Tiếp tục</button>'
        :'<button class="phf-notice-btn" data-save>Lưu nháp</button><button class="phf-notice-btn is-primary" data-publish>'+(edit&&d.status==='published'?'Lưu chỉnh sửa':'Công bố')+'</button>');
    if(step>1)foot.querySelector('[data-back]').onclick=function(){harvest(body);step--;draw();};
    if(step<3)foot.querySelector('[data-next]').onclick=function(){harvest(body);if(step===1&&(!model.title.trim()||!(model.contentText||'').trim())){toast('error','Thiếu thông tin','Tiêu đề và nội dung là bắt buộc.');return;}step++;draw();};
    if(step===3){foot.querySelector('[data-save]').onclick=function(){submit(false);};foot.querySelector('[data-publish]').onclick=function(){submit(true);};}
  }
  function harvest(body){
    var g=function(s){return body.querySelector(s);};
    if(g('[data-f-title]'))model.title=g('[data-f-title]').value;
    if(g('[data-f-content]')){model.contentText=g('[data-f-content]').value;model.contentHtml='<p>'+esc(g('[data-f-content]').value).replace(/\n{2,}/g,'</p><p>').replace(/\n/g,'<br>')+'</p>';}
    if(g('[data-f-type]'))model.noticeType=g('[data-f-type]').value;
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
    var parts=model.scopeText.split(',').map(function(s){return s.trim();}).filter(Boolean);
    return parts.length?parts.map(function(v){return {scope_type:'department',scope_value:v};}):[{scope_type:'company'}];
  }
  async function submit(publish){
    var kws=model.keywords.split(',').map(function(s){return s.trim();}).filter(Boolean);
    var base={title:model.title,content_html:model.contentHtml,content_text:model.contentText,notice_type:model.noticeType,
      effective_from:model.effectiveFrom,effective_to:model.effectiveTo||'',require_acknowledgement:model.requireAcknowledgement,scopes:scopesPayload(),keywords:kws};
    var errBox=ov.querySelector('[data-err]');
    try{
      var id;
      if(edit){base.id=d.id;base.require_reacknowledgement=model.requireReack;await call('noticeUpdate',base);id=d.id;if(publish&&d.status!=='published')await call('noticePublish',{id:id});}
      else{var cr=await call('noticeCreate',base);id=cr.id;if(publish)await call('noticePublish',{id:id});}
      close();toast('success',publish?'Đã công bố':'Đã lưu nháp','');
      go(prefix()+'/thong-bao/n/'+encodeURIComponent(id));
    }catch(err){
      if(errBox)errBox.innerHTML='<div class="phf-notice-err">'+esc(noticeErrMsg({code:err.code,message:err.message}))+'</div>';else toast('error','Lỗi',err.message);
    }
  }
  draw();
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
    +'<div class="phf-notice-scroll" data-nt-ptable><div class="phf-notice-loading">Đang tải danh sách…</div></div>');
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

window.__phfNoticeTestHooks={screenForPath:screenForPath,typeLabel:typeLabel,noticeErrMsg:noticeErrMsg,cardHtml:cardHtml,navItems:navItems};
})();
