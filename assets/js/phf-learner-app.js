/*
 * PHF Training Hub - Bản 25
 * Tiếp tục tách module: logic kiểm tra/thi chuyển sang phf-quiz-engine.js.
 * File này giữ nguyên luồng học viên từ Bản 23: bài học, điều hướng học tập,
 * trạng thái màn học, phản hồi/toast và các helper đang phục vụ khu học viên.
 * Không chứa thay đổi Supabase/schema/server.
 */

const STAGES = [["GĐ1", "Hội nhập"], ["GĐ2", "CSKH & Kỹ năng"], ["GĐ3", "Quy trình"], ["GĐ4", "Thực hành"], ["GĐ5", "Đánh giá"]];
window.PHF_STAGES = STAGES;
const LESSONS = Array.isArray(window.PHF_LESSONS_NEW_SALES)
  ? window.PHF_LESSONS_NEW_SALES
  : (Array.isArray(window.PHF_LESSONS) ? window.PHF_LESSONS : []);
window.PHF_LESSONS = LESSONS
let current = 0;
function esc(s){return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

// PHF custom feedback helpers: use these instead of default browser alert/confirm
(function(){
  function ensureToastWrap(){
    let wrap=document.getElementById('phfToastWrap');
    if(!wrap){wrap=document.createElement('div');wrap.id='phfToastWrap';wrap.className='phf-toast-wrap';document.body.appendChild(wrap);} return wrap;
  }
  window.phfToast=function(type,title,message,timeout,key){
    const wrap=ensureToastWrap();
    const toastKey = key || '';
    Array.from(wrap.children).forEach(function(child){
      if(!toastKey || child.dataset.toastKey !== toastKey){
        if(child.__phfToastTimer) clearTimeout(child.__phfToastTimer);
        child.remove();
      }
    });
    let el = toastKey ? wrap.querySelector('[data-toast-key="'+toastKey+'"]') : null;
    if(!el){
      el=document.createElement('div');
      if(toastKey) el.dataset.toastKey = toastKey;
      wrap.appendChild(el);
    }
    if(el.__phfToastTimer){ clearTimeout(el.__phfToastTimer); el.__phfToastTimer=null; }
    el.className='phf-toast '+(type||'info');
    el.style.opacity='1';
    el.style.transform='translateY(0)';
    el.innerHTML='<b>'+esc(title||'Thông báo')+'</b>'+(message?'<small>'+esc(message)+'</small>':'');
    const closeAfter = (timeout===0) ? 0 : (timeout || 3200);
    if(closeAfter){
      el.__phfToastTimer = setTimeout(function(){
        el.style.opacity='0';
        el.style.transform='translateY(8px)';
        setTimeout(function(){ if(el && el.parentNode) el.remove(); },220);
      }, closeAfter);
    }
    return el;
  };
  window.phfToastClear=function(key){
    const wrap=document.getElementById('phfToastWrap');
    if(!wrap || !key) return;
    const el=wrap.querySelector('[data-toast-key="'+key+'"]');
    if(!el) return;
    if(el.__phfToastTimer) clearTimeout(el.__phfToastTimer);
    el.style.opacity='0';
    el.style.transform='translateY(8px)';
    setTimeout(function(){ if(el && el.parentNode) el.remove(); },220);
  };
  window.phfModal=function(type,title,message){
    let backdrop=document.getElementById('phfModalBackdrop');
    if(!backdrop){
      backdrop=document.createElement('div');backdrop.id='phfModalBackdrop';backdrop.className='phf-modal-backdrop';
      backdrop.innerHTML='<div class="phf-modal"><h3 id="phfModalTitle"></h3><p id="phfModalMessage"></p><div class="phf-modal-actions"><button type="button" class="btn btn-primary" id="phfModalOk">Đã hiểu</button></div></div>';
      document.body.appendChild(backdrop);
      backdrop.querySelector('#phfModalOk').addEventListener('click',function(){backdrop.classList.remove('show');});
      backdrop.addEventListener('click',function(e){if(e.target===backdrop) backdrop.classList.remove('show');});
    }
    backdrop.querySelector('#phfModalTitle').textContent=title||'Thông báo';
    backdrop.querySelector('#phfModalMessage').textContent=message||'';
    backdrop.classList.add('show');
  };
  window.phfSetButtonLoading=function(btn,isLoading,text){
    if(!btn) return;
    if(isLoading){btn.dataset.oldText=btn.textContent;btn.textContent=text||'Đang xử lý';btn.classList.add('phf-btn-loading');btn.disabled=true;}
    else{btn.textContent=btn.dataset.oldText||text||btn.textContent;btn.classList.remove('phf-btn-loading');btn.disabled=false;delete btn.dataset.oldText;}
  };
})();

function stageFirstIndex(stage){return LESSONS.findIndex(x=>x.stage===stage)}


/* PATCH UI ENHANCER 2026-06-26
   Chuẩn hóa card/form/quiz sau mỗi lần render. Không đổi LESSONS gốc. */
function enhanceTrainingUI(){
  const root = document.getElementById('mainLesson');
  if(!root) return;

  // Tách nhãn xanh kiểu "Phần 1CSKH" hoặc "Phần 1 KNBH" thành 2 dòng rõ hơn.
  root.querySelectorAll('.row-label').forEach(function(el){
    if(el.dataset.phfLabelDone === '1') return;
    const raw = (el.textContent || '').replace(/\s+/g,' ').trim();
    const m = raw.match(/^(Phần\s*\d+)\s*(.*)$/i);
    if(m){
      el.innerHTML = '<span class="phf-label-top">' + esc(m[1]) + '</span><span class="phf-label-main">' + esc(m[2] || '') + '</span>';
      el.dataset.phfLabelDone = '1';
    }
  });

  // Làm đẹp radio quiz: đưa đáp án thành từng card dọc, kể cả HTML gốc đang để inline.
  const quizContainers = root.querySelectorAll('.step2-question,.question-block,.quiz-card,.b4-quiz');
  quizContainers.forEach(function(container){
    const radios = Array.from(container.querySelectorAll('input[type="radio"]'));
    if(!radios.length) return;

    radios.forEach(function(radio){
      if(radio.closest('.phf-quiz-option')) return;

      const label = document.createElement('label');
      label.className = 'phf-quiz-option';
      radio.parentNode.insertBefore(label, radio);
      label.appendChild(radio);

      let node = label.nextSibling;
      let guard = 0;
      while(node && guard < 30){
        const next = node.nextSibling;
        if(node.nodeType === 1){
          if(node.matches && (node.matches('input[type="radio"], button, .btn, .phf-quiz-option'))) break;
          if(['DIV','P','H1','H2','H3','H4','TABLE','UL','OL','SECTION'].includes(node.tagName)) break;
        }
        label.appendChild(node);
        if(node.nodeType === 1 && node.tagName === 'BR') break;
        node = next;
        guard++;
      }

      if(!label.textContent.replace(/\s+/g,'').trim()){
        label.appendChild(document.createTextNode(' Chọn đáp án'));
      }
    });
  });

  // Highlight đáp án đang chọn.
  root.querySelectorAll('.phf-quiz-option').forEach(function(label){
    const input = label.querySelector('input[type="radio"]');
    label.classList.toggle('is-selected', !!(input && input.checked));
  });

  // Đánh dấu các phần đang hiển thị đáp án sẵn để nhìn rõ đây là ôn nhanh/chưa phải quiz tương tác.
  root.querySelectorAll('.question-block,.quiz-card,.b4-quiz,.scenario,.callout,.b4-callout').forEach(function(block){
    const text = (block.textContent || '').replace(/\s+/g,' ');
    if(/Đáp án đúng|Đáp án\s*:/i.test(text) && !block.querySelector('input[type="radio"]')){
      block.classList.add('phf-answer-reference');
    }
  });

  // Chống vỡ layout form/input trong nội dung gốc.
  root.querySelectorAll('.original-content input:not([type="radio"]):not([type="checkbox"]), .original-content select, .original-content textarea').forEach(function(el){
    el.classList.add('phf-control');
    if(el.tagName === 'TEXTAREA') el.classList.add('phf-textarea');
  });

  // Gợi ý card cho khu góp ý có textarea/checkbox.
  root.querySelectorAll('.original-content').forEach(function(area){
    if(area.dataset.phfFeedbackDone === '1') return;
    if(area.querySelector('textarea') && area.querySelector('input[type="checkbox"]')){
      area.classList.add('phf-form-polished');
    }
    area.dataset.phfFeedbackDone = '1';
  });
}

document.addEventListener('change', function(e){
  if(!e.target.matches('input[type="radio"]')) return;
  const container = e.target.closest('.step2-question,.question-block,.quiz-card,.b4-quiz,#mainLesson');
  if(!container) return;
  container.querySelectorAll('.phf-quiz-option').forEach(function(label){
    const input = label.querySelector('input[type="radio"]');
    label.classList.toggle('is-selected', !!(input && input.checked));
  });
});

function phfPad2(n){ return String(n).padStart(2,'0'); }
function phfParseDateInput(value){
  if(!value) return null;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return null;
  return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
}
function phfFormatDate(d){ return phfPad2(d.getDate()) + '/' + phfPad2(d.getMonth()+1); }
function phfFormatDateFull(d){ return d ? phfPad2(d.getDate()) + '/' + phfPad2(d.getMonth()+1) + '/' + d.getFullYear() : ''; }
function phfFormatDateTimeVN(value){
  if(!value) return '-';
  if(value instanceof Date && !isNaN(value)) return phfFormatDateFull(value) + ' ' + phfPad2(value.getHours()) + ':' + phfPad2(value.getMinutes());
  const raw = String(value).trim();
  if(!raw || raw === '-') return '-';
  const d = new Date(raw);
  if(!isNaN(d.getTime())) return phfFormatDateFull(d) + ' ' + phfPad2(d.getHours()) + ':' + phfPad2(d.getMinutes());
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m) return m[3] + '/' + m[2] + '/' + m[1];
  return raw;
}
function phfIsoDate(d){
  if(!d) return '';
  return d.getFullYear() + '-' + phfPad2(d.getMonth()+1) + '-' + phfPad2(d.getDate());
}
function phfFormatRange(start,end){
  if(!start || !end) return '';
  if(start.getTime() === end.getTime()) return phfFormatDate(start);
  return phfFormatDate(start) + ' - ' + phfFormatDate(end);
}
function phfFormatRangeFull(start,end){
  if(!start || !end) return '';
  if(start.getTime() === end.getTime()) return phfFormatDateFull(start);
  return phfFormatDateFull(start) + ' - ' + phfFormatDateFull(end);
}
function phfAddDays(d, days){ const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate()+days); return x; }
function phfAddMonths(d, months){ const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setMonth(x.getMonth()+months); return x; }
function phfGetSavedProfile(){ try { return JSON.parse(localStorage.getItem('phfEmployeeProfile') || '{}') || {}; } catch(e){ return {}; } }
function phfGetStudyStartValue(){
  const el = document.getElementById('studyStartDate');
  const profile = phfGetSavedProfile();
  return (el && el.value) || localStorage.getItem('phfStudyStartDate') || profile.studyStartDate || '';
}
function phfBuildTimeline(){
  const start = phfParseDateInput(phfGetStudyStartValue());
  if(!start) return null;
  const endExclusive = phfAddMonths(start, 2);
  const end = phfAddDays(endExclusive, -1);
  const g1Start = start, g1End = start;
  const g2Start = phfAddDays(start, 1), g2End = phfAddDays(start, 5);
  const g3Start = phfAddDays(start, 6), g3End = phfAddDays(start, 12);
  const g5Start = phfAddDays(end, -13), g5End = end;
  const g4Start = phfAddDays(g3End, 1), g4End = phfAddDays(g5Start, -1);
  const ranges = [
    {start:g1Start,end:g1End,note:'1 ngày'},
    {start:g2Start,end:g2End,note:'5 ngày'},
    {start:g3Start,end:g3End,note:'7 ngày'},
    {start:g4Start,end:g4End,note:'Thực hành'},
    {start:g5Start,end:g5End,note:'2 tuần cuối'}
  ];
  const today = new Date();
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  let currentStage = 0;
  ranges.forEach(function(r,i){ if(t >= r.start.getTime() && t <= r.end.getTime()) currentStage = i; if(t > r.end.getTime()) currentStage = i; });
  if(t < ranges[0].start.getTime()) currentStage = 0;
  return {start:start,end:end,ranges:ranges,currentStage:currentStage};
}
function phfPrefillInfoForm(){
  const profile = phfGetSavedProfile();
  const fields = ['fullName','dob','phone','position','department','branch','studyStartDate'];
  fields.forEach(function(id){
    const el = document.getElementById(id);
    if(!el || el.dataset.phfPrefilled === '1') return;
    const key = id === 'dob' ? 'birthday' : id;
    const value = id === 'studyStartDate' ? (localStorage.getItem('phfStudyStartDate') || profile.studyStartDate || '') : (profile[key] || '');
    if(value) el.value = value;
    el.dataset.phfPrefilled = '1';
  });
}

function phfInfoFormValue(id){
  const el = document.getElementById(id);
  return el ? String(el.value || '').trim() : '';
}
function phfSetInfoFieldError(id, message){
  const el = document.getElementById(id);
  if(!el) return;
  const field = el.closest('.field') || el.parentElement;
  if(field) field.classList.add('phf-field-error');
  let msg = field ? field.querySelector('.phf-field-error-text') : null;
  if(!msg && field){
    msg = document.createElement('div');
    msg.className = 'phf-field-error-text';
    field.appendChild(msg);
  }
  if(msg) msg.textContent = message || 'Vui lòng bổ sung thông tin.';
}
function phfClearInfoErrors(){
  document.querySelectorAll('#mainLesson .phf-field-error').forEach(function(el){ el.classList.remove('phf-field-error'); });
  document.querySelectorAll('#mainLesson .phf-field-error-text').forEach(function(el){ el.remove(); });
  const box = document.getElementById('phfInfoFormErrorBox');
  if(box) box.remove();
}
function phfSaveInfoFormToProfile(){
  const profile = phfGetSavedProfile();
  const cleanPhone = phfPhoneClean(phfInfoFormValue('phone'));
  profile.fullName = phfInfoFormValue('fullName');
  profile.phone = cleanPhone;
  profile.position = phfInfoFormValue('position');
  profile.department = phfInfoFormValue('department');
  profile.branch = phfInfoFormValue('branch');
  profile.studyStartDate = phfInfoFormValue('studyStartDate');
  profile.birthday = phfInfoFormValue('dob') || profile.birthday || '';
  profile.programId = profile.programId || 'new_sales';
  profile.id = profile.id || ('learner-' + (cleanPhone || Date.now()));
  try{
    localStorage.setItem('phfEmployeeId', profile.id);
    localStorage.setItem('phfEmployeeProfile', JSON.stringify(profile));
    localStorage.setItem('phfStudyStartDate', profile.studyStartDate || '');
  }catch(e){}
  return profile;
}
function phfValidateInfoForm(){
  phfClearInfoErrors();
  const checks = [
    ['fullName','Vui lòng nhập họ tên.'],
    ['phone','Vui lòng nhập số điện thoại.'],
    ['position','Vui lòng chọn vị trí đào tạo/làm việc.'],
    ['department','Vui lòng chọn bộ phận.'],
    ['branch','Vui lòng chọn chi nhánh/bộ phận.'],
    ['studyStartDate','Vui lòng chọn ngày bắt đầu học.']
  ];
  let ok = true;
  checks.forEach(function(item){
    const id = item[0], msg = item[1];
    const val = phfInfoFormValue(id);
    if(!val || (id === 'fullName' && val.toLowerCase() === 'học viên mới')){ ok = false; phfSetInfoFieldError(id, msg); }
  });
  const phone = phfPhoneClean(phfInfoFormValue('phone'));
  if(phone && phone.length < 9){ ok = false; phfSetInfoFieldError('phone','Số điện thoại chưa hợp lệ.'); }
  if(!ok){
    const body = document.querySelector('#mainLesson .form-body');
    if(body && !document.getElementById('phfInfoFormErrorBox')){
      body.insertAdjacentHTML('afterbegin','<div id="phfInfoFormErrorBox" class="phf-form-error-box">Vui lòng điền đầy đủ các trường bắt buộc trước khi vào Bước 1.</div>');
    }
    const first = document.querySelector('#mainLesson .phf-field-error input, #mainLesson .phf-field-error select');
    if(first) try{ first.focus(); }catch(e){}
    return false;
  }
  phfSaveInfoFormToProfile();
  return true;
}

document.addEventListener('change', function(e){
  if(e.target && ['fullName','dob','phone','position','department','branch','studyStartDate'].includes(e.target.id)){
    phfClearInfoErrors();
    phfSaveInfoFormToProfile();
    if(e.target.id === 'studyStartDate') render();
  }
});

function phfUserRole(){
  try{
    if(typeof window.phfGetSessionRole === 'function'){
      const role = String(window.phfGetSessionRole() || '').toLowerCase();
      if(['admin','manager','learner'].includes(role)) return role;
    }
  }catch(e){}
  return 'learner';
}
function phfIsAdminMode(){ return phfUserRole() === 'admin'; }
function phfIsManagerMode(){ return phfUserRole() === 'manager'; }
function phfCanEditEvaluation(){ return phfUserRole() === 'admin' || phfUserRole() === 'manager'; }
function phfRoleLabel(){
  const role = phfUserRole();
  if(role === 'admin') return 'Quản trị · toàn quyền';
  if(role === 'manager') return 'Trưởng ca / CHT / Quản lý';
  return 'Học viên';
}
function phfTrainingSessionKey(){
  let role = 'learner';
  try{ role = phfUserRole(); }catch(e){}
  let profile = {};
  try{ profile = (typeof phfCurrentEmployeeProfile === 'function' ? phfCurrentEmployeeProfile() : {}) || {}; }catch(e){}
  let email = '';
  try{
    email = String(
      localStorage.getItem('phfSimpleTestLoginEmail') ||
      localStorage.getItem('phfLoginEmail') ||
      profile.accountEmail || ''
    ).toLowerCase().trim();
  }catch(e){}
  const dataScope = role === 'learner' ? 'learner' : 'staff';
  return [
    dataScope,
    role,
    email,
    String(profile.id||''),
    String(profile.phone||'').replace(/\D/g,'')
  ].join('|');
}

function phfResetTrainingRuntime(reason){
  window.__phfTrainingDataGeneration = (window.__phfTrainingDataGeneration || 0) + 1;
  window.__phfTrainingDataActiveSessionKey = '';
  window.__phfTrainingDataScopeKey = '';
  window.__phfTrainingDataLoadedAt = 0;
  window.__phfTrainingDataPromise = null;
  window.__phfTrainingDataPromiseScopeKey = '';
  window.__phfTrainingDataLatestRequestId = 0;
  window.__phfLocalData = null;
  window.__phfEvalReadFresh = false;
  window.__phfEvalRenderedScope = '';
  window.__phfEvalProfileSelectedId = '';
  window.__phfEvalRenderToken = (window.__phfEvalRenderToken || 0) + 1;
  window.__phfOverviewDataReady = false;
  window.__phfOverviewDataPromise = null;
  if(reason) console.info('[PHF data scope reset]', reason);
  return true;
}
window.phfResetTrainingRuntime = phfResetTrainingRuntime;

async function phfRefreshTrainingData(options){
  options = options || {};
  const force = !!options.force;

  try{
    if(typeof window.phfWhenAuthReady==='function'){
      const authUser = await window.phfWhenAuthReady();
      if(!authUser) return false;
    }
  }catch(e){
    return false;
  }

  let role = 'learner';
  try{ role = phfUserRole(); }catch(e){}
  let profile = {};
  try{ profile = (typeof phfCurrentEmployeeProfile === 'function' ? phfCurrentEmployeeProfile() : {}) || {}; }catch(e){}

  const sessionKey = phfTrainingSessionKey();
  const dataScope = role === 'learner' ? 'learner' : 'staff';

  if(window.__phfTrainingDataActiveSessionKey !== sessionKey){
    window.__phfTrainingDataGeneration = (window.__phfTrainingDataGeneration || 0) + 1;
    window.__phfTrainingDataActiveSessionKey = sessionKey;
    window.__phfTrainingDataScopeKey = '';
    window.__phfTrainingDataLoadedAt = 0;
    window.__phfTrainingDataPromise = null;
    window.__phfTrainingDataPromiseScopeKey = '';
    window.__phfTrainingDataLatestRequestId = 0;
    window.__phfLocalData = null;
    window.__phfEvalReadFresh = false;
    window.__phfEvalRenderedScope = '';
    window.__phfEvalProfileSelectedId = '';
    window.__phfOverviewDataReady = false;
    window.__phfOverviewDataPromise = null;
  }

  const scopeKey = sessionKey;
  const now = Date.now();
  if(!force && window.__phfTrainingDataLoadedAt && window.__phfTrainingDataScopeKey === scopeKey &&
     now - window.__phfTrainingDataLoadedAt < 15000 && window.__phfLocalData){
    return true;
  }
  if(window.__phfTrainingDataPromise && window.__phfTrainingDataPromiseScopeKey === scopeKey){
    return window.__phfTrainingDataPromise;
  }

  const params = new URLSearchParams();
  params.set('scope', dataScope);
  if(role === 'learner'){
    if(profile.id) params.set('employeeId', String(profile.id));
    if(profile.phone) params.set('phone', String(profile.phone).replace(/\D/g,''));
  }

  const requestGeneration = window.__phfTrainingDataGeneration || 0;
  const requestId = (window.__phfTrainingDataLatestRequestId || 0) + 1;
  window.__phfTrainingDataLatestRequestId = requestId;

  const request = (async function(){
    const perfStartedAt = (window.performance && typeof window.performance.now === 'function') ? window.performance.now() : Date.now();
    try{
      let res = await fetch('/api/data?' + params.toString(), {cache:'no-store',credentials:'include'});
      const rawText = await res.text().catch(function(){ return ''; });
      let json = {};
      try{ json = rawText ? JSON.parse(rawText) : {}; }catch(parseErr){ json = {}; }

      if(res.status===401){
        try{
          if(typeof window.phfHandleAuthExpired==='function'){
            const recovered = await window.phfHandleAuthExpired();
            if(recovered){
              res = await fetch('/api/data?' + params.toString(), {cache:'no-store',credentials:'same-origin'});
              const retryRawText = await res.text().catch(function(){ return ''; });
              try{ json = retryRawText ? JSON.parse(retryRawText) : {}; }catch(parseErr){ json = {}; }
            }
          }
        }catch(e){}
      }

      if(res.status===401) return false;

      if(requestGeneration !== window.__phfTrainingDataGeneration ||
         sessionKey !== window.__phfTrainingDataActiveSessionKey ||
         requestId !== window.__phfTrainingDataLatestRequestId){
        return false;
      }

      const perfEndedAt = (window.performance && typeof window.performance.now === 'function') ? window.performance.now() : Date.now();
      const perfInfo = {
        endpoint: '/api/data',
        scope: dataScope,
        role: role,
        status: res.status,
        ok: res.ok,
        durationMs: Math.round(perfEndedAt - perfStartedAt),
        responseBytes: typeof rawText === 'string' ? rawText.length : 0,
        measuredAt: new Date().toISOString()
      };
      window.__phfLastDataTiming = perfInfo;
      console.info('[PHF performance] /api/data', perfInfo);

      if(res.ok && json){
        window.__phfLocalData = json.data || json;
        window.__phfTrainingDataLoadedAt = Date.now();
        window.__phfTrainingDataScopeKey = scopeKey;
        return true;
      }
    }catch(err){
      const perfEndedAt = (window.performance && typeof window.performance.now === 'function') ? window.performance.now() : Date.now();
      const perfInfo = {
        endpoint: '/api/data',
        scope: dataScope,
        role: role,
        status: 0,
        ok: false,
        durationMs: Math.round(perfEndedAt - perfStartedAt),
        responseBytes: 0,
        measuredAt: new Date().toISOString(),
        error: String(err && err.message || err || 'Unknown error')
      };
      window.__phfLastDataTiming = perfInfo;
      console.info('[PHF performance] /api/data', perfInfo);
      console.warn('PHF refresh data error', err);
    }
    return false;
  })();

  window.__phfTrainingDataPromise = request;
  window.__phfTrainingDataPromiseScopeKey = scopeKey;
  try{ return await request; }
  finally{
    if(window.__phfTrainingDataPromise === request){
      window.__phfTrainingDataPromise = null;
      window.__phfTrainingDataPromiseScopeKey = '';
    }
  }
}
function phfTodayOnly(){ const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function phfGateInfo(l){
  // Bản 25.1: Admin/Trưởng ca được mở nhanh bài kiểm tra để test, học viên vẫn đi theo khóa tuần tự.
  if(!l || phfCanEditEvaluation()) return null;
  const title = ((l.title || '') + ' ' + (l.nav || '') + ' ' + (l.sub || '')).toLowerCase();
  let type = '';
  let openDate = null;
  const timeline = phfBuildTimeline();
  if(l.stage === 1 && /bài kiểm tra cuối bước 2|bài kiểm tra tổng hợp|20 câu/.test(title)){
    type = 'Bài kiểm tra cuối Bước 2';
    openDate = timeline ? timeline.ranges[1].end : null;
  } else if(l.stage === 2 && /kiểm tra.*bước 3|bài kiểm tra.*bước 3/.test(title)){
    type = 'Bài kiểm tra Bước 3';
    openDate = timeline ? timeline.ranges[2].end : null;
  } else if(l.stage === 3 && /kiểm tra cuối bước 4|bài kiểm tra cuối bước 4/.test(title)){
    type = 'Bài kiểm tra cuối Bước 4';
    openDate = timeline ? phfAddDays(timeline.ranges[3].end, -2) : null;
  } else if(l.stage === 4){
    type = 'GĐ5 · Đánh giá và hồ sơ';
    openDate = timeline ? timeline.ranges[4].start : null;
  }
  if(!type) return null;
  if(!timeline || !openDate){
    return {type:type, reason:'missing-start', openDate:null};
  }
  const today = phfTodayOnly();
  if(today.getTime() < openDate.getTime()){
    return {type:type, reason:'too-early', openDate:openDate};
  }
  return null;
}
function phfRenderLock(l, gate){
  const dateText = gate.openDate ? phfFormatDate(gate.openDate) : 'sau khi nhập ngày bắt đầu học';
  const help = gate.reason === 'missing-start'
    ? 'Anh/chị cần nhập “Ngày bắt đầu học” ở màn thông tin người học để hệ thống tính đúng thời điểm mở bài.'
    : 'Nội dung này được khóa theo thời gian để người học có đủ thời gian học, quan sát và thực hành trước khi làm bài.';
  return `<section class="focus-head"><div class="chip">${esc(l.badge || 'Đào tạo nội bộ')}</div><h2>${esc(l.title)}</h2><p>${esc(l.lead || '')}</p></section><section class="focus-body"><div class="phf-lock-panel"><div class="lock-badge">Chưa đến thời gian mở</div><h3>${esc(gate.type)} chưa mở</h3><p>${help}</p><p>Thời điểm mở dự kiến: <span class="lock-date">${esc(dateText)}</span>.</p><ul><li>Vui lòng hoàn thành nội dung học trong giai đoạn hiện tại.</li><li>Khi đến thời gian mở, bài kiểm tra/hồ sơ sẽ hiển thị đầy đủ.</li><li>Đạt từ 80/100 điểm mới được chuyển sang phần tiếp theo.</li></ul></div><div class="actions"><button class="btn btn-soft" onclick="go(current-1)" ${current===0?'disabled':''}>← Quay lại</button><button class="btn btn-primary" onclick="go(1)">Cập nhật ngày bắt đầu học</button></div></section>`;
}
function phfFindLessonIndex(pattern){
  const re = new RegExp(pattern, 'i');
  return LESSONS.findIndex(function(x){ return re.test((x.title||'') + ' ' + (x.nav||'') + ' ' + (x.sub||'')); });
}
/* PHF Bản 27: phần đánh giá / hồ sơ đánh giá / báo cáo đào tạo được tách sang assets/js/phf-evaluation.js */

/* PHF PATCH 2026-07-05: Khi chuyển bài/chuyển khu, đưa người học đến ĐẦU NỘI DUNG CHÍNH.
   Không kéo về đỉnh toàn trang nữa, vì trên máy tính/điện thoại sẽ làm người dùng phải nhìn lại logo, thanh giai đoạn và thanh trạng thái.
   Mốc ưu tiên là #mainLesson: nơi bắt đầu bài/khu đang xem. */
function phfScrollToPageTop(){
  const anchor = document.querySelector('#mainLesson') || document.querySelector('.layout') || document.querySelector('.app');
  const resetInnerScroll = function(){
    [
      document.querySelector('.todo-panel'),
      document.querySelector('.right-panel'),
      document.querySelector('.eval-admin-main'),
      document.querySelector('.focus-body')
    ].filter(Boolean).forEach(function(el){
      try{ if(el.scrollTop) el.scrollTop = 0; }catch(e){}
    });
  };
  const run = function(){
    resetInnerScroll();
    if(!anchor) return;
    try{
      const rect = anchor.getBoundingClientRect();
      const currentY = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
      const top = Math.max(0, currentY + rect.top - 10);
      window.scrollTo({top:top,left:0,behavior:'auto'});
    }catch(e){
      try{ anchor.scrollIntoView({block:'start', inline:'nearest', behavior:'auto'}); }catch(_){}
    }
  };
  run();
  requestAnimationFrame(run);
  setTimeout(run, 80);
}



/* PHF PATCH 2026-07-08: Cam kết bảo mật thông tin + chặn qua bài khi thiếu xác nhận bắt buộc. */
function phfNotice(type, title, message){
  if(window.phfToast) window.phfToast(type || 'info', title || 'Thông báo', message || '', 4200, 'phf-required-flow');
  else alert([title, message].filter(Boolean).join('\n'));
}
function phfDigits(v){ return String(v || '').replace(/\D+/g,''); }
function phfTodayISO(){
  const d = new Date();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function phfFormatVNDate(iso){
  if(!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}
function phfSplitDate(iso){
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? {day:m[3], month:m[2], year:m[1]} : {day:'', month:'', year:''};
}
function phfSetStatus(id, text, kind){
  const el = document.getElementById(id);
  if(!el) return;
  el.textContent = text || '';
  el.className = 'phf-bmtt-status phf-bmtt-screen-only ' + (kind || '');
}
function phfCurrentProfileForForms(){
  try{
    const saved = JSON.parse(localStorage.getItem('phfEmployeeProfile') || '{}');
    const val = function(id){ const el = document.getElementById(id); return el ? (el.value || '').trim() : ''; };
    return {
      fullName: val('fullName') || saved.fullName || '',
      birthday: val('dob') || saved.birthday || '',
      phone: phfDigits(val('phone') || saved.phone || ''),
      department: val('department') || saved.department || '',
      branch: val('branch') || saved.branch || '',
      position: val('position') || saved.position || 'Nhân viên bán hàng',
      studyStartDate: val('studyStartDate') || saved.studyStartDate || ''
    };
  }catch(e){ return {}; }
}
function phfPrefillBMTTForm(force){
  const paper = document.getElementById('phfBmtPaper');
  if(!paper) return;
  const profile = phfCurrentProfileForForms();
  const put = function(id, val){ const el = document.getElementById(id); if(el && (force || !el.value) && val) el.value = val; };
  put('phfBmtFullName', profile.fullName);
  put('phfBmtDob', profile.birthday);
  put('phfBmtPhone', profile.phone);
  put('phfBmtSignPhone', profile.phone);
  put('phfBmtPosition', profile.position || profile.department);
  put('phfBmtBranch', profile.branch || profile.department);
  put('phfBmtSignName', profile.fullName);
  put('phfBmtConfirmDate', phfTodayISO());
  const d = phfSplitDate(document.getElementById('phfBmtConfirmDate')?.value || phfTodayISO());
  put('phfBmtDay', d.day); put('phfBmtMonth', d.month); put('phfBmtYear', d.year);
  phfUpdateBMTTPrintFields();
  if(force) phfSetStatus('phfBmtStatus','Đã lấy thông tin hiện có từ hồ sơ học viên. Vui lòng kiểm tra và bổ sung các ô còn thiếu.','ok');
}
function phfCollectBMTT(){
  const val = function(id){ const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
  const record = {
    id: 'bmtt-' + Date.now(),
    employeeId: phfCurrentEmployeeIdForBMTT(),
    documentVersion: val('phfBmtVersion') || 'PHF-BMTT-2026-06-06',
    fullName: val('phfBmtFullName'),
    birthday: val('phfBmtDob'),
    cccd: val('phfBmtCccd'),
    cccdDate: val('phfBmtCccdDate'),
    cccdPlace: val('phfBmtCccdPlace'),
    phone: phfDigits(val('phfBmtPhone')),
    position: val('phfBmtPosition'),
    branch: val('phfBmtBranch'),
    signName: val('phfBmtSignName'),
    signPhone: phfDigits(val('phfBmtSignPhone')),
    confirmDate: val('phfBmtConfirmDate'),
    checkedCount: document.querySelectorAll('#phfBmtPaper .phf-bmtt-check:checked').length,
    requiredCheckCount: document.querySelectorAll('#phfBmtPaper .phf-bmtt-check').length,
    signedAt: new Date().toISOString(),
    confirmedByEmail: (window.phfGetAuthenticatedUser && window.phfGetAuthenticatedUser() && window.phfGetAuthenticatedUser().email) || '',
    confirmedByAccountId: (window.phfGetAuthenticatedUser && window.phfGetAuthenticatedUser() && window.phfGetAuthenticatedUser().id) || '',
    status: 'signed',
    page: window.phfCurrentLessonKey || ('lesson:' + (typeof current === 'number' ? current : ''))
  };
  return record;
}

function phfBMTTFingerprint(){
  const ids=['phfBmtFullName','phfBmtDob','phfBmtCccd','phfBmtCccdDate','phfBmtCccdPlace','phfBmtPhone','phfBmtPosition','phfBmtBranch','phfBmtSignName','phfBmtSignPhone','phfBmtConfirmDate','phfBmtVersion'];
  const values=ids.map(function(id){const el=document.getElementById(id);return el?String(el.value||'').trim():'';});
  const checks=Array.from(document.querySelectorAll('#phfBmtPaper .phf-bmtt-check')).map(function(x){return x.checked?'1':'0';});
  return values.concat(checks).join('|');
}
function phfCurrentEmployeeIdForBMTT(){
  try{
    const user=window.phfGetAuthenticatedUser&&window.phfGetAuthenticatedUser();
    if(user&&user.employeeId) return String(user.employeeId);
    const p=phfCurrentProfileForForms();
    return String((window.currentProfile&&window.currentProfile.id)||p.id||localStorage.getItem('phfEmployeeId')||'');
  }catch(e){return '';}
}
function phfIsCompleteBMTTRecord(record){
  if(!record || typeof record !== 'object') return false;
  const employeeId=String(record.employeeId||record.employee_id||'').trim();
  const version=String(record.documentVersion||record.document_version||'').trim();
  const signName=String(record.signName||record.sign_name||record.confirmedName||record.confirmed_name||record.fullName||'').trim();
  const confirmedAt=String(record.confirmedAt||record.confirmed_at||'').trim();
  const confirmDate=String(record.confirmDate||record.confirm_date||confirmedAt).trim();
  const signedAt=String(record.signedAt||record.signed_at||record.savedAt||record.saved_at||confirmedAt).trim();
  const confirmedBy=String(record.confirmedByEmail||record.confirmed_by_email||record.confirmedByAccountId||record.confirmed_by_account_id||'').trim();
  const acknowledgement=String(record.acknowledgementText||record.acknowledgement_text||'').trim();
  const status=String(record.status||'').toLowerCase();
  const checked=Number(record.checkedCount||record.checked_count||0);
  const required=Number(record.requiredCheckCount||record.required_check_count||0);
  const serverConfirmed=status==='active'&&!!confirmedAt&&!!acknowledgement;
  const signedConfirmed=status==='signed';
  return !!employeeId && !!version && !!signName && !!confirmDate && !!signedAt && !!confirmedBy && (signedConfirmed||serverConfirmed) && required>0 && checked>=required;
}
window.phfIsCompleteBMTTRecord=phfIsCompleteBMTTRecord;
function phfExistingBMTT(){
  const employeeId=phfCurrentEmployeeIdForBMTT();
  const version=String(document.getElementById('phfBmtVersion')?.value||'PHF-BMTT-2026-06-06');
  const verified=window.__phfVerifiedBMTTRecord;
  if(verified&&String(verified.employeeId||verified.employee_id||'')===employeeId&&String(verified.documentVersion||'PHF-BMTT-2026-06-06')===version&&phfIsCompleteBMTTRecord(verified)) return verified;
  const data=window.__phfLocalData||{};
  const rows=Array.isArray(data.confidentialityCommitments)?data.confidentialityCommitments:[];
  const matches=rows.filter(function(r){return String(r.employeeId||r.employee_id||'')===employeeId&&String(r.documentVersion||'PHF-BMTT-2026-06-06')===version;});
  matches.sort(function(a,b){return new Date(b.signedAt||b.signed_at||b.savedAt||0)-new Date(a.signedAt||a.signed_at||a.savedAt||0);});
  return matches.find(phfIsCompleteBMTTRecord)||matches[0]||null;
}
function phfBMTTRecordValue(record){
  const detail=(record&&typeof record.detail==='object'&&record.detail)||{};
  const merged=Object.assign({},detail,record||{});
  return merged;
}
function phfApplyBMTTRecordToForm(record){
  const r=phfBMTTRecordValue(record);
  const put=function(id,value){const el=document.getElementById(id);if(el&&value!==undefined&&value!==null&&String(value)!=='') el.value=String(value);};
  put('phfBmtFullName',r.fullName||r.full_name||r.signName||r.sign_name);
  put('phfBmtDob',r.birthday||r.dateOfBirth||r.date_of_birth);
  put('phfBmtCccd',r.cccd||r.identityNumber||r.identity_number);
  put('phfBmtCccdDate',r.cccdDate||r.cccd_date||r.identityIssueDate||r.identity_issue_date);
  put('phfBmtCccdPlace',r.cccdPlace||r.cccd_place||r.identityIssuePlace||r.identity_issue_place);
  put('phfBmtPhone',r.phone||r.signPhone||r.sign_phone);
  put('phfBmtPosition',r.position);
  put('phfBmtBranch',r.branch);
  put('phfBmtSignName',r.signName||r.sign_name||r.confirmedName||r.confirmed_name||r.fullName||r.full_name);
  put('phfBmtSignPhone',r.signPhone||r.sign_phone||r.phone);
  put('phfBmtConfirmDate',r.confirmDate||r.confirm_date||String(r.confirmedAt||r.confirmed_at||r.signedAt||r.signed_at||'').slice(0,10));
  put('phfBmtVersion',r.documentVersion||r.document_version);
  const checks=Array.from(document.querySelectorAll('#phfBmtPaper .phf-bmtt-check'));
  if(checks.length&&phfIsCompleteBMTTRecord(record)) checks.forEach(function(x){x.checked=true;});
  phfUpdateBMTTPrintFields();
}
function phfRenderSignedBMTTReceipt(record){
  const r=phfBMTTRecordValue(record);
  const receipt=document.getElementById('phfBmtSignedReceipt');
  if(!receipt) return;
  const signedAt=r.signedAt||r.signed_at||r.confirmedAt||r.confirmed_at||r.savedAt||r.saved_at||'';
  const confirmDate=r.confirmDate||r.confirm_date||String(signedAt).slice(0,10);
  const signedTime=signedAt?new Date(signedAt).toLocaleString('vi-VN'):(confirmDate?phfFormatVNDate(confirmDate):'—');
  const recordId=r.id||r.commitmentId||r.commitment_id||'—';
  const account=r.confirmedByEmail||r.confirmed_by_email||r.confirmedByAccountId||r.confirmed_by_account_id||'—';
  receipt.className='phf-bmtt-signed-receipt phf-bmtt-full-record complete phf-bmtt-screen-only';
  receipt.hidden=false;
  receipt.innerHTML=`<div class="phf-bmtt-record-banner"><div><span>BIÊN BẢN ĐIỆN TỬ</span><h3>Đã ký xác nhận BMTT</h3><p>Cam kết đã được ghi nhận trên PHF Training Hub và chuyển sang chế độ chỉ đọc.</p></div><b class="phf-bmtt-signed-chip">Đã ký hợp lệ</b></div><div class="phf-bmtt-receipt-grid"><div><span>Người ký</span><b>${phfEscHtml(r.signName||r.sign_name||r.confirmedName||r.confirmed_name||r.fullName||r.full_name||'—')}</b></div><div><span>Ngày xác nhận</span><b>${phfEscHtml(confirmDate?phfFormatVNDate(confirmDate):'—')}</b></div><div><span>Thời điểm hệ thống ghi nhận</span><b>${phfEscHtml(signedTime)}</b></div><div><span>Tài khoản xác nhận</span><b>${phfEscHtml(account)}</b></div><div><span>Phiên bản cam kết</span><b>${phfEscHtml(r.documentVersion||r.document_version||'PHF-BMTT')}</b></div><div><span>Mã biên bản</span><b>${phfEscHtml(recordId)}</b></div></div><div class="phf-bmtt-electronic-seal"><b>Xác nhận điện tử của PHF Training Hub</b><p>Biên bản này không thể sửa, bỏ ký hoặc ký lại trong cùng phiên bản. Học viên có thể tiếp tục bài học và sử dụng chức năng In bản cam kết khi cần.</p></div>`;
}
function phfSetBMTTSignedView(record){
  const paper=document.getElementById('phfBmtPaper');
  if(!paper) return;
  phfApplyBMTTRecordToForm(record);
  paper.classList.add('phf-bmtt-paper-signed');
  paper.querySelectorAll('input:not([type="hidden"]),select,textarea').forEach(function(el){el.disabled=true;el.setAttribute('aria-readonly','true');});
  const preparer=paper.querySelector('.phf-bmtt-preparer-card');
  const confirm=paper.querySelector('.phf-bmtt-confirm');
  if(preparer) preparer.hidden=true;
  if(confirm) confirm.hidden=true;
  const actions=document.querySelector('.phf-bmtt-lesson .phf-bmtt-actions');
  if(actions){const fillBtn=actions.querySelector('button:first-child');if(fillBtn) fillBtn.hidden=true;}
  const remember=document.querySelector('.phf-bmtt-lesson .remember-box.phf-bmtt-screen-only');
  if(remember) remember.hidden=true;
  phfRenderSignedBMTTReceipt(record);
}
function phfSetBMTTSigningView(){
  const paper=document.getElementById('phfBmtPaper');
  if(!paper) return;
  paper.classList.remove('phf-bmtt-paper-signed');
  paper.querySelectorAll('input:not([type="hidden"]),select,textarea').forEach(function(el){el.disabled=false;el.removeAttribute('aria-readonly');});
  const preparer=paper.querySelector('.phf-bmtt-preparer-card');
  const confirm=paper.querySelector('.phf-bmtt-confirm');
  if(preparer) preparer.hidden=false;
  if(confirm) confirm.hidden=false;
  const actions=document.querySelector('.phf-bmtt-lesson .phf-bmtt-actions');
  if(actions){const fillBtn=actions.querySelector('button:first-child');if(fillBtn) fillBtn.hidden=false;}
  const remember=document.querySelector('.phf-bmtt-lesson .remember-box.phf-bmtt-screen-only');
  if(remember) remember.hidden=false;
  const receipt=document.getElementById('phfBmtSignedReceipt');
  if(receipt){receipt.hidden=true;receipt.innerHTML='';receipt.className='phf-bmtt-signed-receipt phf-bmtt-screen-only';}
}
function phfMarkBMTTSigned(record){
  const paper=document.getElementById('phfBmtPaper');
  if(!paper) return;
  if(record) window.__phfVerifiedBMTTRecord=record;
  phfSetBMTTSignedView(record||phfExistingBMTT());
  paper.dataset.phfSigned='1';
  paper.dataset.phfSignedFingerprint=phfBMTTFingerprint();
  if(record&&record.id) paper.dataset.phfCommitmentId=String(record.id);
  const btn=document.getElementById('phfBmtSignButton');
  if(btn){btn.textContent='Đã ký xác nhận';btn.disabled=true;}
}
function phfInvalidateBMTTSignature(){
  const paper=document.getElementById('phfBmtPaper');
  if(!paper||paper.dataset.phfSigned!=='1') return;
  if(paper.dataset.phfSignedFingerprint===phfBMTTFingerprint()) return;
  paper.dataset.phfSigned='0';
  phfSetBMTTSigningView();
  const btn=document.getElementById('phfBmtSignButton');
  if(btn){btn.textContent='Ký xác nhận';btn.disabled=false;}
  phfSetStatus('phfBmtStatus','Thông tin cam kết đã thay đổi. Vui lòng ký xác nhận lại trước khi tiếp tục.','warn');
}
function phfHasSavedBMTTSignature(){
  const paper=document.getElementById('phfBmtPaper');
  if(!paper) return true;
  const existing=phfExistingBMTT();
  if(phfIsCompleteBMTTRecord(existing)){
    if(paper.dataset.phfSigned!=='1') phfMarkBMTTSigned(existing);
    return true;
  }
  return false;
}
window.phfHasSavedBMTTSignature=phfHasSavedBMTTSignature;
function phfUpdateBMTTSignButtonState(){
  const paper=document.getElementById('phfBmtPaper');
  const btn=document.getElementById('phfBmtSignButton');
  if(!paper||!btn) return;
  if(phfHasSavedBMTTSignature()){
    btn.disabled=true;
    btn.textContent='Đã ký xác nhận';
    return;
  }
  const ready=phfValidateConfidentialityCommitment(true);
  btn.disabled=!ready;
  btn.textContent='Ký xác nhận';
}
window.phfUpdateBMTTSignButtonState=phfUpdateBMTTSignButtonState;
function phfValidateConfidentialityCommitment(silent){
  if(!document.getElementById('phfBmtPaper')) return true;
  phfPrefillBMTTForm(false);
  const fields = [
    ['phfBmtFullName','họ và tên người lao động'],
    ['phfBmtDob','ngày sinh'],
    ['phfBmtCccd','số CCCD'],
    ['phfBmtCccdDate','ngày cấp CCCD'],
    ['phfBmtCccdPlace','nơi cấp CCCD'],
    ['phfBmtPhone','số điện thoại xác nhận'],
    ['phfBmtPosition','vị trí/bộ phận'],
    ['phfBmtBranch','chi nhánh/bộ phận làm việc'],
    ['phfBmtSignName','họ tên xác nhận điện tử'],
    ['phfBmtSignPhone','số điện thoại xác nhận lại'],
    ['phfBmtConfirmDate','ngày xác nhận']
  ];
  for(const pair of fields){
    const el = document.getElementById(pair[0]);
    if(!el || !String(el.value || '').trim()){
      if(!silent){ phfNotice('warning','Thiếu thông tin bắt buộc',`Vui lòng nhập ${pair[1]} trước khi tiếp tục.`); try{ el && el.focus(); }catch(e){} }
      return false;
    }
  }
  const phone = phfDigits(document.getElementById('phfBmtPhone')?.value || '');
  const signPhone = phfDigits(document.getElementById('phfBmtSignPhone')?.value || '');
  if(phone.length < 8 || signPhone.length < 8 || phone !== signPhone){
    if(!silent) phfNotice('warning','Số điện thoại chưa khớp','Số điện thoại xác nhận lại phải trùng với số điện thoại đã nhập ở thông tin người lao động.');
    return false;
  }
  const checks = Array.from(document.querySelectorAll('#phfBmtPaper .phf-bmtt-check'));
  const missing = checks.filter(x=>!x.checked);
  if(missing.length){
    if(!silent) phfNotice('warning','Chưa tick đủ xác nhận',`Vui lòng tick đủ ${checks.length} ô xác nhận trong phần cam kết bảo mật.`);
    return false;
  }
  const signName = String(document.getElementById('phfBmtSignName')?.value || '').replace(/\s+/g,' ').trim().toLowerCase();
  const fullName = String(document.getElementById('phfBmtFullName')?.value || '').replace(/\s+/g,' ').trim().toLowerCase();
  if(signName && fullName && signName !== fullName){
    if(!silent) phfNotice('warning','Họ tên xác nhận chưa khớp','Họ tên xác nhận điện tử nên trùng với họ tên người lao động đã khai.');
    return false;
  }
  return true;
}
function phfUpdateBMTTPrintFields(){
  const val = function(id){ const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
  const d = phfSplitDate(val('phfBmtConfirmDate') || phfTodayISO());
  const put = function(id,v){ const el=document.getElementById(id); if(el) el.value = v || ''; };
  put('phfBmtDay', d.day); put('phfBmtMonth', d.month); put('phfBmtYear', d.year);
  const name = val('phfBmtSignName') || val('phfBmtFullName') || '________________';
  const phone = phfDigits(val('phfBmtSignPhone') || val('phfBmtPhone')) || '________________';
  const time = val('phfBmtConfirmDate') ? phfFormatVNDate(val('phfBmtConfirmDate')) : '________________';
  const nameEl = document.getElementById('phfBmtPrintName'); if(nameEl) nameEl.textContent = name;
  const phoneEl = document.getElementById('phfBmtPrintPhone'); if(phoneEl) phoneEl.textContent = phone;
  const timeEl = document.getElementById('phfBmtPrintTime'); if(timeEl) timeEl.textContent = time;
}
function phfPrepareBMTTPrintOnly(){
  const old = document.getElementById('phfBmtPrintOnly');
  if(old) old.remove();
  const source = document.getElementById('phfBmtPaper');
  if(!source) return null;
  phfUpdateBMTTPrintFields();
  const clone = source.cloneNode(true);
  clone.id = 'phfBmtPrintOnly';
  clone.classList.add('phf-bmtt-print-only');
  clone.querySelectorAll('.phf-bmtt-screen-only').forEach(function(x){ x.remove(); });
  clone.querySelectorAll('input').forEach(function(input){
    const span = document.createElement('span');
    span.className = 'phf-bmtt-print-value';
    let value = String(input.value || '').trim();
    if(input.type === 'date') value = phfFormatVNDate(value);
    if(input.id === 'phfBmtDay' || input.id === 'phfBmtMonth' || input.id === 'phfBmtYear') value = String(input.value || '').trim();
    span.textContent = value || '................................';
    input.replaceWith(span);
  });
  document.body.appendChild(clone);
  return clone;
}
async function phfSaveConfidentialityCommitment(){
  if(!phfValidateConfidentialityCommitment(false)) return false;
  const btn=document.getElementById('phfBmtSignButton');
  if(btn){btn.disabled=true;btn.textContent='Đang ký xác nhận...';}
  phfUpdateBMTTPrintFields();
  const record=phfCollectBMTT();
  phfSetStatus('phfBmtStatus','Đang lưu chữ ký xác nhận lên hệ thống...', 'info');
  try{
    const employee=phfCurrentProfileForForms();
    employee.id=phfCurrentEmployeeIdForBMTT()||employee.id;
    employee.fullName=record.fullName;
    employee.birthday=record.birthday;
    employee.phone=record.phone;
    employee.branch=record.branch;
    employee.position=record.position;
    const payload={type:'confidentiality-commitment',employee:employee,currentPage:record.page,skipProgress:true,confidentialityCommitment:record};
    const res=await fetch('/api/data',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const json=await res.json().catch(function(){return{}});
    if(!res.ok||!json||!json.ok) throw new Error(json&&json.error?json.error:'Chưa thể lưu chữ ký xác nhận.');
    if(json.data) window.__phfLocalData=json.data;
    const saved=json.commitmentRecord||phfExistingBMTT()||record;
    if(!phfIsCompleteBMTTRecord(saved)) throw new Error('Máy chủ đã lưu nhưng chưa trả lại đủ thông tin biên bản BMTT.');
    window.__phfVerifiedBMTTRecord=saved;
    try{localStorage.setItem('phfConfidentialityCommitment',JSON.stringify(saved));}catch(e){}
    phfMarkBMTTSigned(saved);
    phfSetStatus('phfBmtStatus','Đã ký xác nhận và lưu vào hồ sơ BMTT trên hệ thống.', 'ok');
    return true;
  }catch(e){
    console.warn('PHF BMTT save error:',e);
    const paper=document.getElementById('phfBmtPaper');
    if(paper) paper.dataset.phfSigned='0';
    if(btn){btn.disabled=false;btn.textContent='Ký xác nhận';}
    phfSetStatus('phfBmtStatus',e&&e.message?e.message:'Chưa lưu được chữ ký xác nhận. Vui lòng thử lại.','warn');
    phfNotice('error','Chưa ký xác nhận được','Dữ liệu chưa được ghi vào hồ sơ Admin/Quản lý. Vui lòng kiểm tra kết nối và thử lại.');
    return false;
  }
}

function phfEscHtml(v){
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}
function phfBuildBMTTPrintHTML(record){
  const blank = '........................................';
  const v = function(x){ return phfEscHtml(x || blank); };
  const dateVN = phfFormatVNDate(record.confirmDate || phfTodayISO());
  const d = phfSplitDate(record.confirmDate || phfTodayISO());
  const signedTime = record.signedAt ? phfFormatVNDate(String(record.signedAt).slice(0,10)) : dateVN;
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>Bản cam kết bảo mật thông tin - ${v(record.fullName)}</title>
<style>
  @page{size:A4 portrait;margin:15mm 14mm 15mm 14mm;}
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:#fff;color:#000;}
  body{font-family:"Times New Roman",Times,serif;font-size:11.2pt;line-height:1.32;}
  .doc{width:100%;max-width:180mm;margin:0 auto;}
  .national{text-align:center;font-weight:700;line-height:1.25;margin-bottom:8px;}
  .national .sub{font-weight:400;}
  .line{text-align:center;margin:0 0 10px 0;}
  h1{font-size:15.5pt;line-height:1.15;text-align:center;margin:8px 0 2px;text-transform:uppercase;}
  .subtitle{text-align:center;font-weight:700;margin:0 0 10px 0;}
  p{margin:3px 0;}
  .section-title{font-weight:700;text-transform:uppercase;margin:8px 0 4px 0;}
  .party-title{font-weight:700;margin:6px 0 2px 0;}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;column-gap:14mm;row-gap:1mm;margin:4px 0 5px 0;}
  .info-grid div{min-width:0;overflow-wrap:anywhere;}
  .full{grid-column:1/-1;}
  ul{margin:3px 0 4px 16px;padding:0;}
  li{margin:2px 0;padding-left:2px;break-inside:avoid;}
  .sign-grid{display:grid;grid-template-columns:1fr 1fr;gap:22mm;margin-top:16px;text-align:center;break-inside:avoid;page-break-inside:avoid;}
  .sign-box{min-height:36mm;}
  .sign-title{font-weight:700;text-transform:uppercase;}
  .small{font-size:10pt;}
  .electronic{border:1px solid #000;padding:6px 8px;margin:10px 0 4px 0;break-inside:avoid;page-break-inside:avoid;}
  .no-break{break-inside:avoid;page-break-inside:avoid;}
  b{font-weight:700;}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}.doc{max-width:none;width:100%;}}
</style>
</head>
<body>
<div class="doc">
  <div class="national">
    CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM<br>
    <span class="sub">Độc lập – Tự do – Hạnh phúc</span>
  </div>
  <div class="line">--------o0o--------</div>
  <h1>BẢN CAM KẾT BẢO MẬT THÔNG TIN</h1>
  <div class="subtitle">(V/v: Cam kết bảo mật thông tin &amp; trách nhiệm vật chất)</div>

  <p>Căn cứ quy định tại Bộ luật lao động 2019;</p>
  <p>Căn cứ quy định tại Bộ luật hình sự 2015 (sửa đổi 2017) về tội xâm nhập trái phép, chiếm đoạt, làm lộ thông tin bí mật kinh doanh;</p>
  <p>Để bảo đảm quyền lợi hợp pháp của Công ty;</p>
  <p>Hôm nay, ngày <b>${v(d.day)}</b> tháng <b>${v(d.month)}</b> năm <b>${v(d.year)}</b>, Tại: Công Ty cổ phần thực phẩm Phú Hòa, Chúng tôi gồm:</p>

  <div class="party-title">BÊN A: (Người sử dụng lao động):</div>
  <p>Bà: <b>Trần Thu Thủy</b></p>
  <p>Chức vụ: <b>Giám Đốc</b></p>
  <p>Đại diện cho (1): <b>CÔNG TY CỔ PHẦN THỰC PHẨM PHÚ HÒA</b></p>
  <p>Mã số thuế: <b>3703182824</b></p>
  <p>Địa chỉ trụ sở chính: <b>342 Phú Lợi, Phường Phú Lợi, TP. Hồ Chí Minh.</b></p>
  <p>(Sau đây gọi là “Công ty”)</p>

  <div class="party-title">Bên B: (Người lao động)</div>
  <div class="info-grid">
    <div>Ông (Bà): <b>${v(record.fullName)}</b></div>
    <div>Sinh ngày: <b>${v(phfFormatVNDate(record.birthday))}</b></div>
    <div>Số CCCD: <b>${v(record.cccd)}</b></div>
    <div>Cấp ngày: <b>${v(phfFormatVNDate(record.cccdDate))}</b></div>
    <div class="full">Tại: <b>${v(record.cccdPlace)}</b></div>
    <div>Số điện thoại xác nhận: <b>${v(record.phone)}</b></div>
    <div>Vị trí/Bộ phận: <b>${v(record.position)}</b></div>
    <div>Chi nhánh/Bộ phận làm việc: <b>${v(record.branch)}</b></div>
  </div>
  <p>(Sau đây gọi là “Người lao động”)</p>
  <p>Sau khi trao đổi, hai bên thống nhất ký bản “cam kết bảo mật” này, qui định về trách nhiệm và cam kết bảo mật thông tin của Người lao động - với nội dung như sau:</p>

  <div class="section-title">Điều 1 : TÀI LIỆU/THÔNG TIN BẢO MẬT</div>
  <p><b>1.1</b> Bí mật kinh doanh và tài sản trí tuệ bao gồm nhưng không giới hạn: được hiểu là các thông tin, tài liệu thể hiện hoặc lưu trữ dưới các dạng như: văn bản, file máy tính, thư điện tử, hình ảnh, mã code, phần mềm tin học mà Công ty có được và thuộc quyền sở hữu hợp pháp của mình.</p>
  <p>Bí mật kinh doanh và tài sản trí tuệ còn được hiểu và thực hiện theo quy định hiện hành của pháp luật Việt Nam và thông lệ Quốc tế (trong trường hợp pháp luật Việt Nam chưa có quy định)</p>
  <p><b>1.2.</b> Thông tin bảo mật: là những thông tin thuộc Bí mật kinh doanh và tài sản trí tuệ nêu tại Điều 1.1 mà Người lao động trong quá trình làm việc tại Công ty biết được hoặc tiếp cận được.</p>
  <p><b>1.3.</b> Phù hợp với các quy định ở trên, Công ty quy định những thông tin, tài liệu sau đây là tài sản của Công ty, cần được bảo mật và giữ gìn vì quyền và lợi ích hợp pháp của Công ty:</p>
  <ul>
    <li>Danh sách khách hàng, thông tin khách hàng.</li>
    <li>Thông tin về đối tác, nhà cung cấp, thoả thuận hợp tác.</li>
    <li>Sổ sách tài chính kế toán, chứng từ ngân hàng.</li>
    <li>Hệ thống các phần mềm cài đặt trên máy vi tính của Công ty.</li>
    <li>Các tài liệu về tình hình tài chính của công ty (Doanh số, khoản vay, nợ, phải thu,..,).</li>
    <li>Hệ thống các phần mềm, quy trình, dữ liệu.</li>
    <li>Kế hoạch/ý tưởng/báo cáo/chiến lược hoạt động kinh doanh.</li>
    <li>Tài liệu mô tả, phân tích thiết kế hệ thống, phần mềm, tài liệu hướng dẫn và các tài liệu được phổ biến nội bộ.</li>
    <li>Khóa mã bản quyền các phần mềm sử dụng trong Công ty.</li>
    <li>Ghi chú: Danh mục tài liệu/thông tin bảo mật nêu trên có thể được Công ty bổ sung vào bất kỳ lúc nào. Khi bổ sung sẽ thông báo cho Người lao động.</li>
  </ul>

  <div class="section-title">Điều 2 : CAM KẾT CỦA NGƯỜI LAO ĐỘNG</div>
  <ul>
    <li>Người lao động có trách nhiệm và cam kết bảo mật tất cả những tài liệu/thông tin bảo mật của Công ty - quy định và nêu tại Điều 1 Phụ lục này.</li>
    <li>Người lao động cam kết không tự ý sao chép, cung cấp, mua bán hoặc sử dụng những thông tin/tài liệu bảo mật cho bất kỳ ai, vì bất kỳ lý do và mục đích gì nếu không có sự đồng ý bằng văn bản của Công ty.</li>
    <li>Người lao động cam kết không đưa thông tin lên mạng bằng cách phát tán ảnh chụp màn hình phần mềm, một phần hoặc toàn màn hình hoặc bất cứ hành vi nào tiềm ẩn nguy cơ rò rỉ thông tin thông qua Internet.</li>
    <li>Trong trường hợp vi phạm cam kết này, ngoài việc phải chịu hình thức xử lý, kỷ luật như quy định của pháp luật, Người lao động còn phải bồi thường toàn bộ thiệt hại do hành vi vi phạm của mình gây ra theo quy định của pháp luật.</li>
    <li>Trong trường hợp vi phạm cam kết này, mà vì lý do khách quan Công ty chưa đánh giá được mức độ thiệt hại và sự ảnh hưởng đến quyền lợi hợp pháp của Công ty thì tùy theo mức độ vi phạm, Người lao động đồng ý sẽ bị xử lý kỷ luật lao động đến mức cao nhất là sa thải (theo quy định trong Nội quy lao động) và phải có trách nhiệm bồi thường toàn bộ thiệt hại do mình gây ra cho công ty theo qui định của pháp luật.</li>
  </ul>

  <div class="section-title">Điều 3 : TRÁCH NHIỆM PHÁP LÝ</div>
  <ul>
    <li>Nếu hành vi vi phạm gây hậu quả nghiêm trọng (rò rỉ bí mật kinh doanh, dữ liệu khách hàng, chiến lược kinh doanh…), cá nhân vi phạm sẽ bị xử lý theo Bộ Luật Dân sự, Bộ Luật Lao động, Luật Sở hữu trí tuệ hoặc Bộ Luật Hình sự (tùy mức độ).</li>
    <li>Bồi thường thiệt hại cho doanh nghiệp theo Điều 130 Bộ Luật Lao động 2019.</li>
    <li>Bị xử phạt hành chính hoặc truy cứu trách nhiệm hình sự theo Điều 288, 289, 290 Bộ Luật Hình sự 2015 (sửa đổi 2017) về tội xâm nhập trái phép, chiếm đoạt, làm lộ thông tin bí mật kinh doanh.</li>
    <li>Mức phạt có thể lên đến 500 triệu đồng hoặc 3–7 năm tù, tùy mức độ thiệt hại và tính chất cố ý.</li>
  </ul>

  <div class="section-title">Điều 4 : ĐIỀU KHOẢN CHUNG</div>
  <ul>
    <li>Bản cam kết này là một bộ phận không tách rời của Hợp đồng lao động đã ký giữa hai bên, có giá trị trong suốt thời gian hiệu lực của hợp đồng lao động và vẫn có giá trị ràng buộc với bên B trong vòng 5 năm kể từ ngày hai bên chấm dứt hợp đồng lao động.</li>
    <li>Hai bên cam kết thực hiện đúng các điều khoản tại bản “cam kết bảo mật thông tin”. Mọi sự thay đổi, bổ sung chỉ có giá trị khi được cả hai bên đồng ý bằng văn bản.</li>
    <li>Người lao động cam kết hiểu rõ những nội dung qui định trong bản “cam kết bảo mật thông tin này”, tự nguyện cam kết và không khiếu nại về sau.</li>
    <li>Bản cam kết này có hiệu lực kể từ ngày ký, được lập thành 02 (hai) bản, có giá trị như nhau. Mỗi bên giữ 01 (một) bản.</li>
  </ul>

  <div class="electronic small">
    <b>Thông tin xác nhận trên hệ thống PHF Training Hub:</b><br>
    Người lao động đã tick đủ ${v(record.checkedCount)}/${v(record.requiredCheckCount)} ô xác nhận bắt buộc. Họ tên xác nhận: <b>${v(record.signName)}</b>. Số điện thoại xác nhận: <b>${v(record.signPhone)}</b>. Ngày xác nhận: <b>${v(dateVN)}</b>.
  </div>

  <div class="sign-grid">
    <div class="sign-box">
      <div class="sign-title">NGƯỜI LAO ĐỘNG</div>
      <div class="small">(Ký, ghi họ tên)</div>
      <br><br><br>
      <b>${v(record.signName || record.fullName)}</b>
    </div>
    <div class="sign-box">
      <div class="sign-title">NGƯỜI SỬ DỤNG LAO ĐỘNG</div>
      <div class="small">(Ký, ghi họ tên và đóng dấu)</div>
      <br><br><br>
      <b>TRẦN THU THỦY</b>
    </div>
  </div>
</div>



</body>
</html>`;
}
function phfOpenBMTTPrintDocument(record){
  const saved = (typeof phfExistingBMTT === 'function') ? phfExistingBMTT() : null;
  const payload = Object.assign({}, record || {}, saved || {});
  const recordId = String(payload.id || ('bmtt-' + Date.now())).trim();
  payload.id = recordId;

  try{
    sessionStorage.setItem('phfBmttPrintRecord:' + recordId, JSON.stringify(payload));
  }catch(error){
    phfNotice('error','Chưa mở được bản in','Trình duyệt không thể chuẩn bị dữ liệu in trong phiên hiện tại. Vui lòng thử lại.');
    return false;
  }

  const url = '/print/commitments/' + encodeURIComponent(recordId);
  const win = window.open(url, '_blank');
  if(!win){
    phfNotice('warning','Trình duyệt đang chặn cửa sổ in','Vui lòng cho phép mở cửa sổ mới để in bản cam kết.');
    return false;
  }
  try{ win.focus(); }catch(error){}
  return true;
}
async function phfPrintConfidentialityCommitment(){
  if(!phfValidateConfidentialityCommitment(false)) return;
  phfUpdateBMTTPrintFields();
  const savedOk = await phfSaveConfidentialityCommitment();
  if(!savedOk) return;
  const record = (typeof phfExistingBMTT === 'function' && phfExistingBMTT()) || phfCollectBMTT();
  phfOpenBMTTPrintDocument(record);
}
function phfValidateMorningCommitment(){
  const box = document.querySelector('#mainLesson .commit-final');
  if(!box) return true;
  const checks = Array.from(box.querySelectorAll('input[type="checkbox"]'));
  if(checks.length && checks.some(x=>!x.checked)){
    phfNotice('warning','Chưa tick đủ cam kết',`Vui lòng tick đủ ${checks.length} ô cam kết trước khi tiếp tục.`);
    return false;
  }
  return true;
}
function phfValidateRequiredLessonChecks(){
  const root = document.querySelector('#mainLesson');
  if(!root) return true;
  const checks = Array.from(root.querySelectorAll('input.phf-required-check[type="checkbox"], input[type="checkbox"][required]:not(.phf-bmtt-check)'));
  if(checks.length && checks.some(x=>!x.checked)){
    phfNotice('warning','Chưa tick đủ mục bắt buộc','Vui lòng tick đủ các ô có dấu * hoặc nhãn Bắt buộc trước khi tiếp tục.');
    try{ const first = checks.find(x=>!x.checked); if(first) first.focus(); }catch(e){}
    return false;
  }
  return true;
}
function phfValidateLessonSignatureConfirm(){
  const root = document.querySelector('#mainLesson');
  if(!root) return true;
  const signBox = root.querySelector('.signature-xem, .signature-preview, .commit-signature');
  if(!signBox) return true;
  const textInput = signBox.querySelector('input[type="text"], input:not([type]), input[type="search"]');
  const dateInput = signBox.querySelector('input[type="date"]');
  if(textInput && !String(textInput.value || '').trim()){
    phfNotice('warning','Thiếu họ tên xác nhận','Vui lòng nhập họ và tên xác nhận trước khi tiếp tục.');
    try{ textInput.focus(); }catch(e){}
    return false;
  }
  if(dateInput && !String(dateInput.value || '').trim()){
    phfNotice('warning','Thiếu ngày xác nhận','Vui lòng chọn ngày xác nhận trước khi tiếp tục.');
    try{ dateInput.focus(); }catch(e){}
    return false;
  }
  return true;
}
async function phfTryNextFromLesson(){
  if(!phfValidateMorningCommitment()) return;
  if(!phfValidateRequiredLessonChecks()) return;
  if(!phfValidateLessonSignatureConfirm()) return;
  const bmtt=document.getElementById('phfBmtPaper');
  if(bmtt){
    if(phfHasSavedBMTTSignature()){go(current+1);return;}
    if(!phfValidateConfidentialityCommitment(false)) return;
    phfNotice('warning','Chưa ký xác nhận','Vui lòng bấm “Ký xác nhận” và chờ hệ thống báo đã lưu vào hồ sơ trước khi tiếp tục.');
    const btn=document.getElementById('phfBmtSignButton');try{btn&&btn.focus();}catch(e){}
    return;
  }
  go(current+1);
}


/* PHF Bản 25: logic kiểm tra/thi đã tách sang assets/js/phf-quiz-engine.js */
function phfInitContentForms(){
  phfPrefillBMTTForm(false);
  if(typeof window.phfBindLessonQuizScoring === 'function') window.phfBindLessonQuizScoring();
  const paper = document.getElementById('phfBmtPaper');
  if(paper && !paper.dataset.phfBound){
    paper.dataset.phfBound='1';
    const onChange=function(){phfUpdateBMTTPrintFields();phfInvalidateBMTTSignature();phfUpdateBMTTSignButtonState();};
    paper.addEventListener('input',onChange);
    paper.addEventListener('change',onChange);
  }
  if(paper){
    const existing=phfExistingBMTT();
    if(existing&&phfIsCompleteBMTTRecord(existing)){
      phfMarkBMTTSigned(existing);
      phfSetStatus('phfBmtStatus','Cam kết này đã được ký xác nhận và lưu trong hồ sơ.','ok');
    }else if(existing){
      const paper=document.getElementById('phfBmtPaper');
      if(paper) paper.dataset.phfSigned='0';
      phfSetBMTTSigningView();
      phfSetStatus('phfBmtStatus','Đã ghi nhận thao tác trước đây nhưng chưa đủ thông tin biên bản — cần ký xác nhận lại.','warn');
    }else{
      phfSetBMTTSigningView();
    }
    phfUpdateBMTTSignButtonState();
  }
}


function phfGetLessonVisual(l){
  if(!l) return '';
  const title = String(l.title || '');
  const stage = Number(l.stage || 0);
  let img = '', label = '', titleText = '', desc = '';
  if(/Chào mừng bạn đến với PHF Training Hub/i.test(title)){
    img = 'assets/img/traininghub/phf-training-hero.jpg';
    label = 'PHF Training Hub';
    titleText = 'Không gian đào tạo nội bộ PHUHOA FRESH';
    desc = 'Hình ảnh dùng như phần mở đầu nhẹ, giúp nhân viên mới có cảm giác được chào đón trước khi bước vào lộ trình học.';
  }else if(/Trước khi học/i.test(title)){
    img = 'assets/img/traininghub/phf-welcome-onboarding.jpg';
    label = 'Bước chuẩn bị';
    titleText = 'Điền thông tin để hệ thống ghi nhận đúng người học';
    desc = 'Hình ảnh nhấn mạnh tinh thần được hướng dẫn và đồng hành trong ngày đầu tham gia Training Hub.';
  }else if(/Trang phục|tác phong|Nội quy công ty|Người mới cần hiểu gì về tác phong|Tự kiểm tác phong|Đồng phục|Tổng tác phong/i.test(title)){
    img = 'assets/img/traininghub/phf-tacphong-noiquy.png';
    label = 'Tác phong & nội quy';
    titleText = 'Chuẩn chỉnh từ hình ảnh cá nhân đến cách làm việc';
    desc = 'Hình minh họa giúp người học dễ hình dung về tác phong, đồng phục, thái độ phục vụ và môi trường làm việc gọn gàng.';
  }else if(stage === 2){
    img = 'assets/img/traininghub/phf-sales-process-gd3.png';
    label = 'GĐ3 · Quy trình bán hàng';
    titleText = 'Nhìn nhanh 4 chặng phục vụ khách tại PHF';
    desc = 'Sơ đồ hình ảnh giúp người học nắm luồng bán hàng trước khi đọc từng bước chi tiết.';
  }else if(/CSKH|Kỹ năng bán hàng|Chăm sóc khách hàng|Giao tiếp|Tư vấn bán hàng|phàn nàn/i.test(title)){
    img = 'assets/img/traininghub/phf-cskh-ky-nang.png';
    label = 'CSKH & kỹ năng';
    titleText = 'Học cách giao tiếp và đồng hành cùng khách hàng';
    desc = 'Hình ảnh chỉ đóng vai trò mở bài, phần chính vẫn là tình huống, câu nói mẫu và điểm cần nhớ.';
  }
  if(!img) return '';
  return `<section class="phf-lesson-visual" aria-label="Hình minh họa bài học">
    <div class="phf-lesson-visual-img"><img src="${img}" alt="${esc(titleText)}" loading="lazy"></div>
    <div class="phf-lesson-visual-caption"><span>${esc(label)}</span><b>${esc(titleText)}</b><small>${esc(desc)}</small></div>
  </section>`;
}

function render(){
  // Stage 3.12.3: mọi đường vào học đều phải đi qua cùng khung học chuẩn.
  // Khung học chuẩn = GĐ1–GĐ5 + Bạn đang ở + 3 cột Việc cần làm / Nội dung bài học / Tiến độ.
  try{
    if(typeof window.phfEnsureSharedShell === 'function') window.phfEnsureSharedShell('learning');
  }catch(e){}
  phfSetMainNavActive('learning');
  document.body.classList.add('phf-learning-mode','phf-main-shell-mode');
  document.body.classList.remove('phf-eval-mode','phf-module-page-mode','phf-guide-standalone-mode','phf-guide-intro-active','phf-original-full-mode');
  window.phfCurrentLessonIndex = current;
  window.phfCurrentLessonKey = 'lesson:' + current;
  const l=LESSONS[current];
  const byStage=LESSONS.filter(x=>x.stage===l.stage);
  const idxInStage=byStage.findIndex(x=>x===l);
  const stageDonePct=Math.round(((idxInStage+1)/byStage.length)*100);
  document.getElementById('miniStatus').textContent=`${STAGES[l.stage][0]} · ${idxInStage+1}/${byStage.length}`;
  document.getElementById('contextTitle').textContent=`Bạn đang ở: ${STAGES[l.stage][0]} · ${STAGES[l.stage][1]}`;
  document.getElementById('contextSub').textContent=l.title;
  document.getElementById('contextAction').textContent=l.badge || 'Đào tạo nội bộ';
  const phfTimeline = phfBuildTimeline();
  document.getElementById('phaseStrip').innerHTML=STAGES.map((st,i)=>{
    const first=stageFirstIndex(i);
    const calendarCls = phfTimeline && i===phfTimeline.currentStage ? ' calendar-now' : '';
    const cls=(i===l.stage?'active':(i<l.stage?'done':'')) + calendarCls;
    const dateText = phfTimeline
      ? `${phfFormatRange(phfTimeline.ranges[i].start, phfTimeline.ranges[i].end)}<small>${phfTimeline.ranges[i].note}</small>`
      : `${LESSONS.filter(x=>x.stage===i).length} mục`;
    const stateText = phfTimeline
      ? (i===l.stage ? 'Đang học' : (i===phfTimeline.currentStage ? 'Theo lịch' : (i<phfTimeline.currentStage ? 'Đã qua mốc' : 'Sắp tới')))
      : (i===l.stage?'Đang học':(i<l.stage?'Đã xem':'Mở xem'));
    return `<button class="phase ${cls}" onclick="go(${first})"><div class="phase-top"><div class="phase-code">${st[0]}</div><div class="phase-state">${stateText}</div></div><div class="phase-title">${st[1]}</div><div class="phase-date">${dateText}</div></button>`;
  }).join('');
  document.getElementById('todoSub').textContent=`${STAGES[l.stage][0]} · ${STAGES[l.stage][1]} · ${byStage.length} mục`;
  document.getElementById('todoList').innerHTML=byStage.map((it,i)=>{
    const globalIndex=LESSONS.indexOf(it); const cls=i===idxInStage?'active':(i<idxInStage?'done':'');
    return `<button class="todo-item ${cls}" onclick="go(${globalIndex})"><div class="mark">${i+1}</div><div><b>${esc(it.nav||it.title)}</b><span>${esc(it.sub||it.badge||'')}</span></div></button>`;
  }).join('');
  if(l.originalFull){
    // Stage 3.12.7: triệt nhánh giao diện cũ sau F5.
    // originalFull chỉ còn là dữ liệu nội dung, không được đổi khung học hoặc dựng lại màn toàn trang.
    document.body.classList.remove('phf-original-full-mode');
    const isInfoPage = current === 1;
    const nextAttr = isInfoPage
      ? `onclick="if(typeof phfValidateInfoForm === 'function' && !phfValidateInfoForm()) return; go(current+1);"`
      : `onclick="phfTryNextFromLesson()"`;
    const originalBlock = isInfoPage
      ? `<div class="original phf-original-inline phf-inline-info-form"><div class="original-content original-goc-screen phf-original-contained">${l.body||''}</div></div>`
      : `<div class="original"><details><summary>Xem nội dung học chi tiết</summary><div class="original-content phf-original-contained">${l.body||''}</div></details></div>`;
    document.getElementById('mainLesson').innerHTML=`<section class="focus-head"><div class="chip">${esc(l.badge)}</div><h2>${esc(l.title)}</h2><p>${esc(l.lead)}</p></section>${phfGetLessonVisual(l)}<section class="focus-body"><div class="today-box"><h3>Hôm nay cần hoàn thành</h3><ul class="check-list">${l.today.map(x=>`<li><span class="tick">✓</span><span>${esc(x)}</span></li>`).join('')}</ul></div><div class="remember"><h3>3 điều cần nhớ</h3><div class="remember-grid">${l.remember.map((x,i)=>`<div class="memory-card"><span>Cần nhớ ${i+1}</span><b>${esc(x)}</b></div>`).join('')}</div></div><div class="sample-box"><h3>Lưu ý</h3><div class="sample-text">${esc(l.sample)}</div></div>${originalBlock}<div class="actions"><button class="btn btn-soft" onclick="go(current-1)" ${current===0?'disabled':''}>← Quay lại</button><button class="btn btn-primary" ${current===LESSONS.length-1?'disabled':nextAttr}>Tôi đã hiểu, tiếp tục →</button></div></section>`;
    phfPrefillInfoForm();
    const timeline = phfBuildTimeline();
    const infoBody = document.querySelector('#mainLesson .form-body');
    if(infoBody && timeline && !infoBody.querySelector('.timeline-note')){
      const note = document.createElement('div');
      note.className = 'timeline-note';
      note.innerHTML = `<b>Mốc đào tạo dự kiến:</b> GĐ1 ${phfFormatRange(timeline.ranges[0].start,timeline.ranges[0].end)} · GĐ2 ${phfFormatRange(timeline.ranges[1].start,timeline.ranges[1].end)} · GĐ3 ${phfFormatRange(timeline.ranges[2].start,timeline.ranges[2].end)} · GĐ4 ${phfFormatRange(timeline.ranges[3].start,timeline.ranges[3].end)} · GĐ5 ${phfFormatRange(timeline.ranges[4].start,timeline.ranges[4].end)}`;
      const helpBox = infoBody.querySelector('.help-box');
      if(helpBox) helpBox.insertAdjacentElement('afterend', note);
    }
    document.querySelectorAll('#mainLesson [data-go]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const target=btn.getAttribute('data-go');
        const map={welcomePage:0, infoPage:1, ruleTimePage:2};
        if(target === 'ruleTimePage' && typeof phfValidateInfoForm === 'function' && !phfValidateInfoForm()) return;
        if(target in map) go(map[target]);
      });
    });
  } else {
    const gate = phfGateInfo(l);
    if(gate){
      document.getElementById('mainLesson').innerHTML = phfRenderLock(l, gate);
    } else {
      document.getElementById('mainLesson').innerHTML=`<section class="focus-head"><div class="chip">${esc(l.badge)}</div><h2>${esc(l.title)}</h2><p>${esc(l.lead)}</p></section>${phfGetLessonVisual(l)}<section class="focus-body"><div class="today-box"><h3>Hôm nay cần hoàn thành</h3><ul class="check-list">${l.today.map(x=>`<li><span class="tick">✓</span><span>${esc(x)}</span></li>`).join('')}</ul></div><div class="remember"><h3>3 điều cần nhớ</h3><div class="remember-grid">${l.remember.map((x,i)=>`<div class="memory-card"><span>Cần nhớ ${i+1}</span><b>${esc(x)}</b></div>`).join('')}</div></div><div class="sample-box"><h3>Lưu ý</h3><div class="sample-text">${esc(l.sample)}</div></div><div class="original"><details><summary>Xem nội dung học chi tiết</summary><div class="original-content">${l.body||''}</div></details></div><div class="actions"><button class="btn btn-soft" onclick="go(current-1)" ${current===0?'disabled':''}>← Quay lại</button><button class="btn btn-primary" onclick="phfTryNextFromLesson()" ${current===LESSONS.length-1?'disabled':''}>Tôi đã hiểu, tiếp tục →</button></div></section>`;
    }
  }
  enhanceTrainingUI();
  phfInitContentForms();
  document.body.classList.remove('phf-original-full-mode');
  document.getElementById('progressNum').textContent=stageDonePct+'%';
  document.getElementById('progressText').textContent=`${idxInStage+1}/${byStage.length} mục trong ${STAGES[l.stage][0]}`;
  document.getElementById('progressBar').style.width=stageDonePct+'%';
  const timelineForRight = phfBuildTimeline();
  document.getElementById('rightStage').textContent = timelineForRight
    ? `${STAGES[l.stage][0]} · ${STAGES[l.stage][1]} · Theo lịch: ${STAGES[timelineForRight.currentStage][0]}`
    : `${STAGES[l.stage][0]} · ${STAGES[l.stage][1]}`;
  document.getElementById('rightLesson').textContent=l.title;
  const evalBtn = document.getElementById('phfEvalRecordsBtn');
  const evalHistoryBtn = document.getElementById('phfEvalHistoryBtn');
  const learningTitle = document.getElementById('phfLearningProfileTitle');
  const learningDesc = document.getElementById('phfLearningProfileDesc');
  const learningMode = document.getElementById('phfLearningProfileMode');
  const learningCount = document.getElementById('phfLearningProfileCount');
  if(evalBtn){ evalBtn.onclick = function(){ phfGoMyProfile(); }; }
  if(evalHistoryBtn){ evalHistoryBtn.onclick = function(){
    if(phfCanEditEvaluation()) phfRenderEvaluationWorkspace('history');
    else phfGoMyProfile();
  }; }
  try{
    const canEditProfile = phfCanEditEvaluation();
    const targetProfile = phfEvaluationTargetProfile();
    const savedCount = phfEvaluationRecordsFor(targetProfile.id).length;
    if(learningTitle) learningTitle.textContent = canEditProfile ? 'Hồ sơ đánh giá' : 'Hồ sơ của tôi';
    if(learningDesc) learningDesc.textContent = canEditProfile ? 'Xem và xử lý phiếu đánh giá của học viên đang chọn.' : 'Xem phiếu tuần, phiếu tháng và phiếu kết thúc thử việc.';
    if(learningMode) learningMode.textContent = canEditProfile ? phfRoleLabel() : 'Chỉ xem';
    if(learningCount) learningCount.textContent = savedCount + ' phiếu';
    if(evalBtn) evalBtn.textContent = canEditProfile ? 'Xem hồ sơ đánh giá' : 'Xem hồ sơ của tôi';
    if(evalHistoryBtn) evalHistoryBtn.textContent = 'Lịch sử hồ sơ →';
  }catch(err){ console.warn('PHF learning profile card update error', err); }
  phfScrollToPageTop();
}
function go(i){
  if(i<0||i>=LESSONS.length) return;
  current=i;
  window.phfCurrentLessonIndex=current;
  window.phfCurrentLessonKey='lesson:'+current;
  render();
  // Lưu tiến độ sau khi đổi bài. Bọc setTimeout để app.js đọc đúng lesson mới.
  if(typeof window.phfSaveProgressNow === 'function'){
    setTimeout(function(){ window.phfSaveProgressNow('navigation'); }, 250);
  }
}
window.phfGo = go;

// Stage 3.12.3: hàm chuẩn duy nhất để mở khu Bài học của tôi từ mọi nút/luồng.
window.phfOpenLearningShell = function(){
  try{ if(typeof window.phfEnsureSharedShell === 'function') window.phfEnsureSharedShell('learning'); }catch(e){}
  return render();
};
window.phfFindLessonIndexByText = function(text){
  const q = String(text || '').toLowerCase();
  if(!q) return -1;
  return LESSONS.findIndex(function(x){
    return String((x.title||'') + ' ' + (x.nav||'') + ' ' + (x.sub||'') + ' ' + (x.badge||'')).toLowerCase().includes(q);
  });
};
window.phfGoByCurrentPage = function(page){
  const raw = String(page || '').trim();
  const p = raw.toLowerCase();
  if(!p) return false;
  const lessonMatch = p.match(/^lesson[:\-](\d+)$/);
  if(lessonMatch){
    const idx = Number(lessonMatch[1]);
    if(!Number.isNaN(idx) && idx >= 0 && idx < LESSONS.length){ go(idx); return true; }
  }
  const fixed = {welcomepage:0, infopage:1, ruletimepage:2};
  if(Object.prototype.hasOwnProperty.call(fixed, p)){ go(fixed[p]); return true; }
  const idx = LESSONS.findIndex(function(x){
    return String((x.title||'') + ' ' + (x.nav||'') + ' ' + (x.sub||'') + ' ' + (x.badge||'')).toLowerCase().includes(p) || p.includes(String(x.title||'').toLowerCase());
  });
  if(idx >= 0){ go(idx); return true; }
  return false;
};

/* PHF internal role chooser - giai đoạn kiểm thử nội bộ trên đường dẫn thật */
function phfRoleNameShort(role){
  if(role === 'admin') return 'Quản trị';
  if(role === 'manager') return 'Quản lý / CHT';
  return 'Học viên';
}
function phfCloseLegacyLearnerLogin(){
  // Một số bản cũ còn file app.js ngoài index.html, có thể tự mở hộp nhập SĐT học viên.
  // Khi kiểm thử Quản trị/Quản lý, cần dọn hộp này để không đè lên màn chọn vai trò.
  ['phfModalBackdrop','learnerPhoneModal','phoneLoginModal','phfPhoneLoginModal'].forEach(function(id){
    const el = document.getElementById(id);
    if(el) el.remove();
  });
  document.querySelectorAll('.modal.show,.toast.show,.phf-modal-backdrop.show,.learner-login-modal,.phone-login-modal').forEach(function(el){
    try{ el.remove(); }catch(e){ el.classList.remove('show'); el.style.display='none'; }
  });
}

/* PHF learner phone entry restore - sau intro/chọn vai trò */
function phfPhoneClean(v){ return String(v || '').replace(/\D+/g,''); }
function phfSetLearnerProfileFromRow(row){
  const profile = phfEmployeeFromRow(row || {});
  if(!profile.id) profile.id = 'learner-' + phfPhoneClean(profile.phone || Date.now());
  try{
    localStorage.setItem('phfEmployeeId', profile.id);
    localStorage.setItem('phfEmployeeProfile', JSON.stringify(profile));
    if(profile.studyStartDate) localStorage.setItem('phfStudyStartDate', profile.studyStartDate);
  }catch(e){}
  return profile;
}
function phfFindLearnerByPhone(phone){
  const clean = phfPhoneClean(phone);
  const rows = (window.__phfLocalData && window.__phfLocalData.employees) || [];
  return rows.map(phfEmployeeFromRow).find(function(e){ return phfPhoneClean(e.phone) === clean; }) || null;
}
function phfClearLearnerSessionPosition(){
  // Dọn trạng thái màn hình cũ trong trình duyệt để học viên mới không bị nhảy vào bài của người trước.
  try{
    ['phfRefreshResumeState','phfCurrentPage','phfCurrentLessonIndex','phfLastLessonIndex','phfCurrentLessonKey'].forEach(function(k){ localStorage.removeItem(k); });
  }catch(e){}
  try{ window.phfCurrentLessonIndex = 1; window.phfCurrentLessonKey = 'lesson:1'; }catch(e){}
}
function phfOpenLearnerAfterPhone(profile){
  const overlay = document.getElementById('phfPhoneEntryOverlay');
  if(overlay) overlay.remove();
  phfShowRoleSwitcher();
  const isNewLearner = !!(profile && profile.__phfIsNewLearner) || localStorage.getItem('phfNewLearnerStart') === '1';
  if(isNewLearner){
    phfClearLearnerSessionPosition();
    try{ localStorage.removeItem('phfNewLearnerStart'); }catch(e){}
    try{ if(typeof current !== 'undefined') current = 1; }catch(e){}
  }
  if(typeof phfRenderPostLoginHome === 'function') return phfRenderPostLoginHome();
  try{ if(typeof current !== 'undefined') current = 1; }catch(e){}
  render();
}
function phfCreateTemporaryLearnerFromPhone(phone){
  const clean = phfPhoneClean(phone);
  phfClearLearnerSessionPosition();
  const profile = {
    id:'learner-' + clean,
    fullName:'Học viên mới',
    phone:clean,
    branch:'',
    department:'Bán hàng',
    position:'Nhân viên bán hàng',
    studyStartDate:'',
    programId:'new_sales',
    __phfIsNewLearner:true
  };
  const savedProfile = phfSetLearnerProfileFromRow(profile);
  savedProfile.__phfIsNewLearner = true;
  try{ localStorage.setItem('phfNewLearnerStart','1'); }catch(e){}
  try{ if(typeof current !== 'undefined') current = 1; }catch(e){}
  phfOpenLearnerAfterPhone(savedProfile);
}
function phfShowLearnerPhoneEntry(){
  phfCloseLegacyLearnerLogin();
  let overlay = document.getElementById('phfPhoneEntryOverlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'phfPhoneEntryOverlay';
    overlay.className = 'phf-phone-entry-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<section class="phf-phone-entry-card" role="dialog" aria-modal="true" aria-label="Nhận diện học viên">
    <div class="phf-phone-entry-head"><img src="assets/logo/phf-logo.png" alt="Phuhoa Fresh" onerror="this.style.display='none';this.closest('.logo,.phf-intro-brand,.phf-phone-entry-head,.phf-role-dialog-brand,.phf-print-logo')?.classList.add('phf-logo-fallback')"><div><h2>Tiếp tục chương trình đào tạo</h2><p>Nhận diện học viên bằng số điện thoại</p></div></div>
    <p class="lead">Nhập số điện thoại để hệ thống tìm lại hồ sơ và tiến độ. Nếu chưa có hồ sơ, bạn có thể chuyển sang màn nhập thông tin người học.</p>
    <div class="phf-phone-entry-field"><label for="phfLearnerPhoneInput">Số điện thoại học viên</label><input id="phfLearnerPhoneInput" type="tel" inputmode="numeric" autocomplete="tel" placeholder="Ví dụ: 09xxxxxxxx"></div>
    <div class="phf-phone-entry-error" id="phfLearnerPhoneError"></div>
    <div class="phf-phone-entry-actions"><button type="button" class="soft" id="phfPhoneBackRole">Đổi vai trò</button><button type="button" id="phfPhoneCreate">Tạo hồ sơ mới</button><button type="button" class="primary" id="phfPhoneContinue">Tiếp tục học</button></div>
    <div class="phf-phone-entry-note">Màn này chỉ dùng để nhận diện học viên trước khi vào chương trình. Không thay đổi quyền Quản lý/Quản trị.</div>
  </section>`;
  const input = overlay.querySelector('#phfLearnerPhoneInput');
  const err = overlay.querySelector('#phfLearnerPhoneError');
  const showErr = function(msg){ if(err) err.textContent = msg || ''; };
  const continueBtn = overlay.querySelector('#phfPhoneContinue');
  continueBtn.onclick = async function(){
    const phone = phfPhoneClean(input.value);
    if(phone.length < 8){ showErr('Vui lòng nhập đúng số điện thoại để nhận diện học viên.'); input.focus(); return; }
    continueBtn.classList.add('phf-btn-loading');
    continueBtn.disabled = true;
    showErr('');
    try{ await phfRefreshTrainingData(); }catch(e){}
    const found = phfFindLearnerByPhone(phone);
    continueBtn.classList.remove('phf-btn-loading');
    continueBtn.disabled = false;
    if(found){
      const profile = phfSetLearnerProfileFromRow(found);
      phfOpenLearnerAfterPhone(profile);
    }else{
      showErr('Chưa tìm thấy hồ sơ theo số điện thoại này. Có thể tạo hồ sơ mới để bắt đầu chương trình.');
    }
  };
  overlay.querySelector('#phfPhoneCreate').onclick = function(){
    const phone = phfPhoneClean(input.value);
    if(phone.length < 8){ showErr('Nhập số điện thoại trước khi tạo hồ sơ mới.'); input.focus(); return; }
    phfCreateTemporaryLearnerFromPhone(phone);
  };
  overlay.querySelector('#phfPhoneBackRole').onclick = function(){
    overlay.remove();
    phfShowRoleChooser(true);
  };
  input.addEventListener('keydown', function(e){ if(e.key === 'Enter') continueBtn.click(); });
  setTimeout(function(){ input.focus(); }, 60);
}

function phfSetInternalRole(role){
  try{
    if(typeof window.phfHasAuthenticatedSession === 'function' && window.phfHasAuthenticatedSession()){
      role = (typeof window.phfGetSessionRole === 'function' ? window.phfGetSessionRole() : phfUserRole()) || 'learner';
    }else{
      role = 'learner';
    }
  }catch(e){ role = 'learner'; }
  const overlay = document.getElementById('phfRoleOverlay');
  if(overlay) overlay.remove();
  phfCloseLegacyLearnerLogin();
  phfShowRoleSwitcher();
  if(role === 'admin' || role === 'manager'){
    if(typeof phfRenderPostLoginHome === 'function') phfRenderPostLoginHome();
    else if(typeof phfRenderTrainingOverview === 'function') phfRenderTrainingOverview();
    else render();
    setTimeout(phfCloseLegacyLearnerLogin, 80);
    setTimeout(phfCloseLegacyLearnerLogin, 450);
  }else{
    if(typeof phfShowLearnerPhoneEntry === 'function') phfShowLearnerPhoneEntry();
    else render();
  }
}
function phfClearInternalRole(){
  try{
    if(typeof window.phfHasAuthenticatedSession === 'function' && window.phfHasAuthenticatedSession()) return;
  }catch(e){}
  try{ localStorage.removeItem('phfInternalTestRole'); }catch(e){}
}
function phfShowRoleSwitcher(){
  let bar = document.getElementById('phfRoleSwitcher');
  try{
    if(typeof window.phfHasAuthenticatedSession === 'function' && window.phfHasAuthenticatedSession()){
      if(bar) bar.remove();
      return;
    }
  }catch(e){}
  const role = phfUserRole();
  const q = new URLSearchParams(location.search || '');
  if(q.get('hideRoleSwitch') === '1') return;
  if(!bar){
    bar = document.createElement('div');
    bar.id = 'phfRoleSwitcher';
    bar.className = 'phf-role-switcher';
    document.body.appendChild(bar);
  }
  bar.innerHTML = `<span>Vai trò hiện tại: ${esc(phfRoleNameShort(role))}</span><button type="button">Đổi vai trò</button>`;
  bar.querySelector('button').onclick = function(){ phfShowRoleChooser(true); };
}
function phfShowRoleChooser(force){
  try{
    if(typeof window.phfHasAuthenticatedSession === 'function' && window.phfHasAuthenticatedSession()){
      const overlay = document.getElementById('phfRoleOverlay'); if(overlay) overlay.remove();
      const bar = document.getElementById('phfRoleSwitcher'); if(bar) bar.remove();
      return;
    }
  }catch(e){}
  const q = new URLSearchParams(location.search || '');
  const hasUrlRole = q.get('admin') === '1' || q.get('manager') === '1' || q.get('quanly') === '1' || q.get('role');
  if(!force && hasUrlRole){
    try{ localStorage.setItem('phfInternalTestRole', phfUserRole()); }catch(e){}
    phfShowRoleSwitcher();
    return;
  }
  // Bản kiểm thử nội bộ: luôn hiện màn chọn vai trò khi mở trang thường,
  // tránh bị kẹt ở vai trò học viên đã lưu từ lần trước.
  let overlay = document.getElementById('phfRoleOverlay');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'phfRoleOverlay';
    overlay.className = 'phf-role-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<section class="phf-role-dialog" role="dialog" aria-modal="true" aria-label="Chọn vai trò kiểm thử">
    <div class="phf-role-dialog-head">
      <div class="phf-role-dialog-brand"><img src="assets/logo/phf-logo.png" alt="Phuhoa Fresh" onerror="this.style.display='none';this.closest('.logo,.phf-intro-brand,.phf-phone-entry-head,.phf-role-dialog-brand,.phf-print-logo')?.classList.add('phf-logo-fallback')"><div><h2>PHF Training Hub</h2><p>Chọn vai trò để truy cập đúng khu vực trên hệ thống.</p></div></div>
      <span class="phf-role-tag">Truy cập nội bộ</span>
    </div>
    <div class="phf-role-dialog-body">
      <p>Chọn vai trò phù hợp để vào đúng khu vực sử dụng. Khi triển khai chính thức, phần này có thể thay bằng đăng nhập và phân quyền riêng.</p>
      <div class="phf-role-grid">
        <button type="button" class="phf-role-card" data-role="learner"><span class="icon">👤</span><h3>Học viên</h3><p>Học bài, làm bài kiểm tra và xem hồ sơ của mình.</p><b>Vào khu học tập</b></button>
        <button type="button" class="phf-role-card" data-role="manager"><span class="icon">📋</span><h3>Quản lý / CHT</h3><p>Xem tổng quan, tạo/sửa phiếu đánh giá và xem báo cáo.</p><b>Vào khu quản lý</b></button>
        <button type="button" class="phf-role-card" data-role="admin"><span class="icon">🛡️</span><h3>Quản trị</h3><p>Vào đầy đủ các khu vực dành cho người phụ trách hệ thống.</p><b>Vào toàn quyền</b></button>
      </div>
      <div class="phf-role-warning">Lưu ý: đây là lối vào nội bộ theo vai trò. Khi cần vận hành rộng, có thể thay bằng đăng nhập chính thức hoặc mã truy cập nội bộ.</div>
    </div>
  </section>`;
  overlay.querySelectorAll('[data-role]').forEach(function(btn){
    btn.addEventListener('click', function(){ phfSetInternalRole(btn.dataset.role); });
  });
}

window.phfBootInternalRoleTest = function phfBootInternalRoleTest(){
  const q = new URLSearchParams(location.search || '');
  const urlRole = q.get('admin') === '1' ? 'admin' : (q.get('manager') === '1' || q.get('quanly') === '1' ? 'manager' : (q.get('role') || ''));
  if(urlRole){ phfSetInternalRole(urlRole); return; }
  phfShowRoleChooser(true);
};
if(window.__phfTrainingEntryReady || !window.SHOW_COMPANY_INTRO){ window.phfBootInternalRoleTest(); }

/* PATCH UI REVIEW FIX 2026-06-26: làm sạch quiz/form/đánh giá sau mỗi lần render */
function phfNormalizeLooseQuiz(root){
  if(!root) return;
  const blocks = Array.from(root.querySelectorAll('.question-block,.quiz-card,.b4-quiz,.phf-answer-reference'));
  blocks.forEach(function(block){
    if(block.dataset.phfLooseQuizDone === '1') return;
    const raw = (block.innerHTML || '').trim();
    const text = (block.textContent || '').replace(/\s+/g,' ').trim();
    if(!/\bA[\.\)]\s|\bB[\.\)]\s|Đáp án đúng|Đáp án\s*:/i.test(text)) return;
    if(block.querySelector('input[type="radio"]')) return;
    block.classList.add('phf-quiz-clean','phf-answer-reference');
    // Chỉ chuẩn hóa hiển thị: không biến thành quiz lưu điểm, vì các ô này đang là ôn nhanh/tham khảo.
    const lines = text
      .replace(/\s+(A[\.\)])/g,'\n$1')
      .replace(/\s+(B[\.\)])/g,'\n$1')
      .replace(/\s+(C[\.\)])/g,'\n$1')
      .replace(/\s+(D[\.\)])/g,'\n$1')
      .replace(/\s+(Đáp án đúng\s*:|Đáp án\s*:)/gi,'\n$1')
      .split('\n').map(s=>s.trim()).filter(Boolean);
    if(lines.length < 3){ block.dataset.phfLooseQuizDone='1'; return; }
    const title = lines.shift();
    block.innerHTML = '<div class="phf-question-title">'+title+'</div>' + lines.map(function(line){
      const isAns = /Đáp án đúng|Đáp án\s*:/i.test(line);
      return '<div class="'+(isAns?'phf-ref-answer':'phf-ref-option')+'">'+line+'</div>';
    }).join('');
    block.dataset.phfLooseQuizDone = '1';
  });
}

function phfPolishCheckboxGroups(root){
  if(!root) return;
  root.querySelectorAll('.original-content').forEach(function(area){
    if(area.dataset.phfChecksPolished === '1') return;
    const checks = Array.from(area.querySelectorAll('input[type="checkbox"]'));
    if(!checks.length){ area.dataset.phfChecksPolished='1'; return; }
    checks.forEach(function(chk){
      if(chk.closest('.phf-check-option')) return;
      const label = document.createElement('label');
      label.className = 'phf-check-option';
      chk.parentNode.insertBefore(label, chk);
      label.appendChild(chk);
      let node = label.nextSibling;
      let guard = 0;
      while(node && guard < 18){
        const next = node.nextSibling;
        if(node.nodeType === 1){
          if(node.matches && node.matches('input,textarea,select,button,label,.phf-check-option')) break;
          if(['DIV','P','H1','H2','H3','H4','TABLE','UL','OL','SECTION','BR'].includes(node.tagName)) break;
        }
        label.appendChild(node);
        node = next; guard++;
      }
      if(!label.textContent.replace(/\s+/g,'').trim()) label.appendChild(document.createTextNode(' Chọn nội dung phù hợp'));
    });
    const holder = document.createElement('div');
    holder.className = 'phf-check-list';
    const first = area.querySelector('.phf-check-option');
    if(first){
      first.parentNode.insertBefore(holder, first);
      area.querySelectorAll('.phf-check-option').forEach(x=>holder.appendChild(x));
    }
    area.dataset.phfChecksPolished = '1';
  });
}

function phfMarkEvaluationPages(){
  const stage = (document.getElementById('rightStage')?.textContent || '');
  const lesson = (document.getElementById('rightLesson')?.textContent || '');
  const main = document.getElementById('mainLesson');
  if(!main) return;
  const isEval = /GĐ5|Đánh giá|thử việc|Bảng tổng hợp|bảng đánh giá|Tổng hợp dữ liệu/i.test(stage + ' ' + lesson + ' ' + main.textContent);
  main.classList.toggle('phf-eval-page', !!isEval);
  if(isEval){
    const original = main.querySelector('.original-content') || main;
    const canPrintThisPage = !!original.querySelector('.print-template') || /Bản tổng hợp sau khi hoàn tất đánh giá thử việc/i.test(lesson);
    if(canPrintThisPage && !original.querySelector('.phf-print-actions')){
      const box = document.createElement('div');
      box.className = 'phf-print-actions';
      box.innerHTML = '<span class="phf-print-hint">Phiếu lưu hồ sơ: có thể in sau khi rà nội dung.</span><button type="button" class="phf-print-btn">In phiếu</button>';
      box.querySelector('button').addEventListener('click', function(){ window.print(); });
      original.insertBefore(box, original.firstChild);
    }
  }
}

function phfReviewPolishV2(){
  const root = document.getElementById('mainLesson');
  if(!root) return;
  root.querySelectorAll('.original-content details').forEach(d=>d.open = true);
  phfNormalizeLooseQuiz(root);
  phfPolishCheckboxGroups(root);
  phfMarkEvaluationPages();
}

(function(){
  const oldRender = render;
  render = function(){
    oldRender();
    setTimeout(phfReviewPolishV2, 0);
  };
  setTimeout(phfReviewPolishV2, 0);
})();

/* PHF Bản 26: phần hồ sơ/tiến độ được tách sang assets/js/phf-progress-profile.js */
