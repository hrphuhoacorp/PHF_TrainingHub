/* checklist stability baseline: 1.33.1_production_stability */
/* PHF Training Hub - URL router nhẹ, phân quyền route và liên kết an toàn */
(function(){
  'use strict';

  var ROUTE_MARK = '__phfUrlRouterWrapped';
  var ROUTER_VERSION = String((window.PHF_BUILD_INFO&&window.PHF_BUILD_INFO.version)||'1.37.1')+'-'+String((window.PHF_BUILD_INFO&&window.PHF_BUILD_INFO.fingerprint)||'1371-f5-session-myform');
  var ROUTER_VERSION_KEY = 'phfUrlRouterVersion';
  var pendingPath = '';
  var applyingRoute = false;
  var observer = null;
  var restoreInFlight = null;
  var nativePushState = history.pushState.bind(history);
  var nativeReplaceState = history.replaceState.bind(history);
  var historyGuardInstalled = false;
  var routeRenderSequence = 0;
  var routerStarted = false;
  var currentRenderSource = 'system';
  var lastCommittedPath = '';
  var reconcileTimer = null;
  var pageShowInstalled = false;
  var routeGuardOwnerRunId = 0;
  var routeModuleLoads = Object.create(null);
  var routeCssLoads = Object.create(null);
  var ROUTE_MODULES = {
    classroom:{
      src:'assets/js/classroom/phf-classroom-app.js?v=1.30.10_lazy_module',
      renderer:'phfRenderClassroom',
      label:'Classroom'
    },
    checklist:{
      src:(typeof window.phfAssetUrl==='function'?window.phfAssetUrl('/assets/js/checklist/phf-checklist-app.js'):'/assets/js/checklist/phf-checklist-app.js'),
      css:'/assets/css/phf-checklist.css',
      renderer:'phfRenderChecklist',
      label:'Checklist'
    }
  };

  /* PHF Sprint 2 / Commit 1: phf-checklist.css (459KB) trước đây tải trên mọi
     route qua #phf-checklist-css-loader trong index.html, không gate theo
     route. Gate theo route giống hệt cơ chế JS module ở trên: idempotent,
     concurrent calls dùng chung promise, lỗi không chặn render (chỉ log) vì
     thiếu style không phá nghiệp vụ như thiếu renderer. */
  function ensureRouteCss(name){
    var config=ROUTE_MODULES[name];
    if(!config||!config.css) return Promise.resolve(true);
    if(document.querySelector('link[data-phf-route-css="'+name+'"]')) return Promise.resolve(true);
    if(routeCssLoads[name]) return routeCssLoads[name];
    var href=typeof window.phfAssetUrl==='function'?window.phfAssetUrl(config.css):config.css;
    var request=new Promise(function(resolve){
      var link=document.createElement('link');
      link.rel='stylesheet';
      link.href=href;
      link.setAttribute('data-phf-route-css',name);
      link.onload=function(){resolve(true);};
      link.onerror=function(){
        console.error('[PHF ROUTER] route css load failed',name,href);
        link.remove();
        routeCssLoads[name]=null;
        resolve(false);
      };
      document.head.appendChild(link);
    });
    routeCssLoads[name]=request;
    return request;
  }
  /* Gate chung JS+CSS: renderer chỉ được gọi sau khi cả hai đã await xong, để
     root (hidden theo mặc định) không bao giờ lộ nội dung chưa có style. */
  function ensureRouteReady(name){
    return Promise.all([ensureRouteModule(name),ensureRouteCss(name)]).then(function(results){return results[0];});
  }

  function routeModuleReady(name){
    var config=ROUTE_MODULES[name];
    return !!(config&&typeof window[config.renderer]==='function');
  }
  function waitForRouteModule(name,maxMs){
    var started=Date.now();
    return new Promise(function(resolve,reject){
      (function poll(){
        if(routeModuleReady(name)) return resolve(true);
        if(Date.now()-started>=Math.max(1000,Number(maxMs)||8000)) return reject(new Error('PHF_'+String(name).toUpperCase()+'_RENDERER_TIMEOUT'));
        setTimeout(poll,50);
      })();
    });
  }
  function moduleSrc(config,attempt){
    var raw=String(config.src||'');
    var join=raw.indexOf('?')>=0?'&':'?';
    var build=String((window.PHF_BUILD_INFO&&window.PHF_BUILD_INFO.fingerprint)||Date.now());
    return raw+join+'phf_module='+encodeURIComponent(build)+'_'+String(attempt||1);
  }
  function ensureRouteModule(name,attempt){
    attempt=Math.max(1,Number(attempt)||1);
    var config=ROUTE_MODULES[name];
    if(!config)return Promise.reject(new Error('PHF_ROUTE_MODULE_UNKNOWN'));
    if(routeModuleReady(name))return Promise.resolve(true);
    if(routeModuleLoads[name])return routeModuleLoads[name];

    var loadingToken=null;
    try{
      if(typeof window.phfLoadingShow==='function'){
        loadingToken=window.phfLoadingShow('generic',{
          title:'Đang mở '+config.label,
          text:'Hệ thống đang chuẩn bị chức năng. Vui lòng chờ trong giây lát.'
        });
      }
    }catch(e){}

    var request=new Promise(function(resolve,reject){
      var script=document.createElement('script');
      script.src=moduleSrc(config,attempt);
      script.async=true;
      script.setAttribute('data-phf-route-module',name);
      script.onload=function(){
        waitForRouteModule(name,8000).then(resolve,reject);
      };
      script.onerror=function(){
        script.remove();
        reject(new Error('PHF_'+name.toUpperCase()+'_MODULE_LOAD_FAILED'));
      };
      document.head.appendChild(script);
    }).then(function(result){
      try{
        if(typeof window.phfLoadingSettle==='function')window.phfLoadingSettle(loadingToken);
        else if(typeof window.phfLoadingHide==='function')window.phfLoadingHide(loadingToken);
      }catch(e){}
      return result;
    }).catch(function(error){
      routeModuleLoads[name]=null;
      try{if(typeof window.phfLoadingHideNow==='function')window.phfLoadingHideNow();}catch(e){}
      if(attempt<2){
        try{document.querySelectorAll('script[data-phf-route-module="'+name+'"]').forEach(function(node){node.remove();});}catch(e){}
        return ensureRouteModule(name,attempt+1);
      }
      throw error;
    });
    routeModuleLoads[name]=request;
    return request;
  }
  function renderRouteModuleError(name,path,error){
    var config=ROUTE_MODULES[name]||{label:'chức năng'};
    var root=document.getElementById(name==='classroom'?'phfClassroomRoot':'phfChecklistRoot');
    if(window.PHFAppShell)window.PHFAppShell.syncFromRoute(path,{clear:false,restoreTitle:false});
    if(root){
      root.innerHTML='<section style="min-height:70vh;display:grid;place-items:center;padding:28px;background:#f5faf7"><div style="width:min(520px,100%);padding:28px;border:1px solid #d8e8df;border-radius:20px;background:#fff;box-shadow:0 18px 46px rgba(15,74,55,.10);text-align:center;font-family:Segoe UI,Arial,sans-serif"><strong style="display:block;color:#07543e;font-size:22px;margin-bottom:10px">Chưa thể mở '+config.label+'</strong><p style="margin:0 0 20px;color:#60736b;line-height:1.6">Kết nối tải chức năng chưa hoàn tất. Dữ liệu của bạn không bị thay đổi.</p><button type="button" data-phf-module-retry="'+name+'" style="min-height:44px;padding:0 22px;border:0;border-radius:12px;background:#07543e;color:#fff;font-weight:700;cursor:pointer">Thử lại</button></div></section>';
      var retry=root.querySelector('[data-phf-module-retry]');
      if(retry)retry.onclick=function(){
        retry.disabled=true;
        retry.textContent='Đang thử lại…';
        routeModuleLoads[name]=null;
        try{document.querySelectorAll('script[data-phf-route-module="'+name+'"]').forEach(function(node){node.remove();});}catch(e){}
        ensureRouteModule(name,1).then(function(){return navigate(path,true,{source:'module-retry'});}).catch(function(err){renderRouteModuleError(name,path,err);});
      };
    }
    console.error('[PHF ROUTER] module load failed',name,error&&error.message||error);
    return false;
  }

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
      var state=Object.assign({},history.state||{},{phfUrl:true,path:path,routeKey:currentRouteKey()});
      nativeReplaceState(state,'',path+(location.search||'')+(location.hash||''));
    }catch(e){}
  }

  /* Sau Back/Forward hoặc khi một renderer cũ hoàn tất muộn, URL hiện tại là
     nguồn sự thật. Chỉ lên lịch một lượt đối soát để tránh hai màn cùng tranh
     quyền và không tạo thêm history entry. */
  function reconcileCurrentRoute(source,delay){
    if(reconcileTimer) clearTimeout(reconcileTimer);
    reconcileTimer=setTimeout(function(){
      reconcileTimer=null;
      var current=cleanPath(location.pathname);
      var currentKey=currentRouteKey();
      if(applyingRoute) return reconcileCurrentRoute(source||'reconcile-busy',60);
      if(lastCommittedPath===currentKey){
        syncRouteUi(current);
        normalizeCurrentHistoryEntry();
        return;
      }
      Promise.resolve(render(currentKey,true,{source:source||'reconcile'})).catch(function(err){
        console.error('[PHF ROUTER] reconcile failed',err);
      });
    },Math.max(0,Number(delay)||0));
  }

  function installPageShowGuard(){
    if(pageShowInstalled) return;
    pageShowInstalled=true;
    window.addEventListener('pageshow',function(event){
      /* Trình duyệt có thể phục hồi DOM cũ từ back-forward cache mà không chạy
         lại bootstrap. Đối soát URL với screen owner để shell/menu không lệch. */
      if(event&&event.persisted) reconcileCurrentRoute('pageshow-bfcache',0);
      else normalizeCurrentHistoryEntry();
    });
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
  function currentRouteKey(){return cleanPath(location.pathname)+(location.search||'');}
  function routeKeyFor(path){var raw=String(path||currentRouteKey());try{var u=new URL(raw,location.origin);return cleanPath(u.pathname)+(u.search||'');}catch(e){return cleanPath(raw);}}
  function safeReturnTo(value){
    var key=routeKeyFor(value);
    return key.startsWith('/') && !key.startsWith('//') ? key : '/';
  }
  function setUrl(path,replace){
    var key=routeKeyFor(path);
    if(currentRouteKey()===key) return;
    var pathname=cleanPath(key);
    var state=Object.assign({},history.state||{},{phfUrl:true,path:pathname,routeKey:key});
    try{ (replace?nativeReplaceState:nativePushState)(state,'',key); }catch(e){}
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
  function safeHomeForRole(){
    var currentRole=role();
    if(currentRole==='admin') return '/admin/home';
    if(currentRole==='manager') return '/ql/home';
    return '/hv/home';
  }
  function safeHubHomeForRole(){
    var currentRole=role();
    if(currentRole==='admin') return '/admin';
    if(currentRole==='manager') return '/ql';
    return '/hv';
  }
  window.phfGetRoleHomePath=safeHomeForRole;
  window.phfGetRoleHubPath=safeHubHomeForRole;
  /* Route Registry là nguồn duy nhất mô tả namespace, role và screen owner.
     Không dùng chung /ql cho Admin; mỗi route gốc có một nghĩa cố định. */
  var ROUTE_REGISTRY=Object.freeze({
    '/':Object.freeze({area:'public',screen:'home',roles:[]}),
    '/login':Object.freeze({area:'public',screen:'login',roles:[]}),

    '/hv':Object.freeze({area:'learner',screen:'hub-home',roles:['learner']}),
    '/hv/home':Object.freeze({area:'learner',screen:'hr-home',roles:['learner']}),
    '/hv/knl':Object.freeze({area:'learner',screen:'knl-home',roles:['learner']}),
    '/hv/bai-hoc':Object.freeze({area:'learner',screen:'learning',roles:['learner']}),
    '/hv/ho-so':Object.freeze({area:'learner',screen:'profile',roles:['learner']}),
    '/hv/checklist':Object.freeze({area:'learner',screen:'checklist-home',roles:['learner']}),
    '/hv/classroom':Object.freeze({area:'learner',screen:'classroom-home',roles:['learner']}),
    '/hv/classroom/lich':Object.freeze({area:'learner',screen:'classroom-calendar',roles:['learner']}),
    '/hv/classroom/tai-lieu':Object.freeze({area:'learner',screen:'classroom-materials',roles:['learner']}),
    '/hv/classroom/bai-kiem-tra':Object.freeze({area:'learner',screen:'classroom-assessments',roles:['learner']}),
    '/hv/classroom/ket-qua':Object.freeze({area:'learner',screen:'classroom-results',roles:['learner']}),
    '/hv/classroom/de-xuat':Object.freeze({area:'learner',screen:'classroom-proposals',roles:['learner']}),

    '/ql':Object.freeze({area:'manager',screen:'hub-home',roles:['manager']}),
    '/ql/home':Object.freeze({area:'manager',screen:'hr-home',roles:['manager']}),
    '/ql/knl':Object.freeze({area:'manager',screen:'knl-home',roles:['manager']}),
    '/ql/quan-ly':Object.freeze({area:'manager',screen:'workspace',roles:['manager']}),
    '/ql/hoc-vien':Object.freeze({area:'manager',screen:'learners',roles:['manager']}),
    '/ql/noi-dung':Object.freeze({area:'manager',screen:'content',roles:['manager']}),
    '/ql/bao-cao':Object.freeze({area:'manager',screen:'reports',roles:['manager']}),
    '/ql/de-xuat-dao-tao':Object.freeze({area:'manager',screen:'training-proposals',roles:['manager']}),
    '/ql/checklist':Object.freeze({area:'manager',screen:'checklist-home',roles:['manager']}),
    '/ql/checklist/bao-cao':Object.freeze({area:'manager',screen:'checklist-reports',roles:['manager']}),
    '/ql/checklist/phan-quyen':Object.freeze({area:'manager',screen:'checklist-permissions',roles:['manager']}),
    '/ql/classroom':Object.freeze({area:'manager',screen:'classroom-home',roles:['manager']}),
    '/ql/classroom/lop':Object.freeze({area:'manager',screen:'classroom-classes',roles:['manager']}),
    '/ql/classroom/lich':Object.freeze({area:'manager',screen:'classroom-calendar',roles:['manager']}),
    '/ql/classroom/tai-lieu':Object.freeze({area:'manager',screen:'classroom-materials',roles:['manager']}),
    '/ql/classroom/hoc-vien':Object.freeze({area:'manager',screen:'classroom-learners',roles:['manager']}),
    '/ql/classroom/nguoi-phu-trach':Object.freeze({area:'manager',screen:'classroom-instructors',roles:['manager']}),
    '/ql/classroom/diem-danh':Object.freeze({area:'manager',screen:'classroom-attendance',roles:['manager']}),
    '/ql/classroom/bai-kiem-tra':Object.freeze({area:'manager',screen:'classroom-assessments',roles:['manager']}),
    '/ql/classroom/ket-qua':Object.freeze({area:'manager',screen:'classroom-results',roles:['manager']}),
    '/ql/classroom/de-xuat':Object.freeze({area:'manager',screen:'classroom-proposals',roles:['manager']}),
    '/ql/classroom/bao-cao':Object.freeze({area:'manager',screen:'classroom-reports',roles:['manager']}),
    '/ql/classroom/thong-bao':Object.freeze({area:'manager',screen:'classroom-notifications',roles:['manager']}),

    '/admin':Object.freeze({area:'admin',screen:'hub-home',roles:['admin']}),
    '/admin/home':Object.freeze({area:'admin',screen:'hr-home',roles:['admin']}),
    '/admin/knl':Object.freeze({area:'admin',screen:'knl-home',roles:['admin']}),
    '/admin/quan-tri':Object.freeze({area:'admin',screen:'workspace',roles:['admin']}),
    '/admin/quan-tri/tai-khoan':Object.freeze({area:'admin',screen:'accounts',roles:['admin']}),
    '/admin/quan-tri/danh-muc':Object.freeze({area:'admin',screen:'catalogs',roles:['admin']}),
    '/admin/quan-tri/kiem-tra':Object.freeze({area:'admin',screen:'tests',roles:['admin']}),
    '/admin/quan-tri/cau-hinh':Object.freeze({area:'admin',screen:'settings',roles:['admin']}),
    '/admin/hoc-vien':Object.freeze({area:'admin',screen:'learners',roles:['admin']}),
    '/admin/noi-dung':Object.freeze({area:'admin',screen:'content',roles:['admin']}),
    '/admin/bao-cao':Object.freeze({area:'admin',screen:'reports',roles:['admin']}),
    '/admin/checklist':Object.freeze({area:'admin',screen:'checklist-home',roles:['admin']}),
    '/admin/checklist/nhan-su':Object.freeze({area:'admin',screen:'checklist-people',roles:['admin']}),
    '/admin/checklist/mau':Object.freeze({area:'admin',screen:'checklist-templates',roles:['admin']}),
    '/admin/checklist/ghi-nhan-loi':Object.freeze({area:'admin',screen:'checklist-violations',roles:['admin']}),
    '/admin/checklist/viec-can-xu-ly':Object.freeze({area:'admin',screen:'checklist-tasks',roles:['admin']}),
    '/admin/checklist/phieu-danh-gia-thang':Object.freeze({area:'admin',screen:'checklist-monthly',roles:['admin']}),
    '/admin/checklist/bao-cao':Object.freeze({area:'admin',screen:'checklist-reports',roles:['admin']}),
    '/admin/checklist/lich-su':Object.freeze({area:'admin',screen:'checklist-history',roles:['admin']}),
    '/admin/checklist/cai-dat':Object.freeze({area:'admin',screen:'checklist-settings',roles:['admin','manager']}),
    '/admin/classroom':Object.freeze({area:'admin',screen:'classroom-home',roles:['admin']}),
    '/admin/classroom/lop':Object.freeze({area:'admin',screen:'classroom-classes',roles:['admin']}),
    '/admin/classroom/lich':Object.freeze({area:'admin',screen:'classroom-calendar',roles:['admin']}),
    '/admin/classroom/tai-lieu':Object.freeze({area:'admin',screen:'classroom-materials',roles:['admin']}),
    '/admin/classroom/hoc-vien':Object.freeze({area:'admin',screen:'classroom-learners',roles:['admin']}),
    '/admin/classroom/nguoi-phu-trach':Object.freeze({area:'admin',screen:'classroom-instructors',roles:['admin']}),
    '/admin/classroom/diem-danh':Object.freeze({area:'admin',screen:'classroom-attendance',roles:['admin']}),
    '/admin/classroom/bai-kiem-tra':Object.freeze({area:'admin',screen:'classroom-assessments',roles:['admin']}),
    '/admin/classroom/ket-qua':Object.freeze({area:'admin',screen:'classroom-results',roles:['admin']}),
    '/admin/classroom/de-xuat':Object.freeze({area:'admin',screen:'classroom-proposals',roles:['admin']}),
    '/admin/classroom/bao-cao':Object.freeze({area:'admin',screen:'classroom-reports',roles:['admin']}),
    '/admin/classroom/thong-bao':Object.freeze({area:'admin',screen:'classroom-notifications',roles:['admin']}),
    '/admin/classroom/cau-hinh':Object.freeze({area:'admin',screen:'classroom-settings',roles:['admin']})
  });
  window.PHF_ROUTE_REGISTRY=ROUTE_REGISTRY;
  window.PHF_ROUTE_MAP=Object.freeze({
    public:['/','/login'],
    learner:['/hv','/hv/home','/hv/knl','/hv/bai-hoc','/hv/ho-so','/hv/checklist','/hv/classroom','/hv/classroom/lich','/hv/classroom/tai-lieu','/hv/classroom/bai-kiem-tra','/hv/classroom/ket-qua','/hv/classroom/de-xuat'],
    management:['/ql','/ql/home','/ql/knl','/ql/quan-ly','/ql/hoc-vien','/ql/noi-dung','/ql/bao-cao','/ql/de-xuat-dao-tao','/ql/checklist','/ql/checklist/bao-cao','/ql/checklist/phan-quyen','/ql/classroom','/ql/classroom/lop','/ql/classroom/lich','/ql/classroom/tai-lieu','/ql/classroom/hoc-vien','/ql/classroom/nguoi-phu-trach','/ql/classroom/diem-danh','/ql/classroom/bai-kiem-tra','/ql/classroom/ket-qua','/ql/classroom/de-xuat','/ql/classroom/bao-cao','/ql/classroom/thong-bao'],
    admin:['/admin','/admin/home','/admin/knl','/admin/checklist','/admin/checklist/nhan-su','/admin/checklist/mau','/admin/checklist/ghi-nhan-loi','/admin/checklist/viec-can-xu-ly','/admin/checklist/phieu-danh-gia-thang','/admin/checklist/bao-cao','/admin/checklist/lich-su','/admin/checklist/cai-dat','/admin/quan-tri','/admin/quan-tri/tai-khoan','/admin/quan-tri/danh-muc','/admin/quan-tri/kiem-tra','/admin/quan-tri/cau-hinh','/admin/hoc-vien','/admin/noi-dung','/admin/bao-cao','/admin/classroom','/admin/classroom/lop','/admin/classroom/lich','/admin/classroom/tai-lieu','/admin/classroom/hoc-vien','/admin/classroom/nguoi-phu-trach','/admin/classroom/diem-danh','/admin/classroom/bai-kiem-tra','/admin/classroom/ket-qua','/admin/classroom/de-xuat','/admin/classroom/bao-cao','/admin/classroom/thong-bao','/admin/classroom/cau-hinh'],
    classroom:['/hv/classroom','/ql/classroom','/admin/classroom'],
    knl:['/hv/knl','/ql/knl','/admin/knl'],
    hr:['/hv/home','/ql/home','/admin/home'],
    hub:['/hv','/ql','/admin'],
    checklist:['/hv/checklist','/ql/checklist','/ql/checklist/bao-cao','/ql/checklist/phan-quyen','/admin/checklist','/admin/checklist/nhan-su','/admin/checklist/mau','/admin/checklist/ghi-nhan-loi','/admin/checklist/viec-can-xu-ly','/admin/checklist/phieu-danh-gia-thang','/admin/checklist/bao-cao','/admin/checklist/lich-su','/admin/checklist/cai-dat']
  });

  function canonicalLegacyPath(path){
    path=cleanPath(path);
    if(path==='/home') return safeHomeForRole();
    if(path==='/hv/dao-tao'||path==='/hv/hub') return '/hv';
    if(path==='/ql/hub') return '/ql';
    if(path==='/admin/hub') return '/admin';
    if(path==='/hv/dao-tao/bai-hoc'||/^\/hv\/dao-tao\/bai-hoc\//.test(path)) return path.replace(/^\/hv\/dao-tao\/bai-hoc/,'/hv/bai-hoc');
    if(path==='/hv/dao-tao/ho-so'||/^\/hv\/dao-tao\/ho-so\//.test(path)) return path.replace(/^\/hv\/dao-tao\/ho-so/,'/hv/ho-so');
    if(path==='/hv/dao-tao/ket-qua'||path==='/hv/ket-qua') return '/hv/bai-hoc';
    if(path==='/ql/quan-ly/hoc-vien'||/^\/ql\/quan-ly\/hoc-vien\//.test(path)) return path.replace(/^\/ql\/quan-ly\/hoc-vien/,'/ql/hoc-vien');
    if(path==='/ql/quan-ly/noi-dung') return '/ql/noi-dung';
    if(path==='/ql/quan-ly/bao-cao') return '/ql/bao-cao';
    if(path==='/ql/quan-ly/de-xuat-dao-tao') return '/ql/de-xuat-dao-tao';
    if(path==='/admin/tai-khoan') return '/admin/quan-tri/tai-khoan';
    if(path==='/admin/danh-muc') return '/admin/quan-tri/danh-muc';
    if(path==='/admin/kiem-tra') return '/admin/quan-tri/kiem-tra';
    if(path==='/my-lessons') return '/hv/bai-hoc';
    if(path==='/my-profile'||/^\/my-profile\//.test(path)) return '/hv/ho-so';
    if(path==='/overview') return safeHomeForRole();
    if(/^\/lessons\//.test(path)) return path.replace(/^\/lessons/,'/hv/bai-hoc');
    if(/^\/programs\//.test(path)) return path.replace(/^\/programs/,'/hv/chuong-trinh');
    if(path==='/employees'||/^\/employees\//.test(path)) return path.replace(/^\/employees/,role()==='admin'?'/admin/hoc-vien':'/ql/hoc-vien');
    if(path==='/training-content') return role()==='admin'?'/admin/noi-dung':'/ql/noi-dung';
    if(path==='/admin/accounts') return '/admin/quan-tri/tai-khoan';
    if(/^\/classroom(?:\/|$)/.test(path)){
      var base=role()==='admin'?'/admin/classroom':(role()==='manager'?'/ql/classroom':'/hv/classroom');
      if(path==='/classroom'||path==='/classroom/my-classes') return base;
      return base;
    }
    return path;
  }
  function canonicalRouteKey(value){
    var raw=String(value||currentRouteKey());
    try{
      var u=new URL(raw,location.origin);
      var canonicalPath=canonicalLegacyPath(u.pathname);
      return cleanPath(canonicalPath)+(u.search||'');
    }catch(e){
      return canonicalLegacyPath(raw);
    }
  }
  function deny(){
    var target=safeHomeForRole();
    var currentRole=role();
    var attempted=cleanPath(location.pathname);
    /* Namespace là khu làm việc độc lập. Admin không dùng /ql hoặc /hv; các lời gọi
       legacy cố kéo Admin sang khu khác phải được thu hồi im lặng về /admin, không
       bật popup sai khi chính màn Admin đã render đúng. Tương tự cho các role khác
       trong lúc boot/restore/legacy. */
    var crossNamespace =
      (currentRole==='admin' && (/^\/ql(?:\/|$)/.test(attempted)||/^\/hv(?:\/|$)/.test(attempted))) ||
      (currentRole==='manager' && (/^\/admin(?:\/|$)/.test(attempted)||/^\/hv(?:\/|$)/.test(attempted))) ||
      (currentRole==='learner' && (/^\/admin(?:\/|$)/.test(attempted)||/^\/ql(?:\/|$)/.test(attempted)));
    var silent=crossNamespace||currentRenderSource==='auth'||currentRenderSource==='restore'||currentRenderSource==='boot'||currentRenderSource==='legacy'||currentRenderSource==='guard-fallback';
    setUrl(target,true);
    if(silent){
      setTimeout(function(){render(target,true,{source:'guard-fallback'});},0);
      return;
    }
    modal('Không có quyền truy cập','Tài khoản của anh/chị không được cấp quyền xem nội dung này.','Về trang phù hợp',function(){navigate(target,true,{source:'guard-action'});});
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

  function getTrainingData(){
    return window.__phfLocalData||window.localData||null;
  }
  async function ensureTrainingData(path){
    /* Một số module legacy công bố dữ liệu qua window.localData trước khi đồng bộ
       sang __phfLocalData. Cả hai đều là cùng payload /api/data; chấp nhận nguồn
       đã sẵn sàng để route Báo cáo không đứng loading vô hạn. */
    if(getTrainingData()) return true;
    var ok=await waitForTrainingData(9000);
    if((ok||getTrainingData())&&getTrainingData()) return true;
    // PHF 62.24: một lượt phục hồi có giới hạn trước khi báo lỗi. Tránh popup
    // chặn màn khi promise cũ vừa hết hạn nhưng /api/data có thể tải lại thành công.
    try{
      if(typeof window.phfRefreshTrainingData==='function'){
        await Promise.race([
          Promise.resolve(window.phfRefreshTrainingData({force:true})),
          new Promise(function(resolve){setTimeout(function(){resolve(false);},3500);})
        ]);
      }
    }catch(e){}
    if(getTrainingData()) return true;
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
    return '/hv/bai-hoc/'+lessonSlug(list[idx]||{},idx);
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

  function navKeyForPath(path){
    path=cleanPath(path);
    if(path==='/admin') return 'intro';
    if(path==='/admin/quan-tri'||/^\/admin\/quan-tri\//.test(path)) return 'admin';
    if(/^\/admin\/hoc-vien(?:\/|$)/.test(path)) return 'profile';
    if(path==='/admin/noi-dung') return 'trainingLibrary';
    if(path==='/admin/bao-cao') return 'reports';
    if(path==='/ql') return 'intro';
    if(path==='/ql/quan-ly') return 'workspace';
    if(path==='/ql/noi-dung') return 'trainingLibrary';
    if(/^\/ql\/hoc-vien(?:\/|$)/.test(path)) return 'profile';
    if(path==='/ql/bao-cao') return 'reports';
    if(path==='/hv') return 'intro';
    if(path==='/hv/bai-hoc'||/^\/hv\/bai-hoc\//.test(path)) return 'learning';
    if(path==='/hv/ho-so'||/^\/hv\/ho-so\//.test(path)) return 'profile';
    if(/^\/(?:admin|ql|hv)\/checklist(?:\/|$)/.test(path)) return 'checklist';
    if(/^\/(?:admin|ql|hv)\/classroom(?:\/|$)/.test(path)) return 'classroom';
    return '';
  }
  function syncRouteUi(path){
    path=cleanPath(path);
    var key=navKeyForPath(path);
    if(key&&typeof window.phfSetMainNavActive==='function'){
      try{window.phfSetMainNavActive(key);}catch(e){}
    }
    /* URL là nguồn duy nhất của menu active. Không cho các lớp menu legacy giữ
       active cũ sau khi Admin/Manager/Learner đã đổi namespace. */
    try{
      document.querySelectorAll('[data-phf-main-nav]').forEach(function(btn){
        var own=String(btn.getAttribute('data-phf-main-nav')||'');
        btn.classList.toggle('active',!!key&&own===key);
        if(own===key) btn.setAttribute('aria-current','page');
        else btn.removeAttribute('aria-current');
      });
      var area=(ROUTE_REGISTRY[path]&&ROUTE_REGISTRY[path].area)||(/^\/admin/.test(path)?'admin':(/^\/ql/.test(path)?'manager':(/^\/hv/.test(path)?'learner':'public')));
      document.body.setAttribute('data-phf-route-area',area);
      document.body.classList.toggle('phf-role-admin',area==='admin');
    }catch(e){}
  }

  function classroomSkeletonMeta(path){
    path=cleanPath(path);
    var area=/^\/admin\//.test(path)?'admin':(/^\/ql\//.test(path)?'manager':'learner');
    var isDetail=/\/lop\//.test(path);
    var isProposal=/\/de-xuat$/.test(path);
    var isSettings=/\/cau-hinh$/.test(path);
    if(area==='admin') return {
      area:area,
      title:isDetail?'Chi tiết lớp đào tạo':(isProposal?'Đề xuất đào tạo':(isSettings?'Cấu hình Classroom':'PHF Classroom · Quản trị')),
      subtitle:'Khung Classroom dành riêng cho Admin. Nghiệp vụ lớp học sẽ được xây sau trên route và quyền độc lập.',
      badge:'Admin · toàn quyền',
      back:'/admin/home',
      items:['Quản lý toàn bộ lớp','Phân công học viên và người phụ trách','Duyệt đề xuất, bài kiểm tra và cấu hình']
    };
    if(area==='manager') return {
      area:area,
      title:isDetail?'Lớp được phân công':(isProposal?'Đề xuất đào tạo':'PHF Classroom · Quản lý'),
      subtitle:'Khung Classroom dành riêng cho Quản lý. Chỉ các lớp và nhân sự thuộc phạm vi được giao mới hiển thị.',
      badge:'Quản lý · theo phạm vi',
      back:'/ql/home',
      items:['Lớp được giao phụ trách','Theo dõi tiến độ trong phạm vi','Gửi đề xuất đào tạo hoặc kiểm tra']
    };
    return {
      area:area,
      title:isDetail?'Chi tiết lớp của tôi':'Lớp đào tạo của tôi',
      subtitle:'Khung Classroom dành riêng cho Học viên/Nhân viên. Chỉ lớp được phân công mới hiển thị.',
      badge:'Cá nhân · lớp được giao',
      back:'/hv/home',
      items:['Lớp đang tham gia','Lịch học và tài liệu','Bài kiểm tra, kết quả thuộc từng lớp']
    };
  }
  function renderClassroomSkeleton(path){
    path=cleanPath(path);
    var root=document.getElementById('phfClassroomRoot');
    if(!root) throw new Error('phfClassroomRoot is not available');
    var meta=classroomSkeletonMeta(path);
    var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
    var roleHome=meta.back;
    var html='';
    try{
      /* Mount-first: chuẩn bị đầy đủ HTML trước khi ẩn Hub. Nếu bước này lỗi,
         giao diện Hub vẫn còn nguyên và người dùng không bị màn trắng. */
      html='<section class="phfc-shell" data-classroom-area="'+esc(meta.area)+'">'
        +'<header class="phfc-header"><button class="phfc-hub-back" type="button" onclick="phfNavigate(\''+esc(roleHome)+'\')"><span aria-hidden="true">←</span><span><strong>PHF HR</strong><small>Hệ sinh thái phát triển nhân sự</small></span></button><div class="phfc-header-brand"><div><strong>PHF Classroom</strong><span>Quản lý đào tạo nội bộ</span></div></div><div class="phfc-header-user"><span>'+esc(meta.badge)+'</span><small>Route riêng · shell riêng</small></div></header>'
        +'<div class="phfc-layout"><aside class="phfc-sidebar"><div class="phfc-sidebar-brand"><div><strong>PHF Classroom</strong><span>Đào tạo nội bộ</span></div></div><section class="phfc-nav-group"><div class="phfc-nav-label">Khu vực</div><nav class="phfc-nav"><button class="active" type="button">'+esc(meta.title)+'</button></nav></section><div class="phfc-side-bottom">Một phần của hệ sinh thái PHUHOA FRESH</div></aside>'
        +'<main class="phfc-main"><div class="phfc-topline"><div class="phfc-title"><small>PHF Classroom</small><h2>'+esc(meta.title)+'</h2><p>'+esc(meta.subtitle)+'</p></div></div>'
        +'<section class="phfc-card phfc-panel"><div class="phfc-panel-head"><div><h3>Khung Classroom đã sẵn sàng</h3><span>Không còn dùng stage bar, danh sách việc cần làm hoặc tiến độ của Training Hub.</span></div></div><div class="phfc-empty">Route, role, shell và F5 đã được tách riêng. Dữ liệu lớp thật sẽ được kết nối ở giai đoạn xây Classroom.</div></section>'
        +'<section class="phfc-kpis">'+meta.items.map(function(item){return '<article class="phfc-card phfc-kpi"><div class="phfc-kpi-icon">▦</div><strong>—</strong><p>'+esc(item)+'</p></article>';}).join('')+'</section>'
        +'</main></div></section>';

      var staging=document.createElement('div');
      staging.innerHTML=html;
      if(!staging.querySelector('.phfc-shell')) throw new Error('Classroom shell markup is invalid');

      try{ if(typeof window.phfHideIntroAndStopAuto==='function') window.phfHideIntroAndStopAuto(); }catch(e){}
      root.innerHTML=html;
      if(!root.querySelector('.phfc-shell')) throw new Error('Classroom shell mount failed');

      /* Chỉ sau khi mount thành công mới chuyển shell. */
      if(window.PHFAppShell) window.PHFAppShell.activateClassroom(path);
      document.title=meta.title+' · PHF Classroom';
      try{root.scrollTop=0;window.scrollTo({top:0,left:0,behavior:'auto'});}catch(e){}
      return true;
    }catch(err){
      try{
        root.replaceChildren();
        if(window.PHFAppShell) window.PHFAppShell.activateHub({clear:false,restoreTitle:true});
      }catch(e){}
      try{
        if(typeof window.phfShowNoticeModal==='function'){
          window.phfShowNoticeModal({title:'Chưa mở được PHF Classroom',message:'Giao diện Classroom gặp lỗi khi khởi tạo. Hệ thống đã giữ nguyên khu vực trước đó để tránh màn trắng.',primaryText:'Về Trang chủ',onPrimary:function(){window.phfNavigate(roleHome,true);}});
        }
      }catch(e){}
      console.error('[PHF CLASSROOM] shell mount failed',err);
      throw err;
    }
  }
  window.phfRenderClassroomSkeleton=renderClassroomSkeleton;

  async function render(path,fromPop,meta){
    meta=meta||{};
    currentRenderSource=String(meta.source||currentRenderSource||'system');
    var targetRouteKey=canonicalRouteKey(path);
    if(currentRouteKey()!==targetRouteKey) setUrl(targetRouteKey,true);
    path=cleanPath(targetRouteKey);
    applyingRoute=true;
    var runId=++routeRenderSequence;
    /* 60.8: Hai route từng lộ màn Training Hub/Học viên trong lúc renderer đích
       đang chờ dữ liệu. Dùng chính boot guard đã có của hệ thống để giữ một màn
       chuyển tiếp duy nhất cho tới khi đúng route mount xong. Không tạo overlay,
       toast hoặc renderer mới và không can thiệp nghiệp vụ bên dưới. */
    var holdRouteGuard=(path==='/admin/bao-cao'||path==='/ql/quan-ly');
    if(holdRouteGuard){
      routeGuardOwnerRunId=runId;
      try{
        document.documentElement.classList.add('phf-route-boot-pending');
        if(window.__phfRouteBootGuardTimer){clearTimeout(window.__phfRouteBootGuardTimer);window.__phfRouteBootGuardTimer=null;}
      }catch(e){}
    }else if(routeGuardOwnerRunId){
      /* Người dùng đổi route trong lúc màn đích cũ còn tải: route mới thu hồi
         guard của lượt cũ để không có trạng thái che màn bị bỏ quên. */
      routeGuardOwnerRunId=0;
      try{document.documentElement.classList.remove('phf-route-boot-pending','phf-route-shell-early');}catch(e){}
    }
    function stale(){return runId!==routeRenderSequence || currentRouteKey()!==targetRouteKey;}
    try{
      if(window.PHFAppShell) window.PHFAppShell.syncFromRoute(path,{clear:true});
      if(path==='/'){
        /* Khi F5 tại Trang chủ, cookie/session có thể đã được xác minh thành công
           nhưng URL vẫn còn ở /. Không được ép giao diện anonymous vì thao tác đó
           chỉ đổi UI, tạo cảm giác bị đăng xuất dù /api/auth/session vẫn trả 200.
           Với phiên hợp lệ, chuyển về route Trang chủ đúng vai trò; chỉ người chưa
           đăng nhập mới thấy trang giới thiệu công khai. */
        if(authenticated()) return navigate(safeHomeForRole(),true);
        setUrl('/',!!fromPop);
        if(typeof window.phfForceAnonymousPublicState==='function') window.phfForceAnonymousPublicState('url-home-anonymous');
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
        if(stale()) return false;
        if(!authenticated()) return loginFor(path);
      }

      if(path==='/hv/bai-hoc'){
        if(!requireRoles(['learner']))return false;
        if(!await ensureTrainingData(path)) return false;
        if(typeof window.phfCanAccessLearning==='function' && !window.phfCanAccessLearning()){
          modal('Chưa được phân công lộ trình học','Tài khoản của bạn hiện chưa có chương trình Training Hub ở trạng thái “Đang học”.','Về Trang chủ',function(){navigate('/hv/home',true);});
          setUrl('/hv/home',true);
          await Promise.resolve(window.phfRenderHrGateway&&window.phfRenderHrGateway('/hv/home'));
          return false;
        }
        await Promise.resolve(window.phfGoLearning&&window.phfGoLearning()); return true;
      }
      if(path==='/hv/ho-so'){
        if(!requireRoles(['learner']))return false;
        if(!await ensureTrainingData(path)) return false;
        await Promise.resolve(window.phfGoMyProfile&&window.phfGoMyProfile()); return true;
      }
      if(path==='/hv/home'){
        if(!requireRoles(['learner']))return false;
        if(window.PHFAppShell) window.PHFAppShell.activateHr({clear:true,restoreTitle:false});
        if(typeof window.phfRenderHrGateway!=='function') throw new Error('PHF_HR_GATEWAY_RENDERER_MISSING');
        await Promise.resolve(window.phfRenderHrGateway(path));
        return true;
      }
      if(path==='/hv'){
        if(!requireRoles(['learner']))return false;
        await Promise.resolve(window.phfRenderPostLoginHome&&window.phfRenderPostLoginHome());
        return true;
      }
      if(path==='/hv/knl'){
        if(!requireRoles(['learner']))return false;
        await Promise.resolve(window.phfRenderKnl&&window.phfRenderKnl(path));
        return true;
      }
      if(path==='/admin/hoc-vien'){
        if(!requireRoles(['admin']))return false;
        if(!await ensureTrainingData(path)) return false;
        if(window.phfTrainingRecordsOpen) await Promise.resolve(window.phfTrainingRecordsOpen('employees'));
        else await Promise.resolve(window.phfRenderTrainingOverview&&window.phfRenderTrainingOverview());
        return true;
      }
      if(path==='/admin/noi-dung'){
        if(!requireRoles(['admin']))return false;
        if(typeof window.__phfRenderTrainingLibraryRoute!=='function') throw new Error('PHF_TRAINING_LIBRARY_ROUTE_RENDERER_MISSING');
        await Promise.resolve(window.__phfRenderTrainingLibraryRoute());
        var adminLibraryRoot=document.querySelector('#mainLesson .phf-training-library');
        if(!adminLibraryRoot) throw new Error('PHF_TRAINING_LIBRARY_MOUNT_FAILED');
        return true;
      }
      if(path==='/admin/bao-cao'){
        if(!requireRoles(['admin']))return false;
        if(!await ensureTrainingData(path)) return false;
        /* Chuẩn hóa alias dữ liệu trước khi gọi renderer legacy. Một số hàm báo cáo
           cũ chỉ đọc __phfLocalData, trong khi auth/data bootstrap có thể công bố
           payload trước ở localData. */
        var reportData=getTrainingData();
        if(reportData){
          window.__phfLocalData=reportData;
          window.localData=reportData;
        }
        try{
          if(typeof window.phfRenderTrainingReports==='function'){
            await Promise.resolve(window.phfRenderTrainingReports());
          }else{
            throw new Error('PHF_REPORT_RENDERER_MISSING');
          }
        }catch(reportError){
          console.error('[PHF ROUTER] admin report render failed',reportError);
          var reportHost=document.getElementById('mainLesson');
          if(reportHost){
            reportHost.innerHTML='<section class="eval-admin-shell"><div class="eval-admin-page"><main class="eval-admin-main"><section class="hub-panel hub-placeholder"><h2>Chưa mở được Báo cáo đào tạo</h2><p>Hệ thống đã tải dữ liệu nhưng màn báo cáo gặp lỗi khi dựng giao diện.</p><div class="record-note" style="margin-top:14px">Mã chẩn đoán: '+String(reportError&&reportError.message||'REPORT_RENDER_ERROR').replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];})+'</div></section></main></div></section>';
          }
          modal('Chưa mở được Báo cáo','Màn Báo cáo gặp lỗi khi dựng giao diện. Hệ thống đã giữ nguyên phiên đăng nhập và route /admin/bao-cao.','Thử lại',function(){navigate('/admin/bao-cao',true);});
          return false;
        }
        return true;
      }
      var adminEmp=path.match(/^\/admin\/hoc-vien\/(emp_[a-f0-9]+)(?:\/(tests|evaluations|probation|commitments))?$/);
      if(adminEmp){
        if(!requireRoles(['admin']))return false;
        if(!await ensureTrainingData(path)) return false;
        var adminEmployee=await employeeFromToken(adminEmp[1]);
        if(!adminEmployee){modal('Không tìm thấy hồ sơ','Liên kết không còn phù hợp hoặc hồ sơ đã được cập nhật.','Mở danh sách nhân viên',function(){navigate('/admin/hoc-vien',true);});setUrl('/admin/hoc-vien',true);return false;}
        var adminTab=adminEmp[2]||'overview';
        if(typeof window.phfTrainingRecordsOpenEmployee==='function'){
          var adminMapped={tests:'tests',evaluations:'evaluations',probation:'probation',commitments:'commitments',overview:'overview'}[adminTab]||'overview';
          await Promise.resolve(window.phfTrainingRecordsOpenEmployee(adminEmployee.id,adminMapped));
        }
        return true;
      }
      if(path==='/ql/home'){
        if(!requireRoles(['manager']))return false;
        if(window.PHFAppShell) window.PHFAppShell.activateHr({clear:true,restoreTitle:false});
        if(typeof window.phfRenderHrGateway!=='function') throw new Error('PHF_HR_GATEWAY_RENDERER_MISSING');
        await Promise.resolve(window.phfRenderHrGateway(path));
        return true;
      }
      if(path==='/ql'){
        if(!requireRoles(['manager']))return false;
        await Promise.resolve(window.phfRenderPostLoginHome&&window.phfRenderPostLoginHome());
        return true;
      }
      if(path==='/ql/knl'){
        if(!requireRoles(['manager']))return false;
        await Promise.resolve(window.phfRenderKnl&&window.phfRenderKnl(path));
        return true;
      }
      if(path==='/ql/quan-ly'){
        if(!requireRoles(['manager']))return false;
        if(!await ensureTrainingData(path)) return false;
        await Promise.resolve(window.phfRenderTrainingOverview&&window.phfRenderTrainingOverview());
        return true;
      }
      if(path==='/ql/de-xuat-dao-tao'){
        if(!requireRoles(['manager']))return false;
        if(!await ensureTrainingData(path)) return false;
        await Promise.resolve(window.phfRenderTrainingOverview&&window.phfRenderTrainingOverview());
        modal('Đề xuất đào tạo','Khu đề xuất lớp học và kỳ kiểm tra sẽ được triển khai cùng PHF Classroom.','Đã hiểu');
        return true;
      }
      if(path==='/ql/legacy-overview'){
        /* /overview chỉ là Tổng quan quản lý. Learner/Nhân viên không dùng
           route này làm Trang chủ; nếu không đủ quyền sẽ được đưa về /home. */
        if(!requireRoles(['manager']))return false;
        if(!await ensureTrainingData(path)) return false;
        await Promise.resolve(window.phfRenderTrainingOverview&&window.phfRenderTrainingOverview()); return true;
      }
      if(path==='/ql/noi-dung'){
        if(!requireRoles(['manager']))return false;
        if(typeof window.__phfRenderTrainingLibraryRoute!=='function') throw new Error('PHF_TRAINING_LIBRARY_ROUTE_RENDERER_MISSING');
        await Promise.resolve(window.__phfRenderTrainingLibraryRoute());
        var managerLibraryRoot=document.querySelector('#mainLesson .phf-training-library');
        if(!managerLibraryRoot) throw new Error('PHF_TRAINING_LIBRARY_MOUNT_FAILED');
        return true;
      }
      if(path==='/ql/bao-cao'){
        if(!requireRoles(['manager']))return false;
        if(!await ensureTrainingData(path)) return false;
        if(typeof window.phfRenderTrainingReports==='function') await Promise.resolve(window.phfRenderTrainingReports());
        else await Promise.resolve(window.phfRenderTrainingOverview&&window.phfRenderTrainingOverview());
        return true;
      }
      if(path==='/guide'){
        if(!requireRoles(['learner','manager','admin']))return false;
        if(typeof window.phfGoGuide==='function') await Promise.resolve(window.phfGoGuide());
        else if(typeof window.phfRenderGuidePage==='function') await Promise.resolve(window.phfRenderGuidePage());
        return true;
      }
      if(path==='/direct-training-test'){
        if(!requireRoles(['manager']))return false;
        if(typeof window.phfGoDirectTrainingTest==='function') await Promise.resolve(window.phfGoDirectTrainingTest());
        else if(typeof window.phfRenderDirectTrainingTestPage==='function') await Promise.resolve(window.phfRenderDirectTrainingTestPage());
        return true;
      }
      if(path==='/ql/hoc-vien'){
        if(!requireRoles(['manager']))return false;
        if(!await ensureTrainingData(path)) return false;
        if(window.phfTrainingRecordsOpen) await Promise.resolve(window.phfTrainingRecordsOpen('employees'));
        else await Promise.resolve(window.phfRenderTrainingOverview&&window.phfRenderTrainingOverview());
        return true;
      }
      var emp=path.match(/^\/ql\/hoc-vien\/(emp_[a-f0-9]+)(?:\/(tests|evaluations|probation|commitments))?$/);
      if(emp){
        if(!requireRoles(['manager']))return false;
        if(!await ensureTrainingData(path)) return false;
        var employee=await employeeFromToken(emp[1]);
        if(!employee){modal('Không tìm thấy hồ sơ','Liên kết không còn phù hợp hoặc hồ sơ đã được cập nhật.','Mở danh sách nhân viên',function(){navigate('/ql/hoc-vien',true);});setUrl('/ql/hoc-vien',true);return false;}
        var tab=emp[2]||'overview';
        if(typeof window.phfTrainingRecordsOpenEmployee==='function'){
          var mapped={tests:'tests',evaluations:'evaluations',probation:'probation',commitments:'commitments',overview:'overview'}[tab]||'overview';
          await Promise.resolve(window.phfTrainingRecordsOpenEmployee(employee.id,mapped));
        }
        return true;
      }
      var lesson=path.match(/^\/hv\/bai-hoc\/([a-z0-9-]+)$/);
      if(lesson){
        if(!requireRoles(['learner']))return false;
        if(!await ensureTrainingData(path)) return false;
        if(typeof window.phfCanAccessLearning==='function' && !window.phfCanAccessLearning()){
          setUrl('/hv/home',true);
          await Promise.resolve(window.phfRenderHrGateway&&window.phfRenderHrGateway('/hv/home'));
          modal('Chưa được phân công lộ trình học','Bạn chưa có chương trình Training Hub ở trạng thái “Đang học”.','Về Trang chủ',function(){navigate('/hv/home',true);});
          return false;
        }
        var idx=lessonIndex(lesson[1]);
        if(idx<0){
          modal('Không tìm thấy bài học','Bài học không tồn tại hoặc không thuộc chương trình hiện tại.','Về bài học của tôi',function(){navigate('/hv/bai-hoc',true);});
          setUrl('/hv/bai-hoc',true);
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
      var program=path.match(/^\/hv\/chuong-trinh\/([a-z0-9_-]+)$/);
      if(program){
        if(!requireRoles(['learner']))return false;
        var allowed=['new_sales','new_gift','new_warehouse','new_online','new_store_lead'];
        if(allowed.indexOf(program[1])<0){setUrl('/hv/bai-hoc',true);return render('/hv/bai-hoc',true);}
        await Promise.resolve(window.phfGoLearning&&window.phfGoLearning()); return true;
      }
      if(path==='/notifications'){
        if(!requireRoles(['learner','manager','admin']))return false;
        await Promise.resolve((role()==='learner'?window.phfGoMyProfile:window.phfRenderTrainingOverview)&& (role()==='learner'?window.phfGoMyProfile():window.phfRenderTrainingOverview()));
        setTimeout(function(){var b=document.querySelector('[data-phf-notification-toggle],.phf-notification-button');if(b)b.click();},120);
        return true;
      }
      if(/^\/(?:admin|ql|hv)\/checklist(?:\/|$)/.test(path)){
        var checklistRole=/^\/admin\//.test(path)?'admin':(/^\/ql\//.test(path)?'manager':'learner');
        if(!requireRoles([checklistRole])) return false;
        var checklistRoute=ROUTE_REGISTRY[path];
        if(!checklistRoute){
          var checklistHome=checklistRole==='admin'?'/admin/checklist':(checklistRole==='manager'?'/ql/checklist':'/hv/checklist');
          setUrl(checklistHome,true);
          path=checklistHome;
        }
        try{await ensureRouteReady('checklist');}
        catch(checklistLoadError){return renderRouteModuleError('checklist',path,checklistLoadError);}
        if(stale())return false;
        if(typeof window.phfRenderChecklist!=='function')return renderRouteModuleError('checklist',path,new Error('PHF_CHECKLIST_RENDERER_MISSING'));
        await Promise.resolve(window.phfRenderChecklist(targetRouteKey));
        return true;
      }
      if(/^\/(?:admin|ql|hv)\/classroom(?:\/|$)/.test(path)){
        var classroomRole=/^\/admin\//.test(path)?'admin':(/^\/ql\//.test(path)?'manager':'learner');
        if(!requireRoles([classroomRole])) return false;
        var allowed=false;
        if(classroomRole==='admin') allowed=['/admin/classroom','/admin/classroom/lop','/admin/classroom/lich','/admin/classroom/tai-lieu','/admin/classroom/hoc-vien','/admin/classroom/nguoi-phu-trach','/admin/classroom/diem-danh','/admin/classroom/bai-kiem-tra','/admin/classroom/ket-qua','/admin/classroom/de-xuat','/admin/classroom/bao-cao','/admin/classroom/thong-bao','/admin/classroom/cau-hinh'].indexOf(path)>=0||/^\/admin\/classroom\/lop\/[^/]+$/.test(path);
        else if(classroomRole==='manager') allowed=['/ql/classroom','/ql/classroom/lop','/ql/classroom/lich','/ql/classroom/tai-lieu','/ql/classroom/hoc-vien','/ql/classroom/nguoi-phu-trach','/ql/classroom/diem-danh','/ql/classroom/bai-kiem-tra','/ql/classroom/ket-qua','/ql/classroom/de-xuat','/ql/classroom/bao-cao','/ql/classroom/thong-bao'].indexOf(path)>=0||/^\/ql\/classroom\/lop\/[^/]+$/.test(path);
        else allowed=['/hv/classroom','/hv/classroom/lich','/hv/classroom/tai-lieu','/hv/classroom/bai-kiem-tra','/hv/classroom/ket-qua','/hv/classroom/de-xuat'].indexOf(path)>=0||/^\/hv\/classroom\/lop\/[^/]+$/.test(path);
        if(!allowed){
          var classroomHome=classroomRole==='admin'?'/admin/classroom':(classroomRole==='manager'?'/ql/classroom':'/hv/classroom');
          setUrl(classroomHome,true);
          path=classroomHome;
        }
        try{await ensureRouteModule('classroom');}
        catch(classroomLoadError){return renderRouteModuleError('classroom',path,classroomLoadError);}
        if(stale())return false;
        if(typeof window.phfRenderClassroom!=='function')return renderRouteModuleError('classroom',path,new Error('PHF_CLASSROOM_RENDERER_MISSING'));
        await Promise.resolve(window.phfRenderClassroom(path));
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
        try{await ensureRouteModule('classroom');}
        catch(legacyClassroomLoadError){return renderRouteModuleError('classroom',path,legacyClassroomLoadError);}
        if(stale()) return false;
        if(typeof window.phfRenderClassroom!=='function')return renderRouteModuleError('classroom',path,new Error('PHF_CLASSROOM_RENDERER_MISSING'));
        await Promise.resolve(window.phfRenderClassroom(path));
        if(stale()) return false;
        if(window.PHFAppShell) window.PHFAppShell.syncFromRoute(path,{clear:false,restoreTitle:false});
        try{window.scrollTo({top:0,left:0,behavior:'auto'});}catch(e){}
        return true;
      }
      if(path==='/admin/home'){
        if(!requireRoles(['admin']))return false;
        if(window.PHFAppShell) window.PHFAppShell.activateHr({clear:true,restoreTitle:false});
        if(typeof window.phfRenderHrGateway!=='function') throw new Error('PHF_HR_GATEWAY_RENDERER_MISSING');
        await Promise.resolve(window.phfRenderHrGateway(path));
        return true;
      }
      if(path==='/admin'){
        if(!requireRoles(['admin']))return false;
        await Promise.resolve(window.phfRenderPostLoginHome&&window.phfRenderPostLoginHome());
        return true;
      }
      if(path==='/admin/knl'){
        if(!requireRoles(['admin']))return false;
        await Promise.resolve(window.phfRenderKnl&&window.phfRenderKnl(path));
        return true;
      }
      if(path==='/admin/quan-tri'||path==='/admin/quan-tri/tai-khoan'||path==='/admin/quan-tri/danh-muc'||path==='/admin/quan-tri/kiem-tra'||path==='/admin/quan-tri/cau-hinh'){
        if(!requireRoles(['admin']))return false;
        if(path==='/admin/quan-tri/tai-khoan'&&typeof window.phfRenderAccountAdminSafe==='function') await Promise.resolve(window.phfRenderAccountAdminSafe());
        else if(path==='/admin/quan-tri/danh-muc'&&typeof window.phfRenderAdminPlaceholder==='function') await Promise.resolve(window.phfRenderAdminPlaceholder('Danh mục chung'));
        else if(path==='/admin/quan-tri/kiem-tra'&&typeof window.phfRenderDirectTrainingTestPage==='function') await Promise.resolve(window.phfRenderDirectTrainingTestPage());
        else if(path==='/admin/quan-tri/cau-hinh'&&typeof window.phfRenderAdminPlaceholder==='function') await Promise.resolve(window.phfRenderAdminPlaceholder('Cấu hình'));
        else await Promise.resolve(window.phfRenderAdminManagement&&window.phfRenderAdminManagement());
        return true;
      }
      setUrl(safeHomeForRole(),true); return render(safeHomeForRole(),true);
    }finally{
      var finalPath=cleanPath(location.pathname);
      if(runId===routeRenderSequence && window.PHFAppShell){
        try{window.PHFAppShell.syncFromRoute(finalPath,{clear:!/^\/(?:admin|ql|hv)(?:$|\/(?:hub|classroom|checklist|knl)(?:\/|$))/.test(finalPath)});}catch(e){}
      }
      if(runId===routeRenderSequence){
        lastCommittedPath=currentRouteKey();
        syncRouteUi(finalPath);
        normalizeCurrentHistoryEntry();
        setTimeout(function(){if(runId===routeRenderSequence)syncRouteUi(cleanPath(location.pathname));},160);
      }else{
        /* Một lượt cũ đã kết thúc sau khi URL chuyển sang màn khác. Renderer
           legacy có thể đã chạm DOM; render lại route hiện tại để thu hồi màn. */
        reconcileCurrentRoute('stale-render-completed',0);
      }
      setTimeout(function(){
        if(runId===routeRenderSequence){
          applyingRoute=false;
          updateCopyAction();
          /* 62.2: Boot guard được gắn cho mọi deep link trước khi Router chạy.
             Trước đây guard chỉ được gỡ chủ động ở /admin/bao-cao và
             /ql/quan-ly; các route còn lại phải chờ watchdog 10 giây dù màn
             đích đã render xong. Gỡ guard sau hai nhịp vẽ của mọi lượt render
             thành công để loading kết thúc đúng lúc, không thay đổi renderer
             hay nghiệp vụ của route. */
          requestAnimationFrame(function(){requestAnimationFrame(function(){
            if(runId!==routeRenderSequence) return;
            if(holdRouteGuard&&routeGuardOwnerRunId!==runId) return;
            if(holdRouteGuard) routeGuardOwnerRunId=0;
            releaseBootGuard();
          });});
        }
      },80);
    }
  }

  async function navigate(path,replace,meta){
    path=canonicalRouteKey(path);
    setUrl(path,!!replace);
    try{
      return await render(path,false,meta||{source:'user'});
    }catch(err){
      console.error('[PHF ROUTER] navigation failed',path,err);
      /* Không đổi sang route khác khi renderer lỗi. Giữ URL để có thể chẩn
         đoán, nhưng thu hồi shell/menu theo đúng route thay vì để màn trước. */
      reconcileCurrentRoute('navigation-error',80);
      throw err;
    }
  }
  window.phfNavigate=navigate;
  function navigateToHrHome(){
    var target=safeHomeForRole();
    /* Điều hướng giữa module về PHF HR dùng tải trang đầy đủ. Đây là ranh giới
       cấp hệ sinh thái, không phải chuyển màn nội bộ Hub/Classroom. Hard navigation
       tự hủy toàn bộ timer, listener và renderer cũ nên không còn DOM bị chiếm lại.
       Nếu URL đã đúng nhưng DOM còn cũ, reload ngay để phục hồi đúng shell. */
    routeRenderSequence++;
    applyingRoute=false;
    try{
      if(cleanPath(location.pathname)===target){ location.reload(); return false; }
      location.assign(target);
    }catch(e){ location.href=target; }
    return false;
  }
  window.phfNavigateToHrHome=navigateToHrHome;

  function commandWrap(name,pathFactory){
    var fn=window[name];
    if(typeof fn!=='function'||fn[ROUTE_MARK]) return;
    function wrapped(){
      var self=this,args=[].slice.call(arguments);
      /* Renderer chỉ được gọi trực tiếp khi Router đang sở hữu lượt render.
         Mọi click/legacy call bên ngoài phải đi qua navigate trước, nhờ vậy
         URL, namespace, role guard, shell và renderer luôn cùng một trạng thái. */
      if(applyingRoute){
        /* Trong lúc Router đang dựng một route, callback legacy có thể hoàn tất
           muộn và gọi renderer của màn khác. Chỉ cho gọi trực tiếp khi route
           đích của lệnh vẫn khớp URL hiện tại. Riêng phfRenderTrainingOverview
           của Admin là alias điều hướng sang Báo cáo, không phải renderer Báo
           cáo, nên tuyệt đối không được chạy trực tiếp tại /admin/bao-cao. */
        return Promise.resolve(pathFactory.apply(self,args)).then(function(path){
          var current=cleanPath(location.pathname);
          var target=path?cleanPath(path):'';
          if(name==='phfRenderTrainingOverview'&&current==='/admin/bao-cao') return false;
          if(target&&target!==current) return false;
          return fn.apply(self,args);
        });
      }
      return Promise.resolve(pathFactory.apply(self,args)).then(function(path){
        if(!path) return fn.apply(self,args);
        return navigate(path,false,{source:'legacy'});
      });
    }
    wrapped[ROUTE_MARK]=true;
    wrapped.__phfOriginal=fn;
    window[name]=wrapped;
  }
  function installWrappers(){
    commandWrap('phfRenderPostLoginHome',function(){return safeHubHomeForRole();});
    commandWrap('phfGoHome',function(){return safeHomeForRole();});
    commandWrap('phfGoLearning',function(){
      try{
        if(role()==='admin' && sessionStorage.getItem('phfAdminLearningSimulation')==='active') return '';
      }catch(e){}
      return '/hv/bai-hoc';
    });
    commandWrap('phfGoMyProfile',function(){return role()==='learner'?'/hv/ho-so':(role()==='manager'?'/ql/hoc-vien':'/admin/hoc-vien');});
    commandWrap('phfRenderTrainingOverview',function(){return role()==='admin'?'/admin/bao-cao':'/ql/quan-ly';});
    commandWrap('phfRenderTrainingLibrary',function(){return role()==='admin'?'/admin/noi-dung':'/ql/noi-dung';});
    commandWrap('phfGoGuide',function(){return '/guide';});
    commandWrap('phfRenderGuidePage',function(){return '/guide';});
    commandWrap('phfGoDirectTrainingTest',function(){return role()==='admin'?'/admin/quan-tri/kiem-tra':'/direct-training-test';});
    commandWrap('phfRenderDirectTrainingTestPage',function(){return role()==='admin'?'/admin/quan-tri/kiem-tra':'/direct-training-test';});
    commandWrap('phfRenderAdminManagement',function(){return '/admin/quan-tri';});
    commandWrap('phfRenderAccountAdminSafe',function(){return '/admin/quan-tri/tai-khoan';});
    commandWrap('phfTrainingRecordsOpen',function(view){return view==='employees'?(role()==='admin'?'/admin/hoc-vien':'/ql/hoc-vien'):'';});
    commandWrap('phfTrainingRecordsOpenEmployee',async function(id,tab){
      if(role()==='admin'){
        var adminToken=await employeeToken(id),adminMap={tests:'tests',evaluations:'evaluations',probation:'probation',commitments:'commitments',overview:''},adminSuffix=adminMap[tab||'overview'];
        return '/admin/hoc-vien/'+adminToken+(adminSuffix?'/'+adminSuffix:'');
      }
      var token=await employeeToken(id),map={tests:'tests',evaluations:'evaluations',probation:'probation',commitments:'commitments',overview:''},suffix=map[tab||'overview'];
      return '/ql/hoc-vien/'+token+(suffix?'/'+suffix:'');
    });
    commandWrap('phfHubSetLearnerAndOpen',async function(id,tab){
      if(tab!=='evaluation') return '';
      if(role()==='admin') return '/admin/hoc-vien/'+await employeeToken(id)+'/evaluations';
      return '/ql/hoc-vien/'+await employeeToken(id)+'/evaluations';
    });
    commandWrap('phfRenderTrainingLibraryLesson',function(){
      var current=cleanPath(location.pathname);
      var target=role()==='admin'?'/admin/noi-dung':'/ql/noi-dung';
      /* Đang ở đúng thư viện nội dung thì mở chi tiết ngay trong renderer
         read-only cũ. Không navigate lại route cha vì route cha sẽ dựng lại
         danh sách và cuộn lên đầu; cũng tuyệt đối không chuyển sang /hv. */
      return current===target?'':target;
    });
    commandWrap('phfGo',function(idx){var item=(window.PHF_LESSONS||[])[Number(idx)]||{};return '/hv/bai-hoc/'+lessonSlug(item,Number(idx));});
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
    var url=location.origin+currentRouteKey();
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
      var result=await navigate(target,true,{source:'restore'});
      try{sessionStorage.removeItem('phfRouteReturnTo');}catch(e){}
      pendingPath='';
      return result;
    }
    pendingPath='';
    if(location.pathname==='/login') return navigate(safeHomeForRole(),true,{source:'restore'});
    return render(currentRouteKey(),true,{source:'restore'});
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
    var path=currentRouteKey();
    /* Tăng sequence ngay khi người dùng Back/Forward để mọi renderer đang chờ
       dữ liệu biết rằng lượt của nó đã cũ, kể cả trước khi render mới bắt đầu. */
    routeRenderSequence++;
    applyingRoute=false;
    Promise.resolve(render(path,true,{source:'popstate'})).then(function(){
      if(run===popstateRun){
        lastCommittedPath=currentRouteKey();
        normalizeCurrentHistoryEntry();
      }
    }).catch(function(err){
      if(run!==popstateRun) return;
      console.error('[PHF ROUTER] popstate render failed',err);
      var fallback=safeHomeForRole();
      setUrl(fallback,true);
      render(fallback,true,{source:'popstate-fallback'});
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
      document.documentElement.classList.remove('phf-route-boot-pending','phf-route-shell-early');
    }catch(e){}
  }

  async function boot(){
    if(routerStarted) return true;
    routerStarted=true;
    currentRenderSource='boot';
    installLegacyHistoryGuard();
    installPageShowGuard();
    normalizeCurrentHistoryEntry();
    lastCommittedPath='';
    migrateRouteStorage();
    /* Router được nạp sau các module chính nên chỉ cần bọc hàm một lần.
       Không chạy MutationObserver toàn trang khi mỗi màn render, tránh công
       việc lặp không cần thiết sau khi chức năng sao chép link đã tắt. */
    installWrappers();
    window.phfRestoreLastRouteAfterAuth=async function(){
      if(restoreInFlight) return restoreInFlight;
      restoreInFlight=(async function(){
        /* Checklist là module độc lập và trang nền không cần payload /api/data.
           Khi F5 tại /admin|ql|hv/checklist, chỉ chờ session xác thực rồi dựng
           đúng shell ngay. Không chờ phfWhenAppReady vì Promise này còn phụ
           thuộc dữ liệu Training Hub; nếu dữ liệu chậm hơn watchdog 7 giây,
           Auth sẽ fallback về Home và làm mất deep link Checklist. */
        var stored='';try{stored=sessionStorage.getItem('phfRouteReturnTo')||'';}catch(e){}
        var explicitTarget=stored||pendingPath;
        var currentKey=currentRouteKey();
        var currentPath=cleanPath(location.pathname);
        var target=safeReturnTo(explicitTarget||(currentPath!=='/'&&currentPath!=='/login'?currentKey:''));
        var checklistTarget=/^\/(?:admin|ql|hv)\/checklist(?:\/|$)/.test(cleanPath(target||currentPath));
        try{
          if(checklistTarget && typeof window.phfWhenAuthReady==='function') await window.phfWhenAuthReady();
          else if(typeof window.phfWhenAppReady==='function') await window.phfWhenAppReady();
        }catch(e){}
        if(!authenticated()) return false;

        /* Trang / là trang giới thiệu công khai. Khi người dùng chủ động đăng
           nhập tại đây mà không có returnTo, không được coi / là màn cần
           khôi phục; phải để luồng đăng nhập mở trang mặc định theo vai trò. */
        if(target&&target!=='/login'&&target!=='/'){
          await navigate(target,true,{source:'restore'});
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

    /* 1.0.20 - Một chủ sở hữu cho lần dựng đầu tiên sau F5.
       phf-server-auth là nơi duy nhất thực hiện:
       session -> role -> restore deep link -> đóng intro -> render màn.
       Router chỉ đăng ký hàm phục hồi ở phía trên và xử lý các điều hướng
       phát sinh sau khi ứng dụng đã sẵn sàng (click, Back/Forward). Không gọi
       render(current) lần thứ hai tại đây vì lần render chồng có thể bật lại
       intro, đổi route hoặc đưa sai vai trò sang màn khác. */
    if(cleanPath(location.pathname)==='/login'&&!authenticated()){
      try{
        var q=new URLSearchParams(location.search).get('returnTo');
        if(q){pendingPath=safeReturnTo(q);sessionStorage.setItem('phfRouteReturnTo',pendingPath);}
      }catch(e){}
    }
    window.__phfAuthHandledInitialRoute=false;
    updateCopyAction();
    /* Không gỡ boot guard tại đây. Auth sẽ gỡ sau khi route đầu tiên đã render
       xong; gỡ sớm chính là nguyên nhân lộ màn mặc định trước màn đích. */
  }
  window.phfStartUrlRouter=boot;
  window.phfUrlRouterReady=true;
})();
