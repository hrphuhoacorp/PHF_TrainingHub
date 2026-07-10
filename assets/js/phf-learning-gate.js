/* PHF Bản 16B - Khóa luồng học viên + ổn định resume/quiz theo học viên
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
  function isLearner(){ return getRole() !== 'admin' && getRole() !== 'manager'; }
  function getLessons(){
    try{ if(typeof LESSONS !== 'undefined' && Array.isArray(LESSONS)) return LESSONS; }catch(e){}
    return [];
  }
  function getCurrentIndex(){
    try{ if(typeof current !== 'undefined' && Number.isFinite(Number(current))) return Number(current); }catch(e){}
    return Number(localStorage.getItem('phfCurrentLessonIndex') || 1) || 1;
  }
  function setCurrentIndex(i){
    try{ if(typeof current !== 'undefined') current = i; }catch(e){}
    window.phfCurrentLessonIndex = i;
    window.phfCurrentLessonKey = 'lesson:' + i;
    safe(function(){ localStorage.setItem('phfCurrentLessonIndex', String(i)); localStorage.setItem('phfCurrentPage', 'lesson:' + i); });
  }
  function getProfile(){
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
  function readJson(key, fallback){ return safe(function(){ return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }, fallback); }
  function writeJson(key, value){ safe(function(){ localStorage.setItem(key, JSON.stringify(value)); }); }
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
  function completedHighestSequential(){
    var set = getLocalCompletedSet();
    var lessons = getLessons();
    // Màn chào mừng (lesson:0) luôn được xem là đã mở để học viên mới có thể vào form thông tin.
    var highest = 0;
    for(var i=1;i<lessons.length;i++){
      if(set.has('lesson:' + i)) highest = i;
      else break;
    }
    return highest;
  }
  function isMainTestIndex(idx){ return Object.prototype.hasOwnProperty.call(MAIN_TESTS, Number(idx)); }
  function mainKey(idx){ return MAIN_TESTS[Number(idx)] && MAIN_TESTS[Number(idx)].key; }
  function shortKey(idx){ return SHORT_TESTS[Number(idx)] || null; }
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
      Object.keys(done || {}).forEach(function(x){ arr.push({page:x, key:x, status:'submitted', score:null, savedAt:done[x], _scope:k, _trustedLocal:true}); });
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
      passScore:PASS_SCORE,
      status:status || ((stat && Number(stat.score) >= PASS_SCORE) ? 'passed' : 'failed'),
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
  function latestResult(key){
    var p = getProfile();
    var pid = String(p.id || '');
    var phone = cleanPhone(p.phone || '');
    var results = getScopedQuizResults().filter(function(r){
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
    var r = latestResult(key);
    return Boolean(r && /submitted|done|passed|pass|completed/i.test(String(r.status || 'submitted')));
  }
  function computeMaxAllowed(){
    var lessons = getLessons();
    if(!lessons.length) return 1;
    var highest = completedHighestSequential();
    var allowed = Math.max(1, Math.min(lessons.length - 1, highest + 1));

    Object.keys(SHORT_TESTS).map(Number).sort(function(a,b){return a-b;}).forEach(function(idx){
      if(allowed > idx && !isShortSubmitted(SHORT_TESTS[idx])) allowed = idx;
    });
    Object.keys(MAIN_TESTS).map(Number).sort(function(a,b){return a-b;}).forEach(function(idx){
      if(allowed > idx && !hasPassedMain(MAIN_TESTS[idx].key)) allowed = idx;
    });
    return Math.max(1, Math.min(allowed, lessons.length - 1));
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
    var root = document.getElementById('mainLesson');
    if(!root) return true;
    var radios = Array.from(root.querySelectorAll('input[type="radio"]'));
    if(!radios.length) return true;
    var names = Array.from(new Set(radios.map(function(r){ return r.name || r.getAttribute('name') || ''; }).filter(Boolean)));
    var missing = names.filter(function(name){ return !root.querySelector('input[type="radio"][name="' + CSS.escape(name) + '"]:checked'); });
    if(missing.length){
      notice('warning','Chưa hoàn thành bài kiểm tra ngắn','Vui lòng trả lời đủ các câu hỏi ngắn trong bài. Phần này không cần đạt điểm, nhưng cần hoàn thành trước khi qua nội dung tiếp theo.');
      return false;
    }
    markShortSubmitted(key);
    return true;
  }
  function markShortSubmitted(key){
    var map = readJson('phfShortQuizDoneByEmployee', {});
    if(!map[profileKey()]) map[profileKey()] = {};
    map[profileKey()][key] = new Date().toISOString();
    writeJson('phfShortQuizDoneByEmployee', map);
    rememberScopedQuizResult(key, {score:null, correct:null, total:null}, 'submitted', 'Đã hoàn thành bài kiểm tra ngắn.');
    saveTestResult(key, {score:null, correct:null, total:null}, 'submitted', 'Đã hoàn thành bài kiểm tra ngắn.');
  }
  function canCompleteCurrent(){
    var idx = getCurrentIndex();
    if(typeof window.phfValidateInfoForm === 'function' && idx === 1){
      if(!window.phfValidateInfoForm()) return false;
    }
    if(typeof window.phfValidateMorningCommitment === 'function' && !window.phfValidateMorningCommitment()) return false;
    if(typeof window.phfValidateRequiredLessonChecks === 'function' && !window.phfValidateRequiredLessonChecks()) return false;
    if(typeof window.phfValidateConfidentialityCommitment === 'function' && !window.phfValidateConfidentialityCommitment(false)) return false;

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
  function saveTestResult(key, stat, status, resultText){
    var profile = getProfile();
    if(!profile || !profile.id) return;
    var payload = {
      type:'test',
      employee:profile,
      skipProgress:true,
      testResult:{
        page:key,
        employeeId:profile.id || '',
        employeePhone:cleanPhone(profile.phone || ''),
        score:(stat && Number.isFinite(Number(stat.score))) ? Number(stat.score) : null,
        passScore:PASS_SCORE,
        status:status || ((stat && Number(stat.score) >= PASS_SCORE) ? 'passed' : 'failed'),
        resultText: resultText || ''
      }
    };
    fetch('/api/data', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)})
      .then(function(res){ return res.json().catch(function(){ return {}; }); })
      .then(function(json){ if(json && json.data) window.__phfLocalData = json.data; })
      .catch(function(){});
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
      var viewedPage = 'lesson:' + idx;
      var completedPages = Array.from(getLocalCompletedSet()).filter(function(x){ return /^lesson:\d+$/.test(String(x)); });
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
        localStorage.setItem('phfCurrentPage', currentPage || viewedPage);
        localStorage.setItem('phfCurrentLessonIndex', String(pageToLessonIndex(currentPage) == null ? idx : pageToLessonIndex(currentPage)));
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
    s.textContent = '.phf-gate-locked{opacity:.48!important;filter:grayscale(.25);cursor:not-allowed!important}.phf-gate-locked .phase-state:after{content:" · Khóa"}.phf-gate-locked .mark{background:#eef2f0!important;color:#83938c!important}';
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

    if(target > maxAllowed){
      if(target === currentIdx + 1){
        if(!canCompleteCurrent()) return;
        markCompleted(currentIdx);
        maxAllowed = computeMaxAllowed();
      }
      if(target > Math.max(maxAllowed, currentIdx + 1)){
        notice('warning','Phần này chưa mở','Vui lòng hoàn thành nội dung hiện tại theo đúng thứ tự trước khi chuyển sang phần này.');
        decorateLockedItems();
        return;
      }
    }

    if(target === currentIdx + 1 && !getLocalCompletedSet().has('lesson:' + currentIdx)){
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
  window.phfTryNextFromLesson = function phfTryNextFromLessonB16(){
    var idx = getCurrentIndex();
    if(!isLearner()){
      if(typeof oldNext === 'function') return oldNext.apply(this, arguments);
      return guardedGo(idx + 1);
    }
    if(!canCompleteCurrent()) return;
    markCompleted(idx);
    guardedGo(idx + 1);
  };

  var oldRender = window.render;
  if(typeof oldRender === 'function'){
    window.render = function renderB16(){
      if(isLearner()){
        var idx = getCurrentIndex();
        var max = computeMaxAllowed();
        if(idx > max){ setCurrentIndex(max); }
      }
      var result = oldRender.apply(this, arguments);
      setTimeout(decorateLockedItems, 0);
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

  window.phfB16LearningGate = {
    version:'16B',
    computeMaxAllowed:computeMaxAllowed,
    hasPassedMain:hasPassedMain,
    isShortSubmitted:isShortSubmitted,
    markCompleted:markCompleted
  };

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
    try{ if(typeof current !== 'undefined' && Number.isFinite(Number(current))) return Number(current); }catch(e){}
    return Number(localStorage.getItem('phfCurrentLessonIndex') || 1) || 1;
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
    if(candidates[0] && candidates[0].idx != null) return candidates[0].idx;
    var next = nextFromCompleted(profile);
    if(next != null && next >= 2) return next;
    if(profileComplete(profile)) return 2;
    return 1;
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
    var lessons = getLessons();
    idx = Number(idx);
    if(!Number.isFinite(idx)) idx = 1;
    if(lessons.length) idx = Math.max(1, Math.min(idx, lessons.length - 1));
    setLearningShell();
    try{ current = idx; }catch(e){}
    window.phfCurrentLessonIndex = idx;
    window.phfCurrentLessonKey = 'lesson:' + idx;
    safe(function(){
      localStorage.setItem('phfCurrentLessonIndex', String(idx));
      localStorage.setItem('phfCurrentPage', 'lesson:' + idx);
      localStorage.setItem('phfLastLessonIndex', String(idx));
    });
    try{ if(typeof window.render === 'function') window.render(); else if(typeof render === 'function') render(); }catch(e){ try{ if(typeof window.phfGo === 'function') window.phfGo(idx); }catch(_){} }
    try{ if(typeof window.phfRefreshResumeSave === 'function') window.phfRefreshResumeSave('learning', {lessonIndex:idx,currentPage:'lesson:'+idx,source:source||'16A'}); }catch(e){}
    setTimeout(function(){
      try{ if(typeof window.phfSetMainNavActive === 'function') window.phfSetMainNavActive('learning'); }catch(e){}
      try{ window.scrollTo({top:0,left:0,behavior:'auto'}); }catch(e){}
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
    if((idx == null || idx < 2) && typeof oldResolve === 'function'){
      var oldIdx = safe(function(){ return oldResolve(profile); }, idx);
      if(Number(oldIdx) >= 2) idx = Number(oldIdx);
    }
    return idx == null ? (profileComplete(profile) ? 2 : 1) : idx;
  };

  var oldOpenLearner = window.phfOpenLearnerAfterPhone;
  if(typeof oldOpenLearner === 'function'){
    window.phfOpenLearnerAfterPhone = function phfOpenLearnerAfterPhone16A(profile){
      profile = linkedProfile(profile || rawSavedProfile());
      var out = oldOpenLearner.apply(this, [profile]);
      setTimeout(function(){
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
      var loadingToken = (typeof window.phfLoadingShow === 'function') ? window.phfLoadingShow('learning') : null;
      return refreshData(true).then(function(ok){
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
  setTimeout(function(){ refreshData(true).then(function(){ linkedProfile(rawSavedProfile()); }); }, 350);

  window.phfB16AResumeBridge = {
    version:'16B',
    linkedProfile:linkedProfile,
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
})();
