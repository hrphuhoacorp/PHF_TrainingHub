(function(){
  'use strict';

  /* PHF AI - trang day /admin/ai-sandbox. Chi lo "khung" trang (header, back
     button, badge) - toan bo logic chat/render nam trong phf-ai-engine.js,
     dung CHUNG voi floating assistant (phf-ai-floating.js). */

  function roleHome(){
    var r = 'learner';
    try { r = window.phfGetSessionRole ? window.phfGetSessionRole() : 'learner'; } catch (e) {}
    return r === 'admin' ? '/admin' : (r === 'manager' ? '/ql' : '/hv');
  }
  function escapeAttr(value){
    return String(value == null ? '' : value)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  window.phfRenderAiSandbox = function(path){
    if (window.PHFAppShell) window.PHFAppShell.activateAiSandbox(path);
    var root = document.getElementById('phfAiSandboxRoot');
    if (!root || !window.PHFAiEngine) return false;
    root.innerHTML =
      '<main class="phf-ai-sandbox">' +
        '<header class="phf-ai-sandbox-header">' +
          '<button type="button" class="phf-ai-back" onclick="phfNavigate(\'' + escapeAttr(roleHome()) + '\')">← PHF HR</button>' +
          '<div class="phf-ai-sandbox-title"><span class="phf-ai-mark" aria-hidden="true">' + window.PHFAiEngine.markSvg + '</span><span><strong>PHF AI</strong><small>AI thử nghiệm</small></span></div>' +
          '<span class="phf-ai-badge">DeepSeek • Thử nghiệm</span>' +
        '</header>' +
        '<div class="phf-ai-sandbox-body" data-ai-engine-root></div>' +
      '</main>';
    document.title = 'PHF AI · Thử nghiệm';
    window.PHFAiEngine.mount(root.querySelector('[data-ai-engine-root]'), {});
    return true;
  };
})();
