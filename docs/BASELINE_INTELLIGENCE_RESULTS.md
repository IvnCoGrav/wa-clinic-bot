# Baseline Intelligence & Efficiency — PLAN 9 FASE 9.0

> **Tanggal:** 2026-09-16
> **Metode:** `npx tsx scripts/audit-prompt-cost.ts --days=3` (baca `logs/llm-*.jsonl`, offline, tanpa DB)
> **Tujuan:** Baseline terukur sebelum optimasi apa pun (disiplin sama dengan PLAN 8 FASE 0).
>
> **Update pasca-9.1 (2026-09-16):** prefix byte-stabil V3_GENERATION naik dari **2.963 → 43.590 char
> (96,7% prompt, ~10.898 token)** setelah `greetingInstruction` + sapaan gender dipindah ke tail dinamis
> dan blok few-shot dinamis disisipkan setelah penanda stabil. Terukur via `buildCacheableSystemPrompt`
> pada prompt produksi (45.078 char). Sebelumnya prefix terpotong di index ~2.986 oleh segmen
> `isFollowUp` 321 char. Tidak ada aturan prompt yang dihapus (keputusan anti make-up 9.1.1).

---

## 1. Baseline Prompt Cost (era arsitektur per-call, sejak 2026-09-14)

| Flow | Calls | Avg Prompt Char | Prefix Byte-Stabil | Prompt Tokens | Completion Tokens | Total Rp | Avg Latency |
|---|---|---|---|---|---|---|---|
| V3_ROUTING | 19 | 8.833 | 383 | 4.932 | 42 | 261,73 | 2.430 ms |
| **V3_GENERATION** | **7** | **42.545** | **2.963** | **13.233** | 150 | 261,47 | 2.309 ms |
| V3_REPROMPT | 3 | 0 (tidak di-log) | 0 | 340 | 49 | 4,34 | 1.232 ms |

**Temuan kunci:**
1. **V3_GENERATION = 42.545 char / 13.233 token per balasan.** Ini titik efisiensi utama.
2. **Prefix byte-stabil hanya 2.963 char** dari ~5.100 char head statis. Penyebab presisi:
   satu segmen 321 char (`- CHAT LANJUTAN:` vs `- CHAT PEMBUKA (TURN-0):`) yang bergantung
   `isFollowUp` berada di **tengah** head statis (index ~2.986), memutus prefix cache.
   Memindahkan segmen itu ke tail → prefix byte-stabil naik ke ~5.100 char (hampir 2×).
3. **V3_ROUTING prefix byte-stabil hanya 383 char** — variasi awal (nama customer/sapaan) membatasi caching.

### Catatan era data (penting)
- `flowType: V3_AGENT` (69 record, 34.836 char) adalah **legacy monolitik** — hanya ada di
  2026-09-10 & 2026-09-11, sebelum dekomposisi agent-runner ke per-call. **Bukan perilaku saat ini.**
- Record legacy itu juga `promptTokens: null` / `costIdr: null` → cost tracking era lama buta.
  Era per-call (09-14 ke atas) sudah mencatat token & biaya dengan benar.

---

## 2. Baseline Kualitas Bahasa

| Dimensi | Status | Catatan |
|---|---|---|
| Gate struktural (no-silent-drop, format, panjang, slate) | ✅ Ada | `tests/golden-corpus/golden-corpus.test.ts` (PLAN 8 FASE 0) |
| Gate kualitas bahasa (kehangatan, kepatuhan persona) | ❌ Belum ada | Akan dibuat di PLAN 9 FASE 9.2 |
| Rubrik persona | ❌ Belum ada | Akan dibuat di 9.2 |
| Harness evaluasi LLM nyata | ⚠️ Parsial | `src/services/llm-evaluator.service.ts` ada, belum jadi gate |

## 3. Baseline Loop Belajar Gaya (update pasca-9.3)

| Dimensi | Status | Bukti |
|---|---|---|
| Passive self-learning (jawaban admin → FAQ staging) | ⚠️ Ada tapi **mati default** | `self-learning.service.ts:25`; `.env.example:110` |
| Jawaban admin → **exemplar gaya** | ✅ **Diimplementasikan (9.3.2)** — default non-aktif | `proposeStyleExemplar` + test 3 kasus adversarial; filter: 20–800 char, tanpa nominal, tanpa PII, tanpa `**` |
| Antrean review exemplar di dashboard | ✅ **Ada (9.3.3)** — filter "Perlu Review" di AI Persona | `AiPersona.tsx` (reuse tab, tanpa page baru) |
| Skrip seed exemplar emas | ✅ **Diperbaiki (9.4.1)** | `seed-curated-gold-exemplars.ts:18` → `src/v3/agent/` |
| Runbook kurasi | ✅ **Ada (9.4.2)** | `docs/RUNBOOK_GAYA_BIDAN.md` (maks 5 aktivasi/minggu) |
| Gate kualitas bahasa | ✅ **Ada (9.2)** — rubrik 5 dimensi + harness | `src/evals/persona-rubric.ts`, `tests/evals/persona-quality-harness.ts`; evaluator produksi memakai rubrik yang sama |

## 4. Baseline Bank Gaya

| Sumber | Jumlah | Catatan |
|---|---|---|
| `GOLD_FEW_SHOT_EXEMPLARS` (hardcoded) | `gold-few-shot-exemplars.ts` (312 baris) | Statis di kode |
| `DEFAULT_FEW_SHOT_EXEMPLARS` + gold | `few-shot-exemplars.ts` (648 baris) | Di-seed ke DB |
| Exemplar live di DB | (perlu query DB live; bukan bagian gate offline) | Dikuasai admin via dashboard |

---

## 5. Target Perbaikan (acceptance untuk fase berikutnya)

| Fase | Metrik | Baseline | Target |
|---|---|---|---|
| 9.1 | Prefix byte-stabil V3_GENERATION | 2.963 char | ≥ 5.000 char (segmen `isFollowUp` pindah ke tail) |
| 9.1 | Prompt char V3_GENERATION | 42.545 | turun setelah aturan redundan dipindah ke validator (tanpa menghapus aturan) |
| 9.2 | Gate kualitas bahasa | tidak ada | harness + rubrik berjalan, exit 1 bila < ambang |
| 9.3 | Loop belajar gaya | mati | staging exemplar non-aktif + review admin |

---

## Cara Re-run

```powershell
npx tsx scripts/audit-prompt-cost.ts --days=3    # era per-call
npx tsx scripts/audit-prompt-cost.ts --days=7    # termasuk era legacy
```
