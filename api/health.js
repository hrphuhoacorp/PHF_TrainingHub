'use strict';

const { createClient } = require('@supabase/supabase-js');
const { send, sendError } = require('../lib/api-response');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return send(res, 405, {ok:false,error:'Phương thức không được hỗ trợ.',code:'METHOD_NOT_ALLOWED'});
    }

    const url = String(process.env.SUPABASE_URL || '').trim();
    const secret = String(process.env.SUPABASE_SECRET_KEY || '').trim();
    const sessionSecret = String(process.env.PHF_SESSION_SECRET || '').trim();

    if (!url || !secret || !sessionSecret) {
      return send(res, 503, {
        ok:false,
        service:'PHF Training Hub',
        storage:'not-configured',
        accounts:'not-configured',
        code:'ENV_NOT_CONFIGURED'
      });
    }

    const supabase = createClient(url, secret, {
      auth:{persistSession:false,autoRefreshToken:false}
    });
    const { count, error } = await supabase
      .from('user_accounts')
      .select('*', {count:'exact',head:true});

    if (error) throw error;

    return send(res, 200, {
      ok:true,
      service:'PHF Training Hub',
      storage:'supabase',
      accounts:'ready',
      accountCount:count || 0,
      time:new Date().toISOString()
    });
  } catch (error) {
    return sendError(res, error);
  }
};
