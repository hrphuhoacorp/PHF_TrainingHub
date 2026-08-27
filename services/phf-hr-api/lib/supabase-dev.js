'use strict';

// Supabase client CHỈ trỏ project DEV — không có code path nào trong file
// này (hoặc bất kỳ đâu trong services/phf-hr-api) nhận URL/key từ nguồn nào
// khác ngoài config.js (đã hard-stop nếu URL trùng Production).
//
// Toàn bộ hàm trong file này là READ-ONLY theo thiết kế — không export bất kỳ
// hàm insert/update/delete/upsert/rpc(ghi) nào trong bước skeleton này.

// Bare specifier — Node tự tìm '@supabase/supabase-js' theo thứ tự:
// node_modules cục bộ của service (khi deploy standalone, có package.json
// riêng) → node_modules của repo lớn (khi chạy local trong monorepo, không
// cần cài lại). Không hardcode đường dẫn REPO_ROOT nữa — portable cho cả 2
// ngữ cảnh mà không cần sửa code khi chuyển môi trường.
const { createClient } = require('@supabase/supabase-js');

let cachedClient = null;

function getClient(config) {
  if (cachedClient) return cachedClient;
  cachedClient = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

// Read-only probe: đếm task_categories + task_tasks. KHÔNG insert/update/
// delete ở bất kỳ dòng nào bên dưới — chỉ .select(...).
async function probeTaskRead(config) {
  const client = getClient(config);

  const [categories, tasks] = await Promise.all([
    client.from('task_categories').select('category_code', { count: 'exact', head: true }),
    client.from('task_tasks').select('id', { count: 'exact', head: true }),
  ]);

  if (categories.error) {
    const e = categories.error;
    throw new Error(`Đọc task_categories thất bại [${e.code || '?'}]: ${e.message || '(no message)'}${e.hint ? ' — hint: ' + e.hint : ''}`);
  }
  if (tasks.error) {
    const e = tasks.error;
    throw new Error(`Đọc task_tasks thất bại [${e.code || '?'}]: ${e.message || '(no message)'}${e.hint ? ' — hint: ' + e.hint : ''}`);
  }

  return {
    target: 'PHF-HR-DEV',
    taskCategoriesCount: categories.count,
    taskTasksCount: tasks.count,
    readOnly: true,
  };
}

module.exports = { getClient, probeTaskRead };
