
/* PHF Training Hub - Bản 18: Quản trị tài khoản an toàn, không can thiệp login */
(function(){
  var KEY='phfAdminAccountsSafeV18';
  var LOG='phfAdminAccountsSafeLogsV18';

  function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
  function read(k,f){try{var r=localStorage.getItem(k);return r?(JSON.parse(r)||f):f}catch(e){return f}}
  function write(k,v){try{localStorage.setItem(k,JSON.stringify(v||[]))}catch(e){}}
  function cleanEmail(v){return String(v||'').trim().toLowerCase()}
  function cleanPhone(v){return String(v||'').replace(/[^\d+]/g,'').trim()}
  function now(){try{return new Date().toLocaleString('vi-VN',{hour12:false})}catch(e){return new Date().toISOString()}}
  function roleLabel(r){return r==='admin'?'Admin':(r==='manager'?'Trưởng ca/Quản lý':'Học viên')}
  function statusLabel(s){return s==='locked'?'Đang khóa':'Đang hoạt động'}
  function isAdmin(){try{var r=String(localStorage.getItem('phfInternalRole')||localStorage.getItem('phfRole')||localStorage.getItem('phfRole')||'').toLowerCase();return r==='admin'||r.indexOf('admin')>=0||r.indexOf('quản trị')>=0||r.indexOf('quan tri')>=0}catch(e){return false}}
  function accounts(){
    var l=read(KEY,null);
    if(Array.isArray(l)&&l.length) return l;
    // migrate only for display from previous local admin lists, but never use for login.
    var oldKeys=['phfAdminAccountsV17F','phfAdminAccountsV17C','phfAdminAccountsV17D','phfAdminAccountsV17B','phfAdminAccountsV1'];
    for(var i=0;i<oldKeys.length;i++){
      var old=read(oldKeys[i],null);
      if(Array.isArray(old)&&old.length){
        old=old.map(function(a){a.status=a.status||'active';a.role=a.role||'learner';return a});
        write(KEY,old); return old;
      }
    }
    l=[
      {id:'acct-learner-',name:'Học viên ',email:'nv.@phf.local',phone:'0900000001',role:'learner',status:'active',note:'Tài khoản học viên.',createdAt:now(),lastLogin:''},
      {id:'acct-manager-',name:'Trưởng ca ',email:'truongca.@phf.local',phone:'0900000002',role:'manager',status:'active',note:'Tài khoản Trưởng ca .',createdAt:now(),lastLogin:''},
      {id:'acct-admin-',name:'Admin ',email:'admin.@phf.local',phone:'0900000003',role:'admin',status:'active',note:'Tài khoản Admin .',createdAt:now(),lastLogin:''}
    ];
    write(KEY,l); return l;
  }
  function saveAccounts(l){write(KEY,l)}
  function addLog(t){var l=read(LOG,[]);l.unshift({at:now(),text:String(t||'')});write(LOG,l.slice(0,50))}
  function setShell(){
    try{if(typeof window.phfHideIntroAndStopAuto==='function')window.phfHideIntroAndStopAuto()}catch(e){}
    try{if(typeof window.phfEnsureSharedShell==='function')window.phfEnsureSharedShell('admin')}catch(e){}
    try{if(typeof window.phfSetMainNavActive==='function')window.phfSetMainNavActive('admin')}catch(e){}
    var m=document.getElementById('miniStatus');if(m)m.textContent='Quản trị tài khoản';
    var t=document.getElementById('contextTitle');if(t)t.textContent='Quản trị tài khoản';
    var s=document.getElementById('contextSub');if(s)s.textContent='Quản lý tài khoản, vai trò và liên kết hồ sơ học viên.';
    var a=document.getElementById('contextAction');if(a)a.textContent='Admin';
  }
  function main(){return document.getElementById('mainLesson')||document.querySelector('main')||document.body}
  function roleChip(r){var cls=r==='admin'?'blue':(r==='manager'?'pink':'');return '<span class="phf-chip '+cls+'">'+esc(roleLabel(r))+'</span>'}
  function statusChip(s){return '<span class="phf-chip '+(s==='locked'?'warn':'')+'">'+esc(statusLabel(s))+'</span>'}
  function rows(){
    var q=(document.getElementById('phfAcctSafeSearch')||{}).value||''; q=q.toLowerCase().trim();
    var list=accounts().filter(function(a){return !q||[a.name,a.email,a.phone,roleLabel(a.role),statusLabel(a.status),a.note].join(' ').toLowerCase().indexOf(q)>=0});
    if(!list.length)return'<tr><td colspan="6"><div class="phf-acct-safe-note">Chưa có tài khoản phù hợp.</div></td></tr>';
    return list.map(function(a){return'<tr><td><div class="phf-acct-safe-user"><b>'+esc(a.name||'Chưa đặt tên')+'</b><small>'+esc(a.email||'')+'</small></div></td><td>'+esc(a.phone||'—')+'</td><td>'+roleChip(a.role)+'</td><td>'+statusChip(a.status)+'</td><td><span class="phf-chip muted">Đã liên kết</span></td><td><div class="phf-acct-safe-actions"><button class="phf-acct-safe-btn" type="button" onclick="phfAcctSafeFill(\''+esc(a.id)+'\')">Sửa</button><button class="phf-acct-safe-btn subtle" type="button" onclick="phfAcctSafeResetNote(\''+esc(a.id)+'\')">Reset</button><button class="phf-acct-safe-btn danger" type="button" onclick="phfAcctSafeToggleLock(\''+esc(a.id)+'\')">'+(a.status==='locked'?'Mở':'Khóa')+'</button></div></td></tr>'}).join('');
  }
  function logs(){var l=read(LOG,[]);if(!l.length)return'<div class="phf-acct-safe-logitem">Chưa có thao tác quản trị tài khoản.</div>';return l.slice(0,8).map(function(x){return'<div class="phf-acct-safe-logitem"><b>'+esc(x.at)+'</b><br>'+esc(x.text)+'</div>'}).join('')}
  function refresh(){var r=document.getElementById('phfAcctSafeRows');if(r)r.innerHTML=rows();var l=document.getElementById('phfAcctSafeLogs');if(l)l.innerHTML=logs()}
  window.phfAcctSafeRefresh=refresh;

  window.phfRenderAccountAdminSafe=function(){
    if(!isAdmin()){alert('Khu vực Quản trị tài khoản chỉ dành cho Admin.');return}
    setShell();
    var form='<form class="phf-acct-safe-form" onsubmit="phfAcctSafeSave(event)"><input type="hidden" id="phfAcctSafeId"><div class="phf-acct-safe-field"><label>Họ tên</label><input id="phfAcctSafeName" required placeholder="Ví dụ: Nguyễn Văn A"></div><div class="phf-acct-safe-field"><label>Email đăng nhập</label><input id="phfAcctSafeEmail" type="email" required placeholder="ten@phf.local"></div><div class="phf-acct-safe-two"><div class="phf-acct-safe-field"><label>SĐT liên kết hồ sơ</label><input id="phfAcctSafePhone" placeholder="SĐT liên kết hồ sơ"></div><div class="phf-acct-safe-field"><label>Vai trò</label><select id="phfAcctSafeRole"><option value="learner">Học viên</option><option value="manager">Trưởng ca/Quản lý</option><option value="admin">Admin</option></select></div></div><div class="phf-acct-safe-two"><div class="phf-acct-safe-field"><label>Trạng thái</label><select id="phfAcctSafeStatus"><option value="active">Đang hoạt động</option><option value="locked">Đang khóa</option></select></div><div class="phf-acct-safe-field"><label>Mật khẩu tạm</label><input id="phfAcctSafePass" placeholder="Mật khẩu tạm"></div></div><div class="phf-acct-safe-field"><label>Ghi chú nội bộ</label><textarea id="phfAcctSafeNote" placeholder="Ví dụ: học viên bán hàng mới CN Phú Lợi"></textarea></div><div class="phf-acct-safe-actions"><button class="phf-acct-safe-btn primary" type="submit">Lưu tài khoản</button><button class="phf-acct-safe-btn" type="button" onclick="phfAcctSafeClearForm()">Tạo mới</button><button class="phf-acct-safe-btn" type="button" onclick="phfRenderAdminManagement()">Về Quản trị</button></div></form>';
    main().innerHTML='<section class="phf-acct-safe"><div class="phf-acct-safe-hero"><div><span class="phf-acct-safe-kicker">PHF Training Hub · Admin</span><h2>Quản trị tài khoản & phân quyền</h2><p>Khu vực quản lý tài khoản, vai trò và liên kết hồ sơ học viên.</p></div><div class="phf-acct-safe-note-top">Quản trị tài khoản<small>Admin</small></div></div><div class="phf-acct-safe-grid"><div class="phf-acct-safe-panel"><div class="phf-acct-safe-toolbar"><div><h3>Danh sách tài khoản</h3><p>Danh sách tài khoản dùng cho chương trình đào tạo nội bộ.</p></div><input id="phfAcctSafeSearch" class="phf-acct-safe-search" placeholder="Tìm tài khoản..." oninput="phfAcctSafeRefresh()"></div><div class="phf-acct-safe-tablebox"><table class="phf-acct-safe-table"><thead><tr><th>Tài khoản</th><th>SĐT</th><th>Vai trò</th><th>Trạng thái</th><th>Kết nối</th><th>Thao tác</th></tr></thead><tbody id="phfAcctSafeRows"></tbody></table></div><div class="phf-acct-safe-note"><b>Ghi chú:</b> Tài khoản học viên cần có SĐT liên kết để nhận diện đúng hồ sơ và tiến độ học.</div></div><aside class="phf-acct-safe-panel"><h3>Tạo / sửa tài khoản</h3>'+form+'<h3>Lịch sử thao tác</h3><div id="phfAcctSafeLogs" class="phf-acct-safe-log"></div></aside></div></section>';
    refresh();
  };
  window.phfAcctSafeClearForm=function(){['phfAcctSafeId','phfAcctSafeName','phfAcctSafeEmail','phfAcctSafePhone','phfAcctSafePass','phfAcctSafeNote'].forEach(function(id){var e=document.getElementById(id);if(e)e.value=''});var r=document.getElementById('phfAcctSafeRole');if(r)r.value='learner';var s=document.getElementById('phfAcctSafeStatus');if(s)s.value='active'};
  window.phfAcctSafeFill=function(id){var a=accounts().find(function(x){return x.id===id});if(!a)return;function set(id,v){var e=document.getElementById(id);if(e)e.value=v||''}set('phfAcctSafeId',a.id);set('phfAcctSafeName',a.name);set('phfAcctSafeEmail',a.email);set('phfAcctSafePhone',a.phone);set('phfAcctSafeRole',a.role);set('phfAcctSafeStatus',a.status);set('phfAcctSafePass',a.tempPassword||'');set('phfAcctSafeNote',a.note)};
  window.phfAcctSafeSave=function(ev){if(ev&&ev.preventDefault)ev.preventDefault();var a={id:(document.getElementById('phfAcctSafeId').value)||('acct-'+Date.now()),name:document.getElementById('phfAcctSafeName').value||'',email:cleanEmail(document.getElementById('phfAcctSafeEmail').value||''),phone:cleanPhone(document.getElementById('phfAcctSafePhone').value||''),role:document.getElementById('phfAcctSafeRole').value||'learner',status:document.getElementById('phfAcctSafeStatus').value||'active',tempPassword:document.getElementById('phfAcctSafePass').value||'',note:document.getElementById('phfAcctSafeNote').value||'',createdAt:now(),lastLogin:''};if(!a.name||!a.email){alert('Vui lòng nhập họ tên và email.');return} if(a.role==='learner' && !a.phone){alert('Tài khoản Học viên cần có SĐT liên kết hồ sơ.');return}var list=accounts();if(list.some(function(x){return x.id!==a.id&&cleanEmail(x.email)===a.email})){alert('Email này đã tồn tại.');return}var i=list.findIndex(function(x){return x.id===a.id});if(i>=0){a.createdAt=list[i].createdAt||a.createdAt;list[i]=a;addLog('Cập nhật tài khoản '+a.email)}else{list.unshift(a);addLog('Tạo tài khoản '+a.email)}saveAccounts(list);refresh();alert('Đã lưu tài khoản. Tài khoản đã được lưu. Với học viên, cần gắn SĐT riêng để cổng đào tạo nhận đúng hồ sơ.')};
  window.phfAcctSafeToggleLock=function(id){var list=accounts();var a=list.find(function(x){return x.id===id});if(!a)return;a.status=a.status==='locked'?'active':'locked';saveAccounts(list);addLog((a.status==='locked'?'Khóa ':'Mở khóa ')+a.email);refresh()};
  window.phfAcctSafeResetNote=function(id){var list=accounts();var a=list.find(function(x){return x.id===id});if(!a)return;var p='PHF@'+Math.floor(100000+Math.random()*900000);a.tempPassword=p;saveAccounts(list);addLog('Tạo mật khẩu tạm cho '+a.email+': '+p);refresh();if(window.phfOfficialShowTempPassword){window.phfOfficialShowTempPassword(p, a.email);}else{alert('Mật khẩu tạm: '+p);}};
  document.addEventListener('DOMContentLoaded',function(){accounts()});
})();
