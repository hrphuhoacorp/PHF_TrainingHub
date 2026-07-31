'use strict';

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const loginAttempts = new Map();
const WINDOW_MS = Number(process.env.PHF_LOGIN_WINDOW_MS || 15 * 60 * 1000);
const MAX_ATTEMPTS = Number(process.env.PHF_LOGIN_MAX_ATTEMPTS || 5);
const BLOCK_MS = Number(process.env.PHF_LOGIN_BLOCK_MS || 15 * 60 * 1000);

function clientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown');
}
function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function attemptKey(req, email) { return `${clientIp(req)}|${normalizeEmail(email) || 'unknown'}`; }
function cleanup(now = Date.now()) {
  for (const [key, row] of loginAttempts.entries()) {
    if (now - Number(row.lastAt || 0) > Math.max(WINDOW_MS, BLOCK_MS) * 2) loginAttempts.delete(key);
  }
}
function assertLoginAllowed(req, email) {
  cleanup();
  const now = Date.now();
  const key = attemptKey(req, email);
  const row = loginAttempts.get(key);
  if (!row) return;
  if (row.blockedUntil && row.blockedUntil > now) {
    const error = new Error('Đăng nhập tạm thời bị giới hạn. Vui lòng thử lại sau.');
    error.statusCode = 429;
    error.code = 'LOGIN_RATE_LIMITED';
    error.retryAfterSeconds = Math.max(1, Math.ceil((row.blockedUntil - now) / 1000));
    throw error;
  }
  if (now - row.firstAt > WINDOW_MS) loginAttempts.delete(key);
}
function recordLoginFailure(req, email) {
  const now = Date.now();
  const key = attemptKey(req, email);
  const current = loginAttempts.get(key);
  const row = !current || now - current.firstAt > WINDOW_MS
    ? { count: 0, firstAt: now, lastAt: now, blockedUntil: 0 }
    : current;
  row.count += 1;
  row.lastAt = now;
  if (row.count >= MAX_ATTEMPTS) row.blockedUntil = now + BLOCK_MS;
  loginAttempts.set(key, row);
  return row;
}
function clearLoginFailures(req, email) { loginAttempts.delete(attemptKey(req, email)); }

async function withTimeout(promise, ms, code) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('Supabase phản hồi quá lâu.');
          error.code = code || 'SUPABASE_TIMEOUT';
          reject(error);
        }, ms);
      })
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

async function checkSupabaseHealth(options = {}) {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const secret = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  const sessionSecret = String(process.env.PHF_SESSION_SECRET || '').trim();
  const privateSecretPath = path.join(__dirname, '..', 'private', 'session-secret.txt');
  const hasSessionSecret = Boolean(sessionSecret || fs.existsSync(privateSecretPath));
  if (!url || !secret || !hasSessionSecret) {
    return { ok: false, code: 'ENV_NOT_CONFIGURED', storage: 'not-configured', accounts: 'not-configured' };
  }
  const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const [accountsResult,checklistResult] = await withTimeout(
      Promise.all([
        supabase.from('user_accounts').select('id', { count: 'exact', head: true }),
        supabase.rpc('phf_checklist_production_health')
      ]),
      Number(options.timeoutMs || 4000),
      'SUPABASE_HEALTH_TIMEOUT'
    );
    if (accountsResult.error) throw accountsResult.error;
    if (checklistResult.error) {
      return {ok:false,code:'CHECKLIST_HEALTH_RPC_MISSING',storage:'supabase',accounts:'ready',accountCount:Number(accountsResult.count||0),checklist:'not-ready'};
    }
    const checklist=checklistResult.data||{};
    if(checklist.ok!==true)return {ok:false,code:'CHECKLIST_PRODUCTION_NOT_READY',storage:'supabase',accounts:'ready',accountCount:Number(accountsResult.count||0),checklist:'not-ready',missing:Array.isArray(checklist.missing)?checklist.missing:[]};
    return { ok: true, storage: 'supabase', accounts: 'ready', accountCount: Number(accountsResult.count || 0), checklist:'ready' };
  } catch (error) {
    return { ok: false, code: error.code || 'SUPABASE_UNAVAILABLE', storage: 'unavailable', accounts: 'unavailable' };
  }
}

module.exports = {
  assertLoginAllowed,
  recordLoginFailure,
  clearLoginFailures,
  checkSupabaseHealth,
  clientIp
};
