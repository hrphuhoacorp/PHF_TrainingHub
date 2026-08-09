(function(){
  'use strict';

  /* PHF AI - Floating Assistant. Chi hien cho session Admin da xac thuc,
     khong doi route khi mo/dong. Dung CHUNG
     endpoint/orchestration/renderer voi /admin/ai-sandbox qua
     window.PHFAiEngine.mount() - khong co AI implementation rieng. An/hien
     CHI la UX: backend van fail-closed theo session Admin doc lap. */

  var mounted = false;
  var controller = null;
  var open = false;
  var root, iconBtn, panel;
  var ALLOWED_ROLES = { admin: true };

  function isAllowedRole(){
    try { return !!(window.phfGetSessionRole && ALLOWED_ROLES[String(window.phfGetSessionRole() || '').toLowerCase()]); }
    catch (e) { return false; }
  }

  function markSvg(){ return (window.PHFAiEngine && window.PHFAiEngine.markSvg) || 'AI'; }

  /* ---- Mobile drag-to-reposition (khong dung cho desktop) ----
     Chi keo duoc icon khi: dang o mobile viewport (khop dung breakpoint
     CSS @media(max-width:700px) cua .phf-ai-floating) VA panel dang DONG.
     Desktop KHONG BAO GIO chay logic nay (moi handler tu kiem tra
     isMobileViewport() truoc, khong co nhanh nao doi position/style tren
     desktop). Vi tri mobile luu localStorage rieng, khong dung de doi
     desktop (xoa het inline style khi resize/xoay man hinh sang desktop -
     xem applyResponsivePosition). */
  var MOBILE_BREAKPOINT = 700;
  var DRAG_THRESHOLD_PX = 6;
  var EDGE_MARGIN_PX = 14; // khop margin mac dinh cua .phf-ai-floating o mobile (right/bottom:14px)
  var STORAGE_KEY = 'phfAiFloatingMobilePos';

  function isMobileViewport(){
    try { return window.matchMedia('(max-width:' + MOBILE_BREAKPOINT + 'px)').matches; }
    catch (e) { return window.innerWidth <= MOBILE_BREAKPOINT; }
  }
  function safeGetItem(key){ try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function safeSetItem(key, value){ try { window.localStorage.setItem(key, value); } catch (e) { /* private mode/quota - bo qua, khong chan UX */ } }

  function loadSavedPosition(){
    var raw = safeGetItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || (parsed.side !== 'left' && parsed.side !== 'right') || !Number.isFinite(parsed.top)) return null;
      return parsed;
    } catch (e) { return null; }
  }
  function saveSavedPosition(pos){ safeSetItem(STORAGE_KEY, JSON.stringify(pos)); }

  function clampTop(top, elHeight){
    var maxTop = Math.max(EDGE_MARGIN_PX, window.innerHeight - elHeight - EDGE_MARGIN_PX);
    return Math.min(Math.max(top, EDGE_MARGIN_PX), maxTop);
  }

  // Ap dung 1 vi tri {side, top} da clamp len root qua inline style - CHI
  // goi khi dang mobile. Khong dung transform (drag da dung transform rieng
  // khi dang keo, xem onPointerMove) - o day dung left/right/top thang de
  // tuong thich voi CSS position:fixed goc.
  function applyPosition(pos){
    if (!root) return;
    var rect = root.getBoundingClientRect();
    var clampedTop = clampTop(pos.top, rect.height || 60);
    root.style.top = clampedTop + 'px';
    root.style.bottom = 'auto';
    if (pos.side === 'left') { root.style.left = EDGE_MARGIN_PX + 'px'; root.style.right = 'auto'; }
    else { root.style.right = EDGE_MARGIN_PX + 'px'; root.style.left = 'auto'; }
  }

  function clearInlinePosition(){
    if (!root) return;
    root.style.left = ''; root.style.right = ''; root.style.top = ''; root.style.bottom = '';
  }

  // Chay khi mount xong + khi resize/xoay man hinh. Desktop -> luon xoa
  // inline style (tra ve dung CSS goc, khong bao gio giu vi tri mobile cu).
  // Mobile -> ap lai vi tri da luu (neu co), luon clamp lai theo viewport
  // hien tai (xoay man hinh/resize khong duoc de icon lot ra ngoai).
  function applyResponsivePosition(){
    if (!root) return;
    if (!isMobileViewport()) { clearInlinePosition(); return; }
    var saved = loadSavedPosition();
    if (saved) applyPosition(saved);
  }

  var dragState = null; // {pointerId, startX, startY, startLeft, startTop, moved}
  var suppressNextClick = false;

  function onPointerDown(evt){
    if (open || !isMobileViewport() || dragState) return;
    if (evt.button != null && evt.button !== 0) return; // chi chuot trai neu la mouse pointer
    var rect = root.getBoundingClientRect();
    dragState = {
      pointerId: evt.pointerId,
      startClientX: evt.clientX, startClientY: evt.clientY,
      startLeft: rect.left, startTop: rect.top,
      width: rect.width, height: rect.height,
      moved: false
    };
    try { iconBtn.setPointerCapture(evt.pointerId); } catch (e) { /* khong bat buoc */ }
  }

  function onPointerMove(evt){
    if (!dragState || evt.pointerId !== dragState.pointerId) return;
    var dx = evt.clientX - dragState.startClientX;
    var dy = evt.clientY - dragState.startClientY;
    if (!dragState.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    if (!dragState.moved) {
      dragState.moved = true;
      root.classList.add('phf-ai-floating-dragging');
    }
    evt.preventDefault();
    var nextLeft = dragState.startLeft + dx;
    var nextTop = dragState.startTop + dy;
    var maxLeft = Math.max(0, window.innerWidth - dragState.width);
    var maxTop = Math.max(0, window.innerHeight - dragState.height);
    nextLeft = Math.min(Math.max(nextLeft, 0), maxLeft);
    nextTop = Math.min(Math.max(nextTop, 0), maxTop);
    root.style.left = nextLeft + 'px';
    root.style.right = 'auto';
    root.style.top = nextTop + 'px';
    root.style.bottom = 'auto';
  }

  function endDrag(evt){
    if (!dragState || (evt && evt.pointerId !== dragState.pointerId)) return;
    var moved = dragState.moved;
    root.classList.remove('phf-ai-floating-dragging');
    if (moved) {
      suppressNextClick = true;
      // Luoi an toan: neu vi ly do nao do trinh duyet KHONG phat sinh click
      // theo sau (edge case tuy thiet bi/trinh duyet), tu reset co sau 1
      // khoang ngan - tranh flag bi "ket" mai true khien lan tap that tiep
      // theo bi nuot nham.
      setTimeout(function(){ suppressNextClick = false; }, 400);
      var rect = root.getBoundingClientRect();
      var centerX = rect.left + rect.width / 2;
      var side = centerX < window.innerWidth / 2 ? 'left' : 'right';
      var pos = { side: side, top: clampTop(rect.top, rect.height) };
      applyPosition(pos);
      saveSavedPosition(pos);
    }
    try { if (evt) iconBtn.releasePointerCapture(dragState.pointerId); } catch (e) {}
    dragState = null;
  }

  function bindDragHandlers(){
    iconBtn.addEventListener('pointerdown', onPointerDown);
    iconBtn.addEventListener('pointermove', onPointerMove);
    iconBtn.addEventListener('pointerup', endDrag);
    iconBtn.addEventListener('pointercancel', endDrag);
    var resizeTimer = null;
    window.addEventListener('resize', function(){
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applyResponsivePosition, 120);
    });
    window.addEventListener('orientationchange', function(){ setTimeout(applyResponsivePosition, 120); });
  }

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
          '<span class="phf-ai-floating-panel-title"><strong>PHF AI</strong></span>' +
          '<button type="button" class="phf-ai-floating-history" data-ai-floating-history aria-label="Lịch sử hội thoại" title="Lịch sử hội thoại">🕘</button>' +
          '<button type="button" class="phf-ai-floating-close" data-ai-floating-close aria-label="Đóng PHF AI">✕</button>' +
        '</div>' +
        '<div class="phf-ai-floating-panel-body" data-ai-floating-body></div>' +
      '</div>';
    document.body.appendChild(root);

    iconBtn = root.querySelector('[data-ai-floating-toggle]');
    panel = root.querySelector('[data-ai-floating-panel]');
    var closeBtn = root.querySelector('[data-ai-floating-close]');
    var historyBtn = root.querySelector('[data-ai-floating-history]');

    iconBtn.addEventListener('click', function(evt){
      // Tap sau khi keo (mobile) -> khong mo panel, chi "tha" vi tri. Chi
      // suppress DUNG 1 lan click ngay sau do (flag tu reset trong endDrag).
      if (suppressNextClick) { suppressNextClick = false; evt.preventDefault(); return; }
      setOpen(!open);
    });
    closeBtn.addEventListener('click', function(){ setOpen(false); });
    historyBtn.addEventListener('click', function(){ if (controller) controller.toggleHistory(); });
    document.addEventListener('keydown', function(evt){
      if (evt.key === 'Escape' && open) setOpen(false);
    });

    bindDragHandlers();
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
    if (isAllowedRole()) {
      build();
      root.hidden = false;
      // Ap dung SAU khi bo hidden - luc nay getBoundingClientRect() moi tra
      // kich thuoc that (phan tu con hidden -> rect toan 0, clamp sai).
      applyResponsivePosition();
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
