'use strict';

// PHF HR — Chương trình thi đua (Competition) V1 · C4.3 permission matrix
// people source.
//
// The "Phân quyền xét duyệt" screen needs a list of REAL, currently
// grantable PHF HR People Master identities — same canonical source Task
// uses (employee_profiles via employee-master.js's loadCanonicalEmployeeProfiles,
// the SAME reader PHF Task's org-structure code goes through). This module
// adds ONLY the one extra join Competition needs on top of that: the linked
// user_accounts row, so we can exclude anyone whose ACCOUNT is inactive too
// (employment_status active alone is not enough — an inactive account must
// not be grantable even if the employee profile row still says active).
//
// Read-only. Never writes to People Master. Never used to authorize a
// request by itself — callers must independently prove Competition Admin
// authority (see competition-actions.js: this is fetched only after an
// admin-gated phf-hr-api call has already succeeded).

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { loadCanonicalEmployeeProfiles } = require('./employee-master');

const configured = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const db = configured
  ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

function text(v) { return String(v == null ? '' : v).trim(); }
function code(v) { return text(v).toUpperCase(); }

// Active employee_profiles JOIN active user_accounts, employee_code match.
// Excludes: inactive employment_status, inactive/missing account, accounts
// with no employee_code (account-only identities aren't Competition
// "nhân sự" rows here — System Admin keeps its existing implicit authority
// separately and is never listed in this matrix).
async function listReviewableEmployees() {
  if (!db) { const e = new Error('Supabase chưa được cấu hình.'); e.statusCode = 503; e.code = 'SUPABASE_NOT_CONFIGURED'; throw e; }
  const profiles = await loadCanonicalEmployeeProfiles('employee_code,full_name,department,title,position,employment_status');
  if (!profiles || profiles.ready !== true) { const e = new Error('Chưa đọc được employee_profiles.'); e.statusCode = 503; e.code = 'TASK_ORG_SOURCE_UNAVAILABLE'; throw e; }
  const activeProfiles = new Map(
    (profiles.rows || [])
      .filter((r) => text(r.employment_status || 'active').toLowerCase() === 'active')
      .map((r) => [code(r.employee_code), r]));
  if (!activeProfiles.size) return [];

  const { data: accounts, error } = await db.from('user_accounts')
    .select('id,employee_code,status').eq('status', 'active');
  if (error) throw error;

  const out = [];
  for (const a of accounts || []) {
    const ec = code(a.employee_code);
    if (!ec) continue; // account-only identity — not a People-Master "nhân sự" row
    const p = activeProfiles.get(ec);
    if (!p) continue; // active account but no matching active employee profile
    out.push({
      accountId: text(a.id),
      employeeCode: ec,
      displayName: text(p.full_name) || ec,
      department: text(p.department),
      title: text(p.title || p.position),
    });
  }
  out.sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi'));
  return out;
}

module.exports = { listReviewableEmployees };
