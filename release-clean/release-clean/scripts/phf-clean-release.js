'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'), out=path.resolve(process.argv[2]||path.join(root,'release-clean'));
const blocked=new Set(['.git','.env','private','backups','node_modules','_rollback_ban52','_backup_old','release-clean']);
function copy(src,dst){const st=fs.statSync(src);if(st.isDirectory()){fs.mkdirSync(dst,{recursive:true});for(const n of fs.readdirSync(src)){if(blocked.has(n.toLowerCase()))continue;copy(path.join(src,n),path.join(dst,n));}}else fs.copyFileSync(src,dst);}
fs.rmSync(out,{recursive:true,force:true});copy(root,out);console.log(out);
