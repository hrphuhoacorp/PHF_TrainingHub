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
  var loginOpening = false;

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

  window.phfWhenAuthReady = function(){
    if(authPhase !== 'checking') return Promise.resolve(sessionUser || null);
    return initialAuthReady;
  };
  window.phfWhenAppReady = function(){
    return appReadySettled ? Promise.resolve(sessionUser || null) : appReady;
  };
  window.phfIsAuthReady = function(){ return authPhase !== 'checking'; };
  window.phfGetAuthenticatedUser = function(){ return sessionUser; };
  window.phfGetSessionRole = function(){ return sessionUser ? String(sessionUser.role || '') : ''; };
  window.phfHasAuthenticatedSession = function(){ return !!sessionUser; };
  window.phfUserRole = function(){ return sessionUser ? String(sessionUser.role || 'learner') : 'learner'; };

  function applySessionMirror(user){
    sessionUser = user || null;
    try{
      var roleKeys = ['phfInternalRole','phfInternalTestRole','phfTestRole','phfRole','phfUserRole'];
      if(user){
        var role = String(user.role || 'learner');
        localStorage.setItem('phfSimpleTestLoginEmail', String(user.email || '').toLowerCase());
        localStorage.setItem('phfActiveLoginEmail', String(user.email || '').toLowerCase());
        localStorage.setItem('phfLoginEmail', user.email || '');
        localStorage.setItem('phfLoginName', user.name || '');
        localStorage.setItem('phfLoginPhone', user.phone || '');
        roleKeys.forEach(function(k){ localStorage.setItem(k, role); });

        var phone = String(user.phone || '').replace(/\D/g,'');
        var profile = {
          id: user.employeeId || (phone ? ('test-phone-' + phone) : ('acct-' + String(user.email || '').replace(/[^a-z0-9]+/gi,'-'))),
          fullName: user.name || '',
          phone: user.phone || '',
          branch: user.branch || '',
          department: user.department || '',
          position: user.position || '',
          trainingAudience: user.trainingAudience || '',
          accountEmail: user.email || ''
        };
        localStorage.setItem('phfEmployeeProfile', JSON.stringify(profile));
        localStorage.setItem('phfEmployeeId', profile.id);
        window.currentProfile = profile;
      }else{
        ['phfSimpleTestLoginEmail','phfActiveLoginEmail','phfLoginEmail','phfLoginName','phfLoginPhone']
          .concat(roleKeys)
          .forEach(function(k){ localStorage.removeItem(k); });
        window.currentProfile = null;
      }
    }catch(e){}
    dispatchAuthChanged();
  }

  async function request(url, opts){
    var options = Object.assign({credentials:'same-origin',cache:'no-store'}, opts || {});
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

  async function readServerSession(){
    var json = await request('/api/auth/session?_=' + Date.now());
    return json && json.authenticated ? json.user : null;
  }

  async function preloadProtectedData(reason){
    try{
      if(typeof window.phfResetTrainingRuntime === 'function'){
        window.phfResetTrainingRuntime(reason || 'auth-preload');
      }
      if(typeof window.phfRefreshTrainingData === 'function'){
        return await window.phfRefreshTrainingData({force:true});
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
    resetAppReady();
    if(user) await preloadProtectedData(reason || 'session-established');
    settleAppReady(user || null);
    try{ if(typeof window.phfApplySimpleRoleMenu === 'function') window.phfApplySimpleRoleMenu(); }catch(e){}
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

    try{
      if(typeof window.phfRestoreLastRouteAfterAuth === 'function'){
        var restored = await window.phfRestoreLastRouteAfterAuth(user);
        if(restored) return true;
      }

      var role = String(user.role || '').toLowerCase();
      if(role === 'learner'){
        if(typeof window.phfGoLearning === 'function'){
          await Promise.resolve(window.phfGoLearning());
          return true;
        }
      }else{
        if(typeof window.phfRenderPostLoginHome === 'function'){
          await Promise.resolve(window.phfRenderPostLoginHome());
          return true;
        }
        if(typeof window.phfGoHome === 'function'){
          await Promise.resolve(window.phfGoHome());
          return true;
        }
      }
    }catch(e){
      console.warn('[PHF Auth] restore/render:', reason || '', e && e.message || e);
    }
    return false;
  }
  window.phfRenderAuthenticatedDefault = renderAuthenticatedDefault;

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
          '<p class="phf-login-note">Quên mật khẩu hoặc chưa có tài khoản? Liên hệ Admin để được hỗ trợ.</p>' +
        '</section>' +
      '</section>';

    document.body.appendChild(root);
    var email = root.querySelector('#phfTestEmail');
    var pass = root.querySelector('#phfTestPass');
    var error = root.querySelector('#phfTestLoginError');
    var submitButton = root.querySelector('#phfTestSubmit');

    async function submit(){
      error.textContent = '';
      submitButton.disabled = true;
      submitButton.textContent = 'Đang xác minh...';
      try{
        await request('/api/auth/login',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            email:String(email.value || '').trim().toLowerCase(),
            password:String(pass.value || '')
          })
        });

        var verified = await readServerSession();
        if(!verified) throw new Error('Máy chủ chưa ghi nhận phiên đăng nhập.');

        await establishSession(verified, 'server-login');
        removeLogin();
        await renderAuthenticatedDefault(verified, 'server-login');
        try{document.documentElement.classList.remove('phf-auth-boot')}catch(e){}
      }catch(e){
        error.textContent = e && e.message ? e.message : 'Đăng nhập chưa thành công.';
        submitButton.disabled = false;
        submitButton.textContent = 'Đăng nhập';
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
    setTimeout(function(){ email.focus(); },30);
  }

  async function logout(){
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
    var user = null;
    try{ user = await readServerSession(); }catch(e){}
    if(user){
      await establishSession(user,'session-recovered');
      return true;
    }
    applySessionMirror(null);
    authPhase = 'anonymous';
    resetAppReady();
    settleAppReady(null);
    showLogin();
    return false;
  }

  window.phfGoLogin = showLogin;
  window.phfShowRoleChooser = showLogin;
  window.phfLogoutSession = logout;
  window.phfLogoutTestUser = logout;
  window.phfServerAuthSyncAccounts = syncAccounts;
  window.phfHandleAuthExpired = handleExpiredSession;

  async function bootAuth(){
    try{
      var user = await readServerSession();
      await establishSession(user,'server-session-restored');
      if(user){
        await renderAuthenticatedDefault(user,'server-session-restored');
      }else{
        showPublicIntro('anonymous-boot');
        setTimeout(showLogin,80);
      }
    }catch(e){
      await establishSession(null,'server-session-error');
      showPublicIntro('session-error');
      setTimeout(showLogin,80);
    }finally{
      try{
        document.documentElement.classList.remove('phf-f5-restoring');
        document.documentElement.classList.remove('phf-auth-boot');
      }catch(e){}
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded',bootAuth);
  }else{
    bootAuth();
  }
})();
