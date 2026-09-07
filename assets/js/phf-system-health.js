/* PHF HR — SYSTEM V1 · Tình trạng hệ thống (System Health).
   Admin-only, READ-ONLY. The Admin's operational status board.
   Data: GET /api/data?systemHealth=1 (Admin-gated) -> server-side aggregator.
   The "Kiểm tra lại" button only re-runs bounded read probes — no service
   restart, no test mail, no write. There is NO mutation control anywhere. */
(function(){
'use strict';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function role(){try{return String((window.phfGetSessionRole&&window.phfGetSessionRole())||'').toLowerCase();}catch(e){return '';}}
function main(){return document.getElementById('phfHrRoot')||document.querySelector('main')||document.body;}
function fmtTime(v){try{var d=new Date(v);if(isNaN(d.getTime()))return String(v||'');return d.toLocaleString('vi-VN',{hour12:false});}catch(e){return String(v||'');}}
function ago(sec){
  if(sec==null||!isFinite(sec))return '';
  sec=Math.max(0,Math.floor(sec));
  if(sec<90)return sec+' giây trước';
  var m=Math.floor(sec/60);if(m<90)return m+' phút trước';
  var h=Math.floor(m/60);if(h<48)return h+' giờ trước';
  return Math.floor(h/24)+' ngày trước';
}

var STATUS_TEXT={HEALTHY:'Hoạt động bình thường',WARNING:'Cần chú ý',ERROR:'Đang có lỗi',UNKNOWN:'Chưa xác minh'};
var REASON_TEXT={
  CHECKING:'Đang kiểm tra…',READ_FAILED:'Không đọc được dữ liệu',
  NO_HEARTBEAT:'Chưa có tín hiệu',NO_HEARTBEAT_SOURCE:'Chưa có nguồn tín hiệu',
  NO_AUTOMATED_SIGNAL:'Không có tín hiệu tự động — kiểm tra thủ công trên máy chủ',
  DEEP_PROBE_DISABLED:'Chưa bật kiểm tra sâu',DEEP_PROBE_UNAVAILABLE:'Không kết nối được kiểm tra sâu',
  DEEP_PROBE_DISABLED_LOCAL:'Chưa bật kiểm tra sâu',
  STALE_15M:'Chạy gần nhất đã quá 15 phút',STALE_60M:'Chạy gần nhất đã quá 60 phút',
  LAST_RUN_FAILED:'Lần chạy gần nhất thất bại',
  MISSED_WINDOW:'Quá hạn tuần dự kiến',MISSED_MONDAY:'Đã bỏ lỡ một kỳ thứ Hai',NEVER_SEEN:'Chưa từng ghi nhận',
  BACKLOG_STUCK:'Có thư kẹt trên 60 phút',BACKLOG_AGING:'Có thư chờ 15–60 phút',RECENT_FAILURES:'Có thư gửi lỗi gần đây',
  PROVIDER_DISABLED:'Nhà cung cấp email đang tắt',OUTBOX_UNREADABLE:'Không đọc được hàng đợi email',
  DB_TIMEOUT:'Truy vấn quá thời gian',DB_UNAVAILABLE:'Không kết nối được CSDL',DB_ERROR:'Lỗi CSDL',DB_DEGRADED:'CSDL công ty đang lỗi',
  SUPABASE_UNAVAILABLE:'Không kết nối được Supabase',ENV_NOT_CONFIGURED:'Chưa cấu hình',
  TIMEOUT:'Quá thời gian phản hồi',UNREACHABLE:'Không phản hồi',HEALTH_PROBE_FAILED:'Kiểm tra thất bại',
  CHECKLIST_NOT_READY:'Một kiểm tra phụ chưa xác minh',CHECKLIST_HEALTH_RPC_MISSING:'Một kiểm tra phụ chưa xác minh'
};
function reasonText(c){return c?(REASON_TEXT[c]||String(c)):'';}

var state={loading:false,data:null,error:null,reqSeq:0};

function ensureStyle(){
  if(document.getElementById('phf-syshealth-style'))return;
  var st=document.createElement('style');st.id='phf-syshealth-style';
  st.textContent=[
    '.phf-sh{max-width:1120px;margin:0 auto;padding:0 0 44px;display:grid;gap:16px;color:#17382d;font-family:Arial,Helvetica,system-ui,sans-serif}',
    '.phf-sh-hero{background:linear-gradient(135deg,#10241d 0%,#183a2e 55%,#0c1c17 100%);border:1px solid #22463a;border-radius:18px;padding:22px 24px;color:#eaf5ef;box-shadow:0 18px 40px -18px rgba(4,32,22,.55)}',
    '.phf-sh-hero .k{display:inline-flex;padding:5px 10px;border-radius:999px;background:rgba(255,255,255,.1);color:#5fd0a6;font-size:11px;font-weight:700;letter-spacing:.12em}',
    '.phf-sh-hero h2{margin:10px 0 4px;color:rgba(255,255,255,.96)!important;font-size:24px}',
    '.phf-sh-hero p{margin:0;color:rgba(255,255,255,.72);font-size:13.5px}',
    '.phf-sh-overall{display:flex;flex-wrap:wrap;align-items:center;gap:14px;background:#fff;border:1px solid #dfeee7;border-radius:16px;padding:16px 18px}',
    '.phf-sh-dot{width:14px;height:14px;border-radius:50%;flex:0 0 14px;box-shadow:0 0 0 4px rgba(0,0,0,.04)}',
    '.phf-sh-dot.HEALTHY{background:#1f9d63}.phf-sh-dot.WARNING{background:#c9871b}.phf-sh-dot.ERROR{background:#c0392b}.phf-sh-dot.UNKNOWN{background:#9aa8a2}',
    '.phf-sh-overall b{font-size:17px}',
    '.phf-sh-overall .meta{margin-left:auto;font-size:12px;color:#6b7f76;text-align:right;line-height:1.5}',
    '.phf-sh-btn{min-height:38px;padding:0 16px;border-radius:10px;border:1px solid #07543e;background:#07543e;color:#fff;font-weight:700;cursor:pointer;font:inherit}',
    '.phf-sh-btn.ghost{background:#fff;color:#315448;border-color:#d6e9e1}',
    '.phf-sh-btn[disabled]{opacity:.55;cursor:default}',
    '.phf-sh-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
    '.phf-sh-card{background:#fff;border:1px solid #dfeee7;border-radius:16px;padding:15px 16px;display:grid;gap:8px;border-left:4px solid #cfe0d8}',
    '.phf-sh-card.HEALTHY{border-left-color:#1f9d63}.phf-sh-card.WARNING{border-left-color:#c9871b}.phf-sh-card.ERROR{border-left-color:#c0392b}.phf-sh-card.UNKNOWN{border-left-color:#9aa8a2}',
    '.phf-sh-card .top{display:flex;align-items:center;gap:9px}',
    '.phf-sh-card .top b{font-size:14.5px}',
    '.phf-sh-pill{margin-left:auto;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;border:1px solid transparent}',
    '.phf-sh-pill.HEALTHY{background:#e7f6ee;border-color:#b6e0cb;color:#0b5a43}',
    '.phf-sh-pill.WARNING{background:#fdf3e2;border-color:#f0d9a8;color:#8a5b12}',
    '.phf-sh-pill.ERROR{background:#fde9e6;border-color:#f0cdc2;color:#9a3412}',
    '.phf-sh-pill.UNKNOWN{background:#eef2f0;border-color:#d7e0dc;color:#5f746c}',
    '.phf-sh-card .sub{font-size:12.5px;color:#54685f;line-height:1.55}',
    '.phf-sh-card .kv{font-size:12px;color:#6b7f76}',
    '.phf-sh-foot{font-size:12px;color:#7a8d85;padding:2px 2px}',
    '@media(max-width:760px){.phf-sh-grid{grid-template-columns:1fr}.phf-sh-overall .meta{margin-left:0;text-align:left;width:100%}}'
  ].join('');
  document.head.appendChild(st);
}

function pill(s){return '<span class="phf-sh-pill '+esc(s||'UNKNOWN')+'">'+esc(STATUS_TEXT[s]||STATUS_TEXT.UNKNOWN)+'</span>';}

function lineSub(key,l){
  if(!l)return reasonText('CHECKING');
  var bits=[];
  // Bare status line (no per-probe detail yet) — just say why, honestly.
  if(l.status==='UNKNOWN'&&l.reason&&!l.supabaseMain&&!l.companyPostgres&&!l.recurrence&&l.pending==null&&key!=='backup'){
    return reasonText(l.reason);
  }
  if(key==='database'){
    if(l.supabaseMain)bits.push('Supabase chính: '+(STATUS_TEXT[l.supabaseMain.status]||'—')+(l.supabaseMain.reason?' ('+reasonText(l.supabaseMain.reason)+')':''));
    if(l.companyPostgres){
      var cp=l.companyPostgres;
      bits.push('CSDL công ty: '+(STATUS_TEXT[cp.status]||'—')+(cp.reason?' ('+reasonText(cp.reason)+')':(cp.latencyMs!=null?' ('+cp.latencyMs+' ms)':'')));
    }
    return bits.join('<br>');
  }
  if(key==='api'){
    if(l.uptimeSeconds!=null)bits.push('Thời gian hoạt động: '+ago(l.uptimeSeconds).replace(' trước',''));
    if(l.reason)bits.push(reasonText(l.reason));
    return bits.join(' · ');
  }
  if(key==='jobs'){
    function j(name,o){if(!o)return '';var t=name+': '+(STATUS_TEXT[o.status]||'—');if(o.ageSeconds!=null)t+=' — chạy '+ago(o.ageSeconds);else if(o.reason)t+=' — '+reasonText(o.reason);return t;}
    bits.push(j('Sinh việc định kỳ',l.recurrence));
    bits.push(j('Gửi email nền',l.mailDrainer));
    bits.push(j('Báo cáo tuần',l.weeklyReport));
    if(l.reason&&!l.recurrence)bits.unshift(reasonText(l.reason));
    return bits.filter(Boolean).join('<br>');
  }
  if(key==='mail'){
    if(l.reason&&l.pending==null)return reasonText(l.reason);
    if(l.reason)bits.push(reasonText(l.reason));
    var c=[];
    if(l.pending!=null)c.push(l.pending+' chờ');
    if(l.claimed)c.push(l.claimed+' đang xử lý');
    if(l.failed)c.push(l.failed+' lỗi');
    if(l.sent24h!=null)c.push(l.sent24h+' đã gửi (24h)');
    if(c.length)bits.push(c.join(' · '));
    if(l.latestSentAt)bits.push('Gửi gần nhất: '+fmtTime(l.latestSentAt));
    return bits.join('<br>');
  }
  if(key==='backup'){
    return reasonText(l.reason||'NO_AUTOMATED_SIGNAL');
  }
  // web
  if(l.reason)return reasonText(l.reason);
  return 'Truy cập bình thường';
}

function cardHtml(key,l){
  return '<article class="phf-sh-card '+esc(l.status||'UNKNOWN')+'">'
    +'<div class="top"><b>'+esc(l.title||key)+'</b>'+pill(l.status)+'</div>'
    +'<div class="sub">'+(lineSub(key,l)||'—')+'</div>'
  +'</article>';
}

// The 6 structural cards ALWAYS render — order + fallback title are fixed here,
// so a missing/partial DTO (or an aggregator error) degrades each card to an
// honest UNKNOWN "Chưa xác minh" instead of collapsing the whole grid.
var LINES=[
  ['web','Hệ thống PHF HR'],
  ['api','API công ty'],
  ['database','Cơ sở dữ liệu'],
  ['jobs','Tác vụ nền'],
  ['mail','Email hệ thống'],
  ['backup','Sao lưu']
];

function render(){
  ensureStyle();
  try{if(window.PHFAppShell)window.PHFAppShell.activateHr({clear:false,restoreTitle:false});}catch(e){}
  document.title='PHF HR · Tình trạng hệ thống';
  var d=state.data;
  var linesMap=(d&&d.lines&&typeof d.lines==='object')?d.lines:{};
  var overall=(d&&d.overall)||{status:'UNKNOWN',label:STATUS_TEXT.UNKNOWN};
  // 6 cards, always. A line the DTO did not carry -> honest UNKNOWN card.
  var cards=LINES.map(function(pair){
    var key=pair[0];
    var l=linesMap[key];
    if(!l||typeof l!=='object'){l={status:'UNKNOWN',title:pair[1],reason:state.error?'READ_FAILED':(state.loading&&!d?'CHECKING':'')};}
    else if(!l.title){l.title=pair[1];}
    return cardHtml(key,l);
  }).join('');
  var note='Các chỉ số được kiểm tra khi bạn mở trang này, không theo dõi liên tục.';
  if(state.error)note='Không đọc được dữ liệu tình trạng ('+esc(state.error)+') — các mục hiển thị "Chưa xác minh".';
  main().innerHTML='<section class="phf-sh">'
    +'<div class="phf-sh-hero"><span class="k">HỆ THỐNG · TÌNH TRẠNG</span><h2>Tình trạng hệ thống</h2></div>'
    +'<div class="phf-sh-overall">'
      +'<span class="phf-sh-dot '+esc(overall.status)+'"></span>'
      +'<b>'+esc(overall.label||STATUS_TEXT[overall.status]||'—')+'</b>'
      +'<button type="button" class="phf-sh-btn" id="phfShRecheck"'+(state.loading?' disabled':'')+'>'+(state.loading?'Đang kiểm tra…':'Kiểm tra lại')+'</button>'
      +'<span class="meta">'
        +(state.loading?'Đang kiểm tra…':(d&&d.checkedAt?('Kiểm tra lúc '+esc(fmtTime(d.checkedAt))):'Chưa kiểm tra'))
        +(d&&d.version?('<br>Phiên bản '+esc(d.version)):'')
      +'</span>'
    +'</div>'
    +'<div class="phf-sh-grid">'+cards+'</div>'
    +'<div class="phf-sh-foot">'+note+'</div>'
  +'</section>';
  var b=document.getElementById('phfShRecheck');
  if(b)b.addEventListener('click',function(){load();});
}

async function load(){
  if(state.loading)return;
  var seq=++state.reqSeq;              // stale-response guard
  state.loading=true;render();
  var nextData=state.data,nextErr=null;
  try{
    var res=await fetch('/api/data?systemHealth=1',{credentials:'same-origin',cache:'no-store',headers:{'Accept':'application/json'}});
    var j=await res.json().catch(function(){return {};});
    if(!res.ok||j.ok===false||!j.lines){
      nextErr=(j&&j.error)||('HTTP '+res.status);
      // keep the last good snapshot if we had one; the note explains the failure
    }else{nextData=j;nextErr=null;}
  }catch(e){nextErr='Lỗi kết nối';}
  if(seq!==state.reqSeq)return;        // a newer refresh already superseded this one
  state.data=nextData;state.error=nextErr;state.loading=false;
  render();
}

window.phfRenderSystemHealth=function(){
  if(role()!=='admin'){if(window.phfNavigate)return window.phfNavigate('/admin/home',true);return false;}
  state.data=null;state.error=null;state.reqSeq=0;
  render();load();
  return true;
};
})();
