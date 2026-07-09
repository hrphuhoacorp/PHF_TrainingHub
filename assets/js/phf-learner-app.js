/*
 * PHF Training Hub - Bản 24
 * Tách logic học viên khỏi index.html.
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
  const q = new URLSearchParams(location.search || '');
  const qRole = String(q.get('role') || '').toLowerCase();
  if(q.get('admin') === '1' || qRole === 'admin' || qRole === 'quantri' || qRole === 'quan-tri') return 'admin';
  if(q.get('manager') === '1' || q.get('quanly') === '1' || qRole === 'manager' || qRole === 'lead' || qRole === 'quanly' || qRole === 'quan-ly' || qRole === 'cht') return 'manager';
  if(qRole === 'learner' || qRole === 'hocvien' || qRole === 'hoc-vien') return 'learner';
  try{
    const savedRole = String(localStorage.getItem('phfInternalTestRole') || '').toLowerCase();
    if(['admin','manager','learner'].includes(savedRole)) return savedRole;
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
async function phfRefreshTrainingData(){
  try{
    const res = await fetch('/api/data', {cache:'no-store'});
    const json = await res.json().catch(function(){ return {}; });
    if(res.ok && json){ window.__phfLocalData = json.data || json; return true; }
  }catch(err){ console.warn('PHF refresh data error', err); }
  return false;
}
function phfTodayOnly(){ const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function phfGateInfo(l){
  if(!l || phfIsAdminMode()) return null;
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
function phfEvalCard(title, desc, btn, pattern){
  const idx = phfFindLessonIndex(pattern);
  return `<div class="eval-card"><h3>${esc(title)}</h3><p>${esc(desc)}</p>${idx>=0?`<button type="button" class="btn btn-soft eval-go" data-index="${idx}">${esc(btn)}</button>`:''}</div>`;
}
function phfCurrentEmployeeProfile(){
  try{
    const saved = JSON.parse(localStorage.getItem('phfEmployeeProfile') || '{}');
    return {
      id: saved.id || localStorage.getItem('phfEmployeeId') || '',
      fullName: saved.fullName || 'Chưa có tên học viên',
      phone: saved.phone || '',
      branch: saved.branch || 'Chưa phân chi nhánh',
      department: saved.department || 'Bán hàng',
      position: saved.position || 'Nhân viên bán hàng mới',
      studyStartDate: saved.studyStartDate || localStorage.getItem('phfStudyStartDate') || ''
    };
  }catch(e){
    return {id: localStorage.getItem('phfEmployeeId') || '', fullName:'Chưa có tên học viên', phone:'', branch:'', department:'', position:'Nhân viên bán hàng mới', studyStartDate: localStorage.getItem('phfStudyStartDate') || ''};
  }
}

function phfEmployeeFromRow(e){
  e = e || {};
  return {
    id: e.id || e.employeeId || e.employee_id || '',
    fullName: e.fullName || e.full_name || e.name || 'Chưa có tên học viên',
    phone: e.phone || '',
    branch: e.branch || e.store || 'Chưa phân chi nhánh',
    department: e.department || 'Bán hàng',
    position: e.position || 'Nhân viên bán hàng mới',
    studyStartDate: e.studyStartDate || e.study_start_date || '',
    programId: e.programId || e.program_id || 'new_sales'
  };
}
function phfAllEvaluationLearners(){
  const rows = (window.__phfLocalData && window.__phfLocalData.employees) || [];
  const list = rows.map(phfEmployeeFromRow).filter(function(e){
    if(!e.id) return false;
    if(e.id === 'admin-test-phf') return false;
    if(/admin test/i.test(e.fullName + ' ' + e.position)) return false;
    return true;
  });
  if(!list.length){
    const current = phfCurrentEmployeeProfile();
    return current.id ? [current] : [];
  }
  return list.sort(function(a,b){ return String(a.fullName||'').localeCompare(String(b.fullName||''),'vi'); });
}
function phfEvaluationTargetProfile(){
  if(!phfCanEditEvaluation()) return phfCurrentEmployeeProfile();
  const learners = phfAllEvaluationLearners();
  const savedId = localStorage.getItem('phfEvalSelectedEmployeeId') || '';
  const currentId = phfCurrentEmployeeProfile().id || '';
  let found = learners.find(function(e){ return e.id === savedId; }) || learners.find(function(e){ return e.id === currentId; }) || learners[0];
  if(found && found.id) localStorage.setItem('phfEvalSelectedEmployeeId', found.id);
  return found || phfCurrentEmployeeProfile();
}
function phfSetEvaluationTarget(id){
  if(id) localStorage.setItem('phfEvalSelectedEmployeeId', id);
  window.__phfEvalReadFresh = false;
  renderEvaluationRecords();
}
function phfRenderLearnerPicker(selectedId){
  if(!phfCanEditEvaluation()) return '';
  const learners = phfAllEvaluationLearners();
  const options = learners.map(function(e){
    const label = `${e.fullName || 'Chưa có tên'}${e.phone ? ' · ' + e.phone : ''}${e.branch ? ' · ' + e.branch : ''}`;
    return `<option value="${esc(e.id)}" ${e.id===selectedId?'selected':''}>${esc(label)}</option>`;
  }).join('');
  return `<div class="eval-learner-picker"><label>Chọn học viên cần xem/đánh giá</label><select id="evalLearnerSelect">${options}</select><div class="help">Trưởng ca/CHT/Quản lý và Quản trị có thể chọn học viên trong danh sách để xem, tạo hoặc sửa phiếu đánh giá.</div></div>`;
}
function phfBuildTimelineForProfile(profile){
  const startValue = (profile && profile.studyStartDate) || phfGetStudyStartValue();
  const start = phfParseDateInput(startValue);
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
function phfEvalStatus(start,end,hasRecord){
  if(hasRecord) return {text:'Đã đánh giá', cls:'done'};
  const today = phfTodayOnly();
  if(today.getTime() < start.getTime()) return {text:'Chưa đến hạn', cls:''};
  if(today.getTime() > end.getTime()) return {text:'Quá hạn', cls:'overdue'};
  return {text:'Đến hạn', cls:'due'};
}
function phfEvaluationRecordsFor(employeeId){
  const all = (window.__phfLocalData && window.__phfLocalData.evaluationRecords) || [];
  return all.filter(function(r){ return r.employeeId === employeeId || r.employee_id === employeeId; });
}
function phfBuildWeeklyPeriods(profile){
  const timeline = phfBuildTimelineForProfile(profile || phfEvaluationTargetProfile());
  if(!timeline) return [];
  const start = timeline.ranges[0].start;
  const end = timeline.ranges[4].end;
  const periods=[];
  let cursor = new Date(start.getTime());
  let week = 1;
  while(cursor.getTime() <= end.getTime() && week <= 9){
    const wStart = new Date(cursor.getTime());
    let wEnd = phfAddDays(wStart, 6);
    if(wEnd.getTime() > end.getTime()) wEnd = new Date(end.getTime());
    periods.push({week:week,label:'Tuần '+week,start:wStart,end:wEnd,key:'week-'+week});
    cursor = phfAddDays(wEnd, 1);
    week++;
  }
  return periods;
}
function phfExistingEvalRecord(employeeId, key, formType){
  formType = formType || 'weekly';
  return phfEvaluationRecordsFor(employeeId).find(function(r){ return (r.periodKey || r.period_key) === key && (r.formType || r.form_type || 'weekly') === formType; }) || null;
}
function phfBuildMonthlyPeriods(profile){
  const timeline = phfBuildTimelineForProfile(profile || phfEvaluationTargetProfile());
  if(!timeline) return [];
  const start = timeline.ranges[0].start;
  const end = timeline.ranges[4].end;
  let m1End = phfAddDays(start, 29);
  if(m1End.getTime() > end.getTime()) m1End = new Date(end.getTime());
  const m2Start = phfAddDays(m1End, 1);
  const periods = [{month:1,label:'Tháng 1',start:start,end:m1End,key:'month-1',formType:'monthly'}];
  if(m2Start.getTime() <= end.getTime()) periods.push({month:2,label:'Tháng 2',start:m2Start,end:end,key:'month-2',formType:'monthly'});
  return periods;
}
function phfBuildFinalPeriod(profile){
  const timeline = phfBuildTimelineForProfile(profile || phfEvaluationTargetProfile());
  if(!timeline) return [];
  return [{label:'Kết thúc thử việc', start:timeline.ranges[4].start, end:timeline.ranges[4].end, key:'final-probation', formType:'final'}];
}
function phfBuildEvaluationPeriods(profile){
  return phfBuildWeeklyPeriods(profile).map(function(p){ return {...p, formType:'weekly'}; }).concat(phfBuildMonthlyPeriods(profile)).concat(phfBuildFinalPeriod(profile));
}
function phfPeriodRecord(employeeId, period){
  return phfExistingEvalRecord(employeeId, period && period.key, period && period.formType || 'weekly');
}
function phfPickDefaultWeek(periods, employeeId){
  const today = phfTodayOnly();
  let selected = periods.find(function(p){ return today.getTime() >= p.start.getTime() && today.getTime() <= p.end.getTime(); });
  if(!selected) selected = periods.find(function(p){ return !phfPeriodRecord(employeeId,p) && today.getTime() > p.end.getTime(); });
  return selected || periods[0];
}
function phfWeeklyCriteria(){
  return [
    ['attitude','Thái độ, tác phong'],
    ['learning','Tiếp thu hướng dẫn'],
    ['practice','Thực hành tại cửa hàng'],
    ['customer','Giao tiếp / CSKH'],
    ['teamwork','Phối hợp nội bộ'],
    ['discipline','Giờ giấc / nội quy']
  ];
}
function phfMonthlyCriteria(){
  return [
    ['discipline','Kỷ luật, tác phong'],
    ['customer','CSKH và giao tiếp'],
    ['sales','Kỹ năng bán hàng'],
    ['process','Tuân thủ quy trình'],
    ['teamwork','Phối hợp với đội nhóm'],
    ['result','Kết quả và mức độ phù hợp']
  ];
}
function phfFinalCriteria(){
  return [
    ['discipline','Tác phong, kỷ luật và thái độ làm việc'],
    ['learning','Mức độ tiếp thu đào tạo'],
    ['customer','CSKH và giao tiếp với khách'],
    ['sales','Kỹ năng bán hàng và tư vấn'],
    ['process','Tuân thủ quy trình vận hành'],
    ['fit','Mức độ phù hợp với vị trí']
  ];
}
function phfCriteriaForPeriod(period){
  if(period && period.formType === 'final') return phfFinalCriteria();
  return period && period.formType === 'monthly' ? phfMonthlyCriteria() : phfWeeklyCriteria();
}
function phfEvalFormName(period){
  if(period && period.formType === 'final') return 'Phiếu đánh giá kết thúc thử việc';
  if(period && period.formType === 'monthly') return 'Phiếu đánh giá tháng';
  return 'Phiếu đánh giá tuần';
}
function phfEvalDisplayTitle(period){
  if(period && period.formType === 'final') return 'Phiếu đánh giá kết thúc thử việc';
  const number = period && (period.formType === 'monthly' ? period.month : period.week);
  return `${phfEvalFormName(period)}${number ? ' ' + number : ''}`;
}
function phfEvalShortType(period){
  if(period && period.formType === 'final') return 'Phiếu kết thúc';
  if(period && period.formType === 'monthly') return 'Phiếu tháng';
  return 'Phiếu tuần';
}
function phfEvalSaveType(period){
  if(period && period.formType === 'final') return 'evaluation-final';
  return period && period.formType === 'monthly' ? 'evaluation-monthly' : 'evaluation-weekly';
}
function phfConclusionForPeriod(period, items){
  if(period && period.formType === 'final'){
    const el = document.getElementById('weeklyConclusion');
    return (el && el.value) ? el.value : 'Đề xuất khác';
  }
  return phfEvalOverallText(items);
}
function phfRadioGroup(name, title){
  const options = ['Tốt','Đạt','Cần nhắc','Chưa đạt'];
  return `<div class="criteria-card"><b>${esc(title)}</b><div class="criteria-options">${options.map(function(o,i){return `<label><input type="radio" name="${esc(name)}" value="${esc(o)}" ${i===1?'checked':''}> ${esc(o)}</label>`;}).join('')}</div></div>`;
}
function phfEvalLevelClass(value){
  if(value === 'Tốt' || value === 'Đạt') return 'good';
  if(value === 'Cần nhắc' || value === 'Cần theo dõi') return 'watch';
  if(value === 'Chưa đạt') return 'risk';
  return '';
}
function phfEvalOverallText(items){
  const values = Object.values(items || {});
  if(values.includes('Chưa đạt')) return 'Cần kèm thêm';
  if(values.includes('Cần nhắc')) return 'Cần theo dõi';
  if(values.includes('Tốt')) return 'Ổn định';
  return values.length ? 'Đã ghi nhận' : 'Chưa có dữ liệu';
}
function phfEvalUpdatedText(record){
  if(!record) return '-';
  const value = record.updatedAt || record.updated_at || record.savedAt || record.saved_at || '';
  return value ? phfFormatDateTimeVN(value) : 'Đã lưu';
}

function phfFinalEvaluationGroups(){
  return [
    {id:'sales', no:'1', title:'Bán hàng & CSKH', sub:'tách từng kỹ năng để chấm chính xác', items:[
      ['sales-greet','1.1','Chủ động chào hỏi và tiếp cận khách hàng','Quan sát sự chủ động, thái độ, giọng nói và cách mở đầu với khách.'],
      ['sales-need','1.2','Lắng nghe và nắm nhu cầu khách hàng','Không chỉ hỏi cho có, cần hiểu khách mua cho ai, ngân sách, mục đích sử dụng.'],
      ['sales-consult','1.3','Tư vấn sản phẩm phù hợp với nhu cầu và ngân sách','Biết gợi ý sản phẩm phù hợp, không tư vấn lan man hoặc quá sức mua của khách.'],
      ['sales-objection','1.4','Xử lý câu hỏi, từ chối hoặc tình huống khó của khách','Ví dụ: khách so sánh giá, khách phân vân, khách chưa muốn mua.'],
      ['sales-close','1.5','Chốt đơn, hướng dẫn thanh toán và tiễn khách','Hoàn tất trải nghiệm mua hàng rõ ràng, lịch sự và đúng quy trình.']
    ]},
    {id:'display', no:'2', title:'Hàng hóa & trưng bày', sub:'theo việc thực tế tại cửa hàng', items:[
      ['display-clean','2.1','Sắp xếp hàng hóa gọn gàng, sạch đẹp','Biết giữ khu vực bán hàng gọn sau ca cao điểm.'],
      ['display-quality','2.2','Kiểm tra chất lượng hàng hóa khi bán','Biết quan sát hàng lỗi, hàng mềm, hàng cần báo quản lý.'],
      ['display-date','2.3','Theo dõi date, hàng cần ưu tiên bán và báo quản lý','Không cần tự quyết định một mình, nhưng phải biết báo đúng người.'],
      ['display-label','2.4','Bảng giá, tem nhãn và thông tin sản phẩm','Nhận biết thiếu bảng giá/tem nhãn và báo người phụ trách.']
    ]},
    {id:'process', no:'3', title:'Quy trình & báo cáo', sub:'đánh giá tính ổn định', items:[
      ['process-time','3.1','Chấm công, tuân thủ ca làm và nội quy cửa hàng','Theo dõi sự đúng giờ, trang phục, thái độ làm việc trong ca.'],
      ['process-checklist','3.2','Thực hiện danh sách việc cửa hàng theo hướng dẫn','Biết làm theo checklist, không bỏ sót việc quan trọng.'],
      ['process-report','3.3','Báo cáo vấn đề phát sinh đúng người, đúng thời điểm','Biết báo ca trưởng/quản lý khi có phát sinh trong ca.'],
      ['process-handover','3.4','Bàn giao ca rõ ràng','Biết bàn giao việc còn dở, vấn đề phát sinh và lưu ý cần theo dõi.']
    ]},
    {id:'attitude', no:'4', title:'Thái độ & phối hợp', sub:'căn cứ quyết định sau thử việc', items:[
      ['attitude-learn','4.1','Chủ động học hỏi trong quá trình làm việc','Có tinh thần cầu thị, chịu hỏi và chịu học.'],
      ['attitude-feedback','4.2','Tiếp thu góp ý và điều chỉnh sau khi được nhắc','Không lặp lại lỗi nhiều lần sau khi được hướng dẫn.'],
      ['attitude-team','4.3','Phối hợp với đồng nghiệp trong ca làm','Có tinh thần hỗ trợ, phối hợp và tôn trọng đồng đội.'],
      ['attitude-responsibility','4.4','Tinh thần trách nhiệm với công việc được giao','Có trách nhiệm hoàn thành việc được phân công, không bỏ ngang.']
    ]}
  ];
}
function phfFinalRatingValue(item){
  if(!item) return 'Đạt';
  if(typeof item === 'string') return item === 'Cần nhắc' ? 'Cần theo dõi' : item;
  return item.value || item.rating || 'Đạt';
}
function phfFinalNoteValue(item){
  if(!item || typeof item === 'string') return '';
  return item.note || '';
}
function phfFinalNeedsNote(value){
  return value === 'Cần theo dõi' || value === 'Chưa đạt' || value === 'Cần nhắc';
}
function phfFinalRatingClass(value){
  if(value === 'Tốt') return 'rating-good';
  if(value === 'Đạt') return 'rating-pass';
  if(value === 'Cần theo dõi' || value === 'Cần nhắc') return 'rating-watch';
  if(value === 'Chưa đạt') return 'rating-fail';
  return 'rating-pass';
}
function phfApplyFinalRatingState(sel){
  if(!sel) return;
  sel.classList.remove('rating-good','rating-pass','rating-watch','rating-fail');
  sel.classList.add(phfFinalRatingClass(sel.value));
  const key = sel.getAttribute('data-final-rating');
  const card = key ? document.querySelector(`[data-final-card="${CSS.escape(key)}"]`) : null;
  const needsNote = phfFinalNeedsNote(sel.value);
  if(card){
    card.classList.toggle('is-warning', needsNote);
    const must = card.querySelector('.final-must-note');
    if(must) must.classList.toggle('is-hidden', !needsNote);
    const note = card.querySelector('[data-final-note]');
    const label = card.querySelector('.final-eval-note label');
    if(note){
      note.placeholder = needsNote ? 'Bắt buộc ghi rõ tình huống, biểu hiện hoặc hướng xử lý' : 'Không bắt buộc nếu Tốt/Đạt';
    }
    if(label){
      label.textContent = needsNote ? 'Ghi chú / bằng chứng bắt buộc' : 'Ghi chú / bằng chứng';
    }
  }
}
function phfFinalConclusionClass(value){
  if(value === 'Đạt, đề nghị tiếp nhận chính thức') return 'rating-pass';
  if(value === 'Chưa phù hợp') return 'rating-fail';
  return 'rating-watch';
}
function phfApplyFinalConclusionState(sel){
  if(!sel) return;
  sel.classList.remove('rating-pass','rating-watch','rating-fail');
  sel.classList.add(phfFinalConclusionClass(sel.value));
}
function phfFinalSafeKey(key){
  return String(key || '').replace(/[^a-zA-Z0-9_-]/g,'');
}
function phfRenderFinalCriterionCard(item, saved){
  const key = phfFinalSafeKey(item[0]);
  const no = item[1], title = item[2], help = item[3];
  const value = phfFinalRatingValue(saved && saved[key]);
  const note = phfFinalNoteValue(saved && saved[key]);
  const opts = ['Tốt','Đạt','Cần theo dõi','Chưa đạt'];
  const needs = phfFinalNeedsNote(value);
  return `<div class="final-eval-card ${needs?'is-warning':''}" data-final-card="${esc(key)}">
    <div class="final-eval-no">${esc(no)}</div>
    <div class="final-eval-main"><div class="final-eval-title">${esc(title)}</div><div class="final-eval-help">${esc(help)}</div></div>
    <div class="final-eval-rating"><label>Mức đánh giá</label><select class="final-rating-source ${esc(phfFinalRatingClass(value))}" id="finalRating_${esc(key)}" data-final-rating="${esc(key)}">${opts.map(function(o){return `<option value="${esc(o)}" ${o===value?'selected':''}>${esc(o)}</option>`;}).join('')}</select><span class="final-must-note ${needs?'':'is-hidden'}">Bắt buộc ghi chú</span></div>
    <div class="final-eval-note"><label>${needs?'Ghi chú / bằng chứng bắt buộc':'Ghi chú / bằng chứng'}</label><textarea id="finalNote_${esc(key)}" data-final-note="${esc(key)}" placeholder="${needs?'Bắt buộc ghi rõ tình huống, biểu hiện hoặc hướng xử lý':'Không bắt buộc nếu Tốt/Đạt'}">${esc(note)}</textarea></div>
  </div>`;
}
function phfRenderFinalEvaluationForm(period){
  if(!period) return;
  if(!phfCanEditEvaluation()){ phfRenderFinalEvaluationView(period); return; }
  const profile = phfEvaluationTargetProfile();
  const existing = phfPeriodRecord(profile.id, period);
  const savedItems = existing && (existing.statusItems || existing.status_items || {}) || {};
  const groups = phfFinalEvaluationGroups();
  const flat = groups.reduce(function(a,g){ return a.concat(g.items); }, []);
  const countMap = {good:0, pass:0, watch:0, fail:0};
  flat.forEach(function(it){ const v = phfFinalRatingValue(savedItems[it[0]]); if(v==='Tốt') countMap.good++; else if(v==='Đạt') countMap.pass++; else if(v==='Cần theo dõi' || v==='Cần nhắc') countMap.watch++; else if(v==='Chưa đạt') countMap.fail++; });
  const status = phfEvalStatus(period.start, period.end, !!existing);
  const finalReason = (savedItems.__finalRequiredReason && savedItems.__finalRequiredReason.note) || '';
  const form = `<div class="eval-detail-head"><h3>${existing?'Sửa phiếu đánh giá kết thúc thử việc':'Tạo phiếu đánh giá kết thúc thử việc'}</h3><div class="tools"><button class="eval-doc-btn" type="button" onclick="renderEvaluationRecords('${esc(period.key)}','view')">Xem phiếu</button></div></div>
  <div class="eval-form-clean final-eval-form">
    <div class="weekly-form-head"><div><h3>Nhập đánh giá kết thúc thử việc</h3><div class="meta">Thời gian: ${phfFormatRangeFull(period.start, period.end)} · <span class="weekly-pill ${status.cls}">${status.text}</span></div></div></div>
    <div class="final-eval-admin-note"><b>Quy tắc bắt buộc:</b> Nếu chọn Cần theo dõi, Chưa đạt, Gia hạn, Không phù hợp hoặc Đề xuất khác, người đánh giá phải nhập nội dung cụ thể trước khi lưu phiếu.</div>
    <div class="final-eval-overview"><div class="final-eval-metric"><b>${countMap.good}</b><span>Tốt</span></div><div class="final-eval-metric"><b>${countMap.pass}</b><span>Đạt</span></div><div class="final-eval-metric"><b>${countMap.watch}</b><span>Cần theo dõi</span></div><div class="final-eval-metric"><b>${countMap.fail}</b><span>Chưa đạt</span></div></div>
    ${groups.map(function(g){ return `<section class="final-eval-group"><div class="final-eval-group-head"><div class="final-eval-group-no">${esc(g.no)}</div><div class="final-eval-group-title">${esc(g.title)}</div><div class="final-eval-group-sub">${esc(g.sub)}</div></div><div class="final-eval-list">${g.items.map(function(item){ return phfRenderFinalCriterionCard(item, savedItems); }).join('')}</div></section>`; }).join('')}
    <section class="final-eval-group"><div class="final-eval-group-head"><div class="final-eval-group-no">5</div><div class="final-eval-group-title">Tổng hợp & kết luận</div><div class="final-eval-group-sub">ý kiến khác bắt buộc ghi rõ</div></div><div class="final-summary-grid">
      <div><div class="final-field"><label>Người đánh giá</label><input id="weeklyEvaluator" value="${esc((existing && existing.evaluator) || localStorage.getItem('phfEvaluatorName') || '')}" placeholder="VD: CHT / Quản lý / HCNS"></div><div class="final-field"><label>Nhận xét tổng quan</label><textarea id="weeklyNotes" placeholder="Ghi nhận xét tổng quan sau thời gian thử việc.">${esc(existing && (existing.notes || '') || '')}</textarea></div><div class="final-field"><label>Góp ý / định hướng sau thử việc</label><textarea id="weeklyNextFocus" placeholder="VD: tiếp tục kèm kỹ năng tư vấn, xử lý từ chối...">${esc(existing && (existing.nextFocus || existing.next_focus || '') || '')}</textarea></div></div>
      <div><div class="final-field"><label>Kết luận thử việc</label><select id="weeklyConclusion"><option value="Đạt, đề nghị tiếp nhận chính thức">Đạt, đề nghị tiếp nhận chính thức</option><option value="Đạt nhưng cần tiếp tục theo dõi">Đạt nhưng cần tiếp tục theo dõi</option><option value="Gia hạn thử việc / thử thách thêm">Gia hạn thử việc / thử thách thêm</option><option value="Chưa phù hợp">Chưa phù hợp</option><option value="Đề xuất khác">Đề xuất khác</option></select></div><div class="final-field"><label>Nội dung bắt buộc khi có đề xuất/theo dõi/chưa đạt</label><textarea id="finalRequiredReason" placeholder="Ghi rõ lý do, hướng xử lý hoặc thời gian theo dõi thêm nếu có.">${esc(finalReason)}</textarea><div class="final-required-note">Hệ thống sẽ kiểm tra ô này trước khi lưu nếu phiếu có tiêu chí Cần theo dõi/Chưa đạt hoặc kết luận không phải “Đạt, đề nghị tiếp nhận chính thức”.</div></div><input type="hidden" id="weeklyIssues" value=""></div>
    </div></section>
    <div class="eval-save-toolbar"><div class="eval-save-status"><span class="eval-save-kicker">Trạng thái lưu phiếu</span><span class="weekly-save-note" id="weeklySaveNote">${existing?'Phiếu này đã có dữ liệu. Lưu lại sẽ cập nhật phiếu cũ, không tạo thêm dòng mới.':'Điền nội dung cần ghi nhận rồi bấm lưu phiếu.'}</span></div><div class="eval-save-actions"><button class="eval-save-btn secondary" type="button" onclick="renderEvaluationRecords('${esc(period.key)}','view')">Xem phiếu</button><button class="eval-save-btn primary" type="button" id="saveWeeklyEvalBtn">Lưu phiếu đánh giá</button></div></div>
  </div>`;
  const box = document.getElementById('weeklyFormBox');
  if(box) box.innerHTML = form;
  const conclusionSelect = document.getElementById('weeklyConclusion');
  if(conclusionSelect && existing && existing.conclusion) conclusionSelect.value = existing.conclusion;
  document.querySelectorAll('[data-final-rating]').forEach(function(sel){
    phfApplyFinalRatingState(sel);
    sel.addEventListener('change', function(){ phfApplyFinalRatingState(sel); });
  });
  const conclusionSelectForUi = document.getElementById('weeklyConclusion');
  if(conclusionSelectForUi){
    phfApplyFinalConclusionState(conclusionSelectForUi);
    conclusionSelectForUi.addEventListener('change', function(){ phfApplyFinalConclusionState(conclusionSelectForUi); });
  }
  const saveBtn = document.getElementById('saveWeeklyEvalBtn');
  if(saveBtn) saveBtn.onclick = function(){ phfSaveWeeklyEvaluation(period); };
}
function phfFinalGroupSummary(statusItems){
  return phfFinalEvaluationGroups().map(function(g){
    const vals = g.items.map(function(it){ return phfFinalRatingValue(statusItems && statusItems[it[0]]); });
    let result = 'Đạt';
    if(vals.includes('Chưa đạt')) result = 'Chưa đạt';
    else if(vals.includes('Cần theo dõi') || vals.includes('Cần nhắc')) result = 'Cần theo dõi';
    else if(vals.every(function(v){return v==='Tốt';})) result = 'Tốt';
    const notes = g.items.map(function(it){ const n = phfFinalNoteValue(statusItems && statusItems[it[0]]); return n ? `${it[1]} ${n}` : ''; }).filter(Boolean);
    return {group:g.title,result:result,note:notes.join(' ') || 'Không có ghi nhận đặc biệt.'};
  });
}
function phfRenderFinalPaper(profile, period, existing){
  const items = existing && (existing.statusItems || existing.status_items || {}) || {};
  const summaries = phfFinalGroupSummary(items);
  const flagged = [];
  phfFinalEvaluationGroups().forEach(function(g){ g.items.forEach(function(it){ const v=phfFinalRatingValue(items[it[0]]); const n=phfFinalNoteValue(items[it[0]]); if(phfFinalNeedsNote(v) || n){ flagged.push({title:it[2], value:v, note:n || 'Chưa ghi chú.'}); } }); });
  return `<div class="final-paper"><div class="final-paper-title">Bản đánh giá nhân sự thử việc</div>
    <table class="final-paper-info"><tr><th>Họ tên</th><td>${esc(profile.fullName || '')}</td><th>SĐT/Mã NS</th><td>${esc(profile.phone || profile.employeeCode || 'Chưa có')}</td></tr><tr><th>Vị trí</th><td>${esc(profile.position || 'Nhân viên bán hàng')}</td><th>Chi nhánh</th><td>${esc(profile.branch || 'Chưa phân chi nhánh')}</td></tr><tr><th>Thử việc</th><td>${phfFormatRangeFull(period.start, period.end)}</td><th>Người đánh giá</th><td>${esc(existing.evaluator || 'Đã lưu')}</td></tr></table>
    <div class="final-paper-section">1. Kết quả đánh giá theo nhóm tiêu chí</div><table class="final-paper-table"><thead><tr><th>Nhóm tiêu chí</th><th>Kết quả chung</th><th>Ghi nhận chính</th></tr></thead><tbody>${summaries.map(function(r){return `<tr><td>${esc(r.group)}</td><td class="final-paper-center">${esc(r.result)}</td><td>${esc(r.note)}</td></tr>`;}).join('')}</tbody></table>
    <div class="final-paper-section">2. Các nội dung cần theo dõi / bắt buộc ghi nhận</div><table class="final-paper-table"><thead><tr><th>Tiêu chí</th><th>Mức</th><th>Nội dung ghi nhận</th></tr></thead><tbody>${flagged.length?flagged.map(function(r){return `<tr><td>${esc(r.title)}</td><td class="final-paper-center">${esc(r.value)}</td><td>${esc(r.note)}</td></tr>`;}).join(''):'<tr><td colspan="3" class="final-paper-center">Không có nội dung cần theo dõi đặc biệt.</td></tr>'}</tbody></table>
    <div class="final-paper-section">3. Kết luận</div><div class="final-paper-summary"><div><b>Nhận xét:</b> ${esc(existing.notes || 'Chưa có nhận xét.')}<br><br><b>Góp ý:</b> ${esc(existing.nextFocus || existing.next_focus || 'Chưa có góp ý.')}</div><div><b>Kết luận:</b><br>${esc(existing.conclusion || 'Chưa kết luận')}<br><br><b>Theo dõi/đề xuất:</b><br>${esc((items.__finalRequiredReason && items.__finalRequiredReason.note) || 'Không có ghi nhận thêm.')}</div></div>
    <div class="final-signs"><div class="final-sign"><b>Người đánh giá</b>${esc(existing.evaluator || '')}</div><div class="final-sign"><b>Quản lý / CHT</b>Ký xác nhận</div><div class="final-sign"><b>HCNS</b>Lưu hồ sơ</div></div>
  </div>`;
}
function phfRenderFinalEvaluationView(period){
  const profile = phfEvaluationTargetProfile();
  const existing = phfPeriodRecord(profile.id, period);
  const canEdit = phfCanEditEvaluation();
  const box = document.getElementById('weeklyFormBox');
  if(!box) return;
  if(!existing){
    box.innerHTML = `<div class="eval-detail-head"><h3>Phiếu đánh giá kết thúc thử việc</h3><div class="tools">${canEdit?`<button class="eval-doc-btn dark" type="button" onclick="renderEvaluationRecords('${esc(period.key)}','edit')">Tạo phiếu</button>`:''}</div></div><div class="eval-empty clean">Chưa có phiếu kết thúc thử việc được lưu. ${canEdit?'Có thể tạo phiếu khi đã có đủ nhận xét thực tế.':'Khi người phụ trách lưu phiếu, bạn sẽ xem lại được nội dung tại đây.'}</div>`;
    return;
  }
  box.innerHTML = `<div class="eval-detail-head"><h3>Phiếu đánh giá kết thúc thử việc</h3><div class="tools">${canEdit?`<button class="eval-doc-btn" type="button" onclick="renderEvaluationRecords('${esc(period.key)}','edit')">Sửa phiếu</button>`:''}<button class="eval-doc-btn dark" type="button" onclick="phfPrintEvaluationCurrentDocument()">In / lưu bản điện tử</button></div></div>${phfRenderFinalPaper(profile, period, existing)}`;
}
async function phfSaveFinalEvaluation(period){
  if(!phfCanEditEvaluation()) return;
  const profile = phfEvaluationTargetProfile();
  const evaluator = (document.getElementById('weeklyEvaluator')?.value || '').trim();
  if(!evaluator){ phfToast('warning','Thiếu người đánh giá','Vui lòng nhập người đánh giá trước khi lưu phiếu.', 3800, 'evaluation-save'); return; }
  localStorage.setItem('phfEvaluatorName', evaluator);
  const statusItems = {};
  let missing = [];
  phfFinalEvaluationGroups().forEach(function(g){
    g.items.forEach(function(it){
      const key = it[0];
      const rating = (document.getElementById('finalRating_'+key)?.value || 'Đạt').trim();
      const note = (document.getElementById('finalNote_'+key)?.value || '').trim();
      statusItems[key] = {value: rating, note: note, group: g.title, title: it[2], no: it[1]};
      const card = document.querySelector(`[data-final-card="${CSS.escape(key)}"]`);
      if(card) card.classList.remove('is-missing');
      if(phfFinalNeedsNote(rating) && !note){ missing.push(it[1]+' '+it[2]); if(card) card.classList.add('is-missing'); }
    });
  });
  const conclusion = (document.getElementById('weeklyConclusion')?.value || '').trim();
  const finalReason = (document.getElementById('finalRequiredReason')?.value || '').trim();
  const hasWatch = Object.values(statusItems).some(function(v){ return phfFinalNeedsNote(phfFinalRatingValue(v)); });
  if((hasWatch || conclusion !== 'Đạt, đề nghị tiếp nhận chính thức') && !finalReason){ missing.push('Nội dung bắt buộc khi có đề xuất/theo dõi/chưa đạt'); }
  if(missing.length){
    phfToast('warning','Thiếu nội dung bắt buộc','Vui lòng ghi rõ các mục cần theo dõi/chưa đạt trước khi lưu.', 5200, 'evaluation-save');
    phfModal('warning','Thiếu nội dung bắt buộc','Các mục sau cần ghi nội dung cụ thể:\n- '+missing.slice(0,8).join('\n- ')+(missing.length>8?'\n- ...':''));
    return;
  }
  statusItems.__finalRequiredReason = {value:'Nội dung theo dõi/đề xuất', note: finalReason};
  const issues = Object.values(statusItems).filter(function(v){ return v && typeof v === 'object' && phfFinalNeedsNote(phfFinalRatingValue(v)); }).map(function(v){ return `${v.no || ''} ${v.title || ''}: ${v.note || ''}`; }).join('\n');
  const record = {id:`eval-final-${profile.id}-${period.key}`, employeeId:profile.id, formType:'final', periodKey:period.key, periodLabel:period.label, periodStart:phfIsoDate(period.start), periodEnd:phfIsoDate(period.end), evaluator:evaluator, statusItems:statusItems, notes:(document.getElementById('weeklyNotes')?.value || '').trim(), issues:issues, nextFocus:(document.getElementById('weeklyNextFocus')?.value || '').trim(), conclusion:conclusion};
  const saveBtn = document.getElementById('saveWeeklyEvalBtn');
  try{
    phfSetButtonLoading(saveBtn, true, 'Đang lưu phiếu');
    phfToast('info','Đang lưu phiếu đánh giá','Hệ thống đang ghi nhận phiếu lên dữ liệu.', 0, 'evaluation-save');
    const res = await fetch('/api/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:phfEvalSaveType(period),adminMode:phfCanEditEvaluation(),employee:profile,currentPage:window.phfCurrentLessonKey || 'evaluation:evaluation-records',skipProgress:true,evaluationRecord:record})});
    const json = await res.json().catch(function(){ return {}; });
    if(res.ok && json && json.ok){
      window.__phfLocalData = json.data || window.__phfLocalData;
      const note = document.getElementById('weeklySaveNote'); if(note) note.textContent = 'Đã lưu phiếu đánh giá lên dữ liệu.';
      phfToast('success','Đã lưu phiếu đánh giá','Phiếu kết thúc thử việc đã được ghi nhận thành công.', 2600, 'evaluation-save');
      renderEvaluationRecords(record.periodKey, 'view', {silentNotice:true});
    }else{
      phfToast('error','Chưa lưu được phiếu', (json && json.error) ? json.error : 'Hệ thống chưa ghi nhận được phiếu đánh giá. Vui lòng thử lại.', 5200, 'evaluation-save');
    }
  }catch(err){
    console.warn('PHF final eval save error', err);
    phfToast('error','Lỗi kết nối','Chưa kết nối được máy chủ để lưu phiếu.', 5200, 'evaluation-save');
  }finally{ phfSetButtonLoading(saveBtn, false); }
}


/* PHF PATCH 2026-07-08 Stage 3.14.7: In riêng phiếu đánh giá bằng cửa sổ sạch, không kéo layout web vào bản in. */
function phfBuildEvaluationPrintHTML(title, documentHTML){
  const safeTitle = String(title || 'Phiếu đánh giá PHF').replace(/[<>]/g,'');
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
  @page{size:A4 portrait;margin:14mm 13mm;}
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:#fff;color:#111;}
  body{font-family:Arial,"Helvetica Neue",Helvetica,system-ui,sans-serif;font-size:11.5pt;line-height:1.42;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .phf-eval-print-doc{width:100%;max-width:184mm;margin:0 auto;background:#fff;color:#111;}
  .eval-document{background:#fff!important;color:#111!important;border:0!important;margin:0!important;padding:0!important;box-shadow:none!important;font-family:Arial,"Helvetica Neue",Helvetica,system-ui,sans-serif!important;}
  .eval-document-title{text-align:center!important;border-bottom:2px solid #111!important;margin:0 0 14px!important;padding:0 0 10px!important;}
  .eval-document-title h2{font-size:17pt!important;line-height:1.18!important;letter-spacing:.5px!important;text-transform:uppercase!important;margin:0!important;color:#111!important;}
  .eval-document-title p{margin:5px 0 0!important;color:#333!important;font-size:10.5pt!important;font-weight:700!important;}
  .eval-doc-section{margin-top:12px!important;break-inside:avoid-page;page-break-inside:avoid;}
  .eval-doc-section h4{font-size:11pt!important;text-transform:uppercase!important;letter-spacing:.3px!important;margin:0 0 7px!important;color:#111!important;}
  .eval-doc-grid{display:grid!important;grid-template-columns:1fr 1fr!important;gap:5px 18mm!important;}
  .eval-doc-field{display:grid!important;grid-template-columns:32mm 1fr!important;gap:5px!important;font-size:10.5pt!important;line-height:1.35!important;}
  .eval-doc-field b{color:#333!important;font-weight:700!important;}
  .eval-doc-field span{color:#111!important;font-weight:700!important;overflow-wrap:anywhere;}
  .eval-doc-table{width:100%!important;border-collapse:collapse!important;border-top:1.5px solid #111!important;border-bottom:1.5px solid #111!important;margin-top:7px!important;font-size:10.5pt!important;}
  .eval-doc-table th{background:#fff!important;color:#111!important;border-bottom:1.2px solid #111!important;padding:6px 7px!important;text-align:left!important;font-size:9.5pt!important;text-transform:uppercase!important;}
  .eval-doc-table td{background:#fff!important;color:#111!important;border-bottom:1px solid #ddd!important;padding:6px 7px!important;vertical-align:top!important;}
  .eval-doc-table tr:last-child td{border-bottom:0!important;}
  .eval-rate{letter-spacing:1.5px!important;font-weight:900!important;white-space:nowrap!important;}
  .eval-level-text{display:block!important;font-weight:700!important;}
  .eval-doc-note-grid{display:grid!important;grid-template-columns:1fr 1fr!important;gap:8px 16mm!important;border-top:1px solid #aaa!important;margin-top:13px!important;padding-top:11px!important;}
  .eval-doc-note{min-height:58px!important;border-bottom:1px solid #ddd!important;padding-bottom:7px!important;break-inside:avoid-page;page-break-inside:avoid;}
  .eval-doc-note b{display:block!important;color:#111!important;text-transform:uppercase!important;font-size:10pt!important;margin-bottom:4px!important;}
  .eval-doc-note p{margin:0!important;color:#222!important;white-space:pre-wrap!important;line-height:1.4!important;font-size:10.5pt!important;}
  .eval-sign-row{display:grid!important;grid-template-columns:1fr 1fr 1fr!important;gap:12mm!important;border-top:1.5px solid #111!important;margin-top:12px!important;padding-top:11px!important;text-align:center!important;break-inside:avoid-page;page-break-inside:avoid;}
  .eval-sign-row b{display:block!important;text-transform:uppercase!important;font-size:9.5pt!important;color:#111!important;}
  .eval-sign-row span{display:block!important;margin-top:22mm!important;border-top:1px dotted #777!important;padding-top:4px!important;font-size:9.5pt!important;color:#333!important;}
  .final-paper{width:100%!important;max-width:none!important;margin:0!important;background:#fff!important;border:0!important;padding:0!important;color:#111!important;font-family:Arial,"Helvetica Neue",Helvetica,system-ui,sans-serif!important;}
  .final-paper-title{border:1.4px solid #111!important;padding:9px!important;text-align:center!important;font-weight:900!important;text-transform:uppercase!important;letter-spacing:.02em!important;color:#111!important;font-size:15pt!important;margin-bottom:9px!important;}
  .final-paper-info,.final-paper-table{width:100%!important;border-collapse:collapse!important;font-size:10.5pt!important;margin-bottom:10px!important;}
  .final-paper-info th,.final-paper-info td,.final-paper-table th,.final-paper-table td{border:1px solid #111!important;padding:5px 6px!important;text-align:left!important;vertical-align:top!important;line-height:1.35!important;}
  .final-paper-info th{background:#eef6f2!important;color:#111!important;width:30mm!important;}
  .final-paper-table th{background:#f1f1f1!important;text-align:center!important;}
  .final-paper-section{margin:11px 0 6px!important;font-weight:900!important;font-size:11pt!important;color:#111!important;}
  .final-paper-center{text-align:center!important;}
  .final-paper-summary{border:1px solid #111!important;border-top:0!important;display:grid!important;grid-template-columns:1fr 55mm!important;font-size:10.5pt!important;line-height:1.4!important;}
  .final-paper-summary>div{padding:7px!important;}
  .final-paper-summary>div:last-child{border-left:1px solid #111!important;font-weight:850!important;}
  .final-signs{display:grid!important;grid-template-columns:1fr 1fr 1fr!important;gap:12mm!important;margin-top:14px!important;text-align:center!important;break-inside:avoid-page;page-break-inside:avoid;}
  .final-sign{min-height:30mm!important;border-top:1px solid #111!important;padding-top:6px!important;font-size:10pt!important;}
  .final-sign b{display:block!important;text-transform:uppercase!important;margin-bottom:18mm!important;}
  @media print{.phf-eval-print-doc{max-width:none;width:100%;}.no-print{display:none!important;}}
</style>
</head>
<body>
  <main class="phf-eval-print-doc">${documentHTML || ''}</main>
</body>
</html>`;
}
function phfPrintEvaluationCurrentDocument(){
  const doc = document.querySelector('#weeklyFormBox .eval-document, #weeklyFormBox .final-paper');
  if(!doc){
    if(window.phfToast) phfToast('warning','Chưa có phiếu để in','Vui lòng mở phiếu đã lưu trước khi in.', 3200, 'evaluation-print');
    else alert('Chưa có phiếu để in.');
    return false;
  }
  const titleEl = doc.querySelector('.eval-document-title h2,.final-paper-title');
  const title = titleEl ? titleEl.textContent.trim() : 'Phiếu đánh giá PHF';
  const html = phfBuildEvaluationPrintHTML(title, doc.outerHTML);
  const win = window.open('', '_blank');
  if(!win){
    if(window.phfToast) phfToast('warning','Trình duyệt đang chặn cửa sổ in','Vui lòng cho phép mở cửa sổ mới để in phiếu đánh giá.', 4200, 'evaluation-print');
    else alert('Trình duyệt đang chặn cửa sổ in.');
    return false;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  try{ win.focus(); setTimeout(function(){ win.print(); }, 450); }catch(e){}
  return true;
}

function phfRenderWeeklyView(period){
  const profile = phfEvaluationTargetProfile();
  const existing = phfPeriodRecord(profile.id, period);
  const canEdit = phfCanEditEvaluation();
  const box = document.getElementById('weeklyFormBox');
  if(!box) return;
  if(period && period.formType === 'final'){ phfRenderFinalEvaluationView(period); return; }
  if(!existing){
    box.innerHTML = `<div class="eval-detail-head"><h3>${esc(period.label)} · ${phfFormatRange(period.start, period.end)}</h3><div class="tools">${canEdit?`<button class="eval-doc-btn dark" type="button" onclick="renderEvaluationRecords('${esc(period.key)}','edit')">Tạo phiếu</button>`:''}</div></div><div class="eval-empty clean">Kỳ đánh giá này chưa có phiếu được lưu. ${canEdit ? 'Có thể tạo phiếu khi đã có đủ nhận xét thực tế.' : 'Khi người phụ trách lưu phiếu, bạn sẽ xem lại được nội dung tại đây.'}</div>`;
    return;
  }
  const items = existing.statusItems || existing.status_items || {};
  const rating = function(value){
    if(value === 'Tốt') return '★★★★★';
    if(value === 'Đạt') return '★★★★☆';
    if(value === 'Cần nhắc') return '★★★☆☆';
    if(value === 'Chưa đạt') return '★★☆☆☆';
    return '—';
  };
  const criteriaRows = phfCriteriaForPeriod(period).map(function(c,idx){
    const value = items[c[0]] || 'Chưa ghi nhận';
    const noteMap = {
      'Tốt':'Thể hiện tốt trong tuần, có thể tiếp tục duy trì.',
      'Đạt':'Đáp ứng yêu cầu cơ bản, tiếp tục theo dõi trong ca làm.',
      'Cần nhắc':'Cần được nhắc lại và kèm thêm trong tuần sau.',
      'Chưa đạt':'Cần theo sát hơn và có hướng kèm cụ thể.'
    };
    return `<tr><td><b class="eval-criteria-index">${idx+1}.</b> ${esc(c[1])}</td><td><span class="eval-level-text">${esc(value)}</span><span class="eval-rate" aria-label="${esc(value)}">${rating(value)}</span></td><td>${esc(noteMap[value] || 'Chưa có ghi nhận chi tiết.')}</td></tr>`;
  }).join('');
  box.innerHTML = `<div class="eval-detail-head"><h3>Xem phiếu đánh giá</h3><div class="tools"><button class="eval-doc-btn" type="button" onclick="phfPrintEvaluationCurrentDocument()">In phiếu</button>${canEdit?`<button class="eval-doc-btn dark" type="button" onclick="renderEvaluationRecords('${esc(period.key)}','edit')">Sửa phiếu</button>`:''}</div></div>
    <article class="eval-document">
      <div class="eval-document-title"><h2>${esc(phfEvalDisplayTitle(period))}</h2><p>Thời gian: ${phfFormatRangeFull(period.start, period.end)}</p></div>
      <section class="eval-doc-section"><h4>1. Thông tin học viên</h4><div class="eval-doc-grid">
        <div class="eval-doc-field"><b>Họ và tên</b><span>${esc(profile.fullName)}</span></div>
        <div class="eval-doc-field"><b>Ngày bắt đầu</b><span>${esc(profile.studyStartDate || 'Chưa nhập')}</span></div>
        <div class="eval-doc-field"><b>SĐT</b><span>${esc(profile.phone || 'Chưa có')}</span></div>
        <div class="eval-doc-field"><b>Người đánh giá</b><span>${esc(existing.evaluator || 'Đã lưu')}</span></div>
        <div class="eval-doc-field"><b>Vị trí</b><span>${esc(profile.position || 'Nhân viên bán hàng mới')}</span></div>
        <div class="eval-doc-field"><b>Chi nhánh</b><span>${esc(profile.branch || 'Chưa phân chi nhánh')}</span></div>
      </div></section>
      <section class="eval-doc-section"><h4>2. Kết quả đánh giá</h4><table class="eval-doc-table"><thead><tr><th>Tiêu chí đánh giá</th><th>Mức đánh giá</th><th>Nhận xét ngắn</th></tr></thead><tbody>${criteriaRows}</tbody></table></section>
      <div class="eval-doc-note-grid">
        <section class="eval-doc-note"><b>3. Nhận xét tổng quan</b><p>${esc(existing.notes || 'Chưa có nhận xét.')}</p></section>
        <section class="eval-doc-note"><b>4. Lỗi / cần kèm thêm</b><p>${esc(existing.issues || 'Chưa ghi nhận.')}</p></section>
        <section class="eval-doc-note"><b>5. Hướng kèm tiếp theo</b><p>${esc(existing.nextFocus || existing.next_focus || 'Chưa ghi nhận.')}</p></section>
        <section class="eval-doc-note"><b>6. Kết luận</b><p>${esc(existing.conclusion || phfEvalOverallText(items))}</p></section>
      </div>
      <div class="eval-sign-row"><div><b>Người đánh giá</b><span>${esc(existing.evaluator || '')}</span></div><div><b>Quản lý / CHT</b><span>Ký xác nhận</span></div><div><b>HCNS</b><span>Lưu hồ sơ</span></div></div>
    </article>`;
}
function phfRenderWeeklyForm(period){
  if(!period) return;
  if(!phfCanEditEvaluation()){
    phfRenderWeeklyView(period);
    return;
  }
  if(period && period.formType === 'final'){ phfRenderFinalEvaluationForm(period); return; }
  const profile = phfEvaluationTargetProfile();
  const existing = phfPeriodRecord(profile.id, period);
  const status = phfEvalStatus(period.start, period.end, !!existing);
  const savedItems = existing && (existing.statusItems || existing.status_items || {});
  const criteria = phfCriteriaForPeriod(period);
  const form = `<div class="eval-detail-head"><h3>${existing?'Sửa '+phfEvalDisplayTitle(period).toLowerCase():'Tạo '+phfEvalDisplayTitle(period).toLowerCase()}</h3><div class="tools"><button class="eval-doc-btn" type="button" onclick="renderEvaluationRecords('${esc(period.key)}','view')">Xem phiếu</button></div></div><div class="eval-form-clean">
    <div class="weekly-form-head"><div><h3>${existing?'Cập nhật nội dung phiếu':'Nhập nội dung phiếu mới'}</h3><div class="meta">Thời gian: ${phfFormatRangeFull(period.start, period.end)} · <span class="weekly-pill ${status.cls}">${status.text}</span></div></div></div>
    <div class="weekly-help">Phiếu dành cho Trưởng ca/CHT/Quản lý hoặc Quản trị ghi nhận quan sát thực tế. Học viên chỉ xem lại phiếu đã lưu.</div>
    <div class="criteria-grid">${criteria.map(function(c){ return phfRadioGroup(c[0], c[1]); }).join('')}</div>
    <div class="weekly-text-grid"><div class="weekly-field"><label>Người đánh giá</label><input id="weeklyEvaluator" value="${esc((existing && existing.evaluator) || localStorage.getItem('phfEvaluatorName') || '')}" placeholder="VD: Trưởng ca / CHT / Quản lý"></div><div class="weekly-field"><label>Nhận xét tổng quan</label><textarea id="weeklyNotes" placeholder="Ghi ngắn gọn điểm nổi bật hoặc tình huống cần ghi nhận.">${esc(existing && (existing.notes || '') || '')}</textarea></div><div class="weekly-field"><label>Lỗi/cần kèm thêm</label><textarea id="weeklyIssues" placeholder="VD: cần kèm thêm cách hỏi nhu cầu, xác nhận đơn, tác phong...">${esc(existing && (existing.issues || '') || '')}</textarea></div><div class="weekly-field"><label>Hướng kèm tiếp theo</label><textarea id="weeklyNextFocus" placeholder="VD: tập trung CSKH, tư vấn phân khúc giá, phối hợp kho...">${esc(existing && (existing.nextFocus || existing.next_focus || '') || '')}</textarea></div>${period && period.formType === 'final' ? `<div class="weekly-field"><label>Kết luận thử việc</label><select id="weeklyConclusion"><option value="Đạt">Đạt</option><option value="Gia hạn theo dõi">Gia hạn theo dõi</option><option value="Không phù hợp">Không phù hợp</option><option value="Đề xuất khác">Đề xuất khác</option></select></div>` : ''}</div>
    <div class="eval-save-toolbar"><div class="eval-save-status"><span class="eval-save-kicker">Trạng thái lưu phiếu</span><span class="weekly-save-note" id="weeklySaveNote">${existing?'Phiếu này đã có dữ liệu. Lưu lại sẽ cập nhật phiếu cũ, không tạo thêm dòng mới.':'Điền nội dung cần ghi nhận rồi bấm lưu phiếu.'}</span></div><div class="eval-save-actions"><button class="eval-save-btn secondary" type="button" onclick="renderEvaluationRecords('${esc(period.key)}','view')">Xem phiếu</button><button class="eval-save-btn primary" type="button" id="saveWeeklyEvalBtn">Lưu phiếu đánh giá</button></div></div></div>`;
  const box = document.getElementById('weeklyFormBox');
  if(box) box.innerHTML = form;
  if(savedItems){
    Object.keys(savedItems).forEach(function(k){
      const val = savedItems[k];
      const input = document.querySelector(`#weeklyFormBox input[name="${CSS.escape(k)}"][value="${CSS.escape(val)}"]`);
      if(input) input.checked = true;
    });
  }
  const conclusionSelect = document.getElementById('weeklyConclusion');
  if(conclusionSelect && existing && existing.conclusion){
    conclusionSelect.value = existing.conclusion;
  }
  const saveBtn = document.getElementById('saveWeeklyEvalBtn');
  if(saveBtn) saveBtn.onclick = function(){ phfSaveWeeklyEvaluation(period); };
}
function phfEvalPeriodGroupKey(period){
  if(period && period.formType === 'monthly') return 'monthly';
  if(period && period.formType === 'final') return 'final';
  return 'weekly';
}
function phfEvalPeriodGroupLabel(key){
  if(key === 'monthly') return 'Phiếu tháng';
  if(key === 'final') return 'Phiếu kết thúc thử việc';
  return 'Phiếu tuần';
}
function phfRenderEvalPeriodList(periods, employeeId, selectedKey){
  const groupOrder = ['weekly','monthly','final'];
  const selectedPeriod = periods.find(function(p){ return p.key === selectedKey; });
  const selectedGroup = phfEvalPeriodGroupKey(selectedPeriod);
  const grouped = {weekly:[], monthly:[], final:[]};
  periods.forEach(function(p){ grouped[phfEvalPeriodGroupKey(p)].push(p); });
  return `<div class="eval-period-groups">${groupOrder.map(function(groupKey){
    const list = grouped[groupKey] || [];
    if(!list.length) return '';
    const expanded = groupKey === selectedGroup;
    const rows = list.map(function(p){
      const rec = phfPeriodRecord(employeeId,p);
      const st = phfEvalStatus(p.start,p.end,!!rec);
      const typeText = phfEvalShortType(p);
      return `<button class="eval-period-item ${p.key===selectedKey?'active':''}" type="button" data-action="view" data-week-key="${esc(p.key)}"><span><b>${esc(p.label)}</b><small>${esc(typeText)} · ${phfFormatRange(p.start,p.end)}</small></span><em class="eval-status-chip ${st.cls}">${esc(st.text)}</em></button>`;
    }).join('');
    return `<div class="eval-period-group" data-period-group="${esc(groupKey)}"><button class="eval-period-group-head" type="button" aria-expanded="${expanded?'true':'false'}" onclick="phfToggleEvalPeriodGroup(this)"><span>${esc(phfEvalPeriodGroupLabel(groupKey))}</span><small>${list.length} kỳ</small><em>${expanded?'−':'+'}</em></button><div class="eval-period-group-list ${expanded?'':'collapsed'}">${rows}</div></div>`;
  }).join('')}</div>`;
}
function phfToggleEvalPeriodGroup(btn){
  const group = btn && btn.closest('.eval-period-group');
  if(!group) return;
  const list = group.querySelector('.eval-period-group-list');
  const icon = btn.querySelector('em');
  if(!list) return;
  const collapsed = list.classList.toggle('collapsed');
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  if(icon) icon.textContent = collapsed ? '+' : '−';
}

function phfRenderEvalTableRows(periods, employeeId){
  const canEdit = phfCanEditEvaluation();
  return periods.map(function(p){
    const rec = phfPeriodRecord(employeeId,p);
    const st = phfEvalStatus(p.start,p.end,!!rec);
    const action = rec
      ? `<button class="eval-action primary eval-table-action" type="button" data-action="view" data-week-key="${esc(p.key)}">Xem phiếu</button>${canEdit?`<button class="eval-action edit eval-table-action" type="button" data-action="edit" data-week-key="${esc(p.key)}">Sửa phiếu</button>`:''}`
      : (canEdit ? `<button class="eval-action eval-table-action" type="button" data-action="edit" data-week-key="${esc(p.key)}">Tạo phiếu</button>` : `<button class="eval-action" type="button" disabled>Chưa có phiếu</button>`);
    const typeText = phfEvalShortType(p);
    return `<tr><td><b>${esc(p.label)}</b><div class="muted">${esc(typeText)} · ${rec?'Đã có phiếu lưu':'Chờ ghi nhận'}</div></td><td>${phfFormatRangeFull(p.start,p.end)}</td><td><span class="eval-status-chip ${st.cls}">${esc(st.text)}</span></td><td>${rec?esc(rec.evaluator || 'Đã lưu'):'<span class="muted">-</span>'}</td><td>${rec?esc(phfEvalUpdatedText(rec)):'<span class="muted">-</span>'}</td><td><div class="eval-table-actions">${action}<button class="eval-kebab" type="button" aria-label="Tùy chọn">⋮</button></div></td></tr>`;
  }).join('');
}
async function phfSaveWeeklyEvaluation(period){
  if(!phfCanEditEvaluation()){
    phfModal('warning','Không có quyền lưu phiếu','Tài khoản học viên chỉ được xem phiếu đã lưu. Việc tạo hoặc sửa phiếu dành cho Trưởng ca/Quản lý/HCNS.');
    return;
  }
  const profile = phfEvaluationTargetProfile();
  if(!profile.id){
    phfModal('warning','Chưa có hồ sơ học viên','Cần chọn đúng hồ sơ học viên trước khi lưu phiếu đánh giá.');
    return;
  }
  if(period && period.formType === 'final'){ return phfSaveFinalEvaluation(period); }
  const evaluator = (document.getElementById('weeklyEvaluator')?.value || '').trim();
  if(!evaluator){ phfToast('warning','Thiếu người đánh giá','Vui lòng nhập người đánh giá trước khi lưu phiếu.', 3800, 'evaluation-save'); return; }
  localStorage.setItem('phfEvaluatorName', evaluator);
  const statusItems = {};
  document.querySelectorAll('#weeklyFormBox input[type="radio"]:checked').forEach(function(i){ statusItems[i.name]=i.value; });
  const record = {
    id: `eval-${period.formType || 'weekly'}-${profile.id}-${period.key}`,
    employeeId: profile.id,
    formType: period.formType || 'weekly',
    periodKey: period.key,
    periodLabel: period.label,
    periodStart: phfIsoDate(period.start),
    periodEnd: phfIsoDate(period.end),
    evaluator: evaluator,
    statusItems: statusItems,
    notes: (document.getElementById('weeklyNotes')?.value || '').trim(),
    issues: (document.getElementById('weeklyIssues')?.value || '').trim(),
    nextFocus: (document.getElementById('weeklyNextFocus')?.value || '').trim(),
    conclusion: phfConclusionForPeriod(period, statusItems)
  };
  const saveBtn = document.getElementById('saveWeeklyEvalBtn');
  try{
    phfSetButtonLoading(saveBtn, true, 'Đang lưu phiếu');
    phfToast('info','Đang lưu phiếu đánh giá','Hệ thống đang ghi nhận phiếu lên dữ liệu.', 0, 'evaluation-save');
    const res = await fetch('/api/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:phfEvalSaveType(period),adminMode:phfCanEditEvaluation(),employee:profile,currentPage:window.phfCurrentLessonKey || 'evaluation:evaluation-records',skipProgress:true,evaluationRecord:record})});
    const json = await res.json().catch(function(){ return {}; });
    if(res.ok && json && json.ok){
      window.__phfLocalData = json.data || window.__phfLocalData;
      const note = document.getElementById('weeklySaveNote');
      if(note) note.textContent = 'Đã lưu phiếu đánh giá lên dữ liệu.';
      phfToast('success','Đã lưu phiếu đánh giá','Phiếu đã được ghi nhận thành công.', 2600, 'evaluation-save');
      renderEvaluationRecords(record.periodKey, 'view', { silentNotice: true });
    }else{
      phfToast('error','Chưa lưu được phiếu', (json && json.error) ? json.error : 'Hệ thống chưa ghi nhận được phiếu đánh giá. Vui lòng thử lại.', 5200, 'evaluation-save');
      phfModal('error','Chưa lưu được phiếu', (json && json.error) ? json.error : 'Hệ thống chưa ghi nhận được phiếu đánh giá. Vui lòng thử lại.');
    }
  }catch(err){
    console.warn('PHF weekly eval save error', err);
    phfToast('error','Không kết nối được server','Không lưu được phiếu đánh giá do lỗi kết nối hoặc server.', 5200, 'evaluation-save');
    phfModal('error','Không kết nối được server','Không lưu được phiếu đánh giá do lỗi kết nối hoặc server. Vui lòng thử lại sau.');
  }finally{
    phfSetButtonLoading(saveBtn, false);
  }
}
function phfMonthCards(timeline){
  if(!timeline) return '';
  const start = timeline.ranges[0].start;
  const end = timeline.ranges[4].end;
  const m1End = phfAddDays(start, 29);
  const m2Start = phfAddDays(m1End, 1);
  return `<div class="weekly-months"><div class="weekly-month-card"><b>Đánh giá tháng 1</b><span>${phfFormatRange(start,m1End)}</span></div><div class="weekly-month-card"><b>Đánh giá tháng 2</b><span>${phfFormatRange(m2Start,end)}</span></div><div class="weekly-month-card"><b>Đánh giá kết thúc</b><span>${phfFormatRange(timeline.ranges[4].start,timeline.ranges[4].end)}</span></div></div>`;
}

function phfToggleEvalPeriodList(btn){
  const groups = Array.from(document.querySelectorAll('.eval-period-group-list'));
  if(!groups.length) return;
  const shouldCollapse = groups.some(function(g){ return !g.classList.contains('collapsed'); });
  groups.forEach(function(g){ g.classList.toggle('collapsed', shouldCollapse); });
  document.querySelectorAll('.eval-period-group-head').forEach(function(head){
    head.setAttribute('aria-expanded', shouldCollapse ? 'false' : 'true');
    const icon = head.querySelector('em');
    if(icon) icon.textContent = shouldCollapse ? '+' : '−';
  });
  if(btn){
    btn.textContent = shouldCollapse ? '+' : '−';
    btn.setAttribute('aria-expanded', shouldCollapse ? 'false' : 'true');
  }
}



function phfEvalActiveTab(mode){
  if(mode === 'edit') return 'input';
  if(mode === 'history') return 'history';
  return 'view';
}
function phfRenderEvalTabs(selected, canEdit, activeTab){
  const key = selected && selected.key ? selected.key : '';
  if(!key) return '';
  return `<div class="eval-tabbar">
    <button class="eval-tabbtn ${activeTab==='input'?'active':''}" type="button" ${canEdit?'':'disabled'} onclick="${canEdit?`renderEvaluationRecords('${esc(key)}','edit')`:''}">Nhập đánh giá</button>
    <button class="eval-tabbtn ${activeTab==='view'?'active':''}" type="button" onclick="renderEvaluationRecords('${esc(key)}','view')">Xem phiếu</button>
    <button class="eval-tabbtn ${activeTab==='history'?'active':''}" type="button" onclick="renderEvaluationRecords('${esc(key)}','history')">Lịch sử hồ sơ</button>
  </div>`;
}
function phfRenderEvaluationHistory(periods, employeeId){
  const box = document.getElementById('weeklyFormBox');
  if(!box) return;
  const canEdit = phfCanEditEvaluation();
  const records = phfEvaluationRecordsFor(employeeId);
  const total = periods.length;
  const saved = periods.filter(function(p){ return !!phfPeriodRecord(employeeId,p); }).length;
  const missing = Math.max(total - saved, 0);
  const finalRec = periods.map(function(p){ return phfPeriodRecord(employeeId,p); }).find(function(r){ return r && (r.formType === 'final' || r.form_type === 'final' || r.periodKey === 'final-probation' || r.period_key === 'final-probation'); });
  const rows = periods.map(function(p){
    const rec = phfPeriodRecord(employeeId,p);
    const st = phfEvalStatus(p.start,p.end,!!rec);
    const conclusion = rec ? (rec.conclusion || 'Đã ghi nhận') : 'Chưa có phiếu';
    const action = rec
      ? `<button class="eval-action primary eval-table-action" type="button" data-action="view" data-week-key="${esc(p.key)}">Xem</button>${canEdit?`<button class="eval-action edit eval-table-action" type="button" data-action="edit" data-week-key="${esc(p.key)}">Sửa</button>`:''}`
      : (canEdit ? `<button class="eval-action eval-table-action" type="button" data-action="edit" data-week-key="${esc(p.key)}">Tạo phiếu</button>` : `<button class="eval-action" type="button" disabled>Chưa có</button>`);
    return `<tr><td><b>${esc(phfEvalShortType(p))}</b><div class="muted">${esc(p.label)}</div></td><td>${phfFormatRangeFull(p.start,p.end)}</td><td><span class="eval-status-chip ${st.cls}">${esc(st.text)}</span></td><td>${rec?esc(rec.evaluator || 'Đã lưu'):'<span class="muted">-</span>'}</td><td>${rec?esc(phfEvalUpdatedText(rec)):'<span class="muted">-</span>'}</td><td>${esc(conclusion)}</td><td><div class="eval-table-actions">${action}</div></td></tr>`;
  }).join('');
  box.innerHTML = `<section class="eval-history-card"><div class="eval-history-head"><div><h3>Lịch sử hồ sơ đánh giá</h3><p>Tổng hợp các phiếu tuần, tháng và kết thúc thử việc của học viên đang xem.</p></div></div><div class="eval-history-summary"><div class="eval-history-metric"><b>${saved}</b><span>Phiếu đã lưu</span></div><div class="eval-history-metric"><b>${missing}</b><span>Phiếu còn thiếu</span></div><div class="eval-history-metric"><b>${records.length}</b><span>Dòng hồ sơ</span></div><div class="eval-history-metric"><b>${finalRec?'Có':'Chưa'}</b><span>Phiếu kết thúc</span></div></div><div class="eval-table-wrap"><table class="eval-history-table"><thead><tr><th>Loại phiếu</th><th>Kỳ đánh giá</th><th>Trạng thái</th><th>Người đánh giá</th><th>Cập nhật cuối</th><th>Kết luận</th><th>Thao tác</th></tr></thead><tbody>${rows || '<tr><td colspan="7">Chưa có dữ liệu kỳ đánh giá.</td></tr>'}</tbody></table></div></section>`;
  box.querySelectorAll('.eval-table-action').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      const key = btn.dataset.weekKey;
      const action = btn.dataset.action || 'view';
      if(key) renderEvaluationRecords(key, action === 'edit' ? 'edit' : 'view');
    });
  });
}



function phfRenderHubTopbar(active, profile, canEdit){
  // Header/menu chung hiện đã nằm cố định ở đầu .app.
  // Các module con không tự render thêm header riêng nữa để tránh trùng/chồng lấn trên mobile.
  return '';
}
function phfOpenHubTab(tab){
  const canEdit = phfCanEditEvaluation();
  if(tab === 'home' || tab === 'overview') return phfRenderTrainingOverview();
  if(tab === 'learning') return phfGoLearning();
  if(tab === 'profile' || tab === 'evaluation') return renderEvaluationRecords();
  if(tab === 'reports') return phfRenderTrainingReports();
  if(tab === 'guide') return phfGoGuide();
  if(tab === 'directTrainingTest') return phfGoDirectTrainingTest();
  if(tab === 'settings') return canEdit ? phfRenderHubPlaceholder('settings') : phfRenderTrainingOverview();
}
function phfSetMainNavActive(key){
  try{
    const alias = {home:'', overview:'', evaluation:'profile'};
    const activeKey = alias[key] || key;
    document.querySelectorAll('[data-phf-main-nav]').forEach(function(btn){
      btn.classList.toggle('active', btn.getAttribute('data-phf-main-nav') === activeKey);
    });
  }catch(e){}
}
function phfHideIntroAndStopAuto(){
  try{
    if(typeof window.phfIntroStopAutoHard === 'function') window.phfIntroStopAutoHard();
    else if(typeof window.phfIntroStopAuto === 'function') window.phfIntroStopAuto();
  }catch(e){}
  try{
    const intro = document.getElementById('introSection');
    if(intro) intro.hidden = true;
    document.body.classList.remove('phf-intro-active','phf-landing-active','phf-guide-intro-active');
    document.body.classList.remove('phf-module-page-mode');
    window.__phfTrainingEntryReady = true;
  }catch(e){}
}
function phfGoHome(){
  phfHideIntroAndStopAuto();
  try{ if(typeof window.phfRefreshResumeSave === 'function') window.phfRefreshResumeSave('overview', {hubTab:'home'}); }catch(e){}
  return phfRenderTrainingOverview();
}
function phfGoLearning(){
  phfHideIntroAndStopAuto();
  try{ if(typeof window.phfRefreshResumeSave === 'function') window.phfRefreshResumeSave('learning', {hubTab:'learning'}); }catch(e){}
  return render();
}
function phfGoMyProfile(){
  phfHideIntroAndStopAuto();
  try{ if(typeof window.phfRefreshResumeSave === 'function') window.phfRefreshResumeSave('profile', {hubTab:'profile'}); }catch(e){}
  return renderEvaluationRecords();
}
function phfGoGuide(){
  phfHideIntroAndStopAuto();
  try{ if(typeof window.phfRefreshResumeSave === 'function') window.phfRefreshResumeSave('guide', {hubTab:'guide'}); }catch(e){}
  const out = phfRenderGuidePage();
  phfSetMainNavActive('guide');
  setTimeout(function(){ phfSetMainNavActive('guide'); }, 0);
  return out;
}
function phfRenderGuidePage(){
  document.body.classList.add('phf-eval-mode','phf-guide-standalone-mode','phf-module-page-mode');
  document.body.classList.remove('phf-guide-intro-active');
  document.getElementById('miniStatus').textContent='Hướng dẫn';
  document.getElementById('contextTitle').textContent='Hướng dẫn sử dụng PHF Training Hub';
  document.getElementById('contextSub').textContent='Một trang hướng dẫn riêng, không kèm thao tác điều hướng phụ.';
  document.getElementById('contextAction').textContent='Hướng dẫn';
  document.getElementById('mainLesson').innerHTML = `
  <section class="phf-guide-app phf-guide-standalone-page">
    <div class="phf-guide-hero clean">
      <div>
        <span class="phf-guide-eyebrow">PHF Training Hub</span>
        <h2>Hướng dẫn sử dụng</h2>
        <p>Trang này giúp người dùng nắm cách sử dụng hệ thống đào tạo nội bộ PHUHOA FRESH một cách ngắn gọn, rõ ràng.</p>
      </div>
    </div>
    <div class="phf-guide-section">
      <h3>Dành cho học viên</h3>
      <div class="phf-guide-grid">
        <article><b>1</b><h4>Bắt đầu sử dụng</h4><p>Học viên chọn đúng vai trò của mình và nhập số điện thoại đang dùng để hệ thống nhận diện hồ sơ học tập.</p></article>
        <article><b>2</b><h4>Hoàn tất thông tin ban đầu</h4><p>Họ tên, số điện thoại, vị trí đào tạo, chi nhánh hoặc bộ phận và ngày bắt đầu học là các thông tin cần nhập đầy đủ.</p></article>
        <article><b>3</b><h4>Theo dõi bài học</h4><p>Khu vực bài học hiển thị lộ trình đang học, nội dung chính cần đọc và phần tiếp theo cần hoàn thành.</p></article>
        <article><b>4</b><h4>Xem hồ sơ cá nhân</h4><p>Học viên xem lại thông tin học tập, kết quả bài kiểm tra và phiếu đánh giá đã được người phụ trách lưu.</p></article>
      </div>
    </div>
    <div class="phf-guide-section">
      <h3>Dành cho quản lý và admin</h3>
      <div class="phf-guide-grid compact">
        <article><h4>Theo dõi học viên</h4><p>Xem tình trạng học tập, tiến độ và hồ sơ đánh giá của học viên trong quá trình đào tạo.</p></article>
        <article><h4>Nhập và cập nhật đánh giá</h4><p>Người phụ trách có thể lưu phiếu đánh giá theo tuần, tháng hoặc kết thúc thử việc theo quyền được cấp.</p></article>
        <article><h4>Kiểm tra báo cáo</h4><p>Báo cáo giúp nhận biết học viên đang học đến đâu, còn thiếu nội dung nào và hồ sơ nào cần xử lý.</p></article>
      </div>
    </div>
    <div class="phf-guide-note">
      <b>Lưu ý khi dùng máy chung:</b> người dùng cần nhập đúng số điện thoại của mình để tránh mở nhầm hồ sơ học tập của người khác. Khi gặp lỗi, nên chụp lại màn hình và báo người phụ trách hoặc admin để được hỗ trợ.
    </div>
  </section>`;
  try{ if(window.phfInitMobileMenus) setTimeout(window.phfInitMobileMenus, 0); }catch(e){}
  phfScrollToPageTop();
}
function phfGoDirectTrainingTest(){
  phfHideIntroAndStopAuto();
  try{ if(typeof window.phfRefreshResumeSave === 'function') window.phfRefreshResumeSave('directTrainingTest', {hubTab:'directTrainingTest'}); }catch(e){}
  const out = phfRenderDirectTrainingTestPage();
  phfSetMainNavActive('directTrainingTest');
  setTimeout(function(){ phfSetMainNavActive('directTrainingTest'); }, 0);
  return out;
}
function phfRenderDirectTrainingTestPage(){
  document.body.classList.add('phf-eval-mode','phf-module-page-mode');
  document.body.classList.remove('phf-guide-standalone-mode','phf-guide-intro-active');
  document.getElementById('miniStatus').textContent='Kiểm tra sau đào tạo';
  document.getElementById('contextTitle').textContent='Kiểm tra sau đào tạo trực tiếp';
  document.getElementById('contextSub').textContent='Khu vực dành cho bài kiểm tra sau các buổi đào tạo trực tiếp tại PHUHOA FRESH.';
  document.getElementById('contextAction').textContent='Tính năng đang xây dựng';
  document.getElementById('mainLesson').innerHTML = `
  <section class="phf-direct-test-page phf-admin-test-builder">
    <div class="hub-panel">
      <div class="hub-panel-head">
        <h3>Kiểm tra sau đào tạo trực tiếp</h3>
        <span>Đang xây dựng</span>
      </div>
      <div class="phf-building-box">
        <h2>Tính năng đang xây dựng</h2>
        <p>Khu vực này sẽ được dùng cho các bài kiểm tra sau những buổi đào tạo trực tiếp tại PHUHOA FRESH.</p>
      </div>
      <div class="phf-admin-test-steps" aria-label="Khung quy trình kiểm tra sau đào tạo trực tiếp">
        <button type="button" disabled>1. Thông tin buổi đào tạo</button>
        <button type="button" disabled>2. Câu hỏi</button>
        <button type="button" disabled>3. Phát hành</button>
        <button type="button" disabled>4. Kết quả</button>
      </div>
      <div class="record-note">Hiện tại chỉ hiển thị khung định hướng, chưa tạo câu hỏi, chưa phát hành bài kiểm tra và chưa ghi dữ liệu mới.</div>
    </div>
  </section>`;
  try{ if(window.phfInitMobileMenus) setTimeout(window.phfInitMobileMenus, 0); }catch(e){}
  phfScrollToPageTop();
}
function phfGoLogin(){
  try{ if(typeof window.phfRefreshResumeSave === 'function') window.phfRefreshResumeSave('role', {source:'header-login'}); }catch(e){}
  if(typeof phfShowRoleChooser === 'function') return phfShowRoleChooser(true);
  if(typeof phfBootInternalRoleTest === 'function') return phfBootInternalRoleTest();
}
function phfHubLearningProgress(){
  const total = LESSONS.length || 1;
  const done = Math.min(total, Math.max(1, (current || 0) + 1));
  const pct = Math.round((done / total) * 100);
  const l = LESSONS[current] || LESSONS[0] || {};
  return {total: total, done: done, pct: pct, lesson: l};
}
function phfHubPeriodSummary(profile){
  const periods = phfBuildEvaluationPeriods(profile);
  const records = phfEvaluationRecordsFor(profile.id);
  const today = phfTodayOnly();
  let saved = 0, missing = 0, overdue = 0, due = 0;
  periods.forEach(function(p){
    const rec = phfPeriodRecord(profile.id, p);
    if(rec){ saved++; return; }
    missing++;
    if(today.getTime() > p.end.getTime()) overdue++;
    else if(today.getTime() >= p.start.getTime() && today.getTime() <= p.end.getTime()) due++;
  });
  const finalPeriod = periods.find(function(p){ return p.formType === 'final' || p.type === 'final'; });
  const finalRec = finalPeriod ? phfPeriodRecord(profile.id, finalPeriod) : null;
  return {periods:periods, records:records, saved:saved, missing:missing, overdue:overdue, due:due, finalPeriod:finalPeriod, finalRec:finalRec};
}
function phfHubLearnerStage(profile){
  const timeline = phfBuildTimelineForProfile(profile);
  if(!timeline) return {key:'missing', label:'Chưa nhập ngày', pct:0, currentRange:'Chưa có ngày bắt đầu học'};
  const today = phfTodayOnly().getTime();
  if(today > timeline.end.getTime()) return {key:'done', label:'Hoàn thành thời gian', pct:100, currentRange:phfFormatRange(timeline.start,timeline.end)};
  const idx = Math.max(0, Math.min(4, timeline.currentStage || 0));
  const totalDays = Math.max(1, Math.round((timeline.end.getTime() - timeline.start.getTime()) / 86400000) + 1);
  const passed = Math.max(0, Math.min(totalDays, Math.round((phfTodayOnly().getTime() - timeline.start.getTime()) / 86400000) + 1));
  return {key:'g'+(idx+1), label:'GĐ'+(idx+1), pct:Math.round((passed/totalDays)*100), currentRange:phfFormatRange(timeline.ranges[idx].start,timeline.ranges[idx].end)};
}
function phfHubSetLearnerAndOpen(id, area, periodKey, mode){
  if(id) localStorage.setItem('phfEvalSelectedEmployeeId', id);
  if(area === 'learning') return render();
  if(area === 'evaluation') return renderEvaluationRecords(periodKey || null, mode || 'view');
  return phfRenderTrainingOverview();
}
function phfOpenEvalTodoList(){
  const el = document.getElementById('phfEvalTodoList');
  if(el){ el.scrollIntoView({behavior:'smooth', block:'start'}); return; }
  if(typeof phfRenderTrainingOverview === 'function') phfRenderTrainingOverview();
}
function phfHubBarRows(items, maxValue){
  maxValue = Math.max(maxValue || 1, 1);
  return items.map(function(item){
    const pct = Math.max(4, Math.min(100, Math.round((Number(item.value || 0) / maxValue) * 100)));
    const cls = item.cls ? ' ' + String(item.cls).replace(/[^a-z0-9_-]/gi,'') : '';
    const valueText = item.valueLabel || item.value;
    return `<div class="hub-bar-row phf-bar-safe"><div class="hub-bar-label"><b title="${esc(item.label)}">${esc(item.label)}</b><span>${esc(valueText)}</span></div><div class="hub-bar-track"><div class="hub-bar-fill${cls}" style="width:${pct}%"></div></div></div>`;
  }).join('') || '<div class="hub-empty">Chưa có dữ liệu để hiển thị.</div>';
}
function phfReportMiniRows(items, maxValue){
  maxValue = Math.max(maxValue || 1, 1);
  return '<div class="phf-report-mini-list">' + (items.map(function(item){
    const rawValue = Number(item.value || 0);
    const pct = Math.max(rawValue > 0 ? 4 : 0, Math.min(100, Math.round((rawValue / maxValue) * 100)));
    const cls = item.cls ? ' ' + String(item.cls).replace(/[^a-z0-9_-]/gi,'') : '';
    const valueText = item.valueLabel || item.value || 0;
    return `<div class="phf-report-mini-row"><div class="phf-report-mini-label" title="${esc(item.label)}">${esc(item.label)}</div><div class="phf-report-mini-value">${esc(valueText)}</div><div class="phf-report-mini-track"><span class="phf-report-mini-fill${cls}" style="width:${pct}%"></span></div></div>`;
  }).join('') || '<div class="hub-empty">Chưa có dữ liệu để hiển thị.</div>') + '</div>';
}
function phfHubTestResults(){
  const data = (window.__phfLocalData && Array.isArray(window.__phfLocalData.testResults)) ? window.__phfLocalData.testResults : [];
  return data.slice();
}
function phfHubTestResultsFor(employeeId){
  const id = String(employeeId || '');
  if(!id) return [];
  return phfHubTestResults().filter(function(r){ return String(r.employeeId || r.employee_id || '') === id; }).sort(function(a,b){ return new Date(a.savedAt || a.saved_at || 0) - new Date(b.savedAt || b.saved_at || 0); });
}
function phfHubLatestTestResult(employeeId){
  const rows = phfHubTestResultsFor(employeeId);
  return rows.length ? rows[rows.length-1] : null;
}
function phfHubTestStageLabel(r){
  const page = String((r && (r.page || r.currentPage)) || '');
  const m = page.match(/lesson:(\d+)/i);
  if(m && LESSONS[Number(m[1])] && Number.isFinite(Number(LESSONS[Number(m[1])].stage))){
    return 'GĐ' + (Number(LESSONS[Number(m[1])].stage) + 1);
  }
  if(/gđ\s*1|gd\s*1|bước\s*1|buoc\s*1/i.test(page)) return 'GĐ1';
  if(/gđ\s*2|gd\s*2|bước\s*2|buoc\s*2/i.test(page)) return 'GĐ2';
  if(/gđ\s*3|gd\s*3|bước\s*3|buoc\s*3/i.test(page)) return 'GĐ3';
  if(/gđ\s*4|gd\s*4|bước\s*4|buoc\s*4/i.test(page)) return 'GĐ4';
  if(/gđ\s*5|gd\s*5|bước\s*5|buoc\s*5|final/i.test(page)) return 'GĐ5';
  return 'Khác';
}
function phfHubTestInfoFor(profile){
  const latest = phfHubLatestTestResult(profile && profile.id);
  if(!latest) return {score:null, label:'Chưa làm', cls:'missing', status:'Chưa làm', stage:'-'};
  const raw = latest.score;
  const score = (raw === null || raw === undefined || raw === '') ? null : Number(raw);
  const passScore = Number(latest.passScore || latest.pass_score || 80);
  const stage = phfHubTestStageLabel(latest);
  if(!Number.isFinite(score)) return {score:null, label:'Chưa có điểm', cls:'missing', status:'Chưa có', stage:stage};
  const passed = /pass|đạt/i.test(String(latest.status || latest.resultText || latest.result_text || '')) || score >= passScore;
  return {score:score, label:score + '% · ' + (passed ? 'Đạt' : 'Chưa đạt'), cls:passed ? 'pass' : 'fail', status:passed ? 'Đạt' : 'Chưa đạt', stage:stage, passScore:passScore};
}
function phfHubTestAggregate(rows){
  const infos = rows.map(function(r){ return r.test || phfHubTestInfoFor(r.learner); });
  const scored = infos.filter(function(x){ return Number.isFinite(Number(x.score)); });
  const avg = scored.length ? Math.round(scored.reduce(function(sum,x){ return sum + Number(x.score); },0) / scored.length) : 0;
  const pass = infos.filter(function(x){ return x.cls === 'pass'; }).length;
  const fail = infos.filter(function(x){ return x.cls === 'fail'; }).length;
  const none = Math.max(0, infos.length - pass - fail);
  const allResults = phfHubTestResults();
  const stageSum = {};
  allResults.forEach(function(r){
    const score = Number(r.score);
    if(!Number.isFinite(score)) return;
    const label = phfHubTestStageLabel(r);
    if(!stageSum[label]) stageSum[label] = {sum:0,count:0};
    stageSum[label].sum += score; stageSum[label].count += 1;
  });
  const stageItems = ['GĐ1','GĐ2','GĐ3','GĐ4','GĐ5'].map(function(label){
    const x = stageSum[label];
    const value = x && x.count ? Math.round(x.sum / x.count) : 0;
    return {label:label, value:value, valueLabel: x && x.count ? value + '%' : '-', cls:value >= 80 ? 'green' : (value ? 'orange' : 'blue')};
  });
  return {avg:avg, pass:pass, fail:fail, none:none, scored:scored.length, stageItems:stageItems};
}
function phfRenderManagerTrainingOverview(){
  const canEdit = phfCanEditEvaluation();
  const profile = phfCurrentEmployeeProfile();
  const learners = phfAllEvaluationLearners();
  const today = phfTodayOnly();
  const rows = learners.map(function(e){
    const summary = phfHubPeriodSummary(e);
    const stage = phfHubLearnerStage(e);
    const test = phfHubTestInfoFor(e);
    let priority = 'Ổn định', cls = 'done', actionPeriod = summary.periods[0] && summary.periods[0].key;
    if(stage.key === 'missing') { priority = 'Thiếu ngày bắt đầu'; cls = 'missing'; }
    else if(summary.overdue > 0) { priority = summary.overdue + ' phiếu quá hạn'; cls = 'overdue'; }
    else if(summary.due > 0) { priority = summary.due + ' phiếu đến hạn'; cls = 'due'; }
    else if(test.cls === 'fail') { priority = 'Bài kiểm tra chưa đạt'; cls = 'fail'; }
    else if(test.cls === 'missing') { priority = 'Chưa làm bài kiểm tra'; cls = 'missing'; }
    else if(!summary.finalRec && summary.finalPeriod && today.getTime() >= summary.finalPeriod.start.getTime()) { priority = 'Cần phiếu kết thúc'; cls = 'due'; actionPeriod = summary.finalPeriod.key; }
    if(summary.overdue || summary.due) {
      const need = summary.periods.find(function(p){ return !phfPeriodRecord(e.id,p) && today.getTime() >= p.start.getTime(); });
      if(need) actionPeriod = need.key;
    }
    return {learner:e, summary:summary, stage:stage, test:test, priority:priority, cls:cls, actionPeriod:actionPeriod};
  });
  const total = learners.length;
  const active = rows.filter(function(r){ return r.stage.key !== 'missing' && r.stage.key !== 'done'; }).length;
  const noStart = rows.filter(function(r){ return r.stage.key === 'missing'; }).length;
  const completedTime = rows.filter(function(r){ return r.stage.key === 'done'; }).length;
  const overdueLearners = rows.filter(function(r){ return r.summary.overdue > 0; }).length;
  const dueLearners = rows.filter(function(r){ return r.summary.due > 0; }).length;
  const missingTotal = rows.reduce(function(sum,r){ return sum + r.summary.missing; },0);
  const overdueTotal = rows.reduce(function(sum,r){ return sum + r.summary.overdue; },0);
  const testAgg = phfHubTestAggregate(rows);
  const needAttention = rows.filter(function(r){ return r.cls !== 'done'; }).length;
  const testStatusItems = [{label:'Đạt',value:testAgg.pass,cls:'green'},{label:'Chưa làm',value:testAgg.none,cls:'orange'},{label:'Chưa đạt',value:testAgg.fail,cls:'red'}];
  const evalStatusRows = `<div class="hub-status-row"><span class="hub-status-label"><i class="hub-dot green"></i>Đủ phiếu</span><b>${Math.max(0,total - rows.filter(function(r){return r.summary.missing>0;}).length)}</b></div><div class="hub-status-row"><span class="hub-status-label"><i class="hub-dot orange"></i>Thiếu phiếu</span><b>${rows.filter(function(r){return r.summary.missing>0;}).length}</b></div><div class="hub-status-row"><span class="hub-status-label"><i class="hub-dot red"></i>Quá hạn</span><b>${overdueLearners}</b></div><div class="hub-status-row"><span class="hub-status-label"><i class="hub-dot blue"></i>Đến hạn kết thúc</span><b>${rows.filter(function(r){return !r.summary.finalRec && r.summary.finalPeriod && today.getTime() >= r.summary.finalPeriod.start.getTime();}).length}</b></div>`;
  const upcomingWindowMs = 7 * 86400000;
  const todayMs = today.getTime();
  const evalTodoItems = [];
  rows.forEach(function(r){
    (r.summary.periods || []).forEach(function(p){
      if(phfPeriodRecord(r.learner.id, p)) return;
      const startMs = p.start.getTime();
      const endMs = p.end.getTime();
      let rank = 0, text = '', cls = '';
      if(todayMs > endMs){ rank = 1; text = 'Quá hạn'; cls = 'overdue'; }
      else if(todayMs >= startMs && todayMs <= endMs){ rank = 2; text = 'Đến hạn'; cls = 'due'; }
      else if(startMs > todayMs && startMs - todayMs <= upcomingWindowMs){ rank = 3; text = 'Sắp đến hạn'; cls = 'upcoming'; }
      if(!rank) return;
      evalTodoItems.push({learner:r.learner, period:p, rank:rank, text:text, cls:cls, startMs:startMs, endMs:endMs});
    });
  });
  evalTodoItems.sort(function(a,b){
    const aTime = a.rank === 1 ? a.endMs : a.startMs;
    const bTime = b.rank === 1 ? b.endMs : b.startMs;
    return (a.rank - b.rank) || (aTime - bTime) || String(a.learner.fullName || '').localeCompare(String(b.learner.fullName || ''), 'vi');
  });
  const evalTodoCounts = evalTodoItems.reduce(function(acc,item){ acc[item.cls] = (acc[item.cls] || 0) + 1; return acc; }, {overdue:0,due:0,upcoming:0});
  const evalTodoRows = evalTodoItems.map(function(item, idx){
    const p = item.period;
    const learner = item.learner;
    return `<tr><td class="hub-stt">${idx+1}</td><td><b>${esc(learner.fullName)}</b><small>${esc(learner.phone || '')}</small></td><td>${esc(learner.position || 'Nhân viên')}<small>${esc(learner.branch || 'Chưa phân chi nhánh')}</small></td><td><b>${esc(phfEvalDisplayTitle(p))}</b><small>${esc(phfEvalShortType(p))}</small></td><td>${phfFormatRange(p.start,p.end)}</td><td><span class="hub-status-pill ${item.cls}">${esc(item.text)}</span></td><td><button class="eval-action primary" type="button" onclick="phfHubSetLearnerAndOpen('${esc(learner.id)}','evaluation','${esc(p.key)}','edit')">Nhập đánh giá</button></td></tr>`;
  }).join('');
  const evalTodoSummary = `${evalTodoCounts.overdue || 0} quá hạn · ${evalTodoCounts.due || 0} đến hạn${evalTodoCounts.upcoming ? ' · ' + evalTodoCounts.upcoming + ' sắp đến hạn' : ''}`;
  const workRows = rows.filter(function(r){ return r.cls !== 'done'; }).sort(function(a,b){ const rank = {overdue:1,due:2,fail:3,missing:4,done:5}; return (rank[a.cls]||9)-(rank[b.cls]||9); }).slice(0,8).map(function(r){
    const sub = r.test.cls === 'fail' ? (`Bài kiểm tra ${r.test.stage} chưa đạt · ${r.test.score}%`) : `${r.learner.position || 'Nhân viên'} · ${r.learner.branch || 'Chưa phân chi nhánh'} · ${r.stage.label}`;
    return `<div class="hub-work-row"><div><b>${esc(r.learner.fullName)}</b><small>${esc(sub)}</small><small><span class="hub-status-pill ${r.cls}">${esc(r.priority)}</span></small></div><button class="eval-action ${r.cls==='overdue'?'primary':''}" type="button" onclick="phfHubSetLearnerAndOpen('${esc(r.learner.id)}','evaluation','${esc(r.actionPeriod||'')}','${r.cls==='missing'?'history':'edit'}')">Xử lý</button></div>`;
  }).join('');
  const stageKeys = ['Chưa nhập ngày','GĐ1','GĐ2','GĐ3','GĐ4','GĐ5','Hết mốc'];
  const stageItems = stageKeys.map(function(k){ return {label:k,value:rows.filter(function(r){ return (r.stage.key==='missing'&&k==='Chưa nhập ngày')||(r.stage.key==='done'&&k==='Hết mốc')||r.stage.label===k; }).length}; });
  const tableRows = rows.slice(0,12).map(function(r){
    const evalText = r.summary.missing ? `${r.summary.saved}/${r.summary.saved+r.summary.missing}` : `${r.summary.saved}/${r.summary.saved}`;
    const program = r.learner.programId || 'new_sales';
    const scoreClass = r.test.cls === 'pass' ? 'score-pass' : (r.test.cls === 'fail' ? 'score-fail' : 'score-none');
    const testPillClass = r.test.cls === 'pass' ? 'pass' : (r.test.cls === 'fail' ? 'fail' : 'missing');
    return `<tr><td><b>${esc(r.learner.fullName)}</b><small>${esc(r.learner.phone || '')}</small></td><td>${esc(r.learner.branch || 'Chưa phân chi nhánh')}<small>${esc(r.learner.position || '')}</small></td><td>${esc(program)}</td><td>${esc(r.stage.label)}<small>${esc(r.stage.pct || 0)}% · ${esc(r.stage.currentRange)}</small></td><td><span class="${scoreClass}">${esc(r.test.label)}</span></td><td><span class="hub-status-pill ${testPillClass}">${esc(r.test.status)}</span></td><td><span class="hub-status-pill ${r.cls}">${esc(r.priority)}</span><small>${esc(evalText)} phiếu · Kết thúc: ${esc(r.summary.finalRec ? 'Đã có' : 'Chưa có')}</small></td><td><button class="eval-action" type="button" onclick="phfHubSetLearnerAndOpen('${esc(r.learner.id)}','evaluation','${esc(r.actionPeriod||'')}','view')">Hồ sơ</button></td></tr>`;
  }).join('');
  const adminDirectTestModule = '';
  document.getElementById('mainLesson').innerHTML = `<section class="eval-admin-shell">${phfRenderHubTopbar('overview', profile, canEdit)}<div class="eval-admin-page"><main class="eval-admin-main hub-overview-page is-dashboard" style="grid-column:1 / -1"><div class="hub-dashboard-hero phf-photo-hero"><div><span class="phf-hero-kicker">PHF Training Hub</span><h2>Tổng quan đào tạo</h2><p>Theo dõi tình hình học tập, điểm bài kiểm tra và hồ sơ đánh giá của học viên trên một nền tảng nội bộ chính thức.</p></div><div class="hub-dashboard-note">${esc(phfRoleLabel())}<small>${total} học viên trong dữ liệu hiện tại</small></div></div><div class="hub-full-top-grid"><section class="hub-full-eval-card"><div><div class="hub-full-card-head"><div class="hub-full-icon">📋</div><div><div class="hub-full-title">Việc đánh giá cần làm</div><p>Danh sách các mốc đánh giá đang quá hạn, đến hạn hoặc sắp đến hạn theo lịch đào tạo của từng học viên.</p><div class="hub-full-count">${evalTodoItems.length} việc đánh giá cần làm</div><p>${evalTodoSummary} · ${missingTotal} phiếu còn thiếu</p></div></div></div><div class="hub-full-actions"><button class="eval-action primary" type="button" onclick="phfOpenEvalTodoList()">Xem danh sách</button><button class="eval-action" type="button" onclick="renderEvaluationRecords(null,'history')">Xem lịch sử</button></div></section><div class="hub-kpi"><b>${total}</b><span>Đang đào tạo</span><p>${active} trong mốc · ${completedTime} hết mốc · ${noStart} thiếu ngày bắt đầu.</p><div class="hub-progress green"><span style="width:${total?Math.round(active/total*100):0}%"></span></div></div><div class="hub-kpi"><b>${testAgg.scored ? testAgg.avg + '%' : '-'}</b><span>Kết quả bài kiểm tra</span><p>Điểm trung bình gần nhất · ${testAgg.fail} học viên chưa đạt.</p><div class="hub-progress blue"><span style="width:${testAgg.scored ? Math.max(4,testAgg.avg) : 0}%"></span></div></div><div class="hub-kpi danger"><b>${needAttention}</b><span>Cần chú ý</span><p>${overdueLearners} trễ đánh giá · ${testAgg.fail} chưa đạt bài kiểm tra · ${noStart} thiếu ngày bắt đầu.</p><div class="hub-progress red"><span style="width:${total?Math.max(4,Math.round(needAttention/total*100)):0}%"></span></div></div></div><div class="hub-insight-grid"><section class="hub-panel"><div class="hub-panel-head"><h3>Điểm bài kiểm tra trung bình theo giai đoạn</h3><span>GĐ1–GĐ5</span></div><div class="hub-chart-box"><div class="hub-bar-list">${phfHubBarRows(testAgg.stageItems, 100)}</div></div></section><section class="hub-panel"><div class="hub-panel-head"><h3>Tình trạng bài kiểm tra</h3><span>toàn bộ học viên</span></div><div class="hub-chart-box"><div class="hub-bar-list">${phfHubBarRows(testStatusItems, Math.max.apply(null, testStatusItems.map(function(x){return x.value;}).concat([1])))}</div></div></section><section class="hub-panel"><div class="hub-panel-head"><h3>Tình trạng hồ sơ đánh giá</h3><span>phiếu tuần/tháng/final</span></div><div class="hub-chart-box"><div class="hub-status-list">${evalStatusRows}</div></div></section></div><section class="hub-panel" id="phfEvalTodoList"><div class="hub-panel-head"><div><h3>Việc đánh giá cần làm</h3><span>Đã sắp xếp theo ưu tiên thời gian: quá hạn trước, đến hạn sau, sắp đến hạn cuối.</span></div><span>${evalTodoSummary}</span></div><div class="eval-table-wrap"><table class="hub-action-table hub-eval-todo-table"><thead><tr><th>STT</th><th>Học viên</th><th>Vị trí/Chi nhánh</th><th>Mốc đánh giá</th><th>Thời gian cần đánh giá</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${evalTodoRows || '<tr><td colspan="7">Chưa có việc đánh giá đến hạn hoặc quá hạn.</td></tr>'}</tbody></table></div></section>${adminDirectTestModule}<div class="hub-dashboard-grid"><section class="hub-panel"><div class="hub-panel-head"><h3>Việc cần chú ý hôm nay</h3><span>ưu tiên quá hạn/bài kiểm tra chưa đạt</span></div><div class="hub-worklist">${workRows || '<div class="hub-empty">Chưa có việc cần xử lý nổi bật.</div>'}</div><div class="hub-dashboard-foot"><button class="eval-action primary" type="button" onclick="phfOpenEvalTodoList()">Xem việc đánh giá</button><button class="eval-action" type="button" onclick="phfRenderTrainingReports()">Xem báo cáo</button></div></section><section class="hub-panel"><div class="hub-panel-head"><h3>Tiến độ theo giai đoạn</h3><span>ước tính theo ngày bắt đầu học</span></div><div class="hub-chart-box"><div class="hub-bar-list">${phfHubBarRows(stageItems, Math.max(1,total))}</div></div></section></div><section class="hub-panel"><div class="hub-panel-head"><h3>Danh sách học viên đang đào tạo</h3><span>12 dòng đầu · có điểm bài kiểm tra và hồ sơ đánh giá</span></div><div class="eval-table-wrap"><table class="hub-action-table"><thead><tr><th>Học viên</th><th>Chi nhánh/Vị trí</th><th>Chương trình</th><th>Giai đoạn</th><th>Điểm bài kiểm tra</th><th>Trạng thái bài kiểm tra</th><th>Hồ sơ đánh giá</th><th>Thao tác</th></tr></thead><tbody>${tableRows || '<tr><td colspan="8">Chưa có học viên trong dữ liệu.</td></tr>'}</tbody></table></div></section></main></div></section>`;
  phfScrollToPageTop();
}
function phfRenderLearnerTrainingOverview(){
  const canEdit = false;
  const profile = phfEvaluationTargetProfile();
  const timeline = phfBuildTimelineForProfile(profile);
  const periods = phfBuildEvaluationPeriods(profile);
  const records = phfEvaluationRecordsFor(profile.id);
  const saved = records.length;
  const missing = Math.max(0, periods.length - saved);
  const finalPeriod = periods.find(function(p){ return p.type === 'final' || p.formType === 'final'; });
  const finalRec = finalPeriod ? phfPeriodRecord(profile.id, finalPeriod) : null;
  const progress = phfHubLearningProgress();
  const currentRange = timeline ? phfFormatRange(timeline.ranges[timeline.currentStage].start, timeline.ranges[timeline.currentStage].end) : 'Chưa có ngày bắt đầu học';
  const nextLessonTitle = progress.lesson && progress.lesson.title ? progress.lesson.title : 'Chưa có bài học';
  const evalTodo = missing ? `${missing} kỳ chưa có phiếu` : 'Đã đủ phiếu theo dữ liệu hiện có';
  const rows = periods.slice(0,6).map(function(p){
    const rec = phfPeriodRecord(profile.id, p);
    const st = phfEvalStatus(p.start, p.end, !!rec);
    return `<div class="hub-row"><div><b>${esc(p.label)}</b><small>${esc(phfEvalShortType(p))} · ${phfFormatRange(p.start,p.end)} · ${rec ? 'Đã lưu' : st.text}</small></div><button class="eval-action ${rec?'primary':''}" type="button" onclick="renderEvaluationRecords('${esc(p.key)}','view')">${rec?'Xem':'Chưa có'}</button></div>`;
  }).join('');
  document.getElementById('mainLesson').innerHTML = `<section class="eval-admin-shell hub-learner-personal">
    ${phfRenderHubTopbar('overview', profile, canEdit)}
    <div class="eval-admin-page"><aside class="eval-admin-sidebar"><section class="eval-card eval-profile-card"><h3>Hồ sơ của bạn</h3><div class="eval-profile-lines"><div class="eval-profile-line"><b>Họ tên</b><span>${esc(profile.fullName)}</span></div><div class="eval-profile-line"><b>SĐT</b><span>${esc(profile.phone || 'Chưa có')}</span></div><div class="eval-profile-line"><b>Vị trí</b><span>${esc(profile.position || 'Nhân viên bán hàng mới')}</span></div><div class="eval-profile-line"><b>Chi nhánh</b><span>${esc(profile.branch || 'Chưa phân chi nhánh')}</span></div><div class="eval-profile-line"><b>Ngày bắt đầu</b><span>${esc(profile.studyStartDate || 'Chưa nhập')}</span></div></div></section></aside>
      <main class="eval-admin-main hub-overview-page"><div class="hub-hero phf-photo-hero"><div><span class="phf-hero-kicker">PHF Training Hub</span><h2>Bài học của tôi</h2><p>Tiếp tục lộ trình đào tạo nội bộ, theo dõi tiến độ học tập và xem lại hồ sơ đánh giá của bạn.</p></div><div class="hub-badge">${esc(profile.fullName)}<br><small>${esc(currentRange)}</small></div></div><div class="hub-kpi-grid"><div class="hub-kpi"><b>${progress.pct}%</b><span>Tiến độ học</span><p>${progress.done}/${progress.total} mục theo thứ tự hiện tại.</p></div><div class="hub-kpi"><b>${saved}</b><span>Phiếu đã lưu</span><p>${evalTodo}</p></div><div class="hub-kpi"><b>${finalRec?'Có':'Chưa'}</b><span>Phiếu kết thúc</span><p>${finalRec ? 'Đã có hồ sơ kết thúc thử việc.' : 'Chưa có phiếu kết thúc thử việc.'}</p></div><div class="hub-kpi"><b>HV</b><span>Quyền hiện tại</span><p>Chỉ xem hồ sơ của mình.</p></div></div><div class="hub-content-grid"><section class="hub-panel"><div class="hub-panel-head"><h3>Việc cần làm tiếp theo</h3><span>ưu tiên thao tác</span></div><div class="hub-list"><div class="hub-row"><div><b>Tiếp tục học tập</b><small>${esc(nextLessonTitle)}</small></div><button class="eval-action primary" type="button" onclick="phfGoLearning()">Vào học</button></div><div class="hub-row"><div><b>Hồ sơ đánh giá</b><small>${esc(evalTodo)}</small></div><button class="eval-action" type="button" onclick="renderEvaluationRecords()">Xem hồ sơ</button></div>${!timeline?'<div class="hub-warning">Bạn chưa nhập ngày bắt đầu học nên hệ thống chưa tính đủ mốc đánh giá.</div>':''}</div></section><section class="hub-panel"><div class="hub-panel-head"><h3>Kỳ đánh giá gần nhất</h3><span>${periods.length} kỳ</span></div><div class="hub-list">${rows || '<div class="hub-row"><div><b>Chưa có kỳ đánh giá</b><small>Cần nhập ngày bắt đầu học để hệ thống tính mốc.</small></div></div>'}</div></section></div></main></div></section>`;
  phfScrollToPageTop();
}

function phfRenderPostLoginHome(){
  phfSetMainNavActive('intro');
  try{ if(typeof window.phfRefreshResumeSave === 'function') window.phfRefreshResumeSave('home', {hubTab:'intro', source:'post-login-home'}); }catch(e){}
  document.body.classList.add('phf-eval-mode','phf-module-page-mode','phf-post-login-home-mode');
  document.body.classList.remove('phf-guide-standalone-mode','phf-guide-intro-active');
  const canEdit = phfCanEditEvaluation();
  const profile = phfCurrentEmployeeProfile();
  const mini = document.getElementById('miniStatus'); if(mini) mini.textContent = 'Trang chủ';
  const title = document.getElementById('contextTitle'); if(title) title.textContent = 'Bạn đang ở: Trang chủ Training Hub';
  const sub = document.getElementById('contextSub'); if(sub) sub.textContent = 'Không gian điều hướng chính sau khi đăng nhập, gồm ảnh nhận diện Training Hub, lối vào nhanh và video giới thiệu PHUHOA FRESH.';
  const act = document.getElementById('contextAction'); if(act) act.textContent = canEdit ? phfRoleLabel() : 'Học viên';
  const quickAdmin = canEdit ? `<button class="phf-home-action" type="button" onclick="phfRenderTrainingOverview()"><span>Tổng quan đào tạo</span><small>Theo dõi học viên, đánh giá và tiến độ</small></button>` : '';
  const learnerName = profile && profile.fullName && profile.fullName !== 'Chưa có tên học viên' ? profile.fullName : 'anh/chị';
  const main = document.getElementById('mainLesson');
  if(!main) return;
  main.innerHTML = `<section class="phf-post-login-home">
    <div class="phf-home-hero-banner">
      <img src="assets/images/home/phf-traininghub-home-hero.jpg" alt="PHUHOA FRESH Training Hub - Hành trình đào tạo rõ ràng, dễ theo dõi" loading="eager" decoding="async">
    </div>

    <div class="phf-home-main-grid">
      <div class="phf-home-copy">
        <span class="phf-home-kicker">PHUHOA FRESH TRAINING HUB</span>
        <h2>Chào mừng ${esc(learnerName)} đến với hệ thống đào tạo nội bộ.</h2>
        <p>Đây là khu vực để bạn tiếp tục bài học đang học, xem lại hồ sơ cá nhân, làm bài kiểm tra và theo dõi các mốc đánh giá trong suốt quá trình đào tạo tại PHUHOA FRESH.</p>
        <div class="phf-home-actions">
          <button class="phf-home-action primary" type="button" onclick="phfGoLearning()"><span>Bài học của tôi</span><small>Tiếp tục lộ trình đang học</small></button>
          <button class="phf-home-action" type="button" onclick="phfGoMyProfile()"><span>Hồ sơ của tôi</span><small>Xem thông tin, tiến độ và đánh giá</small></button>
          <button class="phf-home-action" type="button" onclick="phfGoDirectTrainingTest()"><span>Kiểm tra</span><small>Làm hoặc xem lại bài kiểm tra</small></button>
          ${quickAdmin}
        </div>
      </div>

      <div class="phf-home-video-card">
        <div class="phf-video-head">
          <div><span>Giới thiệu PHUHOA FRESH</span><b>Video văn hóa & định hướng</b></div>
          <small>PHF</small>
        </div>
        <div class="phf-brand-video-frame">
          <video src="assets/intro/phf-intro-brand-v3.mp4" controls playsinline preload="metadata" aria-label="Video giới thiệu PHUHOA FRESH"></video>
        </div>
      </div>
    </div>

    <div class="phf-home-info-grid">
      <article><b>Theo dõi đúng việc cần làm</b><span>Hệ thống hiển thị rõ bài học, nội dung cần xác nhận và các bước tiếp theo theo đúng lộ trình đào tạo.</span></article>
      <article><b>Lưu lại quá trình học</b><span>Các kết quả kiểm tra, xác nhận và hồ sơ đánh giá được lưu tập trung để dễ xem lại khi cần.</span></article>
      <article><b>Đồng hành trong suốt lộ trình</b><span>Quản lý và Admin có thể theo dõi tiến độ để hỗ trợ nhân viên mới kịp thời và thống nhất.</span></article>
    </div>
  </section>`;
  try{ if(window.phfInitMobileMenus) setTimeout(window.phfInitMobileMenus, 0); }catch(e){}
  phfScrollToPageTop();
}
window.phfRenderPostLoginHome = phfRenderPostLoginHome;

function phfRenderTrainingOverview(){
  phfSetMainNavActive('home');
  try{ if(typeof window.phfRefreshResumeSave === 'function') window.phfRefreshResumeSave('overview', {hubTab:'home'}); }catch(e){}
  document.body.classList.remove('phf-guide-standalone-mode');
  document.body.classList.add('phf-eval-mode','phf-module-page-mode');
  document.body.classList.remove('phf-guide-standalone-mode','phf-guide-intro-active');
  const canEdit = phfCanEditEvaluation();
  document.getElementById('miniStatus').textContent='Tổng quan';
  document.getElementById('contextTitle').textContent='Bạn đang ở: Tổng quan Training Hub';
  document.getElementById('contextSub').textContent= canEdit ? 'Bảng tổng quan theo dõi đào tạo, đánh giá và việc cần xử lý' : 'Theo dõi lộ trình học và hồ sơ đánh giá của bạn';
  document.getElementById('contextAction').textContent= canEdit ? phfRoleLabel() : 'Học viên';
  if(canEdit) return phfRenderManagerTrainingOverview();
  return phfRenderLearnerTrainingOverview();
}


function phfRenderReportsAccessPlaceholder(){
  phfSetMainNavActive('reports');
  document.body.classList.add('phf-eval-mode','phf-module-page-mode');
  document.body.classList.remove('phf-guide-standalone-mode','phf-guide-intro-active');
  const mini = document.getElementById('miniStatus'); if(mini) mini.textContent='Báo cáo';
  const title = document.getElementById('contextTitle'); if(title) title.textContent='Báo cáo đào tạo';
  const sub = document.getElementById('contextSub'); if(sub) sub.textContent='Khu vực báo cáo đang được chuẩn hóa theo quyền sử dụng.';
  const act = document.getElementById('contextAction'); if(act) act.textContent='Đang xây dựng theo quyền';
  const main = document.getElementById('mainLesson');
  if(main){
    main.innerHTML = `<section class="phf-reports-placeholder-page">
      <div class="hub-panel">
        <div class="hub-panel-head">
          <h3>Báo cáo đào tạo</h3>
          <span>Định hướng theo quyền</span>
        </div>
        <div class="phf-building-box">
          <h2>Khu vực báo cáo</h2>
          <p>Menu Báo cáo được hiển thị thống nhất trên hệ thống. Nội dung chi tiết sẽ được mở theo quyền sử dụng sau khi chốt phân quyền chính thức.</p>
        </div>
        <div class="record-note">Hiện tại hệ thống ưu tiên giữ điều hướng chung ổn định. Phần báo cáo quản lý chi tiết sẽ dùng cho Quản lý/Admin khi hoàn thiện quyền.</div>
      </div>
    </section>`;
  }
  try{ if(window.phfInitMobileMenus) setTimeout(window.phfInitMobileMenus, 0); }catch(e){}
  phfScrollToPageTop();
}

function phfRenderTrainingReports(filters){
  phfSetMainNavActive('reports');
  document.body.classList.add('phf-eval-mode','phf-module-page-mode');
  document.body.classList.remove('phf-guide-standalone-mode','phf-guide-intro-active');
  const canEdit = phfCanEditEvaluation();
  if(!canEdit) return phfRenderReportsAccessPlaceholder();
  const profile = phfCurrentEmployeeProfile();
  filters = filters || {};
  const learners = phfAllEvaluationLearners();
  const today = phfTodayOnly();
  const enriched = learners.map(function(e){
    const summary = phfHubPeriodSummary(e);
    const stage = phfHubLearnerStage(e);
    const test = phfHubTestInfoFor(e);
    let recordStatus = 'ok', recordText = 'Đủ hồ sơ';
    if(summary.overdue > 0){ recordStatus = 'bad'; recordText = summary.overdue + ' phiếu quá hạn'; }
    else if(summary.due > 0){ recordStatus = 'warn'; recordText = summary.due + ' phiếu đến hạn'; }
    else if(summary.missing > 0){ recordStatus = 'warn'; recordText = 'Thiếu ' + summary.missing + ' phiếu'; }
    let learningStatus = 'ok', learningText = 'Đúng tiến độ';
    if(stage.key === 'missing'){ learningStatus = 'info'; learningText = 'Thiếu ngày bắt đầu'; }
    else if(stage.key === 'done'){ learningStatus = 'ok'; learningText = 'Hết mốc đào tạo'; }
    else if(summary.overdue > 0){ learningStatus = 'bad'; learningText = 'Cần xử lý đánh giá'; }
    else if(test.cls === 'fail'){ learningStatus = 'bad'; learningText = 'Bài kiểm tra chưa đạt'; }
    else if(test.cls === 'missing'){ learningStatus = 'warn'; learningText = 'Chưa làm bài kiểm tra'; }
    const actionPeriod = (summary.periods.find(function(p){ return !phfPeriodRecord(e.id,p) && today.getTime() >= p.start.getTime(); }) || summary.finalPeriod || summary.periods[0] || {}).key || '';
    return {learner:e, summary:summary, stage:stage, test:test, recordStatus:recordStatus, recordText:recordText, learningStatus:learningStatus, learningText:learningText, actionPeriod:actionPeriod};
  });
  const programs = Array.from(new Set(enriched.map(function(r){ return r.learner.programId || 'new_sales'; }).filter(Boolean))).sort();
  const branches = Array.from(new Set(enriched.map(function(r){ return r.learner.branch || 'Chưa phân chi nhánh'; }).filter(Boolean))).sort();
  const fProgram = filters.program || 'all';
  const fBranch = filters.branch || 'all';
  const fStatus = filters.status || 'all';
  let rows = enriched.filter(function(r){
    if(fProgram !== 'all' && (r.learner.programId || 'new_sales') !== fProgram) return false;
    if(fBranch !== 'all' && (r.learner.branch || 'Chưa phân chi nhánh') !== fBranch) return false;
    if(fStatus === 'attention' && r.learningStatus !== 'bad' && r.recordStatus !== 'bad' && r.recordStatus !== 'warn') return false;
    if(fStatus === 'test_fail' && r.test.cls !== 'fail') return false;
    if(fStatus === 'missing_eval' && r.summary.missing <= 0) return false;
    if(fStatus === 'no_start' && r.stage.key !== 'missing') return false;
    return true;
  });
  const total = rows.length;
  const testAgg = phfHubTestAggregate(rows);
  const needAttention = rows.filter(function(r){ return r.learningStatus === 'bad' || r.recordStatus === 'bad' || r.recordStatus === 'warn'; }).length;
  const missingEvalLearners = rows.filter(function(r){ return r.summary.missing > 0; }).length;
  const completedEvalLearners = rows.filter(function(r){ return r.summary.missing <= 0; }).length;
  const overdueLearners = rows.filter(function(r){ return r.summary.overdue > 0; }).length;
  const noStart = rows.filter(function(r){ return r.stage.key === 'missing'; }).length;
  const stageKeys = ['Chưa nhập ngày','GĐ1','GĐ2','GĐ3','GĐ4','GĐ5','Hết mốc'];
  const stageItems = stageKeys.map(function(k){ return {label:k,value:rows.filter(function(r){ return (r.stage.key==='missing'&&k==='Chưa nhập ngày')||(r.stage.key==='done'&&k==='Hết mốc')||r.stage.label===k; }).length, cls:k==='Chưa nhập ngày'?'orange':(k==='Hết mốc'?'green':'')}; });
  const testStatusItems = [{label:'Đạt',value:testAgg.pass,cls:'green'},{label:'Chưa làm',value:testAgg.none,cls:'orange'},{label:'Chưa đạt',value:testAgg.fail,cls:'red'}];
  const evalItems = [{label:'Đủ phiếu',value:completedEvalLearners,cls:'green'},{label:'Thiếu phiếu',value:missingEvalLearners,cls:'orange'},{label:'Quá hạn',value:overdueLearners,cls:'red'}];
  function opt(value,label,selected){ return `<option value="${esc(value)}" ${selected===value?'selected':''}>${esc(label)}</option>`; }
  const programOptions = opt('all','Tất cả chương trình',fProgram) + programs.map(function(x){return opt(x,x,fProgram);}).join('');
  const branchOptions = opt('all','Tất cả chi nhánh',fBranch) + branches.map(function(x){return opt(x,x,fBranch);}).join('');
  const statusOptions = [opt('all','Tất cả trạng thái',fStatus),opt('attention','Cần xử lý',fStatus),opt('test_fail','Bài kiểm tra chưa đạt',fStatus),opt('missing_eval','Thiếu hồ sơ đánh giá',fStatus),opt('no_start','Thiếu ngày bắt đầu',fStatus)].join('');
  const progressRows = rows.map(function(r){
    const scoreCls = r.test.cls === 'pass' ? 'score-pass' : (r.test.cls === 'fail' ? 'score-fail' : 'score-none');
    return `<tr><td><b>${esc(r.learner.fullName)}</b><small>${esc(r.learner.phone || '')}</small></td><td>${esc(r.learner.branch || 'Chưa phân chi nhánh')}<small>${esc(r.learner.position || '')}</small></td><td>${esc(r.learner.programId || 'new_sales')}</td><td>${esc(r.learner.studyStartDate || 'Chưa nhập')}</td><td>${esc(r.stage.label)}<small>${esc(r.stage.currentRange || '')}</small></td><td>${esc(r.stage.pct || 0)}%</td><td><span class="${scoreCls}">${esc(r.test.label)}</span></td><td><span class="hub-report-status ${r.learningStatus==='ok'?'ok':(r.learningStatus==='bad'?'bad':(r.learningStatus==='warn'?'warn':'info'))}">${esc(r.learningText)}</span></td><td><span class="thin-btn" onclick="phfHubSetLearnerAndOpen('${esc(r.learner.id)}','evaluation','${esc(r.actionPeriod)}','view')">Xem</span></td></tr>`;
  }).join('');
  const evalRows = rows.map(function(r){
    const finalText = r.summary.finalRec ? 'Đã có' : 'Chưa có';
    const watchCount = (r.summary.records || []).reduce(function(sum,rec){
      try{ const data = typeof rec.data === 'string' ? JSON.parse(rec.data) : (rec.data || rec.payload || {}); const values = Object.values(data.criteria || data.ratings || {}); return sum + values.filter(function(v){ return /theo dõi|chưa đạt/i.test(String(v && (v.rating || v.status || v)))}).length; }catch(e){ return sum; }
    },0);
    return `<tr><td><b>${esc(r.learner.fullName)}</b><small>${esc(r.learner.branch || 'Chưa phân chi nhánh')} · ${esc(r.learner.position || '')}</small></td><td>${r.summary.saved}/${r.summary.saved + r.summary.missing}</td><td><span class="hub-report-status ${r.summary.finalRec?'ok':'warn'}">${esc(finalText)}</span></td><td>${watchCount || '-'}</td><td><span class="hub-report-status ${r.recordStatus==='ok'?'ok':(r.recordStatus==='bad'?'bad':'warn')}">${esc(r.recordText)}</span></td><td>${esc(r.summary.records[0] ? phfEvalUpdatedText(r.summary.records[0]) : '-')}</td><td><div class="hub-report-action-row"><span class="thin-btn" onclick="phfHubSetLearnerAndOpen('${esc(r.learner.id)}','evaluation','${esc(r.actionPeriod)}','history')">Lịch sử</span><span class="thin-btn" onclick="phfHubSetLearnerAndOpen('${esc(r.learner.id)}','evaluation','${esc(r.actionPeriod)}','edit')">Xử lý</span></div></td></tr>`;
  }).join('');
  document.getElementById('miniStatus').textContent='Báo cáo';
  document.getElementById('contextTitle').textContent='Bạn đang ở: Báo cáo đào tạo';
  document.getElementById('contextSub').textContent='Tổng hợp tiến độ học, điểm bài kiểm tra và tình trạng hồ sơ đánh giá';
  document.getElementById('contextAction').textContent=phfRoleLabel();
  document.getElementById('mainLesson').innerHTML = `<section class="eval-admin-shell">${phfRenderHubTopbar('reports', profile, canEdit)}<div class="eval-admin-page"><main class="eval-admin-main hub-report-page"><div class="hub-dashboard-hero"><div><h2>Báo cáo đào tạo</h2><p>Bảng điều hành cứng cáp để lọc, đối chiếu tiến độ học, điểm bài kiểm tra và hồ sơ đánh giá.</p></div><div class="hub-dashboard-note">${esc(phfRoleLabel())}<small>${total} học viên theo bộ lọc</small></div></div><section class="hub-report-filters"><div class="hub-report-filter"><label>Chương trình</label><select id="phfReportProgram">${programOptions}</select></div><div class="hub-report-filter"><label>Chi nhánh</label><select id="phfReportBranch">${branchOptions}</select></div><div class="hub-report-filter"><label>Trạng thái</label><select id="phfReportStatus">${statusOptions}</select></div><button class="eval-action primary" type="button" onclick="phfApplyReportFilters()">Lọc báo cáo</button><button class="eval-action" type="button" onclick="phfRenderTrainingReports({program:'all',branch:'all',status:'all'})">Xóa lọc</button></section><div class="hub-report-top"><section class="hub-report-main-card"><h3>Hồ sơ đánh giá</h3><p>Theo dõi đủ/thiếu phiếu, phiếu quá hạn và học viên cần xử lý.</p><b>${missingEvalLearners} học viên thiếu hồ sơ</b><div class="action-row"><button class="eval-action primary" type="button" onclick="renderEvaluationRecords()">Mở Đánh giá →</button></div></section><div class="hub-report-metric"><b>${total}</b><span>Học viên</span><p>Trong phạm vi bộ lọc hiện tại.</p></div><div class="hub-report-metric"><b>${testAgg.scored ? testAgg.avg + '%' : '-'}</b><span>Điểm bài kiểm tra TB</span><p>${testAgg.fail} chưa đạt · ${testAgg.none} chưa làm.</p></div><div class="hub-report-metric"><b>${needAttention}</b><span>Cần xử lý</span><p>${overdueLearners} quá hạn · ${noStart} thiếu ngày bắt đầu.</p></div></div><div class="hub-report-grid"><section class="hub-panel"><div class="hub-panel-head"><h3>Tiến độ theo giai đoạn</h3><span>tóm tắt gọn</span></div>${phfReportMiniRows(stageItems, Math.max(1,total))}<div class="phf-report-compact-note">Xem chi tiết từng học viên ở bảng bên dưới.</div></section><section class="hub-panel"><div class="hub-panel-head"><h3>Tình trạng bài kiểm tra</h3><span>tóm tắt gọn</span></div>${phfReportMiniRows(testStatusItems, Math.max.apply(null,testStatusItems.map(function(x){return x.value}).concat([1])))}<div class="phf-report-compact-note">Ưu tiên xử lý học viên chưa làm hoặc chưa đạt.</div></section></div><section class="hub-panel"><div class="hub-report-table-note"><div><h3>Tiến độ học viên</h3><small>Phục vụ rà tiến độ học, điểm bài kiểm tra và trạng thái cần nhắc.</small></div></div><div class="eval-table-wrap"><table class="hub-action-table hub-report-table"><thead><tr><th>Học viên</th><th>Chi nhánh/Vị trí</th><th>Chương trình</th><th>Ngày bắt đầu</th><th>Giai đoạn</th><th>Tiến độ</th><th>Điểm bài kiểm tra</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${progressRows || '<tr><td colspan="9">Không có học viên phù hợp bộ lọc.</td></tr>'}</tbody></table></div></section><section class="hub-panel"><div class="hub-report-table-note"><div><h3>Hồ sơ đánh giá</h3><small>Rà tình trạng phiếu tuần, tháng, kết thúc và tiêu chí cần theo dõi.</small></div></div><div class="eval-table-wrap"><table class="hub-action-table hub-report-table"><thead><tr><th>Học viên</th><th>Phiếu đã lưu</th><th>Phiếu kết thúc</th><th>Cần theo dõi</th><th>Trạng thái hồ sơ</th><th>Cập nhật gần nhất</th><th>Thao tác</th></tr></thead><tbody>${evalRows || '<tr><td colspan="7">Không có dữ liệu hồ sơ phù hợp bộ lọc.</td></tr>'}</tbody></table></div></section><div class="record-note">Báo cáo nền: ưu tiên xem/lọc nhanh và xử lý hồ sơ. Xuất bảng tính / bản in có thể làm sau khi bảng dữ liệu đã chốt.</div></main></div></section>`;
  ['phfReportProgram','phfReportBranch','phfReportStatus'].forEach(function(id){ const el = document.getElementById(id); if(el) el.addEventListener('change', phfApplyReportFilters); });
  phfScrollToPageTop();
}
function phfApplyReportFilters(){
  const program = (document.getElementById('phfReportProgram') || {}).value || 'all';
  const branch = (document.getElementById('phfReportBranch') || {}).value || 'all';
  const status = (document.getElementById('phfReportStatus') || {}).value || 'all';
  phfRenderTrainingReports({program:program, branch:branch, status:status});
}

function phfRenderHubPlaceholder(tab){
  document.body.classList.add('phf-eval-mode','phf-module-page-mode');
  document.body.classList.remove('phf-guide-standalone-mode','phf-guide-intro-active');
  const canEdit = phfCanEditEvaluation();
  const profile = phfEvaluationTargetProfile();
  const title = tab === 'reports' ? 'Báo cáo' : (tab === 'guide' ? 'Hướng dẫn sử dụng' : 'Cài đặt');
  const desc = tab === 'reports'
    ? 'Khu này sẽ dùng để tổng hợp tiến độ học, phiếu còn thiếu, học viên cần theo dõi và kết quả đào tạo.'
    : (tab === 'guide' ? 'Khu này hướng dẫn người dùng vào bài học, xem hồ sơ và đổi tài khoản khi cần.' : 'Khu này sẽ dành cho Quản trị cấu hình chương trình, học viên, quyền, nội dung và mốc đào tạo.');
  document.getElementById('miniStatus').textContent=title;
  document.getElementById('contextTitle').textContent='Bạn đang ở: ' + title;
  document.getElementById('contextSub').textContent=desc;
  document.getElementById('contextAction').textContent=canEdit ? phfRoleLabel() : 'Chế độ xem';
  document.getElementById('mainLesson').innerHTML = `<section class="eval-admin-shell">${phfRenderHubTopbar(tab, profile, canEdit)}<div class="eval-admin-page"><aside class="eval-admin-sidebar"><section class="eval-card eval-profile-card"><h3>Trạng thái</h3><div class="eval-profile-lines"><div class="eval-profile-line"><b>Khu vực</b><span>${esc(title)}</span></div><div class="eval-profile-line"><b>Tình trạng</b><span>Định hướng</span></div><div class="eval-profile-line"><b>Ưu tiên</b><span>Làm sau lõi</span></div></div></section></aside><main class="eval-admin-main"><section class="hub-panel hub-placeholder"><h2>${esc(title)}</h2><p>${esc(desc)}</p><div class="record-note" style="margin-top:14px">Hiện tại khu này được giữ ở mức khung định hướng để không làm nặng hệ thống và không ảnh hưởng các luồng đang ổn.</div><div class="hub-shortcuts"><button class="eval-action primary" type="button" onclick="phfRenderTrainingOverview()">Về Tổng quan</button>${canEdit ? '' : '<button class="eval-action" type="button" onclick="phfGoLearning()">Học tập</button>'}<button class="eval-action" type="button" onclick="renderEvaluationRecords()">${canEdit ? 'Đánh giá' : 'Hồ sơ của tôi'}</button></div></section></main></div></section>`;
  phfScrollToPageTop();
}

async function renderEvaluationRecords(selectedKey, mode, options){
  phfSetMainNavActive('profile');
  try{ if(typeof window.phfRefreshResumeSave === 'function') window.phfRefreshResumeSave('profile', {hubTab:'profile'}); }catch(e){}
  options = options || {};
  const silentNotice = !!options.silentNotice;
  document.body.classList.add('phf-eval-mode','phf-module-page-mode');
  document.body.classList.remove('phf-guide-standalone-mode','phf-guide-intro-active');
  if(!window.__phfEvalReadFresh){
    window.__phfEvalReadFresh = true;
    await phfRefreshTrainingData();
    phfToastClear('evaluation-load');
  }
  const canEdit = phfCanEditEvaluation();
  const profile = phfEvaluationTargetProfile();
  const timeline = phfBuildTimelineForProfile(profile);
  const periods = phfBuildEvaluationPeriods(profile);
  const selected = periods.find(function(p){return p.key === selectedKey;}) || phfPickDefaultWeek(periods, profile.id);
  const activeTab = phfEvalActiveTab(mode);
  const savedCount = phfEvaluationRecordsFor(profile.id).length;
  const selectedRecordForNotice = selected ? phfPeriodRecord(profile.id, selected) : null;
  const noticeKey = `${profile.id}|${selected && selected.key || ''}|${mode || 'view'}|${selectedRecordForNotice ? 'has' : 'empty'}`;
  if(false && !silentNotice && window.__phfEvalNoticeKey !== noticeKey){
    window.__phfEvalNoticeKey = noticeKey;
    if(selected){
      if(mode === 'edit' && canEdit){
        phfToast('info', selectedRecordForNotice ? 'Mở phiếu để sửa' : 'Tạo phiếu đánh giá', `${selected.label} · ${phfFormatRange(selected.start, selected.end)}`, 2600, 'evaluation-view');
      }else if(selectedRecordForNotice){
        phfToast('success', 'Đang xem phiếu đã lưu', `${selected.label} · ${phfFormatRange(selected.start, selected.end)}`, 2400, 'evaluation-view');
      }else{
        phfToast('warning', 'Chưa có phiếu lưu', canEdit ? 'Có thể bấm Tạo phiếu khi đã có đủ nhận xét thực tế.' : 'Khi người phụ trách lưu phiếu, học viên sẽ xem được tại đây.', 3600, 'evaluation-view');
      }
    }
  }
  document.getElementById('miniStatus').textContent='Hồ sơ đánh giá';
  document.getElementById('contextTitle').textContent='Bạn đang ở: Hồ sơ đánh giá';
  document.getElementById('contextSub').textContent= canEdit ? 'Chọn học viên, xem phiếu đã lưu, tạo phiếu mới hoặc sửa phiếu cũ' : 'Xem lại phiếu đánh giá đã được lưu';
  document.getElementById('contextAction').textContent= canEdit ? phfRoleLabel() : 'Chế độ xem';
  const statusText = timeline ? `GĐ5: ${phfFormatRange(timeline.ranges[4].start, timeline.ranges[4].end)}` : 'Chưa có ngày bắt đầu học';
  const roleText = canEdit
    ? `${phfRoleLabel()} có thể xem danh sách học viên, tạo phiếu mới và cập nhật phiếu đã lưu.`
    : 'Học viên chỉ xem lại phiếu đánh giá của chính mình khi người phụ trách đã lưu phiếu.';
  const learnerPicker = phfRenderLearnerPicker(profile.id);
  const topCreate = canEdit && selected ? `<button class="eval-primary-action eval-table-action" type="button" data-action="edit" data-week-key="${esc(selected.key)}">+ ${phfPeriodRecord(profile.id, selected)?'Sửa phiếu đang chọn':'Tạo phiếu đánh giá'}</button>` : '';
  const savedLabel = savedCount ? `${savedCount} phiếu` : 'Chưa có phiếu';
  document.getElementById('mainLesson').innerHTML = `<section class="eval-admin-shell">
    ${phfRenderHubTopbar('evaluation', profile, canEdit)}
    <div class="eval-admin-page"><aside class="eval-admin-sidebar"><section class="eval-card eval-profile-card"><h3>Hồ sơ học viên</h3><div class="eval-profile-lines"><div class="eval-profile-line"><b>Họ tên</b><span>${esc(profile.fullName)}</span></div><div class="eval-profile-line"><b>SĐT</b><span>${esc(profile.phone || 'Chưa có')}</span></div><div class="eval-profile-line"><b>Vị trí</b><span>${esc(profile.position || 'Nhân viên bán hàng mới')}</span></div><div class="eval-profile-line"><b>Chi nhánh</b><span>${esc(profile.branch || 'Chưa phân chi nhánh')}</span></div><div class="eval-profile-line"><b>Ngày bắt đầu</b><span>${esc(profile.studyStartDate || 'Chưa nhập')}</span></div></div></section><section class="eval-card eval-period-card"><div class="eval-period-head"><h3>Kỳ đánh giá</h3><button class="eval-small-plus eval-period-toggle" type="button" aria-expanded="true" onclick="phfToggleEvalPeriodList(this)">−</button></div>${selected?`<div class="eval-period-current-label">Đang thao tác</div><button class="eval-period-current eval-period-item" type="button" data-action="view" data-week-key="${esc(selected.key)}"><span><b>${esc(selected.label)}</b><small>${esc(phfEvalShortType(selected))} · ${phfFormatRange(selected.start,selected.end)}</small></span><em class="eval-status-chip ${phfEvalStatus(selected.start, selected.end, !!phfPeriodRecord(profile.id, selected)).cls}">${esc(phfEvalStatus(selected.start, selected.end, !!phfPeriodRecord(profile.id, selected)).text)}</em></button>`:''}<div id="evalPeriodListWrap" class="eval-period-list-wrap">${periods.length ? phfRenderEvalPeriodList(periods, profile.id, selected && selected.key) : '<div class="eval-empty clean">Chưa có ngày bắt đầu học để tính kỳ đánh giá.</div>'}</div></section></aside>
      <main class="eval-admin-main"><div class="eval-toolbar"><div><h2>Hồ sơ đánh giá</h2><p>${esc(roleText)}</p></div>${topCreate}</div>${learnerPicker || ''}<div class="eval-summary-strip"><div class="status-item"><b>Học viên đang xem</b><span>${esc(profile.fullName)}</span></div><div class="status-item"><b>Tiến trình đánh giá</b><span>${esc(statusText)}</span></div><div class="status-item"><b>Phiếu đã lưu</b><span>${esc(savedLabel)}</span></div><div class="status-item"><b>Quyền hiện tại</b><span>${esc(canEdit ? phfRoleLabel() : 'Chỉ xem')}</span></div></div>${phfRenderEvalTabs(selected, canEdit, activeTab)}<section class="eval-detail-panel" id="weeklyFormBox"></section><div class="actions"><button class="btn btn-soft" type="button" onclick="phfGoLearning()">← Quay lại bài đang học</button></div></main></div></section>`;
  const learnerSelect = document.getElementById('evalLearnerSelect');
  if(learnerSelect){ learnerSelect.onchange = function(){
    phfToastClear('evaluation-learner');
    phfSetEvaluationTarget(this.value);
  }; }
  document.querySelectorAll('.eval-table-action,.eval-period-item').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      const key = btn.dataset.weekKey;
      const action = btn.dataset.action || 'view';
      if(!key) return;
      renderEvaluationRecords(key, action === 'edit' ? 'edit' : 'view');
    });
  });
  if(selected){
    const rec = phfPeriodRecord(profile.id, selected);
    if(activeTab === 'history') phfRenderEvaluationHistory(periods, profile.id);
    else if(canEdit && activeTab === 'input') phfRenderWeeklyForm(selected);
    else if(canEdit && !rec && activeTab === 'input') phfRenderWeeklyForm(selected);
    else phfRenderWeeklyView(selected);
  }
}


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
      position: val('position') || saved.position || 'Nhân viên bán hàng mới',
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
    page: window.phfCurrentLessonKey || ('lesson:' + (typeof current === 'number' ? current : ''))
  };
  return record;
}
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
  phfUpdateBMTTPrintFields();
  const record = phfCollectBMTT();
  localStorage.setItem('phfConfidentialityCommitment', JSON.stringify(record));
  phfSetStatus('phfBmtStatus','Đang lưu xác nhận cam kết...', 'info');
  try{
    const employee = phfCurrentProfileForForms();
    employee.fullName = record.fullName;
    employee.birthday = record.birthday;
    employee.phone = record.phone;
    employee.branch = record.branch;
    employee.position = record.position;
    const payload = {type:'confidentiality-commitment', employee:employee, currentPage:record.page, skipProgress:true, confidentialityCommitment:record};
    const res = await fetch('/api/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const json = await res.json();
    if(json && json.data) window.__phfLocalData = json.data;
    if(json && json.ok){ phfSetStatus('phfBmtStatus','Đã lưu xác nhận cam kết bảo mật thông tin.', 'ok'); return true; }
    phfSetStatus('phfBmtStatus','Chưa lưu được lên hệ thống. Bản xác nhận vẫn được lưu tạm trên trình duyệt.', 'warn');
    return true;
  }catch(e){
    console.warn('PHF BMTT save error:', e);
    phfSetStatus('phfBmtStatus','Chưa kết nối được máy chủ. Bản xác nhận vẫn được lưu tạm trên trình duyệt.', 'warn');
    return true;
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
  const html = phfBuildBMTTPrintHTML(record);
  const win = window.open('', '_blank');
  if(!win){
    phfNotice('warning','Trình duyệt đang chặn cửa sổ in','Vui lòng cho phép mở cửa sổ mới để in bản cam kết.');
    return false;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  try{ win.focus(); setTimeout(function(){ win.print(); }, 450); }catch(e){}
  return true;
}
async function phfPrintConfidentialityCommitment(){
  if(!phfValidateConfidentialityCommitment(false)) return;
  phfUpdateBMTTPrintFields();
  await phfSaveConfidentialityCommitment();
  const record = phfCollectBMTT();
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
function phfTryNextFromLesson(){
  if(!phfValidateMorningCommitment()) return;
  if(!phfValidateRequiredLessonChecks()) return;
  if(!phfValidateConfidentialityCommitment(false)) return;
  go(current+1);
}


/* PHF PATCH STAGE 3.13.9 - Quiz scoring + content polish helpers */
function phfMarkQuizAnswers(questions, attrName){
  var total = questions.length, correct = 0, missing = 0;
  questions.forEach(function(q){
    q.classList.remove('phf-quiz-correct','phf-quiz-wrong','b3-correct','b3-incorrect','b4-correct','b4-incorrect','correct','wrong');
    var answer = q.getAttribute(attrName) || q.getAttribute('data-correct') || q.getAttribute('data-answer') || '';
    var checked = q.querySelector('input[type="radio"]:checked');
    if(!checked){ missing++; q.classList.add('phf-quiz-wrong'); return; }
    if(String(checked.value) === String(answer)){
      correct++;
      q.classList.add('phf-quiz-correct','b3-correct','b4-correct','correct');
    }else{
      q.classList.add('phf-quiz-wrong','b3-incorrect','b4-incorrect','wrong');
    }
  });
  return {total:total, correct:correct, missing:missing, score: total ? Math.round(correct/total*100) : 0};
}
function phfRenderQuizResult(el, stat, passScore){
  if(!el) return;
  var passed = stat.score >= (passScore || 80);
  el.classList.remove('pass','fail','show');
  el.classList.add(passed ? 'pass' : 'fail','show');
  var missingText = stat.missing ? ' · Còn ' + stat.missing + ' câu chưa chọn.' : '';
  el.innerHTML = '<b>' + (passed ? 'Đạt' : 'Chưa đạt') + ' · ' + stat.score + '/100 điểm</b><br>Đúng ' + stat.correct + '/' + stat.total + ' câu.' + missingText + (passed ? '<br>Bạn có thể tiếp tục phần tiếp theo.' : '<br>Vui lòng xem lại các câu chưa đúng/chưa chọn rồi chấm lại.');
}
function phfStoreQuizResult(key, stat){
  try{
    var list = JSON.parse(localStorage.getItem('phfQuizResults') || '[]');
    list.push({key:key, lessonIndex: (typeof current !== 'undefined' ? current : null), score:stat.score, correct:stat.correct, total:stat.total, savedAt:new Date().toISOString()});
    localStorage.setItem('phfQuizResults', JSON.stringify(list.slice(-80)));
  }catch(e){}
}
function phfGradeStep2Test(btn){
  var root = document.getElementById('mainLesson'); if(!root) return;
  var questions = Array.from(root.querySelectorAll('.step2-question[data-correct]'));
  var result = document.getElementById('step2TestResult');
  if(!questions.length){ phfNotice('warning','Chưa tìm thấy câu hỏi','Hệ thống chưa nhận được danh sách câu hỏi để chấm.'); return; }
  phfSetButtonLoading(btn, true, 'Đang chấm điểm...');
  setTimeout(function(){
    var stat = phfMarkQuizAnswers(questions, 'data-correct');
    phfRenderQuizResult(result, stat, 80);
    phfStoreQuizResult('step2-final', stat);
    phfSetButtonLoading(btn, false);
  }, 80);
}
function phfGradeB3Test(btn){
  var root = document.getElementById('b3Test') || document.getElementById('mainLesson'); if(!root) return;
  var questions = Array.from(root.querySelectorAll('.b3-mini[data-answer]'));
  var result = document.getElementById('b3Result');
  if(!questions.length){ phfNotice('warning','Chưa tìm thấy câu hỏi','Hệ thống chưa nhận được danh sách câu hỏi để chấm.'); return; }
  phfSetButtonLoading(btn, true, 'Đang chấm điểm...');
  setTimeout(function(){
    var stat = phfMarkQuizAnswers(questions, 'data-answer');
    phfRenderQuizResult(result, stat, 80);
    var next = document.getElementById('goB3Complete');
    if(next) next.style.display = stat.score >= 80 ? 'inline-flex' : 'none';
    phfStoreQuizResult('step3-final', stat);
    phfSetButtonLoading(btn, false);
  }, 80);
}
function phfGradeB4Final(btn){
  var root = document.getElementById('b4FinalTest') || document.getElementById('mainLesson'); if(!root) return;
  var questions = Array.from(root.querySelectorAll('.b4-final-question[data-correct]'));
  var result = document.getElementById('b4FinalResult');
  if(!questions.length){ phfNotice('warning','Chưa tìm thấy câu hỏi','Hệ thống chưa nhận được danh sách câu hỏi để chấm.'); return; }
  phfSetButtonLoading(btn, true, 'Đang chấm điểm...');
  setTimeout(function(){
    var stat = phfMarkQuizAnswers(questions, 'data-correct');
    phfRenderQuizResult(result, stat, 80);
    var next = document.getElementById('goB4Complete');
    if(next) next.style.display = stat.score >= 80 ? 'inline-flex' : 'none';
    phfStoreQuizResult('step4-final', stat);
    phfSetButtonLoading(btn, false);
  }, 80);
}
function phfBindLessonQuizScoring(){
  var root = document.getElementById('mainLesson'); if(!root) return;
  var step2 = document.getElementById('gradeStep2Test');
  if(step2 && step2.dataset.phfBound !== '1'){ step2.dataset.phfBound='1'; step2.addEventListener('click', function(){ phfGradeStep2Test(step2); }); }
  var b3 = document.getElementById('gradeB3Test');
  if(b3 && b3.dataset.phfBound !== '1'){ b3.dataset.phfBound='1'; b3.addEventListener('click', function(){ phfGradeB3Test(b3); }); }
  var b4 = document.getElementById('gradeB4Final');
  if(b4 && b4.dataset.phfBound !== '1'){ b4.dataset.phfBound='1'; b4.addEventListener('click', function(){ phfGradeB4Final(b4); }); }
  var goB3 = document.getElementById('goB3Complete');
  if(goB3 && goB3.dataset.phfBound !== '1'){ goB3.dataset.phfBound='1'; goB3.addEventListener('click', function(){ phfTryNextFromLesson(); }); }
  var goB4 = document.getElementById('goB4Complete');
  if(goB4 && goB4.dataset.phfBound !== '1'){ goB4.dataset.phfBound='1'; goB4.addEventListener('click', function(){ phfTryNextFromLesson(); }); }
}

function phfInitContentForms(){
  phfPrefillBMTTForm(false);
  phfBindLessonQuizScoring();
  const paper = document.getElementById('phfBmtPaper');
  if(paper && !paper.dataset.phfBound){
    paper.dataset.phfBound = '1';
    paper.addEventListener('input', phfUpdateBMTTPrintFields);
    paper.addEventListener('change', phfUpdateBMTTPrintFields);
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
  if(evalBtn){ evalBtn.onclick = function(){ renderEvaluationRecords(); }; }
  if(evalHistoryBtn){ evalHistoryBtn.onclick = function(){ renderEvaluationRecords(null,'history'); }; }
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
    position:'Nhân viên bán hàng mới',
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
  role = String(role || 'learner').toLowerCase();
  if(!['admin','manager','learner'].includes(role)) role = 'learner';
  try{ localStorage.setItem('phfInternalTestRole', role); }catch(e){}
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
  try{ localStorage.removeItem('phfInternalTestRole'); }catch(e){}
  phfShowRoleChooser(true);
}
function phfShowRoleSwitcher(){
  let bar = document.getElementById('phfRoleSwitcher');
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
      try{ if(typeof renderEvaluationRecords === 'function') renderEvaluationRecords(); }catch(e){}
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
