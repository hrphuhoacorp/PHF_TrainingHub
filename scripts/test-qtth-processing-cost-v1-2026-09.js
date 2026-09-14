'use strict';
/*
 * PHF HR — QTTH Truth Data · "Chi phí xử lý" (Processing cost V1) — LOCAL checks.
 *
 * Covers the LOCAL_TEST_RESULTS checklist for this batch (offline, no DB, no
 * network — this box has no reachable local/throwaway Postgres, see report):
 *   1. Truth Data landing renders 2 groups w/ correct card membership
 *   2. Routing: all 3 CHI PHÍ NHÂN SỰ cards + Accounting route correctly
 *   3. Template download: 3-column schema + version marker + no real data
 *   4. employee_code stays TEXT end-to-end (leading-zero-like code preserved)
 *   5. amount parses numeric
 *   6. Re-upload same period -> new version supersedes old (no silent overwrite)
 *   7. Unknown employee_code -> visible in preview but BLOCKS confirm (never
 *      fuzzy/name-mapped; resolved only by correcting/removing it and re-upload)
 *   8. Within-file duplicate employee_code -> excluded entirely (never a chosen
 *      winner), reported as an explicit blocker, and BLOCKS confirm
 *
 * Run: node scripts/test-qtth-processing-cost-v1-2026-09.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const REPO = path.resolve(__dirname, '..');

let P = 0, F = 0;
const ck = (n, c, x) => { c ? (P++, console.log('  PASS  ' + n)) : (F++, console.error('  FAIL  ' + n + (x ? '  -> ' + x : ''))); };
console.log('QTTH Processing Cost V1 — local checks\n');

/* =====================================================================
 * 1 + 2 — LANDING GROUPING + ROUTING (vm-sandbox over the real browser JS,
 * same convention as scripts/test-checklist-template-list-current-version-2026-09.js)
 * ===================================================================== */
(function landingAndRouting() {
  console.log('-- 1+2: Truth Data landing grouping + routing --');
  const filePath = 'assets/js/qtth/phf-qtth-payroll.js';
  const src = fs.readFileSync(path.join(REPO, filePath), 'utf8');

  function makeSlot() {
    const el = {
      _html: '',
      set innerHTML(v) { this._html = v; },
      get innerHTML() { return this._html; },
      querySelector() { return null; },
      querySelectorAll(sel) {
        if (sel === '[data-td-open]') {
          const re = /data-td-open="([^"]*)"/g; let m; const out = [];
          while ((m = re.exec(this._html))) { const v = m[1]; out.push({ getAttribute: () => v, set onclick(f) {}, get onclick() { return null; } }); }
          return out;
        }
        return [];
      },
    };
    return el;
  }

  function freshSandbox() {
    const sandbox = {};
    sandbox.window = sandbox; sandbox.console = console;
    sandbox.__qtthShared = { esc: (v) => String(v == null ? '' : v), call: () => Promise.reject(new Error('no-network-in-test')), toast: () => {}, go: () => {}, prefix: () => '/admin', currentPeriod: () => '2026-09' };
    const ctx = vm.createContext(sandbox);
    new vm.Script(src, { filename: filePath }).runInContext(ctx);
    return ctx.window;
  }

  // ---- 1. landing grouping ----
  const w1 = freshSandbox();
  const slot1 = makeSlot();
  w1.phfQtthRenderTruthData(slot1, {}, 'truth-data');
  const html = slot1.innerHTML;
  const GROUP_TITLE_RE = /<h3 class="phf-qtth-td-group-title">([^<]*)<\/h3>/g;
  const groupTitles = []; let gm; while ((gm = GROUP_TITLE_RE.exec(html))) groupTitles.push(gm[1]);
  const idxPersonnel = html.indexOf('<h3 class="phf-qtth-td-group-title">Chi phí nhân sự</h3>');
  const idxOperating = html.indexOf('<h3 class="phf-qtth-td-group-title">Chi phí hoạt động</h3>');
  const idxPayroll = html.indexOf('data-td-open="payroll"');
  const idxBhxh = html.indexOf('data-td-open="bhxh"');
  const idxProcCost = html.indexOf('data-td-open="chi-phi-xu-ly"');
  const idxAccounting = html.indexOf('data-td-open="accounting"');
  ck('renders exactly 2 group headings ("Chi phí nhân sự", "Chi phí hoạt động")',
    groupTitles.length === 2 && groupTitles[0] === 'Chi phí nhân sự' && groupTitles[1] === 'Chi phí hoạt động', JSON.stringify(groupTitles));
  ck('CHI PHÍ NHÂN SỰ group = Payroll + BHXH + Chi phí xử lý, in that region',
    idxPersonnel >= 0 && idxOperating > idxPersonnel &&
    idxPayroll > idxPersonnel && idxPayroll < idxOperating &&
    idxBhxh > idxPersonnel && idxBhxh < idxOperating &&
    idxProcCost > idxPersonnel && idxProcCost < idxOperating,
    'personnel=' + idxPersonnel + ' operating=' + idxOperating + ' payroll=' + idxPayroll + ' bhxh=' + idxBhxh + ' procCost=' + idxProcCost);
  ck('CHI PHÍ HOẠT ĐỘNG group = Accounting only, after the group heading',
    idxAccounting > idxOperating, 'accounting=' + idxAccounting + ' operating=' + idxOperating);

  // ---- 2. routing: each card opens its correct screen ----
  function routesTo(key, globalFnName, expectSubstringIfNoFn) {
    const w = freshSandbox();
    let called = false;
    w[globalFnName] = function () { called = true; };
    const slot = makeSlot();
    w.phfQtthRenderTruthData(slot, {}, 'truth-data/' + key);
    return called;
  }
  ck('truth-data/bhxh routes to window.phfQtthRenderBhxh', routesTo('bhxh', 'phfQtthRenderBhxh'));
  ck('truth-data/chi-phi-xu-ly routes to window.phfQtthRenderProcessingCost', routesTo('chi-phi-xu-ly', 'phfQtthRenderProcessingCost'));
  ck('truth-data/accounting routes to window.phfQtthRenderAccounting (regression)', routesTo('accounting', 'phfQtthRenderAccounting'));
  // payroll has no external hand-off function — it renders in-file (renderPayroll).
  // Confirm it takes the payroll branch (not the landing / not another branch) by
  // checking the payroll-specific loading text appears synchronously.
  const wPayroll = freshSandbox();
  const slotPayroll = makeSlot();
  wPayroll.phfQtthRenderTruthData(slotPayroll, {}, 'truth-data/payroll');
  ck('truth-data/payroll routes to the payroll screen (in-file renderPayroll)', slotPayroll.innerHTML.indexOf('bảng lương') >= 0 || slotPayroll.innerHTML.indexOf('Bảng lương') >= 0, slotPayroll.innerHTML.slice(0, 120));
})();

/* =====================================================================
 * 3 — TEMPLATE DOWNLOAD: schema + version marker + no real employee data
 * ===================================================================== */
(function templateChecks() {
  console.log('-- 3: template download --');
  const gen = require(path.join(REPO, 'scripts/qtth-processing-cost-generate-canonical-template'));
  const { readWorkbook } = require(path.join(REPO, 'services/phf-hr-api/lib/xlsx-lite'));
  gen.build();
  const buf = fs.readFileSync(gen.OUT);
  const wb = readWorkbook(buf);
  const rows = wb.sheets[0].rows;
  ck('template opens (.xlsx / PK signature)', buf.length > 500 && buf.readUInt16LE(0) === 0x4b50);
  ck('header row = MÃ NV | HỌ VÀ TÊN | CHI PHÍ XỬ LÝ, in this exact order',
    rows[0][0] === 'MÃ NV' && rows[0][1] === 'HỌ VÀ TÊN' && rows[0][2] === 'CHI PHÍ XỬ LÝ', JSON.stringify(rows[0]));
  ck('exactly 3 business columns', rows[0].length === 3, 'width=' + rows[0].length);
  const bodyText = JSON.stringify(rows);
  ck('version marker NOT in the sheet body', bodyText.indexOf(gen.VERSION_MARKER) < 0);
  ck('version marker present in docProps/core.xml', inflateFind(buf, 'docProps/core.xml').indexOf(gen.VERSION_MARKER) >= 0);
  const REAL_CODES = ['PHF004', 'PHF020', 'PHF026', 'PHF046'];
  const REAL_NAMES = ['Trần Gia Bảo Ngọc', 'Trần Thị Phương Huỳnh', 'Đinh Thị Như Quyên', 'Đặng Ngọc Như Quỳnh'];
  ck('template contains NO real employee code from the sample data', !REAL_CODES.some((c) => bodyText.includes(c)));
  ck('template contains NO real employee name from the sample data', !REAL_NAMES.some((n) => bodyText.includes(n)));
  ck('template row count is header + at most one placeholder row (no real data area)', rows.length <= 2, 'rows=' + rows.length);
})();
function inflateFind(buffer, partName) {
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) { if (buffer.readUInt32LE(i) === eocdSig) { eocd = i; break; } }
  if (eocd < 0) return '';
  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(p + 10);
    const compSize = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localOff = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === partName) {
      const nl = buffer.readUInt16LE(localOff + 26), el = buffer.readUInt16LE(localOff + 28);
      const ds = localOff + 30 + nl + el;
      const rawd = buffer.subarray(ds, ds + compSize);
      return (method === 8 ? zlib.inflateRawSync(rawd) : rawd).toString('utf8');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return '';
}

/* =====================================================================
 * 4 + 5 + 8 — PARSER/NORMALIZER: text employee_code, numeric amount,
 * within-file duplicate -> excluded entirely, never a chosen winner.
 * ===================================================================== */
(function normalizeChecks() {
  console.log('-- 4+5+8: normalizer (employee_code TEXT, amount numeric, in-file dup) --');
  const TPL = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-processing-cost-template'));
  const NRM = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-processing-cost-normalize'));

  // employee_code format check (per employee-master.js: alnum codes like "PHF004" —
  // leading zeros only ever occur AFTER a letter prefix, so the real regression
  // risk is Number()/parseInt() coercion anywhere in the pipeline, not literal
  // leading-zero loss on a bare numeric string).
  const grid = [
    ['MÃ NV', 'HỌ VÀ TÊN', 'CHI PHÍ XỬ LÝ'],
    ['PHF004', 'Trần Gia Bảo Ngọc', '9,000,000'],
    ['PHF020', 'Trần Thị Phương Huỳnh', '2000000'],
    ['PHF099', 'Dòng trùng — lần 1', '111'],
    ['PHF099', 'Dòng trùng — lần 2', '222'],
  ];
  const fp = TPL.fingerprint(grid);
  ck('template fingerprint locates the 3-column header', fp.ok === true);
  const nm = NRM.normalizeGrid(grid, fp.columnMap);
  ck('normalizeGrid ok', nm.ok === true);
  ck('rowCount = 2 (4 data rows; the 2 PHF099 duplicates are EXCLUDED ENTIRELY, not resolved to 1)', nm.rowCount === 2, 'rowCount=' + nm.rowCount);

  const r1 = nm.records.find((r) => r.employeeCode === 'PHF004');
  ck('4. employee_code stays a STRING/TEXT end-to-end (typeof === "string")', typeof r1.employeeCode === 'string', typeof r1.employeeCode);
  ck('4. employee_code value preserved verbatim ("PHF004", not coerced/trimmed to a number)', r1.employeeCode === 'PHF004');
  ck('5. amount parses to a numeric type (typeof === "number")', typeof r1.amount === 'number' && Number.isFinite(r1.amount), typeof r1.amount);
  ck('5. amount value correct after stripping thousands separators (9,000,000 -> 9000000)', r1.amount === 9000000, r1.amount);

  ck('8. within-file duplicate employee_code is NEVER persisted for EITHER row (no chosen winner)',
    !nm.records.some((r) => r.employeeCode === 'PHF099'), JSON.stringify(nm.records.map((r) => r.employeeCode)));
  ck('8. duplicate is reported in duplicateCodes', nm.duplicateCodes.includes('PHF099'), JSON.stringify(nm.duplicateCodes));
  const dupWarn = nm.fileWarnings.find((w) => w.employeeCode === 'PHF099');
  ck('8. duplicate is reported as an explicit NEEDS_REVIEW blocker naming every row + value (never silently dropped, never a picked winner)',
    !!dupWarn && dupWarn.type === 'DUPLICATE_EMPLOYEE_IN_FILE' && dupWarn.status === 'NEEDS_REVIEW'
      && dupWarn.rows.length === 2 && dupWarn.amounts.length === 2
      && dupWarn.amounts.includes(111) && dupWarn.amounts.includes(222)
      && !('winningRow' in dupWarn) && !('rule' in dupWarn),
    JSON.stringify(dupWarn));

  // leading-zero-shaped numeric-looking employee_code must still survive as text
  const gridLZ = [
    ['MÃ NV', 'HỌ VÀ TÊN', 'CHI PHÍ XỬ LÝ'],
    ['007', 'Mã dạng số có số 0 đứng đầu', '1000'],
  ];
  const fpLZ = TPL.fingerprint(gridLZ);
  const nmLZ = NRM.normalizeGrid(gridLZ, fpLZ.columnMap);
  ck('4b. a numeric-looking employee_code ("007") is never Number()-coerced (leading zero survives)', nmLZ.records[0].employeeCode === '007', nmLZ.records[0].employeeCode);
})();

/* =====================================================================
 * 6 + 7 — VERSIONING (re-upload supersede, dedupe-by-sha) + unknown-code
 * warning-only, exercised against the REAL service module
 * (services/phf-hr-api/lib/qtth-processing-cost.js) with an in-memory fake
 * Postgres client (this box has no reachable local/throwaway Postgres —
 * see REGRESSION_RESULTS in the final report). The fake dispatches on the
 * `/* TAG *\/` comment every query in the service carries — the SQL text
 * itself is never parsed, so this exercises the ACTUAL service code path,
 * not a re-implementation of it.
 * ===================================================================== */
(function dbBackedChecks() {
  console.log('-- 6+7: versioning (re-upload supersede) + unknown employee_code warning --');

  function makeFakeDb() {
    const state = { imports: [], importFiles: [], normalized: [] }; // arrays of plain objects
    let seq = 1;
    function tagOf(sql) { const m = /\/\*\s*(\S+)\s*\*\//.exec(sql); return m ? m[1] : null; }
    function client() {
      return {
        async query(sql, params) {
          params = params || [];
          const tag = tagOf(sql);
          switch (tag) {
            case 'Q_GET_IMPORT_BY_PERIOD': return { rows: state.imports.filter((i) => i.period_month === params[0]) };
            case 'Q_INSERT_IMPORT': {
              const row = { id: 'imp' + (seq++), period_month: params[0], status: 'draft', current_file_id: null, created_by_account_id: params[1], created_by_name: params[2] };
              state.imports.push(row); return { rows: [row] };
            }
            case 'Q_GET_FILE_BY_SHA': return { rows: state.importFiles.filter((f) => f.import_id === params[0] && f.sha256 === params[1]) };
            case 'Q_REVALIDATE_FILE': {
              const f = state.importFiles.find((x) => x.id === params[0]);
              if (f) { f.validation = params[1]; f.row_count = params[2]; f.warning_count = params[3]; }
              return { rows: [] };
            }
            case 'Q_NEXT_VERSION': {
              const max = state.importFiles.filter((f) => f.import_id === params[0]).reduce((m, f) => Math.max(m, f.version), 0);
              return { rows: [{ v: max }] };
            }
            case 'Q_INSERT_FILE': {
              const row = {
                id: 'file' + (seq++), import_id: params[0], version: params[1], file_name: params[2], sha256: params[3],
                byte_size: params[4], status: 'previewed', row_count: params[5], warning_count: params[6], validation: params[7],
                uploaded_by_account_id: params[8], uploaded_by_name: params[9], uploaded_at: new Date().toISOString(), confirmed_at: null,
              };
              state.importFiles.push(row); return { rows: [{ id: row.id, version: row.version }] };
            }
            case 'Q_INSERT_NORMALIZED': {
              state.normalized.push({ file_id: params[0], employee_code: params[1], period_month: params[2], employee_name: params[3], amount: params[4], people_master_matched: params[5] });
              return { rows: [] };
            }
            case 'Q_GET_FILE_FOR_UPDATE': case 'Q_GET_FILE_BY_ID': return { rows: state.importFiles.filter((f) => f.id === params[0]) };
            case 'Q_GET_IMPORT_FOR_UPDATE': return { rows: state.imports.filter((i) => i.id === params[0]) };
            case 'Q_GET_PREV_CONFIRMED': {
              const list = state.importFiles.filter((f) => f.import_id === params[0] && f.status === 'confirmed').sort((a, b) => b.version - a.version);
              return { rows: list.slice(0, 1) };
            }
            case 'Q_SUPERSEDE_FILE': { const f = state.importFiles.find((x) => x.id === params[0]); if (f) f.status = 'superseded'; return { rows: [] }; }
            case 'Q_CONFIRM_FILE': { const f = state.importFiles.find((x) => x.id === params[0]); if (f) { f.status = 'confirmed'; f.confirmed_at = new Date().toISOString(); } return { rows: [] }; }
            case 'Q_DEFER': return { rows: [] };
            case 'Q_ACTIVATE_IMPORT': { const i = state.imports.find((x) => x.id === params[0]); if (i) { i.status = 'active'; i.current_file_id = params[1]; } return { rows: [] }; }
            case 'Q_LIST_FILES': return { rows: state.importFiles.filter((f) => f.import_id === params[0]).sort((a, b) => b.version - a.version) };
            case 'Q_GET_NORMALIZED_BY_FILE': return { rows: state.normalized.filter((r) => r.file_id === params[0]).sort((a, b) => a.employee_code < b.employee_code ? -1 : 1) };
            default: throw new Error('fake db: unhandled query tag ' + tag + ' :: ' + sql.slice(0, 80));
          }
        },
      };
    }
    return {
      state,
      async withTaskReadTransaction(config, fn) { return fn(client()); },
      async withTaskWriteTransaction(config, fn) { return fn(client()); },
      testConnection: async () => true, testTaskRoleBoundary: async () => true,
    };
  }

  // Monkey-patch the shared './db' module BEFORE requiring the service, so the
  // service's `const { withTaskReadTransaction, withTaskWriteTransaction } = require('./db')`
  // destructure captures the fake implementations. Node module cache guarantees
  // both this test and the service resolve the exact same file identity.
  const dbPath = require.resolve(path.join(REPO, 'services/phf-hr-api/lib/db.js'));
  const svcPath = require.resolve(path.join(REPO, 'services/phf-hr-api/lib/qtth-processing-cost.js'));
  delete require.cache[svcPath];
  const fake = makeFakeDb();
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fake };
  const svc = require(svcPath);

  const config = {};
  const actor = { accountId: 'acc1', displayName: 'Tester', employeeCode: 'ADMIN' };

  function xlsxOf(grid) {
    const { gridToXlsx } = require(path.join(REPO, 'scripts/lib/xlsx-write-lite'));
    return gridToXlsx(grid).toString('base64');
  }

  async function expectBlocked(fileId, label) {
    try {
      await svc.dispatch(config, actor, 'processingCost.confirm', { fileId });
      ck(label, false, 'confirm did NOT throw — should have been blocked');
    } catch (e) {
      ck(label, e && e.code === 'PROCESSING_COST_CONFIRM_BLOCKED', 'code=' + (e && e.code) + ' msg=' + (e && e.message));
    }
  }

  (async () => {
    // ---- 7. unknown employee_code -> visible in preview, BLOCKS confirm ----
    const gridUnknown = [
      ['MÃ NV', 'HỌ VÀ TÊN', 'CHI PHÍ XỬ LÝ'],
      ['PHF004', 'Trần Gia Bảo Ngọc', '9000000'],
      ['PHF999', 'Không có trong People Master', '1000000'],
    ];
    const r1 = await svc.dispatch(config, actor, 'processingCost.validatePreview', {
      periodMonth: '2026-09', fileName: 'v1-unknown.xlsx', fileBase64: xlsxOf(gridUnknown), knownEmployeeCodes: ['PHF004'],
    });
    ck('7. validatePreview does NOT throw / does NOT reject an unknown employee_code', !!r1.fileId);
    ck('7. unknown employee_code is listed in totals.unknownEmployeeCodes', r1.totals.unknownEmployeeCodes.includes('PHF999'), JSON.stringify(r1.totals.unknownEmployeeCodes));
    ck('7. known employee_code is NOT flagged unknown', !r1.totals.unknownEmployeeCodes.includes('PHF004'));
    ck('7. canConfirm = false while an unknown code remains', r1.canConfirm === false, JSON.stringify(r1));
    ck('7. blockers.unknownEmployeeCodes carries PHF999', (r1.blockers.unknownEmployeeCodes || []).includes('PHF999'));
    const rows1 = fake.state.normalized.filter((n) => n.file_id === r1.fileId);
    ck('7. unknown-code row is still PERSISTED / visible in preview (never silently rejected)', rows1.some((n) => n.employee_code === 'PHF999'));
    ck('7. unknown-code row is marked people_master_matched=false (never silently mapped to a name)', rows1.find((n) => n.employee_code === 'PHF999').people_master_matched === false);
    ck('7. known-code row is marked people_master_matched=true', rows1.find((n) => n.employee_code === 'PHF004').people_master_matched === true);
    await expectBlocked(r1.fileId, '7. confirm is BLOCKED (PROCESSING_COST_CONFIRM_BLOCKED) while an unknown employee_code remains');
    const importAfterBlock = fake.state.imports.find((i) => i.period_month === '2026-09');
    ck('7. a blocked confirm never activates the import (current_file_id stays null)', importAfterBlock.current_file_id === null);

    // ---- resolve by correcting the file (never by name-mapping) + re-upload: clean file confirms ----
    const gridClean = [
      ['MÃ NV', 'HỌ VÀ TÊN', 'CHI PHÍ XỬ LÝ'],
      ['PHF004', 'Trần Gia Bảo Ngọc', '9000000'],
    ];
    const r2 = await svc.dispatch(config, actor, 'processingCost.validatePreview', {
      periodMonth: '2026-09', fileName: 'v2-clean.xlsx', fileBase64: xlsxOf(gridClean), knownEmployeeCodes: ['PHF004'],
    });
    ck('canConfirm = true once no unknown/duplicate remains', r2.canConfirm === true, JSON.stringify(r2.blockers));
    await svc.dispatch(config, actor, 'processingCost.confirm', { fileId: r2.fileId });
    const importRow2 = fake.state.imports.find((i) => i.period_month === '2026-09');
    ck('clean version confirms and becomes current_file_id', importRow2.current_file_id === r2.fileId);
    ck('clean version file status = confirmed', fake.state.importFiles.find((f) => f.id === r2.fileId).status === 'confirmed');

    // ---- 6. re-upload SAME bytes -> no spurious new version (dedupe-by-sha) ----
    const r2b = await svc.dispatch(config, actor, 'processingCost.validatePreview', {
      periodMonth: '2026-09', fileName: 'v2-clean-again.xlsx', fileBase64: xlsxOf(gridClean), knownEmployeeCodes: ['PHF004'],
    });
    ck('6. byte-identical re-upload for the same period reuses the SAME file (no spurious new version)', r2b.fileId === r2.fileId && r2b.replayed === true, JSON.stringify({ a: r2.fileId, b: r2b.fileId, replayed: r2b.replayed }));

    // ---- 6. re-upload DIFFERENT content for the same period -> new version, old superseded ----
    const gridV3 = [
      ['MÃ NV', 'HỌ VÀ TÊN', 'CHI PHÍ XỬ LÝ'],
      ['PHF004', 'Trần Gia Bảo Ngọc', '9500000'], // changed amount
    ];
    const r3 = await svc.dispatch(config, actor, 'processingCost.validatePreview', {
      periodMonth: '2026-09', fileName: 'v3.xlsx', fileBase64: xlsxOf(gridV3), knownEmployeeCodes: ['PHF004'],
    });
    ck('6. a real content change creates a NEW file/version (not reused)', r3.fileId !== r2.fileId && r3.version === r2.version + 1, JSON.stringify({ v2: r2.version, v3: r3.version }));
    await svc.dispatch(config, actor, 'processingCost.confirm', { fileId: r3.fileId });
    const importRow3 = fake.state.imports.find((i) => i.period_month === '2026-09');
    ck('6. confirming the new version makes it current (no silent overwrite of the old row — old kept, marked superseded)',
      importRow3.current_file_id === r3.fileId);
    ck('6. previous confirmed version is marked "superseded", never deleted (audit trail)',
      fake.state.importFiles.find((f) => f.id === r2.fileId).status === 'superseded');
    ck('6. previous version\'s normalized rows are still in the table (audit trail — not deleted)',
      fake.state.normalized.some((n) => n.file_id === r2.fileId && n.employee_code === 'PHF004'));
    ck('6. only ONE file_id is "current" for the period at any time (no duplicate "current" rows)',
      fake.state.importFiles.filter((f) => f.import_id === importRow3.id && f.id === importRow3.current_file_id).length === 1);

    const list = await svc.dispatch(config, actor, 'processingCost.listNormalized', { periodMonth: '2026-09' });
    ck('listNormalized after latest confirm reflects the NEW amount (9500000), not the earlier one', list.rows.find((r) => r.employeeCode === 'PHF004').amount === 9500000, JSON.stringify(list.rows));

    // ---- 8. within-file duplicate employee_code BLOCKS confirm (separate period) ----
    const gridDup = [
      ['MÃ NV', 'HỌ VÀ TÊN', 'CHI PHÍ XỬ LÝ'],
      ['PHF004', 'Trần Gia Bảo Ngọc', '9000000'],
      ['PHF020', 'Trần Thị Phương Huỳnh — dòng 1', '2000000'],
      ['PHF020', 'Trần Thị Phương Huỳnh — dòng 2', '2500000'],
    ];
    const rd = await svc.dispatch(config, actor, 'processingCost.validatePreview', {
      periodMonth: '2026-10', fileName: 'dup.xlsx', fileBase64: xlsxOf(gridDup), knownEmployeeCodes: ['PHF004', 'PHF020'],
    });
    ck('8. validatePreview does NOT throw on a within-file duplicate', !!rd.fileId);
    ck('8. canConfirm = false while a within-file duplicate remains', rd.canConfirm === false, JSON.stringify(rd.blockers));
    ck('8. blockers.duplicateEmployeeCodes carries PHF020', (rd.blockers.duplicateEmployeeCodes || []).includes('PHF020'));
    const rowsDup = fake.state.normalized.filter((n) => n.file_id === rd.fileId);
    ck('8. the duplicated employee_code is NOT persisted at all (no chosen winner)', !rowsDup.some((n) => n.employee_code === 'PHF020'));
    ck('8. the non-duplicated employee_code in the same file IS persisted', rowsDup.some((n) => n.employee_code === 'PHF004'));
    await expectBlocked(rd.fileId, '8. confirm is BLOCKED (PROCESSING_COST_CONFIRM_BLOCKED) while a within-file duplicate remains');
    const importDupAfterBlock = fake.state.imports.find((i) => i.period_month === '2026-10');
    ck('8. a blocked confirm never activates the import (current_file_id stays null)', importDupAfterBlock.current_file_id === null);

    // resolve: re-upload without the duplicate -> confirms cleanly
    const gridDupFixed = [
      ['MÃ NV', 'HỌ VÀ TÊN', 'CHI PHÍ XỬ LÝ'],
      ['PHF004', 'Trần Gia Bảo Ngọc', '9000000'],
      ['PHF020', 'Trần Thị Phương Huỳnh', '2500000'],
    ];
    const rdFixed = await svc.dispatch(config, actor, 'processingCost.validatePreview', {
      periodMonth: '2026-10', fileName: 'dup-fixed.xlsx', fileBase64: xlsxOf(gridDupFixed), knownEmployeeCodes: ['PHF004', 'PHF020'],
    });
    ck('8. after removing the duplicate row, canConfirm = true', rdFixed.canConfirm === true, JSON.stringify(rdFixed.blockers));
    await svc.dispatch(config, actor, 'processingCost.confirm', { fileId: rdFixed.fileId });
    const importDupFixed = fake.state.imports.find((i) => i.period_month === '2026-10');
    ck('8. the corrected version confirms and becomes current', importDupFixed.current_file_id === rdFixed.fileId);

    console.log('\nRESULT: ' + P + ' passed, ' + F + ' failed');
    process.exit(F ? 1 : 0);
  })().catch((e) => { console.error('UNCAUGHT: ' + (e && e.stack || e)); process.exit(1); });
})();
