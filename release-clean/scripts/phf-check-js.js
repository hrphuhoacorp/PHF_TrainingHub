'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'..'), skip=new Set(['node_modules','backups','private','.git','_ROLLBACK_BAN52','_backup_old']);let count=0;
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(skip.has(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.js')){cp.execFileSync(process.execPath,['--check',p],{stdio:'pipe'});count++;}}}
walk(root);console.log(`JS CHECK PASS: ${count} files`);
