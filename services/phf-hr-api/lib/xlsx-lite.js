'use strict';

// PHF HR — QTTH Truth Data · minimal ZERO-DEPENDENCY .xlsx reader.
//
// The repo convention is "no npm dependency" (see attachment-storage.js). An
// .xlsx is a ZIP of XML parts; Node core (zlib) inflates DEFLATE. We only need
// enough of the Office Open XML SpreadsheetML surface to read a payroll sheet:
//   - the ZIP central directory + local file headers (STORED / DEFLATE)
//   - xl/workbook.xml            -> ordered sheet list (name + r:id)
//   - xl/_rels/workbook.xml.rels -> r:id -> part path
//   - xl/sharedStrings.xml       -> shared string table
//   - xl/worksheets/sheetN.xml   -> cells (A1 refs, shared/inline/number)
//
// Output: readWorkbook(buffer) -> { sheets: [{ name, rows }] } where `rows` is
// a dense string[][] grid (empty cells = ''), 1:1 with what a human sees in
// Excel. Formulas are read as their cached value. Dates are returned as the
// raw serial string (payroll sheet carries no dates in the data area).
//
// NOT a general xlsx library. Rejects anything it does not understand rather
// than guessing — a Truth Data importer must never silently mis-read a cell.

const zlib = require('zlib');

class XlsxLiteError extends Error {
  constructor(message, code) { super(message); this.code = code || 'XLSX_LITE_ERROR'; this.isXlsxLiteError = true; }
}
function fail(msg, code) { throw new XlsxLiteError(msg, code); }

// ---- ZIP -----------------------------------------------------------------
function findEocd(buf) {
  // End of Central Directory record: signature 0x06054b50, max 22 + 64KB comment.
  const min = 22;
  const start = Math.max(0, buf.length - (min + 0xffff));
  for (let i = buf.length - min; i >= start; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  fail('Không đọc được file .xlsx (thiếu ZIP End-Of-Central-Directory).', 'XLSX_NOT_ZIP');
}
function readZipEntries(buf) {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // central directory offset
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) fail('Central directory hỏng.', 'XLSX_ZIP_CORRUPT');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, compSize, localOff });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
function extract(buf, entry) {
  // local file header: sig 0x04034b50, name+extra lengths at +26/+28
  const lo = entry.localOff;
  if (buf.readUInt32LE(lo) !== 0x04034b50) fail('Local file header hỏng.', 'XLSX_ZIP_CORRUPT');
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  const raw = buf.subarray(dataStart, dataStart + entry.compSize);
  if (entry.method === 0) return raw;                       // STORED
  if (entry.method === 8) return zlib.inflateRawSync(raw);  // DEFLATE
  fail('Phương thức nén ZIP không hỗ trợ (method ' + entry.method + ').', 'XLSX_ZIP_METHOD');
}

// ---- tiny XML helpers (regex-based; SpreadsheetML is flat + predictable) --
function decodeEntities(s) {
  return String(s).replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function allMatches(xml, re) { const out = []; let m; while ((m = re.exec(xml))) out.push(m); return out; }

function parseSharedStrings(xml) {
  if (!xml) return [];
  // <si> ... </si> ; text is one or more <t>..</t> (possibly across <r> runs)
  return allMatches(xml, /<si\b[^>]*>([\s\S]*?)<\/si>/g).map((m) => {
    const parts = allMatches(m[1], /<t\b[^>]*>([\s\S]*?)<\/t>/g).map((t) => decodeEntities(t[1]));
    if (parts.length) return parts.join('');
    // self-closing <t/> or empty
    return '';
  });
}

function colRefToIndex(ref) {
  // "AB12" -> zero-based column index of AB
  const letters = String(ref).match(/^[A-Z]+/)[0];
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

function parseSheet(xml, shared) {
  const rows = [];
  const rowMatches = allMatches(xml, /<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g);
  let maxCol = 0;
  const byRow = new Map();
  for (const rm of rowMatches) {
    const rIdx = parseInt(rm[1], 10) - 1;
    const cells = {};
    for (const cm of allMatches(rm[2], /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1] || '';
      const inner = cm[2] || '';
      const rAttr = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
      const tAttr = (attrs.match(/\bt="([^"]+)"/) || [])[1] || 'n';
      const cIdx = rAttr ? colRefToIndex(rAttr) : (Object.keys(cells).length);
      let val = '';
      if (tAttr === 's') {
        const vv = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        val = vv != null ? (shared[parseInt(vv, 10)] || '') : '';
      } else if (tAttr === 'inlineStr' || tAttr === 'str') {
        const isT = (inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/) || [])[1];
        const vT = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        val = decodeEntities(isT != null ? isT : (vT != null ? vT : ''));
      } else { // n, b, e — take cached <v>
        const vv = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        val = vv != null ? decodeEntities(vv) : '';
      }
      cells[cIdx] = val;
      if (cIdx + 1 > maxCol) maxCol = cIdx + 1;
    }
    byRow.set(rIdx, cells);
  }
  const maxRow = rowMatches.length ? Math.max(...rowMatches.map((m) => parseInt(m[1], 10) - 1)) : -1;
  for (let r = 0; r <= maxRow; r++) {
    const cells = byRow.get(r) || {};
    const arr = new Array(maxCol).fill('');
    for (const k of Object.keys(cells)) arr[+k] = cells[k];
    rows.push(arr);
  }
  return rows;
}

function readWorkbook(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const entries = readZipEntries(buf);
  const get = (name) => (entries.has(name) ? extract(buf, entries.get(name)).toString('utf8') : null);

  const wb = get('xl/workbook.xml');
  if (!wb) fail('Không phải file .xlsx hợp lệ (thiếu xl/workbook.xml).', 'XLSX_NO_WORKBOOK');
  const rels = get('xl/_rels/workbook.xml.rels') || '';
  const relMap = new Map(allMatches(rels, /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)
    .map((m) => [m[1], m[2].replace(/^\/?xl\//, '').replace(/^\//, '')]));

  const shared = parseSharedStrings(get('xl/sharedStrings.xml'));

  const sheetDefs = allMatches(wb, /<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/g);
  if (!sheetDefs.length) fail('Workbook không có sheet nào.', 'XLSX_NO_SHEET');
  const sheets = [];
  for (const sd of sheetDefs) {
    const name = decodeEntities(sd[1]);
    let target = relMap.get(sd[2]);
    if (!target) continue;
    if (!target.startsWith('worksheets/')) target = 'worksheets/' + target.replace(/^.*\//, '');
    const xml = get('xl/' + target);
    if (xml == null) continue;
    sheets.push({ name, rows: parseSheet(xml, shared) });
  }
  if (!sheets.length) fail('Không đọc được sheet dữ liệu nào từ file .xlsx.', 'XLSX_NO_SHEET_DATA');
  return { sheets };
}

module.exports = { readWorkbook, XlsxLiteError };
