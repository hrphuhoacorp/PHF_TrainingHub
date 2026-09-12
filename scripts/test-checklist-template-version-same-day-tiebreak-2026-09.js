'use strict';
/* Regression - checklistTemplateVersions() same-day tie-break (2026-09-12).
 *
 * PROD evidence: qtth-hcns-thang had 1.2 (eff 2026-08-01), then 1.3/1.4/1.5 all published
 * the SAME day (eff 2026-09-12, current_version=1.5). Ghi nhận lỗi for 11/09 correctly
 * showed 1.2, but 12/09 incorrectly rendered the SAME (stale) criteria as 11/09.
 *
 * Root cause: checklistTemplateVersions() sorted ascending by effectiveDate ONLY. Array.sort
 * is stable, so same-effectiveDate entries kept their pre-sort order (created_at DESC, from
 * backend publicTemplate()) - putting the OLDEST-created of the tied group LAST in the final
 * ascending array. assignmentTemplateMeta()'s "last match wins" forEach then picked that
 * oldest-created version (1.3) instead of the newest (1.5) - the opposite of the backend
 * canonical resolveTemplateVersionAt() (ORDER BY effective_date DESC, created_at DESC LIMIT 1).
 *
 * Fix: add createdAt ASC as a secondary sort key inside checklistTemplateVersions() only -
 * assignmentTemplateMeta()'s "last match wins" logic is unchanged and now naturally lands on
 * the newest-created version among same-day ties.
 *
 * This file extracts the REAL function source (brace-counted, not a hand-written
 * reimplementation) from assets/js/checklist/phf-checklist-app.js and runs it against a
 * PHF012-shaped fixture (qtth-hcns-thang, same-day 1.3/1.4/1.5 tie) - same convention as
 * scripts/test-checklist-violation-historical-assignment-resolution-2026-09.js.
 *
 * Manual only:
 *   node scripts/test-checklist-template-version-same-day-tiebreak-2026-09.js
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
// Brace-counting extractor (robust to multi-line function bodies whose closing brace is not
// on its own 2-space-indented line, unlike the simpler regex used by older sibling tests).
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

const FN_NAMES = ['normalizeText', 'checklistIsoDate', 'normalizeLegacyTemplateId', 'templateById', 'checklistTemplateDatabaseRow', 'checklistTemplateStatus', 'checklistTemplateStatusLabel', 'checklistTemplateCanAssign', 'checklistTemplateVersions', 'assignmentTemplateMeta'];
FN_NAMES.forEach(name => check(new RegExp('function ' + name + '\\(').test(app), 'source has function ' + name + '()'));
check(/createdAt/.test(extractFnSource(app, 'checklistTemplateVersions')), 'checklistTemplateVersions() comparator references createdAt (secondary sort key present)');

function buildSandbox(row) {
  const shim =
    'var checklistTemplateDbState = { byId: { "qtth-hcns-thang": ' + JSON.stringify(row) + ' } };\n' +
    'function ensureChecklistTemplatesHydrated(){}\n' +
    'function templateCatalog(){ return []; }\n';
  const src = shim + FN_NAMES.map(name => extractFnSource(app, name)).join('\n') + '\nmodule.exports = { checklistTemplateVersions, assignmentTemplateMeta };';
  const m = new Module('checklist-tiebreak-sandbox-' + Date.now() + Math.random());
  m.paths = Module._nodeModulePaths(path.dirname(appPath));
  m._compile(src, path.join(path.dirname(appPath), '__checklist-tiebreak-sandbox.js'));
  return m.exports;
}

// PHF012-shape fixture: 1.3/1.4/1.5 ALL effective 2026-09-12 (same-day tie), created_at
// strictly increasing (1.3 first, 1.5 last = the true current/newest). Array order as
// delivered by backend publicTemplate() (sorted created_at DESC -> newest first).
const ROW = {
  version: 'TBP-HCNS-1.5',
  effectiveDate: '2026-09-12',
  status: 'active',
  name: 'QTTH/HCNS – Trưởng bộ phận',
  versions: [
    { version: 'TBP-HCNS-1.5', effectiveDate: '2026-09-12', createdAt: '2026-09-12T10:00:00Z', definition: { groups: new Array(6).fill(0) } },
    { version: 'TBP-HCNS-1.4', effectiveDate: '2026-09-12', createdAt: '2026-09-12T09:00:00Z', definition: { groups: new Array(6).fill(0) } },
    { version: 'TBP-HCNS-1.3', effectiveDate: '2026-09-12', createdAt: '2026-09-12T08:00:00Z', definition: { groups: new Array(5).fill(0) } },
    { version: 'TBP-HCNS-1.2', effectiveDate: '2026-08-01', createdAt: '2026-08-01T00:00:00Z', definition: { groups: new Array(5).fill(0) } }
  ]
};

function run() {
  const { checklistTemplateVersions, assignmentTemplateMeta } = buildSandbox(ROW);

  console.log('== checklistTemplateVersions() exact order (same-day tie) ==');
  const versions = checklistTemplateVersions('qtth-hcns-thang');
  check(versions.length === 4, 'returns all 4 versions');
  check(versions[0].version === 'TBP-HCNS-1.2', 'oldest effectiveDate (1.2) sorts first');
  check(versions[1].version === 'TBP-HCNS-1.3' && versions[2].version === 'TBP-HCNS-1.4' && versions[3].version === 'TBP-HCNS-1.5',
    'same-day trio (1.3/1.4/1.5) now sorted ASCENDING by createdAt (oldest-created first, newest-created LAST) - got order: ' + versions.slice(1).map(v => v.version).join(', '));

  console.log('== Same-day tie: assignmentTemplateMeta(...,\'2026-09-12\') must pick the NEWEST-created version ==');
  const meta12 = assignmentTemplateMeta('qtth-hcns-thang', '2026-09-12');
  check(meta12.version === 'TBP-HCNS-1.5', 'resolves TBP-HCNS-1.5 (newest created among the 12/09 tie), matching backend ORDER BY effective_date DESC, created_at DESC (got ' + meta12.version + ')');

  console.log('== Historical guard: 2026-09-11 (no tie) is unaffected, still resolves 1.2 ==');
  const meta11 = assignmentTemplateMeta('qtth-hcns-thang', '2026-09-11');
  check(meta11.version === 'TBP-HCNS-1.2', 'resolves TBP-HCNS-1.2 for 11/09 (unchanged by this fix, got ' + meta11.version + ')');

  console.log(failures ? ('\n' + failures + ' FAIL') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}
run();
