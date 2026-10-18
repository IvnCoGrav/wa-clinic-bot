# Changelog

Semua perubahan signifikan pada proyek ini didokumentasikan di sini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
dan proyek ini menggunakan [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


#### 2026-10-18 - Fix: Tindak Lanjut Audit Alamat (Flaky Test Timeout, Hardening API Buku Alamat, Konsistensi Chip Alamat Staf & Verifikasi Sheets F-7)

- **Akar masalah**: ronde audit pasca S-1..S-5 menyisakan 3 timeout flaky saat full-suite penuh (bukan regresi logika), route buku alamat menelan error tak terduga sebagai 500 generik sambil membocorkan `err.message`, `label` alamat tak berbatas panjang, chip provenance alamat tidak konsisten antar tab staf, dan klaim F-7 (Sheets basi) belum diverifikasi terhadap kode nyata.
- **Flaky test (deterministik, bukan masking)**: `tests/unit/media-mime-audio.test.ts` & `tests/unit/media-route-range.test.ts` mendapat `vi.setConfig({ testTimeout: 20000 })`; `tests/unit/customer-profile-edit-drift.test.ts` (Fase S-2) memindahkan impor/boot `buildApp()` ke `beforeAll` + `testTimeout 20000 / hookTimeout 30000`. Bukti: full suite kembali ke baseline **14 uji / 7 berkas** (189 dtk), trio flaky hilang.
- **Hardening API buku alamat (`src/routes/admin/customers.subroute.ts`)**: `POST /:id/addresses` & `PATCH .../:addressId/label` kini `console.error` internal + respons 500 generik ("Gagal menambahkan alamat. Silakan coba lagi." / "Gagal mengubah label alamat. Silakan coba lagi.") sehingga pesan internal tidak bocor.
- **Domain (`src/domain/customer-address.ts`)**: `MAX_ADDRESS_LABEL_LENGTH = 60` + `normalizeAddressLabel()` (trim + slice) dipakai `buildAutoLabel` (termasuk suffix) dan seam merge kartu; route menolak 400 "Label maksimal 60 karakter."; `AddressBookDrawer.tsx` menambah `maxLength` + guard toast (konstanta cermin).
- **Konsistensi provenance alamat staf (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**: chip `AddressUpdatedAtChip` ("Alamat diperbarui X jam lalu") sebelumnya hanya di tab "Hari Ini"; kini tampil juga di kartu tab upcoming (jadwal mendatang), kartu completed, dan modal detail tugas. Koreksi catatan audit: `StaffSchedule.tsx` bukan gap (proksi 13 baris ke `StaffToday defaultTab="upcoming"` yang memang sudah menampilkan alamat).
- **Verifikasi F-7 (Sheets) — LULUS tanpa perubahan kode**: `PrismaSheetsSyncStore.getReservation` (`sheets-sync.service.ts:389-418`) memang meng-`include` `customer_address`, `syncReservation:252` meneruskannya, dan `resolveLocation`/`resolveOngkir` memprioritaskan kartu di atas profil (sudah dikunci tes `customer-address-rumah-kedua.test.ts:248,275`). Yang tetap tertunda hanya override "profil lebih baru" (didokumentasikan di `KNOWN_ISSUES.md` #266.53).
- **Gerbang regresi**: `npm run build` root exit 0; `tsc --noEmit` dashboard exit 0; 7 berkas tes terkait hijau (35 tests); full suite `7 failed | 688 passed` = baseline pra-eksisting, **0 regresi baru**.
- **Dokumentasi**: `docs/KNOWN_ISSUES.md` #266 butir 1–3 & 5 ditandai FIXED/CLOSED + koreksi klaim U-4 + verifikasi F-7; INDEX changelog diregenerasi.
- **Verifikasi operasional Bunda Firda (Fase 2) — DIBATALKAN setelah dry-run produksi**: dry-run read-only pada reservasi `f9981d32` menunjukkan premis ghost-address TIDAK terpenuhi (reservasi berstatus `completed`, reservasi aktif pelanggan = 0; dua kartu berteks Sukolilo identik). `--commit` akan meng-upsert "Perumdos ITS" sebagai `isPrimary` dan menurunkan kartu primary Sukolilo tanpa bukti masalah → **tidak dieksekusi** atas keputusan user; temuan + catatan teknis (jalankan `node /app/dist/scripts/*.js`, backup di `/app/backups` ephemeral) dicatat di `KNOWN_ISSUES.md` #266.


#### 2026-10-18 - Feat: SSOT Media Balasan Cepat (/pricelist & /qris), Hardening bodyLimit 12MB & Kompresi Klien

- **Akar Masalah & Kebutuhan**:
  - Balasan cepat `/pricelist` sebelumnya belum mendukung resolusi gambar otomatis (SSOT) dari pengaturan tenant `pricelist_image_url`, sehingga staf harus mengunggah ulang brosur secara manual atau gambar tidak terlampir.
  - Unggah lampiran gambar kustom resolusi tinggi pada menu Balasan Cepat di dashboard kerap memicu error `Request body is too large` (HTTP 413) karena batas bawaan Fastify bodyLimit (~1MB) dan ketiadaan kompresi di sisi klien.
- **Backend (`quick-replies.subroute.ts`)**:
  - Menambahkan tipe media `PRICELIST` pada validator route POST dan PUT.
  - Helper deliverability `isDeliverableMediaRef`: memastikan hanya URL publik `http(s)` atau media outbound `/media/outbound/...` yang dikirim ke gateway; jika belum diunggah, `image_url` disetel `null` secara aman sehingga teks pesan tetap terkirim tanpa error.
  - Resolusi SSOT `resolveQuickReplyMedia`: secara dinamis membaca `getPricelistImageUrl(tenantId)` tanpa duplikasi storage (0 MB overhead).
  - Ensure-seed pada handler `GET /api/admin/quick-replies`: memastikan template default `/qris` dan `/pricelist` otomatis di-seed untuk tenant tanpa menghapus template kustom yang sudah ada.
  - Hardening rute `bodyLimit: 12 * 1024 * 1024` (12MB) pada POST dan PUT `/api/admin/quick-replies` untuk menampung data URL base64 gambar beresolusi tinggi.
- **Frontend Dashboard (`packages/admin-dashboard`)**:
  - `QuickReplies.tsx`: Kartu ke-4 "Pricelist Resmi" (SSOT Pricelist) lengkap dengan preview brosur dinamis dari `/api/admin/settings/pricelist-image` dan badge status di daftar kartu.
  - Kompresi gambar sisi klien di `QuickReplies.tsx` menggunakan `compressImageFile` profil `'chat'` (`imageCompressor.ts`), mereduksi ukuran file foto/brosur sebelum dikirim ke API.
  - `LiveChatMonitor.tsx` & `LiveChatComposer.tsx`: Menetapkan `fileName: 'pricelist-klinik'` saat `media_type === 'PRICELIST'` serta ikon `FileText` pada popover autocomplete quick reply.
- **Pengujian & Keamanan**:
  - `tests/unit/quick-replies.test.ts` (13 tests): pengujian `DEFAULT_QUICK_REPLIES` mencakup `/pricelist`, validasi ketat `isDeliverableMediaRef`, dan resolusi dinamis `resolveQuickReplyMedia` untuk PRICELIST (outbound terkirim, fallback lokal null, DB error fail-safe).
  - `tests/integration/quick-replies-media.test.ts` (4 tests): pengujian adversarial payload ~3MB lolos (bukan 413), penolakan tegas batas payload >12MB (413), keabsahan POST/PUT `media_type: PRICELIST`, dan penolakan validator `media_type` sembarang (400).
  - Gerbang regresi: `npm run build` root + dashboard 100% hijau; 17 tests terkait quick replies 100% hijau.


#### 2026-10-18 - Fix: Regresi Gerbang Recalc Jarak/Ongkir & Tulis Ganda (Audit Pasca S-1..S-5)

- **Akar masalah (fondasional, lintas lapisan)**: gerbang auto-recalc di `customer.service.ts`
  membandingkan nilai dengan hasil baca **SETELAH** `prisma.customer.update`
  (read-after-write). Akibatnya `coordsChanged` & `kecamatanDrift` **selalu false**:
  (a) edit koordinat eksplisit tidak lagi menghitung ulang jarak/ongkir; (b) koreksi
  drift wilayah (Suko→Waru) tidak lagi di-geocode ulang. Diperparah karena
  `getCustomerById` dapat mengembalikan **referensi objek cache memori** yang lalu
  dimutasi `Object.assign` pasca-tulis (retroaktif).
- **Fixed — snapshot PRA-TULIS**: `updateCustomer()` kini mengambil satu pembacaan
  `priorCustomer` sebelum tulis dan menyimpan **salinan primitif**
  (`priorLat/priorLng/priorKelurahan/priorKecamatan/priorKota/priorIsPrecise`).
  Seluruh gerbang (`coordsChanged`, `explicitCoords`, `preciseLocked`,
  `kecamatanDrift`, `hasCoords`, `needsGeocode`) dan fallback geocode memakai
  snapshot tersebut, bukan `finalCustomer`.
- **Removed — tulis ganda**: dua pemanggilan `repo.update()` di dalam
  `updateCustomer()` (tulis utama & recalc) dihapus; penulis kanonis tunggal adalah
  `prisma.customer.update` + sinkron cache memori (repo default
  `PostgresCustomerRepository` menulis ke tabel yang sama → duplikasi).
- **Changed — fail-visible**: kegagalan tulis hasil recalc tidak lagi ditelan
  `.catch(() => {})`; kini `console.error` menyertakan `customerId` + pesan error.
- **Tests**: `tests/unit/customer-profile-edit-drift.test.ts` — 4 uji regresi yang
  sebelumnya terhapus dipulihkan + 1 uji baru (koordinat eksplisit berubah dengan
  kecamatan sama → jarak & ongkir dihitung ulang). Bukti revert-and-rerun: uji
  tersebut GAGAL pada kode S-1..S-5 dan LULUS pada HEAD → regresi nyata.
- **Verifikasi**: `npm run build` exit 0; full suite 10 file gagal = 7 baseline
  pra-eksisting + 2 timeout media + 1 timeout S-2 (5178 ms) — himpunan yang sama
  terbukti pada kode HEAD (beban runner, bukan regresi logika).


#### 2026-10-18 - Fix: Penutupan Celah Seam Lokasi Tunggal, Relink Profil & Tombstone Anti-Rebirth (S-1..S-4, S-UX)

- **S-1 — Seam Relink Profil & Anti-Downgrade Koordinat (`customer.service.ts`)**:
  - `updateCustomer()`: menutup celah relink; saat profil customer mengalami modifikasi lokasi (`touchedLocation`), kini secara deterministik memanggil `syncSavedAddressFromLocation` dan `syncActiveReservationsAfterLocationChange` (dengan penanganan fail-safe anti-crash webhook chat).
  - Mengunci `location_source`: form yang mengirim kembali koordinat presisi tanpa perubahan (`coordsChanged === false`) tidak lagi mendowngrade `gps_pin` menjadi `manual_staff`.
- **S-2 — Gate Koordinat Benar-Benar Berubah (`customers.subroute.ts`)**:
  - `PUT /api/admin/customers/:id/location`: hanya memanggil `customerService.updateCustomerLocation` jika koordinat benar-benar berubah (`coordsChanged`). Mengedit landmark/catatan patokan tanpa mengubah titik koordinat tidak lagi memicu relink jadwal aktif ke rumah utama secara semena-mena.
- **S-3 — Tombstone Address Book Saat Hapus Kartu (Anti-Rebirth)**:
  - `src/domain/customer-address.ts`: menambahkan `AddressTombstone`, `parseAddressTombstones`, `pruneAddressTombstones` (max 20 entri FIFO, kedaluwarsa 90 hari), `matchesTombstone`, `removeMatchingTombstones`.
  - `customer.service.ts`: `deleteSavedAddress` merekam tombstone ke `Customer.preferences.address_tombstones`. `syncSavedAddressFromLocation` memeriksa tombstone sebelum membuat kartu baru (mencegah kartu terhapus bangkit kembali). `addSavedAddress` / `upsertSavedAddress` membersihkan tombstone yang cocok saat admin/user sengaja mendaftarkan kembali alamat tersebut.
  - `reservation-core.service.ts`: `resolveCustomerAddressId` memeriksa tombstone; kandidat alamat yang telah di-tombstone tidak akan dibuatkan kartu Rumah 2 baru melainkan fallback ke kartu utama.
- **S-UX — Aksesibilitas Drawer & Penambahan Alamat UI Admin**:
  - `AddressBookDrawer.tsx`: menambahkan listener tombol `Escape` untuk menutup drawer / membatalkan mode edit/tambah secara alami.
  - `AddressBookDrawer.tsx`: tombol dan form inline "+ Tambah Alamat" terpadu (label, jalan, kelurahan, kecamatan, kota, isPrimary) tanpa page-bloat.
  - `customers.subroute.ts`: route baru `POST /api/admin/customers/:id/addresses` dengan validasi label wajib dan respon 201.
  - `CustomerEditForm.tsx`: copy dialog konfirmasi diperjelas untuk memberitahu bahwa jika customer memiliki jadwal aktif, jadwal tersebut akan diselaraskan ke lokasi baru.
- **S-4 — Pengujian & Keamanan**:
  - `tests/unit/customer-profile-edit-drift.test.ts` (6 test): verifikasi relink jadwal aktif saat edit profil, fail-safe saat sync gagal, proteksi downgrade gps_pin, dan proteksi edit landmark tanpa ubah koordinat.
  - `tests/unit/customer-address-book.test.ts` (+9 test, total 27 test): verifikasi perekaman tombstone, anti-rebirth sync lokasi, pruning kedaluwarsa >90 hari, pembersihan tombstone saat re-add, fallback resolver, dan proteksi IDOR lintas-tenant (404).
  - Gerbang regresi: `npm run build` root + dashboard hijau; 9 test suites / 93 tests terkait alamat 100% hijau.


#### 2026-10-18 - Feat: Buku Alamat & Transparansi Alamat (R1–R4)

- **R1 — Backend buku alamat + Drawer admin**:
  - `src/domain/customer-address.ts`: helper murni `removeAddressFromList` (invarian tetap 1 primary; hapus primary → gelar pindah ke kartu `lastUsedAt` terbaru).
  - `src/services/customer.service.ts`: `deleteSavedAddress()` — **guard fail-closed**: kartu dipakai jadwal AKTIF DILARANG dihapus (`deleted:false + activeCount`, jendela `isActiveReservation` dihormati); hapus sukses membersihkan DUA sumber (preferences JSON + baris tabel `customer_addresses` via `deleteMany` → anti split-brain, event `ADDR_BOOK_DELETE_TABLE_FAILED` bila tabel gagal).
  - Routes admin baru (`customers.subroute.ts`): `PATCH .../addresses/:addressId/default` (jadikan utama), `PATCH .../addresses/:addressId/label` (rename via seam `upsertSavedAddress`, id & createdAt kartu tetap), `DELETE .../addresses/:addressId` (409 + `activeCount` saat dipakai jadwal aktif).
  - `packages/admin-dashboard/.../customer/AddressBookDrawer.tsx` (BARU): Drawer (mobile bottom-sheet) Jadikan Utama / Ubah Label / Hapus kartu, semua via `useUiFeedback` (tanpa `window.confirm/alert`), tombol ≥44px; dipanggil dari panel detail CustomerDatabase (tanpa page baru).
  - `tests/unit/customer-address-book.test.ts` (18 test adversarial): invarian primary, guard 409, jendela waktu ≥2 jam, dual-write cleanup, delegasi route 200/404/409/400.
- **R2 — Provenance alamat kartu terapis**:
  - `buildEffectiveTaskAddress` kini mengembalikan `address_source` (`card`|`profile`) + `address_updated_at` (waktu sumber terpilih terakhir diperbarui).
  - Tiga serializer kartu terapis (today/upcoming/completed) meneruskan kedua field; `StaffToday.tsx` menampilkan chip `📍 Alamat diperbarui Xj lalu` HANYA bila < 24 jam (server-driven, bukan tebakan klien).
  - Extensi `tests/unit/staff-task-effective-address.test.ts` (3 test provenance).
- **R3 — Util cermin FE + anti-drift**:
  - `packages/admin-dashboard/src/utils/addressMatch.ts` (BARU): cermin 1:1 semantik dedup `src/domain/customer-address.ts` untuk FE.
  - `tests/unit/dashboard-address-match-parity.test.ts` (10 vektor + simetri): backend domain vs FE mirror WAJIB identik — badge "rumah baru" FE tidak lagi menebak beda dengan dedup server (badge palsu "beda kartu" untuk kartu pin-only turun).
  - `CreateReservationModal.tsx`: cek mismatch memakai cermin + chip persisten "Akan disimpan sebagai rumah baru" (state, bukan toast sekali-lewat); reset saat kartu dipilih lagi.
- **R4 — Tracing kartu di detail reservasi**:
  - `GET /api/admin/reservation/:id` kini `include: { customer_address: true }`.
  - `ReservationDetailModal.tsx`: baris `Kartu Alamat: <label> (Utama/Kedua) · Ongkir Rp X` saat kartu ada (klinis & jujur, menghilang bila tak ada).
- **Gerbang regresi**: `npx tsc --noEmit` + build dashboard hijau; suite relevan F0 74/74; tes baru tersedia di 4 file; full-suite gate dijalankan pasca-fitur (baseline 14 pre-existing di KNOWN_ISSUES #266).


#### 2026-10-18 - Fixed: Hasil Audit Sistem Berlapis atas Implementasi Alamat Kedua (A-010..A-018)

- **Audit read-only** (`audit-sistem-berlapis` Tahap 0–6) menemukan 4 bug TERBUKTI + 2 risiko di implementasi Fase RC-1..RC-5. Semua fix menyentuh akar lapisan kode/state, bukan tambal prompt:
  - **A-010 (bug, RPN 168)**: blok RC-1 di `src/routes/admin/reservation-dispatch.route.ts` membaca field camelCase dari baris Prisma (snake_case) → koreksi teks alamat pada kartu SEKUNDER selalu mempromosikannya jadi primary (dan `distanceKm`/`locationSource` salah sumber). Kini membaca `is_primary`/`distance_km`/`location_source` dengan fallback camelCase. Test adversarial baru: fixture `is_primary:false` → tetap sekunder.
  - **A-012 (privasi, RPN 168)**: fallback `areaLine` di pre-visit brief Telegram (`staff-notification.service.ts`) memotong alamat jalan pada koma → alamat tanpa koma membocorkan jalan + no rumah (melanggar kontrak G2=B). Fallback DIHAPUS: bila kelurahan/kecamatan kosong, baris Area Kunjungan dihilangkan. 2 test baru.
  - **A-013 (performa, RPN 63)**: seam sinkronisasi jadwal di `goal-tracker.ts` berjalan SETIAP turn berlokasi walau tak ada perubahan → kini gated `locationChanged` (sudah tersedia di scope). Test baru `tests/unit/goal-tracker-address-sync-gate.test.ts` (4 skenario, terbukti merah pre-fix).
  - **A-011 (edge, RPN 70)**: `customerAddressId: null` EKSPLISIT kini dihormati sebagai niat detach (RC-1 tidak jalan); field absen tetap auto-resolve. Test baru.
  - **A-016 (observabilitas)**: kegagalan per-reservasi kini mencetak event terstruktur `ADDR_SYNC_RESERVATION_FAILED` (reservationId + targetAddressId) di `reservation-address-sync.service.ts`, bukan warn generik.
  - **A-014 (hardcode)**: `heal-firda-active-address.ts` tidak lagi menyimpan default ID reservasi — `--reservation=<id>` WAJIB.
  - **A-017 (test hygiene)**: mock `prisma.customer.update` di describe RC-1 kini di-restore ke kontrak setup (`afterEach`), mencegah bocor ke test masa depan.
  - **A-015 (desain)**: keputusan pengguna = **status quo** (relink otomatis saat rumah baru; hanya audit log sistem). Tercatat di KNOWN_ISSUES #266.
  - **A-018**: 14 kegagalan full-suite pre-existing didaftarkan di KNOWN_ISSUES #266.
- **Gerbang regresi**: build hijau; full suite `npm test` 2× rerun konsisten = 5673 lulus / 14 gagal (semua pre-existing yang telah terdaftar; delta +8 test dari test baru audit). Satu anomali run pertama (15 gagal) tidak reprodusibel 2× rerun → dicatat sebagai observasi flaky, bukan regresi.

#### 2026-10-18 - Fix: Arsitektur Alamat Kedua & Sinkronisasi Jadwal Aktif (RC-1..RC-5, Fase 1-5)

- **Fase 1 — Seam kanonis sinkronisasi jadwal aktif**:
  - `src/services/reservation-address-sync.service.ts` (BARU): `syncActiveReservationsForCustomer({ tenantId, customerId })` — menyelaraskan seluruh reservasi AKTIF pelanggan ke kartu alamat kanonis (via `resolveCustomerAddressId`) + snapshot `delivery_fee`; idempoten, best-effort, tenant-aware, tulis hanya lewat seam (DILARANG `prisma.customerAddress.*` langsung).
  - Wiring seam di **tiga rezim penulis lokasi**: `customer.service.ts` (`updateCustomerLocation`, jalur DB & memori), `v3/state/goal-tracker.ts` (mirror durable V3), `staff-reservation.service.ts` (`updateCustomerLocation` lapangan).
  - RC-1 anti ghost-shadowing: `POST/PATCH /api/admin/reservation/:id` — edit teks alamat tanpa ID kartu eksplisit kini me-resolve kartu kanonis via seam (rumah SAMA → perbarui teks; rumah BEDA → kartu sekunder tanpa relink otomatis, tanpa mencampur koordinat presisi lama) + snapshot `delivery_fee`.
  - `tests/unit/reservation-address-sync.test.ts`: 8 skenario (status kanon hold/pending/future, completed/cancelled diabaikan, 2 rumah tidak mencampur, idempoten, audit, customer hilang).
  - `tests/unit/admin-create-reservation.test.ts`: 4 skenario RC-1 (rumah sama/beda, ID eksplisit menang, primary pertama).
- **Fase 2 — Pemulihan data operasional**:
  - `src/scripts/heal-firda-active-address.ts` (BARU): dry-run/commit idempoten, menulis lewat seam (`upsertSavedAddress` + `syncActiveReservationsForCustomer`), backup JSON pra-commit.
- **Fase 3 — Attachment teks alamat (RC-4/A-004)**:
  - `human-background-enrichment.service.ts`: guard `already_has_location` & `gps_pin_guard` kini menempelkan teks jalan SPESIFIK ke kartu rumah yang benar (rumah sama → teks; rumah beda → kartu sekunder) TANPA menimpa pin presisi (anti data hibrida).
  - `v3/state/goal-tracker.ts`: cap `location_updated_at` HANYA bila lokasi benar-benar berubah (bukan tiap turn).
- **Fase 4 — Read-side unification (RC-3/A-005) + Pre-visit brief (RC-5/A-008)**:
  - `buildEffectiveTaskAddress` (staff-reservation.service.ts): rumah SAMA + koreksi profil lebih baru (`location_updated_at`) → pakai profil; rumah BEDA → kartu reservasi; tanpa timestamp → byte-identik (anti-regresi).
  - `staff-notification.service.ts`: notifikasi Telegram (assign + itinerary) & pre-visit brief memakai seam yang sama; brief menambah baris **Area Kunjungan** ringkas (kelurahan/kecamatan), tetap tanpa alamat lengkap/no HP.
  - `sheets/row-formatter.ts`: komentar cermin kanon (lihat KNOWN_ISSUES #266 untuk batasan).
- **Fase 5 — UI**:
  - `packages/admin-dashboard/.../CreateReservationModal.tsx`: badge `⚠️ Teks alamat berbeda dengan kartu terpilih` + tombol `[+ Simpan Sebagai Rumah Baru]` (memakai `useUiFeedback`, tanpa `window.confirm/alert`), tanpa page baru.
- **Gerbang regresi**: `npm run build` (root + dashboard) hijau; full suite `npm test` = 5665 lulus / 14 gagal (semua **pre-existing**, dibuktikan revert-and-rerun ke HEAD). Zero migrasi skema, zero dependency baru.


#### 2026-10-18 - Feat: Quick Chat Berbasis Gambar & QRIS Terintegrasi (Fase 1 - 4)

- **Fase 1 — Database, Backend Seam & Smart Caption Splitter**:
  - `prisma/schema.prisma` & migrasi `20261018010000_add_quickreply_media`: Menambahkan kolom `media_type` (`NONE` | `CUSTOM_IMAGE` | `QRIS`) dan `image_url` ke model `QuickReply`.
  - `src/routes/admin/quick-replies.subroute.ts`:
    - Mengganti template `/rek` lama yang di-hardcode dengan `/qris` yang terhubung secara SSOT ke `Tenant.settings.paymentInfo`.
    - Menambahkan fungsi resolver dinamis `resolveQuickReplyMedia` untuk mengganti `{bank_accounts}` dan `{petunjuk}` secara runtime saat fetch, serta resolusi `image_url` QRIS resmi dan deteksi `mime_type`.
    - Menambahkan dukungan `media_type`, `image_url`, `imageB64` pada endpoint POST dan PUT quick-replies.
    - Menyelaraskan auto-seed di GET, `seed-defaults`, dan fallback in-memory (`initMemoryDefaults`).
  - `src/routes/admin/livechat.subroute.ts`: Menambahkan dukungan `mediaUrl` pada body request endpoint `/reply` dan meneruskannya ke `liveChatService.sendAdminReply`.
  - `src/services/caption-splitter.ts`: Mengekstrak util bersama `splitImageCaption` (threshold 1000 char) untuk membagi caption media WhatsApp dan sisa pesan lanjutan.
  - `src/services/staff-reservation.service.ts`: Merefaktor pemanggilan pengiriman QRIS menggunakan util bersama `splitImageCaption`.
  - `src/services/live-chat.service.ts`: Mengintegrasikan `splitImageCaption` pada pengiriman gambar di `sendAdminReply`, dengan pengiriman teks lanjutan sekuensial.

- **Fase 2 — Quick Replies Manager (Frontend Dashboard)**:
  - `packages/admin-dashboard/src/pages/tenant/QuickReplies.tsx`:
    - Menambahkan pemilih tipe media (Teks Saja, QRIS Resmi Klinik, Upload Gambar Kustom).
    - Menghubungkan preview live barcode QRIS resmi klinik dari Settings Pembayaran.
    - Menambahkan dropzone gambar kustom (≤ 8 MB) dengan preview thumbnail.
    - Menampilkan badge indikator media (`[QRIS]`, `[GAMBAR]`) dan thumbnail pada grid kartu template.

- **Fase 3 — Live Chat Composer & Monitor (Frontend Dashboard)**:
  - `packages/admin-dashboard/src/components/livechat/LiveChatComposer.tsx`: Menambahkan ikon indikator media (`<QrCode />`, `<ImageIcon />`) pada daftar popover quick replies `/shortcut`.
  - `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`:
    - Memperluas tipe state `selectedImage` agar mendukung `mediaUrl`.
    - Di `applyQuickReply`: otomatis melampirkan gambar/QRIS ke state `selectedImage` saat template dipilih.
    - Di `handleSendReply`: memisahkan jalur `body.mediaUrl` (tanpa upload ulang base64) vs `body.imageB64`.

- **Fase 4 — Pengujian & Gerbang Regresi**:
  - `tests/unit/caption-splitter.test.ts`: 4 skenario pengujian batas panjang caption, pemisahan paragraf, dan penanganan null/empty.
  - `tests/unit/quick-replies.test.ts`: 10 skenario pengujian CRUD in-memory, resolusi dinamis SSOT dari `paymentInfo`, pengujian adversarial saat data bank kosong, dan sanitasi ekstensi ke MIME type.
  - `tests/integration/live-chat-reply.test.ts`: Verifikasi pengiriman balasan admin dengan `mediaUrl` ke gateway WhatsApp.
  - Validasi build: `npm run build` (bot engine) dan `npm run build` (`admin-dashboard`) lulus 100%.

#### 2026-10-18 - Fixed: Triase Klinis Deterministik, Pencegahan Kontaminasi Subjek, Metadata Kelayakan Katalog & Perampingan Call 1 Router (Fase 0 - 7)

- **Fase 0 — Kunci Regresi Track 1**:
  - Memverifikasi pencabutan `stripNominalAges` dan keabsahan `hasAgeQuestion` di guardrail pipeline.
  - Memastikan teks rentang usia ("usia 7 - 24 bulan") tidak terpotong oleh pemotong kalimat.
  - Menambahkan pengujian parafrase konsultatif tanpa tanda tanya ("maaf untuk pulih ceria itu gmna ya" -> cart tetap kosong).
  - Berkas uji: `tests/unit/v3-catalog-age-text.test.ts`, `tests/unit/v3-consultative-detection.test.ts`.

- **Fase 1 — Pencegahan Kontaminasi Subjek & MomStage UNKNOWN**:
  - `src/v3/agent/pipeline/tool-pipeline.ts`: Menghentikan fallback penulisan gejala ke anak bila subjek ambigu atau berkonteks ibu. Mengaktifkan `session.pendingSubjectClarification: true`.
  - `src/v3/agent/pipeline/guardrail-pipeline.ts`: Menambahkan pertanyaan subjek deterministik ("Boleh tahu keluhannya untuk Bunda sendiri atau untuk si kecil ya? 😊") saat `pendingSubjectClarification` aktif dan belum ternilai.
  - `src/v3/state/patient-extractor.ts`: `MomStage` default ke `'UNKNOWN'` (bukan `'GENERAL'`) jika tanpa bukti teks klinis eksplisit. `syncMomProfile` kini membaca hingga 6 riwayat pesan user terakhir untuk mendeteksi usia kehamilan atau status kehamilan secara persisten.
  - `src/v3/state/goal-tracker.ts`: Render `formatGoalSessionForPrompt` tidak lagi menyematkan label `'Ibu (Relaksasi Umum)'` saat `MomStage` adalah `'UNKNOWN'`.
  - Berkas uji: `tests/unit/v3-subject-contamination.test.ts` (6 tests lulus 100%).

- **Fase 2 — Evaluasi Klinis Emas (Track 2A)**:
  - Menyusun dan memperluas pengujian deterministik di `tests/eval/golden-conversations.eval.test.ts` untuk memverifikasi 39 kasus validasi klinis (active user commitment, multi-opsi ambigu, bumil aterm, bundle cukur + pulih ceria) dan 9 kasus skenario abu-abu (`gray`) yang dicatat untuk tinjauan Bidan Fase B.

- **Fase 3 — Matriks Triase Klinis (Track 2B)**:
  - Menyusun dokumen resmi `docs/clinical-triage-matrix.md` mencakup 13 skenario triase klinis (TR-01 s/d TR-13) dengan klasifikasi aksi (`ESCALATE`, `SCREEN`, `ASK_STAGE`, `SAFE`), batasan red-flags, dan template teks resmi dari Bidan Yusi (versi 1.0.0).

- **Fase 4 — Metadata Kelayakan Katalog Berbasis Database (Track 2C)**:
  - `prisma/schema.prisma` & migrasi `20261018000000_add_service_clinical_eligibility`: Menambahkan kolom `eligible_life_stages String[]`, `contraindications String[]`, `requires_screening Boolean` ke model `ClinicService`.
  - `src/services/treatment-catalog.service.ts`: Helper `inferEligibleLifeStages` untuk inferensi data-driven life-stages. Di `recommendServiceBySymptoms`, jika `momStage === 'UNKNOWN'`, layanan stage-spesifik diblokir dan sistem mengembalikan `askStage: true`.
  - `src/v3/tools/get-catalog.tool.ts`: Meneruskan `momStage` & `gestationalWeeks`, serta menambahkan `askStage` pada output tool saat layanan tertahan oleh ketidakpastian fase ibu.
  - Berkas uji: `tests/unit/v3-catalog-stage-filter.test.ts` (9 tests lulus 100%).

- **Fase 5 — Triage Gate Deterministik (Track 2D)**:
  - `src/v3/agent/pipeline/medical-signal-detector.ts`: Menambahkan detektor trauma fisik kepala/jatuh (`detectPhysicalTraumaSignal`), kegawatdaruratan medis berat (`detectHighSeverityEmergency`), evaluasi skrining pasca-vaksin (`evaluateScreeningAnswer`), ambiguitas tahap ibu (`detectMaternalStageAmbiguity`), dan fungsi evaluator gerbang triase utama (`evaluateTriageGate`).
  - `src/v3/tools/clinic-faq.tool.ts`: Mendaftarkan topic kebijakan baru: `triage_escalate`, `triage_ask_stage`, `triage_screen` dengan template terstandarisasi.
  - `src/v3/agent/agent-runner.ts`: Menyisipkan Tahap 3c Triage Gate tepat setelah Stage 1b context grounding. Turn darurat medis atau skrining jeda waktu dibalas langsung deterministik via template kebijakan resmi tanpa membuang token LLM router/generator.
  - Berkas uji: `tests/unit/v3-triage-gate.test.ts` (18 tests lulus 100%).

- **Fase 6 — Kalibrasi RAG & Perampingan Call 1 Router (Track 2E)**:
  - `src/v3/agent/pipeline/context-grounder.ts`: Menaikkan ambang rank RAG pre-retrieval dari 0.25 menjadi 0.35. Menghilangkan label kaku `[WAJIB DIPATUHI]` dan menyediakan fallback blok netral jika tidak ditemukan chunk yang relevan.
  - `src/v3/agent/prompt/prompt-composer.ts`: Mengeluarkan blok `[KONFIGURASI PERSONA TENANT (DASHBOARD...)]` dari `composeRouterPromptAsync` Call 1 (tetap utuh untuk Call 2 di `composeSystemPromptAsync`).
  - `src/v3/agent/agent-runner.ts`: Menghapus penempelan artikel RAG `preGroundingBlock` ke `messages[0]` prompt Call 1 router. Ukuran prompt router Call 1 menyusut drastis ke ~800-1200 token.
  - Berkas uji: `tests/unit/v3/dynamic-router-prompt.test.ts` (3 tests lulus 100%).

- **Fase 7 — Pagar Sanitizer & Pengecualian Trimmer Keselamatan (Track 2F)**:
  - `src/v3/guardrails/sanitizer.ts`:
    - `isSafetyOrTriageContent`: Mendeteksi pesan rujukan darurat, skrining tanda bahaya, dan jeda protokol medis.
    - `trimToMaxSentencesPreservingGreetingHeader`: Mengecualikan secara penuh pesan keselamatan, skrining, dan triase medis dari pemotongan batas 3 kalimat.
    - `sanitizeMedicalAffirmation`: Mencegah pembuka ceroboh sembrono ("Boleh banget/Bisa banget") saat customer menanyakan kelayakan medis, dan mentransformasikannya menjadi pembuka santun & netral secara deterministik.
  - `src/v3/agent/pipeline/medical-signal-detector.ts`: Menambahkan `isMedicalSafetyQuery` untuk mendeteksi pertanyaan izin/keamanan medis.
  - `src/v3/agent/pipeline/guardrail-pipeline.ts`: Mengintegrasikan sanitasi afirmasi medis dan pengecualian trimmer.
  - Berkas uji: `tests/unit/v3-safety-sanitizer.test.ts` (10 tests lulus 100%).

#### 2026-10-17 - Feat: Penyelarasan Katalog Layanan, Tarif Promo & Aset Poster Pricelist Resmi Kala Moms and Baby Spa

- **Penyelarasan Data Bisnis & Katalog (Data-Driven SSOT)**:
  - Mengaudit dan menyelaraskan katalog database dan fallback lokal terhadap poster brosur resmi cetak terbaru Kala Moms and Baby Spa.
  - Penyesuaian tarif promo & durasi:
    - `baby-massage-pulih-ceria-newborn`: 40 mnt, Rp 65.000 (orig: Rp 85.000)
    - `bundle-laktasi-oksitosin`: 60 mnt, Rp 70.000 (orig: Rp 200.000)
    - `add-on-nebulizer`: 20 mnt, Rp 80.000 (orig: Rp 100.000)
    - `add-on-nebulizer-obat`: 20 mnt, Rp 110.000 (orig: Rp 130.000)
    - `moms-oksitosin-fullbody`: 60 mnt, Rp 110.000 (orig: Rp 140.000)
    - `moms-postpartum-massage`: Dinonaktifkan (`is_active = false`) karena tidak tercantum pada flyer resmi.
- **Aset & Skrip Sinkronisasi**:
  - `assets/pricelist_spa.jpg`: Diperbarui dengan poster JPEG resmi beresolusi optimal.
  - `scripts/sync_catalog.sql`: Di-regenerate via `generate-sync-sql.ts` untuk sinkronisasi database SQL.
  - Memverifikasi konsistensi data live server dan memastikan seluruh suite test katalog (4 files / 40 tests) lulus 100%.
- **File Dimodifikasi**: `assets/pricelist_spa.jpg`, `services_custom.json`, `src/services/treatment-catalog.service.ts`, `scripts/sync_catalog.sql`, `CHANGELOG.md`.

#### 2026-10-17 - Fixed: Resolusi Deadlock Auto-Pruning Media (Video, Audio & Corrupt Files) via Sniffing Magic Bytes & Pruning Sadar-Konten (Fase 1-5)

- **Akar Masalah (Audit Multi-Lapisan):**
  - **Save-Time Mislabeling & Default .jpg**: `extFromMime` di `media.service.ts` memberikan default `.jpg` untuk semua mime tak dikenal atau `application/octet-stream`. Di samping itu, `webhook.route.ts` memakai fallback `application/${heavyMediaType}` sehingga audio/video yang tidak menyertakan mimetype eksplisit tersimpan di disk sebagai file berekstensi `.jpg` (misal 6 file `.jpg` produksi yang sebenarnya berisi stream audio `OggS`).
  - **Type-Blindness Sharp Thumbnailing**: `ensureThumbForHd` mengasumsikan seluruh file di folder penyimpanan adalah gambar. Ia membaca buffer seluruh file ke RAM (`fs.readFileSync`) dan memaksakannya ke pustaka Sharp (`createBlurThumb`). Sharp menolak memproses audio `.ogg` dan video `.mp4` dengan error `Input buffer contains unsupported image format`.
  - **Pruning Deadlock & Sandera Kuota Disk**: `pruneToLowWatermark` dan `deleteExpiredMedia` membatalkan penghapusan file jika thumbnail gagal dibuat (`continue`). Karena video dan audio tidak bisa dibuatkan thumbnail visual, file-file terbesar ini tidak pernah terhapus sama sekali. Akibatnya, pemakaian penyimpanan menyentuh 100% kuota (207 MB dari kuota 200 MB), auto-prune gagal membebaskan disk, dan sistem mencetak ribuan baris warning loop setiap pesan WhatsApp baru masuk.
  - **Inkonsistensi Ekstensi Thumbnail**: Inbound thumbnail selalu disimpan sebagai `{stem}_thumb.jpg`. Namun `withThumbName()` pada gambar PNG/WebP mencari `{stem}_thumb.{ext}`, menyebabkan thumbnail eksisting tidak terdeteksi dan Sharp dipaksa re-encode ulang secara tidak perlu.
- **Fixed (Fondasional & Deterministik):**
  - **Fase 1 (Fondasi Klasifikasi Konten SSOT & Sniffing Magic Bytes)**:
    - Membuat modul mandiri `src/utils/media-kind.ts` (zero-dependency) untuk mendeteksi `MediaKind` (`image`, `audio`, `video`, `document`, `other`) melalui header magic bytes kanonis (`ffd8ff` JPEG, `89504e47` PNG, `GIF8`, `RIFF..WEBP`, `OggS` Ogg audio, `ftyp` MP4 video, `1A45DFA3` WebM, `%PDF`, `504b0304` ZIP/DOCX).
    - Menambahkan `resolveExtForSave(mime, buf)` yang mengutamakan magic bytes konten ril, fallback ke kelompok MIME, dan default aman `'bin'` (DILARANG default `'jpg'`).
    - Menyelaraskan fallback MIME media berat di `src/routes/webhook.route.ts` menjadi `audio/ogg` dan `video/mp4` bukannya `application/${type}`.
    - Mengintegrasikan `resolveExtForSave` pada `saveInboundMedia` dan `saveOutboundMedia` di `src/services/media.service.ts`.
  - **Fase 2 (Pipeline Prune & Retensi Sadar-Konten)**:
    - Menambahkan helper `isSharpAvailable()` dengan caching dan seam pembersih `clearUsageCache(tenantId?: string)`.
    - Merestrukturisasi `ensureThumbForHd` dengan return status terstruktur (`thumb`, `not-image`, `corrupt-image`, `engine-unavailable`).
    - Memeriksa eksistensi thumbnail dengan dua pola: `{stem}_thumb.{ext}` dan `{stem}_thumb.jpg`.
    - Menolak file non-gambar sebelum memanggil Sharp via pemeriksaan magic bytes dan regex ekstensi gambar `IMAGE_EXT_RE`.
    - Melindungi gambar asli dari penghapusan bila engine Sharp sedang tidak tersedia (`engine-unavailable`) guna mencegah *mass data-loss*.
    - Memisahkan kelas kegagalan thumbnail via `createBlurThumbDetailed`: `invalid` (header tak terbaca/tanpa dimensi → benar-benar korup, aman dibersihkan) vs `engine` (header valid namun encode gagal → gangguan mesin, HD dipertahankan). Menutup celah valid image ikut terhapus saat Sharp gagal transient.
    - Menghapus fungsi mati `extFromMime` (kini digantikan `resolveExtForSave`).
    - Loop `pruneToLowWatermark` dan `deleteExpiredMedia`: file 0-byte langsung dihapus; file non-gambar (video, audio, dokumen) langsung dihapus tanpa Sharp untuk memulihkan kuota; file korup dihapus demi kuota; gambar valid dihapus setelah memastikan thumbnail buram ada.
    - Memperbarui `updateMediaRefsAfterHdDelete` agar mendukung `thumbRelUrl: string | null` (meng-unset field `media.url` untuk media non-gambar).
  - **Fase 3 (Pembersihan Duplikat Thumbnail Inbound)**:
    - Menambahkan `cleanupLegacyInboundThumbDuplicate` di folder inbound untuk mendeteksi dan menghapus sibling thumbnail lama yang salah ekstensi (misal `_thumb.png` yang ber-magic JPEG `ffd8ff`) bila thumbnail kanonis `_thumb.jpg` sudah ada.
  - **Fase 4 & 5 (Test Adversarial & Edge Cases)**:
    - Unit test baru `tests/unit/media-kind.test.ts` (12 tests lulus 100%).
    - Skenario pengujian adversarial di `tests/unit/media-watermark-autoprune.test.ts` (4.2-4.11: pruning video `.mp4`, voice note `.ogg`, `mislabeled.jpg` berisi `OggS`, file 0-byte & corrupt, mock Sharp gagal anti data-loss, pembeda `engine` vs `invalid`, cross-extension thumbnail, retensi 35 hari, pembersihan duplikat thumbnail).
    - Seluruh suite test media (10 test files / 87 tests) lulus 100% dan `npm run build` lulus tanpa error.
- **File Dimodifikasi**: `src/utils/media-kind.ts` (baru), `src/services/media.service.ts`, `src/routes/webhook.route.ts`, `tests/unit/media-kind.test.ts` (baru), `tests/unit/media-watermark-autoprune.test.ts`, `docs/KNOWN_ISSUES.md`, `CHANGELOG.md`.

#### 2026-10-13 - Fixed: Resolusi Maps Shortlink, Plus Code Geocoding & Stabilisasi State Form Admin (Fase 0-5)

- **Akar Masalah (Audit Multi-Lapisan):**
  - **Timeout Singkat Shortlink Google Maps**: `resolveGoogleMapsUrl` memiliki default `timeoutMs = 2500` yang terlalu pendek untuk menangani rantai multi-hop redirect Google Maps (`maps.app.goo.gl` -> `goo.gl` -> `google.com/maps/place/...`), sehingga sering gagal timeout saat koneksi latensi tinggi.
  - **Kegagalan Parsing Teks Campuran / Preamble**: Admin menempel URL bersama teks pengantar (misal `"Ini alamatnya https://maps.app.goo.gl/xxx ya"`), yang ditolak oleh endpoint `resolve-location` karena memeriksa URL mentah tanpa ekstraksi regex awal.
  - **Polusi & Resolusi Plus Code pada Toponimi**: Tempat usaha di Google Maps menghasilkan Plus Code (seperti `"JP96+9WG Asian Conveksi, Bohar..."`), di mana token grid membingungkan parser gazetteer lokal bila tidak dibersihkan secara deterministik, dan sebelumnya fallback ke centroid desa Bohar bukannya mendecode titik presisi Plus Code tersebut.
  - **Disparitas Hyperlink Navigasi**: `getGoogleMapsDirectionUrl` dan `buildMapsUrls` mendeteksi teks non-presisi dan melempar `destination: fallbackText`. Ketika teks hanya berupa nama kelurahan (misal "Bohar"), link navigasi membuang angka koordinat dan Google Maps merutekan ke kantor desa Bohar (`destination=Bohar`), bukan titik fisik bangunan.
  - **Form State Wipeout via SSE Re-render**: `CustomerEditForm.tsx` memiliki `useEffect([customer])`. Parent passing objek inline baru setiap kali SSE heartbeat/message ack datang di LiveChat, menimpa formulir yang sedang diketik staf kembali ke data lama DB.
  - **Ketiadaan Indikator UX Resolving & Button Lock**: Input link tidak memiliki visual spinner loading, dan tombol simpan tidak dikunci saat background URL resolving berjalan, menyebabkan form disimpan sebelum koordinat selesai diurai.
  - **Disparitas Shortlink di 4 Modal**: 3 komponen lain (`LocationPickerModal`, `Reservations`, `TodayTreatments`) hanya memakai regex client sederhana dan gagal mengurai shortlink `maps.app.goo.gl`.
- **Fixed (Fondasional & Deterministik):**
  - **Fase 1 (Backend Hardening & Plus Code Decoder)**:
    - Default timeout `resolveGoogleMapsUrl` dinaikkan dari 2500 ms ke 6000 ms (`src/utils/google-maps-url-resolver.ts`).
    - Membuat modul mandiri `src/utils/open-location-code.ts` (zero-dependency) untuk mendecode full dan short Plus Codes (`JP96+9WG` -> `lat: -7.3816117`, `lng: 112.7122506`).
    - Integrasi decoding Plus Code pada `extractCoordinatesFromUrlString` (`src/utils/google-maps-url-resolver.ts`).
    - Endpoint `resolve-location` di `src/routes/admin/customers.subroute.ts` mengekstrak URL dengan `extractGoogleMapsUrls(url)[0] || url.trim()` sebelum parsing.
    - Normalisasi deterministik Plus Code di `generateCandidateSpans` (`src/integrations/google-maps/geocoding.ts`).
    - Unit test baru `tests/unit/open-location-code.test.ts` dan `tests/unit/geocode-pluscode.test.ts` (100% hijau).
  - **Fase 2 (Stabilisasi Form & Anti-Wipeout)**:
    - Menambahkan prop `resetKey` dan guard `lastSyncKeyRef` di `CustomerEditForm.tsx` agar form dirty tidak ter-reset oleh re-render SSE LiveChat.
    - Menambahkan `key={id}` dan `resetKey` di `CustomerDatabase.tsx` dan `LiveChatMonitor.tsx` untuk lifecycle remount yang bersih saat berganti customer.
  - **Fase 3 (UX Feedback & Single Shared Seam & Navigation Parity)**:
    - Membuat hook tunggal `useMapsShortlinkResolver` (`packages/admin-dashboard/src/hooks/useMapsShortlinkResolver.ts`) untuk dipakai bersama di 4 komponen: `CustomerEditForm`, `LocationPickerModal`, `Reservations`, dan `TodayTreatments`.
    - Helper `isSpecificStreetAddress` di `geoUtils.ts` dan `staff-reservation.service.ts` melarang nama kelurahan/desa umum (seperti "Bohar") membuang koordinat lat/lng pada link navigasi motor.
    - Menampilkan spinner status "Sedang mengurai tautan Google Maps...", tombol "Cek", dan menonaktifkan tombol simpan saat proses resolving berlangsung.
  - **Fase 4 (Healing Bunda Nurul via Seam Kanonis)**:
    - Baris DB Bunda Nurul diupdate via seam kanonis `customerService.updateCustomerLocation` ke titik presisi Asian Conveksi (`lat: -7.3816117`, `lng: 112.7122506`, Bohar, Taman, Sidoarjo, jarak 9.07 km, ongkir Rp 10.000, `location_source = 'gps_pin'`).
    - Tercatat di `audit_logs` dan riwayat `preferences.location_history`.
- **File Dimodifikasi**: `src/utils/open-location-code.ts`, `src/utils/google-maps-url-resolver.ts`, `src/routes/admin/customers.subroute.ts`, `src/integrations/google-maps/geocoding.ts`, `src/services/staff-reservation.service.ts`, `packages/admin-dashboard/src/utils/geoUtils.ts`, `packages/admin-dashboard/src/components/modals/CustomerEditForm.tsx`, `packages/admin-dashboard/src/components/common/LocationPickerModal.tsx`, `packages/admin-dashboard/src/pages/tenant/CustomerDatabase.tsx`, `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`, `packages/admin-dashboard/src/pages/tenant/Reservations.tsx`, `packages/admin-dashboard/src/pages/tenant/TodayTreatments.tsx`, `packages/admin-dashboard/src/hooks/useMapsShortlinkResolver.ts`, `tests/unit/open-location-code.test.ts`, `tests/unit/navigation-accuracy-preflight.test.ts`, `tests/unit/geocode-pluscode.test.ts`, `docs/KNOWN_ISSUES.md`, `CHANGELOG.md`.


#### 2026-10-13 - Fixed: Resolusi Anomali Atribusi CTWA Fuzzy, Paritas JSON Preview CAPI, dan Komparasi Kanal (Fase 1-5)

- **Akar Masalah (Audit Multi-Lapisan):**
  - Salah Label Atribusi Transaksi: Lead & Purchase yang tertangkap melalui greeting matcher CTWA (`ctwa_fuzzy_...`) dicap sebagai "Web LP" di `MetaCapiQueue.tsx` karena logika badge hanya mengecek `attribution.ctwa_clid`.
  - Injeksi Data Palsu ke Preview JSON CAPI: Payload preview di `MetaCapiQueue.tsx` menginjeksi fallback IP contoh (`114.122.34.56`), User-Agent iPhone contoh, dan FBP contoh ke transaksi iklan WhatsApp (yang berlangsung di aplikasi WhatsApp tanpa web browser), serta mensintesis FBC dari `ctwa_fuzzy_...` yang menurunkan integritas data Event Match Quality (EMQ).
  - Inkonsistensi Envelope CAPI: Backend `capi.service.ts` hanya memakai envelope `business_messaging` bila `ctwa_clid` resmi tersedia + WABA aktif, sedangkan traffic greeting catcher (fuzzy) memakai `action_source: 'chat'`.
  - Ketidaksinkronan Kamus Kanal Dashboard: `ChannelTable.tsx` dan `types.ts` belum mendaftarkan kanal `CTWA_FUZZY`, sehingga label kanal jatuh ke string mentah dan memicu peringatan kuning keliru ("CTWA Native bernilai 0...") padahal lead aktif mengalir lewat Greeting Catcher.
  - Distraksi Filter Bar di Tab Catchers: Tab Greeting Catchers (`MetaClickCatcher.tsx`) menampilkan filter bar tanggal yang tidak dikonsumsi oleh komponen tab tersebut.
- **Fixed (Fondasional & Deterministik):**
  - **Fase 1 (Badge & Eliminasi Data Palsu di MetaCapiQueue.tsx)**:
    - Fungsi murni `isCtwaFuzzyAttribution` memeriksa `ctwa_fuzzy_` dan `utm.medium === 'ctwa_fuzzy'` secara deterministik.
    - Badge toska "CTWA Fuzzy" ditampilkan pada tabel antrean dan card view moderasi.
    - Pemisahan flag `isCtwaNative`, `isCtwaFuzzy`, dan `isCtwaAny` pada `buildCapiJsonPayload`.
    - Eliminasi total sintesis FBC palsu dari tracking code fuzzy.
    - Meniadakan fallback IP/UA/FBP palsu untuk seluruh transaksi CTWA (native & fuzzy).
    - Paritas envelope: `action_source: 'business_messaging'` hanya diaktifkan untuk CTWA Native dengan WABA terkonfigurasi.
  - **Fase 2 (Kamus & Banner Info ChannelTable.tsx)**:
    - Pendaftaran label `CTWA_FUZZY: 'Click-to-WhatsApp (Greeting Fuzzy)'` pada `CHANNEL_LABEL` dan union tipe `types.ts`.
    - Banner info teal edukatif ditampilkan jika CTWA Native bernilai 0 namun lead CTWA Fuzzy aktif berjalan.
  - **Fase 3 (UX Tab Catchers MetaClickCatcher.tsx)**:
    - Bar filter tanggal disembunyikan secara bersih saat tab Greeting Catchers aktif (`activeTab !== 'catchers'`).
  - **Fase 4 (Pengujian Adversarial & Paritas)**:
    - Unit test komprehensif di `tests/unit/ctwa-fuzzy-attribution-dashboard.test.ts` memverifikasi skenario Bunda Narita (CTWA Fuzzy), CTWA Native dengan & tanpa WABA, serta Web LP.
- **File Dimodifikasi**: `packages/admin-dashboard/src/pages/tenant/MetaCapiQueue.tsx`, `packages/admin-dashboard/src/components/meta-performance/ChannelTable.tsx`, `packages/admin-dashboard/src/components/meta-performance/types.ts`, `packages/admin-dashboard/src/pages/tenant/MetaClickCatcher.tsx`, `tests/unit/ctwa-fuzzy-attribution-dashboard.test.ts`, `docs/KNOWN_ISSUES.md`.

#### 2026-10-13 - Fixed: Peringatan Titik Presisi (GPS Pin) & Pengingat Shareloc Otomatis (Fase 1-6)

- **Akar Masalah (Audit Multi-Lapisan):**
  - Bidan Tersasar ke Titik Tengah Kelurahan (Estimated Area): Customer yang memesan layanan homecare tanpa memberikan titik koordinat presisi (hanya nama jalan/kelurahan) menyebabkan Bidan diarahkan ke koordinat sentroid kelurahan karena admin lupa meminta shareloc setelah booking disepakati.
  - Ketiadaan Peringatan Visual di Dashboard: Tidak ada kartu visual khusus yang membedakan pelanggan yang sudah memiliki pin GPS vs yang masih area perkiraan saat booking berstatus confirmed/hold.
  - Risiko Shadow-ban & Template di Hardcode: Plan asli memiliki dependensi import salah (`dateWib` di backend), template di-hardcode di kode, menggunakan regex teks rapuh, dan rute gateway tidak sadar multi-tenant (hanya WAHA, mengabaikan WABA).
- **Fixed (Fondasional & Deterministik):**
  - **Fase 1 (Evaluator Murni & Background Sweep)**:
    - `src/services/shareloc-signal.service.ts`: Fungsi murni matematis `computeSharelocSignal` dan `isFriendlyHoursWib` (08:00 - 19:59 WIB via `getWibNow().getUTCHours()`). Same-day booking langsung ditandai `needed=true, urgent=true`; advance booking menunggu 3 jam; cooldown 6 jam pasca-permintaan.
    - `src/services/shareloc-reminder.service.ts`: Background sweep yang dilengkapi dedup persisten via `AdminNotificationLog.idempotency_key` (`${tenant}:SHARELOC:${customerId}:${wibDate}`), tenant-aware gateway (`resolveGatewayForTenant`), template dinamis dari DB (`QuickReply` shortcut `shareloc` / `ClinicPolicy topic='shareloc_request'`), pengecekan jam ramah, dan proteksi chat `is_human_handling`.
  - **Fase 2 (Kontrak Data Dashboard & SSE)**:
    - `src/services/live-chat.service.ts`: Menambahkan `locationSource`, `shareLocationSent`, dan `sharelocRequestedAt` pada payload `formatConversationItem`.
    - `src/services/conversation.service.ts`: Meneruskan ketiga field di atas dalam payload standar `conversation.updated` via `buildConversationUpdatedPayload`.
  - **Fase 3 (UI Kartu & Tombol 1-klik Human-in-the-Loop)**:
    - Helper murni `packages/admin-dashboard/src/utils/sharelocCardStatus.ts`: Menghitung status kartu tanpa keterikatan React.
    - `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`: Menampilkan border highlight (`border-l-4 border-l-orange-500` untuk same-day urgent, `border-l-4 border-l-amber-500` untuk advance), badge status `📍 Butuh Shareloc (Hari Ini)` / `📍 Butuh Shareloc`, dan tombol `[📍 Minta Shareloc]` di action bar percakapan yang mengisi composer balasan via `applyQuickReply` shortcut `shareloc` (human-in-the-loop, review sebelum kirim).
  - **Fase 4 (Cron Lifecycle & Worker Separation)**:
    - `src/services/cron.service.ts`: Menambahkan `runSharelocReminderSweep()` yang memproses seluruh tenant secara terisolasi.
    - `src/lifecycle/background-crons.ts`: Mendaftarkan interval cron setiap 15 menit secara bertingkat (`trackIntervalStaggered`), dikunci di belakang flag proteksi `ENABLE_SHARELOC_REMINDER_SWEEP=false` (G0-c) untuk mencegah shadow-ban.
  - **Fase 5 & 6 (Uji Adversarial & Regresi)**:
    - `tests/unit/shareloc-signal.test.ts`: 14 pengujian adversarial mencakup jam ramah WIB, deteksi presisi GPS, same-day vs advance booking, cooldown 6 jam, fail-open reservasi, dan kekebalan terhadap variasi teks chat.
    - `tests/unit/shareloc-reminder.test.ts`: 8 pengujian untuk template resolution DB, proteksi flag, skip human handling, gate same-day 1 jam bot, dan alur pengiriman sukses.
    - `tests/unit/shareloc-card-status.test.ts`: 6 pengujian mirror frontend.
    - 3 build hijau (`vitest`, `tsc`, `vite build`) tanpa regresi.
- **File Dimodifikasi**: `src/services/shareloc-signal.service.ts`, `src/services/shareloc-reminder.service.ts`, `src/services/live-chat.service.ts`, `src/services/conversation.service.ts`, `src/services/cron.service.ts`, `src/lifecycle/background-crons.ts`, `src/routes/admin/quick-replies.subroute.ts`, `packages/admin-dashboard/src/utils/sharelocCardStatus.ts`, `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`, `tests/setup.ts`, `tests/unit/shareloc-signal.test.ts`, `tests/unit/shareloc-reminder.test.ts`, `tests/unit/shareloc-card-status.test.ts`, `docs/KNOWN_ISSUES.md`, `CHANGELOG.md`.

#### 2026-10-13 - Fixed: Penjadwalan Staf vs Pasien (Pesan Tanpa Jam Opsi A) & Pengingat Foto Rumah HP Bidan (Fase 1-4)

- **Akar Masalah (Audit Multi-Lapisan):**
  - Diskrepansi Waktu Janji Pasien vs Target Internal Staf: Kolom tunggal `booking_date` digunakan bersama untuk target staf (yang dimajukan admin agar terapis bersiap/tiba tepat waktu) dan janji temu ke pasien.
  - Kebocoran Jam di Pesan Pasien: Template pesan WhatsApp `reservationConfirmed` di `persona.ts` serta template reminder rolling `REMINDER_H0` dan `REMINDER_H1` mencantumkan `jam {time}` sehingga membingungkan pasien jika jam internal staf dimajukan.
  - Ketiadaan Foto Depan Rumah Pasien Baru: Di lapangan, bidan sering kesulitan mengidentifikasi rumah pasien saat pertama kali berkunjung, sementara tombol perbarui lokasi di UI tersembunyi dan tidak ada pengingat ramah saat tiba/selesai.
- **Fixed (Fondasional & Deterministik - Opsi A):**
  - **Fase 1 (Pesan Pasien Bebas Jam)**:
    - `src/config/followup-templates.ts`: 3 varian `REMINDER_H0` dan 3 varian `REMINDER_H1` dibersihkan dari indikator jam/waktu (`jam {time}` / `pukul {time}`), dengan tetap menjaga penyebutan brand klinik dinamis per-tenant (`getBrandIdentity().businessName`).
    - `src/config/persona.ts`: Template `reservationConfirmed` menghapus `jam ${params.time}`, hanya mencantumkan tanggal kunjungan. Fungsi mati `morningReminder` ditandai `@deprecated` dan dibersihkan dari jam.
    - `src/scripts/backfill-reminder-no-time-templates.ts`: Skrip pembaruan DB per-tenant untuk template kustom di tabel `followUpTemplate`.
    - `packages/admin-dashboard/src/pages/tenant/FollowUpTemplates.tsx`: Label tipe diubah menjadi `Reminder Hari-H (Tanpa Jam)` dan chip placeholder `{time}` disembunyikan khusus untuk tipe `REMINDER_H0` dan `REMINDER_H1` agar admin tidak sengaja menyisipkan jam kembali.
    - Catatan Kebijakan: Antrean `REMINDER_H1` secara default berstatus postponed (`FOLLOWUP_CREATE_REMINDER_REVIEW !== 'true'`); template baru siap aktif saat flag diaktifkan.
  - **Fase 2 (Soft Guard Foto Rumah 3 Lapis)**:
    - Helper murni `packages/admin-dashboard/src/pages/staff/housePhotoGuard.ts`: Menyediakan `needsHousePhoto` dan `resolveLocModalMode` yang decoupled dan stateless.
    - Lapis 1 (Modal Langsung Siap Foto): Membuka modal lokasi pada tugas tanpa foto rumah langsung mengaktifkan mode `edit`, siap 1-tap kamera tanpa harus mencari tombol edit.
    - Lapis 2 (Tombol Mencolok di Kartu): Tombol di kartu kunjungan (`StaffToday.tsx` & `TodayTreatments.tsx`) diberi styling amber berdaya tarik tinggi: `📸 Butuh Foto Rumah • Ambil Foto Sekarang`.
    - Lapis 3 (Jaring Ramah Saat Tiba & Pulang): Notifikasi saat bidan menandai tiba ("Sudah Sampai") mengingatkan untuk mengambil foto rumah; dialog konfirmasi sebelum "Selesaikan Kunjungan" menawarkan opsi ambil foto sekarang atau lewati (soft guard, tidak memblokir penyelesaian darurat/hujan deras).
  - **Fase 3 (Uji Adversarial)**:
    - `tests/unit/patient-reminder-no-time.test.ts`: Uji 3 varian H0/H1 × ragam nama unik × ragam input jam menghasilkan pesan tanpa jam dengan brand identitas utuh, serta uji `reservationConfirmed`.
    - `tests/unit/staff-house-photo-guard.test.ts`: Uji unit kontrak helper `needsHousePhoto` dan `resolveLocModalMode`.
  - **Fase 4 (Dokumentasi & SOP)**:
    - `docs/SOP_ADMIN_RESERVASI.md`: Panduan Bagian 3.10 mengenai kebijakan penjadwalan staf vs pesan pasien, cara komunikasi CS menjawab estimasi jam kunjungan, dan SOP pengambilan foto rumah.
    - `docs/KNOWN_ISSUES.md`: Pencatatan Issue #253 mengenai utang sadar single `booking_date`, HSM WABA awaiting resubmit, dan status UI soft-guard.
- **File Dimodifikasi**: `src/config/followup-templates.ts`, `src/config/persona.ts`, `src/scripts/backfill-reminder-no-time-templates.ts`, `packages/admin-dashboard/src/pages/tenant/FollowUpTemplates.tsx`, `packages/admin-dashboard/src/pages/staff/housePhotoGuard.ts`, `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`, `packages/admin-dashboard/src/pages/tenant/TodayTreatments.tsx`, `tests/unit/patient-reminder-no-time.test.ts`, `tests/unit/staff-house-photo-guard.test.ts`, `docs/SOP_ADMIN_RESERVASI.md`, `docs/KNOWN_ISSUES.md`, `CHANGELOG.md`.

#### 2026-10-12 - Fixed: Resolusi Diskrepansi Meta Ads vs Sistem (Anti-Race CTA, TrustProxy, Zero-Preflight Beacon, Taxonomy Gate & Anti Double-Count) (Fase 0-5)

- **Akar Masalah (Audit Multi-Lapisan):**
  - Race Condition Redirect CTA: Tombol CTA di `go.html` dan `html-sanitizer.ts` melakukan `window.location.href = redirectUrl` seketika setelah menerima respons tracking tanpa jeda, memicu pemutusan HTTP request Meta Pixel (`ERR_ABORTED`).
  - Rate Limit Bucket Collapse: Fastify tanpa `trustProxy: true` membuat `request.ip` bernilai IP internal reverse-proxy Caddy (`172.19.0.4`), menyebabkan seluruh pengunjung web berbagi satu kuota rate-limit 60 req/menit di `/cta` dan `/api/tracking/click`.
  - Beacon Preflight Failure: `navigator.sendBeacon` dengan `Blob` bertipe `application/json` memicu CORS preflight `OPTIONS` yang sering dibatalkan browser mobile saat navigasi. Server juga belum memiliki parser `text/plain` untuk membaca JSON string.
  - Kebocoran Event Purchase di Klik CTA: Daftar `CLICK_EVENTS` memuat `Purchase`, membuka celah event Purchase tertembak dari klik tombol landing padahal funnel kanonis mewajibkan Purchase hanya dipicu pasca-pembayaran.
  - Potensi Double-Count Dashboard: Baris rekonsiliasi Meta Ads (`meta-reconciliation`) tergabung ke dalam `totalPageViews` server sehingga berisiko terhitung dua kali saat kolom Meta LPV ditampilkan.
- **Fixed (Fondasional & Deterministik):**
  - **Fase 0 (Forensik Bukti Server & DB)**: Verifikasi 100% IP proxy di DB, pendaftaran domain landing eksternal `landing_domain = 'kalababyspa.online'` di tabel `tenants`.
  - **Fase 1 (Anti-Race Redirect CTA)**: Seragamkan pola redirect dengan jeda `setTimeout 300ms` dan guard `isRedirecting` di `go.html` dan `html-sanitizer.ts`, konsisten dengan `/cta`.
  - **Fase 2 (TrustProxy & Per-IP Rate Limiting)**: Aktifkan `trustProxy: true` di Fastify (`src/app.ts`), mengisolasi bucket rate limit per IP client asli dari header `X-Forwarded-For`.
  - **Fase 3 (Zero-Preflight Plaintext Beacon)**: Ubah `sendBeacon` ke `text/plain;charset=UTF-8` di 5 titik (klien) dan tambahkan parser `text/plain` di `src/app.ts` serta route preflight `OPTIONS & POST /api/tracking/click` dengan CORS headers.
  - **Fase 4 (Taxonomy Gate)**: Cabut `Purchase` dari `CLICK_EVENTS` pada `landing.route.ts` dan `html-sanitizer.ts`; blokir event `Purchase` pada klik tombol CTA.
  - **Fase 5 (Dashboard Dual-Kolom Anti Double-Count)**: Endpoint `/api/admin/debug/meta-summary` mengekstrak `metaLpvOfficial` dan memotongnya dari `totalPageViews` subset server; UI `MetaClickCatcher.tsx` menyajikan kartu Meta LPV Resmi dan Server Views secara terpisah.
- **File Dimodifikasi**: `src/app.ts`, `src/routes/tracking.route.ts`, `src/routes/landing.route.ts`, `src/services/html-sanitizer.ts`, `src/landing/public/go.html`, `src/landing/public/external-tracker.js`, `src/routes/admin/meta-attribution.subroute.ts`, `packages/admin-dashboard/src/pages/tenant/MetaClickCatcher.tsx`, `docs/META_FUNNEL.md`, `docs/KNOWN_ISSUES.md`.


#### 2026-10-12 - Fixed: AI Copilot Grounding Hardening, Deterministic Deep-Link Injection, Persona Hygiene & Spam Filtering (Fase 1-5)

- **Akar Masalah (Audit Multi-Lapisan):**
  - False-Negative Grounding: Jawaban akurat Copilot tentang pasien tertahan ("menunggu", "untuk") dicap grounded: false karena regex honorifik mendeteksi kata kerja/fungsi bahasa Indonesia huruf kecil sebagai nama pasien halusinasi.
  - Tautan Live Chat Hilang: LLM kerap menghilangkan [Buka Chat] walau data tool menyediakan conversationId valid.
  - Persona Bleeding: Copilot internal menyapa admin menggunakan sapaan dan empati konsumen ("Kami paham Bunda menunggu kepastian...").
  - Infiltrasi Spam Operator: SMS/broadcast promo telekomunikasi ("SimpelRoam IM3") masuk sebagai prospek jadwal tertahan karena memuat kata "sekarang".
  - Kebocoran Username Sistem: Pasien anonim/akun teknis tampil mentah ("aguspurnomo68301" / "Bunda").
- **Fixed (Fondasional & Deterministik):**
  - **Fase 1 (Deterministic Deep-Link Injection)**: Injeksi [Buka Chat](/admin/live-chat?conversationId=...) deterministik berbasis token unik terpanjang (\btoken\b) pada daftar bullet dan tabel | ... |, validasi format conversationId (^[A-Za-z0-9_-]+$), dan resolusi tautan terdekat sebelum placeholder.
  - **Fase 2 (Grounding Validator Hardening)**: Aturan proper noun huruf kapital ([A-Z][a-zA-Z]+) + daftar stopword bahasa Indonesia (INDONESIAN_HONORIFIC_STOPWORDS) mengabaikan kata fungsi huruf kecil/kapital, simetrisasi honorifik (Ny|Tante), dan toleransi tanda baca pada labelRe.
  - **Fase 3 (Persona Hygiene & Identity Masking)**: Klausul preseden mutlak pada buildSummarizePrompt melarang sapaan Bunda ke admin; formatCustomerDisplayName menyamarkan username teknis (aguspurnomo68301 -> Bunda (0812****7890)) dan nama kosong tanpa menyentuh nama asli manusia ("Chaterina", "Cindy Amalia").
  - **Fase 4 (Telecom Spam Filter & Schedule Signal Hardening)**: stripCommercialSpam membuang baris spam operator tanpa menyentuh istilah klinik ("paket persalinan", "voucher USG"); extractTimeHint mewajibkan konteks jadwal/klinik untuk kata "sekarang".
  - **Fase 5 (Adversarial Testing)**: 19 unit test baru di tests/unit/copilot-grounding-stopword.test.ts (total 146 copilot tests lulus, build clean).
- **File Dimodifikasi**: src/services/copilot/copilot.service.ts, src/services/copilot/copilot-tools.ts, src/v3/agent/pipeline/medical-signal-detector.ts, tests/unit/copilot-grounding-stopword.test.ts.


#### 2026-10-12 - Feature: Skema Baru Hide Message (Role-Based Privacy Display di LiveChatMonitor)

- **Akar Masalah & Kebutuhan:**
  - Sebelumnya pesan yang di-hide admin dicegat penuh oleh `HiddenMessageStrip` abu-abu gelap (`LiveChatMonitor.tsx`), sehingga teks dan media tertutup dari pandangan Admin/CS kecuali diklik buka.
  - Di daftar chat sebelah kiri, cuplikan pesan terakhir hanya bertuliskan teks kaku `[Pesan disembunyikan]`.
- **Fixed (fondasional & privacy-preserving):**
  - Di `LiveChatMonitor.tsx`:
    - Hapus pencegatan `HiddenMessageStrip` baris 5882–5910 agar gelembung pesan mengalir normal ke pipeline perenderan chat.
    - Berikan styling abu-abu lembut transparan pada gelembung pesan saat `isMessageHidden === true` (`slate-100 / slate-800` untuk pesan customer, `slate-200 / slate-700` untuk pesan staf/bot).
    - Tampilkan footer status di dalam gelembung: icon `EyeOff`, label `Disembunyikan dari Staf Bidan`, dan tombol interaktif `Pulihkan` (`handleToggleMessageHide(msg, false)`).
    - Di kartu daftar obrolan kiri (baris 4724), ganti preview `[Pesan disembunyikan]` dengan teks asli bertanda `👁️🗨️ [Hidden] ${lastMsg?.content || 'Pesan'}`.
    - Bersihkan state `revealedHiddenIds` dan import `HiddenMessageStrip` yang tidak lagi digunakan di file ini.
  - Di `StaffToday.tsx`:
    - Proteksi privasi staf bidan/terapis tetap 100% aman (filter `is_message_hidden` di baris 1029, 1320, dan 1455 mencegah pesan hidden tampil ke terapis).
- **Verifikasi:**
  - Dashboard build (`npm --prefix packages/admin-dashboard run build`): EXIT 0 (2494 modules transformed).
  - Backend root build (`npm run build`): EXIT 0.
  - Vitest `live_chat_monitor.test.ts`: 3/3 passed.


#### 2026-10-12 - Fixed: Optimalisasi UI/UX LiveChat Mobile (Fase 1-4)

- **Akar Masalah (terbukti di kode):**
  - Header obrolan di layar sempit HP (375px) sesak oleh tombol unread (`handleToggleReadStatus`) dan tombol "Aktifkan AI" ganda. Fungsi tandai-baca sudah tersedia di menu konteks (klik kanan / tekan-lama).
  - Banner AI Nonaktif di mobile terduplikasi di 2 tempat (`LiveChatMonitor.tsx`: loading branch dan list branch) dengan tombol "Aktifkan AI" hijau yang memicu dialog ganda dan potensi tipe `amber` tak valid. Sakelar ON/OFF kanonis sudah tersedia di sticky search bar.
  - Di layar HP, tombol gembok composer disembunyikan via `hidden sm:flex` (`LiveChatComposer.tsx:885`), sehingga staf yang mengaktifkan mode catatan internal via menu `+` terjebak tanpa tombol batal (harus refresh halaman).
- **Fixed (fondasional & modular):**
  - Fase 1: Bersihkan header obrolan di `LiveChatMonitor.tsx` (hapus tombol unread dan tombol Aktifkan AI di header chat); nama pasien dan nomor telepon kini tampil lapang, tombol search in-chat dan ambil alih tetap utuh.
  - Fase 2: Ekstraksi strip status ke komponen kanonis tunggal `packages/admin-dashboard/src/components/livechat/AiOffStrip.tsx` (teks saja, tanpa tombol toggle); ganti 2 banner duplikat mobile di loading dan list dengan `<AiOffStrip />`; satu-satunya toggle tetap di sticky search bar (`emerald/rose`, `useUiFeedback`).
  - Fase 3: Tambah strip pembatalan mode internal `isInternalMode` di HP (`flex sm:hidden`) dengan tombol `Batal (✕)` tepat sebelum wrapper composer di `LiveChatComposer.tsx`.
- **Verifikasi & Regresi:**
  - `grep handleToggleReadStatus LiveChatMonitor.tsx`: tepat 3 hasil (1 definisi, 2 pemakai menu).
  - `grep AiOffStrip LiveChatMonitor.tsx`: tepat 3 hasil (1 import, 2 pemakai).
  - Area mobile tombol "Aktifkan AI": 0 (tombol hijau hilang dari HP).
  - Dashboard build (`npm --prefix packages/admin-dashboard run build`): EXIT 0 (2495 modules transformed).
  - Backend root build (`npm run build`): EXIT 0.
  - Backend tests: 654 passed files / 5356 passed tests, zero regresi baru (kegagalan adalah pre-existing lama).
  - File: `LiveChatMonitor.tsx`, `LiveChatComposer.tsx`, `AiOffStrip.tsx`.


#### 2026-10-12 - Fixed: Split-Brain Lokasi, Healing Alamat & Navigasi Sadar-Akurasi (REVISI-1, Tahap 1-4)

- **Akar (terbukti di kode + SELECT live):** endpoint admin lokasi hanya tulis
  tabel `customers`; `addressesMatch` tak kenal pengayaan asimetris (ghost
  primary); `preferences.address` tertimpa string kosong di 3 builder tugas;
  link mentah di notifikasi staf + 8 situs dashboard; prompt AI melarang mutlak
  tanya alamat saat estimasi; Contacts tanpa teks jalan.
- **Fixed (fondasional, reuse seam kanonis):** cabang asimetris domain (TDD);
  endpoint delegasi `updateCustomerLocation`; helper `buildEffectiveTaskAddress`;
  notifikasi reuse `buildMapsUrls`; dashboard helper 4-arg + hapus fungsi
  bayangan; label "Estimasi (Titik DB)"; prompt state-gated via `locationSource`
  (tipe + hidrasi + cabang prune); jalan di Contacts. Skrip healing idempoten
  `src/scripts/heal-customer-addresses-split-brain.ts` (`--dry-run`/`--commit`).
- **Test:** 91/91 gate plan; full suite 5359 hijau, 6 gagal pre-existing lama
  (revert-and-rerun). Build backend + dashboard hijau.
- **Belum:** healing PROD, push, deploy — lihat `docs/KNOWN_ISSUES.md` #251.


#### 2026-10-12 - Fixed: Kebocoran Balasan AI Worker + Latensi GLM 24,8 dtk (Fase 1-6, v1.16.1)

- **Akar Masalah (terbukti di kode):**
  - Worker (`src/worker.ts`) ikut mengonsumsi antrean chat BullMQ karena
    konstruktor `QueueService` otomatis membuat `Worker`; kunci `bullProcessing`
    hanya in-memory per proses sehingga app + worker memproses pesan yang sama.
  - `worker.ts` tidak memuat persona/katalog/delivery/AI-config dari DB.
  - Call 2 ke `glm-5.3-flash` tanpa `thinking: { type: 'disabled' }` (±1.022
    reasoning token terbuang, latensi 24,8 dtk); Call 1 sudah dipasang.
  - `docker-compose.yml` app `SEPARATE_WORKER=false` → cron ganda.
- **Fixed (fondasional):**
  - Fase 1: gate `shouldRunChatConsumers()` (worker hanya produsen enqueue,
    Queue tetap dibuat); `isBotActive` default fail-closed `false`;
    `worker.ts` memuat 5 config tenant dari DB seperti `app.ts`.
  - Fase 2: `thinking.disabled` di Call 2 via `supportsThinkingParam`
    (GLM saja; DeepSeek/OpenAI-compatible tetap dilarang).
  - Fase 3: `SEPARATE_WORKER=true` untuk service app di compose.
  - Fase 4: kunci Redis `lock:<tenant>:<phone>` (UUID + NX EX 60 + release Lua
    banding-dan-hapus) + fallback in-memory; `claimForProcessing` DB tetap
    sebagai gerbang retry; `releaseDisabledBotConversations` tahan per-item.
- **Test & Verifikasi:**
  - Test baru: `shouldRunChatConsumers`, lock Redis (NX/owner/tenant),
    Call 2 thinking gate + respons plain tak-kosong (multi-frasa).
  - Fixture: `setupOfflineEnv` + 3 file uji men-set bot aktif eksplisit
    (cermin boot produksi); `ai-models-tenant.test.ts` diperbarui ke fail-closed.
  - `npm run build` hijau; full suite: 5343 passed, 6 gagal pre-existing
    terbukti via revert-and-rerun (`purchase-detection` 1,
    `reservation-security-and-integrity` 4, `staff-otw-chat-poison` 1).
- **Belum deploy server** — lihat `docs/KNOWN_ISSUES.md` #250.

#### 2026-10-12 - Revisi: Header LiveChat Mobile Benar-Benar Ikut Scroll + Banner Sync/Error (Search Tetap Sticky)

- **Keputusan user:** search TETAP STICKY di mobile (revert perubahan search fase lalu).
  Yang diperbaiki hanya header global + banner sync/error.
- **Akar Masalah (temuan reviewer, terverifikasi di kode):** (1) header `static`
  tetap pinned karena header adalah sibling flex di luar satu-satunya
  scroll-container (`chatListContainerRef`) + induk `overflow-hidden` + body-lock
  iOS -- `static` di flex column = terlihat permanen; (2) `lg:z-40` menghilangkan
  z-40 di mobile; (3) 3 banner sync/error masih sibling `shrink-0` di luar scroll.
- **Fixed (desktop tidak berubah):**
  - Header global: `hidden` di mobile livechat (benar-benar ikut scroll) +
    `lg:sticky lg:top-0 z-40` di desktop; halaman lain tetap `sticky top-0 z-40`.
  - State menu mobile + copilot diangkat dari `Layout.tsx` ke `CopilotContext`
    (`openMobileMenu`/`dismissMobileMenu` + history back) agar tombol pengganti
    menu + copilot di Mobile Page Header (dalam scroll) tetap membuka
    sidebar/panel -- kontrol lain (status WAHA, suara, tema, user) sudah
    mandiri di sidebar.
  - Searchbar: kembali `sticky top-0 z-20` penuh semua viewport.
  - Banner sync/error: global `hidden lg:flex` + duplikat ringkas `lg:hidden`
    di dalam scroll daftar (pola sama seperti banner AI); loading branch ikut
    tampilkan banner AI-off mobile.
  - 4 situs tombol "Aktifkan AI" (global, list, loading, header chat) TIDAK
    diekstrak komponen -- semuanya konsisten via handler tunggal
    `handleToggleGlobalBot` + `confirm()` + `disabled={togglingBotCutoff}`
    (blast radius ekstraksi lebih besar dari manfaatnya).
- **Verifikasi:** dashboard `tsc --noEmit` EXIT=0; `vite build` EXIT=0 (12.12s);
  `scripts/verify-livechat-revision.mjs` 21/21 PASS; subset livechat 5 file
  44/44 hijau; full suite root 4 shard tanpa failure baru (s1 6F, s2 9F, s3 3F,
  s4 8F -- pola time-rot parser tanggal + integrasi butuh env; sampel
  reservation-text-parser + live_chat_monitor TERBUKTI pre-existing via
  stash+rerun baseline tetap gagal); root `tsc` OOM exit 134 TERBUKTI
  pre-existing via stash+rerun baseline.
- **File:** `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`,
  `packages/admin-dashboard/src/components/common/Layout.tsx`,
  `packages/admin-dashboard/src/contexts/CopilotContext.tsx`,
  `scripts/verify-livechat-revision.mjs`.
- **Catatan:** rebuild dashboard (`vite build`) sudah dijalankan; deploy butuh
  approval manual terpisah.
- **Susulan review (regresi modal status):** blok `{showStatusPopover}` dipindah dari dalam `<header>` ke sibling di bawah `</header>` -- `display:none` ancestor menelan modal `fixed` sehingga tombol status sidebar mobile mati; tambah 1 cek anti-regresi di verify script (22/22 PASS).

#### 2026-10-12 - Fixed: Banner AI + Header + Search Ikut Scroll di LiveChat Mobile (Bukan Sticky)

- **Laporan:** di halaman daftar chat mobile, 3 lapis menempel di atas saat scroll:
  header global KALA SPA, banner CHATBOT AI NONAKTIF, dan searchbar. Toggle BOT ON/OFF
  mobile sendiri sudah ikut scroll (bukan sumber masalah).
- **Akar Masalah (audit berlapis):** (1) `Layout.tsx` header memakai `sticky top-0 z-40`
  tanpa kecuali untuk semua halaman termasuk LiveChat; (2) banner AI dirender di luar
  scroll-container daftar (sibling `shrink-0`, yang scroll hanya panel dalam
  `chatListContainerRef`); (3) searchbar disengaja `sticky top-0 z-20` di semua viewport.
- **Fixed (desktop tidak berubah):**
  - Searchbar: `sticky` hanya di `lg:` — mobile ikut scroll bersama daftar.
  - Banner AI global: hanya tampil di desktop (`hidden lg:flex`); duplikat ringkas
    `lg:hidden` ditambahkan di dalam scroll-container daftar mobile (ikut scroll).
  - Header global: saat rute live-chat, `static` di mobile + `lg:sticky` di desktop;
    halaman lain tetap `sticky` penuh. Fondasi anti-scroll window iOS (body lock +
    `overflow-hidden`) tidak diubah.
  - Bonus: varian dark-mode pada banner AI (sebelumnya hanya terang) + tombol
    "Aktifkan AI" di header detail chat mobile (banner list tak terlihat di sana).
- **Verifikasi:** `tsc --noEmit` dashboard (1 error pre-existing `WeekScheduleGrid`
  TS2503, terbukti via revert-and-rerun), `vite build` sukses, 15/15 cek
  prosedural adversarial hijau, full suite root tanpa failure baru (failure yang ada
  terbukti pre-existing via revert-and-rerun 3 file sampel).
- **File:** `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`,
  `packages/admin-dashboard/src/components/common/Layout.tsx`.
- **Catatan:** rebuild `packages/admin-dashboard` (`vite build`) sudah dijalankan agar
  perubahan terbawa ke `dist/`; deploy butuh approval manual terpisah.

#### 2026-10-09 - Fixed: Fondasi & Kunci Pipeline Meta Conversions API (CAPI) & Ad Attribution (Fase 1 - Fase 5)

- **Akar Masalah (multi-layer audit):**
  - **Kebocoran & Kegagalan Tenant (Fail-Closed)**: Caller webhook/admin yang kehilangan konteks tenant berisiko mengakses atau memproses event cross-tenant.
  - **Cooldown Blocking Organik vs Berbayar**: Cooldown 24 jam global menyamakan touchpoint organik dan klik iklan berbayar, sehingga chat tanya jawab organik dapat memblokir pencatatan atribusi iklan berbayar (undercounting ROAS).
  - **Idempotensi & Double-Send Event**: Pengiriman ulang event `Purchase` menghasilkan `event_id` acak baru berbasis timestamp saat kirim yang menyebabkan Meta mencatat konversi ganda, dan endpoint moderasi tidak menolak approve ulang tanpa alasan jelas.
  - **Halusinasi Nilai & Default 90k**: Jika layanan tidak cocok dengan katalog, sistem menebak harga default "Baby (90.000)", mendistorsi nilai transaksi riil di Meta Ads Manager.
  - **Pembajakan Fuzzy Catcher**: Fuzzy greeting catcher memproses repeat customer dan customer dengan native CTWA aktif, sehingga berisiko menimpa atribusi asli.
  - **Format `_fbc` Non-Kanonis**: Parameter `_fbc` Meta tidak selalu mengikuti format standar resmi Meta `fb.1.<creationTimeInMs>.<fbclid>`.
  - **Follow-up NO_PURCHASE Yatim**: Saat transaksi disetujui, antrean follow-up `NO_PURCHASE` tetap berjalan dan mengirimkan pesan "belum jadi order" kepada customer yang sudah closing.
  - **Kebocoran PII di Log Mesin**: Nomor telepon dan nama customer tercetak dalam format plaintext di stdout/stderr log server.
- **Fixed & Hardened (Fondasional 5 Fase):**
  - **Fase 1 (Kunci Kritis Pipeline CAPI)**:
    - Di `route-helpers.ts` & `admin.route.ts`, `tenantOf(request)` melakukan trim dan validasi string ketat, melempar 401 fail-closed jika tenant tidak terdefinisi.
    - Isolasi WABA webhook fail-closed: nomor yang tidak terdaftar ditolak dengan 400 `UNKNOWN_PHONE_NUMBER_ID`.
    - Memory cache `memoryAdClicks` memvalidasi `tenant_id` untuk mencegah kontaminasi cross-tenant.
    - Memisahkan cooldown kontak di `capi.service.ts`: `organicContactCooldown` dan `paidContactCooldown`. Interaksi organik tidak lagi menghalangi pengiriman event `Contact` dari klik iklan berbayar.
    - Idempotent `event_id`: format deterministik `org_pur_${resId}_${originalEventTime}` untuk Purchase dan `ctwa_${clid.slice(0,20)}_${customerId}` untuk CTWA.
    - Guard double-send pada `approve-purchase`: reservasi dengan `purchase_event_sent_at` ditolak 400 kecuali mengirim `force: true` dan `reason` minimal 5 karakter yang diaudit ke action log.
  - **Fase 2 (Integritas Nilai CAPI & Validasi Temporal)**:
    - Helper `parseCapiValue`: membersihkan ribuan Indonesia ("90.000" -> 90000), menolak NaN/negatif, dan menolak 0 kecuali flag `allowZero: true`.
    - Menghapus tebakan default "Baby 90.000": bila nominal tidak terdeteksi dari katalog tenant, moderasi menolak dengan 400 dan mewajibkan input manual.
    - Memperluas stop words katalog (`genericStop`) untuk mencegah pencocokan acak token generik.
    - Resolusi katalog tenant-aware di `customers.subroute.ts` dan `customer.service.ts`.
    - Memblokir event transaksi > 7 hari dengan 400 kecuali disertai konfirmasi `allowAged: true`. Event masa depan (> now + 120s) dijepit ke waktu sekarang.
  - **Fase 3 (Atribusi Jujur & Format Kanonis Meta)**:
    - State-Gated Fuzzy Catcher: evaluasi salam fuzzy hanya diproses untuk lead baru tanpa histori AdClick/reservasi/CTWA resmi. Pelanggan repeat atau native CTWA dilindungi dari pembajakan atribusi.
    - Pemisahan `try/catch` pada DB query di service atribusi menjamin ketahanan fallback offline.
    - Helper `formatMetaFbc`: memastikan format kanonis Meta `fb.1.<ts>.<fbclid>`.
  - **Fase 4 (Hilir Moderasi, Antrean, dan Follow-up)**:
    - Menambahkan filter status pada `GET /api/admin/capi-queue?status=pending|approved|ignored_outlier|all`.
    - Endpoint baru `POST /api/admin/reservation/:id/unreject-purchase` untuk memulihkan status outlier kembali ke `pending`.
    - Pembatalan otomatis (auto-cancel) antrean follow-up `NO_PURCHASE` berstatus `PENDING`/`QUEUED` saat reservasi di-approve untuk CAPI.
  - **Fase 5 (Privasi Log & Antarmuka Dashboard)**:
    - Helper `maskPhone` (e.g. `6281****6789`) dan `maskName` (e.g. `S**i A****h`) menyamarkan PII di seluruh log stdout/stderr CAPI dan ad attribution.
    - Antarmuka `MetaCapiQueue.tsx` diperbarui dengan tombol "Kembalikan" (`RotateCcw`) untuk item outlier, integrasi modal `useUiFeedback`, serta transmisi otomatis parameter `reason` dan `allowAged`.
- **Test & Verifikasi:**
  - 8 test file unit baru (60 tests) dibuat khusus mencakup setiap fase, seluruhnya lulus 100% green di Vitest offline suite.
  - `npm run build` di root backend dan `packages/admin-dashboard` lulus 100% tanpa error.
  - `npx tsc --noEmit` lulus dengan 0 kesalahan tipe.

#### 2026-10-08 - Fixed: Resolusi Wilayah Anti-Homonim Lintas Kota & Penyelarasan Status Presisi Lapangan Staf (Fase 0 - Fase 5)

- **Akar Masalah (multi-layer audit):**
  - **Gazetteer Homonim**: Pada pencarian toponimi tanpa nama kota (`cityScope == null`), pembobotan `kelurahan > kecamatan` di `rankedGazetteerScan` menyebabkan nama wilayah duplikat lintas kota (seperti Wonocolo, Krembangan, Semampir) terlempar ke desa/kelurahan di kabupaten tetangga (mis. Wonocolo Surabaya terlempar ke Desa Wonocolo Taman Sidoarjo). Tool `calculate-delivery.tool.ts` memanggil nama kecamatan terkelupas tanpa konteks kota.
  - **Desync Lokasi Staf**: Terjadi split-brain di mana kolom `customers.location_source = 'manual_staff'`, namun `preferences.location_source` bernilai `null` atau `db_coords` (seperti insiden Bunda Megga). Saat admin menekan "Refresh Lokasi", status visual terdegradasi menjadi "🟡 Koordinat Tersimpan" atau "⚪ Estimasi Wilayah".
  - **Akurasi GPS Lapangan**: Endpoint staf tidak memvalidasi akurasi meter GPS perangkat, berisiko mengunci titik indoor yang drift sebagai terverifikasi.
  - **Duplikasi UI Badge**: Badge status lokasi tersebar dengan logika if-else lokal yang tidak seragam di LiveChatMonitor, CustomerDatabase, dan StaffToday.
- **Fixed & Hardened (Fondasional 5 Fase):**
  - **Fase 0 (Audit Fakta Read-Only)**: Audit read-only live DB via SSH membuktikan desync riil berjumlah 90 baris (58 null, 14 customer_shareloc, 12 db_coords, 6 geocoding). Terbukti dataset gazetteer memuat 14 nama wilayah duplikat lintas kota (11 Sby–Sda, 3 Sda–Gresik).
  - **Fase 1 (Gazetteer Anti-Homonim Data-Driven)**:
    - Di `src/utils/gazetteer.ts`, himpunan duplikat `crossCityDuplicateSet` dihitung secara dinamis dari dataset saat init (zero-hardcode). Export helper `isCrossCityDuplicate()`.
    - Di `rankedGazetteerScan()`, jika frasa ada di duplikat lintas kota dan tanpa filter kota, kandidat dengan kecamatan yang disebutkan (`kecMentioned`) dimenangkan di atas pembobotan kelurahan.
    - Di `calculate-delivery.tool.ts`, fallback centroid memanfaatkan query lengkap dengan konteks kota.
  - **Fase 2 (Single Source of Truth Lokasi Staf & Gate Akurasi)**:
    - Di `staff-reservation.service.ts`, penulisan kolom `manual_staff` disinkronkan 100% dengan `preferences.location_source = 'manual_staff'` dan `location_source_label = '📍 Terverifikasi Staf'`, HANYA jika titik diperbarui sebagai koordinat primer. Karantina divergence >1 km tetap utuh.
    - Menambahkan validasi gerbang toleransi akurasi GPS `<= 50m` (ditolak bila `accuracyM > 50`).
    - Memastikan `refreshCustomerLocationAndOngkir()` mempertahankan status `manual_staff` tanpa terdegradasi ke `db_coords`.
  - **Fase 3 (Dashboard Satu Seam & Pemisahan Badge vs Navigasi)**:
    - Modul shared `geoUtils.ts` menyediakan helper kanonis `resolveEffectiveLocationSource`, `getLocationBadgeConfig`, dan `needsNavigationPreflight`.
    - Komponen `LiveChatMonitor`, `CustomerDatabase`, `CustomerMapTab`, dan `StaffToday` menggunakan satu resolver dan konfigurasi badge hijau `📍 Terverifikasi Staf` seragam.
    - Navigasi Maps untuk `manual_staff` tetap mewajibkan gerbang konfirmasi preflight (safety net 2026-09-30 terjaga).
  - **Fase 4 (Rekonsiliasi Skrip & Eksekusi Live)**:
    - Memperluas `reconcile-trapped-customer-locations.ts` dengan mode `--sync-staff-labels` dan `--audit-homonym`.
    - Dry-run live membuktikan 90 baris desync. Setelah konfirmasi manusia eksplisit, `--commit` berhasil menyinkronkan 90/90 baris menjadi 0 desync tanpa menyentuh koordinat/ongkir dan tanpa menyentuh reservasi completed.
  - **Fase 5 (Regresi & Build)**:
    - Seluruh unit tests (34 tests di 4 test files relevan) lulus 100%.
    - `npm run build` di root dan `packages/admin-dashboard` lulus tanpa error.

#### 2026-10-08 - Added: Fitur PIN (Sematkan Bubble) & HIDE (Sembunyikan Internal) di Live Chat

- **Akar & Kebutuhan Fitur (multi-layer audit):**
  - Staf CS butuh menyematkan pesan krusial (misal: alergi obat anak, nomor rekening khusus, instruksi darurat) agar tetap terlihat saat percakapan panjang bergulir.
  - Staf CS butuh menyembunyikan bubble internal yang sensitif atau memuat typo/kesalahan internal di monitor dashboard tanpa menghapus pesan dari WhatsApp pasien (zero gateway disruption).
  - Penanganan SSE `message.updated` terdahulu menimpa `content` secara naif, sehingga payload parsial dapat mengosongkan teks bubble di browser admin lain.
  - Penulisan `Conversation.session_data` rentan menimpa data state machine v3 (booking, keranjang, keluhan) jika tidak menggunakan spread/merge aman.
- **Fixed & Hardened (fondasional 5 fase):**
  - **Fase 0 (SSE Merge Aman):** Handler `message.updated` di `LiveChatMonitor.tsx` diperbaiki agar hanya memperbarui field yang terdefinisi (`!== undefined`) dan menggabungkan `payload_raw`, mencegah penghapusan konten bubble saat broadcast status.
  - **Fase 1 (Service Seam Kanonis & Single Pin):** Menambahkan `toggleMessagePin`, `toggleMessageHide`, dan `getPinnedMessage` pada `message.service.ts` dengan transaksi atomik Prisma, aturan single-pin otomatis (melepas sematan pesan lama bila pesan baru disematkan), safe merge `session_data.pinned_message_id`, memory fallback offline, pembersihan otomatis pointer basi saat revoke (`markMessageDeleted`), dan invalidasi cache `livechat:`.
  - **Fase 2 (Route, RBAC & Audit Trail):** Endpoint REST `PATCH .../messages/:messageId/pin`, `PATCH .../messages/:messageId/hide`, dan `GET .../pinned-message` di `livechat.subroute.ts`. Validasi body boolean, pelindung anti-IDOR lintas-tenant, dan pencatatan audit `MESSAGE_PIN`, `MESSAGE_UNPIN`, `MESSAGE_HIDE`, `MESSAGE_UNHIDE` dengan identitas staf dan IP lengkap.
  - **Fase 3 & 4 (Modular Frontend & Masking UI):** Komponen modular terpisah `MessagePinBanner.tsx` (banner sticky, auto-scroll/jump ke bubble) dan `HiddenMessageStrip.tsx` (placeholder collapsed + penampil sementara lokal per browser). Tombol semat dan sembunyikan di footer bubble. Penyamaran teks preview kartu sidebar dan snippet pencarian menjadi `[Pesan disembunyikan]`.
  - **Fase 5 (Pengujian Adversarial & Regresi):** 13 skenario adversarial di `tests/unit/live-chat-pin-hide.test.ts` lulus 100% (single-pin unpinning, safe session merge, tenant isolation anti-IDOR, larangan sembunyikan catatan internal atau pesan ditarik, pembersihan otomatis pointer saat revoke, dan in-memory fallback).
- **Test:** `npm run build` root dan `packages/admin-dashboard` lulus 100% tanpa error; 13/13 test unit baru dan 4/4 test paginasi pesan hijau.

#### 2026-10-08 - Fixed: Penyelarasan Penuh Zona Waktu WIB (Asia/Jakarta) pada Admin Dashboard & Kalender

- **Akar (multi-layer audit):**
  - Pada pagi hari antara pukul 00:00 s/d 06:59 WIB, UTC masih berada di tanggal kemarin (H-1).
  - Berbagai komponen frontend kalender dan reservasi (`CreateReservationModal`, `TodayTreatments`, `Reservations`, `DayScheduleGrid`, `MonthScheduleGrid`, `WeekScheduleGrid`, `DailyScheduleModal`, `QuickHoldModal`, `StaffToday`) menggunakan `new Date().toISOString().split('T')[0]`, `toLocaleDateString()` tanpa parameter `timeZone: 'Asia/Jakarta'`, atau `start.toISOString()` pada rentang kalender yang mengembalikan tanggal kemarin di UTC.
  - Parameter `startDate` & `endDate` kalender dikirim dalam format ISO string dengan `T`, menyebabkan helper backend `wibDayRangeToUtc` gagal melakukan regex match dan beralih ke parsing lokal yang rentan pergeseran hari.
  - Kontainer Docker `app`, `worker`, dan `postgres` belum memiliki environment variable `TZ=Asia/Jakarta`.
- **Fixed & Hardened (fondasional):**
  - **Penyelarasan Utilitas WIB Terpusat:** Menambahkan `getTodayWibDateKey()` (menggunakan `en-CA` dengan `timeZone: 'Asia/Jakarta'`), `getTodayWibDate()` (objek Date jam 12:00 WIB), dan `formatWibDate()` pada `dateWib.ts`.
  - **Penyeragaman Tanggal Reservasi & Kalender:** Seluruh fallback inisialisasi "Hari Ini" dan pemformatan tanggal pada modal reservasi, jadwal harian, dan ringkasan tugas staf kini deterministik mengacu pada zona waktu `Asia/Jakarta`.
  - **Kontrak Kanonis Query Kalender:** `getCalendarDateRange` pada `Reservations.tsx` mengembalikan tanggal murni `YYYY-MM-DD` WIB sehingga helper `wibDayRangeToUtc` di backend mengeksekusi batasan waktu 00:00:00 s/d 23:59:59.999 WIB secara sempurna.
  - **Lingkungan Kontainer:** Menambahkan `TZ=Asia/Jakarta` pada konfigurasi `app`, `worker`, dan `postgres` di `docker-compose.yml`.
- **Test:** `npm run build` di `packages/admin-dashboard` dan root backend lulus 100% tanpa error.

#### 2026-10-07 - Fixed: Optimalisasi Antarmuka & Sistem LiveChat (Fase 1-5)

- **Akar (multi-layer & UX audit):**
  - Staf sering kali tidak sengaja mengirim pesan yang belum tuntas karena tombol Enter memicu pengiriman langsung, bukan baris baru.
  - Paginasi `getConversationList` mengandalkan komparasi rapuh `conversations.length === take` yang menghasilkan `hasMore: true` palsu saat jumlah item tepat kelipatan limit.
  - Pencarian cuplikan pesan di monitor live chat menggunakan substring matching naif sehingga pencarian seperti "7km" memunculkan false positive percakapan dengan "17km", dan cuplikan pesan panjang terpotong tanpa fokus pada kata kunci.
  - Tombol aksi dan banner jadwal membingungkan staf antara tampilan ringkasan reservasi read-only vs formulir pengubahan jadwal.
- **Fixed & Hardened (fondasional):**
  - **Fase 1 (Komposisi & Input Editor):** Membalik perilaku tombol Enter di `LiveChatComposer.tsx` (Enter = newline, Ctrl/Cmd+Enter = kirim), menyetel `enterKeyHint="enter"`, menambahkan pengaman clipboard `handlePaste` plaintext lintas browser, dan meniadakan double scroll timeout jitter saat onFocus.
  - **Fase 2 (Kontrak Paginasi Limit+1 & Word-Boundary Backend):** `conversationService.listConversations` mengadopsi pola Limit+1 (`take: take + 1`) dan mengembalikan `{ items, hasMore }`. Query pencarian pesan dilengkapi filter word-boundary regex `(^|\W)<query>($|\W)` (post-query JS & in-memory fallback) tanpa mengganggu substring matching nama/telepon. Sinkronisasi pemanggil `live-chat.service.ts` dan `message.service.ts`.
  - **Fase 3 (Snippet Cerdas & Highlight Aman Frontend):** Menambahkan `extractSmartSearchSnippet` di `LiveChatMonitor.tsx` untuk menampilkan jendela teks relevan di sekitar kata kunci pencarian, serta memperketat regex highlight dengan word-boundary agar "17km" tidak tersorot saat mencari "7km".
  - **Fase 4 (Copy UI Banner & Modal):** Memperjelas tooltip dan hirarki visual: banner kartu terkonfirmasi mengarah ke ringkasan ("Lihat Ringkasan Jadwal & Bukti Bayar Pasien") dan pensil ke ubah jadwal ("Ubah Jadwal, Jam, atau Bidan Bertugas"). Tombol ubah pada `ReservationDetailModal.tsx` diubah menjadi secondary outline.
  - **Fase 5 (Validasi):** Harmonisasi unit tests dan penambahan uji ketahanan adversarial word boundary 7km vs 17km pada `conversation-filter.test.ts`.
- **Test:** Unit test `conversation-filter.test.ts` (14/14), `waha-history-sync.test.ts` (4/4), `conversation-sandbox-mode.test.ts` (4/4) lulus 100%. `npm run build` root dan `packages/admin-dashboard` lulus tanpa error.

#### 2026-10-07 - Refactored: Penyatuan Route Helper Admin & Eliminasi Dummy Timeout (Fase A)

- **Akar (multi-layer & modularity audit):**
  - Fungsi `tenantOf` terduplikasi di berkas route admin (`reservation-crud`, `reservation-dispatch`, `reservation-series`, `customers`, `reservations`), dan `sanitizeDurationMinutes` terduplikasi di `reservation-crud` dan `reservation-dispatch`.
  - Fungsi `trackIntervalStaggered` pada `src/lifecycle/background-crons.ts` mengembalikan `setTimeout(() => {}, intervalMs + jitter)` dummy alih-alih referensi timer awal (`starter`).
- **Refactored & Fixed (fondasional):**
  - **Shared Route Helper:** Membuat modul terpusat `src/routes/admin/route-helpers.ts` yang mengekspor `tenantOf` dan `sanitizeDurationMinutes`. Menghapus seluruh duplikasi definisi lokal pada berkas subroute terkait.
  - **Interval Stagger Clean Return:** Mengembalikan timer starter langsung dari `trackIntervalStaggered`, mengeliminasi alokasi timer tiruan mubazir.
- **Test:** Regression gate Fase A (`npm run build`, `queue-fallback-per-message.test.ts`, `queue.test.ts`, `waha-webhook.test.ts`) lulus 100% tanpa error.

#### 2026-10-07 - Fixed: Deteksi Durasi Batuk Kronis vs Penanda Usia Anak (Anti-Bleed Multi-Turn & Proksimitas Gejala)

- **Akar (multi-layer & semantic audit):**
  - `detectPersistentCoughRashEmergency` pada `src/config/medical-keywords.ts` memeriksa jendela teks sebelum angka menggunakan irisan statis karakter tanpa membatasi batas pesan/baris (`\n`). Pada riwayat percakapan multi-turn, token gejala dari turn terdahulu (`batuk pilek`) mencemari baris pesan aktif (`Anak saya (3 bulan)`), memicu `symptomPresent = true` semu.
  - Pada kalimat tunggal dengan verba gejala mendahului usia (`"anak batuk pilek, usia 3 bulan"`), ketiadaan komparasi posisi token membuat angka usia pasien terbaca sebagai durasi gejala, memicu false positive eskalasi CS `batuk kronis (90 hari)` dan membatalkan pemanggilan tool bot (`get_catalog_and_price`).
- **Fixed & Hardened (fondasional):**
  - **Anti-Bleed Pesan/Baris:** Menentukan batas awal baris aktif (`lineStart` via `lastIndexOf('\n')`) sehingga token antar-pesan atau antar-turn tidak saling mencemari.
  - **Relational Proximity & Parenthesis Guard:** Angka deterministik diperlakukan sebagai USIA pasien jika: (1) berada di dalam kurung bersama penanda usia (`(3 bulan)`), (2) didahului penanda usia tanpa verba gejala di jendela yang sama, atau (3) penanda usia berada lebih dekat ke angka daripada verba gejala (`lastAgeIdx > lastSymptomIdx`).
  - **Katalog Penanda Usia:** Diperluas mencakup `anakku`, `bayiku`, `balita` serta mendukung variasi awalan token.
- **Test:** Skenario `CM-22` dan seluruh matrix integrasi `tests/integration/v3-conversation-matrix.test.ts` (23/23) lulus 100%. Unit test `tests/unit/persistent-cough-rash-redflag.test.ts` (25/25) lulus 100% termasuk pengujian adversarial variasi urutan kata dan duplikasi riwayat pesan.

#### 2026-10-07 - Fixed: Remediasi Fondasional Follow-Up Engine & WINBACK MQL Mutlak (Plan Revisi-1)

- **Akar (multi-layer audit):**
  - Kontak non-MQL impor/legacy tanpa riwayat chat/reservasi (`6289660679070` Hidayah Sri Wilujeng dan 25 kontak serupa) dijadwalkan `WINBACK_60D` karena kueri generator memuat bypass `is_legacy_source: true`.
  - Serious-Only Gate di worker (`follow-up.service.ts:1701`) meloloskan kontak non-MQL jika berlabel legacy source.
  - Tombol admin `sendNow` belum memiliki atomic lease guard sebelum eksekusi, rentan tabrakan balapan dengan background worker.
  - Sebaran jadwal antrean mengandalkan `Math.random()`, tidak deterministik dan rentan memicu burst di menit/detik yang sama.
  - Pembatalan follow-up di beberapa rute menghapus `reservation_id` menjadi `null`, merusak audit relasi historis.
- **Fixed & Hardened (fondasional):**
  - **Fase 1 (Live DB Cleanup Terverifikasi):** Tabel backup `follow_ups_backup_20261008` (2.134 baris) dan `customers_backup_20261008` (836 baris). Membatalkan 25 antrean WINBACK non-MQL dan 1 NEXT_TREATMENT tanpa reservasi completed dengan `cancel_reason` kanonis `CANCEL_REASON.NON_SERIOUS_STAGE3`.
  - **Fase 2 (Konkurensi & Sebaran Deterministik):**
    - `src/services/follow-up.service.ts`: `sendNow` menambahkan atomic claim via `processing_claimed_at` lease window; `computeScheduleAtWib0940` kini menggunakan hash deterministik berbasis seed `customerId` (rentang 09:30–10:15 WIB).
    - `src/services/broadcast-queue.service.ts` & `src/services/waba-optout.service.ts`: Menghapus `reservation_id: null` pada operasi cancel follow-up, menggantikannya dengan `cancel_reason` kanonis.
  - **Fase 3 (MQL Mutlak & 2-Cabang WINBACK):**
    - `src/services/follow-up.service.ts`: Menghapus total `is_legacy_source` dari generator WINBACK dan Serious-Only Gate Stage 3.
    - Kueri `enqueueDormantWinbackFollowUps` difilter secara deterministik di level SQL menggunakan 2 cabang kualifikasi:
      - **Cabang A (Purna-Treatment):** Reservasi completed + pernah `SENT NEXT_TREATMENT` Stage 3 + antrean kosong + tanpa jadwal depan.
      - **Cabang B (Lead Serius):** `is_mql: true` + pernah `SENT NO_PURCHASE` Stage 3 + antrean kosong + tanpa jadwal depan.
    - `buildWinbackScheduleSlots` menggunakan agregat `groupBy` DB untuk kalkulasi beban harian yang efisien memori.
  - **Fase 4 (UI & Operasional):**
    - `packages/admin-dashboard/src/pages/tenant/FollowUpQueue.tsx`: Menambahkan tombol Cancel untuk item berstatus `FAILED` di card view dan table view. Memperbarui deskripsi modal konfirmasi reschedule dari 10 ke 40 blast/hari (selaras env `FOLLOWUP_MAX_PER_DAY`).
- **Test:** Unit test baru `tests/unit/followup-concurrency.test.ts` (2) dan `tests/unit/followup-winback-mql.test.ts` (4). Harmonisasi ekspektasi sebaran jadwal 09:30–10:15 WIB pada `follow-up-schedule.test.ts` dan `follow-up-inbound-sliding.test.ts`, serta kueri 2-cabang pada `winback-60d.test.ts`. Seluruh test suite follow-up (21/21 test) lulus 100%. `npm run build` root dan admin dashboard lulus tanpa error.

#### 2026-10-07 - Added: Fase 3 Prisma Dual-Write Relasional & Dedicated Worker Split (Fase 3A-3D)

- **Akar (multi-layer & scalability):**
  - Data buku alamat pelanggan sebelumnya hanya tersimpan di JSON blob `Customer.preferences.saved_addresses` dan item layanan reservasi tergabung di teks `treatment_detail`, menyulitkan query relasional pelaporan dan analisis analitik multi-layanan.
  - Seluruh cron jobs, sweeps, dan background workers sebelumnya berjalan di dalam satu proses utama Web Fastify (`src/app.ts`), membebani Event Loop HTTP server saat menjalankan sweep berkala.
- **Added & Refactored (fondasional, non-breaking dual-write):**
  - **Fase 3A (Skema Relasional & DDL Aditif):**
    - `prisma/schema.prisma`: Ditambahkan model `ReservationItem` dan `CustomerAddress` serta relasinya ke `Reservation`, `Customer`, dan `ClinicService`.
    - DDL SQL aditif tanpa downtime di `prisma/migrations/20261007000000_add_reservation_items_and_customer_addresses/migration.sql`.
  - **Fase 3B (Skrip Backfill Historis):**
    - `src/scripts/backfill-customer-addresses.ts`: Skrip backfill aman (--dry-run) untuk mengisi `customer_addresses` dari root fields + `preferences.saved_addresses` dan menautkan `reservations.customer_address_id`.
    - `src/scripts/backfill-reservation-items.ts`: Skrip backfill aman (--dry-run) untuk mendekomposisi `treatment_detail` ke baris relasional `reservation_items` dengan pencocokan `ClinicService` dan CAPI resolver fallback.
  - **Fase 3C (Dual-Write Transaksional):**
    - `src/services/customer.service.ts`: `persistSavedAddresses` menjalankan dual-write ke `customer_addresses` dengan graceful fallback in-memory untuk test offline.
    - `src/services/reservation-core.service.ts`: Mendukung `customerAddressId` dan `items`, auto-link alamat aktif, serta sinkronisasi idempoten ke tabel `reservation_items`.
    - `src/v3/tools/save-reservation.tool.ts`: Meneruskan `customerAddressId` dari `savedAddress.id` ke `reservationCoreService.saveReservation`.
    - `tests/setup.ts`: Ditambahkan mock `upsert` pada `customerAddress` dan `reservationItem` untuk isolasi offline tests.
  - **Fase 3D (Dedicated Worker Process):**
    - `src/lifecycle/background-crons.ts`: Abstraksi sentral seluruh cron jobs, sweeps, dan background workers.
    - `src/worker.ts`: Dedicated background worker entry point dengan graceful shutdown (`SIGTERM`/`SIGINT`), flushing queue, dan disconnecting Prisma.
    - `src/app.ts`: Melewati inisialisasi cron jika `SEPARATE_WORKER === 'true'`.
    - `docker-compose.yml`: Ditambahkan service `worker` (limit RAM 512MB) dan konfigurasi env `SEPARATE_WORKER`.
    - `package.json`: Ditambahkan script `start:worker` dan `worker:dev`.
- **Prinsip:** Zero breaking change, zero downtime, backward-compatible dual-write, dan modularity-first.
- **Test:** Seluruh unit & integrasi test lolos 100% (`multi-address-fase3`, `customer-saved-addresses`, `reservation-capture-helper`, `reservation-security-and-integrity`, `staff-trip-dispatch`, `dispatch-map-projection`, `followup-*`). `npm run build` (`tsc`) hijau tanpa error.

#### 2026-10-07 - Fixed: God Controller split — reservation-dispatch & reservation-series routes (audit arsitektur Fase 2.3)

- **Akar (multi-layer):** `reservations.subroute.ts` 3889 baris menggabungkan CRUD, dispatch, Sheets sync, series management — *Shotgun Surgery* untuk perubahan operasional. `fastify.get('/api/admin/dispatch/trip/...')` & 14+ handler dispatch + 7 handler series di file sama.
- **Fixed (fondasional, bertahap):**
  - **CRUD split (Fase 2.3 tahap 1-3):** `src/routes/admin/reservation-crud.route.ts` (1071 lines) → `count`, `daily-slots`, `list`, `parse`, `quick-hold`, `create` (6 handler). Dead code `findExplicitTimeFromHistory` dihapus.
  - **Dispatch split (Fase 2.3 tahap 4):** `src/routes/admin/reservation-dispatch.route.ts` (2629 lines) → 15 handler dipulihkan utuh dari backup git: `trip`, `release-hold`, `detail`, `confirm`, `complete`, `bulk-complete`, `edit`, `status`, `set-date`, `proof`, `assign-staff`, `delete`, `approve-purchase`, `reject-purchase`, `capi-queue` beserta helpers (`completeReservationById`, `runCompletionSideEffects`, dll).
  - **Series split (Fase 2.3 tahap 5):** `src/routes/admin/reservation-series.route.ts` (245 lines) → 7 handler dipulihkan utuh dari backup git: `create`, `get`, `get-by-customer`, `pause`, `resume`, `cancel`, `session-update`.
  - `src/routes/admin/reservations.subroute.ts` → hanya cache invalidation hook (29 lines).
  - `src/routes/admin/route.ts` register 3 route baru.
- **Prinsip:** Pecah God Controller per domain (CRUD / Dispatch / Series) tanpa ubah logika bisnis; handler pindah utuh ke file baru (pindah utuh tanpa rewrite → risiko regresi minimal).
- **Test:** `tests/unit/reservation-security-and-integrity.test.ts` (11/11), `tests/unit/reservation-series.test.ts` (8/8), `tests/integration/staff-trip-dispatch.test.ts` (11/11), `tests/unit/dispatch-map-projection.test.ts` (15/15); `npm run build` lolos tanpa error.
- **Hasil Verifikasi Blocker Fase 3:**
  - **Drift check live (43.173.11.79):** Terkonfirmasi drift `active_slot_key` dan tabel backup historis di live DB (`KNOWN_ISSUES` #238 / #234).
  - **Beban produksi live:** Load average 0.47, RAM 2.9GB/7.4GB, disk 56%, request rate idle/sangat ringan. Ready untuk perencanaan migrasi terstruktur.

#### 2026-10-07 - Fixed: Webhook echo detection tenant-aware (audit arsitektur Fase 1.3)

- **Akar (multi-layer):** `src/routes/webhook.route.ts:358` memfilter echo pesan keluar
  HP dengan string hardcode `'Bidan Yusi'`/`'Kala Spa'`/`'rumah'`. Tenant baru
  (nama brand beda) tidak terdeteksi sebagai bot-echo → pesan admin manual
  salah dikategorikan sebagai bot, memicu logika salah. Sumber pola sebenarnya
  sudah ada di DB: `Tenant.greetings_text`, `format_visit`, `name`.
- **Fixed (fondasional):**
  - `src/services/capi.service.ts`: tambah `getTenantEchoPatterns(tenantId)` ambil
    pola dari DB tenant, fallback `[]` bila offline.
  - `src/routes/webhook.route.ts`: ganti hardcode `includes('Bidan Yusi')` dgn
    `echoPatterns.some(p => adminReplyText.includes(p))`.
  - `senderName` logging: `'Bot (Kala Spa)'` → `Bot (${tenantName || 'Klinik'})` ambil
    `Tenant.name` di resolve tenant.
- **Prinsip:** nol hardcode brand di kode; pola & nama dari DB per-tenant.
- **Test:** `tests/unit/webhook-echo-tenant.test.ts` (5 kasus: pola DB dipakai,
  fallback tenantName, pola kosong fail-safe).
- **Regresi:** `npm run build` + `npm test` (28 test webhook/queue hijau).

#### 2026-10-07 - Fixed: 3x duplikat capture reservasi webhook → 1 helper kanonis (audit arsitektur Fase 1.2)

- **Akar (Shotgun Surgery):** `webhook.route.ts` lines 1280/1354/1465 — 3 blok
  identik ~35 baris parse form + explicit time + CAPI InitiateCheckout. Perubahan
  format form mengharuskan edit 3 tempat (risiko regresi tinggi).
- **Fixed (fondasional):**
  - `src/services/reservation-lifecycle.service.ts`: helper baru
    `tryCaptureReservationFormFromRaw(params)` → 1 tempat, pakai
    `reservationCoreService.saveReservation` (kanonis, DEPRECATED
    `upsertReservationForm` tidak dipakai).
  - 3 blok di `webhook.route.ts` diganti panggilan 6 baris.
  - Dead code `findExplicitTimeFromHistory` (hanya dipakai 3 blok tsb) dihapus.
- **Prinsip:** DRY di level service kanonis; tool contract `saveReservation`
  jadi single source of truth.
- **Test:** `tests/unit/reservation-capture-helper.test.ts` (5 kasus adversarial:
  form valid → captured+CAPI, bukan form → false, parse fail → error info,
  explicit time WIB→UTC, source mapping WEBHOOK_*→WEBHOOK).
- **Regresi:** `npm run build` + `npm test` (28 test webhook/queue hijau).

#### 2026-10-07 - Fixed: QueueService sticky Redis downgrade (audit arsitektur Fase 1.1)

- **Akar (multi-layer):** `enqueueMessage` men-set `this.redisEnabled = false` di
  dalam `catch` ketika `queue.add()` gagal satu kali (mis. hiccup Redis sesaat).
  Akibatnya SELURUH pesan berikutnya jatuh ke in-memory queue tanpa pemulihan
  (sticky downgrade) — antrean tak lagi persisten dan hilang saat container
  restart. Flag koneksi seharusnya HANYA dikendalikan event `on('error')`/
  `on('ready')` di `initQueueSystem()`, bukan per-kegagalan enqueue.
- **Fixed (fondasional, bukan tambal-sulam):** `src/services/queue.service.ts`
  `enqueueMessage` kini fallback in-memory HANYA untuk pesan yang gagal
  (`this.enqueueInMemory(phone, payload); return;`) dan TIDAK menyentuh
  `redisEnabled`; log per-pesan diperjelas (`[QUEUE WARN]`).
- **Prinsip:** flag status koneksi (state machine) dipisahkan dari keputusan
  fallback per-request; pesan berikutnya selalu dicoba ke BullMQ selama Redis
  dinyatakan hidup, sehingga antrean kembali persisten otomatis pasca-hiccup.
- **Test:** `tests/unit/queue-fallback-per-message.test.ts` (2 kasus adversarial:
  gagal-1x-lalu-sukses tetap coba BullMQ + Redis-flag-utuh; Redis benar-benar
  offline tetap ke in-memory) — hijau bersama `tests/unit/queue.test.ts` (8/8);
  `npm run build` root lolos.
- **OPEN (Fase 0 blocker):** verifikasi drift `active_slot_key` live
  (`43.173.11.79`) & ukur beban produksi BELUM bisa dilakukan lokal (DB
  `localhost:5432` offline). Wajib diverifikasi di server sebelum Fase 2/3.
  Lihat `docs/KNOWN_ISSUES.md` #234/#238.

#### 2026-10-07 - Fixed: Pemisahan "Selesai" vs "Lunas" — status bayar tri-state & moderasi CAPI outlier tidak mengubah keuangan

- **Akar (multi-layer):**
  1. `completeReservationById` (`reservations.subroute.ts:109`) tidak mengisi `purchase_occurred_at`,
     sementara `PATCH /status` (:2460) justru punya fallback — 2 pintu "selesai" tidak konsisten.
  2. `isLunas = Boolean(purchase_occurred_at)` membuat reservasi `completed` tanpa catatan bayar
     tampil "Tagih di Tempat" (mengesankan kunjungan belum terjadi).
  3. Teks konfirmasi `MetaCapiQueue` ("Data internal tetap tercatat") menyesatkan; `reject-purchase`
     tidak pernah menyentuh status bayar (dan memang tidak boleh).
- **Fixed (fondasional, Opsi B — pisahkan, jangan satukan):**
  - `src/domain/reservation-payment.ts`: seam kanonis tri-state `getPaymentDisplayStatus()` +
    `getPaymentDisplayLabel()` (`LUNAS` / `SELESAI_BELUM_VERIFIKASI` / `TAGIH_DI_TEMPAT`).
  - `src/services/financial-analytics.service.ts`: ledger admin memakai seam; completed-belum-bayar →
    "Selesai — verifikasi bayar" (bukan "Tagih di Tempat"); lunas tanpa metode tidak lagi dipaksa "TRANSFER".
  - `src/services/staff-notification.service.ts`: label notifikasi jujur (tidak klaim "Transfer").
  - `src/routes/admin/reservations.subroute.ts`: fallback `purchase_occurred_at` di `PATCH /status`
    DIHAPUS (konsisten dengan seam tunggal); `reject-purchase` diberi guard komentar (keuangan internal
    tak diubah — CAPI murni atribusi Meta Ads).
  - `packages/admin-dashboard/.../FinancialAnalytics.tsx`: chip filter + label 3-status;
    `MetaCapiQueue.tsx`: teks konfirmasi jujur ("Status pembayaran internal TIDAK berubah").
- **Prinsip:** lunas HANYA via jalur bayar resmi (`recordPayment` staff / `approve-purchase` / deteksi
  pesan Payment). "Selesai" tidak menyiratkan "lunas" → piutang tidak hilang, tidak ada label metode palsu.
- **Test:** `tests/unit/reservation-payment-display.test.ts` (9, termasuk adversarial ISO/Date/null) +
  suite CAPI/reservasi/staff hijau; `npm run build` root & `packages/admin-dashboard` lolos.
- **Data live:** TIDAK ada UPDATE massal. Reservasi `completed` lama tampil jujur "Selesai — verifikasi bayar"
  sampai bayar dicatat resmi. Lihat `docs/KNOWN_ISSUES.md` #240.

#### 2026-10-06 - Fixed: Kolom F Rekapan Sheets "Repeat" palsu — otoritas ordinal riwayat transaksi

- **Akar (multi-layer):**
  1. `reservations.is_repeat_order` historis terkontaminasi bug modul follow-up lama
     (mutasi saat follow-up `NO_PURCHASE` dibatalkan; sudah diperbaiki 2026-10-03).
  2. `sheets-sync.service.ts` + `row-formatter.ts` membaca flag mentah itu secara naif,
     berbeda dengan Admin Dashboard/CAPI yang menghitung ordinal riwayat
     (`confirmed/en_route/completed`) secara dinamis.
- **Fixed (fondasional):**
  - `src/services/sheets/row-formatter.ts`: `resolveCustomerType()` menerima `priorCount`;
    bila tersedia, `priorCount > 0` MUTLAK menentukan `Repeat` dan flag DB diabaikan
    (hanya fallback bila ordinal tak dihitung).
  - `src/services/sheets/sheets-sync.service.ts`: `PrismaSheetsSyncStore.getReservation`
    menghitung `prior_reservations_count` (jumlah reservasi kanonis `confirmed/en_route/
    completed` milik customer yang `created_at` LEBIH AWAL — ordinal sama dengan
    `reservations.subroute.ts` & `computeIsRepeatOrder`), lalu menurunkan ulang
    `is_repeat_order`. Fail-safe DB offline → 0 (New).
- **Data healing live (default-tenant):** normalisasi flag Oktober ke ordinal kanonis;
  backup in-DB `reservations_repeat_backup_20261006` (11 baris; 10 salah-true + 1 salah-false).
  Verifikasi ulang: 0 anomali tersisa untuk Oktober.
- **Deploy live:** image `app` di-rebuild di 43.173.11.79 (WAHA untouched, zero WAHA disruption).
- **Test:** `sheets-rekapan-formatter` + `sheets-sync.service` (39 hijau, termasuk 4 kasus
  adversarial kontaminasi/stale + kontrak query ordinal); regresi CAPI/follow-up 16 hijau; `npm run build` lolos.
- **OPEN:** 147 anomali historis (Apr–Sep 2026) di luar scope Oktober — lihat `docs/KNOWN_ISSUES.md` #235.

#### 2026-10-06 - Changed: Standardisasi Kolom Rekapan Sheets & Klasifikasi CAC (New Ads / New / Repeat)

- **`row-formatter.ts` & `sheets-sync.service.ts`:**
  - Kolom D (Lokasi): HANYA kelurahan (tanpa imbuhan kota/kabupaten).
  - Kolom E (Bayi/Layanan): HANYA nama bayi (tanpa usia/bulan/tahun).
  - Kolom F (Tipe Customer): Klasifikasi terpadu untuk analisis CAC (`Repeat` bila repeat order, `New Ads` bila pelanggan baru dari ads/adClick/CTWA, `New` bila pelanggan baru organik/langsung).
  - Kolom M (Bidan): Nama staf saja tanpa prefix "Bidan".
  - Kolom N (Tip): Dikosongkan (`''` / null).
  - Kolom P (Catatan): Dikosongkan (`''`).
  - `sheets-sync.service.ts`: Query `getReservation` kini mengikutsertakan `adClick` customer untuk deteksi traffic iklan.
- **Google Sheets Tab `okt`:** Rekonsiliasi & pembaruan seluruh Baris 2 s/d 32 (tanggal 1 s/d 12 Oktober) diselaraskan ke format standar baru.
- **Verifikasi:** 30/30 unit test hijau (`sheets-rekapan-formatter.test.ts` & `sheets-sync.service.test.ts`), `npm run build` lolos.

#### 2026-10-05 - Fixed: Residual Audit #1 (jalur prompt DB) & #2 (ukur cache)

- **#1 (`prompt-composer.ts`):** jalur `composeSystemPromptAsync` DB kini menghormati
  `phaseInjection` (blok `[PHASE_FOCUS]`) + flag masking tool — tidak lagi mengabaikan
  diam-diam untuk tenant yang punya `tenant_prompt_config`.
- **#2 (terukur):** prefix stabil dalam fase SAMA byte-identik (EARLY 30.740 / CONSULT 46.197 char)
  → cache-hit antar-turn; miss hanya saat pindah fase. Test: `tests/unit/v3/db-prompt-phase-mask.test.ts`.
- **Verifikasi:** build lolos; 97/97 test hijau.

#### 2026-10-05 - Fixed: Hasil Audit Best-Practice Sesi Stabilisasi

- **SEDANG-1 (`queue.service.ts`):** `latestTurnByPhone` kini LRU berbatas
  (`MAX_LATEST_TURN_ENTRIES=5000`) — cegah pertumbuhan memori proses panjang.
- **SEDANG-2 (`cart-manager.ts`):** `countDistinctPrimaryOffers` dedup per-KELUARGA
  (irisan ≥2 token non-generik) — bundle/varian se-famili dihitung 1 opsi (anti over-count CTA).
- **MINOR-1 (`date-confirmation.ts`):** docstring usang '?'-only dibersihkan; deskripsi
  `isConsultativeUserText` diselaraskan dengan perilaku interogatif tanpa '?'.
- **SEDANG-3/4 (DIDOKUMENTASIKAN, belum diperbaiki):** jalur prompt async-DB mengabaikan
  `phaseInjection`; dampak prompt-cache dari `slim` belum diukur — dicatat `KNOWN_ISSUES` #233.
- **Verifikasi:** build lolos; eval + cart + queue + guardrail 59/59 hijau; test dedup keluarga ditambah.

#### 2026-10-05 - Changed: Fase 2b — Guidance Tool Mask-Aware di Call 2

- **`agent-runner.ts` → `generation-stage.ts` → `persona/prompt-composer`:** flag
  `isSaveReservationMasked`/`isCalculateDeliveryMasked` (sudah dihitung di Call 1) kini
  diteruskan ke prompt Call 2. Guidance tool yang di-mask TIDAK lagi dijelaskan penuh —
  selaras dengan skema `tools` JSON yang benar-benar dikirim (information hiding).
- **Hasil terukur:** prompt ter-mask **46.665 char** vs 48.617 (hemat ~1.952 char);
  dikombinasi `slim` state-gated Fase 2.
- **Catatan Fase 2b lanjutan DITOLAK:** blok `NEGATIVE CONSTRAINTS` hanya 10.690 char
  terpecah kecil & mayoritas aturan keselamatan → memangkasnya berisiko tinggi/hasil kecil
  (lihat `KNOWN_ISSUES` #233). Keputusan berbasis ukur, bukan asumsi.
- **Verifikasi:** build lolos; eval 7/7; tool-masker & prompt suite hijau.
  `v3-conversation-matrix` CM-22 gagal **pre-existing** (bukan dari change ini; terverifikasi
  gagal juga tanpa perubahan ini).

#### 2026-10-05 - Fixed: Red-flag Medis Komposit RF-06 (batuk-ruam-demam)

- **Investigasi (koreksi temuan harness T1):** "RF-06 tidak dieskalasi" BUKAN bug produksi —
  detektor `detectPersistentCoughRashEmergency` bekerja benar dengan riwayat lintas-turn;
  gagal hanya saat riwayat kosong (DB offline di harness). Detail: `docs/KNOWN_ISSUES.md` #234.
- **FIX-2 (`src/config/medical-keywords.ts`):** pencocokan `batuk` kini prefiks — menangkap
  imbuhan "batuknya"/"berbatuk" (sebelumnya meleset kata-utuh).
- **FIX-3 (`src/config/medical-keywords.ts`):** guard proksimitas usia tidak lagi menyaring
  durasi saat ada verba gejala ("anak batuk 2 minggu" = durasi, bukan usia anak).
- **Test:** `tests/unit/medical-rf06-composite.test.ts` (10 kasus). Suite medis 80/80,
  golden corpus 61/61, build lolos.
- **Sisa OPEN:** FIX-1 (silent degradation bila riwayat DB kosong) dicatat di #234.

#### 2026-10-05 - Added/Changed: Program Stabilisasi Kecerdasan (Fase 0–2)

- **Fase 0 — baseline (read-only):** `V3_GENERATION` system prompt rata-rata 45.000 char
  (98% instruksi), rasio token prompt:jawaban 60:1; produksi `llm_audit_logs` `CHAT_REPLY`
  p95 361 dtk + 8 completion=0, `SLOT_EXTRACTOR` 15 completion=0; 6 guardrail 0-tembakan.
  Detail: `docs/KNOWN_ISSUES.md` #233.
- **Fase 1 — ujian emas:** `tests/eval/golden-conversations.eval.test.ts` (7 skenario
  deterministik + pagar anggaran prompt). Skor 7/7.
- **Fase 2 — perampingan prompt state-gated:** Call 2 dirakit `slim:true` +
  `derivePhaseFocus` (`generation-stage.ts`, `prompt-composer.ts`); mandat medis
  (`MEDICAL_SOP_MANDATE_BLOCK`) diekstrak agar selalu ikut (`scheduling.phase.ts`).
  Prompt turun 48.614 → 32.342 char (EARLY, −33%) / 41.746 (CONSULT, −14%).
  Verifikasi: build lolos, 76 test hijau, skor emas 7/7.
- **Catatan:** CHANGELOG ini sempat ditimpa penulis paralel (isue "penulis paralel" #…);
  entri Fase 0–2 ditulis ulang. Perubahan `Follow-Up` di atas BUKAN bagian dari Fase 0–2.

#### 2026-10-06 - Fixed: Remediasi Fondasional Engine Follow-Up (Audit 32 Temuan, Tahap 1-5)

- **Tahap 1 - Skema DB & Integritas (`prisma/schema.prisma`, migrasi
  `20261006000000_fix_followup_unique_and_indexes`):**
  - **V1** Anti-duplikat follow-up aktif. Karena repo melarang partial index (drift
    permanen, lihat migrasi 20260920000001), dipakai kolom sentinel nullable
    `active_slot_key` + trigger Postgres `follow_ups_active_slot_key_trg` (Prisma-native,
    drift aman): baris PENDING/QUEUED unik per `(tenant, customer, type, stage)`; baris
    historis `active_slot_key = NULL`. Unique lama `(tenant_id, reservation_id, type, stage)`
    di-drop. Migrasi menyertakan dedup data live (`cancel_reason='DEDUP_CLEANUP'`).
  - **V2** `reservation_id` DIPERTAHANKAN saat cancel (6 titik di `follow-up.service.ts`)
    untuk audit trail; tidak lagi dinetralkan ke NULL.
  - **V3** Indeks komposit `follow_ups(tenant_id,status,scheduled_at)` &
    `customers(tenant_id,deleted_at,status)`.
  - **H6** `buildNonBypassCustomerWhere` (`utils/customer-bypass.ts`) kini mengecualikan
    `deleted_at != null` dan `is_internal_staff`.
- **Tahap 2 - Jam Kerja & Kuota (`follow-up.service.ts`, `cron.service.ts`):**
  - **V8** Gerbang jam kerja deterministik 09:00-17:00 WIB di `processDueFollowUps`
    (`isWithinFollowUpWorkingHours`); pengiriman TIDAK lagi dipicu dari `runMorningJobs`
    (subuh 06:00) - pindah ke worker jam kerja.
  - **M1** Rem kuota harian runtime (`countDailySent` terhadap `FOLLOWUP_MAX_PER_DAY`,
    batch dibatasi sisa kuota).
  - **M5/M6** `createNoPurchaseFollowUps` memakai jadwal 09:40 WIB (`computeScheduleAtWib0940`)
    + jitter 0-30 menit (anti burst).
  - **V9** Idempotensi morning jobs berbasis DB (`AdminNotificationLog.idempotency_key`)
    tahan restart container; klaim dilepas bila gagal agar bisa retry.
- **Tahap 3 - Konkurensi (`follow-up.service.ts`, skema `processing_claimed_at`):**
  - **V5/H3** Klaim atomik (lease) `processing_claimed_at` - worker vs `sendNow` tidak
    dobel-kirim; lease kedaluwarsa otomatis (env `FOLLOWUP_CLAIM_LEASE_MS`).
  - **V6** Cek-ulang status dari DB tepat sebelum kirim fisik; abort bila status berubah.
  - **V7** `logMessage` Live Chat dipindah ke SETELAH kirim sukses (write-after-send);
    WAHA gagal tidak lagi meninggalkan bubble bot fiktif.
  - **H10** `sendNow` memuat relasi lengkap (reservation, labels, conversations) -
    `{time}` benar & gerbang CS-handoff/bypass bekerja.
- **Tahap 4 - Kalender & Lifecycle (`follow-up.service.ts`):**
  - **M2** `computeNextTreatmentAtWib0900` menjepit akhir bulan (31 Okt +1 bln = 30 Nov).
  - **M4** `suppressPrematureNextTreatment` menjaga ritme bulanan (`+stage` bulan, bukan +14 hari).
  - **M3/H8** `checkAndSetLostCustomers`: kohort NO_PURCHASE Stage 3 tanpa respons jadi `lost`
    (env `NO_PURCHASE_LOST_GRACE_DAYS`); NEXT_TREATMENT memakai jendela 60 hari
    (env `LOST_CUSTOMER_NEXT_TREATMENT_GRACE_DAYS`), bukan 3 hari.
  - **H7** Inbound chat / reservasi membatalkan antrean `WINBACK_60D` aktif
    (`CANCEL_REASON.INBOUND_CHAT`).
  - **M11** `resolveMilestoneType` menerima kategori `BOTH` & memindai seluruh `children`.
  - **M7** `createReservationFollowUps` tidak lagi membuat baris zombie REMINDER_H1/REVIEW_H1
    (default OFF; aktifkan via `FOLLOWUP_CREATE_REMINDER_REVIEW='true'`).
- **Tahap 5 - Transport & UI (`follow-up.service.ts`, `follow-up.subroute.ts`, `FollowUpQueue.tsx`, `cron.service.ts`):**
  - **H4/V10/V11** WABA mengirim parameter lengkap `{name,time,babyName}`, jeda acak
    1.5-3 dtk (`WABA_SEND_THROTTLE_BASE_MS`), dan mencatat TEKS terbaca ke Live Chat.
  - **M9** Normalizer sapaan deterministik terpusat (dobel "dek dek"/"Bunda Bunda").
  - **M8/H5** Default kuota UI/API 10->40 (`FOLLOWUP_MAX_PER_DAY`); endpoint
    `POST /api/admin/follow-ups/:id/retry` + tombol "Coba Lagi" untuk item FAILED.
  - **H9** Hapus dead-code `sendMorningReminders` & `sendYesterdayReviewsAndScheduleNextFollowups`
    (219 baris) + import terkait. Catatan: `broadcast-queue.service.ts` (BullMQ) BUKAN
    dead-code - dipakai `settings.subroute.ts`; tidak dihapus.
- **Test baru:** `followup-working-hours` (batas 09:00/17:00 WIB), `followup-atomic-claim`
  (anti dobel-kirim paralel), `followup-date-and-milestone` (overflow 31 Okt + milestone BOTH).

#### 2026-10-05 - Fixed: Audio WhatsApp gagal dimuat di Portal Staf (voice note 404 / tak didukung)

- **Akar (multi-layer):** (1) deteksi media berat di webhook memakai `payload.message?.audioMessage`
  / `payload.type` yang TIDAK ada di payload WAHA NOWEB/Baileys (struktur asli di
  `_data.message` + `hasMedia`/`media`) → `heavyMediaType` selalu null → audio TIDAK pernah
  diarsipkan; (2) file WAHA kedaluwarsa 180s → proxy `/api/files` 404; (3) `MIME_MAP` media
  route tak punya audio; (4) Safari iOS tak decode Ogg Opus `.oga`.
- **Fixed backend (`src/routes/webhook.route.ts`):** deteksi media berat dari tipe KANONIS
  (`canonical.type` = `audio`/`voice_note`/`video`/`document`), + unduh via URL langsung
  (fallback `downloadMedia`). Blok arsip/lampir/SSE yang sudah ada kini benar-benar terpanggil
  untuk audio.
- **Fixed backend (`src/routes/media.route.ts`):** `MIME_MAP` + audio (`oga/ogg/opus/mp3/m4a/wav`),
  video, pdf; header `Accept-Ranges: bytes` untuk streaming/seek.
- **Infra (`docker-compose.yml`):** `WHATSAPP_FILES_LIFETIME=86400` (defense-in-depth; berlaku
  setelah WAHA restart — tidak di-restart di deploy ini).
- **Fixed frontend (`StaffToday.tsx` & `LiveChatMonitor.tsx`):** saat audio gagal diputar,
  sediakan tautan fallback "Buka / unduh" agar terapis tetap bisa mengakses rekaman.
- **Fixed (`src/utils/pii-masker.ts`):** pertahankan metadata `isPtt`/`isSticker` pada media.
- **Test:** `tests/integration/waha-webhook.test.ts` (+1 audio `_data` → `saveInboundMedia`),
  `tests/unit/media-mime-audio.test.ts` (Content-Type audio/ogg + Accept-Ranges + 401).

#### 2026-10-05 - Fixed: AI Scope Gate — jam acuan idle terkontaminasi pesan bot (Opsi A)

- **Akar (multi-layer):** gerbang `enforceAiScopeGate` sudah benar mendeteksi pasien
  repeat/legacy, tetapi pengecualian mid-flow (`src/services/ai-scope-gate.service.ts`)
  mengukur "idle" dari `conversation.last_message_at` = aktivitas apa pun, TERMASUK
  pesan outbound bot sendiri. Follow-up `NEXT_TREATMENT` menyegarkan `last_message_at`
  sehingga percakapan yang sudah tidur berhari-hari terbaca "aktif" → bot tetap
  menjawab pasien yang seharusnya langsung ke CS (kasus 6285109356888 / Bunda Rina).
- **Fixed:** `isAtResetBoundary` kini mengukur jeda dari `last_customer_message_at`
  (chat MASUK customer), fallback ke `last_message_at` bila kolom belum terisi
  (data lawas / WABA lama) — perilaku lama utuh. Tanpa regex/prompt/dependency/migrasi.
- **Paritas WABA:** `src/routes/waba-webhook.route.ts` kini memanggil
  `conversationService.updateLastCustomerMessageAt` seperti jalur WAHA, agar kolom
  terisi juga di WABA (tanpa ini, fallback terus → bug setara tak sembuh).
- **Test:** `tests/unit/ai-scope-gate.test.ts` +4 (T-A replay Rina merah→hijau,
  T-B mid-flow asli tetap pass, T-C1/C2 fallback).
- **Blast radius:** hanya `isAtResetBoundary` (dipakai gerbang ini saja). Rollback =
  `git revert` satu commit.

#### 2026-10-05 - Fixed: Pengingat NEXT_TREATMENT prematur (Recent/Upcoming-Visit Guard)

- **Masalah (kasus 6285109356888):** customer yang SUDAH punya riwayat beli tetap
  menerima follow-up `NEXT_TREATMENT` ("ayo booking treatment berikutnya") hanya 5 hari
  pasca-kunjungan, karena pengingat repeat-order tidak punya penjaga "customer baru saja
  ditangani" (penjaga itu hanya ada untuk `NO_PURCHASE`).
- **Perbaikan (`src/services/follow-up.service.ts`, gerbang kode deterministik — bukan
  tambahan larangan prompt):** metode `suppressPrematureNextTreatment()`. Bila ada
  reservasi **non-cancelled** dengan `booking_date >= now − N hari` (satu kondisi
  mencakup kunjungan baru DAN booking yang akan datang), `scheduled_at` `NEXT_TREATMENT`
  DIGESER ke `booking_date + N hari` 09:40 WIB. **Menunda, bukan membatalkan** — deret
  tetap hidup. Ambang env baru `FOLLOWUP_RECENT_VISIT_SUPPRESS_DAYS` (default 14 hari).
- **Untuk admin:** jika customer "baru saja treatment" tak seharusnya ditodong booking
  lagi, atur ambang lewat env di atas; nilai besar = lebih longgar, kecil = lebih ketat.
- **Regresi dikunci:** `tests/unit/follow-up-engine.test.ts` T30 (visit <14 hari → ditunda),
  T31 (booking akan datang → ditunda), T32 (visit lama → tetap terkirim). 36/36 hijau.
- **Verifikasi:** `npx vitest run tests/unit/follow-up-engine.test.ts` + suite follow-up
  terkait (65/65) hijau; `tsc` bersih.

#### 2026-10-05 - Added: Rekapan Google Sheets — Fase 4 (Endpoint Admin & UI Tab)

- **Endpoint admin (`src/routes/admin/google-integration.subroute.ts`, reusability-first,
  tanpa rute baru):** `GET/PUT /api/admin/integrations/google/sheets-config`
  (baca/ubah toggle, nama file, master spreadsheet, template, peta tahun) dan
  `POST /api/admin/integrations/google/sheets-test` (uji koneksi: siapkan tab bulan
  berjalan TANPA menulis baris, pesan error jujur per-kasus). Semua ter-audit.
- **Service (`sheets-sync.service.ts`):** metode publik `getPublicConfig`,
  `updateConfig` (whitelist field), `testConnection`.
- **UI (`GoogleIntegrationPanel.tsx`, sub-tab — bukan page baru):** tab
  "Rekapan Pasien (Google Sheets)" dengan toggle aktif, input link/ID spreadsheet
  (auto-ekstrak ID dari URL), nama file & template, tombol "Uji Koneksi & Siapkan Tab",
  dan panduan singkat. Registrasi tahun berjalan ke `yearly_file_ids` otomatis dari UI.
- **Test:** `sheets-sync.service.test.ts` +2 (`testConnection` tidak menulis baris;
  tahun belum dipetakan → throw) → 12/12.
- **Verifikasi:** `npm run typecheck` bersih; `packages/admin-dashboard` `npm run build`
  hijau.

#### 2026-10-05 - Added: Rekapan Google Sheets — Fase 2–3 (Service, Outbox Worker, Hook & Update Admin)

- **Adaptor Google (`src/services/sheets/sheets-client.ts`):** `SheetsGateway` di atas
  Google Sheets API v4 memakai token OAuth per-tenant (`googleOAuthClientManager`,
  scope `spreadsheets`), tanpa Service Account & tanpa dependency baru.
  `ensureMonthlyTab` (duplikat dari `_TEMPLATE`, `clear A2:P1000`, race-safe: error
  "sudah ada" → re-fetch = sukses), `appendRow` (`USER_ENTERED`), dan `updateCells`
  (kelompok kolom berurutan). Helper murni `parseRowIndexFromRange` & `columnLetter`.
- **Service sinkronisasi (`src/services/sheets/sheets-sync.service.ts`):** `enqueue()`
  (hanya tulis outbox non-blocking), `processOutbox()` (retry/backoff 1-5-15-60 mnt,
  max 10 → `failed`; error "belum siap" seperti belum-connect/tanggal-kosong/tahun-belum-
  dipetakan → ditunda tanpa menghabiskan attempts), `syncReservation()` (append pertama,
  update baris berikutnya). **Harga write-once:** saat update, kolom H/I/J/K
  (ongkir/total/diskon/harga akhir) DILEWATI agar koreksi manual admin tidak tertimpa.
  Dua seam uji: `SheetsGateway` + `SheetsSyncStore` (default Prisma, test in-memory).
- **Hook (Fase 3):** `reservation-lifecycle.service.ts` menambah `sheetsSyncService.enqueue`
  best-effort setelah Google Contacts; admin `reservations.subroute.ts` menambah enqueue
  pada assign-staff & update reservasi (bayar/status). Worker cron
  `cronService.runSheetsSyncWorker()` di-wire di `app.ts` (gated
  `ENABLE_SHEETS_SYNC_CRON`, default aktif, interval `SHEETS_SYNC_INTERVAL_MINUTES`=1m).
- **Test:** `tests/unit/sheets-sync.service.test.ts` (10) — append pertama buat tab,
  idempotensi update-bukan-append, write-once harga (H/I/J/K tidak disentuh),
  tahun belum dipetakan → tunda, tanggal kosong → throw, config nonaktif → tak menumpuk,
  retry backoff sampai `failed`. Total suite terkait 39/39 hijau; `tests/setup.ts` ditambah
  mock `tenantSheetsConfig`/`sheetsSyncOutbox`.
- **Verifikasi:** `npm run typecheck` bersih.

#### 2026-10-05 - Added: Rekapan Google Sheets — Fase 1 (Resolver Murni & Format 16 Kolom)

- **Modul baru murni (tanpa I/O, mudah diuji offline):**
  - `src/services/sheets/month-resolver.ts` — `resolveSheetTarget(bookingDate, monthTabNames?)`
    memetakan tanggal → tab bulan + tahun + hari + ISO WIB, memakai ulang
    `src/utils/wib-time.ts` (single source of truth WIB, tidak ada konversi kedua).
    Nama 12 tab bulan disuntikkan dari DB (`TenantSheetsConfig.month_tab_names`) — bukan
    hardcode; `DEFAULT_MONTH_TAB_NAMES` hanya fallback. `resolveYearlyFileName()` untuk
    nama file tahunan.
  - `src/services/sheets/row-formatter.ts` — `formatReservationToRow()` menghasilkan
    TEPAT 16 sel (A–P): Tanggal, Hari, Customer, Lokasi, Bayi, Tipe, Layanan, Ongkir,
    Total, Diskon, Harga akhir, Metode Bayar, Bidan, Tip, Follow up, Catatan. Ongkir
    fallback `delivery_fee ?? Customer.ongkir` (pola KB-6); Harga akhir = Total+Ongkir−Diskon;
    tag internal (`[HOLD]`, `[SAME_DAY_REQUEST]`, dst.) dibersihkan; sel kosong = `-` agar
    kolom tak bergeser.
- **Test adversarial:** `tests/unit/sheets-rekapan-formatter.test.ts` (17) — batas bulan
  WIB (31 Okt 23:59 tetap `okt`; 1 Nov 00:01 WIB saat UTC masih 31 Okt → `Nov`), ganti
  tahun 2027, nama tab kustom dari DB, tanggal null/rusak → throw (bukan tab salah),
  Repeat + diskon, ongkir fallback, data kosong 16 sel utuh.
- **Verifikasi:** `npx vitest run tests/unit/sheets-rekapan-formatter.test.ts` 17/17 hijau;
  `npm run typecheck` bersih.

#### 2026-10-05 - Added: Rekapan Google Sheets — Fase 0 (Pondasi DB, Scope & Migrasi)

- **Revisi fondasional** dari plan "Integrasi Google Sheets & Drive Otomatis": panggil
  API Google dari webhook chat diganti **antrean outbox** (webhook non-blocking), config
  nama file/12 tab bulan dari **DB per-tenant** (bukan hardcode TS), harga **write-once**
  agar koreksi manual admin di spreadsheet tidak tertimpa, dan update admin (bidan/bayar)
  memakai **baris yang sama** (anti duplikat).
- **Skema (`prisma/schema.prisma`):** model `TenantSheetsConfig` (file_base_name,
  master_spreadsheet_id, drive_folder_id, yearly_file_ids, month_tab_names[],
  template_sheet_name) + `SheetsSyncOutbox` (unique per `tenant_id+reservation_id`);
  kolom `Reservation.discount_amount`, `sheets_spreadsheet_id`, `sheets_tab_name`,
  `sheets_row_index`, `sheets_synced_at`, `sheets_sync_status`.
- **OAuth (`src/integrations/google-contacts/google-oauth.client.ts`):** tambah scope
  `spreadsheets`; scope `drive` ditunda demi least-privilege (ditambah menjelang ganti tahun).
- **Migrasi:** `prisma/migrations/20261005000000_add_sheets_sync_fondasional/migration.sql`
  (idempoten `IF NOT EXISTS`, seed config `default-tenant` dengan ID file user).
- **Verifikasi:** `prisma validate` hijau, `prisma generate` hijau, `npm run typecheck`
  hijau, `typing.test.ts` 12/12. Drift check DB live menunggu DB tersedia (catat di
  `docs/KNOWN_ISSUES.md` #228).
- **Belum dikerjakan (Fase 1–4):** resolver murni + row formatter, service Sheets,
  hook outbox + worker cron, UI Tab Sheets, dan test adversarial.

#### 2026-10-05 - Reservasi Aktif: Jendela Hari-H & Filter Bidan Bertugas

- **Akar masalah (3 lapis):** tab Reservasi Aktif menampilkan booking `confirmed`/
  `pending` dari zaman kapan pun (booking lampau berminggu-minggu tetap muncul);
  dropdown "Semua Label" berisi escalation reason (bukan label) sehingga di tab
  reservasi nyaris selalu kosong; `formatReservationItem` membuang `assigned_staff_id`/
  `assigned_staff` walau query sudah meng-`include` relasinya (kontrak berbohong).
- **Domain (`reservation-status.ts`):** `ACTIVE_TREATMENT_WINDOW_MS`,
  `activeTreatmentCutoff()`, `isTreatmentWithinActiveWindow()` (null/tanggal korup
  fail-open, lampau >2 jam gugur), `activeReservationWhere()` (builder query Prisma
  paritas), `en_route` disamakan dengan `confirmed` (via `CONFIRMED_FAMILY_STATUSES`),
  `isHoldActive` dipertahankan.
- **Backend (`conversation.service.ts`):** query `filter=reservation` pakai builder
  `activeReservationWhere()` + dukungan param `staffId` (`all|unassigned|{id}`,
  fail-closed); fallback in-memory memakai `isActiveReservation` + predikat staff.
- **Backend (`live-chat.service.ts`):** `hasUpcomingBooking`/`hasPendingBooking`/
  `hasActiveHold`/`activeConfirmedReservation`/`activePendingReservation` kini
  ter-gate jendela 2 jam; mapper meneruskan `assigned_staff_id` & `assigned_staff`.
- **Backend (`admin/livechat.subroute.ts`):** terima query `staffId` (khusus
  `filter=reservation`).
- **Frontend (`LiveChatMonitor.tsx`):** dropdown kontekstual — tab reservasi
  menampilkan filter bidan ("Semua Bidan"/"Belum Ada Bidan"/per-bidan THERAPIST
  aktif), tab lain tetap "Semua Label"; guard tanggal + staff di `filteredChats`;
  badge `👩‍⚕️ Bidan X` / `⚠️ Belum Ada Bidan`; param `staffId` diteruskan ke server.
- **Test (adversarial):** `conversation-filter.test.ts` (bentuk query + jendela +
  `staffId` pass-through), `livechat-payload-completeness.test.ts` (kontrak staff,
  confirmed lampau gugur, hari-H berjalan aktif, en_route lampau gugur, pending null
  aktif), `reservation-status-en-route.test.ts` (en_route lampau tak aktif).
- **Verifikasi:** `tsc` bersih; suite lulus; dashboard build hijau.

#### 2026-10-04 - Added: Balasan Statis Turn-0 Data-Driven (Revisi Plan — Fase 0–3)

- **Revisi fondasional** dari plan "Static Template Turn-0": pemakaian ulang
  guard/state yang ada, tanpa daftar frasa bisnis baru, tanpa `session.stage`.
- **Fase 1 (`lead-greeting-detector.ts`):** perluasan tata bahasa fungsional
  (bingkai tanya prosedural "bagaimana/gimana cara", kata aksi booking/order,
  partikel kata ganti "saya/aku", pemisah koma/titik, varian "hallo") + guard
  eksplisit `isSafeForStaticTurn0Reply` (re-use filter lokasi presisi &
  pertanyaan spesifik yang sudah ada). Filter bahaya jalan DULU.
- **Fase 2 (`greeting-template.service.ts`, BARU):** template sapaan dari
  `ClinicPolicy` topic `'greeting'` (tenant-aware), cache 5 menit + invalidasi
  via endpoint settings existing; fallback `TEMPLATES.greeting`. Interpolasi
  aman `{{greeting}}`/`{{nama}}` (default "Bunda"; DILARANG pushName mentah).
- **Fase 3 (`fast-response-gate.ts`):** filter bahaya → CTWA keyakinan tinggi
  (`effectiveScore ≥ 0.85` + anchor cocok, bukan bypass) ATAU sapaan generik →
  balasan statis; `nextState` tetap `deriveConversationState`.
- **Fase 4 DITAHAN** (butuh migrasi `reply_template` per kampanye) — Confirmation
  Gate terpisah. **Fase 5 DITUNDA** (swap kalimat merusak konten substantif).
- **Tests:** +4 suite (`turn0-safe-gate`, `greeting-template-service`,
  `v3-ctwa-greeting-fastgate`, `v3-sanitizer-cta-preservation`). Suite penuh
  **595 lolos / 0 gagal**; `npm run build` lolos.
- **Batasan jujur:** dicatat di `docs/KNOWN_ISSUES.md` #222 (cakupan % belum
  diukur, free-form phrasing sebagian masih ke LLM, Fase 4/5 tertunda).

#### 2026-10-04 - Fixed: Fondasi Keselamatan Bumil Lintas Kategori, Juri Paket Tunggal, Trimmer List-Safe, CTA Funnel & Anti Harga Ganda

- **Akar (read-only):** gerbang PREGNANT hanya `category==='MOMS'` (`get-catalog.tool.ts`)
  → bumil di kategori BOTH/kosong tetap bocor ke induksi pre-term; rekomendasi
  klinis dihitung sebelum gerbang; plumbing sesi bisa kehilangan `momStage` saat
  konteks turn sepi (`tool-pipeline.ts`); swap/agreed masih memilih nama terpanjang;
  pemotong karakter belum melindungi daftar bullet; CTA default buta audiens &
  bisa terpotong sebelum kirim; pricelist bisa dobel dengan teks harga.
- **Fase 1 (Keselamatan):** gerbang PREGNANT berlaku **lintas kategori**
  (`momStage==='PREGNANT'`), `momStage`/`gestationalWeeks` dari sesi selalu
  diteruskan. Tes: `tests/unit/v3-pregnant-both-category.test.ts`.
- **Fase 2 (Juri tunggal):** ekstrak `rankServiceByRelevance` (cart-manager) —
  dipakai jalur fuzzy DAN `resolveAffirmativeSwap` (bukan panjang nama). Jalur
  exact substring-overlap dipertahankan sengaja (anti "Induksi Massage" vs
  "Induksi Massage Fullbody") — dicatat di #221.
- **Fase 3 (Trimmer):** `findLastCompleteListItemEnd` + trigger `truncateToMaxChars`
  kini mencakup bullet (-/•/*), bukan hanya nomor titik.
- **Fase 4 (Anti harga ganda):** `pricelist-gate` skip POST_DELIVERY bila balasan
  sudah memuat total (`replyHasTotals`); permintaan eksplisit tetap dilayani.
- **Fase 5 (CTA funnel + audiens):** `buildScheduleCta` menerima `committed` &
  `audience` — belum committed → tanya minat (bukan todong jadwal); layanan ibu
  tidak ditutup "si kecil". Satu `buildCtaForSession()` dipakai di semua CTA guardrail.
- **Tests:** +3 suite. Suite penuh **588 lolos** (3 file gagal = timeout flaky
  pra-eksisting: reservation-silent-failure-audit / reservation-security-and-integrity /
  staff-auth-and-reservation). `npm run build` lolos.
- **Catatan:** jalur exact-match substring/longest & `detectAgreedTreatment`
  longest-name dipertahankan sengaja → `docs/KNOWN_ISSUES.md` #221.

#### 2026-10-04 - Added: Seed FAQ Aman (--dry-run/--only), Guardrail Radar + Koreksi #220

- **Koreksi misdiagnosis (#220):** `dist/cli/seed-faq.js` SEBENARNYA ADA di dalam
  container (ls pertama keliru jalan di HOST tanpa `dist/`). Seed memang bisa
  dijalankan via `node dist/cli/seed-faq.js`.
- **`src/cli/seed-faq.ts`:** opsi `--dry-run` (tanpa tulis DB) + `--only=<substr>`
  (update terarah 1 chunk tanpa menyentuh kurasi lain). Script npm baru:
  `seed:faq:prod`, `seed:faq:dry`. Caveat title-overwrite didokumentasikan.
- **`src/cli/guardrail-radar.ts` (baru):** merangkum event perbaikan-paksa
  guardrail (`*AMNESIA*`, `*REPROMPT*`, `*RECOVERY*`, `REPLY_CONTRACT_*`,
  `HOLISTIC_REVIEW_*`, `*SOLICITATION*`, `*_UNRESOLVED`) dari log JSON agar
  anomali terlihat lebih dulu. Script `radar:guardrail` / `radar:guardrail:dev`.
- **Tests:** +`guardrail-radar.test.ts`. Suite penuh **589 lolos / 0 gagal**;
  `npm run build` lolos.
- **Deploy:** app-only rebuild (WAHA tidak disentuh). Verifikasi seed `--dry-run`.

#### 2026-10-04 - Added: Lapis Kontrak Jawaban, Pemisahan Retrieval Induksi, Tes Parafrase, Reviewer AI Risiko & Eval Skrip (Fase 0–6)

- **Latar:** pasca audit, ditambahkan lapisan penjaga agar jawaban "nyambung"
  dengan kebutuhan customer TANPA daftar kata baru (anti-kaku) dan tanpa
  memblokir pengiriman.
- **Fase 1 — Lapis 1 kontrak jawaban (`guardrail-pipeline.ts`):** helper murni
  `replyMentionsRupiah`/`replyMentionsDay` (pakai seam `DAY_EVIDENCE_WORDS`
  existing) + `checkReplyContract(reply, ctx)` dengan `ctx` = bendera AI/status
  sesi (`priceAsked`, `priceDataAvailable`, `scheduleExpected`) — BUKAN pindai
  teks customer. Gagal → reprompt faktual existing (`REPLY_CONTRACT_PRICE_FIXED`)
  / tempel CTA state-aware (`REPLY_CONTRACT_SCHEDULE_CTA`); fail-soft.
- **Fase 2 — Pemisahan retrieval (`keyword-enrichment.service.ts`,
  `faq-corpus.ts`):** penanda aterm (induksi) tak lagi dicampur keluhan umum
  (lelah/ngilu/kaki bengkak); kata relaksasi dipindah ke rule ibu. Jawaban FAQ
  induksi tak lagi memetakan capek→Induksi Fullbody.
- **Fase 3 — Tes parafrase daftar lama (`tests/unit/legacy-wordlist-paraphrase.test.ts`):**
  mengunci perilaku `detectVisitTimeQuestion`, `hasBookingCommitSignal`,
  `isConsultativeUserText`, `isAvailabilityInquiryText`, `extractFastIntents`
  pada ragam nyata. Murni tes (kode lama tak diubah).
- **Fase 4 — Reviewer AI risiko (`guardrail-pipeline.ts`):** `isHighRiskTurn`
  (bumil+katalog / reservasi / eskalasi) + `shouldRunHolisticReview`
  (HANYA bila ada pelanggaran *unresolved*). Satu tulis-ulang terisolasi
  memakai teks pelanggaran; kosong → pakai asli.
- **Fase 5 — Eval skrip percakapan (`tests/eval/conversation-scripts.eval.test.ts`):**
  12 skenario deterministik (harga, ongkir, bumil, bundle, ambigu, addon,
  trimmer, CTA, kontrak) offline.
- **Tests:** +6 suite baru; suite penuh **588 lolos / 0 gagal**; `npm run build` lolos.
- **Catatan/batasan:** dicatat di `docs/KNOWN_ISSUES.md` #219 (reviewer AI
  terbatas, eval = lapis deterministik, kontrak harga bisa menambah 1 panggilan LLM).

#### 2026-10-04 - Fixed: Keselamatan Klinis Bumil, Presisi Cart, Trimmer Daftar, Anti-Amnesia Delivery & CTA Reprompt (Fase 1–5)

- **Akar masalah (audit read-only, terbukti `file:line`):** (1) `get-catalog.tool.ts:238` `void
  gestationalWeeks` + tak ada cabang `momStage==='PREGNANT'` → layanan induksi persalinan
  (perangsang kontraksi, label "Aterm 37+ Minggu") bisa muncul untuk bumil 20–30 minggu; (2)
  `cart-manager.ts:496` urut kandidat fuzzy by panjang nama → paket "+Mandi" menyingkirkan paket
  presisi; (3) `sanitizer.ts:655` bullet dianggap batas kalimat → daftar "nih:\n1. ..." terpotong;
  (4) template `persona.ts:353` menanyakan ulang "mau perawatan apa" setelah ongkir; (5) reprompt
  usia hanya menghapus larangan tanpa CTA → dead-end.
- **Fase 1 — Keselamatan Bumil (`get-catalog.tool.ts`, `tool-pipeline.ts`,
  `router-tool-routing.layer.ts`):** tambah `momStage`/`gestationalWeeks` ke `CatalogSessionContext`
  + teruskan dari `session.momProfile`; ambil efektif `input ?? sesi`. Gerbang deterministik PREGNANT:
  induksi dilarang <37 minggu, perineum <34 minggu, kecuali customer EKSPLISIT minta
  (`specificTreatmentName` semantic). Bumil umum → Pregnant Massage #1. Enum skema +BREASTFEEDING.
- **Fase 2 — Presisi Cart (`cart-manager.ts`):** ganti greedy panjang → `rankFuzzyByRelevance`
  (hit-count → rasio non-generik → penalti token ekstra → panjang tie-break). Reservasi slot add-on,
  dedup famili kecuali bundle-vs-komponen, simpan PRIMARY terbaik per-scope.
- **Fase 3 — Trimmer (`sanitizer.ts`):** bullet sesudah ":" bukan batas kalimat + perluas potong
  hingga akhir senarai (anti-amputasi daftar opsi), prosa biasa tetap 3 kalimat.
- **Fase 4 — Delivery anti-amnesia (`guardrail-pipeline.ts`):** bila `calculate_delivery` sukses +
  sesi punya konteks layanan, kalimat "mau perawatan apa" DITUKAR deterministik dengan CTA
  state-aware (`buildScheduleCta`).
- **Fase 5 — Kontinuitas reprompt (`guardrail-pipeline.ts`):** `ensureRepromptClosingCta` menempel
  CTA penutup bila balasan pasca-reprompt (usia/jam/shareloc) buntu tanpa pertanyaan.
- **Tests:** +5 suite (multi-frasa adversarial): `v3-pregnant-catalog-priority`,
  `v3-cart-fuzzy-ranking`, `v3-sanitizer-list-preservation`, `delivery-treatment-awareness`,
  `age-reprompt-cta`. Suite penuh **583 lolos / 0 gagal**; `npm run build` lolos.
- **Catatan:** ambang klinis (37/34) & ID katalog masih konstanta kode (tech debt SaaS) → dicatat
  di `docs/KNOWN_ISSUES.md` #218 (Confirmation Gate).

#### 2026-10-04 - Changed: Unifikasi Jalur OTW + Capture GPS Maksimal + Fallback Titik Berangkat (Fase 3–4)

- **Akar masalah (terbukti `file:line`):** ada DUA pengirim OTW — `handleStartNavigation`
  (`StaffToday.tsx:1599`) dan `handleSendOtw` (`:1439`, tanpa guard `otwSentAt`) — dipanggil dari
  kartu (`:3146`) & drawer (`:3340`). Saat POST masih in-flight / beda tombol, `otwSentAt` belum
  ter-set lokal → pesan OTW **terkirim dua kali** ke customer.
- **Changed — `StaffToday.tsx`:** SATU jalur kirim OTW via `handleUnifiedDepart` +
  `confirmOtwDepart`; `handleSendOtw`/`handleStartNavigation` dihapus. Alur: klik → rekam GPS
  (cache/balapan) → **modal konfirmasi** (draf DB-driven) → tombol modal membuka Google Maps
  SINKRON (anti pop-up block) lalu POST OTW. `sendingOtwId` mengunci semua tombol; guard
  `otwSentAt` dicek ulang tepat sebelum POST. Sudah OTW → hanya buka ulang peta (tanpa kirim).
- **Added — `components/staff/OtwConfirmModal.tsx`:** modal ringan menampilkan status titik awal
  (📍 terekam ±Xm / ⚠️ belum) + tombol "Coba rekam ulang" + pratinjau pesan. Presentational murni.
- **Added — fallback titik berangkat (`src/routes/staff/today.subroute.ts`):** bila GPS null,
  backend memakai rumah pasien yang baru diselesaikan Bidan ini (`status=completed`,
  `booking_date` sebelumnya) → trip CS tetap terisi + ETA. `staff-trip-tracking.service.ts`
  menambah field `originSource` (`gps`/`prev_patient`/`unknown`) pada `TripRecord` (in-memory,
  tanpa migrasi); diteruskan `reservations.subroute.ts:GET /dispatch/trip` + badge estimasi di
  `LiveChatDispatchWidget.tsx`.
- **Tests:** `staff-trip-tracking.test.ts` (+originSource), `depart-gps-cache.test.ts`,
  `dispatch-map-projection.test.ts`, `otw-depart-endpoint.test.ts`, `staff-trip-dispatch.test.ts`
  → 53/53 hijau. Build root + dashboard lolos.
- **Catatan:** batasan sisa (izin browser ditolak permanen, PWA beku di background, fallback klinik
  belum ada) dicatat di `docs/KNOWN_ISSUES.md` #217.

#### 2026-10-04 - Added: Silent Depart-Capture GPS — Titik Awal & ETA Bidan saat Klik Navigasi (Fase 1–2)

- **Akar masalah (terbukti `file:line`):** `handleStartNavigation` (`StaffToday.tsx:1564-1596`)
  membuka Google Maps DULUAN (sinkron), baru `getCurrentDeviceLocation(10000)` dengan
  `maximumAge: 0` (`geoUtils.ts:237`). Prompt izin lokasi tertinggal di tab background (Bidan
  sudah dilempar ke GMaps) → time-out 10 dtk → `departLat/Lng` null. Backend hanya mencatat
  trip bila koordinat ada (`today.subroute.ts:496`) → titik awal & ETA Bidan hilang di peta CS
  (SLA: Bidan OTW tanpa bisa diverifikasi posisinya).
- **Added — `packages/admin-dashboard/src/utils/geoUtils.ts`:** helper Silent Depart-Capture —
  cache GPS pasif (`startDepartGpsWarmup`/`stopDepartGpsWarmup`) + `getDepartPositionFast()`:
  pakai cache segar (≤60 dtk, 0 dtk) atau balapan one-shot ≤2 dtk; akurasi >100 m / izin ditolak
  / time-out → `null` (fail-open, tidak throw). Konstanta `DEPART_GPS_*`.
- **Changed — `StaffToday.tsx`:** urutan baru — kunci posisi keberangkatan (cache / balapan 2 dtk)
  → buka Google Maps (masih dalam jendela user-activation, anti pop-up block) → hitung ETA
  best-effort → kirim OTW menyertakan `accuracy`. Pre-warm hanya aktif saat ada tugas dalam
  jendela keberangkatan (`useMemo` + `useEffect`), dilepas saat tak ada/unmount (privasi).
  Perilaku "mode intip" (di luar jendela/sudah OTW) & seluruh teks toast tidak berubah.
- **Tests:** `tests/unit/depart-gps-cache.test.ts` (8 kasus adversarial: cache segar tanpa
  one-shot, fallback basi + timeout 2000, denied/timeout → null, akurasi buruk ditolak, warmup
  idempoten, tanpa geolocation). `vitest` 23/23 hijau (termasuk regresi `dispatch-map-projection`).
- **Catatan:** Fase 3 (peringatan jadwal berantai/cascade) belum dikerjakan. Batasan OS
  membekukan PWA saat pindah ke GMaps (tidak ada ping live selama berkendara) tetap berlaku.

#### 2026-10-04 - Fixed: Foto Chat Terapis — Kompresi Klien Instan, Hapus Batas 8 MB, Timeout 45s

- **Akar masalah (terbukti `file:line`):** composer chat terapis (`StaffToday.tsx`) dan admin
  (`LiveChatMonitor.tsx`) mengirim **Base64 foto mentah** (`fileToDataUrl` full-res) → payload
  ~8–11 MB; validasi kaku `file.size > 8 * 1024 * 1024` menolak foto kamera 50–108MP; POST
  memakai timeout default 15s (`api.ts:289`) → abort di 4G jalanan. Backend `bodyLimit 12 MB`
  nyaris tersentuh.
- **Fixed** `packages/admin-dashboard/src/utils/imageCompressor.ts`: helper terpusat baru
  `prepareChatImage()` — validasi → downscale Canvas JPEG 1280px/q0.75 (≈120–250KB) dalam satu
  langkah, dipakai bersama kedua composer (single source of truth, anti-case-by-case).
  "Attempt-first" untuk HEIC (Safari iOS native) dengan pesan arah jelas bila browser gagal decode.
- **Fixed** `StaffToday.tsx` & `LiveChatMonitor.tsx`: kompres saat pilih foto, buang batas 8 MB
  (guard aman 25 MB), hapus helper `fileToDataUrl`/`makeThumbnail` mati, lindungi `revokeObjectURL`
  hanya untuk blob URL, dan set `timeoutMs: 45000` pada balasan bergambar. Kamera-only
  (`capture="environment"`) dipertahankan.
- **Catatan:** HEIC dari galeri non-Safari masih bisa gagal decode (batas browser, bukan kode) —
  lihat `docs/KNOWN_ISSUES.md` #215.

#### 2026-10-04 - Fixed: Sinkronisasi Penugasan Terapis Lintas Lapisan (API → Form → Detail → List)

- **Akar masalah (multi-layer):**
  - **Kontrak API:** `PATCH /api/admin/reservation/:id` hanya membaca `assignedStaffId`
    (camelCase); `assigned_staff_id` (snake_case) dari endpoint tetangga `/assign-staff`
    diabaikan senyap. Fallback in-memory tidak menyertakan objek relasi `assigned_staff`.
  - **Form lifecycle:** efek hidrasi `CreateReservationModal` ter-run ulang saat katalog
    layanan live tiba → menimpa `setAssignedStaffId` yang sudah diedit admin (race).
    Tombol Force pada dialog konflik SELALU `POST` create → reservasi duplikat saat edit.
  - **Rantai props:** `ReservationDetailModal` mengoper `reservation` basi (bukan
    `displayReservation`) & `onSuccess={() => {}}` membuang payload update. Dropdown
    penugasan tak reaktif hingga refetch parent.
  - **Tampilan:** resolusi nama terapis single-layer (`assigned_staff.name`) di 7+ situs →
    "Belum ditugaskan" palsu saat join parsial; drift kontrak `assigned_staff_name` /
    `assignedStaffName`.
- **Changed — Backend (`src/routes/admin/reservations.subroute.ts`):**
  - Dual-casing generik pada PATCH full-edit (camel ∪ snake untuk `treatment_*`,
    `booking_date`, `payment_method`, `customer_*`, dst.); precedence camelCase bila keduanya dikirim.
  - Validasi FK staff tenant-scoped di PATCH full-edit (paritas `/assign-staff`) → 400
    bila `assigned_staff_id` tidak valid.
  - Paritas relasi memory: list & single GET melampirkan `assigned_staff` via peta staff
    tenant (tanpa hardcode nama).
  - `PATCH /api/admin/reservation-series/:id/session/:reservationId` dual-casing +
    pemetaan error `STAFF_COLLISION` → HTTP 409.
- **Changed — Series service (`src/services/reservation-series.service.ts`):**
  `updateSession` kini memeriksa bentrok staf (paritas jalur utama) sebelum update.
- **Changed — Frontend:**
  - `CreateReservationModal.tsx`: efek hidrasi dipecah — form utama sekali, remap harga
    katalog tanpa menimpa staff; `buildEditPayload` SSoT; `handleForceCreate` branch
    edit→PATCH `force:true` vs create→POST; `enrichResWithFormState` menyertakan
    `assigned_staff_id` + relasi staff dari `effectiveStaffList`.
  - `ReservationDetailModal.tsx`: oper `displayReservation` (terhidrasi), `onSuccess`
    menerapkan payload + `setActiveRes`; optimistic update pada `handleStaffChange`.
  - **Added** `packages/admin-dashboard/src/utils/resolveStaffName.ts` — resolver berlapis
    (relasi → FK lookup → flat name) dipakai di Reservations (tabel+kalender),
    LiveChatMonitor, CustomerDatabase (reservasi+series), CreateReservationModal,
    WeekScheduleGrid, DayScheduleGrid, QuickHoldModal, FinancialAnalytics.
- **Test:** `tests/unit/reservation-staff-assignment-sync.test.ts` (6 kasus adversarial:
  snake/camel/precedence, staff invalid → 400, unassign null, dual-casing `booking_date`) +
  `reservation-series.test.ts` kasus `updateSession` STAFF_COLLISION. Full suite: 577 passed.

#### 2026-10-04 - Fixed: Resolusi NEXT_TREATMENT (PENDING→QUEUED), Grace Auto-Cancel, Kuota 40/hari, & Filter Serius MQL

- **Akar masalah (multi-layer):** `createNextTreatmentFollowUps` (regresi commit `b708c2fc`)
  mengembalikan antrean repeat-order ke `status: 'PENDING'`, lalu worker `processDueFollowUps`
  membunuh PENDING begitu `scheduled_at < now` (menit ke-1 setelah 09:00 WIB) **tanpa**
  `cancel_reason`. Di live terbukti 333 NEXT_TREATMENT tertahan PENDING (masa depan) dan
  8 antrean (Bunda Gobii dkk) ter-cancel 09:01:36 WIB dengan alasan NULL.
- **Fixed** `src/services/follow-up.service.ts`:
  - Pembuatan `NEXT_TREATMENT` kembali `status: 'QUEUED'` (langsung masuk antrean kirim,
    konsisten dgn `NO_PURCHASE`) — gerbang approval admin per-baris dihapus sesuai keputusan pemilik.
  - Worker auto-cancel PENDING kini memakai **grace period akhir-hari WIB**
    (`scheduled_at < awal hari ini WIB`), bukan `< now`, dan menyematkan
    `cancel_reason: CANCEL_REASON.EXPIRED_PENDING` (anti-regresi "mati menit ke-1" & alasan NULL).
  - **Serious-Only Gate** (state-based): `NO_PURCHASE` stage 3 (pengingat hari ke-14) HANYA
    dikirim ke kontak `is_mql || is_legacy_source`; sisanya `SKIPPED` dgn alasan kanonis
    `NON_SERIOUS_STAGE3`. Jalur admin `sendNow` sengaja tidak digerbangi (override manual).
  - Kuota default harian `FOLLOWUP_MAX_PER_DAY` 25 → **40** (penyebaran jadwal & slot WINBACK).
- **Added** konstanta `CANCEL_REASON.EXPIRED_PENDING` & `CANCEL_REASON.NON_SERIOUS_STAGE3`.
- **Database (live):** enum `FollowUpType` ditambah nilai `WINBACK_60D` (fix error `22P02`).
- **Data healing (live):** promosi 333 NEXT_TREATMENT PENDING→QUEUED (tenant-scoped) dan
  restore 8 antrean ter-cancel hari ini, lalu dirapikan ke slot jam kerja via
  `POST /api/admin/follow-ups/reschedule-overdue` (`maxPerDay=40`).
- **Catatan (tech debt):** `FOLLOWUP_MAX_PER_DAY` = **sebaran jadwal**, BUKAN cap kirim keras.
  Belum ada penghitung (counter) harian di jalur `processDueFollowUps`; masih setting global
  `.env` (belum per-tenant). Dicatat di `docs/KNOWN_ISSUES.md` #214.
- **Test:** `tests/unit/follow-up-engine.test.ts` (27 kasus adversarial: NEXT_TREATMENT QUEUED,
  grace akhir-hari + alasan kanonis, serious-only gate non-MQL skip vs MQL kirim, stempel baru).

#### 2026-10-04 - Fixed: Radar OTW Live Chat & Tab "Treatment Hari Ini" Hilang saat Reservasi `en_route`

- **Akar masalah (multi-layer):** Tombol OTW Bidan memindahkan status reservasi DB
  `confirmed` → `en_route` (`src/routes/staff/today.subroute.ts`), namun:
  - `src/services/live-chat.service.ts` (`serialize`) masih membandingkan literal
    `status === 'confirmed'` untuk `hasUpcomingBooking` & `activeConfirmedReservation`.
    Reservasi `en_route` langsung tersingkir → payload LS `activeConfirmedReservation`
    `null` → `dispatchReservationId` di `LiveChatMonitor` ikut `null` → widget Radar
    OTW & peta perjalanan CS hilang total (bukan mode Standby).
  - `packages/admin-dashboard/src/pages/tenant/TodayTreatments.tsx` mengecek literal
    `status === 'otw'` (tab, count, badge kartu) padahal backend hanya memancarkan
    `en_route` → tab OTW selalu `(0)`, badge & tombol aksi tidak sinkron.
- **Perbaikan fondasional (kontrak domain, bukan tambalan literal):**
  - **Changed** `src/services/live-chat.service.ts` — `hasUpcomingBooking` &
    `activeConfirmed` kini memakai `CONFIRMED_FAMILY_STATUSES` (`['confirmed','en_route']`)
    dari SSoT `src/domain/reservation-status.ts`. `formatReservationItem` tetap
    mempertahankan `status` asli + `otw_sent_at` + `arrived_at`.
  - **Added** `packages/admin-dashboard/src/utils/reservationStatus.ts` — helper
    terpusat (`isEnRouteStatus`, `isConfirmedFamilyStatus`, `normalizeReservationStatus`)
    guna mencegah drift literal `otw` vs `en_route` di UI.
  - **Changed** `TodayTreatments.tsx` — filter tab OTW, `otwCount`, dan deteksi kartu
    `isOtw` memakai `isEnRouteStatus()` (null-safe, case-insensitive, termasuk alias
    `on_the_way`/`otw`).
  - **Changed** `packages/admin-dashboard/src/components/maps/FleetMapModal.tsx` —
    `bucketOf` memetakan alias `otw` ke bucket `en_route` (defensif).
- **Catatan:** Edit klaim rencana awal pada `LiveChatMonitor.tsx` (`:3227`) sudah benar
  di kode (sudah mendukung `en_route`) sehingga tidak diubah — root cause riil murni di
  backend `serialize`. `dispatchReservationId` sudah berbasis `otw_sent_at` sehingga
  pulih otomatis begitu payload chat kembali terisi; kasus OTW tanpa GPS (lat/lng null)
  ditangani widget sebagai "OTW tanpa telemetri", bukan hilang.
- **Test:** `tests/unit/live-chat-enroute-status.test.ts` (17 kasus adversarial:
  en_route aktif, OTW tanpa GPS, completed/cancelled/rejected negatif, pending vs
  hold aktif/kedaluwarsa, data reservasi kosong/null, case-sensitivity, helper UI).

#### 2026-10-04 - CTWA Greeting Catchers: Atribusi Multi-Template + Typing Similarity (Fuzzy Priority 3)

- **Akar masalah:** iklan Click-to-WhatsApp (CTWA) yang masuk ke WAHA dapat kehilangan
  metadata referral (`ctwa_clid`) di jalan; teks tombol iklan yang diubah (typo/slang
  WhatsApp) juga tidak terasosiasi ke kampanye → traffic tercatat organik
  (rujuk `KNOWN_ISSUES` #159 & #170).
- **Added — Data layer:** model `CtwaCampaignCatcher` (`prisma/schema.prisma`) +
  migrasi aman non-blocking `prisma/migrations/20261004000000_add_ctwa_campaign_catchers/`
  (tabel `ctwa_campaign_catchers`, tenant-scoped, `IF NOT EXISTS`). Data kampanye,
  multi-template sapaan, kata kunci jangkar, dan ambang sensitivitas 100% dari DB per-tenant
  (tanpa hardcode).
- **Added — Logic layer:** `src/services/ctwa-text-catcher.service.ts` — engine
  pencocokan berbasis DB: normalisasi generik, kemiripan gabungan (0.6×bigram-Dice +
  0.4×token-Jaccard), guard kata kunci jangkar (berbasis frasa/token, bukan substring),
  kredit anchor, cache per-tenant 5 menit + invalidasi, fallback in-memory saat DB offline.
  **Tanpa kamus slang hardcode** (anti-hafalan); toleransi typo/slang dari algoritma.
- **Added — Util:** `src/utils/similarity.ts` diperluas `normalizeForMatch`, `tokenJaccard`,
  `combinedSimilarity` (reuse, bukan modul duplikat).
- **Changed — Ingestion (`src/services/ad-attribution.service.ts`):** **Priority 3**
  CTWA Greeting Catcher setelah P1 native `ctwa_clid` & P2 `Promo[xx]`. Guard berbasis
  **STATE** (customer baru / belum ber-atribusi / idle >24 jam via `lastCustomerMessageAt`),
  bukan pencocokan teks. Menulis `AdClick` `utmMedium='ctwa_fuzzy'`, `utmCampaign=<kampanye>`.
  Teks asli TIDAK dimutilasi. CAPI Contact memakai guard debounce 10s/cooldown 24h existing
  + `customData.fuzzyScore/fuzzyCampaign`.
- **Changed — Caller wiring:** `src/routes/webhook.route.ts` & `src/routes/waba-webhook.route.ts`
  meneruskan `lastCustomerMessageAt` dari state conversation (WABA: conversation dibuat
  lebih awal agar state idle valid).
- **Changed — Analytics (`meta-performance-analytics.service.ts`):** kanal ketiga
  **`CTWA_FUZZY`** (sebelumnya fuzzy jatuh keliru ke `PROMO_CTA`).
- **Added — Admin API (`src/routes/admin/ctwa-catchers.subroute.ts`):** CRUD tenant-scoped
  + dry-run `POST /test` (read-only). Didaftarkan di `admin.route.ts`; CUD meng-invalidate cache.
- **Added — Dashboard:** fungsi API di `packages/admin-dashboard/src/services/api.ts` +
  tab ke-3 **`CtwaCatchersTab.tsx`** (nama, platform, chips template/anchor, slider 50–95%,
  simulator interaktif) di `MetaClickCatcher.tsx`. Tanpa page/rute baru (anti-bloat).
  Konfirmasi hapus via `useUiFeedback` (bukan `window.confirm`).
- **Test:** `similarity-ctwa-ext` (13), `ctwa-text-catcher` (17), `ad-attribution-ctwa-catch` (7),
  `admin-ctwa-catchers` (10). Regresi terdampak (105 test: ad-attribution*, webhook*, meta-*)
  hijau. `npm run build` (tsc) bersih, `prisma validate` valid, dashboard build hijau.
  Full suite: 4737 hijau; 11 kegagalan adalah flake kontensi paralel (timeout) yang
  seluruhnya lolos saat dijalankan terisolasi (5 file, 139 test) — bukan regresi.

#### 2026-10-03 - Pricelist Landing Page Dinamis (Data-Driven, Tenant-Aware & Server-Side Hydration)

- **Akar masalah:** `src/landing/public/pricelist.html` menyimpan nomor WhatsApp
  (`const PHONE`) dan seluruh katalog/tarif (`const SECTIONS`, 39 layanan) sebagai
  hardcode statis. Admin yang mengubah tarif/layanan via `POST/PUT /api/admin/services`
  tidak tersinkron ke landing page; nomor WA & brand terkunci 1 klinik.
- **Solusi fondasional (Single Source of Truth):**
  - **Added** `src/services/pricelist.service.ts` — transformer data-driven:
    `getPricelistPayload(tenantId)` menarik katalog aktif dari
    `treatmentCatalogService.getAllServices(true, tenantId)`, brand dari
    `getBrandIdentityAsync`, dan nomor WA dari `Tenant.whatsapp_number`
    (fallback LandingPage → env). Mengelompokkan per kategori (BABY/KIDS/MOMS/
    BUNDLE/ADD_ON/BOTH), **merge varian usia** (nama identik + prefix-age-suffix
    dengan guard label-unik, mis. Pijat Ceria 0–6 & 7–24 bulan), dan membersihkan
    prefix nama secara **generik** (turunan `brand.businessName` + kata kategori,
    bukan daftar string hafalan). Tanpa data bisnis/nama/tarif hardcoded.
  - **Changed** `src/routes/landing.route.ts` — `GET /pricelist` kini *server-side
    hydration*: template dibaca sekali (cache), payload katalog terbaru disuntik ke
    `<head>` sebagai `<script id="pricelist-data" type="application/json">` (escape
    `\u003c` cegah breakout XSS `</script>`), + judul brand dinamis. Ditambah
    endpoint publik **`GET /api/pricelist`** (`?slug=`, rate limit 60/menit/IP)
    mengembalikan `{ success, data }` tenant-aware.
  - **Changed** `src/landing/public/pricelist.html` — hapus `PHONE`/`SECTIONS`
    hardcode; baca payload terinjeksi, update wordmark/tagline/footer/bot name
    dinamis, dan *fallback* graceful `fetch('/api/pricelist')` bila dibuka statis.
    Fitur Opsi C (slide-up drawer, format harga, template WA kontekstual) tetap utuh.
- **Keamanan & Ketahanan:** nomor WA tidak lagi terkunci ke `6281390541340`;
  multi-tenant terisolasi (tenant tanpa seed → katalog kosong, tanpa bocor default);
  DB offline tetap menyajikan katalog in-memory tanpa 500.
- **Test:** `tests/integration/pricelist-dynamic.test.ts` (12 kasus: transformer unit,
  hidrasi HTML, API JSON, isolasi multi-tenant, adversarial XSS `</script>`, live
  mutability harga, regresi `/go` + redirect + `/health`). Regresi landing suite
  (37 test) & full suite (`4685 passed`) hijau; `npm run build` (tsc) bersih dan
  `dist/landing/public/pricelist.html` ter-update.

#### 2026-10-03 - Landing Page Pricelist Homecare: Implementasi Opsi C (Contextual Slide-Up Drawer)

- **UX & Flow Chatbot (Opsi C):** Mengimplementasikan alur interaktif berbasis konteks in-chat
  pada halaman pricelist `src/landing/public/pricelist.html` dan `pricelist-baru.html`:
  - Default state: Bottom bar tersembunyi 100%, memberikan area pandang leluasa tanpa elemen mengambang
    yang menutupi katalog saat scrolling di layar mobile.
  - Interactive selection: Mengetuk baris layanan mengaktifkan highlight visual lembut dan memicu
    animasi slide-up drawer kontekstual (`#ctaDrawer.active`).
  - Drawer detail: Menampilkan kategori, target sasaran/usia, nama layanan, tarif promo (dengan harga coret),
    durasi menit, tombol batal (`✕`), serta tombol CTA WhatsApp *"Lanjut Chat"*.
  - Template pesan WA kontekstual: Otomatis menyusun pesan reservasi spesifik:
    `Halo Bidan Yusi, saya mau ambil treatment *[Nama Layanan]* ([Sasaran], [Durasi] menit, [TarifPromo]) yaa. Boleh dibantu info jadwal kosong terdekat untuk homecare ke rumah? Terima kasih 🙏😊`
    yang langsung menyambung percakapan bot pasca-pengecekan ongkir.
  - Kartu konsultasi inline: Menambahkan kartu konsultasi ramah di atas footer bagi pelanggan yang membutuhkan
    rekomendasi tanpa memilih baris tertentu.
- **Routing & Servis:** Mendaftarkan endpoint publik `GET /pricelist` di `src/routes/landing.route.ts` beserta
  redirect alias `/pricelist.html` & `/pricelist-baru.html` dan menambahkan `pricelist` ke `RESERVED_SLUGS`.
- **Verifikasi & Test:** Menambahkan test case #11 di `tests/integration/landing-serving.test.ts` (11 test passing),
  `npx tsc --noEmit` bersih tanpa error.

#### 2026-10-03 - WINBACK_60D: re-engagement pelanggan dormant MQL/legacy (>60 hari)


- **Fitur baru:** antrean `WINBACK_60D` untuk menyapa kembali pelanggan MQL/legacy yang
  sudah >60 hari tidak berinteraksi, dengan 3 varian template rolling, auto-lost grace 7
  hari, dan pacing menyisip ke kuota harian global (tanpa kuota khusus).
- **Skema (migrasi aman):** `FollowUpType += WINBACK_60D` (append-only, non-blocking) —
  `prisma/schema.prisma:355-361` + `prisma/migrations/20261003000000_add_winback_60d_type/migration.sql`
  (satu statement `ALTER TYPE ... ADD VALUE IF NOT EXISTS`).
- **Template engine (`src/config/followup-templates.ts`):** tipe `WINBACK_60D` + 3 varian
  ringkas (2–3 kalimat, kata ganti "Bidan kami", maks 2× "Bunda", frasa "sudah lama" tanpa
  angka durasi). Sapaan `{name}`/`{babyName}` disanitasi lewat engine existing.
- **Eksekutor (`src/services/follow-up.service.ts`):** cabang `WINBACK_60D` di
  `executeFollowUp` (cegah fallback ke `NO_PURCHASE_1`); prioritas `WINBACK_60D = 3`
  (setelah NEXT_TREATMENT & NO_PURCHASE).
- **Generator antrean (`enqueueDormantWinbackFollowUps`, dipanggil dari
  `cron.service.ts` `runMorningJobs`):** kandidat AND = status `active`, bukan
  sandbox/internal/admin-held/bypass/dummy (seam `buildNonBypassCustomerWhere` +
  `isDummyOrTestContact`), `is_mql OR is_legacy_source`, dormant `last_message_at <= now-60h`,
  **antrean kosong** (tidak ada FollowUp PENDING/QUEUED tipe apa pun — guard anti-tumpang-tindih
  dengan rangkaian NEXT_TREATMENT), tanpa reservasi depan (`booking_date >= now` non-cancelled),
  dan belum ada WINBACK_60D non-cancelled dalam 60 hari. Status awal `QUEUED`, stage 1,
  jadwal 09:30–16:00 WIB disisipkan ke `FOLLOWUP_MAX_PER_DAY`.
- **Auto-lost 7 hari:** `checkAndSetLostCustomers` diperluas — WINBACK_60D SENT >7 hari tanpa
  respons inbound (`last_customer_message_at`) maupun reservasi baru → `customer.status='lost'`.
  Jalur NEXT_TREATMENT (grace 3 hari) tidak diubah.
- **Env baru (`.env.example`):** `WINBACK_DORMANT_DAYS=60`, `WINBACK_ENQUEUE_LIMIT=10`,
  `WINBACK_LOST_GRACE_DAYS=7`.
- **Dashboard (`packages/admin-dashboard`):** tab kategori "Re-engagement" + entri `TYPE_CONFIG`,
  badge amber, filter tipe, dan stage terkunci 1 di modal edit. Tanpa page/rute baru.
- **Test:** `tests/unit/winback-60d.test.ts` (9 kasus: 3 varian + fallback nama, bentuk query
  kandidat, filter dummy, dan auto-lost inbound/reservasi). Regresi suite follow-up: 76 test hijau.
  Verifikasi: `tsc` bersih, dashboard build hijau.
- **Catatan:** WABA sengaja tidak disertakan (tenant tidak memakai provider WABA).

#### 2026-10-03 - Fix duplikasi Meta CAPI Queue & status 'Repeat Order' palsu untuk pasien baru

- **Akar (multi-layer):**
  1. `followUpService.onReservationCreated` memutasi `Reservation.is_repeat_order = true`
     setiap kali pasien baru (yang punya follow-up `NO_PURCHASE` aktif) melakukan booking
     pertama → transaksi #1 salah ditandai repeat di DB.
  2. `GET /api/admin/capi-queue` memprioritaskan flag DB korup di atas ordinal transaksi.
  3. `sentMap` moderasi Lead mengiterasi log `created_at DESC` tanpa cek `has()` → log
     TERBARU tertimpa log TERTUA, sehingga aksi reject/outlier hilang dari tampilan.
  4. Lead tidak dide-duplikasi terhadap Purchase → customer closing tampil 2x (Lead + Purchase).
- **Fixed:**
  - `src/services/follow-up.service.ts`: hapus mutasi `is_repeat_order`; method HANYA
    membatalkan follow-up aktif (`CANCELLED` / `RESERVATION_CREATED`).
  - `src/routes/admin/reservations.subroute.ts`: otoritas `isRepeatOrder = orderNumber > 1`;
    ordinal diselaraskan ke kanonis `confirmed/en_route/completed`; `sentMap` newest-wins;
    query Lead (unsent & riwayat) mengecualikan customer yang sudah punya reservasi aktif
    (`reservations: { none: {...} }`) — deduplikasi Lead vs Purchase berbasis state DB.
  - `packages/admin-dashboard/.../MetaCapiQueue.tsx`: filter Tipe Event (Semua / Purchase / Lead).
- **Data healing live (default-tenant):** normalisasi deterministik `is_repeat_order = (seq > 1)`
  atas riwayat `confirmed/en_route/completed`. `UPDATE 142` (64 first-order salah `true`
  + 78 repeat salah `false`), backup CSV 142 baris, verifikasi ulang: 0 sisa salah dua arah.
- **Test:** 2 file baru (`follow-up-lead-repeat`, `capi-queue-attribution`, 8 test) + koreksi
  2 test lama yang mengunci perilaku bug (`follow-up-schedule`, judul `follow-up-engine`).
  Verifikasi: `tsc` bersih, dashboard build hijau, suite penuh **4.672 hijau** (28 skip).
- **OPEN:** audit log `Bunda Lady` (`8cb25bf5-…`) tidak memuat `MQL_LEAD_EVENT_REJECTED`
  (hanya 3× `SENT`) → tidak bisa tampil `ignored_outlier`; menunggu keputusan reject manual
  (lihat `docs/KNOWN_ISSUES.md` #211). Deploy fix ke server belum dilakukan (working tree
  memuat fitur WINBACK_60D/landing yang belum di-commit).

#### 2026-10-03 - Copilot SOP: pencarian kalimat-alami + seed prosedural + rekonsiliasi MANUAL_BOOK

- **Akar:** `lookup_catalog_and_policy` memakai `contains` kalimat utuh → pertanyaan bahasa alami
  selalu 0 baris, padahal data SOP ada (45 chunk + 9 policy + 39 layanan). Bukan data hilang,
  bukan salah Hermes — murni recall pencarian.
- **Fixed — tokenisasi generik (`copilot-tools.ts`):** `extractSearchTokens` (token huruf ≥4,
  unik, maks 8 — tanpa daftar kata hafalan) + `buildTextSearchOr` (frasa utuh + tiap token,
  per field) untuk ClinicService/ClinicPolicy/KnowledgeChunk.
- **Seed prosedural v1.1:** 5 KnowledgeChunk baru (status+transisi, same-day, manual/hold/bayar,
  assignment/GPS/reschedule/series, navigasi tabel/kalender). Idempoten berdasar judul.
- **MANUAL_BOOK 7-butir direkonsiliasi** ke v1.1 (status bayar DB, GCal mock, series+cancelled,
  pending qualified, demam 37.8°C, vaksin 48–72 jam, diagram legal, contoh fiktif) + banner
  pendamping non-seed; v1.1 + DB tetap kanonis (KNOWN_ISSUES #210).
- **Test:** 10 kasus baru (tokenisasi + 3 parafrase adversarial). Verifikasi: 4.655 test hijau
  (28 skip), `tsc` bersih.

#### 2026-10-03 - Manual Book Operasional Admin & Manajemen Reservasi (`docs/MANUAL_BOOK_ADMIN_RESERVASI.md`)

- **Dokumentasi resmi operasional & AI ingestion:** penyusunan manual book dwifungsi (admin CS & Hermes AI Copilot) untuk manajemen reservasi.
- **Cakupan SOP:** siklus 7 status reservasi (`pending`, `hold`, `confirmed`, `en_route`, `completed`, `cancelled`, `rejected`), guard buffer 20 menit antar-slot, buffer 5 menit notifikasi penugasan terapis, pre-visit brief Telegram H-30 menit, SOP same-day booking, verifikasi alamat/GPS watermark foto rumah, dan format chunk intent-action Hermes Copilot.
- **Koreksi status (Opsi A, KNOWN_ISSUES #210):** dokumen ini dinyatakan **SUPERSEDED** — mengandung 7 regresi faktual vs `SOP_ADMIN_RESERVASI.md` v1.1 (sumber kebenaran tunggal). Dilarang jadi acuan operasional/seed/prompt sebelum diperbaiki.

#### 2026-10-03 - AI Clinic Copilot 2.0 (single-tenant owner): gerbang tenant + tool penjelas + SSE (ADR-001)

- **Keputusan ADR-001:** fitur Copilot 2.0 KHUSUS tenant owner (`default-tenant`); tenant lain
  deprecated. Gerbang deterministik fail-closed di 3 lapis: route 403, guard service, UI
  sembunyikan. Query tool TETAP tenant-scoped (anti-IDOR) — single-tenant bukan alasan melepas filter.
- **Fase 1 — gerbang single-tenant:** `src/config/copilot-tenant.ts`
  (`parseCopilotAllowlist`/`isCopilotTenantAllowed`, wildcard `*` eksplisit, default owner-only),
  dipasang di `copilot.subroute.ts` (`/chat` + `/stream`) & `copilot.service.ts`; UI
  `AdminCopilotPanel` + tombol `Layout` via `user.copilotEnabled` (`/api/admin/auth/me`).
  Env baru `COPILOT_ALLOWED_TENANT_IDS`.
- **Fase 2 — Pilar 3 Explainability:** tool `explain_conversation_state` (+`buildConversationExplanation`)
  — status bot/CS diturunkan dari kolom RIIL `Conversation` (`is_human_handling`, `escalation_reason`,
  `current_state`, `session_data`) + 5 pesan terakhir; HP dimask (`maskPhoneNumber`), UUID dibuang,
  sandbox/dummy disaring. Plan awal menyebut kolom fiktif `metadata/medicalAlert/botInterruptedAt`
  → DIKOREKSI ke skema nyata (verifikasi `prisma/schema.prisma:172-212`).
- **Fase 2 — seed SOP owner:** `src/scripts/seed-copilot-sop-owner.ts` idempoten/non-destruktif
  (ClinicPolicy: `post_vaccine_rules` 48-72 jam, `fever_contraindication` 37.8°C,
  `reservation_status_rules`; KnowledgeChunk audit jadwal & stalled inquiry; `styleTone` di
  `Tenant.settings`). Angka bisnis dari DB, bukan hardcode TS. DP/reschedule SENGAJA tidak di-seed
  (belum ada angka resmi → dilarang mengarang; plan awal menulis 37.5°C, dikoreksi ke 37.8°C SOP v1.1).
- **Fase 3 — persona DB-driven:** gaya copilot disimpan di `Tenant.settings.copilot.styleTone`
  (bukan `SOUL.md` server — pelanggaran SaaS-readiness jika persona di file). Fallback Hermes→internal
  tetap teruji.
- **Fase 4 — streaming SSE:** `POST /api/admin/copilot/stream` (POST, BUKAN `GET ?q=` — anti-bocor
  PII di URL/access log). Event `tool_start`/`tool_result` dari pipeline nyata → `chunk` (jawaban
  SUDAH tervalidasi grounding) → `done`. UI konsumsi via fetch `ReadableStream`, fallback ke `/chat`.
- **Test:** `tests/unit/copilot-single-tenant-gate.test.ts`, `tests/unit/copilot-explainer.test.ts`,
  `tests/integration/copilot-tenant-gate.test.ts` (route inject). Registry tool diselaraskan 6→7.
  Verifikasi: 4.627 test hijau (28 skip), `tsc` bersih, dashboard build hijau.

#### 2026-10-03 - Fix Call 1 degenerasi intermiten: partial salvage + retry 1x + gate treatment (insiden "Waru")

- **Akar:** netra via SumoPod masih bisa gagap intermiten TANPA flag `thinking`
  (bukti `llm_1791021530410_783b04`: completion 2048 cap, `toolsCalled: []`,
  `locationText: "Waru"` lengkap tapi stream terpotong). `extractBalancedJson`
  butuh kurung seimbang → selalu gagal; tanpa retry → langsung fallback buntu.
- **Fixed — partial salvage (`dsml-tool-salvage.ts`):** `salvagePartialDsmlArgs`
  memungut pasangan `"key": value` utuh dari stream terpotong (dedup first-wins,
  batas 40 pasang/8 KB, tanpa rekonstruksi nilai hilang).
- **Fixed — gate treatment karangan (`tool-pipeline.ts`):** `isCandidateTreatmentVerbatim`
  membuang `candidateTreatmentName` yang tak disebut customer (cermin gate P1-3).
- **Fixed — retry Call 1 (`generation-stage.ts`):** `shouldRetryCall1` +
  `MAX_CALL1_RETRIES=1` → retry SEKALI dengan `tool_choice='auto'` hanya saat
  degenerasi (finish=length / completion ≥ cap−16 + nol tool + DSML); turn sehat
  tidak pernah retry. Log `CALL1_DEGENERATE_RETRIED`.
- **Test:** `call1-dsml-salvage` (8), `candidate-treatment-verbatim-gate` (5),
  `call1-retry-gate` (7). Verifikasi: typecheck bersih; suite penuh; sandbox live
  4 kasus (`Wonokusumo`, `Waru`, typo, konteks).

#### 2026-10-03 - Fix Call 1 netra: provider-aware thinking flag + salvage DSML + recovery state (insiden "Wonokusumo")

- **Akar (multi-layer):** `generation-stage.ts:567` mengirim `thinking: { type: 'disabled' }`
  UNCONDITIONAL ke Call 1. Flag dipasang 2026-09-22 untuk router GLM; setelah router
  dipindah ke `deepseek-v4-flash-0731:netra` (2026-10-02) flag tertinggal. Parameter asing
  pada DeepSeek via gateway memicu degenerasi grammar → model memuntahkan tag DSML mentah
  dan looping repetisi (`isDontKnow...`) hingga `max_tokens` habis → `tool_calls` gagal
  di-parse → `executedTools` kosong → guardrail jatuh ke kaleng buntu
  (`buildInvalidReplyFallback`) → customer "Wonokusumo" hanya dapat "Kami pastikan
  informasinya..." dan admin turun tangan manual.
- **Fixed — provider-aware capability gate (`src/config/ai-models.config.ts`):**
  `supportsThinkingParam(provider, modelName)` — HANYA keluarga GLM yang menerima
  `thinking`; DeepSeek/OpenAI-compatible/Qwen/MiniMax tidak; tak dikenal → fail-safe
  jangan kirim. Nilai model tetap dari `tenant_ai_config` (tenant-aware).
- **Fixed — `generation-stage.ts`:** flag `thinking` kini kondisional lewat resolver
  (Call 1 netra tidak dikirim). Call 2 tidak disentuh.
- **Fixed — deterministik DSML salvage (`src/v3/agent/pipeline/dsml-tool-salvage.ts`,
  baru):** bila Call 1 tak mengembalikan `tool_calls` terstruktur tetapi `content`
  memuat sintaks DSML, pulihkan invoke+args (JSON balanced-aware atau blok
  `<parameter>`); JSON terpotong → dibuang, bukan ditebak. Keamanan anti-halusinasi
  tetap di gerbang verbatim `tool-pipeline`.
- **Fixed — state-aware recovery (`guardrail-pipeline.ts`):** draf kosong + lokasi
  presisi sudah ada di sesi → jawab konfirmasi jangkauan dari data sesi + CTA
  state-aware (`buildScheduleCta`), bukan kaleng buntu; tanpa lokasi → tetap fallback
  (tidak mengarang).
- **Fixed — label dashboard (`AiModelSettingsPanel.tsx`):** fallback frontend
  diselaraskan backend (router→netra, chat→glm); badge statis "Latensi Kilat/Thinking
  Nonaktif" diganti `describeModelBehavior()` dinamis per model.
- **Test:** `tests/unit/v3/call1-provider-payload.test.ts` (4) +
  `call1-dsml-salvage.test.ts` (5, adversarial) + 2 kasus recovery di
  `guardrail-pipeline.test.ts`. Verifikasi: typecheck bersih; suite 4553 lulus
  (3 flaky timeout reservation/staff hijau terisolasi); dashboard build hijau.

#### 2026-10-03 - SOP Admin Reservasi v1.1 (revisi audit kesesuaian kode)

- **Added — `docs/SOP_ADMIN_RESERVASI.md` v1.1:** revisi SOP v1.0 berdasarkan audit read-only kode/DB (7 selisih dikoreksi, bukan tambah larangan prompt).
- **Fixed — status & transisi:** `pending` dikualifikasi (aktif administratif, dikecualikan overcapacity); hold expiry ganda (2 jam `created_at` + tengah malam WIB → `cancelled`); matriks `canTransition`; guard `completed` = tolak bila >24 jam ke depan + celah staf/series dicatat.
- **Fixed — pembayaran & series:** `purchase_review_status` dikoreksi `pending/approved/ignored_outlier` (bukan `verified`); Lunas = `purchase_occurred_at`; CAPI antrean moderasi; series `cancelled` dilengkapi; GCal masih mock.
- **Fixed — klinis & Copilot:** imunisasi rujuk `ClinicPolicy post_vaccine_rules` (48-72 jam + 3 hari batas aman operasional); demam 37.8°C; kapasitas = `Staff.active`; Bab 7 jadi spesifikasi seed `KnowledgeChunk` per-tenant (tanpa hardcode angka ke prompt); batasan Hermes/latensi diungkap.
- **Verifikasi:** read-only, tanpa ubah runtime; konsisten KNOWN_ISSUES #190/#191/#198.

#### 2026-10-03 - Fix Alamat/Anak Hilang di LiveChat Edit (F-A..F-D)

- **Akar:** payload banner LiveChat (`formatReservationItem`) memangkas `preferences`,
  `raw_text`, `children`, `purchase_value`; batch query conversation tanpa `include
  children`; auto-populate mode edit + prioritas chat menimpa data DB; fetch penyelamat
  dilewati karena guard truthiness.
- **F-A (backend):** `formatReservationItem` + subset `preferences`/`raw_text`/proof/ongkir;
  batch conversation `include children`; `active-reservations` + `purchase_value/delivery/
  raw/children/assigned_staff`; dispatch trip + alamat/patokan/anak/phone; respons PATCH
  confirm/complete/status/set-date + include relasi; interface `LiveChatReservationItem`
  jujur; `getConversationDetail` hidrasi relasi.
- **F-B (frontend):** hidrasi edit berbasis KELENGKAPAN → fetch `GET /reservation/:id`;
  auto-populate tak jalan di edit; prioritas DB/profil di edit; kunci prefill treatment
  hanya saat katalog live.
- **F-C (realtime):** SSE `conversation.updated` untuk chat terpilih memicu refetch
  snapshot reservasi (banner/HOLD/OTW tak basi).
- **F-D (test):** `tests/unit/livechat-payload-completeness.test.ts` (4 kasus, adversarial).
- **Verifikasi:** typecheck bersih; suite 548 lulus (1 flaky gazetteer hijau terisolasi);
  dashboard build hijau.

#### 2026-10-03 - Fix Alamat Hilang (W1-W5): Seam Tunggal + Anti-Kehilangan Jejak

- **Akar masalah:** field "Alamat Lengkap" kosong saat edit/detail karena (a) edit
  modal tak punya fallback `raw_text` (hanya baca `preferences.address`), (b)
  quick-hold & admin-manual menulis `raw_text` TANPA alamat, (c) persist lifecycle
  silent-fail `.catch(()=>{})`.
- **W1:** quick-hold (`reservations.subroute.ts`) & admin-manual create kini
  sertakan alamat ke `rawText` + teruskan `address` ke `saveReservation`.
- **W2:** seam baca tunggal `resolveStreetAddress` (`src/utils/reservation-address.ts`
  + `packages/.../utils/reservationAddress.ts`) dipakai DetailModal & CreateModal.
- **W3:** edit modal hidrasi alamat/patokan eksplisit (initialAddress → preferences →
  legacy → `raw_text`); DetailModal teruskan `initialAddress/initialLandmark`.
- **W4:** lifecycle log jujur saat `updateCustomer`/`updateCustomerLocation` gagal.
- **W5:** backfill produksi dijalankan (UPDATE 0 — semua customer dengan alamat di
  raw sudah punya `preferences.address`; sisanya memang tanpa sumber, perlu input manual).
- **Test:** `tests/unit/reservation-address-seam.test.ts` (7 kasus; paritas backend↔frontend).

#### 2026-10-03 - Overhaul Holistik Reservasi (Fase 0-8, fondasional)

- **Seams kanonis baru (Fase 0):** `isReservationPaid` (Lunas = murni
  `purchase_occurred_at`), `canTransition` + `isHoldActiveByCreated` +
  `SLOT_BUFFER_MIN=20` (`domain/reservation-status.ts`), `buildWibIso`
  (`utils/dateWib.ts`), `effectiveOf/totalOf` (`utils/money-contract.ts`),
  `normalizePhoneID` (`utils/phone-normalizer.ts`).
- **Lunas vs Terjadwal sistemik (Fase 1):** badge grid `confirmed` → `Terjadwal`
  (+ `Terjadwal • Lunas` hanya bila `purchase_occurred_at`); toast/tooltip modal &
  dialog LiveChat tak lagi menyamakan Confirm=Lunas; `financial-analytics` &
  `staff-notification` pakai `purchase_occurred_at` (bukan status).
- **Composer WIB (Fase 2):** save `booking_date` modal/create/QuickHold pakai
  `buildWibIso` (bukan zona browser); grid Day/Week pakai WIB; date-picker
  Reservations pakai `getWibDateKey`; dialog konfirmasi pakai TZ Asia/Jakarta.
- **Hold & status machine (Fase 3):** guard `canTransition` + expiry ganda
  (`booking_date` + `created_at`) di `PATCH confirm/status`; release-hold kini
  transisi `cancelled` (audit utuh) + LTV/follow-up hook; modal edit tak lagi
  auto-flip hold→confirmed.
- **Handoff LiveChat→Modal (Fase 4):** `ExtractedScheduleData.babies[]` (multi-anak
  tidak lagi terpotong); quickBooking kirim semua bayi; kategori BUNDLE/BOTH tidak
  lagi jatuh ke BABY; pre-fill anak juga di mode edit.
- **Integritas anak/customer (Fase 5):** `classifyPatientEntity` BOTH/BUNDLE + nama
  valid → CHILD; lifecycle meneruskan `treatment_category`; normalizer HP tunggal
  08/8/62.
- **Harga/invoice (Fase 6):** `treatmentParser` prioritaskan promo katalog (bukan
  timpa `initialPurchaseValue`); hapus phantom `'Pijat Bayi Ceria (Rileksasi)'` +
  `Total = totalVal || treatmentPrice`.
- **Keuangan (Fase 7):** CAPI queue hanya `purchase_occurred_at`; value fallback 0
  (tanpa throw); `needs_staff_verification` dibersihkan saat confirm; Google
  Contacts error dilog jujur.
- **Sandbox + docs (Fase 8):** jalur manual `POST /reservation` menandai
  `6289999*` sebagai `is_sandbox_test`; entri KNOWN_ISSUES #198; test
  `tests/unit/reservation-overhaul-p0.test.ts` (9 kasus, multi-frasa).
- **Verifikasi:** `npm run typecheck` bersih; `npm test` 4515 lulus / 28 skip;
  `vite build` dashboard (2450+ modul) hijau.

#### 2026-10-02 - Fase 4: Stabilisasi Router NLU (glm-5.3-flash → netra) di Produksi

- **Konteks:** audit transkrip live Bunda Chyntia (Krian, 6287883887456) di server
  produksi `43.173.11.79`. Dua turn gagal: task `INTENT_CLASSIFICATION`
  (Call 1 Router) memakai `glm-5.3-flash` dengan `completion_tokens` TEPAT 1024
  (cap) dan latensi 28–33 dtk → output kosong → fallback canned
  "Kami pastikan informasinya...". Bukti: `llm_audit_logs`.
- **Fixed (data/config, tenant-aware) — server produksi via Admin API**
  `PATCH /api/admin/ai-models/INTENT_CLASSIFICATION`:
  `glm-5.3-flash` → `deepseek-v4-flash-0731:netra` (model router kanonik,
  non-reasoning), `max_tokens` 1024 → 2048. Audit trail admin tercatat;
  `tenant_ai_config` terverifikasi. Tidak ada perubahan kode (default kode
  memang sudah netra — DB sempat drift).
- **Validasi sandbox** ("Tambak kemerakkan krian"): balasan memuat ongkir
  promo *Rp 25.000* (normal *Rp 35.000*), TANPA canned fallback kosong.
- **Catatan:** SumoPod/netra sempat timeout transien → circuit-breaker 25 dtk
  fallback `deepseek-chat` (hasil tetap benar). Latensi SumoPod = isu infra
  terpisah. Detail: KNOWN_ISSUES #194e/#194f.

#### 2026-10-02 - Restorasi Navigasi "CTA & Greetings WA" + Scope API Advertiser

- **Konteks:** refaktor `49f6bdde` (14 Sep 2026) mengubah `/admin/customer-service`
  menjadi redirect ke `/admin/settings?tab=cs` dan menghapus menu sidebar-nya tanpa
  pengganti, sehingga handler `subTab==='cs'` menjadi *orphaned* (hanya bisa dibuka
  via URL manual) dan `lazy(CustomerService)` di `App.tsx` menjadi *dead import*.
  Audit read-only membantah klaim plan lama ("rute masih berfungsi normal"): rute itu
  kini `Navigate` polos. Detail: KNOWN_ISSUES #197.
- **Fixed (routing) — `packages/admin-dashboard/src/App.tsx`:** `/admin/customer-service`
  dikembalikan sebagai halaman protektif langsung (`ProtectedRoute > Layout >
  CustomerService`, menghidupkan kembali lazy import), alih-alih redirect-only yang
  membuat `advertiser` mustahil lolos guard (`ProtectedRoute` menilai `pathname` tanpa
  query). Alias `/admin/cs` → `/admin/customer-service`.
- **Fixed (navigasi) — `components/common/Layout.tsx`:** menu "CTA & Greetings WA"
  (ikon `Headphones`, reuse import eksisting) dikembalikan di grup "Marketing & Ads".
- **Fixed (RBAC) — `config/rolePermissions.ts`:** tambah `/admin/customer-service` ke
  allowlist `advertiser` TANPA membuka `/admin/settings` (cegah kebocoran QR WAHA /
  token CAPI / AI scope). Kategori `ALL_MODULES` sengaja tidak diubah (kategori editor
  role ≠ grup sidebar).
- **Added (UI) — `pages/tenant/Settings.tsx`:** kartu gateway kontekstual di blok
  `META_MARKETING` (Impeccable, `setSearchParams({ tab: 'cs' })`, reuse
  `MessageCircle`/`ArrowRight`, tanpa native alert).
- **Added (DB, belum di-apply) — migrasi
  `20261002000001_allow_customer_service_for_advertiser`:** seed `role_api_scopes`
  advertiser `GET,POST` untuk `/api/admin/customer-service` (tenant-aware, idempoten).
  Wajib: role advertiser sudah "managed" → default-deny 403 sebelum seed ini.
- **Verifikasi:** root `npm run build` (`tsc`) exit 0; dashboard `vite build` hijau
  (chunk `CustomerService` 10.65 kB ter-split dari lazy import baru; tanpa dependency
  baru). Uji navigasi manual & scope API live tertunda ke deploy (lihat #197c/#197d).

#### 2026-10-02 - Meta Ads Performance & Sales Dashboard (CAC/LTV) — Fase 0–4

- **Konteks:** Modul analitik performa iklan Meta to Sales, dipisah tegas dari
  observability CAPI. Rencana: `docs/plans/META_PERFORMANCE_SALES_DASHBOARD_REVISI_PLAN.md`
  (revisi fondasional atas 7 cacat plan awal hasil audit kode nyata).
- **Added (backend) — `src/services/meta-performance-analytics.service.ts` (baru):**
  kontrak kanonis CAC vs LTV (first-ever = `MIN(created_at)` reservasi qualifying,
  BUKAN flag `is_repeat_order`), seam omzet kanonis `purchase_value`→katalog fallback
  (`resolveTreatmentValue`) + snapshot ongkir (`resolveDeliveryFeeSnapshot`, anti-#179),
  atribusi kanal `CTWA_NATIVE` vs `PROMO_CTA` via `ctwa_clid`, journey/lead-time WIB +
  bracket, leakage diagnostics, `tenantId` wajib, `SANDBOX_EXCLUDE`
  (`is_sandbox_test`/`is_internal_staff`), batas `take 5000` + flag `truncated`,
  cache `responseCacheService` 30s, degrade-silent offline (ZERO report).
  `MetaPerformanceQuerySchema` (zod).
- **Added (API) — `GET /api/admin/meta-performance`** di
  `src/routes/admin/meta-attribution.subroute.ts` (di luar prefix `/debug` yang
  Super-Admin only, agar advertiser dapat membaca); validasi 400 + fallback 200 ZERO.
- **Added (RBAC seed) — migrasi `20261002000000_allow_meta_performance_for_advertiser`:**
  `role_api_scopes` advertiser → GET prefix ini (tenant-aware, idempoten).
  **Belum di-apply** (lihat KNOWN_ISSUES #180a).
- **Added (frontend) — Tab "Performa Iklan & Penjualan"** di
  `packages/admin-dashboard/src/pages/tenant/MetaClickCatcher.tsx` (panel lazy-load) +
  komponen `components/meta-performance/*` (SpendCalculator, KpiGrid, FunnelBars,
  ChannelTable, CampaignTable, JourneyHistogram lazy-recharts, LeakageGrid).
  Reuse `StatCard`-pola, `Pagination`, `useUiFeedback`, preset tanggal. Tanpa rute baru,
  tanpa dependency baru.
- **Added (test) — `tests/unit/meta-performance-analytics.test.ts`** (9, adversarial):
  split CAC/LTV (termasuk order pertama cancelled tak dihitung new), sandbox/staff
  exclusion, isolasi tenant, fallback harga katalog, ROAS/CAC, journey/lead-time,
  offline ZERO report.
- **Verifikasi:** root `tsc`/build exit 0; dashboard `vite build` hijau (chunk
  MetaClickCatcher 43.4→45.3 kB, panel lazy); unit baru 9/9; full suite 4502 passed
  (3 timeout flaky saat run paralel padat — lulus 61/61 saat dijalankan terpisah).
- **Sisa:** KNOWN_ISSUES #180 (migrasi RBAC belum di-apply, drift check lokal terblokir
  DB offline, batas truncation & indeks analytics, `pending/hold` di luar revenue).

#### 2026-10-02 - Fase 0-3: Ongkir Transparan saat Kelurahan Typo + Tutup Kebocoran `message`

- **Konteks (audit Turn-3, Bunda Chyntia Krian):** bot hanya menjawab "masuk
  area jangkauan" tanpa ongkir. Investigasi read-only membantah diagnosis plan
  awal: gate ongkir BUKAN akar masalah. Akar sebenarnya = query typo dobel-k
  "Tambak kemerakkan krian" melewati gate kecamatan-luas (23 ambiguitas Krian)
  lalu memicu permintaan kelurahan ulang. Desa "Tambak Kemerakan" SUDAH ada di
  gazetteer (`surabaya_sidoarjo_subdistricts.json:3253`). Detail: KNOWN_ISSUES #194.
- **Fixed (fondasional) — `src/integrations/google-maps/geocoding.ts`:**
  (1) `hasAnyKelurahanInText` kini typo-aware (bandingkan tiap span n-gram kata
  query tanpa spasi vs nama kelurahan, Levenshtein ≤1) sehingga gate
  kecamatan-luas tidak membajak kelurahan riil yang beda 1 huruf.
  (2) `isBetterMatch` memakai margin 0.15 agar spesifisitas menang saat skor
  berdekatan: kelurahan "Tambak Kemerakan" (0.97, 2 kata) tidak lagi kalah dari
  token dual-admin "Krian" (kelurahan+kecamatan, skor 1.0) → tidak lagi memicu
  ambiguitas kelurahan-luas.
- **Fixed (fondasional) — `src/v3/tools/calculate-delivery.tool.ts`:** `message`
  (dibaca LLM Call 2) tidak disanitasi `applyFeeInformationHiding` (hanya field
  numerik di-omit). Nominal ongkir & jarak km kini HANYA masuk `message` bila
  `showFeeNominal` (gate kode); mode konsultasi tersembunyi = kalimat jangkauan
  murni tanpa angka. `showFeeNominal` TIDAK dilonggarkan ke level kecamatan
  (kontrak 779408 & test precise-fee dipertahankan).
- **Fase 2 (verifikasi, tanpa perubahan kode):** guard `!isEstimatedCentroid`
  pada lifecycle `ongkirStatus` DIPERTAHANKAN (estimasi sentroid tidak boleh
  mengunci QUOTED). Kelurahan sudah dipersist murni dari `toolResult` geocoder
  (bukan substring mentah) — `tool-pipeline.ts:580-593`. Test baru:
  `v3/tool-pipeline.test.ts` typo dobel-k → `location.kelurahan='Tambak Kemerakan'`
  & `ongkirStatus='QUOTED'`.
- **Fase 3.1 (`core-persona.layer.ts`):** Aturan Emas #2 diberi klausul
  PENGECUALIAN SAH — menyampaikan jarak & ongkir promo resmi `calculate_delivery`
  saat lokasi terkonfirmasi bukan pelanggaran; menebak harga paket tanpa tool
  tetap dilarang. Lapis sekunder saja; otoritas tetap gerbang kode.
- **Tests (+15):** `geocoding.test.ts` 4 kasus typo/urutan/ejaan-benar/"Krian"
  polos tetap ambigu; `calculate-delivery-precise-fee.test.ts` typo→ongkir
  terbuka; `calculate-delivery-centroid.test.ts` mode tersembunyi bebas `Rp`/`km`;
  `v3/tool-pipeline.test.ts` persist+QUOTED.
- **Verifikasi:** 139/139 test calculate-delivery+geocoding hijau; batch prompt/
  tool-pipeline 114/114 hijau; `npm run build` (tsc) exit 0. 3 suite lain
  (ai-model-settings/reservation-silent-failure/capi) merah HANYA pada full-suite
  paralel, lulus terisolasi (flakiness pra-eksisting).

#### 2026-10-02 - Staf PWA: Akses Bukti Pembayaran & Invoice Pasca Kunjungan Selesai

- **Konteks:** Tombol catat bayar / unggah bukti / kirim tagihan WA hilang setelah
  terapis memencet "Selesai" pada kunjungan `forceUnpaid` (tagih di tempat). Audit
  read-only membuktikan `getCompletedTasks` memaksa `status==='completed'` menjadi
  LUNAS, sehingga aksi pembayaran lenyap dari Riwayat Selesai & Detail.
- **Fixed (backend) — `src/services/staff-reservation.service.ts`:** invariant
  `isLunas` di `getCompletedTasks` kini murni `Boolean(purchase_occurred_at)`
  (sebelumnya `|| status==='completed'`, inkonsisten dengan `getTodayTasks`/
  `getUpcomingSchedule`). Kontrak `StaffTaskPricing` diperluas `paymentMethod` +
  `proofUrl` (select `payment_method`/`proof_url` ditambah di 3 mapper).
- **Fixed (backend) — `recordPayment`:** bukti bayar lama TIDAK lagi tertimpa NULL
  saat merekam ulang tanpa foto baru (`proofUrl` diinisialisasi dari
  `reservation.proof_url`).
- **Added (PWA) — `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`:**
  tombol aksi pembayaran universal tanpa gate jendela chat: kartu Riwayat Selesai
  (`Catat Bayar` / `Kirim Tagihan` / `Bukti Bayar`), modal Detail Pasien, pill
  `Lunas` kini interaktif (pratinjau bukti / unggah ulang).
- **Fixed (PWA) — sinkron state:** `handleSubmitPayment` memperbarui `tasks` +
  `completedTasks` + `upcomingTasks` + `selectedTask` + `detailModalTask` serentak;
  cerminan `isLunas` di `handleSendPaymentInfo` tak lagi menganggap `completed` = lunas.
- **Test:** `staff-auth-and-reservation.test.ts` (+4: completed-unpaid→TAGIH,
  completed-paid→LUNAS+proof, COMPLETED kapital, preserve proof),
  `staff-send-payment-info.test.ts` (+1: invoice tetap terkirim pasca-completed).

#### 2026-10-02 - Navigasi Accuracy-Aware (re-apply) + Normalizer Link Copilot

- **Konteks:** fitur navigasi accuracy-aware (plan insiden Bidan tersasar) ternyata
  HILANG dari tree — hanya tes + modal untracked tersisa; `navigation-accuracy-preflight`
  merah 6/14. Kode di-apply ulang + ditambah normalizer link Copilot. Detail: KNOWN_ISSUES #192.
- **Backend — `buildMapsUrls`** (`staff-reservation.service.ts`): param
  `locationSource`+`fullAddress`; titik non-presisi (`manual_staff`/`estimated_area`) +
  alamat → `destination=<teks alamat>` via `URLSearchParams` (Google Maps memandu ke
  blok/klaster); NaN koordinat → `{null,null}`. 3 caller diperbarui.
- **Frontend — `geoUtils.ts`:** `needsNavigationPreflight(source)` baru +
  `getGoogleMapsDirectionUrl(...,locationSource)`. `StaffToday.tsx`: 4 tombol navigasi
  jadi CTA amber "Navigasi (Estimasi)" + `NavigationPreflightModal` untuk titik non-presisi
  (aksi: salin draf shareloc / tetap buka peta). `LiveChatDispatchWidget`: badge amber +
  tombol "Minta Shareloc" 1-klik (sisip ke composer, kirim manual).
- **Copilot — `repairCopilotChatLinks`** (`copilot.service.ts`): mengisi tautan
  `[Buka Chat]` kosong secara deterministik (1 conversationId unik / nama unik terdekat);
  ambigu → dibiarkan kosong. Menutup #191e-a.
- **Observabilitas** — event `COPILOT_PROMPT_SIZE`; temuan: overhead 16k token = framework
  Hermes (menu tool kita hanya ~2.5k char), bukan prompt repo (#191e-b, out-of-scope).
- **Tests:** navigasi 14/14; Copilot 128 hijau. `tsc` + dashboard build exit 0.

#### 2026-10-02 - Copilot: Indikator Progres + Anggaran Turn 120s (pasca-diagnosis Hermes)

- **Konteks:** investigasi live membuktikan integrasi Hermes SUDAH jalan
  (`engine:"hermes", hermesFallback:false`); keluhan "tidak pernah dipanggil" adalah
  red herring (grep log salah tempat). Akar sebenarnya = latensi turn (56,7 dtk) menembus
  anggaran 60 dtk → jawaban degradasi "batas waktu". Detail: KNOWN_ISSUES #191.
- **Changed — anggaran turn:** `DEFAULT_TOTAL_BUDGET_MS` 60.000 → **120.000**
  (`src/services/copilot/copilot.service.ts`); timeout POST frontend 70.000 → **125.000**
  (`packages/admin-dashboard/.../AdminCopilotPanel.tsx`); `.env.example` diselaraskan.
- **Added — indikator progres bergilir:** util murni `copilotStatus.ts`
  (`getCopilotStatus`/`formatElapsedSeconds`) memetakan elapsed → tahap
  (mencari→menganalisis→menyusun→merapikan→menunggu model) + ikon + detik; panel memakai
  `aria-live`. Mengganti teks statis "Menganalisis data..." agar proses panjang tidak
  terkesan error.
- **Tests:** `tests/unit/copilot-status.test.ts` (4, murni/offline). Copilot suite 86+ hijau;
  `tsc` app exit 0; dashboard build exit 0.

#### 2026-10-02 - Integritas AI Scope & Anti-Duplikasi Jadwal (fondasional)

- **Konteks:** pasien lama terjawab bot & jadwal dobel. Audit menemukan 4 akar:
  urutan gate vs auto-release salah, sewa 48 jam membuat pasien lama bocor ke
  bot, status `completed` prematur mematikan guard jadwal aktif, dan merge
  same-day berbasis string rapuh.
- **Changed — kunci permanen pasien lama** (`src/services/conversation.service.ts`):
  `EXISTING_PATIENT_MANUAL` / `LEGACY_CUSTOMER_MANUAL` / `LEGACY_AI_SCOPE_DISABLED`
  TIDAK PERNAH auto-release ke bot (keputusan permanen product owner). Sesi hanya
  dilepas manual oleh CS. (KNOWN_ISSUES #190.)
- **Changed — urutan pipeline** (`src/routes/webhook.route.ts`,
  `src/routes/waba-webhook.route.ts`): `checkAndApplyAutoRelease` dijalankan
  SEBELUM `enforceAiScopeGate` di kedua kanal; WABA sebelumnya tidak memanggilnya.
- **Changed — guard completed prematur** (`src/domain/reservation-status.ts`,
  `src/routes/admin/reservations.subroute.ts`): `PATCH .../complete`, `.../status`,
  `.../:id` menolak `completed` untuk jadwal > 24 jam ke depan dengan
  `400 PREMATURE_COMPLETION_BLOCKED`; `forceComplete:true` untuk darurat.
- **Changed — anti-duplikat slot** (`src/services/reservation-core.service.ts`):
  kanal BOT/AGENT/WEBHOOK pada hari kalender sama → UPDATE baris primer, bukan
  create kedua, walau redaksi treatment berbeda.
- **Test:** `tests/unit/repeat-customer-scope-and-collision.test.ts` (10) +
  regresi suite terkait. Build hijau.

#### 2026-10-02 - Slot Overlap A5 v2: Triase Fondasional + Dedup Persisten (fondasional)

- **Konteks:** audit fixing plan A5 (slot tumpang jadwal) menemukan 4 cacat
  arsitektural: partisi kaku `dayWib__staffId` (2 pesanan unassigned jam sama
  dilabeli "bentrok" palsu), blind spot duplikasi pasien lintas Bidan, spam alert
  tiap 3 menit (bypass throttle `DAILY_OPS_REPORT`), format pesan tanpa tanggal/nama.
  Revisi v2 menyentuh akar di Data/State/Dedup, bukan tambahan larangan prompt.
- **Changed — triase 4 kategori** (`src/services/slot-overlap.service.ts`):
  `STAFF_DOUBLE_BOOKED` (CRITICAL, 1 Bidan >1 pasien), `CUSTOMER_DOUBLE_BOOKED`
  (WARNING, 1 pasien >1 pesanan lintas Bidan — menutup blind spot),
  `UNASSIGNED_OVERCAPACITY` (CRITICAL, peak-concurrent sweep-line >
  `Staff.active=true`), `UNASSIGNED_PENDING_ACTION` (INFO, kuota cukup).
- **Changed — kuota dari DB** (`prisma.staff.count({ active: true })`, sumber
  tunggal, bukan angka hardcode); DB error → audit kapasitas dilewati (fail-safe).
- **Fixed — dedup alarm persisten** via `AdminNotificationLog.idempotency_key`
  (prefix `slot_overlap:v1:<fingerprint>:<severity>:`), cooldown 60m/240m/720m
  per CRITICAL/WARNING/INFO; Map memori hanya fallback offline. Menutup
  bypass throttle tanpa mengubah throttle global.
- **Fixed — `tenantId` keluaran** kini diisi tenant pemanggil (sebelumnya `''`).
- **Changed — pesan actionable:** tanggal WIB panjang (`Intl` id-ID), jam, kategori,
  daftar nama pasien dari DB, link `ADMIN_DASHBOARD_URL/...` (tanpa URL hardcode).
- **Changed — `pending`** dikecualikan dari audit kapasitas/Bidan (selaras #173e),
  tetap dihitung untuk duplikasi pasien.
- **Changed — interval cron** `SLOT_OVERLAP_SWEEP_INTERVAL_MINUTES` default 3→15.
- **Added — deep-link kalender:** `packages/admin-dashboard/.../Reservations.tsx`
  membaca `?date=YYYY-MM-DD` (`URLSearchParams` + validasi overflow) → buka mode
  `day` pada tanggal tumpang jadwal; Web Push `url` diselaraskan ke
  `/admin/reservations?date=<hari>`.
- **Tests:** `tests/unit/slot-overlap-sweep.test.ts` (19: triase, overcapacity,
  dedup, tenantId, format, deep-link URL). `tsc` + dashboard build exit 0; suite
  penuh 4416 pass (7 gagal pra-eksisting, lihat #182f).
- **Sisa (OPEN):** staf cuti belum dimodelkan; forensik log prod #183.

#### 2026-10-02 - Pricelist: Pemulihan Pengiriman Gambar Otomatis V3 (fondasional)

- **Konteks:** eksekutor gambar pricelist (STEP 1 `machine.ts`) terhapus pada housekeeping
  `b708c2fc`, dan sejak itu fitur mati (executor zombie tanpa setter). Diperbaiki dengan
  gerbang keputusan deterministik V3, bukan regex hafalan kalimat.
- **Added — intent semantik `ask_pricelist_image`:** `extractFastIntents`
  (`src/v3/agent/persona.ts`) mengenali permintaan FILE katalog/pricelist via token
  data-driven (`hasAnyWord`/`includes`), terpisah dari `ask_price` (nominal). Mendukung
  multi-frasa ("pricelist ga masuk kak", "katalog harganya ada?", "menu treatmentnya").
- **Added — modul gerbang murni `evaluatePricelistTrigger`**
  (`src/v3/agent/pipeline/pricelist-gate.ts`): zero LLM, zero regex. Trigger A post-delivery
  (`calculate_delivery.success && !isOutOfCoverage` + kuota `pricelist_sent=false`), Trigger B
  permintaan eksplisit (force-resend).
- **Restored — `resolvePricelistImageTarget`** (`pricelist-config.service.ts`): resolusi
  provider-aware (WAHA path lokal / WABA URL publik via `mediaService`), deteksi URL dengan
  `URL` API standar.
- **Wiring:** `AgentRunnerOutput.sendPricelistImage`/`forcePricelistResend` dihitung dari
  `preExtractedIntents` + `executedTools` + status customer; eksekusi fisik di `machine.ts`
  meniru `live-chat.service` (cut-off, sandbox guard, retry 2x, alert, log DB), dengan
  rate-limit force-resend 10 menit + brand tenant-aware `getBrandIdentityAsync`.
- **Tests:** `tests/unit/pricelist-trigger.test.ts` (11, adversarial multi-frasa +
  out-of-coverage + resolver WAHA/WABA). `tsc` exit 0; `state-machine.test.ts` hijau.

#### 2026-10-02 - Copilot Admin: Adapter Mode :8642 OpenAI-Compatible (Nonaktif Default)

- **Konteks:** temuan API `:8642` (KNOWN_ISSUES #185) — otak Hermes primer tanpa bridge.
  Detail prasyarat: KNOWN_ISSUES #186.
- **Added — mode `openai` di `hermes-adapter.ts` (`HERMES_BRAIN_MODE`, default `openai`):**
  router & summarize via `POST {HERMES_OPENAI_URL}/v1/chat/completions`
  (`HERMES_OPENAI_KEY` + `HERMES_OPENAI_MODEL`, fail-closed bila kosong).
  Mode `bridge` (/ask) dipertahankan sebagai cadangan.
- **Docs — `.env.example`:** `HERMES_BRAIN_MODE`/`HERMES_OPENAI_URL`/`HERMES_OPENAI_KEY`/
  `HERMES_OPENAI_MODEL` (tanpa nilai secret).
- **Tests:** `copilot-hermes-contract.test.ts` +6. Suite Copilot **105 hijau**;
  `npm run build` exit 0.

#### 2026-10-02 - Copilot Admin: Draf Adapter Hermes Tanpa-MCP (Nonaktif Default)

- **Konteks:** keputusan tanpa-MCP; Hermes sebagai otak (router + summarize) via kontrak
  `POST /ask`, tangan + satpam tetap di Fastify. Detail: KNOWN_ISSUES #184 (prasyarat
  aktivasi VPS masih OPEN).
- **Added — `src/services/copilot/hermes-adapter.ts`:** `resolveHermesConfig()`
  (`COPILOT_ENGINE` default `internal`), `requestHermesRouter`/`requestHermesSummarize`
  (Bearer + timeout + fail-closed tanpa secret, tanpa dependency baru).
- **Changed — `copilot.service.ts`:** bila `COPILOT_ENGINE=hermes`, router & summarize
  mencoba Hermes dulu lalu fallback per-panggilan ke LLM internal; grounding, budget,
  dan audit tidak berubah. Tanpa env = perilaku identik pra-Fase 4.
- **Docs — `.env.example`:** variabel `COPILOT_ENGINE`/`HERMES_BRIDGE_URL`/
  `HERMES_BRIDGE_SECRET` (tanpa nilai secret).
- **Tests:** `copilot-hermes-adapter.test.ts` (4) + `copilot-hermes-contract.test.ts` (8).
  Suite Copilot 99 hijau; `npm run build` exit 0.

#### 2026-10-02 - Copilot Admin: Pintu Penolakan, Analisa Chat Lebih Luas, Gaya To-The-Point (internal)

- **Konteks:** admin melaporkan AI Copilot "kaku, tidak menjawab maksud" (contoh nyata:
  "siapa yang saya tolak untuk besok" & "siapa yang besok ada omongan jadwal tapi belum
  masuk sistem"). Audit read-only menemukan 3 akar: menu status tool tak memuat `rejected`,
  jendela chat `query_stalled_inquiries` sempit (5 pesan), dan gaya ringkasan tak punya tuas
  tenant-aware + kontrak link salah. Rencana Hermes-as-pengganti DITOLAK (duplikasi tool,
  hilang grounding/deadline/audit); eksekusi internal-only. Detail: KNOWN_ISSUES #182.
- **Fixed — pintu penolakan:** `RESERVATION_STATUS_VALUES` + deskripsi `status`
  `query_reservations_by_filter` (`src/services/copilot/copilot-tools.ts`) kini memuat
  `rejected` & `en_route`. Router LLM dapat menjawab "siapa yang saya tolak".
- **Improved — analisa chat:** `query_stalled_inquiries` mengambil 8 pesan terakhir (dari 5)
  dan mengekspos `offeredTime` (jam yang pernah ditawarkan admin, reuse `extractTimeOfDayHint`).
  `buildDegradedAnswer` menampilkan `offeredTime` + `waitingMinutes` manusiawi.
- **Improved — gaya tenant-aware:** fungsi murni `buildSummarizePrompt` + `formatWaitTime` +
  `loadCopilotStyle` (`src/services/copilot/copilot.service.ts`) membaca nada dari
  `Tenant.settings.copilot.styleTone` (tanpa migrasi). Kontrak link dikoreksi ke kanonis
  `/admin/live-chat?conversationId=` (renderer `AdminCopilotPanel` hanya mengaktifkan kanonis).
  Angka SOP tidak dihardcode ke prompt.
- **Tests:** `tests/unit/copilot-fixing.test.ts` +11 (kontrak status, `offeredTime`,
  `buildSummarizePrompt`/`formatWaitTime`). `npm run build` exit 0.

#### 2026-10-01 - Navigasi: Gerbang Pra-Keberangkatan Sadar Akurasi (Insiden Bidan Tersasar)

- **Konteks:** insiden 2026-09-30 — Bidan Thabita tersasar karena titik koordinat
  pasien berstatus `manual_staff` (tebakan staf) namun tombol Navigasi tampil hijau
  seragam & langsung membuka Google Maps. Audit: `docs/plans/MAPS_NAVIGATION_INCIDENT_AUDIT_AND_FIXING_PLAN.md`.
- **Added — `buildMapsUrls(lat,lng,locationSource,fullAddress)` (`staff-reservation.service.ts`):**
  titik `estimated_area`/`manual_staff` + ada alamat → `destination=<teks alamat>`
  (via `URLSearchParams`) agar Google Maps memandu ke klaster/blok, bukan pin mati;
  `gps_pin`/data lama tetap koordinat (kompatibel mundur). 3 call site meneruskan
  `resolveLocationSource` + `buildAddressText`.
- **Added — `needsNavigationPreflight(locationSource)` + `getGoogleMapsDirectionUrl(...,locationSource)`
  (`geoUtils.ts`):** sinkron dengan backend; gerbang deterministik hanya `gps_pin` yang lolos.
- **Added — `NavigationPreflightModal.tsx`:** modal pengaman pra-navigasi titik estimasi
  (3 aksi: minta shareloc / tetap buka peta / batal), presentational murni.
- **Added — `StaffToday.tsx`:** CTA sadar akurasi (amber "Navigasi (Estimasi)" untuk non-presisi)
  di kartu/header/modal; `handleStartNavigation` memblokir pembukaan peta non-presisi hingga
  bidan melewati modal; `handleRequestShareloc` mengisi composer chat dari template DB.
- **Added — Template DB `STAFF_SHARELOC_REQUEST`** (`followup-templates.ts` + editor
  `FollowUpTemplates.tsx`) + `StaffReservationService.getSharelocRequestText` +
  endpoint `GET /api/staff/shareloc-template`. **Tanpa hardcode teks bisnis.**
- **Added — Widget CS (`LiveChatDispatchWidget.tsx`):** badge peringatan + tombol
  "Minta Shareloc" saat `locationSource !== 'gps_pin'`; endpoint dispatch mengirim
  `locationSource`, `customerAddress`, `sharelocText`.
- **Tests:** `tests/unit/navigation-accuracy-preflight.test.ts` (14, adversarial).

## Arsip & INDEX

Lihat riwayat lengkap di [docs/changelog/INDEX.md](docs/changelog/INDEX.md) dan arsip bulanan di `docs/changelog/archive-*.md`.
