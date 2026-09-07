/* PHF HR — SYSTEM V1 · Nhật ký hệ thống (Audit Log) — FOUNDATION V1.
   Admin-only, READ-ONLY. Answers "Ai đã làm gì trên hệ thống?".
   Data: GET /api/data?audit=1 (Admin-gated) -> phf-hr-api /v1/audit bridge.
   The central stream starts at Foundation V1 go-live — NO historical backfill.
   There is NO edit / delete / write control anywhere in this screen. */
(function(){
'use strict';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function role(){try{return String((window.phfGetSessionRole&&window.phfGetSessionRole())||'').toLowerCase();}catch(e){return '';}}
function main(){return document.getElementById('phfHrRoot')||document.querySelector('main')||document.body;}

var MODULE_LABEL={auth:'Xác thực',account:'Tài khoản',system:'Hệ thống'};
var ACTION_LABEL={
  AUTH_LOGIN_SUCCESS:'Đăng nhập thành công',AUTH_LOGIN_FAILURE:'Đăng nhập thất bại',AUTH_LOGOUT:'Đăng xuất',
  ACCOUNT_CREATE:'Tạo tài khoản',ACCOUNT_UPDATE:'Cập nhật tài khoản',ACCOUNT_ACCESS_LOCK:'Khóa truy cập',
  ACCOUNT_ACCESS_UNLOCK:'Mở lại truy cập',ACCOUNT_ROLE_CHANGE:'Đổi vai trò',ACCOUNT_PASSWORD_RESET:'Đặt lại mật khẩu',
  ACCOUNT_DELETE:'Xóa tài khoản',EMPLOYEE_INACTIVE_AUTO_LOCK:'Tự động khóa (nghỉ việc)'
};
var RESULT_LABEL={success:'Thành công',failure:'Thất bại',blocked:'Bị chặn'};
function actLabel(a){return ACTION_LABEL[a]||a;}
function fmtTime(v){try{var d=new Date(v);if(isNaN(d.getTime()))return String(v||'');return d.toLocaleString('vi-VN',{hour12:false});}catch(e){return String(v||'');}}

var state={rows:[],nextCursor:null,loading:false,filters:{from:'',to:'',module:'',action:'',result:'',user:'',q:''}};

function ensureStyle(){
  if(document.getElementById('phf-audit-style'))return;
  var st=document.createElement('style');st.id='phf-audit-style';
  st.textContent=[
    '.phf-audit{max-width:1320px;margin:0 auto;padding:0 0 40px;display:grid;gap:16px;color:#17382d;font-family:Arial,Helvetica,system-ui,sans-serif}',
    '.phf-audit-hero{background:linear-gradient(135deg,#10241d 0%,#183a2e 55%,#0c1c17 100%);border:1px solid #22463a;border-radius:18px;padding:22px 24px;color:#eaf5ef;box-shadow:0 18px 40px -18px rgba(4,32,22,.55)}',
    '.phf-audit-hero .k{display:inline-flex;padding:5px 10px;border-radius:999px;background:rgba(255,255,255,.1);color:#5fd0a6;font-size:11px;font-weight:700;letter-spacing:.12em}',
    '.phf-audit-hero h2{margin:10px 0 6px;color:rgba(255,255,255,.96)!important;font-size:24px}',
    '.phf-audit-hero p{margin:0;color:rgba(255,255,255,.72);font-size:13.5px;line-height:1.55}',
    '.phf-audit-filters{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;background:#fff;border:1px solid #dfeee7;border-radius:16px;padding:14px}',
    '.phf-audit-filters label{display:grid;gap:5px;font-size:11px;font-weight:700;color:#5f746c;text-transform:uppercase;letter-spacing:.04em}',
    '.phf-audit-filters input,.phf-audit-filters select{min-height:38px;border:1px solid #d6e9e1;border-radius:10px;padding:0 10px;font:inherit;background:#fff;color:#17382d}',
    '.phf-audit-filters .wide{grid-column:span 2}',
    '.phf-audit-filters .acts{grid-column:1/-1;display:flex;gap:8px}',
    '.phf-audit-btn{min-height:38px;padding:0 16px;border-radius:10px;border:1px solid #07543e;background:#07543e;color:#fff;font-weight:700;cursor:pointer}',
    '.phf-audit-btn.ghost{background:#fff;color:#315448;border-color:#d6e9e1}',
    '.phf-audit-tablebox{background:#fff;border:1px solid #dfeee7;border-radius:16px;overflow-x:auto}',
    '.phf-audit-table{width:100%;border-collapse:collapse;min-width:1000px}',
    '.phf-audit-table th{background:#f4f9f7;color:#41564e;font-size:11px;text-transform:uppercase;letter-spacing:.04em;text-align:left;padding:11px 12px;border-bottom:1px solid #e6efeb}',
    '.phf-audit-table td{padding:11px 12px;border-bottom:1px solid #f0f5f3;font-size:13px;vertical-align:top}',
    '.phf-audit-table tbody tr{cursor:pointer}',
    '.phf-audit-table tbody tr:hover{background:#f2f8f5;box-shadow:inset 3px 0 0 #1f7a5a}',
    '.phf-audit-chip{display:inline-flex;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid transparent}',
    '.phf-audit-chip.ok{background:#e7f6ee;border-color:#b6e0cb;color:#0b5a43}',
    '.phf-audit-chip.fail{background:#fdeee0;border-color:#f0cfa8;color:#9a4a12}',
    '.phf-audit-chip.block{background:#fde9e6;border-color:#f0cdc2;color:#9a3412}',
    '.phf-audit-empty{padding:36px;text-align:center;color:#6b7f76}',
    '.phf-audit-note{font-size:12px;color:#7a8d85;padding:2px 2px}',
    '.phf-audit-more{display:flex;justify-content:center;padding:6px}',
    '.phf-audit-modal{position:fixed;inset:0;z-index:99999;background:rgba(6,24,18,.5);display:flex;align-items:center;justify-content:center;padding:18px}',
    '.phf-audit-card{width:min(680px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:18px;border:1px solid #dcebe4;box-shadow:0 30px 80px rgba(0,35,24,.28)}',
    '.phf-audit-card h3{margin:0;padding:18px 20px;border-bottom:1px solid #edf3f0;font-size:17px}',
    '.phf-audit-card dl{margin:0;padding:14px 20px;display:grid;grid-template-columns:150px 1fr;gap:8px 14px}',
    '.phf-audit-card dt{color:#667a71;font-size:12px}.phf-audit-card dd{margin:0;color:#17382d;font-size:13px;word-break:break-word}',
    '.phf-audit-card pre{margin:6px 20px 16px;padding:12px;background:#f7fbf9;border:1px solid #e0eee7;border-radius:12px;font-size:12px;overflow:auto;max-height:220px}',
    '.phf-audit-card .foot{padding:14px 20px;border-top:1px solid #edf3f0;text-align:right;background:#fbfdfc}',
    '@media(max-width:1100px){.phf-audit-filters{grid-template-columns:repeat(3,minmax(0,1fr))}}',
    '@media(max-width:640px){.phf-audit-filters{grid-template-columns:1fr 1fr}.phf-audit-filters .wide{grid-column:span 2}}'
  ].join('');
  document.head.appendChild(st);
}

function optionSet(map,sel){return '<option value="">Tất cả</option>'+Object.keys(map).map(function(k){return '<option value="'+k+'"'+(sel===k?' selected':'')+'>'+esc(map[k])+'</option>';}).join('');}

function shell(){
  ensureStyle();
  try{if(window.PHFAppShell)window.PHFAppShell.activateHr({clear:false,restoreTitle:false});}catch(e){}
  document.title='PHF HR · Nhật ký hệ thống';
  var f=state.filters;
  main().innerHTML='<section class="phf-audit">'
    +'<div class="phf-audit-hero"><span class="k">HỆ THỐNG · NHẬT KÝ</span><h2>Nhật ký hệ thống</h2>'
      +'<p>Ai đã làm gì trên hệ thống? Nhật ký trung tâm được ghi nhận từ ngày triển khai — chỉ đọc, không chỉnh sửa.</p></div>'
    +'<form class="phf-audit-filters" id="phfAuditFilters">'
      +'<label>Từ ngày<input type="date" name="from" value="'+esc(f.from)+'"></label>'
      +'<label>Đến ngày<input type="date" name="to" value="'+esc(f.to)+'"></label>'
      +'<label>Module<select name="module">'+optionSet(MODULE_LABEL,f.module)+'</select></label>'
      +'<label>Hành động<select name="action">'+optionSet(ACTION_LABEL,f.action)+'</select></label>'
      +'<label>Kết quả<select name="result">'+optionSet(RESULT_LABEL,f.result)+'</select></label>'
      +'<label>Người dùng<input name="user" placeholder="Mã NV / email" value="'+esc(f.user)+'"></label>'
      +'<label class="wide">Tìm kiếm<input name="q" placeholder="Đối tượng / tên" value="'+esc(f.q)+'"></label>'
      +'<div class="acts"><button type="submit" class="phf-audit-btn">Lọc</button>'
        +'<button type="button" class="phf-audit-btn ghost" id="phfAuditReset">Xóa lọc</button></div>'
    +'</form>'
    +'<div class="phf-audit-note" id="phfAuditNote"></div>'
    +'<div class="phf-audit-tablebox"><table class="phf-audit-table"><thead><tr>'
      +'<th>Thời gian</th><th>Người dùng</th><th>Module</th><th>Hành động</th><th>Đối tượng</th><th>Kết quả</th><th>IP / Thiết bị</th>'
    +'</tr></thead><tbody id="phfAuditRows"><tr><td colspan="7" class="phf-audit-empty">Đang tải…</td></tr></tbody></table></div>'
    +'<div class="phf-audit-more" id="phfAuditMore"></div>'
  +'</section>';
  var form=document.getElementById('phfAuditFilters');
  form.addEventListener('submit',function(e){e.preventDefault();var fd=new FormData(form);['from','to','module','action','result','user','q'].forEach(function(k){state.filters[k]=String(fd.get(k)||'').trim();});reload();});
  document.getElementById('phfAuditReset').addEventListener('click',function(){state.filters={from:'',to:'',module:'',action:'',result:'',user:'',q:''};shell();reload();});
}

function rowHtml(r){
  var rc=r.result==='success'?'ok':(r.result==='blocked'?'block':'fail');
  var actor=r.actorName||r.actorEmployeeCode||r.actorAccountId||'—';
  var obj=r.objectLabel||r.objectId||'—';
  return '<tr data-id="'+esc(r.id)+'">'
    +'<td>'+esc(fmtTime(r.occurredAt))+'</td>'
    +'<td><b>'+esc(actor)+'</b>'+(r.actorEmployeeCode&&r.actorEmployeeCode!==actor?'<br><small>'+esc(r.actorEmployeeCode)+'</small>':'')+'</td>'
    +'<td>'+esc(MODULE_LABEL[r.module]||r.module)+'</td>'
    +'<td>'+esc(actLabel(r.action))+'</td>'
    +'<td>'+esc(obj)+(r.objectType?'<br><small>'+esc(r.objectType)+'</small>':'')+'</td>'
    +'<td><span class="phf-audit-chip '+rc+'">'+esc(RESULT_LABEL[r.result]||r.result)+'</span></td>'
    +'<td><small>'+esc(r._ipShort||'—')+'</small></td>'
  +'</tr>';
}

function renderRows(){
  var tb=document.getElementById('phfAuditRows');if(!tb)return;
  if(!state.rows.length){tb.innerHTML='<tr><td colspan="7" class="phf-audit-empty">Chưa có bản ghi nào khớp bộ lọc. Nhật ký trung tâm được ghi nhận từ ngày triển khai Foundation V1.</td></tr>';}
  else tb.innerHTML=state.rows.map(rowHtml).join('');
  tb.onclick=function(e){var tr=e.target&&e.target.closest?e.target.closest('tr[data-id]'):null;if(tr)openDetail(tr.getAttribute('data-id'));};
  var more=document.getElementById('phfAuditMore');
  more.innerHTML=state.nextCursor?'<button type="button" class="phf-audit-btn ghost" id="phfAuditLoadMore">Tải thêm</button>':'';
  var lm=document.getElementById('phfAuditLoadMore');if(lm)lm.addEventListener('click',function(){loadPage(state.nextCursor);});
  var note=document.getElementById('phfAuditNote');if(note)note.textContent=state.rows.length?('Hiển thị '+state.rows.length+' bản ghi'+(state.nextCursor?' (còn nữa)':'')):'';
}

function qs(extra){
  var p=['audit=1'];var f=state.filters;
  ['from','to','module','action','result','user','q'].forEach(function(k){if(f[k])p.push(k+'='+encodeURIComponent(f[k]));});
  if(extra&&extra.cursor)p.push('cursor='+encodeURIComponent(extra.cursor));
  p.push('limit=50');
  return '/api/data?'+p.join('&');
}

async function loadPage(cursor){
  if(state.loading)return;state.loading=true;
  try{
    var res=await fetch(qs({cursor:cursor}),{credentials:'same-origin',cache:'no-store',headers:{'Accept':'application/json'}});
    var j=await res.json().catch(function(){return {};});
    if(!res.ok||j.ok===false){
      var msg=j.error||'Không tải được Nhật ký hệ thống.';
      if(!cursor){var tb=document.getElementById('phfAuditRows');if(tb)tb.innerHTML='<tr><td colspan="7" class="phf-audit-empty">'+esc(msg)+'</td></tr>';}
      state.loading=false;return;
    }
    var entries=(j.entries||[]).map(function(r){r._ipShort=r.ip||'';return r;});
    state.rows=cursor?state.rows.concat(entries):entries;
    state.nextCursor=j.nextCursor||null;
    renderRows();
  }catch(e){
    var tb2=document.getElementById('phfAuditRows');if(tb2&&!cursor)tb2.innerHTML='<tr><td colspan="7" class="phf-audit-empty">Lỗi kết nối khi tải Nhật ký.</td></tr>';
  }finally{state.loading=false;}
}
function reload(){state.rows=[];state.nextCursor=null;renderRows();loadPage(null);}

async function openDetail(id){
  var old=document.getElementById('phfAuditModal');if(old)old.remove();
  var root=document.createElement('div');root.id='phfAuditModal';root.className='phf-audit-modal';
  root.innerHTML='<div class="phf-audit-card"><h3>Chi tiết bản ghi</h3><dl><dt>Đang tải…</dt><dd></dd></dl></div>';
  document.body.appendChild(root);
  root.addEventListener('click',function(e){if(e.target===root)root.remove();});
  try{
    var res=await fetch('/api/data?audit=1&id='+encodeURIComponent(id),{credentials:'same-origin',cache:'no-store'});
    var j=await res.json().catch(function(){return {};});
    if(!res.ok||j.ok===false||!j.entry){root.querySelector('.phf-audit-card').innerHTML='<h3>Chi tiết bản ghi</h3><div class="phf-audit-empty">'+esc(j.error||'Không tải được chi tiết.')+'</div><div class="foot"></div>';bindClose(root);return;}
    var e=j.entry;
    function jb(v){return v==null?'—':'<pre>'+esc(JSON.stringify(v,null,2))+'</pre>';}
    root.querySelector('.phf-audit-card').innerHTML='<h3>'+esc(actLabel(e.action))+' · '+esc(RESULT_LABEL[e.result]||e.result)+'</h3>'
      +'<dl>'
      +'<dt>Thời gian</dt><dd>'+esc(fmtTime(e.occurredAt))+'</dd>'
      +'<dt>Người dùng</dt><dd>'+esc(e.actorName||'—')+'</dd>'
      +'<dt>Account ID</dt><dd>'+esc(e.actorAccountId||'—')+'</dd>'
      +'<dt>Mã nhân viên</dt><dd>'+esc(e.actorEmployeeCode||'—')+'</dd>'
      +'<dt>Module / Hành động</dt><dd>'+esc((MODULE_LABEL[e.module]||e.module)+' / '+e.action)+'</dd>'
      +'<dt>Đối tượng</dt><dd>'+esc((e.objectLabel||'—')+(e.objectId?' ('+e.objectId+')':'')+(e.objectType?' · '+e.objectType:''))+'</dd>'
      +'<dt>Nguồn</dt><dd>'+esc(e.sourceSystem||'—')+'</dd>'
      +'<dt>Request ID</dt><dd>'+esc(e.requestId||'—')+'</dd>'
      +'<dt>IP</dt><dd>'+esc(e.ip||'—')+'</dd>'
      +'<dt>Trình duyệt / Thiết bị</dt><dd>'+esc(e.userAgent||'—')+'</dd>'
      +'</dl>'
      +'<dl><dt>Trước</dt><dd>'+jb(e.before)+'</dd><dt>Sau</dt><dd>'+jb(e.after)+'</dd><dt>Metadata</dt><dd>'+jb(e.metadata)+'</dd></dl>'
      +'<div class="foot"><button type="button" class="phf-audit-btn ghost" data-close>Đóng</button></div>';
    bindClose(root);
  }catch(err){root.querySelector('.phf-audit-card').innerHTML='<h3>Chi tiết bản ghi</h3><div class="phf-audit-empty">Lỗi kết nối.</div><div class="foot"><button type="button" class="phf-audit-btn ghost" data-close>Đóng</button></div>';bindClose(root);}
}
function bindClose(root){root.querySelectorAll('[data-close]').forEach(function(b){b.addEventListener('click',function(){root.remove();});});}

window.phfRenderAuditLog=function(){
  if(role()!=='admin'){if(window.phfNavigate)return window.phfNavigate('/admin/home',true);return false;}
  shell();reload();
  return true;
};
})();
