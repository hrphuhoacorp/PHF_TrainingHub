'use strict';
/* PHF KNL Library Cleanup (2026-08-10) - ONE-TIME maintenance script.

   NOT a migration - no schema/table change. Only updates knl_frameworks.
   name/status via lib/knl-frameworks.js#saveKnlFramework (the SAME function
   the KNL Admin UI uses) - no hand-rolled SQL, no direct table writes.

   Implements the Decision Prep FINAL + "Có V2 -> dùng V2 làm bản chính"
   business rule agreed with PHF this session:
   - 1 RENAME: KNL_TP_HCNS_PHF_1063C7 content is Trưởng phòng-level (13 mục,
     Quản trị nhân sự/tài chính/tài sản, Lập kế hoạch HCNS - superset of
     the real NV-level KNL_NV_HCNS_PHF_1EC4DF) but was mislabeled
     "Nhân viên HCNS".
   - 4 STRIP "(v2)": the now-canonical v2 frameworks (TBP Gói quà, TN Giám
     sát, Trưởng phòng Thu mua, Trưởng Kho) drop the "(v2)" suffix from
     their display name - version stays tracked in version_number, not the
     name (per PHF's explicit "không nhét (v2) vào display name" rule).
   - 9 status='inactive' (NEVER deleted, identity/history kept): the
     superseded v1 frameworks plus the 5 "generic 5-item template" legacy
     candidates confirmed HIGH-confidence subset/duplicate of a real "(PHF)"
     version via full item+level-text diff (see this session's Decision Prep).
   - 3 content-gap frameworks (Thủ kho, Trưởng nhóm Gói quà, Trưởng nhóm Thu
     mua) are DELIBERATELY untouched - already status='draft' in Production,
     which is exactly the "chưa hoàn thiện/chưa sẵn sàng áp dụng" signal the
     existing status enum (draft/published/inactive) already supports - no
     new field needed. This script does NOT touch them; see verify output.

   Never publishes/locks a version, never touches knl_framework_assignments,
   never creates/deletes rows, never merges identity.

   SAFETY:
   - default DRY RUN - prints the exact before/after diff, writes nothing.
   - --apply required to actually write.
   - re-reads CURRENT Production state right before writing and ABORTS the
     entire run (writes nothing) if any framework's current name/status does
     not match what this script expects - guards against a stale plan or a
     concurrent edit since the last verification read.

   Run:
     node scripts/PHF_KNL_LIBRARY_CLEANUP_1.50.13.js           (dry run)
     node scripts/PHF_KNL_LIBRARY_CLEANUP_1.50.13.js --apply   (writes)
*/
require('dotenv').config();
const { saveKnlFramework, listKnlFrameworks } = require('../api/_lib/knl-frameworks');

const SESSION = { account: { id: 'system-knl-cleanup-2026-08-10', name: 'PHF KNL Library Cleanup 2026-08-10' }, role: 'admin' };

const PLAN = [
  { code: 'KNL_TP_HCNS_PHF_1063C7', expectName: 'Nhân viên HCNS', expectStatus: 'draft', newName: 'Trưởng phòng HCNS', newStatus: 'draft',
    reason: 'RENAME_ONLY - 13 mục là nội dung cấp Trưởng phòng (Quản trị nhân sự/tài chính/tài sản, Lập kế hoạch HCNS), bị gán sai tên "Nhân viên HCNS"' },

  { code: 'KNL_TBP_GOI_QUA_PHF_V2_02CD1A', expectName: 'TBP Gói quà (v2)', expectStatus: 'draft', newName: 'TBP Gói quà', newStatus: 'draft',
    reason: 'V2 = bản chính (quy tắc PHF chốt) - display name bỏ "(v2)"' },
  { code: 'KNL_TN_GIAMSAT_V2_138CAA', expectName: 'TN Giám sát (v2)', expectStatus: 'draft', newName: 'TN Giám sát', newStatus: 'draft',
    reason: 'V2 = bản chính - display name bỏ "(v2)"' },
  { code: 'KNL_TP_THU_MUA_PHF_V2_FA9A20', expectName: 'Trưởng phòng Thu mua (v2)', expectStatus: 'draft', newName: 'Trưởng phòng Thu mua', newStatus: 'draft',
    reason: 'V2 = bản chính - display name bỏ "(v2)"' },
  { code: 'KNL_TRUONG_KHO_PHF_V2_0E47A5', expectName: 'Trưởng Kho (v2)', expectStatus: 'draft', newName: 'Trưởng Kho', newStatus: 'draft',
    reason: 'V2 = bản chính (đã chốt trước batch này) - display name bỏ "(v2)"' },

  { code: 'KNL_NV_HCNS_8DF07E', expectName: 'Nhân viên HCNS', expectStatus: 'draft', newName: 'Nhân viên HCNS', newStatus: 'inactive',
    reason: 'Mẫu rỗng 5 mục, tập con nguyên văn của KNL_NV_HCNS_PHF_1EC4DF' },
  { code: 'KNL_TP_HCNS_88534E', expectName: 'Trưởng phòng HCNS', expectStatus: 'draft', newName: 'Trưởng phòng HCNS', newStatus: 'inactive',
    reason: 'Mẫu rỗng 5 mục' },
  { code: 'KNL_NV_KHO_F97846', expectName: 'Nhân viên kho', expectStatus: 'draft', newName: 'Nhân viên kho', newStatus: 'inactive',
    reason: 'Tập con nguyên văn của KNL_NV_KHO_PHF_EADB74' },
  { code: 'KNL_NV_GOIQUA_D75617', expectName: 'NV Gói quà', expectStatus: 'draft', newName: 'NV Gói quà', newStatus: 'inactive',
    reason: 'Mẫu rỗng 5 mục' },
  { code: 'KNL_NV_THUMUA_5E7AE1', expectName: 'Nhân viên thu mua', expectStatus: 'draft', newName: 'Nhân viên thu mua', newStatus: 'inactive',
    reason: 'Tập con nguyên văn của KNL_NV_THU_MUA_PHF_98BC57' },
  { code: 'KNL_TBP_GOI_QUA_PHF_16446D', expectName: 'TBP Gói quà', expectStatus: 'draft', newName: 'TBP Gói quà', newStatus: 'inactive',
    reason: 'v1, bị thay thế bởi v2 (KNL_TBP_GOI_QUA_PHF_V2_02CD1A)' },
  { code: 'KNL_TN_GIAMSAT_VINH_B7F0A0', expectName: 'TN Giám sát', expectStatus: 'draft', newName: 'TN Giám sát', newStatus: 'inactive',
    reason: 'v1, nội dung giống hệt NV Giám sát (không phân biệt cấp), bị thay thế bởi v2' },
  { code: 'KNL_TP_THU_MUA_PHF_77FF9C', expectName: 'Trưởng phòng Thu mua', expectStatus: 'draft', newName: 'Trưởng phòng Thu mua', newStatus: 'inactive',
    reason: 'v1, bị thay thế bởi v2' },
  { code: 'KNL_TRUONG_KHO_PHF_D5BF32', expectName: 'Trưởng Kho', expectStatus: 'draft', newName: 'Trưởng Kho', newStatus: 'inactive',
    reason: 'v1 M1-M4 legacy, bị thay thế bởi v2 M1-M5 (đã chốt trước batch này)' }
];

async function run() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '=== APPLY MODE (se ghi du lieu that len Production) ===\n' : '=== DRY RUN (khong ghi gi) ===\n');

  const { frameworks } = await listKnlFrameworks(SESSION);
  const byCode = new Map(frameworks.map(f => [f.code, f]));

  const errors = [];
  for (const item of PLAN) {
    const current = byCode.get(item.code);
    if (!current) { errors.push(`${item.code}: KHONG TIM THAY trong DB`); continue; }
    if (current.name !== item.expectName || current.status !== item.expectStatus) {
      errors.push(`${item.code}: trang thai hien tai LECH ke hoach (hien: name="${current.name}" status="${current.status}" | ke hoach mong doi: name="${item.expectName}" status="${item.expectStatus}") - co the da bi sua boi nguoi khac, DUNG LAI toan bo`);
    }
  }
  if (errors.length) {
    console.error('AN TOAN: phat hien lech ke hoach so voi Production hien tai - KHONG ghi bat ky gi:');
    errors.forEach(e => console.error(' - ' + e));
    process.exitCode = 1;
    return;
  }

  for (const item of PLAN) {
    const current = byCode.get(item.code);
    console.log(`${item.code}\n  "${current.name}" [${current.status}]  ->  "${item.newName}" [${item.newStatus}]\n  ly do: ${item.reason}\n`);
    if (apply) {
      await saveKnlFramework(SESSION, { id: current.id, name: item.newName, description: current.description || '', status: item.newStatus });
    }
  }
  console.log(apply ? `DA GHI ${PLAN.length} framework.` : `(dry run) se ghi ${PLAN.length} framework neu chay lai voi --apply`);
}

run().catch(err => { console.error('[FAIL]', err && err.stack || err); process.exitCode = 1; });
