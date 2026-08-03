/* PHF Bản 1.0.0 - Khóa luồng học viên + ổn định resume/quiz theo học viên
   - Tách file riêng để không làm phình index.html
   - Không đổi Supabase/schema/server
   - Đi qua /api/data hiện có
   - Không để xem lại bài cũ làm lùi tiến độ đang học
   - Ưu tiên kết quả thi theo đúng học viên/SĐT, tránh lẫn localStorage khi dùng chung máy
*/
(function phfLearningGateB16(){
  'use strict';

  var PASS_SCORE = 80;
  var MAIN_TESTS = {
    62: { key:'step2-final', label:'Bài kiểm tra cuối Bước 2' },
    71: { key:'step3-final', label:'Bài kiểm tra Bước 3' },
    107:{ key:'step4-final', label:'Bài kiểm tra cuối Bước 4' }
  };
  var SHORT_TESTS = {
    22:'short-gd1-review',
    42:'short-day1-afternoon',
    47:'short-step2-part1',
    50:'short-step2-part2',
    54:'short-step2-part3',
    58:'short-step2-part4',
    86:'short-gift-quick'
  };

  function safe(fn, fallback){ try{ return fn(); }catch(e){ return fallback; } }
  function pad2(n){ return String(n).padStart(2,'0'); }
  function addDays(d, days){ var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate()+days); return x; }
  function addMonths(d, months){ var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setMonth(x.getMonth()+months); return x; }
  function parseDate(v){
    v = String(v || '').trim();
    var m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) return null;
    var d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function todayOnly(){ var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function formatDate(d){ return d ? pad2(d.getDate()) + '/' + pad2(d.getMonth()+1) + '/' + d.getFullYear() : ''; }
  function pageToLessonIndex(page){
    var m = String(page || '').match(/^lesson:(\d+)$/i);
    if(!m) return null;
    var n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }
  function higherLessonPage(a, b){
    var ai = pageToLessonIndex(a), bi = pageToLessonIndex(b);
    if(ai == null && bi == null) return a || b || '';
    if(ai == null) return b || a || '';
    if(bi == null) return a || b || '';
    return ai >= bi ? a : b;
  }
  function cleanPhone(v){ return String(v || '').replace(/\D+/g,''); }
  function notice(type, title, msg){
    if(typeof window.phfNotice === 'function') return window.phfNotice(type || 'warning', title || 'Chưa thể chuyển phần', msg || 'Vui lòng hoàn thành nội dung hiện tại trước.');
    alert((title || 'Chưa thể chuyển phần') + '\n' + (msg || 'Vui lòng hoàn thành nội dung hiện tại trước.'));
  }
  function getRole(){
    if(typeof window.phfUserRole === 'function') return String(window.phfUserRole() || 'learner').toLowerCase();
    return safe(function(){ return String(localStorage.getItem('phfInternalTestRole') || 'learner').toLowerCase(); }, 'learner');
  }
  function isAdminSimulation(){
    return getRole() === 'admin' && safe(function(){ return sessionStorage.getItem('phfAdminLearningSimulation') === 'active'; }, false);
  }
  function isLearner(){ return isAdminSimulation() || (getRole() !== 'admin' && getRole() !== 'manager'); }
  window.phfIsAdminLearningSimulation = isAdminSimulation;
  function normalizeStatus(v){
    return String(v || '').trim().toLowerCase().replace(/[\s-]+/g,'_');
  }
  function currentAuthUser(){
    try{ if(typeof window.phfGetCurrentUser === 'function') return window.phfGetCurrentUser() || {}; }catch(e){}
    try{ return JSON.parse(localStorage.getItem('phfCurrentUser') || 'null') || {}; }catch(e){ return {}; }
  }
  function learningAccountKey(){
    if(isAdminSimulation()){
      var simUser=currentAuthUser()||{};
      var simRaw=String(simUser.email||simUser.id||'admin').trim().toLowerCase().replace(/[^a-z0-9@._-]+/g,'_');
      return 'admin-simulation-' + (simRaw || 'admin');
    }
    var u = currentAuthUser() || {};
    var raw = u.employeeId || u.employee_id || u.id || u.email ||
      safe(function(){ return localStorage.getItem('phfEmployeeId') || localStorage.getItem('phfSimpleTestLoginEmail') || localStorage.getItem('phfLoginEmail') || ''; }, '');
    raw = String(raw || '').trim().toLowerCase();
    return raw ? raw.replace(/[^a-z0-9@._-]+/g,'_') : 'anonymous';
  }
  function learningStorageKey(base){ return String(base) + ':' + learningAccountKey(); }
  function getLearningStorage(base){
    return safe(function(){ var store=isAdminSimulation()?sessionStorage:localStorage; return store.getItem(learningStorageKey(base)); }, null);
  }
  function setLearningStorage(base, value){
    safe(function(){ var store=isAdminSimulation()?sessionStorage:localStorage; store.setItem(learningStorageKey(base), String(value)); });
  }
  function removeLearningStorage(base){ safe(function(){ var store=isAdminSimulation()?sessionStorage:localStorage; store.removeItem(learningStorageKey(base)); }); }
  window.phfLearningAccountKey = learningAccountKey;
  window.phfLearningStorageKey = learningStorageKey;
  window.phfResetLearningRuntimeForAccountSwitch = function(){
    try{ window.phfCurrentLessonIndex = 0; window.phfCurrentLessonKey = 'lesson:0'; }catch(e){}
    try{ if(typeof current !== 'undefined') current = 0; }catch(e){}
  };
  function hasActiveHubAssignment(){
    if(isAdminSimulation()) return true;
    if(!isLearner()) return true;
    var u = currentAuthUser();
    var p = getProfile();
    var status = normalizeStatus(
      u.hubAssignmentStatus || u.hub_assignment_status ||
      p.hubAssignmentStatus || p.hub_assignment_status
    );
    return status === 'active';
  }
  function ensureLearningAccess(showNotice){
    if(hasActiveHubAssignment()) return true;
    if(showNotice !== false){
      notice('warning','Chưa được phân công lộ trình học','Tài khoản của bạn hiện chưa có chương trình Training Hub ở trạng thái “Đang học”. Vui lòng liên hệ Quản lý hoặc Phòng Nhân sự.');
    }
    return false;
  }
  /* PHF Bản 1.1.0 - Bài chung PHF + chuyên môn theo phòng ban.
     Phòng ban chỉ đọc từ hồ sơ nhân sự thật (window.__phfLocalData.employees),
     không đọc profile tự khai — đúng nghiệp vụ đã chốt. */
  function trainingHrDataLoaded(){
    try{ return Array.isArray(window.__phfLocalData && window.__phfLocalData.employees); }catch(e){ return false; }
  }
  function learnerHrEmployeeRow(){
    try{
      var p = getProfile();
      var id = p && p.id ? String(p.id) : '';
      if(!id) return null;
      var rows = (window.__phfLocalData && Array.isArray(window.__phfLocalData.employees)) ? window.__phfLocalData.employees : [];
      return rows.find(function(e){ return String(e && e.id || '') === id; }) || null;
    }catch(e){ return null; }
  }
  function learnerHrDepartment(){
    if(isAdminSimulation()) return '';
    var row = learnerHrEmployeeRow();
    return row ? String(row.department || '').trim() : '';
  }
  function lessonAllowedForDepartment(lesson, dept){
    var list = lesson && Array.isArray(lesson.departments) ? lesson.departments : null;
    if(!list || !list.length) return true;
    if(list.indexOf('all') >= 0) return true;
    return !!dept && list.indexOf(dept) >= 0;
  }
  function departmentLessonBoundary(lessons){
    if(isAdminSimulation()) return lessons.length - 1;
    /* Hồ sơ nhân sự (window.__phfLocalData.employees) chưa tải xong (F5/mở link
       trực tiếp, hoặc luồng đăng nhập bằng SĐT chỉ chờ 180ms) thì KHÔNG được
       giới hạn nhầm - trả về không giới hạn ở bước này, các gate quiz/tiến độ
       khác vẫn áp dụng bình thường. Hàm này không cache: lần gọi kế tiếp (mọi
       thao tác điều hướng/resume sau đó) sẽ tự đọc lại dữ liệu mới nhất ngay
       khi __phfLocalData sẵn sàng, nên tự cập nhật đúng phòng ban mà không cần
       thêm cơ chế theo dõi riêng. */
    if(!trainingHrDataLoaded()) return lessons.length - 1;
    var dept = learnerHrDepartment();
    for(var i = lessons.length - 1; i >= 0; i--){
      if(lessonAllowedForDepartment(lessons[i], dept)) return i;
    }
    return 0;
  }
  function renderDepartmentPendingScreen(lessons, boundary){
    var main = document.getElementById('mainLesson');
    if(!main) return;
    var dept = learnerHrDepartment();
    var label = dept || 'của bạn';
    var backIdx = Math.max(0, boundary);
    main.innerHTML = '<section class="focus-head"><div class="chip">GĐ1 · Hội nhập</div><h2>Chương trình chuyên môn ' + esc(label) + ' đang được cập nhật</h2>'
      + '<p>Bạn đã hoàn thành Chương trình học chung PHF. Chương trình chuyên môn dành riêng cho bộ phận của bạn sẽ được bổ sung sau — vui lòng chờ thông báo tiếp theo từ Quản lý hoặc Phòng Nhân sự.</p></section>'
      + '<section class="focus-body"><div class="actions"><button class="btn btn-soft" type="button" onclick="(window.phfGo||window.go)(' + backIdx + ')">← Xem lại bài học chung</button></div></section>';
  }
  function showDepartmentPendingNotice(lessons, boundary){
    var dept = learnerHrDepartment();
    var label = dept || 'của bạn';
    notice('warning','Đã hoàn thành Chương trình học chung PHF','Chương trình chuyên môn ' + label + ' đang được cập nhật.');
    renderDepartmentPendingScreen(lessons, boundary);
  }
  function getLessons(){
    try{ if(typeof LESSONS !== 'undefined' && Array.isArray(LESSONS)) return LESSONS; }catch(e){}
    return [];
  }
  function getCurrentIndex(){
    var owner=learningAccountKey();
    try{
      if(window.__phfActiveLearningOwner===owner && typeof current !== 'undefined' && Number.isFinite(Number(current))) return Number(current);
    }catch(e){}
    var stored=getLearningStorage('phfCurrentLessonIndex');
    var scoped=(stored===null||stored==='')?0:Number(stored);
    if(!Number.isFinite(scoped)||scoped<0) scoped=0;
    window.__phfActiveLearningOwner=owner;
    return scoped;
  }
  function setCurrentIndex(i){
    window.__phfActiveLearningOwner=learningAccountKey();
    try{ if(typeof current !== 'undefined') current = i; }catch(e){}
    window.phfCurrentLessonIndex = i;
    window.phfCurrentLessonKey = 'lesson:' + i;
    safe(function(){ setLearningStorage('phfCurrentLessonIndex', String(i)); setLearningStorage('phfCurrentPage', 'lesson:' + i); });
  }
  function getProfile(){
    if(isAdminSimulation()){
      var u=currentAuthUser()||{};
      return {id:'SIM-ADMIN-'+String(u.id||u.email||'PHF').replace(/[^a-zA-Z0-9_-]/g,'_'),fullName:'Mô phỏng học viên',phone:'0900000000',position:'Nhân viên bán hàng',department:'Mô phỏng',branch:'Mô phỏng',studyStartDate:new Date().toISOString().slice(0,10),programId:'new_sales',hubAssignmentStatus:'active',_simulation:true};
    }
    var p = {};
    if(typeof window.phfCurrentEmployeeProfile === 'function') p = window.phfCurrentEmployeeProfile() || {};
    if((!p || !p.id) && typeof window.phfGetSavedProfile === 'function') p = window.phfGetSavedProfile() || {};
    if(!p || typeof p !== 'object') p = {};
    if(!p.id) p.id = safe(function(){ return localStorage.getItem('phfEmployeeId') || ''; }, '');
    if(!p.phone) p.phone = safe(function(){ return (JSON.parse(localStorage.getItem('phfEmployeeProfile') || '{}') || {}).phone || ''; }, '');
    return p;
  }
  function profileKey(){
    var p = getProfile();
    return p.id || ('phone:' + cleanPhone(p.phone || 'unknown'));
  }
  function data(){ return window.__phfLocalData || {}; }
  function getServerProgress(){
    var p = getProfile();
    var d = data();
    if(!d || !d.progress) return {};
    if(p.id && d.progress[p.id]) return d.progress[p.id] || {};
    return {};
  }
  function readJson(key, fallback){ return safe(function(){ var store=isAdminSimulation()?sessionStorage:localStorage; return JSON.parse(store.getItem(key) || JSON.stringify(fallback)); }, fallback); }
  function writeJson(key, value){ safe(function(){ var store=isAdminSimulation()?sessionStorage:localStorage; store.setItem(key, JSON.stringify(value)); }); }
  function getLocalCompletedSet(){
    var map = readJson('phfGateCompletedPagesByEmployee', {});
    var arr = map[profileKey()] || [];
    var set = new Set(Array.isArray(arr) ? arr : []);
    var server = getServerProgress();
    var serverPages = server.completedPages || server.completed_pages || [];
    if(Array.isArray(serverPages)) serverPages.forEach(function(x){ if(/^lesson:\d+$/.test(String(x))) set.add(String(x)); });
    return set;
  }
  function saveLocalCompletedSet(set){
    var map = readJson('phfGateCompletedPagesByEmployee', {});
    map[profileKey()] = Array.from(set).filter(function(x){ return /^lesson:\d+$/.test(String(x)); }).sort(function(a,b){ return Number(a.split(':')[1])-Number(b.split(':')[1]); });
    writeJson('phfGateCompletedPagesByEmployee', map);
  }
  function markCompleted(idx){
    idx = Number(idx);
    if(!Number.isFinite(idx) || idx < 0) return;
    var set = getLocalCompletedSet();
    set.add('lesson:' + idx);
    saveLocalCompletedSet(set);
  }

  /* PHF 1.0.9B: xác nhận nhẹ dùng chung, lưu trong progress.completedPages.
     Không tạo bảng mới và không dùng cơ chế này cho BMTT. */
  var ACK_PREFIX='ack~1~';
  var ACK_INFLIGHT={};
  function ackEncode(v){ return encodeURIComponent(String(v == null ? '' : v)); }
  function ackDecode(v){ try{return decodeURIComponent(String(v||''));}catch(e){return String(v||'');} }
  function buildAckToken(row){
    return [ACK_PREFIX + Number(row.lessonIndex), ackEncode(row.key), ackEncode(row.type||'understood'), ackEncode(row.version||'v1'), ackEncode(row.confirmedAt||new Date().toISOString())].join('~');
  }
  function parseAckToken(token){
    token=String(token||'');
    if(token.indexOf(ACK_PREFIX)!==0) return null;
    var parts=token.split('~');
    if(parts.length<7) return null;
    var idx=Number(parts[2]);
    if(!Number.isFinite(idx)) return null;
    return {token:token,lessonIndex:idx,key:ackDecode(parts[3]),type:ackDecode(parts[4]),version:ackDecode(parts[5]),confirmedAt:ackDecode(parts.slice(6).join('~'))};
  }
  function allProgressTokens(){
    var out=[];
    var server=getServerProgress();
    var pages=server.completedPages||server.completed_pages||[];
    if(Array.isArray(pages)) out=out.concat(pages.map(String));
    var local=readJson('phfAcknowledgementsByEmployee',{});
    var rows=local[profileKey()]||[];
    if(Array.isArray(rows)) out=out.concat(rows.map(String));
    return Array.from(new Set(out));
  }
  function ackRowsForLesson(idx){
    return allProgressTokens().map(parseAckToken).filter(function(row){return row&&row.lessonIndex===Number(idx);});
  }
  function lessonAlreadyCompleted(idx){ return getLocalCompletedSet().has('lesson:'+Number(idx)); }
  function slugifyAck(text){
    return String(text||'acknowledged').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,72)||'acknowledged';
  }
  function currentAckDefinitions(){
    var idx=getCurrentIndex();
    var root=document.getElementById('mainLesson');
    if(!root) return [];
    if(root.querySelector('#phfBmtPaper,.phf-bmtt-confirm')) return [];
    var checks=Array.from(root.querySelectorAll('.phf-required-check'));
    if(checks.length){
      return checks.map(function(input,order){
        var label=input.closest('label');
        var text=String(label?label.textContent:'Tôi đã hiểu').replace(/\s+/g,' ').replace(/\*/g,'').trim();
        return {lessonIndex:idx,key:slugifyAck(text)+'-'+(order+1),type:/đọc/i.test(text)?'read':'understood',version:'v1',label:text,input:input};
      });
    }
    var rootButton=root.querySelector('.actions .btn-primary[onclick*="phfTryNextFromLesson"]');
    if(rootButton){
      return [{lessonIndex:idx,key:'lesson-understood',type:'understood',version:'v1',label:'Tôi đã hiểu nội dung bài học',input:null,generic:true}];
    }
    return [];
  }
  function formatAckTime(value){
    if(!value) return '';
    try{return new Intl.DateTimeFormat('vi-VN',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(value));}catch(e){return String(value);}
  }
  function saveLocalAckTokens(tokens){
    var map=readJson('phfAcknowledgementsByEmployee',{});
    var current=Array.isArray(map[profileKey()])?map[profileKey()]:[];
    map[profileKey()]=Array.from(new Set(current.concat(tokens)));
    writeJson('phfAcknowledgementsByEmployee',map);
  }
  window.phfApplyAcknowledgementState=function phfApplyAcknowledgementStateV109(){
    var idx=getCurrentIndex();
    var root=document.getElementById('mainLesson');
    if(!root) return;
    root.querySelectorAll('.phf-acknowledgement-receipt').forEach(function(el){el.remove();});
    var defs=currentAckDefinitions();
    if(!defs.length) return;
    var rows=ackRowsForLesson(idx);
    var historical=lessonAlreadyCompleted(idx);
    var confirmed=rows.length>0||historical;
    if(!confirmed) return;
    defs.forEach(function(def){ if(def.input){def.input.checked=true;def.input.disabled=true;} });
    var latest=rows.slice().sort(function(a,b){return new Date(b.confirmedAt||0)-new Date(a.confirmedAt||0);})[0]||null;
    var box=document.createElement('div');
    box.className='phf-acknowledgement-receipt';
    var label=(latest&&latest.key==='lesson-understood')?'Bạn đã xác nhận đã hiểu nội dung bài học.':('Bạn đã hoàn thành xác nhận bắt buộc của bài này.');
    box.innerHTML='<div class="phf-ack-icon">✓</div><div><strong>Đã xác nhận</strong><p>'+label+(latest&&latest.confirmedAt?' Thời gian xác nhận: '+formatAckTime(latest.confirmedAt)+'.':'')+'</p></div>';
    var target=root.querySelector('.feedback-options')||root.querySelector('.actions')||root.querySelector('.focus-body');
    if(target) target.insertAdjacentElement('beforebegin',box);
  };
  window.phfSaveCurrentAcknowledgements=async function phfSaveCurrentAcknowledgementsV109(){
    var defs=currentAckDefinitions();
    if(!defs.length) return true;
    var idx=getCurrentIndex();
    var existing=ackRowsForLesson(idx);
    if(existing.length||lessonAlreadyCompleted(idx)) return true;
    var missing=defs.filter(function(def){return def.input&&!def.input.checked;});
    if(missing.length) return false;
    var profile=getProfile();
    if(!profile||!profile.id) throw new Error('Tài khoản chưa liên kết hồ sơ nhân viên.');
    var lockKey=String(profile.id)+'|lesson:'+idx;
    if(ACK_INFLIGHT[lockKey]) return ACK_INFLIGHT[lockKey];
    var now=new Date().toISOString();
    var tokens=defs.map(function(def){return buildAckToken({lessonIndex:idx,key:def.key,type:def.type,version:def.version,confirmedAt:now});});
    if(isAdminSimulation()){
      saveLocalAckTokens(tokens);markCompleted(idx);window.phfApplyAcknowledgementState();return true;
    }
    var completedPages=Array.from(getLocalCompletedSet()).filter(function(x){return /^lesson:\d+$/.test(String(x));});
    completedPages.push('lesson:'+idx);
    completedPages=completedPages.concat(tokens);
    ACK_INFLIGHT[lockKey]=fetch('/api/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'acknowledgement-confirmed',actorRole:'learner',employee:profile,currentPage:'lesson:'+idx,completedPages:completedPages})})
      .then(function(res){return res.json().catch(function(){return{};}).then(function(json){
        if(!res.ok||!(json&&json.ok)) throw new Error(json&&json.error?json.error:'Chưa thể lưu xác nhận.');
        var receipt=json.receipt||{};
        if(receipt.progressSaved!==true||receipt.nextPageAllowed!==true) throw new Error('Máy chủ chưa xác nhận tiến độ của bài học.');
        if(json.data) window.__phfLocalData=json.data;
        saveLocalAckTokens(tokens);
        markCompleted(idx);
        window.phfApplyAcknowledgementState();
        return true;
      });})
      .catch(function(err){ notice('error','Chưa lưu được xác nhận',err&&err.message?err.message:'Vui lòng thử lại.'); return false; })
      .finally(function(){delete ACK_INFLIGHT[lockKey];});
    return ACK_INFLIGHT[lockKey];
  };
  function completedHighestSequential(){
    var set = getLocalCompletedSet();
    var lessons = getLessons();
    // Không tự xem lesson:0 là đã hoàn thành. Learner mới chỉ được mở Bài 1;
    // sau khi chủ động tiếp tục, lesson:0 mới được ghi nhận và Bài 2 mới mở.
    var highest = -1;
    for(var i=0;i<lessons.length;i++){
      if(set.has('lesson:' + i)) highest = i;
      else break;
    }
    return highest;
  }
  function isMainTestIndex(idx){ return Object.prototype.hasOwnProperty.call(MAIN_TESTS, Number(idx)); }
  function mainKey(idx){ return MAIN_TESTS[Number(idx)] && MAIN_TESTS[Number(idx)].key; }
  function shortKey(idx){ return SHORT_TESTS[Number(idx)] || null; }
  function isShortQuizKey(key){ return Object.keys(SHORT_TESTS).some(function(idx){ return SHORT_TESTS[idx] === key; }); }
  function getScopedQuizResults(){
    var arr = [];
    var scoped = readJson('phfQuizResultsByEmployee', {});
    var pk = profileKey();
    var p = getProfile();
    var phoneKey = p.phone ? ('phone:' + cleanPhone(p.phone)) : '';
    [pk, p.id, phoneKey].filter(Boolean).forEach(function(k){
      var rows = scoped[k] || [];
      if(Array.isArray(rows)) rows.forEach(function(r){ arr.push(Object.assign({}, r, {page:r.page || r.key, _scope:k, _trustedLocal:true})); });
    });
    var shortMap = readJson('phfShortQuizDoneByEmployee', {});
    [pk, p.id, phoneKey].filter(Boolean).forEach(function(k){
      var done = shortMap[k] || {};
      Object.keys(done || {}).forEach(function(x){
        // Map này chỉ được ghi sau khi bài kiểm tra ngắn đạt đủ 100/100.
        // Gắn dấu xác thực riêng để không nhầm với bản ghi cũ chỉ có trạng thái "đã nộp".
        arr.push({page:x, key:x, status:'passed', score:100, passScore:100, savedAt:done[x], _scope:k, _trustedLocal:true, _verifiedShortCompletion:true});
      });
    });
    var d = data();
    if(Array.isArray(d.testResults)) arr = arr.concat(d.testResults.map(function(r){ return Object.assign({}, r, {_server:true}); }));
    return arr;
  }
  function rememberScopedQuizResult(key, stat, status, resultText){
    var p = getProfile();
    var pk = profileKey();
    var row = {
      page:key,
      key:key,
      employeeId:p.id || '',
      employeePhone:cleanPhone(p.phone || ''),
      score:(stat && Number.isFinite(Number(stat.score))) ? Number(stat.score) : null,
      passScore:isShortQuizKey(key) ? 100 : PASS_SCORE,
      status:status || ((stat && Number(stat.score) >= (isShortQuizKey(key) ? 100 : PASS_SCORE)) ? 'passed' : 'failed'),
      resultText:resultText || '',
      savedAt:new Date().toISOString()
    };
    var scoped = readJson('phfQuizResultsByEmployee', {});
    [pk, p.id, p.phone ? ('phone:' + cleanPhone(p.phone)) : ''].filter(Boolean).forEach(function(k){
      if(!Array.isArray(scoped[k])) scoped[k] = [];
      scoped[k].push(row);
      scoped[k] = scoped[k].slice(-80);
    });
    writeJson('phfQuizResultsByEmployee', scoped);
  }
  function matchingResults(key){
    var p = getProfile();
    var pid = String(p.id || '');
    var phone = cleanPhone(p.phone || '');
    return getScopedQuizResults().filter(function(r){
      var page = String(r.page || r.key || '');
      if(page !== key) return false;
      var rid = String(r.employeeId || r.employee_id || '');
      var rphone = cleanPhone(r.employeePhone || r.employee_phone || r.phone || '');
      if(r._server){ return Boolean(pid && rid && rid === pid); }
      // Local chỉ tin dữ liệu đã được scope theo học viên/SĐT. Không dùng phfQuizResults cũ không rõ chủ nhân.
      if(r._trustedLocal){
        return (!rid || !pid || rid === pid) && (!rphone || !phone || rphone === phone);
      }
      return false;
    });
  }
  function serverResults(key){
    var rows=matchingResults(key);
    return isAdminSimulation() ? rows : rows.filter(function(r){return r._server===true;});
  }
  function latestResult(key){
    var results = serverResults(key);
    results.sort(function(a,b){ return new Date(b.savedAt || b.saved_at || 0) - new Date(a.savedAt || a.saved_at || 0); });
    return results[0] || null;
  }
  function hasPassedMain(key){
    var r = latestResult(key);
    if(!r) return false;
    var passScore = Number(r.passScore || r.pass_score || PASS_SCORE);
    var score = Number(r.score);
    var status = String(r.status || '').toLowerCase();
    return status === 'passed' || status === 'pass' || (Number.isFinite(score) && score >= passScore);
  }
  function isShortSubmitted(key){
    return serverResults(key).some(function(r){
      var score=Number(r.score),status=String(r.status||'').toLowerCase();
      return /^(passed|pass|completed|done)$/.test(status) && Number.isFinite(score) && score>=100;
    });
  }
  function computeMaxAllowed(){
    var lessons = getLessons();
    if(!lessons.length) return 0;
    var highest = completedHighestSequential();
    var allowed = Math.max(0, Math.min(lessons.length - 1, highest + 1));

    Object.keys(SHORT_TESTS).map(Number).sort(function(a,b){return a-b;}).forEach(function(idx){
      if(allowed > idx && !isShortSubmitted(SHORT_TESTS[idx])) allowed = idx;
    });
    Object.keys(MAIN_TESTS).map(Number).sort(function(a,b){return a-b;}).forEach(function(idx){
      if(allowed > idx && !hasPassedMain(MAIN_TESTS[idx].key)) allowed = idx;
    });
    allowed = Math.min(allowed, departmentLessonBoundary(lessons));
    return Math.max(0, Math.min(allowed, lessons.length - 1));
  }
  function studyStartValue(){
    var p = getProfile();
    return (typeof window.phfGetStudyStartValue === 'function' ? window.phfGetStudyStartValue() : '') || p.studyStartDate || safe(function(){ return localStorage.getItem('phfStudyStartDate') || ''; }, '');
  }

  /* Timeline chính thức: GĐ1 1 ngày, GĐ2 5 ngày, GĐ3 10 ngày, GĐ5 4 tuần cuối, GĐ4 là phần còn lại. */
  var oldBuildTimeline = window.phfBuildTimeline;
  window.phfBuildTimeline = function phfBuildTimelineB16(){
    var start = parseDate(studyStartValue());
    if(!start) return null;
    var endExclusive = addMonths(start, 2);
    var end = addDays(endExclusive, -1);
    var g1Start = start, g1End = start;
    var g2Start = addDays(start, 1), g2End = addDays(start, 5);
    var g3Start = addDays(start, 6), g3End = addDays(start, 15);
    var g5Start = addDays(end, -27), g5End = end;
    var g4Start = addDays(g3End, 1), g4End = addDays(g5Start, -1);
    if(g4End.getTime() < g4Start.getTime()) g4End = g4Start;
    var ranges = [
      {start:g1Start,end:g1End,note:'1 ngày'},
      {start:g2Start,end:g2End,note:'5 ngày'},
      {start:g3Start,end:g3End,note:'10 ngày'},
      {start:g4Start,end:g4End,note:'Thực hành'},
      {start:g5Start,end:g5End,note:'4 tuần cuối'}
    ];
    var t = todayOnly().getTime();
    var currentStage = 0;
    ranges.forEach(function(r,i){ if(t >= r.start.getTime() && t <= r.end.getTime()) currentStage = i; if(t > r.end.getTime()) currentStage = i; });
    if(t < ranges[0].start.getTime()) currentStage = 0;
    return {start:start,end:end,ranges:ranges,currentStage:currentStage};
  };

  window.phfGateInfo = function phfGateInfoB16(l){
    if(!l || !isLearner()) return null;
    var title = String((l.title || '') + ' ' + (l.nav || '') + ' ' + (l.sub || '')).toLowerCase();
    var timeline = window.phfBuildTimeline ? window.phfBuildTimeline() : (oldBuildTimeline ? oldBuildTimeline() : null);
    var type = '', openDate = null;
    if(l.stage === 1 && /bài kiểm tra cuối bước 2|bài kiểm tra tổng hợp|20 câu/.test(title)){
      type = 'Bài kiểm tra cuối Bước 2';
      openDate = timeline ? addDays(timeline.ranges[1].end, -1) : null;
    } else if(l.stage === 2 && /kiểm tra.*bước 3|bài kiểm tra.*bước 3/.test(title)){
      type = 'Bài kiểm tra Bước 3';
      openDate = timeline ? addDays(timeline.ranges[2].end, -1) : null;
    } else if(l.stage === 3 && /kiểm tra cuối bước 4|bài kiểm tra cuối bước 4/.test(title)){
      type = 'Bài kiểm tra cuối Bước 4';
      openDate = timeline ? addDays(timeline.ranges[3].end, -1) : null;
    } else if(l.stage === 4){
      type = 'GĐ5 · Đánh giá và hồ sơ';
      openDate = timeline ? timeline.ranges[4].start : null;
    }
    if(!type) return null;
    if(!timeline || !openDate) return {type:type, reason:'missing-start', openDate:null};
    if(todayOnly().getTime() < openDate.getTime()) return {type:type, reason:'too-early', openDate:openDate};
    return null;
  };

  function mainTestOpen(idx){
    var lessons = getLessons();
    var l = lessons[Number(idx)];
    if(!l || !window.phfGateInfo) return {ok:true};
    var gate = window.phfGateInfo(l);
    if(gate) return {ok:false, gate:gate};
    return {ok:true};
  }
  function validateShortQuiz(idx){
    var key = shortKey(idx);
    if(!key) return true;
    if(isShortSubmitted(key)) return true;
    notice('warning','Chưa hoàn thành bài kiểm tra ngắn','Vui lòng trả lời đủ và sửa đúng toàn bộ câu chưa đúng trước khi chuyển sang bài tiếp theo. Thông tin người làm bài được hệ thống tự nhận diện từ hồ sơ.');
    var btn=document.querySelector('#mainLesson .phf-grade-short');
    if(btn) try{btn.scrollIntoView({behavior:'smooth',block:'center'})}catch(e){}
    return false;
  }
  function markShortSubmitted(key,stat,meta){
    stat=stat||{score:100,correct:null,total:null};meta=meta||{};
    var map = readJson('phfShortQuizDoneByEmployee', {});
    if(!map[profileKey()]) map[profileKey()] = {};
    map[profileKey()][key] = new Date().toISOString();
    writeJson('phfShortQuizDoneByEmployee', map);
    var text='Hoàn thành bài kiểm tra ngắn 100/100.'+(meta.fullName?' Người thực hiện: '+meta.fullName+'.':'')+(meta.date?' Ngày: '+meta.date+'.':'');
    rememberScopedQuizResult(key, stat, 'passed', text);
    saveTestResult(key, stat, 'passed', text);
    var idx=getCurrentIndex(); if(shortKey(idx)===key) markAndSaveCompletion(idx,'short-quiz-pass');
  }
  window.phfMarkShortQuizCompleted=markShortSubmitted;
  function canCompleteCurrent(){
    var idx = getCurrentIndex();
    if(idx === 1){
      if(typeof window.phfValidateInfoForm === 'function' && !window.phfValidateInfoForm()) return false;
      if(typeof window.phfHasServerConfirmedInfo === 'function' && !window.phfHasServerConfirmedInfo()){
        notice('warning','Thông tin chưa được ghi nhận','Vui lòng bấm “Xác nhận thông tin và vào Bước 1” và chờ hệ thống lưu thành công trước khi tiếp tục.');
        return false;
      }
    }
    if(typeof window.phfValidateMorningCommitment === 'function' && !window.phfValidateMorningCommitment()) return false;
    if(typeof window.phfValidateRequiredLessonChecks === 'function' && !window.phfValidateRequiredLessonChecks()) return false;
    if(typeof window.phfValidateLessonSignatureConfirm === 'function' && !window.phfValidateLessonSignatureConfirm()) return false;
    var bmttPaper=document.getElementById('phfBmtPaper');
    if(bmttPaper){
      if(typeof window.phfHasSavedBMTTSignature !== 'function' || !window.phfHasSavedBMTTSignature()){
        if(typeof window.phfValidateConfidentialityCommitment === 'function') window.phfValidateConfidentialityCommitment(false);
        notice('warning','BMTT chưa được lưu hợp lệ','Vui lòng bấm “Ký xác nhận” và chờ hệ thống báo đã lưu thành công vào hồ sơ trước khi tiếp tục.');
        return false;
      }
    } else if(typeof window.phfValidateConfidentialityCommitment === 'function' && !window.phfValidateConfidentialityCommitment(false)) return false;

    if(isMainTestIndex(idx)){
      var opened = mainTestOpen(idx);
      if(!opened.ok){
        notice('warning','Chưa đến thời gian mở bài thi chính','Bài thi chính chỉ mở trong cửa sổ 2 ngày cuối của giai đoạn. Thời điểm mở dự kiến: ' + (opened.gate && opened.gate.openDate ? formatDate(opened.gate.openDate) : 'sau khi nhập ngày bắt đầu học') + '.');
        return false;
      }
      var key = mainKey(idx);
      if(!hasPassedMain(key)){
        notice('warning','Chưa đạt bài kiểm tra chính','Vui lòng làm bài kiểm tra chính và đạt từ ' + PASS_SCORE + '/100 điểm trước khi qua nội dung tiếp theo.');
        return false;
      }
    }
    if(!validateShortQuiz(idx)) return false;
    return true;
  }
  var TEST_SUBMISSION_INFLIGHT={};
  function saveTestResult(key, stat, status, resultText){
    var profile = getProfile();
    if(!profile || !profile.id) return;
    var lockKey=String(profile.id||'')+'|'+String(key||'');
    if(TEST_SUBMISSION_INFLIGHT[lockKey])return TEST_SUBMISSION_INFLIGHT[lockKey];
    var submissionId='test-'+String(profile.id||'unknown').replace(/[^a-zA-Z0-9_-]/g,'_')+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
    var payload = {
      type:'test',
      employee:profile,
      skipProgress:true,
      testResult:{
        submissionId:submissionId,
        page:key,
        employeeId:profile.id || '',
        employeePhone:cleanPhone(profile.phone || ''),
        score:(stat && Number.isFinite(Number(stat.score))) ? Number(stat.score) : null,
        passScore:isShortQuizKey(key) ? 100 : PASS_SCORE,
        status:status || ((stat && Number(stat.score) >= (isShortQuizKey(key) ? 100 : PASS_SCORE)) ? 'passed' : 'failed'),
        resultText: resultText || ''
      }
    };
    TEST_SUBMISSION_INFLIGHT[lockKey]=fetch('/api/data', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)})
      .then(function(res){ return res.json().catch(function(){ return {}; }); })
      .then(function(json){ if(json && json.data) window.__phfLocalData = json.data; return json; })
      .catch(function(){return null})
      .finally(function(){setTimeout(function(){delete TEST_SUBMISSION_INFLIGHT[lockKey]},1200)});
    return TEST_SUBMISSION_INFLIGHT[lockKey];
  }
  function markAndSaveCompletion(idx, reason){
    markCompleted(idx);
    return window.phfSaveProgressNow ? window.phfSaveProgressNow(reason || 'complete') : Promise.resolve(false);
  }

  var oldStoreQuiz = window.phfStoreQuizResult;
  window.phfStoreQuizResult = function phfStoreQuizResultB16(key, stat){
    if(typeof oldStoreQuiz === 'function') oldStoreQuiz.apply(this, arguments);
    var passed = stat && Number(stat.score) >= PASS_SCORE;
    rememberScopedQuizResult(key, stat || {}, passed ? 'passed' : 'failed', passed ? 'Đạt bài kiểm tra chính.' : 'Chưa đạt bài kiểm tra chính.');
    saveTestResult(key, stat || {}, passed ? 'passed' : 'failed', passed ? 'Đạt bài kiểm tra chính.' : 'Chưa đạt bài kiểm tra chính.');
    if(passed){
      var idx = getCurrentIndex();
      if(mainKey(idx) === key) markAndSaveCompletion(idx, 'test-pass');
    }
  };

  function bestExistingProgressPage(profile){
    var best = '';
    var d = data();
    var server = d && d.progress ? d.progress : {};
    var phoneKey = profile && profile.phone ? ('phone:' + cleanPhone(profile.phone)) : '';
    [profile && profile.id, phoneKey].filter(Boolean).forEach(function(k){
      var rec = server[k];
      if(rec) best = higherLessonPage(best, rec.currentPage || rec.current_page || '');
    });
    var map = readJson('phfProgressByEmployee', {});
    [profile && profile.id, phoneKey].filter(Boolean).forEach(function(k){
      var rec = map[k];
      if(rec) best = higherLessonPage(best, rec.currentPage || rec.current_page || '');
    });
    return best;
  }

  var oldSaveProgress = window.phfSaveProgressNow;
  window.phfSaveProgressNow = async function phfSaveProgressNowB16B(reason){
    try{
      var profile = getProfile();
      if(!profile || !profile.id){ return oldSaveProgress ? oldSaveProgress.apply(this, arguments) : false; }
      var idx = getCurrentIndex();
      if(isAdminSimulation()){
        var simCompleted=Array.from(getLocalCompletedSet()).filter(function(x){return /^lesson:\d+$/.test(String(x));});
        writeJson('phfAdminSimulationProgress',{currentPage:'lesson:'+idx,completedPages:simCompleted,lastUpdatedAt:new Date().toISOString(),reason:reason||'simulation'});
        setLearningStorage('phfCurrentPage','lesson:'+idx);
        setLearningStorage('phfCurrentLessonIndex',String(idx));
        return true;
      }
      var viewedPage = 'lesson:' + idx;
      var completedPages = Array.from(getLocalCompletedSet()).filter(function(x){ return /^lesson:\d+$/.test(String(x)); });
      completedPages = completedPages.concat(allProgressTokens().filter(function(x){ return String(x).indexOf(ACK_PREFIX)===0; }));
      completedPages = Array.from(new Set(completedPages));
      var existingPage = bestExistingProgressPage(profile);
      var shouldAdvance = /complete|test-pass|next|submit|autosave|phone-resume|login-resume/i.test(String(reason || ''));
      var currentPage = shouldAdvance ? higherLessonPage(existingPage, viewedPage) : (existingPage || viewedPage);
      // Khi học viên chỉ bấm xem lại bài cũ, không cho currentPage lùi. lastViewedPage vẫn giữ trong local để tham khảo.
      if(reason === 'navigation' || reason === 'review') currentPage = existingPage || viewedPage;
      var rec = {currentPage:currentPage, lastViewedPage:viewedPage, completedPages:completedPages, lastUpdatedAt:new Date().toISOString()};
      var map = readJson('phfProgressByEmployee', {});
      map[profile.id] = rec;
      if(profile.phone) map['phone:' + cleanPhone(profile.phone)] = rec;
      writeJson('phfProgressByEmployee', map);
      safe(function(){
        setLearningStorage('phfCurrentPage', currentPage || viewedPage);
        setLearningStorage('phfCurrentLessonIndex', String(pageToLessonIndex(currentPage) == null ? idx : pageToLessonIndex(currentPage)));
        localStorage.setItem('phfLastViewedPage', viewedPage);
      });
      var res = await fetch('/api/data', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({type:reason || 'autosave', employee:profile, currentPage:currentPage, completedPages:completedPages})});
      var json = await res.json().catch(function(){ return {}; });
      if(res.ok && json && (json.data || json.ok)) window.__phfLocalData = json.data || window.__phfLocalData;
      return true;
    }catch(err){
      console.warn('PHF B16B save progress error', err);
      return oldSaveProgress ? oldSaveProgress.apply(this, arguments) : false;
    }
  };

  function decorateLockedItems(){
    if(!isLearner()) return;
    var max = computeMaxAllowed();
    document.querySelectorAll('[onclick^="go("]').forEach(function(btn){
      var raw = btn.getAttribute('onclick') || '';
      var m = raw.match(/go\((\d+)\)/);
      if(!m) return;
      var idx = Number(m[1]);
      var locked = idx > max;
      btn.classList.toggle('phf-gate-locked', locked);
      btn.setAttribute('aria-disabled', locked ? 'true' : 'false');
      if(locked){
        btn.title = 'Vui lòng hoàn thành nội dung hiện tại trước khi mở phần này.';
      }else{
        btn.removeAttribute('title');
      }
    });
  }
  function injectStyle(){
    if(document.getElementById('phf-b16-learning-gate-style')) return;
    var s = document.createElement('style');
    s.id = 'phf-b16-learning-gate-style';
    s.textContent = '.phf-gate-locked{opacity:.48!important;filter:grayscale(.25);cursor:not-allowed!important}.phf-gate-locked .phase-state:after{content:" · Khóa"}.phf-gate-locked .mark{background:#eef2f0!important;color:#83938c!important}.phf-admin-simulation-banner{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 16px;padding:13px 16px;border:1px solid #9bc8b3;border-radius:12px;background:#eef9f3;color:#153f2c;box-shadow:0 6px 18px rgba(22,75,50,.08)}.phf-admin-simulation-banner div{display:grid;gap:3px}.phf-admin-simulation-banner strong{font-size:15px}.phf-admin-simulation-banner span{font-size:13px;color:#426553}.phf-admin-simulation-banner button{font:inherit;border:1px solid #247a4c;background:#fff;color:#17643d;border-radius:9px;padding:8px 12px;font-weight:700;cursor:pointer;white-space:nowrap}@media(max-width:700px){.phf-admin-simulation-banner{align-items:flex-start;flex-direction:column}.phf-admin-simulation-banner button{width:100%}}';
    document.head.appendChild(s);
  }

  var oldGo = window.go || window.phfGo;
  function guardedGo(i){
    var target = Number(i);
    var lessons = getLessons();
    if(!Number.isFinite(target) || target < 0 || target >= lessons.length) return;
    if(!isLearner()){
      if(typeof oldGo === 'function') return oldGo.call(this, target);
      setCurrentIndex(target); if(typeof window.render === 'function') window.render(); return;
    }
    var currentIdx = getCurrentIndex();
    var maxAllowed = computeMaxAllowed();

    if(!ensureLearningAccess(true)) return;

    /* Ranh giới phòng ban tách riêng khỏi ranh giới quiz/tiến độ: dù đã hoàn
       thành mọi bài/kiểm tra, không phòng ban nào được vượt qua ranh giới này
       trừ khi lesson đích có departments chứa 'all' hoặc đúng phòng ban. */
    var deptBoundary = departmentLessonBoundary(lessons);
    if(target > deptBoundary){
      showDepartmentPendingNotice(lessons, deptBoundary);
      decorateLockedItems();
      return;
    }

    /* Khóa tuyệt đối mọi đích vượt quá bài đang được phép mở.
       Chỉ nút Tiếp tục từ đúng bài hiện tại mới được phép hoàn tất gate rồi mở bài kế tiếp.
       Không dùng currentIdx làm lối tắt vì currentIdx có thể là dữ liệu cũ hoặc bị can thiệp. */
    if(target > maxAllowed){
      var isImmediateNext = target === currentIdx + 1 && currentIdx === maxAllowed;
      if(!isImmediateNext){
        notice('warning','Phần này chưa mở','Vui lòng hoàn thành nội dung hiện tại theo đúng thứ tự trước khi chuyển sang phần này.');
        decorateLockedItems();
        return;
      }
      if(!canCompleteCurrent()) return;
      markCompleted(currentIdx);
      maxAllowed = computeMaxAllowed();
      if(target > maxAllowed){
        notice('warning','Phần này chưa mở','Hệ thống chưa ghi nhận đủ điều kiện hoàn thành nội dung hiện tại. Vui lòng kiểm tra lại bài học hoặc bài kiểm tra bắt buộc.');
        decorateLockedItems();
        return;
      }
    }

    if(target === currentIdx + 1 && currentIdx === maxAllowed && !getLocalCompletedSet().has('lesson:' + currentIdx)){
      if(!canCompleteCurrent()) return;
      markCompleted(currentIdx);
    }
    if(typeof oldGo === 'function') oldGo.call(this, target);
    else { setCurrentIndex(target); if(typeof window.render === 'function') window.render(); }
    setTimeout(function(){
      if(target === currentIdx + 1) markAndSaveCompletion(currentIdx, 'complete');
      else if(target < currentIdx) window.phfSaveProgressNow && window.phfSaveProgressNow('review');
      else window.phfSaveProgressNow && window.phfSaveProgressNow('navigation');
      decorateLockedItems();
    }, 120);
  }
  window.go = guardedGo;
  window.phfGo = guardedGo;

  var oldNext = window.phfTryNextFromLesson;
  var phfNextLessonTransitionBusy = false;
  function phfNextLessonButton(){
    var active=document.activeElement;
    if(active&&active.matches&&active.matches('.actions .btn-primary[onclick*="phfTryNextFromLesson"]')) return active;
    var root=document.getElementById('mainLesson');
    return root?root.querySelector('.actions .btn-primary[onclick*="phfTryNextFromLesson"]'):null;
  }
  function phfAfterLessonMounted(){
    return new Promise(function(resolve){
      requestAnimationFrame(function(){requestAnimationFrame(resolve);});
    });
  }
  window.phfTryNextFromLesson = async function phfTryNextFromLessonB16(){
    var idx = getCurrentIndex();
    if(!isLearner()){
      if(typeof oldNext === 'function') return oldNext.apply(this, arguments);
      return guardedGo(idx + 1);
    }
    if(phfNextLessonTransitionBusy) return;
    if(!canCompleteCurrent()) return;

    var btn=phfNextLessonButton();
    var loadingToken=null;
    phfNextLessonTransitionBusy=true;
    try{
      if(typeof window.phfSetButtonLoading==='function') window.phfSetButtonLoading(btn,true,'Đang xử lý…');
      if(typeof window.phfLoadingShow==='function'){
        loadingToken=window.phfLoadingShow('save',{
          title:'Đang lưu xác nhận và mở bài tiếp theo',
          text:'Vui lòng chờ trong khi hệ thống ghi nhận tiến độ của bạn.'
        });
      }

      var defs=currentAckDefinitions();
      if(defs.length){
        var saved=await window.phfSaveCurrentAcknowledgements();
        if(!saved) return;
      }else{
        markCompleted(idx);
      }

      guardedGo(idx + 1);
      await phfAfterLessonMounted();
    }catch(err){
      notice('error','Chưa thể mở bài tiếp theo',err&&err.message?err.message:'Vui lòng thử lại.');
    }finally{
      if(loadingToken){
        if(typeof window.phfLoadingSettle==='function') window.phfLoadingSettle(loadingToken);
        else if(typeof window.phfLoadingHide==='function') window.phfLoadingHide(loadingToken);
      }
      if(btn&&btn.isConnected&&typeof window.phfSetButtonLoading==='function') window.phfSetButtonLoading(btn,false);
      phfNextLessonTransitionBusy=false;
    }
  };

  function renderAdminSimulationBanner(){
    var old=document.getElementById('phfAdminSimulationBanner');
    if(!isAdminSimulation()){ if(old) old.remove(); return; }
    var root=document.getElementById('mainLesson');
    if(!root) return;
    if(old) old.remove();
    var bar=document.createElement('div');
    bar.id='phfAdminSimulationBanner';
    bar.className='phf-admin-simulation-banner';
    bar.innerHTML='<div><strong>Chế độ mô phỏng học viên</strong><span>Đang dùng đúng giao diện, quiz và learning gate của học viên. Dữ liệu chỉ lưu tạm trong phiên này, không ghi Supabase.</span></div><button type="button" onclick="phfStopAdminLearningSimulation()">Thoát mô phỏng</button>';
    root.insertBefore(bar,root.firstChild);
  }

  var oldRender = window.render;
  if(typeof oldRender === 'function'){
    window.render = function renderB16(){
      if(isLearner()){
        var idx = getCurrentIndex();
        var max = computeMaxAllowed();
        if(idx > max){ setCurrentIndex(max); }
      }
      var result = oldRender.apply(this, arguments);
      setTimeout(function(){ decorateLockedItems(); renderAdminSimulationBanner(); }, 0);
      return result;
    };
  }

  var oldOpenLearner = window.phfOpenLearnerAfterPhone;
  if(typeof oldOpenLearner === 'function'){
    window.phfOpenLearnerAfterPhone = function phfOpenLearnerAfterPhoneB16(profile){
      var result = oldOpenLearner.apply(this, arguments);
      setTimeout(function(){
        if(isLearner()){
          var max = computeMaxAllowed();
          var idx = getCurrentIndex();
          if(idx > max){ setCurrentIndex(max); if(typeof window.render === 'function') window.render(); }
          decorateLockedItems();
        }
      }, 120);
      return result;
    };
  }

  window.phfStartAdminLearningSimulation = function phfStartAdminLearningSimulation(startIdx){
    if(getRole()!=='admin'){
      notice('warning','Chỉ dành cho Admin','Chế độ mô phỏng học viên chỉ dành cho tài khoản Admin.');
      return false;
    }
    try{
      sessionStorage.setItem('phfAdminLearningSimulation','active');
      ['phfGateCompletedPagesByEmployee','phfQuizResultsByEmployee','phfShortQuizDoneByEmployee','phfProgressByEmployee','phfAdminSimulationProgress'].forEach(function(k){sessionStorage.removeItem(k);});
    }catch(e){}
    startIdx=Number(startIdx);
    if(!Number.isFinite(startIdx)||startIdx<0) startIdx=0;
    var lessons=getLessons();
    if(lessons.length) startIdx=Math.min(startIdx,lessons.length-1);
    var set=getLocalCompletedSet();
    for(var i=0;i<startIdx;i++) set.add('lesson:'+i);
    saveLocalCompletedSet(set);
    Object.keys(SHORT_TESTS).forEach(function(raw){var idx=Number(raw);if(idx<startIdx) rememberScopedQuizResult(SHORT_TESTS[idx],{score:100},'passed','Mô phỏng: đã đạt 100/100.');});
    Object.keys(MAIN_TESTS).forEach(function(raw){var idx=Number(raw);if(idx<startIdx) rememberScopedQuizResult(MAIN_TESTS[idx].key,{score:100},'passed','Mô phỏng: đã đạt 100/100.');});
    setCurrentIndex(startIdx);
    try{ if(typeof current!=='undefined') current=startIdx; }catch(e){}
    if(typeof window.phfGoLearning==='function') window.phfGoLearning();
    else if(typeof window.render==='function') window.render();
    setTimeout(function(){ renderAdminSimulationBanner(); decorateLockedItems(); },80);
    return true;
  };
  window.phfStopAdminLearningSimulation = function phfStopAdminLearningSimulation(){
    try{
      sessionStorage.removeItem('phfAdminLearningSimulation');
      ['phfGateCompletedPagesByEmployee','phfQuizResultsByEmployee','phfShortQuizDoneByEmployee','phfProgressByEmployee','phfAdminSimulationProgress'].forEach(function(k){sessionStorage.removeItem(k);});
    }catch(e){}
    var b=document.getElementById('phfAdminSimulationBanner'); if(b) b.remove();
    if(typeof window.phfGoDirectTrainingTest==='function') window.phfGoDirectTrainingTest();
    else if(typeof window.phfRenderDirectTrainingTestPage==='function') window.phfRenderDirectTrainingTestPage();
  };

  window.phfB16LearningGate = {
    version:'16C',
    computeMaxAllowed:computeMaxAllowed,
    hasPassedMain:hasPassedMain,
    isShortSubmitted:isShortSubmitted,
    markCompleted:markCompleted,
    hasActiveHubAssignment:hasActiveHubAssignment,
    ensureLearningAccess:ensureLearningAccess,
    learnerHrDepartment:learnerHrDepartment,
    lessonAllowedForDepartment:lessonAllowedForDepartment,
    departmentLessonBoundary:departmentLessonBoundary,
    quizRuntime:{
      PASS_SCORE:PASS_SCORE,
      TEST_SUBMISSION_INFLIGHT:TEST_SUBMISSION_INFLIGHT,
      getProfile:getProfile,
      profileKey:profileKey,
      getCurrentIndex:getCurrentIndex,
      getLocalCompletedSet:getLocalCompletedSet,
      markCompleted:markCompleted,
      rememberScopedQuizResult:rememberScopedQuizResult,
      serverResults:serverResults,
      isShortQuizKey:isShortQuizKey,
      hasPassedMain:hasPassedMain,
      isAdminSimulation:isAdminSimulation,
      readJson:readJson,
      writeJson:writeJson,
      cleanPhone:cleanPhone
    },
    canOpenLesson:function(idx){
      idx=Number(idx);
      return !isLearner() || (ensureLearningAccess(false) && Number.isFinite(idx) && idx <= computeMaxAllowed());
    }
  };
  window.phfCanAccessLearning = hasActiveHubAssignment;
  window.phfCanOpenLessonIndex = function(idx){
    return window.phfB16LearningGate.canOpenLesson(idx);
  };

  /* Chặn ở pha capture để cả onclick inline và listener cũ không thể mở bài khóa. */
  document.addEventListener('click', function(e){
    if(!isLearner()) return;
    var actionBtn = e.target && e.target.closest ? e.target.closest('[data-phf-action]') : null;
    if(actionBtn) return;
    var btn = e.target && e.target.closest ? e.target.closest('[onclick*="go("],[data-go]') : null;
    if(!btn) return;
    var target = null;
    var raw = btn.getAttribute('onclick') || '';
    var m = raw.match(/go\((\d+)\)/);
    if(m) target = Number(m[1]);
    if(target == null && btn.hasAttribute('data-go')){
      var map={welcomePage:0,infoPage:1,ruleTimePage:2};
      var key=btn.getAttribute('data-go');
      if(Object.prototype.hasOwnProperty.call(map,key)) target=map[key];
    }
    if(target == null || target <= computeMaxAllowed()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    notice('warning','Phần này chưa mở','Vui lòng hoàn thành nội dung hiện tại theo đúng thứ tự trước khi chuyển sang phần này.');
    decorateLockedItems();
  }, true);

  injectStyle();
  document.addEventListener('DOMContentLoaded', function(){ setTimeout(decorateLockedItems, 150); });
  setTimeout(decorateLockedItems, 500);
})();


/* PHF Bản 16B - Cầu nối đăng nhập/SĐT -> hồ sơ thật -> resume đúng bài
   Mục tiêu: học viên đăng nhập email test có SĐT phải tự map về hồ sơ Supabase/data thật,
   không dùng id tạm test-learner nếu đã có hồ sơ theo SĐT.
*/
(function phfLearningResumeBridge16A(){
  'use strict';
  var BRIDGE_FLAG = '__phfB16AResumeBridge';
  if(window[BRIDGE_FLAG]) return;
  window[BRIDGE_FLAG] = true;

  function safe(fn, fallback){ try{ return fn(); }catch(e){ return fallback; } }
  function learningStorageKey(base){
    try{ if(typeof window.phfLearningStorageKey === 'function') return window.phfLearningStorageKey(base); }catch(e){}
    var email=safe(function(){return localStorage.getItem('phfSimpleTestLoginEmail')||localStorage.getItem('phfLoginEmail')||'';},'');
    var employee=safe(function(){return localStorage.getItem('phfEmployeeId')||'';},'');
    var raw=String(employee||email||'anonymous').trim().toLowerCase().replace(/[^a-z0-9@._-]+/g,'_');
    return String(base)+':'+raw;
  }
  function getLearningStorage(base){ return safe(function(){ return localStorage.getItem(learningStorageKey(base)); }, null); }
  function setLearningStorage(base,value){ safe(function(){ localStorage.setItem(learningStorageKey(base),String(value)); }); }
  function cleanPhone(v){ return String(v || '').replace(/\D+/g,''); }
  function data(){ return window.__phfLocalData || {}; }
  function readJson(key, fallback){ return safe(function(){ return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }, fallback); }
  function writeJson(key, value){ safe(function(){ localStorage.setItem(key, JSON.stringify(value)); }); }
  function getLessons(){ try{ if(typeof LESSONS !== 'undefined' && Array.isArray(LESSONS)) return LESSONS; }catch(e){} return []; }
  function pageToLessonIndex(page){
    var m = String(page || '').match(/^lesson:(\d+)$/i);
    if(!m) return null;
    var n = Number(m[1]);
    var lessons = getLessons();
    if(!Number.isFinite(n) || n < 0 || (lessons.length && n >= lessons.length)) return null;
    return n;
  }
  function isMeaningfulLessonPage(page){
    var idx = pageToLessonIndex(page);
    return idx !== null && idx >= 2;
  }
  function currentIndex(){
    var owner='';
    try{ owner=(typeof window.phfLearningAccountKey==='function')?window.phfLearningAccountKey():''; }catch(e){}
    try{ if(owner && window.__phfActiveLearningOwner===owner && typeof current !== 'undefined' && Number.isFinite(Number(current))) return Number(current); }catch(e){}
    var stored=getLearningStorage('phfCurrentLessonIndex');
    var scoped=(stored===null||stored==='')?0:Number(stored);
    if(!Number.isFinite(scoped)||scoped<0) scoped=0;
    if(owner) window.__phfActiveLearningOwner=owner;
    return scoped;
  }
  function rawSavedProfile(){
    return safe(function(){ return JSON.parse(localStorage.getItem('phfEmployeeProfile') || '{}') || {}; }, {});
  }
  function saveProfile(profile){
    if(!profile || !profile.id) return profile;
    safe(function(){
      localStorage.setItem('phfEmployeeProfile', JSON.stringify(profile));
      localStorage.setItem('phfEmployeeId', profile.id || '');
      if(profile.studyStartDate) localStorage.setItem('phfStudyStartDate', profile.studyStartDate);
    });
    return profile;
  }
  function isTempProfile(profile){
    var id = String(profile && profile.id || '');
    return !id || /^test-|^learner-|^demo-nv-001$/i.test(id);
  }
  function mergeProfile(real, fallback){
    real = real || {}; fallback = fallback || {};
    var merged = Object.assign({}, fallback, real);
    merged.id = real.id || fallback.id || '';
    merged.fullName = real.fullName || real.name || fallback.fullName || fallback.name || '';
    merged.phone = cleanPhone(real.phone || fallback.phone || '');
    merged.branch = real.branch || fallback.branch || fallback.store || '';
    merged.department = real.department || fallback.department || '';
    merged.position = real.position || fallback.position || 'Nhân viên bán hàng';
    merged.studyStartDate = real.studyStartDate || real.study_start_date || fallback.studyStartDate || fallback.study_start_date || '';
    merged.programId = real.programId || real.program_id || fallback.programId || 'new_sales';
    return merged;
  }
  function findEmployeeByPhone(phone){
    phone = cleanPhone(phone);
    if(!phone) return null;
    var rows = Array.isArray(data().employees) ? data().employees : [];
    return rows.find(function(e){ return cleanPhone(e && e.phone) === phone; }) || null;
  }
  function findEmployeeById(id){
    if(!id) return null;
    var rows = Array.isArray(data().employees) ? data().employees : [];
    return rows.find(function(e){ return String(e && e.id) === String(id); }) || null;
  }
  function profileComplete(profile){
    profile = profile || {};
    return !!(profile.fullName && cleanPhone(profile.phone).length >= 8 && profile.position && profile.branch && profile.studyStartDate);
  }
  function linkedProfile(inputProfile){
    var p = mergeProfile(inputProfile || {}, rawSavedProfile());
    var byId = p.id ? findEmployeeById(p.id) : null;
    var byPhone = findEmployeeByPhone(p.phone);
    var real = byPhone || byId;
    if(real && (isTempProfile(p) || String(real.id) !== String(p.id) || !profileComplete(p))){
      p = mergeProfile(real, p);
      saveProfile(p);
    }else if(p && p.id){
      saveProfile(p);
    }
    return p || {};
  }
  var lastRefreshAt = 0;
  var pendingRefresh = null;
  function refreshData(force){
    var now = Date.now();
    if(!force && pendingRefresh) return pendingRefresh;
    if(!force && now - lastRefreshAt < 5000) return Promise.resolve(true);
    lastRefreshAt = now;
    if(typeof window.phfRefreshTrainingData === 'function'){
      pendingRefresh = Promise.resolve(window.phfRefreshTrainingData()).catch(function(){ return false; }).finally(function(){ pendingRefresh = null; });
      return pendingRefresh;
    }
    pendingRefresh = fetch('/api/data', {cache:'no-store'})
      .then(function(res){ return res.json(); })
      .then(function(json){ window.__phfLocalData = json.data || json; return true; })
      .catch(function(){ return false; })
      .finally(function(){ pendingRefresh = null; });
    return pendingRefresh;
  }
  function progressFor(profile){
    profile = linkedProfile(profile || rawSavedProfile());
    var d = data();
    var list = [];
    var server = d && d.progress ? d.progress : {};
    if(profile.id && server[profile.id]) list.push(Object.assign({source:'server-id'}, server[profile.id]));
    // phòng trường hợp có bản local cũ lưu bằng phone:key
    var phoneKey = 'phone:' + cleanPhone(profile.phone);
    if(phoneKey && server[phoneKey]) list.push(Object.assign({source:'server-phone'}, server[phoneKey]));
    var localMap = readJson('phfProgressByEmployee', {});
    if(profile.id && localMap[profile.id]) list.push(Object.assign({source:'local-id'}, localMap[profile.id]));
    if(phoneKey && localMap[phoneKey]) list.push(Object.assign({source:'local-phone'}, localMap[phoneKey]));
    return list;
  }
  function activityFor(profile){
    profile = linkedProfile(profile || rawSavedProfile());
    var rows = Array.isArray(data().activityLog) ? data().activityLog : [];
    var employeeIds = {};
    if(profile.id) employeeIds[String(profile.id)] = true;
    var byPhone = findEmployeeByPhone(profile.phone);
    if(byPhone && byPhone.id) employeeIds[String(byPhone.id)] = true;
    return rows.filter(function(r){ return r && employeeIds[String(r.employeeId || r.employee_id || '')]; });
  }
  function latestMeaningfulActivity(profile){
    var rows = activityFor(profile).filter(function(r){ return isMeaningfulLessonPage(r.currentPage || r.current_page); });
    rows.sort(function(a,b){ return new Date(b.savedAt || b.saved_at || 0) - new Date(a.savedAt || a.saved_at || 0); });
    return rows[0] || null;
  }
  function nextFromCompleted(profile){
    var highest = null;
    progressFor(profile).forEach(function(rec){
      var pages = rec.completedPages || rec.completed_pages || [];
      if(Array.isArray(pages)){
        pages.forEach(function(page){
          var idx = pageToLessonIndex(page);
          if(idx !== null) highest = Math.max(highest == null ? -1 : highest, idx);
        });
      }
    });
    return highest == null ? null : highest + 1;
  }
  function hasRecordedLearningHistory(profile){
    profile = linkedProfile(profile || rawSavedProfile());
    var records = progressFor(profile);
    var hasProgress = records.some(function(rec){
      var pages = rec.completedPages || rec.completed_pages || [];
      var page = rec.currentPage || rec.current_page || '';
      return (Array.isArray(pages) && pages.some(function(x){ return /^lesson:\d+$/i.test(String(x)); }))
        || isMeaningfulLessonPage(page);
    });
    if(hasProgress) return true;
    return !!latestMeaningfulActivity(profile);
  }
  function resolveResumeIndex(profile){
    profile = linkedProfile(profile || rawSavedProfile());
    var candidates = [];
    progressFor(profile).forEach(function(rec){
      var page = rec.currentPage || rec.current_page;
      if(isMeaningfulLessonPage(page)) candidates.push({idx:pageToLessonIndex(page), time:rec.lastUpdatedAt || rec.last_updated_at || '', source:rec.source || 'progress'});
    });
    var act = latestMeaningfulActivity(profile);
    if(act) candidates.push({idx:pageToLessonIndex(act.currentPage || act.current_page), time:act.savedAt || act.saved_at || '', source:'activity'});
    candidates.sort(function(a,b){ return new Date(b.time || 0) - new Date(a.time || 0); });
    var resolved = null;
    if(candidates[0] && candidates[0].idx != null) resolved = candidates[0].idx;
    if(resolved == null){
      var next = nextFromCompleted(profile);
      if(next != null && next >= 1) resolved = next;
    }
    // Hồ sơ nhân viên đầy đủ không đồng nghĩa đã bắt đầu học.
    // Không có progress/activity hợp lệ thì luôn bắt đầu tại Bài 1 (lesson:0).
    if(resolved == null || !hasRecordedLearningHistory(profile)) resolved = 0;
    /* Resume cũng phải qua cùng learning gate. Dữ liệu lịch sử/currentPage cũ
       không được phép mở một bài cao hơn mức hiện được cấp. */
    try{
      if(window.phfB16LearningGate && typeof window.phfB16LearningGate.computeMaxAllowed === 'function'){
        resolved = Math.min(Number.isFinite(Number(resolved))?Number(resolved):0, window.phfB16LearningGate.computeMaxAllowed());
      }
    }catch(e){}
    return resolved;
  }
  function setLearningShell(){
    try{ if(typeof window.phfHideIntroAndStopAuto === 'function') window.phfHideIntroAndStopAuto(); }catch(e){}
    try{ if(typeof window.phfEnsureSharedShell === 'function') window.phfEnsureSharedShell('learning'); }catch(e){}
    try{ if(typeof window.phfSetMainNavActive === 'function') window.phfSetMainNavActive('learning'); }catch(e){}
    safe(function(){
      document.body.classList.remove('phf-module-page-mode','phf-eval-mode','phf-original-full-mode');
      document.body.classList.add('phf-main-shell-mode','phf-learning-mode');
    });
  }
  function openLessonIndex(idx, source){
    // Chỉ route Bài học của học viên được quyền dựng lesson shell.
    // Callback resume cũ có thể hoàn tất sau khi router đã chuyển sang PHF HR Home.
    if(typeof window.phfLearnerLessonSurfaceIsActive === 'function' && !window.phfLearnerLessonSurfaceIsActive()) return false;
    var lessons = getLessons();
    if(window.phfB16LearningGate && typeof window.phfB16LearningGate.ensureLearningAccess === 'function'){
      if(!window.phfB16LearningGate.ensureLearningAccess(true)) return false;
    }
    idx = Number(idx);
    if(!Number.isFinite(idx)) idx = 0;
    if(lessons.length) idx = Math.max(0, Math.min(idx, lessons.length - 1));
    try{
      if(window.phfB16LearningGate && typeof window.phfB16LearningGate.computeMaxAllowed === 'function'){
        idx = Math.min(idx, window.phfB16LearningGate.computeMaxAllowed());
      }
    }catch(e){}
    setLearningShell();
    try{ if(typeof window.phfLearningAccountKey==='function') window.__phfActiveLearningOwner=window.phfLearningAccountKey(); }catch(e){}
    try{ current = idx; }catch(e){}
    window.phfCurrentLessonIndex = idx;
    window.phfCurrentLessonKey = 'lesson:' + idx;
    safe(function(){
      setLearningStorage('phfCurrentLessonIndex', String(idx));
      setLearningStorage('phfCurrentPage', 'lesson:' + idx);
      setLearningStorage('phfLastLessonIndex', String(idx));
    });
    try{ if(typeof window.phfRequestLessonScroll === 'function') window.phfRequestLessonScroll(source || 'gate-resume','#mainLesson'); }catch(e){}
    try{ if(typeof window.render === 'function') window.render(); else if(typeof render === 'function') render(); }catch(e){ try{ if(typeof window.phfGo === 'function') window.phfGo(idx); }catch(_){} }
    try{ if(typeof window.phfRefreshResumeSave === 'function') window.phfRefreshResumeSave('learning', {lessonIndex:idx,currentPage:'lesson:'+idx,source:source||'16A'}); }catch(e){}
    setTimeout(function(){
      try{ if(typeof window.phfSetMainNavActive === 'function') window.phfSetMainNavActive('learning'); }catch(e){}
    }, 80);
    return idx;
  }

  var oldCurrentProfile = window.phfCurrentEmployeeProfile;
  if(typeof oldCurrentProfile === 'function'){
    window.phfCurrentEmployeeProfile = function phfCurrentEmployeeProfile16A(){
      var p = safe(function(){ return oldCurrentProfile.apply(this, arguments); }, rawSavedProfile());
      return linkedProfile(p);
    };
  }
  var oldGetSavedProfile = window.phfGetSavedProfile;
  if(typeof oldGetSavedProfile === 'function'){
    window.phfGetSavedProfile = function phfGetSavedProfile16A(){
      var p = safe(function(){ return oldGetSavedProfile.apply(this, arguments); }, rawSavedProfile());
      return linkedProfile(p);
    };
  }

  var oldResolve = window.phfResolveResumeLessonIndex;
  window.phfResolveResumeLessonIndex = function phfResolveResumeLessonIndex16A(profile){
    profile = linkedProfile(profile || rawSavedProfile());
    var idx = resolveResumeIndex(profile);
    // Chỉ tham khảo resolver cũ khi đã có lịch sử học thật; không để hồ sơ đầy đủ
    // hoặc cache cũ tự đẩy tài khoản mới qua Bài 1.
    if(hasRecordedLearningHistory(profile) && (idx == null || idx < 2) && typeof oldResolve === 'function'){
      var oldIdx = safe(function(){ return oldResolve(profile); }, idx);
      if(Number(oldIdx) >= 2) idx = Number(oldIdx);
    }
    return idx == null ? 0 : idx;
  };

  var oldOpenLearner = window.phfOpenLearnerAfterPhone;
  if(typeof oldOpenLearner === 'function'){
    window.phfOpenLearnerAfterPhone = function phfOpenLearnerAfterPhone16A(profile){
      profile = linkedProfile(profile || rawSavedProfile());
      var out = oldOpenLearner.apply(this, [profile]);
      setTimeout(function(){
        if(typeof window.phfLearnerLessonSurfaceIsActive === 'function' && !window.phfLearnerLessonSurfaceIsActive()) return;
        profile = linkedProfile(profile);
        var idx = resolveResumeIndex(profile);
        openLessonIndex(idx, 'phone-resume-16A');
      }, 180);
      return out;
    };
  }

  var oldGoLearning = window.phfGoLearning;
  if(typeof oldGoLearning === 'function'){
    window.phfGoLearning = function phfGoLearning16A(){
      var args = arguments;
      if(window.phfB16LearningGate && typeof window.phfB16LearningGate.ensureLearningAccess === 'function'){
        if(!window.phfB16LearningGate.ensureLearningAccess(true)) return Promise.resolve(false);
      }
      var loadingToken = (typeof window.phfLoadingShow === 'function') ? window.phfLoadingShow('learning') : null;
      /* 61.7: Khi mở/F5 bài học, Router đã sở hữu lượt tải dữ liệu boot.
         Learning Gate chỉ dùng lại Promise/state hiện có; không ép fetch mới. */
      return refreshData(false).then(function(ok){
        if(!ok) throw new Error('Không tải được dữ liệu học tập');
        var profile = linkedProfile(rawSavedProfile());
        var idx = resolveResumeIndex(profile);
        setLearningShell();
        openLessonIndex(idx, 'login-resume-16A');
        if(typeof window.phfLoadingSettle === 'function') window.phfLoadingSettle(loadingToken);
        else if(typeof window.phfLoadingHide === 'function') window.phfLoadingHide(loadingToken);
        return true;
      }).catch(function(err){
        console.warn('PHF learning load error', err);
        if(typeof window.phfLoadingFail === 'function'){
          window.phfLoadingFail('Chưa thể tải bài học và tiến độ. Vui lòng thử lại.', function(){ window.phfGoLearning(); });
          return false;
        }
        try{ oldGoLearning.apply(this, args); }catch(e){ setLearningShell(); openLessonIndex(currentIndex(), 'learning-fallback-16A'); }
        return false;
      });
    };
  }

  // Sau đăng nhập/mở Bài học mới refresh dữ liệu. Không refresh theo mọi click để tránh nặng web.
  window.addEventListener('storage', function(){ linkedProfile(rawSavedProfile()); });
  document.addEventListener('submit', function(){ setTimeout(function(){ refreshData(true).then(function(){ linkedProfile(rawSavedProfile()); }); }, 120); }, true);
  setTimeout(function(){ refreshData(false).then(function(){ linkedProfile(rawSavedProfile()); }); }, 350);

  window.phfB16AResumeBridge = {
    version:'16B.1',
    linkedProfile:linkedProfile,
    hasRecordedLearningHistory:hasRecordedLearningHistory,
    resolveResumeIndex:resolveResumeIndex,
    openLessonIndex:openLessonIndex,
    refreshData:refreshData
  };

  // Nền nhỏ cho bước sau: quản lý tiến độ có thể gọi các hàm này, chưa mở UI chỉnh tay ở bản 16B.
  window.phfProgressControlFoundation = window.phfProgressControlFoundation || {
    version:'16B',
    refreshData:refreshData,
    linkedProfile:linkedProfile,
    resolveResumeIndex:resolveResumeIndex,
    openLessonIndex:openLessonIndex
  };

  /* PHF Bản 1.0.0 – Một vòng đời quiz thống nhất.
   * Server test_results là nguồn xác nhận đạt.
   * Local chỉ được ghi sau khi server lưu test và progress thành công.
   */
  var quizRuntime = window.phfB16LearningGate && window.phfB16LearningGate.quizRuntime;
  if(!quizRuntime){
    var runtimeError = new Error('PHF quiz runtime chưa được khởi tạo.');
    console.error(runtimeError);
    window.phfSubmitQuizAttempt = function(){ return Promise.reject(runtimeError); };
    return;
  }
  var PASS_SCORE = quizRuntime.PASS_SCORE;
  var TEST_SUBMISSION_INFLIGHT = quizRuntime.TEST_SUBMISSION_INFLIGHT;
  var getProfile = quizRuntime.getProfile;
  var profileKey = quizRuntime.profileKey;
  var getCurrentIndex = quizRuntime.getCurrentIndex;
  var getLocalCompletedSet = quizRuntime.getLocalCompletedSet;
  var markCompleted = quizRuntime.markCompleted;
  var rememberScopedQuizResult = quizRuntime.rememberScopedQuizResult;
  var serverResults = quizRuntime.serverResults;
  var isShortQuizKey = quizRuntime.isShortQuizKey;
  var isAdminSimulation = quizRuntime.isAdminSimulation;
  var readJson = quizRuntime.readJson;
  var writeJson = quizRuntime.writeJson;
  var cleanPhone = quizRuntime.cleanPhone;
  // Không ghi đè hasPassedMain của IIFE learning gate phía trên.
  // Hai IIFE có phạm vi riêng; ghi đè trực tiếp trong strict mode sẽ gây ReferenceError
  // và làm dừng khởi tạo window.phfSubmitQuizAttempt.
  function hasPassedMainFromReceipt(key){
    return serverResults(key).some(function(r){
      var passScore=Number(r.passScore||r.pass_score||PASS_SCORE);
      var score=Number(r.score),status=String(r.status||'').toLowerCase();
      return /^(passed|pass|completed|done)$/.test(status) || (Number.isFinite(score)&&score>=passScore);
    });
  }
  if(window.phfB16LearningGate){
    window.phfB16LearningGate.hasPassedMainFromReceipt=hasPassedMainFromReceipt;
  }

  window.phfGetQuizCompletionState = function phfGetQuizCompletionStateV100(key){
    var serverRows=serverResults(key).slice().sort(function(a,b){
      return new Date(b.savedAt||b.saved_at||0)-new Date(a.savedAt||a.saved_at||0);
    });
    var trusted=serverRows;
    var passScore=isShortQuizKey(key)?100:PASS_SCORE;
    var passedRows=trusted.filter(function(r){
      var score=Number(r.score),status=String(r.status||'').toLowerCase();
      return /^(passed|pass|completed|done)$/.test(status) && Number.isFinite(score) && score>=passScore;
    });
    var best=trusted.reduce(function(m,r){var n=Number(r.score);return Number.isFinite(n)?Math.max(m,n):m;},0);
    var latest=trusted[0]||null;
    var passed=passedRows.length>0;
    var passRow=passedRows.sort(function(a,b){return new Date(b.savedAt||b.saved_at||0)-new Date(a.savedAt||a.saved_at||0);})[0]||null;
    return {
      key:key,passed:passed,bestScore:best||null,
      latestScore:latest&&Number.isFinite(Number(latest.score))?Number(latest.score):null,
      savedAt:(passRow&&(passRow.savedAt||passRow.saved_at))||'',
      source:serverRows.length?'server':'none'
    };
  };

  // Việc nộp bài được xử lý duy nhất qua window.phfSubmitQuizAttempt bên dưới.

  window.phfClearLocalQuizPass = function phfClearLocalQuizPassV101(key){
    var pk=profileKey(),p=getProfile();
    var scoped=readJson('phfQuizResultsByEmployee',{});
    [pk,p.id,p.phone?('phone:'+cleanPhone(p.phone)):''].filter(Boolean).forEach(function(k){
      if(Array.isArray(scoped[k])) scoped[k]=scoped[k].filter(function(r){return String(r.page||r.key||'')!==String(key);});
    });
    writeJson('phfQuizResultsByEmployee',scoped);
    var shortMap=readJson('phfShortQuizDoneByEmployee',{});
    [pk,p.id,p.phone?('phone:'+cleanPhone(p.phone)):''].filter(Boolean).forEach(function(k){if(shortMap[k]) delete shortMap[k][key];});
    writeJson('phfShortQuizDoneByEmployee',shortMap);
  };

  window.phfSubmitQuizAttempt = async function phfSubmitQuizAttemptV103(key,stat,options){
    options=options||{};
    var kind=options.kind||'main';
    var passScore=kind==='short'?100:PASS_SCORE;
    var passed=Number(stat&&stat.score)>=passScore;
    var status=passed?'passed':'failed';
    var text=passed
      ? ('Đạt bài kiểm tra '+(kind==='short'?'ngắn ':'')+Number(stat.score)+'/100.')
      : ('Chưa đạt bài kiểm tra. Điểm '+Number(stat&&stat.score||0)+'/100.');
    var profile=getProfile();
    if(!profile||!profile.id) throw new Error('Tài khoản chưa liên kết hồ sơ nhân viên.');
    var idx=Number(options.lessonIndex==null?getCurrentIndex():options.lessonIndex);
    if(isAdminSimulation()){
      if(passed) markCompleted(idx);
      rememberScopedQuizResult(key,stat||{},status,text);
      if(passed&&kind==='short'){
        var simMap=readJson('phfShortQuizDoneByEmployee',{});
        if(!simMap[profileKey()]) simMap[profileKey()]={};
        simMap[profileKey()][key]=new Date().toISOString();
        writeJson('phfShortQuizDoneByEmployee',simMap);
      }
      return {key:key,passed:passed,bestScore:Number(stat&&stat.score)||0,latestScore:Number(stat&&stat.score)||0,savedAt:new Date().toISOString(),source:'admin-simulation',simulation:true,testResultSaved:true,progressSaved:passed};
    }
    var lockKey=String(profile.id)+'|'+String(key||'');
    if(TEST_SUBMISSION_INFLIGHT[lockKey]) return TEST_SUBMISSION_INFLIGHT[lockKey];
    var submissionId='test-'+String(profile.id).replace(/[^a-zA-Z0-9_-]/g,'_')+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,8);
    var completedSet=getLocalCompletedSet();
    if(passed) completedSet.add('lesson:'+idx);
    var completedPages=Array.from(completedSet).filter(function(x){return /^lesson:\d+$/.test(String(x));});
    var payload={
      type:passed?(kind==='short'?'short-quiz-pass':'test-pass'):'test',
      employee:profile,
      currentPage:'lesson:'+idx,
      completedPages:completedPages,
      testResult:{
        submissionId:submissionId,
        page:key,
        employeeId:profile.id,
        employeePhone:cleanPhone(profile.phone||''),
        score:Number(stat&&stat.score),
        passScore:passScore,
        status:status,
        resultText:text
      }
    };
    TEST_SUBMISSION_INFLIGHT[lockKey]=fetch('/api/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(function(res){return res.json().catch(function(){return{};}).then(function(json){
        if(!res.ok||!(json&&json.ok)) throw new Error(json&&json.error?json.error:'Chưa thể lưu kết quả và tiến độ.');
        var receipt=json&&json.receipt&&typeof json.receipt==='object'?json.receipt:null;
        if(!receipt||receipt.testResultSaved!==true||receipt.progressSaved!==true){
          throw new Error('Máy chủ chưa xác nhận đủ kết quả kiểm tra và tiến độ. Hãy bấm “Lưu lại kết quả”.');
        }
        if(String(receipt.employeeId||'')!==String(profile.id||'')){
          throw new Error('Biên nhận lưu kết quả không khớp hồ sơ học viên. Hệ thống chưa mở bài tiếp theo.');
        }
        if(String(receipt.quizKey||'')!==String(key||'')){
          throw new Error('Biên nhận lưu kết quả không khớp bài kiểm tra. Hệ thống chưa mở bài tiếp theo.');
        }
        if(Number(receipt.score)!==Number(stat&&stat.score)){
          throw new Error('Biên nhận điểm số không khớp lần nộp hiện tại. Hãy bấm “Lưu lại kết quả”.');
        }
        if(passed&&receipt.nextPageAllowed!==true){
          throw new Error('Kết quả đã được ghi nhận nhưng tiến độ chưa mở bài tiếp theo. Hãy bấm “Lưu lại kết quả”.');
        }
        if(json.data) window.__phfLocalData=json.data;
        if(passed) markCompleted(idx);
        rememberScopedQuizResult(key,stat||{},status,text);
        if(passed&&kind==='short'){
          var map=readJson('phfShortQuizDoneByEmployee',{});
          if(!map[profileKey()]) map[profileKey()]={};
          map[profileKey()][key]=receipt.savedAt||json.savedAt||new Date().toISOString();
          writeJson('phfShortQuizDoneByEmployee',map);
        }
        return {
          key:key,
          passed:passed,
          bestScore:Number(stat&&stat.score)||0,
          latestScore:Number(stat&&stat.score)||0,
          savedAt:receipt.savedAt||json.savedAt||new Date().toISOString(),
          source:'server-receipt',
          testResultSaved:true,
          progressSaved:true,
          nextPageAllowed:receipt.nextPageAllowed===true,
          receipt:receipt
        };
      });})
      .catch(function(err){
        try{ if(typeof window.phfClearLocalQuizPass==='function') window.phfClearLocalQuizPass(key); }catch(_e){}
        throw err;
      })
      .finally(function(){setTimeout(function(){delete TEST_SUBMISSION_INFLIGHT[lockKey];},500);});
    return TEST_SUBMISSION_INFLIGHT[lockKey];
  };

  function markShortSubmittedV100(key,stat,meta){
    return window.phfSubmitQuizAttempt(key,stat||{score:100,correct:null,total:null},{kind:'short',lessonIndex:getCurrentIndex(),meta:meta||{}});
  }
  window.phfMarkShortQuizCompleted=markShortSubmittedV100;

  window.phfStoreQuizResult = function phfStoreQuizResultV100(key,stat){
    return window.phfSubmitQuizAttempt(key,stat||{},{kind:'main',lessonIndex:getCurrentIndex()});
  };

})();
