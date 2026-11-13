/**
 * Domain: Buku Alamat Pelanggan (Multi-Address Support) — FUNGSI MURNI.
 *
 * DOM-02: modul 620 baris dipecah per tanggung jawab di
 * `src/domain/customer-address/` (types, internal, matching, list, tombstones).
 * File ini tinggal re-export agar seluruh pemanggil lama tetap kompatibel.
 *
 * Invarian (dijaga modul turunan):
 *  - `isPrimary` tepat 1 bila daftar tidak kosong.
 *  - Label unik per customer (auto-suffix angka bila kembar).
 *  - Dedup ketat: dua rumah beda jalan dalam kecamatan sama TETAP 2 entri;
 *    hanya alamat identik (jalan+kelurahan+kecamatan) atau titik <150 m yang digabung.
 */
export * from './customer-address/index';
