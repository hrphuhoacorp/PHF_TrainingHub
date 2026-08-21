'use strict';

const {assertSameOrigin, assertJsonContentType, assertContentLength} = require('../../_lib/request-guard');
const {loginWithGoogle, cookieHeader, googleClientConfig} = require('../../_lib/auth');
const {send, sendError, requestBody} = require('../../_lib/api-response');

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
    const result = await loginWithGoogle(body.credential);
    res.setHeader('Set-Cookie',cookieHeader(result.token));
    return send(res,200,{ok:true,user:result.user});
  }catch(error){ return sendError(res,error); }
};
