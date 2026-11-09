# AUDIT MODUL 12 DARI 16 — FOLLOW-UP & NOTIFICATION

**Modul:** Follow-up & Notification Services (`src/services/follow-up.service.ts`, `src/services/shareloc-reminder.service.ts`, `src/services/shareloc-signal.service.ts`, `src/services/alert.service.ts`, `src/services/inbound-notification-router.service.ts`, `src/services/notification-delivery.service.ts`, `src/services/staff-notification.service.ts`, `src/services/telegram.service.ts`, `src/services/web-push.service.ts`, `src/config/staff-notification-config.ts`, `src/config/staff-chat-config.ts`)
**Commit:** `62f64472` (`master`), working tree bersih  
**Tanggal audit:** 2026-11-09  
**Sifat:** Read-only (Fase S4.2). Tidak ada file source code aplikasi (`src/`) yang diubah.  
**Metode:** Static code analysis, audit kepatuhan mandat repo (tenant isolation, data-driven, anti-hardcode, anti-spaghetti), penelusuran dependensi pengiriman proaktif, analisis konkurensi cron & idempotensi lease, serta validasi eksekusi unit test.

---

## CAKUPAN YANG SUDAH DIBACA

| File | Baris | Status | Deskripsi Tanggung Jawab |
|---|---:|---|---|
| `src/services/follow-up.service.ts` | 2.895 | Dibaca penuh | God Service: CRUD template rolling/custom, query filter/listing dashboard admin, lifecycle trigger scheduler (NO_PURCHASE 3 stage, NEXT_TREATMENT 3 bulan, REMINDER_H1, REVIEW_H1), sliding window inbound, atomic lease claim anti-dobel, recent visit suppression guard, placeholder validation gate, provider-aware dispatcher (WAHA text vs WABA HSM), winback dormant 60D, lost customer reconciler. |
| `src/services/shareloc-reminder.service.ts` | 360 | Dibaca penuh | Sapuan berkala (sweep) pengingat titik presisi GPS customer reservasi aktif, template lookup dari DB (QuickReply / ClinicPolicy), perlindungan friendly hours WIB, proteksi idempotensi harian `AdminNotificationLog`, SSE LiveChatHub publisher. |
| `src/services/shareloc-signal.service.ts` | 113 | Dibaca penuh | Evaluator murni sinyal kebutuhan shareloc (pure function matematis tanpa DB): evaluasi status reservasi, grace time same-day, pending window, dan cooldown 6 jam. |
| `src/services/alert.service.ts` | 264 | Dibaca penuh | Central system alert engine: 23 AlertType (outages, emergencies, quota), multi-thread topic routing Telegram, per-trigger throttling dengan akumulasi counter, dan fallback emergency append-only log file. |
| `src/services/inbound-notification-router.service.ts` | 225 | Dibaca penuh | Deterministik router notifikasi chat masuk: broadcast Web Push ke admin (/admin/live-chat) dan targeted push ke perangkat staf yang bertugas hari ini dengan filter window reservasi (H-3 jam s/d +3 jam) dan evaluasi bot-handled gate. |
| `src/services/notification-delivery.service.ts` | 269 | Dibaca penuh | Pipa pengiriman notifikasi admin/staf tenant-aware: normalisasi E.164, channel dispatch (WHATSAPP gateway, TELEGRAM alert, SYSTEM audit log), idempotensi cron via `idempotencyKey`, dan graceful memory fallback. |
| `src/services/staff-notification.service.ts` | 1.101 | Dibaca penuh | Manajemen notifikasi terapis/bidan: Telegram account pairing, penugasan tugas reservasi (Google Maps, jarak tempuh, rincian biaya, catatan pasien), Pre-visit brief H-1, pembatalan penugasan, dan generator briefing pagi seluruh staf. |
| `src/services/telegram.service.ts` | 145 | Dibaca penuh | Low-level Telegram Bot API client: tenant pairing token management (pairing link generator), topik Telegram forum routing, Markdown/HTML fallback parser. |
| `src/services/web-push.service.ts` | 477 | Dibaca penuh | W3C Web Push Notification engine: VAPID key generator/storage, device subscription management, role-based push broadcast ('ADMIN' | 'STAFF'), targeted staff push, 410/404 dead subscription pruning. |
| `src/config/staff-notification-config.ts` | 62 | Dibaca penuh | Konfigurasi kebijakan kanal notifikasi staf (In-System PWA Only vs Telegram optional), per-tenant cache TTL 5 menit. |
| `src/config/staff-chat-config.ts` | 122 | Dibaca penuh (koreksi review) | Jam notifikasi chat staf per-tenant; fallback default 07:00–21:00 WIB dan catch kosong saat DB offline. |
| **Total** | **6.033** | **100%** | Seluruh 11 file modul diinspeksi secara baris demi baris. |

**Dependensi yang dibaca sebagian (konteks integrasi):**
- `src/domain/reservation-status.ts` (status reservasi kanonis & window aktif)
- `src/domain/location-adequacy.ts` (sumber kebenaran kecukupan koordinat lokasi)
- `src/integrations/whatsapp/factory.ts` (`resolveGatewayForTenant` untuk WABA/WAHA)
- `src/services/waba-template.service.ts` (validasi status approval template Meta)
- `src/services/waba-consent.service.ts` (gatekeeper opt-in marketing WABA)
- `src/services/live-chat-hub.service.ts` (SSE real-time broadcast)

**Unit & Integration Test Suite yang relevan:**
- `tests/unit/follow-up-engine.test.ts` (37 tests - PASS)
- `tests/unit/followup-atomic-claim.test.ts` (1 test - PASS)
- `tests/unit/shareloc-reminder.test.ts` (6 tests - PASS)
- `tests/unit/shareloc-signal.test.ts` (15 tests - PASS)
- `tests/unit/inbound-notification-router.test.ts` (6 tests - PASS)
- `tests/unit/notification-delivery.test.ts` (5 tests - PASS)
- `tests/unit/staff-notification-guards.test.ts` (8 tests - PASS)
- `tests/unit/alert_triggers.test.ts` (17 tests - PASS)
- `tests/unit/web-push.service.test.ts` (14 tests - PASS)
*(Total 109 test spesifik modul ini berjalan hijau 100% dalam 2,58 detik).*

---

## A. RINGKASAN MODUL + SKOR KESEHATAN

Modul 12 mengontrol seluruh **aliran proaktif dan reaktif** sistem: pengingat reservasi, penawaran follow-up berjenjang (CRM retention), pengingat shareloc GPS, perutean notifikasi chat masuk ke staf/admin, sinyal darurat sistem (alerting), dan pengiriman Web Push PWA.

### Kelebihan Arsitektural (+)
1. **Perlindungan Ketat Pesan Proaktif**: Adanya gerbang kanonis `conversationService.bolehKirimProaktif()` dan Recent Visit Suppression Guard (14 hari) mencegah bot mengirim pesan follow-up repeat-order yang tidak peka waktu ke pasien yang baru saja dirawat.
2. **Klaim Atomik Anti-Dobel Kirim**: Mekanisme `processing_claimed_at` dengan sewa kedaluwarsa otomatis (5 menit) di `follow-up.service.ts:2050` berhasil mencegah *race condition* antara cron periodik dan eksekusi manual admin ("Kirim Sekarang").
3. **Penyaringan Placeholder Mentah (Zero Leakage)**: `findUnresolvedPlaceholders` membatalkan otomatis pesan yang masih menyisakan format `{name}` / `{time}` sebelum dikirim ke pelanggan.
4. **Desain "In-System PWA Only" untuk Staf**: Pemisahan tegas notifikasi terapis (Web Push PWA mandiri tanpa ekspos nomor WA pasien) dengan Telegram eksternal yang di-default OFF menjaga kerahasiaan data pasien (PII protection).
5. **Agregasi & Throttling Alert Cerdas**: `alert.service.ts` mengagregasi peringatan sistem yang berulang selama jendela cooldown sehingga tidak membanjiri Telegram pengembang tanpa kehilangan informasi jumlah insiden (*aggregated count*).

### Kelemahan Arsitektural (−)
1. **God Service `follow-up.service.ts` (2.895 baris)**: Merupakan file terbesar kedua di repositori. Mencampuradukkan manipulasi skema template, logika listing admin dashboard, algoritma penjadwalan lifecycle, eksekusi fisik pesan, dan cron sweeping rekonsiliasi.
2. **Silent Outbound Drop pada `shareloc-reminder.service.ts`**: Saat bot mengirimkan teks permintaan titik GPS ke nomor pasien, pengiriman dilakukan via gateway tetapi **sama sekali tidak dicatat** ke `messageService.logMessage` dan tidak didaftarkan ke `registerInFlightBotOutbound`. Hal ini menyebabkan riwayat chat di Live Chat menjadi rumpang (outbound ghost) dan echo balasan bot berisiko salah dideteksi sebagai admin takeover.
3. **Penyimpanan Plaintext VAPID Private Key**: `web-push.service.ts` menyimpan private key Web Push dalam bentuk file JSON mentah di `storage/vapid_keys.json` jika env tidak disediakan.
4. **Cross-Tenant Alert Throttling Risk**: Kunci peredam alert di `alert.service.ts` (`${payload.type}:${payload.provider}`) tidak menyertakan `tenantId`. Akibatnya, insiden di Tenant A dapat secara keliru membungkam peringatan yang sama di Tenant B selama 5 menit.
5. **Polusi Fallback `DEFAULT_TENANT_ID`**: Belasan signature fungsi publik di `follow-up.service.ts` menggunakan parameter default `tenantId = DEFAULT_TENANT_ID`, mengaburkan isolasi multi-tenant bila pemanggil lupa meneruskan ID tenant.

**Skor Kesehatan: 3.0 / 5 (Fitur sangat lengkap dan teruji secara fungsional dengan 109 test hijau, namun memiliki file god object 2.895 baris, celah silent drop pada logging shareloc, dan isolasi tenant alert yang belum sempurna).**

---

## B. TABEL TEMUAN LENGKAP

| ID | Severity | File:Baris | Masalah | Dampak | Prinsip yang Dilanggar | Rekomendasi + Cost/Benefit | Effort | Keyakinan | Status |
|---|---|---|---|---|---|---|---|---|---|
| **FN-01** | **Tinggi** | `src/services/follow-up.service.ts:1-2895` | God Object 2.895 baris menggabungkan template CRUD, admin dashboard listing, lifecycle triggers, execution engine, dan cron reconciler. | Modul sangat rapuh terhadap regresi; sulit diuji secara modular dan beban kognitif pengembang sangat tinggi. | Single Responsibility Principle, Modularity-First Mandate, Anti-Spaghetti | Pecah ke sub-domain modular: `followUpTemplateService`, `followUpSchedulerService`, `followUpExecutionService`, `followUpCronService`. **Cost:** M-L. **Benefit:** Isolasi tinggi, pemeliharaan aman. | M-L | H | TERVERIFIKASI |
| **FN-02** | **Tinggi** | `src/services/shareloc-reminder.service.ts:267-330` | Pengiriman pengingat shareloc via gateway TIDAK dicatat ke `messageService.logMessage` dan TIDAK didaftarkan ke `registerInFlightBotOutbound`. | Pesan pengingat tidak muncul di Live Chat Monitor admin; gema bot berisiko memicu false admin takeover di webhook. | Observability Mandate, Audit Trail Integrity | Tambahkan `messageService.logMessage` (OUTBOUND) dan `registerInFlightBotOutbound` setelah `gateway.sendTextMessage`. **Cost:** S. **Benefit:** Paritas penuh riwayat chat Live Chat. | S | H | TERVERIFIKASI |
| **FN-03** | **Tinggi** | `src/services/staff-notification.service.ts:1-1101` | God Object 1.101 baris mencampuradukkan format teks tugas lapangan, Web Push dispatch, pre-visit brief, dan agregasi briefing pagi. | Kompleksitas tinggi dan duplikasi logika perakitan alamat serta navigasi peta di beberapa fungsi berbeda. | Modularity-First Mandate, DRY Principle | Pisahkan formatting pesan tugas (`staffTaskFormatter`) dari delivery service Web Push/Telegram. **Cost:** M. **Benefit:** Format pesan konsisten & mudah diuji. | M | H | TERVERIFIKASI |
| **FN-04** | **Sedang** | `src/services/notification-delivery.service.ts:40` | `memoryNotificationLogs` berupa array in-memory `any[]` tanpa batas kapasitas (*unbounded*). | Potensi kebocoran memori RAM (memory bloat) jika database down dalam durasi lama saat cron berjalan. | Resource Management & Scalability Mandate | Terapkan batasan FIFO (`MAX_MEMORY_LOGS = 500`) seperti pada `messageService`. **Cost:** S. **Benefit:** Stabilitas memori terjamin. | S | H | TERVERIFIKASI |
| **FN-05** | **Sedang** | `src/services/web-push.service.ts:29, 68-93` | Kunci privat VAPID disimpan dalam file plaintext `storage/vapid_keys.json` tanpa enkripsi jika ENV tidak diset. | Risiko kebocoran kredensial Web Push jika file storage diekspor atau terbaca proses lain. | Security & Credential Protection Mandate | Enkripsi file menggunakan utilitas `encryptSecret` atau wajibkan VAPID key disuplai via environment variable di production. **Cost:** S. **Benefit:** Kredensial push terlindungi. | S | H | TERVERIFIKASI |
| **FN-06** | **Sedang** | `src/services/follow-up.service.ts:151-2709` | 15 method publik memakai default `tenantId: string = DEFAULT_TENANT_ID`. | Pemanggil tanpa parameter eksplisit secara diam-diam memanipulasi data tenant default; celah kebocoran multi-tenant. | Multi-Tenant & SaaS-Readiness Mandate | Wajibkan parameter `tenantId` (hapus default value `= DEFAULT_TENANT_ID`) di seluruh method public service. **Cost:** S-M. **Benefit:** Tenant isolation terjamin secara compile-time. | S-M | H | TERVERIFIKASI (dikoreksi: tepat 15) |
| **FN-07** | **Sedang** | `src/services/alert.service.ts:79-84` | Cooldown key throttling alert `${payload.type}:${payload.provider}` tidak menyertakan `tenantId`. | Gangguan di Tenant A dapat membungkam alert darurat yang sama di Tenant B selama jendela 5 menit (*cross-tenant throttling*). | Multi-Tenant Data Isolation Mandate | Tambahkan `tenantId` ke dalam key cooldown: `${payload.tenantId || 'global'}:${payload.type}:${payload.provider || ''}`. **Cost:** S. **Benefit:** Peringatan darurat independen per tenant. | S | H | TERVERIFIKASI |
| **FN-08** | **Sedang** | `src/services/web-push.service.ts:35` | Subjek email VAPID ter-hardcode ke `'mailto:admin@kala-clinic.com'` bila ENV kosong. | Melanggar netralitas multi-tenant saat sistem digunakan oleh brand klinik selain Kala. | Non-Hardcode & Multi-Tenant Data-Driven Mandate | Ambil subjek dari konfigurasi `Tenant` di database atau fallback generik netral. **Cost:** S. **Benefit:** White-labeling murni. | S | H | TERVERIFIKASI |
| **FN-09** | **Rendah** | `src/services/shareloc-reminder.service.ts:46-332` | Penggunaan berulang type-cast `(prisma as any)` pada pemanggilan model Prisma. | Melemahkan pemeriksaan tipe statis TypeScript; perubahan skema database tidak terdeteksi saat kompilasi. | TypeScript Strictness & Type Safety | Hapus cast `as any` dan gunakan tipe model Prisma yang ter-generate resmi. **Cost:** S. **Benefit:** Type checking ketat saat build. | S | H | TERVERIFIKASI |
| **FN-10** | **Rendah** | `src/services/shareloc-reminder.service.ts:281-306` | Dual-write `session_data.shareloc_requested_at` dan `preferences.share_location_requested_at` dilakukan tanpa DB transaction. | Potensi desinkronisasi timestamp preferensi customer jika proses crash di antara dua update. | Transactional Integrity Mandate | Bungkus kedua mutasi ke dalam `prisma.$transaction`. **Cost:** S. **Benefit:** Konsistensi data atomik. | S | H | TERVERIFIKASI |
| **FN-11** | **Rendah** | `src/config/staff-chat-config.ts:10-14, 82-84` | Fallback jam operasional staf **07:00 - 21:00 WIB** tidak memberikan log penanda saat DB config kosong; catch di baris 82-84 kosong. | Operator tidak menyadari bahwa sistem sedang berjalan menggunakan konfigurasi fallback bawaan. | Observability & Fallback Clarity Mandate | Tambahkan log level info saat fallback default digunakan. **Cost:** S. **Benefit:** Transparansi konfigurasi runtime. | S | H | TERVERIFIKASI (dikoreksi) |
| **FN-12** | **Rendah** | `src/services/web-push.service.ts:33` | Map `memorySubscriptions` tidak memiliki mekanisme pembersihan berkala (*pruning timer*). | Langganan push yang kedaluwarsa pada sesi dev/offline tetap tersimpan di memori. | Memory Cleanliness Mandate | Pasang sweep interval sederhana untuk membersihkan langganan stale di memori. **Cost:** S. **Benefit:** Memori bersih di lingkungan dev. | S | H | TERVERIFIKASI |

---

## C. BEFORE / AFTER KODE

### C-1. Integrasi Outbound Logging pada Pengingat Shareloc (Menghilangkan Silent Ghost Message)

**Before** (`src/services/shareloc-reminder.service.ts:265-274`):
```typescript
// 6. Kirim pesan via gateway yang sadar tenant
const gateway = await resolveGatewayForTenant(tenantId);
const sendResult = await gateway.sendTextMessage(cust.phone, messageText);

if (!sendResult.success) {
  countReason('gateway_send_failed');
  continue;
}

// Langsung update preferensi tanpa mencatat pesan outbound ke messageService!
```

**After**:
```typescript
const gateway = await resolveGatewayForTenant(tenantId);
const chatId = `${cust.phone}@c.us`;

// 1. Daftarkan ke in-flight registry agar webhook echo tidak memicu false admin takeover
const { messageService } = await import('./message.service');
messageService.registerInFlightBotOutbound(chatId, messageText, tenantId, 60000);

const sendResult = await gateway.sendTextMessage(cust.phone, messageText);

if (!sendResult.success) {
  messageService.clearInFlightBotOutbound(chatId, tenantId);
  countReason('gateway_send_failed');
  continue;
}

// 2. Catat pesan outbound ke database agar muncul di Live Chat Monitor
if (conversation?.id) {
  await messageService.logMessage({
    tenantId,
    conversationId: conversation.id,
    direction: 'OUTBOUND',
    content: messageText,
    waMessageId: sendResult.messageId,
    senderType: 'BOT',
    senderName: 'Bot (Shareloc Reminder)',
    deliveryStatus: 'sent',
  }).catch((err) => console.warn('[SHARELOC LOG ERROR]', err.message));
}
```

---

### C-2. Isolasi Tenant pada Kunci Cooldown Alert (Anti-Cross-Tenant Throttling)

**Before** (`src/services/alert.service.ts:79-84`):
```typescript
private getCooldownKey(payload: AlertPayload): string {
  if (payload.type === AlertType.THIRD_PARTY_OUTAGE && payload.provider) {
    return `${payload.type}:${payload.provider}`;
  }
  return payload.type;
}
```

**After**:
```typescript
private getCooldownKey(payload: AlertPayload): string {
  const scope = payload.tenantId || 'global';
  if (payload.type === AlertType.THIRD_PARTY_OUTAGE && payload.provider) {
    return `${scope}:${payload.type}:${payload.provider}`;
  }
  return `${scope}:${payload.type}`;
}
```

---

### C-3. Bounded Capacity pada Memory Notification Logs (Anti-Memory Leak)

**Before** (`src/services/notification-delivery.service.ts:39-40`):
```typescript
// In-memory fallback saat DB offline (unbounded)
const memoryNotificationLogs: any[] = [];
```

**After**:
```typescript
const memoryNotificationLogs: any[] = [];
const MAX_MEMORY_NOTIFICATION_LOGS = 500;

function appendMemoryNotificationLog(log: any): void {
  memoryNotificationLogs.push(log);
  while (memoryNotificationLogs.length > MAX_MEMORY_NOTIFICATION_LOGS) {
    memoryNotificationLogs.shift(); // FIFO eviction
  }
}
```

---

### C-4. Penghapusan Default `DEFAULT_TENANT_ID` pada Signature Publik FollowUpService

**Before** (`src/services/follow-up.service.ts:1674`):
```typescript
// Mengizinkan pemanggilan tanpa tenantId yang berisiko cross-tenant silent fall-through
public async processDueFollowUps(tenantId: string = DEFAULT_TENANT_ID): Promise<number> { ... }
public async executeFollowUp(fu: any, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> { ... }
```

**After**:
```typescript
// Mewajibkan tenantId eksplisit di level kompilasi
public async processDueFollowUps(tenantId: string): Promise<number> { ... }
public async executeFollowUp(fu: any, tenantId: string): Promise<boolean> { ... }
```

---

## D. KATALOG REUSE & KOMPONEN BERSAMA

1. **`shareloc-signal.service.ts` (`computeSharelocSignal`, `isFriendlyHoursWib`)**:
   - Evaluator murni independen berbasis waktu dan status yang siap digunakan oleh modul UI kartu dashboard staf maupun cron worker tanpa dependensi DB.
2. **`notification-delivery.service.ts` (`NotificationDeliveryService.send`)**:
   - Pipa pengiriman notifikasi terpadu (WhatsApp / Telegram / System) yang sudah menangani normalisasi E.164 dan idempotensi otomatis; siap dipakai oleh semua cron reporting baru.
3. **`web-push.service.ts` (`sendPushToRole`, `sendPushToStaff`)**:
   - Engine Web Push standar W3C yang mendukung pengiriman multi-perangkat per-staf dan penanganan otomatis *pruning* token 410/404.
4. **`staff-notification-config.ts` (`getStaffNotificationConfig`)**:
   - Helper pembacaan konfigurasi notifikasi terapis yang ter-cache dengan aman dan siap dipakai oleh endpoint pengaturan staf.

---

## E. FILE YANG BELUM DIBACA & BLIND SPOTS

1. **`src/lifecycle/background-crons.ts` (Modul 05 / 16)**:
   - Pola scheduling interval pemanggilan `processDueFollowUps` dan `sweepPreVisitBriefs` berada di modul background lifecycle.
2. **`src/services/waba-optout.service.ts` (Modul 06 / 10)**:
   - Logika pembatalan massal follow-up saat pelanggan mengirim kata kunci "STOP" diperiksa di modul WABA opt-out.
3. **`packages/admin-dashboard/src/components/live-chat/LiveChatMonitor.tsx`**:
   - Komponen UI frontend yang merender kartu pengingat shareloc dan dialog edit custom follow-up (masuk cakupan Fase S5).

---

## F. RISIKO FMEA & MATRIKS REGRESI

| Potensi Kegagalan | Dampak Kegagalan | Keparahan (S) | Probabilitas (O) | Deteksi (D) | RPN | Rencana Mitigasi Fondasional |
|---|---|---|---|---|---|---|
| **Pesan Shareloc Ghost (Outbound Tak Tercatat)** | Pengingat terkirim ke customer tapi tidak tampil di Live Chat; echo memicu takeover palsu. | 8 | 5 | 3 | **120** | Tautkan pengiriman shareloc ke `messageService.logMessage` & `registerInFlightBotOutbound` (FN-02). |
| **Cross-Tenant Alert Throttling** | Insiden server di Tenant A menyebabkan peringatan outage di Tenant B tertahan selama 5 menit. | 8 | 3 | 4 | **96** | Sertakan `tenantId` pada pembentukan cooldown key `AlertService` (FN-07). |
| **Regresi Perubahan God Object Follow-up** | Modifikasi kecil pada template review H+1 merusak logika penjadwalan repeat-order 3 bulan. | 7 | 4 | 3 | **84** | Dekomposisi modular `follow-up.service.ts` ke dalam sub-service independen (FN-01). |
| **Kebocoran Kunci Privat VAPID** | File `storage/vapid_keys.json` terbaca oleh pihak tidak berhak; notifikasi push palsu dapat dipicu. | 7 | 2 | 5 | **70** | Wajibkan konfigurasi via ENV di production atau enkripsi file storage (FN-05). |
| **RAM Bloat pada Memory Notification Log** | Penumpukan array memori saat database down dalam waktu lama memicu degradasi server. | 6 | 3 | 3 | **54** | Pasang bounded FIFO limit 500 entri pada `memoryNotificationLogs` (FN-04). |

---

## G. REKOMENDASI TINDAKAN & PRIORITAS IMPLEMENTASI

### Prioritas 1 (P1) — Keutuhan Audit Trail & Pemisahan God Object
1. **Penutupan Celah Shareloc Ghost Logging (FN-02)**: Hubungkan `sharelocReminderService.sweep` ke `messageService.logMessage` dan `registerInFlightBotOutbound`.
2. **Dekomposisi Modular `follow-up.service.ts` (FN-01)**: Pisahkan ke dalam modul-modul mandiri:
   - `follow-up-template.service.ts` (Template DB & rolling resolver)
   - `follow-up-scheduler.service.ts` (Penjadwalan NO_PURCHASE & NEXT_TREATMENT)
   - `follow-up-executor.service.ts` (Pengiriman fisik WAHA / WABA & lease claim)
   - `follow-up-reconciler.service.ts` (Winback, sweep, & lost customer cron)
3. **Pemisahan Formatter `staff-notification.service.ts` (FN-03)**: Ekstrak logika penyusunan teks pesan penugasan dan navigasi peta ke unit terpisah.

### Prioritas 2 (P2) — Isolasi Tenant & Keamanan Kredensial
1. **Isolasi Tenant Cooldown Alert (FN-07)**: Ubah `getCooldownKey` di `alert.service.ts` agar selalu menyertakan `tenantId`.
2. **Wajibkan Parameter `tenantId` Eksplisit (FN-06)**: Hapus default value `= DEFAULT_TENANT_ID` pada seluruh method public di `follow-up.service.ts`.
3. **Proteksi Kunci VAPID (FN-05)**: Cegah penulisan plaintext private key di lingkungan produksi.
4. **VAPID Subject Multi-Tenant (FN-08)**: Buat subjek VAPID dinamis berdasarkan identitas brand tenant.

### Prioritas 3 (P3) — Bounded Capacity & Type Safety
1. **Bounded FIFO pada `memoryNotificationLogs` (FN-04)**: Terapkan batas maksimal 500 entri.
2. **Pembersihan Type-Cast Prisma (FN-09)**: Hapus cast `(prisma as any)` di `shareloc-reminder.service.ts`.
3. **Transaksi Atomik Dual-Write Shareloc (FN-10)**: Bungkus update timestamp preferensi dan percakapan dalam `prisma.$transaction`.

---

## Catatan Koreksi Pasca-Review (2026-11-09)

- **FN-11** dikoreksi: file yang benar adalah `src/config/staff-chat-config.ts` (bukan `staff-notification-config.ts`), default jam **07:00–21:00 WIB** (bukan 08:00), dengan catch kosong di baris 82-84. File ditambahkan ke tabel cakupan; total menjadi **11 file / 6.033 baris**.
- **FN-06** dikoreksi: jumlah method publik dengan default `DEFAULT_TENANT_ID` adalah **tepat 15** (bukan "lebih dari 15").
- **Verifikasi ulang**: `follow-up.service.ts` 2.895 baris, `staff-notification.service.ts` 1.101 baris, dan lokasi shareloc/alert tetap cocok dengan kode aktual.
