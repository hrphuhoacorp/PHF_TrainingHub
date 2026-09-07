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
  link:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  inbox:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v10h-5l-2 3h-2l-2-3H4z"/><path d="M4 14V4m16 10V4"/></svg>'
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
/* STATE.boot + STATE.categories are cached for the LIFETIME of the SPA session
 * and reused on every in-app navigation. window.phfRenderNotice() used to
 * re-fetch BOTH on every feed<->detail<->screen switch (3 bridge round-trips
 * per navigation); now a navigation costs just the one screen read. boot is
 * invalidated after an acknowledgement / publish so "Cần tiếp nhận · N" stays
 * accurate; categories after any category admin mutation. */
var STATE={boot:null,categories:null};
function invalidateBoot(){STATE.boot=null;}
var NT_PRIO=[['normal','Thông thường'],['important','Quan trọng'],['urgent','Hỏa tốc']];
function prioLabel(v){for(var i=0;i<NT_PRIO.length;i++)if(NT_PRIO[i][0]===v)return NT_PRIO[i][1];return 'Thông thường';}
async function loadCategories(force){
  if(STATE.categories&&!force)return STATE.categories;
  try{var r=await call('noticeCategoriesList',{});STATE.categories=r.categories||[];}catch(e){STATE.categories=[];}
  return STATE.categories;
}
function catName(slug){var l=STATE.categories||[];for(var i=0;i<l.length;i++)if(l[i].slug===slug)return l[i].name;return typeLabel(slug);}
/* Category identity colour — stable per slug, carried sidebar->chip->detail.
 * DELIBERATELY a different hue family from effective-status (green/amber/grey).
 * 4 seeded slugs are pinned; any Admin-created category gets a deterministic
 * fallback from the slug hash so a new category is never un-styled. */
var CAT_PALETTE=[['#1B7B45','#E8F4EC'],['#245FA6','#E7EFF9'],['#0F766E','#E1F0EE'],['#9A6B12','#F6EFDF'],['#A5342A','#FBEAE7'],['#5B4FB0','#ECEAF7'],['#B45309','#FBEEDD']];
var CAT_NAMED={guide:1,process:2,policy:3,regulation:4};
function catHash(v){var h=5381,x=String(v);for(var i=0;i<x.length;i++)h=((h<<5)+h+x.charCodeAt(i))>>>0;return h;}
function catMeta(slug){var i=Object.prototype.hasOwnProperty.call(CAT_NAMED,slug)?CAT_NAMED[slug]:(catHash(slug)%CAT_PALETTE.length);var pr=CAT_PALETTE[i]||CAT_PALETTE[0];return {color:pr[0],wash:pr[1]};}
function typeBadge(slug,name){var m=catMeta(slug);return '<span class="phf-notice-badge type" style="background:'+m.wash+';color:'+m.color+'">'+esc(name||catName(slug))+'</span>';}
function stGlyph(st){return st==='active'?'●':st==='upcoming'?'◷':st==='expired'?'○':'▪';}
function stBadge(st,extra){return '<span class="phf-notice-badge st-'+st+'"><i class="phf-notice-st-glyph">'+stGlyph(st)+'</i>'+esc(ST_LABEL[st]||st)+(extra||'')+'</span>';}

function screenForPath(p){
  var s=String(p||'');
  var mDetail=s.match(/\/thong-bao\/n\/([^/?#]+)/);
  if(mDetail)return {key:'detail',id:decodeURIComponent(mDetail[1])};
  var mCat=s.match(/\/thong-bao\/loai\/([^/?#]+)/);
  if(mCat)return {key:'feed',cat:decodeURIComponent(mCat[1])};
  if(/\/thong-bao\/can-tiep-nhan(?:$|[/?#])/.test(s))return {key:'inbox'};
  if(/\/thong-bao\/bao-cao(?:$|[/?#])/.test(s))return {key:'bao-cao'};
  if(/\/thong-bao\/danh-muc(?:$|[/?#])/.test(s))return {key:'danh-muc'};
  if(/\/thong-bao\/quyen(?:$|[/?#])/.test(s))return {key:'quyen'};
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
/* Information architecture (Operator-locked): 3 groups — THÔNG BÁO (what every
 * reader needs: their inbox + all notices + one entry per ACTIVE category,
 * projected live from STATE.categories), THEO DÕI (Báo cáo tiếp nhận — only with
 * the capability), QUẢN TRỊ (Quản lý danh mục + Cài đặt quyền — only with the
 * capability). Reader category items are navigation/filters, NOT config screens.
 * Inactive categories never appear for a viewer. One category source only. */
function navGroups(boot,scr){
  var caps=(boot&&boot.capabilities)||{};
  var manage=!!caps.canManage;                              // đăng/sửa/xóa/ghim/danh mục/báo cáo
  var canPerm=!!(caps.canManagePermissions||(boot&&boot.viewer&&boot.viewer.isAdmin)); // Cài đặt quyền = Admin only
  var p=prefix();
  var pending=(boot&&boot.inbox&&boot.inbox.pendingCount)||0;
  var activeCat=(scr&&scr.cat)||'';
  var cats=(STATE.categories||[]).filter(function(c){return c.isActive!==false;});
  var thongBao=[
    {key:'inbox',label:'Cần tiếp nhận',icon:ICON.inbox,href:p+'/thong-bao/can-tiep-nhan',badge:pending,priority:true},
    {key:'feed',label:'Tất cả thông báo',icon:ICON.feed,href:p+'/thong-bao'}
  ];
  cats.forEach(function(c){
    thongBao.push({key:'cat:'+c.slug,label:c.name,child:true,dot:catMeta(c.slug).color,href:p+'/thong-bao/loai/'+encodeURIComponent(c.slug),
      active:(scr&&scr.key==='feed'&&activeCat===c.slug)});
  });
  // "Thông báo" is a COLLAPSIBLE parent (§1): chevron + expand/collapse, default
  // open on desktop. UI control only — no business route. THEO DÕI / QUẢN TRỊ flat.
  var groups=[{title:'Thông báo',key:'thong-bao',collapsible:true,items:thongBao}];
  if(manage){
    groups.push({title:'Theo dõi',items:[{key:'bao-cao',label:'Báo cáo tiếp nhận',icon:ICON.report,href:p+'/thong-bao/bao-cao'}]});
  }
  var admin=[];
  if(manage)admin.push({key:'danh-muc',label:'Quản lý danh mục',icon:ICON.tag,href:p+'/thong-bao/danh-muc'});
  if(canPerm)admin.push({key:'quyen',label:'Cài đặt quyền',icon:ICON.shield,href:p+'/thong-bao/quyen'});
  if(admin.length)groups.push({title:'Quản trị',items:admin});
  return groups;
}
var NAV_GROUP_OPEN={'thong-bao':true};
// kept for structural checks + any external caller: flat item list
function navItems(boot){
  var out=[];navGroups(boot,{key:'feed'}).forEach(function(g){g.items.forEach(function(it){out.push(it);});});return out;
}
function sidebarHtml(boot,scr){
  var activeKey=scr&&scr.key;
  var out='<nav class="phf-notice-nav" aria-label="Menu Thông báo Quản trị">'
    +'<button type="button" class="phf-notice-nav-back phf-notice-home-chip" data-nt-home>'+ICON.home+'<span>Về Trang chủ PHF HR</span></button>';
  navGroups(boot,scr).forEach(function(g){
    var openState=g.collapsible?(NAV_GROUP_OPEN[g.key]!==false):true;
    if(g.collapsible){
      out+='<button type="button" class="phf-notice-nav-title is-collapsible'+(openState?' is-open':'')+'" data-nt-group="'+esc(g.key)+'">'
        +'<span>'+esc(g.title)+'</span><i class="phf-notice-nav-chev">'+(openState?'−':'+')+'</i></button>';
    }else{
      out+='<div class="phf-notice-nav-title">'+esc(g.title)+'</div>';
    }
    out+='<div class="phf-notice-nav-items'+(g.collapsible&&!openState?' is-hidden':'')+'" data-nt-group-items="'+esc(g.key||'')+'">';
    g.items.forEach(function(it){
      var on=it.active||it.key===activeKey||(activeKey==='detail'&&it.key==='feed');
      var cls=(on?'is-active ':'')+(it.priority?'is-priority ':'')+(it.child?'is-child ':'')+(it.key==='feed'?'is-parent ':'');
      var lead=it.dot?'<i class="phf-notice-nav-dot" style="background:'+it.dot+'"></i>':(it.icon||'');
      out+='<button type="button" class="'+cls.trim()+'" data-nt-nav="'+esc(it.href)+'">'
        +lead+'<span>'+esc(it.label)+'</span>'
        +(it.badge?'<b class="phf-notice-nav-badge">'+it.badge+'</b>':'')+'</button>';
    });
    out+='</div>';
  });
  out+='</nav>';
  return out;
}
// group collapse toggle (§1) — pure DOM, no data reload
function wireNavGroups(slot){
  if(!slot)return;
  slot.querySelectorAll('[data-nt-group]').forEach(function(b){
    b.onclick=function(e){
      e.preventDefault();
      var k=b.getAttribute('data-nt-group');
      var open=NAV_GROUP_OPEN[k]===false;
      NAV_GROUP_OPEN[k]=open;
      b.classList.toggle('is-open',open);
      var chev=b.querySelector('.phf-notice-nav-chev');if(chev)chev.textContent=open?'−':'+';
      var items=slot.querySelector('[data-nt-group-items="'+k+'"]');if(items)items.classList.toggle('is-hidden',!open);
    };
  });
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
      +'<div class="phf-notice-top-right">'
        +'<button type="button" class="phf-notice-bell" data-nt-bell aria-label="Thông báo của tôi">'+ICON.bell+'<b class="phf-notice-bell-badge" data-nt-bell-badge hidden></b></button>'
        +'<div class="phf-notice-user" data-nt-user>'+userBlockHtml(null)+'</div>'
      +'</div>'
    +'</header>'
    +'<div class="phf-notice-shell"><div class="phf-notice-layout">'
      +'<div data-nt-nav-slot>'+sidebarHtml(STATE.boot,scr)+'</div>'
      +'<main class="phf-notice-work" data-nt-work><div class="phf-notice-work-inner"><div class="phf-notice-skel"></div><div class="phf-notice-skel"></div><div class="phf-notice-skel"></div></div></main>'
    +'</div></div></div>';

  var navSlot=main.querySelector('[data-nt-nav-slot]');
  var work=main.querySelector('[data-nt-work]');
  function wireNav(){
    navSlot.querySelectorAll('[data-nt-home]').forEach(function(b){b.onclick=function(e){e.preventDefault();var home=(typeof window.phfGetRoleHomePath==='function'&&window.phfGetRoleHomePath())||(p+'/home');go(home);};});
    navSlot.querySelectorAll('[data-nt-nav]').forEach(function(b){b.onclick=function(e){if(e.metaKey||e.ctrlKey||e.shiftKey)return;e.preventDefault();go(b.getAttribute('data-nt-nav'));};});
    wireNavGroups(navSlot);
  }
  wireNav();

  var boot;
  try{boot=STATE.boot||(STATE.boot=await call('noticeBootstrap',{}));}
  catch(err){
    STATE.boot=null;
    work.innerHTML='<div class="phf-notice-work-inner"><div class="phf-notice-warn">'+esc(noticeErrMsg({code:err.code,message:err.message}))+'</div><button class="phf-notice-btn" data-nt-retry>Thử lại</button></div>';
    work.querySelector('[data-nt-retry]').onclick=function(){window.phfRenderNotice(requestedPath);};
    document.title='Thông báo Quản trị · PHF HR';
    return true;
  }
  main.querySelector('[data-nt-user]').innerHTML=userBlockHtml(boot);

  if(boot.devLocked&&!boot.capabilities.canManage&&!boot.devOperator){
    work.innerHTML='<div class="phf-notice-work-inner"><div class="phf-notice-warn info">'+esc(boot.lockReason||'Module đang trong giai đoạn phát triển.')+'</div></div>';
    document.title='Thông báo Quản trị · PHF HR';
    return true;
  }

  await loadCategories();
  // sidebar needs boot (inbox count, capability) + categories (reader projection)
  navSlot.innerHTML=sidebarHtml(boot,scr);
  wireNav();
  var ctx={main:main,work:work,p:p,requestedPath:requestedPath,boot:boot};
  updateBellBadge(ctx);
  var bellBtn=main.querySelector('[data-nt-bell]');
  if(bellBtn)bellBtn.onclick=function(e){e.stopPropagation();openBellPanel(ctx);};
  if(scr.key==='danh-muc'){ if(!boot.capabilities.canManage){go(p+'/thong-bao');return true;} await renderCategories(ctx); }
  else if(scr.key==='quyen'){ if(!(boot.capabilities.canManagePermissions||(boot.viewer&&boot.viewer.isAdmin))){go(p+'/thong-bao');return true;} await renderPermission(ctx); }
  else if(scr.key==='bao-cao'){ if(!boot.capabilities.canManage){go(p+'/thong-bao');return true;} await renderReportIndex(ctx); }
  else if(scr.key==='detail'){ await renderDetail(ctx,scr.id); }
  else if(scr.key==='inbox'){ await renderFeed(ctx,{inbox:true}); }
  else{ await renderFeed(ctx,{cat:scr.cat||''}); }

  document.title='Thông báo Quản trị · PHF HR';
  try{window.scrollTo({top:0,behavior:'instant'});}catch(e){window.scrollTo(0,0);}
  return true;
};
function setWork(ctx,html){ctx.work.innerHTML='<div class="phf-notice-work-inner">'+html+'</div>';return ctx.work.querySelector('.phf-notice-work-inner');}
// Repaint the sidebar in place (inbox count / live category projection) without
// a full module re-render.
function repaintNav(ctx,scr){
  var ns=ctx.main&&ctx.main.querySelector('[data-nt-nav-slot]');if(!ns)return;
  ns.innerHTML=sidebarHtml(STATE.boot,scr||{key:'feed'});
  ns.querySelectorAll('[data-nt-home]').forEach(function(b){b.onclick=function(e){e.preventDefault();var h=(typeof window.phfGetRoleHomePath==='function'&&window.phfGetRoleHomePath())||(ctx.p+'/home');go(h);};});
  ns.querySelectorAll('[data-nt-nav]').forEach(function(b){b.onclick=function(e){if(e.metaKey||e.ctrlKey||e.shiftKey)return;e.preventDefault();go(b.getAttribute('data-nt-nav'));};});
  wireNavGroups(ns);
  updateBellBadge(ctx);
}

/* ================= CHUÔNG THÔNG BÁO (§5) ================= */
/* Reuses the module's own bootstrap data for the badge (no polling, no new
 * identity, no separate notification store) + one bounded read (noticeFeed
 * mode:'bell', ≤12 rows) fetched only when the panel opens. Badge = "chưa đọc"
 * for THIS viewer; "cần xác nhận" items are flagged in the panel. */
function updateBellBadge(ctx){
  var b=ctx.main&&ctx.main.querySelector('[data-nt-bell-badge]');if(!b)return;
  var n=(STATE.boot&&STATE.boot.bell&&STATE.boot.bell.unreadCount)||0;
  b.hidden=n===0;b.textContent=n>9?'9+':String(n);
}
function closeBellPanel(){var e=document.getElementById('phfNoticeBellPanel');if(e)e.remove();document.removeEventListener('click',bellOutside,true);}
function bellOutside(e){if(!e.target.closest('#phfNoticeBellPanel')&&!e.target.closest('[data-nt-bell]'))closeBellPanel();}
async function openBellPanel(ctx){
  if(document.getElementById('phfNoticeBellPanel')){closeBellPanel();return;}
  var host=ctx.main.querySelector('.phf-notice-top-right')||ctx.main.querySelector('.phf-notice-top');
  var panel=document.createElement('div');panel.id='phfNoticeBellPanel';panel.className='phf-notice-bell-panel';
  panel.innerHTML='<div class="phf-notice-bell-head"><b>Thông báo của tôi</b><button type="button" class="x" data-x>×</button></div>'
    +'<div class="phf-notice-bell-list"><div class="phf-notice-loading">Đang tải…</div></div>'
    +'<div class="phf-notice-bell-foot"><a href="#" data-all>Xem tất cả thông báo</a></div>';
  host.appendChild(panel);
  panel.querySelector('[data-x]').onclick=closeBellPanel;
  panel.querySelector('[data-all]').onclick=function(e){e.preventDefault();closeBellPanel();go(ctx.p+'/thong-bao');};
  setTimeout(function(){document.addEventListener('click',bellOutside,true);},0);
  var res;
  try{res=await call('noticeFeed',{mode:'bell'});}
  catch(err){panel.querySelector('.phf-notice-bell-list').innerHTML='<div class="phf-notice-warn">'+esc(noticeErrMsg({code:err.code,message:err.message}))+'</div>';return;}
  var rows=(res.notices||[]);
  if(!rows.length){panel.querySelector('.phf-notice-bell-list').innerHTML='<div class="phf-notice-bell-empty">Không có thông báo gần đây.</div>';return;}
  panel.querySelector('.phf-notice-bell-list').innerHTML=rows.map(function(n){
    var reack=n.viewer.acknowledged&&!n.viewer.acknowledgedRevisionIsCurrent;
    var tag=reack?'<span class="phf-notice-bell-tag ack">Cần xác nhận lại</span>'
      :(!n.viewer.acknowledged&&n.requireAcknowledgement?'<span class="phf-notice-bell-tag ack">Cần xác nhận</span>'
      :(!n.viewer.viewed?'<span class="phf-notice-bell-tag new">Chưa xem</span>':''));
    return '<button type="button" class="phf-notice-bell-item'+(!n.viewer.viewed?' is-unread':'')+'" data-b="'+esc(n.id)+'">'
      +'<div class="phf-notice-bell-item-top">'+prioBadge(n.priority)+(n.isPinned?'<span class="phf-notice-badge pin">📌</span>':'')+tag+'</div>'
      +'<h4>'+esc(n.title)+'</h4><small>'+esc(fmtDate(n.publishedAt||n.updatedAt))+' · '+esc(catName(n.noticeType))+'</small></button>';
  }).join('');
  panel.querySelectorAll('[data-b]').forEach(function(b){b.onclick=function(){var id=b.getAttribute('data-b');closeBellPanel();go(ctx.p+'/thong-bao/n/'+encodeURIComponent(id));};});
}

/* ================= FEED ================= */
/* Primary tabs on the feed = effective-status ONLY (Đang / Sắp / Hết hiệu lực),
 * default "Đang hiệu lực". Category is navigation now — chosen from the sidebar,
 * carried in FEED_FILTER.type (route /thong-bao/loai/<slug>). "Cần tiếp nhận" is
 * FEED_FILTER.mode='inbox'. Effective status stays DERIVED — no manual switch. */
var FEED_FILTER={q:'',type:'',status:'active',scope:'',includeDrafts:false,mode:''};
async function renderFeed(ctx,opts){
  opts=opts||{};
  var boot=ctx.boot,manage=boot.capabilities.canManage;
  FEED_FILTER.mode=opts.inbox?'inbox':'';
  if(!opts.inbox)FEED_FILTER.type=opts.cat||'';
  var inbox=FEED_FILTER.mode==='inbox';
  var catNm=FEED_FILTER.type?catName(FEED_FILTER.type):'';
  var pending=(boot.inbox&&boot.inbox.pendingCount)||0;
  var head=inbox
    ? '<div><h1>Cần tiếp nhận'+(pending?' · '+pending:'')+'</h1><p>Những thông báo đang chờ bạn xác nhận đã đọc. Xác nhận xong sẽ tự rời khỏi danh sách này.</p></div>'
    : (catNm
      ? '<div><h1>'+esc(catNm)+'</h1><p>Các thông báo thuộc danh mục này. <a href="#" data-nt-clearcat>Xem tất cả thông báo</a></p></div>'
      : '<div><h1>Thông báo</h1><p>Nơi tra cứu chính thức các quy định, chính sách, quy trình và hướng dẫn đang áp dụng.</p></div>');
  var inner=setWork(ctx,
    '<div class="phf-notice-head">'+head
    +'<div class="phf-notice-head-actions">'+((manage&&!inbox)?'<button class="phf-notice-btn is-primary" data-nt-create>+ Đăng thông báo</button>':'')+'</div></div>'
    +'<div class="phf-notice-search">'+ICON.search+'<input type="text" data-nt-q placeholder="Tìm quy định, hướng dẫn, cách xử lý..." value="'+esc(FEED_FILTER.q)+'"></div>'
    +(inbox?'':'<div class="phf-notice-filters" data-nt-filters>'+statusChips()
      +(manage?'<span class="sep"></span><input type="text" data-nt-scope placeholder="Lọc phòng ban / chi nhánh" value="'+esc(FEED_FILTER.scope)+'">'
        +'<label class="phf-notice-check" style="margin-left:8px"><input type="checkbox" data-nt-drafts '+(FEED_FILTER.includeDrafts?'checked':'')+'> Hiện bản nháp</label>':'')
    +'</div>')
    +'<div class="phf-notice-feed" data-nt-feed><div class="phf-notice-skel"></div><div class="phf-notice-skel"></div></div>');

  if(manage&&!inbox)inner.querySelector('[data-nt-create]').onclick=function(){openWizard(ctx.p,null);};
  var cc=inner.querySelector('[data-nt-clearcat]');if(cc)cc.onclick=function(e){e.preventDefault();go(ctx.p+'/thong-bao');};
  var q=inner.querySelector('[data-nt-q]'),deb;
  q.addEventListener('input',function(){clearTimeout(deb);deb=setTimeout(function(){FEED_FILTER.q=q.value.trim();loadFeed(ctx);},280);});
  var filters=inner.querySelector('[data-nt-filters]');
  if(filters)filters.addEventListener('click',function(e){
    var c=e.target.closest('[data-nt-status]');if(!c)return;
    FEED_FILTER.status=c.getAttribute('data-nt-status');
    filters.querySelectorAll('[data-nt-status]').forEach(function(b){b.classList.toggle('is-on',b.getAttribute('data-nt-status')===FEED_FILTER.status);});
    loadFeed(ctx);
  });
  var sc=inner.querySelector('[data-nt-scope]');
  if(sc)sc.addEventListener('input',function(){clearTimeout(deb);deb=setTimeout(function(){FEED_FILTER.scope=sc.value.trim();loadFeed(ctx);},280);});
  var dr=inner.querySelector('[data-nt-drafts]');if(dr)dr.addEventListener('change',function(){FEED_FILTER.includeDrafts=dr.checked;loadFeed(ctx);});
  await loadFeed(ctx);
}
function statusChips(){
  return [['active','Đang hiệu lực'],['upcoming','Sắp hiệu lực'],['expired','Hết hiệu lực'],['','Tất cả']]
    .map(function(x){return '<button class="phf-notice-chip st-chip-'+(x[0]||'all')+(FEED_FILTER.status===x[0]?' is-on':'')+'" data-nt-status="'+x[0]+'"><i class="phf-notice-st-glyph">'+(x[0]?stGlyph(x[0]):'')+'</i>'+esc(x[1])+'</button>';}).join('');
}
async function loadFeed(ctx){
  var wrap=ctx.work.querySelector('[data-nt-feed]');if(!wrap)return;
  wrap.innerHTML='<div class="phf-notice-skel"></div><div class="phf-notice-skel"></div>';
  var inbox=FEED_FILTER.mode==='inbox';
  var res;
  try{res=await call('noticeFeed',{q:FEED_FILTER.q,type:inbox?'':FEED_FILTER.type,status:inbox?'':FEED_FILTER.status,scope:FEED_FILTER.scope,include_drafts:FEED_FILTER.includeDrafts,mode:FEED_FILTER.mode});}
  catch(err){wrap.innerHTML='<div class="phf-notice-warn">'+esc(noticeErrMsg({code:err.code,message:err.message}))+'</div>';return;}
  if(!res.notices.length){
    var msg=inbox?'Bạn đã tiếp nhận tất cả thông báo. Không còn mục nào cần xác nhận.'
      :((FEED_FILTER.q||FEED_FILTER.type||FEED_FILTER.status||FEED_FILTER.scope)?'Không có thông báo khớp bộ lọc.':'Chưa có thông báo nào.');
    wrap.innerHTML='<div class="phf-notice-empty">'+ICON.bell+'<p>'+msg+'</p></div>';
    return;
  }
  wrap.innerHTML=res.notices.map(cardHtml).join('');
  wrap.querySelectorAll('[data-nt-card]').forEach(function(el){el.onclick=function(){go(ctx.p+'/thong-bao/n/'+encodeURIComponent(el.getAttribute('data-nt-card')));};});
}
function scopeText(scopes){return (scopes||[]).map(function(s){return s.scopeType==='company'?'Toàn công ty':s.scopeValue;}).join(', ')||'Toàn công ty';}
function attExt(a){var s=String((a&&a.fileName)||'');var m=s.match(/\.([a-z0-9]+)$/i);return (m?m[1]:String((a&&a.fileType)||'')).toLowerCase();}
function attIsImage(a){return /^(png|jpg|jpeg|gif|webp)$/.test(attExt(a))||/image\//.test(String((a&&a.fileType)||''));}
function attDocLabel(a){var e=attExt(a);
  if(e==='pdf')return 'PDF';
  if(e==='doc'||e==='docx')return 'Word';
  if(e==='xls'||e==='xlsx')return 'Excel';
  return e?e.toUpperCase():'Tệp';}
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
      +typeBadge(n.noticeType,n.categoryName)
      +stBadge(st,(st==='upcoming'&&n.effectiveFrom?' · từ '+fmtDate(n.effectiveFrom):''))
      +(n.status==='draft'?'<span class="phf-notice-badge st-draft">Nháp</span>':'')
    +'</div>'
    +'<h3>'+esc(n.title)+'</h3><p class="excerpt">'+esc(n.excerpt)+'</p>'
    +'<div class="phf-notice-card-meta">'
      +'<span class="phf-notice-scope">'+esc(scopeText(n.scopes))+'</span>'
      +'<span class="dot"></span><span>'+(n.edited?'Đã cập nhật '+fmtDate(n.updatedAt):fmtDate(n.publishedAt||n.updatedAt))+'</span>'
      +(n.attachmentFileCount?'<span class="dot"></span><span class="phf-notice-att-chip">📎 '+n.attachmentFileCount+' tệp</span>':'')
      +(n.attachmentLinkCount?'<span class="dot"></span><span class="phf-notice-att-chip">🔗 '+n.attachmentLinkCount+' liên kết</span>':'')
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
  var atts=(n.attachments||[]);
  // Reader-facing section right after the content (Operator §1): images as
  // thumbnails (lazy-fetched over the authenticated download channel — the
  // secure store + upload contract are untouched), documents as icon + name +
  // size, links as a visible URL. Nothing renders when there is no attachment.
  var attList=atts.length?'<div class="phf-notice-attach"><h4>Tệp & liên kết đính kèm</h4><div class="phf-notice-att-list">'
    +atts.map(function(a){
      var rm='';
      if(a.kind==='link'){
        return '<div class="phf-notice-att-item is-link"><span class="phf-notice-att-ico">'+ICON.link+'</span>'
          +'<a class="phf-notice-att-main" href="'+esc(a.linkUrl)+'" target="_blank" rel="noopener"><b>Liên kết ngoài</b><small>'+esc(a.linkUrl)+'</small></a>'+rm+'</div>';
      }
      var kb=a.byteSize?Math.max(1,Math.round(a.byteSize/1024))+' KB':'';
      if(attIsImage(a)){
        return '<div class="phf-notice-att-item is-img"><a href="#" class="phf-notice-att-thumbwrap" data-nt-att="'+esc(a.id)+'" data-nt-att-name="'+esc(a.fileName||'anh')+'" data-nt-thumb="1">'
          +'<span class="phf-notice-att-thumbph">'+ICON.file+'</span></a>'
          +'<a class="phf-notice-att-main" href="#" data-nt-att="'+esc(a.id)+'" data-nt-att-name="'+esc(a.fileName||'anh')+'"><b>'+esc(a.fileName||'Hình ảnh')+'</b><small>Ảnh'+(kb?' · '+kb:'')+'</small></a>'+rm+'</div>';
      }
      return '<div class="phf-notice-att-item is-doc"><span class="phf-notice-att-ico">'+ICON.file+'</span>'
        +'<a class="phf-notice-att-main" href="#" data-nt-att="'+esc(a.id)+'" data-nt-att-name="'+esc(a.fileName||'tep')+'"><b>'+esc(a.fileName||'Tệp đính kèm')+'</b><small>'+esc(attDocLabel(a))+(kb?' · '+kb:'')+'</small></a>'+rm+'</div>';
    }).join('')+'</div></div>':'';
  // Detail is READ-ONLY for attachments (§2). Managers add/remove tệp trong luồng
  // "Chỉnh sửa thông báo" — not here.
  var attManage=res.canManage?'<p class="phf-notice-att-editnote hint">Cần thêm / bớt tệp đính kèm? Mở <b>Chỉnh sửa thông báo</b> → bước "Tệp &amp; liên kết".</p>':'';
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
  var mgr=res.canManage?'<div class="phf-notice-detail-actions">'
    +'<button class="phf-notice-btn is-primary is-small" data-nt-edit>Chỉnh sửa</button>'
    +'<button class="phf-notice-btn is-small" data-nt-pin>'+(n.isPinned?'★ Bỏ ghim':'☆ Ghim')+'</button>'
    +'<span class="phf-notice-more"><button class="phf-notice-btn is-small is-ghost" data-nt-more>⋯ Thêm</button>'
      +'<div class="phf-notice-more-menu" data-nt-more-menu hidden>'
        +'<button data-nt-report>'+ICON.report+' Báo cáo tiếp nhận</button>'
        +'<button data-nt-audit>'+ICON.file+' Lịch sử thay đổi</button>'
        +'<div class="sep"></div>'
        +'<button class="is-danger" data-nt-del>Xóa thông báo</button>'
      +'</div></span></div>':'';

  var i=setWork(ctx,'<div class="phf-notice-detail">'
    +'<button class="phf-notice-btn is-ghost back" data-nt-back>← Quay lại feed</button>'
    +'<div class="phf-notice-card-top">'+(n.isPinned?'<span class="phf-notice-badge pin">📌 Ghim</span>':'')
      +prioBadge(n.priority)
      +typeBadge(n.noticeType,n.categoryName)+stBadge(st)
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
  // lazy image thumbnails — one authenticated download per image, swapped in
  i.querySelectorAll('[data-nt-thumb]').forEach(function(w){
    var aid=w.getAttribute('data-nt-att');
    call('noticeAttachmentDownload',{notice_id:n.id,attachment_id:aid}).then(function(r){
      if(!r||r.kind!=='file'||!r.base64)return;
      var img=new Image();img.className='phf-notice-att-thumb';img.alt='';
      img.src='data:'+((r.fileType&&/\//.test(r.fileType))?r.fileType:'image/*')+';base64,'+r.base64;
      w.innerHTML='';w.appendChild(img);
    }).catch(function(){});
  });
  var ack=i.querySelector('[data-nt-ack]');
  if(ack)ack.onchange=async function(){
    if(!ack.checked)return;ack.disabled=true;
    try{await call('noticeAcknowledge',{id:n.id});toast('success','Đã ghi nhận','Cảm ơn bạn đã xác nhận.');
      try{STATE.boot=await call('noticeBootstrap',{});}catch(e){STATE.boot=null;}
      repaintNav(ctx,{key:'detail'});
      renderDetail(ctx,id);}
    catch(err){ack.checked=false;ack.disabled=false;toast('error','Không xác nhận được',err.message);}
  };
  if(res.canManage){
    i.querySelector('[data-nt-edit]').onclick=function(){openWizard(p,n);};
    i.querySelector('[data-nt-pin]').onclick=async function(){try{await call('noticeSetPin',{id:n.id,pinned:!n.isPinned});renderDetail(ctx,id);}catch(err){toast('error','Lỗi',err.message);}};
    var moreBtn=i.querySelector('[data-nt-more]'),moreMenu=i.querySelector('[data-nt-more-menu]');
    if(moreBtn)moreBtn.onclick=function(e){e.stopPropagation();moreMenu.hidden=!moreMenu.hidden;};
    document.addEventListener('click',function hm(ev){if(!i.contains(ev.target)){if(moreMenu)moreMenu.hidden=true;document.removeEventListener('click',hm);}else if(moreMenu&&!ev.target.closest('.phf-notice-more'))moreMenu.hidden=true;});
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

/* ================= CONTROLLED RICH TEXT EDITOR (§3) ================= */
/* Lightweight WYSIWYG — NOT a Word clone. Toolbar = B / I / U / H2 / H3 /
 * bullet / numbered / align L·C·R / link / undo / redo / clear. No font family,
 * no free font-size, no colour. Paste is sanitised to the same allowlist. The
 * SERVER re-sanitises on save (sanitizeNoticeHtml) and derives content_text for
 * FTS — this editor is a convenience, the server is authoritative. */
var RTE_OK_TAGS={P:1,H2:1,H3:1,UL:1,OL:1,LI:1,STRONG:1,EM:1,U:1,S:1,A:1,BR:1,B:1,I:1};
var RTE_MAP={B:'STRONG',I:'EM',STRIKE:'S',DEL:'S',H1:'H2',H4:'H3',H5:'H3',H6:'H3',DIV:'P',PRE:'P'};
function rteClean(html){
  var doc;try{doc=new DOMParser().parseFromString('<div>'+String(html||'')+'</div>','text/html');}catch(e){return '';}
  var root=doc.body.firstChild;if(!root)return '';
  function walk(node){
    var out='';
    for(var c=node.firstChild;c;c=c.nextSibling){
      if(c.nodeType===3){out+=esc(c.nodeValue);continue;}
      if(c.nodeType!==1)continue;
      var tag=RTE_MAP[c.tagName]||c.tagName;
      if(tag==='SCRIPT'||tag==='STYLE'){continue;}
      if(!RTE_OK_TAGS[tag]&&!RTE_OK_TAGS[c.tagName]){out+=walk(c);continue;}
      if(tag==='BR'){out+='<br>';continue;}
      var attr='';
      if(tag==='A'){
        var href=(c.getAttribute('href')||'').trim();
        if(!/^(https?:\/\/|mailto:)/i.test(href)){out+=walk(c);continue;}
        attr=' href="'+esc(href)+'" target="_blank" rel="noopener nofollow"';
      }else if(tag==='P'||tag==='H2'||tag==='H3'||tag==='LI'){
        var al=(c.style&&c.style.textAlign)||'';
        if(/^(right|center|justify)$/.test(al))attr=' style="text-align:'+al+'"';
      }
      var inner=walk(c);
      var low=tag.toLowerCase();
      out+='<'+low+attr+'>'+inner+'</'+low+'>';
    }
    return out;
  }
  return walk(root).replace(/<(p|h2|h3|li)>(\s|&nbsp;|<br>)*<\/\1>/gi,'').trim();
}
function noticeRichEditor(initialHtml,initialText){
  var wrap=document.createElement('div');wrap.className='phf-notice-rte';
  var start=initialHtml&&/<\w/.test(initialHtml)?rteClean(initialHtml):htmlFromTextFE(initialText||'');
  wrap.innerHTML=''
    +'<div class="phf-notice-rte-bar" role="toolbar">'
    +'<button type="button" data-cmd="bold" title="Đậm"><b>B</b></button>'
    +'<button type="button" data-cmd="italic" title="Nghiêng"><i>I</i></button>'
    +'<button type="button" data-cmd="underline" title="Gạch chân"><u>U</u></button>'
    +'<span class="sep"></span>'
    +'<button type="button" data-block="h2" title="Tiêu đề mục">H2</button>'
    +'<button type="button" data-block="h3" title="Tiêu đề phụ">H3</button>'
    +'<button type="button" data-block="p" title="Đoạn văn">¶</button>'
    +'<span class="sep"></span>'
    +'<button type="button" data-cmd="insertUnorderedList" title="Gạch đầu dòng">•</button>'
    +'<button type="button" data-cmd="insertOrderedList" title="Đánh số">1.</button>'
    +'<span class="sep"></span>'
    +'<button type="button" data-cmd="justifyLeft" title="Căn trái">⯇</button>'
    +'<button type="button" data-cmd="justifyCenter" title="Căn giữa">≡</button>'
    +'<button type="button" data-cmd="justifyRight" title="Căn phải">⯈</button>'
    +'<span class="sep"></span>'
    +'<button type="button" data-link title="Chèn liên kết">🔗</button>'
    +'<button type="button" data-cmd="undo" title="Hoàn tác">↶</button>'
    +'<button type="button" data-cmd="redo" title="Làm lại">↷</button>'
    +'<button type="button" data-clear title="Xóa định dạng">✕ định dạng</button>'
    +'</div>'
    +'<div class="phf-notice-rte-area" contenteditable="true" data-rte-area>'+(start||'<p><br></p>')+'</div>';
  var area=wrap.querySelector('[data-rte-area]');
  function exec(cmd,val){area.focus();try{document.execCommand(cmd,false,val||null);}catch(e){}}
  wrap.querySelector('.phf-notice-rte-bar').addEventListener('click',function(e){
    var b=e.target.closest('button');if(!b)return;e.preventDefault();
    if(b.hasAttribute('data-cmd'))return exec(b.getAttribute('data-cmd'));
    if(b.hasAttribute('data-block'))return exec('formatBlock','<'+b.getAttribute('data-block')+'>');
    if(b.hasAttribute('data-link')){
      var u=prompt('Địa chỉ liên kết (http:// hoặc https://):','https://');
      if(u&&/^(https?:\/\/|mailto:)/i.test(u.trim()))exec('createLink',u.trim());
      else if(u)toast('error','Liên kết không hợp lệ','');
      return;
    }
    if(b.hasAttribute('data-clear'))return exec('removeFormat');
  });
  area.addEventListener('paste',function(e){
    e.preventDefault();
    var dt=e.clipboardData||window.clipboardData;if(!dt)return;
    var html=dt.getData('text/html'),txt=dt.getData('text/plain');
    if((html&&/<img[ >]/i.test(html))||(dt.files&&dt.files.length&&/^image[/]/.test(dt.files[0].type))){
      toast('info','Ảnh dán trực tiếp chưa hỗ trợ','Hãy dùng bước "Tệp & liên kết" để đính kèm ảnh.');
    }
    var clean=html?rteClean(html):('<p>'+esc(txt||'').replace(/\n{2,}/g,'</p><p>').replace(/\n/g,'<br>')+'</p>');
    try{document.execCommand('insertHTML',false,clean);}catch(e2){area.innerHTML+=clean;}
  });
  return {
    el:wrap,
    getHtml:function(){return rteClean(area.innerHTML);},
    getText:function(){return (area.innerText||area.textContent||'').replace(/ /g,' ').trim();}
  };
}

/* ================= CREATE / EDIT WIZARD ================= */
function fileToB64(f){return new Promise(function(rs,rj){var fr=new FileReader();fr.onload=function(){rs(String(fr.result).split(',')[1]);};fr.onerror=rj;fr.readAsDataURL(f);});}
function openWizard(p,existing){
  var edit=!!existing,d=existing||{};
  var cats=(STATE.categories||[]).filter(function(c){return c.isActive!==false||c.slug===d.noticeType;});
  var model={
    title:d.title||'',contentHtml:d.contentHtml||'',contentText:d.contentText||'',
    noticeType:d.noticeType||(cats[0]&&cats[0].slug)||'guide',
    priority:d.priority||'normal',
    pinned:!!d.isPinned,
    scopeMode:(d.scopes&&d.scopes.some(function(s){return s.scopeType!=='company';}))?'custom':'company',
    scopeText:(d.scopes||[]).filter(function(s){return s.scopeType!=='company';}).map(function(s){return s.scopeValue;}).join(', '),
    scopeSel:(d.scopes||[]).filter(function(s){return s.scopeType!=='company';}).map(function(s){return s.scopeValue;}),
    effectiveFrom:d.effectiveFrom||todayInput(),effectiveTo:d.effectiveTo||'',
    requireAcknowledgement:!!d.requireAcknowledgement,keywords:(d.keywords||[]).join(', '),
    requireReack:false,
    pendingAtts:[],                              // create: staged until publish
    existingAtts:(d.attachments||[]).slice()     // edit: live list on d.id
  };
  var rte=null; // the rich editor instance — created once, kept alive across steps
  if(!STATE.orgScopes){ call('noticeOrgScopes',{}).then(function(r){STATE.orgScopes=r;if(step===1)draw();}).catch(function(){STATE.orgScopes={departments:[],branches:[],failed:true};}); }
  // §7 field order: Nội dung → Tệp & liên kết → Từ khóa bổ sung (keywords live on step 2)
  var STEPS=['Nội dung','Tệp & liên kết','Thiết lập','Xem trước'];
  var SETTINGS_STEP=3, ATT_STEP=2;
  var step=1;
  var ov=document.createElement('div');ov.className='phf-notice-ov';document.body.appendChild(ov);
  function close(){ov.remove();}
  var isLast=function(){return step===STEPS.length;};
  function draw(){
    // Visible numbered stepper (§B) — user sees which step they're on, what's left,
    // and that "Tệp & liên kết" is step 2. Completed steps click back.
    var stepsHtml=STEPS.map(function(l,i){
      var n=i+1,cls=step===n?'is-current':(step>n?'is-done':'');
      return '<button type="button" class="phf-notice-step '+cls+'" data-step="'+n+'"'+(step>=n?'':' disabled')+'>'
        +'<i>'+(step>n?'✓':n)+'</i><span>'+esc(l)+'</span></button>';
    }).join('<em class="phf-notice-step-sep">›</em>');
    ov.innerHTML='<div class="phf-notice-ov-panel"><div class="phf-notice-ov-head"><h2>'+(edit?'Chỉnh sửa thông báo':'Đăng thông báo mới')+'</h2><span class="phf-notice-ov-stepno">Bước '+step+'/'+STEPS.length+'</span><button class="x" data-x>×</button></div>'
      +'<div class="phf-notice-steps">'+stepsHtml+'</div>'
      +'<div class="phf-notice-ov-body"><div data-body></div></div>'
      +'<div class="phf-notice-ov-foot" data-foot></div></div>';
    ov.querySelector('[data-x]').onclick=close;
    ov.querySelectorAll('[data-step]').forEach(function(b){b.onclick=function(){var n=Number(b.getAttribute('data-step'));if(n<step){harvest(ov.querySelector('[data-body]'));step=n;draw();}};});
    var body=ov.querySelector('[data-body]'),foot=ov.querySelector('[data-foot]');
    if(step===1){
      body.innerHTML=''
        +'<div class="phf-notice-field"><label>Tiêu đề *</label><input type="text" data-f-title value="'+esc(model.title)+'" placeholder="VD: Cập nhật cách bấm bill khi khách sử dụng Voucher"></div>'
        +'<div class="phf-notice-inline">'
          +'<div class="phf-notice-field"><label>Danh mục *</label><select data-f-type>'+cats.map(function(c){return '<option value="'+esc(c.slug)+'"'+(model.noticeType===c.slug?' selected':'')+'>'+esc(c.name)+(c.isActive===false?' (ngừng)':'')+'</option>';}).join('')+'</select></div>'
          +'<div class="phf-notice-field"><label>Mức ưu tiên</label><select data-f-prio>'+NT_PRIO.map(function(x){return '<option value="'+x[0]+'"'+(model.priority===x[0]?' selected':'')+'>'+esc(x[1])+'</option>';}).join('')+'</select></div>'
        +'</div>'
        +'<div class="phf-notice-field"><label class="phf-notice-check"><input type="checkbox" data-f-pin '+(model.pinned?'checked':'')+'> 📌 Ghim thông báo lên đầu bảng tin</label><div class="hint">Thông báo được ghim sẽ ưu tiên hiển thị ở đầu danh sách. Độc lập với mức ưu tiên — Ghim KHÔNG tự thành "Hỏa tốc".</div></div>'
        +'<div class="phf-notice-field"><label>Áp dụng</label><select data-f-scopemode><option value="company"'+(model.scopeMode==='company'?' selected':'')+'>Toàn công ty</option><option value="custom"'+(model.scopeMode==='custom'?' selected':'')+'>Chọn phòng ban / chi nhánh</option></select></div>'
        +'<div class="phf-notice-field" data-scope-wrap style="'+(model.scopeMode==='custom'?'':'display:none')+'">'+scopePickerHtml()+'<div class="hint">"Áp dụng" chỉ là nhãn + mẫu số báo cáo — KHÔNG giới hạn quyền xem. Mọi tài khoản vẫn đọc và xác nhận được.</div></div>'
        +'<div class="phf-notice-field"><label>Nội dung chính (hiển thị trên web) *</label><div data-rte-mount></div><div class="hint">Nội quy / chính sách dài: đưa TOÀN VĂN lên đây. Dùng H2 / H3 cho tiêu đề mục — hệ thống tự tạo Mục lục. Định dạng do PHF kiểm soát; máy chủ vẫn làm sạch nội dung khi lưu.</div></div>';
      if(!rte)rte=noticeRichEditor(model.contentHtml,model.contentText);
      body.querySelector('[data-rte-mount]').appendChild(rte.el);
      var sm=body.querySelector('[data-f-scopemode]');
      sm.onchange=function(){model.scopeMode=sm.value;body.querySelector('[data-scope-wrap]').style.display=sm.value==='custom'?'':'none';};
      body.querySelectorAll('[data-scope-opt]').forEach(function(cb){cb.onchange=function(){var v=cb.getAttribute('data-scope-opt');var i=model.scopeSel.indexOf(v);if(cb.checked&&i<0)model.scopeSel.push(v);else if(!cb.checked&&i>=0)model.scopeSel.splice(i,1);};});
      var ft=body.querySelector('[data-f-scopetext]');if(ft)ft.oninput=function(){model.scopeText=ft.value;};
      body.querySelector('[data-f-pin]').onchange=function(){model.pinned=this.checked;};
    }else if(step===ATT_STEP){
      body.innerHTML='<p class="hint" style="margin-top:0">Ảnh / PDF / Word / Excel ≤ 4 MB, hoặc liên kết. Nội dung chính trên web vẫn bắt buộc — đính kèm chỉ là tài liệu tham chiếu.'
        +(edit?' Thêm / xóa ở đây được áp dụng ngay và ghi vết.':' Bài + tệp được công bố cùng lúc.')+'</p>'
        +'<div class="phf-notice-att-add"><label class="phf-notice-btn is-small">'+ICON.file+' + Thêm tệp<input type="file" data-f-file hidden accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx"></label>'
        +'<input type="text" data-f-linkinput placeholder="https://..."><button type="button" class="phf-notice-btn is-small" data-f-addlink>+ Thêm liên kết</button></div>'
        +'<div class="phf-notice-att-pending" data-pending></div>'
        +'<div class="phf-notice-field" style="margin-top:18px"><label>Từ khóa bổ sung (tùy chọn)</label><input type="text" data-f-kw value="'+esc(model.keywords)+'" placeholder="voucher sinh nhật, F6, mã giảm giá"><div class="hint">Bổ sung cách gọi khác mà nội dung chưa nhắc đến. Tìm kiếm vẫn tự chạy trên tiêu đề + toàn văn dù để trống.</div></div>';
      drawAtts(body.querySelector('[data-pending]'));
      var fi=body.querySelector('[data-f-file]');
      fi.onchange=async function(){
        var f=fi.files&&fi.files[0];if(!f)return;fi.value='';
        if(f.size>4*1024*1024){toast('error','Tệp quá lớn','Tối đa 4 MB.');return;}
        try{var b64=await fileToB64(f);
          if(edit){
            try{var r=await call('noticeAttachmentAdd',{notice_id:d.id,kind:'file',file_name:f.name,mime_type:f.type,base64:b64});
              model.existingAtts.push({id:r.attachmentId,kind:'file',fileName:f.name,fileType:f.type,byteSize:f.size});toast('success','Đã thêm tệp','');}
            catch(er){toast('error','Không thêm được tệp',er.message);}
          }else{
            var thumb=/^image\//.test(f.type)?('data:'+f.type+';base64,'+b64):'';
            model.pendingAtts.push({kind:'file',name:f.name,size:f.size,mime:f.type,b64:b64,thumb:thumb});
          }
          drawAtts(ov.querySelector('[data-pending]'));
        }catch(e){toast('error','Không đọc được tệp','');}
      };
      body.querySelector('[data-f-addlink]').onclick=async function(){
        var el=body.querySelector('[data-f-linkinput]'),v=(el&&el.value||'').trim();
        if(!/^https?:\/\//i.test(v)){toast('error','Liên kết không hợp lệ','Bắt đầu bằng http:// hoặc https://');return;}
        if(edit){
          try{var r=await call('noticeAttachmentAdd',{notice_id:d.id,kind:'link',link_url:v});
            model.existingAtts.push({id:r.attachmentId,kind:'link',linkUrl:v});el.value='';toast('success','Đã thêm liên kết','');}
          catch(er){toast('error','Không thêm được',er.message);}
        }else{model.pendingAtts.push({kind:'link',linkUrl:v});el.value='';}
        drawAtts(ov.querySelector('[data-pending]'));
      };
    }else if(step===SETTINGS_STEP){
      body.innerHTML='<div class="phf-notice-inline">'
        +'<div class="phf-notice-field"><label>Hiệu lực từ *</label><input type="date" data-f-from value="'+esc(model.effectiveFrom)+'"></div>'
        +'<div class="phf-notice-field"><label>Hết hiệu lực (tùy chọn)</label><input type="date" data-f-to value="'+esc(model.effectiveTo)+'"><div class="hint">Bỏ trống = không thời hạn. Trạng thái Sắp/Đang/Hết hiệu lực do hệ thống tự suy.</div></div>'
        +'</div>'
        +'<div class="phf-notice-field"><label class="phf-notice-check"><input type="checkbox" data-f-ack '+(model.requireAcknowledgement?'checked':'')+'> Yêu cầu người đọc xác nhận "Tôi đã đọc và nắm thông tin"</label><div class="hint">Độc lập với mức ưu tiên — "Hỏa tốc" KHÔNG tự bắt xác nhận.</div></div>'
        +(edit&&d.status==='published'?'<div class="phf-notice-field"><label class="phf-notice-check"><input type="checkbox" data-f-reack '+(model.requireReack?'checked':'')+'> Nội dung thay đổi quan trọng — yêu cầu mọi người xác nhận lại</label><div class="hint">Bỏ trống = xác nhận cũ vẫn được tính là hoàn thành. Bật = tạo phiên bản mới, xác nhận cũ lưu lịch sử, người dùng chuyển sang "Cần xác nhận lại".</div></div>':'')
        +'<div data-dup></div>';
    }else{
      var ss=model.scopeMode==='company'?'Toàn công ty':((model.scopeSel&&model.scopeSel.length?model.scopeSel.join(', '):model.scopeText)||'(chưa chọn)');
      var allAtts=model.existingAtts.concat(model.pendingAtts.map(function(a){return a.kind==='link'?{kind:'link',linkUrl:a.linkUrl}:{kind:'file',fileName:a.name,byteSize:a.size,fileType:a.mime};}));
      var attSummary=allAtts.map(function(a){return a.kind==='link'?('🔗 '+a.linkUrl):('📎 '+(a.fileName||'tệp')+(a.byteSize?' ('+Math.max(1,Math.round(a.byteSize/1024))+' KB)':''));});
      body.innerHTML='<div class="phf-notice-summary"><dl>'
        +'<dt>Tiêu đề</dt><dd>'+esc(model.title||'(trống)')+'</dd>'
        +'<dt>Danh mục</dt><dd>'+esc(catName(model.noticeType))+'</dd>'
        +'<dt>Mức ưu tiên</dt><dd>'+esc(prioLabel(model.priority))+'</dd>'
        +'<dt>Ghim</dt><dd>'+(model.pinned?'📌 Có — lên đầu bảng tin':'Không')+'</dd>'
        +'<dt>Áp dụng</dt><dd>'+esc(ss)+'</dd>'
        +'<dt>Hiệu lực</dt><dd>'+fmtDate(model.effectiveFrom)+(model.effectiveTo?' → '+fmtDate(model.effectiveTo):' → không thời hạn')+'</dd>'
        +'<dt>Yêu cầu xác nhận</dt><dd>'+(model.requireAcknowledgement?'Có':'Không')+'</dd>'
        +(attSummary.length?'<dt>Đính kèm</dt><dd>'+attSummary.map(esc).join('<br>')+'</dd>':'')
        +'</dl></div>'
        +'<div class="phf-notice-preview-body"><b class="phf-notice-preview-lbl">Xem trước — gần đúng bản nhân viên sẽ đọc</b>'
          +'<div class="phf-notice-card-top" style="margin-bottom:10px">'+(model.pinned?'<span class="phf-notice-badge pin">📌 Ghim</span>':'')+prioBadge(model.priority)+typeBadge(model.noticeType)+'</div>'
          +'<h1 style="font-size:20px;margin:0 0 10px">'+esc(model.title||'(chưa có tiêu đề)')+'</h1>'
          +'<div class="phf-notice-body">'+(model.contentHtml||'<p class="hint">(chưa có nội dung)</p>')+'</div></div>'
        +'<p class="hint" style="margin-top:12px">Không có hẹn giờ công bố. "Công bố" = hiện lên feed ngay. Xem trước KHÔNG tạo bài đã công bố.</p><div data-err></div>';
    }
    foot.innerHTML=(step>1?'<button class="phf-notice-btn is-ghost" data-back>Quay lại</button>':'')
      +(!isLast()?'<button class="phf-notice-btn is-primary" data-next>Tiếp tục</button>'
        :'<button class="phf-notice-btn" data-save>Lưu nháp</button><button class="phf-notice-btn is-primary" data-publish>'+(edit&&d.status==='published'?'Lưu chỉnh sửa':'Công bố')+'</button>');
    if(step>1)foot.querySelector('[data-back]').onclick=function(){harvest(body);step--;draw();};
    if(!isLast())foot.querySelector('[data-next]').onclick=function(){
      harvest(body);
      if(step===1&&(!model.title.trim()||!model.contentText.trim())){toast('error','Thiếu thông tin','Tiêu đề và nội dung là bắt buộc.');return;}
      step++;draw();
      if(step===SETTINGS_STEP)runDupCheck();
    };
    if(isLast()){foot.querySelector('[data-save]').onclick=function(){harvest(body);submit(false);};foot.querySelector('[data-publish]').onclick=function(){harvest(body);submit(true);};}
  }
  function drawAtts(host){
    if(!host)return;
    var rows=[];
    model.existingAtts.forEach(function(a){
      rows.push({label:a.kind==='link'?('🔗 '+esc(a.linkUrl)):('📎 '+esc(a.fileName||'tệp')+(a.byteSize?' <em>('+Math.max(1,Math.round(a.byteSize/1024))+' KB)</em>':'')),existing:true,id:a.id});
    });
    model.pendingAtts.forEach(function(a,i){
      rows.push({label:a.kind==='link'?(ICON.link+' <span>'+esc(a.linkUrl)+'</span>'):((a.thumb?'<img src="'+a.thumb+'" alt="" class="phf-notice-att-thumb">':ICON.file)+' <span>'+esc(a.name)+' <em>('+Math.max(1,Math.round(a.size/1024))+' KB)</em></span>'),existing:false,idx:i});
    });
    if(!rows.length){host.innerHTML='<p class="hint">Chưa có tệp / liên kết nào.</p>';return;}
    host.innerHTML=rows.map(function(r){
      var btn=r.existing?'<button type="button" class="phf-notice-att-rm" data-rmx="'+esc(r.id)+'">×</button>':'<button type="button" class="phf-notice-att-rm" data-rm="'+r.idx+'">×</button>';
      return '<div class="phf-notice-att-pend-row">'+r.label+btn+'</div>';
    }).join('');
    host.querySelectorAll('[data-rm]').forEach(function(b){b.onclick=function(){model.pendingAtts.splice(Number(b.getAttribute('data-rm')),1);drawAtts(host);};});
    host.querySelectorAll('[data-rmx]').forEach(function(b){b.onclick=async function(){
      if(!confirm('Xóa tệp / liên kết này? Thao tác được ghi vết.'))return;
      var aid=b.getAttribute('data-rmx');
      try{await call('noticeAttachmentRemove',{notice_id:d.id,attachment_id:aid});
        model.existingAtts=model.existingAtts.filter(function(x){return x.id!==aid;});toast('success','Đã xóa','');drawAtts(host);}
      catch(er){toast('error','Không xóa được',er.message);}
    };});
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
    if(rte&&step===1){model.contentHtml=rte.getHtml();model.contentText=rte.getText();}
    if(g('[data-f-type]'))model.noticeType=g('[data-f-type]').value;
    if(g('[data-f-prio]'))model.priority=g('[data-f-prio]').value;
    if(g('[data-f-pin]'))model.pinned=g('[data-f-pin]').checked;
    if(g('[data-f-scopemode]'))model.scopeMode=g('[data-f-scopemode]').value;
    if(g('[data-f-scopetext]'))model.scopeText=g('[data-f-scopetext]').value;
    var opts=body.querySelectorAll('[data-scope-opt]');if(opts.length){model.scopeSel=[];opts.forEach(function(cb){if(cb.checked)model.scopeSel.push(cb.getAttribute('data-scope-opt'));});}
    if(g('[data-f-from]'))model.effectiveFrom=g('[data-f-from]').value;
    if(g('[data-f-to]'))model.effectiveTo=g('[data-f-to]').value;
    if(g('[data-f-ack]'))model.requireAcknowledgement=g('[data-f-ack]').checked;
    if(g('[data-f-kw]'))model.keywords=g('[data-f-kw]').value;
    if(g('[data-f-reack]'))model.requireReack=g('[data-f-reack]').checked;
  }
  function scopePickerHtml(){
    var o=STATE.orgScopes;
    if(!o){return '<div class="hint">Đang tải danh sách phòng ban / chi nhánh…</div>';}
    if(o.failed||((!o.departments||!o.departments.length)&&(!o.branches||!o.branches.length))){
      return '<input type="text" data-f-scopetext value="'+esc(model.scopeText)+'" placeholder="VD: Bán hàng, Kho — phân tách bằng dấu phẩy"><div class="hint">Không tải được danh sách tổ chức — nhập tay, phân tách bằng dấu phẩy.</div>';
    }
    function grp(title,list){ if(!list||!list.length)return ''; return '<div class="phf-notice-scope-grp"><b>'+esc(title)+'</b><div class="phf-notice-scope-opts">'+list.map(function(v){var on=model.scopeSel.indexOf(v)>=0;return '<label class="phf-notice-scope-opt"><input type="checkbox" data-scope-opt="'+esc(v)+'" '+(on?'checked':'')+'> '+esc(v)+'</label>';}).join('')+'</div></div>'; }
    return '<div class="phf-notice-scope-picker">'+grp('Phòng ban',o.departments)+grp('Chi nhánh',o.branches)+'</div>';
  }
  function scopesPayload(){
    if(model.scopeMode==='company')return [{scope_type:'company'}];
    var parts=(model.scopeSel&&model.scopeSel.length)?model.scopeSel.slice():model.scopeText.split(',').map(function(x){return x.trim();}).filter(Boolean);
    return parts.length?parts.map(function(v){return {scope_type:'department',scope_value:v};}):[{scope_type:'company'}];
  }
  async function submit(publish){
    var kws=model.keywords.split(',').map(function(x){return x.trim();}).filter(Boolean);
    var base={title:model.title,content_html:model.contentHtml,content_text:model.contentText,notice_type:model.noticeType,priority:model.priority,
      pinned:!!model.pinned,effective_from:model.effectiveFrom,effective_to:model.effectiveTo||'',
      require_acknowledgement:model.requireAcknowledgement,scopes:scopesPayload(),keywords:kws};
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
      invalidateBoot();
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
  var inner=setWork(ctx,'<div class="phf-notice-head"><div><h1>Quản lý danh mục</h1>'
    +'<p>Phân loại nội dung của thông báo — KHÔNG giới hạn quyền xem. Danh mục đã có bài không thể xóa, chỉ có thể ngừng sử dụng. Danh mục đang bật sẽ tự hiển thị trong menu tra cứu của người đọc. Tìm kiếm vẫn tự động chạy bất kể danh mục.</p></div>'
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
    repaintNav(ctx,{key:'danh-muc'}); // live category projection into the reader sidebar
  }
  inner.querySelector('[data-nt-cat-add]').onclick=function(){
    var ov=document.createElement('div');ov.className='phf-notice-ov';document.body.appendChild(ov);
    ov.innerHTML='<div class="phf-notice-ov-panel phf-notice-cat-modal" style="max-width:440px">'
      +'<div class="phf-notice-ov-head"><h2>Thêm danh mục</h2><button class="x" data-x>×</button></div>'
      +'<div class="phf-notice-ov-body"><div class="phf-notice-field"><label>Tên danh mục *</label>'
        +'<input type="text" data-cn placeholder="VD: Thông báo nội bộ khẩn" maxlength="60">'
        +'<div class="hint">Slug được tạo tự động. Danh mục mới sẽ hiển thị trong menu tra cứu của người đọc ngay khi bật.</div></div><div data-e></div></div>'
      +'<div class="phf-notice-ov-foot"><button class="phf-notice-btn is-ghost" data-x>Hủy</button>'
        +'<button class="phf-notice-btn is-primary" data-ok style="margin-left:auto">Thêm danh mục</button></div></div>';
    function close(){ov.remove();}
    ov.querySelectorAll('[data-x]').forEach(function(b){b.onclick=close;});
    var inp=ov.querySelector('[data-cn]');setTimeout(function(){inp.focus();},30);
    async function submit(){
      var v=(inp.value||'').trim();
      if(!v){ov.querySelector('[data-e]').innerHTML='<div class="phf-notice-err">Nhập tên danh mục.</div>';return;}
      try{await call('noticeCategoriesUpsert',{name:v});close();toast('success','Đã thêm danh mục','');reload();}
      catch(e){ov.querySelector('[data-e]').innerHTML='<div class="phf-notice-err">'+esc(noticeErrMsg({code:e.code,message:e.message}))+'</div>';}
    }
    ov.querySelector('[data-ok]').onclick=submit;
    inp.addEventListener('keydown',function(e){if(e.key==='Enter')submit();});
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
  if(!(ctx.boot.capabilities.canManagePermissions||(ctx.boot.viewer&&ctx.boot.viewer.isAdmin))){
    setWork(ctx,'<div class="phf-notice-warn">Chỉ Admin hệ thống được mở Cài đặt quyền.</div>');return;
  }
  var inner=setWork(ctx,'<div class="phf-notice-head"><div><h1>Cài đặt quyền</h1>'
    +'<p>Nút gạt <b>Quản trị nội dung</b> chỉ dùng để cấp quyền cho tài khoản <b>KHÔNG phải Admin hệ thống</b> (tạo/sửa/xóa/ghim/xem báo cáo). Mặc định mọi tài khoản là <b>Chỉ xem</b>. Chỉ Admin đổi được quyền này. Mọi thay đổi đều được ghi vết.</p></div></div>'
    +'<div class="phf-notice-warn info" style="margin:0 0 14px">Admin hệ thống <b>luôn có toàn quyền Thông báo Quản Trị theo mặc định</b> — không phụ thuộc nút gạt của module này và không thể bị gỡ bằng nút gạt. Các dòng đó hiển thị "Toàn quyền (Admin hệ thống)".</div>'
    +'<div class="phf-notice-perm-search"><input type="text" data-nt-psearch placeholder="Tìm theo tên / mã NV / phòng ban"></div>'
    +'<div class="phf-notice-tablewrap" data-nt-ptable><div class="phf-notice-loading">Đang tải danh sách…</div></div>');
  var data;
  try{data=await call('noticePermissionRoster',{});}
  catch(err){inner.querySelector('[data-nt-ptable]').innerHTML='<div class="phf-notice-warn">'+esc(noticeErrMsg({code:err.code,message:err.message}))+'</div>';return;}
  var isAdmin=ctx.boot.viewer.isAdmin,q='';
  function paint(){
    var rows=data.roster.filter(function(x){if(!q)return true;return (x.fullName+' '+x.employeeCode+' '+x.department+' '+x.branch).toLowerCase().indexOf(q)>=0;});
    inner.querySelector('[data-nt-ptable]').innerHTML='<table class="phf-notice-table"><thead><tr><th>Họ tên</th><th>Mã NV</th><th>Chức danh</th><th>Phòng ban</th><th>Trạng thái</th><th>Quản trị nội dung</th></tr></thead><tbody>'
      +rows.map(function(x){
        var permCell=x.isSystemAdmin
          ? '<span class="phf-notice-perm-locked">'+ICON.shield+' Toàn quyền (Admin hệ thống)</span>'
          : '<span class="phf-notice-toggle"><input type="checkbox" data-nt-tog="'+esc(x.employeeCode)+'" '+(x.grant?'checked':'')+' '+(isAdmin?'':'disabled')+'><span></span></span>';
        return '<tr'+(x.isSystemAdmin?' class="is-sysadmin"':'')+'><td>'+esc(x.fullName)+'</td><td>'+esc(x.employeeCode)+'</td><td>'+esc(x.title)+'</td><td>'+esc([x.department,x.branch].filter(Boolean).join(' / '))+'</td>'
        +'<td'+(x.status==='active'?'':' class="muted"')+'>'+(x.status==='active'?'Đang làm':'Đã nghỉ')+'</td>'
        +'<td>'+permCell+'</td></tr>';}).join('')
      +'</tbody></table>'+(isAdmin?'':'<p class="hint" style="padding:8px 10px">Bạn quản trị nội dung nhưng không phải Admin — chỉ Admin đổi được quyền.</p>');
    inner.querySelectorAll('[data-nt-tog]').forEach(function(inp){
      inp.onchange=async function(){
        var code=inp.getAttribute('data-nt-tog');inp.disabled=true;
        try{await call('noticeSetPermission',{employee_code:code,can_manage:inp.checked});
          var row=data.roster.find(function(r){return r.employeeCode===code;});if(row){row.grant=inp.checked;row.canManage=inp.checked||row.isSystemAdmin;}
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

window.__phfNoticeTestHooks={screenForPath:screenForPath,typeLabel:typeLabel,noticeErrMsg:noticeErrMsg,cardHtml:cardHtml,navItems:navItems,navGroups:navGroups,prioLabel:prioLabel,htmlFromTextFE:htmlFromTextFE,attIsImage:attIsImage,attDocLabel:attDocLabel};
})();
