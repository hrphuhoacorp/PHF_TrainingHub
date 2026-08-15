'use strict';

/* Executes the request-id helpers and payload builders extracted verbatim from
   the production Checklist IIFE. No DOM or database is used. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appPath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const app = fs.readFileSync(appPath, 'utf8');

function productionFunction(name) {
  const marker = 'function ' + name + '(';
  const start = app.indexOf(marker);
  assert.ok(start >= 0, 'Missing production function ' + name);
  const brace = app.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = brace; i < app.length; i++) {
    const ch = app[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error('Unclosed production function ' + name);
}

const functionNames = [
  'newStableViolationRequestId', 'ensureQuickRequestId', 'quickOfficialPayload',
  'multiDayRowDefault', 'ensureMultiRequestId', 'ensureMultiRows', 'multiOfficialPayload'
];
const productionSource = functionNames.map(productionFunction).join('\n');

const makeRuntime = new Function('assert', `
  var violationUiState={
    employeeId:'EMP-ID',templateId:'tpl',date:'2026-08-07',location:'CN1',
    sharedEvidence:false,selected:{},multiRows:[]
  };
  var criteria=[
    {id:'C1',code:'C1',text:'Loi 1',group:'G',factor:1,points:2,evidence:'recommended'},
    {id:'C2',code:'C2',text:'Loi 2',group:'G',factor:1,points:3,evidence:'recommended'},
    {id:'C3',code:'C3',text:'Loi 3',group:'G',factor:1,points:4,evidence:'recommended'}
  ];
  var employee={id:'EMP-ID',code:'EMP001',name:'Nhan vien',branch:'CN1'};
  var batchSequence=0;
  function quickValidation(){return {ids:Object.keys(violationUiState.selected).filter(function(id){return violationUiState.selected[id].selected;}),context:{person:employee,templateId:'tpl',version:'v1',meta:{name:'Mau'}}};}
  function violationSelectedEmployee(){return employee;}
  function violationLiveCriteria(){return criteria;}
  function evidenceDoneDraftIds(){return [];}
  function quickTestBatchId(){return 'QUICK-BATCH-'+(++batchSequence);}
  function multiTestBatchId(){return 'MULTI-BATCH-'+(++batchSequence);}
  function todayIso(){return '2026-08-07';}
  function currentTime24(){return '09:00';}
  function ensureViolationDefaults(){}
  function multiContextAt(){return {templateId:'tpl',version:'v1',meta:{name:'Mau'}};}
  function multiCriterionAt(row){return criteria.find(function(item){return item.id===row.criterion;})||null;}
  function isLateCriterionItem(item){var code=String((item&&(item.code||item.id))||'').toUpperCase();return code.indexOf('DITRE')>=0;}
  ${productionSource}
  return {state:violationUiState,newId:newStableViolationRequestId,ensureQuick:ensureQuickRequestId,quickPayload:quickOfficialPayload,newMultiRow:multiDayRowDefault,multiPayload:multiOfficialPayload};
`);

const runtime = makeRuntime(assert);

runtime.state.selected.C1 = {selected:true,note:'Noi dung loi 1',time:'09:00'};
const quickId = runtime.ensureQuick('C1');
assert.ok(quickId, 'Quick logical row must receive a request_id before save');
const quickFirst = runtime.quickPayload();
const quickRetry = runtime.quickPayload();
assert.strictEqual(quickFirst.violations[0].requestId, quickRetry.violations[0].requestId, 'Quick retry must reuse request_id');
assert.strictEqual(quickFirst.__evidenceLinks[0].requestId, quickId, 'Quick evidence must use the same stable request_id');

delete runtime.state.selected.C1;
runtime.state.selected.C1 = {selected:true,note:'Logical violation moi',time:'10:00'};
const nextQuickId = runtime.ensureQuick('C1');
assert.notStrictEqual(nextQuickId, quickId, 'Quick successful reset/new logical violation must receive a new request_id');

runtime.state.multiRows = ['C1','C2','C3'].map(function(criterion){const row=runtime.newMultiRow();row.criterion=criterion;row.note='Noi dung '+criterion;return row;});
const originalByRow = new Map(runtime.state.multiRows.map(row => [row.id, row.requestId]));
assert.strictEqual(new Set(originalByRow.values()).size, 3, 'Three Multi logical rows must receive three unique request_ids');
const multiFirst = runtime.multiPayload();
const multiRetry = runtime.multiPayload();
assert.deepStrictEqual(multiRetry.violations.map(row => row.requestId), multiFirst.violations.map(row => row.requestId), 'Multi retry must preserve every request_id');

runtime.state.multiRows.reverse();
runtime.multiPayload();
runtime.state.multiRows.forEach(row => assert.strictEqual(row.requestId, originalByRow.get(row.id), 'Reorder must preserve row identity'));

const removed = runtime.state.multiRows.splice(1, 1)[0];
runtime.multiPayload();
runtime.state.multiRows.forEach(row => assert.strictEqual(row.requestId, originalByRow.get(row.id), 'Removing one row must preserve remaining request_ids'));
const added = runtime.newMultiRow();added.criterion='C1';added.note='Dong moi';runtime.state.multiRows.push(added);
assert.ok(!originalByRow.has(added.id) && !new Set(originalByRow.values()).has(added.requestId), 'Only the newly added Multi row receives a new request_id');
assert.ok(removed.requestId, 'Removed row had its own stable request_id');

assert.ok(/quickSelectedIds\(\)\.forEach\(ensureQuickRequestId\)/.test(app), 'Quick draft save/restore upgrades and persists stable IDs');
assert.ok(/requestId:newStableViolationRequestId\('MULTI'\)/.test(app), 'Multi row factory creates request_id at logical row creation');
assert.ok(!/requestId:batch\+'-'\+String\(index\+1\)/.test(productionFunction('quickOfficialPayload')), 'Quick payload no longer derives request_id from submit batch/index');
assert.ok(!/requestId:batch\+'-'\+String\(index\+1\)/.test(productionFunction('multiOfficialPayload')), 'Multi payload no longer derives request_id from submit batch/index');

console.log('PASS: stable request_id production helpers/payloads - Quick and Multi (20 assertions).');
