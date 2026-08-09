'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sql=read('scripts/PHF_KNL_SURVEY_V1_1.49.0.sql');
const service=read('lib/knl-surveys.js');
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

// UI/route: parent sidebar + sub-navigation, deep link and item-focused validation.
has(ui,/label:'Khảo sát & đánh giá'/,'parent Survey domain missing');
has(ui,/Đợt khảo sát[\s\S]+Kết quả khảo sát/,'Survey sub-navigation missing');
has(ui,/scrollIntoView\(\{behavior:'smooth'/,'first invalid item navigation missing');
has(ui,/setTimeout\(function\(\)\{saveTicketFromForm\(root,false,true\);\},900\)/,'safe autosave debounce missing');
has(ui,/d\.levels\.map/,'dynamic N levels missing');
has(ui,/data-needs-review/,'needs-review aggregation filter missing');
['/hv/knl/khao-sat','/ql/knl/khao-sat','/admin/knl/khao-sat','/hv/knl/ket-qua-khao-sat','/ql/knl/ket-qua-khao-sat','/admin/knl/ket-qua-khao-sat'].forEach(route=>has(router,new RegExp(route.replace(/\//g,'\\/')),'route missing '+route));

const {normalizeResponses}=require('../lib/knl-surveys');
assert.throws(()=>normalizeResponses([{itemId:'00000000-0000-4000-8000-000000000001',suitability:'UNCLEAR',comment:''}]),e=>e.code==='KNL_SURVEY_COMMENT_REQUIRED');
assert.strictEqual(normalizeResponses([{itemId:'00000000-0000-4000-8000-000000000001',suitability:'SUITABLE',comment:''}])[0].suitability,'SUITABLE');

console.log('PASS KNL Survey V1 contracts: schema, idempotency, dynamic levels, validation, audit, deadline, scope, API parity, routes and no forbidden writes.');
