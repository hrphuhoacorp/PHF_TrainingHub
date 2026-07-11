'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function count(client, table) {
  const { count, error } = await client.from(table).select('*',{count:'exact',head:true});
  if(error) throw new Error(`${table}: ${error.message}`);
  return count || 0;
}

async function main(){
  const url=String(process.env.SUPABASE_URL||'').trim();
  const key=String(process.env.SUPABASE_SECRET_KEY||'').trim();
  if(!url||!key)throw new Error('Thiếu cấu hình Supabase trong .env.');
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const probation=await count(client,'probation_records');
  const notifications=await count(client,'system_notifications');
  console.log('');
  console.log('MODULE THỬ VIỆC & THÔNG BÁO ĐÃ SẴN SÀNG');
  console.log(`Hồ sơ thử việc: ${probation}`);
  console.log(`Trạng thái thông báo đã lưu: ${notifications}`);
  console.log('');
}
main().catch(e=>{console.error('\nCHƯA SẴN SÀNG:',e.message,'\n');process.exit(1)});
