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
assert(ui.includes('grades=m.grades||[]'),'UI grade columns must come only from backend grade definitions');
assert(ui.includes('Version chưa có grade definitions. Không tự dựng B1–B4.'),'empty grade state must be explicit');
assert(!ui.includes("grades=m.grades.length?m.grades:[1,2,3,4]"),'UI must not synthesize B1..B4');
assert(!ui.includes("foundationState.matrix.grades:[1,2,3,4]"),'save path must not synthesize B1..B4');
assert(!/Truongnhom_Thumua.*\[1,2,3,4,5\]|Thu mua.*B5/i.test(ui),'UI must not hard-code grade count by department/framework name');
assert.strictEqual((migration.match(/\$\$/g)||[]).length%2,0,'balanced SQL dollar quotes');

console.log('PASS KNL grade baseline 1.50.2 gate: exact 11-version data fix, immutable/partial guards, idempotency and no compensation mutation.');
