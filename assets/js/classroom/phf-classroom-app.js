/* PHF Classroom 1.0 - workspace giao diện nền tảng, chưa nối dữ liệu lớp */
(function(){
  'use strict';
  var VERSION='1.3';
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
      ]}
    ],
    learner:[
      {group:'Cá nhân',items:[
        ['/hv/classroom','Lớp đào tạo của tôi',true],
        ['/hv/classroom/lich','Lịch học của tôi',true],
        ['/hv/classroom/tai-lieu','Tài liệu đào tạo',true],
        ['/hv/classroom/bai-kiem-tra','Bài kiểm tra của tôi',true],
        ['/hv/classroom/ket-qua','Kết quả của tôi',true]
      ]}
    ]
  };
  function role(){try{return String((window.phfGetSessionRole&&window.phfGetSessionRole())||((window.phfGetAuthenticatedUser&&window.phfGetAuthenticatedUser()||{}).role)||'learner').toLowerCase();}catch(e){return 'learner';}}
  function user(){try{return window.phfGetAuthenticatedUser?window.phfGetAuthenticatedUser():null;}catch(e){return null;}}
  function name(){var u=user()||{};return String(u.name||u.display_name||u.email||'PHF').trim();}
  function isManage(){return role()==='admin'||role()==='manager';}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
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
      '<header class="phfc-header"><button class="phfc-mobile-menu-button" type="button" data-phfc-mobile-menu aria-controls="phfcMobileSidebar" aria-expanded="false" aria-label="Mở menu Classroom"><span></span><span></span><span></span></button><button class="phfc-hub-back" type="button" data-phfc-back><span class="phfc-hub-back-icon" aria-hidden="true">←</span><span class="phfc-hub-back-copy"><strong>PHF Training Hub</strong><small>Quay lại hệ thống đào tạo</small></span></button><div class="phfc-header-brand"><div class="phfc-header-brand-main"><img class="phfc-header-company-logo" src="assets/images/classroom/phuhoafresh-wordmark.png" alt="Phuhoafresh"><strong>PHF Classroom</strong><small>Quản lý đào tạo nội bộ</small></div></div><div class="phfc-header-actions"><button class="phfc-notification-button" type="button" data-phfc-notifications aria-haspopup="dialog" aria-expanded="false" aria-label="Thông báo Classroom"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg></button><button class="phfc-header-user" type="button" data-phfc-account aria-haspopup="menu" aria-expanded="false"><span><span class="phfc-greeting-prefix">Xin chào, </span><strong class="phfc-greeting-name">'+esc(name())+'</strong></span><span class="phfc-header-user-bottom"><small>'+esc(label)+'</small><span class="phfc-account-chevron" aria-hidden="true"></span></span></button></div></header>'+ 
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
        '<article class="phfc-card"><span>Tổng thông báo</span><strong>0</strong><small>Chưa có dữ liệu gửi thật</small></article>'+ 
        '<article class="phfc-card"><span>Đang hiển thị</span><strong>0</strong><small>Trong PHF Classroom</small></article>'+ 
        '<article class="phfc-card"><span>Đã lên lịch</span><strong>0</strong><small>Chờ đến thời điểm gửi</small></article>'+ 
        '<article class="phfc-card"><span>Tỷ lệ đã xem</span><strong>—</strong><small>Sẽ tính theo từng người nhận</small></article>'+ 
      '</section>'+ 
      '<section class="phfc-card phfc-notify-toolbar"><div><h3>Quản trị thông báo</h3><p>Thông báo chỉ hiển thị sau khi người dùng đăng nhập vào hệ thống.</p></div><button class="phfc-primary-button" type="button" data-phfc-notify-create>+ Tạo thông báo</button></section>'+ 
      '<section class="phfc-card phfc-notify-form" data-phfc-notify-form hidden>'+ 
        '<div class="phfc-notify-form-head"><div><small>THÔNG BÁO MỚI</small><h3>Soạn thông báo Classroom</h3><p>Danh sách người nhận sẽ được chốt tại thời điểm gửi để bảo toàn lịch sử.</p></div><button type="button" class="phfc-icon-button" data-phfc-notify-close aria-label="Đóng">×</button></div>'+ 
        '<div class="phfc-notify-grid">'+ 
          '<label class="phfc-field phfc-field-wide"><span>Tiêu đề thông báo *</span><input type="text" maxlength="160" placeholder="Ví dụ: Lịch đào tạo kỹ năng bán hàng tháng 7" data-phfc-notify-title></label>'+ 
          '<label class="phfc-field phfc-field-wide"><span>Nội dung *</span><textarea rows="5" placeholder="Nhập nội dung ngắn gọn, rõ việc cần người nhận thực hiện" data-phfc-notify-content></textarea></label>'+ 
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
        '<div class="phfc-notify-actions"><div class="phfc-notify-safe-note"><strong>Chưa ghi dữ liệu thật</strong><span>Giao diện đã sẵn sàng; thao tác gửi chỉ mở sau khi chốt schema và API Classroom.</span></div><button class="phfc-secondary-button" type="button" data-phfc-notify-draft>Lưu bản nháp</button><button class="phfc-primary-button" type="button" data-phfc-notify-send>Gửi thông báo</button></div>'+ 
      '</section>'+ 
      '<section class="phfc-card phfc-notify-list">'+ 
        '<div class="phfc-notify-list-head"><div><h3>Danh sách thông báo</h3><p>Theo dõi phạm vi gửi, người nhận và trạng thái đã xem.</p></div><div class="phfc-notify-filters"><select aria-label="Lọc trạng thái"><option>Tất cả trạng thái</option><option>Bản nháp</option><option>Đã lên lịch</option><option>Đang hiển thị</option><option>Đã kết thúc</option><option>Đã thu hồi</option></select><select aria-label="Lọc mức độ"><option>Tất cả mức độ</option><option>Thông thường</option><option>Quan trọng</option><option>Khẩn</option></select></div></div>'+ 
        '<div class="phfc-notify-empty"><span aria-hidden="true">🔔</span><strong>Chưa có thông báo Classroom</strong><p>Thông báo đã lưu hoặc đã gửi sẽ xuất hiện tại đây. Không có dữ liệu mẫu được tạo.</p></div>'+ 
      '</section>'+ 
      '<div class="phfc-notify-modal" data-phfc-notify-modal hidden><div class="phfc-notify-modal-backdrop" data-phfc-notify-modal-close></div><section class="phfc-card phfc-notify-modal-card" role="dialog" aria-modal="true" aria-label="Danh sách người nhận"><div class="phfc-notify-modal-head"><div><h3>Danh sách người nhận dự kiến</h3><p data-phfc-notify-modal-subtitle>Toàn hệ thống</p></div><button type="button" class="phfc-icon-button" data-phfc-notify-modal-close aria-label="Đóng">×</button></div><div class="phfc-notify-modal-stats"><strong data-phfc-notify-modal-count>'+recipients.length+'</strong><span>tài khoản dự kiến nhận</span></div><div class="phfc-notify-table-wrap"><table><thead><tr><th>Người nhận</th><th>Mã NV</th><th>Vai trò</th><th>Đơn vị</th><th>Trạng thái</th></tr></thead><tbody data-phfc-notify-modal-body></tbody></table></div></section></div>'+ 
    '</section>';
  }
  function adminKpis(){
    var items=[
      ['Lớp đang diễn ra','0','Đang trong thời gian học'],
      ['Lớp sắp bắt đầu','0','Trong 30 ngày tới'],
      ['Đề xuất chờ duyệt','0','Chưa được xử lý'],
      ['Công việc cần xử lý','0','Cần Admin theo dõi']
    ];
    return '<section class="phfc-admin-kpis">'+items.map(function(x,i){return '<article class="phfc-card phfc-admin-kpi"><span class="phfc-admin-kpi-icon" aria-hidden="true">'+(['▦','◫','✓','!'][i])+'</span><div><h4>'+esc(x[0])+'</h4><strong>'+esc(x[1])+'</strong><p>'+esc(x[2])+'</p></div></article>';}).join('')+'</section>';
  }
  function adminQuickActions(){
    var actions=[
      {icon:'＋',title:'Tạo lớp',copy:'Mở khu quản lý lớp đào tạo.',route:'/admin/classroom/lop'},
      {icon:'◇',title:'Quản lý lớp',copy:'Xem khu danh sách lớp đào tạo.',route:'/admin/classroom/lop'},
      {icon:'✓',title:'Duyệt đề xuất',copy:'Xem và duyệt đề xuất đào tạo.',route:'/admin/classroom/de-xuat',accent:true},
      {icon:'▤',title:'Quản lý bài kiểm tra',copy:'Mở khu bài kiểm tra Classroom.',route:'/admin/classroom/bai-kiem-tra'}
    ];
    return '<section class="phfc-admin-section"><div class="phfc-section-heading"><h3>Thao tác nhanh</h3></div><div class="phfc-admin-actions">'+actions.map(function(a){var attrs=a.route?' data-phfc-route="'+esc(a.route)+'"':'';return '<button class="phfc-admin-action '+(a.accent?'is-accent':'')+'" type="button"'+attrs+'><span class="phfc-admin-action-icon" aria-hidden="true">'+a.icon+'</span><span class="phfc-admin-action-copy"><strong>'+esc(a.title)+'</strong><small>'+esc(a.copy)+'</small></span><span class="phfc-admin-action-arrow" aria-hidden="true">›</span></button>';}).join('')+'</div></section>';
  }
  function adminOverview(){
    return adminKpis()+adminQuickActions()+
      '<section class="phfc-admin-bottom-grid"><article class="phfc-card phfc-panel phfc-admin-empty-card"><div class="phfc-panel-head"><h3>Lớp đào tạo</h3><button type="button">Xem tất cả</button></div><div class="phfc-admin-empty-symbol" aria-hidden="true">▦</div><strong>Chưa có lớp đào tạo nào</strong><p>Các lớp được tạo sẽ hiển thị tại đây để Admin theo dõi.</p></article><article class="phfc-card phfc-panel phfc-admin-empty-card"><div class="phfc-panel-head"><h3>Lịch đào tạo</h3><button type="button">Xem lịch đầy đủ</button></div><div class="phfc-admin-empty-symbol" aria-hidden="true">□</div><strong>Chưa có lịch đào tạo</strong><p>Các buổi đào tạo sắp tới sẽ hiển thị tại đây.</p></article><article class="phfc-card phfc-panel phfc-admin-empty-card"><div class="phfc-panel-head"><h3>Công việc cần xử lý</h3><button type="button">Xem tất cả</button></div><div class="phfc-admin-empty-symbol" aria-hidden="true">✓</div><strong>Hiện không có công việc cần xử lý</strong><p>Các nội dung cần Admin theo dõi sẽ xuất hiện tại đây.</p></article></section>';
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
      '/hv/classroom/ket-qua':['Kết quả của tôi','Xem tiến trình và kết quả đào tạo cá nhân.']
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
    return rows.map(function(row){var u=row.user,roles=[];row.assignments.forEach(function(a){var label=phfcAssignmentRoleLabel(a.assignmentRole);if(roles.indexOf(label)<0)roles.push(label);});return '<button type="button" class="phfc-users-row" data-phfc-user-key="'+esc(phfcUserKey(u))+'"><span class="phfc-users-person"><b class="phfc-users-avatar">'+esc((u.fullName||'?').slice(0,1).toUpperCase())+'</b><span><strong>'+esc(u.fullName||u.email||'Nhân sự')+'</strong><small>'+esc((u.employeeCode||'Chưa có mã')+(u.position?' · '+u.position:'')+(u.department?' · '+u.department:''))+'</small><em>'+esc(u.email||u.phone||'')+'</em></span></span><span><b class="phfc-scope-chip is-'+esc(norm(u.defaultProgram))+'">'+esc(phfcUserScopeLabel(u.defaultProgram))+'</b></span><span><strong>'+row.enrollments.length+'</strong><small>'+esc(row.enrollments.length?'lớp':'Chưa tham gia')+'</small></span><span><strong>'+row.assignments.length+'</strong><small>'+esc(roles.slice(0,2).join(', ')||'Chưa phân công')+'</small></span><span><b class="phfc-account-status is-active">Đang hoạt động</b></span><span class="phfc-users-open">Xem hồ sơ →</span></button>';}).join('');
  }
  function phfcUserDetailHtml(row){var u=row.user;var enrolled=row.enrollments.map(function(x){return '<li><span><strong>'+esc(x.className)+'</strong><small>'+esc(x.classCode)+' · '+esc(classStatusLabel(x.status))+'</small></span><b>'+esc(x.required?'Bắt buộc':'Tự nguyện')+'</b></li>';}).join('');var assigned=row.assignments.map(function(x){return '<li><span><strong>'+esc(x.className)+'</strong><small>'+esc(x.classCode)+' · '+esc(classStatusLabel(x.status))+'</small></span><b>'+esc(phfcAssignmentRoleLabel(x.assignmentRole))+'</b></li>';}).join('');return '<div class="phfc-user-detail-head"><div class="phfc-users-person"><b class="phfc-users-avatar is-large">'+esc((u.fullName||'?').slice(0,1).toUpperCase())+'</b><span><small>'+esc(u.employeeCode||'Chưa có mã nhân viên')+'</small><h3>'+esc(u.fullName||u.email||'Nhân sự')+'</h3><p>'+esc([u.position,u.department,u.branch].filter(Boolean).join(' · ')||'Chưa có thông tin đơn vị')+'</p></span></div><button type="button" data-phfc-user-detail-close aria-label="Đóng">×</button></div><div class="phfc-user-detail-meta"><article><span>Email</span><strong>'+esc(u.email||'Chưa có')+'</strong></article><article><span>Số điện thoại</span><strong>'+esc(u.phone||'Chưa có')+'</strong></article><article><span>Phạm vi đào tạo</span><strong>'+esc(phfcUserScopeLabel(u.defaultProgram))+'</strong></article><article><span>Trạng thái tài khoản</span><strong>Đang hoạt động</strong></article></div><div class="phfc-user-detail-grid"><section><h4>Lớp đang tham gia</h4>'+(enrolled?'<ul>'+enrolled+'</ul>':'<p>Chưa được phân công vào lớp nào.</p>')+'</section><section><h4>Vai trò phụ trách</h4>'+(assigned?'<ul>'+assigned+'</ul>':'<p>Chưa được giao vai trò phụ trách lớp.</p>')+'</section></div><div class="phfc-user-detail-foot"><small>Thông tin cá nhân được quản lý tại PHF Training Hub. Classroom chỉ theo dõi liên kết lớp và vai trò đào tạo.</small><button type="button" class="phfc-primary-button" data-phfc-user-detail-close>Đóng</button></div>';
  }

  function phfcDateLabel(value){
    if(!value)return 'Chưa có ngày';
    var d=new Date(String(value).length===10?value+'T00:00:00':value);
    if(Number.isNaN(d.getTime()))return value;
    return d.toLocaleDateString('vi-VN',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'});
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
  function phfcSessionDetailHtml(row){var s=row.session,c=row.classRow,owner=(c.assignments||[]).find(function(x){return norm(x.assignmentRole)==='owner';});return '<div class="phfc-session-detail-head"><div><small>'+esc(c.classCode||'PHF Classroom')+'</small><h3>'+esc(s.sessionName||c.className)+'</h3><p>'+esc(c.className||'')+'</p></div><button type="button" data-phfc-session-detail-close aria-label="Đóng">×</button></div><div class="phfc-session-detail-grid"><article><span>Thời gian</span><strong>'+esc(phfcDateLabel(s.sessionDate))+'</strong><small>'+esc((s.startTime||'—')+' – '+(s.endTime||'—'))+'</small></article><article><span>Hình thức</span><strong>'+esc(deliveryLabel(s.deliveryMode))+'</strong><small>'+esc(s.location||'Chưa cập nhật địa điểm')+'</small></article><article><span>Người phụ trách</span><strong>'+esc((owner&&(owner.employeeName||owner.fullName||owner.employeeCode))||'Theo phân công của lớp')+'</strong></article><article><span>Học viên</span><strong>'+esc(String((c.enrollments||[]).length))+' người</strong></article></div><div class="phfc-session-detail-status"><span class="phfc-schedule-state is-'+esc(row.status.key)+'">'+esc(row.status.label)+'</span></div><div class="phfc-session-detail-actions"><button type="button" class="phfc-secondary-button" data-phfc-session-detail-close>Đóng</button><button type="button" class="phfc-primary-button" data-phfc-session-open-class>Xem lớp</button></div>';
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
      function openDetail(row){var overlay=workspace.querySelector('[data-phfc-session-detail]'),body=workspace.querySelector('[data-phfc-session-detail-body]');body.innerHTML=phfcSessionDetailHtml(row);overlay.hidden=false;document.documentElement.classList.add('phfc-modal-lock');function close(){overlay.hidden=true;document.documentElement.classList.remove('phfc-modal-lock');}body.querySelectorAll('[data-phfc-session-detail-close]').forEach(function(x){x.addEventListener('click',close);});body.querySelector('[data-phfc-session-open-class]').addEventListener('click',function(){close();navigate((role()==='admin'?'/admin':role()==='manager'?'/ql':'/hv')+'/classroom/lop/'+row.classRow.id);});overlay.onclick=function(e){if(e.target===overlay)close();};}
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
        '<div class="phfc-attendance-session-summary" data-phfc-att-summary hidden></div>'+ 
        '<div class="phfc-attendance-bulk" data-phfc-att-bulk hidden>'+ 
          '<label class="phfc-att-select-all"><input type="checkbox" data-phfc-att-select-all><span>Chọn tất cả</span></label>'+ 
          '<div><button type="button" data-phfc-att-bulk-status="present">Có mặt</button><button type="button" data-phfc-att-bulk-status="late">Đi trễ</button><button type="button" data-phfc-att-bulk-status="excused">Có phép</button><button type="button" data-phfc-att-bulk-status="absent">Vắng</button><button type="button" data-phfc-att-bulk-status="unmarked">Xóa trạng thái</button></div>'+ 
        '</div>'+ 
        '<div class="phfc-attendance-table" data-phfc-att-rows><div class="phfc-class-loading">Chọn lớp và buổi học để bắt đầu điểm danh.</div></div>'+ 
        '<div class="phfc-attendance-actions" data-phfc-att-actions hidden><button type="button" class="phfc-primary-button" data-phfc-att-save>Lưu điểm danh</button></div>'+ 
      '</section>'+ 
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
  async function hydrateAttendance(root){
    var workspace=root.querySelector('[data-phfc-attendance-workspace]');if(!workspace)return;var classSelect=workspace.querySelector('[data-phfc-att-class]'),sessionSelect=workspace.querySelector('[data-phfc-att-session]'),holder=workspace.querySelector('[data-phfc-att-rows]'),save=workspace.querySelector('[data-phfc-att-save]'),actions=workspace.querySelector('[data-phfc-att-actions]'),search=workspace.querySelector('[data-phfc-att-search]'),summary=workspace.querySelector('[data-phfc-att-summary]'),bulk=workspace.querySelector('[data-phfc-att-bulk]'),selectAll=workspace.querySelector('[data-phfc-att-select-all]'),currentRows=[],canManage=false,currentSession='',currentClass=null,mode='session',classes=[],users=[];
    try{var result=await Promise.all([loadClassroomClasses(false),phfcLoadClassroomUsers(false)]);classes=result[0];users=result[1];classSelect.innerHTML='<option value="">-- Chọn lớp đào tạo --</option>'+classes.map(function(c){return '<option value="'+esc(c.id)+'">'+esc((c.classCode||'')+' · '+c.className)+'</option>';}).join('');
      function userFor(en){return users.find(function(u){return (en.accountId&&u.accountId===en.accountId)||(en.employeeId&&u.employeeId===en.employeeId);})||{};}
      function counts(){var present=currentRows.filter(function(x){return x.status==='present'||x.status==='late';}).length,abs=currentRows.filter(function(x){return x.status==='absent'||x.status==='excused';}).length,un=currentRows.filter(function(x){return !x.status||x.status==='unmarked';}).length;function set(sel,v){var e=workspace.querySelector(sel);if(e)e.textContent=String(v);}set('[data-phfc-att-total]',currentRows.length);set('[data-phfc-att-present]',present);set('[data-phfc-att-absent]',abs);set('[data-phfc-att-unmarked]',un);}
      function visibleRows(){var q=norm(search.value||'');return currentRows.filter(function(x){return !q||norm([x.fullName,x.employeeCode,x.email,x.department,x.position].join(' ')).indexOf(q)>=0;});}
      function bindRows(){holder.querySelectorAll('[data-phfc-att-row]').forEach(function(el){var row=currentRows.find(function(x){return x.enrollmentId===el.getAttribute('data-enrollment-id');});if(!row)return;el.querySelectorAll('[data-phfc-att-status]').forEach(function(st){st.addEventListener('change',function(){if(st.checked){row.status=st.value;counts();}});});var note=el.querySelector('[data-phfc-att-note]');if(note)note.addEventListener('input',function(){row.note=note.value;});});if(selectAll){selectAll.checked=false;selectAll.indeterminate=false;}counts();}
      function draw(){if(mode==='course'){drawCourseSummary();return;}holder.innerHTML=phfcAttendanceRowsHtml(visibleRows(),canManage);bindRows();}
      function selectedRows(){var ids=Array.from(holder.querySelectorAll('[data-phfc-att-selected]:checked')).map(function(x){return x.closest('[data-phfc-att-row]').getAttribute('data-enrollment-id');});return currentRows.filter(function(x){return ids.indexOf(x.enrollmentId)>=0;});}
      function updateSessionOptions(){currentClass=classes.find(function(c){return c.id===classSelect.value;})||null;var ss=currentClass&&Array.isArray(currentClass.sessions)?currentClass.sessions.slice():[];ss.sort(function(a,b){return String(a.sessionDate+a.startTime).localeCompare(String(b.sessionDate+b.startTime));});sessionSelect.disabled=!currentClass||!ss.length;sessionSelect.innerHTML='<option value="">-- Chọn buổi học --</option>'+ss.map(function(s,i){return '<option value="'+esc(s.id)+'">Buổi '+(i+1)+' · '+esc(s.sessionName||'Buổi học')+' · '+esc(phfcDateLabel(s.sessionDate)+' '+(s.startTime||''))+'</option>';}).join('');currentSession='';currentRows=[];summary.hidden=true;bulk.hidden=true;actions.hidden=true;holder.innerHTML=currentClass?'<div class="phfc-class-loading">Chọn buổi học để bắt đầu điểm danh.</div>':'<div class="phfc-class-loading">Chọn lớp đào tạo để bắt đầu.</div>';counts();}
      async function loadSession(){currentSession=sessionSelect.value;actions.hidden=true;summary.hidden=true;bulk.hidden=true;if(!currentSession){currentRows=[];holder.innerHTML='<div class="phfc-class-loading">Chọn buổi học để bắt đầu điểm danh.</div>';counts();return;}holder.innerHTML='<div class="phfc-class-loading">Đang tải sổ điểm danh…</div>';try{var data=await phfcAttendanceApi(currentSession),cls=data.classroomClass||{},ses=data.session||{},existing=Array.isArray(data.attendance)?data.attendance:[],map=new Map(existing.map(function(x){return [x.enrollmentId,x];}));canManage=Boolean(data.canManage);currentRows=(cls.enrollments||[]).map(function(en){var old=map.get(en.id)||{},u=userFor(en),name=u.name||u.fullName||(u.employee&&u.employee.fullName)||'';return {id:old.id||'',createdAt:old.createdAt||'',enrollmentId:en.id,employeeId:en.employeeId,accountId:en.accountId,status:old.status||'unmarked',note:old.note||'',fullName:name,employeeCode:u.code||u.employeeCode||(u.employee&&u.employee.employeeCode)||'',email:u.email||'',department:u.department||en.departmentSnapshot||'',position:u.position||en.positionSnapshot||''};});summary.hidden=false;summary.innerHTML='<strong>'+esc(cls.className||'Lớp đào tạo')+'</strong><span>'+esc(phfcDateLabel(ses.sessionDate)+' · '+(ses.startTime||'—')+'–'+(ses.endTime||'—')+' · '+(ses.sessionName||'Buổi học'))+'</span><em>'+(canManage?'Có quyền điểm danh':'Chỉ được xem')+'</em>';bulk.hidden=!canManage;actions.hidden=!canManage;draw();}catch(error){holder.innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tải điểm danh</strong><span>'+esc(error.message||String(error))+'</span></div>';}}
      async function drawCourseSummary(){if(!currentClass){holder.innerHTML='<div class="phfc-class-loading">Chọn lớp đào tạo để xem tổng hợp toàn khóa.</div>';return;}var ss=(currentClass.sessions||[]).slice().sort(function(a,b){return String(a.sessionDate+a.startTime).localeCompare(String(b.sessionDate+b.startTime));});if(!ss.length){holder.innerHTML='<div class="phfc-schedule-empty"><strong>Chưa có buổi học</strong><span>Khóa học này chưa được tạo lịch.</span></div>';return;}holder.innerHTML='<div class="phfc-class-loading">Đang tổng hợp điểm danh toàn khóa…</div>';try{var data=await Promise.all(ss.map(function(s){return phfcAttendanceApi(s.id);})),baseEnrollments=currentClass.enrollments||[],rows=baseEnrollments.map(function(en){var u=userFor(en),name=u.name||u.fullName||(u.employee&&u.employee.fullName)||'',row={enrollmentId:en.id,fullName:name,employeeCode:u.code||u.employeeCode||(u.employee&&u.employee.employeeCode)||'',department:u.department||en.departmentSnapshot||'',position:u.position||en.positionSnapshot||'',bySession:{}};data.forEach(function(d,i){var old=(d.attendance||[]).find(function(x){return x.enrollmentId===en.id;});row.bySession[ss[i].id]=old?old.status:'unmarked';});return row;});holder.innerHTML=phfcAttendanceSummaryHtml(rows,ss);}catch(error){holder.innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tổng hợp toàn khóa</strong><span>'+esc(error.message||String(error))+'</span></div>';}}
      classSelect.addEventListener('change',function(){updateSessionOptions();if(mode==='course')drawCourseSummary();});sessionSelect.addEventListener('change',loadSession);search.addEventListener('input',draw);
      workspace.querySelectorAll('[data-phfc-att-mode]').forEach(function(btn){btn.addEventListener('click',function(){mode=btn.getAttribute('data-phfc-att-mode');workspace.querySelectorAll('[data-phfc-att-mode]').forEach(function(x){x.classList.toggle('active',x===btn);});sessionSelect.closest('.phfc-field').hidden=mode==='course';bulk.hidden=mode==='course'||!canManage;actions.hidden=mode==='course'||!canManage;summary.hidden=mode==='course';draw();});});
      if(selectAll)selectAll.addEventListener('change',function(){holder.querySelectorAll('[data-phfc-att-selected]').forEach(function(x){x.checked=selectAll.checked;});});
      workspace.querySelectorAll('[data-phfc-att-bulk-status]').forEach(function(btn){btn.addEventListener('click',function(){var rows=selectedRows();if(!rows.length){phfcNotice('error','Chưa chọn học viên','Hãy tick những học viên cần cập nhật trạng thái.');return;}var status=btn.getAttribute('data-phfc-att-bulk-status');rows.forEach(function(x){x.status=status;});draw();});});
      save.addEventListener('click',async function(){if(!currentSession)return;try{save.disabled=true;save.textContent='Đang lưu…';var data=await phfcSaveAttendance({sessionId:currentSession,attendance:currentRows.map(function(x){return {id:x.id,createdAt:x.createdAt,enrollmentId:x.enrollmentId,employeeId:x.employeeId,accountId:x.accountId,status:x.status,note:x.note};})});phfcNotice('success','Đã lưu điểm danh','Sổ điểm danh của buổi học đã được cập nhật.');var updated=Array.isArray(data.attendance)?data.attendance:[],by=new Map(updated.map(function(x){return [x.enrollmentId,x];}));currentRows.forEach(function(x){var u=by.get(x.enrollmentId);if(u){x.id=u.id;x.createdAt=u.createdAt;x.status=u.status;x.note=u.note;}});draw();}catch(error){phfcNotice('error','Chưa thể lưu điểm danh',error.message||String(error));}finally{save.disabled=false;save.textContent='Lưu điểm danh';}});
    }catch(error){holder.innerHTML='<div class="phfc-user-load-error"><strong>Chưa thể tải danh sách lớp học</strong><span>'+esc(error.message||String(error))+'</span></div>';}
  }

  function pageContent(path){
    path=cleanPath(path);
    if(path==='/admin/classroom')return adminOverview();
    if(path==='/admin/classroom/lop')return classListWorkspace(true);
    if(path==='/admin/classroom/lop/tao-moi')return createClassWorkspace();
    if(path==='/admin/classroom/thong-bao')return phfcNotificationWorkspace();
    if(path==='/admin/classroom/hoc-vien'||path==='/ql/classroom/hoc-vien')return phfcUserWorkspace();
    if(path==='/admin/classroom/lich'||path==='/ql/classroom/lich'||path==='/hv/classroom/lich')return phfcScheduleWorkspace();
    if(path==='/admin/classroom/diem-danh'||path==='/ql/classroom/diem-danh')return phfcAttendanceWorkspace();
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
    function draw(){var q=norm(search&&search.value),rows=people.filter(function(p){return !q||norm([p.name,p.code,p.email,p.phone,p.department,p.position,p.branch].join(' ')).indexOf(q)>=0;});if(count)count.textContent=rows.length+' người phù hợp';list.innerHTML=rows.length?rows.map(function(p){var k=key(p),checked=!!selected[k];return '<label class="phfc-user-picker-row '+(checked?'is-selected':'')+'"><input type="'+(multiple?'checkbox':'radio')+'" name="phfc-user-picker" value="'+esc(k)+'" '+(checked?'checked':'')+'><span class="phfc-user-avatar">'+esc((p.name||'?').slice(0,1).toUpperCase())+'</span><span class="phfc-user-picker-copy"><strong>'+esc(p.name)+'</strong><small>'+esc((p.code||'Chưa có mã')+(p.position?' · '+p.position:'')+(p.department?' · '+p.department:'')+(p.branch?' · '+p.branch:''))+'</small><em>'+esc(p.email||p.phone||'')+'</em></span></label>';}).join(''):'<div class="phfc-user-picker-empty"><strong>Không tìm thấy nhân sự phù hợp</strong><span>Hãy kiểm tra từ khóa hoặc trạng thái tài khoản trong Training Hub.</span></div>';list.querySelectorAll('input').forEach(function(input){input.addEventListener('change',function(){if(!multiple)selected={};if(input.checked)selected[input.value]=true;else delete selected[input.value];draw();});});}
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


  function closeNotificationPanel(){
    var panel=document.getElementById('phfcNotificationPanel');
    if(panel&&panel.__phfcCleanup){try{panel.__phfcCleanup();}catch(e){}}
    if(panel)panel.remove();
    document.querySelectorAll('[data-phfc-notifications][aria-expanded="true"]').forEach(function(x){x.setAttribute('aria-expanded','false');});
  }
  function showNotificationPanel(anchor){
    closeNotificationPanel();
    closeAccountMenu();
    if(!anchor)return;
    var panel=document.createElement('section');
    panel.id='phfcNotificationPanel';
    panel.className='phfc-notification-panel';
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-label','Thông báo Classroom');
    panel.innerHTML='<div class="phfc-notification-head"><div><strong>Thông báo</strong><small>PHF Classroom</small></div><button type="button" data-phfc-notification-close aria-label="Đóng thông báo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div><div class="phfc-notification-empty"><span class="phfc-notification-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg></span><strong>Chưa có thông báo</strong><p>Các thông tin về lớp học, lịch đào tạo và kết quả sẽ hiển thị tại đây.</p></div></section>';
    document.body.appendChild(panel);
    anchor.setAttribute('aria-expanded','true');
    function place(){
      var r=anchor.getBoundingClientRect();
      var width=Math.min(360,Math.max(280,window.innerWidth-24));
      var left=Math.max(12,Math.min(window.innerWidth-width-12,r.right-width));
      var top=Math.min(window.innerHeight-panel.offsetHeight-12,r.bottom+9);
      panel.style.width=width+'px';panel.style.left=left+'px';panel.style.top=Math.max(12,top)+'px';
    }
    place();
    function outside(ev){if(!panel.contains(ev.target)&&!anchor.contains(ev.target))closeNotificationPanel();}
    function onKey(ev){if(ev.key==='Escape'){closeNotificationPanel();anchor.focus();}}
    function onMove(){closeNotificationPanel();}
    setTimeout(function(){document.addEventListener('click',outside,true);},0);
    document.addEventListener('keydown',onKey,true);
    window.addEventListener('resize',onMove,true);
    window.addEventListener('scroll',onMove,true);
    panel.__phfcCleanup=function(){document.removeEventListener('click',outside,true);document.removeEventListener('keydown',onKey,true);window.removeEventListener('resize',onMove,true);window.removeEventListener('scroll',onMove,true);};
    var close=panel.querySelector('[data-phfc-notification-close]');if(close)close.addEventListener('click',function(){closeNotificationPanel();anchor.focus();});
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

  function bindNotificationWorkspace(main){
    var wrap=main.querySelector('[data-phfc-notify-workspace]');if(!wrap)return;
    var recipients=phfcNotificationRecipients();
    var form=wrap.querySelector('[data-phfc-notify-form]');
    var scope=wrap.querySelector('[data-phfc-notify-scope]');
    var picker=wrap.querySelector('[data-phfc-notify-person-picker]');
    var summary=wrap.querySelector('[data-phfc-notify-recipient-summary]');
    var note=wrap.querySelector('[data-phfc-notify-recipient-note]');
    var modal=wrap.querySelector('[data-phfc-notify-modal]');
    var modalBody=wrap.querySelector('[data-phfc-notify-modal-body]');
    var modalCount=wrap.querySelector('[data-phfc-notify-modal-count]');
    var modalSubtitle=wrap.querySelector('[data-phfc-notify-modal-subtitle]');
    function selectedIds(){return Array.from(wrap.querySelectorAll('[data-phfc-notify-person-check]:checked')).map(function(x){return x.value;});}
    function activeRecipients(){
      var value=scope?scope.value:'all';
      if(value==='selected'){var ids=selectedIds();return recipients.filter(function(r){return ids.indexOf(r.id)>=0;});}
      if(value==='branch'){var v=(wrap.querySelector('[data-phfc-notify-branch]')||{}).value||'';return v?recipients.filter(function(r){return r.branch===v;}):[];}
      if(value==='department'){var d=(wrap.querySelector('[data-phfc-notify-department]')||{}).value||'';return d?recipients.filter(function(r){return r.department===d;}):[];}
      if(value==='role'){var ro=(wrap.querySelector('[data-phfc-notify-role]')||{}).value||'';return ro?recipients.filter(function(r){return r.role===ro;}):[];}
      if(value==='class')return [];
      return recipients.slice();
    }
    function scopeLabel(){
      var value=scope?scope.value:'all';
      if(value==='all')return 'Toàn hệ thống (Public)';
      if(value==='class')return 'Theo lớp đào tạo';
      if(value==='branch')return 'Theo chi nhánh';
      if(value==='department')return 'Theo phòng ban';
      if(value==='role')return 'Theo vai trò';
      return 'Nhân sự được chọn';
    }
    function updateRecipients(){
      var value=scope?scope.value:'all';
      wrap.querySelectorAll('[data-phfc-notify-filter]').forEach(function(el){el.hidden=el.getAttribute('data-phfc-notify-filter')!==value;});
      if(picker)picker.hidden=value!=='selected';
      var rows=activeRecipients();
      if(summary)summary.textContent=scopeLabel()+' · '+rows.length+' người';
      if(note){
        note.textContent=value==='all'?'Danh sách sẽ chốt từ các tài khoản đang hoạt động tại thời điểm gửi. Người chưa đăng nhập không nhận dữ liệu.':(value==='class'?'Chưa có dữ liệu lớp thật; người nhận theo lớp sẽ khả dụng sau khi kết nối Classroom.':'Chỉ những tài khoản khớp phạm vi đã chọn mới được chốt vào danh sách người nhận.');
      }
    }
    function renderModal(){
      var rows=activeRecipients();
      if(modalCount)modalCount.textContent=String(rows.length);
      if(modalSubtitle)modalSubtitle.textContent=scopeLabel();
      if(modalBody)modalBody.innerHTML=rows.length?rows.map(function(r){return '<tr><td><strong>'+esc(r.name)+'</strong><small>'+esc(r.email)+'</small></td><td>'+esc(r.code)+'</td><td>'+esc(r.role)+'</td><td>'+esc(r.department)+'<small>'+esc(r.branch)+'</small></td><td><span class="phfc-notify-status is-ready">Dự kiến nhận</span></td></tr>';}).join(''):'<tr><td colspan="5"><div class="phfc-notify-table-empty">Chưa có người nhận phù hợp với phạm vi đã chọn.</div></td></tr>';
    }
    var create=wrap.querySelector('[data-phfc-notify-create]');if(create)create.addEventListener('click',function(){if(form){form.hidden=false;form.scrollIntoView({block:'start',behavior:'smooth'});}});
    var close=wrap.querySelector('[data-phfc-notify-close]');if(close)close.addEventListener('click',function(){if(form)form.hidden=true;});
    if(scope)scope.addEventListener('change',updateRecipients);
    ['[data-phfc-notify-branch]','[data-phfc-notify-department]','[data-phfc-notify-role]'].forEach(function(sel){var el=wrap.querySelector(sel);if(el)el.addEventListener('change',updateRecipients);});
    wrap.querySelectorAll('[data-phfc-notify-person-check]').forEach(function(el){el.addEventListener('change',updateRecipients);});
    var search=wrap.querySelector('[data-phfc-notify-search]');if(search)search.addEventListener('input',function(){var q=String(search.value||'').trim().toLowerCase();wrap.querySelectorAll('[data-phfc-notify-person]').forEach(function(row){row.hidden=!!q&&String(row.getAttribute('data-search')||'').indexOf(q)<0;});});
    var preview=wrap.querySelector('[data-phfc-notify-preview]');if(preview)preview.addEventListener('click',function(){renderModal();if(modal)modal.hidden=false;});
    wrap.querySelectorAll('[data-phfc-notify-modal-close]').forEach(function(el){el.addEventListener('click',function(){if(modal)modal.hidden=true;});});
    function notConnected(){phfcNotice('warning','Chưa kết nối dữ liệu thông báo','Giao diện quản trị và danh sách người nhận đã hoàn thiện. Cần chốt schema/API Classroom trước khi lưu hoặc gửi thật để không phát sinh dữ liệu sai.');}
    var draft=wrap.querySelector('[data-phfc-notify-draft]');if(draft)draft.addEventListener('click',notConnected);
    var send=wrap.querySelector('[data-phfc-notify-send]');if(send)send.addEventListener('click',notConnected);
    updateRecipients();
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
    var actions=canAdmin?'<div class="phfc-detail-actions">'+(c.status==='draft'?'<button class="phfc-secondary-button" type="button" data-phfc-edit-class="'+esc(c.id)+'">Chỉnh sửa</button><button class="phfc-primary-button" type="button" data-phfc-publish-class>Phát hành lớp</button>':'')+'</div>':'';
    var sessions=(c.sessions||[]).map(function(x){return '<article class="phfc-detail-session"><b>'+x.sessionNumber+'</b><div><strong>'+esc(x.sessionName)+'</strong><span>'+esc(x.sessionDate||'Chưa có ngày')+' · '+esc(x.startTime||'—')+'–'+esc(x.endTime||'—')+' · '+esc(deliveryLabel(x.deliveryMode))+'</span><small>'+esc(x.location||'Không có địa điểm')+'</small></div></article>';}).join('');
    var learners=(c.enrollments||[]).map(function(x){return '<li><strong>'+esc(classPersonLabel(x))+'</strong><span>'+esc(x.required?'Bắt buộc':'Tự nguyện')+'</span></li>';}).join('');
    return '<div class="phfc-detail-head"><button class="phfc-back-link" type="button" data-phfc-route="'+(role()==='admin'?'/admin/classroom/lop':role()==='manager'?'/ql/classroom/lop':'/hv/classroom')+'">← Quay lại</button><div><small>'+esc(c.classCode)+'</small><h3>'+esc(c.className)+'</h3><p>'+esc(c.description||'Chưa có mô tả lớp.')+'</p></div><span class="phfc-status-chip is-'+esc(c.status)+'">'+esc(classStatusLabel(c.status))+'</span>'+actions+'</div><section class="phfc-detail-kpis"><article><span>Loại lớp</span><strong>'+esc(classTypeLabel(c.classType))+'</strong></article><article><span>Hình thức</span><strong>'+esc(deliveryLabel(c.deliveryMode))+'</strong></article><article><span>Học viên</span><strong>'+String((c.enrollments||[]).length)+'</strong></article><article><span>Người phụ trách</span><strong>'+esc(owner?classPersonLabel(owner):'Chưa phân công')+'</strong></article></section><div class="phfc-detail-grid"><section class="phfc-card phfc-detail-panel"><h4>Lịch và buổi học</h4>'+(sessions||'<p class="phfc-muted">Chưa có buổi học.</p>')+'</section><section class="phfc-card phfc-detail-panel"><h4>Học viên tham gia</h4>'+(learners?'<ul class="phfc-detail-learners">'+learners+'</ul>':'<p class="phfc-muted">Chưa có học viên.</p>')+'</section></div>';
  }
  async function hydrateClassDetail(root){
    var holder=root.querySelector('[data-phfc-class-detail]');if(!holder)return;var id=holder.getAttribute('data-phfc-class-detail');
    try{var c=await loadClassroomClass(id);if(!document.body.contains(holder))return;holder.innerHTML=classDetailHtml(c);holder.querySelectorAll('[data-phfc-route]').forEach(function(btn){btn.addEventListener('click',function(){navigate(btn.getAttribute('data-phfc-route'));});});var edit=holder.querySelector('[data-phfc-edit-class]');if(edit)edit.addEventListener('click',function(){sessionStorage.setItem('phfcEditClassId',c.id);navigate('/admin/classroom/lop/tao-moi');});var publish=holder.querySelector('[data-phfc-publish-class]');if(publish)publish.addEventListener('click',async function(){try{publish.disabled=true;publish.textContent='Đang phát hành…';c=await saveClassroomClass(c,'publish');phfcNotice('success','Đã phát hành lớp','Học viên được phân công đã có thể nhìn thấy lớp.');holder.innerHTML=classDetailHtml(c);hydrateClassDetail(root);}catch(error){phfcNotice('error','Chưa thể phát hành lớp',error.message||String(error));}finally{publish.disabled=false;}});}catch(error){holder.innerHTML='<div class="phfc-class-error"><strong>Chưa thể tải thông tin lớp</strong><p>'+esc(error.message||String(error))+'</p></div>';}
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
  function hydrateClassroomData(root){hydrateClassList(root);hydrateClassDetail(root);hydrateLearnerClasses(root);hydrateClassroomUsers(root);hydrateSchedule(root);hydrateAttendance(root);phfcEnhanceDateTimeInputs(root);}
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
    var notification=main.querySelector('[data-phfc-notifications]');if(notification)notification.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();var opened=notification.getAttribute('aria-expanded')==='true';if(opened)closeNotificationPanel();else showNotificationPanel(notification);});
    var account=main.querySelector('[data-phfc-account]');if(account)account.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();var opened=account.getAttribute('aria-expanded')==='true';if(opened)closeAccountMenu();else showAccountMenu(account);});
    main.querySelectorAll('[data-phfc-route]').forEach(function(btn){btn.addEventListener('click',function(){setMobileMenu(false);navigate(btn.getAttribute('data-phfc-route'));});});
    bindCreateClass(main);
    bindNotificationWorkspace(main);
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
