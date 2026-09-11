'use strict';
// tiny zero-dep .xlsx WRITER. grid string[][] -> Buffer.
//
//   gridToXlsx(grid)                     -> bare sheet "Bang luong" (test fixtures;
//                                           byte-identical to the original writer).
//   gridToXlsx(grid, opts)               -> optional presentation layer:
//     opts.sheetName                      worksheet name
//     opts.description / opts.keywords    docProps/core.xml (reader ignores it)
//     opts.style = {                      PURE PRESENTATION — never affects the
//                                         reader (xlsx-lite reads value + t/s/r only):
//       cols:   [{min,max,width}]         column widths (1-based cols)
//       merges: ["A8:L8", ...]            merged cell ranges
//       rowHeights: { "8": 58, ... }      per-row heights (1-based)
//       freeze: { rows: n, cols: n }      frozen panes
//       cellStyles: { "A8": "groupHeader", ... }  style key per A1 ref
//       colStyles:  { "10-86": "money" }  style key per 0-based col range (data area)
//       dataStartRow: n                    1-based first data row (for colStyles)
//     }
//   Style keys: default | banner | bannerSub | groupHeader | colHeader | numRow
//               | money | text
const zlib = require('zlib');

function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; }
function zip(files) {
  const parts = []; const central = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cdStart = offset;
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...parts, cd, eocd]);
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; }

// ---- fixed style table (index -> cellXfs) --------------------------------
// styles.xml is order/count sensitive; this table is hand-checked against Excel.
const STYLE_INDEX = { default: 0, banner: 1, bannerSub: 2, groupHeader: 3, colHeader: 4, numRow: 5, money: 6, text: 7 };
function stylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>'
    + '<fonts count="6">'
      + '<font><sz val="11"/><name val="Calibri"/></font>'                                   // 0 default
      + '<font><b/><sz val="13"/><color rgb="FF0B3F24"/><name val="Calibri"/></font>'         // 1 banner
      + '<font><sz val="10"/><color rgb="FF5C6672"/><name val="Calibri"/></font>'             // 2 bannerSub
      + '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'         // 3 group header (white)
      + '<font><b/><sz val="9"/><color rgb="FF0B3F24"/><name val="Calibri"/></font>'          // 4 col header (dark green)
      + '<font><sz val="8"/><color rgb="FF8A94A0"/><name val="Calibri"/></font>'              // 5 number row
    + '</fonts>'
    + '<fills count="4">'
      + '<fill><patternFill patternType="none"/></fill>'                                       // 0 (reserved)
      + '<fill><patternFill patternType="gray125"/></fill>'                                    // 1 (reserved)
      + '<fill><patternFill patternType="solid"><fgColor rgb="FF1B7B45"/><bgColor indexed="64"/></patternFill></fill>' // 2 PHF green
      + '<fill><patternFill patternType="solid"><fgColor rgb="FFE6F2EA"/><bgColor indexed="64"/></patternFill></fill>' // 3 pale green
    + '</fills>'
    + '<borders count="2">'
      + '<border><left/><right/><top/><bottom/><diagonal/></border>'                            // 0 none
      + '<border><left style="thin"><color rgb="FFCBD5CF"/></left><right style="thin"><color rgb="FFCBD5CF"/></right><top style="thin"><color rgb="FFCBD5CF"/></top><bottom style="thin"><color rgb="FFCBD5CF"/></bottom><diagonal/></border>' // 1 thin
    + '</borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="8">'
      + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'                                                                 // 0 default
      + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'                                                    // 1 banner
      + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'                                                    // 2 bannerSub
      + '<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' // 3 groupHeader
      + '<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' // 4 colHeader
      + '<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'                            // 5 numRow
      + '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>'                   // 6 money
      + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>'                                            // 7 text
    + '</cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>';
}

function a1(colIdx, rowIdx) { return colName(colIdx) + (rowIdx + 1); }
function parseRange(rng) { // "A8:L8" -> {c1,r1,c2,r2} 0-based
  const m = String(rng).match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!m) return null;
  const ci = (s) => { let n = 0; for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64); return n - 1; };
  return { c1: ci(m[1]), r1: +m[2] - 1, c2: ci(m[3]), r2: +m[4] - 1 };
}

function gridToXlsx(grid, opts) {
  const options = opts || {};
  const sheetName = String(options.sheetName || 'Bang luong');
  const description = options.description ? String(options.description) : null;
  const keywords = options.keywords ? String(options.keywords) : null;
  const style = options.style || null;

  // per-cell style index resolver
  const cellStyleByRef = {};
  if (style) {
    for (const [ref, key] of Object.entries(style.cellStyles || {})) {
      if (STYLE_INDEX[key] != null) cellStyleByRef[ref] = STYLE_INDEX[key];
    }
  }
  // per-column data-area style (0-based col range "min-max" -> style key)
  const colStyleRanges = [];
  if (style && style.colStyles) {
    for (const [range, key] of Object.entries(style.colStyles)) {
      const mm = String(range).split('-').map(Number);
      if (STYLE_INDEX[key] != null && mm.length === 2) colStyleRanges.push({ min: mm[0], max: mm[1], s: STYLE_INDEX[key] });
    }
  }
  const dataStartRow0 = style && style.dataStartRow ? style.dataStartRow - 1 : Infinity;
  function styleFor(c, r, ref) {
    if (cellStyleByRef[ref] != null) return cellStyleByRef[ref];
    if (r >= dataStartRow0) { for (const cs of colStyleRanges) if (c >= cs.min && c <= cs.max) return cs.s; }
    return 0;
  }

  const shared = []; const idx = new Map();
  const rowHeights = (style && style.rowHeights) || {};
  const sheetRows = grid.map((row, r) => {
    const cells = row.map((v, c) => {
      const val = v == null ? '' : String(v);
      const ref = colName(c) + (r + 1);
      const s = styleFor(c, r, ref);
      const sAttr = s ? ` s="${s}"` : '';
      // NOTE: explicit close tag (not self-closing) — the lite reader's cell
      // regex mishandles "<c .../>" when it carries attributes.
      if (val === '') return s ? `<c r="${ref}"${sAttr}></c>` : '';
      if (/^-?\d+(\.\d+)?$/.test(val)) return `<c r="${ref}"${sAttr}><v>${val}</v></c>`;
      let si = idx.get(val); if (si == null) { si = shared.length; shared.push(val); idx.set(val, si); }
      return `<c r="${ref}"${sAttr} t="s"><v>${si}</v></c>`;
    }).join('');
    const hAttr = rowHeights[r + 1] ? ` ht="${rowHeights[r + 1]}" customHeight="1"` : '';
    return `<row r="${r + 1}"${hAttr}>${cells}</row>`;
  }).join('');

  // <cols>
  let colsXml = '';
  if (style && Array.isArray(style.cols) && style.cols.length) {
    colsXml = '<cols>' + style.cols.map((c) => `<col min="${c.min}" max="${c.max}" width="${c.width}" customWidth="1"/>`).join('') + '</cols>';
  }
  // <mergeCells>
  let mergeXml = '';
  const merges = (style && Array.isArray(style.merges)) ? style.merges.filter((x) => parseRange(x)) : [];
  if (merges.length) mergeXml = `<mergeCells count="${merges.length}">` + merges.map((m) => `<mergeCell ref="${m}"/>`).join('') + '</mergeCells>';
  // <sheetViews> with frozen pane (only when styling)
  let viewsXml = '';
  if (style && style.freeze && (style.freeze.rows || style.freeze.cols)) {
    const xs = style.freeze.cols || 0, ys = style.freeze.rows || 0;
    const topLeft = a1(xs, ys);
    viewsXml = '<sheetViews><sheetView workbookViewId="0">'
      + `<pane xSplit="${xs}" ySplit="${ys}" topLeftCell="${topLeft}" activePane="bottomRight" state="frozen"/>`
      + `<selection pane="bottomRight" activeCell="${topLeft}" sqref="${topLeft}"/>`
      + '</sheetView></sheetViews>';
  }

  // No opts -> emit the exact original worksheet XML (byte-identical fixtures).
  const sheetXml = style
    ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      + viewsXml + `<sheetFormatPr defaultRowHeight="15"/>` + colsXml
      + `<sheetData>${sheetRows}</sheetData>` + mergeXml + `</worksheet>`
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  const ssXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`;

  const withStyles = !!style;
  const withDocProps = !!description;
  const ctExtra = (withStyles ? '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' : '')
    + (withDocProps ? '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' : '');
  const relsExtra = withDocProps
    ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    : '';
  const wbRelsExtra = withStyles
    ? '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    : '';

  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>${ctExtra}</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>${relsExtra}</Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>${wbRelsExtra}</Relationships>` },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
    { name: 'xl/sharedStrings.xml', data: ssXml },
  ];
  if (withStyles) files.push({ name: 'xl/styles.xml', data: stylesXml() });
  if (withDocProps) files.push({ name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:description>${esc(description)}</dc:description>${keywords ? `<cp:keywords>${esc(keywords)}</cp:keywords>` : ''}<cp:contentStatus>${esc(keywords || description)}</cp:contentStatus></cp:coreProperties>` });
  return zip(files);
}
module.exports = { gridToXlsx, STYLE_KEYS: Object.keys(STYLE_INDEX) };
