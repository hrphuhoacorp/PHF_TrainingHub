/* PHF route diagnostic only — no DOM correction, no business change. */
(function phfRouteDiagnostic(){
  'use strict';
  if(window.__PHF_ROUTE_DIAGNOSTIC__) return;
  window.__PHF_ROUTE_DIAGNOSTIC__=true;
  var seq=0;
  function stamp(){ return new Date().toISOString(); }
  function path(){ return location.pathname + location.search + location.hash; }
  function label(el){
    if(!el) return 'null';
    return (el.id?'#'+el.id:el.tagName||'node')+(el.className&&typeof el.className==='string'?'.'+el.className.trim().replace(/\s+/g,'.'):'');
  }
  function summary(main){
    if(!main) return {host:false};
    var h=(main.querySelector('h1,h2,h3')||{}).textContent||'';
    return {host:true,heading:h.trim(),library:!!main.querySelector('.phf-training-library'),report:!!main.querySelector('.hub-report-page,.phf-ban7-dashboard'),htmlLength:(main.innerHTML||'').length};
  }
  function log(kind,msg,extra,trace){
    seq++;
    var head='['+kind+'] #'+seq+' '+stamp()+' '+path()+' — '+msg;
    console.groupCollapsed(head);
    if(extra!==undefined) console.log(extra);
    if(trace) console.trace('[STACK] '+msg);
    console.groupEnd();
  }
  window.phfRouteDebugDump=function(){
    var main=document.getElementById('mainLesson');
    console.log('[PHF DEBUG DUMP]',{path:path(),historyState:history.state,activeNav:(document.querySelector('[data-phf-main-nav].active')||{}).getAttribute&&document.querySelector('[data-phf-main-nav].active').getAttribute('data-phf-main-nav'),main:summary(main)});
  };

  ['pushState','replaceState'].forEach(function(name){
    var old=history[name];
    if(typeof old!=='function') return;
    history[name]=function(state,title,url){
      log('HISTORY',name+' → '+String(url||''),{state:state,before:path()},true);
      var out=old.apply(this,arguments);
      log('HISTORY',name+' complete',{after:path()});
      return out;
    };
  });
  window.addEventListener('popstate',function(e){log('ROUTER','popstate',{state:e.state},true);});
  window.addEventListener('pageshow',function(e){log('BOOT','pageshow persisted='+!!e.persisted,summary(document.getElementById('mainLesson')),true);});
  document.addEventListener('DOMContentLoaded',function(){log('BOOT','DOMContentLoaded',summary(document.getElementById('mainLesson')),true);});
  window.addEventListener('load',function(){log('BOOT','window.load',summary(document.getElementById('mainLesson')),true);});
  document.addEventListener('click',function(e){
    var b=e.target&&e.target.closest&&e.target.closest('[data-phf-main-nav],a,button');
    if(b) log('CLICK',label(b),{nav:b.getAttribute('data-phf-main-nav'),href:b.getAttribute('href'),onclick:b.getAttribute('onclick')},true);
  },true);

  function isMainTarget(node){
    var main=document.getElementById('mainLesson');
    return !!(main && (node===main || (node&&node.nodeType===1&&main.contains(node))));
  }
  var d=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
  if(d&&d.set&&d.get){
    Object.defineProperty(Element.prototype,'innerHTML',{
      configurable:d.configurable,enumerable:d.enumerable,
      get:d.get,
      set:function(v){
        if(isMainTarget(this)) log('MAIN','innerHTML write on '+label(this),{before:summary(document.getElementById('mainLesson')),incoming:String(v||'').slice(0,240)},true);
        var out=d.set.call(this,v);
        if(isMainTarget(this)) log('MAIN','innerHTML write complete',summary(document.getElementById('mainLesson')));
        return out;
      }
    });
  }
  ['replaceChildren','append','prepend','insertAdjacentHTML'].forEach(function(name){
    var proto=name==='insertAdjacentHTML'?Element.prototype:(Element.prototype[name]?Element.prototype:Node.prototype);
    var old=proto&&proto[name];
    if(typeof old!=='function') return;
    proto[name]=function(){
      if(isMainTarget(this)) log('MAIN',name+' on '+label(this),{before:summary(document.getElementById('mainLesson')),args:[].slice.call(arguments,0,3)},true);
      var out=old.apply(this,arguments);
      if(isMainTarget(this)) log('MAIN',name+' complete',summary(document.getElementById('mainLesson')));
      return out;
    };
  });

  function wrap(name,kind){
    var fn=window[name];
    if(typeof fn!=='function'||fn.__phfDebugWrapped) return false;
    function wrapped(){
      log(kind||'RENDER',name+' ENTER',{args:[].slice.call(arguments),main:summary(document.getElementById('mainLesson'))},true);
      var result;
      try{result=fn.apply(this,arguments);}catch(err){log(kind||'RENDER',name+' THROW',err,true);throw err;}
      return Promise.resolve(result).then(function(value){log(kind||'RENDER',name+' EXIT',{result:value,main:summary(document.getElementById('mainLesson'))});return value;},function(err){log(kind||'RENDER',name+' REJECT',err,true);throw err;});
    }
    wrapped.__phfDebugWrapped=true; wrapped.__phfOriginal=fn; window[name]=wrapped; return true;
  }
  function install(){
    ['phfNavigate','phfRenderTrainingLibrary','__phfRenderTrainingLibraryRoute','phfRenderTrainingReports','phfRenderTrainingOverview','phfRenderTrainingHubHome','phfRenderPostLoginHome','phfEnsureSharedShell','phfSetMainNavActive'].forEach(function(n){wrap(n,n==='phfNavigate'?'ROUTER':'RENDER');});
  }
  install();
  var installTimer=setInterval(install,100);
  setTimeout(function(){clearInterval(installTimer);install();},5000);

  var mainObserver=null;
  function observeMain(){
    var main=document.getElementById('mainLesson');
    if(!main||mainObserver) return;
    mainObserver=new MutationObserver(function(records){
      log('OVERWRITE','MutationObserver: #mainLesson changed',{records:records.map(function(r){return {type:r.type,added:r.addedNodes.length,removed:r.removedNodes.length};}),main:summary(main)},true);
    });
    mainObserver.observe(main,{childList:true,subtree:true,characterData:true});
    log('MAIN','diagnostic observer installed',summary(main));
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',observeMain,{once:true}); else observeMain();
  setTimeout(observeMain,0);
  console.warn('[PHF ROUTE DEBUG] Diagnostic mode active. No automatic DOM correction is enabled.');
})();
