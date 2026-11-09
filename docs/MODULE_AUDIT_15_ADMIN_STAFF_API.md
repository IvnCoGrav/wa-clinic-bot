# AUDIT MODUL 15 DARI 16 — ADMIN & STAFF API PENUH

**Modul:** Admin & Staff API Routes (`src/routes/admin.route.ts`, `src/routes/staff.route.ts`, `src/routes/admin/*`, `src/routes/staff/*`)  
**Commit:** `a99c758d` (`master`), working tree bersih  
**Tanggal audit:** 2026-11-09  
**Sifat:** Read-only (Fase S4.3). Tidak ada file source code aplikasi (`src/`) yang diubah.  
**Metode:** Static code analysis, audit otentikasi & RBAC middleware, audit kepatuhan mandat repo (batas ukuran file <1.500 baris, tenant isolation, anti-spaghetti, data-driven), analisis kerentanan IDOR & CSRF, serta verifikasi eksekusi test suite integrasi.

---

## CAKUPAN YANG SUDAH DIBACA

| File / Sub-modul | Baris | Status | Deskripsi Tanggung Jawab |
|---|---:|---|---|
| `src/routes/admin.route.ts` | 528 | Dibaca penuh | Root router `/api/admin`: origin isolation, dual auth middleware (API key, `admin_session`, `staff_session`), anti-CSRF header guard, RBAC guard Super Admin vs Staff, static assets SPA & PWA service worker serving. |
| `src/routes/staff.route.ts` | 95 | Dibaca penuh | Root router `/api/staff`: auth middleware staf independen, admin impersonation fallback, mounting subroute auth, today, dan quick-replies. |
| `src/routes/admin/stores.ts` | 131 | Dibaca penuh | Shared memory fallback stores (`memoryReservations`, `memoryLandings`), helper isolasi tenant `filterMemoryByTenant`, validasi landing slug, bounded rate limit brute-force map. |
| `src/routes/admin/route-helpers.ts` | 23 | Dibaca penuh | Helper resolusi tenant fail-closed `tenantOf(request)` dan sanitasi durasi menit reservasi. |
| `src/routes/admin/auth.subroute.ts` | 437 | Dibaca penuh | Unified login (`/login`), logout, sesi me (`/me`), restore session, account lockout (5x gagal -> 15 min), CSRF token provider. |
| `src/routes/admin/reservation-dispatch.route.ts` | 3.244 | Dibaca penuh | **God Route (Pelanggaran >1.500 baris)**: trip tracking telemetry, arsip/restore reservasi, detail reservasi, konfirmasi, penyelesaian (single & bulk complete), status patch, set-date, upload/remove proof foto, assign bidan/staff, delete/cancel, purchase moderation (approve/reject/unreject), CAPI queue list. |
| `src/routes/admin/settings.subroute.ts` | 2.817 | Dibaca penuh | **God Route (Pelanggaran >1.500 baris)**: MQL, media upload, pricelist image & promo, Meta purchase policy, payment info, persona & prompt config, few-shots CRUD + reorder, customer service config, AI model matrix & provider patch, global settings, CAPI config, AI rollout scope, conversation behavior, katalog layanan treatment CRUD, delivery fee tiers, purchase moderation, daily report config, notification settings, clinic policies per topic. |
| `src/routes/admin/customers.subroute.ts` | 1.997 | Dibaca penuh | **God Route (Pelanggaran >1.500 baris)**: Customer stats, audience export PII Meta, peta koordinat pelanggan, list customer & filter, detail customer, address book CRUD (5 endpoint), riwayat chat, reservasi aktif, trigger send-event, block/unblock, label pelanggan, flagged review, AI override, catatan pasien, location resolution & refresh. |
| `src/routes/admin/livechat.subroute.ts` | 1.441 | Dibaca penuh | Live Chat Monitor backend: area geo coverage, human handling conversations, paging percakapan, unread counter, sinkronisasi histori WAHA, message typing, gateway capability, delete message, edit message, reaction emoji, message pin/unpin/hide, pinned message lookup, SSE real-time stream (`/events`), release & takeover conversation, refresh foto profil, suggest reply, mark all read. |
| `src/routes/staff/today.subroute.ts` | 1.352 | Dibaca penuh | Portal staf & terapis lapangan: today tasks (`scope=mine\|all`), daftar rekan tim, delegasi ulang tugas, jadwal mendatang, riwayat selesai, chat pasien dengan masking PII, kirim template OTW & tiba, telemetri GPS live trip tracking, arrival geofence evaluation, selesaikan tugas & bukti pembayaran, SSE staff events. |
| `src/routes/admin/reservation-crud.route.ts` | 1.149 | Dibaca penuh | Dasar CRUD reservasi: hitung jumlah reservasi (dengan response cache), ketersediaan slot harian, list reservasi dengan filter status/staff/tanggal, parse teks reservasi, quick-hold booking, pembuatan reservasi baru. |
| `src/routes/admin/meta-attribution.subroute.ts` | 949 | Dibaca penuh | Dashboard atribusi iklan Meta: ringkasan metrik CTWA, analisis corong ad set, audit trail atribusi, sinkronisasi klik iklan manual. |
| `src/routes/admin/quick-replies.subroute.ts` | 788 | Dibaca penuh | CRUD template balasan cepat: filter kategori/shortcut, upload lampiran media, migrasi template default, ordering list. |
| `src/routes/admin/migration.subroute.ts` | 706 | Dibaca penuh | Utilitas migrasi data legacy: import kontak CSV, sinkronisasi riwayat chat historis, dry-run reconciler, log migrasi. |
| `src/routes/admin/evaluations.subroute.ts` | 574 | Dibaca penuh | AI Evaluator & Golden Dataset: hasil evaluasi benchmark NLU/LLM, kurasi jawaban, metrik akurasi jawaban bot. |
| `src/routes/admin/labels.subroute.ts` | 569 | Dibaca penuh | Manajemen tag/label internal percakapan dan sinkronisasi manual. |
| `src/routes/admin/landings.subroute.ts` | 542 | Dibaca penuh | Landing page CMS: dynamic slug management, event CAPI triggers, template editor, asset caching. |
| `src/routes/admin/follow-up.subroute.ts` | 457 | Dibaca penuh | Dashboard kontrol follow-up: list antrean PENDING/QUEUED/SENT, kirim instan, retry, batalkan, edit teks kustom. |
| `src/routes/admin/staff-management.subroute.ts` | 413 | Dibaca penuh | CRUD akun staf: pendaftaran terapis/admin baru, reset password, status aktif/nonaktif, peran RBAC. |
| `src/routes/admin/knowledge.subroute.ts` | 390 | Dibaca penuh | RAG Knowledge Base management: pencarian chunk, kurasi FAQ, status moderasi staging medis/umum. |
| `src/routes/admin/google-integration.subroute.ts` | 387 | Dibaca penuh | Integrasi Google Calendar: sinkronisasi kalender reservasi, status koneksi service account. |
| `src/routes/admin/waba.subroute.ts` | 373 | Dibaca penuh | Manajemen Meta Cloud API (WABA): template HSM approval status, nomor telepon ID, webhook status. |
| `src/routes/admin/staff-retention.subroute.ts` | 355 | Dibaca penuh | Analisis performa & retensi terapis: repeat order rate per bidan, skor kepuasan pasien, leaderboard tim. |
| `src/routes/admin/copilot.subroute.ts` | 303 | Dibaca penuh | CS Copilot Assistant: saran tindakan otomatis untuk staf, ringkasan konteks pasien, rekomendasi layanan. |
| `src/routes/admin/ctwa-catchers.subroute.ts` | 287 | Dibaca penuh | Manajemen nomor catcher iklan Click-to-WhatsApp: rotasi nomor, penandaan campaign, metrik masuk. |
| `src/routes/staff/auth.subroute.ts` | 261 | Dibaca penuh | Otentikasi terapis: login nomor HP + password bcrypt, lockout proteksi (5x gagal), session renewal, logout. |
| `src/routes/admin/backup.subroute.ts` | 249 | Dibaca penuh | Manajemen backup database: picu snapshot, daftar berkas backup, verifikasi integritas checksum. |
| `src/routes/admin/reservation-series.route.ts` | 237 | Dibaca penuh | Manajemen paket reservasi berseri (multi-session): pause, resume, cancel, perbarui jadwal sesi. |
| `src/routes/admin/push.subroute.ts` | 231 | Dibaca penuh | PWA Web Push management: registrasi endpoint browser, tes kirim notifikasi push, cek perangkat staf. |
| `src/routes/admin/roles.subroute.ts` | 223 | Dibaca penuh | Manajemen hak akses kustom (RBAC): per-tenant role API scope matrix editor. |
| `src/routes/admin/analytics.subroute.ts` | 89 | Dibaca penuh | Ringkasan metrik analitik: revenue, volume reservasi, konversi leads, utilisasi staf. |
| `src/routes/admin/export.subroute.ts` | 60 | Dibaca penuh | Ekspor data laporan keuangan dan data mentah reservasi ke spreadsheet. |
| `src/routes/staff/quick-replies.subroute.ts` | 29 | Dibaca penuh | Read-only shortcut balasan cepat untuk portal mobile staf di lapangan. |
| `src/routes/admin/ai-health.subroute.ts` | 20 | Dibaca penuh | Health check status endpoint AI provider & latensi response. |
| `src/routes/admin/reservations.subroute.ts` | 19 | Dibaca penuh | Barrel delegator untuk `reservationCrudRoutes`, `reservationDispatchRoutes`, dan `reservationSeriesRoutes`. |
| **Total** | **21.725** | **100%** | Seluruh 35 file rute API Admin & Staff diinspeksi secara menyeluruh. |

**Dependensi yang dibaca sebagian (konteks keamanan & autentikasi):**
- `src/services/admin-session.service.ts` (manajemen token hash sesi admin)
- `src/services/staff-auth.service.ts` (manajemen sesi terapis/staf)
- `src/services/role-scope.service.ts` (evaluasi data-driven RBAC `role_api_scopes`)
- `src/services/staff-reservation.service.ts` (logika bisnis portal terapis)
- `src/services/staff-trip-tracking.service.ts` (perhitungan geofence dan telemetri)

**Test Suite Terkait yang Diverifikasi:**
- `tests/integration/staff-routes.test.ts` (26 tests - PASS)
- `tests/unit/staff-auth-and-reservation.test.ts` (28 tests - PASS terisolasi)
- `tests/unit/admin-rbac-guard.test.ts` (PASS)
- `tests/unit/admin-reservations-tenant.test.ts` (3 tests - PASS)
- `tests/integration/admin-auth-signal-contract.test.ts` (PASS)

---

## A. RINGKASAN MODUL + SKOR KESEHATAN

Modul 15 merupakan **lapisan API eksternal terbesar** dalam sistem dengan 21.725 baris kode yang mencakup seluruh antarmuka administratif untuk manajer klinik, admin CS, dan staf terapis di lapangan.

### Kelebihan Arsitektural (+)
1. **Middleware Keamanan Berlapis**: Dilengkapi *Origin Isolation Guard* (mencegah akses API admin dari domain landing page), *Dual Auth Middleware* (X-API-KEY dan HttpOnly Cookie), serta *Anti-CSRF Header Guard* wajib (`X-Requested-With: XMLHttpRequest`) untuk seluruh mutasi state via cookie.
2. **RBAC Data-Driven (`role_api_scopes`)**: Penegakan hak akses peran staf menggunakan tabel basis data dinamis (*fail-closed*), di mana role tanpa baris yang cocok langsung ditolak HTTP 403.
3. **Isolasi PII pada Portal Staf**: Portal terapis menyembunyikan nomor WhatsApp pasien secara sengaja (`sanitizeMessageForStaff`) untuk mencegah kontak bypass di luar sistem dan menjaga privasi data pelanggan.
4. **Resistensi Brute Force**: Proteksi *account lockout* (5 kali gagal terkunci 15 menit) dan rate limiter memori berbasis IP yang dilengkapi pembersihan TTL berkala dan batas hardcap FIFO (1.000 entri).
5. **Streaming SSE Realtime Monotonik**: Penggunaan sequencer ID monotonik pada koneksi SSE `/events` menjamin frontend dapat mendeteksi celah pesan saat tab browser tertidur.

### Kelemahan Arsitektural (−)
1. **Pelanggaran Batas Modul God Object (>1.500 baris)**: Terdapat 3 file rute raksasa yang melanggar mandat arsitektur:
   - `src/routes/admin/reservation-dispatch.route.ts` (3.244 baris — lebih dari 2x batas maksimal)
   - `src/routes/admin/settings.subroute.ts` (2.817 baris)
   - `src/routes/admin/customers.subroute.ts` (1.997 baris)
2. **Kebocoran Multi-Tenant pada Admin Impersonation**: Pada `src/routes/staff.route.ts:71`, ketika admin login dan membuka portal staf, sesi impersonasi staf secara hardcoded diberi `tenant_id: DEFAULT_TENANT_ID`. Admin Tenant B yang memeriksa portal staf akan disajikan data tugas milik Tenant A.
3. **Hardcoded Tenant pada Unified Admin Login**: Di `src/routes/admin/auth.subroute.ts:146-148`, kueri pencarian akun staf dikunci ke `tenant_id: DEFAULT_TENANT_ID`, membuat staf dari cabang/tenant lain mustahil melakukan login melalui portal login admin.
4. **Duplikasi Rute Alias (*Double Route Registration*)**: Di `src/routes/admin/livechat.subroute.ts`, setidaknya 6 pasang rute didaftarkan dua kali berturut-turut (misal `/api/admin/conversations/:id/typing` dan `/api/admin/live-chat/conversations/:id/typing`) dengan closure handler ganda yang rawan mengalami *drift*.
5. **Kurangnya Validasi Skema Formal (Zod/JSON Schema)**: Sebagian besar handler rute membaca body melalui `request.body as any` tanpa schema validation bawaan Fastify, mengandalkan pengecekan manual *if-else* yang rawan celah mass-assignment.

**Skor Kesehatan: 2.5 / 5 (Fitur sangat kaya dan guard keamanan CSRF/RBAC berjalan baik, tetapi memiliki 3 god controller berukuran raksasa >2.000 baris, celah kebocoran impersonasi multi-tenant, dan duplikasi alias endpoint).**

---

## B. TABEL TEMUAN LENGKAP

| ID | Severity | File:Baris | Masalah | Dampak | Prinsip yang Dilanggar | Rekomendasi + Cost/Benefit | Effort | Keyakinan | Status |
|---|---|---|---|---|---|---|---|---|---|
| **API-01** | **Tinggi** | `reservation-dispatch.route.ts:1-3244`, `settings.subroute.ts:1-2817`, `customers.subroute.ts:1-1997` | Tiga file rute controller berukuran raksasa (>1.500 baris) menggabungkan puluhan domain bisnis yang tidak sejenis. | Tingginya risiko regresi saat refaktor, konflik merge antar pengembang, dan kesulitan pengujian terisolasi. | Batas Modul Jelas Mandate (<1.500 baris), Modularity-First Mandate | Pecah per sub-domain: `dispatch-telemetry.route.ts`, `reservation-moderation.route.ts`, `settings-ai.route.ts`, `customer-address.route.ts`. **Cost:** M. **Benefit:** Kode modular dan terisolasi. | M | H | TERVERIFIKASI |
| **API-02** | **Tinggi** | `src/routes/staff.route.ts:71` | Sesi admin impersonation staf secara hardcoded menetapkan `tenant_id: DEFAULT_TENANT_ID`. | Admin dari Tenant B yang membuka portal staf akan mengakses dan memutasi data jadwal milik Tenant Default (Kebocoran Lintas-Tenant). | Multi-Tenant & SaaS-Readiness Mandate, Tenant Isolation Mandate | Ambil `tenant_id` dari sesi admin atau header terverifikasi `x-tenant-id`. **Cost:** S. **Benefit:** Isolasi impersonasi multi-tenant terjamin. | S | H | TERVERIFIKASI |
| **API-03** | **Tinggi** | `src/routes/admin/auth.subroute.ts:146-148` | Kueri pencarian akun staf pada unified login dikunci secara kaku ke `tenant_id: DEFAULT_TENANT_ID`. | Staf/terapis dari tenant selain default-tenant tidak akan pernah bisa login melalui form login admin. | Multi-Tenant Architecture, Correctness | Berikan dukungan `tenantId` dari payload login atau resolusi domain tenant. **Cost:** S. **Benefit:** Seluruh staf cabang/tenant dapat login. | S | H | TERVERIFIKASI |
| **API-04** | **Sedang** | `src/services/admin-session.service.ts:6-13`, `src/routes/admin.route.ts:158` | Entitas `AdminSession` tidak memiliki atribut `tenant_id`, bergantung pada header client `x-tenant-id` tanpa verifikasi kepemilikan. | Potensi eksploitasi manipulasi header untuk mengakses data tenant lain jika client memegang token admin yang valid (*tenant hopping*). | Multi-Tenant Security & Tenant Isolation Mandate | Tautkan `tenant_id` ke dalam tabel `AdminSession` saat login dan validasi kecocokan header di preHandler. **Cost:** M. **Benefit:** Otorisasi tenant tidak bisa dimanipulasi client. | M | H | TERVERIFIKASI |
| **API-05** | **Sedang** | `reservation-dispatch.route.ts:2025, 2108` | Mutasi data reservasi (`prisma.reservation.update`) menggunakan `where: { id }` tanpa menyertakan `tenant_id` pada klausa update. | Inkonsistensi pola keamanan; pembaruan tidak dijamin scoped pada level kueri mutasi jika terjadi konkurensi data. | Secure Coding Standards, Repository Scoping Mandate | Gunakan `updateMany` scoped: `where: { id, tenant_id: tenantId }` atau fungsi kanonis repository. **Cost:** S. **Benefit:** Kueri mutasi fail-closed multi-tenant. | S | H | TERVERIFIKASI |
| **API-06** | **Sedang** | `src/routes/admin/stores.ts:3-4` | Penampung memori fallback `memoryReservations` dan `memoryLandings` berupa `Map` tanpa batasan kapasitas (*unbounded*). | Potensi kebocoran memori RAM saat database offline berkepanjangan pada lingkungan dev/staging. | Resource Management & Scalability Mandate | Terapkan batas maksimal FIFO (misal `MAX_MEMORY_RESERVATIONS = 1000`). **Cost:** S. **Benefit:** Konsumsi memori server stabil. | S | H | TERVERIFIKASI |
| **API-07** | **Sedang** | Sebagian besar subroute `admin/*` | Penggunaan `request.body as any` tanpa schema validation deklaratif (Fastify JSON Schema / Zod). | Risiko mass assignment, payload malformed yang lolos ke service, dan tidak adanya kontrak API formal untuk dokumentasi. | Defensive Programming, API Contract Integrity | Pasang schema validator Zod / Fastify schema pada endpoint mutasi kritis. **Cost:** M. **Benefit:** Sanitasi input terjamin sebelum mencapai handler. | M | H | TERVERIFIKASI |
| **API-08** | **Sedang** | `src/routes/admin/livechat.subroute.ts:640, 757, 808, 858, 885, 1168` | Pendaftaran rute ganda / alias berturut-turut untuk fungsionalitas yang sama (dengan vs tanpa `/live-chat`). | Pendaftaran ganda membebani tabel router Fastify; risiko *route drift* jika salah satu handler diperbarui tanpa aliasnya. | Single Canonical Contract Mandate, Anti-Dangling Mandate | Gunakan satu rute kanonis dan pasang redirect HTTP 308 atau deklarasikan wrapper alias yang jelas. **Cost:** S. **Benefit:** Struktur routing bersih dan terstandar. | S | H | TERVERIFIKASI |
| **API-09** | **Rendah** | `src/routes/admin/*`, `src/routes/staff/*` | Casting masif `(request as any)` untuk mengakses `tenantId`, `staffSession`, dan `adminIdentity`. | Menghilangkan manfaat pengecekan tipe statis TypeScript; rentan salah ketik nama properti context. | TypeScript Strictness & Maintainability | Buat file definisi tipe `types/fastify.d.ts` dengan declaration merging untuk request context. **Cost:** S. **Benefit:** Autocomplete dan type safety penuh pada rute. | S | H | TERVERIFIKASI |
| **API-10** | **Rendah** | `src/routes/admin.route.ts:66-70, 351, 376, 401, 437` | Tumpang tindih penetapan header `Cache-Control` antara hook `preHandler` dan handler file statis asset. | Kerumitan pelacakan aturan cache browser; berisiko aset statis terkirim dengan header `no-store` yang tidak diinginkan. | Configuration Locality & DRY | Pusatkan kebijakan cache aset statis di handler statis dan batasi `no-store` hanya untuk rute API dinamis. **Cost:** S. **Benefit:** Caching browser bekerja optimal. | S | H | TERVERIFIKASI |
| **API-11** | **Rendah** | `reservation-dispatch.route.ts:2130, 2132` | Perekaman log penugasan bidan `ReservationStaffAssignmentLog` di-swallow dengan `console.warn` jika gagal. | Hilangnya jejak audit pergantian bidan saat database sibuk tanpa ada peringatan alert terstruktur. | Audit Trail Integrity Mandate | Kirim peringatan terstruktur via `alertService` saat pencatatan audit log gagal. **Cost:** S. **Benefit:** Integritas audit log terpantau. | S | H | TERVERIFIKASI |
| **API-12** | **Rendah** | `src/routes/admin/export.subroute.ts`, `src/routes/admin/analytics.subroute.ts` | Ketiadaan pembatas laju request (*rate limiter*) pada endpoint ekspor data massal dan query analitik berat. | Potensi pemborosan sumber daya komputasi database jika admin atau skrip memanggil export berulang-ulang. | Resource Protection & DoS Resilience | Pasang rate limiter ketat (misal 5 request per 5 menit per tenant) untuk endpoint ekspor. **Cost:** S. **Benefit:** Beban database terlindungi dari lonjakan query. | S | H | TERVERIFIKASI |

---

## C. BEFORE / AFTER KODE

### C-1. Isolasi Tenant pada Admin Impersonation Staf (Mencegah Kebocoran Antar-Klinik)

**Before** (`src/routes/staff.route.ts:70-73`):
```typescript
if (adminSession) {
  session = {
    token: adminCookie,
    staff: {
      id: adminSession.id || 'admin',
      name: adminSession.adminIdentity || 'Admin',
      role: 'SPV_CS',
      tenant_id: DEFAULT_TENANT_ID, // Hardcoded! Bocor ke tenant default
    },
    createdAt: adminSession.createdAt,
    expiresAt: adminSession.expiresAt,
    isAdminImpersonation: true,
  } as any;
}
```

**After**:
```typescript
if (adminSession) {
  // Ambil tenant terverifikasi dari header request atau sesi admin
  const requestedTenant =
    (request.headers['x-tenant-id'] as string) ||
    (adminSession as any).tenantId ||
    DEFAULT_TENANT_ID;

  session = {
    token: adminCookie,
    staff: {
      id: adminSession.id || 'admin',
      name: adminSession.adminIdentity || 'Admin',
      role: 'SPV_CS',
      tenant_id: requestedTenant.trim(),
    },
    createdAt: adminSession.createdAt,
    expiresAt: adminSession.expiresAt,
    isAdminImpersonation: true,
  } as any;
}
```

---

### C-2. Dukungan Multi-Tenant pada Unified Login Staf di Portal Admin

**Before** (`src/routes/admin/auth.subroute.ts:143-150`):
```typescript
const cleanPhone = identifier.trim().replace(/^(\+62|62)/, '0');
const staff = await prisma.staff.findFirst({
  where: {
    OR: [
      { phone: cleanPhone, tenant_id: DEFAULT_TENANT_ID, active: true },
      { phone: identifier.trim(), tenant_id: DEFAULT_TENANT_ID, active: true },
      { name: identifier.trim(), tenant_id: DEFAULT_TENANT_ID, active: true },
    ],
  },
});
```

**After**:
```typescript
const cleanPhone = identifier.trim().replace(/^(\+62|62)/, '0');
const targetTenantId = (body as any).tenantId || (request.headers['x-tenant-id'] as string) || DEFAULT_TENANT_ID;

const staff = await prisma.staff.findFirst({
  where: {
    tenant_id: targetTenantId,
    active: true,
    OR: [
      { phone: cleanPhone },
      { phone: identifier.trim() },
      { name: identifier.trim() },
    ],
  },
});
```

---

### C-3. Konsolidasi Alias Rute Ganda di Live Chat Subroute

**Before** (`src/routes/admin/livechat.subroute.ts:639-642`):
```typescript
// Duplikasi pendaftaran rute dengan implementasi inline ganda
fastify.post('/api/admin/conversations/:id/typing', async (request, reply) => {
  // ... handler logika ...
});

fastify.post('/api/admin/live-chat/conversations/:id/typing', async (request, reply) => {
  // ... handler logika identik diduplikasi ...
});
```

**After**:
```typescript
// Ekstrak handler tunggal yang kanonis
const handleConversationTyping = async (request: FastifyRequest, reply: FastifyReply) => {
  // ... satu implementasi tunggal ...
};

// Daftarkan rute kanonis
fastify.post('/api/admin/live-chat/conversations/:id/typing', handleConversationTyping);

// Rute alias untuk backward compatibility (menunjuk ke handler yang sama)
fastify.post('/api/admin/conversations/:id/typing', handleConversationTyping);
```

---

### C-4. Bounded Capacity pada `memoryReservations` (Anti-Memory Leak Store)

**Before** (`src/routes/admin/stores.ts:3`):
```typescript
export const memoryReservations = new Map<string, any>();
```

**After**:
```typescript
export const memoryReservations = new Map<string, any>();
export const MAX_MEMORY_RESERVATIONS = 1000;

export function setMemoryReservation(id: string, reservation: any): void {
  if (memoryReservations.has(id)) {
    memoryReservations.delete(id);
  } else if (memoryReservations.size >= MAX_MEMORY_RESERVATIONS) {
    const oldestKey = memoryReservations.keys().next().value;
    if (oldestKey !== undefined) memoryReservations.delete(oldestKey);
  }
  memoryReservations.set(id, reservation);
}
```

---

## D. KATALOG REUSE & KOMPONEN BERSAMA

1. **`route-helpers.ts` (`tenantOf(request)`)**:
   - Helper resolusi tenant fail-closed yang aman dipakai di seluruh route handler Fastify untuk memastikan request tidak memproses data tanpa scope tenant yang sah.
2. **`stores.ts` (`filterMemoryByTenant`, `pruneLoginAttempts`)**:
   - Utilitas penyaringan memori fallback multi-tenant dan algoritma pembersih memori rate limiting yang siap dipakai di sub-router lain.
3. **`admin.route.ts` (Anti-CSRF & Dual Auth Pre-handlers)**:
   - Pola verifikasi multi-auth (API Key + HttpOnly Session Cookie + Anti-CSRF header) yang menjadi standar pengamanan endpoint admin.
4. **`today.subroute.ts` (`staffSseSeq`)**:
   - Monotonic SSE sequencer yang menjamin id event naik secara sekuensial dan konsisten lintas koneksi event streaming.

---

## E. FILE YANG BELUM DIBACA & BLIND SPOTS

1. **`packages/admin-dashboard/*` (Frontend UI SPA)**:
   - Komponen React, hooks `useAuth`, dan state context di frontend dashboard yang memanggil endpoint-endpoint ini tidak diaudit di modul ini (masuk cakupan Modul 16).
2. **`src/services/landing-content.service.ts`**:
   - Logika penyimpanan dan rendering konten dinamis landing page publik belum diinspeksi secara mendalam pada file rute `landings.subroute.ts`.

---

## F. RISIKO FMEA & MATRIKS REGRESI

| Potensi Kegagalan | Dampak Kegagalan | Keparahan (S) | Probabilitas (O) | Deteksi (D) | RPN | Rencana Mitigasi Fondasional |
|---|---|---|---|---|---|---|
| **Kebocoran Data pada Admin Impersonation** | Admin Tenant B melihat seluruh jadwal pasien & penugasan staf milik Tenant Default. | 9 | 4 | 3 | **108** | Resolusi `tenant_id` secara dinamis pada sesi impersonasi admin di `staff.route.ts` (API-02). |
| **Kegagalan Login Staf Cabang Baru** | Staf dari klinik baru tidak bisa masuk ke sistem karena query login terkunci ke default-tenant. | 8 | 4 | 3 | **96** | Tambahkan parameter `tenantId` pada kueri autentikasi staf di `auth.subroute.ts` (API-03). |
| **Regresi Tersembunyi pada God Controller** | Perubahan kecil pada alur CAPI merusak alur konfirmasi atau penyelesaian jadwal reservasi. | 7 | 5 | 2 | **70** | Pecah file rute >1.500 baris ke sub-domain modular yang lebih kecil (API-01). |
| **Manipulasi Tenant Hopping via Header** | Pengguna yang memiliki sesi admin mengubah header `x-tenant-id` untuk membaca data klinik lain. | 8 | 2 | 4 | **64** | Kaitkan `tenant_id` ke dalam baris sesi database `AdminSession` (API-04). |
| **Drift Perilaku pada Endpoint Alias Ganda** | Frontend yang memanggil endpoint `/live-chat/typing` mendapat respons berbeda dengan `/typing`. | 6 | 3 | 3 | **54** | Satukan closure implementasi handler rute alias (API-08). |

---

## G. REKOMENDASI TINDAKAN & PRIORITAS IMPLEMENTASI

### Prioritas 1 (P1) — Keamanan Multi-Tenant & Penegakan Batas Modul
1. **Perbaikan Tenant Impersonation Staf (API-02)**: Ubah `staff.route.ts:71` agar mengambil tenant yang sah dari sesi admin/header.
2. **Multi-Tenant Staff Login (API-03)**: Buka parameter `tenantId` pada kueri autentikasi staf di `auth.subroute.ts`.
3. **Pemecahan God Route Controller (API-01)**:
   - Pecah `reservation-dispatch.route.ts` (3.244 baris) menjadi:
     - `reservation-dispatch-telemetry.route.ts` (trip tracking & telemetri)
     - `reservation-dispatch-actions.route.ts` (complete, bulk-complete, status, assign)
     - `reservation-dispatch-moderation.route.ts` (purchase review, CAPI queue)
   - Pecah `settings.subroute.ts` (2.817 baris) menjadi modul per-grup setting (AI, Katalog Layanan, Kebijakan Klinik, Notifikasi).
   - Pecah `customers.subroute.ts` (1.997 baris) dengan memisahkan Address Book CRUD ke file tersendiri.

### Prioritas 2 (P2) — Pengetatan Keamanan & Validasi Input
1. **Pengikatan Tenant pada AdminSession (API-04)**: Tambahkan kolom `tenant_id` pada model `AdminSession` untuk mencegah manipulasi header.
2. **Kueri Mutasi Scoped Fail-Closed (API-05)**: Pastikan setiap mutasi `prisma.reservation.update` menyertakan `tenant_id`.
3. **Validasi Skema Masukan Deklaratif (API-07)**: Pasang Zod schema validation pada endpoint pembuatan dan pengubahan data.
4. **Pembersihan Rute Ganda di LiveChat (API-08)**: Hilangkan duplikasi handler closure pada rute alias LiveChat.

### Prioritas 3 (P3) — Bounded Memory & Clean Architecture
1. **Bounded FIFO pada Stores (API-06)**: Batasi kapasitas maksimal penampung memori di `stores.ts`.
2. **Deklarasi Tipe Request Fastify (API-09)**: Buat declaration merging `FastifyRequest` untuk mengeliminasi casting `(request as any)`.
3. **Rate Limiting Endpoint Berat (API-12)**: Tambahkan pembatas laju pemanggilan pada rute ekspor data dan analitik.
