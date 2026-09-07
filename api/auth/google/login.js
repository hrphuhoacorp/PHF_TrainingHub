'use strict';

const {assertSameOrigin, assertJsonContentType, assertContentLength} = require('../../_lib/request-guard');
const {loginWithGoogle, cookieHeader, googleClientConfig} = require('../../_lib/auth');
const {send, sendError, requestBody} = require('../../_lib/api-response');
const {auditEmit} = require('../../_lib/audit-emit');

module.exports = async function handler(req,res){
  try{
    if(req.method === 'GET'){
      return send(res,200,{ok:true,...googleClientConfig()});
    }
    if(req.method !== 'POST'){
      res.setHeader('Allow','GET, POST');
      return send(res,405,{ok:false,error:'Phương thức không được hỗ trợ.',code:'METHOD_NOT_ALLOWED'});
    }
    assertSameOrigin(req);
    assertJsonContentType(req);
    assertContentLength(req);
    const body = requestBody(req);
    let result;
    try {
      result = await loginWithGoogle(body.credential);
    } catch (err) {
      // Audit the failure with safe fields ONLY — never the raw Google credential.
      await auditEmit(req, null, {
        module: 'auth', action: 'AUTH_LOGIN_FAILURE', result: 'failure',
        object_type: 'account',
        metadata: { provider: 'google', reason: (err && err.code) || 'GOOGLE_LOGIN_FAILED' },
      });
      throw err;
    }
    res.setHeader('Set-Cookie',cookieHeader(result.token));
    await auditEmit(req, { account: result.user }, {
      module: 'auth', action: 'AUTH_LOGIN_SUCCESS', result: 'success',
      object_type: 'account', object_id: result.user && result.user.id, object_label: result.user && result.user.email,
      metadata: { provider: 'google', role: result.user && result.user.role },
    });
    return send(res,200,{ok:true,user:result.user});
  }catch(error){ return sendError(res,error); }
};
