'use strict';
/*
 * PHF QTTH — generate the DOWNLOADABLE BHXH template
 *   assets/templates/PHF_BHXH_Canonical_V1.xlsx
 *
 * Structure copied verbatim from services/phf-hr-api/lib/qtth-bhxh-template.js
 * (the parser/fingerprint source of truth) and cross-checked against every
 * production sample phf-qtth-input/BHXH T1..T7.xlsx, which all fingerprint
 * to the SAME value 6ffd3c70abeedcfd78ead91e744f90d1 — that is the locked
 * target for this generated template:
 *   - 1 header label row (index 3) directly above the data, no group row.
 *   - Row right after the label row is a full blank spacer -> dataStart = 5.
 *   - Column order/labels, incl. the known D-BHXH-02 header/data mismatch on
 *     col4 ("Ngày tháng năm sinh" header, branch-name data) — kept EXACTLY
 *     as production so the template exercises the real label-matching path,
 *     not the position fallback.
 *
 * One placeholder data row only, to show the expected shape/format:
 *   - employee_code "PHFxxx" — deliberately NOT matching the real
 *     ^PHF[0-9]{3,6}$ pattern, so it can never collide with or be mistaken
 *     for a real employee code (same convention as the Processing Cost
 *     template).
 *   - name/dept/branch are obviously-fake "(Ví dụ) ..." labels.
 *   - every money column is 0 — never a real financial figure.
 * No sheet "TỔNG…" total row is included (optional; reconciliation-only).
 *
 * Re-run when the canonical BHXH structure changes; commit the .xlsx.
 * Run: node scripts/qtth-bhxh-generate-canonical-template.js
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const { gridToXlsx } = require(path.join(REPO, 'scripts/lib/xlsx-write-lite'));

const OUT = path.join(REPO, 'assets/templates/PHF_BHXH_Canonical_V1.xlsx');
const TEMPLATE_VERSION = 1;
const TEMPLATE_NAME = 'PHF BHXH Canonical Template V1';
const VERSION_MARKER = 'PHF_BHXH_TEMPLATE_VERSION=' + TEMPLATE_VERSION;
const SHEET_NAME = 'TỔNG_BHXH';
const LOCKED_FINGERPRINT = '6ffd3c70abeedcfd78ead91e744f90d1';

// Verbatim from phf-qtth-input/BHXH T1..T7.xlsx row 3 (0-based).
const HEADERS = [
  'Số\r\n TT', 'Họ và tên', 'ID', 'phòng ban', 'Ngày tháng năm sinh',
  'Mức lương đóng BHXH', 'TK 642\r\n(21.5%)', 'TK 334\r\n(10.5%)', 'BHXH',
  'Trả 4.5% BHYT', 'Thu tiền trước BHYT', 'Tổng tiền NV đóng',
  'GHI CHÚ', 'CN LÀM VIỆC', 'TG\r\ntham gia', 'Chức vụ', 'BP TÍNH',
];
const WIDTH = HEADERS.length;
const NUMERIC_COLS = [5, 6, 7, 8, 9, 10, 11]; // base salary + TK642/TK334/BHXH/BHYT/contribution columns
const PLACEHOLDER_ROW = [
  '1', '(Ví dụ) Nguyễn Văn A', 'PHFxxx', '(Ví dụ) Phòng ban', '(Ví dụ) Chi nhánh',
  '0', '0', '0', '0', '0', '0', '0', '', '', '', '', '',
];

function pad(row) { const r = row.slice(); while (r.length < WIDTH) r.push(''); return r.slice(0, WIDTH); }

function build() {
  const grid = [
    pad([]),                                    // row0 blank
    pad([]),                                    // row1 blank
    pad(['CHI TIẾT THAM GIA BHXH']),            // row2 banner (period intentionally omitted)
    pad(HEADERS),                                // row3 label header
    pad([]),                                    // row4 blank spacer -> dataStart = 5
    pad(PLACEHOLDER_ROW),                        // row5 one placeholder example row
  ];

  const style = {
    cols: [
      { min: 1, max: 1, width: 6 },   // Số TT
      { min: 2, max: 2, width: 26 },  // Họ và tên
      { min: 3, max: 3, width: 12 },  // ID
      { min: 4, max: 4, width: 20 },  // phòng ban
      { min: 5, max: 5, width: 18 },  // Ngày tháng năm sinh (= chi nhánh)
      { min: 6, max: 12, width: 14 }, // numeric columns
      { min: 13, max: 17, width: 14 },
    ],
    rowHeights: { 3: 24, 4: 36 },
    freeze: { rows: 4, cols: 0 }, // freeze through the label header row (0-based row3 -> 1-based 4)
    cellStyles: Object.fromEntries(
      Array.from({ length: WIDTH }, (_, c) => [String.fromCharCode(65 + c) + '4', 'colHeader'])
    ),
    colStyles: { [Math.min(...NUMERIC_COLS) + '-' + Math.max(...NUMERIC_COLS)]: 'money' },
    dataStartRow: 6, // 1-based (0-based row5)
  };

  const xlsx = gridToXlsx(grid, {
    sheetName: SHEET_NAME,
    description: 'PHF HR — ' + TEMPLATE_NAME + '. Mẫu BHXH chuẩn (cấu trúc 1:1 với file BHXH gốc). '
      + 'Không chứa dữ liệu nhân viên thật — dòng ví dụ là dữ liệu giả (PHFxxx).',
    keywords: VERSION_MARKER,
    style,
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, xlsx);
  return { grid, bytes: xlsx.length };
}

if (require.main === module) {
  const r = build();
  console.log('wrote ' + path.relative(REPO, OUT) + '  (' + r.bytes + ' bytes)');
  console.log('sheet "' + SHEET_NAME + '"  header row=3  dataStart=5  width=' + WIDTH + '  1 placeholder row (no real employee data)');
  console.log('version : ' + VERSION_MARKER + '  (docProps only; not in the sheet body)');
  console.log('target fingerprint (from production T1..T7): ' + LOCKED_FINGERPRINT);
}

module.exports = {
  build, OUT, TEMPLATE_VERSION, TEMPLATE_NAME, VERSION_MARKER, SHEET_NAME,
  HEADERS, PLACEHOLDER_ROW, LOCKED_FINGERPRINT,
};
