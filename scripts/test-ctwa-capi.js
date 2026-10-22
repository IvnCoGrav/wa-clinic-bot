/**
 * Uji payload CAPI CTWA (Click-to-WhatsApp) via test_event_code Meta.
 *
 * Fungsi: mengirim SATU test event Purchase dengan:
 *  - action_source: 'chat' (Line of Business messaging)
 *  - ctwa_clid mentah di userData (perilaku produksi capi.service.ts)
 *  - order_id di custom_data (verifikasi apakah Meta menolak/menerima)
 *  - event_id deterministik (pur_{tenantId}_{reservationId}, kontrak B2)
 *
 * Pemakaian:
 *   node scripts/test-ctwa-capi.js --test-event-code=TEST12345 [--pixel=123] [--token=EAAG...]
 *
 * Kredensial (urutan prioritas): flag CLI > FB_PIXEL_ID / FB_CAPI_ACCESS_TOKEN env.
 *.test_event_code didapat dari Events Manager > tab "Test Events".
 * Setelah kirim, cek di Events Manager (tab Test Events) apakah event masuk
 * dan apakah ada warning ctwa_clid / order_id / action_source.
 */

'use strict';

const args = Object.fromEntries(
  process.argv.slice(2)
    .map((a) => a.replace(/^--/, ''))
    .map((a) => {
      const i = a.indexOf('=');
      return i === -1 ? [a, true] : [a.slice(0, i), a.slice(i + 1)];
    })
);

const GRAPH_BASE = process.env.GRAPH_API_BASE_URL || 'https://graph.facebook.com';
const GRAPH_VER = process.env.GRAPH_API_VERSION || 'v21.0';

const pixelId = args.pixel || process.env.FB_PIXEL_ID;
const accessToken = args.token || process.env.FB_CAPI_ACCESS_TOKEN;
const testEventCode = args['test-event-code'];
const ldu = args.ldu === undefined ? true : Boolean(args.ldu);

if (!pixelId || !accessToken || !testEventCode) {
  console.error('Pemakaian: node scripts/test-ctwa-capi.js --test-event-code=CODE [--pixel=ID] [--token=TOKEN] [--no-ldu]');
  console.error('Semua dari pixel, token, test_event_code wajib ada (CLI atau env FB_PIXEL_ID/FB_CAPI_ACCESS_TOKEN).');
  process.exit(1);
}

if (ldu) {
  console.error('[PERINGATAN] Mode LDU (Limited Data Use) aktif default. Gunakan --no-ldu bila tidak diinginkan.');
}

const sha256 = (s) => require('crypto').createHash('sha256').update(s).digest('hex');
const normalizePhone = (raw) => {
  const digits = String(raw).replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('62')) return digits;
  return `62${digits}`;
};

// Nilai contoh sesuai payload produksi; tidak mengandung data pasien riil.
const tenantId = args.tenant || 'default-tenant';
const reservationId = args.reservation || `test_reservation_${Date.now()}`;
// Nomor default SENGAJA tidak valid (prefiks `62` diikuti `0` — tidak ada nomor
// nasional Indonesia yang demikian) supaya TIDAK mungkin menabrak data
// pencocokan pengguna riil. Jangan pakai nomor placeholder umum (mis. 6281234567890).
const testPhone = args.phone || '6200000000000';
const ctwaClid = args.ctwa || `ctwa_test_${Date.now()}`;

const eventId = args.eventid || `pur_${tenantId}_${reservationId}`;

const payload = {
  data: [
    {
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'chat',
      user_data: {
        ph: [sha256(normalizePhone(testPhone))],
        ctwa_clid: ctwaClid,
        client_user_agent: 'test-ctwa-capi-script/1.0',
        ...(ldu ? { limited_data_use: true } : {}),
      },
      custom_data: {
        currency: 'IDR',
        value: Number(args.value || 1000),
        order_id: args.orderid || reservationId,
      },
      original_event_data: {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
      },
    },
  ],
  test_event_code: testEventCode,
};

const url = `${GRAPH_BASE}/${GRAPH_VER}/${pixelId}/events?access_token=${accessToken}`;

(async () => {
  console.log('=== Payload yang dikirim ===');
  console.log(JSON.stringify(payload, null, 2));
  console.log(`\n=== POST ${url.replace(accessToken, '<TOKEN TERSEMBUNYI>')} ===`);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    console.log(`HTTP ${res.status}`);
    console.log(JSON.stringify(body, null, 2));
    const mismatch = (body.messages || []).some((m) => /does not match an active Test Events session/i.test(m || ''));
    if (mismatch) {
      // Event sudah masuk dataset RIIL (tidak bisa ditarik). Suburkarkan kegagalan:
      // exit non-zero supaya retry otomatis/berulang TIDAK melanjutkan pengiriman.
      console.error('\n⚠️ test_event_code TIDAK aktif — event ini DIPROSES NORMAL (masuk dataset riil, tidak bisa ditarik).');
      console.error('   JANGAN jalankan ulang dengan kode yang sama. Buka tab Test Events yang MASIH TERBUKA di Events Manager,');
      console.error('   salin kode segar (kode berlaku hanya selama seluruh tab terbuka), lalu jalankan ulang dengan kode baru.');
      process.exit(3);
    }
    if (res.status === 200 && body.events_received === 1) {
      console.log('\n✔ Meta menerima event sebagai TEST EVENT. Cek tab Test Events (harus terlihat di sana, bukan di data live) untuk validasi ctwa_clid, action_source "chat", order_id, dan event_id deterministik.');
    } else {
      console.log('\n✘ Meta menolak atau menerima sebagian. Periksa error di atas dan bandingkan dengan payload produksi di src/services/capi.service.ts.');
    }
  } catch (err) {
    console.error('Gagal memanggil Graph API:', err.message);
    process.exit(2);
  }
})();
