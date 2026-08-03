# WABA Integration Plan — WhatsApp Business API (Meta Cloud API)

**Status:** Implementasi inti SELESAI (Fase 1-3 & 5; Fase 4 sebagian) — masih menunggu validasi live dengan akun Meta resmi & test number.
**Tanggal:** 2026-08-02 (rencana) / 2026-08-09 (status update implementasi)
**Gate:** Core state machine, BullMQ queue, AI Router shadow mode, follow-up engine semua jalan production via WAHA

---

## Daftar Isi

1. Keputusan Bisnis Terkunci
2. Koreksi Teknis yang Masuk
3. Interface `WhatsAppGateway`
4. Webhook Normalization
5. Peta 24h Window
6. Mekanisme Opt-in Marketing
7. Skema DB
8. Matriks Risiko
9. Fase Implementasi
10. Catatan Operasional

---

## 1. Keputusan Bisnis Terkunci

| Poin | Keputusan |
|---|---|
| Model | **C. Coexist per-tenant** — tenant pilih WAHA/WABA di DB, termasuk pengguna sendiri |
| Nomor WhatsApp | Terserah tenant/user; user sendiri masih di WAHA, WABA sebagai persiapan worst case |
| Meta Business Verification | Urusan tenant — tidak ubah struktur code, hanya beda tier limit |
| Follow-up engine | **WAHA: bebas teks + rolling 3 variasi** (seperti sekarang). **WABA: patuh regulasi Meta** → HSM template untuk outbound >24 jam |
| Typing indicator WABA | Panggil endpoint resmi mark-as-read + `typing_indicator` (bukan no-op), cap 25 detik |
| BSP | **Meta langsung** (`graph.facebook.com`) |
| Timeline | Sebelum SaaS launch — user sendiri kemungkinan pakai juga sebelum dilempar ke client |
| Graph API version | Pin **v25.0** (minimum v20.0+), cek deprecation 1x/tahun (~2 tahun siklus Meta) |
| Consent prompt | **Hanya tenant WABA** (zero regresi ke WAHA) |
| Customer existing | Default `false` + organik + admin manual (campaign broadcast = circular problem) |

---

## 2. Koreksi Teknis yang Masuk

### Typing Indicator WABA (Dikoreksi)

Cloud API resmi **punya** typing indicator — bukan no-op. Endpoint:

```
POST /{phone_number_id}/messages
{
  "messaging_product": "whatsapp",
  "status": "read",
  "message_id": "<incoming_message_id>",
  "typing_indicator": { "type": "text" }
}
```

Batasan yang masuk ke desain:

| Aspek | WAHA | WABA |
|---|---|---|
| `messageId` parameter | Diabaikan | Wajib — harus dari pesan **incoming** |
| Durasi max | Bebas | **25 detik** (hard, otomatis hilang) |
| Tipe | Tersedia semua | Cuma `text` |
| Skip kondisi | — | `incomingMessageId` kosong (outbound-only) → skip graceful, jangan error |

### Klaim Risiko Banned (Dihaluskan)

> **0% risiko dibanned karena terdeteksi sebagai bot** — Cloud API memang channel resmi untuk otomasi. **Tetap bisa direstriksi/dibatasi permanen** kalau melanggar WhatsApp Business Messaging Policy (marketing tanpa opt-in, spam report berulang, Quality Rating merah berkepanjangan).

### Redundansi Mark-as-Read (Ditambah)

`sendTypingIndicator` untuk WABA memanggil mark-as-read + typing sekaligus. Kalau `markAsRead()` standalone dipanggil berurutan untuk messageId yang sama → **no-op** (state in-memory per-message, TTL singkat). Hemat quota/rate limit.

---

## 3. Interface `WhatsAppGateway`

```typescript
export interface SendResult {
  success: boolean;
  messageId?: string;
  provider: 'WAHA' | 'WABA';
  rawResponse?: unknown;
  error?: { code: string; message: string; isRateLimit?: boolean };
}

export interface TemplateParam {
  type: 'text' | 'currency' | 'date_time';
  value: string;
}

export interface WhatsAppGateway {
  readonly providerType: 'WAHA' | 'WABA';

  // Valid kedua provider (WABA hanya sukses dalam 24h window)
  sendTextMessage(to: string, text: string): Promise<SendResult>;

  // WABA: HSM template resmi. WAHA: fallback string interpolation
  sendTemplateMessage(
    to: string,
    templateName: string,
    languageCode: string,
    components: Array<{
      type: 'header' | 'body' | 'button';
      parameters: TemplateParam[];
    }>
  ): Promise<SendResult>;

  sendImageMessage(to: string, imageUrl: string, caption?: string): Promise<SendResult>;

  // WAHA: API typing asli. WABA: endpoint mark-as-read + typing_indicator
  // incomingMessageId diabaikan untuk WAHA
  sendTypingIndicator(to: string, incomingMessageId?: string, durationMs?: number): Promise<void>;

  markAsRead(messageId: string): Promise<void>;
}
```

### Factory Per-Tenant

```typescript
function getGateway(tenantId: string): WhatsAppGateway {
  const provider = tenantRepo.getProvider(tenantId);
  return provider === 'WABA' ? wabaGateway : wahaGateway;
}
```

---

## 4. Webhook Normalization

### Dua Endpoint Terpisah → Satu DTO

| Aspek | WAHA | WABA |
|---|---|---|
| Endpoint | `POST /api/webhook/waha` | `GET /api/webhook/waba` (hub.challenge verify) + `POST /api/webhook/waba` |
| Auth | Header API key | `X-Hub-Signature-256` HMAC-SHA256 + verify token |
| Sender ID | JID `62812...@c.us` / `@lid` | `wa_id` polos `62812...` |
| Media | URL langsung / base64 | `media_id` → download via Graph API + Bearer token sebelum expired |
| Location | `{ latitude, longitude }` | `{ location: { latitude, longitude, name, address } }` |

### Unified Inbound DTO

```typescript
export interface NormalizedInboundMessage {
  tenantId: string;
  provider: 'WAHA' | 'WABA';
  messageId: string;
  fromNumber: string;        // E.164 tanpa suffix
  timestamp: number;
  type: 'text' | 'location' | 'image' | 'unknown';
  text?: string;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  mediaUrl?: string;
  rawPayload: unknown;
}
```

### Risiko Kalau Normalisasi Tidak Sempurna

- Nomor `@c.us` tercampur di DB → query customer fail
- `payload.text` padahal Meta pakai `messages[0].text.body` → pesan hilang
- `media_id` masuk kolom `media_url` tanpa download → gambar pricelist rusak
- Lokasi ke-miss → ongkir gagal hitung

---

## 5. Peta 24h Window

| Stage | >24 jam? | WAHA | WABA |
|---|---|---|---|
| Percakapan aktif / reservasi | ❌ dalam window | Teks bebas | Teks bebas `sendTextMessage()` |
| Reminder H-treatment (pagi) | ⚠️ sering | Bebas + rolling | HSM template (**Utility**) |
| Review H+1 | 🔴 pasti | Bebas + rolling | HSM template |
| Belum-purchase H+3/7/14 | 🔴 pasti | Bebas + rolling | HSM template (**Marketing**) |
| Treatment lanjutan bulan 1/2/3 | 🔴 pasti | Bebas + rolling | HSM template (**Marketing**) |

**Strategi HSM**: 1 template per stage (9 total), variasi lewat `{{1}}`, `{{2}}` (nama, jam, treatment). Rolling 3 variasi di WABA berarti 27 template — terlalu mahal untuk maintenance.

---

## 6. Mekanisme Opt-in Marketing

### Skema Kolom `Customer`

```prisma
model Customer {
  // ... field existing
  marketing_opt_in        Boolean  @default(false)
  marketing_opt_in_at     DateTime?
  marketing_opt_in_source String?  // "RESERVATION_CONFIRM" | "CHAT_PROMPT" | "ADMIN_MANUAL"
}
```

### Titik Pengumpulan Consent

| Titik | Lokasi | Kapan Aktif |
|---|---|---|
| Chat prompt pasca-konfirmasi | Setelah `RESERVATION_CONFIRMED`, sebelum follow-up dijadwalkan | **1x per customer, hanya tenant WABA** |
| Admin dashboard | Detail customer | Customer existing / koreksi manual |
| Opt-out keyword | Semua state (global handler) | Kapan saja, **hanya tenant WABA** |

Chat prompt (WABA only):
> "Boleh kami kirim pengingat jadwal & info perawatan berkala via WhatsApp? Balas YA / TIDAK."

### Audit Trail Consent

Bukti opt-in = kombinasi:
1. `Customer.marketing_opt_in_at` + `Customer.marketing_opt_in_source`
2. `messages` table (cross-ref `customer_id` + timestamp berdekatan) → pesan "YA" asli tersimpan

Tidak perlu tabel audit terpisah.

### Opt-out Keywords (Scope: WABA Only)

| Keyword | Aksi |
|---|---|
| `STOP`, `UNSUBSCRIBE`, `BERHENTI`, `BATAL PROMO` | Set `marketing_opt_in = false` + ack reply + batalkan semua follow-up terjadwal |

Handler opt-out **hanya aktif untuk tenant berprovider WABA**. Customer WAHA tidak punya `marketing_opt_in`, tidak terpengaruh.

### Gatekeeper di Follow-up Engine

```typescript
if (provider === 'WABA' && templateCategory === 'MARKETING') {
  if (!customer.marketing_opt_in) {
    logger.info(`[FollowUp] Skipped WABA Marketing HSM: NO_OPT_IN`);
    return { status: 'SKIPPED', reason: 'NO_OPT_IN' };
  }
}
```

| Stage | Kategori Meta | Butuh opt-in? |
|---|---|---|
| Reminder H-treatment | UTILITY | ❌ (cukup reservasi aktif) |
| Review H+1 | UTILITY | ❌ |
| Belum-purchase H+3/7/14 | MARKETING | ✅ Wajib |
| Treatment lanjutan bulan 1/2/3 | MARKETING | ✅ Wajib |

Customer existing WAHA default `false`. Organic + admin manual, tidak campaign broadcast (circular problem: broadcast minta opt-in = butuh opt-in dulu).

---

## 7. Skema DB

### Model `Tenant` (tambahan field)

```prisma
enum WhatsappProvider { WAHA WABA }

model Tenant {
  // ... field existing
  whatsapp_provider         WhatsappProvider  @default(WAHA)
  waha_session_id           String?           @default("default")
  waba_phone_number_id      String?
  waba_business_account_id  String?
  waba_access_token         String?           // WAJIB encrypt AES, key dari env
  waba_webhook_verify_token String?
}
```

### Model `Customer` (tambahan field)

```prisma
model Customer {
  // ... field existing
  marketing_opt_in        Boolean    @default(false)
  marketing_opt_in_at     DateTime?
  marketing_opt_in_source String?    // "RESERVATION_CONFIRM" | "CHAT_PROMPT" | "ADMIN_MANUAL"
}
```

Token WABA **wajib di-encrypt** (AES, key dari env). Jangan plaintext di DB. Catatan: review security `ADMIN_API_KEY` (PRD, belum direview independen) — schedule bareng.

---

## 8. Matriks Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Approval template Meta (jam-hari, kata terkunci) | Follow-up WABA macet kalau template belum approve | Submit template lebih awal; status PENDING/REJECTED di dashboard; fallback: skip + log + notify admin |
| Media `media_id` (bukan URL) | Gambar masuk rusak | Download via Graph API + Bearer, simpan URL internal dengan TTL |
| `hub.challenge` GET | Setup webhook Meta gagal | Endpoint GET handle `hub.mode`/`hub.verify_token`/`hub.challenge` |
| Error `131026` (di luar 24h window) | Kirim teks bebas ditolak Meta | Driver WABA terima error, follow-up service switch ke HSM template |
| Biaya Marketing category | Tagihan membengkak dari follow-up otomatis | Estimasi volume riil sebelum launch; budget cap per tenant |
| Rate limit tier awal | 1K/hari tidak cukup kalau follow-up massal | Hitung volume customer + follow-up harian; naik tier via quality rating |
| Quality Rating merah berkepanjangan | Nomor direstriksi permanen | Monitoring; stop marketing kalau quality turun ke Yellow |
| Opt-in tidak lengkap | Follow-up Marketing ditolak / spam report | Gatekeeper wajib cek `marketing_opt_in` sebelum kirim HSM Marketing |
| Graph API deprecation | Endpoint mati tiba-tiba | Pin versi spesifik (v25.0); cek deprecation notice 1x/tahun (~2 tahun siklus Meta) |

### Testing Tanpa Verifikasi Penuh

WABA bisa diuji pakai **Meta Test Number** (sandbox, gratis di Developer Portal) — cocok untuk phase shadow mode.

---

## 9. Fase Implementasi

| Fase | Isi | Keluar | Risiko | Status |
|---|---|---|---|---|
| **1. Abstraction** | Interface `WhatsAppGateway`, wrap `waha/client.ts` → `WahaGatewayDriver`, factory default WAHA, `MockGateway` untuk test | 0 perubahan behavior, test tetap pass | Rendah | ✅ Selesai (`src/integrations/whatsapp/gateway.types.ts`, `factory.ts`) |
| **2. WABA core** | `WabaGatewayDriver` (Graph API v25), route `GET/POST /api/webhook/waba` + verifikasi token, webhook normalizer | Kirim/terima via Test Number | Rendah | ✅ Selesai (driver + webhook + normalizer + media; test `waba-driver-and-webhook.test.ts`) |
| **3. Multi-tenant config** | Schema `whatsapp_provider` + kredensial WABA (encrypt AES-256-GCM), factory resolve per tenant | Tenant bisa switch provider | Rendah | ✅ Selesai (toggle + status via `GET/PATCH /api/admin/whatsapp-provider`) |
| **4. Template engine** | `follow-up.service.ts` cabang per provider, mapping stage → HSM, status template (`waba-template.service.ts`), consent gatekeeper (`waba-consent.service.ts`) + opt-out handler | Follow-up WABA jalan patuh regulasi | Sedang | ⚠️ Sebagian — service & consent ada, approval template live belum tervalidasi |
| **5. Shadow + dashboard** | Toggle provider di Settings, status indicator (WAHA session vs WABA token + template status), uji paralel kedua provider | Production multi-tenant ready | Sedang | ✅ Selesai (panel Settings → WhatsApp Provider; status indicator live) |

**Safety net**: default tetap WAHA. WABA aktif hanya kalau tenant eksplisit pilih. Feature flag per tenant, pola `AI_ROUTER_SHADOW_MODE`.

---

## 10. Catatan Operasional

- **Graph API deprecation**: pin v25.0. Meta deprecate versi lama ~2 tahun. Cek notice minimal 1x/tahun.
- **WAHA regression test**: semua fase test terhadap alur WAHA existing — zero regression wajib.
- **Security review**: `waba_access_token` encrypt review bareng `ADMIN_API_KEY` (belum direview independen).
- **Follow-up engine existing (WAHA)**: tidak boleh terpengaruh sama sekali oleh penambahan WABA — abstract dulu, baru tambah driver.
