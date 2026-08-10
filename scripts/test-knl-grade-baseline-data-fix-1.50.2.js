'use strict';

const fs=require('fs');
const assert=require('assert');
const migration=fs.readFileSync('scripts/PHF_KNL_GRADE_MATRIX_BASELINE_DATA_FIX_1.50.2.sql','utf8');
const ui=fs.readFileSync('assets/js/knl/phf-knl-app.js','utf8');
const manifest=require('../assets/data/knl-source-manifest-2026-08-09.json');
const ready=manifest.candidates.filter(row=>row.candidateStatus==='READY');

assert.strictEqual(ready.length,11,'baseline gate must target exactly 11 READY frameworks');
assert.strictEqual(ready.filter(row=>row.levelCount===4).length,1,'baseline has exactly one approved B1..B4 framework');
assert.strictEqual(ready.filter(row=>row.levelCount===5).length,10,'baseline has exactly ten approved B1..B5 frameworks');
assert(ready.some(row=>row.sourceSheet==='Truongnhom_Thumua'&&row.levelCount===5),'Thu mua baseline must be five grades');

for(const token of [
  "v_target_count<>11 or v_four_count<>1 or v_five_count<>10",
  "v.status<>'draft' or v.is_locked or v.lifecycle_status<>'DRAFT'",
  'KNL_GRADE_BASELINE_LEVEL_MISMATCH',
  'KNL_GRADE_BASELINE_PARTIAL_DATA',
  'v_grade_count=0 and v_requirement_count=0',
  'v_requirement_count=v_item_count*v_grade_count',
  "m.manifest_key like 'phf-knl-2026-08-09:%'",
  "'B'||n",
  'c.level_number=g.grade_number'
])assert(migration.includes(token),'missing data-fix guard: '+token);

assert(!/alter table|drop table|truncate/i.test(migration),'data fix must not change schema or delete data');
assert(!/knl_employee_compensation_assignments\s+(?:set|values)|delete\s+from\s+public\.knl_employee_compensation/i.test(migration),'data fix must not touch compensation assignments/history');
assert(ui.includes('savedGrades=m.grades||[]'),'UI grade columns must come only from backend grade definitions when they exist');
assert(/Version CHƯA có grade definitions chính thức/.test(ui),'empty grade state must be explicit');
assert(/KHÔNG phải tiêu chuẩn đã được PHF duyệt/.test(ui),'the prefill warning must explicitly say this is not a PHF-approved standard until Admin saves');
assert(!ui.includes("grades=m.grades.length?m.grades:[1,2,3,4]"),'UI must not synthesize B1..B4');
assert(!ui.includes("foundationState.matrix.grades:[1,2,3,4]"),'save path must not synthesize B1..B4');
assert(!/Truongnhom_Thumua.*\[1,2,3,4,5\]|Thu mua.*B5/i.test(ui),'UI must not hard-code grade count by department/framework name');
// 1.50.10: khi backend chưa có grade definitions, UI cho phép Admin tự thêm/
// sửa/xóa từng bậc qua pendingNewGrades. Kể từ quyết định PHF 2026-08-10, gợi ý
// khởi tạo B1..Bn PHẢI khớp động theo levelCols.length của chính version đó
// (4 mức -> B1..B4, 5 mức -> B1..B5, N mức -> B1..Bn) — không phải một mảng
// hard-code cố định [1,2,3,4]/[1,2,3,4,5], và không suy theo tên phòng ban.
assert(ui.includes('pendingNewGrades'),'empty grade state must offer an Admin-driven way to configure grades, not a dead end');
assert(/levelCols\s*=\s*orderedActive\(foundationState\.detail\.columns\)\.filter\(function\(c\)\{return c\.type===['"]level['"];\}\)/.test(ui),'default grade suggestion must derive its count from the version\'s own active level columns');
assert(/pendingNewGrades\s*=\s*levelCols\.map\(function\(c,index\)\{var n=index\+1;return\{gradeCode:'B'\+n,gradeNumber:n,label:'Bậc '\+n,sortOrder:n\};\}\)/.test(ui),'default grade suggestion must generate exactly one B{n} per level column, dynamically (B1..Bn)');
assert(!/pendingNewGrades\s*=\s*\[1,\s*2,\s*3,\s*4\]|pendingNewGrades\s*=\s*\[1,\s*2,\s*3,\s*4,\s*5\]/.test(ui),'pending grade creation must not be a fixed hard-coded array');
// 1.50.11: Admin phải xóa/thêm bậc được cả với version đã có grade definitions
// đã lưu (không chỉ trạng thái pending trước khi lưu lần đầu), miễn version còn
// mutable (DRAFT + chưa lock). Xóa bậc phải hỏi xác nhận trước khi submit.
assert(!/pending\s*&&\s*mutable\?'<button type="button" class="phfk-btn-secondary" data-grade-add>/.test(ui),'add-grade control must not be hidden once a version already has saved grade definitions');
assert(/interactive\?' <button type="button" class="phfk-mini-remove" data-grade-remove=/.test(ui),'remove-grade control must render for every grade column (saved or pending) while the version is mutable and not mid-save');
assert(/data-grade-remove.*confirm\(/.test(ui)||/confirm\('Bỏ bậc/.test(ui),'removing a grade must ask for explicit confirmation before it can wipe saved requirements on next save');
// 1.50.14 P0: Save phải luôn có loading -> success/error rõ ràng, không silent
// fail (Admin báo bấm Lưu ma trận không có phản ứng gì sau 1.50.13).
assert(/gradeSaving:false,gradeMessage:''/.test(ui),'foundationState must track an explicit saving/message state for the grade matrix Save button');
assert(/saving\s*=\s*foundationState\.gradeSaving===true/.test(ui)&&/interactive\s*=\s*mutable&&!saving/.test(ui),'save-in-flight must disable add\\/remove\\/cell controls too, not just the Save button');
assert(/saveLabel\s*=\s*saving\?'Đang lưu…':'Lưu ma trận'/.test(ui),'Save button must show an explicit loading label while the RPC is in flight');
assert(/data-grade-status/.test(ui),'a dedicated, visible status element must exist near the Save button for loading\\/success\\/error feedback');
assert(/gradeMessage=\s*'Đã lưu ma trận thành công\.'/.test(ui),'a successful save must set a visible success message, not just re-render silently');
assert(/foundationState\.gradeSaving=true;foundationState\.gradeMessage='';foundationState\.error=''/.test(ui),'clicking Save must immediately flip to a visible saving state before the RPC resolves');
// 1.50.11: Framework Version dropdown (Tiêu chuẩn bậc) must not surface
// inactive/legacy frameworks (post library-cleanup canonical-V2 rule) — no
// hard-coded framework IDs, filtered from the real knl_frameworks.status field.
assert(/foundationVersionOptions\(\)\{return \(foundationState\.frameworks\|\|\[\]\)\.filter\(function\(f\)\{return f\.status!==['"]inactive['"];\}\)/.test(ui),'grade-matrix version dropdown must filter out frameworks with status===inactive from the real framework list, not a hard-coded ID list');
assert(!/KNL_TRUONG_KHO_PHF_D5BF32|KNL_[A-Z_]+_[0-9A-F]{6}['"]\s*[!=]==/.test(ui.match(/foundationVersionOptions[\s\S]{0,400}/)[0]),'dropdown filter must not hard-code specific framework IDs/codes');
// 2026-08-11 business rule: prefill cho grade matrix MỚI phải theo diagonal
// baseline Bn->Mn (không phải uniform M1), áp dụng đồng nhất cho MỌI framework
// rỗng kể cả 3 framework content-gap (PHF chốt: không tạo field/exception
// riêng cho content-gap trong batch này — chỉ tăng cường cảnh báo văn bản).
// Rule chỉ áp dụng cho matrix CHƯA từng lưu; bậc thêm vào matrix ĐÃ lưu vẫn
// giữ default M1 như cũ (không suy diagonal cho dữ liệu ngoài phạm vi mới).
assert(/diagonalDefault\s*=\s*savedGrades\.length\?1:Math\.min\(g\.gradeNumber,levels\.length\|\|1\)/.test(ui),'untouched cells on a brand-new empty matrix must default diagonally (Bn->Mn) via the version\'s own grade/level numbers, not a fixed M1');
assert(/selected\s*=\s*Number\(r&&r\.requiredLevelNumber\|\|diagonalDefault\)/.test(ui),'per-cell default must fall back to the diagonal baseline only when no real saved requirement exists yet');
assert(!/selected=Number\(r&&r\.requiredLevelNumber\|\|1\)/.test(ui),'the old uniform-M1 default must be fully replaced by the diagonal baseline logic');
assert.strictEqual((migration.match(/\$\$/g)||[]).length%2,0,'balanced SQL dollar quotes');

console.log('PASS KNL grade baseline 1.50.2 gate: exact 11-version data fix, immutable/partial guards, idempotency and no compensation mutation.');
