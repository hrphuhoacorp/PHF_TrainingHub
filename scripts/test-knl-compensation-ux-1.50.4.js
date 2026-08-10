'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const lib=read('lib/knl-foundation.js');
const ui=read('assets/js/knl/phf-knl-app.js');
const css=read('assets/css/phf-knl.css');
const check=read('scripts/phf-check-js.js');
const buildInfo=JSON.parse(read('build-info.json'));

function has(source,value,label){assert(source.includes(value),label||('missing '+value));}

/* lib: employee history must expose before/after snapshots — UI derives
   semantic change labels from these, never by re-looking-up current master. */
has(lib,'beforeData:r.before_data||{}','getKnlEmployeeIncome must expose beforeData for history reconciliation');
has(lib,'afterData:r.after_data||{}','getKnlEmployeeIncome must expose afterData');
has(lib,'organizationSnapshot:row.organization_snapshot||{}','publicAssignment must keep exposing organizationSnapshot for the identity card');

/* A. Cơ cấu ngạch & bậc — header/context, KPI amounts, Cơm column, slope legend, scenario detail */
has(ui,'function compensationContextBarHtml','structure tab header context bar (Ngạch/Version/Kỳ/Trạng thái)');
has(ui,'Đây là cấu hình cơ cấu tham chiếu theo Ngạch-Bậc, không phải bảng lương thực trả','not-a-payroll-table disclaimer');
has(ui,'phfk-kpi-sub','KPI cards must show the underlying amount, not just the percentage');
has(ui,'KHOẢNG CÁCH (','distance KPI card kept as its own labelled card');
has(ui,'MỨC TĂNG BÌNH QUÂN/BẬC','average-per-grade KPI card');
has(ui,'<th>Cơm (gợi ý)</th>','grade table must show the meal suggestion column');
has(ui,'var MEAL_SUGGESTION=910000','meal suggestion is a single named constant, reused (not duplicated) across assign form and grade table');
assert.strictEqual((ui.match(/910000/g)||[]).length,1,'910000 must appear exactly once — the single MEAL_SUGGESTION declaration — never re-hardcoded elsewhere');
has(ui,'function pctTier','slope/percent color tiering helper (presentation-only, not a data rule)');
has(ui,'abs<=8','≤8% tier matches the approved baseline legend');
has(ui,'abs<=18','8–18% tier matches the approved baseline legend');
has(ui,'≤8%: Thấp','slope legend renders the approved 3-tier note');
has(ui,'8–18%: Hợp lý','slope legend renders the approved 3-tier note');
has(ui,'&gt;18%: Cao','slope legend renders the approved 3-tier note');
has(ui,'function compensationGradeDetailRowHtml','grade detail expand renders regardless of Draft/Active status');
has(ui,'Chi tiết cấu phần','Chi tiết cấu phần block present');
has(ui,'Tổng lương vị trí (1+2)','position-total subtotal line present');
has(ui,'Các kịch bản tổng thu nhập cơ cấu','4-scenario table present');
has(ui,'function compensationScenarioRows','scenario rows computed client-side from grade + MEAL_SUGGESTION, no new backend');
has(ui,'không phải rule cố định hay payroll simulation','scenario table must disclaim it is not a hard business rule / payroll simulation');
has(ui,'colspan="12"','grade detail row spans the now-12-column table');

/* B. Hồ sơ thu nhập — identity card, status badge, 4-column table, semantic history */
has(ui,'function compensationIdentityCardHtml','income profile identity card (đọc organizationSnapshot đã có sẵn)');
has(ui,'organizationSnapshot||{}','identity card must read the existing organizationSnapshot, not a new field');
has(ui,'Đang áp dụng','separate current-status badge, distinct from Chính thức/Thử việc label');
has(ui,'<th>Cách xác định</th>','income table must show the determination source column');
has(ui,'<th>Ghi chú</th>','income table must show the hưởng/không hưởng remark column');
has(ui,'function allowanceRemark','hưởng/không hưởng badge helper reused per allowance line');
has(ui,'function compensationChangeSummary','semantic history label derived from before/after snapshot, not raw CREATE/UPDATE');
has(ui,'function compensationChangeTransition','trước/sau transition derived from before/after snapshot');
has(ui,"'Chuyển chính thức'",'probation-to-official transition has a semantic Vietnamese label');
has(ui,"'Nâng bậc'",'grade-up transition has a semantic Vietnamese label');
has(ui,"'Giảm bậc'",'grade-down transition has a semantic Vietnamese label');
has(ui,"'Thay đổi phụ cấp'",'allowance-only change has a semantic Vietnamese label');
has(ui,'<th>Trước</th>','income history table must show a before column');
has(ui,'<th>Sau</th>','income history table must show an after column');
has(ui,'KHÔNG lookup master hiện tại để dựng lại lịch sử','history derivation must be documented as snapshot-only, matching the no-lookup requirement');

/* Lịch sử tab (admin, cross-employee) reuses the same semantic derivation — no duplicated logic */
has(ui,'compensationChangeTransition(h)','admin Lịch sử tab reuses the same before/after derivation as the employee profile, not a second implementation');

/* C. Gán cho nhân viên — unchanged; confirm no accidental regression */
has(ui,'async function renderCompensationAssign','assignment tab renderer untouched');
has(ui,"apiPost('saveKnlEmployeeIncome',payload)",'assignment tab still reuses the existing employee compensation RPC');

/* D. No new sidebar entries, no removed tabs */
has(ui,'Cơ cấu ngạch & bậc','structure tab label retained');
has(ui,'Gán cho nhân viên','assignment tab label retained');
has(ui,'Hồ sơ thu nhập','income profile tab label retained');
assert.strictEqual((ui.match(/function compensationDomainNav/g)||[]).length,1,'single domain nav function, still 4 tabs, no new sidebar item added');

/* F. Cache-busting gate: scripts/phf-check-js.js must now fail-fast if the manual
   ?v= tags for phf-knl-app.js/phf-knl.css don't move when those files change. */
has(check,'MANUAL_VERSIONED_ASSETS','isolated manual-asset cache-busting gate added');
has(check,'function manualAssetTagChanged','gate compares the ?v= tag value against HEAD, not just presence of a bump anywhere');
has(check,"'assets/js/knl/phf-knl-app.js'",'gate covers phf-knl-app.js specifically');
has(check,"'assets/css/phf-knl.css'",'gate covers phf-knl.css specifically');

/* Release fingerprint: build-info.json and index.html must both be on 1.50.4 */
assert.strictEqual(buildInfo.version,'1.50.4','build-info.json version must be bumped to 1.50.4');
const indexHtml=read('index.html');
has(indexHtml,'phf-knl.css?v=1.50.4','index.html CSS tag must be bumped to 1.50.4');
has(indexHtml,'phf-knl-app.js?v=1.50.4','index.html JS tag must be bumped to 1.50.4');

/* CSS: new blocks exist, reuse existing panel/table system (no bespoke Excel-grid regression) */
has(css,'.phfk-comp-context-bar','context bar styling present');
has(css,'.phfk-comp-identity','identity card styling present');
has(css,'.phfk-comp-grade-detail-grid','two-column detail/scenario layout present');
has(css,'.phfk-pct','percent-tier color styling present');

console.log('PASS KNL Compensation UX/IA reconciliation 1.50.4: header/KPI/Cơm/slope legend/scenario detail, income identity+4-col table+semantic history, cache-busting gate, no regression to Gán/IA.');
