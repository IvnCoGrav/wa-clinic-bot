import fs from 'fs';
import path from 'path';
import { prisma } from '../src/db/client';
import { DEFAULT_TENANT_ID } from '../src/config/tenant';
import { extractTransactionsFromTranscript, ExtractedTransaction } from '../src/utils/conversation-transaction-extractor';

/**
 * Script Seeder Presisi Transaksi Riwayat Chat WhatsApp
 * 
 * Penggunaan:
 *   npx tsx scripts/seed-transcripts-to-db.ts             (Mode Preview / Dry-Run)
 *   npx tsx scripts/seed-transcripts-to-db.ts --commit    (Mode Commit ke PostgreSQL Database)
 *   npx tsx scripts/seed-transcripts-to-db.ts --export-md=Kala_Moms_Transactions_Clean.md
 */
async function main() {
  const args = process.argv.slice(2);
  const isCommit = args.includes('--commit');
  const exportMdArg = args.find((a) => a.startsWith('--export-md='));
  const exportMdFile = exportMdArg ? exportMdArg.split('=')[1] : null;

  const transcriptPath = path.join(__dirname, '../exports/TRANSKRIP_LENGKAP_SEMUA_CHAT.md');
  if (!fs.existsSync(transcriptPath)) {
    console.error(`[ERROR] File transkrip tidak ditemukan di: ${transcriptPath}`);
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(`🚀 MEMULAI EKSTRAKSI PRESISI TRANSKRIP CHAT WHATSAPP`);
  console.log(`======================================================`);
  console.log(`Mode: ${isCommit ? '⚡ COMMIT KE DATABASE AKTIF' : '🔍 DRY-RUN / PREVIEW'}`);
  console.log(`Membaca file: ${transcriptPath}...\n`);

  const fileContent = fs.readFileSync(transcriptPath, 'utf-8');
  const transactions = extractTransactionsFromTranscript(fileContent);

  console.log(`✅ Berhasil mengekstrak ${transactions.length} record transaksi bersih.\n`);

  // Ringkasan Finansial
  let totalOmset = 0;
  let totalOngkir = 0;
  let totalPromo = 0;
  for (const tx of transactions) {
    totalOmset += tx.totalPrice;
    totalOngkir += tx.ongkir;
    totalPromo += tx.promo;
  }

  console.log(`📊 RINGKASAN DATA HISTORIS:`);
  console.log(`   - Total Transaksi Selesai : ${transactions.length} reservasi`);
  console.log(`   - Total Omset Transaksi   : Rp ${totalOmset.toLocaleString('id-ID')}`);
  console.log(`   - Total Ongkos Kirim      : Rp ${totalOngkir.toLocaleString('id-ID')}`);
  console.log(`   - Total Potongan Promo    : Rp ${totalPromo.toLocaleString('id-ID')}\n`);

  // Cetak sampel 5 transaksi pertama
  console.log(`--- [SAMPEL 5 TRANSAKSI HASIL PARSING] ---`);
  transactions.slice(0, 5).forEach((tx, idx) => {
    console.log(`\n#${idx + 1}. ${tx.customerName} (${tx.customerPhone})`);
    console.log(`   - Alamat      : ${tx.address}`);
    console.log(`   - Bayi/Usia   : ${tx.babyName || '-'} (${tx.babyAge || '-'})`);
    console.log(`   - Layanan     : [${tx.treatmentCategory}] ${tx.treatmentDetail}`);
    console.log(`   - Jadwal      : ${tx.bookingDateStr} -> ${tx.bookingDate ? tx.bookingDate.toISOString() : 'N/A'}`);
    console.log(`   - Finansial   : Treatment: Rp ${tx.treatmentPrice.toLocaleString('id-ID')} | Ongkir: Rp ${tx.ongkir.toLocaleString('id-ID')} | Promo: Rp ${tx.promo.toLocaleString('id-ID')} | Total: Rp ${tx.totalPrice.toLocaleString('id-ID')}`);
  });
  console.log(`\n------------------------------------------\n`);

  // Ekspor ke Markdown jika diminta
  if (exportMdFile) {
    const mdPath = path.isAbsolute(exportMdFile) ? exportMdFile : path.join(process.cwd(), exportMdFile);
    let md = `# Rekap Transaksi Bersih Kala Moms & Baby Spa\n\n`;
    md += `| No | Phone | Date & Time | Customer Name | Address | Baby Name | Treatment | Treatment Price | Ongkir | Promo | Total |\n`;
    md += `|---:|:---|:---|:---|:---|:---|:---|---:|---:|---:|---:|\n`;

    transactions.forEach((tx, i) => {
      md += `| ${i + 1} | ${tx.customerPhone} | ${tx.bookingDateStr} | ${tx.customerName} | ${tx.address.replace(/\|/g, '-')} | ${tx.babyName || '-'} | ${tx.treatmentDetail.replace(/\|/g, '-')} | ${tx.treatmentPrice} | ${tx.ongkir} | ${tx.promo} | ${tx.totalPrice} |\n`;
    });

    fs.writeFileSync(mdPath, md, 'utf-8');
    console.log(`📄 Rekap tabel bersih berhasil diekspor ke: ${mdPath}`);
  }

  // Jika mode commit aktif, masukkan ke database
  if (isCommit) {
    console.log(`\n⚡ MENYUNTIKKAN DATA KE DATABASE POSTGRESQL...`);
    let customerCount = 0;
    let childCount = 0;
    let reservationCount = 0;

    for (const tx of transactions) {
      try {
        // 1. Upsert Customer
        const customer = await prisma.customer.upsert({
          where: { phone: tx.customerPhone },
          create: {
            tenant_id: DEFAULT_TENANT_ID,
            phone: tx.customerPhone,
            name: tx.customerName,
            kecamatan: tx.kec || undefined,
            kota: tx.kota || undefined,
            status: 'legacy',
            is_sandbox_test: false,
          },
          update: {
            name: tx.customerName || undefined,
            kecamatan: tx.kec || undefined,
            kota: tx.kota || undefined,
          },
        });
        customerCount++;

        // 2. Insert Data Anak jika ada
        if (tx.babyName && tx.babyName !== '-' && tx.babyName.length > 1) {
          const existingChild = await prisma.child.findFirst({
            where: {
              customer_id: customer.id,
              name: { equals: tx.babyName, mode: 'insensitive' },
            },
          });

          if (!existingChild) {
            await prisma.child.create({
              data: {
                tenant_id: DEFAULT_TENANT_ID,
                customer_id: customer.id,
                name: tx.babyName,
                raw_age_text: tx.babyAge && tx.babyAge !== '-' ? tx.babyAge : undefined,
              },
            });
            childCount++;
          }
        }

        // 3. Insert Reservation (completed)
        const bookingDate = tx.bookingDate || new Date();
        const cleanRawText = (tx.rawFormText || '').replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\\/g, '/');
        const existingRes = await prisma.reservation.findFirst({
          where: {
            customer_id: customer.id,
            treatment_detail: tx.treatmentDetail,
            booking_date: tx.bookingDate ? { equals: tx.bookingDate } : undefined,
          },
        });

        if (!existingRes) {
          await prisma.reservation.create({
            data: {
              tenant_id: DEFAULT_TENANT_ID,
              customer_id: customer.id,
              treatment_category: tx.treatmentCategory as any,
              treatment_detail: tx.treatmentDetail,
              booking_date: bookingDate,
              purchase_value: tx.totalPrice,
              status: 'completed',
              raw_text: cleanRawText,
            },
          });
          reservationCount++;
        }

        // 4. Sinkronkan juga ke antrean LegacyStaging (status: COMMITTED)
        const reservationJson = {
          name: tx.customerName,
          phone: tx.customerPhone,
          address: tx.address,
          kec: tx.kec,
          kota: tx.kota,
          treatmentCategory: tx.treatmentCategory,
          treatmentDetail: tx.treatmentDetail,
          bookingDate: tx.bookingDate ? tx.bookingDate.toISOString() : null,
          rawText: cleanRawText,
          babies: tx.babyName ? [{ name: tx.babyName, age: tx.babyAge }] : [],
          payment: {
            treatmentPrice: tx.treatmentPrice,
            ongkir: tx.ongkir,
            promo: tx.promo,
            totalPrice: tx.totalPrice,
          },
        };

        const loc = [tx.kec, tx.kota].filter(Boolean).join(', ') || (tx.address !== '-' ? tx.address : undefined);
        await prisma.legacyStaging.upsert({
          where: { phoneNumber: tx.customerPhone },
          create: {
            tenantId: DEFAULT_TENANT_ID,
            phoneNumber: tx.customerPhone,
            name: tx.customerName,
            extractedLocation: loc || null,
            leadCreatedAt: tx.bookingDate || new Date(),
            firstPurchaseAt: tx.bookingDate || new Date(),
            extractedReservationJson: reservationJson,
            status: 'COMMITTED',
            rawMessagesCount: 1,
            rawMessagesJson: [
              {
                body: cleanRawText + (tx.rawPaymentText ? '\n\n' + tx.rawPaymentText.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\\/g, '/') : ''),
                fromMe: false,
                timestamp: (tx.bookingDate ? tx.bookingDate.getTime() : Date.now()),
              },
            ],
          },
          update: {
            name: tx.customerName || undefined,
            extractedLocation: loc || undefined,
            extractedReservationJson: reservationJson,
            status: 'COMMITTED',
          },
        });
      } catch (err: any) {
        console.warn(`[WARN] Gagal menyuntikkan data ${tx.customerPhone} (${tx.customerName}):`, err.message);
      }
    }

    console.log(`\n🎉 SEEDING SELESAI DENGAN SUKSES:`);
    console.log(`   - Customer Disinkronkan : ${customerCount}`);
    console.log(`   - Data Anak Ditambahkan : ${childCount}`);
    console.log(`   - Reservasi Completed   : ${reservationCount} transaksi`);
  } else {
    console.log(`\n💡 Catatan: Jalankan dengan argumen '--commit' untuk menyimpan data ini ke database aktif:`);
    console.log(`   npx tsx scripts/seed-transcripts-to-db.ts --commit\n`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
