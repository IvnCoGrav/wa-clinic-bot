import * as fs from 'fs';
import * as path from 'path';

interface SpreadsheetRow {
  tanggal: string;
  hari: string;
  customer: string;
  lokasi: string;
  bayiLayanan: string;
  type: string;
  layananDetail: string;
  ongkir: string;
  total: string;
}

interface DBCustomer {
  id: string;
  name: string;
  phone: string;
}

interface DBReservation {
  id: string;
  customer_id: string;
  booking_date: string;
  treatment_detail: string;
  status: string;
}

interface MatchedReservation {
  tanggal: string;
  customerName: string;
  customerId: string;
  phone: string;
  bayiLayanan: string;
  layananDetail: string;
  treatmentCategory: string;
  total: string;
  isRepeatOrder: boolean;
  bookingDate: string;
}

function parseSpreadsheet(filePath: string): SpreadsheetRow[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim() !== '');
  const rows: SpreadsheetRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split('\t');
    if (parts.length < 6) continue;

    const customer = parts[2]?.trim() || '';
    if (!customer || customer.toLowerCase().includes('tip ninis') || customer.toLowerCase().includes('tip')) continue;

    // Detect format: April has 7 columns (no type), May+ has 8 columns (with type)
    // Check if parts[5] looks like a type (New/Repeat/New Iklan) or a treatment detail
    const possibleType = parts[5]?.trim() || '';
    const hasTypeColumn = ['new', 'repeat', 'new iklan', 'repeat 2', 'repeat 3', 'repeat 4', 'repeat 5']
      .includes(possibleType.toLowerCase());

    if (hasTypeColumn && parts.length >= 8) {
      // May+ format: Tanggal, Hari, Customer, Lokasi, Bayi, Type, Layanan Detail, Ongkir, Total
      rows.push({
        tanggal: parts[0]?.trim() || '',
        hari: parts[1]?.trim() || '',
        customer: customer,
        lokasi: parts[3]?.trim() || '',
        bayiLayanan: parts[4]?.trim() || '',
        type: possibleType,
        layananDetail: parts[6]?.trim() || '',
        ongkir: parts[7]?.trim() || 'Rp0',
        total: parts[8]?.trim() || 'Rp0'
      });
    } else {
      // April format: Tanggal, Hari, Customer, Lokasi, Bayi, Layanan Detail, Ongkir, Total
      rows.push({
        tanggal: parts[0]?.trim() || '',
        hari: parts[1]?.trim() || '',
        customer: customer,
        lokasi: parts[3]?.trim() || '',
        bayiLayanan: parts[4]?.trim() || '',
        type: '',
        layananDetail: parts[5]?.trim() || '',
        ongkir: parts[6]?.trim() || 'Rp0',
        total: parts[7]?.trim() || 'Rp0'
      });
    }
  }

  return rows;
}

function parseDate(dateStr: string): string {
  if (!dateStr) return '';
  const cleanDate = dateStr.replace(/[\/\.]/g, '/');
  const parts = cleanDate.split('/');
  if (parts.length !== 3) return '';

  const day = parts[0].padStart(2, '0');
  let month = parts[1].padStart(2, '0');
  let year = parts[2];

  if (year.length === 2) {
    const yearNum = parseInt(year);
    // 26 = 2026, not 1926
    year = `20${year}`;
  }

  // Fix month typo: 18/5/25 should be 18/5/26
  if (month === '25' && year === '2025') {
    month = '26';
    year = '2026';
  }

  return `${year}-${month}-${day}`;
}

function normalizeName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/ny\.\s*/g, '')
    .replace(/bu\.\s*/g, '')
    .replace(/bunda\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findCustomerMatch(
  spreadsheetName: string,
  spreadsheetLocation: string,
  dbCustomers: DBCustomer[]
): DBCustomer | null {
  const norm = normalizeName(spreadsheetName);
  if (!norm) return null;

  // Exact match
  for (const c of dbCustomers) {
    if (normalizeName(c.name) === norm) return c;
  }

  // Containment match (skip empty DB names)
  for (const c of dbCustomers) {
    const dbNorm = normalizeName(c.name);
    if (!dbNorm) continue;
    if (dbNorm.includes(norm) || norm.includes(dbNorm)) return c;
  }

  // Token overlap match
  const sWords = norm.split(' ').filter(w => w.length > 1);
  for (const c of dbCustomers) {
    const dbWords = normalizeName(c.name).split(' ').filter(w => w.length > 1);
    let matches = 0;
    for (const sw of sWords) {
      if (dbWords.some(dw => dw.includes(sw) || sw.includes(dw))) matches++;
    }
    if (sWords.length > 0 && matches >= Math.ceil(sWords.length * 0.5)) return c;
  }

  // Location-based match: check if DB name contains location from spreadsheet
  const location = normalizeName(spreadsheetLocation);
  if (location && location.length > 3) {
    for (const c of dbCustomers) {
      const dbNorm = normalizeName(c.name);
      if (dbNorm.includes(location)) return c;
    }
  }

  return null;
}

function reservationExists(
  customerId: string,
  bookingDate: string,
  treatmentDetail: string,
  existingReservations: DBReservation[]
): boolean {
  return existingReservations.some(r =>
    r.customer_id === customerId &&
    r.booking_date && r.booking_date.startsWith(bookingDate) &&
    r.treatment_detail && r.treatment_detail.toLowerCase().includes(treatmentDetail.toLowerCase().substring(0, 20))
  );
}

function determineTreatmentCategory(treatmentDetail: string): string {
  const lower = treatmentDetail.toLowerCase();
  const hasMomKeyword = /\b(pregnant|hamil|ibu|moms|omf|pkmt|pkm|massage moms|breast|oksitosin)\b/.test(lower);
  const hasBabyKeyword = /\b(bayi|baby|ceria|pulih|cukur|selapan|kids|newborb|bapil)\b/.test(lower);

  if (hasMomKeyword && hasBabyKeyword) return 'BOTH';
  if (hasMomKeyword) return 'MOMS';
  return 'BABY';
}

function generateSQL(
  matchedReservations: MatchedReservation[],
  unmatchedCustomers: { name: string; data: SpreadsheetRow }[]
): string {
  let sql = '-- Generated SQL for booking data import\n';
  sql += '-- Date: ' + new Date().toISOString() + '\n\n';
  sql += 'BEGIN;\n\n';

  if (matchedReservations.length > 0) {
    sql += '-- Reservations to insert\n';
    for (const res of matchedReservations) {
      const treatmentDetail = res.layananDetail.replace(/'/g, "''");
      const total = parseInt(res.total.replace(/[^0-9]/g, '')) || 0;
      const treatmentCategory = res.treatmentCategory;

      sql += `INSERT INTO reservations (id, customer_id, treatment_category, booking_date, treatment_detail, is_repeat_order, status, purchase_value, created_at, updated_at)\n`;
      sql += `VALUES (gen_random_uuid(), '${res.customerId}', '${treatmentCategory}', '${res.bookingDate}T08:00:00', '${treatmentDetail}', ${res.isRepeatOrder ? 'true' : 'false'}, 'completed', ${total}, NOW(), NOW());\n\n`;
    }
  }

  if (unmatchedCustomers.length > 0) {
    sql += '-- UNMATCHED CUSTOMERS (require manual lookup or phone number creation)\n';
    for (const u of unmatchedCustomers) {
      sql += `-- ${u.name} (${u.data.lokasi}) | Bayi: ${u.data.bayiLayanan} | Layanan: ${u.data.layananDetail}\n`;
    }
    sql += '\n';
  }

  sql += 'COMMIT;\n';
  return sql;
}

// Track last known date for continuation rows (no date)
let lastKnownDate = '';

function main() {
  console.log('Starting booking data import script...\n');

  const spreadsheetPath = path.join(__dirname, '..', 'docs', 'spreadsheet_booking_data.tsv');
  const rows = parseSpreadsheet(spreadsheetPath);
  console.log(`Parsed ${rows.length} valid rows from spreadsheet\n`);

  const customersPath = path.join(__dirname, 'db_customers.json');
  const reservationsPath = path.join(__dirname, 'db_reservations.json');

  if (!fs.existsSync(customersPath) || !fs.existsSync(reservationsPath)) {
    console.error('Error: Database data files not found.');
    process.exit(1);
  }

  const dbCustomers: DBCustomer[] = JSON.parse(fs.readFileSync(customersPath, 'utf-8'));
  const dbReservations: DBReservation[] = JSON.parse(fs.readFileSync(reservationsPath, 'utf-8'));

  console.log(`Loaded ${dbCustomers.length} DB customers`);
  console.log(`Loaded ${dbReservations.length} DB reservations\n`);

  const matchedReservations: MatchedReservation[] = [];
  const unmatchedCustomers: { name: string; data: SpreadsheetRow }[] = [];
  let skippedRows = 0;
  let dateParseErrors = 0;

  for (const row of rows) {
    if (!row.customer || row.customer.trim() === '') continue;

    // Parse date (handle continuation rows without dates)
    let bookingDate = parseDate(row.tanggal);
    if (bookingDate) {
      lastKnownDate = bookingDate;
    } else {
      bookingDate = lastKnownDate;
    }

    if (!bookingDate) {
      dateParseErrors++;
      console.warn(`Warning: No date for '${row.customer}' - skipped`);
      continue;
    }

    // Find matching customer
    const customerMatch = findCustomerMatch(row.customer, row.lokasi, dbCustomers);

    if (!customerMatch) {
      if (!unmatchedCustomers.some(u => u.name === row.customer)) {
        unmatchedCustomers.push({ name: row.customer, data: row });
      }
      continue;
    }

    // Check for duplicate
    if (reservationExists(customerMatch.id, bookingDate, row.layananDetail, dbReservations)) {
      skippedRows++;
      continue;
    }

    // Determine if repeat order
    const typeLower = (row.type || '').toLowerCase();
    const detailLower = (row.layananDetail || '').toLowerCase();
    const isRepeat = typeLower.includes('repeat') || detailLower.includes('repeat');

    matchedReservations.push({
      tanggal: row.tanggal,
      customerName: row.customer,
      customerId: customerMatch.id,
      phone: customerMatch.phone,
      bayiLayanan: row.bayiLayanan,
      layananDetail: row.layananDetail,
      treatmentCategory: determineTreatmentCategory(row.layananDetail),
      total: row.total,
      isRepeatOrder: isRepeat,
      bookingDate: bookingDate
    });
  }

  const sql = generateSQL(matchedReservations, unmatchedCustomers);
  const outputPath = path.join(__dirname, 'import_booking_data.sql');
  fs.writeFileSync(outputPath, sql, 'utf-8');

  console.log('=== IMPORT SUMMARY ===\n');
  console.log(`Total spreadsheet rows: ${rows.length}`);
  console.log(`Matched reservations (to insert): ${matchedReservations.length}`);
  console.log(`Duplicate reservations (skipped): ${skippedRows}`);
  console.log(`Date parse errors: ${dateParseErrors}`);
  console.log(`Unmatched customers: ${unmatchedCustomers.length}\n`);

  if (unmatchedCustomers.length > 0) {
    console.log('=== UNMATCHED CUSTOMERS ===');
    for (const u of unmatchedCustomers) {
      console.log(`- ${u.name} (${u.data.lokasi}) | Bayi: ${u.data.bayiLayanan}`);
    }
    console.log('');
  }

  // Print sample matches
  console.log('=== SAMPLE MATCHES (first 10) ===');
  for (const m of matchedReservations.slice(0, 10)) {
    console.log(`${m.customerName} -> ${m.customerId} (${m.bookingDate}) | ${m.layananDetail}`);
  }

  console.log(`\nSQL file saved to: ${outputPath}`);
  console.log('Review the SQL file before executing!');
}

main();
