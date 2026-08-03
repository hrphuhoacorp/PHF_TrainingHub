'use strict';

const assert=require('assert');
const {validateScoredDefinition}=require('../lib/checklist-templates');

function definition(rows){return {totalRows:rows};}
function row(code,target,weight){return [1,code,'Tiêu chí '+code,target,'điểm',weight,'Không','Nhập đánh giá'];}
function rejects(rows,code){assert.throws(()=>validateScoredDefinition(definition(rows)),error=>error&&error.code===code);}

assert.deepStrictEqual(validateScoredDefinition(definition([row('A',10,60),row('B',2,40)])),{totalWeight:100});
rejects([row('A',0,100)],'CHECKLIST_TEMPLATE_TARGET_INVALID');
rejects([row('A','Đạt',100)],'CHECKLIST_TEMPLATE_TARGET_INVALID');
rejects([row('A',10,0),row('B',10,100)],'CHECKLIST_TEMPLATE_WEIGHT_INVALID');
rejects([row('A',10,80)],'CHECKLIST_TEMPLATE_TOTAL_WEIGHT_INVALID');

console.log('PASS checklist template validation: target > 0, weight > 0, total weight = 100.');
