'use strict';

// PHF HR — QTTH Truth Data · payroll source-file storage.
// Zero-dependency (Node core only), same discipline as attachment-storage.js:
// server-side filesystem under a validated root, sha256 content addressing,
// atomic write, NO public URL. The stored file is the immutable RAW SOURCE
// artefact — the uploaded .xlsx is kept byte-for-byte for audit traceability.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SUBDIR = 'qtth-payroll';
const MAX_BYTES = 12 * 1024 * 1024; // payroll workbooks are small; generous cap

function err(message, code) { const e = new Error(message); e.code = code || 'PAYROLL_STORAGE_ERROR'; e.isPayrollStorageError = true; return e; }

function safePeriod(p) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(p || ''))) throw err('Kỳ lương không hợp lệ.', 'PAYROLL_PERIOD_INVALID');
  return p;
}

// store(root, { period, version, fileName, buffer }) -> { sha256, byteSize, storageRef }
async function store(root, input) {
  if (!root || !path.isAbsolute(root)) throw err('Storage root không hợp lệ.', 'PAYROLL_STORAGE_ROOT');
  const period = safePeriod(input && input.period);
  const version = Math.max(1, Math.trunc(Number(input && input.version) || 1));
  const buf = Buffer.isBuffer(input && input.buffer) ? input.buffer : Buffer.from((input && input.buffer) || '');
  if (buf.length === 0) throw err('File rỗng.', 'PAYROLL_FILE_EMPTY');
  if (buf.length > MAX_BYTES) throw err('File vượt quá 12MB.', 'PAYROLL_FILE_TOO_LARGE');

  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const dir = path.join(root, SUBDIR, period);
  await fs.promises.mkdir(dir, { recursive: true });
  const finalName = 'v' + version + '-' + sha256.slice(0, 16) + '.xlsx';
  const finalPath = path.join(dir, finalName);
  const storageRef = SUBDIR + '/' + period + '/' + finalName;

  // atomic: unique temp -> rename. Idempotent: if the exact file already exists
  // (same sha), keep it.
  try {
    await fs.promises.access(finalPath, fs.constants.F_OK);
    return { sha256, byteSize: buf.length, storageRef, replayed: true };
  } catch (_) { /* not present, proceed */ }

  const tmp = path.join(dir, '.tmp-' + crypto.randomUUID() + '.part');
  await fs.promises.writeFile(tmp, buf, { flag: 'wx' });
  try {
    await fs.promises.rename(tmp, finalPath);
  } catch (e) {
    try { await fs.promises.unlink(tmp); } catch (_) {}
    // lost a race with an identical concurrent upload — the final file is there
    try { await fs.promises.access(finalPath, fs.constants.F_OK); }
    catch (_) { throw err('Không lưu được file: ' + e.message, 'PAYROLL_STORE_FAILED'); }
  }
  return { sha256, byteSize: buf.length, storageRef, replayed: false };
}

function readStream(root, storageRef) {
  const rel = String(storageRef || '');
  if (!rel.startsWith(SUBDIR + '/') || rel.includes('..')) throw err('storage_ref không hợp lệ.', 'PAYROLL_STORAGE_REF');
  const p = path.join(root, rel);
  if (p !== root && !p.startsWith(root + path.sep)) throw err('storage_ref ngoài phạm vi.', 'PAYROLL_STORAGE_REF');
  return fs.createReadStream(p);
}
async function readBuffer(root, storageRef) {
  const rel = String(storageRef || '');
  if (!rel.startsWith(SUBDIR + '/') || rel.includes('..')) throw err('storage_ref không hợp lệ.', 'PAYROLL_STORAGE_REF');
  const p = path.join(root, rel);
  if (p !== root && !p.startsWith(root + path.sep)) throw err('storage_ref ngoài phạm vi.', 'PAYROLL_STORAGE_REF');
  return fs.promises.readFile(p);
}

module.exports = { store, readStream, readBuffer, SUBDIR, MAX_BYTES };
