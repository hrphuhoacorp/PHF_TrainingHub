'use strict';
/*
 * Regression — "MKT VIDEO CONTENT CREATOR" publish-blocked audit fix (2026-09-13).
 *
 * PROD symptom: a brand-new template authored via "＋ Tạo mẫu" showed a Bảng tổng điểm row
 * whose UI clearly displayed "Điểm Checklist tự động", yet publishing (via Quản lý tiêu chí ->
 * "Lưu & áp dụng") failed with CHECKLIST_TEMPLATE_CHECKLIST_TOTAL_ROW_MISSING.
 *
 * Root cause: saveNewTemplate() (assets/js/checklist/phf-checklist-app.js) wrote the total-row
 * "Nguồn kết quả" as a raw STRING ('Checklist'/'Hệ thống'/'Nhập đánh giá') at array index 7 —
 * the same string shape the create-template modal's <select> uses for display
 * (createSummaryRowsHtml()). The server's Connection-Gate validator (isChecklistTotalRow /
 * rowSourceType in api/_lib/checklist-templates.js) is DELIBERATELY strict and only recognizes
 * an explicit object at index 7 ({type:'checklist_total'|'manual'}) — never a string, never
 * name-sniffing. Several OTHER rendering paths (isAutomaticSource() in
 * api/_lib/checklist-monthly.js, the self-evaluation row renderer) ARE lenient about the raw
 * string, for backward compatibility with old published snapshots — which is exactly why the
 * UI displayed the row as correctly linked while the strict publish gate rejected it.
 *
 * Fix: saveNewTemplate() now emits the same object shape tseRowsForDefinition()/
 * tseNormalizeRow() already use for the "Sửa Bảng tổng điểm" editor, via a small
 * totalRowSourceObject(sourceLabel) helper. This is the ONE convergence point for both "＋ Tạo
 * mẫu" entry modes — direct manual entry AND Excel "BẢNG TỔNG" upload (parseBulkWorkbook ->
 * applyNewTemplateImport -> newTemplateDraft.summaryRows -> syncCreateRows -> saveNewTemplate)
 * both funnel into this exact function, so fixing it here fixes both without touching the
 * importer's own string-based dropdown state.
 *
 * This test loads the REAL frontend source in a vm sandbox (same convention as
 * scripts/test-checklist-retro-decision-ui-v1.js — no jsdom needed, no click simulation) and
 * calls the REAL saveNewTemplate()/loadBulkOverride() functions, then feeds the REAL resulting
 * totalRows through the REAL server-side validateScoredDefinition() (api/_lib/checklist-
 * templates.js) — the same gate that blocked the real Admin in PROD. The backend validator
 * itself is NOT touched or relaxed by this fix; these tests prove that unchanged.
 *
 *   node scripts/test-checklist-new-template-total-row-source-2026-09.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');

const { validateScoredDefinition, isChecklistTotalRow, rowSourceType } = require('../api/_lib/checklist-templates.js');

let failures = 0, passed = 0;
function check(name, fn) {
  try { fn(); console.log('PASS: ' + name); passed++; }
  catch (e) { failures++; console.error('FAIL: ' + name + '\n  ' + (e && e.stack ? e.stack : e)); }
}

const filePath = 'assets/js/checklist/phf-checklist-app.js';
const src = fs.readFileSync(path.join(root, filePath), 'utf8');
const marker = '\n})();';
const idx = src.lastIndexOf(marker);
const expose = "\n  window.__newTemplateTest={\n" +
  "    saveNewTemplate: saveNewTemplate,\n" +
  "    loadBulkOverride: loadBulkOverride,\n" +
  "    setSuppress: function(v){checklistTemplateDbState.suppress=v;},\n" +
  "    tseRowsForDefinition: tseRowsForDefinition,\n" +
  "    tseNormalizeRow: tseNormalizeRow\n" +
  "  };\n";
const testSrc = src.slice(0, idx) + expose + src.slice(idx);
const compiled = new vm.Script(testSrc, { filename: filePath });

function makeLocalStorage() { const data = {}; return { getItem: k => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; } }; }

function makeSandbox() {
  const noop = function () {};
  const sandbox = {};
  sandbox.window = sandbox; sandbox.console = console;
  sandbox.addEventListener = noop; sandbox.removeEventListener = noop; sandbox.dispatchEvent = noop;
  sandbox.PHF_BUILD_INFO = { version: 'test', fingerprint: 'test' };
  sandbox.document = {
    documentElement: { setAttribute: noop, getAttribute: () => null }, addEventListener: noop, removeEventListener: noop,
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute: noop, addEventListener: noop, classList: { add: noop, remove: noop } }),
    body: { classList: { add: noop, remove: noop } }, readyState: 'complete'
  };
  sandbox.location = { pathname: '/admin/checklist/mau', search: '', hash: '', origin: 'http://localhost' };
  sandbox.history = { pushState: noop, replaceState: noop, state: null };
  sandbox.localStorage = makeLocalStorage(); sandbox.sessionStorage = makeLocalStorage();
  sandbox.navigator = { userAgent: 'node-test' };
  sandbox.matchMedia = null;
  sandbox.MutationObserver = function () { return { observe: noop, disconnect: noop }; };
  sandbox.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
  sandbox.URL = URL; sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout;
  sandbox.requestAnimationFrame = fn => setTimeout(fn, 0);
  sandbox.CSS = { escape: v => String(v) };
  sandbox.__phfLocalData = null;
  const ctx = vm.createContext(sandbox);
  compiled.runInContext(ctx);
  return ctx.window;
}

// ---------------------------------------------------------------------------
// Scenario 1 — web-created brand-new checklist_detail template ("＋ Tạo mẫu" -> "Nhập trực
// tiếp"): one automatic checklist row + one manual row, exactly the hardcoded shape
// saveNewTemplate() builds for isDetail templates.
// ---------------------------------------------------------------------------
{
  const win = makeSandbox();
  const api = win.__newTemplateTest;
  api.setSuppress(true);

  const item = api.saveNewTemplate({
    id: 'nv-mkt-video-content-creator', name: 'Nhân viên MKT VIDEO CONTENT CREATOR', code: 'NV-MKT-VCC',
    group: 'Marketing', type: 'checklist_detail', effectiveDate: '2026-09-13',
    reason: 'Tạo mẫu mới cho MKT Video Content Creator',
    criteria: [{ code: 'MKT-VCC-01', content: 'Sản xuất video theo kế hoạch nội dung', factor: 1 }],
    summaryRows: []
  });

  check('Scenario 1 (web-created checklist_detail): saveNewTemplate() succeeds', () => {
    assert.ok(item, 'saveNewTemplate returned a falsy value (should return the created item)');
  });

  const override = api.loadBulkOverride('nv-mkt-video-content-creator');
  check('Scenario 1: totalRows built by saveNewTemplate() now carry an OBJECT source (not a raw string) at index 7', () => {
    assert.ok(override && Array.isArray(override.totalRows) && override.totalRows.length === 2, 'expected the 2 hardcoded totalRows');
    override.totalRows.forEach(row => {
      assert.strictEqual(typeof row[7], 'object', 'row[7] must be an object, not a string (PROD bug: was the raw string "Checklist"/"Nhập đánh giá")');
      assert.ok(row[7] && typeof row[7].type === 'string', 'row[7] must carry an explicit .type field');
    });
  });

  check('Scenario 1: the "Tuân thủ tiêu chuẩn công việc" row maps to {type:\'checklist_total\'}', () => {
    const checklistRow = override.totalRows.find(r => r[2] === 'Tuân thủ tiêu chuẩn công việc');
    assert.ok(checklistRow, 'checklist row found');
    assert.strictEqual(checklistRow[7] && checklistRow[7].type, 'checklist_total');
    assert.strictEqual(Object.keys(checklistRow[7]).length, 1, 'no stray extra fields on the source object');
    assert.strictEqual(isChecklistTotalRow(checklistRow), true, 'the REAL server-side isChecklistTotalRow() recognizes it');
  });

  check('Scenario 1: the "Công việc cấp trên giao" row maps to {type:\'manual\'} (ordinary row stays manual)', () => {
    const manualRow = override.totalRows.find(r => r[2] === 'Công việc cấp trên giao');
    assert.ok(manualRow);
    assert.strictEqual(manualRow[7] && manualRow[7].type, 'manual');
    assert.strictEqual(Object.keys(manualRow[7]).length, 1, 'no stray extra fields on the source object');
    assert.strictEqual(isChecklistTotalRow(manualRow), false);
  });

  check('Scenario 1: definition now PASSES the real publish gate (validateScoredDefinition does not throw) — this is the exact PROD failure being fixed', () => {
    const definition = { groups: override.groups, totalRows: override.totalRows, templateType: override.templateType };
    assert.doesNotThrow(() => validateScoredDefinition(definition));
  });
}

// ---------------------------------------------------------------------------
// Scenario 2 — Excel "BẢNG TỔNG" import path (score_summary type). parseBulkWorkbook's sheet
// parser (assets/js/checklist/phf-checklist-app.js ~line 3919) and applyNewTemplateImport()/
// syncCreateRows() both populate data.summaryRows[].source as a plain STRING label
// ('Checklist'/'Hệ thống'/'Nhập đánh giá') — exactly reproduced here — because that string
// feeds the create-template modal's <select> for display. saveNewTemplate() must still convert
// it to the object shape at the point it becomes real totalRows.
// ---------------------------------------------------------------------------
{
  const win = makeSandbox();
  const api = win.__newTemplateTest;
  api.setSuppress(true);

  const item = api.saveNewTemplate({
    id: 'nv-mkt-excel-import', name: 'Nhân viên MKT Excel Import', code: 'NV-MKT-XLS',
    group: 'Marketing', type: 'score_summary', effectiveDate: '2026-09-13',
    reason: 'Tạo mẫu từ file Excel BẢNG TỔNG',
    criteria: [],
    // Exact shape parseBulkWorkbook's score_summary branch pushes into summaryRows: source is a
    // plain string, never an object.
    summaryRows: [
      { code: 'CT-01', content: 'Tuân thủ Checklist công việc', target: 100, unit: 'điểm', weight: 60, source: 'Checklist' },
      { code: 'CT-02', content: 'Sản xuất nội dung theo kế hoạch', target: 10, unit: 'video', weight: 40, source: 'Nhập đánh giá' }
    ]
  });

  check('Scenario 2 (Excel-imported score_summary): saveNewTemplate() succeeds', () => {
    assert.ok(item);
  });

  const override = api.loadBulkOverride('nv-mkt-excel-import');
  check('Scenario 2: Excel-sourced "Checklist" string label is converted to {type:\'checklist_total\'} object shape', () => {
    const row = override.totalRows.find(r => r[1] === 'CT-01');
    assert.ok(row);
    assert.strictEqual(typeof row[7], 'object', 'must not remain the raw string "Checklist"');
    assert.strictEqual(row[7] && row[7].type, 'checklist_total');
    assert.strictEqual(rowSourceType(row), 'checklist_total', 'the REAL server-side rowSourceType() recognizes it');
  });

  check('Scenario 2: Excel-sourced "Nhập đánh giá" string label is converted to {type:\'manual\'}', () => {
    const row = override.totalRows.find(r => r[1] === 'CT-02');
    assert.ok(row);
    assert.strictEqual(row[7] && row[7].type, 'manual');
  });

  check('Scenario 2: resulting definition passes validateScoredDefinition() with no error', () => {
    const definition = { groups: override.groups, totalRows: override.totalRows, templateType: override.templateType };
    assert.doesNotThrow(() => validateScoredDefinition(definition));
  });
}

// ---------------------------------------------------------------------------
// Scenario 3 — a row whose Excel/manual source is 'Hệ thống' (the third legacy label) must
// still map to 'manual' under the strict two-value schema {'checklist_total'|'manual'} — the
// fix does not invent a third validator-recognized type, matching the instruction to not touch
// validator semantics.
// ---------------------------------------------------------------------------
{
  const win = makeSandbox();
  const api = win.__newTemplateTest;
  api.setSuppress(true);
  api.saveNewTemplate({
    id: 'nv-mkt-he-thong-source', name: 'Nhân viên MKT Hệ thống', code: 'NV-MKT-HT',
    group: 'Marketing', type: 'score_summary', effectiveDate: '2026-09-13', reason: 'Kiểm tra nguồn Hệ thống',
    criteria: [], summaryRows: [
      { code: 'CT-01', content: 'Chỉ tiêu hệ thống', target: 100, unit: 'điểm', weight: 100, source: 'Hệ thống' }
    ]
  });
  const override = api.loadBulkOverride('nv-mkt-he-thong-source');
  check('Scenario 3: "Hệ thống" label maps to {type:\'manual\'} (no unrecognized third type reaches the validator)', () => {
    const row = override.totalRows[0];
    assert.strictEqual(row[7] && row[7].type, 'manual');
  });
}

// ---------------------------------------------------------------------------
// Scenario 4 — no regression to the existing "Sửa Bảng tổng điểm" (TSE editor) path: that
// path's own object-shape builder/loader are untouched by this fix.
// ---------------------------------------------------------------------------
{
  const win = makeSandbox();
  const api = win.__newTemplateTest;
  check('Scenario 4: tseRowsForDefinition() unaffected — still emits {type:\'checklist_total\'} for a row whose live state.source.type is checklist_total', () => {
    const rows = api.tseRowsForDefinition([{ id: 'R1', name: 'Tuân thủ Checklist', target: 100, unit: 'điểm', weight: 100, source: { type: 'checklist_total' }, note: '' }]);
    assert.strictEqual(rows[0].source && rows[0].source.type, 'checklist_total');
    assert.strictEqual(isChecklistTotalRow(rows[0]), true);
  });
  check('Scenario 4: tseNormalizeRow() unaffected — still requires the object shape when loading an EXISTING array-format row (object shape recognized, raw string still treated as manual by design)', () => {
    const objectShapeRow = [1, 'CT-01', 'Tuân thủ Checklist', 100, 'điểm', 100, 'Không', { type: 'checklist_total' }, 'CT-01'];
    const normalized = api.tseNormalizeRow(objectShapeRow, 0);
    assert.strictEqual(normalized.source.type, 'checklist_total');
    const rawStringRow = [1, 'CT-02', 'Tuân thủ tiêu chuẩn công việc', 100, 'điểm', 100, 'Không', 'Checklist', 'CT-02'];
    const normalizedLegacy = api.tseNormalizeRow(rawStringRow, 0);
    assert.strictEqual(normalizedLegacy.source.type, 'manual', 'unchanged pre-existing behavior for any already-published legacy row still carrying a raw string — this fix only changes what NEW templates emit going forward, it does not retroactively touch old published snapshots');
  });
}

console.log('\n' + passed + ' PASS, ' + failures + ' FAIL');
if (failures > 0) process.exit(1);
