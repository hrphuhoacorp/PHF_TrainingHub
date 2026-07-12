/* PHF Training Hub - Bản 28.1
   Module Nội dung đào tạo / thư viện bài học.
   Tách nguyên trạng từ index.html để index nhẹ hơn.
   Không đổi nghiệp vụ, dữ liệu học, login, tiến độ, quiz hoặc Supabase.
*/
(function phfBan15TrainingLibrary(){
  function esc(v){
    return String(v == null ? '' : v)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function readRole(){
    try{
      if(typeof window.phfGetSessionRole === 'function') return String(window.phfGetSessionRole() || '').toLowerCase();
      return String(localStorage.getItem('phfInternalTestRole') || '').toLowerCase();
    }catch(e){ return ''; }
  }
  function isAdmin(){
    var r = readRole();
    return r === 'admin' || r.indexOf('admin') >= 0 || r.indexOf('quản trị') >= 0 || r.indexOf('quan tri') >= 0;
  }
  function isManager(){
    var r = readRole();
    return isAdmin() || r.indexOf('trưởng') >= 0 || r.indexOf('truong') >= 0 || r.indexOf('manager') >= 0 || r.indexOf('quan ly') >= 0 || r.indexOf('quản lý') >= 0;
  }
  function roleLabel(){
    if(typeof window.phfRoleLabel === 'function'){
      try{ return window.phfRoleLabel(); }catch(e){}
    }
    return isAdmin() ? 'Admin' : (isManager() ? 'Trưởng ca / Quản lý' : 'Học viên');
  }
  function applyMenu(){
    var manager = isManager();
    var admin = isAdmin();
    document.body.classList.toggle('phf-role-manager', manager && !admin);
    document.body.classList.toggle('phf-role-admin', admin);
    document.querySelectorAll('[data-phf-main-nav="trainingLibrary"]').forEach(function(btn){
      btn.hidden = !manager;
      btn.style.setProperty('display', manager ? 'inline-flex' : 'none', 'important');
      btn.setAttribute('aria-hidden', manager ? 'false' : 'true');
      if(!manager) btn.classList.remove('active');
    });
  }
  function setShell(){
    try{ if(typeof window.phfHideIntroAndStopAuto === 'function') window.phfHideIntroAndStopAuto(); }catch(e){}
    try{ if(typeof window.phfEnsureSharedShell === 'function') window.phfEnsureSharedShell('trainingLibrary'); }catch(e){}
    var mini = document.getElementById('miniStatus');
    if(mini) mini.textContent = 'Nội dung đào tạo';
    var title = document.getElementById('contextTitle');
    if(title) title.textContent = 'Nội dung đào tạo';
    var sub = document.getElementById('contextSub');
    if(sub) sub.textContent = 'Xem chương trình, giai đoạn và bài học theo vị trí/phòng ban.';
    var action = document.getElementById('contextAction');
    if(action) action.textContent = 'Khu xem nội dung';
    try{
      if(typeof window.phfSetMainNavActive === 'function') window.phfSetMainNavActive('trainingLibrary');
      document.querySelectorAll('[data-phf-main-nav]').forEach(function(btn){
        btn.classList.toggle('active', btn.getAttribute('data-phf-main-nav') === 'trainingLibrary');
      });
    }catch(e){}
  }
  function getLessons(){
    var list = [];
    try{
      if(Array.isArray(window.LESSONS)) list = window.LESSONS;
      else if(typeof LESSONS !== 'undefined' && Array.isArray(LESSONS)) list = LESSONS;
    }catch(e){}
    return list || [];
  }
  function groupByStage(list){
    var map = {};
    list.forEach(function(item, idx){
      var s = Number(item.stage || 0);
      if(!map[s]) map[s] = [];
      map[s].push(Object.assign({__idx: idx}, item));
    });
    return map;
  }
  function stageName(stage){
    var names = ['GĐ1 · Hội nhập','GĐ2 · CSKH & Kỹ năng','GĐ3 · Quy trình','GĐ4 · Thực hành','GĐ5 · Đánh giá'];
    return names[Number(stage)] || ('Giai đoạn ' + (Number(stage)+1));
  }
  function shortText(v, n){
    v = String(v || '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    if(!v) return 'Nội dung bài học trong lộ trình đào tạo.';
    return v.length > n ? v.slice(0,n-1) + '…' : v;
  }
  var currentStage = 0;

  window.phfRenderTrainingLibrary = function phfRenderTrainingLibrary(stage){
    applyMenu();
    if(!isManager()){
      alert('Khu vực Nội dung đào tạo dành cho Trưởng ca/Admin.');
      if(typeof window.phfRenderPostLoginHome === 'function') return window.phfRenderPostLoginHome();
      return;
    }
    if(stage != null) currentStage = Number(stage) || 0;
    setShell();
    var main = document.getElementById('mainLesson');
    if(!main) return;

    var lessons = getLessons();
    var grouped = groupByStage(lessons);
    var stages = [0,1,2,3,4].filter(function(s){ return grouped[s] && grouped[s].length; });
    if(!stages.length) stages = [0];
    if(stages.indexOf(currentStage) < 0) currentStage = stages[0];

    var stageButtons = stages.map(function(s){
      return '<button class="phf-lib-stage-btn '+(s===currentStage?'active':'')+'" type="button" onclick="phfRenderTrainingLibrary('+s+')">'+esc(stageName(s))+'<br><small>'+((grouped[s]||[]).length)+' bài học</small></button>';
    }).join('');

    var cards = (grouped[currentStage] || []).map(function(item){
      var remember = Array.isArray(item.remember) ? item.remember.join(' · ') : '';
      return '<article class="phf-lib-card" onclick="phfRenderTrainingLibraryLesson('+Number(item.__idx)+')">'
        + '<div class="phf-lib-meta"><span>'+esc(item.badge || stageName(item.stage || 0))+'</span><span>Xem nội dung</span></div>'
        + '<h4>'+esc(item.title || item.nav || 'Bài học')+'</h4>'
        + '<p>'+esc(shortText(item.lead || remember || item.sample || '', 130))+'</p>'
        + '</article>';
    }).join('') || '<div class="phf-lib-note">Chưa có bài học trong giai đoạn này.</div>';

    main.innerHTML = '<section class="phf-training-library">'
      + '<div class="phf-lib-hero"><div><span class="phf-lib-kicker">PHF Training Hub · Thư viện đào tạo</span><h2>Nội dung đào tạo</h2><p>Khu vực để Trưởng ca/Admin xem chương trình, lộ trình và bài học theo vị trí/phòng ban. Đây là nơi xem nội dung; phần tạo/sửa nội dung sẽ nằm trong Quản trị.</p></div><div class="phf-lib-role">'+esc(roleLabel())+'<small>Quyền xem nội dung</small></div></div>'
      + '<div class="phf-lib-layout"><aside class="phf-lib-side">'
      + '<div class="phf-lib-filter"><label>Chương trình</label><select disabled><option>Nhân viên bán hàng</option></select></div>'
      + '<div class="phf-lib-filter"><label>Phòng ban / vị trí</label><select disabled><option>Bán hàng · Nhân viên mới</option></select></div>'
      + '<div class="phf-lib-stage-list">'+stageButtons+'</div>'
      + '<div class="phf-lib-side-note">Nội dung đào tạo được trình bày theo chương trình, giai đoạn và bài học để Trưởng ca/Admin dễ theo dõi và hướng dẫn học viên.</div>'
      + '</aside><main class="phf-lib-main"><div class="phf-lib-main-head"><div><h3>'+esc(stageName(currentStage))+'</h3><p>Danh sách bài học trong giai đoạn đã chọn. Bấm từng bài để xem tóm tắt nội dung.</p></div><span class="phf-lib-badge">'+esc((grouped[currentStage]||[]).length)+' bài học</span></div><div class="phf-lib-lessons">'+cards+'</div></main></div>'
      + '<div class="phf-lib-note"><b>Thông tin:</b> Nội dung đào tạo được sắp xếp theo chương trình, giai đoạn và bài học để thuận tiện theo dõi.</div>'
      + '</section>';
    try{ window.scrollTo({top:0,left:0,behavior:'auto'}); }catch(e){}
  };

  window.phfRenderTrainingLibraryLesson = function phfRenderTrainingLibraryLesson(idx){
    applyMenu();
    if(!isManager()){
      alert('Khu vực Nội dung đào tạo dành cho Trưởng ca/Admin.');
      return;
    }
    setShell();
    var lessons = getLessons();
    var item = lessons[Number(idx)] || lessons[0] || {};
    var main = document.getElementById('mainLesson');
    if(!main) return;
    var remember = Array.isArray(item.remember) ? item.remember.slice(0,3).map(function(x){return '<span>'+esc(x)+'</span>';}).join('') : '<span>Nội dung chính được trình bày trong bài học.</span>';
    var today = Array.isArray(item.today) ? item.today.slice(0,3).join(' · ') : 'Xem mục tiêu và nội dung bài học.';
    main.innerHTML = '<section class="phf-training-library">'
      + '<div class="phf-lib-detail"><div class="phf-lib-meta"><span>'+esc(item.badge || stageName(item.stage || 0))+'</span><span>Chỉ xem</span></div><h3>'+esc(item.title || item.nav || 'Bài học')+'</h3><p>'+esc(item.lead || 'Nội dung bài học trong lộ trình đào tạo.')+'</p><div class="phf-lib-detail-grid">'
      + '<div class="phf-lib-info"><b>Mục tiêu / việc cần làm</b><span>'+esc(today)+'</span></div>'
      + '<div class="phf-lib-info"><b>Giai đoạn</b><span>'+esc(stageName(item.stage || 0))+'</span></div>'
      + '<div class="phf-lib-info"><b>Kiểm tra / đánh giá</b><span>Tùy cấu hình chương trình. Phần tạo/cấu hình nằm trong Quản trị.</span></div>'
      + '</div><div class="phf-lib-info"><b>3 điểm cần nhớ</b><div class="phf-lib-meta">'+remember+'</div></div>'
      + '<p>'+esc(item.sample || 'Trưởng ca/Admin có thể dùng khu này để xem trước nội dung học và hướng dẫn học viên khi cần.')+'</p>'
      + '<div class="phf-lib-actions"><button class="phf-lib-action" type="button" onclick="phfRenderTrainingLibrary('+(Number(item.stage)||0)+')">Quay lại danh sách</button><button class="phf-lib-action primary" type="button" onclick="phfGoLearning()">Mở giao diện học viên</button></div>'
      + '</div></section>';
    try{ window.scrollTo({top:0,left:0,behavior:'auto'}); }catch(e){}
  };

  var oldApplyInternal = window.phfApplyInternalRoleMenu;
  if(typeof oldApplyInternal === 'function'){
    window.phfApplyInternalRoleMenu = function(){
      var result = oldApplyInternal.apply(this, arguments);
      applyMenu();
      return result;
    };
  }
  var oldApplyTest = window.phfApplyTestLoginMenu;
  if(typeof oldApplyTest === 'function'){
    window.phfApplyTestLoginMenu = function(){
      var result = oldApplyTest.apply(this, arguments);
      applyMenu();
      return result;
    };
  }
  document.addEventListener('DOMContentLoaded', applyMenu);
  window.addEventListener('storage', applyMenu);
  document.addEventListener('click', function(){ setTimeout(applyMenu, 0); }, true);
  setTimeout(applyMenu, 0);
  setTimeout(applyMenu, 300);
  setInterval(applyMenu, 1600);
})();


(function(){
  var state = {program:'all', stage:'all', query:'', type:'all', sort:'index'};
  function esc(v){
    return String(v == null ? '' : v)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function strip(v){
    return String(v || '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  }
  function shortText(v,n){
    v = strip(v);
    if(!v) return 'Nội dung bài học trong lộ trình đào tạo.';
    return v.length > n ? v.slice(0,n-1) + '…' : v;
  }
  function readRole(){
    try{
      if(typeof window.phfGetSessionRole === 'function') return String(window.phfGetSessionRole() || '').toLowerCase();
      return String(localStorage.getItem('phfInternalTestRole') || '').toLowerCase();
    }catch(e){ return ''; }
  }
  function isAdmin(){
    var r = readRole();
    return r === 'admin' || r.indexOf('admin') >= 0 || r.indexOf('quản trị') >= 0 || r.indexOf('quan tri') >= 0;
  }
  function isManager(){
    var r = readRole();
    return isAdmin() || r.indexOf('trưởng') >= 0 || r.indexOf('truong') >= 0 || r.indexOf('manager') >= 0 || r.indexOf('quan ly') >= 0 || r.indexOf('quản lý') >= 0;
  }
  function roleLabel(){
    if(typeof window.phfRoleLabel === 'function'){
      try{return window.phfRoleLabel();}catch(e){}
    }
    return isAdmin() ? 'Admin' : (isManager() ? 'Trưởng ca / Quản lý' : 'Học viên');
  }
  function setShell(){
    try{ if(typeof window.phfHideIntroAndStopAuto === 'function') window.phfHideIntroAndStopAuto(); }catch(e){}
    try{ if(typeof window.phfEnsureSharedShell === 'function') window.phfEnsureSharedShell('trainingLibrary'); }catch(e){}
    var mini = document.getElementById('miniStatus');
    if(mini) mini.textContent = 'Nội dung đào tạo';
    var title = document.getElementById('contextTitle');
    if(title) title.textContent = 'Nội dung đào tạo';
    var sub = document.getElementById('contextSub');
    if(sub) sub.textContent = 'Tra cứu chương trình, giai đoạn và bài học theo dữ liệu đào tạo hiện hành.';
    var action = document.getElementById('contextAction');
    if(action) action.textContent = 'Thư viện nội dung';
    try{
      if(typeof window.phfSetMainNavActive === 'function') window.phfSetMainNavActive('trainingLibrary');
      document.querySelectorAll('[data-phf-main-nav]').forEach(function(btn){
        btn.classList.toggle('active', btn.getAttribute('data-phf-main-nav') === 'trainingLibrary');
      });
    }catch(e){}
  }
  function lessons(){
    var list = [];
    try{
      if(Array.isArray(window.PHF_LESSONS_NEW_SALES)) list = window.PHF_LESSONS_NEW_SALES;
      else if(Array.isArray(window.PHF_LESSONS)) list = window.PHF_LESSONS;
      else if(Array.isArray(window.LESSONS)) list = window.LESSONS;
      else if(typeof LESSONS !== 'undefined' && Array.isArray(LESSONS)) list = LESSONS;
    }catch(e){}
    return (list || []).map(function(x,i){ return Object.assign({__idx:i}, x || {}); });
  }
  function stageName(stage){
    var names = ['GĐ1 · Hội nhập','GĐ2 · CSKH & Kỹ năng','GĐ3 · Quy trình bán hàng','GĐ4 · Thực hành tại cửa hàng','GĐ5 · Đánh giá cuối kỳ'];
    if(stage === 'all') return 'Tất cả giai đoạn';
    return names[Number(stage)] || ('Giai đoạn ' + (Number(stage)+1));
  }
  function programId(item){
    return String((item && (item.programId || item.program_id || item.program)) || 'new_sales').trim() || 'new_sales';
  }
  function programLabel(id){
    var labels = {new_sales:'Nhân viên bán hàng',new_gift:'Nhân viên gói quà',new_warehouse:'Nhân viên kho',new_online:'Nhân viên Online',new_store_lead:'Trưởng ca / Quản lý cửa hàng'};
    return labels[String(id || '')] || String(id || 'Chương trình đào tạo').replace(/_/g,' ');
  }
  function programOptions(list){
    var seen = {};
    (list || []).forEach(function(item){ seen[programId(item)] = true; });
    var ids = Object.keys(seen).sort(function(a,b){ return programLabel(a).localeCompare(programLabel(b),'vi'); });
    var out = '<option value="all" '+(state.program==='all'?'selected':'')+'>Tất cả chương trình đào tạo</option>';
    out += ids.map(function(id){ return '<option value="'+esc(id)+'" '+(state.program===id?'selected':'')+'>'+esc(programLabel(id))+'</option>'; }).join('');
    return out;
  }
  function programScoped(list){
    if(state.program === 'all') return (list || []).slice();
    return (list || []).filter(function(item){ return programId(item) === state.program; });
  }
  function lessonType(item){
    var title = String((item.title||'')+' '+(item.nav||'')+' '+(item.badge||'')).toLowerCase();
    var body = String((item.body||'')+' '+(item.originalFull||'')).toLowerCase();
    if(title.indexOf('kiểm tra') >= 0 || body.indexOf('câu hỏi') >= 0 || body.indexOf('trắc nghiệm') >= 0) return 'Kiểm tra';
    if(title.indexOf('đánh giá') >= 0) return 'Đánh giá';
    if(title.indexOf('thực hành') >= 0 || body.indexOf('thực hành') >= 0) return 'Thực hành';
    return 'Bài học';
  }
  function grouped(list){
    var m = {};
    list.forEach(function(x){ var s = Number(x.stage||0); if(!m[s]) m[s]=[]; m[s].push(x); });
    return m;
  }
  function filtered(list){
    var q = String(state.query || '').trim().toLowerCase();
    var rows = list.filter(function(x){
      var okProgram = state.program === 'all' || programId(x) === state.program;
      var okStage = state.stage === 'all' || Number(x.stage||0) === Number(state.stage);
      var okType = state.type === 'all' || lessonType(x) === state.type;
      if(!okProgram || !okStage || !okType) return false;
      if(!q) return true;
      var hay = strip([x.title,x.nav,x.sub,x.lead,x.sample,(Array.isArray(x.today)?x.today.join(' '):x.today),(Array.isArray(x.remember)?x.remember.join(' '):x.remember),x.body,x.originalFull].join(' ')).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    if(state.sort === 'title') rows.sort(function(a,b){ return String(a.title||a.nav||'').localeCompare(String(b.title||b.nav||''),'vi'); });
    else rows.sort(function(a,b){ return Number(a.__idx)-Number(b.__idx); });
    return rows;
  }
  function chip(text, cls){
    return '<span class="phf-chip '+(cls||'')+'">'+esc(text)+'</span>';
  }
  function listItems(arr, fallback){
    arr = Array.isArray(arr) ? arr : (arr ? [arr] : []);
    arr = arr.map(strip).filter(Boolean).slice(0,5);
    if(!arr.length) arr = [fallback || 'Nội dung đang được trình bày trong bài học.'];
    return '<ul>'+arr.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul>';
  }
  function renderBody(item){
    var body = item.body || item.originalFull || '';
    if(!body) return '<p>Nội dung chi tiết được hiển thị trong giao diện học viên.</p>';
    var s = String(body).trim();
    var hasTag = /<\/?[a-z][\s\S]*>/i.test(s);
    if(hasTag) return s;
    return '<p>'+esc(s).replace(/\n{2,}/g,'</p><p>').replace(/\n/g,'<br>')+'</p>';
  }
  function typeOptions(list){
    var set = {'Bài học':1,'Thực hành':1,'Kiểm tra':1,'Đánh giá':1};
    return ['all'].concat(Object.keys(set)).map(function(t){
      var label = t === 'all' ? 'Tất cả loại nội dung' : t;
      return '<option value="'+esc(t)+'" '+(state.type===t?'selected':'')+'>'+esc(label)+'</option>';
    }).join('');
  }
  function stageButtons(all, filteredCount){
    var g = grouped(all);
    var stages = [0,1,2,3,4].filter(function(s){return g[s] && g[s].length;});
    var out = '<button class="phf-b23-stage '+(state.stage==='all'?'active':'')+'" type="button" onclick="phfB23SetTrainingStage(\'all\')"><strong>Tất cả giai đoạn</strong><span><em>'+all.length+' bài</em><em>'+filteredCount+' đang xem</em></span></button>';
    out += stages.map(function(s){
      var count = (g[s]||[]).length;
      return '<button class="phf-b23-stage '+(Number(state.stage)===s?'active':'')+'" type="button" onclick="phfB23SetTrainingStage('+s+')"><strong>'+esc(stageName(s))+'</strong><span><em>'+count+' bài</em><em>Xem giai đoạn</em></span></button>';
    }).join('');
    return out;
  }
  function cards(rows){
    if(!rows.length) return '<div class="phf-b23-empty">Không tìm thấy bài học phù hợp bộ lọc hiện tại.</div>';
    return rows.map(function(item){
      var typ = lessonType(item);
      var stage = Number(item.stage||0);
      var desc = item.lead || item.sub || (Array.isArray(item.remember) ? item.remember.join(' · ') : '') || item.sample || item.body;
      return '<article class="phf-b23-card" onclick="phfRenderTrainingLibraryLesson('+Number(item.__idx)+')">'
        + '<div class="phf-b23-chiprow">'+chip(programLabel(programId(item)),'blue')+chip(stageName(stage),'')+chip(typ, typ==='Kiểm tra'?'warn':(typ==='Đánh giá'?'pink':'muted'))+chip('Bài '+(Number(item.__idx)+1),'blue')+'</div>'
        + '<h4>'+esc(item.title || item.nav || 'Bài học')+'</h4>'
        + '<p>'+esc(shortText(desc,150))+'</p>'
        + '</article>';
    }).join('');
  }
  window.phfB23SetTrainingStage = function(v){
    state.stage = v === 'all' ? 'all' : Number(v)||0;
    window.phfRenderTrainingLibrary(state.stage);
  };
  window.phfB23ApplyTrainingFilters = function(){
    var p = document.getElementById('phfB23Program');
    var q = document.getElementById('phfB23Search');
    var t = document.getElementById('phfB23Type');
    var s = document.getElementById('phfB23Sort');
    state.program = p ? p.value : 'all';
    state.query = q ? q.value : '';
    state.type = t ? t.value : 'all';
    state.sort = s ? s.value : 'index';
    window.phfRenderTrainingLibrary(state.stage);
  };
  window.phfB23ClearTrainingFilters = function(){
    state.program = 'all';
    state.query = '';
    state.type = 'all';
    state.sort = 'index';
    window.phfRenderTrainingLibrary(state.stage);
  };
  window.phfRenderTrainingLibrary = function(stage){
    if(!isManager()){
      if(window.phfOfficialShowInfo) window.phfOfficialShowInfo('Nội dung đào tạo','Khu vực Nội dung đào tạo dành cho Trưởng ca/Admin.');
      else alert('Khu vực Nội dung đào tạo dành cho Trưởng ca/Admin.');
      if(typeof window.phfRenderPostLoginHome === 'function') return window.phfRenderPostLoginHome();
      return;
    }
    if(stage !== undefined && stage !== null) state.stage = stage === 'all' ? 'all' : Number(stage)||0;
    setShell();
    var main = document.getElementById('mainLesson');
    if(!main) return;
    var all = lessons();
    var programRows = programScoped(all);
    var availableStages = Object.keys(grouped(programRows)).map(Number);
    if(state.stage !== 'all' && availableStages.indexOf(Number(state.stage)) < 0) state.stage = 'all';
    var rows = filtered(all);
    var g = grouped(programRows);
    var stageCount = Object.keys(g).length;
    var checkCount = programRows.filter(function(x){return lessonType(x)==='Kiểm tra';}).length;
    var practiceCount = programRows.filter(function(x){return lessonType(x)==='Thực hành';}).length;
    main.innerHTML = '<section class="phf-training-library b23">'
      + '<div class="phf-lib-hero"><div><span class="phf-lib-kicker">PHF Training Hub · Thư viện đào tạo</span><h2>Nội dung đào tạo</h2><p>Tra cứu nội dung theo chương trình đào tạo, giai đoạn, bài học và loại nội dung. Khu này giúp Trưởng ca/Admin xem trước bài học để hướng dẫn học viên thống nhất hơn.</p></div><div class="phf-lib-role">'+esc(roleLabel())+'<small>Quyền xem nội dung</small></div></div>'
      + '<div class="phf-b23-stats"><div class="phf-b23-stat"><b>'+programRows.length+'</b><span>Tổng bài/màn học</span></div><div class="phf-b23-stat"><b>'+stageCount+'</b><span>Giai đoạn đào tạo</span></div><div class="phf-b23-stat"><b>'+checkCount+'</b><span>Nội dung kiểm tra</span></div><div class="phf-b23-stat"><b>'+rows.length+'</b><span>Đang hiển thị theo bộ lọc</span></div></div>'
      + '<div class="phf-b23-toolbar"><select id="phfB23Program" aria-label="Chương trình đào tạo" title="Chương trình đào tạo" onchange="phfB23ApplyTrainingFilters()">'+programOptions(all)+'</select><input id="phfB23Search" value="'+esc(state.query)+'" placeholder="Tìm bài học, kỹ năng, quy trình..." onkeydown="if(event.key===\'Enter\') phfB23ApplyTrainingFilters()"><select id="phfB23Type">'+typeOptions(programRows)+'</select><select id="phfB23Sort"><option value="index" '+(state.sort==='index'?'selected':'')+'>Sắp xếp theo lộ trình</option><option value="title" '+(state.sort==='title'?'selected':'')+'>Sắp xếp theo tên bài</option></select><button type="button" onclick="phfB23ApplyTrainingFilters()">Lọc</button><button type="button" onclick="phfB23ClearTrainingFilters()">Xóa lọc</button></div>'
      + '<div class="phf-b23-layout"><aside class="phf-b23-side">'+stageButtons(programRows,rows.length)+'</aside>'
      + '<main class="phf-b23-main"><section class="phf-b23-panel"><div class="phf-b23-panel-head"><div><h3>'+esc((state.program==='all'?'Tất cả chương trình':programLabel(state.program))+' · '+stageName(state.stage))+'</h3><p>Danh sách bài học phù hợp bộ lọc. Bấm vào từng bài để xem mục tiêu, điểm cần nhớ và nội dung chi tiết.</p></div>'+chip(rows.length+' bài','blue')+'</div><div class="phf-b23-lessons">'+cards(rows)+'</div></section></main></div>'
      + '</section>';
    try{ window.scrollTo({top:0,left:0,behavior:'auto'}); }catch(e){}
  };
  window.phfRenderTrainingLibraryLesson = function(idx){
    if(!isManager()){
      alert('Khu vực Nội dung đào tạo dành cho Trưởng ca/Admin.');
      return;
    }
    setShell();
    var all = lessons();
    var item = all[Number(idx)] || all[0] || {};
    var main = document.getElementById('mainLesson');
    if(!main) return;
    var stage = Number(item.stage||0);
    var typ = lessonType(item);
    var sameProgram = all.filter(function(x){ return programId(x) === programId(item); });
    var currentAt = sameProgram.findIndex(function(x){ return Number(x.__idx) === Number(idx); });
    var prev = currentAt > 0 ? sameProgram[currentAt-1] : null;
    var next = currentAt >= 0 && currentAt < sameProgram.length-1 ? sameProgram[currentAt+1] : null;
    main.innerHTML = '<section class="phf-training-library b23">'
      + '<div class="phf-b23-detail">'
      + '<div class="phf-b23-chiprow">'+chip(programLabel(programId(item)),'blue')+chip(stageName(stage),'')+chip(typ,typ==='Kiểm tra'?'warn':(typ==='Đánh giá'?'pink':'muted'))+chip('Bài '+(Number(idx)+1)+'/'+all.length,'blue')+'</div>'
      + '<h2>'+esc(item.title || item.nav || 'Bài học')+'</h2>'
      + '<p class="phf-b23-detail-lead">'+esc(item.lead || item.sub || 'Nội dung bài học trong lộ trình đào tạo.')+'</p>'
      + '<div class="phf-b23-grid"><div class="phf-b23-box"><b>Hôm nay cần hoàn thành</b>'+listItems(item.today,'Xem và nắm nội dung chính của bài học.')+'</div><div class="phf-b23-box"><b>Điểm cần nhớ</b>'+listItems(item.remember,'Nắm các điểm chính để áp dụng khi làm việc.')+'</div><div class="phf-b23-box"><b>Câu nói mẫu / tình huống</b>'+listItems(item.sample,'Trưởng ca có thể dùng để hướng dẫn học viên.')+'</div></div>'
      + '<div class="phf-b23-body">'+renderBody(item)+'</div>'
      + '<div class="phf-b23-actions"><button class="phf-b23-action" type="button" onclick="phfRenderTrainingLibrary('+stage+')">Quay lại giai đoạn</button>'
      + (prev?'<button class="phf-b23-action" type="button" onclick="phfRenderTrainingLibraryLesson('+Number(prev.__idx)+')">Bài trước</button>':'')
      + (next?'<button class="phf-b23-action" type="button" onclick="phfRenderTrainingLibraryLesson('+Number(next.__idx)+')">Bài sau</button>':'')
      + '<button class="phf-b23-action primary" type="button" onclick="phfGoLearning()">Mở giao diện học viên</button></div>'
      + '</div></section>';
    try{ window.scrollTo({top:0,left:0,behavior:'auto'}); }catch(e){}
  };
})();
