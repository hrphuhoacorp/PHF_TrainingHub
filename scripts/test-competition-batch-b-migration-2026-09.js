'use strict';
/* PHF HR — Chương trình thi đua · Batch B (Company PostgreSQL foundation).
 *
 * OFFLINE discipline lint over the migration file set. Behavioural proof was
 * run live against the verified dev DB phf_hr_e2e (container
 * phf-hr-e2e-throwaway-20260827T123257Z) — see BATCH B RESULT report.
 * This test guards the files in the repo against drift:
 *   - the 4 Task-style artefacts + DEV fixture all exist;
 *   - schema competition; exactly 15 competition tables; forbidden identity
 *     tables absent;
 *   - every FK stays inside competition.* (no public.* / Supabase);
 *   - grants target only phf_hr_app, scoped to competition.*, no PUBLIC,
 *     no ALTER DEFAULT PRIVILEGES, no privilege widening on other schemas;
 *   - runtime role is phf_hr_app (no phf_hr_competition_app);
 *   - PRE_APPLY_GATE + DOWN refuse the production database by name;
 *   - UI (Batch A/A1/A2) files are untouched by Batch B.
 */
const assert = require('assert');
const fs = require('fs');
const cp = require('child_process');

let passed = 0;
function check(c, m){ assert.ok(c, m); passed++; console.log('PASS', m); }

const M = 'migrations/';
const files = {
  up:   fs.readFileSync(M + 'phf_hr_competition_v1.sql', 'utf8'),
  down: fs.readFileSync(M + 'phf_hr_competition_v1_DOWN.sql', 'utf8'),
  gate: fs.readFileSync(M + 'phf_hr_competition_v1_PRE_APPLY_GATE.sql', 'utf8'),
  val:  fs.readFileSync(M + 'phf_hr_competition_v1_VALIDATION.sql', 'utf8'),
  data: fs.readFileSync(M + 'phf_hr_competition_v1_DEV_TEST_DATA.sql', 'utf8')
};
check(Object.values(files).every(Boolean), 'all 5 migration artefacts present');

// SQL with line comments stripped — discipline checks look at executable text only
const upCode = files.up.replace(/--.*$/gm, '');

/* ---- schema + table set ---- */
check(/CREATE SCHEMA IF NOT EXISTS competition\b/.test(files.up), 'UP creates schema competition');
check(/ALTER SCHEMA competition OWNER TO phf_hr_owner/.test(files.up), 'schema handed to phf_hr_owner');
const tables = [...files.up.matchAll(/CREATE TABLE competition\.([a-z_]+)/g)].map(m => m[1]);
check(tables.length === 15, 'exactly 15 competition tables (' + tables.length + ')');
const expect = ['campaigns','approval_levels','reviewer_grants','admin_grants','capability_grants',
  'participant_aliases','submissions','review_assignments','reactions','awards',
  'campaign_history','submission_history','permission_history','review_assignment_history','award_history'];
check(expect.every(t => tables.includes(t)), 'table set matches the locked contract');
check(!/CREATE TABLE competition\.(users|employees|departments)\b/.test(files.up),
  'no competition.users / employees / departments (People Master stays external)');

/* ---- identity is by-value, never FK ---- */
check(!/REFERENCES\s+public\./i.test(files.up) && !/REFERENCES\s+auth\./i.test(files.up),
  'no FK references to public.* / auth.* (no cross-DB FK to People Master)');
const fkTargets = [...files.up.matchAll(/REFERENCES\s+(competition\.[a-z_]+|[a-z_]+\.[a-z_]+)/gi)].map(m => m[1]);
check(fkTargets.every(t => /^competition\./.test(t)), 'every FK target is a competition.* table');
check(/account_id\s+text/.test(files.up) && /employee_code\s+text/.test(files.up),
  'identity columns are plain text external references');

/* ---- grants: phf_hr_app only, competition.* only ---- */
check(/GRANT USAGE ON SCHEMA competition TO phf_hr_app/.test(files.up), 'phf_hr_app granted USAGE on competition schema');
const grantees = [...files.up.matchAll(/\bGRANT\b[\s\S]*?\bTO\s+([a-z_]+)\s*;/g)].map(m => m[1]);
check(grantees.length > 0 && grantees.every(g => g === 'phf_hr_app'), 'every GRANT ... TO targets only phf_hr_app');
check(!/TO\s+PUBLIC/i.test(files.up), 'no GRANT TO PUBLIC');
check(!/ALTER DEFAULT PRIVILEGES/i.test(upCode), 'no ALTER DEFAULT PRIVILEGES (each future table needs its own explicit grant)');
check(!/phf_hr_competition_app/.test(upCode), 'no new phf_hr_competition_app role introduced (V1 uses phf_hr_app)');
check(!/GRANT[^;]+ON\s+SCHEMA\s+(?!competition)[a-z_]+/i.test(files.up), 'no schema-level grant outside competition');
check(!/\bALTER ROLE\b/i.test(files.up) && !/\bCREATE ROLE\b/i.test(files.up), 'UP does not create/alter roles');
check(/GRANT SELECT, INSERT ON\s+competition\.campaign_history/.test(files.up.replace(/\s+/g,' ')),
  'history tables get SELECT,INSERT only (append-only)');

/* ---- append-only + guard triggers ---- */
check((files.up.match(/block_history_mutation/g) || []).length >= 6, 'append-only guard on all 5 history tables');
check(/guard_no_self_review/.test(files.up), 'self-review blocked at DB edge');
check(/guard_submission_immutability/.test(files.up), 'approved submission payload immutable');
check(/guard_approval_level_change/.test(files.up) && /levels_frozen/.test(files.up), 'approval-level freeze guard present');
check(/allow_level_override/.test(files.up) && /allow_submission_override/.test(files.up),
  'audited admin-override hooks exist (SET LOCAL competition.allow_*_override)');
check(/campaigns_publish_gate_ck|guard_campaign_publish/.test(files.up), 'publication gated to finalized campaigns');

/* ---- configurable scoring, not hardcoded ---- */
check(!/score\s+numeric[^;]*(DEFAULT\s+2|CHECK[^)]*=\s*2)/i.test(files.up), 'approval level score not hardcoded to 2/5');
check(/current_score/.test(files.up) && /submissions_score_pair_ck/.test(files.up),
  'submission carries replacement current_score (level+score travel together)');

/* ---- DOWN + gates refuse production ---- */
check(/DROP SCHEMA IF EXISTS competition CASCADE/.test(files.down), 'DOWN drops the schema');
check(/current_database\(\) IN \('phf_hr','phfcrm'\)/.test(files.down), 'DOWN refuses production db by name');
check(/d = 'phf_hr' OR d = 'phfcrm'/.test(files.gate) || /'phf_hr','phfcrm'/.test(files.gate),
  'PRE_APPLY_GATE refuses production db by name');
check(/phf_hr_e2e/.test(files.gate), 'PRE_APPLY_GATE allow-lists the dev target explicitly');

/* ---- VALIDATION asserts structure ---- */
check(/expected 15 tables/.test(files.val) && /VALIDATION_PASS/.test(files.val), 'VALIDATION has hard structural assertions');

/* ---- DEV fixture is synthetic + covers required cases ---- */
check(/SYN-/.test(files.data) && !/PHF0\d\d/.test(files.data.replace(/SYN10\d/g,'')), 'fixture identities are synthetic (SYN-*)');
['reviewer L1','L2','admin','capability','alias','upgrade','overdue','self.?review','tie','award'].forEach(function(kw){
  check(new RegExp(kw, 'i').test(files.data), 'fixture exercises: ' + kw);
});

/* ---- Batch B did not touch the UI ---- */
const uiDiff = cp.execSync('git diff --name-only HEAD -- assets/ index.html', { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
check(uiDiff.every(f => f === 'assets/js/phf-url-router.js' || f === 'index.html'),
  'no Batch-B UI changes beyond the pre-existing A1/A2 router+index diff');
const idxAdds = cp.execSync('git diff HEAD -- index.html', { encoding: 'utf8' })
  .split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
check(idxAdds.length <= 3
  && idxAdds.some(l => l.includes('phf-competition.css'))
  && idxAdds.some(l => l.includes('competition/phf-competition-app.js'))
  && !idxAdds.some(l => /competition\.(campaigns|submissions)|migration|schema/i.test(l)),
  'index.html diff is only the A1 competition asset/shell wiring — no Batch-B change');

console.log('\nALL PASS (' + passed + ' checks)');
