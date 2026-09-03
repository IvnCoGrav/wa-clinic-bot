# Laporan Pengujian 30 Percakapan Customer Nyata (Historical Replay)

**Tanggal Pengujian:** 3/9/2026, 13.10.46
**Jumlah Percakapan Diuji:** 30 nomor pelanggan riil
**Total Balon Pesan Masuk:** 224 giliran
**Total Anomali Terdeteksi:** 16

## 📋 Ringkasan Inventaris Masalah (Real Defect Inventory)

| Kategori Anomali | Frekuensi | Tingkat Keparahan | Deskripsi Masalah |
|---|---|---|---|
| `REPEATED_ONGKIR_PARAGRAPH` | 8 | 🔴 TINGGI | Bot mengirimkan paragraf kalkulasi ongkir ulang padahal lokasi sudah terkonfirmasi di turn sebelumnya dan pelanggan tidak minta ganti alamat! |
| `BOT_REPETITION_LOOP` | 8 | 🔴 TINGGI | Bot mengulang persis balasan giliran sebelumnya (Looping terdeteksi)! |

## 🔍 Rincian Sampel Temuan per Kategori

### Kategori: `REPEATED_ONGKIR_PARAGRAPH` (8 kejadian)
1. **Customer 628170****33 (Turn 3):**
   - *Pesan Masuk:* `"Itu hrga uda free transport kah"`
   - *Temuan:* Bot mengirimkan paragraf kalkulasi ongkir ulang padahal lokasi sudah terkonfirmasi di turn sebelumnya dan pelanggan tidak minta ganti alamat!

2. **Customer 628170****33 (Turn 4):**
   - *Pesan Masuk:* `"Di apart dian regency"`
   - *Temuan:* Bot mengirimkan paragraf kalkulasi ongkir ulang padahal lokasi sudah terkonfirmasi di turn sebelumnya dan pelanggan tidak minta ganti alamat!

3. **Customer 628170****33 (Turn 5):**
   - *Pesan Masuk:* `"Di daerah keputih"`
   - *Temuan:* Bot mengirimkan paragraf kalkulasi ongkir ulang padahal lokasi sudah terkonfirmasi di turn sebelumnya dan pelanggan tidak minta ganti alamat!

4. **Customer 628224****00 (Turn 5):**
   - *Pesan Masuk:* `"Demak timur Surabaya pusat"`
   - *Temuan:* Bot mengirimkan paragraf kalkulasi ongkir ulang padahal lokasi sudah terkonfirmasi di turn sebelumnya dan pelanggan tidak minta ganti alamat!

5. **Customer 628967****93 (Turn 8):**
   - *Pesan Masuk:* `"Baik"`
   - *Temuan:* Bot mengirimkan paragraf kalkulasi ongkir ulang padahal lokasi sudah terkonfirmasi di turn sebelumnya dan pelanggan tidak minta ganti alamat!

### Kategori: `BOT_REPETITION_LOOP` (8 kejadian)
1. **Customer 628518****55 (Turn 3):**
   - *Pesan Masuk:* `"soalnya aku baru pulang jam 15.10"`
   - *Temuan:* Bot mengulang persis balasan giliran sebelumnya (Looping terdeteksi)!

2. **Customer 628966****50 (Turn 6):**
   - *Pesan Masuk:* `"iya tidak apa - apa"`
   - *Temuan:* Bot mengulang persis balasan giliran sebelumnya (Looping terdeteksi)!

3. **Customer 628125****86 (Turn 4):**
   - *Pesan Masuk:* `"Baik"`
   - *Temuan:* Bot mengulang persis balasan giliran sebelumnya (Looping terdeteksi)!

4. **Customer 628125****86 (Turn 5):**
   - *Pesan Masuk:* `"Oke"`
   - *Temuan:* Bot mengulang persis balasan giliran sebelumnya (Looping terdeteksi)!

5. **Customer 628785****73 (Turn 2):**
   - *Pesan Masuk:* `"Griya amerta , medokan ayu, rungkut"`
   - *Temuan:* Bot mengulang persis balasan giliran sebelumnya (Looping terdeteksi)!

## 📑 Papan Skor per Nomor Pelanggan (30 Kasus)

| No | Pelanggan | Turn | Anomali | Status Evaluasi |
|---|---|---|---|---|
| 1 | 628170****33 | 5 | REPEATED_ONGKIR_PARAGRAPH, REPEATED_ONGKIR_PARAGRAPH, REPEATED_ONGKIR_PARAGRAPH | ⚠️ 3 ISU |
| 2 | 628518****55 | 8 | BOT_REPETITION_LOOP | ⚠️ 1 ISU |
| 3 | 628234****31 | 8 | Nihil | ✅ BERSIH |
| 4 | 628214****10 | 7 | Nihil | ✅ BERSIH |
| 5 | 628787****36 | 5 | Nihil | ✅ BERSIH |
| 6 | 628224****00 | 5 | REPEATED_ONGKIR_PARAGRAPH | ⚠️ 1 ISU |
| 7 | 628967****93 | 8 | REPEATED_ONGKIR_PARAGRAPH | ⚠️ 1 ISU |
| 8 | 628121****85 | 7 | Nihil | ✅ BERSIH |
| 9 | 628785****16 | 8 | Nihil | ✅ BERSIH |
| 10 | 628953****79 | 7 | Nihil | ✅ BERSIH |
| 11 | 628596****90 | 5 | Nihil | ✅ BERSIH |
| 12 | 628223****79 | 8 | Nihil | ✅ BERSIH |
| 13 | 628899****64 | 8 | Nihil | ✅ BERSIH |
| 14 | 628510****85 | 7 | REPEATED_ONGKIR_PARAGRAPH | ⚠️ 1 ISU |
| 15 | 628579****26 | 8 | Nihil | ✅ BERSIH |
| 16 | 628128****33 | 8 | Nihil | ✅ BERSIH |
| 17 | 628966****50 | 8 | BOT_REPETITION_LOOP | ⚠️ 1 ISU |
| 18 | 628180****01 | 8 | Nihil | ✅ BERSIH |
| 19 | 628523****21 | 8 | Nihil | ✅ BERSIH |
| 20 | 628575****41 | 8 | Nihil | ✅ BERSIH |
| 21 | 628977****51 | 8 | REPEATED_ONGKIR_PARAGRAPH | ⚠️ 1 ISU |
| 22 | 628125****86 | 8 | BOT_REPETITION_LOOP, BOT_REPETITION_LOOP | ⚠️ 2 ISU |
| 23 | 628233****93 | 8 | Nihil | ✅ BERSIH |
| 24 | 628113****11 | 8 | Nihil | ✅ BERSIH |
| 25 | 628785****73 | 8 | BOT_REPETITION_LOOP, BOT_REPETITION_LOOP | ⚠️ 2 ISU |
| 26 | 628124****10 | 8 | Nihil | ✅ BERSIH |
| 27 | 628960****51 | 8 | Nihil | ✅ BERSIH |
| 28 | 628218****68 | 8 | BOT_REPETITION_LOOP | ⚠️ 1 ISU |
| 29 | 628122****55 | 8 | BOT_REPETITION_LOOP | ⚠️ 1 ISU |
| 30 | 628785****63 | 8 | REPEATED_ONGKIR_PARAGRAPH | ⚠️ 1 ISU |
