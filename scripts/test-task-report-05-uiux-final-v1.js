'use strict';

/*
 * PHF Task — REPORT-05 DASHBOARD UI/UX FINAL — SUPERSEDED 2026-08-29.
 *
 * Report-05's dashboard design (single "Tổng quan kỳ báo cáo" KPI block with a
 * 2-tier TASK_REPORT_KPI_PRIMARY/SECONDARY split, taskReportSummaryHtml/
 * taskReportCategoryHtml/taskReportPersonHtml, "Điểm cần chú ý" attention band)
 * was replaced wholesale by the LOCKED "Tổng quan & Báo cáo V2" screen
 * (taskReportHtml → taskReportV2SummaryHtml + taskReportTrendHtml +
 * taskReportV2{Person,Department,Category}Html + Overview V2 drilldown).
 *
 * Every symbol the old Report-05 assertions targeted no longer exists in the
 * app export, so those assertions cannot be "re-pointed" — the design they
 * verified is gone. Canonical coverage for the current screen lives in:
 *   - scripts/test-task-report-ui-v1.js            (Gate V2-R2, 63 assertions)
 *   - scripts/test-task-overview-v2-visual-polish.js (46 assertions)
 *   - scripts/test-task-reporting-v1.js            (Report-03 backend contract)
 *   - scripts/test-task-report-employee-drilldown-parity-v1.js
 *
 * This file is kept (not deleted) as a thin guard that the Report V2 render
 * still satisfies the two structural invariants Report-05 introduced and V2
 * kept: (1) the whole page is wrapped in .phft-report-page (AI-floating-button
 * safe-area container), (2) the period filter bar renders before the summary
 * KPIs. jsdom, no network, no real DB.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
function pass(condition, message) { assert.ok(condition, message); passed += 1; }

const TASK_APP_SRC = fs.readFileSync(path.join(ROOT, 'assets/js/task/phf-task-app.js'), 'utf8');

function newWindow(role) {
  const dom = new JSDOM('<!doctype html><body><div id="phfTaskRoot"></div></body>', {
    runScripts: 'outside-only', url: 'http://localhost/' + (role || 'admin') + '/task',
  });
  const { window } = dom;
  window.__PHF_TASK_TEST_MODE__ = true;
  window.phfGetSessionRole = function () { return role || 'admin'; };
  window.phfGetCurrentUser = function () { return { fullName: 'Demo QA', employeeCode: 'DEMO_QA' }; };
  window.phfNavigate = function () {};
  window.phfToast = function () {};
  window.fetch = function () { throw new Error('unstubbed fetch() call'); };
  window.eval(TASK_APP_SRC);
  return window;
}

(function () {
  const T = newWindow('admin').__PHF_TASK_TEST__;

  // Superseding coverage must exist (guards against silently dropping the V2 tests).
  ['test-task-report-ui-v1.js', 'test-task-overview-v2-visual-polish.js'].forEach((f) => {
    pass(fs.existsSync(path.join(ROOT, 'scripts', f)), 'superseding V2 test present: ' + f);
  });

  const html = T.taskReportHtml();

  // (1) AI-floating-button safe-area container — Report-05 invariant, kept by V2.
  pass(html.indexOf('<div class="phft-report-page">') === 0,
    'whole report is wrapped in .phft-report-page (AI-button safe-area container)');
  pass(html.indexOf('phft-report-filterbar') >= 0,
    'period filter bar (.phft-report-filterbar) is rendered');

  // (2) V2 information hierarchy — checked on the render composition in
  // taskReportHtml() source (data-independent): filter bar → summary →
  // trend → person → department → category → drilldown.
  const body = TASK_APP_SRC.slice(TASK_APP_SRC.indexOf('function taskReportHtml('));
  const seq = ['taskReportPeriodBarHtml()', 'taskReportV2SummaryHtml()', 'taskReportTrendHtml()',
    'taskReportV2PersonHtml()', 'taskReportV2DepartmentHtml()', 'taskReportV2CategoryHtml()'];
  let last = -1;
  seq.forEach((call) => {
    const at = body.indexOf(call);
    pass(at > last, 'taskReportHtml composes ' + call + ' after the previous V2 section');
    last = at;
  });

  // The retired Report-05 symbols are really gone (this file must not pretend to test them).
  ['taskReportSummaryHtml', 'TASK_REPORT_KPI_PRIMARY', 'TASK_REPORT_KPI_SECONDARY'].forEach((sym) => {
    pass(!(sym in T), 'retired Report-05 symbol not re-exported: ' + sym);
  });

  console.log('PHF Task Report-05 (SUPERSEDED by V2) structural guard: ' + passed + '/' + passed + ' PASS');
})();
