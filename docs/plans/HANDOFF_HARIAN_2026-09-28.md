# Handoff Harian — 2026-09-28

Dokumen konsolidasi pekerjaan tanggal 2026-09-28: apa yang selesai (dan di-commit),
serta apa yang **BELUM SELESAI** agar tidak hilang.

Branch: `feat/staff-chat-window-lifecycle`

---

## 1. SELESAI & INI DI-COMMIT

### 1.1 Atribusi Iklan CTWA WAHA (Issue #119) — KNOWN_ISSUES #159
- **Extractor** `src/integrations/whatsapp/waha-ctwa-referral.ts` (pure, fail-open, multi-variant).
- **Kontrak bersama** `AdReferral` di `gateway.types.ts`; dipakai normalizer WABA + `MatchAdClickParams`.
- **Wiring** `webhook.route.ts` meneruskan `referral` → `matchAdClickAndFireContact`.
- **Pengkayaan** `ad-attribution.service.ts` (`utmSource/Medium/Campaign`, `landingUrl`).
- **CAPI** `capi.service.ts`: `user_data.ctwa_clid` mentah + envelope Business Messaging
  (`action_source='business_messaging'`, `messaging_channel='whatsapp'` top-level,
  `whatsapp_business_account_id`), state-gated ke `tenant.waba_business_account_id` (fail-open ke `chat`).
- **Test:** `waha-ctwa-referral.test.ts` (7), `waha-webhook.test.ts` (+2 seam integrasi),
  `tracking.test.ts` (+3 CAPI), `ad-attribution.test.ts` (+1 enrichment).

### 1.2 Audit Sistem Reservasi Fase 0–4.2 — KNOWN_ISSUES #157 (sebagian)
Lihat `docs/plans/HANDOFF_RESERVASI_AUDIT_FASE_0-4.md` untuk daftar file lengkap.
Inti: isolasi tenant fallback, fix kategori BOTH, sapaan tidak mengunci cart, tool-masking
tanya-slot, kontrak durasi tunggal, jam operasional fleksibel `[OUTSIDE_HOURS]`, worker auto-expire hold.

### 1.3 Sesi paralel lain (ikut ter-commit)
Copilot (state signal/date filter/sanitizer), scorer PLAN 12, abuse-detection, LiveChat fix, dll.
Lihat `git log` untuk rincian per-commit.

---

## 2. BELUM SELESAI (lanjutan)

### 2.1 CTWA (KNOWN_ISSUES #159) — prioritas
- **#159d-1 (MEDIUM, butuh verifikasi produksi):** blueprint Meta menyatakan Business Messaging CAPI
  mendukung **Cloud API / On-Premises API**. Nomor klinik di **WAHA (klien unofficial)**; `ctwa_clid`
  terekspos di payload, tetapi penerimaan event `business_messaging` dari nomor unofficial TIDAK dijamin.
  **Aksi:** kirim 1 event uji CTWA ke Events Manager (Test Events) di produksi. Bila ditolak →
  kembalikan ke `action_source='chat'` dan pakai `ctwa_clid` sebagai sinyal internal saja.
- **#159d-2 (MINOR):** field "Business Account ID" hanya ada di sub-tab WABA → kurang discoverable untuk
  tenant WAHA. Kandidat: helper-text/tautan di section "Meta Pixel & CAPI" (bukan page baru). Butuh konfirmasi UI.
- **#159e/#159f:** by-design (fail-open & kontak admin tidak diatribusikan). Tidak ada aksi.

### 2.2 LiveChat Blinking / SSE Thrashing (KNOWN_ISSUES #160) — BLOCKED
- Akar & rencana sudah lengkap (`implementation_plan.md`). **Menunggu persetujuan user** sebelum eksekusi.
- 5 temuan: SSE cross-mode thrashing, flash spinner, ghost chat leakage, double-X search, sandbox burst timer.

### 2.3 Reservasi Fase 4.3 & 5 (KNOWN_ISSUES #157) — butuh keputusan/migrasi
- **4.3 GCal outbox:** butuh migrasi Prisma (`gcal_sync_status`, `gcal_last_error`) → Confirmation Gate.
- **5.1** Advisory lock `pg_advisory_xact_lock` anti double-booking (#157d).
- **5.2** WIB eksplisit `indonesian-date-parser.ts` + frontend ISO WIB (#157k).
- **5.3** Validator silang hari↔tanggal >1 hari (#157l).
- **5.4** Batas retry + health-check staf tanpa channel notifikasi (#157f).
- **157a/157b** jalur form WA tanpa gerbang staf/jam — fondasional, belum dituntaskan.

### 2.4 Tugas operasional (bukan kode)
- Bukti SQL/log produksi (18 customer, double booking 4 Okt, hold 17 Sep) belum diverifikasi.
- Alokasi 2 terapis 4 Okt 09:00; tutup hold usang 17 Sep; pasang notifikasi Bidan Yusi F.

### 2.5 Debt test
- **KNOWN_ISSUES #142:** `waha-webhook` (gambar inbound) & `media.service` (`runMediaCleanup`) timeout
  flaky di full-suite paralel. Lulus saat diisolasi. Bukan regresi CTWA.
- Suite penuh: ~1 gagal flaky per run (berganti-ganti), bukan regresi.

---

## 3. CATATAN EKSEKUSI
- Secret scan `npm run security:scan` LULUS (91 file, tanpa kebocoran).
- `npm run build` (backend) + `packages/admin-dashboard` build hijau.
- `.env` sudah gitignored — tidak ikut ter-commit.
