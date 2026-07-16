'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SECRET_KEY || '').trim();

  if (!url || !key) {
    throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SECRET_KEY trong file .env.');
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { count, error } = await supabase
    .from('user_accounts')
    .select('*', { count: 'exact', head: true });

  if (error) throw error;

  console.log('');
  console.log('BẢNG TÀI KHOẢN SUPABASE ĐÃ SẴN SÀNG');
  console.log(`Số tài khoản hiện có: ${count || 0}`);
  console.log('');
  console.log('Lưu ý: 0 tài khoản ở bước này là bình thường.');
  console.log('Bước tiếp theo sẽ chuyển API đăng nhập và tài khoản hiện có sang bảng này.');
  console.log('');
}

main().catch(error => {
  console.error('');
  console.error('CHƯA SẴN SÀNG:', error && error.message ? error.message : String(error));
  console.error('');
  process.exit(1);
});
