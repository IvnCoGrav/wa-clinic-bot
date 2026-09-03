# Baseline Golden Corpus — Hasil Awal (2026-09-03T02:19:02.532Z)

> **Total Skenario:** 50 (50 terbobot empiris)
> **Total Turn:** 68
> **Waktu Eksekusi:** <15 detik (offline, tanpa DB/WhatsApp/LLM)
> **Mode:** Soft baseline — failures dicatat, tidak fail-kan suite (untuk observasi awal)

## Ringkasan

| Metrik | Jumlah | Persentase |
|--------|--------|------------|
| Skenario PASS | 20 | 40.0% |
| Skenario FAIL | 30 | 60.0% |
| Turn PASS | 36 | 52.9% |
| Turn FAIL | 32 | 47.1% |

## Kategori (bobot empiris)

| Kategori | Skenario | Bobot |
|----------|----------|-------|
| clinical | 13 | 26% |
| acknowledgement | 13 | 26% |
| booking | 12 | 24% |
| location | 9 | 18% |
| pricing | 3 | 6% |

## Rincian Turn Gagal (untuk iterasi perbaikan)

- **CLIN-01#T1**: Slate childAgeMonths expected 0.66 got null
- **CLIN-01#T2**: Slate kelurahan expected Sedati got null
- **CLIN-03#T1**: mustContain "2–3 hari" not found in reply: "Pijat Bayi Ceria | demam | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tan"; mustContain "istirahat" not found in reply: "Pijat Bayi Ceria | demam | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tan"
- **CLIN-04#T1**: mustContain "Tumbuh Ceria" not found in reply: "Pijat Bayi Ceria | 40 menit | 15 bulan | gtm | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/ko"; mustContain "nafsu makan" not found in reply: "Pijat Bayi Ceria | 40 menit | 15 bulan | gtm | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/ko"
- **CLIN-05#T1**: mustContain "nyaman" not found in reply: "Pijat Bayi Ceria | susah tidur | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluh"
- **CLIN-06#T1**: mustContain "moksa" not found in reply: "Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Gen"
- **CLIN-07#T1**: mustContain "menit" not found in reply: "Untuk Pijat Bayi Ceria Rp 65.000 promo, Pijat Bayi Pulih Ceria Rp 75.000 | Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WI"
- **CLIN-08#T1**: Slate childAgeCategory expected MOMS got null; mustContain "oksitosin" not found in reply: "Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Gen"
- **CLIN-09#T1**: mustContain "laktasi" not found in reply: "Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Gen"; mustContain "Bayi Ceria" not found in reply: "Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Gen"
- **CLIN-11#T3**: mustContain "cekkan" not found in reply: "Pijat Bayi Pulih Ceria | 40 menit | 2 bulan | pilek, demam | Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Univers"
- **ACK-02#T1**: mustContain "Bunda" not found in reply: "Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Gen"
- **ACK-03#T1**: mustContain "cekkan" not found in reply: "Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Gen"
- **ACK-04#T1**: mustContain "Bunda" not found in reply: "Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Generate via Si"
- **ACK-08#T1**: mustContain "laktasi" not found in reply: "Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Generate via Si"
- **ACK-09#T1**: mustContain "Kids" not found in reply: "40 menit | 12 bulan | Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi kelu"; mustContain "Bayi" not found in reply: "40 menit | 12 bulan | Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi kelu"
- **ACK-10#T1**: mustContain "cekkan" not found in reply: "Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Gen"
- **BOOK-01#T1**: mustContain "cekkan" not found in reply: "Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Gen"
- **BOOK-02#T1**: mustContain "cekkan" not found in reply: "Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Gen"
- **BOOK-03#T1**: mustContain "cekkan" not found in reply: "Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Gen"
- **BOOK-04#T1**: mustContain "cekkan" not found in reply: "Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Gen"
- **BOOK-05#T1**: mustContain "Waru" not found in reply: "40 menit | 2 bulan | Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluh"
- **BOOK-06#T1**: mustContain "Bunda" not found in reply: "Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Gen"
- **BOOK-07#T1**: mustContain "Sabtu" not found in reply: "Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Gen"
- **BOOK-07#T2**: mustContain "Minggu" not found in reply: "Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Gen"
- **BOOK-10#T1**: Slate childAgeMonths expected 6 got 18; mustContain "Bunda" not found in reply: "40 menit | 18 bulan | Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi kelu"
- **BOOK-11#T1**: mustContain "Bunda" not found in reply: "Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Gen"
- **BOOK-12#T1**: mustContain "Transfer" not found in reply: "Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Gen"
- **LOC-01#T1**: mustNotContain "ongkir" found in reply
- **LOC-02#T1**: Slate kelurahan expected Sedati got null
- **LOC-04#T1**: mustContain "Sidotopo" not found in reply: "Jika dilihat dari jaraknya kurang lebih 21.8 km. Dari pricelist kami di jarak ini ada tambahan ongkir Rp 35.000 tetapi k"
- **LOC-05#T2**: mustContain "Berbek" not found in reply: "Wah deket Bunda, dilihat dari jaraknya kurang lebih 2.0 km (masih dalam jangkauan gratis ongkir hingga 5 km), jadi layan"
- **LOC-06#T1**: mustContain "jangkauan" not found in reply: "Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Gen"; mustContain "maaf" not found in reply: "Bidan STR | Buka SETIAP HARI 08.00 - 17.00 WIB QRIS Universal | Percakapan natural/konsultasi keluhan/tanya harga -> Gen"

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
