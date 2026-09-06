/* PHF HR — QUẢN TRỊ TỔNG HỢP (QTTH) · Batch 01 LOCAL FOUNDATION
 *
 * Module shell (3 sections: QTTH / Vận hành / Phân quyền) rendered inside the
 * HR shell (#phfHrRoot), same host as /admin/nhan-su and /…/thi-dua. Routes are
 * role-prefixed: /{admin|ql|hv}/qtth[/qtth|/van-hanh|/phan-quyen].
 *
 * - QTTH-owned data (module permissions, management classification,
 *   dictionaries, history) lives in Company PostgreSQL phf_hr / schema qtth,
 *   reached via /api/data -> api/_lib/qtth-actions.js -> phf-hr-api /v1/qtth.
 * - Employee identity (mã NV, họ tên, trạng thái, phòng ban nguồn) is READ-ONLY
 *   from People Master (Supabase MAIN). QTTH never edits it.
 * - Authority is server-authoritative: system Admin (Control Tower) OR an
 *   active qtth.permission_manager_grant. The screen ALSO route-guards each
 *   section against the resolved capability — menu hiding is not the only
 *   boundary.
 */
(function(){
'use strict';

var API_URL='/api/data';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function role(){try{return window.phfGetSessionRole?window.phfGetSessionRole():'learner';}catch(e){return 'learner';}}
function prefix(){var r=role();return r==='admin'?'/admin':(r==='manager'?'/ql':'/hv');}
function go(path){if(window.phfNavigate)return window.phfNavigate(path);location.href=path;}
function qbase(){return prefix()+'/qtth';}

function toast(kind,title,msg){
  try{
    var host=document.getElementById('phf-qtth-toast');
    if(!host){host=document.createElement('div');host.id='phf-qtth-toast';document.body.appendChild(host);}
    var el=document.createElement('div');
    el.className='phf-qtth-toast is-'+(kind||'info');
    el.innerHTML='<strong>'+esc(title||'')+'</strong>'+(msg?'<span>'+esc(msg)+'</span>':'');
    host.appendChild(el);
    setTimeout(function(){el.classList.add('is-out');setTimeout(function(){el.remove();},260);},kind==='error'?5200:3200);
  }catch(e){}
}

async function call(action,fields){
  var payload=Object.assign({},fields||{},{action:action});
  var res;
  try{
    res=await fetch(API_URL,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload)});
  }catch(e){var err=new Error('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.');err.code='NETWORK';throw err;}
  var data=null;try{data=await res.json();}catch(e){}
  if(!res.ok||!data||data.ok===false){
    var m=(data&&(data.message||data.error))||('Máy chủ trả lỗi HTTP '+res.status);
    var e2=new Error(m);e2.code=(data&&data.code)||('HTTP_'+res.status);throw e2;
  }
  return data.result!==undefined?data.result:data;
}

function screenForPath(path){
  var m=String(path||'').replace(/\/+$/,'').match(/^\/(?:admin|ql|hv)\/qtth(?:\/([a-z-]+))?$/);
  if(!m)return '';
  return m[1]||'';
}

/* ---------- shell ---------- */
function menuModel(caps){
  var p=qbase();
  var out=[];
  if(caps.canViewQtth) out.push({key:'qtth',label:'QTTH',href:p+'/qtth',icon:'grid'});
  if(caps.canViewOperations) out.push({key:'van-hanh',label:'Vận hành',href:p+'/van-hanh',icon:'flow'});
  if(caps.canManagePermissions) out.push({key:'phan-quyen',label:'Phân quyền',href:p+'/phan-quyen',icon:'shield'});
  return out;
}
function firstAllowed(caps){
  if(caps.canManagePermissions)return 'phan-quyen';
  if(caps.canViewQtth)return 'qtth';
  if(caps.canViewOperations)return 'van-hanh';
  return '';
}
function svgIcon(t){
  var p={
    grid:'<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    flow:'<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7l3 8M16 7l-3 8"/>',
    shield:'<path d="M12 3 5 6v6c0 4 3 6.7 7 8 4-1.3 7-4 7-8V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    home:'<path d="M4 11 12 4l8 7"/><path d="M6 10v10h12V10"/>'
  };
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(p[t]||'')+'</svg>';
}
function navHtml(caps,activeKey){
  var items=menuModel(caps);
  var out='<nav class="phf-qtth-nav" aria-label="Menu Quản trị tổng hợp">';
  out+='<button type="button" class="phf-qtth-nav-back" data-qtth-home>'+svgIcon('home')+'<span>Về Trang chủ PHF HR</span></button>';
  out+='<div class="phf-qtth-nav-items">';
  items.forEach(function(it){
    out+='<a href="'+esc(it.href)+'" data-qtth-nav="'+esc(it.href)+'"'+(it.key===activeKey?' class="is-active" aria-current="page"':'')+'>'+svgIcon(it.icon)+'<span>'+esc(it.label)+'</span></a>';
  });
  if(!items.length) out+='<p class="phf-qtth-nav-empty">Bạn chưa được cấp quyền vào khu vực nào của QTTH.</p>';
  out+='</div></nav>';
  return out;
}

function accessDeniedHtml(msg){
  return '<section class="phf-qtth-card phf-qtth-denied"><h2>Không có quyền truy cập</h2><p>'+esc(msg||'Bạn không được cấp quyền vào khu vực này của Quản trị tổng hợp.')+'</p><p class="phf-qtth-muted">Liên hệ Admin hoặc người quản lý phân quyền để được cấp quyền.</p></section>';
}
function placeholderHtml(title,lines){
  return '<section class="phf-qtth-card phf-qtth-placeholder"><span class="phf-qtth-tag">Batch 01 · Khung nền</span><h2>'+esc(title)+'</h2>'
    +(lines||[]).map(function(l){return '<p>'+esc(l)+'</p>';}).join('')
    +'</section>';
}

/* ---------- Phân quyền screen ---------- */
var PQ_STATE={period:'',data:null,filter:'all',search:'',unit:'',group:'',kind:'',selected:{},drawerCode:'',boot:null};

function currentPeriod(){var d=new Date(Date.now()+7*3600*1000);var m=d.getUTCMonth()+1;return d.getUTCFullYear()+'-'+(m<10?'0'+m:''+m);}
function prevPeriod(p){var m=p.match(/^(\d{4})-(\d{2})$/);if(!m)return p;var y=+m[1],mo=+m[2]-1;if(mo<1){mo=12;y--;}return y+'-'+(mo<10?'0'+mo:''+mo);}
function kindLabel(k){return k==='direct'?'Trực tiếp':(k==='indirect'?'Gián tiếp':'—');}
function nameById(list,id){var f=(list||[]).find(function(x){return x.id===id;});return f?f.name:'';}

function pqFilteredRows(){
  var d=PQ_STATE.data;if(!d)return [];
  var q=PQ_STATE.search.trim().toLowerCase();
  return (d.roster||[]).filter(function(r){
    if(PQ_STATE.filter==='granted'&&!(r.canViewQtth||r.canViewOperations))return false;
    if(PQ_STATE.filter==='ungranted'&&(r.canViewQtth||r.canViewOperations||r.status!=='active'))return false;
    if(PQ_STATE.filter==='inactive'&&r.status!=='inactive')return false;
    if(PQ_STATE.filter==='all'&&false)return false;
    if(PQ_STATE.unit&&r.unitId!==PQ_STATE.unit)return false;
    if(PQ_STATE.group&&r.groupId!==PQ_STATE.group)return false;
    if(PQ_STATE.kind&&(r.staffKind||'')!==PQ_STATE.kind)return false;
    if(q&&r.employeeCode.toLowerCase().indexOf(q)<0&&(r.fullName||'').toLowerCase().indexOf(q)<0)return false;
    return true;
  });
}

function pqScreenHtml(){
  var d=PQ_STATE.data;
  var w=d.warnings||{};
  var units=d.units||[],groups=d.groups||[];
  var warnBits=[];
  if(w.newNoPermission) warnBits.push(w.newNoPermission+' nhân sự mới chưa gán quyền');
  if(w.incompleteClassification) warnBits.push(w.incompleteClassification+' nhân sự chưa hoàn tất phân loại quản trị');
  if(w.sourceDepartmentChanged) warnBits.push(w.sourceDepartmentChanged+' nhân sự có phòng ban nguồn đã thay đổi');
  var optU='<option value="">— CN/Đơn vị QTTH —</option>'+units.filter(function(u){return u.isActive;}).map(function(u){return '<option value="'+esc(u.id)+'">'+esc(u.name)+'</option>';}).join('');
  var optG='<option value="">— Phòng/Nhóm QTTH —</option>'+groups.filter(function(g){return g.isActive;}).map(function(g){return '<option value="'+esc(g.id)+'">'+esc(g.name)+'</option>';}).join('');

  var rows=pqFilteredRows();
  var body=rows.map(function(r){
    var sel=!!PQ_STATE.selected[r.employeeCode];
    return '<tr'+(r.status==='inactive'?' class="is-inactive"':'')+' data-qtth-row="'+esc(r.employeeCode)+'">'
      +'<td class="c-sel"><input type="checkbox" data-qtth-select="'+esc(r.employeeCode)+'"'+(sel?' checked':'')+(r.status==='inactive'?' disabled':'')+' aria-label="Chọn '+esc(r.employeeCode)+'"></td>'
      +'<td class="c-code">'+esc(r.employeeCode)+'</td>'
      +'<td>'+esc(r.fullName)+'</td>'
      +'<td>'+(r.status==='active'?'<span class="phf-qtth-pill is-on">Đang làm</span>':'<span class="phf-qtth-pill is-off">Đã nghỉ</span>')+'</td>'
      +'<td>'+esc(r.sourceDepartment||'—')+(r.sourceDepartmentChanged?' <span class="phf-qtth-warndot" title="Phòng ban nguồn đã thay đổi so với lần phân loại gần nhất">Δ</span>':'')+'</td>'
      +'<td>'+esc(nameById(units,r.unitId)||'<span class="phf-qtth-unclassified">Chưa phân loại</span>')+'</td>'
      +'<td>'+esc(nameById(groups,r.groupId)||'')+(r.groupId?'':'<span class="phf-qtth-unclassified">Chưa phân loại</span>')+'</td>'
      +'<td>'+(r.staffKind?kindLabel(r.staffKind):'<span class="phf-qtth-unclassified">Chưa xác định</span>')+'</td>'
      +'<td class="c-perm"><button type="button" class="phf-qtth-toggle'+(r.canViewQtth?' is-on':'')+'" data-qtth-perm="can_view_qtth" data-code="'+esc(r.employeeCode)+'"'+(r.status==='inactive'?' disabled':'')+' aria-pressed="'+(r.canViewQtth?'true':'false')+'">'+(r.canViewQtth?'Có':'—')+'</button></td>'
      +'<td class="c-perm"><button type="button" class="phf-qtth-toggle'+(r.canViewOperations?' is-on':'')+'" data-qtth-perm="can_view_operations" data-code="'+esc(r.employeeCode)+'"'+(r.status==='inactive'?' disabled':'')+' aria-pressed="'+(r.canViewOperations?'true':'false')+'">'+(r.canViewOperations?'Có':'—')+'</button></td>'
      +'<td class="c-act"><button type="button" class="phf-qtth-link" data-qtth-drawer="'+esc(r.employeeCode)+'">Chi tiết</button></td>'
    +'</tr>';
  }).join('');

  var selCount=Object.keys(PQ_STATE.selected).filter(function(k){return PQ_STATE.selected[k];}).length;

  return '<section class="phf-qtth-card">'
    +'<div class="phf-qtth-head">'
      +'<div><h2>Phân quyền &amp; Phân loại quản trị</h2><p class="phf-qtth-muted">Kỳ quản trị: <strong>'+esc(PQ_STATE.period)+'</strong> · Nguồn nhân sự: People Master (chỉ đọc)</p></div>'
      +'<div class="phf-qtth-head-actions">'
        +'<label class="phf-qtth-field"><span>Kỳ</span><input type="month" value="'+esc(PQ_STATE.period)+'" data-qtth-period></label>'
        +'<button type="button" class="phf-qtth-btn ghost" data-qtth-inherit>Kế thừa kỳ trước</button>'
        +(PQ_STATE.boot&&PQ_STATE.boot.viewer&&PQ_STATE.boot.viewer.isAdmin?'<button type="button" class="phf-qtth-btn ghost" data-qtth-dict>Danh mục QTTH</button>':'')
      +'</div>'
    +'</div>'
    +(warnBits.length?'<div class="phf-qtth-warn">'+warnBits.map(function(b){return '<span>⚠ '+esc(b)+'</span>';}).join('')+'</div>':'')
    +'<div class="phf-qtth-toolbar">'
      +'<div class="phf-qtth-filters" role="tablist">'
        +[['all','Tất cả'],['granted','Có quyền'],['ungranted','Chưa gán quyền'],['inactive','Đã nghỉ']].map(function(f){
          return '<button type="button" data-qtth-filter="'+f[0]+'"'+(PQ_STATE.filter===f[0]?' class="is-on"':'')+'>'+esc(f[1])+'</button>';
        }).join('')
      +'</div>'
      +'<input type="search" class="phf-qtth-search" placeholder="Tìm mã NV hoặc tên…" value="'+esc(PQ_STATE.search)+'" data-qtth-search>'
      +'<select class="phf-qtth-select" data-qtth-fu>'+optU.replace('value="'+esc(PQ_STATE.unit)+'"','value="'+esc(PQ_STATE.unit)+'" selected')+'</select>'
      +'<select class="phf-qtth-select" data-qtth-fg>'+optG.replace('value="'+esc(PQ_STATE.group)+'"','value="'+esc(PQ_STATE.group)+'" selected')+'</select>'
      +'<select class="phf-qtth-select" data-qtth-fk>'
        +'<option value="">— Tính chất —</option>'
        +'<option value="direct"'+(PQ_STATE.kind==='direct'?' selected':'')+'>Trực tiếp</option>'
        +'<option value="indirect"'+(PQ_STATE.kind==='indirect'?' selected':'')+'>Gián tiếp</option>'
      +'</select>'
    +'</div>'
    +(selCount?'<div class="phf-qtth-bulkbar"><strong>'+selCount+'</strong> nhân sự đã chọn — gán hàng loạt:'
       +' <select data-qtth-bulk-field><option value="unit_id">CN/Đơn vị QTTH</option><option value="group_id">Phòng/Nhóm QTTH</option><option value="staff_kind">Tính chất nhân sự</option></select>'
       +' <select data-qtth-bulk-value></select>'
       +' <button type="button" class="phf-qtth-btn" data-qtth-bulk-apply>Áp dụng</button>'
       +' <button type="button" class="phf-qtth-link" data-qtth-bulk-clear>Bỏ chọn</button>'
       +' <span class="phf-qtth-muted">(Quyền QTTH/Vận hành không gán hàng loạt)</span></div>':'')
    +'<div class="phf-qtth-tablewrap"><table class="phf-qtth-table">'
      +'<thead><tr><th class="c-sel"><input type="checkbox" data-qtth-select-all aria-label="Chọn tất cả"></th><th>Mã NV</th><th>Họ tên</th><th>Trạng thái</th><th>Phòng ban nguồn</th><th>CN/Đơn vị QTTH</th><th>Phòng/Nhóm QTTH</th><th>Trực tiếp/Gián tiếp</th><th>QTTH</th><th>Vận hành</th><th>Thao tác</th></tr></thead>'
      +'<tbody>'+(body||'<tr><td colspan="11" class="phf-qtth-empty">Không có nhân sự khớp bộ lọc.</td></tr>')+'</tbody>'
    +'</table></div>'
    +'<p class="phf-qtth-muted phf-qtth-count">'+rows.length+' / '+((PQ_STATE.data.roster||[]).length)+' nhân sự</p>'
  +'</section>'
  +'<div class="phf-qtth-drawer-host" data-qtth-drawer-host hidden></div>';
}

function bulkValueOptions(field){
  var d=PQ_STATE.data;
  if(field==='staff_kind') return '<option value="">— Chưa xác định —</option><option value="direct">Trực tiếp</option><option value="indirect">Gián tiếp</option>';
  var list=field==='group_id'?(d.groups||[]):(d.units||[]);
  return '<option value="">— Chưa phân loại —</option>'+list.filter(function(x){return x.isActive;}).map(function(x){return '<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>';}).join('');
}

async function pqReload(slot,period){
  slot.innerHTML='<section class="phf-qtth-card"><p class="phf-qtth-muted">Đang tải danh sách nhân sự…</p></section>';
  try{
    PQ_STATE.period=period||PQ_STATE.period||currentPeriod();
    PQ_STATE.data=await call('qtthListRoster',{period:PQ_STATE.period});
    PQ_STATE.selected={};
    renderPq(slot);
  }catch(err){
    slot.innerHTML='<section class="phf-qtth-card phf-qtth-denied"><h2>Không tải được</h2><p>'+esc(err.message)+'</p><button type="button" class="phf-qtth-btn" data-qtth-retry>Thử lại</button></section>';
    var b=slot.querySelector('[data-qtth-retry]');if(b)b.onclick=function(){pqReload(slot,PQ_STATE.period);};
  }
}

function renderPq(slot){
  slot.innerHTML=pqScreenHtml();
  wirePq(slot);
}

function wirePq(slot){
  function reReRender(){renderPq(slot);}
  slot.querySelectorAll('[data-qtth-filter]').forEach(function(b){b.onclick=function(){PQ_STATE.filter=b.getAttribute('data-qtth-filter');reReRender();};});
  var s=slot.querySelector('[data-qtth-search]');if(s)s.oninput=function(){PQ_STATE.search=s.value;var wrap=slot.querySelector('.phf-qtth-tablewrap');/* light re-render */reReRender();var ns=slot.querySelector('[data-qtth-search]');if(ns){ns.focus();ns.setSelectionRange(ns.value.length,ns.value.length);}};
  var fu=slot.querySelector('[data-qtth-fu]');if(fu)fu.onchange=function(){PQ_STATE.unit=fu.value;reReRender();};
  var fg=slot.querySelector('[data-qtth-fg]');if(fg)fg.onchange=function(){PQ_STATE.group=fg.value;reReRender();};
  var fk=slot.querySelector('[data-qtth-fk]');if(fk)fk.onchange=function(){PQ_STATE.kind=fk.value;reReRender();};
  var pm=slot.querySelector('[data-qtth-period]');if(pm)pm.onchange=function(){pqReload(slot,pm.value);};

  var inh=slot.querySelector('[data-qtth-inherit]');
  if(inh)inh.onclick=async function(){
    var from=prevPeriod(PQ_STATE.period);
    if(!confirm('Kế thừa phân loại quản trị từ kỳ '+from+' sang kỳ '+PQ_STATE.period+' cho nhân sự còn đang làm việc (không ghi đè bản ghi đã có)?'))return;
    inh.disabled=true;
    try{var r=await call('qtthInheritMonth',{from_period:from,to_period:PQ_STATE.period});toast('success','Đã kế thừa',r.inserted+' bản ghi được tạo mới.');pqReload(slot,PQ_STATE.period);}
    catch(err){toast('error','Không kế thừa được',err.message);inh.disabled=false;}
  };

  var dictBtn=slot.querySelector('[data-qtth-dict]');
  if(dictBtn)dictBtn.onclick=function(){openDictModal(slot);};

  // select
  slot.querySelectorAll('[data-qtth-select]').forEach(function(cb){cb.onchange=function(){PQ_STATE.selected[cb.getAttribute('data-qtth-select')]=cb.checked;reReRender();};});
  var all=slot.querySelector('[data-qtth-select-all]');
  if(all)all.onchange=function(){pqFilteredRows().forEach(function(r){if(r.status==='active')PQ_STATE.selected[r.employeeCode]=all.checked;});reReRender();};
  var bclr=slot.querySelector('[data-qtth-bulk-clear]');if(bclr)bclr.onclick=function(){PQ_STATE.selected={};reReRender();};

  var bf=slot.querySelector('[data-qtth-bulk-field]'),bv=slot.querySelector('[data-qtth-bulk-value]');
  if(bf&&bv){
    bv.innerHTML=bulkValueOptions(bf.value);
    bf.onchange=function(){bv.innerHTML=bulkValueOptions(bf.value);};
    var ba=slot.querySelector('[data-qtth-bulk-apply]');
    if(ba)ba.onclick=async function(){
      var codes=Object.keys(PQ_STATE.selected).filter(function(k){return PQ_STATE.selected[k];});
      if(!codes.length)return;
      ba.disabled=true;
      try{
        var r=await call('qtthBulkSetClassification',{period:PQ_STATE.period,field:bf.value,value:bv.value,employee_codes:codes});
        toast('success','Đã gán hàng loạt',r.changed+'/'+r.requested+' nhân sự được cập nhật.');
        pqReload(slot,PQ_STATE.period);
      }catch(err){toast('error','Không gán được',err.message);ba.disabled=false;}
    };
  }

  // permission toggles
  slot.querySelectorAll('[data-qtth-perm]').forEach(function(btn){
    btn.onclick=async function(){
      var codeV=btn.getAttribute('data-code'),field=btn.getAttribute('data-qtth-perm');
      var now=btn.classList.contains('is-on');
      btn.disabled=true;
      try{
        await call('qtthSetPermission',{employee_code:codeV,field:field,value:!now});
        var row=(PQ_STATE.data.roster||[]).find(function(x){return x.employeeCode===codeV;});
        if(row){if(field==='can_view_qtth')row.canViewQtth=!now;else row.canViewOperations=!now;}
        toast('success','Đã cập nhật quyền',codeV+' · '+(field==='can_view_qtth'?'QTTH':'Vận hành')+': '+(!now?'Có':'Bỏ'));
        renderPq(slot);
      }catch(err){toast('error','Không đổi quyền được',err.message);btn.disabled=false;}
    };
  });

  // drawer
  slot.querySelectorAll('[data-qtth-drawer]').forEach(function(b){b.onclick=function(){openDrawer(slot,b.getAttribute('data-qtth-drawer'));};});
}

/* ---------- per-person drawer ---------- */
async function openDrawer(slot,codeV){
  var host=slot.querySelector('[data-qtth-drawer-host]');if(!host)return;
  var d=PQ_STATE.data;
  var r=(d.roster||[]).find(function(x){return x.employeeCode===codeV;});if(!r)return;
  var isAdmin=PQ_STATE.boot&&PQ_STATE.boot.viewer&&PQ_STATE.boot.viewer.isAdmin;
  host.hidden=false;
  host.innerHTML='<div class="phf-qtth-drawer-backdrop" data-qtth-drawer-close></div><aside class="phf-qtth-drawer"><p class="phf-qtth-muted">Đang tải…</p></aside>';
  var aside=host.querySelector('.phf-qtth-drawer');
  var permHist=[],clsHist=[];
  try{permHist=(await call('qtthPermissionHistory',{employee_code:codeV})).entries||[];}catch(e){}
  try{clsHist=(await call('qtthClassificationHistory',{employee_code:codeV,period:PQ_STATE.period})).entries||[];}catch(e){}
  var units=d.units||[],groups=d.groups||[];
  function optList(list,cur){return '<option value="">— Chưa phân loại —</option>'+list.filter(function(x){return x.isActive||x.id===cur;}).map(function(x){return '<option value="'+esc(x.id)+'"'+(x.id===cur?' selected':'')+'>'+esc(x.name)+(x.isActive?'':' (ẩn)')+'</option>';}).join('');}
  aside.innerHTML='<header><div><strong>'+esc(r.fullName)+'</strong><span>'+esc(r.employeeCode)+' · '+esc(r.sourceDepartment||'—')+'</span></div><button type="button" data-qtth-drawer-close aria-label="Đóng">×</button></header>'
    +'<div class="phf-qtth-drawer-body">'
      +(r.sourceDepartmentChanged?'<p class="phf-qtth-warn-inline">⚠ Phòng ban nguồn đã thay đổi (phân loại lần trước theo: '+esc(r.sourceDepartmentSnapshot||'—')+'). Không tự cập nhật phân loại QTTH.</p>':'')
      +'<h3>Phân loại quản trị · kỳ '+esc(PQ_STATE.period)+'</h3>'
      +'<label class="phf-qtth-field"><span>CN/Đơn vị QTTH</span><select data-qtth-d-unit'+(r.status==='inactive'?' disabled':'')+'>'+optList(units,r.unitId)+'</select></label>'
      +'<label class="phf-qtth-field"><span>Phòng/Nhóm QTTH</span><select data-qtth-d-group'+(r.status==='inactive'?' disabled':'')+'>'+optList(groups,r.groupId)+'</select></label>'
      +'<label class="phf-qtth-field"><span>Tính chất nhân sự</span><select data-qtth-d-kind'+(r.status==='inactive'?' disabled':'')+'><option value="">— Chưa xác định —</option><option value="direct"'+(r.staffKind==='direct'?' selected':'')+'>Trực tiếp</option><option value="indirect"'+(r.staffKind==='indirect'?' selected':'')+'>Gián tiếp</option></select></label>'
      +'<button type="button" class="phf-qtth-btn" data-qtth-d-save'+(r.status==='inactive'?' disabled':'')+'>Lưu phân loại</button>'
      +'<h3>Quyền truy cập</h3>'
      +(r.status==='inactive'?'<p class="phf-qtth-muted">Nhân sự đã nghỉ — không thể cấp quyền mới. Bản ghi và lịch sử được giữ nguyên.</p>':'')
      +'<label class="phf-qtth-check"><input type="checkbox" data-qtth-d-qtth'+(r.canViewQtth?' checked':'')+(r.status==='inactive'?' disabled':'')+'> Xem QTTH</label>'
      +'<label class="phf-qtth-check"><input type="checkbox" data-qtth-d-ops'+(r.canViewOperations?' checked':'')+(r.status==='inactive'?' disabled':'')+'> Xem Vận hành</label>'
      +(isAdmin?'<label class="phf-qtth-check phf-qtth-adminonly"><input type="checkbox" data-qtth-d-mgr'+(r.isPermissionManager?' checked':'')+(r.status==='inactive'?' disabled':'')+'> Quản lý phân quyền QTTH (Admin cấp)</label>':'')
      +'<h3>Lịch sử phân quyền</h3>'+histHtml(permHist,true)
      +'<h3>Lịch sử phân loại (kỳ '+esc(PQ_STATE.period)+')</h3>'+histHtml(clsHist,false)
    +'</div>';

  host.querySelectorAll('[data-qtth-drawer-close]').forEach(function(b){b.onclick=function(){host.hidden=true;host.innerHTML='';};});

  var save=aside.querySelector('[data-qtth-d-save]');
  if(save)save.onclick=async function(){
    save.disabled=true;
    try{
      await call('qtthSetClassification',{employee_code:codeV,period:PQ_STATE.period,
        unit_id:aside.querySelector('[data-qtth-d-unit]').value,
        group_id:aside.querySelector('[data-qtth-d-group]').value,
        staff_kind:aside.querySelector('[data-qtth-d-kind]').value});
      toast('success','Đã lưu phân loại',codeV);
      host.hidden=true;host.innerHTML='';
      pqReload(slot,PQ_STATE.period);
    }catch(err){toast('error','Không lưu được',err.message);save.disabled=false;}
  };
  function wirePermCheck(sel,field){
    var el=aside.querySelector(sel);if(!el)return;
    el.onchange=async function(){
      el.disabled=true;
      try{await call('qtthSetPermission',{employee_code:codeV,field:field,value:el.checked});toast('success','Đã cập nhật quyền',codeV);
        var row=(PQ_STATE.data.roster||[]).find(function(x){return x.employeeCode===codeV;});
        if(row){if(field==='can_view_qtth')row.canViewQtth=el.checked;else row.canViewOperations=el.checked;}
      }catch(err){toast('error','Lỗi',err.message);el.checked=!el.checked;}
      el.disabled=false;
    };
  }
  wirePermCheck('[data-qtth-d-qtth]','can_view_qtth');
  wirePermCheck('[data-qtth-d-ops]','can_view_operations');
  var mgr=aside.querySelector('[data-qtth-d-mgr]');
  if(mgr)mgr.onchange=async function(){
    mgr.disabled=true;
    try{await call('qtthSetPermissionManager',{employee_code:codeV,is_active:mgr.checked});toast('success','Đã cập nhật',codeV+(mgr.checked?' được cấp quyền quản lý phân quyền':' bị thu quyền quản lý phân quyền'));
      var row=(PQ_STATE.data.roster||[]).find(function(x){return x.employeeCode===codeV;});if(row)row.isPermissionManager=mgr.checked;
    }catch(err){toast('error','Lỗi',err.message);mgr.checked=!mgr.checked;}
    mgr.disabled=false;
  };
}
function histHtml(entries,isPerm){
  if(!entries||!entries.length)return '<p class="phf-qtth-muted">Chưa có thay đổi.</p>';
  var fLabel={can_view_qtth:'Quyền QTTH',can_view_operations:'Quyền Vận hành',permission_manager:'Quản lý phân quyền',unit_id:'CN/Đơn vị',group_id:'Phòng/Nhóm',staff_kind:'Tính chất'};
  return '<ul class="phf-qtth-hist">'+entries.map(function(e){
    var b=isPerm?(e.before?'Có':'—'):(e.before||'—');
    var a=isPerm?(e.after?'Có':'—'):(e.after||'—');
    return '<li><span>'+esc(fLabel[e.field]||e.field)+'</span>: '+esc(String(b))+' → <strong>'+esc(String(a))+'</strong><em>'+esc(e.changedByName||'')+' · '+esc(new Date(e.changedAt).toLocaleString('vi-VN'))+'</em></li>';
  }).join('')+'</ul>';
}

/* ---------- dictionary modal (Admin) ---------- */
function openDictModal(slot){
  var d=PQ_STATE.data;
  var host=slot.querySelector('[data-qtth-drawer-host]');if(!host)return;
  host.hidden=false;
  function listBlock(kind,title,items){
    return '<div class="phf-qtth-dict-col"><h3>'+esc(title)+'</h3>'
      +'<ul>'+items.map(function(x){return '<li'+(x.isActive?'':' class="is-off"')+'><input type="number" value="'+x.sortOrder+'" data-qtth-dict-order data-id="'+esc(x.id)+'" data-kind="'+kind+'" aria-label="Thứ tự"><input type="text" value="'+esc(x.name)+'" data-qtth-dict-name data-id="'+esc(x.id)+'" data-kind="'+kind+'"><label><input type="checkbox" data-qtth-dict-active data-id="'+esc(x.id)+'" data-kind="'+kind+'"'+(x.isActive?' checked':'')+'> hiển thị</label></li>';}).join('')+'</ul>'
      +'<div class="phf-qtth-dict-add"><input type="text" placeholder="Tên mục mới…" data-qtth-dict-new data-kind="'+kind+'"><button type="button" class="phf-qtth-btn sm" data-qtth-dict-create data-kind="'+kind+'">Thêm</button></div>'
    +'</div>';
  }
  host.innerHTML='<div class="phf-qtth-drawer-backdrop" data-qtth-drawer-close></div><aside class="phf-qtth-drawer is-wide"><header><strong>Danh mục QTTH</strong><button type="button" data-qtth-drawer-close aria-label="Đóng">×</button></header>'
    +'<div class="phf-qtth-drawer-body"><p class="phf-qtth-muted">Mục đã được sử dụng chỉ nên ẩn (bỏ “hiển thị”), không xoá.</p><div class="phf-qtth-dict-grid">'
    +listBlock('unit','CN/Đơn vị QTTH',d.units||[])
    +listBlock('group','Phòng/Nhóm QTTH',d.groups||[])
    +'</div></div></aside>';
  host.querySelectorAll('[data-qtth-drawer-close]').forEach(function(b){b.onclick=function(){host.hidden=true;host.innerHTML='';};});
  async function upsert(params){try{await call('qtthUpsertDictionary',params);toast('success','Đã lưu danh mục');await pqReloadKeepDict(slot);}catch(err){toast('error','Không lưu được',err.message);}}
  host.querySelectorAll('[data-qtth-dict-create]').forEach(function(b){b.onclick=function(){var inp=host.querySelector('[data-qtth-dict-new][data-kind="'+b.getAttribute('data-kind')+'"]');if(inp&&inp.value.trim())upsert({kind:b.getAttribute('data-kind'),name:inp.value.trim()});};});
  host.querySelectorAll('[data-qtth-dict-name]').forEach(function(inp){inp.onchange=function(){upsert({kind:inp.getAttribute('data-kind'),id:inp.getAttribute('data-id'),name:inp.value.trim()});};});
  host.querySelectorAll('[data-qtth-dict-order]').forEach(function(inp){inp.onchange=function(){upsert({kind:inp.getAttribute('data-kind'),id:inp.getAttribute('data-id'),sort_order:inp.value});};});
  host.querySelectorAll('[data-qtth-dict-active]').forEach(function(inp){inp.onchange=function(){upsert({kind:inp.getAttribute('data-kind'),id:inp.getAttribute('data-id'),is_active:inp.checked});};});
}
async function pqReloadKeepDict(slot){
  try{PQ_STATE.data=await call('qtthListRoster',{period:PQ_STATE.period});renderPq(slot);openDictModal(slot);}catch(e){}
}

/* ---------- entry ---------- */
window.phfRenderQtth=async function(requestedPath){
  var actual=String((window.location&&window.location.pathname)||'/').split('?')[0].split('#')[0].replace(/\/{2,}/g,'/');
  if(actual.length>1)actual=actual.replace(/\/$/,'');
  var main=document.getElementById('phfHrRoot');
  if(!main)return false;
  document.body.classList.add('phf-hr-gateway-mode');

  var key=screenForPath(requestedPath||actual);

  main.innerHTML='<div class="phf-qtth"><div class="phf-qtth-shell">'
    +'<header class="phf-qtth-top">'
      +'<img src="assets/logo/phf-logo.png" alt="PHUHOA FRESH" class="phf-qtth-logo" width="140" height="30" decoding="async" onerror="this.style.display=\'none\'">'
      +'<span class="phf-qtth-brand"><b>Quản trị tổng hợp</b><small>PHF HR</small></span>'
    +'</header>'
    +'<div class="phf-qtth-layout">'
      +'<div data-qtth-nav-slot><nav class="phf-qtth-nav"><p class="phf-qtth-nav-empty">Đang tải…</p></nav></div>'
      +'<main class="phf-qtth-work" data-qtth-slot><section class="phf-qtth-card"><p class="phf-qtth-muted">Đang tải quyền truy cập…</p></section></main>'
    +'</div>'
  +'</div></div>';

  var navSlot=main.querySelector('[data-qtth-nav-slot]');
  var slot=main.querySelector('[data-qtth-slot]');
  function wireNav(){
    navSlot.querySelectorAll('[data-qtth-home]').forEach(function(b){b.onclick=function(e){e.preventDefault();var home=(typeof window.phfGetRoleHomePath==='function'&&window.phfGetRoleHomePath())||(prefix()+'/home');go(home);};});
    navSlot.querySelectorAll('[data-qtth-nav]').forEach(function(a){a.onclick=function(e){if(e.metaKey||e.ctrlKey||e.shiftKey||e.button===1)return;e.preventDefault();go(a.getAttribute('data-qtth-nav'));};});
  }

  var boot;
  try{ boot=await call('qtthBootstrap',{}); }
  catch(err){
    navSlot.innerHTML=navHtml({},'');wireNav();
    slot.innerHTML=accessDeniedHtml(err.message);
    document.title='Quản trị tổng hợp · PHF HR';
    return true;
  }
  var caps=boot.capabilities||{};
  PQ_STATE.boot=boot;

  // server-authoritative route guard — decided from caps, never the URL.
  var need={'qtth':'canViewQtth','van-hanh':'canViewOperations','phan-quyen':'canManagePermissions'};
  if(!key || !caps[need[key]]){
    var target=firstAllowed(caps);
    if(target && key!==target){
      var home=qbase()+'/'+target;
      if(actual!==home && window.phfNavigate){window.phfNavigate(home,true);return true;}
      key=target;
    }else if(!target){
      navSlot.innerHTML=navHtml(caps,'');wireNav();
      slot.innerHTML=accessDeniedHtml(boot.devLocked
        ?(boot.lockReason||'QTTH đang trong giai đoạn phát triển — chỉ Admin và người vận hành được chỉ định mới truy cập được.')
        :'Bạn chưa được cấp quyền vào Quản trị tổng hợp. Cần quyền "Xem QTTH", "Xem Vận hành" hoặc "Quản lý phân quyền".');
      document.title='Quản trị tổng hợp · PHF HR';
      return true;
    }else{ key=target; }
  }

  navSlot.innerHTML=navHtml(caps,key);wireNav();

  if(key==='phan-quyen'){
    await pqReload(slot,PQ_STATE.period||currentPeriod());
  }else if(key==='van-hanh'){
    slot.innerHTML=placeholderHtml('Vận hành',[
      'Khu vực này là VIEW/PROJECTION của dữ liệu QTTH được phép chia sẻ — không phải module nghiệp vụ Vận hành.',
      'Batch 01 chỉ dựng khung. Cơ chế Admin publish dữ liệu QTTH → Vận hành sẽ bàn sau khi QTTH có dữ liệu thật.'
    ]);
  }else{
    slot.innerHTML=placeholderHtml('QTTH',[
      'Trang tổng quan Quản trị tổng hợp. Batch 01 chỉ dựng khung nền sạch.',
      'Báo cáo quản trị chuyên sâu chưa được xây trong batch này.'
    ]);
  }

  document.title='Quản trị tổng hợp · PHF HR';
  try{window.scrollTo({top:0,behavior:'instant'});}catch(e){window.scrollTo(0,0);}
  return true;
};

window.__phfQtthTestHooks={screenForPath:screenForPath,menuModel:menuModel,firstAllowed:firstAllowed,currentPeriod:currentPeriod,prevPeriod:prevPeriod};
})();
