'use strict';
/* Structural regression - Daily Violation Criteria Version Consistency (2026-09-12).
   Same source-scanning convention as scripts/test-checklist-quick-multi-person-ui.js:
   this codebase has no jsdom for the giant IIFE in assets/js/checklist/phf-checklist-app.js,
   so this asserts the exact wiring for Fix 1 (workspace cache refresh) and Fix 3 (UI jargon)
   from the version-consistency audit, rather than driving a real DOM render.

   Manual only:
     node scripts/test-checklist-violation-version-consistency-ui-2026-09.js
*/
const fs = require('fs');
const path = require('path');

const appPath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const app = fs.readFileSync(appPath, 'utf8');

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}
function fnBody(source, name) {
  const re = new RegExp('function ' + name + '\\([^)]*\\)\\{([\\s\\S]*?)\\n  \\}');
  const m = source.match(re);
  return m ? m[1] : null;
}

// ---------- Fix 1: Ghi nhận lỗi workspace must always refresh the template/assignment
// cache on entry (not rely on the 15s throttle), since another tab/admin may have
// changed the template while this tab stayed open. ----------
const initBody = fnBody(app, 'initializeViolationsView');
check(!!initBody, 'initializeViolationsView() found');
if (initBody) {
  check(/fetchViolationWorkspaceSnapshot\(root,true\)/.test(initBody),
    'Fix 1: initializeViolationsView() always calls fetchViolationWorkspaceSnapshot(root,true) - bypasses the 15s cache on every workspace entry (route switch, role transition, phf-training-data-ready, retry)');
  check(!/fetchViolationWorkspaceSnapshot\(root,!!force\)/.test(initBody),
    'Fix 1: no longer gates the refresh behind the caller-supplied force flag (every entry now refreshes)');
}
// The existing 15s in-flight/staleness bookkeeping stays (coalesces concurrent calls);
// only the "skip because recently loaded" branch is bypassed by always passing true.
check(/function fetchViolationWorkspaceSnapshot\(root,force\)\{/.test(app),
  'Fix 1: fetchViolationWorkspaceSnapshot() signature unchanged - no new API added, existing GET /api/data?checklistWorkspace=1 path reused');
check(/violationWorkspaceFetchState\.inflight/.test(app),
  'Fix 1: concurrent-call coalescing via violationWorkspaceFetchState.inflight still present (forcing refresh does not cause request storms)');

// ---------- Fix 3: the 3 routine Ghi nhận lỗi render surfaces must not emit the raw
// technical version string (e.g. "TBP-HCNS-1.3") - only template name + effective-date
// context. ctx.version itself must stay available elsewhere for the submission payload. ----------
check(/function violationTemplateOperationalNote\(ctx\)\{/.test(app),
  'Fix 3: violationTemplateOperationalNote(ctx) helper exists (template name + "Áp dụng từ dd/mm/yyyy", no raw version)');

['violationContextNoticeHtml', 'violationAssignmentCardHtml', 'violationCompactContextHtml'].forEach(name => {
  const body = fnBody(app, name);
  check(!!body, 'Fix 3: ' + name + '() found');
  if (body) {
    check(!/esc\(ctx\.version/.test(body), 'Fix 3: ' + name + '() no longer interpolates raw ctx.version into the rendered HTML');
    check(!/esc\(noticeTemplateText\)\+\(noticeNote/.test(body) || name !== 'violationContextNoticeHtml' || /violationTemplateOperationalNote\(ctx\)/.test(body),
      'Fix 3: ' + name + '() uses the operational-note helper instead of the raw version');
  }
});
// The submission payload builders (quick/detail/multi/late) are OUT OF SCOPE for Fix 3
// (audit named exactly these 3 display surfaces) and must keep sending ctx.version so the
// server's CHECKLIST_TEMPLATE_VERSION_MISMATCH hard-reject keeps working.
check(/templateVersion:ctx\.version\|\|''/.test(app), 'Fix 3 scope check: submission payloads still send templateVersion:ctx.version (server mismatch protection untouched)');

console.log(failures ? ('\n' + failures + ' FAIL') : '\nALL PASS');
process.exit(failures ? 1 : 0);
