/* PHF Training Hub - Bản 26
   Tách lớp hồ sơ/tiến độ khỏi phf-learner-app.js và index.html.
   Giữ nguyên nghiệp vụ hiện có: nhận diện hồ sơ theo SĐT/tài khoản, lưu tiến độ, quay lại đúng bài đang học.
*/

/* PHF resume progress fix - nhận diện SĐT xong mở đúng phần đang học */
(function(){
  function cleanPhone(v){ return String(v || '').replace(/\D+/g,''); }
  function pageToLessonIndex(page){
    const raw = String(page || '').trim();
    const p = raw.toLowerCase();
    if(!p) return null;
    const m = p.match(/^lesson[:\-](\d+)$/);
    if(m){
      const n = Number(m[1]);
      if(Number.isFinite(n) && Array.isArray(window.LESSONS || LESSONS) && n >= 0 && n < LESSONS.length) return n;
    }
    const fixed = {welcomepage:0, infopage:1, ruletimepage:2};
    if(Object.prototype.hasOwnProperty.call(fixed, p)) return fixed[p];
    if(Array.isArray(LESSONS)){
      const idx = LESSONS.findIndex(function(x){
        const hay = String((x.title||'') + ' ' + (x.nav||'') + ' ' + (x.sub||'') + ' ' + (x.badge||'')).toLowerCase();
        return hay.includes(p) || p.includes(String(x.title||'').toLowerCase());
      });
      if(idx >= 0) return idx;
    }
    return null;
  }
  function isMeaningfulPage(page){
    const idx = pageToLessonIndex(page);
    return idx !== null && idx >= 2;
  }
  function getLocalProgress(profile){
    const id = profile && profile.id ? String(profile.id) : '';
    const phone = cleanPhone(profile && profile.phone);
    const out = [];
    try{
      const map = JSON.parse(localStorage.getItem('phfProgressByEmployee') || '{}') || {};
      if(id && map[id]) out.push(map[id]);
      if(phone && map['phone:' + phone]) out.push(map['phone:' + phone]);
    }catch(e){}
    ['phfCurrentPage','phfLastPage','phfCurrentLessonKey'].forEach(function(k){
      try{ const v = localStorage.getItem(k); if(v) out.push({currentPage:v,lastUpdatedAt:''}); }catch(e){}
    });
    try{
      const v = localStorage.getItem('phfCurrentLessonIndex') || localStorage.getItem('phfLastLessonIndex');
      if(v !== null && v !== '') out.push({currentPage:'lesson:' + Number(v),lastUpdatedAt:''});
    }catch(e){}
    return out;
  }
  function getServerProgress(profile){
    const data = window.__phfLocalData || {};
    const id = profile && profile.id ? String(profile.id) : '';
    const phone = cleanPhone(profile && profile.phone);
    const list = [];
    const progress = data.progress || {};
    if(id && progress[id]) list.push(progress[id]);
    if(phone && progress['phone:' + phone]) list.push(progress['phone:' + phone]);
    if(phone && Array.isArray(data.employees)){
      data.employees.forEach(function(e){
        const empPhone = cleanPhone(e && (e.phone || e.mobile || e.tel));
        const empId = e && (e.id || e.employeeId || e.employee_id);
        if(empPhone === phone && empId && progress[empId]) list.push(progress[empId]);
      });
    }
    return list;
  }
  function getActivityCandidates(profile){
    const data = window.__phfLocalData || {};
    const id = profile && profile.id ? String(profile.id) : '';
    const phone = cleanPhone(profile && profile.phone);
    if(!Array.isArray(data.activityLog)) return [];
    const empIds = new Set();
    if(id) empIds.add(id);
    if(phone && Array.isArray(data.employees)){
      data.employees.forEach(function(e){
        if(cleanPhone(e && e.phone) === phone){
          const empId = e && (e.id || e.employeeId || e.employee_id);
          if(empId) empIds.add(String(empId));
        }
      });
    }
    return data.activityLog
      .filter(function(l){ return l && empIds.has(String(l.employeeId || l.employee_id || '')); })
      .map(function(l){ return {currentPage:l.currentPage || l.current_page || '', lastUpdatedAt:l.savedAt || l.saved_at || ''}; });
  }
  function latestByTime(items){
    return items.slice().sort(function(a,b){ return new Date(b.lastUpdatedAt || b.savedAt || b.saved_at || 0) - new Date(a.lastUpdatedAt || a.savedAt || a.saved_at || 0); });
  }
  function completedToNext(progressList){
    let best = null;
    progressList.forEach(function(p){
      const pages = Array.isArray(p && p.completedPages) ? p.completedPages : (Array.isArray(p && p.completed_pages) ? p.completed_pages : []);
      pages.forEach(function(pg){
        const idx = pageToLessonIndex(pg);
        if(idx !== null && (best === null || idx > best)) best = idx;
      });
    });
    if(best === null) return null;
    return Math.min(best + 1, LESSONS.length - 1);
  }
  window.phfResolveResumeLessonIndex = function(profile){
    const progressList = [].concat(getServerProgress(profile), getLocalProgress(profile));
    const activityList = getActivityCandidates(profile);
    const direct = latestByTime(progressList.concat(activityList)).find(function(x){ return isMeaningfulPage(x.currentPage || x.current_page); });
    if(direct){
      const idx = pageToLessonIndex(direct.currentPage || direct.current_page);
      if(idx !== null) return idx;
    }
    const next = completedToNext(progressList);
    if(next !== null && next >= 2) return next;
    return 1;
  };
  window.phfSaveProgressNow = async function(reason){
    try{
      const profile = (typeof phfCurrentEmployeeProfile === 'function') ? phfCurrentEmployeeProfile() : (typeof phfGetSavedProfile === 'function' ? phfGetSavedProfile() : {});
      if(!profile || !profile.id) return false;
      const idx = (typeof current !== 'undefined' && Number.isFinite(Number(current))) ? Number(current) : 1;
      const page = 'lesson:' + idx;
      const completedPages = [];
      for(let i=0;i<idx;i++) completedPages.push('lesson:' + i);
      const rec = {currentPage:page, completedPages:completedPages, lastUpdatedAt:new Date().toISOString()};
      try{
        const map = JSON.parse(localStorage.getItem('phfProgressByEmployee') || '{}') || {};
        map[profile.id] = rec;
        if(profile.phone) map['phone:' + cleanPhone(profile.phone)] = rec;
        localStorage.setItem('phfProgressByEmployee', JSON.stringify(map));
        localStorage.setItem('phfCurrentPage', page);
        localStorage.setItem('phfCurrentLessonIndex', String(idx));
      }catch(e){}
      try{
        const res = await fetch('/api/data', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({type:reason || 'autosave', employee:profile, currentPage:page, completedPages:completedPages})
        });
        const json = await res.json().catch(function(){ return {}; });
        if(res.ok && json && (json.data || json.ok)) window.__phfLocalData = json.data || window.__phfLocalData;
      }catch(e){}
      return true;
    }catch(err){ console.warn('PHF save progress fallback error', err); return false; }
  };
  const previousOpenLearnerAfterPhone = window.phfOpenLearnerAfterPhone || phfOpenLearnerAfterPhone;
  window.phfOpenLearnerAfterPhone = phfOpenLearnerAfterPhone = function(profile){
    const overlay = document.getElementById('phfPhoneEntryOverlay');
    if(overlay) overlay.remove();
    phfShowRoleSwitcher();
    let idx = 1;
    try{ idx = window.phfResolveResumeLessonIndex(profile); }catch(e){ idx = 1; }
    try{
      if(typeof current !== 'undefined') current = idx;
      window.phfCurrentLessonIndex = idx;
      window.phfCurrentLessonKey = 'lesson:' + idx;
    }catch(e){}
    if(typeof render === 'function') render();
    setTimeout(function(){
      try{
        const main = document.getElementById('mainLesson') || document.querySelector('.main') || document.body;
        const top = Math.max(0, main.getBoundingClientRect().top + window.pageYOffset - 12);
        window.scrollTo({top:top,left:0,behavior:'auto'});
      }catch(e){}
    }, 60);
  };

})();

/* PHF refresh resume state - giữ đúng vị trí khi người dùng bấm Refresh/F5
   - Chỉ lưu trạng thái màn hình nhẹ bằng localStorage.
   - Không đổi Supabase/schema, không ghi đè tiến độ học chính.
   - Khi học viên đã nhận diện, tiến độ bài học vẫn ưu tiên logic resume hiện có. */
(function(){
  const KEY = 'phfRefreshResumeState';
  const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

  function cleanPhone(v){ return String(v || '').replace(/\D+/g,''); }
  function now(){ return new Date().toISOString(); }
  function getRole(){
    try{ return (typeof phfUserRole === 'function') ? phfUserRole() : (localStorage.getItem('phfInternalTestRole') || 'learner'); }
    catch(e){ return 'learner'; }
  }
  function getProfile(){
    try{ return (typeof phfCurrentEmployeeProfile === 'function') ? phfCurrentEmployeeProfile() : JSON.parse(localStorage.getItem('phfEmployeeProfile') || '{}'); }
    catch(e){ return {}; }
  }
  function lessonIndex(){
    try{ if(typeof current !== 'undefined' && Number.isFinite(Number(current))) return Number(current); }catch(e){}
    try{ if(typeof window.phfCurrentLessonIndex === 'number') return window.phfCurrentLessonIndex; }catch(e){}
    return null;
  }
  function safeParse(raw){ try{ return JSON.parse(raw || 'null'); }catch(e){ return null; } }
  function validState(st){
    if(!st || typeof st !== 'object') return false;
    if(!st.updatedAt) return false;
    const t = new Date(st.updatedAt).getTime();
    if(!Number.isFinite(t) || Date.now() - t > MAX_AGE_MS) return false;
    return ['intro','role','phone','learning','manager','admin','overview','profile','guide','directTrainingTest'].includes(st.screen);
  }
  function save(screen, extra){
    try{
      const profile = getProfile();
      const idx = lessonIndex();
      const state = Object.assign({
        version: 1,
        screen: screen || 'learning',
        role: getRole(),
        lessonIndex: idx,
        currentPage: idx !== null ? ('lesson:' + idx) : '',
        phone: cleanPhone(profile && profile.phone),
        employeeId: profile && profile.id || localStorage.getItem('phfEmployeeId') || '',
        updatedAt: now()
      }, extra || {});
      localStorage.setItem(KEY, JSON.stringify(state));
    }catch(err){ console.warn('PHF refresh resume save error', err); }
  }
  function read(){
    const st = safeParse(localStorage.getItem(KEY));
    return validState(st) ? st : null;
  }
  function hideIntroForRestore(){
    try{ if(typeof window.phfIntroStopAutoHard === 'function') window.phfIntroStopAutoHard(); else if(typeof window.phfIntroStopAuto === 'function') window.phfIntroStopAuto(); }catch(e){}
    const intro = document.getElementById('introSection');
    if(intro) intro.hidden = true;
    document.body.classList.remove('phf-intro-active','phf-landing-active','phf-guide-intro-active');
    window.__phfTrainingEntryReady = true;
  }
  function restoreLesson(st){
    hideIntroForRestore();
    try{ localStorage.setItem('phfInternalTestRole', st.role || 'learner'); }catch(e){}
    try{ if(typeof phfShowRoleSwitcher === 'function') phfShowRoleSwitcher(); }catch(e){}
    let idx = Number.isFinite(Number(st.lessonIndex)) ? Number(st.lessonIndex) : null;
    const profile = getProfile();
    if(idx === null && typeof window.phfResolveResumeLessonIndex === 'function'){
      try{ idx = window.phfResolveResumeLessonIndex(profile); }catch(e){}
    }
    if(idx === null || idx < 0) idx = 1;
    if(Array.isArray(LESSONS) && idx >= LESSONS.length) idx = LESSONS.length - 1;
    try{
      current = idx;
      window.phfCurrentLessonIndex = idx;
      window.phfCurrentLessonKey = 'lesson:' + idx;
      if(typeof render === 'function') render();
      document.body.classList.remove('phf-original-full-mode');
    }catch(e){
      try{ if(typeof window.phfGo === 'function') window.phfGo(idx); }catch(_){}
    }
    setTimeout(function(){
      try{
        const main = document.getElementById('mainLesson') || document.querySelector('.main') || document.body;
        const top = Math.max(0, main.getBoundingClientRect().top + window.pageYOffset - 12);
        window.scrollTo({top:top,left:0,behavior:'auto'});
      }catch(e){}
    }, 80);
  }
  async function restore(){
    const st = read();
    if(!st) return false;
    if(st.screen === 'intro'){
      try{ if(typeof window.phfIntroGo === 'function') window.phfIntroGo(Number(st.introIndex || 0)); }catch(e){}
      return true;
    }
    if(st.screen === 'role'){
      hideIntroForRestore();
      try{ if(typeof phfShowRoleChooser === 'function') phfShowRoleChooser(true); }catch(e){}
      return true;
    }
    if(st.screen === 'phone'){
      hideIntroForRestore();
      try{ localStorage.setItem('phfInternalTestRole', 'learner'); }catch(e){}
      try{ if(typeof phfShowLearnerPhoneEntry === 'function') phfShowLearnerPhoneEntry(); }catch(e){}
      setTimeout(function(){
        const input = document.getElementById('phfLearnerPhoneInput');
        if(input && st.phone) input.value = st.phone;
      }, 80);
      return true;
    }
    if(st.screen === 'overview'){
      hideIntroForRestore();
      try{ if(typeof phfRenderTrainingOverview === 'function') phfRenderTrainingOverview(); }catch(e){}
      return true;
    }
    if(st.screen === 'guide'){
      hideIntroForRestore();
      try{ if(typeof phfGoGuide === 'function') phfGoGuide(); else if(typeof phfRenderGuidePage === 'function') phfRenderGuidePage(); }catch(e){}
      return true;
    }
    if(st.screen === 'directTrainingTest'){
      hideIntroForRestore();
      try{ if(typeof phfGoDirectTrainingTest === 'function') phfGoDirectTrainingTest(); }catch(e){}
      return true;
    }
    if(st.screen === 'profile'){
      hideIntroForRestore();
      try{
        if(typeof phfGoMyProfile === 'function') phfGoMyProfile();
        else if(typeof phfRenderEvaluationWorkspace === 'function') phfRenderEvaluationWorkspace(phfCanEditEvaluation()?'todo':'profiles');
      }catch(e){}
      return true;
    }
    if(st.screen === 'admin' || st.screen === 'manager'){
      hideIntroForRestore();
      try{ localStorage.setItem('phfInternalTestRole', st.screen === 'admin' ? 'admin' : 'manager'); }catch(e){}
      try{ if(typeof phfShowRoleSwitcher === 'function') phfShowRoleSwitcher(); }catch(e){}
      try{ if(typeof phfRenderTrainingOverview === 'function') phfRenderTrainingOverview(); else if(typeof render === 'function') render(); }catch(e){}
      return true;
    }
    restoreLesson(st);
    return true;
  }

  window.phfRefreshResumeSave = save;
  window.phfRefreshResumeClear = function(){ try{ localStorage.removeItem(KEY); }catch(e){} };
  window.phfRefreshResumeRestore = restore;

  const oldGo = window.phfGo || go;
  if(typeof oldGo === 'function'){
    window.phfGo = go = function(i){
      const out = oldGo(i);
      setTimeout(function(){ save('learning', {lessonIndex: lessonIndex(), currentPage:'lesson:' + lessonIndex()}); }, 30);
      return out;
    };
  }

  const oldRender = render;
  if(typeof oldRender === 'function'){
    render = function(){
      const out = oldRender.apply(this, arguments);
      setTimeout(function(){
        const hasRoleOverlay = !!document.getElementById('phfRoleOverlay');
        const hasPhoneOverlay = !!document.getElementById('phfPhoneEntryOverlay');
        const introActive = document.body.classList.contains('phf-intro-active');
        if(introActive || hasRoleOverlay || hasPhoneOverlay) return;
        const role = getRole();
        // Stage 3.12.6: render() là khu Bài học của tôi, nên F5 phải lưu màn learning bất kể quyền hiện tại.
        // Quyền admin/quản lý chỉ quyết định nội dung được phép xem, không quyết định trang sau khi refresh.
        save('learning', {role:role, lessonIndex:lessonIndex(), currentPage:'lesson:' + lessonIndex()});
      }, 80);
      return out;
    };
  }

  const oldSetRole = phfSetInternalRole;
  if(typeof oldSetRole === 'function'){
    phfSetInternalRole = function(role){
      save(role === 'learner' ? 'phone' : role, {role:role});
      const out = oldSetRole.apply(this, arguments);
      setTimeout(function(){
        if(role === 'learner') save('phone', {role:'learner'});
        else save(role === 'admin' ? 'admin' : 'manager', {role:role});
      }, 120);
      return out;
    };
    window.phfSetInternalRole = phfSetInternalRole;
  }

  const oldShowRoleChooser = phfShowRoleChooser;
  if(typeof oldShowRoleChooser === 'function'){
    phfShowRoleChooser = function(){
      save('role');
      return oldShowRoleChooser.apply(this, arguments);
    };
    window.phfShowRoleChooser = phfShowRoleChooser;
  }

  const oldShowPhone = phfShowLearnerPhoneEntry;
  if(typeof oldShowPhone === 'function'){
    phfShowLearnerPhoneEntry = function(){
      const out = oldShowPhone.apply(this, arguments);
      save('phone', {role:'learner'});
      setTimeout(function(){
        const input = document.getElementById('phfLearnerPhoneInput');
        if(input && !input.__phfRefreshResumeBound){
          input.__phfRefreshResumeBound = true;
          input.addEventListener('input', function(){ save('phone', {role:'learner', phone:cleanPhone(input.value)}); });
          input.addEventListener('change', function(){ save('phone', {role:'learner', phone:cleanPhone(input.value)}); });
        }
      }, 60);
      return out;
    };
    window.phfShowLearnerPhoneEntry = phfShowLearnerPhoneEntry;
  }

  const oldOpenLearner = window.phfOpenLearnerAfterPhone || phfOpenLearnerAfterPhone;
  if(typeof oldOpenLearner === 'function'){
    window.phfOpenLearnerAfterPhone = phfOpenLearnerAfterPhone = function(profile){
      const isNewLearner = !!(profile && profile.__phfIsNewLearner) || localStorage.getItem('phfNewLearnerStart') === '1';
      if(isNewLearner){
        try{ localStorage.removeItem(KEY); }catch(e){}
        try{ current = 1; window.phfCurrentLessonIndex = 1; window.phfCurrentLessonKey = 'lesson:1'; }catch(e){}
      }
      const out = oldOpenLearner.apply(this, arguments);
      setTimeout(function(){
        const idx = isNewLearner ? 1 : lessonIndex();
        save('learning', {role:'learner', lessonIndex:idx, currentPage:'lesson:' + idx, phone:cleanPhone(profile && profile.phone), employeeId:profile && profile.id || ''});
      }, 120);
      return out;
    };
  }

  document.addEventListener('click', function(e){
    const btn = e.target.closest('button,[data-go],[data-intro-next],[data-intro-final],[data-intro-start]');
    if(!btn) return;
    setTimeout(function(){
      if(document.body.classList.contains('phf-intro-active')){
        const idx = typeof window.phfIntroCurrent === 'function' ? window.phfIntroCurrent() : 0;
        save('intro', {introIndex:idx});
        return;
      }
      if(document.getElementById('phfRoleOverlay')) save('role');
      else if(document.getElementById('phfPhoneEntryOverlay')) save('phone', {role:'learner'});
      else {
        const role = getRole();
        const active = document.querySelector('[data-phf-main-nav].active');
        const key = active ? active.getAttribute('data-phf-main-nav') : '';
        if(key === 'reports') save('overview', {role:role, hubTab:'reports'});
        else if(key === 'learning') save('learning', {role:role, lessonIndex:lessonIndex(), currentPage:'lesson:' + lessonIndex(), hubTab:'learning'});
        else if(key === 'profile') save('profile', {role:role, hubTab:'profile'});
        else if(key === 'guide') save('guide', {role:role, hubTab:'guide'});
        else if(key === 'directTrainingTest') save('directTrainingTest', {role:role, hubTab:'directTrainingTest'});
        else save('learning', {role:role, lessonIndex:lessonIndex(), currentPage:'lesson:' + lessonIndex()});
      }
    }, 80);
  }, true);

  function phfHardSaveCurrentBeforeUnload(){
    try{
      const hasRoleOverlay = !!document.getElementById('phfRoleOverlay');
      const hasPhoneOverlay = !!document.getElementById('phfPhoneEntryOverlay');
      const introActive = document.body.classList.contains('phf-intro-active');
      if(introActive){
        const idxIntro = typeof window.phfIntroCurrent === 'function' ? window.phfIntroCurrent() : 0;
        save('intro', {introIndex:idxIntro});
        return;
      }
      if(hasRoleOverlay){ save('role'); return; }
      if(hasPhoneOverlay){ save('phone', {role:'learner'}); return; }
      const learningVisible = !!(document.getElementById('mainLesson') && document.getElementById('phaseStrip') && document.querySelector('#mainLesson .focus-head'));
      if(learningVisible){
        save('learning', {role:getRole(), lessonIndex:lessonIndex(), currentPage:'lesson:' + lessonIndex(), hubTab:'learning'});
        return;
      }
      const active = document.querySelector('[data-phf-main-nav].active');
      const key = active ? active.getAttribute('data-phf-main-nav') : '';
      if(key === 'reports') save('overview', {role:getRole(), hubTab:'reports'});
      else if(key === 'profile') save('profile', {role:getRole(), hubTab:'profile'});
      else if(key === 'guide') save('guide', {role:getRole(), hubTab:'guide'});
      else if(key === 'directTrainingTest') save('directTrainingTest', {role:getRole(), hubTab:'directTrainingTest'});
      else save('learning', {role:getRole(), lessonIndex:lessonIndex(), currentPage:'lesson:' + lessonIndex(), hubTab:'learning'});
    }catch(err){ console.warn('PHF hard refresh save error', err); }
  }

  window.addEventListener('pagehide', phfHardSaveCurrentBeforeUnload, {capture:true});
  window.addEventListener('beforeunload', phfHardSaveCurrentBeforeUnload, {capture:true});
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'hidden') phfHardSaveCurrentBeforeUnload();
  }, {capture:true});

  setTimeout(function(){ restore(); }, 0);
})();


/* PHF Bản 19A: tách hồ sơ/progress theo tài khoản đăng nhập */
(function(){
  function phone(v){ return String(v||'').replace(/[^\d+]/g,'').trim(); }
  function email(v){ return String(v||'').trim().toLowerCase(); }
  function activeEmail(){ try{return email(localStorage.getItem('phfActiveLoginEmail') || localStorage.getItem('phfSimpleTestLoginEmail') || localStorage.getItem('phfLoginEmail') || '');}catch(e){return '';} }
  function activePhone(){ try{return phone(localStorage.getItem('phfLoginPhone') || localStorage.getItem('phfCurrentLearnerPhone') || localStorage.getItem('phfLinkedPhone') || '');}catch(e){return '';} }
  function readProfile(){ try{ return JSON.parse(localStorage.getItem('phfEmployeeProfile') || 'null') || null; }catch(e){ return null; } }
  function clearMismatchProfile(reason){
    try{
      localStorage.removeItem('phfEmployeeProfile');
      localStorage.removeItem('phfEmployeeId');
      localStorage.removeItem('phfRefreshResumeState');
      localStorage.removeItem('phfResumeLessonIndex');
      localStorage.removeItem('phfResumeFromPhone');
      window.currentProfile = null;
      localStorage.setItem('phfLastProfileIsolationReason', reason || 'mismatch');
    }catch(e){}
  }
  function ensureProfileIsolation(){
    var p = readProfile();
    if(!p) return;
    var ap = activePhone();
    var ae = activeEmail();
    var pp = phone(p.phone);
    var pe = email(p.accountEmail || p.email || '');
    if(!ap && pp){ clearMismatchProfile('account-no-phone-profile-has-phone'); return; }
    if(ap && pp && ap !== pp){ clearMismatchProfile('phone-mismatch'); return; }
    if(ae && pe && ae !== pe){ clearMismatchProfile('email-mismatch'); return; }
  }
  function patchFn(name, fallbackToPhoneEntry){
    var old = window[name];
    if(typeof old !== 'function' || old.__phf19a) return;
    var wrapped = function(){
      ensureProfileIsolation();
      try{
        var role = String(localStorage.getItem('phfInternalTestRole') || localStorage.getItem('phfRole') || '').toLowerCase();
        var ap = activePhone();
        if(fallbackToPhoneEntry && role === 'learner' && !ap){
          if(typeof phfShowLearnerPhoneEntry === 'function') return phfShowLearnerPhoneEntry();
        }
      }catch(e){}
      return old.apply(this, arguments);
    };
    wrapped.__phf19a = true;
    window[name] = wrapped;
  }
  function patchAll(){ patchFn('phfGoMyProfile', true); patchFn('phfGoLearning', true); }
  document.addEventListener('DOMContentLoaded', function(){ ensureProfileIsolation(); patchAll(); });
  window.addEventListener('storage', ensureProfileIsolation);
  setTimeout(function(){ ensureProfileIsolation(); patchAll(); }, 200);
  setTimeout(patchAll, 1000);
})();


/* PHF Bản 19B: đồng bộ SĐT hồ sơ học viên với tài khoản đăng nhập */
(function(){
  var ACCOUNT_KEYS = [
    'phfAdminAccountsSafeV18',
    'phfAdminAccountsV17F',
    'phfAdminAccountsV17C',
    'phfAdminAccountsV17D',
    'phfAdminAccountsV17B',
    'phfAdminAccountsV1'
  ];
  function phone(v){ return String(v||'').replace(/[^\d+]/g,'').trim(); }
  function email(v){ return String(v||'').trim().toLowerCase(); }
  function readJSON(k){ try{return JSON.parse(localStorage.getItem(k)||'[]')||[]}catch(e){return []} }
  function writeJSON(k,v){ try{localStorage.setItem(k,JSON.stringify(v||[]))}catch(e){} }
  function activeEmail(){
    try{
      return email(
        localStorage.getItem('phfActiveLoginEmail') ||
        localStorage.getItem('phfSimpleTestLoginEmail') ||
        localStorage.getItem('phfLoginEmail') ||
        ''
      );
    }catch(e){return ''}
  }
  function currentPhone(){
    var p = '';
    try{
      p = phone(
        localStorage.getItem('phfLoginPhone') ||
        localStorage.getItem('phfCurrentLearnerPhone') ||
        localStorage.getItem('phfLinkedPhone') ||
        ''
      );
      if(p) return p;
      var profile = JSON.parse(localStorage.getItem('phfEmployeeProfile') || 'null');
      if(profile && profile.phone) return phone(profile.phone);
    }catch(e){}
    try{
      if(window.currentProfile && window.currentProfile.phone) return phone(window.currentProfile.phone);
    }catch(e){}
    return '';
  }
  function findWritableAccountList(){
    for(var i=0;i<ACCOUNT_KEYS.length;i++){
      var list = readJSON(ACCOUNT_KEYS[i]);
      if(Array.isArray(list) && list.length) return {key:ACCOUNT_KEYS[i], list:list};
    }
    return {key:'phfAdminAccountsSafeV18', list:[]};
  }
  function syncPhoneToAccount(rawPhone, source){
    var p = phone(rawPhone);
    var em = activeEmail();
    if(!p || !em) return false;

    var pack = findWritableAccountList();
    var list = pack.list;
    var idx = -1;
    for(var i=0;i<list.length;i++){
      if(email(list[i] && list[i].email) === em){ idx = i; break; }
    }
    if(idx < 0) return false;

    if(phone(list[idx].phone) === p) return true;
    list[idx].phone = p;
    list[idx].updatedAt = new Date().toISOString();
    list[idx].phoneSyncedFrom = source || 'learner-phone-entry';
    writeJSON(pack.key, list);

    // Mirror into the current canonical safe key so Quản trị screen shows it immediately.
    if(pack.key !== 'phfAdminAccountsSafeV18'){
      var safe = readJSON('phfAdminAccountsSafeV18');
      var sidx = -1;
      for(var j=0;j<safe.length;j++){
        if(email(safe[j] && safe[j].email) === em){ sidx = j; break; }
      }
      if(sidx >= 0){
        safe[sidx].phone = p;
        safe[sidx].updatedAt = new Date().toISOString();
      }else{
        safe = list;
      }
      writeJSON('phfAdminAccountsSafeV18', safe);
    }

    try{
      localStorage.setItem('phfLoginPhone', p);
      localStorage.setItem('phfCurrentLearnerPhone', p);
      localStorage.setItem('phfLinkedPhone', p);
      var profile = JSON.parse(localStorage.getItem('phfEmployeeProfile') || 'null') || {};
      profile.phone = p;
      profile.id = 'test-phone-' + p;
      profile.accountEmail = em;
      localStorage.setItem('phfEmployeeProfile', JSON.stringify(profile));
      localStorage.setItem('phfEmployeeId', profile.id);
      if(window.currentProfile) {
        window.currentProfile.phone = p;
        window.currentProfile.id = profile.id;
        window.currentProfile.accountEmail = em;
      }
    }catch(e){}
    return true;
  }
  function syncFromCurrent(source){
    var p = currentPhone();
    if(p) syncPhoneToAccount(p, source || 'current-session');
  }

  // Khi hồ sơ theo SĐT được mở thành công, ghi ngược SĐT vào tài khoản đang đăng nhập.
  function patchFunction(name){
    var old = window[name];
    if(typeof old !== 'function' || old.__phf19b) return;
    var wrapped = function(){
      var result = old.apply(this, arguments);
      try{
        var arg0 = arguments && arguments.length ? arguments[0] : null;
        var p = phone(arg0 && (arg0.phone || arg0.mobile || arg0.sdt));
        if(p) syncPhoneToAccount(p, name);
        setTimeout(function(){ syncFromCurrent(name + ':after'); }, 60);
        setTimeout(function(){ syncFromCurrent(name + ':after2'); }, 350);
      }catch(e){}
      return result;
    };
    wrapped.__phf19b = true;
    window[name] = wrapped;
  }
  function patchAll(){
    patchFunction('phfOpenLearnerAfterPhone');
    patchFunction('phfSetLearnerProfileFromRow');
    patchFunction('phfFindLearnerByPhone');
    patchFunction('phfGoLearning');
    patchFunction('phfGoMyProfile');
  }

  // Bắt thao tác ở modal nhập SĐT: sau khi bấm Tiếp tục học/Tạo hồ sơ mới thì sync lại.
  document.addEventListener('click', function(ev){
    var t = ev.target;
    var txt = (t && (t.textContent || t.value) || '').toLowerCase();
    if(txt.indexOf('tiếp tục học') >= 0 || txt.indexOf('tạo hồ sơ') >= 0 || txt.indexOf('lưu') >= 0){
      setTimeout(function(){ syncFromCurrent('click:' + txt.slice(0,20)); }, 120);
      setTimeout(function(){ syncFromCurrent('click-late'); }, 700);
    }
  }, true);

  window.phfSyncCurrentPhoneToAccount = function(){ return syncFromCurrent('manual'); };

  document.addEventListener('DOMContentLoaded', function(){ patchAll(); setTimeout(function(){syncFromCurrent('dom')}, 500); });
  window.addEventListener('storage', function(){ setTimeout(function(){syncFromCurrent('storage')}, 80); });
  setTimeout(function(){ patchAll(); syncFromCurrent('boot'); }, 200);
  setTimeout(function(){ patchAll(); syncFromCurrent('boot2'); }, 1200);
  setInterval(function(){ patchAll(); syncFromCurrent('interval'); }, 2500);
})();

