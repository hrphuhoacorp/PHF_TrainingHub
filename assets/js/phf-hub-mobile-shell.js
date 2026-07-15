/* PHF 62.10 - Training Hub mobile drawer lifecycle with device-aware breakpoint.
   Reuses the existing header/nav/account actions and does not own routing or session. */
(function(){
  'use strict';
  var MOBILE_QUERY='(max-width:600px), (max-width:820px) and (hover:none) and (pointer:coarse)';
  var mq=window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null;
  function isMobile(){ return !!(mq && mq.matches); }
  function header(){ return document.querySelector('body.phf-main-shell-mode .topbar.phf-site-header'); }
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
    var h=header();
    if(!h) return;
    h.classList.toggle('phf-mobile-open',!!open);
    document.body.classList.toggle('phf-hub-mobile-drawer-open',!!open && isMobile());
    var btn=h.querySelector('.phf-mobile-menu-toggle');
    if(btn){
      btn.setAttribute('aria-expanded',open?'true':'false');
      btn.setAttribute('aria-label',open?'Đóng menu điều hướng':'Mở menu điều hướng');
      btn.textContent=open?'Đóng':'☰ Menu';
    }
  }
  function close(){ sync(false); }
  function boot(){
    ensureBackdrop();
    document.addEventListener('click',function(ev){
      if(!isMobile()) return;
      var h=header(); if(!h) return;
      var toggle=ev.target && ev.target.closest ? ev.target.closest('.phf-mobile-menu-toggle') : null;
      if(toggle && h.contains(toggle)){
        ev.preventDefault(); ev.stopPropagation();
        sync(!h.classList.contains('phf-mobile-open'));
        return;
      }
      var nav=ev.target && ev.target.closest ? ev.target.closest('.phf-main-nav button') : null;
      if(nav && h.contains(nav)) setTimeout(close,0);
    },true);
    document.addEventListener('keydown',function(ev){ if(ev.key==='Escape') close(); });
    window.addEventListener('resize',function(){ if(!isMobile()) close(); });
    window.addEventListener('popstate',close);
    document.addEventListener('phf-auth-changed',close);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
  window.phfCloseHubMobileDrawer=close;
})();
