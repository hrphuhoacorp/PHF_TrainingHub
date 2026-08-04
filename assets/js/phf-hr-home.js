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
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    calendar:'<path d="M5 4v3M19 4v3M4 9h16M5 6h14a1 1 0 0 1 1 1v13H4V7a1 1 0 0 1 1-1Z"/>',
    tasks:'<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.3 2.3 0 1 1 3.6 1.9c-.9.6-1.4 1-1.4 2.1M12 17h.01"/>',
    notice:'<path d="M5 12h3l8-5v10l-8-5H5v5H3V7h2v5ZM16 9c2 1 2 5 0 6"/>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+(paths[type]||'')+'</svg>';
}
function journeyIcon(type){return '<span class="phf-hr-journey-icon">'+icon(type)+'</span>';}
window.phfOpenHrModule=function(module){var p=prefix();var map={hub:p,classroom:p+'/classroom',checklist:p+'/checklist',knl:p+'/knl'};return go(map[module]||(p+'/home'));};

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
/* Chỉ hiển thị chip/Action Card khi có capability thật, không làm Home nháy:
   cả hai ẩn cho tới khi dữ liệu về, không có state chờ giữa chừng. Lỗi API
   không phá Home - workspace null thì derive trả toàn false/none, tự ẩn hết
   (an toàn mặc định). Action Card CHỈ đọc recordScope (không dùng viewScope
   hay reviewScope thay cho recordScope) và chỉ hiện khi canRecordViolation
   thật sự true - không suy diễn từ canViewReport/canReview. */
function applyCapabilityChip(main){
  var chip=main.querySelector('[data-phf-hr-scope]');
  var card=main.querySelector('[data-phf-hr-action]');
  var cardScope=main.querySelector('[data-phf-hr-action-scope]');
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
    if(card){
      if(caps.canRecordViolation&&caps.recordScope&&caps.recordScope.type!=='none'){
        if(cardScope)cardScope.textContent='Phạm vi: '+(scopeLabel(caps.recordScope)||'—');
        var r=role();
        card.setAttribute('data-phf-hr-action-route',r==='admin'?'/admin/checklist/ghi-nhan-loi':'/ql/checklist?section=violations');
        card.hidden=false;
      }else card.hidden=true;
    }
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
    <header class="phf-hr-header">
      <div class="phf-hr-brand"><img src="assets/intro/phf-falogo.png" alt="Phuhoafresh - Tươi mới trọn vẹn từ tâm"><span class="phf-hr-brand-rule" aria-hidden="true"></span><div><strong>PHF HR</strong><small>Hệ thống phát triển nhân sự</small></div></div>
      <div class="phf-hr-header-actions"><span class="phf-hr-scope-chip" data-phf-hr-scope hidden></span><button class="phf-hr-bell" type="button" aria-label="Thông báo">${icon('bell')}<span hidden>0</span></button><div class="phf-hr-account-wrap"><button class="phf-hr-account" type="button" aria-haspopup="menu" aria-expanded="false"><span class="phf-hr-avatar">${avatar}</span><span><small>Xin chào,</small><strong>${name}</strong><em>${roleText}${code?' · '+code:''}</em></span><i aria-hidden="true"></i></button><div class="phf-hr-account-menu" role="menu"><div class="phf-hr-account-summary"><strong>${name}</strong><small>${roleText}${code?' · Mã '+code:''}</small></div><button type="button" class="is-danger" data-hr-account="logout">Đăng xuất</button></div></div></div>
    </header>
    <main class="phf-hr-main">
      <button type="button" class="phf-hr-action-card" data-phf-hr-action hidden><span class="phf-hr-action-icon" aria-hidden="true">!</span><span class="phf-hr-action-text"><strong>GHI NHẬN LỖI</strong><small data-phf-hr-action-scope></small></span><span class="phf-hr-action-arrow" aria-hidden="true">→</span></button>
      <section class="phf-hr-hero">
        <div class="phf-hr-hero-copy"><span class="phf-hr-kicker">PHF HR <i aria-hidden="true"></i></span><h1>Nền tảng phát triển nhân sự<br>tại PHUHOA FRESH</h1><p>Kết nối hội nhập, đào tạo, checklist và phát triển năng lực<br>trên một hành trình thống nhất.</p></div>
        <div class="phf-hr-journey" aria-label="Hành trình phát triển nhân sự">
          <div class="phf-hr-flow" aria-hidden="true"><span></span><i></i></div>
          <div class="phf-hr-step is-hub"><b>Bước 1</b><strong>Hội nhập &amp; Lộ trình</strong>${journeyIcon('hub')}<p>Lộ trình hội nhập và<br>đào tạo nhân sự mới</p></div>
          <div class="phf-hr-step is-classroom"><b>Bước 2</b><strong>Đào tạo nội bộ</strong>${journeyIcon('classroom')}<p>Lớp học, tài liệu và<br>bài kiểm tra nội bộ</p></div>
          <div class="phf-hr-step is-checklist"><b>Bước 3</b><strong>Tuân thủ &amp; Đánh giá</strong>${journeyIcon('checklist')}<p>Tuân thủ công việc và<br>đánh giá hằng tháng</p></div>
          <div class="phf-hr-step is-knl"><b>Bước 4</b><strong>Đánh giá &amp; Phát triển</strong>${journeyIcon('knl')}<p>Đánh giá năng lực và<br>xây dựng kế hoạch phát triển</p></div>
        </div>
      </section>
      <section class="phf-hr-modules" aria-label="Các hệ thống PHF HR">
        <article class="is-hub"><div class="phf-hr-card-head"><span>${icon('hub')}</span><div><h2>Training Hub</h2><b>Hội nhập &amp; Lộ trình</b></div></div><p>Học theo lộ trình, hoàn thành bài học, kiểm tra và theo dõi tiến độ học tập.</p><div class="phf-hr-card-status">Lộ trình hội nhập và đào tạo nhân sự mới</div><button type="button" data-phf-hr-module="hub">Truy cập <span>→</span></button></article>
        <article class="is-classroom"><div class="phf-hr-card-head"><span>${icon('classroom')}</span><div><h2>Classroom</h2><b>Đào tạo nội bộ</b></div></div><p>Tham gia lớp học, xem tài liệu, điểm danh và làm bài kiểm tra.</p><div class="phf-hr-card-status">Lớp học, tài liệu và bài kiểm tra nội bộ</div><button type="button" data-phf-hr-module="classroom">Truy cập <span>→</span></button></article>
        <article class="is-checklist"><div class="phf-hr-card-head"><span>${icon('checklist')}</span><div><h2>Checklist</h2><b>Tuân thủ &amp; Đánh giá</b></div></div><p>Thực hiện checklist, ghi nhận lỗi, giải trình và theo dõi điểm đánh giá.</p><div class="phf-hr-card-status">Tuân thủ công việc và đánh giá hằng tháng</div><button type="button" data-phf-hr-module="checklist">Truy cập <span>→</span></button></article>
        <article class="is-knl"><div class="phf-hr-card-head"><span>${icon('knl')}</span><div><h2>Khung năng lực</h2><b>Đánh giá &amp; Phát triển</b></div></div><p>Đánh giá năng lực, xem kết quả và xây dựng kế hoạch phát triển.</p><div class="phf-hr-card-status">Sắp triển khai</div><button type="button" data-phf-hr-module="knl">Truy cập <span>→</span></button></article>
      </section>
      <section class="phf-hr-quick" aria-label="Tiện ích PHF HR"><article>${icon('notice')}<span><strong>Thông báo</strong><small>Các cập nhật mới sẽ hiển thị tại đây</small></span></article><article>${icon('calendar')}<span><strong>Lịch của tôi</strong><small>Lịch đào tạo và công việc được phân công</small></span></article><article>${icon('tasks')}<span><strong>Việc cần làm</strong><small>Các việc cần xử lý theo quyền tài khoản</small></span></article><article>${icon('help')}<span><strong>Hỗ trợ</strong><small>Hướng dẫn sử dụng hệ thống</small></span></article></section>
    </main>
    <footer class="phf-hr-footer">PHF HR – Hệ sinh thái phát triển nhân sự nội bộ | Phòng Quản trị Tổng hợp phụ trách vận hành.</footer>
  </section>`;
  main.querySelectorAll('[data-phf-hr-module]').forEach(function(btn){btn.addEventListener('click',function(){window.phfOpenHrModule(btn.getAttribute('data-phf-hr-module'));});});
  var actionCard=main.querySelector('[data-phf-hr-action]');
  if(actionCard)actionCard.addEventListener('click',function(){var r=actionCard.getAttribute('data-phf-hr-action-route');if(r)go(r);});
  var account=main.querySelector('.phf-hr-account'),menu=main.querySelector('.phf-hr-account-menu');
  if(account&&menu){account.addEventListener('click',function(e){e.stopPropagation();var open=account.getAttribute('aria-expanded')==='true';account.setAttribute('aria-expanded',open?'false':'true');menu.classList.toggle('is-open',!open);});main.addEventListener('click',function(e){if(!e.target.closest('.phf-hr-account-wrap')){account.setAttribute('aria-expanded','false');menu.classList.remove('is-open');}});}
  main.querySelectorAll('[data-hr-account]').forEach(function(btn){btn.addEventListener('click',function(){var act=btn.getAttribute('data-hr-account');if(act==='logout')return logout();});});
  document.title='PHF HR · Hệ thống phát triển nhân sự';
  applyCapabilityChip(main);
  try{window.scrollTo({top:0,behavior:'instant'});}catch(e){window.scrollTo(0,0);}return true;
};
})();
