'use strict';

const {assertSameOrigin, assertJsonContentType, assertContentLength} = require('../../lib/request-guard');
const {requireSession, changeOwnPassword, cookieHeader, makeSession, publicAccount} = require('../../lib/auth');
const {send, sendError, requestBody} = require('../../lib/api-response');

module.exports = async function handler(req,res){
  try{
    if(req.method !== 'POST'){
      res.setHeader('Allow','POST');
      return send(res,405,{ok:false,error:'Phương thức không được hỗ trợ.',code:'METHOD_NOT_ALLOWED'});
    }
    assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
    const session=await requireSession(req,['learner','manager','admin']);
    const body=requestBody(req);
    const updated=await changeOwnPassword(session,body.currentPassword,body.newPassword);
    res.setHeader('Set-Cookie',cookieHeader(makeSession(updated)));
    return send(res,200,{ok:true,user:publicAccount(updated)});
  }catch(error){ return sendError(res,error); }
};
