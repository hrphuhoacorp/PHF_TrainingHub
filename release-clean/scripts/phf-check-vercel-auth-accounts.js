'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!url || !key) throw new Error('Thiếu cấu hình Supabase trong .env.');

  const supabase = createClient(url, key, {
    auth:{persistSession:false,autoRefreshToken:false}
  });

  const { data, error } = await supabase
    .from('user_accounts')
    .select('id,email,name,role,status,last_login_at')
    .order('role', {ascending:true})
    .order('name', {ascending:true});
  if (error) throw error;

  const rows = data || [];
  console.log('');
  console.log('TÀI KHOẢN SUPABASE ĐÃ SẴN SÀNG CHO VERCEL');
  console.log(`Tổng tài khoản: ${rows.length}`);
  console.log(`Admin: ${rows.filter(x => x.role === 'admin').length}`);
  console.log(`Quản lý: ${rows.filter(x => x.role === 'manager').length}`);
  console.log(`Học viên: ${rows.filter(x => x.role === 'learner').length}`);
  console.table(rows);
  console.log('');
}

main().catch(error => {
  console.error('');
  console.error('CHƯA SẴN SÀNG:', error && error.message ? error.message : String(error));
  console.error('');
  process.exit(1);
});
