'use strict';

/* PHF KNL — Batch "Thư viện Bộ KNL đầy đủ", 1.50.9.
   Seeds every non-EXCLUDED manifest candidate whose framework code does
   not already exist in public.knl_frameworks. This includes the 21
   candidates previously marked NEEDS_REVIEW and skipped by lib/knl-
   assignments.js#seedKnlSourceManifest (which still gates on READY only —
   left untouched, legacy path). candidateStatus is no longer a library-
   inclusion gate; it stays in the manifest JSON as backend/audit metadata
   only (per PHF decision — "Bộ KNL đầy đủ" batch).

   Uses ONLY the existing, already-Production, admin-gated granular CRUD
   functions in lib/knl-frameworks.js (createKnlFramework/saveKnlGroup/
   saveKnlItem/saveKnlLevelContent) — the exact same write path the manual
   Draft-editing UI already uses. NO new RPC, NO migration: every framework
   is created with status='draft' (Chưa áp dụng) by createKnlFramework's
   existing default, exactly matching the target business status. */

/* PHF ENV HARD GATE (Phase 2C — PHF_HR_ENVIRONMENT_SCRIPT_FORENSIC_PHASE2B_
 * 2026-08-26.md, nhóm NEEDS GUARD): script này trước đây KHÔNG có bất kỳ
 * flag/dry-run nào — run() gọi vô điều kiện, an toàn duy nhất là idempotency
 * theo framework code (chống trùng lặp, KHÔNG chống chạy nhầm môi trường).
 * Giờ:
 *   1) assertDeclaredTargetOrFailClosed('MAIN', ...) — verify hostname thật
 *      (không dựa tên file/comment) TRƯỚC bất kỳ require nào chạm DB, fail-
 *      closed nếu SUPABASE_URL không đúng MAIN.
 *   2) DRY-RUN THẬT theo mặc định — chỉ ghi khi có --apply.
 *
 * Chạy (xem trước, không ghi gì): node scripts/phf-knl-library-seed-needs-review-1.50.9.js
 * Chạy (ghi thật vào MAIN):        node scripts/phf-knl-library-seed-needs-review-1.50.9.js --apply
 */
require('dotenv').config();
const { assertDeclaredTargetOrFailClosed } = require('../api/_lib/env-identity-guard');

assertDeclaredTargetOrFailClosed('MAIN', '(scripts/phf-knl-library-seed-needs-review-1.50.9.js)');

const manifest = require('../assets/data/knl-source-manifest-2026-08-09.json');
const { listKnlFrameworks, createKnlFramework, getKnlFrameworkVersion, saveKnlGroup, saveKnlItem, saveKnlLevelContent } = require('../api/_lib/knl-frameworks');

const SESSION = { role: 'admin', account: { id: 'system-knl-library-seed-1.50.9', name: 'PHF KNL — nạp đầy đủ thư viện Bộ KNL' } };
const APPLY = process.argv.includes('--apply');

async function seedCandidate(candidate) {
  const created = await createKnlFramework(SESSION, {
    code: candidate.frameworkCode,
    name: candidate.frameworkName,
    levelCount: candidate.levelCount,
    includeDescription: candidate.includeDescription
  });
  const versionId = created.version.id;
  const detail = await getKnlFrameworkVersion(SESSION, { versionId });
  const columnByLevel = new Map(detail.columns.filter(c => c.type === 'level').map(c => [c.levelNumber, c.id]));

  let groups = 0, items = 0, contents = 0;
  for (const group of candidate.groups) {
    const savedGroup = await saveKnlGroup(SESSION, { versionId, name: group.name });
    groups++;
    for (const item of group.items) {
      const savedItem = await saveKnlItem(SESSION, { versionId, groupId: savedGroup.group.id, name: item.name, description: item.description || '' });
      items++;
      const writes = [];
      item.levels.forEach((content, index) => {
        const text = String(content || '').trim();
        if (!text) return;
        const columnId = columnByLevel.get(index + 1);
        if (!columnId) return;
        writes.push(saveKnlLevelContent(SESSION, { versionId, itemId: savedItem.item.id, columnId, content: text }));
      });
      const results = await Promise.all(writes);
      contents += results.length;
    }
  }
  return { code: candidate.frameworkCode, name: candidate.frameworkName, sourceSheet: candidate.sourceSheet, frameworkId: created.framework.id, versionId, groups, items, contents };
}

async function run() {
  console.log('Mode:', APPLY ? '*** APPLY (Production write) ***' : 'DRY-RUN (no write)');
  const existing = await listKnlFrameworks(SESSION);
  const existingCodes = new Set(existing.frameworks.map(f => String(f.code || '').toUpperCase()));

  const candidates = manifest.candidates.filter(c => c.candidateStatus !== 'EXCLUDED');
  const toSeed = candidates.filter(c => !existingCodes.has(String(c.frameworkCode).toUpperCase()));
  const alreadyPresent = candidates.filter(c => existingCodes.has(String(c.frameworkCode).toUpperCase()));

  console.log('Frameworks already present (skipped, unchanged):', alreadyPresent.length, alreadyPresent.map(c => c.sourceSheet));
  console.log('Frameworks to seed this run:', toSeed.length, toSeed.map(c => c.sourceSheet));

  if (!APPLY) { console.log('\nDRY-RUN — không ghi gì. Chạy lại với --apply để ghi ' + toSeed.length + ' framework vào Production.'); return; }

  const results = [];
  for (const candidate of toSeed) {
    const result = await seedCandidate(candidate);
    results.push(result);
    console.log('SEEDED', result.sourceSheet, '->', result.name, '| groups', result.groups, 'items', result.items, 'contents', result.contents);
  }

  const totals = results.reduce((a, r) => ({ frameworks: a.frameworks + 1, groups: a.groups + r.groups, items: a.items + r.items, contents: a.contents + r.contents }), { frameworks: 0, groups: 0, items: 0, contents: 0 });
  console.log('\n=== SEED SUMMARY ===');
  console.log('newly seeded frameworks:', totals.frameworks);
  console.log('total groups/items/contents added:', totals.groups, totals.items, totals.contents);
  console.log('already present before this run:', alreadyPresent.length);
}

// Chỉ tự chạy khi được gọi trực tiếp — cho phép require() an toàn để test
// guard mà không kích hoạt run() thật (xem
// scripts/test-env-write-scripts-declared-target-guard-v1.js).
if (require.main === module) {
  run().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
}

module.exports = { run };
