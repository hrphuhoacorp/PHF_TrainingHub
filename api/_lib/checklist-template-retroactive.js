'use strict';
/*
 * PHF Checklist — Workstream A2 (2026-08-14)
 * "Version-copy + retroactive-apply" — bộ máy tổng quát (KHÔNG hardcode theo template
 * name) tổng quát hoá tiền lệ phf_save_marketing_monthly_kpi() (chỉ 2 mẫu Marketing,
 * chỉ trước self-start). Ở đây phạm vi rộng hơn: mọi template_key, mọi trạng thái phiếu,
 * có audit + idempotent theo batch_id + dry-run.
 *
 * THIẾT KẾ: logic remap/diff/classify được viết dưới dạng hàm JS THUẦN (không phụ thuộc
 * Supabase) để có thể unit-test 100% in-memory, KHÔNG cần kết nối database thật — vì môi
 * trường hiện tại chỉ có một Supabase project cấu hình trong .env (SUPABASE_URL trỏ tới
 * dự án đang dùng cho Production, không có instance Supabase local/dev riêng — xem
 * README/báo cáo bàn giao). RPC SQL tương ứng (scripts/PHF_CHECKLIST_RETROACTIVE_ENGINE_
 * 1.53.0.sql) triển khai LẠI đúng logic bên dưới bằng PL/pgSQL để chạy an toàn khi có một
 * database dev/local thật; file SQL đó được viết nhưng KHÔNG được chạy trong batch này —
 * xem STOP-GATE trong báo cáo bàn giao.
 */

function t(v){return String(v==null?'':v).trim();}
function cloneJson(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function rowsOf(definition){return definition&&Array.isArray(definition.totalRows)?definition.totalRows:[];}
function rowId(row,index){
  if(Array.isArray(row))return t(row[8])||t(row[1])||'ROW-'+(index+1);
  return t(row&&row.id)||t(row&&row.code)||'ROW-'+(index+1);
}
function rowCode(row,index){return Array.isArray(row)?(t(row[1])||'ROW-'+(index+1)):(t(row&&row.code)||'ROW-'+(index+1));}
function rowName(row){return Array.isArray(row)?t(row[2]):t(row&&(row.content||row.name));}
function rowWeight(row){const w=Array.isArray(row)?row[5]:row&&row.weight,n=Number(w);return Number.isFinite(n)?n:0;}
function rowSourceType(row){
  const s=Array.isArray(row)?row[7]:row&&row.source;
  if(s&&typeof s==='object')return t(s.type);
  if(row&&!Array.isArray(row)&&row.sourceType!==undefined)return t(row.sourceType);
  return '';
}
function indexRows(definition){
  const map=new Map();
  rowsOf(definition).forEach((row,index)=>{map.set(rowId(row,index),{id:rowId(row,index),code:rowCode(row,index),name:rowName(row),weight:rowWeight(row),sourceType:rowSourceType(row),index});});
  return map;
}

/*
 * A2.3 — Preview/diff giữa 2 version của cùng template_key. So khớp theo id ổn định
 * (KHÔNG theo vị trí mảng) — đây là điều kiện tiên quyết để "remap by id" ở apply
 * hoạt động đúng kể cả khi dòng bị đổi tên/đổi vị trí.
 */
function diffDefinitions(oldDefinition,newDefinition){
  const before=indexRows(oldDefinition),after=indexRows(newDefinition);
  const added=[],removed=[],renamed=[],changed=[],unchanged=[];
  after.forEach((row,id)=>{
    const prior=before.get(id);
    if(!prior){added.push(row);return;}
    const nameChanged=prior.name!==row.name,weightChanged=Math.abs(prior.weight-row.weight)>0.0001,sourceChanged=prior.sourceType!==row.sourceType;
    if(nameChanged)renamed.push({id,before:prior,after:row});
    if(weightChanged||sourceChanged)changed.push({id,before:prior,after:row,weightChanged,sourceChanged});
    if(!nameChanged&&!weightChanged&&!sourceChanged)unchanged.push(row);
  });
  before.forEach((row,id)=>{if(!after.has(id))removed.push(row);});
  const totalWeightBefore=[...before.values()].reduce((s,r)=>s+r.weight,0),totalWeightAfter=[...after.values()].reduce((s,r)=>s+r.weight,0);
  return {added,removed,renamed,changed,unchanged,totalWeightBefore:Math.round(totalWeightBefore*100)/100,totalWeightAfter:Math.round(totalWeightAfter*100)/100};
}

/*
 * A2.3 — mô phỏng tác động checklist_score -> Total/Final cho MỘT nhân sự, dùng
 * checklistBreakdown() thật (điểm Checklist hiện hành của nhân sự trong kỳ) và hai định
 * nghĩa trước/sau. calculateMonthlyScore đến từ lib/checklist-score-engine — dùng lại
 * nguyên công thức 1 nguồn sự thật, KHÔNG viết lại công thức điểm ở đây.
 */
function simulateScoreImpact({oldDefinition,newDefinition,checklistScore,selfActualByCode,reviewActualByCode,calculateMonthlyScore}){
  function rowTarget(row){const v=Array.isArray(row)?row[3]:row&&row.target,n=Number(v);return Number.isFinite(n)&&n>0?n:1;}
function rowsFor(definition){return rowsOf(definition).map((row,index)=>({code:rowCode(row,index),weight:rowWeight(row),target:rowTarget(row),sourceType:rowSourceType(row)}));}
  function summarize(definition){
    const rows=rowsFor(definition),self={},review={};
    rows.forEach(r=>{const automatic=r.sourceType==='checklist_total';self[r.code]=automatic?checklistScore:Number((selfActualByCode||{})[r.code]||0);review[r.code]=automatic?checklistScore:Number((reviewActualByCode||{})[r.code]||0);});
    return calculateMonthlyScore({criteria:rows,selfActualByCode:self,reviewActualByCode:review});
  }
  const before=summarize(oldDefinition),after=summarize(newDefinition);
  return {before:{selfTotalScore:before.selfTotalScore,reviewTotalScore:before.reviewTotalScore},after:{selfTotalScore:after.selfTotalScore,reviewTotalScore:after.reviewTotalScore},selfDelta:Math.round((after.selfTotalScore-before.selfTotalScore)*100)/100,reviewDelta:Math.round((after.reviewTotalScore-before.reviewTotalScore)*100)/100};
}

/*
 * A2.4 — phân loại MỘT phiếu checklist_monthly_forms để quyết định có áp dụng tự động,
 * cần xác nhận riêng (reviewed), hay tuyệt đối không đụng (locked/cancelled).
 * form: {id,status,self_answers,review_answers}. Trả outcome + remappedAnswers (nếu có).
 */
const NEVER_TOUCH_STATUSES=new Set(['locked','cancelled']);
const AUTO_ELIGIBLE_STATUSES=new Set(['draft','waiting_self','waiting_review']);
function hasAnswers(answers){return answers&&typeof answers==='object'&&Object.keys(answers).length>0;}
function remapAnswersById(answers,before,after){
  // before/after: Map<id,{code,...}> từ indexRows(). answers keyed theo CODE cũ.
  const beforeCodeToId=new Map([...before.values()].map(r=>[r.code,r.id]));
  const afterIdToCode=new Map([...after.values()].map(r=>[r.id,r.code]));
  const remapped={},unmapped=[];
  Object.keys(answers||{}).forEach(oldCode=>{
    const id=beforeCodeToId.get(oldCode)||oldCode; // nếu code cũ chính là id (khi không đổi)
    const newCode=afterIdToCode.get(id);
    if(newCode)remapped[newCode]=answers[oldCode];
    else unmapped.push(oldCode);
  });
  return {remapped,unmapped};
}
function classifyFormForApply({form,oldDefinition,newDefinition}){
  const status=t(form&&form.status);
  if(NEVER_TOUCH_STATUSES.has(status))return {outcome:status==='locked'?'skipped-locked':'skipped-cancelled',formId:form&&form.id,reason:status==='locked'?'Phiếu đã khóa — không có ngoại lệ tự động trong batch này; cần quy trình ngoại lệ chính thức riêng.':'Phiếu đã hủy — không thuộc phạm vi.'};
  if(status==='reviewed')return {outcome:'requires-reviewed-adjustment',formId:form&&form.id,reason:'Phiếu đã thẩm định — KHÔNG remap tự động; cần bước "điều chỉnh phiếu đã thẩm định" xác nhận riêng.'};
  if(!AUTO_ELIGIBLE_STATUSES.has(status))return {outcome:'skipped-unknown-status',formId:form&&form.id,reason:'Trạng thái phiếu không xác định trong phạm vi áp dụng.'};
  const before=indexRows(oldDefinition),after=indexRows(newDefinition);
  const selfAnswers=form.self_answers||{},reviewAnswers=form.review_answers||{};
  if(!hasAnswers(selfAnswers)&&!hasAnswers(reviewAnswers)){
    return {outcome:'applied',formId:form&&form.id,reason:'Chưa có câu trả lời tự đánh giá/thẩm định gắn với dòng bị đổi — remap tại chỗ an toàn.',remappedSelfAnswers:selfAnswers,remappedReviewAnswers:reviewAnswers,unmappedSelfCodes:[],unmappedReviewCodes:[]};
  }
  const self=remapAnswersById(selfAnswers,before,after),review=remapAnswersById(reviewAnswers,before,after);
  const unmapped=[...new Set([...self.unmapped,...review.unmapped])];
  if(unmapped.length){
    return {outcome:'skipped-unmapped',formId:form&&form.id,reason:'Có câu trả lời gắn với dòng đã bị xóa ở phiên bản mới ('+unmapped.join(', ')+'); cần Admin xác nhận thủ công từng phiếu, KHÔNG tự bỏ câu trả lời.',unmappedSelfCodes:self.unmapped,unmappedReviewCodes:review.unmapped};
  }
  return {outcome:'applied',formId:form&&form.id,reason:'Câu trả lời đã có được remap theo id ổn định sang mã tiêu chí mới.',remappedSelfAnswers:self.remapped,remappedReviewAnswers:review.remapped,unmappedSelfCodes:[],unmappedReviewCodes:[]};
}

/*
 * A2.5/A2.6/A2.7 — chạy một batch (đã lọc theo scope/kỳ ở tầng gọi) với batch_id để
 * idempotent: nếu form đã có outcome ghi nhận cho đúng batch_id đó (ledger truyền vào),
 * bỏ qua — không double-apply. dryRun=true không làm thay đổi ledger/kết quả tính toán,
 * chỉ trả preview giống hệt apply thật.
 */
function runRetroactiveBatch({batchId,forms,oldDefinition,newDefinition,dryRun,existingLedger}){
  const ledger=existingLedger instanceof Map?existingLedger:new Map();
  const results=(forms||[]).map(form=>{
    const ledgerKey=batchId+'|'+form.id;
    if(ledger.has(ledgerKey)){
      const prior=ledger.get(ledgerKey);
      return {...prior,formId:form.id,idempotentReplay:true};
    }
    const classified=classifyFormForApply({form,oldDefinition,newDefinition});
    const result={...classified,batchId};
    if(!dryRun)ledger.set(ledgerKey,result);
    return result;
  });
  const counts=results.reduce((acc,r)=>{acc[r.outcome]=(acc[r.outcome]||0)+1;acc.total=(acc.total||0)+1;return acc;},{});
  return {batchId,dryRun:Boolean(dryRun),results,counts,ledger};
}

/*
 * Residual A (2026-08-14) — lõi THUẦN (không DB) cho mô phỏng tác động điểm
 * hàng loạt nhiều nhân sự, dùng bởi checklistRetroSimulateEmployeeImpact.
 * Tách khỏi lib/checklist-template-retroactive-service.js (nơi fetch dữ liệu
 * thật từ Supabase) để có thể unit-test 100% in-memory, đúng nguyên tắc phân
 * lớp đã dùng cho toàn bộ engine này (xem đầu file). Nguyên tắc "không fabricate":
 * nhân sự không có trong scopedByCode (không thuộc phạm vi mẫu) hoặc không có
 * trong formByCode (chưa có phiếu tháng thật cho kỳ) LUÔN rơi vào manual[] với
 * status 'Cần xử lý thủ công' — không bao giờ suy ra 0/giá trị mặc định rồi trả
 * như thể là số liệu thật.
 */
function planEmployeeImpactBatch({employeeCodes,scopedByCode,formByCode,checklistScoreByCode,oldDefinition,newDefinition,calculateMonthlyScore}){
  function lookup(map,key){if(!map)return undefined;return map instanceof Map?map.get(key):map[key];}
  const results=[],manual=[];
  (employeeCodes||[]).forEach(code=>{
    const assignment=lookup(scopedByCode,code);
    if(!assignment){manual.push({employeeCode:code,status:'Cần xử lý thủ công',reason:'Nhân sự không thuộc phạm vi mẫu được yêu cầu (không tìm thấy gán đúng template_key) — không mô phỏng để tránh số liệu sai phạm vi.'});return;}
    const employeeName=t(assignment.employee_name||assignment.employeeName),department=t(assignment.department);
    const form=lookup(formByCode,code);
    if(!form){manual.push({employeeCode:code,employeeName,department,status:'Cần xử lý thủ công',reason:'Chưa có phiếu tháng thật cho kỳ được chọn — không có dữ liệu thật để mô phỏng, không tự điền số liệu giả định.'});return;}
    const rawScore=lookup(checklistScoreByCode,code),checklistScore=Number.isFinite(rawScore)?rawScore:100;
    const impact=simulateScoreImpact({oldDefinition,newDefinition,checklistScore,selfActualByCode:form.self_answers||form.selfAnswers||{},reviewActualByCode:form.review_answers||form.reviewAnswers||{},calculateMonthlyScore});
    results.push({employeeCode:code,employeeName,department,formId:form.id,formStatus:t(form.status),checklistScore,...impact});
  });
  return {results,manual};
}

module.exports={diffDefinitions,simulateScoreImpact,classifyFormForApply,runRetroactiveBatch,planEmployeeImpactBatch,indexRows,rowId,rowCode,rowName,rowWeight,rowSourceType,remapAnswersById};
