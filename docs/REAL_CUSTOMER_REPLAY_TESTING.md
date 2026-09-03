# Panduan Pengujian Replay Chat Customer Riil (Historical Replay Testing)

Harness pengujian ini memutar ulang (*replay*) riwayat percakapan dari **customer nyata di database PostgreSQL** secara *in-memory* ke dalam alur *Unified Slot Engine*.

Tujuan utamanya adalah **Eksplorasi Diagnostik Terbuka (Open-Ended Discovery)**: menemukan cacat percakapan, repetisi kalimat, eskalasi ganjil, amnesia data, dan kesalahan NLU yang hanya muncul pada bahasa asli pelanggan di WhatsApp.

---

## 🚀 Cara Menjalankan

Jalankan perintah berikut di terminal:

```bash
npm run test:real-replay
# atau langsung:
npx tsx scripts/replay-real-customer-cases.ts
```

Skrip akan otomatis:
1. Menarik 30 percakapan customer asli yang memiliki $\ge 5$ pesan masuk (*inbound*).
2. Memproses percakapan giliran demi giliran secara terisolasi di memori.
3. Mendeteksi anomali pada setiap giliran secara *real-time*.
4. Mengompilasi laporan hasil dan inventaris masalah ke file [`docs/REAL_CUSTOMER_REPLAY_REPORT.md`](file:///c:/Users/User/Documents/chatbot%20AG/docs/REAL_CUSTOMER_REPLAY_REPORT.md).

---

## 🛡️ Keamanan & Kepatuhan Data (Safety Guard)

- **0 Pesan WhatsApp Terkirim:** Gateway menggunakan simulasi internal/mock sehingga tidak ada pesan keluar ke nomor pelanggan asli.
- **Meta Pixel/CAPI Safe:** `process.env.META_CAPI_ENABLED = 'false'` dan kontak di-flag `is_sandbox_test: true`, mencegah event Meta CAPI terpicu ke Ads Manager.
- **Database Bersih:** Menggunakan nomor pengujian berprefix `62899...` sehingga tidak mengubah baris riwayat customer asli di tabel produksi.

---

## 🔍 Detektor Anomali Terbuka yang Dijalankan

| Detektor | Indikasi Masalah |
|---|---|
| `REPEATED_ONGKIR_PARAGRAPH` | Bot mengulang paragraf kalkulasi ongkir panjang padahal lokasi sudah terkonfirmasi. |
| `BOT_REPETITION_LOOP` | Bot mengulang 100% balasan giliran sebelumnya (looping pada pesan pasif/singkat). |
| `FALSE_UNLISTED_SERVICE_ESCALATION` | Bot mendadak diam mengira layanan luar klinik, padahal layanan ada di katalog resmi. |
| `UNEXPECTED_SILENT_HANDOFF` | Bot mendadak diam dan mengoper ke CS tanpa alasan medis/komplain jelas. |
| `LOCATION_AMNESIA` | Bot menanyakan kembali alamat rumah padahal sudah dicatat di giliran sebelumnya. |
| `AGE_AMNESIA` | Bot menanyakan kembali usia anak padahal sudah dijawab oleh pelanggan. |
| `PREMATURE_TREATMENT_ASSUMPTION` | Bot menebak layanan tertentu (mis. Pijat Bayi Ceria) di awal sapaan umum. |
| `PIPELINE_CRASH_ERROR` | Runtime error atau unhandled exception pada pipeline. |
