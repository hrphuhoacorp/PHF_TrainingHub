'use strict';

require('dotenv').config();
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const okEnv = Boolean(
  String(process.env.SUPABASE_URL || '').trim() &&
  String(process.env.SUPABASE_SECRET_KEY || '').trim()
);
const supabase = okEnv
  ? createClient(
      String(process.env.SUPABASE_URL).trim(),
      String(process.env.SUPABASE_SECRET_KEY).trim(),
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
  : null;

const TABLE = 'checklist_violation_records';
const HISTORY_TABLE = 'checklist_violation_record_history';
const PERMISSION_TABLE = 'checklist_permission_grants';
const SETTINGS_TABLE = 'checklist_system_settings';
const ASSIGNMENT_TABLE = 'checklist_employee_assignments';
const ASSIGNMENT_HISTORY_TABLE = 'checklist_employee_assignment_history';
const TEMPLATE_TABLE = 'checklist_templates';
const TEMPLATE_VERSION_TABLE = 'checklist_template_versions';
const MODE_KEY = 'violation_mode';
const LATE_POLICY_TABLE = 'checklist_late_point_policies';
const LATE_POLICY_HISTORY_TABLE = 'checklist_late_point_policy_history';
const REPEAT_POLICY_TABLE = 'checklist_repeat_violation_policies';
const REPEAT_POLICY_HISTORY_TABLE = 'checklist_repeat_violation_policy_history';

function t(value) {
  return String(value == null ? '' : value).trim();
}

function date(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(t(value))
    ? t(value)
    : new Date().toISOString().slice(0, 10);
}

function time(value) {
  const normalized = t(value);
  return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(normalized)
    ? normalized
    : null;
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNum(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function fail(message, statusCode, code, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details) error.details = details;
  throw error;
}

function actor(session) {
  return {
    id: t(session?.account?.id || session?.sub),
    name: t(session?.account?.name || session?.account?.email || session?.email),
    employeeCode: t(session?.employeeCode || session?.account?.employeeCode).toUpperCase(),
    role: t(session?.role).toLowerCase()
  };
}

function normalizeText(value) {
  return t(value).toLowerCase().replace(/\s+/g, ' ');
}

function sameText(left, right) {
  return normalizeText(left) === normalizeText(right);
}

function duplicateFingerprint(row) {
  const raw = [
    t(row.employee_code).toUpperCase(),
    t(row.criterion_code).toUpperCase(),
    date(row.occurred_date),
    t(row.occurred_time).slice(0, 5),
    normalizeText(row.location),
    normalizeText(row.note)
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function requireAdmin(session, message = 'Chỉ Admin được thực hiện thao tác này.') {
  if (!session || session.role !== 'admin') {
    fail(message, 403, 'CHECKLIST_ADMIN_ONLY');
  }
}



function monthPeriod(value, fallback = '') {
  const normalized = t(value);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(normalized)) return normalized;
  if (fallback) return monthPeriod(fallback);
  fail('Kỳ áp dụng không hợp lệ.', 400, 'CHECKLIST_LATE_POLICY_PERIOD_INVALID');
}

function defaultLateLevels() {
  return [
    { minMinutes: 1, maxMinutes: 5, points: 1 },
    { minMinutes: 6, maxMinutes: 15, points: 2 },
    { minMinutes: 16, maxMinutes: 30, points: 3 },
    { minMinutes: 31, maxMinutes: null, points: 5 }
  ];
}

function normalizeLateLevels(levels, strict = false) {
  const source = Array.isArray(levels) && levels.length ? levels : defaultLateLevels();
  if (strict && (source.length < 1 || source.length > 10)) {
    fail('Bảng mức đi trễ phải có từ 1 đến 10 mức.', 400, 'CHECKLIST_LATE_POLICY_LEVEL_COUNT_INVALID');
  }
  const normalized = source.map((row, index) => {
    const minMinutes = Math.round(Number(row && (row.minMinutes ?? row.min_minutes)));
    const rawMax = row && (row.maxMinutes ?? row.max_minutes);
    const maxMinutes = rawMax == null || t(rawMax) === '' ? null : Math.round(Number(rawMax));
    const points = Math.round(Number(row && row.points) * 100) / 100;
    if (!Number.isFinite(minMinutes) || minMinutes < 1 || minMinutes > 1440) {
      fail('Mức ' + (index + 1) + ': phút bắt đầu phải từ 1 đến 1440.', 400, 'CHECKLIST_LATE_POLICY_MIN_INVALID');
    }
    if (maxMinutes != null && (!Number.isFinite(maxMinutes) || maxMinutes < minMinutes || maxMinutes > 1440)) {
      fail('Mức ' + (index + 1) + ': phút kết thúc không hợp lệ.', 400, 'CHECKLIST_LATE_POLICY_MAX_INVALID');
    }
    if (!Number.isFinite(points) || points < 0 || points > 100) {
      fail('Mức ' + (index + 1) + ': điểm chuẩn phải từ 0 đến 100.', 400, 'CHECKLIST_LATE_POLICY_POINTS_INVALID');
    }
    return { minMinutes, maxMinutes, points };
  }).sort((a, b) => a.minMinutes - b.minMinutes);

  if (strict) {
    if (normalized[0].minMinutes !== 1) {
      fail('Bảng mức đi trễ phải bắt đầu từ phút thứ 1.', 400, 'CHECKLIST_LATE_POLICY_START_INVALID');
    }
    normalized.forEach((row, index) => {
      const isLast = index === normalized.length - 1;
      if (!isLast && row.maxMinutes == null) {
        fail('Chỉ mức cuối cùng được để trống phút kết thúc.', 400, 'CHECKLIST_LATE_POLICY_OPEN_RANGE_INVALID');
      }
      if (isLast && row.maxMinutes != null) {
        fail('Mức cuối cùng phải để trống phút kết thúc để bao phủ các trường hợp còn lại.', 400, 'CHECKLIST_LATE_POLICY_LAST_RANGE_INVALID');
      }
      if (index > 0) {
        const previous = normalized[index - 1];
        if (previous.maxMinutes == null || row.minMinutes !== previous.maxMinutes + 1) {
          fail('Các mức phút phải liên tục, không chồng lấn hoặc bỏ trống khoảng.', 400, 'CHECKLIST_LATE_POLICY_RANGE_GAP');
        }
      }
    });
  }
  return normalized;
}

function latePolicyPayload(row, fallbackPeriod = '2026-08') {
  const levels = normalizeLateLevels(row && row.levels, false);
  return {
    id: t(row && row.id),
    effectiveFromPeriod: monthPeriod(row && (row.effective_from_period || row.effectiveFromPeriod) || fallbackPeriod, fallbackPeriod),
    levels,
    reason: t(row && row.reason),
    updatedAt: row && (row.updated_at || row.updatedAt) || '',
    updatedBy: t(row && (row.updated_by_name || row.updatedBy || row.created_by_name)),
    source: row && row.id ? 'database' : 'default'
  };
}

async function resolveLatePointsPolicyAt(occurredDate) {
  const period = monthPeriod(date(occurredDate).slice(0, 7));
  if (!supabase) return latePolicyPayload(null, '2026-08');
  const { data, error } = await supabase
    .from(LATE_POLICY_TABLE)
    .select('*')
    .eq('is_active', true)
    .lte('effective_from_period', period)
    .order('effective_from_period', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[PHF Checklist] late policy unavailable; use default', error.message || error);
    return latePolicyPayload(null, '2026-08');
  }
  return latePolicyPayload(data, data && data.effective_from_period || '2026-08');
}

async function getChecklistLatePointsPolicy(session, input = {}) {
  requireAdmin(session, 'Chỉ Admin được xem cấu hình điểm Đi trễ.');
  if (!supabase) fail('Supabase chưa được cấu hình.', 503, 'SUPABASE_NOT_CONFIGURED');
  const requestedPeriod = t(input.period || input.effectiveFromPeriod);
  let policy;
  if (requestedPeriod) {
    const period = monthPeriod(requestedPeriod);
    const { data, error } = await supabase
      .from(LATE_POLICY_TABLE)
      .select('*')
      .eq('is_active', true)
      .lte('effective_from_period', period)
      .order('effective_from_period', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    policy = latePolicyPayload(data, data && data.effective_from_period || period);
  } else {
    const { data, error } = await supabase
      .from(LATE_POLICY_TABLE)
      .select('*')
      .eq('is_active', true)
      .order('effective_from_period', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    policy = latePolicyPayload(data, data && data.effective_from_period || '2026-08');
  }
  const policiesRead = await supabase
    .from(LATE_POLICY_TABLE)
    .select('*')
    .eq('is_active', true)
    .order('effective_from_period', { ascending: true });
  if (policiesRead.error) throw policiesRead.error;
  const historyRead = await supabase
    .from(LATE_POLICY_HISTORY_TABLE)
    .select('*')
    .order('changed_at', { ascending: false })
    .limit(10);
  if (historyRead.error) throw historyRead.error;
  return {
    policy,
    policies: (policiesRead.data || []).map(row => latePolicyPayload(row, row.effective_from_period)),
    history: historyRead.data || [],
    ready: true
  };
}

async function saveChecklistLatePointsPolicy(session, input = {}) {
  requireAdmin(session, 'Chỉ Admin được thay đổi bảng mức Đi trễ.');
  if (!supabase) fail('Supabase chưa được cấu hình.', 503, 'SUPABASE_NOT_CONFIGURED');
  const effectiveFromPeriod = monthPeriod(input.effectiveFromPeriod || '2026-08');
  const reason = t(input.reason);
  if (reason.length < 10) fail('Lý do thay đổi cần tối thiểu 10 ký tự.', 400, 'CHECKLIST_LATE_POLICY_REASON_REQUIRED');
  const levels = normalizeLateLevels(input.levels, true);
  const currentActor = actor(session);
  const saved = await supabase.rpc('phf_save_checklist_late_points_policy', {
    p_effective_from_period: effectiveFromPeriod,
    p_levels: levels,
    p_reason: reason,
    p_actor_id: currentActor.id,
    p_actor_code: currentActor.employeeCode,
    p_actor_name: currentActor.name
  });
  if (saved.error) {
    const message = String(saved.error.message || '');
    if (/CHECKLIST_LATE_POLICY_PERIOD_LOCKED/i.test(message)) fail('Kỳ ' + effectiveFromPeriod + ' đã khóa nên không thể thay đổi bảng mức áp dụng cho kỳ này.', 409, 'CHECKLIST_LATE_POLICY_PERIOD_LOCKED');
    if (/phf_save_checklist_late_points_policy/i.test(message)) fail('Chưa chạy SQL ổn định Production cho bảng mức Đi trễ.', 503, 'CHECKLIST_STABILITY_SQL_MISSING');
    throw saved.error;
  }
  return { saved: true, policy: latePolicyPayload(saved.data && saved.data.policy || {}, effectiveFromPeriod) };
}

function defaultRepeatPolicy() {
  return {
    effectiveFromPeriod: '2026-08',
    monthlyWarningCount: 2,
    trainingOccurrenceCount: 3,
    trainingWindowMonths: 3,
    reason: '',
    updatedAt: '',
    updatedBy: '',
    source: 'default'
  };
}

function boundedInteger(value, fallback, min, max, errorMessage, errorCode) {
  const parsed = Math.round(Number(value));
  if (Number.isInteger(parsed) && parsed >= min && parsed <= max) return parsed;
  if (errorMessage) fail(errorMessage, 400, errorCode);
  return fallback;
}

function repeatPolicyPayload(row, fallbackPeriod = '2026-08') {
  const base = defaultRepeatPolicy();
  return {
    id: t(row && row.id),
    effectiveFromPeriod: monthPeriod(
      row && (row.effective_from_period || row.effectiveFromPeriod) || fallbackPeriod,
      fallbackPeriod
    ),
    monthlyWarningCount: boundedInteger(
      row && (row.monthly_warning_count ?? row.monthlyWarningCount),
      base.monthlyWarningCount,
      2,
      20
    ),
    trainingOccurrenceCount: boundedInteger(
      row && (row.training_occurrence_count ?? row.trainingOccurrenceCount),
      base.trainingOccurrenceCount,
      2,
      50
    ),
    trainingWindowMonths: boundedInteger(
      row && (row.training_window_months ?? row.trainingWindowMonths),
      base.trainingWindowMonths,
      1,
      12
    ),
    reason: t(row && row.reason),
    updatedAt: row && (row.updated_at || row.updatedAt) || '',
    updatedBy: t(row && (row.updated_by_name || row.updatedBy || row.created_by_name)),
    source: row && row.id ? 'database' : 'default',
    classIntegration: false
  };
}

async function resolveRepeatPolicyAt(periodValue) {
  const period = monthPeriod(periodValue || new Date().toISOString().slice(0, 7));
  if (!supabase) return repeatPolicyPayload(null, '2026-08');
  const { data, error } = await supabase
    .from(REPEAT_POLICY_TABLE)
    .select('*')
    .eq('is_active', true)
    .lte('effective_from_period', period)
    .order('effective_from_period', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[PHF Checklist] repeat policy unavailable; use default', error.message || error);
    return repeatPolicyPayload(null, '2026-08');
  }
  return repeatPolicyPayload(data, data && data.effective_from_period || '2026-08');
}

function shiftMonthPeriod(periodValue, delta) {
  const period = monthPeriod(periodValue);
  const parts = period.split('-').map(Number);
  const cursor = new Date(Date.UTC(parts[0], parts[1] - 1 + Number(delta || 0), 1));
  return String(cursor.getUTCFullYear()).padStart(4, '0') + '-' + String(cursor.getUTCMonth() + 1).padStart(2, '0');
}

async function getChecklistRepeatViolationPolicy(session, input = {}) {
  requireAdmin(session, 'Chỉ Admin được xem cấu hình ngưỡng lỗi lặp lại.');
  if (!supabase) fail('Supabase chưa được cấu hình.', 503, 'SUPABASE_NOT_CONFIGURED');
  const requestedPeriod = t(input.period || input.effectiveFromPeriod);
  let policy;
  if (requestedPeriod) {
    policy = await resolveRepeatPolicyAt(monthPeriod(requestedPeriod));
  } else {
    const { data, error } = await supabase
      .from(REPEAT_POLICY_TABLE)
      .select('*')
      .eq('is_active', true)
      .order('effective_from_period', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    policy = repeatPolicyPayload(data, data && data.effective_from_period || '2026-08');
  }
  const policiesRead = await supabase
    .from(REPEAT_POLICY_TABLE)
    .select('*')
    .eq('is_active', true)
    .order('effective_from_period', { ascending: true });
  if (policiesRead.error) throw policiesRead.error;
  const historyRead = await supabase
    .from(REPEAT_POLICY_HISTORY_TABLE)
    .select('*')
    .order('changed_at', { ascending: false })
    .limit(10);
  if (historyRead.error) throw historyRead.error;
  return {
    policy,
    policies: (policiesRead.data || []).map(row => repeatPolicyPayload(row, row.effective_from_period)),
    history: historyRead.data || [],
    ready: true,
    classIntegration: false
  };
}

async function saveChecklistRepeatViolationPolicy(session, input = {}) {
  requireAdmin(session, 'Chỉ Admin được thay đổi ngưỡng lỗi lặp lại.');
  if (!supabase) fail('Supabase chưa được cấu hình.', 503, 'SUPABASE_NOT_CONFIGURED');
  const effectiveFromPeriod = monthPeriod(input.effectiveFromPeriod || '2026-08');
  const monthlyWarningCount = boundedInteger(input.monthlyWarningCount, 2, 2, 20, 'Ngưỡng cảnh báo trong tháng phải từ 2 đến 20 lần.', 'CHECKLIST_REPEAT_MONTHLY_COUNT_INVALID');
  const trainingOccurrenceCount = boundedInteger(input.trainingOccurrenceCount, 3, 2, 50, 'Ngưỡng gợi ý đào tạo phải từ 2 đến 50 lần.', 'CHECKLIST_REPEAT_TRAINING_COUNT_INVALID');
  const trainingWindowMonths = boundedInteger(input.trainingWindowMonths, 3, 1, 12, 'Khoảng theo dõi gợi ý đào tạo phải từ 1 đến 12 tháng.', 'CHECKLIST_REPEAT_WINDOW_INVALID');
  if (trainingOccurrenceCount < monthlyWarningCount) fail('Ngưỡng gợi ý đào tạo không được thấp hơn ngưỡng cảnh báo trong tháng.', 400, 'CHECKLIST_REPEAT_THRESHOLD_ORDER_INVALID');
  const reason = t(input.reason);
  if (reason.length < 10) fail('Lý do thay đổi cần tối thiểu 10 ký tự.', 400, 'CHECKLIST_REPEAT_POLICY_REASON_REQUIRED');
  const currentActor = actor(session);
  const saved = await supabase.rpc('phf_save_checklist_repeat_violation_policy', {
    p_effective_from_period: effectiveFromPeriod,
    p_monthly_warning_count: monthlyWarningCount,
    p_training_occurrence_count: trainingOccurrenceCount,
    p_training_window_months: trainingWindowMonths,
    p_reason: reason,
    p_actor_id: currentActor.id,
    p_actor_code: currentActor.employeeCode,
    p_actor_name: currentActor.name
  });
  if (saved.error) {
    const message = String(saved.error.message || '');
    if (/CHECKLIST_REPEAT_POLICY_PERIOD_LOCKED/i.test(message)) fail('Kỳ ' + effectiveFromPeriod + ' đã khóa nên không thể thay đổi ngưỡng áp dụng cho kỳ này.', 409, 'CHECKLIST_REPEAT_POLICY_PERIOD_LOCKED');
    if (/phf_save_checklist_repeat_violation_policy/i.test(message)) fail('Chưa chạy SQL ổn định Production cho ngưỡng lỗi lặp.', 503, 'CHECKLIST_STABILITY_SQL_MISSING');
    throw saved.error;
  }
  return { saved: true, policy: repeatPolicyPayload(saved.data && saved.data.policy || {}, effectiveFromPeriod), classIntegration: false };
}

async function getChecklistRepeatViolationSuggestions(session, input = {}) {
  requireAdmin(session, 'Chỉ Admin được xem danh sách gợi ý lỗi lặp lại.');
  if (!supabase) fail('Supabase chưa được cấu hình.', 503, 'SUPABASE_NOT_CONFIGURED');
  const period = monthPeriod(input.period || new Date().toISOString().slice(0, 7));
  const policy = await resolveRepeatPolicyAt(period);
  const windowStartPeriod = shiftMonthPeriod(period, -(policy.trainingWindowMonths - 1));
  const nextPeriod = shiftMonthPeriod(period, 1);
  if (period < policy.effectiveFromPeriod) {
    return {
      period,
      windowStartPeriod,
      policy,
      warningCount: 0,
      trainingSuggestionCount: 0,
      suggestions: [],
      classIntegration: false,
      notEffectiveYet: true,
      message: 'Chính sách bắt đầu áp dụng từ kỳ ' + policy.effectiveFromPeriod + '; kỳ được chọn chưa áp dụng.'
    };
  }
  const { data, error } = await supabase
    .from(TABLE)
    .select('id,employee_code,employee_name,criterion_code,criterion_name,occurred_date,points')
    .eq('record_status', 'official')
    .eq('is_test', false)
    .gte('occurred_date', windowStartPeriod + '-01')
    .lt('occurred_date', nextPeriod + '-01')
    .order('occurred_date', { ascending: true });
  if (error) throw error;
  const groups = new Map();
  for (const row of data || []) {
    const employeeCode = t(row.employee_code).toUpperCase();
    const criterionCode = t(row.criterion_code).toUpperCase();
    if (!employeeCode || !criterionCode) continue;
    const key = employeeCode + '|' + criterionCode;
    if (!groups.has(key)) {
      groups.set(key, {
        employeeCode,
        employeeName: t(row.employee_name),
        criterionCode,
        criterionName: t(row.criterion_name),
        monthlyCount: 0,
        windowCount: 0,
        months: new Set(),
        latestDate: '',
        totalPoints: 0
      });
    }
    const item = groups.get(key);
    const occurredDate = date(row.occurred_date);
    const occurredPeriod = occurredDate.slice(0, 7);
    item.windowCount += 1;
    if (occurredPeriod === period) item.monthlyCount += 1;
    item.months.add(occurredPeriod);
    item.latestDate = !item.latestDate || occurredDate > item.latestDate ? occurredDate : item.latestDate;
    item.totalPoints += num(row.points, 0);
  }
  const suggestions = [];
  for (const item of groups.values()) {
    const warning = item.monthlyCount >= policy.monthlyWarningCount;
    const trainingSuggested = item.windowCount >= policy.trainingOccurrenceCount;
    if (!warning && !trainingSuggested) continue;
    suggestions.push({
      employeeCode: item.employeeCode,
      employeeName: item.employeeName,
      criterionCode: item.criterionCode,
      criterionName: item.criterionName,
      monthlyCount: item.monthlyCount,
      windowCount: item.windowCount,
      activeMonths: item.months.size,
      latestDate: item.latestDate,
      totalPoints: Math.round(item.totalPoints * 100) / 100,
      warning,
      trainingSuggested,
      suggestion: trainingSuggested
        ? 'Gợi ý Admin xem xét đào tạo/nhắc lại nghiệp vụ.'
        : 'Cảnh báo lỗi lặp trong kỳ để quản lý theo dõi.',
      classIntegration: false
    });
  }
  suggestions.sort((left, right) => {
    if (left.trainingSuggested !== right.trainingSuggested) return left.trainingSuggested ? -1 : 1;
    if (right.windowCount !== left.windowCount) return right.windowCount - left.windowCount;
    if (right.monthlyCount !== left.monthlyCount) return right.monthlyCount - left.monthlyCount;
    return left.employeeName.localeCompare(right.employeeName, 'vi');
  });
  return {
    period,
    windowStartPeriod,
    policy,
    warningCount: suggestions.filter(row => row.warning).length,
    trainingSuggestionCount: suggestions.filter(row => row.trainingSuggested).length,
    suggestions: suggestions.slice(0, 200),
    classIntegration: false,
    message: 'Chỉ tạo gợi ý trong PHF Checklist; không tự liên kết hoặc đăng ký PHF Class.'
  };
}

async function getChecklistViolationMode() {
  if (!supabase) {
    return {
      mode: 'test',
      ready: false,
      error: 'SUPABASE_NOT_CONFIGURED',
      source: 'fail_safe'
    };
  }

  try {
    const { data, error } = await supabase
      .from(SETTINGS_TABLE)
      .select('setting_value,updated_at,updated_by')
      .eq('setting_key', MODE_KEY)
      .maybeSingle();
    if (error) throw error;

    const mode = t(data && data.setting_value).toLowerCase() === 'production'
      ? 'production'
      : 'test';
    return {
      mode,
      ready: true,
      error: '',
      source: 'database',
      updatedAt: data && data.updated_at || '',
      updatedBy: data && data.updated_by || ''
    };
  } catch (error) {
    console.warn(
      '[PHF Checklist] violation mode unavailable; fail-safe TEST',
      error && error.message || error
    );
    return {
      mode: 'test',
      ready: false,
      error: error && error.code || 'CHECKLIST_VIOLATION_MODE_UNAVAILABLE',
      source: 'fail_safe'
    };
  }
}

function scopeValues(row) {
  const value = row && row.scope_values;
  if (Array.isArray(value)) return value.map(t).filter(Boolean);
  if (value && typeof value === 'object') {
    if (Array.isArray(value.values)) return value.values.map(t).filter(Boolean);
    return Object.values(value).flat().map(t).filter(Boolean);
  }
  return [];
}

async function resolveViolationPermission(session, action = 'view') {
  const currentActor = actor(session);
  if (currentActor.role === 'admin') {
    return {
      allowed: true,
      source: 'admin',
      canRecord: true,
      canView: true,
      canEditTest: true,
      canCancel: true,
      scopeType: 'all',
      scopeValues: [],
      actorId: currentActor.id,
      actorEmployeeCode: currentActor.employeeCode
    };
  }

  if (currentActor.role === 'learner') {
    if (!currentActor.employeeCode) {
      fail('Tài khoản chưa liên kết mã nhân viên Checklist.', 409, 'CHECKLIST_IDENTITY_NOT_LINKED');
    }
    return {
      allowed: action === 'view',
      source: 'employee_base',
      canRecord: false,
      canView: true,
      canEditTest: false,
      canCancel: false,
      scopeType: 'employee',
      scopeValues: [currentActor.employeeCode],
      actorId: currentActor.id,
      actorEmployeeCode: currentActor.employeeCode
    };
  }

  if (!supabase) {
    fail('Không thể kiểm tra quyền Ghi nhận lỗi.', 503, 'CHECKLIST_PERMISSION_UNAVAILABLE');
  }

  const filters = [];
  if (currentActor.id) filters.push('account_id.eq.' + currentActor.id);
  if (currentActor.employeeCode) filters.push('employee_code.eq.' + currentActor.employeeCode);
  if (!filters.length) {
    fail('Tài khoản chưa có định danh để kiểm tra quyền.', 403, 'CHECKLIST_PERMISSION_IDENTITY_MISSING');
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: rows, error } = await supabase
    .from(PERMISSION_TABLE)
    .select('account_id,employee_code,preset_code,capabilities,record_scope,effective_from,updated_at')
    .eq('is_active', true)
    .lte('effective_from', today)
    .or('effective_to.is.null,effective_to.gte.' + today)
    .or(filters.join(','))
    .order('effective_from', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(20);
  if (error) throw error;

  const capabilityName = action === 'record' ? 'record_violation' : 'view_violations';
  const grant = (rows || []).find(row => row.capabilities && row.capabilities[capabilityName] === true) || null;
  if (!grant) {
    return {
      allowed: false,
      source: 'checklist_permission_grants',
      canRecord: false,
      canView: false,
      canEditTest: false,
      canCancel: false,
      scopeType: 'none',
      scopeValues: [],
      actorId: currentActor.id,
      actorEmployeeCode: currentActor.employeeCode
    };
  }

  const recordScope = grant.record_scope && grant.record_scope.type
    ? grant.record_scope
    : { type: 'none', values: [] };
  return {
    allowed: true,
    source: 'checklist_permission_grants',
    canRecord: grant.capabilities && grant.capabilities.record_violation === true,
    canView: grant.capabilities && grant.capabilities.view_violations === true,
    canEditTest: false,
    canCancel: false,
    scopeType: t(recordScope.type) || 'none',
    scopeValues: Array.isArray(recordScope.values) ? recordScope.values : [],
    actorId: currentActor.id,
    actorEmployeeCode: currentActor.employeeCode
  };
}

async function permissionAssignmentRows(permission) {
  if (!supabase || permission.scopeType === 'all') return [];
  const { data, error } = await supabase
    .from(ASSIGNMENT_TABLE)
    .select('employee_code,employee_name,department,branch,manager_id,manager_code,employee_status')
    .neq('employee_status', 'Đã nghỉ việc')
    .limit(2000);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function assignmentMatchesPermission(permission, row) {
  if (permission.scopeType === 'all') return true;
  const values = (permission.scopeValues || []).map(value => normalizeText(value));
  const employeeCode = t(row.employee_code).toUpperCase();
  const department = normalizeText(row.department);
  const branch = normalizeText(row.branch);
  const managerId = normalizeText(row.manager_id);
  const managerCode = t(row.manager_code).toUpperCase();
  if (permission.scopeType === 'employee') {
    return values.includes(normalizeText(employeeCode));
  }
  if (permission.scopeType === 'direct_reports') {
    const actorId = normalizeText(permission.actorId);
    const actorCode = t(permission.actorEmployeeCode).toUpperCase();
    return Boolean((actorId && managerId === actorId) || (actorCode && managerCode === actorCode));
  }
  if (permission.scopeType === 'branch') return values.includes(branch);
  if (permission.scopeType === 'department') return values.includes(department);
  if (permission.scopeType === 'department_branch') {
    const departmentValues = values.filter(value => value.includes('ban hang') || value.includes('phong') || value.includes('bo phan'));
    const branchValues = values.filter(value => !departmentValues.includes(value));
    const departmentOk = departmentValues.length ? departmentValues.includes(department) : department === normalizeText('Bán hàng');
    const branchOk = branchValues.length ? branchValues.includes(branch) : false;
    return departmentOk && branchOk;
  }
  return false;
}

async function permissionEmployees(permission) {
  if (permission.scopeType === 'all') {
    const { data, error } = await supabase
      .from(ASSIGNMENT_TABLE)
      .select('employee_code,employee_name,department,branch,manager_id,manager_code,employee_status')
      .neq('employee_status', 'Đã nghỉ việc')
      .order('employee_name', { ascending: true })
      .limit(2000);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }
  const rows = await permissionAssignmentRows(permission);
  return rows.filter(row => assignmentMatchesPermission(permission, row));
}

async function requireViolationPermission(session, action, rows = []) {
  const permission = await resolveViolationPermission(session, action);
  const allowed = action === 'record'
    ? permission.canRecord
    : action === 'view'
      ? permission.canView
      : action === 'edit_test'
        ? permission.canEditTest
        : action === 'cancel'
          ? permission.canCancel
          : false;

  if (!allowed) {
    fail('Tài khoản chưa được cấp quyền phù hợp cho thao tác này.', 403, 'CHECKLIST_VIOLATION_PERMISSION_DENIED');
  }
  if (permission.source !== 'admin' && permission.scopeType === 'none') {
    fail('Quyền Ghi nhận lỗi chưa có phạm vi áp dụng.', 403, 'CHECKLIST_VIOLATION_SCOPE_REQUIRED');
  }
  if (rows.length && permission.scopeType !== 'all') {
    const allowedEmployees = await permissionEmployees(permission);
    const allowedCodes = new Set(allowedEmployees.map(row => t(row.employee_code).toUpperCase()).filter(Boolean));
    for (const row of rows) {
      if (!allowedCodes.has(t(row.employee_code).toUpperCase())) {
        fail('Nhân sự nằm ngoài phạm vi được cấp quyền.', 403, 'CHECKLIST_VIOLATION_OUT_OF_SCOPE', {
          employeeCode: row.employee_code
        });
      }
    }
  }
  return permission;
}

function assignmentSnapshot(source) {
  if (!source || typeof source !== 'object') return null;
  return {
    employee_key: t(source.employee_key),
    employee_id: t(source.employee_id),
    employee_code: t(source.employee_code).toUpperCase(),
    employee_name: t(source.employee_name),
    department: t(source.department),
    title: t(source.title),
    branch: t(source.branch),
    manager_id: t(source.manager_id),
    manager_code: t(source.manager_code).toUpperCase(),
    manager_name: t(source.manager_name),
    employee_status: t(source.employee_status),
    template_id: t(source.template_id).toLowerCase(),
    template_version: t(source.template_version),
    effective_date: t(source.effective_date),
    _changed_at: t(source.changed_at || source.updated_at || source.created_at)
  };
}

function parsedPreviousData(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function assignmentCandidateKey(row) {
  return [
    row.employee_key,
    row.employee_id,
    row.employee_code,
    row.template_id,
    row.template_version,
    row.effective_date
  ].join('|');
}

async function readIdentityRows(table, employeeCode, employeeId, isHistory) {
  async function run(field, value) {
    if (!value) return [];
    let query = supabase.from(table).select('*').eq(field, value);
    query = isHistory
      ? query.order('changed_at', { ascending: false }).limit(100)
      : query.order('updated_at', { ascending: false }).limit(5);
    const { data, error } = await query;
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  const byCode = await run('employee_code', employeeCode);
  if (byCode.length || !employeeId) return byCode;
  return run('employee_id', employeeId);
}

async function resolveAssignmentAt(employeeCode, employeeId, occurredDate) {
  const normalizedCode = t(employeeCode).toUpperCase();
  const normalizedId = t(employeeId);
  if (!normalizedCode && !normalizedId) {
    fail('Thiếu định danh nhân sự.', 400, 'CHECKLIST_EMPLOYEE_REQUIRED');
  }

  const [currentRows, historyRows] = await Promise.all([
    readIdentityRows(ASSIGNMENT_TABLE, normalizedCode, normalizedId, false),
    readIdentityRows(ASSIGNMENT_HISTORY_TABLE, normalizedCode, normalizedId, true)
  ]);

  const candidates = [];
  currentRows.forEach(row => candidates.push(assignmentSnapshot(row)));
  historyRows.forEach(row => {
    candidates.push(assignmentSnapshot(row));
    candidates.push(assignmentSnapshot(parsedPreviousData(row.previous_data)));
  });

  const seen = new Set();
  const effective = candidates
    .filter(Boolean)
    .filter(row => {
      const key = assignmentCandidateKey(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return Boolean(
        row.template_id &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.effective_date) &&
        row.effective_date <= occurredDate
      );
    })
    .sort((left, right) => {
      const byDate = right.effective_date.localeCompare(left.effective_date);
      if (byDate) return byDate;
      return right._changed_at.localeCompare(left._changed_at);
    });

  const assignment = effective[0];
  if (!assignment) {
    fail(
      'Không tìm thấy phân công Checklist có hiệu lực tại ngày xảy ra.',
      409,
      'CHECKLIST_ASSIGNMENT_NOT_EFFECTIVE',
      { employeeCode: normalizedCode, occurredDate }
    );
  }

  return assignment;
}

function criterionItemValue(item, arrayIndex, names) {
  if (Array.isArray(item)) return item[arrayIndex];
  if (!item || typeof item !== 'object') return undefined;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(item, name)) return item[name];
  }
  return undefined;
}

function criterionIsInactive(item) {
  if (!item || Array.isArray(item) || typeof item !== 'object') return false;
  const status = normalizeText(item.status || item.state || item.active_status);
  return status === 'inactive' ||
    status === 'disabled' ||
    status.includes('ngưng') ||
    item.active === false ||
    item.is_active === false;
}

function findCriterionInDefinition(definition, criterionCode) {
  const wanted = t(criterionCode).toUpperCase();
  const groups = definition && Array.isArray(definition.groups)
    ? definition.groups
    : [];

  for (const group of groups) {
    for (const child of Array.isArray(group && group.children) ? group.children : []) {
      for (const item of Array.isArray(child && child.items) ? child.items : []) {
        const code = t(
          criterionItemValue(item, 0, ['code', 'criterionCode', 'criterion_code', 'id'])
        ).toUpperCase();
        if (!code || code !== wanted) continue;
        if (criterionIsInactive(item)) {
          fail(
            'Tiêu chí đã ngưng áp dụng trong phiên bản mẫu tại ngày xảy ra.',
            409,
            'CHECKLIST_CRITERION_INACTIVE',
            { criterionCode: wanted }
          );
        }

        const name = t(
          criterionItemValue(item, 1, ['content', 'name', 'text', 'criterionName', 'criterion_name'])
        );
        const factor = positiveNum(
          criterionItemValue(item, 2, ['factor', 'weight', 'coefficient']),
          1
        );
        const explicitPoints = criterionItemValue(
          item,
          3,
          ['points', 'deductionPoints', 'deduction_points', 'penalty', 'penaltyPoints']
        );
        const parsedPoints = Number(explicitPoints);
        const points = Number.isFinite(parsedPoints) && parsedPoints >= 0
          ? parsedPoints
          : factor;

        return {
          id: t(criterionItemValue(item, 0, ['id'])) || code,
          code,
          name,
          group: t(child && child.name || group && group.name) || 'Tiêu chuẩn công việc',
          factor,
          points
        };
      }
    }
  }
  return null;
}

async function resolveTemplateVersionAt(templateId, occurredDate) {
  const normalizedTemplateId = t(templateId).toLowerCase();
  if (!normalizedTemplateId) {
    fail('Nhân sự chưa được gán mẫu Checklist.', 409, 'CHECKLIST_TEMPLATE_REQUIRED');
  }

  const [templateResult, versionResult] = await Promise.all([
    supabase
      .from(TEMPLATE_TABLE)
      .select('template_key,name,status,template_type,has_checklist')
      .eq('template_key', normalizedTemplateId)
      .maybeSingle(),
    supabase
      .from(TEMPLATE_VERSION_TABLE)
      .select('template_key,version_no,effective_date,definition,created_at')
      .eq('template_key', normalizedTemplateId)
      .lte('effective_date', occurredDate)
      .order('effective_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
  ]);

  if (templateResult.error) throw templateResult.error;
  if (versionResult.error) throw versionResult.error;

  const template = templateResult.data;
  const version = (versionResult.data || [])[0];
  if (!template) {
    fail(
      'Mẫu Checklist trong phân công không còn tồn tại.',
      409,
      'CHECKLIST_TEMPLATE_NOT_FOUND',
      { templateId: normalizedTemplateId }
    );
  }
  if (template.has_checklist === false) {
    fail(
      'Mẫu được phân công không có tiêu chí Checklist để ghi nhận lỗi.',
      409,
      'CHECKLIST_TEMPLATE_HAS_NO_CRITERIA',
      { templateId: normalizedTemplateId }
    );
  }
  if (!version) {
    fail(
      'Không tìm thấy phiên bản mẫu có hiệu lực tại ngày xảy ra.',
      409,
      'CHECKLIST_TEMPLATE_VERSION_NOT_EFFECTIVE',
      { templateId: normalizedTemplateId, occurredDate }
    );
  }

  return { template, version };
}

function isLateCriterion(criterion) {
  return t(criterion && criterion.code).toUpperCase().includes('DITRE') ||
    normalizeText(criterion && criterion.name).includes('đi trễ');
}

function lateMinutesFromRow(row) {
  const direct = Number(row && (row.lateMinutes ?? row.minutes));
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
  const match = t(row && row.note).match(/(?:^|\|)\s*(\d+)\s*phút(?:\s*\||$)/i);
  return match ? Number(match[1]) : 0;
}

function latePoints(minutes, levels) {
  const value = Math.max(1, Math.round(Number(minutes) || 0));
  const rules = normalizeLateLevels(levels, false);
  const matched = rules.find(rule => value >= rule.minMinutes && (rule.maxMinutes == null || value <= rule.maxMinutes));
  return matched ? matched.points : rules[rules.length - 1].points;
}

function lateAppliedPoints(row, standardPoints) {
  const raw = row && (
    row.appliedPoints ??
    row.applied_points ??
    row.points
  );
  if (raw == null || t(raw) === '') return standardPoints;

  const applied = Number(raw);
  if (!Number.isFinite(applied) || applied < 0 || applied > 100) {
    fail(
      'Điểm áp dụng đi trễ phải là số từ 0 đến 100.',
      400,
      'CHECKLIST_LATE_APPLIED_POINTS_INVALID'
    );
  }
  return Math.round(applied * 100) / 100;
}

function lateAdjustmentReasonFromRow(row) {
  const direct = t(
    row && (
      row.adjustReason ||
      row.adjust_reason ||
      row.adjustmentReason ||
      row.adjustment_reason ||
      row.lateAdjustmentReason ||
      row.late_adjustment_reason
    )
  );
  if (direct) return direct;

  const match = t(row && row.note).match(/(?:^|\|)\s*(?:Điều chỉnh|Lý do khác điểm chuẩn)\s*:\s*([^|]+)/i);
  return match ? t(match[1]) : '';
}

function canonicalResolver() {
  const assignmentCache = new Map();
  const templateCache = new Map();
  const latePolicyCache = new Map();

  return {
    assignment(employeeCode, employeeId, occurredDate) {
      const key = [t(employeeCode).toUpperCase(), t(employeeId), occurredDate].join('|');
      if (!assignmentCache.has(key)) {
        assignmentCache.set(
          key,
          resolveAssignmentAt(employeeCode, employeeId, occurredDate)
        );
      }
      return assignmentCache.get(key);
    },
    template(templateId, occurredDate) {
      const key = [t(templateId).toLowerCase(), occurredDate].join('|');
      if (!templateCache.has(key)) {
        templateCache.set(key, resolveTemplateVersionAt(templateId, occurredDate));
      }
      return templateCache.get(key);
    },
    latePolicy(occurredDate) {
      const key = date(occurredDate).slice(0, 7);
      if (!latePolicyCache.has(key)) {
        latePolicyCache.set(key, resolveLatePointsPolicyAt(occurredDate));
      }
      return latePolicyCache.get(key);
    }
  };
}

async function normalizeCanonical(row, session, mode, index, resolver, options = {}) {
  const occurredDate = date(row.occurredDate || row.occurred_date);
  const submittedEmployeeCode = t(row.employeeCode || row.employee_code).toUpperCase();
  const submittedEmployeeId = t(row.employeeId || row.employee_id);
  const criterionCode = t(row.criterionCode || row.criterion_code).toUpperCase();
  const note = t(row.note);

  if (!submittedEmployeeCode && !submittedEmployeeId) {
    fail('Thiếu định danh hoặc mã nhân sự.', 400, 'CHECKLIST_EMPLOYEE_REQUIRED');
  }
  if (!criterionCode || !note) {
    fail('Thiếu tiêu chí hoặc mô tả lỗi.', 400, 'CHECKLIST_VIOLATION_REQUIRED');
  }
  if (note.length < 3) {
    fail('Nhận xét phải mô tả rõ sự việc.', 400, 'CHECKLIST_NOTE_TOO_SHORT');
  }

  const assignment = await resolver.assignment(
    submittedEmployeeCode,
    submittedEmployeeId,
    occurredDate
  );
  const employeeCode = t(assignment.employee_code || submittedEmployeeCode).toUpperCase();
  const employeeId = t(assignment.employee_id || submittedEmployeeId);
  if (
    submittedEmployeeCode &&
    employeeCode &&
    submittedEmployeeCode !== employeeCode
  ) {
    fail(
      'Mã nhân sự gửi lên không khớp hồ sơ phân công.',
      409,
      'CHECKLIST_EMPLOYEE_IDENTITY_MISMATCH',
      { submittedEmployeeCode, assignedEmployeeCode: employeeCode }
    );
  }
  if (
    submittedEmployeeId &&
    employeeId &&
    submittedEmployeeId !== employeeId
  ) {
    fail(
      'Định danh nhân sự gửi lên không khớp hồ sơ phân công.',
      409,
      'CHECKLIST_EMPLOYEE_IDENTITY_MISMATCH',
      { submittedEmployeeId, assignedEmployeeId: employeeId }
    );
  }
  const isTest = mode !== 'production';

  if (isTest && employeeCode !== 'PHF012') {
    fail(
      'Hệ thống đang ở chế độ kiểm thử: chỉ cho phép dữ liệu của PHF012.',
      403,
      'CHECKLIST_TEST_SCOPE_ONLY'
    );
  }

  if (!options.skipClientConsistency) {
    const submittedTemplateId = t(row.templateId || row.template_id).toLowerCase();
    if (submittedTemplateId && submittedTemplateId !== assignment.template_id) {
      fail(
        'Mẫu Checklist gửi lên không khớp phân công có hiệu lực của nhân sự.',
        409,
        'CHECKLIST_TEMPLATE_MISMATCH',
        {
          submittedTemplateId,
          assignedTemplateId: assignment.template_id,
          occurredDate
        }
      );
    }
  }

  const resolved = await resolver.template(assignment.template_id, occurredDate);
  const template = resolved.template;
  const version = resolved.version;

  if (!options.skipClientConsistency) {
    const submittedVersion = t(row.templateVersion || row.template_version);
    if (submittedVersion && submittedVersion !== t(version.version_no)) {
      fail(
        'Phiên bản mẫu gửi lên không đúng phiên bản có hiệu lực tại ngày xảy ra.',
        409,
        'CHECKLIST_TEMPLATE_VERSION_MISMATCH',
        {
          submittedVersion,
          effectiveVersion: version.version_no,
          occurredDate
        }
      );
    }
  }

  const criterion = findCriterionInDefinition(version.definition, criterionCode);
  if (!criterion) {
    fail(
      'Tiêu chí không thuộc phiên bản mẫu đang có hiệu lực của nhân sự.',
      409,
      'CHECKLIST_CRITERION_NOT_IN_EFFECTIVE_TEMPLATE',
      {
        employeeCode,
        templateId: assignment.template_id,
        templateVersion: version.version_no,
        criterionCode,
        occurredDate
      }
    );
  }

  const currentActor = actor(session);
  let points = criterion.points;
  let lateStandardPoints = null;
  let lateAdjustmentReason = '';
  let lateAdjustedBy = '';
  let lateAdjustedByName = '';
  let lateAdjustedAt = null;

  if (isLateCriterion(criterion)) {
    requireAdmin(
      session,
      'Chỉ Admin được ghi nhận Đi trễ.'
    );
    const minutes = lateMinutesFromRow(row);
    if (!minutes) {
      fail(
        'Thiếu số phút đi trễ để xác định điểm chuẩn.',
        400,
        'CHECKLIST_LATE_MINUTES_REQUIRED'
      );
    }

    const latePolicy = await resolver.latePolicy(occurredDate);
    lateStandardPoints = latePoints(minutes, latePolicy.levels);
    points = lateAppliedPoints(row, lateStandardPoints);
    const adjusted = Math.abs(points - lateStandardPoints) > 0.000001;

    if (adjusted) {
      requireAdmin(
        session,
        'Chỉ Admin được áp dụng điểm đi trễ khác điểm chuẩn.'
      );
      lateAdjustmentReason = lateAdjustmentReasonFromRow(row);
      if (lateAdjustmentReason.length < 5) {
        fail(
          'Điểm áp dụng khác điểm chuẩn; lý do cần ít nhất 5 ký tự.',
          400,
          'CHECKLIST_LATE_ADJUSTMENT_REASON_REQUIRED',
          { standardPoints: lateStandardPoints, appliedPoints: points }
        );
      }
      lateAdjustedBy = currentActor.id;
      lateAdjustedByName = currentActor.name;
      lateAdjustedAt = new Date().toISOString();
    }
  }

  const batch = isTest ? t(row.testBatchId || row.test_batch_id) : '';
  const requestId = t(row.requestId || row.request_id) ||
    (batch ? batch + '-' + String(index + 1) : '');

  const payload = {
    employee_id: employeeId,
    employee_code: employeeCode,
    employee_name: t(assignment.employee_name || row.employeeName || row.employee_name),
    template_id: t(template.template_key || assignment.template_id).toLowerCase(),
    template_version: t(version.version_no),
    template_name: t(template.name),
    criterion_id: t(criterion.id) || criterion.code,
    criterion_code: criterion.code,
    criterion_name: criterion.name,
    criterion_group: criterion.group,
    factor: criterion.factor,
    points,
    late_standard_points: lateStandardPoints,
    late_adjustment_reason: lateAdjustmentReason,
    late_adjusted_by: lateAdjustedBy,
    late_adjusted_by_name: lateAdjustedByName,
    late_adjusted_at: lateAdjustedAt,
    occurred_date: occurredDate,
    occurred_time: time(row.occurredTime || row.occurred_time),
    location: t(row.location) || t(assignment.branch),
    note,
    evidence_required: row.evidenceRequired === true || row.evidence_required === true,
    /* PHF Checklist Evidence 1.41.0: has_evidence không còn nhận cờ boolean từ
       client - luôn false lúc insert, chỉ được RPC phf_attach_checklist_evidence
       (lib/checklist-evidence.js) đặt true sau khi xác nhận có row minh chứng
       thật gắn với đúng bản ghi này. */
    has_evidence: false,
    record_status: t(row.status || row.record_status) === 'draft' ? 'draft' : 'official',
    is_test: isTest,
    test_batch_id: batch,
    request_id: requestId || null,
    created_by: currentActor.id,
    created_by_name: currentActor.name,
    _scope_branch: t(assignment.branch)
  };
  payload.duplicate_fingerprint = duplicateFingerprint(payload);
  return payload;
}

function persistenceRow(row) {
  const clean = { ...row };
  delete clean._scope_branch;
  return clean;
}

async function saveChecklistViolations(session, rows) {
  if (!supabase) fail('Supabase chưa được cấu hình.', 503, 'SUPABASE_NOT_CONFIGURED');
  const input = Array.isArray(rows) ? rows : [];
  if (!input.length) {
    fail('Không có lỗi nào để ghi nhận.', 400, 'CHECKLIST_VIOLATIONS_EMPTY');
  }
  if (input.length > 50) {
    fail('Mỗi lần chỉ được ghi tối đa 50 lỗi.', 400, 'CHECKLIST_VIOLATIONS_LIMIT');
  }

  const modeInfo = await getChecklistViolationMode();
  const resolver = canonicalResolver();
  const payload = await Promise.all(
    input.map((row, index) =>
      normalizeCanonical(row, session, modeInfo.mode, index, resolver)
    )
  );

  await requireViolationPermission(session, 'record', payload);

  if (modeInfo.mode === 'test') {
    const batch = payload[0]?.test_batch_id || '';
    if (!batch || payload.some(row => row.test_batch_id !== batch)) {
      fail('Mã đợt test không hợp lệ.', 400, 'CHECKLIST_TEST_BATCH_INVALID');
    }
  }

  const fingerprintIndexes = new Map();
  payload.forEach((row, index) => {
    const fingerprint = row.duplicate_fingerprint;
    if (!fingerprint) return;
    const indexes = fingerprintIndexes.get(fingerprint) || [];
    indexes.push(index);
    fingerprintIndexes.set(fingerprint, indexes);
  });
  const internalDuplicateGroups = [...fingerprintIndexes.entries()]
    .filter(([, indexes]) => indexes.length > 1)
    .map(([fingerprint, indexes]) => ({
      fingerprint,
      rows: indexes.map(index => ({
        index,
        requestId: payload[index]?.request_id || '',
        employeeCode: payload[index]?.employee_code || '',
        criterionCode: payload[index]?.criterion_code || '',
        occurredDate: payload[index]?.occurred_date || '',
        occurredTime: payload[index]?.occurred_time || ''
      }))
    }));
  if (internalDuplicateGroups.length) {
    fail(
      'Danh sách có sự việc trùng nhau trong cùng lần ghi nhận. Vui lòng kiểm tra lại các dòng được đánh dấu.',
      409,
      'CHECKLIST_BATCH_DUPLICATE_BLOCKED',
      { duplicateGroups: internalDuplicateGroups }
    );
  }

  const fingerprints = [...fingerprintIndexes.keys()];
  let duplicates = [];
  if (fingerprints.length) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('id,employee_code,criterion_code,occurred_date,occurred_time,location,note,duplicate_fingerprint,record_status')
      .in('duplicate_fingerprint', fingerprints)
      .neq('record_status', 'cancelled');
    if (error) throw error;
    duplicates = data || [];
  }

  const duplicateSet = new Set(duplicates.map(row => row.duplicate_fingerprint));
  const clean = payload
    .filter(row => !duplicateSet.has(row.duplicate_fingerprint))
    .map(persistenceRow);

  if (!clean.length && duplicates.length) {
    fail(
      'Bản ghi này đã tồn tại trong Nhật ký lỗi. Hệ thống đã chặn lưu trùng.',
      409,
      'CHECKLIST_DUPLICATE_BLOCKED',
      { duplicates }
    );
  }

  let saved = [];
  if (clean.length) {
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(clean, { onConflict: 'request_id', ignoreDuplicates: true })
      .select('id,request_id,duplicate_fingerprint');
    if (error) {
      if (error.code === '23505') {
        fail(
          'Phát hiện bản ghi trùng đã tồn tại. Vui lòng mở Nhật ký lỗi để kiểm tra.',
          409,
          'CHECKLIST_DUPLICATE_BLOCKED'
        );
      }
      throw error;
    }
    saved = data || [];
    const cleanRequestIds = [...new Set(clean.map(row => row.request_id).filter(Boolean))];
    if (cleanRequestIds.length) {
      const persistedRead = await supabase
        .from(TABLE)
        .select('id,request_id,duplicate_fingerprint')
        .in('request_id', cleanRequestIds);
      if (persistedRead.error) throw persistedRead.error;
      saved = persistedRead.data || [];
      const persistedIds = new Set(saved.map(row => row.request_id).filter(Boolean));
      const missingRequestIds = cleanRequestIds.filter(requestId => !persistedIds.has(requestId));
      if (missingRequestIds.length) {
        fail(
          'Máy chủ chưa xác nhận đủ dữ liệu vừa ghi. Không hoàn tất batch để tránh mất dữ liệu.',
          500,
          'CHECKLIST_BATCH_READBACK_INCOMPLETE',
          { missingRequestIds }
        );
      }
    }
  }

  const canonicalByRequestId = new Map(payload.map((row, index) => [row.request_id, { row, index }]));
  const savedRows = saved.map(row => {
    const canonical = canonicalByRequestId.get(row.request_id) || {};
    const source = canonical.row || {};
    return {
      id: row.id,
      index: Number.isInteger(canonical.index) ? canonical.index : null,
      requestId: row.request_id || '',
      duplicateFingerprint: row.duplicate_fingerprint || '',
      employeeCode: source.employee_code || '',
      criterionCode: source.criterion_code || '',
      occurredDate: source.occurred_date || '',
      occurredTime: source.occurred_time || ''
    };
  });
  const duplicateRows = duplicates.map(row => ({
    id: row.id,
    index: (fingerprintIndexes.get(row.duplicate_fingerprint) || [null])[0],
    requestId: '',
    duplicateFingerprint: row.duplicate_fingerprint || '',
    employeeCode: row.employee_code,
    criterionCode: row.criterion_code,
    occurredDate: row.occurred_date,
    occurredTime: row.occurred_time
  }));

  return {
    saved: savedRows.length,
    savedRows,
    mode: modeInfo.mode,
    isTest: modeInfo.mode !== 'production',
    testBatchId: payload[0]?.test_batch_id || '',
    duplicateSkipped: duplicateRows.length,
    duplicateRows,
    canonicalSource: 'assignment_template_version',
    duplicates: duplicateRows
  };
}

async function listChecklistViolations(session, input = {}) {
  if (!supabase) fail('Supabase chưa được cấu hình.', 503, 'SUPABASE_NOT_CONFIGURED');
  const permission = await requireViolationPermission(session, 'view');
  const employees = await permissionEmployees(permission);
  const allowedCodes = [...new Set(employees.map(row => t(row.employee_code).toUpperCase()).filter(Boolean))];
  const pageSize = Math.min(100, Math.max(10, Math.floor(num(input.pageSize, 30))));
  const page = Math.max(1, Math.floor(num(input.page, 1)));
  const requestIds = Array.isArray(input.requestIds)
    ? [...new Set(input.requestIds.map(value => t(value)).filter(Boolean))].slice(0, 100)
    : [];

  if (permission.scopeType !== 'all' && !allowedCodes.length) {
    return {
      records: [],
      total: 0,
      page,
      pageSize,
      employees: [],
      permission: {
        scopeType: permission.scopeType,
        scopeValues: permission.scopeValues,
        canView: permission.canView,
        canRecord: permission.canRecord,
        canEditTest: permission.canEditTest,
        canCancel: permission.canCancel
      }
    };
  }

  let query = supabase
    .from(TABLE)
    .select('id,employee_id,employee_code,employee_name,template_id,template_version,template_name,criterion_id,criterion_code,criterion_name,criterion_group,factor,points,late_standard_points,late_adjustment_reason,late_adjusted_by,late_adjusted_by_name,late_adjusted_at,occurred_date,occurred_time,location,note,evidence_required,has_evidence,record_status,is_test,test_batch_id,request_id,duplicate_fingerprint,created_by,created_by_name,created_at,updated_by,updated_by_name,updated_at,cancelled_by,cancelled_by_name,cancelled_at,cancel_reason,change_count', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (permission.scopeType !== 'all') query = query.in('employee_code', allowedCodes);
  if (t(input.employeeCode)) query = query.eq('employee_code', t(input.employeeCode).toUpperCase());
  if (t(input.dateFrom)) query = query.gte('occurred_date', date(input.dateFrom));
  if (t(input.dateTo)) query = query.lte('occurred_date', date(input.dateTo));
  if (t(input.mode) === 'test') query = query.eq('is_test', true);
  if (t(input.mode) === 'production') query = query.eq('is_test', false);
  if (t(input.status) === 'active') query = query.neq('record_status', 'cancelled');
  if (t(input.status) === 'cancelled') query = query.eq('record_status', 'cancelled');
  if (requestIds.length) query = query.in('request_id', requestIds);

  const search = t(input.query).replace(/[,()%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (search) {
    const pattern = '%' + search + '%';
    query = query.or([
      'employee_name.ilike.' + pattern,
      'employee_code.ilike.' + pattern,
      'criterion_code.ilike.' + pattern,
      'criterion_name.ilike.' + pattern,
      'criterion_group.ilike.' + pattern,
      'template_name.ilike.' + pattern,
      'location.ilike.' + pattern,
      'note.ilike.' + pattern,
      'created_by_name.ilike.' + pattern
    ].join(','));
  }

  if (!requestIds.length) {
    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);
  } else {
    query = query.limit(100);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return {
    records: Array.isArray(data) ? data : [],
    total: Number(count || 0),
    page,
    pageSize,
    employees: employees.map(row => ({
      employeeCode: t(row.employee_code).toUpperCase(),
      employeeName: t(row.employee_name),
      department: t(row.department),
      branch: t(row.branch)
    })),
    permission: {
      scopeType: permission.scopeType,
      scopeValues: permission.scopeValues,
      canView: permission.canView,
      canRecord: permission.canRecord,
      canEditTest: permission.canEditTest,
      canCancel: permission.canCancel
    }
  };
}

async function listChecklistViolationHistory(session, input = {}) {
  if (!supabase) fail('Supabase chưa được cấu hình.', 503, 'SUPABASE_NOT_CONFIGURED');
  await requireViolationPermission(session, 'view');
  const id = t(input.id);
  if (!id) {
    fail('Thiếu mã bản ghi cần xem lịch sử.', 400, 'CHECKLIST_VIOLATION_ID_REQUIRED');
  }
  const record = await getRecord(id);
  await requireViolationPermission(session, 'view', [record]);
  const { data, error } = await supabase
    .from(HISTORY_TABLE)
    .select('id,record_id,action,before_data,after_data,reason,changed_by,changed_by_name,changed_at')
    .eq('record_id', id)
    .order('changed_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return { history: data || [] };
}

async function getRecord(id) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', t(id)).maybeSingle();
  if (error) throw error;
  if (!data) fail('Bản ghi không còn tồn tại.', 404, 'CHECKLIST_VIOLATION_NOT_FOUND');
  return data;
}

async function audit(session, record, action, beforeData, afterData, reason = '') {
  const currentActor = actor(session);
  const { error } = await supabase.from(HISTORY_TABLE).insert({
    record_id: record.id,
    employee_code: record.employee_code,
    action,
    before_data: beforeData || {},
    after_data: afterData || {},
    reason: t(reason),
    changed_by: currentActor.id,
    changed_by_name: currentActor.name
  });
  if (error) throw error;
}

async function updateChecklistViolation(session, input = {}) {
  if (!supabase) fail('Supabase chưa được cấu hình.', 503, 'SUPABASE_NOT_CONFIGURED');
  const record = await getRecord(input.id);
  await requireViolationPermission(session, 'edit_test', [record]);

  if (record.is_test !== true) {
    fail(
      'Dữ liệu chính thức không được sửa trực tiếp. Hãy dùng chức năng Hủy bản ghi.',
      409,
      'CHECKLIST_PRODUCTION_EDIT_BLOCKED'
    );
  }
  if (record.record_status === 'cancelled') {
    fail('Bản ghi đã hủy, không thể chỉnh sửa.', 409, 'CHECKLIST_RECORD_CANCELLED');
  }

  const note = t(input.note);
  if (note.length < 3) {
    fail('Nhận xét phải mô tả rõ sự việc.', 400, 'CHECKLIST_NOTE_TOO_SHORT');
  }

  const resolver = canonicalResolver();
  const canonical = await normalizeCanonical(
    {
      employeeId: record.employee_id,
      employeeCode: record.employee_code,
      criterionCode: record.criterion_code,
      occurredDate: input.occurredDate || record.occurred_date,
      occurredTime: input.occurredTime,
      location: input.location,
      note,
      evidenceRequired: record.evidence_required,
      hasEvidence: input.hasEvidence === true,
      status: record.record_status,
      testBatchId: record.test_batch_id,
      requestId: record.request_id,
      lateMinutes: input.lateMinutes || input.minutes,
      points: input.points ?? record.points,
      adjustReason:
        input.adjustReason ||
        input.adjust_reason ||
        record.late_adjustment_reason ||
        lateAdjustmentReasonFromRow(record)
    },
    session,
    'test',
    0,
    resolver,
    { skipClientConsistency: true }
  );

  await requireViolationPermission(session, 'edit_test', [canonical]);
  const currentActor = actor(session);
  const patch = {
    employee_id: canonical.employee_id,
    employee_code: canonical.employee_code,
    employee_name: canonical.employee_name,
    template_id: canonical.template_id,
    template_version: canonical.template_version,
    template_name: canonical.template_name,
    criterion_id: canonical.criterion_id,
    criterion_code: canonical.criterion_code,
    criterion_name: canonical.criterion_name,
    criterion_group: canonical.criterion_group,
    factor: canonical.factor,
    points: canonical.points,
    late_standard_points: canonical.late_standard_points,
    late_adjustment_reason: canonical.late_adjustment_reason,
    late_adjusted_by: canonical.late_adjusted_by,
    late_adjusted_by_name: canonical.late_adjusted_by_name,
    late_adjusted_at: canonical.late_adjusted_at,
    occurred_date: canonical.occurred_date,
    occurred_time: canonical.occurred_time,
    location: canonical.location,
    note: canonical.note,
    evidence_required: canonical.evidence_required,
    has_evidence: canonical.has_evidence,
    updated_by: currentActor.id,
    updated_by_name: currentActor.name,
    updated_at: new Date().toISOString(),
    change_count: num(record.change_count, 0) + 1
  };
  patch.duplicate_fingerprint = duplicateFingerprint({ ...record, ...patch });

  const rpc=await supabase.rpc('phf_mutate_checklist_violation',{
    p_record_id:record.id,p_action:'edit_test',p_after:patch,p_reason:t(input.reason)||'Chỉnh sửa dữ liệu TEST',p_actor_id:currentActor.id,p_actor_name:currentActor.name,p_expected_updated_at:record.updated_at
  });
  if(rpc.error){
    const message=String(rpc.error.message||'');
    if(/CHECKLIST_VIOLATION_STALE/i.test(message))fail('Bản ghi đã thay đổi ở tab hoặc máy khác. Vui lòng tải lại.',409,'CHECKLIST_VIOLATION_STALE');
    if(rpc.error.code==='23505'||/duplicate|uq_checklist_violation/i.test(message))fail('Nội dung sau chỉnh sửa trùng với một bản ghi đang hiệu lực.',409,'CHECKLIST_DUPLICATE_BLOCKED');
    if(/phf_mutate_checklist_violation/i.test(message))fail('Chưa chạy SQL ổn định Production cho Nhật ký lỗi.',503,'CHECKLIST_VIOLATION_STABILITY_SQL_MISSING');
    throw rpc.error;
  }
  const result=rpc.data||{};if(result.ok!==true)fail(t(result.message)||'Không thể cập nhật bản ghi.',409,t(result.code)||'CHECKLIST_VIOLATION_UPDATE_BLOCKED');
  return { record: result.record, canonicalSource: 'assignment_template_version' };
}

async function cancelChecklistViolation(session, input = {}) {
  if (!supabase) fail('Supabase chưa được cấu hình.', 503, 'SUPABASE_NOT_CONFIGURED');
  const record = await getRecord(input.id);
  await requireViolationPermission(session, 'cancel', [record]);
  const reason = t(input.reason);
  if (reason.length < 10) fail('Lý do hủy cần mô tả rõ tối thiểu 10 ký tự.',400,'CHECKLIST_CANCEL_REASON_REQUIRED');
  if (record.record_status === 'cancelled') fail('Bản ghi đã được hủy trước đó.',409,'CHECKLIST_ALREADY_CANCELLED');
  const currentActor=actor(session),rpc=await supabase.rpc('phf_mutate_checklist_violation',{p_record_id:record.id,p_action:'cancel',p_after:{},p_reason:reason,p_actor_id:currentActor.id,p_actor_name:currentActor.name,p_expected_updated_at:record.updated_at});
  if(rpc.error){
    const message=String(rpc.error.message||'');
    if(/CHECKLIST_PERIOD_FINALIZED/i.test(message))fail('Kỳ đánh giá của lỗi này đã thẩm định hoặc khóa. Hãy mở ngoại lệ trước khi hủy.',409,'CHECKLIST_PERIOD_FINALIZED');
    if(/CHECKLIST_VIOLATION_STALE/i.test(message))fail('Bản ghi đã thay đổi ở tab hoặc máy khác. Vui lòng tải lại.',409,'CHECKLIST_VIOLATION_STALE');
    if(/phf_mutate_checklist_violation/i.test(message))fail('Chưa chạy SQL ổn định Production cho Nhật ký lỗi.',503,'CHECKLIST_VIOLATION_STABILITY_SQL_MISSING');
    throw rpc.error;
  }
  const result=rpc.data||{};if(result.ok!==true)fail(t(result.message)||'Không thể hủy bản ghi.',409,t(result.code)||'CHECKLIST_VIOLATION_CANCEL_BLOCKED');
  return {record:result.record};
}

async function deleteChecklistTestViolation(session, input = {}) {
  if (!supabase) fail('Supabase chưa được cấu hình.', 503, 'SUPABASE_NOT_CONFIGURED');
  requireAdmin(session, 'Chỉ Admin được xóa dữ liệu thử nghiệm.');
  const record=await getRecord(input.id);if(record.is_test!==true)fail('Không thể xóa cứng dữ liệu chính thức.',409,'CHECKLIST_PRODUCTION_DELETE_BLOCKED');
  const currentActor=actor(session),rpc=await supabase.rpc('phf_mutate_checklist_violation',{p_record_id:record.id,p_action:'delete_test',p_after:{},p_reason:t(input.reason)||'Xóa bản ghi TEST',p_actor_id:currentActor.id,p_actor_name:currentActor.name,p_expected_updated_at:record.updated_at});
  if(rpc.error){const message=String(rpc.error.message||'');if(/CHECKLIST_VIOLATION_STALE/i.test(message))fail('Bản ghi đã thay đổi ở nơi khác. Vui lòng tải lại.',409,'CHECKLIST_VIOLATION_STALE');if(/phf_mutate_checklist_violation/i.test(message))fail('Chưa chạy SQL ổn định Production cho Nhật ký lỗi.',503,'CHECKLIST_VIOLATION_STABILITY_SQL_MISSING');throw rpc.error;}
  const result=rpc.data||{};return {deleted:Number(result.deleted||0)};
}

async function deleteChecklistTestViolations(session, input = {}) {
  if (!supabase) fail('Supabase chưa được cấu hình.', 503, 'SUPABASE_NOT_CONFIGURED');
  requireAdmin(session, 'Chỉ Admin được dọn dữ liệu thử nghiệm.');
  const currentActor=actor(session),rpc=await supabase.rpc('phf_delete_checklist_test_violations',{p_employee_code:t(input.employeeCode).toUpperCase(),p_test_batch_id:t(input.testBatchId),p_reason:t(input.reason)||'Dọn đợt TEST',p_actor_id:currentActor.id,p_actor_name:currentActor.name});
  if(rpc.error){const message=String(rpc.error.message||'');if(/phf_delete_checklist_test_violations/i.test(message))fail('Chưa chạy SQL ổn định Production cho dọn dữ liệu TEST.',503,'CHECKLIST_VIOLATION_STABILITY_SQL_MISSING');throw rpc.error;}
  const result=rpc.data||{};return {deleted:Number(result.deleted||0)};
}

module.exports = {
  getChecklistViolationMode,
  getChecklistLatePointsPolicy,
  saveChecklistLatePointsPolicy,
  getChecklistRepeatViolationPolicy,
  saveChecklistRepeatViolationPolicy,
  getChecklistRepeatViolationSuggestions,
  saveChecklistViolations,
  saveChecklistTestViolations: saveChecklistViolations,
  listChecklistViolations,
  listChecklistViolationHistory,
  updateChecklistViolation,
  cancelChecklistViolation,
  deleteChecklistTestViolation,
  deleteChecklistTestViolations,
  requireViolationPermission
};
