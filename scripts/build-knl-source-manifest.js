'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const input=path.resolve(process.argv[2]||'C:/Users/thang/Downloads/PHF_KNL_IMPLEMENTATION_SPEC_2026-08-09.md');
const output=path.resolve(process.argv[3]||path.join(__dirname,'..','assets','data','knl-source-manifest-2026-08-09.json'));
const markdown=fs.readFileSync(input,'utf8').replace(/^\uFEFF/,'');
const lines=markdown.split(/\r?\n/);
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const clean=value=>String(value||'').trim().replace(/<br\s*\/?>/gi,'\n').replace(/&nbsp;/gi,' ');
const slug=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/Đ/g,'D').replace(/[^A-Z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,38);
const forbidden=value=>{const n=clean(value).toLowerCase();return ['lương','thu nhập','bậc lương','thử việc','compensation','85%'].some(term=>n.includes(term));};
function cells(line){return line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(clean);}
function tableIn(block,headerToken){
  const start=block.findIndex(line=>line.startsWith('|')&&line.includes(headerToken));
  if(start<0)return {headers:[],rows:[]};
  const headers=cells(block[start]);const rows=[];
  for(let i=start+2;i<block.length&&block[i].trim().startsWith('|');i++){const row=cells(block[i]);if(row.length>=headers.length)rows.push(row.slice(0,headers.length));}
  return {headers,rows};
}
function blockAfter(start,endPattern){const end=lines.findIndex((line,index)=>index>start&&endPattern.test(line));return lines.slice(start,end<0?lines.length:end);}
const conflictSheets=new Set([
  'TN_Giamsat (Vinh)','TN_Giamsat_v2',
  'NV Gói quà (PHF)','NV_Goiqua','TBP Gói quà (PHF)','TBP Gói quà (PHF) v2',
  'NV HCNS (PHF)','NV_HCNS','TP HCNS (PHF)','TP_HCNS',
  'NV Kho (PHF)','NV_Kho','Trưởng Kho (PHF)','Trưởng Kho (PHF) v2',
  'KTTH','KT THU','KT CHI',
  'NV Thu mua (PHF)','NV_Thumua','TP Thu mua (PHF)','TP Thu mua (PHF) v2'
]);
const conflictReason={
  'TN_Giamsat (Vinh)':'TN_GIAMSAT_REGULAR_V2_UNRESOLVED','TN_Giamsat_v2':'TN_GIAMSAT_REGULAR_V2_UNRESOLVED',
  'NV Gói quà (PHF)':'NV_GOIQUA_PHF_LEGACY_UNRESOLVED','NV_Goiqua':'NV_GOIQUA_PHF_LEGACY_UNRESOLVED',
  'TBP Gói quà (PHF)':'TBP_GOIQUA_REGULAR_V2_UNRESOLVED','TBP Gói quà (PHF) v2':'TBP_GOIQUA_REGULAR_V2_UNRESOLVED',
  'NV HCNS (PHF)':'NV_HCNS_PHF_LEGACY_UNRESOLVED','NV_HCNS':'NV_HCNS_PHF_LEGACY_UNRESOLVED',
  'TP HCNS (PHF)':'TP_HCNS_PHF_LEGACY_UNRESOLVED','TP_HCNS':'TP_HCNS_PHF_LEGACY_UNRESOLVED',
  'NV Kho (PHF)':'NV_KHO_PHF_LEGACY_UNRESOLVED','NV_Kho':'NV_KHO_PHF_LEGACY_UNRESOLVED',
  'Trưởng Kho (PHF)':'TRUONG_KHO_REGULAR_V2_UNRESOLVED','Trưởng Kho (PHF) v2':'TRUONG_KHO_REGULAR_V2_UNRESOLVED',
  'KTTH':'KE_TOAN_VIEN_VARIANTS_UNRESOLVED','KT THU':'KE_TOAN_VIEN_VARIANTS_UNRESOLVED','KT CHI':'KE_TOAN_VIEN_VARIANTS_UNRESOLVED',
  'NV Thu mua (PHF)':'NV_THUMUA_PHF_LEGACY_UNRESOLVED','NV_Thumua':'NV_THUMUA_PHF_LEGACY_UNRESOLVED',
  'TP Thu mua (PHF)':'TP_THUMUA_REGULAR_V2_UNRESOLVED','TP Thu mua (PHF) v2':'TP_THUMUA_REGULAR_V2_UNRESOLVED'
};
// Business-name overrides: chỉ dùng khi sourcePosition (Vị trí nguồn) của
// nhiều sheet trùng nhau y hệt và cần tên nghiệp vụ phân biệt. KHÔNG đổi dữ
// liệu nguồn - chỉ chọn tên hiển thị rõ nghĩa từ chính tên sheet nguồn.
// KTTH/KT THU/KT CHI đều khai "Vị trí nguồn: Kế toán viên" giống hệt nhau
// trong PHF_KNL_IMPLEMENTATION_SPEC_2026-08-09.md (không có sheet nào tên
// literal "KTV") - đây là 3 mẫu KNL nội dung khác nhau (kế toán tổng hợp/
// thu/chi), không phải bản sao trùng lặp của cùng một vị trí.
const frameworkNameOverride={
  'KTTH':'Kế toán viên','KT THU':'Kế toán Thu','KT CHI':'Kế toán Chi'
};
function candidateFromTable(meta,table,rawBlock){
  const groupIndex=table.headers.findIndex(h=>/Nhóm/.test(h));
  const itemIndex=table.headers.findIndex(h=>/Hạng mục/.test(h));
  const descriptionIndex=table.headers.findIndex(h=>/Mô tả|Kiểm chứng/.test(h));
  const levelIndexes=table.headers.map((h,index)=>/^Mức(?: độ)?\s*\d+$/i.test(h)?index:-1).filter(index=>index>=0);
  const rowIndex=table.headers.findIndex(h=>/Dòng nguồn/.test(h));
  const key='phf-knl-2026-08-09:'+sha(meta.sourceFile+'|'+meta.sourceSheet).slice(0,20);
  // candidateStatus la tin hieu audit/provenance noi bo (backend/data) -
  // KHONG con quyet dinh mau co duoc nap len thu vien hay khong (xem PHF
  // Organization Master Cutover session, batch "Thu vien Bo KNL"). Moi
  // candidate khong phai EXCLUDED deu duoc trich xuat DAY DU groups/
  // columns/content, nap len voi trang thai nghiep vu "Chua ap dung".
  const status=conflictSheets.has(meta.sourceSheet)?'NEEDS_REVIEW':'READY';
  const kept=[],excluded=[];
  table.rows.forEach((row,index)=>{
    const sourceRow=rowIndex>=0?row[rowIndex]:String(index+1);
    const item={sourceKey:key+':item:'+slug(sourceRow||index+1),sourceRow,group:row[groupIndex],name:row[itemIndex],description:descriptionIndex>=0?row[descriptionIndex]:'',levels:levelIndexes.map(i=>row[i]||'')};
    if(forbidden([item.name,item.description,...item.levels].join(' ')))excluded.push({sourceRow,reason:'FORBIDDEN_COMPENSATION_CONTENT'});else kept.push(item);
  });
  const groups=[];
  kept.forEach(item=>{let group=groups.find(g=>g.name===item.group);if(!group){group={sourceKey:key+':group:'+String(groups.length+1),name:item.group,sortOrder:groups.length+1,items:[]};groups.push(group);}group.items.push({...item,sortOrder:group.items.length+1});});
  const columns=[{sourceKey:key+':column:item',type:'item',label:'HẠNG MỤC',sortOrder:1}];
  if(descriptionIndex>=0)columns.push({sourceKey:key+':column:description',type:'description',label:table.headers[descriptionIndex].toUpperCase(),sortOrder:columns.length+1});
  levelIndexes.forEach((_,index)=>columns.push({sourceKey:key+':column:level:'+String(index+1),type:'level',label:'MỨC ĐỘ '+String(index+1),levelNumber:index+1,sortOrder:columns.length+1}));
  const contentCount=kept.reduce((sum,item)=>sum+item.levels.filter(Boolean).length,0);
  const frameworkName=frameworkNameOverride[meta.sourceSheet]||meta.sourcePosition;
  const payload={manifestKey:key,specDate:'2026-08-09',sourceFile:meta.sourceFile,sourceSheet:meta.sourceSheet,sourcePosition:meta.sourcePosition,sourceHash:sha(rawBlock.join('\n')),candidateStatus:status,decisionReason:status==='READY'?'UNIQUE_SOURCE_CANDIDATE':conflictReason[meta.sourceSheet],levelCount:levelIndexes.length,includeDescription:descriptionIndex>=0,guidance:clean(meta.guidance||''),frameworkCode:('KNL_'+slug(meta.sourceSheet)+'_'+sha(key).slice(0,6).toUpperCase()).slice(0,50),frameworkName,versionName:frameworkName,sourceVersionKey:key+':version:1',columns,groups,excludedRows:excluded,counts:{groups:groups.length,items:kept.length,contents:contentCount}};
  payload.payloadHash=sha(JSON.stringify({...payload,payloadHash:undefined}));
  return payload;
}

const candidates=[];
const salesStart=lines.findIndex(line=>line.startsWith('## 6. '));
const salesBlock=blockAfter(salesStart,/^## 7\. /);
const salesTable=tableIn(salesBlock,'| Nhóm |');
const guidanceStart=salesBlock.findIndex(line=>line.trim()==='```text'),guidanceEnd=guidanceStart>=0?salesBlock.findIndex((line,index)=>index>guidanceStart&&line.trim()==='```'):-1;
const salesGuidance=guidanceStart>=0&&guidanceEnd>guidanceStart?salesBlock.slice(guidanceStart+1,guidanceEnd).join('\n'):'';
candidates.push(candidateFromTable({sourceFile:'PDF Bán hàng',sourceSheet:'Nhân viên bán hàng tại cửa hàng',sourcePosition:'Nhân viên bán hàng tại cửa hàng',guidance:salesGuidance},salesTable,salesBlock));

for(let i=0;i<lines.length;i++){
  const match=lines[i].match(/^### (.+?) -> (.+)$/);if(!match)continue;
  const end=lines.findIndex((line,index)=>index>i&&/^(?:### |## 8\.)/.test(line));
  const block=lines.slice(i,end<0?lines.length:end);
  const positionLine=block.find(line=>line.startsWith('- **Vị trí nguồn:**'))||'';
  const sourcePosition=clean(positionLine.replace('- **Vị trí nguồn:**',''));
  candidates.push(candidateFromTable({sourceFile:match[1],sourceSheet:match[2],sourcePosition},tableIn(block,'| Dòng nguồn |'),block));
}

const excludedSources=[
  {manifestKey:'phf-knl-2026-08-09:excluded:cv-cung-ung',sourceFile:'PHF source package',sourceSheet:'CV CUNG ỨNG',candidateStatus:'EXCLUDED',decisionReason:'OUT_OF_SCOPE_BY_USER'},
  {manifestKey:'phf-knl-2026-08-09:excluded:nv-van-tai',sourceFile:'Residual workbook sheets',sourceSheet:'NV VẬN TẢI',candidateStatus:'EXCLUDED',decisionReason:'RESIDUAL_NON_STANDARD_SOURCE'},
  {manifestKey:'phf-knl-2026-08-09:excluded:chuoi-gia-tri-hang-sx',sourceFile:'Residual workbook sheets',sourceSheet:'CHUỖI GIÁ TRỊ HÀNG SX',candidateStatus:'EXCLUDED',decisionReason:'RESIDUAL_NON_PHF_HEADER'}
].map(x=>({...x,specDate:'2026-08-09',sourcePosition:'',sourceHash:'',payloadHash:sha(JSON.stringify(x)),levelCount:0,includeDescription:false,guidance:'',frameworkCode:'',frameworkName:'',versionName:'',sourceVersionKey:'',columns:[],groups:[],excludedRows:[],counts:{groups:0,items:0,contents:0}}));
const manifest={manifestVersion:'PHF_KNL_SOURCE_2026-08-09_V1',specDate:'2026-08-09',sourceSpecSha256:sha(markdown),policy:{canonical:'Seed unique source candidates only; duplicate regular/v2/legacy candidates remain NEEDS_REVIEW.',organization:'Read checklist_employee_assignments only. Never write Checklist.',forbidden:'No pay-grade, salary, probation-85-percent or compensation content.'},candidates:[...candidates,...excludedSources]};
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(manifest,null,2)+'\n','utf8');
const ready=manifest.candidates.filter(x=>x.candidateStatus==='READY'),review=manifest.candidates.filter(x=>x.candidateStatus==='NEEDS_REVIEW'),excluded=manifest.candidates.filter(x=>x.candidateStatus==='EXCLUDED');
const totals=ready.reduce((a,x)=>({frameworks:a.frameworks+1,versions:a.versions+1,groups:a.groups+x.counts.groups,items:a.items+x.counts.items,contents:a.contents+x.counts.contents}),{frameworks:0,versions:0,groups:0,items:0,contents:0});
console.log(JSON.stringify({output,ready:ready.map(x=>x.sourceSheet),needsReview:review.map(x=>x.sourceSheet),excluded:excluded.map(x=>x.sourceSheet),forbiddenRows:ready.reduce((n,x)=>n+x.excludedRows.length,0),totals},null,2));
