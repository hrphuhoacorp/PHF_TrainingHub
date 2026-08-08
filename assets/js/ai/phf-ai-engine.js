(function(){
  'use strict';

  /* PHF AI - engine dung chung cho CA HAI mat UI: trang day /admin/ai-sandbox
     (phf-ai-sandbox.js) va floating assistant (phf-ai-floating.js). Cung 1
     endpoint /api/ai/chat, cung logic gui/nhan/render - khong co 2 ban cai
     dat AI rieng. Moi lan mount() tao 1 phien hoi thoai doc lap (rieng
     history trong bo nho, mat khi rong trang - dung thiet ke da chot). */

  var MAX_MESSAGE_CHARS = 4000;

  function escapeHtml(value){
    return String(value == null ? '' : value)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  // "Nhận định AI:"/"Gợi ý AI:" o dau cau tra loi -> gan tag rieng, tach
  // ro suy luan cua model khoi du kien tool tra ve (EVIDENCE STATUS GATE).
  var OPINION_PREFIXES = ['Nhận định AI:', 'Gợi ý AI:'];
  function renderMessageContent(text){
    var raw = String(text == null ? '' : text);
    for (var i = 0; i < OPINION_PREFIXES.length; i++) {
      var prefix = OPINION_PREFIXES[i];
      if (raw.indexOf(prefix) === 0) {
        var rest = raw.slice(prefix.length);
        return '<span class="phf-ai-opinion-tag">✦ ' + escapeHtml(prefix.slice(0, -1)) + '</span>' + escapeHtml(rest).replace(/\n/g,'<br>');
      }
    }
    return escapeHtml(raw).replace(/\n/g,'<br>');
  }
  function formatAsOf(value){
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    function p(n){ return String(n).padStart(2,'0'); }
    return p(d.getHours())+':'+p(d.getMinutes())+' '+p(d.getDate())+'/'+p(d.getMonth()+1)+'/'+d.getFullYear();
  }

  var ERROR_MESSAGES = {
    AI_NOT_CONFIGURED: 'Dịch vụ AI chưa được cấu hình trên máy chủ này.',
    AI_TIMEOUT: 'Dịch vụ AI phản hồi quá lâu. Vui lòng thử lại.',
    AI_RATE_LIMITED: 'Bạn đã gửi quá nhiều câu hỏi trong thời gian ngắn. Vui lòng thử lại sau ít phút.',
    AI_REQUEST_IN_PROGRESS: 'Câu hỏi trước vẫn đang được xử lý. Vui lòng đợi phản hồi.',
    AI_SERVICE_UNAVAILABLE: 'Không thể kết nối dịch vụ AI lúc này. Vui lòng thử lại sau.',
    AUTH_REQUIRED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    FORBIDDEN: 'Tài khoản của anh/chị không có quyền dùng PHF AI.'
  };
  function friendlyError(err){
    var code = err && err.code;
    return (code && ERROR_MESSAGES[code]) || (err && err.message) || 'Đã có lỗi xảy ra. Vui lòng thử lại.';
  }

  // ---- Structured result renderers (result.type -> HTML) ----

  function renderRankCard(row, columns){
    var hasRank = columns.some(function(c){ return c.key === 'rank'; });
    var trailingCol = null, i;
    for (i = columns.length - 1; i >= 0; i--) { if (columns[i].align === 'right') { trailingCol = columns[i]; break; } }
    var primaryCol = null;
    for (i = 0; i < columns.length; i++) {
      var c = columns[i];
      if (c.key !== 'rank' && (!trailingCol || c.key !== trailingCol.key)) { primaryCol = c; break; }
    }
    if (!primaryCol) primaryCol = columns[0];
    var metaCols = columns.filter(function(c){ return c.key !== 'rank' && c.key !== primaryCol.key && (!trailingCol || c.key !== trailingCol.key); });
    var metaText = metaCols.map(function(c){ return row[c.key]; }).filter(Boolean).join(' · ');
    return '<div class="phf-ai-rank-card">' +
      (hasRank ? '<div class="phf-ai-rank-badge">' + escapeHtml(row.rank) + '</div>' : '') +
      '<div class="phf-ai-rank-body">' +
        '<div class="phf-ai-rank-primary">' + escapeHtml(row[primaryCol.key]) + '</div>' +
        (metaText ? '<div class="phf-ai-rank-meta">' + escapeHtml(metaText) + '</div>' : '') +
      '</div>' +
      (trailingCol ? '<div class="phf-ai-rank-trailing">' + escapeHtml(row[trailingCol.key]) + '</div>' : '') +
    '</div>';
  }

  function renderRanking(result){
    var data = result.data || {};
    var columns = Array.isArray(data.columns) ? data.columns : [];
    var rows = Array.isArray(data.rows) ? data.rows : [];
    if (!rows.length) return '';
    var theadHtml = columns.map(function(c){ return '<th class="phf-ai-align-' + (c.align || 'left') + '">' + escapeHtml(c.label) + '</th>'; }).join('');
    var tbodyHtml = rows.map(function(row){
      return '<tr>' + columns.map(function(c){ return '<td class="phf-ai-align-' + (c.align || 'left') + '">' + escapeHtml(row[c.key]) + '</td>'; }).join('') + '</tr>';
    }).join('');
    var cardsHtml = rows.map(function(row){ return renderRankCard(row, columns); }).join('');
    return '<div class="phf-ai-rank-table-wrap phf-ai-only-desktop"><table class="phf-ai-rank-table"><thead><tr>' + theadHtml + '</tr></thead><tbody>' + tbodyHtml + '</tbody></table></div>' +
      '<div class="phf-ai-rank-list phf-ai-only-mobile">' + cardsHtml + '</div>';
  }

  function renderEmployeeProfile(result){
    var data = result.data || {};
    var fields = Array.isArray(data.fields) ? data.fields : [];
    return '<div class="phf-ai-profile">' +
      '<div class="phf-ai-profile-head"><div class="phf-ai-profile-name">' + escapeHtml(data.employeeName || result.title || '') + '</div>' +
        (data.employeeCode ? '<div class="phf-ai-profile-code">' + escapeHtml(data.employeeCode) + '</div>' : '') +
      '</div>' +
      '<div class="phf-ai-profile-fields">' + fields.map(function(f){
        return '<div class="phf-ai-profile-field"><span>' + escapeHtml(f.label) + '</span><b>' + escapeHtml(f.value) + '</b></div>';
      }).join('') + '</div>' +
    '</div>';
  }

  function renderAlertList(result){
    var data = result.data || {};
    var items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) return data.summary ? '<div class="phf-ai-alert-summary">' + escapeHtml(data.summary) + '</div>' : '';
    return (data.summary ? '<div class="phf-ai-alert-summary">' + escapeHtml(data.summary) + '</div>' : '') +
      '<div class="phf-ai-alert-list">' + items.map(function(item){
        return '<div class="phf-ai-alert-item">' +
          '<div class="phf-ai-alert-item-title">' + escapeHtml(item.title) + '</div>' +
          (item.detail ? '<div class="phf-ai-alert-item-detail">' + escapeHtml(item.detail) + '</div>' : '') +
          (item.meta ? '<div class="phf-ai-alert-item-meta">' + escapeHtml(item.meta) + '</div>' : '') +
        '</div>';
      }).join('') + '</div>';
  }

  function renderSummary(result){
    var data = result.data || {};
    var metrics = Array.isArray(data.metrics) ? data.metrics : [];
    var sections = Array.isArray(data.sections) ? data.sections : [];
    var metricsHtml = metrics.length ? '<div class="phf-ai-metric-row">' + metrics.map(function(m){
      return '<div class="phf-ai-metric-tile"><div class="phf-ai-metric-value">' + escapeHtml(m.value) + '</div><div class="phf-ai-metric-label">' + escapeHtml(m.label) + '</div></div>';
    }).join('') + '</div>' : '';
    var sectionsHtml = sections.map(function(sec){
      var items = Array.isArray(sec.items) ? sec.items : [];
      if (!items.length) return '';
      return '<div class="phf-ai-summary-section"><div class="phf-ai-summary-section-title">' + escapeHtml(sec.label) + '</div>' +
        items.map(function(it){ return '<div class="phf-ai-summary-row"><span>' + escapeHtml(it.label) + '</span><b>' + escapeHtml(it.value) + '</b></div>'; }).join('') +
      '</div>';
    }).join('');
    return metricsHtml + sectionsHtml;
  }

  var RENDERERS = {
    ranking: renderRanking,
    employee_profile: renderEmployeeProfile,
    alert_list: renderAlertList,
    summary: renderSummary
  };

  // EVIDENCE STATUS GATE - badge hien thi dung 3 trang thai backend gan san
  // (result.evidence.status). Khong dung % confidence gia tao.
  var EVIDENCE_BADGES = {
    VERIFIED: { icon: '✓', label: 'Dữ liệu PHF đã xác nhận', cls: 'verified' },
    INCOMPLETE: { icon: '△', label: 'Dữ liệu chưa đủ', cls: 'incomplete' },
    CONFLICTED: { icon: '!', label: 'Dữ liệu cần đối chiếu', cls: 'conflicted' }
  };
  function renderEvidenceBadge(evidence){
    if (!evidence || !EVIDENCE_BADGES[evidence.status]) return '';
    var b = EVIDENCE_BADGES[evidence.status];
    return '<span class="phf-ai-evidence-badge phf-ai-evidence-' + b.cls + '">' + b.icon + ' ' + escapeHtml(b.label) + '</span>';
  }

  function renderStructuredCard(result){
    if (!result || !result.type || !RENDERERS[result.type]) return '';
    var body = RENDERERS[result.type](result);
    if (!body) return '';
    var asOfText = formatAsOf(result.asOf);
    var evidence = result.evidence || null;
    return '<div class="phf-ai-card" data-phf-ai-card-type="' + escapeHtml(result.type) + '" data-phf-ai-evidence="' + escapeHtml(evidence ? evidence.status : '') + '">' +
      '<div class="phf-ai-card-head">' +
        (result.title ? '<div class="phf-ai-card-title">' + escapeHtml(result.title) + '</div>' : '') +
        renderEvidenceBadge(evidence) +
      '</div>' +
      body +
      (evidence && evidence.note ? '<div class="phf-ai-card-evidence-note">' + escapeHtml(evidence.note) + '</div>' : '') +
      (asOfText ? '<div class="phf-ai-card-foot">Dữ liệu lúc ' + escapeHtml(asOfText) + '</div>' : '') +
    '</div>';
  }

  // ---- Dieu huong thong minh (result.actions -> nut bam) ----
  // Backend (lib/ai-tool-registry.js#NAV_TARGETS) chi tra ve 1 "route-key"
  // trong whitelist co dinh, KHONG phai URL. O day tu resolve key -> path
  // that theo role hien tai, ROI doi chieu lai voi window.PHF_ROUTE_REGISTRY
  // that (assets/js/phf-url-router.js) - route khong ton tai hoac role
  // khong co quyen thi KHONG hien nut, khong bao gio goi phfNavigate voi
  // path chua kiem tra. Doi 5 khoa nay phai doi dong bo voi NAV_TARGETS.
  var NAV_MODULE_SEGMENT = { hub_home: '', training_hub: 'home', classroom: 'classroom', checklist: 'checklist', knl: 'knl' };
  function resolveNavTarget(target){
    if (!Object.prototype.hasOwnProperty.call(NAV_MODULE_SEGMENT, target)) return null;
    var seg = NAV_MODULE_SEGMENT[target];
    var role = '';
    try { role = String((window.phfGetSessionRole && window.phfGetSessionRole()) || '').toLowerCase(); } catch (e) {}
    var prefix = role === 'admin' ? '/admin' : (role === 'manager' ? '/ql' : '/hv');
    var path = seg ? (prefix + '/' + seg) : prefix;
    var registry = window.PHF_ROUTE_REGISTRY;
    var entry = registry && registry[path];
    if (!entry) return null;
    if (Array.isArray(entry.roles) && entry.roles.length && entry.roles.indexOf(role) === -1) return null;
    return path;
  }
  function renderActions(actions){
    if (!Array.isArray(actions) || !actions.length) return '';
    var buttons = actions.map(function(a){
      if (!a || a.type !== 'navigate') return '';
      var path = resolveNavTarget(a.target);
      if (!path) return '';
      return '<button type="button" class="phf-ai-action-btn" data-ai-nav="' + escapeHtml(path) + '">' + escapeHtml(a.label || 'Đi tới') + '</button>';
    }).filter(Boolean).join('');
    return buttons ? '<div class="phf-ai-actions">' + buttons + '</div>' : '';
  }

  // ---- Chat controller factory ----

  function mount(root, options){
    var opts = options || {};
    var history = []; // {role:'user'|'assistant', content, result?}
    var pending = false;

    root.innerHTML =
      '<div class="phf-ai-thread" data-ai-thread aria-live="polite"></div>' +
      '<div class="phf-ai-error" data-ai-error hidden></div>' +
      '<form class="phf-ai-form" data-ai-form>' +
        '<textarea class="phf-ai-input" data-ai-input rows="2" maxlength="' + MAX_MESSAGE_CHARS + '" placeholder="Nhập câu hỏi... (Enter để gửi, Shift+Enter để xuống dòng)"></textarea>' +
        '<div class="phf-ai-form-actions">' +
          '<button type="button" class="phf-ai-new" data-ai-new>Cuộc trò chuyện mới</button>' +
          '<button type="submit" class="phf-ai-send" data-ai-send>Gửi</button>' +
        '</div>' +
      '</form>';

    var thread = root.querySelector('[data-ai-thread]');
    var form = root.querySelector('[data-ai-form]');
    var input = root.querySelector('[data-ai-input]');
    var sendBtn = root.querySelector('[data-ai-send]');
    var errorBox = root.querySelector('[data-ai-error]');
    var newBtn = root.querySelector('[data-ai-new]');

    function scrollToBottom(){ thread.scrollTop = thread.scrollHeight; }

    function renderThread(){
      if (!history.length) {
        thread.innerHTML = '<div class="phf-ai-empty"><div class="phf-ai-empty-title">Tôi có thể hỗ trợ gì cho bạn hôm nay?</div><div class="phf-ai-empty-sub">Hỏi về nghiệp vụ, dữ liệu và các chức năng trong PHF HR.</div></div>';
        return;
      }
      var html = history.map(function(msg){
        var who = msg.role === 'user' ? 'Bạn' : 'PHF AI';
        var cls = msg.role === 'user' ? 'phf-ai-msg phf-ai-msg-user' : 'phf-ai-msg phf-ai-msg-assistant';
        var card = msg.role === 'assistant' && msg.result ? renderStructuredCard(msg.result) : '';
        var actions = msg.role === 'assistant' ? renderActions(msg.actions) : '';
        return '<div class="' + cls + '"><div class="phf-ai-msg-role">' + escapeHtml(who) + '</div>' +
          (card ? card : '') +
          '<div class="phf-ai-msg-body">' + renderMessageContent(msg.content) + '</div>' +
          actions + '</div>';
      }).join('');
      if (pending) {
        html += '<div class="phf-ai-msg phf-ai-msg-assistant phf-ai-msg-loading"><div class="phf-ai-msg-role">PHF AI</div><div class="phf-ai-msg-body"><span class="phf-ai-typing"><span></span><span></span><span></span></span></div></div>';
      }
      thread.innerHTML = html;
      scrollToBottom();
    }

    function setError(message){
      if (!message) { errorBox.hidden = true; errorBox.textContent = ''; return; }
      errorBox.hidden = false;
      errorBox.textContent = message;
    }

    function setPending(next){
      pending = next;
      sendBtn.disabled = pending;
      input.disabled = pending;
      renderThread();
    }

    function sendMessage(text){
      var trimmed = String(text || '').trim();
      if (!trimmed || pending) return;
      if (trimmed.length > MAX_MESSAGE_CHARS) { setError('Câu hỏi quá dài (tối đa ' + MAX_MESSAGE_CHARS + ' ký tự).'); return; }
      setError('');
      var nextHistory = history.concat([{ role: 'user', content: trimmed }]);
      history = nextHistory;
      input.value = '';
      setPending(true);
      fetch('/api/ai/chat', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ messages: nextHistory.map(function(m){ return { role: m.role, content: m.content }; }) })
      }).then(function(response){
        return response.json().catch(function(){ return {}; }).then(function(json){ return { response: response, json: json }; });
      }).then(function(pair){
        var response = pair.response, json = pair.json;
        if (!response.ok || json.ok === false) {
          var err = new Error(json.error || 'Không thể kết nối dịch vụ AI.');
          err.code = json.code || '';
          throw err;
        }
        history = nextHistory.concat([{ role: 'assistant', content: String(json.reply || ''), result: json.result || null, actions: json.actions || null }]);
      }).catch(function(error){
        history = history.slice(0, -1);
        input.value = trimmed;
        setError(friendlyError(error));
      }).finally(function(){
        setPending(false);
      });
    }

    function newConversation(){
      if (pending) return;
      history = [];
      setError('');
      renderThread();
      input.value = '';
      input.focus();
    }

    form.addEventListener('submit', function(evt){ evt.preventDefault(); sendMessage(input.value); });
    input.addEventListener('keydown', function(evt){
      if (evt.key === 'Enter' && !evt.shiftKey) { evt.preventDefault(); sendMessage(input.value); }
    });
    newBtn.addEventListener('click', newConversation);
    thread.addEventListener('click', function(evt){
      var btn = evt.target && evt.target.closest ? evt.target.closest('[data-ai-nav]') : null;
      if (!btn) return;
      var path = btn.getAttribute('data-ai-nav');
      if (path && window.phfNavigate) window.phfNavigate(path);
    });

    renderThread();

    return {
      newConversation: newConversation,
      focus: function(){ try { input.focus(); } catch(e){} },
      isPending: function(){ return pending; }
    };
  }

  // Bieu tuong PHF AI dung chung cho ca 2 mat UI (trang day + floating).
  // assets/logo/phf-ai-mark-icon-v2.png = crop tight + can lai ty le
  // qua cam/chu "PHF AI" tu chinh phf-ai-mark-icon.png goc (Python PIL,
  // khong ve lai artwork). Chi sua 1 noi nay khi doi asset.
  var MARK_SVG = '<img src="assets/logo/phf-ai-mark-icon-v2.png?v=1.45.12_ai_mark_recompose" alt="PHF AI" draggable="false">';

  window.PHFAiEngine = {
    mount: mount,
    markSvg: MARK_SVG,
    // Expose de test truc tiep (khong can dung DOM day du) - xem test PATCH
    // Evidence Status Gate.
    renderStructuredCard: renderStructuredCard,
    renderEvidenceBadge: renderEvidenceBadge,
    renderMessageContent: renderMessageContent,
    evidenceBadges: EVIDENCE_BADGES
  };
})();
