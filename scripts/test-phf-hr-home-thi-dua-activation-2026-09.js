'use strict';
/* PHF HR Home — Chương trình thi đua entry activation (static source check).
 *
 * assets/js/phf-hr-home.js has no existing test harness/exported hooks (an
 * IIFE with no window.__phfHrHomeTestHooks) — this file checks the source
 * text directly rather than inventing a new execution harness for it, same
 * class of check phf-check-js.js already uses elsewhere in this repo.
 *
 * Activates ONLY "Chương trình thi đua" (nav item + Home card): a real href
 * built from the same role-prefix convention every other working entry uses
 * (p+'/task', p+'/classroom', p+'/knl', ...), badge added to match other
 * active cards. "Thưởng Hành động V.2" MUST stay soon:true — this batch is
 * Competition only, per the explicit instruction not to activate it yet.
 */
const assert = require('assert');
const fs = require('fs');

const src = fs.readFileSync('assets/js/phf-hr-home.js', 'utf8');
let passed = 0;
function check(cond, msg) { assert.ok(cond, msg); passed++; console.log('PASS', msg); }

check((src.match(/\(/g) || []).length === (src.match(/\)/g) || []).length, 'parens balanced (sanity)');

console.log('\n== SIDEBAR MEGA-MENU (hrNavModel) ==');
{
  check(/\{label:'Chương trình thi đua',href:p\+'\/thi-dua',icon:'trophy'\}/.test(src),
    '"Chương trình thi đua" nav child now has href=p+\'/thi-dua\' (same role-prefix convention as every other working entry)');
  check(/\{label:'Thưởng Hành động V\.2',soon:true,icon:'sparkles'\}/.test(src),
    '"Thưởng Hành động V.2" nav child stays soon:true — NOT activated in this batch');
}

console.log('\n== HOME MODULE CARD (hrGroupsModel) ==');
{
  check(/title:'Chương trình thi đua',desc:'Đóng góp • Xếp hạng • Vinh danh',badge:'Thi đua',href:p\+'\/thi-dua'/.test(src),
    '"Chương trình thi đua" Home card now has a badge + href=p+\'/thi-dua\', matching the active-card pattern (badge+href, no soon:true)');
  check(/title:'Thưởng Hành động V\.2',desc:'Ghi nhận • Xét thưởng • Lan tỏa',soon:true/.test(src),
    '"Thưởng Hành động V.2" Home card stays soon:true — NOT activated in this batch');
}

console.log('\n== ROLE-PREFIX ROUTING IS THE SAME MECHANISM ALREADY LIVE FOR OTHER MODULES ==');
{
  // p = prefix() = '/admin' | '/ql' | '/hv' depending on role() — the exact
  // convention PHF Task/Classroom/KNL cards already use successfully; the
  // Competition route registrations (/admin|ql|hv/thi-dua) already exist in
  // phf-url-router.js (a separate, unmodified file in this batch), so this
  // reuses working infrastructure rather than inventing new routing.
  check(/var p=prefix\(\),r=role\(\);/.test(src), 'hrGroupsModel() still derives p from the same prefix()/role() helpers other active cards depend on');
}

console.log('\nALL PASS (' + passed + ' checks)');
