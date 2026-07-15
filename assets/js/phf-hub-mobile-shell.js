(function(){
  'use strict';
  var mq=window.matchMedia('(max-width:760px)');
  function header(){return document.querySelector('.topbar.phf-site-header');}
  function backdrop(){
    var el=document.getElementById('phfHubMobileBackdrop');
    if(!el){el=document.createElement('div');el.id='phfHubMobileBackdrop';el.className='phf-hub-mobile-backdrop';document.body.appendChild(el);el.addEventListener('click',close);}
    return el;
  }
  function sync(){
    var h=header(), b=backdrop();
    var open=!!(mq.matches&&h&&h.classList.contains('phf-mobile-open'));
    b.classList.toggle('is-open',open);
    document.body.classList.toggle('phf-hub-mobile-menu-open',open);
  }
  function close(){
    var h=header(); if(h)h.classList.remove('phf-mobile-open');
    var btn=document.querySelector('.topbar.phf-site-header .phf-mobile-menu-toggle');
    if(btn){btn.setAttribute('aria-expanded','false');btn.textContent='☰ Menu';}
    sync();
  }
  document.addEventListener('click',function(e){
    if(e.target.closest('.topbar.phf-site-header .phf-mobile-menu-toggle'))setTimeout(sync,0);
    if(mq.matches&&e.target.closest('.topbar.phf-site-header .phf-main-nav button'))setTimeout(close,0);
  },true);
  document.addEventListener('keydown',function(e){if(e.key==='Escape')close();});
  window.addEventListener('resize',function(){if(!mq.matches)close();else sync();});
  document.addEventListener('DOMContentLoaded',sync);
  setTimeout(sync,100);
})();
