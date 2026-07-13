/* PHF Classroom 1.0 - workspace giao diện nền tảng, chưa nối dữ liệu lớp */
(function(){
  'use strict';
  var VERSION='59.2';
  var ROUTES={
    manager:[
      {group:'Điều hành',items:[['/classroom','Tổng quan'],['/classroom/proposals','Đề xuất đào tạo'],['/classroom/classes','Lớp đào tạo'],['/classroom/calendar','Lịch đào tạo']]},
      {group:'Vận hành lớp',items:[['/classroom/attendance','Điểm danh'],['/classroom/materials','Tài liệu đã giảng'],['/classroom/assessments','Bài kiểm tra'],['/classroom/results','Kết quả đào tạo']]}
    ],
    learner:[
      {group:'Cá nhân',items:[['/classroom/my-classes','Lớp đào tạo của tôi'],['/classroom/calendar','Lịch đào tạo'],['/classroom/results','Kết quả của tôi']]}
    ]
  };
  function role(){try{return String((window.phfGetSessionRole&&window.phfGetSessionRole())||((window.phfGetAuthenticatedUser&&window.phfGetAuthenticatedUser()||{}).role)||'learner').toLowerCase();}catch(e){return 'learner';}}
  function user(){try{return window.phfGetAuthenticatedUser?window.phfGetAuthenticatedUser():null;}catch(e){return null;}}
  function name(){var u=user()||{};return String(u.name||u.display_name||u.email||'PHF').trim();}
  function isManage(){return role()==='admin'||role()==='manager';}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function cleanPath(v){var p=String(v||location.pathname||'/').split('?')[0].split('#')[0].replace(/\/{2,}/g,'/');if(p.length>1)p=p.replace(/\/$/,'');return p||'/';}
  function setUrl(path,replace){try{history[replace?'replaceState':'pushState']({phfClassroom:true,path:path},'',path);}catch(e){}}
  function isClassroomPath(path){
    return /^\/(?:classroom|admin\/classroom|ql\/classroom|hv\/classroom)(?:\/|$)/.test(cleanPath(path||location.pathname));
  }
  function classroomRoot(){return document.getElementById('phfClassroomRoot');}
  function goHub(){
    var target=isManage()?'/overview':'/my-lessons';
    if(typeof window.phfNavigate==='function') return window.phfNavigate(target);
    location.href=target;
  }
  function routeGroups(){
    var groups=(isManage()?ROUTES.manager:ROUTES.learner).slice();
    if(role()==='admin') groups.push({group:'Quản trị',items:[['/classroom/reports','Báo cáo'],['/classroom/settings','Cài đặt Classroom']]});
    return groups;
  }
  function allowedPaths(){var out=[];routeGroups().forEach(function(g){g.items.forEach(function(i){out.push(i[0]);});});return out;}
  function normalizeRoute(path){
    path=cleanPath(path);
    var allowed=allowedPaths();
    if(allowed.indexOf(path)>=0)return path;
    return isManage()?'/classroom':'/classroom/my-classes';
  }
  function navigate(path,replace){
    path=normalizeRoute(path);
    if(typeof window.phfNavigate==='function')return window.phfNavigate(path,!!replace);
    setUrl(path,!!replace);render(path);return true;
  }
  function iconImg(){return '<img src="assets/images/classroom/phf-classroom-brand-icon.png" alt="" aria-hidden="true">';}
  function navHtml(active){
    return routeGroups().map(function(group){
      return '<section class="phfc-nav-group"><div class="phfc-nav-label">'+esc(group.group)+'</div><nav class="phfc-nav">'+group.items.map(function(item){
        return '<button class="'+(item[0]===active?'active':'')+'" type="button" data-phfc-route="'+esc(item[0])+'" aria-current="'+(item[0]===active?'page':'false')+'">'+esc(item[1])+'</button>';
      }).join('')+'</nav></section>';
    }).join('');
  }
  function shell(content,title,desc,active){
    var label=role()==='admin'?'Admin':(role()==='manager'?'Quản lý':'Nhân viên');
    return '<section class="phfc-shell">'+
      '<header class="phfc-header"><button class="phfc-hub-back" type="button" data-phfc-back><span aria-hidden="true">←</span><span><strong>PHF Training Hub</strong><small>Quay lại hệ thống đào tạo</small></span></button><div class="phfc-header-brand">'+iconImg()+'<div><strong>PHF Classroom</strong><span>Quản lý đào tạo nội bộ</span></div></div><div class="phfc-header-user"><span>'+esc(name())+'</span><small>'+esc(label)+'</small></div></header>'+
      '<div class="phfc-layout"><aside class="phfc-sidebar"><div class="phfc-sidebar-brand">'+iconImg()+'<div><strong>PHF Classroom</strong><span>Đào tạo nội bộ</span></div></div>'+navHtml(active)+'<div class="phfc-side-bottom">Một phần của hệ sinh thái PHUHOA FRESH</div></aside><main class="phfc-main"><div class="phfc-topline"><div class="phfc-title"><small>PHF Classroom</small><h2>'+esc(title)+'</h2><p>'+esc(desc)+'</p></div></div>'+content+'</main></div></section>';
  }
  function emptyState(title,copy){return '<section class="phfc-card phfc-panel phfc-empty-panel"><div class="phfc-empty-icon">▦</div><h3>'+esc(title)+'</h3><p>'+esc(copy)+'</p></section>';}
  function zeroKpis(){
    return '<section class="phfc-kpis">'+[
      ['▤','0','Lớp đào tạo trong tháng'],['◎','0','Nhân viên được đào tạo'],['✓','—','Tỷ lệ tham gia'],['↗','—','Tỷ lệ đạt yêu cầu']
    ].map(function(x){return '<article class="phfc-card phfc-kpi"><div class="phfc-kpi-icon">'+x[0]+'</div><strong>'+x[1]+'</strong><p>'+x[2]+'</p></article>';}).join('')+'</section>';
  }
  function brandHero(){
    return '<section class="phfc-brand-hero" aria-label="PHF Classroom"><img src="assets/images/classroom/phf-classroom-entry-approved.png" alt="PHF Classroom - Quản lý đào tạo nội bộ"><div class="phfc-brand-hero-overlay"><span>PHF Classroom</span><strong>Quản lý đào tạo nội bộ</strong><small>Lớp đào tạo · Tài liệu · Điểm danh · Bài kiểm tra</small></div></section>';
  }
  function overview(){
    return brandHero()+'<section class="phfc-hero phfc-hero-light"><div><span class="phfc-eyebrow">Tổng quan đào tạo</span><h3>Điều phối đào tạo nội bộ rõ ràng và xuyên suốt</h3><p>Các lớp học, lịch đào tạo, điểm danh và kết quả sẽ được tổng hợp tại một nơi.</p></div><div class="phfc-hero-stats"><div class="phfc-hero-stat"><b>0</b><span>Chờ duyệt</span></div><div class="phfc-hero-stat"><b>0</b><span>Đang diễn ra</span></div><div class="phfc-hero-stat"><b>0</b><span>Chờ hoàn tất</span></div></div></section>'+zeroKpis()+'<section class="phfc-grid"><article class="phfc-card phfc-panel"><div class="phfc-panel-head"><div><h3>Việc cần xử lý</h3><span>Cập nhật theo hoạt động của lớp</span></div></div><div class="phfc-empty">Hiện chưa có việc đào tạo cần xử lý.</div></article><article class="phfc-card phfc-panel"><div class="phfc-panel-head"><div><h3>Lịch đào tạo gần nhất</h3><span>7 ngày tới</span></div></div><div class="phfc-empty">Chưa có lịch đào tạo sắp tới.</div></article></section>';
  }
  function pageMeta(path){
    var map={
      '/classroom':['Tổng quan Classroom','Theo dõi toàn cảnh hoạt động đào tạo nội bộ.'],
      '/classroom/proposals':['Đề xuất đào tạo','Tiếp nhận và theo dõi nhu cầu đào tạo từ các bộ phận.'],
      '/classroom/classes':['Lớp đào tạo','Xem toàn bộ lớp học và trạng thái triển khai.'],
      '/classroom/my-classes':['Lớp đào tạo của tôi','Theo dõi các lớp được phân công, lịch học và nội dung liên quan.'],
      '/classroom/calendar':['Lịch đào tạo','Theo dõi các buổi học sắp diễn ra.'],
      '/classroom/attendance':['Điểm danh','Theo dõi tình trạng tham gia từng buổi đào tạo.'],
      '/classroom/materials':['Tài liệu đã giảng','Quản lý tài liệu được sử dụng trong các lớp đào tạo.'],
      '/classroom/assessments':['Bài kiểm tra','Theo dõi bài kiểm tra và người được phân công chấm.'],
      '/classroom/results':['Kết quả đào tạo','Xem kết quả học tập và tình trạng hoàn thành.'],
      '/classroom/reports':['Báo cáo Classroom','Tổng hợp dữ liệu đào tạo phục vụ quản trị.'],
      '/classroom/settings':['Cài đặt Classroom','Thiết lập danh mục và quy tắc vận hành Classroom.']
    };
    return map[path]||map[isManage()?'/classroom':'/classroom/my-classes'];
  }
  function pageContent(path){
    if(path==='/classroom')return overview();
    if(path==='/classroom/my-classes')return '<section class="phfc-hero phfc-hero-light"><div><span class="phfc-eyebrow">Dành cho bạn</span><h3>Chào '+esc(name())+'</h3><p>Các lớp được phân công, lịch học, bài kiểm tra và kết quả cá nhân sẽ hiển thị tại đây.</p></div><div class="phfc-hero-stats"><div class="phfc-hero-stat"><b>0</b><span>Lớp sắp tới</span></div><div class="phfc-hero-stat"><b>0</b><span>Chưa hoàn thành</span></div><div class="phfc-hero-stat"><b>0</b><span>Đã hoàn thành</span></div></div></section>'+emptyState('Chưa có lớp đào tạo','Khi được phân công, lớp đào tạo của bạn sẽ xuất hiện tại đây.');
    var m=pageMeta(path);return emptyState('Chưa có dữ liệu',m[1]);
  }
  function bindShell(main){
    var back=main.querySelector('[data-phfc-back]');if(back)back.addEventListener('click',goHub);
    main.querySelectorAll('[data-phfc-route]').forEach(function(btn){btn.addEventListener('click',function(){navigate(btn.getAttribute('data-phfc-route'));});});
  }
  function render(path){
    var root=classroomRoot();if(!root)return false;
    path=normalizeRoute(path||location.pathname);
    if(!isClassroomPath(path)) return false;
    if(cleanPath(location.pathname)!==path)setUrl(path,true);
    var meta=pageMeta(path);
    document.title=meta[0]+' · PHF Classroom';
    root.innerHTML=shell(pageContent(path),meta[0],meta[1],path);
    bindShell(root);
    /* Một route Hub có thể đã thắng trong cùng tick; không để render Classroom cũ hiện lại. */
    if(!isClassroomPath(location.pathname)){
      return false;
    }
    try{root.scrollTop=0;window.scrollTo({top:0,left:0,behavior:'auto'});}catch(e){}
    return true;
  }
  function norm(v){return String(v==null?'':v).trim().toLowerCase();}
  function digits(v){return String(v||'').replace(/\D/g,'');}
  function currentProfile(){
    var u=user()||{}, d=window.__phfLocalData||window.localData||{}, list=Array.isArray(d.employees)?d.employees:[];
    var id=String(u.employee_id||u.employeeId||'').trim(), found=null;
    function rowId(row){return String(row&&((row.id)||row.employee_id||row.employeeId)||'').trim();}
    if(id){
      found=list.find(function(e){return rowId(e)===id;})||null;
      if(!found&&window.currentProfile&&rowId(window.currentProfile)===id) found=window.currentProfile;
      if(!found){
        try{
          var x=JSON.parse(localStorage.getItem('phfEmployeeProfile')||'null');
          if(x&&rowId(x)===id) found=x;
        }catch(e){}
      }
      /* Có employee_id nhưng dữ liệu hồ sơ chưa tải xong: không được lấy nhầm hồ sơ của phiên/người khác. */
      return found||{};
    }
    if(window.currentProfile&&rowId(window.currentProfile)) found=window.currentProfile;
    if(!found){try{var x=JSON.parse(localStorage.getItem('phfEmployeeProfile')||'null');if(x&&rowId(x))found=x;}catch(e){}}
    return found||{};
  }
  function explicitHubAssignment(profile){
    profile=profile||{};
    var truthy=['trainingHubActive','training_hub_active','hasActiveTrainingProgram','has_active_training_program','activeTrainingProgram'];
    for(var i=0;i<truthy.length;i++) if(profile[truthy[i]]===true||norm(profile[truthy[i]])==='true') return true;
    var status=norm(profile.trainingProgramStatus||profile.training_program_status||profile.programStatus||profile.program_status);
    if(['active','assigned','in_progress','in-progress','ongoing','dang_hoc','đang học'].indexOf(status)>=0) return true;
    var assignments=profile.trainingPrograms||profile.training_programs||profile.programAssignments||profile.program_assignments||[];
    if(Array.isArray(assignments)&&assignments.some(function(a){var st=norm(a&&((a.status)||a.state));return a&&a.active===true||['active','assigned','in_progress','in-progress','ongoing'].indexOf(st)>=0;})) return true;
    return false;
  }
  function isExistingStaff(profile){
    var staff=Array.isArray(window.PHF_EXISTING_STAFF)?window.PHF_EXISTING_STAFF:[];
    if(!staff.length||!profile) return false;
    var code=norm(profile.employeeCode||profile.employee_code||profile.code), phone=digits(profile.phone), email=norm(profile.email||profile.personalEmail||profile.personal_email||profile.workEmail||profile.work_email);
    return staff.some(function(s){
      if(code&&code===norm(s.employeeCode)) return true;
      if(phone&&phone===digits(s.phone)) return true;
      var emails=[s.workEmail,s.personalEmail,s.suggestedEmail].map(norm).filter(Boolean);
      return !!(email&&emails.indexOf(email)>=0);
    });
  }
  function hasProgress(profile){
    var d=window.__phfLocalData||window.localData||{}, map=d.progress||{}, id=String(profile&&profile.id||'');
    var rec=id&&map[id]?map[id]:null;
    if(!rec) return false;
    var pages=rec.completedPages||rec.completed_pages||[];
    return !!((Array.isArray(pages)&&pages.length)||rec.currentPage||rec.current_page||rec.lastViewedPage||rec.last_viewed_page);
  }
  function hasActiveHubProgram(){
    var r=role(), u=user()||{}, p=currentProfile()||{};
    if(r!=='learner') return false;
    var status=norm(u.hubAssignmentStatus||u.hub_assignment_status||p.hubAssignmentStatus||p.hub_assignment_status);
    return status==='active';
  }
  function syncLearningVisibility(){
    var learning=document.querySelector('.phf-main-nav [data-phf-main-nav="learning"]');
    if(!learning||role()!=='learner') return;
    var show=hasActiveHubProgram();
    learning.style.setProperty('display',show?'':'none',show?'':'important');
    learning.hidden=!show;
    learning.setAttribute('aria-hidden',show?'false':'true');
    if(show){learning.textContent='Bài học của tôi';learning.onclick=function(){if(window.phfGoLearning)window.phfGoLearning();};}
  }
  function iconSvg(){
    return '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 10c4-5 9-5 13-4-1 5-4 9-10 10" fill="#58b52b"/><path d="M22 12c-2-4-5-6-8-7 0 4 2 7 7 9" fill="#93c900"/><circle cx="24" cy="19" r="8" fill="#f1c400"/><path d="M24 11v16M16 19h16M18.3 13.3l11.4 11.4M29.7 13.3L18.3 24.7" stroke="#fff" stroke-width="1.7" opacity=".95"/><path d="M8 28c6-1 11 1 16 5v10c-5-4-10-6-16-5V28Z" fill="#2c633b"/><path d="M40 28c-6-1-11 1-16 5v10c5-4 10-6 16-5V28Z" fill="#3f7b48"/><path d="M24 33v10" stroke="#fff" stroke-width="1.5"/></svg>';
  }
  function ensureHeaderIcon(){
    if(isClassroomPath(location.pathname)) return;
    var header=document.querySelector('.phf-site-header');if(!header)return;
    var icons=document.querySelectorAll('#phfClassroomHeaderIcon');
    for(var i=1;i<icons.length;i++)icons[i].remove();
    var icon=icons[0]||null;
    if(!icon){
      icon=document.createElement('button');icon.id='phfClassroomHeaderIcon';icon.className='phf-classroom-header-icon';icon.type='button';
      icon.innerHTML=iconSvg()+'<span class="phf-classroom-icon-tip">PHF Classroom</span>';
      icon.setAttribute('aria-label','Mở PHF Classroom');icon.onclick=function(){window.phfOpenClassroom();};
    }
    var notif=document.getElementById('phfNotificationWrap'), login=header.querySelector('.phf-login-entry');
    if(notif&&icon.nextSibling!==notif) header.insertBefore(icon,notif);
    else if(!notif&&login&&icon.nextSibling!==login) header.insertBefore(icon,login);
    else if(!icon.parentNode)header.appendChild(icon);
    icon.style.display=user()?'inline-flex':'none';
    syncLearningVisibility();
  }
  function open(){var r=role();return window.phfNavigate?window.phfNavigate(r==='admin'?'/admin/classroom':(r==='manager'?'/ql/classroom':'/hv/classroom')):navigate(r==='learner'?'/classroom/my-classes':'/classroom');}
  window.phfOpenClassroom=open;
  window.phfRenderClassroom=render;
  window.phfClassroomNavigate=navigate;
  window.phfClassroomGoHub=goHub;
  window.phfHasActiveTrainingHubProgram=hasActiveHubProgram;
  window.phfSyncTrainingEntryVisibility=syncLearningVisibility;
  window.phfEnsureClassroomHeaderIcon=ensureHeaderIcon;
  function refreshHeader(){
    if(isClassroomPath(location.pathname))return;
    window.requestAnimationFrame(function(){ensureHeaderIcon();});
  }
  window.addEventListener('phf-auth-changed',function(){
    if(!user()&&isClassroomPath(location.pathname)){
      if(typeof window.phfNavigate==='function')window.phfNavigate('/login',true);
      return;
    }
    refreshHeader();
  });
  window.addEventListener('phf-training-data-ready',refreshHeader);
  document.addEventListener('DOMContentLoaded',function(){
    /* Router là nguồn duy nhất quyết định shell đang hiển thị. */
    refreshHeader();
  });
  if(document.readyState!=='loading') refreshHeader();
})();
