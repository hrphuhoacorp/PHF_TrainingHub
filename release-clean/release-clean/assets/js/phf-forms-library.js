(function(){
  'use strict';
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function role(){try{return String((window.phfGetSessionRole&&window.phfGetSessionRole())||localStorage.getItem('phfInternalTestRole')||'').toLowerCase();}catch(e){return '';}}
  function isAdmin(){var r=role();return r==='admin'||r.indexOf('admin')>=0||r.indexOf('quản trị')>=0||r.indexOf('quan tri')>=0;}
  var FORMS=[
    {id:'evaluation-weekly',icon:'📋',name:'Phiếu đánh giá tuần',code:'DGT-01',version:'01',group:'Đánh giá thử việc',description:'Mẫu trống dùng ghi nhận kết quả theo tuần trong thời gian đào tạo/thử việc.'},
    {id:'evaluation-monthly',icon:'🗓️',name:'Phiếu đánh giá tháng',code:'DGT-02',version:'01',group:'Đánh giá thử việc',description:'Mẫu trống dùng tổng hợp kết quả theo tháng và nội dung cần tiếp tục kèm cặp.'},
    {id:'evaluation-final',icon:'✅',name:'Phiếu đánh giá kết thúc thử việc',code:'DGTV-01',version:'01',group:'Đánh giá thử việc',description:'Mẫu trống bố cục cân đối để đánh giá kết quả, nhận xét và đề xuất sau thời gian thử việc.'}
  ];
  function openForm(id,autoPrint){
    var form=FORMS.find(function(x){return x.id===id;});
    if(!form) return;
    var url='/forms/'+encodeURIComponent(form.id)+'/print'+(autoPrint?'?print=1':'');
    var win=window.open(url,'_blank','noopener');
    if(!win && window.phfToast) window.phfToast('warning','Trình duyệt đang chặn cửa sổ mới','Vui lòng cho phép mở cửa sổ mới để xem hoặc in biểu mẫu.',4200,'forms-popup');
  }
  window.phfOpenBlankForm=function(id){openForm(id,false);};
  window.phfPrintBlankForm=function(id){openForm(id,true);};
  window.phfRenderEvaluationFormsLibrary=function(){
    if(!isAdmin()){
      if(window.phfToast) window.phfToast('warning','Không đủ quyền','Khu vực biểu mẫu hiện chỉ dành cho Admin.',3200,'forms-role');
      return;
    }
    try{if(window.phfHideIntroAndStopAuto)window.phfHideIntroAndStopAuto();}catch(e){}
    try{if(window.phfEnsureSharedShell)window.phfEnsureSharedShell('admin');}catch(e){}
    try{if(window.phfSetMainNavActive)window.phfSetMainNavActive('admin');}catch(e){}
    var main=document.getElementById('mainLesson'); if(!main)return;
    var cards=FORMS.map(function(f){return '<article class="phf-form-card"><div class="phf-form-card-top"><span class="phf-form-icon">'+f.icon+'</span><span class="phf-form-status">Đang áp dụng</span></div><h3>'+esc(f.name)+'</h3><p>'+esc(f.description)+'</p><dl><div><dt>Mã mẫu</dt><dd>'+esc(f.code)+'</dd></div><div><dt>Phiên bản</dt><dd>'+esc(f.version)+'</dd></div><div><dt>Nhóm</dt><dd>'+esc(f.group)+'</dd></div></dl><div class="phf-form-actions"><button type="button" onclick="phfOpenBlankForm(\''+f.id+'\')">Xem mẫu</button><button class="primary" type="button" onclick="phfPrintBlankForm(\''+f.id+'\')">In mẫu trống</button></div></article>';}).join('');
    main.innerHTML='<section class="phf-forms-library"><div class="phf-admin-hero"><div><span class="phf-admin-kicker">PHF Training Hub · Quản trị</span><h2>Mẫu đánh giá</h2><p>Khu tập trung các biểu mẫu trống đang áp dụng. Biểu mẫu tại đây chỉ dùng để xem hoặc in, không gắn với nhân viên và không tạo dữ liệu đánh giá.</p></div><div class="phf-admin-role">Admin<small>Thư viện biểu mẫu</small></div></div><div class="phf-forms-toolbar"><div><b>'+FORMS.length+' biểu mẫu</b><span>Phiếu đánh giá tuần, tháng và kết thúc thử việc</span></div><button type="button" onclick="phfRenderAdminManagement()">← Về Quản trị</button></div><div class="phf-forms-grid">'+cards+'</div><div class="phf-admin-note"><b>Phân biệt:</b> Đây là mẫu trống để in. Phiếu đã lập cho từng nhân viên vẫn được xem và lưu tại Hồ sơ nhân viên → Đánh giá.</div></section>';
    try{window.scrollTo({top:0,left:0,behavior:'auto'});}catch(e){}
  };
})();
