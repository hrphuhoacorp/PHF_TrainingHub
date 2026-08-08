(function(){
  'use strict';

  /* PHF AI - Floating Assistant. Hien tren MOI trang cho Admin, khong doi
     route khi mo/dong. Dung CHUNG endpoint/orchestration/renderer voi
     /admin/ai-sandbox qua window.PHFAiEngine.mount() - khong co AI
     implementation rieng. An/hien CHI la UX: backend van tu enforce
     requireSession(['admin']) doc lap, khong coi day la security. */

  var mounted = false;
  var controller = null;
  var open = false;
  var root, iconBtn, panel;

  function isAdmin(){
    try { return !!(window.phfGetSessionRole && window.phfGetSessionRole() === 'admin'); }
    catch (e) { return false; }
  }

  function markSvg(){ return (window.PHFAiEngine && window.PHFAiEngine.markSvg) || 'AI'; }

  function build(){
    if (mounted) return;
    mounted = true;
    root = document.createElement('div');
    root.id = 'phfAiFloatingWidget';
    root.className = 'phf-ai-floating';
    root.hidden = true;
    root.innerHTML =
      '<button type="button" class="phf-ai-floating-btn" data-ai-floating-toggle aria-label="Mở PHF AI" aria-expanded="false" title="PHF AI">' + markSvg() + '</button>' +
      '<div class="phf-ai-floating-panel" data-ai-floating-panel aria-hidden="true">' +
        '<div class="phf-ai-floating-panel-head">' +
          '<span class="phf-ai-mark" aria-hidden="true">' + markSvg() + '</span>' +
          '<span class="phf-ai-floating-panel-title"><strong>PHF AI</strong><small>AI thử nghiệm</small></span>' +
          '<button type="button" class="phf-ai-floating-close" data-ai-floating-close aria-label="Đóng PHF AI">✕</button>' +
        '</div>' +
        '<div class="phf-ai-floating-panel-body" data-ai-floating-body></div>' +
      '</div>';
    document.body.appendChild(root);

    iconBtn = root.querySelector('[data-ai-floating-toggle]');
    panel = root.querySelector('[data-ai-floating-panel]');
    var closeBtn = root.querySelector('[data-ai-floating-close]');

    iconBtn.addEventListener('click', function(){ setOpen(!open); });
    closeBtn.addEventListener('click', function(){ setOpen(false); });
    document.addEventListener('keydown', function(evt){
      if (evt.key === 'Escape' && open) setOpen(false);
    });
  }

  function setOpen(next){
    open = !!next;
    if (panel) {
      panel.classList.toggle('phf-ai-panel-open', open);
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    if (iconBtn) iconBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (document.body) document.body.classList.toggle('phf-ai-floating-open', open);
    if (open) {
      if (!controller && window.PHFAiEngine) {
        controller = window.PHFAiEngine.mount(root.querySelector('[data-ai-floating-body]'), {});
      }
      if (controller) controller.focus();
    }
  }

  function updateVisibility(){
    if (isAdmin()) {
      build();
      root.hidden = false;
    } else if (root) {
      setOpen(false);
      root.hidden = true;
    }
  }

  function init(){
    if (typeof window.phfWhenAuthReady === 'function') {
      window.phfWhenAuthReady().then(updateVisibility).catch(function(){});
    } else {
      updateVisibility();
    }
    window.addEventListener('phf-auth-changed', updateVisibility);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
