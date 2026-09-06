(function(){
'use strict';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function role(){try{return window.phfGetSessionRole?window.phfGetSessionRole():'learner';}catch(e){return 'learner';}}
function prefix(){var r=role();return r==='admin'?'/admin':(r==='manager'?'/ql':'/hv');}
function currentUser(){try{return (window.phfGetCurrentUser&&window.phfGetCurrentUser())||(window.phfGetAuthenticatedUser&&window.phfGetAuthenticatedUser())||null;}catch(e){return null;}}
function userName(){var u=currentUser()||{};return String(u.fullName||u.full_name||u.name||u.displayName||u.display_name||u.email||'Anh/chị').trim();}
function initials(){var n=userName().replace(/@.*$/,'').trim().split(/\s+/).filter(Boolean);if(!n.length)return 'PH';return (n.length===1?n[0].slice(0,2):n[0].charAt(0)+n[n.length-1].charAt(0)).toUpperCase();}
function userCode(){var u=currentUser()||{};return String(u.employeeCode||u.employee_code||u.code||u.username||'').trim();}
function roleLabel(){var r=role();return r==='admin'?'Quản trị hệ thống':(r==='manager'?'Quản lý':'Nhân viên');}
async function logout(){try{if(typeof window.phfLogoutSession==='function')await window.phfLogoutSession();else location.href='/';}catch(e){console.error('[PHF HR] logout failed',e);location.href='/';}}
function go(path){if(window.phfNavigate)return window.phfNavigate(path);location.href=path;}
function icon(type){
  var paths={
    hub:'<path d="M3 10.5 12 6l9 4.5-9 4.5-9-4.5Z"/><path d="M7 13v4.2c2.9 2.2 7.1 2.2 10 0V13"/><path d="M21 11v6"/>',
    classroom:'<path d="M4 18v-8.5A2.5 2.5 0 0 1 6.5 7H12v11H6a2 2 0 0 0-2 2Z"/><path d="M20 18v-8.5A2.5 2.5 0 0 0 17.5 7H12v11h6a2 2 0 0 1 2 2Z"/>',
    checklist:'<path d="M9 4h6l1 2h3v15H5V6h3l1-2Z"/><path d="m8 11 1.8 1.8L13 9.5M8 17h7"/>',
    knl:'<path d="M4 19V9M10 19V5M16 19v-7M22 19V3"/><path d="m3 14 6-5 5 2 8-7"/>',
    lock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    people:'<circle cx="9" cy="8" r="3"/><path d="M3.5 19v-2.2A4.8 4.8 0 0 1 8.3 12h1.4a4.8 4.8 0 0 1 4.8 4.8V19M16 8.5a2.5 2.5 0 0 1 0 5M17 14c2.2.4 3.5 1.7 3.5 4v1"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    calendar:'<path d="M5 4v3M19 4v3M4 9h16M5 6h14a1 1 0 0 1 1 1v13H4V7a1 1 0 0 1 1-1Z"/>',
    tasks:'<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.3 2.3 0 1 1 3.6 1.9c-.9.6-1.4 1-1.4 2.1M12 17h.01"/>',
    notice:'<path d="M5 12h3l8-5v10l-8-5H5v5H3V7h2v5ZM16 9c2 1 2 5 0 6"/>',
    gear:'<circle cx="12" cy="12" r="2.7"/><path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.55 1.55M7.15 16.85 5.6 18.4M18.4 18.4l-1.55-1.55M7.15 7.15 5.6 5.6"/>',
    home:'<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
    chevron:'<path d="m6 9 6 6 6-6"/>',
    menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
    inbox:'<path d="M4 13h4l2 3h4l2-3h4"/><path d="M5 5h14l2 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5L5 5Z"/>',
    send:'<path d="M4 12 20 4l-6 16-3-7-7-1Z"/>',
    chart:'<path d="M4 19h16"/><path d="M7 16V9M12 16V5M17 16v-4"/>',
    book:'<path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Z"/><path d="M5 16h13"/>',
    award:'<circle cx="12" cy="9" r="5"/><path d="m9 13-1.5 8L12 18l4.5 3L15 13"/>',
    trophy:'<path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"/><path d="M8 5H5v2a3 3 0 0 0 3 3M16 5h3v2a3 3 0 0 1-3 3"/><path d="M12 12v4M9 20h6M10 16h4l1 4H9l1-4Z"/>',
    sparkles:'<path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4Z"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z"/>',
    quote:'<path d="M7 7h4v4c0 2.5-1.5 4-4 5M14 7h4v4c0 2.5-1.5 4-4 5"/>',
    grid:'<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    arrow:'<path d="M5 12h13"/><path d="m12 6 6 6-6 6"/>',
    sprout:'<path d="M12 20v-8"/><path d="M12 12C12 8 9 6 5 6c0 4 3 6 7 6Z"/><path d="M12 13c0-3 2.5-5 6-5 0 3.5-2.5 5-6 5Z"/>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+(paths[type]||'')+'</svg>';
}
function journeyIcon(type){return '<span class="phf-hr-journey-icon">'+icon(type)+'</span>';}
window.phfOpenHrModule=function(module){var p=prefix();var map={people:p+'/nhan-su',hub:p,classroom:p+'/classroom',checklist:p+'/checklist',knl:p+'/knl',task:p+'/task'};return go(map[module]||(p+'/home'));};
function taskHomeSoonNotice(message){
  if(typeof window.phfToast==='function'){window.phfToast('info','Sắp triển khai',message,3200,'phf-hr-home-soon');return;}
  try{window.alert(message);}catch(e){}
}

/* Checklist workspace/capability — nguồn chuẩn duy nhất cho Home + Bottom Nav +
   Slide Menu. Chỉ đọc (getChecklistRoleWorkspace có sẵn), cache trong phiên,
   không gọi lại khi F5/chuyển route/quay lại Home nếu đã có dữ liệu hợp lệ.
   Không dùng localStorage làm nguồn quyền chuẩn - chỉ giữ trong biến JS. */
var workspaceCache=null,workspacePromise=null;
window.phfEnsureChecklistWorkspace=function(force){
  if(workspaceCache&&!force)return Promise.resolve(workspaceCache);
  if(workspacePromise&&!force)return workspacePromise;
  workspacePromise=fetch('/api/data?checklistRoleWorkspace=1&t='+Date.now(),{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json','Accept':'application/json','Cache-Control':'no-cache'},
    body:JSON.stringify({action:'getChecklistRoleWorkspace'})
  }).then(function(res){
    return res.json().catch(function(){return {};}).then(function(data){
      if(!res.ok||data.ok===false)throw new Error(data.message||data.error||'Không tải được dữ liệu quyền Checklist.');
      return data;
    });
  }).then(function(data){workspaceCache=data;workspacePromise=null;return data;})
    .catch(function(err){workspacePromise=null;console.warn('[PHF HR] Không tải được workspace Checklist:',err&&err.message||err);return null;});
  return workspacePromise;
};
window.phfResetChecklistWorkspaceCache=function(){workspaceCache=null;workspacePromise=null;};
/* Chuẩn hoá capability thật từ server (không suy diễn theo role/tên chức danh/tên preset).
   Admin bypass hoàn toàn bảng grant (đúng theo lib/checklist-permissions.js), nên tự
   quy về phạm vi all_company. workspace.role==='learner' bao gồm cả tài khoản manager
   chưa có grant nào đang hiệu lực - đúng ý "capability-first", không phải role gốc. */
window.phfDeriveChecklistCapabilities=function(workspace){
  var allScope={type:'all_company',values:[]},noneScope={type:'none',values:[]};
  var sessionRole=role();
  if(sessionRole==='admin'||(workspace&&workspace.role==='admin')){
    return {experience:'admin',canRecordViolation:true,recordScope:allScope,canReview:true,reviewScope:allScope,
      canViewReport:true,reportScope:allScope,canExport:true,exportScope:allScope,
      canManageUsers:true,canManageSystem:true,canViewOwnIssues:true};
  }
  var grant=(workspace&&workspace.grant)||null,caps=(grant&&grant.capabilities)||{};
  return {
    experience:grant?'operator':'worker',
    canRecordViolation:!!(workspace&&workspace.canRecordViolation),
    recordScope:(workspace&&workspace.recordScope)||noneScope,
    canReview:caps.review_monthly===true,
    reviewScope:(grant&&grant.reviewScope)||noneScope,
    canViewReport:caps.view_reports===true,
    reportScope:(grant&&grant.viewScope)||noneScope,
    canExport:!!(workspace&&workspace.canExport),
    exportScope:(workspace&&workspace.exportScope)||noneScope,
    canManageUsers:false,canManageSystem:false,
    canViewOwnIssues:!!(workspace&&workspace.ownAssignment)
  };
};
function scopeLabel(scopeValue){
  if(!scopeValue||scopeValue.type==='none')return '';
  if(scopeValue.type==='all_company')return 'Toàn công ty';
  if(scopeValue.type==='direct_reports')return 'Nhân viên quản lý trực tiếp';
  var values=Array.isArray(scopeValue.values)?scopeValue.values.filter(Boolean):[];
  if(scopeValue.type==='department')return values.length?('Phòng '+values.join(', ')):'Phòng ban được cấp';
  if(scopeValue.type==='branch')return values.length?('Chi nhánh '+values.join(', ')):'Chi nhánh được cấp';
  if(scopeValue.type==='department_branch')return values.length?values.join(', '):'Phạm vi được cấp';
  if(scopeValue.type==='employees')return 'Danh sách nhân viên được chỉ định';
  return '';
}
window.phfChecklistScopeLabel=scopeLabel;
/* Chỉ hiển thị chip khi có capability thật, không làm Home nháy: ẩn cho tới
   khi dữ liệu về, không có state chờ giữa chừng. Lỗi API không phá Home -
   workspace null thì derive trả toàn false/none, tự ẩn (an toàn mặc định).
   Action Card "GHI NHẬN LỖI" đã bỏ khỏi Home - shortcut ghi nhận chỉ xuất hiện
   trong ngữ cảnh Checklist, không làm Home mang cảm giác của module nghiệp vụ. */
function applyCapabilityChip(main){
  var chip=main.querySelector('[data-phf-hr-scope]');
  window.phfEnsureChecklistWorkspace().then(function(workspace){
    if(!document.body.contains(main))return;
    var caps=window.phfDeriveChecklistCapabilities(workspace);
    if(chip){
      var label='';
      if(caps.canRecordViolation)label='Ghi nhận: '+scopeLabel(caps.recordScope);
      else if(caps.canReview)label='Thẩm định: '+scopeLabel(caps.reviewScope);
      else if(caps.canViewReport)label='Báo cáo: '+scopeLabel(caps.reportScope);
      if(label){chip.textContent=label;chip.hidden=false;}else chip.hidden=true;
    }
  });
}
/* PHF HR Home V1 — parent navigation model. Every href is an EXISTING router
   route (see assets/js/phf-url-router.js ROUTE_TABLE); nothing is invented.
   Role gating here is a UX convenience only — the router role guard remains the
   real backstop on every navigation. */
function hrNavModel(){
  var p=prefix(),r=role();
  var isMgr=(r==='manager'||r==='admin'),isAdmin=(r==='admin');
  var mgrPrefix=isAdmin?'/admin':'/ql';
  // "Trang chủ" nav item intentionally removed — the user is already on Home
  // (redundant). Mega-menu groups below are the real navigation surface.
  var model=[];
  // Công việc — module-level children only (PHF Task's internal areas stay inside PHF Task).
  model.push({key:'cong-viec',label:'Công việc',children:[
    {label:'PHF Task',href:p+'/task',icon:'tasks'},
    {label:'Lịch làm việc & Chấm công',soon:true,icon:'calendar'},
    // Quản trị tổng hợp — module CHƯA XÂY trên Home V1: placeholder cho MỌI role,
    // không route (route /admin/quan-tri hiện có là khu Quản trị chung của Training
    // Hub, KHÔNG phải module QTTH của PHF HR Home).
    {label:'Quản trị tổng hợp',soon:true,icon:'gear'},
    {label:'Thông báo',soon:true,icon:'notice'}
  ]});
  // Phát triển nhân sự — module-level people-development spaces.
  var ptns=[{label:'Training Hub',href:p,icon:'hub'},{label:'Classroom',href:p+'/classroom',icon:'classroom'},{label:'Khung năng lực',href:p+'/knl',icon:'knl'}];
  if(isMgr)ptns.push({label:'Nội dung đào tạo',href:mgrPrefix+'/noi-dung',icon:'book'});
  model.push({key:'phat-trien',label:'Đào tạo & Phát triển',children:ptns});
  // Đánh giá — Checklist only for V1 (Khung năng lực lives under Phát triển nhân sự).
  model.push({key:'danh-gia',label:'Đánh giá',children:[
    {label:'Checklist',href:p+'/checklist',icon:'checklist'}
  ]});
  model.push({key:'thi-dua',label:'Thi đua & Thưởng',children:[
    {label:'Chương trình thi đua',href:p+'/thi-dua',icon:'trophy'},
    {label:'Thưởng Hành động V.2',soon:true,icon:'sparkles'}
  ]});
  // Báo cáo / Quản trị — mirror the existing "Hệ thống & Báo cáo" body group
  // 1:1 (same two entries, same real/soon status, same /admin/nhan-su route
  // for Quản trị hệ thống) so the top nav offers the same reachable surface
  // as the body cards, per the approved reference's top-nav composition.
  // No new route/module — this only exposes what already exists.
  model.push({key:'bao-cao',label:'Báo cáo',children:[
    {label:'Báo cáo & Thống kê',soon:true,icon:'chart'}
  ]});
  model.push({key:'quan-tri',label:'Quản trị',children:[
    {label:'Quản trị hệ thống',href:isAdmin?'/admin/nhan-su':null,disabled:!isAdmin,note:'Dành cho quản trị viên',icon:'gear'}
  ]});
  return model;
}
/* Source-of-truth for the PHF HR web navigation hierarchy (parent → child).
   Exported so the shared mobile drawer (assets/js/phf-mobile-nav.js) can render
   the SAME hierarchy as a Classroom-style accordion — mobile is a projection of
   this model, never a separately-maintained flat taxonomy. Role/soon/disabled
   flags here are UX only; the router guard + server stay authoritative. */
window.phfHrNavModel=hrNavModel;
function hrNavHtml(model){
  var out='<nav class="phf-hr-nav" data-phf-hr-nav aria-label="Điều hướng PHF HR">';
  model.forEach(function(it){
    if(!it.children){
      out+='<a class="phf-hr-nav-item'+(it.current?' is-active':'')+'" href="'+esc(it.href)+'" data-phf-hr-nav-link="'+esc(it.href)+'"'+(it.current?' aria-current="page"':'')+'>'+esc(it.label)+'</a>';
      return;
    }
    var panelId='phfHrMega-'+it.key;
    out+='<div class="phf-hr-nav-group" data-phf-hr-nav-group="'+esc(it.key)+'">'
      +'<button type="button" class="phf-hr-nav-item phf-hr-nav-trigger" aria-haspopup="true" aria-expanded="false" aria-controls="'+panelId+'" data-phf-hr-mega-trigger>'
        +esc(it.label)+'<span class="phf-hr-nav-caret" aria-hidden="true">'+icon('chevron')+'</span></button>'
      +'<div class="phf-hr-megamenu" id="'+panelId+'" role="menu" aria-label="'+esc(it.label)+'" hidden>';
    it.children.forEach(function(c){
      if(c.soon){
        out+='<span class="phf-hr-mega-item is-soon" role="menuitem" aria-disabled="true">'
          +'<span class="phf-hr-mega-ico">'+icon(c.icon||'notice')+'</span>'
          +'<span class="phf-hr-mega-text">'+esc(c.label)+'</span>'
          +'<span class="phf-hr-mega-soon">Sắp triển khai</span></span>';
        return;
      }
      if(c.disabled){
        out+='<span class="phf-hr-mega-item is-disabled" role="menuitem" aria-disabled="true">'
          +'<span class="phf-hr-mega-ico">'+icon(c.icon||'grid')+'</span>'
          +'<span class="phf-hr-mega-text">'+esc(c.label)+'</span>'
          +(c.note?'<span class="phf-hr-mega-soon is-muted">'+esc(c.note)+'</span>':'')+'</span>';
        return;
      }
      out+='<a class="phf-hr-mega-item" role="menuitem" href="'+esc(c.href)+'" data-phf-hr-nav-link="'+esc(c.href)+'">'
        +'<span class="phf-hr-mega-ico">'+icon(c.icon||'grid')+'</span>'
        +'<span class="phf-hr-mega-text">'+esc(c.label)+'</span></a>';
    });
    out+='</div></div>';
  });
  return out+'</nav>';
}
/* Mega-menu + mobile-nav controller. No hover dependency: open on click/Enter/
   Space, close on outside click / Escape (focus returns to trigger). */
function wireHrNav(main){
  var nav=main.querySelector('[data-phf-hr-nav]');
  var toggle=main.querySelector('[data-phf-hr-nav-toggle]');
  if(!nav)return;
  var groups=[].slice.call(nav.querySelectorAll('.phf-hr-nav-group'));
  function closeAll(except){
    groups.forEach(function(g){
      var t=g.querySelector('[data-phf-hr-mega-trigger]'),pnl=g.querySelector('.phf-hr-megamenu');
      if(t===except)return;
      if(t)t.setAttribute('aria-expanded','false');
      if(pnl)pnl.hidden=true;
      g.classList.remove('is-open');
    });
  }
  groups.forEach(function(g){
    var t=g.querySelector('[data-phf-hr-mega-trigger]'),pnl=g.querySelector('.phf-hr-megamenu');
    if(!t||!pnl)return;
    t.addEventListener('click',function(e){
      e.preventDefault();
      var open=t.getAttribute('aria-expanded')==='true';
      closeAll(open?null:t);
      t.setAttribute('aria-expanded',open?'false':'true');
      pnl.hidden=open;
      g.classList.toggle('is-open',!open);
    });
    pnl.addEventListener('keydown',function(e){
      if(e.key==='Escape'){e.stopPropagation();closeAll();try{t.focus();}catch(_e){}}
    });
  });
  nav.addEventListener('click',function(e){
    var link=e.target&&e.target.closest?e.target.closest('[data-phf-hr-nav-link]'):null;
    if(!link)return;
    if(e.metaKey||e.ctrlKey||e.shiftKey||e.button===1)return;
    e.preventDefault();
    closeAll();
    nav.classList.remove('is-open');
    if(toggle)toggle.setAttribute('aria-expanded','false');
    go(link.getAttribute('data-phf-hr-nav-link'));
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){var anyOpen=groups.some(function(g){return g.classList.contains('is-open');});if(anyOpen){closeAll();}}
  });
  document.addEventListener('click',function(e){
    if(!document.body.contains(nav))return;
    if(e.target&&e.target.closest&&e.target.closest('[data-phf-hr-nav],[data-phf-hr-nav-toggle]'))return;
    closeAll();
    nav.classList.remove('is-open');
    if(toggle)toggle.setAttribute('aria-expanded','false');
  });
  if(toggle){
    toggle.addEventListener('click',function(e){
      e.preventDefault();e.stopPropagation();
      var open=toggle.getAttribute('aria-expanded')==='true';
      toggle.setAttribute('aria-expanded',open?'false':'true');
      nav.classList.toggle('is-open',!open);
      if(open)closeAll();
    });
  }
}
/* ---- HOME V1 body: 4 module groups (visual contract phf_hr_home_grouped_demo.html) ----
   Each card carries EITHER a real router href OR soon:true (placeholder). Nothing
   invented. Role gating: cards a role cannot reach render disabled, never a dead link. */
function hrGroupsModel(){
  var p=prefix(),r=role();
  var isAdmin=(r==='admin');
  return [
    {key:'a',icon:'grid',title:'Làm việc hằng ngày',sub:'Các công cụ phục vụ vận hành thường nhật',cols:4,cards:[
      {tint:'green',icon:'tasks',title:'PHF Task',desc:'Giao việc • Theo dõi • Báo cáo',badge:'Đang hoạt động',href:p+'/task'},
      {tint:'blue',icon:'calendar',title:'Lịch làm việc & Chấm công',desc:'Ca làm • Lịch tuần • Chấm công',soon:true},
      // Quản trị tổng hợp — module CHƯA XÂY: placeholder cho mọi role, không route.
      {tint:'purple',icon:'gear',title:'Quản trị tổng hợp',desc:'Vận hành nội bộ • Quy trình • Biểu mẫu',soon:true},
      {tint:'red',icon:'notice',title:'Thông báo',desc:'Tin tức • Quy định • Thông tin chung',soon:true}
    ]},
    {key:'b',icon:'hub',title:'Đào tạo & Phát triển',sub:'Đào tạo, đánh giá và phát triển năng lực',cols:4,cards:[
      {tint:'green',icon:'hub',title:'Training Hub',desc:'Hội nhập • Lộ trình • Khóa học',badge:'Đào tạo',href:p},
      {tint:'blue',icon:'classroom',title:'Classroom',desc:'Lớp học • Tài liệu • Kiểm tra',badge:'Học tập',href:p+'/classroom'},
      {tint:'yellow',icon:'checklist',title:'Checklist',desc:'Tuân thủ • Đánh giá • Cải tiến',badge:'Đánh giá',href:p+'/checklist'},
      {tint:'purple',icon:'knl',title:'Khung năng lực',desc:'Bậc năng lực • Lộ trình phát triển',badge:'Phát triển',href:p+'/knl'}
    ]},
    {key:'c',icon:'award',title:'Thi đua & Thưởng hành động',sub:'Ghi nhận nỗ lực, lan tỏa hành động tích cực',cols:2,cards:[
      {tint:'yellow',icon:'trophy',title:'Chương trình thi đua',desc:'Đóng góp • Xếp hạng • Vinh danh',badge:'Thi đua',href:p+'/thi-dua'},
      {tint:'peach',icon:'sparkles',title:'Thưởng Hành động V.2',desc:'Ghi nhận • Xét thưởng • Lan tỏa',soon:true}
    ]},
    {key:'d',icon:'chart',title:'Hệ thống & Báo cáo',sub:'Dữ liệu, báo cáo và cấu hình hệ thống',cols:2,cards:[
      // Báo cáo & Thống kê — module định hướng, CHƯA triển khai trên Home V1: placeholder, không route.
      {tint:'blue',icon:'chart',title:'Báo cáo & Thống kê',desc:'Nhân sự • Đào tạo • Thi đua • Tổng hợp',soon:true},
      // Quản trị hệ thống — lối vào khu quản trị nhân sự hiện hữu của PHF HR
      // (screen 'employee-master' — Tài khoản & Hồ sơ nhân sự; route thật, Admin-only
      // theo ROUTE_TABLE assets/js/phf-url-router.js). KHÔNG phải /admin/quan-tri (QTTH).
      {tint:'gray',icon:'gear',title:'Quản trị hệ thống',desc:'Tài khoản • Hồ sơ • Phân quyền',badge:'Admin',
        href:isAdmin?'/admin/nhan-su':null,disabled:!isAdmin,disabledNote:'Dành cho quản trị viên'}
    ]}
  ];
}
function hrCardHtml(c){
  var soon=!!c.soon,dis=!!c.disabled;
  var cls='phf-hr-mod tint-'+(c.tint||'green')+(soon?' is-soon':'')+(dis?' is-disabled':'');
  var attr=(!soon&&!dis&&c.href)?(' data-phf-hr-card-href="'+esc(c.href)+'" role="link" tabindex="0"'):' aria-disabled="true"';
  var foot=soon
    ? '<span class="phf-hr-mod-badge is-soon">Sắp triển khai</span>'
    : (dis
        ? '<span class="phf-hr-mod-badge is-muted">'+esc(c.disabledNote||'Chưa khả dụng')+'</span>'
        : '<span class="phf-hr-mod-badge">'+esc(c.badge||'')+'</span><span class="phf-hr-mod-arrow" aria-hidden="true">'+icon('arrow')+'</span>');
  return '<article class="'+cls+'"'+attr+'>'
    +'<div class="phf-hr-mod-top"><span class="phf-hr-mod-ico">'+icon(c.icon||'grid')+'</span>'
      +'<span class="phf-hr-mod-txt"><b>'+esc(c.title)+'</b><span>'+esc(c.desc||'')+'</span></span></div>'
    +'<div class="phf-hr-mod-foot">'+foot+'</div></article>';
}
function hrGroupsHtml(){
  return hrGroupsModel().map(function(g){
    return '<section class="phf-hr-group" aria-label="'+esc(g.title)+'">'
      +'<div class="phf-hr-group-head"><span class="phf-hr-group-ico">'+icon(g.icon)+'</span>'
        +'<span class="phf-hr-group-meta"><h2>'+esc(g.title)+'</h2><span>'+esc(g.sub)+'</span></span></div>'
      +'<div class="phf-hr-grid cols-'+g.cols+'">'+g.cards.map(hrCardHtml).join('')+'</div>'
    +'</section>';
  }).join('');
}
/* ---- HOME V1 sidebar: 4 blocks. Clock = real client time; the other 3 are
   deliberate empty-state / current-calendar shells — NO production data, NO fake numbers. */
var _hrClockTimer=null,_hrMotivTimer=null;
/* Light motivation + office-humour line — hardcoded approved V1 list (no admin
   screen, no attribution, no "PHF says"). Gentle cross-fade, no marquee. */
var PHF_HR_MOTIVATION=[
  'Không cần hoàn hảo. Cần hoàn thành.',
  'Việc hôm nay đừng để ngày mai… thấy vẫn còn.',
  'Deadline không đáng sợ. Quên deadline mới đáng sợ.',
  'Một việc làm xong đáng giá hơn năm việc đang suy nghĩ.',
  'Hôm nay xử lý một chút, mai đỡ xử lý một đống.',
  'Có vấn đề thì báo. Đừng nuôi nó lớn.',
  'Đừng để “đang xử lý” trở thành chức danh.',
  'Hệ thống nhớ dai hơn chúng ta.'
];
/* ---- Vietnamese lunar calendar — deterministic local conversion (Hồ Ngọc Đức
   algorithm, timezone Asia/Ho_Chi_Minh = +7). No network, no geolocation, no
   dependency. Used ONLY to label the day/clock card. ---- */
function hrLunarJd(dd,mm,yy){
  var a=Math.floor((14-mm)/12),y=yy+4800-a,m=mm+12*a-3;
  var jd=dd+Math.floor((153*m+2)/5)+365*y+Math.floor(y/4)-Math.floor(y/100)+Math.floor(y/400)-32045;
  if(jd<2299161)jd=dd+Math.floor((153*m+2)/5)+365*y+Math.floor(y/4)-32083;
  return jd;
}
function hrLunarNewMoon(k){
  var T=k/1236.85,T2=T*T,T3=T2*T,dr=Math.PI/180;
  var Jd1=2415020.75933+29.53058868*k+0.0001178*T2-0.000000155*T3;
  Jd1+=0.00033*Math.sin((166.56+132.87*T-0.009173*T2)*dr);
  var M=359.2242+29.10535608*k-0.0000333*T2-0.00000347*T3;
  var Mpr=306.0253+385.81691806*k+0.0107306*T2+0.00001236*T3;
  var F=21.2964+390.67050646*k-0.0016528*T2-0.00000239*T3;
  var C1=(0.1734-0.000393*T)*Math.sin(M*dr)+0.0021*Math.sin(2*dr*M);
  C1=C1-0.4068*Math.sin(Mpr*dr)+0.0161*Math.sin(dr*2*Mpr);
  C1=C1-0.0004*Math.sin(dr*3*Mpr);
  C1=C1+0.0104*Math.sin(dr*2*F)-0.0051*Math.sin(dr*(M+Mpr));
  C1=C1-0.0074*Math.sin(dr*(M-Mpr))+0.0004*Math.sin(dr*(2*F+M));
  C1=C1-0.0004*Math.sin(dr*(2*F-M))-0.0006*Math.sin(dr*(2*F+Mpr));
  C1=C1+0.0010*Math.sin(dr*(2*F-Mpr))+0.0005*Math.sin(dr*(2*Mpr+M));
  var deltat;
  if(T<-11)deltat=0.001+0.000839*T+0.0002261*T2-0.00000845*T3-0.000000081*T*T3;
  else deltat=-0.000278+0.000265*T+0.000262*T2;
  return Jd1+C1-deltat;
}
function hrLunarSunLongitude(jdn){
  var T=(jdn-2451545.0)/36525,T2=T*T,dr=Math.PI/180;
  var M=357.52910+35999.05030*T-0.0001559*T2-0.00000048*T*T2;
  var L0=280.46645+36000.76983*T+0.0003032*T2;
  var DL=(1.914600-0.004817*T-0.000014*T2)*Math.sin(dr*M);
  DL+=(0.019993-0.000101*T)*Math.sin(dr*2*M)+0.000290*Math.sin(dr*3*M);
  var L=L0+DL;L=L*dr;L=L-Math.PI*2*Math.floor(L/(Math.PI*2));
  return Math.floor(L/Math.PI*6);
}
function hrLunarMonth11(yy,tz){
  var off=hrLunarJd(31,12,yy)-2415021;
  var k=Math.floor(off/29.530588853);
  var nm=Math.floor(hrLunarNewMoon(k)+0.5+tz/24);
  if(hrLunarSunLongitude(nm)>=9){nm=Math.floor(hrLunarNewMoon(k-1)+0.5+tz/24);}
  return nm;
}
function hrLunarLeapOffset(a11,tz){
  var k=Math.floor((a11-2415021.076998695)/29.530588853+0.5);
  var last,arc,i=1;
  do{last=arc;i++;arc=hrLunarSunLongitude(Math.floor(hrLunarNewMoon(k+i)+0.5+tz/24));}while(arc!==last&&i<14);
  return i-1;
}
function hrSolarToLunar(dd,mm,yy){
  var tz=7;
  var dayNumber=hrLunarJd(dd,mm,yy);
  var k=Math.floor((dayNumber-2415021.076998695)/29.530588853);
  var monthStart=Math.floor(hrLunarNewMoon(k+1)+0.5+tz/24);
  if(monthStart>dayNumber)monthStart=Math.floor(hrLunarNewMoon(k)+0.5+tz/24);
  var a11=hrLunarMonth11(yy,tz),b11=a11,lunarYear;
  if(a11>=monthStart){lunarYear=yy;a11=hrLunarMonth11(yy-1,tz);}
  else{lunarYear=yy+1;b11=hrLunarMonth11(yy+1,tz);}
  var lunarDay=dayNumber-monthStart+1;
  var diff=Math.floor((monthStart-a11)/29);
  var lunarMonth=diff+11;
  if(b11-a11>365){
    var leapMonthDiff=hrLunarLeapOffset(a11,tz);
    if(diff>=leapMonthDiff){lunarMonth=diff+10;}
  }
  if(lunarMonth>12)lunarMonth-=12;
  if(lunarMonth>=11&&diff<4)lunarYear-=1;
  return {day:lunarDay,month:lunarMonth,year:lunarYear};
}
function hrLunarYearName(y){
  var can=['Canh','Tân','Nhâm','Quý','Giáp','Ất','Bính','Đinh','Mậu','Kỷ'];
  var chi=['Thân','Dậu','Tuất','Hợi','Tý','Sửu','Dần','Mão','Thìn','Tỵ','Ngọ','Mùi'];
  return can[y%10]+' '+chi[y%12];
}
function hrMotivationHtml(){
  var first=PHF_HR_MOTIVATION[Math.floor(Math.random()*PHF_HR_MOTIVATION.length)];
  return '<div class="phf-hr-motiv" data-hr-motiv>'
    +'<span class="phf-hr-motiv-mark" aria-hidden="true">“</span>'
    +'<p class="phf-hr-motiv-line" data-hr-motiv-line>'+esc(first)+'</p></div>';
}
function hrDayCardHtml(){
  return '<section class="phf-hr-widget phf-hr-daycard">'
    +'<div class="phf-hr-dc-top">'
      +'<div class="phf-hr-dc-greg">'
        +'<span class="phf-hr-dc-weekday" data-hr-clock-date>—</span>'
        +'<span class="phf-hr-dc-time" data-hr-clock-time>--:--:--</span>'
      +'</div>'
      +'<div class="phf-hr-dc-lunar">'
        +'<span class="phf-hr-dc-lunar-label">ÂM LỊCH</span>'
        +'<span class="phf-hr-dc-lunar-dm" data-hr-lunar-dm>—</span>'
        +'<span class="phf-hr-dc-lunar-year" data-hr-lunar-year>—</span>'
      +'</div>'
    +'</div>'
    +hrMotivationHtml()
  +'</section>';
}
function startHrMotivation(main){
  if(_hrMotivTimer){clearInterval(_hrMotivTimer);_hrMotivTimer=null;}
  var line=main.querySelector('[data-hr-motiv-line]');if(!line)return;
  var reduce=false;try{reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches;}catch(e){}
  var idx=PHF_HR_MOTIVATION.indexOf(line.textContent);if(idx<0)idx=0;
  _hrMotivTimer=setInterval(function(){
    if(!document.body.contains(line)){clearInterval(_hrMotivTimer);_hrMotivTimer=null;return;}
    idx=(idx+1)%PHF_HR_MOTIVATION.length;
    var next=PHF_HR_MOTIVATION[idx];
    if(reduce){line.textContent=next;return;}
    line.classList.add('is-fading');
    setTimeout(function(){line.textContent=next;line.classList.remove('is-fading');},420);
  },12000);
}
function hrLocalDateKey(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function hrWeekStripHtml(){
  var now=new Date();var day=(now.getDay()+6)%7;
  var mon=new Date(now);mon.setDate(now.getDate()-day);
  var names=['T2','T3','T4','T5','T6','T7','CN'];var out='';
  for(var i=0;i<7;i++){var d=new Date(mon);d.setDate(mon.getDate()+i);
    var on=(d.toDateString()===now.toDateString());
    out+='<span class="phf-hr-day'+(on?' is-today':'')+'" data-hr-week-day="'+hrLocalDateKey(d)+'">'+names[i]+'<b>'+String(d.getDate()).padStart(2,'0')+'</b></span>';}
  return out;
}
function hrMini(label,key){return '<div class="phf-hr-mini"><span>'+esc(label)+'</span><b data-hr-stat="'+esc(key||'')+'">—</b></div>';}
function hrMonthLabel(){var d=new Date();return 'Tháng '+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();}
function hrSidebarHtml(){
  return ''
  +hrDayCardHtml()
  +'<section class="phf-hr-widget phf-hr-attn is-loading" data-hr-attn><div class="phf-hr-w-head"><h3>Công việc cần chú ý</h3></div>'
    +'<div class="phf-hr-attn-grid">'
      +'<div class="phf-hr-attn-cell is-overdue"><b data-hr-ov="overdue">·</b><span>Quá hạn</span></div>'
      +'<div class="phf-hr-attn-cell is-soon"><b data-hr-ov="due_soon">·</b><span>Sắp đến hạn</span></div>'
      +'<div class="phf-hr-attn-cell is-attn"><b data-hr-ov="attention">·</b><span>Cần chú ý</span></div>'
    +'</div>'
    +'<button type="button" class="phf-hr-attn-cta" data-hr-attn-cta>Xem PHF Task <span aria-hidden="true">→</span></button></section>'
  +'<section class="phf-hr-widget" data-hr-week><div class="phf-hr-w-head"><h3>Lịch trong tuần</h3></div>'
    +'<div class="phf-hr-week">'+hrWeekStripHtml()+'</div>'
    +'<p class="phf-hr-w-note" data-hr-week-note>Đang tải lịch công việc…</p></section>'
  +'<section class="phf-hr-widget"><div class="phf-hr-w-head"><h3>Số liệu nhanh</h3><span>'+esc(hrMonthLabel())+'</span></div>'
    +'<div class="phf-hr-mini-grid">'+hrMini('Nhân sự','employees')+hrMini('Việc hoàn thành','completed')+hrMini('Bài thi đua','competition')+hrMini('Checklist','checklist')+'</div>'
    +'<p class="phf-hr-w-note">Số liệu tổng hợp toàn công ty; “Việc hoàn thành” tính riêng của bạn.</p></section>'
  +'<section class="phf-hr-widget phf-hr-notices is-loading" data-hr-notices><div class="phf-hr-w-head"><h3>Thông báo mới</h3></div>'
    +'<div class="phf-hr-notices-list" data-hr-notices-list></div></section>';
}
/* "Thông báo mới" — real data ONLY: the current session's own PHF Task
 * in-app notifications (listMyTaskNotifications, already live and
 * privacy-checked — see api/_lib/task-notifications.js). This is real
 * activity for the signed-in user, not a fabricated company-announcement
 * feed (no such module exists yet — Home does not invent one). Zero
 * results -> honest empty state, never a fake list. */
function hrTimeAgo(iso){
  if(!iso)return '';
  var d=new Date(iso);if(isNaN(d.getTime()))return '';
  var mins=Math.max(0,Math.round((Date.now()-d.getTime())/60000));
  if(mins<1)return 'Vừa xong';
  if(mins<60)return mins+' phút trước';
  var hrs=Math.round(mins/60);
  if(hrs<24)return hrs+' giờ trước';
  var days=Math.round(hrs/24);
  if(days<7)return days+' ngày trước';
  return d.toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit'});
}
var _hrNoticesSeq=0;
function loadHrNotices(main){
  var wrap=main.querySelector('[data-hr-notices]');if(!wrap)return;
  var list=wrap.querySelector('[data-hr-notices-list]');
  var seq=++_hrNoticesSeq;
  fetch('/api/data',{method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json','Accept':'application/json'},
    body:JSON.stringify({action:'listMyTaskNotifications',limit:5})
  }).then(function(res){
    return res.json().catch(function(){return {};}).then(function(j){return {ok:res.ok&&j&&j.ok!==false,data:j};});
  }).then(function(r){
    if(seq!==_hrNoticesSeq||!document.body.contains(wrap))return;
    wrap.classList.remove('is-loading');
    var result=(r.data&&r.data.result)||r.data||{};
    var rows=(r.ok&&Array.isArray(result.notifications))?result.notifications:null;
    if(!rows||!rows.length){
      list.innerHTML='<div class="phf-hr-w-empty">'+icon('bell')+'<p>Chưa có thông báo mới<span>Thông báo công việc sẽ hiển thị tại đây</span></p></div>';
      return;
    }
    list.innerHTML=rows.slice(0,5).map(function(n){
      return '<a class="phf-hr-notice'+(n.status==='unread'?' is-unread':'')+'" href="'+esc(n.targetPath||prefix()+'/task')+'" data-phf-hr-nav-link="'+esc(n.targetPath||prefix()+'/task')+'">'
        +'<span class="phf-hr-notice-dot" aria-hidden="true"></span>'
        +'<span class="phf-hr-notice-body"><b>'+esc(n.title||'Thông báo')+'</b><span>'+esc(hrTimeAgo(n.createdAt))+'</span></span>'
      +'</a>';
    }).join('');
  }).catch(function(err){
    if(seq!==_hrNoticesSeq||!document.body.contains(wrap))return;
    wrap.classList.remove('is-loading');
    list.innerHTML='<div class="phf-hr-w-empty">'+icon('bell')+'<p>Không tải được thông báo</p></div>';
    try{console.warn('[PHF HR] listMyTaskNotifications lỗi:',err&&err.message||err);}catch(e){}
  });
}
function startHrClock(main){
  if(_hrClockTimer){clearInterval(_hrClockTimer);_hrClockTimer=null;}
  var wd=['Chủ Nhật','Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy'];
  var p2=function(v){return String(v).padStart(2,'0');};
  var lunarKey=null;
  function updateLunar(n){
    var key=n.getFullYear()+'-'+(n.getMonth()+1)+'-'+n.getDate();
    if(key===lunarKey)return;
    lunarKey=key;
    var lu;try{lu=hrSolarToLunar(n.getDate(),n.getMonth()+1,n.getFullYear());}catch(e){return;}
    var dm=main.querySelector('[data-hr-lunar-dm]'),yr=main.querySelector('[data-hr-lunar-year]');
    if(dm)dm.textContent=p2(lu.day)+'/'+p2(lu.month);
    if(yr)yr.textContent='Năm '+hrLunarYearName(lu.year);
  }
  function tick(){
    if(!document.body.contains(main)){if(_hrClockTimer){clearInterval(_hrClockTimer);_hrClockTimer=null;}return;}
    var n=new Date();
    var dEl=main.querySelector('[data-hr-clock-date]'),tEl=main.querySelector('[data-hr-clock-time]');
    if(dEl)dEl.textContent=wd[n.getDay()]+', '+p2(n.getDate())+'/'+p2(n.getMonth()+1)+'/'+n.getFullYear();
    if(tEl)tEl.textContent=p2(n.getHours())+':'+p2(n.getMinutes())+':'+p2(n.getSeconds());
    updateLunar(n);
  }
  tick();_hrClockTimer=setInterval(tick,1000);
}
/* "Công việc cần chú ý" — consumes the AUTHORITATIVE PHF Task Reporting V2
   summary (action getTaskOverviewV2) exactly under its existing scope/authz.
   Home does NOT recompute anything: the 3 numbers are metrics.{overdue,
   due_soon,attention_needed}.value verbatim. Error / unavailable / contract
   mismatch -> "—" (never coerced to 0). Exactly ONE request per render. */
var _hrOverviewSeq=0;
function loadHrOverview(main){
  var wrap=main.querySelector('[data-hr-attn]');if(!wrap)return;
  var seq=++_hrOverviewSeq;
  function setAll(v){wrap.querySelectorAll('[data-hr-ov]').forEach(function(el){el.textContent=v;});}
  function setOne(key,v){var el=wrap.querySelector('[data-hr-ov="'+key+'"]');if(el)el.textContent=v;}
  function num(x){return (x&&typeof x.value==='number'&&isFinite(x.value))?String(x.value):'—';}
  wrap.classList.add('is-loading');
  fetch('/api/data',{method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json','Accept':'application/json'},
    body:JSON.stringify({action:'getTaskOverviewV2'})
  }).then(function(res){
    return res.json().catch(function(){return {};}).then(function(j){return {ok:res.ok&&j&&j.ok!==false,data:j};});
  }).then(function(r){
    if(seq!==_hrOverviewSeq||!document.body.contains(wrap))return;
    wrap.classList.remove('is-loading');
    var result=(r.data&&r.data.result)||r.data||{};
    var m=result&&result.metrics;
    if(!r.ok||!m||result.report_contract_version!==1){setAll('—');return;}
    setOne('overdue',num(m.overdue));
    setOne('due_soon',num(m.due_soon));
    setOne('attention',num(m.attention_needed));
  }).catch(function(err){
    if(seq!==_hrOverviewSeq||!document.body.contains(wrap))return;
    wrap.classList.remove('is-loading');
    setAll('—');
    try{console.warn('[PHF HR] getTaskOverviewV2 lỗi:',err&&err.message||err);}catch(e){}
  });
}
/* "Số liệu nhanh" — 4 independent bounded aggregate reads, each failing on its
   own to "—" (never fabricated 0, never blocks Home or the other cells):
     Nhân sự         getActiveEmployeeCount        -> {count}          "N người"
     Việc hoàn thành getTaskOverviewV2 view:personal -> completed_in_period  "N việc"
                     (self-only for EVERY role — never company-wide)
     Bài thi đua     competitionGetSubmittedTotal  -> {submittedTotal} "N bài"
     Checklist       getChecklistMonthlyFormCount  -> {count}          "N phiếu"
   One request per cell, no polling, no N+1. "Thông báo mới" is untouched. */
var _hrStatsSeq=0;
function loadHrQuickStats(main){
  var grid=main.querySelector('.phf-hr-mini-grid');if(!grid)return;
  var seq=++_hrStatsSeq;
  function setStat(key,text){
    if(seq!==_hrStatsSeq||!document.body.contains(grid))return;
    var el=main.querySelector('[data-hr-stat="'+key+'"]');if(el)el.textContent=text;
  }
  function isNum(v){return typeof v==='number'&&isFinite(v);}
  function one(body,onOk,label){
    fetch('/api/data',{method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify(body)
    }).then(function(res){
      return res.json().catch(function(){return {};}).then(function(j){return {ok:res.ok&&j&&j.ok!==false,data:j};});
    }).then(function(r){
      var result=(r.data&&r.data.result)||r.data||{};
      onOk(r.ok?result:null);
    }).catch(function(err){
      onOk(null);
      try{console.warn('[PHF HR] '+label+' lỗi:',err&&err.message||err);}catch(e){}
    });
  }
  one({action:'getActiveEmployeeCount'},function(x){
    setStat('employees',(x&&isNum(x.count))?(x.count+' người'):'—');
  },'getActiveEmployeeCount');
  one({action:'getTaskOverviewV2',view:'personal'},function(x){
    var cv=x&&x.metrics&&x.metrics.completed_in_period&&x.metrics.completed_in_period.value;
    setStat('completed',(x&&x.report_contract_version===1&&isNum(cv))?(cv+' việc'):'—');
  },'getTaskOverviewV2(personal)');
  one({action:'competitionGetSubmittedTotal'},function(x){
    setStat('competition',(x&&isNum(x.submittedTotal))?(x.submittedTotal+' bài'):'—');
  },'competitionGetSubmittedTotal');
  one({action:'getChecklistMonthlyFormCount'},function(x){
    setStat('checklist',(x&&isNum(x.count))?(x.count+' phiếu'):'—');
  },'getChecklistMonthlyFormCount');
}
/* "Lịch trong tuần" — lightweight projection of the CURRENT USER's own PHF Task
   workload onto the 7 displayed dates. ONE bounded request:
   listTasks({relation:'received', status_filter:'all', limit:200}) — the exact
   same canonical, authenticated, Company-PG-backed source + scope the Task
   Calendar V1 (/…/task/lich) uses. relation:'received' + no scope = strictly
   "tasks assigned to me"; taskRelationshipOnly is enforced server-side so an
   Admin account never widens this to a company-wide view. Home does NOT
   redefine any status: "cần xử lý" = status in {published,in_progress} with a
   deadline (identical to taskCalendar semantics — completed/cancelled/draft
   never counted). No date navigation route exists in Task, so a marked date
   opens the existing /…/task/lich calendar (no invented ?date filter). API
   failure -> calendar still renders, honest neutral note, no fake count. */
var _hrWeekSeq=0;
function loadHrWeekTasks(main){
  var wrap=main.querySelector('[data-hr-week]');if(!wrap)return;
  var note=wrap.querySelector('[data-hr-week-note]');
  var cells=[].slice.call(wrap.querySelectorAll('[data-hr-week-day]'));
  var seq=++_hrWeekSeq;
  var todayKey=hrLocalDateKey(new Date());
  var weekKeys=cells.map(function(c){return c.getAttribute('data-hr-week-day');});
  fetch('/api/data',{method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json','Accept':'application/json'},
    body:JSON.stringify({action:'listTasks',relation:'received',status_filter:'all',limit:200})
  }).then(function(res){
    return res.json().catch(function(){return {};}).then(function(j){return {ok:res.ok&&j&&j.ok!==false,data:j};});
  }).then(function(r){
    if(seq!==_hrWeekSeq||!document.body.contains(wrap))return;
    var result=(r.data&&r.data.result)||r.data||{};
    var rows=(r.ok&&Array.isArray(result.tasks))?result.tasks:null;
    if(!rows){
      if(note)note.textContent='Tạm thời chưa xem được lịch công việc.';
      return;
    }
    // "active / cần xử lý" — same rule as taskCalendar: has a deadline and is
    // still open. completed / cancelled / anything else is not counted.
    var perDay={},todayCount=0,weekCount=0;
    rows.forEach(function(t){
      if(t.status!=='published'&&t.status!=='in_progress')return;
      if(!t.deadline)return;
      var d=new Date(t.deadline);if(isNaN(d.getTime()))return;
      var key=hrLocalDateKey(d);
      if(weekKeys.indexOf(key)===-1)return;
      perDay[key]=(perDay[key]||0)+1;
      if(key===todayKey)todayCount++;else weekCount++;
    });
    cells.forEach(function(c){
      var k=c.getAttribute('data-hr-week-day'),n=perDay[k]||0;
      if(n>0){
        c.classList.add('has-task');
        c.setAttribute('title',n+' công việc đến hạn');
        c.setAttribute('role','link');c.setAttribute('tabindex','0');
      }
    });
    if(note){
      if(todayCount>0)note.textContent='Hôm nay có '+todayCount+' công việc đến hạn.';
      else if(weekCount>0)note.textContent='Tuần này còn '+weekCount+' công việc cần xử lý.';
      else note.textContent='Tuần này chưa có công việc cần chú ý.';
    }
  }).catch(function(err){
    if(seq!==_hrWeekSeq||!document.body.contains(wrap))return;
    if(note)note.textContent='Tạm thời chưa xem được lịch công việc.';
    try{console.warn('[PHF HR] listTasks (Lịch trong tuần) lỗi:',err&&err.message||err);}catch(e){}
  });
  wrap.addEventListener('click',function(e){
    var cell=e.target&&e.target.closest?e.target.closest('.phf-hr-day.has-task'):null;
    if(cell)go(prefix()+'/task/lich');
  });
  wrap.addEventListener('keydown',function(e){
    if(e.key!=='Enter'&&e.key!==' ')return;
    var cell=e.target&&e.target.closest?e.target.closest('.phf-hr-day.has-task'):null;
    if(cell){e.preventDefault();go(prefix()+'/task/lich');}
  });
}
function wireHrCards(main){
  main.querySelectorAll('[data-phf-hr-card-href]').forEach(function(el){
    var href=el.getAttribute('data-phf-hr-card-href');
    el.addEventListener('click',function(){go(href);});
    el.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();go(href);}});
  });
  main.querySelectorAll('.phf-hr-mod.is-soon').forEach(function(el){
    el.addEventListener('click',function(){taskHomeSoonNotice('Chức năng này sẽ được triển khai trong giai đoạn tiếp theo.');});
  });
  var attnCta=main.querySelector('[data-hr-attn-cta]');
  if(attnCta)attnCta.addEventListener('click',function(){go(prefix()+'/task');});
  var noticesList=main.querySelector('[data-hr-notices-list]');
  if(noticesList)noticesList.addEventListener('click',function(e){
    var link=e.target&&e.target.closest?e.target.closest('.phf-hr-notice'):null;
    if(!link)return;
    if(e.metaKey||e.ctrlKey||e.shiftKey||e.button===1)return;
    e.preventDefault();go(link.getAttribute('href'));
  });
}
window.phfRenderHrGateway=function(requestedPath){
  var actualPath=String((window.location&&window.location.pathname)||'/').split('?')[0].split('#')[0].replace(/\/{2,}/g,'/');
  if(actualPath.length>1)actualPath=actualPath.replace(/\/$/,'');
  actualPath=actualPath||'/';
  var targetPath=String(requestedPath||actualPath).split('?')[0].split('#')[0].replace(/\/{2,}/g,'/');
  if(targetPath.length>1)targetPath=targetPath.replace(/\/$/,'');
  targetPath=targetPath||'/';
  var isHrHome=/^\/(?:admin|ql|hv)\/home$/.test(actualPath);
  if(!isHrHome||targetPath!==actualPath){
    if(window.PHFAppShell&&typeof window.PHFAppShell.syncFromRoute==='function'){
      window.PHFAppShell.syncFromRoute(actualPath,{clear:false,restoreTitle:false});
    }
    return false;
  }
  if(window.PHFAppShell)window.PHFAppShell.activateHr({clear:false});
  try{if(typeof phfHideIntroAndStopAuto==='function')phfHideIntroAndStopAuto();}catch(e){}
  document.body.classList.remove('phf-hub-mode','phf-classroom-mode','phf-checklist-mode','phf-knl-mode');
  document.body.classList.add('phf-hr-gateway-mode');
  var main=document.getElementById('phfHrRoot');if(!main)return false;
  var name=esc(userName()),avatar=esc(initials()),code=esc(userCode()),roleText=esc(roleLabel());
  main.innerHTML=`<section class="phf-hr-home" aria-label="Trang chủ PHF HR">
    <header class="phf-hr-topnav">
      <div class="phf-hr-topnav-brand">
        <button type="button" class="phf-hr-nav-toggle" data-phf-hr-nav-toggle aria-expanded="false" aria-label="Mở điều hướng">${icon('menu')}</button>
        <img src="assets/logo/phf-logo.png" alt="PHUHOA FRESH" class="phf-hr-logo" width="152" height="36" decoding="async">
        <span class="phf-hr-brand-rule" aria-hidden="true"></span>
        <span class="phf-hr-brand-name-block"><strong>PHF HR</strong></span>
      </div>
      ${hrNavHtml(hrNavModel())}
      <div class="phf-hr-header-actions"><span class="phf-hr-scope-chip" data-phf-hr-scope hidden></span><button class="phf-hr-bell" type="button" aria-label="Thông báo">${icon('bell')}<span hidden>0</span></button><div class="phf-hr-account-wrap"><button class="phf-hr-account" type="button" aria-haspopup="menu" aria-expanded="false"><span class="phf-hr-avatar">${avatar}</span><span><small>Xin chào,</small><strong>${name}</strong><em>${roleText}${code?' · '+code:''}</em></span><i aria-hidden="true"></i></button><div class="phf-hr-account-menu" role="menu"><div class="phf-hr-account-summary"><strong>${name}</strong><small>${roleText}${code?' · Mã '+code:''}</small></div><button type="button" class="is-danger" data-hr-account="logout">Đăng xuất</button></div></div></div>
    </header>
    <div class="phf-hr-shell">
      <div class="phf-hr-layout">
      <main class="phf-hr-content">
      <section class="phf-hr-hero">
        <div class="phf-hr-hero-media"><img src="assets/images/home/phf-hr-home-hero-2026.png" alt="PHF HR — Nền tảng phát triển nhân sự tại PHUHOA FRESH. Kết nối công việc – Đào tạo – Đánh giá – Thi đua – Quản trị trên một hệ thống, phục vụ người thật, dữ liệu thật, vận hành lâu dài." width="1983" height="793" decoding="async" fetchpriority="high"></div>
      </section>
      ${hrGroupsHtml()}
      </main>
      <aside class="phf-hr-sidebar" data-phf-hr-sidebar aria-label="Khu vực tiện ích">
        ${hrSidebarHtml()}
      </aside>
      </div>
      <footer class="phf-hr-footer">PHF HR – Hệ sinh thái phát triển nhân sự nội bộ | Phòng Quản trị Tổng hợp phụ trách vận hành.</footer>
    </div>
  </section>`;
  main.querySelectorAll('[data-phf-hr-module]').forEach(function(btn){
    btn.addEventListener('click',function(){window.phfOpenHrModule(btn.getAttribute('data-phf-hr-module'));});
    if(btn.tagName!=='BUTTON')btn.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();window.phfOpenHrModule(btn.getAttribute('data-phf-hr-module'));}});
  });
  main.querySelectorAll('[data-phf-hr-soon]').forEach(function(btn){btn.addEventListener('click',function(){taskHomeSoonNotice(btn.getAttribute('data-phf-hr-soon')||'Chức năng sẽ được triển khai trong giai đoạn tiếp theo.');});});
  var account=main.querySelector('.phf-hr-account'),menu=main.querySelector('.phf-hr-account-menu');
  if(account&&menu){account.addEventListener('click',function(e){e.stopPropagation();var open=account.getAttribute('aria-expanded')==='true';account.setAttribute('aria-expanded',open?'false':'true');menu.classList.toggle('is-open',!open);});main.addEventListener('click',function(e){if(!e.target.closest('.phf-hr-account-wrap')){account.setAttribute('aria-expanded','false');menu.classList.remove('is-open');}});}
  main.querySelectorAll('[data-hr-account]').forEach(function(btn){btn.addEventListener('click',function(){var act=btn.getAttribute('data-hr-account');if(act==='logout')return logout();});});
  wireHrNav(main);
  wireHrCards(main);
  startHrClock(main);
  loadHrOverview(main);
  loadHrWeekTasks(main);
  loadHrQuickStats(main);
  loadHrNotices(main);
  document.title='PHF HR · Hệ thống phát triển nhân sự';
  // "Ghi nhận: Toàn công ty" scope chip intentionally NOT populated on Home —
  // it is Checklist-recording context and reads as confusing here. The empty
  // hidden [data-phf-hr-scope] span is kept in the header for structure only.
  startHrMotivation(main);
  try{window.scrollTo({top:0,behavior:'instant'});}catch(e){window.scrollTo(0,0);}return true;
};
})();
