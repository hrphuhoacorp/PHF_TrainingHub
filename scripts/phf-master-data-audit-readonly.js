'use strict';

/* READ-ONLY audit for the master-data source-of-truth investigation.
   Touches nothing. Compares row counts/columns across the 4 tables that
   currently hold some form of "employee identity/organization" data:
   public.employees (legacy), public.checklist_employee_assignments
   (Checklist-owned, read by KNL and by Employee Master's own org merge),
   public.user_accounts (login identity), public.employee_profiles
   (Employee Master's own additive layer, incl. hire_date/official_date). */

require('dotenv').config();
const {createClient}=require('@supabase/supabase-js');
const url=String(process.env.SUPABASE_URL||'').trim();
const secret=String(process.env.SUPABASE_SECRET_KEY||'').trim();
if(!url||!secret){console.error('Missing Supabase env');process.exit(1);}
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

async function safe(table,select){
  const r=await db.from(table).select(select||'*');
  if(r.error)return{table,ok:false,error:r.error.message,rows:[]};
  return{table,ok:true,rows:r.data||[]};
}

(async()=>{
  const [employees,checklistAssign,userAccounts,employeeProfiles]=await Promise.all([
    safe('employees','id,phone,hire_date,study_start_date'),
    safe('checklist_employee_assignments','employee_code,employee_name,department,title,branch,employee_status,manager_name'),
    safe('user_accounts','employee_code,employee_id,name,status,role,department,branch,position'),
    safe('employee_profiles','employee_code,employee_id,full_name,hire_date,official_date,employment_status')
  ]);

  [employees,checklistAssign,userAccounts,employeeProfiles].forEach(r=>{
    console.log(`\n=== ${r.table} ===`);
    if(!r.ok){console.log('  ERROR/MISSING:',r.error);return;}
    console.log('  rows:',r.rows.length);
    if(r.table==='employees'){
      const withHire=r.rows.filter(x=>x.hire_date).length;
      const withStudyStart=r.rows.filter(x=>x.study_start_date).length;
      console.log('  with hire_date:',withHire,' with study_start_date:',withStudyStart);
      console.log('  sample:',r.rows.slice(0,3));
    }
    if(r.table==='checklist_employee_assignments'){
      const byStatus={};
      r.rows.forEach(x=>{const s=x.employee_status||'(null)';byStatus[s]=(byStatus[s]||0)+1;});
      console.log('  by employee_status:',byStatus);
      console.log('  sample:',r.rows.slice(0,3));
    }
    if(r.table==='employee_profiles'){
      const withHire=r.rows.filter(x=>x.hire_date).length;
      console.log('  with hire_date populated:',withHire,'/',r.rows.length);
      console.log('  sample:',r.rows.slice(0,5));
    }
    if(r.table==='user_accounts'){
      console.log('  sample:',r.rows.slice(0,3));
    }
  });

  // Cross-reference employee_code sets
  const codesOf=rows=>new Set(rows.map(x=>String(x.employee_code||'').trim().toUpperCase()).filter(Boolean));
  const cEmployees=employees.ok?new Set():new Set(); // employees table has no employee_code column selected; skip
  const cChecklist=checklistAssign.ok?codesOf(checklistAssign.rows):new Set();
  const cAccounts=userAccounts.ok?codesOf(userAccounts.rows):new Set();
  const cProfiles=employeeProfiles.ok?codesOf(employeeProfiles.rows):new Set();
  console.log('\n=== employee_code universe ===');
  console.log('checklist_employee_assignments distinct codes:',cChecklist.size);
  console.log('user_accounts distinct codes:',cAccounts.size);
  console.log('employee_profiles distinct codes:',cProfiles.size);
  const inChecklistNotProfiles=[...cChecklist].filter(c=>!cProfiles.has(c));
  console.log('in checklist but no employee_profiles row yet:',inChecklistNotProfiles.length);

  // ---- File reconciliation: paste of the 41-row table from the user's attached file ----
  const fileRows=[
    ['ADMIN','ADMIN',''],
    ['PHF002','Trần Thu Thủy','2019-10-29'],
    ['PHF018','Nguyễn Thị Lệ','2023-09-15'],
    ['PHF020','Trần Thị Phương Huỳnh','2022-06-28'],
    ['PHF041','Đặng Thị Diễm','2024-08-16'],
    ['PHF042','Nguyễn Hoàng Khang','2024-12-23'],
    ['PHF060','Nguyễn Thiên Trúc','2025-07-10'],
    ['PHF076','Võ Phương Diệu','2026-03-23'],
    ['PHF077','Phạm Thị Như Quỳnh','2026-03-27'],
    ['PHF078','Châu Quỳnh Như','2026-03-27'],
    ['PHF079','Nguyễn Thanh Lợi','2026-03-30'],
    ['PHF082','Lý Minh Phước','2026-04-16'],
    ['PHF084','Đặng Thị Duy','2026-04-18'],
    ['PHF085','Nguyễn Thị Huyền','2026-04-22'],
    ['PHF087','Trịnh Đình Trường','2026-05-12'],
    ['PHF089','Lê Bình Phương Uyên','2026-05-15'],
    ['PHF091','Phan Thị Cẩm Tiên','2026-06-06'],
    ['PHF092','Huỳnh Nhật Toàn','2026-06-29'],
    ['PHF026','Đinh Thị Như Quyên','2023-05-03'],
    ['PHF081','Trần Châu Phương Dung','2026-04-10'],
    ['PHF090','Nguyễn Thị Khánh Vân','2026-05-16'],
    ['PHF036','Trần Trung Hải','2023-09-02'],
    ['PHF038','Dương Sô Phát','2025-02-28'],
    ['PHF080','Nguyễn Thị Trúc Ly','2026-04-09'],
    ['PHF005','Nguyễn Minh Nhật','2024-04-12'],
    ['PHF034','Nguyễn Duy Hải','2022-11-23'],
    ['PHF035','Trần Văn Út','2025-06-05'],
    ['PHF064','Hà Thị Lan','2025-09-15'],
    ['PHF073','Nguyễn Huỳnh Phước Huy','2026-03-05'],
    ['PHF012','Lê Vĩnh Thắng','2025-04-03'],
    ['PHF007','Nguyễn Thị Bích','2025-02-18'],
    ['PHF008','Nguyễn Ngọc Diệu Linh','2025-06-04'],
    ['PHF056','Lê Ngọc Diễm','2025-06-23'],
    ['PHF071','Hà Viết Nguyên Thanh','2025-11-24'],
    ['PHF051','Trịnh Thị Ngọc Linh','2025-06-16'],
    ['PHF028','Tạ Ngọc Linh Thi','2019-01-01'],
    ['PHF069','Lê Thị Thanh Chúc','2025-11-03'],
    ['PHF004','Trần Gia Bảo Ngọc','2019-10-29'],
    ['PHF010','Nguyễn Thủy Tiên','2019-02-05'],
    ['PHF032','Trần Hữu Vinh','2021-07-02'],
    ['PHF093','Nguyễn Vương Thu Minh','2026-08-05']
  ];

  const profileByCode=new Map((employeeProfiles.ok?employeeProfiles.rows:[]).map(r=>[String(r.employee_code||'').trim().toUpperCase(),r]));
  const masterCodeUniverse=new Set([...cChecklist,...cAccounts]); // "exists in Employee Master's merged view" proxy

  const results={MATCHED:[],SYSTEM_ONLY:[],FILE_ONLY:[],CONFLICT:[]};
  const fileCodes=new Set();
  fileRows.forEach(([code,name,dateStr])=>{
    if(code==='ADMIN')return; // not a real employee row
    fileCodes.add(code);
    const inMaster=masterCodeUniverse.has(code);
    const profile=profileByCode.get(code);
    if(!inMaster){results.FILE_ONLY.push({code,name,dateStr});return;}
    results.MATCHED.push({code,name,dateStr,currentHireDate:profile?profile.hire_date:null,hasProfileRow:!!profile});
  });
  masterCodeUniverse.forEach(code=>{
    if(!fileCodes.has(code))results.SYSTEM_ONLY.push({code});
  });

  console.log('\n=== FILE RECONCILIATION (StartWorkDate) ===');
  console.log('MATCHED:',results.MATCHED.length,'FILE_ONLY:',results.FILE_ONLY.length,'SYSTEM_ONLY (in master, not in file):',results.SYSTEM_ONLY.length);
  const sameDate=results.MATCHED.filter(x=>x.currentHireDate===x.dateStr);
  const emptyCanFill=results.MATCHED.filter(x=>!x.currentHireDate);
  const diffReview=results.MATCHED.filter(x=>x.currentHireDate&&x.currentHireDate!==x.dateStr);
  console.log('  SAME_DATE:',sameDate.length);
  console.log('  EMPTY_SYSTEM_CAN_FILL:',emptyCanFill.length);
  console.log('  DIFFERENT_DATE_REVIEW:',diffReview.length);
  if(diffReview.length)console.log('  DIFFERENT_DATE_REVIEW rows:',diffReview);
  if(results.FILE_ONLY.length)console.log('  FILE_ONLY rows:',results.FILE_ONLY);
  console.log('  EMPTY_SYSTEM_CAN_FILL rows (first 10):',emptyCanFill.slice(0,10));
})().catch(e=>{console.error('FAIL',e&&e.stack||e);process.exit(1);});
