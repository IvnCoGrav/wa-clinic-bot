#!/usr/bin/env node
/**
 * report-test-failures.mjs — menerbitkan nama test yang gagal sebagai
 * annotation GitHub Actions (`::error`).
 *
 * Alasan: log job GitHub hanya bisa dibaca setelah login, sehingga kegagalan
 * gerbang unit test tidak bisa ditelusuri dari luar. Annotation tersedia lewat
 * REST API publik (`/check-runs/{id}/annotations`), jadi kegagalan selalu bisa
 * diidentifikasi tanpa membuka UI.
 *
 * Pemakaian: node scripts/report-test-failures.mjs ci-results.json
 */
import fs from 'node:fs';
import path from 'node:path';

const FILE = process.argv[2] || 'ci-results.json';
const LIMIT = Number(process.argv[3] || 40);

const escData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => escData(s).replace(/,/g, '%2C').replace(/:/g, '%3A');

if (!fs.existsSync(FILE)) {
  console.error(`::warning::${escData(`Hasil test tidak ditemukan: ${FILE}`)}`);
  process.exit(0);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (err) {
  console.error(`::warning::${escData(`Gagal membaca ${FILE}: ${err.message}`)}`);
  process.exit(0);
}

const root = process.cwd();
const relOf = (abs) => path.relative(root, abs).split(path.sep).join('/');

const failed = [];
for (const suite of report.testResults ?? []) {
  for (const assertion of suite.assertionResults ?? []) {
    if (assertion.status === 'failed') {
      failed.push({
        file: relOf(suite.name ?? ''),
        title: assertion.fullName || assertion.title || '(tanpa nama)',
        message: (assertion.failureMessages?.[0] ?? '').split('\n')[0],
      });
    }
  }
}

if (failed.length === 0) {
  console.log('Tidak ada test gagal untuk dilaporkan.');
  process.exit(0);
}

console.log(`Test gagal: ${failed.length} (menampilkan maksimal ${LIMIT} annotation)`);
for (const item of failed.slice(0, LIMIT)) {
  console.log(`- ${item.file} :: ${item.title}`);
}

for (const item of failed.slice(0, LIMIT)) {
  console.log(
    `::error file=${escProp(item.file)},title=${escProp(item.title.slice(0, 200))}::${escData(
      `${item.title} — ${item.message}`.slice(0, 400)
    )}`
  );
}

if (failed.length > LIMIT) {
  console.error(
    `::error::${escData(`Masih ada ${failed.length - LIMIT} test gagal lain di luar batas ${LIMIT} annotation.`)}`
  );
}

process.exit(0);
