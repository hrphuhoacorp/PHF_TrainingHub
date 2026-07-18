(function(){
  'use strict';
  function cleanPath(v){var p=String(v||location.pathname||'/').split('?')[0].split('#')[0].replace(/\/{2,}/g,'/');if(p.length>1)p=p.replace(/\/$/,'');return p||'/';}
  function role(){try{return String((window.phfGetSessionRole&&window.phfGetSessionRole())||'').toLowerCase();}catch(e){return '';}}
  function user(){try{return (window.phfGetAuthenticatedUser&&window.phfGetAuthenticatedUser())||(window.phfGetCurrentUser&&window.phfGetCurrentUser())||null;}catch(e){return null;}}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function routeRole(path){path=cleanPath(path||location.pathname);if(/^\/admin(?:\/|$)/.test(path))return 'admin';if(/^\/ql(?:\/|$)/.test(path))return 'manager';if(/^\/hv(?:\/|$)/.test(path))return 'learner';return role();}
  function hubPath(){var r=role();return r==='admin'?'/admin':(r==='manager'?'/ql':'/hv');}
  function roleLabel(path){var r=routeRole(path);return r==='admin'?'Admin':(r==='manager'?'Quản lý':'Nhân viên');}
  function title(path){var r=routeRole(path);return r==='admin'?'Tổng quan PHF Checklist':(r==='manager'?'Tổng quan Checklist · Quản lý':'Checklist của tôi');}
  function subtitle(path){var r=routeRole(path);return r==='admin'?'Điều hành phân công, ghi nhận tuân thủ và đánh giá công việc trên một khu vực thống nhất.':(r==='manager'?'Theo dõi Checklist trong phạm vi được Admin phân công.':'Theo dõi điểm, lỗi và các việc cần xử lý của bạn.');}
  function currentTime24(){var d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
  function normalizeTime24(value,fallback){var raw=String(value||'').replace(/\D/g,'').slice(0,4);if(raw.length<3)return fallback||currentTime24();var h=Number(raw.slice(0,2)),m=Number(raw.slice(2,4));if(!Number.isInteger(h)||!Number.isInteger(m)||h<0||h>23||m<0||m>59)return fallback||currentTime24();return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');}
  function formatTime24Typing(value){var raw=String(value||'').replace(/\D/g,'').slice(0,4);return raw.length>2?raw.slice(0,2)+':'+raw.slice(2):raw;}
  var ADMIN_VIEW_ROUTES=Object.freeze({
    overview:'/admin/checklist',
    people:'/admin/checklist/nhan-su',
    templates:'/admin/checklist/mau',
    violations:'/admin/checklist/ghi-nhan-loi',
    tasks:'/admin/checklist/viec-can-xu-ly',
    monthly:'/admin/checklist/phieu-danh-gia-thang',
    reports:'/admin/checklist/bao-cao',
    history:'/admin/checklist/lich-su',
    settings:'/admin/checklist/cai-dat'
  });
  var ADMIN_ROUTE_VIEWS=Object.freeze(Object.keys(ADMIN_VIEW_ROUTES).reduce(function(map,key){map[ADMIN_VIEW_ROUTES[key]]=key;return map;},{}));
  function adminViewFromPath(path){return ADMIN_ROUTE_VIEWS[cleanPath(path)]||'overview';}
  function adminRouteForView(view){return ADMIN_VIEW_ROUTES[view]||ADMIN_VIEW_ROUTES.overview;}

  var shellGuardInstalled=false;
  var shellGuardObserver=null;
  function isChecklistPath(){return /^\/(?:admin|ql|hv)\/checklist(?:\/|$)/.test(cleanPath(location.pathname));}
  function enforceChecklistShell(){
    if(!isChecklistPath()) return false;
    var path=cleanPath(location.pathname);
    try{
      if(window.PHFAppShell&&typeof window.PHFAppShell.activateChecklist==='function') window.PHFAppShell.activateChecklist(path);
      else if(window.PHFAppShell&&typeof window.PHFAppShell.syncFromRoute==='function') window.PHFAppShell.syncFromRoute(path,{clear:false,restoreTitle:false});
    }catch(e){}
    var app=document.querySelector('body > .app');
    var root=document.getElementById('phfChecklistRoot');
    if(app){
      if(!app.hidden) app.hidden=true;
      if(app.style.getPropertyValue('display')!=='none'||app.style.getPropertyPriority('display')!=='important') app.style.setProperty('display','none','important');
      if(app.getAttribute('aria-hidden')!=='true') app.setAttribute('aria-hidden','true');
      try{if(app.inert!==true)app.inert=true;}catch(e){}
    }
    if(root){
      if(root.hidden) root.hidden=false;
      if(root.style.getPropertyValue('display')!=='block'||root.style.getPropertyPriority('display')!=='important') root.style.setProperty('display','block','important');
      if(root.getAttribute('aria-hidden')!=='false') root.setAttribute('aria-hidden','false');
      try{if(root.inert!==false)root.inert=false;}catch(e){}
    }
    document.documentElement.classList.add('phf-checklist-route');
    document.body&&document.body.classList.add('phf-checklist-mode');
    return true;
  }
  function installChecklistShellGuard(){
    if(shellGuardInstalled) return;
    shellGuardInstalled=true;
    var app=document.querySelector('body > .app');
    if(window.MutationObserver&&app){
      shellGuardObserver=new MutationObserver(function(){if(!isChecklistPath())return;var root=document.getElementById('phfChecklistRoot');var appNow=document.querySelector('body > .app');var wrong=(appNow&&(!appNow.hidden||appNow.style.getPropertyValue('display')!=='none'))||(root&&(root.hidden||root.style.getPropertyValue('display')==='none'));if(wrong)requestAnimationFrame(enforceChecklistShell);});
      shellGuardObserver.observe(app,{attributes:true,attributeFilter:['style','class','hidden','aria-hidden']});
    }
    ['phf-training-data-ready','popstate','phf-auth-ready','phf-session-ready'].forEach(function(evt){window.addEventListener(evt,function(){if(isChecklistPath()) requestAnimationFrame(enforceChecklistShell);});});
    document.addEventListener('visibilitychange',function(){if(!document.hidden&&isChecklistPath()) enforceChecklistShell();});
  }

  function adminMenu(){
    return [
      ['overview','⌂','Tổng quan','Theo dõi nhanh'],
      ['people','♙','Nhân sự & phân công','Gán mẫu và phạm vi'],
      ['templates','▤','Mẫu Checklist','Quản lý 18 bộ mẫu'],
      ['violations','✓','Ghi nhận lỗi','Lập lỗi và minh chứng'],
      ['tasks','◷','Việc cần xử lý','Xác nhận và giải trình'],
      ['monthly','▦','Phiếu đánh giá tháng','Tự đánh giá và thẩm định'],
      ['reports','▥','Báo cáo','Điểm, lỗi và quá hạn'],
      ['history','↺','Lịch sử thay đổi','Truy vết tác động hệ thống'],
      ['settings','⚙','Cài đặt','Quyền và thời hạn']
    ];
  }
  function adminDashboard(name,path){
    var menu=adminMenu();
    var activeView=adminViewFromPath(path);
    return '<section class="phfck-shell phfck-admin-shell" data-checklist-role="admin">'
      +'<header class="phfck-topbar">'
        +'<div class="phfck-top-left"><button class="phfck-back" type="button" data-phfck-hub aria-label="Quay lại Training Hub">←</button></div><div class="phfck-brand-lockup"><div class="phfck-brand-logo"><span class="phfck-logo-crop"><img src="assets/logo/phf-logo-white-transparent.png" alt="Phuhoa Fresh"></span><strong>PHF Checklist</strong><span>Kiểm soát tuân thủ & đánh giá công việc</span></div></div>'
        +'<div class="phfck-top-actions"><button type="button" class="phfck-icon-btn" aria-label="Thông báo">♢</button><div class="phfck-user"><span>Xin chào,</span><strong>'+esc(name)+'</strong></div></div>'
      +'</header>'
      +'<div class="phfck-layout">'
        +'<aside class="phfck-sidebar">'
          +'<div class="phfck-sidebar-head"><small>KHU VỰC QUẢN TRỊ</small><strong>Điều hành Checklist</strong></div>'
          +'<nav class="phfck-nav" aria-label="Menu PHF Checklist">'+menu.map(function(m){var route=adminRouteForView(m[0]);return '<button type="button" class="'+(m[0]===activeView?'active':'')+'" data-phfck-view="'+m[0]+'" data-phfck-route="'+route+'"><span class="phfck-nav-icon" aria-hidden="true">'+m[1]+'</span><span><b>'+esc(m[2])+'</b><small>'+esc(m[3])+'</small></span></button>';}).join('')+'</nav>'
          +'<div class="phfck-sidebar-foot"><span>Checkpoint</span><strong>1.7.54</strong><small>Import Excel · kiểm lỗi · xem trước</small></div>'
        +'</aside>'
        +'<main class="phfck-main" data-phfck-workspace>'
          +(activeView==='overview'?adminOverviewHtml(name):(activeView==='people'?peopleHtml():(activeView==='templates'?templatesHtml():(activeView==='violations'?violationsHtml():(activeView==='tasks'?tasksHtml():(activeView==='monthly'?monthlyHtml():(activeView==='reports'?reportsHtml():(activeView==='history'?historyHtml():(activeView==='settings'?settingsHtml():placeholderHtml(activeView))))))))))
        +'</main>'
      +'</div>'
    +'</section>';
  }
  function overviewPeriodMeta(){
    var now=new Date();
    var year=now.getFullYear();
    var month=now.getMonth()+1;
    var previousMonth=month-1;
    var previousYear=year;
    if(previousMonth===0){previousMonth=12;previousYear-=1;}
    return {
      current:String(month).padStart(2,'0')+'/'+year,
      previous:String(previousMonth).padStart(2,'0')+'/'+previousYear,
      lockDate:'05/'+String(month).padStart(2,'0')+'/'+year
    };
  }
  function adminOverviewHtml(name){
    var period=overviewPeriodMeta();
    return '<div class="phfck-page-head"><div><small>PHF CHECKLIST · ADMIN</small><h1>Tổng quan</h1><p>Ưu tiên công việc cần xử lý, cảnh báo và tình hình vận hành Checklist trong tháng.</p></div><button class="phfck-primary" type="button" data-phfck-view="violations">＋ Ghi nhận lỗi</button></div>'
      +'<section class="phfck-overview-work" aria-label="Việc cần xử lý">'
        +'<div class="phfck-panel-head"><div><small>ƯU TIÊN HÔM NAY</small><h3>Việc cần xử lý</h3></div><button type="button" class="phfck-overview-link" data-phfck-view="tasks">Xem tất cả →</button></div>'
        +'<div class="phfck-overview-work-grid">'
          +'<button type="button" data-phfck-task-jump="employee"><span class="phfck-overview-icon">✓</span><div><b>Chờ nhân viên xác nhận</b><strong>0</strong><small>Thời hạn xác nhận hoặc giải trình: 3 ngày</small></div></button>'
          +'<button type="button" data-phfck-task-jump="reviewer"><span class="phfck-overview-icon">↩</span><div><b>Giải trình chờ phản hồi</b><strong>0</strong><small>Người ghi lỗi cần phản hồi trong 3 ngày</small></div></button>'
          +'<button type="button" data-phfck-task-jump="admin"><span class="phfck-overview-icon">!</span><div><b>Đã báo Admin</b><strong>0</strong><small>Chờ Admin giữ, điều chỉnh hoặc hủy lỗi</small></div></button>'
          +'<button type="button" data-phfck-task-jump="all"><span class="phfck-overview-icon">◷</span><div><b>Sắp quá hạn / Quá hạn</b><strong>0</strong><small>Chưa có dữ liệu vận hành thực tế</small></div></button>'
        +'</div>'
      +'</section>'
      +'<section class="phfck-overview-alerts phfck-panel">'
        +'<div class="phfck-panel-head"><div><small>CẢNH BÁO CẦN CHÚ Ý</small><h3>Rủi ro và trường hợp cần theo dõi</h3></div><span class="phfck-status phfck-status-muted">Chưa có cảnh báo</span></div>'
        +'<div class="phfck-overview-alert-grid">'
          +'<button type="button" data-phfck-view="reports"><span>01</span><div><b>Điểm Checklist thấp</b><small>Nhân sự có điểm thấp hơn ngưỡng cảnh báo.</small></div><strong>0</strong></button>'
          +'<button type="button" data-phfck-view="reports"><span>02</span><div><b>Lỗi lặp lại trong tháng</b><small>Cùng tiêu chí phát sinh từ lần thứ 2.</small></div><strong>0</strong></button>'
          +'<button type="button" data-phfck-view="reports"><span>03</span><div><b>Đạt ngưỡng gợi ý đào tạo</b><small>3 lần trong 2 tháng liên tiếp.</small></div><strong>0</strong></button>'
          +'<button type="button" data-phfck-view="tasks"><span>04</span><div><b>Thiếu minh chứng bắt buộc</b><small>Vụ việc chưa đủ căn cứ theo cấu hình tiêu chí.</small></div><strong>0</strong></button>'
        +'</div>'
      +'</section>'
      +'<section class="phfck-kpis phfck-overview-kpis" aria-label="Tình hình tháng hiện tại">'
        +'<article><div class="phfck-kpi-icon">!</div><div><span>Lỗi tháng '+period.current+'</span><strong>0</strong><small>Chưa phát sinh dữ liệu thật</small></div></article>'
        +'<article><div class="phfck-kpi-icon">♙</div><div><span>Nhân sự có phát sinh lỗi</span><strong>0</strong><small>Không tính trùng nhân sự</small></div></article>'
        +'<article><div class="phfck-kpi-icon">−</div><div><span>Tổng điểm đã trừ</span><strong>0</strong><small>Lưu cả phần vượt mức điểm 0</small></div></article>'
        +'<article><div class="phfck-kpi-icon">✓</div><div><span>Vụ việc đã hoàn tất</span><strong>0</strong><small>Đang xử lý: 0 · Đã hủy: 0</small></div></article>'
      +'</section>'
      +'<section class="phfck-dashboard-grid phfck-overview-lower">'
        +'<article class="phfck-panel phfck-overview-period"><div class="phfck-panel-head"><div><small>KỲ CHECKLIST</small><h3>Trạng thái khóa dữ liệu tháng</h3></div><span class="phfck-status is-active">Đang mở</span></div>'
          +'<div class="phfck-period-current"><span>Kỳ hiện tại</span><strong>'+period.current+'</strong><small>Đang tiếp nhận ghi nhận lỗi và xử lý vụ việc.</small></div>'
          +'<div class="phfck-period-row"><div><b>Tháng trước: '+period.previous+'</b><small>Được nhập bổ sung đến <strong>23:59 ngày 04</strong>.</small></div><span>24 giờ</span></div>'
          +'<div class="phfck-period-row"><div><b>Thời điểm khóa</b><small>Khóa từ <strong>00:00 ngày '+period.lockDate+'</strong>.</small></div><span>Tự động</span></div>'
          +'<div class="phfck-period-note">Sau khi khóa, Quản lý và Nhân viên không được sửa dữ liệu. Admin chỉ xử lý từng ngoại lệ và bắt buộc lưu lý do.</div>'
        +'</article>'
        +'<article class="phfck-panel phfck-overview-monthly"><div class="phfck-panel-head"><div><small>PHIẾU ĐÁNH GIÁ THÁNG</small><h3>Tiến độ hoàn tất phiếu</h3></div><button type="button" class="phfck-overview-link" data-phfck-view="monthly">Mở phiếu →</button></div>'
          +'<div class="phfck-monthly-mini-grid"><div><span>Chưa tạo</span><strong>0</strong></div><div><span>Đang tự đánh giá</span><strong>0</strong></div><div><span>Chờ thẩm định</span><strong>0</strong></div><div><span>Chờ xác nhận Checklist</span><strong>0</strong></div><div><span>Đã hoàn tất</span><strong>0</strong></div><div><span>Cần xác nhận lại</span><strong>0</strong></div></div>'
          +'<p class="phfck-monthly-mini-note">Điểm Checklist được lấy tự động và khóa sửa trực tiếp trên phiếu tháng.</p>'
        +'</article>'
      +'</section>'
      +'<section class="phfck-panel phfck-quick"><div class="phfck-panel-head"><div><small>THAO TÁC NHANH</small><h3>Đi đến khu vực cần làm</h3></div></div><div class="phfck-quick-grid">'
        +'<button type="button" data-phfck-view="violations"><span>✓</span><b>Ghi nhận lỗi</b><small>Nhập nhanh hoặc ghi nhận chi tiết</small></button>'
        +'<button type="button" data-phfck-view="tasks"><span>◷</span><b>Việc cần xử lý</b><small>Xác nhận, giải trình và phản hồi</small></button>'
        +'<button type="button" data-phfck-view="people"><span>♙</span><b>Phân công nhân sự</b><small>Gán mẫu, hiệu lực và phạm vi</small></button>'
        +'<button type="button" data-phfck-view="templates"><span>▤</span><b>Quản lý mẫu</b><small>18 bộ mẫu và phiên bản tiêu chí</small></button>'
      +'</div></section>'
      +recentChangesHtml();
  }

  var CHECKLIST_TEMPLATE_CATALOG=Object.freeze([
    {id:'nv-ban-hang',name:'Nhân viên bán hàng',group:'Bán hàng',hasChecklist:true,source:'Phiếu tháng + TCCV Nhân viên bán hàng',note:'Giữ riêng bộ tiêu chí công việc hằng ngày theo file nguồn.'},
    {id:'truong-ca-ban-hang',name:'Trưởng ca/Phó ca bán hàng',group:'Bán hàng',hasChecklist:true,source:'Phiếu Ca trưởng + TCCV Ca trưởng/Phó ca',note:'Kế thừa tiêu chí Nhân viên bán hàng và bổ sung nhóm Điều hành ca dùng chung cho Trưởng ca, Phó ca.'},
    {id:'nv-kho',name:'Nhân viên Kho & Sơ chế',group:'Kho',hasChecklist:true,source:'1. NHÂN VIÊN - HẢI + 1.TCCV. HẢI',note:'Giữ đúng tiêu chí, hệ số và trọng số 5% – 65% – 10% – 10% – 10% trong file gốc.'},
    {id:'tbp-kho',name:'Trưởng bộ phận Kho & Sơ chế',group:'Kho',hasChecklist:true,source:'2.TBP NHẬT + 3.TCCV. TBP NHẬT',note:'Kế thừa tiêu chuẩn Nhân viên Kho, bổ sung 9 tiêu chí quản lý và giữ đúng trọng số gốc.'},
    {id:'tro-ly-1-ngoc',name:'Trợ lý Giám đốc 1 – Khối nội bộ',group:'Trợ lý',hasChecklist:true,source:'Troly1_Ngọc.xlsx',note:'Bảng tổng 15 chỉ tiêu; bổ sung nhóm TACPHONG chung toàn công ty.'},
    {id:'tro-ly-2-tien',name:'Trợ lý Giám đốc 2 – Khối vận hành',group:'Trợ lý',hasChecklist:true,source:'Bản sao của Troly2_Tiên.xlsx',note:'Bảng tổng 10 chỉ tiêu; bổ sung nhóm TACPHONG chung toàn công ty.'},
    {id:'tro-ly-3-vinh',name:'Ban Giám sát kiêm Trợ lý Giám đốc',group:'Trợ lý',hasChecklist:true,source:'Troly3_Vinh.xlsx',note:'Bảng tổng 4 chỉ tiêu; mục tiêu kiểm tra tuân thủ chuẩn hóa 100 điểm.'},
    {id:'nv-marketing',name:'Nhân viên Media Marketing',group:'Marketing',hasChecklist:true,source:'NV MKT.xlsx · sheet nv mkt',note:'Bảng tổng 9 chỉ tiêu; các mục tiêu theo tháng được gắn tag Thay đổi theo kế hoạch tháng.'},
    {id:'tbp-marketing',name:'Trưởng bộ phận Marketing',group:'Marketing',hasChecklist:true,source:'TBP MKT.xlsx · sheet tbp',note:'Bảng tổng 11 chỉ tiêu; giữ form riêng và gắn tag cho các mục tiêu thay đổi theo kế hoạch tháng.'},
    {id:'qtth-hcns-thang',name:'QTTH/HCNS – Trưởng bộ phận',group:'HCNS',hasChecklist:true,source:'Phiếu TBP HCNS + sheet TCCV',note:'Tên hiển thị đã bỏ tên cá nhân; tiêu chí không ghi hệ số dùng mặc định 1 điểm/lần.'},
    {id:'qtth-hcns-nhan-vien',name:'QTTH/HCNS – Nhân viên',group:'HCNS',hasChecklist:true,source:'Sao chép cấu trúc chuẩn QTTH/HCNS – Trưởng bộ phận',note:'Dùng cùng cấu trúc Checklist và bảng tổng hiện tại theo yêu cầu vận hành.'},
    {id:'nv-goi-qua',name:'Nhân viên Gói quà',group:'Gói quà',hasChecklist:true,source:'A.NVGQ_ PHÁT + B.TCCV. NVGQ_ PHÁT + C. SLYC',note:'Giữ hệ số theo file nguồn, bổ sung TACPHONG chung toàn công ty.'},
    {id:'tbp-goi-qua',name:'Trưởng bộ phận Gói quà',group:'Gói quà',hasChecklist:true,source:'A.NVGQ_ ÚT HẢI + B.TCCV. NVGQ_ ÚT HẢI + C. SLYC',note:'Kế thừa mẫu Nhân viên Gói quà và bổ sung 4 tiêu chí quản lý nhóm.'},
    {id:'nv-online',name:'Nhân viên CSKH & Check đơn Online',group:'Online',hasChecklist:true,source:'Bộ tiêu chí Dung, Quyên, Vân',note:'Dùng một mẫu chung; ứng xử PHF chuẩn hóa hệ số 10 theo quy tắc toàn công ty.'},
    {id:'ke-toan-tong-hop',name:'Kế toán tổng hợp',group:'Kế toán',hasChecklist:true,source:'Nguồn tham chiếu nội bộ: mẫu Bích',note:'Bảng tổng 10 chỉ tiêu; các công việc theo kỳ được gắn tag Thay đổi theo kế hoạch tháng.'},
    {id:'ke-toan-chi-phi-cnpt',name:'Kế toán viên – Chi phí & Công nợ phải trả',group:'Kế toán',hasChecklist:true,source:'Nguồn tham chiếu nội bộ: mẫu Diễm',note:'Giữ đúng 10 chỉ tiêu và trọng số gốc; mục tiêu ngày tuân thủ thay đổi theo tháng.'},
    {id:'ke-toan-doanh-thu-cnpt',name:'Kế toán viên – Doanh thu & Công nợ phải thu',group:'Kế toán',hasChecklist:true,source:'Nguồn tham chiếu nội bộ: mẫu Linh',note:'Bảng tổng 10 chỉ tiêu, mỗi chỉ tiêu 10%; giữ đúng mục tiêu file gốc.'},
    {id:'ke-toan-truong',name:'Kế toán trưởng',group:'Kế toán',hasChecklist:true,source:'Nguồn tham chiếu nội bộ: mẫu Thanh',note:'Mẫu quản lý riêng; các công việc dự án/kỳ được gắn tag Thay đổi theo kế hoạch tháng.'}
  ]);
  var CHECKLIST_TEMPLATE_OPTIONS=Object.freeze(CHECKLIST_TEMPLATE_CATALOG.map(function(x){return [x.id,x.name+(x.id==='nv-online'?' (chuẩn Quyên)':'')];}));
  var SALES_TEMPLATE_VERSION=Object.freeze({
    templateCode:'BH',version:'BH-1.0',changedDate:'17/07/2026',effectiveFrom:'01/08/2026',changeReason:'Chuẩn hóa mẫu Nhân viên bán hàng từ file nguồn để triển khai trên PHF Checklist.',sourceOwner:'Mẫu gốc: Nhân viên bán hàng – Uyên',scope:'Áp dụng chung toàn hệ thống cho chức danh Bán hàng',evidence:'Khuyến khích',noteRequired:true
  });
  var SALES_TEMPLATE_GROUPS=Object.freeze([
    {code:'VANHANH',name:'Tiêu chuẩn công việc vận hành',children:[
      {code:'KHACHVAO',name:'Bước 1: Khách vào',items:[
        ['BH-KHACHVAO-01','Mở cửa, mỉm cười và cúi chào khi khách bước vào',1],
        ['BH-KHACHVAO-02','Chào rõ ràng, hướng mặt về khách: “Dạ, PhuHoaFresh xin chào”',1]
      ]},
      {code:'KHACHCHON',name:'Bước 2: Khách chọn sản phẩm',items:[
        ['BH-KHACHCHON-01','Chủ động đưa giỏ và thông báo sẵn sàng hỗ trợ khách',1],
        ['BH-KHACHCHON-02','Quan sát khách và hỗ trợ kịp thời khi có nhu cầu',1]
      ]},
      {code:'THANHTOAN',name:'Bước 3: Thanh toán',items:[
        ['BH-THANHTOAN-01','Giới thiệu chương trình khuyến mãi và ưu đãi phù hợp để bán thêm',2],
        ['BH-THANHTOAN-02','Xin đúng thông tin khách hàng để tích điểm',1],
        ['BH-THANHTOAN-03','Nhập đầy đủ, chính xác thông tin đơn hàng',2],
        ['BH-THANHTOAN-04','Xác nhận đúng tiền đơn hàng, tiền nhận và tiền thừa',1],
        ['BH-THANHTOAN-05','Hỏi nhu cầu xuất hóa đơn VAT và ghi nhận đủ thông tin khi có',1],
        ['BH-THANHTOAN-06','Cảm ơn khách và trao bill, hàng hóa bằng hai tay',1]
      ]},
      {code:'KHACHRA',name:'Bước 4: Khách ra về',items:[
        ['BH-KHACHRA-01','Hỗ trợ khách khi hàng hóa nặng hoặc cồng kềnh',1],
        ['BH-KHACHRA-02','Mở cửa, mỉm cười, cúi chào và hẹn gặp lại khách',1]
      ]}
    ]},
    {code:'TRUNGBAY',name:'Tiêu chuẩn công việc trưng bày',children:[
      {code:'TRUNGBAY',name:'Trưng bày và vận hành cửa hàng',items:[
        ['BH-TRUNGBAY-01','Duy trì lượng hàng tối thiểu 50% kệ đối với trái cây và hàng khô',2],
        ['BH-TRUNGBAY-02','Phân loại sản phẩm đúng kệ, đúng giá và đúng loại',1],
        ['BH-TRUNGBAY-03','Sắp xếp hàng đúng chiều, đủ tem phụ, ngay ngắn và quay mặt ra ngoài',1],
        ['BH-TRUNGBAY-04','Chụp hình trưng bày, thay đổi giá, chương trình và khóa cửa đúng thời gian',1],
        ['BH-TRUNGBAY-05','Tắt/mở hệ thống đèn đúng khung giờ quy định',1],
        ['BH-TRUNGBAY-06','Kéo rèm tủ mát đúng thời gian khi không có khách',1],
        ['BH-TRUNGBAY-07','Mở nhạc đúng danh sách và tiêu chuẩn cửa hàng',1]
      ]}
    ]},
    {code:'GOIQUA',name:'Tiêu chuẩn gói quà',children:[
      {code:'GOIQUA',name:'Gói quà',items:[
        ['BH-GOIQUA-01','Tuân thủ tiêu chuẩn giỏ quà về số lượng, chất lượng, thời gian và thẩm mỹ',1]
      ]}
    ]},
    {code:'TONKHO',name:'Kiểm tra tồn kho, chất lượng và hạn sử dụng',children:[
      {code:'TONKHO',name:'Tồn kho, chất lượng và hạn sử dụng',items:[
        ['BH-TONKHO-01','Kiểm tra chất lượng trái cây, rau củ và xử lý hàng giảm chất lượng đúng quy định',2],
        ['BH-TONKHO-02','Không để sản phẩm hết hạn trên kệ; hàng cận hạn phải có giá bán phù hợp',1],
        ['BH-TONKHO-03','Kiểm tra và bảo đảm bao bì hàng hóa đạt yêu cầu',1],
        ['BH-TONKHO-04','Kiểm soát thời gian đóng gói trái cây quấn vỉ và xả hàng sau 3 ngày',1],
        ['BH-TONKHO-05','Kiểm tra tồn kho và lập yêu cầu cấp phát đúng thời gian',2],
        ['BH-TONKHO-06','Báo cáo tồn kho và gửi đủ phiếu sơ chế, đóng gói, xả giỏ cuối ngày',1]
      ]}
    ]},
    {code:'PHOIHOP',name:'Phối hợp các bộ phận',children:[
      {code:'PHOIHOP',name:'Phối hợp công việc',items:[
        ['BH-PHOIHOP-01','Phối hợp Online soạn hàng nhanh, đủ, đúng chất lượng và giao đúng giờ',1],
        ['BH-PHOIHOP-02','Phối hợp Marketing triển khai chương trình tại cửa hàng',1],
        ['BH-PHOIHOP-03','Phối hợp Kế toán xử lý phát sinh, hóa đơn VAT và xuất kho nội bộ',1]
      ]}
    ]},
    {code:'VESINH',name:'Vệ sinh cửa hàng',children:[
      {code:'VESINH',name:'Vệ sinh khu vực và thiết bị',items:[
        ['BH-VESINH-01','Giữ vỉa hè và khu vực xung quanh cửa hàng sạch, gọn và xanh',1],
        ['BH-VESINH-02','Giữ cửa kính sạch, trong và không bị mờ',1],
        ['BH-VESINH-03','Giữ sàn nhà sạch, không rác, không vết bẩn và khô ráo',1],
        ['BH-VESINH-04','Vệ sinh tủ mát, tủ lạnh hằng tuần; không để nấm mốc',1],
        ['BH-VESINH-05','Vệ sinh đá tủ đông định kỳ hai tuần một lần',1],
        ['BH-VESINH-06','Giữ quầy kệ và sản phẩm không bám bụi',1],
        ['BH-VESINH-07','Không để mạng nhện hoặc côn trùng trong khu vực cửa hàng',1],
        ['BH-VESINH-08','Đổ rác đúng giờ quy định của từng chi nhánh',1]
      ]}
    ]},
    {code:'BANGIAO',name:'Bàn giao ca',children:[
      {code:'BANGIAO',name:'Bàn giao và chốt ca',items:[
        ['BH-BANGIAO-01','Bàn giao ca và ghi đủ thông tin vào sổ giao ca',1],
        ['BH-BANGIAO-02','Xử lý hàng hủy, cập nhật hệ thống và chuyển kho đúng thời gian',1],
        ['BH-BANGIAO-03','Bàn giao cho người khác trước khi rời vị trí',1],
        ['BH-BANGIAO-04','Chốt ca đúng; sai lệch dư/thiếu tối đa 50.000 đồng và kiểm tra trong 24 giờ',1]
      ]}
    ]},
    {code:'TACPHONG',name:'Nội quy và tác phong',children:[
      {code:'TACPHONG',name:'Nội quy và tác phong làm việc',items:[
        ['BH-TACPHONG-01','Tuân thủ nội quy và tác phong làm việc theo quy định',1],
        ['BH-TACPHONG-02','Không nói lớn tiếng, chửi thề hoặc tụ tập trong giờ làm',1],
        ['BH-TACPHONG-03','Không sử dụng điện thoại trong giờ làm, trừ nhu cầu công việc',1],
        ['BH-TACPHONG-04','Tuân thủ nguyên tắc ứng xử PHF',10],
        ['BH-DITRE-01','Đi trễ so với giờ vào ca theo lịch',1]
      ]}
    ]}
  ]);
  var SHIFT_LEAD_TEMPLATE_VERSION=Object.freeze({
    templateCode:'TCP-BH',version:'TCP-BH-1.0',changedDate:'17/07/2026',effectiveFrom:'01/08/2026',changeReason:'Chuẩn hóa mẫu dùng chung cho Trưởng ca và Phó ca bán hàng; kế thừa tiêu chí Bán hàng và bổ sung trách nhiệm điều hành ca.',sourceOwner:'Mẫu gốc: 3.A.Ca trưởng_QUỲNH + 3.B.TCCV. Ca trưởng_Quỳnh',scope:'Áp dụng chung cho chức danh Trưởng ca và Phó ca bán hàng',evidence:'Khuyến khích',noteRequired:true
  });
  var SHIFT_LEAD_EXTRA_GROUP=Object.freeze({code:'DIEUHANHCA',name:'Điều hành ca – Trưởng ca/Phó ca',children:[
    {code:'DIEUHANHCA',name:'Trách nhiệm điều hành và quản lý ca',items:[
      ['TCP-DIEUHANH-01','Họp đầu ca, phân chia công việc cho từng người và gửi bảng phân công trong tối đa 24 giờ',2],
      ['TCP-DIEUHANH-02','Giám sát, đánh giá việc hoàn thành công việc của nhân viên trong ngày/ca trong tối đa 24 giờ',2],
      ['TCP-DIEUHANH-03','Chủ động xử lý các sự cố phát sinh với khách hàng',1],
      ['TCP-DIEUHANH-04','Kiểm tra đơn hàng của chi nhánh được phân công trong thời hạn 12–24 giờ',1],
      ['TCP-DIEUHANH-05','Báo cáo doanh thu, chi phí và các số liệu liên quan trong tối đa 2 ngày',2],
      ['TCP-DIEUHANH-06','Đào tạo kỹ năng cho nhân viên theo kế hoạch hằng tuần',1]
    ]}
  ]});
  var SHIFT_LEAD_TEMPLATE_GROUPS=Object.freeze(SALES_TEMPLATE_GROUPS.concat([SHIFT_LEAD_EXTRA_GROUP]));
  var WAREHOUSE_TEMPLATE_VERSION=Object.freeze({
    templateCode:'NVK',version:'NVK-1.0',changedDate:'17/07/2026',effectiveFrom:'01/08/2026',changeReason:'Chuẩn hóa mẫu Nhân viên Kho & Sơ chế từ file nguồn; giữ nguyên trọng số bảng tổng 5% – 65% – 10% – 10% – 10%.',sourceOwner:'Mẫu gốc: 1. NHÂN VIÊN - HẢI + 1.TCCV. HẢI',scope:'Áp dụng cho chức danh Nhân viên Kho & Sơ chế',evidence:'Khuyến khích',noteRequired:true
  });
  var WAREHOUSE_TEMPLATE_GROUPS=Object.freeze([
    {code:'VESINH',name:'Vệ sinh khu vực và dụng cụ',children:[
      {code:'VESINH',name:'Vệ sinh khu vực, dụng cụ và vệ sinh cá nhân',items:[
        ['NVK-VESINH-01','Vệ sinh khu vực làm việc và khu vực lưu trữ: sạch, không nước đọng, không rác thải, không côn trùng',1],
        ['NVK-VESINH-02','Vệ sinh đầy đủ dụng cụ làm việc như dao, kéo, rổ, khay và các dụng cụ liên quan',1],
        ['NVK-VESINH-03','Bảo đảm vệ sinh cá nhân khi thao tác hàng: đeo bao tay, đeo khẩu trang và giữ tay sạch',1],
        ['NVK-VESINH-04','Không đặt hàng hóa trực tiếp dưới sàn; phải kê giấy, pallet, đựng trong rổ hoặc đặt trên bàn',1]
      ]}
    ]},
    {code:'SOCHE',name:'Sơ chế và đóng gói hàng hóa',children:[
      {code:'SOCHE',name:'Sơ chế, đóng gói và ghi nhận',items:[
        ['NVK-SOCHE-01','Phân loại sản phẩm theo chất lượng; loại bỏ hàng hư, thối, cấn nặng và tách rõ hàng sale với hàng bình thường',2],
        ['NVK-SOCHE-02','Đóng gói đúng quy cách: sắp xếp ngay ngắn, mặt đẹp quay lên và đúng trọng lượng tiêu chuẩn',2],
        ['NVK-SOCHE-03','Dán hoặc ghi mã sản phẩm đúng và đầy đủ',1],
        ['NVK-SOCHE-04','Ghi nhận đầy đủ thông tin sơ chế vào sổ theo dõi',1],
        ['NVK-SOCHE-05','Sơ chế kịp thời theo nhu cầu bán hàng, bảo đảm đủ hàng cung ứng cho cửa hàng',1]
      ]}
    ]},
    {code:'NHAPHANG',name:'Kiểm tra tồn kho và nhập hàng',children:[
      {code:'NHAPHANG',name:'Tồn kho, đề nghị mua và tiếp nhận hàng',items:[
        ['NVK-NHAPHANG-01','Kiểm tra tồn kho trái cây, rau củ và lập đề nghị mua khi gần hết: rau củ trước 10 giờ, trái cây trước 15 giờ',1],
        ['NVK-NHAPHANG-02','Kiểm tra tồn kho đồ khô, hải sản, hàng đông lạnh và lập đề nghị mua trước 15 giờ thứ Ba và thứ Sáu khi gần hết',1],
        ['NVK-NHAPHANG-03','Điều phối xe giao hàng của nhà cung cấp kịp thời, không để xe chờ lâu trong hẻm',1],
        ['NVK-NHAPHANG-04','Kiểm tra hàng kịp thời theo thời gian quy định của từng loại hàng, không để nhà cung cấp chờ lâu',2],
        ['NVK-NHAPHANG-05','Hàng nhập phải đủ số lượng, đúng mã, ngoại quan tốt, đủ tem nhãn và hạn sử dụng, đạt tiêu chuẩn chất lượng',2],
        ['NVK-NHAPHANG-06','Hoàn thiện hồ sơ nhập hàng theo quy định, gồm hình ảnh, phiếu và chữ ký',1],
        ['NVK-NHAPHANG-07','Thông báo hàng mới về cho các bộ phận liên quan, gồm nhóm nhập hàng và nhóm kiến thức sản phẩm',1]
      ]}
    ]},
    {code:'CHUYENHANG',name:'Cấp phát và chuyển hàng',children:[
      {code:'CHUYENHANG',name:'Cấp phát, xác nhận và chuyển hàng',items:[
        ['NVK-CHUYENHANG-01','Tuân thủ quy định giữ lạnh và bảo quản hàng hóa trong quá trình cấp phát, chuyển hàng',1],
        ['NVK-CHUYENHANG-02','Cấp phát đúng loại hàng và đúng số lượng yêu cầu',2],
        ['NVK-CHUYENHANG-03','Cấp phát, chuyển hàng đúng giờ và đúng kế hoạch',2],
        ['NVK-CHUYENHANG-04','Xác nhận rõ tình trạng yêu cầu cấp hàng cho chi nhánh: đủ hàng, thiếu hàng, chờ đặt hoặc đã đặt chờ về',1],
        ['NVK-CHUYENHANG-05','Tạo và duyệt phiếu chuyển hàng kịp thời trên hệ thống',1]
      ]}
    ]},
    {code:'LUUKHO',name:'Lưu kho và bảo quản',children:[
      {code:'LUUKHO',name:'Nhiệt độ, chất lượng và sắp xếp kho',items:[
        ['NVK-LUUKHO-01','Kiểm soát nhiệt độ bảo quản: kho lạnh từ 1–8°C, tủ đông dưới -20°C',1],
        ['NVK-LUUKHO-02','Kiểm soát chất lượng hàng hóa: không ẩm mốc, bao bì nguyên vẹn và không có dấu hiệu côn trùng',1],
        ['NVK-LUUKHO-03','Sắp xếp hàng theo FIFO đối với hàng tươi sống và FEFO đối với hàng có hạn sử dụng',1],
        ['NVK-LUUKHO-04','Phân khu hàng hóa rõ ràng và sắp xếp gọn gàng',1]
      ]}
    ]},
    {code:'TACPHONG',name:'Nội quy và tác phong',children:[
      {code:'TACPHONG',name:'Nội quy, văn hóa ứng xử và phối hợp',items:[
        ['PHF-TACPHONG-UNGXU-01','Đảm bảo tuân thủ nguyên tắc ứng xử PHF',10],
        ['PHF-TACPHONG-NOIQ-01','Đảm bảo nội quy và tác phong khi làm việc',2],
        ['NVK-PHOIHOP-01','Hỗ trợ bộ phận khác khi có yêu cầu',2],
        ['PHF-DITRE-01','Đi trễ so với giờ vào ca theo lịch',1]
      ]}
    ]}
  ]);

  var WAREHOUSE_MANAGER_TEMPLATE_VERSION=Object.freeze({
    templateCode:'TBP-KHO',version:'TBP-KHO-1.0',changedDate:'17/07/2026',effectiveFrom:'01/08/2026',changeReason:'Chuẩn hóa mẫu Trưởng bộ phận Kho & Sơ chế từ file nguồn; kế thừa tiêu chuẩn Nhân viên Kho và bổ sung trách nhiệm quản lý bộ phận.',sourceOwner:'Mẫu gốc: 2.TBP NHẬT + 3.TCCV. TBP NHẬT',scope:'Áp dụng cho chức danh Trưởng bộ phận Kho & Sơ chế',evidence:'Khuyến khích',noteRequired:true
  });
  var WAREHOUSE_MANAGER_EXTRA_GROUP=Object.freeze({code:'QUANLYKHO',name:'Quản lý và điều hành bộ phận Kho',children:[
    {code:'QUANLYKHO',name:'Trách nhiệm quản lý, kiểm soát và điều hành Kho',items:[
      ['TBPK-DIEUPHOI-01','Điều phối thời gian nhập hàng và chuyển hàng hợp lý, đúng kế hoạch',1],
      ['TBPK-PHANCONG-01','Phân công công việc rõ ràng, phù hợp với nhân sự và khối lượng thực tế',1],
      ['TBPK-GIAMSAT-01','Giám sát và đánh giá việc hoàn thành công việc của nhân viên trong bộ phận',2],
      ['TBPK-SUCO-01','Phát hiện và xử lý kịp thời các sự cố phát sinh trong hoạt động Kho',1],
      ['TBPK-NHAPHANG-01','Đánh giá và quyết định phương án nhập hàng khi phát sinh lỗi hoặc hao hụt',1],
      ['TBPK-HUYHANG-01','Kiểm tra thực tế và duyệt phiếu hủy hàng đúng quy định',1],
      ['TBPK-TONKHO-01','Theo dõi hàng tồn nhiều, tồn lâu và chủ động đề xuất phương án xử lý',1],
      ['TBPK-KIEMKE-01','Lập kế hoạch kiểm kê và kiểm soát tỷ lệ hao hụt của bộ phận Kho',2],
      ['TBPK-DULIEU-01','Đảm bảo dữ liệu Kho được cập nhật lên phần mềm kế toán đầy đủ và kịp thời',1]
    ]}
  ]});
  var WAREHOUSE_MANAGER_TEMPLATE_GROUPS=Object.freeze(WAREHOUSE_TEMPLATE_GROUPS.concat([WAREHOUSE_MANAGER_EXTRA_GROUP]));
  var ASSISTANT_COMMON_GROUPS=Object.freeze([
    {code:'TACPHONG',name:'Nội quy và tác phong',children:[
      {code:'TACPHONG',name:'Nội quy và tác phong chung toàn công ty',items:[
        ['PHF-TACPHONG-UNGXU-01','Đảm bảo tuân thủ nguyên tắc ứng xử PHF',10],
        ['PHF-TACPHONG-NOIQ-01','Đảm bảo nội quy và tác phong khi làm việc',2],
        ['PHF-DITRE-01','Đi trễ so với giờ vào ca theo lịch',1]
      ]}
    ]}
  ]);
  var HCNS_TEMPLATE_GROUPS=Object.freeze([
    {code:'LUONG-BHXH-THUE',name:'Lương, BHXH và thuế',children:[
      {code:'LUONG-BHXH-THUE',name:'Kiểm soát lương, bảo hiểm và nghĩa vụ thuế',items:[
        ['HCNS-LUONG-01','Đảm bảo tính lương chính xác; tỷ lệ sai lương dưới 3%',1],
        ['HCNS-BHXH-01','Kiểm soát tăng, giảm và chế độ BHXH chính xác, đúng thời hạn',1],
        ['HCNS-THUE-01','Đảm bảo hạch toán BHXH và thuế TNCN đầy đủ, đúng quy định',1]
      ]}
    ]},
    {code:'TUYENDUNG',name:'Tuyển dụng và chất lượng nhân sự',children:[
      {code:'TUYENDUNG',name:'Tuyển dụng và kiểm soát chất lượng đội ngũ',items:[
        ['HCNS-TUYENDUNG-01','Đảm bảo kế hoạch tuyển dụng theo yêu cầu của Ban Giám đốc',1],
        ['HCNS-CHATLUONG-01','Kiểm soát chất lượng công việc của nhân viên HCNS',1]
      ]}
    ]},
    {code:'DAOTAO-CAITIEN',name:'Đào tạo và cải tiến',children:[
      {code:'DAOTAO-CAITIEN',name:'Cải tiến hoạt động và tổ chức đào tạo lại',items:[
        ['HCNS-CAITIEN-01','Cải tiến chất lượng nhân sự và hoạt động khối văn phòng – vận hành',1],
        ['HCNS-DAOTAO-01','Đề xuất và tổ chức tái đào tạo theo nhu cầu thực tế',1]
      ]}
    ]},
    {code:'QUANLYCONGVIEC',name:'Quản lý thực hiện công việc',children:[
      {code:'QUANLYCONGVIEC',name:'Theo dõi việc thực hiện công việc của bộ phận',items:[
        ['HCNS-TASKLIST-01','Đảm bảo nhân viên HCNS tuân thủ task list và hoàn thành công việc đúng hạn',1]
      ]}
    ]},
    {code:'TACPHONG',name:'Nội quy và tác phong',children:[
      {code:'TACPHONG',name:'Nội quy và tác phong chung toàn công ty',items:[
        ['PHF-TACPHONG-UNGXU-01','Đảm bảo tuân thủ nguyên tắc ứng xử PHF',10],
        ['PHF-TACPHONG-NOIQ-01','Đảm bảo nội quy và tác phong khi làm việc',2],
        ['PHF-DITRE-01','Đi trễ so với giờ vào ca theo lịch',1]
      ]}
    ]}
  ]);
  var GIFT_WRAP_TEMPLATE_GROUPS=Object.freeze([
    {code:'KỸTHUẬT-GQ',name:'Kỹ thuật và chất lượng gói quà',children:[
      {code:'KỸTHUẬT-GQ',name:'Tiêu chuẩn kỹ thuật gói quà',items:[
        ['GQ-KYTHUAT-01','Ghi đúng và đủ tag giá, mã, ngày giờ, người gói; dán tem đúng vị trí quy định',2],
        ['GQ-KYTHUAT-02','Gói giỏ ngay ngắn, chắc chắn, đúng mẫu; hoa lá, phụ kiện và hướng sản phẩm đạt thẩm mỹ',2],
        ['GQ-KYTHUAT-03','Sản phẩm dùng để gói bảo đảm chất lượng, không dập hư và hình dạng cân đối',2],
        ['GQ-KYTHUAT-04','Gói đúng thành phần giỏ đã khai báo trong hệ thống',2],
        ['GQ-KYTHUAT-05','Hoàn thành gói trong thời gian quy định theo loại giỏ và giá trị sản phẩm',2]
      ]}
    ]},
    {code:'HANGNGAY-GQ',name:'Trưng bày và công việc hằng ngày',children:[
      {code:'HANGNGAY-GQ',name:'Kiểm soát giỏ quà, hoa lá và vật tư hằng ngày',items:[
        ['GQ-HANGNGAY-01','Kiểm tra thời gian trưng bày giỏ quà; xả giỏ đúng hạn hoặc khi hoa lá giảm chất lượng',2],
        ['GQ-HANGNGAY-02','Ghi đầy đủ bảng theo dõi số lượng gói và xả giỏ',2],
        ['GQ-HANGNGAY-03','Duy trì đủ số lượng giỏ trái cây theo tiêu chuẩn từng chi nhánh, ngày và khoảng giá',2],
        ['GQ-HANGNGAY-04','Duy trì đủ số lượng giỏ bánh kẹo, giỏ sức khỏe và giỏ em bé theo chi nhánh',2],
        ['GQ-HANGNGAY-05','Chụp hình tủ và kệ trưng bày giỏ quà gửi nhóm trong khung 06:30–07:30',2],
        ['GQ-HANGNGAY-06','Phun nước định kỳ cho giỏ hoa để hoa luôn tươi, không khô héo',2],
        ['GQ-HANGNGAY-07','Kiểm tra và xử lý hoa trưng bày trong cửa hàng trước 08:00',2],
        ['GQ-HANGNGAY-08','Theo dõi phụ kiện trang trí và đề nghị cấp phát/mua hàng đúng thời hạn',2],
        ['GQ-HANGNGAY-09','Chuẩn bị sẵn giấy lót giỏ, mút xốp và nơ trong thời gian trống',2],
        ['GQ-HANGNGAY-10','Nhận, kiểm tra hoa lá mới nhập và ghi phiếu nhập kho đầy đủ',2]
      ]}
    ]},
    {code:'PHOIHOP-GQ',name:'Phối hợp phục vụ khách hàng',children:[
      {code:'PHOIHOP-GQ',name:'Tư vấn và phối hợp trong giờ cao điểm',items:[
        ['GQ-PHOIHOP-01','Hỗ trợ tư vấn giỏ quà cho khách và phối hợp bộ phận Bán hàng để phục vụ nhanh, hiệu quả',2]
      ]}
    ]},
    {code:'BAOQUAN-GQ',name:'Bảo quản hàng hóa, dụng cụ và vệ sinh',children:[
      {code:'BAOQUAN-GQ',name:'Bảo quản sản phẩm và dụng cụ',items:[
        ['GQ-BAOQUAN-01','Loại bỏ trái cây dập trong quá trình chọn lọc và bàn giao đúng bộ phận xử lý',2],
        ['GQ-BAOQUAN-02','Không để trái cây dập bừa bộn tại khu vực gói quà hoặc kho lạnh',2],
        ['GQ-BAOQUAN-03','Chỉ lấy lượng trái cây vừa đủ ra ngoài để gói, tránh mất lạnh và giảm chất lượng',2],
        ['GQ-BAOQUAN-04','Không để trái cây dư ngoài khu vực gói quá thời gian cho phép theo từng loại',2],
        ['GQ-BAOQUAN-05','Giữ gìn và bảo quản dụng cụ gói quà',2],
        ['GQ-BAOQUAN-06','Sắp xếp phụ kiện gọn gàng, đúng vị trí sau khi sử dụng',2],
        ['GQ-BAOQUAN-07','Vệ sinh khu vực đóng gói gọn gàng, sạch sẽ',2],
        ['GQ-BAOQUAN-08','Tổng vệ sinh cuối ca, cất dụng cụ và đổ rác đầy đủ',2],
        ['GQ-BAOQUAN-09','Vệ sinh, sắp xếp kho lạnh; đậy kín thùng hàng và thu gom hoa lá rơi vãi',2]
      ]}
    ]},
    {code:'BANGIAO-GQ',name:'Bàn giao ca',children:[
      {code:'BANGIAO-GQ',name:'Bàn giao công việc và đơn hàng',items:[
        ['GQ-BANGIAO-01','Bàn giao đầy đủ giỏ cần gói, thông tin đơn hàng, mẫu chưa làm, việc dang dở và vấn đề phát sinh',2]
      ]}
    ]},
    {code:'TACPHONG',name:'Nội quy và tác phong',children:[
      {code:'TACPHONG',name:'Nội quy và tác phong chung toàn công ty',items:[
        ['PHF-TACPHONG-UNGXU-01','Đảm bảo tuân thủ nguyên tắc ứng xử PHF',10],
        ['PHF-TACPHONG-NOIQ-01','Đảm bảo tác phong khi làm việc: tóc, móng tay, nét mặt, tư thế và đồng phục',2],
        ['PHF-TACPHONG-DIENTHOAI-01','Không sử dụng điện thoại trong giờ làm, trừ mục đích công việc',2],
        ['PHF-DITRE-01','Đi trễ so với giờ vào ca theo lịch',1]
      ]}
    ]}
  ]);
  var GIFT_WRAP_MANAGER_TEMPLATE_GROUPS=Object.freeze(GIFT_WRAP_TEMPLATE_GROUPS.concat([
    {code:'QUANLY-GQ',name:'Quản lý và điều hành Gói quà',children:[
      {code:'QUANLY-GQ',name:'Trách nhiệm của Trưởng bộ phận Gói quà',items:[
        ['GQ-QUANLY-01','Phân công ca hợp lý và rõ trách nhiệm',2],
        ['GQ-QUANLY-02','Giám sát và đánh giá hiệu suất nhân viên',2],
        ['GQ-QUANLY-03','Xử lý các sự cố phát sinh trong quá trình gói',2],
        ['GQ-QUANLY-04','Phối hợp Marketing phân công lên mẫu giỏ theo yêu cầu',2]
      ]}
    ]}
  ]));

  var ONLINE_TEMPLATE_GROUPS=Object.freeze([
    {code:'TIEPNHAN-DON',name:'Tiếp nhận và xử lý đơn',children:[{code:'TIEPNHAN-DON',name:'Tiếp nhận, chuẩn bị và theo dõi đơn hàng',items:[
      ['ONLINE-TIEPNHAN-01','Phản hồi tin nhắn và điện thoại khách trong 15 phút; không để sót đơn',2],
      ['ONLINE-PHANHOI-01','Tiếp nhận, xử lý phản hồi của khách và báo cáo đúng người phụ trách',2],
      ['ONLINE-SOANHANG-01','Chuẩn bị đúng, đủ sản phẩm và bảo đảm chất lượng trước khi giao',2],
      ['ONLINE-KHUYENMAI-01','Giới thiệu đúng chương trình khuyến mãi, ưu đãi đang áp dụng',1],
      ['ONLINE-GIAOHANG-01','Theo dõi giao hàng đúng giờ và cập nhật đầy đủ trạng thái đơn',2],
      ['ONLINE-GIAOTIEP-01','Giao tiếp lịch sự, rõ ràng và đúng chuẩn phục vụ khách hàng',2],
      ['ONLINE-DONCU-01','Kiểm tra đơn hàng cũ và xử lý các nội dung còn tồn đọng',1]
    ]}]},
    {code:'VESINH-ONLINE',name:'Vệ sinh khu vực làm việc',children:[{code:'VESINH-ONLINE',name:'Vệ sinh và sắp xếp khu vực Online',items:[
      ['ONLINE-VESINH-01','Giữ khu vực làm việc, thiết bị và dụng cụ sạch sẽ, gọn gàng',1]
    ]}]},
    {code:'PHOIHOP-ONLINE',name:'Phối hợp nội bộ và bàn giao đơn',children:[{code:'PHOIHOP-ONLINE',name:'Phối hợp Kho, Cửa hàng, Gói quà và bàn giao ca',items:[
      ['ONLINE-PHOIHOP-KHO-01','Báo đầy đủ thông tin đơn cho Kho để chuẩn bị hàng đúng thời gian',2],
      ['ONLINE-PHOIHOP-CH-01','Phối hợp Cửa hàng xử lý đơn, hàng thiếu và phát sinh với khách',2],
      ['ONLINE-PHOIHOP-GQ-01','Báo đầy đủ yêu cầu mẫu, giá và thời gian cho bộ phận Gói quà',2],
      ['ONLINE-BANGIAO-01','Bàn giao đầy đủ đơn chưa hoàn tất, phản hồi khách và vấn đề phát sinh cho ca sau',2],
      ['ONLINE-BAOCAO-01','Báo cáo công việc đúng nội dung, thời gian và biểu mẫu quy định',1]
    ]}]},
    {code:'TACPHONG',name:'Nội quy và tác phong',children:[{code:'TACPHONG',name:'Nội quy và tác phong chung toàn công ty',items:[
      ['PHF-TACPHONG-UNGXU-01','Đảm bảo tuân thủ nguyên tắc ứng xử PHF',10],
      ['PHF-TACPHONG-NOIQ-01','Đảm bảo nội quy và tác phong khi làm việc',2],
      ['PHF-DITRE-01','Đi trễ so với giờ vào ca theo lịch',1]
    ]}]}
  ]);
  function accountingGroups(prefix, sections){
    var groups=(sections||[]).map(function(section,gi){return {code:prefix+'-'+section[0],name:section[1],children:[{code:prefix+'-'+section[0],name:section[1],items:(section[2]||[]).map(function(label,ii){return [prefix+'-'+section[0]+'-'+String(ii+1).padStart(2,'0'),label,1];})}]};});
    return Object.freeze(groups.concat(ASSISTANT_COMMON_GROUPS));
  }
  var ACCOUNTING_GENERAL_GROUPS=accountingGroups('KTTH',[
    ['DULIEU','Chuyển đổi và rà soát dữ liệu kế toán',['Chuyển đổi, kiểm tra và đối chiếu dữ liệu kế toán đúng kỳ','Rà soát sai lệch dữ liệu và phối hợp xử lý dứt điểm']],
    ['HOADON-RA','Quản lý hóa đơn đầu ra',['Kiểm tra việc xuất hóa đơn đầu ra đầy đủ và đúng quy định']],
    ['DOANHTHU','Báo cáo doanh thu',['Tổng hợp và đối chiếu báo cáo doanh thu đúng hạn']],
    ['HOADON-VAO','Quản lý hóa đơn đầu vào',['Kiểm tra tính hợp lệ, đầy đủ của hóa đơn đầu vào']],
    ['CHIPHI','Kiểm tra chi phí',['Rà soát chứng từ và tính hợp lý của chi phí']],
    ['SAILECH','Phối hợp xử lý sai lệch',['Phối hợp các vị trí kế toán xử lý sai lệch số liệu']],
    ['THUE','Công tác kế toán thuế',['Chuẩn bị số liệu, hồ sơ phục vụ kê khai và quyết toán thuế']],
    ['KHAC','Công việc khác',['Thực hiện công việc phát sinh theo phân công và đúng thời hạn']]
  ]);
  var ACCOUNTING_PAYABLE_GROUPS=accountingGroups('KTCP',[
    ['THANHTOAN','Xử lý nghiệp vụ thanh toán',['Kiểm tra hồ sơ và thực hiện nghiệp vụ thanh toán đúng quy trình']],
    ['HACHTOAN','Hạch toán chi phí kế toán',['Hạch toán chi phí đầy đủ, đúng tài khoản và đúng kỳ']],
    ['CNPT','Quản lý công nợ phải trả',['Đối chiếu, theo dõi và báo cáo công nợ phải trả']],
    ['HOADON','Quản lý hóa đơn đầu vào',['Tiếp nhận, kiểm tra và lưu trữ hóa đơn đầu vào']],
    ['KHO','Kế toán kho',['Đối chiếu nghiệp vụ kho và xử lý chênh lệch']],
    ['KIEMSOAT','Kiểm soát chi phí',['Kiểm tra tính hợp lệ, hợp lý và đúng ngân sách của chi phí']],
    ['KHAC','Công việc khác',['Hoàn thành công việc khác và công việc cấp trên giao']]
  ]);
  var ACCOUNTING_RECEIVABLE_GROUPS=accountingGroups('KTDT',[
    ['DONGTIEN','Theo dõi dòng tiền bán hàng',['Theo dõi đầy đủ tiền bán hàng qua ngân hàng, tiền mặt và MPOS']],
    ['HOADON','Xuất và xử lý hóa đơn GTGT',['Kiểm tra đơn Sapo, xuất hóa đơn và xử lý hóa đơn lỗi/điều chỉnh']],
    ['CNTHU','Quản lý công nợ phải thu',['Theo dõi hoàn tiền khách và công nợ phải thu']],
    ['KHO','Theo dõi kho kế toán',['Đối chiếu số liệu kho liên quan đến doanh thu']],
    ['BAOCAO','Báo cáo doanh thu và dòng tiền',['Cập nhật báo cáo doanh thu, số dư tài khoản và dòng tiền đúng hạn']],
    ['KHAC','Công việc khác',['Hoàn thành công việc khác theo phân công']]
  ]);
  var CHIEF_ACCOUNTANT_GROUPS=accountingGroups('KTT',[
    ['THUCHI','Quản lý và phê duyệt nghiệp vụ thu – chi',['Kiểm tra, phê duyệt nghiệp vụ thu – chi đúng thẩm quyền']],
    ['DOANHTHU-CHIPHI','Kiểm tra doanh thu và chi phí',['Rà soát doanh thu, chi phí và các chênh lệch trọng yếu']],
    ['DONGTIEN','Kiểm soát dòng tiền',['Theo dõi, dự báo và kiểm soát dòng tiền']],
    ['BAOCAO','Báo cáo quản trị và tài chính',['Lập, rà soát báo cáo quản trị, tài chính nội bộ và báo cáo dòng tiền']],
    ['HOADON-THUE','Hóa đơn và báo cáo thuế',['Kiểm soát hóa đơn GTGT; chuẩn bị, kiểm tra báo cáo thuế']],
    ['QUANLY','Quản lý đội ngũ kế toán',['Hướng dẫn, kiểm tra và đào tạo nhân viên kế toán']],
    ['PHOIHOP','Phối hợp và công việc cấp trên',['Phối hợp các bộ phận và hoàn thành công việc cấp trên giao']]
  ]);

  var ASSISTANT_TEMPLATE_CONFIGS=Object.freeze({
    'nv-online':{
      title:'Nhân viên CSKH & Check đơn Online',groupLabel:'CSKH & Online',code:'NV-CHECKDON',version:'NV-CHECKDON-1.0',policy:'NV-CHECKDON-TỔNG-1.0',source:'Bộ tiêu chí Dung, Quyên và Vân',scope:'Áp dụng chung cho Nhân viên CSKH & Check đơn Online',
      reason:'Chuẩn hóa ba mẫu cá nhân thành một mẫu chức danh chung; giữ nguyên bảng tổng, chuẩn hóa ứng xử PHF hệ số 10 và bổ sung Đi trễ từ thư viện chung.',groups:ONLINE_TEMPLATE_GROUPS,
      rules:['Dùng một mẫu chung cho nhân sự CSKH & Check đơn Online; không tạo mẫu theo tên cá nhân.','Ứng xử PHF luôn hệ số 10 theo quy tắc toàn công ty.','Dòng Tuân thủ Checklist công việc luôn có mục tiêu 100 điểm.','Bảng tổng giữ đúng trọng số gốc 5% – 5% – 15% – 5% – 60% – 10%.','Công thức chung: Thực đạt ×1, Thẩm định ×2, chia 3; sau đó quy đổi theo trọng số.'],
      rows:[['Lập phiếu đánh giá công việc tháng',2,5,null,'phiếu'],['Thu thập và phân tích thông tin khách hàng',10,5],['Gửi chúc mừng sinh nhật khách hàng',10,15],['Chào chương trình dành cho khách VIP',200,5],['Tuân thủ Checklist công việc',100,60,null,'điểm'],['Công việc cấp trên giao',10,10,null,'điểm']]
    },
    'ke-toan-tong-hop':{
      title:'Kế toán tổng hợp',groupLabel:'Kế toán',code:'KT-TH',version:'KT-TH-1.0',policy:'KT-TH-TỔNG-1.0',source:'Nguồn tham chiếu nội bộ: mẫu Bích',scope:'Áp dụng cho chức danh Kế toán tổng hợp',
      reason:'Chuẩn hóa bảng tổng và nhóm công việc Kế toán tổng hợp; giữ tổng trọng số 100%, các hạng mục theo kỳ được quản lý theo tháng.',groups:ACCOUNTING_GENERAL_GROUPS,
      rules:['Tiêu chí chi tiết chưa có hệ số dùng mặc định hệ số 1.','Các hạng mục dự án hoặc xử lý tồn đọng được gắn tag Thay đổi theo kế hoạch tháng.','Nhóm TACPHONG chung toàn công ty gồm ứng xử PHF hệ số 10 và Đi trễ.','Bảng tổng giữ 10 chỉ tiêu, mỗi chỉ tiêu 10%.'],
      rows:[['Lập phiếu và đánh giá công việc tháng',2,10],['Chuyển đổi và rà soát dữ liệu kế toán',10,10,'monthly'],['Quản lý hóa đơn đầu ra',10,10],['Báo cáo doanh thu',10,10],['Quản lý hóa đơn đầu vào',10,10],['Kiểm tra chi phí',10,10],['Phối hợp xử lý sai lệch',10,10],['Công tác kế toán thuế',10,10],['Công việc theo kế hoạch tháng',10,10,'monthly'],['Công việc cấp trên giao',10,10]]
    },
    'ke-toan-chi-phi-cnpt':{
      title:'Kế toán viên – Chi phí & Công nợ phải trả',groupLabel:'Kế toán',code:'KT-CP-CNPT',version:'KT-CP-CNPT-1.0',policy:'KT-CP-CNPT-TỔNG-1.0',source:'Nguồn tham chiếu nội bộ: mẫu Diễm',scope:'Áp dụng cho Kế toán viên phụ trách Chi phí & Công nợ phải trả',
      reason:'Chuẩn hóa bảng tổng và nhóm nghiệp vụ chi phí, công nợ phải trả; giữ đúng trọng số gốc 100%.',groups:ACCOUNTING_PAYABLE_GROUPS,
      rules:['Tiêu chí chi tiết chưa có hệ số dùng mặc định hệ số 1.','Mục tiêu Nội quy và văn hóa PHF được hiểu là số ngày tuân thủ trên số ngày làm việc thực tế và thay đổi theo tháng.','Nhóm TACPHONG chung toàn công ty gồm ứng xử PHF hệ số 10 và Đi trễ.','Công thức chung: Thực đạt ×1, Thẩm định ×2, chia 3.'],
      rows:[['Lập phiếu đánh giá công việc tháng',2,5],['Xử lý nghiệp vụ thanh toán',10,15],['Hạch toán chi phí kế toán',10,20],['Quản lý công nợ phải trả',10,10],['Quản lý hóa đơn đầu vào',10,5],['Kế toán kho',10,5],['Kiểm soát chi phí',10,25],['Công việc khác',10,5],['Công việc cấp trên giao',10,5],['Nội quy và văn hóa PHF',26,5,'monthly','ngày tuân thủ']]
    },
    'ke-toan-doanh-thu-cnpt':{
      title:'Kế toán viên – Doanh thu & Công nợ phải thu',groupLabel:'Kế toán',code:'KT-DT-CNPT',version:'KT-DT-CNPT-1.0',policy:'KT-DT-CNPT-TỔNG-1.0',source:'Nguồn tham chiếu nội bộ: mẫu Linh',scope:'Áp dụng cho Kế toán viên phụ trách Doanh thu & Công nợ phải thu',
      reason:'Chuẩn hóa bảng tổng và nhóm nghiệp vụ doanh thu, dòng tiền, hóa đơn và công nợ phải thu; giữ 10 chỉ tiêu, tổng trọng số 100%.',groups:ACCOUNTING_RECEIVABLE_GROUPS,
      rules:['Tiêu chí chi tiết chưa có hệ số dùng mặc định hệ số 1.','Giữ đúng mục tiêu từng dòng trong file nguồn khi nối dữ liệu thật.','Nhóm TACPHONG chung toàn công ty gồm ứng xử PHF hệ số 10 và Đi trễ.','Bảng tổng gồm 10 chỉ tiêu, mỗi chỉ tiêu 10%.'],
      rows:[['Thu tiền qua Techcombank',10,10],['Thu tiền qua ACB',10,10],['Thu tiền mặt tại ba chi nhánh',10,10],['Thu tiền qua MPOS',10,10],['Kiểm tra đơn Sapo với Sapo Invoice',10,10],['Đề nghị chi hoàn tiền khách',10,10],['Xử lý đơn lỗi',10,10],['Xử lý hóa đơn điều chỉnh hoặc thay thế',10,10],['Kiểm tra số dư tài khoản',10,10],['Cập nhật báo cáo dòng tiền',10,10]]
    },
    'ke-toan-truong':{
      title:'Kế toán trưởng',groupLabel:'Kế toán',code:'KTT',version:'KTT-1.0',policy:'KTT-TỔNG-1.0',source:'Nguồn tham chiếu nội bộ: mẫu Thanh',scope:'Áp dụng cho chức danh Kế toán trưởng',
      reason:'Chuẩn hóa bảng tổng và trách nhiệm quản lý Kế toán trưởng; giữ tổng trọng số 100%, các hạng mục dự án theo kỳ được quản lý theo tháng.',groups:CHIEF_ACCOUNTANT_GROUPS,
      rules:['Tiêu chí chi tiết chưa có hệ số dùng mặc định hệ số 1.','Các hạng mục xử lý tồn kho, mô hình báo cáo hoặc công việc dự án được gắn tag Thay đổi theo kế hoạch tháng.','Nhóm TACPHONG chung toàn công ty gồm ứng xử PHF hệ số 10 và Đi trễ.','Bảng tổng giữ 10 chỉ tiêu, mỗi chỉ tiêu 10%.'],
      rows:[['Quản lý và phê duyệt nghiệp vụ thu – chi',10,10],['Kiểm tra doanh thu và chi phí',10,10],['Kiểm soát dòng tiền',10,10],['Kiểm soát chi phí',10,10],['Rà soát sai lệch số liệu',10,10],['Báo cáo quản trị',10,10],['Báo cáo tài chính nội bộ',10,10],['Kiểm soát hóa đơn GTGT và báo cáo thuế',10,10],['Quản lý, hướng dẫn và đào tạo nhân viên kế toán',10,10],['Công việc theo kế hoạch/Ban Giám đốc giao',10,10,'monthly']]
    },
    'tro-ly-1-ngoc':{
      title:'Trợ lý Giám đốc 1 – Khối nội bộ',code:'TLGD1',version:'TLGD1-1.0',policy:'TLGD1-TỔNG-1.0',source:'Troly1_Ngọc.xlsx',scope:'Áp dụng cho Trợ lý Giám đốc 1 – Khối nội bộ',
      reason:'Chuẩn hóa bảng đánh giá Trợ lý Giám đốc 1; giữ nguyên 15 chỉ tiêu và tổng trọng số 100%.',
      rows:[
        ['Lập phiếu và đánh giá công việc hàng tháng',2,10],
        ['Tổng hợp, nhận xét báo cáo TCKT đúng yêu cầu và đúng hạn',10,5],
        ['Tổng hợp, nhận xét báo cáo HCNS đúng yêu cầu và đúng hạn',10,5],
        ['Tổng hợp, nhận xét báo cáo Marketing đúng yêu cầu và đúng hạn',10,5],
        ['Tổng hợp, nhận xét báo cáo Bán hàng Online đúng yêu cầu và đúng hạn',10,5],
        ['Tổng hợp, nhận xét báo cáo Kho đúng yêu cầu và đúng hạn',10,5],
        ['Tổng hợp phiếu đánh giá PHF của HCNS đầy đủ, đúng hạn',10,5],
        ['Tổng hợp phiếu đánh giá PHF của TCKT đầy đủ, đúng hạn',10,5],
        ['Tổng hợp phiếu đánh giá PHF của Marketing đầy đủ, đúng hạn',10,5],
        ['Tổng hợp phiếu đánh giá PHF của Bán hàng Online đầy đủ, đúng hạn',10,5],
        ['Tổng hợp phiếu đánh giá PHF của Kho đầy đủ, đúng hạn',10,5],
        ['Đối soát số liệu tồn kho Kho – Cửa hàng – Kế toán định kỳ',4,10],
        ['Công việc kiêm nhiệm và hỗ trợ không phát sinh lỗi',10,10],
        ['Thực hiện công việc cấp trên giao',10,10],
        ['Đào tạo, hướng dẫn các bộ phận phụ trách',2,10]
      ]
    },
    'tro-ly-2-tien':{
      title:'Trợ lý Giám đốc 2 – Khối vận hành',code:'TLGD2',version:'TLGD2-1.0',policy:'TLGD2-TỔNG-1.0',source:'Bản sao của Troly2_Tiên.xlsx',scope:'Áp dụng cho Trợ lý Giám đốc 2 – Khối vận hành',
      reason:'Chuẩn hóa bảng đánh giá Trợ lý Giám đốc 2; sửa chính tả Cửa hàng và giữ nguyên 10 chỉ tiêu, mỗi chỉ tiêu 10%.',
      rows:[
        ['Lập phiếu và đánh giá công việc hàng tháng',2,10],
        ['Tổng hợp, nhận xét báo cáo Cửa hàng đúng yêu cầu và đúng hạn',10,10],
        ['Tổng hợp, nhận xét báo cáo Mua hàng đúng yêu cầu và đúng hạn',10,10],
        ['Tổng hợp, nhận xét báo cáo Gói quà đúng yêu cầu và đúng hạn',10,10],
        ['Tổng hợp phiếu đánh giá PHF của Cửa hàng đầy đủ, đúng hạn',10,10],
        ['Tổng hợp phiếu đánh giá PHF của Mua hàng đầy đủ, đúng hạn',10,10],
        ['Tổng hợp phiếu đánh giá PHF của Gói quà đầy đủ, đúng hạn',10,10],
        ['Công việc kiêm nhiệm và hỗ trợ không phát sinh lỗi',10,10],
        ['Đề xuất cải tiến trong tháng',2,10],
        ['Đào tạo, hướng dẫn các bộ phận phụ trách',2,10]
      ]
    },
    'tro-ly-3-vinh':{
      title:'Ban Giám sát kiêm Trợ lý Giám đốc',code:'GS-TLGD',version:'GS-TLGD-1.0',policy:'GS-TLGD-TỔNG-1.0',source:'Troly3_Vinh.xlsx',scope:'Áp dụng cho Ban Giám sát kiêm Trợ lý Giám đốc',
      reason:'Chuẩn hóa bảng đánh giá Ban Giám sát kiêm Trợ lý Giám đốc; giữ nguyên trọng số và chuẩn hóa mục tiêu kiểm tra tuân thủ thành 100 điểm.',
      rows:[
        ['Lập phiếu và đánh giá công việc hàng tháng',2,10],
        ['Kiểm tra tuân thủ tại các điểm theo Checklist',100,50],
        ['Đề xuất cải tiến',1,10],
        ['Tái đào tạo tiêu chuẩn trưng bày và sơ chế cho nhân viên bán hàng mới',7,30]
      ]
    },
    'qtth-hcns-thang':{
      title:'QTTH/HCNS – Trưởng bộ phận',groupLabel:'QTTH/HCNS',code:'TBP-HCNS',version:'TBP-HCNS-1.0',policy:'TBP-HCNS-TỔNG-1.0',source:'Bộ tiêu chuẩn QTTH/HCNS · TBP HCNS + TCCV',scope:'Áp dụng cho chức danh Trưởng bộ phận QTTH/HCNS',
      reason:'Chuẩn hóa bảng tổng và Checklist QTTH/HCNS; giữ nguyên 6 chỉ tiêu, tổng trọng số 100%, đồng thời áp dụng hệ số mặc định 1 cho tiêu chí nghiệp vụ chưa ghi hệ số.',
      groups:HCNS_TEMPLATE_GROUPS,
      rules:[
        'Giữ đúng 8 tiêu chí nghiệp vụ trong sheet TCCV; tiêu chí chưa ghi hệ số dùng mặc định hệ số 1.',
        'Nhóm cha TACPHONG – Nội quy và tác phong là nhóm chung toàn công ty.',
        'Tuân thủ nguyên tắc ứng xử PHF giữ hệ số 10; Đi trễ lấy từ thư viện chung.',
        'Dòng Tuân thủ tiêu chuẩn công việc luôn có mục tiêu 100 điểm.',
        'Bảng tổng giữ đúng trọng số gốc 10% – 20% – 40% – 10% – 10% – 10%.',
        'Công thức chung: Thực đạt ×1, Thẩm định ×2, chia 3; sau đó quy đổi theo trọng số.'
      ],
      rows:[
        ['Lập phiếu và đánh giá công việc tháng',2,10,null,'phiếu'],
        ['Tỷ lệ người lao động có phiếu PHF',100,20,null,'%'],
        ['Tuân thủ tiêu chuẩn công việc',100,40,null,'điểm'],
        ['Đào tạo nhân viên',4,10,null,'buổi'],
        ['Công việc cấp trên giao',10,10,null,'điểm'],
        ['Báo cáo công việc đúng quy định',31,10,null,'báo cáo/ngày công']
      ]
    },
    'qtth-hcns-nhan-vien':{
      title:'Nhân viên QTTH/HCNS',groupLabel:'QTTH/HCNS',code:'NV-HCNS',version:'NV-HCNS-1.0',policy:'NV-HCNS-TỔNG-1.0',source:'Sao chép cấu trúc chuẩn từ mẫu QTTH/HCNS – Trưởng bộ phận',scope:'Áp dụng cho chức danh Nhân viên QTTH/HCNS',
      reason:'Tạo mẫu Nhân viên QTTH/HCNS theo cùng cấu trúc Checklist, bảng tổng và quy tắc vận hành của mẫu QTTH/HCNS hiện hành.',
      groups:HCNS_TEMPLATE_GROUPS,
      rules:[
        'Sử dụng cùng cấu trúc tiêu chí QTTH/HCNS hiện hành theo yêu cầu vận hành.',
        'Nhóm cha TACPHONG – Nội quy và tác phong là nhóm chung toàn công ty.',
        'Tuân thủ nguyên tắc ứng xử PHF giữ hệ số 10; Đi trễ lấy từ thư viện chung.',
        'Dòng Tuân thủ tiêu chuẩn công việc luôn có mục tiêu 100 điểm.',
        'Bảng tổng giữ trọng số 10% – 20% – 40% – 10% – 10% – 10%.',
        'Công thức chung: Thực đạt ×1, Thẩm định ×2, chia 3; sau đó quy đổi theo trọng số.'
      ],
      rows:[
        ['Lập phiếu và đánh giá công việc tháng',2,10,null,'phiếu'],
        ['Tỷ lệ người lao động có phiếu PHF',100,20,null,'%'],
        ['Tuân thủ tiêu chuẩn công việc',100,40,null,'điểm'],
        ['Đào tạo nhân viên',4,10,null,'buổi'],
        ['Công việc cấp trên giao',10,10,null,'điểm'],
        ['Báo cáo công việc đúng quy định',31,10,null,'báo cáo/ngày công']
      ]
    },
    'nv-goi-qua':{
      title:'Nhân viên Gói quà',groupLabel:'Gói quà',code:'NV-GQ',version:'NV-GQ-1.0',policy:'NV-GQ-TỔNG-1.0',source:'nv goi1 qua2.xlsx · A.NVGQ_ PHÁT + B.TCCV. NVGQ_ PHÁT + C. SLYC',scope:'Áp dụng cho chức danh Nhân viên Gói quà',
      reason:'Chuẩn hóa mẫu Nhân viên Gói quà từ bảng tổng, Checklist hằng ngày và bảng số lượng giỏ theo file gốc; giữ nguyên hệ số nghiệp vụ và trọng số 5% – 70% – 25%.',
      groups:GIFT_WRAP_TEMPLATE_GROUPS,
      rules:[
        'Giữ đúng tiêu chuẩn kỹ thuật, công việc hằng ngày, bảo quản, vệ sinh và bàn giao ca trong file gốc.',
        'Tiêu chuẩn số lượng giỏ theo chi nhánh/ngày/khoảng giá được giữ làm hướng dẫn chi tiết của tiêu chí trưng bày.',
        'Nhóm cha TACPHONG – Nội quy và tác phong là nhóm chung toàn công ty; ứng xử PHF hệ số 10.',
        'Dòng Tuân thủ tiêu chuẩn công việc luôn có mục tiêu 100 điểm.',
        'Bảng tổng giữ đúng trọng số gốc 5% – 70% – 25%.',
        'Công thức chung: Thực đạt ×1, Thẩm định ×2, chia 3; sau đó quy đổi theo trọng số.'
      ],
      rows:[
        ['Lập phiếu đánh giá công việc hàng tháng',2,5,null,'phiếu'],
        ['Tuân thủ tiêu chuẩn công việc',100,70,null,'điểm'],
        ['Thực hiện các công việc cấp trên giao',10,25,null,'điểm']
      ]
    },
    'tbp-goi-qua':{
      title:'Trưởng bộ phận Gói quà',groupLabel:'Gói quà',code:'TBP-GQ',version:'TBP-GQ-1.0',policy:'TBP-GQ-TỔNG-1.0',source:'tbp goi1 qua.xlsx · A.NVGQ_ ÚT HẢI + B.TCCV. NVGQ_ ÚT HẢI + C. SLYC',scope:'Áp dụng cho chức danh Trưởng bộ phận Gói quà',
      reason:'Chuẩn hóa tên chức danh quản lý Gói quà; kế thừa toàn bộ mẫu Nhân viên Gói quà và bổ sung 4 tiêu chí quản lý nhóm theo file gốc.',
      groups:GIFT_WRAP_MANAGER_TEMPLATE_GROUPS,
      rules:[
        'Kế thừa toàn bộ tiêu chí của Nhân viên Gói quà.',
        'Bổ sung 4 tiêu chí quản lý: phân công ca, giám sát hiệu suất, xử lý sự cố và phối hợp Marketing lên mẫu giỏ.',
        'Nhóm cha TACPHONG – Nội quy và tác phong là nhóm chung toàn công ty; ứng xử PHF hệ số 10.',
        'Dòng Tuân thủ tiêu chuẩn công việc luôn có mục tiêu 100 điểm.',
        'Bảng tổng giữ đúng trọng số gốc 5% – 70% – 25%.',
        'Công thức chung: Thực đạt ×1, Thẩm định ×2, chia 3; sau đó quy đổi theo trọng số.'
      ],
      rows:[
        ['Lập phiếu đánh giá công việc hàng tháng',2,5,null,'phiếu'],
        ['Tuân thủ tiêu chuẩn công việc',100,70,null,'điểm'],
        ['Thực hiện các công việc cấp trên giao',10,25,null,'điểm']
      ]
    },
    'tbp-marketing':{
      title:'Trưởng bộ phận Marketing',code:'TBP-MKT',version:'TBP-MKT-1.0',policy:'TBP-MKT-TỔNG-1.0',source:'TBP MKT.xlsx · sheet tbp',scope:'Áp dụng cho chức danh Trưởng bộ phận Marketing',
      reason:'Chuẩn hóa bảng đánh giá TBP Marketing; giữ nguyên 11 chỉ tiêu, mục tiêu và tổng trọng số 100%. Các nội dung theo chiến dịch được quản lý theo từng tháng.',
      rows:[
        ['Lập phiếu và đánh giá công việc hàng tuần',5,10],
        ['Phối hợp các bộ phận thực hiện kế hoạch chung',8,10],
        ['Campaign theo kế hoạch tháng',5,15,'monthly'],
        ['Quay dựng video theo kế hoạch',4.5,10],
        ['Mẫu quà theo kế hoạch tháng',20,5,'monthly'],
        ['Lập kế hoạch content tháng tiếp theo',5,10,'monthly'],
        ['Cập nhật báo cáo quảng cáo và báo cáo team',2,10],
        ['Cập nhật mẫu quà trên Web/Shopee/Grab/Sapo',60,10,'monthly'],
        ['Thiết kế ấn phẩm',5,5],
        ['Hoàn thành bài học online TikTok',26,5],
        ['Công việc phát sinh theo yêu cầu',10,10]
      ]
    },
    'nv-marketing':{
      title:'Nhân viên Media Marketing',code:'NV-MEDIA',version:'NV-MEDIA-1.0',policy:'NV-MEDIA-TỔNG-1.0',source:'NV MKT.xlsx · sheet nv mkt',scope:'Áp dụng cho chức danh Nhân viên Media Marketing',
      reason:'Chuẩn hóa bảng đánh giá Nhân viên Media Marketing; giữ nguyên 9 chỉ tiêu, mục tiêu và tổng trọng số 100%. Các mục tiêu sản lượng theo kế hoạch được quản lý theo từng tháng.',
      rows:[
        ['Lập phiếu và đánh giá công việc hàng tuần',5,10],
        ['Phối hợp các bộ phận thực hiện kế hoạch chung',8,10],
        ['Campaign theo kế hoạch tháng',3,15,'monthly'],
        ['Quay dựng video theo kế hoạch',4.5,10],
        ['Mẫu quà theo kế hoạch tháng',50,15,'monthly'],
        ['Bài viết mạng xã hội theo kế hoạch tháng',160,20,'monthly'],
        ['Livestream theo kế hoạch tháng',10,10,'monthly'],
        ['Hoàn thành bài học online TikTok',26,5],
        ['Công việc phát sinh theo yêu cầu',5,5]
      ]
    }
  });
  var templateUiState={query:'',group:'all',selectedId:'',salesTab:'criteria',totalExplain:'',salesFullscreen:true};
  var peopleUiState={query:'',status:'all',selectedId:'',editingId:'',page:1,pageSize:20};
  var violationUiState={employeeId:'',templateId:'',step:1,evidenceRequired:false,duplicateWarning:true,mode:'quick',query:'',group:'all',selected:{},date:'',location:'',sharedNote:'',sharedEvidence:false,multiRows:[],lateRows:[]};
  var scrollMemory={};var pendingScrollRestore=null;
  var modalScrollLock={locked:false,y:0,bodyStyle:null,htmlOverflow:''};
  function hasChecklistModal(){return !!document.querySelector('#phfChecklistRoot [data-phfck-modal-layer]');}
  function lockChecklistBackgroundScroll(){
    if(modalScrollLock.locked||!hasChecklistModal())return;
    var body=document.body,html=document.documentElement;
    modalScrollLock.locked=true;modalScrollLock.y=currentScrollY();
    modalScrollLock.bodyStyle={position:body.style.position,top:body.style.top,left:body.style.left,right:body.style.right,width:body.style.width,overflow:body.style.overflow};
    modalScrollLock.htmlOverflow=html.style.overflow;
    html.classList.add('phfck-modal-open');body.classList.add('phfck-modal-open');
    html.style.overflow='hidden';body.style.position='fixed';body.style.top='-'+modalScrollLock.y+'px';body.style.left='0';body.style.right='0';body.style.width='100%';body.style.overflow='hidden';
  }
  function unlockChecklistBackgroundScroll(){
    if(!modalScrollLock.locked||hasChecklistModal())return;
    var body=document.body,html=document.documentElement,old=modalScrollLock.bodyStyle||{},y=modalScrollLock.y;
    modalScrollLock.locked=false;html.classList.remove('phfck-modal-open');body.classList.remove('phfck-modal-open');
    html.style.overflow=modalScrollLock.htmlOverflow||'';body.style.position=old.position||'';body.style.top=old.top||'';body.style.left=old.left||'';body.style.right=old.right||'';body.style.width=old.width||'';body.style.overflow=old.overflow||'';
    modalScrollLock.bodyStyle=null;requestAnimationFrame(function(){window.scrollTo(0,y);});
  }
  function syncChecklistModalScrollLock(){if(hasChecklistModal())lockChecklistBackgroundScroll();else unlockChecklistBackgroundScroll();}
  function currentScrollY(){return Math.max(0,window.scrollY||document.documentElement.scrollTop||0);}
  function rememberScroll(key){scrollMemory[key||cleanPath(location.pathname)]=currentScrollY();return currentScrollY();}
  function restoreScroll(y){if(y==null)return;requestAnimationFrame(function(){requestAnimationFrame(function(){try{window.scrollTo({top:Math.max(0,Number(y)||0),left:0,behavior:'auto'});}catch(_e){}});});}
  function rerenderKeepingScroll(workspace,html){var y=currentScrollY();if(workspace)workspace.innerHTML=html;restoreScroll(y);}
  function todayIso(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  function ensureViolationDefaults(){if(!violationUiState.date)violationUiState.date=todayIso();if(!Array.isArray(violationUiState.multiRows))violationUiState.multiRows=[];}
  function timePickerButtonHtml(value,attrs){return '<div class="phfck-time-field"><input type="text" inputmode="numeric" autocomplete="off" maxlength="5" pattern="(?:[01]\\d|2[0-3]):[0-5]\\d" placeholder="HH:mm" aria-label="Giờ theo định dạng 24 giờ" value="'+esc(value||currentTime24())+'" data-phfck-time24 '+(attrs||'')+'><button type="button" class="phfck-time-trigger" data-phfck-time-trigger aria-label="Chọn giờ">◷</button></div>';}
  var taskUiState={scope:'mine',status:'all',query:'',priority:'all',selectedId:''};
  var monthlyUiState={status:'all',month:'',selectedId:''};
  var reportUiState={view:'summary',month:'',scope:'all'};
  var settingsUiState={section:'permissions'};
  function normalizeText(v){return String(v==null?'':v).trim();}
  function employeeCodeOf(row){return normalizeText(row&&((row.employeeCode||row.employee_code||row.code||row.staffCode||row.staff_code)));}
  function employeeNameOf(row){return normalizeText(row&&((row.fullName||row.full_name||row.name||row.employeeName||row.employee_name)));}
  function employeeIdOf(row,index){return normalizeText(row&&((row.id||row.employeeId||row.employee_id)))||('row-'+index);}
  function employeeDepartmentOf(row){return normalizeText(row&&((row.department||row.departmentName||row.department_name||row.team||row.phongBan||row.phong_ban)));}
  function employeeBranchOf(row){return normalizeText(row&&((row.branch||row.branchName||row.branch_name||row.location||row.workLocation||row.work_location||row.chiNhanh||row.chi_nhanh)));}
  function employeeEmailOf(row){return normalizeText(row&&((row.email||row.loginEmail||row.login_email)));}
  function employeePhoneOf(row){return normalizeText(row&&((row.phone||row.phoneNumber||row.phone_number)));}
  function isSystemEmployee(row){var text=(employeeNameOf(row)+' '+employeeCodeOf(row)).toLowerCase();return text.indexOf('admin test')>=0||text.indexOf('admin-test')>=0||String(row&&row.accountType||'').toLowerCase()==='system_admin';}
  var CHECKLIST_DEPARTMENT_STORE='phf_checklist_department_overrides_v1';
  var CHECKLIST_TITLE_STORE='phf_checklist_title_assignments_v1';
  var CHECKLIST_FORM_ASSIGNMENT_STORE='phf_checklist_form_assignments_v1';
  var CHECKLIST_HIDDEN_EMPLOYEES_STORE='phf_checklist_hidden_unlinked_employees_v1';
  var CHECKLIST_BRANCH_STORE='phf_checklist_branch_assignments_v1';
  var CHECKLIST_MANAGER_STORE='phf_checklist_manager_assignments_v1';
  var CHECKLIST_EMPLOYEE_STATUS_STORE='phf_checklist_employee_status_assignments_v1';
  var pendingTitleChange=null;
  var pendingBranchChange=null;
  function employeeTitleOf(row){return normalizeText(row&&((row.position||row.positionName||row.position_name||row.title||row.jobTitle||row.job_title||row.chucDanh||row.chuc_danh)));}
  function loadTitleAssignments(){try{var x=JSON.parse(localStorage.getItem(CHECKLIST_TITLE_STORE)||'{}');return x&&typeof x==='object'?x:{};}catch(_e){return {};}}
  function saveTitleAssignments(value){try{localStorage.setItem(CHECKLIST_TITLE_STORE,JSON.stringify(value||{}));}catch(_e){}}
  function loadFormAssignments(){try{var x=JSON.parse(localStorage.getItem(CHECKLIST_FORM_ASSIGNMENT_STORE)||'{}');return x&&typeof x==='object'?x:{};}catch(_e){return {};}}
  function saveFormAssignments(value){try{localStorage.setItem(CHECKLIST_FORM_ASSIGNMENT_STORE,JSON.stringify(value||{}));return true;}catch(_e){return false;}}
  function formAssignmentKey(item){return normalizeText(item&&((item.code||item.id||item.name))).toLowerCase();}
  function templateById(id){return CHECKLIST_TEMPLATE_CATALOG.find(function(x){return x.id===id;})||null;}
  function normalizeMatchText(v){return normalizeText(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');}
  function suggestChecklistTemplate(item){
    var department=normalizeMatchText(item&&item.department),title=normalizeMatchText(item&&item.title),id='',reason='',score=0;
    function choose(candidate,why,points){if(points>score){id=candidate;reason=why;score=points;}}
    if(title){
      if(/truong ca|pho ca/.test(title))choose('truong-ca-ban-hang','Khớp chức danh Trưởng ca/Phó ca',100);
      if(/truong bo phan|tbp/.test(title)&&/kho|so che/.test(title+' '+department))choose('tbp-kho','Khớp chức danh quản lý Kho & Sơ chế',100);
      if(/nhan vien/.test(title)&&/kho|so che/.test(title+' '+department))choose('nv-kho','Khớp chức danh Nhân viên Kho & Sơ chế',95);
      if(/truong bo phan|tbp/.test(title)&&/marketing|mkt|media/.test(title+' '+department))choose('tbp-marketing','Khớp chức danh Trưởng bộ phận Marketing',100);
      if(/media|marketing|mkt/.test(title+' '+department)&&!(/truong bo phan|tbp/.test(title)))choose('nv-marketing','Khớp chức danh Media Marketing',90);
      if(/truong bo phan|tbp/.test(title)&&/goi qua/.test(title+' '+department))choose('tbp-goi-qua','Khớp chức danh Trưởng bộ phận Gói quà',100);
      if(/goi qua/.test(title+' '+department)&&!(/truong bo phan|tbp/.test(title)))choose('nv-goi-qua','Khớp chức danh Nhân viên Gói quà',90);
      if(/truong bo phan|tbp/.test(title)&&/hcns|qtth|hanh chinh|nhan su/.test(title+' '+department))choose('qtth-hcns-thang','Khớp chức danh Trưởng bộ phận QTTH/HCNS',100);
      if(/hcns|qtth|hanh chinh|nhan su/.test(title+' '+department)&&!(/truong bo phan|tbp/.test(title)))choose('qtth-hcns-nhan-vien','Khớp chức danh Nhân viên QTTH/HCNS',90);
      if(/ke toan truong/.test(title))choose('ke-toan-truong','Khớp chức danh Kế toán trưởng',100);
      if(/chi phi|cong no phai tra/.test(title))choose('ke-toan-chi-phi-cnpt','Khớp nghiệp vụ Chi phí & Công nợ phải trả',98);
      if(/doanh thu|cong no phai thu/.test(title))choose('ke-toan-doanh-thu-cnpt','Khớp nghiệp vụ Doanh thu & Công nợ phải thu',98);
      if(/ke toan/.test(title+' '+department))choose('ke-toan-tong-hop','Khớp chức danh/phòng ban Kế toán',85);
      if(/cskh|check don|online/.test(title+' '+department))choose('nv-online','Khớp chức danh CSKH & Check đơn Online',95);
      if(/ban giam sat/.test(title))choose('tro-ly-3-vinh','Khớp chức danh Ban Giám sát kiêm Trợ lý',100);
      if(/tro ly/.test(title)&&/van hanh/.test(title+' '+department))choose('tro-ly-2-tien','Khớp Trợ lý khối vận hành',95);
      if(/tro ly/.test(title))choose('tro-ly-1-ngoc','Khớp chức danh Trợ lý khối nội bộ',85);
      if(/ban hang/.test(title+' '+department))choose('nv-ban-hang','Khớp chức danh/phòng ban Bán hàng',80);
    }
    if(!id&&department){
      if(/ban hang/.test(department))choose('nv-ban-hang','Khớp phòng ban Bán hàng; chưa có chức danh đủ rõ',50);
      else if(/kho|so che/.test(department))choose('nv-kho','Khớp phòng ban Kho & Sơ chế; chưa có chức danh đủ rõ',50);
      else if(/marketing|mkt|media/.test(department))choose('nv-marketing','Khớp phòng ban Marketing; chưa có chức danh đủ rõ',50);
      else if(/goi qua/.test(department))choose('nv-goi-qua','Khớp phòng ban Gói quà; chưa có chức danh đủ rõ',50);
      else if(/hcns|qtth|hanh chinh|nhan su/.test(department))choose('qtth-hcns-nhan-vien','Khớp phòng ban QTTH/HCNS; chưa có chức danh đủ rõ',50);
      else if(/ke toan/.test(department))choose('ke-toan-tong-hop','Khớp phòng ban Kế toán; chưa có chức danh đủ rõ',50);
      else if(/online|cskh/.test(department))choose('nv-online','Khớp phòng ban CSKH/Online; chưa có chức danh đủ rõ',50);
    }
    return id?{templateId:id,template:templateById(id),reason:reason,score:score}:{templateId:'',template:null,reason:(!item||!item.department||!item.title?'Chưa đủ Phòng ban và Chức danh chính để gợi ý chính xác.':'Chưa tìm thấy mẫu phù hợp trong danh mục hiện tại.'),score:0};
  }
  function titleAssignmentKey(item){return normalizeText(item&&((item.code||item.id||item.name))).toLowerCase();}
  function titleCatalog(rows){
    var values=[];function add(v){v=normalizeText(v);if(v&&values.indexOf(v)<0)values.push(v);}
    (rows||[]).forEach(function(x){add(x.title);});
    var data=window.__phfLocalData||window.localData||{};
    (Array.isArray(data.employees)?data.employees:[]).forEach(function(x){add(employeeTitleOf(x));});
    (Array.isArray(data.hubAccounts)?data.hubAccounts:[]).forEach(function(x){add(employeeTitleOf(x));});
    (Array.isArray(data.userAccounts)?data.userAccounts:[]).forEach(function(x){add(employeeTitleOf(x));});
    CHECKLIST_TEMPLATE_CATALOG.forEach(function(x){add(x.title||x.name);});
    return values.sort(function(a,b){return a.localeCompare(b,'vi');});
  }
  function loadDepartmentOverrides(){try{var x=JSON.parse(localStorage.getItem(CHECKLIST_DEPARTMENT_STORE)||'{}');return x&&typeof x==='object'?x:{};}catch(_e){return {};}}
  function saveDepartmentOverrides(value){try{localStorage.setItem(CHECKLIST_DEPARTMENT_STORE,JSON.stringify(value||{}));}catch(_e){}}
  function loadBranchAssignments(){try{var x=JSON.parse(localStorage.getItem(CHECKLIST_BRANCH_STORE)||'{}');return x&&typeof x==='object'?x:{};}catch(_e){return {};}}
  function saveBranchAssignments(value){try{localStorage.setItem(CHECKLIST_BRANCH_STORE,JSON.stringify(value||{}));return true;}catch(_e){return false;}}
  function branchAssignmentKey(item){return normalizeText(item&&((item.code||item.id||item.name))).toLowerCase();}
  function loadManagerAssignments(){try{var x=JSON.parse(localStorage.getItem(CHECKLIST_MANAGER_STORE)||'{}');return x&&typeof x==='object'?x:{};}catch(_e){return {};}}
  function saveManagerAssignments(value){try{localStorage.setItem(CHECKLIST_MANAGER_STORE,JSON.stringify(value||{}));return true;}catch(_e){return false;}}
  function managerAssignmentKey(item){return normalizeText(item&&((item.code||item.id||item.name))).toLowerCase();}
  function loadEmployeeStatusAssignments(){try{var x=JSON.parse(localStorage.getItem(CHECKLIST_EMPLOYEE_STATUS_STORE)||'{}');return x&&typeof x==='object'?x:{};}catch(_e){return {};}}
  function saveEmployeeStatusAssignments(value){try{localStorage.setItem(CHECKLIST_EMPLOYEE_STATUS_STORE,JSON.stringify(value||{}));return true;}catch(_e){return false;}}
  function employeeStatusAssignmentKey(item){return normalizeText(item&&((item.code||item.id||item.name))).toLowerCase();}
  function branchOptions(rows){var data=window.__phfLocalData||window.localData||{},values=[];function add(v){v=normalizeText(v);if(v&&values.indexOf(v)<0)values.push(v);}(rows||[]).forEach(function(x){add(x.branch);});(Array.isArray(data.employees)?data.employees:[]).forEach(function(x){add(employeeBranchOf(x));});(Array.isArray(data.hubAccounts)?data.hubAccounts:[]).forEach(function(x){add(employeeBranchOf(x));});(Array.isArray(data.userAccounts)?data.userAccounts:[]).forEach(function(x){add(employeeBranchOf(x));});['Phú Lợi','Ngô Quyền','Lái Thiêu','TTPP','Văn phòng'].forEach(add);return values.sort(function(a,b){return a.localeCompare(b,'vi');});}
  function loadHiddenEmployees(){try{var x=JSON.parse(localStorage.getItem(CHECKLIST_HIDDEN_EMPLOYEES_STORE)||'[]');return Array.isArray(x)?x.map(normalizeText).filter(Boolean):[];}catch(_e){return [];}}
  function saveHiddenEmployees(value){try{localStorage.setItem(CHECKLIST_HIDDEN_EMPLOYEES_STORE,JSON.stringify(Array.from(new Set(value||[]))));}catch(_e){}}
  function hideEmployeeFromChecklist(id){id=normalizeText(id);if(!id)return;var rows=loadHiddenEmployees();if(rows.indexOf(id)<0)rows.push(id);saveHiddenEmployees(rows);}
  function departmentKey(item){return normalizeText(item&&((item.code||item.id||item.name))).toLowerCase();}
  function departmentOptions(rows){
    var data=window.__phfLocalData||window.localData||{},values=[];
    function add(v){v=normalizeText(v);if(v&&values.indexOf(v)<0)values.push(v);}
    (rows||[]).forEach(function(x){add(x.department);});
    (Array.isArray(data.employees)?data.employees:[]).forEach(function(x){add(employeeDepartmentOf(x));});
    (Array.isArray(data.hubAccounts)?data.hubAccounts:[]).forEach(function(x){add(employeeDepartmentOf(x));});
    (Array.isArray(data.userAccounts)?data.userAccounts:[]).forEach(function(x){add(employeeDepartmentOf(x));});
    var settings=data.settings||{};
    var catalogs=[settings.departments,data.departments,window.PHF_DEPARTMENTS];
    catalogs.forEach(function(list){if(Array.isArray(list))list.forEach(function(x){add(typeof x==='string'?x:(x&&x.name));});});
    return values.sort(function(a,b){return a.localeCompare(b,'vi');});
  }
  var peopleDataSyncState={timer:null,slowTimer:null,startedAt:0,token:0};
  function checklistPeopleDataReady(){
    var data=window.__phfLocalData||window.localData||null;
    return !!(data&&Array.isArray(data.employees));
  }
  function stopPeopleDataSync(){
    peopleDataSyncState.token+=1;
    if(peopleDataSyncState.timer){clearTimeout(peopleDataSyncState.timer);peopleDataSyncState.timer=null;}
    if(peopleDataSyncState.slowTimer){clearTimeout(peopleDataSyncState.slowTimer);peopleDataSyncState.slowTimer=null;}
    peopleDataSyncState.startedAt=0;
  }
  function peopleLoadingHtml(isSlow){
    return '<div class="phfck-page-head phfck-people-head"><div><small>PHF CHECKLIST · ADMIN</small><h1>Nhân sự & phân công</h1><p>Lấy đúng Họ tên và Mã nhân viên từ Hub; Admin chủ động gán mẫu, ngày hiệu lực và phạm vi nghiệp vụ Checklist.</p></div><button class="phfck-primary" type="button" disabled>＋ Phân công hàng loạt</button></div>'
      +'<section class="phfck-people-stats phfck-loading-stats">'+[1,2,3,4].map(function(){return '<article><span class="phfck-skeleton phfck-skeleton-label"></span><strong class="phfck-skeleton phfck-skeleton-number">—</strong><small class="phfck-skeleton phfck-skeleton-note"></small></article>';}).join('')+'</section>'
      +'<section class="phfck-panel phfck-people-panel phfck-people-loading" data-phfck-people-loading><div class="phfck-loading-message"><span class="phfck-loading-spinner" aria-hidden="true"></span><div><b>'+(isSlow?'Dữ liệu đang tải chậm':'Đang tải dữ liệu nhân sự từ hệ thống…')+'</b><p>'+(isSlow?'Vui lòng chờ thêm hoặc bấm Thử lại.':'Danh sách sẽ tự hiển thị ngay khi dữ liệu Hub sẵn sàng; không cần chuyển tab hoặc F5.')+'</p></div>'+(isSlow?'<button type="button" class="phfck-secondary" data-phfck-people-retry>Thử lại</button>':'')+'</div><div class="phfck-loading-table">'+[1,2,3,4,5,6].map(function(){return '<div>'+[1,2,3,4,5,6].map(function(){return '<span class="phfck-skeleton"></span>';}).join('')+'</div>';}).join('')+'</div></section>';
  }
  function refreshPeopleWhenDataReady(root,force){
    if(!root||adminViewFromPath(location.pathname)!=='people')return;
    if(checklistPeopleDataReady()){
      stopPeopleDataSync();
      refreshPeopleWorkspace(root);
      return;
    }
    if(force)stopPeopleDataSync();
    if(peopleDataSyncState.timer)return;
    var token=++peopleDataSyncState.token;
    peopleDataSyncState.startedAt=Date.now();
    peopleDataSyncState.slowTimer=setTimeout(function(){
      if(token!==peopleDataSyncState.token||adminViewFromPath(location.pathname)!=='people'||checklistPeopleDataReady())return;
      var workspace=root.querySelector('[data-phfck-workspace]');if(workspace)workspace.innerHTML=peopleLoadingHtml(true);
    },8000);
    function poll(){
      if(token!==peopleDataSyncState.token)return;
      if(adminViewFromPath(location.pathname)!=='people'){stopPeopleDataSync();return;}
      if(checklistPeopleDataReady()){stopPeopleDataSync();refreshPeopleWorkspace(root);return;}
      peopleDataSyncState.timer=setTimeout(function(){peopleDataSyncState.timer=null;poll();},250);
    }
    poll();
  }
  function checklistEmployees(){
    var data=window.__phfLocalData||window.localData||{};
    var employeeRows=Array.isArray(data.employees)?data.employees:[];
    var accountRows=[];
    if(Array.isArray(data.hubAccounts))accountRows=accountRows.concat(data.hubAccounts);
    if(Array.isArray(data.userAccounts))accountRows=accountRows.concat(data.userAccounts);
    if(Array.isArray(data.accounts))accountRows=accountRows.concat(data.accounts);
    var byId={},byCode={},byEmail={},byPhone={},byName={};
    accountRows.forEach(function(a){
      var id=normalizeText(a.employeeId||a.employee_id||a.id),code=employeeCodeOf(a).toLowerCase(),email=employeeEmailOf(a).toLowerCase(),phone=employeePhoneOf(a),name=employeeNameOf(a).toLowerCase();
      if(id)byId[id]=a;if(code)byCode[code]=a;if(email)byEmail[email]=a;if(phone)byPhone[phone]=a;if(name&&!byName[name])byName[name]=a;
    });
    var overrides=loadDepartmentOverrides(),hidden=loadHiddenEmployees(),seen={};
    return employeeRows.map(function(row,index){
      var id=employeeIdOf(row,index),code=employeeCodeOf(row),name=employeeNameOf(row),email=employeeEmailOf(row),phone=employeePhoneOf(row);
      var account=byId[id]||byCode[code.toLowerCase()]||byEmail[email.toLowerCase()]||byPhone[phone]||byName[name.toLowerCase()]||null;
      var mergedCode=code||employeeCodeOf(account),mergedName=name||employeeNameOf(account),department=employeeDepartmentOf(row)||employeeDepartmentOf(account),sourceTitle=employeeTitleOf(row)||employeeTitleOf(account),sourceBranch=employeeBranchOf(row)||employeeBranchOf(account);
      var item={id:id,code:mergedCode,name:mergedName,department:department,title:sourceTitle,branch:sourceBranch,raw:row,account:account};
      var key=departmentKey(item);if(overrides[key])item.department=normalizeText(overrides[key]);
      var titleAssigned=loadTitleAssignments()[titleAssignmentKey(item)];if(titleAssigned&&titleAssigned.title)item.title=normalizeText(titleAssigned.title);
      var branchAssigned=loadBranchAssignments()[branchAssignmentKey(item)];if(branchAssigned&&branchAssigned.branch)item.branch=normalizeText(branchAssigned.branch);
      var managerAssigned=loadManagerAssignments()[managerAssignmentKey(item)];
      item.managerId=normalizeText(managerAssigned&&managerAssigned.managerId);item.managerName=normalizeText(managerAssigned&&managerAssigned.managerName);item.managerCode=normalizeText(managerAssigned&&managerAssigned.managerCode);
      var statusAssigned=loadEmployeeStatusAssignments()[employeeStatusAssignmentKey(item)];item.employeeStatus=normalizeText(statusAssigned&&statusAssigned.status)||'Đang làm việc';
      return item;
    }).filter(function(item){if(!item.name||hidden.indexOf(item.id)>=0||isSystemEmployee(item.raw)||isSystemEmployee(item.account))return false;var key=(item.code||item.id||item.name).toLowerCase();if(seen[key])return false;seen[key]=true;return true;})
      .sort(function(a,b){return a.name.localeCompare(b.name,'vi');});
  }
  function filteredEmployees(){
    var q=normalizeText(peopleUiState.query).toLowerCase();
    return checklistEmployees().filter(function(item){
      if(!q)return true;
      return (item.name+' '+item.code+' '+item.department+' '+item.title+' '+item.branch+' '+item.managerName+' '+item.employeeStatus).toLowerCase().indexOf(q)>=0;
    });
  }
  function peopleStatsHtml(total){
    var assignments=loadFormAssignments(),assigned=checklistEmployees().filter(function(item){return !!assignments[formAssignmentKey(item)];}).length;
    return '<section class="phfck-people-stats">'
      +'<article><span>Tổng nhân sự nền</span><strong>'+total+'</strong><small>Lấy Họ tên và Mã NV từ Hub</small></article>'
      +'<article><span>Đã phân công</span><strong>'+assigned+'</strong><small>Admin đã xác nhận gán mẫu</small></article>'
      +'<article><span>Chưa phân công</span><strong>'+Math.max(0,total-assigned)+'</strong><small>Hệ thống chỉ gợi ý, không tự gán</small></article>'
      +'<article><span>Bộ mẫu chính thức</span><strong>'+CHECKLIST_TEMPLATE_CATALOG.length+'</strong><small>Theo gói nghiệp vụ đã chốt</small></article>'
    +'</section>';
  }
  function peopleInfoCard(label,value,kind){
    var cls='phfck-person-info-card'+(kind?' '+kind:'');
    return '<span class="'+cls+'"><small>'+esc(label)+'</small><b>'+esc(value||'Chưa cập nhật')+'</b></span>';
  }
  function peopleTableHtml(){
    var rows=filteredEmployees();
    var start=(peopleUiState.page-1)*peopleUiState.pageSize;
    if(start>=rows.length){peopleUiState.page=1;start=0;}
    var pageRows=rows.slice(start,start+peopleUiState.pageSize),formAssignments=loadFormAssignments();
    var body=pageRows.map(function(item,index){
      var unlinked=!item.code,accountLinked=!!item.account,assigned=formAssignments[formAssignmentKey(item)]||null,assignedTemplate=assigned&&templateById(assigned.templateId);
      var editButton='<button type="button" class="phfck-table-action phfck-edit-person-button" data-phfck-edit-person="'+esc(item.id)+'">Sửa thông tin</button>';
      var assignButton=!unlinked?'<button type="button" class="phfck-table-action" data-phfck-assign="'+esc(item.id)+'">'+(assigned?'Điều chỉnh form':'Gán form')+'</button>':'';
      var cleanup=unlinked?('<div class="phfck-row-tools"><button type="button" class="phfck-row-menu" data-phfck-person-menu="'+esc(item.id)+'" aria-label="Xử lý hồ sơ '+esc(item.name)+'">⋯</button><div class="phfck-row-menu-pop" data-phfck-person-menu-pop="'+esc(item.id)+'"><button type="button" data-phfck-hide-person="'+esc(item.id)+'">Ẩn khỏi Checklist</button>'+(!accountLinked?'<button type="button" class="is-danger" data-phfck-delete-person="'+esc(item.id)+'">Xóa hồ sơ không liên kết</button>':'')+'</div></div>'):'';
      var orgCards='<div class="phfck-person-info-stack">'
        +peopleInfoCard('Phòng ban',item.department||'Chưa phân phòng ban')
        +peopleInfoCard('Chức danh',item.title||'Chưa gán chức danh')
        +peopleInfoCard('Chi nhánh',item.branch||'Chưa chọn chi nhánh')
        +peopleInfoCard('Quản lý trực tiếp',item.managerName?(item.managerName+(item.managerCode?' · '+item.managerCode:'')):'Chưa chọn cấp trên')
        +peopleInfoCard('Trạng thái',item.employeeStatus||'Đang làm việc','is-status')
      +'</div>';
      return '<tr>'
        +'<td><span class="phfck-row-no">'+(start+index+1)+'</span></td>'
        +'<td><strong class="phfck-fixed-value">'+esc(item.name)+'</strong></td>'
        +'<td><strong class="phfck-employee-code">'+esc(item.code||'Chưa có mã NV')+'</strong></td>'
        +'<td>'+orgCards+'</td>'
        +'<td>'+(assigned?'<span class="phfck-chip phfck-chip-green">Đã phân công</span>':'<span class="phfck-chip phfck-chip-muted">Chưa phân công</span>')+'</td>'
        +'<td>'+(assignedTemplate?'<strong class="phfck-assigned-template">'+esc(assignedTemplate.name)+'</strong>':'<span class="phfck-dash">—</span>')+'</td>'
        +'<td>'+(assigned&&assigned.effectiveDate?'<span>'+esc(assigned.effectiveDate)+'</span>':'<span class="phfck-dash">—</span>')+'</td>'
        +'<td class="phfck-actions-cell"><div class="phfck-person-actions">'+editButton+assignButton+cleanup+'</div></td>'
      +'</tr>';
    }).join('');
    if(!body) body='<tr><td colspan="8"><div class="phfck-table-empty"><b>Không tìm thấy nhân sự</b><span>Thử đổi từ khóa tìm kiếm.</span></div></td></tr>';
    var totalPages=Math.max(1,Math.ceil(rows.length/peopleUiState.pageSize));
    return '<div class="phfck-table-wrap"><table class="phfck-table phfck-people-table phfck-people-card-table"><thead><tr><th>STT</th><th>Họ và tên</th><th>Mã nhân viên</th><th>Thông tin tổ chức</th><th>Trạng thái Checklist</th><th>Mẫu đang áp dụng</th><th>Ngày hiệu lực</th><th>Thao tác</th></tr></thead><tbody>'+body+'</tbody></table></div>'
      +'<div class="phfck-table-foot"><span>Hiển thị '+(rows.length?start+1:0)+'–'+Math.min(start+peopleUiState.pageSize,rows.length)+' / '+rows.length+' nhân sự</span><div><button type="button" data-phfck-page="prev" '+(peopleUiState.page<=1?'disabled':'')+'>←</button><b>'+peopleUiState.page+' / '+totalPages+'</b><button type="button" data-phfck-page="next" '+(peopleUiState.page>=totalPages?'disabled':'')+'>→</button></div></div>';
  }
  function personEditModalHtml(item){
    if(!item)return '';
    var all=checklistEmployees(),departments=departmentOptions(all),titles=titleCatalog(all),branches=branchOptions(all);
    function options(values,current,empty){return '<option value="">'+esc(empty)+'</option>'+values.map(function(x){return '<option value="'+esc(x)+'" '+(x===current?'selected':'')+'>'+esc(x)+'</option>';}).join('');}
    var managers=all.filter(function(x){return x.id!==item.id&&x.code&&x.employeeStatus!=='Nghỉ việc';});
    var managerOptions='<option value="">Chưa chọn quản lý trực tiếp</option>'+managers.map(function(x){return '<option value="'+esc(x.id)+'" '+(x.id===item.managerId?'selected':'')+'>'+esc(x.name)+' · '+esc(x.code)+(x.title?' · '+esc(x.title):'')+'</option>';}).join('');
    var statuses=['Đang làm việc','Thử việc','Tạm nghỉ','Nghỉ việc'];
    var statusOptions=statuses.map(function(x){return '<option value="'+esc(x)+'" '+(x===item.employeeStatus?'selected':'')+'>'+esc(x)+'</option>';}).join('');
    var tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);var iso=tomorrow.getFullYear()+'-'+String(tomorrow.getMonth()+1).padStart(2,'0')+'-'+String(tomorrow.getDate()).padStart(2,'0');
    return '<div class="phfck-modal-layer phfck-edit-layer" data-phfck-person-edit-layer><div class="phfck-modal phfck-person-edit-modal" role="dialog" aria-modal="true">'
      +'<div class="phfck-modal-head"><div><small>THÔNG TIN NHÂN SỰ CHECKLIST</small><h2>Sửa thông tin phân công</h2></div><button type="button" data-phfck-cancel-person-edit aria-label="Đóng">×</button></div>'
      +'<div class="phfck-modal-body"><div class="phfck-selected-person"><span class="phfck-avatar">'+esc(item.name.charAt(0).toUpperCase())+'</span><div><b>'+esc(item.name)+'</b><small>'+esc(item.code||'Chưa có mã nhân viên')+' · Họ tên và Mã NV được cố định từ dữ liệu nền</small></div></div>'
      +'<div class="phfck-person-edit-grid">'
        +'<label><b>Phòng ban</b><select data-phfck-person-field="department">'+options(departments,item.department,'Chưa phân phòng ban')+'</select></label>'
        +'<label><b>Chức danh chính</b><select data-phfck-person-field="title">'+options(titles,item.title,'Chưa gán chức danh')+'</select></label>'
        +'<label><b>Chi nhánh làm việc</b><select data-phfck-person-field="branch">'+options(branches,item.branch,'Chưa chọn chi nhánh')+'</select></label>'
        +'<label><b>Quản lý trực tiếp</b><select data-phfck-person-field="manager">'+managerOptions+'</select><small>Không hiển thị chính nhân sự đang sửa hoặc người đã nghỉ việc.</small></label>'
        +'<label><b>Trạng thái nhân sự</b><select data-phfck-person-field="status">'+statusOptions+'</select></label>'
        +'<label><b>Ngày hiệu lực <em>*</em></b><input type="date" value="'+iso+'" data-phfck-person-field="effectiveDate"></label>'
        +'<label class="phfck-span-2 phfck-reason-field"><b>Lý do thay đổi <em>*</em></b><textarea rows="4" data-phfck-person-field="reason" placeholder="Ví dụ: Điều chuyển bộ phận, bổ nhiệm chức danh, thay đổi cấp quản lý trực tiếp..."></textarea></label>'
      +'</div><div class="phfck-notice"><b>Nguyên tắc áp dụng</b><p>Chỉ các trường được cấp quyền mới có thể chỉnh. Thay đổi có hiệu lực từ ngày đã chọn và được ghi vào Lịch sử thay đổi; Họ tên và Mã nhân viên không thay đổi.</p></div><p class="phfck-inline-error" data-phfck-person-edit-error hidden></p></div>'
      +'<div class="phfck-modal-foot"><button type="button" class="phfck-secondary" data-phfck-cancel-person-edit>Hủy</button><button type="button" class="phfck-primary" data-phfck-save-person-edit="'+esc(item.id)+'">Lưu thay đổi</button></div>'
    +'</div></div>';
  }
  function savePersonEdit(root,id){
    var item=checklistEmployees().find(function(x){return x.id===normalizeText(id);}),modal=root.querySelector('[data-phfck-person-edit-layer]');if(!item||!modal)return;
    function val(name){return normalizeText((modal.querySelector('[data-phfck-person-field="'+name+'"]')||{}).value);}
    var department=val('department'),title=val('title'),branch=val('branch'),managerId=val('manager'),status=val('status')||'Đang làm việc',effectiveDate=val('effectiveDate'),reason=val('reason'),err=modal.querySelector('[data-phfck-person-edit-error]');
    var manager=managerId?checklistEmployees().find(function(x){return x.id===managerId;}):null;
    if(managerId&&(!manager||manager.id===item.id||manager.employeeStatus==='Nghỉ việc')){if(err){err.hidden=false;err.textContent='Quản lý trực tiếp không hợp lệ. Vui lòng chọn lại.';}return;}
    if(!effectiveDate||!reason){if(err){err.hidden=false;err.textContent='Vui lòng nhập Ngày hiệu lực và Lý do thay đổi.';}return;}
    var oldSummary=[item.department||'Chưa phân phòng ban',item.title||'Chưa gán chức danh',item.branch||'Chưa chọn chi nhánh',item.managerName||'Chưa chọn cấp trên',item.employeeStatus||'Đang làm việc'].join(' · ');
    var dept=loadDepartmentOverrides(),dkey=departmentKey(item);if(department)dept[dkey]=department;else delete dept[dkey];saveDepartmentOverrides(dept);
    var titles=loadTitleAssignments(),tkey=titleAssignmentKey(item);titles[tkey]={title:title,effectiveDate:effectiveDate,reason:reason,previousTitle:item.title||'',updatedAt:new Date().toISOString()};saveTitleAssignments(titles);
    var branches=loadBranchAssignments(),bkey=branchAssignmentKey(item);branches[bkey]={branch:branch,effectiveDate:effectiveDate,reason:reason,previousBranch:item.branch||'',updatedAt:new Date().toISOString()};saveBranchAssignments(branches);
    var managers=loadManagerAssignments(),mkey=managerAssignmentKey(item);managers[mkey]={managerId:manager?manager.id:'',managerName:manager?manager.name:'',managerCode:manager?manager.code:'',effectiveDate:effectiveDate,reason:reason,previousManagerId:item.managerId||'',previousManagerName:item.managerName||'',updatedAt:new Date().toISOString()};saveManagerAssignments(managers);
    var statuses=loadEmployeeStatusAssignments(),skey=employeeStatusAssignmentKey(item);statuses[skey]={status:status,effectiveDate:effectiveDate,reason:reason,previousStatus:item.employeeStatus||'Đang làm việc',updatedAt:new Date().toISOString()};saveEmployeeStatusAssignments(statuses);
    var newSummary=[department||'Chưa phân phòng ban',title||'Chưa gán chức danh',branch||'Chưa chọn chi nhánh',manager?manager.name:'Chưa chọn cấp trên',status].join(' · ');
    addAudit({action:'Cập nhật thông tin phân công nhân sự',area:'Nhân sự & phân công',object:item.name+' · '+(item.code||item.id),source:'Web',impact:'Một nhân sự',version:'Không đổi',reason:oldSummary+' → '+newSummary+'; hiệu lực '+effectiveDate+'; '+reason});
    peopleUiState.editingId='';refreshPeopleWorkspace(root);if(window.phfNotice)window.phfNotice('Đã lưu thông tin phân công của '+item.name+' và ghi lịch sử thay đổi.');
  }
  function branchChangeModalHtml(item,newBranch){
    if(!item)return '';
    var tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);var iso=tomorrow.getFullYear()+'-'+String(tomorrow.getMonth()+1).padStart(2,'0')+'-'+String(tomorrow.getDate()).padStart(2,'0');
    return '<div class="phfck-modal-layer phfck-edit-layer" data-phfck-branch-submodal><div class="phfck-modal" role="dialog" aria-modal="true"><div class="phfck-modal-head"><div><small>ĐIỀU CHỈNH CHI NHÁNH</small><h2>Cập nhật nơi làm việc</h2></div><button type="button" data-phfck-cancel-branch-change aria-label="Đóng">×</button></div><div class="phfck-modal-body"><div class="phfck-selected-person"><span class="phfck-avatar">'+esc(item.name.charAt(0).toUpperCase())+'</span><div><b>'+esc(item.name)+'</b><small>'+esc(item.code||'Chưa có mã nhân viên')+'</small></div></div><div class="phfck-compare-grid"><div><small>Chi nhánh hiện tại</small><b>'+esc(item.branch||'Chưa chọn')+'</b></div><div><small>Chi nhánh mới</small><b>'+esc(newBranch||'Chưa chọn')+'</b></div></div><div class="phfck-form-grid"><label><b>Ngày hiệu lực <em>*</em></b><input type="date" value="'+iso+'" data-phfck-branch-effective></label><label class="phfck-span-2 phfck-reason-field"><b>Lý do thay đổi <em>*</em></b><textarea rows="4" placeholder="Ví dụ: Điều chuyển nơi làm việc, hỗ trợ chi nhánh..." data-phfck-branch-reason></textarea></label></div><div class="phfck-notice"><b>Nguyên tắc áp dụng</b><p>Chi nhánh mới chỉ có hiệu lực từ ngày đã chọn. Dữ liệu trước ngày hiệu lực vẫn giữ theo nơi làm việc cũ.</p></div><p class="phfck-inline-error" data-phfck-branch-error hidden></p></div><div class="phfck-modal-foot"><button type="button" class="phfck-secondary" data-phfck-cancel-branch-change>Hủy</button><button type="button" class="phfck-primary" data-phfck-confirm-branch-change>Xác nhận thay đổi</button></div></div></div>';
  }
  function cancelBranchChange(root){
    if(pendingBranchChange){var selects=root.querySelectorAll('[data-phfck-branch]');for(var i=0;i<selects.length;i++){if(selects[i].getAttribute('data-phfck-branch')===pendingBranchChange.id){selects[i].value=pendingBranchChange.oldBranch||'';break;}}}
    pendingBranchChange=null;var modal=root.querySelector('[data-phfck-branch-submodal]');if(modal)modal.remove();syncChecklistModalScrollLock();
  }
  function confirmBranchChange(root){
    if(!pendingBranchChange)return;
    var date=(root.querySelector('[data-phfck-branch-effective]')||{}).value||'',reason=normalizeText((root.querySelector('[data-phfck-branch-reason]')||{}).value),err=root.querySelector('[data-phfck-branch-error]');
    if(!date||!reason){if(err){err.hidden=false;err.textContent='Vui lòng nhập Ngày hiệu lực và Lý do thay đổi.';}return;}
    var assignments=loadBranchAssignments();assignments[pendingBranchChange.key]={branch:pendingBranchChange.newBranch,effectiveDate:date,reason:reason,previousBranch:pendingBranchChange.oldBranch,updatedAt:new Date().toISOString()};saveBranchAssignments(assignments);
    addAudit({action:'Điều chỉnh chi nhánh làm việc',area:'Nhân sự & phân công',object:pendingBranchChange.name+' · '+(pendingBranchChange.code||pendingBranchChange.id),source:'Web',impact:'Một nhân sự',version:'Không đổi',reason:(pendingBranchChange.oldBranch||'Chưa chọn')+' → '+(pendingBranchChange.newBranch||'Chưa chọn')+'; hiệu lực '+date+'; '+reason});
    pendingBranchChange=null;var modal=root.querySelector('[data-phfck-branch-submodal]');if(modal)modal.remove();refreshPeopleWorkspace(root);if(window.phfNotice)window.phfNotice('Đã cập nhật chi nhánh theo ngày hiệu lực đã chọn.');
  }
  function titleChangeModalHtml(item,newTitle){
    if(!item)return '';
    var tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);var iso=tomorrow.getFullYear()+'-'+String(tomorrow.getMonth()+1).padStart(2,'0')+'-'+String(tomorrow.getDate()).padStart(2,'0');
    return '<div class="phfck-modal-layer phfck-edit-layer" data-phfck-submodal><div class="phfck-modal" role="dialog" aria-modal="true"><div class="phfck-modal-head"><div><small>ĐIỀU CHỈNH CHỨC DANH</small><h2>Cập nhật chức danh chính</h2></div><button type="button" data-phfck-cancel-title-change aria-label="Đóng">×</button></div><div class="phfck-modal-body"><div class="phfck-selected-person"><span class="phfck-avatar">'+esc(item.name.charAt(0).toUpperCase())+'</span><div><b>'+esc(item.name)+'</b><small>'+esc(item.code||'Chưa có mã nhân viên')+'</small></div></div><div class="phfck-compare-grid"><div><small>Chức danh hiện tại</small><b>'+esc(item.title||'Chưa gán')+'</b></div><div><small>Chức danh mới</small><b>'+esc(newTitle||'Chưa gán')+'</b></div></div><div class="phfck-form-grid"><label><b>Ngày hiệu lực <em>*</em></b><input type="date" value="'+iso+'" data-phfck-title-effective></label><label class="phfck-span-2"><b>Lý do thay đổi <em>*</em></b><textarea rows="3" placeholder="Ví dụ: Điều chuyển vị trí, bổ nhiệm, thay đổi cơ cấu..." data-phfck-title-reason></textarea></label></div><div class="phfck-notice"><b>Nguyên tắc áp dụng</b><p>Chức danh mới chỉ có hiệu lực từ ngày đã chọn. Phiếu và lịch sử trước ngày hiệu lực vẫn giữ theo chức danh cũ. Mẫu Checklist sẽ được gợi ý sau, không tự đổi ngay ở bước này.</p></div><p class="phfck-inline-error" data-phfck-title-error hidden></p></div><div class="phfck-modal-foot"><button type="button" class="phfck-secondary" data-phfck-cancel-title-change>Hủy</button><button type="button" class="phfck-primary" data-phfck-confirm-title-change>Xác nhận thay đổi</button></div></div></div>';
  }
  function cancelTitleChange(root){
    if(pendingTitleChange){var selects=root.querySelectorAll('[data-phfck-title]');for(var i=0;i<selects.length;i++){if(selects[i].getAttribute('data-phfck-title')===pendingTitleChange.id){selects[i].value=pendingTitleChange.oldTitle||'';break;}}}
    pendingTitleChange=null;var modal=root.querySelector('[data-phfck-submodal]');if(modal)modal.remove();syncChecklistModalScrollLock();
  }
  function confirmTitleChange(root){
    if(!pendingTitleChange)return;
    var date=(root.querySelector('[data-phfck-title-effective]')||{}).value||'',reason=normalizeText((root.querySelector('[data-phfck-title-reason]')||{}).value),err=root.querySelector('[data-phfck-title-error]');
    if(!date||!reason){if(err){err.hidden=false;err.textContent='Vui lòng nhập Ngày hiệu lực và Lý do thay đổi.';}return;}
    var assignments=loadTitleAssignments();assignments[pendingTitleChange.key]={title:pendingTitleChange.newTitle,effectiveDate:date,reason:reason,previousTitle:pendingTitleChange.oldTitle,updatedAt:new Date().toISOString()};saveTitleAssignments(assignments);
    addAudit({action:'Điều chỉnh chức danh chính',area:'Nhân sự & phân công',object:pendingTitleChange.name+' · '+(pendingTitleChange.code||pendingTitleChange.id),source:'Web',impact:'Một nhân sự',version:'Không đổi',reason:(pendingTitleChange.oldTitle||'Chưa gán')+' → '+(pendingTitleChange.newTitle||'Chưa gán')+'; hiệu lực '+date+'; '+reason});
    pendingTitleChange=null;var modal=root.querySelector('[data-phfck-submodal]');if(modal)modal.remove();syncChecklistModalScrollLock();refreshPeopleWorkspace(root);if(window.phfNotice)window.phfNotice('Đã cập nhật chức danh chính và ghi lịch sử thay đổi.');
  }
  function assignmentModalHtml(item){
    if(!item)return '';
    var existing=loadFormAssignments()[formAssignmentKey(item)]||null,suggestion=suggestChecklistTemplate(item),selected=(existing&&existing.templateId)||suggestion.templateId||'';
    var options=CHECKLIST_TEMPLATE_OPTIONS.map(function(x){return '<option value="'+esc(x[0])+'" '+(selected===x[0]?'selected':'')+'>'+esc(x[1])+'</option>';}).join('');
    var today=new Date();var iso=(existing&&existing.effectiveDate)||today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
    var suggestionHtml=suggestion.template?'<div class="phfck-suggestion-card"><div><small>MẪU HỆ THỐNG GỢI Ý</small><b>'+esc(suggestion.template.name)+'</b><p>'+esc(suggestion.reason)+'</p></div><span>Gợi ý</span></div>':'<div class="phfck-suggestion-card is-empty"><div><small>CHƯA THỂ GỢI Ý</small><b>Cần Admin chọn thủ công</b><p>'+esc(suggestion.reason)+'</p></div></div>';
    return '<div class="phfck-modal-layer" data-phfck-modal-layer><div class="phfck-modal" role="dialog" aria-modal="true" aria-labelledby="phfckAssignTitle">'
      +'<div class="phfck-modal-head"><div><small>PHÂN CÔNG CHECKLIST</small><h2 id="phfckAssignTitle">'+(existing?'Điều chỉnh form':'Gán form cho nhân sự')+'</h2></div><button type="button" data-phfck-close-modal aria-label="Đóng">×</button></div>'
      +'<div class="phfck-modal-body"><div class="phfck-selected-person"><span class="phfck-avatar">'+esc(item.name.charAt(0).toUpperCase())+'</span><div><b>'+esc(item.name)+'</b><small>'+esc(item.code||'Chưa có mã nhân viên')+' · '+esc(item.department||'Chưa có phòng ban')+' · '+esc(item.title||'Chưa có chức danh')+'</small></div></div>'
      +suggestionHtml
      +'<div class="phfck-form-grid"><label><b>Mẫu Checklist <em>*</em></b><select data-phfck-field="template"><option value="">Chọn bộ mẫu áp dụng</option>'+options+'</select><small>Admin có thể giữ mẫu gợi ý hoặc chọn mẫu khác.</small></label><label><b>Ngày hiệu lực <em>*</em></b><input type="date" value="'+esc(iso)+'" data-phfck-field="effectiveDate"></label><label><b>Người thẩm định</b><select data-phfck-field="reviewer"><option value="">Chọn sau khi cấu hình quyền</option></select></label><label><b>Phạm vi ghi nhận lỗi</b><select data-phfck-field="scope"><option value="assigned" '+(!existing||existing.scope==='assigned'?'selected':'')+'>Theo phạm vi Admin phân công</option><option value="cross-check" '+(existing&&existing.scope==='cross-check'?'selected':'')+'>Kiểm tra chéo được cấp quyền</option></select></label><label class="phfck-span-2 phfck-reason-field"><b>Lý do gán/điều chỉnh <em>*</em></b><textarea rows="3" data-phfck-field="reason" placeholder="Ví dụ: Gán theo chức danh hiện tại; điều chuyển mẫu từ ngày...">'+esc(existing&&existing.reason||'')+'</textarea></label></div>'
      +'<div class="phfck-notice"><b>Nguyên tắc đã chốt</b><p>Hệ thống chỉ gợi ý dựa trên Phòng ban và Chức danh chính. Mẫu chỉ được áp dụng sau khi Admin bấm xác nhận; không tự gán âm thầm.</p></div><p class="phfck-inline-error" data-phfck-assignment-error hidden></p>'
      +'</div><div class="phfck-modal-foot"><button type="button" class="phfck-secondary" data-phfck-close-modal>Đóng</button><button type="button" class="phfck-primary" data-phfck-confirm-assignment="'+esc(item.id)+'">'+(existing?'Xác nhận điều chỉnh':'Xác nhận gán form')+'</button></div>'
    +'</div></div>';
  }
  function confirmFormAssignment(root,id,button){
    var item=checklistEmployees().find(function(x){return x.id===normalizeText(id);}),modal=button&&button.closest('[data-phfck-modal-layer]');
    if(!item||!modal)return;
    var templateId=normalizeText((modal.querySelector('[data-phfck-field="template"]')||{}).value),effectiveDate=(modal.querySelector('[data-phfck-field="effectiveDate"]')||{}).value||'',scope=(modal.querySelector('[data-phfck-field="scope"]')||{}).value||'assigned',reason=normalizeText((modal.querySelector('[data-phfck-field="reason"]')||{}).value),err=modal.querySelector('[data-phfck-assignment-error]'),template=templateById(templateId);
    if(!templateId||!template||!effectiveDate||!reason){if(err){err.hidden=false;err.textContent='Vui lòng chọn Mẫu Checklist, Ngày hiệu lực và nhập Lý do.';}return;}
    var all=loadFormAssignments(),key=formAssignmentKey(item),previous=all[key]||null;
    all[key]={templateId:templateId,effectiveDate:effectiveDate,scope:scope,reason:reason,department:item.department||'',title:item.title||'',suggestedTemplateId:suggestChecklistTemplate(item).templateId||'',updatedAt:new Date().toISOString()};
    if(!saveFormAssignments(all)){if(err){err.hidden=false;err.textContent='Không lưu được phân công trong trình duyệt.';}return;}
    addAudit({action:previous?'Điều chỉnh mẫu Checklist':'Gán mẫu Checklist',area:'Nhân sự & phân công',object:item.name+' · '+(item.code||item.id),source:'Web',impact:'Một nhân sự',version:'Không đổi',reason:(previous&&templateById(previous.templateId)?templateById(previous.templateId).name+' → ':'')+template.name+'; hiệu lực '+effectiveDate+'; '+reason});
    peopleUiState.selectedId='';refreshPeopleWorkspace(root);if(window.phfNotice)window.phfNotice('Đã xác nhận '+(previous?'điều chỉnh':'gán')+' mẫu '+template.name+' cho '+item.name+'.');
  }
  function peopleHtml(){
    if(!checklistPeopleDataReady())return peopleLoadingHtml(false);
    var total=checklistEmployees().length;
    return '<div class="phfck-page-head phfck-people-head"><div><small>PHF CHECKLIST · ADMIN</small><h1>Nhân sự & phân công</h1><p>Lấy đúng Họ tên và Mã nhân viên từ Hub; Admin chủ động gán mẫu, ngày hiệu lực và phạm vi nghiệp vụ Checklist.</p></div><button class="phfck-primary" type="button" data-phfck-bulk-assign>＋ Phân công hàng loạt</button></div>'
      +peopleStatsHtml(total)
      +'<section class="phfck-panel phfck-people-panel"><div class="phfck-list-toolbar"><div class="phfck-search"><span>⌕</span><input type="search" placeholder="Tìm theo họ tên, mã nhân viên, phòng ban, chức danh hoặc quản lý trực tiếp" value="'+esc(peopleUiState.query)+'" data-phfck-people-search></div><div class="phfck-filter-note"><span class="phfck-dot"></span>Dữ liệu nền từ Hub</div></div><div data-phfck-people-table>'+peopleTableHtml()+'</div></section>'
      +(peopleUiState.selectedId?assignmentModalHtml(checklistEmployees().find(function(x){return x.id===peopleUiState.selectedId;})):'')
      +(peopleUiState.editingId?personEditModalHtml(checklistEmployees().find(function(x){return x.id===peopleUiState.editingId;})):'');
  }
  function refreshPeopleWorkspace(root){
    var workspace=root.querySelector('[data-phfck-workspace]');
    if(workspace&&adminViewFromPath(location.pathname)==='people') workspace.innerHTML=peopleHtml();
  }

  function unlinkedEmployeeById(id){return checklistEmployees().find(function(x){return x.id===normalizeText(id);})||null;}
  function deleteUnlinkedEmployeeModalHtml(item){
    if(!item)return '';
    return '<div class="phfck-modal-layer phfck-edit-layer" data-phfck-submodal><div class="phfck-modal phfck-cleanup-modal" role="dialog" aria-modal="true"><div class="phfck-modal-head"><div><small>DỌN HỒ SƠ CHƯA LIÊN KẾT</small><h2>Xóa hồ sơ '+esc(item.name)+'</h2></div><button type="button" data-phfck-close-submodal aria-label="Đóng">×</button></div><div class="phfck-modal-body"><div class="phfck-danger-notice"><b>Chỉ dùng cho dữ liệu test hoặc hồ sơ rác</b><p>Hệ thống chỉ cho xóa khi hồ sơ không có Mã nhân viên PHF và không có tài khoản liên kết. Dữ liệu phát sinh theo hồ sơ này sẽ bị xóa khỏi Hub/Classroom.</p></div><dl class="phfck-cleanup-info"><div><dt>Họ và tên</dt><dd>'+esc(item.name)+'</dd></div><div><dt>Mã hồ sơ</dt><dd>'+esc(item.id)+'</dd></div><div><dt>Mã nhân viên</dt><dd>Chưa có</dd></div><div><dt>Tài khoản liên kết</dt><dd>Không có</dd></div></dl><label class="phfck-confirm-check"><input type="checkbox" data-phfck-delete-confirm-check><span>Tôi xác nhận đây là hồ sơ test/rác và đồng ý xóa dữ liệu liên quan.</span></label><p class="phfck-inline-error" data-phfck-delete-error hidden></p></div><div class="phfck-modal-foot"><button type="button" class="phfck-secondary" data-phfck-close-submodal>Hủy</button><button type="button" class="phfck-danger-button" data-phfck-confirm-delete-person="'+esc(item.id)+'" disabled>Xóa hồ sơ</button></div></div></div>';
  }
  async function deleteUnlinkedEmployee(root,id,button){
    var item=unlinkedEmployeeById(id),errorEl=root.querySelector('[data-phfck-delete-error]');
    if(!item){if(errorEl){errorEl.hidden=false;errorEl.textContent='Không còn tìm thấy hồ sơ này.';}return;}
    if(item.code||item.account){if(errorEl){errorEl.hidden=false;errorEl.textContent='Hồ sơ đã có mã nhân viên hoặc tài khoản liên kết nên không được xóa tại Checklist.';}return;}
    if(button){button.disabled=true;button.textContent='Đang kiểm tra và xóa...';}
    try{
      var response=await fetch('/api/data',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'deleteEmployee',adminMode:true,cleanupUnlinkedEmployee:true,employee:{id:item.id,fullName:item.name}})});
      var result=await response.json().catch(function(){return {};});
      if(!response.ok||result.ok===false)throw new Error(result.message||'Không thể xóa hồ sơ.');
      if(result.data){window.__phfLocalData=result.data;window.localData=result.data;}
      else{
        var data=window.__phfLocalData||window.localData||{};
        if(Array.isArray(data.employees))data.employees=data.employees.filter(function(x){return employeeIdOf(x)!==item.id;});
      }
      addAudit({action:'Xóa hồ sơ chưa liên kết',area:'Nhân sự & phân công',object:item.name+' · '+item.id,source:'Web',impact:'Một hồ sơ',version:'Không đổi',reason:'Admin xác nhận dữ liệu test/rác; hồ sơ không có mã PHF và không có tài khoản liên kết.'});
      var sub=root.querySelector('[data-phfck-submodal]');if(sub)sub.remove();
      refreshPeopleWorkspace(root);
      if(window.phfNotice)window.phfNotice('Đã xóa hồ sơ chưa liên kết '+item.name+'.');
    }catch(err){
      if(errorEl){errorEl.hidden=false;errorEl.textContent=err&&err.message?err.message:'Không thể xóa hồ sơ.';}
      if(button){button.disabled=false;button.textContent='Xóa hồ sơ';}
    }
  }

  function filteredTemplates(){
    var q=normalizeText(templateUiState.query).toLowerCase();
    return CHECKLIST_TEMPLATE_CATALOG.filter(function(item){
      if(templateUiState.group!=='all'&&item.group!==templateUiState.group)return false;
      if(!q)return true;
      return (item.name+' '+item.group+' '+item.source+' '+item.note).toLowerCase().indexOf(q)>=0;
    });
  }
  function criteriaCount(groups){var n=0;(groups||[]).forEach(function(g){g.children.forEach(function(c){n+=c.items.length;});});return n;}
  function salesCriteriaCount(){return criteriaCount(SALES_TEMPLATE_GROUPS);}
  function shiftLeadCriteriaCount(){return criteriaCount(SHIFT_LEAD_TEMPLATE_GROUPS);}
  function warehouseCriteriaCount(){return criteriaCount(WAREHOUSE_TEMPLATE_GROUPS);}
  function warehouseManagerCriteriaCount(){return criteriaCount(WAREHOUSE_MANAGER_TEMPLATE_GROUPS);}
  function templateStatsHtml(){
    var withChecklist=CHECKLIST_TEMPLATE_CATALOG.filter(function(x){return x.hasChecklist;}).length;
    return '<section class="phfck-template-stats">'
      +'<article><span>Bộ mẫu nguồn</span><strong>'+CHECKLIST_TEMPLATE_CATALOG.length+'</strong><small>Theo gói bàn giao đã chốt</small></article>'
      +'<article><span>Có cơ chế Checklist</span><strong>'+withChecklist+'</strong><small>Có tiêu chí ghi lỗi và hệ số</small></article>'
      +'<article><span>Đã chuẩn hóa</span><strong>10</strong><small>4 mẫu vận hành + 3 mẫu Trợ lý + 2 mẫu Marketing + 1 mẫu HCNS</small></article>'
      +'<article><span>Tiêu chí TBP Kho</span><strong>'+warehouseManagerCriteriaCount()+'</strong><small>Kế thừa Nhân viên Kho + 9 tiêu chí quản lý bộ phận</small></article>'
    +'</section>';
  }
  function templateCardsHtml(){
    var rows=filteredTemplates();
    if(!rows.length)return '<div class="phfck-template-empty"><div>▤</div><b>Không tìm thấy bộ mẫu</b><p>Thử đổi từ khóa hoặc nhóm phòng ban.</p></div>';
    return '<div class="phfck-template-grid">'+rows.map(function(item,index){
      var ready=item.id==='nv-ban-hang'||item.id==='truong-ca-ban-hang'||item.id==='nv-kho'||item.id==='tbp-kho'||!!ASSISTANT_TEMPLATE_CONFIGS[item.id];
      var readyVersion=ASSISTANT_TEMPLATE_CONFIGS[item.id]?ASSISTANT_TEMPLATE_CONFIGS[item.id].version:(item.id==='truong-ca-ban-hang'?'TCP-BH-1.0':(item.id==='nv-kho'?'NVK-1.0':(item.id==='tbp-kho'?'TBP-KHO-1.0':'BH-1.0')));
      return '<article class="phfck-template-card '+(ready?'is-ready':'')+'">'
        +'<div class="phfck-template-card-top"><span class="phfck-template-index">'+String(index+1).padStart(2,'0')+'</span><span class="phfck-template-state">'+(ready?'Đã chuẩn hóa':'Nguồn đã chốt')+'</span></div>'
        +'<div class="phfck-template-icon" aria-hidden="true">▤</div>'
        +'<small>'+esc(item.group)+'</small><h3>'+esc(item.name)+'</h3><p>'+esc(item.source)+'</p>'
        +'<div class="phfck-template-meta"><span class="'+(item.hasChecklist?'is-on':'is-off')+'">'+(item.hasChecklist?'Có Checklist lỗi':'Chưa có TCCV riêng')+'</span><span>'+(ready?readyVersion:'Phiếu tháng')+'</span></div>'
        +'<div class="phfck-template-card-foot"><span>'+(ready?'Hiệu lực 01/08/2026':'Hiệu lực: Chưa phát hành')+'</span><button type="button" data-phfck-template-detail="'+esc(item.id)+'">'+(ready?'Quản lý mẫu':'Xem cấu trúc')+'</button></div>'
      +'</article>';
    }).join('')+'</div>';
  }
  function templateTreeHtml(groups){
    return '<div class="phfck-sales-tree">'+(groups||SALES_TEMPLATE_GROUPS).map(function(group){
      var groupCount=0;group.children.forEach(function(c){groupCount+=c.items.length;});
      return '<section class="phfck-sales-group"><div class="phfck-sales-group-head"><div><small>NHÓM CHA · '+esc(group.code)+'</small><h3>'+esc(group.name)+'</h3></div><span>'+groupCount+' tiêu chí</span></div>'
        +group.children.map(function(child){return '<details class="phfck-sales-child" open><summary><div><b>'+esc(child.name)+'</b><small>'+esc(child.code)+'</small></div><span>'+child.items.length+'</span></summary><div class="phfck-sales-criteria">'
          +child.items.map(function(item){return '<article><code>'+esc(item[0])+'</code><p>'+esc(item[1])+'</p><strong>Hệ số '+esc(item[2])+'</strong><span>Minh chứng: Khuyến khích</span><button type="button" class="phfck-criterion-edit" data-phfck-edit-criterion="'+esc(item[0])+'">Sửa</button></article>';}).join('')
        +'</div></details>';}).join('')
      +'</section>';
    }).join('')+'</div>';
  }
  function salesTemplateTreeHtml(){return templateTreeHtml(selectedTemplateGroups());}
  function shiftLeadTemplateTreeHtml(){return templateTreeHtml(selectedTemplateGroups());}
  function warehouseTemplateTreeHtml(){return templateTreeHtml(selectedTemplateGroups());}
  function warehouseManagerTemplateTreeHtml(){return templateTreeHtml(selectedTemplateGroups());}
  function assistantTemplateTreeHtml(config){return templateTreeHtml(selectedTemplateGroups());}
  function overrideTotalScoreHtml(templateId,title,policy){var rows=effectiveTotalRows(templateId),totalWeight=rows.reduce(function(n,r){return n+Number(r[5]||0);},0);return '<div class="phfck-total-score"><div class="phfck-total-intro"><div><small>BẢNG TỔNG ĐIỂM · PHIÊN BẢN CẬP NHẬT</small><h3>'+esc(title)+'</h3><p>Dữ liệu được cập nhật từ file Excel hàng loạt và chỉ áp dụng theo phiên bản mới.</p></div><span class="phfck-total-policy-chip">'+esc(policy||effectiveTemplateVersion(templateId))+'</span></div><div class="phfck-total-formula-banner"><span>CÁCH TÍNH</span><strong>(Thực đạt × 1 + Thẩm định × 2) ÷ 3</strong><p>Sau đó hệ thống quy đổi theo trọng số từng chỉ tiêu.</p></div><div class="phfck-total-scroll-top" data-phfck-total-scroll-top><div></div></div><div class="phfck-total-table-wrap" data-phfck-total-scroll-main><table class="phfck-total-table"><thead><tr><th>STT</th><th>Nội dung đánh giá</th><th>Mục tiêu</th><th>Trọng số</th><th>Nguồn kết quả</th><th>Ghi chú</th></tr></thead><tbody>'+rows.map(function(r,i){return '<tr><td>'+(i+1)+'</td><td><b>'+esc(r[2])+'</b>'+(r[6]==='Có'?'<span class="phfck-monthly-plan-tag">Thay đổi theo kế hoạch tháng</span>':'')+'</td><td>'+esc(String(r[3])+' '+String(r[4]||''))+'</td><td><span class="phfck-total-weight">'+Number(r[5])+'%</span></td><td>'+esc(r[7]||'Nhập đánh giá')+'</td><td>Áp dụng từ phiên bản '+esc(effectiveTemplateVersion(templateId))+'</td></tr>';}).join('')+'<tr class="phfck-total-final"><td></td><td><b>Tổng trọng số</b></td><td></td><td><strong>'+totalWeight+'%</strong></td><td></td><td><span class="phfck-result-chip '+(Math.abs(totalWeight-100)<0.001?'is-pass':'is-fail')+'">'+(Math.abs(totalWeight-100)<0.001?'Hợp lệ':'Cần điều chỉnh')+'</span></td></tr></tbody></table></div></div>';}
  function assistantTotalScoreHtml(config){
    var rows=config.rows||[];
    var totalWeight=rows.reduce(function(n,r){return n+Number(r[2]||0);},0);
    return '<div class="phfck-total-score">'
      +'<div class="phfck-total-intro"><div><small>BẢNG TỔNG ĐIỂM · GIỮ NGUYÊN FILE GỐC</small><h3>'+esc(config.title)+'</h3><p>Mỗi dòng đi theo 3 bước: <b>Thực đạt ×1</b> → <b>Thẩm định ×2</b> → <b>Điểm sau tỷ lệ 1:2</b>, rồi mới quy đổi theo trọng số.</p></div><span class="phfck-total-policy-chip">'+esc(config.policy)+'</span></div>'
      +'<div class="phfck-total-formula-banner"><span>CÁCH TÍNH DỄ HIỂU</span><strong>(Thực đạt × 1 + Thẩm định × 2) ÷ 3</strong><p>Ví dụ đang hiển thị mức hoàn thành đủ mục tiêu để người dùng dễ đối chiếu. Khi nối dữ liệu thật, từng dòng sẽ lấy số thực tế tương ứng.</p></div>'
      +'<div class="phfck-total-scroll-top" data-phfck-total-scroll-top><div></div></div><div class="phfck-total-table-wrap" data-phfck-total-scroll-main><table class="phfck-total-table"><thead><tr><th>STT</th><th>Nội dung đánh giá</th><th>Mục tiêu</th><th>Trọng số</th><th>Thực đạt ×1</th><th>Thẩm định ×2</th><th>Sau tỷ lệ 1:2</th><th>Điểm được tính</th><th>Giải thích</th></tr></thead><tbody>'
      +rows.map(function(r,i){var target=Number(r[1]);var weight=Number(r[2]);var unit=(target===100?' điểm':(target<=7?'':' điểm'));var customUnit=r[4]||'';var targetText=target+(customUnit?' '+customUnit:(target===100?' điểm':(r[0].toLowerCase().indexOf('phiếu')>=0?' phiếu':(r[0].toLowerCase().indexOf('đào tạo')>=0||r[0].toLowerCase().indexOf('tái đào tạo')>=0?' buổi/ngày':' điểm'))));var actual=target+'/'+target;var explain='Thực đạt '+actual+' và Thẩm định '+actual+'. Điểm sau tỷ lệ 1:2 vẫn là '+actual+'. Chỉ tiêu chiếm '+weight+'% nên được tính đủ '+weight+' điểm.';return '<tr><td>'+(i+1)+'</td><td><b>'+esc(r[0])+'</b>'+(r[3]==='monthly'?'<span class="phfck-monthly-plan-tag">Thay đổi theo kế hoạch tháng</span>':'')+'</td><td><span class="phfck-total-target">'+esc(targetText)+'</span></td><td><span class="phfck-total-weight">'+weight+'%</span></td><td><strong>'+actual+'</strong><small class="phfck-total-sub">Nhân viên/nguồn tự động</small></td><td><strong>'+actual+'</strong><small class="phfck-total-sub">Cấp trên thẩm định</small></td><td><strong class="phfck-total-reviewed">'+actual+'</strong></td><td><strong class="phfck-total-score-value">'+weight+' điểm</strong></td><td><button type="button" class="phfck-total-info" data-phfck-total-explain="'+esc(explain)+'" aria-expanded="false" aria-label="Mở giải thích cách tính">!</button></td></tr>';}).join('')
      +'<tr class="phfck-total-final"><td></td><td><b>Tổng kết quả</b></td><td></td><td><strong>'+totalWeight+'%</strong></td><td></td><td></td><td></td><td><strong>100 điểm</strong></td><td><span class="phfck-result-chip is-pass">Đạt</span></td></tr></tbody></table></div>'
      +(rows.some(function(r){return r[3]==='monthly';})?'<div class="phfck-monthly-plan-note"><b>Chỉ tiêu thay đổi theo kế hoạch tháng</b><p>Cuối tháng, TBP Marketing được cập nhật tên nội dung, mục tiêu và kết quả cho kỳ đánh giá tiếp theo. Mọi thay đổi chỉ áp dụng theo tháng/phiên bản mới và không làm thay đổi phiếu đã chốt.</p></div>':'')+'<div class="phfck-hqcv-policy"><div><small>QUY ĐỊNH XẾP LOẠI & THƯỞNG HQCV</small><h4>Áp dụng theo tỷ lệ kết quả cuối tháng</h4></div><div class="phfck-hqcv-level is-pass"><b>90% – 100%</b><span>Đạt</span><small>Nhận 100% mức thưởng HQCV</small></div><div class="phfck-hqcv-level is-warning"><b>60% – dưới 90%</b><span>Chưa đạt</span><small>Thưởng HQCV × tỷ lệ kết quả</small></div><div class="phfck-hqcv-level is-fail"><b>Dưới 60%</b><span>Không đạt</span><small>0% thưởng HQCV</small></div></div>'
      +'<div class="phfck-total-cards"><article><span>Tổng chỉ tiêu</span><strong>'+rows.length+'</strong><small>Giữ đúng số dòng trong file nguồn.</small></article><article><span>Tổng trọng số</span><strong>'+totalWeight+'%</strong><small>Đã kiểm tra đủ 100%.</small></article><article><span>Tỷ lệ thưởng HQCV</span><strong>100%</strong><small>Ví dụ đang hiển thị kết quả đủ 100 điểm.</small></article></div>'
      +'<div class="phfck-total-admin-note"><div><b>Thiết lập công thức dành cho Admin</b><p>Thay đổi mục tiêu hoặc trọng số phải tạo phiên bản mới. Phiếu tháng cũ giữ nguyên công thức và kết quả đã áp dụng.</p></div><button type="button" class="phfck-secondary" data-phfck-total-formula>Thiết lập công thức</button></div>'
    +'</div>';
  }
  function assistantTemplateDetailHtml(item){
    var config=ASSISTANT_TEMPLATE_CONFIGS[item.id];if(!config)return '';var override=loadBulkOverride(item.id);var shownVersion=override&&override.version?override.version:config.version;
    return '<div class="phfck-modal-layer phfck-sales-layer" data-phfck-modal-layer><div class="phfck-modal phfck-template-modal phfck-sales-modal '+(templateUiState.salesFullscreen?'is-fullscreen':'')+'" role="dialog" aria-modal="true" aria-labelledby="phfckTemplateTitle">'
      +'<div class="phfck-modal-head"><div><small>MẪU CHECKLIST ĐÃ CHUẨN HÓA</small><h2 id="phfckTemplateTitle">'+esc(config.title)+'</h2></div><div class="phfck-modal-head-actions"><button type="button" data-phfck-toggle-sales-fullscreen aria-label="'+(templateUiState.salesFullscreen?'Thu nhỏ':'Phóng to')+'" title="'+(templateUiState.salesFullscreen?'Thu nhỏ khung':'Mở toàn màn hình')+'">'+(templateUiState.salesFullscreen?'↙':'⛶')+'</button><button type="button" data-phfck-close-modal aria-label="Đóng">×</button></div></div>'
      +'<div class="phfck-template-tabs phfck-template-tabs-fixed"><button class="'+(templateUiState.salesTab==='criteria'?'active':'')+'" type="button" data-phfck-sales-tab="criteria">Tiêu chuẩn Checklist</button><button class="'+(templateUiState.salesTab==='total'?'active':'')+'" type="button" data-phfck-sales-tab="total">Bảng tổng điểm</button><button type="button" data-phfck-version-history>Lịch sử phiên bản</button></div>'
      +'<div class="phfck-modal-body"><div class="phfck-template-summary"><div class="phfck-template-icon">▤</div><div><span>'+esc(config.groupLabel||'Mẫu đánh giá')+' · '+esc(config.scope)+'</span><b>'+esc(shownVersion)+' <em>(thay đổi gần nhất)</em></b><small>Nguồn tham chiếu nội bộ: '+esc(config.source)+'</small></div></div>'
      +'<div class="phfck-template-actionbar"><button type="button" class="phfck-primary" data-phfck-direct-edit>✎ Sửa trực tiếp</button><button type="button" class="phfck-secondary" data-phfck-bulk-update>⇧ Cập nhật hàng loạt</button><button type="button" class="phfck-secondary" data-phfck-download-view>⇩ Tải xuống để xem</button><button type="button" class="phfck-secondary" data-phfck-version-history>↺ Lịch sử phiên bản</button><input type="file" accept=".csv,.xlsx,.xls" data-phfck-sales-file hidden></div>'
      +'<div class="phfck-template-detail-grid"><section><small>PHẠM VI</small><b>'+esc(config.scope)+'</b></section><section><small>HIỆU LỰC</small><b>01/08/2026 · tháng N+1</b></section><section><small>MINH CHỨNG</small><b>Khuyến khích</b></section><section><small>GHI CHÚ LỖI</small><b>Bắt buộc</b></section></div><div class="phfck-version-reason"><b>Lý do thay đổi</b><p>'+esc(config.reason)+'</p></div>'
      +(templateUiState.salesTab==='total'?(override?overrideTotalScoreHtml(item.id,config.title,config.policy):assistantTotalScoreHtml(config)):assistantTemplateTreeHtml(config)+'<div class="phfck-template-rules"><h3>Quy tắc đã chốt</h3><ul>'+((config.rules||['File nguồn không có TCCV riêng; phần Checklist hiện áp dụng nhóm TACPHONG chung toàn công ty.','Tiêu chí ứng xử PHF giữ hệ số 10 và Đi trễ lấy từ thư viện chung.','Bảng tổng giữ nguyên toàn bộ chỉ tiêu, mục tiêu và trọng số trong file gốc.','Công thức chung: Thực đạt ×1, Thẩm định ×2, chia 3; sau đó quy đổi theo trọng số.']).map(function(x){return '<li>'+esc(x)+'</li>';}).join(''))+'</ul></div>')
      +'</div><div class="phfck-modal-foot"><button type="button" class="phfck-secondary" data-phfck-close-modal>Đóng</button><button type="button" class="phfck-primary" disabled title="Sẽ mở khi kết nối database và quyền phát hành">Phát hành phiên bản mới</button></div></div></div>';
  }
  function salesTotalScoreHtml(policyCode){
    var rows=[
      {no:'1',name:'Lập phiếu đánh giá',target:'2 phiếu',weight:'5%',actual:'2/2',review:'2/2',weighted:'2/2',score:'5 điểm',actualSource:'Nhân viên tự đánh giá',reviewSource:'Cấp trên thẩm định',explain:'Nhân viên tự đánh giá 2/2 và cấp trên thẩm định 2/2. Điểm sau thẩm định = (2 × 1 + 2 × 2) ÷ 3 = 2. Nội dung này chiếm 5% nên được tính đủ 5 điểm.'},
      {no:'2',name:'Tuân thủ Checklist',target:'100 điểm',weight:'70%',actual:'95/100',review:'95/100',weighted:'95/100',score:'66,5 điểm',actualSource:'Checklist tự động',reviewSource:'Checklist tự lấy trước · cấp trên được sửa',explain:'Checklist tự động đưa 95 điểm vào cả Thực đạt và Thẩm định ban đầu. Điểm sau thẩm định = (95 × 1 + 95 × 2) ÷ 3 = 95. Nội dung này chiếm 70% nên được tính 66,5 điểm. Nếu cấp trên sửa điểm Thẩm định thì bắt buộc ghi lý do và không làm đổi dữ liệu lỗi gốc.'},
      {no:'3',name:'Công việc cấp trên giao',target:'10 điểm',weight:'25%',actual:'8/10',review:'8/10',weighted:'8/10',score:'20 điểm',actualSource:'Nhân viên tự đánh giá',reviewSource:'Cấp trên thẩm định',explain:'Nhân viên tự đánh giá 8/10 và cấp trên thẩm định 8/10. Điểm sau thẩm định = (8 × 1 + 8 × 2) ÷ 3 = 8. Nội dung này chiếm 25% nên được tính 20 điểm.'}
    ];
    return '<div class="phfck-total-score">'
      +'<div class="phfck-total-intro"><div><small>BẢNG TỔNG ĐIỂM · PHIÊN BẢN HIỆN HÀNH</small><h3>Đánh giá kết quả tháng</h3><p>Nhìn theo 3 bước: <b>Thực đạt</b> → <b>Cấp trên thẩm định</b> → <b>Điểm sau tỷ lệ 1:2</b>. Tổng điểm tối đa là 100 điểm.</p></div><div class="phfck-total-policy"><span>Chính sách</span><b>'+(policyCode||'NVBH-TỔNG-1.0')+'</b><small>Hiệu lực từ 01/08/2026</small></div></div>'
      +'<div class="phfck-total-formula-banner"><span>CÁCH TÍNH DỄ HIỂU</span><strong>(Thực đạt × 1 + Thẩm định × 2) ÷ 3</strong><p>Ý nghĩa: điểm của cấp trên có trọng số gấp đôi điểm tự đánh giá. Sau đó hệ thống mới quy đổi theo tỷ trọng 5% · 70% · 25%.</p></div>'
      +'<div class="phfck-total-scroll-top" data-phfck-total-scroll-top aria-label="Thanh cuộn ngang phía trên"><div></div></div><div class="phfck-total-table-wrap" data-phfck-total-scroll-main><table class="phfck-total-table"><thead><tr><th>STT</th><th>Nội dung đánh giá</th><th>Mục tiêu</th><th>Trọng số</th><th>Thực đạt <small>×1</small></th><th>Thẩm định <small>×2</small></th><th>Điểm sau 1:2</th><th>Điểm được tính</th><th>Giải thích</th></tr></thead><tbody>'
      +rows.map(function(r){return '<tr><td>'+r.no+'</td><td><b>'+r.name+'</b></td><td><span class="phfck-total-target">'+r.target+'</span></td><td><span class="phfck-total-weight">'+r.weight+'</span></td><td><strong>'+r.actual+'</strong><small class="phfck-total-sub">'+r.actualSource+'</small></td><td><strong>'+r.review+'</strong><small class="phfck-total-sub">'+r.reviewSource+'</small></td><td><strong class="phfck-total-reviewed">'+r.weighted+'</strong></td><td><strong class="phfck-total-score-value">'+r.score+'</strong></td><td><button type="button" class="phfck-total-info" data-phfck-total-explain="'+esc(r.explain)+'" aria-expanded="false" aria-label="Mở giải thích cách tính">!</button></td></tr>';}).join('')
      +'<tr class="phfck-total-final"><td></td><td><b>Tổng kết quả</b></td><td></td><td><strong>100%</strong></td><td></td><td></td><td></td><td><strong>91,5 điểm</strong></td><td><span class="phfck-result-chip is-pass">Đạt</span></td></tr>'
      +'</tbody></table></div>'
      +(rows.some(function(r){return r[3]==='monthly';})?'<div class="phfck-monthly-plan-note"><b>Chỉ tiêu thay đổi theo kế hoạch tháng</b><p>Cuối tháng, TBP Marketing được cập nhật tên nội dung, mục tiêu và kết quả cho kỳ đánh giá tiếp theo. Mọi thay đổi chỉ áp dụng theo tháng/phiên bản mới và không làm thay đổi phiếu đã chốt.</p></div>':'')+'<div class="phfck-hqcv-policy"><div><small>QUY ĐỊNH XẾP LOẠI & THƯỞNG HQCV</small><h4>Áp dụng theo tỷ lệ kết quả cuối tháng</h4></div><div class="phfck-hqcv-level is-pass"><b>90% – 100%</b><span>Đạt</span><small>Nhận 100% mức thưởng HQCV</small></div><div class="phfck-hqcv-level is-warning"><b>60% – dưới 90%</b><span>Chưa đạt</span><small>Thưởng HQCV × tỷ lệ kết quả</small></div><div class="phfck-hqcv-level is-fail"><b>Dưới 60%</b><span>Không đạt</span><small>0% thưởng HQCV</small></div></div>'
      +'<div class="phfck-total-cards"><article><span>Điểm Checklist</span><strong>95/100</strong><small>Tự động lấy từ tiêu chuẩn Checklist. Cấp trên được điều chỉnh cột Thẩm định nhưng phải ghi lý do.</small></article><article><span>Tổng điểm quy đổi</span><strong>91,5/100</strong><small>Đã tính theo tỷ lệ Thực đạt ×1 và Thẩm định ×2.</small></article><article><span>Tỷ lệ thưởng HQCV</span><strong>100%</strong><small>Kết quả từ 90% đến 100% được nhận đủ mức thưởng HQCV.</small></article></div>'
      +'<div class="phfck-total-admin-note"><div><b>Thiết lập công thức dành cho Admin</b><p>Màn chính giữ gần giống bảng gốc. Nguồn điểm, thang điểm, trọng số, ngưỡng xếp loại và cách quy đổi được quản lý theo phiên bản ở lớp cấu hình phía sau.</p></div><button type="button" class="phfck-secondary" data-phfck-total-formula>Thiết lập công thức</button></div>'
    +'</div>';
  }
  function salesTemplateDetailHtml(item){
    var v=SALES_TEMPLATE_VERSION;
    return '<div class="phfck-modal-layer phfck-sales-layer" data-phfck-modal-layer><div class="phfck-modal phfck-template-modal phfck-sales-modal '+(templateUiState.salesFullscreen?'is-fullscreen':'')+'" role="dialog" aria-modal="true" aria-labelledby="phfckTemplateTitle">'
      +'<div class="phfck-modal-head"><div><small>MẪU CHECKLIST ĐÃ CHUẨN HÓA</small><h2 id="phfckTemplateTitle">Nhân viên bán hàng</h2></div><div class="phfck-modal-head-actions"><button type="button" data-phfck-toggle-sales-fullscreen aria-label="'+(templateUiState.salesFullscreen?'Thu nhỏ':'Phóng to')+'" title="'+(templateUiState.salesFullscreen?'Thu nhỏ khung':'Mở toàn màn hình')+'">'+(templateUiState.salesFullscreen?'↙':'⛶')+'</button><button type="button" data-phfck-close-modal aria-label="Đóng">×</button></div></div>'
      +'<div class="phfck-template-tabs phfck-template-tabs-fixed"><button class="'+(templateUiState.salesTab==='criteria'?'active':'')+'" type="button" data-phfck-sales-tab="criteria">Tiêu chuẩn Checklist</button><button class="'+(templateUiState.salesTab==='total'?'active':'')+'" type="button" data-phfck-sales-tab="total">Bảng tổng điểm</button><button type="button" data-phfck-version-history>Lịch sử phiên bản</button></div>'
      +'<div class="phfck-modal-body">'
        +'<div class="phfck-template-summary"><div class="phfck-template-icon">▤</div><div><span>Bán hàng · '+esc(v.scope)+'</span><b>'+esc(v.version)+' <em>(thay đổi '+esc(v.changedDate)+')</em></b><small>Nguồn tham chiếu nội bộ: '+esc(v.sourceOwner)+'</small></div></div>'
        +'<div class="phfck-template-actionbar"><button type="button" class="phfck-primary" data-phfck-direct-edit>✎ Sửa trực tiếp</button><button type="button" class="phfck-secondary" data-phfck-bulk-update>⇧ Cập nhật hàng loạt</button><button type="button" class="phfck-secondary" data-phfck-download-view>⇩ Tải xuống để xem</button><button type="button" class="phfck-secondary" data-phfck-version-history>↺ Lịch sử phiên bản</button><input type="file" accept=".csv,.xlsx,.xls" data-phfck-sales-file hidden></div>'
        +'<div class="phfck-template-detail-grid"><section><small>PHẠM VI</small><b>'+esc(v.scope)+'</b></section><section><small>HIỆU LỰC</small><b>'+esc(v.effectiveFrom)+' · tháng N+1</b></section><section><small>MINH CHỨNG</small><b>'+esc(v.evidence)+'</b></section><section><small>GHI CHÚ LỖI</small><b>Bắt buộc</b></section></div>'
        +'<div class="phfck-version-reason"><b>Lý do thay đổi</b><p>'+esc(v.changeReason)+'</p></div>'
        +(templateUiState.salesTab==='total'?(loadBulkOverride('nv-ban-hang')?overrideTotalScoreHtml('nv-ban-hang','Nhân viên bán hàng','NVBH-TỔNG'):salesTotalScoreHtml(v.totalPolicyCode)):salesTemplateTreeHtml()+'<div class="phfck-template-rules"><h3>Quy tắc đã chốt</h3><ul><li>Mỗi tháng, mỗi nhân viên Bán hàng áp dụng một mẫu.</li><li>Tất cả tiêu chí đều có cột Hệ số; để trống thì mặc định bằng 1.</li><li>Sửa ít trên hệ thống, sửa nhiều bằng file chuẩn; cả hai đều tạo phiên bản mới.</li><li>Đổi nhóm cha/con phải tạo mã tiêu chí mới; tiêu chí cũ chỉ ngừng áp dụng.</li><li>Phiên bản mới tự áp dụng cho toàn bộ chức danh Bán hàng từ đầu tháng N+1.</li></ul></div>')
      +'</div><div class="phfck-modal-foot"><button type="button" class="phfck-secondary" data-phfck-close-modal>Đóng</button><button type="button" class="phfck-primary" disabled title="Sẽ mở khi kết nối database và quyền phát hành">Phát hành phiên bản mới</button></div>'
    +'</div></div>';
  }
  function shiftLeadTemplateDetailHtml(item){
    var v=SHIFT_LEAD_TEMPLATE_VERSION;
    return '<div class="phfck-modal-layer phfck-sales-layer" data-phfck-modal-layer><div class="phfck-modal phfck-template-modal phfck-sales-modal '+(templateUiState.salesFullscreen?'is-fullscreen':'')+'" role="dialog" aria-modal="true" aria-labelledby="phfckTemplateTitle">'
      +'<div class="phfck-modal-head"><div><small>MẪU CHECKLIST ĐÃ CHUẨN HÓA</small><h2 id="phfckTemplateTitle">Trưởng ca/Phó ca bán hàng</h2></div><div class="phfck-modal-head-actions"><button type="button" data-phfck-toggle-sales-fullscreen aria-label="'+(templateUiState.salesFullscreen?'Thu nhỏ':'Phóng to')+'" title="'+(templateUiState.salesFullscreen?'Thu nhỏ khung':'Mở toàn màn hình')+'">'+(templateUiState.salesFullscreen?'↙':'⛶')+'</button><button type="button" data-phfck-close-modal aria-label="Đóng">×</button></div></div>'
      +'<div class="phfck-template-tabs phfck-template-tabs-fixed"><button class="'+(templateUiState.salesTab==='criteria'?'active':'')+'" type="button" data-phfck-sales-tab="criteria">Tiêu chuẩn Checklist</button><button class="'+(templateUiState.salesTab==='total'?'active':'')+'" type="button" data-phfck-sales-tab="total">Bảng tổng điểm</button><button type="button" data-phfck-version-history>Lịch sử phiên bản</button></div>'
      +'<div class="phfck-modal-body">'
        +'<div class="phfck-template-summary"><div class="phfck-template-icon">▤</div><div><span>Bán hàng · '+esc(v.scope)+'</span><b>'+esc(v.version)+' <em>(thay đổi '+esc(v.changedDate)+')</em></b><small>Nguồn tham chiếu nội bộ: '+esc(v.sourceOwner)+'</small></div></div>'
        +'<div class="phfck-template-actionbar"><button type="button" class="phfck-primary" data-phfck-direct-edit>✎ Sửa trực tiếp</button><button type="button" class="phfck-secondary" data-phfck-bulk-update>⇧ Cập nhật hàng loạt</button><button type="button" class="phfck-secondary" data-phfck-download-view>⇩ Tải xuống để xem</button><button type="button" class="phfck-secondary" data-phfck-version-history>↺ Lịch sử phiên bản</button><input type="file" accept=".csv,.xlsx,.xls" data-phfck-sales-file hidden></div>'
        +'<div class="phfck-template-detail-grid"><section><small>PHẠM VI</small><b>'+esc(v.scope)+'</b></section><section><small>HIỆU LỰC</small><b>'+esc(v.effectiveFrom)+' · tháng N+1</b></section><section><small>MINH CHỨNG</small><b>'+esc(v.evidence)+'</b></section><section><small>GHI CHÚ LỖI</small><b>Bắt buộc</b></section></div>'
        +'<div class="phfck-version-reason"><b>Lý do thay đổi</b><p>'+esc(v.changeReason)+'</p></div>'
        +(templateUiState.salesTab==='total'?salesTotalScoreHtml('TCP-BH-TỔNG-1.0'):shiftLeadTemplateTreeHtml()+'<div class="phfck-template-rules"><h3>Quy tắc đã chốt</h3><ul><li>Mẫu dùng chung cho cả Trưởng ca và Phó ca bán hàng.</li><li>Kế thừa toàn bộ tiêu chí của Nhân viên bán hàng và bổ sung 6 tiêu chí Điều hành ca.</li><li>Tiêu chí “Tuân thủ nguyên tắc ứng xử PHF” là tiêu chí chung toàn công ty, hệ số 10.</li><li>Tất cả tiêu chí đều có Hệ số; để trống thì mặc định bằng 1.</li><li>Sửa nội dung, hệ số hoặc cấu trúc phải tạo phiên bản mới và áp dụng từ tháng N+1.</li></ul></div>')
      +'</div><div class="phfck-modal-foot"><button type="button" class="phfck-secondary" data-phfck-close-modal>Đóng</button><button type="button" class="phfck-primary" disabled title="Sẽ mở khi kết nối database và quyền phát hành">Phát hành phiên bản mới</button></div>'
    +'</div></div>';
  }
  function warehouseTotalScoreHtml(){
    var rows=[
      {no:'1',name:'Lập phiếu và đánh giá công việc tháng',target:'2 phiếu',weight:'5%',actual:'2/2',review:'2/2',weighted:'2/2',score:'5 điểm',explain:'Thực đạt 2/2 và Thẩm định 2/2. Điểm sau tỷ lệ 1:2 = (2 × 1 + 2 × 2) ÷ 3 = 2. Chỉ tiêu chiếm 5% nên được tính đủ 5 điểm.'},
      {no:'2',name:'Tuân thủ tiêu chuẩn công việc',target:'100 điểm',weight:'65%',actual:'100/100',review:'100/100',weighted:'100/100',score:'65 điểm',explain:'Điểm Checklist tự động lấy vào Thực đạt và Thẩm định ban đầu. Điểm sau tỷ lệ 1:2 là 100/100. Chỉ tiêu chiếm 65% nên được tính đủ 65 điểm. Cấp trên có thể sửa Thẩm định nhưng bắt buộc ghi lý do.'},
      {no:'3',name:'Kiểm kê tổng kho định kỳ',target:'2 lần',weight:'10%',actual:'2/2',review:'2/2',weighted:'2/2',score:'10 điểm',explain:'Thực đạt 2/2 và Thẩm định 2/2. Điểm sau tỷ lệ 1:2 = 2/2. Chỉ tiêu chiếm 10% nên được tính đủ 10 điểm.'},
      {no:'4',name:'Báo cáo công việc đúng quy định',target:'10 điểm',weight:'10%',actual:'10/10',review:'10/10',weighted:'10/10',score:'10 điểm',explain:'Thực đạt 10/10 và Thẩm định 10/10. Điểm sau tỷ lệ 1:2 = 10/10. Chỉ tiêu chiếm 10% nên được tính đủ 10 điểm.'},
      {no:'5',name:'Thực hiện công việc cấp trên giao',target:'10 điểm',weight:'10%',actual:'10/10',review:'10/10',weighted:'10/10',score:'10 điểm',explain:'Thực đạt 10/10 và Thẩm định 10/10. Điểm sau tỷ lệ 1:2 = 10/10. Chỉ tiêu chiếm 10% nên được tính đủ 10 điểm.'}
    ];
    return '<div class="phfck-total-score">'
      +'<div class="phfck-total-intro"><div><small>BẢNG TỔNG ĐIỂM · GIỮ NGUYÊN TRỌNG SỐ FILE GỐC</small><h3>Nhân viên Kho & Sơ chế</h3><p>Cách tính chung: <b>(Thực đạt × 1 + Thẩm định × 2) ÷ 3</b>, sau đó quy đổi theo trọng số từng chỉ tiêu.</p></div><span class="phfck-total-policy-chip">NVK-TỔNG-1.0</span></div>'
      +'<div class="phfck-total-scroll-top" data-phfck-total-scroll-top><div></div></div><div class="phfck-total-table-wrap" data-phfck-total-scroll-main><table class="phfck-total-table"><thead><tr><th>STT</th><th>Nội dung đánh giá</th><th>Mục tiêu</th><th>Trọng số</th><th>Thực đạt ×1</th><th>Thẩm định ×2</th><th>Sau tỷ lệ 1:2</th><th>Điểm được tính</th><th>Giải thích</th></tr></thead><tbody>'
      +rows.map(function(r){return '<tr><td>'+r.no+'</td><td><b>'+r.name+'</b></td><td>'+r.target+'</td><td><span class="phfck-weight-chip">'+r.weight+'</span></td><td><strong>'+r.actual+'</strong><small>Nhân viên/nguồn tự động</small></td><td><strong>'+r.review+'</strong><small>Cấp trên thẩm định</small></td><td><strong class="phfck-total-reviewed">'+r.weighted+'</strong></td><td><strong class="phfck-total-score-value">'+r.score+'</strong></td><td><button type="button" class="phfck-total-info" data-phfck-total-explain="'+esc(r.explain)+'" aria-expanded="false" aria-label="Mở giải thích cách tính">!</button></td></tr>';}).join('')
      +'<tr class="phfck-total-final"><td></td><td><b>Tổng kết quả</b></td><td></td><td><strong>100%</strong></td><td></td><td></td><td></td><td><strong>100 điểm</strong></td><td><span class="phfck-result-chip is-pass">Đạt</span></td></tr></tbody></table></div>'
      +(rows.some(function(r){return r[3]==='monthly';})?'<div class="phfck-monthly-plan-note"><b>Chỉ tiêu thay đổi theo kế hoạch tháng</b><p>Cuối tháng, TBP Marketing được cập nhật tên nội dung, mục tiêu và kết quả cho kỳ đánh giá tiếp theo. Mọi thay đổi chỉ áp dụng theo tháng/phiên bản mới và không làm thay đổi phiếu đã chốt.</p></div>':'')+'<div class="phfck-hqcv-policy"><div><small>QUY ĐỊNH XẾP LOẠI & THƯỞNG HQCV</small><h4>Áp dụng theo tỷ lệ kết quả cuối tháng</h4></div><div class="phfck-hqcv-level is-pass"><b>90% – 100%</b><span>Đạt</span><small>Nhận 100% mức thưởng HQCV</small></div><div class="phfck-hqcv-level is-warning"><b>60% – dưới 90%</b><span>Chưa đạt</span><small>Thưởng HQCV × tỷ lệ kết quả</small></div><div class="phfck-hqcv-level is-fail"><b>Dưới 60%</b><span>Không đạt</span><small>0% thưởng HQCV</small></div></div>'
      +'<div class="phfck-total-cards"><article><span>Điểm Checklist</span><strong>100/100</strong><small>Tự động lấy từ tiêu chuẩn công việc; cấp trên được điều chỉnh cột Thẩm định nhưng phải ghi lý do.</small></article><article><span>Tổng trọng số</span><strong>100%</strong><small>Giữ đúng file gốc: 5% – 65% – 10% – 10% – 10%.</small></article><article><span>Tỷ lệ thưởng HQCV</span><strong>100%</strong><small>Ví dụ đang hiển thị kết quả đủ 100 điểm.</small></article></div>'
      +'<div class="phfck-total-admin-note"><div><b>Thiết lập công thức dành cho Admin</b><p>Mọi thay đổi trọng số phải tạo phiên bản mới. Phiếu tháng cũ giữ nguyên công thức và kết quả đã áp dụng.</p></div><button type="button" class="phfck-secondary" data-phfck-total-formula>Thiết lập công thức</button></div>'
    +'</div>';
  }
  function warehouseTemplateDetailHtml(item){
    var v=WAREHOUSE_TEMPLATE_VERSION;
    return '<div class="phfck-modal-layer phfck-sales-layer" data-phfck-modal-layer><div class="phfck-modal phfck-template-modal phfck-sales-modal '+(templateUiState.salesFullscreen?'is-fullscreen':'')+'" role="dialog" aria-modal="true" aria-labelledby="phfckTemplateTitle">'
      +'<div class="phfck-modal-head"><div><small>MẪU CHECKLIST ĐÃ CHUẨN HÓA</small><h2 id="phfckTemplateTitle">Nhân viên Kho & Sơ chế</h2></div><div class="phfck-modal-head-actions"><button type="button" data-phfck-toggle-sales-fullscreen aria-label="'+(templateUiState.salesFullscreen?'Thu nhỏ':'Phóng to')+'" title="'+(templateUiState.salesFullscreen?'Thu nhỏ khung':'Mở toàn màn hình')+'">'+(templateUiState.salesFullscreen?'↙':'⛶')+'</button><button type="button" data-phfck-close-modal aria-label="Đóng">×</button></div></div>'
      +'<div class="phfck-template-tabs phfck-template-tabs-fixed"><button class="'+(templateUiState.salesTab==='criteria'?'active':'')+'" type="button" data-phfck-sales-tab="criteria">Tiêu chuẩn Checklist</button><button class="'+(templateUiState.salesTab==='total'?'active':'')+'" type="button" data-phfck-sales-tab="total">Bảng tổng điểm</button><button type="button" data-phfck-version-history>Lịch sử phiên bản</button></div>'
      +'<div class="phfck-modal-body"><div class="phfck-template-summary"><div class="phfck-template-icon">▤</div><div><span>Kho · '+esc(v.scope)+'</span><b>'+esc(v.version)+' <em>(thay đổi '+esc(v.changedDate)+')</em></b><small>Nguồn tham chiếu nội bộ: '+esc(v.sourceOwner)+'</small></div></div>'
      +'<div class="phfck-template-actionbar"><button type="button" class="phfck-primary" data-phfck-direct-edit>✎ Sửa trực tiếp</button><button type="button" class="phfck-secondary" data-phfck-bulk-update>⇧ Cập nhật hàng loạt</button><button type="button" class="phfck-secondary" data-phfck-download-view>⇩ Tải xuống để xem</button><button type="button" class="phfck-secondary" data-phfck-version-history>↺ Lịch sử phiên bản</button><input type="file" accept=".csv,.xlsx,.xls" data-phfck-sales-file hidden></div>'
      +'<div class="phfck-template-detail-grid"><section><small>PHẠM VI</small><b>'+esc(v.scope)+'</b></section><section><small>HIỆU LỰC</small><b>'+esc(v.effectiveFrom)+' · tháng N+1</b></section><section><small>MINH CHỨNG</small><b>'+esc(v.evidence)+'</b></section><section><small>GHI CHÚ LỖI</small><b>Bắt buộc</b></section></div><div class="phfck-version-reason"><b>Lý do thay đổi</b><p>'+esc(v.changeReason)+'</p></div>'
      +(templateUiState.salesTab==='total'?warehouseTotalScoreHtml():warehouseTemplateTreeHtml()+'<div class="phfck-template-rules"><h3>Quy tắc đã chốt</h3><ul><li>Giữ nguyên nội dung và hệ số theo file gốc Nhân viên Kho.</li><li>Nhóm cha TACPHONG – Nội quy và tác phong là nhóm chung toàn công ty.</li><li>Tiêu chí ứng xử PHF giữ hệ số 10; Đi trễ được gắn từ thư viện chung.</li><li>Bảng tổng giữ đúng trọng số 5% – 65% – 10% – 10% – 10%.</li><li>Chỉ kế thừa giao diện, công thức 1:2, HQCV và trải nghiệm từ mẫu Bán hàng.</li></ul></div>')
      +'</div><div class="phfck-modal-foot"><button type="button" class="phfck-secondary" data-phfck-close-modal>Đóng</button><button type="button" class="phfck-primary" disabled title="Sẽ mở khi kết nối database và quyền phát hành">Phát hành phiên bản mới</button></div></div></div>';
  }

  function warehouseManagerTotalScoreHtml(){
    var rows=[
      {no:'1',name:'Lập phiếu và đánh giá công việc tháng',target:'5 phiếu',weight:'5%',actual:'5/5',review:'5/5',weighted:'5/5',score:'5 điểm',explain:'Thực đạt 5/5 và Thẩm định 5/5. Điểm sau tỷ lệ 1:2 = (5 × 1 + 5 × 2) ÷ 3 = 5. Chỉ tiêu chiếm 5% nên được tính đủ 5 điểm.'},
      {no:'2',name:'Tuân thủ tiêu chuẩn công việc',target:'100 điểm',weight:'60%',actual:'100/100',review:'100/100',weighted:'100/100',score:'60 điểm',explain:'Checklist tự động đưa 100 điểm vào Thực đạt và Thẩm định ban đầu. Điểm sau tỷ lệ 1:2 = 100/100. Chỉ tiêu chiếm 60% nên được tính đủ 60 điểm. Cấp trên được sửa phần Thẩm định nhưng phải ghi lý do và không làm thay đổi dữ liệu lỗi gốc.'},
      {no:'3',name:'Kiểm kê tổng kho định kỳ',target:'3 lần',weight:'10%',actual:'3/3',review:'3/3',weighted:'3/3',score:'10 điểm',explain:'Thực đạt 3/3 và Thẩm định 3/3. Điểm sau tỷ lệ 1:2 = 3/3. Chỉ tiêu chiếm 10% nên được tính đủ 10 điểm.'},
      {no:'4',name:'Đào tạo nhân viên theo kế hoạch',target:'1 buổi',weight:'5%',actual:'1/1',review:'1/1',weighted:'1/1',score:'5 điểm',explain:'Thực đạt 1/1 và Thẩm định 1/1. Điểm sau tỷ lệ 1:2 = 1/1. Chỉ tiêu chiếm 5% nên được tính đủ 5 điểm.'},
      {no:'5',name:'Báo cáo công việc đúng quy định',target:'10 điểm',weight:'10%',actual:'10/10',review:'10/10',weighted:'10/10',score:'10 điểm',explain:'Thực đạt 10/10 và Thẩm định 10/10. Điểm sau tỷ lệ 1:2 = 10/10. Chỉ tiêu chiếm 10% nên được tính đủ 10 điểm.'},
      {no:'6',name:'Thực hiện công việc cấp trên giao',target:'10 điểm',weight:'10%',actual:'10/10',review:'10/10',weighted:'10/10',score:'10 điểm',explain:'Thực đạt 10/10 và Thẩm định 10/10. Điểm sau tỷ lệ 1:2 = 10/10. Chỉ tiêu chiếm 10% nên được tính đủ 10 điểm.'}
    ];
    return '<div class="phfck-total-score">'
      +'<div class="phfck-total-intro"><div><small>BẢNG TỔNG ĐIỂM · GIỮ NGUYÊN TRỌNG SỐ FILE GỐC</small><h3>Trưởng bộ phận Kho & Sơ chế</h3><p>Cách tính chung: <b>(Thực đạt × 1 + Thẩm định × 2) ÷ 3</b>, sau đó quy đổi theo trọng số từng chỉ tiêu.</p></div><span class="phfck-total-policy-chip">TBP-KHO-TỔNG-1.0</span></div>'
      +'<div class="phfck-total-scroll-top" data-phfck-total-scroll-top><div></div></div><div class="phfck-total-table-wrap" data-phfck-total-scroll-main><table class="phfck-total-table"><thead><tr><th>STT</th><th>Nội dung đánh giá</th><th>Mục tiêu</th><th>Trọng số</th><th>Thực đạt ×1</th><th>Thẩm định ×2</th><th>Sau tỷ lệ 1:2</th><th>Điểm được tính</th><th>Giải thích</th></tr></thead><tbody>'
      +rows.map(function(r){return '<tr><td>'+r.no+'</td><td><b>'+r.name+'</b></td><td>'+r.target+'</td><td><span class="phfck-weight-chip">'+r.weight+'</span></td><td><strong>'+r.actual+'</strong><small>Nhân viên/nguồn tự động</small></td><td><strong>'+r.review+'</strong><small>Cấp trên thẩm định</small></td><td><strong class="phfck-total-reviewed">'+r.weighted+'</strong></td><td><strong class="phfck-total-score-value">'+r.score+'</strong></td><td><button type="button" class="phfck-total-info" data-phfck-total-explain="'+esc(r.explain)+'" aria-expanded="false" aria-label="Mở giải thích cách tính">!</button></td></tr>';}).join('')
      +'<tr class="phfck-total-final"><td></td><td><b>Tổng kết quả</b></td><td></td><td><strong>100%</strong></td><td></td><td></td><td></td><td><strong>100 điểm</strong></td><td><span class="phfck-result-chip is-pass">Đạt</span></td></tr></tbody></table></div>'
      +(rows.some(function(r){return r[3]==='monthly';})?'<div class="phfck-monthly-plan-note"><b>Chỉ tiêu thay đổi theo kế hoạch tháng</b><p>Cuối tháng, TBP Marketing được cập nhật tên nội dung, mục tiêu và kết quả cho kỳ đánh giá tiếp theo. Mọi thay đổi chỉ áp dụng theo tháng/phiên bản mới và không làm thay đổi phiếu đã chốt.</p></div>':'')+'<div class="phfck-hqcv-policy"><div><small>QUY ĐỊNH XẾP LOẠI & THƯỞNG HQCV</small><h4>Áp dụng theo tỷ lệ kết quả cuối tháng</h4></div><div class="phfck-hqcv-level is-pass"><b>90% – 100%</b><span>Đạt</span><small>Nhận 100% mức thưởng HQCV</small></div><div class="phfck-hqcv-level is-warning"><b>60% – dưới 90%</b><span>Chưa đạt</span><small>Thưởng HQCV × tỷ lệ kết quả</small></div><div class="phfck-hqcv-level is-fail"><b>Dưới 60%</b><span>Không đạt</span><small>0% thưởng HQCV</small></div></div>'
      +'<div class="phfck-total-cards"><article><span>Điểm Checklist</span><strong>100/100</strong><small>Tự động lấy từ tiêu chuẩn công việc; cấp trên được điều chỉnh cột Thẩm định nhưng phải ghi lý do.</small></article><article><span>Tổng trọng số</span><strong>100%</strong><small>Giữ đúng file gốc: 5% – 60% – 10% – 5% – 10% – 10%.</small></article><article><span>Tỷ lệ thưởng HQCV</span><strong>100%</strong><small>Ví dụ đang hiển thị kết quả đủ 100 điểm.</small></article></div>'
      +'<div class="phfck-total-admin-note"><div><b>Thiết lập công thức dành cho Admin</b><p>Mọi thay đổi trọng số phải tạo phiên bản mới. Phiếu tháng cũ giữ nguyên công thức và kết quả đã áp dụng.</p></div><button type="button" class="phfck-secondary" data-phfck-total-formula>Thiết lập công thức</button></div>'
    +'</div>';
  }
  function warehouseManagerTemplateDetailHtml(item){
    var v=WAREHOUSE_MANAGER_TEMPLATE_VERSION;
    return '<div class="phfck-modal-layer phfck-sales-layer" data-phfck-modal-layer><div class="phfck-modal phfck-template-modal phfck-sales-modal '+(templateUiState.salesFullscreen?'is-fullscreen':'')+'" role="dialog" aria-modal="true" aria-labelledby="phfckTemplateTitle">'
      +'<div class="phfck-modal-head"><div><small>MẪU CHECKLIST ĐÃ CHUẨN HÓA</small><h2 id="phfckTemplateTitle">Trưởng bộ phận Kho & Sơ chế</h2></div><div class="phfck-modal-head-actions"><button type="button" data-phfck-toggle-sales-fullscreen aria-label="'+(templateUiState.salesFullscreen?'Thu nhỏ':'Phóng to')+'" title="'+(templateUiState.salesFullscreen?'Thu nhỏ khung':'Mở toàn màn hình')+'">'+(templateUiState.salesFullscreen?'↙':'⛶')+'</button><button type="button" data-phfck-close-modal aria-label="Đóng">×</button></div></div>'
      +'<div class="phfck-template-tabs phfck-template-tabs-fixed"><button class="'+(templateUiState.salesTab==='criteria'?'active':'')+'" type="button" data-phfck-sales-tab="criteria">Tiêu chuẩn Checklist</button><button class="'+(templateUiState.salesTab==='total'?'active':'')+'" type="button" data-phfck-sales-tab="total">Bảng tổng điểm</button><button type="button" data-phfck-version-history>Lịch sử phiên bản</button></div>'
      +'<div class="phfck-modal-body"><div class="phfck-template-summary"><div class="phfck-template-icon">▤</div><div><span>Kho · '+esc(v.scope)+'</span><b>'+esc(v.version)+' <em>(thay đổi '+esc(v.changedDate)+')</em></b><small>Nguồn tham chiếu nội bộ: '+esc(v.sourceOwner)+'</small></div></div>'
      +'<div class="phfck-template-actionbar"><button type="button" class="phfck-primary" data-phfck-direct-edit>✎ Sửa trực tiếp</button><button type="button" class="phfck-secondary" data-phfck-bulk-update>⇧ Cập nhật hàng loạt</button><button type="button" class="phfck-secondary" data-phfck-download-view>⇩ Tải xuống để xem</button><button type="button" class="phfck-secondary" data-phfck-version-history>↺ Lịch sử phiên bản</button><input type="file" accept=".csv,.xlsx,.xls" data-phfck-sales-file hidden></div>'
      +'<div class="phfck-template-detail-grid"><section><small>PHẠM VI</small><b>'+esc(v.scope)+'</b></section><section><small>HIỆU LỰC</small><b>'+esc(v.effectiveFrom)+' · tháng N+1</b></section><section><small>MINH CHỨNG</small><b>'+esc(v.evidence)+'</b></section><section><small>GHI CHÚ LỖI</small><b>Bắt buộc</b></section></div><div class="phfck-version-reason"><b>Lý do thay đổi</b><p>'+esc(v.changeReason)+'</p></div>'
      +(templateUiState.salesTab==='total'?warehouseManagerTotalScoreHtml():warehouseManagerTemplateTreeHtml()+'<div class="phfck-template-rules"><h3>Quy tắc đã chốt</h3><ul><li>Kế thừa toàn bộ tiêu chuẩn Nhân viên Kho và bổ sung 9 tiêu chí quản lý bộ phận.</li><li>Nhóm cha TACPHONG – Nội quy và tác phong là nhóm chung toàn công ty.</li><li>Tiêu chí ứng xử PHF giữ hệ số 10; Đi trễ được gắn từ thư viện chung.</li><li>Bảng tổng giữ đúng trọng số gốc 5% – 60% – 10% – 5% – 10% – 10%.</li><li>Chỉ kế thừa giao diện, công thức 1:2, HQCV và trải nghiệm từ mẫu Bán hàng.</li></ul></div>')
      +'</div><div class="phfck-modal-foot"><button type="button" class="phfck-secondary" data-phfck-close-modal>Đóng</button><button type="button" class="phfck-primary" disabled title="Sẽ mở khi kết nối database và quyền phát hành">Phát hành phiên bản mới</button></div></div></div>';
  }
  function templateDetailModalHtml(item){
    if(!item)return '';
    if(item.id==='nv-ban-hang')return salesTemplateDetailHtml(item);
    if(item.id==='truong-ca-ban-hang')return shiftLeadTemplateDetailHtml(item);
    if(item.id==='nv-kho')return warehouseTemplateDetailHtml(item);
    if(item.id==='tbp-kho')return warehouseManagerTemplateDetailHtml(item);
    if(ASSISTANT_TEMPLATE_CONFIGS[item.id])return assistantTemplateDetailHtml(item);
    return '<div class="phfck-modal-layer" data-phfck-modal-layer><div class="phfck-modal phfck-template-modal" role="dialog" aria-modal="true" aria-labelledby="phfckTemplateTitle">'
      +'<div class="phfck-modal-head"><div><small>CHI TIẾT BỘ MẪU</small><h2 id="phfckTemplateTitle">'+esc(item.name)+'</h2></div><button type="button" data-phfck-close-modal aria-label="Đóng">×</button></div>'
      +'<div class="phfck-modal-body"><div class="phfck-template-summary"><div class="phfck-template-icon">▤</div><div><span>'+esc(item.group)+'</span><b>'+esc(item.name)+'</b><small>Nguồn nghiệp vụ đã chốt ngày 16/07/2026</small></div></div>'
        +'<div class="phfck-template-detail-grid"><section><small>NGUỒN MẪU</small><b>'+esc(item.source)+'</b></section><section><small>CƠ CHẾ CHECKLIST</small><b>'+(item.hasChecklist?'Có ghi nhận lỗi và trừ điểm':'Hiện chỉ có phiếu đánh giá tháng')+'</b></section><section><small>PHIÊN BẢN</small><b>Chưa chuẩn hóa</b></section><section><small>NGÀY HIỆU LỰC</small><b>Chưa phát hành</b></section></div>'
        +'<div class="phfck-template-rules"><h3>Trạng thái</h3><ul><li>Mẫu này sẽ được rà từng bộ sau khi hoàn tất mẫu Nhân viên bán hàng.</li><li>Tên chuẩn sẽ dùng theo chức danh/nghiệp vụ; nguồn cá nhân chỉ hiển thị cho Admin đối chiếu.</li></ul></div>'
      +'</div><div class="phfck-modal-foot"><button type="button" class="phfck-secondary" data-phfck-close-modal>Đóng</button></div>'
    +'</div></div>';
  }

  var checklistAuditSeed=[
    {time:'18/07/2026 21:40',actor:'Admin PHF',action:'Chuẩn hóa chức năng cập nhật mẫu',area:'Mẫu Checklist',object:'Toàn bộ mẫu đã chuẩn hóa',source:'Web',impact:'Toàn hệ thống',version:'1.7.49',reason:'Tách rõ sửa trực tiếp, cập nhật hàng loạt và tải xuống để xem.'},
    {time:'17/07/2026 16:20',actor:'Admin PHF',action:'Chuẩn hóa mẫu',area:'Mẫu Checklist',object:'Nhân viên bán hàng',source:'Web',impact:'Một chức danh',version:'BH-1.0',reason:'Chuẩn hóa từ file nguồn.'},
    {time:'17/07/2026 15:55',actor:'Admin PHF',action:'Cập nhật bảng tổng điểm',area:'Bảng tổng điểm',object:'Nhân viên Kho & Sơ chế',source:'Web',impact:'Một chức danh',version:'NVK-1.0',reason:'Giữ đúng trọng số 5% – 65% – 10% – 10% – 10%.'}
  ];
  function auditRows(){try{var saved=JSON.parse(localStorage.getItem('phfChecklistAudit')||'[]');return saved.concat(checklistAuditSeed);}catch(e){return checklistAuditSeed.slice();}}
  function addAudit(entry){try{var saved=JSON.parse(localStorage.getItem('phfChecklistAudit')||'[]');saved.unshift(Object.assign({time:new Date().toLocaleString('vi-VN'),actor:((user()||{}).fullName||(user()||{}).name||(user()||{}).username||'Admin'),source:'Web',impact:'Một mẫu'},entry||{}));localStorage.setItem('phfChecklistAudit',JSON.stringify(saved.slice(0,100)));}catch(e){}}
  function recentChangesHtml(){var rows=auditRows().slice(0,5);return '<section class="phfck-panel phfck-recent"><div class="phfck-panel-head"><div><small>TRUY VẾT NHANH</small><h3>Thay đổi gần đây</h3></div><button type="button" class="phfck-overview-link" data-phfck-view="history">Xem toàn bộ →</button></div><div class="phfck-history-list">'+rows.map(function(r){return '<article><span>'+esc(r.time)+'</span><div><b>'+esc(r.actor)+' · '+esc(r.action)+'</b><p>'+esc(r.object)+' · '+esc(r.source)+' · '+esc(r.version||'Không đổi phiên bản')+'</p></div><em>'+esc(r.impact)+'</em></article>';}).join('')+'</div></section>';}
  function historyHtml(){var rows=auditRows();return '<div class="phfck-page-head"><div><small>PHF CHECKLIST · ADMIN</small><h1>Lịch sử thay đổi</h1><p>Truy vết các tác động làm thay đổi mẫu, tiêu chí, điểm, phiếu và cấu hình. Nhật ký không cho sửa hoặc xóa.</p></div><button type="button" class="phfck-secondary" data-phfck-history-export>⇩ Xuất lịch sử</button></div><section class="phfck-panel"><div class="phfck-history-toolbar"><input type="search" placeholder="Tìm người thực hiện, hành động hoặc đối tượng" data-phfck-history-search><select data-phfck-history-source><option value="all">Tất cả nguồn</option><option value="Web">Web</option><option value="Excel">Import Excel</option><option value="Hệ thống">Hệ thống tự động</option></select></div><div class="phfck-history-table-wrap"><table class="phfck-history-table"><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Khu vực / đối tượng</th><th>Nguồn</th><th>Mức ảnh hưởng</th><th>Phiên bản</th><th>Lý do</th></tr></thead><tbody data-phfck-history-body>'+historyRowsHtml(rows)+'</tbody></table></div></section>';}
  function historyRowsHtml(rows){return rows.map(function(r){return '<tr><td>'+esc(r.time)+'</td><td><b>'+esc(r.actor)+'</b></td><td>'+esc(r.action)+'</td><td><b>'+esc(r.area)+'</b><small>'+esc(r.object)+'</small></td><td><span class="phfck-source-chip">'+esc(r.source)+'</span></td><td>'+esc(r.impact)+'</td><td>'+esc(r.version||'—')+'</td><td>'+esc(r.reason||'—')+'</td></tr>';}).join('')||'<tr><td colspan="8" class="phfck-empty-cell">Chưa có lịch sử phù hợp.</td></tr>';}
  var pendingBulkImport=null;
  function bulkOverrideKey(id){return 'phfChecklistTemplateOverride:'+String(id||'');}
  function loadBulkOverride(id){try{return JSON.parse(localStorage.getItem(bulkOverrideKey(id))||'null');}catch(e){return null;}}
  function saveBulkOverride(id,data){try{localStorage.setItem(bulkOverrideKey(id),JSON.stringify(data));return true;}catch(e){return false;}}
  function baseTemplateGroups(id){return ASSISTANT_TEMPLATE_CONFIGS[id]?(ASSISTANT_TEMPLATE_CONFIGS[id].groups||ASSISTANT_COMMON_GROUPS):(id==='truong-ca-ban-hang'?SHIFT_LEAD_TEMPLATE_GROUPS:(id==='nv-kho'?WAREHOUSE_TEMPLATE_GROUPS:(id==='tbp-kho'?WAREHOUSE_MANAGER_TEMPLATE_GROUPS:SALES_TEMPLATE_GROUPS)));}
  function selectedTemplateGroups(){var id=templateUiState.selectedId;var override=loadBulkOverride(id);return override&&Array.isArray(override.groups)?override.groups:baseTemplateGroups(id);}
  function effectiveTemplateVersion(id){var override=loadBulkOverride(id);return override&&override.version?override.version:viewWorkbookMetaBase(id).version;}
  function nextTemplateVersion(version){var m=String(version||'1.0').match(/^(.*?)(\d+)\.(\d+)$/);if(!m)return String(version||'PHF')+'-1.1';return m[1]+m[2]+'.'+(Number(m[3])+1);}
  function deepClone(v){return JSON.parse(JSON.stringify(v));}
  function flattenCriteria(groups){var out=[];(groups||[]).forEach(function(g){(g.children||[]).forEach(function(c){(c.items||[]).forEach(function(i){out.push({groupCode:g.code,groupName:g.name,childCode:c.code,childName:c.name,code:String(i[0]||''),content:String(i[1]||''),factor:Number(i[2]||1)});});});});return out;}
  function normalizeAction(v){v=normalizeText(v||'Giữ nguyên').toLowerCase();if(v.indexOf('thêm')>=0)return 'add';if(v.indexOf('ngưng')>=0)return 'stop';if(v.indexOf('cập nhật')>=0||v.indexOf('cap nhat')>=0)return 'update';return 'keep';}
  function headerIndex(row,names){var h=(row||[]).map(function(x){return normalizeText(x).toLowerCase();});for(var i=0;i<names.length;i++){var at=h.indexOf(normalizeText(names[i]).toLowerCase());if(at>=0)return at;}return -1;}
  function readCell(row,index){return index>=0?String((row||[])[index]==null?'':(row||[])[index]).trim():'';}
  function parsePercentValue(v){if(typeof v==='number')return v<=1?v*100:v;var t=String(v||'').replace('%','').replace(',','.').trim();return Number(t);}
  function makeCriterionCode(prefix,used){prefix=String(prefix||'TC').replace(/[^A-Za-z0-9-]/g,'').toUpperCase();var n=1,code='';do{code=prefix+'-MOI-'+String(n++).padStart(2,'0');}while(used[code]);used[code]=true;return code;}
  function findGroupChild(groups,gCode,cCode,gName,cName){var g=(groups||[]).find(function(x){return String(x.code)===String(gCode);})||(groups||[]).find(function(x){return normalizeText(x.name).toLowerCase()===normalizeText(gName).toLowerCase();});if(!g)return null;var c=(g.children||[]).find(function(x){return String(x.code)===String(cCode);})||(g.children||[]).find(function(x){return normalizeText(x.name).toLowerCase()===normalizeText(cName).toLowerCase();});return c?{group:g,child:c}:null;}
  function baseTotalRows(id){return viewWorkbookTotalRowsBase(id);}
  function effectiveTotalRows(id){var override=loadBulkOverride(id);return override&&Array.isArray(override.totalRows)?override.totalRows:baseTotalRows(id);}
  function phfckExactValue(value,allowed){var v=String(value==null?'':value).trim();return allowed.indexOf(v)>=0?v:'';}
  function phfckGroupPath(group,child){return String(group.code)+' | '+String(group.name)+' / '+String(child.code)+' | '+String(child.name);}
  function phfckGroupPathMap(groups){var map={};(groups||[]).forEach(function(g){(g.children||[]).forEach(function(c){map[phfckGroupPath(g,c)]={group:g,child:c};});});return map;}
  function parseBulkWorkbook(wb,fileName){
    var id=templateUiState.selectedId||'nv-ban-hang',meta=viewWorkbookMeta(id),errors=[],warnings=[];
    function sheet(names){for(var i=0;i<names.length;i++){var n=wb.SheetNames.find(function(x){return normalizeText(x).toLowerCase()===normalizeText(names[i]).toLowerCase();});if(n)return XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,defval:'',raw:true});}return null;}
    var info=sheet(['HƯỚNG DẪN','HUONG DAN']),criteria=sheet(['TIÊU CHÍ','TIEU CHI']),total=sheet(['BẢNG TỔNG','BANG TONG']);
    if(!info)errors.push('Thiếu sheet HƯỚNG DẪN.');if(!criteria)errors.push('Thiếu sheet TIÊU CHÍ.');if(!total)errors.push('Thiếu sheet BẢNG TỔNG.');if(errors.length)return {fileName:fileName,errors:errors,warnings:warnings};
    var infoMap={};(info||[]).forEach(function(r){var k=normalizeText(r[0]).toLowerCase();if(k)infoMap[k]=String(r[1]||'').trim();});
    var systemId=infoMap['mã hệ thống']||infoMap['ma he thong']||'',templateCode=infoMap['mã mẫu']||infoMap['ma mau']||'',sourceVersion=infoMap['phiên bản nguồn']||infoMap['phien ban nguon']||'',formatCode=infoMap['định dạng file']||infoMap['dinh dang file']||'';
    if(formatCode!=='PHF-BULK-1.7.55')errors.push('File không đúng định dạng cập nhật an toàn PHF-BULK-1.7.55. Vui lòng tải lại file mới từ hệ thống.');
    if(!systemId||systemId!==id)errors.push('File không thuộc đúng mẫu đang mở. Mã hệ thống trong file: '+(systemId||'trống')+'.');
    if(!templateCode||templateCode!==String(meta.code||''))errors.push('Mã mẫu trong file không đúng với mẫu đang mở.');
    if(!sourceVersion||sourceVersion!==String(meta.version||''))errors.push('Phiên bản nguồn trong file là '+(sourceVersion||'trống')+', trong khi mẫu hiện tại là '+String(meta.version||'')+'. Vui lòng tải file cập nhật mới nhất.');

    var ch=criteria[0]||[],ci={stt:headerIndex(ch,['STT']),groupPath:headerIndex(ch,['Nhóm/bước hợp lệ']),code:headerIndex(ch,['Mã tiêu chí']),content:headerIndex(ch,['Nội dung tiêu chí']),factor:headerIndex(ch,['Hệ số']),type:headerIndex(ch,['Loại tiêu chí']),evidence:headerIndex(ch,['Minh chứng']),noteRequired:headerIndex(ch,['Ghi chú bắt buộc']),permission:headerIndex(ch,['Quyền ghi nhận']),status:headerIndex(ch,['Trạng thái']),action:headerIndex(ch,['Xử lý'])};
    ['groupPath','code','content','factor','type','evidence','noteRequired','permission','status','action'].forEach(function(k){if(ci[k]<0)errors.push('Sheet TIÊU CHÍ thiếu cột “'+k+'”. Vui lòng không đổi tên cột.');});
    var th=total[0]||[],ti={code:headerIndex(th,['Mã chỉ tiêu']),content:headerIndex(th,['Nội dung chỉ tiêu']),target:headerIndex(th,['Mục tiêu']),unit:headerIndex(th,['Đơn vị']),weight:headerIndex(th,['Trọng số']),source:headerIndex(th,['Nguồn kết quả']),monthly:headerIndex(th,['Theo kế hoạch tháng']),action:headerIndex(th,['Xử lý'])};
    ['code','content','target','unit','weight','source','monthly','action'].forEach(function(k){if(ti[k]<0)errors.push('Sheet BẢNG TỔNG thiếu cột “'+k+'”. Vui lòng không đổi tên cột.');});
    if(errors.length)return {fileName:fileName,errors:errors,warnings:warnings};

    var actionValues=['Giữ nguyên','Cập nhật','Thêm mới','Ngưng áp dụng'],typeValues=['Chung PHF','Riêng chức danh'],evidenceValues=['Khuyến khích','Bắt buộc'],yesNo=['Có','Không'],permissionValues=['Theo phân quyền','Chỉ Admin'],statusValues=['Đang áp dụng','Ngưng áp dụng'],sourceValues=['Checklist','Hệ thống','Nhập đánh giá'];
    var currentGroups=deepClone(selectedTemplateGroups()),pathMap=phfckGroupPathMap(currentGroups),existing=flattenCriteria(currentGroups),existingMap={},used={};existing.forEach(function(x){existingMap[x.code]=x;used[x.code]=true;});var seen={},changes=[];
    criteria.slice(1).forEach(function(r,idx){if(!r.some(function(v){return String(v).trim();}))return;var rowNo=idx+2,rawAction=readCell(r,ci.action),actionLabel=phfckExactValue(rawAction,actionValues);if(!actionLabel){errors.push('TIÊU CHÍ dòng '+rowNo+': cột Xử lý phải chọn đúng từ danh sách.');return;}var action=normalizeAction(actionLabel),groupPath=readCell(r,ci.groupPath),gc=pathMap[groupPath]||null,code=readCell(r,ci.code),content=readCell(r,ci.content),factor=Number(String(readCell(r,ci.factor)).replace(',','.')),type=phfckExactValue(readCell(r,ci.type),typeValues),evidence=phfckExactValue(readCell(r,ci.evidence),evidenceValues),noteRequired=phfckExactValue(readCell(r,ci.noteRequired),yesNo),permission=phfckExactValue(readCell(r,ci.permission),permissionValues),status=phfckExactValue(readCell(r,ci.status),statusValues);
      if(!gc)errors.push('TIÊU CHÍ dòng '+rowNo+': Nhóm/bước không thuộc danh mục của mẫu hiện tại.');if(!type)errors.push('TIÊU CHÍ dòng '+rowNo+': Loại tiêu chí phải chọn từ danh sách.');if(!evidence)errors.push('TIÊU CHÍ dòng '+rowNo+': Minh chứng phải chọn từ danh sách.');if(!noteRequired)errors.push('TIÊU CHÍ dòng '+rowNo+': Ghi chú bắt buộc phải chọn Có hoặc Không.');if(!permission)errors.push('TIÊU CHÍ dòng '+rowNo+': Quyền ghi nhận phải chọn từ danh sách.');if(!status)errors.push('TIÊU CHÍ dòng '+rowNo+': Trạng thái phải chọn từ danh sách.');if(code)seen[code]=true;
      if(action==='add'){if(!content)errors.push('TIÊU CHÍ dòng '+rowNo+': thiếu nội dung tiêu chí.');if(!Number.isFinite(factor)||factor<=0)errors.push('TIÊU CHÍ dòng '+rowNo+': hệ số phải là số lớn hơn 0.');if(code&&existingMap[code])errors.push('TIÊU CHÍ dòng '+rowNo+': mã '+code+' đã tồn tại.');if(!code)code=makeCriterionCode(meta.code||'TC',used);if(/ứng xử phf/i.test(content)&&factor!==10)errors.push('TIÊU CHÍ dòng '+rowNo+': Tuân thủ nguyên tắc ứng xử PHF phải có hệ số 10.');if(gc)changes.push({type:'add',row:rowNo,code:code,content:content,factor:factor,groupCode:gc.group.code,groupName:gc.group.name,childCode:gc.child.code,childName:gc.child.name,criterionType:type,evidence:evidence,noteRequired:noteRequired,permission:permission,status:status});return;}
      if(!code||!existingMap[code]){errors.push('TIÊU CHÍ dòng '+rowNo+': mã tiêu chí không tồn tại; dòng mới phải chọn Thêm mới.');return;}var old=existingMap[code],oldPath='';var oldGc=findGroupChild(currentGroups,old.groupCode,old.childCode,old.groupName,old.childName);if(oldGc)oldPath=phfckGroupPath(oldGc.group,oldGc.child);if(groupPath!==oldPath)errors.push('TIÊU CHÍ dòng '+rowNo+': không được chuyển tiêu chí '+code+' sang nhóm khác; hãy ngưng dòng cũ và thêm dòng mới.');
      if(action==='update'){if(!content)errors.push('TIÊU CHÍ dòng '+rowNo+': thiếu nội dung tiêu chí.');if(!Number.isFinite(factor)||factor<=0)errors.push('TIÊU CHÍ dòng '+rowNo+': hệ số phải là số lớn hơn 0.');if(/ứng xử phf/i.test(content)&&factor!==10)errors.push('TIÊU CHÍ dòng '+rowNo+': Tuân thủ nguyên tắc ứng xử PHF phải có hệ số 10.');changes.push({type:'update',row:rowNo,code:code,before:old,content:content,factor:factor,criterionType:type,evidence:evidence,noteRequired:noteRequired,permission:permission,status:status});}
      else if(action==='stop'){if(status!=='Ngưng áp dụng')warnings.push('TIÊU CHÍ dòng '+rowNo+': hệ thống sẽ chuyển trạng thái sang Ngưng áp dụng theo cột Xử lý.');changes.push({type:'stop',row:rowNo,code:code,before:old});}
      else {if((content&&content!==old.content)||(Number.isFinite(factor)&&factor!==old.factor))errors.push('TIÊU CHÍ dòng '+rowNo+': dữ liệu đã thay đổi nhưng cột Xử lý vẫn là Giữ nguyên.');changes.push({type:'keep',row:rowNo,code:code,before:old});}
    });
    existing.forEach(function(x){if(!seen[x.code])errors.push('TIÊU CHÍ: thiếu dòng mã '+x.code+'. Không được xóa dòng; hãy giữ dòng và chọn Ngưng áp dụng.');});

    var currentTotals=effectiveTotalRows(id),totalMap={},seenTotals={};currentTotals.forEach(function(r){totalMap[String(r[1])]=r;});var totalChanges=[],activeWeight=0;
    total.slice(1).forEach(function(r,idx){if(!r.some(function(v){return String(v).trim();}))return;var rowNo=idx+2,rawAction=readCell(r,ti.action),actionLabel=phfckExactValue(rawAction,actionValues);if(!actionLabel){errors.push('BẢNG TỔNG dòng '+rowNo+': cột Xử lý phải chọn đúng từ danh sách.');return;}var action=normalizeAction(actionLabel),code=readCell(r,ti.code),content=readCell(r,ti.content),target=Number(String(readCell(r,ti.target)).replace(',','.')),unit=readCell(r,ti.unit),weight=parsePercentValue(r[ti.weight]),source=phfckExactValue(readCell(r,ti.source),sourceValues),monthlyLabel=phfckExactValue(readCell(r,ti.monthly),yesNo),monthly=monthlyLabel==='Có';if(!Number.isFinite(weight))weight=0;if(!source)errors.push('BẢNG TỔNG dòng '+rowNo+': Nguồn kết quả phải chọn từ danh sách.');if(!monthlyLabel)errors.push('BẢNG TỔNG dòng '+rowNo+': Theo kế hoạch tháng phải chọn Có hoặc Không.');if(!unit)errors.push('BẢNG TỔNG dòng '+rowNo+': thiếu đơn vị.');
      if(action==='add'){if(!code)code='CT-MOI-'+String(totalChanges.length+1).padStart(2,'0');if(totalMap[code])errors.push('BẢNG TỔNG dòng '+rowNo+': mã '+code+' đã tồn tại.');if(!content||!Number.isFinite(target)||target<=0)errors.push('BẢNG TỔNG dòng '+rowNo+': cần nhập nội dung và mục tiêu lớn hơn 0.');if(weight<0||weight>100)errors.push('BẢNG TỔNG dòng '+rowNo+': trọng số phải từ 0% đến 100%.');totalChanges.push({type:'add',row:rowNo,code:code,content:content,target:target,unit:unit,weight:weight,source:source,monthly:monthly});activeWeight+=weight;return;}
      if(!code||!totalMap[code]){errors.push('BẢNG TỔNG dòng '+rowNo+': mã chỉ tiêu không tồn tại; dòng mới phải chọn Thêm mới.');return;}seenTotals[code]=true;var old=totalMap[code];if(action==='stop')totalChanges.push({type:'stop',row:rowNo,code:code,before:old});else {if(/tuân thủ tiêu chuẩn công việc/i.test(content)&&target!==100)errors.push('BẢNG TỔNG dòng '+rowNo+': Tuân thủ tiêu chuẩn công việc phải có mục tiêu 100.');if(weight<0||weight>100)errors.push('BẢNG TỔNG dòng '+rowNo+': trọng số phải từ 0% đến 100%.');var typeChange=action==='update'?'update':'keep';if(typeChange==='keep'){var changed=(content&&content!==String(old[2]))||(Number.isFinite(target)&&target!==Number(old[3]))||(unit&&unit!==String(old[4]||''))||Math.abs(weight-Number(old[5]))>0.001||(monthly!==(old[6]==='Có'))||(source&&source!==String(old[7]||(/tuân thủ|checklist/i.test(old[2])?'Checklist':(/lập phiếu/i.test(old[2])?'Hệ thống':'Nhập đánh giá'))));if(changed)errors.push('BẢNG TỔNG dòng '+rowNo+': dữ liệu đã thay đổi nhưng cột Xử lý vẫn là Giữ nguyên.');totalChanges.push({type:'keep',row:rowNo,code:code,before:old,content:old[2],target:Number(old[3]),unit:old[4],weight:Number(old[5]),source:old[7]||source,monthly:old[6]==='Có'});activeWeight+=Number(old[5]);}else{totalChanges.push({type:'update',row:rowNo,code:code,before:old,content:content||old[2],target:Number.isFinite(target)&&target>0?target:Number(old[3]),unit:unit||old[4],weight:weight,source:source,monthly:monthly});activeWeight+=weight;}}
    });
    currentTotals.forEach(function(r){if(!seenTotals[String(r[1])]&&!totalChanges.some(function(x){return x.code===String(r[1]);}))errors.push('BẢNG TỔNG: thiếu dòng mã '+r[1]+'. Không được xóa dòng; hãy chọn Ngưng áp dụng.');});
    if(Math.abs(activeWeight-100)>0.001)errors.push('BẢNG TỔNG: tổng trọng số hiện là '+activeWeight+'%, bắt buộc bằng 100%.');
    var summary={keep:changes.filter(function(x){return x.type==='keep';}).length,update:changes.filter(function(x){return x.type==='update';}).length,add:changes.filter(function(x){return x.type==='add';}).length,stop:changes.filter(function(x){return x.type==='stop';}).length,total:changes.length,totalUpdate:totalChanges.filter(function(x){return x.type==='update';}).length,totalAdd:totalChanges.filter(function(x){return x.type==='add';}).length,totalStop:totalChanges.filter(function(x){return x.type==='stop';}).length,totalWeight:activeWeight};
    return {fileName:fileName,templateId:id,meta:meta,criteriaChanges:changes,totalChanges:totalChanges,summary:summary,errors:errors,warnings:warnings};
  }
  function applyBulkImport(pending,reason,effectiveDate){var id=pending.templateId,groups=deepClone(selectedTemplateGroups()),byCode={};groups.forEach(function(g){g.children.forEach(function(c){c.items.forEach(function(i){byCode[String(i[0])]={group:g,child:c,item:i};});});});pending.criteriaChanges.forEach(function(ch){if(ch.type==='update'&&byCode[ch.code]){byCode[ch.code].item[1]=ch.content;byCode[ch.code].item[2]=ch.factor;}else if(ch.type==='stop'&&byCode[ch.code]){var arr=byCode[ch.code].child.items;var at=arr.indexOf(byCode[ch.code].item);if(at>=0)arr.splice(at,1);}else if(ch.type==='add'){var gc=findGroupChild(groups,ch.groupCode,ch.childCode,ch.groupName,ch.childName);if(gc)gc.child.items.push([ch.code,ch.content,ch.factor]);}});
    var totals=[];pending.totalChanges.forEach(function(ch){if(ch.type==='stop')return;var old=ch.before||[];totals.push([totals.length+1,ch.code,ch.content||old[2],Number(ch.target||old[3]),ch.unit||old[4]||'điểm',Number(ch.weight),ch.monthly?'Có':'Không',ch.source||'Nhập đánh giá']);});var oldVersion=effectiveTemplateVersion(id),newVersion=nextTemplateVersion(oldVersion);var payload={templateId:id,groups:groups,totalRows:totals,version:newVersion,sourceVersion:oldVersion,effectiveDate:effectiveDate,reason:reason,updatedAt:new Date().toISOString()};if(!saveBulkOverride(id,payload))return null;return payload;}
  function findCriterion(code){var found=null;selectedTemplateGroups().some(function(g){return g.children.some(function(c){return c.items.some(function(i){if(i[0]===code){found={group:g,child:c,item:i};return true;}return false;});});});return found;}
  function directEditModalHtml(code){var f=findCriterion(code)||{group:{name:''},child:{name:''},item:['','','1']};return '<div class="phfck-modal-layer phfck-edit-layer" data-phfck-submodal><div class="phfck-modal phfck-edit-modal" role="dialog" aria-modal="true"><div class="phfck-modal-head"><div><small>SỬA TRỰC TIẾP TRÊN WEB</small><h2>'+esc(f.item[0]||'Tiêu chí mới')+'</h2></div><button type="button" data-phfck-close-submodal>×</button></div><div class="phfck-modal-body"><div class="phfck-edit-grid"><label><b>Nhóm nội dung</b><input value="'+esc(f.group.name+' / '+f.child.name)+'" disabled></label><label><b>Mã tiêu chí</b><input value="'+esc(f.item[0])+'" disabled data-phfck-edit-code></label><label class="is-wide"><b>Nội dung tiêu chí <em>*</em></b><textarea data-phfck-edit-content>'+esc(f.item[1])+'</textarea></label><label><b>Hệ số <em>*</em></b><input type="number" min="1" step="1" value="'+esc(f.item[2])+'" data-phfck-edit-factor></label><label><b>Trạng thái</b><select data-phfck-edit-status><option>Đang áp dụng</option><option>Ngưng áp dụng</option></select></label><label><b>Ngày hiệu lực <em>*</em></b><input type="date" data-phfck-edit-effective></label><label class="is-wide"><b>Lý do thay đổi <em>*</em></b><textarea data-phfck-edit-reason placeholder="Nêu ngắn gọn lý do cập nhật"></textarea></label></div><div class="phfck-before-after"><div><small>TRƯỚC THAY ĐỔI</small><p>'+esc(f.item[1])+' · Hệ số '+esc(f.item[2])+'</p></div><div><small>SAU THAY ĐỔI</small><p>Dữ liệu sẽ được hiển thị tại bước xem trước trước khi tạo phiên bản mới.</p></div></div></div><div class="phfck-modal-foot"><button type="button" class="phfck-secondary" data-phfck-close-submodal>Hủy</button><button type="button" class="phfck-secondary" data-phfck-save-draft>Lưu nháp</button><button type="button" class="phfck-primary" data-phfck-confirm-edit>Xem trước & tạo phiên bản</button></div></div></div>';}
  function bulkStartModalHtml(){var meta=viewWorkbookMeta(templateUiState.selectedId||'nv-ban-hang');return '<div class="phfck-modal-layer phfck-edit-layer" data-phfck-submodal><div class="phfck-modal phfck-bulk-modal" role="dialog" aria-modal="true"><div class="phfck-modal-head"><div><small>CẬP NHẬT HÀNG LOẠT BẰNG EXCEL</small><h2>'+esc(meta.name)+'</h2></div><button type="button" data-phfck-close-submodal>×</button></div><div class="phfck-modal-body"><div class="phfck-bulk-steps"><article><span>1</span><div><b>Tải file cập nhật</b><p>File này khác file “Tải xuống để xem”. File có mã nhận diện, dropdown danh mục và dữ liệu hiện hành của đúng mẫu.</p><button type="button" class="phfck-secondary" data-phfck-download-bulk-file>⇩ Tải file cập nhật hàng loạt</button></div></article><article><span>2</span><div><b>Chỉnh file Excel</b><p>Không xóa dòng có sẵn. Các trường danh mục bắt buộc chọn từ dropdown; dùng cột Xử lý để xác định thay đổi.</p></div></article><article><span>3</span><div><b>Chọn file đã chỉnh</b><p>Hệ thống kiểm tra và cho xem trước, chưa ghi đè mẫu hiện hành.</p><button type="button" class="phfck-primary" data-phfck-choose-bulk-file>⇧ Chọn file để kiểm tra</button></div></article></div><div class="phfck-import-rules"><b>Quy tắc an toàn</b><ul><li>File phải thuộc đúng mẫu, mã mẫu và phiên bản đang mở.</li><li>Các giá trị danh mục phải khớp tuyệt đối với dữ liệu hệ thống.</li><li>Không đổi mã hoặc chuyển nhóm tiêu chí cũ.</li><li>Tổng trọng số phải bằng 100%.</li><li>Chỉ sau khi xác nhận mới tạo phiên bản mới.</li></ul></div></div><div class="phfck-modal-foot"><button type="button" class="phfck-secondary" data-phfck-close-submodal>Đóng</button></div></div></div>';}
  function bulkChangeRowsHtml(pending){var rows=(pending.criteriaChanges||[]).filter(function(x){return x.type!=='keep';}).slice(0,30);var totalRows=(pending.totalChanges||[]).filter(function(x){return x.type!=='keep';}).slice(0,20);function label(t){return t==='add'?'Thêm mới':(t==='stop'?'Ngưng áp dụng':'Cập nhật');}return '<div class="phfck-bulk-diff"><h3>Thay đổi tiêu chí</h3>'+(rows.length?'<div class="phfck-bulk-diff-list">'+rows.map(function(x){var before=x.before?(x.before.content+' · Hệ số '+x.before.factor):'—';var after=x.type==='stop'?'Ngưng áp dụng':(x.content+' · Hệ số '+x.factor);return '<article><span class="is-'+x.type+'">'+label(x.type)+'</span><b>'+esc(x.code)+'</b><p><small>Trước:</small> '+esc(before)+'</p><p><small>Sau:</small> '+esc(after)+'</p></article>';}).join('')+'</div>':'<p class="phfck-muted-line">Không thay đổi tiêu chí.</p>')+'<h3>Thay đổi Bảng tổng điểm</h3>'+(totalRows.length?'<div class="phfck-bulk-diff-list">'+totalRows.map(function(x){var before=x.before?(x.before[2]+' · '+x.before[5]+'%'):'—';var after=x.type==='stop'?'Ngưng áp dụng':(x.content+' · '+x.weight+'%');return '<article><span class="is-'+x.type+'">'+label(x.type)+'</span><b>'+esc(x.code)+'</b><p><small>Trước:</small> '+esc(before)+'</p><p><small>Sau:</small> '+esc(after)+'</p></article>';}).join('')+'</div>':'<p class="phfck-muted-line">Không thay đổi Bảng tổng điểm.</p>')+'</div>';}
  function bulkPreviewHtml(pending){var summary=pending.summary||{total:0,keep:0,update:0,add:0,stop:0,totalWeight:0};var hasErrors=(pending.errors||[]).length>0;var nextVersion=nextTemplateVersion(effectiveTemplateVersion(pending.templateId||templateUiState.selectedId));return '<div class="phfck-modal-layer phfck-edit-layer" data-phfck-submodal><div class="phfck-modal phfck-bulk-modal is-preview" role="dialog" aria-modal="true"><div class="phfck-modal-head"><div><small>CẬP NHẬT HÀNG LOẠT BẰNG EXCEL</small><h2>'+(hasErrors?'File cần điều chỉnh':'Kiểm tra và xem trước')+'</h2></div><button type="button" data-phfck-close-submodal>×</button></div><div class="phfck-modal-body"><div class="phfck-file-summary"><b>'+esc(pending.fileName||'File Excel')+'</b><span>'+esc((pending.meta||{}).name||'Mẫu Checklist')+' · Dự kiến '+esc(nextVersion)+'</span></div>'+(hasErrors?'<div class="phfck-import-errors"><b>Chưa thể tạo phiên bản mới</b><p>Vui lòng sửa file rồi import lại:</p><ol>'+(pending.errors||[]).slice(0,40).map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ol></div>':'<div class="phfck-preview-cards"><article><strong>'+summary.keep+'</strong><span>Giữ nguyên</span></article><article><strong>'+summary.update+'</strong><span>Cập nhật</span></article><article><strong>'+summary.add+'</strong><span>Thêm mới</span></article><article><strong>'+summary.stop+'</strong><span>Ngưng áp dụng</span></article><article><strong>'+summary.totalWeight+'%</strong><span>Tổng trọng số</span></article></div>'+bulkChangeRowsHtml(pending)+'<div class="phfck-edit-grid phfck-bulk-confirm-fields"><label><b>Ngày hiệu lực <em>*</em></b><input type="date" data-phfck-bulk-effective></label><label class="is-wide"><b>Lý do cập nhật <em>*</em></b><textarea data-phfck-bulk-reason placeholder="Nêu rõ lý do cập nhật hàng loạt"></textarea></label></div>')+'</div><div class="phfck-modal-foot"><button type="button" class="phfck-secondary" data-phfck-close-submodal>'+(hasErrors?'Đóng':'Hủy')+'</button>'+(hasErrors?'':'<button type="button" class="phfck-primary" data-phfck-confirm-bulk>Tạo phiên bản '+esc(nextVersion)+'</button>')+'</div></div></div>';}
  function versionHistoryModalHtml(){var rows=auditRows().filter(function(r){return r.area==='Mẫu Checklist'||r.area==='Bảng tổng điểm';}).slice(0,10);return '<div class="phfck-modal-layer phfck-edit-layer" data-phfck-submodal><div class="phfck-modal phfck-version-modal"><div class="phfck-modal-head"><div><small>LỊCH SỬ PHIÊN BẢN</small><h2>'+esc((CHECKLIST_TEMPLATE_CATALOG.find(function(x){return x.id===templateUiState.selectedId;})||{}).name||'Mẫu Checklist')+'</h2></div><button type="button" data-phfck-close-submodal>×</button></div><div class="phfck-modal-body"><div class="phfck-history-list">'+rows.map(function(r){return '<article><span>'+esc(r.time)+'</span><div><b>'+esc(r.action)+' · '+esc(r.version||'—')+'</b><p>'+esc(r.reason||'Không có lý do')+'</p></div><em>'+esc(r.source)+'</em></article>';}).join('')+'</div></div><div class="phfck-modal-foot"><button type="button" class="phfck-secondary" data-phfck-close-submodal>Đóng</button></div></div></div>';}
  function appendSubmodal(root,html){root.querySelectorAll('[data-phfck-submodal]').forEach(function(n){n.remove();});root.insertAdjacentHTML('beforeend',html);syncChecklistModalScrollLock();}
  function viewWorkbookMetaBase(templateId){
    var item=CHECKLIST_TEMPLATE_CATALOG.find(function(x){return x.id===templateId;})||{};
    var cfg=ASSISTANT_TEMPLATE_CONFIGS[templateId];
    var meta={name:item.name||'Mẫu Checklist',code:'',version:'',policy:'',source:item.source||'',scope:item.note||''};
    if(cfg){meta.name=cfg.title||meta.name;meta.code=cfg.code||'';meta.version=cfg.version||'';meta.policy=cfg.policy||'';meta.source=cfg.source||meta.source;meta.scope=cfg.scope||meta.scope;return meta;}
    if(templateId==='truong-ca-ban-hang')return {name:'Trưởng ca/Phó ca bán hàng',code:'TCP-BH',version:'TCP-BH-1.0',policy:'TCP-BH-TỔNG-1.0',source:'Kế thừa mẫu Nhân viên bán hàng + tiêu chí quản lý ca',scope:'Áp dụng cho Trưởng ca/Phó ca bán hàng'};
    if(templateId==='nv-kho')return {name:'Nhân viên Kho & Sơ chế',code:'NVK',version:'NVK-1.0',policy:'NVK-TỔNG-1.0',source:'File gốc Nhân viên Kho & Sơ chế',scope:'Áp dụng cho Nhân viên Kho & Sơ chế'};
    if(templateId==='tbp-kho')return {name:'Trưởng bộ phận Kho & Sơ chế',code:'TBP-KHO',version:'TBP-KHO-1.0',policy:'TBP-KHO-TỔNG-1.0',source:'Kế thừa Nhân viên Kho + tiêu chí quản lý bộ phận',scope:'Áp dụng cho Trưởng bộ phận Kho & Sơ chế'};
    return {name:'Nhân viên bán hàng',code:'BH',version:'BH-1.0',policy:'NVBH-TỔNG-1.0',source:'Mẫu chuẩn Nhân viên bán hàng',scope:'Áp dụng cho Nhân viên bán hàng'};
  }
  function viewWorkbookMeta(templateId){var base=viewWorkbookMetaBase(templateId);var override=loadBulkOverride(templateId);if(override&&override.version)base.version=override.version;return base;}
  function viewWorkbookTotalRowsBase(templateId){
    var cfg=ASSISTANT_TEMPLATE_CONFIGS[templateId];
    if(cfg&&Array.isArray(cfg.rows))return cfg.rows.map(function(r,index){return [index+1,'CT-'+String(index+1).padStart(2,'0'),r[0],r[1],r[4]||'điểm',r[2],r[3]==='monthly'?'Có':'Không'];});
    if(templateId==='nv-kho')return [[1,'NVK-LAPPHIEU','Lập phiếu và đánh giá công việc tháng',5,'phiếu',5,'Không'],[2,'NVK-TUANTHU','Tuân thủ tiêu chuẩn công việc',100,'điểm',65,'Không'],[3,'NVK-KIEMKE','Kiểm kê hàng hóa định kỳ',10,'điểm',10,'Không'],[4,'NVK-BAOCAO','Báo cáo công việc đúng quy định',10,'điểm',10,'Không'],[5,'NVK-CAPTren','Thực hiện công việc cấp trên giao',10,'điểm',10,'Không']];
    if(templateId==='tbp-kho')return [[1,'TBPK-LAPPHIEU','Lập phiếu và đánh giá công việc tháng',5,'phiếu',5,'Không'],[2,'TBPK-TUANTHU','Tuân thủ tiêu chuẩn công việc',100,'điểm',60,'Không'],[3,'TBPK-KIEMKE','Kiểm kê tổng kho định kỳ',3,'lần',10,'Không'],[4,'TBPK-DAOTAO','Đào tạo nhân viên theo kế hoạch',1,'buổi',5,'Không'],[5,'TBPK-BAOCAO','Báo cáo công việc đúng quy định',10,'điểm',10,'Không'],[6,'TBPK-CAPTren','Thực hiện công việc cấp trên giao',10,'điểm',10,'Không']];
    return [[1,'HQCV-LAPPHIEU','Lập phiếu và đánh giá công việc tháng',5,'phiếu',5,'Không'],[2,'HQCV-TUANTHU','Tuân thủ tiêu chuẩn công việc',100,'điểm',70,'Không'],[3,'HQCV-CAPTren','Công việc cấp trên giao',10,'điểm',25,'Không']];
  }
  function setViewSheetWidths(ws,widths){ws['!cols']=widths.map(function(w){return {wch:w};});}
  function viewCellStyle(kind){
    var border={top:{style:'thin',color:{rgb:'D9E2E3'}},bottom:{style:'thin',color:{rgb:'D9E2E3'}},left:{style:'thin',color:{rgb:'D9E2E3'}},right:{style:'thin',color:{rgb:'D9E2E3'}}};
    var styles={
      title:{font:{name:'Arial',sz:17,bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'0B5D46'}},alignment:{horizontal:'center',vertical:'center'}},
      subtitle:{font:{name:'Arial',sz:10,italic:true,color:{rgb:'46635A'}},fill:{fgColor:{rgb:'EAF4EF'}},alignment:{horizontal:'left',vertical:'center',wrapText:true}},
      section:{font:{name:'Arial',sz:11,bold:true,color:{rgb:'0B5D46'}},fill:{fgColor:{rgb:'DDEFE6'}},alignment:{vertical:'center'}},
      header:{font:{name:'Arial',sz:10,bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'2F6B57'}},alignment:{horizontal:'center',vertical:'center',wrapText:true},border:border},
      group:{font:{name:'Arial',sz:10,bold:true,color:{rgb:'0B5D46'}},fill:{fgColor:{rgb:'EAF4EF'}},alignment:{vertical:'center',wrapText:true},border:border},
      label:{font:{name:'Arial',sz:10,bold:true,color:{rgb:'3D524B'}},fill:{fgColor:{rgb:'F1F4F3'}},alignment:{vertical:'center',wrapText:true},border:border},
      body:{font:{name:'Arial',sz:10,color:{rgb:'1F2D28'}},alignment:{vertical:'top',wrapText:true},border:border},
      center:{font:{name:'Arial',sz:10,color:{rgb:'1F2D28'}},alignment:{horizontal:'center',vertical:'center',wrapText:true},border:border},
      note:{font:{name:'Arial',sz:9,italic:true,color:{rgb:'5D6F68'}},fill:{fgColor:{rgb:'F7FAF8'}},alignment:{vertical:'top',wrapText:true},border:border},
      total:{font:{name:'Arial',sz:10,bold:true,color:{rgb:'0B5D46'}},fill:{fgColor:{rgb:'DDEFE6'}},alignment:{horizontal:'center',vertical:'center',wrapText:true},border:border},
      warning:{font:{name:'Arial',sz:10,bold:true,color:{rgb:'7F6000'}},fill:{fgColor:{rgb:'FFF2CC'}},alignment:{vertical:'center',wrapText:true},border:border}
    };
    return styles[kind]||styles.body;
  }
  function applySheetStyle(ws,range,kind){
    var r=XLSX.utils.decode_range(range);
    for(var R=r.s.r;R<=r.e.r;R++)for(var C=r.s.c;C<=r.e.c;C++){
      var addr=XLSX.utils.encode_cell({r:R,c:C});
      if(!ws[addr])ws[addr]={t:'s',v:''};
      ws[addr].s=viewCellStyle(kind);
    }
  }
  function mergeAndSet(ws,range,value,kind){
    ws['!merges']=ws['!merges']||[];ws['!merges'].push(XLSX.utils.decode_range(range));
    var first=range.split(':')[0];ws[first]=ws[first]||{t:'s',v:''};ws[first].v=value;ws[first].t='s';applySheetStyle(ws,range,kind);
  }
  function viewWorkbookTotalRows(templateId){return effectiveTotalRows(templateId);}
  function normalizeTotalViewRows(templateId){
    return viewWorkbookTotalRows(templateId).map(function(r,index){
      var target=String(r[3])+(r[4]?' '+r[4]:'');
      var source=/tuân thủ|checklist/i.test(r[2])?'Checklist':(/lập phiếu/i.test(r[2])?'Hệ thống':'Nhập đánh giá');
      var note=r[6]==='Có'?'Thay đổi theo kế hoạch tháng; chỉ áp dụng cho kỳ/phiên bản mới.':'Áp dụng theo mẫu hiện hành.';
      return [index+1,r[1],r[2],target,r[5]/100,'Phát sinh khi đánh giá tháng','Phát sinh khi đánh giá tháng','Theo công thức 1:2','Theo trọng số',source,note];
    });
  }
  function phfckDownloadStaticWorkbook(url,fileName){
    return fetch(url,{cache:'no-store'}).then(function(res){if(!res.ok)throw new Error('Không tải được file mẫu: '+res.status);return res.blob();}).then(function(blob){var objectUrl=URL.createObjectURL(blob);var a=document.createElement('a');a.href=objectUrl;a.download=fileName;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(objectUrl);},1500);return true;});
  }
  function downloadViewWorkbook(){
    var templateId=templateUiState.selectedId||'nv-ban-hang';var meta=viewWorkbookMeta(templateId);
    var safeName=(meta.name||meta.code||templateId);if(safeName.normalize)safeName=safeName.normalize('NFD').replace(/[\u0300-\u036f]/g,'');safeName=String(safeName).replace(/Đ/g,'D').replace(/đ/g,'d').replace(/[^A-Za-z0-9_-]+/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');
    var fileName='PHF_Checklist_'+safeName+'_'+(meta.version||'HIEN_HANH').replace(/[^A-Za-z0-9_.-]+/g,'_')+'.xlsx';
    return phfckDownloadStaticWorkbook('/assets/templates/checklist-view/'+encodeURIComponent(templateId)+'.xlsx?v=1.7.53',fileName).catch(function(err){console.error('[PHF Checklist] download styled workbook failed',err);if(window.phfNotice)window.phfNotice('Không tải được file Excel trình bày chuẩn. Vui lòng kiểm tra đã copy thư mục assets/templates/checklist-view và tải lại trang.');return false;});
  }
  function downloadBulkWorkbook(){
    var id=templateUiState.selectedId||'nv-ban-hang',meta=viewWorkbookMeta(id),override=loadBulkOverride(id);
    if(override&&override.version&&override.version!==viewWorkbookMetaBase(id).version){if(window.phfNotice)window.phfNotice('Mẫu đang có phiên bản cập nhật cục bộ '+override.version+'. Để an toàn, file dropdown chỉ phát hành từ dữ liệu nguồn chính thức; vui lòng chưa tiếp tục import lần hai trên bản prototype.');return false;}
    var safe=(meta.code||id).replace(/[^A-Za-z0-9_-]+/g,'_');var fileName='PHF_CAP_NHAT_HANG_LOAT_'+safe+'_'+String(meta.version).replace(/[^A-Za-z0-9_.-]+/g,'_')+'.xlsx';
    return phfckDownloadStaticWorkbook('/assets/templates/checklist-import/'+encodeURIComponent(id)+'.xlsx?v=1.7.55',fileName).catch(function(err){console.error('[PHF Checklist] download safe bulk workbook failed',err);if(window.phfNotice)window.phfNotice('Không tải được file cập nhật an toàn. Vui lòng kiểm tra đã copy thư mục assets/templates/checklist-import và Ctrl + F5.');return false;});
  }
  function templatesHtml(){
    var groups=['all'].concat(Array.from(new Set(CHECKLIST_TEMPLATE_CATALOG.map(function(x){return x.group;}))));
    return '<div class="phfck-page-head phfck-template-head"><div><small>PHF CHECKLIST · ADMIN</small><h1>Mẫu Checklist</h1><p>Xây từng mẫu chậm và chắc. Mười ba mẫu đã được chuẩn hóa theo cùng chuẩn trải nghiệm, gồm 4 mẫu vận hành, 3 mẫu Trợ lý, 2 mẫu Marketing, 2 mẫu QTTH/HCNS và 2 mẫu Gói quà.</p></div><button class="phfck-primary" type="button" disabled title="Chỉ tạo mẫu mới sau khi chuẩn hóa xong các bộ nguồn">＋ Tạo mẫu</button></div>'
      +templateStatsHtml()
      +'<section class="phfck-panel phfck-template-panel"><div class="phfck-template-toolbar"><div class="phfck-search"><span>⌕</span><input type="search" placeholder="Tìm tên mẫu, nhóm hoặc nguồn" value="'+esc(templateUiState.query)+'" data-phfck-template-search></div><label><span>Nhóm</span><select data-phfck-template-group>'+groups.map(function(g){return '<option value="'+esc(g)+'" '+(templateUiState.group===g?'selected':'')+'>'+(g==='all'?'Tất cả nhóm':esc(g))+'</option>';}).join('')+'</select></label><div class="phfck-filter-note"><span class="phfck-dot"></span>Nguồn chuẩn: gói Checklist</div></div><div data-phfck-template-list>'+templateCardsHtml()+'</div></section>'
      +(templateUiState.selectedId?templateDetailModalHtml(CHECKLIST_TEMPLATE_CATALOG.find(function(x){return x.id===templateUiState.selectedId;})):'');
  }
  function salesExportRows(blank,templateId){
    var override=loadBulkOverride(templateId);var groups=override&&Array.isArray(override.groups)?override.groups:baseTemplateGroups(templateId);
    var rows=[['Mã nhóm cha','Tên nhóm cha','Mã nhóm con','Tên nhóm con','Mã tiêu chí','Nội dung tiêu chí','Loại tiêu chí','Hệ số','Minh chứng','Ghi chú bắt buộc','Quyền ghi nhận','Trạng thái']];
    groups.forEach(function(group){group.children.forEach(function(child){
      if(blank){rows.push([group.code,group.name,child.code,child.name,'','','Riêng','1','Khuyến khích','Có','Theo phân quyền','Đang áp dụng']);return;}
      child.items.forEach(function(item){rows.push([group.code,group.name,child.code,child.name,item[0],item[1],item[0]==='BH-DITRE-01'?'Chung':'Riêng',item[2],'Khuyến khích','Có',item[0]==='BH-DITRE-01'?'Chỉ Admin':'Theo phân quyền','Đang áp dụng']);});
    });});
    return rows;
  }
  function downloadSalesTemplate(kind,templateId){
    templateId=templateId||templateUiState.selectedId||'nv-ban-hang';
    var isShift=templateId==='truong-ca-ban-hang';var isWarehouse=templateId==='nv-kho';var isWarehouseManager=templateId==='tbp-kho';var assistantConfig=ASSISTANT_TEMPLATE_CONFIGS[templateId];
    var rows=salesExportRows(kind==='blank',templateId);
    var csv='\uFEFF'+rows.map(function(row){return row.map(function(v){return '"'+String(v==null?'':v).replace(/"/g,'""')+'"';}).join(',');}).join('\r\n');
    var blob=new Blob([csv],{type:'text/csv;charset=utf-8'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;var baseName=assistantConfig?assistantConfig.code:(isShift?'TRUONG_PHO_CA_BAN_HANG':(isWarehouse?'NHAN_VIEN_KHO':(isWarehouseManager?'TBP_KHO':'BAN_HANG')));a.download=kind==='blank'?('PHF_MAU_CHUAN_CHECKLIST_'+baseName+'.csv'):('PHF_CHECKLIST_'+baseName+'_'+(assistantConfig?assistantConfig.version:(isShift?'TCP-BH-1.0':(isWarehouse?'NVK-1.0':(isWarehouseManager?'TBP-KHO-1.0':'BH-1.0'))))+'.csv');document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},300);
  }
  function syncTotalScoreScroll(root){
    var top=root.querySelector('[data-phfck-total-scroll-top]');
    var main=root.querySelector('[data-phfck-total-scroll-main]');
    if(!top||!main)return;
    var inner=top.firstElementChild;
    var table=main.querySelector('.phfck-total-table');
    if(inner&&table)inner.style.width=Math.max(table.scrollWidth,main.clientWidth)+'px';
    var syncing=false;
    top.addEventListener('scroll',function(){if(syncing)return;syncing=true;main.scrollLeft=top.scrollLeft;syncing=false;});
    main.addEventListener('scroll',function(){if(syncing)return;syncing=true;top.scrollLeft=main.scrollLeft;syncing=false;});
    main.addEventListener('wheel',function(ev){
      if(Math.abs(ev.deltaY)>Math.abs(ev.deltaX)&&main.scrollWidth>main.clientWidth){
        ev.preventDefault();main.scrollLeft+=ev.deltaY;
      }
    },{passive:false});
    var dragging=false,startX=0,startLeft=0;
    main.addEventListener('pointerdown',function(ev){if(ev.button!==0||ev.target.closest('button,input,select,a'))return;dragging=true;startX=ev.clientX;startLeft=main.scrollLeft;main.classList.add('is-dragging');main.setPointerCapture(ev.pointerId);});
    main.addEventListener('pointermove',function(ev){if(!dragging)return;main.scrollLeft=startLeft-(ev.clientX-startX);});
    function stop(ev){if(!dragging)return;dragging=false;main.classList.remove('is-dragging');try{main.releasePointerCapture(ev.pointerId);}catch(_e){}}
    main.addEventListener('pointerup',stop);main.addEventListener('pointercancel',stop);
  }
  function refreshTemplatesWorkspace(root){
    var workspace=root.querySelector('[data-phfck-workspace]');
    if(workspace&&adminViewFromPath(location.pathname)==='templates'){workspace.innerHTML=templatesHtml();requestAnimationFrame(function(){syncTotalScoreScroll(root);});}
  }

  function violationEmployeesOptions(){
    var rows=checklistEmployees();
    return '<option value="">Chọn nhân viên cần ghi nhận</option>'+rows.map(function(item){return '<option value="'+esc(item.id)+'" '+(violationUiState.employeeId===item.id?'selected':'')+'>'+esc(item.name)+(item.code?' · '+esc(item.code):'')+'</option>';}).join('');
  }
  function violationTemplateOptions(){
    return '<option value="">Chọn mẫu đang áp dụng</option>'+CHECKLIST_TEMPLATE_CATALOG.filter(function(item){return item.hasChecklist;}).map(function(item){return '<option value="'+esc(item.id)+'" '+(violationUiState.templateId===item.id?'selected':'')+'>'+esc(item.name)+(item.id==='nv-online'?' · chuẩn Quyên':'')+'</option>';}).join('');
  }
  function violationFlowHtml(){
    var steps=[['1','Chọn nhân sự','Xác định người và mẫu đang áp dụng'],['2','Chọn tiêu chí','Lấy đúng phiên bản tại ngày xảy ra'],['3','Ghi nhận sự việc','Mô tả, thời gian và minh chứng'],['4','Kiểm tra & gửi','Nháp hoặc ghi nhận chính thức']];
    return '<ol class="phfck-violation-steps">'+steps.map(function(item,index){var n=index+1;return '<li class="'+(n===violationUiState.step?'is-active':(n<violationUiState.step?'is-done':''))+'"><span>'+item[0]+'</span><div><b>'+item[1]+'</b><small>'+item[2]+'</small></div></li>';}).join('')+'</ol>';
  }
  function violationTabsHtml(){
    return '<div class="phfck-violation-tabs" role="tablist" aria-label="Chế độ ghi nhận lỗi">'
      +'<button type="button" class="'+(violationUiState.mode==='quick'?'active':'')+'" data-phfck-violation-tab="quick"><span>⚡</span><div><b>Nhập nhanh</b><small>Chọn Không đạt và nhận xét ngay tại dòng</small></div></button>'
      +'<button type="button" class="'+(violationUiState.mode==='detail'?'active':'')+'" data-phfck-violation-tab="detail"><span>▤</span><div><b>Ghi nhận chi tiết</b><small>Dùng cho lỗi riêng lẻ hoặc cần nhiều minh chứng</small></div></button>'
      +'<button type="button" class="'+(violationUiState.mode==='multi'?'active':'')+'" data-phfck-violation-tab="multi"><span>▦</span><div><b>Ghi nhận nhiều ngày</b><small>Nhập bù nhiều sự việc cho cùng một nhân viên</small></div></button>'
      +'<button type="button" class="'+(violationUiState.mode==='late'?'active':'')+'" data-phfck-violation-tab="late"><span>◷</span><div><b>Đi trễ</b><small>Admin nhập dồn theo tuần hoặc cuối tháng</small></div></button>'
    +'</div>';
  }
  var QUICK_CRITERIA_PREVIEW=Object.freeze([
    {id:'tc-01',code:'TC01',group:'Tuân thủ chung',text:'Không thực hiện đúng quy định tại vị trí làm việc',points:2,evidence:'recommended'},
    {id:'tc-02',code:'TC02',group:'Thực hiện công việc',text:'Không hoàn thành đúng bước công việc được giao',points:3,evidence:'required'},
    {id:'tc-03',code:'TC03',group:'Vệ sinh & hình ảnh',text:'Khu vực phụ trách chưa đảm bảo tiêu chuẩn',points:2,evidence:'required'},
    {id:'tc-04',code:'TC04',group:'Phối hợp & báo cáo',text:'Không báo cáo hoặc phối hợp đúng thời hạn',points:1,evidence:'recommended'}
  ]);
  function quickCriteriaFiltered(){
    var q=String(violationUiState.query||'').trim().toLowerCase();
    return QUICK_CRITERIA_PREVIEW.filter(function(item){
      var groupOk=violationUiState.group==='all'||item.group===violationUiState.group;
      var qOk=!q||[item.code,item.group,item.text].join(' ').toLowerCase().indexOf(q)>-1;
      return groupOk&&qOk;
    });
  }
  function quickSelectedCount(){return Object.keys(violationUiState.selected||{}).filter(function(k){return violationUiState.selected[k]&&violationUiState.selected[k].selected;}).length;}
  function quickSelectedPoints(){return Object.keys(violationUiState.selected||{}).reduce(function(total,k){var st=violationUiState.selected[k];var item=QUICK_CRITERIA_PREVIEW.find(function(x){return x.id===k;});return total+(st&&st.selected&&item?Number(item.points||0):0);},0);}
  function quickCriteriaRowsHtml(){
    var rows=quickCriteriaFiltered();
    if(!rows.length)return '<div class="phfck-quick-empty">Không tìm thấy tiêu chí phù hợp.</div>';
    return rows.map(function(item,index){var st=violationUiState.selected[item.id]||{};var selected=!!st.selected;return '<article class="phfck-quick-row '+(selected?'is-selected':'')+'" data-phfck-quick-row="'+esc(item.id)+'">'
      +'<div class="phfck-quick-index">'+String(index+1).padStart(2,'0')+'</div>'
      +'<div class="phfck-quick-criterion"><small>'+esc(item.group)+' · '+esc(item.code)+'</small><b>'+esc(item.text)+'</b><span>Trừ '+esc(item.points)+' điểm · '+(item.evidence==='required'?'Bắt buộc minh chứng':'Khuyến khích minh chứng')+'</span></div>'
      +'<button type="button" class="phfck-quick-toggle '+(selected?'is-remove':'')+'" data-phfck-quick-toggle="'+esc(item.id)+'" aria-pressed="'+(selected?'true':'false')+'" aria-label="'+(selected?'Bỏ chọn tiêu chí':'Chọn tiêu chí không đạt')+'" title="'+(selected?'Bỏ chọn':'Không đạt')+'">'+(selected?'×':'Không đạt')+'</button>'
      +'<div class="phfck-quick-detail"><label><b>Nhận xét <em>*</em></b><textarea rows="2" data-phfck-quick-note="'+esc(item.id)+'" placeholder="Mô tả ngắn sự việc">'+esc(st.note||'')+'</textarea></label><label><b>Giờ</b>'+timePickerButtonHtml(st.time||currentTime24(),'data-phfck-quick-time="'+esc(item.id)+'"')+'</label><button type="button" class="phfck-quick-evidence" data-phfck-quick-evidence="'+esc(item.id)+'">＋ Minh chứng</button></div>'
    +'</article>';}).join('');
  }
  function selectedErrorsHtml(){var ids=Object.keys(violationUiState.selected||{}).filter(function(k){return violationUiState.selected[k]&&violationUiState.selected[k].selected;});if(!ids.length)return '';return '<section class="phfck-selected-errors"><div class="phfck-selected-errors-head"><div><small>CÁC LỖI ĐÃ CHỌN</small><b>'+ids.length+' tiêu chí</b></div><span>Dễ rà trước khi ghi nhận</span></div><div class="phfck-selected-errors-list">'+ids.map(function(id){var item=QUICK_CRITERIA_PREVIEW.find(function(x){return x.id===id;});var st=violationUiState.selected[id]||{};return item?'<article><div><small>'+esc(item.code)+' · '+esc(item.group)+'</small><b>'+esc(item.text)+'</b><span>'+esc(st.time||currentTime24())+' · Trừ '+esc(item.points)+' điểm</span></div><button type="button" data-phfck-quick-toggle="'+esc(id)+'" aria-label="Bỏ chọn">×</button></article>':'';}).join('')+'</div></section>';}
  function quickFooterHtml(){var count=quickSelectedCount(),points=quickSelectedPoints(),notesOk=Object.keys(violationUiState.selected||{}).filter(function(k){return violationUiState.selected[k]&&violationUiState.selected[k].selected;}).every(function(k){return String((violationUiState.selected[k]||{}).note||'').trim();}),ready=count>0&&notesOk&&!!violationUiState.employeeId&&!!violationUiState.templateId;return '<div class="phfck-quick-footer"><div><strong data-phfck-quick-count>'+count+' lỗi đã chọn · Dự kiến trừ '+points+' điểm</strong><small>Ghi nhận chính thức mới trừ điểm tạm.</small></div><div><button type="button" class="phfck-secondary" data-phfck-quick-draft '+(ready?'':'disabled')+'>Lưu nháp</button><button type="button" class="phfck-primary" data-phfck-quick-submit '+(ready?'':'disabled')+'>Ghi nhận</button></div></div>';}
  function violationQuickHtml(){
    ensureViolationDefaults();var dateValue=violationUiState.date;
    var groups=['all'].concat(Array.from(new Set(QUICK_CRITERIA_PREVIEW.map(function(x){return x.group;}))));
    return '<section class="phfck-panel phfck-quick-entry">'
      +'<div class="phfck-panel-head"><div><small>NHẬP NHANH</small><h3>Chỉ chọn tiêu chí có lỗi</h3></div><span class="phfck-status">Mặc định</span></div>'
      +'<div class="phfck-quick-context"><label><b>Nhân viên <em>*</em></b><select data-phfck-violation-field="employee">'+violationEmployeesOptions()+'</select></label><label><b>Mẫu Checklist <em>*</em></b><select data-phfck-violation-field="template">'+violationTemplateOptions()+'</select></label><label><b>Ngày</b><input type="date" value="'+dateValue+'" data-phfck-quick-date></label><label><b>Địa điểm</b><input type="text" value="'+esc(violationUiState.location||'')+'" placeholder="Chi nhánh/khu vực" data-phfck-quick-location></label></div>'
      +'<div class="phfck-quick-toolbar"><div class="phfck-search"><span>⌕</span><input type="search" data-phfck-quick-search placeholder="Tìm tiêu chí" value="'+esc(violationUiState.query)+'"></div><label><span>Nhóm</span><select data-phfck-quick-group>'+groups.map(function(g){return '<option value="'+esc(g)+'" '+(violationUiState.group===g?'selected':'')+'>'+(g==='all'?'Tất cả nhóm':esc(g))+'</option>';}).join('')+'</select></label></div>'
      +'<div class="phfck-quick-list" data-phfck-quick-list>'+quickCriteriaRowsHtml()+'</div>'
      +selectedErrorsHtml()
      +'<section class="phfck-shared-tools"><div><b>Thông tin dùng chung</b><small>Giữ lại khi ghi tiếp cho nhân viên này.</small></div><label><input type="checkbox" data-phfck-shared-evidence '+(violationUiState.sharedEvidence?'checked':'')+'> Dùng cùng minh chứng cho các lỗi đã chọn</label></section>'
      +quickFooterHtml()
    +'</section>';
  }

  function multiDayRowDefault(){return {id:'md-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),date:violationUiState.date||todayIso(),time:currentTime24(),criterion:'',note:'',evidence:false};}
  function ensureMultiRows(){ensureViolationDefaults();if(!violationUiState.multiRows.length)violationUiState.multiRows=[multiDayRowDefault()];}
  function multiDayRowsHtml(){ensureMultiRows();return violationUiState.multiRows.map(function(row,index){return '<article class="phfck-multi-row" data-phfck-multi-row="'+esc(row.id)+'"><div class="phfck-multi-no">'+String(index+1).padStart(2,'0')+'</div><label><span>Ngày</span><input type="date" value="'+esc(row.date)+'" data-phfck-multi-field="date"></label><label><span>Giờ</span>'+timePickerButtonHtml(row.time,'data-phfck-multi-field="time"')+'</label><label class="phfck-multi-criterion"><span>Tiêu chí</span><select data-phfck-multi-field="criterion"><option value="">Chọn tiêu chí lỗi</option>'+QUICK_CRITERIA_PREVIEW.map(function(item){return '<option value="'+esc(item.id)+'" '+(row.criterion===item.id?'selected':'')+'>'+esc(item.code)+' · '+esc(item.text)+'</option>';}).join('')+'</select></label><label class="phfck-multi-note"><span>Nhận xét *</span><input type="text" value="'+esc(row.note||'')+'" placeholder="Mô tả ngắn sự việc" data-phfck-multi-field="note"></label><button type="button" class="phfck-multi-evidence '+(row.evidence?'active':'')+'" data-phfck-multi-evidence title="Minh chứng">＋</button><button type="button" class="phfck-multi-remove" data-phfck-multi-remove aria-label="Xóa dòng">×</button></article>';}).join('');}
  function violationMultiHtml(){ensureMultiRows();var days={};violationUiState.multiRows.forEach(function(r){if(r.date)days[r.date]=1;});return '<section class="phfck-panel phfck-multi-entry"><div class="phfck-panel-head"><div><small>GHI NHẬN NHIỀU NGÀY</small><h3>Một nhân viên · nhiều sự việc độc lập</h3></div><span class="phfck-status">Nhập bù</span></div><div class="phfck-multi-context"><label><b>Nhân viên <em>*</em></b><select data-phfck-violation-field="employee">'+violationEmployeesOptions()+'</select></label><label><b>Mẫu Checklist <em>*</em></b><select data-phfck-violation-field="template">'+violationTemplateOptions()+'</select></label><label><b>Địa điểm dùng chung</b><input type="text" value="'+esc(violationUiState.location||'')+'" placeholder="Chi nhánh/khu vực" data-phfck-quick-location></label></div><div class="phfck-multi-head"><div><b>Danh sách sự việc</b><small>Mỗi dòng là một lỗi riêng theo ngày, giờ và tiêu chí.</small></div><button type="button" class="phfck-secondary" data-phfck-multi-add>＋ Thêm sự việc</button></div><div class="phfck-multi-list" data-phfck-multi-list>'+multiDayRowsHtml()+'</div><div class="phfck-multi-footer"><div><strong>'+violationUiState.multiRows.length+' sự việc · '+Object.keys(days).length+' ngày</strong><small>Nhận xét bắt buộc cho từng dòng.</small></div><div><button type="button" class="phfck-secondary" disabled>Lưu nháp</button><button type="button" class="phfck-primary" disabled>Ghi nhận</button></div></div></section>';}

  function lateRowDefault(){return {id:'lt-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),employee:'',date:todayIso(),shift:'Ca sáng',minutes:1,level:'01–15 phút',suggested:1,points:1,note:'',adjustReason:''};}
  function ensureLateRows(){if(!Array.isArray(violationUiState.lateRows))violationUiState.lateRows=[];if(!violationUiState.lateRows.length)violationUiState.lateRows=[lateRowDefault()];}
  function lateRule(minutes){minutes=Math.max(0,Number(minutes)||0);if(minutes<=0)return {level:'Đúng giờ',points:0,key:'ontime'};if(minutes<=15)return {level:'01–15 phút',points:1,key:'level1'};if(minutes<=30)return {level:'16–30 phút',points:2,key:'level2'};if(minutes<=45)return {level:'31–45 phút',points:3,key:'level3'};return {level:'Từ 46 phút',points:4,key:'level4'};}
  function recalcLateRow(row,forceSuggested){row.minutes=Math.max(0,Math.round(Number(row.minutes)||0));var oldSuggested=Number(row.suggested||0),oldPoints=Number(row.points||0),rule=lateRule(row.minutes);row.level=rule.level;row.levelKey=rule.key;row.suggested=rule.points;if(forceSuggested||row.points==null||row.points===''||oldPoints===oldSuggested)row.points=rule.points;}
  function lateEmployeeOptions(selected){return '<option value="">Chọn nhân viên</option>'+checklistEmployees().map(function(person){return '<option value="'+esc(person.id)+'" '+(String(selected||'')===String(person.id)?'selected':'')+'>'+esc(person.name)+' · '+esc(person.code)+'</option>';}).join('');}
  function lateShiftOptions(selected){return ['Ca sáng','Ca chiều','Ca tối','Ca gãy','Hành chính','Khác'].map(function(item){return '<option value="'+esc(item)+'" '+(item===selected?'selected':'')+'>'+esc(item)+'</option>';}).join('');}
  function lateRowsHeaderHtml(){return '<div class="phfck-late-table-head"><span>STT</span><span>Nhân viên</span><span>Ngày</span><span>Ca làm</span><span>Số phút trễ</span><span>Mức vi phạm</span><span>Điểm gợi ý</span><span>Điểm trừ</span><span>Ghi chú *</span><span>Lý do chỉnh</span><span></span></div>';}
  function lateRowsHtml(){ensureLateRows();return violationUiState.lateRows.map(function(row,index){recalcLateRow(row,false);var adjusted=Number(row.points)!==Number(row.suggested);return '<article class="phfck-late-row" data-phfck-late-row="'+esc(row.id)+'">'
    +'<div class="phfck-multi-no">'+String(index+1).padStart(2,'0')+'</div>'
    +'<label class="phfck-late-employee"><span>Nhân viên</span><select data-phfck-late-field="employee">'+lateEmployeeOptions(row.employee)+'</select></label>'
    +'<label class="phfck-late-date"><span>Ngày</span><input type="date" value="'+esc(row.date)+'" data-phfck-late-field="date"></label>'
    +'<label class="phfck-late-shift"><span>Ca làm</span><select data-phfck-late-field="shift">'+lateShiftOptions(row.shift)+'</select></label>'
    +'<label class="phfck-late-minutes"><span>Số phút trễ</span><input type="number" min="1" step="1" inputmode="numeric" value="'+esc(row.minutes)+'" data-phfck-late-field="minutes"></label>'
    +'<div class="phfck-late-level"><span>Mức vi phạm</span><b class="phfck-late-chip is-'+esc(row.levelKey||'ontime')+'">'+esc(row.level)+'</b></div>'
    +'<div class="phfck-late-suggested"><span>Điểm gợi ý</span><b class="phfck-score-chip">'+esc(row.suggested)+' điểm</b></div>'
    +'<label class="phfck-late-points"><span>Điểm trừ</span><input type="number" min="0" step="1" value="'+esc(row.points)+'" data-phfck-late-field="points"></label>'
    +'<label class="phfck-late-note"><span>Ghi chú *</span><input type="text" value="'+esc(row.note)+'" placeholder="Nêu rõ trường hợp đi trễ" data-phfck-late-field="note"></label>'
    +'<label class="phfck-late-reason '+(adjusted?'is-required':'')+'"><span>Lý do chỉnh'+(adjusted?' *':'')+'</span><input type="text" value="'+esc(row.adjustReason)+'" placeholder="'+(adjusted?'Bắt buộc khi khác gợi ý':'Không thay đổi')+'" '+(adjusted?'':'disabled')+' data-phfck-late-field="adjustReason"></label>'
    +'<button type="button" class="phfck-multi-remove phfck-late-remove" data-phfck-late-remove aria-label="Xóa dòng">×</button></article>';}).join('');}
  function csvEscape(value){var text=String(value==null?'':value);return /[",\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;}
  function downloadTextFile(name,text){var blob=new Blob(['\ufeff'+text],{type:'text/csv;charset=utf-8'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},300);}
  function formatDateCsv(iso){var m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?m[3]+'/'+m[2]+'/'+m[1]:iso;}
  function parseDateCsv(value){var text=String(value||'').trim();var m=text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);if(m)return m[3]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[1]).padStart(2,'0');if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;return '';}
  function downloadLateTemplate(){var rows=[['Ma_nhan_vien','Ho_ten','Ngay','Ca_lam','So_phut_tre','Diem_tru','Ghi_chu'],['NV001','Nguyen Van A',formatDateCsv(todayIso()),'Ca sáng','10','','Đi trễ do kẹt xe']];downloadTextFile('PHF_MAU_NHAP_DI_TRE.csv',rows.map(function(r){return r.map(csvEscape).join(',');}).join('\n'));}
  function exportLateRows(){ensureLateRows();var people=checklistEmployees();var rows=[['Ma_nhan_vien','Ho_ten','Ngay','Ca_lam','So_phut_tre','Muc_vi_pham','Diem_goi_y','Diem_tru','Ghi_chu','Ly_do_dieu_chinh']];violationUiState.lateRows.forEach(function(r){recalcLateRow(r,false);var p=people.find(function(x){return String(x.id)===String(r.employee);})||{};rows.push([p.code||'',p.name||'',formatDateCsv(r.date),r.shift,r.minutes,r.level,r.suggested,r.points,r.note,r.adjustReason]);});downloadTextFile('PHF_DI_TRE_DANG_NHAP.csv',rows.map(function(r){return r.map(csvEscape).join(',');}).join('\n'));}
  function parseCsv(text){var rows=[],row=[],cell='',quoted=false;for(var i=0;i<text.length;i++){var c=text[i],n=text[i+1];if(c==='"'){if(quoted&&n==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&n==='\n')i++;row.push(cell);if(row.some(function(v){return String(v).trim();}))rows.push(row);row=[];cell='';}else cell+=c;}row.push(cell);if(row.some(function(v){return String(v).trim();}))rows.push(row);return rows;}
  function importLateCsv(file,root){var reader=new FileReader();reader.onload=function(){var rows=parseCsv(String(reader.result||''));if(rows.length<2){if(window.phfNotice)window.phfNotice('File chưa có dữ liệu để nhập.');return;}var headers=rows[0].map(function(x){return normalizeText(x).toLowerCase();});function col(name){return headers.indexOf(normalizeText(name).toLowerCase());}var people=checklistEmployees(),result=[],errors=[];rows.slice(1).forEach(function(cols,idx){var code=String(cols[col('Ma_nhan_vien')]||'').trim(),name=String(cols[col('Ho_ten')]||'').trim();var person=people.find(function(p){return String(p.code||'').toLowerCase()===code.toLowerCase();})||people.find(function(p){return normalizeText(p.name).toLowerCase()===normalizeText(name).toLowerCase();});var date=parseDateCsv(cols[col('Ngay')]),shift=String(cols[col('Ca_lam')]||'Ca sáng').trim(),minutes=Math.max(0,Math.round(Number(cols[col('So_phut_tre')])||0)),pointsRaw=String(cols[col('Diem_tru')]||'').trim(),note=String(cols[col('Ghi_chu')]||'').trim();if(!person||!date||minutes<=0||!note){errors.push(idx+2);return;}var row=lateRowDefault();row.employee=person.id;row.date=date;row.shift=shift||'Ca sáng';row.minutes=minutes;recalcLateRow(row,true);if(pointsRaw!=='')row.points=Math.max(0,Number(pointsRaw)||0);row.note=note;result.push(row);});if(result.length){violationUiState.lateRows=result;var workspace=root.querySelector('[data-phfck-workspace]');rerenderKeepingScroll(workspace,violationsHtml());}if(window.phfNotice)window.phfNotice(result.length+' dòng hợp lệ đã được đưa vào màn xem trước'+(errors.length?'; bỏ qua dòng lỗi: '+errors.join(', '):'.'));};reader.readAsText(file,'utf-8');}
  function violationLateHtml(){ensureLateRows();var total=violationUiState.lateRows.reduce(function(n,r){recalcLateRow(r,false);return n+Number(r.points||0);},0);return '<section class="phfck-panel phfck-late-entry"><div class="phfck-panel-head"><div><small>CHỈ ADMIN</small><h3>Ghi nhận đi trễ theo danh sách</h3></div><span class="phfck-status">Nhập dồn</span></div><div class="phfck-late-note-top"><b>Tiêu chí chung · BH-DITRE-01</b><span>Nhập nhanh theo tuần hoặc cuối tháng.</span></div><div class="phfck-multi-head phfck-late-toolbar"><div><b>Danh sách đi trễ</b><small>Nhập trực tiếp hoặc dùng file mẫu từ hệ thống.</small></div><div class="phfck-late-actions"><button type="button" class="phfck-secondary" data-phfck-late-template>⇩ Tải file mẫu</button><button type="button" class="phfck-secondary" data-phfck-late-upload>⇧ Upload danh sách</button><button type="button" class="phfck-secondary" data-phfck-late-add>＋ Thêm dòng</button><input type="file" accept=".csv,text/csv" data-phfck-late-file hidden></div></div><div class="phfck-late-table-wrap">'+lateRowsHeaderHtml()+'<div class="phfck-late-list" data-phfck-late-list>'+lateRowsHtml()+'</div></div><div class="phfck-multi-footer"><div><strong>'+violationUiState.lateRows.length+' trường hợp · Tổng dự kiến trừ '+total+' điểm</strong><small>Mọi dòng bắt buộc ghi chú; điểm khác gợi ý phải nêu lý do.</small></div><div><button type="button" class="phfck-secondary" data-phfck-late-export>⇩ Xuất dữ liệu đang nhập</button><button type="button" class="phfck-secondary" disabled>Lưu nháp</button><button type="button" class="phfck-primary" disabled>Ghi nhận</button></div></div></section>'; }

  function openTimePicker(input){if(!input)return;document.querySelectorAll('.phfck-time-picker').forEach(function(x){x.remove();});var current=normalizeTime24(input.value,currentTime24()).split(':');var picker=document.createElement('div');picker.className='phfck-time-picker';picker.innerHTML='<div class="phfck-time-picker-head"><b>Chọn giờ 24 giờ</b><button type="button" data-phfck-time-now>Hiện tại</button></div><div class="phfck-time-picker-body"><div><small>Giờ</small><div class="phfck-time-options">'+Array.from({length:24},function(_,i){var v=String(i).padStart(2,'0');return '<button type="button" class="'+(v===current[0]?'active':'')+'" data-phfck-hour="'+v+'">'+v+'</button>';}).join('')+'</div></div><div><small>Phút</small><div class="phfck-time-options phfck-minute-options">'+Array.from({length:12},function(_,i){var v=String(i*5).padStart(2,'0');return '<button type="button" class="'+(v===current[1]?'active':'')+'" data-phfck-minute="'+v+'">'+v+'</button>';}).join('')+'</div></div></div><div class="phfck-time-picker-foot"><span data-phfck-time-preview>'+esc(current.join(':'))+'</span><button type="button" class="phfck-primary" data-phfck-time-apply>Chọn</button></div>';document.body.appendChild(picker);var rect=input.getBoundingClientRect();picker.style.left=Math.max(10,Math.min(window.innerWidth-picker.offsetWidth-10,rect.left))+'px';picker.style.top=Math.min(window.innerHeight-picker.offsetHeight-10,rect.bottom+6)+'px';picker.__target=input;}

  function violationDetailHtml(){
    return '<section class="phfck-violation-layout"><aside class="phfck-panel phfck-violation-flow"><div class="phfck-panel-head"><div><small>LUỒNG CHI TIẾT</small><h3>4 bước ghi nhận</h3></div></div>'+violationFlowHtml()+'<div class="phfck-notice"><b>Khi nào dùng màn này?</b><p>Lỗi riêng lẻ, lỗi nghiêm trọng, cần mô tả kỹ, nhiều minh chứng hoặc cần kiểm tra kỹ trước khi gửi.</p></div></aside>'+violationFormHtml()+'</section>';
  }
  function violationFormHtml(){
    return '<section class="phfck-panel phfck-violation-form">'
      +'<div class="phfck-panel-head"><div><small>PHIẾU GHI NHẬN CHI TIẾT</small><h3>Thông tin lỗi Checklist</h3></div><span class="phfck-status">Cấu trúc nghiệp vụ</span></div>'
      +'<div class="phfck-violation-grid">'
        +'<label><b>Nhân viên <em>*</em></b><select data-phfck-violation-field="employee">'+violationEmployeesOptions()+'</select><small>Danh mục nền chỉ lấy Họ tên và Mã NV từ Hub.</small></label>'
        +'<label><b>Mẫu Checklist <em>*</em></b><select data-phfck-violation-field="template">'+violationTemplateOptions()+'</select><small>Sau khi lưu thật, mẫu sẽ tự lấy từ phân công có hiệu lực.</small></label>'
        +'<label><b>Ngày xảy ra <em>*</em></b><input type="date" data-phfck-violation-field="date"></label>'
        +'<label><b>Thời gian</b>'+timePickerButtonHtml(currentTime24(),'data-phfck-violation-field="time"')+'</label>'
        +'<label class="phfck-span-2"><b>Tiêu chí vi phạm <em>*</em></b><select disabled><option>Chỉ mở sau khi chuẩn hóa tiêu chí và phân công mẫu</option></select><small>Tiêu chí phải thuộc đúng phiên bản đang hiệu lực tại thời điểm xảy ra.</small></label>'
        +'<label class="phfck-span-2"><b>Nội dung sự việc <em>*</em></b><textarea rows="4" placeholder="Mô tả rõ sự việc, bối cảnh và căn cứ phân biệt nếu cùng tiêu chí phát sinh nhiều lần"></textarea></label>'
        +'<label><b>Mức ghi nhận</b><select><option>Lỗi theo hệ số tiêu chí</option><option disabled>Lỗi nghiêm trọng · theo cấu hình mẫu</option></select></label>'
        +'<label><b>Minh chứng</b><div class="phfck-upload-placeholder"><span>＋</span><div><b>Ảnh hoặc file minh chứng</b><small>Chưa mở upload ở giai đoạn dựng nghiệp vụ</small></div></div></label>'
      +'</div>'
      +'<div class="phfck-violation-rule"><div>!</div><p><b>Quy tắc trùng sự việc:</b> cùng người, cùng tiêu chí và cùng ngày vẫn có thể ghi nhiều lần nếu là các sự việc độc lập. Hệ thống phải cảnh báo trùng và yêu cầu căn cứ phân biệt.</p></div>'
      +'<div class="phfck-violation-actions"><button type="button" class="phfck-secondary" disabled>Lưu nháp</button><button type="button" class="phfck-primary" disabled>Ghi nhận chính thức</button></div>'
    +'</section>';
  }
  function violationsHtml(){
    return '<div class="phfck-page-head phfck-violation-head"><div><small>PHF CHECKLIST · ADMIN</small><h1>Ghi nhận lỗi</h1><p>Chọn nhân viên, tiêu chí có lỗi và ghi nhận ngắn gọn.</p></div><button class="phfck-secondary" type="button" data-phfck-view="tasks">Xem việc cần xử lý</button></div>'
      +''
      +violationTabsHtml()
      +(violationUiState.mode==='quick'?violationQuickHtml():(violationUiState.mode==='multi'?violationMultiHtml():(violationUiState.mode==='late'?violationLateHtml():violationDetailHtml())))
      +'<section class="phfck-panel phfck-violation-policy" style="display:none"><div class="phfck-panel-head"><div><small>NGUYÊN TẮC ĐÃ CHỐT</small><h3>Điều kiện vận hành bắt buộc</h3></div></div><div class="phfck-policy-grid"><article><span>01</span><div><b>Nháp chưa trừ điểm</b><p>Chỉ khi ghi nhận chính thức mới tạo lỗi và trừ điểm tạm.</p></div></article><article><span>02</span><div><b>Không sửa âm thầm</b><p>Sau khi nhân viên đã xem, mọi thay đổi phải có lý do và lịch sử trước–sau.</p></div></article><article><span>03</span><div><b>Lỗi lặp lại không tự tăng hệ số</b><p>Chỉ cảnh báo, thống kê và đưa vào gợi ý đào tạo theo ngưỡng cấu hình.</p></div></article><article><span>04</span><div><b>Khóa dữ liệu tháng</b><p>Dữ liệu tháng trước nhập đến 23:59 ngày 4; sau đó chỉ Admin xử lý ngoại lệ.</p></div></article></div></section>';
  }

  function taskScopeTabsHtml(){
    var tabs=[
      ['mine','Cần tôi xử lý','0'],
      ['created','Tôi đã giao','0'],
      ['collaborating','Đang phối hợp','0'],
      ['done','Đã hoàn tất','0'],
      ['all','Tất cả','0']
    ];
    return '<div class="phfck-task-scope" aria-label="Phạm vi công việc">'+tabs.map(function(item){return '<button type="button" class="'+(taskUiState.scope===item[0]?'active':'')+'" data-phfck-task-scope="'+item[0]+'"><span>'+item[1]+'</span><b>'+item[2]+'</b></button>';}).join('')+'</div>';
  }
  function taskStatusTabsHtml(){
    var tabs=[
      ['all','Tất cả trạng thái','0'],
      ['employee','Chờ nhân viên','0'],
      ['reviewer','Chờ phản hồi','0'],
      ['admin','Báo Admin','0'],
      ['due','Sắp quá hạn','0'],
      ['overdue','Quá hạn','0']
    ];
    return '<div class="phfck-task-tabs" aria-label="Lọc theo trạng thái">'+tabs.map(function(item){return '<button type="button" class="'+(taskUiState.status===item[0]?'active':'')+'" data-phfck-task-status="'+item[0]+'"><span>'+item[1]+'</span><b>'+item[2]+'</b></button>';}).join('')+'</div>';
  }
  function taskFlowCardsHtml(){
    var rows=[
      ['01','Nhân viên xác nhận','Trong 3 ngày','Xác nhận lỗi hoặc gửi giải trình.'],
      ['02','Người ghi lỗi phản hồi','Trong 3 ngày','Giữ nguyên, đề xuất điều chỉnh hoặc báo Admin.'],
      ['03','Admin xử lý ngoại lệ','Khi có tranh luận','Giữ, điều chỉnh hoặc hủy và bắt buộc ghi lý do.'],
      ['04','Hoàn tất & lưu lịch sử','Sau kết luận cuối','Khóa kết quả và giữ đầy đủ lịch sử trước–sau.']
    ];
    return '<section class="phfck-task-flow">'+rows.map(function(item){return '<article><span>'+item[0]+'</span><div><b>'+item[1]+'</b><small>'+item[2]+'</small><p>'+item[3]+'</p></div></article>';}).join('')+'</section>';
  }
  function taskEmptyCopy(){
    if(taskUiState.query)return ['Không tìm thấy kết quả','Thử đổi từ khóa hoặc bỏ bớt bộ lọc đang chọn.'];
    if(taskUiState.status==='overdue')return ['Không có việc quá hạn','Các việc quá hạn sẽ được đưa lên đây để xử lý ưu tiên.'];
    if(taskUiState.status==='due')return ['Không có việc sắp quá hạn','Hệ thống sẽ cảnh báo các việc gần đến hạn phản hồi.'];
    if(taskUiState.scope==='done')return ['Chưa có việc đã hoàn tất','Các vụ việc có kết luận cuối sẽ được lưu tại đây.'];
    if(taskUiState.scope==='created')return ['Chưa có việc bạn đã giao','Các lỗi do bạn ghi nhận sẽ xuất hiện tại đây để theo dõi.'];
    if(taskUiState.scope==='collaborating')return ['Chưa có việc đang phối hợp','Các vụ việc bạn được giao phối hợp sẽ xuất hiện tại đây.'];
    return ['Chưa có việc cần xử lý','Khi lỗi được ghi nhận chính thức, việc xác nhận, giải trình và phản hồi sẽ xuất hiện tại đây.'];
  }
  function taskQueueHtml(){
    var empty=taskEmptyCopy();
    return '<section class="phfck-panel phfck-task-queue">'
      +taskScopeTabsHtml()
      +'<div class="phfck-list-toolbar phfck-task-toolbar"><div class="phfck-search"><span>⌕</span><input type="search" placeholder="Tìm nhân viên, mã NV hoặc nội dung lỗi" value="'+esc(taskUiState.query)+'" data-phfck-task-search></div><label><span>Mức ưu tiên</span><select data-phfck-task-priority><option value="all"'+(taskUiState.priority==='all'?' selected':'')+'>Tất cả</option><option value="urgent"'+(taskUiState.priority==='urgent'?' selected':'')+'>Khẩn cấp</option><option value="high"'+(taskUiState.priority==='high'?' selected':'')+'>Cao</option><option value="normal"'+(taskUiState.priority==='normal'?' selected':'')+'>Bình thường</option></select></label><div class="phfck-filter-note"><span class="phfck-dot"></span>Chưa nối dữ liệu thật</div></div>'
      +taskStatusTabsHtml()
      +'<div class="phfck-task-empty"><div>◷</div><b>'+empty[0]+'</b><p>'+empty[1]+'</p><button type="button" class="phfck-secondary" data-phfck-view="violations">Đi đến Ghi nhận lỗi</button></div>'
    +'</section>';
  }
  function tasksHtml(){
    return '<div class="phfck-page-head phfck-task-head"><div><small>PHF CHECKLIST · ADMIN</small><h1>Việc cần xử lý</h1><p>Theo dõi đúng người phụ trách, thời hạn và trạng thái của từng vụ việc.</p></div><button class="phfck-primary" type="button" data-phfck-view="violations">＋ Ghi nhận lỗi</button></div>'
      +'<section class="phfck-task-summary"><article><span>Chờ nhân viên</span><strong>0</strong><small>Hạn xác nhận hoặc giải trình: 3 ngày</small></article><article><span>Chờ phản hồi</span><strong>0</strong><small>Người ghi lỗi phản hồi trong 3 ngày</small></article><article><span>Báo Admin</span><strong>0</strong><small>Chờ kết luận ngoại lệ</small></article><article><span>Sắp quá hạn / Quá hạn</span><strong>0</strong><small>Được ưu tiên đưa lên đầu</small></article></section>'
      +taskQueueHtml()
      +taskFlowCardsHtml()
      +'<section class="phfck-panel phfck-task-rules"><div class="phfck-panel-head"><div><small>NGUYÊN TẮC XỬ LÝ</small><h3>Không mất dấu và không sửa âm thầm</h3></div></div><div class="phfck-policy-grid"><article><span>01</span><div><b>Điểm vẫn trừ tạm khi đang xử lý</b><p>Chỉ hoàn hoặc điều chỉnh khi có kết luận đúng quyền.</p></div></article><article><span>02</span><div><b>Mỗi việc có người chịu trách nhiệm</b><p>Hiển thị rõ người đang phải xử lý và thời hạn còn lại.</p></div></article><article><span>03</span><div><b>Quá hạn chỉ cảnh báo, không tự kết luận</b><p>Hệ thống nhắc việc nhưng không quyết định thay người có quyền.</p></div></article><article><span>04</span><div><b>Thay đổi phải có lịch sử</b><p>Lưu người thao tác, thời gian, lý do và dữ liệu trước–sau.</p></div></article></div></section>';
  }


  function monthlyPeriodValue(){
    if(monthlyUiState.month)return monthlyUiState.month;
    var d=new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  }
  function monthlyStatusTabsHtml(){
    var tabs=[['all','Tất cả','0'],['not-created','Chưa khởi tạo','0'],['self','Chờ tự đánh giá','0'],['review','Chờ thẩm định','0'],['locked','Đã khóa','0']];
    return '<div class="phfck-monthly-tabs">'+tabs.map(function(item){return '<button type="button" class="'+(monthlyUiState.status===item[0]?'active':'')+'" data-phfck-monthly-status="'+item[0]+'"><span>'+item[1]+'</span><b>'+item[2]+'</b></button>';}).join('')+'</div>';
  }
  function monthlyFlowHtml(){
    var steps=[
      ['01','Khởi tạo phiếu','Hệ thống lấy đúng form theo phân công và phiên bản hiệu lực trong tháng.'],
      ['02','Nhân viên tự đánh giá','Nhập phần thực đạt; điểm Checklist được đưa tự động, không nhập lại.'],
      ['03','Người thẩm định đánh giá','Xác nhận từng chỉ tiêu và chốt phần thẩm định theo phạm vi được giao.'],
      ['04','Tính kết quả cuối','Kết quả dùng tỷ lệ 1 phần tự đánh giá và 2 phần thẩm định.'],
      ['05','Khóa và xuất báo cáo','Từ ngày 5 khóa dữ liệu tháng trước; Admin xử lý ngoại lệ có lịch sử.']
    ];
    return '<section class="phfck-monthly-flow">'+steps.map(function(item){return '<article><span>'+item[0]+'</span><div><b>'+item[1]+'</b><p>'+item[2]+'</p></div></article>';}).join('')+'</section>';
  }
  function monthlyEmptyHtml(){
    return '<div class="phfck-monthly-empty"><div>▦</div><b>Chưa có phiếu đánh giá tháng</b><p>Phiếu sẽ được sinh sau khi hoàn tất phân công nhân sự, chuẩn hóa mẫu và kết nối dữ liệu thật. Giai đoạn này chỉ chốt cấu trúc nghiệp vụ.</p><button type="button" class="phfck-secondary" data-phfck-monthly-preview>Xem cấu trúc một phiếu mẫu</button></div>';
  }
  function monthlyPreviewHtml(){
    var rows=[
      ['I','Kết quả công việc theo mục tiêu','Theo form vị trí','Nhân viên nhập','Người thẩm định nhập'],
      ['II','Điểm Checklist tuân thủ','Tự động từ 100 điểm trừ lỗi','Tự động','Xác nhận lại'],
      ['III','Công việc cấp trên giao','Theo form vị trí','Nhân viên nhập','Người thẩm định nhập']
    ];
    return '<div class="phfck-modal-layer" data-phfck-modal-layer><div class="phfck-modal phfck-monthly-modal" role="dialog" aria-modal="true" aria-labelledby="phfckMonthlyTitle">'
      +'<div class="phfck-modal-head"><div><small>CẤU TRÚC PHIẾU THÁNG</small><h2 id="phfckMonthlyTitle">Phiếu đánh giá hiệu quả công việc</h2></div><button type="button" data-phfck-close-modal aria-label="Đóng">×</button></div>'
      +'<div class="phfck-modal-body"><div class="phfck-monthly-person"><div><span>Nhân sự</span><b>Họ tên · Mã nhân viên</b></div><div><span>Kỳ đánh giá</span><b>Tháng được chọn</b></div><div><span>Mẫu áp dụng</span><b>Theo phân công có hiệu lực</b></div><div><span>Người thẩm định</span><b>Theo cấu hình Admin</b></div></div>'
      +'<div class="phfck-table-wrap"><table class="phfck-table phfck-monthly-structure"><thead><tr><th>Nhóm</th><th>Nội dung</th><th>Nguồn điểm</th><th>Tự đánh giá</th><th>Thẩm định</th></tr></thead><tbody>'+rows.map(function(r){return '<tr>'+r.map(function(c){return '<td>'+esc(c)+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div>'
      +'<div class="phfck-monthly-formula"><span>Điểm kết quả cuối</span><strong>(Tự đánh giá + Thẩm định × 2) / 3</strong><small>Điểm Checklist tự động vẫn giữ nguyên khi nhân viên quá hạn tự đánh giá; các phần phải nhập của nhân viên chuyển về 0 theo quy tắc đã chốt.</small></div>'
      +'<div class="phfck-notice"><b>Nguyên tắc lịch sử</b><p>Sau khi phiếu được thẩm định hoặc khóa, mọi điều chỉnh của Admin phải ghi lý do, người thao tác, thời gian và dữ liệu trước–sau.</p></div>'
      +'</div><div class="phfck-modal-foot"><button type="button" class="phfck-secondary" data-phfck-close-modal>Đóng</button><button type="button" class="phfck-primary" disabled title="Sẽ mở khi có API và dữ liệu thật">Khởi tạo phiếu</button></div>'
    +'</div></div>';
  }
  function monthlyHtml(){
    var month=monthlyPeriodValue();
    return '<div class="phfck-page-head phfck-monthly-head"><div><small>PHF CHECKLIST · ADMIN</small><h1>Phiếu đánh giá tháng</h1><p>Tổng hợp phần tự đánh giá, thẩm định và điểm Checklist theo đúng form có hiệu lực của từng nhân sự.</p></div><button class="phfck-primary" type="button" disabled title="Chỉ mở sau khi hoàn tất phân công, mẫu và dữ liệu thật">＋ Khởi tạo kỳ đánh giá</button></div>'
      +'<section class="phfck-monthly-summary"><article><span>Phiếu trong kỳ</span><strong>0</strong><small>Chưa nối dữ liệu thật</small></article><article><span>Chờ tự đánh giá</span><strong>0</strong><small>Nhân viên chưa hoàn tất</small></article><article><span>Chờ thẩm định</span><strong>0</strong><small>Người thẩm định chưa chốt</small></article><article><span>Đã khóa</span><strong>0</strong><small>Khóa từ ngày 5 tháng sau</small></article></section>'
      +monthlyFlowHtml()
      +'<section class="phfck-panel phfck-monthly-panel"><div class="phfck-monthly-toolbar"><label><span>Kỳ đánh giá</span><input type="month" value="'+esc(month)+'" data-phfck-monthly-period></label><div class="phfck-search"><span>⌕</span><input type="search" placeholder="Tìm theo họ tên, mã nhân viên hoặc phòng ban" disabled></div><div class="phfck-filter-note"><span class="phfck-dot"></span>Chưa nối dữ liệu thật</div></div>'+monthlyStatusTabsHtml()+monthlyEmptyHtml()+'</section>'
      +'<section class="phfck-panel phfck-monthly-rules"><div class="phfck-panel-head"><div><small>QUY TẮC ĐÃ CHỐT</small><h3>Cách tính và khóa phiếu tháng</h3></div></div><div class="phfck-policy-grid"><article><span>01</span><div><b>Checklist tự động đưa vào phiếu</b><p>Không nhập lại thủ công; người thẩm định xác nhận khi điểm thay đổi.</p></div></article><article><span>02</span><div><b>Tỷ lệ 1 phần – 2 phần</b><p>Kết quả cuối gồm 1 phần tự đánh giá và 2 phần thẩm định.</p></div></article><article><span>03</span><div><b>Quá hạn tự đánh giá</b><p>Các chỉ tiêu nhân viên phải nhập chuyển về 0; điểm Checklist tự động vẫn giữ nguyên.</p></div></article><article><span>04</span><div><b>Khóa từ ngày 5</b><p>Dữ liệu tháng trước khóa với người dùng thường; Admin xử lý ngoại lệ có lịch sử.</p></div></article></div></section>'
      +(monthlyUiState.selectedId?monthlyPreviewHtml():'');
  }


  function reportPeriodValue(){
    if(reportUiState.month)return reportUiState.month;
    var d=new Date();
    reportUiState.month=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    return reportUiState.month;
  }
  function reportTabsHtml(){
    var tabs=[['summary','Tổng hợp'],['scores','Điểm tuân thủ'],['violations','Lỗi & quá hạn'],['repeat','Lỗi lặp lại'],['training','Gợi ý đào tạo']];
    return '<div class="phfck-report-tabs">'+tabs.map(function(t){return '<button type="button" class="'+(reportUiState.view===t[0]?'active':'')+'" data-phfck-report-view="'+t[0]+'">'+esc(t[1])+'</button>';}).join('')+'</div>';
  }
  function reportEmptyHtml(){
    var copy={summary:['Chưa có dữ liệu tổng hợp','Sau khi có phân công, lỗi và phiếu tháng, khu này sẽ tổng hợp toàn bộ kết quả theo kỳ.'],scores:['Chưa có điểm tuân thủ','Điểm tháng sẽ được tổng hợp theo nhân viên, bộ phận, mẫu Checklist và giai đoạn hiệu lực.'],violations:['Chưa có dữ liệu lỗi và quá hạn','Hệ thống sẽ theo dõi số lỗi, điểm trừ, lỗi đang xử lý và các việc quá hạn.'],repeat:['Chưa có lỗi lặp lại','Lỗi lặp lại sẽ được nhóm theo nhân viên và tiêu chí, không tự tăng hệ số trừ điểm.'],training:['Chưa có gợi ý đào tạo','Khi đạt ngưỡng cấu hình, Checklist chỉ tạo gợi ý đào tạo nội bộ; chưa ghi dữ liệu sang Classroom.']};
    var item=copy[reportUiState.view]||copy.summary;
    return '<div class="phfck-report-empty"><div>▥</div><b>'+esc(item[0])+'</b><p>'+esc(item[1])+'</p></div>';
  }
  function reportStructureHtml(){
    var cards=[
      ['01','Theo nhân viên','Điểm đầu tháng, tổng điểm trừ, điểm còn lại, trạng thái phiếu tháng.'],
      ['02','Theo đơn vị & vị trí','So sánh tỷ lệ lỗi và mức hoàn thành trong phạm vi được cấu hình.'],
      ['03','Theo mẫu & tiêu chí','Nhận diện tiêu chí phát sinh nhiều lỗi, quá hạn hoặc cần chuẩn hóa.'],
      ['04','Theo thời gian','Theo dõi xu hướng theo tháng và giữ đúng lịch sử khi điều chuyển.']
    ];
    return '<section class="phfck-panel phfck-report-structure"><div class="phfck-panel-head"><div><small>CẤU TRÚC BÁO CÁO</small><h3>Các chiều phân tích bắt buộc</h3></div></div><div class="phfck-report-dimensions">'+cards.map(function(c){return '<article><span>'+c[0]+'</span><div><b>'+esc(c[1])+'</b><p>'+esc(c[2])+'</p></div></article>';}).join('')+'</div></section>';
  }
  function reportRulesHtml(){
    return '<section class="phfck-panel phfck-report-rules"><div class="phfck-panel-head"><div><small>QUY TẮC ĐÃ CHỐT</small><h3>Đối soát và xuất dữ liệu</h3></div></div><div class="phfck-policy-grid"><article><span>01</span><div><b>Một nhân viên một dòng khi xuất lương</b><p>Báo cáo cuối tháng phải tổng hợp đúng một dòng cho mỗi nhân viên.</p></div></article><article><span>02</span><div><b>Giữ lịch sử điều chuyển</b><p>Kết quả tháng được cộng từ từng giai đoạn áp dụng form, không làm mất dữ liệu cũ.</p></div></article><article><span>03</span><div><b>Lỗi tranh luận vẫn tính tạm</b><p>Điểm chỉ hoàn lại hoặc điều chỉnh sau quyết định chính thức của Admin.</p></div></article><article><span>04</span><div><b>Gợi ý đào tạo không tích hợp trực tiếp</b><p>Checklist chỉ hiển thị đề xuất; không gọi API hoặc ghi dữ liệu sang Classroom.</p></div></article></div></section>';
  }
  function reportsHtml(){
    var month=reportPeriodValue();
    return '<div class="phfck-page-head phfck-report-head"><div><small>PHF CHECKLIST · ADMIN</small><h1>Báo cáo</h1><p>Theo dõi điểm tuân thủ, lỗi, quá hạn, lỗi lặp lại và dữ liệu phục vụ đánh giá tháng.</p></div><button class="phfck-primary" type="button" data-phfck-report-export disabled title="Chỉ mở khi có dữ liệu thật">⇩ Xuất Excel</button></div>'
      +'<section class="phfck-report-summary"><article><span>Nhân sự trong kỳ</span><strong>0</strong><small>Chưa nối dữ liệu thật</small></article><article><span>Điểm tuân thủ bình quân</span><strong>—</strong><small>Thang điểm 100</small></article><article><span>Lỗi phát sinh</span><strong>0</strong><small>Gồm lỗi đang xử lý</small></article><article><span>Lỗi lặp lại</span><strong>0</strong><small>Theo ngưỡng cấu hình</small></article></section>'
      +'<section class="phfck-panel phfck-report-panel"><div class="phfck-report-toolbar"><label><span>Kỳ báo cáo</span><input type="month" value="'+esc(month)+'" data-phfck-report-period></label><label><span>Phạm vi</span><select data-phfck-report-scope><option value="all">Toàn bộ phạm vi Admin</option><option value="unit">Theo đơn vị/phòng ban</option><option value="template">Theo mẫu Checklist</option></select></label><div class="phfck-filter-note"><span class="phfck-dot"></span>Chưa nối dữ liệu thật</div></div>'+reportTabsHtml()+reportEmptyHtml()+'</section>'
      +reportStructureHtml()+reportRulesHtml();
  }


  function settingsTabsHtml(){
    var tabs=[['permissions','Phân quyền','Ai được làm gì'],['scope','Phạm vi','Được thao tác với ai'],['deadlines','Thời hạn & khóa','Mốc xử lý và khóa tháng'],['violations','Ghi nhận lỗi','Quy tắc lỗi và minh chứng'],['scoring','Điểm & lỗi lặp lại','Điểm trừ và cảnh báo'],['monthly','Phiếu tháng','Tự đánh giá và thẩm định'],['notifications','Thông báo','Nhắc hạn và cảnh báo'],['audit','Nhật ký & an toàn','Lịch sử và kiểm soát']];
    return '<div class="phfck-settings-tabs">'+tabs.map(function(t){return '<button type="button" class="'+(settingsUiState.section===t[0]?'active':'')+'" data-phfck-settings-tab="'+t[0]+'"><b>'+esc(t[1])+'</b><small>'+esc(t[2])+'</small></button>';}).join('')+'</div>';
  }
  function settingSwitch(label,desc,checked,locked){return '<div class="phfck-setting-row"><div><b>'+esc(label)+'</b><p>'+esc(desc)+'</p></div><label class="phfck-switch '+(locked?'is-locked':'')+'"><input type="checkbox" '+(checked?'checked':'')+' '+(locked?'disabled':'')+'><span></span></label></div>';}
  function permissionMatrixHtml(){var rows=[['Xem toàn bộ nhân sự','Có','Theo phạm vi','Chỉ bản thân'],['Gán form và ngày hiệu lực','Có','Không','Không'],['Cấu hình người ghi lỗi','Có','Không','Không'],['Ghi nhận lỗi chính thức','Theo quyền cấu hình','Theo quyền cấu hình','Không'],['Gửi phản ánh','Có','Có','Có'],['Điều chỉnh hoặc hủy lỗi','Có','Không','Không'],['Thẩm định phiếu tháng','Theo phân công','Theo phân công','Không'],['Xem báo cáo tổng','Có','Theo phạm vi','Không'],['Cài đặt hệ thống','Có','Không','Không']];return '<div class="phfck-settings-table-wrap"><table class="phfck-settings-table"><thead><tr><th>Quyền nghiệp vụ</th><th>Admin</th><th>Quản lý/Trưởng ca</th><th>Nhân viên</th></tr></thead><tbody>'+rows.map(function(r){return '<tr><td><b>'+esc(r[0])+'</b></td><td>'+esc(r[1])+'</td><td>'+esc(r[2])+'</td><td>'+esc(r[3])+'</td></tr>';}).join('')+'</tbody></table></div>';}
  function permissionsSettingsHtml(){return '<section class="phfck-settings-grid"><article class="phfck-panel phfck-settings-card phfck-settings-wide"><div class="phfck-panel-head"><div><small>MA TRẬN QUYỀN GỐC</small><h3>Quyền theo vai trò</h3></div><span class="phfck-status">Admin quyết định</span></div><p class="phfck-settings-intro">Vai trò nền chỉ xác định mức truy cập chung. Quyền ghi lỗi, phạm vi và người thẩm định phải do Admin Checklist gán riêng, không kế thừa Hub hoặc Classroom.</p>'+permissionMatrixHtml()+'</article><article class="phfck-panel phfck-settings-card"><div class="phfck-panel-head"><div><small>NGUYÊN TẮC CẤP QUYỀN</small><h3>Kiểm soát thao tác</h3></div></div>'+settingSwitch('Quyền server-side','Ẩn nút trên giao diện không được xem là kiểm soát quyền; API phải kiểm tra lại.',true,true)+settingSwitch('Không mặc định cấp ngang','Quản lý chỉ đánh người thuộc phạm vi; kiểm tra chéo phải được Admin cấp thêm.',true,true)+settingSwitch('Admin có quyền xử lý ngoại lệ','Giữ, điều chỉnh hoặc hủy lỗi và bắt buộc ghi lý do.',true,true)+'</article><article class="phfck-panel phfck-settings-card"><div class="phfck-panel-head"><div><small>NHÓM QUYỀN CẤU HÌNH</small><h3>Cách Admin sẽ gán</h3></div></div><div class="phfck-settings-list"><div><span>01</span><p><b>Người ghi lỗi</b><small>Gán theo cá nhân, vị trí, nhóm hoặc phạm vi kiểm tra chéo.</small></p></div><div><span>02</span><p><b>Người thẩm định</b><small>Gán riêng cho từng nhân sự/form và theo ngày hiệu lực.</small></p></div><div><span>03</span><p><b>Người xem báo cáo</b><small>Giới hạn theo phạm vi được giao, không mặc định toàn công ty.</small></p></div></div></article></section>';}
  function scopeSettingsHtml(){return '<section class="phfck-settings-grid"><article class="phfck-panel phfck-settings-card phfck-settings-wide"><div class="phfck-panel-head"><div><small>PHẠM VI NGHIỆP VỤ</small><h3>Admin gán phạm vi theo từng người</h3></div><span class="phfck-status">Không hard-code chức danh</span></div><div class="phfck-scope-cards"><div><span>CN</span><b>Cá nhân cụ thể</b><p>Chỉ được ghi nhận hoặc thẩm định một danh sách nhân sự do Admin chọn.</p></div><div><span>VT</span><b>Theo vị trí</b><p>Áp dụng cho nhân sự đang giữ vị trí tại thời điểm có hiệu lực.</p></div><div><span>ĐV</span><b>Đơn vị/chi nhánh</b><p>Giới hạn theo cửa hàng, bộ phận hoặc đơn vị vận hành.</p></div><div><span>CC</span><b>Kiểm tra chéo</b><p>Quyền bổ sung có thời hạn; không tự có chỉ vì cấp quản lý ngang nhau.</p></div></div></article><article class="phfck-panel phfck-settings-card"><div class="phfck-panel-head"><div><small>ĐIỀU CHUYỂN</small><h3>Giữ đúng lịch sử</h3></div></div>'+settingSwitch('Một kết quả tháng','Nhân viên điều chuyển giữa tháng vẫn có một kết quả tổng.',true,true)+settingSwitch('Chia theo giai đoạn','Điểm và form được tính theo từng khoảng hiệu lực rồi cộng đúng kỳ.',true,true)+'</article><article class="phfck-panel phfck-settings-card"><div class="phfck-panel-head"><div><small>DỮ LIỆU NỀN</small><h3>Nguồn nhân sự</h3></div></div><div class="phfck-settings-callout"><b>Chỉ lấy từ Hub</b><p>Họ tên và Mã nhân viên. Mọi form, quyền, phạm vi và người thẩm định do Admin Checklist gán.</p></div></article></section>';}
  function deadlinesSettingsHtml(){return '<section class="phfck-settings-grid"><article class="phfck-panel phfck-settings-card phfck-settings-wide"><div class="phfck-panel-head"><div><small>MỐC THỜI GIAN CHỐT</small><h3>Thời hạn xử lý và khóa tháng</h3></div><span class="phfck-status">Asia/Ho_Chi_Minh</span></div><div class="phfck-deadline-grid"><label><b>Nhân viên xác nhận/giải trình</b><div><input type="number" value="3" disabled><span>ngày</span></div><small>Theo quy tắc ngày đã chốt; khi xây thật sẽ chuẩn hóa timezone.</small></label><label><b>Người ghi lỗi phản hồi</b><div><input type="number" value="3" disabled><span>ngày</span></div><small>Tính từ lúc nhận giải trình.</small></label><label><b>Nhập dữ liệu tháng trước đến</b><div><input type="text" value="23:59 ngày 04" disabled></div><small>Từ 00:00 ngày 05 người dùng thường và quản lý bị khóa.</small></label><label><b>Admin xử lý sau khóa</b><div><input type="text" value="Có kiểm soát" disabled></div><small>Bắt buộc lý do và lưu trước–sau.</small></label></div></article><article class="phfck-panel phfck-settings-card"><div class="phfck-panel-head"><div><small>KHÓA DỮ LIỆU</small><h3>Quy tắc bắt buộc</h3></div></div>'+settingSwitch('Cho lưu nháp trước hạn','Nháp chưa trừ điểm và chưa gửi nhân viên.',true,true)+settingSwitch('Khóa sửa sau khi nhân viên đã xem','Người ghi lỗi không được sửa âm thầm.',true,true)+settingSwitch('Admin sửa sau khóa có nhật ký','Mọi thay đổi phải lưu lý do, giá trị cũ và mới.',true,true)+'</article><article class="phfck-panel phfck-settings-card"><div class="phfck-panel-head"><div><small>QUÁ HẠN</small><h3>Cách hệ thống xử lý</h3></div></div><div class="phfck-settings-callout"><b>Không tự xóa hoặc tự hủy lỗi</b><p>Quá hạn chỉ đổi trạng thái, nhắc việc và đưa vào danh sách cần xử lý; điểm tạm vẫn giữ theo nghiệp vụ.</p></div></article></section>';}
  function violationsSettingsHtml(){return '<section class="phfck-settings-grid"><article class="phfck-panel phfck-settings-card"><div class="phfck-panel-head"><div><small>GHI NHẬN</small><h3>Trạng thái lỗi</h3></div></div>'+settingSwitch('Nháp chưa trừ điểm','Chỉ khi ghi nhận chính thức mới trừ điểm tạm.',true,true)+settingSwitch('Cho nhiều lỗi cùng tiêu chí/ngày','Chỉ khi là sự việc độc lập và có căn cứ phân biệt.',true,true)+settingSwitch('Cảnh báo trùng','Cảnh báo để kiểm tra, không tự chặn mọi trường hợp.',true,true)+'</article><article class="phfck-panel phfck-settings-card"><div class="phfck-panel-head"><div><small>MINH CHỨNG</small><h3>Quy tắc theo tiêu chí</h3></div></div><div class="phfck-settings-list"><div><span>01</span><p><b>Không bắt buộc toàn bộ</b><small>Admin cấu hình tiêu chí nào cần ảnh/file.</small></p></div><div><span>02</span><p><b>Nhận xét bắt buộc</b><small>Mỗi lỗi phải có mô tả đủ nhận diện sự việc.</small></p></div><div><span>03</span><p><b>Giữ dấu thời gian</b><small>Ngày giờ xảy ra tách với thời điểm người dùng nhập hệ thống.</small></p></div></div></article><article class="phfck-panel phfck-settings-card phfck-settings-wide"><div class="phfck-panel-head"><div><small>PHẢN ÁNH & LỖI CHÍNH THỨC</small><h3>Tách hai luồng rõ ràng</h3></div></div><div class="phfck-compare"><div><b>Phản ánh</b><p>Mọi user có thể gửi; chưa tự trừ điểm; cần người có quyền xem xét và chuyển thành lỗi chính thức.</p></div><div><b>Lỗi chính thức</b><p>Chỉ người được Admin cấp quyền ghi nhận; trừ điểm tạm và mở luồng xác nhận/giải trình.</p></div></div></article></section>';}
  function scoringSettingsHtml(){return '<section class="phfck-settings-grid"><article class="phfck-panel phfck-settings-card"><div class="phfck-panel-head"><div><small>ĐIỂM TUÂN THỦ</small><h3>Công thức nền</h3></div></div><div class="phfck-score-box"><span>Điểm đầu tháng</span><strong>100</strong><small>Trừ theo hệ số từng tiêu chí; điểm thấp nhất là 0.</small></div>'+settingSwitch('Không tự tăng hệ số khi lặp lại','Lỗi lặp lại chỉ tạo cảnh báo và gợi ý đào tạo.',true,true)+settingSwitch('Hủy lỗi hoàn điểm','Khi Admin hủy, hệ thống tính lại điểm kỳ liên quan.',true,true)+'</article><article class="phfck-panel phfck-settings-card phfck-settings-wide"><div class="phfck-panel-head"><div><small>NGƯỠNG LỖI LẶP LẠI</small><h3>Mặc định đã chốt</h3></div><span class="phfck-status">Admin có thể cấu hình theo tiêu chí</span></div><div class="phfck-repeat-grid"><div><strong>02</strong><b>lần trong cùng tháng</b><p>Cảnh báo quản lý.</p></div><div><strong>03</strong><b>lần trong 2 tháng liên tiếp</b><p>Đưa vào danh sách gợi ý đào tạo.</p></div><div><strong>↻</strong><b>Tái phạm sau đào tạo</b><p>Đánh dấu riêng để theo dõi.</p></div></div></article><article class="phfck-panel phfck-settings-card"><div class="phfck-panel-head"><div><small>ĐÀO TẠO</small><h3>Giới hạn tích hợp</h3></div></div><div class="phfck-settings-callout"><b>Chỉ gợi ý trong Checklist</b><p>Không gọi API, không ghi dữ liệu và không mở luồng tự động sang PHF Classroom ở giai đoạn hiện tại.</p></div></article></section>';}
  function monthlySettingsHtml(){return '<section class="phfck-settings-grid"><article class="phfck-panel phfck-settings-card phfck-settings-wide"><div class="phfck-panel-head"><div><small>PHIẾU ĐÁNH GIÁ THÁNG</small><h3>Quy tắc tính kết quả</h3></div></div><div class="phfck-formula-card"><span>Kết quả cuối</span><strong>(Tự đánh giá × 1 + Thẩm định × 2) ÷ 3</strong><p>Điểm Checklist được hệ thống đưa tự động vào dòng tương ứng và không nhập lại thủ công.</p></div></article><article class="phfck-panel phfck-settings-card"><div class="phfck-panel-head"><div><small>TỰ ĐÁNH GIÁ</small><h3>Quá hạn</h3></div></div>'+settingSwitch('Các chỉ tiêu tự nhập chuyển về 0','Áp dụng khi nhân viên không hoàn tất đúng hạn.',true,true)+settingSwitch('Điểm Checklist vẫn giữ nguyên','Điểm tự động không bị đưa về 0 theo phần tự nhập.',true,true)+'</article><article class="phfck-panel phfck-settings-card"><div class="phfck-panel-head"><div><small>THẨM ĐỊNH</small><h3>Người chịu trách nhiệm</h3></div></div><div class="phfck-settings-callout"><b>Admin gán theo phân công</b><p>Người thẩm định không mặc định theo Hub/Classroom; thay đổi phải có ngày hiệu lực và giữ lịch sử.</p></div></article></section>';}
  function notificationsSettingsHtml(){return '<section class="phfck-settings-grid"><article class="phfck-panel phfck-settings-card phfck-settings-wide"><div class="phfck-panel-head"><div><small>SỰ KIỆN THÔNG BÁO</small><h3>Nhắc đúng người, đúng việc</h3></div><span class="phfck-status">Thiết kế cấu trúc</span></div><div class="phfck-notify-grid"><div><span>01</span><b>Có lỗi mới</b><p>Gửi nhân viên để xác nhận hoặc giải trình.</p></div><div><span>02</span><b>Sắp hết hạn</b><p>Nhắc trước mốc phản hồi.</p></div><div><span>03</span><b>Đã giải trình</b><p>Gửi người ghi lỗi để phản hồi.</p></div><div><span>04</span><b>Báo Admin</b><p>Đưa ngoại lệ vào hàng đợi Admin.</p></div><div><span>05</span><b>Lỗi lặp lại</b><p>Cảnh báo quản lý theo ngưỡng.</p></div><div><span>06</span><b>Phiếu tháng</b><p>Nhắc tự đánh giá, thẩm định và khóa kỳ.</p></div></div></article><article class="phfck-panel phfck-settings-card"><div class="phfck-panel-head"><div><small>KÊNH HIỂN THỊ</small><h3>Trong module Checklist</h3></div></div>'+settingSwitch('Việc cần xử lý là nguồn chính','Mỗi thông báo phải dẫn đúng hồ sơ nghiệp vụ.',true,true)+settingSwitch('Không spam lặp','Dedupe theo user và sự kiện, không theo nhiều khóa định danh.',true,true)+'</article><article class="phfck-panel phfck-settings-card"><div class="phfck-panel-head"><div><small>CHUÔNG CHUNG</small><h3>Chưa chốt tích hợp</h3></div></div><div class="phfck-settings-callout"><b>Ưu tiên panel Checklist trước</b><p>Có thể nối chuông chung sau khi module chạy ổn; không phụ thuộc Classroom.</p></div></article></section>';}
  function auditSettingsHtml(){return '<section class="phfck-settings-grid"><article class="phfck-panel phfck-settings-card"><div class="phfck-panel-head"><div><small>NHẬT KÝ NGHIỆP VỤ</small><h3>Phải lưu trước–sau</h3></div></div>'+settingSwitch('Phân công và đổi form','Lưu người đổi, thời gian, lý do và khoảng hiệu lực.',true,true)+settingSwitch('Điều chỉnh/hủy lỗi','Lưu giá trị cũ, mới và người phê duyệt.',true,true)+settingSwitch('Sửa sau khóa','Bắt buộc lý do và không được xóa lịch sử.',true,true)+'</article><article class="phfck-panel phfck-settings-card"><div class="phfck-panel-head"><div><small>XÓA & KHÔI PHỤC</small><h3>An toàn dữ liệu</h3></div></div>'+settingSwitch('Soft delete mặc định','Dữ liệu đã dùng báo cáo không xóa cứng trực tiếp.',true,true)+settingSwitch('Thùng rác có kiểm soát','Khôi phục hoặc xóa vĩnh viễn chỉ dành cho Admin được cấp quyền.',true,true)+'</article><article class="phfck-panel phfck-settings-card phfck-settings-wide"><div class="phfck-panel-head"><div><small>BẢO MẬT KHI NỐI DỮ LIỆU</small><h3>Điều kiện trước production</h3></div></div><div class="phfck-audit-checks"><div><span>✓</span><p><b>RLS/revoke ngay từ đầu</b><small>Mọi bảng checklist_* và Storage phải được bảo vệ server-side.</small></p></div><div><span>✓</span><p><b>Health kiểm tra DB thật</b><small>Lỗi kết nối phải trả 503, không báo xanh giả.</small></p></div><div><span>✓</span><p><b>Smoke test route và quyền</b><small>Cập nhật đồng thời khi thêm API hoặc route mới.</small></p></div><div><span>✓</span><p><b>Release sạch</b><small>Không chứa .env, private, backup hoặc node_modules.</small></p></div></div></article></section>';}
  function settingsContentHtml(){var map={permissions:permissionsSettingsHtml,scope:scopeSettingsHtml,deadlines:deadlinesSettingsHtml,violations:violationsSettingsHtml,scoring:scoringSettingsHtml,monthly:monthlySettingsHtml,notifications:notificationsSettingsHtml,audit:auditSettingsHtml};return (map[settingsUiState.section]||permissionsSettingsHtml)();}
  function settingsHtml(){return '<div class="phfck-page-head phfck-settings-head"><div><small>PHF CHECKLIST · ADMIN</small><h1>Cài đặt vận hành</h1><p>Trung tâm điều khiển quyền, phạm vi, thời hạn và quy tắc cốt lõi. Chỉ Admin được truy cập; mọi thay đổi sau này phải lưu phiên bản và nhật ký.</p></div><button class="phfck-primary" type="button" disabled title="Sẽ mở sau khi chốt schema, API và nhật ký cấu hình">Lưu cấu hình</button></div><div class="phfck-settings-warning"><span>!</span><div><b>Cài đặt là lõi điều hướng nghiệp vụ</b><p>Không hard-code theo tên hoặc chức danh. Admin cấu hình theo người, phạm vi và ngày hiệu lực; quyền phải được kiểm tra lại ở backend.</p></div></div>'+settingsTabsHtml()+'<div data-phfck-settings-content>'+settingsContentHtml()+'</div>';}

  function placeholderHtml(key){
    var map={people:['Nhân sự & phân công','Lấy Họ tên và Mã nhân viên từ Hub; Admin chủ động gán mẫu, ngày hiệu lực và phạm vi.'],templates:['Mẫu Checklist','Quản lý 18 bộ mẫu, phiên bản tiêu chí và ngày hiệu lực.'],violations:['Ghi nhận lỗi','Chọn nhân viên, tiêu chí, sự việc và minh chứng để ghi nhận lỗi.'],tasks:['Việc cần xử lý','Theo dõi xác nhận, giải trình, phản hồi và các việc báo Admin.'],monthly:['Phiếu đánh giá tháng','Tổng hợp điểm Checklist cùng phần tự đánh giá và thẩm định.'],reports:['Báo cáo','Theo dõi điểm tuân thủ, lỗi lặp lại, quá hạn và xuất dữ liệu.'],history:['Lịch sử thay đổi','Truy vết mọi tác động quan trọng trong PHF Checklist.'],settings:['Cài đặt','Thiết lập quyền, phạm vi, thời hạn và quy tắc vận hành Checklist.']};
    var item=map[key]||['Tổng quan',''];
    return '<div class="phfck-page-head"><div><small>PHF CHECKLIST · ADMIN</small><h1>'+esc(item[0])+'</h1><p>'+esc(item[1])+'</p></div></div><section class="phfck-panel phfck-placeholder"><div class="phfck-placeholder-icon">▤</div><h2>'+esc(item[0])+'</h2><p>Màn hình này sẽ được xây ở bước nghiệp vụ tiếp theo. Hiện route và shell Admin vẫn được giữ nguyên, không tạo dữ liệu giả.</p><button class="phfck-secondary" type="button" data-phfck-view="overview">Quay lại Tổng quan</button></section>';
  }
  function bindRootOnce(root){
    if(!root.__phfckModalLockObserver&&window.MutationObserver){
      root.__phfckModalLockObserver=new MutationObserver(function(){requestAnimationFrame(syncChecklistModalScrollLock);});
      root.__phfckModalLockObserver.observe(root,{childList:true,subtree:true});
    }
    requestAnimationFrame(syncChecklistModalScrollLock);
    if(root.__phfChecklistClickBound) return;
    root.__phfChecklistClickBound=true;
    root.addEventListener('click',function(e){
      var hub=e.target.closest('[data-phfck-hub]');
      if(hub){e.preventDefault();if(window.phfNavigate)window.phfNavigate(hubPath());return;}
      var cancelBranch=e.target.closest('[data-phfck-cancel-branch-change]');
      if(cancelBranch){e.preventDefault();cancelBranchChange(root);return;}
      var confirmBranch=e.target.closest('[data-phfck-confirm-branch-change]');
      if(confirmBranch){e.preventDefault();confirmBranchChange(root);return;}
      var editPerson=e.target.closest('[data-phfck-edit-person]');
      if(editPerson){e.preventDefault();peopleUiState.selectedId='';peopleUiState.editingId=editPerson.getAttribute('data-phfck-edit-person')||'';refreshPeopleWorkspace(root);return;}
      var cancelPersonEdit=e.target.closest('[data-phfck-cancel-person-edit]');
      if(cancelPersonEdit){e.preventDefault();peopleUiState.editingId='';refreshPeopleWorkspace(root);return;}
      var savePersonButton=e.target.closest('[data-phfck-save-person-edit]');
      if(savePersonButton){e.preventDefault();savePersonEdit(root,savePersonButton.getAttribute('data-phfck-save-person-edit')||'');return;}
      var assign=e.target.closest('[data-phfck-assign]');
      if(assign){e.preventDefault();peopleUiState.editingId='';peopleUiState.selectedId=assign.getAttribute('data-phfck-assign')||'';refreshPeopleWorkspace(root);return;}
      var confirmAssignment=e.target.closest('[data-phfck-confirm-assignment]');
      if(confirmAssignment){e.preventDefault();confirmFormAssignment(root,confirmAssignment.getAttribute('data-phfck-confirm-assignment')||'',confirmAssignment);return;}
      var personMenu=e.target.closest('[data-phfck-person-menu]');
      if(personMenu){e.preventDefault();e.stopPropagation();var menuId=personMenu.getAttribute('data-phfck-person-menu')||'';root.querySelectorAll('[data-phfck-person-menu-pop]').forEach(function(pop){pop.classList.toggle('is-open',pop.getAttribute('data-phfck-person-menu-pop')===menuId&&!pop.classList.contains('is-open'));});return;}
      var hidePerson=e.target.closest('[data-phfck-hide-person]');
      if(hidePerson){e.preventDefault();var hideId=hidePerson.getAttribute('data-phfck-hide-person')||'';var hideItem=unlinkedEmployeeById(hideId);if(hideItem&&hideItem.code){if(window.phfNotice)window.phfNotice('Nhân viên có mã PHF không được ẩn bằng chức năng dọn dữ liệu.');return;}hideEmployeeFromChecklist(hideId);addAudit({action:'Ẩn hồ sơ chưa liên kết',area:'Nhân sự & phân công',object:(hideItem?hideItem.name:hideId),source:'Web',impact:'Hiển thị Checklist',version:'Không đổi',reason:'Ẩn khỏi danh sách phân công; không xóa dữ liệu Hub.'});refreshPeopleWorkspace(root);if(window.phfNotice)window.phfNotice('Đã ẩn hồ sơ khỏi Checklist. Dữ liệu Hub vẫn được giữ nguyên.');return;}
      var deletePerson=e.target.closest('[data-phfck-delete-person]');
      if(deletePerson){e.preventDefault();var deleteItem=unlinkedEmployeeById(deletePerson.getAttribute('data-phfck-delete-person')||'');if(!deleteItem||deleteItem.code||deleteItem.account){if(window.phfNotice)window.phfNotice('Chỉ hồ sơ chưa có mã PHF và không có tài khoản liên kết mới được xóa.');return;}appendSubmodal(root,deleteUnlinkedEmployeeModalHtml(deleteItem));return;}
      var confirmDeletePerson=e.target.closest('[data-phfck-confirm-delete-person]');
      if(confirmDeletePerson){e.preventDefault();if(confirmDeletePerson.disabled)return;deleteUnlinkedEmployee(root,confirmDeletePerson.getAttribute('data-phfck-confirm-delete-person')||'',confirmDeletePerson);return;}
      var salesDownload=e.target.closest('[data-phfck-sales-download]');
      if(salesDownload){e.preventDefault();downloadSalesTemplate(salesDownload.getAttribute('data-phfck-sales-download')||'current',templateUiState.selectedId);if(window.phfNotice)window.phfNotice('Đã tạo file chuẩn của '+(templateUiState.selectedId==='truong-ca-ban-hang'?'mẫu Trưởng ca/Phó ca bán hàng':(templateUiState.selectedId==='nv-kho'?'mẫu Nhân viên Kho & Sơ chế':(templateUiState.selectedId==='tbp-kho'?'mẫu Trưởng bộ phận Kho & Sơ chế':(ASSISTANT_TEMPLATE_CONFIGS[templateUiState.selectedId]?'mẫu '+ASSISTANT_TEMPLATE_CONFIGS[templateUiState.selectedId].title:'mẫu Nhân viên bán hàng'))))+'.');return;}
      var salesUpload=e.target.closest('[data-phfck-sales-upload]');
      if(salesUpload){e.preventDefault();var fi=root.querySelector('[data-phfck-sales-file]');if(fi)fi.click();return;}
      var directEdit=e.target.closest('[data-phfck-direct-edit]');if(directEdit){e.preventDefault();var first=selectedTemplateGroups()[0]&&selectedTemplateGroups()[0].children[0]&&selectedTemplateGroups()[0].children[0].items[0];appendSubmodal(root,directEditModalHtml(first?first[0]:''));return;}
      var editCriterion=e.target.closest('[data-phfck-edit-criterion]');if(editCriterion){e.preventDefault();appendSubmodal(root,directEditModalHtml(editCriterion.getAttribute('data-phfck-edit-criterion')||''));return;}
      var bulkUpdate=e.target.closest('[data-phfck-bulk-update]');if(bulkUpdate){e.preventDefault();pendingBulkImport=null;appendSubmodal(root,bulkStartModalHtml());return;}
      var downloadBulk=e.target.closest('[data-phfck-download-bulk-file]');if(downloadBulk){e.preventDefault();downloadBulkWorkbook();return;}
      var chooseBulk=e.target.closest('[data-phfck-choose-bulk-file]');if(chooseBulk){e.preventDefault();var fi2=root.querySelector('[data-phfck-sales-file]');if(fi2)fi2.click();return;}
      var downloadView=e.target.closest('[data-phfck-download-view]');if(downloadView){e.preventDefault();downloadView.disabled=true;downloadViewWorkbook().then(function(ok){downloadView.disabled=false;if(ok){addAudit({action:'Tải xuống để xem',area:'Mẫu Checklist',object:(CHECKLIST_TEMPLATE_CATALOG.find(function(x){return x.id===templateUiState.selectedId;})||{}).name||'Mẫu Checklist',source:'Web',impact:'Không thay đổi dữ liệu',version:'Bản hiện tại',reason:'Xuất file Excel trình bày chuẩn để xem, lưu hồ sơ hoặc đối chiếu.'});if(window.phfNotice)window.phfNotice('Đã tải file Excel trình bày chuẩn, gồm đủ 3 sheet.');}});return;}
      var versionHistory=e.target.closest('[data-phfck-version-history]');if(versionHistory){e.preventDefault();appendSubmodal(root,versionHistoryModalHtml());return;}
      var closeSub=e.target.closest('[data-phfck-close-submodal]');if(closeSub){e.preventDefault();var sm=closeSub.closest('[data-phfck-submodal]');if(sm)sm.remove();syncChecklistModalScrollLock();return;}
      var confirmEdit=e.target.closest('[data-phfck-confirm-edit]');if(confirmEdit){e.preventDefault();var modal=confirmEdit.closest('[data-phfck-submodal]');var code=(modal.querySelector('[data-phfck-edit-code]')||{}).value||'';var content=(modal.querySelector('[data-phfck-edit-content]')||{}).value||'';var factor=Number((modal.querySelector('[data-phfck-edit-factor]')||{}).value||0);var reason=(modal.querySelector('[data-phfck-edit-reason]')||{}).value||'';var effective=(modal.querySelector('[data-phfck-edit-effective]')||{}).value||'';if(!content||factor<=0||!reason||!effective){if(window.phfNotice)window.phfNotice('Vui lòng nhập đủ nội dung, hệ số, ngày hiệu lực và lý do thay đổi.');return;}var found=findCriterion(code);if(found){found.item[1]=content;found.item[2]=factor;}addAudit({action:'Sửa tiêu chí trực tiếp',area:'Mẫu Checklist',object:code+' · '+content,source:'Web',impact:'Một mẫu',version:'Dự kiến phiên bản mới',reason:reason});if(modal)modal.remove();refreshTemplatesWorkspace(root);if(window.phfNotice)window.phfNotice('Đã ghi nhận thay đổi và tạo lịch sử tổng quan. Phiếu cũ không bị ảnh hưởng.');return;}
      var saveDraft=e.target.closest('[data-phfck-save-draft]');if(saveDraft){e.preventDefault();if(window.phfNotice)window.phfNotice('Đã lưu nháp trên phiên làm việc hiện tại.');return;}
      var confirmBulk=e.target.closest('[data-phfck-confirm-bulk]');if(confirmBulk){e.preventDefault();var bm=confirmBulk.closest('[data-phfck-submodal]');var br=(bm.querySelector('[data-phfck-bulk-reason]')||{}).value||'',be=(bm.querySelector('[data-phfck-bulk-effective]')||{}).value||'';if(!br.trim()){if(window.phfNotice)window.phfNotice('Vui lòng nhập lý do cập nhật hàng loạt.');return;}if(!be){if(window.phfNotice)window.phfNotice('Vui lòng chọn ngày hiệu lực.');return;}if(!pendingBulkImport||(pendingBulkImport.errors||[]).length){if(window.phfNotice)window.phfNotice('Không còn dữ liệu hợp lệ để tạo phiên bản. Vui lòng import lại file.');return;}var applied=applyBulkImport(pendingBulkImport,br.trim(),be);if(!applied){if(window.phfNotice)window.phfNotice('Không lưu được bản cập nhật trong trình duyệt.');return;}var catalog=CHECKLIST_TEMPLATE_CATALOG.find(function(x){return x.id===templateUiState.selectedId;})||{};addAudit({action:'Import cập nhật hàng loạt',area:'Mẫu Checklist',object:catalog.name||'Mẫu Checklist',source:'Excel',impact:'Một mẫu',version:applied.sourceVersion+' → '+applied.version,reason:br.trim()});pendingBulkImport=null;if(bm)bm.remove();syncChecklistModalScrollLock();var workspace=root.querySelector('[data-phfck-workspace]');if(workspace)rerenderKeepingScroll(workspace,templatesHtml());if(window.phfNotice)window.phfNotice('Đã tạo '+applied.version+' trong dữ liệu prototype. Phiên bản cũ vẫn được giữ trong lịch sử.');return;}
      var historyExport=e.target.closest('[data-phfck-history-export]');if(historyExport){e.preventDefault();var hr=[['Thời gian','Người thực hiện','Hành động','Khu vực','Đối tượng','Nguồn','Mức ảnh hưởng','Phiên bản','Lý do']].concat(auditRows().map(function(r){return [r.time,r.actor,r.action,r.area,r.object,r.source,r.impact,r.version,r.reason];}));downloadTextFile('PHF_LICH_SU_THAY_DOI.csv','\uFEFF'+hr.map(function(r){return r.map(csvEscape).join(',');}).join('\r\n'));return;}
      var templateDetail=e.target.closest('[data-phfck-template-detail]');
      if(templateDetail){e.preventDefault();templateUiState.selectedId=templateDetail.getAttribute('data-phfck-template-detail')||'';refreshTemplatesWorkspace(root);return;}
      var toggleSalesFullscreen=e.target.closest('[data-phfck-toggle-sales-fullscreen]');
      if(toggleSalesFullscreen){e.preventDefault();templateUiState.salesFullscreen=!templateUiState.salesFullscreen;refreshTemplatesWorkspace(root);return;}
      var salesTab=e.target.closest('[data-phfck-sales-tab]');
      if(salesTab){e.preventDefault();templateUiState.salesTab=salesTab.getAttribute('data-phfck-sales-tab')==='total'?'total':'criteria';templateUiState.totalExplain='';refreshTemplatesWorkspace(root);return;}
      var totalExplain=e.target.closest('[data-phfck-total-explain]');
      if(totalExplain){
        e.preventDefault();e.stopPropagation();
        var row=totalExplain.closest('tr');
        var body=row&&row.parentNode;
        if(!row||!body)return;
        var next=row.nextElementSibling;
        var already=next&&next.classList.contains('phfck-total-explain-row');
        body.querySelectorAll('.phfck-total-explain-row').forEach(function(n){n.remove();});
        body.querySelectorAll('.phfck-total-info.active').forEach(function(n){n.classList.remove('active');n.setAttribute('aria-expanded','false');});
        body.querySelectorAll('tr.is-explaining').forEach(function(n){n.classList.remove('is-explaining');});
        if(already)return;
        var text=totalExplain.getAttribute('data-phfck-total-explain')||'';
        var tr=document.createElement('tr');tr.className='phfck-total-explain-row';
        tr.innerHTML='<td colspan="9"><div class="phfck-total-explanation"><div><span>GIẢI THÍCH CÁCH TÍNH</span><p>'+esc(text)+'</p></div><button type="button" data-phfck-total-explain-close aria-label="Đóng giải thích">×</button></div></td>';
        row.insertAdjacentElement('afterend',tr);row.classList.add('is-explaining');totalExplain.classList.add('active');totalExplain.setAttribute('aria-expanded','true');
        return;
      }
      var totalExplainClose=e.target.closest('[data-phfck-total-explain-close]');
      if(totalExplainClose){e.preventDefault();e.stopPropagation();var er=totalExplainClose.closest('.phfck-total-explain-row');var prev=er&&er.previousElementSibling;if(prev)prev.classList.remove('is-explaining');if(prev){var ib=prev.querySelector('.phfck-total-info');if(ib){ib.classList.remove('active');ib.setAttribute('aria-expanded','false');}}if(er)er.remove();return;}
      var totalFormula=e.target.closest('[data-phfck-total-formula]');
      if(totalFormula){e.preventDefault();if(window.phfNotice)window.phfNotice('Thiết lập công thức sẽ quản lý theo phiên bản: nguồn điểm, thang điểm tối đa, trọng số, cách quy đổi, ngày hiệu lực và lý do thay đổi. Hiện chưa ghi dữ liệu thật.');return;}
      var close=e.target.closest('[data-phfck-close-modal]');
      if(close){e.preventDefault();peopleUiState.selectedId='';peopleUiState.editingId='';templateUiState.selectedId='';monthlyUiState.selectedId='';var closeView=adminViewFromPath(location.pathname);if(closeView==='templates')refreshTemplatesWorkspace(root);else if(closeView==='monthly'){var closeWorkspace=root.querySelector('[data-phfck-workspace]');if(closeWorkspace)closeWorkspace.innerHTML=monthlyHtml();}else refreshPeopleWorkspace(root);return;}
      var layer=e.target.closest('[data-phfck-modal-layer]');
      if(layer&&e.target===layer){peopleUiState.selectedId='';peopleUiState.editingId='';templateUiState.selectedId='';monthlyUiState.selectedId='';var layerView=adminViewFromPath(location.pathname);if(layerView==='templates')refreshTemplatesWorkspace(root);else if(layerView==='monthly'){var layerWorkspace=root.querySelector('[data-phfck-workspace]');if(layerWorkspace)layerWorkspace.innerHTML=monthlyHtml();}else refreshPeopleWorkspace(root);return;}
      var pager=e.target.closest('[data-phfck-page]');
      if(pager){e.preventDefault();var rows=filteredEmployees();var max=Math.max(1,Math.ceil(rows.length/peopleUiState.pageSize));peopleUiState.page=Math.max(1,Math.min(max,peopleUiState.page+(pager.getAttribute('data-phfck-page')==='next'?1:-1)));refreshPeopleWorkspace(root);return;}
      var bulk=e.target.closest('[data-phfck-bulk-assign]');
      if(bulk){e.preventDefault();if(window.phfNotice)window.phfNotice('Phân công hàng loạt sẽ mở sau khi hoàn tất lưu dữ liệu Checklist.');return;}
      var monthlyStatus=e.target.closest('[data-phfck-monthly-status]');
      if(monthlyStatus){e.preventDefault();monthlyUiState.status=monthlyStatus.getAttribute('data-phfck-monthly-status')||'all';var monthlyWorkspace=root.querySelector('[data-phfck-workspace]');if(monthlyWorkspace)monthlyWorkspace.innerHTML=monthlyHtml();return;}
      var monthlyPreview=e.target.closest('[data-phfck-monthly-preview]');
      if(monthlyPreview){e.preventDefault();monthlyUiState.selectedId='preview';var monthlyWorkspace2=root.querySelector('[data-phfck-workspace]');if(monthlyWorkspace2)monthlyWorkspace2.innerHTML=monthlyHtml();return;}
      var reportView=e.target.closest('[data-phfck-report-view]');
      if(reportView){e.preventDefault();reportUiState.view=reportView.getAttribute('data-phfck-report-view')||'summary';var reportWorkspace=root.querySelector('[data-phfck-workspace]');if(reportWorkspace)reportWorkspace.innerHTML=reportsHtml();return;}
      var reportExport=e.target.closest('[data-phfck-report-export]');
      if(reportExport){e.preventDefault();if(window.phfNotice)window.phfNotice('Xuất Excel sẽ mở sau khi có dữ liệu báo cáo thật.');return;}
      var taskScope=e.target.closest('[data-phfck-task-scope]');
      if(taskScope){e.preventDefault();taskUiState.scope=taskScope.getAttribute('data-phfck-task-scope')||'mine';var taskScopeWorkspace=root.querySelector('[data-phfck-workspace]');if(taskScopeWorkspace)taskScopeWorkspace.innerHTML=tasksHtml();return;}
      var taskStatus=e.target.closest('[data-phfck-task-status]');
      if(taskStatus){e.preventDefault();taskUiState.status=taskStatus.getAttribute('data-phfck-task-status')||'all';var taskWorkspace=root.querySelector('[data-phfck-workspace]');if(taskWorkspace)taskWorkspace.innerHTML=tasksHtml();return;}

      var timeTrigger=e.target.closest('[data-phfck-time-trigger]');
      if(timeTrigger){e.preventDefault();openTimePicker(timeTrigger.parentElement&&timeTrigger.parentElement.querySelector('[data-phfck-time24]'));return;}
      var multiAdd=e.target.closest('[data-phfck-multi-add]');
      if(multiAdd){e.preventDefault();ensureMultiRows();violationUiState.multiRows.push(multiDayRowDefault());var ml=root.querySelector('[data-phfck-multi-list]');if(ml)ml.innerHTML=multiDayRowsHtml();return;}
      var multiRemove=e.target.closest('[data-phfck-multi-remove]');
      if(multiRemove){e.preventDefault();var mr=multiRemove.closest('[data-phfck-multi-row]');var mid=mr&&mr.getAttribute('data-phfck-multi-row');violationUiState.multiRows=violationUiState.multiRows.filter(function(r){return r.id!==mid;});ensureMultiRows();var ml2=root.querySelector('[data-phfck-multi-list]');if(ml2)ml2.innerHTML=multiDayRowsHtml();return;}
      var multiEvidence=e.target.closest('[data-phfck-multi-evidence]');
      if(multiEvidence){e.preventDefault();var mer=multiEvidence.closest('[data-phfck-multi-row]');var meid=mer&&mer.getAttribute('data-phfck-multi-row');var merow=violationUiState.multiRows.find(function(r){return r.id===meid;});if(merow)merow.evidence=!merow.evidence;multiEvidence.classList.toggle('active',!!(merow&&merow.evidence));return;}
      var addPrivate=e.target.closest('[data-phfck-add-private]');
      if(addPrivate){e.preventDefault();if(window.phfNotice)window.phfNotice('Thêm tiêu chí riêng: chọn nhóm cha, nhóm con, tên tiêu chí, hệ số và tạo phiên bản mới trước khi phát hành.');return;}
      var attachCommon=e.target.closest('[data-phfck-attach-common]');
      if(attachCommon){e.preventDefault();if(window.phfNotice)window.phfNotice('Gắn tiêu chí chung: Đi trễ đã được gắn vào mẫu Bán hàng với quyền Chỉ Admin.');return;}
      var lateTemplate=e.target.closest('[data-phfck-late-template]');
      if(lateTemplate){e.preventDefault();downloadLateTemplate();if(window.phfNotice)window.phfNotice('Đã tải file mẫu nhập Đi trễ.');return;}
      var lateUpload=e.target.closest('[data-phfck-late-upload]');
      if(lateUpload){e.preventDefault();var lfi=root.querySelector('[data-phfck-late-file]');if(lfi)lfi.click();return;}
      var lateExport=e.target.closest('[data-phfck-late-export]');
      if(lateExport){e.preventDefault();exportLateRows();return;}
      var lateAdd=e.target.closest('[data-phfck-late-add]');
      if(lateAdd){e.preventDefault();ensureLateRows();violationUiState.lateRows.push(lateRowDefault());var ll=root.querySelector('[data-phfck-late-list]');if(ll)ll.innerHTML=lateRowsHtml();return;}
      var lateRemove=e.target.closest('[data-phfck-late-remove]');
      if(lateRemove){e.preventDefault();var lr=lateRemove.closest('[data-phfck-late-row]');var lid=lr&&lr.getAttribute('data-phfck-late-row');violationUiState.lateRows=violationUiState.lateRows.filter(function(r){return r.id!==lid;});ensureLateRows();var ll2=root.querySelector('[data-phfck-late-list]');if(ll2)ll2.innerHTML=lateRowsHtml();return;}
      var violationTab=e.target.closest('[data-phfck-violation-tab]');
      if(violationTab){e.preventDefault();var vm=violationTab.getAttribute('data-phfck-violation-tab')||'quick';violationUiState.mode=(vm==='detail'||vm==='multi'||vm==='late')?vm:'quick';var violationWorkspace=root.querySelector('[data-phfck-workspace]');if(violationWorkspace)rerenderKeepingScroll(violationWorkspace,violationsHtml());return;}
      var quickToggle=e.target.closest('[data-phfck-quick-toggle]');
      if(quickToggle){e.preventDefault();var id=quickToggle.getAttribute('data-phfck-quick-toggle')||'';var st=violationUiState.selected[id]||{};st.selected=!st.selected;if(!st.time)st.time=currentTime24();violationUiState.selected[id]=st;var vw=root.querySelector('[data-phfck-workspace]');if(vw)vw.innerHTML=violationsHtml();return;}
      var quickEvidence=e.target.closest('[data-phfck-quick-evidence]');
      if(quickEvidence){e.preventDefault();if(window.phfNotice)window.phfNotice('Minh chứng sẽ được nối ở bước lưu dữ liệu thật.');return;}
      var quickDraft=e.target.closest('[data-phfck-quick-draft]');
      if(quickDraft&&!quickDraft.disabled){e.preventDefault();if(window.phfNotice)window.phfNotice('Đã kiểm tra luồng Lưu nháp. Chưa ghi dữ liệu thật.');return;}
      var quickSubmit=e.target.closest('[data-phfck-quick-submit]');
      if(quickSubmit&&!quickSubmit.disabled){e.preventDefault();if(window.phfNotice)window.phfNotice('Đã kiểm tra luồng Ghi nhận. Chưa ghi dữ liệu thật.');return;}
      var settingsTab=e.target.closest('[data-phfck-settings-tab]');
      if(settingsTab){e.preventDefault();settingsUiState.section=settingsTab.getAttribute('data-phfck-settings-tab')||'permissions';var settingsWorkspace=root.querySelector('[data-phfck-workspace]');if(settingsWorkspace)settingsWorkspace.innerHTML=settingsHtml();return;}
      var cancelTitle=e.target.closest('[data-phfck-cancel-title-change]');if(cancelTitle){e.preventDefault();cancelTitleChange(root);return;}
      var confirmTitle=e.target.closest('[data-phfck-confirm-title-change]');if(confirmTitle){e.preventDefault();confirmTitleChange(root);return;}
      var taskJump=e.target.closest('[data-phfck-task-jump]');
      if(taskJump){e.preventDefault();taskUiState.scope='mine';taskUiState.status=taskJump.getAttribute('data-phfck-task-jump')||'all';var taskTarget=adminRouteForView('tasks');if(window.phfNavigate)window.phfNavigate(taskTarget);else{history.pushState({},'',taskTarget);render(taskTarget);}return;}
      var btn=e.target.closest('[data-phfck-view]');
      if(!btn)return;
      e.preventDefault();
      var key=btn.getAttribute('data-phfck-view')||'overview';
      var target=btn.getAttribute('data-phfck-route')||adminRouteForView(key);
      if(cleanPath(location.pathname)===cleanPath(target)) return;
      pendingScrollRestore=currentScrollY();rememberScroll(cleanPath(location.pathname));
      if(window.phfNavigate) window.phfNavigate(target);
      else{history.pushState({},'',target);render(target);}
    });
    root.addEventListener('input',function(e){
      if(e.target&&e.target.matches('[data-phfck-people-search]')){
        peopleUiState.query=e.target.value||'';
        peopleUiState.page=1;
        var table=root.querySelector('[data-phfck-people-table]');
        if(table)table.innerHTML=peopleTableHtml();
      }
      if(e.target&&e.target.matches('[data-phfck-task-search]')){taskUiState.query=e.target.value||'';var taskEmpty=root.querySelector('.phfck-task-empty');if(taskEmpty){var empty=taskEmptyCopy();var eb=taskEmpty.querySelector('b');var ep=taskEmpty.querySelector('p');if(eb)eb.textContent=empty[0];if(ep)ep.textContent=empty[1];}}
      if(e.target&&e.target.matches('[data-phfck-quick-location]')) violationUiState.location=e.target.value||'';
      if(e.target&&e.target.matches('[data-phfck-late-field]')){var lre=e.target.closest('[data-phfck-late-row]');var lrid=lre&&lre.getAttribute('data-phfck-late-row');var lrow=violationUiState.lateRows.find(function(r){return r.id===lrid;});if(lrow){var lf=e.target.getAttribute('data-phfck-late-field');lrow[lf]=e.target.value||'';if(lf==='note'||lf==='adjustReason')return;recalcLateRow(lrow,lf==='minutes');var lw=root.querySelector('[data-phfck-workspace]');if(lw)rerenderKeepingScroll(lw,violationsHtml());}}
      if(e.target&&e.target.matches('[data-phfck-multi-field]')){var rowEl=e.target.closest('[data-phfck-multi-row]');var rid=rowEl&&rowEl.getAttribute('data-phfck-multi-row');var row=violationUiState.multiRows.find(function(r){return r.id===rid;});if(row){var f=e.target.getAttribute('data-phfck-multi-field');row[f]=e.target.value||'';}}

      if(e.target&&e.target.matches('[data-phfck-quick-search]')){violationUiState.query=e.target.value||'';var ql=root.querySelector('[data-phfck-quick-list]');if(ql)ql.innerHTML=quickCriteriaRowsHtml();}
      if(e.target&&e.target.matches('[data-phfck-quick-note]')){var qnid=e.target.getAttribute('data-phfck-quick-note')||'';var qnst=violationUiState.selected[qnid]||{};qnst.note=e.target.value||'';violationUiState.selected[qnid]=qnst;}
      if(e.target&&e.target.matches('[data-phfck-time24]')){var caret=e.target.selectionStart;e.target.value=formatTime24Typing(e.target.value);try{e.target.setSelectionRange(e.target.value.length,e.target.value.length);}catch(_e){}}
      if(e.target&&e.target.matches('[data-phfck-history-search]')){var q=normalizeText(e.target.value).toLowerCase();var src=(root.querySelector('[data-phfck-history-source]')||{}).value||'all';var rows=auditRows().filter(function(r){return (src==='all'||r.source===src)&&normalizeText([r.actor,r.action,r.area,r.object,r.reason].join(' ')).toLowerCase().indexOf(q)>=0;});var hb=root.querySelector('[data-phfck-history-body]');if(hb)hb.innerHTML=historyRowsHtml(rows);}
      if(e.target&&e.target.matches('[data-phfck-template-search]')){
        templateUiState.query=e.target.value||'';
        var list=root.querySelector('[data-phfck-template-list]');
        if(list)list.innerHTML=templateCardsHtml();
      }
    });
    root.addEventListener('change',function(e){
      if(e.target&&e.target.matches('[data-phfck-delete-confirm-check]')){var db=root.querySelector('[data-phfck-confirm-delete-person]');if(db)db.disabled=!e.target.checked;return;}

      if(e.target&&e.target.matches('[data-phfck-quick-date]')) violationUiState.date=e.target.value||todayIso();
      if(e.target&&e.target.matches('[data-phfck-shared-evidence]')) violationUiState.sharedEvidence=!!e.target.checked;
      if(e.target&&e.target.matches('[data-phfck-multi-field="time"]')){var mrel=e.target.closest('[data-phfck-multi-row]');var mrid=mrel&&mrel.getAttribute('data-phfck-multi-row');var mrow=violationUiState.multiRows.find(function(r){return r.id===mrid;});if(mrow){mrow.time=normalizeTime24(e.target.value,mrow.time||currentTime24());e.target.value=mrow.time;}}
      if(e.target&&e.target.matches('[data-phfck-late-file]')){var lateFile=e.target.files&&e.target.files[0];if(lateFile)importLateCsv(lateFile,root);e.target.value='';}
      if(e.target&&e.target.matches('[data-phfck-sales-file]')){var file=e.target.files&&e.target.files[0];if(file){if(!window.XLSX||!/\.xlsx?$/i.test(file.name)){pendingBulkImport={fileName:file.name,errors:['Chỉ chấp nhận file Excel .xlsx được tải từ chức năng Cập nhật hàng loạt.'],warnings:[]};appendSubmodal(root,bulkPreviewHtml(pendingBulkImport));}else{var reader=new FileReader();reader.onload=function(){try{var wb=XLSX.read(reader.result,{type:'array'});pendingBulkImport=parseBulkWorkbook(wb,file.name);appendSubmodal(root,bulkPreviewHtml(pendingBulkImport));}catch(err){console.error('[PHF Checklist] bulk import',err);pendingBulkImport={fileName:file.name,errors:['Không đọc được file Excel. Vui lòng tải lại file cập nhật từ đúng mẫu và không đổi tên sheet/cột.'],warnings:[]};appendSubmodal(root,bulkPreviewHtml(pendingBulkImport));}};reader.readAsArrayBuffer(file);}}e.target.value='';}
      if(e.target&&e.target.matches('[data-phfck-history-source]')){var qh=(root.querySelector('[data-phfck-history-search]')||{}).value||'';var src=e.target.value||'all';var rows=auditRows().filter(function(r){return (src==='all'||r.source===src)&&normalizeText([r.actor,r.action,r.area,r.object,r.reason].join(' ')).toLowerCase().indexOf(normalizeText(qh).toLowerCase())>=0;});var hbody=root.querySelector('[data-phfck-history-body]');if(hbody)hbody.innerHTML=historyRowsHtml(rows);}
      if(e.target&&e.target.matches('[data-phfck-template-group]')){
        templateUiState.group=e.target.value||'all';
        var list=root.querySelector('[data-phfck-template-list]');
        if(list)list.innerHTML=templateCardsHtml();
      }
      if(e.target&&e.target.matches('[data-phfck-violation-field="employee"]')) violationUiState.employeeId=e.target.value||'';
      if(e.target&&e.target.matches('[data-phfck-violation-field="template"]')) violationUiState.templateId=e.target.value||'';
      if(e.target&&e.target.matches('[data-phfck-quick-group]')){violationUiState.group=e.target.value||'all';var ql2=root.querySelector('[data-phfck-quick-list]');if(ql2)ql2.innerHTML=quickCriteriaRowsHtml();}
      if(e.target&&e.target.matches('[data-phfck-quick-time]')){var qtid=e.target.getAttribute('data-phfck-quick-time')||'';var qtst=violationUiState.selected[qtid]||{};qtst.time=normalizeTime24(e.target.value,qtst.time||currentTime24());e.target.value=qtst.time;violationUiState.selected[qtid]=qtst;}
      if(e.target&&e.target.matches('[data-phfck-violation-field="time"]')) e.target.value=normalizeTime24(e.target.value,currentTime24());
      if(e.target&&e.target.matches('[data-phfck-monthly-period]')) monthlyUiState.month=e.target.value||'';
      if(e.target&&e.target.matches('[data-phfck-report-period]')) reportUiState.month=e.target.value||'';
      if(e.target&&e.target.matches('[data-phfck-report-scope]')) reportUiState.scope=e.target.value||'all';
      if(e.target&&e.target.matches('[data-phfck-task-priority]')) taskUiState.priority=e.target.value||'all';
    });
  }
  function updateAdminView(root,path){
    var view=adminViewFromPath(path),restoreY=pendingScrollRestore;
    if(restoreY==null)restoreY=scrollMemory[cleanPath(path)];
    root.querySelectorAll('[data-phfck-route]').forEach(function(btn){btn.classList.toggle('active',cleanPath(btn.getAttribute('data-phfck-route'))===cleanPath(path));});
    var workspace=root.querySelector('[data-phfck-workspace]');
    if(workspace){var currentName=(user()||{}).fullName||(user()||{}).name||(user()||{}).displayName||(user()||{}).username||'Người dùng';workspace.innerHTML=view==='overview'?adminOverviewHtml(currentName):(view==='people'?peopleHtml():(view==='templates'?templatesHtml():(view==='violations'?violationsHtml():(view==='tasks'?tasksHtml():(view==='monthly'?monthlyHtml():(view==='reports'?reportsHtml():(view==='history'?historyHtml():(view==='settings'?settingsHtml():placeholderHtml(view)))))))));}
    if(view==='people')refreshPeopleWhenDataReady(root,false);else stopPeopleDataSync();
    pendingScrollRestore=null;restoreScroll(restoreY);
  }
  function genericDashboard(path,name){
    return '<section class="phfck-shell" data-checklist-role="'+esc(routeRole(path))+'"><header class="phfck-topbar"><div class="phfck-top-left"><button class="phfck-back" type="button" data-phfck-hub>←</button></div><div class="phfck-brand-lockup"><div class="phfck-brand-logo"><span class="phfck-logo-crop"><img src="assets/logo/phf-logo-white-transparent.png" alt="Phuhoa Fresh"></span><strong>PHF Checklist</strong><span>Kiểm soát tuân thủ & đánh giá công việc</span></div></div><div class="phfck-user"><span>Xin chào,</span><strong>'+esc(name)+'</strong></div></header><main class="phfck-generic"><small>PHF CHECKLIST</small><h1>'+esc(title(path))+'</h1><p>'+esc(subtitle(path))+'</p><section class="phfck-panel phfck-placeholder"><div class="phfck-placeholder-icon">✓</div><h2>Khu vực đang chuẩn bị</h2><p>Admin Checklist sẽ được xây trước. Màn hình theo vai trò sẽ được mở sau khi luồng quản trị hoàn tất.</p></section></main></section>';
  }

  function render(path){
    path=cleanPath(path||location.pathname);
    installChecklistShellGuard();
    enforceChecklistShell();
    var currentRole=routeRole(path);
    if(['admin','manager','learner'].indexOf(currentRole)<0) throw new Error('PHF_CHECKLIST_ROLE_NOT_READY');
    var root=document.getElementById('phfChecklistRoot');
    if(!root) throw new Error('PHF_CHECKLIST_ROOT_MISSING');
    var u=user()||{};var name=u.fullName||u.name||u.displayName||u.username||'Người dùng';
    var existingShell=root.querySelector('.phfck-shell');
    var existingRole=existingShell&&existingShell.getAttribute('data-checklist-role');
    if(currentRole==='admin'&&existingRole==='admin') updateAdminView(root,path);
    else root.innerHTML=currentRole==='admin'?adminDashboard(name,path):genericDashboard(path,name);
    bindRootOnce(root);
    if(currentRole==='admin'&&adminViewFromPath(path)==='people')refreshPeopleWhenDataReady(root,false);
    if(window.PHFAppShell&&typeof window.PHFAppShell.activateChecklist==='function')window.PHFAppShell.activateChecklist(path);
    else if(window.PHFAppShell)window.PHFAppShell.syncFromRoute(path,{clear:false,restoreTitle:false});
    document.title=title(path)+' · PHF Checklist';
    requestAnimationFrame(enforceChecklistShell);
    if(pendingScrollRestore!=null){var py=pendingScrollRestore;pendingScrollRestore=null;restoreScroll(py);}
    requestAnimationFrame(function(){syncChecklistModalScrollLock();syncTotalScoreScroll(root);});
    return true;
  }
  window.addEventListener('phf-training-data-ready',function(){
    if(!isChecklistPath()||adminViewFromPath(location.pathname)!=='people')return;
    var root=document.getElementById('phfChecklistRoot');
    if(root)requestAnimationFrame(function(){refreshPeopleWhenDataReady(root,true);});
  });
  document.addEventListener('click',function(e){
    var retry=e.target&&e.target.closest&&e.target.closest('[data-phfck-people-retry]');
    if(!retry)return;
    var root=document.getElementById('phfChecklistRoot');
    if(root){var workspace=root.querySelector('[data-phfck-workspace]');if(workspace)workspace.innerHTML=peopleLoadingHtml(false);refreshPeopleWhenDataReady(root,true);}
    try{if(typeof window.phfEnsureTrainingDataReady==='function')window.phfEnsureTrainingDataReady();else if(typeof window.phfRefreshTrainingData==='function')window.phfRefreshTrainingData(true,{reason:'checklist-people-retry'});}catch(_e){}
  },true);
  window.phfRenderChecklist=render;

  document.addEventListener('click',function(e){var picker=e.target.closest('.phfck-time-picker');if(!picker){if(!e.target.closest('[data-phfck-time-trigger]'))document.querySelectorAll('.phfck-time-picker').forEach(function(x){x.remove();});return;}var target=picker.__target;if(!target)return;if(e.target.closest('[data-phfck-time-now]')){var now=currentTime24();picker.querySelector('[data-phfck-time-preview]').textContent=now;target.value=now;}var hb=e.target.closest('[data-phfck-hour]');if(hb){picker.querySelectorAll('[data-phfck-hour]').forEach(function(x){x.classList.remove('active');});hb.classList.add('active');}var mb=e.target.closest('[data-phfck-minute]');if(mb){picker.querySelectorAll('[data-phfck-minute]').forEach(function(x){x.classList.remove('active');});mb.classList.add('active');}var h=(picker.querySelector('[data-phfck-hour].active')||{}).getAttribute?picker.querySelector('[data-phfck-hour].active').getAttribute('data-phfck-hour'):currentTime24().slice(0,2);var m=(picker.querySelector('[data-phfck-minute].active')||{}).getAttribute?picker.querySelector('[data-phfck-minute].active').getAttribute('data-phfck-minute'):'00';var preview=picker.querySelector('[data-phfck-time-preview]');if(preview)preview.textContent=h+':'+m;if(e.target.closest('[data-phfck-time-apply]')){target.value=h+':'+m;target.dispatchEvent(new Event('change',{bubbles:true}));picker.remove();}},true);

})();
