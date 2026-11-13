# Laporan Ringkas Remediasi Audit F0–F6

> **Tanggal:** 2026-11-13
> **Sumber kebenaran status:** `docs/plans/REMAINING_BACKLOG_2026-11-09.md` + `docs/audit/2026-11-10/backlog-evidence.json`
> **Gerbang bukti:** `npm run verify:backlog` → **PASS** (81 item FIXED baru ber-bukti)

---

## 1. Angka Akhir

| Metrik | Nilai |
|---|---|
| Total temuan register | **268** |
| **FIXED terverifikasi** | **239** |
| UNVERIFIED | 4 |
| DUPLICATE | 5 |
| KNOWN (ber-justifikasi) | 4 |
| **OPEN** | **16** |
| Baseline historis beku | 158 FIXED |
| Full suite terakhir | **7.358 test / 7.328 lulus / 2 gagal pre-existing (#287)** |

Gate F4 belum terpenuhi karena masih ada 16 OPEN + 4 UNVERIFIED.

---

## 2. Yang Sudah Diselesaikan (Bukti per Gelombang)

| Fase/Wave | Commit | Item | Inti perubahan |
|---|---|---|---|
| Fase 0–1 | `995e6013` | Gerbang bukti | `verify:backlog`, manifest, baseline beku, CI gate |
| Fase 2A–2G | `9b775f27` … `daf8ab77` | `S-001`, `W-009`, `A-006`, `C-003`, `K-013`, `A-007`, `K-006`, `Cfg-004`, `I-009`, `Cfg-014`, `C-001`, `S-05`, `C-012`, `I-008`, `M-07`, `A-012`, `K-008` | Triase + perbaikan fondasional |
| W1–W4 | `e9ddc599` … `9ce72e72` | `I-002`, `W-011`, `K-010`, `K-005`, `K-009`, `S-008`, `Ar-009` | Reliability & housekeeping |
| W5A | `bae30469` | `W-006`, `UTL-15`, `CFG-17` | `distributed-kv.ts` (Redis + fallback memori) |
| W5B | `3a62c08e` | `A-011` | `AbortSignal` end-to-end; tidak ada tulis setelah turn dibatalkan |
| W5C | `8c3bc0fd` | `W-010` | Humanizer bubble struktural; hapus frasa hardcode |
| W5D | `0da0fce5` | `I-011` | Kuota + circuit breaker + API key per tenant (ORS/Google/Geocoding) |
| W5E | `e6e264e9` | `Cfg-011` | `GET|PATCH /api/admin/tenant-settings` (Super Admin) |
| W6A | `96252565` | `I-006` | Google Calendar tenant-aware, idempoten, durasi nyata |
| W6B | `482f456f` | `I-007` | Outbox retry Google Contacts + filter tenant |
| W6C | `f8e3faca` | `Ar-005` (sebagian) | 7 route admin → 503 jujur saat DB mati |
| W6D | `5e0330dd` | `S-10` | Artefak audit Fase 5 diregenerasi & dikunci |
| W6E | `4780a231` | `Cfg-017` | Rekonsiliasi klaim dokumen & audit Fase 10 |
| W6F | `f2eb5775` | `S-011` (sebagian) | TTL sesi 7 hari + CSP/header `/admin/*` |
| W6G | `31af8d40` | `S-015` | Secret webhook WAHA per tenant |
| W6H | `5f22031c` | `S-03` | Store trip lintas proses (KV), auto-close worker |
| W7 | `f306d6af` | `Ar-004` (sebagian) | Unique `Staff.phone` & `AdClick.trackingCode` per tenant + migration |
| W8 | `1aae6ebf` | Verifikasi | Migrasi diuji di Postgres 16 ephemeral |

---

## 3. 16 OPEN yang Tersisa — Akar Penghambat

| Kelompok | Item | Penghambat |
|---|---|---|
| **Area dashboard (milik pengguna)** | `S-02`, `S-06`, `S-08`, `S-09`, `S-011` (localStorage), `Cfg-015` | `packages/admin-dashboard/*` berisi WIP belum di-commit (200+ file) |
| **Area landing (milik pengguna)** | `M-02`, `M-03`, `M-04`, `M-05`, `M-06`, `M-10`, `Cfg-012`, sisa `Ar-005` | `src/landing/*`, `src/routes/landing.route.ts`, `landings.subroute.ts` |
| **Skema / migrasi** | `Ar-004` (sisa `LandingPage.slug`) | Butuh routing landing per-host; area landing |
| **Refactor besar** | `Ar-003` | 497 referensi `DEFAULT_TENANT_ID` di 140 file; butuh keputusan produk per seam |

---

## 4. Rencana Menuntaskan (4 Fase)

### Fase A — Migrasi Ar-004 ke staging/produksi (1–2 jam)
Prasyarat: akses staging/produksi + backup.
1. `pg_dump` backup.
2. `npx prisma migrate deploy` (staging → produksi).
3. Drift check `--from-url` harus *empty*.
4. Smoke test: login staf, restore backup, buat AdClick.

### Fase B — Area landing (1–2 hari)
1. `LandingPage.slug` → `@@unique([tenant_id, slug])` + resolusi landing per host/tenant.
2. Ganti `200 + data kosong` di `landings.subroute.ts` menjadi 503 jujur.
3. Perbaiki attribution/CAPI & dokumentasi Meta (`M-02`–`M-10`).

### Fase C — Area dashboard (1–2 hari)
1. `S-011`: token keluar dari `localStorage` (cookie HttpOnly / memory + refresh).
2. `Cfg-015`: hapus hardcode tenant/brand/rekening/koordinat → ambil dari API.
3. `S-02`, `S-06`, `S-08`, `S-09`: perilaku UI staf & validasi.

### Fase D — Ar-003 (2–4 hari)
1. Inventaris 497 referensi → klasifikasi: default sah vs leak lintas tenant.
2. Migrasi per domain service/worker dengan test tenant-isolation.
3. Hapus referensi tersisa setelah pemanggil terakhir dimigrasikan.

**Total realistis: ±1 minggu kerja** dengan review, bukan satu sesi.

---

## 5. Prasyarat dari Pemilik Produk

1. **Commit/push WIP** `packages/admin-dashboard/*` dan area landing agar saya bisa menyunting tanpa menimpa pekerjaan Anda.
2. **Akses staging** (`.env.staging` atau URL DB staging) + izin tertulis untuk `migrate deploy`.
3. **Keputusan produk Ar-003**: apakah sesi/worker tanpa tenant harus fail-closed (tolak) atau fallback default?
4. **Jendela maintenance produksi** (DDL singkat) + verifikasi 2 langkah.

Tanpa empat hal di atas, 16 OPEN tidak dapat ditutup secara jujur; memaksakannya berarti mengedit pekerjaan yang belum stabil atau menjalankan migrasi tanpa verifikasi.
