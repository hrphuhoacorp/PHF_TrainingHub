'use strict';
const { send } = require('../lib/api-response');
const build = require('../build-info.json');
module.exports = async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return send(res,405,{ok:false,error:'Phương thức không được hỗ trợ.',code:'METHOD_NOT_ALLOWED'});}
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-PHF-Build',`${build.version}-${build.fingerprint}`);
  return send(res,200,{ok:true,build});
};
