'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function fail(message) {
  console.error('');
  console.error('KHÔNG THỂ CHUYỂN TÀI KHOẢN:', message);
  console.error('');
  process.exit(1);
}
function cleanEmail(value){ return String(value || '').trim().toLowerCase(); }
function cleanPhone(value){ return String(value || '').replace(/\D/g, ''); }

async function main() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const secret = String(process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!url || !secret) fail('Thiếu SUPABASE_URL hoặc SUPABASE_SECRET_KEY trong .env.');

  const root = path.resolve(__dirname, '..');
  const privateDir = path.resolve(
    String(process.env.PHF_PRIVATE_DIR || '').trim() || path.join(root, 'private')
  );
  const accountsFile = path.join(privateDir, 'accounts.json');

  if (!fs.existsSync(accountsFile)) {
    fail(`Không tìm thấy ${accountsFile}. File này phải còn trên máy local, nhưng không được đưa lên GitHub.`);
  }

  let store;
  try {
    store = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
  } catch {
    fail('Không đọc được private/accounts.json.');
  }

  const source = Array.isArray(store.accounts) ? store.accounts : [];
  const rows = source
    .filter(account =>
      cleanEmail(account.email) &&
      String(account.passwordSalt || '').trim() &&
      String(account.passwordHash || '').trim()
    )
    .map(account => ({
      id:String(account.id || ''),
      employee_id:String(account.employeeId || '') || null,
      employee_code:String(account.employeeCode || ''),
      name:String(account.name || account.email || ''),
      email:cleanEmail(account.email),
      phone:cleanPhone(account.phone),
      role:['learner','manager','admin'].includes(String(account.role || '').toLowerCase())
        ? String(account.role).toLowerCase()
        : 'learner',
      status:['active','locked','inactive'].includes(String(account.status || '').toLowerCase())
        ? String(account.status).toLowerCase()
        : 'active',
      branch:String(account.branch || ''),
      department:String(account.department || ''),
      position:String(account.position || ''),
      training_audience:String(account.trainingAudience || ''),
      default_program:String(account.defaultProgram || ''),
      hub_assignment_status:String(account.hubAssignmentStatus || (String(account.trainingAudience || '') === 'Nhân sự mới' ? 'active' : 'not_activated')),
      must_change_password:!!account.mustChangePassword,
      password_algorithm:String(account.passwordAlgorithm || 'pbkdf2-sha256'),
      password_iterations:Number(account.passwordIterations || 120000),
      password_salt:String(account.passwordSalt),
      password_hash:String(account.passwordHash),
      created_at:String(account.createdAt || new Date().toISOString()),
      updated_at:new Date().toISOString(),
      metadata:{migratedFrom:'private/accounts.json', migratedAt:new Date().toISOString()}
    }));

  if (!rows.length) {
    fail('accounts.json không có tài khoản hợp lệ kèm password hash.');
  }

  const supabase = createClient(url, secret, {
    auth:{persistSession:false,autoRefreshToken:false}
  });

  const { error } = await supabase
    .from('user_accounts')
    .upsert(rows, {onConflict:'id'});
  if (error) throw error;

  const { data, error:readError } = await supabase
    .from('user_accounts')
    .select('id,email,name,role,status')
    .order('role', {ascending:true})
    .order('name', {ascending:true});
  if (readError) throw readError;

  console.log('');
  console.log('CHUYỂN TÀI KHOẢN SANG SUPABASE THÀNH CÔNG');
  console.log(`Đã chuyển từ file local: ${rows.length} tài khoản`);
  console.log(`Tổng tài khoản trên Supabase: ${(data || []).length}`);
  console.table(data || []);
  console.log('');
  console.log('Không xóa private/accounts.json trên máy cho đến khi web Vercel đăng nhập ổn định.');
  console.log('');
}

main().catch(error => fail(error && error.message ? error.message : String(error)));
