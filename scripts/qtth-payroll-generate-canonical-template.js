'use strict';
/*
 * PHF QTTH — generate the DOWNLOADABLE payroll template
 *   assets/templates/PHF_Payroll_Canonical_V1.xlsx
 *
 * Canonical source = docs/payroll-corpus/T7_CANONICAL.tsv (T07/2026, the locked
 * "PHF Payroll Canonical Upload Template V1"). This script keeps ONLY the header
 * structure (banner + reference labels + the 3 canonical header rows: group,
 * label, number) and DROPS every employee data row. It also neutralises the
 * period in the banner and blanks the reference constants — so the output has
 * ZERO real employee/salary/bank/tax data while staying byte-compatible with the
 * importer (same column map => same fingerprint => "Đúng mẫu chuẩn V1").
 *
 * Re-run this whenever the canonical T07 structure changes. Commit the .xlsx.
 * Run: node scripts/qtth-payroll-generate-canonical-template.js
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const TPL = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-template'));
const { gridToXlsx } = require(path.join(REPO, 'scripts/lib/xlsx-write-lite'));

const SRC = path.join(REPO, 'docs/payroll-corpus/T7_CANONICAL.tsv');
const OUT = path.join(REPO, 'assets/templates/PHF_Payroll_Canonical_V1.xlsx');
const TEMPLATE_VERSION = 1;
const TEMPLATE_NAME = 'PHF Payroll Canonical V1';
const VERSION_MARKER = 'PHF_PAYROLL_TEMPLATE_VERSION=' + TEMPLATE_VERSION;

function readTsv(p) {
  let s = fs.readFileSync(p, 'utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return s.split(/\r?\n/).map((l) => l.split('\t'));
}

function build() {
  const rows = readTsv(SRC);
  const hdr = TPL.locateHeader(rows);
  if (!hdr) throw new Error('locateHeader failed on canonical source');

  // keep rows [0 .. numberRow] — banner + reference + group/label/number header.
  // DROP every row from dataStart onward (all employees).
  const grid = rows.slice(0, hdr.numberRow + 1).map((r) => r.slice());

  // --- sanitise the banner / reference area (rows above the header) ---
  for (let r = 0; r < hdr.groupRow; r++) {
    const row = grid[r] || (grid[r] = []);
    for (let c = 0; c < row.length; c++) {
      let v = String(row[c] == null ? '' : row[c]);
      if (!v) continue;
      // neutralise the period ("... NHÂN VIÊN T07/2026")
      v = v.replace(/(NH[ÂA]N VI[ÊE]N)\s+T\d{1,2}\/\d{4}/i, '$1 [KỲ LƯƠNG]');
      // strip a trailing value after a colon ("MST: 3703182824" -> "MST:",
      // "Ngày hiệu lực: 01/06/2025" -> "Ngày hiệu lực:") — keeps the label,
      // drops any org number / date in the banner.
      v = v.replace(/:\s*[\d.,\/\s-]+$/, ':');
      // blank any bare number in the reference block (rates / std-day counts).
      if (/^-?\d+(?:[.,]\d+)?$/.test(v.trim())) v = '';
      row[c] = v;
    }
  }

  // --- version + instruction marker on the blank row just above the header ---
  // (locateHeader ignores this row; it is not group/label/number.)
  const markerRow = Math.max(0, hdr.groupRow - 1);
  grid[markerRow] = grid[markerRow] || [];
  grid[markerRow][0] =
    'MẪU CHUẨN — ' + TEMPLATE_NAME + ' (' + VERSION_MARKER + '). '
    + 'Điền dữ liệu nhân viên từ dòng ' + (hdr.numberRow + 2) + ' trở xuống. '
    + 'KHÔNG sửa 3 dòng tiêu đề (nhóm cột / tên cột / số thứ tự cột). '
    + 'Sau khi điền: Nhập bảng lương → Kiểm tra → (Đối chiếu cột nếu khác mẫu) → Xem trước → Xác nhận.';

  const xlsx = gridToXlsx(grid, {
    sheetName: TEMPLATE_NAME,
    description: 'PHF HR — ' + TEMPLATE_NAME + '. Mẫu bảng lương chuẩn để lập bảng lương các kỳ mới. Không chứa dữ liệu nhân viên thật.',
    keywords: VERSION_MARKER,
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, xlsx);

  return { grid, hdr, bytes: xlsx.length };
}

if (require.main === module) {
  const { grid, hdr, bytes } = build();
  console.log('wrote ' + path.relative(REPO, OUT) + '  (' + bytes + ' bytes)');
  console.log('rows kept: ' + grid.length + '  (header at group=' + hdr.groupRow + ' label=' + hdr.labelRow + ' number=' + hdr.numberRow + ', 0 data rows)');
  console.log('version : ' + VERSION_MARKER);
}

module.exports = { build, OUT, TEMPLATE_VERSION, TEMPLATE_NAME, VERSION_MARKER };
