'use strict';
/* Structural regression for UX-QMP - "Ghi nhận nhanh nhiều nhân viên" (a toggle
   INSIDE the existing "quick" mode tab, not a new tab/route). Same source-scanning
   convention as scripts/test-checklist-assessment-profile-ui.js: this project has
   no jsdom, the render logic lives in one giant IIFE
   (assets/js/checklist/phf-checklist-app.js), so this asserts the exact wiring
   that makes the feature safe - toggle presence, state-name distinctness, the
   row-aware evidence handlers NOT calling the shared violationSelectedEmployee(),
   the account-scoped draft key, the 20-row cap message, and the 1-row remove
   guard - rather than driving a real DOM render.

   File này KHÔNG được gọi tự động ở bất kỳ đâu - chỉ chạy thủ công:
     node scripts/test-checklist-quick-multi-person-ui.js
*/
const fs = require('fs');
const path = require('path');

const appPath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const routerPath = path.resolve(__dirname, '..', 'assets/js/phf-url-router.js');
const cssPath = path.resolve(__dirname, '..', 'assets/css/phf-checklist.css');
const app = fs.readFileSync(appPath, 'utf8');
const router = fs.readFileSync(routerPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}
function fnBody(source, name, paramsPattern) {
  const re = new RegExp('function ' + name + '\\(' + (paramsPattern || '[^)]*') + '\\)\\{([\\s\\S]*?)\\n  \\}');
  const m = source.match(re);
  return m ? m[1] : null;
}
function extractFnSource(source, name) {
  const re = new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n  \\}');
  const m = source.match(re);
  return m ? m[0] : null;
}

// ---------- 1. Toggle exists inside the EXISTING quick tab; no new top-level tab ----------
check(/function quickPersonModeToggleHtml\(\)\{/.test(app), '1. quickPersonModeToggleHtml() renderer exists');
check(/data-phfck-quick-person-mode="single"/.test(app) && /data-phfck-quick-person-mode="multi"/.test(app),
  '1. Toggle renders both "single" and "multi" options via data-phfck-quick-person-mode');
check(/Một nhân viên/.test(app) && /Nhiều nhân viên/.test(app), '1. Toggle labels "Một nhân viên"/"Nhiều nhân viên" present');
const violationTabsBody = fnBody(app, 'violationTabsHtml', '');
check(!!violationTabsBody, '1a. violationTabsHtml() (top-level tab bar) found');
if (violationTabsBody) {
  check((violationTabsBody.match(/data-phfck-violation-tab="/g) || []).length === 3 || (violationTabsBody.match(/data-phfck-violation-tab="/g) || []).length === 4,
    '1b. violationTabsHtml() still only has the pre-existing quick/detail/multi(/late) top-level tabs - no 5th tab added for this feature');
  check(!/data-phfck-violation-tab="quick-multi-person"|data-phfck-violation-tab="qmp"/.test(violationTabsBody),
    '1c. No new top-level violation-tab value was added for multi-person mode');
}

// ---------- 2. Single-employee quick form renderer/handlers unchanged ----------
const quickHtmlBody = fnBody(app, 'violationQuickHtml', '');
check(!!quickHtmlBody, '2a. violationQuickHtml() found');
if (quickHtmlBody) {
  check(/if\(violationUiState\.quickPersonMode==='multi'\)\{/.test(quickHtmlBody),
    '2b. violationQuickHtml() branches on quickPersonMode - multi-person UI replaces the body only when explicitly toggled');
  check(/violationEmployeeSelectorHtml\(\)\+violationCompactContextHtml\(\)\+quickDraftBannerHtml\(\)/.test(quickHtmlBody),
    '2c. The single-employee branch still renders the ORIGINAL sequence (violationEmployeeSelectorHtml+violationCompactContextHtml+quickDraftBannerHtml) unchanged');
  check(/quickGroupChipsHtml\(\)/.test(quickHtmlBody) && /quickCriteriaRowsHtml\(\)/.test(quickHtmlBody) && /quickFooterHtml\(\)/.test(quickHtmlBody),
    '2d. Single-employee branch still calls quickGroupChipsHtml/quickCriteriaRowsHtml/quickFooterHtml exactly as before');
}
// Existing quick handlers/functions must still exist untouched.
for (const fn of ['quickValidation', 'quickOneValidation', 'quickOfficialPayload', 'saveQuickOfficialTest', 'quickDraftKey', 'quickSelectedCount']) {
  check(new RegExp('function ' + fn + '\\(').test(app), '2e. Existing single-employee function ' + fn + '() still present (not renamed/removed)');
}
check(/var QUICK_DRAFT_STORE='phfChecklistQuickViolationDraft:v2';/.test(app), '2f. Existing QUICK_DRAFT_STORE key unchanged');

// ---------- 3. New state names exist and are distinct from multiRows/lateRows ----------
check(/quickMultiPersonRows:\[\]/.test(app), '3a. violationUiState.quickMultiPersonRows initial field exists');
check(/quickMultiPersonReviewOpen:false/.test(app), '3b. violationUiState.quickMultiPersonReviewOpen initial field exists');
check(/var quickMultiPersonSaving=false;/.test(app), '3c. quickMultiPersonSaving top-level state var exists (mirrors quickOfficialSaving/multiOfficialSaving double-submit guard pattern)');
check(/var quickMultiPersonSubmitState='idle';/.test(app), '3d. quickMultiPersonSubmitState state machine var exists, initialized to \'idle\'');
check(!/quickMultiPersonRows\s*=\s*violationUiState\.multiRows/.test(app) && !/quickMultiPersonRows\s*=\s*violationUiState\.lateRows/.test(app),
  '3e. quickMultiPersonRows is never aliased/assigned from multiRows or lateRows (distinct arrays)');
check(/function quickMultiPersonRowDefault\(\)\{/.test(app), '3f. quickMultiPersonRowDefault() row-factory exists (distinct from multiDayRowDefault()/lateRowDefault())');
const qmpRowDefaultSrc = extractFnSource(app, 'quickMultiPersonRowDefault');
check(!!qmpRowDefaultSrc && !/multiRows|lateRows/.test(qmpRowDefaultSrc), '3g. quickMultiPersonRowDefault() body never references multiRows/lateRows');

// ---------- 4. Row-aware evidence handlers exist and do NOT call violationSelectedEmployee() ----------
const qmpHandleFileSrc = extractFnSource(app, 'quickMultiPersonHandleFileInput');
const qmpRetryFileSrc = extractFnSource(app, 'quickMultiPersonRetryFile');
check(!!qmpHandleFileSrc, '4a. quickMultiPersonHandleFileInput(root,inputEl) exists');
check(!!qmpRetryFileSrc, '4b. quickMultiPersonRetryFile(root,scopeKey,localId) exists');
if (qmpHandleFileSrc) {
  check(!/violationSelectedEmployee\(\)/.test(qmpHandleFileSrc),
    '4c. quickMultiPersonHandleFileInput() body does NOT call violationSelectedEmployee() (resolves employeeCode from the row instead)');
  check(/evidenceUploadFile\(root,scopeKey,employeeCode,file\)/.test(qmpHandleFileSrc),
    '4d. quickMultiPersonHandleFileInput() delegates the actual upload to the SAME shared evidenceUploadFile() (not a forked copy)');
}
if (qmpRetryFileSrc) {
  check(!/violationSelectedEmployee\(\)/.test(qmpRetryFileSrc),
    '4e. quickMultiPersonRetryFile() body does NOT call violationSelectedEmployee() (resolves employeeCode from the row instead)');
  check(/evidenceUploadFile\(root,scopeKey,employeeCode,entry\.file\)/.test(qmpRetryFileSrc),
    '4f. quickMultiPersonRetryFile() delegates to the SAME shared evidenceUploadFile() (not a forked copy)');
}
// The routing in the shared change/click delegation must send 'qmp-' scoped
// events to the new row-aware handlers instead of the generic evidence ones.
check(/qmpEvScope\.indexOf\('qmp-'\)===0\)quickMultiPersonHandleFileInput\(root,e\.target\);else evidenceHandleFileInput\(root,e\.target\);/.test(app),
  '4g. The shared [data-phfck-evidence-input] change handler routes qmp- scoped inputs to quickMultiPersonHandleFileInput(), everything else still goes to the original evidenceHandleFileInput()');
check(/evRetryParts\[0\]\|\|''\)\.indexOf\('qmp-'\)===0\)quickMultiPersonRetryFile\(root,evRetryParts\[0\],evRetryParts\[1\]\);else evidenceRetryFile\(root,evRetryParts\[0\],evRetryParts\[1\]\);/.test(app),
  '4h. The shared [data-phfck-evidence-retry] click handler routes qmp- scoped retries to quickMultiPersonRetryFile(), everything else still goes to the original evidenceRetryFile()');
// Evidence core functions themselves must remain untouched/scope-key-generic (not forked).
for (const fn of ['evidenceScope', 'evidencePickerHtml', 'evidenceUploadFile', 'evidenceRemoveFile', 'evidenceDoneDraftIds', 'evidenceAnyPending', 'attachEvidenceAfterSave']) {
  check((app.match(new RegExp('function ' + fn + '\\(', 'g')) || []).length === 1,
    '4i. Core evidence function ' + fn + '() still defined exactly once (not duplicated/forked for this feature)');
}
check(/evidencePickerHtml\(quickMultiPersonScopeKey\(row\.rowId\)\)/.test(app),
  '4j. Row renderer calls the SAME evidencePickerHtml() with a per-row scope key, not a new picker renderer');

// ---------- 5. Draft key includes the account-scoping helper (same one multiDraftKey() uses) ----------
const qmpDraftKeySrc = extractFnSource(app, 'quickMultiPersonDraftKey');
const multiDraftKeySrc = extractFnSource(app, 'multiDraftKey');
check(!!qmpDraftKeySrc, '5a. quickMultiPersonDraftKey() exists');
check(!!multiDraftKeySrc && /currentSessionEmployeeCode\(\)/.test(multiDraftKeySrc), '5b. Sanity: multiDraftKey() (the safe precedent) uses currentSessionEmployeeCode()');
if (qmpDraftKeySrc) {
  check(/currentSessionEmployeeCode\(\)/.test(qmpDraftKeySrc),
    '5c. quickMultiPersonDraftKey() calls currentSessionEmployeeCode() - the SAME account-scoping helper multiDraftKey() uses (follows the safe pattern, not quickDraftKey()\'s known-bug pattern of no account prefix)');
}
check(/var QUICK_MULTI_PERSON_DRAFT_STORE='phfChecklistQuickMultiPersonDraft:v1';/.test(app), '5d. New, distinct localStorage key for the multi-person draft store (does not reuse QUICK_DRAFT_STORE/MULTI_DRAFT_STORE)');
// Persistence must never fire while inflight/uncertain (never auto-resume/auto-submit).
const saveDraftSrc = extractFnSource(app, 'saveQuickMultiPersonDraft');
check(!!saveDraftSrc && /quickMultiPersonSubmitState!=='idle'/.test(saveDraftSrc),
  '5e. saveQuickMultiPersonDraft() refuses to persist unless quickMultiPersonSubmitState===\'idle\' (never persists mid-flight/uncertain state)');
const restoreDraftSrc = extractFnSource(app, 'restoreQuickMultiPersonDraft');
check(!!restoreDraftSrc && !/fetch\(/.test(restoreDraftSrc),
  '5f. restoreQuickMultiPersonDraft() never calls fetch() - restoring a draft is purely local, never auto-submits on load');

// ---------- 6. 20-row cap message + guard ----------
check(/var QUICK_MULTI_PERSON_MAX_ROWS=20;/.test(app), '6a. 20-row cap constant defined');
check(/Tối đa 20 ghi nhận mỗi lượt/.test(app), '6b. Cap message string "Tối đa 20 ghi nhận mỗi lượt" present');
check(/violationUiState\.quickMultiPersonRows\.length>=QUICK_MULTI_PERSON_MAX_ROWS\)\{checklistToast\('warning','Đã đạt giới hạn','Tối đa 20 ghi nhận mỗi lượt\.',true\);return;\}/.test(app),
  '6c. Add-row click handler shows the cap message and returns WITHOUT pushing a 21st row (does not silently ignore the click either - see toast)');
check(/rows\.length>=QUICK_MULTI_PERSON_MAX_ROWS/.test(app), '6d. Renderer computes atMax the same way, to disable/relabel the add button before 20 is even reached via a stale click');

// ---------- 7. Remove-row disabled/blocked at exactly 1 row ----------
check(/var canRemove=violationUiState\.quickMultiPersonRows\.length>1&&!quickMultiPersonLocked\(\);/.test(app),
  '7a. Row renderer computes canRemove = rows.length>1 AND NOT locked (remove control disabled when exactly 1 row remains, and also hard-disabled during uncertain/done lock, not just CSS pointer-events)');
check(/data-phfck-qmp-remove '\+\(canRemove\?'':'disabled'\)/.test(app), '7b. Remove-row button gets the disabled attribute when canRemove is false');
check(/if\(!qmpRemoveRowId\|\|violationUiState\.quickMultiPersonRows\.length<=1\)return;/.test(app),
  '7c. Remove-row click handler ALSO guards in JS (defense in depth beyond the disabled attribute) - never drops to 0 rows');

// ---------- 7d-7h. Field edits hard-gated during uncertain/done, not just CSS pointer-events ----------
// pointer-events:none on .phfck-qmp-list does not block a field that already holds
// keyboard focus when the lock is applied, nor Tab-navigation into it - so the
// input/change handlers themselves must refuse to mutate row state while locked,
// otherwise edited content can be resent under the STALE request_id on "Thử lại"
// and get silently dropped by the backend's request_id dedupe if the ambiguous
// first attempt had actually already been saved server-side.
check(/function quickMultiPersonLocked\(\)\{\s*return quickMultiPersonSubmitState==='uncertain'\|\|quickMultiPersonSubmitState==='done';\s*\}/.test(app),
  "7d. quickMultiPersonLocked() helper exists (true for 'uncertain' or 'done')");
check(/data-phfck-qmp-field="date"\],\[data-phfck-qmp-field="note"\]'\)\)\{if\(quickMultiPersonLocked\(\)\)return;/.test(app),
  '7e. date/note input handler bails out via quickMultiPersonLocked() before mutating row state');
check(/data-phfck-qmp-field="employee"\]'\)\)\{if\(quickMultiPersonLocked\(\)\)return;/.test(app),
  '7f. employee change handler bails out via quickMultiPersonLocked() before mutating row state');
check(/data-phfck-qmp-field="criterion"\]'\)\)\{if\(quickMultiPersonLocked\(\)\)return;/.test(app),
  '7g. criterion change handler bails out via quickMultiPersonLocked() before mutating row state');
check(/var locked=quickMultiPersonLocked\(\);/.test(app),
  '7h. quickMultiPersonHtml() renderer reuses the same quickMultiPersonLocked() helper for the is-locked CSS class (single source of truth, not a duplicated condition)');

// ---------- 8. request_id lifecycle: generated at row creation, not at submit time ----------
const rowDefaultSrc = extractFnSource(app, 'quickMultiPersonRowDefault');
check(!!rowDefaultSrc && /requestId:quickMultiPersonNewRequestId\(\)/.test(rowDefaultSrc),
  '8a. requestId is generated inside quickMultiPersonRowDefault() (row creation time), not deferred to the payload builder');
const paydloadSrc = extractFnSource(app, 'quickMultiPersonPayload');
check(!!paydloadSrc && /requestId:row\.requestId/.test(paydloadSrc) && !/quickMultiPersonNewRequestId\(\)/.test(paydloadSrc),
  '8b. quickMultiPersonPayload() reuses the STABLE row.requestId as-is (does not regenerate a fresh id per submit, unlike quickOfficialPayload()/multiOfficialPayload()\'s batch+index scheme)');
const editContentSrc = extractFnSource(app, 'quickMultiPersonEditContent');
check(!!editContentSrc && /row\.requestId=quickMultiPersonNewRequestId\(\)/.test(editContentSrc),
  '8c. quickMultiPersonEditContent() (the explicit "Sửa nội dung" escape hatch from \'uncertain\') is the ONLY place besides row-creation that mints fresh request ids');
const retrySrc = extractFnSource(app, 'quickMultiPersonRetry');
check(!!retrySrc && !/quickMultiPersonNewRequestId/.test(retrySrc),
  '8d. quickMultiPersonRetry() (the "Thử lại" action from \'uncertain\') never regenerates request ids - resends the exact same payload/ids');
const saveOfficialSrc = extractFnSource(app, 'saveQuickMultiPersonOfficial');
check(!!saveOfficialSrc, '8e. saveQuickMultiPersonOfficial() found');
if (saveOfficialSrc) {
  check(/quickMultiPersonSubmitState='inflight';/.test(saveOfficialSrc), '8f. Submit sets state to \'inflight\' before the fetch call');
  check(/ambiguous=true;\s*\n\s*throw networkErr;/.test(saveOfficialSrc), '8g. A thrown/rejected fetch (network error/timeout, no response) is marked ambiguous');
  check(/if\(!response\.ok\|\|data\.ok===false\)\{[\s\S]{0,200}throw new Error\(data\.message\|\|data\.error\|\|'Không thể lưu ghi nhận lỗi\.'\);/.test(saveOfficialSrc),
    '8h. A definite server error response (HTTP received, parsed JSON, ok:false) throws WITHOUT setting ambiguous=true (falls through to the idle/retry-with-same-id branch)');
  check(/if\(ambiguous\)\{\s*\n\s*quickMultiPersonSubmitState='uncertain';/.test(saveOfficialSrc),
    '8i. catch-block: ambiguous failures transition to \'uncertain\' (content locked, offer retry/edit)');
  check(/\}else\{\s*\n\s*quickMultiPersonSubmitState='idle';/.test(saveOfficialSrc),
    '8j. catch-block: non-ambiguous (clear) failures transition back to \'idle\' (form stays editable, same request ids preserved for retry)');
  check(/quickMultiPersonSubmitState='done';/.test(saveOfficialSrc), '8k. A parsed, successful response (fresh insert or idempotent retry, either) transitions to \'done\'');
}

// ---------- 9. Criterion resolution is fully synchronous (no race-token needed) - verify the claim ----------
const ctxForEmployeeSrc = extractFnSource(app, 'violationAssignmentContextForEmployee');
check(!!ctxForEmployeeSrc, '9a. violationAssignmentContextForEmployee() found (used for per-row criterion resolution)');
if (ctxForEmployeeSrc) {
  check(!/\basync\b/.test(ctxForEmployeeSrc) && !/\bawait\b/.test(ctxForEmployeeSrc) && !/fetch\(/.test(ctxForEmployeeSrc),
    '9b. violationAssignmentContextForEmployee() is fully synchronous (no async/await/fetch) - confirms no per-row race-token is needed for criterion resolution, unlike the async employeeSelectionToken precedent used for the shared employee combobox');
}
const critForCtxSrc = extractFnSource(app, 'violationCriteriaForContext');
check(!!critForCtxSrc && !/\basync\b/.test(critForCtxSrc) && !/fetch\(/.test(critForCtxSrc),
  '9c. violationCriteriaForContext() is also fully synchronous - the whole per-row criterion pipeline has no async hop that a stale response could win a race on');
check(/function quickMultiPersonContextForRow\(row\)\{/.test(app), '9d. quickMultiPersonContextForRow(row) - per-row context resolver - exists and reuses violationAssignmentContextForEmployee()');

// ---------- 10. Employee source-of-truth: violationEligibleEmployees(), never a fresh "all employees" fetch ----------
const empOptionsSrc = extractFnSource(app, 'quickMultiPersonEmployeeOptions');
check(!!empOptionsSrc && /violationEligibleEmployees\(\)/.test(empOptionsSrc) && !/fetch\(/.test(empOptionsSrc),
  '10. Per-row employee picker sources from violationEligibleEmployees() (server-scoped, already permission-checked) - not a separate fetch');

// ---------- 11. Validation: note length convention matches multi/detail (>=10), not quick's non-empty-only rule ----------
const multiValidationSrc = extractFnSource(app, 'multiValidation');
check(!!multiValidationSrc && /trim\(\)\.length<10/.test(multiValidationSrc), '11a. Sanity: multiValidation() convention is indeed >=10 chars');
const qmpValidationSrc = extractFnSource(app, 'quickMultiPersonValidation');
check(!!qmpValidationSrc && /trim\(\)\.length<10/.test(qmpValidationSrc),
  '11b. quickMultiPersonValidation() matches the multi/detail >=10-char note convention (not quick\'s non-empty-only rule)');
check(!!qmpValidationSrc && /seenRequestIds/.test(qmpValidationSrc),
  '11c. quickMultiPersonValidation() defensively asserts no duplicate request_id across rows before building the payload');

// ---------- 12. No new sidebar/menu/route entry anywhere ----------
check(!/\/hv\/checklist\/nhieu-nhan-vien|\/ql\/checklist\/nhieu-nhan-vien|checklist-quick-multi-person/.test(router),
  '12a. No new ROUTE_REGISTRY/PHF_ROUTE_MAP entry for this feature (it is a toggle inside the existing quick tab, not a route)');
check(!/data-phfck-manager-section="quick-multi-person"|data-phfck-manager-section="nhieu-nhan-vien"/.test(app),
  '12b. No new managerSidebarHtml() nav item for this feature');
check(!/item\('quick-multi-person'/.test(app), '12c. No new sidebar item() call referencing this feature');

// ---------- 13. Backend gap fix: normalizeCanonical() fail() calls carry {index,requestId} ----------
function extractTopLevelFnSource(source, name) {
  // lib/*.js functions are NOT inside an IIFE (unlike phf-checklist-app.js) -
  // their closing brace sits at column 0, not indented 2 spaces.
  const re = new RegExp('(?:async )?function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}');
  const m = source.match(re);
  return m ? m[0] : null;
}
const violationsLibPath = path.resolve(__dirname, '..', 'lib/checklist-violations.js');
const violationsLib = fs.readFileSync(violationsLibPath, 'utf8');
const normalizeCanonicalSrc = extractTopLevelFnSource(violationsLib, 'normalizeCanonical');
check(!!normalizeCanonicalSrc, '13a. normalizeCanonical() found in lib/checklist-violations.js');
function stripComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''); }
if (normalizeCanonicalSrc) {
  const codeOnly = stripComments(normalizeCanonicalSrc);
  const failCallCount = (codeOnly.match(/\bfail\(/g) || []).length;
  const rowDetailsCallCount = (codeOnly.match(/rowDetails\(/g) || []).length;
  check(failCallCount >= 10, '13b. normalizeCanonical() still has all ~10 fail() call sites (none removed), got ' + failCallCount);
  check(rowDetailsCallCount === failCallCount, '13c. EVERY fail() call site in normalizeCanonical() passes through rowDetails() (index+requestId), got ' + rowDetailsCallCount + ' rowDetails() calls vs ' + failCallCount + ' fail() calls');
  check(/const rowDetails = \(extra\) => Object\.assign\(\{ index, requestId: rawRequestId \}, extra \|\| \{\}\);/.test(normalizeCanonicalSrc),
    '13d. rowDetails() helper merges {index, requestId} into any extra details, exact shape verified');
}
const requestGuardPath = path.resolve(__dirname, '..', 'lib/request-guard.js');
const requestGuard = fs.readFileSync(requestGuardPath, 'utf8');
check(/\.\.\.\(err\.details\s*\?\s*\{\s*details:\s*err\.details\s*\}\s*:\s*\{\}\)/.test(requestGuard),
  '13e. publicError() (lib/request-guard.js) spreads err.details into the response body only when present (additive, no shape change for errors that never set .details)');

console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'ALL PASS'));
process.exit(failures ? 1 : 0);
