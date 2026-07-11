
(function(){
  'use strict';

  const state = window.__phfTrainingRecordsState || {
    view: 'employees',
    employeeId: '',
    detailTab: 'overview',
    probationEditOpen: false,
    filters: { q:'', branch:'all', status:'all' }
  };
  window.__phfTrainingRecordsState = state;

  function esc(value){
    return String(value == null ? '' : value)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function norm(value){ return String(value == null ? '' : value).trim(); }
  function role(){
    try{return String((typeof window.phfGetSessionRole==='function'?window.phfGetSessionRole():'')||'').toLowerCase()}
    catch(e){return''}
  }
  function canView(){ return role()==='admin' || role()==='manager'; }
  function data(){ return window.__phfLocalData || {}; }
  function employees(){ return Array.isArray(data().employees) ? data().employees.slice() : []; }
  function testResults(){ return Array.isArray(data().testResults) ? data().testResults.slice() : []; }
  function evaluations(){ return Array.isArray(data().evaluationRecords) ? data().evaluationRecords.slice() : []; }
  function commitments(){ return Array.isArray(data().confidentialityCommitments) ? data().confidentialityCommitments.slice() : []; }
  function progress(){ return data().progress || {}; }
  function employeeById(id){ return employees().find(function(x){return String(x.id||'')===String(id||'')}) || null; }
  function employeeIdOf(row){ return String(row && (row.employeeId || row.employee_id) || ''); }
  function dateValue(row){
    return String(row && (row.updatedAt || row.updated_at || row.savedAt || row.saved_at || row.signedAt || row.confirmedAt || row.confirmDate) || '');
  }
  function fmtDate(value){
    if(!value) return '—';
    const d=new Date(value);
    if(Number.isNaN(d.getTime())){
      const m=String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value);
    }
    return d.toLocaleDateString('vi-VN');
  }
  function fmtDateTime(value){
    if(!value) return '—';
    const d=new Date(value);
    if(Number.isNaN(d.getTime())) return fmtDate(value);
    return d.toLocaleString('vi-VN',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'numeric'});
  }
  function addDays(value, days){
    const d=new Date(String(value||'')+'T00:00:00');
    if(Number.isNaN(d.getTime())) return null;
    d.setDate(d.getDate()+days);
    return d;
  }
  function isoDate(d){
    if(!d || Number.isNaN(d.getTime())) return '';
    const p=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  }
  function scoreStatus(row){
    const raw=String(row && (row.status || row.resultText || row.result_text) || '').toLowerCase();
    const score=Number(row && row.score);
    const pass=Number(row && (row.passScore || row.pass_score || 80));
    const ok=raw.includes('đạt') || raw.includes('pass') || (Number.isFinite(score)&&score>=pass);
    return {ok:ok,text:ok?'Đạt':'Chưa đạt',cls:ok?'done':'watch'};
  }
  function evalType(row){
    const type=String(row && (row.formType || row.form_type) || '');
    if(type==='final') return 'Kết thúc thử việc';
    if(type==='monthly') return 'Đánh giá tháng';
    return 'Đánh giá tuần';
  }
  function evalPeriod(row){ return norm(row && (row.periodLabel || row.period_label || row.periodKey || row.period_key)) || '—'; }
  function evalConclusion(row){ return norm(row && (row.conclusion || row.nextFocus || row.next_focus)) || 'Đã ghi nhận'; }
  function employeeTests(id){
    return testResults().filter(function(x){return employeeIdOf(x)===String(id)})
      .sort(function(a,b){return dateValue(b).localeCompare(dateValue(a))});
  }
  function employeeEvaluations(id){
    return evaluations().filter(function(x){return employeeIdOf(x)===String(id)})
      .sort(function(a,b){return dateValue(b).localeCompare(dateValue(a))});
  }
  function employeeCommitments(id){
    return commitments().filter(function(x){return employeeIdOf(x)===String(id)})
      .sort(function(a,b){return dateValue(b).localeCompare(dateValue(a))});
  }
  function latest(arr){ return arr && arr.length ? arr[0] : null; }
  function progressSummary(id){
    const p=progress()[id] || {};
    const done=Array.isArray(p.completedPages)?p.completedPages.length:0;
    const current=norm(p.currentPage);
    return {done:done,current:current};
  }
  function probationRecord(empId){
    const rows=Array.isArray(data().probationRecords)?data().probationRecords:[];
    return rows.find(function(x){return String(x.employeeId||x.employee_id||'')===String(empId||'')})||null;
  }
  function probationInfo(emp){
    const record=probationRecord(emp.id);
    const records=employeeEvaluations(emp.id);
    const finalRecord=records.find(function(x){return String(x.formType||x.form_type||'')==='final'});
    const start=norm(emp.studyStartDate || emp.study_start_date);
    const expected=norm(record&&record.expectedEndDate)|| (start?isoDate(addDays(start,59)):'');
    const status=norm(record&&record.status)||(!start?'missing_start':'in_progress');
    const labels={
      missing_start:'Thiếu ngày bắt đầu',
      in_progress:'Đang thử việc',
      due_soon:'Sắp đến hạn',
      awaiting_conclusion:'Chờ kết luận',
      proposed:'Đã có đề xuất',
      passed:'Đạt thử việc',
      extended:'Gia hạn thử việc',
      failed:'Không đạt',
      resigned:'Đã nghỉ'
    };
    const classes={
      missing_start:'watch',in_progress:'upcoming',due_soon:'due',
      awaiting_conclusion:'overdue',proposed:'watch',passed:'done',
      extended:'watch',failed:'risk',resigned:'risk'
    };
    let derived=status;
    if(status==='in_progress'&&expected){
      const end=new Date(expected+'T00:00:00'),today=new Date();today.setHours(0,0,0,0);
      const diff=Math.ceil((end.getTime()-today.getTime())/86400000);
      if(diff<0)derived='awaiting_conclusion';else if(diff<=7)derived='due_soon';
    }
    return {
      text:labels[derived]||derived,cls:classes[derived]||'upcoming',
      end:expected,record:record,finalRecord:finalRecord,status:status,
      conclusion:norm(record&&record.conclusion),notes:norm(record&&record.notes),
      proposedBy:norm(record&&record.proposedBy),confirmedBy:norm(record&&record.confirmedBy)
    };
  }
  function bmttStatus(emp){
    const rows=employeeCommitments(emp.id);
    const item=latest(rows);
    if(!item) return {text:'Chưa cam kết',cls:'watch',record:null};
    const status=norm(item.status).toLowerCase();
    if(status.includes('hủy')) return {text:'Đã hủy',cls:'risk',record:item};
    if(status.includes('hết')) return {text:'Hết hiệu lực',cls:'watch',record:item};
    if(status.includes('thay')) return {text:'Đã thay thế',cls:'watch',record:item};
    return {text:'Đã xác nhận',cls:'done',record:item};
  }
  function testSummary(emp){
    const rows=employeeTests(emp.id);
    const item=latest(rows);
    if(!item) return {text:'Chưa có kết quả',cls:'upcoming',record:null};
    const st=scoreStatus(item);
    return {text:`${Number.isFinite(Number(item.score))?Number(item.score)+' điểm · ':''}${st.text}`,cls:st.cls,record:item};
  }
  function branchOptions(){
    return Array.from(new Set(employees().map(function(x){return norm(x.branch)}).filter(Boolean))).sort(function(a,b){return a.localeCompare(b,'vi')});
  }
  function setMode(view,employeeId,tab){
    state.view=view||'employees';
    state.employeeId=employeeId||'';
    state.detailTab=tab||'overview';
    try{
      localStorage.setItem('phfTrainingRecordsMode','1');
      localStorage.setItem('phfTrainingRecordsView',state.view);
      localStorage.setItem('phfTrainingRecordsEmployeeId',state.employeeId);
      localStorage.setItem('phfTrainingRecordsDetailTab',state.detailTab);
    }catch(e){}
    try{if(typeof window.phfRefreshResumeSave==='function')window.phfRefreshResumeSave('profile',{hubTab:'profile',profileModule:'training-records'})}catch(e){}
  }
  function clearMode(){
    try{
      localStorage.removeItem('phfTrainingRecordsMode');
      localStorage.removeItem('phfTrainingRecordsView');
      localStorage.removeItem('phfTrainingRecordsEmployeeId');
      localStorage.removeItem('phfTrainingRecordsDetailTab');
    }catch(e){}
  }
  function restoreMode(){
    try{
      if(localStorage.getItem('phfTrainingRecordsMode')!=='1') return null;
      return {
        view:localStorage.getItem('phfTrainingRecordsView')||'employees',
        employeeId:localStorage.getItem('phfTrainingRecordsEmployeeId')||'',
        detailTab:localStorage.getItem('phfTrainingRecordsDetailTab')||'overview'
      };
    }catch(e){return null}
  }
  function baseTabs(active){
    return `<div class="phf-eval-work-tabs phf-records-main-tabs">
      <button class="phf-eval-work-tab" type="button" onclick="phfTrainingRecordsLeave();phfRenderEvaluationWorkspace('todo')">Việc cần xử lý</button>
      <button class="phf-eval-work-tab" type="button" onclick="phfTrainingRecordsLeave();phfRenderEvaluationWorkspace('history')">Lịch sử đánh giá</button>
      <button class="phf-eval-work-tab" type="button" onclick="phfTrainingRecordsLeave();phfRenderEvaluationWorkspace('profiles')">Hồ sơ học viên</button>
      <button class="phf-eval-work-tab ${active==='employees'||active==='detail'?'active':''}" type="button" onclick="phfTrainingRecordsOpen('employees')">Hồ sơ đào tạo &amp; đánh giá</button>
      <button class="phf-eval-work-tab ${active==='bmtt'?'active':''}" type="button" onclick="phfTrainingRecordsOpen('bmtt')">Cam kết BMTT</button>
    </div>`;
  }
  function injectCss(){
    if(document.getElementById('phfTrainingRecordsCss')) return;
    const style=document.createElement('style');
    style.id='phfTrainingRecordsCss';
    style.textContent=`
      .phf-records-filter{display:grid;grid-template-columns:minmax(240px,2fr) minmax(170px,1fr) minmax(170px,1fr) auto;gap:12px;align-items:end}
      .phf-records-filter label{display:block;font-size:12px;color:#657a70;margin-bottom:6px}.phf-records-filter input,.phf-records-filter select{width:100%;height:42px;border:1px solid #d6e4dd;border-radius:11px;padding:0 12px;background:#fff;color:#17382d}
      .phf-records-actions{display:flex;gap:8px;flex-wrap:wrap}.phf-records-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
      .phf-records-card{border:1px solid #dbe8e1;border-radius:15px;background:#fff;padding:15px}.phf-records-card span{display:block;color:#6c7f76;font-size:12px;margin-bottom:7px}.phf-records-card b{display:block;color:#07543e;font-size:22px}
      .phf-records-detail-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.phf-records-detail-head h3{margin:0 0 5px;color:#07543e}.phf-records-detail-head p{margin:0;color:#667b71}
      .phf-records-info{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}.phf-records-info>div{border:1px solid #e0ebe5;border-radius:12px;padding:11px 12px;background:#fbfdfc}.phf-records-info span{display:block;color:#6f8179;font-size:12px;margin-bottom:4px}.phf-records-info b{color:#17382d}
      .phf-records-subtabs{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.phf-records-subtabs button{border:1px solid #d4e3dc;background:#f7fbf9;color:#285245;border-radius:999px;padding:9px 14px;font-weight:700;cursor:pointer}.phf-records-subtabs button.active{background:#075b45;color:#fff;border-color:#075b45}
      .phf-records-note{border:1px dashed #cfe0d8;border-radius:13px;padding:12px 14px;background:#f8fbfa;color:#60756b;font-size:13px;line-height:1.55}
      .phf-records-empty{padding:32px 18px;text-align:center;color:#6c7e76}
      .phf-records-bmtt-modal{position:fixed;inset:0;z-index:100003;background:rgba(10,35,27,.45);display:flex;align-items:center;justify-content:center;padding:18px}
      .phf-records-bmtt-card{width:min(680px,100%);max-height:88vh;overflow:auto;background:#fff;border-radius:18px;border:1px solid #d8e5de;box-shadow:0 24px 70px rgba(4,54,39,.25);padding:20px}
      .phf-probation-shell{overflow:hidden}.phf-probation-top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.phf-probation-top h3{margin:0 0 5px}.phf-probation-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}.phf-probation-summary>div{min-width:0;border:1px solid #e0ebe5;border-radius:12px;padding:11px 12px;background:#fbfdfc}.phf-probation-summary span{display:block;color:#6f8179;font-size:12px;margin-bottom:6px}.phf-probation-summary b{display:block;color:#17382d;overflow-wrap:anywhere}
      .phf-probation-section{margin-top:15px;padding-top:15px;border-top:1px solid #e4ede9}.phf-probation-section h4{margin:0 0 10px;color:#17382d;font-size:15px}.phf-probation-conditions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.phf-probation-condition{display:flex;justify-content:space-between;gap:10px;align-items:center;min-width:0;border:1px solid #e0ebe5;border-radius:12px;padding:10px 11px;background:#fff}.phf-probation-condition span:first-child{color:#61746b;font-size:12px}.phf-probation-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:14px}.phf-probation-editor{margin-top:14px;border:1px solid #dce9e3;border-radius:15px;padding:15px;background:#fafdfb}.phf-probation-editor[hidden]{display:none!important}.phf-probation-editor-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px}.phf-probation-editor-head h4{margin:0;color:#17382d}.phf-probation-editor .phf-records-filter{grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.phf-probation-editor .phf-records-filter>div{min-width:0}
      .phf-records-bmtt-card h3{margin:0;color:#07543e}.phf-records-bmtt-meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0}.phf-records-bmtt-meta div{border:1px solid #e0ebe5;border-radius:11px;padding:10px}.phf-records-bmtt-meta span{display:block;color:#6d8077;font-size:12px;margin-bottom:4px}.phf-records-bmtt-actions{display:flex;justify-content:flex-end;gap:9px}
      @media(max-width:1100px){.phf-probation-conditions{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:980px){.phf-probation-summary{grid-template-columns:1fr 1fr}.phf-records-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.phf-records-filter{grid-template-columns:1fr 1fr}.phf-records-info{grid-template-columns:1fr 1fr}}
      @media(max-width:620px){.phf-records-grid,.phf-records-filter,.phf-records-info,.phf-records-bmtt-meta,.phf-probation-summary,.phf-probation-conditions,.phf-probation-editor .phf-records-filter{grid-template-columns:1fr}.phf-records-detail-head{display:block}.phf-records-actions{margin-top:10px}}
    `;
    document.head.appendChild(style);
  }
  function ensureShell(){
    injectCss();
    if(typeof window.phfSetMainNavActive==='function')window.phfSetMainNavActive('profile');
    document.body.classList.add('phf-eval-mode','phf-module-page-mode');
    document.body.classList.remove('phf-guide-standalone-mode','phf-guide-intro-active');
    const mini=document.getElementById('miniStatus');if(mini)mini.textContent='Học viên';
    const title=document.getElementById('contextTitle');if(title)title.textContent='Bạn đang ở: Hồ sơ đào tạo & đánh giá';
    const sub=document.getElementById('contextSub');if(sub)sub.textContent='Tổng hợp bài kiểm tra, phiếu đánh giá, thử việc và cam kết của nhân viên.';
    const action=document.getElementById('contextAction');if(action)action.textContent=role()==='admin'?'Admin':'Quản lý';
  }
  function renderHeader(active){
    return `<div class="phf-eval-work-head phf-lib-hero"><div><span class="phf-lib-kicker">PHF TRAINING HUB</span><h2>Hồ sơ đào tạo &amp; đánh giá</h2><p>Tập trung kết quả kiểm tra, phiếu đánh giá, tình trạng thử việc và cam kết của nhân viên.</p></div><div class="phf-eval-work-role phf-lib-role">${role()==='admin'?'Admin':'Quản lý'}<small>${employees().length} nhân viên trong dữ liệu</small></div></div>${baseTabs(active)}`;
  }
  function metricShell(){
    const emps=employees();
    const withTests=emps.filter(function(e){return employeeTests(e.id).length}).length;
    const withEval=emps.filter(function(e){return employeeEvaluations(e.id).length}).length;
    const withBMTT=emps.filter(function(e){return employeeCommitments(e.id).length}).length;
    return `<div class="phf-records-grid">
      <div class="phf-records-card"><span>Tổng nhân viên</span><b>${emps.length}</b></div>
      <div class="phf-records-card"><span>Đã có kết quả kiểm tra</span><b>${withTests}</b></div>
      <div class="phf-records-card"><span>Đã có phiếu đánh giá</span><b>${withEval}</b></div>
      <div class="phf-records-card"><span>Đã xác nhận BMTT</span><b>${withBMTT}</b></div>
    </div>`;
  }
  function syncFilters(){
    const q=document.getElementById('phfRecordQ');
    const b=document.getElementById('phfRecordBranch');
    const s=document.getElementById('phfRecordStatus');
    state.filters.q=norm(q&&q.value).toLowerCase();
    state.filters.branch=norm(b&&b.value)||'all';
    state.filters.status=norm(s&&s.value)||'all';
  }
  function filteredEmployees(){
    const f=state.filters;
    return employees().filter(function(emp){
      const hay=[emp.fullName,emp.phone,emp.id,emp.branch,emp.department,emp.position].join(' ').toLowerCase();
      if(f.q && hay.indexOf(f.q)<0)return false;
      if(f.branch!=='all' && norm(emp.branch)!==f.branch)return false;
      if(f.status!=='all'){
        const p=probationInfo(emp).cls;
        if(p!==f.status)return false;
      }
      return true;
    }).sort(function(a,b){return norm(a.fullName).localeCompare(norm(b.fullName),'vi')});
  }
  function employeeRows(){
    return filteredEmployees().map(function(emp,idx){
      const tests=testSummary(emp), evals=employeeEvaluations(emp.id), probation=probationInfo(emp), bmtt=bmttStatus(emp), prog=progressSummary(emp.id);
      return `<tr>
        <td>${idx+1}</td>
        <td><b>${esc(emp.fullName||'Chưa có tên')}</b><small>${esc(emp.position||'Chưa cập nhật vị trí')}</small></td>
        <td><b>${esc(emp.phone||'—')}</b><small>${esc(emp.id||'Chưa có mã')}</small></td>
        <td>${esc(emp.branch||'Chưa phân chi nhánh')}</td>
        <td><b>${prog.done}</b><small>mục đã hoàn thành</small></td>
        <td><span class="phf-eval-chip ${tests.cls}">${esc(tests.text)}</span></td>
        <td><b>${evals.length}</b><small>phiếu đã lưu</small></td>
        <td><span class="phf-eval-chip ${probation.cls}">${esc(probation.text)}</span></td>
        <td><span class="phf-eval-chip ${bmtt.cls}">${esc(bmtt.text)}</span></td>
        <td><button class="phf-action-chip primary" type="button" onclick="phfTrainingRecordsOpenEmployee('${esc(emp.id)}')">Xem hồ sơ</button></td>
      </tr>`;
    }).join('');
  }
  function renderEmployees(){
    const branches=branchOptions().map(function(x){return `<option value="${esc(x)}" ${state.filters.branch===x?'selected':''}>${esc(x)}</option>`}).join('');
    return `${renderHeader('employees')}
      ${metricShell()}
      <section class="phf-eval-filter-card"><div class="phf-records-filter">
        <div><label>Tìm nhân viên</label><input id="phfRecordQ" type="search" value="${esc(state.filters.q||'')}" placeholder="Tên, SĐT, mã NV, vị trí"></div>
        <div><label>Chi nhánh</label><select id="phfRecordBranch"><option value="all">Tất cả chi nhánh</option>${branches}</select></div>
        <div><label>Trạng thái thử việc</label><select id="phfRecordStatus">
          <option value="all">Tất cả trạng thái</option>
          <option value="upcoming" ${state.filters.status==='upcoming'?'selected':''}>Đang thử việc</option>
          <option value="due" ${state.filters.status==='due'?'selected':''}>Sắp đến hạn</option>
          <option value="overdue" ${state.filters.status==='overdue'?'selected':''}>Chờ kết luận</option>
          <option value="done" ${state.filters.status==='done'?'selected':''}>Đã có kết quả</option>
          <option value="watch" ${state.filters.status==='watch'?'selected':''}>Cần bổ sung</option>
          <option value="risk" ${state.filters.status==='risk'?'selected':''}>Không đạt</option>
        </select></div>
        <div class="phf-records-actions"><button class="phf-eval-btn primary" type="button" onclick="phfTrainingRecordsApplyFilters()">Lọc</button><button class="phf-eval-btn" type="button" onclick="phfTrainingRecordsResetFilters()">Xóa lọc</button></div>
      </div></section>
      <section class="phf-eval-list-card"><div class="phf-eval-list-head"><div><h3>Danh sách hồ sơ nhân viên</h3><p>Chọn một nhân viên để xem toàn bộ kết quả, đánh giá, thử việc và cam kết.</p></div><span class="phf-eval-result-count">${filteredEmployees().length} kết quả</span></div>
      <div class="phf-eval-table-wrap"><table class="phf-eval-official-table"><thead><tr><th>STT</th><th>Nhân viên</th><th>SĐT / Mã NV</th><th>Chi nhánh</th><th>Tiến độ</th><th>Kiểm tra gần nhất</th><th>Phiếu đánh giá</th><th>Thử việc</th><th>BMTT</th><th>Thao tác</th></tr></thead><tbody>${employeeRows()||'<tr><td colspan="10"><div class="phf-records-empty">Không có hồ sơ phù hợp bộ lọc.</div></td></tr>'}</tbody></table></div></section>`;
  }
  function detailTabs(emp,active){
    return `<div class="phf-records-subtabs">
      <button class="${active==='overview'?'active':''}" onclick="phfTrainingRecordsOpenEmployee('${esc(emp.id)}','overview')">Tổng quan</button>
      <button class="${active==='tests'?'active':''}" onclick="phfTrainingRecordsOpenEmployee('${esc(emp.id)}','tests')">Kết quả kiểm tra</button>
      <button class="${active==='evaluations'?'active':''}" onclick="phfTrainingRecordsOpenEmployee('${esc(emp.id)}','evaluations')">Phiếu đánh giá</button>
      <button class="${active==='probation'?'active':''}" onclick="phfTrainingRecordsOpenEmployee('${esc(emp.id)}','probation')">Thử việc</button>
      <button class="${active==='commitments'?'active':''}" onclick="phfTrainingRecordsOpenEmployee('${esc(emp.id)}','commitments')">Cam kết &amp; xác nhận</button>
    </div>`;
  }
  function testRows(emp){
    const rows=employeeTests(emp.id);
    return rows.map(function(r,idx){
      const st=scoreStatus(r);
      return `<tr><td>${idx+1}</td><td><b>${esc(r.page||'Bài kiểm tra')}</b></td><td>${Number.isFinite(Number(r.score))?esc(r.score):'—'}</td><td>${esc(r.passScore||r.pass_score||80)}</td><td><span class="phf-eval-chip ${st.cls}">${st.text}</span></td><td>${fmtDateTime(dateValue(r))}</td></tr>`;
    }).join('') || '<tr><td colspan="6"><div class="phf-records-empty">Chưa có kết quả kiểm tra.</div></td></tr>';
  }
  function evaluationRows(emp){
    const rows=employeeEvaluations(emp.id);
    return rows.map(function(r,idx){
      const key=r.periodKey||r.period_key||'';
      return `<tr><td>${idx+1}</td><td><b>${esc(evalType(r))}</b><small>${esc(evalPeriod(r))}</small></td><td>${esc(r.evaluator||'Chưa ghi nhận')}</td><td>${esc(evalConclusion(r))}</td><td>${fmtDateTime(dateValue(r))}</td><td><button class="phf-action-chip primary" onclick="phfEvalOpenRecord('${esc(emp.id)}','${esc(key)}','view','profiles')">Xem phiếu</button></td></tr>`;
    }).join('') || '<tr><td colspan="6"><div class="phf-records-empty">Chưa có phiếu đánh giá.</div></td></tr>';
  }
  function commitmentRows(emp){
    const rows=employeeCommitments(emp.id);
    return rows.map(function(r,idx){
      return `<tr><td>${idx+1}</td><td><b>Cam kết bảo mật thông tin</b><small>${esc(r.documentVersion||'PHF-BMTT')}</small></td><td>${fmtDate(r.confirmDate||r.signedAt||r.savedAt)}</td><td><span class="phf-eval-chip done">Đã xác nhận</span></td><td><div class="phf-eval-row-actions"><button class="phf-action-chip" onclick="phfTrainingRecordsViewBMTT('${esc(emp.id)}',${idx})">Xem</button><button class="phf-action-chip primary" onclick="phfTrainingRecordsPrintBMTT('${esc(emp.id)}',${idx})">In</button></div></td></tr>`;
    }).join('') || '<tr><td colspan="5"><div class="phf-records-empty">Nhân viên chưa có cam kết BMTT trên hệ thống.</div></td></tr>';
  }
  function detailBody(emp,tab){
    const tests=employeeTests(emp.id), evals=employeeEvaluations(emp.id), commits=employeeCommitments(emp.id), p=probationInfo(emp), prog=progressSummary(emp.id);
    if(tab==='tests') return `<section class="phf-eval-list-card"><div class="phf-eval-list-head"><div><h3>Kết quả kiểm tra</h3><p>Chỉ hiển thị dữ liệu đã được hệ thống ghi nhận; Quản lý không sửa điểm tại đây.</p></div><span class="phf-eval-result-count">${tests.length} kết quả</span></div><div class="phf-eval-table-wrap"><table class="phf-eval-official-table"><thead><tr><th>STT</th><th>Bài kiểm tra</th><th>Điểm</th><th>Điểm đạt</th><th>Kết quả</th><th>Thời gian</th></tr></thead><tbody>${testRows(emp)}</tbody></table></div></section>`;
    if(tab==='evaluations') return `<section class="phf-eval-list-card"><div class="phf-eval-list-head"><div><h3>Phiếu đánh giá</h3><p>Tổng hợp phiếu tuần, tháng và kết thúc thử việc.</p></div><span class="phf-eval-result-count">${evals.length} phiếu</span></div><div class="phf-eval-table-wrap"><table class="phf-eval-official-table"><thead><tr><th>STT</th><th>Loại phiếu / Kỳ</th><th>Người đánh giá</th><th>Kết luận</th><th>Cập nhật</th><th>Thao tác</th></tr></thead><tbody>${evaluationRows(emp)}</tbody></table></div></section>`;
    if(tab==='probation'){
      const testOk=tests.some(function(r){return scoreStatus(r).ok});
      const evalOk=evals.length>0;
      const finalOk=!!p.finalRecord;
      const bmttOk=employeeCommitments(emp.id).length>0;
      const startOk=!!norm(emp.studyStartDate);
      const editOpen=!!state.probationEditOpen;
      return `<section class="phf-eval-list-card phf-probation-shell">
        <div class="phf-probation-top"><div><h3>Theo dõi thử việc</h3><p>Ngày bắt đầu học là mốc bắt đầu thử việc chính thức.</p></div><span class="phf-eval-chip ${p.cls}">${esc(p.text)}</span></div>
        <div class="phf-probation-summary">
          <div><span>Ngày bắt đầu học/thử việc</span><b>${fmtDate(emp.studyStartDate)}</b></div>
          <div><span>Ngày kết thúc dự kiến</span><b>${fmtDate(p.end)}</b></div>
          <div><span>Trạng thái hiện tại</span><span class="phf-eval-chip ${p.cls}">${esc(p.text)}</span></div>
          <div><span>Người đề xuất</span><b>${esc(p.proposedBy||'Chưa có')}</b></div>
          <div><span>Người xác nhận</span><b>${esc(p.confirmedBy||'Chưa có')}</b></div>
          <div><span>Kết luận</span><b>${esc(p.conclusion||'Chưa có')}</b></div>
        </div>
        <div class="phf-probation-section"><h4>Điều kiện hoàn tất hồ sơ</h4><div class="phf-probation-conditions">
          <div class="phf-probation-condition"><span>Ngày bắt đầu</span><span class="phf-eval-chip ${startOk?'done':'neutral'}">${startOk?'Đã có':'Chưa có'}</span></div>
          <div class="phf-probation-condition"><span>Kết quả kiểm tra</span><span class="phf-eval-chip ${testOk?'done':'watch'}">${testOk?'Đã đạt':(tests.length?'Chưa đạt':'Chưa có')}</span></div>
          <div class="phf-probation-condition"><span>Phiếu đánh giá</span><span class="phf-eval-chip ${evalOk?'done':'neutral'}">${evalOk?'Đã có':'Chưa có'}</span></div>
          <div class="phf-probation-condition"><span>Phiếu kết thúc</span><span class="phf-eval-chip ${finalOk?'done':'neutral'}">${finalOk?'Đã có':'Chưa có'}</span></div>
          <div class="phf-probation-condition"><span>Cam kết BMTT</span><span class="phf-eval-chip ${bmttOk?'done':'watch'}">${bmttOk?'Đã xác nhận':'Cần bổ sung'}</span></div>
        </div></div>
        <div class="phf-records-note" style="margin-top:15px">Quản lý gửi đề xuất; Admin xác nhận kết luận cuối. Nội dung đã xác nhận được lưu để tra cứu lịch sử.</div>
        <div class="phf-probation-actions">${p.finalRecord?`<button class="phf-eval-btn" onclick="phfEvalOpenRecord('${esc(emp.id)}','${esc(p.finalRecord.periodKey||p.finalRecord.period_key||'')}','view','profiles')">Xem phiếu kết thúc</button>`:''}<button class="phf-eval-btn primary" type="button" onclick="phfTrainingRecordsToggleProbationEdit('${esc(emp.id)}')">${editOpen?'Đóng cập nhật':'Cập nhật thử việc'}</button></div>
        <div class="phf-probation-editor" ${editOpen?'':'hidden'}><div class="phf-probation-editor-head"><h4>Cập nhật thông tin thử việc</h4><span class="phf-eval-chip neutral">${role()==='admin'?'Quyền Admin':'Quyền Quản lý'}</span></div>
          <div class="phf-records-filter">
            <div><label>Ngày kết thúc dự kiến</label><input id="phfProbationEnd" type="date" value="${esc(p.end||'')}"></div>
            <div><label>Trạng thái / đề xuất</label><select id="phfProbationStatus"><option value="in_progress" ${p.status==='in_progress'?'selected':''}>Đang thử việc</option><option value="proposed" ${p.status==='proposed'?'selected':''}>Đã có đề xuất</option><option value="passed" ${p.status==='passed'?'selected':''}>Đạt thử việc</option><option value="extended" ${p.status==='extended'?'selected':''}>Gia hạn thử việc</option><option value="failed" ${p.status==='failed'?'selected':''}>Không đạt</option><option value="resigned" ${p.status==='resigned'?'selected':''}>Đã nghỉ</option></select></div>
            <div><label>Kết luận / đề xuất</label><input id="phfProbationConclusion" value="${esc(p.conclusion||'')}" placeholder="Ví dụ: Đề xuất đạt thử việc"></div>
            <div><label>Ghi chú / lý do gia hạn</label><input id="phfProbationNotes" value="${esc(p.notes||'')}" placeholder="Ghi chú nghiệp vụ"></div>
          </div>
          <div class="phf-records-actions" style="margin-top:12px"><button class="phf-eval-btn primary" onclick="phfTrainingRecordsSaveProbation('${esc(emp.id)}',false)">${role()==='admin'?'Lưu cập nhật':'Lưu đề xuất'}</button>${role()==='admin'?`<button class="phf-eval-btn" onclick="phfTrainingRecordsSaveProbation('${esc(emp.id)}',true)">Xác nhận kết luận</button>`:''}</div>
        </div>
      </section>`;
    }
    if(tab==='commitments') return `<section class="phf-eval-list-card"><div class="phf-eval-list-head"><div><h3>Cam kết &amp; xác nhận</h3><p>Hồ sơ đã xác nhận được giữ nguyên để xem và in khi cần.</p></div><span class="phf-eval-result-count">${commits.length} hồ sơ</span></div><div class="phf-eval-table-wrap"><table class="phf-eval-official-table"><thead><tr><th>STT</th><th>Biểu mẫu</th><th>Ngày xác nhận</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${commitmentRows(emp)}</tbody></table></div></section>`;
    const latestTest=latest(tests), latestEval=latest(evals), latestCommit=latest(commits);
    return `<div class="phf-records-grid">
      <div class="phf-records-card"><span>Tiến độ học</span><b>${prog.done} mục</b></div>
      <div class="phf-records-card"><span>Kết quả kiểm tra</span><b>${tests.length} lượt</b></div>
      <div class="phf-records-card"><span>Phiếu đánh giá</span><b>${evals.length} phiếu</b></div>
      <div class="phf-records-card"><span>Cam kết BMTT</span><b>${commits.length?'Đã có':'Chưa có'}</b></div>
    </div>
    <section class="phf-eval-list-card" style="margin-top:14px"><div class="phf-eval-list-head"><div><h3>Thông tin gần nhất</h3><p>Tóm tắt các hồ sơ mới nhất của nhân viên.</p></div></div>
    <div class="phf-records-info"><div><span>Bài kiểm tra gần nhất</span><b>${latestTest?esc(latestTest.page||'Bài kiểm tra'):'Chưa có'}</b></div><div><span>Điểm gần nhất</span><b>${latestTest&&Number.isFinite(Number(latestTest.score))?esc(latestTest.score):'—'}</b></div><div><span>Phiếu đánh giá gần nhất</span><b>${latestEval?esc(evalType(latestEval)):'Chưa có'}</b></div><div><span>Kết luận gần nhất</span><b>${latestEval?esc(evalConclusion(latestEval)):'—'}</b></div><div><span>Tình trạng thử việc</span><b>${esc(p.text)}</b></div><div><span>BMTT gần nhất</span><b>${latestCommit?fmtDate(latestCommit.confirmDate||latestCommit.signedAt||latestCommit.savedAt):'Chưa có'}</b></div></div></section>`;
  }
  function renderDetail(emp,tab){
    return `${renderHeader('detail')}<section class="phf-eval-list-card"><div class="phf-records-detail-head"><div><button class="phf-action-chip" type="button" onclick="phfTrainingRecordsOpen('employees')">← Quay lại danh sách</button><h3 style="margin-top:13px">${esc(emp.fullName||'Hồ sơ nhân viên')}</h3><p>${esc(emp.position||'Chưa cập nhật vị trí')} · ${esc(emp.branch||'Chưa phân chi nhánh')}</p></div></div><div class="phf-records-info"><div><span>Họ tên</span><b>${esc(emp.fullName||'—')}</b></div><div><span>Số điện thoại</span><b>${esc(emp.phone||'—')}</b></div><div><span>Mã nhân viên</span><b>${esc(emp.id||'—')}</b></div><div><span>Bộ phận</span><b>${esc(emp.department||'—')}</b></div><div><span>Vị trí</span><b>${esc(emp.position||'—')}</b></div><div><span>Ngày bắt đầu</span><b>${fmtDate(emp.studyStartDate)}</b></div></div>${detailTabs(emp,tab)}</section>${detailBody(emp,tab)}`;
  }
  function allBMTTRows(){
    const q=norm(state.filters.q).toLowerCase(), branch=state.filters.branch;
    const rows=[];
    employees().forEach(function(emp){
      employeeCommitments(emp.id).forEach(function(record,idx){
        const hay=[emp.fullName,emp.phone,emp.id,emp.branch,emp.position,record.documentVersion].join(' ').toLowerCase();
        if(q&&hay.indexOf(q)<0)return;
        if(branch!=='all'&&norm(emp.branch)!==branch)return;
        rows.push({emp:emp,record:record,index:idx});
      });
    });
    rows.sort(function(a,b){return dateValue(b.record).localeCompare(dateValue(a.record))});
    return rows;
  }
  function renderBMTT(){
    const rows=allBMTTRows();
    const branches=branchOptions().map(function(x){return `<option value="${esc(x)}" ${state.filters.branch===x?'selected':''}>${esc(x)}</option>`}).join('');
    const tableRows=rows.map(function(item,idx){
      const r=item.record, emp=item.emp;
      return `<tr><td>${idx+1}</td><td><b>${esc(emp.fullName)}</b><small>${esc(emp.position||'')} · ${esc(emp.branch||'')}</small></td><td><b>${esc(emp.phone||'—')}</b><small>${esc(emp.id||'—')}</small></td><td>${fmtDate(r.confirmDate||r.signedAt||r.savedAt)}</td><td>${esc(r.documentVersion||'PHF-BMTT')}</td><td><span class="phf-eval-chip done">Đã xác nhận</span></td><td><div class="phf-eval-row-actions"><button class="phf-action-chip" onclick="phfTrainingRecordsViewBMTT('${esc(emp.id)}',${item.index})">Xem</button><button class="phf-action-chip primary" onclick="phfTrainingRecordsPrintBMTT('${esc(emp.id)}',${item.index})">In</button></div></td></tr>`;
    }).join('');
    return `${renderHeader('bmtt')}<div class="phf-records-grid"><div class="phf-records-card"><span>Tổng cam kết đã lưu</span><b>${commitments().length}</b></div><div class="phf-records-card"><span>Nhân viên đã cam kết</span><b>${new Set(commitments().map(employeeIdOf)).size}</b></div><div class="phf-records-card"><span>Nhân viên chưa có BMTT</span><b>${Math.max(0,employees().length-new Set(commitments().map(employeeIdOf)).size)}</b></div><div class="phf-records-card"><span>Biểu mẫu hiện có</span><b>${new Set(commitments().map(function(x){return x.documentVersion||'PHF-BMTT'})).size}</b></div></div>
      <section class="phf-eval-filter-card"><div class="phf-records-filter" style="grid-template-columns:minmax(260px,2fr) minmax(180px,1fr) auto"><div><label>Tìm cam kết</label><input id="phfRecordQ" value="${esc(state.filters.q||'')}" placeholder="Tên, SĐT, mã NV, phiên bản"></div><div><label>Chi nhánh</label><select id="phfRecordBranch"><option value="all">Tất cả chi nhánh</option>${branches}</select></div><div class="phf-records-actions"><button class="phf-eval-btn primary" onclick="phfTrainingRecordsApplyFilters('bmtt')">Lọc</button><button class="phf-eval-btn" onclick="phfTrainingRecordsResetFilters('bmtt')">Xóa lọc</button></div></div></section>
      <section class="phf-eval-list-card"><div class="phf-eval-list-head"><div><h3>Cam kết BMTT tập trung</h3><p>Tra cứu, xem lại và in đúng bản cam kết nhân viên đã xác nhận.</p></div><span class="phf-eval-result-count">${rows.length} hồ sơ</span></div><div class="phf-eval-table-wrap"><table class="phf-eval-official-table"><thead><tr><th>STT</th><th>Nhân viên</th><th>SĐT / Mã NV</th><th>Ngày xác nhận</th><th>Phiên bản</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${tableRows||'<tr><td colspan="7"><div class="phf-records-empty">Chưa có cam kết BMTT phù hợp.</div></td></tr>'}</tbody></table></div></section>`;
  }
  function mergeBMTTRecord(emp,record){
    return Object.assign({
      fullName:emp.fullName||'',
      birthday:emp.birthday||'',
      phone:emp.phone||'',
      position:emp.position||emp.department||'',
      branch:emp.branch||'',
      signName:record.signName||record.confirmedName||emp.fullName||'',
      signPhone:record.signPhone||record.phone||emp.phone||'',
      confirmDate:record.confirmDate||String(record.signedAt||record.savedAt||'').slice(0,10),
      checkedCount:record.checkedCount||record.requiredCheckCount||0,
      requiredCheckCount:record.requiredCheckCount||record.checkedCount||0
    },record);
  }
  async function render(view,employeeId,tab){
    if(!canView()){
      if(typeof window.phfToast==='function')window.phfToast('Chức năng này dành cho Quản lý và Admin.','error');
      return false;
    }
    ensureShell();
    if(typeof window.phfEnsureEvaluationDataReady==='function'){
      try{await window.phfEnsureEvaluationDataReady(true)}catch(e){}
    }else if(typeof window.phfRefreshTrainingData==='function'){
      try{await window.phfRefreshTrainingData({force:false})}catch(e){}
    }
    setMode(view,employeeId,tab);
    const host=document.getElementById('mainLesson');
    if(!host)return false;
    if(view==='detail'){
      const emp=employeeById(employeeId);
      if(!emp){state.view='employees';host.innerHTML=`<section class="phf-eval-workspace">${renderEmployees()}</section>`;return true}
      host.innerHTML=`<section class="phf-eval-workspace phf-eval-content-enter">${renderDetail(emp,tab||'overview')}</section>`;
    }else if(view==='bmtt'){
      host.innerHTML=`<section class="phf-eval-workspace phf-eval-content-enter">${renderBMTT()}</section>`;
    }else{
      host.innerHTML=`<section class="phf-eval-workspace phf-eval-content-enter">${renderEmployees()}</section>`;
    }
    window.scrollTo({top:0,behavior:'auto'});
    return true;
  }

  window.phfTrainingRecordsOpen=function(view){
    return render(view||'employees','','overview');
  };
  window.phfTrainingRecordsOpenEmployee=function(employeeId,tab){
    if(state.employeeId!==employeeId || (tab||'overview')!=='probation') state.probationEditOpen=false;
    return render('detail',employeeId,tab||'overview');
  };
  window.phfTrainingRecordsApplyFilters=function(view){
    syncFilters();
    return render(view||state.view,state.employeeId,state.detailTab);
  };
  window.phfTrainingRecordsResetFilters=function(view){
    state.filters={q:'',branch:'all',status:'all'};
    return render(view||state.view,state.employeeId,state.detailTab);
  };
  window.phfTrainingRecordsLeave=function(){clearMode();return true};
  window.phfTrainingRecordsShouldResume=function(){return canView() && !!restoreMode()};
  window.phfTrainingRecordsResume=function(){
    const saved=restoreMode();
    if(!saved)return false;
    return render(saved.view,saved.employeeId,saved.detailTab);
  };
  window.phfTrainingRecordsViewBMTT=function(employeeId,index){
    const emp=employeeById(employeeId), rows=employeeCommitments(employeeId), record=rows[index];
    if(!emp||!record)return;
    const merged=mergeBMTTRecord(emp,record);
    const old=document.getElementById('phfTrainingBMTTModal');if(old)old.remove();
    const wrap=document.createElement('div');wrap.id='phfTrainingBMTTModal';wrap.className='phf-records-bmtt-modal';
    wrap.innerHTML=`<div class="phf-records-bmtt-card"><div class="phf-records-detail-head"><div><h3>Cam kết bảo mật thông tin</h3><p>${esc(emp.fullName)} · ${esc(record.documentVersion||'PHF-BMTT')}</p></div><button class="phf-eval-row-btn" data-close>Đóng</button></div><div class="phf-records-bmtt-meta"><div><span>Họ tên người cam kết</span><b>${esc(merged.signName||merged.fullName)}</b></div><div><span>Số điện thoại xác nhận</span><b>${esc(merged.signPhone||merged.phone||'—')}</b></div><div><span>Ngày xác nhận</span><b>${fmtDate(merged.confirmDate||merged.signedAt)}</b></div><div><span>Phiên bản biểu mẫu</span><b>${esc(merged.documentVersion||'PHF-BMTT')}</b></div><div><span>Vị trí/Bộ phận</span><b>${esc(merged.position||'—')}</b></div><div><span>Chi nhánh</span><b>${esc(merged.branch||'—')}</b></div></div><div class="phf-records-note">Đây là hồ sơ xác nhận đã lưu trên PHF Training Hub. Khi in, hệ thống dựng lại đúng nội dung mẫu BMTT cùng thông tin xác nhận của nhân viên.</div><div class="phf-records-bmtt-actions" style="margin-top:16px"><button class="phf-eval-btn" data-close>Đóng</button><button class="phf-eval-btn primary" data-print>In bản cam kết</button></div></div>`;
    wrap.addEventListener('click',function(e){if(e.target===wrap||e.target.closest('[data-close]'))wrap.remove();if(e.target.closest('[data-print]'))window.phfTrainingRecordsPrintBMTT(employeeId,index)});
    document.body.appendChild(wrap);
  };

  window.phfTrainingRecordsToggleProbationEdit=function(employeeId){
    state.probationEditOpen=!state.probationEditOpen;
    return window.phfTrainingRecordsOpenEmployee(employeeId,'probation');
  };

  window.phfTrainingRecordsSaveProbation=async function(employeeId,confirm){
    const emp=employeeById(employeeId);
    if(!emp)return;
    const payload={
      action:'saveProbation',
      employee:{id:employeeId},
      probationRecord:{
        employeeId:employeeId,
        expectedEndDate:norm(document.getElementById('phfProbationEnd')&&document.getElementById('phfProbationEnd').value),
        status:norm(document.getElementById('phfProbationStatus')&&document.getElementById('phfProbationStatus').value)||'in_progress',
        conclusion:norm(document.getElementById('phfProbationConclusion')&&document.getElementById('phfProbationConclusion').value),
        notes:norm(document.getElementById('phfProbationNotes')&&document.getElementById('phfProbationNotes').value),
        extensionReason:norm(document.getElementById('phfProbationNotes')&&document.getElementById('phfProbationNotes').value),
        confirm:!!confirm
      }
    };
    try{
      const response=await fetch('/api/data',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload)});
      const result=await response.json().catch(function(){return{}});
      if(!response.ok||!result.ok)throw new Error(result.error||'Chưa thể lưu thử việc.');
      if(typeof window.phfRefreshTrainingData==='function')await window.phfRefreshTrainingData({force:true});
      if(typeof window.phfToast==='function')window.phfToast(confirm?'Đã xác nhận kết luận thử việc.':'Đã lưu thông tin thử việc.','success');
      await window.phfTrainingRecordsOpenEmployee(employeeId,'probation');
      try{window.dispatchEvent(new CustomEvent('phf-notifications-refresh'))}catch(e){}
    }catch(e){
      if(typeof window.phfToast==='function')window.phfToast(e.message||'Chưa thể lưu thử việc.','error');
    }
  };

  window.phfTrainingRecordsPrintBMTT=function(employeeId,index){
    const emp=employeeById(employeeId), rows=employeeCommitments(employeeId), record=rows[index];
    if(!emp||!record)return;
    const merged=mergeBMTTRecord(emp,record);
    if(typeof window.phfOpenBMTTPrintDocument==='function')return window.phfOpenBMTTPrintDocument(merged);
    if(typeof window.phfToast==='function')window.phfToast('Chức năng in BMTT chưa sẵn sàng.','error');
  };
})();
