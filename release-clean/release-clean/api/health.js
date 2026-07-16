'use strict';
const { send } = require('../lib/api-response');
const { checkSupabaseHealth } = require('../lib/production-hardening');
module.exports = async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return send(res,405,{ok:false,error:'Phương thức không được hỗ trợ.',code:'METHOD_NOT_ALLOWED'});}
  const health=await checkSupabaseHealth({timeoutMs:4000});
  return send(res,health.ok?200:503,{...health,service:'PHF Training Hub',time:new Date().toISOString()});
};
