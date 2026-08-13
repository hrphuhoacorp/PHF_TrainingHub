'use strict';
/* Regression DOM thật cho batch Dashboard Final UI/UX Polish. */
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync('assets/js/knl/phf-knl-app.js', 'utf8');
const css = fs.readFileSync('assets/css/phf-knl.css', 'utf8');

function response(data){ return { ok:true, json:async()=>data }; }
function click(window, el){ el.dispatchEvent(new window.MouseEvent('click',{bubbles:true})); }
function tick(){ return new Promise(resolve=>setTimeout(resolve,25)); }

const overview = {
  ok:true,
  meta:{
    incomeVisible:true,
    currentPeriod:'2026-08',
    previousPeriod:'2026-07',
    generatedAt:'2026-08-13T15:00:00+07:00',
    availablePeriods:['2026-08','2026-07'],
    scopeNote:'Dữ liệu trong phạm vi được phân quyền',
    filterOptions:{departments:['Bán hàng','Kho'],branches:['Phú Lợi'],titles:['Nhân viên'],knlGrades:[{code:'B2',label:'SALE · Bậc 2'}]}
  },
  kpis:{totalFund:100000000,totalHeadcount:37,avgIncome:5000000,incomePopulation:20},
  deptComposition:[{department:'Bán hàng',fund:30000000,sharePct:30},{department:'Kho',fund:70000000,sharePct:70}],
  deptComparison:[
    {department:'Bán hàng',headcount:10,fund:30000000,avgIncome:5000000,deltaPct:4.2},
    {department:'Kho',headcount:27,fund:70000000,avgIncome:4800000,deltaPct:-1.5}
  ],
  drillDown:{
    'Bán hàng':Array.from({length:15},(_,index)=>({employeeCode:index===0?'PHF001':'SALE'+String(index+1).padStart(3,'0'),employeeName:'Nhân viên bán hàng '+(index+1),title:'Nhân viên',currentIncome:5000000,deltaPct:0,knlGrade:{frameworkCode:'SALE',frameworkName:'Nhân viên bán hàng tại cửa hàng',gradeCode:index<5?'B1':index<12?'B2':'B3',label:index<5?'Bậc 1':index<12?'Bậc 2':'Bậc 3'}})).concat([{employeeCode:'phf001',employeeName:'Nhân viên bán hàng 1 bản trùng',title:'Nhân viên',currentIncome:5000000,deltaPct:0,knlGrade:{frameworkCode:'SALE',frameworkName:'Nhân viên bán hàng tại cửa hàng',gradeCode:'B1',label:'Bậc 1'}}]),
    'Bộ phận kho vận':[
      {employeeCode:'PHF034',employeeName:'Nguyễn Duy Hải',title:'Trưởng bộ phận Kho',currentIncome:11399000,deltaPct:2,knlGrade:{frameworkCode:'KHO_TRUONG',frameworkName:'Trưởng Kho',gradeCode:'B1',label:'Bậc 1'}},
      {employeeCode:'PHF073',employeeName:'Nguyễn Huỳnh Phước Huy',title:'Nhân viên',currentIncome:7969000,deltaPct:1,knlGrade:{frameworkCode:'KHO_NV',frameworkName:'Nhân viên Kho',gradeCode:'B1',label:'Bậc 1'}},
      {employeeCode:'PHF005',employeeName:'Nguyễn Minh Nhật',title:'Nhân viên',currentIncome:9875000,deltaPct:-4,knlGrade:{frameworkCode:'KHO_NV',frameworkName:'Nhân viên Kho',gradeCode:'B3',label:'Bậc 3'}}
    ],
    'Bộ phận Quản trị tổng hợp':[
      {employeeCode:'PHF012',employeeName:'Trưởng HCNS',title:'Trưởng phòng',currentIncome:15000000,deltaPct:1,knlGrade:{frameworkCode:'HCNS_TP',frameworkName:'Trưởng phòng HCNS',gradeCode:'B1',label:'Bậc 1'}},
      {employeeCode:'PHF013',employeeName:'Nhân viên HCNS',title:'Nhân viên',currentIncome:9000000,deltaPct:0,knlGrade:{frameworkCode:'HCNS_NV',frameworkName:'Nhân viên HCNS',gradeCode:'B1',label:'Bậc 1'}}
    ],
    'Bộ phận Tài chính Kế toán':[
      {employeeCode:'PHF006',employeeName:'Kế toán trưởng',title:'Kế toán trưởng',currentIncome:16000000,deltaPct:1,knlGrade:{frameworkCode:'KT_1',frameworkName:'Kế toán trưởng',gradeCode:'B1',label:'Bậc 1'}},
      {employeeCode:'PHF007',employeeName:'Kế toán viên',title:'Nhân viên',currentIncome:12000000,deltaPct:1,knlGrade:{frameworkCode:'KT_2',frameworkName:'Kế toán viên',gradeCode:'B1',label:'Bậc 1'}},
      {employeeCode:'PHF008',employeeName:'Kế toán Thu',title:'Nhân viên',currentIncome:11000000,deltaPct:1,knlGrade:{frameworkCode:'KT_3',frameworkName:'Kế toán Thu',gradeCode:'B1',label:'Bậc 1'}},
      {employeeCode:'PHF009',employeeName:'Kế toán Chi',title:'Nhân viên',currentIncome:11000000,deltaPct:1,knlGrade:{frameworkCode:'KT_4',frameworkName:'Kế toán Chi',gradeCode:'B1',label:'Bậc 1'}}
    ],
    'Bộ phận Truyền thông quảng cáo':[
      {employeeCode:'PHF028',employeeName:'Leader MKT',title:'Trưởng bộ phận',currentIncome:15000000,deltaPct:1,knlGrade:{frameworkCode:'MKT_LEAD',frameworkName:'Leader MKT',gradeCode:'B1',label:'Bậc 1'}},
      {employeeCode:'PHF069',employeeName:'Nhân viên Media',title:'Nhân viên',currentIncome:8400000,deltaPct:0,knlGrade:{frameworkCode:'MKT_NV',frameworkName:'Nhân viên Media',gradeCode:'B1',label:'Bậc 1'}}
    ],
    'Ban giám đốc':[
      {employeeCode:'PHF032',employeeName:'Trần Hữu Vinh',title:'Trợ lý Giám đốc',currentIncome:17131000,deltaPct:1,knlGrade:{frameworkCode:'GD_TN',frameworkName:'TN Giám sát',gradeCode:'B3',label:'Bậc 3'}},
      {employeeCode:'PHF002',employeeName:'Trần Thu Thủy',title:'Giám đốc',currentIncome:null,deltaPct:null,knlGrade:null},
      {employeeCode:'PHF010',employeeName:'Nguyễn Thủy Tiên',title:'Trợ lý Giám đốc',currentIncome:23425000,deltaPct:1,knlGrade:null},
      {employeeCode:'PHF004',employeeName:'Trần Gia Bảo Ngọc',title:'Trợ lý Giám đốc',currentIncome:18565000,deltaPct:1,knlGrade:null}
    ]
  },
  knlDistribution:[{frameworkCode:'SALE',frameworkName:'Nhân viên bán hàng tại cửa hàng',gradeCode:'B1',label:'Bậc 1',count:18},{frameworkCode:'SALE',frameworkName:'Nhân viên bán hàng tại cửa hàng',gradeCode:'B2',label:'Bậc 2',count:12},{frameworkCode:'KHO',frameworkName:'Nhân viên kho',gradeCode:'B2',label:'Bậc 2',count:22}],
  incomeByGrade:[{frameworkCode:'SALE',gradeCode:'B2',label:'Bậc 2',count:12,avgIncome:5000000,avgDeltaPct:1.2}],
  trend:[{period:'2026-07',fund:90000000,headcount:20,avgIncome:4500000},{period:'2026-08',fund:100000000,headcount:20,avgIncome:5000000}],
  insights:[{level:'warning',message:'Quỹ thu nhập cần được theo dõi.'}],
  actionStats:{proposalsPending:null,missingKnl:3,surveysExpiringSoon:null},
  compensationGradeMatrix:{
    period:'2026-08',gradeNumbers:[1,3,5,8],unassignedCount:1,
    departments:[
      {department:'Bán hàng',total:4,assigned:4,unassigned:0,ladders:[
        {ladderCode:'SALE_L',ladderName:'Ngạch Bán hàng',people:[
          {employeeCode:'PHF001',employeeName:'Nhân viên bán hàng 1',title:'Nhân viên'},
          {employeeCode:'PHF011',employeeName:'Nhân viên bán hàng 2',title:'Nhân viên'},
          {employeeCode:'PHF012',employeeName:'Nhân viên bán hàng 3',title:'Nhân viên'},
          {employeeCode:'PHF013',employeeName:'Nhân viên bán hàng 4',title:'Nhân viên'}
        ],grades:[
          {gradeCode:'SALE-B1',gradeNumber:1,people:[{employeeCode:'PHF001',employeeName:'Nhân viên bán hàng 1',title:'Nhân viên'}]},
          {gradeCode:'SALE-B3',gradeNumber:3,people:[{employeeCode:'PHF011',employeeName:'Nhân viên bán hàng 2',title:'Nhân viên'}]},
          {gradeCode:'SALE-B5',gradeNumber:5,people:[{employeeCode:'PHF012',employeeName:'Nhân viên bán hàng 3',title:'Nhân viên'}]},
          {gradeCode:'SALE-B8',gradeNumber:8,people:[{employeeCode:'PHF013',employeeName:'Nhân viên bán hàng 4',title:'Nhân viên'}]}
        ]}
      ]},
      {department:'Bộ phận kho vận',total:4,assigned:3,unassigned:1,ladders:[
        {ladderCode:'KHO_NV',ladderName:'Ngạch Nhân viên Kho',people:[
          {employeeCode:'PHF073',employeeName:'Nguyễn Huỳnh Phước Huy',title:'Nhân viên'},
          {employeeCode:'PHF005',employeeName:'Nguyễn Minh Nhật',title:'Nhân viên'}
        ],grades:[
          {gradeCode:'KHO-NV-B1',gradeNumber:1,people:[{employeeCode:'PHF073',employeeName:'Nguyễn Huỳnh Phước Huy',title:'Nhân viên'}]},
          {gradeCode:'KHO-NV-B3',gradeNumber:3,people:[{employeeCode:'PHF005',employeeName:'Nguyễn Minh Nhật',title:'Nhân viên'}]}
        ]},
        {ladderCode:'KHO_TRUONG',ladderName:'Ngạch Trưởng Kho',people:[
          {employeeCode:'PHF034',employeeName:'Nguyễn Duy Hải',title:'Trưởng bộ phận Kho'}
        ],grades:[
          {gradeCode:'KHO-TRUONG-B1',gradeNumber:1,people:[{employeeCode:'PHF034',employeeName:'Nguyễn Duy Hải',title:'Trưởng bộ phận Kho'}]}
        ]}
      ]}
    ]
  }
};

(async()=>{
  const dom = new JSDOM('<!doctype html><html><head><style>'+css+'</style></head><body><div id="phfKnlRoot"></div></body></html>',{url:'http://localhost/admin/knl/dashboard',runScripts:'outside-only'});
  const {window}=dom;
  const calls=[];
  const navigations=[];
  window.phfGetSessionRole=()=> 'admin';
  window.phfGetCurrentUser=()=>({id:'admin-1',employeeCode:'PHF000',name:'Admin'});
  window.phfNavigate=path=>navigations.push(path);
  window.scrollTo=()=>{};
  window.requestAnimationFrame=fn=>setTimeout(fn,0);
  window.fetch=async(url,opts)=>{
    const body=JSON.parse(opts.body); calls.push(body);
    if(body.action==='getKnlCapabilities') return response({ok:true,isAdmin:true,capabilities:{dashboard_view:true,income_view:true},peopleScope:{type:'all_company',values:[]}});
    if(body.action==='getKnlDashboardOverview') return response(JSON.parse(JSON.stringify(overview)));
    if(body.action==='askKnlDashboardAi') return response({ok:true,reply:'Bán hàng đang chiếm 30% quỹ.',contextSummary:['2 phòng ban','Kỳ 2026-08']});
    return {ok:false,json:async()=>({ok:false,error:'Unexpected action '+body.action})};
  };
  window.eval(code);
  await window.phfRenderKnl('/admin/knl/dashboard');
  await tick();
  const root=window.document.getElementById('phfKnlRoot');
  const text=root.textContent;

  assert(!text.includes('Tỷ lệ nhân sự M3+'),'KPI M3+ phải được gỡ bỏ');
  assert.strictEqual(root.querySelectorAll('.phfk-dash-kpi').length,4,'Dashboard top area phải giữ đúng 4 KPI');
  assert(text.includes('Đã gán KNL') && text.includes('34/37 người') && text.includes('91,9% nhân sự trong phạm vi đã có Bậc KNL'),'KPI Đã gán KNL phải tính đúng từ totalHeadcount - missingKnl');
  assert(root.querySelector('.phfk-dash-kpi.is-competency .phfk-dash-kpi-progress i').getAttribute('style').includes('91.9%'),'KPI Đã gán KNL phải có progress thật đúng 91,9%');
  assert(root.querySelector('.phfk-dash-kpi.is-people .phfk-dash-kpi-value small').textContent==='người','KPI Tổng nhân sự phải hiển thị unit người nhỏ hơn value');
  assert.strictEqual(root.querySelectorAll('.phfk-dash-kpi-spark').length,0,'Chỉ có 2 kỳ thì tuyệt đối không dựng KPI sparkline giả');

  const comparison=root.querySelector('.phfk-dash-panel-primary');
  assert(comparison.querySelector('.phfk-dash-panel-head>h2').classList.contains('phfk-dash-panel-title'),'So sánh phòng ban phải dùng canonical heading class');
  assert.strictEqual(comparison.querySelector('table'),null,'Dashboard mặc định visual-first, chưa render bảng chi tiết phòng ban');
  assert.strictEqual(comparison.querySelectorAll('.phfk-dash-compare-row').length,2,'So sánh phòng ban mặc định là grouped-bar visualization');
  assert.deepStrictEqual([...comparison.querySelectorAll('.phfk-dash-compare-header span')].map(el=>el.textContent.trim()),['Phòng ban','Tỷ trọng nhân sự','Tỷ trọng quỹ','Quỹ so với nhân sự','Biến động quỹ','Xem'],'Table/visual hybrid phải dùng wording nghiệp vụ rõ nghĩa');
  assert(comparison.textContent.includes('27,0%') && comparison.textContent.includes('30,0%'),'Grouped bars phải hiện trực tiếp tỷ trọng nhân sự và quỹ');
  assert(comparison.textContent.includes('điểm %'),'Chênh lệch tỷ trọng phải ghi rõ đơn vị điểm %, không gọi là tăng/giảm');
  assert(comparison.querySelector('.phfk-dash-compare-row').textContent.includes('▲')&&comparison.querySelectorAll('.phfk-dash-compare-row')[1].textContent.includes('▼'),'Quỹ so với nhân sự và biến động quỹ phải có ticker cue tăng/giảm compact');
  assert.strictEqual(comparison.querySelector('.phfk-dash-compare-row').tagName,'BUTTON','Mỗi dòng hybrid giữ drill-down trực tiếp, không đổi thành mini-card grid');
  click(window,comparison.querySelector('[data-dash-compare-details]'));
  const comparisonHeaders=[...root.querySelector('.phfk-dash-panel-primary').querySelectorAll('thead th')].map(el=>el.textContent.trim());
  assert(comparisonHeaders.includes('Tỷ trọng nhân sự') && comparisonHeaders.includes('Tỷ trọng quỹ'),'Bảng phòng ban phải có đủ hai cột tỷ trọng');
  assert(comparisonHeaders.includes('Biến động quỹ'),'Bảng chi tiết phải gọi rõ metric biến động quỹ của phòng ban');
  assert(!comparisonHeaders.includes('Bậc KNL'),'Bảng phòng ban không còn cột Bậc KNL placeholder');
  assert(root.querySelector('.phfk-dash-panel-primary').textContent.includes('27,0%'),'Bảng chi tiết phải giữ format một chữ số thập phân');

  const composition=root.querySelector('.phfk-dash-composition');
  assert.strictEqual(composition.querySelector('.phfk-dash-donut'),null,'Cơ cấu quỹ không còn donut nhỏ');
  assert.strictEqual(composition.querySelectorAll('.phfk-dash-ranked-row').length,2,'Cơ cấu quỹ dùng ranked horizontal bars');
  assert(composition.querySelector('.phfk-dash-ranked-row').textContent.includes('Kho'),'Ranked rows phải sort giảm dần theo quỹ thật');
  assert(composition.textContent.includes('08/2026'),'Subtitle cơ cấu quỹ phải dùng kỳ payroll thật dạng MM/YYYY');

  assert(!text.includes('Đề xuất nâng bậc đang xử lý') && !text.includes('Khảo sát sắp hết hạn'),'Action metric null không được render');
  const attentionRows=root.querySelectorAll('.phfk-dash-attention-row');
  assert.strictEqual(attentionRows.length,2,'Attention Center chỉ gồm metric/insight có dữ liệu thật');
  assert(root.querySelector('.phfk-dash-attention').textContent.includes('Nhân sự chưa có KNL'),'Attention metric thật phải là thiếu KNL');

  const knlSection=root.querySelector('.phfk-dash-knl');
  const knlSummary=knlSection.querySelector('.phfk-dash-knl-exec-summary');
  assert(knlSummary.textContent.includes('34/37 người')&&knlSummary.textContent.includes('3 người')&&knlSummary.textContent.includes('91,9%')&&knlSummary.textContent.includes('5/6 phòng ban'),'Executive summary phải dùng KPI payload thật và số phòng ban hoàn tất động');
  assert.strictEqual(knlSection.querySelectorAll('.phfk-dash-dept-row').length,6,'All-department view phải render department-first overview');
  assert.strictEqual(knlSection.querySelector('.phfk-dash-framework-list'),null,'Chưa chọn department thì không render global framework strip');
  function deptRow(name){return [...knlSection.querySelectorAll('.phfk-dash-dept-row')].find(row=>row.textContent.includes(name));}
  assert(deptRow('Bộ phận kho vận').textContent.includes('3 người')&&deptRow('Bộ phận kho vận').textContent.includes('3/3')&&deptRow('Bộ phận kho vận').textContent.includes('2 Bộ KNL'),'Kho vận overview = 3 unique employee, 3/3 KNL, 2 Bộ KNL');
  assert(deptRow('Bộ phận Quản trị tổng hợp').textContent.includes('2 người')&&deptRow('Bộ phận Quản trị tổng hợp').textContent.includes('2/2'),'QTT overview phải đủ 2 unique employee');
  assert(deptRow('Bộ phận Tài chính Kế toán').textContent.includes('4 người')&&deptRow('Bộ phận Tài chính Kế toán').textContent.includes('4 Bộ KNL'),'TCKT overview phải đủ 4 người/4 Bộ KNL');
  assert(deptRow('Bộ phận Truyền thông quảng cáo').textContent.includes('2 người')&&deptRow('Bộ phận Truyền thông quảng cáo').textContent.includes('2 Bộ KNL'),'Truyền thông overview phải đủ 2 người/2 Bộ KNL');
  assert(deptRow('Ban giám đốc').textContent.includes('1/4')&&deptRow('Ban giám đốc').textContent.includes('25,0%'),'Ban giám đốc phải hiển thị coverage thật 1/4 = 25%');
  assert(deptRow('Bộ phận kho vận').textContent.includes('Đủ KNL')&&deptRow('Bộ phận kho vận').textContent.includes('Xem phân tích'),'Department hoàn tất phải có trạng thái và action compact');
  assert(deptRow('Ban giám đốc').classList.contains('has-exception')&&deptRow('Ban giám đốc').textContent.includes('Thiếu 3'),'Department thiếu KNL phải có exception state rõ');
  const matrix=root.querySelector('.phfk-dash-grade-matrix');
  assert(matrix.textContent.includes('Phân bố bậc lương theo phòng ban')&&matrix.textContent.includes('Tổng hợp nhân sự theo ngạch và bậc lương trong kỳ đang xem.'),'Matrix phải dùng đúng wording bậc lương, không tái dùng wording KNL');
  assert(!matrix.textContent.includes('Ma trận phân bố bậc KNL theo phòng ban'),'Block bậc lương không được còn nhãn KNL cũ');
  assert(matrix.textContent.includes('1 người chưa được gán bậc lương trong kỳ.'),'Matrix phải hiển thị cảnh báo unassigned đúng scope');
  assert.deepStrictEqual([...matrix.querySelectorAll('thead th')].map(node=>node.textContent.trim()),['Phòng ban','Nhân sự','Bậc 1','Bậc 3','Bậc 5','Bậc 8'],'Header chỉ sinh từ gradeNumber thực tế, sort tăng dần');
  const matrixRows=[...matrix.querySelectorAll('tbody tr')];
  const matrixDeptRow=name=>matrixRows.find(row=>row.matches('[data-dash-matrix-dept]')&&row.textContent.includes(name));
  const matrixChildren=name=>{const start=matrixRows.indexOf(matrixDeptRow(name));const rows=[];for(let i=start+1;i<matrixRows.length&&!matrixRows[i].matches('[data-dash-matrix-dept]');i++)rows.push(matrixRows[i]);return rows;};
  const matrixTotal=rows=>rows.flatMap(row=>[...row.querySelectorAll('[data-dash-matrix-count]')]).reduce((sum,node)=>sum+Number(node.getAttribute('data-dash-matrix-count')),0);
  assert.strictEqual(matrixTotal([matrixDeptRow('Bán hàng')]),4,'Phòng một ngạch phải render trực tiếp và reconcile bốn người đã gán');
  assert(matrixDeptRow('Bán hàng').textContent.includes('Ngạch Bán hàng'),'Phòng một ngạch phải hiển thị tên ngạch nghiệp vụ');
  assert.strictEqual(matrixTotal(matrixChildren('Bộ phận kho vận')),3,'Phòng nhiều ngạch phải cộng đúng ba người đã gán');
  assert.strictEqual(matrixChildren('Bộ phận kho vận').length,2,'Phòng nhiều ngạch phải giữ hai dòng ngạch riêng');
  assert([...matrix.querySelectorAll('[data-dash-matrix-count="0"]')].every(node=>node.textContent==='–'),'Matrix phải hiển thị en dash thay cho zero grade');
  assert([...matrix.querySelectorAll('[data-dash-matrix-count]:not([data-dash-matrix-count="0"])')].every(node=>node.querySelector('button[data-dash-matrix-open]')),'Mọi ô count > 0 phải dùng button tương tác');
  assert([...matrix.querySelectorAll('[data-dash-matrix-count="0"]')].every(node=>!node.querySelector('button')),'Ô count 0 chỉ là en dash và không clickable');
  assert(!matrix.textContent.includes('KHO_NV')&&!matrix.textContent.includes('SALE_L'),'Matrix không hiển thị technical ladder code');
  assert(matrix.querySelector('.phfk-dash-panel-head h2.phfk-dash-panel-title'),'Tiêu đề ma trận phải dùng h2 và canonical heading class giống So sánh phòng ban');
  assert(matrix.querySelector('thead').classList.contains('phfk-dash-table-head'),'Header Matrix phải khai báo shared table-header primitive');
  assert(knlSection.querySelector('.phfk-dash-dept-head').classList.contains('phfk-dash-table-head'),'Department header phải dùng shared table-header primitive');
  assert(comparison.querySelector('.phfk-dash-compare-header').classList.contains('phfk-dash-table-head'),'Comparison header phải dùng shared table-header primitive');
  function matrixButton(department,ladderCode,gradeNumber){return [...root.querySelectorAll('[data-dash-matrix-open]')].find(node=>node.dataset.dashMatrixDepartment===department&&node.dataset.dashMatrixLadder===ladderCode&&Number(node.dataset.dashMatrixGradeNumber)===Number(gradeNumber));}
  function quickCodes(){return [...root.querySelectorAll('.phfk-dash-matrix-people li span')].map(node=>node.textContent.trim());}
  click(window,matrixButton('Bán hàng','SALE_L',1));
  let quick=root.querySelector('[data-dash-matrix-panel]');
  assert(quick&&quick.textContent.includes('Bán hàng · Ngạch Bán hàng · Bậc 1 · 1 người'),'Click exact department + ladder + grade + period phải mở đúng quick panel');
  assert.strictEqual(new Set(quickCodes()).size,quickCodes().length,'Quick panel phải dedupe employeeCode đã chuẩn hóa');
  assert(!quick.textContent.includes('5.000.000')&&!quick.querySelector('h4').textContent.includes('SALE_L'),'Quick panel không được lộ số tiền hoặc technical ladder code');
  click(window,matrixButton('Bộ phận kho vận','KHO_NV',1));
  assert.deepStrictEqual(quickCodes(),['PHF073'],'Kho · Ngạch Nhân viên Kho · Bậc 1 chỉ có PHF073');
  click(window,matrixButton('Bộ phận kho vận','KHO_TRUONG',1));
  assert.deepStrictEqual(quickCodes(),['PHF034'],'Cùng Bậc 1 ở ngạch Trưởng Kho không được merge với ngạch Nhân viên Kho');
  click(window,matrixButton('Bộ phận kho vận','KHO_NV',3));
  assert.deepStrictEqual(quickCodes(),['PHF005'],'Kho · Ngạch Nhân viên Kho · Bậc 3 chỉ có PHF005');
  const activeMatrixButton=matrixButton('Bộ phận kho vận','KHO_NV',3);
  assert.strictEqual(activeMatrixButton.getAttribute('aria-expanded'),'true','Ô đang mở phải phản ánh aria-expanded=true');
  quick=root.querySelector('[data-dash-matrix-panel]');quick.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.strictEqual(root.querySelector('[data-dash-matrix-panel]'),null,'Escape phải đóng quick panel');
  assert.strictEqual(window.document.activeElement.dataset.dashMatrixGradeNumber,'3','Đóng bằng Escape phải trả focus về trigger');
  click(window,matrixButton('Bộ phận kho vận','KHO_NV',1));
  click(window,root.querySelector('[data-dash-matrix-close]'));
  assert.strictEqual(root.querySelector('[data-dash-matrix-panel]'),null,'Nút Đóng phải đóng quick panel');
  click(window,deptRow('Bộ phận kho vận').querySelector('[data-dash-knl-dept]'));
  let knlDetail=root.querySelector('.phfk-dash-knl');
  assert(knlDetail.textContent.includes('Năng lực đội ngũ — Bộ phận kho vận'),'Click Xem phải mở department detail trong Cụm 3');
  assert(knlDetail.querySelector('.phfk-dash-knl-detail-summary').textContent.includes('3 người · 3/3 đã có KNL · Bao phủ 100,0% · 2 Bộ KNL'),'Detail header phải là inline summary, không dùng metric cards');
  assert(knlDetail.textContent.includes('Bộ KNL đang áp dụng'),'Detail dùng wording nghiệp vụ Bộ KNL');
  let gradeStructure=knlDetail.querySelector('.phfk-dash-dept-grades');
  const gradeTotal=section=>[...section.querySelectorAll('[data-dash-grade-count]')].reduce((sum,node)=>sum+Number(node.getAttribute('data-dash-grade-count')),0);
  assert(gradeStructure.classList.contains('is-multiple')&&gradeStructure.querySelectorAll('.phfk-dash-dept-grade-group').length===2,'Kho phải render breakdown tách đúng 2 Bộ KNL');
  assert.strictEqual(gradeTotal(gradeStructure),3,'Kho grade breakdown phải cộng đúng 3 unique employee');
  assert(gradeStructure.textContent.includes('Trưởng Kho')&&gradeStructure.textContent.includes('Nhân viên Kho'),'Kho phải dùng frameworkName nghiệp vụ cho từng Bộ KNL');
  assert.strictEqual(knlDetail.querySelectorAll('[data-dash-framework]').length,2,'Kho chỉ có đúng 2 framework thuộc Kho');
  assert(knlDetail.querySelector('[data-dash-framework="KHO_NV"]').textContent.includes('2 người')&&knlDetail.querySelector('[data-dash-framework="KHO_TRUONG"]').textContent.includes('1 người'),'Kho framework breakdown phải là Nhân viên 2 + Trưởng Kho 1');
  assert(knlDetail.querySelector('[data-dash-framework="KHO_NV"]').classList.contains('is-active'),'Default framework phải deterministic theo số người lớn nhất trong department');
  assert.strictEqual(knlDetail.querySelectorAll('.phfk-dash-grade-row').length,2,'Nhân viên Kho chỉ render Bậc 1 và Bậc 3 của chính framework đó');
  click(window,knlDetail.querySelector('[data-dash-framework="KHO_TRUONG"]'));
  knlDetail=root.querySelector('.phfk-dash-knl');
  assert.strictEqual(knlDetail.querySelectorAll('.phfk-dash-grade-row').length,1,'Không merge Bậc 1 của Trưởng Kho với Bậc 1 Nhân viên Kho');
  assert(knlDetail.textContent.includes('Thu nhập theo bậc — Trưởng Kho'),'Thu nhập theo bậc phải dùng frameworkName nghiệp vụ');
  assert(knlDetail.querySelector('tbody tr').textContent.includes('Bậc 1')&&!knlDetail.querySelector('tbody tr').textContent.includes('Trưởng Kho'),'Income row chỉ lặp nhãn bậc, không lặp tên Bộ KNL');
  assert(!knlDetail.textContent.includes('KHO_TRUONG'),'Không lộ technical framework identifier khi có frameworkName');
  assert(root.querySelector('[data-dash-filter="knlGradeCode"]').textContent.includes('Nhân viên bán hàng tại cửa hàng · Bậc 1'),'Filter bậc KNL cũng dùng display name nghiệp vụ');

  function backToDepartmentOverview(){click(window,root.querySelector('[data-dash-knl-overview]'));}
  function openDepartment(name){const row=[...root.querySelectorAll('.phfk-dash-dept-row')].find(item=>item.textContent.includes(name));click(window,row.querySelector('[data-dash-knl-dept]'));return root.querySelector('.phfk-dash-knl');}
  backToDepartmentOverview();
  let validationDetail=openDepartment('Bán hàng');
  gradeStructure=validationDetail.querySelector('.phfk-dash-dept-grades');
  assert(gradeStructure.classList.contains('is-single')&&gradeStructure.querySelectorAll('.phfk-dash-dept-grade-row').length===3,'Department một Bộ KNL phải dùng compact grade distribution');
  assert.strictEqual(gradeTotal(gradeStructure),15,'Bán hàng grade distribution phải cộng đúng 15 người có KNL');
  backToDepartmentOverview();
  validationDetail=openDepartment('Bộ phận Quản trị tổng hợp');
  assert.strictEqual(gradeTotal(validationDetail.querySelector('.phfk-dash-dept-grades')),2,'QTT multi-Bộ KNL phải cộng đúng 2 unique employee');
  backToDepartmentOverview();
  validationDetail=openDepartment('Bộ phận Tài chính Kế toán');
  gradeStructure=validationDetail.querySelector('.phfk-dash-dept-grades');
  assert.strictEqual(gradeTotal(gradeStructure),4,'TCKT multi-Bộ KNL phải cộng đúng 4 unique employee');
  assert(!gradeStructure.textContent.includes('KT_1')&&!gradeStructure.textContent.includes('KT_2'),'Cơ cấu bậc không lộ technical framework code');
  backToDepartmentOverview();
  validationDetail=openDepartment('Bộ phận Truyền thông quảng cáo');
  assert.strictEqual(gradeTotal(validationDetail.querySelector('.phfk-dash-dept-grades')),2,'Truyền thông multi-Bộ KNL phải cộng đúng 2 unique employee');
  backToDepartmentOverview();
  validationDetail=openDepartment('Ban giám đốc');
  gradeStructure=validationDetail.querySelector('.phfk-dash-dept-grades');
  assert.strictEqual(gradeTotal(gradeStructure),1,'Người thiếu KNL không được lọt vào grade distribution');
  assert(gradeStructure.textContent.includes('3 người chưa có KNL')&&!gradeStructure.textContent.includes('Chưa có Bậc'),'Missing KNL chỉ là completeness note, không được tạo grade giả');
  backToDepartmentOverview();

  const missingAction=root.querySelector('[data-dash-attention="missing-knl"]');
  assert(missingAction,'Missing KNL phải có action mở detail, không dùng scroll-only');
  click(window,missingAction);
  const missingPanel=root.querySelector('[data-dash-missing-panel]');
  assert(missingPanel&&missingPanel.querySelectorAll('tbody tr').length===3,'Missing KNL panel phải render đúng 3 người từ payload thật');
  assert(missingPanel.textContent.includes('PHF002')&&missingPanel.textContent.includes('PHF010')&&missingPanel.textContent.includes('PHF004')&&missingPanel.textContent.includes('Chưa gán KNL'),'Missing panel phải trả lời rõ Ai/Mã NV/Trạng thái');

  assert(root.querySelector('.phfk-dash-income-movement').textContent.includes('KỲ TRƯỚC')&&root.querySelector('.phfk-dash-income-movement').textContent.includes('KỲ HIỆN TẠI'),'Hai kỳ thật phải render comparison kỳ trước → hiện tại');
  assert(root.querySelector('.phfk-dash-income-movement').textContent.includes('07/2026')&&root.querySelector('.phfk-dash-income-movement').textContent.includes('08/2026'),'Period comparison phải hiển thị payroll period thật dạng MM/YYYY');
  assert(root.querySelector('.phfk-dash-period-delta').textContent.includes('THAY ĐỔI QUỸ')&&root.querySelector('.phfk-dash-period-delta').textContent.includes('so với kỳ trước'),'Delta full-width phải có đủ amount, %, label và context nghiệp vụ');
  assert.strictEqual(root.querySelector('.phfk-dash-trend-line'),null,'Không dựng line chart giả khi chỉ có 2 kỳ');
  assert(root.querySelector('.phfk-dash-kpi-change'),'KPI có delta thật phải hiển thị so kỳ trước');

  const aiPanel=root.querySelector('.phfk-dash-ai-panel');
  assert(comparison.compareDocumentPosition(aiPanel)&window.Node.DOCUMENT_POSITION_FOLLOWING,'AI phải nằm sau khối dữ liệu chính');
  assert(root.querySelector('[data-dash-ai-jump]'),'Header phải có action Hỏi AI phân tích');
  assert(aiPanel.querySelector('.phfk-dash-panel-head h2').classList.contains('phfk-dash-panel-title'),'Tiêu đề AI phải dùng cùng canonical heading class với So sánh và Matrix');
  const headingNodes=[comparison.querySelector('.phfk-dash-panel-title'),root.querySelector('.phfk-dash-grade-matrix .phfk-dash-panel-title'),aiPanel.querySelector('.phfk-dash-panel-title')];
  const headingProps=['fontFamily','fontSize','fontWeight','lineHeight','color','letterSpacing','marginTop','marginBottom'];
  const headingStyles=headingNodes.map(node=>{const style=window.getComputedStyle(node);return Object.fromEntries(headingProps.map(prop=>[prop,style[prop]]));});
  assert.deepStrictEqual(headingStyles[1],headingStyles[0],'Computed typography Matrix phải giống tuyệt đối So sánh phòng ban');
  assert.deepStrictEqual(headingStyles[2],headingStyles[0],'Computed typography AI phải giống tuyệt đối So sánh phòng ban');
  const headerNodes=[root.querySelector('.phfk-dash-grade-matrix thead th'),root.querySelector('.phfk-dash-dept-head'),root.querySelector('.phfk-dash-compare-header')];
  const headerProps=['fontFamily','fontSize','fontWeight','lineHeight','color','backgroundColor','textTransform','letterSpacing','paddingTop','paddingRight','paddingBottom','paddingLeft','borderBottomColor','borderBottomStyle','borderBottomWidth'];
  const headerStyles=headerNodes.map(node=>{const style=window.getComputedStyle(node);return Object.fromEntries(headerProps.map(prop=>[prop,style[prop]]));});
  assert.deepStrictEqual(headerStyles[1],headerStyles[0],'Computed header Department phải giống canonical Matrix header');
  assert.deepStrictEqual(headerStyles[2],headerStyles[0],'Computed header Comparison phải giống canonical Matrix header');
  click(window,aiPanel.querySelector('[data-dash-ai-prompt]'));
  await tick();
  assert(calls.some(c=>c.action==='askKnlDashboardAi'),'Suggested prompt vẫn gọi action askKnlDashboardAi cũ');

  const filter=root.querySelector('[data-dash-filter="department"]');
  click(window,matrixButton('Bán hàng','SALE_L',1));
  filter.value='Bán hàng';
  filter.dispatchEvent(new window.Event('change',{bubbles:true}));
  await tick();
  const dashboardCalls=calls.filter(c=>c.action==='getKnlDashboardOverview');
  assert.strictEqual(dashboardCalls.at(-1).department,'Bán hàng','Filter event vẫn gửi đúng filter vào overview action');
  assert.strictEqual(root.querySelector('[data-dash-matrix-panel]'),null,'Đổi filter phải reset quick panel cũ');
  assert(root.querySelector('.phfk-dash-knl').textContent.includes('Năng lực đội ngũ — Bán hàng')&&!root.querySelector('.phfk-dash-knl .phfk-dash-dept-overview'),'Department filter cụ thể phải tự chuyển Cụm 3 sang department detail');

  const drill=root.querySelector('[data-dash-dept="Bán hàng"]');
  click(window,drill);
  const profile=root.querySelector('[data-dash-employee="PHF001"]');
  assert(profile && root.textContent.includes('Chi tiết nhân sự — Bán hàng'),'Drill-down phòng ban vẫn mở đúng dữ liệu');
  click(window,profile);
  assert(navigations.at(-1).includes('/knl/co-cau-thu-nhap?employee_code=PHF001'),'Xem hồ sơ vẫn điều hướng qua flow thu nhập cũ');

  overview.trend.unshift({period:'2026-06',fund:88000000,headcount:19,avgIncome:4400000});
  const sparkFilter=root.querySelector('[data-dash-filter="branch"]');
  sparkFilter.value='Phú Lợi';
  sparkFilter.dispatchEvent(new window.Event('change',{bubbles:true}));
  await tick();
  assert.strictEqual(root.querySelectorAll('.phfk-dash-kpi-spark').length,2,'Từ 3 kỳ thật trở lên chỉ render sparkline cho Tổng quỹ và Thu nhập bình quân');
  assert(root.querySelector('.phfk-dash-kpi.is-income .phfk-dash-kpi-spark.is-income')&&root.querySelector('.phfk-dash-kpi.is-average .phfk-dash-kpi-spark.is-average'),'Sparkline KPI phải dùng đúng semantic green/purple');
  assert.strictEqual(root.querySelector('.phfk-dash-kpi.is-people .phfk-dash-kpi-spark'),null,'Không dùng income population history để giả active-headcount sparkline');

  assert(!calls.some(c=>c.action==='upsertKnlPermissionGrant'),'UI Dashboard không thay đổi permission/data semantics');
  assert(css.includes('grid-template-columns:minmax(320px,.7fr) minmax(560px,1.3fr)'),'Cụm 2 phải giữ nguyên parent ratio 40/60');
  assert(css.includes('.phfk-dash-period-compare{display:grid;grid-template-columns:minmax(0,1fr) 28px minmax(0,1fr)'),'Period compare phải co được, không tái tạo minimum-width conflict');
  assert(!css.includes('.phfk-dash-ranked-track i{display:block;height:100%;border-radius:inherit;background:linear-gradient'),'Ranked fund bars phải dùng PHF green phẳng, không gradient/rainbow');
  assert(css.includes('.phfk-dash-compare-header,.phfk-dash-compare-row{min-width:700px'),'Comparison hybrid phải hạ minimum width hợp lý tại breakpoint ≤1100');
  assert(css.includes('.phfk-dash-kpi-spark{position:absolute;right:14px;bottom:12px;width:92px;height:39px'),'Sparkline KPI phải là micro-chart, không tăng chiều cao card');
  assert(css.includes('.phfk-dash-knl-exec-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))'),'Cụm 3 executive summary phải là strip 4 chỉ số compact trên desktop');
  assert(css.includes('grid-template-columns:minmax(190px,1.45fr) 78px minmax(175px,1.15fr) 92px 86px 112px'),'Department overview phải giữ đúng 6 cột executive');
  assert(css.includes('.phfk-dash-knl-detail-grid{display:grid;grid-template-columns:minmax(170px,.55fr) minmax(230px,1fr) minmax(300px,1.15fr);gap:0}'),'Department detail desktop phải là một surface 3 cột có divider');
  assert(css.includes('@media(max-width:1100px)')&&css.includes('.phfk-dash-knl-detail-grid{grid-template-columns:1fr 1fr;gap:12px}'),'Cụm 3 phải có inner layout responsive ở ≤1100');
  assert(css.includes('.phfk-dash-dept-head,.phfk-dash-dept-row{min-width:760px}.phfk-dash-knl-exec-summary{grid-template-columns:1fr 1fr}'),'Mobile/tablet phải giữ table scroll và summary 2 cột, không nới toàn trang');
  assert(css.includes('.phfk-dash-missing-panel{width:min(100%,1080px)'),'Panel thiếu KNL phải giảm khoảng trống nhưng giữ responsive');
  assert(css.includes('.phfk-dash-detail-layout.is-open{grid-template-columns:minmax(0,1fr)}'),'Drill-down open phải stack full-width, không bó attention vào cột 210px');
  assert(!css.includes('.phfk-dash-detail-layout.is-open{grid-template-columns:minmax(210px,.32fr)'),'Không được tái tạo root cause narrow-column ở drill-down');
  assert(css.includes('.phfk-dash .phfk-table thead th{background:#f8fbf9;color:#657a71;padding:10px 12px'),'Toàn bộ Dashboard table header phải dùng shared visual rule');
  assert(css.includes('.phfk-dash-view-action{display:inline-flex;align-items:center;justify-content:center;height:25px'),'Action Xem ở hybrid và detail phải dùng shared style');
  assert(css.includes('.phfk-dash-kpi-value{margin:10px 0 5px;font-size:28px;font-weight:780'),'KPI value phải dùng chung typography micro-polish 28px/780');
  assert(css.includes('.phfk-dash-dept-grades.is-multiple .phfk-dash-dept-grades-body{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))'),'Multi-Bộ KNL breakdown phải compact và adaptive, không thành chart lớn');
  assert(css.includes('.phfk-dash-dept-grade-row{display:grid;grid-template-columns:minmax(90px,140px) minmax(120px,1fr) 66px 48px'),'Single-Bộ KNL phải dùng horizontal grade distribution có count trực tiếp');
  assert(css.includes('overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;overscroll-behavior-y:contain'),'Sidebar thấp vẫn cuộn được nhưng không hiện visual scrollbar');
  assert(css.includes('.phfk-sidebar::-webkit-scrollbar{display:none;width:0;height:0}'),'Sidebar phải ẩn scrollbar trên WebKit');
  assert(css.includes('@media(min-width:761px) and (max-height:900px){.phfk-guide{display:none}}'),'Hướng dẫn secondary không được ép desktop thấp sinh sidebar scrollbar');
  assert(!css.includes('body.phf-knl-mode:has(#phfKnlRoot .phfk-dash) .phf-ai-floating{display:none!important}'),'Dashboard không được ẩn PHF AI floating dùng chung');
  assert(css.includes('body.phf-knl-mode:has(#phfKnlRoot .phfk-dash) .phf-ai-floating{right:12px;bottom:14px}'),'PHF AI floating phải có vị trí Dashboard scoped, tránh che vùng dữ liệu chính');
  assert(css.includes('.phfk-dash-panel-head .phfk-dash-panel-title{font-size:18px}'),'Ba heading phải dùng canonical 18px kế thừa từ So sánh phòng ban');
  assert(!css.includes('.phfk-dash-section-title')&&!css.includes('.phfk-dash-panel-primary .phfk-dash-panel-head h2'),'Không còn heading class/ancestor override riêng của Matrix, AI hoặc So sánh');
  assert(css.includes('.phfk-dash-table-head{--phfk-dash-head-bg:#f8fbf9;--phfk-dash-head-color:#657a71;--phfk-dash-head-line:#e4ece8'),'Ba header surface phải dùng một shared visual primitive/token set');
  assert(!css.includes('.phfk-dash-dept-head{')&&!css.includes('.phfk-dash-compare-header{'),'Department/Comparison không còn bộ typography header riêng');

  overview.meta.currentPeriod='2026-07';
  overview.compensationGradeMatrix={period:'2026-07',gradeNumbers:[3,8],unassignedCount:0,departments:[{department:'Bán hàng',total:2,assigned:2,unassigned:0,ladders:[{ladderCode:'SALE_L',ladderName:'Ngạch Bán hàng',people:[{employeeCode:'PHF001',employeeName:'Nhân viên bán hàng 1',title:'Nhân viên'},{employeeCode:'PHF011',employeeName:'Nhân viên bán hàng 2',title:'Nhân viên'}],grades:[{gradeCode:'SALE-B3',gradeNumber:3,people:[{employeeCode:'PHF001',employeeName:'Nhân viên bán hàng 1',title:'Nhân viên'}]},{gradeCode:'SALE-B8',gradeNumber:8,people:[{employeeCode:'PHF011',employeeName:'Nhân viên bán hàng 2',title:'Nhân viên'}]}]}]}]};
  const periodFilter=root.querySelector('[data-dash-filter="period"]');periodFilter.value='2026-07';periodFilter.dispatchEvent(new window.Event('change',{bubbles:true}));await tick();
  assert.deepStrictEqual([...root.querySelectorAll('.phfk-dash-grade-matrix thead th')].map(node=>node.textContent.trim()),['Phòng ban','Nhân sự','Bậc 3','Bậc 8'],'Đổi kỳ phải render lại đúng tập cột động của snapshot kỳ mới');

  overview.meta.incomeVisible=false;delete overview.compensationGradeMatrix;
  const noIncomeFilter=root.querySelector('[data-dash-filter="title"]');noIncomeFilter.value='Nhân viên';noIncomeFilter.dispatchEvent(new window.Event('change',{bubbles:true}));await tick();
  const noIncomeMatrix=root.querySelector('.phfk-dash-grade-matrix');
  assert(noIncomeMatrix.textContent.includes('Không có quyền xem dữ liệu ngạch và bậc lương.'),'Không income_view phải hiển thị no-access state phù hợp');
  assert.strictEqual(noIncomeMatrix.querySelector('table'),null,'Không income_view không được render bảng bậc lương');
  assert.strictEqual(noIncomeMatrix.querySelector('[data-dash-matrix-count]'),null,'Không income_view không được render count nhạy cảm');
  console.log('ALL PASS — Dashboard Final UI/UX Polish regression');
})().catch(error=>{ console.error(error); process.exit(1); });
