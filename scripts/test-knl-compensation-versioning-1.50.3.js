'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const sql=read('scripts/PHF_KNL_COMPENSATION_VERSIONING_CRUD_1.50.3.sql');
const lib=read('lib/knl-foundation.js');
const server=read('server.js');
const api=read('api/data.js');
const ui=read('assets/js/knl/phf-knl-app.js');
const router=read('assets/js/phf-url-router.js');
const css=read('assets/css/phf-knl.css');

function has(source,value,label){assert(source.includes(value),label||('missing '+value));}

/* Migration: additive RPCs only, no new tables, no drop, service_role-only grants */
['knl_clone_compensation_version','knl_save_compensation_grades','knl_schedule_compensation_version'].forEach(name=>{
  has(sql,'function public.'+name,'RPC '+name);
});
assert(!/drop table|drop function|delete from public\.knl_compensation_versions|delete from public\.knl_employee_compensation_assignments/i.test(sql),'migration must not drop or bulk-delete existing compensation data');
assert(!/create table/i.test(sql),'1.50.3 must not create new tables — reuse 1.50.0 schema');
has(sql,'grant execute on function','service role grant');
has(sql,'to service_role','service role only');
has(sql,'revoke all on function','deny direct client access to new RPCs');
has(sql,"'Cloned from v'||source.version_number",'clone note traces source version');
has(sql,"v.status<>'DRAFT' then raise exception 'KNL_COMPENSATION_VERSION_NOT_DRAFT'",'schedule only from Draft');
has(sql,"v_version.status<>'DRAFT' then raise exception 'KNL_COMPENSATION_VERSION_IMMUTABLE'",'grade edits only on Draft');
has(sql,"jsonb_array_length(p_grades)<>v_existing","grade save requires the full existing grade set (no partial silent drop)");
has(sql,"status='INACTIVE',effective_to=p_effective_from-1","activating a version deactivates the prior Active version, mirrors 1.50.0 pattern");
has(sql,"into public.knl_compensation_audit","every new RPC writes an audit row");
assert.strictEqual((sql.match(/\$\$/g)||[]).length%2,0,'balanced SQL dollar quotes');

/* lib wiring */
['listKnlCompensationAssignmentTargets','cloneKnlCompensationVersion','saveKnlCompensationGrades','scheduleKnlCompensationVersion','getKnlCompensationVersionAudit','listKnlEmployeeCompensationHistory'].forEach(name=>{
  has(lib,'async function '+name,'lib function '+name);
  has(lib,name,'lib export '+name);
});
has(lib,"requireAdmin(session)",'new lib functions stay admin-gated');
has(lib,'ladderName:s.ladderName','income snapshot exposes ladder name for the polished profile header');
has(lib,'versionNumber:Number(s.versionNumber','income snapshot exposes version number for the polished profile header');

/* server + serverless API wiring must stay in sync */
['listKnlCompensationAssignmentTargets','cloneKnlCompensationVersion','saveKnlCompensationGrades','scheduleKnlCompensationVersion','getKnlCompensationVersionAudit','listKnlEmployeeCompensationHistory'].forEach(action=>{
  has(server,"payload.action==='"+action+"'",'server action '+action);
  has(api,"payload.action==='"+action+"'",'serverless action '+action);
});

/* UI: 4-tab sub-navigation, new admin-only tabs, reused Foundation write path */
has(ui,'Cơ cấu ngạch & bậc','structure tab label');
has(ui,'Gán cho nhân viên','assignment tab label');
has(ui,'Hồ sơ thu nhập','income profile tab label');
has(ui,'>Lịch sử<','history tab label');
has(ui,"data-knl-compensation-tab=\"gan-thu-nhap\"",'assignment tab wired into domain nav');
has(ui,"data-knl-compensation-tab=\"lich-su-thu-nhap\"",'history tab wired into domain nav');
has(ui,'async function renderCompensationStructure','structure tab renderer');
has(ui,'async function renderCompensationAssign','assignment tab renderer');
has(ui,'async function renderCompensationHistory','history tab renderer');
has(ui,"apiPost('saveKnlEmployeeIncome',payload)",'assignment tab reuses existing employee compensation RPC, no duplicate write path');
has(ui,'Chính thức','non-technical OFFICIAL label');
has(ui,'Thử việc','probation label');
assert(!/<h1>[^<]*OFFICIAL/.test(ui),'income profile must not surface the technical OFFICIAL label as primary UX');
has(ui,'value="910000"','meal allowance default suggestion 910.000, editable');
has(ui,"(rows.length<3?","max three extra allowances enforced client-side too");
has(ui,'lookup master, không override cá nhân','no personal override note on assignment form');
has(ui,'Version không phải Draft; chỉ xem','Active/Scheduled/Inactive versions render read-only');
has(ui,'Tạo phiên bản mới từ phiên bản này','clone-to-draft action present');
has(ui,'Đặt hiệu lực','schedule/activate action present');
has(ui,"['ngach-bac-luong','gan-thu-nhap','lich-su-thu-nhap'].indexOf(tab)>=0)return'co-cau-thu-nhap'",'new compensation tabs stay under the single existing sidebar item — no new sidebar entries');
has(ui,"tab === 'gan-ap-dung'||tab === 'ngach-bac-luong'||tab === 'gan-thu-nhap'||tab === 'lich-su-thu-nhap'",'new compensation admin tabs stay admin-gated like the existing ones');
has(ui,'ensureKnlShell(root,tab,capabilities,isAdmin','persistent shell retained for the new tabs');
has(ui,'KNL_READ_CACHE_TTL','in-memory read cache retained');
has(ui,"'listKnlCompensationAssignmentTargets','getKnlCompensationVersionAudit','listKnlEmployeeCompensationHistory'",'new read actions participate in the request cache/dedupe layer');
has(ui,"'cloneKnlCompensationVersion','saveKnlCompensationGrades','scheduleKnlCompensationVersion'",'new write actions invalidate the read cache');

/* Router: two new admin routes, registered everywhere an existing compensation route is registered */
['/admin/knl/gan-thu-nhap','/admin/knl/lich-su-thu-nhap'].forEach(route=>{
  has(router,"'"+route+"':Object.freeze(",'route registry entry '+route);
  has(router,route,'route reachable '+route);
});

/* CSS: no bare horizontal Excel-grid regression; reuses existing table/panel system */
has(css,'.phfk-comp-grade-row','grade row click-to-expand styling');
has(css,'.phfk-comp-slope','slope section styling');

assert.strictEqual((ui.match(/function compensationDomainNav/g)||[]).length,1,'single domain nav function, not duplicated per tab');

console.log('PASS KNL Compensation Versioning CRUD 1.50.3: migration RPC contracts, lib/server/api wiring, 4-tab UI, routes and performance invariants.');
