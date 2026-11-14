# Review Healing Buku Alamat — 2026-11-13

**Mode:** DRY-RUN read-only (produksi `wa_clinic_db`).
**Sumber:** `reconcile-customer-addresses.js --dry-run` + `heal-customer-addresses-split-brain.js --dry-run` + query kartu/reservasi.

## Hasil rekonsiliasi
- Drift JSON ↔ tabel: **0 customer berubah** (adopt=0, hapus=0, upsert=0).
- Multi-kartu: **17 customer** (turun dari 18 setelah hotfix Bunda Intan).

## Klasifikasi 17 customer

### A. Aman di-merge otomatis oleh script existing (4)
| Customer | Winner | Victim | Bukti | Reservasi victim |
|---|---|---|---|---|
| Bunda Fanni (`1e752b81…`) | Rumah Gunung Anyar | Rumah Gunung Anyar 2 | alamat + koordinat identik | 0 |
| Bunda Gita (`b3bb9b18…`) | Rumah Tambaksari | Rumah Tambaksari 2 | alamat + koordinat identik | 0 |
| Bunda aden (`66741a46…`) | Rumah Simokerto | Rumah Simokerto 2 | alamat + koordinat identik | 0 |
| Bunda lutfiah (`3b4f0cdb…`) | Rumah rungkut | Rumah rungkut kidul | koordinat identik, teks sama | 1 cancelled |

### B. Aman di-merge dengan aturan tambahan (3)
| Customer | Winner | Victim | Bukti | Reservasi victim |
|---|---|---|---|---|
| Bunda Kristi (`d0066fb4…`) | Rumah Tanggulangin (`gps_pin`) | Rumah ngampelsari (tanpa koordinat) | teks alamat **identik** `perum taman candiloka blok L1/10, candi`; beda metadata kecamatan | 0 (winner punya 1 confirmed aktif) |
| Bunda Savira (`063a3e04…`) | Rumah Karang Pilang | Rumah Surabaya (kosong total) | kartu victim tanpa alamat/kelurahan/koordinat; kota sama | 0 |
| Bunda Mia (`8f9e6124…`) | Rumah Sidoarjo (primary) | Rumah Sidoarjo 2 (kosong total) | dua kartu kosong, kota sama | 0 |

### C. Perlu review manusia — JANGAN auto-merge (6)
| Customer | Kartu | Alasan |
|---|---|---|
| Babyspanisa (`51163606…`) | Rumah Taman vs Rumah Wonocolo | teks alamat sama (`High point Apartemen Siwalankerto`) tetapi koordinat berjarak ±3,6 km dan wilayah beda; salah satu koordinat kemungkinan salah |
| Bunda Ayu (`dbd3961b…`) | Rumah Menganti vs Rumah Menganti 2 | kelurahan/kecamatan sama; teks berbeda (`Hendrosari` vs `Awan menganti park…`); victim tanpa koordinat |
| Bunda Dian (`df49d28c…`) | Rumah Dukuh Pakis vs Rumah Dukuh Pakis 2 | victim berisi shortlink Google Maps, bukan alamat; perlu resolve link |
| Bunda Ella (`05628f5a…`) | Rumah Buduran vs Rumah Buduran 2 | teks `Suko` vs `Safira Juanda resort`, dua-duanya tanpa koordinat; belum ada bukti rumah sama |
| Bunda Mia Rachmawati (`f313e381…`) | Rumah Sidoarjo (Kota) vs … 2 | koordinat berjarak ±0,6 km, kecamatan sama, kelurahan beda; kemungkinan batas wilayah |
| Bunda Wieda (`9bc6aa59…`) | Rumah Waru vs Rumah Waru 2 | teks `Griyo Mapan Sentosa` vs `Perum griyo mapan…`; koordinat ±1,5 km; kemungkinan cluster sama tapi belum pasti |

### D. Rumah berbeda — pertahankan (4)
| Customer | Kartu |
|---|---|
| Bunda Husna (`e22c1457…`) | Gayungan vs Jambangan |
| Bunda Nandawulan (`ea665fdf…`) | Sambikerep vs Taman |
| Bunda Riska Elia (`f5888823…`) | Sedati vs Sawahan |
| Bunda Briella (`fa1ec752…`) | Tandes vs Gunung Anyar |

## Catatan penting
- `--commit` pada script existing akan menerapkan **7 `SYNC_ADDR_FROM_CUSTOMER`** juga, bukan hanya merge. Aksi sync itu belum direview; jangan jalankan commit global.
- Semua victim pada kategori A/B memiliki **0 reservasi aktif**. Satu-satunya referensi non-aktif adalah 1 reservasi `cancelled` milik Bunda lutfiah.
- Rekomendasi: backup `pg_dump`, lalu merge per-customer kategori A+B (7 customer) dengan transaksi dan filter tenant/customer. Kategori C menunggu keputusan manusia.

## Eksekusi (2026-11-13)
- **Status:** COMMITTED — 7 customer kategori A+B sudah di-merge dalam satu transaksi.
- **Backup:** `/home/ubuntu/backups/phase7_address_healing_20261113_144535.dump` (SHA-256 `b492bf79d31a44f82d2cf1f544604a734b354d3beb9f3dd1e9eff44c3caf9f9d`) + snapshot JSON `phase7_address_healing_20261113_144535.json`.
- **Aksi:** 7 baris `customer_addresses` victim dihapus; 7 reservasi (1 `cancelled` milik Bunda lutfiah) direlink ke winner; 7 `preferences.saved_addresses` dibersihkan; 7 audit `ADDRESS_HEALING_MERGE`.
- **Verifikasi:** multi-kartu **17 → 10**; victim cards left 0; victim reservations left 0; orphan FK 0; primary anomaly 0; semua winner tetap ada di `preferences.saved_addresses`; victim ID 0 di preferences.
- **Sisa 10 multi-kartu:** 6 kategori C (review) + 4 kategori D (rumah berbeda, dipertahankan).

## Eksekusi lanjutan — kategori C yang sama (2026-11-13)
- **Dasar keputusan user:** merge kartu yang jelas rumah sama; **abaikan customer yang belum punya reservasi**.
- **Di-merge (5):** Bunda Ayu, Bunda Dian, Bunda Ella, Bunda Mia Rachmawati, Bunda Wieda.
  - Bunda Ella: winner `Rumah Buduran 2` di-rename menjadi `Rumah Buduran`.
  - Bunda Mia Rachmawati: teks alamat winner dipertahankan; koordinat/sumber/ongkir `gps_pin` dari victim disalin ke winner.
- **Dibiarkan (1):** Babyspanisa — dua kartu tanpa reservasi; sesuai arahan user, tidak difokuskan.
- **Backup:** `/home/ubuntu/backups/phase7b_address_healing_20261113_150821.dump` (SHA-256 `f343169faaedb2f88fe0487abd48f895de186a6536fd2b94874359b2921f3862`) + snapshot JSON.
- **Aksi:** 5 victim dihapus; reservasi victim direlink; 5 preferences dibangun ulang dari tabel; 5 audit `ADDRESS_HEALING_MERGE`.
- **Verifikasi:** multi-kartu **10 → 5**; victim cards 0; orphan FK 0; primary anomaly 0; victim ID di preferences 0; audit total 12.
- **Sisa 5 multi-kartu:** Babyspanisa (tanpa reservasi, dibiarkan) + 4 rumah berbeda (Husna, Nandawulan, Riska, Briella).
