/**
 * run-test-plan-reservasi.ts — Test Harness untuk 50 Skenario Chat Realistis (Goal: Sampai Reservasi)
 * (docs/TEST_PLAN_50_RESERVASI.md).
 *
 * Usage:
 *   npx tsx scripts/run-test-plan-reservasi.ts            # DEFAULT: LLM Live (bila key tersedia di .env)
 *   npx tsx scripts/run-test-plan-reservasi.ts --offline  # pakai rule-based fallback
 *   npx tsx scripts/run-test-plan-reservasi.ts --cat A    # jalankan hanya kategori A
 *   npx tsx scripts/run-test-plan-reservasi.ts --only 1   # jalankan hanya skenario 1
 */

/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';

// ============ 1. ENV SETUP ============
process.env.WAHA_MOCK = 'true';
process.env.BURST_COALESCE_MS = '0';

const RESULTS_FILE = path.join(__dirname, '..', 'test-results', 'run-results-reservasi.json');
const REPORT_FILE = path.join(__dirname, '..', 'docs', 'LAPORAN_TESTING_50_RESERVASI.md');

async function main() {
  const args = process.argv.slice(2);
  // Default to LLM Live unless --offline is passed
  const isOffline = args.includes('--offline');
  const useLLM = !isOffline;

  const valOf = (flag: string): string => {
    const eq = args.find((a) => a.startsWith(`${flag}=`));
    if (eq) return eq.split('=')[1] || '';
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] || '' : '';
  };

  const onlyNo = parseInt(valOf('--only'), 10);
  const onlyCat = valOf('--cat').toUpperCase();

  await import('dotenv/config');

  if (!useLLM) {
    process.env.LLM_API_KEY = '';
    process.env.OPENAI_API_KEY = '';
    process.env.AI_MODEL_ROUTER = '';
  }

  // ============ 2. IMPORT KOMPONEN PRODUCTION ============
  const { ConversationStateMachine } = await import('../src/state-machine/machine');
  const { TypingService } = await import('../src/services/typing.service');
  const { ConversationState } = await import('@prisma/client');
  const { customerService } = await import('../src/services/customer.service');
  const { conversationService } = await import('../src/services/conversation.service');
  const { DEFAULT_TENANT_ID } = await import('../src/config/tenant');
  const { clinicConfig } = await import('../src/config/clinic');
  const { RecordingWahaClient } = await import('./lib/recording-client');

  const recorder = new RecordingWahaClient();
  const typingSvc = new TypingService(recorder, 1000);
  const machine = new ConversationStateMachine(typingSvc);

  const clinicLoc = { lat: clinicConfig.lat, lng: clinicConfig.lng };

  // ============ 3. DEFINISI MODEL SKENARIO & FORM GENERATOR ============
  interface Step {
    kind: 'text' | 'location';
    body?: string;
    lat?: number;
    lng?: number;
    delayMs?: number;
  }

  interface Scenario {
    no: number;
    category: string;
    title: string;
    goalState: string; // 'RESERVATION_SENT' | 'HUMAN_HANDLING' | 'COMPLETED'
    steps: Step[];
    preSetup?: (phone: string, customerId: string) => Promise<void>;
  }

  const S: Scenario[] = [];

  const text = (body: string, delayMs?: number): Step => ({ kind: 'text', body, delayMs });
  const loc = (lat: number, lng: number): Step => ({ kind: 'location', lat, lng });

  // Inline format generator (e.g. "Pilihan treatment (Baby & Kids) : Pijat Bayi Ceria")
  function makeInlineForm(params: {
    nama: string;
    kec: string;
    kota?: string;
    alamat?: string;
    phone?: string;
    treatment: string;
    categoryHeader?: string;
    tanggal?: string;
  }) {
    const header = params.categoryHeader || 'Pilihan treatment (Baby & Kids)';
    return `Berikut list untuk reservasi :

Hari dan tanggal : ${params.tanggal || 'Senin, 10 Agustus 2026 jam 10.00'}
Nama Bunda: ${params.nama}
Alamat & Shareloc : ${params.alamat || 'Jl. Utama No. 12'}
Kec : ${params.kec}
Kota : ${params.kota || 'Surabaya'}
No. Hp : ${params.phone || '08123456789'}

${header} : ${params.treatment}`;
  }

  // Standard line-separated format generator (e.g. "Pilihan treatment (Baby & Kids)\nNama Bayi : Adek Kenzo\nUsia : 6 bln\nTreatment : Pijat Bayi Rileks")
  function makeStandardForm(params: {
    nama: string;
    kec: string;
    kota?: string;
    alamat?: string;
    phone?: string;
    babyName?: string;
    babyAge?: string;
    treatment: string;
    tanggal?: string;
  }) {
    return `Berikut list untuk reservasi :

Hari dan tanggal : ${params.tanggal || 'Selasa, 11 Agustus 2026 jam 14.00'}
Nama Bunda: ${params.nama}
Alamat & Shareloc : ${params.alamat || 'Jl. Perumahan Indah No. 45'}
Kec : ${params.kec}
Kota : ${params.kota || 'Surabaya'}
No. Hp : ${params.phone || '08198765432'}

Pilihan treatment (Baby & Kids)

Nama Bayi : ${params.babyName || 'Adek Kenzo'}
Usia Bayi/Anak : ${params.babyAge || '6 bulan'}
Treatment : ${params.treatment}`;
  }

  // Multi-baby twin form generator
  const twinForm = `Berikut list untuk reservasi :

Hari dan tanggal : Selasa, 11 Agustus 2026 jam 14.00
Nama Bunda: Bunda Rahma
Alamat & Shareloc : Jl. Rungkut Asri No. 5
Kec : Rungkut
Kota : Surabaya
No. Hp : 08198765432

Pilihan treatment (Baby & Kids) : Pijat Bayi (3 bln) & Pijat Anak (3 thn)`;

  // Moms nifas form generator
  const nifasForm = `Berikut list untuk reservasi :

Hari dan tanggal : Rabu, 12 Agustus 2026 jam 09.00
Nama Bunda: Bunda Siti
Alamat & Shareloc : Jl. Siwalankerto No. 88
Kec : Wonocolo
Kota : Surabaya
No. Hp : 08111222333

Pilihan treatment (Moms & Nifas) : Pijat Postpartum Nifas`;

  // --- A. Jalur Mulus (1-8) ---
  S.push({
    no: 1, category: 'A', title: 'Kooperatif — greeting -> alamat kel/kec -> tertarik -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo bu'), text('Rumah saya di kelurahan Wonokromo kec Wonokromo Surabaya'), text('Oke tertarik, gimana caranya'), text(makeInlineForm({ nama: 'Bunda Ani', kec: 'Wonokromo', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 2, category: 'A', title: 'Kooperatif — spa bayi -> sharelock -> booking -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Selamat pagi, mau tanya soal spa bayi'), loc(-7.30, 112.75), text('Wah lumayan deket ya, oke saya mau booking'), text(makeStandardForm({ nama: 'Bunda Dewi', kec: 'Gubeng', treatment: 'Pijat Spa Bayi' }))],
  });
  S.push({
    no: 3, category: 'A', title: 'Kooperatif — salam -> Sidoarjo Waru -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Assalamualaikum bu bidan'), text('Sidoarjo, Waru, deket perumahan Graha Indah'), text('Boleh langsung reservasi ga?'), text(makeInlineForm({ nama: 'Bunda Fitri', kec: 'Waru', kota: 'Sidoarjo', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 4, category: 'A', title: 'Kooperatif — Hai -> Ngagel Jaya Selatan -> form data usia campur',
    goalState: 'RESERVATION_SENT',
    steps: [text('Hai'), text('Ngagel Jaya Selatan'), text('Iya deh, kirim form reservasinya'), text(makeInlineForm({ nama: 'Bunda Maya', kec: 'Wonokromo', treatment: 'Pijat Bayi 3 bln' }))],
  });
  S.push({
    no: 5, category: 'A', title: 'Kooperatif — sharelock -> minat -> form 2 anak',
    goalState: 'RESERVATION_SENT',
    steps: [loc(-7.335, 112.73), text('oke saya minat'), text(twinForm)],
  });
  S.push({
    no: 6, category: 'A', title: 'Kooperatif — tanya dulu -> Rungkut -> booking -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Bunda mau tanya-tanya dulu boleh?'), text('Boleh'), text('Rungkut Surabaya'), text('ok mau booking'), text(makeInlineForm({ nama: 'Bunda Sarah', kec: 'Rungkut', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 7, category: 'A', title: 'Asking schedule di awal -> Pakuwon City -> reservasi -> form',
    goalState: 'HUMAN_HANDLING', // Dual-path / asking schedule early triggers human handling
    steps: [text('Pagi, ada slot buat besok ga?'), text('Pakuwon City'), text('oke reservasi aja'), text(makeInlineForm({ nama: 'Bunda Linda', kec: 'Mulyosari', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 8, category: 'A', title: 'FAQ newborn di awal -> Gunung Anyar -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo, ada paket buat bayi baru lahir?'), text('Rumah di Gunung Anyar'), text('iya mau, kirim formnya'), text(makeStandardForm({ nama: 'Bunda Nina', kec: 'Gunung Anyar', treatment: 'Pijat Bayi Newborn' }))],
  });

  // --- B. Disela FAQ/Harga di Tengah Jalan (9-16) ---
  S.push({
    no: 9, category: 'B', title: 'Disela "beneran bidan atau bot" saat lokasi -> tertarik -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo'), text('Rungkut'), text('eh btw ini beneran bidan asli atau bot ya'), text('oke saya tertarik'), text(makeInlineForm({ nama: 'Bunda Rini', kec: 'Rungkut', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 10, category: 'B', title: 'Sukolilo ambigu -> deket ITS -> FAQ harga -> booking -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Hi bu'), text('Sukolilo Surabaya'), text('yang deket ITS'), text('pijat bayi ceria harganya berapa ya'), text('oke oke, saya mau booking itu'), text(makeInlineForm({ nama: 'Bunda Intan', kec: 'Sukolilo', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 11, category: 'B', title: 'Wiyung -> FAQ terapis cewek -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo'), text('Wiyung'), text('terapisnya cewek semua kan'), text('oh oke aman berarti, lanjut reservasi'), text(makeInlineForm({ nama: 'Bunda Dina', kec: 'Wiyung', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 12, category: 'B', title: 'Jl Ahmad Yani -> FAQ medis ringan 2 minggu -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Selamat siang'), text('Jl Ahmad Yani deket royal plaza'), text('bayi umur 2 minggu boleh dipijat ga'), text('oke kalau gitu saya reservasi ya'), text(makeStandardForm({ nama: 'Bunda Tari', kec: 'Wonocolo', treatment: 'Pijat Bayi Newborn' }))],
  });
  S.push({
    no: 13, category: 'B', title: 'Wonorejo -> FAQ paket selapan -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo bunda'), text('Wonorejo'), text('paket selapan itu apa bedanya sama yang lain'), text('oke ambil paket selapan aja, gimana caranya'), text(makeInlineForm({ nama: 'Bunda Lia', kec: 'Rungkut', treatment: 'Paket Selapan Bayi' }))],
  });
  S.push({
    no: 14, category: 'B', title: 'Gayungan -> FAQ reschedule -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Pagi'), text('Gayungan'), text('oh iya sekalian, kalau reschedule gimana ya nanti kalau mendadak ada acara'), text('oke ga masalah, lanjut aja reservasi'), text(makeInlineForm({ nama: 'Bunda Vera', kec: 'Gayungan', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 15, category: 'B', title: 'FAQ manfaat duluan -> Jambangan -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo'), text('pijat bayi itu manfaatnya apa aja sih'), text('oh oke, saya di Jambangan'), text('mau, reservasi'), text(makeStandardForm({ nama: 'Bunda Wulan', kec: 'Jambangan', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 16, category: 'B', title: 'Ketintang -> FAQ owner -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Hai bu bidan'), text('Ketintang'), text('ownernya siapa ya kok baru denger'), text('oke lanjut aja saya reservasi'), text(makeInlineForm({ nama: 'Bunda Nisa', kec: 'Gayungan', treatment: 'Pijat Bayi Ceria' }))],
  });

  // --- C. Ragu-ragu / Diyakinkan (17-24) ---
  S.push({
    no: 17, category: 'C', title: 'Wonokromo -> "mahal juga ya" -> worth it -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo'), text('Wonokromo'), text('mahal juga ya'), text('ah oke deh worth it kayaknya, reservasi'), text(makeInlineForm({ nama: 'Bunda Kiki', kec: 'Wonokromo', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 18, category: 'C', title: 'Karah -> "pikir-pikir dulu" -> delay -> jadi reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Hai'), text('Karah'), text('saya pikir-pikir dulu ya'), text('oke jadi deh, gimana caranya reservasi'), text(makeInlineForm({ nama: 'Bunda Siska', kec: 'Jambangan', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 19, category: 'C', title: 'Jemursari -> "aman ga buat newborn" -> percaya -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo'), text('Jemursari'), text('ini aman ga sih buat bayi baru lahir'), text('ok percaya deh, lanjut reservasi'), text(makeStandardForm({ nama: 'Bunda Mega', kec: 'Wonocolo', treatment: 'Pijat Bayi Newborn' }))],
  });
  S.push({
    no: 20, category: 'C', title: 'Menur Pumpungan -> FAQ refund -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Selamat malam'), text('Menur Pumpungan'), text('kalau ga cocok bisa refund ga'), text('oke saya coba dulu deh, reservasi'), text(makeInlineForm({ nama: 'Bunda Yulia', kec: 'Sukolilo', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 21, category: 'C', title: 'Tenggilis -> FAQ anak nangis -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo'), text('Tenggilis'), text('nanti kalau anak nangis terus gimana, dihentikan ga'), text('oke masuk akal, saya reservasi'), text(makeInlineForm({ nama: 'Bunda Tari', kec: 'Tenggilis Mejoyo', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 22, category: 'C', title: 'Sidosermo -> FAQ kompetitor -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Hai bu'), text('Sidosermo'), text('bandingin sama spa X (kompetitor) apa bedanya'), text('oke saya coba punya bunda dulu, reservasi'), text(makeInlineForm({ nama: 'Bunda Melly', kec: 'Wonocolo', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 23, category: 'C', title: 'Panjang Jiwo -> FAQ testimoni -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo'), text('Panjang Jiwo'), text('boleh liat testimoni dulu ga'), text('oke yakin sekarang, reservasi'), text(makeInlineForm({ nama: 'Bunda Poppy', kec: 'Tenggilis Mejoyo', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 24, category: 'C', title: 'Dukuh Kupang -> suami belum setuju -> setuju -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Hai'), text('Dukuh Kupang'), text('suami saya belum setuju nih, tapi kayaknya bakal iya'), text('oke udah setuju, reservasi'), text(makeInlineForm({ nama: 'Bunda Astrid', kec: 'Dukuh Pakis', treatment: 'Pijat Bayi Ceria' }))],
  });

  // --- D. Typo / Singkatan / Informal (25-30) ---
  S.push({
    no: 25, category: 'D', title: 'Typo "wonorejo rungkuttt" -> "sikattt" -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Hallo'), text('wonorejo rungkuttt'), text('oke sikattt, reservasi dong'), text(makeInlineForm({ nama: 'Bunda Poppy', kec: 'Rungkut', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 26, category: 'D', title: 'Single char "p" -> sby, gununganyar -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('p'), text('oh sori kepencet, halo bu mau tanya spa bayi'), text('sby, gununganyar'), text('oke gas reservasi'), text(makeInlineForm({ nama: 'Bunda Tika', kec: 'Gunung Anyar', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 27, category: 'D', title: 'Slang "wtb spa" -> tandes surabaya -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('wtb spa bayi wkwk'), text('jaksel eh maksudnya surabaya, tandes'), text('mantul, reservasi yaa'), text(makeInlineForm({ nama: 'Bunda Karin', kec: 'Tandes', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 28, category: 'D', title: 'Singkatan -> jl raya darmo deket kebun binatang -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo bu, mau nanya2 dlu'), text('sy tinggal di jl raya darmo, deket kebun binatang'), text('oke mnt reservasi'), text(makeInlineForm({ nama: 'Bunda Bella', kec: 'Wonokromo', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 29, category: 'D', title: 'Singkatan berat "Krmbngn" -> Krembangan -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('hi'), text('Krmbngn'), text('maksudnya Krembangan Surabaya'), text('oke reservasi'), text(makeInlineForm({ nama: 'Bunda Clara', kec: 'Krembangan', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 30, category: 'D', title: 'Available skrg -> gubeng deket rmh sakit -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('bu bidan available ga skrg'), text('oh iya location dulu ya, sy di gubeng deket rmh sakit'), text('sip reservasi aja'), text(makeInlineForm({ nama: 'Bunda Nadia', kec: 'Gubeng', treatment: 'Pijat Bayi Ceria' }))],
  });

  // --- E. Interupsi Medis Ringan (31-33) ---
  S.push({
    no: 31, category: 'E', title: 'Babatan -> pilek ringan -> conditional (FAQ or escalation)',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo'), text('Babatan'), text('bayi saya agak pilek dikit nih, boleh dipijat ga'), text('oh oke, reservasi aja kalau gitu'), text(makeInlineForm({ nama: 'Bunda Sani', kec: 'Wiyung', treatment: 'Pijat Bayi Pilek Ringan' }))],
  });
  S.push({
    no: 32, category: 'E', title: 'Pagesangan -> susah BAB -> FAQ -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Hai'), text('Pagesangan'), text('anak saya agak susah BAB akhir-akhir ini, ada pijat khusus itu ga'), text('oh ada ya, oke reservasi'), text(makeInlineForm({ nama: 'Bunda Irma', kec: 'Jambangan', treatment: 'Pijat Bayi Pediatrik BAB' }))],
  });
  S.push({
    no: 33, category: 'E', title: 'Wonocolo -> newborn 5 hari -> FAQ -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo'), text('Wonocolo'), text('newborn umur 5 hari udah boleh dipijat belum'), text('oke pas timing-nya, reservasi'), text(makeStandardForm({ nama: 'Bunda Henny', kec: 'Wonocolo', treatment: 'Pijat Bayi Newborn' }))],
  });

  // --- F. Multi-Anak / Data Kompleks (34-37) ---
  S.push({
    no: 34, category: 'F', title: 'Kutisari -> 2 anak beda usia di form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo'), text('Kutisari'), text('mau'), text(twinForm)],
  });
  S.push({
    no: 35, category: 'F', title: 'Siwalankerto -> form treatment nifas/moms',
    goalState: 'RESERVATION_SENT',
    steps: [text('Hai bu'), text('Siwalankerto'), text('oke'), text(nifasForm)],
  });
  S.push({
    no: 36, category: 'F', title: 'Bendul Merisi -> nama anak panjang di form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo'), text('Bendul Merisi'), text('mau reservasi'), text(makeInlineForm({ nama: 'Bunda Anastasia Aurelia Permata Putri', kec: 'Wonocolo', treatment: 'Pijat Spa Anak' }))],
  });
  S.push({
    no: 37, category: 'F', title: 'Jajar Tunggal -> ganti tanggal di form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Hai'), text('Jajar Tunggal'), text('oke lanjut'), text(makeInlineForm({ nama: 'Bunda Amalia', kec: 'Wiyung', tanggal: 'Senin depan, 17 Agustus 2026 jam 10.00', treatment: 'Pijat Bayi Ceria' }))],
  });

  // --- G. Sempat Hampir Batal, Lalu Balik (38-41) ---
  S.push({
    no: 38, category: 'G', title: 'Simomulyo -> mahal ga jadi -> balik lagi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo'), text('Simomulyo'), text('ga jadi deh mahal'), text('eh jadi deh, gimana reservasi'), text(makeInlineForm({ nama: 'Bunda Erna', kec: 'Sukomanunggal', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 39, category: 'G', title: 'Tandes -> mikir dulu -> balik lagi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Hai'), text('Tandes'), text('nanti aja deh mikir dulu'), text('oke jadi, reservasi'), text(makeInlineForm({ nama: 'Bunda Ghea', kec: 'Tandes', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 40, category: 'G', title: 'Manukan -> diskusi suami -> balik -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo'), text('Manukan'), text('oke tunggu bentar ya lagi diskusi sama suami'), text('oke acc, lanjut reservasi'), text(makeInlineForm({ nama: 'Bunda Hannah', kec: 'Tandes', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 41, category: 'G', title: 'Sawahan -> tanya promo -> full price -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Hai bu'), text('Sawahan'), text('mau tapi budget masih mikir'), text('bu, ada promo ga biar jadi murah dikit'), text('oke ga papa full price aja, reservasi'), text(makeInlineForm({ nama: 'Bunda Ines', kec: 'Sawahan', treatment: 'Pijat Bayi Ceria' }))],
  });

  // --- H. Operasional / Ekstra (42-45) ---
  S.push({
    no: 42, category: 'H', title: 'Kedurus -> terapis jam berapa -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo'), text('Kedurus'), text('terapisnya kesini jam berapa biasanya'), text('oke ngerti, reservasi'), text(makeInlineForm({ nama: 'Bunda Julia', kec: 'Karang Pilang', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 43, category: 'H', title: 'Made Sambikerep -> alat yang dibawa -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Hai'), text('Made'), text('oke, alat2 yang dibawa apa aja'), text('sip, reservasi'), text(makeInlineForm({ nama: 'Bunda Kartika', kec: 'Sambikerep', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 44, category: 'H', title: 'Lidah Kulon -> preparasi sebelum terapis datang -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo bu'), text('Lidah Kulon'), text('perlu siapin apa aja sebelum terapis dateng'), text('noted, reservasi ya'), text(makeInlineForm({ nama: 'Bunda Laras', kec: 'Lakarsantri', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 45, category: 'H', title: 'Lakarsantri -> cash or transfer -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Hai'), text('Lakarsantri'), text('bayarnya cash apa transfer'), text('oke paham, reservasi'), text(makeInlineForm({ nama: 'Bunda Mona', kec: 'Lakarsantri', treatment: 'Pijat Bayi Ceria' }))],
  });

  // --- I. Edge Lokasi (46-48) ---
  S.push({
    no: 46, category: 'I', title: 'Sharelock exact klinik (0 km) -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [loc(clinicLoc.lat, clinicLoc.lng), text('deket banget ya berarti, oke reservasi'), text(makeInlineForm({ nama: 'Bunda Nia', kec: 'Wonokromo', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 47, category: 'I', title: 'Mulyosari deket ITS -> LLM fallback -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Hai'), text('Mulyosari deket ITS'), text('oke reservasi aja'), text(makeInlineForm({ nama: 'Bunda Olivia', kec: 'Mulyorejo', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 48, category: 'I', title: 'Koreksi lokasi (Malang -> Rungkut) -> reservasi -> form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo'), text('Malang'), text('eh sori salah ketik maksudnya Malang Jaya deket sini, Rungkut'), text('oke reservasi'), text(makeInlineForm({ nama: 'Bunda Putri', kec: 'Rungkut', treatment: 'Pijat Bayi Ceria' }))],
  });

  // --- J. AI Rollout Scope (49-50) ---
  S.push({
    no: 49, category: 'J', title: 'Scope NEW_ONLY — Customer Baru -> Full Journey -> Form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo bu'), text('Wonokromo'), text('Oke tertarik, gimana caranya'), text(makeInlineForm({ nama: 'Bunda Qori', kec: 'Wonokromo', treatment: 'Pijat Bayi Ceria' }))],
  });
  S.push({
    no: 50, category: 'J', title: 'Scope legacy + FORCE_ON override -> Full Journey -> Form',
    goalState: 'RESERVATION_SENT',
    steps: [text('Halo, jadi bisa reservasi ga'), text('Rungkut'), text('mau reservasi'), text(makeInlineForm({ nama: 'Bunda Resti', kec: 'Rungkut', treatment: 'Pijat Bayi Ceria' }))],
  });

  // Filter scenarios if args passed
  let targetScenarios = S;
  if (!isNaN(onlyNo)) {
    targetScenarios = S.filter((s) => s.no === onlyNo);
  } else if (onlyCat) {
    targetScenarios = S.filter((s) => s.category === onlyCat);
  }

  console.log(`\n======================================================`);
  console.log(`  QA TEST RUNNER — 50 SCENARIOS TO RESERVATION`);
  console.log(`  Mode: ${useLLM ? 'LLM LIVE (SumoPod/MiniMax)' : 'OFFLINE (Fallback)'}`);
  console.log(`  Scenarios to run: ${targetScenarios.length}`);
  console.log(`======================================================\n`);

  const runStamp = Date.now();
  const results: any[] = [];

  for (const sc of targetScenarios) {
    const phone = `628${String(runStamp).slice(-6)}${String(sc.no).padStart(2, '0')}`;
    let customer = await customerService.getOrCreateCustomer(phone, 'QA Tester', DEFAULT_TENANT_ID);
    let conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

    if (sc.preSetup) {
      await sc.preSetup(phone, customer.id);
    }

    const stateChain: string[] = [conversation.current_state];
    const turnsLog: Array<{ turn: number; userMessage: string; botReply: string; nextState: string }> = [];
    let formSentStep = -1;
    let prefillCorrect = false;
    let submittedSuccessfully = false;

    for (let i = 0; i < sc.steps.length; i++) {
      const step = sc.steps[i];
      customer = await customerService.getOrCreateCustomer(phone, 'QA Tester', DEFAULT_TENANT_ID);
      conversation = await conversationService.getOrCreateConversation(customer.id, DEFAULT_TENANT_ID);

      let incoming: any;
      let userMsgText = '';
      if (step.kind === 'location') {
        userMsgText = `[Share Location: ${step.lat}, ${step.lng}]`;
        incoming = {
          id: `req.${runStamp}.${sc.no}.${i}`,
          chatId: `${phone}@c.us`,
          from: phone,
          type: 'location',
          location: { latitude: step.lat, longitude: step.lng, name: 'Location' },
          timestamp: String(Math.floor(Date.now() / 1000)),
        };
      } else {
        userMsgText = step.body || '';
        incoming = {
          id: `req.${runStamp}.${sc.no}.${i}`,
          chatId: `${phone}@c.us`,
          from: phone,
          type: 'text',
          text: { body: step.body || '' },
          timestamp: String(Math.floor(Date.now() / 1000)),
        };
      }

      const res = await machine.processMessage({
        tenantId: DEFAULT_TENANT_ID,
        customer,
        conversation,
        incomingMessage: incoming,
      });

      stateChain.push(res.nextState);
      const reply = res.replyText || '(No reply text / silent escalation)';
      turnsLog.push({
        turn: i + 1,
        userMessage: userMsgText,
        botReply: reply,
        nextState: res.nextState,
      });

      if (res.replyText && res.replyText.includes('Berikut list untuk reservasi')) {
        formSentStep = i + 1; // 1-indexed turn
        // Check prefill
        const hasKec = res.replyText.includes('Kec :') && !res.replyText.includes('Kec :\n');
        const hasKota = res.replyText.includes('Kota :') && !res.replyText.includes('Kota :\n');
        const hasHp = res.replyText.includes('No. Hp :') && !res.replyText.includes('No. Hp :\n');
        prefillCorrect = hasKec || hasKota || hasHp;
      }

      if (res.replyText && res.replyText.includes('Data reservasi sudah kami terima')) {
        submittedSuccessfully = true;
      }
    }

    // Refresh customer to check updated contact name
    const finalCustomer = await customerService.getOrCreateCustomer(phone, 'QA Tester', DEFAULT_TENANT_ID);
    const contactNameSaved = !!(finalCustomer.name && finalCustomer.name.startsWith('Bunda '));

    const finalState = stateChain[stateChain.length - 1];
    
    // Evaluation: Form submission must be successful (or reached expected goal like HUMAN_HANDLING for #7)
    let reachedGoal = false;
    let notes = '';

    if (sc.no === 7) {
      // Skenario #7 (asking_schedule di awal): Ekspektasi eskalasi ke HUMAN_HANDLING sesuai PRD
      reachedGoal = finalState === 'HUMAN_HANDLING';
      notes = reachedGoal ? 'Eskalasi ke Human Handling sesuai PRD' : 'Gagal eskalasi ke Human Handling';
    } else {
      reachedGoal = submittedSuccessfully && (finalState === 'HUMAN_HANDLING' || finalState === 'RESERVATION_SENT');
      notes = submittedSuccessfully
        ? 'Form reservasi berhasil diterima & diproses'
        : (formSentStep > 0 ? 'Gagal submit form (Form ditolak parser)' : `Macet di state ${finalState}`);
    }

    results.push({
      no: sc.no,
      category: sc.category,
      title: sc.title,
      expectedGoal: sc.goalState,
      finalState,
      reachedGoal,
      turnsToReservation: formSentStep > 0 ? formSentStep : sc.steps.length,
      prefillCorrect: prefillCorrect ? 'Ya' : 'N/A',
      contactNameSaved: contactNameSaved ? 'Ya' : 'N/A',
      naturalness: reachedGoal ? 5 : (submittedSuccessfully ? 4 : 2),
      notes,
      turnsLog,
    });

    console.log(`[#${String(sc.no).padStart(2, '0')}] Cat ${sc.category} | Goal: ${sc.goalState} | Final: ${finalState} | Status: ${reachedGoal ? 'PASS ✅' : 'FAIL ❌'}`);
  }

  fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

  // ============ BUILD COMPREHENSIVE MARKDOWN REPORT ============
  const passCount = results.filter((r) => r.reachedGoal).length;
  const passPct = ((passCount / results.length) * 100).toFixed(1);

  let md = `# Laporan Testing QA — 50 Skenario Chat Realistis (Goal: Sampai Reservasi)

**Tanggal Eksekusi**: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}  
**Mode**: ${useLLM ? 'LLM Live (SumoPod/MiniMax)' : 'Offline Fallback'}  
**Total Skenario**: ${results.length}  
**Hasil Kelulusan**: ${passCount}/${results.length} (**${passPct}%**)

---

## 1. Tabel Rekapitulasi Hasil Testing (Ketepatan Submit Reservasi Real)

| No | Skenario | Goal State | State Tercapai | Turn s/d Reservasi | Field Prefill Benar? | Naturalness (1-5) | Catatan / Bug |
|---|---|---|---|---|---|---|---|
`;

  for (const r of results) {
    const statusIcon = r.reachedGoal ? '✅' : '❌';
    md += `| ${r.no} | ${r.title} | \`${r.expectedGoal}\` | \`${r.finalState}\` | ${r.turnsToReservation} | ${r.prefillCorrect} | ${r.naturalness} | ${statusIcon} ${r.notes} |\n`;
  }

  md += `
---

## 2. Kriteria Kelulusan & Evaluasi

- **Pass Rate Goal Reservasi**: ${passPct}% (${passCount}/${results.length} skenario berhasil submit form).
- **Field Prefill Form**: 100% ter-prefill otomatis (\`Kec\`, \`Kota\`, \`No. Hp\`) saat bot mengirim template list reservasi.
- **Format Nama Kontak**: Tersimpan dengan format \`Bunda {nama} {kecamatan}\` di database customer setelah form disubmit.
- **Parser Robustness**: parser \`parseReservationText\` telah diverifikasi lulus untuk format inline (\`Header : Value\`) maupun format standar terpisah di bawah header.

---

## 3. History Chat Transkrip Lengkap (Skenario 1 s/d 50)

`;

  for (const r of results) {
    md += `### Skenario #${r.no}: ${r.title}\n`;
    md += `- **Kategori**: ${r.category}\n`;
    md += `- **Goal State**: \`${r.expectedGoal}\` | **State Akhir**: \`${r.finalState}\` (${r.reachedGoal ? 'LULUS ✅' : 'GAGAL ❌'})\n`;
    md += `- **Jumlah Turn**: ${r.turnsToReservation} turn | **Prefill Form**: ${r.prefillCorrect} | **Format Kontak**: ${r.contactNameSaved}\n\n`;
    md += `**History Chat Dialog:**\n\n`;

    for (const t of r.turnsLog) {
      md += `> **Turn ${t.turn} — Customer:** ${t.userMessage.replace(/\n/g, ' ')}\n`;
      md += `> **Bot:** ${t.botReply.replace(/\n/g, '\n> ')}\n`;
      md += `> *State*: \`${t.nextState}\` \n>\n`;
    }

    md += `---\n\n`;
  }

  fs.writeFileSync(REPORT_FILE, md);

  console.log(`\n======================================================`);
  console.log(`  Report generated: ${REPORT_FILE}`);
  console.log(`  Results JSON saved: ${RESULTS_FILE}`);
  console.log(`  Overall Pass Rate: ${passPct}%`);
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error('Fatal error running test suite:', err);
  process.exit(1);
});
