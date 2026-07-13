/* PHF Training Hub - single application bootstrap */
(function(){
  'use strict';
  var started=false;
  function log(stage,detail){
    try{console.info('[PHF BOOT]',stage,detail||'');}catch(e){}
  }
  function start(){
    if(started)return;
    started=true;
    window.__phfSingleBootstrapActive=true;
    log('start',location.pathname);
    try{
      if(typeof window.phfStartUrlRouter!=='function') throw new Error('Router chưa sẵn sàng');
      /* Router phải đăng ký restore/guard trước; không await vì router chờ auth. */
      Promise.resolve(window.phfStartUrlRouter()).catch(function(e){console.error('[PHF BOOT] router',e);});
      if(typeof window.phfStartServerAuth!=='function') throw new Error('Auth chưa sẵn sàng');
      Promise.resolve(window.phfStartServerAuth()).catch(function(e){console.error('[PHF BOOT] auth',e);});
    }catch(e){
      console.error('[PHF BOOT] start failed',e);
      try{document.documentElement.classList.remove('phf-route-boot-pending','phf-f5-restoring','phf-auth-boot');}catch(_e){}
    }
  }
  window.phfStartApplication=start;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
