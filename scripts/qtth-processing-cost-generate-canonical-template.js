'use strict';
/*
 * PHF QTTH — generate the DOWNLOADABLE "Chi phí xử lý" template
 *   assets/templates/PHF_ProcessingCost_Canonical_V1.xlsx
 *
 * Fixed 3-column schema, in this exact order: MÃ NV | HỌ VÀ TÊN | CHI PHÍ XỬ LÝ.
 * Period is chosen on the web UI at upload time — NOT a column in this file.
 *
 * Contains NO real employee data: one clearly-fake placeholder row
 * ("PHFxxx" / "(Ví dụ) Nguyễn Văn A" / 0) is included to show the expected
 * shape/format to the uploader; it is obviously not a real employee code
 * (People Master codes are never "PHFxxx") and amount 0 so it can never be
 * mistaken for a real financial figure if someone forgets to delete the row.
 *
 * Re-run when the canonical structure changes; commit the .xlsx.
 * Run: node scripts/qtth-processing-cost-generate-canonical-template.js
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const { gridToXlsx } = require(path.join(REPO, 'scripts/lib/xlsx-write-lite'));

const OUT = path.join(REPO, 'assets/templates/PHF_ProcessingCost_Canonical_V1.xlsx');
const TEMPLATE_VERSION = 1;
const TEMPLATE_NAME = 'PHF Processing Cost Canonical V1';
const VERSION_MARKER = 'PHF_PROCESSINGCOST_TEMPLATE_VERSION=' + TEMPLATE_VERSION;
const HEADERS = ['MÃ NV', 'HỌ VÀ TÊN', 'CHI PHÍ XỬ LÝ'];
const PLACEHOLDER_ROW = ['PHFxxx', '(Ví dụ) Nguyễn Văn A', '0'];

function build() {
  const grid = [HEADERS.slice(), PLACEHOLDER_ROW.slice()];

  const style = {
    cols: [{ min: 1, max: 1, width: 14 }, { min: 2, max: 2, width: 28 }, { min: 3, max: 3, width: 18 }],
    rowHeights: { 1: 22 },
    freeze: { rows: 1, cols: 0 },
    cellStyles: { A1: 'colHeader', B1: 'colHeader', C1: 'colHeader' },
    colStyles: { '2-2': 'money' }, // CHI PHÍ XỬ LÝ (0-based col 2) -> money format
    dataStartRow: 2,
  };

  const xlsx = gridToXlsx(grid, {
    sheetName: TEMPLATE_NAME,
    description: 'PHF HR — ' + TEMPLATE_NAME + '. Mẫu Chi phí xử lý chuẩn (3 cột: MÃ NV, HỌ VÀ TÊN, CHI PHÍ XỬ LÝ). '
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
  console.log('columns: ' + HEADERS.join(' | ') + '  ·  1 placeholder row (no real employee data)');
  console.log('version : ' + VERSION_MARKER + '  (docProps only; not in the sheet body)');
}

module.exports = { build, OUT, TEMPLATE_VERSION, TEMPLATE_NAME, VERSION_MARKER, HEADERS, PLACEHOLDER_ROW };
