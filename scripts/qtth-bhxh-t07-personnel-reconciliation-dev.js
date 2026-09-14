'use strict';
/*
 * PHF HR — QTTH BHXH V1 · T07 personnel reconciliation vs QTTH Phân quyền
 * roster · LOCAL READ-ONLY report (no DB writes — pure normalize against a
 * live roster snapshot).
 *
 * Reports exactly: auto-match count (valid code + present in QTTH roster),
 * not-in-roster count, malformed/missing count, and the final exception
 * list requiring real Admin reconciliation.
 *
 * Run: node scripts/qtth-bhxh-t07-personnel-reconciliation-dev.js
 */
const path = require('path');
const fs = require('fs');
const REPO = path.resolve(__dirname, '..');

function loadEnv(p) { const o = {}; if (!fs.existsSync(p)) return o; for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const s = l.trim(); if (!s || s[0] === '#') continue; const i = s.indexOf('='); if (i > 0) o[s.slice(0, i).trim()] = s.slice(i + 1).trim(); } return o; }
const envTest = loadEnv(path.join(REPO, '.env.test'));

const { readWorkbook } = require(path.join(REPO, 'services/phf-hr-api/lib/xlsx-lite'));
const TPL = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-bhxh-template'));
const { normalizeGrid } = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-bhxh-normalize'));

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(envTest.SUPABASE_URL, envTest.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const { data: rosterRows, error } = await sb.from('employee_profiles').select('employee_code,full_name,employment_status');
  if (error) { console.error('QTTH roster fetch failed:', error.message); process.exit(1); }
  const knownCodes = new Set(rosterRows.map((r) => String(r.employee_code || '').toUpperCase()).filter(Boolean));
  console.log('[t07] QTTH Phân quyền roster (DEV Supabase employee_profiles) size =', knownCodes.size);

  const buf = fs.readFileSync(path.join(REPO, 'phf-qtth-input', 'BHXH T7.xlsx'));
  const rows = readWorkbook(buf).sheets[0].rows;
  const fp = TPL.fingerprint(rows);
  const nm = normalizeGrid(rows, fp.columnMap, fp.totalRow, knownCodes);

  const byReason = {};
  const autoMatched = [];
  const notInRoster = [];
  const malformedMissing = [];
  for (const r of nm.records) {
    if (r.classification === 'MATCHED') { autoMatched.push(r); continue; }
    byReason[r.reviewReason] = (byReason[r.reviewReason] || 0) + 1;
    if (r.reviewReason === 'EMPLOYEE_CODE_NOT_IN_QTTH_ROSTER') notInRoster.push(r);
    else malformedMissing.push(r);
  }

  console.log('\n=== T07_EXCEPTION_LIST ===');
  console.log('Total data rows (excl. total row / blank / rate-reference rows):', nm.rowCount);
  console.log('AUTO-MATCHED (valid code + found in QTTH roster):', autoMatched.length);
  console.log('  ->', autoMatched.map((r) => r.employeeCode).join(', '));
  console.log('NOT IN QTTH ROSTER (well-formed code, but absent from roster):', notInRoster.length);
  for (const r of notInRoster) console.log('  -', r.sourceRowIndex, r.employeeCode, r.fullName, 'TK642=' + r.employerCostSource);
  console.log('MALFORMED / MISSING employee_code:', malformedMissing.length);
  for (const r of malformedMissing) console.log('  -', r.sourceRowIndex, JSON.stringify(r.employeeCode), r.fullName, r.reviewReason, 'TK642=' + r.employerCostSource);
  console.log('\nTOTAL requiring real Admin reconciliation (NEEDS_REVIEW):', nm.needsReviewCount, '  amount=', nm.needsReviewAmount);
  console.log('Employer cost total (verbatim, unaffected by classification):', nm.employerCostTotal);
  console.log('Source total row TK642 (unaffected):', fp.totalRow && fp.totalRow.sourceTotalEmployerCost);

  process.exit(0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
