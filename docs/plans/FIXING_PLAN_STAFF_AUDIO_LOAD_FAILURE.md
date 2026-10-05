# Fixing Plan — Audio WhatsApp Gagal Dimuat di Portal Staf (Kasus Bunda Kamila)

- **Tanggal:** 2026-10-05
- **Status:** EXECUTED (2026-10-05) — Fase 1-2 + 4 + 5 diterapkan; Fase 3 (env WAHA) menunggu restart WAHA. Lihat CHANGELOG & KNOWN_ISSUES #230.
- **Kasus pemicu:** Nomor WhatsApp 6282244121370 (Bunda Kamila) — Portal Staf (`/admin/staff/today`) diakses via iPhone Safari
- **Prinsip:** Solusi fondasional (arsip permanen di backend, ekspansi MIME audio, perpanjangan TTL WAHA, resilience audio player Safari/iOS), tanpa tambalan prompt, tanpa regex hafalan, tanpa dependency runtime baru.

---

## 1. Gejala & Bukti Lapangan (Terbukti dari Database & Log Live)

### Kronologi Kasus
- **Pasien:** Bunda Kamila (ID: `500f9ed7-8061-40b5-b24c-440a3c28dd32`, phone: `6282244121370`).
- **Jadwal & Penugasan:** Treatment tanggal 2026-10-05 pukul 07:30 WIB, status reservasi `en_route`, ditugaskan ke **Bidan Thabita** (`2eef2d61-747d-4756-a93f-512ee1d16f81`, role `THERAPIST`).
- **Pesan Suara (Voice Note):** Bunda Kamila mengirimkan 3 pesan suara berturut-turut:
  1. 15:23 WIB (08:23:51 UTC) — Pesan ID `d9624140...`
  2. 15:31 WIB (08:31:07 UTC) — Pesan ID `8933bf47...`
  3. 15:35 WIB (08:35:35 UTC) — Pesan ID `1b1ba2e4...` (File WAHA: `ACBEE867D0965FB7670B5BB79A4428B1.oga`)

### Gejala yang Terlihat
Saat staf (Bidan Thabita) membuka percakapan di aplikasi/portal staf (`StaffToday.tsx` / `https://app.kalababyspa.online/admin/staff/today`), pemutar audio tidak bisa memainkan suara, melainkan menampilkan tombol oranye bertanda seru dengan teks:
> **"Audio gagal dimuat. Coba minta ulang."**

---

## 2. Audit Akar Masalah Lintas Lapisan (Multi-Layer Root Cause Audit)

Audit teknis membuktikan terdapat 4 titik masalah sistemik yang saling berkaitan:

### Akar Masalah 1: Bug Deteksi Webhook — Audio Tidak Pernah Diarsipkan ke Harddisk Server
- Di `src/routes/webhook.route.ts:962-970`:
  ```typescript
  const heavyMediaType =
    (payload.message?.videoMessage && 'video') ||
    (payload.message?.audioMessage && 'audio') ||
    (payload.message?.documentMessage && 'document') ||
    (payload.type === 'video' && 'video') ||
    (payload.type === 'audio' && 'audio') ||
    (payload.type === 'document' && 'document') ||
    null;
  ```
- Pada payload webhook WAHA NOWEB (Baileys), properti `payload.message` **tidak ada di top-level** (struktur pesan Baileys ada di `payload._data.message` atau telah dinormalisasi di `canonical.type === 'audio' | 'voice_note'`).
- `payload.type` juga tidak bernilai `'audio'`.
- Akibatnya: Variabel `heavyMediaType` **selalu bernilai `null`**.
- Blok background downloader (`wahaClient.downloadMedia` / `mediaService.saveInboundMedia`) sama sekali tidak pernah terpanggil untuk pesan audio.
- **Bukti Konkret Server:** Di direktori `/opt/wa-clinic-bot/storage/media/inbound/default-tenant/` tercatat 528 file gambar JPG, 36 PNG, 32 WebP, namun **0 file audio** (tidak ada satupun audio yang pernah disimpan ke disk lokal). URL audio di database tetap berupa URL sementara WAHA: `http://localhost:3000/api/files/default/ACBEE867D0965FB7670B5BB79A4428B1.oga`.

### Akar Masalah 2: Masa Simpan File WAHA Terlalu Singkat (180 Detik / 3 Menit)
- Di file `docker-compose.yml`, variabel `WHATSAPP_FILES_LIFETIME` tidak didefinisikan.
- Secara default, implementasi internal WAHA (`MediaLocalStorageConfig.js`) menyetel masa hidup file sementara di `/tmp/whatsapp-files/` hanya **180 detik (3 menit)**.
- Karena file tidak diarsipkan oleh backend (Akar Masalah 1), begitu 3 menit berlalu, WAHA otomatis menghapus file audio tersebut dari disk kontainernya.
- Saat Fastify mencoba melakukan proxy file melalui `GET /api/files/:session/:file`, WAHA mengembalikan **HTTP 404 Not Found: `{"error": "File tidak ditemukan di server WAHA"}`**.
- Semua pemutar audio di browser mana pun (baik PC maupun HP) yang mencoba memuat URL tersebut setelah 3 menit dipastikan menerima 404 dan memicu error.

### Akar Masalah 3: Format File `.oga` (Ogg Opus) Tidak Didukung Apple Safari di iPhone
- Log web server Caddy membuktikan staf mengakses portal menggunakan **iPhone**:
  `User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 ... Mobile/15E148 Safari/604.1`
- Format rekaman suara WhatsApp adalah Ogg Opus berekstensi `.oga` (`audio/ogg; codecs=opus`).
- Browser Apple Safari/WebKit di iOS **tidak mendukung container OGG / OGA** secara native pada elemen HTML5 `<audio src="...">`.
- Ketika tag `<audio src="/api/files/default/...oga">` dimuat di Safari iPhone, peramban langsung memicu event `error` (`MEDIA_ERR_SRC_NOT_SUPPORTED`).
- Sebaliknya, browser Chrome di laptop/PC admin memiliki decoding OGG native, sehingga jika dibuka dalam rentang 3 menit pertama, audio di PC bisa berputar sedangkan di iPhone Safari langsung gagal seketika.

### Akar Masalah 4: Kamus MIME di `media.route.ts` Belum Mendaftarkan Audio
- Di `src/routes/media.route.ts:6-12`:
  ```typescript
  const MIME_MAP: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };
  ```
- Ekstensi audio (`oga`, `ogg`, `opus`, `mp3`, `m4a`) tidak terdaftar. Jika endpoint statis `/media/...` menyajikan file audio, Content-Type jatuh ke `application/octet-stream` yang ditolak oleh pemutar audio mobile browser.

---

## 3. Rencana Bertahap (Staged Phases & Micro-Tasks)

### Fase 1 — Perbaikan Webhook Ingest & Pengarsipan Permanen (Backend)
- **1.1** Perbaiki pendeteksian tipe media di `src/routes/webhook.route.ts`:
  Gunakan normalisasi kanonis seragam:
  ```typescript
  const isAudioOrVoice = canonical.type === 'audio' || canonical.type === 'voice_note';
  const isVideo = canonical.type === 'video';
  const isDocument = canonical.type === 'document';
  const heavyMediaType = isAudioOrVoice ? 'audio' : isVideo ? 'video' : isDocument ? 'document' : null;
  ```
- **1.2** Unduh buffer media dari WAHA secara andal:
  Coba `wahaClient.downloadMedia(waMessageId, chatId)` dengan fallback ke `wahaClient.fetchUrl(mediaUrlCandidate)` jika URL direct tersedia.
- **1.3** Simpan ke disk lokal permanen via `mediaService.saveInboundMedia({ tenantId, buffer, mimeType })`.
- **1.4** Perbarui record pesan di DB via `messageService.attachMediaToMessage` sehingga URL di database berubah dari `http://localhost:3000/api/files/...` menjadi `/media/inbound/:tenantId/:fileName`.
- **1.5** Publikasikan event SSE `message.updated` via `LiveChatHub` agar bubble percakapan yang sedang terbuka di layar terapis/admin otomatis menyegarkan URL player audio tanpa perlu refresh manual.
- **Acceptance Criteria:** Unit test webhook mencakup simulasi payload audio WAHA NOWEB dan memverifikasi fungsi `saveInboundMedia` dipanggil serta URL tersimpan di DB berawalan `/media/inbound/`.

### Fase 2 — Pendaftaran MIME Type Audio & Streaming Header (Backend)
- **2.1** Perluas `MIME_MAP` di `src/routes/media.route.ts` dengan format audio:
  ```typescript
  const MIME_MAP: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    oga: 'audio/ogg',
    ogg: 'audio/ogg',
    opus: 'audio/opus',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    pdf: 'application/pdf',
  };
  ```
- **2.2** Pastikan header response menyertakan `Accept-Ranges: bytes` dan `Content-Type` yang tepat agar streaming audio dapat di-seek dengan baik.
- **Acceptance Criteria:** Test request ke rute `/media/inbound/:tenant/:file.oga` mengembalikan `Content-Type: audio/ogg` (bukan `application/octet-stream`).

### Fase 3 — Konfigurasi WAHA Files Lifetime di Compose (Infrastruktur)
- **3.1** Di `docker-compose.yml`, tambahkan variabel lingkungan pada service `waha`:
  ```yaml
  WHATSAPP_FILES_LIFETIME: 86400
  ```
  Ini memperpanjang cache sementara WAHA dari 180 detik (3 menit) menjadi 24 jam (86.400 detik) sebagai lapisan pengaman kedua (*defense-in-depth*).
- **Acceptance Criteria:** `docker compose config` valid tanpa sintaks error.

### Fase 4 — Ketahanan Pemutar Audio di iOS Safari & Tampilan Staf (Frontend)
- **4.1** Kompatibilitas `VoiceNotePlayer` di `StaffToday.tsx` & `LiveChatMonitor.tsx`:
  - Tangani kegagalan decoding Ogg di Safari dengan menyediakan fallback audio player atau decoding buffer via Web Audio API.
  - Sediakan tombol alternatif "Buka Audio" / "Unduh" yang elegan jika browser pengguna sama sekali tidak memiliki codec yang cocok, sehingga staf tetap dapat mendengarkan instruksi pasien.
  - Pastikan sanitasi `sanitizePayloadRawForStaff` di `src/utils/pii-masker.ts` mempertahankan metadata audio `isPtt`, `mimeType`, dan `url` secara lengkap.
- **Acceptance Criteria:** Build dashboard (`npm run build` di `packages/admin-dashboard`) sukses tanpa type error.

### Fase 5 — Regression Gate & Automated Testing
- **5.1** Jalankan unit test terkait media dan webhook:
  `npx vitest run tests/unit/media-service.test.ts tests/unit/webhook-heavy-media.test.ts`
- **5.2** Jalankan full regression test suite:
  `npm test`
- **5.3** Jalankan typecheck penuh:
  `npm run build`
- **Acceptance Criteria:** Seluruh pengujian lulus hijau (0 test merah baru).

---

## 4. Evaluasi Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Unduhan media berat membebani webhook loop | Latensi webhook meningkat | Tetap jalankan proses unduhan audio secara asynchronous (fire-and-forget dengan error isolation) sehingga webhook merespons 200 OK ke WAHA dalam <100ms. |
| Kuota disk server cepat penuh | Harddisk server terancam | `mediaService.enforceQuota` sudah aktif dengan rotasi otomatis dan retensi 30 hari. |
| Restart WAHA mengganggu koneksi WhatsApp | Sesi WA putus | Perubahan `WHATSAPP_FILES_LIFETIME` hanya diaplikasikan saat jendela pemeliharaan resmi; perbaikan utama di Backend (Fase 1-2) tidak membutuhkan restart WAHA. |

---

## 5. Status Persetujuan Eksekusi

Sesuai aturan **Mandat Larangan Eksekusi Tanpa Persetujuan Eksplisit Pengguna (Strict Human-in-the-Loop Confirmation Gate)**:
- Kode belum disentuh atau dimodifikasi.
- Dokumen rencana ini dibuat dan disimpan ke git agar siap dieksekusi setelah ada instruksi persetujuan tertulis dari Anda.
