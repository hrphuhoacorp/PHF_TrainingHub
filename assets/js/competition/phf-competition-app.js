(function(){
'use strict';
/* PHF HR — Chương trình thi đua · BATCH C3 (UI DEV WIRING).
 *
 * Wires the A/A1/A2 UI skeleton to real Batch C1/C2 DEV actions against
 * phf_hr_e2e, through the SAME /api/data POST channel every other PHF HR
 * module uses (credentials:'same-origin', session cookie — see
 * assets/js/task/phf-task-app.js::taskApi for the identical pattern this
 * file mirrors).
 *
 * IDENTITY (LOCKED, 2026-09-04): the browser sends NOTHING but the action +
 * business fields. The runtime actor (account_id, employee_code, tên,
 * chức danh/chức vụ, phòng ban) is resolved SERVER-SIDE from the real PHF HR
 * session against the People Master (api/_lib/competition-identity.js) — this
 * file never sends/receives/stores an "actor" object, never touches
 * localStorage for Competition data, and never fabricates a runtime number.
 * synthetic SYN* identities exist ONLY as backend DEV fixtures (Batch
 * B/C1) — nothing here knows about them.
 *
 * All authorization (admin / reviewer level / capability) is decided
 * server-side from Competition's own grant tables (Batch C1
 * competition-permissions.js) — this file only reacts to what the server
 * allowed (bootstrap capabilities, or a 403 on an actual request) and never
 * infers permission from job title/position/department.
 */

var API_URL = '/api/data';

function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function role(){try{return window.phfGetSessionRole?window.phfGetSessionRole():'learner';}catch(e){return 'learner';}}
function prefix(){var r=role();return r==='admin'?'/admin':(r==='manager'?'/ql':'/hv');}
function go(path){if(window.phfNavigate)return window.phfNavigate(path);location.href=path;}
function toast(kind,title,msg){
  if(typeof window.phfToast==='function'){window.phfToast(kind||'info',title||'',msg||'',3600,'phf-comp-toast');return;}
  try{window.alert((title?title+': ':'')+(msg||''));}catch(e){}
}
function fmtDate(v){
  if(!v)return '—';
  try{var d=new Date(v);if(isNaN(d.getTime()))return '—';return d.toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}catch(e){return '—';}
}

/* ---- transport (mirrors assets/js/task/phf-task-app.js::taskApi) ------- */
async function competitionApi(payload){
  var res;
  try{
    res=await fetch(API_URL,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload)});
  }catch(e){
    var ne=new Error('Không kết nối được máy chủ PHF HR.');ne.code='COMPETITION_NETWORK_ERROR';throw ne;
  }
  var json={};try{json=await res.json();}catch(e){}
  if(!res.ok||json.ok===false){
    var err=new Error(competitionErrorMessage(json));
    err.code=json.code||'';err.status=res.status;throw err;
  }
  return Object.prototype.hasOwnProperty.call(json,'result')?json.result:json;
}
function competitionErrorMessage(json){
  var code=String(json&&json.code||'');
  var raw=json&&(json.error||json.message);
  if(code==='COMPETITION_BRIDGE_DISABLED')return 'Competition chưa được bật kết nối dữ liệu trên môi trường này (PHF_COMPETITION_BRIDGE_ENABLED).';
  if(code==='COMPETITION_BRIDGE_UNREACHABLE'||code==='COMPETITION_BRIDGE_TIMEOUT')return 'Không kết nối được phf-hr-api. Vui lòng thử lại.';
  if(code==='COMPETITION_IDENTITY_INACTIVE')return 'Tài khoản/nhân sự không còn hoạt động — không thể tham gia Chương trình thi đua.';
  if(code==='COMPETITION_EMPLOYEE_NOT_FOUND')return 'Tài khoản chưa liên kết hồ sơ nhân sự thật.';
  if(code==='COMPETITION_ADMIN_REQUIRED')return 'Chức năng này chỉ dành cho Competition Admin.';
  if(code==='COMPETITION_NOT_A_REVIEWER')return 'Bạn chưa được cấp quyền xét duyệt cho chương trình này.';
  if(code==='COMPETITION_REVIEW_LEVEL_TOO_HIGH')return 'Bạn chỉ được duyệt tới mức được cấp quyền.';
  if(code==='COMPETITION_SELF_REVIEW_BLOCKED')return 'Không thể tự duyệt/can thiệp bài của chính mình.';
  if(code==='COMPETITION_SUBMISSION_VERSION_CONFLICT')return 'Bài đã thay đổi ở nơi khác — vui lòng tải lại.';
  if(code==='COMPETITION_CAMPAIGN_NOT_ACCEPTING')return 'Chương trình hiện không nhận bài.';
  if(code==='COMPETITION_PROGRESS_FORBIDDEN')return 'Bạn chưa được cấp quyền xem tiến độ tham gia toàn công ty.';
  return String(raw||'Không thể xử lý yêu cầu.');
}
function call(action,fields){
  // `action` is forced LAST — defence in depth so a business field
  // accidentally also named "action" in `fields` (see competitionReviewSubmission
  // -> review_action, fixed Batch C3.1) can never silently swap which
  // server action gets dispatched.
  var payload=Object.assign({},fields||{},{action:action});
  return competitionApi(payload);
}

function icon(type){
  var p={
    trophy:'<path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"/><path d="M8 5H5v2a3 3 0 0 0 3 3M16 5h3v2a3 3 0 0 1-3 3"/><path d="M12 12v4M9 20h6M10 16h4l1 4H9l1-4Z"/>',
    medal:'<circle cx="12" cy="14" r="5"/><path d="M9 9 7 3h10l-2 6"/><path d="m12 12 .9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2L9.1 14.2l2-.3L12 12Z"/>',
    sparkle:'<path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4Z"/><path d="M18 15l.7 1.9L21 18l-2.3.6L18 21l-.7-2.3L15 18l2.3-.6L18 15Z"/>',
    flag:'<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    check:'<path d="M20 6 9 17l-5-5"/>',
    doc:'<path d="M7 3h7l5 5v13H7V3Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    review:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4.3-4.3M8 11h6M11 8v6"/>',
    grid:'<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    gear:'<circle cx="12" cy="12" r="2.7"/><path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8 5.6 18.4M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6"/>',
    seal:'<path d="M12 3 4 7v6c0 4.5 3.4 7.3 8 8 4.6-.7 8-3.5 8-8V7l-8-4Z"/><path d="m9 12 2 2 4-4"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    lock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    users:'<circle cx="9" cy="8" r="3"/><path d="M3.5 19v-2.2A4.8 4.8 0 0 1 8.3 12h1.4a4.8 4.8 0 0 1 4.8 4.8V19M16 8.5a2.5 2.5 0 0 1 0 5M17 14c2.2.4 3.5 1.7 3.5 4v1"/>',
    calendar:'<path d="M5 4v3M19 4v3M4 9h16M5 6h14a1 1 0 0 1 1 1v13H4V7a1 1 0 0 1 1-1Z"/>',
    inbox:'<path d="M4 13h4l2 3h4l2-3h4"/><path d="M5 5h14l2 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5L5 5Z"/>',
    heart:'<path d="M12 20s-7-4.35-9.5-8.5C1 8.5 2.5 5 6 5c2 0 3.2 1.2 4 2.3C10.8 6.2 12 5 14 5c3.5 0 5 3.5 3.5 6.5C19 15.65 12 20 12 20Z"/>',
    feed:'<path d="M4 5h16M4 12h10M4 19h16M17 9l3 3-3 3"/>',
    warn:'<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v5M12 17h.01"/>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(p[type]||'')+'</svg>';
}

var SUBMISSION_STATUSES=[
  {k:'draft',label:'Nháp'},{k:'submitted',label:'Chờ duyệt'},{k:'needs_revision',label:'Cần chỉnh sửa'},
  {k:'approved',label:'Đã duyệt'},{k:'rejected',label:'Từ chối'},{k:'finalized',label:'Đã chốt'}
];
function statusLabel(k){var s=SUBMISSION_STATUSES.filter(function(x){return x.k===k;})[0];return s?s.label:(k||'—');}
function statusPill(k){return '<span class="phf-comp-pill" data-s="'+esc(k)+'">'+esc(statusLabel(k))+'</span>';}

/* ---- shared render fragments ------------------------------------------ */
function emptyState(iconType,line,sub){
  return '<div class="phf-comp-empty">'+icon(iconType)+'<p>'+esc(line)+'</p>'
    +(sub?'<p class="phf-comp-em-sub">'+esc(sub)+'</p>':'')+'</div>';
}
function loadingState(label){
  return '<div class="phf-comp-loading">'+icon('sparkle')+'<span>'+esc(label||'Đang tải dữ liệu…')+'</span></div>';
}
function errorState(err,retryLabel){
  return '<div class="phf-comp-error" data-comp-error>'+icon('warn')
    +'<div><b>Không tải được dữ liệu</b><p>'+esc((err&&err.message)||'Đã có lỗi xảy ra.')+'</p></div>'
    +'<button type="button" class="phf-comp-btn is-ghost" data-comp-retry>'+esc(retryLabel||'Thử lại')+'</button></div>';
}
function heroHtml(sub){
  return '<section class="phf-comp-hero">'
    +'<span class="phf-comp-eyebrow">PHF HR · Ghi nhận đóng góp</span>'
    +'<h1>Chương trình thi đua</h1>'
    +'<p>'+esc(sub||'Ghi nhận đóng góp của nhân sự PHF một cách công bằng — nộp nội dung, xét duyệt ẩn danh, xếp hạng và vinh danh sau khi chốt.')+'</p>'
    +'</section>';
}
function levelChipsHtml(levels){
  if(!levels||!levels.length)return '<p class="phf-comp-em-sub" style="margin-top:6px">Chưa có mức duyệt được cấu hình.</p>';
  return '<div class="phf-comp-levels">'+levels.map(function(l){
    return '<span class="phf-comp-level"><span class="lv-order">Mức '+esc(l.levelOrder)+'</span>'
      +'<span class="lv-name">'+esc(l.name)+'</span>'
      +'<span class="lv-score">'+esc(l.score)+' điểm</span>'
      +(l.slaHours?'<span class="lv-order">SLA '+esc(l.slaHours)+'h</span>':'')
      +'</span>';
  }).join('')+'</div>';
}
function noAuthorityState(iconType,line){
  return '<div class="phf-comp-note">'+icon(iconType||'lock')+'<span>'+esc(line)+'</span></div>';
}

/* ================================================================== *
 * Competition topbar notification bell — same pattern as PHF Task's
 * bell (assets/js/task/phf-task-app.js taskNotifBellHtml/PanelHtml), a
 * copy of the PATTERN not a shared component (Task's lives inside its own
 * module). Own table/actions (competition.notifications, never
 * task.notifications). Deep link is rebuilt client-side from role +
 * Competition route helpers — the server's target_path is only a HINT
 * used to pick which screen, never trusted as the literal navigation URL.
 * ================================================================== */
var compNotif={items:[],unread:0,open:false,loading:false,loaded:false,loadedAt:0,token:0,error:false};
var COMP_NOTIF_TTL=45000;
function compNotifBadgeText(n){return n>99?'99+':String(n);}
function compNotifBellHtml(){
  var n=compNotif.unread||0;
  return '<button type="button" class="phf-comp-notif-bell" data-comp-notif-toggle aria-label="Thông báo" aria-expanded="'+(compNotif.open?'true':'false')+'">'
    +'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>'
    +(n>0?'<span class="phf-comp-notif-badge" data-comp-notif-badge>'+esc(compNotifBadgeText(n))+'</span>':'')
  +'</button>';
}
function compNotifTimeText(iso){
  try{var d=new Date(iso),diff=(Date.now()-d.getTime())/1000;
    if(diff<60)return 'vừa xong';
    if(diff<3600)return Math.floor(diff/60)+' phút trước';
    if(diff<86400)return Math.floor(diff/3600)+' giờ trước';
    if(diff<604800)return Math.floor(diff/86400)+' ngày trước';
    return d.toLocaleDateString('vi-VN');
  }catch(e){return '';}
}
function compNotifScreenHint(it){
  return it&&it.eventCode==='COMPETITION_REVIEW_ASSIGNED'?'cho-duyet':'bai-cua-toi';
}
function compNotifPanelHtml(){
  var body;
  if(compNotif.loading&&!compNotif.loaded){body='<div class="phf-comp-notif-empty">Đang tải…</div>';}
  else if(compNotif.error&&!compNotif.items.length){body='<div class="phf-comp-notif-empty">Không tải được thông báo. <button type="button" class="phf-comp-notif-retry" data-comp-notif-retry>Thử lại</button></div>';}
  else if(!compNotif.items.length){body='<div class="phf-comp-notif-empty">Chưa có thông báo nào.</div>';}
  else{
    body=compNotif.items.map(function(it){
      return '<button type="button" class="phf-comp-notif-item'+(it.status==='unread'?' unread':'')+'" data-comp-notif-item="'+esc(it.id)+'" data-comp-notif-screen="'+esc(compNotifScreenHint(it))+'">'
        +'<span class="phf-comp-notif-item-title">'+esc(it.title||'Thông báo')+'</span>'
        +'<span class="phf-comp-notif-item-msg">'+esc(it.message||'')+'</span>'
        +'<span class="phf-comp-notif-item-time">'+esc(compNotifTimeText(it.createdAt))+'</span>'
      +'</button>';
    }).join('');
  }
  return '<div class="phf-comp-notif-panel" data-comp-notif-panel'+(compNotif.open?'':' hidden')+'>'
    +'<div class="phf-comp-notif-panel-head"><b>Thông báo</b>'+(compNotif.unread>0?'<button type="button" data-comp-notif-mark-all>Đánh dấu đã đọc tất cả</button>':'')+'</div>'
    +'<div class="phf-comp-notif-panel-body">'+body+'</div>'
  +'</div>';
}
function compNotifWrapHtml(){return '<div class="phf-comp-notif-wrap" data-comp-notif-wrap>'+compNotifBellHtml()+compNotifPanelHtml()+'</div>';}
function renderCompNotif(root){
  var scope=root||document;var wrap=scope.querySelector('[data-comp-notif-wrap]');
  if(wrap)wrap.innerHTML=compNotifBellHtml()+compNotifPanelHtml();
}
async function loadCompNotifications(root,force){
  if(compNotif.loading)return;
  if(!force&&compNotif.loaded&&(Date.now()-compNotif.loadedAt)<COMP_NOTIF_TTL)return;
  compNotif.loading=true;compNotif.error=false;
  var myToken=++compNotif.token;
  renderCompNotif(root);
  var ok=false,data=null;
  try{data=await call('competitionListMyNotifications',{limit:30});ok=true;}
  catch(e){ok=false;}
  compNotif.loading=false;
  if(myToken!==compNotif.token)return;
  if(ok){
    compNotif.items=Array.isArray(data.notifications)?data.notifications:[];
    compNotif.unread=Number(data.unreadCount)||0;
    compNotif.loaded=true;compNotif.loadedAt=Date.now();compNotif.error=false;
  }else{compNotif.error=true;}
  renderCompNotif(root);
}
function bindCompNotifOutsideClick(){
  if(window.__phfCompNotifOutsideBound)return;
  window.__phfCompNotifOutsideBound=true;
  document.addEventListener('click',function(e){
    if(!compNotif.open)return;
    var w=document.querySelector('[data-comp-notif-wrap]');
    if(w&&!w.contains(e.target)){compNotif.open=false;renderCompNotif(document);}
  });
}

/* ------------------------------------------------------------------ *
 * Module menu — role-filtered (namespace-based Batch-A skeleton gate,
 * unchanged in C3 — see phf-url-router.js header for why the FINAL
 * Competition permission contract is a later phase).
 * ------------------------------------------------------------------ */
/* C3.1 — FINAL permission contract: menu/screen availability follows
 * server-resolved Competition authority (competitionBootstrap.capabilities),
 * NEVER the /admin /ql /hv namespace and NEVER title/department/branch. The
 * namespace prefix is kept ONLY to build a URL the PHF HR router will accept
 * for the CURRENT session (the router still hard-locks each namespace
 * segment to the matching PHF HR system role — that is pre-existing shell
 * infrastructure this batch does not touch) — it carries no authorization
 * meaning of its own here. A /hv participant holding a Competition Admin
 * grant reaches admin screens at /hv/thi-dua/quan-ly, not /admin/thi-dua/…
 */
function menuModel(boot){
  var p=prefix();
  var cap=(boot&&boot.capabilities)||{};
  var items=[
    {key:'tong-quan',   label:'Tổng quan',              icon:'trophy',  href:p+'/thi-dua'},
    {key:'bang-tin',    label:'Bảng tin',               icon:'feed',    href:p+'/thi-dua/bang-tin'},
    {key:'bai-cua-toi', label:'Bài của tôi',            icon:'doc',     href:p+'/thi-dua/bai-cua-toi'},
    {key:'gui',         label:'Gửi nội dung',           icon:'plus',    href:p+'/thi-dua/gui'},
    {key:'ket-qua',     label:'Bảng xếp hạng & Kết quả',icon:'medal',   href:p+'/thi-dua/ket-qua'}
  ];
  if(cap.canReview){
    items.push({key:'cho-duyet',label:'Chờ duyệt',icon:'review',href:p+'/thi-dua/cho-duyet',group:'Xét duyệt'});
    items.push({key:'da-duyet',label:'Bài tôi đã duyệt',icon:'check',href:p+'/thi-dua/da-duyet',group:'Xét duyệt'});
  }
  if(cap.canAdmin){
    items.push({key:'quan-ly', label:'Quản lý chương trình', icon:'grid', href:p+'/thi-dua/quan-ly', group:'Quản trị chương trình'});
    items.push({key:'xet-duyet',label:'Cài đặt xét duyệt',   icon:'gear', href:p+'/thi-dua/xet-duyet',group:'Quản trị chương trình'});
    items.push({key:'chot',    label:'Chốt chương trình',    icon:'seal', href:p+'/thi-dua/chot',    group:'Quản trị chương trình'});
  }
  return items;
}
function screenForPath(path){
  var m=String(path||'').replace(/\/+$/,'').match(/^\/(?:admin|ql|hv)\/thi-dua(?:\/([a-z-]+))?$/);
  if(!m)return 'tong-quan';
  return m[1]||'tong-quan';
}
function navHtml(boot,activeKey){
  var items=menuModel(boot),out='<nav class="phf-comp-nav" aria-label="Menu Chương trình thi đua">',lastGroup='__none__';
  items.forEach(function(it){
    var grp=it.group||'Tham gia';
    if(grp!==lastGroup){out+='<span class="phf-comp-nav-group">'+esc(grp)+'</span>';lastGroup=grp;}
    out+='<a href="'+esc(it.href)+'" data-comp-nav="'+esc(it.href)+'"'+(it.key===activeKey?' class="is-active" aria-current="page"':'')+'>'+icon(it.icon)+'<span>'+esc(it.label)+'</span></a>';
  });
  return out+'</nav>';
}
function navLoadingHtml(){
  return '<nav class="phf-comp-nav" aria-label="Menu Chương trình thi đua">'+loadingState('Đang tải quyền…')+'</nav>';
}

/* Authorization is decided ONLY from server capabilities — no namespace, no
 * title/department/branch fallback. Participant screens have no capability
 * gate (any eligible active People-Master identity — competitionBootstrap
 * already rejects an ineligible/inactive identity before this is reached). */
function isScreenAuthorized(key,boot){
  var cap=(boot&&boot.capabilities)||{};
  if(key==='cho-duyet'||key==='da-duyet')return !!cap.canReview;
  if(key==='quan-ly'||key==='xet-duyet'||key==='chot')return !!cap.canAdmin;
  return true;
}

/* ================================================================== *
 * SCREEN RENDERERS — each is async(slot, boot) : renders into `slot`,
 * an element already inside the mounted shell. Honest loading -> data
 * -> error states; no fabricated numbers; no localStorage.
 * ================================================================== */

function participationCardHtml(myReq,campaign){
  var valid=myReq&&myReq.validCount!=null?myReq.validCount:'—';
  var req=myReq&&myReq.requiredCount!=null?myReq.requiredCount:'—';
  var missing=myReq&&myReq.missingCount!=null?myReq.missingCount:'—';
  var pct=(myReq&&myReq.requiredCount)?Math.max(0,Math.min(100,Math.round(100*myReq.validCount/myReq.requiredCount))):0;
  return '<section class="phf-comp-section"><h2>'+icon('check')+'Tiến độ tham gia của bạn</h2>'
    +'<div class="phf-comp-card phf-comp-participation">'
      +'<div class="phf-comp-prog" role="group" aria-label="Tiến độ tham gia">'
        +'<div class="phf-comp-prog-cell"><span>Đã gửi hợp lệ</span><b>'+esc(valid)+'</b></div>'
        +'<div class="phf-comp-prog-cell"><span>Yêu cầu tháng</span><b>'+esc(req)+'</b></div>'
        +'<div class="phf-comp-prog-cell"><span>Còn thiếu</span><b>'+esc(missing)+'</b></div>'
      +'</div>'
      +'<div class="phf-comp-prog-bar" aria-hidden="true"><i style="width:'+pct+'%"></i></div>'
      +(campaign?'':'<div class="phf-comp-note">'+icon('info')+'<span>Chưa có chương trình đang diễn ra.</span></div>')
      +'<div class="phf-comp-actions" style="border:0;padding-top:14px"><button type="button" class="phf-comp-btn" data-comp-go="'+esc(prefix()+'/thi-dua/gui')+'"'+(campaign?'':' disabled')+'>Gửi nội dung</button></div>'
    +'</div>'
  +'</section>';
}

async function screenOverview(slot,boot){
  var campaign=boot.activeCampaign;
  var html=heroHtml()+participationCardHtml(boot.myRequirement,campaign);
  if(!campaign){
    html+='<section class="phf-comp-section"><h2>'+icon('flag')+'Chương trình hiện tại</h2>'
      +'<div class="phf-comp-card">'+emptyState('flag','Chưa có chương trình nào đang diễn ra.','Khi Admin mở một chương trình, thông tin sẽ hiển thị tại đây.')+'</div></section>';
    slot.innerHTML=html;
    return;
  }
  var levels=[];
  try{levels=await call('competitionListLevels',{campaign_id:campaign.id});}catch(e){/* non-fatal on overview */}
  html+='<section class="phf-comp-section"><h2>'+icon('flag')+'Chương trình hiện tại</h2>'
    +'<div class="phf-comp-card">'
      +'<h3 style="margin:0 0 6px;font-size:16px;color:var(--comp-green-deep)">'+esc(campaign.title)+'</h3>'
      +'<p style="margin:0;color:var(--comp-ink-soft);font-size:13.5px">'+esc(campaign.description||'')+'</p>'
      +'<div class="phf-comp-grid" style="margin-top:16px">'
        +'<div class="phf-comp-fact"><b>Yêu cầu tối thiểu</b><span>'+(campaign.minRequiredContributions!=null?campaign.minRequiredContributions+' nội dung hợp lệ / người / tháng':'—')+'</span></div>'
        +'<div class="phf-comp-fact"><b>Trạng thái chương trình</b><span>'+esc(statusLabel(campaign.status))+'</span></div>'
        +'<div class="phf-comp-fact"><b>Hạn nộp</b><span>'+esc(fmtDate(campaign.submissionDeadline))+'</span></div>'
        +'<div class="phf-comp-fact"><b>Hạn xét duyệt</b><span>'+esc(fmtDate(campaign.reviewDeadline))+'</span></div>'
      +'</div>'
      +'<div style="margin-top:16px"><b style="font-size:12.5px">Mức công nhận (cấu hình chương trình)</b>'+levelChipsHtml(levels)+'</div>'
    +'</div>'
  +'</section>';
  if(boot.capabilities&&boot.capabilities.viewParticipationProgress){
    html+='<section class="phf-comp-section" data-comp-company-progress><h2>'+icon('users')+'Tiến độ tham gia toàn công ty</h2>'
      +'<div class="phf-comp-card">'+loadingState('Đang tải tiến độ toàn công ty…')+'</div></section>';
  }
  slot.innerHTML=html;
  var cpBlock=slot.querySelector('[data-comp-company-progress] .phf-comp-card');
  if(cpBlock){
    try{
      var cp=await call('competitionGetCompanyProgress',{campaign_id:campaign.id});
      if(!cp.rows||!cp.rows.length){cpBlock.innerHTML=emptyState('users','Chưa có dữ liệu tham gia.');}
      else{
        cpBlock.innerHTML='<div class="phf-comp-table-wrap"><table class="phf-comp-table"><thead><tr>'
          +'<th>Nhân sự</th><th>Phòng ban</th><th>Đã gửi hợp lệ</th><th>Còn thiếu</th><th>Trạng thái</th></tr></thead><tbody>'
          +cp.rows.map(function(r){
            return '<tr><td data-th="Nhân sự">'+esc(r.displayName||r.employeeCode)+'</td>'
              +'<td data-th="Phòng ban">'+esc(r.department||'—')+'</td>'
              +'<td data-th="Đã gửi hợp lệ">'+esc(r.validCount)+'</td>'
              +'<td data-th="Còn thiếu">'+esc(r.missingCount==null?'—':r.missingCount)+'</td>'
              +'<td data-th="Trạng thái">'+(r.completionState==='met'?'Đạt':(r.completionState==='not_met'?'Chưa đạt':'—'))+'</td></tr>';
          }).join('')+'</tbody></table></div>';
      }
    }catch(e){cpBlock.innerHTML=errorState(e);wireRetrySingle(cpBlock,function(){return screenOverview(slot,boot);});}
  }
}

async function screenFeed(slot,boot){
  var campaign=boot.activeCampaign;
  if(!campaign){slot.innerHTML=heroHtml()+'<section class="phf-comp-section"><h2>'+icon('feed')+'Bảng tin</h2>'+emptyState('feed','Chưa có chương trình đang diễn ra.')+'</section>';return;}
  slot.innerHTML=heroHtml('Hoạt động của chương trình — các đóng góp đủ điều kiện hiển thị ẩn danh dưới dạng thẻ tin, có thể thả tim để ghi nhận.')
    +'<section class="phf-comp-section"><h2>'+icon('feed')+'Bảng tin</h2>'
    +'<div class="phf-comp-note">'+icon('lock')+'<span>Trong thời gian chương trình đang chạy, bảng tin không hiển thị danh tính tác giả. Danh tính chỉ mở sau khi chương trình được chốt và bật công bố.</span></div>'
    +'<div class="phf-comp-feed" data-comp-feed style="margin-top:14px">'+loadingState('Đang tải bảng tin…')+'</div>'
  +'</section>';
  var feedBox=slot.querySelector('[data-comp-feed]');
  try{
    var feed=await call('competitionGetFeed',{campaign_id:campaign.id});
    if(!feed.posts||!feed.posts.length){
      feedBox.innerHTML=emptyState('feed','Bảng tin chưa có hoạt động.','Khi có nội dung đủ điều kiện (đã duyệt), các đóng góp sẽ xuất hiện tại đây kèm lượt thả tim.');
      return;
    }
    feedBox.innerHTML=feed.posts.map(feedPostHtml).join('');
  }catch(e){feedBox.innerHTML=errorState(e);wireRetrySingle(feedBox,function(){return screenFeed(slot,boot);});}
}
function feedPostHtml(post){
  var token=post.authorName?esc(post.authorName):('<span class="phf-comp-post-token-alias">'+esc(post.anonAlias)+'</span>');
  var isHighLevel=post.approvalLevel!=null&&Number(post.approvalLevel)>1;
  var kindHtml=post.approvalLevelName
    ? '<span class="phf-comp-post-kind'+(isHighLevel?' is-high':'')+'">'+(isHighLevel?icon('sparkle'):'')
      +(isHighLevel?'Giá trị cao · '+esc(post.approvalLevelName):esc(post.approvalLevelName))+' · '+esc(post.currentScore)+' điểm</span>'
    : '';
  var payload=post.payload||{};
  var question=payload.customer_question,answerText=payload.answer;
  var bodyHtml;
  if(question||answerText){
    bodyHtml=(question?'<div class="phf-comp-post-q"><span class="phf-comp-post-label">Câu hỏi / tình huống khách hàng</span><p>'+esc(question)+'</p></div>':'')
      +(answerText?'<div class="phf-comp-post-a"><span class="phf-comp-post-label">Cách trả lời / xử lý</span><p>'+esc(answerText)+'</p></div>':'');
  }else{
    bodyHtml='<div class="phf-comp-post-q"><p>'+esc(JSON.stringify(payload).slice(0,240))+'</p></div>';
  }
  return '<article class="phf-comp-post'+(isHighLevel?' is-high-level':'')+'" data-comp-post data-post-id="'+esc(post.submissionId)+'">'
    +'<header class="phf-comp-post-head">'
      +'<span class="phf-comp-post-id">'+icon('users')+token+'<span class="phf-comp-post-when">'+esc(fmtDate(post.submittedAt))+'</span></span>'
      +kindHtml
    +'</header>'
    +'<div class="phf-comp-post-body">'+bodyHtml+'</div>'
    +'<footer class="phf-comp-post-foot">'
      +'<button type="button" class="phf-comp-react'+(post.viewerReacted?' is-on':'')+'" data-comp-react data-submission-id="'+esc(post.submissionId)+'" aria-pressed="'+(post.viewerReacted?'true':'false')+'">'
        +icon('heart')+'<span class="rx-label">'+(post.viewerReacted?'Đã thả tim':'Thả tim')+'</span><span class="rx-count" data-rx-count>'+esc(post.reactionTotal||0)+'</span></button>'
      +'<span class="phf-comp-post-state">'+esc(statusLabel(post.status))+'</span>'
    +'</footer>'
  +'</article>';
}

async function screenMySubmissions(slot,boot){
  slot.innerHTML=heroHtml('Theo dõi các nội dung bạn đã gửi và trạng thái xét duyệt.')
    +'<section class="phf-comp-section"><h2>'+icon('doc')+'Bài của tôi</h2><div data-comp-body>'+loadingState()+'</div></section>';
  var body=slot.querySelector('[data-comp-body]');
  try{
    var rows=await call('competitionListMySubmissions',{});
    if(!rows||!rows.length){
      body.innerHTML=emptyState('inbox','Bạn chưa gửi nội dung nào.','Nhấn "Gửi nội dung" để bắt đầu.')
        +'<div class="phf-comp-actions" style="border:0;padding-top:14px"><button type="button" class="phf-comp-btn" data-comp-go="'+esc(prefix()+'/thi-dua/gui')+'">Gửi nội dung</button></div>';
      return;
    }
    body.innerHTML='<div class="phf-comp-legend" aria-label="Các trạng thái bài dự thi">'+SUBMISSION_STATUSES.map(function(s){return '<span class="phf-comp-pill" data-s="'+s.k+'">'+esc(s.label)+'</span>';}).join('')+'</div>'
      +rows.map(function(s){
        var q=(s.payload&&(s.payload.customer_question||s.payload.answer))||'(chưa có nội dung)';
        return '<div class="phf-comp-card" style="margin-top:12px">'
          +'<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">'
            +statusPill(s.status)+'<span style="font-size:12px;color:var(--comp-ink-soft)">'+esc(fmtDate(s.updatedAt))+'</span></div>'
          +'<p style="margin:10px 0 0;font-size:13.5px">'+esc(String(q).slice(0,200))+'</p>'
          +(s.currentLevelOrder?'<p style="margin:6px 0 0;font-size:12.5px;color:var(--comp-green-deep)">Mức '+esc(s.currentLevelOrder)+' · '+esc(s.currentScore)+' điểm</p>':'')
          +(s.lastReviewNote?'<div class="phf-comp-note">'+icon('info')+'<span>'+esc(s.lastReviewNote)+'</span></div>':'')
          +(['draft','needs_revision'].indexOf(s.status)>=0?'<div class="phf-comp-actions" style="padding-top:12px"><button type="button" class="phf-comp-btn" data-comp-go="'+esc(prefix()+'/thi-dua/gui')+'">Tiếp tục chỉnh sửa</button></div>':'')
        +'</div>';
      }).join('');
  }catch(e){body.innerHTML=errorState(e);wireRetrySingle(body,function(){return screenMySubmissions(slot,boot);});}
}

async function screenSubmitForm(slot,boot){
  var campaign=boot.activeCampaign;
  if(!campaign){slot.innerHTML=heroHtml()+'<section class="phf-comp-section"><h2>'+icon('plus')+'Gửi nội dung</h2>'+emptyState('plus','Chưa có chương trình đang nhận bài.')+'</section>';return;}
  slot.innerHTML=heroHtml('Gửi một câu hỏi / tình huống khách hàng thật và cách bạn đã xử lý.')
    +'<section class="phf-comp-section"><h2>'+icon('plus')+'Gửi bài dự thi</h2>'
    +'<p class="phf-comp-context-sub">'+esc(campaign.title)+'</p>'
    +'<div data-comp-body>'+loadingState()+'</div></section>';
  var body=slot.querySelector('[data-comp-body]');
  try{
    var mine=await call('competitionListMySubmissions',{campaign_id:campaign.id});
    var draft=(mine||[]).filter(function(s){return s.status==='draft'||s.status==='needs_revision';})[0]||null;
    renderSubmitForm(body,campaign,draft);
  }catch(e){body.innerHTML=errorState(e);wireRetrySingle(body,function(){return screenSubmitForm(slot,boot);});}
}
var FIELD_HELP_COPY={
  customer_question:'Ghi lại tình huống hoặc câu hỏi khách hàng thực tế bạn đã gặp.',
  answer:'Ghi lại đúng cách bạn đã trả lời hoặc xử lý tình huống đó.'
};
function formFieldHtml(field,value){
  var v=value==null?'':value;
  var helper=FIELD_HELP_COPY[field.key];
  var helperHtml=helper?'<p class="hint">'+esc(helper)+'</p>':'';
  if(field.type==='textarea'){
    return '<div class="phf-comp-field"><label>'+esc(field.label)+(field.required?'<span class="req">*</span>':'')+'</label>'
      +'<textarea data-comp-field="'+esc(field.key)+'" placeholder="'+esc(field.help||'')+'">'+esc(v)+'</textarea>'+helperHtml+'</div>';
  }
  return '<div class="phf-comp-field"><label>'+esc(field.label)+(field.required?'<span class="req">*</span>':'')+'</label>'
    +'<input type="text" data-comp-field="'+esc(field.key)+'" value="'+esc(v)+'" placeholder="'+esc(field.help||'')+'">'+helperHtml+'</div>';
}
function renderSubmitForm(body,campaign,draft){
  var schema=Array.isArray(campaign.formSchema)&&campaign.formSchema.length?campaign.formSchema:[
    {key:'customer_question',label:'Câu hỏi / tình huống khách hàng',type:'textarea',required:true},
    {key:'answer',label:'Câu trả lời / cách xử lý',type:'textarea',required:true}
  ];
  var payload=(draft&&draft.payload)||{};
  var isLocked=draft&&['submitted','approved','rejected','finalized'].indexOf(draft.status)>=0;
  body.innerHTML='<div class="phf-comp-card">'
    +(draft?'<div class="phf-comp-note">'+icon('info')+'<span>Đang chỉnh sửa bản '+(draft.status==='needs_revision'?'cần chỉnh sửa':'nháp')+' đã lưu.'+(draft.lastReviewNote?' Ghi chú người duyệt: '+esc(draft.lastReviewNote):'')+'</span></div>':'')
    +schema.map(function(f){return formFieldHtml(f,payload[f.key]);}).join('')
    +(isLocked?'':'<p class="phf-comp-form-note">Hãy ghi tình huống thật, câu trả lời thật.</p>')
    +'<div class="phf-comp-actions">'
      +'<button type="button" class="phf-comp-btn is-ghost" data-comp-save-draft'+(isLocked?' disabled':'')+'>Lưu nháp</button>'
      +'<button type="button" class="phf-comp-btn" data-comp-submit'+(isLocked?' disabled':'')+'>Gửi bài dự thi</button>'
      +(isLocked?'<span class="phf-comp-disabled-hint">Bài đang chờ/đã xử lý — không sửa được nữa.</span>':'')
    +'</div>'
  +'</div>';
  if(isLocked)return;
  function collect(){
    var out={};
    body.querySelectorAll('[data-comp-field]').forEach(function(el){out[el.getAttribute('data-comp-field')]=el.value;});
    return out;
  }
  var draftId=draft?draft.id:null;
  body.querySelector('[data-comp-save-draft]').addEventListener('click',async function(){
    var btn=this;btn.disabled=true;
    try{
      var p=collect();
      if(!draftId){var created=await call('competitionCreateSubmissionDraft',{campaign_id:campaign.id,payload:p});draftId=created.id;}
      else{await call('competitionEditSubmissionDraft',{submission_id:draftId,payload:p});}
      toast('success','Đã lưu nháp','Bạn có thể tiếp tục chỉnh sửa sau.');
    }catch(e){toast('error','Không lưu được',e.message);}
    finally{btn.disabled=false;}
  });
  body.querySelector('[data-comp-submit]').addEventListener('click',async function(){
    var btn=this;btn.disabled=true;
    var missing=schema.filter(function(f){return f.required;}).filter(function(f){var el=body.querySelector('[data-comp-field="'+f.key+'"]');return !el||!el.value.trim();});
    if(missing.length){toast('error','Thiếu thông tin','Vui lòng nhập: '+missing.map(function(f){return f.label;}).join(', '));btn.disabled=false;return;}
    try{
      var p=collect();
      if(!draftId){var created=await call('competitionCreateSubmissionDraft',{campaign_id:campaign.id,payload:p});draftId=created.id;}
      await call('competitionSubmitSubmission',{submission_id:draftId,payload:p});
      toast('success','Đã gửi duyệt','Nội dung của bạn đã vào hàng chờ xét duyệt ẩn danh.');
      go(prefix()+'/thi-dua/bai-cua-toi');
    }catch(e){toast('error','Không gửi được',e.message);}
    finally{btn.disabled=false;}
  });
}

async function screenLeaderboard(slot,boot){
  var campaign=boot.activeCampaign;
  if(!campaign){slot.innerHTML=heroHtml()+'<section class="phf-comp-section"><h2>'+icon('trophy')+'Vị trí của bạn</h2>'+emptyState('trophy','Chưa có chương trình đang diễn ra.')+'</section>';return;}
  slot.innerHTML=heroHtml('Bảng xếp hạng ẩn danh giúp bạn biết khoảng cách và cố gắng; kết quả chính thức công bố sau khi chương trình được chốt.')
    +'<section class="phf-comp-section" data-comp-body>'+loadingState('Đang tải bảng xếp hạng…')+'</section>';
  var body=slot.querySelector('[data-comp-body]');
  try{
    var lb=await call('competitionGetLeaderboard',{campaign_id:campaign.id});
    var you=lb.you;
    var html='<h2>'+icon('trophy')+'Vị trí của bạn</h2>'
      +'<div class="phf-comp-card phf-comp-you">'
        +'<div class="phf-comp-grid">'
          +'<div class="phf-comp-fact"><b>Hạng của bạn</b><span>'+(you?esc(you.rank):'—')+'</span></div>'
          +'<div class="phf-comp-fact"><b>Điểm của bạn</b><span>'+(you?esc(you.totalScore):'—')+'</span></div>'
          +(you&&('approvedCount' in you)?'<div class="phf-comp-fact"><b>Bài đã duyệt</b><span>'+esc(you.approvedCount)+'</span></div>':'')
        +'</div>'
        +(you?'':'<div class="phf-comp-note">'+icon('info')+'<span>Bạn chưa có bài được duyệt trong chương trình này.</span></div>')
      +'</div>'
    +'</section><section class="phf-comp-section"><h2>'+icon('medal')+'Bảng xếp hạng ('+(lb.identityMode==='participant'?'ẩn danh':lb.identityMode==='public'?'công khai':lb.identityMode==='privileged'?'người duyệt cấp cao':'quản trị')+')</h2>';
    if(!lb.rows||!lb.rows.length){
      html+='<div class="phf-comp-table-wrap">'+emptyState('trophy','Chưa có dữ liệu xếp hạng.','Xếp hạng sẽ hiển thị khi có bài được duyệt.')+'</div>';
    }else{
      html+='<div class="phf-comp-table-wrap"><table class="phf-comp-table"><thead><tr><th>Hạng</th><th>Người tham gia</th><th>Điểm</th>'
        +(lb.identityMode==='admin'?'<th>Bài đã duyệt</th>':'')+'</tr></thead><tbody>'
        +lb.rows.map(function(r){
          var who=r.isYou?('Bạn'+(r.displayName?' · '+esc(r.displayName):'')):(esc(r.displayName||r.alias||'Người tham gia'));
          return '<tr'+(r.isYou?' style="background:var(--comp-green-soft)"':'')+'><td data-th="Hạng">#'+esc(r.rank)+'</td>'
            +'<td data-th="Người tham gia">'+who+'</td><td data-th="Điểm">'+esc(r.totalScore)+'</td>'
            +(lb.identityMode==='admin'?'<td data-th="Bài đã duyệt">'+esc(r.approvedCount)+'</td>':'')+'</tr>';
        }).join('')+'</tbody></table></div>';
    }
    html+='<div class="phf-comp-note">'+icon('lock')+'<span>'+(lb.published?'Chương trình đã chốt và công bố — danh tính hiển thị công khai.':(lb.identityMode==='privileged'?'Bạn thấy danh tính thật vì là người duyệt mức cao nhất, nhưng vẫn không thấy danh tính gắn với từng bài cụ thể.':(lb.identityMode==='admin'?'Bạn thấy toàn bộ danh tính với vai trò Competition Admin.':'Người khác luôn hiển thị ẩn danh cho tới khi chương trình được chốt và công bố.')))+'</span></div>'
    +'</section>';
    body.outerHTML='<section class="phf-comp-section">'+html;
  }catch(e){body.innerHTML=errorState(e);wireRetrySingle(body,function(){return screenLeaderboard(slot,boot);});}
}

async function screenReviewQueue(slot,boot){
  var campaign=boot.activeCampaign;
  if(!boot.capabilities||!boot.capabilities.canReview){
    slot.innerHTML=heroHtml()+'<section class="phf-comp-section"><h2>'+icon('review')+'Chờ duyệt</h2>'+noAuthorityState('lock','Bạn chưa được cấp quyền xét duyệt cho Chương trình thi đua.')+'</section>';
    return;
  }
  if(!campaign){slot.innerHTML=heroHtml()+'<section class="phf-comp-section"><h2>'+icon('review')+'Chờ duyệt</h2>'+emptyState('review','Chưa có chương trình đang diễn ra.')+'</section>';return;}
  slot.innerHTML=heroHtml('Xét duyệt ẩn danh — không hiển thị danh tính người gửi khi chương trình đang nhận bài / đang xét duyệt.')
    +'<section class="phf-comp-section"><h2>'+icon('review')+'Chờ duyệt (ẩn danh)</h2>'
    +'<div class="phf-comp-note">'+icon('lock')+'<span>Màn xét duyệt không có ô danh tính. Hệ thống vẫn giữ danh tính thật ở backend cho việc chấm điểm, chống tự duyệt và xếp hạng — nhưng người duyệt không nhìn thấy.</span></div>'
    +'<div data-comp-body style="margin-top:12px">'+loadingState()+'</div></section>'
    +'<section class="phf-comp-section" data-comp-productivity><h2>'+icon('users')+'Năng suất xét duyệt của bạn</h2><div class="phf-comp-card">'+loadingState()+'</div></section>';
  var body=slot.querySelector('[data-comp-body]');
  try{
    var queue=await call('competitionGetReviewQueue',{campaign_id:campaign.id});
    renderReviewQueue(body,campaign,queue,boot);
  }catch(e){body.innerHTML=errorState(e);wireRetrySingle(body,function(){return screenReviewQueue(slot,boot);});}
  var prodBox=slot.querySelector('[data-comp-productivity] .phf-comp-card');
  try{
    var prod=await call('competitionGetReviewerProductivity',{campaign_id:campaign.id});
    prodBox.innerHTML='<div class="phf-comp-grid">'
      +'<div class="phf-comp-fact"><b>Đã nhận</b><span>'+esc(prod.assigned||0)+'</span></div>'
      +'<div class="phf-comp-fact"><b>Đã xử lý</b><span>'+esc(prod.processed||0)+'</span></div>'
      +'<div class="phf-comp-fact"><b>Đang chờ</b><span>'+esc(prod.pending||0)+'</span></div>'
      +'<div class="phf-comp-fact"><b>Quá hạn</b><span>'+esc(prod.overdue||0)+'</span></div>'
    +'</div>';
  }catch(e){prodBox.innerHTML=errorState(e);}
}
/* Reviewer-2 (single eligible level) gets a static compact indicator — no
 * choice to make, so no control. Reviewer-5 (multiple eligible levels) gets
 * a segmented switch, never a raw <select>; the level chosen there is a
 * UI-only pick of the SAME server-resolved eligibleLevels this queue always
 * carried — approve/upgrade still send it as level_order, unchanged contract. */
function reviewLevelControlHtml(item,eligibleLevels){
  eligibleLevels=eligibleLevels||[];
  if(eligibleLevels.length<=1){
    var lvl=eligibleLevels[0];
    if(!lvl)return '';
    return '<span class="phf-comp-level-badge" data-comp-level-fixed="'+esc(lvl.levelOrder)+'">'+esc(lvl.score)+' điểm · '+esc(lvl.name)+'</span>';
  }
  var higher=eligibleLevels.filter(function(l){return !item.currentLevelOrder||l.levelOrder>item.currentLevelOrder;});
  var defaultOrder=(higher[0]||eligibleLevels[eligibleLevels.length-1]).levelOrder;
  return '<div class="phf-comp-level-switch" role="group" aria-label="Chọn mức ghi nhận" data-comp-level-switch>'
    +eligibleLevels.map(function(l){
      var disabled=item.currentLevelOrder&&l.levelOrder<=item.currentLevelOrder;
      var selected=l.levelOrder===defaultOrder;
      return '<button type="button" class="phf-comp-level-opt'+(selected?' is-selected':'')+'" data-comp-level-opt="'+esc(l.levelOrder)+'" aria-pressed="'+(selected?'true':'false')+'"'+(disabled?' disabled':'')+'>'+esc(l.score)+'đ · '+esc(l.name)+'</button>';
    }).join('')
  +'</div>';
}
function renderReviewQueue(body,campaign,queue,boot){
  if(!queue.items||!queue.items.length){
    body.innerHTML=emptyState('review','Hiện chưa có bài chờ duyệt.','Hàng đợi xét duyệt ẩn danh sẽ hiển thị khi có bài mới.');
    return;
  }
  body.innerHTML=queue.items.map(function(it){
    var q=(it.payload&&(it.payload.customer_question||it.payload.answer))||'(không có nội dung)';
    return '<div class="phf-comp-review-item" data-comp-review-item data-submission-id="'+esc(it.submissionRef)+'" style="margin-top:12px">'
      +'<span class="rq-ref">'+esc(it.reviewStatus==='needs_revision'?'Đã yêu cầu chỉnh sửa':'Bài #'+String(it.submissionRef).slice(0,8))+'</span>'
      +'<h3>'+esc(String(q).slice(0,220))+'</h3>'
      +(it.currentLevelOrder?'<p style="font-size:12.5px;color:var(--comp-green-deep)">Đã duyệt mức '+esc(it.currentLevelOrder)+' — có thể nâng mức</p>':'')
      +'<div class="phf-comp-review-level-row">'+reviewLevelControlHtml(it,queue.eligibleLevels)+'</div>'
      +'<div class="phf-comp-review-controls">'
        +'<button type="button" class="phf-comp-btn" data-comp-review-act="'+(it.currentLevelOrder?'upgrade':'approve')+'">'+(it.currentLevelOrder?'Nâng mức':'Duyệt')+'</button>'
        +'<button type="button" class="phf-comp-btn is-ghost" data-comp-review-act="request_revision">Yêu cầu chỉnh sửa</button>'
        +'<button type="button" class="phf-comp-btn is-ghost" data-comp-review-act="reject">Từ chối</button>'
      +'</div>'
    +'</div>';
  }).join('');
  body.querySelectorAll('[data-comp-level-switch]').forEach(function(grp){
    grp.querySelectorAll('[data-comp-level-opt]').forEach(function(btn){
      btn.addEventListener('click',function(){
        if(btn.disabled)return;
        grp.querySelectorAll('[data-comp-level-opt]').forEach(function(b){b.classList.remove('is-selected');b.setAttribute('aria-pressed','false');});
        btn.classList.add('is-selected');btn.setAttribute('aria-pressed','true');
      });
    });
  });
  body.querySelectorAll('[data-comp-review-act]').forEach(function(btn){
    btn.addEventListener('click',async function(){
      var item=btn.closest('[data-comp-review-item]');
      var submissionId=item.getAttribute('data-submission-id');
      var action=btn.getAttribute('data-comp-review-act');
      var levelOrder;
      var fixedLvl=item.querySelector('[data-comp-level-fixed]');
      if(fixedLvl){levelOrder=Number(fixedLvl.getAttribute('data-comp-level-fixed'));}
      else{var selLvl=item.querySelector('[data-comp-level-opt].is-selected');levelOrder=selLvl?Number(selLvl.getAttribute('data-comp-level-opt')):undefined;}
      var note='';
      if(action==='request_revision'||action==='reject'){
        note=window.prompt(action==='reject'?'Lý do từ chối:':'Ghi chú yêu cầu chỉnh sửa:')||'';
        if(!note.trim()){return;}
      }
      item.querySelectorAll('button').forEach(function(b){b.disabled=true;});
      try{
        await call('competitionReviewSubmission',{campaign_id:campaign.id,submission_id:submissionId,review_action:action,level_order:levelOrder,note:note});
        toast('success','Đã cập nhật','Bài đã được xử lý.');
        var refreshed=await call('competitionGetReviewQueue',{campaign_id:campaign.id});
        renderReviewQueue(body,campaign,refreshed,boot);
      }catch(e){toast('error','Không xử lý được',e.message);item.querySelectorAll('button').forEach(function(b){b.disabled=false;});}
    });
  });
}

/* ================================================================== *
 * "Bài tôi đã duyệt" — read-only history of what THIS reviewer actually
 * processed (review_assignments WHERE reviewer=self AND status='completed'
 * — the SAME base as the "Đã xử lý" productivity count). Never shows author
 * identity. Surfaces the EXISTING adjustment entry points (upgrade /
 * admin withdraw-approval) rather than any new scoring logic.
 * ================================================================== */
var MY_REVIEWED_FILTER='all';
var MY_REVIEWED_FILTERS=[
  {k:'all',label:'Tất cả'},{k:'approved',label:'Đã duyệt'},
  {k:'needs_revision',label:'Yêu cầu chỉnh sửa'},{k:'rejected',label:'Từ chối'}
];
function myReviewedActionLabel(a){
  return {approve:'Duyệt',upgrade:'Nâng mức',revision_requested:'Yêu cầu chỉnh sửa',reject:'Từ chối'}[a]||(a||'—');
}
async function screenMyReviewed(slot,boot){
  var campaign=boot.activeCampaign;
  if(!boot.capabilities||!boot.capabilities.canReview){
    slot.innerHTML=heroHtml()+'<section class="phf-comp-section"><h2>'+icon('check')+'Bài tôi đã duyệt</h2>'+noAuthorityState('lock','Bạn chưa được cấp quyền xét duyệt cho Chương trình thi đua.')+'</section>';
    return;
  }
  if(!campaign){slot.innerHTML=heroHtml()+'<section class="phf-comp-section"><h2>'+icon('check')+'Bài tôi đã duyệt</h2>'+emptyState('check','Chưa có chương trình đang diễn ra.')+'</section>';return;}
  slot.innerHTML=heroHtml('Lịch sử các bài bạn đã xử lý — không hiển thị danh tính người gửi.')
    +'<section class="phf-comp-section"><h2>'+icon('check')+'Bài tôi đã duyệt</h2>'
    +'<div class="phf-comp-level-switch" role="group" aria-label="Lọc theo kết quả" data-comp-myreviewed-filter>'
      +MY_REVIEWED_FILTERS.map(function(f){return '<button type="button" class="phf-comp-level-opt'+(f.k===MY_REVIEWED_FILTER?' is-selected':'')+'" data-comp-filter="'+f.k+'" aria-pressed="'+(f.k===MY_REVIEWED_FILTER?'true':'false')+'">'+esc(f.label)+'</button>';}).join('')
    +'</div>'
    +'<div data-comp-body style="margin-top:12px">'+loadingState()+'</div></section>';
  var body=slot.querySelector('[data-comp-body]');
  async function load(){
    body.innerHTML=loadingState();
    try{
      var data=await call('competitionGetMyReviewed',{campaign_id:campaign.id,status_filter:MY_REVIEWED_FILTER,limit:50});
      renderMyReviewedList(body,campaign,boot,data);
    }catch(e){body.innerHTML=errorState(e);wireRetrySingle(body,load);}
  }
  slot.querySelectorAll('[data-comp-filter]').forEach(function(btn){
    btn.addEventListener('click',function(){
      MY_REVIEWED_FILTER=btn.getAttribute('data-comp-filter');
      slot.querySelectorAll('[data-comp-filter]').forEach(function(b){b.classList.toggle('is-selected',b===btn);b.setAttribute('aria-pressed',b===btn?'true':'false');});
      load();
    });
  });
  await load();
}
function myReviewedResultText(item){
  var cur=item.currentStatus;
  if(cur==='approved'||cur==='finalized')return (item.currentScore==null?'—':esc(item.currentScore)+' điểm (mức '+esc(item.currentLevelOrder)+')');
  if(cur==='rejected')return 'Đã từ chối';
  if(cur==='needs_revision')return 'Cần chỉnh sửa';
  return statusLabel(cur);
}
function myReviewedMineText(item){
  var after=item.myResult||{};
  if(item.myAction==='upgrade'&&after.to_score!=null)return esc(after.to_score)+' điểm (mức '+esc(after.to_level)+')';
  if((item.myAction==='approve')&&after.level!=null)return (item.currentScore==null?'':'')+'Duyệt mức '+esc(after.level);
  return myReviewedActionLabel(item.myAction);
}
function renderMyReviewedList(body,campaign,boot,data){
  var items=data.items||[];
  if(!items.length){body.innerHTML=emptyState('check','Chưa có bài nào bạn đã xử lý.','Danh sách sẽ hiển thị sau khi bạn duyệt/từ chối/yêu cầu chỉnh sửa một bài.');return;}
  var cap=(boot&&boot.capabilities)||{};
  body.innerHTML=items.map(function(it){
    var q=(it.payload&&(it.payload.customer_question||it.payload.answer))||'(không có nội dung)';
    var evidence=it.payload&&(it.payload.evidence_url||it.payload.evidence||it.payload.evidence_link);
    var mine=myReviewedMineText(it), curr=myReviewedResultText(it);
    var differs=String(mine)!==String(curr);
    var canAdjust=(cap.canAdmin)&&['approved','finalized'].includes(it.currentStatus);
    return '<div class="phf-comp-review-item" data-comp-mr-item data-submission-id="'+esc(it.submissionRef)+'" style="margin-top:12px">'
      +'<span class="rq-ref">'+esc(fmtDate(it.processedAt))+' · '+esc(myReviewedActionLabel(it.myAction))+'</span>'
      +'<h3>'+esc(String(q).slice(0,220))+'</h3>'
      +(it.myNote?'<p style="font-size:12.5px;color:var(--comp-ink-soft)">Ghi chú của bạn: '+esc(it.myNote)+'</p>':'')
      +(evidence?'<p style="font-size:12.5px"><a href="'+esc(evidence)+'" target="_blank" rel="noopener">Xem minh chứng</a></p>':'')
      +'<div class="phf-comp-grid" style="margin-top:8px">'
        +'<div class="phf-comp-fact"><b>Bạn đã xử lý</b><span>'+mine+' · '+esc(fmtDate(it.myActionAt||it.processedAt))+'</span></div>'
        +'<div class="phf-comp-fact"><b>Kết quả hiện tại</b><span'+(differs?' style="color:#8a6a2c;font-weight:700"':'')+'>'+curr+(differs?' (đã thay đổi)':'')+'</span></div>'
      +'</div>'
      +(canAdjust?'<div class="phf-comp-mr-adjust" data-comp-mr-adjust hidden>'
        +'<textarea data-mr-reason placeholder="Lý do rút duyệt (bắt buộc)" rows="2"></textarea>'
        +'<div class="phf-comp-actions" style="padding-top:8px"><button type="button" class="phf-comp-btn is-ghost" data-comp-mr-withdraw>Rút duyệt (đưa về chờ duyệt)</button></div>'
      +'</div>'
      +'<div class="phf-comp-actions" style="padding-top:10px"><button type="button" class="phf-comp-btn is-ghost" data-comp-mr-toggle-adjust>Điều chỉnh kết quả (Admin)</button></div>':'')
    +'</div>';
  }).join('');
  body.querySelectorAll('[data-comp-mr-toggle-adjust]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var box=btn.closest('[data-comp-mr-item]').querySelector('[data-comp-mr-adjust]');
      if(box)box.hidden=!box.hidden;
    });
  });
  body.querySelectorAll('[data-comp-mr-withdraw]').forEach(function(btn){
    btn.addEventListener('click',async function(){
      var item=btn.closest('[data-comp-mr-item]');
      var submissionId=item.getAttribute('data-submission-id');
      var reason=item.querySelector('[data-mr-reason]').value.trim();
      if(!reason){toast('error','Thiếu lý do','Cần nhập lý do rút duyệt.');return;}
      btn.disabled=true;
      try{
        await call('competitionAdminOverrideSubmission',{campaign_id:campaign.id,submission_id:submissionId,mode:'withdraw_approval',reason:reason});
        toast('success','Đã rút duyệt','Bài đã được đưa về trạng thái chờ duyệt.');
        var refreshed=await call('competitionGetMyReviewed',{campaign_id:campaign.id,status_filter:MY_REVIEWED_FILTER,limit:50});
        renderMyReviewedList(body,campaign,boot,refreshed);
      }catch(e){toast('error','Không rút duyệt được',e.message);btn.disabled=false;}
    });
  });
}

/* ---- ADMIN: shared campaign selector ---------------------------------- */
var ADMIN_SELECTED_CAMPAIGN_ID=null;
async function adminCampaignPicker(boot){
  var listRes=await call('competitionListCampaigns',{});
  var camps=(listRes&&listRes.campaigns)||[];
  if(!ADMIN_SELECTED_CAMPAIGN_ID){
    ADMIN_SELECTED_CAMPAIGN_ID=(boot.activeCampaign&&boot.activeCampaign.id)||(camps[0]&&camps[0].id)||null;
  }
  var selected=camps.filter(function(c){return c.id===ADMIN_SELECTED_CAMPAIGN_ID;})[0]||null;
  return {campaigns:camps,selected:selected};
}
function campaignSelectHtml(camps,selectedId){
  if(!camps.length)return '';
  return '<div class="phf-comp-toolbar"><select data-comp-campaign-select aria-label="Chọn chương trình">'
    +camps.map(function(c){return '<option value="'+esc(c.id)+'"'+(c.id===selectedId?' selected':'')+'>'+esc(c.title)+' ('+esc(statusLabel(c.status))+')</option>';}).join('')
  +'</select></div>';
}
function wireCampaignSelect(container,onChange){
  var sel=container.querySelector('[data-comp-campaign-select]');
  if(sel)sel.addEventListener('change',function(){ADMIN_SELECTED_CAMPAIGN_ID=sel.value;onChange();});
}
function wireRetrySingle(container,retry){
  var btn=container.querySelector('[data-comp-retry]');
  if(btn)btn.addEventListener('click',function(){retry();});
}

async function screenAdminCampaigns(slot,boot){
  slot.innerHTML=heroHtml('Tạo, cấu hình và điều hành các chương trình thi đua.')
    +'<section class="phf-comp-section" data-comp-body><h2>'+icon('grid')+'Danh sách chương trình</h2>'+loadingState()+'</section>'
    +'<section class="phf-comp-section"><h2>'+icon('plus')+'Tạo chương trình mới</h2><div class="phf-comp-card" data-comp-create></div></section>';
  var body=slot.querySelector('[data-comp-body]');
  async function renderList(){
    try{
      var picker=await adminCampaignPicker(boot);
      var html='<h2>'+icon('grid')+'Danh sách chương trình</h2>';
      if(!picker.campaigns.length){html+=emptyState('grid','Chưa có chương trình nào.','Tạo chương trình đầu tiên ở khối bên dưới.');body.innerHTML=html;return;}
      html+=campaignSelectHtml(picker.campaigns,ADMIN_SELECTED_CAMPAIGN_ID);
      var c=picker.selected;
      if(c){
        html+='<div class="phf-comp-card">'
          +'<div class="phf-comp-grid">'
            +'<div class="phf-comp-fact"><b>Trạng thái</b><span>'+esc(statusLabel(c.status))+'</span></div>'
            +'<div class="phf-comp-fact"><b>Công bố</b><span>'+(c.publicationState==='published'?'Đã công bố':'Nội bộ')+'</span></div>'
            +'<div class="phf-comp-fact"><b>Mức duyệt</b><span>'+(c.levelsFrozen?'Đã khóa':'Còn mở')+'</span></div>'
          +'</div>'
          +'<div class="phf-comp-actions" style="padding-top:14px" data-comp-lifecycle>'
            +(c.status==='draft'?'<button type="button" class="phf-comp-btn" data-comp-status="accepting">Mở nhận bài</button>':'')
            +(c.status==='accepting'?'<button type="button" class="phf-comp-btn" data-comp-status="reviewing">Chuyển sang xét duyệt</button>':'')
            +(c.status==='reviewing'?'<button type="button" class="phf-comp-btn" data-comp-status="finalized">Chốt chương trình</button>':'')
          +'</div>'
        +'</div>';
      }
      body.innerHTML=html;
      wireCampaignSelect(body,renderList);
      var lc=body.querySelector('[data-comp-lifecycle]');
      if(lc)lc.querySelectorAll('[data-comp-status]').forEach(function(btn){
        btn.addEventListener('click',async function(){
          btn.disabled=true;
          try{await call('competitionChangeCampaignStatus',{campaign_id:c.id,target_status:btn.getAttribute('data-comp-status')});toast('success','Đã cập nhật','Trạng thái chương trình đã thay đổi.');renderList();}
          catch(e){toast('error','Không cập nhật được',e.message);btn.disabled=false;}
        });
      });
    }catch(e){body.innerHTML=errorState(e);wireRetrySingle(body,renderList);}
  }
  await renderList();
  var createBox=slot.querySelector('[data-comp-create]');
  createBox.innerHTML='<div class="phf-comp-field"><label>Mã chương trình<span class="req">*</span></label><input type="text" data-c="code" placeholder="vd. cau-hoi-kh-2026-10"></div>'
    +'<div class="phf-comp-field"><label>Tên chương trình<span class="req">*</span></label><input type="text" data-c="title"></div>'
    +'<div class="phf-comp-field"><label>Mô tả</label><textarea data-c="description"></textarea></div>'
    +'<div class="phf-comp-field"><label>Số nội dung tối thiểu / tháng</label><input type="text" data-c="min"></div>'
    +'<div class="phf-comp-actions"><button type="button" class="phf-comp-btn" data-comp-create-btn>+ Tạo chương trình</button></div>';
  createBox.querySelector('[data-comp-create-btn]').addEventListener('click',async function(){
    var btn=this;btn.disabled=true;
    var code=createBox.querySelector('[data-c="code"]').value.trim();
    var title=createBox.querySelector('[data-c="title"]').value.trim();
    if(!code||!title){toast('error','Thiếu thông tin','Cần mã và tên chương trình.');btn.disabled=false;return;}
    try{
      var created=await call('competitionCreateCampaignDraft',{code:code,title:title,
        description:createBox.querySelector('[data-c="description"]').value.trim(),
        min_required_contributions:createBox.querySelector('[data-c="min"]').value.trim()||null});
      ADMIN_SELECTED_CAMPAIGN_ID=created.id;
      toast('success','Đã tạo','Chương trình mới ở trạng thái nháp.');
      await renderList();
    }catch(e){toast('error','Không tạo được',e.message);}
    finally{btn.disabled=false;}
  });
}

async function screenAdminApproval(slot,boot){
  slot.innerHTML=heroHtml('Cấu hình các mức duyệt, điểm và người duyệt cho từng chương trình.')
    +'<section class="phf-comp-section" data-comp-body>'+loadingState()+'</section>';
  var body=slot.querySelector('[data-comp-body]');
  async function renderAll(){
    try{
      var picker=await adminCampaignPicker(boot);
      if(!picker.campaigns.length){body.innerHTML='<h2>'+icon('gear')+'Cài đặt xét duyệt</h2>'+emptyState('gear','Chưa có chương trình nào.','Tạo chương trình ở "Quản lý chương trình" trước.');return;}
      var c=picker.selected;
      var levels=await call('competitionListLevels',{campaign_id:c.id});
      var reviewers=await call('competitionListReviewerGrants',{campaign_id:c.id});
      var admins=await call('competitionListAdminGrants',{});
      var caps=await call('competitionListCapabilityGrants',{capability:'view_participation_progress'});
      body.innerHTML=campaignSelectHtml(picker.campaigns,ADMIN_SELECTED_CAMPAIGN_ID)
        +levelSectionHtml(c,levels)
        +reviewerSectionHtml(c,reviewers,levels)
        +adminGrantSectionHtml(admins)
        +capabilityGrantSectionHtml(caps);
      wireCampaignSelect(body,renderAll);
      wireLevelSection(body,c,renderAll);
      wireReviewerSection(body,c,renderAll);
      wireAdminGrantSection(body,renderAll);
      wireCapabilityGrantSection(body,renderAll);
    }catch(e){body.innerHTML=errorState(e);wireRetrySingle(body,renderAll);}
  }
  await renderAll();
}
function levelSectionHtml(c,levels){
  return '<section class="phf-comp-section"><h2>'+icon('gear')+'Mức duyệt — '+esc(c.title)+'</h2>'
    +'<div class="phf-comp-card">'
      +(c.levelsFrozen?'<span class="phf-comp-freeze">'+icon('lock')+'Chương trình đã bắt đầu nhận bài: sửa mức cần lý do (điều chỉnh ngoại lệ, có audit)</span>':'')
      +'<div class="phf-comp-table-wrap" style="margin-top:12px"><table class="phf-comp-table">'
        +'<thead><tr><th>Thứ tự</th><th>Tên mức</th><th>Điểm</th><th>SLA (giờ)</th><th></th></tr></thead><tbody>'
        +(levels.length?levels.map(function(l){
          return '<tr data-level-id="'+esc(l.id)+'"><td data-th="Thứ tự">Mức '+esc(l.levelOrder)+'</td>'
            +'<td data-th="Tên mức"><input type="text" data-lvl="name" value="'+esc(l.name)+'"></td>'
            +'<td data-th="Điểm"><input type="text" data-lvl="score" value="'+esc(l.score)+'" style="width:70px"></td>'
            +'<td data-th="SLA"><input type="text" data-lvl="sla" value="'+esc(l.slaHours||'')+'" style="width:60px"></td>'
            +'<td><button type="button" class="phf-comp-btn is-ghost" data-comp-save-level style="padding:6px 10px;font-size:12px">Lưu</button></td></tr>';
        }).join(''):'<tr><td colspan="5" style="border:0;padding:0">'+emptyState('gear','Chưa có mức duyệt nào.')+'</td></tr>')
      +'</tbody></table></div>'
      +(!c.levelsFrozen?'<div class="phf-comp-actions" style="padding-top:14px"><input type="text" data-new-level-name placeholder="Tên mức mới" style="max-width:200px"><input type="text" data-new-level-order placeholder="Thứ tự" style="max-width:80px"><input type="text" data-new-level-score placeholder="Điểm" style="max-width:80px"><button type="button" class="phf-comp-btn" data-comp-add-level>+ Thêm mức</button></div>':'')
    +'</div>'
  +'</section>';
}
function wireLevelSection(body,c,refresh){
  body.querySelectorAll('[data-comp-save-level]').forEach(function(btn){
    btn.addEventListener('click',async function(){
      var row=btn.closest('tr');var id=row.getAttribute('data-level-id');
      var name=row.querySelector('[data-lvl="name"]').value.trim();
      var score=row.querySelector('[data-lvl="score"]').value.trim();
      var sla=row.querySelector('[data-lvl="sla"]').value.trim();
      var reason=c.levelsFrozen?window.prompt('Chương trình đã khóa mức duyệt — nhập lý do điều chỉnh ngoại lệ:'):'';
      if(c.levelsFrozen&&!reason){return;}
      btn.disabled=true;
      try{
        await call('competitionUpsertLevel',{campaign_id:c.id,level_id:id,name:name,score:score,sla_hours:sla||null,exceptional_correction:!!c.levelsFrozen,reason:reason||undefined});
        toast('success','Đã lưu','Mức duyệt đã cập nhật.');refresh();
      }catch(e){toast('error','Không lưu được',e.message);btn.disabled=false;}
    });
  });
  var addBtn=body.querySelector('[data-comp-add-level]');
  if(addBtn)addBtn.addEventListener('click',async function(){
    var name=body.querySelector('[data-new-level-name]').value.trim();
    var order=body.querySelector('[data-new-level-order]').value.trim();
    var score=body.querySelector('[data-new-level-score]').value.trim();
    if(!name||!order||!score){toast('error','Thiếu thông tin','Cần tên, thứ tự và điểm.');return;}
    addBtn.disabled=true;
    try{await call('competitionUpsertLevel',{campaign_id:c.id,level_order:order,name:name,score:score});toast('success','Đã thêm mức duyệt','');refresh();}
    catch(e){toast('error','Không thêm được',e.message);addBtn.disabled=false;}
  });
}
function reviewerSectionHtml(c,reviewers,levels){
  var maxOpts=levels.map(function(l){return '<option value="'+l.levelOrder+'">Mức '+l.levelOrder+' · '+esc(l.name)+'</option>';}).join('');
  return '<section class="phf-comp-section"><h2>'+icon('users')+'Người duyệt — '+esc(c.title)+'</h2>'
    +'<div class="phf-comp-card">'
      +(reviewers.length?'<div class="phf-comp-table-wrap"><table class="phf-comp-table"><thead><tr><th>Mã NV</th><th>Mức tối đa</th><th>Trạng thái</th><th></th></tr></thead><tbody>'
        +reviewers.map(function(r){
          return '<tr><td data-th="Mã NV">'+esc(r.employeeCode)+(r.displayName?' · '+esc(r.displayName):'')+'</td>'
            +'<td data-th="Mức tối đa">Mức '+esc(r.maxLevelOrder)+'</td>'
            +'<td data-th="Trạng thái">'+(r.isActive?'Đang hoạt động':'Đã thu hồi')+'</td>'
            +'<td>'+(r.isActive?'<button type="button" class="phf-comp-btn is-ghost" data-comp-revoke-reviewer="'+esc(r.accountId)+'" style="padding:6px 10px;font-size:12px">Thu hồi</button>':'')+'</td></tr>';
        }).join('')+'</tbody></table></div>'
        :emptyState('users','Chưa có người duyệt nào được cấp quyền.'))
      +'<div class="phf-comp-actions" style="padding-top:14px;flex-wrap:wrap">'
        +'<input type="text" data-new-rev-acc placeholder="account_id" style="max-width:160px">'
        +'<input type="text" data-new-rev-emp placeholder="employee_code" style="max-width:140px">'
        +'<select data-new-rev-level>'+maxOpts+'</select>'
        +'<button type="button" class="phf-comp-btn" data-comp-add-reviewer>+ Cấp quyền duyệt</button>'
      +'</div>'
      +'<div class="phf-comp-note">'+icon('info')+'<span>Danh sách người duyệt sẽ lấy từ Trung tâm Quản trị nhân sự (chỉ tài khoản & nhân sự đang hoạt động) khi màn chọn nhân sự được bổ sung — hiện nhập trực tiếp mã.</span></div>'
    +'</div>'
  +'</section>';
}
function wireReviewerSection(body,c,refresh){
  var addBtn=body.querySelector('[data-comp-add-reviewer]');
  if(addBtn)addBtn.addEventListener('click',async function(){
    var acc=body.querySelector('[data-new-rev-acc]').value.trim();
    var emp=body.querySelector('[data-new-rev-emp]').value.trim();
    var lvl=body.querySelector('[data-new-rev-level]').value;
    if(!acc&&!emp){toast('error','Thiếu thông tin','Cần account_id hoặc employee_code.');return;}
    addBtn.disabled=true;
    try{await call('competitionSetReviewerGrant',{campaign_id:c.id,account_id:acc,employee_code:emp,max_level_order:lvl});toast('success','Đã cấp quyền','');refresh();}
    catch(e){toast('error','Không cấp được',e.message);addBtn.disabled=false;}
  });
  body.querySelectorAll('[data-comp-revoke-reviewer]').forEach(function(btn){
    btn.addEventListener('click',async function(){
      var reason=window.prompt('Lý do thu hồi quyền duyệt:');if(!reason){return;}
      btn.disabled=true;
      try{await call('competitionSetReviewerGrant',{campaign_id:c.id,account_id:btn.getAttribute('data-comp-revoke-reviewer'),active:false,reason:reason});toast('success','Đã thu hồi','');refresh();}
      catch(e){toast('error','Không thu hồi được',e.message);btn.disabled=false;}
    });
  });
}
function adminGrantSectionHtml(admins){
  return '<section class="phf-comp-section"><h2>'+icon('users')+'Competition Admin</h2><div class="phf-comp-card">'
    +(admins.length?'<div class="phf-comp-table-wrap"><table class="phf-comp-table"><thead><tr><th>Mã NV</th><th>Trạng thái</th><th></th></tr></thead><tbody>'
      +admins.map(function(a){return '<tr><td data-th="Mã NV">'+esc(a.employeeCode)+(a.displayName?' · '+esc(a.displayName):'')+'</td><td data-th="Trạng thái">'+(a.isActive?'Đang hoạt động':'Đã thu hồi')+'</td>'
        +'<td>'+(a.isActive?'<button type="button" class="phf-comp-btn is-ghost" data-comp-revoke-admin="'+esc(a.accountId)+'" style="padding:6px 10px;font-size:12px">Thu hồi</button>':'')+'</td></tr>';}).join('')
      +'</tbody></table></div>':emptyState('users','Chưa có Competition Admin bổ sung nào.'))
    +'<div class="phf-comp-actions" style="padding-top:14px;flex-wrap:wrap">'
      +'<input type="text" data-new-adm-acc placeholder="account_id" style="max-width:160px">'
      +'<input type="text" data-new-adm-emp placeholder="employee_code" style="max-width:140px">'
      +'<input type="text" data-new-adm-reason placeholder="Lý do cấp quyền" style="max-width:220px">'
      +'<button type="button" class="phf-comp-btn" data-comp-add-admin>+ Cấp quyền Admin</button>'
    +'</div>'
    +'<div class="phf-comp-note">'+icon('info')+'<span>Admin hệ thống PHF tự động có toàn quyền Competition Admin. Đây là cấp bổ sung cho nhân sự cụ thể.</span></div>'
  +'</div></section>';
}
function wireAdminGrantSection(body,refresh){
  var addBtn=body.querySelector('[data-comp-add-admin]');
  if(addBtn)addBtn.addEventListener('click',async function(){
    var acc=body.querySelector('[data-new-adm-acc]').value.trim();
    var emp=body.querySelector('[data-new-adm-emp]').value.trim();
    var reason=body.querySelector('[data-new-adm-reason]').value.trim();
    if((!acc&&!emp)||!reason){toast('error','Thiếu thông tin','Cần mã định danh và lý do.');return;}
    addBtn.disabled=true;
    try{await call('competitionSetAdminGrant',{account_id:acc,employee_code:emp,reason:reason});toast('success','Đã cấp quyền Admin','');refresh();}
    catch(e){toast('error','Không cấp được',e.message);addBtn.disabled=false;}
  });
  body.querySelectorAll('[data-comp-revoke-admin]').forEach(function(btn){
    btn.addEventListener('click',async function(){
      var reason=window.prompt('Lý do thu hồi quyền Admin:');if(!reason){return;}
      btn.disabled=true;
      try{await call('competitionSetAdminGrant',{account_id:btn.getAttribute('data-comp-revoke-admin'),active:false,reason:reason});toast('success','Đã thu hồi','');refresh();}
      catch(e){toast('error','Không thu hồi được',e.message);btn.disabled=false;}
    });
  });
}
function capabilityGrantSectionHtml(caps){
  return '<section class="phf-comp-section"><h2>'+icon('users')+'Quyền xem tiến độ tham gia toàn công ty</h2><div class="phf-comp-card">'
    +(caps.length?'<div class="phf-comp-table-wrap"><table class="phf-comp-table"><thead><tr><th>Mã NV</th><th>Trạng thái</th><th></th></tr></thead><tbody>'
      +caps.map(function(a){return '<tr><td data-th="Mã NV">'+esc(a.employeeCode)+(a.displayName?' · '+esc(a.displayName):'')+'</td><td data-th="Trạng thái">'+(a.isActive?'Đang hoạt động':'Đã thu hồi')+'</td>'
        +'<td>'+(a.isActive?'<button type="button" class="phf-comp-btn is-ghost" data-comp-revoke-cap="'+esc(a.accountId)+'" style="padding:6px 10px;font-size:12px">Thu hồi</button>':'')+'</td></tr>';}).join('')
      +'</tbody></table></div>':emptyState('users','Chưa có ai được cấp quyền xem tiến độ toàn công ty.'))
    +'<div class="phf-comp-actions" style="padding-top:14px;flex-wrap:wrap">'
      +'<input type="text" data-new-cap-acc placeholder="account_id" style="max-width:160px">'
      +'<input type="text" data-new-cap-emp placeholder="employee_code" style="max-width:140px">'
      +'<button type="button" class="phf-comp-btn" data-comp-add-cap>+ Cấp quyền</button>'
    +'</div>'
    +'<div class="phf-comp-note">'+icon('info')+'<span>Quyền này KHÔNG cấp quyền xét duyệt và không gắn với phòng ban.</span></div>'
  +'</div></section>';
}
function wireCapabilityGrantSection(body,refresh){
  var addBtn=body.querySelector('[data-comp-add-cap]');
  if(addBtn)addBtn.addEventListener('click',async function(){
    var acc=body.querySelector('[data-new-cap-acc]').value.trim();
    var emp=body.querySelector('[data-new-cap-emp]').value.trim();
    if(!acc&&!emp){toast('error','Thiếu thông tin','Cần mã định danh.');return;}
    addBtn.disabled=true;
    try{await call('competitionSetCapabilityGrant',{capability:'view_participation_progress',account_id:acc,employee_code:emp});toast('success','Đã cấp quyền','');refresh();}
    catch(e){toast('error','Không cấp được',e.message);addBtn.disabled=false;}
  });
  body.querySelectorAll('[data-comp-revoke-cap]').forEach(function(btn){
    btn.addEventListener('click',async function(){
      var reason=window.prompt('Lý do thu hồi:');if(!reason){return;}
      btn.disabled=true;
      try{await call('competitionSetCapabilityGrant',{capability:'view_participation_progress',account_id:btn.getAttribute('data-comp-revoke-cap'),active:false,reason:reason});toast('success','Đã thu hồi','');refresh();}
      catch(e){toast('error','Không thu hồi được',e.message);btn.disabled=false;}
    });
  });
}

async function screenAdminFinalize(slot,boot){
  slot.innerHTML=heroHtml('Kiểm tra, xem kết quả nội bộ và chốt chương trình để công bố.')
    +'<section class="phf-comp-section" data-comp-body>'+loadingState()+'</section>';
  var body=slot.querySelector('[data-comp-body]');
  async function renderAll(){
    try{
      var picker=await adminCampaignPicker(boot);
      if(!picker.campaigns.length){body.innerHTML='<h2>'+icon('seal')+'Chốt chương trình</h2>'+emptyState('seal','Chưa có chương trình nào.');return;}
      var c=picker.selected;
      var queue=await call('competitionGetReviewQueue',{campaign_id:c.id});
      var lb=await call('competitionGetLeaderboard',{campaign_id:c.id});
      var awards=await call('competitionListAwards',{campaign_id:c.id});
      var cand=null;try{cand=await call('competitionGetAutoAwardCandidate',{campaign_id:c.id,top_n:5});}catch(e){}
      body.innerHTML=campaignSelectHtml(picker.campaigns,ADMIN_SELECTED_CAMPAIGN_ID)
        +'<h2>'+icon('seal')+'Chốt chương trình — '+esc(c.title)+'</h2>'
        +'<div class="phf-comp-grid">'
          +'<div class="phf-comp-fact"><b>Bài còn chờ duyệt</b><span>'+esc((queue.items||[]).length)+'</span></div>'
          +'<div class="phf-comp-fact"><b>Trạng thái chương trình</b><span>'+esc(statusLabel(c.status))+'</span></div>'
          +'<div class="phf-comp-fact"><b>Trạng thái công bố</b><span>'+(c.publicationState==='published'?'Đã công bố':'Nội bộ')+'</span></div>'
          +'<div class="phf-comp-fact"><b>Chốt lúc</b><span>'+esc(fmtDate(c.finalizedAt))+'</span></div>'
        +'</div>'
        +'<div class="phf-comp-card" style="margin-top:14px"><b style="font-size:13px">Bảng xếp hạng nội bộ</b>'
          +(lb.rows&&lb.rows.length?'<div class="phf-comp-table-wrap" style="margin-top:10px"><table class="phf-comp-table"><thead><tr><th>Hạng</th><th>Nhân sự</th><th>Điểm</th></tr></thead><tbody>'
            +lb.rows.map(function(r){return '<tr><td data-th="Hạng">#'+esc(r.rank)+'</td><td data-th="Nhân sự">'+esc(r.displayName||r.alias)+'</td><td data-th="Điểm">'+esc(r.totalScore)+'</td></tr>';}).join('')+'</tbody></table></div>'
            :emptyState('trophy','Chưa có dữ liệu xếp hạng.'))
        +'</div>'
        +'<div class="phf-comp-card" style="margin-top:14px"><b style="font-size:13px">Giải thưởng</b>'
          +(cand&&cand.candidate?'<p style="font-size:12.5px;margin:8px 0">Ứng viên giải tự động: <b>'+esc(cand.candidate.displayName||cand.candidate.employeeCode)+'</b> ('+esc(cand.candidate.totalScore)+' điểm)'+(cand.needsAdminDecision?' — <span style="color:#8a6a2c">cần Admin quyết định do hòa</span>':'')+'</p>':'')
          +(awards.length?'<div class="phf-comp-table-wrap"><table class="phf-comp-table"><thead><tr><th>Loại</th><th>Người nhận</th><th>Số tiền</th><th>Trạng thái</th><th></th></tr></thead><tbody>'
            +awards.map(function(a){return '<tr><td data-th="Loại">'+(a.awardType==='auto'?'Tự động':'Giá trị')+'</td><td data-th="Người nhận">'+esc(a.recipientDisplayName||a.recipientEmployeeCode)+'</td>'
              +'<td data-th="Số tiền">'+esc(Number(a.amountVnd).toLocaleString('vi-VN'))+' đ</td><td data-th="Trạng thái">'+esc(a.status)+'</td>'
              +'<td>'+(a.status==='proposed'?'<button type="button" class="phf-comp-btn is-ghost" data-comp-confirm-award="'+esc(a.id)+'" style="padding:6px 10px;font-size:12px">Xác nhận</button>':'')+'</td></tr>';}).join('')+'</tbody></table></div>'
            :emptyState('medal','Chưa có giải thưởng nào được đề xuất.'))
          +'<div class="phf-comp-actions" style="padding-top:14px;flex-wrap:wrap">'
            +'<button type="button" class="phf-comp-btn is-ghost" data-comp-propose-auto'+(cand&&cand.candidate?'':' disabled')+'>Đề xuất giải tự động cho hạng 1</button>'
          +'</div>'
        +'</div>'
        +'<div class="phf-comp-note">'+icon('lock')+'<span>Danh tính và danh sách bài dự thi chỉ được công khai sau khi chương trình được chốt và bật công bố.</span></div>'
        +'<div class="phf-comp-actions" data-comp-finalize-actions>'
          +'<button type="button" class="phf-comp-btn is-ghost" data-comp-finalize-subs'+(c.status==='reviewing'?'':' disabled')+'>Chốt danh sách bài đã duyệt</button>'
          +'<button type="button" class="phf-comp-btn" data-comp-publish'+(c.status==='finalized'&&c.publicationState!=='published'?'':' disabled')+'>Chốt & công bố</button>'
        +'</div>';
      wireCampaignSelect(body,renderAll);
      var proposeBtn=body.querySelector('[data-comp-propose-auto]');
      if(proposeBtn)proposeBtn.addEventListener('click',async function(){
        proposeBtn.disabled=true;
        try{
          await call('competitionProposeAward',{campaign_id:c.id,award_type:'auto',recipient_account_id:cand.candidate.accountId,recipient_employee_code:cand.candidate.employeeCode,recipient_display_name:cand.candidate.displayName,rank_basis:1});
          toast('success','Đã đề xuất giải','');renderAll();
        }catch(e){toast('error','Không đề xuất được',e.message);proposeBtn.disabled=false;}
      });
      body.querySelectorAll('[data-comp-confirm-award]').forEach(function(btn){
        btn.addEventListener('click',async function(){
          btn.disabled=true;
          try{await call('competitionConfirmAward',{campaign_id:c.id,award_id:btn.getAttribute('data-comp-confirm-award')});toast('success','Đã xác nhận giải','');renderAll();}
          catch(e){toast('error','Không xác nhận được',e.message);btn.disabled=false;}
        });
      });
      var finBtn=body.querySelector('[data-comp-finalize-subs]');
      if(finBtn)finBtn.addEventListener('click',async function(){
        finBtn.disabled=true;
        try{
          await call('competitionFinalizeCampaignSubmissions',{campaign_id:c.id,force:true});
          await call('competitionChangeCampaignStatus',{campaign_id:c.id,target_status:'finalized'});
          toast('success','Đã chốt chương trình','');renderAll();
        }catch(e){toast('error','Không chốt được',e.message);finBtn.disabled=false;}
      });
      var pubBtn=body.querySelector('[data-comp-publish]');
      if(pubBtn)pubBtn.addEventListener('click',async function(){
        pubBtn.disabled=true;
        try{await call('competitionPublishCampaign',{campaign_id:c.id});toast('success','Đã công bố','Kết quả đã công khai.');renderAll();}
        catch(e){toast('error','Không công bố được',e.message);pubBtn.disabled=false;}
      });
    }catch(e){body.innerHTML=errorState(e);wireRetrySingle(body,renderAll);}
  }
  await renderAll();
}

var RENDERERS={
  'tong-quan':screenOverview,'bang-tin':screenFeed,'bai-cua-toi':screenMySubmissions,'gui':screenSubmitForm,
  'ket-qua':screenLeaderboard,'cho-duyet':screenReviewQueue,'da-duyet':screenMyReviewed,
  'quan-ly':screenAdminCampaigns,'xet-duyet':screenAdminApproval,'chot':screenAdminFinalize
};

window.phfRenderCompetition=async function(requestedPath){
  var actual=String((window.location&&window.location.pathname)||'/').split('?')[0].split('#')[0].replace(/\/{2,}/g,'/');
  if(actual.length>1)actual=actual.replace(/\/$/,'');
  var main=document.getElementById('phfHrRoot');
  if(!main)return false;
  document.body.classList.add('phf-hr-gateway-mode');

  var key=screenForPath(requestedPath||actual);

  ADMIN_SELECTED_CAMPAIGN_ID=null; // fresh per navigation — never carried across screens implicitly

  /* Shell renders immediately, but the nav is a loading placeholder and the
   * content slot is a loading placeholder too — admin/reviewer menu items
   * and admin/reviewer DATA must never appear before server authority
   * (competitionBootstrap.capabilities) has actually resolved. */
  main.innerHTML='<div class="phf-comp"><div class="phf-comp-shell">'
    +'<header class="phf-comp-top">'
      +'<img src="assets/logo/phf-logo.png" alt="PHUHOA FRESH" class="phf-comp-logo" width="152" height="32" decoding="async">'
      +'<span class="phf-comp-brand-rule" aria-hidden="true"></span>'
      +'<span class="phf-comp-brand"><b>Chương trình thi đua</b><small>PHF HR</small></span>'
      +'<span class="phf-comp-top-tag">DEV · dữ liệu thật trên phf_hr_e2e</span>'
      +compNotifWrapHtml()
    +'</header>'
    +'<div class="phf-comp-body" data-comp-nav-slot>'
      +navLoadingHtml()
      +'<div class="phf-comp-main" data-comp-slot>'+loadingState('Đang xác thực & tải dữ liệu…')+'</div>'
    +'</div>'
  +'</div></div>';

  function wireNavLinks(){
    main.querySelectorAll('[data-comp-nav]').forEach(function(a){
      a.addEventListener('click',function(e){
        if(e.metaKey||e.ctrlKey||e.shiftKey||e.button===1)return;
        e.preventDefault();go(a.getAttribute('data-comp-nav'));
      });
    });
  }
  main.addEventListener('click',function(e){
    var b=e.target&&e.target.closest?e.target.closest('[data-comp-go]'):null;
    if(b&&main.contains(b)){go(b.getAttribute('data-comp-go'));return;}
  });
  main.addEventListener('click',async function(e){
    var btn=e.target&&e.target.closest?e.target.closest('[data-comp-react]'):null;
    if(!btn||!main.contains(btn))return;
    e.preventDefault();
    var submissionId=btn.getAttribute('data-submission-id');
    var wasOn=btn.getAttribute('aria-pressed')==='true';
    btn.disabled=true;
    try{
      var res=await call('competitionSetReaction',{submission_id:submissionId,on:!wasOn});
      btn.setAttribute('aria-pressed',res.viewerReacted?'true':'false');
      btn.classList.toggle('is-on',!!res.viewerReacted);
      var lbl=btn.querySelector('.rx-label');if(lbl)lbl.textContent=res.viewerReacted?'Đã thả tim':'Thả tim';
      var cnt=btn.querySelector('[data-rx-count]');if(cnt)cnt.textContent=String(res.reactionTotal);
    }catch(err){toast('error','Không thả tim được',err.message);}
    finally{btn.disabled=false;}
  });
  main.addEventListener('click',function(e){
    var t=e.target;
    if(t&&t.closest&&t.closest('[data-comp-notif-toggle]')){
      e.stopPropagation();
      compNotif.open=!compNotif.open;renderCompNotif(main);
      if(compNotif.open)loadCompNotifications(main,true);
      return;
    }
    if(t&&t.closest&&t.closest('[data-comp-notif-retry]')){
      e.stopPropagation();compNotif.error=false;renderCompNotif(main);loadCompNotifications(main,true);return;
    }
    if(t&&t.closest&&t.closest('[data-comp-notif-mark-all]')){
      e.stopPropagation();
      compNotif.items.forEach(function(it){it.status='read';});
      compNotif.unread=0;renderCompNotif(main);
      call('competitionMarkAllNotificationsRead',{}).catch(function(){});
      return;
    }
    var item=t&&t.closest?t.closest('[data-comp-notif-item]'):null;
    if(item){
      e.stopPropagation();
      var nId=item.getAttribute('data-comp-notif-item');
      var screenKey=item.getAttribute('data-comp-notif-screen')||'bai-cua-toi';
      var it=compNotif.items.filter(function(x){return x.id===nId;})[0];
      if(it&&it.status==='unread'){it.status='read';compNotif.unread=Math.max(0,compNotif.unread-1);}
      compNotif.open=false;renderCompNotif(main);
      call('competitionMarkNotificationRead',{id:nId}).catch(function(){});
      go(prefix()+'/thi-dua/'+screenKey);
      return;
    }
  });
  bindCompNotifOutsideClick();

  var navSlot=main.querySelector('[data-comp-nav-slot]');
  var slot=main.querySelector('[data-comp-slot]');
  var boot;
  try{
    boot=await call('competitionBootstrap',{});
  }catch(err){
    /* Authority unknown — fail closed. Nav stays participant-only (the
     * least-privilege default from menuModel(null)), never guesses admin/
     * reviewer visibility from a failed bootstrap. */
    var nav=navSlot.querySelector('nav');
    if(nav)nav.outerHTML=navHtml(null,key);
    wireNavLinks();
    slot.innerHTML=errorState(err,'Thử lại');
    wireRetrySingle(slot,function(){window.phfRenderCompetition(requestedPath);});
    document.title='Chương trình thi đua · PHF HR';
    return true;
  }

  /* Server-authoritative deep-link guard — decided ONLY from
   * boot.capabilities, never from the URL namespace, never from title/
   * department/branch. An unauthorized deep link is redirected to the
   * module home in the SAME namespace before any admin/reviewer fetch runs. */
  if(!isScreenAuthorized(key,boot)){
    key='tong-quan';
    var home=prefix()+'/thi-dua';
    if(actual!==home && window.phfNavigate){window.phfNavigate(home);return true;}
  }

  var navEl=navSlot.querySelector('nav');
  if(navEl)navEl.outerHTML=navHtml(boot,key);
  wireNavLinks();
  loadCompNotifications(main,false);

  var renderer=RENDERERS[key]||screenOverview;
  try{
    await renderer(slot,boot);
  }catch(err){
    slot.innerHTML=errorState(err,'Thử lại');
    wireRetrySingle(slot,function(){window.phfRenderCompetition(requestedPath);});
  }

  document.title='Chương trình thi đua · PHF HR';
  try{window.scrollTo({top:0,behavior:'instant'});}catch(e){window.scrollTo(0,0);}
  return true;
};

/* Offline test hook — inert at runtime (no data, no DOM effect). */
window.__phfCompetitionTestHooks={
  menuModel:menuModel, screenForPath:screenForPath, screenKeys:Object.keys(RENDERERS),
  feedPostHtml:feedPostHtml, competitionErrorMessage:competitionErrorMessage, statusLabel:statusLabel
};
})();
