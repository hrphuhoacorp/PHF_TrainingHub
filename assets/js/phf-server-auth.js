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
  var loginOpening = false;
  var authTransitioning = false;
  var authTransitionResolve = null;
  var authTransitionPromise = Promise.resolve();
  /* Mỗi thay đổi xác thực tăng một phiên bản. Kết quả kiểm tra phiên cũ
     không được phép ghi đè phiên đăng nhập vừa hoàn tất. */
  var authEpoch = 0;

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
  window.phfWhenTrainingDataReady = function(){
    if(!sessionUser) return Promise.resolve(false);
    if(!trainingDataPromise){
      trainingDataPromise = Promise.resolve(preloadProtectedData('route-data-needed'))
        .catch(function(){ return false; });
    }
    return trainingDataPromise;
  };
  window.phfIsAuthReady = function(){ return authPhase !== 'checking'; };
  window.phfGetAuthenticatedUser = function(){ return sessionUser; };
  window.phfGetSessionRole = function(){ return sessionUser ? String(sessionUser.role || '') : ''; };
  window.phfHasAuthenticatedSession = function(){ return !!sessionUser; };
  window.phfUserRole = function(){ return sessionUser ? String(sessionUser.role || 'learner') : 'learner'; };

  function beginAuthTransition(){
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
        }catch(e){error.textContent=e&&e.message?e.message:'Chưa thể đổi mật khẩu.';save.disabled=false;save.textContent='Đổi mật khẩu và tiếp tục'}
      };
      root.querySelector('#phfRequiredLogout').onclick=function(){finish();reject(new Error('PASSWORD_CHANGE_CANCELLED'));};
      setTimeout(function(){(currentPassword?nw:current).focus()},30);
    });
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
          '<div style="display:flex;align-items:center;gap:10px;color:#8a9b94;font-size:12px;margin:1px 0"><span style="height:1px;background:#e3ece8;flex:1"></span><span>Hoặc</span><span style="height:1px;background:#e3ece8;flex:1"></span></div>' +
          '<div id="phfGoogleLoginWrap" style="display:grid;gap:7px;justify-items:stretch"><div id="phfGoogleButton" style="min-height:44px;display:flex;align-items:center;justify-content:center"></div><div id="phfGoogleLoginStatus" style="min-height:18px;color:#687c73;font-size:12.5px;text-align:center">Đang chuẩn bị đăng nhập Google...</div></div>' +
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
      if(authTransitioning) return;
      var credential=response&&response.credential?String(response.credential):'';
      if(!credential){
        error.textContent='Google chưa trả về thông tin xác minh. Vui lòng thử lại.';
        return;
      }
      error.textContent='';
      if(googleStatus) googleStatus.textContent='Đang xác minh Gmail với PHF...';
      beginAuthTransition();
      try{
        var loginResult=await request('/api/auth/google/login',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({credential:credential})
        });
        var verified=loginResult&&loginResult.user?loginResult.user:null;
        if(!verified) throw new Error('Chưa thể xác nhận tài khoản PHF từ Gmail này.');
        await completeLogin(verified,'google-login','');
      }catch(e){
        error.textContent=e&&e.message?e.message:'Đăng nhập Google chưa thành công.';
        if(googleStatus) googleStatus.textContent='Google chỉ dùng để xác minh Gmail đã được Admin cấp trong PHF.';
      }finally{
        endAuthTransition();
      }
    }

    async function initializeGoogleLogin(){
      if(!googleButton || !googleStatus) return;
      try{
        var config=await request('/api/auth/google/config?_='+Date.now());
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
              google.accounts.id.renderButton(googleButton,{
                type:'standard',
                theme:'outline',
                size:'large',
                text:'continue_with',
                shape:'rectangular',
                logo_alignment:'left',
                width:320
              });
              googleStatus.textContent='Dùng Gmail đã được Admin cấp trong PHF Training Hub.';
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

  window.phfShowServerLogin = showLogin;
  window.phfGoLogin = showLogin;
  window.phfShowRoleChooser = showLogin;
  window.phfLogoutSession = logout;
  window.phfLogoutTestUser = logout;
  window.phfServerAuthSyncAccounts = syncAccounts;
  window.phfHandleAuthExpired = handleExpiredSession;


  function isProtectedPath(){
    var path=String(location.pathname||'/').replace(/\/+$/,'')||'/';
    return /^\/(admin|overview|training-content|employees|my-lessons|my-profile|programs|lessons|notifications)(\/|$)/.test(path);
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
    var path=String(location.pathname||'/').replace(/\/+$/,'')||'/';
    var role=String(user&&user.role||'').toLowerCase();
    /* Route Admin tài khoản không phụ thuộc dữ liệu đào tạo. Dựng trực tiếp
       để F5 không bị mắc kẹt bởi router hoặc Promise khôi phục cũ. */
    if(role==='admin'&&path==='/admin/accounts'&&typeof window.phfRenderAccountAdminSafe==='function'){
      window.__phfAuthHandledInitialRoute=true;
      window.phfRenderAccountAdminSafe();
      return true;
    }
    if(role==='admin'&&path==='/admin'&&typeof window.phfRenderAdminManagement==='function'){
      window.__phfAuthHandledInitialRoute=true;
      window.phfRenderAdminManagement();
      return true;
    }
    try{
      return await withTimeout(renderAuthenticatedDefault(user,'server-session-restored'),7000,'ROUTE_RESTORE_TIMEOUT');
    }catch(e){
      console.warn('[PHF Auth] route restore timeout/fail:',e&&e.message||e);
      return false;
    }
  }

  async function bootAuth(){
    var bootEpoch = authEpoch;
    try{
      var user = await withTimeout(readServerSession(),8000,'SESSION_TIMEOUT');
      if(bootEpoch !== authEpoch || authTransitioning) return;
      await establishSession(user,'server-session-restored');
      if(bootEpoch !== authEpoch || authTransitioning) return;

      /* Phiên đã rõ thì phải mở giao diện ngay. Không giữ toàn trang chờ route. */
      clearBootCloak();

      if(user){
        if(user.mustChangePassword && String(user.authProvider || 'password') !== 'google'){
          try{
            user=await requireFirstPasswordChange(user,'');
            await establishSession(user,'first-password-changed-restored');
            clearBootCloak();
          }catch(changeError){
            await logout();
            return;
          }
        }
        var rendered=await renderInitialRouteSafely(user);
        if(!rendered){
          var role=String(user.role||'').toLowerCase();
          if(role==='admin'&&typeof window.phfRenderPostLoginHome==='function') window.phfRenderPostLoginHome();
          else if(role==='learner'&&typeof window.phfGoLearning==='function') window.phfGoLearning();
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

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded',bootAuth);
  }else{
    bootAuth();
  }
})();
