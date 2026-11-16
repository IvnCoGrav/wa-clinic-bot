## Deskripsi Perubahan
<!-- Jelaskan secara ringkas apa yang diubah dan alasan perubahannya -->

## Reuse & Architecture Checklist (Mandatory)
- [ ] Sudah cek `docs/MODULE_INDEX.md` dan menjalankan `npm run find:module -- "<kebutuhan>"`
- [ ] Tidak menambah deklarasi simbol terlarang (cek via `npm run check:reuse`)
- [ ] Tidak menambah akses Prisma langsung di dalam rute Fastify (gunakan service/repository)
- [ ] Tidak menambah `fetch()` langsung di komponen dashboard (kecuali allowlist di `ui-registry.json`)
- [ ] File baru tidak melebihi 1.500 baris fisik kode
- [ ] Komponen atau halaman baru terdaftar di `packages/admin-dashboard/src/ui-registry.json` (halaman baru wajib memiliki nomor ADR)
- [ ] Tidak menggunakan `window.confirm()` atau `window.alert()` (gunakan `useUiFeedback`)
- [ ] Gerbang regresi lokal lulus:
  - `npm run check:reuse` (hijau / 0 pelanggaran baru)
  - `npm run check:architecture` (hijau / 0 pelanggaran baru)
  - `npm run check:ui-reuse` (hijau / 0 pelanggaran baru)
  - `npm run typecheck` & `npm test`
