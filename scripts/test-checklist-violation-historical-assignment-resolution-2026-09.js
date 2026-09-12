'use strict';
/* Regression - Daily Violation Criteria historical assignment resolution (2026-09-12,
   version-consistency audit round 2).

   PROD evidence: selecting 12/09/2026 for PHF012 works (current assignment effective that
   day); selecting 11/09/2026 (before the current assignment's effective_date, but AFTER a
   still-valid historical assignment effective 01/08) reported "no applicable version" even
   though checklist_employee_assignment_history genuinely has the 01/08 row (as the
   previous_data snapshot on the history row created when the assignment changed to 12/09).

   Root cause: assignmentTemplateMeta() only ever varies the TEMPLATE VERSION by date - the
   TEMPLATE_ID always came straight from the CURRENT assignment
   (loadFormAssignments()[key].templateId), never from assignment history, so a date before
   the current assignment's own effective_date had nothing to resolve against.

   Fix: resolveEmployeeAssignmentAt(person,eventDate) - a new frontend function - mirrors
   resolveAssignmentAt() in lib/checklist-violations.js: current assignment UNION history
   rows (each history row contributing BOTH its own new-state fields AND its previous_data
   old-state snapshot), filtered to effective_date <= occurredDate, picking the max
   effective_date (tie-broken by most recent changedAt/updatedAt).

   This file extracts the REAL function source (not a reimplementation) from
   assets/js/checklist/phf-checklist-app.js - same source-scanning convention as
   scripts/test-checklist-quick-multi-person-ui.js - and executes it against fixture data
   mirroring the exact PROD shape, to prove the actual shipped logic produces the correct
   historical-date resolution.

   Manual only:
     node scripts/test-checklist-violation-historical-assignment-resolution-2026-09.js
*/
const fs = require('fs');
const path = require('path');
const Module = require('module');

const appPath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const app = fs.readFileSync(appPath, 'utf8');

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}
// Brace-counting (not a 2-space-closing-line regex): robust to any function body
// formatting, e.g. a multi-line sort comparator whose closing is `});}` rather than a bare
// `}` on its own 2-space-indented line (see checklistTemplateVersions() same-day tie-break
// fix, 2026-09-12).
function extractFnSource(source, name) {
  const startRe = new RegExp('function ' + name + '\\([^)]*\\)\\{');
  const sm = source.match(startRe);
  if (!sm) throw new Error('function ' + name + '() not found in ' + appPath);
  let i = sm.index + sm[0].length, depth = 1;
  while (depth > 0 && i < source.length) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return source.slice(sm.index, i);
}

const FN_NAMES = ['normalizeText', 'checklistIsoDate', 'formAssignmentKey', 'violationAssignmentHistoryCandidates', 'resolveEmployeeAssignmentAt'];
FN_NAMES.forEach(name => check(new RegExp('function ' + name + '\\(').test(app), 'source has function ' + name + '()'));

let CURRENT_FORMS = {};
let HISTORY_BY_KEY = {};

// Builds a fresh sandbox module each call, wired so the REAL extracted
// resolveEmployeeAssignmentAt() reads loadFormAssignments()/checklistAssignmentHistoryByKey
// from the CURRENT_FORMS/HISTORY_BY_KEY closures above (via a small shim prelude), rather
// than a hand-written reimplementation of the resolution logic.
function buildResolver() {
  const shim =
    'function loadFormAssignments(){ return require(' + JSON.stringify(__filename) + ').__CURRENT_FORMS__; }\n' +
    'Object.defineProperty(globalThis, "checklistAssignmentHistoryByKey", { get(){ return require(' + JSON.stringify(__filename) + ').__HISTORY_BY_KEY__; }, configurable:true });\n';
  const src = shim + FN_NAMES.map(name => extractFnSource(app, name)).join('\n') + '\nmodule.exports.resolveEmployeeAssignmentAt = resolveEmployeeAssignmentAt;';
  const m = new Module('checklist-resolver-sandbox');
  m.paths = Module._nodeModulePaths(__dirname);
  m._compile(src, path.join(__dirname, '__checklist-resolver-sandbox.js'));
  return m.exports.resolveEmployeeAssignmentAt;
}
// Expose the live fixtures on this module itself so the shim's require(__filename) sees them.
module.exports.__CURRENT_FORMS__ = null;
module.exports.__HISTORY_BY_KEY__ = null;
function reset() {
  CURRENT_FORMS = { phf012: { templateId: 'qtth-hcns-thang', templateVersion: 'TBP-HCNS-1.3', effectiveDate: '2026-09-12', updatedAt: '2026-09-12T03:00:00Z' } };
  HISTORY_BY_KEY = {
    phf012: [
      {
        employeeKey: 'phf012', employeeCode: 'PHF012',
        templateId: 'qtth-hcns-thang', templateVersion: 'TBP-HCNS-1.3', effectiveDate: '2026-09-12', changedAt: '2026-09-12T03:00:00Z',
        previousTemplateId: 'qtth-hcns-thang', previousTemplateVersion: 'TBP-HCNS-1.2', previousEffectiveDate: '2026-08-01'
      }
    ]
  };
  module.exports.__CURRENT_FORMS__ = CURRENT_FORMS;
  module.exports.__HISTORY_BY_KEY__ = HISTORY_BY_KEY;
}

function run() {
  reset();
  const resolveEmployeeAssignmentAt = buildResolver();
  const person = { code: 'PHF012', id: '', name: 'PHF012' };

  console.log('== Case 1: historical date (11/09) before current assignment (effective 12/09) ==');
  const r11 = resolveEmployeeAssignmentAt(person, '2026-09-11');
  check(!!r11, 'Case 1: a historical assignment IS found for 11/09 (not null / "không có phiên bản")');
  if (r11) {
    check(r11.templateId === 'qtth-hcns-thang', 'Case 1: templateId resolves to qtth-hcns-thang (got ' + r11.templateId + ')');
    check(r11.templateVersion === 'TBP-HCNS-1.2', 'Case 1: (informational) historical assignment pin was TBP-HCNS-1.2 (got ' + r11.templateVersion + ') - actual criteria version still comes from checklist_template_versions.effective_date via assignmentTemplateMeta(), this only proves the TEMPLATE_ID/date resolution step');
    check(r11.effectiveDate === '2026-08-01', 'Case 1: resolved effective_date is the historical 01/08, not the current 12/09 (got ' + r11.effectiveDate + ')');
  }

  console.log('== Case 2: cutover date (12/09) resolves the CURRENT assignment ==');
  const r12 = resolveEmployeeAssignmentAt(person, '2026-09-12');
  check(!!r12, 'Case 2: assignment found for 12/09');
  if (r12) {
    check(r12.effectiveDate === '2026-09-12', 'Case 2: resolves the current 12/09 effective_date (got ' + r12.effectiveDate + ')');
    check(r12.templateVersion === 'TBP-HCNS-1.3', 'Case 2: resolves the current pin TBP-HCNS-1.3 (got ' + r12.templateVersion + ')');
  }

  console.log('== Case 3: historical reassignment (template_id itself changed across periods) ==');
  reset();
  HISTORY_BY_KEY.phf012[0].previousTemplateId = 'nv-kho'; // employee used to be on a different template entirely
  HISTORY_BY_KEY.phf012[0].previousTemplateVersion = 'NVK-1.0';
  module.exports.__HISTORY_BY_KEY__ = HISTORY_BY_KEY;
  const resolveEmployeeAssignmentAt3 = buildResolver();
  const r3 = resolveEmployeeAssignmentAt3(person, '2026-08-15');
  check(!!r3 && r3.templateId === 'nv-kho', 'Case 3: a date under the OLD role resolves the OLD template_id (nv-kho), not the current qtth-hcns-thang (got ' + (r3 && r3.templateId) + ')');

  console.log('== Case 4: no eligible assignment before any known history -> null (not a wrong guess) ==');
  reset();
  const resolveEmployeeAssignmentAt4 = buildResolver();
  const r0 = resolveEmployeeAssignmentAt4(person, '2020-01-01');
  check(r0 === null, 'Case 4: a date before every known assignment/history row resolves to null, never a fabricated guess (got ' + JSON.stringify(r0) + ')');

  console.log(failures ? ('\n' + failures + ' FAIL') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}
run();
