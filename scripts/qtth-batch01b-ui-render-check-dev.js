'use strict';
/*
 * PHF HR — QTTH Batch 01B · UI render check (offline, no DB/network).
 * Loads the QTTH module app in a minimal DOM sandbox, feeds it a synthetic
 * roster (classified / unclassified / inactive / markup-injection rows) and
 * renders the Phân quyền table + drawer, asserting NO raw markup ever reaches
 * the user as visible text and escaping is intact.
 * Run: node scripts/qtth-batch01b-ui-render-check-dev.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'qtth', 'phf-qtth-app.js'), 'utf8');

// minimal DOM sandbox
function makeEl() {
  const el = { children: [], innerHTML: '', style: {}, hidden: false, dataset: {},
    setAttribute() {}, getAttribute() { return null; }, addEventListener() {},
    appendChild(c) { this.children.push(c); return c; }, removeChild() {}, remove() {},
    querySelector() { return makeEl(); }, querySelectorAll() { return []; }, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } };
  return el;
}
const window = { location: { pathname: '/admin/qtth/phan-quyen' }, phfGetSessionRole: () => 'admin' };
const document = { getElementById: () => makeEl(), createElement: makeEl, body: { classList: { add() {} }, appendChild() {} }, addEventListener() {} };
const fn = new Function('window', 'document', src + '\nreturn window.__phfQtthTestHooks;');
const H = fn(window, document);

let P = 0, F = 0;
const ck = (n, c, x) => { c ? (P++, console.log('  PASS  ' + n)) : (F++, console.error('  FAIL  ' + n + (x ? '  -> ' + x : ''))); };

// 1. unclassified chip renders as real markup, not escaped text
const u = H.classifiedCell('');
ck('unclassified CN cell = rendered chip (not literal <span>)',
  u === '<span class="phf-qtth-chip is-unset">Chưa phân loại</span>');

// 2. a dictionary name is escaped inside the chip
const n = H.classifiedCell('Kho <b>Cung Ứng</b> & "Online"');
ck('dictionary name escaped inside chip',
  n.startsWith('<span class="phf-qtth-chip">') && n.includes('&lt;b&gt;') && n.includes('&amp;') && n.includes('&quot;') && !n.includes('<b>'), n);

// 3. staff kind cells
ck('staff kind direct', H.staffKindCell('direct') === '<span class="phf-qtth-chip is-kind">Trực tiếp</span>');
ck('staff kind indirect', H.staffKindCell('indirect') === '<span class="phf-qtth-chip is-kind is-alt">Gián tiếp</span>');
ck('staff kind unset', H.staffKindCell(null) === '<span class="phf-qtth-chip is-unset">Chưa xác định</span>');

// 4. esc still strong (no security weakening)
ck('esc() unchanged / strong', H.esc('<script>&"\'') === '&lt;script&gt;&amp;&quot;&#39;');

// 4b. render a full roster table with hostile data — nothing leaks as text
const roster = H.renderRosterHtml({
  period: '2026-09',
  units: [{ id: 'u1', name: 'Kho <b>Cung Ứng</b>', isActive: true }],
  groups: [{ id: 'g1', name: 'Nhóm & Co', isActive: true }],
  roster: [
    { employeeCode: 'PHF001', fullName: 'Nguyễn <script>A', status: 'active', sourceDepartment: 'Bán hàng', unitId: 'u1', groupId: 'g1', staffKind: 'direct', canViewQtth: true, canViewOperations: false, sourceDepartmentChanged: false },
    { employeeCode: 'PHF002', fullName: 'Trần B', status: 'active', sourceDepartment: 'Kho', unitId: null, groupId: null, staffKind: null, canViewQtth: false, canViewOperations: false, sourceDepartmentChanged: true, sourceDepartmentSnapshot: 'Cũ' },
    { employeeCode: 'PHF003', fullName: 'Lê C', status: 'inactive', sourceDepartment: '', unitId: null, groupId: null, staffKind: null, canViewQtth: false, canViewOperations: false },
  ],
  permissionManagers: [],
  warnings: { newNoPermission: 1, incompleteClassification: 2, sourceDepartmentChanged: 1 },
}, '2026-09');
ck('roster: unclassified rows show the chip, not literal markup', roster.includes('<span class="phf-qtth-chip is-unset">Chưa phân loại</span>') && roster.includes('Chưa xác định'));
ck('roster: hostile employee name is escaped', roster.includes('Nguyễn &lt;script&gt;A') && !roster.includes('<script>A'));
ck('roster: hostile dictionary name is escaped in the chip', roster.includes('Kho &lt;b&gt;Cung Ứng&lt;/b&gt;'));
ck('roster: no un-rendered "phf-qtth-unclassified" leftover class', !roster.includes('phf-qtth-unclassified'));
ck('roster: no visible escaped span text (&lt;span class=)', !roster.includes('&lt;span class='));

// 5. no source file path still funnels markup through esc()
const badPattern = /esc\([^)]*['"`]\s*<[a-z]/i;
ck('no esc(<markup>) pattern remains in phf-qtth-app.js', !badPattern.test(src),
  (src.match(badPattern) || [''])[0]);

// 6. CSS: approved direction kept, forbidden techniques absent
const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'css', 'phf-qtth.css'), 'utf8');
ck('CSS keeps strong orange #E1500A', css.includes('#E1500A'));
ck('CSS: no blur/backdrop-filter', !/backdrop-filter|filter:\s*blur/i.test(css));
ck('CSS: no hazy gradient background', !/linear-gradient|radial-gradient/i.test(css));
ck('CSS: workspace widened (>=1800px shell)', /max-width:1840px/.test(css));
ck('CSS: header compacted (logo 20px, 2px rule)', /\.phf-qtth-logo\{height:20px/.test(css) && /border-bottom:2px solid var\(--qt-orange\)/.test(css));
ck('CSS: rows are table cells, not cards (no card-ification of tr)', !/\.phf-qtth-table tr\{[^}]*border-radius/.test(css));

console.log('\n' + P + '/' + (P + F) + ' render-check assertions passed' + (F ? '  — FAIL' : '  — ALL PASS'));
process.exit(F ? 1 : 0);
