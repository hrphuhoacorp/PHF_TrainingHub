'use strict';
/* Batch D2A: structural regression cho nhan UI "Cung loi N lan trong ngay"
   (sameDayRepeatChipHtml) trong assets/js/checklist/phf-checklist-app.js.

   Cung huong tiep can source-scanning nhu
   scripts/test-checklist-assessment-profile-ui.js: logic render nam trong
   1 IIFE lon, khong co jsdom trong repo nay, nen test nay khang dinh dung
   wiring/gia tri chu, khong dung DOM that. Click-through thu cong van can.

   File nay KHONG duoc goi tu dong o bat ky dau - chi chay thu cong:
     node scripts/test-checklist-violation-repeat-same-day-ui.js
*/
const fs = require('fs');
const path = require('path');

const appPath = path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js');
const cssPath = path.resolve(__dirname, '..', 'assets/css/phf-checklist.css');
const app = fs.readFileSync(appPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}

// ---------- Ham chip ----------
const chipFnMatch = app.match(/function sameDayRepeatChipHtml\(r\)\{([\s\S]*?)\}\n/);
check(!!chipFnMatch, 'A. sameDayRepeatChipHtml() ton tai');
const chipBody = chipFnMatch ? chipFnMatch[1] : '';

check(/record_status===['"]cancelled['"]/.test(chipBody), 'B. Chip gate theo record_status===\'cancelled\' (khong hien cho ban ghi da huy)');
check(/n>1/.test(chipBody), 'C. Chip chi hien khi n>1 (N<=1 khong hien nhan)');
check(/Number\(r&&r\.repeatSameDayCount\|\|0\)/.test(chipBody) || /Number\(r\.repeatSameDayCount/.test(chipBody), 'D. n duoc ep ve Number(), khong noi truc tiep chuoi tho tu server (chong XSS qua truong khac)');
check(/Cùng lỗi '\+n\+' lần trong ngày/.test(chipBody), 'E. Dung dung noi dung "Cùng lỗi N lần trong ngày"');
check(/Các ghi nhận vẫn được xử lý độc lập\./.test(chipBody), 'F. Co tooltip "Các ghi nhận vẫn được xử lý độc lập."');
check(/phfck-chip-warning/.test(chipBody), 'G. Dung class phfck-chip-warning (vang/cam nhat co san), khong tao mau do canh bao nghiem trong moi');

const bannedWords = ['Trùng lỗi', 'Lỗi bị ghi trùng', 'Nghi ngờ trùng', 'Chờ xác minh'];
bannedWords.forEach(w => {
  check(!chipBody.includes(w), 'H. Khong dung chu cam "' + w + '" trong noi dung nhan');
});

// Chip khong noi truc tiep bat ky truong van ban tho nao khac (note/location/
// created_by/...) - chi dung n (so) va van ban tinh san.
check(!/r\.note|r\.location|r\.created_by/.test(chipBody), 'I. Chip khong doc them truong note/location/created_by (chi dung repeatSameDayCount va record_status)');

// ---------- Wiring vao 2 noi da chot (Nhat ky loi + Chi tiet) ----------
const rowsFnMatch = app.match(/function violationLogRowsHtml\(\)\{([\s\S]*?)\n  \}/);
check(!!rowsFnMatch, 'J0. violationLogRowsHtml() tim thay');
check(!!rowsFnMatch && /sameDayRepeatChipHtml\(r\)/.test(rowsFnMatch[1]), 'J. violationLogRowsHtml() (dong Nhat ky loi) co goi sameDayRepeatChipHtml(r)');

const detailFnMatch = app.match(/function violationLogDetailHtml\(id\)\{([\s\S]*?)\n  \}/);
check(!!detailFnMatch, 'K0. violationLogDetailHtml() tim thay');
check(!!detailFnMatch && /sameDayRepeatChipHtml\(r\)/.test(detailFnMatch[1]), 'K. violationLogDetailHtml() (Chi tiet ban ghi) co goi sameDayRepeatChipHtml(r)');
check(!!detailFnMatch && /Cùng lỗi trong ngày/.test(detailFnMatch[1]), 'L. Chi tiet ban ghi co nhan o o "Cùng lỗi trong ngày" bao ngoai chip');

// Khong dua nhan vao man Viec can xu ly/Nhan vien tu xem (D2A da chot chi
// Nhat ky loi + Chi tiet - taskCardsHtml/employeeTaskInboxHtml khong duoc sua).
const taskCardsFnMatch = app.match(/function taskCardsHtml\(\)\{([\s\S]*?)\n  \}/);
check(!taskCardsFnMatch || !/sameDayRepeatChipHtml/.test(taskCardsFnMatch[1]), 'M. taskCardsHtml() (Danh sach can xu ly) KHONG goi sameDayRepeatChipHtml - dung pham vi D2A da chot');
const employeeInboxFnMatch = app.match(/function employeeTaskInboxHtml\(\)\{([\s\S]*?)\n  \}/);
check(!employeeInboxFnMatch || !/sameDayRepeatChipHtml/.test(employeeInboxFnMatch[1]), 'N. employeeTaskInboxHtml() (Nhan vien tu xem) KHONG goi sameDayRepeatChipHtml - dung pham vi D2A da chot');

// ---------- CSS: khong vo mobile (co rule margin, khong ep width co dinh) ----------
check(/\.phfck-repeat-chip\{[^}]*margin-top/.test(css), 'O. CSS .phfck-repeat-chip co margin-top (tach dong voi ten/ma tieu chi phia tren)');
check(!/\.phfck-repeat-chip\{[^}]*width:\d/.test(css), 'P. CSS .phfck-repeat-chip khong ep width co dinh (an toan tren man hinh nho, chip tu co giai theo noi dung)');

if (failures) {
  console.error('\n' + failures + ' check(s) failed.');
  process.exit(1);
}
console.log('\nAll checks passed.');
