/* PHF Classroom 27.6.12.4.7 - khung giao diện, chưa nối Supabase */
(function(){
  'use strict';
  var VERSION='27.6.12.4.7.2';
  function role(){try{return String((window.phfGetSessionRole&&window.phfGetSessionRole())||((window.phfGetAuthenticatedUser&&window.phfGetAuthenticatedUser()||{}).role)||'learner').toLowerCase();}catch(e){return 'learner';}}
  function user(){try{return window.phfGetAuthenticatedUser?window.phfGetAuthenticatedUser():null;}catch(e){return null;}}
  function name(){var u=user()||{};return String(u.name||u.display_name||u.email||'PHF').trim();}
  function isManage(){return role()==='admin'||role()==='manager';}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function setUrl(path,replace){try{history[replace?'replaceState':'pushState']({phfClassroom:true,path:path},'',path);}catch(e){}}
  function setContext(label){
    var mini=document.getElementById('miniStatus');if(mini)mini.textContent=label;
    var title=document.getElementById('contextTitle');if(title)title.textContent='Bạn đang ở: '+label;
    var sub=document.getElementById('contextSub');if(sub)sub.textContent='PHF Classroom là không gian quản lý lớp đào tạo, điểm danh, tài liệu đã giảng và kết quả dài hạn.';
    var act=document.getElementById('contextAction');if(act)act.textContent=isManage()?(role()==='admin'?'Admin':'Quản lý'):'Nhân viên';
  }
  function leaveMode(){document.body.classList.remove('phf-classroom-mode');}
  function goHub(){leaveMode();setUrl(isManage()?'/overview':'/my-lessons');if(isManage()&&window.phfRenderTrainingOverview)window.phfRenderTrainingOverview();else if(window.phfGoLearning)window.phfGoLearning();}
  function navHtml(active){
    if(!isManage()) return '<div><div class="phfc-nav-label">Cá nhân</div><nav class="phfc-nav"><button class="active" type="button">Lớp đào tạo của tôi</button><button type="button">Lịch đào tạo</button><button type="button">Kết quả của tôi</button></nav></div>';
    return '<div><div class="phfc-nav-label">Điều hành</div><nav class="phfc-nav"><button class="active" type="button">Tổng quan</button><button type="button">Đề xuất đào tạo</button><button type="button">Lớp đào tạo</button><button type="button">Lịch đào tạo</button></nav></div><div><div class="phfc-nav-label">Vận hành lớp</div><nav class="phfc-nav"><button type="button">Điểm danh</button><button type="button">Tài liệu đã giảng</button><button type="button">Bài kiểm tra</button><button type="button">Kết quả đào tạo</button></nav></div>'+(role()==='admin'?'<div><div class="phfc-nav-label">Quản trị</div><nav class="phfc-nav"><button type="button">Báo cáo</button><button type="button">Cài đặt Classroom</button></nav></div>':'');
  }
  function shell(content,title,desc){
    return '<section class="phfc-shell"><div class="phfc-layout"><aside class="phfc-sidebar"><div class="phfc-brand"><strong>PHF CLASSROOM</strong><span>Quản lý đào tạo nội bộ</span></div>'+navHtml('home')+'<div class="phfc-side-bottom">Một phần của hệ sinh thái PHUHOA FRESH<br>Phiên bản khung '+VERSION+'</div></aside><main class="phfc-main"><div class="phfc-topline"><div class="phfc-title"><small>PHF Classroom</small><h2>'+esc(title)+'</h2><p>'+esc(desc)+'</p></div><button class="phfc-back" type="button" onclick="phfClassroomGoHub()">← Quay lại Training Hub</button></div>'+content+'</main></div></section>';
  }
  function renderManager(){
    var main=document.getElementById('mainLesson');if(!main)return;
    setContext('PHF Classroom');document.body.classList.add('phf-classroom-mode','phf-module-page-mode');document.body.classList.remove('phf-learning-mode','phf-post-login-home-mode');
    var content='<section class="phfc-hero"><div><h3>Điều phối đào tạo nội bộ rõ ràng và xuyên suốt</h3><p>Khung thử nghiệm cho đề xuất lớp, lịch đào tạo, điểm danh, tài liệu đã giảng, bài kiểm tra và kết quả. Bản này chưa ghi dữ liệu thật.</p></div><div class="phfc-hero-stats"><div class="phfc-hero-stat"><b>03</b><span>Chờ duyệt</span></div><div class="phfc-hero-stat"><b>04</b><span>Đang diễn ra</span></div><div class="phfc-hero-stat"><b>02</b><span>Chờ chốt</span></div></div></section>'+
    '<section class="phfc-kpis"><article class="phfc-card phfc-kpi"><div class="phfc-kpi-top"><div class="phfc-kpi-icon">▤</div><span class="phfc-chip">+2 lớp</span></div><strong>12</strong><p>Lớp đào tạo trong tháng</p></article><article class="phfc-card phfc-kpi"><div class="phfc-kpi-top"><div class="phfc-kpi-icon">◎</div><span class="phfc-chip">+18 người</span></div><strong>86</strong><p>Nhân viên được đào tạo</p></article><article class="phfc-card phfc-kpi"><div class="phfc-kpi-top"><div class="phfc-kpi-icon">✓</div><span class="phfc-chip">Ổn định</span></div><strong>94%</strong><p>Tỷ lệ tham gia</p></article><article class="phfc-card phfc-kpi"><div class="phfc-kpi-top"><div class="phfc-kpi-icon">↗</div><span class="phfc-chip">+4%</span></div><strong>88%</strong><p>Tỷ lệ đạt yêu cầu</p></article></section>'+
    '<section class="phfc-grid"><article class="phfc-card phfc-panel"><div class="phfc-panel-head"><div><h3>Việc cần xử lý</h3><span>Dữ liệu minh họa giao diện</span></div></div><div class="phfc-list"><div class="phfc-row"><div class="phfc-count">3</div><div><b>Đề xuất đào tạo đang chờ duyệt</b><small>Trưởng ca/Quản lý gửi đề xuất</small></div><button type="button">Xem</button></div><div class="phfc-row"><div class="phfc-count">2</div><div><b>Lớp chưa hoàn tất điểm danh</b><small>Admin hoặc người phụ trách được ủy quyền</small></div><button type="button">Mở</button></div><div class="phfc-row"><div class="phfc-count">4</div><div><b>Bài tự luận đang chờ chấm</b><small>Người chấm do Admin phân công</small></div><button type="button">Xem</button></div></div></article><article class="phfc-card phfc-panel"><div class="phfc-panel-head"><div><h3>Lịch đào tạo gần nhất</h3><span>7 ngày tới</span></div></div><div class="phfc-empty"><b>15/07 · Kiến thức sản phẩm</b><br>14:00–16:00 · Phú Lợi · 18 người<br><br><b>17/07 · Quy trình xuất hóa đơn</b><br>09:00–10:30 · Ngô Quyền · 12 người</div></article></section>'+
    '<div class="phfc-note"><b>Phạm vi bản khung:</b> Chưa tạo bảng Supabase, chưa lưu lớp, chưa upload tài liệu và chưa chấm bài thật. Mục tiêu là duyệt vị trí module, route và phong cách giao diện trước.</div>';
    main.innerHTML=shell(content,'Tổng quan Classroom','Điều phối lớp đào tạo và hồ sơ sau giảng dạy.');window.scrollTo({top:0,behavior:'auto'});
  }
  function renderLearner(){
    var main=document.getElementById('mainLesson');if(!main)return;
    setContext('Lớp đào tạo của tôi');document.body.classList.add('phf-classroom-mode','phf-module-page-mode');document.body.classList.remove('phf-learning-mode','phf-post-login-home-mode');
    var content='<section class="phfc-hero"><div><h3>Chào '+esc(name())+'</h3><p>Đây sẽ là nơi xem lớp được phân công, lịch học, tài liệu đã giảng, bài kiểm tra và kết quả đào tạo dài hạn.</p></div><div class="phfc-hero-stats"><div class="phfc-hero-stat"><b>00</b><span>Lớp sắp tới</span></div><div class="phfc-hero-stat"><b>00</b><span>Chưa thi</span></div><div class="phfc-hero-stat"><b>00</b><span>Đã hoàn thành</span></div></div></section><section class="phfc-card phfc-panel" style="margin-top:15px"><div class="phfc-panel-head"><div><h3>Lớp đào tạo của tôi</h3><span>Chưa nối dữ liệu thật</span></div></div><div class="phfc-empty">Khi PHF Classroom được đưa vào vận hành, các lớp được phân công sẽ xuất hiện tại đây. Nhân viên chỉ thấy dữ liệu của chính mình.</div></section>';
    main.innerHTML=shell(content,'Lớp đào tạo của tôi','Lịch học, tài liệu, bài kiểm tra và kết quả cá nhân.');window.scrollTo({top:0,behavior:'auto'});
  }
  function render(){if(isManage())renderManager();else renderLearner();}
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
    var header=document.querySelector('.phf-site-header');if(!header)return;
    var icon=document.getElementById('phfClassroomHeaderIcon');
    if(!icon){
      icon=document.createElement('button');icon.id='phfClassroomHeaderIcon';icon.className='phf-classroom-header-icon';icon.type='button';
      icon.innerHTML=iconSvg()+'<span class="phf-classroom-icon-tip">'+(isManage()?'PHF Classroom':'Lớp đào tạo của tôi')+'</span>';
      icon.setAttribute('aria-label',isManage()?'Mở PHF Classroom':'Mở lớp đào tạo của tôi');icon.onclick=function(){window.phfOpenClassroom();};
    }
    var notif=document.getElementById('phfNotificationWrap'), login=header.querySelector('.phf-login-entry');
    if(notif&&icon.nextSibling!==notif) header.insertBefore(icon,notif);
    else if(!notif&&login&&icon.nextSibling!==login) header.insertBefore(icon,login);
    icon.style.display=user()?'inline-flex':'none';
    var tip=icon.querySelector('.phf-classroom-icon-tip');if(tip)tip.textContent=isManage()?'PHF Classroom':'Lớp đào tạo của tôi';
    syncLearningVisibility();
  }
  function open(){setUrl(isManage()?'/classroom':'/classroom/my-classes');render();ensureHeaderIcon();}
  window.phfOpenClassroom=open;window.phfRenderClassroom=render;window.phfClassroomGoHub=goHub;window.phfClassroomLeaveMode=leaveMode;window.phfHasActiveTrainingHubProgram=hasActiveHubProgram;window.phfSyncTrainingEntryVisibility=syncLearningVisibility;window.phfEnsureClassroomHeaderIcon=ensureHeaderIcon;
  function refreshHeader(){[20,180,700,1500,3000,6000].forEach(function(ms){setTimeout(ensureHeaderIcon,ms);});}
  window.addEventListener('phf-auth-changed',refreshHeader);
  window.addEventListener('phf-training-data-ready',refreshHeader);
  window.addEventListener('focus',refreshHeader);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)refreshHeader();});
  document.addEventListener('DOMContentLoaded',function(){refreshHeader();var h=document.querySelector('.phf-site-header');if(h)new MutationObserver(function(){ensureHeaderIcon();}).observe(h,{childList:true});});
})();
