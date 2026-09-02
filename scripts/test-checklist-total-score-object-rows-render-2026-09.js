'use strict';
/*
 * Regression — Admin "Bảng tổng điểm" renderer must handle OBJECT-shaped totalRows.
 *
 * PROD bug after BH-2.0 activation: the score table on Checklist → Mẫu → Nhân viên bán hàng
 * → Bảng tổng điểm rendered blank titles, "undefined" targets, "NaN%" weights, "0% · Cần điều
 * chỉnh", and every row showed source "Nhập đánh giá".
 * Root cause: overrideTotalScoreHtml() read rows positionally (r[2]/r[3]/r[5]/r[7]) but the
 * score-table editor / checklistRetroCopyVersion (tseRowsForDefinition) stores rows as OBJECTS
 * {id,code,name,target,unit,weight,source:{type},note}. BH-1.0 rows were legacy arrays so it
 * used to "work"; BH-2.0 rows are objects.
 *
 * Real DOM (jsdom), real render path. Stored definition is NOT mutated — renderer only.
 *   node scripts/test-checklist-total-score-object-rows-render-2026-09.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const appPath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const cssPath = path.resolve(__dirname, '..', 'assets/css/phf-checklist.css');
const code = fs.readFileSync(appPath, 'utf8');
const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';

let failures = 0, passes = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); failures++; } else { passes++; console.log('PASS: ' + msg); } }
function click(window, el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
function tick(n) { return new Promise(r => setTimeout(r, n || 30)); }
function response(data) { return { ok: true, status: 200, json: async () => data }; }

// BH-2.0 canonical definition — OBJECT rows, exactly what tseRowsForDefinition / copyVersion write.
const BH2_DEF = {
  templateType: 'score_summary',
  groups: [],
  totalRows: [
    { id: 'HQCV-TUANTHU', code: 'HQCV-TUANTHU', name: 'Tuân thủ tiêu chuẩn công việc', target: 100, unit: 'điểm', weight: 70, source: { type: 'checklist_total' }, note: '' },
    { id: 'HQCV-CAPTREN', code: 'HQCV-CAPTREN', name: 'Công việc cấp trên giao', target: 10, unit: 'điểm', weight: 30, source: { type: 'manual' }, note: '' }
  ]
};
// A legacy ARRAY-row version to prove the renderer still handles the old shape.
const LEGACY_DEF = {
  templateType: 'score_summary', groups: [],
  totalRows: [
    [1, 'L-01', 'Chỉ tiêu cũ A', 100, 'điểm', 60, 'Không', { type: 'checklist_total' }, 'L-01'],
    [2, 'L-02', 'Chỉ tiêu cũ B', 10, 'điểm', 40, 'Không', { type: 'manual' }, 'L-02']
  ]
};

async function buildDom(templates) {
  const dom = new JSDOM('<!doctype html><html><head><style>' + css + '</style></head><body><div id="phfChecklistRoot"></div></body></html>',
    { url: 'http://localhost/admin/checklist/mau', runScripts: 'outside-only' });
  const { window } = dom;
  window.phfGetSessionRole = () => 'admin';
  window.phfGetCurrentUser = () => ({ id: 'admin-1', employeeCode: 'PHF000', name: 'Admin' });
  window.phfGetAuthenticatedUser = window.phfGetCurrentUser;
  window.requestAnimationFrame = fn => setTimeout(fn, 0);
  window.requestIdleCallback = fn => setTimeout(fn, 0);
  window.scrollTo = () => {};
  window.fetch = async () => response({ ok: true });
  window.__phfLocalData = { checklistTemplates: templates, checklistTemplatesReady: true, checklistTemplatesError: '' };
  window.eval(code);
  return dom;
}
function tpl(key, name, def, version) {
  return { templateKey: key, code: key.toUpperCase().replace(/[^A-Z0-9]/g, ''), name: name, groupName: 'Bán hàng',
    templateType: 'score_summary', hasChecklist: false, source: '', note: '', status: 'active',
    version: version, effectiveDate: '2026-09-01', updatedAt: '2026-09-01T00:00:00Z', definition: def,
    versions: [{ version: version, effectiveDate: '2026-09-01', reason: 'seed', sourceVersion: '', changeType: 'sync', createdAt: '2026-09-01T00:00:00Z', definition: def }] };
}

async function renderTotalTab(templates, key) {
  const dom = await buildDom(templates);
  const { window } = dom;
  await window.phfRenderChecklist('/admin/checklist/mau');
  await tick();
  const root = window.document.getElementById('phfChecklistRoot');
  const detailBtn = root.querySelector('[data-phfck-template-detail="' + key + '"]');
  if (!detailBtn) throw new Error('no detail button for ' + key);
  click(window, detailBtn); await tick();
  const totalTab = root.querySelector('[data-phfck-sales-tab="total"]');
  if (totalTab) { click(window, totalTab); await tick(); }
  const table = root.querySelector('.phfck-total-table');
  return { root, table, html: table ? table.textContent : root.textContent };
}

(async () => {
  // ---- source-scan: the fix helper exists and overrideTotalScoreHtml no longer reads r[5] positionally only
  check(code.includes('function totalScoreRowView('), 'totalScoreRowView normalizer added');
  check(code.includes('function totalScoreSourceLabel('), 'totalScoreSourceLabel added');
  check(/overrideTotalScoreHtml\([\s\S]{0,400}totalScoreRowView/.test(code), 'overrideTotalScoreHtml uses totalScoreRowView');

  // ---- CASE: BH-2.0 object rows render correctly
  {
    const { table, html } = await renderTotalTab([tpl('nv-bh-obj', 'Nhân viên bán hàng (obj)', BH2_DEF, 'BH-2.0')], 'nv-bh-obj');
    check(!!table, 'object-row template renders a .phfck-total-table');
    check(html.includes('Tuân thủ tiêu chuẩn công việc'), 'row 1 title renders (not blank)');
    check(html.includes('Công việc cấp trên giao'), 'row 2 title renders');
    check(!html.includes('undefined'), 'no "undefined" in the table');
    check(!html.includes('NaN'), 'no "NaN" in the table');
    check(html.includes('70%'), 'row 1 weight = 70%');
    check(html.includes('30%'), 'row 2 weight = 30%');
    check(/100\s*%/.test(html) && html.includes('Hợp lệ'), 'total = 100% · Hợp lệ');
    check(html.includes('Điểm Checklist tự động'), 'checklist_total row source label = "Điểm Checklist tự động"');
    check(html.includes('Nhập đánh giá'), 'manual row source label = "Nhập đánh giá"');
    check((html.match(/Điểm Checklist tự động/g) || []).length === 1, 'exactly ONE row shows "Điểm Checklist tự động"');
  }

  // ---- CASE: legacy array rows still render correctly (no regression)
  {
    const { table, html } = await renderTotalTab([tpl('nv-bh-arr', 'Nhân viên bán hàng (arr)', LEGACY_DEF, 'L-1.0')], 'nv-bh-arr');
    check(!!table, 'legacy array-row template still renders a table');
    check(html.includes('Chỉ tiêu cũ A') && html.includes('Chỉ tiêu cũ B'), 'legacy titles render');
    check(!html.includes('undefined') && !html.includes('NaN'), 'legacy: no undefined/NaN');
    check(html.includes('60%') && html.includes('40%') && /100\s*%/.test(html) && html.includes('Hợp lệ'), 'legacy weights 60/40, total 100% Hợp lệ');
    check(html.includes('Điểm Checklist tự động'), 'legacy array row with {type:checklist_total} still labelled "Điểm Checklist tự động"');
  }

  console.log('\n' + passes + ' PASS' + (failures ? (' / ' + failures + ' FAIL') : ''));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
