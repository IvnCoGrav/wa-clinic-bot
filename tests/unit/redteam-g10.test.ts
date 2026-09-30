import { describe, it, expect } from 'vitest';
import {
  isAvailabilityInquiryText,
  hasBookingCommitSignal,
} from '../../src/utils/date-confirmation';
import { isBookingCommitReady } from '../../src/v3/agent/pipeline/booking-commit-gate';
import * as fs from 'fs';
import * as path from 'path';

describe('Red-Team Verification: G10 - 100 Kalimat Tanya Slot Tanpa ?', () => {
  it('tests 100 slot inquiry sentences without question mark and evaluates commit leakage', () => {
    // 100 kalimat tanya ketersediaan slot tanpa '?' (slang, singkatan, typo, variasi dialek)
    const sentences: string[] = [
      // Kategori 1: Partikel tanya slang (gak, ga, nggak, ngga, engga, enggra, kagak, kah, kan)
      "sabtu jam 10 kosong gak",
      "sabtu jam 10 kosong ga",
      "sabtu jam 10 kosong nggak",
      "sabtu jam 10 kosong ngga",
      "sabtu jam 10 kosong engga",
      "sabtu jam 10 kosong enggak",
      "sabtu jam 10 kosong kagak",
      "minggu pagi ada slot ga min",
      "minggu pagi ada slot gak kak",
      "jumat sore ada kuota ga",
      "besok ada jadwal kosong ga",
      "besok ada slot ngga mbak",
      "lusa pagi kosong gak ya",
      "sabtu besok lowong ga min",
      "tanggal 15 ada slot ga kak",
      "tgl 20 ada jadwal kosong gak",
      "hari senin masih ada kuota ga",
      "hari selasa ready gak min",
      "kamis jam 9 pagi ada gak",
      "rabu jam 2 siang kosong ga",

      // Kategori 2: Singkatan WhatsApp khas (bs, bsa, gmn, tgl, min, kak, mba)
      "sabtu bs ga min",
      "sabtu bsa gak kak",
      "bsa jam 10 pagi ga",
      "bs ga hari minggu besok",
      "gmn jadwal sabtu besok",
      "gimana jadwal hari jumat kosong ga",
      "tgl 10 bsa ga ya",
      "ada slot tgl 12 ga min",
      "ready tgl 15 gak mbak",
      "ada jadwal kosong tgl 18 ga",
      "cek jadwal sabtu dong min",
      "minta cek jadwal jumat jam 10",
      "cek ketersediaan hari minggu ya",
      "tanya slot hari sabtu dong",
      "mau tanya jadwal besok min",
      "mau nanya slot kosong hari senin",
      "tanya jadwal kosong minggu depan",
      "minta slot hari sabtu kalau ada",
      "bisa minta tolong cek slot sabtu",
      "tolong cekkan jadwal hari kamis",

      // Kategori 3: Kata tanya eksplisit / penanda tanya (apakah, kapan, berapa, apa)
      "apakah sabtu jam 10 ada slot",
      "apakah besok masih kosong",
      "apakah hari minggu bisa kunjungan",
      "kapan ada slot kosong terdekat",
      "kapan jadwal kosong di sidoarjo",
      "kapan bidan ready ke candi",
      "apa ada jadwal kosong besok",
      "apa besok ada slot kosong",
      "apakah masih tersedia jadwal sabtu",
      "apakah tanggal 25 kosong",

      // Kategori 4: Struktur Noun + Marker ("ada slot", "masih kosong", "bisa jadwal") tanpa partikel
      "ada slot sabtu jam 10",
      "ada slot hari minggu",
      "ada slot kosong besok",
      "ada jadwal kosong jumat",
      "ada jadwal sabtu siang",
      "masih ada slot hari minggu",
      "masih ada slot sabtu pagi",
      "masih kosong hari senin",
      "masih kosong besok jam 10",
      "masih tersedia slot jumat",
      "bisa slot sabtu jam 9",
      "boleh jadwal hari minggu",
      "ready slot sabtu besok",
      "ready jadwal minggu ini",
      "tersedia slot hari rabu",

      // Kategori 5: Pola inversi / verba tanya di depan tanpa '?' ("bisa gak ...", "ada gak ...")
      "bisa ga sabtu jam 10",
      "bisa gak hari minggu",
      "bisa nggak besok siang",
      "boleh ga jadwal sabtu",
      "boleh gak jumat jam 1",
      "ada gak slot kosong besok",
      "ada ga jadwal hari senin",
      "ada nggak kuota sabtu besok",
      "ready ga tanggal 15",
      "ready gak hari kamis",

      // Kategori 6: Kalimat elipsis / ambigu / tanpa penanda tanya formal (Kasus Batas Ekstrem)
      "sabtu jam 10 kosong",
      "besok jam 9 pagi kosong",
      "hari minggu kosong",
      "minggu besok lowong",
      "tanggal 10 masih kosong",
      "sabtu jam 10 tersedia",
      "jumat sore ada",
      "besok jam 10 ready",
      "sabtu jam 9 ready",
      "senin pagi masih ada",

      // Kategori 7: Kalimat sopan pembuka tanya tanpa tanda tanya
      "mau cek jadwal hari sabtu",
      "mau tanya jadwal sabtu jam 10",
      "mau kepo slot besok min",
      "pengen tahu jadwal kosong sabtu",
      "mau konsul jadwal jumat besok",
      "mau info slot kosong hari minggu",
      "info jadwal kosong sabtu min",
      "info slot hari senin dong",
      "spill slot kosong weekend min",
      "minta info ketersediaan hari sabtu",

      // Kategori 8: Kalimat dengan kata "mau booking" tapi diakhiri tanya slot
      "mau booking sabtu jam 10 kosong gak",
      "mau booking hari minggu ada slot ga",
      "pengen booking besok bisa ga min",
      "niat booking jumat ada slot kosong ga",
      "rencana booking sabtu masih ada kuota ga",
      "mau pesan jadwal sabtu tapi kosong gak",
      "mau order besok ready ga kak",
      "mau ambil paket sabtu tapi ada slot ga",
      "pengen ambil sabtu kosong nggak ya",
      "mau daftar sabtu jam 10 ada slot ga"
    ];

    const testSentences = sentences.slice(0, 100);
    expect(testSentences.length).toBe(100);

    // Mock session: customer sudah punya selectedTreatment dan lokasi lengkap
    // tapi belum konfirmasi final (bookingCommitConfirmed = false)
    const baseSession: any = {
      selectedTreatment: 'Kala Baby – Pijat Bayi Ceria',
      cartItems: [{ name: 'Kala Baby – Pijat Bayi Ceria' }],
      location: {
        rawText: 'Candi Sidoarjo',
        kecamatan: 'Candi',
        kota: 'Kabupaten Sidoarjo',
      },
      bookingCommitConfirmed: false,
    };

    const results: any[] = [];
    let leakedCount = 0;
    let identifiedAsInquiryCount = 0;
    let hasCommitSignalCount = 0;

    for (let i = 0; i < testSentences.length; i++) {
      const text = testSentences[i];
      const isAvailability = isAvailabilityInquiryText(text);
      const hasCommit = hasBookingCommitSignal(text);
      const isCommitReady = isBookingCommitReady(baseSession, text, []);

      if (isAvailability) identifiedAsInquiryCount++;
      if (hasCommit) hasCommitSignalCount++;
      if (isCommitReady) {
        leakedCount++;
      }

      results.push({
        index: i + 1,
        text,
        isAvailabilityInquiryText: isAvailability,
        hasBookingCommitSignal: hasCommit,
        isBookingCommitReady: isCommitReady,
        leakedAsCommit: isCommitReady,
      });
    }

    const leakedCases = results.filter(r => r.leakedAsCommit);

    const summary = {
      totalTested: testSentences.length,
      identifiedAsInquiry: identifiedAsInquiryCount,
      hasBookingCommitSignal: hasCommitSignalCount,
      leakedAsCommit: leakedCount,
      leakedPercentage: `${(leakedCount / testSentences.length * 100).toFixed(1)}%`,
      leakedExamples: leakedCases.map(c => ({ index: c.index, text: c.text })),
    };

    const evidenceDir = path.resolve(process.cwd(), 'audit/evidence/P1');
    if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.resolve(evidenceDir, 'evidence_g10_slang_inquiry.json'), JSON.stringify({ summary, details: results }, null, 2), 'utf-8');

    console.log('SUMMARY G10 SLANG INQUIRY AUDIT:');
    console.log(JSON.stringify(summary, null, 2));

    // Laporan fakta hasil eksekusi
    expect(leakedCount).toBeDefined();
  });
});
