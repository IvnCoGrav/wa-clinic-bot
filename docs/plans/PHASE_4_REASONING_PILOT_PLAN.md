# Plan Fase 4 — Reasoning Pilot untuk Giliran Sulit (DITUNDA, menunggu prasyarat)

> Status: **BELUM DIEKSEKUSI**. Sesuai rekomendasi program stabilisasi: jalankan
> Setelah Fase 2 (perampingan prompt) ter-deploy & latensi produksi terukur.
> Pemilik keputusan: user. Jangan eksekusi tanpa persetujuan eksplisit.

## Latar (dari data produksi nyata)

- `CHAT_REPLY_DEEP` terdaftar di `src/config/ai-models.config.ts` (task registry) tetapi
  **0 pemanggil runtime** — generator selalu `CHAT_REPLY` (`src/v3/agent/agent-runner.ts:144`).
- **Biaya kecil, latensi besar:** `CHAT_REPLY` ≈ Rp 10/panggilan; `CHAT_REPLY_DEEP` ≈ Rp 57/panggilan
  (rata-rata 56 dtk, p95 248 dtk). Risiko utama = memperlambat, bukan biaya.
- `supportsThinkingParam()` ada tetapi belum dipakai runtime (pelajaran insiden `thinking`
  salah provider → model looping/DSML).

## Fase 4.0 — Gerbang provider (prasyarat)

1. `src/config/ai-models.config.ts`: pakai `supportsThinkingParam(provider, model)` di jalur
   pemanggilan model deep.
2. Kirim `reasoning_effort`/`thinking` HANYA ke provider yang didukung; lainnya jangan.
3. Acceptance: unit test 2 arah (didukung → param dikirim; tidak → tidak dikirim).

## Fase 4.1 — Pemicu giliran sulit (state-based, bukan regex/hafalan)

1. Fungsi murni `shouldUseDeepGenerator(session, intents, incomingText)` (tempat: `phase-resolver.ts`).
2. Kriteria dari state existing (`extractFastIntents`, `session.symptoms`, verdict komitmen):
   - ≥2 gejala klinis, ATAU
   - verdict `EXPLORING` + multi-intent (konsultasi ambigu), ATAU
   - sinyal komplain/eskalasi (`hasFallInjurySignal`/`hasVaccineSignal`).
3. BUKAN untuk sapaan/harga/jadwal/lokasi.
4. Acceptance: test adversarial multi-parafrase (sulit → true; sapaan/harga → false).

## Fase 4.2 — Wiring + kill-switch

1. `agent-runner.ts:144-148`: bila pemicu true → `generatorModel` = config `CHAT_REPLY_DEEP`.
2. `generation-stage.executeChatCompletion`: timeout keras (~20 dtk) + fallback ke model murah.
3. Telemetry: catat `usedDeepGenerator` di `payload_raw`.
4. Acceptance: test kill-switch (timeout → fallback, bukan silent drop).

## Fase 4.3 — Ukur & putuskan (2 minggu)

1. Baseline vs sesudah dari `llm_audit_logs`: completion rate, eskalasi salah, latensi p95, biaya/hari,
   + skor ujian emas (`tests/eval/golden-conversations.eval.test.ts` + `tests/golden-corpus`).
2. Gate: latensi p95 pilot ≤ baseline +20%; skor emas tidak turun; biaya dalam pagu.
3. Keputusan angka: lanjut / batasi pemicu / batalkan (satu flag).

## Estimasi biaya

- Volume produksi rendah (puncak ±58 panggilan/hari).
- Pemicu ~20% giliran → ~10 panggilan deep/hari × delta ≈ Rp 45 → **≈ Rp 450/hari ≈ Rp 14.000/bulan**
  (bisa diabaikan). Beban nyata = latensi (+~9 menit/hari).

## Prasyarat sebelum eksekusi (GATE)

1. Fase 2 (prompt slim) **ter-deploy** ke server.
2. **Latensi produksi baseline baru terukur** (butuh bot aktif menerima trafik).
3. Persetujuan eksplisit user atas biaya + risiko latensi.

## Verifikasi rencana (regression gate)

- Sebelum pindah fase: `npm run build` + `npm test` hijau, skor emas ≥ baseline.
- Setiap fase punya kill-switch satu-flag.
