# Plan: Copilot Multi-Step, Tool Berbasis Data & Panel Mobile Collapsible

> Status: **SELESAI & TER-DEPLOY LIVE (2026-09-27, commit `16c1a66c`).**
> Fase A (loop), Fase B1 (`query_stalled_inquiries`), Fase UI-Mobile selesai & live.
> Fase B2: mining 30 audit → hanya 1 `toolsUsed:[]` (sudah ditutup) → **tidak ada kelas
> dominan → berhenti di 1 tool** (sesuai aturan plan, tidak spekulatif). Fase C ditunda.
> Sisa/limitasi tercatat di `docs/KNOWN_ISSUES.md` #146.
> Bahasa: Indonesia.
> Latar: audit log live 7 hari (8 chat) membuktikan single-tool-ceiling tercapai —
> "yang belum terjadwal dan minta besok?" dijawab dengan data orang *yang sudah
> terjadwal* (`query_reservations_by_filter`, `grounded:true` tapi salah semantik).
> Validator nama tidak menangkapnya karena nama memang berasal dari tool.

## Keputusan terkunci

1. **Budget loop:** total panggilan LLM per request ≤ 4 (3 router + 1 summarize), total baris
   semua tool ≤ 40, timeout diwarisi `cfg.timeoutMs`. Tanpa ini loop = bom biaya/latensi.
2. **Sinyal minat jadwal state-based**, tanpa regex keyword baru: `session_data.inquiryDate/cart`,
   `last_discussed_treatment`, inbound terbaru + tanpa balasan ADMIN sesudahnya. Recall terbatas
   pada chat yang melewati state tersebut (disengaja, didokumentasikan).
3. **Urutan:** Fase A → Fase B → (C ditunda). Fase UI-Mobile boleh paralel setelah A.
4. **Mobile:** floating button disembunyikan di mobile, diganti tab panah tepi kiri;
   ditekan → floating button muncul. Desktop tidak berubah.

## Peta dependensi

```
Fase A (multi-step loop, copilot.service.ts)
 ├─ Fase B1 (tool query_stalled_inquiries)
 ├─ Fase B2 (tool dari mining audit log)
 └─ Fase UI-Mobile (AdminCopilotPanel collapsible) — paralel setelah A
Fase C (semantic search pgvector) — DITUNDA, Confirmation Gate
```

## FASE A — Multi-step tool loop (maks 3 iterasi)

**🎯 Goal & nilai:** pertanyaan komposit terjawab benar. Ukur: "belum terjadwal dan minta
besok" me-return irisan prospek ∩ inbound terbaru; tidak ada jawaban dari tool tunggal yang salah.

**⚠️ Kritis:**
- Infinite loop / biaya meledak → budget guard kode (bukan imbauan): iterasi ≤ 3,
  LLM call ≤ 4, baris ≤ 40. Router yang mengulang tool+args identik = sinyal berhenti.
- Validator lama per-tool → wajib atas **union** nama semua hasil (halusinasi silang-sumber).
- History 10 turn dipertahankan; hasil tool antar-iterasi diringkas ke konteks router
  (bukan full rows, hemat token — kirim ringkasan `count + 5 sample`).

**🔄 Alur:** `router → eksekusi → simpan ke toolHistory → router lagi (konteks: hasil sejauh
ini + apa yang kurang) → berhenti bila tool:null / iterasi=3 / pengulangan → summarize
gabungan berlabel sumber → validate union`.

**🛠️ Mikro-tugas** (`src/services/copilot/copilot.service.ts`, `chat()` ~baris 30–144):
1. Refaktor Langkah 1–3 menjadi loop dengan `toolHistory: {tool, args, rows}[]`; prompt router
   iterasi-n menerima `HASIL SEJAUH INI` + instruksi "pilih tool berikutnya atau null bila cukup".
2. `MAX_ITERATIONS = 3`, `MAX_LLM_CALLS = 4`, `MAX_TOTAL_ROWS = 40` sebagai konstanta + enforced
   di kode (bukan komentar).
3. Summarize menerima blok berlabel (`[reservasi]`, `[prospek]`, …) + aturan deep-link existing.
4. `validateGrounding(answer, unionRows)` — tanda tangan tetap, panggil dengan gabungan.

**✨ Deliverable:** pertanyaan komposit terjawab dari ≥2 sumber dengan atribusi per-bagian.

**🚦 Gate:** `tsc` 0; test: loop berhenti iterasi-2 untuk komposit (LLM mock), budget tidak
terlampaui (assert jumlah call), union-grounding menangkap nama silang-sumber, router sampah →
berhenti tanpa loop; full suite hijau. Tanpa migrasi.

## FASE B1 — Tool `query_stalled_inquiries` (wajib)

**🎯 Goal:** menjawab "siapa yang minta dijadwalkan (tapi belum booking)". Ukur: mencakup
2 baris 🔴 di audit log.

**🛠️ Mikro-tugas** (`src/services/copilot/copilot-tools.ts`, pola `queryUnscheduledProspects`):
- Kriteria deterministik: ada inbound ≤ N hari (default 7, argumen `sinceDays`) **DAN** sinyal
  minat dari state (`session_data.inquiryDate/cart` atau `last_discussed_treatment`) **DAN**
  tanpa reservasi aktif **DAN** tanpa balasan ADMIN setelah inbound terakhir.
- Tenant-scoped, tanpa phone ke LLM, `conversationId` + `take≤20`, 1 query + filter state di
  aplikasi (state JSON tak bisa diindeks — dokumentasikan batas ini).
- Daftarkan di `COPILOT_TOOLS`; update registry test.

**🚦 Gate:** adversarial (stalled vs sudah-booking vs tanpa-inbound vs dibalas-admin;
isolation; sandbox/dummy tersaring); `tisc` + suite hijau. Tanpa migrasi.

## FASE B2 — Tool dari mining (bukan tebakan)

Pada eksekusi: ambil 20 pertanyaan `toolsUsed:[]` terbaru dari `audit_logs`
(`action='AI_COPILOT_CHAT'`); pilih kelas terbesar; kandidat bawaan `query_customer_offers`.
Bila tak ada kelas dominan → berhenti di 1 tool, tidak membangun spekulatif. Prosedur dan
gate identik B1 (deterministik, tenant-scoped, tanpa phone, conversationId, take≤20, test).

## FASE UI-Mobile — Panel collapsible (permintaan user)

**🎯 Goal:** di mobile, floating button tidak menutupi chat; tab panah tepi kiri
memunculkannya saat dibutuhkan. Desktop tidak berubah.

**⚠️ Kritis:** tab tepi tidak boleh menutupi bubble chat (offset vertikal tengah, lebar kecil);
hanya `md:hidden`; state tidak bocor antar-percakapan (panel sudah per-mount LiveChat);
tidak ada dependensi baru (ikon `ChevronRight/ChevronLeft` dari `lucide-react` existing).

**🛠️ Mikro-tugas** (`packages/admin-dashboard/src/components/copilot/AdminCopilotPanel.tsx`,
floating trigger ~baris 74–85):
1. State baru `edgeOpen` (default `false`); import `ChevronRight, ChevronLeft`.
2. Tab tepi: `fixed left-0 top-1/2 -translate-y-1/2 z-40 md:hidden rounded-r-xl`
   (indigo, `aria-expanded`, `aria-label` jelas); ikon panah mengikuti state.
3. Floating button existing: tambah kondisional `${edgeOpen ? 'flex' : 'hidden'} md:flex`
   (kelas lain tidak berubah); panel (`open`) tidak berubah.
4. Perilaku: tekan tab → floating button muncul (transisi existing `active:scale-95`);
   tekan tab lagi → sembunyi; membuka panel tidak me-reset tab (sengaja, agar tidak kejutan).

**✨ Deliverable (mobile):** layar bersih tanpa tombol melayang; satu ketukan panah kiri
memunculkan tombol ✨; ketukan lagi menyembunyikan. Desktop identik seperti semula.

**🚦 Gate:** dashboard `tsc` + `vite build` 0; checklist manual viewport mobile
(360px & 768px): tab terlihat, tombol muncul/hilang, panel `w-[min(92vw,380px)]` tidak
overflow, tidak menutup composer; full suite hijau. Tanpa migrasi, tanpa dep baru.

## FASE C — Semantic search (DITUNDA)

Dibuka hanya bila setelah A–B masih ada kelas "tentang isi chat" yang gagal ≥3×/minggu di
audit log. Butuh ekstensi pgvector + pipeline embedding + biaya inferensi → Confirmation Gate
tersendiri. Tidak dikerjakan sekarang.

## Matriks kepatuhan

| Mandat | Implementasi |
|---|---|
| Solusi fondasional | Loop berantai + tool state-based; tanpa baris "DILARANG..." baru |
| Anti-overfitting | Tanpa matcher kalimat; intent dari state DB |
| Zero-dep / non-hardcode | Tanpa tabel/dep baru; util `wib-time.ts` dipakai ulang |
| Tenant-isolasi | Semua tool filter `tenant_id`; budget per-request |
| Anti-halusinasi | Validator union; empty → template jujur |
| Adversarial test | Parafrase komposit + mock LLM deterministik |
| Mobile-first | Collapsible, desktop untouched, tanpa dep baru |

## Deploy & regresi akhir

Per fase: `tsc` + `vitest run tests/unit/` hijau sebelum lanjut. Deploy akhir: commit per
fase + CHANGELOG + KNOWN_ISSUES; tanpa `migrate deploy` (tanpa perubahan skema);
`--no-deps app` (WAHA tidak tersentuh); verifikasi `/health`, `status:502` = 0, tanpa
`TypeError`, plus 1 pertanyaan komposit live yang jawabannya dikontra-cek ke DB.
Rollback: `git reset --hard <sebelumnya>` + rebuild + up.
