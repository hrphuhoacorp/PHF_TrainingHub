'use strict';

const {assertSameOrigin, assertJsonContentType, assertContentLength} = require('../../../lib/request-guard');
const {requireSession, createAccountByAdmin} = require('../../../lib/auth');
const {send, sendError, requestBody} = require('../../../lib/api-response');

module.exports = async function handler(req,res){
  try{
    if(req.method !== 'POST'){
      res.setHeader('Allow','POST');
      return send(res,405,{ok:false,error:'Phương thức không được hỗ trợ.',code:'METHOD_NOT_ALLOWED'});
    }
    assertSameOrigin(req); assertJsonContentType(req); assertContentLength(req);
    await requireSession(req,['admin']);
    const body=requestBody(req);
    const result=await createAccountByAdmin(body.account||body);
    return send(res,201,{ok:true,user:result.account,temporaryPassword:result.temporaryPassword});
  }catch(error){ return sendError(res,error); }
};
