(function(){
'use strict';
var root=document.getElementById('phfEvaluationPrintRoot');var done=false;
function fail(){if(done)return;root.innerHTML='<div style="max-width:680px;margin:60px auto;padding:24px;border:1px solid #ddd;border-radius:12px;text-align:center"><h2>Chưa nhận được nội dung phiếu</h2><p>Vui lòng đóng trang này và bấm In phiếu lại từ hồ sơ nhân viên.</p></div>';}
window.addEventListener('message',function(ev){
 if(ev.origin!==location.origin||!ev.data||ev.data.type!=='PHF_EVALUATION_PRINT')return;
 done=true;document.open();document.write(ev.data.html||'');document.close();
 setTimeout(function(){try{window.focus();window.print();}catch(e){}},350);
});
try{if(window.opener)window.opener.postMessage({type:'PHF_EVALUATION_PRINT_READY'},location.origin);else fail();}catch(e){fail();}
setTimeout(fail,3000);
})();
