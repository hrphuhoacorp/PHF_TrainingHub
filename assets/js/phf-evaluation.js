/* PHF Training Hub - Bản 27
   Tách logic đánh giá / hồ sơ đánh giá / báo cáo đào tạo ra file riêng.
   File này chỉ giữ các hàm xử lý giao diện và lưu phiếu đánh giá, không đổi Supabase/schema/server.
*/


// PHF 57.8: UI helper dùng chung cho các màn Báo cáo/Đánh giá.
// Định nghĩa tại phạm vi global để các renderer legacy gọi trực tiếp không bị ReferenceError.
var phfScrollToPageTop = (typeof window !== 'undefined' && typeof window.phfScrollToPageTop === 'function')
  ? window.phfScrollToPageTop
  : function phfScrollToPageTopFallback(){
      try{
        if(typeof window !== 'undefined' && typeof window.scrollTo === 'function'){
          window.scrollTo({top:0,left:0,behavior:'auto'});
          return;
        }
      }catch(e){}
      try{
        if(typeof document !== 'undefined'){
          if(document.documentElement) document.documentElement.scrollTop = 0;
          if(document.body) document.body.scrollTop = 0;
        }
      }catch(e){}
    };
if(typeof window !== 'undefined') window.phfScrollToPageTop = phfScrollToPageTop;

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
      employeeCode: saved.employeeCode || saved.employee_code || localStorage.getItem('phfEmployeeCode') || '',
      email: saved.email || localStorage.getItem('phfSimpleTestLoginEmail') || '',
      branch: saved.branch || 'Chưa phân chi nhánh',
      department: saved.department || 'Bán hàng',
      position: saved.position || 'Nhân viên bán hàng',
      studyStartDate: saved.studyStartDate || localStorage.getItem('phfStudyStartDate') || ''
    };
  }catch(e){
    return {id: localStorage.getItem('phfEmployeeId') || '', fullName:'Chưa có tên học viên', phone:'', employeeCode:localStorage.getItem('phfEmployeeCode') || '', email:localStorage.getItem('phfSimpleTestLoginEmail') || '', branch:'', department:'', position:'Nhân viên bán hàng', studyStartDate: localStorage.getItem('phfStudyStartDate') || ''};
  }
}

function phfEmployeeFromRow(e){
  e = e || {};
  return {
    id: e.id || e.employeeId || e.employee_id || '',
    fullName: e.fullName || e.full_name || e.name || 'Chưa có tên học viên',
    phone: e.phone || '',
    employeeCode: e.employeeCode || e.employee_code || e.code || '',
    email: e.email || e.workEmail || e.personalEmail || '',
    branch: e.branch || e.store || 'Chưa phân chi nhánh',
    department: e.department || 'Bán hàng',
    position: e.position || 'Nhân viên bán hàng',
    studyStartDate: e.studyStartDate || e.study_start_date || '',
    programId: e.programId || e.program_id || 'new_sales'
  };
}
function phfAllEvaluationLearners(){
  const sourceData = window.__phfLocalData || window.localData || {};
  const rows = Array.isArray(sourceData.employees) ? sourceData.employees : [];
  const mapped = rows.map(phfEmployeeFromRow).filter(function(e){
    if(!e.id) return false;
    if(e.id === 'admin-test-phf') return false;
    if(/admin test/i.test(e.fullName + ' ' + e.position)) return false;
    return true;
  });

  // Học viên tuyệt đối chỉ được nhìn thấy hồ sơ của chính mình trong giao diện.
  if(typeof phfCanEditEvaluation === 'function' && !phfCanEditEvaluation()){
    const current = phfCurrentEmployeeProfile();
    const phone = String(current.phone||'').replace(/\D/g,'');
    const own = mapped.find(function(e){
      return (current.id && String(e.id)===String(current.id)) ||
             (phone && String(e.phone||'').replace(/\D/g,'')===phone);
    });
    return own ? [own] : (current.id ? [current] : []);
  }

  return mapped.sort(function(a,b){ return String(a.fullName||'').localeCompare(String(b.fullName||''),'vi'); });
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
  renderEvaluationRecords(undefined, 'view', {forceProfile:true});
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

// PHF 57.7: Bộ tổng hợp dùng chung cho Tổng quan/Báo cáo.
// Các hàm này từng được renderer gọi trực tiếp nhưng không còn định nghĩa trong bundle,
// khiến /admin/bao-cao dừng với ReferenceError.
function phfHubPeriodSummary(profile){
  profile = profile || {};
  const periods = phfBuildEvaluationPeriods(profile);
  const records = phfEvaluationRecordsFor(profile.id || '');
  const today = phfTodayOnly();
  let saved = 0, missing = 0, overdue = 0, due = 0;
  periods.forEach(function(period){
    const rec = phfPeriodRecord(profile.id, period);
    if(rec){ saved++; return; }
    missing++;
    if(today.getTime() > period.end.getTime()) overdue++;
    else if(today.getTime() >= period.start.getTime() && today.getTime() <= period.end.getTime()) due++;
  });
  const finalPeriod = periods.find(function(p){ return p.formType === 'final'; }) || null;
  const finalRec = finalPeriod ? phfPeriodRecord(profile.id, finalPeriod) : null;
  return {periods:periods, records:records, saved:saved, missing:missing, overdue:overdue, due:due, finalPeriod:finalPeriod, finalRec:finalRec};
}
function phfHubDateText(value){
  if(!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if(Number.isNaN(d.getTime())) return String(value || '');
  return d.toLocaleDateString('vi-VN');
}
function phfHubLearnerStage(profile){
  const timeline = phfBuildTimelineForProfile(profile || {});
  if(!timeline) return {key:'missing', label:'Chưa nhập ngày', pct:0, currentRange:''};
  const today = phfTodayOnly();
  const start = timeline.start.getTime();
  const end = timeline.end.getTime();
  const now = today.getTime();
  if(now > end) return {key:'done', label:'Hết mốc', pct:100, currentRange:phfHubDateText(timeline.start)+' – '+phfHubDateText(timeline.end)};
  let idx = 0;
  timeline.ranges.forEach(function(r,i){ if(now >= r.start.getTime()) idx = i; });
  const range = timeline.ranges[idx] || timeline.ranges[0];
  const totalDays = Math.max(1, Math.round((end-start)/86400000)+1);
  const elapsed = Math.max(0, Math.min(totalDays, Math.round((now-start)/86400000)+1));
  return {key:'g'+(idx+1), label:'GĐ'+(idx+1), pct:Math.max(0,Math.min(100,Math.round(elapsed/totalDays*100))), currentRange:phfHubDateText(range.start)+' – '+phfHubDateText(range.end)};
}
function phfHubTestInfoFor(profile){
  const data = window.__phfLocalData || window.localData || {};
  const all = Array.isArray(data.testResults) ? data.testResults : [];
  const id = String(profile && profile.id || '');
  const rows = all.filter(function(r){ return String(r.employeeId || r.employee_id || '') === id; }).sort(function(a,b){
    const av = String(a.updatedAt || a.updated_at || a.savedAt || a.saved_at || '');
    const bv = String(b.updatedAt || b.updated_at || b.savedAt || b.saved_at || '');
    return bv.localeCompare(av);
  });
  if(!rows.length) return {cls:'missing', label:'Chưa làm', status:'Chưa làm', score:null, stage:''};
  const row = rows[0] || {};
  const score = Number(row.score);
  const passScore = Number(row.passScore || row.pass_score || 80);
  const raw = String(row.status || row.resultText || row.result_text || '').toLowerCase();
  const passed = raw.includes('passed') || raw.includes('pass') || raw.includes('đạt') || (Number.isFinite(score) && score >= passScore);
  return {cls:passed?'pass':'fail', label:Number.isFinite(score)?(Math.round(score)+'%'):(passed?'Đạt':'Chưa đạt'), status:passed?'Đạt':'Chưa đạt', score:Number.isFinite(score)?score:null, stage:String(row.stage || row.phase || row.period || '')};
}
function phfHubLearningProgress(){
  const total = Array.isArray(window.LESSONS) ? window.LESSONS.length : (typeof LESSONS !== 'undefined' && Array.isArray(LESSONS) ? LESSONS.length : 0);
  let done = 0, currentIndex = 0;
  try{
    const scoped = JSON.parse(localStorage.getItem('phfProgress') || localStorage.getItem('phfLearningProgress') || '{}');
    const completed = scoped.completedPages || scoped.completed || [];
    done = Array.isArray(completed) ? completed.length : Number(scoped.done || 0);
    currentIndex = Number(scoped.currentIndex || scoped.lessonIndex || localStorage.getItem('phfCurrentLessonIndex') || 0);
  }catch(e){}
  const list = (typeof LESSONS !== 'undefined' && Array.isArray(LESSONS)) ? LESSONS : (Array.isArray(window.LESSONS) ? window.LESSONS : []);
  const lesson = list[currentIndex] || list[0] || null;
  return {total:total, done:Math.max(0,Math.min(total||done,done)), pct:total?Math.max(0,Math.min(100,Math.round(done/total*100))):0, lesson:lesson};
}
function phfHubBarRows(items, maxValue){
  items = Array.isArray(items) ? items : [];
  maxValue = Math.max(1, Number(maxValue) || 1);
  return items.map(function(item){
    const value = Number(item && item.value || 0);
    const pct = Math.max(0, Math.min(100, Math.round(value / maxValue * 100)));
    return `<div class="hub-bar-row"><div class="hub-bar-label"><span>${esc(item && item.label || '')}</span><b>${esc(value)}</b></div><div class="hub-bar-track"><span class="${esc(item && item.cls || '')}" style="width:${pct}%"></span></div></div>`;
  }).join('') || '<div class="hub-empty">Chưa có dữ liệu.</div>';
}
function phfReportMiniRows(items, maxValue){
  items = Array.isArray(items) ? items : [];
  maxValue = Math.max(1, Number(maxValue) || 1);
  const rows = items.map(function(item){
    const value = Math.max(0, Number(item && item.value || 0));
    const pct = Math.max(0, Math.min(100, Math.round(value / maxValue * 100)));
    return `<div class="phf-report-summary-row"><span class="phf-report-summary-label">${esc(item && item.label || '')}</span><b class="phf-report-summary-count">${esc(value)}</b><div class="phf-report-summary-track" role="progressbar" aria-valuemin="0" aria-valuemax="${esc(maxValue)}" aria-valuenow="${esc(value)}"><span class="phf-report-summary-fill ${esc(item && item.cls || '')}" style="width:${pct}%"></span></div></div>`;
  }).join('');
  return `<div class="phf-report-summary-list">${rows || '<div class="hub-empty">Chưa có dữ liệu.</div>'}</div>`;
}
function phfHubTestAggregate(rows){
  rows = Array.isArray(rows) ? rows : [];
  let pass = 0, fail = 0, none = 0, scored = 0, scoreTotal = 0;
  const stageMap = {};
  rows.forEach(function(item){
    const test = item && item.test ? item.test : phfHubTestInfoFor(item && (item.learner || item) || {});
    if(test.cls === 'pass') pass++; else if(test.cls === 'fail') fail++; else none++;
    if(Number.isFinite(Number(test.score))){
      scored++; scoreTotal += Number(test.score);
      const key = test.stage || 'Khác';
      if(!stageMap[key]) stageMap[key] = {sum:0,count:0};
      stageMap[key].sum += Number(test.score); stageMap[key].count++;
    }
  });
  const ordered = ['GĐ1','GĐ2','GĐ3','GĐ4','GĐ5'];
  const stageItems = ordered.map(function(k){ const x=stageMap[k]; return {label:k,value:x?Math.round(x.sum/x.count):0,cls:''}; });
  Object.keys(stageMap).filter(function(k){ return ordered.indexOf(k)<0; }).forEach(function(k){ const x=stageMap[k]; stageItems.push({label:k,value:Math.round(x.sum/x.count),cls:''}); });
  return {pass:pass, fail:fail, none:none, scored:scored, avg:scored?Math.round(scoreTotal/scored):0, stageItems:stageItems};
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
  const detailRows = [];
  phfFinalEvaluationGroups().forEach(function(group){
    group.items.forEach(function(it, idx){
      const value = phfFinalRatingValue(items[it[0]]);
      const note = phfFinalNoteValue(items[it[0]]);
      detailRows.push(`<tr class="${idx===0?'final-paper-group-start':''}"><td class="final-paper-center final-paper-no">${esc(it[1])}</td><td>${idx===0?`<b>${esc(group.title)}</b><small>${esc(group.sub || '')}</small>`:''}</td><td><b>${esc(it[2])}</b><small>${esc(it[3] || '')}</small></td><td class="final-paper-center"><b>${esc(value)}</b></td><td>${esc(note || '')}</td></tr>`);
    });
  });
  const requiredReason = (items.__finalRequiredReason && items.__finalRequiredReason.note) || '';
  return `<div class="final-paper final-paper-v2"><div class="final-paper-title">Phiếu đánh giá kết thúc thời gian thử việc</div>
    <div class="final-paper-meta">Mã biểu mẫu: DGTV-01 · Phiên bản 01</div>
    <div class="final-paper-section">1. Thông tin nhân viên</div>
    <table class="final-paper-info"><tr><th>Họ và tên</th><td>${esc(profile.fullName || '')}</td><th>Mã nhân viên</th><td>${esc(profile.employeeCode || profile.phone || 'Chưa có')}</td></tr><tr><th>Vị trí</th><td>${esc(profile.position || 'Nhân viên bán hàng')}</td><th>Chi nhánh/Bộ phận</th><td>${esc(profile.branch || 'Chưa phân chi nhánh')}</td></tr><tr><th>Thời gian thử việc</th><td>${phfFormatRangeFull(period.start, period.end)}</td><th>Người đánh giá</th><td>${esc(existing.evaluator || 'Đã lưu')}</td></tr></table>
    <div class="final-paper-section">2. Nội dung đánh giá chi tiết</div><table class="final-paper-table final-paper-detail"><colgroup><col style="width:7%"><col style="width:18%"><col style="width:34%"><col style="width:14%"><col style="width:27%"></colgroup><thead><tr><th>STT</th><th>Nhóm tiêu chí</th><th>Nội dung đánh giá</th><th>Mức đánh giá</th><th>Ghi chú / bằng chứng</th></tr></thead><tbody>${detailRows.join('')}</tbody></table>
    <div class="final-paper-section">3. Nhận xét và kết luận</div><div class="final-paper-notes"><div><b>Nhận xét tổng quan</b><p>${esc(existing.notes || 'Chưa có nhận xét.')}</p></div><div><b>Góp ý / định hướng sau thử việc</b><p>${esc(existing.nextFocus || existing.next_focus || 'Chưa có góp ý.')}</p></div><div><b>Nội dung cần theo dõi / đề xuất</b><p>${esc(requiredReason || 'Không có ghi nhận thêm.')}</p></div><div class="final-paper-conclusion"><b>Kết luận thử việc</b><p>${esc(existing.conclusion || 'Chưa kết luận')}</p></div></div>
    <div class="final-signs"><div class="final-sign"><b>Nhân viên</b>Xác nhận nội dung</div><div class="final-sign"><b>Người đánh giá</b>${esc(existing.evaluator || '')}</div><div class="final-sign"><b>Quản lý / HCNS</b>Phê duyệt và lưu hồ sơ</div></div>
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
  const record = {id:`eval-final-${profile.id}-${period.key}`, employeeId:profile.id, formType:'final', periodKey:period.key, periodLabel:period.label, periodStart:phfIsoDate(period.start), periodEnd:phfIsoDate(period.end), evaluator:evaluator, statusItems:statusItems, notes:(document.getElementById('weeklyNotes')?.value || '').trim(), issues:issues, nextFocus:(document.getElementById('weeklyNextFocus')?.value || '').trim(), conclusion:conclusion, updatedAt:new Date().toISOString()};
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
      phfShowEvaluationSavedDialog(record, profile, period);
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
  .final-paper-meta{text-align:center!important;font-size:9pt!important;color:#555!important;margin:-4px 0 10px!important;}
  .final-paper-detail td{height:auto!important;}
  .final-paper-detail small{display:block!important;color:#555!important;font-size:8.5pt!important;line-height:1.3!important;margin-top:2px!important;}
  .final-paper-group-start td{border-top-width:1.5px!important;}
  .final-paper-no{white-space:nowrap!important;}
  .final-paper-notes{display:grid!important;grid-template-columns:1fr 1fr!important;border:1px solid #111!important;font-size:10.5pt!important;}
  .final-paper-notes>div{min-height:24mm!important;padding:7px!important;border-right:1px solid #111!important;border-bottom:1px solid #111!important;}
  .final-paper-notes>div:nth-child(2n){border-right:0!important;}
  .final-paper-notes>div:nth-last-child(-n+2){border-bottom:0!important;}
  .final-paper-notes b{display:block!important;text-transform:uppercase!important;font-size:9.5pt!important;margin-bottom:5px!important;}
  .final-paper-notes p{margin:0!important;white-space:pre-wrap!important;}
  .final-paper-conclusion p{font-weight:800!important;}
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
    else console.warn('Chưa có phiếu để in.');
    return false;
  }
  const titleEl = doc.querySelector('.eval-document-title h2,.final-paper-title');
  const title = titleEl ? titleEl.textContent.trim() : 'Phiếu đánh giá PHF';
  const html = phfBuildEvaluationPrintHTML(title, doc.outerHTML);
  const printRoute = '/print/evaluations/current';
  const win = window.open(printRoute, '_blank', 'noopener=false');
  if(!win){
    if(window.phfToast) phfToast('warning','Trình duyệt đang chặn cửa sổ in','Vui lòng cho phép mở cửa sổ mới để in phiếu đánh giá.', 4200, 'evaluation-print');
    else console.warn('Trình duyệt đang chặn cửa sổ in.');
    return false;
  }
  let sent = false;
  const sendPrint = function(){
    if(sent) return;
    try{
      win.postMessage({type:'PHF_EVALUATION_PRINT', html:html, title:title}, window.location.origin);
      sent = true;
    }catch(e){}
  };
  const onReady = function(event){
    if(event.origin !== window.location.origin || event.source !== win) return;
    if(event.data && event.data.type === 'PHF_EVALUATION_PRINT_READY'){
      window.removeEventListener('message', onReady);
      sendPrint();
    }
  };
  window.addEventListener('message', onReady);
  setTimeout(sendPrint, 900);
  setTimeout(function(){ window.removeEventListener('message', onReady); }, 5000);
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
        <div class="eval-doc-field"><b>Vị trí</b><span>${esc(profile.position || 'Nhân viên bán hàng')}</span></div>
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
    conclusion: phfConclusionForPeriod(period, statusItems),
    updatedAt: new Date().toISOString()
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
      phfShowEvaluationSavedDialog(record, profile, period);
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




/* PHF Official Evaluation Workspace 2026-07-10
   Truy vết phiếu khoa học cho Quản lý/Admin, không đổi schema Supabase. */
function phfEnsureEvaluationOfficialUi(){
  if(document.getElementById('phf-eval-official-ui')) return;
  const style=document.createElement('style');
  style.id='phf-eval-official-ui';
  style.textContent=`
  .phf-eval-workspace{display:grid;gap:16px;max-width:1440px;margin:0 auto;padding:0 0 34px;font-family:Arial,"Helvetica Neue",Helvetica,system-ui,sans-serif;color:#17382d}
.phf-eval-workspace{position:relative;min-height:520px}
.phf-eval-workspace.phf-eval-is-busy{pointer-events:none}
.phf-eval-workspace.phf-eval-is-busy:after{
  content:"Đang cập nhật...";
  position:absolute;
  right:18px;
  top:18px;
  z-index:8;
  padding:7px 11px;
  border:1px solid #d9e8e1;
  border-radius:999px;
  background:rgba(255,255,255,.96);
  box-shadow:0 5px 18px rgba(16,64,48,.08);
  color:#45685b;
  font-size:12px;
  font-weight:650
}
.phf-eval-content-enter{animation:phfEvalContentEnter .14s ease-out both}
@keyframes phfEvalContentEnter{
  from{opacity:.78}
  to{opacity:1}
}
@media (prefers-reduced-motion:reduce){
  .phf-eval-content-enter{animation:none!important}
}
  .phf-eval-work-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;padding:23px 25px;border-radius:22px;background:linear-gradient(135deg,#07543e,#0a6a4c);color:#fff;box-shadow:0 14px 34px rgba(5,75,52,.14)}
  .phf-eval-work-head h2{margin:5px 0 8px;color:#fff!important;font-size:28px;font-weight:600;letter-spacing:-.02em}.phf-eval-work-head p{margin:0;color:rgba(255,255,255,.84);line-height:1.55;max-width:830px}
  .phf-eval-work-role{background:#fff;color:#07543e;border-radius:15px;padding:12px 14px;min-width:180px;text-align:right;font-weight:600}.phf-eval-work-role small{display:block;color:#667a71;font-weight:400;margin-top:4px}
  .phf-eval-work-tabs{display:flex;gap:8px;flex-wrap:wrap;background:#fff;border:1px solid #dfeee7;border-radius:16px;padding:7px;box-shadow:0 7px 18px rgba(0,45,30,.04)}
  .phf-eval-work-tab{border:0;border-radius:11px;background:#f5faf7;color:#315448;padding:10px 14px;font-weight:600;cursor:pointer}.phf-eval-work-tab.active{background:#07543e;color:#fff}
  .phf-eval-work-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:11px}.phf-eval-work-metric{background:#fff;border:1px solid #e1eee8;border-radius:17px;padding:15px 16px}.phf-eval-work-metric b{display:block;font-size:25px;font-weight:650;color:#07543e}.phf-eval-work-metric span{display:block;margin-top:3px;font-size:13px;color:#62766d}
  .phf-eval-filter-card,.phf-eval-list-card{background:#fff;border:1px solid #dfeee7;border-radius:20px;box-shadow:0 8px 22px rgba(0,45,30,.045)}
  .phf-eval-filter-card{padding:15px}.phf-eval-filter-grid{display:grid;grid-template-columns:minmax(220px,1.5fr) repeat(4,minmax(140px,.75fr)) auto;gap:10px;align-items:end}
  .phf-eval-filter-field label{display:block;margin-bottom:6px;color:#50675d;font-size:12.5px;font-weight:600}.phf-eval-filter-field input,.phf-eval-filter-field select{width:100%;min-height:40px;border:1px solid #d5e8df;border-radius:11px;padding:0 11px;background:#fff;color:#17382d;outline:none;font:400 14px Arial,"Helvetica Neue",Helvetica,system-ui,sans-serif}
  .phf-eval-filter-actions{display:flex;gap:7px}.phf-eval-btn{min-height:40px;border-radius:11px;border:1px solid #cfe4dc;background:#fff;color:#07543e;padding:0 13px;font-weight:600;cursor:pointer;white-space:nowrap}.phf-eval-btn.primary{background:#07543e;color:#fff;border-color:#07543e}
  .phf-eval-list-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:17px 18px;border-bottom:1px solid #e8f1ed}.phf-eval-list-head h3{margin:0;color:#17382d;font-size:20px;font-weight:600}.phf-eval-list-head p{margin:4px 0 0;color:#687b73;font-size:13.5px}.phf-eval-result-count{display:inline-flex;align-items:center;min-height:29px;padding:0 10px;border-radius:999px;background:#f1f8f4;border:1px solid #d6e9e1;color:#07543e;font-size:12px;font-weight:600;white-space:nowrap}
  .phf-eval-table-wrap{overflow:auto}.phf-eval-official-table{width:100%;min-width:1080px;border-collapse:collapse}.phf-eval-official-table th{padding:11px 13px;background:#f8fbf9;border-bottom:1px solid #dfeee7;color:#50675d;text-align:left;font-size:12px;font-weight:600;white-space:nowrap}.phf-eval-official-table td{padding:12px 13px;border-bottom:1px solid #edf4f0;vertical-align:top;color:#263b33;font-size:13.5px}.phf-eval-official-table td b{display:block;font-weight:600;color:#17382d}.phf-eval-official-table td small{display:block;margin-top:3px;color:#6b7c75;line-height:1.35}
  .phf-eval-chip,.phf-status-chip{display:inline-flex;align-items:center;justify-content:center;min-height:28px;padding:0 11px;border-radius:999px;border:1px solid #d9e2de;background:#f4f6f5;color:#56665f;font-size:12px;font-weight:650;line-height:1;white-space:nowrap;vertical-align:middle}.phf-action-chip{display:inline-flex;align-items:center;justify-content:center;min-height:28px;padding:0 11px;border-radius:999px;border:1px solid #cfe0d8;background:#f8fbf9;color:#075b45;font-size:12px;font-weight:700;line-height:1;white-space:nowrap;vertical-align:middle;cursor:pointer;box-shadow:none}.phf-action-chip:hover{background:#edf6f1;border-color:#b9d5c8}.phf-action-chip.primary{background:#075b45;border-color:#075b45;color:#fff}.phf-action-chip.primary:hover{background:#064c3a;border-color:#064c3a}.phf-action-chip.danger{background:#fff0f0;border-color:#efcaca;color:#a33333}.phf-eval-chip.done,.phf-status-chip.done{background:#eef8f2;border-color:#cde8d7;color:#17603f}.phf-eval-chip.overdue,.phf-eval-chip.risk,.phf-status-chip.overdue,.phf-status-chip.risk{background:#fff0f0;border-color:#efcaca;color:#a33333}.phf-eval-chip.due,.phf-eval-chip.watch,.phf-status-chip.due,.phf-status-chip.watch{background:#fff7e7;border-color:#efd59b;color:#885800}.phf-eval-chip.upcoming,.phf-status-chip.upcoming{background:#edf6ff;border-color:#c9e0f3;color:#245b84}.phf-eval-chip.neutral,.phf-status-chip.neutral{background:#f3f5f4;border-color:#d9e0dc;color:#66756e}
  .phf-eval-row-actions{display:flex;gap:6px;flex-wrap:wrap}.phf-eval-row-btn{min-height:32px;border-radius:9px;border:1px solid #d4e6de;background:#fff;color:#07543e;padding:0 10px;font-size:12px;font-weight:600;cursor:pointer}.phf-eval-row-btn.primary{background:#07543e;color:#fff;border-color:#07543e}
  .phf-home-account-name{color:#b45f1b!important;-webkit-text-fill-color:#b45f1b!important;font-weight:800!important;text-decoration:none!important;white-space:normal!important}
.phf-eval-profile-filter-grid{grid-template-columns:minmax(320px,1.5fr) minmax(220px,.8fr) auto!important}
.phf-eval-profile-row-selected td{background:#f2faf6!important}
.phf-eval-row-btn.danger{border-color:#efc8bd!important;background:#fff4f0!important;color:#9a3412!important}
.phf-eval-success-notice{position:fixed;inset:0;z-index:100001;display:flex;align-items:flex-start;justify-content:center;padding:84px 18px 18px;pointer-events:none;opacity:0;transform:translateY(-8px);transition:opacity .16s ease,transform .16s ease}
.phf-eval-success-notice.show{opacity:1;transform:translateY(0)}
.phf-eval-success-card{min-width:min(430px,calc(100vw - 36px));max-width:560px;display:grid;grid-template-columns:42px 1fr 30px;align-items:center;gap:12px;padding:14px 15px;border:1px solid #cfe8da;border-radius:16px;background:rgba(255,255,255,.98);box-shadow:0 18px 50px rgba(7,84,62,.2);pointer-events:auto;font-family:Arial,"Helvetica Neue",Helvetica,system-ui,sans-serif}
.phf-eval-success-mark{width:38px;height:38px;border-radius:12px;background:#e8f7ef;color:#08734f;display:flex;align-items:center;justify-content:center;font-size:21px;font-weight:800}
.phf-eval-success-card b{display:block;color:#07543e;font-size:15px;margin-bottom:3px}
.phf-eval-success-card span{display:block;color:#557167;font-size:13px;line-height:1.45}
.phf-eval-success-card button{border:0;background:transparent;color:#6b7f77;font-size:22px;line-height:1;cursor:pointer;padding:3px;border-radius:8px}
.phf-eval-success-card button:hover{background:#f0f6f3;color:#17382d}
@media(max-width:520px){.phf-eval-success-notice{padding-top:70px}.phf-eval-success-card{grid-template-columns:38px 1fr 28px}}
.phf-eval-delete-backdrop{position:fixed;inset:0;z-index:100000;background:rgba(12,32,25,.42);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:18px}
.phf-eval-delete-card{width:min(520px,100%);display:grid;grid-template-columns:48px 1fr;gap:14px;background:#fff;border:1px solid #ead7d0;border-radius:18px;padding:20px;box-shadow:0 24px 70px rgba(0,40,28,.24);font-family:Arial,"Helvetica Neue",Helvetica,system-ui,sans-serif}
.phf-eval-delete-icon{width:44px;height:44px;border-radius:14px;background:#fff1ed;color:#9a3412;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px}
.phf-eval-delete-copy h3{margin:2px 0 7px;color:#17382d;font-size:19px}.phf-eval-delete-copy p{margin:0;color:#60756c;line-height:1.55;white-space:pre-line}
.phf-eval-delete-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:9px;padding-top:5px}
@media(max-width:560px){.phf-eval-delete-card{grid-template-columns:1fr}.phf-eval-delete-icon{display:none}.phf-eval-delete-actions{grid-column:1;flex-direction:column-reverse}.phf-eval-delete-actions button{width:100%}}
.phf-eval-processing-icon{width:44px;height:44px;border-radius:14px;background:#eaf6f1;color:#08734f;display:flex;align-items:center;justify-content:center}
.phf-eval-processing-spinner{width:22px;height:22px;border:3px solid #b9ddce;border-top-color:#08734f;border-radius:50%;animation:phfEvalSpin .8s linear infinite}
.phf-eval-processing-note{grid-column:1/-1;margin-top:2px;padding:10px 12px;border-radius:12px;background:#f5f8f7;color:#557167;font-size:13px;line-height:1.45}
@keyframes phfEvalSpin{to{transform:rotate(360deg)}}
.phf-eval-inline-profile{margin-top:18px;scroll-margin-top:110px}
.phf-eval-inline-profile-info{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:18px;border-top:1px solid #e3eee9}
.phf-eval-inline-profile-info>div{display:grid;gap:5px;padding:13px 14px;border:1px solid #e1ece7;border-radius:12px;background:#fbfdfc}
.phf-eval-inline-profile-info span{font-size:12px;color:#6d8178}
.phf-eval-inline-profile-info b{font-size:14px;color:#17382d;font-weight:650}
.phf-eval-inline-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:0 18px 18px}
.phf-eval-inline-summary>div{display:grid;gap:4px;padding:14px;border-radius:12px;background:#f4faf7;border:1px solid #dcebe4}
.phf-eval-inline-summary b{font-size:22px;color:#07543e}
.phf-eval-inline-summary span{font-size:13px;color:#60756c}
@media(max-width:900px){.phf-eval-profile-filter-grid{grid-template-columns:1fr!important}.phf-eval-inline-profile-info,.phf-eval-inline-summary{grid-template-columns:1fr 1fr}}
@media(max-width:620px){.phf-eval-inline-profile-info,.phf-eval-inline-summary{grid-template-columns:1fr}}.phf-eval-detail-context{display:grid;gap:12px;margin-bottom:16px}.phf-eval-detail-nav{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}.phf-eval-back-btn{min-height:38px;border-radius:10px;border:1px solid #cfe4dc;background:#fff;color:#07543e;padding:0 13px;font-weight:600;cursor:pointer}.phf-eval-detail-path{font-size:12.5px;color:#647970}.phf-eval-detail-headline{background:#f6fbf8;border:1px solid #dcece5;border-radius:16px;padding:16px 18px}.phf-eval-detail-headline h2{margin:0 0 5px;color:#17382d;font-size:22px;font-weight:650}.phf-eval-detail-headline p{margin:0;color:#60756c;line-height:1.5}.phf-eval-detail-tabs{display:flex;gap:8px;flex-wrap:wrap;background:#fff;border:1px solid #dfeee7;border-radius:14px;padding:7px}.phf-eval-detail-tab{border:0;border-radius:10px;background:#f5faf7;color:#315448;padding:9px 13px;font-weight:600;cursor:pointer}.phf-eval-detail-tab.active{background:#07543e;color:#fff}.phf-eval-empty{padding:34px 18px;text-align:center;color:#687b73}.phf-eval-saved-backdrop{position:fixed;inset:0;z-index:2147483646;background:rgba(14,36,28,.38);display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(3px)}.phf-eval-saved-modal{width:min(520px,100%);background:#fff;border-radius:20px;border:1px solid #dbeae3;box-shadow:0 26px 70px rgba(0,35,24,.24);overflow:hidden}.phf-eval-saved-main{padding:22px}.phf-eval-saved-icon{width:44px;height:44px;border-radius:14px;background:#edf8f2;color:#07543e;display:flex;align-items:center;justify-content:center;font-size:23px;font-weight:700;margin-bottom:13px}.phf-eval-saved-main h3{margin:0 0 7px;color:#17382d;font-size:21px}.phf-eval-saved-main p{margin:0;color:#60756c;line-height:1.55}.phf-eval-saved-info{margin-top:15px;display:grid;gap:7px;padding:13px;border-radius:14px;background:#f7fbf9;border:1px solid #e2eee8}.phf-eval-saved-info div{display:flex;justify-content:space-between;gap:16px;font-size:13px}.phf-eval-saved-info b{font-weight:600;color:#42594f}.phf-eval-saved-info span{text-align:right;color:#17382d}.phf-eval-saved-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding:14px 18px;background:#f8fbf9;border-top:1px solid #e5efea}
  @media(max-width:1050px){.phf-eval-filter-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.phf-eval-work-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.phf-eval-work-head{flex-direction:column}.phf-eval-work-role{text-align:left}}
  @media(max-width:620px){.phf-eval-filter-grid,.phf-eval-work-metrics{grid-template-columns:1fr}.phf-eval-filter-actions{width:100%}.phf-eval-btn{flex:1}.phf-eval-work-head{padding:19px}.phf-eval-saved-actions{flex-direction:column}.phf-eval-saved-actions button{width:100%}}
  `;
  document.head.appendChild(style);
}
function phfEvalAllRecords(){ return ((window.__phfLocalData && window.__phfLocalData.evaluationRecords) || []).slice(); }
function phfEvalLearnerById(id){ return phfAllEvaluationLearners().find(function(e){return String(e.id)===String(id);}) || {id:id,fullName:'Học viên chưa xác định',phone:'',employeeCode:'',branch:'',position:''}; }
function phfEvalLearnerCode(learner){
  if(learner && learner.employeeCode) return learner.employeeCode;
  try{
    const list=JSON.parse(localStorage.getItem('phfAdminAccountsSafeV18')||'[]');
    const phone=String(learner&&learner.phone||'').replace(/\D/g,'');
    const email=String(learner&&learner.email||'').trim().toLowerCase();
    const row=list.find(function(a){const ap=String(a.phone||'').replace(/\D/g,'');const ae=String(a.email||'').trim().toLowerCase();return (phone&&ap===phone)||(email&&ae===email);});
    return row && row.employeeCode || '';
  }catch(e){return '';}
}
function phfEvalRecordType(record){ const t=String(record.formType||record.form_type||'weekly'); return t==='final'?'Kết thúc thử việc':(t==='monthly'?'Phiếu tháng':'Phiếu tuần'); }
function phfEvalRecordPeriod(record){ return record.periodLabel||record.period_label||record.periodKey||record.period_key||'Chưa xác định kỳ'; }
function phfEvalRecordUpdated(record){ return record.updatedAt||record.updated_at||record.savedAt||record.saved_at||''; }
function phfEvalRecordStatus(record){ const c=String(record.conclusion||'').toLowerCase(); if(/chưa đạt|không phù hợp/.test(c))return {text:'Cần theo dõi',cls:'watch'}; return {text:'Đã hoàn thành',cls:'done'}; }
function phfEvalFindPeriodForRecord(learner,record){
  const key=record.periodKey||record.period_key||''; const type=record.formType||record.form_type||'weekly';
  return phfBuildEvaluationPeriods(learner).find(function(p){return p.key===key && (p.formType||'weekly')===type;}) || {key:key,formType:type,label:phfEvalRecordPeriod(record),start:phfParseDateInput(record.periodStart||record.period_start),end:phfParseDateInput(record.periodEnd||record.period_end)};
}
function phfEvalCaptureWorkspaceState(view){
  const hasFilters = !!document.getElementById('phfEvalFilterQ');
  const current = hasFilters ? {
    q:String((document.getElementById('phfEvalFilterQ')||{}).value||'').trim().toLowerCase(),
    status:String((document.getElementById('phfEvalFilterStatus')||{}).value||'all'),
    type:String((document.getElementById('phfEvalFilterType')||{}).value||'all'),
    from:String((document.getElementById('phfEvalFilterFrom')||{}).value||''),
    to:String((document.getElementById('phfEvalFilterTo')||{}).value||'')
  } : ((window.__phfEvalWorkspaceState && window.__phfEvalWorkspaceState.filters) || {q:'',status:'all',type:'all',from:'',to:''});
  window.__phfEvalWorkspaceState={view:view||'history',filters:current,scrollY:window.scrollY||0};
  return window.__phfEvalWorkspaceState;
}
function phfEvalOpenRecord(employeeId,periodKey,mode,origin){
  phfEvalCaptureWorkspaceState(origin||'history');
  if(employeeId) localStorage.setItem('phfEvalSelectedEmployeeId',employeeId);
  window.__phfEvalReadFresh=false;
  renderEvaluationRecords(periodKey,mode||'view',{silentNotice:true,forceProfile:true,returnView:origin||'history'});
}
async function phfEvalReturnToWorkspace(view){
  const state=window.__phfEvalWorkspaceState||{};
  await phfRenderEvaluationWorkspace(view||state.view||'history');
  setTimeout(function(){ window.scrollTo({top:Number(state.scrollY||0),behavior:'auto'}); },0);
}
function phfEvalWorkspaceFilters(){
  const q=document.getElementById('phfEvalFilterQ');
  if(!q) return (window.__phfEvalWorkspaceState && window.__phfEvalWorkspaceState.filters) || {q:'',status:'all',type:'all',from:'',to:''};
  return {q:String(q.value||'').trim().toLowerCase(),status:String((document.getElementById('phfEvalFilterStatus')||{}).value||'all'),type:String((document.getElementById('phfEvalFilterType')||{}).value||'all'),from:String((document.getElementById('phfEvalFilterFrom')||{}).value||''),to:String((document.getElementById('phfEvalFilterTo')||{}).value||'')};
}
function phfEvalWorkspaceReset(view){ window.__phfEvalWorkspaceState={view:view||'history',filters:{q:'',status:'all',type:'all',from:'',to:''},scrollY:0}; ['phfEvalFilterQ','phfEvalFilterFrom','phfEvalFilterTo'].forEach(function(id){const e=document.getElementById(id);if(e)e.value='';}); ['phfEvalFilterStatus','phfEvalFilterType'].forEach(function(id){const e=document.getElementById(id);if(e)e.value='all';}); phfRenderEvaluationWorkspace(view||'history'); }
function phfEvalFilterShell(view,f){
  f=f||{q:'',status:'all',type:'all',from:'',to:''};
  const statusOptions=view==='history'
    ? `<option value="all">Tất cả</option><option value="done" ${f.status==='done'?'selected':''}>Đã hoàn thành</option><option value="watch" ${f.status==='watch'?'selected':''}>Cần theo dõi</option>`
    : `<option value="all">Tất cả</option><option value="overdue" ${f.status==='overdue'?'selected':''}>Quá hạn</option><option value="due" ${f.status==='due'?'selected':''}>Đang đánh giá</option><option value="upcoming" ${f.status==='upcoming'?'selected':''}>Sắp đến hạn</option>`;
  return `<section class="phf-eval-filter-card"><div class="phf-eval-filter-grid"><div class="phf-eval-filter-field"><label>Tìm học viên</label><input id="phfEvalFilterQ" type="search" value="${esc(f.q||'')}" placeholder="Tên, SĐT hoặc mã NV"></div><div class="phf-eval-filter-field"><label>Trạng thái</label><select id="phfEvalFilterStatus">${statusOptions}</select></div><div class="phf-eval-filter-field"><label>Loại phiếu</label><select id="phfEvalFilterType"><option value="all">Tất cả</option><option value="weekly" ${f.type==='weekly'?'selected':''}>Phiếu tuần</option><option value="monthly" ${f.type==='monthly'?'selected':''}>Phiếu tháng</option><option value="final" ${f.type==='final'?'selected':''}>Kết thúc thử việc</option></select></div><div class="phf-eval-filter-field"><label>${view==='history'?'Cập nhật từ ngày':'Kỳ từ ngày'}</label><input id="phfEvalFilterFrom" type="date" value="${esc(f.from||'')}"></div><div class="phf-eval-filter-field"><label>${view==='history'?'Cập nhật đến ngày':'Kỳ đến ngày'}</label><input id="phfEvalFilterTo" type="date" value="${esc(f.to||'')}"></div><div class="phf-eval-filter-actions"><button class="phf-eval-btn primary" type="button" onclick="phfRenderEvaluationWorkspace('${view}')">Lọc</button><button class="phf-eval-btn" type="button" onclick="phfEvalWorkspaceReset('${view}')">Xóa lọc</button></div></div></section>`;
}


function phfEvalIsAdmin(){
  try{return phfUserRole()==='admin'}catch(e){return false}
}

function phfEvalDeleteDialog(message, title, confirmText){
  return new Promise(function(resolve){
    const old=document.getElementById('phfEvalDeleteModal');
    if(old)old.remove();
    const root=document.createElement('div');
    root.id='phfEvalDeleteModal';
    root.className='phf-eval-delete-backdrop';
    root.innerHTML=`<div class="phf-eval-delete-card" role="dialog" aria-modal="true">
      <div class="phf-eval-delete-icon">!</div>
      <div class="phf-eval-delete-copy"><h3>${esc(title||'Xác nhận xóa học viên')}</h3><p>${esc(message||'')}</p></div>
      <div class="phf-eval-delete-actions">
        <button type="button" class="phf-action-chip" data-cancel>Quay lại</button>
        <button type="button" class="phf-eval-row-btn danger" data-confirm>${esc(confirmText||'Xóa học viên')}</button>
      </div>
    </div>`;
    function done(value){root.remove();resolve(!!value)}
    root.querySelector('[data-cancel]').onclick=function(){done(false)};
    root.querySelector('[data-confirm]').onclick=function(){done(true)};
    document.body.appendChild(root);
    root.querySelector('[data-cancel]').focus();
  });
}


function phfEvalShowProcessing(title,message){
  const old=document.getElementById('phfEvalProcessingModal');
  if(old)old.remove();
  const root=document.createElement('div');
  root.id='phfEvalProcessingModal';
  root.className='phf-eval-delete-backdrop';
  root.setAttribute('role','alertdialog');
  root.setAttribute('aria-modal','true');
  root.setAttribute('aria-busy','true');
  root.innerHTML=`<div class="phf-eval-delete-card">
    <div class="phf-eval-processing-icon"><span class="phf-eval-processing-spinner" aria-hidden="true"></span></div>
    <div class="phf-eval-delete-copy"><h3>${esc(title||'Hệ thống đang xử lý')}</h3><p>${esc(message||'Vui lòng không đóng trang hoặc thực hiện lại thao tác.')}</p></div>
    <div class="phf-eval-processing-note">Dữ liệu chỉ được xem là hoàn tất khi máy chủ trả kết quả xác nhận.</div>
  </div>`;
  document.body.appendChild(root);
  return function closeProcessing(){
    const current=document.getElementById('phfEvalProcessingModal');
    if(current)current.remove();
  };
}

function phfEvalShowSuccessNotice(message){
  const old=document.getElementById('phfEvalSuccessNotice');
  if(old)old.remove();

  const root=document.createElement('div');
  root.id='phfEvalSuccessNotice';
  root.className='phf-eval-success-notice';
  root.setAttribute('role','status');
  root.setAttribute('aria-live','polite');
  root.innerHTML=`<div class="phf-eval-success-card">
    <div class="phf-eval-success-mark">✓</div>
    <div><b>Thao tác thành công</b><span>${esc(message||'Đã hoàn tất thao tác.')}</span></div>
    <button type="button" aria-label="Đóng thông báo">×</button>
  </div>`;

  function close(){ if(root&&root.parentNode) root.remove(); }
  root.querySelector('button').onclick=close;
  document.body.appendChild(root);
  requestAnimationFrame(function(){ root.classList.add('show'); });
  setTimeout(close,3200);
}

async function phfEvalDeleteLearner(employeeId){
  if(window.__phfEvalDeleteLearnerBusy)return;
  if(!phfEvalIsAdmin()){
    if(typeof phfToast==='function') phfToast('error','Không đủ quyền','Chỉ Admin được xóa học viên.',4200,'learner-delete');
    return;
  }

  const learner=phfEvalLearnerById(employeeId);
  if(!learner){
    if(typeof phfToast==='function') phfToast('error','Không tìm thấy học viên','Không tìm thấy hồ sơ cần xóa. Vui lòng tải lại dữ liệu rồi thử lại.',4200,'learner-delete');
    return;
  }

  const current=phfCurrentEmployeeProfile();
  const currentPhone=String(current&&current.phone||'').replace(/\D/g,'');
  const learnerPhone=String(learner.phone||'').replace(/\D/g,'');
  if((current&&current.id&&String(current.id)===String(learner.id)) ||
     (currentPhone&&learnerPhone&&currentPhone===learnerPhone)){
    if(typeof phfToast==='function') phfToast('error','Không thể xóa học viên','Không thể xóa hồ sơ của tài khoản đang đăng nhập.',4600,'learner-delete');
    return;
  }

  const first=await phfEvalDeleteDialog(
    'Thao tác sẽ xóa hồ sơ học viên, tiến độ, kết quả kiểm tra, phiếu đánh giá và nhật ký liên quan khỏi dữ liệu chính. Tài khoản đăng nhập được quản lý riêng trong mục Quản trị tài khoản.',
    'Xóa học viên '+String(learner.fullName||''),
    'Tiếp tục'
  );
  if(!first)return;

  const second=await phfEvalDeleteDialog(
    'Đây là bước xác nhận cuối. Chỉ tiếp tục khi anh đã kiểm tra đúng học viên và đã có bản sao lưu Supabase.',
    'Xác nhận lần cuối',
    'Xóa vĩnh viễn'
  );
  if(!second)return;

  const workspace=document.querySelector('.phf-eval-workspace');
  window.__phfEvalDeleteLearnerBusy=true;
  if(workspace){
    workspace.classList.add('phf-eval-is-busy');
    workspace.setAttribute('aria-busy','true');
  }
  const closeProcessing=phfEvalShowProcessing(
    'Đang xóa học viên '+String(learner.fullName||''),
    'Hệ thống đang xóa hồ sơ, tiến độ học, kết quả kiểm tra, phiếu đánh giá và dữ liệu đào tạo liên quan. Vui lòng không đóng trang hoặc thực hiện lại thao tác.'
  );

  try{
    const response=await fetch('/api/data',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        action:'deleteEmployee',
        adminMode:true,
        employee:{
          id:String(learner.id||''),
          fullName:String(learner.fullName||''),
          phone:String(learner.phone||'')
        }
      })
    });
    const result=await response.json().catch(function(){return{}});
    if(!response.ok||!result.ok){
      throw new Error(result.error||'Chưa thể xóa học viên.');
    }

    window.__phfEvalProfileSelectedId='';
    window.__phfEvalReadFresh=false;
    window.__phfTrainingDataLoadedAt=0;
    window.__phfTrainingDataScopeKey='';
    window.__phfLocalData=result.data||null;
    await phfRenderEvaluationWorkspace('profiles');
    phfEvalShowSuccessNotice('Đã xóa học viên và dữ liệu đào tạo liên quan. Tài khoản đăng nhập, nếu có, vẫn được quản lý riêng.');
  }catch(err){
    if(typeof phfToast==='function') phfToast('error','Chưa thể xóa học viên',(err&&err.message)||'Máy chủ chưa xác nhận hoàn tất thao tác. Dữ liệu hiện tại chưa được coi là đã xóa.',5600,'learner-delete');
  }finally{
    closeProcessing();
    window.__phfEvalDeleteLearnerBusy=false;
    if(workspace){
      workspace.classList.remove('phf-eval-is-busy');
      workspace.removeAttribute('aria-busy');
    }
  }
}
window.phfEvalDeleteLearner=phfEvalDeleteLearner;

function phfEvalSelectProfileInline(employeeId){
  const id=String(employeeId||'').trim();
  window.__phfEvalProfileSelectedId=id;
  if(id) localStorage.setItem('phfEvalSelectedEmployeeId',id);
  phfRenderEvaluationWorkspace('profiles');
}
function phfEvalCloseProfileInline(){
  window.__phfEvalProfileSelectedId='';
  phfRenderEvaluationWorkspace('profiles');
}
function phfEvalResetProfileFilters(){
  window.__phfEvalWorkspaceState={view:'profiles',filters:{q:'',status:'all',type:'all',from:'',to:''},scrollY:0};
  window.__phfEvalProfileSelectedId='';
  phfRenderEvaluationWorkspace('profiles');
}


async function phfEnsureEvaluationDataReady(canEditWorkspace){
  function hasExpectedRows(){
    const sourceData = window.__phfLocalData || window.localData || {};
  const rows = Array.isArray(sourceData.employees) ? sourceData.employees : [];
    const current = phfCurrentEmployeeProfile();
    const ownPhone = String(current && current.phone || '').replace(/\D/g,'');
    return canEditWorkspace
      ? rows.length > 0
      : rows.some(function(row){
          const idMatch = current && current.id && String(row.id||'') === String(current.id);
          const phoneMatch = ownPhone && String(row.phone||'').replace(/\D/g,'') === ownPhone;
          return idMatch || phoneMatch;
        });
  }

  if(window.__phfEvalReadFresh && hasExpectedRows()) return true;

  let ok = false;
  try{
    ok = await phfRefreshTrainingData();
  }catch(e){
    ok = false;
  }

  if(!ok || !hasExpectedRows()){
    await new Promise(function(resolve){ setTimeout(resolve, 220); });
    try{
      ok = await phfRefreshTrainingData({force:true});
    }catch(e){
      ok = false;
    }
  }

  const ready = !!ok && hasExpectedRows();
  window.__phfEvalReadFresh = ready;
  return ready;
}

window.phfEnsureEvaluationDataReady = phfEnsureEvaluationDataReady;

async function phfRenderEvaluationWorkspace(view){
  const canEditWorkspace = phfCanEditEvaluation();
  const renderToken = (window.__phfEvalRenderToken = (window.__phfEvalRenderToken || 0) + 1);
  view = canEditWorkspace ? ((view==='history'||view==='profiles')?view:'todo') : 'profiles';
  phfEnsureEvaluationOfficialUi();
  phfSetMainNavActive('profile');
  document.body.classList.add('phf-eval-mode','phf-module-page-mode');
  document.body.classList.remove('phf-guide-standalone-mode','phf-guide-intro-active');

  const loadingHost = document.getElementById('mainLesson');
  const currentProfile = phfCurrentEmployeeProfile();
  const renderScope = canEditWorkspace
    ? 'staff'
    : 'learner|' + String((currentProfile&&currentProfile.id)||'') + '|' + String((currentProfile&&currentProfile.phone)||'');
  const existingWorkspace = loadingHost && loadingHost.querySelector('.phf-eval-workspace');
  const canKeepCurrentUi = !!existingWorkspace && window.__phfEvalRenderedScope === renderScope;
  const previousScrollY = window.scrollY || 0;

  if(canKeepCurrentUi){
    existingWorkspace.classList.add('phf-eval-is-busy');
    existingWorkspace.setAttribute('aria-busy','true');
  }else if(loadingHost){
    loadingHost.innerHTML = `<section class="phf-eval-workspace phf-eval-is-busy" aria-busy="true"><div class="phf-eval-work-head phf-lib-hero"><div><span class="phf-lib-kicker">PHF TRAINING HUB</span><h2>${canEditWorkspace?'Học viên':'Hồ sơ của tôi'}</h2><p>Đang tải dữ liệu phù hợp với tài khoản hiện tại...</p></div></div><section class="phf-eval-list-card" style="min-height:360px"><div class="phf-eval-empty">Đang tải dữ liệu, vui lòng chờ.</div></section></section>`;
  }

  const loadOk = await phfEnsureEvaluationDataReady(canEditWorkspace);
  if(renderToken !== window.__phfEvalRenderToken) return;
  if(!loadOk){
    const busyWorkspace=loadingHost&&loadingHost.querySelector('.phf-eval-workspace');
    if(canKeepCurrentUi&&busyWorkspace){
      busyWorkspace.classList.remove('phf-eval-is-busy');
      busyWorkspace.removeAttribute('aria-busy');
      if(typeof phfToast==='function') phfToast('error','Không thể cập nhật dữ liệu','Nội dung hiện tại được giữ nguyên. Vui lòng kiểm tra kết nối rồi thử lại.',4800,'evaluation-update');
    }else if(loadingHost){
      loadingHost.innerHTML = `<section class="phf-eval-workspace"><div class="phf-eval-work-head phf-lib-hero"><div><span class="phf-lib-kicker">PHF TRAINING HUB</span><h2>${canEditWorkspace?'Học viên':'Hồ sơ của tôi'}</h2><p>Chưa tải được dữ liệu phù hợp với tài khoản hiện tại.</p></div></div><section class="phf-eval-list-card" style="min-height:360px"><div class="phf-eval-empty">Vui lòng kiểm tra kết nối rồi tải lại trang.</div></section></section>`;
    }
    return false;
  }

  document.getElementById('miniStatus').textContent='Học viên';
  document.getElementById('contextTitle').textContent='Bạn đang ở: Học viên';
  document.getElementById('contextSub').textContent='Tìm học viên, xem hồ sơ, tiến độ học, bài kiểm tra và phiếu đánh giá.';
  document.getElementById('contextAction').textContent=phfRoleLabel();

  const learners=phfAllEvaluationLearners();
  const records=phfEvalAllRecords();
  if(!canEditWorkspace){
    const own = learners[0] || phfCurrentEmployeeProfile();
    window.__phfEvalProfileSelectedId = own && own.id ? String(own.id) : '';
  }
  const f=phfEvalWorkspaceFilters();
  window.__phfEvalWorkspaceState={
    view:view,
    filters:f,
    scrollY:(window.__phfEvalWorkspaceState&&window.__phfEvalWorkspaceState.scrollY)||0
  };

  let items=[];
  if(view==='history'){
    items=records.map(function(r){
      const l=phfEvalLearnerById(r.employeeId||r.employee_id);
      const st=phfEvalRecordStatus(r);
      return {learner:l,record:r,status:st,type:String(r.formType||r.form_type||'weekly'),date:phfEvalRecordUpdated(r)};
    }).sort(function(a,b){return String(b.date||'').localeCompare(String(a.date||''));});
  }else if(view==='profiles'){
    items=learners.map(function(l){
      const learnerRecords=phfEvaluationRecordsFor(l.id);
      const hasStart=!!String(l.studyStartDate||'').trim();
      return {
        learner:l,
        records:learnerRecords,
        status:!hasStart?{text:'Thiếu ngày bắt đầu',cls:'watch'}:(learnerRecords.length?{text:'Đã có hồ sơ',cls:'done'}:{text:'Chưa có phiếu',cls:'upcoming'}),
        type:'profile',
        date:l.studyStartDate||''
      };
    }).sort(function(a,b){return String(a.learner.fullName||'').localeCompare(String(b.learner.fullName||''),'vi');});
  }else{
    const today=phfTodayOnly().getTime(), upcoming=7*86400000;
    learners.forEach(function(l){
      phfBuildEvaluationPeriods(l).forEach(function(p){
        if(phfPeriodRecord(l.id,p))return;
        const sm=p.start.getTime(),em=p.end.getTime();
        let st=null;
        if(today>em)st={text:'Quá hạn',cls:'overdue',rank:1};
        else if(today>=sm&&today<=em)st={text:'Đang đánh giá',cls:'due',rank:2};
        else if(sm>today&&sm-today<=upcoming)st={text:'Sắp đến hạn',cls:'upcoming',rank:3};
        if(st)items.push({learner:l,period:p,status:st,type:p.formType||'weekly',date:phfIsoDate(p.start)});
      });
    });
    items.sort(function(a,b){
      return (a.status.rank-b.status.rank)||String(a.date).localeCompare(String(b.date))||
        String(a.learner.fullName).localeCompare(String(b.learner.fullName),'vi');
    });
  }

  function match(item){
    const l=item.learner||{}, st=item.status||{}, type=item.type||'';
    const code=phfEvalLearnerCode(l);
    const hay=[l.fullName,l.phone,code,l.branch,l.position].join(' ').toLowerCase();
    if(f.q&&hay.indexOf(f.q)<0)return false;
    if(f.status!=='all'&&st.cls!==f.status)return false;
    if(view!=='profiles'&&f.type!=='all'&&type!==f.type)return false;
    const d=String(item.date||'').slice(0,10);
    if(view!=='profiles'&&f.from&&d&&d<f.from)return false;
    if(view!=='profiles'&&f.to&&d&&d>f.to)return false;
    return true;
  }

  const filtered=items.filter(match);
  const countBy=function(cls){return items.filter(function(x){return x.status&&x.status.cls===cls;}).length;};

  let rows='', metrics='', head=[], filterHtml='', title='', description='';

  if(view==='profiles'){
    rows=filtered.map(function(item,idx){
      const l=item.learner||{};
      const recCount=(item.records||[]).length;
      const selected=String(window.__phfEvalProfileSelectedId||'')===String(l.id||'');
      return `<tr class="${selected?'phf-eval-profile-row-selected':''}">
        <td>${idx+1}</td>
        <td><b>${esc(l.fullName)}</b><small>${esc(l.position||'Chưa cập nhật vị trí')}</small></td>
        <td><b>${esc(l.phone||'—')}</b><small>${esc(phfEvalLearnerCode(l)||'Chưa có mã NV')}</small></td>
        <td>${esc(l.branch||'Chưa phân chi nhánh')}</td>
        <td>${esc(l.studyStartDate||'Chưa nhập')}</td>
        <td><b>${recCount}</b><small>phiếu đã lưu</small></td>
        <td><span class="phf-eval-chip ${item.status.cls}">${esc(item.status.text)}</span></td>
        <td><div class="phf-eval-row-actions"><button class="phf-eval-row-btn ${selected?'':'primary'}" type="button" onclick="phfEvalSelectProfileInline('${esc(l.id)}')">${selected?'Đang xem':'Xem hồ sơ'}</button>${phfEvalIsAdmin()?`<button class="phf-eval-row-btn danger" type="button" onclick="phfEvalDeleteLearner('${esc(l.id)}')">Xóa học viên</button>`:''}</div></td>
      </tr>`;
    }).join('');

    const learnersWithRecords=items.filter(function(x){return (x.records||[]).length>0;}).length;
    const noStart=items.filter(function(x){return !String((x.learner||{}).studyStartDate||'').trim();}).length;
    metrics=`<div class="phf-eval-work-metric"><b>${learners.length}</b><span>Tổng học viên</span></div>
      <div class="phf-eval-work-metric"><b>${learnersWithRecords}</b><span>Đã có hồ sơ đánh giá</span></div>
      <div class="phf-eval-work-metric"><b>${records.length}</b><span>Tổng phiếu đã lưu</span></div>
      <div class="phf-eval-work-metric"><b>${noStart}</b><span>Thiếu ngày bắt đầu</span></div>`;
    head=['STT','Học viên','SĐT / Mã NV','Chi nhánh','Ngày bắt đầu','Phiếu đánh giá','Trạng thái','Thao tác'];
    filterHtml=canEditWorkspace?`<section class="phf-eval-filter-card"><div class="phf-eval-filter-grid phf-eval-profile-filter-grid">
      <div class="phf-eval-filter-field"><label>Tìm học viên</label><input id="phfEvalFilterQ" type="search" value="${esc(f.q||'')}" placeholder="Tên, SĐT hoặc mã NV"></div>
      <div class="phf-eval-filter-field"><label>Trạng thái hồ sơ</label><select id="phfEvalFilterStatus">
        <option value="all">Tất cả</option>
        <option value="done" ${f.status==='done'?'selected':''}>Đã có hồ sơ</option>
        <option value="upcoming" ${f.status==='upcoming'?'selected':''}>Chưa có phiếu</option>
        <option value="watch" ${f.status==='watch'?'selected':''}>Thiếu ngày bắt đầu</option>
      </select></div>
      <div class="phf-eval-filter-actions"><button class="phf-eval-btn primary" type="button" onclick="phfRenderEvaluationWorkspace('profiles')">Lọc</button><button class="phf-eval-btn" type="button" onclick="phfEvalResetProfileFilters()">Xóa lọc</button></div>
    </div></section>`:'';
    title=canEditWorkspace?'Hồ sơ học viên':'Hồ sơ của tôi';
    description=canEditWorkspace?'Chọn học viên trong danh sách để xem thông tin và hồ sơ đánh giá ngay bên dưới.':'Thông tin và hồ sơ đánh giá của tài khoản hiện tại.';
  }else{
    rows=filtered.map(function(item,idx){
      const l=item.learner||{};
      if(view==='history'){
        const r=item.record||{}, key=r.periodKey||r.period_key||'', st=item.status;
        return `<tr><td>${idx+1}</td><td><b>${esc(l.fullName)}</b><small>${esc(l.branch||'Chưa phân chi nhánh')} · ${esc(l.position||'')}</small></td><td><b>${esc(l.phone||'—')}</b><small>${esc(phfEvalLearnerCode(l)||'Chưa có mã NV')}</small></td><td><b>${esc(phfEvalRecordType(r))}</b><small>${esc(phfEvalRecordPeriod(r))}</small></td><td><span class="phf-eval-chip ${st.cls}">${esc(st.text)}</span></td><td>${esc(r.evaluator||'Chưa ghi nhận')}</td><td>${esc(phfEvalUpdatedText(r))}</td><td><div class="phf-eval-row-actions"><button class="phf-action-chip primary" type="button" onclick="phfEvalOpenRecord('${esc(l.id)}','${esc(key)}','view','history')">Xem phiếu</button><button class="phf-action-chip" type="button" onclick="phfEvalOpenRecord('${esc(l.id)}','${esc(key)}','edit','history')">Sửa</button></div></td></tr>`;
      }
      const p=item.period,st=item.status;
      return `<tr><td>${idx+1}</td><td><b>${esc(l.fullName)}</b><small>${esc(l.branch||'Chưa phân chi nhánh')} · ${esc(l.position||'')}</small></td><td><b>${esc(l.phone||'—')}</b><small>${esc(phfEvalLearnerCode(l)||'Chưa có mã NV')}</small></td><td><b>${esc(phfEvalDisplayTitle(p))}</b><small>${phfFormatRangeFull(p.start,p.end)}</small></td><td><span class="phf-eval-chip ${st.cls}">${esc(st.text)}</span></td><td><div class="phf-eval-row-actions"><button class="phf-action-chip primary" type="button" onclick="phfEvalOpenRecord('${esc(l.id)}','${esc(p.key)}','edit','todo')">Thực hiện đánh giá</button><button class="phf-action-chip" type="button" onclick="phfEvalOpenRecord('${esc(l.id)}','${esc(p.key)}','view','todo')">Xem hồ sơ</button></div></td></tr>`;
    }).join('');

    metrics=view==='history'
      ? `<div class="phf-eval-work-metric"><b>${records.length}</b><span>Tổng phiếu đã lưu</span></div><div class="phf-eval-work-metric"><b>${countBy('done')}</b><span>Đã hoàn thành</span></div><div class="phf-eval-work-metric"><b>${countBy('watch')}</b><span>Cần theo dõi</span></div><div class="phf-eval-work-metric"><b>${new Set(records.map(function(r){return r.employeeId||r.employee_id;})).size}</b><span>Học viên có hồ sơ</span></div>`
      : `<div class="phf-eval-work-metric"><b>${countBy('overdue')+countBy('due')}</b><span>Việc cần xử lý ngay</span></div><div class="phf-eval-work-metric"><b>${countBy('overdue')}</b><span>Quá hạn</span></div><div class="phf-eval-work-metric"><b>${countBy('due')}</b><span>Đang đánh giá</span></div><div class="phf-eval-work-metric"><b>${countBy('upcoming')}</b><span>Sắp đến hạn</span></div>`;
    head=view==='history'
      ? ['STT','Học viên','SĐT / Mã NV','Loại phiếu / Kỳ đánh giá','Trạng thái','Người đánh giá','Cập nhật lần cuối','Thao tác']
      : ['STT','Học viên','SĐT / Mã NV','Loại phiếu / Kỳ đánh giá','Trạng thái','Thao tác'];
    filterHtml=phfEvalFilterShell(view,f);
    title=view==='history'?'Lịch sử đánh giá':'Việc cần xử lý';
    description=view==='history'
      ? 'Tìm theo học viên, loại phiếu, trạng thái và thời gian cập nhật.'
      : 'Ưu tiên các trường hợp quá hạn, đang trong kỳ đánh giá và sắp đến hạn.';
  }

  let inlineProfile='';
  if(view==='profiles'&&window.__phfEvalProfileSelectedId){
    const selectedLearner=phfEvalLearnerById(window.__phfEvalProfileSelectedId);
    if(selectedLearner){
      const selectedRecords=phfEvaluationRecordsFor(selectedLearner.id).slice().sort(function(a,b){
        return String(phfEvalRecordUpdated(b)||'').localeCompare(String(phfEvalRecordUpdated(a)||''));
      });
      const selectedPeriods=phfBuildEvaluationPeriods(selectedLearner);
      const savedKeys=new Set(selectedRecords.map(function(r){return String(r.periodKey||r.period_key||'');}));
      const missingCount=Math.max(0,selectedPeriods.filter(function(p){return !savedKeys.has(String(p.key||''));}).length);
      const recordRows=selectedRecords.map(function(r,idx){
        const st=phfEvalRecordStatus(r);
        const recordKey=String(r.periodKey||r.period_key||'');
        return `<tr>
          <td>${idx+1}</td>
          <td><b>${esc(phfEvalRecordType(r))}</b><small>${esc(phfEvalRecordPeriod(r))}</small></td>
          <td><span class="phf-eval-chip ${st.cls}">${esc(st.text)}</span></td>
          <td>${esc(r.evaluator||'Chưa ghi nhận')}</td>
          <td>${esc(phfEvalUpdatedText(r))}</td>
          <td><button class="phf-action-chip primary" type="button" onclick="phfEvalOpenRecord('${esc(selectedLearner.id)}','${esc(recordKey)}','view','profiles')">Xem phiếu</button></td>
        </tr>`;
      }).join('');
      inlineProfile=`<section class="phf-eval-list-card phf-eval-inline-profile">
        <div class="phf-eval-list-head"><div><h3>${canEditWorkspace?'Hồ sơ đang xem: ':'Hồ sơ của '}${esc(selectedLearner.fullName)}</h3><p>${canEditWorkspace?'Thông tin học viên và các phiếu đánh giá được hiển thị ngay trong tab này.':'Thông tin cá nhân và các phiếu đánh giá đã được lưu.'}</p></div>${canEditWorkspace?'<button class="phf-action-chip" type="button" onclick="phfEvalCloseProfileInline()">Đóng hồ sơ</button>':''}</div>
        <div class="phf-eval-inline-profile-info">
          <div><span>Họ tên</span><b>${esc(selectedLearner.fullName)}</b></div>
          <div><span>SĐT</span><b>${esc(selectedLearner.phone||'Chưa có')}</b></div>
          <div><span>Mã nhân viên</span><b>${esc(phfEvalLearnerCode(selectedLearner)||'Chưa có')}</b></div>
          <div><span>Vị trí</span><b>${esc(selectedLearner.position||'Chưa cập nhật')}</b></div>
          <div><span>Chi nhánh</span><b>${esc(selectedLearner.branch||'Chưa phân chi nhánh')}</b></div>
          <div><span>Ngày bắt đầu</span><b>${esc(selectedLearner.studyStartDate||'Chưa nhập')}</b></div>
        </div>
        <div class="phf-eval-inline-summary">
          <div><b>${selectedRecords.length}</b><span>Phiếu đã lưu</span></div>
          <div><b>${missingCount}</b><span>Kỳ chưa có phiếu</span></div>
          <div><b>${selectedPeriods.length}</b><span>Tổng kỳ đánh giá</span></div>
        </div>
        <div class="phf-eval-table-wrap"><table class="phf-eval-official-table"><thead><tr><th>STT</th><th>Loại phiếu / Kỳ đánh giá</th><th>Trạng thái</th><th>Người đánh giá</th><th>Cập nhật lần cuối</th><th>Thao tác</th></tr></thead><tbody>${recordRows||'<tr><td colspan="6"><div class="phf-eval-empty">Chưa có phiếu đánh giá nào được lưu.</div></td></tr>'}</tbody></table></div>
      </section>`;
    }
  }

  document.getElementById('mainLesson').innerHTML=`<section class="phf-eval-workspace phf-eval-content-enter">
    <div class="phf-eval-work-head phf-lib-hero"><div><span class="phf-lib-kicker">PHF TRAINING HUB</span><h2>${canEditWorkspace?'Học viên':'Hồ sơ của tôi'}</h2><p>${canEditWorkspace?'Tìm kiếm học viên, theo dõi tiến độ, kết quả kiểm tra và hồ sơ đánh giá.':'Xem thông tin cá nhân và các phiếu đánh giá đã được lưu.'}</p></div><div class="phf-eval-work-role phf-lib-role">${canEditWorkspace?esc(phfRoleLabel()):'Hồ sơ cá nhân'}<small>${canEditWorkspace?(learners.length+' học viên trong dữ liệu'):'Hồ sơ đào tạo của bạn'}</small></div></div>
    <div class="phf-eval-work-tabs">
      ${canEditWorkspace
        ? `<button class="phf-eval-work-tab ${view==='todo'?'active':''}" type="button" onclick="phfTrainingRecordsLeave();phfRenderEvaluationWorkspace('todo')">Việc cần xử lý</button>
           <button class="phf-eval-work-tab ${view==='history'?'active':''}" type="button" onclick="phfTrainingRecordsLeave();phfRenderEvaluationWorkspace('history')">Lịch sử đánh giá</button>
           <button class="phf-eval-work-tab ${view==='profiles'?'active':''}" type="button" onclick="phfTrainingRecordsLeave();phfRenderEvaluationWorkspace('profiles')">Hồ sơ học viên</button>
           <button class="phf-eval-work-tab" type="button" onclick="phfTrainingRecordsOpen('employees')">Hồ sơ đào tạo &amp; đánh giá</button>
           <button class="phf-eval-work-tab" type="button" onclick="phfTrainingRecordsOpen('bmtt')">Cam kết BMTT</button>`
        : `<button class="phf-eval-work-tab active" type="button">Hồ sơ của tôi</button>`}
    </div>
    <div class="phf-eval-work-metrics">${metrics}</div>
    ${filterHtml}
    ${canEditWorkspace?`<section class="phf-eval-list-card"><div class="phf-eval-list-head"><div><h3>${title}</h3><p>${description}</p></div><span class="phf-eval-result-count">${filtered.length} kết quả</span></div><div class="phf-eval-table-wrap"><table class="phf-eval-official-table"><thead><tr>${head.map(function(x){return '<th>'+esc(x)+'</th>';}).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${head.length}"><div class="phf-eval-empty">Không có dữ liệu phù hợp bộ lọc.</div></td></tr>`}</tbody></table></div></section>`:''}
    ${inlineProfile}
  </section>`;
  window.__phfEvalRenderedScope = renderScope;

  ['phfEvalFilterQ','phfEvalFilterStatus','phfEvalFilterType','phfEvalFilterFrom','phfEvalFilterTo'].forEach(function(id){
    const el=document.getElementById(id);
    if(el)el.addEventListener(id==='phfEvalFilterQ'?'keydown':'change',function(e){
      if(id!=='phfEvalFilterQ'||e.key==='Enter')phfRenderEvaluationWorkspace(view);
    });
  });

  if(view==='profiles'&&window.__phfEvalProfileSelectedId&&canEditWorkspace){
    requestAnimationFrame(function(){
      const panel=document.querySelector('.phf-eval-inline-profile');
      if(!panel) return;
      const rect=panel.getBoundingClientRect();
      const viewportHeight=window.innerHeight||document.documentElement.clientHeight||800;
      if(rect.top>=110 && rect.top<=viewportHeight-120) return;
      const contextSpace=Math.min(Math.max(viewportHeight*0.48,260),420);
      const target=Math.max(0,window.scrollY+rect.top-contextSpace);
      window.scrollTo({top:target,behavior:'auto'});
    });
  }else if(canKeepCurrentUi){
    requestAnimationFrame(function(){
      window.scrollTo({top:previousScrollY,behavior:'auto'});
    });
  }else{
    phfScrollToPageTop();
  }
  return true;
}

function phfShowEvaluationSavedDialog(record,profile,period){
  phfEnsureEvaluationOfficialUi(); const old=document.getElementById('phfEvalSavedBackdrop'); if(old)old.remove();
  const wrap=document.createElement('div'); wrap.id='phfEvalSavedBackdrop'; wrap.className='phf-eval-saved-backdrop';
  const updated=phfFormatDateTimeVN(record.updatedAt||new Date().toISOString());
  wrap.innerHTML=`<div class="phf-eval-saved-modal" role="dialog" aria-modal="true"><div class="phf-eval-saved-main"><div class="phf-eval-saved-icon">✓</div><h3>Đã lưu phiếu đánh giá</h3><p>Phiếu đã được ghi nhận thành công và có thể mở lại ngay.</p><div class="phf-eval-saved-info"><div><b>Học viên</b><span>${esc(profile.fullName)}</span></div><div><b>Loại phiếu</b><span>${esc(phfEvalDisplayTitle(period))}</span></div><div><b>Kỳ đánh giá</b><span>${esc(period.label||period.key)}</span></div><div><b>Cập nhật</b><span>${esc(updated)}</span></div></div></div><div class="phf-eval-saved-actions"><button class="phf-eval-btn" type="button" data-action="history">Về lịch sử</button><button class="phf-eval-btn" type="button" data-action="print">In phiếu</button><button class="phf-eval-btn primary" type="button" data-action="open">Mở lại phiếu vừa lưu</button></div></div>`;
  document.body.appendChild(wrap); wrap.addEventListener('click',function(e){const b=e.target.closest('[data-action]');if(e.target===wrap){wrap.remove();return;}if(!b)return;const a=b.dataset.action;wrap.remove();if(a==='history')return phfRenderEvaluationWorkspace('history');if(a==='print'){phfEvalOpenRecord(profile.id,period.key,'view');setTimeout(phfPrintEvaluationCurrentDocument,450);return;}phfEvalOpenRecord(profile.id,period.key,'view');});
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
  if(tab === 'home') return phfRenderPostLoginHome();
  if(tab === 'overview') return canEdit ? phfRenderTrainingOverview() : phfRenderPostLoginHome();
  if(tab === 'learning') return phfGoLearning();
  if(tab === 'profile' || tab === 'evaluation') return phfGoMyProfile();
  if(tab === 'reports') return phfRenderTrainingReports();
  if(tab === 'guide') return phfGoGuide();
  if(tab === 'directTrainingTest') return phfGoDirectTrainingTest();
  if(tab === 'settings') return canEdit ? phfRenderHubPlaceholder('settings') : phfRenderTrainingOverview();
}
function phfSetMainNavActive(key){
  try{
    const alias = {home:'intro', overview:'reports', reports:'reports', evaluation:'profile'};
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
  window.__phfEvalRenderToken = (window.__phfEvalRenderToken || 0) + 1;
  phfHideIntroAndStopAuto();
  try{ if(typeof window.phfRefreshResumeSave === 'function') window.phfRefreshResumeSave('home', {hubTab:'intro'}); }catch(e){}
  return phfRenderPostLoginHome();
}
function phfGoLearning(){
  window.__phfEvalRenderToken = (window.__phfEvalRenderToken || 0) + 1;
  phfHideIntroAndStopAuto();
  try{ if(typeof window.phfRefreshResumeSave === 'function') window.phfRefreshResumeSave('learning', {hubTab:'learning'}); }catch(e){}
  return render();
}
function phfGoMyProfile(){
  window.__phfEvalRenderToken = (window.__phfEvalRenderToken || 0) + 1;
  phfHideIntroAndStopAuto();
  try{ if(typeof window.phfRefreshResumeSave === 'function') window.phfRefreshResumeSave('profile', {hubTab:'profile'}); }catch(e){}
  if(phfCanEditEvaluation() && typeof window.phfTrainingRecordsShouldResume==='function' && window.phfTrainingRecordsShouldResume()){
    return window.phfTrainingRecordsResume();
  }
  if(typeof window.phfRenderEvaluationWorkspace === 'function'){
    return window.phfRenderEvaluationWorkspace(phfCanEditEvaluation() ? 'todo' : 'profiles');
  }
  return renderEvaluationRecords();
}
function phfGoGuide(){
  window.__phfEvalRenderToken = (window.__phfEvalRenderToken || 0) + 1;
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
function phfIsDirectTestAdmin(){
  try{ return String(typeof window.phfUserRole==='function' ? window.phfUserRole() : localStorage.getItem('phfInternalTestRole') || '').toLowerCase()==='admin'; }catch(e){ return false; }
}
function phfOpenTrainingQuizForTest(idx){
  if(!phfIsDirectTestAdmin()){
    phfNotice('warning','Chỉ dành cho Admin','Chế độ mô phỏng học viên chỉ dành cho tài khoản Admin.');
    return;
  }
  idx = Number(idx);
  if(!Array.isArray(LESSONS) || !LESSONS[idx]){
    phfNotice('warning','Chưa tìm thấy nội dung','Không tìm thấy bài học hoặc bài kiểm tra cần mô phỏng trong dữ liệu hiện tại.');
    return;
  }
  if(typeof window.phfStartAdminLearningSimulation!=='function'){
    phfNotice('error','Chưa sẵn sàng','Learning gate mô phỏng chưa được tải. Vui lòng F5 và thử lại.');
    return;
  }
  window.phfStartAdminLearningSimulation(idx);
  setTimeout(function(){
    phfNotice('success','Đã mở mô phỏng học viên','Hệ thống đang dùng đúng giao diện, quiz và learning gate của học viên. Dữ liệu không ghi Supabase.');
  }, 120);
}
function phfStartFullLearnerSimulation(){
  if(!phfIsDirectTestAdmin()){
    phfNotice('warning','Chỉ dành cho Admin','Chế độ mô phỏng học viên chỉ dành cho tài khoản Admin.');
    return;
  }
  if(typeof window.phfStartAdminLearningSimulation!=='function'){
    phfNotice('error','Chưa sẵn sàng','Learning gate mô phỏng chưa được tải. Vui lòng F5 và thử lại.');
    return;
  }
  window.phfStartAdminLearningSimulation(0);
}
function phfLessonSearchText(lesson){
  lesson=lesson||{};
  return [lesson.title,lesson.nav,lesson.sub,lesson.badge,lesson.content,lesson.html,lesson.body,lesson.text].filter(Boolean).join(' ');
}
function phfCollectSimulationQuizItems(){
  if(!Array.isArray(LESSONS)) return [];
  var items=[];
  LESSONS.forEach(function(lesson,idx){
    var raw=phfLessonSearchText(lesson);
    var low=String(raw||'').toLowerCase();
    var isQuiz=/step2-question|b3-mini|b4-final-question|shortquizbtn|short-quiz|phf-short|data-correct=|data-answer=|chấm điểm bài kiểm tra|bài kiểm tra/.test(low);
    if(!isQuiz) return;
    var kind=/shortquizbtn|short-quiz|phf-short|ôn thi|kiểm tra ngắn|kiểm tra nhanh/.test(low)?'Bài kiểm tra ngắn':'Bài kiểm tra chính';
    items.push({idx:idx,title:String(lesson.title||lesson.nav||('Bài '+(idx+1))),desc:String(lesson.sub||lesson.badge||kind),kind:kind});
  });
  return items;
}
function phfRenderDirectTrainingTestPage(){
  document.body.classList.add('phf-eval-mode','phf-module-page-mode');
  document.body.classList.remove('phf-guide-standalone-mode','phf-guide-intro-active');
  document.getElementById('miniStatus').textContent='Kiểm tra';
  document.getElementById('contextTitle').textContent='Mô phỏng chương trình đào tạo';
  document.getElementById('contextSub').textContent='Admin kiểm tra đúng trải nghiệm học viên mà không ghi dữ liệu thật.';
  document.getElementById('contextAction').textContent= phfRoleLabel();
  if(!phfIsDirectTestAdmin()){
    document.getElementById('mainLesson').innerHTML = `
    <section class="phf-direct-test-page phf-admin-test-builder">
      <div class="hub-panel"><div class="phf-building-box"><h2>Chức năng chỉ dành cho Admin</h2><p>Trưởng ca và Quản lý vẫn xem kết quả theo quyền, nhưng không được mở chế độ mô phỏng toàn bộ luồng học viên.</p></div></div>
    </section>`;
    phfScrollToPageTop();
    return;
  }
  var tests=phfCollectSimulationQuizItems();
  var cards=tests.map(function(t){
    return `<article class="hub-row phf-quick-test-row"><div><b>${esc(t.title)}</b><small>${esc(t.kind)} · ${esc(t.desc||'Mô phỏng đúng luồng học viên')}</small></div><button class="eval-action primary" type="button" onclick="phfOpenTrainingQuizForTest(${t.idx})">Mô phỏng từ bài này</button></article>`;
  }).join('');
  document.getElementById('mainLesson').innerHTML = `
  <section class="phf-direct-test-page phf-admin-test-builder">
    <div class="hub-panel">
      <div class="hub-panel-head"><div><h3>Mô phỏng chương trình như học viên</h3><span>Chỉ dành cho Admin · không ghi Supabase</span></div><span>${esc(phfRoleLabel())}</span></div>
      <div class="phf-building-box">
        <h2>Kiểm tra đúng giao diện, quiz và learning gate của học viên</h2>
        <p>Chế độ này dùng cùng nội dung bài học, cách chấm, điều kiện mở bài và nút tiếp tục như học viên. Toàn bộ tiến độ và kết quả chỉ tồn tại trong phiên trình duyệt hiện tại.</p>
        <div class="action-row"><button class="eval-action primary" type="button" onclick="phfStartFullLearnerSimulation()">Bắt đầu mô phỏng từ Bài 1</button></div>
      </div>
      <div class="record-note"><b>Hai cách kiểm tra:</b> bắt đầu từ Bài 1 để rà toàn bộ lộ trình; hoặc mở trực tiếp một bài bên dưới, hệ thống sẽ tạo tiến độ giả cho các bài trước đó để mô phỏng đúng gate.</div>
      <div class="hub-panel-head" style="margin-top:18px"><div><h3>Danh sách bài có kiểm tra</h3><span>Tự nhận diện từ dữ liệu chương trình hiện tại</span></div><span>${tests.length} bài</span></div>
      <div class="hub-list">${cards || '<div class="hub-empty">Chưa nhận diện được bài kiểm tra trong chương trình hiện tại.</div>'}</div>
      <div class="record-note">Thoát mô phỏng sẽ xóa toàn bộ dữ liệu tạm. Hồ sơ nhân viên, test_results và progress thật không bị thay đổi.</div>
    </div>
  </section>`;
  phfScrollToPageTop();
}


// PHF Bản 25.4: expose quick-test functions globally, but keep the entry point inside Quản trị only.
try{
  window.phfGoDirectTrainingTest = phfGoDirectTrainingTest;
  window.phfOpenTrainingQuizForTest = phfOpenTrainingQuizForTest;
  window.phfRenderDirectTrainingTestPage = phfRenderDirectTrainingTestPage;
  window.phfStartFullLearnerSimulation = phfStartFullLearnerSimulation;
  var oldQuickBtn = document.getElementById('phfQuickTestShortcut');
  if(oldQuickBtn) oldQuickBtn.remove();
}catch(e){}

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
  document.getElementById('mainLesson').innerHTML = `<section class="eval-admin-shell">${phfRenderHubTopbar('overview', profile, canEdit)}<div class="eval-admin-page"><main class="eval-admin-main hub-overview-page is-dashboard" style="grid-column:1 / -1"><div class="hub-dashboard-hero phf-lib-hero"><div><span class="phf-lib-kicker">PHF Training Hub · Điều hành đào tạo</span><h2>Tổng quan</h2><p>Theo dõi tình hình đào tạo chung, các việc cần xử lý và những cảnh báo quan trọng.</p></div><div class="hub-dashboard-note phf-lib-role">${esc(phfRoleLabel())}<small>${total} học viên trong dữ liệu hiện tại</small></div></div><div class="hub-full-top-grid"><section class="hub-full-eval-card"><div><div class="hub-full-card-head"><div class="hub-full-icon">📋</div><div><div class="hub-full-title">Việc đánh giá cần làm</div><p>Danh sách các mốc đánh giá đang quá hạn, đến hạn hoặc sắp đến hạn theo lịch đào tạo của từng học viên.</p><div class="hub-full-count">${evalTodoItems.length} việc đánh giá cần làm</div><p>${evalTodoSummary} · ${missingTotal} phiếu còn thiếu</p></div></div></div><div class="hub-full-actions"><button class="eval-action primary" type="button" onclick="phfRenderEvaluationWorkspace('todo')">Mở việc cần xử lý</button><button class="eval-action" type="button" onclick="phfRenderEvaluationWorkspace('history')">Xem lịch sử</button></div></section><div class="hub-kpi"><b>${total}</b><span>Đang đào tạo</span><p>${active} trong mốc · ${completedTime} hết mốc · ${noStart} thiếu ngày bắt đầu.</p><div class="hub-progress green"><span style="width:${total?Math.round(active/total*100):0}%"></span></div></div><div class="hub-kpi"><b>${testAgg.scored ? testAgg.avg + '%' : '-'}</b><span>Kết quả bài kiểm tra</span><p>Điểm trung bình gần nhất · ${testAgg.fail} học viên chưa đạt.</p><div class="hub-progress blue"><span style="width:${testAgg.scored ? Math.max(4,testAgg.avg) : 0}%"></span></div></div><div class="hub-kpi danger"><b>${needAttention}</b><span>Cần chú ý</span><p>${overdueLearners} trễ đánh giá · ${testAgg.fail} chưa đạt bài kiểm tra · ${noStart} thiếu ngày bắt đầu.</p><div class="hub-progress red"><span style="width:${total?Math.max(4,Math.round(needAttention/total*100)):0}%"></span></div></div></div><div class="hub-insight-grid"><section class="hub-panel"><div class="hub-panel-head"><h3>Điểm bài kiểm tra trung bình theo giai đoạn</h3><span>GĐ1–GĐ5</span></div><div class="hub-chart-box"><div class="hub-bar-list">${phfHubBarRows(testAgg.stageItems, 100)}</div></div></section><section class="hub-panel"><div class="hub-panel-head"><h3>Tình trạng bài kiểm tra</h3><span>toàn bộ học viên</span></div><div class="hub-chart-box"><div class="hub-bar-list">${phfHubBarRows(testStatusItems, Math.max.apply(null, testStatusItems.map(function(x){return x.value;}).concat([1])))}</div></div></section><section class="hub-panel"><div class="hub-panel-head"><h3>Tình trạng hồ sơ đánh giá</h3><span>phiếu tuần/tháng/final</span></div><div class="hub-chart-box"><div class="hub-status-list">${evalStatusRows}</div></div></section></div><section class="hub-full-eval-card"><div><div class="hub-full-card-head"><div class="hub-full-icon">👥</div><div><div class="hub-full-title">Cần xử lý theo từng học viên?</div><p>Chuyển sang tab Học viên để tìm đúng người, xem hồ sơ, tiến độ, bài kiểm tra và phiếu đánh giá chi tiết.</p></div></div></div><div class="hub-full-actions"><button class="eval-action primary" type="button" onclick="phfRenderEvaluationWorkspace('todo')">Mở tab Học viên</button></div></section>${adminDirectTestModule}<div class="hub-dashboard-grid"><section class="hub-panel"><div class="hub-panel-head"><h3>Việc cần chú ý hôm nay</h3><span>ưu tiên quá hạn/bài kiểm tra chưa đạt</span></div><div class="hub-worklist">${workRows || '<div class="hub-empty">Chưa có việc cần xử lý nổi bật.</div>'}</div><div class="hub-dashboard-foot"><button class="eval-action primary" type="button" onclick="phfRenderEvaluationWorkspace('todo')">Mở tab Học viên</button><button class="eval-action" type="button" onclick="phfRenderTrainingReports()">Xem báo cáo</button></div></section><section class="hub-panel"><div class="hub-panel-head"><h3>Tiến độ theo giai đoạn</h3><span>ước tính theo ngày bắt đầu học</span></div><div class="hub-chart-box"><div class="hub-bar-list">${phfHubBarRows(stageItems, Math.max(1,total))}</div></div></section></div></main></div></section>`;
  phfScrollToPageTop();
}
function phfRenderLearnerTrainingOverview(){
  /* UI cá nhân chỉ thuộc namespace Học viên. Callback dữ liệu legacy có thể
     gọi hàm này muộn trong lúc Admin/Quản lý đang chuyển route; khi đó không
     được phép ghi đè màn đích. */
  const currentRoute = String((window.location && window.location.pathname) || '/');
  if(!/^\/hv(?:\/|$)/.test(currentRoute)) return false;
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
    <div class="eval-admin-page"><aside class="eval-admin-sidebar"><section class="eval-card eval-profile-card"><h3>Hồ sơ của bạn</h3><div class="eval-profile-lines"><div class="eval-profile-line"><b>Họ tên</b><span>${esc(profile.fullName)}</span></div><div class="eval-profile-line"><b>SĐT</b><span>${esc(profile.phone || 'Chưa có')}</span></div><div class="eval-profile-line"><b>Vị trí</b><span>${esc(profile.position || 'Nhân viên bán hàng')}</span></div><div class="eval-profile-line"><b>Chi nhánh</b><span>${esc(profile.branch || 'Chưa phân chi nhánh')}</span></div><div class="eval-profile-line"><b>Ngày bắt đầu</b><span>${esc(profile.studyStartDate || 'Chưa nhập')}</span></div></div></section></aside>
      <main class="eval-admin-main hub-overview-page"><div class="hub-hero phf-photo-hero"><div><span class="phf-hero-kicker">PHF Training Hub</span><h2>Bài học của tôi</h2><p>Tiếp tục lộ trình đào tạo nội bộ, theo dõi tiến độ học tập và xem lại hồ sơ đánh giá của bạn.</p></div><div class="hub-badge">${esc(profile.fullName)}<br><small>${esc(currentRange)}</small></div></div><div class="hub-kpi-grid"><div class="hub-kpi"><b>${progress.pct}%</b><span>Tiến độ học</span><p>${progress.done}/${progress.total} mục theo thứ tự hiện tại.</p></div><div class="hub-kpi"><b>${saved}</b><span>Phiếu đã lưu</span><p>${evalTodo}</p></div><div class="hub-kpi"><b>${finalRec?'Có':'Chưa'}</b><span>Phiếu kết thúc</span><p>${finalRec ? 'Đã có hồ sơ kết thúc thử việc.' : 'Chưa có phiếu kết thúc thử việc.'}</p></div><div class="hub-kpi"><b>HV</b><span>Quyền hiện tại</span><p>Chỉ xem hồ sơ của mình.</p></div></div><div class="hub-content-grid"><section class="hub-panel"><div class="hub-panel-head"><h3>Việc cần làm tiếp theo</h3><span>ưu tiên thao tác</span></div><div class="hub-list"><div class="hub-row"><div><b>Tiếp tục học tập</b><small>${esc(nextLessonTitle)}</small></div><button class="eval-action primary" type="button" onclick="phfGoLearning()">Vào học</button></div><div class="hub-row"><div><b>Hồ sơ đánh giá</b><small>${esc(evalTodo)}</small></div><button class="eval-action" type="button" onclick="renderEvaluationRecords()">Xem hồ sơ</button></div>${!timeline?'<div class="hub-warning">Bạn chưa nhập ngày bắt đầu học nên hệ thống chưa tính đủ mốc đánh giá.</div>':''}</div></section><section class="hub-panel"><div class="hub-panel-head"><h3>Kỳ đánh giá gần nhất</h3><span>${periods.length} kỳ</span></div><div class="hub-list">${rows || '<div class="hub-row"><div><b>Chưa có kỳ đánh giá</b><small>Cần nhập ngày bắt đầu học để hệ thống tính mốc.</small></div></div>'}</div></section></div></main></div></section>`;
  phfScrollToPageTop();
}

function phfRenderPostLoginHome(){
  try{ if(typeof phfHideIntroAndStopAuto === 'function') phfHideIntroAndStopAuto(); }catch(e){}
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
        <h2>Chào mừng <span class="phf-home-account-name" style="color:#b45f1b !important;-webkit-text-fill-color:#b45f1b !important;font-weight:800 !important;">${esc(learnerName)}</span> đến với hệ thống đào tạo nội bộ.</h2>
        <p>Đây là khu vực để bạn tiếp tục bài học đang học, xem lại hồ sơ cá nhân, làm bài kiểm tra và theo dõi các mốc đánh giá trong suốt quá trình đào tạo tại PHUHOA FRESH.</p>
        <div class="phf-home-actions">
          ${(!canEdit && (!window.phfHasActiveTrainingHubProgram || window.phfHasActiveTrainingHubProgram())) ? '<button class="phf-home-action primary" type="button" onclick="phfGoLearning()"><span>Bài học của tôi</span><small>Tiếp tục lộ trình đang học</small></button>' : ''}
          ${(!canEdit && window.phfOpenClassroom) ? '<button class="phf-home-action primary" type="button" onclick="phfOpenClassroom()"><span>Lớp đào tạo của tôi</span><small>Xem lớp, lịch học, tài liệu và kết quả</small></button>' : ''}
          <button class="phf-home-action" type="button" onclick="phfGoMyProfile()"><span>Hồ sơ của tôi</span><small>Xem thông tin, tiến độ và đánh giá</small></button>
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
  const currentRoute = String((window.location && window.location.pathname) || '/');
  /* /ql/quan-ly luôn thuộc renderer Quản lý, không phụ thuộc trạng thái quyền
     tạm thời trong lúc session/dữ liệu đang khôi phục. Nhờ vậy không còn nhảy
     sang màn Học viên rồi mới quay lại màn Quản lý. */
  if(currentRoute === '/ql/quan-ly') return phfRenderManagerTrainingOverview();
  /* Báo cáo có renderer riêng. Không cho overview legacy chen vào vùng mount
     khi route Báo cáo đang tải hoặc vừa hoàn tất. */
  if(currentRoute === '/admin/bao-cao' || currentRoute === '/ql/bao-cao') return false;
  phfSetMainNavActive('reports');
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
    return `<tr><td><b>${esc(r.learner.fullName)}</b><small>${esc(r.learner.phone || '')}</small></td><td>${esc(r.learner.branch || 'Chưa phân chi nhánh')}<small>${esc(r.learner.position || '')}</small></td><td>${esc(r.learner.programId || 'new_sales')}</td><td>${esc(r.learner.studyStartDate || 'Chưa nhập')}</td><td>${esc(r.stage.label)}<small>${esc(r.stage.currentRange || '')}</small></td><td>${esc(r.stage.pct || 0)}%</td><td><span class="${scoreCls}">${esc(r.test.label)}</span></td><td><span class="hub-report-status ${r.learningStatus==='ok'?'ok':(r.learningStatus==='bad'?'bad':(r.learningStatus==='warn'?'warn':'info'))}">${esc(r.learningText)}</span></td><td><button class="phf-report-action-btn" type="button" onclick="phfHubSetLearnerAndOpen('${esc(r.learner.id)}','evaluation','${esc(r.actionPeriod)}','view')">Xem chi tiết</button></td></tr>`;
  }).join('');
  const evalRows = rows.map(function(r){
    const finalText = r.summary.finalRec ? 'Đã có' : 'Chưa có';
    const watchCount = (r.summary.records || []).reduce(function(sum,rec){
      try{ const data = typeof rec.data === 'string' ? JSON.parse(rec.data) : (rec.data || rec.payload || {}); const values = Object.values(data.criteria || data.ratings || {}); return sum + values.filter(function(v){ return /theo dõi|chưa đạt/i.test(String(v && (v.rating || v.status || v)))}).length; }catch(e){ return sum; }
    },0);
    return `<tr><td><b>${esc(r.learner.fullName)}</b><small>${esc(r.learner.branch || 'Chưa phân chi nhánh')} · ${esc(r.learner.position || '')}</small></td><td>${r.summary.saved}/${r.summary.saved + r.summary.missing}</td><td><span class="hub-report-status ${r.summary.finalRec?'ok':'warn'}">${esc(finalText)}</span></td><td>${watchCount || '-'}</td><td><span class="hub-report-status ${r.recordStatus==='ok'?'ok':(r.recordStatus==='bad'?'bad':'warn')}">${esc(r.recordText)}</span></td><td>${esc(r.summary.records[0] ? phfEvalUpdatedText(r.summary.records[0]) : '-')}</td><td><div class="hub-report-action-row"><button class="phf-report-action-btn" type="button" onclick="phfHubSetLearnerAndOpen('${esc(r.learner.id)}','evaluation','${esc(r.actionPeriod)}','history')">Lịch sử</button><button class="phf-report-action-btn is-primary" type="button" onclick="phfHubSetLearnerAndOpen('${esc(r.learner.id)}','evaluation','${esc(r.actionPeriod)}','edit')">Xử lý</button></div></td></tr>`;
  }).join('');
  const miniStatusEl = document.getElementById('miniStatus');
  const contextTitleEl = document.getElementById('contextTitle');
  const contextSubEl = document.getElementById('contextSub');
  const contextActionEl = document.getElementById('contextAction');
  const mainLessonEl = document.getElementById('mainLesson');
  if(miniStatusEl) miniStatusEl.textContent='Báo cáo';
  if(contextTitleEl) contextTitleEl.textContent='Bạn đang ở: Báo cáo đào tạo';
  if(contextSubEl) contextSubEl.textContent='Tổng hợp tiến độ học, điểm bài kiểm tra và tình trạng hồ sơ đánh giá';
  if(contextActionEl) contextActionEl.textContent=phfRoleLabel();
  if(!mainLessonEl){
    throw new Error('PHF_REPORT_HOST_MISSING');
  }
  mainLessonEl.innerHTML = `<section class="eval-admin-shell">${phfRenderHubTopbar('reports', profile, canEdit)}<div class="eval-admin-page"><main class="eval-admin-main hub-report-page"><div class="hub-dashboard-hero phf-standard-module-hero"><div><span class="phf-lib-kicker phf-standard-module-kicker">PHF Training Hub · Báo cáo</span><h2>Báo cáo đào tạo</h2><p>Theo dõi và đối chiếu tiến độ đào tạo, kết quả kiểm tra và hồ sơ đánh giá của học viên.</p></div><div class="hub-dashboard-note phf-standard-module-role">${esc(phfRoleLabel())}<small>${total} học viên theo bộ lọc</small></div></div><section class="hub-report-filters"><div class="hub-report-filter"><label>Chương trình</label><select id="phfReportProgram">${programOptions}</select></div><div class="hub-report-filter"><label>Chi nhánh</label><select id="phfReportBranch">${branchOptions}</select></div><div class="hub-report-filter"><label>Trạng thái</label><select id="phfReportStatus">${statusOptions}</select></div><button class="eval-action primary" type="button" onclick="phfApplyReportFilters()">Lọc báo cáo</button><button class="eval-action" type="button" onclick="phfRenderTrainingReports({program:'all',branch:'all',status:'all'})">Xóa lọc</button></section><div class="hub-report-top"><section class="hub-report-main-card"><h3>Hồ sơ đánh giá</h3><p>Theo dõi đủ/thiếu phiếu, phiếu quá hạn và học viên cần xử lý.</p><b>${missingEvalLearners} học viên thiếu hồ sơ</b><div class="action-row"><button class="eval-action primary" type="button" onclick="renderEvaluationRecords()">Mở Đánh giá →</button></div></section><div class="hub-report-metric"><b>${total}</b><span>Học viên</span><p>Trong phạm vi bộ lọc hiện tại.</p></div><div class="hub-report-metric"><b>${testAgg.scored ? testAgg.avg + '%' : '-'}</b><span>Điểm bài kiểm tra TB</span><p>${testAgg.fail} chưa đạt · ${testAgg.none} chưa làm.</p></div><div class="hub-report-metric"><b>${needAttention}</b><span>Cần xử lý</span><p>${overdueLearners} quá hạn · ${noStart} thiếu ngày bắt đầu.</p></div></div><div class="hub-report-grid"><section class="hub-panel"><div class="hub-panel-head"><h3>Tiến độ theo giai đoạn</h3><span>tóm tắt gọn</span></div>${phfReportMiniRows(stageItems, Math.max(1,total))}<div class="phf-report-compact-note">Xem chi tiết từng học viên ở bảng bên dưới.</div></section><section class="hub-panel"><div class="hub-panel-head"><h3>Tình trạng bài kiểm tra</h3><span>tóm tắt gọn</span></div>${phfReportMiniRows(testStatusItems, Math.max.apply(null,testStatusItems.map(function(x){return x.value}).concat([1])))}<div class="phf-report-compact-note">Ưu tiên xử lý học viên chưa làm hoặc chưa đạt.</div></section></div><section class="hub-panel"><div class="hub-report-table-note"><div><h3>Tiến độ học viên</h3><small>Phục vụ rà tiến độ học, điểm bài kiểm tra và trạng thái cần nhắc.</small></div></div><div class="eval-table-wrap"><table class="hub-action-table hub-report-table"><thead><tr><th>Học viên</th><th>Chi nhánh/Vị trí</th><th>Chương trình</th><th>Ngày bắt đầu</th><th>Giai đoạn</th><th>Tiến độ</th><th>Điểm bài kiểm tra</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${progressRows || '<tr><td colspan="9">Không có học viên phù hợp bộ lọc.</td></tr>'}</tbody></table></div></section><section class="hub-panel"><div class="hub-report-table-note"><div><h3>Hồ sơ đánh giá</h3><small>Rà tình trạng phiếu tuần, tháng, kết thúc và tiêu chí cần theo dõi.</small></div></div><div class="eval-table-wrap"><table class="hub-action-table hub-report-table"><thead><tr><th>Học viên</th><th>Phiếu đã lưu</th><th>Phiếu kết thúc</th><th>Cần theo dõi</th><th>Trạng thái hồ sơ</th><th>Cập nhật gần nhất</th><th>Thao tác</th></tr></thead><tbody>${evalRows || '<tr><td colspan="7">Không có dữ liệu hồ sơ phù hợp bộ lọc.</td></tr>'}</tbody></table></div></section><div class="record-note">Báo cáo nền: ưu tiên xem/lọc nhanh và xử lý hồ sơ. Xuất bảng tính / bản in có thể làm sau khi bảng dữ liệu đã chốt.</div></main></div></section>`;
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
    ? 'Tổng hợp tiến độ học, phiếu còn thiếu, học viên cần theo dõi và kết quả đào tạo.'
    : (tab === 'guide' ? 'Thông tin hỗ trợ người dùng truy cập bài học, xem hồ sơ và sử dụng tài khoản.' : 'Khu vực dành cho Admin quản lý chương trình, học viên, quyền, nội dung và mốc đào tạo.');
  document.getElementById('miniStatus').textContent=title;
  document.getElementById('contextTitle').textContent='Bạn đang ở: ' + title;
  document.getElementById('contextSub').textContent=desc;
  document.getElementById('contextAction').textContent=canEdit ? phfRoleLabel() : 'Chế độ xem';
  document.getElementById('mainLesson').innerHTML = `<section class="eval-admin-shell">${phfRenderHubTopbar(tab, profile, canEdit)}<div class="eval-admin-page"><aside class="eval-admin-sidebar"><section class="eval-card eval-profile-card"><h3>Trạng thái</h3><div class="eval-profile-lines"><div class="eval-profile-line"><b>Khu vực</b><span>${esc(title)}</span></div><div class="eval-profile-line"><b>Tình trạng</b><span>Định hướng</span></div><div class="eval-profile-line"><b>Ưu tiên</b><span>Làm sau lõi</span></div></div></section></aside><main class="eval-admin-main"><section class="hub-panel hub-placeholder"><h2>${esc(title)}</h2><p>${esc(desc)}</p><div class="record-note" style="margin-top:14px">Các nội dung chi tiết sẽ được mở theo quyền sử dụng và nhu cầu vận hành đào tạo.</div><div class="hub-shortcuts"><button class="eval-action primary" type="button" onclick="phfRenderTrainingOverview()">Về Tổng quan</button>${canEdit ? '' : '<button class="eval-action" type="button" onclick="phfGoLearning()">Học tập</button>'}<button class="eval-action" type="button" onclick="renderEvaluationRecords()">${canEdit ? 'Đánh giá' : 'Hồ sơ của tôi'}</button></div></section></main></div></section>`;
  phfScrollToPageTop();
}

async function renderEvaluationRecords(selectedKey, mode, options){
  const renderToken = (window.__phfEvalRenderToken = (window.__phfEvalRenderToken || 0) + 1);
  phfSetMainNavActive('profile');
  try{ if(typeof window.phfRefreshResumeSave === 'function') window.phfRefreshResumeSave('profile', {hubTab:'profile'}); }catch(e){}
  options = options || {};
  const silentNotice = !!options.silentNotice;
  const returnView = options.returnView || (window.__phfEvalWorkspaceState && window.__phfEvalWorkspaceState.view) || 'history';
  document.body.classList.add('phf-eval-mode','phf-module-page-mode');
  document.body.classList.remove('phf-guide-standalone-mode','phf-guide-intro-active');
  const detailLoadOk = await phfEnsureEvaluationDataReady(phfCanEditEvaluation());
  phfToastClear('evaluation-load');
  if(renderToken !== window.__phfEvalRenderToken) return;
  if(!detailLoadOk){
    const host = document.getElementById('mainLesson');
    if(host){
      host.innerHTML = '<section class="phf-eval-list-card"><div class="phf-eval-empty">Chưa tải được dữ liệu hồ sơ. Vui lòng kiểm tra kết nối rồi thử lại.</div></section>';
    }
    return false;
  }
  const canEdit = phfCanEditEvaluation();
  if(canEdit && !selectedKey && !options.forceProfile && (!mode || mode === 'history')){
    return phfRenderEvaluationWorkspace(mode === 'history' ? 'history' : 'todo');
  }
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
  const detailType = selected ? phfEvalShortType(selected) : 'Hồ sơ đánh giá';
  const detailPeriod = selected ? `${selected.label} · ${phfFormatRange(selected.start,selected.end)}` : 'Chưa chọn kỳ đánh giá';
  document.getElementById('mainLesson').innerHTML = `<section class="eval-admin-shell">
    ${phfRenderHubTopbar('evaluation', profile, canEdit)}
    <div class="phf-eval-detail-context">
      <div class="phf-eval-detail-nav"><button class="phf-eval-back-btn" type="button" onclick="phfEvalReturnToWorkspace('${esc(returnView)}')">← Quay lại ${returnView==='todo'?'việc cần xử lý':'lịch sử đánh giá'}</button><span class="phf-eval-detail-path">Học viên / ${returnView==='todo'?'Việc cần xử lý':'Lịch sử đánh giá'} / ${esc(profile.fullName)} / ${esc(detailType)}</span></div>
      <div class="phf-eval-detail-headline"><h2>Chi tiết đánh giá học viên</h2><p><b>${esc(profile.fullName)}</b> · ${esc(detailType)} · ${esc(detailPeriod)}</p></div>
    </div>
    <div class="eval-admin-page"><aside class="eval-admin-sidebar"><section class="eval-card eval-profile-card"><h3>Thông tin học viên</h3><div class="eval-profile-lines"><div class="eval-profile-line"><b>Họ tên</b><span>${esc(profile.fullName)}</span></div><div class="eval-profile-line"><b>SĐT</b><span>${esc(profile.phone || 'Chưa có')}</span></div><div class="eval-profile-line"><b>Vị trí</b><span>${esc(profile.position || 'Nhân viên bán hàng')}</span></div><div class="eval-profile-line"><b>Chi nhánh</b><span>${esc(profile.branch || 'Chưa phân chi nhánh')}</span></div><div class="eval-profile-line"><b>Ngày bắt đầu</b><span>${esc(profile.studyStartDate || 'Chưa nhập')}</span></div></div></section><section class="eval-card eval-period-card"><div class="eval-period-head"><h3>Kỳ đang xem</h3><button class="eval-small-plus eval-period-toggle" type="button" aria-expanded="false" onclick="phfToggleEvalPeriodList(this)">+</button></div>${selected?`<button class="eval-period-current eval-period-item" type="button" data-action="view" data-week-key="${esc(selected.key)}"><span><b>${esc(selected.label)}</b><small>${esc(phfEvalShortType(selected))} · ${phfFormatRange(selected.start,selected.end)}</small></span><em class="eval-status-chip ${phfEvalStatus(selected.start, selected.end, !!phfPeriodRecord(profile.id, selected)).cls}">${esc(phfEvalStatus(selected.start, selected.end, !!phfPeriodRecord(profile.id, selected)).text)}</em></button>`:''}<div id="evalPeriodListWrap" class="eval-period-list-wrap">${periods.length ? phfRenderEvalPeriodList(periods, profile.id, selected && selected.key) : '<div class="eval-empty clean">Chưa có ngày bắt đầu học để tính kỳ đánh giá.</div>'}</div></section></aside>
      <main class="eval-admin-main"><div class="eval-toolbar"><div><h2>Hồ sơ đánh giá</h2><p>${esc(roleText)}</p></div><div class="eval-table-actions">${canEdit?'<button class="eval-action" type="button" onclick="phfRenderEvaluationWorkspace(\'todo\')">Việc cần làm</button><button class="eval-action" type="button" onclick="phfRenderEvaluationWorkspace(\'history\')">Lịch sử phiếu</button>':''}${topCreate}</div></div>${learnerPicker || ''}<div class="eval-summary-strip"><div class="status-item"><b>Học viên đang xem</b><span>${esc(profile.fullName)}</span></div><div class="status-item"><b>Tiến trình đánh giá</b><span>${esc(statusText)}</span></div><div class="status-item"><b>Phiếu đã lưu</b><span>${esc(savedLabel)}</span></div><div class="status-item"><b>Quyền hiện tại</b><span>${esc(canEdit ? phfRoleLabel() : 'Chỉ xem')}</span></div></div>${phfRenderEvalTabs(selected, canEdit, activeTab)}<section class="eval-detail-panel" id="weeklyFormBox"></section><div class="actions"><button class="btn btn-soft" type="button" onclick="phfGoLearning()">← Quay lại bài đang học</button></div></main></div></section>`;
  document.querySelectorAll('.eval-period-group-list').forEach(function(g){g.classList.add('collapsed');});
  document.querySelectorAll('.eval-period-group-head').forEach(function(head){head.setAttribute('aria-expanded','false');const icon=head.querySelector('em');if(icon)icon.textContent='+';});
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
  // Mở chi tiết phải bắt đầu từ đầu màn để người dùng luôn thấy nút quay lại
  // và đường dẫn ngữ cảnh; khi quay lại danh sách, vị trí cũ vẫn được khôi phục.
  if(typeof phfScrollToPageTop === 'function'){
    requestAnimationFrame(function(){ phfScrollToPageTop(); });
  }else{
    requestAnimationFrame(function(){ window.scrollTo({top:0, behavior:'auto'}); });
  }
  return true;
}


/* PHF Bản 27.1
   Fix nút Nhập đánh giá / Xem hồ sơ từ các danh sách quản trị.
   Chỉ điều hướng đúng học viên/kỳ đánh giá, không đổi nghiệp vụ lưu phiếu.
*/
function phfHubSetLearnerAndOpen(learnerId, tab, periodKey, mode){
  try{
    const targetId = String(learnerId || '').trim();
    const targetTab = String(tab || 'evaluation').trim();
    const targetPeriod = String(periodKey || '').trim();
    const targetMode = String(mode || 'view').trim();

    if(targetId){
      localStorage.setItem('phfEvalSelectedEmployeeId', targetId);
    }
    window.__phfEvalReadFresh = false;

    if(targetTab === 'reports'){
      if(typeof phfRenderTrainingReports === 'function') phfRenderTrainingReports();
      return;
    }
    if(targetTab === 'overview' || targetTab === 'home'){
      if(typeof phfRenderTrainingOverview === 'function') phfRenderTrainingOverview();
      return;
    }

    if(typeof renderEvaluationRecords === 'function'){
      renderEvaluationRecords(targetPeriod || undefined, targetMode || 'view', {silentNotice:true});
      return;
    }

    if(window.phfToast){
      phfToast('warning','Chưa mở được hồ sơ','Khu vực đánh giá chưa sẵn sàng. Vui lòng tải lại trang rồi thử lại.', 4200, 'evaluation-open');
    }
  }catch(err){
    console.error('PHF open evaluation failed', err);
    if(window.phfToast){
      phfToast('error','Chưa mở được hồ sơ','Vui lòng tải lại trang rồi thử lại.', 4200, 'evaluation-open');
    }
  }
}
