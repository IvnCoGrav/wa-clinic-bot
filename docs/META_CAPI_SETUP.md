# Panduan Setup Meta Conversions API (CAPI) & Kunci Enkripsi Token

Panduan ini adalah versi **terverifikasi untuk repo & server ini** (bukan panduan generik).
Semua langkah sudah dicek terhadap kondisi server produksi (`43.157.197.148`).

## Ringkasan Arsitektur

- **Sumber kebenaran kredensial CAPI = database per-tenant** (kolom `tenants.meta_pixel_id`
  dan `tenants.meta_capi_access_token`), diisi lewat Admin Dashboard.
- **Fallback env** `FB_PIXEL_ID` / `FB_CAPI_ACCESS_TOKEN` di `.env` dipakai HANYA jika
  kolom DB kosong.
- Access token disimpan **terenkripsi AES-256-GCM** di DB dengan kunci
  `WABA_TOKEN_ENCRYPTION_KEY` (`src/utils/encryption.ts`). Kunci HARUS 32-byte
  (64 karakter hex). Tanpa kunci yang valid, app **gagal boot** (`getKey()` throw).
- Event yang dikirim ke Meta: `Contact` (first contact), `Lead` (MQL),
  `InitiateCheckout` (form reservasi dikirim), `Purchase` (deteksi pembayaran),
  dengan `event_id = adClick.trackingCode` (dedup 7 hari via `purchase_event_sent_at`).

## Status Server Saat Ini (verified 2026-08-16)

| Item | Status |
|---|---|
| `WABA_TOKEN_ENCRYPTION_KEY` di `.env` server | **SUDAH ADA** |
| Pixel ID di DB tenant (`meta_pixel_id`) | `1382300863013984` |
| CAPI Access Token di DB tenant (terenkripsi) | **SUDAH TERISI** |
| `MAX_INBOUND_MESSAGE_AGE_SECONDS` di `.env` | belum ada (default kode 180s — opsional) |

> **Kesimpulan: CAPI sudah terkonfigurasi penuh.** Panduan di bawah dipakai untuk
> verifikasi, atau bila suatu saat perlu re-konfigurasi dari nol.

---

## Langkah 1 — Koneksi ke Server

> Server ini TIDAK pakai `ssh root@IP`. Akses yang benar:

```bash
ssh -p 1403 ubuntu@43.157.197.148
# atau pakai alias yang sudah dipasang:
ssh klinik-server
```

Folder proyek di server: `/opt/wa-clinic-bot` (bukan `~/wa-clinic-bot`):

```bash
cd /opt/wa-clinic-bot
```

## Langkah 2 — Verifikasi Status (read-only, aman)

```bash
# 1. Kunci enkripsi sudah terpasang?
grep -c "^WABA_TOKEN_ENCRYPTION_KEY=" .env        # harus output: 1

# 2. Kredensial CAPI di DB tenant (t|t = pixel + token terisi)
docker compose exec -T postgres psql -U postgres -d wa_clinic_db -t -A \
  -c "SELECT id, (meta_pixel_id IS NOT NULL), (meta_capi_access_token IS NOT NULL) FROM tenants;"
```

Output `default-tenant|t|t` berarti CAPI aktif dan token terenkripsi dengan
kunci yang **sekarang** ada di `.env`.

## Langkah 3 — ⚠️ JANGAN GANTI `WABA_TOKEN_ENCRYPTION_KEY` (Peringatan Tegas)

Jika key diganti **setelah** token tersimpan di DB:

- `decryptSecret()` gagal (AES-GCM auth tag mismatch → throw), sehingga CAPI
  mati total sampai token disimpan ulang dari dashboard.
- Hal yang sama berlaku untuk `waba_access_token` (WABA driver) — ikut rusak.

**Kapan boleh ganti key:** hanya jika sekaligus **re-input ulang semua token**
(CAPI + WABA) dari Admin Dashboard, dan pastikan tidak ada data lama yang
masih dipakai. Generate key baru: `openssl rand -hex 32`.

## Langkah 4 — Env Tambahan (Opsional)

`MAX_INBOUND_MESSAGE_AGE_SECONDS` mengatur batas usia pesan masuk yang diproses
bot (default kode sudah 180 detik — mencegah flood pesan lama saat QR scan /
reconnect). Hanya perlu ditambahkan jika ingin mengubah nilai default:

```bash
nano .env   # tambahkan di baris bawah:
# MAX_INBOUND_MESSAGE_AGE_SECONDS=180
```

**Cara menerapkan perubahan `.env` yang BENAR:**

```bash
docker compose up -d --no-deps app
```

> ⚠️ `docker compose restart app` TIDAK membaca ulang `.env` — env_file dibaca
> saat container **dibuat**. Perlu `up -d` agar container di-recreate dengan
> env baru. (Jika hanya mengubah env, `git pull` TIDAK diperlukan; `git pull`
> hanya wajib bila ada perubahan kode di repo.)

## Langkah 5 — Simpan / Ubah Kredensial CAPI di Dashboard

1. Login ke Admin Dashboard (URL admin sesuai `ADMIN_DOMAIN`, atau
   `http://<IP>:3000/admin` saat tanpa domain).
2. Buka **Operational Settings** → panel **Meta Pixel & CAPI**.
3. Isi:
   - **Meta Pixel ID**: `1382300863013984`
   - **CAPI Access Token**: token `EAAR...` (tampilan UI di-mask
     `••••••••••••`; kosongkan field jika token tidak diubah).
4. Klik **Simpan Kredensial CAPI** → notifikasi hijau "Konfigurasi Meta Pixel &
   CAPI tersimpan."
5. Opsional: toggle **Auto-send Purchase CAPI** (on = kirim `Purchase` langsung
   ke Meta; off = moderasi manual di Meta CAPI Queue).

Token disimpan terenkripsi AES-256-GCM ke kolom `tenants.meta_capi_access_token`
(`src/routes/admin/settings.subroute.ts`, endpoint `PATCH /api/admin/capi-config`).

## Langkah 6 — Verifikasi

1. **Meta CAPI Health & Live Tester**: Admin Dashboard →
   `/admin/meta-click-catcher` → bagian "Meta CAPI Health & Live Tester":
   - Badge **Pixel ID OK** dan **Access Token OK** harus hijau.
   - **Circuit: CLOSED** = tidak ada fallback rate-limit/error Meta.
   - Klik **Kirim Test Event CAPI** → Meta harus menerima (test event terlihat
     di Events Manager dalam hitungan detik).
2. **Meta CAPI Queue**: `/admin/meta-capi-queue` — melihat antrean event
   `Purchase` yang menunggu moderasi (bila auto-send nonaktif).
3. **Log bot**: `docker compose logs --tail 50 app` — cari baris
   `[CAPI]` tanpa error 4xx/5xx dari Meta.

## Catatan Keamanan

- `.env` server berisi kredensial asli dan **gitignored** — jangan pernah
  commit ke git, jangan tempel nilai asli di dokumen/chat yang bisa terekspos.
- Rotasi token Meta CAPI aman kapan saja (simpan ulang dari dashboard).
- Rotasi `WABA_TOKEN_ENCRYPTION_KEY` TIDAK aman kecuali re-input semua token
  (lihat Langkah 3).