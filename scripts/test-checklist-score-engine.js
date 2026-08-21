'use strict';

const assert=require('assert');
const {SCORE_FORMULA_VERSION,normalizeCriterion,calculateMonthlyScore}=require('../api/_lib/checklist-score-engine');

assert.strictEqual(normalizeCriterion(2,2),10);
assert.strictEqual(normalizeCriterion(8,10),8);
assert.strictEqual(normalizeCriterion(3,4),7.5);
assert.strictEqual(normalizeCriterion(95,100),9.5);
assert.throws(()=>normalizeCriterion(1,0),error=>error.code==='CHECKLIST_SCORE_TARGET_INVALID');
assert.throws(()=>normalizeCriterion(1,'Đạt'),error=>error.code==='CHECKLIST_SCORE_TARGET_INVALID');

const total80=calculateMonthlyScore({criteria:[{code:'A',target:10,weight:30},{code:'B',target:10,weight:50}],selfActualByCode:{A:8,B:8},reviewActualByCode:{A:9,B:9}});
assert.strictEqual(total80.totalWeight,80);
assert.strictEqual(total80.selfTotal10,8);
assert.strictEqual(total80.reviewTotal10,9);
assert.strictEqual(total80.finalScore,86.67);
assert.strictEqual(total80.formulaVersion,SCORE_FORMULA_VERSION);

const noIntermediateRounding=calculateMonthlyScore({criteria:[{code:'A',target:3,weight:1},{code:'B',target:7,weight:2}],selfActualByCode:{A:1,B:2},reviewActualByCode:{A:1,B:2}});
assert.ok(Math.abs(noIntermediateRounding.selfTotal10-((10/3+40/7)/3))<1e-12);

console.log('PASS Excel score engine regression matrix.');
