'use strict';
const {syncMonthlyCycle}=require('./_lib/checklist-monthly');
function send(res,status,body){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body));}
module.exports=async function handler(req,res){
 if(req.method!=='POST'&&req.method!=='GET')return send(res,405,{ok:false,message:'Method not allowed'});
 const expected=String(process.env.CHECKLIST_CRON_SECRET||'').trim();
 const auth=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
 if(!expected||auth!==expected)return send(res,401,{ok:false,message:'Cron secret không hợp lệ.'});
 try{
  const month=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit'}).format(new Date()).replace('/','-');
  const session={role:'admin',sub:'system-checklist-cron',account:{id:'system-checklist-cron',name:'PHF Checklist Scheduler',employeeCode:'SYSTEM'}};
  const result=await syncMonthlyCycle(session,{month,automatic:true});
  return send(res,200,{ok:true,month,...result});
 }catch(error){console.error('[PHF Checklist cron]',error);return send(res,500,{ok:false,message:error&&error.message||'Không thể đồng bộ kỳ tự động.'});}
};
