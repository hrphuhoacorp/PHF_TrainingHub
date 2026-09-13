'use strict';

const { readSession } = require('../_lib/auth');
const { send, sendError } = require('../_lib/api-response');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return send(res, 405, {ok:false,error:'Phương thức không được hỗ trợ.',code:'METHOD_NOT_ALLOWED'});
    }
    const session = await readSession(req);
    return send(res, 200, {
      ok:true,
      authenticated:!!session,
      user:session ? session.account : null,
      // Account Impersonation V1 — user ở trên LUÔN LÀ effective account (để
      // toàn bộ UI/gating hiện có tự render đúng vai trò đang giả lập không
      // cần sửa gì thêm). actor chỉ mang tối thiểu danh tính Admin thật, đủ
      // để vẽ banner "Đang giả lập" + không leak dữ liệu nhạy cảm khác.
      impersonating:!!(session && session.impersonating),
      actor:(session && session.impersonating && session.actor)
        ? { id:session.actor.id, name:session.actor.name, role:session.actor.role }
        : null
    });
  } catch (error) {
    return sendError(res, error);
  }
};
