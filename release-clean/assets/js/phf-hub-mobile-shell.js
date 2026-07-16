/* PHF 62.11 - Training Hub mobile drawer single controller.
   Owns only the authenticated Hub mobile shell. It reuses the real nav,
   lets each existing onclick/router handler finish, then closes the drawer. */
(function(){
  'use strict';

  var MOBILE_QUERY='(max-width:600px), (max-width:820px) and (hover:none) and (pointer:coarse)';
  var mq=window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null;
  var booted=false;

  function isMobile(){ return !!(mq && mq.matches); }
  function getHeader(){ return document.querySelector('body.phf-main-shell-mode .topbar.phf-site-header'); }

  function ensureBackdrop(){
    var el=document.querySelector('.phf-hub-mobile-backdrop');
    if(el) return el;
    el=document.createElement('div');
    el.className='phf-hub-mobile-backdrop';
    el.setAttribute('aria-hidden','true');
    document.body.appendChild(el);
    el.addEventListener('click',close);
    return el;
  }

  function sync(open){
    var h=getHeader();
    if(!h) return;
    var shouldOpen=!!open && isMobile();
    h.classList.toggle('phf-mobile-open',shouldOpen);
    document.body.classList.toggle('phf-hub-mobile-drawer-open',shouldOpen);
    var btn=h.querySelector('.phf-mobile-menu-toggle');
    if(btn){
      btn.setAttribute('aria-expanded',shouldOpen?'true':'false');
      btn.setAttribute('aria-label',shouldOpen?'Đóng menu điều hướng':'Mở menu điều hướng');
      btn.textContent=shouldOpen?'Đóng':'☰ Menu';
    }
  }

  function close(){ sync(false); }

  function onDocumentClick(ev){
    if(!isMobile()) return;
    var h=getHeader();
    if(!h) return;

    var toggle=ev.target && ev.target.closest ? ev.target.closest('.phf-mobile-menu-toggle') : null;
    if(toggle && h.contains(toggle)){
      ev.preventDefault();
      ev.stopPropagation();
      sync(!h.classList.contains('phf-mobile-open'));
      return;
    }

    var navButton=ev.target && ev.target.closest ? ev.target.closest('.phf-main-nav button[data-phf-main-nav]') : null;
    if(navButton && h.contains(navButton)){
      /* Do not prevent or stop the event. The existing inline handler/router
         must run first. Close only after the current click stack finishes. */
      window.setTimeout(close,0);
      return;
    }
  }

  function boot(){
    if(booted) return;
    booted=true;
    ensureBackdrop();
    document.addEventListener('click',onDocumentClick,false);
    document.addEventListener('keydown',function(ev){ if(ev.key==='Escape') close(); });
    window.addEventListener('resize',function(){ if(!isMobile()) close(); });
    window.addEventListener('popstate',close);
    document.addEventListener('phf-auth-changed',close);
    if(mq && typeof mq.addEventListener==='function') mq.addEventListener('change',function(){ if(!isMobile()) close(); });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();

  window.phfCloseHubMobileDrawer=close;
})();
