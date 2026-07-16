'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!url || !key) throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SECRET_KEY trong .env.');

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { count, error } = await supabase
    .from('commitment_records')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('\nCHƯA SẴN SÀNG:', error.message);
    console.error('Hãy chạy scripts/phf_supabase_commitment_records.sql trong Supabase SQL Editor.\n');
    process.exit(1);
  }

  const { data: rows, error: sampleError } = await supabase
    .from('commitment_records')
    .select('id, employee_id, document_version, confirmed_at, status')
    .order('confirmed_at', { ascending: false })
    .limit(5);

  if (sampleError) throw sampleError;

  console.log('\nBẢNG BMTT ĐÃ SẴN SÀNG');
  console.log(`Tổng hồ sơ: ${count || 0}`);
  console.log('5 hồ sơ gần nhất:');
  console.table(rows || []);
  console.log('');
}

main().catch(error => {
  console.error('\nKHÔNG THỂ KIỂM TRA:', error && error.message ? error.message : String(error), '\n');
  process.exit(1);
});
