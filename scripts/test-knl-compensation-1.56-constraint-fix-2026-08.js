'use strict';
/*
 * Static review of the constraint-name fix in
 * scripts/PHF_KNL_COMPENSATION_EFFECTIVE_PERIOD_CORRECTION_1.56.0.sql.
 *
 * No real Postgres available in this environment (confirmed earlier this
 * session: no psql/docker/pg driver) — this is a TEXT-LEVEL static check on
 * the migration file itself, not a real DB execution. It proves the file
 * contains the expected fix structure and does NOT still contain the old
 * hardcoded-name bug, and that the fail-safe raise-exception paths exist for
 * both the "not found" and "ambiguous" cases. It cannot prove the DO block
 * actually runs correctly against a live server — that still requires the
 * manual DEV SQL Editor apply.
 */
const fs = require('fs');
const assert = require('assert');

const sql = fs.readFileSync('scripts/PHF_KNL_COMPENSATION_EFFECTIVE_PERIOD_CORRECTION_1.56.0.sql', 'utf8');

// 1) No CASCADE anywhere in the file.
assert(!/cascade/i.test(sql), 'T1: migration must never use CASCADE on any DROP');
console.log('PASS: T1 — no CASCADE anywhere in the migration');

// 2) The old hard-coded (untruncated, wrong) constraint name must no longer
// appear as a literal DROP CONSTRAINT target.
assert(
  !/drop constraint if exists knl_employee_compensation_assignments_employee_code_payroll_period_key/i.test(sql),
  'T2: the old hardcoded (untruncated) constraint name must no longer be used as a literal DROP target'
);
console.log('PASS: T2 — old hardcoded untruncated constraint name no longer used as a DROP target');

// 3) The known-correct (but still not hardcoded for the DROP itself) DEV
// constraint name must not be silently substituted in as a new hardcode
// either — the fix must be dynamic, not "swap one hardcoded guess for
// another".
assert(
  !/drop constraint if exists knl_employee_compensation_assi_employee_code_payroll_period_key/i.test(sql),
  'T3: must not simply hardcode the DEV-observed truncated name either — the fix must be dynamic (env-portable)'
);
console.log('PASS: T3 — fix does not hardcode the DEV-observed truncated name either (stays dynamic/portable)');

// 4) Dynamic lookup block present: queries pg_constraint for contype='u' on
// the exact table, matching the exact column set via pg_attribute.
assert(/do \$drop_old_unique\$/i.test(sql), 'T4: dynamic DO block for the old-unique lookup must be present');
assert(/pg_constraint/.test(sql) && /pg_attribute/.test(sql), 'T4: lookup must consult pg_constraint + pg_attribute, not a hardcoded name');
assert(/c\.contype\s*=\s*'u'/.test(sql), 'T4: lookup must filter to UNIQUE constraints only (contype=\'u\')');
assert(/array\['employee_code',\s*'payroll_period'\]/.test(sql), 'T4: lookup must match the exact column set {employee_code,payroll_period}');
console.log('PASS: T4 — dynamic pg_constraint/pg_attribute lookup present, filtered to UNIQUE + exact column set');

// 5) Fail-safe: both 0-match and >1-match cases must raise, aborting the
// transaction, never guessing/dropping the wrong thing.
assert(/KNL_1_56_OLD_UNIQUE_NOT_FOUND/.test(sql), 'T5: must raise a distinct exception when zero matching UNIQUE constraints are found');
assert(/KNL_1_56_OLD_UNIQUE_AMBIGUOUS/.test(sql), 'T5: must raise a distinct exception when more than one matching UNIQUE constraint is found');
assert(/v_match_count\s*=\s*0/.test(sql) && /v_match_count\s*>\s*1/.test(sql), 'T5: both boundary conditions (0 and >1) must be explicitly checked before any DROP');
console.log('PASS: T5 — fail-safe raises on both zero-match and ambiguous-match, before any DROP');

// 6) The actual DROP must use the dynamically-resolved name, quoted safely
// via %I (identifier quoting — protects against SQL injection through a
// constraint name and against names needing quoting).
assert(/execute format\('alter table public\.knl_employee_compensation_assignments drop constraint %I', v_conname\)/.test(sql), 'T6: the actual DROP must use EXECUTE format(...,%I,...) with the resolved v_conname, not a literal name');
console.log('PASS: T6 — DROP uses the dynamically-resolved name via safely-quoted EXECUTE format(%I)');

// 7) Partial unique index creation must still follow, unaffected by the fix.
assert(/create unique index if not exists knl_employee_compensation_assignments_active_period_uq/.test(sql), 'T7: partial unique index creation must still be present');
assert(/where status = 'ACTIVE'/.test(sql), 'T7: partial unique index must still be scoped to status=\'ACTIVE\'');
const doBlockEnd = sql.indexOf('$drop_old_unique$;');
const indexPos = sql.indexOf('create unique index if not exists knl_employee_compensation_assignments_active_period_uq');
assert(doBlockEnd > -1 && indexPos > doBlockEnd, 'T7: partial unique index must be created AFTER the old-unique DO block, not before');
console.log('PASS: T7 — partial unique ACTIVE-only index still created, correctly ordered after the old-unique removal');

// 8) History action check — explicitly OUT OF SCOPE for this fix (DEV
// metadata already confirmed this name is correct) — must be byte-identical
// to before, no incidental changes.
assert(/drop constraint if exists knl_employee_compensation_history_action_check/.test(sql), 'T8: history action check name must be unchanged (out of scope for this fix)');
assert(/check \(action in \('CREATE', 'UPDATE', 'CORRECT_EFFECTIVE_PERIOD'\)\)/.test(sql), 'T8: history action check values must be unchanged');
console.log('PASS: T8 — history action check constraint untouched (correctly out of scope)');

// 9) Transaction wrapper: exactly one top-level begin;/commit; (the DO
// block's own `begin`/`end` are plpgsql body keywords, not transaction
// control, and must not be confused with it).
const topLevelBegins = (sql.match(/^begin;\s*$/gm) || []).length;
const topLevelCommits = (sql.match(/^commit;\s*$/gm) || []).length;
assert.strictEqual(topLevelBegins, 1, 'T9: exactly one top-level transaction BEGIN; expected');
assert.strictEqual(topLevelCommits, 1, 'T9: exactly one top-level transaction COMMIT; expected — no partial commits');
console.log('PASS: T9 — exactly one transaction wrapper (begin;...commit;), no partial commits');

// 10) The new RPC's REVOKE/GRANT (from the earlier P0 permission fix) must
// remain intact and unaffected by this change.
assert(/revoke all on function public\.knl_correct_employee_compensation_period\(text,text,text,text,text,text\)/.test(sql), 'T10: prior P0 permission fix (REVOKE) must remain intact');
assert(/grant execute on function public\.knl_correct_employee_compensation_period\(text,text,text,text,text,text\)\s*\n\s*to service_role;/.test(sql), 'T10: prior P0 permission fix (GRANT to service_role) must remain intact');
console.log('PASS: T10 — prior P0 permission fix (REVOKE/GRANT on the correction RPC) remains intact, unaffected by this change');

console.log('ALL PASS — 1.56.0 constraint-name fix (static review only, no real Postgres available)');
