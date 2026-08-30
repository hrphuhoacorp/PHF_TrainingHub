'use strict';

/*
 * PHF Task — Reporting V2 SCOPED PROD FIX regression.
 *
 * BUG: api/_lib/task-overview-query-descriptor-builder.js resolved TBP/Trưởng ca
 * to resolveAuthorizedTaskEmployeeScope(scopeParam='managed') === managedEmployeeCodes
 * (transitive subtree ONLY) — the actor's own employee_code was dropped, so a
 * TBP/Trưởng ca never saw their OWN tasks in Tổng quan / Báo cáo V2 (and a TBP
 * with an empty/task-less subtree, e.g. PHF012 in 08/2026, saw all-zeros).
 *
 * LOCKED CONTRACT (PHF_TASK_HANDOVER_TO_NEW_CLAUDE_BEFORE_REPORT_04.md §4):
 *   Admin/GĐ/TLGĐ  -> company-wide (employeeCodes = null)
 *   NHAN_VIEN      -> SELF only
 *   TBP/Trưởng ca  -> SELF + transitive managed subtree  (= full scope.peopleScope.values)
 *
 * FIX: for peopleScope.type==='employees', descriptor.employeeCodes = the FULL
 * authorized scope.peopleScope.values (SELF + subtree), never wider.
 * self / all_company paths unchanged.
 *
 * The Task LIST "Nhân sự tôi quản lý" tab (a DIFFERENT builder,
 * api/_lib/task-query-descriptor-builder.js, scope='managed') MUST stay
 * subtree-only — CASE F guards that.
 *
 * Mock-only: resolveEffectiveTaskScope() stubbed via require.cache; zero DB/network.
 *   node scripts/test-task-overview-report-scope-self-inclusion-v1.js
 */

const assert = require('assert');

const permissionsPath = require.resolve('../api/_lib/task-permissions');
const overviewBuilderPath = require.resolve('../api/_lib/task-overview-query-descriptor-builder');
const listBuilderPath = require.resolve('../api/_lib/task-query-descriptor-builder');
const corePath = require.resolve('../api/_lib/task-core');

let PASS = 0, FAIL = 0;
function check(name, cond, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; console.error('  FAIL  ' + name + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); }
}

function loadBuilders({ actorType, employeeCode, accountId, managedEmployeeCodes, peopleScopeType, peopleScopeValues }) {
  delete require.cache[permissionsPath];
  delete require.cache[overviewBuilderPath];
  delete require.cache[listBuilderPath];
  delete require.cache[corePath];
  require.cache[permissionsPath] = {
    id: permissionsPath, filename: permissionsPath, loaded: true,
    exports: {
      resolveEffectiveTaskScope: async () => ({
        actorContext: {
          actorType,
          employeeCode,
          accountId: accountId || undefined,
          managedEmployeeCodes: managedEmployeeCodes || [],
        },
        scope: {
          peopleScope: { type: peopleScopeType, values: peopleScopeValues || [] },
          capabilities: { view: true, assign: true, update: true, manage: actorType === 'admin' },
        },
      }),
    },
  };
  return {
    overview: require(overviewBuilderPath).buildResolvedTaskOverviewQueryDescriptor,
    list: require(listBuilderPath).buildResolvedTaskQueryDescriptor,
  };
}

(async () => {
  // ── CASE A — TBP, own task + EMPTY subtree ───────────────────────────────
  {
    const { overview } = loadBuilders({
      actorType: 'truong_bo_phan', employeeCode: 'PHF012',
      managedEmployeeCodes: [], peopleScopeType: 'employees', peopleScopeValues: ['PHF012'],
    });
    const d = await overview({}, { signingSecret: 'x' });
    check('A: TBP empty subtree -> descriptor.employeeCodes = [PHF012] (SELF present, not [] / not null)',
      Array.isArray(d.employeeCodes) && d.employeeCodes.length === 1 && d.employeeCodes[0] === 'PHF012', d.employeeCodes);
    check('A: report NOT zero-by-empty-subtree — SELF is a real filter value',
      Array.isArray(d.employeeCodes) && d.employeeCodes.includes('PHF012'), d.employeeCodes);
  }

  // ── CASE B — TBP, own + managed employees ────────────────────────────────
  {
    const { overview } = loadBuilders({
      actorType: 'truong_bo_phan', employeeCode: 'PHF012',
      managedEmployeeCodes: ['PHF050', 'PHF051'],
      peopleScopeType: 'employees', peopleScopeValues: ['PHF012', 'PHF050', 'PHF051'],
    });
    const d = await overview({}, { signingSecret: 'x' });
    const set = new Set(d.employeeCodes);
    check('B: TBP -> employeeCodes = SELF + subtree (PHF012, PHF050, PHF051)',
      set.size === 3 && set.has('PHF012') && set.has('PHF050') && set.has('PHF051'), d.employeeCodes);
    check('B: no duplicates', d.employeeCodes.length === new Set(d.employeeCodes).size, d.employeeCodes);
    check('B: never wider than scope.peopleScope.values',
      d.employeeCodes.every((c) => ['PHF012', 'PHF050', 'PHF051'].includes(c)), d.employeeCodes);
  }

  // ── CASE B2 — dedupe when SELF already appears in values ─────────────────
  {
    const { overview } = loadBuilders({
      actorType: 'truong_bo_phan', employeeCode: 'PHF012',
      managedEmployeeCodes: ['PHF012', 'PHF050'],
      peopleScopeType: 'employees', peopleScopeValues: ['PHF012', 'PHF012', 'PHF050'],
    });
    const d = await overview({}, { signingSecret: 'x' });
    check('B2: duplicate SELF in values -> deduped to [PHF012, PHF050]',
      d.employeeCodes.length === 2 && new Set(d.employeeCodes).size === 2 &&
      d.employeeCodes.includes('PHF012') && d.employeeCodes.includes('PHF050'), d.employeeCodes);
  }

  // ── CASE C — TRUONG_CA, same SELF + subtree ─────────────────────────────
  {
    const { overview } = loadBuilders({
      actorType: 'truong_ca', employeeCode: 'PHF070',
      managedEmployeeCodes: ['PHF071', 'PHF072'],
      peopleScopeType: 'employees', peopleScopeValues: ['PHF070', 'PHF071', 'PHF072'],
    });
    const d = await overview({}, { signingSecret: 'x' });
    const set = new Set(d.employeeCodes);
    check('C: TRUONG_CA -> employeeCodes = SELF + subtree (PHF070, PHF071, PHF072)',
      set.size === 3 && set.has('PHF070') && set.has('PHF071') && set.has('PHF072'), d.employeeCodes);
  }

  // ── CASE D — NHAN_VIEN unchanged (SELF only) ────────────────────────────
  {
    const { overview } = loadBuilders({
      actorType: 'nhan_vien', employeeCode: 'PHF082',
      managedEmployeeCodes: [], peopleScopeType: 'self', peopleScopeValues: ['PHF082'],
    });
    const d = await overview({}, { signingSecret: 'x' });
    check('D: NHAN_VIEN -> employeeCodes = [PHF082] (SELF only, unchanged)',
      Array.isArray(d.employeeCodes) && d.employeeCodes.length === 1 && d.employeeCodes[0] === 'PHF082', d.employeeCodes);
    check('D: effectiveScope label = self', d.effectiveScope === 'self', d.effectiveScope);
  }

  // ── CASE E — ADMIN / GĐ / TLGĐ unchanged (company-wide, null) ────────────
  for (const actorType of ['admin', 'giam_doc', 'tro_ly_gd']) {
    const { overview } = loadBuilders({
      actorType, employeeCode: actorType === 'admin' ? '' : 'PHF00X',
      accountId: actorType === 'admin' ? 'acct-admin' : undefined,
      managedEmployeeCodes: ['PHF999'], // even with an org-graph subtree, must stay company-wide
      peopleScopeType: 'all_company', peopleScopeValues: [],
    });
    const d = await overview({}, { signingSecret: 'x' });
    check('E: ' + actorType + ' -> employeeCodes = null (company-wide, unchanged)',
      d.employeeCodes === null, d.employeeCodes);
  }

  // ── CASE F — Task LIST "Nhân sự tôi quản lý" regression (DIFFERENT builder) ──
  {
    const { list } = loadBuilders({
      actorType: 'truong_bo_phan', employeeCode: 'PHF012',
      managedEmployeeCodes: ['PHF050', 'PHF051'], // NOTE: self NOT in the subtree
      peopleScopeType: 'employees', peopleScopeValues: ['PHF012', 'PHF050', 'PHF051'],
    });
    const managed = await list({}, { relation: 'received', scope: 'managed' }, { signingSecret: 'x' });
    check('F: LIST scope=managed -> assigneeEmployeeCodes = subtree ONLY (PHF050, PHF051)',
      Array.isArray(managed.assigneeEmployeeCodes) && managed.assigneeEmployeeCodes.length === 2 &&
      managed.assigneeEmployeeCodes.includes('PHF050') && managed.assigneeEmployeeCodes.includes('PHF051'),
      managed.assigneeEmployeeCodes);
    check('F: LIST scope=managed -> SELF (PHF012) NOT injected into "Nhân sự tôi quản lý"',
      !managed.assigneeEmployeeCodes.includes('PHF012'), managed.assigneeEmployeeCodes);

    const received = await list({}, { relation: 'received' }, { signingSecret: 'x' });
    check('F: LIST "Tôi nhận" (default) -> still SELF-only [PHF012]',
      Array.isArray(received.assigneeEmployeeCodes) && received.assigneeEmployeeCodes.length === 1 &&
      received.assigneeEmployeeCodes[0] === 'PHF012', received.assigneeEmployeeCodes);
  }

  // ── CASE G — PHF012 representative acceptance ──────────────────────────
  {
    const { overview } = loadBuilders({
      actorType: 'truong_bo_phan', employeeCode: 'PHF012',
      managedEmployeeCodes: [], // PROD 08/2026: no reports with tasks
      peopleScopeType: 'employees', peopleScopeValues: ['PHF012'],
    });
    const d = await overview({}, { signingSecret: 'x' });
    // Reporting executor filters task.assignees role='primary' employee_code = ANY(d.employeeCodes).
    // CV-2608-0013 / CV-2608-0014 have active role='primary' employee_code='PHF012'.
    check('G: PHF012 report descriptor makes CV-2608-0013/0014 eligible (PHF012 in employeeCodes)',
      Array.isArray(d.employeeCodes) && d.employeeCodes.includes('PHF012'), d.employeeCodes);
    check('G: signed descriptor shape intact (flowType=giao_viec, excludeDraft=true, 64-hex signature)',
      d.flowType === 'giao_viec' && d.excludeDraft === true && /^[0-9a-f]{64}$/.test(d.signature),
      { flowType: d.flowType, excludeDraft: d.excludeDraft });
  }

  console.log('\nPHF Task — Reporting V2 scope self-inclusion: ' + PASS + '/' + (PASS + FAIL) + ' PASS');
  if (FAIL > 0) process.exit(1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
