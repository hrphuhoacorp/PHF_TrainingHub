/* PHF Training Hub - Server session authentication: single source of truth */
(function(){
  'use strict';

  var sessionUser = null;
  var authPhase = 'checking';
  var authReadyResolve;
  var initialAuthReady = new Promise(function(resolve){ authReadyResolve = resolve; });
  var appReadyResolve;
  var appReady = new Promise(function(resolve){ appReadyResolve = resolve; });
  var appReadySettled = false;
  var trainingDataPromise = null;
  var expiredSessionCheckPromise = null;
  var loginOpening = false;
  var authTransitioning = false;
  var authTransitionResolve = null;
  var authTransitionPromise = Promise.resolve();
  /* Mỗi thay đổi xác thực tăng một phiên bản. Kết quả kiểm tra phiên cũ
     không được phép ghi đè phiên đăng nhập vừa hoàn tất. */
  var authEpoch = 0;
  var authBootStarted = false;
  /* 61.3: Gộp các lượt kiểm tra session phát sinh gần nhau khi F5.
     Chỉ tối ưu request; không thay đổi nguồn xác thực hoặc cách thiết lập phiên. */
  var serverSessionRequestPromise = null;
  var serverSessionCacheAt = 0;
  var serverSessionCacheUser = null;

  function esc(v){
    return String(v == null ? '' : v).replace(/[&<>"']/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function dispatchAuthChanged(){
    try{ window.dispatchEvent(new CustomEvent('phf-auth-changed',{detail:{user:sessionUser}})); }catch(e){}
  }

  function resetAppReady(){
    appReadySettled = false;
    appReady = new Promise(function(resolve){ appReadyResolve = resolve; });
  }

  function settleAppReady(user){
    if(appReadySettled) return;
    appReadySettled = true;
    if(appReadyResolve) appReadyResolve(user || null);
  }

  window.phfGetCurrentUser = function(){ return sessionUser || null; };

  window.phfWhenAuthReady = function(){
    if(authPhase !== 'checking') return Promise.resolve(sessionUser || null);
    return initialAuthReady;
  };
  window.phfWhenAppReady = function(){
    return appReadySettled ? Promise.resolve(sessionUser || null) : appReady;
  };

  function phfCurrentTrainingDataIsReady(){
    var data = window.__phfLocalData;
    if(!data || typeof data !== 'object') return false;
    var role = String((sessionUser&&sessionUser.role)||'learner').toLowerCase();
    if(role === 'admin' || role === 'manager'){
      return Array.isArray(data.employees) && Array.isArray(data.hubAccounts) && data.hubAccountsReady === true;
    }
    return Array.isArray(data.employees);
  }

  window.phfWhenTrainingDataReady = function(){
    if(!sessionUser){ if(window.phfTraceData)window.phfTraceData('auth:data-ready:no-session',{}); return Promise.resolve(false); }
    if(window.phfTraceData)window.phfTraceData('auth:data-ready:enter',{hasCachedPromise:!!trainingDataPromise,userRole:String(sessionUser.role||''),state:window.phfSummarizeTrainingData?window.phfSummarizeTrainingData(window.__phfLocalData):{}});
    /* 62.29: Không giữ vĩnh viễn một Promise đã resolve false trong suốt phiên.
       Khi F5 gặp một lượt boot chưa đủ dữ liệu, route/tab sau phải được phép
       dùng lại owner phfRefreshTrainingData để phục hồi thay vì nhận mãi kết
       quả false cũ. Registry request ở learner-app vẫn chống gọi trùng. */
    if(!trainingDataPromise){
      var currentPromise = Promise.resolve(preloadProtectedData('route-data-needed'))
        .then(function(ok){ return ok === true || phfCurrentTrainingDataIsReady(); })
        .catch(function(){ return phfCurrentTrainingDataIsReady(); });
      trainingDataPromise = currentPromise;
      currentPromise.then(function(ok){if(window.phfTraceData)window.phfTraceData('auth:data-ready:resolved',{ok:!!ok,state:window.phfSummarizeTrainingData?window.phfSummarizeTrainingData(window.__phfLocalData):{},lastWriter:String(window.__phfLocalDataLastWriter||'')});return ok;});
      currentPromise.finally(function(){
        if(trainingDataPromise === currentPromise) trainingDataPromise = null;
      });
    }
    return trainingDataPromise;
  };
  window.phfIsAuthReady = function(){ return authPhase !== 'checking'; };
  window.phfGetAuthenticatedUser = function(){
    if(sessionUser){
      sessionUser = phfNormalizeSessionUser(sessionUser);
      phfWriteSessionMirror(sessionUser);
      phfSyncVisibleSessionName(sessionUser);
    }
    return sessionUser;
  };
  window.phfGetSessionRole = function(){ return sessionUser ? String(sessionUser.role || '') : ''; };
  window.phfHasAuthenticatedSession = function(){ return !!sessionUser; };
  window.phfUserRole = function(){ return sessionUser ? String(sessionUser.role || 'learner') : 'learner'; };

  function beginAuthTransition(){
    serverSessionCacheAt = 0;
    serverSessionCacheUser = null;
    authEpoch += 1;
    authTransitioning = true;
    authTransitionPromise = new Promise(function(resolve){ authTransitionResolve = resolve; });
  }

  function endAuthTransition(){
    authTransitioning = false;
    if(authTransitionResolve){ authTransitionResolve(sessionUser || null); authTransitionResolve = null; }
  }

  window.phfIsAuthTransitioning = function(){ return authTransitioning; };
  window.phfWaitForAuthTransition = function(){ return authTransitioning ? authTransitionPromise : Promise.resolve(sessionUser || null); };

  function phfIsStandaloneHrAdmin(user){
    if(!user) return false;
    var email = String(user.email || '').trim().toLowerCase();
    var role = String(user.role || '').trim().toLowerCase();
    var employeeId = String(user.employeeId || user.employee_id || '').trim();
    return email === 'hr.phuhoacorp@gmail.com' && role === 'admin' && !employeeId;
  }

  function phfResolveSessionDisplayName(user){
    if(!user) return '';
    if(phfIsStandaloneHrAdmin(user)) return 'HR PHUHOA FRESH';
    var currentName = String(user.name || '').trim();
    var email = String(user.email || '').trim().toLowerCase();
    return currentName || email || 'PHF';
  }

  function phfNormalizeSessionUser(user){
    if(!user) return null;
    var resolvedName = phfResolveSessionDisplayName(user);
    return Object.assign({}, user, {name: resolvedName});
  }

  function phfWriteSessionMirror(user){
    try{
      var roleKeys = ['phfInternalRole','phfInternalTestRole','phfTestRole','phfRole','phfUserRole'];
      if(user){
        var role = String(user.role || 'learner');
        var nextEmail = String(user.email || '').trim().toLowerCase();
        var previousEmail = String(localStorage.getItem('phfActiveLoginEmail') || localStorage.getItem('phfSimpleTestLoginEmail') || '').trim().toLowerCase();
        var switchedAccount = !!(previousEmail && nextEmail && previousEmail !== nextEmail);

        var oldProfile = {};
        try{ oldProfile = JSON.parse(localStorage.getItem('phfEmployeeProfile') || '{}') || {}; }catch(e){}
        var oldProfileEmail = String(oldProfile.accountEmail || '').trim().toLowerCase();
        var sameAccountProfile = !switchedAccount && (!oldProfileEmail || !nextEmail || oldProfileEmail === nextEmail);
        if(!sameAccountProfile) oldProfile = {};

        if(switchedAccount){
          ['phfRefreshResumeState','phfCurrentPage','phfCurrentLessonIndex','phfLastLessonIndex','phfCurrentLessonKey','phfLastViewedPage','phfStudyStartDate','phfQuizResults']
            .forEach(function(k){ localStorage.removeItem(k); });
          try{ window.phfCurrentLessonIndex = 0; window.phfCurrentLessonKey = 'lesson:0'; }catch(_e){}
          try{ if(typeof window.phfResetLearningRuntimeForAccountSwitch === 'function') window.phfResetLearningRuntimeForAccountSwitch(); }catch(_e){}
        }

        localStorage.setItem('phfSimpleTestLoginEmail', nextEmail);
        localStorage.setItem('phfActiveLoginEmail', nextEmail);
        localStorage.setItem('phfLoginEmail', user.email || '');
        localStorage.setItem('phfLoginName', user.name || '');
        localStorage.setItem('phfLoginPhone', user.phone || '');
        roleKeys.forEach(function(k){ localStorage.setItem(k, role); });

        var officialEmployeeId = String(user.employeeId || user.employee_id || '').trim();
        var safeOldId = sameAccountProfile && officialEmployeeId && String(oldProfile.id || '') === officialEmployeeId ? oldProfile.id : '';
        var profile = {
          id: officialEmployeeId || safeOldId || '',
          fullName: user.name || (sameAccountProfile ? oldProfile.fullName : '') || '',
          phone: user.phone || (sameAccountProfile ? oldProfile.phone : '') || '',
          branch: user.branch || (sameAccountProfile ? oldProfile.branch : '') || '',
          department: user.department || (sameAccountProfile ? oldProfile.department : '') || '',
          position: user.position || (sameAccountProfile ? oldProfile.position : '') || '',
          trainingAudience: user.trainingAudience || (sameAccountProfile ? oldProfile.trainingAudience : '') || '',
          hubAssignmentStatus: user.hubAssignmentStatus || (sameAccountProfile ? oldProfile.hubAssignmentStatus : '') || '',
          defaultProgram: user.defaultProgram || (sameAccountProfile ? oldProfile.defaultProgram : '') || '',
          accountEmail: user.email || ''
        };
        localStorage.setItem('phfEmployeeProfile', JSON.stringify(profile));
        localStorage.setItem('phfEmployeeId', profile.id);
        if(user.studyStartDate || user.study_start_date) localStorage.setItem('phfStudyStartDate', user.studyStartDate || user.study_start_date);
        else if(switchedAccount) localStorage.removeItem('phfStudyStartDate');
        window.currentProfile = profile;
      }else{
        ['phfSimpleTestLoginEmail','phfActiveLoginEmail','phfLoginEmail','phfLoginName','phfLoginPhone','phfEmployeeProfile','phfEmployeeId','phfStudyStartDate']
          .concat(roleKeys)
          .forEach(function(k){ localStorage.removeItem(k); });
        window.currentProfile = null;
        try{ window.phfCurrentLessonIndex = 0; window.phfCurrentLessonKey = 'lesson:0'; }catch(_e){}
      }
    }catch(e){}
  }

  function phfSyncVisibleSessionName(user){
    if(!phfIsStandaloneHrAdmin(user)) return;
    var name = 'HR PHUHOA FRESH';
    var greeting = document.getElementById('phfUserGreetingName');
    if(greeting && greeting.textContent !== name) greeting.textContent = name;

    document.querySelectorAll('.phf-login-entry strong, .phf-home-account-name').forEach(function(node){
      if(node.textContent !== name) node.textContent = name;
    });

    var login = document.querySelector('.phf-login-entry');
    if(login && login.getAttribute('title') !== name) login.setAttribute('title', name);
  }

  function applySessionMirror(user){
    sessionUser = phfNormalizeSessionUser(user);
    phfWriteSessionMirror(sessionUser);
    phfSyncVisibleSessionName(sessionUser);
    dispatchAuthChanged();
  }

  var phfDisplaySyncQueued = false;
  function refreshSystemAdminDisplayMirror(){
    if(!sessionUser || !phfIsStandaloneHrAdmin(sessionUser)) return;
    sessionUser = phfNormalizeSessionUser(sessionUser);
    phfWriteSessionMirror(sessionUser);
    phfSyncVisibleSessionName(sessionUser);
  }

  function queueSystemAdminDisplayMirror(){
    if(phfDisplaySyncQueued) return;
    phfDisplaySyncQueued = true;
    var run = function(){
      phfDisplaySyncQueued = false;
      refreshSystemAdminDisplayMirror();
    };
    if(typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  window.phfRefreshAuthenticatedDisplay = refreshSystemAdminDisplayMirror;
  window.addEventListener('pageshow', queueSystemAdminDisplayMirror);
  window.addEventListener('focus', queueSystemAdminDisplayMirror);
  window.addEventListener('phf-auth-changed', queueSystemAdminDisplayMirror);
  window.addEventListener('storage', function(ev){
    if(!ev || ['phfLoginName','phfEmployeeProfile','phfLoginEmail'].indexOf(ev.key) >= 0){
      queueSystemAdminDisplayMirror();
    }
  });
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'visible') queueSystemAdminDisplayMirror();
  });
  document.addEventListener('DOMContentLoaded', function(){
    queueSystemAdminDisplayMirror();
    if(!window.MutationObserver) return;
    var observer = new MutationObserver(function(mutations){
      if(!sessionUser || !phfIsStandaloneHrAdmin(sessionUser)) return;
      for(var i=0;i<mutations.length;i++){
        if(mutations[i].type === 'childList'){
          queueSystemAdminDisplayMirror();
          break;
        }
      }
    });
    observer.observe(document.body, {childList:true, subtree:true});
  });

  async function request(url, opts){
    var options = Object.assign({credentials:'include',cache:'no-store'}, opts || {});
    var response = await fetch(url, options);
    var json = await response.json().catch(function(){ return {}; });
    if(!response.ok){
      var err = new Error(json.error || 'Không thể kết nối máy chủ.');
      err.status = response.status;
      err.code = json.code || '';
      throw err;
    }
    return json;
  }

  function ensurePasswordChangeStyle(){
    if(document.getElementById('phf-required-password-style')) return;
    var st=document.createElement('style');st.id='phf-required-password-style';st.textContent='.phf-required-pw{position:fixed;inset:0;z-index:100000;background:rgba(9,31,23,.58);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:18px}.phf-required-pw-card{width:min(500px,100%);background:#fff;border:1px solid #dcebe4;border-radius:20px;box-shadow:0 28px 80px rgba(0,35,24,.28);overflow:hidden;font-family:Arial,"Helvetica Neue",Helvetica,system-ui,sans-serif}.phf-required-pw-head{padding:22px 24px 14px}.phf-required-pw-head span{display:inline-flex;padding:5px 9px;border-radius:999px;background:#fff5df;color:#865b00;font-size:12px;font-weight:700}.phf-required-pw-head h2{margin:12px 0 7px;color:#17382d;font-size:22px}.phf-required-pw-head p{margin:0;color:#60756c;line-height:1.55}.phf-required-pw-body{padding:4px 24px 20px;display:grid;gap:13px}.phf-required-pw-field label{display:block;margin-bottom:6px;color:#445c52;font-size:13px;font-weight:650}.phf-required-pw-field input{width:100%;min-height:44px;border:1px solid #d6e9e1;border-radius:12px;padding:0 12px;font-size:15px;outline:none}.phf-required-pw-field input:focus{border-color:#75ad98;box-shadow:0 0 0 3px rgba(7,84,62,.08)}.phf-required-pw-rule{color:#667a71;font-size:12.5px;line-height:1.5}.phf-required-pw-error{min-height:20px;color:#9a3412;font-size:13px}.phf-required-pw-actions{display:flex;justify-content:flex-end;gap:9px;padding:15px 24px 22px;border-top:1px solid #edf3f0;background:#fbfdfc}.phf-required-pw-actions button{min-height:42px;border-radius:11px;padding:0 16px;border:1px solid #d6e9e1;background:#fff;color:#315448;font-weight:650;cursor:pointer}.phf-required-pw-actions .primary{background:#07543e;border-color:#07543e;color:#fff}.phf-required-pw-actions button:disabled{opacity:.6;cursor:wait}';document.head.appendChild(st);
  }

  function requireFirstPasswordChange(user,currentPassword){
    return new Promise(function(resolve,reject){
      ensurePasswordChangeStyle();
      var old=document.getElementById('phfRequiredPasswordChange');if(old)old.remove();
      var root=document.createElement('div');root.id='phfRequiredPasswordChange';root.className='phf-required-pw';
      root.innerHTML='<section class="phf-required-pw-card" role="dialog" aria-modal="true"><div class="phf-required-pw-head"><span>Bắt buộc trước khi tiếp tục</span><h2>Thiết lập mật khẩu mới</h2><p>Tài khoản <b>'+esc(user&&user.email||'')+'</b> đang dùng mật khẩu tạm. Vui lòng đổi mật khẩu để bảo vệ tài khoản.</p></div><div class="phf-required-pw-body"><div class="phf-required-pw-field"><label>Mật khẩu tạm hiện tại</label><input id="phfRequiredCurrent" type="password" autocomplete="current-password"></div><div class="phf-required-pw-field"><label>Mật khẩu mới</label><input id="phfRequiredNew" type="password" autocomplete="new-password"></div><div class="phf-required-pw-field"><label>Nhập lại mật khẩu mới</label><input id="phfRequiredConfirm" type="password" autocomplete="new-password"></div><div class="phf-required-pw-rule">Mật khẩu cần ít nhất 8 ký tự, có chữ và số; phải khác mật khẩu tạm.</div><div class="phf-required-pw-error" id="phfRequiredError"></div></div><div class="phf-required-pw-actions"><button type="button" id="phfRequiredLogout">Đăng xuất</button><button type="button" class="primary" id="phfRequiredSave">Đổi mật khẩu và tiếp tục</button></div></section>';
      document.body.appendChild(root);document.body.style.overflow='hidden';
      var current=root.querySelector('#phfRequiredCurrent'),nw=root.querySelector('#phfRequiredNew'),confirm=root.querySelector('#phfRequiredConfirm'),error=root.querySelector('#phfRequiredError'),save=root.querySelector('#phfRequiredSave');
      if(currentPassword) current.value=currentPassword;
      function finish(){document.body.style.overflow='';root.remove()}
      save.onclick=async function(){
        error.textContent='';var cur=String(current.value||''),next=String(nw.value||''),cf=String(confirm.value||'');
        if(!cur){error.textContent='Vui lòng nhập mật khẩu tạm hiện tại.';return}
        if(next.length<8||!/[A-Za-zÀ-ỹ]/.test(next)||!/\d/.test(next)){error.textContent='Mật khẩu mới cần ít nhất 8 ký tự, có chữ và số.';return}
        if(next!==cf){error.textContent='Mật khẩu nhập lại chưa khớp.';return}
        if(next===cur){error.textContent='Mật khẩu mới phải khác mật khẩu tạm.';return}
        save.disabled=true;save.textContent='Đang cập nhật...';
        try{
          var result=await request('/api/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:cur,newPassword:next})});
          var updated=result&&result.user?result.user:Object.assign({},user,{mustChangePassword:false});finish();resolve(updated);
        }catch(e){error.textContent=authFriendlyMessage(e,'Chưa thể đổi mật khẩu.');save.disabled=false;save.textContent='Đổi mật khẩu và tiếp tục'}
      };
      root.querySelector('#phfRequiredLogout').onclick=function(){finish();reject(new Error('PASSWORD_CHANGE_CANCELLED'));};
      setTimeout(function(){(currentPassword?nw:current).focus()},30);
    });
  }

  async function readServerSession(){
    var now = Date.now();
    /* Trong lúc boot, server-auth, router và luồng phục hồi 401 có thể hỏi phiên
       gần như đồng thời. Dùng chung đúng một Promise để tránh gọi API lặp. */
    if(serverSessionRequestPromise) return serverSessionRequestPromise;
    /* Cache rất ngắn chỉ dùng trong cùng nhịp khởi động. Không dùng cache dài để
       tránh giữ sai trạng thái sau đăng nhập/đăng xuất. */
    if(serverSessionCacheAt && now - serverSessionCacheAt < 1500){
      return serverSessionCacheUser || null;
    }
    serverSessionRequestPromise = (async function(){
      var json = await request('/api/auth/session?_=' + Date.now());
      var user = json && json.authenticated ? json.user : null;
      serverSessionCacheUser = user || null;
      serverSessionCacheAt = Date.now();
      return user || null;
    })();
    try{
      return await serverSessionRequestPromise;
    }finally{
      serverSessionRequestPromise = null;
    }
  }

  async function preloadProtectedData(reason){
    if(window.phfTraceData)window.phfTraceData('auth:preload:enter',{reason:String(reason||''),hasOwnerPromise:!!window.__phfTrainingDataPromise});
    try{
      /* 62.1: Route chỉ chờ owner dữ liệu hiện có. Không reset runtime ở đây,
         vì reset giữa lúc learner app đang fetch sẽ xóa Promise/registry và
         làm phát sinh request /api/data thứ hai trong cùng một lần F5. */
      if(window.__phfTrainingDataPromise){
        var ownerResult=await window.__phfTrainingDataPromise;
        var ownerReady = ownerResult === true || phfCurrentTrainingDataIsReady();
        if(window.phfTraceData)window.phfTraceData('auth:preload:owner-result',{ok:!!ownerReady,ownerRaw:!!ownerResult});
        if(ownerReady) return true;
      }
      if(typeof window.phfRefreshTrainingData === 'function'){
        var refreshResult=await window.phfRefreshTrainingData({force:false,boot:true,reason:reason || 'route-data-needed'});
        var refreshReady = refreshResult === true || phfCurrentTrainingDataIsReady();
        if(window.phfTraceData)window.phfTraceData('auth:preload:refresh-result',{ok:!!refreshReady,refreshRaw:!!refreshResult});
        return refreshReady;
      }
      return true;
    }catch(e){
      console.warn('[PHF Auth] preload data:', e && e.message || e);
      return false;
    }
  }

  async function establishSession(user, reason){
    applySessionMirror(user);
    authPhase = user ? 'authenticated' : 'anonymous';
    if(authReadyResolve){
      authReadyResolve(user || null);
      authReadyResolve = null;
    }

    /* appReady chỉ đại diện cho phiên và giao diện nền đã sẵn sàng.
       Không khóa toàn bộ hệ thống để chờ /api/data, vì các màn như
       /admin/accounts không phụ thuộc dữ liệu đào tạo. */
    resetAppReady();
    settleAppReady(user || null);
    try{ if(typeof window.phfApplySimpleRoleMenu === 'function') window.phfApplySimpleRoleMenu(); }catch(e){}

    /* Không preload /api/data ngay khi vừa xác nhận phiên. Dữ liệu đào tạo
       chỉ được tải khi route thực sự cần, tránh làm chậm trang giới thiệu,
       màn tài khoản Admin và các thao tác chỉ đổi giao diện. */
    trainingDataPromise = null;
    return user || null;
  }

  function removeLogin(){
    var el = document.getElementById('phfTestLoginOverlay');
    if(el) el.remove();
    loginOpening = false;
  }

  function forceAnonymousPublicState(reason){
    try{
      window.__phfTrainingEntryReady = false;

      var intro = document.getElementById('introSection');
      if(intro) intro.hidden = false;

      document.body.classList.add('phf-intro-active');
      document.body.classList.remove(
        'phf-main-shell-mode',
        'phf-module-page-mode',
        'phf-eval-mode',
        'phf-role-admin',
        'phf-role-manager',
        'phf-role-learner'
      );

      document.querySelectorAll('[data-phf-main-nav]').forEach(function(btn){
        btn.classList.remove('active');
      });

      try{
        localStorage.removeItem('phfLastMainNav');
        localStorage.removeItem('phfLastAdminSubscreen');
        localStorage.removeItem('phfRefreshResumeState');
      }catch(e){}

      try{
        history.replaceState({phf:true,route:'intro',sub:'',role:'anonymous'},'',location.href);
      }catch(e){}

      if(typeof window.phfIntroGo === 'function'){
        window.phfIntroGo(0);
      }else if(typeof window.phfFeatureIntroReset === 'function'){
        window.phfFeatureIntroReset();
      }

      try{ window.scrollTo({top:0,left:0,behavior:'auto'}); }catch(e){}
      return true;
    }catch(e){
      console.warn('[PHF Auth] public intro:', reason || '', e && e.message || e);
      return false;
    }
  }

  function showPublicIntro(reason){
    return forceAnonymousPublicState(reason || 'anonymous');
  }
  window.phfForceAnonymousPublicState = forceAnonymousPublicState;

  async function renderAuthenticatedDefault(user, reason){
    if(!user) return false;
    try{
      if(typeof window.phfApplySimpleRoleMenu === 'function') window.phfApplySimpleRoleMenu();
    }catch(e){}

    await new Promise(function(resolve){ setTimeout(resolve, 0); });

    /* 1.0.17: khi URL router đã sẵn sàng, auth chỉ bàn giao việc phục hồi route.
       Không tự render Hub song song với route /classroom. */
    try{
      if(typeof window.phfRestoreLastRouteAfterAuth === 'function'){
        var routerRestored = await window.phfRestoreLastRouteAfterAuth(user);
        if(routerRestored) return true;
      }
      if(/^\/classroom(?:\/|$)/.test(location.pathname) && typeof window.phfNavigate === 'function'){
        await Promise.resolve(window.phfNavigate(location.pathname,true,{source:'auth'}));
        return true;
      }
    }catch(routerError){
      console.warn('[PHF Auth] router handoff:', reason || '', routerError && routerError.message || routerError);
    }

    try{
      /* PHF 27.6.12.4.7.3: mọi tài khoản sau đăng nhập chủ động đều vào
         Trang chủ sau đăng nhập. Deep link hợp lệ vẫn được phf-url-router
         khôi phục ở phía trên; chỉ fallback mặc định mới đổi về Trang chủ. */
      /* Route mặc định sau xác thực phải đi qua Router để URL, menu và
         nội dung luôn đồng nhất. Không gọi renderer trực tiếp tại Auth. */
      if(typeof window.phfNavigate === 'function'){
        await Promise.resolve(window.phfNavigate((window.phfGetRoleHomePath&&window.phfGetRoleHomePath())||'/hv', true,{source:'auth'}));
        return true;
      }
      /* Router chưa sẵn sàng thì không tự dựng màn tại Auth. */
    }catch(e){
      console.warn('[PHF Auth] restore/render:', reason || '', e && e.message || e);
    }
    return false;
  }
  window.phfRenderAuthenticatedDefault = renderAuthenticatedDefault;

  function authFriendlyMessage(error, fallback){
    var code=String(error&&error.code||'');
    var map={
      PASSWORD_WEAK:'Mật khẩu cần ít nhất 8 ký tự, có chữ và số.',
      CURRENT_PASSWORD_INVALID:'Mật khẩu hiện tại chưa đúng.',
      PASSWORD_CURRENT_INVALID:'Mật khẩu hiện tại chưa đúng.',
      PASSWORD_UNCHANGED:'Mật khẩu mới phải khác mật khẩu hiện tại.',
      LOGIN_INVALID:'Email hoặc mật khẩu chưa đúng.',
      GOOGLE_CREDENTIAL_MISSING:'Google chưa trả về thông tin xác minh. Vui lòng thử lại.',
      GOOGLE_TOKEN_INVALID:'Phiên xác minh Google không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.',
      GOOGLE_VERIFY_TIMEOUT:'Google phản hồi quá lâu. Vui lòng thử lại.',
      GOOGLE_VERIFY_UNAVAILABLE:'Chưa thể kết nối Google để xác minh tài khoản.',
      ACCOUNT_NOT_FOUND:'Gmail này chưa được Admin cấp tài khoản PHF.',
      ACCOUNT_LOCKED:'Tài khoản đang tạm khóa. Vui lòng liên hệ Admin.',
      ACCOUNT_INACTIVE:'Tài khoản đã ngừng sử dụng. Vui lòng liên hệ Admin.',
      EMPLOYEE_LINK_REQUIRED:'Tài khoản nhân viên chưa liên kết hồ sơ. Vui lòng liên hệ Admin.'
    };
    return map[code]||(error&&error.message)||fallback||'Thao tác chưa thành công. Vui lòng thử lại.';
  }

  function showGoogleAuthNotice(title,message,mode){
    var old=document.getElementById('phfGoogleAuthNotice');if(old)old.remove();
    var root=document.createElement('div');root.id='phfGoogleAuthNotice';root.className='phf-google-auth-notice';
    root.innerHTML='<section class="phf-google-auth-notice-card '+(mode||'loading')+'" role="dialog" aria-modal="true" aria-live="polite"><div class="phf-google-auth-notice-icon"><span class="phf-google-auth-g">G</span></div><div class="phf-google-auth-notice-copy"><h3></h3><p></p></div><button type="button" class="phf-google-auth-notice-close" aria-label="Đóng" hidden>×</button></section>';
    document.body.appendChild(root);
    function update(nextTitle,nextMessage,nextMode,closable){
      var card=root.querySelector('.phf-google-auth-notice-card');
      card.className='phf-google-auth-notice-card '+(nextMode||'loading');
      root.querySelector('h3').textContent=nextTitle||'';
      root.querySelector('p').textContent=nextMessage||'';
      var close=root.querySelector('.phf-google-auth-notice-close');close.hidden=!closable;
    }
    function close(){if(root&&root.parentNode)root.remove()}
    root.querySelector('.phf-google-auth-notice-close').onclick=close;
    update(title,message,mode,false);
    return{update:update,close:close,root:root};
  }

  function showLogin(){
    if(loginOpening || document.getElementById('phfTestLoginOverlay')) return;
    loginOpening = true;

    var root = document.createElement('div');
    root.id = 'phfTestLoginOverlay';
    root.className = 'phf-test-login-overlay';
    root.innerHTML =
      '<section class="phf-test-login-card" role="dialog" aria-modal="true">' +
        '<section class="phf-test-login-brand">' +
          '<div class="phf-login-logo-line"><div class="phf-login-logo-box"><img src="assets/logo/phf-logo.png" alt="PHUHOA FRESH"></div><span class="phf-login-system-badge">Cổng đào tạo nội bộ</span></div>' +
          '<div><div class="phf-login-title">Đăng nhập PHF Training Hub</div><div class="phf-login-subtitle">Phiên đăng nhập được xác minh tại máy chủ và áp dụng đúng quyền tài khoản.</div></div>' +
        '</section>' +
        '<section class="phf-test-login-form">' +
          '<div class="phf-login-form-title">Thông tin đăng nhập</div><div class="phf-login-form-sub">Nhập email và mật khẩu nội bộ.</div>' +
          '<div class="phf-test-login-field"><label>Email</label><input id="phfTestEmail" type="email" autocomplete="username"></div>' +
          '<div class="phf-test-login-field"><label>Mật khẩu</label><input id="phfTestPass" type="password" autocomplete="current-password"></div>' +
          '<div class="phf-test-login-error" id="phfTestLoginError"></div>' +
          '<div class="phf-test-login-actions"><button type="button" class="primary" id="phfTestSubmit">Đăng nhập</button><button type="button" id="phfTestCancel">Đóng</button></div>' +
          '<div class="phf-login-divider"><span>Hoặc tiếp tục bằng</span></div>' +
          '<div id="phfGoogleLoginWrap" class="phf-google-login-wrap"><div class="phf-google-login-heading"><b>Đăng nhập nhanh bằng Google</b><span>Dùng Gmail đã được Admin cấp quyền trong PHF.</span></div><div id="phfGoogleButton" class="phf-google-login-button" aria-label="Tiếp tục bằng Google"></div><div id="phfGoogleLoginStatus" class="phf-google-login-status" aria-live="polite">Đang chuẩn bị dịch vụ Google...</div></div>' +
          '<p class="phf-login-note">Quên mật khẩu hoặc chưa có tài khoản? Liên hệ Admin để được hỗ trợ.</p>' +
        '</section>' +
      '</section>';

    document.body.appendChild(root);
    var email = root.querySelector('#phfTestEmail');
    var pass = root.querySelector('#phfTestPass');
    var error = root.querySelector('#phfTestLoginError');
    var submitButton = root.querySelector('#phfTestSubmit');
    var googleButton = root.querySelector('#phfGoogleButton');
    var googleStatus = root.querySelector('#phfGoogleLoginStatus');
    var googleLoginInflight = false;
    var googleAuthNotice = null;
    var googleOpenTimer = null;

    async function completeLogin(verified, source, currentPassword){
      await establishSession(verified, source);
      removeLogin();
      if(verified.mustChangePassword && String(verified.authProvider || 'password') !== 'google'){
        try{
          verified=await requireFirstPasswordChange(verified,String(currentPassword||''));
          await establishSession(verified,'first-password-changed');
        }catch(changeError){
          await logout();
          return false;
        }
      }
      await renderAuthenticatedDefault(verified, source);
      try{document.documentElement.classList.remove('phf-auth-boot')}catch(e){}
      return true;
    }

    async function submit(){
      if(authTransitioning) return;
      error.textContent = '';
      submitButton.disabled = true;
      submitButton.textContent = 'Đang xác minh...';
      beginAuthTransition();
      try{
        var loginResult = await request('/api/auth/login',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            email:String(email.value || '').trim().toLowerCase(),
            password:String(pass.value || '')
          })
        });

        /* /api/auth/login đã xác thực tài khoản, tạo cookie HttpOnly và trả
           user công khai hợp lệ. Dùng ngay kết quả này, không gọi lại
           /api/auth/session và query user_accounts thêm một lần. */
        var verified = loginResult && loginResult.user ? loginResult.user : null;
        if(!verified) throw new Error('Chưa thể xác nhận tài khoản đăng nhập. Vui lòng thử lại.');

        await completeLogin(verified,'server-login',String(pass.value||''));
      }catch(e){
        error.textContent = e && e.message ? e.message : 'Đăng nhập chưa thành công.';
        submitButton.disabled = false;
        submitButton.textContent = 'Đăng nhập';
      }finally{
        endAuthTransition();
      }
    }


    async function handleGoogleCredential(response){
      if(authTransitioning||googleLoginInflight) return;
      var credential=response&&response.credential?String(response.credential):'';
      if(googleOpenTimer){clearTimeout(googleOpenTimer);googleOpenTimer=null}
      if(!credential){
        var missing='Google chưa trả về thông tin xác minh. Vui lòng thử lại.';
        error.textContent=missing;
        if(googleAuthNotice)googleAuthNotice.update('Chưa nhận được xác minh Google',missing,'error',true);
        return;
      }
      googleLoginInflight=true;
      error.textContent='';
      googleButton.classList.add('is-processing');
      if(googleStatus) googleStatus.textContent='Đang xác minh Gmail với hệ thống PHF...';
      if(!googleAuthNotice)googleAuthNotice=showGoogleAuthNotice('Đang xác minh tài khoản PHF','Google đã xác nhận Gmail. Hệ thống đang kiểm tra quyền truy cập.','loading');
      else googleAuthNotice.update('Đang xác minh tài khoản PHF','Google đã xác nhận Gmail. Hệ thống đang kiểm tra quyền truy cập.','loading',false);
      beginAuthTransition();
      try{
        var loginResult=await request('/api/auth/google/login',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({credential:credential})
        });
        var verified=loginResult&&loginResult.user?loginResult.user:null;
        if(!verified) throw new Error('Chưa thể xác nhận tài khoản PHF từ Gmail này.');
        googleAuthNotice.update('Đăng nhập thành công','Xin chào, '+String(verified.name||verified.email||'')+'.','success',false);
        await new Promise(function(resolve){setTimeout(resolve,420)});
        googleAuthNotice.close();googleAuthNotice=null;
        await completeLogin(verified,'google-login','');
      }catch(e){
        var friendly=authFriendlyMessage(e,'Đăng nhập Google chưa thành công.');
        error.textContent=friendly;
        if(googleStatus) googleStatus.textContent='Dùng Gmail đã được Admin cấp quyền trong PHF Training Hub.';
        if(googleAuthNotice)googleAuthNotice.update('Đăng nhập Google chưa thành công',friendly,'error',true);
      }finally{
        googleLoginInflight=false;
        googleButton.classList.remove('is-processing');
        endAuthTransition();
      }
    }

    async function initializeGoogleLogin(){
      if(!googleButton || !googleStatus) return;
      try{
        var config=await request('/api/auth/google/login?config=1&_='+Date.now());
        if(!config||!config.enabled||!config.clientId){
          googleStatus.textContent='Đăng nhập Google chưa được cấu hình.';
          return;
        }
        var attempts=0;
        (function waitForGoogle(){
          if(!document.body.contains(root)) return;
          if(window.google&&window.google.accounts&&window.google.accounts.id){
            try{
              google.accounts.id.initialize({
                client_id:String(config.clientId),
                callback:handleGoogleCredential,
                auto_select:false,
                cancel_on_tap_outside:true
              });
              googleButton.innerHTML='';
              var googleWidth=Math.max(260,Math.min(400,Math.round(googleButton.getBoundingClientRect().width||360)));
              google.accounts.id.renderButton(googleButton,{
                type:'standard',
                theme:'outline',
                size:'large',
                text:'continue_with',
                shape:'rectangular',
                logo_alignment:'left',
                width:googleWidth
              });
              googleButton.classList.add('is-ready');
              googleStatus.textContent='Sẵn sàng · Chọn Gmail đã được Admin cấp trong PHF.';
              if(!googleButton.__phfGooglePointerBound){
                googleButton.__phfGooglePointerBound=true;
                googleButton.addEventListener('pointerdown',function(){
                  if(googleLoginInflight||authTransitioning)return;
                  if(googleAuthNotice)googleAuthNotice.close();
                  googleAuthNotice=showGoogleAuthNotice('Đang mở đăng nhập Google','Vui lòng chọn Gmail đã được cấp quyền trong PHF Training Hub.','loading');
                  if(googleOpenTimer)clearTimeout(googleOpenTimer);
                  googleOpenTimer=setTimeout(function(){
                    if(!googleLoginInflight&&googleAuthNotice){
                      googleAuthNotice.update('Chưa nhận được xác nhận Google','Nếu cửa sổ Google đã đóng, anh/chị có thể đóng thông báo này và thử lại.','warning',true);
                    }
                  },8000);
                },true);
              }
            }catch(e){
              googleStatus.textContent='Chưa thể khởi tạo nút Google. Vui lòng tải lại trang.';
            }
            return;
          }
          attempts+=1;
          if(attempts<40) setTimeout(waitForGoogle,150);
          else googleStatus.textContent='Không tải được dịch vụ đăng nhập Google. Vui lòng kiểm tra kết nối.';
        })();
      }catch(e){
        googleStatus.textContent=e&&e.message?e.message:'Chưa thể tải cấu hình Google Login.';
      }
    }

    submitButton.onclick = submit;
    root.querySelector('#phfTestCancel').onclick = function(){
      removeLogin();
      if(!sessionUser){
        applySessionMirror(null);
        showPublicIntro('login-closed');
      }
    };
    [email,pass].forEach(function(input){
      input.addEventListener('keydown',function(e){ if(e.key === 'Enter') submit(); });
    });
    initializeGoogleLogin();
    setTimeout(function(){ email.focus(); },30);
  }

  async function logout(){
    authEpoch += 1;
    if(authTransitioning) endAuthTransition();
    try{
      await request('/api/auth/logout',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:'{}'
      });
    }catch(e){}
    applySessionMirror(null);
    authPhase = 'anonymous';
    resetAppReady();
    settleAppReady(null);
    try{ if(typeof window.phfResetTrainingRuntime === 'function') window.phfResetTrainingRuntime('server-logout'); }catch(e){}
    try{ if(typeof window.phfApplySimpleRoleMenu === 'function') window.phfApplySimpleRoleMenu(); }catch(e){}
    showPublicIntro('logout');
  }

  async function syncAccounts(){
    if(!sessionUser || sessionUser.role !== 'admin') return false;
    var keys = ['phfAdminAccountsSafeV18','phfAdminAccountsV17F','phfAdminAccountsV17C','phfAdminAccountsV17D','phfAdminAccountsV17B','phfAdminAccountsV1'];
    var accounts = [];
    for(var i=0;i<keys.length;i++){
      try{
        var list = JSON.parse(localStorage.getItem(keys[i]) || '[]');
        if(Array.isArray(list) && list.length){ accounts = list; break; }
      }catch(e){}
    }
    try{
      await request('/api/auth/accounts/sync',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({accounts:accounts})
      });
      return true;
    }catch(e){
      console.warn('[PHF Auth] Đồng bộ tài khoản:',e && e.message || e);
      return false;
    }
  }

  async function handleExpiredSession(){
    /* Chỉ cho một luồng kiểm tra phiên chạy tại một thời điểm. Nhiều màn có
       thể đồng thời nhận 401 khi F5; không để các kết quả cạnh tranh ghi đè
       currentUser hoặc mở màn đăng nhập nhiều lần. */
    if(expiredSessionCheckPromise) return expiredSessionCheckPromise;

    expiredSessionCheckPromise = (async function(){
      try{
        var user = await readServerSession();
        if(user){
          await establishSession(user,'session-recovered');
          return true;
        }

        /* Endpoint session đã phản hồi thành công và xác nhận không còn phiên.
           Đây mới là trường hợp được phép xóa mirror và chuyển về đăng nhập. */
        applySessionMirror(null);
        authPhase = 'anonymous';
        resetAppReady();
        settleAppReady(null);
        showProtectedLogin('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        return false;
      }catch(e){
        /* Lỗi mạng, timeout hoặc lỗi máy chủ không đồng nghĩa hết phiên.
           Giữ nguyên user hiện tại để router/UI không tự đăng xuất sai. */
        console.warn('[PHF Auth] session recheck unavailable:', e && e.message || e);
        return !!sessionUser;
      }
    })();

    try{ return await expiredSessionCheckPromise; }
    finally{ expiredSessionCheckPromise = null; }
  }

  window.phfShowServerLogin = showLogin;
  window.phfGoLogin = showLogin;
  window.phfShowRoleChooser = showLogin;
  window.phfLogoutSession = logout;
  window.phfLogoutTestUser = logout;
  window.phfServerAuthSyncAccounts = syncAccounts;
  window.phfHandleAuthExpired = handleExpiredSession;


  function isProtectedPath(){
    var path=String(location.pathname||'/').replace(/\/+$/,'')||'/';
    return /^\/(admin|ql|hv|home|overview|guide|training-content|employees|my-lessons|my-profile|programs|lessons|notifications|classroom)(\/|$)/.test(path);
  }

  function showProtectedLogin(message){
    forceAnonymousPublicState('protected-auth-required');
    try{ history.replaceState({},'', '/login'); }catch(e){}
    showLogin();
    if(message){
      setTimeout(function(){
        var err=document.getElementById('phfTestLoginError');
        if(err)err.textContent=message;
      },30);
    }
  }


  function clearBootCloak(){
    try{
      document.documentElement.classList.remove('phf-f5-restoring');
      document.documentElement.classList.remove('phf-auth-boot');
      if(window.__phfBootGuardTimer){clearTimeout(window.__phfBootGuardTimer);window.__phfBootGuardTimer=null;}
      if(typeof window.phfLoadingHideNow==='function') window.phfLoadingHideNow();
    }catch(e){}
  }

  function withTimeout(promise, ms, label){
    return Promise.race([
      Promise.resolve(promise),
      new Promise(function(_, reject){
        setTimeout(function(){
          var err=new Error(label||'TIMEOUT');err.code='TIMEOUT';reject(err);
        }, Math.max(1000, Number(ms)||8000));
      })
    ]);
  }

  async function renderInitialRouteSafely(user){
    /* Giai đoạn 1: Auth chỉ xác minh session và bàn giao cho Router.
       Không dựng riêng màn Admin/Learner tại đây. */
    try{
      return await withTimeout(renderAuthenticatedDefault(user,'server-session-restored'),7000,'ROUTE_RESTORE_TIMEOUT');
    }catch(e){
      console.warn('[PHF Auth] route restore timeout/fail:',e&&e.message||e);
      return false;
    }
  }

  async function bootAuth(){
    if(authBootStarted) return true;
    authBootStarted=true;
    var bootEpoch = authEpoch;
    try{
      var user = await withTimeout(readServerSession(),8000,'SESSION_TIMEOUT');
      if(bootEpoch !== authEpoch || authTransitioning) return;
      await establishSession(user,'server-session-restored');
      if(bootEpoch !== authEpoch || authTransitioning) return;

      /* 61.6: Với route Học viên, session đã xác nhận thì mở ngay header/menu.
         Route guard vẫn giữ skeleton riêng cho nội dung tới khi dữ liệu hoàn tất. */
      try{
        var bootPath=String(location.pathname||'/').replace(/\/+$/,'')||'/';
        if(user && (bootPath==='/hv'||bootPath==='/hv/bai-hoc')){
          document.documentElement.classList.remove('phf-auth-boot');
          if(window.__phfBootGuardTimer){clearTimeout(window.__phfBootGuardTimer);window.__phfBootGuardTimer=null;}
        }
      }catch(_earlyShellError){}

      /* 60.8: Với phiên hợp lệ, giữ boot cloak cho tới khi Router đã dựng đúng
         route đầu tiên. Trước đây cloak bị gỡ tại đây nên màn mặc định/Học viên
         có thể lóe lên trước Báo cáo hoặc Khu Quản lý. */

      if(user){
        if(user.mustChangePassword && String(user.authProvider || 'password') !== 'google'){
          /* Modal đổi mật khẩu là một luồng tương tác bắt buộc nên phải mở cloak
             trước khi hiển thị modal; sau đó Router vẫn chịu trách nhiệm route. */
          clearBootCloak();
          try{
            user=await requireFirstPasswordChange(user,'');
            await establishSession(user,'first-password-changed-restored');
          }catch(changeError){
            await logout();
            return;
          }
        }
        var rendered=await renderInitialRouteSafely(user);
        if(!rendered){
          /* Fallback vẫn phải đi qua Router để URL, menu, shell và nội dung
             không thể bị các renderer tự ghi đè lẫn nhau. */
          if(typeof window.phfNavigate==='function') await Promise.resolve(window.phfNavigate((window.phfGetRoleHomePath&&window.phfGetRoleHomePath())||'/hv',true,{source:'auth'}));
        }
      }else{
        if(isProtectedPath()) showProtectedLogin('Phiên đăng nhập đã hết hạn hoặc thông tin tài khoản đã thay đổi. Vui lòng đăng nhập lại.');
        else showPublicIntro('anonymous-boot');
      }
    }catch(e){
      if(bootEpoch !== authEpoch || authTransitioning) return;
      await establishSession(null,'server-session-error');
      clearBootCloak();
      if(isProtectedPath()) showProtectedLogin(e&&e.code==='TIMEOUT'?'Máy chủ xác minh phiên phản hồi quá lâu. Vui lòng đăng nhập lại.':'Chưa thể xác minh phiên đăng nhập. Vui lòng thử đăng nhập lại.');
      else showPublicIntro('session-error');
    }finally{
      clearBootCloak();
    }
  }

  window.phfStartServerAuth=bootAuth;
  window.phfServerAuthReady=true;
})();
