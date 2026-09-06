'use strict';

// PHF HR — QUẢN TRỊ TỔNG HỢP (QTTH) V1 · Batch 01 · phf-hr-api action dispatcher.
//
// ONE canonical action map, shared by the phf-hr-api HTTP route (POST /v1/qtth)
// and the Vercel bridge (api/_lib/qtth-bridge.js) so the action list never
// drifts between layers.
//
// Every handler is (config, actor, params). `actor` is the VERIFIED actor
// supplied across the service-token boundary — resolved on the Vercel side
// against the People Master (Supabase MAIN). phf-hr-api never resolves identity
// itself and the client can never supply an authoritative actor.
//
// Company PostgreSQL phf_hr / schema qtth ONLY (dev/throwaway: phf_hr_e2e).
// Every DB call goes through the Task runtime-identity helpers
// (withTaskReadTransaction / withTaskWriteTransaction: BEGIN -> SET LOCAL ROLE
// phf_hr_app -> work -> COMMIT/ROLLBACK). No Supabase here, no People Master.
//
// AUTHORIZATION IS SERVER-AUTHORITATIVE HERE (not "decided upstream"):
//   - system Admin (actor.systemRole === 'admin')  -> always full
//   - an ACTIVE qtth.permission_manager_grant row  -> may manage the two module
//     permissions + classification + dictionaries, but NOT the manager grant
//   - anyone else -> denied for every management action
// Permissions are NEVER inferred from job title / position / department / Task /
// Competition.

const { withTaskReadTransaction, withTaskWriteTransaction } = require('./db');

class QtthError extends Error {
  constructor(code, message, statusCode) {
    super(message || code);
    this.code = code;
    this.statusCode = statusCode || 400;
    this.isQtthError = true;
  }
}
function qErr(code, message, statusCode) { return new QtthError(code, message, statusCode); }

function mapPgError(err) {
  const code = String((err && err.code) || '');
  if (code === '23505') return qErr('QTTH_DUPLICATE', 'Bản ghi trùng.', 409);
  if (code === '23503') return qErr('QTTH_FK_VIOLATION', 'Tham chiếu danh mục không hợp lệ.', 409);
  if (code === '23514') return qErr('QTTH_CHECK_VIOLATION', 'Dữ liệu không hợp lệ.', 400);
  if (code === '42P01' || code === '3F000') return qErr('QTTH_SCHEMA_MISSING', 'Schema qtth chưa được cài đặt. Hãy chạy migrations/phf_hr_qtth_foundation_v1.sql.', 503);
  if (code === '42501') return qErr('QTTH_PERMISSION_DENIED', 'Thiếu quyền truy cập dữ liệu QTTH ở tầng CSDL.', 500);
  if (code === '57014') return qErr('QTTH_READ_TIMEOUT', 'Truy vấn QTTH quá thời gian chờ.', 504);
  return null;
}
async function readTx(config, fn) {
  try { return await withTaskReadTransaction(config, fn); } catch (e) { throw mapPgError(e) || e; }
}
async function writeTx(config, fn) {
  try { return await withTaskWriteTransaction(config, fn); } catch (e) { throw mapPgError(e) || e; }
}

function text(v) { const s = v == null ? '' : String(v).trim(); return s === '' ? null : s; }
function upperCode(v) { const s = text(v); return s ? s.toUpperCase() : null; }
function assertActor(actor) {
  if (!actor || typeof actor !== 'object') throw qErr('QTTH_ACTOR_REQUIRED', 'Thiếu actor đã xác thực.', 401);
  const accountId = text(actor.accountId);
  const employeeCode = upperCode(actor.employeeCode);
  if (!accountId && !employeeCode) throw qErr('QTTH_ACTOR_REQUIRED', 'Actor không có định danh.', 401);
  return {
    accountId, employeeCode,
    displayName: text(actor.displayName),
    systemRole: String(actor.systemRole || 'learner'),
  };
}
function isAdmin(actor) { return actor.systemRole === 'admin'; }

const PERIOD_RE = /^20[0-9]{2}-(0[1-9]|1[0-2])$/;
function assertPeriod(p) {
  const v = text(p);
  if (!v || !PERIOD_RE.test(v)) throw qErr('QTTH_PERIOD_INVALID', 'Kỳ quản trị phải theo định dạng YYYY-MM.', 400);
  return v;
}

// --- authority ------------------------------------------------------------
async function isActivePermissionManager(config, employeeCode) {
  if (!employeeCode) return false;
  return readTx(config, async (c) => {
    const r = await c.query(
      'SELECT 1 FROM qtth.permission_manager_grant WHERE employee_code = $1 AND is_active = true',
      [employeeCode]
    );
    return r.rowCount > 0;
  });
}
async function requirePermissionManager(config, actor) {
  if (isAdmin(actor)) return;
  if (await isActivePermissionManager(config, actor.employeeCode)) return;
  throw qErr('QTTH_MANAGE_DENIED', 'Bạn không có quyền quản lý phân quyền QTTH.', 403);
}
function requireAdmin(actor) {
  if (!isAdmin(actor)) throw qErr('QTTH_ADMIN_REQUIRED', 'Chỉ Admin (Control Tower) được thực hiện thao tác này.', 403);
}
function auditCols(actor) { return [actor.accountId, actor.displayName || actor.employeeCode || null]; }

// --- handlers ------------------------------------------------------------
const HANDLERS = {
  // Viewer capability snapshot for the module shell.
  'qtth.bootstrap': async (config, actor) => {
    const admin = isAdmin(actor);
    let canManagePermissions = admin;
    let canViewQtth = admin;
    let canViewOperations = admin;
    if (!admin && actor.employeeCode) {
      const row = await readTx(config, async (c) => {
        const [mgr, perm] = await Promise.all([
          c.query('SELECT is_active FROM qtth.permission_manager_grant WHERE employee_code = $1', [actor.employeeCode]),
          c.query('SELECT can_view_qtth, can_view_operations FROM qtth.module_permission WHERE employee_code = $1', [actor.employeeCode]),
        ]);
        return {
          mgr: mgr.rowCount > 0 && mgr.rows[0].is_active === true,
          p: perm.rows[0] || null,
        };
      });
      canManagePermissions = row.mgr;
      canViewQtth = row.mgr || !!(row.p && row.p.can_view_qtth);
      canViewOperations = row.mgr || !!(row.p && row.p.can_view_operations);
    }
    return {
      viewer: {
        accountId: actor.accountId, employeeCode: actor.employeeCode,
        displayName: actor.displayName, systemRole: actor.systemRole, isAdmin: admin,
      },
      capabilities: { canManagePermissions, canViewQtth, canViewOperations },
    };
  },

  // ---- module permissions --------------------------------------------
  'qtth.permissions.list': async (config, actor) => {
    await requirePermissionManager(config, actor);
    return readTx(config, async (c) => {
      const [perms, mgrs] = await Promise.all([
        c.query('SELECT employee_code, can_view_qtth, can_view_operations, updated_at, updated_by_name FROM qtth.module_permission'),
        c.query('SELECT employee_code, is_active, granted_by_name, updated_at FROM qtth.permission_manager_grant'),
      ]);
      return {
        permissions: perms.rows.map((r) => ({
          employeeCode: r.employee_code,
          canViewQtth: r.can_view_qtth === true,
          canViewOperations: r.can_view_operations === true,
          updatedAt: r.updated_at, updatedByName: r.updated_by_name || '',
        })),
        permissionManagers: mgrs.rows.map((r) => ({
          employeeCode: r.employee_code, isActive: r.is_active === true,
          grantedByName: r.granted_by_name || '', updatedAt: r.updated_at,
        })),
      };
    });
  },

  // Set ONE module permission for ONE person. Never bulk (§10). Writes history.
  'qtth.permissions.set': async (config, actor, params) => {
    await requirePermissionManager(config, actor);
    const employeeCode = upperCode(params && params.employeeCode);
    const field = text(params && params.field);
    const value = (params && params.value) === true;
    if (!employeeCode) throw qErr('QTTH_EMPLOYEE_REQUIRED', 'Thiếu mã nhân viên.', 400);
    if (field !== 'can_view_qtth' && field !== 'can_view_operations') {
      throw qErr('QTTH_FIELD_INVALID', 'Chỉ được đặt can_view_qtth hoặc can_view_operations.', 400);
    }
    return writeTx(config, async (c) => {
      const cur = await c.query('SELECT can_view_qtth, can_view_operations FROM qtth.module_permission WHERE employee_code = $1 FOR UPDATE', [employeeCode]);
      const before = cur.rows[0] ? cur.rows[0][field] === true : false;
      if (before === value) return { employeeCode, field, value, changed: false };
      const [a, n] = auditCols(actor);
      await c.query(
        `INSERT INTO qtth.module_permission (employee_code, ${field}, updated_by_account_id, updated_by_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (employee_code) DO UPDATE SET ${field} = EXCLUDED.${field},
           updated_by_account_id = EXCLUDED.updated_by_account_id, updated_by_name = EXCLUDED.updated_by_name`,
        [employeeCode, value, a, n]
      );
      await c.query(
        `INSERT INTO qtth.permission_history (employee_code, field, before_value, after_value, changed_by_account_id, changed_by_name)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [employeeCode, field, before, value, a, n]
      );
      return { employeeCode, field, value, changed: true };
    });
  },

  // Grant / revoke "quản lý phân quyền" to a non-Admin user (e.g. Thắng).
  // Admin only (§4). Writes history under field 'permission_manager'.
  'qtth.permissionManager.set': async (config, actor, params) => {
    requireAdmin(actor);
    const employeeCode = upperCode(params && params.employeeCode);
    const isActive = (params && params.isActive) === true;
    if (!employeeCode) throw qErr('QTTH_EMPLOYEE_REQUIRED', 'Thiếu mã nhân viên.', 400);
    return writeTx(config, async (c) => {
      const cur = await c.query('SELECT is_active FROM qtth.permission_manager_grant WHERE employee_code = $1 FOR UPDATE', [employeeCode]);
      const before = cur.rows[0] ? cur.rows[0].is_active === true : false;
      if (before === isActive) return { employeeCode, isActive, changed: false };
      const [a, n] = auditCols(actor);
      await c.query(
        `INSERT INTO qtth.permission_manager_grant (employee_code, is_active, granted_by_account_id, granted_by_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (employee_code) DO UPDATE SET is_active = EXCLUDED.is_active,
           granted_by_account_id = EXCLUDED.granted_by_account_id, granted_by_name = EXCLUDED.granted_by_name`,
        [employeeCode, isActive, a, n]
      );
      await c.query(
        `INSERT INTO qtth.permission_history (employee_code, field, before_value, after_value, changed_by_account_id, changed_by_name)
         VALUES ($1, 'permission_manager', $2, $3, $4, $5)`,
        [employeeCode, before, isActive, a, n]
      );
      return { employeeCode, isActive, changed: true };
    });
  },

  // ---- dictionaries -------------------------------------------------
  'qtth.dict.list': async (config, actor) => {
    await requirePermissionManager(config, actor);
    return readTx(config, async (c) => {
      const [u, g] = await Promise.all([
        c.query('SELECT id, name, sort_order, is_active FROM qtth.dict_unit ORDER BY sort_order, lower(name)'),
        c.query('SELECT id, name, sort_order, is_active FROM qtth.dict_group ORDER BY sort_order, lower(name)'),
      ]);
      const map = (rows) => rows.map((r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order, isActive: r.is_active === true }));
      return { units: map(u.rows), groups: map(g.rows) };
    });
  },
  'qtth.dict.upsert': async (config, actor, params) => {
    await requirePermissionManager(config, actor);
    const kind = text(params && params.kind);
    const table = kind === 'unit' ? 'qtth.dict_unit' : kind === 'group' ? 'qtth.dict_group' : null;
    if (!table) throw qErr('QTTH_DICT_KIND_INVALID', 'kind phải là unit hoặc group.', 400);
    const id = text(params && params.id);
    const name = text(params && params.name);
    const sortOrder = Number.isFinite(Number(params && params.sortOrder)) ? Math.trunc(Number(params.sortOrder)) : null;
    const isActive = params && Object.prototype.hasOwnProperty.call(params, 'isActive') ? params.isActive === true : null;
    return writeTx(config, async (c) => {
      const [a, n] = auditCols(actor);
      if (!id) {
        if (!name) throw qErr('QTTH_DICT_NAME_REQUIRED', 'Tên danh mục là bắt buộc.', 400);
        const r = await c.query(
          `INSERT INTO ${table} (name, sort_order, is_active, created_by_account_id, created_by_name)
           VALUES ($1, COALESCE($2, 0), COALESCE($3, true), $4, $5) RETURNING id`,
          [name, sortOrder, isActive, a, n]
        );
        return { id: r.rows[0].id, created: true };
      }
      const sets = [];
      const vals = [];
      let i = 1;
      if (name != null) { sets.push(`name = $${i++}`); vals.push(name); }
      if (sortOrder != null) { sets.push(`sort_order = $${i++}`); vals.push(sortOrder); }
      if (isActive != null) { sets.push(`is_active = $${i++}`); vals.push(isActive); }
      if (!sets.length) return { id, updated: false };
      vals.push(id);
      const r = await c.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`, vals);
      if (!r.rowCount) throw qErr('QTTH_DICT_NOT_FOUND', 'Không tìm thấy mục danh mục.', 404);
      return { id, updated: true };
    });
  },

  // ---- classification (monthly) -----------------------------------
  'qtth.classification.list': async (config, actor, params) => {
    await requirePermissionManager(config, actor);
    const period = assertPeriod(params && params.period);
    return readTx(config, async (c) => {
      const r = await c.query(
        `SELECT employee_code, unit_id, group_id, staff_kind, source_department_snapshot, updated_at, updated_by_name
         FROM qtth.classification WHERE period = $1`, [period]
      );
      return {
        period,
        rows: r.rows.map((x) => ({
          employeeCode: x.employee_code,
          unitId: x.unit_id, groupId: x.group_id, staffKind: x.staff_kind || null,
          sourceDepartmentSnapshot: x.source_department_snapshot || '',
          updatedAt: x.updated_at, updatedByName: x.updated_by_name || '',
        })),
      };
    });
  },

  // Set / clear classification fields for ONE person in ONE period. Only the
  // fields present in params are touched; each change is history-logged.
  'qtth.classification.set': async (config, actor, params) => {
    await requirePermissionManager(config, actor);
    const employeeCode = upperCode(params && params.employeeCode);
    const period = assertPeriod(params && params.period);
    if (!employeeCode) throw qErr('QTTH_EMPLOYEE_REQUIRED', 'Thiếu mã nhân viên.', 400);
    const has = (k) => params && Object.prototype.hasOwnProperty.call(params, k);
    const sourceDepartment = text(params && params.sourceDepartment);
    const next = {};
    if (has('unitId')) next.unit_id = text(params.unitId);
    if (has('groupId')) next.group_id = text(params.groupId);
    if (has('staffKind')) {
      const sk = text(params.staffKind);
      if (sk && sk !== 'direct' && sk !== 'indirect') throw qErr('QTTH_STAFF_KIND_INVALID', 'Tính chất nhân sự chỉ có Trực tiếp/Gián tiếp.', 400);
      next.staff_kind = sk;
    }
    if (!Object.keys(next).length && sourceDepartment == null) return { employeeCode, period, changed: false };
    return writeTx(config, async (c) => {
      const cur = await c.query('SELECT unit_id, group_id, staff_kind FROM qtth.classification WHERE employee_code = $1 AND period = $2 FOR UPDATE', [employeeCode, period]);
      const before = cur.rows[0] || { unit_id: null, group_id: null, staff_kind: null };
      const merged = {
        unit_id: 'unit_id' in next ? next.unit_id : before.unit_id,
        group_id: 'group_id' in next ? next.group_id : before.group_id,
        staff_kind: 'staff_kind' in next ? next.staff_kind : before.staff_kind,
      };
      const [a, n] = auditCols(actor);
      await c.query(
        `INSERT INTO qtth.classification (employee_code, period, unit_id, group_id, staff_kind, source_department_snapshot, updated_by_account_id, updated_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (employee_code, period) DO UPDATE SET
           unit_id = EXCLUDED.unit_id, group_id = EXCLUDED.group_id, staff_kind = EXCLUDED.staff_kind,
           source_department_snapshot = COALESCE(EXCLUDED.source_department_snapshot, qtth.classification.source_department_snapshot),
           updated_by_account_id = EXCLUDED.updated_by_account_id, updated_by_name = EXCLUDED.updated_by_name`,
        [employeeCode, period, merged.unit_id, merged.group_id, merged.staff_kind, sourceDepartment, a, n]
      );
      for (const field of Object.keys(next)) {
        const b = before[field] == null ? null : String(before[field]);
        const af = next[field] == null ? null : String(next[field]);
        if (b === af) continue;
        await c.query(
          `INSERT INTO qtth.classification_history (employee_code, period, field, before_value, after_value, changed_by_account_id, changed_by_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [employeeCode, period, field, b, af, a, n]
        );
      }
      return { employeeCode, period, changed: true };
    });
  },

  // Bulk classification (§10) — ONE field value applied to many people in one
  // period. Permission is NEVER bulk. field ∈ unit_id|group_id|staff_kind.
  'qtth.classification.bulkSet': async (config, actor, params) => {
    await requirePermissionManager(config, actor);
    const period = assertPeriod(params && params.period);
    const field = text(params && params.field);
    if (['unit_id', 'group_id', 'staff_kind'].indexOf(field) < 0) throw qErr('QTTH_FIELD_INVALID', 'field không hợp lệ cho gán hàng loạt.', 400);
    let value = text(params && params.value);
    if (field === 'staff_kind' && value && value !== 'direct' && value !== 'indirect') {
      throw qErr('QTTH_STAFF_KIND_INVALID', 'Tính chất nhân sự chỉ có Trực tiếp/Gián tiếp.', 400);
    }
    const codes = Array.isArray(params && params.employeeCodes)
      ? Array.from(new Set(params.employeeCodes.map(upperCode).filter(Boolean))) : [];
    if (!codes.length) throw qErr('QTTH_BULK_EMPTY', 'Chưa chọn nhân sự nào.', 400);
    if (codes.length > 500) throw qErr('QTTH_BULK_TOO_LARGE', 'Tối đa 500 nhân sự mỗi lần gán.', 400);
    const [a, n] = auditCols(actor);
    return writeTx(config, async (c) => {
      let changed = 0;
      for (const code of codes) {
        const cur = await c.query(`SELECT ${field} AS v FROM qtth.classification WHERE employee_code = $1 AND period = $2 FOR UPDATE`, [code, period]);
        const before = cur.rows[0] ? cur.rows[0].v : null;
        const b = before == null ? null : String(before);
        if (b === (value || null)) continue;
        await c.query(
          `INSERT INTO qtth.classification (employee_code, period, ${field}, updated_by_account_id, updated_by_name)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (employee_code, period) DO UPDATE SET ${field} = EXCLUDED.${field},
             updated_by_account_id = EXCLUDED.updated_by_account_id, updated_by_name = EXCLUDED.updated_by_name`,
          [code, period, value, a, n]
        );
        await c.query(
          `INSERT INTO qtth.classification_history (employee_code, period, field, before_value, after_value, changed_by_account_id, changed_by_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [code, period, field, b, value, a, n]
        );
        changed++;
      }
      return { period, field, value, requested: codes.length, changed };
    });
  },

  // §12 — carry a period's classification forward to the next period for the
  // still-active employees that don't yet have a row there. Idempotent.
  // activeEmployeeCodes is supplied by the Vercel layer (People Master).
  'qtth.classification.inheritMonth': async (config, actor, params) => {
    await requirePermissionManager(config, actor);
    const fromPeriod = assertPeriod(params && params.fromPeriod);
    const toPeriod = assertPeriod(params && params.toPeriod);
    if (fromPeriod >= toPeriod) throw qErr('QTTH_PERIOD_ORDER', 'toPeriod phải sau fromPeriod.', 400);
    const active = new Set(Array.isArray(params && params.activeEmployeeCodes) ? params.activeEmployeeCodes.map(upperCode).filter(Boolean) : []);
    const [a, n] = auditCols(actor);
    return writeTx(config, async (c) => {
      const src = await c.query('SELECT employee_code, unit_id, group_id, staff_kind, source_department_snapshot FROM qtth.classification WHERE period = $1', [fromPeriod]);
      let inserted = 0;
      for (const row of src.rows) {
        if (active.size && !active.has(row.employee_code)) continue; // §12: inactive not carried forward
        const r = await c.query(
          `INSERT INTO qtth.classification (employee_code, period, unit_id, group_id, staff_kind, source_department_snapshot, updated_by_account_id, updated_by_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (employee_code, period) DO NOTHING`,
          [row.employee_code, toPeriod, row.unit_id, row.group_id, row.staff_kind, row.source_department_snapshot, a, n]
        );
        inserted += r.rowCount;
      }
      return { fromPeriod, toPeriod, inserted };
    });
  },

  // ---- history reads -------------------------------------------------
  'qtth.history.permission': async (config, actor, params) => {
    await requirePermissionManager(config, actor);
    const employeeCode = upperCode(params && params.employeeCode);
    if (!employeeCode) throw qErr('QTTH_EMPLOYEE_REQUIRED', 'Thiếu mã nhân viên.', 400);
    return readTx(config, async (c) => {
      const r = await c.query(
        `SELECT field, before_value, after_value, changed_by_name, changed_at
         FROM qtth.permission_history WHERE employee_code = $1 ORDER BY changed_at DESC LIMIT 200`, [employeeCode]
      );
      return { employeeCode, entries: r.rows.map((x) => ({
        field: x.field, before: x.before_value, after: x.after_value,
        changedByName: x.changed_by_name || '', changedAt: x.changed_at,
      })) };
    });
  },
  'qtth.history.classification': async (config, actor, params) => {
    await requirePermissionManager(config, actor);
    const employeeCode = upperCode(params && params.employeeCode);
    if (!employeeCode) throw qErr('QTTH_EMPLOYEE_REQUIRED', 'Thiếu mã nhân viên.', 400);
    const period = text(params && params.period);
    return readTx(config, async (c) => {
      const r = await c.query(
        `SELECT period, field, before_value, after_value, changed_by_name, changed_at
         FROM qtth.classification_history
         WHERE employee_code = $1 ${period ? 'AND period = $2' : ''}
         ORDER BY changed_at DESC LIMIT 300`,
        period ? [employeeCode, period] : [employeeCode]
      );
      return { employeeCode, entries: r.rows.map((x) => ({
        period: x.period, field: x.field, before: x.before_value, after: x.after_value,
        changedByName: x.changed_by_name || '', changedAt: x.changed_at,
      })) };
    });
  },
};

const ACTIONS = Object.freeze(Object.keys(HANDLERS));

async function dispatch(config, rawActor, action, params) {
  const handler = HANDLERS[action];
  if (!handler) throw qErr('QTTH_ACTION_UNKNOWN', 'Hành động QTTH không hợp lệ: ' + action, 400);
  const actor = assertActor(rawActor);
  return handler(config, actor, params || {});
}

module.exports = { dispatch, ACTIONS, HANDLERS, QtthError };
