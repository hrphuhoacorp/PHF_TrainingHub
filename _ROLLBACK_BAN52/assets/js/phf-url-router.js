/* PHF Training Hub - URL router nhẹ, phân quyền route và liên kết an toàn */
(function(){
  'use strict';

  var ROUTE_MARK = '__phfUrlRouterWrapped';
  var ROUTER_VERSION = '1.0.15.1-classroom-shell-lifecycle-router';
  var ROUTER_VERSION_KEY = 'phfUrlRouterVersion';
  var pendingPath = '';
  var applyingRoute = false;
  var observer = null;
  var restoreInFlight = null;
  var nativePushState = history.pushState.bind(history);
  var nativeReplaceState = history.replaceState.bind(history);
  var historyGuardInstalled = false;

  /* Hệ thống cũ còn một lớp history nội bộ chỉ thay state nhưng giữ nguyên URL.
     Khi router URL mới cùng hoạt động, mỗi lần đổi màn có thể sinh hai history
     entry: một entry cùng URL của router cũ và một entry route thật. Kết quả là
     bấm Back/Forward một lần nhìn như không chạy. Chặn riêng entry cũ cùng URL,
     không can thiệp các history entry có URL thật hoặc entry của trình duyệt. */
  function installLegacyHistoryGuard(){
    if(historyGuardInstalled) return;
    historyGuardInstalled=true;
    history.pushState=function(state,title,url){
      var target='';
      try{target=url==null?'':new URL(String(url),location.href).href;}catch(e){target='';}
      var sameUrl=!target||target===location.href;
      if(state&&state.phf===true&&!state.phfUrl&&sameUrl){
        return nativeReplaceState(Object.assign({},history.state||{},state),'',location.href);
      }
      return nativePushState(state,title,url);
    };
    history.replaceState=function(state,title,url){
      return nativeReplaceState(state,title,url);
    };
  }

  function normalizeCurrentHistoryEntry(){
    try{
      var path=cleanPath(location.pathname);
      var state=Object.assign({},history.state||{},{phfUrl:true,path:path});
      nativeReplaceState(state,'',path+(location.search||'')+(location.hash||''));
    }catch(e){}
  }


  function migrateRouteStorage(){
    var previous='';
    try{previous=String(localStorage.getItem(ROUTER_VERSION_KEY)||'');}catch(e){}
    if(previous===ROUTER_VERSION)return;

    /* Chỉ dọn trạng thái điều hướng tạm của các bản router cũ.
       Không xóa hồ sơ, tiến độ học, chỉ số bài học hoặc dữ liệu đăng nhập. */
    try{sessionStorage.removeItem('phfRouteReturnTo');}catch(e){}
    try{localStorage.removeItem('phfCurrentPage');}catch(e){}
    try{localStorage.removeItem('phfLastAdminSubscreen');}catch(e){}
    try{localStorage.removeItem('phfRefreshResumeState');}catch(e){}

    /* Dọn các khóa điều hướng có phạm vi tài khoản cũ, nhưng giữ phfViewStateV1
       và các khóa tiến độ học để người dùng không mất vị trí/nội dung đã học. */
    try{
      var remove=[];
      for(var i=0;i<localStorage.length;i++){
        var k=localStorage.key(i)||'';
        if(k.indexOf('phfLastAdminSubscreen::')===0) remove.push(k);
      }
      remove.forEach(function(k){localStorage.removeItem(k);});
    }catch(e){}

    try{localStorage.setItem(ROUTER_VERSION_KEY,ROUTER_VERSION);}catch(e){}
  }

  function role(){
    try{return String((window.phfGetSessionRole && window.phfGetSessionRole()) || '').toLowerCase();}
    catch(e){return '';}
  }
  function user(){
    try{return window.phfGetAuthenticatedUser ? window.phfGetAuthenticatedUser() : null;}
    catch(e){return null;}
  }
  function authenticated(){return !!user();}
  function cleanPath(value){
    var raw=String(value||'/').trim();
    try{ raw=new URL(raw,location.origin).pathname; }catch(e){ raw='/'; }
    raw=raw.replace(/\/{2,}/g,'/');
    if(raw.length>1) raw=raw.replace(/\/$/,'');
    return raw||'/';
  }
  function safeReturnTo(value){
    var p=cleanPath(value);
    return p.startsWith('/') && !p.startsWith('//') ? p : '/';
  }
  function setUrl(path,replace){
    path=cleanPath(path);
    if(location.pathname===path && !location.search) return;
    var state=Object.assign({},history.state||{},{phfUrl:true,path:path});
    try{ (replace?nativeReplaceState:nativePushState)(state,'',path); }catch(e){}
    updateCopyAction();
  }
  function showToast(type,title,message){
    if(typeof window.phfToast==='function'){
      try{return window.phfToast(type,title,message,3600,'phf-url-router');}catch(e){}
      try{return window.phfToast(message,type);}catch(e){}
    }
  }
  function modal(title,message,primaryText,primaryAction){
    var old=document.getElementById('phfRouteGuardModal'); if(old)old.remove();
    var wrap=document.createElement('div');
    wrap.id='phfRouteGuardModal'; wrap.className='phf-route-modal';
    wrap.innerHTML='<section class="phf-route-modal-card" role="dialog" aria-modal="true" aria-labelledby="phfRouteModalTitle">'
      +'<div class="phf-route-modal-mark">PHF</div><div><h3 id="phfRouteModalTitle"></h3><p></p></div>'
      +'<div class="phf-route-modal-actions"><button type="button" data-close>Quay lại</button><button class="primary" type="button" data-primary></button></div></section>';
    wrap.querySelector('h3').textContent=title;
    wrap.querySelector('p').textContent=message;
    wrap.querySelector('[data-primary]').textContent=primaryText||'Về trang phù hợp';
    function close(){wrap.remove();}
    wrap.addEventListener('click',function(e){if(e.target===wrap||e.target.closest('[data-close]'))close();});
    wrap.querySelector('[data-primary]').onclick=function(){close(); if(typeof primaryAction==='function')primaryAction();};
    document.body.appendChild(wrap);
  }
  function safeHomeForRole(){return role()==='learner'?'/overview':'/home';}
  function deny(){
    var target=safeHomeForRole();
    modal('Không có quyền truy cập','Tài khoản của anh/chị không được cấp quyền xem nội dung này.','Về trang phù hợp',function(){navigate(target,true);});
    setUrl(target,true);
  }
  function requireRoles(roles){
    if(!authenticated()) return false;
    if(roles.indexOf(role())>=0) return true;
    deny(); return false;
  }
  function loginFor(path){
    pendingPath=safeReturnTo(path);
    try{sessionStorage.setItem('phfRouteReturnTo',pendingPath);}catch(e){}
    setUrl('/login',true);
    if(typeof window.phfShowServerLogin==='function') window.phfShowServerLogin();
    else if(typeof window.phfGoLogin==='function') window.phfGoLogin();
    return false;
  }
  function routeNeedsAuth(path){return path!=='/' && path!=='/login';}

  async function waitForAuthTransition(){
    try{
      if(typeof window.phfWaitForAuthTransition==='function') await window.phfWaitForAuthTransition();
      if(typeof window.phfWhenAuthReady==='function') await window.phfWhenAuthReady();
    }catch(e){}
    return authenticated();
  }


  async function waitForTrainingData(maxMs){
    var promise;
    try{ promise = typeof window.phfWhenTrainingDataReady==='function' ? window.phfWhenTrainingDataReady() : null; }catch(e){ promise=null; }
    if(!promise) return true;
    var timeout = new Promise(function(resolve){ setTimeout(function(){ resolve(false); }, Math.max(500, Number(maxMs)||6000)); });
    try{ return await Promise.race([Promise.resolve(promise), timeout]); }catch(e){ return false; }
  }

  async function ensureTrainingData(path){
    var ok=await waitForTrainingData(9000);
    var data=window.__phfLocalData||null;
    if(ok&&data) return true;
    modal('Chưa tải được dữ liệu','Hệ thống chưa nhận được dữ liệu cần thiết cho màn này. Vui lòng thử lại thay vì chờ vô hạn.','Thử lại',function(){navigate(path||location.pathname,true);});
    return false;
  }

  function bytesToToken(buffer){
    var bytes=new Uint8Array(buffer).slice(0,12), out='';
    bytes.forEach(function(b){out+=b.toString(16).padStart(2,'0');});
    return 'emp_'+out;
  }
  async function employeeToken(id){
    var text='PHF_ROUTE_V1|'+String(id||'');
    if(window.crypto&&crypto.subtle&&window.TextEncoder){
      return bytesToToken(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
    }
    var h1=2166136261,h2=2246822519;
    for(var i=0;i<text.length;i++){h1=Math.imul(h1^text.charCodeAt(i),16777619);h2=Math.imul(h2^text.charCodeAt(i),3266489917);}
    return 'emp_'+(h1>>>0).toString(16).padStart(8,'0')+(h2>>>0).toString(16).padStart(8,'0');
  }
  function employees(){var d=window.__phfLocalData||window.localData||{};return Array.isArray(d.employees)?d.employees:[];}
  async function employeeFromToken(token){
    var list=employees();
    for(var i=0;i<list.length;i++) if(await employeeToken(list[i].id)===token) return list[i];
    return null;
  }
  function lessonSlug(item,idx){
    var base=String((item&&(item.id||item.lessonId||item.slug||item.key))||'').trim();
    if(!base){
      var stage=Number(item&&item.stage||0)+1;
      base='new-sales-gd'+stage+'-bai-'+String(Number(idx)+1).padStart(2,'0');
    }
    return base.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  }
  function lessonIndex(slug){
    var list=window.PHF_LESSONS||[];
    for(var i=0;i<list.length;i++) if(lessonSlug(list[i],i)===slug) return i;
    return -1;
  }
  function maxAllowedLessonIndex(){
    var list=window.PHF_LESSONS||[];
    if(!list.length) return 0;
    var max=0;
    try{
      if(window.phfB16LearningGate && typeof window.phfB16LearningGate.computeMaxAllowed==='function'){
        max=Number(window.phfB16LearningGate.computeMaxAllowed());
      }else if(Number.isFinite(Number(window.phfCurrentLessonIndex))){
        max=Number(window.phfCurrentLessonIndex);
      }
    }catch(e){max=0;}
    if(!Number.isFinite(max)) max=0;
    return Math.max(0,Math.min(Math.floor(max),list.length-1));
  }
  function lessonPathByIndex(idx){
    var list=window.PHF_LESSONS||[];
    idx=Math.max(0,Math.min(Number(idx)||0,Math.max(0,list.length-1)));
    return '/lessons/'+lessonSlug(list[idx]||{},idx);
  }
  async function openNearestAllowedLesson(message){
    var idx=maxAllowedLessonIndex();
    var safePath=lessonPathByIndex(idx);
    setUrl(safePath,true);
    if(typeof window.phfGo==='function') await Promise.resolve(window.phfGo(idx));
    else if(typeof window.phfGoLearning==='function') await Promise.resolve(window.phfGoLearning());
    if(message!==false){
      modal('Phần này chưa mở','Vui lòng hoàn thành nội dung hiện tại theo đúng thứ tự. Hệ thống đã đưa bạn về bài gần nhất được phép học.','Đã hiểu');
    }
    return false;
  }

  async function render(path,fromPop){
    path=cleanPath(path); applyingRoute=true;
    try{
      var classroomRoute=/^\/classroom(?:\/|$)/.test(path);
      if(typeof window.phfClassroomSyncMode==='function'){
        try{window.phfClassroomSyncMode(path);}catch(e){}
      }else if(!classroomRoute && typeof window.phfClassroomLeaveMode==='function'){
        try{window.phfClassroomLeaveMode();}catch(e){}
      }
      /* Route Hub phải dọn Classroom trước mọi await/render phía dưới. */
      if(!classroomRoute){
        var classroomRoot=document.getElementById('phfClassroomRoot');
        if(classroomRoot){
          classroomRoot.hidden=true;
          classroomRoot.style.display='none';
          classroomRoot.setAttribute('aria-hidden','true');
          if(classroomRoot.childNodes.length) classroomRoot.replaceChildren();
        }
        var hubApp=document.querySelector('body > .app');
        if(hubApp){
          hubApp.hidden=false;
          hubApp.style.display='';
          hubApp.setAttribute('aria-hidden','false');
          if('inert' in hubApp) hubApp.inert=false;
        }
        document.documentElement.classList.remove('phf-classroom-route');
        if(document.body) document.body.classList.remove('phf-classroom-mode');
      }
      if(path==='/'){
        setUrl('/',!!fromPop);
        /* / luôn là trang giới thiệu công khai, kể cả khi trình duyệt đang có
           phiên. Người dùng chỉ vào module sau khi bấm chức năng tương ứng. */
        if(typeof window.phfForceAnonymousPublicState==='function') window.phfForceAnonymousPublicState('url-home');
        return true;
      }
      if(path==='/login'){
        if(authenticated()) return navigate(safeHomeForRole(),true);
        if(typeof window.phfShowServerLogin==='function') window.phfShowServerLogin();
        else if(typeof window.phfGoLogin==='function') window.phfGoLogin();
        return true;
      }
      if(routeNeedsAuth(path)&&!authenticated()){
        /* Không mở lại màn đăng nhập trong lúc yêu cầu login vừa thành công
           nhưng session/data đang được xác nhận. */
        var transitioning=false;
        try{transitioning=!!(window.phfIsAuthTransitioning&&window.phfIsAuthTransitioning());}catch(e){}
        if(transitioning) await waitForAuthTransition();
        if(!authenticated()) return loginFor(path);
      }

      if(path==='/my-lessons'){
        if(!requireRoles(['learner','manager','admin']))return false;
        if(!await ensureTrainingData(path)) return false;
        if(role()==='learner' && typeof window.phfCanAccessLearning==='function' && !window.phfCanAccessLearning()){
          modal('Chưa được phân công lộ trình học','Tài khoản của bạn hiện chưa có chương trình Training Hub ở trạng thái “Đang học”.','Về Trang chủ',function(){navigate('/overview',true);});
          setUrl('/overview',true);
          await Promise.resolve(window.phfRenderPostLoginHome&&window.phfRenderPostLoginHome());
          return false;
        }
        await Promise.resolve(window.phfGoLearning&&window.phfGoLearning()); return true;
      }
      if(path==='/my-profile'||/^\/my-profile\/(tests|evaluations|probation|commitments)$/.test(path)){
        if(!requireRoles(['learner','manager','admin']))return false;
        if(!await ensureTrainingData(path)) return false;
        await Promise.resolve(window.phfGoMyProfile&&window.phfGoMyProfile()); return true;
      }
      if(path==='/home'){
        if(!requireRoles(['manager','admin']))return false;
        await Promise.resolve(window.phfRenderPostLoginHome&&window.phfRenderPostLoginHome());
        return true;
      }
      if(path==='/overview'){
        /* /overview giữ nguyên Trang chủ cho learner và Tổng quan đào tạo
           cho Admin/Manager. Trang chủ Admin/Manager dùng route riêng /home
           để F5 không bị chuyển nhầm sang Tổng quan. */
        if(role()==='learner'){
          await Promise.resolve(window.phfRenderPostLoginHome&&window.phfRenderPostLoginHome());
          return true;
        }
        if(!requireRoles(['manager','admin']))return false;
        if(!await ensureTrainingData(path)) return false;
        await Promise.resolve(window.phfRenderTrainingOverview&&window.phfRenderTrainingOverview()); return true;
      }
      if(path==='/training-content'){
        if(!requireRoles(['manager','admin']))return false;
        await Promise.resolve(window.phfRenderTrainingLibrary&&window.phfRenderTrainingLibrary()); return true;
      }
      if(path==='/guide'){
        if(!requireRoles(['learner','manager','admin']))return false;
        if(typeof window.phfGoGuide==='function') await Promise.resolve(window.phfGoGuide());
        else if(typeof window.phfRenderGuidePage==='function') await Promise.resolve(window.phfRenderGuidePage());
        return true;
      }
      if(path==='/direct-training-test'){
        if(!requireRoles(['manager','admin']))return false;
        if(typeof window.phfGoDirectTrainingTest==='function') await Promise.resolve(window.phfGoDirectTrainingTest());
        else if(typeof window.phfRenderDirectTrainingTestPage==='function') await Promise.resolve(window.phfRenderDirectTrainingTestPage());
        return true;
      }
      if(path==='/employees'){
        if(!requireRoles(['manager','admin']))return false;
        if(!await ensureTrainingData(path)) return false;
        if(window.phfTrainingRecordsOpen) await Promise.resolve(window.phfTrainingRecordsOpen('employees'));
        else await Promise.resolve(window.phfRenderTrainingOverview&&window.phfRenderTrainingOverview());
        return true;
      }
      var emp=path.match(/^\/employees\/(emp_[a-f0-9]+)(?:\/(tests|evaluations|probation|commitments))?$/);
      if(emp){
        if(!requireRoles(['manager','admin']))return false;
        if(!await ensureTrainingData(path)) return false;
        var employee=await employeeFromToken(emp[1]);
        if(!employee){modal('Không tìm thấy hồ sơ','Liên kết không còn phù hợp hoặc hồ sơ đã được cập nhật.','Mở danh sách nhân viên',function(){navigate('/employees',true);});setUrl('/employees',true);return false;}
        var tab=emp[2]||'overview';
        if(typeof window.phfTrainingRecordsOpenEmployee==='function'){
          var mapped={tests:'tests',evaluations:'evaluations',probation:'probation',commitments:'commitments',overview:'overview'}[tab]||'overview';
          await Promise.resolve(window.phfTrainingRecordsOpenEmployee(employee.id,mapped));
        }
        return true;
      }
      var lesson=path.match(/^\/lessons\/([a-z0-9-]+)$/);
      if(lesson){
        if(!requireRoles(['learner','manager','admin']))return false;
        if(!await ensureTrainingData(path)) return false;
        if(role()==='learner' && typeof window.phfCanAccessLearning==='function' && !window.phfCanAccessLearning()){
          setUrl('/overview',true);
          await Promise.resolve(window.phfRenderPostLoginHome&&window.phfRenderPostLoginHome());
          modal('Chưa được phân công lộ trình học','Bạn chưa có chương trình Training Hub ở trạng thái “Đang học”.','Về Trang chủ',function(){navigate('/overview',true);});
          return false;
        }
        var idx=lessonIndex(lesson[1]);
        if(idx<0){
          modal('Không tìm thấy bài học','Bài học không tồn tại hoặc không thuộc chương trình hiện tại.','Về bài học của tôi',function(){navigate('/my-lessons',true);});
          setUrl('/my-lessons',true);
          await Promise.resolve(window.phfGoLearning&&window.phfGoLearning());
          return false;
        }
        if(role()==='learner' && typeof window.phfCanOpenLessonIndex==='function' && !window.phfCanOpenLessonIndex(idx)){
          return openNearestAllowedLesson(true);
        }
        if(typeof window.phfGo==='function') await Promise.resolve(window.phfGo(idx));
        else await Promise.resolve(window.phfGoLearning&&window.phfGoLearning());
        return true;
      }
      var program=path.match(/^\/programs\/([a-z0-9_-]+)$/);
      if(program){
        if(!requireRoles(['learner','manager','admin']))return false;
        var allowed=['new_sales','new_gift','new_warehouse','new_online','new_store_lead'];
        if(allowed.indexOf(program[1])<0){setUrl('/my-lessons',true);return render('/my-lessons',true);}
        await Promise.resolve(window.phfGoLearning&&window.phfGoLearning()); return true;
      }
      if(path==='/notifications'){
        if(!requireRoles(['learner','manager','admin']))return false;
        await Promise.resolve((role()==='learner'?window.phfGoMyProfile:window.phfRenderTrainingOverview)&& (role()==='learner'?window.phfGoMyProfile():window.phfRenderTrainingOverview()));
        setTimeout(function(){var b=document.querySelector('[data-phf-notification-toggle],.phf-notification-button');if(b)b.click();},120);
        return true;
      }
      if(/^\/classroom(?:\/|$)/.test(path)){
        if(!requireRoles(['learner','manager','admin']))return false;
        var classroomAllowed = role()==='learner'
          ? ['/classroom/my-classes','/classroom/calendar','/classroom/results']
          : ['/classroom','/classroom/proposals','/classroom/classes','/classroom/calendar','/classroom/attendance','/classroom/materials','/classroom/assessments','/classroom/results'];
        if(role()==='admin') classroomAllowed=classroomAllowed.concat(['/classroom/reports','/classroom/settings']);
        var classroomHome = role()==='learner' ? '/classroom/my-classes' : '/classroom';
        if(classroomAllowed.indexOf(path)<0){path=classroomHome;setUrl(path,true);}
        if(typeof window.phfRenderClassroom==='function'){
          await Promise.resolve(window.phfRenderClassroom(path));
          return true;
        }
        setUrl(safeHomeForRole(),true);
        return render(safeHomeForRole(),true);
      }
      if(path==='/admin'||path==='/admin/accounts'){
        if(!requireRoles(['admin']))return false;
        if(path==='/admin/accounts'&&typeof window.phfRenderAccountAdminSafe==='function') await Promise.resolve(window.phfRenderAccountAdminSafe());
        else await Promise.resolve(window.phfRenderAdminManagement&&window.phfRenderAdminManagement());
        return true;
      }
      setUrl(safeHomeForRole(),true); return render(safeHomeForRole(),true);
    }finally{
      var finalPath=cleanPath(location.pathname);
      try{
        if(typeof window.phfClassroomSyncMode==='function') window.phfClassroomSyncMode(finalPath);
      }catch(e){}
      setTimeout(function(){applyingRoute=false;updateCopyAction();},80);
    }
  }

  async function navigate(path,replace){
    path=cleanPath(path); setUrl(path,!!replace); return render(path,false);
  }
  window.phfNavigate=navigate;

  function wrap(name,pathFactory){
    var fn=window[name]; if(typeof fn!=='function'||fn[ROUTE_MARK])return;
    function wrapped(){
      var args=[].slice.call(arguments), result=fn.apply(this,args);
      if(!applyingRoute){Promise.resolve(pathFactory.apply(this,args)).then(function(path){if(path)setUrl(path,false);});}
      return result;
    }
    wrapped[ROUTE_MARK]=true; wrapped.__phfOriginal=fn; window[name]=wrapped;
  }
  function installWrappers(){
    wrap('phfRenderPostLoginHome',function(){return role()==='learner'?'/overview':'/home';});
    wrap('phfGoLearning',function(){return '/my-lessons';});
    wrap('phfGoMyProfile',function(){return '/my-profile';});
    wrap('phfRenderTrainingOverview',function(){return '/overview';});
    wrap('phfRenderTrainingLibrary',function(){return '/training-content';});
    wrap('phfGoGuide',function(){return '/guide';});
    wrap('phfRenderGuidePage',function(){return '/guide';});
    wrap('phfGoDirectTrainingTest',function(){return '/direct-training-test';});
    wrap('phfRenderDirectTrainingTestPage',function(){return '/direct-training-test';});
    wrap('phfRenderAdminManagement',function(){return '/admin';});
    wrap('phfRenderAccountAdminSafe',function(){return '/admin/accounts';});
    wrap('phfTrainingRecordsOpen',function(view){return view==='employees'?'/employees':'';});
    wrap('phfTrainingRecordsOpenEmployee',async function(id,tab){var token=await employeeToken(id),map={tests:'tests',evaluations:'evaluations',probation:'probation',commitments:'commitments',overview:''},suffix=map[tab||'overview'];return '/employees/'+token+(suffix?'/'+suffix:'');});
    wrap('phfHubSetLearnerAndOpen',async function(id,tab){if(tab!=='evaluation')return '';return '/employees/'+await employeeToken(id)+'/evaluations';});
    wrap('phfRenderTrainingLibraryLesson',function(idx){var item=(window.PHF_LESSONS||[])[Number(idx)]||{};return '/lessons/'+lessonSlug(item,Number(idx));});
    wrap('phfGo',function(idx){var item=(window.PHF_LESSONS||[])[Number(idx)]||{};return '/lessons/'+lessonSlug(item,Number(idx));});
  }

  function shareable(path){
    /* Tắt hoàn toàn chức năng Sao chép liên kết trên toàn hệ thống. */
    return false;
  }
  function updateCopyAction(){
    var old=document.getElementById('phfCopyRouteLink');
    if(old)old.remove();
  }
  async function copyCurrentLink(){
    var url=location.origin+cleanPath(location.pathname);
    try{
      await navigator.clipboard.writeText(url);
      showToast('success','Đã sao chép liên kết','Người nhận cần đăng nhập và có quyền phù hợp để xem.');
    }catch(e){
      modal('Sao chép liên kết',url,'Đóng',function(){});
      var p=document.querySelector('#phfRouteGuardModal p'); if(p){p.classList.add('phf-route-copy-text');p.onclick=function(){var r=document.createRange();r.selectNodeContents(p);var s=getSelection();s.removeAllRanges();s.addRange(r);};}
    }
  }
  window.phfCopyCurrentLink=copyCurrentLink;

  function watchUi(){
    if(observer)return;
    var scheduled=false;
    observer=new MutationObserver(function(mutations){
      /* Bỏ qua thay đổi do chính nút Sao chép liên kết tạo ra, tránh vòng lặp
         MutationObserver làm treo tab trình duyệt trên các route như /my-profile. */
      var meaningful=false;
      for(var i=0;i<mutations.length;i++){
        var target=mutations[i].target;
        if(!(target&&((target.id==='phfCopyRouteLink')||(target.closest&&target.closest('#phfCopyRouteLink'))))){meaningful=true;break;}
      }
      if(!meaningful||scheduled)return;
      scheduled=true;
      requestAnimationFrame(function(){
        scheduled=false;
        installWrappers();
        updateCopyAction();
      });
    });
    observer.observe(document.body,{childList:true,subtree:true});
  }
  async function restoreAfterLogin(){
    try{if(typeof window.phfWhenAppReady==='function') await window.phfWhenAppReady();}catch(e){}
    var stored=''; try{stored=sessionStorage.getItem('phfRouteReturnTo')||'';}catch(e){}
    var target=stored||pendingPath;
    if(target&&target!=='/login'){
      var result=await navigate(target,true);
      try{sessionStorage.removeItem('phfRouteReturnTo');}catch(e){}
      pendingPath='';
      return result;
    }
    pendingPath='';
    if(location.pathname==='/login') return navigate(safeHomeForRole(),true);
    return render(location.pathname,true);
  }
  window.addEventListener('phf-auth-changed',function(e){
    /* Đăng nhập thành công đã được phf-server-auth gọi qua
       phfRestoreLastRouteAfterAuth. Không tự khôi phục lần thứ hai tại đây,
       tránh hai luồng cùng render và giữ màn hình ở trạng thái đang tải. */
    if(!(e.detail&&e.detail.user)){
      pendingPath='';
      setUrl('/',true);
    }
  });
  var popstateRun=0;
  window.addEventListener('popstate',function(){
    var run=++popstateRun;
    var path=cleanPath(location.pathname);
    Promise.resolve(render(path,true)).then(function(){
      if(run===popstateRun) normalizeCurrentHistoryEntry();
    }).catch(function(){
      if(run!==popstateRun) return;
      var fallback=safeHomeForRole();
      setUrl(fallback,true);
      render(fallback,true);
    });
  });

  async function waitUntilReady(){
    /* Quan trọng: phải chờ auth trước. phf-server-auth tạo lại Promise appReady
       sau khi biết phiên đăng nhập. Chờ appReady quá sớm có thể giữ một Promise
       cũ không bao giờ được resolve, gây hiện tượng quay mãi. */
    try{
      if(typeof window.phfWhenAuthReady==='function') await window.phfWhenAuthReady();
      if(typeof window.phfWhenAppReady==='function') await window.phfWhenAppReady();
    }catch(e){}
  }

  function releaseBootGuard(){
    try{
      if(window.__phfRouteBootGuardTimer){clearTimeout(window.__phfRouteBootGuardTimer);window.__phfRouteBootGuardTimer=null;}
      document.documentElement.classList.remove('phf-route-boot-pending');
    }catch(e){}
  }

  async function boot(){
    installLegacyHistoryGuard();
    normalizeCurrentHistoryEntry();
    migrateRouteStorage();
    /* Router được nạp sau các module chính nên chỉ cần bọc hàm một lần.
       Không chạy MutationObserver toàn trang khi mỗi màn render, tránh công
       việc lặp không cần thiết sau khi chức năng sao chép link đã tắt. */
    installWrappers();
    window.phfRestoreLastRouteAfterAuth=async function(){
      if(restoreInFlight) return restoreInFlight;
      restoreInFlight=(async function(){
        /* Đây là nơi duy nhất khôi phục deep link sau đăng nhập. Chờ đầy đủ
           session và dữ liệu trước khi kiểm tra quyền hoặc đổi route. */
        try{if(typeof window.phfWhenAppReady==='function') await window.phfWhenAppReady();}catch(e){}
        if(!authenticated()) return false;

        var stored='';try{stored=sessionStorage.getItem('phfRouteReturnTo')||'';}catch(e){}
        var explicitTarget=stored||pendingPath;
        var currentPath=cleanPath(location.pathname);
        var target=explicitTarget||(currentPath!=='/'&&currentPath!=='/login'?currentPath:'');

        /* Trang / là trang giới thiệu công khai. Khi người dùng chủ động đăng
           nhập tại đây mà không có returnTo, không được coi / là màn cần
           khôi phục; phải để luồng đăng nhập mở trang mặc định theo vai trò. */
        if(target&&target!=='/login'&&target!=='/'){
          await navigate(target,true);
          try{sessionStorage.removeItem('phfRouteReturnTo');}catch(e){}
          pendingPath='';
          return true;
        }

        try{sessionStorage.removeItem('phfRouteReturnTo');}catch(e){}
        pendingPath='';
        return false;
      })();
      try{return await restoreInFlight;}finally{restoreInFlight=null;}
    };
    await waitUntilReady();
    installWrappers();
    var current=cleanPath(location.pathname);
    /* Auth đã dựng trực tiếp route đầu tiên (đặc biệt /admin/accounts) thì
       router không render chồng thêm một lần sau F5. */
    if(window.__phfAuthHandledInitialRoute){
      window.__phfAuthHandledInitialRoute=false;
      updateCopyAction();
      releaseBootGuard();
      return;
    }
    if(current==='/login'&&!authenticated()){
      try{var q=new URLSearchParams(location.search).get('returnTo');if(q){pendingPath=safeReturnTo(q);sessionStorage.setItem('phfRouteReturnTo',pendingPath);}}catch(e){}
    }
    try{
      await render(current,true);
      updateCopyAction();
    }finally{
      releaseBootGuard();
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
