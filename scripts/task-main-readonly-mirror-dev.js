'use strict';

/*
 * PHF Task — PHASE C — MAIN → SANDBOX real-identity mirror (DEV tool).
 *
 * MAIN (byhpcexmjzqpctyvfczd) is a READ-ONLY SOURCE here. This script:
 *   - reads identity / employee / permission MASTER tables from MAIN,
 *   - reads the same from SANDBOX,
 *   - writes a reconciliation report + the MAIN snapshots to the scratch dir
 *     (git-ignored) for the apply step.
 *
 * HARD RULES enforced in code:
 *   - The MAIN client is wrapped so ONLY .from(t).select(...) is reachable.
 *     Any .insert/.update/.upsert/.delete/.rpc on the MAIN client throws.
 *   - MAIN credentials come ONLY from PHF_MAIN_SUPABASE_URL /
 *     PHF_MAIN_SUPABASE_SECRET_KEY env vars passed to THIS process — never
 *     from .env, never persisted, never printed.
 *   - SANDBOX target is fail-closed via task-sandbox-guard (SUPABASE_URL).
 *
 * Usage:
 *   PHF_MAIN_SUPABASE_URL=... PHF_MAIN_SUPABASE_SECRET_KEY=... \
 *     node scripts/task-main-readonly-mirror-dev.js            # snapshot + report
 *   ... node scripts/task-main-readonly-mirror-dev.js --apply  # + write to SANDBOX
 */

require('dotenv').config();
require('./task-sandbox-guard'); // SANDBOX-only for SUPABASE_URL / SUPABASE_SECRET_KEY
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const { classifySupabaseUrl } = require('../api/_lib/env-identity-guard');

const APPLY = process.argv.includes('--apply');
const OUT_DIR = process.env.PHF_PHASE_C_OUT_DIR
  || path.join(process.env.TEMP || os.tmpdir(), 'phf-phase-c');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---- MAIN read-only client -------------------------------------------------
const MAIN_URL = String(process.env.PHF_MAIN_SUPABASE_URL || '').trim();
const MAIN_KEY = String(process.env.PHF_MAIN_SUPABASE_SECRET_KEY || '').trim();
if (!MAIN_URL || !MAIN_KEY) {
  console.error('FATAL: set PHF_MAIN_SUPABASE_URL + PHF_MAIN_SUPABASE_SECRET_KEY (this process only, do NOT put them in .env).');
  process.exit(2);
}
if (classifySupabaseUrl(MAIN_URL).label !== 'MAIN') {
  console.error('FATAL: PHF_MAIN_SUPABASE_URL is not the known MAIN project. Refusing.');
  process.exit(2);
}
const _mainRaw = createClient(MAIN_URL, MAIN_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const SELECT_ONLY = new Set(['select']);
function readOnlyFrom(table) {
  const qb = _mainRaw.from(table);
  return new Proxy(qb, {
    get(target, prop) {
      if (typeof prop === 'string' && ['insert', 'update', 'upsert', 'delete'].includes(prop)) {
        throw new Error('PHF_PHASE_C_GUARD: MAIN is READ-ONLY — "' + prop + '" is forbidden on the MAIN client.');
      }
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    }
  });
}
const MAIN = {
  from: readOnlyFrom,
  rpc() { throw new Error('PHF_PHASE_C_GUARD: MAIN is READ-ONLY — .rpc() is forbidden on the MAIN client.'); }
};

// ---- SANDBOX client (real write authority) --------------------------------
const SB = createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), { auth: { persistSession: false, autoRefreshToken: false } });

// ---- master domains -------------------------------------------------------
// Only identity / employee / permission / reference. NO Task transaction tables.
const DOMAINS = [
  { key: 'employee_profiles', pk: 'employee_code',
    cols: 'employee_id,employee_code,full_name,department,title,position,branch,manager_employee_code,employment_status' },
  { key: 'user_accounts', pk: 'id',
    cols: 'id,email,phone,name,role,status,employee_code,employee_id,metadata,created_at' },
  { key: 'task_permission_assignments', pk: 'id', cols: '*' },
  { key: 'task_permission_grants', pk: 'id', cols: '*' },
  { key: 'checklist_permission_grants', pk: 'id', cols: '*' },
];

async function dumpAll(client, label, cols, key) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client.from(key).select(cols).range(from, from + pageSize - 1);
    if (error) return { error };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return { rows };
}

(async () => {
  console.log('PHASE C mirror — MAIN(read-only)=' + classifySupabaseUrl(MAIN_URL).label
    + '  SANDBOX=' + classifySupabaseUrl(process.env.SUPABASE_URL).label
    + '  mode=' + (APPLY ? 'APPLY' : 'report-only') + '  out=' + OUT_DIR);

  const report = [];
  const snapshots = {};
  for (const d of DOMAINS) {
    const m = await dumpAll(MAIN, 'MAIN', d.cols, d.key);
    const s = await dumpAll(SB, 'SANDBOX', d.cols, d.key);
    const row = { domain: d.key, main: m.error ? ('ERR ' + m.error.code) : m.rows.length, sandbox: s.error ? ('ERR ' + s.error.code) : s.rows.length };
    if (!m.error) snapshots[d.key] = m.rows;
    report.push(row);
    console.log('  ' + d.key.padEnd(30) + ' MAIN=' + row.main + '  SANDBOX=' + row.sandbox);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'main-snapshot.json'), JSON.stringify(snapshots, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'parity-report.json'), JSON.stringify(report, null, 2));
  console.log('\nWrote main-snapshot.json + parity-report.json to ' + OUT_DIR);
  console.log(APPLY ? '\n(--apply given: run the apply module next)' : '\n(report only — no SANDBOX write)');
})().catch(e => { console.error('FATAL', e && e.message ? e.message : e); process.exit(1); });
