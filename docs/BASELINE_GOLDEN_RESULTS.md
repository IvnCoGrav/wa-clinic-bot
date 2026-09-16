# Baseline Golden Corpus & Regression Gate — PLAN 8 FASE 0

> **Tanggal baseline:** 2026-09-16
> **Konteks:** PLAN 8 (`docs/plans/PLAN_8_ARCHITECTURE_FIX.md`) FASE 0 — Regression Gate.

## Angka Baseline (WAJIB jadi acuan tiap fase)

| Perintah | Hasil | Catatan |
|---|---|---|
| `npm run build` | exit 0 | tsc bersih |
| `npm run test:golden` | **51 passed (51)** | 50 skenario + 1 validasi dataset |
| `npm test` | **291 files · 2151 passed · 0 failed · 19 skipped** | baseline penuh |

**Aturan gate:** setiap fase berikutnya tidak boleh:
- menambah jumlah `failed` di atas **0**;
- menurunkan jumlah `passed` di bawah baseline;
- membuat `test:golden` merah.

---

## Temuan FASE 0 (penting, jangan hilang)

### F0-1 — Golden corpus sebelumnya ORPHAN (dead data)
- `npm run test:golden` **gagal** dengan "No test files found" sebelum FASE 0.
- Penyebab: runner `tests/golden-corpus/golden-corpus.test.ts` (228 baris) dihapus di commit
  `3db9bec` karena bergantung pada `src/slot-engine/*` yang didekomisioning.
- Corpus (50 skenario + tipe + validator) tertinggal tanpa runner → gate tidak pernah jalan.
- **Fix FASE 0:** runner baru dibangun di atas `ConversationStateMachine` ASLI (jalur produksi),
  bukan slot-engine yang sudah mati. Lihat `tests/golden-corpus/golden-corpus.test.ts`.

### F0-2 — Isolasi environment test untuk LLM tidak lengkap
- `tests/setup.ts` mengosongkan `LLM_API_KEY`/`OPENAI_API_KEY`, tapi `llm-gateway.ts:35`
  tetap punya fallback `https://api.openai.com/v1`, dan `model-fallback.ts` tetap menempuh
  `DEFAULT_FALLBACK_CHAIN` ketika `AI_MODEL_FALLBACK_CHAIN=''`.
- Akibat: V3 runner tetap melakukan panggilan jaringan, menerima **401**, lalu
  **eskalasi sunyi** via `reportTurnError`. Pada percobaan pertama, **48 dari 50 skenario
  ter-skip** — gate menjadi palsu (rubber stamp).
- **Fix FASE 0:** stub LLM deterministik lewat seam resmi
  `GenerationStage.executeChatCompletion` (komentar kode menyebut seam ini disediakan
  untuk "mock test via spyOn"). Gate kini benar-benar mengeksekusi routing, tool,
  session, dan guardrail tanpa jaringan.
- **Tech debt (TD-7, dicatat):** isolasi test harusnya tidak bergantung pada spy di
  level test; `LlmEndpointConfig` idealnya punya seam transport yang bisa di-inject
  di produksi pula (akan relevan bila FASE 5 Repository dikerjakan).

### F0-3 — Verifikasi adversarial gate
- Gate diuji dengan sengaja menyuntikkan regresi (memaksa `noSilentDrop` selalu gagal).
- Hasil: **24 dari 51 test merah** → gate terbukti sensitif, bukan hijau-palsu.
- Test file dikembalikan ke kondisi benar dan diverifikasi hijau 51/51.

---

## Keterbatasan yang Diakui (bukan disembunyikan)

Gate ini **menegakkan invarian deterministik**, bukan kualitas bahasa LLM:
- no-silent-drop, no-unjustified-RSQR, `mustNotContain`, format (`**` dilarang),
  panjang (≤1500 char), dan retensi slate.
- Assertion bahasa (`mustContain`) **tidak** ditegakkan karena LLM di-stub; memverifikasi
  konten bahasa membutuhkan LLM nyata (di luar lingkungan offline). Ini keterbatasan
  yang jujur, bukan alasan menghijaukan test.
- Assertion slate yang datanya memang tidak tersedia offline dilaporkan sebagai
  `skipped` di log (`[GOLDEN <id>] skipped: ...`), bukan dibuat hijau secara palsu.

---

## Cara Re-run

```powershell
npm run test:golden
# atau
npx vitest run tests/golden-corpus
```
