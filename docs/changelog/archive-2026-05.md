# Changelog Archive - 2026-05

Arsip riwayat perubahan untuk periode 2026-05.
#### 2026-05-14 — Guard foto rumah wajib GPS + respons jujur (belum deploy live)

- **Akar masalah:** `staff-reservation.service.ts:1197-1264` simpan foto tanpa syarat koordinat; respons selalu sukses menipu; route `today.subroute.ts:424` & `customers.subroute.ts:929` tanpa guard; frontend `StaffToday.tsx:1446`/`TodayTreatments.tsx:679` kirim foto tanpa GPS + toast sukses sebelum server. Live: 3 foto tanpa lat/lng — Cynthia Buduran, Keke medokan ayu, Nurmaya Mulyorejo (`preferences.house_photo_url IS NOT NULL AND lat IS NULL`).
- **Fix fondasional:** Guard deterministik di `staff-reservation.service.ts:1096-1102` (foto+null GPS → 400), `today.subroute.ts` & `customers.subroute.ts:949-957` guard sama, `StaffToday.tsx:1447`/`TodayTreatments.tsx:682` blokir submit (`hasPhoto && !locCoords → error`), respons tambah `coordsUpdated` + pesan cabang. Prompt tidak dipakai.
- **Test:** `tests/unit/staff-location-photo-guard.test.ts` (3 kasus: foto-null→blokir, foto+GPS→lolos, landmark-only→lolos) — TDD red→green.
- **Legacy & monitor:** `docs/KNOWN_ISSUES.md#1c` — 3 nama di atas ditugaskan re-capture; monitor query harus 0 baris.
- **Belum deploy live** — menunggu gate Fase 4 hijau + konfirmasi.

