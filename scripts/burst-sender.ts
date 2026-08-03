/**
 * Pengirim 20 skenario chat "customer real" ke bot via POST /webhook.
 * Setiap skenario = nomor HP unik + urutan pesan (termasuk burst chat multi-pesan cepat).
 * Jalankan dengan: npx tsx scripts/burst-sender.ts
 */
import axios from 'axios';

const BASE = 'http://localhost:3000';
const WEBHOOK = `${BASE}/webhook`;

const now = Math.floor(Date.now() / 1000);

interface Scenario {
  label: string;
  phone: string;
  messages: Array<{ body?: string; location?: { latitude: number; longitude: number }; delayMs?: number; type?: string }>;
}

function buildPayload(phone: string, idx: number, msg: any, unique: number): any {
  const jid = `${phone}@c.us`;
  const base: any = {
    event: 'message',
    payload: {
      id: `wamid.${unique}.${idx}`,
      from: jid,
      chatId: jid,
      fromMe: false,
      timestamp: String(now + idx),
      _data: { notifyName: 'Customer Test' },
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
    label: 'S1 Greeting + langsung tanya treatment (burst 3 pesan)',
    phone: '6281000000001',
    messages: [
      { body: 'halo bunda', delayMs: 0 },
      { body: 'mau nanya dong', delayMs: 500 },
      { body: 'pijat bayi itu buat apa ya?', delayMs: 500 },
    ],
  },
  {
    label: 'S2 Sapaan tunggal (tanpa follow-up)',
    phone: '6281000000002',
    messages: [{ body: 'halo', delayMs: 0 }],
  },
  {
    label: 'S3 Tanya harga burst 2 pesan',
    phone: '6281000000003',
    messages: [
      { body: 'pijat bayi berapa ya bunda?', delayMs: 0 },
      { body: 'sama pijat ibu hamil gimana harganya?', delayMs: 700 },
    ],
  },
  {
    label: 'S4 Burst 4 pesan treatment manfaat',
    phone: '6281000000004',
    messages: [
      { body: 'halo bunda', delayMs: 0 },
      { body: 'ada yg bisa bantu', delayMs: 400 },
      { body: 'anak saya pilek nih', delayMs: 400 },
      { body: 'ada treatment yg bagus ga?', delayMs: 400 },
    ],
  },
  {
    label: 'S5 Full funnel: greeting -> lokasi -> interest -> reservasi',
    phone: '6281000000005',
    messages: [
      { body: 'halo bunda mau reservasi', delayMs: 0 },
      { location: { latitude: -7.2574, longitude: 112.7520 }, delayMs: 1500 },
      { body: 'mau pijat bayi', delayMs: 1500 },
    ],
  },
  {
    label: 'S6 Tanya jadwal / slot',
    phone: '6281000000006',
    messages: [{ body: 'buat jadwal pijat kapan aja bisa?', delayMs: 0 }],
  },
  {
    label: 'S7 Burst: greeting + 2 follow-up singkat',
    phone: '6281000000007',
    messages: [
      { body: 'halo', delayMs: 0 },
      { body: 'bunda', delayMs: 300 },
      { body: 'mau tanya', delayMs: 300 },
    ],
  },
  {
    label: 'S8 Tanya lokasi / alamat klinik',
    phone: '6281000000008',
    messages: [{ body: 'kliniknya dimana bunda?', delayMs: 0 }],
  },
  {
    label: 'S9 Burst: 2 pesan minat booking',
    phone: '6281000000009',
    messages: [
      { body: 'mau booking', delayMs: 0 },
      { body: 'pijat bayi 2 anak', delayMs: 600 },
    ],
  },
  {
    label: 'S10 Off-topic chat',
    phone: '6281000000010',
    messages: [{ body: 'halo, apakah besok hujan?', delayMs: 0 }],
  },
  {
    label: 'S11 Tanya rekomendasi treatment dewasa (MOMS)',
    phone: '6281000000011',
    messages: [{ body: 'ada pijat buat ibu hamil ga?', delayMs: 0 }],
  },
  {
    label: 'S12 Burst: greet + tanya katalog lengkap',
    phone: '6281000000012',
    messages: [
      { body: 'hai bunda', delayMs: 0 },
      { body: 'treatment apa aja yg ada?', delayMs: 600 },
    ],
  },
  {
    label: 'S13 Sudah pernah chat, kembali tanya (warm reopen)',
    phone: '6281000000013',
    messages: [{ body: 'halo bunda', delayMs: 0 }],
  },
  {
    label: 'S14 Burst: harga + cara booking',
    phone: '6281000000014',
    messages: [
      { body: 'berapa harga pijat bayi?', delayMs: 0 },
      { body: 'trus cara bookingnya gimana?', delayMs: 500 },
    ],
  },
  {
    label: 'S15 Share lokasi langsung dari awal',
    phone: '6281000000015',
    messages: [{ location: { latitude: -7.2574, longitude: 112.7520 }, delayMs: 0 }],
  },
  {
    label: 'S16 Burst: greeting + topik medis bayi rewel',
    phone: '6281000000016',
    messages: [
      { body: 'halo', delayMs: 0 },
      { body: 'bayi saya rewel terus', delayMs: 500 },
      { body: 'ada yg bisa dibantu?', delayMs: 500 },
    ],
  },
  {
    label: 'S17 Tanya pijat laktasi',
    phone: '6281000000017',
    messages: [{ body: 'pijat laktasi itu buat apa bunda?', delayMs: 0 }],
  },
  {
    label: 'S18 Burst 5 pesan cepat (stress test)',
    phone: '6281000000018',
    messages: [
      { body: 'a', delayMs: 0 },
      { body: 'halo', delayMs: 200 },
      { body: 'mau nanya', delayMs: 200 },
      { body: 'tentang pijat bayi', delayMs: 200 },
      { body: 'berapa ya?', delayMs: 200 },
    ],
  },
  {
    label: 'S19 Tanya layanan non-treatment (nebulizer bayi)',
    phone: '6281000000019',
    messages: [{ body: 'nebulizer buat bayi boleh gak ya?', delayMs: 0 }],
  },
  {
    label: 'S20 Burst: greeting + tanya paket promosi',
    phone: '6281000000020',
    messages: [
      { body: 'hai bunda', delayMs: 0 },
      { body: 'ada promo ga sekarang?', delayMs: 600 },
    ],
  },
];

async function run() {
  console.log(`=== MENGIRIM ${scenarios.length} SKENARIO CHAT ===\n`);
  let unique = Date.now();
  for (const sc of scenarios) {
    console.log(`>>> [${sc.label}] (${sc.phone})`);
    for (let i = 0; i < sc.messages.length; i++) {
      const msg = sc.messages[i];
      try {
        const resp = await axios.post(WEBHOOK, buildPayload(sc.phone, i, msg, unique), {
          timeout: 15000,
          headers: { 'Content-Type': 'application/json' },
        });
        const bodyText = msg.body ? `"${msg.body}"` : '[LOCATION]';
        console.log(`    kirim ${bodyText} -> ${resp.data?.status}`);
      } catch (err: any) {
        console.log(`    kirim ${msg.body ? `"${msg.body}"` : '[LOCATION]'} -> ERROR: ${err.response?.data?.error || err.message}`);
      }
      if (msg.delayMs) await new Promise((r) => setTimeout(r, msg.delayMs));
    }
    // Jeda antar skenario supaya balasan masuk dulu (idempotency & batch terpisah)
    await new Promise((r) => setTimeout(r, 8000));
    unique++;
  }
  console.log('\n=== SELESAI MENGIRIM ===');
}

run().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
