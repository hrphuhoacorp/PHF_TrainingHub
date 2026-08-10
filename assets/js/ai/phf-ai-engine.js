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

  /* MARKDOWN LITE (HOTFIX - Production hien thi nguyen ky tu markdown tho,
     vi du dau sao dam/gach dau dong/backtick) - DeepSeek
     tra Markdown pho thong (bold/bullet/so thu tu/inline code/doan van), UI
     truoc gio chi thay \n -> <br> nen ky tu markdown lot nguyen van ra man
     hinh. KHONG dung thu vien Markdown ngoai (tranh them dependency/bundle
     cho 1 file thuan JS khong build step) - chi 1 tap con toi thieu, ĐỦ cho
     van phong tra loi cua PHF AI.

     AN TOAN (BAT BUOC) - escapeHtml() chay TRUOC TIEN tren toan bo raw text,
     MOI transform markdown sau do chi thao tac tren chuoi DA escape (chi con
     lai markdown syntax thuan ASCII: * ` - so/dau cham, khong con < > & song)
     roi boc bang 1 whitelist the co dinh (<strong>/<code>/<ul><li>/<ol><li>/
     <p>/<br>), KHONG BAO GIO chen truc tiep noi dung chua escape vao HTML,
     KHONG dung thuoc tinh dong tu du lieu model - model KHONG THE inject
     HTML/script du dung cu phap markdown nao. */
  function escapeInlineMarkdown(escapedText){
    var html = escapedText.replace(/\*\*([^\n*]+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
    return html;
  }
  function renderMarkdownBlock(block){
    var lines = block.split('\n').filter(function(l){ return l.length > 0; });
    if (!lines.length) return '';
    var isUl = lines.every(function(l){ return /^[-*]\s+/.test(l); });
    if (isUl) {
      return '<ul>' + lines.map(function(l){ return '<li>' + escapeInlineMarkdown(l.replace(/^[-*]\s+/, '')) + '</li>'; }).join('') + '</ul>';
    }
    var isOl = lines.every(function(l){ return /^\d+[.)]\s+/.test(l); });
    if (isOl) {
      return '<ol>' + lines.map(function(l){ return '<li>' + escapeInlineMarkdown(l.replace(/^\d+[.)]\s+/, '')) + '</li>'; }).join('') + '</ol>';
    }
    return '<p>' + lines.map(escapeInlineMarkdown).join('<br>') + '</p>';
  }
  function renderMarkdownLite(text){
    var escaped = escapeHtml(text).replace(/\r\n/g, '\n');
    var blocks = escaped.split(/\n{2,}/).map(function(b){ return b.replace(/^\n+|\n+$/g, ''); }).filter(Boolean);
    if (!blocks.length) return '';
    return blocks.map(renderMarkdownBlock).join('');
  }

  // "Phân tích & đề xuất:" (nhan tu nhien, thay "Nhận định AI:"/"Gợi ý AI:"
  // cu) o dau cau tra loi -> gan tag rieng, tach ro suy luan cua model khoi
  // du kien tool tra ve (EVIDENCE STATUS GATE). Giu lai 2 nhan cu de cac
  // cuoc hoi thoai DA LUU truoc hotfix van hien thi dung tag, khong vo layout.
  var OPINION_PREFIXES = ['Phân tích & đề xuất:', 'Nhận định AI:', 'Gợi ý AI:'];
  function renderMessageContent(text){
    var raw = String(text == null ? '' : text);
    for (var i = 0; i < OPINION_PREFIXES.length; i++) {
      var prefix = OPINION_PREFIXES[i];
      if (raw.indexOf(prefix) === 0) {
        var rest = raw.slice(prefix.length);
        return '<span class="phf-ai-opinion-tag">✦ ' + escapeHtml(prefix.slice(0, -1)) + '</span>' + renderMarkdownLite(rest);
      }
    }
    return renderMarkdownLite(raw);
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

  // Lich su hoi thoai (Batch C) - format ngay/gio gon cho item danh sach,
  // khac formatAsOf (day du gio+ngay) dung cho card du lieu.
  function formatHistoryMeta(value){
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    function p(n){ return String(n).padStart(2,'0'); }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ' ' + p(d.getDate()) + '/' + p(d.getMonth()+1);
  }
  function groupConversationsByRecency(list){
    var todayStart = new Date(); todayStart.setHours(0,0,0,0);
    var todayStartMs = todayStart.getTime();
    var sevenDaysAgoMs = Date.now() - 7*24*60*60*1000;
    var groups = { today: [], week: [], older: [] };
    (list || []).forEach(function(c){
      var t = new Date(c.updatedAt).getTime();
      if (isNaN(t)) { groups.older.push(c); return; }
      if (t >= todayStartMs) groups.today.push(c);
      else if (t >= sevenDaysAgoMs) groups.week.push(c);
      else groups.older.push(c);
    });
    return groups;
  }

  function mount(root, options){
    var opts = options || {};
    var history = []; // {role:'user'|'assistant', content, result?, actions?}
    var pending = false;
    var conversationId = null;
    var historyOpen = false;
    var historyRawList = [];

    root.innerHTML =
      '<div class="phf-ai-chat-view" data-ai-chat-view>' +
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
      '<div class="phf-ai-history-view" data-ai-history-view hidden>' +
        '<div class="phf-ai-history-head">' +
          '<div class="phf-ai-history-title">Lịch sử hội thoại</div>' +
          '<button type="button" class="phf-ai-history-close" data-ai-history-close aria-label="Đóng lịch sử">✕</button>' +
        '</div>' +
        '<input type="search" class="phf-ai-history-search" data-ai-history-search placeholder="Tìm cuộc trò chuyện...">' +
        '<button type="button" class="phf-ai-history-new" data-ai-history-new>+ Cuộc trò chuyện mới</button>' +
        '<div class="phf-ai-history-list" data-ai-history-list></div>' +
      '</div>';

    var chatView = root.querySelector('[data-ai-chat-view]');
    var historyView = root.querySelector('[data-ai-history-view]');
    var thread = root.querySelector('[data-ai-thread]');
    var form = root.querySelector('[data-ai-form]');
    var input = root.querySelector('[data-ai-input]');
    var sendBtn = root.querySelector('[data-ai-send]');
    var errorBox = root.querySelector('[data-ai-error]');
    var newBtn = root.querySelector('[data-ai-new]');
    var historyCloseBtn = root.querySelector('[data-ai-history-close]');
    var historyNewBtn = root.querySelector('[data-ai-history-new]');
    var historySearch = root.querySelector('[data-ai-history-search]');
    var historyListEl = root.querySelector('[data-ai-history-list]');

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

    // ---- Lich su hoi thoai (Batch C) ----
    // Luu ben vung qua /api/ai/conversations - best-effort (khong chan luot
    // chat neu luu that bai, chi log am tham) vi day la tinh nang phu, KHONG
    // phai nguon du lieu chinh cua cuoc hoi thoai dang dien ra.
    //
    // keepalive:true (ROOT CAUSE fix, Batch C hardening) - persistTurn() goi
    // fetch nay KHONG await xong moi cho phep dieu huong (xem duoi), va app
    // dung full-page navigation (phf-url-router.js#navigate -> location.
    // assign/reload) cho moi lan chuyen man hinh, ke ca khi nguoi dung bam
    // ngay nut "Di toi..." AI vua goi y. Neu khong co keepalive, trinh duyet
    // huy request nay khi trang unload truoc khi Supabase kip nhan - luot
    // hoi thoai vua tra loi se KHONG duoc luu, nen lan sau mo lai tu Lich su
    // se thieu dung luot do (trieu chung: "AI khong nho" du UI lich su hoat
    // dong dung, vi ban ghi da luu that su thieu). keepalive gioi han payload
    // ~64KB o Chrome - payload o day chi 1-2 tin nhan da cap MAX_MESSAGE_CHARS
    // nen luon nam trong gioi han.
    function apiConversations(payload){
      return fetch('/api/ai/conversations', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', keepalive: true,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      }).then(function(response){
        return response.json().catch(function(){ return {}; });
      });
    }

    function persistTurn(userMsg, assistantMsg){
      var payloadMessages = [
        { role: 'user', content: userMsg.content },
        { role: 'assistant', content: assistantMsg.content, result: assistantMsg.result || null, actions: assistantMsg.actions || null }
      ];
      var action = conversationId ? 'append' : 'create';
      var body = conversationId ? { action: action, id: conversationId, messages: payloadMessages } : { action: action, messages: payloadMessages };
      apiConversations(body).then(function(json){
        if (json && json.ok !== false && json.id) conversationId = json.id;
      }).catch(function(){ /* best-effort - khong hien loi cho nguoi dung vi khong anh huong cau tra loi vua nhan */ });
    }

    function renderHistoryList(list){
      if (!list || !list.length) {
        historyListEl.innerHTML = '<div class="phf-ai-history-empty">Chưa có cuộc trò chuyện nào.</div>';
        return;
      }
      var groups = groupConversationsByRecency(list);
      var sections = [
        { label: 'Hôm nay', items: groups.today },
        { label: '7 ngày qua', items: groups.week },
        { label: 'Cũ hơn', items: groups.older }
      ].filter(function(s){ return s.items.length; });
      historyListEl.innerHTML = sections.map(function(s){
        return '<div class="phf-ai-history-group">' +
          '<div class="phf-ai-history-group-label">' + escapeHtml(s.label) + '</div>' +
          s.items.map(function(c){
            return '<div class="phf-ai-history-item" data-ai-history-open="' + escapeHtml(c.id) + '">' +
              '<div class="phf-ai-history-item-main">' +
                '<div class="phf-ai-history-item-title">' + escapeHtml(c.title || 'Cuộc trò chuyện mới') + '</div>' +
                '<div class="phf-ai-history-item-meta">' + (Number(c.messageCount) || 0) + ' tin nhắn · ' + escapeHtml(formatHistoryMeta(c.updatedAt)) + '</div>' +
              '</div>' +
              '<button type="button" class="phf-ai-history-item-delete" data-ai-history-delete="' + escapeHtml(c.id) + '" aria-label="Xóa cuộc trò chuyện" title="Xóa cuộc trò chuyện">🗑</button>' +
            '</div>';
          }).join('') +
        '</div>';
      }).join('');
    }

    function loadHistoryList(){
      historyListEl.innerHTML = '<div class="phf-ai-history-empty">Đang tải...</div>';
      apiConversations({ action: 'list' }).then(function(json){
        historyRawList = (json && json.ok !== false && Array.isArray(json.conversations)) ? json.conversations : [];
        renderHistoryList(historyRawList);
      }).catch(function(){
        historyListEl.innerHTML = '<div class="phf-ai-history-empty">Không thể tải lịch sử lúc này.</div>';
      });
    }

    function openHistory(){
      historyOpen = true;
      chatView.hidden = true;
      historyView.hidden = false;
      if (historySearch) historySearch.value = '';
      loadHistoryList();
    }
    function closeHistory(){
      historyOpen = false;
      chatView.hidden = false;
      historyView.hidden = true;
    }
    function toggleHistory(){ if (historyOpen) closeHistory(); else openHistory(); }

    function openConversation(id){
      if (pending || !id) return;
      setError('');
      apiConversations({ action: 'get', id: id }).then(function(json){
        if (!json || json.ok === false) { setError(friendlyError(new Error((json && json.error) || 'Không thể mở lại cuộc trò chuyện.'))); return; }
        conversationId = json.id;
        history = Array.isArray(json.messages) ? json.messages : [];
        closeHistory();
        renderThread();
      }).catch(function(){ setError('Không thể mở lại cuộc trò chuyện.'); });
    }

    function deleteConversationById(id){
      if (!id) return;
      apiConversations({ action: 'delete', id: id }).then(function(){
        if (conversationId === id) { conversationId = null; history = []; renderThread(); }
        loadHistoryList();
      }).catch(function(){ /* best-effort */ });
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
        var assistantMsg = { role: 'assistant', content: String(json.reply || ''), result: json.result || null, actions: json.actions || null };
        history = nextHistory.concat([assistantMsg]);
        persistTurn(nextHistory[nextHistory.length - 1], assistantMsg);
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
      conversationId = null;
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
    historyCloseBtn.addEventListener('click', closeHistory);
    historyNewBtn.addEventListener('click', function(){ newConversation(); closeHistory(); });
    historySearch.addEventListener('input', function(){
      var q = historySearch.value.trim().toLowerCase();
      var filtered = q ? historyRawList.filter(function(c){ return String(c.title || '').toLowerCase().indexOf(q) !== -1; }) : historyRawList;
      renderHistoryList(filtered);
    });
    historyListEl.addEventListener('click', function(evt){
      var delBtn = evt.target && evt.target.closest ? evt.target.closest('[data-ai-history-delete]') : null;
      if (delBtn) { evt.stopPropagation(); deleteConversationById(delBtn.getAttribute('data-ai-history-delete')); return; }
      var openBtn = evt.target && evt.target.closest ? evt.target.closest('[data-ai-history-open]') : null;
      if (openBtn) openConversation(openBtn.getAttribute('data-ai-history-open'));
    });

    renderThread();

    return {
      newConversation: newConversation,
      focus: function(){ try { input.focus(); } catch(e){} },
      isPending: function(){ return pending; },
      toggleHistory: toggleHistory
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
