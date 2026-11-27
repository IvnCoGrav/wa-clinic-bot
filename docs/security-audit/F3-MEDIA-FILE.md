# F3 — Media & File (2026-11-26)

Status: **source selesai; menunggu gerbang full-suite**. T3.2 (link bukti bayar) **dilewati** sesuai keputusan G3.

## 1. Perubahan

| Task | Temuan | Perubahan | File |
|---|---|---|---|
| T3.1 | `M08-AVATAR-CROSS-TENANT` (confirmed), `M18-15-AVATAR-ANON-PII` | Avatar wajib sesi admin/staf; lookup terikat tenant (root API key tetap boleh lintas tenant); `?tenantId` klien dihapus; cache per tenant; fallback inisial dibuat **lokal** (SVG), tidak lagi mengirim nama ke `ui-avatars.com`. | `src/routes/media.route.ts` |
| T3.1b | hardening | `/media/asset/:filename` dibatasi ekstensi gambar (`jpg/jpeg/png/webp/gif/svg`). | `src/routes/media.route.ts` |
| T3.3 | `M18-11-INBOUND-BUFFER-BEFORE-QUOTA` | Batas ukuran per tipe: **20 MB** gambar/audio/video, **100 MB** dokumen. Guard murni `assertInboundMediaBudget` dipanggil sebelum kuota/tulis. Unduhan axios WAHA + WABA diberi `maxContentLength`/`maxBodyLength` sehingga buffer tidak bisa melebihi 100 MB. | `src/utils/media-limits.ts`, `src/services/media.service.ts`, `src/integrations/waha/client.ts`, `src/routes/waba-webhook.route.ts` |
| T3.4 | `M18-01-INBOUND-NO-MIME-WHITELIST` | MIME yang dapat mengeksekusi markup (`text/html`, `application/xhtml`, `image/svg`, `application/javascript`, `text/xml`) ditolak sebelum disimpan. | `src/utils/media-limits.ts`, `src/services/media.service.ts` |
| T3.5 | hardening `M07-17` | Bukti bayar manual disimpan lewat `savePaymentProof` (scope privat `payment-proofs/`), bukan `saveOutboundMedia` (publik). | `src/routes/admin/reservation-dispatch-payment-proof.subroute.ts` |

Catatan: kompresi/thumbnail tetap ada, tetapi **bukan** pengganti batas ukuran (byte harus diterima dulu sebelum bisa dikompres).

## 2. Test baru

- `tests/unit/media-inbound-budget.test.ts` — plafon 20/100 MB, MIME terlarang, penolakan di `saveInboundMedia`.
- `tests/unit/avatar-access.test.ts` — anonim 401, tenant lain 404, fallback lokal tanpa nama/redirect.

Test lama disesuaikan:
- `tests/unit/media-security.test.ts` — avatar anonim 401; fallback lokal `image/svg+xml` dengan sesi.

## 3. Deviasi & catatan

- **T3.2 dilewati (G3)**: `/proof/:reservationId` tetap publik tanpa expiry.
- **Konsumen avatar**: dashboard yang memuat avatar tanpa cookie/API key akan mendapat 401 — perlu memastikan fetch memakai kredensial sesi (dashboard memang sudah ber-sesi). Ini perubahan kontrak yang disengaja.
- **Batas 100 MB** adalah plafon teknis unduhan; media WhatsApp normalnya jauh di bawah itu. Nilai final bisa diturunkan tanpa mengubah kontrak.
- **`decodeBase64`/`resize`** untuk bukti bayar tetap di `savePaymentProof` (8 MB).

## 4. Status temuan

| Fingerprint | Status |
|---|---|
| `M08-AVATAR-CROSS-TENANT` | FIXED in source |
| `M18-15-AVATAR-ANON-PII` | FIXED in source |
| `M18-11-INBOUND-BUFFER-BEFORE-QUOTA` | FIXED in source (plafon + `maxContentLength`) |
| `M18-01-INBOUND-NO-MIME-WHITELIST` | FIXED in source |
| `M08-PROOF-PUBLIC` | **TIDAK diubah** (G3, risiko diterima) |
| `M18-14-AVATAR-ASSET-SSRF` | Sebagian: SSRF guard sudah ada; sisa klaim tidak valid (lihat koreksi M18) |

## 5. Gerbang (run final 2026-11-27)

| Perintah | Hasil |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run check:reuse` | 189 = baseline, 0 baru |
| `check-architecture` | 58 = baseline, 0 baru |
| Test F3 + media/avatar/waba terdampak | 217+ PASS |
| `npm test` penuh | **8559 pass, 1 gagal, 28 skipped** (1091 file) |

Satu-satunya kegagalan: `tests/unit/reuse-gate.test.ts` — durasi gate **62,82 dtk** di bawah beban full-suite (ambang 60 dtk). Bukan regresi: test sama gagal di baseline, lulus isolasi, gate manual 0 pelanggaran baru. Tidak ada kegagalan fungsional baru.

Penyesuaian test pendukung:
- `architecture-gate.test.ts`: assertion pagu Prisma diubah dari `toBe` ke `toBeLessThanOrEqual` — jumlah panggilan **turun** (235 → 234) seharusnya lolos, bukan dianggap gagal.
- `pageview-beacon.test.ts` / `landing-script-injection.test.ts`: nilai dummy pixel `test-pixel-id` kini valid (hyphen diizinkan), jadi test "override invalid" memakai `@@invalid@@`.
- `media-security.test.ts`: avatar anonim 401 dan fallback lokal `image/svg+xml`.
