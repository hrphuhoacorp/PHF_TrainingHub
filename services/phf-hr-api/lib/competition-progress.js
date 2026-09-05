'use strict';

// PHF HR — Competition V1 · participation progress (productivity signal).
//
// This is NOT a review score. valid_count = approved/finalized submissions in
// the current period (YYYY-MM by submitted_at — membership time, not approval
// time). required_count = campaign.min_required_contributions. missing =
// max(0, required - valid).
//
// Access:
//   participant  — own progress only.
//   capability view_participation_progress OR Competition Admin — company-wide
//     list (employee + department/branch as identifying context + counts).
//   a plain reviewer gets NOTHING here (capability, not reviewer right).

const { readTx, cErr } = require('./competition-common');
const { resolveAuthority } = require('./competition-permissions');

function periodKey(d) {
  const dt = d ? new Date(d) : new Date();
  return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0');
}

async function myProgress(config, actor, params) {
  const campaignId = params.campaignId;
  const period = params.period || periodKey();
  return readTx(config, async (client) => {
    const c = await client.query('SELECT min_required_contributions FROM competition.campaigns WHERE id = $1', [campaignId]);
    if (!c.rowCount) throw cErr('COMPETITION_CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình.', 404);
    const required = c.rows[0].min_required_contributions;
    const r = await client.query(
      `SELECT count(*)::int valid
         FROM competition.submissions
        WHERE campaign_id = $1
          AND ( ($2 <> '' AND author_account_id = $2) OR ($3 <> '' AND author_employee_code = $3) )
          AND status IN ('approved','finalized')
          AND to_char(submitted_at, 'YYYY-MM') = $4`,
      [campaignId, actor.accountId || '', actor.employeeCode || '', period]);
    const valid = r.rows[0].valid;
    const missing = required == null ? null : Math.max(0, required - valid);
    return {
      period, validCount: valid, requiredCount: required,
      missingCount: missing,
      completionState: required == null ? 'no_requirement' : (valid >= required ? 'met' : 'not_met'),
    };
  });
}

async function companyProgress(config, actor, params) {
  const campaignId = params.campaignId;
  const period = params.period || periodKey();
  const auth = await resolveAuthority(config, actor, campaignId);
  if (!auth.capabilities.viewParticipationProgress) {
    throw cErr('COMPETITION_PROGRESS_FORBIDDEN',
      'Cần quyền "view_participation_progress" hoặc Competition Admin.', 403);
  }
  return readTx(config, async (client) => {
    const c = await client.query('SELECT min_required_contributions FROM competition.campaigns WHERE id = $1', [campaignId]);
    if (!c.rowCount) throw cErr('COMPETITION_CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình.', 404);
    const required = c.rows[0].min_required_contributions;
    const r = await client.query(
      `SELECT s.author_employee_code, max(s.author_display_name_snapshot) AS display_name,
              max(s.author_department_snapshot) AS department, max(s.author_branch_snapshot) AS branch,
              count(*) FILTER (WHERE s.status IN ('approved','finalized')
                               AND to_char(s.submitted_at,'YYYY-MM') = $2)::int AS valid_count,
              count(*) FILTER (WHERE to_char(s.submitted_at,'YYYY-MM') = $2)::int AS submitted_count
         FROM competition.submissions s
        WHERE s.campaign_id = $1
        GROUP BY s.author_employee_code
        ORDER BY valid_count DESC, s.author_employee_code`,
      [campaignId, period]);
    return {
      period, requiredCount: required,
      rows: r.rows.map((x) => ({
        employeeCode: x.author_employee_code, displayName: x.display_name,
        department: x.department, branch: x.branch,
        validCount: x.valid_count, submittedCount: x.submitted_count,
        missingCount: required == null ? null : Math.max(0, required - x.valid_count),
        completionState: required == null ? 'no_requirement' : (x.valid_count >= required ? 'met' : 'not_met'),
      })),
    };
  });
}

module.exports = { myProgress, companyProgress, periodKey };
