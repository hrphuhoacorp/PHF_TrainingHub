'use strict';

const {googleClientConfig} = require('../../../lib/auth');
const {send, sendError} = require('../../../lib/api-response');

module.exports = async function handler(req,res){
  try{
    if(req.method !== 'GET'){
      res.setHeader('Allow','GET');
      return send(res,405,{ok:false,error:'Phương thức không được hỗ trợ.',code:'METHOD_NOT_ALLOWED'});
    }
    return send(res,200,{ok:true,...googleClientConfig()});
  }catch(error){ return sendError(res,error); }
};
