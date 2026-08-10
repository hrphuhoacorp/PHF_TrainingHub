'use strict';

/* PHF KNL 1.50.3 — Controlled Production mutation smoke for the compensation
   versioning CRUD RPCs. Per explicit decision: knl_schedule_compensation_version
   is NEVER called against Production here (the immutable-once-non-DRAFT guard
   means a fixture that actually schedules can never be cleaned up again) — its
   coverage stays static (OpenAPI visibility + SQL review + contract test).
   Everything this script mutates is either (a) a disposable clone/grades/audit
   fixture fully deleted in the finally block while it is still DRAFT, or
   (b) a disposable employee assignment on a fake employee_code + far-future
   payroll_period that never collides with the 36 real baseline rows. */

require('dotenv').config();
const assert=require('assert');
const {createClient}=require('@supabase/supabase-js');

const url=String(process.env.SUPABASE_URL||'').trim();
const secret=String(process.env.SUPABASE_SECRET_KEY||'').trim();
assert(url&&secret,'Supabase Production environment is required.');
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const ACTOR_ID='compensation-crud-smoke-1.50.3';
const ACTOR_NAME='PHF KNL Compensation CRUD Smoke';
const SMOKE_EMPLOYEE='SMOKE-COMP-CRUD-1503';
const SMOKE_PERIOD='2099-11';
function check(error,label){if(error)throw new Error(label+': '+(error.message||JSON.stringify(error)));}
function sortGrades(rows){return rows.slice().sort((a,b)=>a.grade_number-b.grade_number);}

let clonedVersionId=null;
let assignmentId=null;

(async()=>{
  const preflight=await db.from('knl_employee_compensation_assignments').select('id').eq('employee_code',SMOKE_EMPLOYEE);
  check(preflight.error,'preflight');assert.strictEqual(preflight.data.length,0,'stale employee assignment smoke fixture exists');

  const {data:baselineLadders,error:ladderErr}=await db.from('knl_compensation_ladders').select('id,code').order('code').limit(1);
  check(ladderErr,'baseline ladder');assert.strictEqual(baselineLadders.length,1,'no baseline ladder to clone from');
  const ladder=baselineLadders[0];
  const {data:baselineVersionRow,error:versionErr}=await db.from('knl_compensation_versions').select('*').eq('ladder_id',ladder.id).eq('status','ACTIVE').single();
  check(versionErr,'baseline active version');
  const baselineVersionId=baselineVersionRow.id;
  const {data:baselineGradesBefore,error:gradesBeforeErr}=await db.from('knl_compensation_grades').select('*').eq('version_id',baselineVersionId);
  check(gradesBeforeErr,'baseline grades before');
  const baselineGradesSnapshot=sortGrades(baselineGradesBefore);

  try{
    /* ===== STEP A: clone Active -> Draft ===== */
    const cloneResult=await db.rpc('knl_clone_compensation_version',{p_source_version_id:baselineVersionId,p_name:'SMOKE 1.50.3 clone — safe to delete',p_actor_id:ACTOR_ID,p_actor_name:ACTOR_NAME});
    check(cloneResult.error,'clone RPC');
    clonedVersionId=cloneResult.data.id;
    assert.strictEqual(cloneResult.data.status,'DRAFT','clone must produce a DRAFT version');
    assert.strictEqual(cloneResult.data.ladder_id,ladder.id,'clone must stay on the source ladder');
    assert.strictEqual(cloneResult.data.based_on_version_id,baselineVersionId,'clone must record lineage');
    assert.strictEqual(cloneResult.data.effective_period,null,'clone must not inherit an effective period');

    const {data:clonedGradesRaw,error:clonedGradesErr}=await db.from('knl_compensation_grades').select('*').eq('version_id',clonedVersionId);
    check(clonedGradesErr,'cloned grades');
    const clonedGrades=sortGrades(clonedGradesRaw);
    assert.strictEqual(clonedGrades.length,baselineGradesSnapshot.length,'clone must copy every grade row');
    clonedGrades.forEach((g,i)=>{
      const source=baselineGradesSnapshot[i];
      assert.strictEqual(g.grade_code,source.grade_code);assert.strictEqual(g.grade_number,source.grade_number);
      assert.strictEqual(Number(g.base_salary),Number(source.base_salary));assert.strictEqual(Number(g.hqcv),Number(source.hqcv));
      assert.strictEqual(Number(g.professional_allowance),Number(source.professional_allowance));
      assert.strictEqual(Number(g.management_allowance),Number(source.management_allowance));
      assert.notStrictEqual(g.id,source.id,'clone must mint new grade ids, never reuse source ids');
    });

    const cloneAudit=await db.from('knl_compensation_audit').select('*').eq('entity_type','compensation_version').eq('entity_id',clonedVersionId).eq('action','clone');
    check(cloneAudit.error,'clone audit');
    assert.strictEqual(cloneAudit.data.length,1,'exactly one clone audit row expected');
    assert.strictEqual(cloneAudit.data[0].before_data.sourceVersionNumber,baselineVersionRow.version_number,'audit must trace source version number');
    assert.strictEqual(cloneAudit.data[0].after_data.grades,clonedGrades.length,'audit must record cloned grade count');

    /* Source must be byte-for-byte unchanged by clone */
    const {data:baselineVersionAfterClone,error:vAfterCloneErr}=await db.from('knl_compensation_versions').select('*').eq('id',baselineVersionId).single();
    check(vAfterCloneErr,'baseline version after clone');
    assert.strictEqual(baselineVersionAfterClone.status,'ACTIVE');assert.strictEqual(baselineVersionAfterClone.updated_at,baselineVersionRow.updated_at,'clone must not touch the source version row');

    /* ===== STEP B: edit Draft grades ===== */
    const editedPayload=clonedGrades.map(g=>({id:g.id,baseSalary:Number(g.base_salary)+1000,hqcv:Number(g.hqcv)+500,professionalAllowance:Number(g.professional_allowance),managementAllowance:Number(g.management_allowance)}));
    const saveResult=await db.rpc('knl_save_compensation_grades',{p_version_id:clonedVersionId,p_grades:editedPayload,p_actor_id:ACTOR_ID,p_actor_name:ACTOR_NAME});
    check(saveResult.error,'save-grades RPC');
    assert.strictEqual(saveResult.data.grades,editedPayload.length,'save-grades must report the full grade count');

    const {data:clonedGradesAfterEdit,error:afterEditErr}=await db.from('knl_compensation_grades').select('*').eq('version_id',clonedVersionId);
    check(afterEditErr,'cloned grades after edit');
    const editedById=new Map(sortGrades(clonedGradesAfterEdit).map(g=>[g.id,g]));
    editedPayload.forEach(p=>{
      const row=editedById.get(p.id);
      assert.strictEqual(Number(row.base_salary),p.baseSalary,'edited LCB must persist');
      assert.strictEqual(Number(row.hqcv),p.hqcv,'edited HQCV must persist');
    });

    const gradesAudit=await db.from('knl_compensation_audit').select('*').eq('entity_type','compensation_grades').eq('entity_id',clonedVersionId).eq('action','update');
    check(gradesAudit.error,'grades-edit audit');
    assert.strictEqual(gradesAudit.data.length,1,'exactly one grades-edit audit row expected');

    /* Source grades must remain untouched by the Draft edit */
    const {data:baselineGradesAfterEdit,error:gradesAfterEditErr}=await db.from('knl_compensation_grades').select('*').eq('version_id',baselineVersionId);
    check(gradesAfterEditErr,'baseline grades after edit');
    const baselineAfter=sortGrades(baselineGradesAfterEdit);
    baselineAfter.forEach((g,i)=>{
      assert.strictEqual(Number(g.base_salary),Number(baselineGradesSnapshot[i].base_salary));
      assert.strictEqual(Number(g.hqcv),Number(baselineGradesSnapshot[i].hqcv));
      assert.strictEqual(g.updated_at,baselineGradesSnapshot[i].updated_at,'baseline grade rows must not be touched by Draft edits');
    });

    /* ===== STEP C: guard rejections — zero side effects, no schedule/activate call ===== */
    const countMismatch=await db.rpc('knl_save_compensation_grades',{p_version_id:clonedVersionId,p_grades:editedPayload.slice(0,-1),p_actor_id:ACTOR_ID,p_actor_name:ACTOR_NAME});
    assert(countMismatch.error,'dropping a grade row must be rejected');
    assert(/KNL_COMPENSATION_GRADES_COUNT_MISMATCH/.test(countMismatch.error.message),'must reject with COUNT_MISMATCH, got: '+countMismatch.error.message);

    const activeImmutable=await db.rpc('knl_save_compensation_grades',{p_version_id:baselineVersionId,p_grades:[],p_actor_id:ACTOR_ID,p_actor_name:ACTOR_NAME});
    assert(activeImmutable.error,'editing an ACTIVE baseline version must be rejected');
    assert(/KNL_COMPENSATION_VERSION_IMMUTABLE/.test(activeImmutable.error.message),'must reject with VERSION_IMMUTABLE, got: '+activeImmutable.error.message);

    const cloneNotFound=await db.rpc('knl_clone_compensation_version',{p_source_version_id:'00000000-0000-4000-8000-000000000000',p_actor_id:ACTOR_ID,p_actor_name:ACTOR_NAME});
    assert(cloneNotFound.error,'cloning a non-existent version must be rejected');
    assert(/KNL_COMPENSATION_VERSION_NOT_FOUND/.test(cloneNotFound.error.message),'must reject with VERSION_NOT_FOUND, got: '+cloneNotFound.error.message);

    /* Re-verify the guard rejections left the fixture and baseline exactly as they were */
    const {data:clonedVersionAfterGuards,error:cloneGuardErr}=await db.from('knl_compensation_versions').select('status').eq('id',clonedVersionId).single();
    check(cloneGuardErr,'cloned version after guard tests');
    assert.strictEqual(clonedVersionAfterGuards.status,'DRAFT','fixture must remain DRAFT (still deletable) after guard-rejection tests');
    const {data:baselineVersionAfterGuards,error:vAfterGuardErr}=await db.from('knl_compensation_versions').select('*').eq('id',baselineVersionId).single();
    check(vAfterGuardErr,'baseline version after guard tests');
    assert.strictEqual(baselineVersionAfterGuards.updated_at,baselineVersionRow.updated_at,'rejected mutation attempt must not touch the baseline ACTIVE version');

    console.log('PASS clone -> Draft, edit Draft grades, source immutability, and all guard rejections (count-mismatch / Active-immutable / not-found).');

    /* ===== STEP D: Admin employee assignment CRUD on a fixture employee/period, against a REAL Active grade (read-only reference) ===== */
    const referenceGrade=baselineGradesSnapshot[0];
    const created=await db.rpc('knl_save_employee_compensation',{
      p_employee_code:SMOKE_EMPLOYEE,p_employee_name:'Compensation CRUD Smoke',p_employment_type:'OFFICIAL',p_payroll_period:SMOKE_PERIOD,
      p_grade_id:referenceGrade.id,p_has_professional:true,p_has_management:false,p_has_meal:true,p_meal_amount:910000,
      p_probation_amount:0,p_extra_allowances:[{name:'Phụ cấp smoke',amount:'50000'}],p_organization_snapshot:{smoke:true},
      p_reason:'PHF KNL 1.50.3 compensation CRUD smoke — create',p_actor_id:ACTOR_ID,p_actor_name:ACTOR_NAME
    });
    check(created.error,'assignment create RPC');
    assignmentId=created.data.assignmentId;
    const expectedCreateTotal=Number(referenceGrade.base_salary)+Number(referenceGrade.hqcv)+Number(referenceGrade.professional_allowance)+910000+50000;
    assert.strictEqual(Number(created.data.referenceTotal),expectedCreateTotal,'reference total must equal master lookup sum, no personal override');

    const {data:assignmentRow,error:assignmentRowErr}=await db.from('knl_employee_compensation_assignments').select('*').eq('id',assignmentId).single();
    check(assignmentRowErr,'assignment row');
    assert.strictEqual(assignmentRow.compensation_grade_id,referenceGrade.id,'assignment must reference the real master grade, no copy');
    assert.strictEqual(assignmentRow.structure_snapshot.baseSalary,Number(referenceGrade.base_salary),'snapshot LCB must be looked up from master, not entered manually');
    assert.strictEqual(assignmentRow.has_management_allowance,false,'unchecked PC quản lý must not be applied');

    const historyAfterCreate=await db.from('knl_employee_compensation_history').select('*').eq('assignment_id',assignmentId).order('changed_at');
    check(historyAfterCreate.error,'history after create');
    assert.strictEqual(historyAfterCreate.data.length,1);assert.strictEqual(historyAfterCreate.data[0].action,'CREATE');

    const updated=await db.rpc('knl_save_employee_compensation',{
      p_employee_code:SMOKE_EMPLOYEE,p_employee_name:'Compensation CRUD Smoke',p_employment_type:'OFFICIAL',p_payroll_period:SMOKE_PERIOD,
      p_grade_id:referenceGrade.id,p_has_professional:true,p_has_management:true,p_has_meal:false,p_meal_amount:0,
      p_probation_amount:0,p_extra_allowances:[],p_organization_snapshot:{smoke:true},
      p_reason:'PHF KNL 1.50.3 compensation CRUD smoke — update same period',p_actor_id:ACTOR_ID,p_actor_name:ACTOR_NAME
    });
    check(updated.error,'assignment update RPC');
    assert.strictEqual(updated.data.assignmentId,assignmentId,'same employee/period must update in place, not duplicate');

    const historyAfterUpdate=await db.from('knl_employee_compensation_history').select('*').eq('assignment_id',assignmentId).order('changed_at');
    check(historyAfterUpdate.error,'history after update');
    assert.strictEqual(historyAfterUpdate.data.length,2,'update must append a second history row, not overwrite');
    assert.strictEqual(historyAfterUpdate.data[1].action,'UPDATE');
    assert.strictEqual(historyAfterUpdate.data[1].before_data.has_meal_allowance,true,'history before_data must snapshot the prior state');

    console.log('PASS employee assignment CRUD: create + update-in-place on a fake employee/period, master lookup, history snapshot (no baseline employee touched).');
  } finally {
    /* ===== Cleanup: employee assignment fixture, then version/grades/audit fixture — in FK-safe order, only while still DRAFT ===== */
    if(assignmentId){
      const historyDelete=await db.from('knl_employee_compensation_history').delete().eq('assignment_id',assignmentId);check(historyDelete.error,'assignment history cleanup');
      const assignmentDelete=await db.from('knl_employee_compensation_assignments').delete().eq('id',assignmentId);check(assignmentDelete.error,'assignment cleanup');
    }
    if(clonedVersionId){
      const auditDelete=await db.from('knl_compensation_audit').delete().eq('entity_id',clonedVersionId);check(auditDelete.error,'fixture audit cleanup');
      const gradesDelete=await db.from('knl_compensation_grades').delete().eq('version_id',clonedVersionId);check(gradesDelete.error,'fixture grades cleanup');
      const versionDelete=await db.from('knl_compensation_versions').delete().eq('id',clonedVersionId);check(versionDelete.error,'fixture version cleanup (only possible while still DRAFT)');
    }
    const remainingAssignment=await db.from('knl_employee_compensation_assignments').select('id').eq('employee_code',SMOKE_EMPLOYEE);check(remainingAssignment.error,'cleanup verification: assignment');
    assert.strictEqual(remainingAssignment.data.length,0,'employee assignment fixture cleanup incomplete');
    const remainingVersion=clonedVersionId?await db.from('knl_compensation_versions').select('id').eq('id',clonedVersionId):{data:[],error:null};
    check(remainingVersion.error,'cleanup verification: version');
    assert.strictEqual(remainingVersion.data.length,0,'version/grades/audit fixture cleanup incomplete');

    const {data:ladders}=await db.from('knl_compensation_ladders').select('id',{count:'exact',head:true});
    const finalCounts={};
    for(const table of ['knl_compensation_ladders','knl_compensation_versions','knl_compensation_grades','knl_employee_compensation_assignments','knl_employee_compensation_history','knl_compensation_audit']){
      const r=await db.from(table).select('*',{head:true,count:'exact'});check(r.error,'final count '+table);finalCounts[table]=Number(r.count||0);
    }
    assert.deepStrictEqual(finalCounts,{knl_compensation_ladders:8,knl_compensation_versions:8,knl_compensation_grades:88,knl_employee_compensation_assignments:36,knl_employee_compensation_history:36,knl_compensation_audit:0},'baseline must be restored exactly after cleanup: '+JSON.stringify(finalCounts));
    console.log('PASS cleanup: all fixtures removed, baseline restored exactly to 8/8/88/36/36/0.');
  }
})().catch(error=>{console.error('FAIL',error.stack||error);process.exitCode=1;});
