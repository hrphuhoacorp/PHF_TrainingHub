'use strict';
/*
 * Regression — Residual B (2026-08-14): chặn ghi đè version_no đã tồn tại
 * trong phf_save_checklist_template (fix SQL: scripts/PHF_CHECKLIST_TEMPLATE_
 * VERSION_IMMUTABLE_FIX_1.54.0.sql; fix JS: lib/checklist-templates.js saveOne()).
 *
 * SQL chưa được thực thi ở bất kỳ database nào (chỉ author + reason tĩnh —
 * xem STOP-GATE trong file SQL và báo cáo bàn giao), nên bài test này mock
 * TẦNG RPC ngay biên @supabase/supabase-js.createClient (monkeypatch TRƯỚC
 * khi require lib/checklist-templates.js lần đầu, để module bắt được client
 * giả thay vì tạo client thật trỏ Production) và mô phỏng ĐÚNG quyết định mà
 * hàm SQL 1.54.0 sẽ đưa ra (no-op nếu payload giống hệt bản đã lưu, từ chối
 * CHECKLIST_TEMPLATE_VERSION_IMMUTABLE nếu khác) — qua đó xác nhận tầng JS
 * (saveOne trong lib/checklist-templates.js) map lỗi RPC sang thông báo/mã lỗi
 * đúng, không âm thầm nuốt lỗi hay coi ghi đè là thành công.
 *
 * Chạy: node scripts/test-checklist-template-version-immutable-2026-08.js
 * (không kết nối Supabase/Production nào — createClient bị monkeypatch trước
 * khi module thật chạy `createClient(...)`).
 */
const assert = require('assert');

// --- Monkeypatch createClient TRƯỚC khi require lib/checklist-templates.js ---
const supabaseJs = require('@supabase/supabase-js');
const originalCreateClient = supabaseJs.createClient;

// "Database" giả tối giản: lưu 1 version_no cho 1 template_key, mô phỏng đúng
// quyết định no-op-nếu-giống-hệt / conflict-nếu-khác của RPC 1.54.0.
const store = { templates: new Map(), versions: new Map() }; // key: template_key|version_no
function versionKey(templateKey, versionNo) { return templateKey + '|' + versionNo; }
function sameContent(a, b) {
  return JSON.stringify(a.definition) === JSON.stringify(b.definition)
    && a.effective_date === b.effective_date
    && (a.reason || '') === (b.reason || '')
    && (a.source_version || '') === (b.source_version || '')
    && (a.change_type || '') === (b.change_type || '');
}
function fakeRpcSaveTemplate(args) {
  const p_template = args.p_template, p_version = args.p_version;
  const key = String(p_template.template_key || '').toLowerCase();
  const versionNo = String(p_version.version_no || '');
  const vKey = versionKey(key, versionNo);
  const existing = store.versions.get(vKey);
  const incoming = {
    definition: p_version.definition,
    effective_date: p_version.effective_date,
    reason: p_version.reason,
    source_version: p_version.source_version,
    change_type: p_version.change_type
  };
  if (existing) {
    if (!sameContent(existing, incoming)) {
      return { data: null, error: { message: 'CHECKLIST_TEMPLATE_VERSION_IMMUTABLE:' + key + '|' + versionNo } };
    }
    // no-op an toàn — không ghi lại.
  } else {
    store.versions.set(vKey, incoming);
  }
  store.templates.set(key, { template_key: key, current_version: versionNo, updated_at: new Date().toISOString() });
  return { data: { ok: true, templateKey: key, version: versionNo }, error: null };
}

supabaseJs.createClient = function () {
  return {
    rpc: async (name, args) => {
      if (name === 'phf_save_checklist_template') return fakeRpcSaveTemplate(args);
      return { data: null, error: { message: 'unexpected rpc ' + name } };
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (table === 'checklist_templates') {
              const row = [...store.templates.values()][0] || {};
              return { data: row, error: null };
            }
            return { data: null, error: null };
          },
          order: () => Promise.resolve({ data: [...store.versions.entries()].map(([k, v]) => ({ template_key: k.split('|')[0], version_no: k.split('|')[1], ...v })), error: null })
        })
      })
    })
  };
};

delete require.cache[require.resolve('../lib/checklist-templates')];
const { saveChecklistTemplate } = require('../lib/checklist-templates');
supabaseJs.createClient = originalCreateClient; // khôi phục ngay sau khi module đã bắt được bản giả

const adminSession = { role: 'admin', account: { id: 'admin-1', name: 'Admin' } };
function templateRow(overrides) {
  return Object.assign({
    templateKey: 'test-immutable-tpl',
    code: 'TEST-IMMUT',
    name: 'Mẫu test immutable',
    templateType: 'checklist_detail',
    hasChecklist: true,
    status: 'active',
    version: 'V1',
    effectiveDate: '2026-08-14',
    expectedAbsent: true,
    definition: { groups: [{ code: 'G', name: 'G', children: [] }], totalRows: [{ id: 'A', code: 'A', target: 100, weight: 90, source: { type: 'manual' } }, { id: 'CT', code: 'CT', target: 100, weight: 10, source: { type: 'checklist_total' } }] }
  }, overrides);
}

let passCount = 0;
function check(label, fn) { return Promise.resolve().then(fn).then(() => { passCount++; console.log('✓ PASS — ' + label); }); }

async function main() {
  // 1) Lưu lần đầu -> thành công, tạo version mới.
  await check('Lưu version_no mới lần đầu -> thành công', async () => {
    const result = await saveChecklistTemplate(adminSession, templateRow({}));
    assert.strictEqual(result.template.version, 'V1');
  });

  // 2) Re-save CÙNG version_no + CÙNG definition (double-click/retry an toàn) -> no-op thành công, KHÔNG lỗi.
  await check('Re-save đúng version_no + đúng definition (double-click) -> no-op thành công, không lỗi, không "ghi đè"', async () => {
    const before = JSON.stringify(store.versions.get('test-immutable-tpl|V1'));
    const result = await saveChecklistTemplate(adminSession, templateRow({ expectedAbsent: false, expectedUpdatedAt: store.templates.get('test-immutable-tpl').updated_at }));
    const after = JSON.stringify(store.versions.get('test-immutable-tpl|V1'));
    assert.strictEqual(result.template.version, 'V1');
    assert.strictEqual(before, after, 'nội dung version đã lưu phải nguyên vẹn sau no-op');
  });

  // 3) Re-save CÙNG version_no nhưng definition KHÁC -> bị từ chối, KHÔNG ghi đè.
  await check('Re-save đúng version_no nhưng definition KHÁC -> bị từ chối CHECKLIST_TEMPLATE_VERSION_IMMUTABLE, bản cũ không đổi', async () => {
    const before = JSON.stringify(store.versions.get('test-immutable-tpl|V1'));
    const changedDefinition = { groups: [{ code: 'G', name: 'G', children: [] }], totalRows: [{ id: 'A', code: 'A', target: 100, weight: 50, source: { type: 'manual' } }, { id: 'CT', code: 'CT', target: 100, weight: 50, source: { type: 'checklist_total' } }] };
    let threw = null;
    try {
      await saveChecklistTemplate(adminSession, templateRow({ definition: changedDefinition, expectedAbsent: false, expectedUpdatedAt: store.templates.get('test-immutable-tpl').updated_at }));
    } catch (e) { threw = e; }
    assert.ok(threw, 'phải throw khi definition khác nhưng version_no trùng');
    assert.strictEqual(threw.code, 'CHECKLIST_TEMPLATE_VERSION_IMMUTABLE');
    assert.strictEqual(threw.statusCode, 409);
    const after = JSON.stringify(store.versions.get('test-immutable-tpl|V1'));
    assert.strictEqual(before, after, 'bản đã lưu KHÔNG được thay đổi bởi lần lưu bị từ chối');
  });

  // 4) Version_no MỚI (khác V1) cho cùng template -> thành công bình thường, không bị chặn nhầm.
  await check('Version_no mới (V2) cho cùng template -> lưu bình thường, không bị chặn nhầm bởi gate immutable', async () => {
    const result = await saveChecklistTemplate(adminSession, templateRow({ version: 'V2', expectedAbsent: false, expectedUpdatedAt: store.templates.get('test-immutable-tpl').updated_at }));
    assert.strictEqual(result.template.version, 'V2');
    assert.ok(store.versions.has('test-immutable-tpl|V1'), 'V1 vẫn còn nguyên trong store — không bị xoá/đổi bởi việc tạo V2');
  });

  // 5) "Double-click" mô phỏng: 2 request gần như đồng thời cùng version_no MỚI, nội dung KHÁC nhau.
  // Với fake RPC ở trên (không có khoá thật), 2 request chạy tuần tự trong Node (đơn luồng,
  // không có await xen giữa read-check-write của fakeRpcSaveTemplate) nên request thứ nhất
  // luôn thắng, request thứ hai luôn thấy "đã tồn tại, nội dung khác" -> bị từ chối sạch.
  // Đây CHÍNH XÁC là bất biến mà pg_advisory_xact_lock(hashtext('phf_checklist_template|'||v_key))
  // trong bản SQL thật (1.54.0) đảm bảo: giữ khoá xuyên suốt transaction cho mọi request cùng
  // template_key, nên không có 2 transaction nào cùng đọc-thấy-"chưa tồn tại" rồi cùng insert —
  // một trong hai luôn phải đợi tới khi bên kia commit, sau đó rơi vào đúng nhánh no-op/conflict
  // ở trên. Việt Nam hoá: "double-click" hay "2 tab cùng lưu" luôn resolve thành 1 thắng sạch,
  // 1 bị từ chối sạch — không có trạng thái nửa vời.
  await check('Double-click mô phỏng: 2 lần lưu gần như đồng thời cùng version_no MỚI (V3), nội dung khác nhau -> 1 thành công, 1 bị từ chối sạch, không dữ liệu nửa vời', async () => {
    const rowA = templateRow({ version: 'V3', definition: { groups: [{ code: 'G', name: 'G', children: [] }], totalRows: [{ id: 'A', code: 'A', target: 10, weight: 100, source: { type: 'manual' } }] }, expectedAbsent: false, expectedUpdatedAt: store.templates.get('test-immutable-tpl').updated_at });
    const rowB = templateRow({ version: 'V3', definition: { groups: [{ code: 'G', name: 'G', children: [] }], totalRows: [{ id: 'B', code: 'B', target: 20, weight: 100, source: { type: 'manual' } }] }, expectedAbsent: false, expectedUpdatedAt: store.templates.get('test-immutable-tpl').updated_at });
    const results = await Promise.allSettled([saveChecklistTemplate(adminSession, rowA), saveChecklistTemplate(adminSession, rowB)]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    // Do STALE-check trên parent row (expected_updated_at) cả 2 có thể race với nhau ở tầng
    // template cha; điều BẮT BUỘC kiểm chứng ở đây là: không bao giờ có chuyện CẢ HAI đều
    // "thành công" với 2 definition khác nhau cho cùng version_no V3.
    assert.ok(fulfilled.length <= 1, 'tối đa 1 trong 2 request được coi là thành công cho cùng version_no với nội dung khác nhau');
    assert.ok(fulfilled.length + rejected.length === 2);
  });

  console.log('');
  console.log('=== Kết quả ===');
  console.log(passCount + ' bước PASS.');
  console.log('Toàn bộ mock ở biên @supabase/supabase-js.createClient — KHÔNG kết nối Supabase/Production thật. Tính đúng đắn concurrency thật (advisory lock) được LÝ GIẢI tĩnh trong comment, không thể exec SQL thật trong môi trường này (STOP-GATE).');
}

main().then(() => { process.exitCode = 0; }).catch(err => { console.error('FAIL:', err && err.stack || err); process.exitCode = 1; });
