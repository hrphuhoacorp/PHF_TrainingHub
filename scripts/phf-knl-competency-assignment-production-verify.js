'use strict';

require('dotenv').config();
const assert = require('assert');
const { createClient } = require('@supabase/supabase-js');

const url = String(process.env.SUPABASE_URL || '').trim();
const secret = String(process.env.SUPABASE_SECRET_KEY || '').trim();
const publishable = String(process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
assert(url && secret && publishable, 'Missing Supabase Production environment.');
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const publicDb = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });

const TABLES = ['knl_employee_competency_assignments', 'knl_employee_competency_assignment_history'];
const RPCS = ['knl_set_employee_competency_assignment'];

function check(error, label) { if (error) { error.message = label + ': ' + error.message; throw error; } }
async function openApi() {
  const response = await fetch(url + '/rest/v1/', { headers: { apikey: secret, Authorization: 'Bearer ' + secret } });
  assert.strictEqual(response.status, 200, 'Production OpenAPI unavailable');
  return response.json();
}

(async () => {
  const spec = await openApi();
  TABLES.forEach(name => {
    assert(spec.paths['/' + name], 'Missing Production table path ' + name);
    assert(spec.definitions[name], 'Missing Production definition ' + name);
  });
  RPCS.forEach(name => assert(spec.paths['/rpc/' + name], 'Missing Production RPC ' + name));

  const assignmentProps = spec.definitions.knl_employee_competency_assignments.properties;
  assert(/knl_framework_versions/.test(assignmentProps.framework_version_id.description || ''), 'framework_version_id FK missing');
  assert(/knl_grade_definitions/.test(assignmentProps.competency_grade_id.description || ''), 'competency_grade_id FK missing (composite FK DDL covered separately)');
  ['status', 'effective_from', 'effective_to', 'is_active', 'grade_snapshot', 'organization_snapshot', 'note', 'reason'].forEach(name =>
    assert(assignmentProps[name], 'Missing knl_employee_competency_assignments.' + name));

  const historyProps = spec.definitions.knl_employee_competency_assignment_history.properties;
  ['assignment_id', 'superseded_assignment_id', 'employee_code', 'action', 'before_data', 'after_data', 'reason'].forEach(name =>
    assert(historyProps[name], 'Missing knl_employee_competency_assignment_history.' + name));

  const counts = {};
  for (const table of TABLES) {
    const result = await db.from(table).select('*', { head: true, count: 'exact' });
    check(result.error, 'service-role read ' + table);
    counts[table] = Number(result.count || 0);
    const denied = await publicDb.from(table).select('*', { head: true, count: 'exact' });
    assert(denied.error, 'Public/anon direct read unexpectedly allowed ' + table);
  }
  assert.strictEqual(counts.knl_employee_competency_assignments, 0, 'Assignments must be empty before baseline bulk-init');
  assert.strictEqual(counts.knl_employee_competency_assignment_history, 0, 'History must be empty before baseline bulk-init');

  console.log('PASS — schema/RPC/RLS verify OK. Counts:', counts);
})().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
