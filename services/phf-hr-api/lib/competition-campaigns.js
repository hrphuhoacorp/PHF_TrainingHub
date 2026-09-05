'use strict';

// PHF HR — Competition V1 · campaign + approval-level + grant management.
// Company PostgreSQL competition.* (DEV: phf_hr_e2e). All writes are audited
// in the same transaction. Approval-level definition is editable only while
// the campaign is 'draft'; an audited admin exceptional correction uses the
// DB override GUC.

const { readTx, writeTx, cErr, auditActor, cleanText } = require('./competition-common');
const { resolveAuthority, requireCompetitionAdmin } = require('./competition-permissions');

const STATUSES = ['draft', 'accepting', 'reviewing', 'finalized'];
const LIFECYCLE_NEXT = {
  draft: ['accepting'],
  accepting: ['reviewing'],
  reviewing: ['finalized', 'accepting'], // reviewing->accepting only via reopen (audited)
  finalized: ['reviewing'],              // reopen
};

function campaignPublicView(row) {
  return {
    id: row.id, code: row.code, title: row.title, description: row.description,
    instructions: row.instructions, status: row.status, formSchema: row.form_schema,
    minRequiredContributions: row.min_required_contributions,
    submissionStartsAt: row.submission_starts_at, submissionDeadline: row.submission_deadline,
    reviewDeadline: row.review_deadline, publicationState: row.publication_state,
    levelsFrozen: row.levels_frozen, finalizedAt: row.finalized_at,
    createdByEmployeeCode: row.created_by_employee_code,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function levelView(r) {
  return { id: r.id, campaignId: r.campaign_id, levelOrder: r.level_order, name: r.name, score: Number(r.score), slaHours: r.sla_hours };
}

async function listCampaigns(config, actor) {
  const auth = await resolveAuthority(config, actor);
  return readTx(config, async (client) => {
    // non-admin sees campaigns that are not 'draft'; admin sees all
    const r = await client.query(
      `SELECT * FROM competition.campaigns
        WHERE $1 = true OR status <> 'draft'
        ORDER BY created_at DESC`,
      [auth.isCompetitionAdmin]);
    return { campaigns: r.rows.map(campaignPublicView), isCompetitionAdmin: auth.isCompetitionAdmin };
  });
}

async function getActiveCampaign(config) {
  // the single "current" campaign participants interact with: prefer
  // accepting/reviewing, newest first; fall back to newest finalized.
  return readTx(config, async (client) => {
    const r = await client.query(
      `SELECT * FROM competition.campaigns
        WHERE status IN ('accepting','reviewing','finalized')
        ORDER BY (status = 'finalized') ASC, updated_at DESC
        LIMIT 1`);
    return r.rowCount ? campaignPublicView(r.rows[0]) : null;
  });
}

async function getCampaignDetail(config, actor, campaignId) {
  const auth = await resolveAuthority(config, actor, campaignId);
  return readTx(config, async (client) => {
    const c = await client.query('SELECT * FROM competition.campaigns WHERE id = $1', [campaignId]);
    if (!c.rowCount) throw cErr('COMPETITION_CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình.', 404);
    const lv = await client.query(
      'SELECT * FROM competition.approval_levels WHERE campaign_id = $1 ORDER BY level_order', [campaignId]);
    const detail = { campaign: campaignPublicView(c.rows[0]), levels: lv.rows.map(levelView), authority: auth };
    if (auth.isCompetitionAdmin) {
      const rg = await client.query(
        `SELECT id, account_id, employee_code, display_name, max_level_order, is_active, granted_at, revoked_at
           FROM competition.reviewer_grants WHERE campaign_id = $1 ORDER BY max_level_order DESC, granted_at`,
        [campaignId]);
      detail.reviewerGrants = rg.rows;
    }
    return detail;
  });
}

async function createDraftCampaign(config, actor, params) {
  const auth = await resolveAuthority(config, actor);
  requireCompetitionAdmin(auth);
  const code = cleanText(params.code);
  const title = cleanText(params.title);
  if (!code || !title) throw cErr('COMPETITION_CAMPAIGN_FIELDS_REQUIRED', 'Thiếu mã hoặc tên chương trình.', 400);
  const aa = auditActor(actor);
  return writeTx(config, async (client) => {
    const r = await client.query(
      `INSERT INTO competition.campaigns
        (code, title, description, instructions, form_schema, min_required_contributions,
         submission_starts_at, submission_deadline, review_deadline,
         created_by_account_id, created_by_employee_code)
       VALUES ($1,$2,$3,$4, COALESCE($5,'[]')::jsonb, $6, $7,$8,$9, $10,$11)
       RETURNING *`,
      [code, title, cleanText(params.description), cleanText(params.instructions),
       params.formSchema ? JSON.stringify(params.formSchema) : null,
       params.minRequiredContributions == null ? null : Number(params.minRequiredContributions),
       params.submissionStartsAt || null, params.submissionDeadline || null, params.reviewDeadline || null,
       aa.account_id, aa.employee_code]);
    const row = r.rows[0];
    await client.query(
      `INSERT INTO competition.campaign_history (campaign_id, action, actor_account_id, actor_employee_code, actor_display_name, after)
       VALUES ($1,'create',$2,$3,$4, jsonb_build_object('status','draft','code',$5::text))`,
      [row.id, aa.account_id, aa.employee_code, aa.display_name, code]);
    return campaignPublicView(row);
  });
}

async function updateDraftCampaign(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  requireCompetitionAdmin(auth);
  const aa = auditActor(actor);
  return writeTx(config, async (client) => {
    const cur = await client.query('SELECT * FROM competition.campaigns WHERE id = $1 FOR UPDATE', [params.campaignId]);
    if (!cur.rowCount) throw cErr('COMPETITION_CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình.', 404);
    if (cur.rows[0].status !== 'draft') throw cErr('COMPETITION_CAMPAIGN_NOT_DRAFT', 'Chỉ sửa được chương trình ở trạng thái nháp.', 409);
    const before = cur.rows[0];
    const r = await client.query(
      `UPDATE competition.campaigns SET
         title = COALESCE($2, title),
         description = COALESCE($3, description),
         instructions = COALESCE($4, instructions),
         form_schema = COALESCE($5::jsonb, form_schema),
         min_required_contributions = CASE WHEN $6::text IS NULL THEN min_required_contributions ELSE $7 END,
         submission_starts_at = COALESCE($8, submission_starts_at),
         submission_deadline = COALESCE($9, submission_deadline),
         review_deadline = COALESCE($10, review_deadline)
       WHERE id = $1 RETURNING *`,
      [params.campaignId, cleanText(params.title), cleanText(params.description), cleanText(params.instructions),
       params.formSchema ? JSON.stringify(params.formSchema) : null,
       params.minRequiredContributions == null ? null : String(params.minRequiredContributions),
       params.minRequiredContributions == null ? null : Number(params.minRequiredContributions),
       params.submissionStartsAt || null, params.submissionDeadline || null, params.reviewDeadline || null]);
    await client.query(
      `INSERT INTO competition.campaign_history (campaign_id, action, actor_account_id, actor_employee_code, actor_display_name, before, after)
       VALUES ($1,'edit',$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [params.campaignId, aa.account_id, aa.employee_code, aa.display_name,
       JSON.stringify({ title: before.title, min_required_contributions: before.min_required_contributions }),
       JSON.stringify({ title: r.rows[0].title, min_required_contributions: r.rows[0].min_required_contributions })]);
    return campaignPublicView(r.rows[0]);
  });
}

async function changeCampaignStatus(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  requireCompetitionAdmin(auth);
  const target = String(params.targetStatus || '');
  if (!STATUSES.includes(target)) throw cErr('COMPETITION_STATUS_INVALID', 'Trạng thái không hợp lệ.', 400);
  const isReopen = !!params.reopen;
  const reason = cleanText(params.reason);
  const aa = auditActor(actor);
  return writeTx(config, async (client) => {
    const cur = await client.query('SELECT * FROM competition.campaigns WHERE id = $1 FOR UPDATE', [params.campaignId]);
    if (!cur.rowCount) throw cErr('COMPETITION_CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình.', 404);
    const from = cur.rows[0].status;
    if (from === target) throw cErr('COMPETITION_STATUS_NOCHANGE', 'Chương trình đã ở trạng thái này.', 409);
    const allowed = LIFECYCLE_NEXT[from] || [];
    const isBackwards = STATUSES.indexOf(target) < STATUSES.indexOf(from);
    if (isBackwards && !isReopen) throw cErr('COMPETITION_REOPEN_REQUIRED', 'Lùi trạng thái phải dùng thao tác mở lại (reopen) kèm lý do.', 409);
    if (isBackwards && !reason) throw cErr('COMPETITION_REOPEN_REASON_REQUIRED', 'Mở lại chương trình phải có lý do.', 400);
    if (!allowed.includes(target)) throw cErr('COMPETITION_STATUS_TRANSITION_INVALID', `Không thể chuyển ${from} → ${target}.`, 409);

    const setFrozen = (from === 'draft' && target === 'accepting') ? true : null;
    const setFinalizedAt = target === 'finalized' ? 'now()' : (from === 'finalized' ? 'null' : null);
    const r = await client.query(
      `UPDATE competition.campaigns SET
         status = $2,
         levels_frozen = CASE WHEN $3::boolean IS NULL THEN levels_frozen ELSE $3 END,
         finalized_at = ${setFinalizedAt === 'now()' ? 'now()' : setFinalizedAt === 'null' ? 'null' : 'finalized_at'}
       WHERE id = $1 RETURNING *`,
      [params.campaignId, target, setFrozen]);

    await client.query(
      `INSERT INTO competition.campaign_history (campaign_id, action, actor_account_id, actor_employee_code, actor_display_name, before, after, reason)
       VALUES ($1, $2, $3,$4,$5, jsonb_build_object('status',$6::text), jsonb_build_object('status',$7::text), $8)`,
      [params.campaignId, isReopen ? 'reopen' : 'status_change', aa.account_id, aa.employee_code, aa.display_name, from, target, reason]);
    if (setFrozen) {
      await client.query(
        `INSERT INTO competition.campaign_history (campaign_id, action, actor_account_id, actor_employee_code, actor_display_name, after)
         VALUES ($1,'level_freeze',$2,$3,$4, jsonb_build_object('levels_frozen',true))`,
        [params.campaignId, aa.account_id, aa.employee_code, aa.display_name]);
    }
    return campaignPublicView(r.rows[0]);
  });
}

async function publishCampaign(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  requireCompetitionAdmin(auth);
  const aa = auditActor(actor);
  return writeTx(config, async (client) => {
    const cur = await client.query('SELECT * FROM competition.campaigns WHERE id = $1 FOR UPDATE', [params.campaignId]);
    if (!cur.rowCount) throw cErr('COMPETITION_CAMPAIGN_NOT_FOUND', 'Không tìm thấy chương trình.', 404);
    if (cur.rows[0].status !== 'finalized') throw cErr('COMPETITION_PUBLISH_GATE', 'Chỉ công bố được chương trình đã chốt.', 409);
    const r = await client.query(
      `UPDATE competition.campaigns SET publication_state = 'published' WHERE id = $1 RETURNING *`, [params.campaignId]);
    await client.query(
      `INSERT INTO competition.campaign_history (campaign_id, action, actor_account_id, actor_employee_code, actor_display_name, after)
       VALUES ($1,'publish',$2,$3,$4, jsonb_build_object('publication_state','published'))`,
      [params.campaignId, aa.account_id, aa.employee_code, aa.display_name]);
    return campaignPublicView(r.rows[0]);
  });
}

// ---- approval levels (draft only; audited override for exceptional fix) ---
async function listLevels(config, campaignId) {
  return readTx(config, async (client) => {
    const r = await client.query('SELECT * FROM competition.approval_levels WHERE campaign_id = $1 ORDER BY level_order', [campaignId]);
    return r.rows.map(levelView);
  });
}

async function upsertLevel(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  requireCompetitionAdmin(auth);
  const override = !!params.exceptionalCorrection;
  const reason = cleanText(params.reason);
  if (override && !reason) throw cErr('COMPETITION_OVERRIDE_REASON_REQUIRED', 'Sửa mức duyệt đã khoá cần lý do.', 400);
  const aa = auditActor(actor);
  return writeTx(config, async (client) => {
    if (override) await client.query(`SET LOCAL competition.allow_level_override = 'on'`);
    let action = 'level_edit';
    let row;
    if (params.levelId) {
      const r = await client.query(
        `UPDATE competition.approval_levels
            SET name = COALESCE($2,name), score = COALESCE($3,score), sla_hours = CASE WHEN $4::text IS NULL THEN sla_hours ELSE $5 END
          WHERE id = $1 RETURNING *`,
        [params.levelId, cleanText(params.name), params.score == null ? null : Number(params.score),
         params.slaHours === undefined ? null : String(params.slaHours),
         params.slaHours == null ? null : Number(params.slaHours)]);
      if (!r.rowCount) throw cErr('COMPETITION_LEVEL_NOT_FOUND', 'Không tìm thấy mức duyệt.', 404);
      row = r.rows[0];
    } else {
      action = 'level_create';
      const r = await client.query(
        `INSERT INTO competition.approval_levels (campaign_id, level_order, name, score, sla_hours)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [params.campaignId, Number(params.levelOrder), cleanText(params.name),
         Number(params.score), params.slaHours == null ? null : Number(params.slaHours)]);
      row = r.rows[0];
    }
    await client.query(
      `INSERT INTO competition.campaign_history (campaign_id, action, actor_account_id, actor_employee_code, actor_display_name, after, reason)
       VALUES ($1, $2, $3,$4,$5, jsonb_build_object('level_order',$6::int,'name',$7::text,'score',$8::numeric), $9)`,
      [params.campaignId, override ? 'level_exceptional_correction' : action,
       aa.account_id, aa.employee_code, aa.display_name, row.level_order, row.name, row.score, reason]);
    return levelView(row);
  });
}

async function deleteLevel(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  requireCompetitionAdmin(auth);
  const aa = auditActor(actor);
  return writeTx(config, async (client) => {
    const r = await client.query('DELETE FROM competition.approval_levels WHERE id = $1 AND campaign_id = $2 RETURNING *', [params.levelId, params.campaignId]);
    if (!r.rowCount) throw cErr('COMPETITION_LEVEL_NOT_FOUND', 'Không tìm thấy mức duyệt.', 404);
    await client.query(
      `INSERT INTO competition.campaign_history (campaign_id, action, actor_account_id, actor_employee_code, actor_display_name, before)
       VALUES ($1,'level_edit',$2,$3,$4, jsonb_build_object('deleted_level_order',$5::int))`,
      [params.campaignId, aa.account_id, aa.employee_code, aa.display_name, r.rows[0].level_order]);
    return { deleted: true, levelOrder: r.rows[0].level_order };
  });
}

// ---- grants -------------------------------------------------------------
async function setReviewerGrant(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  requireCompetitionAdmin(auth);
  const aa = auditActor(actor);
  const active = params.active !== false;
  return writeTx(config, async (client) => {
    let row;
    if (active) {
      const r = await client.query(
        `INSERT INTO competition.reviewer_grants
           (campaign_id, account_id, employee_code, display_name, max_level_order, granted_by_account_id, granted_by_employee_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (campaign_id, account_id) DO UPDATE
           SET max_level_order = EXCLUDED.max_level_order, is_active = true, display_name = EXCLUDED.display_name,
               revoked_at = NULL, revoked_by_account_id = NULL, revoke_reason = NULL
         RETURNING *`,
        [params.campaignId, cleanText(params.accountId), cleanText(params.employeeCode), cleanText(params.displayName),
         Number(params.maxLevelOrder), aa.account_id, aa.employee_code]);
      row = r.rows[0];
    } else {
      const r = await client.query(
        `UPDATE competition.reviewer_grants
            SET is_active = false, revoked_at = now(), revoked_by_account_id = $3, revoke_reason = $4
          WHERE campaign_id = $1 AND account_id = $2 RETURNING *`,
        [params.campaignId, cleanText(params.accountId), aa.account_id, cleanText(params.reason)]);
      if (!r.rowCount) throw cErr('COMPETITION_GRANT_NOT_FOUND', 'Không tìm thấy phân quyền người duyệt.', 404);
      row = r.rows[0];
    }
    await client.query(
      `INSERT INTO competition.permission_history
         (grant_kind, action, campaign_id, target_account_id, target_employee_code,
          actor_account_id, actor_employee_code, actor_display_name, after, reason)
       VALUES ('reviewer', $1, $2, $3, $4, $5,$6,$7, jsonb_build_object('max_level_order',$8::int,'is_active',$9::boolean), $10)`,
      [active ? 'grant' : 'revoke', params.campaignId, row.account_id, row.employee_code,
       aa.account_id, aa.employee_code, aa.display_name, row.max_level_order, row.is_active, cleanText(params.reason)]);
    return { id: row.id, accountId: row.account_id, employeeCode: row.employee_code, maxLevelOrder: row.max_level_order, isActive: row.is_active };
  });
}

async function setAdminGrant(config, actor, params) {
  const auth = await resolveAuthority(config, actor);
  requireCompetitionAdmin(auth);
  const aa = auditActor(actor);
  const active = params.active !== false;
  return writeTx(config, async (client) => {
    let row;
    if (active) {
      const r = await client.query(
        `INSERT INTO competition.admin_grants
           (account_id, employee_code, display_name, reason, granted_by_account_id, granted_by_employee_code)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [cleanText(params.accountId), cleanText(params.employeeCode), cleanText(params.displayName),
         cleanText(params.reason), aa.account_id, aa.employee_code]);
      row = r.rows[0];
    } else {
      const r = await client.query(
        `UPDATE competition.admin_grants SET is_active = false, revoked_at = now(), revoked_by_account_id = $2, revoke_reason = $3
          WHERE account_id = $1 AND is_active RETURNING *`,
        [cleanText(params.accountId), aa.account_id, cleanText(params.reason)]);
      if (!r.rowCount) throw cErr('COMPETITION_GRANT_NOT_FOUND', 'Không tìm thấy quyền Competition Admin.', 404);
      row = r.rows[0];
    }
    await client.query(
      `INSERT INTO competition.permission_history
         (grant_kind, action, target_account_id, target_employee_code, actor_account_id, actor_employee_code, actor_display_name, after, reason)
       VALUES ('admin', $1, $2, $3, $4,$5,$6, jsonb_build_object('is_active',$7::boolean), $8)`,
      [active ? 'grant' : 'revoke', row.account_id, row.employee_code, aa.account_id, aa.employee_code, aa.display_name, row.is_active, cleanText(params.reason)]);
    return { id: row.id, accountId: row.account_id, isActive: row.is_active };
  });
}

async function setCapabilityGrant(config, actor, params) {
  const auth = await resolveAuthority(config, actor);
  requireCompetitionAdmin(auth);
  const capability = String(params.capability || '');
  if (capability !== 'view_participation_progress') throw cErr('COMPETITION_CAPABILITY_INVALID', 'Capability không hợp lệ.', 400);
  const aa = auditActor(actor);
  const active = params.active !== false;
  return writeTx(config, async (client) => {
    let row;
    if (active) {
      const r = await client.query(
        `INSERT INTO competition.capability_grants
           (capability, account_id, employee_code, display_name, granted_by_account_id, granted_by_employee_code)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (capability, account_id) WHERE is_active DO NOTHING
         RETURNING *`,
        [capability, cleanText(params.accountId), cleanText(params.employeeCode), cleanText(params.displayName), aa.account_id, aa.employee_code]);
      if (!r.rowCount) {
        const ex = await client.query('SELECT * FROM competition.capability_grants WHERE capability=$1 AND account_id=$2 AND is_active', [capability, cleanText(params.accountId)]);
        row = ex.rows[0];
      } else row = r.rows[0];
    } else {
      const r = await client.query(
        `UPDATE competition.capability_grants SET is_active = false, revoked_at = now(), revoked_by_account_id = $3, revoke_reason = $4
          WHERE capability = $1 AND account_id = $2 AND is_active RETURNING *`,
        [capability, cleanText(params.accountId), aa.account_id, cleanText(params.reason)]);
      if (!r.rowCount) throw cErr('COMPETITION_GRANT_NOT_FOUND', 'Không tìm thấy capability grant.', 404);
      row = r.rows[0];
    }
    await client.query(
      `INSERT INTO competition.permission_history
         (grant_kind, action, capability, target_account_id, target_employee_code, actor_account_id, actor_employee_code, actor_display_name, after, reason)
       VALUES ('capability', $1, $2, $3, $4, $5,$6,$7, jsonb_build_object('is_active',$8::boolean), $9)`,
      [active ? 'grant' : 'revoke', capability, row.account_id, row.employee_code, aa.account_id, aa.employee_code, aa.display_name, row.is_active, cleanText(params.reason)]);
    return { id: row.id, capability, accountId: row.account_id, isActive: row.is_active };
  });
}

// ---- grant listings (Batch C3 — Cài đặt xét duyệt admin UI reads) --------
// Admin-only. Module-wide (admin/capability) or per-campaign (reviewer).
async function listReviewerGrants(config, actor, params) {
  const auth = await resolveAuthority(config, actor, params.campaignId);
  requireCompetitionAdmin(auth);
  return readTx(config, async (client) => {
    const r = await client.query(
      `SELECT id, account_id, employee_code, display_name, max_level_order, is_active, granted_at, revoked_at
         FROM competition.reviewer_grants WHERE campaign_id = $1 ORDER BY max_level_order DESC, granted_at`,
      [params.campaignId]);
    return r.rows.map((x) => ({
      id: x.id, accountId: x.account_id, employeeCode: x.employee_code, displayName: x.display_name,
      maxLevelOrder: x.max_level_order, isActive: x.is_active, grantedAt: x.granted_at, revokedAt: x.revoked_at,
    }));
  });
}

async function listAdminGrants(config, actor) {
  const auth = await resolveAuthority(config, actor);
  requireCompetitionAdmin(auth);
  return readTx(config, async (client) => {
    const r = await client.query(
      `SELECT id, account_id, employee_code, display_name, reason, is_active, granted_at, revoked_at
         FROM competition.admin_grants ORDER BY granted_at DESC`);
    return r.rows.map((x) => ({
      id: x.id, accountId: x.account_id, employeeCode: x.employee_code, displayName: x.display_name,
      reason: x.reason, isActive: x.is_active, grantedAt: x.granted_at, revokedAt: x.revoked_at,
    }));
  });
}

async function listCapabilityGrants(config, actor, params) {
  const auth = await resolveAuthority(config, actor);
  requireCompetitionAdmin(auth);
  const capability = params && params.capability ? String(params.capability) : 'view_participation_progress';
  return readTx(config, async (client) => {
    const r = await client.query(
      `SELECT id, capability, account_id, employee_code, display_name, is_active, granted_at, revoked_at
         FROM competition.capability_grants WHERE capability = $1 ORDER BY granted_at DESC`,
      [capability]);
    return r.rows.map((x) => ({
      id: x.id, capability: x.capability, accountId: x.account_id, employeeCode: x.employee_code,
      displayName: x.display_name, isActive: x.is_active, grantedAt: x.granted_at, revokedAt: x.revoked_at,
    }));
  });
}

module.exports = {
  campaignPublicView, levelView,
  listCampaigns, getActiveCampaign, getCampaignDetail,
  createDraftCampaign, updateDraftCampaign, changeCampaignStatus, publishCampaign,
  listLevels, upsertLevel, deleteLevel,
  setReviewerGrant, setAdminGrant, setCapabilityGrant,
  listReviewerGrants, listAdminGrants, listCapabilityGrants,
};
