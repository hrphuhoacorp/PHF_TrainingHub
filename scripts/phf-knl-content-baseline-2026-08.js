'use strict';
/* PHF KNL Content Baseline 08/2026 — framework/grade CONTENT only.
 * KHÔNG ghi employee assignment (không có persistence chính thức, xem batch
 * trước — STOP GATE riêng, xử lý ở script khác/sau khi migration được duyệt).
 *
 * Part 1: hoàn thiện grade matrix (Bậc N = Mức độ N) cho 6 framework đang có
 *         items nhưng 0 grade: KNL_NV_GOI_QUA_PHF, KNL_NV_HCNS_PHF,
 *         KNL_NV_KHO_PHF, KNL_KT_CHI, KNL_KT_THU, KNL_KTTH.
 * Part 2: tạo framework mới "Nhân viên bán hàng Online" từ
 *         KNL bán hàng online.xlsx (10 hạng mục, 3 nhóm, 5 mức độ) qua đúng
 *         canonical service (lib/knl-frameworks.js), rồi lưu grade matrix
 *         cùng rule Bậc N = Mức độ N.
 *
 * Dùng service/RPC hiện có (saveKnlGradeMatrix RPC, createKnlFramework/
 * saveKnlGroup/saveKnlItem/saveKnlLevelContent). Không direct-insert khi
 * service đã có, trừ đọc (select) để lấy id thật.
 *
 * PHF ENV HARD GATE (Phase 2C — PHF_HR_ENVIRONMENT_SCRIPT_FORENSIC_PHASE2B_
 * 2026-08-26.md, nhóm NEEDS GUARD): script này trước đây KHÔNG có bất kỳ
 * flag/dry-run thật nào — dòng log "Dry-run:" ở createOnlineFramework() chỉ
 * là NHÃN GÂY HIỂU LẦM, code vẫn ghi ngay lập tức. Giờ:
 *   1) assertDeclaredTargetOrFailClosed('MAIN', ...) — verify hostname thật
 *      (không dựa tên file/comment) TRƯỚC createClient(), fail-closed nếu
 *      SUPABASE_URL không đúng MAIN.
 *   2) DRY-RUN THẬT theo mặc định — chỉ ghi khi có --apply.
 *
 * Chạy (xem trước, không ghi gì): node scripts/phf-knl-content-baseline-2026-08.js
 * Chạy (ghi thật vào MAIN):        node scripts/phf-knl-content-baseline-2026-08.js --apply
 */
require('dotenv').config();
const { assertDeclaredTargetOrFailClosed } = require('../api/_lib/env-identity-guard');

assertDeclaredTargetOrFailClosed('MAIN', '(scripts/phf-knl-content-baseline-2026-08.js)');

const { createClient } = require('@supabase/supabase-js');
const frameworksLib = require('../api/_lib/knl-frameworks');
const { saveKnlGradeMatrix } = require('../api/_lib/knl-foundation');

const db = createClient(process.env.SUPABASE_URL.trim(), process.env.SUPABASE_SECRET_KEY.trim(), { auth: { persistSession: false, autoRefreshToken: false } });
const SESSION = { role: 'admin', account: { id: 'system-knl-content-baseline-2026-08', name: 'PHF KNL Content Baseline 08/2026' }, sub: 'system-knl-content-baseline-2026-08' };
const APPLY = process.argv.includes('--apply');

function gradeSetFor(levelNumbers) {
  return levelNumbers.map(n => ({ gradeCode: 'B' + n, gradeNumber: n, label: 'Bậc ' + n, sortOrder: n }));
}
function requirementsFor(itemIds, levelColumns) {
  const reqs = [];
  itemIds.forEach(itemId => {
    levelColumns.forEach(col => {
      reqs.push({ itemId, gradeCode: 'B' + col.level_number, requiredColumnId: col.id, requiredLevelNumber: col.level_number });
    });
  });
  return reqs;
}

async function completeGradeMatrix(exactFrameworkCode) {
  const { data: fw } = await db.from('knl_frameworks').select('id,code,name').eq('code', exactFrameworkCode);
  const framework = fw && fw[0];
  if (!framework) { console.log('  SKIP', exactFrameworkCode, '- framework not found (exact code match)'); return; }
  const { data: versions } = await db.from('knl_framework_versions').select('id,version_number').eq('framework_id', framework.id).order('version_number', { ascending: false });
  const version = versions && versions[0];
  const { data: cols } = await db.from('knl_structure_columns').select('id,column_type,level_number').eq('version_id', version.id).eq('is_active', true);
  const levelCols = cols.filter(c => c.column_type === 'level').sort((a, b) => a.level_number - b.level_number);
  const { data: items } = await db.from('knl_competency_items').select('id,name').eq('version_id', version.id).eq('is_active', true);
  const grades = gradeSetFor(levelCols.map(c => c.level_number));
  const requirements = requirementsFor(items.map(i => i.id), levelCols);
  console.log(`  ${framework.code} (${framework.name}) v${version.version_number}: ${items.length} items x ${levelCols.length} levels = ${requirements.length} requirements, grades ${grades.map(g => g.gradeCode).join(',')}`);
  if (!APPLY) { console.log('    DRY-RUN — sẽ gọi saveKnlGradeMatrix(), chưa ghi gì. Chạy lại với --apply để ghi.'); return; }
  const result = await saveKnlGradeMatrix(SESSION, { versionId: version.id, grades, requirements });
  console.log('    OK ->', JSON.stringify(result.saved));
}

const ONLINE_GROUPS = [
  {
    name: 'KIẾN THỨC',
    items: [
      { name: 'Kinh nghiệm làm việc trong lĩnh vực liên quan', description: 'Thời gian làm việc trong ngành nghề, lĩnh vực liên quan phục vụ và bán hàng',
        levels: ['Chưa có kinh nghiệm', 'Từ 6 tháng - 1 năm', 'Từ 1 - 3 năm', 'Từ 3 - 5 năm', 'Trên 5 năm kinh nghiệm'] },
      { name: 'Chuyên môn, trình độ học vấn', description: 'Cấp học',
        levels: ['12/12', 'Trung cấp nghề', 'Đại học', '', ''] },
      { name: 'Hiểu biết về SPDV', description: 'Kiến thức về DMSP: đặc tính, nguồn gốc xuất xứ, cách bảo quản, giá trị gia tăng...',
        levels: [
          '1. Nhận biết và kể tên các sản phẩm cơ bản',
          '1. Hiểu và mô tả được công dụng chính của sản phẩm',
          '1. Có khả năng giải thích về đặc tính, giá trị dinh dưỡng, cách bảo quản sản phẩm',
          '1. Có khả năng đào tạo cho nhân viên mới\n2. Tư vấn và đề xuất sản phẩm phù hợp với nhu cầu KH',
          ''
        ] },
      { name: 'Ngoại ngữ', description: 'Tiếng Anh/ Tiếng Trung',
        levels: ['Không', 'Giao tiếp căn bản', 'Giao tiếp nâng cao, có thể tư vấn và bán hàng cho KH nước ngoài', 'Có thể training/ phiên dịch/ dịch thuật', ''] }
    ]
  },
  {
    name: 'KỸ NĂNG',
    items: [
      { name: 'Giao tiếp & chăm sóc khách hàng', description: 'Lắng nghe, tư vấn, xử lý khiếu nại',
        levels: [
          '1. Trả lời máy móc, bị động\n2. Chỉ bán theo yêu cầu',
          '1. Giao tiếp lịch sự, đúng mực, trả lời chính xác câu hỏi của khách',
          '1. Chủ động chào hỏi, tư vấn\n2. Giới thiệu thêm các sản phẩm liên quan',
          '1. Xử lý khéo léo các khiếu nại\n2. Có khả năng upsell và duy trì ổn định doanh số',
          '1. Đạt doanh số cao\n2. Tạo trải nghiệm mua hàng tích cực và khách hàng trung thành'
        ] },
      { name: 'Kỹ năng văn phòng, phần mềm bán hàng', description: 'Khả năng sử dụng các phần mềm tin học, công cụ phục vụ bán hàng',
        levels: [
          '1. Nhập liệu, thao tác cơ bản: CRM, Word, Excel, PPT...',
          '1. Có khả năng format, trình bày đẹp, trực quan\n2. Phân tích dựa trên dữ liệu',
          '1. Xử lý các lỗi phát sinh\n2. Sử dụng các tính năng nâng cao',
          '1. Kết nối các phần mềm với nhau\n2. Đào tạo và hướng dẫn đồng nghiệp',
          '1. Phát triển thêm các tính năng từ các ứng dụng có sẵn\n2. Triển khai cải tiến công nghệ (AI Automation, Coding...)'
        ] },
      { name: 'Thực hiện quy trình - nghiệp vụ bán hàng', description: 'Mức độ hiểu biết và áp dụng nghiệp vụ, chính sách bán hàng',
        levels: [
          '1. Thao tác nghiệp vụ cơ bản, chưa thành thạo và cần hỗ trợ',
          '1. Thao tác nghiệp vụ đúng chuẩn\n2. Giới thiệu đúng chương trình cho khách',
          '1. Biết kiểm kê, tổng hợp, thực hiện các báo cáo theo yêu cầu\n3. Chủ động đề xuất các chương trình, kết hợp với khuyến mãi để up-sell/ cross-sell',
          '1. Chủ động xử lý tình huống phát sinh\n2. Hỗ trợ, đào tạo đồng nghiệp mới',
          '1. Biết đề xuất cải tiến, sáng kiến cải thiện quy trình, chính sách bán hàng, layout trưng bày'
        ] },
      { name: 'Đáp ứng các yêu cầu trong mô tả công việc', description: '',
        levels: [
          'Thực hiện được 70% khối lượng công việc theo mô tả công việc',
          'Thực hiện được 100% khối lượng công việc theo mô tả công việc',
          '1. Có thể kiêm nhiệm các công việc của các vị trí khác trong phòng\n2. Có thể đào tạo hướng dẫn cho người khác',
          '1. Có tham mưu, đề xuất, cải tiến áp dụng được vào thực tiễn',
          '1.Có thể kiêm nhiệm các công việc của các vị trí của các phòng ban khác'
        ] }
    ]
  },
  {
    name: 'TINH THẦN & THÁI ĐỘ',
    items: [
      { name: 'Tuân thủ giá trị cốt lõi, VHDN', description: '',
        levels: ['Ghi nhớ các giá trị cốt lõi, VHDN', 'Hiểu, giải thích được ý nghĩa các giá trị', 'Vận dụng vào công việc hàng ngày', 'Giảng dạy cho đồng nghiệp', 'Truyền thông các giá trị ra bên ngoài: đối tác/ khách hàng'] },
      { name: 'Tinh thần học hỏi', description: '',
        levels: [
          'Có tham gia nhưng không đầy đủ',
          'Tham gia đầy đủ',
          '1.Đề xuất các khóa đào tạo mang lại lợi ích cho công ty\n2.Áp dụng kiến thức đã học vào thực tế công việc',
          'Có thể giảng dạy lại các kiến thức đã học',
          ''
        ] }
    ]
  }
];

async function createOnlineFramework() {
  console.log('=== Part 2: tạo framework "Nhân viên bán hàng Online" ===');
  const totalItems = ONLINE_GROUPS.reduce((n, g) => n + g.items.length, 0);
  const totalCells = ONLINE_GROUPS.reduce((n, g) => n + g.items.reduce((m, i) => m + i.levels.filter(Boolean).length, 0), 0);
  console.log(`  ${APPLY ? 'APPLY' : 'DRY-RUN'}: ${ONLINE_GROUPS.length} nhóm, ${totalItems} hạng mục, ${totalCells} ô nội dung mức độ (không tính ô trống trong file gốc)`);

  const { data: existing } = await db.from('knl_frameworks').select('id,code').eq('code', 'KNL_NV_BAN_HANG_ONLINE_PHF');
  if (existing && existing.length) { console.log('  SKIP - framework KNL_NV_BAN_HANG_ONLINE_PHF đã tồn tại (idempotent guard), không tạo trùng.'); return; }

  if (!APPLY) { console.log('  DRY-RUN — sẽ tạo framework mới + grade matrix, chưa ghi gì. Chạy lại với --apply để ghi.'); return; }

  const created = await frameworksLib.createKnlFramework(SESSION, {
    code: 'KNL_NV_BAN_HANG_ONLINE_PHF', name: 'Nhân viên bán hàng Online',
    description: 'Nguồn: KNL bán hàng online.xlsx (PHF cung cấp 2026-08).',
    levelCount: 5, includeDescription: true, versionName: 'Version 1'
  });
  const versionId = created.version.id;
  console.log('  Framework created:', created.framework.id, '| version:', versionId);

  const versionDetail = await frameworksLib.getKnlFrameworkVersion(SESSION, { versionId });
  const levelCols = versionDetail.columns.filter(c => c.type === 'level').sort((a, b) => a.levelNumber - b.levelNumber);

  const itemIds = [];
  for (const group of ONLINE_GROUPS) {
    const g = await frameworksLib.saveKnlGroup(SESSION, { versionId, name: group.name });
    for (const item of group.items) {
      const it = await frameworksLib.saveKnlItem(SESSION, { versionId, groupId: g.group.id, name: item.name, description: item.description });
      itemIds.push(it.item.id);
      for (let n = 1; n <= 5; n++) {
        const content = item.levels[n - 1];
        if (!content) continue;
        const col = levelCols.find(c => c.levelNumber === n);
        await frameworksLib.saveKnlLevelContent(SESSION, { versionId, itemId: it.item.id, columnId: col.id, content });
      }
    }
  }
  console.log(`  Đã tạo ${itemIds.length} hạng mục + nội dung mức độ.`);

  const grades = gradeSetFor([1, 2, 3, 4, 5]);
  const requirements = requirementsFor(itemIds, levelCols.map(c => ({ id: c.id, level_number: c.levelNumber })));
  console.log(`  Lưu grade matrix: ${grades.length} bậc x ${itemIds.length} hạng mục = ${requirements.length} requirements`);
  const savedMatrix = await saveKnlGradeMatrix(SESSION, { versionId, grades, requirements });
  console.log('    OK ->', JSON.stringify(savedMatrix.saved));

  return { frameworkId: created.framework.id, versionId };
}

async function main() {
  console.log('Mode:', APPLY ? '*** APPLY (Production write) ***' : 'DRY-RUN (no write)');
  console.log('');
  console.log('=== Part 1: hoàn thiện grade matrix (Bậc N = Mức độ N) cho 6 framework đang 0 grade ===');
  for (const code of ['KNL_NV_GOI_QUA_PHF_212318', 'KNL_NV_HCNS_PHF_1EC4DF', 'KNL_NV_KHO_PHF_EADB74', 'KNL_KT_CHI_2F89A7', 'KNL_KT_THU_49A231', 'KNL_KTTH_5036BB']) {
    await completeGradeMatrix(code);
  }
  console.log('');
  await createOnlineFramework();
  console.log('\nDONE.');
}

// Chỉ tự chạy khi được gọi trực tiếp — cho phép require() an toàn để test
// guard mà không kích hoạt main() thật (xem
// scripts/test-env-write-scripts-declared-target-guard-v1.js).
if (require.main === module) {
  main().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
}

module.exports = { main };
