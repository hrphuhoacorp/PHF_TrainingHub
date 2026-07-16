'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function countRows(supabase, table, filterColumn, filterValue) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  if (filterColumn) query = query.eq(filterColumn, filterValue);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function main() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!url || !key) {
    throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SECRET_KEY trong .env.');
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const [legacyCount, commitmentCount] = await Promise.all([
    countRows(supabase, 'activity_log', 'type', 'confidentiality-commitment'),
    countRows(supabase, 'commitment_records')
  ]);

  console.log('');
  console.log('KIỂM TRA DỌN BMTT CŨ');
  console.log(`BMTT cũ còn trong activity_log: ${legacyCount}`);
  console.log(`Hồ sơ trong commitment_records: ${commitmentCount}`);
  console.log('');

  if (commitmentCount < 1) {
    console.error('CHƯA ĐẠT: commitment_records chưa có hồ sơ.');
    process.exit(1);
  }

  if (legacyCount > 0) {
    console.error('CHƯA DỌN XONG: vẫn còn BMTT cũ trong activity_log.');
    console.error('Hãy chạy scripts/phf_supabase_cleanup_legacy_bmtt.sql trong Supabase SQL Editor.');
    process.exit(2);
  }

  console.log('ĐÃ DỌN XONG AN TOÀN');
  console.log('BMTT hiện chỉ sử dụng bảng commitment_records.');
  console.log('');
}

main().catch(error => {
  console.error('');
  console.error('KHÔNG THỂ KIỂM TRA:', error && error.message ? error.message : String(error));
  console.error('');
  process.exit(1);
});
