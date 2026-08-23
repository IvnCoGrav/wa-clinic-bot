import fs from 'fs';
import path from 'path';
import { prisma } from '../src/db/client';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';
import { extractTransactionsFromTranscript, ExtractedTransaction } from '../src/utils/conversation-transaction-extractor';

/**
 * Script Offline Batch: Scrape & Backfill Lokasi Pelanggan dari Riwayat Transkrip Chat
 * 
 * Penggunaan:
 *   npx tsx scripts/scrape-and-backfill-customer-locations.ts             (Preview / Dry-Run)
 *   npx tsx scripts/scrape-and-backfill-customer-locations.ts --commit    (Commit ke PostgreSQL Database Local)
 */

interface CustomerLocationRecord {
  phone: string;
  name?: string;
  address?: string;
  kelurahan?: string;
  kecamatan?: string;
  kota?: string;
  lat?: number;
  lng?: number;
  distanceKm?: number;
  ongkir?: number;
  source: string;
}

// Normalisasi nomor telepon ke format standar 628xxx
export function normalizePhone(rawPhone: string): string {
  let cleaned = rawPhone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.slice(1);
  } else if (cleaned.startsWith('8')) {
    cleaned = '62' + cleaned;
  }
  return cleaned;
}

// Ekstraksi kelurahan/kecamatan/kota dari string alamat
export function extractSubdistrictFromAddress(address: string, kec?: string, kota?: string): {
  kelurahan?: string;
  kecamatan?: string;
  kota?: string;
} {
  let resKel: string | undefined;
  let resKec: string | undefined = kec && kec.trim().length > 0 ? kec.trim() : undefined;
  let resKota: string | undefined = kota && kota.trim().length > 0 ? kota.trim() : undefined;

  const addrLower = (address || '').toLowerCase();

  // Deteksi Kota
  if (!resKota) {
    if (addrLower.includes('sidoarjo') || addrLower.includes('sda')) {
      resKota = 'Sidoarjo';
    } else if (addrLower.includes('surabaya') || addrLower.includes('sby')) {
      resKota = 'Surabaya';
    } else if (addrLower.includes('gresik')) {
      resKota = 'Gresik';
    }
  }

  // Deteksi Pola Kelurahan / Desa
  const kelMatch = address.match(/(?:kelurahan|kel\.|desa|ds\.)\s+([^,]+?)(?=\s+(?:kec|kab|kota|\d)|\s*,|$)/i);
  if (kelMatch) {
    resKel = kelMatch[1].trim();
  }

  // Deteksi Pola Kecamatan
  const kecMatch = address.match(/(?:kecamatan|kec\.)\s+([^,]+?)(?=\s+(?:kab|kota|\d)|\s*,|$)/i);
  if (kecMatch && !resKec) {
    resKec = kecMatch[1].trim();
  }

  // Fallback pemisahan koma jika alamat berbentuk "Jl ABC No 123, Kelurahan, Kecamatan, Kota"
  if (!resKel && address) {
    const parts = address.split(',').map((p) => p.trim());
    if (parts.length >= 3) {
      // parts[parts.length - 1] -> Kota
      // parts[parts.length - 2] -> Kecamatan / Kelurahan
      // parts[parts.length - 3] -> Kelurahan / Jalan
      const candidateKel = parts[parts.length - 2];
      if (candidateKel && !candidateKel.toLowerCase().includes('surabaya') && !candidateKel.toLowerCase().includes('sidoarjo')) {
        resKel = candidateKel;
      }
    }
  }

  return {
    kelurahan: resKel,
    kecamatan: resKec,
    kota: resKota,
  };
}

export async function parseAllHistoricalCustomerLocations(): Promise<Map<string, CustomerLocationRecord>> {
  const customerMap = new Map<string, CustomerLocationRecord>();

  // 1. Baca dari Kala_Moms_Transactions_Clean.md
  const cleanMdPath = path.join(__dirname, '../exports/Kala_Moms_Transactions_Clean.md');
  if (fs.existsSync(cleanMdPath)) {
    const cleanContent = fs.readFileSync(cleanMdPath, 'utf-8');
    const lines = cleanContent.split('\n');
    for (const line of lines) {
      if (!line.startsWith('|') || line.includes('| No |') || line.includes('|---:')) continue;
      const cols = line.split('|').map((c) => c.trim());
      // Col 2: Phone, Col 4: Customer Name, Col 5: Address, Col 9: Ongkir
      if (cols.length >= 10) {
        const rawPhone = cols[2];
        const name = cols[4] || undefined;
        const address = cols[5] || undefined;
        const rawOngkir = parseInt(cols[9] || '0', 10);

        if (rawPhone && rawPhone.length >= 8) {
          const phone = normalizePhone(rawPhone);
          const parsedLoc = address ? extractSubdistrictFromAddress(address) : {};

          customerMap.set(phone, {
            phone,
            name: name && name !== '-' ? name : undefined,
            address: address && address !== '-' ? address : undefined,
            kelurahan: parsedLoc.kelurahan,
            kecamatan: parsedLoc.kecamatan,
            kota: parsedLoc.kota,
            ongkir: !isNaN(rawOngkir) && rawOngkir > 0 ? rawOngkir : undefined,
            source: 'Kala_Moms_Transactions_Clean.md',
          });
        }
      }
    }
  }

  // 2. Baca dari TRANSKRIP_LENGKAP_SEMUA_CHAT.md untuk melengkapi data yang belum ada
  const transcriptPath = path.join(__dirname, '../exports/TRANSKRIP_LENGKAP_SEMUA_CHAT.md');
  if (fs.existsSync(transcriptPath)) {
    const transcriptContent = fs.readFileSync(transcriptPath, 'utf-8');
    const rawTxList = extractTransactionsFromTranscript(transcriptContent);

    for (const tx of rawTxList) {
      if (!tx.customerPhone) continue;
      const phone = normalizePhone(tx.customerPhone);
      const existing = customerMap.get(phone);

      const parsedLoc = extractSubdistrictFromAddress(tx.address || '', tx.kec, tx.kota);

      const updated: CustomerLocationRecord = {
        phone,
        name: existing?.name || (tx.customerName && tx.customerName !== 'Bunda' ? tx.customerName : undefined),
        address: existing?.address || (tx.address && tx.address.length > 3 ? tx.address : undefined),
        kelurahan: existing?.kelurahan || parsedLoc.kelurahan,
        kecamatan: existing?.kecamatan || parsedLoc.kecamatan,
        kota: existing?.kota || parsedLoc.kota,
        ongkir: existing?.ongkir || (tx.ongkir > 0 ? tx.ongkir : undefined),
        source: existing ? existing.source : 'TRANSKRIP_LENGKAP_SEMUA_CHAT.md',
      };

      customerMap.set(phone, updated);
    }
  }

  return customerMap;
}

async function main() {
  const args = process.argv.slice(2);
  const isCommit = args.includes('--commit');

  console.log(`\n======================================================`);
  console.log(`📍 SCRAPE & BACKFILL HISTORICAL CUSTOMER LOCATIONS`);
  console.log(`======================================================`);
  console.log(`Mode: ${isCommit ? '⚡ COMMIT KE DATABASE LOCAL' : '🔍 DRY-RUN / PREVIEW ONLY'}`);
  console.log(`Target: Database Local (Tenant: ${DEFAULT_TENANT_ID})\n`);

  const customerMap = await parseAllHistoricalCustomerLocations();
  const records = Array.from(customerMap.values());

  console.log(`✅ Berhasil mengekstrak ${records.length} riwayat customer unik dengan data lokasi.\n`);

  // Print Preview Table
  console.log(`| No | Phone | Name | Kelurahan / Alamat | Kecamatan | Kota | Ongkir |`);
  console.log(`|---|---|---|---|---|---|---|`);

  let countWithAddress = 0;
  let countWithOngkir = 0;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.address || r.kelurahan) countWithAddress++;
    if (r.ongkir) countWithOngkir++;

    const shortAddr = (r.kelurahan || r.address || '-').replace(/\n/g, ' ').slice(0, 35);
    if (i < 15 || i >= records.length - 5) {
      console.log(`| ${i + 1} | ${r.phone} | ${r.name || '-'} | ${shortAddr} | ${r.kecamatan || '-'} | ${r.kota || '-'} | ${r.ongkir ? `Rp ${r.ongkir.toLocaleString('id-ID')}` : '-'} |`);
    } else if (i === 15) {
      console.log(`| ... | (${records.length - 20} customer lainnya) | ... | ... | ... | ... | ... |`);
    }
  }

  console.log(`\n📊 STATISTIK RINGKASAN:`);
  console.log(`   - Total Customer Unik : ${records.length}`);
  console.log(`   - Memiliki Alamat/Kel : ${countWithAddress}`);
  console.log(`   - Memiliki Data Ongkir: ${countWithOngkir}`);

  if (isCommit) {
    console.log(`\n⚡ Menyimpan ke Database PostgreSQL Local...`);
    let updatedCount = 0;
    let createdCount = 0;

    for (const r of records) {
      try {
        const existingCust = await prisma.customer.findFirst({
          where: {
            phone: r.phone,
            tenant_id: DEFAULT_TENANT_ID,
          },
        });

        if (existingCust) {
          await prisma.customer.update({
            where: { id: existingCust.id },
            data: {
              name: existingCust.name || r.name,
              kelurahan: existingCust.kelurahan || r.kelurahan || r.address,
              kecamatan: existingCust.kecamatan || r.kecamatan,
              kota: existingCust.kota || r.kota,
              ongkir: existingCust.ongkir || r.ongkir,
            },
          });
          updatedCount++;
        } else {
          await prisma.customer.create({
            data: {
              tenant_id: DEFAULT_TENANT_ID,
              phone: r.phone,
              name: r.name,
              kelurahan: r.kelurahan || r.address,
              kecamatan: r.kecamatan,
              kota: r.kota,
              ongkir: r.ongkir,
            },
          });
          createdCount++;
        }
      } catch (err: any) {
        console.error(`[ERROR] Gagal simpan customer ${r.phone}:`, err.message);
      }
    }

    console.log(`\n🎉 SUKSES BACKFILL KE DATABASE LOCAL:`);
    console.log(`   - Customer Baru Dibuat    : ${createdCount}`);
    console.log(`   - Customer Lama Diperbarui: ${updatedCount}`);
    console.log(`   - Total Ter-update        : ${createdCount + updatedCount}`);
  } else {
    console.log(`\n💡 Tip: Jalankan dengan flag --commit untuk menyimpan langsung ke database local:`);
    console.log(`   npx tsx scripts/scrape-and-backfill-customer-locations.ts --commit\n`);
  }

  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[FATAL ERROR]:', err);
    process.exit(1);
  });
}
