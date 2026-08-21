'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sql=read('scripts/PHF_KNL_SURVEY_V1_1.49.0.sql');
const service=read('api/_lib/knl-surveys.js');
const api=read('api/data.js');
const server=read('server.js');
const ui=read('assets/js/knl/phf-knl-app.js');
const router=read('assets/js/phf-url-router.js');

function has(source,pattern,message){assert(pattern.test(source),message);}

// Data model + concurrent/idempotent open.
['knl_survey_campaigns','knl_survey_campaign_versions','knl_survey_campaign_targets','knl_survey_tickets','knl_survey_responses','knl_survey_submission_history','knl_survey_audit'].forEach(t=>has(sql,new RegExp('create table if not exists public\\.'+t),t+' missing'));
has(sql,/unique\(campaign_id,employee_code,version_id\)/,'employee + version duplicate guard missing');
has(sql,/for update[\s\S]+on conflict\(campaign_id,employee_code,version_id\) do nothing/i,'open must lock and be idempotent');
has(sql,/join public\.knl_framework_assignments[\s\S]+a\.status='active'/,'ticket generation must follow real assignments');
has(sql,/column_type='level'[\s\S]+level_number=/,'dynamic selected level must belong to version');
has(sql,/KNL_SURVEY_COMMENT_REQUIRED/,'backend/database comment rule missing');
has(sql,/KNL_SURVEY_INCOMPLETE/,'submit completeness gate missing');
has(sql,/SUBMIT','RESUBMIT/,'revision actions missing');
has(sql,/now\(\)>c\.ends_at/,'deadline lock missing');
has(sql,/KNL_SURVEY_REFERENCE_DELETE_GUARD/,'survey delete guard missing');
has(sql,/v_old=to_jsonb\(old\)[\s\S]+v_old->>'version_id'/,'polymorphic delete guard must not access OLD.version_id directly');
has(sql,/revoke all on public\.knl_survey_campaigns/,'RLS/service-role-only posture missing');

// Permission and API bypass contracts.
has(service,/a\.role!=='admin'.+KNL_SURVEY_ADMIN_REQUIRED/,'campaign admin guard missing');
has(service,/subjectMatchesScope/,'TBP people_scope enforcement missing');
has(service,/p_employee_code:a\.employeeCode/,'NV own-only identity binding missing');
has(service,/db\.rpc\('knl_clone_version'/,'clone-to-new-Draft action missing');
assert(!/checklist_(tasks|monthly|violations|scores).*\.(insert|update|upsert)/i.test(service),'Survey must not write Checklist');
assert(!/(income|compensation).*(insert|update|upsert)/i.test(service),'Survey must not write income/compensation');

['getKnlSurveySetup','saveKnlSurveyCampaign','openKnlSurveyCampaign','closeKnlSurveyCampaign','listKnlSurveyCampaigns','getKnlSurveyTicket','saveKnlSurveyTicket','getKnlSurveyResults','cloneKnlSurveyVersionToDraft'].forEach(action=>{has(api,new RegExp("action==='"+action+"'"),'Vercel API missing '+action);has(server,new RegExp("action==='"+action+"'"),'Node API missing '+action);});

// SURVEY IDENTITY RESIDUAL fix (2026-08-12): actor() từng ưu tiên
// session.employeeId (internal Training Hub id kiểu "hv-xxxx") trước
// session.account.employeeCode (mã Organization Master chuẩn "PHFxxx") —
// đúng pattern bug đã fix ở lib/knl-grade-proposals.js/lib/knl-permissions.js
// (commit 9bc4bae) nhưng module Survey có actor() cục bộ riêng nên không tự
// thừa hưởng fix. Static: xác nhận pattern nguy hiểm đã biến mất và pattern
// canonical đã áp dụng. Functional: gọi thẳng actor() thật (export riêng cho
// test, không đổi hành vi export khác) để chứng minh case A/B/C/D/E.
assert(!/employeeCode:text\(session\?\.employeeId/.test(service),'actor() không được còn ưu tiên session.employeeId (legacy Training Hub internal id) trước employeeCode chuẩn — SURVEY IDENTITY RESIDUAL 2026-08-12');
has(service,/employeeCode:text\(session\?\.employeeCode\|\|session\?\.employee_code\|\|session\?\.account\?\.employeeCode\|\|session\?\.account\?\.employee_code\)\.toUpperCase\(\)/,'actor() phải resolve employeeCode theo đúng canonical pattern (employeeCode/employee_code/account.employeeCode/account.employee_code)');
{
  const { actor } = require('../api/_lib/knl-surveys');
  // Case A — account resolve được employeeCode chuẩn dù session còn mang legacy employeeId.
  assert(
    actor({ employeeId: 'hv-0934510194', account: { id: 'acct1', employeeCode: 'phf012' }, role: 'employee' }).employeeCode === 'PHF012',
    'Case A: actor().employeeCode phải là PHF012 (account.employeeCode, uppercase) dù session.employeeId mang giá trị legacy hv-0934510194'
  );
  assert(
    actor({ employeeId: 'hv-999', employeeCode: 'phf034', role: 'employee' }).employeeCode === 'PHF034',
    'Case A2: session.employeeCode (top-level, không qua account) cũng phải thắng session.employeeId legacy'
  );
  // Case B — self ownership: getKnlSurveyTicket/saveKnlSurveyTicket so a.employeeCode
  // với t.employee_code (xem dòng "p_employee_code:a.employeeCode" và
  // "a.employeeCode!==t.employee_code" trong lib/knl-surveys.js) bằng đúng actor()
  // này — chứng minh actor() resolve đúng tức là self-submit/self-view sẽ khớp.
  const selfSession = { employeeId: 'hv-0934510194', account: { id: 'acct1', employeeCode: 'phf012' }, role: 'employee' };
  assert(
    actor(selfSession).employeeCode === 'PHF012',
    'Case B: nhân viên có session.employeeId khác employeeCode chuẩn phải vẫn được nhận diện đúng là chủ phiếu PHF012 (không còn mismatch giả gây KNL_SURVEY_OWN_ONLY/readOnly sai)'
  );
  // Case C — Survey V1 không có khái niệm evaluator/reviewer/assessor; fix
  // employeeCode không được kéo theo hoặc cần thêm bất kỳ role đánh giá nào,
  // và role resolution (dùng cho admin-gate) phải giữ nguyên hành vi.
  assert(!/evaluator|reviewer|assessor/i.test(service), 'Survey actor()/service không được tự thêm khái niệm evaluator/reviewer/assessor chưa có trong backend');
  assert(actor({ employeeId: 'hv-1', account: { employeeCode: 'phf099' }, role: 'manager' }).role === 'manager', 'Case C: role resolution không bị ảnh hưởng bởi fix employeeCode');
  // Case D — audit id/name (p_actor_id/p_actor_name) vẫn resolve từ account.id/
  // account.name như cũ, không bị đổi bởi fix employeeCode; raw audit rows cũ
  // trong DB không bị rewrite (fix chỉ đổi cách resolve tại request-time).
  assert(actor({ account: { id: 'acct-99', name: 'Admin X' }, sub: 'sub-99', role: 'admin' }).id === 'acct-99', 'Case D: audit id (created_by/updated_by) vẫn resolve từ account.id, không đổi bởi fix employeeCode');
  assert(actor({ account: { name: 'Admin X' }, role: 'admin' }).name === 'Admin X', 'Case D: audit name không đổi bởi fix employeeCode');
  // Case E — Admin gate (a.role!=='admin' -> KNL_SURVEY_ADMIN_REQUIRED, dòng 32)
  // dùng actor().role, không dùng employeeCode -> không regression quyền Admin.
  assert(actor({ role: 'ADMIN' }).role === 'admin', 'Case E: role vẫn lowercase đúng, Admin-gate (a.role!==\'admin\') không regression bởi fix employeeCode');
}

// UI/route: parent sidebar + sub-navigation, deep link and item-focused validation.
has(ui,/label:'Khảo sát & đánh giá'/,'parent Survey domain missing');
has(ui,/Đợt khảo sát[\s\S]+Kết quả khảo sát/,'Survey sub-navigation missing');
has(ui,/scrollIntoView\(\{behavior:'smooth'/,'first invalid item navigation missing');
has(ui,/setTimeout\(function\(\)\{saveTicketFromForm\(root,false,true\);\},900\)/,'safe autosave debounce missing');
has(ui,/d\.levels\.map/,'dynamic N levels missing');
has(ui,/data-needs-review/,'needs-review aggregation filter missing');
['/hv/knl/khao-sat','/ql/knl/khao-sat','/admin/knl/khao-sat','/hv/knl/ket-qua-khao-sat','/ql/knl/ket-qua-khao-sat','/admin/knl/ket-qua-khao-sat'].forEach(route=>has(router,new RegExp(route.replace(/\//g,'\\/')),'route missing '+route));

const {normalizeResponses}=require('../api/_lib/knl-surveys');
assert.throws(()=>normalizeResponses([{itemId:'00000000-0000-4000-8000-000000000001',suitability:'UNCLEAR',comment:''}]),e=>e.code==='KNL_SURVEY_COMMENT_REQUIRED');
assert.strictEqual(normalizeResponses([{itemId:'00000000-0000-4000-8000-000000000001',suitability:'SUITABLE',comment:''}])[0].suitability,'SUITABLE');

console.log('PASS KNL Survey V1 contracts: schema, idempotency, dynamic levels, validation, audit, deadline, scope, API parity, routes and no forbidden writes.');
