/* PHF Classroom 1.0 - workspace giao diện nền tảng, chưa nối dữ liệu lớp */
(function(){
  'use strict';
  var VERSION='1.31';
  var ROUTES={
    admin:[
      {group:'Điều hành',items:[
        ['/admin/classroom','Tổng quan',true],
        ['/admin/classroom/lop','Lớp đào tạo',true],
        ['/admin/classroom/lich','Lịch đào tạo',true],
        ['/admin/classroom/tai-lieu','Tài liệu đào tạo',true]
      ]},
      {group:'Quản lý lớp học',items:[
        ['/admin/classroom/hoc-vien','Người dùng Classroom',true],
        ['/admin/classroom/diem-danh','Điểm danh',true]
      ]},
      {group:'Kiểm tra và kết quả',items:[
        ['/admin/classroom/bai-kiem-tra','Bài kiểm tra',true],
        ['/admin/classroom/ket-qua','Kết quả đào tạo',true]
      ]},
      {group:'Phê duyệt và theo dõi',items:[
        ['/admin/classroom/de-xuat','Đề xuất đào tạo',true],
        ['/admin/classroom/bao-cao','Báo cáo',true]
      ]},
      {group:'Hệ thống',items:[
        ['/admin/classroom/thong-bao','Thông báo',true],
        ['/admin/classroom/cau-hinh','Cấu hình Classroom',true]
      ]}
    ],
    manager:[
      {group:'Điều hành',items:[
        ['/ql/classroom','Tổng quan',true],
        ['/ql/classroom/lop','Lớp đào tạo',true],
        ['/ql/classroom/lich','Lịch đào tạo',true],
        ['/ql/classroom/tai-lieu','Tài liệu đào tạo',true]
      ]},
      {group:'Quản lý lớp học',items:[
        ['/ql/classroom/hoc-vien','Người dùng Classroom',true],
        ['/ql/classroom/diem-danh','Điểm danh',true]
      ]},
      {group:'Kiểm tra và kết quả',items:[
        ['/ql/classroom/bai-kiem-tra','Bài kiểm tra',true],
        ['/ql/classroom/ket-qua','Kết quả đào tạo',true]
      ]},
      {group:'Phê duyệt và theo dõi',items:[
        ['/ql/classroom/de-xuat','Đề xuất đào tạo',true],
        ['/ql/classroom/bao-cao','Báo cáo',true]
      ]},
      {group:'Hệ thống',items:[
        ['/ql/classroom/thong-bao','Thông báo',true]
      ]}
    ],
    learner:[
      {group:'Cá nhân',items:[
        ['/hv/classroom','Lớp đào tạo của tôi',true],
        ['/hv/classroom/lich','Lịch học của tôi',true],
        ['/hv/classroom/tai-lieu','Tài liệu đào tạo',true],
        ['/hv/classroom/bai-kiem-tra','Bài kiểm tra của tôi',true],
        ['/hv/classroom/ket-qua','Kết quả của tôi',true],
        ['/hv/classroom/de-xuat','Đề xuất đào tạo',true]
      ]}
    ]
  };
  function role(){try{return String((window.phfGetSessionRole&&window.phfGetSessionRole())||((window.phfGetAuthenticatedUser&&window.phfGetAuthenticatedUser()||{}).role)||'learner').toLowerCase();}catch(e){return 'learner';}}
  function user(){try{return window.phfGetAuthenticatedUser?window.phfGetAuthenticatedUser():null;}catch(e){return null;}}
  function name(){var u=user()||{};return String(u.name||u.display_name||u.email||'PHF').trim();}
  function isManage(){return role()==='admin'||role()==='manager';}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function phfcInitials(name,email){
    var raw=String(name||'').trim();
    if(!raw||raw==='?'||raw.indexOf('@')>=0) raw=String(email||raw||'').split('@')[0].trim();
    var parts=raw.replace(/[._-]+/g,' ').split(/\s+/).filter(Boolean);
    if(!parts.length) return 'NV';
    if(parts.length===1) return parts[0].slice(0,2).toUpperCase();
    return (parts[0].charAt(0)+parts[parts.length-1].charAt(0)).toUpperCase();
  }
  function cleanPath(v){var p=String(v||location.pathname||'/').split('?')[0].split('#')[0].replace(/\/{2,}/g,'/');if(p.length>1)p=p.replace(/\/$/,'');return p||'/';}
  function setUrl(path,replace){try{history[replace?'replaceState':'pushState']({phfClassroom:true,path:path},'',path);}catch(e){}}
  function isClassroomPath(path){return /^\/(?:classroom|admin\/classroom|ql\/classroom|hv\/classroom)(?:\/|$)/.test(cleanPath(path||location.pathname));}
  function classroomRoot(){return document.getElementById('phfClassroomRoot');}
  function homePath(){return role()==='admin'?'/admin/classroom':(role()==='manager'?'/ql/classroom':'/hv/classroom');}
  function goHub(){
    var target=role()==='admin'?'/admin':(role()==='manager'?'/ql':'/hv');
    if(typeof window.phfNavigate==='function') return window.phfNavigate(target);
    location.href=target;
  }
  function routeGroups(){return (ROUTES[role()]||ROUTES.learner).slice();}
  function allowedPaths(){var out=[];routeGroups().forEach(function(g){g.items.forEach(function(i){if(i[2]!==false)out.push(i[0]);});});return out;}
  function normalizeRoute(path){
    path=cleanPath(path);
    if(path==='/classroom'||path==='/classroom/my-classes') return homePath();
    if(path==='/classroom/proposals') return role()==='admin'?'/admin/classroom/de-xuat':(role()==='manager'?'/ql/classroom/de-xuat':homePath());
    if(path==='/classroom/settings') return role()==='admin'?'/admin/classroom/cau-hinh':homePath();
    if(path==='/admin/classroom/nguoi-phu-trach') return '/admin/classroom/hoc-vien';
    if(path==='/ql/classroom/nguoi-phu-trach') return '/ql/classroom/hoc-vien';
    if(allowedPaths().indexOf(path)>=0)return path;
    if(path==='/admin/classroom/lop/tao-moi') return path;
    if(/^\/(?:admin|ql|hv)\/classroom\/lop\/[^/]+$/.test(path)) return path;
    return homePath();
  }
  function navigate(path,replace){
    path=normalizeRoute(path);
    if(typeof window.phfNavigate==='function')return window.phfNavigate(path,!!replace);
    setUrl(path,!!replace);render(path);return true;
  }
  function iconImg(){return '<img src="assets/images/classroom/phf-classroom-brand-icon.png" alt="" aria-hidden="true">';}
  function navActivePath(path){
    path=cleanPath(path);
    if(path==='/admin/classroom/lop/tao-moi') return '/admin/classroom/lop';
    if(/^\/admin\/classroom\/lop\/[^/]+$/.test(path)) return '/admin/classroom/lop';
    if(/^\/ql\/classroom\/lop\/[^/]+$/.test(path)) return '/ql/classroom/lop';
    if(/^\/hv\/classroom\/lop\/[^/]+$/.test(path)) return '/hv/classroom';
    return path;
  }
  function navHtml(active){
    active=navActivePath(active);
    return routeGroups().map(function(group,index){
      var containsActive=group.items.some(function(item){return item[0]===active;});
      var panelId='phfc-nav-panel-'+index;
      return '<section class="phfc-nav-group'+(containsActive?' is-open':'')+'">'+
        '<button class="phfc-nav-label" type="button" data-phfc-nav-toggle aria-expanded="'+(containsActive?'true':'false')+'" aria-controls="'+panelId+'">'+
          '<span>'+esc(group.group)+'</span><span class="phfc-nav-toggle-mark" aria-hidden="true">'+(containsActive?'−':'+')+'</span>'+
        '</button>'+
        '<nav class="phfc-nav" id="'+panelId+'"'+(containsActive?'':' hidden')+'>'+group.items.map(function(item){
          var enabled=item[2]!==false;
          var attrs=enabled?' data-phfc-route="'+esc(item[0])+'"':' aria-disabled="true"';
          var cls=(item[0]===active?'active ':'')+(enabled?'':'is-preview');
          return '<button class="'+cls.trim()+'" type="button"'+attrs+' aria-current="'+(item[0]===active?'page':'false')+'"><span class="phfc-nav-dot" aria-hidden="true"></span><span>'+esc(item[1])+'</span></button>';
        }).join('')+'</nav></section>';
    }).join('');
  }
  function shell(content,title,desc,active){
    var label=role()==='admin'?'Admin':(role()==='manager'?'Quản lý':'Nhân viên');
    var showPageHeading=['/admin/classroom','/ql/classroom','/hv/classroom','/admin/classroom/lop/tao-moi'].indexOf(active)===-1;
    var heading=showPageHeading?'<div class="phfc-topline"><div class="phfc-title"><small>PHF CLASSROOM</small><h2>'+esc(title)+'</h2><p>'+esc(desc)+'</p></div></div>':'';
    return '<section class="phfc-shell phfc-role-'+esc(role())+'">'+
      '<header class="phfc-header"><button class="phfc-mobile-menu-button" type="button" data-phfc-mobile-menu aria-controls="phfcMobileSidebar" aria-expanded="false" aria-label="Mở menu Classroom"><span></span><span></span><span></span></button><button class="phfc-hub-back" type="button" data-phfc-back><span class="phfc-hub-back-icon" aria-hidden="true">←</span><span class="phfc-hub-back-copy"><strong>PHF Training Hub</strong><small>Quay lại hệ thống đào tạo</small></span></button><div class="phfc-header-brand"><div class="phfc-header-brand-main"><img class="phfc-header-company-logo" src="assets/images/classroom/phuhoafresh-wordmark.png" alt="Phuhoafresh"><strong>PHF Classroom</strong><small>Quản lý đào tạo nội bộ</small></div></div><div class="phfc-header-actions"><button class="phfc-notification-button" type="button" data-phfc-notifications aria-haspopup="dialog" aria-expanded="false" aria-label="Thông báo Classroom"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="phfc-notification-badge" data-phfc-notification-badge hidden>0</span></button><button class="phfc-header-user" type="button" data-phfc-account aria-haspopup="menu" aria-expanded="false"><span><span class="phfc-greeting-prefix">Xin chào, </span><strong class="phfc-greeting-name">'+esc(name())+'</strong></span><span class="phfc-header-user-bottom"><small>'+esc(label)+'</small><span class="phfc-account-chevron" aria-hidden="true"></span></span></button></div></header>'+ 
      '<div class="phfc-layout"><button class="phfc-mobile-backdrop" type="button" data-phfc-mobile-close aria-label="Đóng menu Classroom"></button><aside class="phfc-sidebar" id="phfcMobileSidebar" aria-label="Menu PHF Classroom"><div class="phfc-sidebar-mobile-head"><div class="phfc-sidebar-brand">'+iconImg()+'<div><strong>PHF Classroom</strong></div></div><button class="phfc-mobile-close-button" type="button" data-phfc-mobile-close aria-label="Đóng menu">×</button></div><button class="phfc-sidebar-hub-back" type="button" data-phfc-back><span aria-hidden="true">←</span><span><strong>PHF Training Hub</strong><small>Quay lại hệ thống đào tạo</small></span></button>'+navHtml(active)+'</aside><main class="phfc-main">'+heading+content+'</main></div></section>';
  }
  function emptyState(title,copy){return '<section class="phfc-card phfc-panel phfc-empty-panel"><div class="phfc-empty-icon">▦</div><h3>'+esc(title)+'</h3><p>'+esc(copy)+'</p></section>';}
  var classroomCache={loaded:false,loading:null,classes:[],error:''};
  async function classroomRequest(url,options){
    var response=await fetch(url,Object.assign({credentials:'same-origin',cache:'no-store'},options||{}));
    var json={};try{json=await response.json();}catch(e){}
    if(!response.ok||json.ok===false){
      var rawError=json&&json.error;
      var message=typeof rawError==='string'?rawError:(rawError&&rawError.message)||json.message||'Không thể xử lý dữ liệu PHF Classroom.';
      var error=new Error(message);
      error.code=(rawError&&rawError.code)||json.code||'CLASSROOM_REQUEST_FAILED';
      error.status=response.status;
      throw error;
    }
    return json;
  }
  async function loadClassroomClasses(force){
    if(classroomCache.loaded&&!force)return classroomCache.classes;
    if(classroomCache.loading&&!force)return classroomCache.loading;
    classroomCache.loading=classroomRequest('/api/data?classroom=1').then(function(json){classroomCache.classes=Array.isArray(json.classes)?json.classes:[];classroomCache.loaded=true;classroomCache.error='';return classroomCache.classes;}).catch(function(error){classroomCache.error=error.message||String(error);throw error;}).finally(function(){classroomCache.loading=null;});
    return classroomCache.loading;
  }
  async function loadClassroomClass(id){var json=await classroomRequest('/api/data?classroom=1&id='+encodeURIComponent(id));return json.classroomClass||null;}
  async function saveClassroomClass(payload,action){var json=await classroomRequest('/api/data?classroom=1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:action||'saveDraft',classroomClass:payload})});classroomCache.loaded=false;return json.classroomClass;}
  function formatClassDate(v){if(!v)return 'Chưa thiết lập';try{return new Date(v).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}catch(e){return String(v);}}
  function classStatusLabel(v){return {draft:'Bản nháp',published:'Đã phát hành',in_progress:'Đang diễn ra',completed:'Đã hoàn thành',cancelled:'Đã hủy'}[v]||v||'Chưa xác định';}
  function classTypeLabel(v){return v==='multi'?'Khóa nhiều buổi':'Lớp một buổi';}
  function deliveryLabel(v){return v==='online'?'Online – tự học':(v==='hybrid'?'Kết hợp':'Trực tiếp');}
  function phfcNotice(type,title,message){
    try{
      if(typeof window.phfNotice==='function'){
        if(window.phfNotice.length>=3) return window.phfNotice(type,title,message);
        return window.phfNotice({type:type,title:title,message:message});
      }
    }catch(e){}
    try{window.alert(title+'\n\n'+message);}catch(e){}
  }
  function phfcLocalToIso(value){
    if(!value)return '';
    var date=new Date(value);
    return isNaN(date.getTime())?'':date.toISOString();
  }
  function phfcEmployeeValue(row,keys){
    row=row||{};
    for(var i=0;i<keys.length;i++){
      var value=row[keys[i]];
      if(value!==undefined&&value!==null&&String(value).trim()!=='') return String(value).trim();
    }
    return '';
  }
  function phfcNotificationRecipients(){
    var list=phfcEmployeeData().slice(), out=[], seen={};
    function add(row,isCurrent){
      row=row||{};
      var email=phfcEmployeeValue(row,['email','workEmail','work_email','personalEmail','personal_email']);
      var code=phfcEmployeeValue(row,['employeeCode','employee_code','code']);
      var id=phfcEmployeeValue(row,['id','employee_id','employeeId'])||email||code;
      if(!id||seen[id])return;
      var rawStatus=phfcEmployeeValue(row,['accountStatus','account_status','status','employmentStatus','employment_status']).toLowerCase();
      var locked=row.locked===true||row.is_locked===true||row.disabled===true||row.is_active===false||['locked','disabled','inactive','terminated','nghi viec','nghỉ việc','da nghi','đã nghỉ','khoa','khóa'].indexOf(rawStatus)>=0;
      if(locked&&!isCurrent)return;
      seen[id]=true;
      out.push({
        id:id,
        name:phfcEmployeeValue(row,['name','fullName','full_name','display_name'])||(isCurrent?name():'Chưa cập nhật họ tên'),
        code:code||'—',
        email:email||'—',
        branch:phfcEmployeeValue(row,['branch','branchName','branch_name','location','store'])||'Chưa phân chi nhánh',
        department:phfcEmployeeValue(row,['department','departmentName','department_name','team'])||'Chưa phân phòng ban',
        role:phfcEmployeeValue(row,['role','roleName','role_name','position','positionName','position_name'])||(isCurrent?(role()==='admin'?'Admin':(role()==='manager'?'Quản lý':'Nhân viên')):'Nhân viên')
      });
    }
    list.forEach(function(row){add(row,false);});
    var u=user()||{};
    add({id:u.employee_id||u.employeeId||u.id||u.email,name:name(),email:u.email,role:role()==='admin'?'Admin':(role()==='manager'?'Quản lý':'Nhân viên')},true);
    return out;
  }
  function phfcUniqueValues(list,key){
    var seen={},out=[];
    list.forEach(function(row){var v=String(row[key]||'').trim();if(v&&!seen[v]){seen[v]=true;out.push(v);}});
    return out.sort(function(a,b){return a.localeCompare(b,'vi');});
  }
  function phfcNotificationWorkspace(){
    var recipients=phfcNotificationRecipients();
    var branches=phfcUniqueValues(recipients,'branch');
    var departments=phfcUniqueValues(recipients,'department');
    var roles=phfcUniqueValues(recipients,'role');
    function options(values,placeholder){return '<option value="">'+esc(placeholder)+'</option>'+values.map(function(v){return '<option value="'+esc(v)+'">'+esc(v)+'</option>';}).join('');}
    var recipientRows=recipients.map(function(r){return '<label class="phfc-notify-person" data-phfc-notify-person data-search="'+esc((r.name+' '+r.code+' '+r.email+' '+r.department+' '+r.branch).toLowerCase())+'"><input type="checkbox" value="'+esc(r.id)+'" data-phfc-notify-person-check><span><strong>'+esc(r.name)+'</strong><small>'+esc(r.code)+' · '+esc(r.department)+' · '+esc(r.branch)+'</small></span></label>';}).join('');
    return '<section class="phfc-notify-admin" data-phfc-notify-workspace>'+ 
      '<section class="phfc-notify-summary">'+
        '<article class="phfc-card"><span>Tổng thông báo</span><strong data-phfc-notify-total>0</strong><small>Thông báo đã lưu và đã gửi</small></article>'+ 
        '<article class="phfc-card"><span>Đang hiển thị</span><strong data-phfc-notify-active>0</strong><small>Trong PHF Classroom</small></article>'+ 
        '<article class="phfc-card"><span>Bản nháp</span><strong data-phfc-notify-draft-count>0</strong><small>Chưa gửi đến người nhận</small></article>'+ 
        '<article class="phfc-card"><span>Tỷ lệ đã xem</span><strong data-phfc-notify-read-rate>—</strong><small>Tính theo từng người nhận</small></article>'+ 
      '</section>'+ 
      '<section class="phfc-card phfc-notify-toolbar"><div><h3>Quản trị thông báo</h3><p>Thông báo chỉ hiển thị sau khi người dùng đăng nhập vào hệ thống.</p></div><button class="phfc-primary-button" type="button" data-phfc-notify-create>+ Tạo thông báo</button></section>'+ 
      '<section class="phfc-card phfc-notify-form" data-phfc-notify-form hidden>'+ 
        '<div class="phfc-notify-form-head"><div><small>THÔNG BÁO MỚI</small><h3>Soạn thông báo Classroom</h3><p>Danh sách người nhận sẽ được chốt tại thời điểm gửi để bảo toàn lịch sử.</p></div><button type="button" class="phfc-icon-button" data-phfc-notify-close aria-label="Đóng">×</button></div>'+ 
        '<div class="phfc-notify-grid">'+ 
          '<label class="phfc-field phfc-field-wide"><span>Tiêu đề thông báo <b class="phfc-required">*</b></span><input type="text" maxlength="160" placeholder="Ví dụ: Lịch đào tạo kỹ năng bán hàng tháng 7" data-phfc-notify-title></label>'+ 
          '<label class="phfc-field phfc-field-wide"><span>Nội dung <b class="phfc-required">*</b></span><textarea rows="5" placeholder="Nhập nội dung ngắn gọn, rõ việc cần người nhận thực hiện" data-phfc-notify-content></textarea></label>'+ 
          '<label class="phfc-field"><span>Mức độ</span><select data-phfc-notify-level><option value="normal">Thông thường</option><option value="important">Quan trọng</option><option value="urgent">Khẩn</option></select></label>'+ 
          '<label class="phfc-field"><span>Phạm vi gửi</span><select data-phfc-notify-scope><option value="all">Toàn hệ thống (Public)</option><option value="class">Theo lớp đào tạo</option><option value="branch">Theo chi nhánh</option><option value="department">Theo phòng ban</option><option value="role">Theo vai trò</option><option value="selected">Chọn nhân sự</option></select></label>'+ 
          '<label class="phfc-field" data-phfc-notify-filter="class" hidden><span>Lớp đào tạo</span><select disabled><option>Chưa có dữ liệu lớp</option></select></label>'+ 
          '<label class="phfc-field" data-phfc-notify-filter="branch" hidden><span>Chi nhánh</span><select data-phfc-notify-branch>'+options(branches,'Chọn chi nhánh')+'</select></label>'+ 
          '<label class="phfc-field" data-phfc-notify-filter="department" hidden><span>Phòng ban</span><select data-phfc-notify-department>'+options(departments,'Chọn phòng ban')+'</select></label>'+ 
          '<label class="phfc-field" data-phfc-notify-filter="role" hidden><span>Vai trò</span><select data-phfc-notify-role>'+options(roles,'Chọn vai trò')+'</select></label>'+ 
          '<label class="phfc-field"><span>Bắt đầu hiển thị</span><input type="datetime-local" data-phfc-notify-start></label>'+ 
          '<label class="phfc-field"><span>Kết thúc hiển thị</span><input type="datetime-local" data-phfc-notify-end></label>'+ 
          '<label class="phfc-field phfc-field-wide"><span>Đường dẫn khi bấm (không bắt buộc)</span><input type="text" placeholder="Ví dụ: /hv/classroom/lich" data-phfc-notify-link></label>'+ 
        '</div>'+ 
        '<section class="phfc-notify-recipient-box">'+ 
          '<div class="phfc-notify-recipient-head"><div><small>NGƯỜI NHẬN DỰ KIẾN</small><strong data-phfc-notify-recipient-summary>Toàn hệ thống · '+recipients.length+' tài khoản đang hoạt động</strong></div><button type="button" class="phfc-secondary-button" data-phfc-notify-preview>Xem danh sách</button></div>'+ 
          '<p data-phfc-notify-recipient-note>Chỉ tài khoản đang hoạt động và đã đăng nhập hợp lệ mới nhìn thấy thông báo. Người chưa đăng nhập không nhận dữ liệu.</p>'+ 
          '<div class="phfc-notify-person-picker" data-phfc-notify-person-picker hidden><label><span>Tìm nhân sự</span><input type="search" placeholder="Tên, mã nhân viên, email..." data-phfc-notify-search></label><div class="phfc-notify-person-list">'+(recipientRows||'<p class="phfc-muted">Chưa tải được danh sách tài khoản.</p>')+'</div></div>'+ 
        '</section>'+ 
        '<div class="phfc-notify-actions"><div class="phfc-notify-safe-note"><strong>Thông báo nội bộ PHF Classroom</strong><span>Lưu nháp để chuẩn bị; Gửi thông báo để phát hành đến đúng người nhận.</span></div><button class="phfc-secondary-button" type="button" data-phfc-notify-draft>Lưu bản nháp</button><button class="phfc-primary-button" type="button" data-phfc-notify-send>Gửi thông báo</button></div>'+ 
      '</section>'+ 
      '<section class="phfc-card phfc-notify-list">'+ 
        '<div class="phfc-notify-list-head"><div><h3>Danh sách thông báo</h3><p>Theo dõi phạm vi gửi, người nhận và trạng thái đã xem.</p></div><div class="phfc-notify-filters"><select aria-label="Lọc trạng thái"><option>Tất cả trạng thái</option><option>Bản nháp</option><option>Đã lên lịch</option><option>Đang hiển thị</option><option>Đã kết thúc</option><option>Đã thu hồi</option></select><select aria-label="Lọc mức độ"><option>Tất cả mức độ</option><option>Thông thường</option><option>Quan trọng</option><option>Khẩn</option></select></div></div>'+ 
        '<div data-phfc-notify-list-body><div class="phfc-notify-empty"><span aria-hidden="true">🔔</span><strong>Chưa có thông báo Classroom</strong><p>Thông báo đã lưu hoặc đã gửi sẽ xuất hiện tại đây.</p></div></div>'+ 
      '</section>'+ 
      '<div class="phfc-notify-modal" data-phfc-notify-modal hidden><div class="phfc-notify-modal-backdrop" data-phfc-notify-modal-close></div><section class="phfc-card phfc-notify-modal-card" role="dialog" aria-modal="true" aria-label="Danh sách người nhận"><div class="phfc-notify-modal-head"><div><h3>Danh sách người nhận dự kiến</h3><p data-phfc-notify-modal-subtitle>Toàn hệ thống</p></div><button type="button" class="phfc-icon-button" data-phfc-notify-modal-close aria-label="Đóng">×</button></div><div class="phfc-notify-modal-stats"><strong data-phfc-notify-modal-count>'+recipients.length+'</strong><span>tài khoản dự kiến nhận</span></div><div class="phfc-notify-table-wrap"><table><thead><tr><th>Người nhận</th><th>Mã NV</th><th>Vai trò</th><th>Đơn vị</th><th>Trạng thái</th></tr></thead><tbody data-phfc-notify-modal-body></tbody></table></div></section></div>'+ 
    '</section>';
  }
  function adminKpis(){
    var items=[
      ['Tổng số lớp','all','Toàn bộ lớp Classroom'],
      ['Lớp sắp diễn ra','upcoming','Đã phát hành và chưa bắt đầu'],
      ['Lớp đang triển khai','progress','Đang trong thời gian đào tạo'],
      ['Lớp đã hoàn thành','completed','Đã kết thúc đào tạo'],
      ['Học viên đang tham gia','learners','Không tính trùng nhân sự']
    ];
    return '<section class="phfc-admin-kpis phfc-admin-kpis-five" aria-label="Số liệu nhanh">'+items.map(function(x,i){return '<button type="button" class="phfc-card phfc-admin-kpi phfc-admin-kpi-button" data-phfc-dashboard-kpi="'+x[1]+'"><span class="phfc-admin-kpi-icon" aria-hidden="true">'+(['▦','◷','▶','✓','♙'][i])+'</span><div><h4>'+esc(x[0])+'</h4><strong data-phfc-dashboard-count="'+x[1]+'">—</strong><p>'+esc(x[2])+'</p></div></button>';}).join('')+'</section>';
  }
  function adminOverview(){
    return '<section data-phfc-admin-dashboard>'+adminKpis()+
      '<section class="phfc-card phfc-dashboard-attendance"><div class="phfc-dashboard-section-head"><div><span>ĐIỀU HÀNH HÔM NAY</span><h3>Tình hình điểm danh</h3><p>Gom trạng thái điểm danh của tất cả lớp để Admin xử lý nhanh.</p></div><button type="button" class="phfc-secondary-button" data-phfc-route="/admin/classroom/diem-danh">Mở khu điểm danh</button></div>'+
        '<div class="phfc-dashboard-att-stats"><article><span>Chưa thực hiện</span><strong data-phfc-att-count="not_started">—</strong></article><article><span>Đã lưu tạm</span><strong data-phfc-att-count="draft">—</strong></article><article class="is-warning"><span>Quá hạn chưa chốt</span><strong data-phfc-att-count="overdue">—</strong></article><article><span>Đã chốt hôm nay</span><strong data-phfc-att-count="finalized_today">—</strong></article></div>'+
        '<div class="phfc-dashboard-att-filters" role="tablist" aria-label="Lọc tình hình điểm danh"><button type="button" class="active" data-phfc-att-filter="attention">Cần xử lý</button><button type="button" data-phfc-att-filter="not_started">Chưa thực hiện</button><button type="button" data-phfc-att-filter="draft">Đã lưu tạm</button><button type="button" data-phfc-att-filter="overdue">Quá hạn</button><button type="button" data-phfc-att-filter="finalized">Đã chốt</button></div>'+
        '<div class="phfc-dashboard-att-list" data-phfc-dashboard-att-list><div class="phfc-class-loading">Đang tổng hợp tình hình điểm danh…</div></div>'+
      '</section>'+
      '<section class="phfc-dashboard-grid"><article class="phfc-card phfc-dashboard-panel"><div class="phfc-panel-head"><div><h3>Lớp đào tạo gần đây</h3><p>Nhìn nhanh lớp mới tạo và lớp đang vận hành.</p></div><button type="button" data-phfc-route="/admin/classroom/lop">Xem tất cả</button></div><div data-phfc-dashboard-class-list><div class="phfc-class-loading">Đang tải lớp đào tạo…</div></div></article>'+
      '<article class="phfc-card phfc-dashboard-panel"><div class="phfc-panel-head"><div><h3>Lịch sắp tới</h3><p>Năm buổi đào tạo gần nhất.</p></div><button type="button" data-phfc-route="/admin/classroom/lich">Xem lịch đầy đủ</button></div><div data-phfc-dashboard-schedule><div class="phfc-class-loading">Đang tải lịch đào tạo…</div></div></article></section>'+
    '</section>';
  }
  function classListWorkspace(isAdmin){
    var createButton=isAdmin?'<button class="phfc-primary-button" type="button" data-phfc-route="/admin/classroom/lop/tao-moi"><span aria-hidden="true">＋</span>Tạo lớp đào tạo</button>':'';
    return '<section class="phfc-class-list-workspace" data-phfc-class-list>'+ 
      '<div class="phfc-class-list-toolbar"><div><h3>Danh sách lớp đào tạo</h3><p>Theo dõi lớp một buổi, khóa nhiều buổi, thời gian học và trạng thái vận hành.</p></div>'+createButton+'</div>'+ 
      '<section class="phfc-class-summary" aria-label="Tổng quan lớp đào tạo"><article><span>Tất cả lớp</span><strong data-phfc-count-all>—</strong></article><article><span>Đang diễn ra</span><strong data-phfc-count-progress>—</strong></article><article><span>Sắp bắt đầu</span><strong data-phfc-count-upcoming>—</strong></article><article><span>Đã hoàn thành</span><strong data-phfc-count-completed>—</strong></article></section>'+ 
      '<section class="phfc-card phfc-class-list-panel"><div class="phfc-class-filter-row"><label class="phfc-class-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Tìm theo tên hoặc mã lớp" aria-label="Tìm lớp đào tạo" data-phfc-class-search></label><select aria-label="Lọc loại lớp" data-phfc-class-type-filter><option value="">Tất cả loại lớp</option><option value="single">Lớp một buổi</option><option value="multi">Khóa nhiều buổi</option></select><select aria-label="Lọc hình thức" data-phfc-class-mode-filter><option value="">Tất cả hình thức</option><option value="online">Online – tự học</option><option value="offline">Trực tiếp</option><option value="hybrid">Kết hợp</option></select><select aria-label="Lọc trạng thái" data-phfc-class-status-filter><option value="">Tất cả trạng thái</option><option value="draft">Bản nháp</option><option value="published">Đã phát hành</option><option value="in_progress">Đang diễn ra</option><option value="completed">Đã hoàn thành</option><option value="cancelled">Đã hủy</option></select></div><div class="phfc-class-table-head" aria-hidden="true"><span>Lớp đào tạo</span><span>Loại lớp</span><span>Thời gian</span><span>Người phụ trách</span><span>Học viên</span><span>Trạng thái</span></div><div data-phfc-class-rows><div class="phfc-class-loading">Đang tải danh sách lớp đào tạo…</div></div></section>'+ 
    '</section>';
  }


  function createClassWorkspace(){
    return '<section class="phfc-create-class" data-phfc-create-class>'+ 
      '<div class="phfc-create-head"><div class="phfc-create-title-block"><button class="phfc-back-link" type="button" data-phfc-route="/admin/classroom/lop"><span aria-hidden="true">←</span> Danh sách lớp</button><h2>Tạo lớp đào tạo</h2><p>Thiết lập thông tin và cấu trúc khóa học.</p></div><div class="phfc-draft-state"><span class="phfc-draft-dot" aria-hidden="true"></span><span>Bản nháp chưa lưu</span></div></div>'+ 
      '<ol class="phfc-create-steps" aria-label="Các bước tạo lớp">'+
        '<li class="is-active" data-phfc-step-indicator="1" aria-current="step"><b>1</b><span>Thông tin lớp</span></li><li data-phfc-step-indicator="2"><b>2</b><span>Lịch và buổi học</span></li><li data-phfc-step-indicator="3"><b>3</b><span>Người tham gia</span></li><li data-phfc-step-indicator="4"><b>4</b><span>Nội dung & đánh giá</span></li><li data-phfc-step-indicator="5"><b>5</b><span>Kiểm tra lại</span></li>'+ 
      '</ol>'+ 
      '<div class="phfc-create-stage" data-phfc-create-stage="1">'+
        '<div class="phfc-create-grid">'+
          '<section class="phfc-card phfc-form-card"><div class="phfc-form-card-head"><div><span class="phfc-form-index">01</span><h4>Thông tin chung</h4></div><small>Các trường có dấu * là bắt buộc</small></div>'+ 
            '<div class="phfc-form-grid">'+
              '<label class="phfc-field"><span>Tên lớp đào tạo <b class="phfc-required">*</b></span><input type="text" placeholder="Ví dụ: Kỹ năng tư vấn khách hàng" data-phfc-class-name><small class="phfc-field-error" data-phfc-class-name-error hidden>Vui lòng nhập tên lớp đào tạo.</small></label>'+ 
              '<label class="phfc-field"><span>Mã lớp <b class="phfc-required">*</b></span><input type="text" placeholder="Ví dụ: PHF-CSKH-01" data-phfc-class-code><small class="phfc-field-error" data-phfc-class-code-error hidden>Vui lòng nhập mã lớp.</small></label>'+ 
              '<label class="phfc-field phfc-field-wide"><span>Mục tiêu đào tạo</span><textarea rows="3" placeholder="Mô tả ngắn mục tiêu và kết quả mong đợi" data-phfc-class-description></textarea></label>'+ 
              '<label class="phfc-field"><span>Mục đích đào tạo <b class="phfc-required">*</b></span><select data-phfc-training-purpose><option value="">Chọn mục đích</option><option value="new_employee">Đào tạo mới</option><option value="supplementary">Đào tạo bổ sung</option><option value="retraining">Tái đào tạo</option><option value="periodic">Đào tạo định kỳ</option><option value="advanced">Nâng cao nghiệp vụ</option><option value="management_request">Theo yêu cầu quản lý</option></select></label>'+ 
              '<label class="phfc-field"><span>Số lượng tối đa</span><input type="number" min="1" placeholder="Không giới hạn" data-phfc-capacity></label>'+ 
            '</div>'+ 
          '</section>'+ 
          '<section class="phfc-card phfc-form-card"><div class="phfc-form-card-head"><div><span class="phfc-form-index">02</span><h4>Loại lớp</h4></div><small>Chọn cấu trúc phù hợp với khóa đào tạo</small></div>'+ 
            '<div class="phfc-class-type-options" role="radiogroup" aria-label="Loại lớp đào tạo">'+
              '<label class="phfc-type-option is-selected"><input type="radio" name="phfc-class-type" value="single" checked><span class="phfc-type-icon">1</span><span class="phfc-type-copy"><strong>Lớp một buổi</strong><small>Một lịch học, một lần điểm danh và một kết quả hoàn thành.</small></span><span class="phfc-type-check" aria-hidden="true">✓</span></label>'+ 
              '<label class="phfc-type-option"><input type="radio" name="phfc-class-type" value="multi"><span class="phfc-type-icon">≡</span><span class="phfc-type-copy"><strong>Khóa nhiều buổi</strong><small>Theo dõi từng buổi, điểm danh và tiến trình của từng học viên.</small></span><span class="phfc-type-check" aria-hidden="true">✓</span></label>'+ 
            '</div>'+ 
          '</section>'+ 
        '</div>'+ 
      '</div>'+ 
      '<div class="phfc-create-stage" data-phfc-create-stage="2" hidden>'+ 
        '<section class="phfc-card phfc-form-card phfc-schedule-card"><div class="phfc-form-card-head"><div><span class="phfc-form-index">03</span><h4>Lịch và buổi học</h4></div><small data-phfc-schedule-note>Thiết lập một buổi học</small></div>'+ 
          '<div class="phfc-form-grid" data-phfc-single-schedule>'+ 
            '<label class="phfc-field"><span>Ngày học <b class="phfc-required">*</b></span><input type="date" data-phfc-single-date></label><label class="phfc-field"><span>Hình thức <b class="phfc-required">*</b></span><select data-phfc-mode><option value="offline">Trực tiếp</option><option value="online">Online – tự học</option></select></label>'+ 
            '<label class="phfc-field"><span>Giờ bắt đầu <b class="phfc-required">*</b></span><input type="time" data-phfc-single-start></label><label class="phfc-field"><span>Giờ kết thúc <b class="phfc-required">*</b></span><input type="time" data-phfc-single-end></label>'+ 
            '<label class="phfc-field phfc-field-wide" data-phfc-location><span>Địa điểm học</span><input type="text" data-phfc-single-location placeholder="Ví dụ: Phòng họp Phú Lợi"></label>'+ 
            '<div class="phfc-attendance-note phfc-field-wide" data-phfc-online-content-note hidden><strong>Nội dung tự học:</strong><span>Tài liệu, video, bài đọc hoặc đường dẫn ngoài sẽ được gắn tại bước Nội dung & đánh giá.</span></div>'+ 
            '<div class="phfc-attendance-note phfc-field-wide"><strong>Điểm danh:</strong><span>Buổi trực tiếp do Admin hoặc người được phân quyền tick trên hệ thống.</span></div>'+ 
          '</div>'+ 
          '<div class="phfc-multi-schedule" data-phfc-multi-schedule hidden>'+ 
            '<div class="phfc-course-window"><label class="phfc-field"><span>Khóa mở từ <b class="phfc-required">*</b></span><input type="datetime-local" data-phfc-course-start></label><label class="phfc-field"><span>Tự khóa lúc <b class="phfc-required">*</b></span><input type="datetime-local" data-phfc-course-end></label><div class="phfc-window-note">Hết hạn, hệ thống tự khóa nội dung mới nhưng vẫn giữ lịch sử và kết quả.</div></div>'+ 
            '<div class="phfc-session-toolbar"><div><strong>Các buổi học</strong><span>Mỗi buổi có lịch, hình thức và cách điểm danh riêng.</span></div><button class="phfc-add-session" type="button" data-phfc-add-session>＋ Thêm buổi học</button></div>'+ 
            '<div class="phfc-session-list" data-phfc-session-list></div>'+ 
          '</div>'+ 
        '</section>'+ 
      '</div>'+ 
      '<div class="phfc-create-stage" data-phfc-create-stage="3" hidden>'+ 
        '<div class="phfc-participant-layout">'+
          '<section class="phfc-card phfc-form-card phfc-participant-card"><div class="phfc-form-card-head"><div><span class="phfc-form-index">04</span><h4>Người phụ trách</h4></div><small>Thiết lập vai trò vận hành lớp</small></div>'+ 
            '<div class="phfc-participant-note"><strong>Nguyên tắc:</strong><span>Một người có thể là người phụ trách ở lớp này và là học viên ở lớp khác.</span></div>'+ 
            '<div class="phfc-role-stack">'+
              '<article class="phfc-role-row"><div><strong>Người phụ trách chính <b class="phfc-required">*</b></strong><span>Đầu mối theo dõi và phối hợp lớp đào tạo.</span></div><div class="phfc-user-choice"><input type="hidden" data-phfc-assignment="owner"><button type="button" class="phfc-user-picker-button" data-phfc-assignment-picker="owner"><span data-phfc-assignment-label="owner">Chọn người phụ trách chính</span><b>Chọn</b></button></div></article>'+ 
              '<article class="phfc-role-row"><div><strong>Giảng viên / hướng dẫn</strong><span>Người trực tiếp hướng dẫn nội dung đào tạo.</span></div><div class="phfc-user-choice"><input type="hidden" data-phfc-assignment="instructor"><button type="button" class="phfc-user-picker-button" data-phfc-assignment-picker="instructor"><span data-phfc-assignment-label="instructor">Chọn giảng viên / hướng dẫn</span><b>Chọn</b></button></div></article>'+ 
              '<article class="phfc-role-row"><div><strong>Người điểm danh</strong><span>Áp dụng cho các buổi học trực tiếp.</span></div><div class="phfc-user-choice"><input type="hidden" data-phfc-assignment="attendance_officer"><button type="button" class="phfc-user-picker-button" data-phfc-assignment-picker="attendance_officer"><span data-phfc-assignment-label="attendance_officer">Chọn người điểm danh</span><b>Chọn</b></button></div></article>'+ 
            '</div>'+ 
          '</section>'+ 
          '<section class="phfc-card phfc-form-card phfc-participant-card phfc-learner-picker"><div class="phfc-form-card-head"><div><span class="phfc-form-index">05</span><h4>Học viên</h4></div><small><span data-phfc-selected-count>0</span> người đã chọn</small></div>'+ 
            '<div class="phfc-participant-note phfc-participant-note-green"><strong>Đối tượng:</strong><span>Quản lý, nhân viên mới và nhân viên hiện hữu đều có thể được chọn làm học viên. Tài khoản Admin HR hệ thống không thuộc danh sách học.</span></div>'+ 
            '<div class="phfc-learner-methods" role="tablist" aria-label="Cách thêm học viên">'+
              '<button type="button" class="is-active" role="tab" aria-selected="true" data-phfc-learner-tab="system">Chọn từ hệ thống</button>'+ 
              '<button type="button" role="tab" aria-selected="false" data-phfc-learner-tab="upload">Tải danh sách lên</button>'+ 
            '</div>'+ 
            '<div data-phfc-learner-panel="system">'+
              '<div class="phfc-participant-filters" aria-label="Bộ lọc học viên">'+
                '<label class="phfc-participant-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Tìm theo tên hoặc mã nhân viên" aria-label="Tìm học viên" disabled></label>'+ 
                '<select aria-label="Lọc chi nhánh" disabled><option>Tất cả chi nhánh</option></select>'+ 
                '<select aria-label="Lọc phòng ban" disabled><option>Tất cả phòng ban</option></select>'+ 
                '<select aria-label="Lọc vị trí" disabled><option>Tất cả vị trí</option></select>'+ 
              '</div>'+ 
              '<div class="phfc-participant-empty"><div class="phfc-participant-empty-icon" aria-hidden="true">◎</div><strong>Chưa có học viên được chọn</strong><p>Danh sách nhân sự sẽ được sử dụng để tìm, lọc và chọn nhiều học viên khi kết nối dữ liệu lớp.</p></div>'+ 
            '</div>'+ 
            '<div class="phfc-upload-panel" data-phfc-learner-panel="upload" hidden>'+ 
              '<div class="phfc-upload-head"><div><strong>Tải danh sách học viên</strong><span>File chỉ dùng để đối chiếu tài khoản có sẵn; hệ thống không tạo mới hoặc sửa hồ sơ nhân sự.</span></div><a class="phfc-template-link" href="assets/templates/mau_hoc_vien_classroom.csv" download>↓ Tải file mẫu</a></div>'+ 
              '<label class="phfc-upload-drop"><input type="file" accept=".csv,text/csv" data-phfc-learner-file><span class="phfc-upload-icon" aria-hidden="true">⇧</span><strong>Chọn file danh sách</strong><small>CSV UTF-8, có 3 cột: Mã nhân viên, Họ và tên, Email. Có thể mở và lưu bằng Excel.</small></label>'+ 
              '<div class="phfc-upload-rules"><strong>Kiểm tra an toàn trước khi thêm:</strong><span>đúng định dạng · khớp mã/email hệ thống · không trùng · tài khoản còn hoạt động · loại tài khoản Admin HR</span></div>'+ 
              '<div class="phfc-import-result" data-phfc-import-result hidden>'+ 
                '<div class="phfc-import-summary"><div><b data-phfc-import-total>0</b><span>Tổng dòng</span></div><div class="is-valid"><b data-phfc-import-valid>0</b><span>Hợp lệ</span></div><div class="is-warning"><b data-phfc-import-warning>0</b><span>Cần xem</span></div><div class="is-error"><b data-phfc-import-error>0</b><span>Không hợp lệ</span></div></div>'+ 
                '<div class="phfc-import-table-wrap"><table class="phfc-import-table"><thead><tr><th>Dòng</th><th>Mã nhân viên</th><th>Họ tên trong file</th><th>Đối chiếu hệ thống</th><th>Kết quả</th></tr></thead><tbody data-phfc-import-body></tbody></table></div>'+ 
                '<div class="phfc-import-actions"><button type="button" class="phfc-secondary-button" data-phfc-import-clear>Xóa kết quả</button><button type="button" class="phfc-primary-button" data-phfc-import-add aria-disabled="true">Thêm người hợp lệ</button></div>'+ 
              '</div>'+ 
              '<div class="phfc-selected-learners" data-phfc-selected-list hidden><div class="phfc-selected-head"><strong>Học viên đã chọn</strong><span data-phfc-selected-note></span></div><div data-phfc-selected-rows></div></div>'+ 
            '</div>'+ 
          '</section>'+ 
        '</div>'+ 
      '</div>'+ 
      '<div class="phfc-create-stage" data-phfc-create-stage="4" hidden>'+ 
        '<div class="phfc-content-layout">'+
          '<section class="phfc-card phfc-form-card phfc-content-card"><div class="phfc-form-card-head"><div><span class="phfc-form-index">06</span><h4>Nội dung đào tạo</h4></div><small>Gắn nội dung dùng cho toàn khóa hoặc từng buổi</small></div>'+ 
            '<div class="phfc-content-note"><strong>Online – tự học:</strong><span>Học viên mở nội dung trên hệ thống sẽ được ghi nhận đã tham gia. Hoàn thành được xác định riêng theo nội dung bắt buộc.</span></div>'+ 
            '<div class="phfc-scope-choice" role="radiogroup" aria-label="Phạm vi nội dung">'+
              '<label class="is-selected"><input type="radio" name="phfc-content-scope" value="course" checked><span><strong>Dùng chung cho toàn khóa</strong><small>Tài liệu áp dụng cho tất cả học viên và các buổi.</small></span><b aria-hidden="true">✓</b></label>'+ 
              '<label><input type="radio" name="phfc-content-scope" value="session"><span><strong>Gắn theo từng buổi</strong><small>Chọn nội dung riêng cho mỗi buổi học.</small></span><b aria-hidden="true">✓</b></label>'+ 
            '</div>'+ 
            '<div class="phfc-content-tools">'+
              '<button type="button" data-phfc-content-tool="library"><span aria-hidden="true">▤</span><strong>Chọn từ thư viện</strong><small>Dùng tài liệu đã có trong Classroom</small></button>'+ 
              '<button type="button" data-phfc-content-tool="upload"><span aria-hidden="true">⇧</span><strong>Tải tài liệu mới</strong><small>File sẽ được kiểm tra trước khi gắn</small></button>'+ 
              '<button type="button" data-phfc-content-tool="link"><span aria-hidden="true">↗</span><strong>Thêm đường dẫn</strong><small>Video, bài đọc hoặc trang web bên ngoài</small></button>'+ 
              '<button type="button" data-phfc-content-tool="instruction"><span aria-hidden="true">✎</span><strong>Thêm hướng dẫn học</strong><small>Yêu cầu và thứ tự học ngắn gọn</small></button>'+ 
            '</div>'+ 
            '<div class="phfc-content-selection" data-phfc-content-selection><div aria-hidden="true">◎</div><strong>Chưa gắn nội dung đào tạo</strong><p>Tài liệu thật sẽ được chọn từ thư viện hoặc tải lên khi kết nối dữ liệu Classroom.</p></div>'+ 
          '</section>'+ 
          '<section class="phfc-card phfc-form-card phfc-assessment-card"><div class="phfc-form-card-head"><div><span class="phfc-form-index">07</span><h4>Đánh giá và hoàn thành</h4></div><small>Chọn yêu cầu phù hợp với lớp</small></div>'+ 
            '<fieldset class="phfc-assessment-options"><legend>Hình thức đánh giá</legend>'+ 
              '<label><input type="checkbox" value="ack"><span><strong>Xác nhận đã học</strong><small>Học viên bấm xác nhận sau khi xem đủ nội dung.</small></span></label>'+ 
              '<label><input type="checkbox" value="session-test"><span><strong>Bài kiểm tra theo buổi</strong><small>Gắn bài kiểm tra cho một hoặc nhiều buổi.</small></span></label>'+ 
              '<label><input type="checkbox" value="final-test"><span><strong>Bài kiểm tra cuối khóa</strong><small>Đánh giá kết quả sau khi hoàn thành nội dung.</small></span></label>'+ 
              '<label><input type="checkbox" value="manager-confirm"><span><strong>Người phụ trách xác nhận</strong><small>Dùng cho nội dung thực hành hoặc đào tạo trực tiếp.</small></span></label>'+ 
            '</fieldset>'+ 
            '<section class="phfc-create-test-link"><div><strong>Bài kiểm tra gắn với lớp</strong><small>Chọn đề có sẵn hoặc mở khu Bài kiểm tra để tạo đề mới. Khi lưu lớp, đề được tự động gắn với lớp.</small></div><div class="phfc-create-test-controls"><select data-phfc-class-test-select><option value="">Chưa chọn bài kiểm tra</option></select><button type="button" class="phfc-secondary-button" data-phfc-refresh-tests>Làm mới</button><button type="button" class="phfc-primary-button" data-phfc-create-test-new>Tạo bài mới</button></div></section>'+ 
            '<div class="phfc-completion-rule"><div><strong>Điều kiện hoàn thành</strong><span>Chưa áp dụng quy tắc bắt buộc ở bước giao diện nền.</span></div><button type="button" data-phfc-rule-placeholder aria-disabled="true">Thiết lập điều kiện</button></div>'+ 
            '<div class="phfc-assessment-note"><strong>Nguyên tắc:</strong><span>Điểm danh, tiến trình và kết quả đào tạo được lưu riêng; không gộp thành một trạng thái duy nhất.</span></div>'+ 
          '</section>'+ 
        '</div>'+ 
      '</div>'+ 
      '<div class="phfc-create-stage" data-phfc-create-stage="5" hidden>'+ 
        '<section class="phfc-review-shell" data-phfc-review-shell>'+ 
          '<div class="phfc-review-head"><div><span class="phfc-form-index">08</span><div><h4>Kiểm tra lại thông tin lớp</h4><p>Xem lại toàn bộ nội dung đã thiết lập trước khi tạo lớp.</p></div></div><span class="phfc-review-status">Sẵn sàng lưu bản nháp</span></div>'+ 
          '<div class="phfc-review-alerts" data-phfc-review-alerts></div>'+ 
          '<div class="phfc-review-grid">'+ 
            '<article class="phfc-card phfc-review-card"><div class="phfc-review-card-head"><h5>Thông tin lớp</h5><button type="button" data-phfc-review-edit="1">Chỉnh sửa</button></div><dl data-phfc-review-general></dl></article>'+ 
            '<article class="phfc-card phfc-review-card"><div class="phfc-review-card-head"><h5>Lịch và buổi học</h5><button type="button" data-phfc-review-edit="2">Chỉnh sửa</button></div><div data-phfc-review-schedule></div></article>'+ 
            '<article class="phfc-card phfc-review-card"><div class="phfc-review-card-head"><h5>Người tham gia</h5><button type="button" data-phfc-review-edit="3">Chỉnh sửa</button></div><div data-phfc-review-participants></div></article>'+ 
            '<article class="phfc-card phfc-review-card"><div class="phfc-review-card-head"><h5>Nội dung và đánh giá</h5><button type="button" data-phfc-review-edit="4">Chỉnh sửa</button></div><div data-phfc-review-content></div></article>'+ 
          '</div>'+ 
          '<div class="phfc-review-footnote"><strong>Lưu ý:</strong><span>Kiểm tra kỹ thông tin trước khi lưu bản nháp. Lớp nháp chỉ Admin nhìn thấy; học viên chỉ thấy sau khi phát hành.</span></div>'+ 
        '</section>'+ 
      '</div>'+ 
      '<section class="phfc-create-preview"><div><strong>Tóm tắt lớp</strong><span data-phfc-create-summary>Lớp một buổi · Chưa nhập tên lớp</span></div><div class="phfc-create-actions"><button class="phfc-secondary-button" type="button" data-phfc-create-back>Hủy</button><button class="phfc-primary-button" type="button" data-phfc-create-next>Tiếp tục</button></div></section>'+ 
    '</section>';
  }
  function managerOverview(){
    return '<section class="phfc-hero phfc-hero-light"><div><span class="phfc-eyebrow">PHF Classroom · Quản lý</span><h3>Theo dõi và đề xuất đào tạo cho bộ phận</h3><p>Các lớp liên quan, lịch học và đề xuất đào tạo sẽ được tổng hợp tại đây.</p></div><div class="phfc-hero-stats"><div class="phfc-hero-stat"><b>—</b><span>Lớp đang theo dõi</span></div><div class="phfc-hero-stat"><b>—</b><span>Đề xuất đã gửi</span></div><div class="phfc-hero-stat"><b>—</b><span>Lịch sắp tới</span></div></div></section>'+emptyState('Chưa có dữ liệu Classroom','Dữ liệu lớp và đề xuất đào tạo sẽ xuất hiện sau khi hoàn thiện nghiệp vụ.');
  }
  function learnerOverview(){
    return '<section class="phfc-hero phfc-hero-light"><div><span class="phfc-eyebrow">Lớp đào tạo của tôi</span><h3>Chào '+esc(name())+'</h3><p>Các lớp được phân công, lịch học, bài kiểm tra và kết quả cá nhân sẽ hiển thị tại đây.</p></div><div class="phfc-hero-stats"><div class="phfc-hero-stat"><b>—</b><span>Lớp sắp tới</span></div><div class="phfc-hero-stat"><b>—</b><span>Chưa hoàn thành</span></div><div class="phfc-hero-stat"><b>—</b><span>Đã hoàn thành</span></div></div></section>'+emptyState('Chưa có lớp đào tạo','Khi được phân công, lớp đào tạo của bạn sẽ xuất hiện tại đây.');
  }
  function pageMeta(path){
    path=cleanPath(path);
    var map={
      '/admin/classroom':['Tổng quan Classroom','Quản lý hoạt động đào tạo nội bộ trong một không gian thống nhất.'],
      '/admin/classroom/lop':['Lớp đào tạo','Quản lý danh sách lớp và mở chi tiết từng lớp đào tạo.'],
      '/admin/classroom/lich':['Lịch đào tạo','Theo dõi lịch học và các buổi đào tạo theo thời gian.'],
      '/admin/classroom/tai-lieu':['Tài liệu đào tạo','Quản lý thư viện tài liệu đào tạo tập trung.'],
      '/admin/classroom/hoc-vien':['Người dùng Classroom','Theo dõi nhân sự đang học, phụ trách và tham gia vận hành các lớp đào tạo.'],
      '/admin/classroom/diem-danh':['Điểm danh','Theo dõi tình trạng tham gia theo từng buổi học.'],
      '/admin/classroom/bai-kiem-tra':['Bài kiểm tra','Quản lý bài kiểm tra và kỳ đánh giá trong Classroom.'],
      '/admin/classroom/ket-qua':['Kết quả đào tạo','Theo dõi tiến trình và kết quả đào tạo của học viên.'],
      '/admin/classroom/de-xuat':['Đề xuất đào tạo','Tiếp nhận và theo dõi nhu cầu đào tạo từ các bộ phận.'],
      '/admin/classroom/bao-cao':['Báo cáo','Tổng hợp hoạt động và kết quả đào tạo Classroom.'],
      '/admin/classroom/thong-bao':['Thông báo','Quản lý thông báo dành riêng cho PHF Classroom.'],
      '/ql/classroom/thong-bao':['Thông báo','Tạo và theo dõi thông báo vận hành PHF Classroom.'],
      '/admin/classroom/cau-hinh':['Cấu hình Classroom','Thiết lập danh mục và quy tắc vận hành Classroom.'],
      '/ql/classroom':['Tổng quan Classroom','Theo dõi hoạt động đào tạo trong toàn hệ thống Classroom.'],
      '/ql/classroom/lop':['Lớp đào tạo','Xem danh sách và thông tin các lớp đào tạo.'],
      '/ql/classroom/lich':['Lịch đào tạo','Theo dõi lịch học và các buổi đào tạo theo thời gian.'],
      '/ql/classroom/tai-lieu':['Tài liệu đào tạo','Xem thư viện tài liệu đào tạo được công bố.'],
      '/ql/classroom/hoc-vien':['Người dùng Classroom','Theo dõi nhân sự đang học, phụ trách và tham gia vận hành các lớp đào tạo.'],
      '/ql/classroom/diem-danh':['Điểm danh','Theo dõi tình trạng tham gia theo từng buổi học.'],
      '/ql/classroom/bai-kiem-tra':['Bài kiểm tra','Xem các bài kiểm tra và kỳ đánh giá trong Classroom.'],
      '/ql/classroom/ket-qua':['Kết quả đào tạo','Theo dõi tiến trình và kết quả đào tạo của học viên.'],
      '/ql/classroom/de-xuat':['Đề xuất đào tạo','Gửi và theo dõi đề xuất đào tạo.'],
      '/ql/classroom/bao-cao':['Báo cáo','Xem tổng hợp hoạt động và kết quả đào tạo Classroom.'],
      '/hv/classroom':['Lớp đào tạo của tôi','Theo dõi các lớp được phân công và nội dung học của bạn.'],
      '/hv/classroom/lich':['Lịch học của tôi','Theo dõi lịch các buổi đào tạo được phân công.'],
      '/hv/classroom/tai-lieu':['Tài liệu đào tạo','Xem tài liệu đào tạo được công bố cho bạn.'],
      '/hv/classroom/bai-kiem-tra':['Bài kiểm tra của tôi','Theo dõi các bài kiểm tra được giao trong Classroom.'],
      '/hv/classroom/ket-qua':['Kết quả của tôi','Xem tiến trình và kết quả đào tạo cá nhân.'],
      '/hv/classroom/de-xuat':['Đề xuất đào tạo','Gửi và theo dõi đề xuất đào tạo của bạn.']
    };
    if(path==='/admin/classroom/lop/tao-moi') return ['Tạo lớp đào tạo','Thiết lập lớp một buổi hoặc khóa nhiều buổi.'];
    if(/^\/(?:admin|ql)\/classroom\/lop\/[^/]+$/.test(path)) return ['Chi tiết lớp đào tạo','Theo dõi thông tin, lịch học và thành viên của lớp đào tạo.'];
    if(/^\/hv\/classroom\/lop\/[^/]+$/.test(path)) return ['Chi tiết lớp đào tạo','Xem nội dung, lịch học và tiến trình của lớp được phân công.'];
    return map[path]||map[homePath()];
  }
  function adminEmptyFor(path){
    var map={
      '/admin/classroom/lop':['Chưa có lớp đào tạo','Các lớp được tạo sẽ hiển thị tại đây.'],
      '/admin/classroom/lich':['Chưa có lịch đào tạo','Các buổi đào tạo được xếp lịch sẽ hiển thị tại đây.'],
      '/admin/classroom/tai-lieu':['Chưa có tài liệu đào tạo','Tài liệu được công bố sẽ hiển thị tại thư viện này.'],
      '/admin/classroom/hoc-vien':['Chưa có học viên trong Classroom','Học viên được phân công vào lớp sẽ hiển thị tại đây.'],
      '/admin/classroom/nguoi-phu-trach':['Chưa có người phụ trách','Người phụ trách được chỉ định cho lớp sẽ hiển thị tại đây.'],
      '/admin/classroom/diem-danh':['Chưa có dữ liệu điểm danh','Dữ liệu tham gia theo từng buổi học sẽ hiển thị tại đây.'],
      '/admin/classroom/bai-kiem-tra':['Chưa có bài kiểm tra','Bài kiểm tra được tạo cho lớp sẽ hiển thị tại đây.'],
      '/admin/classroom/ket-qua':['Chưa có kết quả đào tạo','Kết quả của học viên sẽ hiển thị khi có dữ liệu lớp.'],
      '/admin/classroom/de-xuat':['Chưa có đề xuất đào tạo','Đề xuất từ các bộ phận sẽ hiển thị tại đây.'],
      '/admin/classroom/bao-cao':['Chưa có dữ liệu báo cáo','Báo cáo sẽ tổng hợp từ hoạt động đào tạo thực tế.'],
      '/admin/classroom/thong-bao':['Chưa có thông báo Classroom','Thông báo về lớp học, lịch đào tạo và kết quả sẽ được quản lý tại đây.'],
      '/admin/classroom/cau-hinh':['Chưa có thiết lập Classroom','Các danh mục và quy tắc Classroom sẽ hiển thị tại đây.']
    };
    if(/^\/admin\/classroom\/lop\/[^/]+$/.test(path)) return ['Chưa có thông tin lớp','Thông tin chi tiết của lớp sẽ hiển thị tại đây.'];
    var managerMap={
      '/ql/classroom/lop':['Chưa có lớp đào tạo','Các lớp đào tạo sẽ hiển thị tại đây.'],
      '/ql/classroom/lich':['Chưa có lịch đào tạo','Các buổi đào tạo được xếp lịch sẽ hiển thị tại đây.'],
      '/ql/classroom/tai-lieu':['Chưa có tài liệu đào tạo','Tài liệu được công bố sẽ hiển thị tại thư viện này.'],
      '/ql/classroom/hoc-vien':['Chưa có học viên trong Classroom','Học viên được phân công vào lớp sẽ hiển thị tại đây.'],
      '/ql/classroom/nguoi-phu-trach':['Chưa có người phụ trách','Người phụ trách được chỉ định cho lớp sẽ hiển thị tại đây.'],
      '/ql/classroom/diem-danh':['Chưa có dữ liệu điểm danh','Dữ liệu tham gia theo từng buổi học sẽ hiển thị tại đây.'],
      '/ql/classroom/bai-kiem-tra':['Chưa có bài kiểm tra','Bài kiểm tra của Classroom sẽ hiển thị tại đây.'],
      '/ql/classroom/ket-qua':['Chưa có kết quả đào tạo','Kết quả của học viên sẽ hiển thị khi có dữ liệu lớp.'],
      '/ql/classroom/de-xuat':['Chưa có đề xuất đào tạo','Đề xuất đào tạo sẽ hiển thị tại đây.'],
      '/ql/classroom/bao-cao':['Chưa có dữ liệu báo cáo','Báo cáo sẽ tổng hợp từ hoạt động đào tạo thực tế.']
    };
    if(/^\/ql\/classroom\/lop\/[^/]+$/.test(path)) return ['Chưa có thông tin lớp','Thông tin chi tiết của lớp sẽ hiển thị tại đây.'];
    var learnerMap={
      '/hv/classroom/lich':['Chưa có lịch học','Lịch các buổi đào tạo được phân công sẽ hiển thị tại đây.'],
      '/hv/classroom/tai-lieu':['Chưa có tài liệu đào tạo','Tài liệu được công bố cho bạn sẽ hiển thị tại đây.'],
      '/hv/classroom/bai-kiem-tra':['Chưa có bài kiểm tra','Bài kiểm tra được giao cho bạn sẽ hiển thị tại đây.'],
      '/hv/classroom/ket-qua':['Chưa có kết quả đào tạo','Kết quả và tiến trình đào tạo của bạn sẽ hiển thị tại đây.']
    };
    if(/^\/hv\/classroom\/lop\/[^/]+$/.test(path)) return ['Chưa có thông tin lớp','Thông tin lớp được phân công sẽ hiển thị tại đây.'];
    return map[path]||managerMap[path]||learnerMap[path]||['Chưa có dữ liệu','Nội dung sẽ hiển thị khi có dữ liệu phù hợp.'];
  }
  function classDetailWorkspace(path){
    var classId=path.split('/').pop();
    return '<section class="phfc-class-detail" data-phfc-class-detail="'+esc(classId)+'"><div class="phfc-class-loading">Đang tải thông tin lớp đào tạo…</div></section>';
  }
  function phfcUserScopeLabel(value){return norm(value)==='phf_class'?'Chỉ PHF Classroom':'Training Hub + PHF Classroom';}
  function phfcAssignmentRoleLabel(value){return {owner:'Phụ trách chính',instructor:'Giảng viên / hướng dẫn',attendance_officer:'Người điểm danh',grader:'Người chấm',coordinator:'Điều phối',observer:'Theo dõi'}[value]||value||'Người phụ trách';}
  function phfcUserWorkspace(){
    return '<section class="phfc-users-workspace" data-phfc-users-workspace>'+ 
      '<section class="phfc-users-kpis">'+
        '<article><span>Tài khoản Classroom</span><strong data-phfc-users-total>—</strong><small>Dùng chung từ Training Hub</small></article>'+ 
        '<article><span>Đang tham gia lớp</span><strong data-phfc-users-enrolled>—</strong><small>Có ít nhất một lớp</small></article>'+ 
        '<article><span>Đang phụ trách</span><strong data-phfc-users-assigned>—</strong><small>Có vai trò vận hành lớp</small></article>'+ 
        '<article><span>Chỉ PHF Classroom</span><strong data-phfc-users-class-only>—</strong><small>Không thuộc lộ trình Hub</small></article>'+ 
      '</section>'+ 
      '<section class="phfc-card phfc-users-panel">'+
        '<div class="phfc-users-toolbar">'+
          '<label class="phfc-users-search"><strong>Tìm người dùng</strong><input type="search" placeholder="Tên, mã nhân viên, email, phòng ban..." data-phfc-users-search></label>'+ 
          '<label><strong>Phạm vi đào tạo</strong><select data-phfc-users-scope><option value="">Tất cả phạm vi</option><option value="new_sales">Training Hub + PHF Classroom</option><option value="phf_class">Chỉ PHF Classroom</option></select></label>'+ 
          '<label><strong>Vai trò trong lớp</strong><select data-phfc-users-usage><option value="">Tất cả người dùng</option><option value="learner">Đang tham gia lớp</option><option value="assigned">Đang phụ trách lớp</option><option value="unused">Chưa tham gia lớp</option></select></label>'+ 
        '</div>'+ 
        '<div class="phfc-users-source-note"><strong>Nguồn dữ liệu:</strong><span>Tài khoản và hồ sơ nhân sự dùng chung từ PHF Training Hub. Classroom không tạo user riêng.</span></div>'+ 
        '<div class="phfc-users-table-head" aria-hidden="true"><span>Người dùng</span><span>Phạm vi</span><span>Lớp tham gia</span><span>Vai trò phụ trách</span><span>Trạng thái</span><span></span></div>'+ 
        '<div data-phfc-users-rows><div class="phfc-user-loading">Đang tải người dùng Classroom…</div></div>'+ 
      '</section>'+ 
      '<div class="phfc-user-detail-overlay" data-phfc-user-detail hidden><section class="phfc-user-detail-modal" role="dialog" aria-modal="true" aria-label="Hồ sơ người dùng Classroom"><div data-phfc-user-detail-body></div></section></div>'+ 
    '</section>';
  }
  function phfcUserKey(row){return String((row&&row.accountId)||'')||String((row&&row.employeeId)||'');}
  function phfcBuildUserUsage(users,classes){
    var map={};(users||[]).forEach(function(u){var k=phfcUserKey(u);if(k)map[k]={user:u,enrollments:[],assignments:[]};});
    function find(item){var aid=String(item&&item.accountId||''),eid=String(item&&item.employeeId||'');var key=aid&&map[aid]?aid:'';if(!key&&eid){Object.keys(map).some(function(k){if(String(map[k].user.employeeId||'')===eid){key=k;return true;}return false;});}return key?map[key]:null;}
    (classes||[]).forEach(function(c){(c.enrollments||[]).forEach(function(x){var target=find(x);if(target)target.enrollments.push({classId:c.id,classCode:c.classCode,className:c.className,status:c.status,enrollmentStatus:x.status,required:x.required});});(c.assignments||[]).forEach(function(x){var target=find(x);if(target)target.assignments.push({classId:c.id,classCode:c.classCode,className:c.className,status:c.status,assignmentRole:x.assignmentRole,assignmentStatus:x.status});});});
    return Object.keys(map).map(function(k){return map[k];});
  }
  function phfcUserRowsHtml(rows){
    if(!rows.length)return '<div class="phfc-users-empty"><strong>Không có người dùng phù hợp</strong><span>Hãy đổi từ khóa hoặc bộ lọc.</span></div>';
    return rows.map(function(row){var u=row.user,roles=[];row.assignments.forEach(function(a){var label=phfcAssignmentRoleLabel(a.assignmentRole);if(roles.indexOf(label)<0)roles.push(label);});return '<button type="button" class="phfc-users-row" data-phfc-user-key="'+esc(phfcUserKey(u))+'"><span class="phfc-users-person"><b class="phfc-users-avatar">'+esc(phfcInitials(u.fullName,u.email))+'</b><span><strong>'+esc(u.fullName||u.email||'Nhân sự')+'</strong><small>'+esc((u.employeeCode||'Chưa có mã')+(u.position?' · '+u.position:'')+(u.department?' · '+u.department:''))+'</small><em>'+esc(u.email||u.phone||'')+'</em></span></span><span><b class="phfc-scope-chip is-'+esc(norm(u.defaultProgram))+'">'+esc(phfcUserScopeLabel(u.defaultProgram))+'</b></span><span><strong>'+row.enrollments.length+'</strong><small>'+esc(row.enrollments.length?'lớp':'Chưa tham gia')+'</small></span><span><strong>'+row.assignments.length+'</strong><small>'+esc(roles.slice(0,2).join(', ')||'Chưa phân công')+'</small></span><span><b class="phfc-account-status is-active">Đang hoạt động</b></span><span class="phfc-users-open">Xem hồ sơ →</span></button>';}).join('');
  }
  function phfcUserDetailHtml(row){var u=row.user;var enrolled=row.enrollments.map(function(x){return '<li><span><strong>'+esc(x.className)+'</strong><small>'+esc(x.classCode)+' · '+esc(classStatusLabel(x.status))+'</small></span><b>'+esc(x.required?'Bắt buộc':'Tự nguyện')+'</b></li>';}).join('');var assigned=row.assignments.map(function(x){return '<li><span><strong>'+esc(x.className)+'</strong><small>'+esc(x.classCode)+' · '+esc(classStatusLabel(x.status))+'</small></span><b>'+esc(phfcAssignmentRoleLabel(x.assignmentRole))+'</b></li>';}).join('');return '<div class="phfc-user-detail-head"><div class="phfc-users-person"><b class="phfc-users-avatar is-large">'+esc(phfcInitials(u.fullName,u.email))+'</b><span><small>'+esc(u.employeeCode||'Chưa có mã nhân viên')+'</small><h3>'+esc(u.fullName||u.email||'Nhân sự')+'</h3><p>'+esc([u.position,u.department,u.branch].filter(Boolean).join(' · ')||'Chưa có thông tin đơn vị')+'</p></span></div><button type="button" data-phfc-user-detail-close aria-label="Đóng">×</button></div><div class="phfc-user-detail-meta"><article><span>Email</span><strong>'+esc(u.email||'Chưa có')+'</strong></article><article><span>Số điện thoại</span><strong>'+esc(u.phone||'Chưa có')+'</strong></article><article><span>Phạm vi đào tạo</span><strong>'+esc(phfcUserScopeLabel(u.defaultProgram))+'</strong></article><article><span>Trạng thái tài khoản</span><strong>Đang hoạt động</strong></article></div><div class="phfc-user-detail-grid"><section><h4>Lớp đang tham gia</h4>'+(enrolled?'<ul>'+enrolled+'</ul>':'<p>Chưa được phân công vào lớp nào.</p>')+'</section><section><h4>Vai trò phụ trách</h4>'+(assigned?'<ul>'+assigned+'</ul>':'<p>Chưa được giao vai trò phụ trách lớp.</p>')+'</section></div><div class="phfc-user-detail-foot"><small>Thông tin cá nhân được quản lý tại PHF Training Hub. Classroom chỉ theo dõi liên kết lớp và vai trò đào tạo.</small><button type="button" class="phfc-primary-button" data-phfc-user-detail-close>Đóng</button></div>';
  }

  function phfcDateLabel(value){
    if(!value)return 'Chưa có ngày';
    var d=new Date(String(value).length===10?value+'T00:00:00':value);
    if(Number.isNaN(d.getTime()))return value;
    return d.toLocaleDateString('vi-VN',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'});
  }
  function phfcDateTime(value){
    if(!value)return 'Chưa có thời gian';
    var d=value instanceof Date?value:new Date(value);
    if(Number.isNaN(d.getTime()))return String(value);
    return d.toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',second:'2-digit',day:'2-digit',month:'2-digit',year:'numeric'});
  }
  function phfcScheduleStatus(session){
    if(norm(session&&session.status)==='cancelled')return {key:'cancelled',label:'Đã hủy'};
    var start=new Date((session.sessionDate||'')+'T'+(session.startTime||'00:00')+':00'),end=new Date((session.sessionDate||'')+'T'+(session.endTime||'23:59')+':00'),now=new Date();
    if(!Number.isNaN(start.getTime())&&now<start)return {key:'upcoming',label:'Sắp diễn ra'};
    if(!Number.isNaN(start.getTime())&&!Number.isNaN(end.getTime())&&now>=start&&now<=end)return {key:'ongoing',label:'Đang diễn ra'};
    if(!Number.isNaN(end.getTime())&&now>end)return {key:'completed',label:'Đã hoàn thành'};
    return {key:'scheduled',label:'Đã xếp lịch'};
  }
  function phfcScheduleWorkspace(){
    var canEdit=role()==='admin';
    return '<section class="phfc-schedule-workspace" data-phfc-schedule-workspace>'+ 
      '<div class="phfc-schedule-commandbar">'+
        '<div class="phfc-calendar-nav"><button type="button" class="phfc-icon-button" data-phfc-calendar-prev aria-label="Kỳ trước">‹</button><button type="button" class="phfc-secondary-button phfc-today-button" data-phfc-calendar-today>Hôm nay</button><button type="button" class="phfc-icon-button" data-phfc-calendar-next aria-label="Kỳ sau">›</button></div>'+ 
        '<strong class="phfc-calendar-period-title" data-phfc-calendar-title></strong>'+ 
        '<div class="phfc-schedule-command-actions"><div class="phfc-view-switch" role="group" aria-label="Chế độ xem lịch"><button type="button" data-phfc-calendar-view="month" class="is-active">Tháng</button><button type="button" data-phfc-calendar-view="week">Tuần</button><button type="button" data-phfc-calendar-view="list">Danh sách</button></div>'+(canEdit?'<button type="button" class="phfc-primary-button" data-phfc-schedule-add>＋ Thêm buổi học</button>':'')+'</div>'+ 
      '</div>'+ 
      '<section class="phfc-schedule-kpis"><article><span>Tổng buổi</span><strong data-phfc-schedule-total>0</strong></article><article><span>Sắp diễn ra</span><strong data-phfc-schedule-upcoming>0</strong></article><article><span>Đang diễn ra</span><strong data-phfc-schedule-ongoing>0</strong></article><article><span>Đã hoàn thành</span><strong data-phfc-schedule-completed>0</strong></article></section>'+ 
      '<section class="phfc-card phfc-schedule-panel"><div class="phfc-schedule-filters"><label><strong>Tìm lịch</strong><input type="search" placeholder="Tên lớp, mã lớp, địa điểm..." data-phfc-schedule-search></label><label><strong>Trạng thái</strong><select data-phfc-schedule-status><option value="">Tất cả trạng thái</option><option value="upcoming">Sắp diễn ra</option><option value="ongoing">Đang diễn ra</option><option value="completed">Đã hoàn thành</option><option value="cancelled">Đã hủy</option></select></label><label class="phfc-list-only-filter"><strong>Từ ngày</strong><input type="date" data-phfc-schedule-from></label><label class="phfc-list-only-filter"><strong>Đến ngày</strong><input type="date" data-phfc-schedule-to></label></div><div data-phfc-schedule-rows><div class="phfc-class-loading">Đang tải lịch đào tạo…</div></div></section>'+ 
      '<div class="phfc-session-detail-overlay" data-phfc-session-detail hidden><section class="phfc-session-detail-modal" role="dialog" aria-modal="true"><div data-phfc-session-detail-body></div></section></div>'+ 
    '</section>';
  }
  function phfcOpenDateTimePicker(options){
    options=options||{};
    var kind=options.kind||'time',value=String(options.value||''),date='',time='';
    if(kind==='date')date=value;
    else if(kind==='time')time=value;
    else{var parts=value.split('T');date=parts[0]||'';time=(parts[1]||'').slice(0,5);}
    var now=new Date(),dateParts=(date||phfcIsoDate(now)).split('-');
    var year=Number(dateParts[0]||now.getFullYear()),month=Number(dateParts[1]||now.getMonth()+1),day=Number(dateParts[2]||now.getDate());
    var tp=(time||'08:00').split(':'),hour=String(tp[0]||'08').padStart(2,'0'),minute=String(tp[1]||'00').padStart(2,'0');
    var hours=Array.from({length:24},function(_,i){var x=String(i).padStart(2,'0');return '<option value="'+x+'" '+(x===hour?'selected':'')+'>'+x+'</option>';}).join('');
    var minutes=['00','05','10','15','20','25','30','35','40','45','50','55'];if(minutes.indexOf(minute)<0)minutes.push(minute);minutes.sort();
    var minuteOptions=minutes.map(function(x){return '<option value="'+x+'" '+(x===minute?'selected':'')+'>'+x+'</option>';}).join('');
    var years=Array.from({length:11},function(_,i){return now.getFullYear()-2+i;}).map(function(x){return '<option value="'+x+'" '+(x===year?'selected':'')+'>'+x+'</option>';}).join('');
    var months=Array.from({length:12},function(_,i){var x=i+1;return '<option value="'+x+'" '+(x===month?'selected':'')+'>Tháng '+String(x).padStart(2,'0')+'</option>';}).join('');
    function dayOptions(y,m,selected){var count=new Date(y,m,0).getDate(),out='';for(var i=1;i<=count;i++)out+='<option value="'+i+'" '+(i===selected?'selected':'')+'>'+String(i).padStart(2,'0')+'</option>';return out;}
    var description=kind==='date'?'Chọn ngày theo định dạng ngày, tháng, năm.':(kind==='time'?'Dùng định dạng 24 giờ, sau đó bấm Xác nhận.':'Chọn ngày và giờ theo định dạng 24 giờ.');
    var dateMarkup=kind==='time'?'':'<div class="phfc-date-control"><strong>Ngày <b class="phfc-required">*</b></strong><div class="phfc-date-columns"><label><span>Ngày</span><select data-phfc-datetime-day>'+dayOptions(year,month,day)+'</select></label><label><span>Tháng</span><select data-phfc-datetime-month>'+months+'</select></label><label><span>Năm</span><select data-phfc-datetime-year>'+years+'</select></label></div><small>Định dạng hiển thị: ngày/tháng/năm</small></div>';
    var timeMarkup=kind==='date'?'':'<div class="phfc-time-control"><strong>Thời gian <b class="phfc-required">*</b></strong><div class="phfc-time-columns"><label><span>Giờ</span><select data-phfc-datetime-hour>'+hours+'</select></label><span class="phfc-time-separator" aria-hidden="true">:</span><label><span>Phút</span><select data-phfc-datetime-minute>'+minuteOptions+'</select></label></div><small>Chuẩn 24 giờ: 00:00 đến 23:59</small></div>';
    var overlay=document.createElement('div');
    overlay.className='phfc-datetime-overlay';
    overlay.innerHTML='<section class="phfc-datetime-modal" role="dialog" aria-modal="true"><div class="phfc-datetime-head"><div><h3>'+esc(options.title||'Chọn thời gian')+'</h3><p>'+esc(description)+'</p></div><button type="button" data-phfc-datetime-close aria-label="Đóng">×</button></div><div class="phfc-datetime-body">'+dateMarkup+timeMarkup+'</div><div class="phfc-datetime-actions"><button type="button" class="phfc-secondary-button" data-phfc-datetime-cancel>Hủy</button><button type="button" class="phfc-primary-button" data-phfc-datetime-confirm>Xác nhận</button></div></section>';
    document.body.appendChild(overlay);document.documentElement.classList.add('phfc-modal-lock');
    function close(){overlay.remove();document.documentElement.classList.remove('phfc-modal-lock');}
    function refreshDays(){var y=Number((overlay.querySelector('[data-phfc-datetime-year]')||{}).value||year),m=Number((overlay.querySelector('[data-phfc-datetime-month]')||{}).value||month),daySelect=overlay.querySelector('[data-phfc-datetime-day]');if(!daySelect)return;var selected=Math.min(Number(daySelect.value||1),new Date(y,m,0).getDate());daySelect.innerHTML=dayOptions(y,m,selected);}
    var monthSelect=overlay.querySelector('[data-phfc-datetime-month]'),yearSelect=overlay.querySelector('[data-phfc-datetime-year]');if(monthSelect)monthSelect.addEventListener('change',refreshDays);if(yearSelect)yearSelect.addEventListener('change',refreshDays);
    overlay.querySelector('[data-phfc-datetime-close]').addEventListener('click',close);overlay.querySelector('[data-phfc-datetime-cancel]').addEventListener('click',close);overlay.addEventListener('click',function(e){if(e.target===overlay)close();});
    overlay.querySelector('[data-phfc-datetime-confirm]').addEventListener('click',function(){
      var d='';
      if(kind!=='time'){
        var yy=String((overlay.querySelector('[data-phfc-datetime-year]')||{}).value||''),mm=String((overlay.querySelector('[data-phfc-datetime-month]')||{}).value||'').padStart(2,'0'),dd=String((overlay.querySelector('[data-phfc-datetime-day]')||{}).value||'').padStart(2,'0');
        d=yy&&mm&&dd?yy+'-'+mm+'-'+dd:'';
      }
      var h=(overlay.querySelector('[data-phfc-datetime-hour]')||{}).value||'',m=(overlay.querySelector('[data-phfc-datetime-minute]')||{}).value||'',t=h&&m?h+':'+m:'';
      if((kind!=='time'&&!d)||(kind!=='date'&&!t)){phfcNotice('error','Chưa đủ thời gian','Vui lòng chọn đầy đủ ngày và giờ.');return;}
      var result=kind==='date'?d:(kind==='time'?t:d+'T'+t);if(typeof options.onConfirm==='function')options.onConfirm(result);close();
    });
  }
  function phfcEnhanceDateTimeInputs(scope){
    (scope||document).querySelectorAll('input[type="date"],input[type="time"],input[type="datetime-local"]').forEach(function(input){if(input.dataset.phfcEnhanced==='1')return;input.dataset.phfcEnhanced='1';input.classList.add('phfc-enhanced-time-input');input.addEventListener('click',function(ev){ev.preventDefault();var kind=input.type==='datetime-local'?'datetime':input.type;phfcOpenDateTimePicker({kind:kind,value:input.value,title:kind==='date'?'Chọn ngày':(kind==='time'?'Chọn giờ':'Chọn ngày và giờ'),onConfirm:function(v){input.value=v;input.dispatchEvent(new Event('change',{bubbles:true}));input.dispatchEvent(new Event('input',{bubbles:true}));}});});});
  }
  function phfcSessionModal(classRow,session,onSaved){
    var editing=!!session;session=session||{};var overlay=document.createElement('div');overlay.className='phfc-session-modal-overlay';overlay.innerHTML='<section class="phfc-session-modal" role="dialog" aria-modal="true"><div class="phfc-user-picker-head"><div><h3>'+(editing?'Chỉnh sửa buổi học':'Thêm buổi học')+'</h3><p>'+esc(classRow.className||'Lớp đào tạo')+'</p></div><button type="button" data-phfc-session-close aria-label="Đóng">×</button></div><div class="phfc-session-form"><label class="phfc-field phfc-field-wide"><span>Tên buổi học <b class="phfc-required">*</b></span><input type="text" data-phfc-session-edit-name value="'+esc(session.sessionName||'')+'"></label><label class="phfc-field"><span>Ngày học <b class="phfc-required">*</b></span><input type="date" data-phfc-session-edit-date value="'+esc(session.sessionDate||'')+'"></label><label class="phfc-field"><span>Hình thức <b class="phfc-required">*</b></span><select data-phfc-session-edit-mode><option value="offline">Trực tiếp</option><option value="online">Online – tự học</option><option value="hybrid">Kết hợp</option></select></label><label class="phfc-field"><span>Giờ bắt đầu <b class="phfc-required">*</b></span><input type="time" data-phfc-session-edit-start value="'+esc(session.startTime||'')+'"></label><label class="phfc-field"><span>Giờ kết thúc <b class="phfc-required">*</b></span><input type="time" data-phfc-session-edit-end value="'+esc(session.endTime||'')+'"></label><label class="phfc-field phfc-field-wide"><span>Địa điểm học</span><input type="text" data-phfc-session-edit-location value="'+esc(session.location||'')+'" placeholder="Ví dụ: Phòng họp Phú Lợi"></label></div><div class="phfc-user-picker-foot"><button type="button" class="phfc-secondary-button" data-phfc-session-cancel>Đóng</button><button type="button" class="phfc-primary-button" data-phfc-session-save>Lưu buổi học</button></div></section>';
    document.body.appendChild(overlay);document.documentElement.classList.add('phfc-modal-lock');var mode=overlay.querySelector('[data-phfc-session-edit-mode]');mode.value=session.deliveryMode||'offline';phfcEnhanceDateTimeInputs(overlay);
    function close(){overlay.remove();document.documentElement.classList.remove('phfc-modal-lock');}
    overlay.querySelector('[data-phfc-session-close]').addEventListener('click',close);overlay.querySelector('[data-phfc-session-cancel]').addEventListener('click',close);overlay.addEventListener('click',function(e){if(e.target===overlay)close();});
    overlay.querySelector('[data-phfc-session-save]').addEventListener('click',async function(){var btn=this,name=(overlay.querySelector('[data-phfc-session-edit-name]')||{}).value.trim(),date=(overlay.querySelector('[data-phfc-session-edit-date]')||{}).value,start=(overlay.querySelector('[data-phfc-session-edit-start]')||{}).value,end=(overlay.querySelector('[data-phfc-session-edit-end]')||{}).value;if(!name||!date||!start||!end){phfcNotice('error','Chưa đủ thông tin','Vui lòng nhập tên buổi, ngày và giờ học.');return;}if(end<=start){phfcNotice('error','Giờ học chưa hợp lệ','Giờ kết thúc phải sau giờ bắt đầu.');return;}var item={id:session.id||'',sessionName:name,sessionDate:date,startTime:start,endTime:end,deliveryMode:mode.value,location:(overlay.querySelector('[data-phfc-session-edit-location]')||{}).value.trim(),attendanceRequired:true,status:session.status||'scheduled'};var list=(classRow.sessions||[]).slice(),idx=list.findIndex(function(x){return x.id&&x.id===item.id;});if(idx>=0)list[idx]=item;else list.push(item);list.sort(function(a,b){return String(a.sessionDate+a.startTime).localeCompare(String(b.sessionDate+b.startTime));});classRow.sessions=list;classRow.startAt=list.length?list[0].sessionDate+'T'+list[0].startTime+':00':classRow.startAt;classRow.endAt=list.length?list[list.length-1].sessionDate+'T'+list[list.length-1].endTime+':00':classRow.endAt;try{btn.disabled=true;btn.textContent='Đang lưu…';var saved=await saveClassroomClass(classRow,'saveDraft');phfcNotice('success','Đã lưu buổi học','Lịch đào tạo đã được cập nhật.');close();if(typeof onSaved==='function')onSaved(saved);}catch(error){phfcNotice('error','Chưa thể lưu buổi học',error.message||String(error));}finally{btn.disabled=false;btn.textContent='Lưu buổi học';}});
  }
  function phfcIsoDate(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  function phfcStartOfWeek(d){var x=new Date(d.getFullYear(),d.getMonth(),d.getDate()),day=(x.getDay()+6)%7;x.setDate(x.getDate()-day);return x;}
  function phfcSessionDetailHtml(row){var s=row.session,c=row.classRow,owner=(c.assignments||[]).find(function(x){return norm(x.assignmentRole)==='owner';});return '<div class="phfc-session-detail-head"><div><small>'+esc(c.classCode||'PHF Classroom')+'</small><h3>'+esc(s.sessionName||c.className)+'</h3><p>'+esc(c.className||'')+'</p></div><button type="button" data-phfc-session-detail-close aria-label="Đóng">×</button></div><div class="phfc-session-detail-grid"><article><span>Thời gian</span><strong>'+esc(phfcDateLabel(s.sessionDate))+'</strong><small>'+esc((s.startTime||'—')+' – '+(s.endTime||'—'))+'</small></article><article><span>Hình thức</span><strong>'+esc(deliveryLabel(s.deliveryMode))+'</strong><small>'+esc(s.location||'Chưa cập nhật địa điểm')+'</small></article><article><span>Người phụ trách</span><strong>'+esc((owner&&(owner.employeeName||owner.fullName||owner.employeeCode))||'Theo phân công của lớp')+'</strong></article><article><span>Học viên</span><strong>'+esc(String((c.enrollments||[]).length))+' người</strong></article></div><div class="phfc-session-detail-status"><span class="phfc-schedule-state is-'+esc(row.status.key)+'">'+esc(row.status.label)+'</span></div><div class="phfc-session-detail-actions">'+(role()==='admin'?'<button type="button" class="phfc-danger-button" data-phfc-session-delete>Xóa buổi</button>':'')+'<button type="button" class="phfc-secondary-button" data-phfc-session-detail-close>Đóng</button><button type="button" class="phfc-primary-button" data-phfc-session-open-class>Xem lớp</button></div>';
  }
  function phfcMonthGridHtml(rows,cursor){var year=cursor.getFullYear(),month=cursor.getMonth(),first=new Date(year,month,1),start=new Date(first);start.setDate(1-((first.getDay()+6)%7));var today=phfcIsoDate(new Date()),html='<div class="phfc-calendar-weekdays"><span>Thứ 2</span><span>Thứ 3</span><span>Thứ 4</span><span>Thứ 5</span><span>Thứ 6</span><span>Thứ 7</span><span>Chủ nhật</span></div><div class="phfc-calendar-month-grid">';for(var i=0;i<42;i++){var d=new Date(start);d.setDate(start.getDate()+i);var iso=phfcIsoDate(d),dayRows=rows.filter(function(x){return x.session.sessionDate===iso;}),outside=d.getMonth()!==month;html+='<article class="phfc-calendar-day '+(outside?'is-outside ':'')+(iso===today?'is-today':'')+'"><header><b>'+d.getDate()+'</b>'+(iso===today?'<small>Hôm nay</small>':'')+'</header><div class="phfc-calendar-events">'+dayRows.slice(0,3).map(function(x){return '<button type="button" class="phfc-calendar-event is-'+esc(x.status.key)+'" data-phfc-session-key="'+esc(x.classRow.id+'|'+(x.session.id||x.session.sessionDate+x.session.startTime))+'"><time>'+esc(x.session.startTime||'—')+'</time><span>'+esc(x.session.sessionName||x.classRow.className)+'</span></button>';}).join('')+(dayRows.length>3?'<button type="button" class="phfc-calendar-more" data-phfc-calendar-day="'+iso+'">＋ '+(dayRows.length-3)+' buổi khác</button>':'')+'</div></article>'; }return html+'</div>';}
  function phfcWeekGridHtml(rows,cursor){var start=phfcStartOfWeek(cursor),today=phfcIsoDate(new Date()),html='<div class="phfc-calendar-week-grid">';for(var i=0;i<7;i++){var d=new Date(start);d.setDate(start.getDate()+i);var iso=phfcIsoDate(d),dayRows=rows.filter(function(x){return x.session.sessionDate===iso;});html+='<section class="phfc-calendar-week-day '+(iso===today?'is-today':'')+'"><header><span>'+d.toLocaleDateString('vi-VN',{weekday:'short'})+'</span><b>'+d.getDate()+'/'+(d.getMonth()+1)+'</b></header><div>'+ (dayRows.length?dayRows.map(function(x){return '<button type="button" class="phfc-week-event is-'+esc(x.status.key)+'" data-phfc-session-key="'+esc(x.classRow.id+'|'+(x.session.id||x.session.sessionDate+x.session.startTime))+'"><time>'+esc((x.session.startTime||'—')+'–'+(x.session.endTime||'—'))+'</time><strong>'+esc(x.session.sessionName||x.classRow.className)+'</strong><small>'+esc(x.classRow.className)+'</small></button>';}).join(''):'<p>Không có lịch</p>')+'</div></section>'; }return html+'</div>';}
  async function hydrateSchedule(root){
    var workspace=root.querySelector('[data-phfc-schedule-workspace]');if(!workspace)return;var holder=workspace.querySelector('[data-phfc-schedule-rows]'),view='month',cursor=new Date();cursor.setHours(0,0,0,0);
    try{var classes=await loadClassroomClasses(false),rows=[];classes.forEach(function(c){(c.sessions||[]).forEach(function(s){rows.push({classRow:c,session:s,status:phfcScheduleStatus(s),key:c.id+'|'+(s.id||s.sessionDate+s.startTime)});});});rows.sort(function(a,b){return String(a.session.sessionDate+a.session.startTime).localeCompare(String(b.session.sessionDate+b.session.startTime));});
      function set(sel,val){var el=workspace.querySelector(sel);if(el)el.textContent=String(val);}set('[data-phfc-schedule-total]',rows.length);set('[data-phfc-schedule-upcoming]',rows.filter(function(x){return x.status.key==='upcoming';}).length);set('[data-phfc-schedule-ongoing]',rows.filter(function(x){return x.status.key==='ongoing';}).length);set('[data-phfc-schedule-completed]',rows.filter(function(x){return x.status.key==='completed';}).length);
      function filters(){var q=norm((workspace.querySelector('[data-phfc-schedule-search]')||{}).value),st=(workspace.querySelector('[data-phfc-schedule-status]')||{}).value,from=(workspace.querySelector('[data-phfc-schedule-from]')||{}).value,to=(workspace.querySelector('[data-phfc-schedule-to]')||{}).value;return rows.filter(function(x){var hay=[x.classRow.className,x.classRow.classCode,x.session.sessionName,x.session.location].join(' ');return (!q||norm(hay).indexOf(q)>=0)&&(!st||x.status.key===st)&&(!from||view!=='list'||x.session.sessionDate>=from)&&(!to||view!=='list'||x.session.sessionDate<=to);});}
      function title(){var el=workspace.querySelector('[data-phfc-calendar-title]');if(!el)return;if(view==='month')el.textContent='Tháng '+String(cursor.getMonth()+1).padStart(2,'0')+'/'+cursor.getFullYear();else if(view==='week'){var st=phfcStartOfWeek(cursor),en=new Date(st);en.setDate(st.getDate()+6);el.textContent=st.toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit'})+' – '+en.toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'});}else el.textContent='Danh sách buổi học';}
      function bindRows(filtered){holder.querySelectorAll('[data-phfc-session-key]').forEach(function(btn){btn.addEventListener('click',function(){var row=rows.find(function(x){return x.key===btn.getAttribute('data-phfc-session-key');});if(row)openDetail(row);});});holder.querySelectorAll('[data-phfc-session-edit]').forEach(function(btn){btn.addEventListener('click',function(){var c=classes.find(function(x){return x.id===btn.getAttribute('data-phfc-session-edit');}),s=c&&(c.sessions||[]).find(function(x){return x.id===btn.getAttribute('data-phfc-session-id');});if(c&&s)phfcSessionModal(c,s,function(){classroomCache.loaded=false;hydrateSchedule(root);});});});holder.querySelectorAll('[data-phfc-calendar-day]').forEach(function(btn){btn.addEventListener('click',function(){view='list';var d=btn.getAttribute('data-phfc-calendar-day'),f=workspace.querySelector('[data-phfc-schedule-from]'),t=workspace.querySelector('[data-phfc-schedule-to]');if(f)f.value=d;if(t)t.value=d;updateViewButtons();draw();});});}
      function openDetail(row){var overlay=workspace.querySelector('[data-phfc-session-detail]'),body=workspace.querySelector('[data-phfc-session-detail-body]');body.innerHTML=phfcSessionDetailHtml(row);overlay.hidden=false;document.documentElement.classList.add('phfc-modal-lock');function close(){overlay.hidden=true;document.documentElement.classList.remove('phfc-modal-lock');}body.querySelectorAll('[data-phfc-session-detail-close]').forEach(function(x){x.addEventListener('click',close);});body.querySelector('[data-phfc-session-open-class]').addEventListener('click',function(){close();navigate((role()==='admin'?'/admin':role()==='manager'?'/ql':'/hv')+'/classroom/lop/'+row.classRow.id);});var sd=body.querySelector('[data-phfc-session-delete]');if(sd)sd.onclick=async function(){try{await phfcSoftDelete('session',row.session.id,'buổi học',function(){close();classroomCache.loaded=false;hydrateSchedule(root);});}catch(e){phfcNotice('error','Chưa thể xóa buổi học',e.message||String(e));}};overlay.onclick=function(e){if(e.target===overlay)close();};}
      function updateViewButtons(){workspace.querySelectorAll('[data-phfc-calendar-view]').forEach(function(b){b.classList.toggle('is-active',b.getAttribute('data-phfc-calendar-view')===view);});workspace.querySelectorAll('.phfc-list-only-filter').forEach(function(x){x.hidden=view!=='list';});workspace.classList.toggle('is-list-view',view==='list');}
      function draw(){var filtered=filters();title();if(view==='month')holder.innerHTML=phfcMonthGridHtml(filtered,cursor);else if(view==='week')holder.innerHTML=phfcWeekGridHtml(filtered,cursor);else holder.innerHTML=filtered.length?filtered.map(function(x){var s=x.session,c=x.classRow;return '<article class="phfc-schedule-row" data-phfc-session-key="'+esc(x.key)+'"><div class="phfc-schedule-date"><b>'+esc((s.sessionDate||'').slice(8,10)||'--')+'</b><span>'+esc((s.sessionDate||'').slice(5,7)?'Tháng '+(s.sessionDate||'').slice(5,7):'Chưa có ngày')+'</span></div><div class="phfc-schedule-main"><small>'+esc(c.classCode||'')+'</small><strong>'+esc(s.sessionName||c.className)+'</strong><span>'+esc(c.className)+' · '+esc(s.startTime||'—')+'–'+esc(s.endTime||'—')+'</span><em>'+esc(deliveryLabel(s.deliveryMode))+(s.location?' · '+esc(s.location):'')+'</em></div><span class="phfc-schedule-state is-'+esc(x.status.key)+'">'+esc(x.status.label)+'</span><div class="phfc-schedule-actions"><button type="button" data-phfc-session-key="'+esc(x.key)+'">Chi tiết</button>'+(role()==='admin'?'<button type="button" data-phfc-session-edit="'+esc(c.id)+'" data-phfc-session-id="'+esc(s.id||'')+'">Chỉnh sửa</button>':'')+'</div></article>';}).join(''):'<div class="phfc-schedule-empty"><strong>Chưa có lịch phù hợp</strong><span>Điều chỉnh bộ lọc hoặc thêm buổi học mới.</span></div>';bindRows(filtered);}
      workspace.querySelectorAll('.phfc-schedule-filters input,.phfc-schedule-filters select').forEach(function(el){el.addEventListener(el.tagName==='SELECT'?'change':'input',draw);});workspace.querySelectorAll('[data-phfc-calendar-view]').forEach(function(btn){btn.addEventListener('click',function(){view=btn.getAttribute('data-phfc-calendar-view');updateViewButtons();draw();});});workspace.querySelector('[data-phfc-calendar-today]').addEventListener('click',function(){cursor=new Date();cursor.setHours(0,0,0,0);draw();});workspace.querySelector('[data-phfc-calendar-prev]').addEventListener('click',function(){if(view==='month')cursor.setMonth(cursor.getMonth()-1);else cursor.setDate(cursor.getDate()-7);draw();});workspace.querySelector('[data-phfc-calendar-next]').addEventListener('click',function(){if(view==='month')cursor.setMonth(cursor.getMonth()+1);else cursor.setDate(cursor.getDate()+7);draw();});phfcEnhanceDateTimeInputs(workspace);var add=workspace.querySelector('[data-phfc-schedule-add]');if(add)add.addEventListener('click',function(){if(!classes.length){phfcNotice('error','Chưa có lớp đào tạo','Hãy tạo lớp trước khi thêm buổi học.');return;}var options=classes.map(function(c){return '<option value="'+esc(c.id)+'">'+esc(c.classCode+' · '+c.className)+'</option>';}).join('');var chooser=document.createElement('div');chooser.className='phfc-session-modal-overlay';chooser.innerHTML='<section class="phfc-session-modal phfc-class-chooser"><div class="phfc-user-picker-head"><div><h3>Chọn lớp đào tạo</h3><p>Buổi học mới sẽ được thêm vào lớp đã chọn.</p></div><button type="button" data-close>×</button></div><label class="phfc-field"><span>Lớp đào tạo <b class="phfc-required">*</b></span><select data-class>'+options+'</select></label><div class="phfc-user-picker-foot"><button type="button" class="phfc-secondary-button" data-close>Đóng</button><button type="button" class="phfc-primary-button" data-next>Tiếp tục</button></div></section>';document.body.appendChild(chooser);document.documentElement.classList.add('phfc-modal-lock');function close(){chooser.remove();document.documentElement.classList.remove('phfc-modal-lock');}chooser.querySelectorAll('[data-close]').forEach(function(x){x.addEventListener('click',close);});chooser.querySelector('[data-next]').addEventListener('click',function(){var id=chooser.querySelector('[data-class]').value,c=classes.find(function(x){return x.id===id;});close();if(c)phfcSessionModal(c,null,function(){classroomCache.loaded=false;hydrateSchedule(root);});});});updateViewButtons();draw();
    }catch(error){holder.innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tải lịch đào tạo</strong><span>'+esc(error.message||String(error))+'</span><button type="button" data-retry>Thử lại</button></div>';var retry=holder.querySelector('[data-retry]');if(retry)retry.addEventListener('click',function(){classroomCache.loaded=false;hydrateSchedule(root);});}
  }

  function phfcAttendanceStatusLabel(value){return {present:'Có mặt',absent:'Vắng',excused:'Có phép',late:'Đi trễ',unmarked:'Chưa điểm danh'}[value]||'Chưa điểm danh';}
  function phfcAttendanceWorkspace(){
    return '<section class="phfc-attendance-workspace" data-phfc-attendance-workspace>'+ 
      '<section class="phfc-attendance-kpis">'+
        '<article><span>Tổng học viên</span><strong data-phfc-att-total>—</strong></article>'+ 
        '<article><span>Có mặt / Đi trễ</span><strong data-phfc-att-present>—</strong></article>'+ 
        '<article><span>Có phép / Vắng</span><strong data-phfc-att-absent>—</strong></article>'+ 
        '<article><span>Chưa điểm danh</span><strong data-phfc-att-unmarked>—</strong></article>'+ 
      '</section>'+ 
      '<section class="phfc-card phfc-attendance-panel">'+
        '<div class="phfc-attendance-mode-tabs" role="tablist">'+
          '<button type="button" class="active" data-phfc-att-mode="session">Điểm danh theo buổi</button>'+
          '<button type="button" data-phfc-att-mode="course">Tổng hợp toàn khóa</button>'+
        '</div>'+ 
        '<div class="phfc-attendance-toolbar">'+
          '<label class="phfc-field"><span>Lớp đào tạo <b class="phfc-required">*</b></span><select data-phfc-att-class><option value="">-- Chọn lớp đào tạo --</option></select></label>'+ 
          '<label class="phfc-field"><span>Buổi học <b class="phfc-required">*</b></span><select data-phfc-att-session disabled><option value="">-- Chọn buổi học --</option></select></label>'+ 
          '<label class="phfc-field"><span>Tìm học viên</span><input type="search" placeholder="Tên hoặc mã nhân viên" data-phfc-att-search></label>'+ 
        '</div>'+ 
        '<div class="phfc-attendance-session-summary" data-phfc-att-summary hidden></div><div class="phfc-attendance-history-bar" data-phfc-att-history-bar hidden><button type="button" class="phfc-secondary-button" data-phfc-att-history-open>Lịch sử chỉnh sửa</button></div>'+ 
        '<div class="phfc-attendance-bulk" data-phfc-att-bulk hidden>'+ 
          '<label class="phfc-att-select-all"><input type="checkbox" data-phfc-att-select-all><span>Chọn tất cả</span></label>'+ 
          '<div><button type="button" data-phfc-att-bulk-status="present">Có mặt</button><button type="button" data-phfc-att-bulk-status="late">Đi trễ</button><button type="button" data-phfc-att-bulk-status="excused">Có phép</button><button type="button" data-phfc-att-bulk-status="absent">Vắng</button><button type="button" data-phfc-att-bulk-status="unmarked">Xóa trạng thái</button></div>'+ 
        '</div>'+ 
        '<div class="phfc-attendance-table" data-phfc-att-rows><div class="phfc-class-loading">Chọn lớp và buổi học để bắt đầu điểm danh.</div></div>'+ 
        '<div class="phfc-attendance-lock-note" data-phfc-att-lock-note hidden></div><label class="phfc-field phfc-attendance-admin-reason" data-phfc-att-admin-reason-wrap hidden><span>Lý do Admin chỉnh sửa <b class="phfc-required">*</b></span><input type="text" data-phfc-att-admin-reason placeholder="Nhập lý do điều chỉnh sổ đã khóa"></label><div class="phfc-attendance-actions" data-phfc-att-actions hidden><button type="button" class="phfc-secondary-button" data-phfc-att-draft>Lưu tạm</button><button type="button" class="phfc-primary-button" data-phfc-att-finalize>Chốt điểm danh</button></div>'+ 
      '</section><div class="phfc-attendance-history-overlay" data-phfc-att-history-overlay hidden><section class="phfc-attendance-history-modal"><div class="phfc-user-picker-head"><div><h3>Lịch sử chỉnh sửa điểm danh</h3><p>Ghi nhận người thao tác, thời gian, lý do và nội dung thay đổi.</p></div><button type="button" data-phfc-att-history-close aria-label="Đóng">×</button></div><div class="phfc-attendance-history-list" data-phfc-att-history-list></div><div class="phfc-user-picker-foot"><button type="button" class="phfc-secondary-button" data-phfc-att-history-close>Đóng</button></div></section></div>'+
    '</section>';
  }
  async function phfcAttendanceApi(sessionId){
    var response=await fetch('/api/data?classroomAttendance=1&sessionId='+encodeURIComponent(sessionId),{credentials:'include',cache:'no-store',headers:{Accept:'application/json'}}),json=await response.json().catch(function(){return {};});
    if(!response.ok||json.ok===false)throw new Error(json.message||'Chưa thể tải dữ liệu điểm danh.');return json;
  }
  async function phfcSaveAttendance(payload){
    var response=await fetch('/api/data?classroomAttendance=1',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload)}),json=await response.json().catch(function(){return {};});
    if(!response.ok||json.ok===false)throw new Error(json.message||'Chưa thể lưu điểm danh.');return json;
  }
  function phfcAttendanceChoice(row,status,canManage){
    var labels={present:'Có mặt',late:'Đi trễ',excused:'Có phép',absent:'Vắng'};
    return '<label class="phfc-attendance-choice is-'+status+'" title="'+esc(labels[status])+'"><input type="radio" name="att-'+esc(row.enrollmentId)+'" value="'+status+'" data-phfc-att-status '+((row.status||'unmarked')===status?'checked ':'')+(canManage?'':'disabled ')+'><span aria-hidden="true"></span><b>'+esc(labels[status])+'</b></label>';
  }
  function phfcAttendanceRowsHtml(rows,canManage){
    if(!rows.length)return '<div class="phfc-schedule-empty"><strong>Chưa có học viên</strong><span>Buổi học này chưa có học viên được phân công.</span></div>';
    return '<div class="phfc-attendance-head"><span></span><span>STT</span><span>Mã NV</span><span>Họ tên</span><span>Có mặt</span><span>Đi trễ</span><span>Có phép</span><span>Vắng</span><span>Ghi chú</span></div>'+rows.map(function(row,index){var displayName=row.fullName||'Chưa cập nhật họ tên',code=row.employeeCode||'—';return '<article class="phfc-attendance-row" data-phfc-att-row data-enrollment-id="'+esc(row.enrollmentId||'')+'" data-employee-id="'+esc(row.employeeId||'')+'" data-account-id="'+esc(row.accountId||'')+'" data-attendance-id="'+esc(row.id||'')+'"><label class="phfc-attendance-select"><input type="checkbox" data-phfc-att-selected '+(canManage?'':'disabled')+'><span></span></label><span class="phfc-attendance-index">'+(index+1)+'</span><span class="phfc-attendance-code">'+esc(code)+'</span><div class="phfc-attendance-person"><strong>'+esc(displayName)+'</strong><small>'+esc([row.department,row.position].filter(Boolean).join(' · '))+'</small></div>'+phfcAttendanceChoice(row,'present',canManage)+phfcAttendanceChoice(row,'late',canManage)+phfcAttendanceChoice(row,'excused',canManage)+phfcAttendanceChoice(row,'absent',canManage)+'<label class="phfc-attendance-note"><span class="phfc-visually-hidden">Ghi chú</span><input type="text" data-phfc-att-note value="'+esc(row.note||'')+'" placeholder="Không bắt buộc" '+(canManage?'':'disabled')+'></label></article>';}).join('');
  }
  function phfcAttendanceSummaryHtml(rows,sessions){
    if(!rows.length)return '<div class="phfc-schedule-empty"><strong>Chưa có học viên</strong><span>Khóa học này chưa có học viên được phân công.</span></div>';
    return '<div class="phfc-attendance-course-scroll"><table class="phfc-attendance-course-table"><thead><tr><th>STT</th><th>Mã NV</th><th>Họ tên</th>'+sessions.map(function(s){return '<th><span>'+esc(s.sessionName||'Buổi học')+'</span><small>'+esc(phfcDateLabel(s.sessionDate))+'</small></th>';}).join('')+'<th>Tỷ lệ tham gia</th></tr></thead><tbody>'+rows.map(function(row,index){var marked=0,attended=0;var cells=sessions.map(function(s){var status=(row.bySession&&row.bySession[s.id])||'unmarked';if(status!=='unmarked')marked++;if(status==='present'||status==='late')attended++;return '<td><span class="phfc-att-summary-state is-'+esc(status)+'">'+esc(phfcAttendanceStatusLabel(status))+'</span></td>';}).join('');var rate=sessions.length?Math.round(attended/sessions.length*100):0;return '<tr><td>'+(index+1)+'</td><td><strong>'+esc(row.employeeCode||'—')+'</strong></td><td><strong>'+esc(row.fullName||'Chưa cập nhật họ tên')+'</strong><small>'+esc([row.department,row.position].filter(Boolean).join(' · '))+'</small></td>'+cells+'<td><b>'+rate+'%</b><small>'+attended+'/'+sessions.length+' buổi</small></td></tr>';}).join('')+'</tbody></table></div>';
  }
  function phfcAttendanceHistoryHtml(history,userFor){
    if(!history.length)return '<div class="phfc-schedule-empty"><strong>Chưa có lịch sử chỉnh sửa</strong><span>Lịch sử sẽ xuất hiện sau khi sổ được lưu hoặc chốt.</span></div>';
    var actionLabels={attendance_draft:'Lưu tạm',attendance_finalized:'Chốt điểm danh',attendance_admin_updated:'Admin điều chỉnh'};
    return history.map(function(item){
      var changes=Array.isArray(item.changes)?item.changes:[],actor=userFor({employeeId:item.performedBy,accountId:item.performedBy})||{};
      var actorName=actor.name||actor.fullName||(actor.employee&&actor.employee.fullName)||'';
      if(!actorName)actorName=item.action==='attendance_admin_updated'?'Admin':(item.action==='attendance_finalized'?'Người chốt điểm danh':'Người điểm danh');
      var when='—';
      if(item.performedAt){var d=new Date(item.performedAt);if(!Number.isNaN(d.getTime()))when=d.toLocaleDateString('vi-VN')+' lúc '+d.toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',hour12:false});}
      return '<article class="phfc-attendance-history-item"><div class="phfc-attendance-history-head"><div><strong>'+esc(actionLabels[item.action]||'Cập nhật điểm danh')+'</strong><span>'+esc(when)+' · '+esc(actorName)+'</span></div><em>'+changes.length+' thay đổi</em></div>'+(item.reason?'<p class="phfc-attendance-history-reason"><b>Lý do:</b> '+esc(item.reason)+'</p>':'')+(changes.length?'<div class="phfc-attendance-history-changes">'+changes.map(function(change){var u=userFor(change)||{},name=u.name||u.fullName||(u.employee&&u.employee.fullName)||u.employeeCode||'Học viên';var statusChanged=change.oldStatus!==change.newStatus,noteChanged=String(change.oldNote||'')!==String(change.newNote||'');return '<div><strong>'+esc(name)+'</strong>'+(statusChanged?'<span>'+esc(phfcAttendanceStatusLabel(change.oldStatus))+' <b aria-hidden="true">→</b> '+esc(phfcAttendanceStatusLabel(change.newStatus))+'</span>':'')+(noteChanged?'<small><b>Ghi chú:</b> '+esc(change.oldNote||'Không có')+' → '+esc(change.newNote||'Không có')+'</small>':'')+'</div>';}).join('')+'</div>':'<p class="phfc-attendance-history-empty-change">Không có thay đổi trạng thái hoặc ghi chú học viên.</p>')+'</article>';
    }).join('');
  }
  async function hydrateAttendance(root){
    var workspace=root.querySelector('[data-phfc-attendance-workspace]');if(!workspace)return;var classSelect=workspace.querySelector('[data-phfc-att-class]'),sessionSelect=workspace.querySelector('[data-phfc-att-session]'),holder=workspace.querySelector('[data-phfc-att-rows]'),saveDraft=workspace.querySelector('[data-phfc-att-draft]'),finalize=workspace.querySelector('[data-phfc-att-finalize]'),actions=workspace.querySelector('[data-phfc-att-actions]'),search=workspace.querySelector('[data-phfc-att-search]'),summary=workspace.querySelector('[data-phfc-att-summary]'),bulk=workspace.querySelector('[data-phfc-att-bulk]'),selectAll=workspace.querySelector('[data-phfc-att-select-all]'),lockNote=workspace.querySelector('[data-phfc-att-lock-note]'),adminReasonWrap=workspace.querySelector('[data-phfc-att-admin-reason-wrap]'),adminReason=workspace.querySelector('[data-phfc-att-admin-reason]'),currentRows=[],canManage=false,currentSession='',currentClass=null,mode='session',classes=[],users=[],workflowState='not_started',isExpired=false,isAdmin=false,currentHistory=[];var historyBar=workspace.querySelector('[data-phfc-att-history-bar]'),historyOpen=workspace.querySelector('[data-phfc-att-history-open]'),historyOverlay=workspace.querySelector('[data-phfc-att-history-overlay]'),historyList=workspace.querySelector('[data-phfc-att-history-list]');
    try{var result=await Promise.all([loadClassroomClasses(false),phfcLoadClassroomUsers(false)]);classes=result[0];users=result[1];classSelect.innerHTML='<option value="">-- Chọn lớp đào tạo --</option>'+classes.map(function(c){return '<option value="'+esc(c.id)+'">'+esc((c.classCode||'')+' · '+c.className)+'</option>';}).join('');var dashboardClassId='',dashboardSessionId='';try{dashboardClassId=sessionStorage.getItem('phfcAttendanceClassId')||'';dashboardSessionId=sessionStorage.getItem('phfcAttendanceSessionId')||'';sessionStorage.removeItem('phfcAttendanceClassId');sessionStorage.removeItem('phfcAttendanceSessionId');}catch(e){}
      function userFor(en){return users.find(function(u){return (en.accountId&&u.accountId===en.accountId)||(en.employeeId&&u.employeeId===en.employeeId);})||{};}
      function counts(){var present=currentRows.filter(function(x){return x.status==='present'||x.status==='late';}).length,abs=currentRows.filter(function(x){return x.status==='absent'||x.status==='excused';}).length,un=currentRows.filter(function(x){return !x.status||x.status==='unmarked';}).length;function set(sel,v){var e=workspace.querySelector(sel);if(e)e.textContent=String(v);}set('[data-phfc-att-total]',currentRows.length);set('[data-phfc-att-present]',present);set('[data-phfc-att-absent]',abs);set('[data-phfc-att-unmarked]',un);}
      function visibleRows(){var q=norm(search.value||'');return currentRows.filter(function(x){return !q||norm([x.fullName,x.employeeCode,x.email,x.department,x.position].join(' ')).indexOf(q)>=0;});}
      function bindRows(){holder.querySelectorAll('[data-phfc-att-row]').forEach(function(el){var row=currentRows.find(function(x){return x.enrollmentId===el.getAttribute('data-enrollment-id');});if(!row)return;el.querySelectorAll('[data-phfc-att-status]').forEach(function(st){st.addEventListener('change',function(){if(st.checked){row.status=st.value;counts();}});});var note=el.querySelector('[data-phfc-att-note]');if(note)note.addEventListener('input',function(){row.note=note.value;});});if(selectAll){selectAll.checked=false;selectAll.indeterminate=false;}counts();}
      function draw(){if(mode==='course'){drawCourseSummary();return;}holder.innerHTML=phfcAttendanceRowsHtml(visibleRows(),canManage);bindRows();}
      function selectedRows(){var ids=Array.from(holder.querySelectorAll('[data-phfc-att-selected]:checked')).map(function(x){return x.closest('[data-phfc-att-row]').getAttribute('data-enrollment-id');});return currentRows.filter(function(x){return ids.indexOf(x.enrollmentId)>=0;});}
      function updateSessionOptions(){currentClass=classes.find(function(c){return c.id===classSelect.value;})||null;var ss=currentClass&&Array.isArray(currentClass.sessions)?currentClass.sessions.slice():[];ss.sort(function(a,b){return String(a.sessionDate+a.startTime).localeCompare(String(b.sessionDate+b.startTime));});sessionSelect.disabled=!currentClass||!ss.length;sessionSelect.innerHTML='<option value="">-- Chọn buổi học --</option>'+ss.map(function(s,i){return '<option value="'+esc(s.id)+'">Buổi '+(i+1)+' · '+esc(s.sessionName||'Buổi học')+' · '+esc(phfcDateLabel(s.sessionDate)+' '+(s.startTime||''))+'</option>';}).join('');currentSession='';currentRows=[];summary.hidden=true;bulk.hidden=true;actions.hidden=true;holder.innerHTML=currentClass?'<div class="phfc-class-loading">Chọn buổi học để bắt đầu điểm danh.</div>':'<div class="phfc-class-loading">Chọn lớp đào tạo để bắt đầu.</div>';counts();}
      async function loadSession(){currentSession=sessionSelect.value;actions.hidden=true;summary.hidden=true;bulk.hidden=true;if(!currentSession){currentRows=[];currentHistory=[];if(historyBar)historyBar.hidden=true;holder.innerHTML='<div class="phfc-class-loading">Chọn buổi học để bắt đầu điểm danh.</div>';counts();return;}holder.innerHTML='<div class="phfc-class-loading">Đang tải sổ điểm danh…</div>';try{var data=await phfcAttendanceApi(currentSession),cls=data.classroomClass||{},ses=data.session||{},existing=Array.isArray(data.attendance)?data.attendance:[],map=new Map(existing.map(function(x){return [x.enrollmentId,x];}));canManage=Boolean(data.canManage);workflowState=data.workflowState||'not_started';isExpired=Boolean(data.isExpired);isAdmin=Boolean(data.isAdmin);currentHistory=Array.isArray(data.attendanceHistory)?data.attendanceHistory:[];if(historyBar)historyBar.hidden=!currentHistory.length;if(lockNote){lockNote.hidden=false;lockNote.innerHTML=isExpired?(isAdmin?'Sổ đã hết hạn N+1. Admin vẫn được chỉnh sửa và phải nhập lý do.':'Sổ đã khóa sau ngày N+1. Chỉ Admin được chỉnh sửa.'):(workflowState==='finalized'?'Sổ đã chốt. Người có quyền vẫn được điều chỉnh đến hết ngày '+esc(phfcDateLabel(data.deadlineDate))+'.':'Có thể cập nhật đến hết ngày '+esc(phfcDateLabel(data.deadlineDate))+'.');}if(adminReasonWrap)adminReasonWrap.hidden=!(isAdmin&&isExpired);currentRows=(cls.enrollments||[]).map(function(en){var old=map.get(en.id)||{},u=userFor(en),name=u.name||u.fullName||(u.employee&&u.employee.fullName)||'';return {id:old.id||'',createdAt:old.createdAt||'',enrollmentId:en.id,employeeId:en.employeeId,accountId:en.accountId,status:old.status||'unmarked',note:old.note||'',fullName:name,employeeCode:u.code||u.employeeCode||(u.employee&&u.employee.employeeCode)||'',email:u.email||'',department:u.department||en.departmentSnapshot||'',position:u.position||en.positionSnapshot||''};});summary.hidden=false;summary.innerHTML='<strong>'+esc(cls.className||'Lớp đào tạo')+'</strong><span>'+esc(phfcDateLabel(ses.sessionDate)+' · '+(ses.startTime||'—')+'–'+(ses.endTime||'—')+' · '+(ses.sessionName||'Buổi học'))+'</span><em>'+(workflowState==='finalized'?'Đã chốt':(workflowState==='draft'?'Đã lưu tạm':(canManage?'Có quyền điểm danh':'Chỉ được xem')))+'</em>';bulk.hidden=!canManage;actions.hidden=!canManage;if(saveDraft)saveDraft.hidden=workflowState==='finalized';if(finalize)finalize.textContent=workflowState==='finalized'?'Lưu điều chỉnh':'Chốt điểm danh';draw();}catch(error){holder.innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tải điểm danh</strong><span>'+esc(error.message||String(error))+'</span></div>';}}
      async function drawCourseSummary(){if(!currentClass){holder.innerHTML='<div class="phfc-class-loading">Chọn lớp đào tạo để xem tổng hợp toàn khóa.</div>';return;}var ss=(currentClass.sessions||[]).slice().sort(function(a,b){return String(a.sessionDate+a.startTime).localeCompare(String(b.sessionDate+b.startTime));});if(!ss.length){holder.innerHTML='<div class="phfc-schedule-empty"><strong>Chưa có buổi học</strong><span>Khóa học này chưa được tạo lịch.</span></div>';return;}holder.innerHTML='<div class="phfc-class-loading">Đang tổng hợp điểm danh toàn khóa…</div>';try{var data=await Promise.all(ss.map(function(s){return phfcAttendanceApi(s.id);})),baseEnrollments=currentClass.enrollments||[],rows=baseEnrollments.map(function(en){var u=userFor(en),name=u.name||u.fullName||(u.employee&&u.employee.fullName)||'',row={enrollmentId:en.id,fullName:name,employeeCode:u.code||u.employeeCode||(u.employee&&u.employee.employeeCode)||'',department:u.department||en.departmentSnapshot||'',position:u.position||en.positionSnapshot||'',bySession:{}};data.forEach(function(d,i){var old=(d.attendance||[]).find(function(x){return x.enrollmentId===en.id;});row.bySession[ss[i].id]=old?old.status:'unmarked';});return row;});holder.innerHTML=phfcAttendanceSummaryHtml(rows,ss);}catch(error){holder.innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tổng hợp toàn khóa</strong><span>'+esc(error.message||String(error))+'</span></div>';}}
      classSelect.addEventListener('change',function(){updateSessionOptions();if(mode==='course')drawCourseSummary();});sessionSelect.addEventListener('change',loadSession);search.addEventListener('input',draw);if(dashboardClassId&&classes.some(function(c){return c.id===dashboardClassId;})){classSelect.value=dashboardClassId;updateSessionOptions();if(dashboardSessionId&&Array.from(sessionSelect.options).some(function(o){return o.value===dashboardSessionId;})){sessionSelect.value=dashboardSessionId;loadSession();}}
      workspace.querySelectorAll('[data-phfc-att-mode]').forEach(function(btn){btn.addEventListener('click',function(){mode=btn.getAttribute('data-phfc-att-mode');workspace.querySelectorAll('[data-phfc-att-mode]').forEach(function(x){x.classList.toggle('active',x===btn);});sessionSelect.closest('.phfc-field').hidden=mode==='course';bulk.hidden=mode==='course'||!canManage;actions.hidden=mode==='course'||!canManage;summary.hidden=mode==='course';draw();});});
      if(selectAll)selectAll.addEventListener('change',function(){holder.querySelectorAll('[data-phfc-att-selected]').forEach(function(x){x.checked=selectAll.checked;});});
      workspace.querySelectorAll('[data-phfc-att-bulk-status]').forEach(function(btn){btn.addEventListener('click',function(){var rows=selectedRows();if(!rows.length){phfcNotice('error','Chưa chọn học viên','Hãy tick những học viên cần cập nhật trạng thái.');return;}var status=btn.getAttribute('data-phfc-att-bulk-status');rows.forEach(function(x){x.status=status;});draw();});});
      async function submitAttendance(action,button){if(!currentSession)return;var original=button.textContent;try{button.disabled=true;button.textContent='Đang lưu…';var reason=adminReason?adminReason.value.trim():'';var data=await phfcSaveAttendance({sessionId:currentSession,action:action,reason:reason,attendance:currentRows.map(function(x){return {id:x.id,createdAt:x.createdAt,enrollmentId:x.enrollmentId,employeeId:x.employeeId,accountId:x.accountId,status:x.status,note:x.note};})});phfcNotice('success',action==='draft'?'Đã lưu tạm':'Đã cập nhật điểm danh',action==='draft'?'Bạn có thể quay lại hoàn tất trước khi hết hạn N+1.':'Sổ điểm danh đã được cập nhật.');await loadSession();}catch(error){phfcNotice('error',action==='draft'?'Chưa thể lưu tạm':'Chưa thể chốt điểm danh',error.message||String(error));}finally{button.disabled=false;button.textContent=original;}}if(saveDraft)saveDraft.addEventListener('click',function(){submitAttendance('draft',saveDraft);});if(finalize)finalize.addEventListener('click',function(){submitAttendance(workflowState==='finalized'?'update':'finalize',finalize);});if(historyOpen)historyOpen.addEventListener('click',function(){if(historyList)historyList.innerHTML=phfcAttendanceHistoryHtml(currentHistory,userFor);if(historyOverlay){historyOverlay.hidden=false;document.documentElement.classList.add('phfc-modal-lock');}});if(historyOverlay){historyOverlay.querySelectorAll('[data-phfc-att-history-close]').forEach(function(btn){btn.addEventListener('click',function(){historyOverlay.hidden=true;document.documentElement.classList.remove('phfc-modal-lock');});});historyOverlay.addEventListener('click',function(e){if(e.target===historyOverlay){historyOverlay.hidden=true;document.documentElement.classList.remove('phfc-modal-lock');}});}
    }catch(error){holder.innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tải danh sách lớp học</strong><span>'+esc(error.message||String(error))+'</span></div>';}
  }


  function phfcLearningWorkspace(kind){
    var learner=role()==='learner',results=kind==='results';
    return '<section class="phfc-learning-workspace" data-phfc-learning data-learning-kind="'+esc(kind)+'">'+
      '<section class="phfc-card phfc-learning-toolbar"><label class="phfc-field"><span>Khóa học</span><select data-phfc-learning-class><option value="">-- Chọn khóa học --</option></select></label><div class="phfc-learning-deadline" data-phfc-learning-deadline hidden></div>'+(learner?'':'<button class="phfc-primary-button" type="button" data-phfc-add-lesson hidden>＋ Thêm bài học</button>')+'</section>'+
      '<section class="phfc-card phfc-learning-summary" data-phfc-learning-summary hidden></section>'+
      '<section class="phfc-card phfc-learning-body"><div data-phfc-learning-holder><div class="phfc-class-loading">Chọn khóa học để xem nội dung.</div></div></section>'+
      (!learner&&!results?'<section class="phfc-learning-actions" data-phfc-learning-actions hidden><button class="phfc-primary-button" type="button" data-phfc-save-lessons>Lưu danh sách bài học</button></section>':'')+
    '</section>';
  }
  async function phfcLearningApi(classId,options){return classroomRequest('/api/data?classroomLearning=1&classId='+encodeURIComponent(classId),options);}
  function phfcLearningStatusLabel(v){return v==='completed'?'Đã hoàn thành':v==='in_progress'?'Đang học':v==='overdue'?'Quá hạn chưa hoàn thành':'Chưa bắt đầu';}
  function phfcLessonStatusLabel(v){return v==='published'?'Đã phát hành':v==='hidden'?'Đã ẩn':'Bản nháp';}
  function phfcLearningDate(v){if(!v)return '—';try{return new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v));}catch(e){return String(v);}}
  function phfcLessonRowsHtml(lessons,editable){
    if(!lessons.length)return '<div class="phfc-schedule-empty"><strong>Chưa có bài học</strong><span>Admin thêm các bài theo danh mục của khóa học; không cần gắn ngày hoàn thành riêng cho từng bài.</span></div>';
    return '<div class="phfc-lesson-editor-list">'+lessons.map(function(x,i){return '<article class="phfc-lesson-editor-row" data-phfc-lesson-row data-lesson-id="'+esc(x.id||'')+'">'+
      '<span class="phfc-lesson-number">'+(i+1)+'</span><div class="phfc-lesson-fields">'+
      (editable?'<label><span>Danh mục</span><input data-lesson-category value="'+esc(x.category||'Nội dung khóa học')+'"></label><label class="is-wide"><span>Tên bài *</span><input data-lesson-title value="'+esc(x.title||'')+'" placeholder="Ví dụ: Kiến thức sản phẩm"></label><label><span>Thời lượng</span><input type="number" min="0" data-lesson-minutes value="'+esc(x.estimatedMinutes||0)+'"></label><label><span>Trạng thái</span><select data-lesson-status><option value="draft"'+(x.status==='draft'?' selected':'')+'>Bản nháp</option><option value="published"'+(x.status==='published'?' selected':'')+'>Đã phát hành</option><option value="hidden"'+(x.status==='hidden'?' selected':'')+'>Đã ẩn</option></select></label><label class="is-wide"><span>Mô tả ngắn</span><input data-lesson-summary value="'+esc(x.summary||'')+'"></label><label><span>Loại nội dung</span><select data-lesson-type><option value="text"'+(x.contentType==='text'?' selected':'')+'>Bài đọc</option><option value="link"'+(x.contentType==='link'?' selected':'')+'>Đường dẫn</option><option value="video"'+(x.contentType==='video'?' selected':'')+'>Video link</option><option value="file"'+(x.contentType==='file'?' selected':'')+'>File/link tải</option></select></label><label class="is-wide"><span>Đường dẫn</span><input data-lesson-url value="'+esc(x.contentUrl||'')+'" placeholder="https://..."></label><label class="is-full"><span>Nội dung bài đọc/hướng dẫn</span><textarea rows="3" data-lesson-text>'+esc(x.contentText||'')+'</textarea></label><label class="phfc-lesson-required"><input type="checkbox" data-lesson-required'+(x.required!==false?' checked':'')+'><span>Bài bắt buộc</span></label>':'<div class="phfc-lesson-display"><small>'+esc(x.category||'Nội dung khóa học')+'</small><strong>'+esc(x.title)+'</strong><p>'+esc(x.summary||'')+'</p><span>'+(x.estimatedMinutes?x.estimatedMinutes+' phút':'Không giới hạn thời lượng')+'</span></div>')+
      '</div>'+(editable?'<div class="phfc-lesson-row-actions"><button type="button" data-phfc-lesson-up aria-label="Đưa lên">↑</button><button type="button" data-phfc-lesson-down aria-label="Đưa xuống">↓</button><button type="button" data-phfc-lesson-remove aria-label="Xóa bài">×</button></div>':'')+'</article>';}).join('')+'</div>';
  }
  async function hydrateLearning(root){
    var ws=root.querySelector('[data-phfc-learning]');if(!ws)return;
    var classSelect=ws.querySelector('[data-phfc-learning-class]'),holder=ws.querySelector('[data-phfc-learning-holder]'),summary=ws.querySelector('[data-phfc-learning-summary]'),deadline=ws.querySelector('[data-phfc-learning-deadline]'),add=ws.querySelector('[data-phfc-add-lesson]'),save=ws.querySelector('[data-phfc-save-lessons]'),actions=ws.querySelector('[data-phfc-learning-actions]'),kind=ws.getAttribute('data-learning-kind'),learner=role()==='learner',current=[];
    try{var classes=await loadClassroomClasses(false);classSelect.innerHTML='<option value="">-- Chọn khóa học --</option>'+classes.map(function(c){return '<option value="'+esc(c.id)+'">'+esc((c.classCode||'')+' · '+c.className)+'</option>';}).join('');if(classes.length===1){classSelect.value=classes[0].id;load();}}catch(error){holder.innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tải khóa học</strong><span>'+esc(error.message||String(error))+'</span></div>';return;}
    function collect(){return Array.from(holder.querySelectorAll('[data-phfc-lesson-row]')).map(function(row){return {id:row.getAttribute('data-lesson-id')||'',category:(row.querySelector('[data-lesson-category]')||{}).value||'',title:(row.querySelector('[data-lesson-title]')||{}).value||'',estimatedMinutes:(row.querySelector('[data-lesson-minutes]')||{}).value||0,status:(row.querySelector('[data-lesson-status]')||{}).value||'draft',summary:(row.querySelector('[data-lesson-summary]')||{}).value||'',contentType:(row.querySelector('[data-lesson-type]')||{}).value||'text',contentUrl:(row.querySelector('[data-lesson-url]')||{}).value||'',contentText:(row.querySelector('[data-lesson-text]')||{}).value||'',required:Boolean((row.querySelector('[data-lesson-required]')||{}).checked)};});}
    function bindRows(){holder.querySelectorAll('[data-phfc-lesson-remove]').forEach(function(b){b.onclick=function(){b.closest('[data-phfc-lesson-row]').remove();renumber();};});holder.querySelectorAll('[data-phfc-lesson-up]').forEach(function(b){b.onclick=function(){var r=b.closest('[data-phfc-lesson-row]'),p=r.previousElementSibling;if(p)r.parentNode.insertBefore(r,p);renumber();};});holder.querySelectorAll('[data-phfc-lesson-down]').forEach(function(b){b.onclick=function(){var r=b.closest('[data-phfc-lesson-row]'),n=r.nextElementSibling;if(n)r.parentNode.insertBefore(n,r);renumber();};});}
    function renumber(){holder.querySelectorAll('.phfc-lesson-number').forEach(function(n,i){n.textContent=String(i+1);});}
    async function load(){var classId=classSelect.value;if(!classId){holder.innerHTML='<div class="phfc-class-loading">Chọn khóa học để xem nội dung.</div>';summary.hidden=true;deadline.hidden=true;if(add)add.hidden=true;if(actions)actions.hidden=true;return;}holder.innerHTML='<div class="phfc-class-loading">Đang tải nội dung khóa học…</div>';try{var data=await phfcLearningApi(classId),cls=data.classroomClass||{};current=(data.lessons||[]).slice();deadline.hidden=false;deadline.innerHTML='<strong>Thời hạn chung của khóa</strong><span>'+esc(phfcLearningDate(cls.startAt))+' → '+esc(phfcLearningDate(cls.endAt))+'</span><small>Học viên tự hoàn thành các bài trong thời hạn này; không đặt hạn riêng từng bài.</small>';if(add)add.hidden=false;if(actions)actions.hidden=false;
      if(kind==='results'&&!learner){var users=await phfcLoadClassroomUsers(false);var userFor=function(en){return users.find(function(u){return (en.accountId&&u.accountId===en.accountId)||(en.employeeId&&u.employeeId===en.employeeId);})||{};};var rows=data.learnerSummaries||[];summary.hidden=false;summary.innerHTML='<strong>'+esc(cls.className||'Khóa học')+'</strong><span>'+current.filter(function(x){return x.status==='published';}).length+' bài đã phát hành · '+rows.length+' học viên</span>';holder.innerHTML=rows.length?'<div class="phfc-progress-table"><div class="phfc-progress-head"><span>Học viên</span><span>Tiến độ</span><span>Bài đã xong</span><span>Truy cập cuối</span><span>Trạng thái</span></div>'+rows.map(function(r){var u=userFor(r.enrollment)||{},n=u.name||u.fullName||(u.employee&&u.employee.fullName)||u.email||'Học viên';return '<article><span><b>'+esc(n)+'</b><small>'+esc(u.employeeCode||u.code||'')+'</small></span><span><div class="phfc-progress-bar"><i style="width:'+Math.max(0,Math.min(100,r.percent||0))+'%"></i></div><b>'+(r.percent||0)+'%</b></span><span>'+r.completedRequired+'/'+r.requiredLessons+'</span><span>'+esc(phfcLearningDate(r.lastOpenedAt))+'</span><span><em class="is-'+esc(r.status)+'">'+esc(phfcLearningStatusLabel(r.status))+'</em></span></article>';}).join('')+'</div>':'<div class="phfc-schedule-empty"><strong>Chưa có học viên</strong><span>Học viên được phân công sẽ hiển thị tiến độ tại đây.</span></div>';return;}
      if(learner){var progress=new Map((data.progress||[]).map(function(x){return [x.lessonId,x];})),sum=data.summary||{};summary.hidden=false;summary.innerHTML='<div><strong>Tiến độ '+(sum.completedRequired||0)+'/'+(sum.requiredLessons||0)+' bài bắt buộc</strong><span>'+(sum.percent||0)+'%</span></div><div class="phfc-progress-bar"><i style="width:'+(sum.percent||0)+'%"></i></div><small>'+(sum.expired?'Khóa đã hết hạn; tiến độ được giữ nguyên.':'Hoàn thành trước '+phfcLearningDate(sum.endAt))+'</small>';holder.innerHTML=current.length?'<div class="phfc-learner-lessons">'+current.map(function(x,i){var p=progress.get(x.id)||{},st=p.status||'not_started';return '<article class="is-'+esc(st)+'"><span>'+(i+1)+'</span><div><small>'+esc(x.category)+'</small><strong>'+esc(x.title)+'</strong><p>'+esc(x.summary||'')+'</p><em>'+esc(phfcLearningStatusLabel(st))+(x.estimatedMinutes?' · '+x.estimatedMinutes+' phút':'')+'</em></div><button type="button" data-phfc-open-lesson="'+esc(x.id)+'"'+(sum.expired?' disabled':'')+'>'+(st==='completed'?'Xem lại':'Mở bài')+'</button></article>';}).join('')+'</div>':'<div class="phfc-schedule-empty"><strong>Chưa có bài học được phát hành</strong><span>Admin sẽ công bố nội dung tại đây.</span></div>';holder.querySelectorAll('[data-phfc-open-lesson]').forEach(function(btn){btn.onclick=async function(){var lesson=current.find(function(x){return x.id===btn.getAttribute('data-phfc-open-lesson');});if(!lesson)return;try{await phfcLearningApi(classId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'openLesson',classId:classId,lessonId:lesson.id})});var body='<div class="phfc-lesson-reader"><small>'+esc(lesson.category)+'</small><h3>'+esc(lesson.title)+'</h3><p>'+esc(lesson.summary||'')+'</p>'+(lesson.contentText?'<div>'+esc(lesson.contentText).replace(/\n/g,'<br>')+'</div>':'')+(lesson.contentUrl?'<a href="'+esc(lesson.contentUrl)+'" target="_blank" rel="noopener">Mở nội dung đính kèm ↗</a>':'')+'<button class="phfc-primary-button" type="button" data-phfc-complete>Đánh dấu hoàn thành</button></div>';var overlay=document.createElement('div');overlay.className='phfc-modal-overlay';overlay.innerHTML='<div class="phfc-modal-card phfc-learning-modal"><button type="button" class="phfc-modal-close" data-close>×</button>'+body+'</div>';document.body.appendChild(overlay);overlay.querySelector('[data-close]').onclick=function(){overlay.remove();};overlay.querySelector('[data-phfc-complete]').onclick=async function(){try{await phfcLearningApi(classId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'completeLesson',classId:classId,lessonId:lesson.id})});overlay.remove();phfcNotice('success','Đã hoàn thành bài học','Tiến độ khóa học đã được cập nhật.');load();}catch(e){phfcNotice('error','Chưa thể hoàn thành bài',e.message||String(e));}};}catch(e){phfcNotice('error','Chưa thể mở bài học',e.message||String(e));}};});return;}
      summary.hidden=false;summary.innerHTML='<strong>'+esc(cls.className||'Khóa học')+'</strong><span>'+current.length+' bài · '+current.filter(function(x){return x.status==='published';}).length+' đã phát hành</span>';holder.innerHTML=phfcLessonRowsHtml(current,true);bindRows();
    }catch(error){holder.innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tải nội dung khóa học</strong><span>'+esc(error.message||String(error))+'</span></div>';}}
    classSelect.addEventListener('change',load);
    if(add)add.addEventListener('click',function(){current=collect();current.push({id:'',category:'Nội dung khóa học',title:'',summary:'',contentType:'text',contentUrl:'',contentText:'',estimatedMinutes:0,required:true,status:'draft'});holder.innerHTML=phfcLessonRowsHtml(current,true);bindRows();holder.querySelectorAll('[data-lesson-title]')[current.length-1].focus();});
    if(save)save.addEventListener('click',async function(){var classId=classSelect.value;if(!classId)return;try{save.disabled=true;save.textContent='Đang lưu…';var json=await phfcLearningApi(classId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveLessons',classId:classId,lessons:collect()})});current=json.lessons||[];phfcNotice('success','Đã lưu bài học','Danh sách bài học và thứ tự đã được cập nhật.');load();}catch(e){phfcNotice('error','Chưa thể lưu bài học',e.message||String(e));}finally{save.disabled=false;save.textContent='Lưu danh sách bài học';}});
  }

  function phfcMaterialsWorkspace(){
    return '<section class="phfc-materials-workspace" data-phfc-materials>'+ 
      '<section class="phfc-card phfc-learning-toolbar"><label class="phfc-field"><span>Khóa học</span><select data-phfc-material-class><option value="">-- Chọn khóa học --</option></select></label><div class="phfc-learning-deadline" data-phfc-material-deadline hidden></div></section>'+ 
      '<section class="phfc-card phfc-material-body"><div data-phfc-material-holder><div class="phfc-class-loading">Chọn khóa học để quản lý tài liệu.</div></div></section>'+ 
    '</section>';
  }
  async function phfcMaterialsApi(classId,options){return classroomRequest('/api/data?classroomMaterials=1&classId='+encodeURIComponent(classId),options);}
  function phfcFileSize(v){v=Number(v||0);if(v>=1048576)return (v/1048576).toFixed(1)+' MB';if(v>=1024)return Math.round(v/1024)+' KB';return v+' B';}
  function phfcMaterialStatus(v){return v==='published'?'Đã phát hành':v==='hidden'?'Đã ẩn':'Bản nháp';}
  function phfcMaterialStatusClass(v){return v==='published'?'is-published':v==='hidden'?'is-hidden':'is-draft';}
  function phfcGroupPrompt(){
    return new Promise(function(resolve){
      var overlay=document.createElement('div');overlay.className='phfc-modal-overlay phfc-material-group-overlay';
      overlay.innerHTML='<section class="phfc-modal-card phfc-material-group-modal" role="dialog" aria-modal="true" aria-label="Thêm nhóm nội dung"><div class="phfc-user-picker-head"><div><h3>Thêm nhóm nội dung</h3><p>Nhóm giúp sắp xếp tài liệu của khóa học gọn và dễ theo dõi.</p></div><button type="button" data-close aria-label="Đóng">×</button></div><div class="phfc-material-group-form"><label class="phfc-field"><span>Tên nhóm nội dung <b>*</b></span><input type="text" maxlength="120" data-group-title placeholder="Ví dụ: Kiến thức sản phẩm"></label><label class="phfc-field"><span>Mô tả <small>(không bắt buộc)</small></span><textarea rows="3" maxlength="300" data-group-description placeholder="Mô tả ngắn nội dung trong nhóm"></textarea></label></div><div class="phfc-user-picker-foot"><button type="button" class="phfc-secondary-button" data-cancel>Hủy</button><button type="button" class="phfc-primary-button" data-confirm>Thêm nhóm</button></div></section>';
      document.body.appendChild(overlay);var title=overlay.querySelector('[data-group-title]'),desc=overlay.querySelector('[data-group-description]');
      function close(value){overlay.remove();resolve(value||null);}overlay.querySelector('[data-close]').onclick=function(){close(null);};overlay.querySelector('[data-cancel]').onclick=function(){close(null);};overlay.addEventListener('click',function(e){if(e.target===overlay)close(null);});
      overlay.querySelector('[data-confirm]').onclick=function(){var value=String(title.value||'').trim();if(!value){title.focus();phfcNotice('warning','Chưa có tên nhóm','Vui lòng nhập tên nhóm nội dung trước khi tiếp tục.');return;}close({title:value,description:String(desc.value||'').trim()});};
      title.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();overlay.querySelector('[data-confirm]').click();}});setTimeout(function(){title.focus();},0);
    });
  }
  async function hydrateMaterials(root){
    var ws=root.querySelector('[data-phfc-materials]');if(!ws)return;
    var sel=ws.querySelector('[data-phfc-material-class]'),holder=ws.querySelector('[data-phfc-material-holder]'),deadline=ws.querySelector('[data-phfc-material-deadline]'),learner=role()==='learner',data=null;
    try{var classes=await loadClassroomClasses(false);sel.innerHTML='<option value="">-- Chọn khóa học --</option>'+classes.map(function(c){return '<option value="'+esc(c.id)+'">'+esc((c.classCode||'')+' · '+c.className)+'</option>';}).join('');if(classes.length===1){sel.value=classes[0].id;load();}}catch(e){holder.innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tải khóa học</strong><span>'+esc(e.message||String(e))+'</span></div>';}
    function post(body){return phfcMaterialsApi(sel.value,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
    function draw(){
      if(!data)return;var groups=data.groups||[],materials=data.materials||[],progress=new Map((data.progress||[]).map(function(x){return [x.materialId,x];}));
      if(!groups.length){holder.innerHTML=learner?'<div class="phfc-schedule-empty"><strong>Chưa có tài liệu được phát hành</strong><span>Tài liệu khóa học sẽ hiển thị tại đây.</span></div>':'<div class="phfc-material-empty"><strong>Chưa có nhóm nội dung</strong><span>Hãy tạo nhóm trước khi tải file để tài liệu luôn gọn và dễ theo dõi.</span><button class="phfc-primary-button" type="button" data-add-group>Tạo nhóm nội dung</button></div>';}
      else holder.innerHTML='<div class="phfc-material-groups">'+groups.map(function(g,gi){var files=materials.filter(function(m){return m.groupId===g.id;});return '<section class="phfc-material-group" data-group-id="'+esc(g.id)+'"><header><div><small>Nhóm '+(gi+1)+'</small><strong>'+esc(g.title)+'</strong><span>'+esc(g.description||'')+'</span></div>'+(!learner?'<div class="phfc-material-group-controls"><select class="phfc-status-select '+phfcMaterialStatusClass(g.status)+'" data-group-status aria-label="Trạng thái nhóm '+esc(g.title)+'"><option value="draft"'+(g.status==='draft'?' selected':'')+'>Bản nháp</option><option value="published"'+(g.status==='published'?' selected':'')+'>Đã phát hành</option><option value="hidden"'+(g.status==='hidden'?' selected':'')+'>Đã ẩn</option></select><button type="button" data-upload-files>＋ Thêm tài liệu</button></div>':'')+'</header><div class="phfc-material-files">'+(files.length?files.map(function(m){var pr=progress.get(m.id)||{},st=pr.status||'not_started';return '<article data-material-id="'+esc(m.id)+'"><span class="phfc-material-file-icon">'+esc((m.originalName.split('.').pop()||'FILE').slice(0,4).toUpperCase())+'</span><div><strong>'+esc(m.title)+'</strong><small>'+esc(m.originalName)+' · '+esc(phfcFileSize(m.sizeBytes))+'</small><em>'+(m.required?'Bắt buộc':'Tham khảo')+(learner?' · '+(st==='completed'?'Đã xác nhận':st==='opened'?'Đã mở':'Chưa xem'):' · '+phfcMaterialStatus(m.status))+'</em></div>'+(learner?'<div class="phfc-material-actions"><button type="button" data-open-material>Mở file</button>'+(m.required&&st!=='completed'?'<button class="phfc-primary-button" type="button" data-confirm-material>Xác nhận đã đọc</button>':'')+'</div>':'<div class="phfc-material-admin-controls"><label class="phfc-required-chip"><input type="checkbox" data-material-required'+(m.required?' checked':'')+'><span>'+(m.required?'Bắt buộc':'Tham khảo')+'</span></label><select class="phfc-status-select '+phfcMaterialStatusClass(m.status)+'" data-material-status aria-label="Trạng thái tài liệu"><option value="draft"'+(m.status==='draft'?' selected':'')+'>Bản nháp</option><option value="published"'+(m.status==='published'?' selected':'')+'>Đã phát hành</option><option value="hidden"'+(m.status==='hidden'?' selected':'')+'>Đã ẩn</option></select><button type="button" data-save-material>Lưu thay đổi</button>'+(role()==='admin'?'<button type="button" class="is-danger" data-delete-material>Xóa</button>':'')+'</div>')+'</article>';}).join(''):'<div class="phfc-material-group-empty">Chưa có file trong nhóm này.</div>')+'</div></section>';}).join('')+'</div>'+(!learner?'<button class="phfc-secondary-button phfc-add-group-bottom" type="button" data-add-group>＋ Thêm nhóm nội dung</button>':'');
      bind();
    }
    function bind(){
      holder.querySelectorAll('[data-add-group]').forEach(function(b){b.onclick=async function(){var info=await phfcGroupPrompt();if(!info)return;var groups=(data.groups||[]).map(function(x){return {id:x.id,title:x.title,description:x.description,status:x.status};});groups.push({title:info.title,description:info.description,status:'draft'});try{b.disabled=true;data=await post({action:'saveGroups',classId:sel.value,groups:groups});draw();phfcNotice('success','Đã tạo nhóm nội dung','Nhóm “'+info.title+'” đã được lưu ở trạng thái Bản nháp.');}catch(e){phfcNotice('error','Chưa thể tạo nhóm',e.message||String(e));}finally{b.disabled=false;}};});
      holder.querySelectorAll('[data-group-status]').forEach(function(select){select.onchange=async function(){var groupEl=select.closest('[data-group-id]'),groupId=groupEl.getAttribute('data-group-id'),next=select.value,previous=(data.groups||[]).find(function(x){return x.id===groupId;})||{},groups=(data.groups||[]).map(function(x){return {id:x.id,title:x.title,description:x.description,status:x.id===groupId?next:x.status};});select.disabled=true;select.classList.add('is-saving');try{data=await post({action:'saveGroups',classId:sel.value,groups:groups});draw();var title=previous.title||'Nhóm nội dung';if(next==='published')phfcNotice('success','Đã phát hành nhóm nội dung','Nhóm “'+title+'” đã được phát hành. Học viên có thể xem các tài liệu đã phát hành trong nhóm này.');else if(next==='hidden')phfcNotice('success','Đã ẩn nhóm nội dung','Nhóm “'+title+'” đã được ẩn khỏi học viên. Dữ liệu và tiến độ cũ vẫn được giữ lại.');else phfcNotice('success','Đã chuyển về bản nháp','Nhóm “'+title+'” đã chuyển về Bản nháp. Học viên sẽ không còn thấy nhóm này.');}catch(e){select.value=previous.status||'draft';select.disabled=false;select.classList.remove('is-saving');phfcNotice('error','Không thể cập nhật trạng thái nhóm','Dữ liệu chưa được thay đổi. '+(e.message||String(e)));}};});
      holder.querySelectorAll('[data-upload-files]').forEach(function(b){b.onclick=function(){var group=b.closest('[data-group-id]'),input=document.createElement('input');input.type='file';input.multiple=true;input.accept='.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp';input.onchange=async function(){var files=Array.from(input.files||[]);for(var i=0;i<files.length;i++){var f=files[i];try{phfcNotice('info','Đang tải tài liệu',(i+1)+'/'+files.length+' · '+f.name);var ticket=await post({action:'createUpload',classId:sel.value,groupId:group.getAttribute('data-group-id'),fileName:f.name,mimeType:f.type,sizeBytes:f.size});var up=await fetch(ticket.signedUrl,{method:'PUT',headers:{'content-type':f.type,'x-upsert':'false'},body:f});if(!up.ok)throw new Error('Upload Storage thất bại: HTTP '+up.status);data=await post({action:'finalizeUpload',classId:sel.value,groupId:group.getAttribute('data-group-id'),materialId:ticket.materialId,storagePath:ticket.storagePath,fileName:f.name,title:f.name.replace(/\.[^.]+$/,''),mimeType:f.type,sizeBytes:f.size,required:true,status:'draft'});}catch(e){phfcNotice('error','Không tải được '+f.name,e.message||String(e));}}draw();phfcNotice('success','Đã tải tài liệu','Hoàn tất '+files.length+' file.');};input.click();};});
      holder.querySelectorAll('[data-material-required]').forEach(function(input){input.onchange=function(){var span=input.closest('label').querySelector('span');if(span)span.textContent=input.checked?'Bắt buộc':'Tham khảo';};});
      holder.querySelectorAll('[data-material-status]').forEach(function(select){select.onchange=function(){select.className='phfc-status-select '+phfcMaterialStatusClass(select.value);};});
      holder.querySelectorAll('[data-save-material]').forEach(function(b){b.onclick=async function(){var row=b.closest('[data-material-id]'),required=row.querySelector('[data-material-required]').checked,status=row.querySelector('[data-material-status]').value,title=row.querySelector('strong').textContent;try{b.disabled=true;b.textContent='Đang lưu…';data=await post({action:'updateMaterial',classId:sel.value,materialId:row.getAttribute('data-material-id'),required:required,status:status,sortOrder:0,title:title});draw();phfcNotice('success','Đã cập nhật tài liệu','“'+title+'” hiện là '+phfcMaterialStatus(status)+(required?' và được tính là tài liệu bắt buộc.':' và được xếp là tài liệu tham khảo.'));}catch(e){phfcNotice('error','Chưa thể lưu tài liệu','Dữ liệu chưa được thay đổi. '+(e.message||String(e)));}finally{b.disabled=false;b.textContent='Lưu thay đổi';}};});
      holder.querySelectorAll('[data-delete-material]').forEach(function(b){b.onclick=async function(){var row=b.closest('[data-material-id]');try{await phfcSoftDelete('material',row.getAttribute('data-material-id'),'tài liệu',load);}catch(e){phfcNotice('error','Chưa thể xóa tài liệu',e.message||String(e));}};});
      holder.querySelectorAll('[data-open-material]').forEach(function(b){b.onclick=async function(){var row=b.closest('[data-material-id]');try{var x=await classroomRequest('/api/data?classroomMaterials=1&action=url&classId='+encodeURIComponent(sel.value)+'&materialId='+encodeURIComponent(row.getAttribute('data-material-id')));window.open(x.url,'_blank','noopener');load();}catch(e){phfcNotice('error','Chưa thể mở tài liệu',e.message||String(e));}};});
      holder.querySelectorAll('[data-confirm-material]').forEach(function(b){b.onclick=async function(){var row=b.closest('[data-material-id]');try{data=await post({action:'confirmMaterial',classId:sel.value,materialId:row.getAttribute('data-material-id')});draw();phfcNotice('success','Đã xác nhận','Tiến độ tài liệu đã được cập nhật.');}catch(e){phfcNotice('error','Chưa thể xác nhận',e.message||String(e));}};});
    }
    async function load(){if(!sel.value){holder.innerHTML='<div class="phfc-class-loading">Chọn khóa học để quản lý tài liệu.</div>';deadline.hidden=true;return;}holder.innerHTML='<div class="phfc-class-loading">Đang tải tài liệu khóa học…</div>';try{data=await phfcMaterialsApi(sel.value);var cls=data.classroomClass||{};deadline.hidden=false;deadline.innerHTML='<strong>Thời hạn chung của khóa</strong><span>'+esc(phfcLearningDate(cls.startAt))+' → '+esc(phfcLearningDate(cls.endAt))+'</span><small>Tài liệu dùng chung toàn khóa; không ấn định ngày hoàn thành riêng từng file.</small>';draw();}catch(e){holder.innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tải tài liệu</strong><span>'+esc(e.message||String(e))+'</span></div>';}}
    sel.addEventListener('change',load);
  }


  async function phfcTestsApi(options){return classroomRequest('/api/data?classroomTests=1',options);}
  function phfcTestStatus(v){return v==='published'?'Đã phát hành':(v==='hidden'?'Đã ẩn':'Bản nháp');}
  function phfcAssignmentLabel(a){return a.scopeType==='class'?(a.assignmentType==='session'?'Theo buổi':'Cuối khóa'):'Độc lập';}
  function phfcTestsWorkspace(){
    return '<section class="phfc-tests" data-phfc-tests-workspace><section class="phfc-card phfc-tests-toolbar"><div><h3>Ngân hàng bài kiểm tra</h3><p>Tạo đề độc lập hoặc giao cho lớp. Một đề có thể được sử dụng nhiều lần.</p></div>'+(isManage()?'<button class="phfc-primary-button" type="button" data-phfc-test-create>+ Tạo bài kiểm tra</button>':'')+'</section><section class="phfc-tests-summary" data-phfc-test-summary></section><section class="phfc-card phfc-tests-list"><div data-phfc-test-list><div class="phfc-class-loading">Đang tải bài kiểm tra…</div></div></section><div class="phfc-tests-modal" data-phfc-test-modal hidden><div class="phfc-tests-backdrop" data-phfc-test-close></div><section class="phfc-card phfc-tests-dialog" role="dialog" aria-modal="true"><div class="phfc-tests-dialog-head"><div><small>PHF CLASSROOM</small><h3 data-phfc-test-modal-title>Tạo bài kiểm tra</h3></div><button type="button" data-phfc-test-close aria-label="Đóng">×</button></div><div data-phfc-test-modal-body></div></section></div></section>';
  }
  function bindTests(main){
    var root=main.querySelector('[data-phfc-tests-workspace]');if(!root)return;
    var list=root.querySelector('[data-phfc-test-list]'),summary=root.querySelector('[data-phfc-test-summary]'),modal=root.querySelector('[data-phfc-test-modal]'),body=root.querySelector('[data-phfc-test-modal-body]'),modalTitle=root.querySelector('[data-phfc-test-modal-title]');var data={tests:[],assignments:[],attempts:[]},classes=[],users=[];
    function close(){modal.hidden=true;document.documentElement.classList.remove('phfc-modal-lock');}
    root.querySelectorAll('[data-phfc-test-close]').forEach(function(b){b.onclick=close;});
    function open(html,title){body.innerHTML=html;modalTitle.textContent=title;modal.hidden=false;document.documentElement.classList.add('phfc-modal-lock');}
    function counts(){var tests=data.tests||[],assign=data.assignments||[];summary.innerHTML=['Tổng bài|'+tests.length,'Bản nháp|'+tests.filter(function(x){return x.status==='draft';}).length,'Đã phát hành|'+tests.filter(function(x){return x.status==='published';}).length,'Đang giao|'+assign.filter(function(x){return x.status==='published';}).length].map(function(x){var p=x.split('|');return '<article class="phfc-card"><span>'+esc(p[0])+'</span><strong>'+p[1]+'</strong></article>';}).join('');}
    function typeLabel(v){return v==='mixed'?'Hỗn hợp':v==='essay'?'Tự luận':'Trắc nghiệm tự động';}
    function vnDateTime(v){if(!v)return 'Không giới hạn';try{return new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v));}catch(e){return v;}}
    function localToIso(v){if(!v)return '';var d=new Date(v);return isNaN(d.getTime())?'':d.toISOString();}
    function userForAttempt(a){return users.find(function(u){return (a.employeeId&&u.employeeId===a.employeeId)||(a.accountId&&u.accountId===a.accountId);})||{};}
    function personHtml(a){var u=userForAttempt(a),name=u.name||u.fullName||u.email||'Chưa cập nhật họ tên',code=u.code||u.employeeCode||'Chưa có mã nhân viên',unit=[u.department,u.position].filter(Boolean).join(' · ')||'Chưa cập nhật phòng ban/vị trí';return '<strong>'+esc(name)+'</strong><small>'+esc(code)+'</small><small>'+esc(unit)+'</small>';}
    function draw(){
      counts();var tests=data.tests||[],assign=data.assignments||[],attempts=data.attempts||[];
      if(!tests.length){list.innerHTML='<div class="phfc-dashboard-empty"><strong>Chưa có bài kiểm tra</strong><span>Tạo bài kiểm tra độc lập hoặc tạo từ luồng lớp đào tạo.</span></div>';return;}
      if(!isManage()){
        var ownAssignments=assign.filter(function(a){return a.status==='published'&&a.canTake!==false;});
        var learnerHtml=ownAssignments.map(function(a){var t=tests.find(function(x){return x.id===a.testId;});if(!t)return '';var mine=attempts.filter(function(x){return x.assignmentId===a.id;}),active=mine.find(function(x){return x.status==='in_progress';}),done=mine.filter(function(x){return x.status!=='in_progress';}),now=Date.now(),notOpen=a.openAt&&now<new Date(a.openAt).getTime(),closed=a.closeAt&&now>new Date(a.closeAt).getTime(),disabled=notOpen||closed||(!active&&done.length>=t.maxAttempts);var state=active?'Đang làm':closed?'Đã đóng':notOpen?'Chưa mở':(done.length>=t.maxAttempts?'Đã hết lượt':'Sẵn sàng');return '<article class="phfc-test-row" data-test-id="'+esc(t.id)+'" data-assignment-id="'+esc(a.id)+'"><div><span class="phfc-status-chip">'+esc(phfcAssignmentLabel(a))+'</span><span class="phfc-status-chip">'+esc(typeLabel(t.testType))+'</span><strong>'+esc(t.title)+'</strong><small>Mở: '+esc(vnDateTime(a.openAt))+' · Đóng: '+esc(vnDateTime(a.closeAt))+'</small><small>'+t.questions.length+' câu · '+(t.durationMinutes?t.durationMinutes+' phút':'Không giới hạn thời lượng')+' · Đã làm '+done.length+'/'+t.maxAttempts+' lượt</small></div><div class="phfc-test-row-meta"><span class="phfc-status-chip">'+esc(state)+'</span></div><div class="phfc-test-row-actions"><button type="button" data-phfc-test-take '+(disabled?'disabled':'')+'>'+(active?'Tiếp tục làm':'Làm bài')+'</button></div></article>';}).join('');var gradeTests=tests.filter(function(t){return attempts.some(function(a){var as=assign.find(function(x){return x.id===a.assignmentId;});return a.testId===t.id&&a.gradingStatus==='pending'&&as&&as.canGrade;});});var gradeHtml=gradeTests.map(function(t){var count=attempts.filter(function(a){var as=assign.find(function(x){return x.id===a.assignmentId;});return a.testId===t.id&&a.gradingStatus==='pending'&&as&&as.canGrade;}).length;return '<article class="phfc-test-row" data-test-id="'+esc(t.id)+'"><div><span class="phfc-status-chip is-warning">Được phân công chấm</span><strong>'+esc(t.title)+'</strong><small>'+count+' bài làm đang chờ chấm</small></div><div class="phfc-test-row-actions"><button type="button" data-phfc-test-grade>Chấm bài</button></div></article>';}).join('');list.innerHTML=(learnerHtml+gradeHtml)||'<div class="phfc-dashboard-empty"><strong>Chưa có lần giao bài phù hợp</strong><span>Mỗi lần giao bài sẽ hiển thị riêng theo thời gian mở và đóng.</span></div>';
      }else{
        list.innerHTML=tests.map(function(t){var as=assign.filter(function(a){return a.testId===t.id;}),done=attempts.filter(function(a){return a.testId===t.id;}),pending=done.filter(function(a){return a.gradingStatus==='pending';}).length;return '<article class="phfc-test-row" data-test-id="'+esc(t.id)+'"><div><span class="phfc-status-chip is-'+esc(t.status)+'">'+esc(phfcTestStatus(t.status))+'</span><span class="phfc-status-chip">'+esc(typeLabel(t.testType))+'</span><strong>'+esc(t.title)+'</strong><small>'+t.questions.length+' câu · Điểm đạt '+t.passScore+'% · '+t.maxAttempts+' lần làm</small></div><div class="phfc-test-row-meta"><span>'+as.length+' lần giao</span><span>'+done.length+' lượt làm</span>'+(pending?'<span class="phfc-status-chip is-warning">'+pending+' chờ chấm</span>':'')+'</div><div class="phfc-test-row-actions">'+(pending?'<button type="button" data-phfc-test-grade>Chấm bài</button>':'')+'<button type="button" data-phfc-test-assign>Giao bài</button><button type="button" data-phfc-test-edit>Chỉnh sửa</button>'+(role()==='admin'?'<button type="button" class="is-danger" data-phfc-test-delete>Xóa</button>':'')+'</div></article>';}).join('');
      }
      bindRows();
    }
    function questionEditor(q,i){q=q||{};var type=q.type||'single',opts=q.options||['','','',''];while(opts.length<4)opts.push('');var checks=Array.isArray(q.correctIndexes)?q.correctIndexes:[Number(q.correctIndex||0)];return '<section class="phfc-test-question" data-question><div class="phfc-test-question-head"><strong>Câu '+(i+1)+'</strong><button type="button" data-remove-question>×</button></div><div class="phfc-test-grid"><label class="phfc-field"><span>Loại câu</span><select data-question-type><option value="single"'+(type==='single'?' selected':'')+'>Trắc nghiệm 1 đáp án</option><option value="multiple"'+(type==='multiple'?' selected':'')+'>Trắc nghiệm nhiều đáp án</option><option value="essay"'+(type==='essay'?' selected':'')+'>Tự luận</option></select></label><label class="phfc-field"><span>Điểm tối đa</span><input type="number" min="0.25" step="0.25" value="'+(q.points||1)+'" data-question-points></label></div><label class="phfc-field"><span>Nội dung câu hỏi *</span><textarea rows="2" data-question-text>'+esc(q.text||'')+'</textarea></label><div data-auto-options'+(type==='essay'?' hidden':'')+' class="phfc-test-options">'+opts.slice(0,4).map(function(o,k){return '<label><input '+(type==='multiple'?'type="checkbox"':'type="radio" name="correct-'+i+'"')+' value="'+k+'"'+(checks.indexOf(k)>=0?' checked':'')+' data-question-correct><input type="text" value="'+esc(o)+'" placeholder="Đáp án '+String.fromCharCode(65+k)+'" data-question-option></label>';}).join('')+'</div><div data-essay-options'+(type==='essay'?'':' hidden')+'><label class="phfc-field"><span>Hướng dẫn chấm</span><textarea rows="2" data-question-guide>'+esc(q.gradingGuide||'')+'</textarea></label><label class="phfc-field"><span>Giới hạn ký tự</span><input type="number" min="100" max="10000" value="'+(q.maxLength||2000)+'" data-question-maxlength></label></div></section>';}
    var phfcXlsxLoading=null;
    function phfcLoadXlsx(){
      if(window.XLSX)return Promise.resolve(window.XLSX);
      if(phfcXlsxLoading)return phfcXlsxLoading;
      phfcXlsxLoading=new Promise(function(resolve,reject){
        var script=document.createElement('script');
        script.src='assets/vendor/xlsx.full.min.js';
        script.onload=function(){window.XLSX?resolve(window.XLSX):reject(new Error('Không khởi tạo được thư viện đọc Excel.'));};
        script.onerror=function(){reject(new Error('Không tải được thư viện đọc Excel.'));};
        document.head.appendChild(script);
      });
      return phfcXlsxLoading;
    }
    function phfcExcelKey(value){
      return String(value==null?'':value).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/[^a-z0-9]/g,'');
    }
    function phfcExcelCell(row,names){
      var keys=Object.keys(row||{}),wanted=names.map(phfcExcelKey);
      for(var i=0;i<keys.length;i++)if(wanted.indexOf(phfcExcelKey(keys[i]))>=0)return row[keys[i]];
      return '';
    }
    function phfcParseQuestionRows(rows){
      return (rows||[]).map(function(row,index){
        var rawType=phfcExcelKey(phfcExcelCell(row,['Loại câu','Loai cau','Type'])),type=rawType.indexOf('tuluan')>=0||rawType==='essay'?'essay':(rawType.indexOf('nhieu')>=0||rawType==='multiple'?'multiple':'single');
        var text=String(phfcExcelCell(row,['Nội dung câu hỏi','Noi dung cau hoi','Câu hỏi','Cau hoi','Question'])||'').trim();
        var points=Number(phfcExcelCell(row,['Điểm tối đa','Diem toi da','Điểm','Diem','Points'])||1);
        var guide=String(phfcExcelCell(row,['Hướng dẫn chấm','Huong dan cham','Grading guide'])||'').trim();
        var maxLength=Number(phfcExcelCell(row,['Giới hạn ký tự','Gioi han ky tu','Max length'])||2000);
        var options=['A','B','C','D'].map(function(letter){return String(phfcExcelCell(row,['Đáp án '+letter,'Dap an '+letter,letter])||'').trim();});
        var answer=String(phfcExcelCell(row,['Đáp án đúng','Dap an dung','Đáp án','Dap an','Correct answer'])||'').toUpperCase().replace(/\s+/g,'');
        var correctIndexes=answer.split(/[,;|/]+/).filter(Boolean).map(function(x){return ['A','B','C','D'].indexOf(x);}).filter(function(x){return x>=0;});
        var errors=[];
        if(!text)errors.push('Thiếu nội dung câu hỏi');
        if(!isFinite(points)||points<=0)errors.push('Điểm tối đa phải lớn hơn 0');
        if(type!=='essay'){
          if(options.some(function(x){return !x;}))errors.push('Trắc nghiệm phải có đủ đáp án A–D');
          if(!correctIndexes.length)errors.push('Chưa xác định đáp án đúng');
          if(type==='single'&&correctIndexes.length!==1)errors.push('Câu một đáp án chỉ được chọn 1 đáp án đúng');
          if(type==='multiple'&&correctIndexes.length<2)errors.push('Câu nhiều đáp án cần ít nhất 2 đáp án đúng');
        }
        if(type==='essay'&&(!isFinite(maxLength)||maxLength<100||maxLength>10000))errors.push('Giới hạn ký tự từ 100 đến 10.000');
        return {rowNumber:index+2,question:{type:type,text:text,points:points,options:type==='essay'?[]:options,correctIndexes:type==='essay'?[]:correctIndexes,maxLength:maxLength,gradingGuide:guide},errors:errors};
      });
    }
    function openEditor(test){
      test=test||{questions:[],testType:'auto'};
      var qs=(test.questions||[]).length?test.questions:[{type:test.testType==='essay'?'essay':'single'}];
      open('<div class="phfc-test-form"><div class="phfc-test-import-toolbar"><div><strong>Nhập nhanh câu hỏi</strong><small>Dùng file Excel mẫu để kiểm tra và xem trước trước khi đưa câu hỏi vào đề.</small></div><div class="phfc-test-import-actions"><a class="phfc-secondary-button" href="assets/templates/PHF_Mau_BaiKiemTra_Classroom.xlsx" download>Tải file mẫu</a><button class="phfc-secondary-button" type="button" data-import-excel>Upload Excel</button><input type="file" accept=".xlsx,.xls" data-import-excel-file hidden></div></div><div class="phfc-test-import-preview" data-import-preview hidden></div><div class="phfc-test-grid"><label class="phfc-field phfc-field-wide"><span>Tên bài kiểm tra *</span><input data-test-title value="'+esc(test.title||'')+'"></label><label class="phfc-field"><span>Phân loại bài</span><select data-test-type><option value="auto"'+(test.testType==='auto'?' selected':'')+'>Trắc nghiệm tự động</option><option value="mixed"'+(test.testType==='mixed'?' selected':'')+'>Trắc nghiệm + tự luận</option><option value="essay"'+(test.testType==='essay'?' selected':'')+'>Tự luận</option></select></label><label class="phfc-field phfc-field-wide"><span>Mô tả</span><textarea rows="2" data-test-description>'+esc(test.description||'')+'</textarea></label><label class="phfc-field"><span>Điểm đạt (%)</span><input type="number" min="0" max="100" value="'+(test.passScore||80)+'" data-test-pass></label><label class="phfc-field"><span>Số lần làm</span><input type="number" min="1" value="'+(test.maxAttempts||1)+'" data-test-attempts></label><label class="phfc-field"><span>Thời lượng (phút)</span><input type="number" min="0" value="'+(test.durationMinutes||0)+'" data-test-duration></label><label class="phfc-field"><span>Trạng thái</span><select data-test-status><option value="draft"'+(test.status==='draft'?' selected':'')+'>Bản nháp</option><option value="published"'+(test.status==='published'?' selected':'')+'>Đã phát hành</option><option value="hidden"'+(test.status==='hidden'?' selected':'')+'>Đã ẩn</option></select></label></div><div class="phfc-test-question-list" data-question-list>'+qs.map(questionEditor).join('')+'</div><button class="phfc-secondary-button" type="button" data-add-question>+ Thêm câu hỏi</button><div class="phfc-modal-actions"><button class="phfc-secondary-button" type="button" data-phfc-test-close-local>Hủy</button><button class="phfc-primary-button" type="button" data-save-test>Lưu bài kiểm tra</button></div></div>',test.id?'Chỉnh sửa bài kiểm tra':'Tạo bài kiểm tra');
      var qlist=body.querySelector('[data-question-list]'),preview=body.querySelector('[data-import-preview]'),imported=[];
      function rebind(){
        Array.from(qlist.children).forEach(function(q,i){var title=q.querySelector('.phfc-test-question-head strong');if(title)title.textContent='Câu '+(i+1);q.querySelectorAll('input[type="radio"][data-question-correct]').forEach(function(x){x.name='correct-'+i;});});
        qlist.querySelectorAll('[data-remove-question]').forEach(function(b){b.onclick=function(){if(qlist.children.length>1){b.closest('[data-question]').remove();rebind();}};});
        qlist.querySelectorAll('[data-question-type]').forEach(function(sel){sel.onchange=function(){var box=sel.closest('[data-question]'),essay=sel.value==='essay';box.querySelector('[data-auto-options]').hidden=essay;box.querySelector('[data-essay-options]').hidden=!essay;box.querySelectorAll('[data-question-correct]').forEach(function(x){x.type=sel.value==='multiple'?'checkbox':'radio';});rebind();};});
      }
      function showPreview(results,fileName){
        imported=results;
        var valid=results.filter(function(x){return !x.errors.length;}),bad=results.length-valid.length,totalPoints=valid.reduce(function(sum,x){return sum+Number(x.question.points||0);},0);
        preview.hidden=false;
        preview.innerHTML='<div class="phfc-test-import-summary"><div><strong>'+esc(fileName)+'</strong><small>'+results.length+' dòng · '+valid.length+' hợp lệ · '+bad+' cần sửa · Tổng '+totalPoints+' điểm hợp lệ</small></div><span class="phfc-status-chip '+(bad?'is-warning':'is-published')+'">'+(bad?bad+' dòng lỗi':'Dữ liệu hợp lệ')+'</span></div><div class="phfc-test-import-table-wrap"><table class="phfc-test-import-table"><thead><tr><th>Dòng</th><th>Loại</th><th>Nội dung</th><th>Điểm</th><th>Kiểm tra</th></tr></thead><tbody>'+results.map(function(x){return '<tr class="'+(x.errors.length?'is-error':'is-valid')+'"><td>'+x.rowNumber+'</td><td>'+esc(x.question.type==='essay'?'Tự luận':x.question.type==='multiple'?'Nhiều đáp án':'Một đáp án')+'</td><td>'+esc(x.question.text||'—')+'</td><td>'+esc(x.question.points)+'</td><td>'+(x.errors.length?'<span>'+esc(x.errors.join('; '))+'</span>':'<strong>Hợp lệ</strong>')+'</td></tr>';}).join('')+'</tbody></table></div><div class="phfc-test-import-footer"><button class="phfc-secondary-button" type="button" data-cancel-import>Hủy xem trước</button><button class="phfc-primary-button" type="button" data-apply-import '+(valid.length?'':'disabled')+'>Nhập '+valid.length+' câu hợp lệ</button></div>';
        preview.querySelector('[data-cancel-import]').onclick=function(){preview.hidden=true;preview.innerHTML='';imported=[];};
        var apply=preview.querySelector('[data-apply-import]');if(apply)apply.onclick=function(){
          var validRows=imported.filter(function(x){return !x.errors.length;});
          if(qlist.children.length===1){var first=qlist.firstElementChild,txt=first&&first.querySelector('[data-question-text]');if(txt&&!txt.value.trim())first.remove();}
          validRows.forEach(function(x){var holder=document.createElement('div');holder.innerHTML=questionEditor(x.question,qlist.children.length);qlist.appendChild(holder.firstElementChild);});
          rebind();preview.hidden=true;preview.innerHTML='';imported=[];
          var types=Array.from(qlist.querySelectorAll('[data-question-type]')).map(function(x){return x.value;}),auto=types.some(function(x){return x!=='essay';}),essay=types.some(function(x){return x==='essay';});body.querySelector('[data-test-type]').value=auto&&essay?'mixed':essay?'essay':'auto';
          phfcNotice('success','Đã nhập câu hỏi','Đã đưa '+validRows.length+' câu hợp lệ vào bài kiểm tra để anh rà lại trước khi lưu.');
        };
      }
      rebind();
      body.querySelector('[data-add-question]').onclick=function(){var holder=document.createElement('div');holder.innerHTML=questionEditor({type:body.querySelector('[data-test-type]').value==='essay'?'essay':'single'},qlist.children.length);qlist.appendChild(holder.firstElementChild);rebind();};
      var fileInput=body.querySelector('[data-import-excel-file]');
      body.querySelector('[data-import-excel]').onclick=function(){fileInput.value='';fileInput.click();};
      fileInput.onchange=async function(){var file=fileInput.files&&fileInput.files[0];if(!file)return;try{phfcNotice('info','Đang đọc file Excel',file.name);var XLSX=await phfcLoadXlsx(),buffer=await file.arrayBuffer(),book=XLSX.read(buffer,{type:'array'}),sheet=book.Sheets[book.SheetNames[0]],rows=XLSX.utils.sheet_to_json(sheet,{defval:'',raw:false});if(!rows.length)throw new Error('File không có dòng dữ liệu nào.');showPreview(phfcParseQuestionRows(rows),file.name);}catch(e){phfcNotice('error','Không thể đọc file Excel',e.message||String(e));}};
      body.querySelector('[data-phfc-test-close-local]').onclick=close;
      body.querySelector('[data-save-test]').onclick=async function(){var btn=this,questions=Array.from(qlist.querySelectorAll('[data-question]')).map(function(q){var qt=q.querySelector('[data-question-type]').value,correct=Array.from(q.querySelectorAll('[data-question-correct]:checked')).map(function(x){return Number(x.value);});return {type:qt,text:q.querySelector('[data-question-text]').value,points:Number(q.querySelector('[data-question-points]').value||1),options:qt==='essay'?[]:Array.from(q.querySelectorAll('[data-question-option]')).map(function(x){return x.value;}),correctIndexes:correct,maxLength:Number((q.querySelector('[data-question-maxlength]')||{}).value||2000),gradingGuide:(q.querySelector('[data-question-guide]')||{}).value||''};});try{btn.disabled=true;var r=await phfcTestsApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveTest',id:test.id,title:body.querySelector('[data-test-title]').value,description:body.querySelector('[data-test-description]').value,testType:body.querySelector('[data-test-type]').value,passScore:Number(body.querySelector('[data-test-pass]').value),maxAttempts:Number(body.querySelector('[data-test-attempts]').value),durationMinutes:Number(body.querySelector('[data-test-duration]').value),status:body.querySelector('[data-test-status]').value,questions:questions})});phfcNotice('success','Đã lưu bài kiểm tra','Bài “'+r.test.title+'” đã được cập nhật trong ngân hàng đề.');close();await load();}catch(e){phfcNotice('error','Chưa thể lưu bài kiểm tra',e.message||String(e));}finally{btn.disabled=false;}};
    }
    function openAssign(test){var classOpts=classes.map(function(c){return '<option value="'+esc(c.id)+'">'+esc(c.classCode+' · '+c.className)+'</option>';}).join(''),userRows=users.map(function(u){return '<label class="phfc-test-person"><input type="checkbox" value="'+esc(u.employeeId||u.accountId)+'" data-account-id="'+esc(u.accountId||'')+'"><span><strong>'+esc(u.name||u.email)+'</strong><small>'+esc(u.employeeCode||u.email||'')+'</small></span></label>';}).join(''),graderOpts=users.map(function(u){return '<option value="'+esc(u.employeeId||u.accountId)+'" data-account-id="'+esc(u.accountId||'')+'">'+esc(u.name||u.email)+'</option>';}).join('');open('<div class="phfc-test-assign"><label class="phfc-field"><span>Phạm vi giao</span><select data-scope><option value="class">Theo lớp</option><option value="independent">Độc lập / đột xuất</option></select></label><div data-class-scope><label class="phfc-field"><span>Lớp áp dụng *</span><select data-class-id><option value="">Chọn lớp</option>'+classOpts+'</select></label></div><div data-independent-scope hidden><strong>Chọn nhân sự nhận bài</strong><div class="phfc-test-people">'+userRows+'</div></div>'+(test.testType!=='auto'?'<label class="phfc-field"><span>Người chấm tự luận *</span><select data-grader><option value="">Chọn người chấm</option>'+graderOpts+'</select></label>':'')+'<div class="phfc-test-grid"><label class="phfc-field"><span>Mở từ</span><input type="datetime-local" data-open-at></label><label class="phfc-field"><span>Đóng lúc</span><input type="datetime-local" data-close-at></label><label class="phfc-field"><span>Trạng thái giao</span><select data-assignment-status><option value="draft">Bản nháp</option><option value="published">Đã phát hành</option></select></label></div><div class="phfc-modal-actions"><button class="phfc-secondary-button" type="button" data-cancel>Hủy</button><button class="phfc-primary-button" type="button" data-save-assignment>Giao bài kiểm tra</button></div></div>','Giao bài · '+test.title);var scope=body.querySelector('[data-scope]'),classBox=body.querySelector('[data-class-scope]'),indBox=body.querySelector('[data-independent-scope]');scope.onchange=function(){classBox.hidden=scope.value!=='class';indBox.hidden=scope.value!=='independent';};body.querySelector('[data-cancel]').onclick=close;body.querySelector('[data-save-assignment]').onclick=async function(){var btn=this,employeeIds=[],accountIds=[];body.querySelectorAll('[data-independent-scope] input:checked').forEach(function(x){employeeIds.push(x.value);if(x.getAttribute('data-account-id'))accountIds.push(x.getAttribute('data-account-id'));});var grader=body.querySelector('[data-grader]'),graderOpt=grader&&grader.options[grader.selectedIndex];try{btn.disabled=true;await phfcTestsApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveAssignment',testId:test.id,scopeType:scope.value,classId:body.querySelector('[data-class-id]').value,assignmentType:scope.value==='class'?'final':'independent',employeeIds:employeeIds,accountIds:accountIds,graderEmployeeId:grader?grader.value:'',graderAccountId:graderOpt?graderOpt.getAttribute('data-account-id'):'',openAt:localToIso(body.querySelector('[data-open-at]').value),closeAt:localToIso(body.querySelector('[data-close-at]').value),status:body.querySelector('[data-assignment-status]').value,required:true})});phfcNotice('success','Đã giao bài kiểm tra',test.testType==='auto'?'Hệ thống sẽ tự chấm khi học viên nộp bài.':'Bài có phần tự luận đã được giao và gắn người chấm.');close();await load();}catch(e){phfcNotice('error','Chưa thể giao bài',e.message||String(e));}finally{btn.disabled=false;}};}
    async function openTake(test,assignment){
      if(!assignment){phfcNotice('warning','Chưa có lượt giao hợp lệ','Bài kiểm tra chưa được giao cho tài khoản của bạn.');return;}
      try{
        var started=await phfcTestsApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'startAttempt',assignmentId:assignment.id})}),attempt=started.attempt,source=started.test||test,questionMap={};(source.questions||[]).forEach(function(q){questionMap[q.id]=q;});var order=(attempt.questionOrder&&attempt.questionOrder.length)?attempt.questionOrder:source.questions.map(function(_,i){return i;}),ordered=order.map(function(i){return source.questions[i];}).filter(Boolean);
        var html='<div class="phfc-test-taking-head"><div><strong>'+esc(source.title)+'</strong><small>Mỗi lần giao bài được theo dõi độc lập.</small></div><b data-test-countdown></b></div><form class="phfc-test-taking">'+ordered.map(function(q,i){if(q.type==='essay')return '<fieldset data-take-question data-question-id="'+esc(q.id)+'"><legend>Câu '+(i+1)+'. '+esc(q.text)+'</legend><textarea rows="6" maxlength="'+(q.maxLength||2000)+'" data-essay-answer placeholder="Nhập câu trả lời tự luận"></textarea><small>Tối đa '+(q.maxLength||2000)+' ký tự · '+q.points+' điểm</small></fieldset>';var multiple=q.type==='multiple',oOrder=(attempt.optionOrders&&attempt.optionOrders[q.id])||q.options.map(function(_,k){return k;});return '<fieldset data-take-question data-question-id="'+esc(q.id)+'"><legend>Câu '+(i+1)+'. '+esc(q.text)+'</legend>'+oOrder.map(function(originalIndex){return '<label><input type="'+(multiple?'checkbox':'radio')+'" name="answer-'+esc(q.id)+'" value="'+originalIndex+'"><span>'+esc(q.options[originalIndex])+'</span></label>';}).join('')+'</fieldset>';}).join('')+'<div class="phfc-modal-actions"><button class="phfc-primary-button" type="button" data-submit-test>Nộp bài</button></div></form>';
        open(html,'Làm bài · '+source.title);
        var timer=null,submitting=false,countdown=body.querySelector('[data-test-countdown]'),submit=body.querySelector('[data-submit-test]');
        function answers(){return ordered.map(function(q){var field=body.querySelector('[data-question-id="'+CSS.escape(q.id)+'"]');if(q.type==='essay')return {questionId:q.id,text:field.querySelector('[data-essay-answer]').value};var xs=field.querySelectorAll('input:checked');return {questionId:q.id,selectedIndexes:Array.from(xs).map(function(x){return Number(x.value);})};});}
        async function send(auto){if(submitting)return;submitting=true;submit.disabled=true;try{var r=await phfcTestsApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'submitAttempt',attemptId:attempt.id,answers:answers()})});if(timer)clearInterval(timer);close();if(r.pendingGrading)phfcNotice('info',auto?'Đã hết giờ và nộp bài':'Đã nộp bài','Bài đang chờ người phụ trách chấm phần tự luận.');else phfcNotice(r.passed?'success':'warning',r.passed?'Đã đạt bài kiểm tra':'Chưa đạt bài kiểm tra','Kết quả: '+r.score+'%.');await load();}catch(e){submitting=false;submit.disabled=false;phfcNotice('error','Chưa thể nộp bài',e.message||String(e));}}
        submit.onclick=function(){send(false);};
        if(attempt.expiresAt){var tick=function(){var left=new Date(attempt.expiresAt).getTime()-Date.now();if(left<=0){countdown.textContent='Hết thời gian';if(timer)clearInterval(timer);send(true);return;}var sec=Math.ceil(left/1000),m=Math.floor(sec/60),ss=String(sec%60).padStart(2,'0');countdown.textContent='Còn '+m+':'+ss;};tick();timer=setInterval(tick,1000);}else countdown.textContent='Không giới hạn thời lượng';
      }catch(e){phfcNotice('error','Chưa thể bắt đầu bài kiểm tra',e.message||String(e));}
    }
    function openGrade(test){
      var rows=(data.attempts||[]).filter(function(a){return a.testId===test.id&&(a.gradingStatus==='pending'||a.gradingStatus==='graded');});
      if(!rows.length){phfcNotice('info','Không có bài chờ chấm','Hiện chưa có bài tự luận nào cần chấm.');return;}
      function openAttempt(attempt){open('<div class="phfc-test-grading"><div class="phfc-test-grading-head"><div>'+personHtml(attempt)+'</div><span class="phfc-status-chip">'+(attempt.gradingStatus==='graded'?'Đã chấm':'Chờ chấm')+'</span></div>'+test.questions.filter(function(q){return q.type==='essay';}).map(function(q){var a=(attempt.answers||[]).find(function(x){return x.questionId===q.id;})||{};return '<section class="phfc-test-question" data-grade-question data-question-id="'+esc(q.id)+'"><strong>'+esc(q.text)+'</strong><p class="phfc-essay-answer">'+esc(a.text||'Chưa có câu trả lời')+'</p>'+(q.gradingGuide?'<small>Hướng dẫn chấm: '+esc(q.gradingGuide)+'</small>':'')+'<div class="phfc-test-grid"><label class="phfc-field"><span>Điểm / '+q.points+'</span><input type="number" min="0" max="'+q.points+'" step="0.25" value="'+(a.pointsAwarded==null?'':a.pointsAwarded)+'" data-grade-points></label><label class="phfc-field"><span>Nhận xét câu</span><input value="'+esc(a.graderNote||'')+'" data-grade-note></label></div></section>';}).join('')+'<label class="phfc-field"><span>Nhận xét chung</span><textarea rows="3" data-grade-comment>'+esc(attempt.graderComment||'')+'</textarea></label><div class="phfc-modal-actions"><button class="phfc-secondary-button" type="button" data-back-grade>Quay lại danh sách</button>'+(attempt.gradingStatus!=='graded'?'<button class="phfc-primary-button" type="button" data-save-grade>Hoàn tất chấm</button>':'')+'</div></div>','Chấm bài · '+test.title);body.querySelector('[data-back-grade]').onclick=function(){openGrade(test);};var save=body.querySelector('[data-save-grade]');if(save)save.onclick=async function(){var btn=this,scores=Array.from(body.querySelectorAll('[data-grade-question]')).map(function(q){return {questionId:q.getAttribute('data-question-id'),points:Number(q.querySelector('[data-grade-points]').value),note:q.querySelector('[data-grade-note]').value};});try{btn.disabled=true;var r=await phfcTestsApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'gradeAttempt',attemptId:attempt.id,essayScores:scores,comment:body.querySelector('[data-grade-comment]').value})});phfcNotice(r.attempt.passed?'success':'warning','Đã hoàn tất chấm','Điểm cuối: '+r.attempt.score+'% · '+(r.attempt.passed?'Đạt':'Chưa đạt'));await load();openGrade(test);}catch(e){phfcNotice('error','Chưa thể hoàn tất chấm',e.message||String(e));}finally{btn.disabled=false;}};}
      open('<div class="phfc-grade-queue"><div class="phfc-grade-queue-head"><strong>Danh sách bài làm</strong><span>'+rows.filter(function(x){return x.gradingStatus==='pending';}).length+' bài chờ chấm</span></div>'+rows.map(function(a){return '<button type="button" data-grade-attempt="'+esc(a.id)+'"><span>'+personHtml(a)+'</span><em class="phfc-status-chip">'+(a.gradingStatus==='graded'?'Đã chấm':'Chờ chấm')+'</em><small>Nộp: '+esc(vnDateTime(a.submittedAt))+'</small></button>';}).join('')+'</div>','Chấm bài · '+test.title);body.querySelectorAll('[data-grade-attempt]').forEach(function(b){b.onclick=function(){openAttempt(rows.find(function(x){return x.id===b.getAttribute('data-grade-attempt');}));};});
    }
    function bindRows(){
      list.querySelectorAll('[data-phfc-test-delete]').forEach(function(b){b.onclick=async function(){var row=b.closest('[data-test-id]');try{await phfcSoftDelete('test',row.getAttribute('data-test-id'),'bài kiểm tra',load);}catch(e){phfcNotice('error','Chưa thể xóa bài kiểm tra',e.message||String(e));}};});list.querySelectorAll('[data-phfc-test-edit]').forEach(function(b){b.onclick=function(){openEditor(data.tests.find(function(t){return t.id===b.closest('[data-test-id]').getAttribute('data-test-id');}));};});
      list.querySelectorAll('[data-phfc-test-assign]').forEach(function(b){b.onclick=function(){openAssign(data.tests.find(function(t){return t.id===b.closest('[data-test-id]').getAttribute('data-test-id');}));};});
      list.querySelectorAll('[data-phfc-test-take]').forEach(function(b){b.onclick=function(){var row=b.closest('[data-assignment-id]'),assignment=data.assignments.find(function(a){return a.id===row.getAttribute('data-assignment-id');}),test=data.tests.find(function(t){return t.id===assignment.testId;});openTake(test,assignment);};});
      list.querySelectorAll('[data-phfc-test-grade]').forEach(function(b){b.onclick=function(){openGrade(data.tests.find(function(t){return t.id===b.closest('[data-test-id]').getAttribute('data-test-id');}));};});
    }
    async function load(){try{var results=await Promise.all([phfcTestsApi(),loadClassroomClasses(false).catch(function(){return [];}),isManage()?phfcLoadClassroomUsers(false).catch(function(){return [];}):Promise.resolve([])]);data=results[0];classes=results[1]||[];users=results[2]||[];draw();}catch(e){list.innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tải bài kiểm tra</strong><span>'+esc(e.message||String(e))+'</span></div>';}}
    var create=root.querySelector('[data-phfc-test-create]');if(create)create.onclick=function(){openEditor(null);};load();
  }


  function phfcResultsWorkspace(){
    var learner=role()==='learner';
    return '<section class="phfc-results-workspace" data-phfc-results>'+ 
      '<section class="phfc-card phfc-results-toolbar"><label class="phfc-field"><span>Khóa học</span><select data-phfc-results-class><option value="">-- Chọn khóa học --</option></select></label><div class="phfc-results-note"><strong>Tổng hợp kết quả đào tạo</strong><span>'+(learner?'Theo dõi kết quả học tập của bạn trong từng khóa.':'Gom điểm danh, tài liệu và bài kiểm tra theo từng học viên.')+'</span></div></section>'+ 
      '<section class="phfc-results-kpis" data-phfc-results-kpis hidden>'+ 
        '<article><span>Học viên</span><strong data-result-kpi="learners">0</strong><small>được phân công</small></article>'+ 
        '<article><span>Điểm danh</span><strong data-result-kpi="attendance">0%</strong><small>tỷ lệ hiện diện</small></article>'+ 
        '<article><span>Tài liệu</span><strong data-result-kpi="materials">0%</strong><small>hoàn thành bắt buộc</small></article>'+ 
        '<article><span>Bài kiểm tra</span><strong data-result-kpi="tests">0%</strong><small>đạt bài bắt buộc</small></article>'+ 
        '<article><span>Hoàn thành</span><strong data-result-kpi="completed">0</strong><small>học viên đủ yêu cầu</small></article>'+ 
      '</section>'+ 
      '<section class="phfc-card phfc-results-body"><div class="phfc-results-head"><div><strong>Kết quả học viên</strong><span data-phfc-results-summary>Chọn khóa học để xem kết quả.</span></div>'+(!learner?'<div class="phfc-results-filters"><button type="button" class="active" data-results-filter="all">Tất cả</button><button type="button" data-results-filter="attention">Cần xử lý</button><button type="button" data-results-filter="completed">Hoàn thành</button></div>':'')+'</div><div data-phfc-results-holder><div class="phfc-class-loading">Chọn khóa học để tổng hợp kết quả.</div></div></section>'+ 
      '<div class="phfc-modal-overlay" data-phfc-result-detail-overlay hidden><section class="phfc-modal-card phfc-result-detail-modal"><div class="phfc-user-picker-head"><div><h3>Chi tiết kết quả học viên</h3><p data-phfc-result-detail-person></p></div><button type="button" data-result-detail-close aria-label="Đóng">×</button></div><div data-phfc-result-detail-body></div><div class="phfc-user-picker-foot"><button type="button" class="phfc-secondary-button" data-result-detail-close>Đóng</button></div></section></div>'+ 
    '</section>';
  }
  function phfcResultKey(x){return String((x&&x.employeeId)||'')+'|'+String((x&&x.accountId)||'');}
  function phfcResultStatus(row,expired){
    var hasRequirements=row.materialRequired>0||row.testRequired>0;
    var complete=hasRequirements&&row.materialCompleted>=row.materialRequired&&row.testPassed>=row.testRequired;
    if(complete)return {key:'completed',label:'Hoàn thành'};
    if(expired)return {key:'attention',label:'Quá hạn chưa hoàn thành'};
    if(row.materialOpened||row.testAttempted||row.attendanceMarked)return {key:'learning',label:'Đang học'};
    return {key:'not_started',label:'Chưa bắt đầu'};
  }
  async function hydrateResults(root){
    var ws=root.querySelector('[data-phfc-results]');if(!ws)return;
    var select=ws.querySelector('[data-phfc-results-class]'),holder=ws.querySelector('[data-phfc-results-holder]'),kpis=ws.querySelector('[data-phfc-results-kpis]'),summary=ws.querySelector('[data-phfc-results-summary]'),overlay=ws.querySelector('[data-phfc-result-detail-overlay]'),detailPerson=ws.querySelector('[data-phfc-result-detail-person]'),detailBody=ws.querySelector('[data-phfc-result-detail-body]');
    var classes=[],users=[],rows=[],currentClass=null,currentFilter='all',learner=role()==='learner';
    function userFor(en){return users.find(function(u){return (en.employeeId&&u.employeeId===en.employeeId)||(en.accountId&&u.accountId===en.accountId);})||{};}
    function person(en){var u=userFor(en),emp=u.employee||{};return {name:u.name||u.fullName||emp.fullName||u.email||'Học viên',code:u.employeeCode||u.code||emp.employeeCode||'—',department:u.department||emp.department||'',position:u.position||emp.position||''};}
    function pct(a,b){return b?Math.round(a*100/b):0;}
    function setKpi(key,value){var el=ws.querySelector('[data-result-kpi="'+key+'"]');if(el)el.textContent=String(value);}
    function closeDetail(){if(overlay)overlay.hidden=true;}
    ws.querySelectorAll('[data-result-detail-close]').forEach(function(b){b.onclick=closeDetail;});if(overlay)overlay.onclick=function(e){if(e.target===overlay)closeDetail();};
    function detail(row){var p=person(row.enrollment),attPct=pct(row.attendancePresent,row.attendanceTotal),matPct=pct(row.materialCompleted,row.materialRequired),testPct=pct(row.testPassed,row.testRequired);detailPerson.textContent=p.name+' · '+p.code+(p.department||p.position?' · '+[p.department,p.position].filter(Boolean).join(' / '):'');detailBody.innerHTML='<div class="phfc-result-detail-grid"><article><span>Điểm danh</span><strong>'+attPct+'%</strong><small>'+row.attendancePresent+'/'+row.attendanceTotal+' buổi hiện diện</small></article><article><span>Tài liệu bắt buộc</span><strong>'+matPct+'%</strong><small>'+row.materialCompleted+'/'+row.materialRequired+' đã xác nhận</small></article><article><span>Bài kiểm tra bắt buộc</span><strong>'+testPct+'%</strong><small>'+row.testPassed+'/'+row.testRequired+' đã đạt</small></article></div><div class="phfc-result-detail-sections"><section><strong>Điểm danh</strong><p>Có mặt/Đi trễ: '+row.attendancePresent+' · Có phép: '+row.attendanceExcused+' · Vắng: '+row.attendanceAbsent+' · Chưa điểm danh: '+Math.max(0,row.attendanceTotal-row.attendanceMarked)+'</p></section><section><strong>Tài liệu</strong><p>Đã mở: '+row.materialOpened+' · Đã xác nhận: '+row.materialCompleted+' · Tổng bắt buộc: '+row.materialRequired+'</p></section><section><strong>Bài kiểm tra</strong><p>Đã làm: '+row.testAttempted+' · Đã đạt: '+row.testPassed+' · Đang chờ chấm: '+row.testPending+' · Tổng bài bắt buộc: '+row.testRequired+'</p></section></div>';overlay.hidden=false;}
    function draw(){
      var filtered=rows.filter(function(r){return currentFilter==='all'||r.resultStatus.key===currentFilter;});
      if(!filtered.length){holder.innerHTML='<div class="phfc-schedule-empty"><strong>Không có học viên trong nhóm này</strong><span>Chọn bộ lọc khác để xem kết quả.</span></div>';return;}
      holder.innerHTML='<div class="phfc-results-table"><div class="phfc-results-table-head"><span>Học viên</span><span>Điểm danh</span><span>Tài liệu</span><span>Bài kiểm tra</span><span>Trạng thái</span><span></span></div>'+filtered.map(function(r){var p=person(r.enrollment),att=pct(r.attendancePresent,r.attendanceTotal),mat=pct(r.materialCompleted,r.materialRequired),test=pct(r.testPassed,r.testRequired);return '<article data-result-row="'+esc(phfcResultKey(r.enrollment))+'"><div class="phfc-result-person"><span class="phfc-user-avatar">'+esc(phfcInitials(p.name))+'</span><span><strong>'+esc(p.name)+'</strong><small>'+esc(p.code)+'</small><small>'+esc([p.department,p.position].filter(Boolean).join(' · '))+'</small></span></div><div><b>'+att+'%</b><small>'+r.attendancePresent+'/'+r.attendanceTotal+' buổi</small></div><div><b>'+mat+'%</b><small>'+r.materialCompleted+'/'+r.materialRequired+' bắt buộc</small></div><div><b>'+test+'%</b><small>'+r.testPassed+'/'+r.testRequired+' đạt</small></div><span class="phfc-status-chip is-'+esc(r.resultStatus.key)+'">'+esc(r.resultStatus.label)+'</span><button type="button" data-result-detail>Xem chi tiết</button></article>';}).join('')+'</div>';
      holder.querySelectorAll('[data-result-detail]').forEach(function(b){b.onclick=function(){var key=b.closest('[data-result-row]').getAttribute('data-result-row'),row=rows.find(function(x){return phfcResultKey(x.enrollment)===key;});if(row)detail(row);};});
    }
    async function load(){
      var classId=select.value;if(!classId){kpis.hidden=true;summary.textContent='Chọn khóa học để xem kết quả.';holder.innerHTML='<div class="phfc-class-loading">Chọn khóa học để tổng hợp kết quả.</div>';return;}
      currentClass=classes.find(function(c){return c.id===classId;});holder.innerHTML='<div class="phfc-class-loading">Đang tổng hợp điểm danh, tài liệu và bài kiểm tra…</div>';
      try{
        var sessions=(currentClass.sessions||[]).filter(function(s){return s&&s.id&&String(s.status||'').toLowerCase()!=='cancelled';});
        var result=await Promise.all([phfcMaterialsApi(classId).catch(function(){return {materials:[],progress:[],learnerSummaries:[]};}),phfcTestsApi().catch(function(){return {tests:[],assignments:[],attempts:[]};}),Promise.all(sessions.map(function(s){return phfcAttendanceApi(s.id).catch(function(){return {rows:[]};});}))]);
        var materials=result[0],tests=result[1],attendance=result[2],enrollments=currentClass.enrollments||[],requiredMaterials=(materials.materials||[]).filter(function(m){return m.status==='published'&&m.required;}),classAssignments=(tests.assignments||[]).filter(function(a){return a.classId===classId&&(a.status==='published'||a.status==='closed')&&a.required!==false;}),attempts=tests.attempts||[];
        rows=enrollments.map(function(en){var key=phfcResultKey(en),row={enrollment:en,attendanceTotal:sessions.length,attendanceMarked:0,attendancePresent:0,attendanceExcused:0,attendanceAbsent:0,materialRequired:requiredMaterials.length,materialCompleted:0,materialOpened:0,testRequired:classAssignments.length,testPassed:0,testAttempted:0,testPending:0};
          attendance.forEach(function(a){var ar=(a.rows||[]).find(function(x){return phfcResultKey(x)===key;});if(!ar)return;var st=ar.status||'unmarked';if(st!=='unmarked')row.attendanceMarked++;if(st==='present'||st==='late')row.attendancePresent++;else if(st==='excused')row.attendanceExcused++;else if(st==='absent')row.attendanceAbsent++;});
          var progress=(materials.progress||[]).filter(function(pr){return pr.enrollmentId===en.id;});row.materialOpened=new Set(progress.filter(function(pr){return pr.status==='opened'||pr.status==='completed';}).map(function(pr){return pr.materialId;})).size;row.materialCompleted=requiredMaterials.filter(function(m){return progress.some(function(pr){return pr.materialId===m.id&&pr.status==='completed';});}).length;
          classAssignments.forEach(function(a){var own=attempts.filter(function(at){return at.assignmentId===a.id&&((en.employeeId&&at.employeeId===en.employeeId)||(en.accountId&&at.accountId===en.accountId));});if(own.length)row.testAttempted++;if(own.some(function(at){return at.passed===true;}))row.testPassed++;if(own.some(function(at){return at.gradingStatus==='pending';}))row.testPending++;});
          row.resultStatus=phfcResultStatus(row,!!(currentClass.endAt&&Date.now()>new Date(currentClass.endAt).getTime()));return row;});
        if(learner){var me=rows.filter(function(r){var u=userFor(r.enrollment);return (window.__phfSession&&window.__phfSession.employeeId&&r.enrollment.employeeId===window.__phfSession.employeeId)||(window.__phfSession&&window.__phfSession.account&&r.enrollment.accountId===window.__phfSession.account.id)||(u.isCurrent===true);});if(me.length)rows=me;}
        var totalAtt=rows.reduce(function(s,r){return s+r.attendanceTotal;},0),present=rows.reduce(function(s,r){return s+r.attendancePresent;},0),matTotal=rows.reduce(function(s,r){return s+r.materialRequired;},0),matDone=rows.reduce(function(s,r){return s+r.materialCompleted;},0),testTotal=rows.reduce(function(s,r){return s+r.testRequired;},0),testDone=rows.reduce(function(s,r){return s+r.testPassed;},0),completed=rows.filter(function(r){return r.resultStatus.key==='completed';}).length;
        setKpi('learners',rows.length);setKpi('attendance',pct(present,totalAtt)+'%');setKpi('materials',pct(matDone,matTotal)+'%');setKpi('tests',pct(testDone,testTotal)+'%');setKpi('completed',completed);kpis.hidden=false;summary.textContent=(currentClass.className||'Khóa học')+' · '+rows.length+' học viên · '+sessions.length+' buổi';draw();
      }catch(e){holder.innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tổng hợp kết quả</strong><span>'+esc(e.message||String(e))+'</span></div>';}
    }
    try{var base=await Promise.all([loadClassroomClasses(false),phfcLoadClassroomUsers(false).catch(function(){return [];})]);classes=base[0]||[];users=base[1]||[];select.innerHTML='<option value="">-- Chọn khóa học --</option>'+classes.map(function(c){return '<option value="'+esc(c.id)+'">'+esc((c.classCode||'')+' · '+c.className)+'</option>';}).join('');if(classes.length===1){select.value=classes[0].id;load();}}catch(e){holder.innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tải khóa học</strong><span>'+esc(e.message||String(e))+'</span></div>';}
    select.onchange=load;ws.querySelectorAll('[data-results-filter]').forEach(function(b){b.onclick=function(){currentFilter=b.getAttribute('data-results-filter')||'all';ws.querySelectorAll('[data-results-filter]').forEach(function(x){x.classList.toggle('active',x===b);});draw();};});
  }


  function phfcProposalWorkspace(){
    var reportOnly=/\/bao-cao$/.test(cleanPath(location.pathname));
    return '<section class="phfc-proposal-workspace" data-phfc-proposals data-report-only="'+(reportOnly?'1':'0')+'">'+ 
      '<section class="phfc-card phfc-proposal-head"><div><span class="phfc-eyebrow">Phê duyệt và theo dõi</span><h3>'+(reportOnly?'Báo cáo':'Đề xuất đào tạo')+'</h3><p>'+(reportOnly?'Theo dõi toàn bộ tình hình tiếp nhận, xử lý và chuyển đề xuất thành lớp đào tạo.':'Mọi nhân sự có thể gửi nhu cầu đào tạo. Chỉ Admin phê duyệt và chuyển đề xuất thành lớp.')+'</p></div>'+(reportOnly?'':'<button type="button" class="phfc-primary-button" data-proposal-new>＋ Tạo đề xuất</button>')+'</section>'+ 
      '<section class="phfc-proposal-kpis" data-proposal-kpis '+(reportOnly?'hidden':'')+'></section>'+ 
      '<section class="phfc-card phfc-proposal-report" data-proposal-report '+(reportOnly?'':'hidden')+'><div class="phfc-proposal-report-head"><div><span class="phfc-eyebrow">Báo cáo</span><h3>Tình hình tiếp nhận và chuyển đổi</h3><p>Theo dõi số lượng, tốc độ xử lý và tỷ lệ đề xuất đã chuyển thành lớp.</p></div><label><strong>Khoảng thời gian</strong><select data-proposal-report-range><option value="30">30 ngày gần nhất</option><option value="90">90 ngày gần nhất</option><option value="all">Toàn bộ</option></select></label></div><div class="phfc-proposal-report-metrics" data-proposal-report-metrics></div><div class="phfc-proposal-report-grid"><section><h4>Theo mức độ ưu tiên</h4><div data-proposal-priority-breakdown></div></section><section><h4>Theo phạm vi đề xuất</h4><div data-proposal-scope-breakdown></div></section></div><div class="phfc-proposal-report-table-wrap"><table class="phfc-proposal-report-table"><thead><tr><th>Đề xuất</th><th>Đối tượng</th><th>Ưu tiên</th><th>Ngày gửi</th><th>Thời gian xử lý</th><th>Trạng thái</th></tr></thead><tbody data-proposal-report-rows></tbody></table></div></section>'+ 
      '<section class="phfc-card phfc-proposal-panel" '+(reportOnly?'hidden':'')+'><div class="phfc-proposal-toolbar"><label><strong>Tìm đề xuất</strong><input type="search" placeholder="Nội dung, đối tượng, lý do..." data-proposal-search></label><label><strong>Trạng thái</strong><select data-proposal-status><option value="">Tất cả trạng thái</option><option value="draft">Bản nháp</option><option value="pending">Chờ duyệt</option><option value="needs_revision">Cần bổ sung</option><option value="approved">Đã duyệt</option><option value="rejected">Từ chối</option><option value="converted">Đã chuyển thành lớp</option><option value="completed">Hoàn tất</option></select></label></div><div data-proposal-list><div class="phfc-class-loading">Đang tải đề xuất đào tạo…</div></div></section>'+ 
    '</section>';
  }

  async function phfcProposalApi(options){return classroomRequest('/api/data?classroomProposals=1',options);}
  async function phfcNotificationsApi(options){return classroomRequest('/api/data?classroomNotifications=1',options);}
  function phfcProposalStatus(v){var m={draft:'Bản nháp',pending:'Chờ duyệt',needs_revision:'Cần bổ sung',approved:'Đã duyệt',rejected:'Từ chối',converted:'Đã chuyển thành lớp',completed:'Hoàn tất'};return m[v]||'Bản nháp';}
  function phfcProposalPriority(v){var m={low:'Thấp',normal:'Bình thường',high:'Cao',urgent:'Khẩn'};return m[v]||'Bình thường';}
  function phfcProposalScope(v){var m={self:'Bản thân',department:'Nhóm/phòng ban',people:'Nhân sự cụ thể',company:'Toàn công ty'};return m[v]||'Bản thân';}
  function phfcProposalModal(row,onSaved){
    row=row||{};var overlay=document.createElement('div');overlay.className='phfc-modal-overlay phfc-proposal-overlay';overlay.innerHTML='<section class="phfc-modal-card phfc-proposal-modal" role="dialog" aria-modal="true"><div class="phfc-user-picker-head"><div><h3>'+(row.id?'Chỉnh sửa đề xuất':'Tạo đề xuất đào tạo')+'</h3><p>Form ngắn gọn, tập trung đúng nhu cầu đào tạo cần xử lý.</p></div><button type="button" data-close aria-label="Đóng">×</button></div><div class="phfc-proposal-form"><label class="phfc-field phfc-field-wide"><span>Nội dung cần đào tạo <b>*</b></span><input type="text" maxlength="180" data-p-title value="'+esc(row.title||'')+'"></label><label class="phfc-field phfc-field-wide"><span>Lý do <b>*</b></span><textarea rows="3" maxlength="1000" data-p-reason>'+esc(row.reason||'')+'</textarea></label><label class="phfc-field"><span>Đề xuất cho <b>*</b></span><select data-p-scope><option value="self">Bản thân</option><option value="department">Nhóm/phòng ban</option><option value="people">Nhân sự cụ thể</option><option value="company">Toàn công ty</option></select></label><label class="phfc-field"><span>Mức độ ưu tiên <b>*</b></span><select data-p-priority><option value="low">Thấp</option><option value="normal">Bình thường</option><option value="high">Cao</option><option value="urgent">Khẩn</option></select></label><label class="phfc-field phfc-field-wide"><span>Đối tượng cần đào tạo <b>*</b></span><input type="text" maxlength="500" data-p-audience value="'+esc(row.targetAudience||'')+'" placeholder="Ví dụ: Nhân viên bán hàng hiện hữu"></label><label class="phfc-field phfc-field-wide"><span>Kết quả mong muốn <b>*</b></span><textarea rows="3" maxlength="1000" data-p-outcome>'+esc(row.expectedOutcome||'')+'</textarea></label><label class="phfc-field phfc-field-wide"><span>Ghi chú <small>(không bắt buộc)</small></span><textarea rows="2" maxlength="500" data-p-note>'+esc(row.note||'')+'</textarea></label></div><div class="phfc-modal-actions phfc-proposal-actions"><button type="button" class="phfc-secondary-button" data-draft>Lưu nháp</button><button type="button" class="phfc-primary-button" data-submit>Gửi duyệt</button></div></section>';document.body.appendChild(overlay);overlay.querySelector('[data-p-scope]').value=row.targetScope||'self';overlay.querySelector('[data-p-priority]').value=row.priority||'normal';function close(){overlay.remove();}overlay.querySelector('[data-close]').onclick=close;overlay.onclick=function(e){if(e.target===overlay)close();};async function save(action,btn){var payload={action:action,id:row.id||'',title:overlay.querySelector('[data-p-title]').value,reason:overlay.querySelector('[data-p-reason]').value,targetScope:overlay.querySelector('[data-p-scope]').value,priority:overlay.querySelector('[data-p-priority]').value,targetAudience:overlay.querySelector('[data-p-audience]').value,expectedOutcome:overlay.querySelector('[data-p-outcome]').value,note:overlay.querySelector('[data-p-note]').value,targetDetails:{}};try{btn.disabled=true;await phfcProposalApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});phfcNotice('success',action==='submit'?'Đã gửi đề xuất':'Đã lưu bản nháp',action==='submit'?'Admin sẽ tiếp nhận và xử lý đề xuất đào tạo.':'Bạn có thể tiếp tục chỉnh sửa trước khi gửi duyệt.');close();onSaved();}catch(e){phfcNotice('error','Chưa thể lưu đề xuất',e.message||String(e));}finally{btn.disabled=false;}}overlay.querySelector('[data-draft]').onclick=function(){save('saveDraft',this);};overlay.querySelector('[data-submit]').onclick=function(){save('submit',this);};
  }
  function phfcProposalReviewModal(row,onSaved){var overlay=document.createElement('div');overlay.className='phfc-modal-overlay';overlay.innerHTML='<section class="phfc-modal-card phfc-proposal-review"><div class="phfc-user-picker-head"><div><h3>Xử lý đề xuất</h3><p>'+esc(row.title)+'</p></div><button type="button" data-close>×</button></div><div class="phfc-proposal-review-body"><p><strong>Lý do:</strong> '+esc(row.reason)+'</p><p><strong>Đối tượng:</strong> '+esc(row.targetAudience)+'</p><p><strong>Kết quả mong muốn:</strong> '+esc(row.expectedOutcome)+'</p><label class="phfc-field"><span>Phản hồi của Admin</span><textarea rows="3" data-comment placeholder="Bắt buộc khi yêu cầu bổ sung hoặc từ chối"></textarea></label></div><div class="phfc-proposal-review-actions"><button type="button" class="phfc-secondary-button" data-action="requestRevision">Yêu cầu bổ sung</button><button type="button" class="phfc-danger-button" data-action="reject">Từ chối</button><button type="button" class="phfc-primary-button" data-action="approve">Duyệt đề xuất</button></div></section>';document.body.appendChild(overlay);function close(){overlay.remove();}overlay.querySelector('[data-close]').onclick=close;overlay.querySelectorAll('[data-action]').forEach(function(b){b.onclick=async function(){try{b.disabled=true;await phfcProposalApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:b.getAttribute('data-action'),id:row.id,comment:overlay.querySelector('[data-comment]').value})});phfcNotice('success','Đã cập nhật đề xuất','Trạng thái đề xuất đã được lưu.');close();onSaved();}catch(e){phfcNotice('error','Chưa thể xử lý đề xuất',e.message||String(e));}finally{b.disabled=false;}};});}
  async function hydrateProposals(root){var ws=root.querySelector('[data-phfc-proposals]');if(!ws)return;var list=ws.querySelector('[data-proposal-list]'),search=ws.querySelector('[data-proposal-search]'),status=ws.querySelector('[data-proposal-status]'),report=ws.querySelector('[data-proposal-report]'),reportRange=ws.querySelector('[data-proposal-report-range]'),rows=[],canReview=false,canReport=false,reportOnly=ws.getAttribute('data-report-only')==='1';
    function hoursBetween(a,b){var x=new Date(a||0).getTime(),y=new Date(b||0).getTime();return x&&y&&y>=x?(y-x)/36e5:null;}
    function shortDate(value){if(!value)return '—';try{return new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(value));}catch(e){return '—';}}
    function durationLabel(hours){if(hours==null)return 'Chưa xử lý';if(hours<1)return Math.max(1,Math.round(hours*60))+' phút';if(hours<24)return Math.round(hours*10)/10+' giờ';return Math.round(hours/24*10)/10+' ngày';}
    function reportRows(){var days=reportRange&&reportRange.value!=='all'?Number(reportRange.value):0,cutoff=days?Date.now()-days*864e5:0;return rows.filter(function(x){var t=new Date(x.submittedAt||x.createdAt||0).getTime();return !cutoff||t>=cutoff;});}
    function renderBreakdown(target,items,total){target.innerHTML=items.map(function(item){var pct=total?Math.round(item.count*100/total):0;return '<div class="phfc-proposal-breakdown-row"><span>'+esc(item.label)+'</span><div><i style="width:'+pct+'%"></i></div><strong>'+item.count+'</strong></div>';}).join('')||'<p class="phfc-proposal-report-empty">Chưa có dữ liệu.</p>';}
    function renderReport(){if(!canReport||!report||!reportOnly)return;report.hidden=false;var data=reportRows(),submitted=data.filter(function(x){return x.status!=='draft';}),reviewed=submitted.filter(function(x){return x.reviewedAt;}),converted=data.filter(function(x){return x.status==='converted'||x.status==='completed';}),pending=data.filter(function(x){return x.status==='pending';}),rejected=data.filter(function(x){return x.status==='rejected';}),durations=reviewed.map(function(x){return hoursBetween(x.submittedAt,x.reviewedAt);}).filter(function(x){return x!=null;}),avg=durations.length?durations.reduce(function(a,b){return a+b;},0)/durations.length:null,conversion=submitted.length?Math.round(converted.length*100/submitted.length):0;
      ws.querySelector('[data-proposal-report-metrics]').innerHTML='<article><span>Tổng đề xuất</span><strong>'+data.length+'</strong></article><article><span>Đang chờ duyệt</span><strong>'+pending.length+'</strong></article><article><span>Đã chuyển thành lớp</span><strong>'+converted.length+'</strong><small>'+conversion+'% đề xuất đã gửi</small></article><article><span>Thời gian xử lý TB</span><strong>'+esc(durationLabel(avg))+'</strong></article><article><span>Từ chối</span><strong>'+rejected.length+'</strong></article>';
      var priorities=['urgent','high','normal','low'].map(function(v){return {label:phfcProposalPriority(v),count:data.filter(function(x){return x.priority===v;}).length};}),scopes=['self','department','people','company'].map(function(v){return {label:phfcProposalScope(v),count:data.filter(function(x){return x.targetScope===v;}).length};});
      renderBreakdown(ws.querySelector('[data-proposal-priority-breakdown]'),priorities,data.length);renderBreakdown(ws.querySelector('[data-proposal-scope-breakdown]'),scopes,data.length);
      var recent=data.slice().sort(function(a,b){return new Date(b.submittedAt||b.createdAt||0)-new Date(a.submittedAt||a.createdAt||0);}).slice(0,12);ws.querySelector('[data-proposal-report-rows]').innerHTML=recent.length?recent.map(function(x){return '<tr><td><strong>'+esc(x.title)+'</strong><small>'+esc(phfcProposalScope(x.targetScope))+'</small></td><td>'+esc(x.targetAudience||'—')+'</td><td><span class="phfc-status-chip is-priority-'+esc(x.priority)+'">'+esc(phfcProposalPriority(x.priority))+'</span></td><td>'+esc(shortDate(x.submittedAt||x.createdAt))+'</td><td>'+esc(durationLabel(hoursBetween(x.submittedAt,x.reviewedAt)))+'</td><td><span class="phfc-status-chip is-'+esc(x.status)+'">'+esc(phfcProposalStatus(x.status))+'</span></td></tr>';}).join(''):'<tr><td colspan="6" class="phfc-proposal-report-empty">Chưa có đề xuất trong khoảng thời gian này.</td></tr>';
    }
    function draw(){var q=norm(search.value),st=status.value,filtered=rows.filter(function(x){return (!st||x.status===st)&&(!q||norm([x.title,x.reason,x.targetAudience,x.expectedOutcome].join(' ')).indexOf(q)>=0);});list.innerHTML=filtered.length?'<div class="phfc-proposal-list">'+filtered.map(function(x){var editable=['draft','needs_revision'].includes(x.status);return '<article class="phfc-proposal-row"><div><span class="phfc-status-chip is-'+esc(x.status)+'">'+esc(phfcProposalStatus(x.status))+'</span><h4>'+esc(x.title)+'</h4><p>'+esc(x.reason)+'</p><small>'+esc(phfcProposalScope(x.targetScope))+' · '+esc(x.targetAudience)+' · Ưu tiên '+esc(phfcProposalPriority(x.priority))+'</small>'+(x.adminComment?'<em>Phản hồi Admin: '+esc(x.adminComment)+'</em>':'')+'</div><div class="phfc-proposal-row-actions">'+(editable?'<button type="button" data-edit="'+esc(x.id)+'">Chỉnh sửa</button>':'')+(canReview&&x.status==='pending'?'<button type="button" class="is-primary" data-review="'+esc(x.id)+'">Xử lý</button>':'')+(canReview&&x.status==='approved'?'<button type="button" class="is-primary" data-create-class="'+esc(x.id)+'">Tạo lớp</button>':'')+(x.classId?'<button type="button" data-open-class="'+esc(x.classId)+'">Xem lớp</button>':'')+(role()==='admin'?'<button type="button" class="is-danger" data-delete-proposal="'+esc(x.id)+'">Xóa</button>':'')+'</div></article>';}).join('')+'</div>':'<div class="phfc-schedule-empty"><strong>Chưa có đề xuất phù hợp</strong><span>Tạo đề xuất mới hoặc chọn bộ lọc khác.</span></div>';list.querySelectorAll('[data-edit]').forEach(function(b){b.onclick=function(){phfcProposalModal(rows.find(function(x){return x.id===b.getAttribute('data-edit');}),load);};});list.querySelectorAll('[data-review]').forEach(function(b){b.onclick=function(){phfcProposalReviewModal(rows.find(function(x){return x.id===b.getAttribute('data-review');}),load);};});list.querySelectorAll('[data-create-class]').forEach(function(b){b.onclick=function(){var row=rows.find(function(x){return x.id===b.getAttribute('data-create-class');});try{sessionStorage.setItem('phfcProposalPrefill',JSON.stringify(row));sessionStorage.setItem('phfcProposalLinkId',row.id);}catch(e){}navigate('/admin/classroom/lop/tao-moi');};});list.querySelectorAll('[data-delete-proposal]').forEach(function(b){b.onclick=async function(){try{await phfcSoftDelete('proposal',b.getAttribute('data-delete-proposal'),'đề xuất đào tạo',load);}catch(e){phfcNotice('error','Chưa thể xóa đề xuất',e.message||String(e));}};});list.querySelectorAll('[data-open-class]').forEach(function(b){b.onclick=function(){navigate('/admin/classroom/lop/'+b.getAttribute('data-open-class'));};});}
    async function load(){try{var data=await phfcProposalApi();rows=data.proposals||[];canReview=data.canReview===true;canReport=data.canReport===true;var counts={pending:0,needs_revision:0,approved:0,converted:0};rows.forEach(function(x){if(counts[x.status]!=null)counts[x.status]++;});if(!reportOnly&&ws.querySelector('[data-proposal-kpis]'))ws.querySelector('[data-proposal-kpis]').innerHTML='<article><span>Chờ duyệt</span><strong>'+counts.pending+'</strong></article><article><span>Cần bổ sung</span><strong>'+counts.needs_revision+'</strong></article><article><span>Đã duyệt</span><strong>'+counts.approved+'</strong></article><article><span>Đã chuyển thành lớp</span><strong>'+counts.converted+'</strong></article>';if(!reportOnly)draw();renderReport();}catch(e){list.innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tải đề xuất</strong><span>'+esc(e.message||String(e))+'</span></div>';}}var newButton=ws.querySelector('[data-proposal-new]');if(newButton)newButton.onclick=function(){phfcProposalModal({},load);};if(search)search.oninput=draw;if(status)status.onchange=draw;if(reportRange)reportRange.onchange=renderReport;load();}




  function phfcAskReason(title,message,confirmLabel,needPermanentText){return new Promise(function(resolve){var o=document.createElement('div');o.className='phfc-modal-overlay';o.innerHTML='<section class="phfc-modal-card phfc-reason-modal"><div class="phfc-user-picker-head"><div><h3>'+esc(title)+'</h3><p>'+esc(message||'Vui lòng nhập lý do để lưu lịch sử thao tác.')+'</p></div><button type="button" data-close>×</button></div><div class="phfc-reason-body"><label class="phfc-field"><span>Lý do <b class="phfc-required">*</b></span><textarea rows="3" data-reason></textarea></label>'+(needPermanentText?'<label class="phfc-field"><span>Xác nhận đặc biệt</span><input data-confirm-text placeholder="Nhập XOA VINH VIEN nếu chưa đủ thời gian lưu giữ"></label>':'')+'</div><div class="phfc-modal-actions"><button type="button" class="phfc-secondary-button" data-close>Hủy</button><button type="button" class="phfc-danger-button" data-ok>'+esc(confirmLabel||'Xác nhận')+'</button></div></section>';document.body.appendChild(o);document.documentElement.classList.add('phfc-modal-lock');function close(v){o.remove();document.documentElement.classList.remove('phfc-modal-lock');resolve(v||null);}o.querySelectorAll('[data-close]').forEach(function(b){b.onclick=function(){close(null);};});o.onclick=function(e){if(e.target===o)close(null);};o.querySelector('[data-ok]').onclick=function(){var reason=o.querySelector('[data-reason]').value.trim();if(!reason){phfcNotice('error','Chưa có lý do','Vui lòng nhập lý do trước khi tiếp tục.');return;}close({reason:reason,confirmText:(o.querySelector('[data-confirm-text]')||{}).value||''});};});}
  async function phfcSoftDelete(entityType,entityId,label,onDone){var a=await phfcAskReason('Xóa '+label,'Dữ liệu sẽ được chuyển vào Thùng rác và có thể khôi phục.','Chuyển vào Thùng rác',false);if(!a)return false;await phfcSettingsApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'softDelete',entityType:entityType,entityId:entityId,reason:a.reason})});phfcNotice('success','Đã chuyển vào Thùng rác','Admin có thể khôi phục trong Cấu hình Classroom.');if(onDone)onDone();return true;}

  async function phfcSettingsApi(options){var r=await fetch('/api/data?classroomSettings=1',Object.assign({credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}},options||{})),j={};try{j=await r.json();}catch(e){}if(!r.ok||j.ok===false)throw new Error(j.error||'Không thể tải cấu hình Classroom.');return j;}
  function phfcSettingsWorkspace(){return '<section class="phfc-settings" data-phfc-settings><div class="phfc-settings-tabs"><button class="is-active" data-settings-tab="rules">Quy tắc vận hành</button><button data-settings-tab="trash">Thùng rác</button><button data-settings-tab="history">Lịch sử thay đổi</button></div><div data-settings-panel="rules"><div data-settings-form class="phfc-settings-loading">Đang tải cấu hình…</div></div><div data-settings-panel="trash" hidden><div data-trash-list class="phfc-settings-loading">Đang tải Thùng rác…</div></div><div data-settings-panel="history" hidden><div data-history-list class="phfc-settings-loading">Chọn tab để tải lịch sử…</div></div></section>';}
  function phfcSettingsFormHtml(x){function chk(k,l){return '<label class="phfc-setting-check"><input type="checkbox" data-setting="'+k+'"'+(x[k]?' checked':'')+'><span>'+l+'</span></label>';}function num(k,l,min,max,s){return '<label class="phfc-field"><span>'+l+'</span><input type="number" min="'+min+'" max="'+max+'" step="'+(s||1)+'" data-setting="'+k+'" value="'+esc(x[k])+'"></label>';}return '<div class="phfc-settings-grid"><section class="phfc-card"><h3>Lớp học</h3>'+num('classDefaultCapacity','Số học viên tối đa mặc định',1,1000)+chk('classAutoLock','Tự khóa lớp khi hết thời hạn')+chk('classAllowExtension','Cho phép Admin gia hạn')+chk('classAllowAfterDeadline','Cho học tiếp sau hạn')+chk('classRequireAllRequired','Bắt buộc hoàn thành toàn bộ nội dung bắt buộc')+'</section><section class="phfc-card"><h3>Điểm danh</h3>'+num('attendanceEditDays','Số ngày được sửa sau buổi học',0,30)+num('attendanceMinimumRate','Tỷ lệ tham gia tối thiểu (%)',0,100)+chk('attendanceAdminOnlyAfterDeadline','Sau hạn chỉ Admin được sửa')+chk('attendanceExcusedCounts','Có phép được tính tham gia')+chk('attendanceLateCounts','Đi trễ được tính hiện diện')+chk('attendanceRequireAllMarked','Chỉ chốt khi đủ trạng thái')+'</section><section class="phfc-card"><h3>Tài liệu</h3>'+num('materialMaxMb','Dung lượng tối đa mỗi file (MB)',1,200)+num('materialMaxBatchFiles','Số file tối đa mỗi lượt',1,100)+num('materialSignedUrlMinutes','Thời hạn link xem file (phút)',1,1440)+chk('materialDefaultRequired','Mặc định là tài liệu bắt buộc')+chk('materialRequireConfirmation','Bắt buộc xác nhận đã đọc')+chk('materialAllowAfterDeadline','Cho xác nhận sau hạn khóa')+'</section><section class="phfc-card"><h3>Bài kiểm tra</h3>'+num('testPassScore','Điểm đạt mặc định',0,100)+num('testAttempts','Số lần làm mặc định',1,20)+num('testDurationMinutes','Thời lượng mặc định (phút)',1,600)+num('testEssayCharacterLimit','Giới hạn ký tự tự luận',100,10000)+chk('testShuffleQuestions','Mặc định trộn câu hỏi')+chk('testShuffleOptions','Mặc định trộn đáp án')+chk('testAutoSubmit','Hết giờ tự nộp')+chk('testShowAnswers','Hiển thị đáp án sau khi làm')+chk('testAllowRetryAfterPass','Cho làm lại sau khi đạt')+'</section><section class="phfc-card"><h3>Đề xuất & thông báo</h3>'+num('proposalPendingWarningDays','Cảnh báo đề xuất chờ duyệt (ngày)',1,30)+num('notificationDisplayDays','Số ngày hiển thị thông báo',1,365)+num('notificationPanelLimit','Số thông báo trên panel chuông',5,100)+chk('proposalEnabledForAll','Cho toàn bộ user tạo đề xuất')+chk('proposalRejectReasonRequired','Bắt buộc lý do từ chối')+chk('proposalAutoComplete','Tự hoàn tất khi lớp liên kết hoàn thành')+chk('notificationEnabled','Bật thông báo nội bộ')+chk('notificationAutoHide','Tự ẩn thông báo hết hạn')+'</section><section class="phfc-card"><h3>Thùng rác</h3>'+num('trashRetentionDays','Số ngày giữ trong Thùng rác',1,365)+chk('trashEnabled','Bật cơ chế Thùng rác')+chk('allowPermanentDelete','Cho phép xóa vĩnh viễn')+'<p class="phfc-setting-note">Điều kiện an toàn xóa dữ liệu được khóa trong hệ thống và không thể tắt.</p></section></div><div class="phfc-form-actions"><button type="button" class="phfc-secondary-button" data-settings-reset>Khôi phục mặc định</button><button type="button" class="phfc-primary-button" data-settings-save>Lưu cấu hình</button></div>';}
  async function hydrateSettings(root){var ws=root.querySelector('[data-phfc-settings]');if(!ws)return;var data=null;async function load(){data=await phfcSettingsApi();var f=ws.querySelector('[data-settings-form]');f.innerHTML=phfcSettingsFormHtml(data.settings||{});bindForm();drawTrash();}function collect(){var out={};ws.querySelectorAll('[data-setting]').forEach(function(el){out[el.getAttribute('data-setting')]=el.type==='checkbox'?el.checked:Number(el.value);});return out;}function bindForm(){ws.querySelector('[data-settings-save]').onclick=async function(){try{this.disabled=true;await phfcSettingsApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveSettings',settings:collect(),reason:'Cập nhật từ giao diện Cấu hình Classroom'})});phfcNotice('success','Đã lưu cấu hình','Các giá trị mặc định mới đã được áp dụng.');await load();}catch(e){phfcNotice('error','Chưa thể lưu cấu hình',e.message||String(e));}finally{this.disabled=false;}};ws.querySelector('[data-settings-reset]').onclick=async function(){var a=await phfcAskReason('Khôi phục cấu hình mặc định','Toàn bộ giá trị sẽ quay về mặc định an toàn của PHF Classroom.','Khôi phục mặc định',false);if(!a)return;await phfcSettingsApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'resetSettings'})});await load();};}function drawTrash(){var h=ws.querySelector('[data-trash-list]'),rows=data&&data.trash||[];h.innerHTML=rows.length?'<div class="phfc-trash-list">'+rows.map(function(x){return '<article><div><span class="phfc-status-chip">'+esc(x.label)+'</span><strong>'+esc(x.name)+'</strong><small>Đã xóa '+esc(phfcDateTime(x.deletedAt))+' · '+esc(x.deleteReason||'Không ghi lý do')+'</small></div><div><button data-restore="'+esc(x.type)+'|'+esc(x.id)+'">Khôi phục</button><button class="is-danger" data-purge="'+esc(x.type)+'|'+esc(x.id)+'">Xóa vĩnh viễn</button></div></article>';}).join('')+'</div>':'<div class="phfc-schedule-empty"><strong>Thùng rác đang trống</strong><span>Dữ liệu được xóa sẽ được giữ lại để có thể khôi phục.</span></div>';h.querySelectorAll('[data-restore]').forEach(function(b){b.onclick=async function(){var p=b.getAttribute('data-restore').split('|');await phfcSettingsApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'restore',entityType:p[0],entityId:p[1]})});phfcNotice('success','Đã khôi phục dữ liệu','Dữ liệu đã quay lại danh sách hoạt động.');await load();};});h.querySelectorAll('[data-purge]').forEach(function(b){b.onclick=async function(){var p=b.getAttribute('data-purge').split('|'),a=await phfcAskReason('Xóa vĩnh viễn','Dữ liệu sẽ không thể khôi phục.','Xóa vĩnh viễn',true);if(!a)return;await phfcSettingsApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'purge',entityType:p[0],entityId:p[1],reason:a.reason,confirmText:a.confirmText})});phfcNotice('success','Đã xóa vĩnh viễn','Dữ liệu không thể khôi phục từ hệ thống.');await load();};});}async function loadHistory(){var j=await phfcSettingsApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'history'})}),h=ws.querySelector('[data-history-list]');h.innerHTML=(j.history||[]).map(function(x){return '<article class="phfc-history-row"><strong>'+esc(x.action)+'</strong><span>'+esc(x.entity_type)+' · '+esc(x.entity_id||'')+'</span><small>'+esc(phfcDateTime(x.created_at))+' · '+esc(x.actor_email||x.actor_id||'Admin')+'</small></article>';}).join('')||'<p>Chưa có lịch sử.</p>';}ws.querySelectorAll('[data-settings-tab]').forEach(function(b){b.onclick=function(){ws.querySelectorAll('[data-settings-tab]').forEach(function(x){x.classList.toggle('is-active',x===b);});ws.querySelectorAll('[data-settings-panel]').forEach(function(p){p.hidden=p.getAttribute('data-settings-panel')!==b.getAttribute('data-settings-tab');});if(b.getAttribute('data-settings-tab')==='history')loadHistory();};});try{await load();}catch(e){ws.querySelector('[data-settings-form]').innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tải cấu hình</strong><span>'+esc(e.message||String(e))+'</span></div>';}}

  function pageContent(path){
    path=cleanPath(path);
    if(path==='/admin/classroom')return adminOverview();
    if(path==='/admin/classroom/cau-hinh')return phfcSettingsWorkspace();
    if(path==='/admin/classroom/lop')return classListWorkspace(true);
    if(path==='/admin/classroom/lop/tao-moi')return createClassWorkspace();
    if(path==='/admin/classroom/thong-bao'||path==='/ql/classroom/thong-bao')return phfcNotificationWorkspace();
    if(path==='/admin/classroom/de-xuat'||path==='/ql/classroom/de-xuat'||path==='/hv/classroom/de-xuat'||path==='/admin/classroom/bao-cao'||path==='/ql/classroom/bao-cao')return phfcProposalWorkspace();
    if(path==='/admin/classroom/hoc-vien'||path==='/ql/classroom/hoc-vien')return phfcUserWorkspace();
    if(path==='/admin/classroom/lich'||path==='/ql/classroom/lich'||path==='/hv/classroom/lich')return phfcScheduleWorkspace();
    if(path==='/admin/classroom/diem-danh'||path==='/ql/classroom/diem-danh')return phfcAttendanceWorkspace();
    if(path==='/admin/classroom/tai-lieu'||path==='/ql/classroom/tai-lieu'||path==='/hv/classroom/tai-lieu')return phfcMaterialsWorkspace();
    if(path==='/admin/classroom/bai-kiem-tra'||path==='/ql/classroom/bai-kiem-tra'||path==='/hv/classroom/bai-kiem-tra')return phfcTestsWorkspace();
    if(path==='/admin/classroom/ket-qua'||path==='/ql/classroom/ket-qua'||path==='/hv/classroom/ket-qua')return phfcResultsWorkspace();
    if(path==='/ql/classroom')return managerOverview();
    if(path==='/ql/classroom/lop')return classListWorkspace(false);
    if(/^\/(?:admin|ql|hv)\/classroom\/lop\/[^/]+$/.test(path))return classDetailWorkspace(path);
    if(path==='/hv/classroom')return '<section data-phfc-learner-classes><div class="phfc-class-loading">Đang tải lớp đào tạo của bạn…</div></section>';
    var empty=adminEmptyFor(path);return emptyState(empty[0],empty[1]);
  }

  function phfcCsvRows(text){
    text=String(text||'').replace(/^\uFEFF/,'');
    var firstLine=(text.split(/\r?\n/,1)[0]||''),comma=(firstLine.match(/,/g)||[]).length,semi=(firstLine.match(/;/g)||[]).length,tabs=(firstLine.match(/\t/g)||[]).length;
    var delimiter=tabs>comma&&tabs>semi?'\t':(semi>comma?';':',');
    var rows=[],row=[],cell='',quoted=false;
    for(var i=0;i<text.length;i++){
      var ch=text[i],next=text[i+1];
      if(quoted){
        if(ch==='"'&&next==='"'){cell+='"';i++;}
        else if(ch==='"')quoted=false;
        else cell+=ch;
      }else{
        if(ch==='"')quoted=true;
        else if(ch===delimiter){row.push(cell);cell='';}
        else if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell='';}
        else if(ch!=='\r')cell+=ch;
      }
    }
    if(cell!==''||row.length){row.push(cell);rows.push(row);}
    return rows.filter(function(r){return r.some(function(v){return String(v||'').trim()!=='';});});
  }
  function phfcHeaderKey(v){
    v=String(v||'').trim().toLowerCase();
    try{v=v.normalize('NFD').replace(/[\u0300-\u036f]/g,'');}catch(e){}
    return v.replace(/[^a-z0-9]/g,'');
  }
  function phfcEmployeeData(){
    var d=window.__phfLocalData||window.localData||{};
    return Array.isArray(d.employees)?d.employees:[];
  }
  function phfcAccountData(){var d=window.__phfLocalData||window.localData||{};return Array.isArray(d.hubAccounts)?d.hubAccounts:[];}
  function phfcEmployeeById(id){id=String(id||'').trim();return phfcEmployeeData().find(function(e){return phfcEmployeeId(e)===id;})||null;}
  var phfcClassroomUsersCache=null;
  async function phfcLoadClassroomUsers(force){
    if(!force&&Array.isArray(phfcClassroomUsersCache))return phfcClassroomUsersCache;
    var response=await fetch('/api/data?classroomUsers=1',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
    var json={};try{json=await response.json();}catch(e){}
    if(!response.ok||!json||json.ok!==true||!Array.isArray(json.users))throw new Error((json&&json.error&&json.error.message)||'Chưa thể tải danh sách nhân sự Classroom.');
    phfcClassroomUsersCache=json.users.map(function(u){
      var employee={id:u.employeeId||'',employeeId:u.employeeId||'',employeeCode:u.employeeCode||'',fullName:u.fullName||'',email:u.email||'',phone:u.phone||'',department:u.department||'',position:u.position||'',branch:u.branch||''};
      return {accountId:u.accountId||'',employeeId:u.employeeId||'',name:u.fullName||u.email||'Nhân sự',code:u.employeeCode||'',email:u.email||'',phone:u.phone||'',department:u.department||'',position:u.position||'',branch:u.branch||'',role:u.role||'learner',defaultProgram:u.defaultProgram||'',employee:employee};
    });
    return phfcClassroomUsersCache;
  }
  function phfcOpenUserPicker(options){
    options=options||{};var people=Array.isArray(options.people)?options.people:[];var multiple=options.multiple===true;var selected={};(options.selectedKeys||[]).forEach(function(k){if(k)selected[k]=true;});
    var overlay=document.createElement('div');overlay.className='phfc-user-picker-overlay';overlay.innerHTML='<section class="phfc-user-picker-modal" role="dialog" aria-modal="true" aria-label="'+esc(options.title||'Chọn nhân sự')+'"><div class="phfc-user-picker-head"><div><h3>'+esc(options.title||'Chọn nhân sự')+'</h3><p>'+esc(options.description||'Chọn từ tài khoản nhân sự đang hoạt động của PHF Training Hub.')+'</p></div><button type="button" data-phfc-picker-close aria-label="Đóng">×</button></div><div class="phfc-user-picker-filter"><label><strong>Tìm nhân sự</strong><input type="search" placeholder="Tên, mã nhân viên, email, phòng ban..." data-phfc-picker-search></label><span data-phfc-picker-count></span></div><div class="phfc-user-picker-list" data-phfc-picker-list></div><div class="phfc-user-picker-foot"><button type="button" class="phfc-secondary-button" data-phfc-picker-cancel>Hủy</button><button type="button" class="phfc-primary-button" data-phfc-picker-confirm>Xác nhận</button></div></section>';
    document.body.appendChild(overlay);var list=overlay.querySelector('[data-phfc-picker-list]'),search=overlay.querySelector('[data-phfc-picker-search]'),count=overlay.querySelector('[data-phfc-picker-count]');
    function key(p){return p.accountId||p.employeeId;}
    function draw(){var q=norm(search&&search.value),rows=people.filter(function(p){return !q||norm([p.name,p.code,p.email,p.phone,p.department,p.position,p.branch].join(' ')).indexOf(q)>=0;});if(count)count.textContent=rows.length+' người phù hợp';list.innerHTML=rows.length?rows.map(function(p){var k=key(p),checked=!!selected[k];return '<label class="phfc-user-picker-row '+(checked?'is-selected':'')+'"><input type="'+(multiple?'checkbox':'radio')+'" name="phfc-user-picker" value="'+esc(k)+'" '+(checked?'checked':'')+'><span class="phfc-user-avatar">'+esc(phfcInitials(p.name,p.email))+'</span><span class="phfc-user-picker-copy"><strong>'+esc(p.name)+'</strong><small>'+esc((p.code||'Chưa có mã')+(p.position?' · '+p.position:'')+(p.department?' · '+p.department:'')+(p.branch?' · '+p.branch:''))+'</small><em>'+esc(p.email||p.phone||'')+'</em></span></label>';}).join(''):'<div class="phfc-user-picker-empty"><strong>Không tìm thấy nhân sự phù hợp</strong><span>Hãy kiểm tra từ khóa hoặc trạng thái tài khoản trong Training Hub.</span></div>';list.querySelectorAll('input').forEach(function(input){input.addEventListener('change',function(){if(!multiple)selected={};if(input.checked)selected[input.value]=true;else delete selected[input.value];draw();});});}
    function close(){overlay.remove();}
    overlay.querySelector('[data-phfc-picker-close]').addEventListener('click',close);overlay.querySelector('[data-phfc-picker-cancel]').addEventListener('click',close);overlay.addEventListener('click',function(e){if(e.target===overlay)close();});search.addEventListener('input',draw);overlay.querySelector('[data-phfc-picker-confirm]').addEventListener('click',function(){var rows=people.filter(function(p){return selected[key(p)];});if(typeof options.onConfirm==='function')options.onConfirm(multiple?rows:(rows[0]||null));close();});draw();setTimeout(function(){search.focus();},0);
  }
  function phfcEligiblePeople(){
    var employees=phfcEmployeeData(),accounts=phfcAccountData(),out=[],seen={};
    accounts.forEach(function(a){
      if(!a||norm(a.accountType)==='system_admin'||norm(a.status)!=='active')return;
      if(['new_sales','phf_class'].indexOf(norm(a.defaultProgram))<0)return;
      var emp=phfcEmployeeById(a.employeeId)||employees.find(function(e){return norm(phfcEmployeeCode(e))===norm(a.employeeCode)||norm(phfcEmployeeEmail(e))===norm(a.email);});
      if(!emp)return;var employeeId=phfcEmployeeId(emp),accountId=String(a.id||'').trim(),key=accountId||employeeId;if(!key||seen[key])return;seen[key]=true;
      out.push({accountId:accountId,employeeId:employeeId,name:phfcEmployeeName(emp)||a.email||'Nhân sự',code:phfcEmployeeCode(emp)||a.employeeCode||'',email:phfcEmployeeEmail(emp)||a.email||'',department:phfcEmployeeValue(emp,['department','departmentName','department_name','team']),position:phfcEmployeeValue(emp,['position','positionName','position_name','roleName']),branch:phfcEmployeeValue(emp,['branch','branchName','branch_name','location','store']),employee:emp});
    });
    return out.sort(function(a,b){return a.name.localeCompare(b.name,'vi');});
  }
  function phfcEmployeeCode(e){return String(e&&((e.employeeCode)||e.employee_code||e.code)||'').trim();}
  function phfcEmployeeName(e){return String(e&&((e.fullName)||e.full_name||e.name)||'').trim();}
  function phfcEmployeeEmail(e){return String(e&&((e.email)||e.personalEmail||e.personal_email||e.workEmail||e.work_email)||'').trim();}
  function phfcEmployeeId(e){return String(e&&((e.id)||e.employee_id||e.employeeId)||'').trim();}
  function phfcAccountUnavailable(e){
    if(!e)return true;
    if(e.locked===true||e.isLocked===true||e.disabled===true||e.isActive===false||e.active===false)return true;
    var st=norm(e.accountStatus||e.account_status||e.userStatus||e.user_status||e.status);
    return ['locked','disabled','inactive','deleted','blocked','khoa','đã khóa'].indexOf(st)>=0;
  }
  function phfcIsSystemAdmin(e){
    var email=norm(phfcEmployeeEmail(e));
    if(email==='hr.phuhoacorp@gmail.com')return true;
    return e&&((e.isSystemAdmin===true)||(e.is_system_admin===true));
  }
  function phfcValidateImport(rows,selectedIds){
    if(!rows.length)return {fatal:'File không có dữ liệu.'};
    var header=rows[0].map(phfcHeaderKey), aliases={code:['manhanvien','employee_code','employeecode','ma'],name:['hovaten','hoten','fullname','name'],email:['email','emailcanhan','emailcongviec']};
    function col(keys){for(var i=0;i<header.length;i++)if(keys.indexOf(header[i])>=0)return i;return -1;}
    var ci=col(aliases.code),ni=col(aliases.name),ei=col(aliases.email);
    if(ci<0&&ei<0)return {fatal:'Thiếu cột Mã nhân viên hoặc Email. Hãy tải và dùng đúng file mẫu.'};
    var employees=phfcEmployeeData(), seen={}, out=[];
    if(!employees.length)return {fatal:'Dữ liệu nhân sự chưa sẵn sàng. Vui lòng chờ hệ thống tải xong rồi kiểm tra lại file.'};
    for(var r=1;r<rows.length;r++){
      var line=rows[r],code=ci>=0?String(line[ci]||'').trim():'',fileName=ni>=0?String(line[ni]||'').trim():'',email=ei>=0?String(line[ei]||'').trim():'',key=norm(code)||norm(email),item={line:r+1,code:code,fileName:fileName,email:email,status:'error',message:'',employee:null};
      if(!code&&!email){item.message='Thiếu mã nhân viên và email.';out.push(item);continue;}
      if(key&&seen[key]){item.message='Trùng dòng '+seen[key]+' trong file.';out.push(item);continue;}
      if(key)seen[key]=r+1;
      var byCode=code?employees.filter(function(e){return norm(phfcEmployeeCode(e))===norm(code);}):[];
      var byEmail=email?employees.filter(function(e){return norm(phfcEmployeeEmail(e))===norm(email);}):[];
      var matches=byCode.length?byCode:byEmail;
      if(code&&email&&(!byCode.length||!byEmail.length)){item.message='Mã nhân viên và email chưa cùng khớp một tài khoản hệ thống.';out.push(item);continue;}
      if(byCode.length&&byEmail.length&&phfcEmployeeId(byCode[0])!==phfcEmployeeId(byEmail[0])){item.message='Mã nhân viên và email đang khớp hai tài khoản khác nhau.';out.push(item);continue;}
      if(matches.length===0){item.message='Không tìm thấy tài khoản trong hệ thống.';out.push(item);continue;}
      if(matches.length>1){item.message='Có nhiều tài khoản trùng mã/email; cần kiểm tra hồ sơ.';out.push(item);continue;}
      var emp=matches[0],id=phfcEmployeeId(emp);item.employee=emp;
      if(phfcIsSystemAdmin(emp)){item.message='Tài khoản Admin HR hệ thống không thuộc danh sách học.';out.push(item);continue;}
      if(phfcAccountUnavailable(emp)){item.message='Tài khoản đang khóa hoặc không còn hoạt động.';out.push(item);continue;}
      if(id&&selectedIds[id]){item.status='warning';item.message='Người này đã được chọn trước đó.';out.push(item);continue;}
      var systemName=phfcEmployeeName(emp);
      if(fileName&&systemName&&norm(fileName)!==norm(systemName)){item.status='warning';item.message='Họ tên trong file khác hồ sơ; hệ thống sẽ dùng tên hồ sơ.';out.push(item);continue;}
      item.status='valid';item.message='Hợp lệ';out.push(item);
    }
    return {rows:out};
  }
  function phfcImportBadge(item){
    var label=item.status==='valid'?'Hợp lệ':(item.status==='warning'?'Cần xem':'Không hợp lệ');
    return '<span class="phfc-import-badge is-'+item.status+'">'+label+'</span><small>'+esc(item.message)+'</small>';
  }
  function bindCreateClass(main){
    var wrap=main.querySelector('[data-phfc-create-class]');if(!wrap)return;
    var radios=wrap.querySelectorAll('input[name="phfc-class-type"]');
    var single=wrap.querySelector('[data-phfc-single-schedule]');
    var multi=wrap.querySelector('[data-phfc-multi-schedule]');
    var note=wrap.querySelector('[data-phfc-schedule-note]');
    var summary=wrap.querySelector('[data-phfc-create-summary]');
    var className=wrap.querySelector('[data-phfc-class-name]');
    var classCode=wrap.querySelector('[data-phfc-class-code]');
    var trainingPurpose=wrap.querySelector('[data-phfc-training-purpose]');
    var nameError=wrap.querySelector('[data-phfc-class-name-error]');
    var codeError=wrap.querySelector('[data-phfc-class-code-error]');
    var nextButton=wrap.querySelector('[data-phfc-create-next]');
    var backButton=wrap.querySelector('[data-phfc-create-back]');
    var currentStep=1;
    var sessionCount=0;
    var currentEditId='';try{currentEditId=sessionStorage.getItem('phfcEditClassId')||'';}catch(e){}
    var classTestSelect=wrap.querySelector('[data-phfc-class-test-select]');
    try{var proposalPrefill=JSON.parse(sessionStorage.getItem('phfcProposalPrefill')||'null');if(proposalPrefill){if(className&&!className.value)className.value=proposalPrefill.title||'';var desc=wrap.querySelector('[data-phfc-class-description]');if(desc&&!desc.value)desc.value=[proposalPrefill.reason,proposalPrefill.expectedOutcome].filter(Boolean).join('\n\nKết quả mong muốn: ');sessionStorage.removeItem('phfcProposalPrefill');}}catch(e){}


    async function refreshClassTests(){
      if(!classTestSelect)return;
      var previous=classTestSelect.value;
      try{var x=await phfcTestsApi();var tests=(x.tests||[]).filter(function(t){return t.status!=='hidden';});classTestSelect.innerHTML='<option value="">Chưa chọn bài kiểm tra</option>'+tests.map(function(t){return '<option value="'+esc(t.id)+'">'+esc(t.title)+' · '+phfcTestStatus(t.status)+'</option>';}).join('');if(tests.some(function(t){return t.id===previous;}))classTestSelect.value=previous;}catch(e){classTestSelect.innerHTML='<option value="">Chưa tải được bài kiểm tra</option>';}
    }

    function selectedType(){var selected=wrap.querySelector('input[name="phfc-class-type"]:checked');return selected&&selected.value==='multi'?'multi':'single';}
    function updateSummary(){
      var title=className&&className.value.trim()?className.value.trim():'Chưa nhập tên lớp';
      var type=selectedType()==='multi'?'Khóa nhiều buổi':'Lớp một buổi';
      var extra='';
      if(selectedType()==='multi'&&sessionCount){extra=' · '+sessionCount+' buổi';}
      if(summary)summary.textContent=type+' · '+title+extra;
    }
    function updateType(){
      var isMulti=selectedType()==='multi';
      wrap.querySelectorAll('.phfc-type-option').forEach(function(x){x.classList.toggle('is-selected',!!x.querySelector('input:checked'));});
      if(single)single.hidden=isMulti;
      if(multi)multi.hidden=!isMulti;
      if(note)note.textContent=isMulti?'Thiết lập thời gian khóa và danh sách buổi học':'Thiết lập một buổi học';
      if(isMulti&&!sessionCount)addSession();
      updateSummary();
    }
    function formatValue(value,fallback){var v=String(value||'').trim();return v||fallback||'Chưa thiết lập';}
    function formatDateTime(value){if(!value)return 'Chưa thiết lập';try{var d=new Date(value);if(isNaN(d.getTime()))return value;return d.toLocaleString('vi-VN',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'numeric'});}catch(e){return value;}}
    function reviewPair(label,value){return '<div><dt>'+esc(label)+'</dt><dd>'+esc(formatValue(value))+'</dd></div>';}
    function renderReview(){
      var general=wrap.querySelector('[data-phfc-review-general]'),schedule=wrap.querySelector('[data-phfc-review-schedule]'),participants=wrap.querySelector('[data-phfc-review-participants]'),content=wrap.querySelector('[data-phfc-review-content]'),alerts=wrap.querySelector('[data-phfc-review-alerts]');
      var title=className&&className.value.trim()?className.value.trim():'Chưa nhập tên lớp';
      var typeLabel=selectedType()==='multi'?'Khóa nhiều buổi':'Lớp một buổi';
      var purposeLabel=trainingPurpose&&trainingPurpose.selectedIndex>=0?trainingPurpose.options[trainingPurpose.selectedIndex].text:'Chưa chọn';
      if(general)general.innerHTML=reviewPair('Tên lớp',title)+reviewPair('Mã lớp',classCode&&classCode.value)+reviewPair('Loại lớp',typeLabel)+reviewPair('Mục tiêu',(wrap.querySelector('[data-phfc-class-description]')||{}).value)+reviewPair('Mục đích đào tạo',purposeLabel)+reviewPair('Trạng thái','Bản nháp');
      var warnings=[];
      if(!className||!className.value.trim())warnings.push('Chưa nhập tên lớp đào tạo.');
      if(selectedType()==='single'){
        var singleStage=wrap.querySelector('[data-phfc-single-schedule]');var fields=singleStage?singleStage.querySelectorAll('input,select'):[];
        var modeSelect=singleStage?singleStage.querySelector('[data-phfc-mode]'):null;var location=singleStage?singleStage.querySelector('[data-phfc-location] input'):null;
        var date=fields[0]&&fields[0].value,start=fields[2]&&fields[2].value,end=fields[3]&&fields[3].value,mode=modeSelect&&modeSelect.value==='online'?'Online – tự học':'Trực tiếp';
        if(!date||!start||!end)warnings.push('Lịch lớp một buổi chưa đủ ngày và giờ học.');
        if(schedule)schedule.innerHTML='<div class="phfc-review-summary-row"><strong>'+esc(mode)+'</strong><span>'+esc(formatValue(date))+' · '+esc(formatValue(start))+'–'+esc(formatValue(end))+'</span></div>'+(modeSelect&&modeSelect.value==='offline'?'<p>'+esc(formatValue(location&&location.value,'Chưa nhập địa điểm học'))+'</p>':'<p>Nội dung tự học sẽ được gắn tại bước Nội dung & đánh giá.</p>');
      }else{
        var startCourse=wrap.querySelector('[data-phfc-course-start]'),endCourse=wrap.querySelector('[data-phfc-course-end]'),sessionRows=wrap.querySelectorAll('[data-phfc-session]');
        if(!startCourse||!startCourse.value||!endCourse||!endCourse.value)warnings.push('Chưa thiết lập đủ thời gian mở và tự khóa của khóa học.');
        if(!sessionRows.length)warnings.push('Khóa nhiều buổi chưa có buổi học.');
        var sessionHtml=Array.from(sessionRows).map(function(row,index){var n=row.querySelector('[data-phfc-session-name]'),inputs=row.querySelectorAll('input'),mode=row.querySelector('[data-phfc-session-mode]');var date=inputs[1]&&inputs[1].value,st=inputs[2]&&inputs[2].value,en=inputs[3]&&inputs[3].value;if(!date||!st||!en)warnings.push('Buổi '+(index+1)+' chưa đủ ngày hoặc giờ học.');return '<div class="phfc-review-session"><b>'+(index+1)+'</b><div><strong>'+esc(formatValue(n&&n.value,'Buổi học '+(index+1)))+'</strong><span>'+esc(mode&&mode.value==='online'?'Online – tự học':'Trực tiếp')+' · '+esc(formatValue(date))+' · '+esc(formatValue(st))+'–'+esc(formatValue(en))+'</span></div></div>';}).join('');
        if(schedule)schedule.innerHTML='<div class="phfc-review-window"><span>Mở khóa: <strong>'+esc(formatDateTime(startCourse&&startCourse.value))+'</strong></span><span>Tự khóa: <strong>'+esc(formatDateTime(endCourse&&endCourse.value))+'</strong></span></div><div class="phfc-review-session-list">'+(sessionHtml||'<p>Chưa có buổi học.</p>')+'</div>';
      }
      var learnerTotal=selectedCount();
      if(!learnerTotal)warnings.push('Chưa chọn học viên cho lớp.');
      if(participants){var roleLines=['owner','instructor','attendance_officer'].map(function(r){var input=wrap.querySelector('[data-phfc-assignment="'+r+'"]'),p=input&&input.value?eligiblePeople.find(function(x){return personKey(x)===input.value;}):null,label={owner:'Người phụ trách chính',instructor:'Giảng viên / hướng dẫn',attendance_officer:'Người điểm danh'}[r];return '<li>'+esc(label)+': '+esc(p?p.name:'Chưa chọn')+'</li>';}).join('');participants.innerHTML='<div class="phfc-review-count"><strong>'+learnerTotal+'</strong><span>học viên đã chọn</span></div><ul>'+roleLines+'</ul>';}
      var scopeInput=wrap.querySelector('input[name="phfc-content-scope"]:checked');var scope=scopeInput&&scopeInput.value==='session'?'Gắn theo từng buổi':'Dùng chung cho toàn khóa';var selectedTool=wrap.querySelector('[data-phfc-content-tool].is-selected');
      var checked=Array.from(wrap.querySelectorAll('.phfc-assessment-options input:checked')).map(function(x){var s=x.closest('label').querySelector('strong');return s?s.textContent:'';}).filter(Boolean);
      if(!selectedTool)warnings.push('Chưa chọn cách gắn nội dung đào tạo.');
      if(content)content.innerHTML='<div class="phfc-review-summary-row"><strong>'+esc(scope)+'</strong><span>'+(selectedTool?'Đã chọn công cụ nội dung':'Chưa gắn nội dung')+'</span></div><div class="phfc-review-tags">'+(checked.length?checked.map(function(x){return '<span>'+esc(x)+'</span>';}).join(''):'<span>Chưa chọn hình thức đánh giá</span>')+'</div>';
      if(alerts){alerts.innerHTML=warnings.length?'<div class="phfc-review-warning"><strong>Cần kiểm tra '+warnings.length+' nội dung</strong><ul>'+warnings.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul></div>':'<div class="phfc-review-ready"><strong>Thông tin giao diện đã đầy đủ</strong><span>Có thể tiếp tục hoàn thiện quy tắc nghiệp vụ trước khi kết nối dữ liệu.</span></div>';}
    }
    function setStep(step){
      currentStep=step;
      wrap.querySelectorAll('[data-phfc-create-stage]').forEach(function(stage){stage.hidden=String(step)!==stage.getAttribute('data-phfc-create-stage');});
      wrap.querySelectorAll('[data-phfc-step-indicator]').forEach(function(item){
        var n=Number(item.getAttribute('data-phfc-step-indicator'));
        item.classList.toggle('is-active',n===step);
        item.classList.toggle('is-complete',n<step);
        if(n===step)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');
      });
      if(backButton)backButton.textContent=step===1?'Hủy':'Quay lại';
      if(step===5)renderReview();
      if(nextButton){
        nextButton.textContent=step===1?'Tiếp tục':(step===2?'Tiếp tục sang Người tham gia':(step===3?'Tiếp tục sang Nội dung & đánh giá':(step===4?'Tiếp tục sang Kiểm tra lại':'Lưu bản nháp')));
        nextButton.setAttribute('aria-disabled','false');
        nextButton.title=step===5?'Lưu lớp dưới dạng bản nháp. Học viên chưa nhìn thấy lớp.':'';
      }
      var head=wrap.querySelector('.phfc-create-head');if(head&&head.scrollIntoView)head.scrollIntoView({block:'start',behavior:'smooth'});
    }
    function sessionTemplate(index){
      return '<article class="phfc-session-editor" data-phfc-session>'+ 
        '<div class="phfc-session-editor-head"><span class="phfc-session-number">Buổi '+index+'</span><strong data-phfc-session-title>Buổi học '+index+'</strong><div class="phfc-session-actions"><button type="button" data-phfc-move-up aria-label="Đưa buổi học lên trên">↑</button><button type="button" data-phfc-move-down aria-label="Đưa buổi học xuống dưới">↓</button><button type="button" data-phfc-remove-session>Xóa</button></div></div>'+ 
        '<div class="phfc-form-grid phfc-session-fields">'+ 
          '<label class="phfc-field phfc-field-wide"><span>Tên buổi học <b class="phfc-required">*</b></span><input type="text" value="Buổi học '+index+'" data-phfc-session-name></label>'+ 
          '<label class="phfc-field"><span>Ngày học <b class="phfc-required">*</b></span><input type="date" data-phfc-single-date></label><label class="phfc-field"><span>Hình thức <b class="phfc-required">*</b></span><select data-phfc-session-mode><option value="offline">Trực tiếp</option><option value="online">Online – tự học</option></select></label>'+ 
          '<label class="phfc-field"><span>Giờ bắt đầu <b class="phfc-required">*</b></span><input type="time" data-phfc-single-start></label><label class="phfc-field"><span>Giờ kết thúc <b class="phfc-required">*</b></span><input type="time" data-phfc-single-end></label>'+ 
          '<label class="phfc-field phfc-field-wide" data-phfc-session-location><span>Địa điểm học</span><input type="text" placeholder="Ví dụ: Phòng họp Phú Lợi"></label>'+ 
          '<div class="phfc-attendance-note phfc-field-wide" data-phfc-session-online-note hidden><strong>Nội dung tự học:</strong><span>Tài liệu, video, bài đọc hoặc đường dẫn ngoài sẽ được gắn tại bước Nội dung & đánh giá.</span></div>'+ 
          '<div class="phfc-attendance-note phfc-field-wide"><strong>Điểm danh:</strong><span>Buổi trực tiếp do Admin hoặc người được phân quyền tick trên hệ thống.</span></div>'+ 
        '</div>'+ 
      '</article>';
    }
    function renumberSessions(){
      var rows=wrap.querySelectorAll('[data-phfc-session]');sessionCount=rows.length;
      rows.forEach(function(row,i){var n=i+1;var badge=row.querySelector('.phfc-session-number');if(badge)badge.textContent='Buổi '+n;});
      updateSummary();
    }
    function bindSession(row){
      var input=row.querySelector('[data-phfc-session-name]');var title=row.querySelector('[data-phfc-session-title]');
      if(input)input.addEventListener('input',function(){if(title)title.textContent=input.value.trim()||'Chưa đặt tên buổi học';});
      var mode=row.querySelector('[data-phfc-session-mode]');
      if(mode)mode.addEventListener('change',function(){updateSessionMode(row,mode.value);});
      var remove=row.querySelector('[data-phfc-remove-session]');if(remove)remove.addEventListener('click',function(){row.remove();renumberSessions();});
      var up=row.querySelector('[data-phfc-move-up]');if(up)up.addEventListener('click',function(){var prev=row.previousElementSibling;if(prev)row.parentNode.insertBefore(row,prev);renumberSessions();});
      var down=row.querySelector('[data-phfc-move-down]');if(down)down.addEventListener('click',function(){var next=row.nextElementSibling;if(next)row.parentNode.insertBefore(next,row);renumberSessions();});
    }
    function updateSessionMode(row,value){
      var location=row.querySelector('[data-phfc-session-location]');var onlineNote=row.querySelector('[data-phfc-session-online-note]');var attendance=row.querySelector('.phfc-attendance-note:last-child span');
      if(location)location.hidden=value==='online';
      if(onlineNote)onlineNote.hidden=value!=='online';
      if(attendance)attendance.textContent=value==='online'?'Học viên mở buổi tự học trên hệ thống sẽ được ghi nhận đã tham gia. Hoàn thành buổi được xác định riêng theo nội dung bắt buộc.':'Buổi trực tiếp do Admin hoặc người được phân quyền tick trên hệ thống.';
    }
    function addSession(){
      var list=wrap.querySelector('[data-phfc-session-list]');if(!list)return;
      var index=list.querySelectorAll('[data-phfc-session]').length+1;
      var holder=document.createElement('div');holder.innerHTML=sessionTemplate(index);var row=holder.firstElementChild;list.appendChild(row);bindSession(row);renumberSessions();return row;
    }

    radios.forEach(function(r){r.addEventListener('change',updateType);});
    if(className){className.addEventListener('input',function(){if(nameError)nameError.hidden=true;className.classList.remove('is-invalid');updateSummary();});}
    if(classCode){classCode.addEventListener('input',function(){if(codeError)codeError.hidden=true;classCode.classList.remove('is-invalid');classCode.value=classCode.value.toUpperCase().replace(/[^A-Z0-9_-]/g,'');});}
    var mode=wrap.querySelector('[data-phfc-mode]');
    if(mode)mode.addEventListener('change',function(){
      var location=wrap.querySelector('[data-phfc-location]');var onlineNote=wrap.querySelector('[data-phfc-online-content-note]');var attendance=wrap.querySelector('[data-phfc-single-schedule] .phfc-attendance-note:last-child span');
      if(location)location.hidden=mode.value==='online';
      if(onlineNote)onlineNote.hidden=mode.value!=='online';
      if(attendance)attendance.textContent=mode.value==='online'?'Học viên mở buổi tự học trên hệ thống sẽ được ghi nhận đã tham gia. Hoàn thành buổi được xác định riêng theo nội dung bắt buộc.':'Buổi trực tiếp do Admin hoặc người được phân quyền tick trên hệ thống.';
    });
    var add=wrap.querySelector('[data-phfc-add-session]');if(add)add.addEventListener('click',addSession);

    var refreshTestsButton=wrap.querySelector('[data-phfc-refresh-tests]');if(refreshTestsButton)refreshTestsButton.addEventListener('click',refreshClassTests);
    var createTestButton=wrap.querySelector('[data-phfc-create-test-new]');if(createTestButton)createTestButton.addEventListener('click',function(){window.open(role()==='manager'?'/ql/classroom/bai-kiem-tra':'/admin/classroom/bai-kiem-tra','_blank','noopener');phfcNotice('info','Đã mở khu Bài kiểm tra','Tạo đề ở tab mới, sau đó quay lại và bấm Làm mới để chọn đề cho lớp.');});
    refreshClassTests();

    if(nextButton)nextButton.addEventListener('click',async function(){
      if(nextButton.getAttribute('aria-disabled')==='true')return;
      if(currentStep===1){
        if(!className||!className.value.trim()){if(nameError)nameError.hidden=false;if(className){className.classList.add('is-invalid');className.focus();}return;}
        if(!classCode||!classCode.value.trim()){if(codeError)codeError.hidden=false;if(classCode){classCode.classList.add('is-invalid');classCode.focus();}return;}
        if(!trainingPurpose||!trainingPurpose.value){phfcNotice('warning','Thiếu mục đích đào tạo','Vui lòng chọn mục đích đào tạo trước khi tiếp tục.');trainingPurpose&&trainingPurpose.focus();return;}
        setStep(2);return;
      }
      if(currentStep===2){setStep(3);return;}
      if(currentStep===3){var ownerInput=wrap.querySelector('[data-phfc-assignment="owner"]');if(!ownerInput||!ownerInput.value){phfcNotice('warning','Chưa chọn người phụ trách chính','Vui lòng chọn người phụ trách chính từ tài khoản Training Hub trước khi tiếp tục.');var ownerBtn=wrap.querySelector('[data-phfc-assignment-picker="owner"]');ownerBtn&&ownerBtn.focus();return;}if(!selectedCount()){phfcNotice('warning','Chưa chọn học viên','Vui lòng chọn ít nhất một học viên từ tài khoản Training Hub trước khi tiếp tục.');var learnerBtn=wrap.querySelector('[data-phfc-open-learner-picker]');learnerBtn&&learnerBtn.focus();return;}setStep(4);return;}
      if(currentStep===4){setStep(5);return;}
      if(currentStep===5){
        var capacityInput=wrap.querySelector('[data-phfc-capacity]');
        if(capacityInput&&String(capacityInput.value||'').trim()!==''&&Number(capacityInput.value)<=0){
          phfcNotice('warning','Số lượng tối đa chưa hợp lệ','Vui lòng để trống hoặc nhập số lớn hơn 0.');
          capacityInput.focus();
          return;
        }
        try{
          nextButton.disabled=true;nextButton.textContent='Đang lưu…';
          var saved=await saveClassroomClass(collectClassPayload(),'saveDraft');
          if(classTestSelect&&classTestSelect.value){
            await phfcTestsApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveAssignment',testId:classTestSelect.value,scopeType:'class',classId:saved.id,assignmentType:'final',status:'draft',required:true})});
          }
          try{var proposalLinkId=sessionStorage.getItem('phfcProposalLinkId')||'';if(proposalLinkId){await phfcProposalApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'linkClass',id:proposalLinkId,classId:saved.id})});sessionStorage.removeItem('phfcProposalLinkId');}}catch(linkError){phfcNotice('warning','Lớp đã lưu nhưng chưa liên kết đề xuất',linkError.message||String(linkError));}
          try{sessionStorage.removeItem('phfcEditClassId');}catch(e){}
          phfcNotice('success','Đã lưu bản nháp','Lớp '+saved.classCode+' đã được lưu. Học viên chưa nhìn thấy cho đến khi Admin phát hành.');
          navigate('/admin/classroom/lop/'+saved.id,true);
        }catch(error){phfcNotice('error','Chưa thể lưu lớp',error.message||String(error));}
        finally{nextButton.disabled=false;nextButton.textContent='Lưu bản nháp';}
      }
    });
    if(backButton)backButton.addEventListener('click',function(){
      if(currentStep===5)setStep(4);
      else if(currentStep===4)setStep(3);
      else if(currentStep===3)setStep(2);
      else if(currentStep===2)setStep(1);
      else window.phfNavigateClassroom?window.phfNavigateClassroom('/admin/classroom/lop'):location.assign('/admin/classroom/lop');
    });
    var selectedLearners={},importRows=[];
    var eligiblePeople=[];
    var systemPanel=wrap.querySelector('[data-phfc-learner-panel="system"]');
    function personKey(p){return p.accountId||p.employeeId;}
    function assignmentLabel(role,p){var fallback={owner:'Chọn người phụ trách chính',instructor:'Chọn giảng viên / hướng dẫn',attendance_officer:'Chọn người điểm danh'};return p?(p.name+' · '+(p.code||p.email||'')):(fallback[role]||'Chọn nhân sự');}
    function updateAssignmentLabel(role){var input=wrap.querySelector('[data-phfc-assignment="'+role+'"]'),label=wrap.querySelector('[data-phfc-assignment-label="'+role+'"]'),p=input&&input.value?eligiblePeople.find(function(x){return personKey(x)===input.value;}):null;if(label)label.textContent=assignmentLabel(role,p);}
    function populatePeople(){
      wrap.querySelectorAll('[data-phfc-assignment-picker]').forEach(function(btn){if(btn.__phfcBound)return;btn.__phfcBound=true;btn.addEventListener('click',function(){var role=btn.getAttribute('data-phfc-assignment-picker'),input=wrap.querySelector('[data-phfc-assignment="'+role+'"]');phfcOpenUserPicker({title:role==='owner'?'Chọn người phụ trách chính':(role==='instructor'?'Chọn giảng viên / hướng dẫn':'Chọn người điểm danh'),people:eligiblePeople,multiple:false,selectedKeys:input&&input.value?[input.value]:[],onConfirm:function(p){if(input)input.value=p?personKey(p):'';updateAssignmentLabel(role);updateSummary();}});});});
      if(systemPanel){systemPanel.innerHTML='<div class="phfc-user-picker-entry"><div><strong>Học viên tham gia <b class="phfc-required">*</b></strong><span>Chỉ chọn từ tài khoản nhân sự đang hoạt động của Training Hub.</span></div><button type="button" class="phfc-primary-button" data-phfc-open-learner-picker>Chọn học viên</button></div><div class="phfc-user-source-note">Có thể tìm theo tên, mã nhân viên, email, số điện thoại, phòng ban, vị trí hoặc chi nhánh.</div>';var open=systemPanel.querySelector('[data-phfc-open-learner-picker]');open.addEventListener('click',function(){phfcOpenUserPicker({title:'Chọn học viên tham gia',description:'Có thể chọn nhiều người. Tài khoản Admin hệ thống và tài khoản bị khóa đã được loại khỏi danh sách.',people:eligiblePeople,multiple:true,selectedKeys:Object.keys(selectedLearners),onConfirm:function(rows){selectedLearners={};(rows||[]).forEach(function(p){selectedLearners[personKey(p)]=p.employee;});renderSelected();}});});}
      ['owner','instructor','attendance_officer'].forEach(updateAssignmentLabel);
    }
    async function refreshClassroomPeople(){
      if(systemPanel)systemPanel.innerHTML='<div class="phfc-user-loading">Đang tải danh sách nhân sự từ Training Hub…</div>';
      try{eligiblePeople=await phfcLoadClassroomUsers(false);populatePeople();await loadEditClass();}
      catch(error){if(systemPanel)systemPanel.innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tải danh sách nhân sự</strong><span>'+esc(error.message||String(error))+'</span><button type="button" data-phfc-retry-users>Thử lại</button></div>';var retry=systemPanel&&systemPanel.querySelector('[data-phfc-retry-users]');if(retry)retry.addEventListener('click',function(){phfcClassroomUsersCache=null;refreshClassroomPeople();});}
    }
    function selectedCount(){return Object.keys(selectedLearners).length;}
    function renderSelected(){
      var count=selectedCount(),counter=wrap.querySelector('[data-phfc-selected-count]'),box=wrap.querySelector('[data-phfc-selected-list]'),rowsBox=wrap.querySelector('[data-phfc-selected-rows]'),note=wrap.querySelector('[data-phfc-selected-note]');
      if(counter)counter.textContent=String(count);
      if(!box||!rowsBox)return;
      box.hidden=count===0;if(note)note.textContent=count+' người';
      rowsBox.innerHTML=Object.keys(selectedLearners).map(function(id){var e=selectedLearners[id];return '<div class="phfc-selected-row"><div><strong>'+esc(phfcEmployeeName(e)||'Nhân sự')+'</strong><span>'+esc(phfcEmployeeCode(e)||'Chưa có mã')+(phfcEmployeeEmail(e)?' · '+esc(phfcEmployeeEmail(e)):'')+'</span></div><button type="button" data-phfc-remove-selected="'+esc(id)+'">Bỏ</button></div>';}).join('');
      rowsBox.querySelectorAll('[data-phfc-remove-selected]').forEach(function(btn){btn.addEventListener('click',function(){delete selectedLearners[btn.getAttribute('data-phfc-remove-selected')];renderSelected();});});
    }
    wrap.querySelectorAll('[data-phfc-learner-tab]').forEach(function(tab){tab.addEventListener('click',function(){var name=tab.getAttribute('data-phfc-learner-tab');wrap.querySelectorAll('[data-phfc-learner-tab]').forEach(function(t){var on=t===tab;t.classList.toggle('is-active',on);t.setAttribute('aria-selected',on?'true':'false');});wrap.querySelectorAll('[data-phfc-learner-panel]').forEach(function(p){p.hidden=p.getAttribute('data-phfc-learner-panel')!==name;});});});
    var fileInput=wrap.querySelector('[data-phfc-learner-file]'),result=wrap.querySelector('[data-phfc-import-result]'),body=wrap.querySelector('[data-phfc-import-body]'),addValid=wrap.querySelector('[data-phfc-import-add]');
    function clearImport(){importRows=[];if(result)result.hidden=true;if(body)body.innerHTML='';if(fileInput)fileInput.value='';if(addValid)addValid.setAttribute('aria-disabled','true');}
    var clearBtn=wrap.querySelector('[data-phfc-import-clear]');if(clearBtn)clearBtn.addEventListener('click',clearImport);
    function renderImport(check){
      if(!result||!body)return;result.hidden=false;
      if(check.fatal){importRows=[];body.innerHTML='<tr><td colspan="5"><div class="phfc-import-fatal">'+esc(check.fatal)+'</div></td></tr>';['total','valid','warning','error'].forEach(function(k){var el=wrap.querySelector('[data-phfc-import-'+k+']');if(el)el.textContent='0';});if(addValid)addValid.setAttribute('aria-disabled','true');return;}
      importRows=check.rows||[];var counts={valid:0,warning:0,error:0};importRows.forEach(function(x){counts[x.status]=(counts[x.status]||0)+1;});
      var total=wrap.querySelector('[data-phfc-import-total]'),valid=wrap.querySelector('[data-phfc-import-valid]'),warning=wrap.querySelector('[data-phfc-import-warning]'),error=wrap.querySelector('[data-phfc-import-error]');if(total)total.textContent=String(importRows.length);if(valid)valid.textContent=String(counts.valid||0);if(warning)warning.textContent=String(counts.warning||0);if(error)error.textContent=String(counts.error||0);
      body.innerHTML=importRows.map(function(x){var system=x.employee?'<strong>'+esc(phfcEmployeeName(x.employee)||'Nhân sự')+'</strong><small>'+esc(phfcEmployeeCode(x.employee)||'')+(phfcEmployeeEmail(x.employee)?' · '+esc(phfcEmployeeEmail(x.employee)):'')+'</small>':'<span>Chưa khớp</span>';return '<tr class="is-'+x.status+'"><td>'+x.line+'</td><td>'+esc(x.code||'—')+'</td><td>'+esc(x.fileName||'—')+'</td><td>'+system+'</td><td>'+phfcImportBadge(x)+'</td></tr>';}).join('');
      if(addValid)addValid.setAttribute('aria-disabled',counts.valid?'false':'true');
    }
    if(fileInput)fileInput.addEventListener('change',function(){var file=fileInput.files&&fileInput.files[0];if(!file)return;if(!/\.csv$/i.test(file.name)){renderImport({fatal:'Định dạng chưa hỗ trợ. Vui lòng dùng file CSV mẫu của hệ thống.'});return;}var reader=new FileReader();reader.onload=function(){try{var rows=phfcCsvRows(reader.result);renderImport(phfcValidateImport(rows,selectedLearners));}catch(e){renderImport({fatal:'Không đọc được file. Vui lòng kiểm tra lại định dạng CSV UTF-8.'});}};reader.onerror=function(){renderImport({fatal:'Không đọc được file đã chọn.'});};reader.readAsText(file,'utf-8');});
    if(addValid)addValid.addEventListener('click',function(){if(addValid.getAttribute('aria-disabled')==='true')return;importRows.forEach(function(x){if(x.status==='valid'&&x.employee){var id=phfcEmployeeId(x.employee)||norm(phfcEmployeeCode(x.employee))||norm(phfcEmployeeEmail(x.employee));if(id)selectedLearners[id]=x.employee;}});renderSelected();clearImport();});
    wrap.querySelectorAll('[data-phfc-review-edit]').forEach(function(btn){btn.addEventListener('click',function(){setStep(Number(btn.getAttribute('data-phfc-review-edit'))||1);});});
    wrap.querySelectorAll('input[name="phfc-content-scope"]').forEach(function(input){input.addEventListener('change',function(){wrap.querySelectorAll('.phfc-scope-choice label').forEach(function(label){var radio=label.querySelector('input');label.classList.toggle('is-selected',!!(radio&&radio.checked));});});});
    wrap.querySelectorAll('[data-phfc-content-tool]').forEach(function(btn){btn.addEventListener('click',function(){wrap.querySelectorAll('[data-phfc-content-tool]').forEach(function(x){x.classList.toggle('is-selected',x===btn);});var box=wrap.querySelector('[data-phfc-content-selection]');if(box){var labels={library:'Chọn tài liệu từ thư viện',upload:'Tải tài liệu mới',link:'Thêm đường dẫn học',instruction:'Thêm hướng dẫn học'};box.classList.add('has-choice');box.innerHTML='<div aria-hidden="true">✓</div><strong>'+esc(labels[btn.getAttribute('data-phfc-content-tool')]||'Đã chọn công cụ')+'</strong><p>Đây là lựa chọn giao diện tạm; chưa tải file, chưa tạo tài liệu và chưa ghi dữ liệu.</p>';}});});
    function selectedPersonByKey(key){return eligiblePeople.find(function(p){return personKey(p)===key;})||null;}
    function isoFromDateTime(date,time){if(!date)return '';return date+'T'+(time||'00:00')+':00';}
    function collectClassPayload(){
      var type=selectedType(), sessions=[], startAt='', endAt='', delivery='offline';
      if(type==='single'){
        var date=(wrap.querySelector('[data-phfc-single-date]')||{}).value||'',st=(wrap.querySelector('[data-phfc-single-start]')||{}).value||'',en=(wrap.querySelector('[data-phfc-single-end]')||{}).value||'',mode=(wrap.querySelector('[data-phfc-mode]')||{}).value||'offline',loc=(wrap.querySelector('[data-phfc-single-location]')||{}).value||'';delivery=mode;startAt=isoFromDateTime(date,st);endAt=isoFromDateTime(date,en);sessions.push({sessionName:className.value.trim(),sessionDate:date,startTime:st,endTime:en,deliveryMode:mode,location:loc,attendanceRequired:true});
      }else{
        startAt=(wrap.querySelector('[data-phfc-course-start]')||{}).value||'';endAt=(wrap.querySelector('[data-phfc-course-end]')||{}).value||'';
        wrap.querySelectorAll('[data-phfc-session]').forEach(function(row){var inputs=row.querySelectorAll('input'),mode=(row.querySelector('[data-phfc-session-mode]')||{}).value||'offline';sessions.push({sessionName:(row.querySelector('[data-phfc-session-name]')||{}).value||'',sessionDate:inputs[1]?inputs[1].value:'',startTime:inputs[2]?inputs[2].value:'',endTime:inputs[3]?inputs[3].value:'',deliveryMode:mode,location:(row.querySelector('[data-phfc-session-location] input')||{}).value||'',attendanceRequired:true});});delivery=sessions.some(function(x){return x.deliveryMode==='online';})&&sessions.some(function(x){return x.deliveryMode==='offline';})?'hybrid':(sessions[0]?sessions[0].deliveryMode:'offline');
      }
      var enrollments=Object.keys(selectedLearners).map(function(key){var p=selectedPersonByKey(key),e=selectedLearners[key];return {employeeId:p?p.employeeId:phfcEmployeeId(e),accountId:p?p.accountId:'',status:'enrolled',required:true,enrollmentSource:'admin',departmentSnapshot:p?p.department:'',positionSnapshot:p?p.position:'',branchSnapshot:p?p.branch:''};});
      var assignments=[];wrap.querySelectorAll('[data-phfc-assignment]').forEach(function(sel){if(!sel.value)return;var p=selectedPersonByKey(sel.value);if(p)assignments.push({employeeId:p.employeeId,accountId:p.accountId,assignmentRole:sel.getAttribute('data-phfc-assignment'),status:'active'});});
      return {id:currentEditId||undefined,classCode:classCode.value.trim(),className:className.value.trim(),classType:type,deliveryMode:delivery,trainingPurpose:trainingPurpose.value,description:(wrap.querySelector('[data-phfc-class-description]')||{}).value||'',capacity:(wrap.querySelector('[data-phfc-capacity]')||{}).value||null,startAt:startAt,endAt:endAt,status:'draft',completionRule:'manual_confirmation',minimumAttendanceRate:0,minimumScore:0,sessions:sessions,enrollments:enrollments,assignments:assignments};
    }
    async function loadEditClass(){
      if(!currentEditId)return;
      try{
        var c=await loadClassroomClass(currentEditId);if(!c)return;
        var heading=wrap.querySelector('.phfc-create-title-block h2');if(heading)heading.textContent='Chỉnh sửa lớp đào tạo';
        var draft=wrap.querySelector('.phfc-draft-state span:last-child');if(draft)draft.textContent='Đang chỉnh sửa bản nháp '+c.classCode;
        className.value=c.className||'';classCode.value=c.classCode||'';trainingPurpose.value=c.trainingPurpose||'';(wrap.querySelector('[data-phfc-class-description]')||{}).value=c.description||'';(wrap.querySelector('[data-phfc-capacity]')||{}).value=c.capacity||'';
        var radio=wrap.querySelector('input[name="phfc-class-type"][value="'+(c.classType==='multi'?'multi':'single')+'"]');if(radio)radio.checked=true;updateType();
        if(c.classType==='single'&&c.sessions&&c.sessions[0]){var x=c.sessions[0];(wrap.querySelector('[data-phfc-single-date]')||{}).value=x.sessionDate||'';(wrap.querySelector('[data-phfc-single-start]')||{}).value=x.startTime||'';(wrap.querySelector('[data-phfc-single-end]')||{}).value=x.endTime||'';(wrap.querySelector('[data-phfc-mode]')||{}).value=x.deliveryMode||'offline';(wrap.querySelector('[data-phfc-single-location]')||{}).value=x.location||'';}
        if(c.classType==='multi'){var list=wrap.querySelector('[data-phfc-session-list]');if(list)list.innerHTML='';sessionCount=0;(wrap.querySelector('[data-phfc-course-start]')||{}).value=(c.startAt||'').slice(0,16);(wrap.querySelector('[data-phfc-course-end]')||{}).value=(c.endAt||'').slice(0,16);(c.sessions||[]).forEach(function(x){var row=addSession(),inputs=row.querySelectorAll('input');(row.querySelector('[data-phfc-session-name]')||{}).value=x.sessionName||'';if(inputs[1])inputs[1].value=x.sessionDate||'';if(inputs[2])inputs[2].value=x.startTime||'';if(inputs[3])inputs[3].value=x.endTime||'';(row.querySelector('[data-phfc-session-mode]')||{}).value=x.deliveryMode||'offline';(row.querySelector('[data-phfc-session-location] input')||{}).value=x.location||'';});}
        (c.enrollments||[]).forEach(function(x){var p=eligiblePeople.find(function(y){return (x.accountId&&y.accountId===x.accountId)||(x.employeeId&&y.employeeId===x.employeeId);});if(p)selectedLearners[personKey(p)]=p.employee;});
        (c.assignments||[]).forEach(function(x){var p=eligiblePeople.find(function(y){return (x.accountId&&y.accountId===x.accountId)||(x.employeeId&&y.employeeId===x.employeeId);}),sel=wrap.querySelector('[data-phfc-assignment="'+x.assignmentRole+'"]');if(p&&sel){sel.value=personKey(p);updateAssignmentLabel(x.assignmentRole);}});
        renderSelected();updateSummary();
      }catch(error){phfcNotice('error','Chưa thể mở bản nháp',error.message||String(error));currentEditId='';try{sessionStorage.removeItem('phfcEditClassId');}catch(e){}}
    }
    renderSelected();
    updateType();setStep(1);refreshClassroomPeople();
  }


  async function phfcRefreshNotificationBadge(){
    try{var data=await phfcNotificationsApi(),badge=document.querySelector('[data-phfc-notification-badge]');if(badge){badge.textContent=String(data.unreadCount||0);badge.hidden=!Number(data.unreadCount||0);}}catch(e){}
  }
  function closeNotificationPanel(){
    var panel=document.getElementById('phfcNotificationPanel');
    if(panel&&panel.__phfcCleanup){try{panel.__phfcCleanup();}catch(e){}}
    if(panel)panel.remove();
    document.querySelectorAll('[data-phfc-notifications][aria-expanded="true"]').forEach(function(x){x.setAttribute('aria-expanded','false');});
  }
  async function showNotificationPanel(anchor){
    closeNotificationPanel();closeAccountMenu();if(!anchor)return;var panel=document.createElement('section');panel.id='phfcNotificationPanel';panel.className='phfc-notification-panel';panel.setAttribute('role','dialog');panel.innerHTML='<div class="phfc-notification-head"><div><strong>Thông báo</strong><small>PHF Classroom</small></div><button type="button" data-phfc-notification-close aria-label="Đóng">×</button></div><div class="phfc-notification-loading">Đang tải thông báo…</div>';document.body.appendChild(panel);anchor.setAttribute('aria-expanded','true');function place(){var r=anchor.getBoundingClientRect(),width=Math.min(380,Math.max(280,window.innerWidth-24));panel.style.width=width+'px';panel.style.left=Math.max(12,Math.min(window.innerWidth-width-12,r.right-width))+'px';panel.style.top=Math.max(12,Math.min(window.innerHeight-panel.offsetHeight-12,r.bottom+9))+'px';}place();panel.querySelector('[data-phfc-notification-close]').onclick=function(){closeNotificationPanel();};try{var data=await phfcNotificationsApi(),rows=data.notifications||[];panel.innerHTML='<div class="phfc-notification-head"><div><strong>Thông báo</strong><small>'+data.unreadCount+' chưa đọc</small></div><button type="button" data-phfc-notification-close>×</button></div>'+(rows.length?'<div class="phfc-notification-list">'+rows.map(function(x){return '<button type="button" class="phfc-notification-item '+(x.isRead?'is-read':'is-unread')+'" data-notice-id="'+esc(x.id)+'" data-notice-link="'+esc(x.link||'')+'"><span class="phfc-notification-level is-'+esc(x.level)+'"></span><div><strong>'+esc(x.title)+'</strong><p>'+esc(x.content)+'</p><small>'+esc(new Date(x.sentAt||x.createdAt).toLocaleString('vi-VN'))+'</small></div></button>';}).join('')+'</div><button type="button" class="phfc-notification-read-all" data-read-all>Đánh dấu tất cả đã đọc</button>':'<div class="phfc-notification-empty"><strong>Chưa có thông báo</strong><p>Các thông tin mới sẽ hiển thị tại đây.</p></div>');panel.querySelector('[data-phfc-notification-close]').onclick=function(){closeNotificationPanel();};panel.querySelectorAll('[data-notice-id]').forEach(function(b){b.onclick=async function(){await phfcNotificationsApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'markRead',id:b.getAttribute('data-notice-id')})});var link=b.getAttribute('data-notice-link');closeNotificationPanel();if(link)navigate(link);};});var all=panel.querySelector('[data-read-all]');if(all)all.onclick=async function(){await phfcNotificationsApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'markAllRead'})});showNotificationPanel(anchor);};var badge=document.querySelector('[data-phfc-notification-badge]');if(badge){badge.textContent=String(data.unreadCount);badge.hidden=!data.unreadCount;}place();}catch(e){panel.innerHTML='<div class="phfc-notification-head"><strong>Thông báo</strong><button type="button" data-phfc-notification-close>×</button></div><div class="phfc-notification-empty"><strong>Chưa thể tải thông báo</strong><p>'+esc(e.message||String(e))+'</p></div>';panel.querySelector('[data-phfc-notification-close]').onclick=function(){closeNotificationPanel();};}
  }
  function closeAccountMenu(){
    var menu=document.getElementById('phfcAccountMenu');
    if(menu&&menu.__phfcCleanup){try{menu.__phfcCleanup();}catch(e){}}
    if(menu)menu.remove();
    document.querySelectorAll('[data-phfc-account][aria-expanded="true"]').forEach(function(x){x.setAttribute('aria-expanded','false');});
  }
  async function logoutClassroom(){
    closeAccountMenu();
    try{
      if(typeof window.phfLogoutSession!=='function') throw new Error('COMMON_LOGOUT_UNAVAILABLE');
      await window.phfLogoutSession();
      /* Classroom là shell riêng nên sau khi phiên chung đã được xóa,
         đưa người dùng về trang công khai của PHF Training Hub. */
      window.location.replace('/');
      return true;
    }catch(e){
      console.error('[PHF Classroom] logout failed:',e);
      if(typeof window.phfNotice==='function'){
        window.phfNotice({type:'error',title:'Chưa thể đăng xuất',message:'Vui lòng thử lại hoặc quay về PHF Training Hub để đăng xuất.'});
      }
      return false;
    }
  }
  function showAccountMenu(anchor){
    closeNotificationPanel();
    closeAccountMenu();
    if(!anchor)return;
    var menu=document.createElement('div');
    menu.id='phfcAccountMenu';
    menu.className='phfc-account-menu';
    menu.setAttribute('role','menu');
    menu.innerHTML='<button type="button" role="menuitem" data-phfc-account-act="hub"><span class="phfc-account-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M10 6 4 12l6 6M5 12h14"/></svg></span><span><strong>Quay lại PHF Training Hub</strong><small>Về trang chủ theo tài khoản hiện tại</small></span></button><div class="phfc-account-menu-separator" aria-hidden="true"></div><button type="button" role="menuitem" class="is-danger" data-phfc-account-act="logout"><span class="phfc-account-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M14 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-3M10 12h11M18 8l4 4-4 4"/></svg></span><span><strong>Đăng xuất</strong><small>Thoát về trang PHF Training Hub</small></span></button>';
    document.body.appendChild(menu);
    anchor.setAttribute('aria-expanded','true');
    function place(){
      var r=anchor.getBoundingClientRect();
      var width=Math.min(286,Math.max(230,window.innerWidth-24));
      var left=Math.max(12,Math.min(window.innerWidth-width-12,r.right-width));
      var top=Math.min(window.innerHeight-menu.offsetHeight-12,r.bottom+8);
      menu.style.width=width+'px';menu.style.left=left+'px';menu.style.top=Math.max(12,top)+'px';
    }
    place();
    function outside(ev){if(!menu.contains(ev.target)&&!anchor.contains(ev.target))closeAccountMenu();}
    function onKey(ev){if(ev.key==='Escape'){closeAccountMenu();anchor.focus();}}
    function onMove(){closeAccountMenu();}
    setTimeout(function(){document.addEventListener('click',outside,true);},0);
    document.addEventListener('keydown',onKey,true);
    window.addEventListener('resize',onMove,true);
    window.addEventListener('scroll',onMove,true);
    menu.__phfcCleanup=function(){document.removeEventListener('click',outside,true);document.removeEventListener('keydown',onKey,true);window.removeEventListener('resize',onMove,true);window.removeEventListener('scroll',onMove,true);};
    menu.addEventListener('click',function(ev){
      var btn=ev.target.closest('[data-phfc-account-act]');if(!btn)return;
      var act=btn.getAttribute('data-phfc-account-act');
      if(act==='hub'){closeAccountMenu();return goHub();}
      if(act==='logout')return logoutClassroom();
    });
    var first=menu.querySelector('button');if(first)first.focus();
  }

  async function bindNotificationWorkspace(main){
    var wrap=main.querySelector('[data-phfc-notify-workspace]');if(!wrap)return;
    var recipients=[];
    try{
      var notificationUsers=await phfcLoadClassroomUsers(false);
      recipients=(notificationUsers||[]).map(function(u){
        return {
          id:u.accountId||u.employeeId||u.email,
          accountId:u.accountId||'',
          employeeId:u.employeeId||'',
          name:u.name||u.email||'Nhân sự',
          code:u.code||'—',
          email:u.email||'—',
          branch:u.branch||'Chưa phân chi nhánh',
          department:u.department||'Chưa phân phòng ban',
          role:u.role==='admin'?'Admin':(u.role==='manager'?'Quản lý':'Nhân viên'),
          position:u.position||''
        };
      }).filter(function(r){return r.id;});
    }catch(e){recipients=phfcNotificationRecipients();}
    var classes=[];try{classes=await loadClassroomClasses(false);}catch(e){}
    var form=wrap.querySelector('[data-phfc-notify-form]'),scope=wrap.querySelector('[data-phfc-notify-scope]'),picker=wrap.querySelector('[data-phfc-notify-person-picker]'),summary=wrap.querySelector('[data-phfc-notify-recipient-summary]'),note=wrap.querySelector('[data-phfc-notify-recipient-note]'),modal=wrap.querySelector('[data-phfc-notify-modal]'),modalBody=wrap.querySelector('[data-phfc-notify-modal-body]'),modalCount=wrap.querySelector('[data-phfc-notify-modal-count]'),modalSubtitle=wrap.querySelector('[data-phfc-notify-modal-subtitle]'),classSelect=wrap.querySelector('[data-phfc-notify-filter="class"] select');
    if(classSelect){classSelect.disabled=false;classSelect.innerHTML='<option value="">Chọn lớp đào tạo</option>'+classes.map(function(c){return '<option value="'+esc(c.id)+'">'+esc(c.classCode+' · '+c.className)+'</option>';}).join('');classSelect.setAttribute('data-phfc-notify-class','');}
    function refreshRecipientControls(){
      function setOptions(selector,values,placeholder){var el=wrap.querySelector(selector);if(!el)return;el.innerHTML='<option value="">'+esc(placeholder)+'</option>'+values.map(function(v){return '<option value="'+esc(v)+'">'+esc(v)+'</option>';}).join('');}
      setOptions('[data-phfc-notify-branch]',phfcUniqueValues(recipients,'branch'),'Chọn chi nhánh');
      setOptions('[data-phfc-notify-department]',phfcUniqueValues(recipients,'department'),'Chọn phòng ban');
      setOptions('[data-phfc-notify-role]',phfcUniqueValues(recipients,'role'),'Chọn vai trò');
      var list=wrap.querySelector('.phfc-notify-person-list');if(list)list.innerHTML=recipients.length?recipients.map(function(r){return '<label class="phfc-notify-person" data-phfc-notify-person data-search="'+esc((r.name+' '+r.code+' '+r.email+' '+r.department+' '+r.branch).toLowerCase())+'"><input type="checkbox" value="'+esc(r.id)+'" data-phfc-notify-person-check><span><strong>'+esc(r.name)+'</strong><small>'+esc(r.code)+' · '+esc(r.department)+' · '+esc(r.branch)+'</small></span></label>';}).join(''):'<p class="phfc-muted">Chưa tải được danh sách tài khoản.</p>';
      if(summary)summary.textContent='Toàn hệ thống · '+recipients.length+' tài khoản đang hoạt động';
      if(modalCount)modalCount.textContent=String(recipients.length);
    }
    refreshRecipientControls();

    function selectedIds(){return Array.from(wrap.querySelectorAll('[data-phfc-notify-person-check]:checked')).map(function(x){return x.value;});}
    function classRecipientIds(){var cid=(classSelect||{}).value||'',c=classes.find(function(x){return x.id===cid;}),ids={};((c||{}).enrollments||[]).forEach(function(x){[x.employeeId,x.accountId].filter(Boolean).forEach(function(v){ids[v]=true;});});return ids;}
    function activeRecipients(){var value=scope?scope.value:'all';if(value==='selected'){var ids=selectedIds();return recipients.filter(function(r){return ids.indexOf(r.id)>=0;});}if(value==='branch'){var v=(wrap.querySelector('[data-phfc-notify-branch]')||{}).value||'';return v?recipients.filter(function(r){return r.branch===v;}):[];}if(value==='department'){var d=(wrap.querySelector('[data-phfc-notify-department]')||{}).value||'';return d?recipients.filter(function(r){return r.department===d;}):[];}if(value==='role'){var ro=(wrap.querySelector('[data-phfc-notify-role]')||{}).value||'';return ro?recipients.filter(function(r){return r.role===ro;}):[];}if(value==='class'){var ids=classRecipientIds();return recipients.filter(function(r){return ids[r.id];});}return recipients.slice();}
    function scopeLabel(){var value=scope?scope.value:'all';return value==='all'?'Toàn hệ thống':value==='class'?'Theo lớp đào tạo':value==='branch'?'Theo chi nhánh':value==='department'?'Theo phòng ban':value==='role'?'Theo vai trò':'Nhân sự được chọn';}
    function updateRecipients(){var value=scope?scope.value:'all';wrap.querySelectorAll('[data-phfc-notify-filter]').forEach(function(el){el.hidden=el.getAttribute('data-phfc-notify-filter')!==value;});if(picker)picker.hidden=value!=='selected';var rows=activeRecipients();if(summary)summary.textContent=scopeLabel()+' · '+rows.length+' người';if(note)note.textContent=rows.length?'Danh sách người nhận sẽ được chốt tại thời điểm gửi.':'Chưa có người nhận phù hợp với phạm vi đã chọn.';}
    function renderModal(){var rows=activeRecipients();if(modalCount)modalCount.textContent=String(rows.length);if(modalSubtitle)modalSubtitle.textContent=scopeLabel();if(modalBody)modalBody.innerHTML=rows.length?rows.map(function(r){return '<tr><td><strong>'+esc(r.name)+'</strong><small>'+esc(r.email)+'</small></td><td>'+esc(r.code)+'</td><td>'+esc(r.role)+'</td><td>'+esc(r.department)+'<small>'+esc(r.branch)+'</small></td><td><span class="phfc-notify-status is-ready">Dự kiến nhận</span></td></tr>';}).join(''):'<tr><td colspan="5"><div class="phfc-notify-table-empty">Chưa có người nhận phù hợp.</div></td></tr>';}
    async function load(){try{var data=await phfcNotificationsApi(),rows=data.managedNotifications||[],now=Date.now(),sent=rows.filter(function(x){return x.status==='sent';}),active=sent.filter(function(x){return (!x.startAt||new Date(x.startAt).getTime()<=now)&&(!x.endAt||new Date(x.endAt).getTime()>=now);}),drafts=rows.filter(function(x){return x.status==='draft';}),rec=sent.reduce(function(a,x){return a+x.recipientCount;},0),read=sent.reduce(function(a,x){return a+x.readCount;},0);var set=function(sel,val){var e=wrap.querySelector(sel);if(e)e.textContent=val;};set('[data-phfc-notify-total]',rows.length);set('[data-phfc-notify-active]',active.length);set('[data-phfc-notify-draft-count]',drafts.length);set('[data-phfc-notify-read-rate]',rec?Math.round(read*100/rec)+'%':'—');var holder=wrap.querySelector('[data-phfc-notify-list-body]');if(holder)holder.innerHTML=rows.length?rows.map(function(x){return '<article class="phfc-notify-row"><div><span class="phfc-status-chip is-'+esc(x.status)+'">'+esc(x.status==='draft'?'Bản nháp':x.status==='hidden'?'Đã ẩn':'Đã gửi')+'</span><strong>'+esc(x.title)+'</strong><p>'+esc(x.content)+'</p><small>'+esc(x.recipientCount+' người nhận · '+(x.sentAt?new Date(x.sentAt).toLocaleString('vi-VN'):'Chưa gửi'))+'</small></div>'+(role()==='admin'&&x.status==='sent'?'<button type="button" class="phfc-secondary-button" data-hide-notice="'+esc(x.id)+'">Ẩn</button>':'')+'</article>';}).join(''):'<div class="phfc-notify-empty"><span>🔔</span><strong>Chưa có thông báo Classroom</strong><p>Thông báo đã lưu hoặc đã gửi sẽ xuất hiện tại đây.</p></div>';wrap.querySelectorAll('[data-hide-notice]').forEach(function(b){b.onclick=async function(){await phfcNotificationsApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'hide',id:b.getAttribute('data-hide-notice')})});phfcNotice('success','Đã ẩn thông báo','Thông báo không còn hiển thị cho người nhận.');load();};});}catch(e){phfcNotice('error','Chưa thể tải thông báo',e.message||String(e));}}
    async function save(action,btn){var rows=activeRecipients(),title=(wrap.querySelector('[data-phfc-notify-title]')||{}).value||'',content=(wrap.querySelector('[data-phfc-notify-content]')||{}).value||'';try{btn.disabled=true;await phfcNotificationsApi({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:action,title:title,content:content,level:(wrap.querySelector('[data-phfc-notify-level]')||{}).value,scopeType:scope.value,scopeValue:scope.value==='class'?(classSelect||{}).value:'',startAt:phfcLocalToIso((wrap.querySelector('[data-phfc-notify-start]')||{}).value),endAt:phfcLocalToIso((wrap.querySelector('[data-phfc-notify-end]')||{}).value),link:(wrap.querySelector('[data-phfc-notify-link]')||{}).value,recipients:rows.map(function(r){return {recipientKey:r.accountId||r.employeeId||r.id,accountId:r.accountId||'',employeeId:r.employeeId||'',name:r.name,code:r.code,email:r.email,department:r.department,branch:r.branch,position:r.position||r.role};})})});phfcNotice('success',action==='send'?'Đã gửi thông báo':'Đã lưu bản nháp',action==='send'?'Thông báo đã được phát hành đến '+rows.length+' người nhận.':'Nội dung đã được lưu để tiếp tục hoàn thiện.');if(form)form.hidden=true;load();}catch(e){phfcNotice('error','Chưa thể lưu thông báo',e.message||String(e));}finally{btn.disabled=false;}}
    var create=wrap.querySelector('[data-phfc-notify-create]');if(create)create.onclick=function(){form.hidden=false;form.scrollIntoView({block:'start',behavior:'smooth'});};var close=wrap.querySelector('[data-phfc-notify-close]');if(close)close.onclick=function(){form.hidden=true;};if(scope)scope.onchange=updateRecipients;wrap.querySelectorAll('select,input[type="checkbox"]').forEach(function(el){el.addEventListener('change',updateRecipients);});var search=wrap.querySelector('[data-phfc-notify-search]');if(search)search.oninput=function(){var q=String(search.value||'').toLowerCase();wrap.querySelectorAll('[data-phfc-notify-person]').forEach(function(row){row.hidden=q&&String(row.getAttribute('data-search')||'').indexOf(q)<0;});};var preview=wrap.querySelector('[data-phfc-notify-preview]');if(preview)preview.onclick=function(){renderModal();modal.hidden=false;};wrap.querySelectorAll('[data-phfc-notify-modal-close]').forEach(function(el){el.onclick=function(){modal.hidden=true;};});var draft=wrap.querySelector('[data-phfc-notify-draft]');if(draft)draft.onclick=function(){save('saveDraft',draft);};var send=wrap.querySelector('[data-phfc-notify-send]');if(send)send.onclick=function(){save('send',send);};updateRecipients();load();
  }
  function classPersonLabel(item){
    var people=phfcEligiblePeople(),p=people.find(function(x){return (item.accountId&&x.accountId===item.accountId)||(item.employeeId&&x.employeeId===item.employeeId);});
    return p?p.name:(item.employeeId||item.accountId||'Chưa xác định');
  }
  function classRowsHtml(rows){
    if(!rows.length)return '<div class="phfc-class-empty-state"><div class="phfc-class-empty-visual" aria-hidden="true">▦</div><h4>Chưa có lớp đào tạo</h4><p>Danh sách lớp phù hợp với quyền của bạn sẽ hiển thị tại đây.</p></div>';
    var prefix=role()==='admin'?'/admin/classroom/lop/':(role()==='manager'?'/ql/classroom/lop/':'/hv/classroom/lop/');
    return rows.map(function(c){var owner=(c.assignments||[]).find(function(a){return a.assignmentRole==='owner';});return '<button class="phfc-class-row" type="button" data-phfc-route="'+esc(prefix+c.id)+'"><span><strong>'+esc(c.className)+'</strong><small>'+esc(c.classCode)+'</small></span><span>'+esc(classTypeLabel(c.classType))+'<small>'+esc(deliveryLabel(c.deliveryMode))+'</small></span><span>'+esc(formatClassDate(c.startAt))+'<small>đến '+esc(formatClassDate(c.endAt))+'</small></span><span>'+esc(owner?classPersonLabel(owner):'Chưa phân công')+'</span><span>'+String((c.enrollments||[]).length)+'</span><span><b class="phfc-status-chip is-'+esc(c.status)+'">'+esc(classStatusLabel(c.status))+'</b></span></button>';}).join('');
  }
  async function hydrateClassList(root){
    var workspace=root.querySelector('[data-phfc-class-list]');if(!workspace)return;
    var holder=workspace.querySelector('[data-phfc-class-rows]');
    try{
      var rows=await loadClassroomClasses(false);if(!document.body.contains(workspace))return;
      var all=workspace.querySelector('[data-phfc-count-all]'),progress=workspace.querySelector('[data-phfc-count-progress]'),upcoming=workspace.querySelector('[data-phfc-count-upcoming]'),completed=workspace.querySelector('[data-phfc-count-completed]');
      if(all)all.textContent=String(rows.length);if(progress)progress.textContent=String(rows.filter(function(x){return x.status==='in_progress';}).length);if(completed)completed.textContent=String(rows.filter(function(x){return x.status==='completed';}).length);if(upcoming)upcoming.textContent=String(rows.filter(function(x){return x.status==='published'&&x.startAt&&new Date(x.startAt)>new Date();}).length);
      function draw(){var q=norm((workspace.querySelector('[data-phfc-class-search]')||{}).value||''),type=(workspace.querySelector('[data-phfc-class-type-filter]')||{}).value||'',mode=(workspace.querySelector('[data-phfc-class-mode-filter]')||{}).value||'',status=(workspace.querySelector('[data-phfc-class-status-filter]')||{}).value||'';var filtered=rows.filter(function(c){return (!q||norm(c.className+' '+c.classCode).indexOf(q)>=0)&&(!type||c.classType===type)&&(!mode||c.deliveryMode===mode)&&(!status||c.status===status);});holder.innerHTML=classRowsHtml(filtered);holder.querySelectorAll('[data-phfc-route]').forEach(function(btn){btn.addEventListener('click',function(){navigate(btn.getAttribute('data-phfc-route'));});});}
      workspace.querySelectorAll('input,select').forEach(function(el){el.addEventListener(el.tagName==='INPUT'?'input':'change',draw);});draw();
    }catch(error){if(holder)holder.innerHTML='<div class="phfc-class-error"><strong>Chưa thể tải danh sách lớp</strong><p>'+esc(error.message||String(error))+'</p><button type="button" data-phfc-retry-class-list>Thử lại</button></div>';var retry=holder&&holder.querySelector('[data-phfc-retry-class-list]');if(retry)retry.addEventListener('click',function(){classroomCache.loaded=false;hydrateClassList(root);});}
  }
  function classDetailHtml(c){
    var owner=(c.assignments||[]).find(function(a){return a.assignmentRole==='owner';});var canAdmin=role()==='admin';
    var actions=canAdmin?'<div class="phfc-detail-actions"><button class="phfc-danger-button phfc-trash-action" type="button" data-phfc-delete-class><span aria-hidden="true">⌫</span><span>Chuyển vào Thùng rác</span></button>'+(c.status==='draft'?'<button class="phfc-secondary-button" type="button" data-phfc-edit-class="'+esc(c.id)+'">Chỉnh sửa</button><button class="phfc-primary-button" type="button" data-phfc-publish-class>Phát hành lớp</button>':'')+'</div>':'';
    var sessions=(c.sessions||[]).map(function(x){return '<article class="phfc-detail-session"><b>'+x.sessionNumber+'</b><div><strong>'+esc(x.sessionName)+'</strong><span>'+esc(x.sessionDate||'Chưa có ngày')+' · '+esc(x.startTime||'—')+'–'+esc(x.endTime||'—')+' · '+esc(deliveryLabel(x.deliveryMode))+'</span><small>'+esc(x.location||'Không có địa điểm')+'</small></div></article>';}).join('');
    var learners=(c.enrollments||[]).map(function(x){return '<li><strong>'+esc(classPersonLabel(x))+'</strong><span>'+esc(x.required?'Bắt buộc':'Tự nguyện')+'</span></li>';}).join('');
    return '<div class="phfc-detail-head"><button class="phfc-back-link" type="button" data-phfc-route="'+(role()==='admin'?'/admin/classroom/lop':role()==='manager'?'/ql/classroom/lop':'/hv/classroom')+'">← Quay lại</button><div><small>'+esc(c.classCode)+'</small><h3>'+esc(c.className)+'</h3><p>'+esc(c.description||'Chưa có mô tả lớp.')+'</p></div><span class="phfc-status-chip is-'+esc(c.status)+'">'+esc(classStatusLabel(c.status))+'</span>'+actions+'</div><section class="phfc-detail-kpis"><article><span>Loại lớp</span><strong>'+esc(classTypeLabel(c.classType))+'</strong></article><article><span>Hình thức</span><strong>'+esc(deliveryLabel(c.deliveryMode))+'</strong></article><article><span>Học viên</span><strong>'+String((c.enrollments||[]).length)+'</strong></article><article><span>Người phụ trách</span><strong>'+esc(owner?classPersonLabel(owner):'Chưa phân công')+'</strong></article></section><div class="phfc-detail-grid"><section class="phfc-card phfc-detail-panel"><h4>Lịch và buổi học</h4>'+(sessions||'<p class="phfc-muted">Chưa có buổi học.</p>')+'</section><section class="phfc-card phfc-detail-panel"><h4>Học viên tham gia</h4>'+(learners?'<ul class="phfc-detail-learners">'+learners+'</ul>':'<p class="phfc-muted">Chưa có học viên.</p>')+'</section></div>';
  }
  async function hydrateClassDetail(root){
    var holder=root.querySelector('[data-phfc-class-detail]');if(!holder)return;var id=holder.getAttribute('data-phfc-class-detail');
    try{var c=await loadClassroomClass(id);if(!document.body.contains(holder))return;holder.innerHTML=classDetailHtml(c);holder.querySelectorAll('[data-phfc-route]').forEach(function(btn){btn.addEventListener('click',function(){navigate(btn.getAttribute('data-phfc-route'));});});var edit=holder.querySelector('[data-phfc-edit-class]');if(edit)edit.addEventListener('click',function(){sessionStorage.setItem('phfcEditClassId',c.id);navigate('/admin/classroom/lop/tao-moi');});var del=holder.querySelector('[data-phfc-delete-class]');if(del)del.addEventListener('click',async function(){try{await phfcSoftDelete('class',c.id,'lớp đào tạo',function(){navigate('/admin/classroom/lop');});}catch(e){phfcNotice('error','Chưa thể xóa lớp',e.message||String(e));}});var publish=holder.querySelector('[data-phfc-publish-class]');if(publish)publish.addEventListener('click',async function(){try{publish.disabled=true;publish.textContent='Đang phát hành…';c=await saveClassroomClass(c,'publish');phfcNotice('success','Đã phát hành lớp','Học viên được phân công đã có thể nhìn thấy lớp.');holder.innerHTML=classDetailHtml(c);hydrateClassDetail(root);}catch(error){phfcNotice('error','Chưa thể phát hành lớp',error.message||String(error));}finally{publish.disabled=false;}});}catch(error){holder.innerHTML='<div class="phfc-class-error"><strong>Chưa thể tải thông tin lớp</strong><p>'+esc(error.message||String(error))+'</p></div>';}
  }
  async function hydrateLearnerClasses(root){
    var holder=root.querySelector('[data-phfc-learner-classes]');if(!holder)return;
    try{var rows=await loadClassroomClasses(false);if(!document.body.contains(holder))return;holder.innerHTML='<section class="phfc-hero phfc-hero-light"><div><span class="phfc-eyebrow">Lớp đào tạo của tôi</span><h3>Chào '+esc(name())+'</h3><p>Các lớp được phân công và đã phát hành sẽ hiển thị tại đây.</p></div><div class="phfc-hero-stats"><div class="phfc-hero-stat"><b>'+rows.length+'</b><span>Lớp được phân công</span></div><div class="phfc-hero-stat"><b>'+rows.filter(function(x){return x.status==='in_progress';}).length+'</b><span>Đang học</span></div><div class="phfc-hero-stat"><b>'+rows.filter(function(x){return x.status==='completed';}).length+'</b><span>Đã hoàn thành</span></div></div></section><section class="phfc-card phfc-learner-class-list">'+classRowsHtml(rows)+'</section>';holder.querySelectorAll('[data-phfc-route]').forEach(function(btn){btn.addEventListener('click',function(){navigate(btn.getAttribute('data-phfc-route'));});});}catch(error){holder.innerHTML='<div class="phfc-class-error"><strong>Chưa thể tải lớp của bạn</strong><p>'+esc(error.message||String(error))+'</p></div>';}
  }
  async function hydrateClassroomUsers(root){
    var workspace=root.querySelector('[data-phfc-users-workspace]');if(!workspace)return;var holder=workspace.querySelector('[data-phfc-users-rows]');
    try{var result=await Promise.all([phfcLoadClassroomUsers(false),loadClassroomClasses(false)]),rows=phfcBuildUserUsage(result[0],result[1]);if(!document.body.contains(workspace))return;
      var total=workspace.querySelector('[data-phfc-users-total]'),enrolled=workspace.querySelector('[data-phfc-users-enrolled]'),assigned=workspace.querySelector('[data-phfc-users-assigned]'),classOnly=workspace.querySelector('[data-phfc-users-class-only]');
      if(total)total.textContent=String(rows.length);if(enrolled)enrolled.textContent=String(rows.filter(function(x){return x.enrollments.length>0;}).length);if(assigned)assigned.textContent=String(rows.filter(function(x){return x.assignments.length>0;}).length);if(classOnly)classOnly.textContent=String(rows.filter(function(x){return norm(x.user.defaultProgram)==='phf_class';}).length);
      function draw(){var q=norm((workspace.querySelector('[data-phfc-users-search]')||{}).value||''),scope=(workspace.querySelector('[data-phfc-users-scope]')||{}).value||'',usage=(workspace.querySelector('[data-phfc-users-usage]')||{}).value||'';var filtered=rows.filter(function(x){var u=x.user,text=[u.fullName,u.employeeCode,u.email,u.phone,u.department,u.position,u.branch].join(' ');return (!q||norm(text).indexOf(q)>=0)&&(!scope||norm(u.defaultProgram)===scope)&&(!usage||(usage==='learner'&&x.enrollments.length)||(usage==='assigned'&&x.assignments.length)||(usage==='unused'&&!x.enrollments.length&&!x.assignments.length));});holder.innerHTML=phfcUserRowsHtml(filtered);holder.querySelectorAll('[data-phfc-user-key]').forEach(function(btn){btn.addEventListener('click',function(){var key=btn.getAttribute('data-phfc-user-key'),row=rows.find(function(x){return phfcUserKey(x.user)===key;}),overlay=workspace.querySelector('[data-phfc-user-detail]'),body=workspace.querySelector('[data-phfc-user-detail-body]');if(!row||!overlay||!body)return;body.innerHTML=phfcUserDetailHtml(row);overlay.hidden=false;document.documentElement.classList.add('phfc-modal-lock');body.querySelectorAll('[data-phfc-user-detail-close]').forEach(function(close){close.addEventListener('click',function(){overlay.hidden=true;document.documentElement.classList.remove('phfc-modal-lock');});});});});}
      workspace.querySelectorAll('input,select').forEach(function(el){el.addEventListener(el.tagName==='INPUT'?'input':'change',draw);});var overlay=workspace.querySelector('[data-phfc-user-detail]');if(overlay)overlay.addEventListener('click',function(ev){if(ev.target===overlay){overlay.hidden=true;document.documentElement.classList.remove('phfc-modal-lock');}});draw();
    }catch(error){holder.innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tải người dùng Classroom</strong><span>'+esc(error.message||String(error))+'</span><button type="button" data-phfc-retry-users>Thử lại</button></div>';var retry=holder.querySelector('[data-phfc-retry-users]');if(retry)retry.addEventListener('click',function(){phfcClassroomUsersCache=null;classroomCache.loaded=false;hydrateClassroomUsers(root);});}
  }
  function phfcDashboardDateKey(value){
    if(!value)return '';
    var d=value instanceof Date?value:new Date(String(value).length===10?value+'T00:00:00':value);
    if(Number.isNaN(d.getTime()))return String(value).slice(0,10);
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  }
  function phfcDashboardOpenAttendance(classId,sessionId){
    try{sessionStorage.setItem('phfcAttendanceClassId',classId||'');sessionStorage.setItem('phfcAttendanceSessionId',sessionId||'');}catch(e){}
    navigate('/admin/classroom/diem-danh');
  }
  async function hydrateAdminDashboard(root){
    var workspace=root.querySelector('[data-phfc-admin-dashboard]');if(!workspace)return;
    var attHolder=workspace.querySelector('[data-phfc-dashboard-att-list]'),classHolder=workspace.querySelector('[data-phfc-dashboard-class-list]'),scheduleHolder=workspace.querySelector('[data-phfc-dashboard-schedule]');
    try{
      var classes=await loadClassroomClasses(false);if(!document.body.contains(workspace))return;
      var now=new Date(),today=phfcDashboardDateKey(now),learnerKeys={},sessions=[];
      classes.forEach(function(c){(c.enrollments||[]).forEach(function(en){var key=en.employeeId||en.accountId;if(key&&c.status!=='cancelled'&&c.status!=='completed')learnerKeys[key]=true;});(c.sessions||[]).forEach(function(s){if(s&&s.id)sessions.push({classRow:c,session:s});});});
      function classStart(c){return c.startAt?new Date(c.startAt):null;} function classEnd(c){return c.endAt?new Date(c.endAt):null;}
      var upcoming=classes.filter(function(c){var d=classStart(c);return c.status==='published'&&d&&!Number.isNaN(d.getTime())&&d>now;}).length;
      var progress=classes.filter(function(c){var a=classStart(c),b=classEnd(c);return c.status==='in_progress'||(c.status==='published'&&a&&b&&a<=now&&b>=now);}).length;
      var counts={all:classes.length,upcoming:upcoming,progress:progress,completed:classes.filter(function(c){return c.status==='completed';}).length,learners:Object.keys(learnerKeys).length};
      Object.keys(counts).forEach(function(k){var el=workspace.querySelector('[data-phfc-dashboard-count="'+k+'"]');if(el)el.textContent=String(counts[k]);});
      workspace.querySelectorAll('[data-phfc-dashboard-kpi]').forEach(function(btn){btn.addEventListener('click',function(){navigate('/admin/classroom/lop');});});
      var recent=classes.slice().sort(function(a,b){return String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||''));}).slice(0,8);
      classHolder.innerHTML=recent.length?recent.map(function(c){return '<button type="button" class="phfc-dashboard-class-row" data-phfc-route="/admin/classroom/lop/'+esc(c.id)+'"><span><strong>'+esc(c.className||'Lớp đào tạo')+'</strong><small>'+esc(c.classCode||'Chưa có mã')+'</small></span><span>'+String((c.enrollments||[]).length)+' học viên</span><b class="phfc-status-chip is-'+esc(c.status)+'">'+esc(classStatusLabel(c.status))+'</b></button>';}).join(''):'<div class="phfc-dashboard-empty"><strong>Chưa có lớp đào tạo</strong><span>Lớp mới tạo sẽ hiển thị tại đây.</span></div>';
      var future=sessions.filter(function(x){var d=new Date((x.session.sessionDate||'')+'T'+(x.session.startTime||'00:00')+':00');return !Number.isNaN(d.getTime())&&d>=now&&norm(x.session.status)!=='cancelled';}).sort(function(a,b){return String(a.session.sessionDate+a.session.startTime).localeCompare(String(b.session.sessionDate+b.session.startTime));}).slice(0,5);
      scheduleHolder.innerHTML=future.length?future.map(function(x){return '<button type="button" class="phfc-dashboard-schedule-row" data-phfc-route="/admin/classroom/lich"><time>'+esc(phfcDateLabel(x.session.sessionDate))+'<b>'+esc(x.session.startTime||'—')+'</b></time><span><strong>'+esc(x.classRow.className||'Lớp đào tạo')+'</strong><small>'+esc((x.session.sessionName||'Buổi học')+' · '+deliveryLabel(x.session.deliveryMode||x.classRow.deliveryMode)+(x.session.location?' · '+x.session.location:''))+'</small></span></button>';}).join(''):'<div class="phfc-dashboard-empty"><strong>Chưa có lịch sắp tới</strong><span>Các buổi đã xếp lịch sẽ hiển thị tại đây.</span></div>';
      var attendanceSessions=sessions.filter(function(x){return x.session.sessionDate&&phfcDashboardDateKey(x.session.sessionDate)<=today;});
      var results=await Promise.allSettled(attendanceSessions.map(function(x){return phfcAttendanceApi(x.session.id).then(function(data){return {item:x,data:data};});}));
      if(!document.body.contains(workspace))return;
      var rows=[];results.forEach(function(r){if(r.status==='fulfilled')rows.push(r.value);});
      var attCounts={not_started:0,draft:0,overdue:0,finalized_today:0};
      rows.forEach(function(r){var state=r.data.workflowState||'not_started',history=Array.isArray(r.data.attendanceHistory)?r.data.attendanceHistory:[],last=history[0]||{};if(r.data.isExpired&&state!=='finalized')attCounts.overdue++;else if(state==='draft')attCounts.draft++;else if(state==='not_started')attCounts.not_started++;if(state==='finalized'&&phfcDashboardDateKey(last.performedAt||r.data.finalizedAt)===today)attCounts.finalized_today++;});
      Object.keys(attCounts).forEach(function(k){var el=workspace.querySelector('[data-phfc-att-count="'+k+'"]');if(el)el.textContent=String(attCounts[k]);});
      function attendanceMeta(r){var state=r.data.workflowState||'not_started',overdue=r.data.isExpired&&state!=='finalized';return {state:state,overdue:overdue,key:overdue?'overdue':state,label:overdue?'Quá hạn chưa chốt':(state==='draft'?'Đã lưu tạm':(state==='finalized'?'Đã chốt':'Chưa thực hiện')),cls:overdue?'is-overdue':(state==='draft'?'is-draft':(state==='finalized'?'is-finalized':'is-unmarked'))};}
      var dashboardRows=rows.slice().sort(function(a,b){var am=attendanceMeta(a),bm=attendanceMeta(b),rank={overdue:0,draft:1,not_started:2,finalized:3};return (rank[am.key]||9)-(rank[bm.key]||9)||String(b.item.session.sessionDate+b.item.session.startTime).localeCompare(String(a.item.session.sessionDate+a.item.session.startTime));});
      function renderAttendanceList(filter){
        var selected=dashboardRows.filter(function(r){var m=attendanceMeta(r);if(filter==='attention')return m.overdue||m.state==='draft'||(m.state==='not_started'&&phfcDashboardDateKey(r.item.session.sessionDate)===today);if(filter==='finalized')return m.state==='finalized';return m.key===filter;}).slice(0,10);
        attHolder.innerHTML=selected.length?selected.map(function(r){var m=attendanceMeta(r),responsible=(r.data.attendanceOfficerName||r.data.ownerName||'Chưa cập nhật người phụ trách'),learnerCount=((r.data.classroomClass||{}).enrollments||[]).length;return '<article class="phfc-dashboard-att-row"><span class="phfc-dashboard-att-state '+m.cls+'">'+esc(m.label)+'</span><div><strong>'+esc(r.item.classRow.className||'Lớp đào tạo')+'</strong><small>'+esc((r.item.session.sessionName||'Buổi học')+' · '+phfcDateLabel(r.item.session.sessionDate)+' · '+(r.item.session.startTime||'—'))+'</small><small>'+esc(responsible)+' · '+learnerCount+' học viên</small></div><button type="button" data-phfc-open-attendance data-class-id="'+esc(r.item.classRow.id)+'" data-session-id="'+esc(r.item.session.id)+'">Mở sổ điểm danh</button></article>';}).join(''):'<div class="phfc-dashboard-empty is-success"><strong>Không có dữ liệu trong nhóm này</strong><span>Chọn nhóm khác để xem tình hình điểm danh.</span></div>';
        }
      var filterButtons=workspace.querySelectorAll('[data-phfc-att-filter]');filterButtons.forEach(function(btn){btn.addEventListener('click',function(){filterButtons.forEach(function(x){x.classList.toggle('active',x===btn);});renderAttendanceList(btn.getAttribute('data-phfc-att-filter')||'attention');});});
      renderAttendanceList('attention');
      workspace.querySelectorAll('[data-phfc-route]').forEach(function(btn){btn.addEventListener('click',function(){navigate(btn.getAttribute('data-phfc-route'));});});
      workspace.querySelectorAll('[data-phfc-open-attendance]').forEach(function(btn){btn.addEventListener('click',function(){phfcDashboardOpenAttendance(btn.getAttribute('data-class-id'),btn.getAttribute('data-session-id'));});});
    }catch(error){
      [attHolder,classHolder,scheduleHolder].forEach(function(holder){if(holder)holder.innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tải Tổng quan</strong><span>'+esc(error.message||String(error))+'</span></div>';});
    }
  }
  function phfcSetRouteLoading(root,active,message){
    if(!root)return;
    var box=root.querySelector('[data-phfc-route-loading]');
    if(active){
      if(!box){box=document.createElement('div');box.setAttribute('data-phfc-route-loading','');box.className='phfc-route-loading';box.innerHTML='<span class="phfc-route-loading-spinner" aria-hidden="true"></span><strong></strong>';root.appendChild(box);}
      var text=box.querySelector('strong');if(text)text.textContent=message||'Đang tải dữ liệu PHF Classroom…';box.hidden=false;root.setAttribute('aria-busy','true');
    }else if(box){box.hidden=true;root.removeAttribute('aria-busy');}
  }
  async function hydrateClassroomData(root){
    var token=String(Date.now())+'-'+Math.random().toString(36).slice(2);root.dataset.phfcHydrationToken=token;phfcSetRouteLoading(root,true,'Đang tải dữ liệu PHF Classroom…');
    var jobs=[hydrateAdminDashboard,hydrateClassList,hydrateClassDetail,hydrateLearnerClasses,hydrateClassroomUsers,hydrateSchedule,hydrateAttendance,hydrateLearning,hydrateMaterials,hydrateResults,hydrateProposals,hydrateSettings].map(function(fn){try{return Promise.resolve(fn(root));}catch(e){return Promise.reject(e);}});
    try{await Promise.allSettled(jobs);phfcEnhanceDateTimeInputs(root);}finally{if(root.dataset.phfcHydrationToken===token)phfcSetRouteLoading(root,false);}
  }
  function bindShell(main){
    main.querySelectorAll('[data-phfc-back]').forEach(function(back){back.addEventListener('click',goHub);});
    var shell=main.querySelector('.phfc-shell');
    var mobileMenu=main.querySelector('[data-phfc-mobile-menu]');
    function setMobileMenu(open){
      if(!shell)return;
      shell.classList.toggle('is-mobile-menu-open',!!open);
      if(mobileMenu)mobileMenu.setAttribute('aria-expanded',open?'true':'false');
      document.documentElement.classList.toggle('phfc-mobile-menu-lock',!!open);
    }
    if(mobileMenu)mobileMenu.addEventListener('click',function(){setMobileMenu(mobileMenu.getAttribute('aria-expanded')!=='true');});
    main.querySelectorAll('[data-phfc-mobile-close]').forEach(function(btn){btn.addEventListener('click',function(){setMobileMenu(false);});});
    phfcRefreshNotificationBadge();
    var notification=main.querySelector('[data-phfc-notifications]');if(notification)notification.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();var opened=notification.getAttribute('aria-expanded')==='true';if(opened)closeNotificationPanel();else showNotificationPanel(notification);});
    var account=main.querySelector('[data-phfc-account]');if(account)account.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();var opened=account.getAttribute('aria-expanded')==='true';if(opened)closeAccountMenu();else showAccountMenu(account);});
    main.querySelectorAll('[data-phfc-route]').forEach(function(btn){btn.addEventListener('click',function(){setMobileMenu(false);navigate(btn.getAttribute('data-phfc-route'));});});
    bindCreateClass(main);
    bindNotificationWorkspace(main);
    bindTests(main);
    main.querySelectorAll('[data-phfc-nav-toggle]').forEach(function(toggle){
      toggle.addEventListener('click',function(){
        var group=toggle.closest('.phfc-nav-group');
        var panel=document.getElementById(toggle.getAttribute('aria-controls'));
        if(!group||!panel)return;
        var willOpen=toggle.getAttribute('aria-expanded')!=='true';
        toggle.setAttribute('aria-expanded',willOpen?'true':'false');
        group.classList.toggle('is-open',willOpen);
        panel.hidden=!willOpen;
        var mark=toggle.querySelector('.phfc-nav-toggle-mark');if(mark)mark.textContent=willOpen?'−':'+';
      });
    });
  }
  function render(path){
    var root=classroomRoot();if(!root)return false;
    path=normalizeRoute(path||location.pathname);
    if(!isClassroomPath(path)) return false;
    if(cleanPath(location.pathname)!==path)setUrl(path,true);
    var meta=pageMeta(path);
    document.title=meta[0]+' · PHF Classroom';
    root.innerHTML=shell(pageContent(path),meta[0],meta[1],path);
    bindShell(root);
    hydrateClassroomData(root);
    /* Một route Hub có thể đã thắng trong cùng tick; không để render Classroom cũ hiện lại. */
    if(!isClassroomPath(location.pathname)){
      return false;
    }
    try{root.scrollTop=0;window.scrollTo({top:0,left:0,behavior:'auto'});}catch(e){}
    return true;
  }
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
    if(isClassroomPath(location.pathname)) return;
    var header=document.querySelector('.phf-site-header');if(!header)return;
    var icons=document.querySelectorAll('#phfClassroomHeaderIcon');
    for(var i=1;i<icons.length;i++)icons[i].remove();
    var icon=icons[0]||null;
    if(!icon){
      icon=document.createElement('button');icon.id='phfClassroomHeaderIcon';icon.className='phf-classroom-header-icon';icon.type='button';
      icon.innerHTML=iconSvg()+'<span class="phf-classroom-icon-tip">PHF Classroom</span>';
      icon.setAttribute('aria-label','Mở PHF Classroom');icon.onclick=function(){window.phfOpenClassroom();};
    }
    var notif=document.getElementById('phfNotificationWrap'), login=header.querySelector('.phf-login-entry');
    if(notif&&icon.nextSibling!==notif) header.insertBefore(icon,notif);
    else if(!notif&&login&&icon.nextSibling!==login) header.insertBefore(icon,login);
    else if(!icon.parentNode)header.appendChild(icon);
    icon.style.display=user()?'inline-flex':'none';
    syncLearningVisibility();
  }
  function open(){var r=role();return window.phfNavigate?window.phfNavigate(r==='admin'?'/admin/classroom':(r==='manager'?'/ql/classroom':'/hv/classroom')):navigate(r==='learner'?'/classroom/my-classes':'/classroom');}
  window.phfOpenClassroom=open;
  window.phfRenderClassroom=render;
  window.phfClassroomNavigate=navigate;
  window.phfClassroomGoHub=goHub;
  window.phfHasActiveTrainingHubProgram=hasActiveHubProgram;
  window.phfSyncTrainingEntryVisibility=syncLearningVisibility;
  window.phfEnsureClassroomHeaderIcon=ensureHeaderIcon;
  function refreshHeader(){
    if(isClassroomPath(location.pathname))return;
    window.requestAnimationFrame(function(){ensureHeaderIcon();});
  }
  window.addEventListener('phf-auth-changed',function(){
    if(!user()&&isClassroomPath(location.pathname)){
      if(typeof window.phfNavigate==='function')window.phfNavigate('/login',true);
      return;
    }
    refreshHeader();
  });
  window.addEventListener('phf-training-data-ready',refreshHeader);
  document.addEventListener('DOMContentLoaded',function(){
    /* Router là nguồn duy nhất quyết định shell đang hiển thị. */
    refreshHeader();
  });
  if(document.readyState!=='loading') refreshHeader();
})();
