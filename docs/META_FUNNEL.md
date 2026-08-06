# Meta Funnel & Conversions API (CAPI) — Referensi Arsitektur

> Dokumen rujukan untuk memahami **alur event Meta (funnel konversi)** dari klik iklan
> sampai pembayaran, sumber kode, aturan dedup, dan konfigurasi tenant.
> Berlaku untuk tenant WAHA maupun WABA (CAPI tidak tergantung provider WhatsApp).

---

## 1. Gambaran End-to-End

Satu sumber atribusi adalah **`AdClick`** (dibuat dari `POST /api/tracking/click` saat user membuka landing page iklan). `AdClick.trackingCode` (2 karakter, contoh `a7`) menjadi **pengisi `event_id`** untuk seluruh event CAPI — Meta men-dedup event ber-`event_id` sama (lihat §4).

| Langkah | Alur |
|---|---|
| 1. Klik iklan Meta | `fbclid`/UTM/`_fbp`/`_fbc` dipertahankan (same-origin). |
| 2. Landing page (`/{slug}` atau `/go`) | `PageView` (klien, selalu) → `ViewContent`/`Search` (onload) → klik CTA → `AddToCart`. |
| 3. `POST /api/tracking/click` | Buat `AdClick` + `tracking_id` (initiate). |
| 4. Customer buka WhatsApp & kirim "Promo[a7] halo" | [webhook.route.ts] a) attribution link `AdClick`→customer; b) event `Contact` (first contact); c) strip "Promo[xx]" dari body. |
| 5. State machine `AWAITING_LOCATION → AWAITING_INTEREST` | Customer jadi MQL (memenuhi kualifikasi) → event **`Lead`** (MQL) di [customer.service.ts]. |
| 6. Bot kirim form reservasi (`RESERVATION_SENT`) | → event **`InitiateCheckout`** di [interest.ts]. |
| 7. Customer isi & kirim form reservasi | → status reservasi `pending`. |
| 8. Pembayaran terdeteksi (admin `Tandai Lunas` ATAU customer kirim pesan "Payment <nominal>") | → event **`Purchase`** (value IDR; window 7 hari). |

**Ringkasan event CAPI:**

| Event | Nama | Kapan terpicu | Sumber |
|---|---|---|---|
| `PageView` | (klien) | setiap load landing | `src/landing/public/go.html` / HTML tenant |
| `ViewContent` / `Search` | (klien) | onload setelah PageView | `src/services/html-sanitizer.ts` |
| `AddToCart` | (klien) | klik `<a id="wa-cta">` | `src/routes/landing.route.ts` |
| `Contact` | first contact | pesan WhatsApp pertama masuk (new customer) | `src/routes/webhook.route.ts` |
| `Lead` | MQL | customer ter-promote jadi MQL | `src/services/customer.service.ts` |
| `InitiateCheckout` | checkout | form reservasi dikirim (bot atau admin) | `src/state-machine/handlers/interest.ts`, `src/services/live-chat.service.ts` |
| `Purchase` | purchase | deteksi pesan "Payment <nominal>" ATAU admin tandai lunas | `src/services/purchase-detection.service.ts`, `src/routes/admin.route.ts` |

> Sejak refactor funnel, **`Lead` hanya terpicu saat MQL** (tidak lagi di admin confirm). Event `Contact` menggantikan peran first-contact. Jangan kembalikan `Lead` saat confirm.

---

## 2. Konfigurasi Tenant (Database-driven)

Semua kata kunci funnel **konfigurasi per tenant** — tidak di-hardcode di kode (aturan SaaS-readiness).

| Kolom tenant (`tenants`) | Default | Arti | Dipakai di |
|---|---|---|---|
| `format_checkout` | `list untuk reservasi :` | Header kalimat form reservasi | `persona.ts` (`reservationFormRequest`), `interest.ts` (deteksi form input), `live-chat.service.ts` (deteksi admin kirim form) |
| `format_purchase` | `Payment` | Kata kunci untuk mendeteksi pesan bayar | `persona.ts` (`reservationConfirmed`), `purchase-detection.service.ts` (trigger Purchase) |
| `format_value` | `Treatment = %VALUE%` | Template label nilai nominal | `persona.ts` |

Dibaca lewat `getTenantCapiFormats(tenantId)` di [capi.service.ts] (fallback default bila DB offline).

**Kredensial CAPI** (per tenant, di UI Settings → **Meta Pixel & CAPI**):
- `meta_pixel_id` — ID pixel (fallback env `FB_PIXEL_ID`).
- `meta_capi_access_token` — token di-encrypt AES-256-GCM (dibaca via decrypt; fallback env `FB_CAPI_ACCESS_TOKEN`).

---

## 3. Dedup & Event ID

- `sendCapiEvent` mengisi `eventData.event_id = adClick.trackingCode` untuk **semua** event (Lead, InitiateCheckout, Purchase, dst).
- **Manfaat:**
  - Purchase yang ke-trigger ganda (mis. admin `Tandai Lunas` DAN deteksi pesan "Payment") tidak dobel-convert.
  - Pixel klien (di landing) vs server-side CAPI — pakai konsep `eventID` yang sama saat deliver sehingga Meta men-dedup.
- **Anti dobel-Purchase:** setelah Purchase terpicu, `reservations.purchase_event_sent_at` diisi `now()`. Dashboard tombol `Tandai Lunas` **nonaktif 7 hari** (`PURCHASE_DEDUP_WINDOW_MS = 7*24h`) agar operator tidak menandai lunas berkali-kali untuk order yang sama, tanpa menghalangi repeat order (7 hari kemudian).

> Catatan: nilai `PURCHASE_DEDUP_WINDOW_MS` di `capi.service.ts` dan logika tanggal di `Reservations.tsx` (7*24*60*60*1000) harus selalu selaras.

---

## 4. Alur Deteksi "Payment" (anti false-positive)

`purchase-detection.service.ts` → `maybeFirePurchaseEvent(...)`:

1. Teks pesan **mengandung kata kunci** `format_purchase` (default `payment`) — case-insensitive.
2. **Dan** pesan berisi **nominal rupiah** (di-parse `extractRupiahAmount`: pola `Rp...`, `...rb/ribu`, digit) dalam rentang wajar 5.000–100.000.000. **Tanpa nominal → skip** (jalur admin tetap).
3. Cari reservasi terakhir non-cancelled milik customer (ikut `adClick`).
4. Jika `purchase_event_sent_at` dalam 7 hari → skip (sudah pernah).
5. Kirim `Purchase` dengan nilai nominal pesan (fallback `resolveTreatmentValue` dari detail treatment) + catat `purchase_event_sent_at`.

Aturan (2) menjaga pertanyaan seperti "cara Payment?" / "Payment gimana?" **tidak** salah jadi Purchase — pesan bayar yang valid selalu menyertakan nominal.

---

## 5. Jalan ke Depan / Backlog (opsional)

- Retry queue CAPI (saat ini silent-fail + circuit breaker; belum ada retry).
- `test_event_code`/`external_id` (shadow mode Meta) per tenant bila diinginkan.
- Pemindahan nilai `Purchase`: apakah selalu dari nominal pesan atau murni `resolveTreatmentValue` — diesuaikan kebutuhan akurasi laporan.

---

## 6. Tautan Terkait

- `src/services/capi.service.ts` — CAPI core (kirim event, event_id, PII hash, circuit breaker)
- `src/services/purchase-detection.service.ts`
- `src/routes/webhook.route.ts`, `src/routes/admin.route.ts`, `src/routes/landing.route.ts`
- `src/state-machine/handlers/interest.ts`, `src/services/live-chat.service.ts`, `src/services/customer.service.ts`
- `prisma/schema.prisma` (`tenants`, `ad_clicks`, `reservations`); migration `20260816000000_add_purchase_event_sent_at`
- `packages/admin-dashboard/src/pages/tenant/Reservations.tsx`