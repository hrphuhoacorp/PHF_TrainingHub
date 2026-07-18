(function(){
'use strict';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function role(){try{return window.phfGetSessionRole?window.phfGetSessionRole():'learner';}catch(e){return 'learner';}}
function prefix(){var r=role();return r==='admin'?'/admin':(r==='manager'?'/ql':'/hv');}
function userName(){try{var u=window.phfGetCurrentUser&&window.phfGetCurrentUser();return (u&&(u.fullName||u.name||u.displayName||u.email))||'Anh/chị';}catch(e){return 'Anh/chị';}}
function go(path){if(window.phfNavigate)return window.phfNavigate(path);location.href=path;}
window.phfOpenHrModule=function(module){var p=prefix();var map={hub:p+'/hub',classroom:p+'/classroom',checklist:p+'/checklist',knl:p+'/knl'};return go(map[module]||p);};
window.phfRenderPostLoginHome=function(){
  if(window.PHFAppShell) window.PHFAppShell.activateHub({clear:false});
  try{ if(typeof phfHideIntroAndStopAuto==='function') phfHideIntroAndStopAuto(); }catch(e){}
  document.body.classList.add('phf-hr-gateway-mode');
  var main=document.getElementById('mainLesson'); if(!main)return false;
  var name=esc(userName());
  main.innerHTML=`<section class="phf-hr-home" aria-label="Trang chủ PHF HR">
    <header class="phf-hr-welcome"><div><span class="phf-hr-kicker">PHF HR</span><h1>Kết nối toàn bộ hành trình phát triển nhân sự</h1><p>Từ hội nhập, đào tạo, tuân thủ công việc đến phát triển năng lực — mọi giai đoạn đều được kết nối trên một hệ thống thống nhất.</p></div><div class="phf-hr-user"><span>Xin chào,</span><strong>${name}</strong></div></header>
    <section class="phf-hr-journey" aria-label="Hành trình phát triển nhân sự">
      <div class="phf-hr-journey-line"></div>
      <article><b>Bước 1</b><i>🌱</i><h3>Hội nhập & Khởi đầu</h3><p>Làm quen, hội nhập và xác định lộ trình ban đầu.</p></article>
      <article><b>Bước 2</b><i>📖</i><h3>Đào tạo & Học tập</h3><p>Đào tạo nội bộ, lớp học, tài liệu và kiểm tra.</p></article>
      <article><b>Bước 3</b><i>✓</i><h3>Tuân thủ & Thực thi</h3><p>Ghi nhận tuân thủ, theo dõi công việc và đánh giá kết quả.</p></article>
      <article><b>Bước 4</b><i>★</i><h3>Đánh giá & Phát triển</h3><p>Đánh giá năng lực, xác định điểm mạnh và phát triển lâu dài.</p></article>
    </section>
    <section class="phf-hr-modules">
      <article class="is-hub"><div class="phf-hr-module-icon">🎓</div><h2>Training Hub</h2><b>Hội nhập & Lộ trình</b><p>Học theo lộ trình, hoàn thành bài học, kiểm tra và theo dõi tiến độ học tập.</p><button type="button" onclick="phfOpenHrModule('hub')">Truy cập <span>→</span></button></article>
      <article class="is-classroom"><div class="phf-hr-module-icon">👥</div><h2>Classroom</h2><b>Đào tạo nội bộ</b><p>Tham gia lớp học, xem tài liệu, điểm danh và làm bài kiểm tra.</p><button type="button" onclick="phfOpenHrModule('classroom')">Truy cập <span>→</span></button></article>
      <article class="is-checklist"><div class="phf-hr-module-icon">✓</div><h2>Checklist</h2><b>Tuân thủ & Đánh giá</b><p>Thực hiện checklist, ghi nhận lỗi, giải trình và theo dõi điểm đánh giá.</p><button type="button" onclick="phfOpenHrModule('checklist')">Truy cập <span>→</span></button></article>
      <article class="is-knl"><div class="phf-hr-module-icon">★</div><h2>Khung năng lực</h2><b>Đánh giá & Phát triển</b><p>Đánh giá năng lực, xem kết quả và xây dựng kế hoạch phát triển.</p><button type="button" onclick="phfOpenHrModule('knl')">Sắp triển khai <span>→</span></button></article>
    </section>
  </section>`;
  document.title='PHF HR · Hệ thống phát triển nhân sự';
  try{window.scrollTo({top:0,behavior:'instant'});}catch(e){window.scrollTo(0,0);}
  return true;
};
})();
