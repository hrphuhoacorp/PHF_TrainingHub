'use strict';

// PHF HR — QTTH Truth Data · Accounting · FAST "Danh mục phí" (Cost Dictionary)
// parser. Small workbook (~20 KB, 170 rows) — xlsx-lite handles it fine.
//
// Reference data ONLY. It is NEVER joined to transaction lines by keyword in V1
// (no true join key — Operator §12). normalized.cost_code stays UNRESOLVED.

const { readWorkbook } = require('./xlsx-lite');

class AccountingDictError extends Error {
  constructor(m, c) { super(m); this.code = c || 'ACCOUNTING_DICT_ERROR'; this.statusCode = 400; this.isAccountingDictError = true; }
}

const HEADERS = ['Mã phí', 'Tên phí', 'Bộ phận', 'Nhóm 1', 'Tên nhóm 1', 'Nhóm 2', 'Tên nhóm 2', 'Nhóm 3', 'Tên nhóm 3', 'Ghi chú'];
const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// parseCostDictionary(buffer) -> { entries: [{maPhi, tenPhi, boPhan, nhom1, tenNhom1, ...}], sheetName }
function parseCostDictionary(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 4 || buf.readUInt16LE(0) !== 0x4b50) throw new AccountingDictError('File Danh mục phí không phải .xlsx hợp lệ.', 'ACCOUNTING_DICT_NOT_XLSX');
  let wb;
  try { wb = readWorkbook(buf); } catch (e) { throw new AccountingDictError('Không đọc được file Danh mục phí: ' + e.message, 'ACCOUNTING_DICT_PARSE'); }
  const sheet = wb.sheets[0];
  const rows = sheet.rows;
  const hdrIdx = rows.findIndex((r) => norm(r[0]) === 'Mã phí' && norm(r[1]) === 'Tên phí');
  if (hdrIdx < 0) throw new AccountingDictError('Không tìm thấy hàng tiêu đề Danh mục phí (Mã phí / Tên phí).', 'ACCOUNTING_DICT_NO_HEADER');

  const entries = [];
  const seen = new Set();
  for (let i = hdrIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const maPhi = norm(r[0]);
    if (!maPhi) continue;
    if (seen.has(maPhi)) continue;
    seen.add(maPhi);
    entries.push({
      maPhi,
      tenPhi: norm(r[1]) || null,
      boPhan: norm(r[2]) || null,
      nhom1: norm(r[3]) || null, tenNhom1: norm(r[4]) || null,
      nhom2: norm(r[5]) || null, tenNhom2: norm(r[6]) || null,
      nhom3: norm(r[7]) || null, tenNhom3: norm(r[8]) || null,
      ghiChu: norm(r[9]) || null,
    });
  }
  if (!entries.length) throw new AccountingDictError('Danh mục phí không có dòng dữ liệu nào.', 'ACCOUNTING_DICT_EMPTY');
  return { sheetName: sheet.name, entries };
}

module.exports = { parseCostDictionary, AccountingDictError, HEADERS };
