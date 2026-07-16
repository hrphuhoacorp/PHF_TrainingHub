
/* PHF Training Hub - Bản 17F: quản trị tài khoản + login nội bộ ổn định */
(function(){
  var KEY='phfAdminAccountsV17F';
  var OLD=['phfAdminAccountsV17C','phfAdminAccountsV17D','phfAdminAccountsV17B','phfAdminAccountsV1'];
  var LOG='phfAdminAccountLogsV17F';

  function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
  function read(k,f){try{var r=localStorage.getItem(k);return r?(JSON.parse(r)||f):f}catch(e){return f}}
  function write(k,v){try{localStorage.setItem(k,JSON.stringify(v||[]))}catch(e){}}
  function cleanEmail(v){return String(v||'').trim().toLowerCase()}
  function cleanPhone(v){return String(v||'').replace(/[^\d+]/g,'').trim()}
  function now(){try{return new Date().toLocaleString('vi-VN',{hour12:false})}catch(e){return new Date().toISOString()}}
  function roleLabel(r){return r==='admin'?'Admin':(r==='manager'?'Trưởng ca/Quản lý':'Học viên')}
  function statusLabel(s){return s==='locked'?'Đang khóa':'Đang hoạt động'}
  function isAdmin(){try{var r=String(localStorage.getItem('phfInternalTestRole')||'').toLowerCase();return r==='admin'}catch(e){return false}}
  function migrate(){
    var cur=read(KEY,null); if(Array.isArray(cur)&&cur.length) return cur;
    for(var i=0;i<OLD.length;i++){
      var old=read(OLD[i],null);
      if(Array.isArray(old)&&old.length){
        old=old.map(function(a){a.password=a.password||a.tempPassword||'123456';a.status=a.status||'active';a.role=a.role||'learner';return a});
        write(KEY,old); return old;
      }
    }
    return null;
  }
  function accounts(){
    var a=migrate();
    if(Array.isArray(a)&&a.length) return a;
    a=[
      {id:'acct-learner-test',name:'Học viên Test',email:'nv.test@phf.local',phone:'0900000001',role:'learner',status:'active',password:'123456',note:'Tài khoản học viên test.',createdAt:now(),lastLogin:''},
      {id:'acct-manager-test',name:'Trưởng ca Test',email:'truongca.test@phf.local',phone:'0900000002',role:'manager',status:'active',password:'123456',note:'Tài khoản Trưởng ca test.',createdAt:now(),lastLogin:''},
      {id:'acct-admin-test',name:'Admin Test',email:'admin.test@phf.local',phone:'0900000003',role:'admin',status:'active',password:'123456',note:'Tài khoản Admin test.',createdAt:now(),lastLogin:''}
    ]; write(KEY,a); return a;
  }
  function saveAccounts(a){write(KEY,a)}
  function addLog(t){var l=read(LOG,[]);l.unshift({at:now(),text:String(t||'')});write(LOG,l.slice(0,50))}
  function findAccount(email){email=cleanEmail(email);return accounts().find(function(a){return cleanEmail(a.email)===email})||null}

  function setRole(role){
    role=role||'learner';
    try{localStorage.setItem('phfInternalTestRole',role);localStorage.setItem('phfTestRole',role);localStorage.setItem('phfRole',role);localStorage.setItem('phfUserRole',role)}catch(e){}
    document.body.classList.toggle('phf-role-admin',role==='admin');
    document.body.classList.toggle('phf-role-manager',role==='manager');
    document.body.classList.toggle('phf-role-learner',role==='learner');
  }
  function setProfileFromAccount(a){
    var p=cleanPhone(a.phone||'');
    var prof={id:p?('test-phone-'+p):('acct-'+a.id),fullName:a.name||a.email,phone:p,branch:'Phú Lợi',department:'Bán hàng',position:a.role==='admin'?'Quản trị hệ thống':(a.role==='manager'?'Trưởng ca / CHT / Quản lý':'Nhân viên bán hàng mới'),studyStartDate:localStorage.getItem('phfStudyStartDate')||new Date().toISOString().slice(0,10),programId:'new_sales'};
    try{localStorage.setItem('phfEmployeeProfile',JSON.stringify(prof));localStorage.setItem('phfEmployeeId',prof.id);localStorage.setItem('phfLoginEmail',a.email);localStorage.setItem('phfLoginName',a.name||'');localStorage.setItem('phfLoginPhone',p);localStorage.setItem('phfCurrentLearnerPhone',p);localStorage.setItem('phfLinkedPhone',p);window.currentProfile=Object.assign({},window.currentProfile||{},prof,{role:a.role,internalRole:a.role,email:a.email})}catch(e){}
    return prof;
  }
  function removeOverlays(){
    ['phfRoleOverlay','phfPhoneEntryOverlay','phfTestLoginOverlay'].forEach(function(id){var el=document.getElementById(id);if(el)el.remove()});
  }
  function afterLogin(a){
    setRole(a.role||'learner');
    setProfileFromAccount(a);
    a.lastLogin=now();
    var list=accounts(), idx=list.findIndex(function(x){return x.id===a.id}); if(idx>=0){list[idx]=a;saveAccounts(list)}
    removeOverlays();
    try{ if(typeof window.phfCloseLegacyLearnerLogin==='function') window.phfCloseLegacyLearnerLogin(); }catch(e){}
    if(a.role==='learner'){
      var phone=cleanPhone(a.phone||'');
      if(phone){
        (async function(){
          try{ if(typeof window.phfRefreshTrainingData==='function') await window.phfRefreshTrainingData(); }catch(e){}
          try{
            var found=typeof window.phfFindLearnerByPhone==='function'?window.phfFindLearnerByPhone(phone):null;
            var profile=found&&typeof window.phfSetLearnerProfileFromRow==='function'?window.phfSetLearnerProfileFromRow(found):setProfileFromAccount(a);
            if(typeof window.phfOpenLearnerAfterPhone==='function') return window.phfOpenLearnerAfterPhone(profile);
          }catch(e){}
          try{ if(typeof window.phfRenderPostLoginHome==='function') return window.phfRenderPostLoginHome(); }catch(e){}
          try{ if(typeof window.phfGoLearning==='function') return window.phfGoLearning(); }catch(e){}
        })();
      }else{
        if(typeof window.phfShowLearnerPhoneEntry==='function') window.phfShowLearnerPhoneEntry();
        else if(typeof window.phfGoLearning==='function') window.phfGoLearning();
      }
    }else{
      try{ if(typeof window.phfShowRoleSwitcher==='function') window.phfShowRoleSwitcher(); }catch(e){}
      try{ if(typeof window.phfRenderPostLoginHome==='function') return window.phfRenderPostLoginHome(); }catch(e){}
      try{ if(typeof window.phfRenderTrainingOverview==='function') return window.phfRenderTrainingOverview(); }catch(e){}
    }
  }
  function showLogin(force){
    removeOverlays();
    var overlay=document.createElement('div');
    overlay.id='phfRoleOverlay';
    overlay.className='phf-role-overlay';
    document.body.appendChild(overlay);
    var quick=accounts().slice(0,8).map(function(a){
      return '<button type="button" data-email="'+esc(a.email)+'"><b>'+esc(a.name||a.email)+'</b><small>'+esc(a.email)+' · '+esc(roleLabel(a.role))+' · MK: '+esc(a.password||'123456')+'</small></button>';
    }).join('');
    overlay.innerHTML='<section class="phf-role-dialog" role="dialog" aria-modal="true" aria-label="Đăng nhập PHF Training Hub">'
      +'<div class="phf-role-dialog-head"><div class="phf-role-dialog-brand"><img src="assets/logo/phf-logo.png" alt="Phuhoa Fresh" onerror="this.style.display=&quot;none&quot;"><div><h2>PHF Training Hub</h2><p>Đăng nhập bằng tài khoản được Admin cấp.</p></div></div><span class="phf-role-tag">Truy cập nội bộ</span></div>'
      +'<div class="phf-role-dialog-body"><div class="phf-acct17-field"><label>Email đăng nhập</label><input id="phfAcctLoginEmail" type="email" autocomplete="username" placeholder="Nhập email"></div><div class="phf-acct17-field"><label>Mật khẩu</label><input id="phfAcctLoginPass" type="password" autocomplete="current-password" placeholder="Nhập mật khẩu tạm"></div><div id="phfAcctLoginErr" class="phf-test-login-error"></div><div class="phf-phone-entry-actions"><button type="button" class="primary" id="phfAcctLoginSubmit">Đăng nhập</button><button type="button" id="phfAcctLoginClose">Đóng</button></div><details open><summary>Tài khoản có thể dùng</summary><div class="phf-login-account-list">'+quick+'</div></details><div class="phf-role-warning">Tài khoản tạo trong Quản trị sẽ đăng nhập được tại đây. Khi chạy chính thức rộng, phần này sẽ nâng lên Supabase Auth.</div></div></section>';
    var email=document.getElementById('phfAcctLoginEmail'), pass=document.getElementById('phfAcctLoginPass'), err=document.getElementById('phfAcctLoginErr');
    function submit(){
      var a=findAccount(email&&email.value);
      if(!a){err.textContent='Không tìm thấy tài khoản này.';return}
      if(a.status==='locked'){err.textContent='Tài khoản này đang bị khóa.';return}
      if(String(a.password||'123456')!==String(pass&&pass.value||'')){err.textContent='Mật khẩu chưa đúng.';return}
      err.textContent=''; afterLogin(a);
    }
    document.getElementById('phfAcctLoginSubmit').onclick=submit;
    document.getElementById('phfAcctLoginClose').onclick=function(){overlay.remove()};
    overlay.querySelectorAll('[data-email]').forEach(function(btn){btn.onclick=function(){email.value=btn.dataset.email||'';var a=findAccount(email.value);pass.value=(a&&a.password)||'123456';err.textContent='';pass.focus()}});
    [email,pass].forEach(function(inp){if(inp)inp.addEventListener('keydown',function(ev){if(ev.key==='Enter'){ev.preventDefault();submit()}})});
    setTimeout(function(){try{email.focus()}catch(e){}},60);
  }

  // Override only login entrypoints; do not override render/navigation.
  window.phfShowRoleChooser=showLogin;
  window.phfBootInternalRoleTest=function(){showLogin(true)};
  window.phfGoLogin=function(){showLogin(true)};

  function main(){return document.getElementById('mainLesson')||document.querySelector('main')||document.body}
  function rows(){
    var q=(document.getElementById('phfAcct17Search')||{}).value||''; q=q.toLowerCase().trim();
    var list=accounts().filter(function(a){return !q||[a.name,a.email,a.phone,roleLabel(a.role),statusLabel(a.status),a.note].join(' ').toLowerCase().indexOf(q)>=0});
    if(!list.length)return'<tr><td colspan="6"><div class="phf-acct17-empty">Chưa có tài khoản phù hợp.</div></td></tr>';
    return list.map(function(a){return'<tr><td><div class="phf-acct17-user"><b>'+esc(a.name||'Chưa đặt tên')+'</b><small>'+esc(a.email||'')+'</small></div></td><td>'+esc(a.phone||'—')+'</td><td><span class="phf-acct17-pill">'+esc(roleLabel(a.role))+'</span></td><td><span class="phf-acct17-pill '+(a.status==='locked'?'warn':'')+'">'+esc(statusLabel(a.status))+'</span></td><td><span class="phf-acct17-pill muted">'+esc(a.lastLogin||'Chưa ghi nhận')+'</span></td><td><div class="phf-acct17-actions"><button class="phf-acct17-btn" type="button" onclick="phfAcct17Fill(\''+esc(a.id)+'\')">Sửa</button><button class="phf-acct17-btn subtle" type="button" onclick="phfAcct17ResetPassword(\''+esc(a.id)+'\')">Reset</button><button class="phf-acct17-btn danger" type="button" onclick="phfAcct17ToggleLock(\''+esc(a.id)+'\')">'+(a.status==='locked'?'Mở':'Khóa')+'</button></div></td></tr>'}).join('');
  }
  function logs(){var l=read(LOG,[]);if(!l.length)return'<div class="phf-acct17-logitem">Chưa có thao tác quản trị tài khoản.</div>';return l.slice(0,8).map(function(x){return'<div class="phf-acct17-logitem"><b>'+esc(x.at)+'</b><br>'+esc(x.text)+'</div>'}).join('')}
  function refresh(){var r=document.getElementById('phfAcct17Rows');if(r)r.innerHTML=rows();var l=document.getElementById('phfAcct17Logs');if(l)l.innerHTML=logs()}
  window.phfAcct17Refresh=refresh;
  window.phfRenderAccountAdmin=function(tab){
    if(!isAdmin()){alert('Khu vực Quản trị tài khoản chỉ dành cho Admin.');return}
    try{if(typeof window.phfHideIntroAndStopAuto==='function')window.phfHideIntroAndStopAuto();}catch(e){}
    var active=tab||'list';
    var form='<form class="phf-acct17-form" onsubmit="phfAcct17Save(event)"><input type="hidden" id="phfAcct17Id"><div class="phf-acct17-field"><label>Họ tên</label><input id="phfAcct17Name" required></div><div class="phf-acct17-field"><label>Email đăng nhập</label><input id="phfAcct17Email" type="email" required></div><div class="phf-acct17-two"><div class="phf-acct17-field"><label>SĐT liên kết hồ sơ</label><input id="phfAcct17Phone"></div><div class="phf-acct17-field"><label>Vai trò</label><select id="phfAcct17Role"><option value="learner">Học viên</option><option value="manager">Trưởng ca/Quản lý</option><option value="admin">Admin</option></select></div></div><div class="phf-acct17-two"><div class="phf-acct17-field"><label>Trạng thái</label><select id="phfAcct17Status"><option value="active">Đang hoạt động</option><option value="locked">Đang khóa</option></select></div><div class="phf-acct17-field"><label>Mật khẩu tạm</label><input id="phfAcct17Pass" placeholder="Ví dụ: 123456"></div></div><div class="phf-acct17-field"><label>Ghi chú nội bộ</label><textarea id="phfAcct17Note"></textarea></div><div class="phf-acct17-actions"><button class="phf-acct17-btn primary" type="submit">Lưu tài khoản</button><button class="phf-acct17-btn" type="button" onclick="phfAcct17ClearForm()">Tạo mới</button><button class="phf-acct17-btn" type="button" onclick="phfRenderAdminManagement()">Về Quản trị</button></div></form>';
    main().innerHTML='<section class="phf-acct17"><div class="phf-acct17-hero"><div><span class="phf-acct17-kicker">PHF Training Hub · Admin</span><h2>Quản trị tài khoản & phân quyền</h2><p>Tạo tài khoản đăng nhập nội bộ, phân vai trò và liên kết SĐT học viên. Bản này dùng để chạy thử nghiệp vụ trước khi nâng lên Supabase Auth.</p></div><div class="phf-acct17-role">Admin<small>Quyền cấu hình tài khoản</small></div></div><div class="phf-acct17-tabs"><button class="phf-acct17-tab active" type="button">Tài khoản đăng nhập</button></div><div class="phf-acct17-grid"><div class="phf-acct17-panel"><div class="phf-acct17-toolbar"><div><h3>Danh sách tài khoản</h3><p>Danh sách tài khoản nội bộ có thể đăng nhập ở màn đăng nhập.</p></div><input id="phfAcct17Search" class="phf-acct17-search" placeholder="Tìm tài khoản..." oninput="phfAcct17Refresh()"></div><div class="phf-acct17-tablebox"><table class="phf-acct17-table"><thead><tr><th>Tài khoản</th><th>SĐT</th><th>Vai trò</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th>Thao tác</th></tr></thead><tbody id="phfAcct17Rows"></tbody></table></div><div class="phf-acct17-note"><b>Lưu ý:</b> tài khoản tạo ở đây đăng nhập được trong cơ chế nội bộ/test.</div></div><aside class="phf-acct17-panel"><h3>Tạo / sửa tài khoản</h3>'+form+'<h3>Lịch sử thao tác</h3><div id="phfAcct17Logs" class="phf-acct17-log"></div></aside></div></section>';
    refresh();
  };
  window.phfAcct17ClearForm=function(){['phfAcct17Id','phfAcct17Name','phfAcct17Email','phfAcct17Phone','phfAcct17Pass','phfAcct17Note'].forEach(function(id){var e=document.getElementById(id);if(e)e.value=''});var r=document.getElementById('phfAcct17Role');if(r)r.value='learner';var s=document.getElementById('phfAcct17Status');if(s)s.value='active'};
  window.phfAcct17Fill=function(id){var a=accounts().find(function(x){return x.id===id});if(!a)return;function set(id,v){var e=document.getElementById(id);if(e)e.value=v||''}set('phfAcct17Id',a.id);set('phfAcct17Name',a.name);set('phfAcct17Email',a.email);set('phfAcct17Phone',a.phone);set('phfAcct17Role',a.role);set('phfAcct17Status',a.status);set('phfAcct17Pass',a.password||'123456');set('phfAcct17Note',a.note)};
  window.phfAcct17Save=function(ev){if(ev&&ev.preventDefault)ev.preventDefault();var a={id:(document.getElementById('phfAcct17Id').value)||('acct-'+Date.now()),name:document.getElementById('phfAcct17Name').value||'',email:cleanEmail(document.getElementById('phfAcct17Email').value||''),phone:cleanPhone(document.getElementById('phfAcct17Phone').value||''),role:document.getElementById('phfAcct17Role').value||'learner',status:document.getElementById('phfAcct17Status').value||'active',password:document.getElementById('phfAcct17Pass').value||'123456',note:document.getElementById('phfAcct17Note').value||'',createdAt:now(),lastLogin:''};if(!a.name||!a.email){alert('Vui lòng nhập họ tên và email.');return}var list=accounts();if(list.some(function(x){return x.id!==a.id&&cleanEmail(x.email)===a.email})){alert('Email này đã tồn tại.');return}var i=list.findIndex(function(x){return x.id===a.id});if(i>=0){a.createdAt=list[i].createdAt||a.createdAt;a.lastLogin=list[i].lastLogin||'';list[i]=a;addLog('Cập nhật tài khoản '+a.email)}else{list.unshift(a);addLog('Tạo tài khoản '+a.email)}saveAccounts(list);refresh();alert('Đã lưu tài khoản. Có thể đăng nhập bằng email/mật khẩu tạm này.')};
  window.phfAcct17ToggleLock=function(id){var list=accounts();var a=list.find(function(x){return x.id===id});if(!a)return;a.status=a.status==='locked'?'active':'locked';saveAccounts(list);addLog((a.status==='locked'?'Khóa ':'Mở khóa ')+a.email);refresh()};
  window.phfAcct17ResetPassword=function(id){var list=accounts();var a=list.find(function(x){return x.id===id});if(!a)return;var p='PHF@'+Math.floor(100000+Math.random()*900000);a.password=p;saveAccounts(list);addLog('Reset mật khẩu '+a.email);refresh();alert('Mật khẩu tạm mới: '+p)};
  document.addEventListener('DOMContentLoaded',function(){accounts()});
})();
