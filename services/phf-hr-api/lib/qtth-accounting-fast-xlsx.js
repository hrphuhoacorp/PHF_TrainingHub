'use strict';

// PHF HR — QTTH Truth Data · Accounting · STREAMING reader for the FAST
// "Bảng kê chứng từ theo bộ phận" export.
//
// WHY A DEDICATED READER (not xlsx-lite):
//   The FAST export is a single ~73 MB xl/worksheets/sheet1.xml with ALL strings
//   inline (no sharedStrings), ~86k rows, and non-self-closing <sheet> tags that
//   xlsx-lite's workbook regex rejects. Loading the whole sheet as one string +
//   one global regex (xlsx-lite's model) is exactly what the Operator handover
//   §6 forbids. This reader inflates the ZIP entry with a STREAMING
//   zlib.InflateRaw and emits one row object at a time — constant memory,
//   never the whole grid.
//
// It reads ONLY the fixed FAST column layout (A..K):
//   0 Ngày ct · 1 Mã ct · 2 Số ct · 3 Mã khách · 4 Tên khách hàng · 5 Diễn giải
//   6 Tài khoản · 7 Tk đối ứng · 8 Phát sinh nợ · 9 Phát sinh có · 10 Mã bp
//
// Public: await readFastExport(buffer, onRow) -> { sheetName, headerRowIndex,
//   fromDate, toDate, sourceRowCount }. `onRow(row)` gets
//   { rowIndex, ngayCt, maCt, soCt, maKhach, tenKhach, dienGiai, taiKhoan,
//     tkDoiUng, phatSinhNo, phatSinhCo, maBp } — strings + two numbers.
// Throws AccountingXlsxError on a structural problem (never guesses).

const zlib = require('zlib');

class AccountingXlsxError extends Error {
  constructor(message, code) { super(message); this.code = code || 'ACCOUNTING_XLSX_ERROR'; this.isAccountingXlsxError = true; this.statusCode = 400; }
}
function fail(msg, code) { throw new AccountingXlsxError(msg, code); }

const FAST_HEADERS = ['Ngày ct', 'Mã ct', 'Số ct', 'Mã khách', 'Tên khách hàng', 'Diễn giải', 'Tài khoản', 'Tk đối ứng', 'Phát sinh nợ', 'Phát sinh có', 'Mã bp'];

// ---- ZIP: locate one entry, return { compBuf, method } --------------------
function findEocd(buf) {
  const min = 22;
  const start = Math.max(0, buf.length - (min + 0xffff));
  for (let i = buf.length - min; i >= start; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  fail('File không phải .xlsx (thiếu ZIP End-Of-Central-Directory).', 'ACCOUNTING_XLSX_NOT_ZIP');
}
function zipEntry(buf, wantName) {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) fail('ZIP central directory hỏng.', 'ACCOUNTING_XLSX_ZIP_CORRUPT');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wantName || name === wantName.replace(/^\//, '')) {
      if (buf.readUInt32LE(localOff) !== 0x04034b50) fail('ZIP local header hỏng.', 'ACCOUNTING_XLSX_ZIP_CORRUPT');
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      return { compBuf: buf.subarray(dataStart, dataStart + compSize), method };
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}
function listEntryNames(buf) {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    names.push(buf.toString('utf8', p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

// ---- XML helpers ---------------------------------------------------------
function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function colRefToIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function toNumber(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/[,\s]/g, '').replace(/ /g, ''));
  return Number.isFinite(n) ? n : 0;
}
function toDate(v) {
  const s = String(v || '').trim();
  let m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Excel serial date (number) — FAST usually writes dd/mm/yyyy text, but guard.
  const serial = Number(s);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

// Parse ONE <row ...>...</row> fragment -> dense cell array (index -> string).
function parseRowCells(rowXml) {
  const cells = [];
  const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = cRe.exec(rowXml))) {
    const attrs = m[1] || '';
    const inner = m[2] || '';
    const rAttr = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
    const tAttr = (attrs.match(/\bt="([^"]+)"/) || [])[1] || 'n';
    const ci = rAttr ? colRefToIndex(rAttr) : cells.length;
    if (ci < 0) continue;
    let val = '';
    if (tAttr === 'inlineStr') {
      const t = inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
      // multiple <r><t> runs -> concat
      if (/<r>/.test(inner)) {
        val = (inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || []).map((x) => decodeEntities(x.replace(/<[^>]+>/g, ''))).join('');
      } else {
        val = t ? decodeEntities(t[1]) : '';
      }
    } else if (tAttr === 'str') {
      const v = inner.match(/<v>([\s\S]*?)<\/v>/);
      const t = inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
      val = decodeEntities(v ? v[1] : (t ? t[1] : ''));
    } else { // n, b, e, s — FAST has no sharedStrings so 's' shouldn't occur
      const v = inner.match(/<v>([\s\S]*?)<\/v>/);
      val = v ? decodeEntities(v[1]) : '';
    }
    cells[ci] = val;
  }
  return cells;
}

// ---- main -------------------------------------------------------------
async function readFastExport(buffer, onRow) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 4 || buf.readUInt16LE(0) !== 0x4b50) fail('File không phải .xlsx hợp lệ.', 'ACCOUNTING_XLSX_NOT_XLSX');

  // FAST always writes a single worksheet part. Prefer sheet1.xml; else the
  // first xl/worksheets/*.xml in the archive.
  let entry = zipEntry(buf, 'xl/worksheets/sheet1.xml');
  if (!entry) {
    const sheetName = listEntryNames(buf).find((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n));
    if (sheetName) entry = zipEntry(buf, sheetName);
  }
  if (!entry) fail('Không tìm thấy worksheet trong file FAST.', 'ACCOUNTING_XLSX_NO_SHEET');

  const inflate = entry.method === 8
    ? zlib.createInflateRaw()
    : entry.method === 0
      ? null
      : fail('Phương thức nén ZIP không hỗ trợ (method ' + entry.method + ').', 'ACCOUNTING_XLSX_ZIP_METHOD');

  const state = {
    tail: '',
    sheetName: 'Sheet1',
    headerRowIndex: null,
    fromDate: null,
    toDate: null,
    sourceRowCount: 0,
    started: false,
    sawHeader: false,
  };

  function handleChunk(text) {
    state.tail += text;
    // band with the reporting date range (before header)
    if (!state.fromDate) {
      const band = state.tail.match(/Từ ngày\s*([0-9/\-.]+)\s*đến ngày\s*([0-9/\-.]+)/);
      if (band) { state.fromDate = toDate(band[1]); state.toDate = toDate(band[2]); }
    }
    let idx;
    while ((idx = state.tail.indexOf('</row>')) !== -1) {
      const rowXml = state.tail.slice(0, idx + 6);
      state.tail = state.tail.slice(idx + 6);
      const rMatch = rowXml.match(/<row\b[^>]*\br="(\d+)"/);
      const rowIndex = rMatch ? parseInt(rMatch[1], 10) : null;
      const cells = parseRowCells(rowXml);
      const taiKhoan = String(cells[6] || '').trim();

      if (!state.sawHeader) {
        // header = the row whose col G is exactly "Tài khoản"
        if (taiKhoan === 'Tài khoản') {
          state.sawHeader = true;
          state.headerRowIndex = rowIndex;
          // structural guard — verify a few key headers are where FAST puts them
          const bad = [];
          [0, 6, 8, 9, 10].forEach((c) => {
            if (String(cells[c] || '').trim() !== FAST_HEADERS[c]) bad.push(FAST_HEADERS[c]);
          });
          if (bad.length) fail('Cấu trúc file FAST không đúng (thiếu/cột sai: ' + bad.join(', ') + ').', 'ACCOUNTING_XLSX_LAYOUT');
        }
        continue;
      }

      const no = toNumber(cells[8]);
      const co = toNumber(cells[9]);
      const dienGiai = String(cells[5] || '').trim();
      // skip FAST subtotal / blank rows: no account AND no amounts AND no description
      if (!taiKhoan && !no && !co && !dienGiai) continue;

      state.sourceRowCount++;
      onRow({
        rowIndex,
        ngayCt: toDate(cells[0]),
        maCt: String(cells[1] || '').trim(),
        soCt: String(cells[2] || '').trim(),
        maKhach: String(cells[3] || '').trim(),
        tenKhach: String(cells[4] || '').trim(),
        dienGiai,
        taiKhoan,
        tkDoiUng: String(cells[7] || '').trim(),
        phatSinhNo: no,
        phatSinhCo: co,
        maBp: String(cells[10] || '').trim(),
      });
    }
    // bound the tail so a pathological no-</row> stream can't grow unbounded
    if (state.tail.length > 4 * 1024 * 1024) fail('Luồng XML worksheet bất thường (không thấy kết thúc dòng).', 'ACCOUNTING_XLSX_STREAM');
  }

  await new Promise((resolve, reject) => {
    const onErr = (e) => reject(e && e.isAccountingXlsxError ? e : new AccountingXlsxError('Không đọc được worksheet FAST: ' + (e && e.message), 'ACCOUNTING_XLSX_INFLATE'));
    if (!inflate) {
      try { handleChunk(entry.compBuf.toString('utf8')); resolve(); } catch (e) { onErr(e); }
      return;
    }
    inflate.setEncoding('utf8');
    inflate.on('data', (t) => { try { handleChunk(t); } catch (e) { inflate.destroy(); onErr(e); } });
    inflate.on('end', resolve);
    inflate.on('error', onErr);
    inflate.end(entry.compBuf);
  });

  if (!state.sawHeader) fail('Không tìm thấy hàng tiêu đề FAST (cột "Tài khoản").', 'ACCOUNTING_XLSX_NO_HEADER');
  return {
    sheetName: state.sheetName,
    headerRowIndex: state.headerRowIndex,
    fromDate: state.fromDate,
    toDate: state.toDate,
    sourceRowCount: state.sourceRowCount,
  };
}

module.exports = { readFastExport, AccountingXlsxError, toNumber, toDate, FAST_HEADERS };
