# Ringkasan Akhir Audit Deep-Dive Modul 1–11 (Modul 12)

- **Tanggal:** 2026-11-07
- **Sifat:** audit baca-saja; tidak ada kode, test, konfigurasi, atau data yang diubah.
- **Metode:** 7 agent paralel (swarm) + konsolidasi lintas modul.
- **Cakupan:** Modul 1, 2, 3 (Bagian A & B), 5, 7, 8, 9, 10, 11.
- **Dikecualikan:** Modul 4 (Reservasi) dan Modul 6 (Live Chat) — sudah deep-dive pada 2026-11-06 dan tidak diaudit ulang.
- **Dasar framework:** AWS Well-Architected (reliability, security, performance, operational excellence), OWASP ASVS/Top 10 + OWASP LLM Top 10, STRIDE, `audit-chatbot-llm` (faithfulness/relevancy/retrieval/prompt/tool), hypothesis-driven + 5 Whys, FMEA (S × O × D = RPN).

---

## 1. Ringkasan Eksekutif

Dari 9 modul yang diaudit, ditemukan **122 temuan**: **22 KRITIS, 44 TINGGI, 46 SEDANG, 10 RENDAH**. Kondisi umum: fondasi arsitektur (pemisahan pipeline, outbox, tenant) sudah ada, tetapi **lapisan otorisasi, durability ingress, backup, dan gerbang klinis masih fail-open atau "sukses palsu"**. Tiga prioritas tertinggi: (1) kredensial produksi yang masih ter-track + RBAC fail-open, (2) backup yang tidak terenkripsi/partial tetapi dilaporkan sukses, (3) triage klinis dan kontrak tool yang masih bisa meloloskan tindakan tidak aman. Tidak ada satu pun temuan yang memerlukan dependency runtime baru.

| Modul | Cakupan | KRITIS | TINGGI | SEDANG | RENDAH | Total |
|---|---|---:|---:|---:|---:|---:|
| 1 + 11 | Arsitektur inti, multi-tenant, keamanan | 1 | 8 | 12 | 4 | 25 |
| 2 + 9 | WhatsApp gateway, ingestion, integrasi eksternal | 1 | 9 | 10 | 2 | 22 |
| 3A | AI Engine: pipeline, tool, state, guardrail | 3 | 4 | 5 | 1 | 13 |
| 3B | AI Engine: RAG, prompt, persona, log | 4 | 5 | 3 | 0 | 12 |
| 5 + 7 | Web app staf/bidan, marketing/CTWA/Meta | 5 | 8 | 6 | 1 | 20 |
| 8 | Background cron & worker | 4 | 5 | 3 | 1 | 13 |
| 10 | Settings, RBAC, arsitektur data-driven | 4 | 5 | 7 | 1 | 17 |
| **Total** | **9 modul** | **22** | **44** | **46** | **10** | **122** |

---

## 2. Koreksi Klaim Audit Lama

Audit ini memverifikasi ulang klaim "PASS" sebelumnya. Yang terbukti **tidak akurat / perlu diturunkan menjadi PARSIAL**:

| Klaim lama | Status baru | Bukti ringkas |
|---|---|---|
| Fase 03 (2026-11-02): masking, guardrail, state management PASS | **PARSIAL** | Tool yang sudah di-mask masih bisa dieksekusi lewat DSML salvage (A-001); commitment gate menyala dari argumen LLM (A-002); `pending` bisa menjadi `COMPLETED` (A-005). |
| Fase 05 (2026-11-02): gate web app staf PASS | **TIDAK SAH** | 6 dari 7 path test gate tidak ada; auto-close trip tidak berjalan di produksi karena store GPS in-memory (S-03). |
| Fase 08 (2026-11-02): 21 cron terpetakan | **PARSIAL** | Kode mendaftarkan **22 pekerja**; 18 dari 22 tidak punya bukti run yang bisa diverifikasi; jadwal `setInterval` tidak persisten (K-002). |
| Fase 09 (2026-11-02): backup Google Drive terenkripsi | **TERBANTAH** | `backup.service.ts` hanya `gzip`, tanpa enkripsi; fallback programmatic menelan error dan hanya mengekspor sebagian tabel (I-001/K-003). |
| Fase 01/11 (2026-11-02): otorisasi & keamanan PASS | **PARSIAL** | RBAC fail-open untuk role tanpa baris `role_api_scopes` (S-003); kredensial historis masih ter-track (S-001); `security:scan` PASS semu (S-013). |
| Fase 02/06 (2026-11-02): gateway tenant-aware | **PARSIAL** | Ingress webhook masih memakai `wahaClient` global dan `setLabelFlags` tanpa tenant (W-002/W-003). |
| Fase 10 (2026-11-02): settings & RBAC data-driven | **PARSIAL** | Otorisasi config default-allow (Cfg-013); 30+ handler menulis `default-tenant` (Cfg-012); `conversation-behavior` hanya stub (Cfg-001). |

---

## 3. Klaster Temuan Lintas Modul (Dedupe)

### C1 — Kredensial & keandalan pemindaian rahasia (P0)
- **S-001 (RPN 480):** `GUIDE_OPERASIONAL.md:71` memuat `admin_prod_key_123`; `docs/plans/SECRET_ROTATION_PLAN.md` masih mencantumkan nilai `ADMIN_API_KEY` dan `WAHA_API_KEY` lama.
- **S-013 (RPN 432):** `security:scan` hanya memindai file berubah dan tidak mendeteksi key generik → PASS semu.
- **Dampak:** kredensial historis dapat dipakai ulang; rotasi tidak terlacak; gate keamanan tidak melindungi commit berikutnya.
- **Rekomendasi:** redaksi nilai, rotasi kunci, invalidasi sesi admin, ubah scanner ke mode `--all` + gate CI.

### C2 — Otorisasi fail-open & tenant-blind (P0)
- **S-003 (RPN 504):** role tanpa baris `role_api_scopes` dianggap legacy dan lolos guard (`admin.route.ts:278-290`) → hampir semua akses.
- **Cfg-013 (RPN 576):** otorisasi config default-allow; `ADMIN_CS`/custom role dapat menulis katalog, tier, knowledge, few-shot, CAPI.
- **Cfg-012 (RPN 432):** 30+ handler settings menulis `default-tenant`, bukan tenant peminta.
- **Cfg-002 (RPN 378):** edit/hapus knowledge chunk tanpa predikat tenant (BOLA lintas tenant).
- **W-002 (RPN 360):** `setLabelFlags` tanpa `tenantId` di webhook.
- **W-003:** `WahaClient` global di webhook.
- **S-002 (RPN 378, S=9):** endpoint `whatsapp-provider/*` memungkinkan QR/session takeover WhatsApp oleh staf non-super-admin.
- **Rekomendasi:** ubah ke allow-list per peran + gate super-admin eksplisit, tenant selalu dari sesi, test matriks role × endpoint.

### C3 — Backup tidak valid & tidak terenkripsi (P0)
- **K-003 (RPN 648):** backup mingguan bisa "sukses palsu": `pg_dump` gagal → fallback programmatic yang menelan error dan hanya mengekspor subset tabel; tidak ada verifikasi isi.
- **I-001 (RPN 560):** file `gzip` diunggah ke Google Drive tanpa enkripsi; klaim "terenkripsi" tidak benar.
- **I-002:** tidak ada manifest/checksum dan pemisahan folder per tenant.
- **Rekomendasi:** fail-closed jika dump tidak lengkap, verifikasi row-count/checksum, enkripsi AES-256-GCM sebelum upload, manifest + retensi.

### C4 — Durabilitas ingress & outbox (P0/P1)
- **W-005 (RPN 324):** pesan sudah dicatat ke DB sebelum enqueue durable; buffer burst di RAM → pesan tercatat tetapi tidak pernah dibalas.
- **W-001 (RPN 405):** turn macet tidak pernah di-replay (recovery hanya saat boot, filter umur 2 menit, tanpa sweep/alarm).
- **W-004 (RPN 320):** cache kill-switch outbound tanpa TTL dan tidak lintas proses; worker terpisah tetap mengirim.
- **K-004 (RPN 252) / I-003–I-005:** Sheets outbox tanpa atomic claim → retry/overlap menggandakan baris keuangan.
- **Rekomendasi:** urutan kanonis `persistInbound → enqueue → logMessage`; klaim atomik + lease; cron replay + alarm; cache cut-off dengan TTL.

### C5 — Scheduler cron tidak persisten & tanpa alert (P1)
- **K-001 (RPN 243):** tidak ada lock/lease/heartbeat; cron ganda dan worker mati tidak terdeteksi.
- **K-002 (RPN 336):** jadwal `setInterval` tidak persisten; cron 6/24 jam bisa tidak pernah jalan setelah restart.
- **K-005 (RPN 270):** kegagalan cron hanya log, tanpa alert/status.
- **Rekomendasi:** satu runner ber-advisory-lock, scheduler persisten + catch-up, heartbeat/alert, inventaris 22 pekerja diselaraskan.

### C6 — Gerbang klinis fail-open & SOP kontradiktif (P0)
- **A-003 (RPN 324):** `evaluateScreeningAnswer` memeriksa sinyal aman lebih dulu; "vaksin tadi pagi tapi tidak demam" → `isSafe=true`; demam tanpa angka tidak memicu kontraindikasi.
- **C-005 (S=9):** SOP vaksinasi kontradiktif: "boleh dijadwalkan langsung" vs "tunda 48–72 jam".
- **C-006 (RPN 378):** RAG-miss memberi lisensi menjawab dari pengetahuan umum; guardrail D3 menerima chunk katalog sebagai "SOP".
- **A-005 (RPN 280):** reservasi `pending` langsung menjadi state `COMPLETED`.
- **Rekomendasi:** tri-state (unsafe > safe; syarat waktu DAN bebas demam; `feverSuspected` non-numerik), samakan semua teks vaksinasi dari `ClinicPolicy`, larang jawaban klinis tanpa grounding, pisahkan state percakapan dari status reservasi.

### C7 — Kontrak tool & komitmen (P0)
- **A-001 (RPN 270):** tool yang sudah di-mask tetap dapat dieksekusi (DSML salvage/halusinasi) karena tidak ada otorisasi saat eksekusi.
- **A-002 (RPN 315):** gerbang komitmen menyala dari kata umum (`booking/ambil/pesan`) atau argumen tool LLM.
- **A-004 (RPN 240):** identitas treatment pada `save_reservation` tidak diikat ke pilihan user; satu token umum (`pijat`) cukup meloloskan nama paket lain.
- **Rekomendasi:** `allowedToolNames` + filter DSML, satu seam komitmen yang hanya menerima pesan `role === 'user'`, `verifiedTreatmentNames` + pemilihan varian dari `ageTier`.

### C8 — Fondasi RAG & prompt (P1)
- **C-001 (RPN 336):** retrieval leksikal, query mentah, tanpa rewriting/rerank; rank gate dan index tidak selaras.
- **C-002 (RPN 280):** korpus knowledge terkontaminasi cuplikan chat ("Nanti saya info lagi") dan duplikat.
- **C-004 (S=9):** jalur prompt 4-Section dari DB menghapus guardrail kode, hierarki, 21 negative constraints, pruning state, dan injection defense.
- **C-010:** prompt assembly tidak meneruskan `tenantId`.
- **Rekomendasi:** query rewriting + rank/IDF, dedupe + pisahkan artikel klinis dari cuplikan chat, overlay 4-Section (bukan replace), teruskan tenant.

### C9 — Sesi & privasi staf lapangan (P1)
- **S-03 (RPN 504):** auto-close trip tidak berjalan di produksi (store GPS in-memory di proses `app`, sweep di `worker`).
- **S-06 (RPN 432):** GPS warm-up berjalan diam-diam tanpa disclosure/consent; cache tidak dibersihkan.
- **S-02 (RPN 392):** outbox chat menyimpan teks/foto PII di `localStorage`, tidak dibersihkan saat logout.
- **S-01:** token sesi tersimpan di JSON/localStorage.
- **S-04:** admin impersonation.
- **Rekomendasi:** persist trip ke DB/Redis, hentikan pelacakan GPS silent + consent, bersihkan outbox saat logout, pindahkan token ke HttpOnly.

### C10 — Integritas atribusi iklan (P1)
- **M-01 (RPN 360):** kode tracking 2 karakter tanpa expiry → bisa ditebak/dipakai ulang, pelanggan dapat menyuntik kampanye palsu.
- **M-02:** pixel tracker tenant-blind.
- **M-03:** marketing tenant-blind.
- **M-07:** CAPI manual default tenant.
- **M-09 (RPN 378):** perubahan spend iklan tidak diaudit; CAC/ROAS dihitung dari spend yang belum tersimpan.
- **Rekomendasi:** kode tracking panjang + expiry, pixel/beacon tenant-aware, validasi beacon, audit spend.

### C11 — Konfigurasi palsu & hardcode data bisnis (P0/P1)
- **Cfg-001 (RPN 504):** `PATCH /api/admin/conversation-behavior` hanya stub: 200 "berhasil" tanpa menyimpan apa pun.
- **Cfg-005 (RPN 384):** SOP/jam/area/metode bayar hardcode di prompt, tool fallback, dan few-shot auto-seed.
- **Rekening fiktif:** `BCA 1234567890` (`staff-reservation.service.ts:2471-2477`), `BCA 8877665544/PT Kala` (`PaymentInfoPanel.tsx:164,175`).
- **Katalog:** 42 layanan berharga Kala (`treatment-catalog.service.ts:199-926`) + 7 tier ongkir (`delivery.service.ts:22-30`) auto-seed.
- **Rekomendasi:** hapus/501 stub, hapus rekening fiktif, pindahkan seluruh data bisnis ke DB + onboarding tenant eksplisit.

### C12 — Rate limit & identitas klien (P0)
- **S-004 (RPN 420):** rate limit bypass via `x-api-key` palsu (bucket baru) dan `allowList` substring URL.
- **S-005 (RPN 448):** `trustProxy: true` + XFF → IP klien dapat dipalsukan; throttle login dan audit IP tidak bermakna.
- **Rekomendasi:** validasi API key sebelum bucketing, `trustProxy` eksplisit (loopback/CIDR), lockout per akun.

---

## 4. Top 15 Temuan Berdasarkan RPN

| # | ID | Modul | Temuan | RPN |
|---:|---|---|---|---:|
| 1 | K-003 | 8 | Backup bukan dump penuh, bisa sukses palsu, tanpa enkripsi | 648 |
| 2 | Cfg-013 | 10 | Otorisasi config default-allow (ADMIN_CS/custom role) | 576 |
| 3 | I-001 | 2+9 | Backup mingguan tanpa enkripsi diunggah ke Drive | 560 |
| 4 | S-03 | 5+7 | Auto-close trip tidak berjalan di produksi (GPS in-memory) | 504 |
| 5 | S-003 | 1+11 | RBAC fail-open untuk role tanpa `role_api_scopes` | 504 |
| 6 | Cfg-001 | 10 | `conversation-behavior` stub: sukses tanpa menyimpan | 504 |
| 7 | S-001 | 1+11 | Kredensial admin produksi masih ter-track di repo | 480 |
| 8 | S-005 | 1+11 | `trustProxy` + XFF memungkinkan pemalsuan IP | 448 |
| 9 | S-013 | 1+11 | `security:scan` PASS semu (hanya file berubah) | 432 |
| 10 | S-06 | 5+7 | GPS warm-up silent tanpa consent; cache tidak dibersihkan | 432 |
| 11 | Cfg-012 | 10 | 30+ handler settings menulis `default-tenant` | 432 |
| 12 | S-004 | 1+11 | Rate limit bypass via API key palsu & allowList substring | 420 |
| 13 | W-001 | 2+9 | Turn macet tidak pernah di-replay | 405 |
| 14 | S-02 | 5+7 | PII teks/foto di `localStorage` staf | 392 |
| 15 | Cfg-005 | 10 | SOP/jam/area/pembayaran hardcode | 384 |

> Catatan: **S-002** (WhatsApp QR/session takeover oleh staf non-super-admin, S=9, RPN 378) dan **A-003/C-005/C-006** (S=9, risiko klinis) tidak selalu masuk 15 besar RPN, tetapi tetap **P0** karena severity-nya.

---

## 5. Rencana Perbaikan Berurutan

### P0 — Stop the bleeding (0–7 hari)
| Urutan | Tindakan | Temuan | Acceptance |
|---:|---|---|---|
| P0.1 | Redaksi nilai kredensial di dokumen, rotasi `ADMIN_API_KEY`/`WAHA_API_KEY`, invalidasi `admin_sessions`, scanner `--all` + gate CI | S-001, S-013 | `git grep` nilai lama = 0; scan `--all` gagal pada fixture key; sesi lama 401 |
| P0.2 | Allow-list RBAC per peran + gate super-admin; tenant dari sesi; test matriks role × endpoint | S-003, Cfg-013, Cfg-012, Cfg-002, W-002, S-002 | Role tanpa scope → 403; custom role baru default-deny; dua tenant terisolasi |
| P0.3 | Tri-state triage + `feverSuspected`; samakan SOP vaksin dari `ClinicPolicy`; larang jawaban klinis tanpa grounding | A-003, C-005, C-006 | Test konflik sinyal: "baru vaksin tapi tidak demam" → SCREEN; "demam" tanpa angka → SCREEN |
| P0.4 | Otorisasi eksekusi tool + seam komitmen + `verifiedTreatmentNames`; pisahkan state percakapan dari status reservasi | A-001, A-002, A-004, A-005 | DSML salvage ditolak; `save_reservation` di luar verified names → `success:false`; pending ≠ COMPLETED |
| P0.5 | Backup fail-closed + verifikasi dump + enkripsi AES-256-GCM + manifest/checksum | K-003, I-001, I-002 | Dump parsial → gagal; file di Drive tidak dapat dibaca tanpa kunci; checksum cocok |
| P0.6 | Hapus/501 `conversation-behavior`, hapus rekening fiktif, hentikan auto-seed diam-diam | Cfg-001, Cfg-005 | PATCH tidak ada atau 501; `rg "1234567890|8877665544"` = 0 |
| P0.7 | `trustProxy` eksplisit, validasi API key sebelum bucketing, lockout login | S-004, S-005 | XFF spoof tidak mengubah bucket; API key palsu tetap bucket yang sama |

**Gate P0:** `npm run build` + `npm run typecheck` + test P0 hijau + `security:scan --all` bersih + tidak ada dependency baru. Setiap klaim "pre-existing" wajib revert-and-rerun.

### P1 — Durabilitas & fondasi (1–3 minggu)
1. **Ingress/outbox:** urutan `persistInbound → enqueue → logMessage`, replay sweep + alarm, `WahaClient` per tenant, TTL cut-off, atomic claim Sheets/Contacts/Telegram.
2. **Cron:** satu runner ber-advisory-lock, scheduler persisten + catch-up, heartbeat/alert, inventaris 22 pekerja.
3. **RAG/prompt:** query rewriting + rank/IDF, dedupe korpus, pisahkan artikel klinis vs cuplikan chat, overlay 4-Section, tenantId ke prompt, retensi/PII log.
4. **Staf/marketing:** token HttpOnly, bersihkan outbox saat logout, GPS consent + persist trip, kode tracking panjang + expiry, pixel/beacon tenant-aware, audit spend.

### P2 — Data-driven & arsitektur (3–6 minggu)
1. Pindahkan katalog 42 layanan, 7 tier ongkir, SOP/jam/area/metode bayar, few-shot, quick reply, brand ke DB + onboarding tenant eksplisit.
2. Pecah God Object >1500 baris; pastikan cron berat tetap di `worker`; tambah observability untuk jalur yang masih silent.
3. Sinkronkan `FEATURE_INVENTORY.md` (22 pekerja, bukan 21), `KNOWN_ISSUES.md`, dan dokumentasi deployment.

---

## 6. Gerbang Verifikasi

- **Build/typecheck:** `npm run build`, `npm run typecheck`.
- **Test:** test baru per temuan P0; suite terkait; full suite dengan **baseline-diff** (bukan klaim "semua hijau").
- **Keamanan:** `security:scan --all`, `git grep` nilai rahasia, uji dua tenant, matriks role × endpoint.
- **Klinis:** test konflik sinyal vaksin/demam, test `save_reservation` di luar `verifiedTreatmentNames`, test DSML salvage.
- **Backup:** uji restore dari file terenkripsi; bandingkan row-count tabel utama; uji dump parsial harus gagal.
- **Cron:** bukti run 7 hari + heartbeat + alarm saat worker mati.

---

## 7. Batasan & Celah Cakupan

- Tidak ada akses server live, DB produksi, WAHA/Meta/Google/Telegram live; seluruh temuan berbasis kode dan test offline.
- Log LLM terbaru **2026-10-06** (32 hari sebelum audit) dan hanya `default-tenant`; log menyimpan output **sebelum** guardrail.
- Tidak ada uji perangkat fisik, red-team runtime, atau uji eksploitasi.
- 18 dari 22 pekerja cron tidak punya bukti run yang dapat diverifikasi.
- Test suite penuh tidak dijalankan ulang; tidak ada klaim persentase hali/faithfulness dari sampel kecil.
- Modul 4 dan 6 sengaja dikecualikan sesuai instruksi; temuan lama yang sudah SELESAI dirujuk, bukan diduplikasi.
- `docs/KNOWN_ISSUES.md` **belum** diperbarui dengan 22 temuan kritis baru — menunggu persetujuan sebelum menulis ke dokumen terpusat.

---

## 8. Lampiran Laporan per Modul

| Modul | Laporan |
|---|---|
| 1 + 11 | `docs/audit/2026-11-07/modul-01-11/LAPORAN_MODUL_01_DAN_11.md` |
| 2 + 9 | `docs/audit/2026-11-07/modul-02-09/LAPORAN_MODUL_02_DAN_09.md` |
| 3A | `docs/audit/2026-11-07/modul-03/LAPORAN_MODUL_03_PART_A.md` |
| 3B | `docs/audit/2026-11-07/modul-03/LAPORAN_MODUL_03_PART_B.md` |
| 5 + 7 | `docs/audit/2026-11-07/modul-05-07/LAPORAN_MODUL_05_DAN_07.md` |
| 8 | `docs/audit/2026-11-07/modul-08/LAPORAN_MODUL_08.md` |
| 10 | `docs/audit/2026-11-07/modul-10/LAPORAN_MODUL_10.md` |
| 4 (2026-11-06) | `docs/audit/2026-11-06/LAPORAN_AUDIT_RESERVASI.md` |
| 6 (2026-11-06) | `docs/audit/2026-11-06/LAPORAN_AUDIT_LIVECHAT.md` (rekonstruksi dari #316) |
| **Konsolidasi (Modul 12)** | **dokumen ini** |
