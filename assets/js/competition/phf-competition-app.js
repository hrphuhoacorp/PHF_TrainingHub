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
    warn:'<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v5M12 17h.01"/>',
    home:'<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(p[type]||'')+'</svg>';
}

var SUBMISSION_STATUSES=[
  {k:'draft',label:'Nháp'},{k:'submitted',label:'Chờ duyệt'},{k:'needs_revision',label:'Cần chỉnh sửa'},
  {k:'approved',label:'Đã duyệt'},{k:'rejected',label:'Từ chối'},{k:'finalized',label:'Đã chốt'}
];
// Campaign status is a SEPARATE enum from submission status (draft/accepting/
// reviewing/finalized vs draft/submitted/needs_revision/approved/rejected/
// finalized) — 'draft' and 'finalized' happen to share the same Vietnamese
// wording, but 'accepting'/'reviewing' have no submission-status equivalent
// and were falling through to the raw English enum value before this map
// existed (visible in "Thể lệ chương trình" and the admin campaign screens).
var CAMPAIGN_STATUSES=[
  {k:'draft',label:'Nháp'},{k:'accepting',label:'Đang nhận bài'},{k:'reviewing',label:'Đang xét duyệt'},{k:'finalized',label:'Đã chốt'}
];
var AWARD_STATUSES=[
  {k:'proposed',label:'Đã đề xuất'},{k:'confirmed',label:'Đã xác nhận'},{k:'superseded',label:'Đã thay thế'},{k:'revoked',label:'Đã thu hồi'}
];
function statusLabel(k){
  var s=SUBMISSION_STATUSES.filter(function(x){return x.k===k;})[0]||CAMPAIGN_STATUSES.filter(function(x){return x.k===k;})[0];
  return s?s.label:(k||'—');
}
function awardStatusLabel(k){var s=AWARD_STATUSES.filter(function(x){return x.k===k;})[0];return s?s.label:(k||'—');}
function statusPill(k){return '<span class="phf-comp-pill" data-s="'+esc(k)+'">'+esc(statusLabel(k))+'</span>';}

/* C4.3 — Chương trình thi đua contribution = QUESTION + ANSWER, always both.
 * Every screen that shows submission content (Feed / Bài của tôi / Chờ duyệt)
 * MUST render both fields — never just customer_question. A payload missing
 * one side (only possible for a submission created under a different/older
 * form shape — none exist in current data, but this stays honest rather than
 * fabricating content) shows an explicit "chưa có nội dung" line instead of
 * silently dropping the field or inventing text. maxLen truncates each field
 * independently (list previews), omit for full detail views. */
/* V1.2 — "Kết quả thực tế / Ghi nhận" (participant-written, payload.actual_result)
 * is a THIRD, OPTIONAL field — distinct from the reviewer's own "Kết quả /
 * Ghi nhận của giám khảo" (see reviewerRecordHtml below, review workflow
 * only). Backward-compatible by construction: it lives in the existing
 * payload jsonb, so older submissions without this key simply render the
 * honest "chưa ghi nhận" empty state below — never the "bài gửi trước khi
 * biểu mẫu cập nhật" missing-field message, which stays reserved for the
 * genuinely-required customer_question/answer fields only. */
function qaFieldsHtml(payload,maxLen){
  var p=payload||{};
  var q=p.customer_question;
  var a=p.answer;
  var r=p.actual_result;
  function val(v){
    if(v==null||String(v).trim()==='')return '<span class="phf-comp-qa-missing">Chưa có nội dung (bài được gửi trước khi biểu mẫu được cập nhật).</span>';
    var s=String(v);
    return esc(maxLen?s.slice(0,maxLen):s);
  }
  function resultVal(v){
    if(v==null||String(v).trim()==='')return '<span class="phf-comp-qa-missing">Chưa ghi nhận kết quả.</span>';
    var s=String(v);
    return esc(maxLen?s.slice(0,maxLen):s);
  }
  return '<div class="phf-comp-qa">'
    +'<div class="phf-comp-qa-block"><span class="phf-comp-qa-label">Câu hỏi / tình huống khách hàng</span><p class="phf-comp-qa-text">'+val(q)+'</p></div>'
    +'<div class="phf-comp-qa-block"><span class="phf-comp-qa-label">Cách trả lời / xử lý</span><p class="phf-comp-qa-text">'+val(a)+'</p></div>'
    +'<div class="phf-comp-qa-block phf-comp-qa-result"><span class="phf-comp-qa-label">Kết quả thực tế / Ghi nhận</span><p class="phf-comp-qa-text">'+resultVal(r)+'</p></div>'
  +'</div>';
}

/* Reviewer's OWN assessment note — "Kết quả / Ghi nhận của giám khảo".
 * Backed by the EXISTING submissions.last_review_note / submission_history.
 * reason columns (same plumbing every review action already writes through —
 * see reviewAction in competition-submissions.js). No new table, no new
 * column: this is purely a UI relabel + making the field available on
 * EVERY review action (previously only prompted for reject/request_revision
 * via window.prompt). Never derives score from this text — score stays the
 * reviewer's separate 2đ/5đ/request_revision/reject decision. */
function reviewerRecordHtml(lastNote){
  return '<div class="phf-comp-field" data-comp-reviewer-record-wrap style="margin:12px 0">'
    +'<label>Kết quả / Ghi nhận của giám khảo</label>'
    +'<textarea data-comp-reviewer-record placeholder="Vì sao nội dung này hữu ích, kết quả xác nhận, ghi chú chất lượng…">'+esc(lastNote||'')+'</textarea>'
  +'</div>';
}

/* ---- shared render fragments ------------------------------------------ */
function emptyState(iconType,line,sub){
  return '<div class="phf-comp-empty">'+icon(iconType)+'<p>'+esc(line)+'</p>'
    +(sub?'<p class="phf-comp-em-sub">'+esc(sub)+'</p>':'')+'</div>';
}
function loadingState(label){
  return '<div class="phf-comp-loading">'+icon('sparkle')+'<span>'+esc(label||'Đang tải dữ liệu…')+'</span></div>';
}
// Round 2 — quiet skeleton instead of a technical sentence ("Đang tải
// quyền…", "Đang xác thực & tải dữ liệu…"). The shell (header/sidebar frame)
// already renders immediately with real content; only the content area
// itself needs a placeholder while data/authority resolves. Purely
// decorative shimmer bars — never implies data or authority that hasn't
// actually arrived (menu items and privileged sections are gated on the
// real boot.capabilities exactly as before; this only changes what the
// placeholder LOOKS like while waiting).
function skeletonHtml(widths){
  widths=widths||[92,68,80];
  return '<div class="phf-comp-skeleton" aria-hidden="true">'
    +widths.map(function(w){return '<div class="phf-comp-skeleton-bar" style="width:'+w+'%"></div>';}).join('')
  +'</div>';
}
function errorState(err,retryLabel){
  return '<div class="phf-comp-error" data-comp-error>'+icon('warn')
    +'<div><b>Không tải được dữ liệu</b><p>'+esc((err&&err.message)||'Đã có lỗi xảy ra.')+'</p></div>'
    +'<button type="button" class="phf-comp-btn is-ghost" data-comp-retry>'+esc(retryLabel||'Thử lại')+'</button></div>';
}
// Round 2 — the campaign NAME is the H1 (not the generic module label
// repeated on every screen). "Chương trình thi đua" moves down to a small
// eyebrow line, alongside a period derived from campaign data (never
// hardcoded). A leading "[...]" bracket tag (DEV fixture prefix, e.g.
// "[Operator Review]") is stripped for END-USER presentation only — the
// underlying campaign.title/code in the DB is untouched.
function campaignDisplayTitle(campaign){
  var raw=(campaign&&campaign.title)?String(campaign.title):'';
  var stripped=raw.replace(/^\s*\[[^\]]*\]\s*/,'').trim();
  return stripped||'Chương trình thi đua';
}
function campaignPeriodLabel(campaign){
  var src=campaign&&(campaign.submissionStartsAt||campaign.createdAt);
  if(!src)return 'Chương trình thi đua PHF';
  try{
    var d=new Date(src);
    if(isNaN(d.getTime()))return 'Chương trình thi đua PHF';
    return 'Chương trình thi đua PHF · Tháng '+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();
  }catch(e){return 'Chương trình thi đua PHF';}
}
function heroHtml(campaign,sub){
  return '<section class="phf-comp-hero">'
    +'<span class="phf-comp-eyebrow">'+esc(campaignPeriodLabel(campaign))+'</span>'
    +'<h1>'+esc(campaignDisplayTitle(campaign))+'</h1>'
    +'<p>'+esc(sub||'Ghi nhận đóng góp của nhân sự PHF một cách công bằng — nộp nội dung, xét duyệt ẩn danh, xếp hạng và vinh danh sau khi chốt.')+'</p>'
    +'</section>';
}
// Admin tools (Quản lý / Phân quyền / Chốt) are an operational surface, not
// the social/recognition one — a plainer, quieter header instead of the
// warm participant-facing hero (same brand tokens, no gold-fleck decoration
// or "Ghi nhận đóng góp" framing).
function adminHeroHtml(title,sub){
  return '<section class="phf-comp-admin-hero">'
    +'<span class="phf-comp-eyebrow">Quản trị chương trình</span>'
    +'<h1>'+esc(title)+'</h1>'
    +(sub?'<p>'+esc(sub)+'</p>':'')
    +'</section>';
}
function levelChipsHtml(levels){
  if(!levels||!levels.length)return '<p class="phf-comp-em-sub" style="margin-top:6px">Chưa có mức duyệt được cấu hình.</p>';
  return '<div class="phf-comp-levels">'+levels.map(function(l){
    return '<span class="phf-comp-level"><span class="lv-order">Mức '+esc(l.levelOrder)+'</span>'
      +'<span class="lv-name">'+esc(l.name)+'</span>'
      +'<span class="lv-score">'+esc(l.score)+' điểm</span>'
      +(l.slaHours?'<span class="lv-order">Thời gian xử lý '+esc(l.slaHours)+'h</span>':'')
      +'</span>';
  }).join('')+'</div>';
}
function noAuthorityState(iconType,line){
  return '<div class="phf-comp-note">'+icon(iconType||'lock')+'<span>'+esc(line)+'</span></div>';
}

/* C4.2 — identity header. Server-resolved People-Master viewer only
 * (competitionBootstrap.viewer/capabilities) — never a second identity
 * source, never inferred from title/department/branch. Chips mirror the
 * LOCKED authority model 1:1; no email/account_id ever rendered here. */
function identityChipsHtml(boot){
  var caps=boot&&boot.capabilities||{};
  var viewer=boot&&boot.viewer||{};
  var chips=[];
  if(caps.canSubmit)chips.push('Người tham gia');
  if(viewer.reviewerMaxLevel===1)chips.push('Người duyệt 2 điểm');
  else if(viewer.reviewerMaxLevel>=2)chips.push('Người duyệt 5 điểm');
  if(caps.canAdmin)chips.push('Quản trị chương trình');
  if(caps.viewParticipationProgress)chips.push('Xem tiến độ toàn công ty');
  if(!chips.length)return '';
  return '<div class="phf-comp-identity-chips">'+chips.map(function(c){
    return '<span class="phf-comp-identity-chip">'+esc(c)+'</span>';
  }).join('')+'</div>';
}
function identityHeaderHtml(boot){
  var viewer=boot&&boot.viewer||{};
  var name=viewer.displayName||'—';
  var metaParts=[];
  if(viewer.employeeCode)metaParts.push('Mã NV: '+viewer.employeeCode);
  var role=[viewer.title,viewer.department].filter(Boolean).join(' · ');
  if(role)metaParts.push(role);
  return '<div class="phf-comp-identity">'
    +'<div class="phf-comp-identity-line">Xin chào, <b>'+esc(name)+'</b></div>'
    +(metaParts.length?'<div class="phf-comp-identity-sub">'+esc(metaParts.join(' · '))+'</div>':'')
    +identityChipsHtml(boot)
  +'</div>';
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
    {key:'gui',         label:'+ Gửi bài dự thi',       icon:'plus',    href:p+'/thi-dua/gui', cta:true},
    {key:'ket-qua',     label:'Bảng xếp hạng & Kết quả',icon:'medal',   href:p+'/thi-dua/ket-qua'}
  ];
  if(cap.canReview)items.push({key:'cho-duyet',label:'Chờ duyệt',icon:'review',href:p+'/thi-dua/cho-duyet',group:'Xét duyệt'});
  if(cap.canAdmin){
    items.push({key:'quan-ly', label:'Quản lý chương trình', icon:'grid', href:p+'/thi-dua/quan-ly', group:'Quản trị'});
    items.push({key:'xet-duyet',label:'Phân quyền xét duyệt',   icon:'gear', href:p+'/thi-dua/xet-duyet',group:'Quản trị'});
    items.push({key:'chot',    label:'Chốt chương trình',    icon:'seal', href:p+'/thi-dua/chot',    group:'Quản trị'});
  }
  return items;
}
function screenForPath(path){
  var m=String(path||'').replace(/\/+$/,'').match(/^\/(?:admin|ql|hv)\/thi-dua(?:\/([a-z-]+))?$/);
  if(!m)return 'tong-quan';
  return m[1]||'tong-quan';
}
// Final polish — each nav group (Tham gia / Xét duyệt / Quản trị) renders as
// its own light, bordered grouping (a visual "card" for the section, not a
// flat label + list) so the hierarchy reads at a glance. Grouping/order logic
// is unchanged (still 1:1 with menuModel()'s sequential group field) — only
// the wrapper markup changed, so permission visibility is untouched.
function navHtml(boot,activeKey){
  var items=menuModel(boot);
  var groups=[],byName={};
  items.forEach(function(it){
    var grp=it.group||'Tham gia';
    if(!(grp in byName)){byName[grp]=groups.length;groups.push({name:grp,items:[]});}
    groups[byName[grp]].items.push(it);
  });
  var out='<nav class="phf-comp-nav" aria-label="Menu Chương trình thi đua">';
  groups.forEach(function(g){
    out+='<div class="phf-comp-nav-group-wrap"><span class="phf-comp-nav-group">'+esc(g.name)+'</span><div class="phf-comp-nav-group-items">';
    g.items.forEach(function(it){
      var cls=(it.cta?'is-cta':'')+(it.key===activeKey?' is-active':'');
      out+='<a href="'+esc(it.href)+'" data-comp-nav="'+esc(it.href)+'"'+(cls.trim()?' class="'+cls.trim()+'"':'')+(it.key===activeKey?' aria-current="page"':'')+'>'+icon(it.icon)+'<span>'+esc(it.label)+'</span></a>';
    });
    out+='</div></div>';
  });
  return out+'</nav>';
}
function navLoadingHtml(){
  return '<nav class="phf-comp-nav" aria-label="Menu Chương trình thi đua">'+skeletonHtml([70,55,60,45,65])+'</nav>';
}

/* Authorization is decided ONLY from server capabilities — no namespace, no
 * title/department/branch fallback. Participant screens have no capability
 * gate (any eligible active People-Master identity — competitionBootstrap
 * already rejects an ineligible/inactive identity before this is reached). */
function isScreenAuthorized(key,boot){
  var cap=(boot&&boot.capabilities)||{};
  if(key==='cho-duyet')return !!cap.canReview;
  if(key==='quan-ly'||key==='xet-duyet'||key==='chot')return !!cap.canAdmin;
  return true;
}

/* ================================================================== *
 * SCREEN RENDERERS — each is async(slot, boot) : renders into `slot`,
 * an element already inside the mounted shell. Honest loading -> data
 * -> error states; no fabricated numbers; no localStorage.
 * ================================================================== */

// Round 2 — personal progress must outrank admin/company data visually
// (it already renders first on Tổng quan, before campaign rules/company
// progress) and read as a sentence in ~3 seconds, not a bare fact-grid.
function participationCardHtml(myReq,campaign){
  var valid=myReq&&myReq.validCount!=null?myReq.validCount:'—';
  var req=myReq&&myReq.requiredCount!=null?myReq.requiredCount:'—';
  var missing=myReq&&myReq.missingCount!=null?myReq.missingCount:'—';
  var pct=(myReq&&myReq.requiredCount)?Math.max(0,Math.min(100,Math.round(100*myReq.validCount/myReq.requiredCount))):0;
  var headline=(myReq&&myReq.validCount!=null&&myReq.requiredCount!=null)
    ? 'Bạn đã hoàn thành <b>'+esc(myReq.validCount)+'/'+esc(myReq.requiredCount)+'</b> nội dung hợp lệ'
    : 'Tiến độ tham gia của bạn';
  var remainLine=(myReq&&myReq.missingCount!=null)
    ? (myReq.missingCount>0?'Còn <b>'+esc(myReq.missingCount)+'</b> nội dung trong tháng này.':'Bạn đã hoàn thành yêu cầu tháng này — cảm ơn bạn đã đóng góp!')
    : '';
  return '<section class="phf-comp-section"><h2>'+icon('check')+'Tiến độ tham gia của bạn</h2>'
    +'<div class="phf-comp-card phf-comp-participation">'
      +'<p class="phf-comp-progress-headline">'+headline+'</p>'
      +'<div class="phf-comp-prog" role="group" aria-label="Tiến độ tham gia">'
        +'<div class="phf-comp-prog-cell"><span>Đã gửi hợp lệ</span><b>'+esc(valid)+'</b></div>'
        +'<div class="phf-comp-prog-cell"><span>Yêu cầu tháng</span><b>'+esc(req)+'</b></div>'
        +'<div class="phf-comp-prog-cell"><span>Còn thiếu</span><b>'+esc(missing)+'</b></div>'
      +'</div>'
      +'<div class="phf-comp-prog-bar" aria-hidden="true"><i style="width:'+pct+'%"></i></div>'
      +(remainLine?'<p class="phf-comp-progress-remain">'+remainLine+'</p>':'')
      +(campaign?'':'<div class="phf-comp-note">'+icon('info')+'<span>Chưa có chương trình đang diễn ra.</span></div>')
      +'<div class="phf-comp-actions" style="border:0;padding-top:14px"><button type="button" class="phf-comp-btn" data-comp-go="'+esc(prefix()+'/thi-dua/gui')+'"'+(campaign?'':' disabled')+'>Gửi bài dự thi</button></div>'
    +'</div>'
  +'</section>';
}

// Round 2 — "thể lệ chương trình" (program rules), readable in a few
// seconds: a compact top summary (numbers ALWAYS derived from the real
// campaign/level config — never hardcoded), a 4-step "how it works", then a
// native <details> disclosure for the denser reference material (full
// requirements, the Checklist penalty note, program tone, and the existing
// level/status/deadline facts) so it doesn't have to be read up front.
// The Checklist penalty is PRESENTATION of an existing, Operator-confirmed
// policy only — no Checklist integration/deduction is built or called here.
function rulesSectionHtml(campaign,levels){
  var req=campaign.minRequiredContributions;
  var lv2=(levels||[]).filter(function(l){return Number(l.levelOrder)===1;})[0];
  var lv5=(levels||[]).filter(function(l){return Number(l.levelOrder)===2;})[0];
  var checklistRows='';
  if(req){
    for(var missing=0;missing<=Math.min(req,4);missing++){
      var have=req-missing;
      checklistRows+='<div class="phf-comp-checklist-row"><span>'+have+'/'+req+'</span><b>'+(missing===0?'Không trừ':'-'+missing+' điểm')+'</b></div>';
    }
  }
  return '<section class="phf-comp-section"><h2>'+icon('flag')+'Thể lệ chương trình</h2>'
    +'<div class="phf-comp-card">'
      +'<div class="phf-comp-rules-summary">'
        +'<div class="phf-comp-rules-fact"><b>'+(req!=null?esc(req):'—')+'</b><span>nội dung tối thiểu / người / tháng</span></div>'
        +'<div class="phf-comp-rules-fact"><b>'+(lv2?esc(lv2.score):'2')+' điểm</b><span>Nội dung hợp lệ</span></div>'
        +'<div class="phf-comp-rules-fact is-high"><b>'+(lv5?esc(lv5.score):'5')+' điểm</b><span>Giá trị cao / khung chuẩn</span></div>'
        +'<div class="phf-comp-rules-fact is-warn"><b>-1 điểm Checklist</b><span>cho mỗi nội dung còn thiếu</span></div>'
      +'</div>'
      +'<div class="phf-comp-steps">'
        +'<div class="phf-comp-step"><span class="phf-comp-step-no">01</span><div><b>Ghi nhận thực tế</b><p>Gửi câu hỏi/tình huống khách hàng thực tế phát sinh trong công việc.</p></div></div>'
        +'<div class="phf-comp-step"><span class="phf-comp-step-no">02</span><div><b>Chia sẻ cách xử lý</b><p>Câu trả lời phải phù hợp với chính sách và thông tin thực tế của công ty.</p></div></div>'
        +'<div class="phf-comp-step"><span class="phf-comp-step-no">03</span><div><b>Được xét duyệt</b><p>Nội dung được xét duyệt và có thể được ghi nhận 2 điểm hoặc 5 điểm tùy giá trị đóng góp.</p></div></div>'
        +'<div class="phf-comp-step"><span class="phf-comp-step-no">04</span><div><b>Ghi nhận cuối tháng</b><p>Điểm đóng góp được dùng để xếp hạng và xét vinh danh cuối tháng.</p></div></div>'
      +'</div>'
      +'<p class="phf-comp-rules-spirit">Không chỉ hoàn thành đủ '+(req!=null?esc(req):'—')+' nội dung. PHF khuyến khích mọi người chia sẻ những tình huống hay, cách xử lý tốt và câu trả lời thực sự hữu ích để cả đội cùng học và sử dụng.</p>'
      +'<details class="phf-comp-disclosure"><summary>Xem đầy đủ thể lệ</summary>'
        +'<div class="phf-comp-disclosure-body">'
          +'<b class="phf-comp-disclosure-h">Yêu cầu</b>'
          +'<ul class="phf-comp-rules-list">'
            +'<li>Tối thiểu '+(req!=null?esc(req):'—')+' nội dung/người/tháng.</li>'
            +'<li>Không gửi câu hỏi/tình huống trùng.</li>'
            +'<li>Nội dung phải là tình huống thực tế phát sinh trong công việc.</li>'
            +'<li>Câu trả lời phải dựa trên chính sách/thông tin thực tế của PHF.</li>'
            +'<li>Nội dung chỉ được tính hoàn thành yêu cầu tháng khi được duyệt hợp lệ.</li>'
          +'</ul>'
          +(checklistRows?'<b class="phf-comp-disclosure-h">Checklist</b><div class="phf-comp-checklist-table">'+checklistRows+'</div>':'')
          +'<div class="phf-comp-note">'+icon('info')+'<span>Điểm Checklist và điểm thi đua là hai loại điểm riêng biệt. Điểm Checklist đánh giá việc hoàn thành nhiệm vụ được giao; điểm chương trình 2đ/5đ ghi nhận giá trị đóng góp và dùng để xét vinh danh cuối tháng.</span></div>'
          +'<b class="phf-comp-disclosure-h">Thông tin chương trình</b>'
          +'<div class="phf-comp-grid" style="margin-top:8px">'
            +'<div class="phf-comp-fact"><b>Trạng thái chương trình</b><span>'+esc(statusLabel(campaign.status))+'</span></div>'
            +'<div class="phf-comp-fact"><b>Hạn nộp</b><span>'+esc(fmtDate(campaign.submissionDeadline))+'</span></div>'
            +'<div class="phf-comp-fact"><b>Hạn xét duyệt</b><span>'+esc(fmtDate(campaign.reviewDeadline))+'</span></div>'
          +'</div>'
          +'<div style="margin-top:16px"><b style="font-size:12.5px">Mức công nhận (cấu hình chương trình)</b>'+levelChipsHtml(levels)+'</div>'
        +'</div>'
      +'</details>'
    +'</div>'
  +'</section>';
}

async function screenOverview(slot,boot){
  var campaign=boot.activeCampaign;
  var html=heroHtml(campaign)+participationCardHtml(boot.myRequirement,campaign);
  if(!campaign){
    html+='<section class="phf-comp-section"><h2>'+icon('flag')+'Chương trình hiện tại</h2>'
      +'<div class="phf-comp-card">'+emptyState('flag','Chưa có chương trình nào đang diễn ra.','Khi Admin mở một chương trình, thông tin sẽ hiển thị tại đây.')+'</div></section>';
    slot.innerHTML=html;
    return;
  }
  var levels=[];
  try{levels=await call('competitionListLevels',{campaign_id:campaign.id});}catch(e){/* non-fatal on overview */}
  html+=rulesSectionHtml(campaign,levels);
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
  if(!campaign){slot.innerHTML=heroHtml(null)+'<section class="phf-comp-section"><h2>'+icon('feed')+'Bảng tin</h2>'+emptyState('feed','Chưa có chương trình đang diễn ra.')+'</section>';return;}
  slot.innerHTML=heroHtml(campaign,'Hoạt động của chương trình — các đóng góp đủ điều kiện hiển thị ẩn danh dưới dạng thẻ tin, có thể thả tim để ghi nhận.')
    +'<section class="phf-comp-section"><h2>'+icon('feed')+'Bảng tin</h2>'
    +'<div class="phf-comp-note">'+icon('lock')+'<span>Trong thời gian chương trình đang chạy, bảng tin không hiển thị danh tính tác giả. Danh tính chỉ mở sau khi chương trình được chốt và bật công bố.</span></div>'
    +'<div class="phf-comp-feed" data-comp-feed style="margin-top:18px">'+loadingState('Đang tải bảng tin…')+'</div>'
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
  var token=post.authorName?esc(post.authorName):('<span class="phf-comp-post-token-alias">'+icon('sparkle')+esc(post.anonAlias)+'</span>');
  // Every post here is already approved/finalized (Feed eligibility, unchanged)
  // — a redundant "Đã duyệt" badge next to the reaction says nothing new.
  // What IS worth surfacing: 5-point ("giá trị cao") contributions stand out
  // from ordinary 2-point ones, since that reflects real recognition already
  // decided server-side (current_level_order/current_score), not a new rule.
  var isHigh=Number(post.approvalLevel)>=2;
  return '<article class="phf-comp-post'+(isHigh?' is-high':'')+'" data-comp-post data-post-id="'+esc(post.submissionId)+'">'
    +'<header class="phf-comp-post-head">'
      +'<span class="phf-comp-post-token">'+icon('users')+token+'</span>'
      +'<span class="phf-comp-post-when">'+esc(fmtDate(post.submittedAt))+'</span>'
      +(isHigh?'<span class="phf-comp-post-kind is-high">'+icon('sparkle')+'Giá trị cao · 5 điểm</span>'
        :(post.approvalLevelName?'<span class="phf-comp-post-kind">'+esc(post.approvalLevelName)+' · '+esc(post.currentScore)+' điểm</span>':''))
    +'</header>'
    +'<div class="phf-comp-post-body">'+qaFieldsHtml(post.payload,320)+'</div>'
    +'<footer class="phf-comp-post-foot">'
      +'<button type="button" class="phf-comp-react'+(post.viewerReacted?' is-on':'')+'" data-comp-react data-submission-id="'+esc(post.submissionId)+'" aria-pressed="'+(post.viewerReacted?'true':'false')+'">'
        +icon('heart')+'<span class="rx-label">'+(post.viewerReacted?'Đã thả tim':'Thả tim')+'</span><span class="rx-count" data-rx-count>'+esc(post.reactionTotal||0)+'</span></button>'
    +'</footer>'
  +'</article>';
}

// Round 2 — filters are derived from the SAME already-fetched rows (no extra
// API call, no new backend contract) and only keep the groups a participant
// actually acts on day-to-day. Draft/Rejected stay reachable (nothing is
// hidden — "Tất cả" always shows everything) but don't get equal visual
// billing with Chờ duyệt/Cần chỉnh sửa/Đã duyệt.
var MY_SUBS_FILTERS=[
  {k:'all',label:'Tất cả',match:function(){return true;}},
  {k:'submitted',label:'Chờ duyệt',match:function(s){return s.status==='submitted';}},
  {k:'needs_revision',label:'Cần chỉnh sửa',match:function(s){return s.status==='needs_revision';}},
  {k:'approved',label:'Đã duyệt',match:function(s){return s.status==='approved'||s.status==='finalized';}}
];
function mySubmissionCardHtml(s){
  return '<div class="phf-comp-card" style="margin-top:12px">'
    +'<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">'
      +statusPill(s.status)+'<span style="font-size:12px;color:var(--comp-ink-soft)">'+esc(fmtDate(s.updatedAt))+'</span></div>'
    +qaFieldsHtml(s.payload)
    +(s.currentLevelOrder?'<p style="margin:6px 0 0;font-size:12.5px;color:var(--comp-green-deep)">Mức '+esc(s.currentLevelOrder)+' · '+esc(s.currentScore)+' điểm</p>':'')
    +(( ['needs_revision','rejected'].indexOf(s.status)>=0 && s.lastReviewNote )?'<div class="phf-comp-note">'+icon('info')+'<span>'+esc(s.lastReviewNote)+'</span></div>':'')
    +(['draft','needs_revision'].indexOf(s.status)>=0?'<div class="phf-comp-actions" style="padding-top:12px"><button type="button" class="phf-comp-btn" data-comp-go="'+esc(prefix()+'/thi-dua/gui')+'">Tiếp tục chỉnh sửa</button></div>':'')
  +'</div>';
}
async function screenMySubmissions(slot,boot){
  slot.innerHTML=heroHtml(boot.activeCampaign,'Theo dõi các nội dung bạn đã gửi và trạng thái xét duyệt.')
    +'<section class="phf-comp-section">'
      +'<div class="phf-comp-section-head"><h2>'+icon('doc')+'Bài của tôi</h2>'
        +'<button type="button" class="phf-comp-btn" data-comp-go="'+esc(prefix()+'/thi-dua/gui')+'">+ Gửi bài mới</button></div>'
      +'<div data-comp-body>'+loadingState()+'</div>'
    +'</section>';
  var body=slot.querySelector('[data-comp-body]');
  try{
    var rows=await call('competitionListMySubmissions',{});
    if(!rows||!rows.length){
      body.innerHTML=emptyState('inbox','Bạn chưa gửi nội dung nào.','Nhấn "Gửi bài dự thi" để bắt đầu.')
        +'<div class="phf-comp-actions" style="border:0;padding-top:14px"><button type="button" class="phf-comp-btn" data-comp-go="'+esc(prefix()+'/thi-dua/gui')+'">Gửi bài dự thi</button></div>';
      return;
    }
    var activeFilter='all';
    function renderList(){
      var filter=MY_SUBS_FILTERS.filter(function(f){return f.k===activeFilter;})[0]||MY_SUBS_FILTERS[0];
      var filtered=rows.filter(filter.match);
      var listBox=body.querySelector('[data-comp-mysubs-list]');
      listBox.innerHTML=filtered.length
        ? filtered.map(mySubmissionCardHtml).join('')
        : emptyState('inbox','Không có bài nào ở nhóm này.');
    }
    body.innerHTML='<div class="phf-comp-filters" role="tablist" aria-label="Lọc theo trạng thái">'
        +MY_SUBS_FILTERS.map(function(f){
          var n=rows.filter(f.match).length;
          return '<button type="button" class="phf-comp-filter'+(f.k==='all'?' is-active':'')+'" data-comp-filter="'+f.k+'" role="tab" aria-selected="'+(f.k==='all'?'true':'false')+'">'+esc(f.label)+' <span class="phf-comp-filter-count">'+n+'</span></button>';
        }).join('')
      +'</div>'
      +'<div data-comp-mysubs-list></div>';
    renderList();
    body.querySelectorAll('[data-comp-filter]').forEach(function(btn){
      btn.addEventListener('click',function(){
        activeFilter=btn.getAttribute('data-comp-filter');
        body.querySelectorAll('[data-comp-filter]').forEach(function(b){
          var on=b===btn;b.classList.toggle('is-active',on);b.setAttribute('aria-selected',on?'true':'false');
        });
        renderList();
      });
    });
  }catch(e){body.innerHTML=errorState(e);wireRetrySingle(body,function(){return screenMySubmissions(slot,boot);});}
}

// Submit is an ACTION screen, not a browsing one — H1 is the action itself
// ("Gửi bài dự thi"), campaign name moves down to a small subheading. This
// is a deliberate exception to the campaign-name-is-H1 rule used elsewhere,
// matching the brief's explicit spec for this one screen.
function submitHeroHtml(campaign,sub){
  return '<section class="phf-comp-hero">'
    +'<span class="phf-comp-eyebrow">'+esc(campaignDisplayTitle(campaign))+'</span>'
    +'<h1>Gửi bài dự thi</h1>'
    +'<p>'+esc(sub||'')+'</p>'
  +'</section>';
}
async function screenSubmitForm(slot,boot){
  var campaign=boot.activeCampaign;
  if(!campaign){slot.innerHTML=heroHtml(null)+'<section class="phf-comp-section"><h2>'+icon('plus')+'Gửi bài dự thi</h2>'+emptyState('plus','Chưa có chương trình đang nhận bài.')+'</section>';return;}
  slot.innerHTML=submitHeroHtml(campaign,'Gửi một câu hỏi / tình huống khách hàng thật và cách bạn đã xử lý.')
    +'<div class="phf-comp-section" data-comp-body>'+loadingState()+'</div>';
  var body=slot.querySelector('[data-comp-body]');
  try{
    var mine=await call('competitionListMySubmissions',{campaign_id:campaign.id});
    var draft=(mine||[]).filter(function(s){return s.status==='draft'||s.status==='needs_revision';})[0]||null;
    renderSubmitForm(body,campaign,draft);
  }catch(e){body.innerHTML=errorState(e);wireRetrySingle(body,function(){return screenSubmitForm(slot,boot);});}
}
function formFieldHtml(field,value){
  var v=value==null?'':value;
  if(field.type==='textarea'){
    return '<div class="phf-comp-field"><label>'+esc(field.label)+(field.required?'<span class="req">*</span>':'')+'</label>'
      +'<textarea data-comp-field="'+esc(field.key)+'" placeholder="'+esc(field.help||'')+'">'+esc(v)+'</textarea></div>';
  }
  return '<div class="phf-comp-field"><label>'+esc(field.label)+(field.required?'<span class="req">*</span>':'')+'</label>'
    +'<input type="text" data-comp-field="'+esc(field.key)+'" value="'+esc(v)+'" placeholder="'+esc(field.help||'')+'"></div>';
}
/* V1.1 sender pre-submit warning. Never blocks: closing/"Tôi có cách xử lý
 * khác" always lets the participant submit their own content; "Tôi cũng gặp
 * tình huống này" records a frequency signal against the chosen candidate
 * and returns WITHOUT submitting (see competition-similarity-service.js —
 * confirmOccurrence never creates a competition.submissions row). Candidate
 * content here is the SENDER-safe view: question excerpt + submitted date
 * only — never the candidate's answer, never author identity. */
function showSimilarityWarning(campaignId,candidates){
  return new Promise(function(resolve){
    var wrap=document.createElement('div');
    wrap.className='phf-comp-simwarn-backdrop';
    wrap.innerHTML='<div class="phf-comp-simwarn" role="dialog" aria-label="Nội dung tương tự đã được gửi trước">'
      +'<h3>'+icon('warn')+'Có nội dung tương tự đã được gửi trước</h3>'
      +'<p class="phf-comp-em-sub" style="margin:-4px 0 12px">Bạn vẫn có thể gửi bài của mình — hãy xem qua trước để tránh trùng lặp không cần thiết.</p>'
      +'<div class="phf-comp-simwarn-list">'
        +candidates.map(function(c,i){
          var q=String(c.questionExcerpt||'');
          return '<div class="phf-comp-simwarn-cand" data-comp-simwarn-cand="'+i+'">'
            +'<span class="phf-comp-simwarn-meta">Đã gửi trước bạn · '+esc(fmtDate(c.submittedAt))+'</span>'
            +'<p class="phf-comp-simwarn-q">'+esc(q)+(q.length>=160?'…':'')+'</p>'
            +'<button type="button" class="phf-comp-btn is-ghost" data-comp-simwarn-same="'+esc(c.submissionRef)+'">Tôi cũng gặp tình huống này</button>'
          +'</div>';
        }).join('')
      +'</div>'
      +'<div class="phf-comp-actions" style="border-top:1px solid var(--comp-border);padding-top:14px;margin-top:14px">'
        +'<button type="button" class="phf-comp-btn" data-comp-simwarn-diff>Tôi có cách xử lý khác — vẫn gửi bài của tôi</button>'
        +'<button type="button" class="phf-comp-btn is-ghost" data-comp-simwarn-cancel>Để tôi xem lại</button>'
      +'</div>'
    +'</div>';
    document.body.appendChild(wrap);
    function close(result){wrap.remove();resolve(result);}
    wrap.addEventListener('click',function(e){if(e.target===wrap)close(false);});
    wrap.querySelector('[data-comp-simwarn-diff]').addEventListener('click',function(){close(true);});
    wrap.querySelector('[data-comp-simwarn-cancel]').addEventListener('click',function(){close(false);});
    wrap.querySelectorAll('[data-comp-simwarn-same]').forEach(function(btn){
      btn.addEventListener('click',async function(){
        wrap.querySelectorAll('button').forEach(function(b){b.disabled=true;});
        try{
          var res=await call('competitionConfirmOccurrence',{campaign_id:campaignId,source_submission_id:btn.getAttribute('data-comp-simwarn-same')});
          toast('success','Đã ghi nhận',res.alreadyConfirmed?'Bạn đã xác nhận tình huống này trước đó.':'Cảm ơn bạn đã xác nhận tình huống này.');
        }catch(e){toast('error','Không ghi nhận được',e.message);}
        close(false);
      });
    });
  });
}
function renderSubmitForm(body,campaign,draft){
  var schema=Array.isArray(campaign.formSchema)&&campaign.formSchema.length?campaign.formSchema:[
    {key:'customer_question',label:'Khách hàng đã hỏi gì / Tình huống gì xảy ra?',type:'textarea',required:true},
    {key:'answer',label:'Cách bạn đã trả lời / xử lý',type:'textarea',required:true},
    // V1.2 — participant's OWN "Kết quả thực tế / Ghi nhận", optional: a
    // valuable câu hỏi/tình huống may be submitted even when the final
    // result isn't known yet. Stored in payload.actual_result (existing
    // jsonb column) — fully backward-compatible, no migration.
    {key:'actual_result',label:'Kết quả thực tế / Ghi nhận',type:'textarea',required:false,
     help:'Sau khi bạn trả lời/xử lý, khách phản hồi thế nào hoặc tình huống mang lại kết quả gì?'}
  ];
  var payload=(draft&&draft.payload)||{};
  var isLocked=draft&&['submitted','approved','rejected','finalized'].indexOf(draft.status)>=0;
  body.innerHTML='<div class="phf-comp-card">'
    +(draft?'<div class="phf-comp-note">'+icon('info')+'<span>Đang chỉnh sửa bản '+(draft.status==='needs_revision'?'cần chỉnh sửa':'nháp')+' đã lưu.'+(draft.lastReviewNote?' Ghi chú người duyệt: '+esc(draft.lastReviewNote):'')+'</span></div>':'')
    +schema.map(function(f){return formFieldHtml(f,payload[f.key]);}).join('')
    +'<div class="phf-comp-actions">'
      +'<button type="button" class="phf-comp-btn" data-comp-submit'+(isLocked?' disabled':'')+'>Gửi duyệt</button>'
      +'<button type="button" class="phf-comp-btn is-ghost" data-comp-save-draft'+(isLocked?' disabled':'')+'>Lưu nháp</button>'
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
      // V1.1 pre-submit similarity check — a suggestion only (never blocks).
      // Best-effort: if the check itself fails, submission proceeds normally
      // rather than trapping the participant behind a broken suggestion.
      try{
        var check=await call('competitionCheckSimilarity',{campaign_id:campaign.id,question:p.customer_question,answer:p.answer,exclude_submission_id:draftId});
        if(check&&check.hasSimilar&&check.candidates&&check.candidates.length){
          var proceed=await showSimilarityWarning(campaign.id,check.candidates);
          if(!proceed){btn.disabled=false;return;}
        }
      }catch(e){/* similarity check is a suggestion, not a gate — ignore failures */}
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
  if(!campaign){slot.innerHTML=heroHtml(null)+'<section class="phf-comp-section"><h2>'+icon('trophy')+'Vị trí của bạn</h2>'+emptyState('trophy','Chưa có chương trình đang diễn ra.')+'</section>';return;}
  slot.innerHTML=heroHtml(campaign,'Bảng xếp hạng ẩn danh giúp bạn biết khoảng cách và cố gắng; kết quả chính thức công bố sau khi chương trình được chốt.')
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
          var rankNum=Number(r.rank);
          var rankHtml=(rankNum>=1&&rankNum<=3)
            ? '<span class="phf-comp-rank-badge phf-comp-rank-'+rankNum+'">'+rankNum+'</span>'
            : '#'+esc(r.rank);
          return '<tr'+(r.isYou?' class="is-you"':'')+'><td data-th="Hạng">'+rankHtml+'</td>'
            +'<td data-th="Người tham gia">'+who+'</td><td data-th="Điểm">'+esc(r.totalScore)+'</td>'
            +(lb.identityMode==='admin'?'<td data-th="Bài đã duyệt">'+esc(r.approvedCount)+'</td>':'')+'</tr>';
        }).join('')+'</tbody></table></div>';
    }
    html+='<div class="phf-comp-note">'+icon('lock')+'<span>'+(lb.published?'Chương trình đã chốt và công bố — danh tính hiển thị công khai.':(lb.identityMode==='privileged'?'Bạn thấy danh tính thật vì là người duyệt mức cao nhất, nhưng vẫn không thấy danh tính gắn với từng bài cụ thể.':(lb.identityMode==='admin'?'Bạn thấy toàn bộ danh tính với vai trò Competition Admin.':'Người khác luôn hiển thị ẩn danh cho tới khi chương trình được chốt và công bố.')))+'</span></div>'
    +'</section>';
    body.outerHTML='<section class="phf-comp-section">'+html;
  }catch(e){body.innerHTML=errorState(e);wireRetrySingle(body,function(){return screenLeaderboard(slot,boot);});}
}

/* V1.1 — NO-AI similarity SUGGESTION (never a verdict; see
 * competition-similarity.js on the server). Two independent surfaces:
 *   - similarDisclosureHtml/wireSimilarDisclosure: reviewer-side quiet
 *     warning on a queue item, expand-on-demand (competitionGetSimilarForReview
 *     is called lazily, only when the reviewer actually opens it — never on
 *     queue load, per the "no per-card endpoint spam" performance rule).
 *   - showSimilarityWarning: sender-side pre-submit warning (below, near
 *     renderSubmitForm) — a light Jaccard/Dice label, not a fake AI verdict.
 */
function similarDisclosureHtml(submissionRef){
  return '<details class="phf-comp-similar-disclosure" data-comp-similar="'+esc(submissionRef)+'">'
    +'<summary>'+icon('info')+'Có nội dung tương tự</summary>'
    +'<div class="phf-comp-similar-body" data-comp-similar-body>'+loadingState('Đang tải…')+'</div>'
  +'</details>';
}
function similarLabelText(k){
  if(k==='HIGH')return 'Tương tự cao';
  if(k==='MEDIUM')return 'Tương tự một phần';
  return 'Khác biệt';
}
function similarCandidateHtml(c){
  var sameHandling=c.questionLabel==='HIGH'&&c.answerLabel==='HIGH';
  return '<div class="phf-comp-similar-item">'
    +'<div class="phf-comp-similar-meta">'
      +'<span>Mã bài '+esc(String(c.submissionRef).slice(0,8))+'</span>'
      +'<span>'+(c.relationship==='before'?'Gửi trước bài đang xét':'Gửi sau bài đang xét')+'</span>'
      +'<span>'+esc(fmtDate(c.submittedAt))+'</span>'
      +(c.occurrenceCount?'<span>Đã ghi nhận tình huống này: '+esc(c.occurrenceCount)+' lần</span>':'')
    +'</div>'
    +'<p class="phf-comp-qa-label" style="margin:8px 0 2px">Câu hỏi / tình huống khách hàng</p><p class="phf-comp-qa-text">'+esc(c.question||'')+'</p>'
    +'<p class="phf-comp-qa-label" style="margin:8px 0 2px">Cách trả lời / xử lý</p><p class="phf-comp-qa-text">'+esc(c.answer||'')+'</p>'
    +'<div class="phf-comp-similar-verdict">'
      +'<span class="phf-comp-pill" data-s="'+(c.questionLabel==='HIGH'?'rejected':'submitted')+'">Tình huống: '+similarLabelText(c.questionLabel)+'</span>'
      +'<span class="phf-comp-pill" data-s="'+(sameHandling?'rejected':'approved')+'">Cách xử lý: '+(sameHandling?'Tương tự cao':similarLabelText(c.answerLabel))+'</span>'
    +'</div>'
  +'</div>';
}
function wireSimilarDisclosures(container){
  container.querySelectorAll('[data-comp-similar]').forEach(function(det){
    var loaded=false;
    det.addEventListener('toggle',async function(){
      if(!det.open||loaded)return;
      loaded=true;
      var bodyEl=det.querySelector('[data-comp-similar-body]');
      try{
        var res=await call('competitionGetSimilarForReview',{submission_id:det.getAttribute('data-comp-similar')});
        bodyEl.innerHTML=(res.candidates||[]).length
          ?res.candidates.map(similarCandidateHtml).join('')
          :'<p class="phf-comp-em-sub">Không còn nội dung tương tự.</p>';
      }catch(e){bodyEl.innerHTML='<p class="phf-comp-em-sub">Không tải được nội dung tương tự.</p>';loaded=false;}
    });
  });
}

async function screenReviewQueue(slot,boot){
  var campaign=boot.activeCampaign;
  if(!boot.capabilities||!boot.capabilities.canReview){
    slot.innerHTML=heroHtml(null)+'<section class="phf-comp-section"><h2>'+icon('review')+'Chờ duyệt</h2>'+noAuthorityState('lock','Bạn chưa được cấp quyền xét duyệt cho Chương trình thi đua.')+'</section>';
    return;
  }
  if(!campaign){slot.innerHTML=heroHtml(null)+'<section class="phf-comp-section"><h2>'+icon('review')+'Chờ duyệt</h2>'+emptyState('review','Chưa có chương trình đang diễn ra.')+'</section>';return;}
  slot.innerHTML=heroHtml(campaign,'Xét duyệt ẩn danh — danh tính người gửi được ẩn trong suốt quá trình xét duyệt.')
    +'<section class="phf-comp-section"><h2>'+icon('review')+'Chờ duyệt</h2>'
    +'<div class="phf-comp-note">'+icon('lock')+'<span><b>Xét duyệt ẩn danh.</b> Danh tính người gửi được ẩn trong suốt quá trình xét duyệt.</span></div>'
    +'<div data-comp-body style="margin-top:18px">'+loadingState()+'</div></section>'
    +'<section class="phf-comp-section" data-comp-productivity><h2>'+icon('users')+'Năng suất xét duyệt của bạn</h2>'
    +'<p class="phf-comp-em-sub" style="margin:-4px 0 10px">Đây là tốc độ xử lý hàng chờ của bạn — KHÔNG phải điểm thi đua.</p>'
    +'<div class="phf-comp-card">'+loadingState()+'</div></section>';
  var body=slot.querySelector('[data-comp-body]');
  var prodBox=slot.querySelector('[data-comp-productivity] .phf-comp-card');
  // C4.4 latency fix: queue and productivity are independent reads (neither
  // depends on the other's result) — kick both off together instead of
  // waiting for the queue before even starting the productivity fetch.
  var queueP=call('competitionGetReviewQueue',{campaign_id:campaign.id});
  var prodP=call('competitionGetReviewerProductivity',{campaign_id:campaign.id});
  // FINAL HOTFIX — after processing an item, the queue re-fetches itself but
  // the productivity card did not, so Đã xử lý/Đang chờ/Quá hạn stayed
  // stale until a full page reload. renderReviewQueue is handed this
  // refresh callback and calls it (real server refetch, no optimistic
  // count) once a review action actually commits.
  async function refreshProductivity(){
    try{ prodBox.innerHTML=productivityCardHtml(await call('competitionGetReviewerProductivity',{campaign_id:campaign.id})); }
    catch(e){ /* best-effort — the queue itself already reflects the real action */ }
  }
  try{
    var queue=await queueP;
    renderReviewQueue(body,campaign,queue,boot,refreshProductivity);
  }catch(e){body.innerHTML=errorState(e);wireRetrySingle(body,function(){return screenReviewQueue(slot,boot);});}
  try{
    prodBox.innerHTML=productivityCardHtml(await prodP);
  }catch(e){prodBox.innerHTML=errorState(e);}
}
function productivityCardHtml(prod){
  return '<div class="phf-comp-grid">'
    +'<div class="phf-comp-fact"><b>Đã nhận</b><span>'+esc(prod.assigned||0)+'</span></div>'
    +'<div class="phf-comp-fact"><b>Đã xử lý</b><span>'+esc(prod.processed||0)+'</span></div>'
    +'<div class="phf-comp-fact"><b>Đang chờ</b><span>'+esc(prod.pending||0)+'</span></div>'
    +'<div class="phf-comp-fact"><b>Quá hạn</b><span>'+esc(prod.overdue||0)+'</span></div>'
  +'</div>';
}
function renderReviewQueue(body,campaign,queue,boot,refreshProductivity){
  if(!queue.items||!queue.items.length){
    body.innerHTML=emptyState('review','Hiện chưa có bài chờ duyệt.','Hàng đợi xét duyệt ẩn danh sẽ hiển thị khi có bài mới.');
    return;
  }
  body.innerHTML=queue.items.map(function(it){
    var levels=queue.eligibleLevels||[];
    // Plain business language, not "Mức N · tên · N điểm". A single eligible
    // level (Reviewer 2) shows a static line instead of a useless 1-item
    // dropdown; 2+ levels (Reviewer 5 / Admin) get a segmented switch — never
    // a raw <select>, which read as a technical control rather than a
    // reviewing action (Round 3 final polish).
    var levelLabel=function(l){return l.score+' điểm — '+esc(l.name);};
    var levelControlHtml=(function(){
      if(levels.length<=1){
        var lvl=levels[0];
        if(!lvl)return '';
        return '<span class="phf-comp-review-level-static" data-comp-fixed-level="'+lvl.levelOrder+'">'+levelLabel(lvl)+'</span>';
      }
      var higher=levels.filter(function(l){return !it.currentLevelOrder||l.levelOrder>it.currentLevelOrder;});
      var defaultOrder=(higher[0]||levels[levels.length-1]).levelOrder;
      return '<div class="phf-comp-level-switch" role="group" aria-label="Chọn mức ghi nhận" data-comp-level-switch>'
        +levels.map(function(l){
          var disabled=it.currentLevelOrder&&l.levelOrder<=it.currentLevelOrder;
          var selected=l.levelOrder===defaultOrder;
          return '<button type="button" class="phf-comp-level-opt'+(selected?' is-selected':'')+'" data-comp-level-opt="'+l.levelOrder+'" aria-pressed="'+(selected?'true':'false')+'"'+(disabled?' disabled':'')+'>'+esc(l.score)+'đ · '+esc(l.name)+'</button>';
        }).join('')
      +'</div>';
    })();
    return '<div class="phf-comp-review-item" data-comp-review-item data-submission-id="'+esc(it.submissionRef)+'" style="margin-top:12px">'
      +'<span class="rq-ref">'+esc(it.reviewStatus==='needs_revision'?'Đã yêu cầu chỉnh sửa · Mã bài: '+String(it.submissionRef).slice(0,8):'Mã bài: '+String(it.submissionRef).slice(0,8))+'</span>'
      +qaFieldsHtml(it.payload)
      +(it.currentLevelOrder?'<p style="font-size:12.5px;color:var(--comp-green-deep)">Đã duyệt mức '+esc(it.currentLevelOrder)+' — có thể nâng mức</p>':'')
      +(it.hasSimilar?similarDisclosureHtml(it.submissionRef):'')
      +reviewerRecordHtml(it.lastReviewNote)
      +'<div class="phf-comp-review-controls">'
        +levelControlHtml
        +'<button type="button" class="phf-comp-btn" data-comp-review-act="'+(it.currentLevelOrder?'upgrade':'approve')+'">'+(it.currentLevelOrder?'Nâng mức':'Duyệt')+'</button>'
        +'<button type="button" class="phf-comp-btn is-ghost" data-comp-review-act="request_revision">Yêu cầu chỉnh sửa</button>'
        +'<button type="button" class="phf-comp-btn is-ghost" data-comp-review-act="reject">Từ chối</button>'
      +'</div>'
    +'</div>';
  }).join('');
  wireSimilarDisclosures(body);
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
      var fixedEl=item.querySelector('[data-comp-fixed-level]');
      if(fixedEl){levelOrder=Number(fixedEl.getAttribute('data-comp-fixed-level'));}
      else{var selOpt=item.querySelector('[data-comp-level-opt].is-selected');levelOrder=selOpt?Number(selOpt.getAttribute('data-comp-level-opt')):undefined;}
      // V1.2 — "Kết quả / Ghi nhận của giám khảo" is now a single inline
      // textarea per item (reviewerRecordHtml), read for EVERY action —
      // still MANDATORY for reject/request_revision (unchanged rule; a
      // window.prompt fallback covers the rare case where a required note
      // is missing, rather than silently failing the action), OPTIONAL for
      // approve/upgrade (supporting assessment info only — never derives
      // score, see competition-submissions.js reviewAction).
      var noteEl=item.querySelector('[data-comp-reviewer-record]');
      var note=(noteEl?noteEl.value:'').trim();
      if((action==='request_revision'||action==='reject')&&!note){
        note=(window.prompt(action==='reject'?'Lý do từ chối:':'Ghi chú yêu cầu chỉnh sửa:')||'').trim();
        if(!note){return;}
      }
      item.querySelectorAll('button').forEach(function(b){b.disabled=true;});
      try{
        await call('competitionReviewSubmission',{campaign_id:campaign.id,submission_id:submissionId,review_action:action,level_order:levelOrder,note:note});
        toast('success','Đã cập nhật','Bài đã được xử lý.');
        // FINAL HOTFIX: refresh queue + productivity together (both are real
        // server refetches confirming the commit — no optimistic count).
        var refreshed=await call('competitionGetReviewQueue',{campaign_id:campaign.id});
        renderReviewQueue(body,campaign,refreshed,boot,refreshProductivity);
        if(refreshProductivity)refreshProductivity();
      }catch(e){toast('error','Không xử lý được',e.message);item.querySelectorAll('button').forEach(function(b){b.disabled=false;});}
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
  slot.innerHTML=adminHeroHtml('Quản lý chương trình','Tạo, cấu hình và điều hành các chương trình thi đua.')
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
  slot.innerHTML=adminHeroHtml('Phân quyền xét duyệt','Chọn nhân sự được quyền xét duyệt cho từng chương trình.')
    +'<section class="phf-comp-section" data-comp-body>'+loadingState()+'</section>';
  var body=slot.querySelector('[data-comp-body]');
  var currentCampaign=null; // set by renderAll() — reused by refreshPeopleOnly() to skip a redundant campaign-list round trip
  // C4.4 latency fix: these 4 fetches are independent of each other (only
  // levels/people depend on the resolved campaign, admins/caps don't depend
  // on anything here) — running them one-at-a-time made every load/refresh
  // pay for N sequential round trips instead of the slowest single one.
  // Same server calls, same data, same business contract — just concurrent.
  async function renderAll(){
    try{
      var adminsP=call('competitionListAdminGrants',{});
      var capsP=call('competitionListCapabilityGrants',{capability:'view_participation_progress'});
      var picker=await adminCampaignPicker(boot);
      if(!picker.campaigns.length){body.innerHTML='<h2>'+icon('gear')+'Phân quyền xét duyệt</h2>'+emptyState('gear','Chưa có chương trình nào.','Tạo chương trình ở "Quản lý chương trình" trước.');return;}
      var c=picker.selected;
      currentCampaign=c;
      var levelsP=call('competitionListLevels',{campaign_id:c.id});
      var peopleP=call('competitionListReviewablePeople',{campaign_id:c.id});
      var results=await Promise.all([levelsP,peopleP,adminsP,capsP]);
      var levels=results[0],people=results[1],admins=results[2],caps=results[3];
      body.innerHTML=campaignSelectHtml(picker.campaigns,ADMIN_SELECTED_CAMPAIGN_ID)
        +levelSectionHtml(c,levels)
        +reviewerMatrixHtml(c,people)
        +otherAuthoritySectionHtml(admins,caps);
      wireCampaignSelect(body,renderAll);
      wireLevelSection(body,c,renderAll);
      wireReviewerMatrix(body,c,refreshPeopleOnly);
      wireAdminGrantSection(body,renderAll);
      wireCapabilityGrantSection(body,renderAll);
    }catch(e){body.innerHTML=errorState(e);wireRetrySingle(body,renderAll);}
  }
  // C4.4 latency fix: a single checkbox toggle in the matrix only changes
  // ONE person's grant — re-running the FULL renderAll() (campaigns + levels
  // + people + admins + caps, 5 round trips) after every click is what made
  // the row stay disabled/locked noticeably long. Only the people/grants
  // list actually needs to be truth-refreshed here; levels/campaigns/admins/
  // caps are untouched by a reviewer-grant write and are re-read on the next
  // full renderAll() (campaign switch, level edit, etc.) as before.
  async function refreshPeopleOnly(){
    var c=currentCampaign;
    if(!c)return renderAll();
    var people=await call('competitionListReviewablePeople',{campaign_id:c.id});
    var matrixSection=body.querySelector('.phf-comp-perm-matrix');
    matrixSection=matrixSection&&matrixSection.closest('section');
    if(!matrixSection)return renderAll();
    matrixSection.outerHTML=reviewerMatrixHtml(c,people);
    wireReviewerMatrix(body,c,refreshPeopleOnly);
  }
  await renderAll();
}
function levelSectionHtml(c,levels){
  return '<section class="phf-comp-section"><h2>'+icon('gear')+'Mức duyệt — '+esc(c.title)+'</h2>'
    +'<div class="phf-comp-card">'
      +(c.levelsFrozen?'<span class="phf-comp-freeze">'+icon('lock')+'Chương trình đã bắt đầu nhận bài: sửa mức cần lý do (điều chỉnh ngoại lệ, có audit)</span>':'')
      +'<div class="phf-comp-table-wrap" style="margin-top:12px"><table class="phf-comp-table">'
        +'<thead><tr><th>Thứ tự</th><th>Tên mức</th><th>Điểm</th><th>Thời gian xử lý (giờ)</th><th></th></tr></thead><tbody>'
        +(levels.length?levels.map(function(l){
          return '<tr data-level-id="'+esc(l.id)+'"><td data-th="Thứ tự">Mức '+esc(l.levelOrder)+'</td>'
            +'<td data-th="Tên mức"><input type="text" data-lvl="name" value="'+esc(l.name)+'"></td>'
            +'<td data-th="Điểm"><input type="text" data-lvl="score" value="'+esc(l.score)+'" style="width:70px"></td>'
            +'<td data-th="Thời gian xử lý"><input type="text" data-lvl="sla" value="'+esc(l.slaHours||'')+'" style="width:60px"></td>'
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
/* C4.3 — "Phân quyền xét duyệt": People-Master-driven matrix, MAX-LEVEL
 * semantics. No tick = participant (no grant row at all). 2đ = Reviewer 2
 * (max_level_order=1). 5đ = Reviewer 5, INHERITS 2đ (max_level_order=2) —
 * one grant row, one effective maximum, never two additive grants. The 2đ
 * checkbox is disabled (visually implied, not independently untickable)
 * while 5đ is on, because ticking 5đ off falls back to 2đ rather than a
 * full revoke — matches the locked checkbox semantics exactly. */
function reviewerMatrixHtml(c,people){
  if(!people.length)return '<section class="phf-comp-section"><h2>'+icon('users')+'Phân quyền xét duyệt — '+esc(c.title)+'</h2><div class="phf-comp-card">'+emptyState('users','Không có nhân sự đang hoạt động nào để phân quyền.')+'</div></section>';
  return '<section class="phf-comp-section"><h2>'+icon('users')+'Phân quyền xét duyệt — '+esc(c.title)+'</h2>'
    +'<div class="phf-comp-card">'
      +'<div class="phf-comp-table-wrap"><table class="phf-comp-table phf-comp-perm-matrix"><thead><tr>'
        +'<th>Nhân sự</th><th>Phòng ban / Chức danh</th><th>Duyệt 2đ</th><th>Duyệt 5đ</th></tr></thead><tbody>'
        +people.map(function(p){
          var lvl=p.reviewerMaxLevel; // null | 1 | 2
          var is2=lvl!=null, is5=lvl===2;
          return '<tr data-comp-perm-row data-account-id="'+esc(p.accountId)+'" data-employee-code="'+esc(p.employeeCode)+'" data-display-name="'+esc(p.displayName)+'">'
            +'<td data-th="Nhân sự"><b>'+esc(p.displayName)+'</b><br><span style="font-size:11.5px;color:var(--comp-ink-soft)">'+esc(p.employeeCode)+'</span></td>'
            +'<td data-th="Phòng ban / Chức danh">'+esc([p.title,p.department].filter(Boolean).join(' / ')||'—')+'</td>'
            +'<td data-th="Duyệt 2đ" style="text-align:center"><input type="checkbox" data-comp-perm="2" '+(is2?'checked':'')+' '+(is5?'disabled':'')+'></td>'
            +'<td data-th="Duyệt 5đ" style="text-align:center"><input type="checkbox" data-comp-perm="5" '+(is5?'checked':'')+'></td>'
          +'</tr>';
        }).join('')
      +'</tbody></table></div>'
      +'<div class="phf-comp-note">'+icon('info')+'<span>Không tick = người tham gia thường. Tick "Duyệt 5đ" tự động bao gồm quyền duyệt 2đ. Danh sách lấy từ Trung tâm Quản trị nhân sự (chỉ nhân sự & tài khoản đang hoạt động).</span></div>'
    +'</div>'
  +'</section>';
}
function wireReviewerMatrix(body,c,refresh){
  body.querySelectorAll('[data-comp-perm-row]').forEach(function(row){
    var accountId=row.getAttribute('data-account-id');
    var employeeCode=row.getAttribute('data-employee-code');
    var displayName=row.getAttribute('data-display-name');
    var cb2=row.querySelector('[data-comp-perm="2"]');
    var cb5=row.querySelector('[data-comp-perm="5"]');
    // While busy: both locked. Idle: cb5 always togglable; cb2 stays
    // disabled (visually implied, not independently untickable) iff cb5 is on.
    function setBusy(b){cb5.disabled=b;cb2.disabled=b||cb5.checked;}
    async function grant(maxLevelOrder){
      await call('competitionSetReviewerGrant',{campaign_id:c.id,account_id:accountId,employee_code:employeeCode,display_name:displayName,max_level_order:maxLevelOrder,reason:'Cập nhật qua Phân quyền xét duyệt'});
    }
    async function revoke(){
      await call('competitionSetReviewerGrant',{campaign_id:c.id,account_id:accountId,active:false,reason:'Cập nhật qua Phân quyền xét duyệt'});
    }
    cb2.addEventListener('change',async function(){
      var checked=cb2.checked;setBusy(true);
      try{
        if(checked)await grant(1);else await revoke();
        toast('success','Đã cập nhật',displayName+' — '+(checked?'Duyệt 2đ':'Người tham gia')+'.');refresh();
      }catch(e){cb2.checked=!checked;toast('error','Không cập nhật được',e.message);setBusy(false);}
    });
    cb5.addEventListener('change',async function(){
      var checked=cb5.checked;setBusy(true);
      try{
        await grant(checked?2:1);
        toast('success','Đã cập nhật',displayName+' — '+(checked?'Duyệt 5đ':'Duyệt 2đ')+'.');refresh();
      }catch(e){cb5.checked=!checked;toast('error','Không cập nhật được',e.message);setBusy(false);}
    });
  });
}
function otherAuthoritySectionHtml(admins,caps){
  return '<section class="phf-comp-section"><h2>'+icon('gear')+'Quyền khác</h2>'
    +'<p class="phf-comp-em-sub" style="margin:-4px 0 12px">Quản trị chương trình và quyền xem tiến độ toàn công ty — tách riêng khỏi bảng phân quyền xét duyệt ở trên.</p>'
    +adminGrantCardHtml(admins)
    +capabilityGrantCardHtml(caps)
  +'</section>';
}
function adminGrantCardHtml(admins){
  return '<div class="phf-comp-card" style="margin-top:12px"><h3 style="margin:0 0 8px;font-size:13.5px">Quản trị chương trình</h3>'
    +(admins.length?'<div class="phf-comp-table-wrap"><table class="phf-comp-table"><thead><tr><th>Mã NV</th><th>Trạng thái</th><th></th></tr></thead><tbody>'
      +admins.map(function(a){return '<tr><td data-th="Mã NV">'+esc(a.employeeCode)+(a.displayName?' · '+esc(a.displayName):'')+'</td><td data-th="Trạng thái">'+(a.isActive?'Đang hoạt động':'Đã thu hồi')+'</td>'
        +'<td>'+(a.isActive?'<button type="button" class="phf-comp-btn is-ghost" data-comp-revoke-admin="'+esc(a.accountId)+'" style="padding:6px 10px;font-size:12px">Thu hồi</button>':'')+'</td></tr>';}).join('')
      +'</tbody></table></div>':emptyState('users','Chưa có Quản trị chương trình bổ sung nào.'))
    +'<div class="phf-comp-actions" style="padding-top:14px;flex-wrap:wrap">'
      +'<input type="text" data-new-adm-acc placeholder="Mã tài khoản" style="max-width:160px">'
      +'<input type="text" data-new-adm-emp placeholder="Mã nhân viên" style="max-width:140px">'
      +'<input type="text" data-new-adm-reason placeholder="Lý do cấp quyền" style="max-width:220px">'
      +'<button type="button" class="phf-comp-btn" data-comp-add-admin>+ Cấp quyền quản trị</button>'
    +'</div>'
    +'<div class="phf-comp-note">'+icon('info')+'<span>Admin hệ thống PHF tự động có toàn quyền Quản trị chương trình. Đây là cấp bổ sung cho nhân sự cụ thể.</span></div>'
  +'</div>';
}
function wireAdminGrantSection(body,refresh){
  var addBtn=body.querySelector('[data-comp-add-admin]');
  if(addBtn)addBtn.addEventListener('click',async function(){
    var acc=body.querySelector('[data-new-adm-acc]').value.trim();
    var emp=body.querySelector('[data-new-adm-emp]').value.trim();
    var reason=body.querySelector('[data-new-adm-reason]').value.trim();
    if((!acc&&!emp)||!reason){toast('error','Thiếu thông tin','Cần mã định danh và lý do.');return;}
    addBtn.disabled=true;
    try{await call('competitionSetAdminGrant',{account_id:acc,employee_code:emp,reason:reason});toast('success','Đã cấp quyền quản trị','');refresh();}
    catch(e){toast('error','Không cấp được',e.message);addBtn.disabled=false;}
  });
  body.querySelectorAll('[data-comp-revoke-admin]').forEach(function(btn){
    btn.addEventListener('click',async function(){
      var reason=window.prompt('Lý do thu hồi quyền quản trị:');if(!reason){return;}
      btn.disabled=true;
      try{await call('competitionSetAdminGrant',{account_id:btn.getAttribute('data-comp-revoke-admin'),active:false,reason:reason});toast('success','Đã thu hồi','');refresh();}
      catch(e){toast('error','Không thu hồi được',e.message);btn.disabled=false;}
    });
  });
}
function capabilityGrantCardHtml(caps){
  return '<div class="phf-comp-card" style="margin-top:12px"><h3 style="margin:0 0 8px;font-size:13.5px">Xem tiến độ tham gia toàn công ty</h3>'
    +(caps.length?'<div class="phf-comp-table-wrap"><table class="phf-comp-table"><thead><tr><th>Mã NV</th><th>Trạng thái</th><th></th></tr></thead><tbody>'
      +caps.map(function(a){return '<tr><td data-th="Mã NV">'+esc(a.employeeCode)+(a.displayName?' · '+esc(a.displayName):'')+'</td><td data-th="Trạng thái">'+(a.isActive?'Đang hoạt động':'Đã thu hồi')+'</td>'
        +'<td>'+(a.isActive?'<button type="button" class="phf-comp-btn is-ghost" data-comp-revoke-cap="'+esc(a.accountId)+'" style="padding:6px 10px;font-size:12px">Thu hồi</button>':'')+'</td></tr>';}).join('')
      +'</tbody></table></div>':emptyState('users','Chưa có ai được cấp quyền xem tiến độ toàn công ty.'))
    +'<div class="phf-comp-actions" style="padding-top:14px;flex-wrap:wrap">'
      +'<input type="text" data-new-cap-acc placeholder="Mã tài khoản" style="max-width:160px">'
      +'<input type="text" data-new-cap-emp placeholder="Mã nhân viên" style="max-width:140px">'
      +'<button type="button" class="phf-comp-btn" data-comp-add-cap>+ Cấp quyền</button>'
    +'</div>'
    +'<div class="phf-comp-note">'+icon('info')+'<span>Quyền này KHÔNG cấp quyền xét duyệt và không gắn với phòng ban.</span></div>'
  +'</div>';
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
  slot.innerHTML=adminHeroHtml('Chốt chương trình','Kiểm tra, xem kết quả nội bộ và chốt chương trình để công bố.')
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
              +'<td data-th="Số tiền">'+esc(Number(a.amountVnd).toLocaleString('vi-VN'))+' đ</td><td data-th="Trạng thái">'+esc(awardStatusLabel(a.status))+'</td>'
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
  'ket-qua':screenLeaderboard,'cho-duyet':screenReviewQueue,'quan-ly':screenAdminCampaigns,'xet-duyet':screenAdminApproval,'chot':screenAdminFinalize
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
      +'<button type="button" class="phf-comp-home-btn" data-comp-home aria-label="Về trang chủ PHF HR">'+icon('home')+'<span>Trang chủ</span></button>'
      +'<img src="assets/logo/phf-logo.png" alt="PHUHOA FRESH" class="phf-comp-logo" width="152" height="32" decoding="async">'
      +'<span class="phf-comp-brand-rule" aria-hidden="true"></span>'
      +'<span class="phf-comp-brand"><b>Chương trình thi đua</b><small>PHF HR</small></span>'
    +'</header>'
    +'<div data-comp-identity-slot></div>'
    +'<div class="phf-comp-body" data-comp-nav-slot>'
      +navLoadingHtml()
      +'<div class="phf-comp-main" data-comp-slot>'+skeletonHtml([40,95,88,72,90,60])+'</div>'
    +'</div>'
  +'</div></div>';

  // C4.4 — clear way back to PHF HR Home, honoring the CURRENT namespace/
  // session (reuses the router's own role->home mapping, same convention
  // Checklist's hubPath()/data-phfck-hub back button already uses — never
  // hardcodes /admin when the session is actually /ql or /hv).
  var homeBtn=main.querySelector('[data-comp-home]');
  if(homeBtn)homeBtn.addEventListener('click',function(e){
    e.preventDefault();
    var home=(typeof window.phfGetRoleHomePath==='function'&&window.phfGetRoleHomePath())||(prefix()+'/home');
    go(home);
  });

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

  var identitySlot=main.querySelector('[data-comp-identity-slot]');
  if(identitySlot)identitySlot.outerHTML=identityHeaderHtml(boot);

  var navEl=navSlot.querySelector('nav');
  if(navEl)navEl.outerHTML=navHtml(boot,key);
  wireNavLinks();

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
