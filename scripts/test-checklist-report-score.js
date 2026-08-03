'use strict';

const assert=require('assert');
const {reportScoreSummary}=require('../lib/checklist-reports');

const form={
  template_snapshot:{version:{definition:{totalRows:[
    [1,'A','A',10,'điểm',30,'Không','Nhập đánh giá'],
    [2,'B','B',10,'điểm',50,'Không','Nhập đánh giá']
  ]}}},
  self_answers:{A:{value:'8'},B:{value:'8'}},
  review_answers:{A:{value:'9'},B:{value:'9'}}
};
const summary=reportScoreSummary(form,0);
assert.strictEqual(summary.totalWeight,80);
assert.strictEqual(summary.selfTotalScore,80);
assert.strictEqual(summary.reviewTotalScore,90);
assert.strictEqual(summary.finalScore,86.67);

console.log('PASS report uses central Excel score engine.');
