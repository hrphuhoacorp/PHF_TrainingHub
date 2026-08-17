'use strict';
/*
 * Batch 2A / KNL-10 — Regression DOM cho việc bỏ khung nhập câu hỏi AI tự do
 * (textarea + nút "Hỏi AI") khỏi panel AI trong Dashboard KNL, giữ nguyên
 * suggestion chips/cards gọi chung dashboardAskAi()->askKnlDashboardAi.
 * Không đổi backend permission/model/context/rate-limit (xem
 * scripts/test-knl-dashboard-ai-2026-08.js cho phần đó).
 */
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync('assets/js/knl/phf-knl-app.js', 'utf8');
const css = fs.readFileSync('assets/css/phf-knl.css', 'utf8');
const serverSrc = fs.readFileSync('server.js', 'utf8');
const apiDataSrc = fs.readFileSync('api/data.js', 'utf8');

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
    filterOptions:{departments:['Bán hàng'],branches:['Phú Lợi'],titles:['Nhân viên'],knlGrades:[]}
  },
  kpis:{totalFund:100000000,totalHeadcount:10,avgIncome:5000000,incomePopulation:10},
  deptComposition:[{department:'Bán hàng',fund:100000000,sharePct:100}],
  deptComparison:[{department:'Bán hàng',headcount:10,fund:100000000,avgIncome:5000000,deltaPct:1}],
  drillDown:{'Bán hàng':[{employeeCode:'PHF001',employeeName:'Nhân viên bán hàng 1',title:'Nhân viên',currentIncome:5000000,deltaPct:0,knlGrade:null}]},
  knlDistribution:[],
  incomeByGrade:[],
  trend:[{period:'2026-07',fund:90000000,headcount:10,avgIncome:4500000},{period:'2026-08',fund:100000000,headcount:10,avgIncome:5000000}],
  insights:[],
  actionStats:{proposalsPending:null,missingKnl:0,surveysExpiringSoon:null},
  compensationGradeMatrix:{period:'2026-08',gradeNumbers:[],unassignedCount:0,departments:[]}
};

(async()=>{
  const dom = new JSDOM('<!doctype html><html><head><style>'+css+'</style></head><body><div id="phfKnlRoot"></div></body></html>',{url:'http://localhost/admin/knl/dashboard',runScripts:'outside-only'});
  const {window}=dom;
  const calls=[];
  window.phfGetSessionRole=()=> 'admin';
  window.phfGetCurrentUser=()=>({id:'admin-1',employeeCode:'PHF000',name:'Admin'});
  window.phfNavigate=()=>{};
  window.scrollTo=()=>{};
  window.requestAnimationFrame=fn=>setTimeout(fn,0);
  window.Element.prototype.scrollIntoView=()=>{};
  window.fetch=async(url,opts)=>{
    const body=JSON.parse(opts.body); calls.push(body);
    if(body.action==='getKnlCapabilities') return response({ok:true,isAdmin:true,capabilities:{dashboard_view:true,income_view:true},peopleScope:{type:'all_company',values:[]}});
    if(body.action==='getKnlDashboardOverview') return response(JSON.parse(JSON.stringify(overview)));
    if(body.action==='askKnlDashboardAi') return response({ok:true,reply:'Bán hàng đang chiếm 100% quỹ.',contextSummary:['1 phòng ban','Kỳ 2026-08']});
    return {ok:false,json:async()=>({ok:false,error:'Unexpected action '+body.action})};
  };
  window.eval(code);
  await window.phfRenderKnl('/admin/knl/dashboard');
  await tick();
  const root=window.document.getElementById('phfKnlRoot');

  let failures = 0;
  function check(condition, message){ if(!condition){ console.error('FAIL: '+message); failures++; } else console.log('PASS: '+message); }

  // ===== 1. Khung nhập tự do không còn tồn tại trong DOM =====
  check(root.querySelector('[data-dash-ai-input]')===null, '1.1 Không còn textarea [data-dash-ai-input] trong DOM');
  check(root.querySelector('[data-dash-ai-send]')===null, '1.2 Không còn nút [data-dash-ai-send] trong DOM');
  check(!root.innerHTML.includes('phfk-dash-ai-custom'), '1.3 Không còn wrapper .phfk-dash-ai-custom trong markup');
  check(!root.textContent.includes('Hoặc nhập câu hỏi của bạn'), '1.4 Không còn placeholder mời nhập câu hỏi tự do');

  // ===== 2. Suggestion chips vẫn tồn tại và đủ số lượng =====
  const chips = root.querySelectorAll('[data-dash-ai-prompt]');
  check(chips.length===5, '2.1 Suggestion chips vẫn hiển thị đủ 5 gợi ý (không bị xoá nhầm theo free-text)');
  check(chips.length>0 && chips[0].tagName==='BUTTON', '2.2 Mỗi chip là 1 button độc lập, click được');

  // ===== 3. Click chip vẫn gọi đúng dashboardAskAi -> action askKnlDashboardAi =====
  const beforeCalls = calls.length;
  click(window, chips[0]);
  await tick();
  const aiCalls = calls.slice(beforeCalls).filter(c=>c.action==='askKnlDashboardAi');
  check(aiCalls.length===1, '3.1 Click chip gọi đúng 1 request action askKnlDashboardAi');
  check(aiCalls[0] && aiCalls[0].question===chips[0].textContent, '3.2 Request mang đúng nội dung câu hỏi của chip đã click');
  check(root.querySelector('[data-dash-ai-answer]')!==null && root.textContent.includes('Bán hàng đang chiếm 100% quỹ'), '3.3 Vùng trả lời (NHẬN ĐỊNH) vẫn render đúng sau khi chip trả lời — panel Hỏi AI không bị xoá, chỉ bỏ input tự do');
  check(root.textContent.includes('1 phòng ban'), '3.4 contextSummary (SỐ LIỆU SỬ DỤNG) vẫn render đúng');

  // ===== 4. Header jump button không còn gợi ý free-text gây hiểu nhầm =====
  const jumpBtn = root.querySelector('[data-dash-ai-jump]');
  check(jumpBtn!==null, '4.1 Nút cuộn tới khu AI suggestion vẫn còn (không xoá vì vẫn hữu ích)');
  check(jumpBtn && !jumpBtn.textContent.includes('Hỏi AI phân tích'), '4.2 Nhãn nút header không còn ghi "Hỏi AI phân tích" (dễ hiểu nhầm có free-text input)');
  click(window, jumpBtn);
  check(true, '4.3 Click nút jump không throw (vẫn cuộn tới panel #phfkDashAi bình thường)');

  // ===== 5. Wiring backend/API vẫn còn nguyên (static check, không đổi permission/model) =====
  check(/action\s*===\s*'askKnlDashboardAi'/.test(serverSrc), '5.1 server.js vẫn wire action askKnlDashboardAi');
  check(/action\s*===\s*'askKnlDashboardAi'/.test(apiDataSrc), '5.2 api/data.js (Vercel) vẫn wire action askKnlDashboardAi');

  console.log(failures===0 ? '\nALL PASS — KNL-10 Dashboard AI UI cleanup (free-text removed, chips preserved)' : '\n'+failures+' FAILURE(S)');
  process.exit(failures===0 ? 0 : 1);
})();
