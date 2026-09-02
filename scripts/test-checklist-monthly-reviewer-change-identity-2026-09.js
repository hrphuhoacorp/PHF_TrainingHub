'use strict';
/*
 * Regression Test — Bug Round 2
 * Checklist Monthly — changeMonthlyReviewer() must chốt đúng người thẩm định vừa CHỌN
 * (theo employee_code), không để một reviewerId yếu (manager_id/employee_id do client
 * cấu hình — không duy nhất, có thể rỗng/cũ) chốt nhầm về người thẩm định cũ.
 *
 * PROD symptom: Admin chọn PHF042 (Nguyễn Hoàng Khang), confirm -> toast + bảng vẫn
 * hiện PHF012 (Lê Vĩnh Thắng) ngay lập tức, không cần F5.
 *
 * In-memory only. Chặn @supabase/supabase-js. KHÔNG chạm Supabase thật.
 *   node scripts/test-checklist-monthly-reviewer-change-identity-2026-09.js
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}

const FORM_ID = 'form-phf082-2026-09';
const store = {
  checklist_monthly_forms: [
    { id: FORM_ID, period_month: '2026-09', status: 'draft', employee_id: 'e-082', employee_code: 'PHF082', employee_name: 'Lý Minh Phước',
      reviewer_id: 'e-012', reviewer_code: 'PHF012', reviewer_name: 'Lê Vĩnh Thắng', updated_at: '2026-09-01T00:00:00Z' }
  ],
  // PHF042 tồn tại như một NHÂN VIÊN có phân công. manager_id của các dòng khác trỏ lung tung.
  checklist_employee_assignments: [
    // PHF082: manager slot còn STALE = PHF012, và manager_id rỗng.
    { employee_key:'phf082', employee_id:'e-082', employee_code:'PHF082', employee_name:'Lý Minh Phước', manager_id:'', manager_code:'PHF012', manager_name:'Lê Vĩnh Thắng', employee_status:'Đang làm việc' },
    // PHF012 là nhân viên.
    { employee_key:'phf012', employee_id:'e-012', employee_code:'PHF012', employee_name:'Lê Vĩnh Thắng', manager_id:'', manager_code:'', manager_name:'', employee_status:'Đang làm việc' },
    // PHF042 là nhân viên — đây là nguồn code chuẩn.
    { employee_key:'phf042', employee_id:'e-042', employee_code:'PHF042', employee_name:'Nguyễn Hoàng Khang', manager_id:'', manager_code:'', manager_name:'', employee_status:'Đang làm việc' },
    // Một dòng khác có manager = PHF042 nhưng manager_id rỗng (tạo option code-rỗng ở bản cũ).
    { employee_key:'phf099', employee_id:'e-099', employee_code:'PHF099', employee_name:'NV Chín Chín', manager_id:'', manager_code:'PHF042', manager_name:'Nguyễn Hoàng Khang', employee_status:'Đang làm việc' }
  ]
};

class FakeQuery {
  constructor(t){this.table=t;this.filters=[];this._single=null;this._limit=null;}
  select(){return this;}
  eq(c,v){this.filters.push(r=>String(r[c])===String(v));return this;}
  neq(c,v){this.filters.push(r=>String(r[c])!==String(v));return this;}
  in(c,a){const s=new Set((a||[]).map(String));this.filters.push(r=>s.has(String(r[c])));return this;}
  order(){return this;}
  limit(n){this._limit=n;return this;}
  range(){return this;}
  maybeSingle(){this._single='maybe';return this;}
  single(){this._single='strict';return this;}
  then(res,rej){
    let rows=clone((store[this.table]||[]).filter(r=>this.filters.every(f=>f(r))));
    if(this._limit!=null)rows=rows.slice(0,this._limit);
    let p;
    if(this._single==='maybe')p={data:rows[0]||null,error:null};
    else if(this._single==='strict')p=rows.length?{data:rows[0],error:null}:{data:null,error:{message:'No rows'}};
    else p={data:rows,error:null};
    return Promise.resolve(p).then(res,rej);
  }
}
const rpcCalls=[];
async function fakeRpc(name,p){
  if(name!=='change_checklist_monthly_reviewer')return {data:null,error:{message:'unmocked rpc '+name}};
  rpcCalls.push(clone(p));
  const form=store.checklist_monthly_forms.find(f=>f.id===p.p_form_id);
  const before={reviewerId:form.reviewer_id||'',reviewerCode:(form.reviewer_code||'').toUpperCase(),reviewerName:form.reviewer_name||''};
  form.reviewer_id=p.p_reviewer_id||'';form.reviewer_code=(p.p_reviewer_code||'').toUpperCase();form.reviewer_name=p.p_reviewer_name||'';
  return {data:{ok:true,before,after:{reviewerId:form.reviewer_id,reviewerCode:form.reviewer_code,reviewerName:form.reviewer_name}},error:null};
}
const orig=Module._load;
Module._load=function(req){
  if(req==='@supabase/supabase-js')return {createClient:()=>({from:t=>new FakeQuery(t),rpc:(n,p)=>fakeRpc(n,p)})};
  return orig.apply(this,arguments);
};
const lib=require(path.join(__dirname,'..','api','_lib','checklist-monthly.js'));
Module._load=orig;

const ADMIN={role:'admin',account:{id:'admin-1',name:'Admin Test'},sub:'admin-1'};
let fails=0;
async function rec(name,fn){try{await fn();console.log('PASS -',name);}catch(e){fails++;console.log('FAIL -',name,'\n  '+(e&&e.message||e));}}

async function main(){
  // Payload mô phỏng dropdown: user chọn PHF042. Bản lỗi để reviewerId rỗng / hoặc trỏ nhầm.
  await rec('reviewerId rỗng + reviewerCode=PHF042 -> RPC nhận đúng PHF042 / Nguyễn Hoàng Khang', async()=>{
    rpcCalls.length=0;
    const out=await lib.changeMonthlyReviewer(ADMIN,{formId:FORM_ID,reviewerId:'',reviewerCode:'PHF042',reviewerName:'Nguyễn Hoàng Khang',reason:'đổi người thẩm định cho đúng quản lý'});
    assert.strictEqual(rpcCalls.length,1,'phải gọi RPC 1 lần');
    assert.strictEqual(rpcCalls[0].p_reviewer_code,'PHF042');
    assert.strictEqual(rpcCalls[0].p_reviewer_name,'Nguyễn Hoàng Khang');
    assert.strictEqual(out.after.reviewerCode,'PHF042');
    assert.strictEqual(out.after.reviewerName,'Nguyễn Hoàng Khang');
    assert.notStrictEqual(out.after.reviewerName,'Lê Vĩnh Thắng');
  });

  await rec('reviewerId trỏ NHẦM sang e-012 nhưng reviewerCode=PHF042 -> code thắng, chốt PHF042', async()=>{
    store.checklist_monthly_forms[0].reviewer_id='e-012';store.checklist_monthly_forms[0].reviewer_code='PHF012';store.checklist_monthly_forms[0].reviewer_name='Lê Vĩnh Thắng';
    rpcCalls.length=0;
    const out=await lib.changeMonthlyReviewer(ADMIN,{formId:FORM_ID,reviewerId:'e-012',reviewerCode:'PHF042',reviewerName:'Nguyễn Hoàng Khang',reason:'đổi người thẩm định cho đúng quản lý'});
    assert.strictEqual(rpcCalls[0].p_reviewer_code,'PHF042');
    assert.strictEqual(out.after.reviewerName,'Nguyễn Hoàng Khang');
  });

  await rec('DB row sau RPC = PHF042 (không rơi về PHF012)', async()=>{
    assert.strictEqual(store.checklist_monthly_forms[0].reviewer_code,'PHF042');
    assert.strictEqual(store.checklist_monthly_forms[0].reviewer_name,'Nguyễn Hoàng Khang');
  });

  await rec('reviewerCode không tồn tại -> báo lỗi rõ, KHÔNG ghi', async()=>{
    rpcCalls.length=0;
    let threw=null;try{await lib.changeMonthlyReviewer(ADMIN,{formId:FORM_ID,reviewerId:'',reviewerCode:'PHF999',reviewerName:'Ai Đó',reason:'thử người không tồn tại'});}catch(e){threw=e;}
    assert.ok(threw&&/không còn tồn tại/i.test(threw.message||''),'phải fail NOT_FOUND');
    assert.strictEqual(rpcCalls.length,0);
  });

  console.log(fails?('\n'+fails+' FAIL'):'\nALL PASS');
  process.exit(fails?1:0);
}
main().catch(e=>{console.error(e);process.exit(1);});
