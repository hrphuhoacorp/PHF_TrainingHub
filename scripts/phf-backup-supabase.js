'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const TABLES = [
  'settings',
  'employees',
  'progress',
  'test_results',
  'activity_log',
  'evaluation_records',
  'commitment_records',
  'probation_records',
  'system_notifications'
];

const PAGE_SIZE = 1000;

function fail(message) {
  console.error(`\nKHÔNG THỂ SAO LƯU: ${message}\n`);
  process.exit(1);
}

function safeStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

async function readAllRows(supabase, table) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, to);

    if (error) {
      throw new Error(`${table}: ${error.message}`);
    }

    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);

    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function main() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const secret = String(process.env.SUPABASE_SECRET_KEY || '').trim();

  if (!url || !secret) {
    fail('Thiếu SUPABASE_URL hoặc SUPABASE_SECRET_KEY trong file .env.');
  }

  const supabase = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const stamp = safeStamp();
  const rootDir = path.resolve(__dirname, '..');
  const backupDir = path.join(rootDir, 'backups', 'supabase', stamp);
  fs.mkdirSync(backupDir, { recursive: true });

  const combined = {
    system: 'PHF Training Hub',
    createdAt: new Date().toISOString(),
    source: 'Supabase',
    tables: {}
  };

  const manifest = {
    system: 'PHF Training Hub',
    createdAt: combined.createdAt,
    backupFolder: stamp,
    tables: []
  };

  console.log('\nPHF Training Hub - Bắt đầu sao lưu Supabase');
  console.log(`Thư mục: ${backupDir}\n`);

  for (const table of TABLES) {
    process.stdout.write(`Đang sao lưu ${table}... `);
    const rows = await readAllRows(supabase, table);
    combined.tables[table] = rows;

    const json = `${JSON.stringify(rows, null, 2)}\n`;
    const filename = `${table}.json`;
    fs.writeFileSync(path.join(backupDir, filename), json, 'utf8');

    manifest.tables.push({
      table,
      rows: rows.length,
      file: filename,
      sha256: sha256(json)
    });
    console.log(`${rows.length} dòng`);
  }

  const combinedJson = `${JSON.stringify(combined, null, 2)}\n`;
  fs.writeFileSync(path.join(backupDir, 'phf-supabase-full-backup.json'), combinedJson, 'utf8');

  manifest.fullBackup = {
    file: 'phf-supabase-full-backup.json',
    sha256: sha256(combinedJson)
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), manifestJson, 'utf8');

  console.log('\nSAO LƯU THÀNH CÔNG');
  console.log(`Đã lưu tại: ${backupDir}`);
  console.log('Hãy sao chép nguyên thư mục này sang nơi lưu trữ riêng.\n');
}

main().catch(error => fail(error && error.message ? error.message : String(error)));
