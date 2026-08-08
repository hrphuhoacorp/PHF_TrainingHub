(function(){
  'use strict';

  var MAX_MESSAGE_CHARS = 4000;
  var history = []; // {role:'user'|'assistant', content:string} - chi trong bo nho phien, mat khi F5 (chap nhan o Sandbox v1)
  var pending = false;
  var root = null;

  function roleHome(){
    var r = 'learner';
    try { r = window.phfGetSessionRole ? window.phfGetSessionRole() : 'learner'; } catch (e) {}
    return r === 'admin' ? '/admin' : (r === 'manager' ? '/ql' : '/hv');
  }

  function escapeHtml(value){
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value){ return escapeHtml(value); }

  // AI tra loi dang text thuan, khong render markdown/HTML - chi escape + giu xuong dong.
  function renderMessageContent(text){
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function friendlyError(err){
    var code = err && err.code;
    var map = {
      AI_NOT_CONFIGURED: 'Dịch vụ AI chưa được cấu hình trên máy chủ này.',
      AI_TIMEOUT: 'Dịch vụ AI phản hồi quá lâu. Vui lòng thử lại.',
      AI_RATE_LIMITED: 'Bạn đã gửi quá nhiều câu hỏi trong thời gian ngắn. Vui lòng thử lại sau ít phút.',
      AI_REQUEST_IN_PROGRESS: 'Câu hỏi trước vẫn đang được xử lý. Vui lòng đợi phản hồi.',
      AI_SERVICE_UNAVAILABLE: 'Không thể kết nối dịch vụ AI lúc này. Vui lòng thử lại sau.',
      AUTH_REQUIRED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
      FORBIDDEN: 'Tài khoản của anh/chị không có quyền dùng AI Sandbox.'
    };
    return (code && map[code]) || (err && err.message) || 'Đã có lỗi xảy ra. Vui lòng thử lại.';
  }

  function els(){
    if (!root) return {};
    return {
      thread: root.querySelector('[data-ai-thread]'),
      form: root.querySelector('[data-ai-form]'),
      input: root.querySelector('[data-ai-input]'),
      sendBtn: root.querySelector('[data-ai-send]'),
      errorBox: root.querySelector('[data-ai-error]'),
      newBtn: root.querySelector('[data-ai-new]')
    };
  }

  function scrollToBottom(threadEl){
    if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
  }

  function renderThread(){
    var e = els();
    if (!e.thread) return;
    if (!history.length) {
      e.thread.innerHTML = '<div class="phf-ai-empty">Chưa có cuộc trò chuyện nào. Hãy đặt câu hỏi để thử nghiệm PHF AI.</div>';
      return;
    }
    var html = history.map(function(msg){
      var who = msg.role === 'user' ? 'Bạn' : 'PHF AI';
      var cls = msg.role === 'user' ? 'phf-ai-msg phf-ai-msg-user' : 'phf-ai-msg phf-ai-msg-assistant';
      return '<div class="' + cls + '"><div class="phf-ai-msg-role">' + escapeHtml(who) + '</div><div class="phf-ai-msg-body">' + renderMessageContent(msg.content) + '</div></div>';
    }).join('');
    if (pending) {
      html += '<div class="phf-ai-msg phf-ai-msg-assistant phf-ai-msg-loading"><div class="phf-ai-msg-role">PHF AI</div><div class="phf-ai-msg-body"><span class="phf-ai-typing"><span></span><span></span><span></span></span></div></div>';
    }
    e.thread.innerHTML = html;
    scrollToBottom(e.thread);
  }

  function setError(message){
    var e = els();
    if (!e.errorBox) return;
    if (!message) { e.errorBox.hidden = true; e.errorBox.textContent = ''; return; }
    e.errorBox.hidden = false;
    e.errorBox.textContent = message;
  }

  function setPending(next){
    pending = next;
    var e = els();
    if (e.sendBtn) e.sendBtn.disabled = pending;
    if (e.input) e.input.disabled = pending;
    renderThread();
  }

  async function sendMessage(text){
    var trimmed = String(text || '').trim();
    if (!trimmed || pending) return;
    if (trimmed.length > MAX_MESSAGE_CHARS) {
      setError('Câu hỏi quá dài (tối đa ' + MAX_MESSAGE_CHARS + ' ký tự).');
      return;
    }
    setError('');
    var nextHistory = history.concat([{ role: 'user', content: trimmed }]);
    history = nextHistory;
    var e = els();
    if (e.input) e.input.value = '';
    setPending(true);
    try {
      var response = await fetch('/api/ai/chat', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ messages: nextHistory })
      });
      var json = await response.json().catch(function(){ return {}; });
      if (!response.ok || json.ok === false) {
        var err = new Error(json.error || 'Không thể kết nối dịch vụ AI.');
        err.code = json.code || '';
        throw err;
      }
      history = nextHistory.concat([{ role: 'assistant', content: String(json.reply || '') }]);
    } catch (error) {
      history = history.slice(0, -1); // bo cau hoi vua gui vi chua co phan hoi thanh cong, tranh mat dong bo voi server
      if (e.input) e.input.value = trimmed;
      setError(friendlyError(error));
    } finally {
      setPending(false);
    }
  }

  function newConversation(){
    if (pending) return;
    history = [];
    setError('');
    renderThread();
    var e = els();
    if (e.input) { e.input.value = ''; e.input.focus(); }
  }

  function wireEvents(){
    var e = els();
    if (e.form) {
      e.form.addEventListener('submit', function(evt){
        evt.preventDefault();
        if (e.input) sendMessage(e.input.value);
      });
    }
    if (e.input) {
      e.input.addEventListener('keydown', function(evt){
        if (evt.key === 'Enter' && !evt.shiftKey) {
          evt.preventDefault();
          sendMessage(e.input.value);
        }
      });
    }
    if (e.newBtn) e.newBtn.addEventListener('click', newConversation);
  }

  window.phfRenderAiSandbox = function(path){
    if (window.PHFAppShell) window.PHFAppShell.activateAiSandbox(path);
    root = document.getElementById('phfAiSandboxRoot');
    if (!root) return false;
    root.innerHTML =
      '<main class="phf-ai-sandbox">' +
        '<header class="phf-ai-sandbox-header">' +
          '<button type="button" class="phf-ai-back" onclick="phfNavigate(\'' + escapeAttr(roleHome()) + '\')">← PHF HR</button>' +
          '<div class="phf-ai-sandbox-title"><strong>PHF AI</strong><span>AI thử nghiệm</span></div>' +
          '<span class="phf-ai-badge">DeepSeek • Thử nghiệm</span>' +
        '</header>' +
        '<div class="phf-ai-sandbox-body">' +
          '<div class="phf-ai-warning">AI có thể đưa ra thông tin chưa chính xác. Vui lòng kiểm tra trước khi sử dụng.</div>' +
          '<div class="phf-ai-thread" data-ai-thread aria-live="polite"></div>' +
          '<div class="phf-ai-error" data-ai-error hidden></div>' +
          '<form class="phf-ai-form" data-ai-form>' +
            '<textarea class="phf-ai-input" data-ai-input rows="2" maxlength="' + MAX_MESSAGE_CHARS + '" placeholder="Nhập câu hỏi... (Enter để gửi, Shift+Enter để xuống dòng)"></textarea>' +
            '<div class="phf-ai-form-actions">' +
              '<button type="button" class="phf-ai-new" data-ai-new>Cuộc trò chuyện mới</button>' +
              '<button type="submit" class="phf-ai-send" data-ai-send>Gửi</button>' +
            '</div>' +
          '</form>' +
        '</div>' +
      '</main>';
    document.title = 'PHF AI · Thử nghiệm';
    wireEvents();
    renderThread();
    return true;
  };
})();
