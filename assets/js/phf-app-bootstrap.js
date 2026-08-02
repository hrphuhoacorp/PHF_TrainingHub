/* PHF Training Hub - single application bootstrap */
(function(){
  'use strict';
  var started=false;
  var starting=null;
  var WAIT_TIMEOUT_MS=10000;
  var WAIT_INTERVAL_MS=50;

  function log(stage,detail){
    try{console.info('[PHF BOOT]',stage,detail||'');}catch(e){}
  }

  function sleep(ms){
    return new Promise(function(resolve){setTimeout(resolve,ms);});
  }

  async function waitForRuntime(timeoutMs){
    var startedAt=Date.now();
    while(Date.now()-startedAt<timeoutMs){
      if(typeof window.phfStartUrlRouter==='function' &&
         typeof window.phfStartServerAuth==='function'){
        return true;
      }
      await sleep(WAIT_INTERVAL_MS);
    }
    throw new Error('Router/Auth không khởi tạo sau '+Math.round(timeoutMs/1000)+' giây');
  }

  function clearBootError(){
    var old=document.getElementById('phf-bootstrap-error');
    if(old&&old.parentNode) old.parentNode.removeChild(old);
  }

  function renderBootstrapError(error){
    try{
      clearBootError();
      document.documentElement.classList.remove('phf-route-boot-pending','phf-f5-restoring','phf-auth-boot');
      var box=document.createElement('div');
      box.id='phf-bootstrap-error';
      box.setAttribute('role','alert');
      box.style.cssText='position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a';
      box.innerHTML='<div style="width:min(520px,100%);background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;box-shadow:0 18px 50px rgba(15,23,42,.14);text-align:center">'+
        '<h2 style="margin:0 0 10px;font-size:22px">Không thể khởi động PHF HR</h2>'+
        '<p style="margin:0 0 18px;line-height:1.55;color:#475569">Router hoặc phiên đăng nhập chưa tải xong. Anh bấm Thử lại để hệ thống khởi động lại, dữ liệu không bị thay đổi.</p>'+
        '<button type="button" id="phf-bootstrap-retry" style="border:0;border-radius:10px;padding:11px 18px;font-weight:700;cursor:pointer;background:#0f766e;color:#fff">Thử lại</button>'+
        '<div style="margin-top:12px;font-size:12px;color:#94a3b8">'+String(error&&error.message||'Lỗi khởi động')+'</div></div>';
      document.body.appendChild(box);
      var retry=document.getElementById('phf-bootstrap-retry');
      if(retry) retry.addEventListener('click',function(){
        clearBootError();
        started=false;
        starting=null;
        start();
      },{once:true});
    }catch(renderError){
      console.error('[PHF BOOT] render error failed',renderError);
    }
  }

  function start(){
    if(started) return Promise.resolve(true);
    if(starting) return starting;

    starting=(async function(){
      try{
        await waitForRuntime(WAIT_TIMEOUT_MS);
        if(started) return true;
        started=true;
        window.__phfSingleBootstrapActive=true;
        clearBootError();
        log('start',location.pathname);

        /* Router đăng ký restore/guard trước; router tự chờ auth-ready. */
        Promise.resolve(window.phfStartUrlRouter()).catch(function(e){
          console.error('[PHF BOOT] router',e);
          renderBootstrapError(e);
        });
        Promise.resolve(window.phfStartServerAuth()).catch(function(e){
          console.error('[PHF BOOT] auth',e);
          renderBootstrapError(e);
        });
        return true;
      }catch(e){
        started=false;
        console.error('[PHF BOOT] start failed',e);
        renderBootstrapError(e);
        return false;
      }finally{
        starting=null;
      }
    })();
    return starting;
  }

  window.phfStartApplication=start;
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
