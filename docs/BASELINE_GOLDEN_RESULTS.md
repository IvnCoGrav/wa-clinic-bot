# Baseline Golden Corpus — Hasil Awal (2026-09-03T08:41:43.517Z)

> **Total Skenario:** 50 (50 terbobot empiris)
> **Total Turn:** 68
> **Waktu Eksekusi:** <15 detik (offline, tanpa DB/WhatsApp/LLM)
> **Mode:** Soft baseline — failures dicatat, tidak fail-kan suite (untuk observasi awal)

## Ringkasan

| Metrik | Jumlah | Persentase |
|--------|--------|------------|
| Skenario PASS | 50 | 100.0% |
| Skenario FAIL | 0 | 0.0% |
| Turn PASS | 68 | 100.0% |
| Turn FAIL | 0 | 0.0% |

## Kategori (bobot empiris)

| Kategori | Skenario | Bobot |
|----------|----------|-------|
| clinical | 13 | 26% |
| acknowledgement | 13 | 26% |
| booking | 12 | 24% |
| location | 9 | 18% |
| pricing | 3 | 6% |

## Rincian Turn Gagal (untuk iterasi perbaikan)

_Tidak ada — semua turn PASS (baseline ideal)_

## 5 Assertion Ketat

1. **No Silent Drop** — bot wajib membalas (harus `shouldSendReply` atau `deterministicTemplateReply`)
2. **No Unjustified RSQR** — jangan tanya kelurahan jika `isLocationConfirmed`
3. **No Broken Formatting** — tidak berawalan buntung (`untuk hari...`) & tidak mengandung `**`
4. **Slate Retention** — fakta Turn-1 wajib tersimpan di `CustomerSlate`
5. **Length & Markdown** — 10–800 char, `Bunda` max 3x, `*` single-star

## Cara Re-run

```bash
npm run test:golden
# atau
npx vitest run tests/golden-corpus
```

*Baseline ini dihasilkan otomatis oleh `tests/golden-corpus/golden-corpus.test.ts` collector.*
