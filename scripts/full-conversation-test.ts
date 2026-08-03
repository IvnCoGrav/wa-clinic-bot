/**
 * Full Conversation Test — skenario lengkap dari greeting sampai closing.
 * Mengirim chat via POST /webhook ke server yang berjalan (WAHA_MOCK=true),
 * memakai nomor HP unik per skenario. Hasil dibaca dari tabel messages di Postgres
 * (lihat scripts/_show-conversations.tmp.ts) atau log server ([MOCK WAHA OUTBOUND]).
 *
 * Jalankan: npx tsx scripts/full-conversation-test.ts
 */
import axios from 'axios';

const BASE = 'http://localhost:3000';
const WEBHOOK = `${BASE}/webhook`;
const now = Math.floor(Date.now() / 1000);

interface Msg {
  body?: string;
  location?: { latitude: number; longitude: number };
  delayMs?: number;
}

interface Scenario {
  label: string;
  phone: string;
  messages: Msg[];
  expect?: Partial<Record<string, string | string[]>>;
}

function buildPayload(phone: string, idx: number, msg: Msg, unique: number): any {
  const jid = `${phone}@c.us`;
  const base: any = {
    event: 'message',
    payload: {
      id: `fc.${unique}.${idx}`,
      from: jid,
      chatId: jid,
      fromMe: false,
      timestamp: String(now + idx),
      _data: { notifyName: 'Customer FC' },
    },
  };
  if (msg.location) {
    base.payload.location = msg.location;
  } else {
    base.payload.body = msg.body;
  }
  return base;
}

const scenarios: Scenario[] = [
  {
    label: 'FC1 HAPPY PATH: greeting → lokasi pin → pilih treatment → form lengkap → closing (HUMAN_HANDLING)',
    phone: '6281000000101',
    messages: [
      { body: 'halo bunda, mau reservasi', delayMs: 0 },
      { location: { latitude: -7.2574, longitude: 112.7520 }, delayMs: 1500 }, // Surabaya (in coverage)
      { body: 'mau pijat bayi ceria', delayMs: 2000 },
      {
        body: [
          'Berikut list untuk reservasi :',
          '',
          'Hari dan tanggal : Selasa, 12 Agustus 2026',
          'Nama Bunda: Siti Rahma',
          'Alamat & Shareloc : Jl. Raya Gubeng No. 5',
          'Kec : Gubeng',
          'Kota : Surabaya',
          'No. Hp : 6281000000101',
          '',
          'Pilihan treatment (Baby & Kids)',
          '',
          'Nama Bayi : Aliya',
          'Usia Bayi/Anak : 6 bulan',
          'Treatment : Pijat Bayi Ceria',
        ].join('\n'),
        delayMs: 0,
      },
    ],
    expect: { endState: 'HUMAN_HANDLING' },
  },

  {
    label: 'FC2 CUSTOMER LAMA: greeting → retensi lokasi → pilih treatment → form → closing',
    phone: '6281000000102',
    messages: [
      { body: 'halo bunda', delayMs: 0 },
      { location: { latitude: -7.2574, longitude: 112.7520 }, delayMs: 1500 },
      { body: 'mau pijat ibu hamil', delayMs: 2000 },
      {
        body: [
          'Berikut list untuk reservasi :',
          '',
          'Hari dan tanggal : Rabu, 13 Agustus 2026',
          'Nama Bunda: Dewi Anggraini',
          'Alamat & Shareloc : Jl. Menur No. 12',
          'Kec : Gubeng',
          'Kota : Surabaya',
          'No. Hp : 6281000000102',
          '',
          'Pilihan treatment (Moms) :',
          '',
          'Usia Kehamilan (Jika hamil): 20 minggu',
          'Treatment : Prenatal Massage',
        ].join('\n'),
        delayMs: 0,
      },
    ],
    expect: { endState: 'HUMAN_HANDLING' },
  },

  {
    label: 'FC3 TEKS LOKASI LANGSUNG: greeting → tulis kelurahan → ongkir → treatment → form',
    phone: '6281000000103',
    messages: [
      { body: 'halo bunda mau booking pijat bayi', delayMs: 0 },
      { body: 'rumah saya di Gubeng Surabaya', delayMs: 2000 },
      { body: 'pijat bayi ceria dong', delayMs: 2000 },
    ],
    expect: { endState: 'AWAITING_INTEREST' },
  },

  {
    label: 'FC4 OUT OF COVERAGE: lokasi jauh → COMPLETED (closing)',
    phone: '6281000000104',
    messages: [
      { body: 'halo', delayMs: 0 },
      { location: { latitude: -6.9175, longitude: 107.6191 }, delayMs: 1500 }, // Bandung (jauh)
    ],
    expect: { endState: 'COMPLETED' },
  },

  {
    label: 'FC5 NOT INTERESTED: greeting → lokasi → pilih → tidak jadi → COMPLETED',
    phone: '6281000000105',
    messages: [
      { body: 'halo bunda', delayMs: 0 },
      { location: { latitude: -7.2574, longitude: 112.7520 }, delayMs: 1500 },
      { body: 'pijat bayi ya', delayMs: 2000 },
      { body: 'ga jadi deh makasih', delayMs: 2000 },
    ],
    expect: { endState: 'COMPLETED' },
  },

  {
    label: 'FC6 FAQ DI TENGAH ALUR LOKASI: tanya FAQ → dijawab + tetap minta lokasi',
    phone: '6281000000106',
    messages: [
      { body: 'halo bunda', delayMs: 0 },
      { body: 'pijat bayi itu manfaatnya apa ya?', delayMs: 2000 },
      { location: { latitude: -7.2574, longitude: 112.7520 }, delayMs: 3000 },
    ],
    expect: { endState: 'AWAITING_INTEREST' },
  },

  {
    label: 'FC7 TANYA JADWAL SPESIFIK → eskalasi human (HUMAN_HANDLING)',
    phone: '6281000000107',
    messages: [
      { body: 'halo bunda', delayMs: 0 },
      { body: 'kalau hari sabtu jam 10 ada jadwal kosong ga?', delayMs: 2000 },
    ],
    expect: { endState: 'HUMAN_HANDLING' },
  },

  {
    label: 'FC8 FORM TIDAK LENGKAP → diminta lengkapi → lengkapi → closing',
    phone: '6281000000118',
    messages: [
      { body: 'halo bunda', delayMs: 0 },
      { location: { latitude: -7.2574, longitude: 112.7520 }, delayMs: 1500 },
      { body: 'mau pijat bayi', delayMs: 2000 },
      {
        body: [
          'Berikut list untuk reservasi :',
          '',
          'Hari dan tanggal : Kamis, 14 Agustus 2026',
          'Nama Bunda: Aisyah',
          'Alamat & Shareloc : Jl. Ahmad Yani No. 3',
          'Kec : Wonokromo',
          'Kota : Surabaya',
          'No. Hp : 6281000000118',
        ].join('\n'),
        delayMs: 6500, // jeda > window burst (5s) agar form tidak ter-merge
      },
      {
        body: [
          'Berikut list untuk reservasi :',
          '',
          'Hari dan tanggal : Kamis, 14 Agustus 2026',
          'Nama Bunda: Aisyah',
          'Alamat & Shareloc : Jl. Ahmad Yani No. 3',
          'Kec : Wonokromo',
          'Kota : Surabaya',
          'No. Hp : 6281000000118',
          '',
          'Pilihan treatment (Baby & Kids)',
          '',
          'Nama Bayi : Keisha',
          'Usia Bayi/Anak : 3 bulan',
          'Treatment : Pijat Bayi Ceria',
        ].join('\n'),
        delayMs: 0,
      },
    ],
    expect: { endState: 'HUMAN_HANDLING' },
  },

  {
    label: 'FC9 MEDIS: keluhan medis → eskalasi senyap (tanpa balas)',
    phone: '6281000000109',
    messages: [
      { body: 'halo bunda', delayMs: 0 },
      { body: 'bayi saya demam tinggi 39 derajat sudah 2 hari, bagaimana ya?', delayMs: 2000 },
    ],
    expect: { endState: 'HUMAN_HANDLING', silent: true },
  },

  {
    label: 'FC10 GANTI LOKASI setelah punya lokasi → diarahkan ke location handler',
    phone: '6281000000110',
    messages: [
      { body: 'halo bunda', delayMs: 0 },
      { location: { latitude: -7.2574, longitude: 112.7520 }, delayMs: 1500 },
      { body: 'pijat bayi dong', delayMs: 2000 },
      { body: 'saya pindah ke Gresik nih', delayMs: 2000 },
    ],
    expect: { endState: 'AWAITING_LOCATION' },
  },

  {
    label: 'FC11 BURST FULL: greeting+FAQ+interest dalam window → 1 balasan terarah',
    phone: '6281000000111',
    messages: [
      { body: 'halo bunda', delayMs: 0 },
      { body: 'pijat bayi berapa ya?', delayMs: 400 },
      { body: 'mau booking juga', delayMs: 400 },
    ],
    expect: { endState: 'AWAITING_LOCATION' },
  },

  {
    label: 'FC12 FUZZY LOKASI: teks lokasi ambigu → konfirmasi → ya → lanjut treatment → form → closing',
    phone: '6281000000112',
    messages: [
      { body: 'halo bunda', delayMs: 0 },
      { body: 'saya di Gubeng', delayMs: 2000 },
      { body: 'ya betul bunda', delayMs: 2500 },
      { body: 'pijat bayi ceria', delayMs: 2000 },
    ],
    expect: { endState: 'AWAITING_INTEREST' },
  },
];

async function run() {
  const onlyPhone = process.argv[2] || '';
  const list = onlyPhone ? scenarios.filter((s) => s.phone === onlyPhone) : scenarios;
  console.log(`=== FULL CONVERSATION TEST — ${list.length} SKENARIO${onlyPhone ? ` (filter: ${onlyPhone})` : ''} ===\n`);
  let unique = Date.now();
  for (const sc of list) {
    console.log(`>>> [${sc.label}] (${sc.phone})`);
    for (let i = 0; i < sc.messages.length; i++) {
      const msg = sc.messages[i];
      try {
        const resp = await axios.post(WEBHOOK, buildPayload(sc.phone, i, msg, unique), {
          timeout: 20000,
          headers: { 'Content-Type': 'application/json' },
        });
        const bodyText = msg.body ? (msg.body.includes('\n') ? '[FORM RESERVASI]' : `"${msg.body}"`) : '[LOCATION]';
        console.log(`    kirim ${bodyText} -> ${resp.data?.status}`);
      } catch (err: any) {
        console.log(`    kirim ${msg.body ? (msg.body.includes('\n') ? '[FORM]' : `"${msg.body}"`) : '[LOCATION]'} -> ERROR: ${err.response?.data?.error || err.message}`);
      }
      if (msg.delayMs) await new Promise((r) => setTimeout(r, msg.delayMs));
    }
    await new Promise((r) => setTimeout(r, 6000));
    unique++;
  }
  console.log('\n=== SELESAI MENGIRIM ===');
}

run().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
