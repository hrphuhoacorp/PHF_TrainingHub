'use strict';
const { send } = require('./_lib/api-response');
const { checkSupabaseHealth } = require('./_lib/production-hardening');
const build = require('../build-info.json');

// PUBLIC endpoint — keep the payload MINIMAL. No internal release notes, no
// account counts, no environment metadata. Callers (load-balancer probe,
// smoke test) only need { ok } + a coarse readiness picture. The Admin-only
// "Tình trạng hệ thống" screen is where the fuller (still bounded) view lives.
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return send(res, 405, { ok: false, error: 'Phương thức không được hỗ trợ.', code: 'METHOD_NOT_ALLOWED' });
  }
  const health = await checkSupabaseHealth({ timeoutMs: 4000 });
  return send(res, health.ok ? 200 : 503, {
    ok: health.ok,
    service: 'PHF Training Hub',
    version: build && build.version ? String(build.version) : null,
    builtAt: build && build.builtAt ? String(build.builtAt) : null,
    storage: health.storage || null,
    checklist: health.checklist || null,
    code: health.ok ? undefined : (health.code || 'UNAVAILABLE'),
    time: new Date().toISOString(),
  });
};
