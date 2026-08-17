# Changelog

Semua perubahan signifikan pada proyek ini didokumentasikan di sini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
dan proyek ini menggunakan [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

### Fixed & Improved — Native Wheel Scrolling Fix, 80% Chat Screen Expansion & AI Draft Resizing

- **Perbaikan Total Scrolling Mouse Wheel & Touchpad (`index.css`, `LiveChatMonitor.tsx`)**:
  - Menghapus restriksi global `overscroll-behavior: none` pada `html, body, #root` di [index.css](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/packages/admin-dashboard/src/index.css) yang sebelumnya menyebabkan *scroll event hijacking* di peramban desktop (Chrome Windows) sehingga scroll wheel macet.
  - Memastikan kedua section (daftar chat & thread pesan) memiliki container flex yang solid dengan `flex-1 min-h-0 overflow-y-auto` sehingga scroll wheel mouse maupun gestur trackpad/touch dapat menggeser riwayat chat ke atas dan ke bawah secara mulus tanpa harus mengklik batang scrollbar secara manual.
- **Ekspansi Layar Live Chat ~75-80% & Textfield Melebar (`LiveChatMonitor.tsx`)**:
  - Mengubah struktur kolom grid menjadi flex layout dinamis: Section 1 (Daftar Chat) berukuran tetap `w-80` / `w-[320px] - w-[360px]`, sedangkan Section 2 (Thread Chat & Composer) mengambil seluruh sisa lebar layar (`flex-1 min-w-0`), mengalokasikan ~75-80% bidang layar langsung untuk live chat dan textfield.
  - Memperluas kapasitas auto-resize `<textarea>` composer saat membuat AI Copilot Draft atau mengetik pesan panjang dari maksimum `130px` menjadi `220px` (`max-h-[220px]`) dengan animasi resize mulus.

### Fixed & Improved — Database Schema Sync & 2-Section Dedicated Independent Scrolling

- **Sinkronisasi Database Postgres (`prisma db push` & `labels.description`)**:
  - Menjalankan sinkronisasi skema database lokal sehingga kolom `description` pada tabel `labels` terdaftar secara valid di PostgreSQL, menyelesaikan error `The column labels.description does not exist in the current database`.
  - Melakukan regenerasi Prisma Client (`npm run prisma:generate`) agar query `findMany` berjalan tanpa error.
- **Arsitektur 2-Section Layar Desktop dengan Slider Independen (`Layout.tsx`, `LiveChatMonitor.tsx`)**:
  - Menghapus scrollbar luar pada browser window saat membuka halaman Live Chat:
    - Di [Layout.tsx](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/packages/admin-dashboard/src/components/common/Layout.tsx), kontainer `<main>` otomatis terkunci (`overflow-hidden min-h-0`) saat membuka rute `/admin/live-chat`.
    - **Section 1 (List Chat / Kiri)**: Memiliki slider vertikal mandiri tepat di samping daftar kartu percakapan. Posisi scroll daftar chat tetap (*stay in place*) saat admin berinteraksi di panel pesan.
    - **Section 2 (Live Chat / Kanan)**: Memiliki slider vertikal mandiri tepat di samping gelembung pesan. Dilengkapi fungsi **Auto-Scroll ke bawah (*bottom*)** secara otomatis saat percakapan dibuka atau saat pesan baru masuk.
    - Menghilangkan `overscroll-contain` yang sebelumnya mengunci pergerakan mouse wheel.

### Fixed & Improved — Label Synchronization, Foreign Key Safety & 2-Slider Chat Layout

- **Pencegahan Error Foreign Key `prisma.customerLabel.upsert` (`labels.subroute.ts`)**:
  - Menambahkan resolusi entitas customer dan label sebelum operasi database pada endpoint `POST /api/admin/customers/:id/labels`.
  - Jika ID label berasal dari memory / sistem default yang belum tersimpan di DB, sistem otomatis meresolusi atau melakukan seeding transparan, sehingga mencegah error `Foreign key constraint violated: customer_labels_label_id_fkey`.
- **Relokasi Filter Sumber & Label Khusus ke Daftar Percakapan (`LiveChatMonitor.tsx`)**:
  - Memindahkan tombol tab `WhatsApp Asli / Semua / Sandbox` dan dropdown filter label dari header global ke bagian header **Daftar Percakapan (kolom kiri)**, sehingga area thread chat bersih dan fokus.
- **Pembersihan Scrollbar & Slider Mandiri (`LiveChatMonitor.tsx`)**:
  - Menambahkan `overscroll-contain` pada container pesan chat dan container percakapan sehingga hanya ada **2 slider yang bersih dan independen** (1 untuk riwayat pesan chat, 1 untuk scroll halaman/daftar chat), mencegah scroll-chaining yang menjebak saat scroll ke atas/bawah.
- **Pembersihan Mismatch & Duplikasi Label "Hold" (`LiveChatMonitor.tsx`)**:
  - Menghapus badge hardcoded `"Hold"` yang sebelumnya ditautkan ke status penanganan `isHumanHandling`. Status bot/human handling tetap diwakili oleh tombol aksi Bot.
  - Label kustom pasien pada kartu percakapan kiri kini murni bersumber dari relasi `customerLabels` sehingga tidak terjadi duplikasi label Hold saat ditambahkan.
- **Alokasi 90% Layar untuk Live Chat & Penipisan Margin (`LiveChatMonitor.tsx`)**:
  - Menipiskan margin atas halaman dari `space-y-6` menjadi `space-y-2`.
  - Mengatur tinggi container chat monitor ke `h-[calc(100vh-130px)]` dengan flex layout `flex-1` sehingga 90%+ area layar langsung dialokasikan untuk thread percakapan dan daftar pesan.
  - Merampingkan margin avatar, nama customer, nomor telepon, padding kartu, bubble chat, dan composer.
- **Sinkronisasi Reaktif Modal Detail Customer (`LiveChatMonitor.tsx`, `customers.subroute.ts`)**:
  - Menjadikan perubahan label melalui menu `+` langsung ter-update secara reaktif pada modal detail customer tanpa memerlukan reload.
  - Menginisialisasi awal data label pada modal dengan label percakapan aktif dan melengkapi fallback pembacaan label in-memory di `GET /api/admin/customers/:id`.
- **Backend Auto-Sync Flag `is_hold_labeled` & Auto-Cleanup saat Release (`labels.subroute.ts`, `livechat.subroute.ts`)**:
  - Pada `POST /api/admin/customers/:id/labels`: otomatis sinkronkan kolom `is_hold_labeled` dan `is_admin_labeled` di database saat label terkait ditambahkan atau dilepas.
  - Pada `PATCH /api/admin/conversation/:id/release`: otomatis mereset `is_hold_labeled = false` dan menghapus record label "Hold" dari tabel `CustomerLabel`.

### Added & Improved — Chat Header Label Dots, Label Description Field & AI Copilot Telemetry

- **Label Header Chat (Dot Berwarna & Tombol `+` Inline) (`LiveChatMonitor.tsx`)**:
  - Di header chat sebelah kanan, label aktif pasien kini ditampilkan sebagai **bulatan dot berwarna compact** (dengan tooltip judul nama label saat di-hover).
  - Tombol **`+`** diletakkan tepat inline di samping nomor HP customer untuk kemudahan pengelolaan label.
  - Pada **daftar percakapan sebelah kiri (*chat list*)** dan **modal detail customer**, label tetap tampil secara **lengkap dengan nama dan badge warna**.
- **Field Deskripsi Label Customer (`schema.prisma`, `labels.subroute.ts`, `CustomerLabels.tsx`)**:
  - Menambahkan kolom `description` pada skema `Label` di Prisma dan membuat migrasi `20260830000000_add_label_description`.
  - Mengupdate REST API (`GET`, `POST`, `PATCH`) dan in-memory fallback untuk mendukung field `description`.
  - Menambahkan input textarea deskripsi pada form modal Tambah/Edit Label serta menampilkannya pada kartu daftar label di halaman [CustomerLabels.tsx](file:///c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/packages/admin-dashboard/src/pages/tenant/CustomerLabels.tsx).
- **Pencatatan LLM Audit & AI Usage Telemetry untuk AI Copilot Bidan (`live-chat.service.ts`, `livechat.subroute.ts`)**:
  - Mengintegrasikan `recordLlmUsage` pada fungsi `generateAiSuggestion` untuk merekam metrik prompt tokens, completion tokens, cached tokens, provider, model, latensi, dan estimasi biaya ke buffer `llm_audit_logs`.
  - Mencatat aksi admin `AI_COPILOT_GENERATE_DRAFT` ke tabel audit log admin saat endpoint `suggest-reply` dipanggil.

### Added & Improved — Live Chat UI & Ergonomics Overhaul: Tools Menu Popover, 100% Width Textfield, Safe Enter Multiline, Header Label Row & Toast Repositioning

- **Konsolidasi Menu Tools (Gambar + AI Copilot Draft) (`LiveChatMonitor.tsx`)**:
  - Menggabungkan tombol lampirkan gambar dan tombol AI Copilot menjadi 1 tombol action menu **Tools (`+`)** dengan popover dropdown elegan, menghemat ruang horizontal composer.
  - Dilengkapi fitur click-outside listener untuk menutup menu otomatis saat mengklik area di luar popover.
- **Maksimalisasi Panjang Textfield Composer 100% Width (`LiveChatMonitor.tsx`)**:
  - Kolom textarea balasan admin diperluas mengisi 100% lebar horizontal yang tersedia (`flex-1 w-full min-w-0`), memaksimalkan kenyamanan mengetik di mobile maupun desktop.
- **Safe Enter Key Multiline di Mobile & Web (`LiveChatMonitor.tsx`)**:
  - Tombol `Enter` pada kolom chat murni menghasilkan baris baru (*new line*) di semua perangkat (mencegah pengiriman pesan tidak sengaja dari keyboard virtual HP).
  - Pengiriman pesan dilakukan secara aman melalui tombol **Kirim** (atau shortcut desktop `Ctrl+Enter` / `Cmd+Enter`).
- **Full-Width Label Row (100% Width) & Tombol `+` Compact (`LiveChatMonitor.tsx`)**:
  - Memisahkan deretan badge label customer dari kolom profil/nama pasien menjadi baris mandiri selebar 100% dari kiri ke kanan.
  - Mengubah tombol `+ Label` menjadi icon **`+`** yang compact.
- **Eliminasi Teks Jam Duplikat pada Kartu Percakapan (`LiveChatMonitor.tsx`)**:
  - Menghapus tampilan jam relatif berulang di sisi kiri footer kartu percakapan dan mempertahankan timestamp pesan terakhir di sisi kanan kartu.
- **Reposisi Floating Toast Notifikasi ke Bagian Atas Layar (`UiFeedback.tsx`)**:
  - Memindahkan posisi toast notifikasi sukses/gagal dari `bottom-6 right-6` ke `top-4 left-4 right-4 sm:left-auto sm:right-6 sm:top-6`, sehingga tidak lagi menutupi area textfield/composer dan tombol kirim.

### Fixed & Improved — Sanitizer Em-Dash (—) pada Output AI & Semua Pesan Keluar

- **Sanitizer baru `sanitizeEmDash` (`src/utils/language-sanitizer.ts`)**: Menghilangkan karakter em-dash (—) yang sering bocor dari output LLM, sesuai pedoman anti-slop `design.md` §9 (EM-DASH BAN). Penggantian kontekstual:
  - Rentang angka (`jam 9—11`) → hyphen `-` (`jam 9-11`)
  - Bullet list di awal baris (`— Gratis ongkir`) → `- ` (`- Gratis ongkir`)
  - Pemisah antar klausa (`Halo—mau tanya`) → koma `, ` (`Halo, mau tanya`)
- **Wire ke jalur LLM**: rantai sanitasi di `src/integrations/llm/generator.ts` (dynamic import) dan `src/integrations/llm/phrasing.service.ts` (finalContent).
- **Wire ke jalur outbound**: `normalizeWhatsAppFormat` (`src/utils/whatsapp-format.ts`) kini memanggil `sanitizeEmDash` terlebih dahulu, sehingga SEMUA pesan keluar (termasuk template statis seperti `followup-templates.ts`) bebas em-dash — otomatis melindungi `src/integrations/waha/client.ts` dan `src/integrations/whatsapp/waba.driver.ts`.
- **Test**: 5 kasus baru di `tests/unit/language-sanitizer.test.ts` (klausa, rentang angka, bullet list, no-op, null/empty).

### Added & Improved — AI Copilot Draft for Midwives, Strict Silent Medical Hold & Live Chat UI Overhaul (`v1.15.0`)

- **Fitur AI Copilot Draft Saran Balasan Bidan (`src/services/live-chat.service.ts`, `src/routes/admin/livechat.subroute.ts`, `LiveChatMonitor.tsx`)**:
  - Menambahkan endpoint `POST /api/admin/live-chat/conversations/:id/suggest-reply` yang menghasilkan 1 draf balasan profesional, ramah, dan empatik menggunakan LLM (`CHAT_REPLY`). Draf disusun berdasarkan konteks nama bunda, data anak, riwayat reservasi, dan 10 riwayat percakapan terakhir.
  - Menambahkan tombol interaktif **`Sparkles` (✨)** di textfield composer Live Chat. Bidan/admin cukup menekan icon ini untuk mengisi otomatis draf ke kolom balasan, lalu dapat mengedit atau langsung mengirimnya.
- **Strict Silent Auto-Hold untuk Pasien Medis & Legacy (`src/state-machine/machine.ts`)**:
  - Konsultasi medis untuk pasien legacy (`is_legacy_source = true`) maupun pasien yang sudah pernah treatment terkonfirmasi (`status = 'confirmed'`) kini dikecualikan secara ketat dari balasan FAQ otomatis.
  - State machine langsung mengeskalasi percakapan ke `HUMAN_HANDLING` dengan mode *silent* (bot tetap diam tanpa mengirim balasan otomatis ke customer) dan mengirim alert darurat ke grup WhatsApp admin.
- **Modal Detail Lengkap Profil Customer (`src/routes/admin/customers.subroute.ts`, `LiveChatMonitor.tsx`)**:
  - Menambahkan endpoint `GET /api/admin/customers/:id` dengan metrik LTV, purchase count, data anak, riwayat reservasi, dan label.
  - Header profil customer di sebelah kanan Live Chat kini dapat diklik untuk membuka **Customer Detail Modal** interaktif (menampilkan data kontak lengkap, ringkasan LTV/order, segmen pasien, riwayat anak, daftar reservasi, dan tombol direct WA).
- **Pembaruan Visual & Ergonomi Live Chat Dashboard (`LiveChatMonitor.tsx`)**:
  - **Pemisahan Label 2 Grup**: Grup 1 (status & segmentasi: `Hold`, `Legacy`, `New Customer`, label DB) diletakkan rapi tepat di bawah nama customer; Grup 2 (metrik operasional: `MQL`, `Order count`, `Sandbox`, `Meta`) ditaruh di footer bar di samping jam.
  - **Ikonografi Minimalis**: Tombol "Release" / "Kembalikan ke Bot" diganti dengan icon Bot minimalis modern. Tulisan status Live Chat di header luar disederhanakan menjadi icon sync WAHA berputar dan icon Wifi berwarna dengan tooltip status real-time.
  - **Default Filter WhatsApp Asli & Optimalisasi Mobile**: Default filter sumber diset ke `WhatsApp Asli` dan ukuran badge/dropdown dioptimalkan agar compact di tampilan mobile.


### Added & Improved — WhatsApp Customer Profile Picture Retrieval & Smart Avatar Display (`v1.14.0`)

- **Dukungan Pengambilan Foto Profil WhatsApp (`src/integrations/waha/client.ts`, `src/integrations/whatsapp/`)**:
  - Menambahkan method `getProfilePicture(phone)` pada `IWahaClient`, `WahaClient`, dan gateway abstraction `WhatsAppGateway` / `WahaGatewayDriver`.
  - Mengambil URL standar/preview avatar CDN WhatsApp (`pps.whatsapp.net`) secara efisien via endpoint WAHA.
  - Untuk provider WABA (Meta Cloud API Official), sistem melakukan fallback *graceful* karena kebijakan privasi Meta tidak menyediakan endpoint foto profil customer.
- **Skema Database & Background Sync Non-Blocking (`prisma/schema.prisma`, `src/services/customer.service.ts`)**:
  - Menambahkan kolom `profile_picture_url` dan `profile_picture_updated_at` pada model `Customer`.
  - Pengambilan foto profil dijalankan secara asinkron di latar belakang (*lazy sync / background job*) dengan cache TTL 3 hari untuk menghemat storage, kuota, serta mencegah *rate-limiting* ke WAHA.
  - Menambahkan endpoint admin `POST /api/admin/live-chat/customers/:id/refresh-profile-picture` untuk on-demand refresh foto profil langsung dari dashboard.
- **Komponen Smart Avatar Reusable (`packages/admin-dashboard/src/components/common/CustomerAvatar.tsx`)**:
  - Komponen avatar baru dengan lazy loading, deteksi error CDN otomatis (`onError` fallback), dan generator inisial nama deterministik dengan palet warna elegan.
- **Integrasi Live Chat Admin & Portal Terapis (`packages/admin-dashboard/`)**:
  - **Live Chat Monitor (`LiveChatMonitor.tsx`)**: Menampilkan foto profil / smart avatar customer pada daftar percakapan sebelah kiri dan di header chat sebelah kanan.
  - **Portal Terapis (`StaffToday.tsx`)**: Menampilkan foto profil customer pada kartu tugas hari ini (lengkap dengan badge nomor urut kunjungan), header chat WhatsApp terapis, riwayat tugas selesai, dan modal detail pasien.

### Added & Improved — Customer Labels CRUD & Live Chat Tagging System (`v1.13.0`)

- **Fitur Master Data Label Customer (`prisma/schema.prisma` & `src/routes/admin/labels.subroute.ts`)**:
  - Menambahkan model `Label` dan relasi pivot `CustomerLabel` untuk kategorisasi multi-label customer per tenant.
  - Endpoint REST API lengkap: `GET /api/admin/labels`, `POST /api/admin/labels`, `PATCH /api/admin/labels/:id`, `DELETE /api/admin/labels/:id`, dan `POST /api/admin/customers/:id/labels`.
- **Halaman Manajemen Label Customer (`packages/admin-dashboard/src/pages/tenant/CustomerLabels.tsx`)**:
  - Halaman admin baru di navigasi `Operasional & Jadwal` untuk membuat, mengedit nama & warna palette, serta menghapus label.
  - Dilengkapi preview badge interaktif, hitungan customer tertag, serta modal UI Feedback aman (tanpa native confirm/alert).
- **Integrasi Tagging Label di Live Chat (`packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`)**:
  - Menampilkan badge label aktif tepat di bawah nama dan nomor telepon pasien.
  - Tombol `+ Label` interaktif dengan popover picker untuk toggle label langsung secara real-time (optimistic update).
  - Badge label juga ditampilkan pada daftar percakapan di kolom kiri untuk kemudahan pemantauan.
- **Ergonomi Input Chat & Auto-Scroll Viewport**:
  - Tombol Enter pada textarea kini murni menambahkan baris baru (menghilangkan insiden pesan terkirim tidak sengaja di HP). Pengiriman pesan dilakukan dengan menekan tombol **Kirim**.
  - Logika auto-scroll diperbarui untuk memastikan seluruh area chat dan textfield/composer tetap terlihat di viewport layar.

### Fixed & Improved — Intercept Browser History Back at Frame 0 (Touchstart Passive: False) (`v1.12.11`)

- **Intersepsi Mutlak pada Frame 0 Touchstart (`packages/admin-dashboard/src/components/common/Layout.tsx`)**:
  - Mengubah opsi listener `touchstart` dari `{ passive: true }` menjadi `{ passive: false }`.
  - Memanggil `e.preventDefault()` langsung pada saat jari menyentuh zona tepi kiri layar (`clientX <= 30px`), membatalkan secara mutlak *system-level navigation recognizer* milik iOS Safari & Android Chrome sebelum browser sempat memulai animasi *history.back()*.
  - Menghapus konfigurasi CSS `touch-action: pan-y` yang tidak efektif untuk system history dan bisa mengganggu scroll tabel data horizontal.

### Fixed & Improved — 199% Bulletproof Admin Swipe: Popstate Sync, Touch-Action Pan-Y & Generous Zone (`v1.12.10`)

- **Kunci Standar CSS `touch-action: pan-y` (`packages/admin-dashboard/src/index.css`)**:
  - Mengonfigurasi `touch-action: pan-y` dan `-webkit-overflow-scrolling: touch` pada `html, body, #root` agar browser engine secara eksplisit menyerahkan kontrol gestur horizontal ke JavaScript aplikasi dan mematikan navigasi gestur horizontal browser.
- **Sinkronisasi Popstate History Navigation (`packages/admin-dashboard/src/components/common/Layout.tsx`)**:
  - Menyelaraskan pembukaan sidebar admin dengan `window.history.pushState({ adminMenuOpen: true }, '')` dan listener `popstate`.
  - Jika pengguna menekan tombol *hardware back* di Android atau terpicu gestur *back*, aplikasi akan **menutup menu sidebar** dan TIDAK meninggalkan halaman dashboard admin.
- **Zona Sentuh Responsif Thumb-Friendly Hingga 120px (`packages/admin-dashboard/src/components/common/Layout.tsx`)**:
  - Memperluas zona deteksi usap dari sisi kiri hingga 120px (35% layar) sehingga usapan jempol dari area tepi kiri dapat membuka menu navigasi admin secara instan tanpa perlu menyentuh bezel ekstrem sub-piksel.

### Fixed & Improved — Native DOM Interception for Admin Edge Swipe & 50vw Compact Therapist Drawer with Slide-Right Dismiss (v1.12.9)

- **Intersepsi Gestur Usap Tepi Admin via Native DOM Event Listener (`packages/admin-dashboard/src/components/common/Layout.tsx`)**:
  - Mengganti React synthetic `onTouch...` dengan native `window` event listener (`{ passive: false }` pada `touchmove`).
  - Memanggil `e.preventDefault()` saat usapan horizontal dimulai dari sisi kiri (`x <= 50` dan `deltaX > 10`), membatalkan secara mutlak aksi *history back* bawaan OS/browser mobile dan membuka sidebar navigasi dengan mulus.
  - Menghapus listener touch global dari root layout sehingga aktivitas scrolling vertikal pada tabel dan dashboard 100% lancar tanpa intervensi.
- **Optimasi Sidebar Kanan Portal Terapis Maks 50% Layar & Slide-Right to Close (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Membatasi lebar menu drawer terapis menjadi maksimal **50vw** (`w-[50vw] sm:w-[280px] max-w-[50vw] sm:max-w-[280px]`), menyisakan 50% layar sebelah kiri tetap terlihat terang/mudah disentuh untuk keluar.
  - Memasang gesture **slide ke kanan (usap kanan)** untuk menutup sidebar secara instan dari drawer body maupun backdrop overlay.
  - Menyesuaikan tata letak menu navigasi, tombol footer, dan avatar profil agar pas, proporsional, dan elegan pada tampilan 50vw.

### Fixed & Improved — Prevent Browser Back on Admin Edge Swipe & Restored Clean 1-Page per Tab for Therapist (v1.12.8)

- **Eliminasi Bentrok Browser Back pada Usap Tepi Admin (`packages/admin-dashboard/src/index.css`, `packages/admin-dashboard/src/components/common/Layout.tsx`)**:
  - Menambahkan `overscroll-behavior-x: none` pada `html, body, #root` untuk memblokir gestur *history back/forward* default browser.
  - Memasang sensor sentuh sisi kiri (`w-8 fixed inset-y-0 left-0`) dan deteksi `handleTouchMove` real-time (`start.x <= 75 && deltaX > 35`) sehingga usapan dari sisi kiri langsung membuka menu sidebar admin secara mulus tanpa memicu navigasi kembali di browser mobile.
- **Restorasi Total 1-Page per Tab pada Tampilan Mobile Terapis (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Mengembalikan arsitektur perenderan 1 halaman murni per tab tanpa distorsi horizontal:
    - Tab 1 (*Hari Ini*): 1 halaman penuh untuk daftar pasien (`mobileView === 'list'`) atau 1 halaman penuh untuk live chat WhatsApp (`mobileView === 'chat'`).
    - Tab 2 (*Jadwal Mendatang*): 1 halaman penuh jadwal reservasi.
    - Tab 3 (*Treatment Selesai*): 1 halaman penuh riwayat treatment selesai.
  - Menjaga transisi halus `animate-fadeIn` dan gestur usap tepi kanan untuk membuka menu profil terapis.

### Fixed & Improved — Admin Left-Edge Swipe Sidebar & Continuous 60fps Carousel Track for Therapist (v1.12.7)

- **Navigasi Gestur Usap Kiri-ke-Kanan Sidebar Menu Admin (`packages/admin-dashboard/src/components/common/Layout.tsx`)**:
  - Menambahkan touch gesture listener pada root layout admin (`start.x <= 50 && deltaX > 40`) agar saat mengusap dari tepi paling kiri layar ke kanan di perangkat mobile, sidebar navigasi admin terbuka secara halus dan responsif.
  - Memperbaiki transisi backdrop gelap dengan `opacity-100` / `opacity-0` halus dan menambahkan gesture swipe ke kiri untuk menutup kembali sidebar.
- **Arsitektur Carousel Track 60 FPS Buttery-Smooth Portal Terapis (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Mengubah perenderan tab dari unmount/mount bersyarat (yang menyebabkan DOM re-layout dan jeda kaku) menjadi **3-slide horizontal carousel track** (`w-[300%]` dengan `transform: translateX(...)` dan `will-change: transform`).
  - Ketiga tab (*Hari Ini*, *Jadwal Mendatang*, *Selesai*) tetap terpasang di memori sehingga pergantian tab via geser/klik berjalan instan 60 FPS tanpa lag perenderan ulang dan mempertahankan posisi scroll masing-masing.
- **Transisi CSS GPU-Accelerated Menu Drawer Terapis (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menghilangkan pop-in kaku pada menu drawer kanan dengan transisi CSS `translate-x-full` ke `translate-x-0` yang mulus dan elastis.

### Fixed & Improved — Overscroll Background Fix, Directional Tab Slide & Right-Edge Swipe Sidebar (v1.12.6)

- **Eliminasi Bug Background Hitam saat Overscroll Dashboard (`packages/admin-dashboard/index.html`, `packages/admin-dashboard/src/index.css`)**:
  - Memperbaiki warna dasar `body` dari `bg-slate-950` (#020617 hitam pekat) menjadi `bg-[#f0f2f5] text-[#111b21]` dan menyelaraskan `<meta name="theme-color" content="#008069">`.
  - Mengunci `html, body { background-color: #f0f2f5; overscroll-behavior-y: none; }` guna mencegah kebocoran warna hitam saat melakukan *rubber-band pull* atas/bawah di mobile Safari/Chrome.
- **Animasi Geser Horizontal Directional Antar Tab Terapis (`packages/admin-dashboard/src/index.css`, `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Mengintegrasikan keyframes GPU `animate-slideInFromRight` (geser masuk dari kanan) dan `animate-slideInFromLeft` (geser masuk dari kiri) saat berpindah tab (*Hari Ini* ↔ *Mendatang* ↔ *Selesai*).
  - Mengikat transisi arah pada gestur swipe maupun penekanan tombol tab navigasi.
- **Gestur Right-Edge Swipe untuk Membuka Menu Sidebar/Drawer (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menambahkan listener gestur usap dari tepi paling kanan layar (`start.x >= window.innerWidth - 55`) ke arah kiri untuk langsung memunculkan menu drawer/sidebar profil terapis secara instan.
  - Mendukung gestur swipe ke kanan untuk menutup drawer kembali secara mulus.

### Fixed & Improved — Therapist Portal Dedicated Polish & Super Admin Restore (v1.12.5)

- **Restore Super Admin Layout (`packages/admin-dashboard/src/components/common/Layout.tsx`)**:
  - Mengembalikan sidebar Super Admin ke kondisi semula tanpa modifikasi. Label versi aplikasi difokuskan secara khusus di Portal Terapis (`StaffToday.tsx`).
- **Penyempurnaan Viewport & Flexbox Auto-Scroll Terapis (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menambahkan constraint `min-h-0 h-full` pada kolom chat flexbox dan mengikat re-scroll effect saat `loadingMessages` selesai agar viewport chat 100% instan bergulir ke pesan terbawah di mobile browser.
  - Memperbarui tag versi halus di header portal terapis (`v1.12.5`) dan menu drawer.

### Fixed & Improved — Multiline Enter, Rock-Solid Auto-Scroll Anchor & GPU Micro-Animations (v1.12.4)

- **Perilaku Tombol Enter Murni Menambah Baris Baru (*Multiline*) (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menghapus submit on Enter pada textarea chat agar penekanan tombol `Enter` murni menghasilkan baris baru (`\n`) dan melebarkan tinggi textarea secara otomatis.
  - Pengiriman pesan kini secara eksklusif dipicu melalui tombol Send (`<Send />`).
- **Jaminan Auto-Scroll Chat 100% (*Dual Anchor + Media Load Listener*) (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menyematkan invisible anchor element (`messagesEndRef`) di akhir daftar pesan dan menjalankan dual scroll (`scrollTop = scrollHeight + 99999` dan `scrollIntoView`).
  - Menambahkan event listener `onLoad` pada thumbnail gambar media chat agar viewport otomatis melakukan re-scroll begitu gambar selesai di-render.
- **Integrasi GPU-Accelerated Micro-Animations (`packages/admin-dashboard/src/index.css`, `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menambahkan keyframes animasi ringan: `popIn` (speech bubble chat), `slideFadeIn` & `fadeIn` (transisi tab), `pulseGlow` (kartu pasien aktif), dan `modalScaleUp` (spring-like modal dialog).
  - Menghilangkan kekakuan tampilan dengan transisi interaktif pada penekanan tombol (*active:scale-95*), quick reply chips, dan kartu reservasi (*hover & active states*).

### Fixed & Improved — Swipe Gesture Navigation, Auto-Scroll Instant, Enter Fix & Sidebar Version Tag (v1.12.3)

- **Perbaikan Kirim Pesan via Tombol Enter & Toast Feedback (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Memperbaiki event signature pada handler pengiriman balasan `handleSendReply` agar kompatibel menangani synthetic keyboard event saat tombol `Enter` ditekan dari textarea tanpa melempar error.
  - Memperbaiki parameter pesan toast error menjadi `toast(errorMsg, 'error')` yang sebelumnya terbalik.
- **Auto-Scroll Instan ke Pesan Terakhir (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Mengimplementasikan multi-tick `requestAnimationFrame` dan timeout bertingkat (0ms, 40ms, 120ms, 300ms) saat membuka chat pasien, berpindah thread, atau saat pesan balasan terkirim agar viewport chat langsung bergulir mulus ke posisi paling bawah.
- **Gestur Swipe Kiri/Kanan untuk Pindah Tab & Back Chat (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menambahkan touch swipe listener:
    - **Di halaman daftar**: Swipe kiri/kanan otomatis berpindah antar tab (*Hari Ini* ↔ *Mendatang* ↔ *Selesai*).
    - **Di dalam panel chat mobile**: Swipe horizontal (kiri atau kanan) langsung kembali (*back*) ke daftar kunjungan pasien.
- **Label Versi Aplikasi di Sidebar (`packages/admin-dashboard/src/components/common/Layout.tsx`, `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menambahkan label versi dan waktu build aplikasi yang rapi dan elegan di bagian bawah sidebar admin dashboard utama dan menu drawer portal terapis.

### Fixed & Improved — Portal Terapis Mobile UX, Anti-Zoom Focus, Quick Reply & Navigasi Cepat (v1.12.2)

- **Pencegahan Zoom-In & Auto-Growing Textarea Chat Terapis (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Mengganti input single-line menjadi `<textarea>` auto-grow (1 hingga ~5 baris / maks 130px) dengan `style={{ fontSize: '16px' }}` dan `text-[16px]` guna mencegah mobile Safari & Chrome melakukan auto-zoom paksa saat terapis mengetik balasan.
  - Mendukung shortcut keyboard `Enter` untuk mengirim pesan dan `Shift+Enter` untuk baris baru, serta auto-reset tinggi saat berganti pasien atau pesan terkirim.
- **Quick Reply Chips untuk Pesan Cepat Lapangan (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menyediakan tombol chip template cepat di atas composer chat untuk status umum: *"🛵 Sedang OTW"*, *"📍 Sudah Sampai"*, dan *"🙏 Selesai"*, memudahkan terapis berkirim kabar tanpa perlu mengetik panjang saat mobilitas.
- **Tab Bar Navigasi Mobile Terbuka (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menampilkan segment navigation bar horizontal langsung di mobile untuk beralih antara *"Hari Ini"*, *"Mendatang"*, dan *"Selesai"* dengan 1 ketukan tanpa harus membuka menu drawer garis tiga.
- **Badge Nomor Urut Kunjungan & Notifikasi Getar (Haptic Feedback) (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menambahkan badge urutan penugasan (`#1`, `#2`, `#3`...) pada setiap kartu pasien berdasarkan kronologi jam reservasi.
  - Menambahkan getaran haptic (`navigator.vibrate`) pada saat pesan WhatsApp baru masuk ke portal terapis.
  - Memperluas riwayat percakapan yang dimuat awal menjadi 30 pesan terakhir.
- **Versi Rilis & Timestamp (`packages/admin-dashboard/src/config/version.ts`)**:
  - Memperbarui versi portal menjadi `v1.12.2` (Build: 17 Ags 2026, 07:48 WIB).

### Fixed & Improved — Live Chat Monitor Mobile UX & Anti-Zoom Input Focus

- **Pencegahan Otomatis Zoom-In pada Input & Textarea Mobile (`packages/admin-dashboard/src/index.css`, `index.html`, `LiveChatMonitor.tsx`)**:
  - Menambahkan aturan CSS global untuk layar mobile (`max-width: 767px`) dengan `font-size: 16px !important` pada elemen `input`, `textarea`, dan `select` serta inline `style={{ fontSize: '16px' }}` dan class `text-[16px]` pada textarea Live Chat guna mencegah iOS Safari & Android mobile browser melakukan auto-zoom paksa saat admin mengetuk field input/balasan.
  - Memperbarui meta viewport pada `index.html` dengan atribut `maximum-scale=1.0, user-scalable=no, interactive-widget=resizes-content` untuk menangani pergeseran keyboard virtual.
- **Penyempurnaan UX & Auto-Growing Textarea Live Chat (`packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`)**:
  - **Auto-Grow Composer**: Textarea balasan admin kini otomatis memanjang dinamis (1 baris hingga ~5 baris / maks 130px) sesuai panjang ketikan teks dan otomatis me-reset tinggi ke ukuran awal setelah pesan terkirim atau berganti percakapan.
  - **Pembersihan Navigasi Mobile**: Menghilangkan tombol kembali (*back button*) redundan di header atas saat tampilan chat mobile aktif dan mengoptimalkan tombol kembali tunggal di dalam panel inspector obrolan.
  - **Ergonomi Tombol Kirim Mobile**: Menyesuaikan tombol kirim menjadi icon-only di layar HP sempit agar textarea balasan memiliki ruang lebar horizontal maksimal dan nyaman diketik.
  - **Layout & Ketinggian Adaptif**: Menyesuaikan ketinggian container daftar percakapan dan panel obrolan dengan viewport mobile (`100dvh`) agar tidak terpotong oleh virtual keyboard.
- **Label Versi & Waktu Update Dashboard (`packages/admin-dashboard/src/pages/tenant/Overview.tsx`, `version.ts`)**:
  - Menambahkan label badge versi (contoh: `v1.12.1`) dan stempel waktu pembaruan terakhir (contoh: `Update: 17 Ags 2026, 07:35 WIB`) di header dan footer halaman Overview admin dashboard.
- **Cache-Busting & Invalidation Service Worker (`src/routes/admin.route.ts`, `packages/admin-dashboard/public/sw.js`)**:
  - Menyematkan header HTTP `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0` pada `index.html` agar browser HP selalu memuat bundle Vite terbaru dan tidak tertahan pada cache lokal lama.
  - Memperbarui cache name Service Worker ke `kala-admin-v2` dengan auto-deletion cache lama pada event `activate`.

### Changed & Security — Penonaktifan Fitur App State Fisik WAHA (Anti-Session Logout) & Migrasi Penuh ke Label UI Sistem

- **Akar Masalah & Penonaktifan Fitur App State Fisik WAHA (`src/integrations/waha/client.ts`, `src/services/conversation.service.ts`, `src/routes/webhook.route.ts`, `.env.example`, `.env`)**:
  - **Temuan Root Cause**: Operasi manipulasi chat state fisik ke WhatsApp via WAHA NOWEB (Baileys) seperti `addLabel`, `removeLabel`, `batchUpdateLabels`, dan `markUnread` memicu mutasi kriptografi *WhatsApp App State Sync* (`regular_low`). Akibat ketidakcocokan skema Protobuf biner terbaru Meta di server WhatsApp (`invalid wire type 4 at offset 6`), server Meta secara sepihak memutus sesi tertaut dengan error `stream:error code 401 conflict type: device_removed`, memaksa logout WhatsApp dan meminta scan QR ulang.
  - **Penonaktifan Fitur**: Mengubah nilai default `ENABLE_WAHA_HOLD_LABEL=false`, `ENABLE_LIFECYCLE_LABELS=false`, dan `ENABLE_WAHA_UNREAD=false` pada seluruh konfigurasi dan engine bot.
  - **Pencegahan Blocking**: Menghapus pemanggilan mutasi App State ke WAHA di lingkungan produksi dan memastikan fungsi label mengembalikan status sukses murni secara instan tanpa mengunci antrean global `runSerialized`.
- **Pemisahan Alert Notifikasi Grup Eskalasi (`src/services/conversation.service.ts`)**:
  - Memisahkan pengiriman notifikasi grup WhatsApp koordinasi tim (`ESCALATION_GROUP_JID`) dari guard `enableHoldLabel`. Notifikasi tiket eskalasi medis/CS ke grup admin kini tetap terkirim 100% menggunakan pesan teks standar (`sendText`), yang bebas dari App State Sync dan terbukti aman tanpa pernah memutus sesi WhatsApp.
- **Transisi ke Manajemen Label UI Sistem & Dashboard (`packages/admin-dashboard/src/pages/tenant/CustomerDatabase.tsx`, `LiveChatMonitor.tsx`, `src/routes/admin/customers.subroute.ts`)**:
  - Kolom database (`Customer.is_admin_labeled`, `Customer.is_hold_labeled`, `Customer.is_mql`, `Conversation.is_human_handling`) kini menjadi sumber kebenaran tunggal (*Single Source of Truth*).
  - Modal aksi label dan toast notifikasi di Admin Dashboard Customer Database disesuaikan menjadi *"Label berhasil diperbarui di sistem"* tanpa menampilkan pesan peringatan gagal mirror WAHA.
  - Alur auto-release dan status human handling di Live Chat Monitor berjalan secara digital dan real-time via Server-Sent Events (SSE).

### Fixed — "Invalid Date" Web Terapis & "Double Bubble" Live Chat Admin

- **Perbaikan State Chat & Formatting Jam Terapis (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Mengoreksi penanganan respons API `/api/staff/conversations/:id/reply` agar tidak menimpa objek pesan optimistik dengan payload status metadata API (mencegah `created_at` dan `content` menjadi `undefined` yang memicu tampilan *"Invalid Date"*).
  - Menambahkan guard validasi tanggal pada pemformatan jam chat (`isValidDate ? ... : new Date().toLocaleTimeString(...)`).
  - Mengoreksi listener SSE di `StaffToday.tsx` menggunakan `es.addEventListener('message.created')` dan payload reconciliation untuk menukar `tempId` dengan ID resmi server secara mulus.
- **Deduplikasi Outbound Webhook WAHA & Gateway (`src/integrations/waha/client.ts`, `src/integrations/whatsapp/waha.driver.ts`, `src/services/message.service.ts`, `src/routes/webhook.route.ts`)**:
  - Menangkap `messageId` langsung dari kembalian API WAHA `/api/sendText` & `/api/sendImage` agar pesan outbound terdaftar di memory idempotency store sejak pengiriman awal.
  - Menambahkan method `checkAndAttachOutboundDuplicate` pada `MessageService` dengan time-window 30 detik untuk mendeteksi pesan outbound yang sama dari webhook WAHA (`fromMe: true`) dan mengaitkan `wa_message_id` tanpa membuat baris baru di database atau membroadcast event SSE ganda.
  - Memperkuat deduplikasi SSE di `LiveChatMonitor.tsx` dengan toleransi 30 detik.

### Docs — Panduan Setup Meta CAPI & Kunci Enkripsi

- **Panduan terverifikasi (`docs/META_CAPI_SETUP.md`)**: Panduan setup Meta Conversions API (CAPI) & `WABA_TOKEN_ENCRYPTION_KEY` yang disesuaikan dengan kondisi nyata repo & server (`ubuntu@43.157.197.148`, port 1403, `/opt/wa-clinic-bot`) — bukan panduan generik.
  - Menjelaskan arsitektur: sumber kebenaran kredensial = DB per-tenant (`tenants.meta_pixel_id` / `meta_capi_access_token`, terenkripsi AES-256-GCM), fallback env `FB_PIXEL_ID` / `FB_CAPI_ACCESS_TOKEN`.
  - Peringatan tegas: JANGAN ganti `WABA_TOKEN_ENCRYPTION_KEY` setelah token tersimpan (AES-GCM auth tag mismatch → decrypt gagal → CAPI & WABA mati), kecuali re-input ulang semua token.
  - Koreksi cara menerapkan env: `docker compose up -d --no-deps app` (bukan `restart`, yang tidak membaca ulang `.env`).
  - Termasuk verifikasi status server saat ini (CAPI sudah terkonfigurasi: Pixel ID `1382300863013984` + token terenkripsi di DB) dan langkah verifikasi via Meta CAPI Health & Live Tester (`/admin/meta-click-catcher`) & Meta CAPI Queue.

### Changed — Anaphora Clarification Resolution ("Maksud saya yang paket newborn"), NLU Token Truncation Fix, & Intent Prompt Isolation

- **Resolusi Anaphora & Koreksi Kalimat ("Maksud saya yang...") (`src/services/treatment-catalog.service.ts`, `nlu-classifier.service.ts`, `src/integrations/llm/intent.ts`)**:
  - Menambahkan pembersihan partikel koreksi (*"maksud saya yang"*, *"maksudku"*, *"bukan itu maksud saya"*) sebelum pencarian katalog, sehingga pencarian katalog langsung menargetkan entitas intinya.
  - Memetakan istilah `"newborn"` & `"selapan"` langsung ke **`Paket Selapan (Newborn Care)`** (ID: `baby-paket-selapan`).
  - Menambahkan deteksi pola anaphora pada `fallbackClassify` dan `ruleBasedFallbackIntent` sehingga pesan koreksi tidak lagi terbuang menjadi `other` melainkan diklasifikasikan sebagai `faq_question` / `express_interest` dengan entitas treatment yang diekstrak.
- **Peningkatan Kapasitas `max_tokens` pada Model Reasoning NLU (`src/services/nlu-classifier.service.ts`)**:
  - Mengatur batas `max_tokens` minimal menjadi 1.500 token untuk mencegah pemotongan token di tengah penulisan `reasoning_content` pada model seperti DeepSeek-R1 / MiniMax.
- **Isolasi System Prompt Legacy Intent Classifier (`src/integrations/llm/intent.ts`)**:
  - Menghapus `${BOT_PERSONA_PROMPT}` dari classifier sistem agar model AI tidak lagi membalas chat customer (*"Baik, Bunda..."*), melainkan strictly mengembalikan JSON intent.
- **Pengujian (`tests/unit/treatment-catalog-search.test.ts`, `tests/unit/price-answer.test.ts`, `tests/unit/nlu-classifier.test.ts`)**:
  - Seluruh unit test & integrasi lulus 100% (11 files, 125 tests PASS).

### Added — Comprehensive Server Infrastructure Monitoring (`/server`)

- **Perintah Real-time `/server` (dan `/status_server`) (`src/routes/telegram-webhook.route.ts`)**:
  - Menampilkan laporan beban keseluruhan server dan kondisi infrastruktur secara komprehensif:
    * ⚙️ **Beban CPU & Sistem**: Persentase CPU aktif, jumlah vCPU core, Load Average (1m, 5m, 15m), Host OS Uptime, dan Bot Engine Uptime.
    * 💾 **Memori Server (RAM)**: Beban RAM total OS/VM (`used / total` & persentase), RAM sisa bebas, serta alokasi khusus Bot Node.js (RSS & Heap).
    * 💽 **Penyimpanan Hard Disk**: Kapasitas disk terpakai (`used / total` & persentase) dan sisa ruang disk bebas (GB) menggunakan native `fs.promises.statfs`.
    * 🔌 **Status Koneksi & Layanan**: Latency ping PostgreSQL, status WhatsApp Gateway (WAHA/WABA), antrean Redis, dan waktu respons bot.
- **Pengujian & Validasi (`tests/unit/telegram-webhook.test.ts`)**:
  - Test suite diperbarui dan lulus 100% (6/6 PASS).

### Added — Personal Therapist/Midwife Telegram Assignment Dispatch & Privacy Protection

- **Notifikasi Penugasan Khusus Terapis / Bidan (`src/services/staff-notification.service.ts`, `src/routes/admin/reservations.subroute.ts`)**:
  - Setiap kali reservasi pasien dibuat atau dialokasikan kepada seorang bidan/terapis, sistem otomatis mengirimkan rincian tugas ke akun Telegram pribadi terapis yang bersangkutan secara instan.
  - Rincian data yang dikirimkan:
    * 👤 Nama Pasien & Bayi/Anak (termasuk usia)
    * 💆‍♀️ Layanan Treatment
    * 📅 Hari, Tanggal, & Jam Kunjungan (WIB)
    * 📍 Alamat Lengkap & Patokan Rumah / Landmark
    * 🗺️ Link Rute Navigasi Google Maps Motor (`travelmode=two-wheeler`) & Estimasi Jarak Tempuh
    * 💰 Rincian Biaya & Status Pembayaran (`LUNAS (Transfer)` / `TAGIH DI TEMPAT`)
    * 📝 Catatan Khusus Pasien (alergi / preferensi)
- **Proteksi Privasi Perusahaan (Data Privacy Shield)**:
  - Nomor telepon WhatsApp pasien **TIDAK dikirimkan** ke ruang obrolan Telegram.
  - Sebagai gantinya, disediakan tautan cepat aman: `[ 💬 Buka Tugas & Chat Pasien di Portal Terapis ]` (`#staff-today`) sehingga seluruh komunikasi pelanggan tetap terlindungi dan terekam di dalam sistem klinik.
- **Tautan 1-Klik Akun Telegram Terapis (`src/routes/staff/auth.subroute.ts`, `StaffToday.tsx`, `StaffManagement.tsx`)**:
  - Terapis dapat menghubungkan akun Telegram pribadinya melalui tombol 1-klik `[ 🔗 Sambungkan Telegram Saya ]` di dalam Drawer Profil Portal Terapis (`showStaffProfileModal`).
  - Halaman Admin Staff Management menampilkan kolom status indikator Telegram terhubung / belum terhubung.
- **Database Migration (`20260835000000_add_staff_telegram_fields`)**:
  - Menambahkan kolom `telegram_chat_id` dan `telegram_pairing_token` pada tabel `staff`.
- **Pengujian & Validasi (`tests/unit/staff-telegram-notification.test.ts`)**:
  - Unit test suite penugasan terapis & validasi proteksi nomor telepon lulus 100% (3/3 PASS, total 9/9 suite test lulus).

### Added — Telegram SaaS 1-Click Zero-Setup Pairing & Dynamic Topic Webhook Routing

- **Integrasi Telegram 1-Klik Berbasis Deep Linking (`src/services/telegram.service.ts`, `src/routes/telegram-webhook.route.ts`, `schema.prisma`)**:
  - Menyediakan token pairing unik per-tenant (`tenants.telegram_pairing_token`) yang otomatis digenerate untuk mendukung model *Single Shared SaaS Bot*.
  - Menghadirkan 2 opsi tombol 1-klik di antarmuka Admin Dashboard:
    1. **`[ 💬 Sambungkan Chat Pribadi (DM) ]`**: Deep link `t.me/<bot>?start=<TOKEN>` yang mengaitkan chat 1-on-1 langsung saat menekan tombol `START` di Telegram tanpa input konfigurasi manual.
    2. **`[ 👥 Sambungkan ke Grup Tim / Staff ]`**: Deep link `t.me/<bot>?startgroup=<TOKEN>` yang mengaitkan grup tim secara instan saat bot diundang ke grup.
- **Dynamic Forum Topic Routing via Webhook (`src/routes/telegram-webhook.route.ts`, `src/services/alert.service.ts`)**:
  - Endpoint webhook `POST /api/webhook/telegram` yang menangani command perintah di dalam grup/topik:
    * `/set_daily_report` (atau `/report_here`): Mengaitkan sub-topik aktif untuk Laporan Operasional Harian.
    * `/set_error_alerts` (atau `/error_here`): Mengaitkan sub-topik aktif untuk Error Sistem & Outage.
    * `/set_medical_alerts` (atau `/medical_here`): Mengaitkan sub-topik aktif untuk Eskalasi Medis Urgent ke Bidan.
    * `/status_server` (atau `/server` / `/health`): Memeriksa status kesehatan server secara real-time (Uptime, Beban RAM, Database Postgres Latency, & WhatsApp Gateway Status).
    * `/status_telegram`: Menampilkan ringkasan status target chat dan ID topik yang sedang aktif.
    * `/help`: Menampilkan daftar perintah bot yang tersedia.
- **Pembaruan Admin UI Dashboard (`DailyReportPanel.tsx`)**:
  - Banner koneksi 1-klik instan dengan status real-time (`Cek Status`), kartu panduan sub-topik Telegram, dan tab pengaturan manual (BYOB/Custom token) yang dapat disembunyikan.
- **Database Migration (`20260834000000_add_telegram_pairing_and_topics`)**:
  - Menambahkan kolom `telegram_pairing_token`, `telegram_topic_daily_report`, `telegram_topic_system_errors`, dan `telegram_topic_medical_alerts` pada tabel `tenants`.
- **Pengujian & Validasi (`tests/unit/telegram-webhook.test.ts`)**:
  - Seluruh unit test suite Telegram Webhook & Routing lulus 100% (5/5 PASS, total 28/28 test lulus).

### Changed — Telegram Daily Report QA Dummy Test Mode & Safe Simulation

- **Pemisahan Pengujian Laporan Telegram & Proteksi Database (`src/services/daily-report.service.ts`, `src/routes/admin/settings.subroute.ts`, `DailyReportPanel.tsx`)**:
  - Tombol **"Tes Kirim (Data Dummy)"** di dashboard admin kini mengirimkan pesan simulasi berlabel `🧪 [TEST / DATA DUMMY]` yang menginfokan secara transparan bahwa data yang dikirim adalah data dummy uji coba koneksi Telegram.
  - Pengetesan **TIDAK** lagi memicu perhitungan data riil dan **TIDAK** mencatat status ke tabel `DailyReportLog` di database, sehingga tidak memblokir atau mengganggu jadwal cron laporan harian yang sebenarnya.
  - Request pengujian kini otomatis menyertakan input token dan chat ID yang sedang diketik, sehingga dapat langsung diuji sebelum atau sesudah menekan simpan.
  - Memperbaiki transparansi error Telegram API: jika terjadi kegagalan (misal format salah atau bot belum di-`/start`), response error dikembalikan secara jelas ke antarmuka admin (bukan silent fallback).
  - **Dukungan Routing Topik / Forum Telegram per Kategori (`src/services/alert.service.ts`, `.env.example`)**:
    * Sistem kini mendukung pemisahan sub-topik Telegram untuk setiap kategori laporan/alert:
      - **Laporan Harian**: diarahkan ke Topic ID dari `TELEGRAM_TOPIC_DAILY_REPORT` atau format Chat ID `[IDGrup]:[TopicID]` di admin settings.
      - **Error Sistem & Outage** (Redis down, WAHA putus, LLM timeout): otomatis diarahkan ke `TELEGRAM_TOPIC_SYSTEM_ERRORS`.
      - **Eskalasi Medis Urgent** (gejala demam/kejang): otomatis diarahkan ke `TELEGRAM_TOPIC_MEDICAL_ALERTS`.
    * Penambahan unit test `tests/unit/alert_triggers.test.ts` (16/16 PASS).

### Changed — Live Chat Retry, Telegram Alert, Language Naturalization & Symptom Grounding

- **Live Chat Admin Reply (`src/services/live-chat.service.ts`, `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menambahkan *Retry Loop Lokal* pada pengiriman chat manual oleh terapis/admin. Jika gagal (timeout/WAHA down), sistem otomatis mencoba 1x lagi setelah 2 detik.
  - Menerapkan *Idempotency Check* 2 detik untuk mencegah spam pesan yang tidak disengaja (double klik tombol kirim).
  - Mengintegrasikan peringatan darurat ke Telegram (memanggil `AlertService`) bila pengiriman masih gagal setelah retry, agar admin sadar WhatsApp Gateway sedang bermasalah.
  - Memperbarui feedback UI untuk memberikan pesan toast (alert) bila error terjadi.

- **Perbaikan Ungkapan Kaku & Bahasa Alami (`src/config/persona.ts`, `src/integrations/llm/phrasing.service.ts`, `src/utils/language-sanitizer.ts`)**:
  - Melarang kata kaku/baku seperti *"Syukur sekali"*, *"Puji syukur"*, *"Alangkah baiknya"*. Diubah menjadi ungkapan hangat dan santai: *"Wah dekat ya Bunda..."*, *"Wah senang sekali..."*.
  - Menetapkan aturan gramatikal tegas pada sapaan *"Bunda"* (kata ganti/sapaan utama) vs *"bund"* (partikel panggilan di akhir kalimat). Dilarang menulis *"untuk bund"*, *"ke bund"*, *"dari bund"* $\rightarrow$ otomatis dinormalisasi menjadi *"untuk Bunda"*, *"ke Bunda"*.
  - Melarang dan membersihkan kebocoran kata bahasa Inggris seperti *"appointment"* / *"appointment-nya"* $\rightarrow$ disanitasi menjadi *"jadwal reservasi"* / *"jadwalnya"*.
- **Grounding Rekomendasi Gejala Keluhan Anak ke Katalog Klinik (`src/integrations/llm/generator.ts`, `src/services/treatment-catalog.service.ts`)**:
  - Menambahkan **Aturan 11 (Pemetaan Keluhan & Gejala Spesifik)** pada prompt LLM:
    * Keluhan **kembung / kolik / susah BAB / batuk pilek / rewel** WAJIB diarahkan ke **Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)** (bukan Pijat Bayi Ceria / Kids Ceria).
    * Terapi **Sinar Moksa** / **Nebulizer** dijelaskan sebagai add-on terapi pernapasan (dada/punggung) bila disertai batuk pilek atau dahak lendir.
- **Logging Transparan Perhitungan Jarak (`src/services/delivery.service.ts`)**:
  - Menambahkan structured console log setiap kalkulasi jarak:
    * **OpenRouteService (ORS API)**: `[DISTANCE CALC] 🛣️ Method: OpenRouteService (ORS API) | Distance: X km (est. travel: Y mins) | Clinic: [...] ──▶ Customer: [...]`
    * **Haversine Fallback**: `[DISTANCE CALC] 📐 Method: Haversine Fallback (1.60x circuity) | Straight: A km ──▶ Road Est: B km | Clinic: [...] ──▶ Customer: [...]`
- **Unit Testing**:
  - `tests/unit/language-sanitizer.test.ts` & `tests/unit/delivery.test.ts` (10 files, 113 tests PASS).

### Changed — Natural & Conversational Price Inquiry Formatting ("Mijat balita usia 2 tahun, kena biaya berapa?")

- **Peningkatan Respons Harga & Rekomendasi Alami (`src/services/treatment-catalog.service.ts`, `price-answer.service.ts`, `src/config/persona.ts`)**:
  - Memperbaiki respons pertanyaan harga usia spesifik (*"mijat balita usia 2 tahun, kena biaya berapa?"*) agar hanya merekomendasikan treatment pijat yang relevan (*Pijat Kids Ceria*) tanpa memunculkan menu non-pijat seperti *Custom Kids Bubble Spa*.
  - Mengubah template harga dan CTA menjadi format percakapan yang hangat, natural, dan manusiawi:
    * *"Untuk pijat si kecil usia 2 tahun, kami rekomendasikan **Pijat Kids Ceria** ya Bunda 😊 Durasinya 45 menit, dan saat ini lagi ada promo jadi **Rp 90.000** saja (harga normal Rp 110.000)."*
    * *"Kira-kira mau dijadwalkan di hari apa ya Bunda? Biar sekalian kami bantu cekkan slot terapisnya 🤗"*
  - Menambahkan prioritas kategori usia (`KIDS` untuk usia $\ge 2$ tahun dan `BABY` untuk usia $< 2$ tahun).
  - Penambahan unit test `tests/unit/price-answer.test.ts` (11/11 PASS).

### Added — Foto Depan Rumah, Tombol Update Titik Lokasi GPS & Patokan, serta Kamera Langsung pada Chat Terapis

- **Panduan Visual Foto Depan Rumah & Catatan Patokan (`StaffToday.tsx`, `Reservations.tsx`, `src/services/staff-reservation.service.ts`)**:
  - Menyimpan `house_photo_url`, `landmark`, `location_updated_at`, `location_updated_by_staff_id`, dan `location_updated_by_staff_name` pada `Customer.preferences` (aman tanpa migrasi schema DB dan siap multi-tenant).
  - Menampilkan thumbnail foto tampak depan rumah pasien & catatan patokan pada:
    1. **Portal Terapis**: Di bawah alamat pada setiap kartu tugas (Treatment Hari Ini, Jadwal Mendatang, Riwayat Selesai, dan Modal Detail Pasien).
    2. **Admin Dashboard**: Di dalam modal **Detail Reservasi** (section Lokasi & Pengiriman) lengkap dengan info staf yang memperbarui dan link Google Maps.
  - Menambahkan modal zoom lightbox untuk melihat foto tampak depan rumah dalam resolusi tinggi/HD saat diklik.
- **Tombol & Modal "Update Titik Lokasi & Foto Rumah" (`StaffToday.tsx`, `src/routes/staff/today.subroute.ts`)**:
  - Menambahkan tombol `[ 📍 Update Titik Lokasi & Foto Rumah ]` pada setiap kartu tugas dan modal detail.
  - Membuka modal interaktif yang menyediakan:
    1. **📍 Gunakan Titik GPS HP Saya Sekarang**: Mengunci titik koordinat GPS aktual perangkat di lapangan (`navigator.geolocation.getCurrentPosition`) dengan indikator akurasi (misal: `±8 meter`) untuk mengoreksi share-loc yang kurang presisi.
    2. **📷 Buka Kamera & Foto Rumah Pasien**: Mengambil foto tampak depan rumah/pagar/nomor rumah via kamera perangkat (`capture="environment"`), dengan kompresi server-side (max 800px) via `mediaService.resizeImageToMax`.
    3. **Catatan Patokan / Ancer-ancer**: Input teks panduan lokasi (contoh: *"Pagar hitam gerbang kayu, seberang masjid"*).
  - Endpoint baru `POST /api/staff/update-location` yang otomatis menghitung ulang jarak dari klinik (`calculateHaversineDistance`), memperbarui database customer, dan mencatat audit log staf.
- **Fitur Edit Panduan Lokasi & Upload Foto Rumah dari Sisi Admin (`Reservations.tsx`, `src/routes/admin/customers.subroute.ts`)**:
  - Menyediakan tombol `[ ✏️ Edit ]` / `[ + Tambah Foto Rumah & Patokan ]` langsung di dalam modal **Detail Reservasi** pada Admin Dashboard.
  - Membuka modal khusus Admin untuk mengunggah/mengganti foto rumah pasien (dari file komputer/galeri dengan kompresi otomatis), mengedit catatan patokan, serta mengatur koordinat GPS Latitude & Longitude secara manual.
  - Endpoint baru `PUT /api/admin/customers/:id/location` dengan fallback in-memory store yang otomatis memperbarui preferensi customer dan menghitung ulang jarak Haversine.
- **Pencantuman Kelurahan & Kecamatan pada Watermark Foto Rumah (`media.service.ts`, `staff-reservation.service.ts`, `customers.subroute.ts`)**:
  - Banner watermark pada foto depan rumah pasien kini otomatis menyertakan nama Kelurahan & Kecamatan (contoh: `📍 GPS: -7.348812, 112.751623 · Kel. Wonokromo, Kec. Wonokromo`).
  - Baris kedua mencantumkan catatan patokan dan tanggal/jam WIB secara rapi dan tajam.
- **Aturan Haversine > 1 km (Pertahankan Koordinat Utama & Simpan Revisi ke Ancer-ancer) (`staff-reservation.service.ts`, `customers.subroute.ts`)**:
  - Jika koordinat GPS baru yang dikirim terapis/admin berselisih **> 1 km** dari koordinat utama customer saat ini:
    - **Koordinat utama (`Customer.lat` & `Customer.lng`) tetap dipertahankan / tidak ditimpa**.
    - Koordinat revisi lapangan otomatis dicatat dan ditambahkan ke catatan **patokan / ancer-ancer** (contoh: `[📍 GPS Lapangan: -7.348812, 112.751623 (+1.4km)]`) serta disimpan dalam preferensi customer (`field_gps_lat`, `field_gps_lng`, `field_gps_diverged`).
    - Mencatat audit log `STAFF_UPDATE_CUSTOMER_LOCATION_DIVERGED` untuk kemudahan pelacakan CS/Admin.
  - Jika selisih **≤ 1 km** (koreksi presisi pagar/pintu rumah): koordinat utama diperbarui dan jarak dihitung ulang secara normal.
- **Kunci Akurasi GPS HP Otomatis Polling s/d 5 Percobaan (Target Akurasi ≤ 10 Meter) (`StaffToday.tsx`)**:
  - Tombol *"📍 Gunakan Titik GPS HP Saya Sekarang"* dan auto-GPS foto kini otomatis melakukan looping polling satelit hingga **5 kali percobaan**:
    - Langsung berhenti seketika saat akurasi mencapai target **≤ 10 meter** (`🟢 GPS presisi tinggi terkunci (±Xm)`).
    - Jika akurasi awal masih di atas 10 meter, sistem menampilkan progres percobaan real-time di tombol (`Mencari satelit GPS (Percobaan X/5)...`) dan secara otomatis memilih titik dengan akurasi terbaik dari 5 percobaan tersebut.
- **Interaksi Satu Baris Header Kartu Tugas untuk Detail Pasien (`StaffToday.tsx`)**:
  - Menjadikan seluruh baris atas kartu tugas (Avatar Icon Kategori, Nama Pasien, Judul Layanan, dan Jam Reservasi) sebagai area klik pembuka **Modal Detail Pasien** (`setDetailModalTask`).
  - Area bawah kartu tugas (Alamat, Foto Rumah, Patokan, dan Tombol OTW/Chat) tetap fokus untuk membuka chat WhatsApp atau navigasi peta, sehingga terapis di perangkat mobile tidak perlu membidik icon kecil.
- **Mode Navigasi Sepeda Motor / Roda Dua (`travelmode=two-wheeler`) (`staff-reservation.service.ts`, `StaffToday.tsx`)**:
  - Memperbarui parameter URL navigasi Google Maps (`navigationUrl`) dari `bicycling` menjadi `two-wheeler` (`https://www.google.com/maps/dir/?api=1&destination=lat,lng&travelmode=two-wheeler`).
  - Memastikan saat terapis menekan tombol `[ Navigasi ]` di HP, aplikasi Google Maps langsung membuka tab rute **Sepeda Motor** (menghindari jalur tol mobil dan memilih rute motor yang efisien).
- **Test & Verifikasi**:
  - Penambahan unit test `tests/unit/staff-auth-and-reservation.test.ts` (20/20 PASS) dan integrasi `tests/integration/admin-customer-label.test.ts` (11/11 PASS) — total 31/31 test PASS.
  - Build dashboard admin (`npm run build`) dan typecheck backend (`tsc --noEmit`) 100% PASS.

### Added — Right Sidebar Drawer Menu (Garis Tiga) & Tab Treatment Selesai untuk Portal Terapis

- **Right Sidebar Slide-over Drawer (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - **Tombol Garis Tiga (Hamburger Menu)**: Menambahkan tombol menu di kanan atas header untuk membuka slide-over drawer dari sisi kanan layar.
  - **Menu Navigasi Lengkap**:
    1. 📋 **Treatment Hari Ini**: Menampilkan tugas aktif hari ini dan split view WhatsApp live chat.
    2. 📅 **Jadwal Mendatang**: Menampilkan jadwal reservasi mendatang dikelompokkan per tanggal.
    3. ✅ **Treatment yang Sudah Dilakukan**: Menampilkan riwayat treatment yang telah selesai/lunas lengkap dengan rincian total omset, pembayaran (Tunai/Transfer/QRIS), dan detail pasien.
  - **Profil Staf & Logout**: Akses cepat ke modal info akun terapis dan tombol keluar dengan konfirmasi aman (`useUiFeedback`).
- **Backend Endpoint Riwayat Selesai (`src/services/staff-reservation.service.ts`, `src/routes/staff/today.subroute.ts`)**:
  - Menambahkan method `StaffReservationService.getCompletedTasks` dan endpoint `GET /api/staff/completed-tasks`.
  - Penambahan unit test `tests/unit/staff-auth-and-reservation.test.ts` (16/16 PASS).

### Fixed — Multi-Child / Multi-Treatment Transport Policy Inquiry ("Untuk 2 anak transportnya 1 kan")

- **Deteksi Pertanyaan Kebijakan Ongkir Multi-Anak / Per Kunjungan (`src/state-machine/utils/transport-policy-checker.ts`, `interest.ts`, `persona.ts`)**:
  - Memperbaiki bug di mana customer yang menanyakan kebijakan transport untuk 2 anak / per kunjungan (*"Untuk 2 anak transportnya 1 kan"*) keliru di-hijack oleh lookup harga treatment dan dijawab dengan harga *Pijat Kids Ceria*.
  - Menambahkan detector `isMultiChildTransportQuestion` untuk mengenali pertanyaan kebijakan transport (misal 2 anak, multi-treatment, per kedatangan, per alamat).
  - Mengisolasi `isAskPrice` (`src/services/price-answer.service.ts`) agar tidak membajak pertanyaan kebijakan ongkir sebagai pertanyaan harga katalog treatment.
  - Menambahkan respon deterministik ramah: *"Iya betul Bunda, untuk biaya transport/ongkir homecare kami dihitung per kedatangan/kunjungan (per alamat) ya Bunda, jadi meskipun untuk 2 anak atau lebih (atau Bunda + si kecil), ongkirnya tetap dihitung 1 kali saja yaa 🤗 Mau ambil treatment apa saja untuk si kecil/Bunda?"*
  - Menambahkan prompt Rule 10 pada AI Generator (`src/integrations/llm/generator.ts`).
  - Penambahan unit test `tests/unit/multi-child-transport-policy.test.ts` (3/3 PASS).

### Changed — Pricelist HD Dikirim Asli; Dashboard Tanpa Preview (Hanya Tombol Lihat); Mode Upload Saja

- **Pricelist dikirim ke customer dalam ukuran asli (HD, tanpa kompresi)** (`pricelist-config.service.ts`, `machine.ts`): fungsi `resolvePricelistSendTarget` (yang me-resize 1/3 & membuat file duplikat tiap kirim) **dihapus**; `machine.ts` kembali memakai `resolvePricelistImageTarget` — sumber `/media/outbound/...` dikirim langsung (WAHA: path file lokal; WABA: URL publik), sumber URL eksternal dikirim langsung. Bonus: tidak ada lagi file duplikat per kiriman → hemat storage & kuota MQL.
- **Dashboard tidak lagi menampilkan pratinjau gambar** (`PricelistImagePanel.tsx`): blok preview dihapus — diganti **tombol "Lihat Gambar Pricelist"** (ikon mata) yang membuka modal lihat gambar HD asli (klik luar = tutup).
- **Mode "Pakai URL" dihapus** (`PricelistImagePanel.tsx`): hanya mode **upload gambar**; tombol "Reset ke Default" tetap (satu-satunya cara hapus gambar custom). Response `pricelistThumbUrl` di `GET/PUT /api/admin/settings/pricelist-image` dihapus (tidak terpakai lagi) beserta import `fs`.
- **Sumber pricelist HD asli tetap inline MQL & retensi media** (via `saveOutboundMedia`) — tidak berubah dari versi sebelumnya.
- Test: 151 files / 1381 tests pass; build dashboard & backend hijau.

### Changed — Card Pricelist Inline dengan MQL & Retensi; Sumber HD Tersimpan, Dashboard Pakai Thumb

- **Upload pricelist kembali disimpan HD asli** (`settings.subroute.ts`): kompresi 1/3 saat upload **dibatalkan** — file sumber berkualitas penuh tersimpan via `saveOutboundMedia` (tetap **inline MQL & retensi media**). Kompresi hanya terjadi saat **kirim ke WhatsApp** (`resolvePricelistSendTarget`, 1/3 dimensi).
- **Dashboard menampilkan versi ringan**: endpoint `GET/PUT /api/admin/settings/pricelist-image` kini mengembalikan `pricelistThumbUrl` (blur thumb `_thumb.jpg` ~6KB yang otomatis dibuat `saveOutboundMedia`; fallback `null` bila tidak ada). `PricelistImagePanel` memakai thumb untuk pratinjau — browser tidak lagi mengunduh file HD (contoh live: 2.6MB → ~6KB per buka Settings).
- **Card pricelist inline dengan MQL & Retensi** (`MqlSettingsPanel.tsx`, `Settings.tsx`): panel "Gambar Pricelist WhatsApp" tidak lagi standalone — kini **satu grid 3 kolom sebaris**: Pricelist | MQL Automation | Retensi Media Live Chat.
- Test: 151 files / 1381 tests pass; build dashboard & backend hijau.

### Added & Changed — Kalender Pure, Auto-Scroll Mingguan, Ikon Mata Bukti Bayar, Upload Bukti di Manage, Modal Klik-Luar Tutup, Kompresi Gambar Server-Side

- **Kalender jadi pure calendar** (`Reservations.tsx`): sidebar (spotlight, filter kategori/terapis/status) & tombol "Filter" mobile dihapus; halaman kini hanya search + grid kalender/tabel. File `CalendarSidebar.tsx`, `UpcomingSpotlightCard.tsx`, `MiniMonthCalendar.tsx` dihapus (tidak terpakai lagi).
- **Tampilan Minggu auto-scroll** (`WeekScheduleGrid.tsx`): saat tab Minggu dibuka, langsung scroll ke **treatment terdekat dari sekarang** (kolom hari + baris jam-nya); bila tidak ada jadwal tersisa, scroll ke **kolom hari ini + jam sekarang**. Ikut re-scroll saat pindah minggu.
- **Bukti bayar → ikon mata saja** (`Reservations.tsx`): tombol teks "Cek Bukti Bayar" di tabel desktop & kartu mobile diganti **ikon mata (Eye)**; klik membuka modal bukti bayar.
- **Manage modal: upload bukti bayar + ikon mata** (`Reservations.tsx` + `reservations.subroute.ts`): section "Bukti Bayar" baru di modal Detail Reservasi — preview + ikon mata (lihat detail) + tombol hapus, atau area **unggah gambar** bila belum ada. Endpoint baru `PUT /api/admin/reservation/:id/proof` (upload/`remove:true`) dengan audit log `ADMIN_UPLOAD_PROOF`/`ADMIN_REMOVE_PROOF`.
- **Gambar dikompres server-side saat upload** (bukan HD, ringan untuk server & MQL):
  - Helper baru di `media.service.ts`: `resizeImageToMax(buffer, maxDim)` & `resizeImageToFraction(buffer, divisor)` (sharp, JPEG q80, tanpa perbesar).
  - **Bukti bayar** (catat bayar terapis `recordPayment` & upload di Manage): **max 800px** — foto HP 4000px turun ~80-95% berat.
  - **Pricelist** (upload di Settings): **1/3 dimensi** — konsisten dengan versi yang dikirim ke WhatsApp; tersimpan via `saveOutboundMedia` sehingga **inline MQL & retensi media** (sebelumnya upload pricelist & bukti tersimpan HD asli).
  - `resolvePricelistSendTarget` (pricelist-config.service.ts) di-refactor memakai helper yang sama.
- **Semua modal: klik di luar (backdrop) = tutup** — 21 modal (dashboard admin + portal terapis + komponen bersama): `UiFeedback` confirm dialog, InstallAppPanel, StaffManagement (role/add/edit staff), FollowUpQueue (reschedule/confirm), CustomerDatabase (chat history/CAPI), LandingPage, Reservations (Manage & bukti — proof sudah sebelumnya), ClinicServices, StaffSchedule (profil/detail), StaffToday (profil/detail/catat bayar), CreateReservationModal, ExternalIntegrationModal. Pola: overlay `onClick={close}` + panel dalam `stopPropagation`. Klik luar kini setara tombol X & "Batal".
- Test: 151 files / 1381 tests pass; build dashboard & backend hijau.

### Added & Changed — Paket Perbaikan Dashboard: Kalender Reservasi, Chat Terapis Kirim Gambar, Bot Diam Saat Staf Balas, Pricelist Kecil, PWA & Ongkir

- **Kalender Reservasi dirapikan** (`Reservations.tsx`, `CalendarSidebar.tsx`, `MonthScheduleGrid.tsx`):
  - Urutan tab diubah menjadi **Tabel → Hari → Minggu → Bulan** (sebelumnya Bulan/Minggu di depan).
  - Tombol navigasi tanggal ("Hari Ini", `<`, `>`) kini **disembunyikan di mode Tabel** — sebelumnya tetap tampil padahal tidak berfungsi di daftar tabel (kondisi awal penyebab tombol terasa "tidak bisa").
  - **Mini kalender di sidebar dihapus**; sidebar kini langsung berisi kartu spot light "Segera Datang" + filter (kategori, terapis, status). Tombol toggle mobile diganti label "Filter".
  - **Tampilan Bulan diurutkan jam paling pagi di atas** per hari (`getEventsForDay` sort `booking_date` ascending).
- **Chat terapis: bisa kirim gambar** (`StaffToday.tsx`): tombol lampirkan gambar (ikon) + preview lampiran + hapus lampiran di bar input; kirim via `imageB64/thumbB64/mimeType/fileName` yang sudah didukung backend. Pesan optimis menampilkan preview lokal, lalu diganti respons server.
- **Bot diam saat terapis membalas** (`live-chat.service.ts`, `today.subroute.ts`, `staff-reservation.service.ts`): parameter baru `forceEscalate` pada `sendAdminReply` — balasan Staff/Bidan (termasuk konfirmasi pembayaran) kini **selalu** mengaktifkan mode human-handling (`is_human_handling`) sehingga bot tidak membalas menyela percakapan, terlepas dari config `manual_reply_escalates` tenant (yang hanya berlaku untuk balasan Admin dashboard).
- **Pricelist dikirim versi kecil (1/3 dimensi)** (`pricelist-config.service.ts`, `machine.ts`): fungsi baru `resolvePricelistSendTarget` me-resize gambar pricelist (sharp, max ~1/3 dimensi terpanjang, JPEG q80) lalu menyimpannya via `saveOutboundMedia` — **terintegrasi kuota media (MQL) & retensi media chat** — sebelum dikirim WAHA/WABA. Gambar pricelist yang terkirim tidak lagi file raksasa dan ikut dibersihkan retensi.
- **PWA Install App dipindah** (`Settings.tsx`): panel "Install Aplikasi" kini berada **di kolom kiri (setengah lebar) tepat di atas Global Chatbot Toggle**, bukan satu baris penuh di atas grid.
- **Delivery Fee: label ongkir jadi + tombol hapus kecil** (`Settings.tsx`): tiap baris tier kini menampilkan kolom **"Ongkir Jadi (Rp)"** (tarif − promo, hijau; "GRATIS" bila 0) dan tombol hapus diubah jadi **ikon tempat sampah kecil** (tidak lagi full-width).
- **Label ongkir di kartu tugas terapis** (`StaffToday.tsx`, `StaffSchedule.tsx`): kartu kini menampilkan `(ongkir Rp X)` di samping total biaya bila ongkir > 0.
- Test: 151 files / 1381 tests pass; build dashboard & backend hijau.

### Added — Tab Reservasi: Tombol "Cek Bukti Bayar" (TF/QRIS) + Default Tampilan Daftar (Tabel)

- **Backend**: kolom baru `payment_method` & `proof_url` pada tabel `reservations` (migration `20260833000000_add_payment_proof`); `recordPayment` (`staff-reservation.service.ts`) kini menyimpan metode bayar & URL media bukti ke record reservasi — sebelumnya hanya tersimpan di audit log (`STAFF_RECORD_PAYMENT`).
- **Frontend Reservations** (`Reservations.tsx`):
  - **Default tampilan = Tabel (daftar)**, bukan kalender — berlaku juga di mobile (sebelumnya default responsif `day`/`week`). Ini sekaligus mengatasi tampilan kalender yang berantakan/error di HP.
  - **Kolom "Bukti Bayar"** baru di tabel desktop & **tombol "Cek Bukti Bayar"** di kartu mobile — tampil untuk reservasi **selesai** (status `completed`) yang memiliki bukti → membuka **modal preview gambar** berisi metode bayar (Tunai/Transfer/QRIS), nilai, status, dan tombol "Buka Gambar Penuh".
  - Reservasi lama (dicatat sebelum fitur ini) tidak memiliki `proof_url` — buktinya tetap tersedia di audit log `STAFF_RECORD_PAYMENT`.
- Test: 151 files / 1381 tests pass; build dashboard & backend hijau.

### Changed — Portal Terapis: Gate OTW 2 Jam, Pemisah Visual Treatment, Header Chat Icon-Only, Tab Menu Dihilangkan

- **Tombol "Infokan OTW" dikunci sampai H-2 jam sebelum jadwal treatment** (`StaffToday.tsx`): tombol di kartu tugas & di header chat kini `disabled` dengan visual redup + tooltip penjelas bila masih lebih dari 2 jam sebelum jam treatment. OTW hanya bisa dikirim pada rentang 2 jam sebelum hingga saat treatment.
- **Pemisah visual antar treatment**: kartu treatment ke-2 (dan genap berikutnya) di daftar tugas kini diberi **background abu-abu lebih pekat** (`bg-[#eceef1]`) dibanding kartu putih di sekitarnya — memudahkan membedakan treatment 1, 2, 3 secara berurutan.
- **Header chat WhatsApp dirapikan**: tombol "Navigasi", "Catat Bayar/Lunas", dan "Infokan OTW" diubah menjadi **ikon-only** (tombol persegi 36px) agar header tidak penuh; teks dipindah ke tooltip (title).
- **Menu tab "Tugas & Chat Hari Ini" / "Jadwal Mendatang" dihilangkan**: subheader 2-tab tidak lagi ditampilkan — portal terapis langsung menampilkan tugas hari ini + chat tanpa switcher tab.

### Added & Changed — Notifikasi Login Staf Admin & Penyederhanaan Tabel Staff Management

- **Pesan error spesifik untuk login staf non-Terapis** (`admin/auth.subroute.ts` TAHAP B & `staff/auth.subroute.ts`): jika nomor HP + password benar tetapi role akun bukan `THERAPIST` (mis. ADMIN_CS), server kini membalas **403** dengan notifikasi jelas — *"Akun ... adalah Staf Admin dan tidak boleh login memakai nomor HP. Gunakan email super admin, atau minta pengelola mengubah peran akun menjadi Terapis."* — menggantikan pesan generik "Email / Nomor WhatsApp atau password salah." yang membingungkan. Akun dengan kredensial salah tetap mendapat 401 generik (tidak membocorkan keberadaan akun).
- **Tabel Staff Management disederhanakan** (`StaffManagement.tsx`):
  - Kolom **Tugas Reservasi** dihapus.
  - **Icon/avatar di samping nama** dihapus; status akun kini ditandai **dot hijau** di kiri nama saat aktif (dot abu-abu saat nonaktif) — kolom "Status Akun" dihapus.
  - Aksi **Reset Password** & **Nonaktifkan/Aktifkan Akun** tidak lagi ada di tabel — fungsinya tersedia di **modal Edit** (kolom Password Baru & dropdown Status Akun yang sudah ada). Tabel kini hanya berisi Edit & Hapus. Modal Reset Password terpisah dihapus.
- Test: `unified-login.test.ts` (ADMIN_CS & ADVERTISER → 403 notifikasi), `staff-routes.test.ts` (403 untuk staff non-THERAPIST dengan password valid).

### Fixed — Enforce Role THERAPIST untuk Portal Terapis (Akses Tidak Bisa Bocor ke Role Lain)

- **Akar masalah**: portal staff (`/api/staff/*`) tidak pernah memeriksa role — akun non-THERAPIST (mis. ADMIN_CS) yang sudah punya sesi tetap bisa mengakses data & chat terapis, dan "Role & Hak Akses" yang dihapus di dashboard hanya tersimpan di localStorage browser (klien-only, tidak menyentuh server).
- **Gate THERAPIST di login & validasi sesi** (`staff-auth.service.ts`): `login` kini memfilter `role: 'THERAPIST'` di query; `validateSession` menolak sesi milik staff non-THERAPIST → sesi lama role lain **langsung invalid** di semua pintu (portal staff, restore, admin API via staff cookie).
- **Revoke sesi saat role diubah** (`staff-management.subroute.ts`): `PATCH /api/admin/staff/:id` kini mencabut seluruh sesi aktif bila `role` diubah (sebelumnya hanya saat `active=false` atau ganti password) → terapis yang diganti rolenya langsung keluar.
- **Role asli di respons auth staff**: `login`/`me`/`restore` kini mengembalikan role sebenarnya (lowercase, mis. `therapist`) menggantikan hardcode `'staff'` — sekaligus memperbaiki preload chunk PWA (role terapis tersimpan benar).
- Test: gate query login (THERAPIST vs ADMIN_CS) & validasi sesi non-THERAPIST → null.

### Added & Improved — Perombakan UI & UX Portal Terapis (StaffToday & StaffSchedule)

- **Header Minimalis & Titik Status Koneksi (`StaffToday.tsx`, `StaffSchedule.tsx`)**:
  - Menyederhanakan header menjadi sangat clean & compact: judul langsung menampilkan nama terapis (`{staff.name}`), menghilangkan teks "WhatsApp Terapis", "Portal Lapangan", "Bidan Terapis", dan teks "Aktif".
  - Mengganti teks status realtime dengan **titik dot koneksi minimalis** (🟢 Hijau saat online/connected, 🔴 Merah berdenyut saat reconnecting).
  - Tombol logout dihilangkan dari header utama dan dipindahkan ke dalam drawer profil staff.
- **Avatar Staff & Profile Drawer Modal (`StaffToday.tsx`, `StaffSchedule.tsx`)**:
  - Mengganti avatar inisial 1 huruf dengan **SVG Avatar Icon** (`UserCheck`).
  - Menambahkan popover/drawer profil interaktif saat avatar staff di-klik: menampilkan Nama Terapis, No HP, Role (*Staff Terapis Lapangan*), dan tombol **Keluar Akun (Logout)** dengan dialog konfirmasi yang aman.
- **Hardware / Browser Back Button Navigation (`StaffToday.tsx`)**:
  - Mengintegrasikan `window.history.pushState` saat membuka chat dan event listener `popstate`: menekan tombol back fisik/gesture di smartphone atau browser akan kembali ke daftar chat (bukan keluar dari aplikasi web).
  - Tombol back di UI (`ChevronLeft`) sinkron memanggil `window.history.back()`.
  - Popstate juga otomatis menutup modal (Detail Pasien / Catat Bayar / Profil) terlebih dahulu.
- **Icon Customer Berbasis Layanan & Modal Detail Pasien Privacy-Protected (`StaffToday.tsx`, `StaffSchedule.tsx`)**:
  - Avatar customer pada kartu tugas dan header chat diganti dengan **Icon Kategori Layanan**:
    - `BABY` -> Icon `Baby` berlatar soft sky blue
    - `MOMS` -> Icon `Sparkles` berlatar soft purple
    - `BOTH` / `KIDS` -> Icon `Smile` berlatar soft emerald
    - Treatment lain -> Icon `User` berlatar soft teal
  - Menambahkan modal **Detail Jadwal & Pasien** saat icon customer di-klik: memperlihatkan jam kunjungan, layanan, alamat lengkap, jarak & estimasi menit tempuh, data anak/usia, rincian biaya (biaya treatment, ongkir, total, status Lunas/Tagih), dan tombol buka peta Google Maps.
  - **Proteksi Privasi**: Nomor HP pasien disembunyikan seluruhnya dari UI terapis untuk mencegah kebocoran data pelanggan.
- **Aksen Warna Pembeda Antar Pasien & Auto-Scroll Chat (`StaffToday.tsx`, `StaffSchedule.tsx`)**:
  - Menambahkan aksen border kiri tebal dan soft tint background berbasis kategori treatment (*Baby = Sky Blue, Moms = Soft Purple, Both = Emerald, Lainnya = Teal*) sebagai penanda visual yang tegas antar pasien yang berbeda.
  - Mengoptimalkan auto-scroll chat menggunakan `requestAnimationFrame` dan timeout mikro sehingga viewport chat selalu otomatis scroll ke pesan paling akhir saat chat dibuka.

### Added & Improved — Boot Progress Bar & Retry Lebih Responsif (Mobile)

- **`BootProgress`** (`packages/admin-dashboard/src/components/common/BootProgress.tsx` + `lib/bootProgress.ts`): bar progress 0-100% tipis ala YouTube + teks status ("Memeriksa sesi…", "Memuat halaman…", dst). Bukan fake murni — fase digerakkan event nyata (`auth`/`chunk`/`mount`/`data`) + creep anti-beku (cap 92%) supaya tidak pernah tampak macet. Hanya muncul saat boot pertama PWA; navigasi antar halaman tetap pakai spinner lama.
- **Retry backoff adaptif** (AuthContext & StaffAuthContext): ganti `setTimeout 5s` datar → `[1s, 2.5s, 5s, 8s]`; skip percobaan saat `navigator.onLine=false` (tunggu event `online`, fallback timer); guard `inFlight` mencegah checkAuth ganda saat open (mount + visibilitychange). Setelah 3 kegagalan, teks bar jadi "Koneksi bermasalah — mencoba lagi…". Dampak: worst-case 3 percobaan turun dari ~15s → ~8.5s; kasus gagal-1x dari ~10s → ~4-5s.
- **Preload chunk paralel**: role terakhir disimpan di localStorage saat login; saat boot, chunk halaman tujuan (`StaffToday` untuk terapis / `Overview` lainnya) di-preload **paralel** dengan cek sesi → hemat 1 RTT + download di bukaan pertama.

### Added & Improved — Sesi Survive PWA Android (Tidak Logout Saat Tutup Aplikasi)

- **Akar masalah**: Cookie `staff_session`/`admin_session` bisa hilang dari browser saat aplikasi PWA Android ditutup/di-swipe dari Recents (perilaku browser — cookie dianggap session-scoped di standalone window), padahal sesi di server masih valid 30 hari.
- **Backend — Endpoint Restore Cookie**:
  - `POST /api/admin/auth/restore` (`src/routes/admin/auth.subroute.ts`): menerima token dari localStorage → validasi sesi admin/staff → me-issue ulang cookie (`admin_session` / `staff_session`, SameSite=Lax, Max-Age 30 hari).
  - `POST /api/staff/auth/restore` (`src/routes/staff/auth.subroute.ts`): validasi token staff → me-issue ulang cookie `staff_session`.
  - Respons login (admin & staff) kini menyertakan field `token` agar frontend bisa menyimpan token cadangan.
  - `admin.route.ts` / `staff.route.ts`: endpoint restore dibolehkan diakses tanpa sesi (bypass preHandler).
- **Frontend — Token Cadangan di localStorage**:
  - `StaffAuthContext.tsx` / `AuthContext.tsx`: token login disimpan di `localStorage`; saat `checkAuth` mendapat 401 (cookie hilang) → otomatis panggil `/restore` → cookie di-issue ulang → sesi pulih tanpa login ulang. Error jaringan saat restore tidak menghapus token (retry).
  - Token dihapus saat logout. *Catatan keamanan: token di localStorage rentan XSS (standar trade-off untuk fallback PWA); cookie HttpOnly tetap jalur utama.*
- **PWA Entry Fix** (`App.tsx`): route `/admin` (start_url manifest) kini me-redirect terapis ke `/admin/staff/today` sesuai role, bukan halaman Unauthorized.
- Test: `tests/integration/control_center_ui.test.ts` (restore admin + token di body login), `tests/integration/staff-routes.test.ts` (restore staff 200/401).

### Added & Improved — Mobile UX Overhaul & Touch Ergonomics Dashboard Admin

- **Pola Master-Detail Toggle Mobile di Live Chat Monitor (`packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`)**:
  - Mereplikasi pola `mobileView: 'list' | 'chat'` dari `StaffToday.tsx` ke `LiveChatMonitor.tsx` — di mobile, daftar percakapan dan jendela chat tidak lagi ditumpuk vertikal (nested scroll hilang).
  - Menambahkan tombol kembali (`ChevronLeft`) di header mobile dan chat inspector saat chat aktif untuk kembali ke daftar percakapan dengan mudah.
  - Menyesuaikan tinggi panel chat menjadi adaptif layar penuh mobile (`h-[calc(100dvh-170px)] lg:h-[650px]`).
- **Card-View Responsif di Database Customer (`packages/admin-dashboard/src/pages/tenant/CustomerDatabase.tsx`)**:
  - Mengganti tabel lebar 6-kolom dengan tumpukan kartu rapi di mobile (`md:hidden`), sementara tabel tetap aktif di desktop (`hidden md:block`).
  - Kartu menampilkan nama, nomor HP, status MQL, label WhatsApp (Admin/Hold toggle), LTV, dan tombol aksi berukuran sentuh nyaman.
- **Optimasi Kalender & View Switcher Mobile (`packages/admin-dashboard/src/pages/tenant/Reservations.tsx`)**:
  - Default tampilan otomatis menjadi **Hari (Day View)** saat terdeteksi layar mobile (`< 768px`).
  - Menyembunyikan tab *Bulan* dan *Minggu* di layar kecil agar terhindar dari grid horizontal 1050px yang tidak ergonomis di HP.
  - Menambahkan tombol toggle filter & spotlight mobile (`+ Filter & Kalender`) untuk membuka/menutup widget mini-kalender sesuai kebutuhan.
- **Pengelompokan Menu Sidebar & Status Popover (`packages/admin-dashboard/src/components/common/Layout.tsx`)**:
  - Mengelompokkan 19 menu navigasi flat menjadi 5 kategori terstruktur (*Operasional & Jadwal*, *Staff & Layanan*, *Marketing & Ads*, *AI Engine & Konten*, *Pengaturan & Sistem*) dengan heading sub-seksi yang rapi.
  - Mengganti tooltip status `title="..."` pada indikator WAHA/Redis dengan **popover interaktif tap-to-reveal** untuk pengguna smartphone & layar sentuh.
- **Standar Tipografi & Touch Target Global (`packages/admin-dashboard/src/index.css`, `packages/admin-dashboard/index.html`)**:
  - Menaikkan baseline teks body di mobile dari 12px (`text-xs`) ke 13px–14px yang nyaman dibaca tanpa perlu pinch-zoom.
  - Membatasi teks micro badge minimal 11px agar tetap terbaca jelas.
  - Menetapkan batas tinggi sentuh minimal tombol aksi (touch target standard >= 36px) di layar mobile.
  - Memangkas pemuatan Google Fonts eksternal menjadi hanya 1 font family (*Plus Jakarta Sans* 400, 500, 600, 700) untuk mempercepat initial load dan menghemat kuota koneksi seluler.

### Fixed — Portal Terapis Sering Ter-logout saat Server Restart / Jaringan Gangguan

- **`packages/admin-dashboard/src/services/api.ts`**: Error yang dilempar `apiRequest` kini membawa properti `status` (HTTP status code), sehingga caller bisa membedakan error otorisasi asli (401/403) vs error jaringan/timeout/server.
- **`packages/admin-dashboard/src/contexts/StaffAuthContext.tsx`**: Pengecekan sesi saat mount tidak lagi langsung meng-clear staff pada error apa pun. Hanya `401/403` asli yang mengarahkan ke halaman login; error jaringan/timeout (mis. saat app restart/deploy) memicu **retry otomatis tiap 5 detik** di latar belakang + retry ulang saat tab kembali fokus (`visibilitychange`) — terapis tidak lagi terlempar ke login hanya karena server restart sesaat.
- **`packages/admin-dashboard/src/contexts/AuthContext.tsx`**: Perlindungan retry yang sama diterapkan untuk pengecekan sesi admin (konsistensi perilaku).
- Akar masalah dari investigasi: sesi staff tersimpan valid di DB (TTL 30 hari), namun `StaffProtectedRoute` meredirect ke `/admin/login` setiap kali `checkAuth` gagal — termasuk saat app container down/restart (terbukti dari log: 502 `connection refused` jam 00:52 & deploy 01:29 WIB bertepatan dengan login ulang beruntun).

### Changed — Tombol Navigasi Peta Terapis dari Mode Mobil ke Sepeda (`travelmode=bicycling`)

- **`src/services/staff-reservation.service.ts`**: Mengubah parameter `travelmode` pada `navigationUrl` (link turn-by-turn Google Maps) dari `driving` (mobil) menjadi `bicycling` (sepeda) untuk semua kartu tugas terapis (Staff Today & Jadwal Mendatang), karena terapis berangkat dengan sepeda.
- Memperbarui assertion terkait di `tests/unit/staff-auth-and-reservation.test.ts`.

### Fixed — Persistensi Sesi Login Admin & Perpanjangan TTL (Mencegah Sesi Cepat Ter-logout)

- **Persistensi Sesi & Cookie Stability (`src/services/admin-session.service.ts`, `src/services/staff-auth.service.ts`, `src/routes/admin/auth.subroute.ts`, `src/routes/staff/auth.subroute.ts`, `src/routes/admin.route.ts`)**:
  - **Penyebab Sesi Cepat Logout**: Sebelumnya sesi Super Admin disimpan murni di in-memory `Map`. Setiap kali dev server hot-reload (`tsx watch`) karena ada kode yang diubah/disimpan atau bot restart, memori sesi langsung terhapus bersih dan menyebabkan browser mengembalikan status `401 Unauthorized`.
  - **Storage Disk Persistence**: Menambahkan mekanisme auto-save & auto-load token sesi admin ke `storage/admin_sessions.json`. Sekarang saat server di-restart atau hot-reload, sesi login aktif **tetap utuh dan tidak ter-logout**.
  - **Perpanjangan Masa Aktif Sesi (TTL 30 Hari)**:
    - Sesi Admin & Staff diperpanjang menjadi **30 hari penuh (2.592.000 detik)**.
  - **SameSite=Lax Cookie Policy**: Mengubah atribut cookie dari `SameSite=Strict` menjadi `SameSite=Lax` agar cookie sesi tidak terputus saat berpindah tab atau diarahkan dari URL eksternal/redirect.
  - **Dukungan Custom Roles di API Admin**: Memperluas filter `admin.route.ts` agar seluruh peran staf non-terapis (termasuk peran kustom baru) dapat mengakses endpoint dashboard tanpa terhambat otorisasi.

### Added — Manajemen Role & Setup Hak Akses Modul Dashboard (RBAC) Terpadu

- **Fitur Setup Role & Hak Akses di Manajemen Staff (`packages/admin-dashboard/src/pages/tenant/StaffManagement.tsx`, `packages/admin-dashboard/src/config/rolePermissions.ts`)**:
  - **Tombol & Tab Setup Hak Akses**: Menambahkan tombol `+ Setup Role & Hak Akses` di header serta dual-tab switcher `[ Daftar Akun Pengguna | Setup Hak Akses & Role (RBAC) ]`.
  - **Kartu Ringkasan Role Dinamis**: Menampilkan kartu ringkasan untuk seluruh role bawaan (`Super Admin`, `Admin Utama`, `Admin CS & Reservasi`, `Advertiser`, `Staff Terapis`) maupun custom role, lengkap dengan counter anggota aktif dan perbandingan modul yang diizinkan.
  - **Matriks Izin Modul Interaktif (Interactive Permission Matrix)**:
    - Menyusun 19 modul dashboard ke dalam 5 kelompok logis (*Dashboard & Pelanggan*, *Operasional & Jadwal*, *CRM & Komunikasi*, *Marketing & Ads*, *AI Engine & Sistem*).
    - Checkbox interaktif per modul dan tombol toggle instan *Pilih Semua / Batal Semua* per kategori dengan live synchronization.
  - **Modal Tambah & Edit Role Kustom**: Memungkinkan admin klinik membuat peran baru (misal: *Supervisor*, *Finance*, *Admin Gudang*) dengan checklist izin modul dan halaman redirect kustom.
  - **Dynamic Role Selector**: Dropdown pemilihan peran pada modal Buat Staff Baru dan Edit Staff otomatis membaca seluruh peran kustom yang aktif secara dinamis.

### Added — Sequential Homecare Distance & Travel Duration Calculation for Therapist Itinerary (Haversine 0-API)

- **Kalkulasi Jarak Sekuensial Berantai & Estimasi Waktu Tempuh Motor (`src/services/staff-reservation.service.ts`, `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Mengubah logika perhitungan jarak pada kartu tugas terapis (*Staff Today & Jadwal Mendatang*) agar mengikuti rute nyata terapis di lapangan:
    - **Pasien #1**: Menghitung jarak dari **Klinik / Basecamp** ke rumah Pasien 1 (`📍 Jarak: X km dari klinik`).
    - **Pasien #2, #3, dst**: Menghitung jarak dari **titik lokasi pasien sebelumnya** ke rumah pasien saat ini (`🛵 Jarak: X km dari Bunda [Nama Pasien Sebelumnya]`).
  - Menggunakan formula **Haversine lokal murni (0 API Call / 0 Biaya Kuota)** yang dikalikan dengan faktor kelokan rute perkotaan (`HAVERSINE_CIRCUITY_FACTOR = 1.60x`).
  - **Estimasi Waktu Tempuh Motor Terkalibrasi**:
    - Dikalibrasi langsung dari benchmark Google Maps motor perkotaan (`~2.05 menit/km + 2 menit buffer lampu merah/gang`).
    - Menampilkan durasi perjalanan langsung di kartu tugas (misal: `Jarak: 11.0 km dari klinik (±25 mnt perjalanan)`).
  - Menyertakan *fallback cerdas*: Jika pasien sebelumnya belum memiliki koordinat GPS, sistem otomatis menghitung ulang jarak & durasi dari titik klinik.
  - Memperbarui antarmuka kartu tugas dan jadwal mendatang di portal terapis dengan visual badge yang informatif.

### Added — UI Kalender Modern (Week/Day/Month/Table) & Modal Buat Jadwal Baru Terpadu dengan Searchable Service Catalog

- **Antarmuka Kalender Modern Dual-Pane (`packages/admin-dashboard/src/pages/tenant/Reservations.tsx`, `packages/admin-dashboard/src/components/calendar/*`)**:
  - **Sidebar Widget Kiri (`CalendarSidebar.tsx`)**:
    - **`MiniMonthCalendar.tsx`**: Widget mini kalender bulanan bernuansa dark modern (`#111b21`) dengan navigasi bulan, penanda titik tanggal yang memiliki jadwal reservasi, dan seleksi tanggal aktif yang sinkron dengan tampilan kalender utama.
    - **`UpcomingSpotlightCard.tsx`**: Kartu sorotan jadwal terdekat dengan waktu kunjungan (`12:00 - 13:30`), nama pasien, jenis layanan, tombol aksi cepat *Lihat Detail*, dan direct link WhatsApp pasien.
    - **Filter Kategori & Terapis**: Filter visual berbasis warna kategori (Baby: Sky Blue, Moms: Purple, Kids/Both: Emerald, Bundles: Amber) lengkap dengan counter jumlah janji temu aktif, filter terapis/staf, dan status.
  - **Main Calendar Canvas & View Switcher (`WeekScheduleGrid.tsx`, `DayScheduleGrid.tsx`, `MonthScheduleGrid.tsx`)**:
    - Header dinamis menampilkan Nama Bulan & Tahun (misal: *Agustus 2026*), tombol navigasi `<` (Sebelumnya), `Hari Ini` (Today), dan `>` (Berikutnya).
    - Switcher tampilan 4 mode fleksibel: **[ Bulan | Minggu | Hari | Tabel ]**.
    - **Week Schedule Grid (06:00 s.d. 21:00)**: Header 7 kolom hari diawali dari **Senin s.d. Minggu** dengan angka tanggal besar (hari ini / hari aktif disorot dengan badge kontras tinggi), kartu event pastel yang rapi dengan info pasien, treatment, rentang waktu, badge terapis, dan status pembayaran.
    - **Interactive Hover Slot Add (`+`)**: Mengklik slot jam kosong pada kalender mingguan atau harian akan langsung membuka modal *Buat Jadwal Baru* dengan tanggal & jam mulai yang otomatis terisi.
    - **Day Schedule Grid**: Tampilan detail jam per jam untuk 1 hari fokus dengan info kontak, alamat lengkap, dan jarak/ongkir.
    - **Month Schedule Grid**: Grid kalender 35/42 hari dengan tag janji temu per tanggal.
  - **Penyederhanaan Navigasi Sidebar (`Layout.tsx`)**: Menghapus item menu `Delivery Fee` dari sidebar utama karena pengaturan tarif ongkir sudah terintegrasi pada halaman operasional terkait.
- **Searchable Service Catalog Dropdown & Form Buat Jadwal Baru Lengkap (`packages/admin-dashboard/src/components/calendar/CreateReservationModal.tsx`)**:
  - **Searchable Service Dropdown (Dropdown Layanan Terpadu)**:
    - Terintegrasi secara live dengan katalog layanan klinik (`/api/admin/services`).
    - Input pencarian cepat dengan filter nama layanan, kategori, atau keyword.
    - Menampilkan nama paket, badge kategori, durasi (menit), dan harga paket.
    - Memilih layanan akan **otomatis mengisi kategori perawatan, nama treatment, dan mengkalkulasi estimasi jam selesai** berdasarkan durasi layanan (misal: booking jam 09:00 + durasi 60m → jam selesai 10:00).
    - Opsi toggle input kustom / manual jika layanan belum ada di katalog.
  - **Pencarian Customer & Quick Child Selector Chips**:
    - Pencarian customer live dari database (`/api/admin/customers`).
    - Menampilkan data alamat, jarak km, dan daftar anak/bayi yang sudah terdaftar sebagai chips yang bisa dipilih dalam 1-klik, serta opsi input bayi/anak baru.
  - **Penugasan Terapis, Status & Catatan Khusus**:
    - Dropdown pemilihan bidan terapis aktif (`/api/admin/staff`).
    - Pemilihan status (*Pending / Confirmed*) dan kolom catatan keluhan/permintaan khusus pasien.
- **Backend API & Test Enhancements (`src/routes/admin/reservations.subroute.ts`, `tests/unit/admin-create-reservation.test.ts`)**:
  - Endpoint `POST /api/admin/reservation` diperkaya untuk mendukung field `assignedStaffId`, `status`, `notes`, serta pemetaan kategori `KIDS` ke `BABY` dan `BUNDLE` ke `BOTH` pada enum Prisma.
  - Unit test `tests/unit/admin-create-reservation.test.ts` diperbarui dan berhasil lolos 100%.

### Fixed — Route Mappings & Canonical Path Alignment in Admin Dashboard

- **Penyelarasan Path Rute Frontend (`packages/admin-dashboard/src/App.tsx`)**:
  - Memperbaiki ketidaksesuaian path rute antara `Layout.tsx`, `rolePermissions.ts`, dan `App.tsx`:
    - `/admin/customer-service` (Customer Service & CTA)
    - `/admin/staff-management` (Staff & Terapis)
    - `/admin/delivery` (Delivery Fee / Tiers)
    - `/admin/follow-up-templates` (Follow-Up Templates)
    - `/admin/knowledge-base` (Knowledge Base)
    - `/admin/ai-evaluations` (AI Quality Evaluation)
    - `/admin/meta-click-catcher` (Meta Click Catcher)
    - `/admin/meta-capi-queue` (Meta CAPI Queue)
  - Menghapus duplikasi path `/admin/staff` yang sebelumnya menabrak rute staff today.
  - Menambahkan dukungan alias URL pendek (`/admin/cs`, `/admin/staff`, `/admin/tiers`, `/admin/knowledge`, `/admin/evaluations`, `/admin/meta-clicks`, `/admin/meta-capi`, `/admin/followup-templates`) yang otomatis mengarah ke rute kanonikal masing-masing secara mulus.

### Added — Full Admin Dashboard UI Overhaul to WhatsApp Web Light & Clean Emerald Aesthetic

- **Design System & Global CSS Tokens Migration (`packages/admin-dashboard/src/index.css`, `packages/admin-dashboard/src/components/common/Layout.tsx`, `packages/admin-dashboard/src/App.tsx`)**:
  - Merombak total seluruh desain antarmuka Super Admin & Tenant Dashboard dari nuansa gelap-pink (`slate-950`, `pink-500`, `glass-card`) menjadi desain elegan, bersih, dan berstandar **WhatsApp Web Light / Clean Emerald**:
    - Background Canvas: `#f0f2f5` (WhatsApp Web light gray canvas).
    - Surface & Cards: Putih bersih `#ffffff` dengan border halus `#e9edef`, bayangan natural `shadow-xs`, dan sudut membulat `rounded-2xl`.
    - Typography: Teks dengan kontras tinggi `#111b21`, teks sekunder/label `#667781` / `#54656f`, dan font sistem modern.
    - Brand Primary Color: `#008069` (Official WhatsApp Emerald) dengan hover state `#00a884` dan active state `#006d59`.
    - Sidebar Navigation: Background putih bersih dengan border kanan `#e9edef`, item aktif dengan latar emerald lembut `bg-[#e8f5f2] border-l-4 border-[#008069] text-[#008069] font-bold`, serta header profil tenant yang bersih.
    - Feedback & Utilities: Pagination, alert banners, toasts, and confirm dialogs migrated to crisp light components.
- **Halaman Operasional, Manajemen, AI & Marketing Dimigrasikan**:
  - `Login.tsx` & `StaffLogin.tsx`: Login card putih bersih dengan input ber-border `#d1d7db` dan tombol login emerald `#008069`.
  - `Overview.tsx`: Stat KPI cards, charts container, quick action buttons, dan reservasi harian dengan visual WhatsApp Web light.
  - `CustomerDatabase.tsx`: Tabel data pelanggan, badge VIP/MQL/Lead, filter pencarian, pagination, dan modal detail/edit pelanggan.
  - `Reservations.tsx`: Kalender/tabel janji temu, modal buat janji baru, badge status perawatan, dan kalkulator rincian biaya.
  - `StaffManagement.tsx`: Grid kartu staf & bidan terapis, badge role, modal tambah/edit staf, dan pengaturan jadwal kerja.
  - `ClinicServices.tsx`: Katalog layanan perawatan moms & baby, editor paket, harga, durasi, dan toggle aktif/nonaktif.
  - `DeliveryTiers.tsx`: Editor tabel tarif ongkir per radius kilometer dan potongan promo.
  - `FollowUpQueue.tsx`: Antrean pesan follow-up otomatis, badge status pengiriman, dan tombol trigger manual.
  - `FollowUpTemplates.tsx`: Editor template pesan follow-up dan template perjalanan terapis (`STAFF_OTW`).
  - `KnowledgeBase.tsx`: Manajemen artikel FAQ klinis & prosedur, editor teks, dan status embedding AI.
  - `AiPersona.tsx`: Konfigurasi nama bot, brand klinik, tone of voice, dan instruksi sistem bot AI.
  - `AiSandbox.tsx`: Simulator percakapan AI interaktif berlatar wallpaper chat WhatsApp `#efeae2` dengan bubble chat dua arah.
  - `AiEvaluations.tsx`: Tabel audit evaluasi respons AI router, skor akurasi, dan perbandingan intent.
  - `Settings.tsx` & Semua Sub-Panel (`WhatsAppProviderPanel.tsx`, `AiRouterPanel.tsx`, `MetaCapiPanel.tsx`, `PricelistImagePanel.tsx`, `MqlSettingsPanel.tsx`, `DailyReportPanel.tsx`, `InstallAppPanel.tsx`):
    - Tampilan pairing QR code WhatsApp, kredensial WAHA/WABA, AI Router switchboard, Meta CAPI token inputs, Telegram Daily Report, dan petunjuk install PWA.
  - `CustomerService.tsx`: Form pengaturan kontak WhatsApp CS dan generator CTA Link tracking.
  - `LandingPage.tsx` & `ExternalIntegrationModal.tsx`: Editor landing page kustom/template bawaan dan panduan embed script pelacakan.
  - `MetaClickCatcher.tsx` & `MetaCapiQueue.tsx`: Monitoring klik iklan Meta, atribusi konversi chat WhatsApp, dan antrean event Purchase CAPI.
  - `ChatExport.tsx` & `Debug.tsx`: Alat ekspor transkrip chat untuk evaluasi AI serta observability log & circuit breaker.

### Added — Tarik & Hapus Pesan WhatsApp untuk Semua Orang (Delete for Everyone / Revoke) & WABA Compatibility Guard

- **Gateway Abstraction Revoke Support (`src/integrations/whatsapp/gateway.types.ts`, `src/integrations/whatsapp/waha.driver.ts`, `src/integrations/whatsapp/waba.driver.ts`, `src/integrations/waha/client.ts`)**:
  - Menambahkan properti `supportsRevoke: boolean` dan method `deleteMessage(chatId, messageId, everyone = true)` pada interface `WhatsAppGateway`.
  - **WAHA Gateway (`WahaGatewayDriver`)**: Mengeset `supportsRevoke = true` dan mengimplementasikan penghapusan pesan via endpoint WAHA `DELETE /api/{session}/chats/{chatId}/messages/{messageId}?everyone=true` serta fallback `POST /api/messages/delete`.
  - **WABA Gateway (`WabaGatewayDriver`)**: Mengeset `supportsRevoke = false` karena Meta Cloud API tidak mengizinkan penarikan pesan dari perangkat customer setelah terkirim.
- **Backend Service & Real-Time Sync (`src/services/message.service.ts`, `src/services/live-chat.service.ts`, `src/services/live-chat-hub.service.ts`)**:
  - `messageService.markMessageDeleted(messageId, tenantId)`: Memperbarui konten pesan di database/memory menjadi `🚫 Pesan ini telah ditarik`, menandai `payload_raw.is_revoked = true`, dan mem-publish event `message.updated` ke hub SSE.
  - `liveChatService.revokeMessage({ conversationId, messageId, tenantId, adminName })`: Memvalidasi kepemilikan pesan outbound, memeriksa kapabilitas gateway tenant, menarik pesan di WhatsApp via driver, dan mencatat audit log `REVOKE_MESSAGE`.
  - `liveChatService.getGatewayCapability(tenantId)`: Endpoint untuk mendeteksi kapabilitas gateway tenant aktif (`provider` & `supportsRevoke`).
- **REST Endpoints (`src/routes/admin/livechat.subroute.ts`, `src/routes/staff/today.subroute.ts`)**:
  - `GET /api/admin/gateway-capability` & `GET /api/staff/gateway-capability`: Mengembalikan kapabilitas gateway aktif.
  - `DELETE /api/admin/conversations/:id/messages/:messageId`: Tarik pesan untuk panel Admin Live Chat.
  - `DELETE /api/staff/conversations/:id/messages/:messageId`: Tarik pesan untuk portal Terapis (dengan proteksi `assertConversationOwnedByStaffToday`).
- **Frontend UI & Conditional Guard (`packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx`, `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - **Live Chat Monitor (Admin)** & **Staff Today Portal (Terapis)**:
    - Menampilkan ikon tombol hapus/tarik pesan (`Trash2`) pada bubble chat outbound hanya jika `gatewayCapability.supportsRevoke === true`.
    - **WABA Compatibility Guard**: Jika gateway tenant adalah WABA Meta Cloud API (`supportsRevoke === false`), tombol hapus **TIDAK dirender sama sekali** di UI agar tidak membingungkan pengguna.
    - Integrasi modal konfirmasi elegan via `useUiFeedback` sebelum menarik pesan.
    - Sinkronisasi real-time via SSE: jika pesan ditarik, bubble langsung terupdate dengan teks miring `🚫 Pesan ini telah ditarik`.

### Added — WhatsApp Aesthetic Overhaul for Therapist Portal & Staff Management Actions

- **Desain & UI WhatsApp Web Light Official Tokens (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`, `design.md`)**:
  - Redesign antarmuka portal chat terapis persis dengan tampilan WhatsApp Web Light resmi:
    - App Header & Bar: `#f0f2f5` dengan teks `#111b21`.
    - Canvas Wallpaper Chat: `#efeae2` (warm beige wallpaper dengan pola micro-dot).
    - Bubble Chat Inbound (Customer): `#ffffff` putih bersih dengan teks `#111b21` dan rounded-tl-none.
    - Bubble Chat Outbound (Terapis/Staff): `#d9fdd3` (WhatsApp soft mint green) dengan centang ganda biru (`#53bdeb`).
    - Bubble Chat Bot AI: `#ffffff` dengan aksen border hijau `#008069`.
    - Input Bar WhatsApp: Input teks `#ffffff` dengan tombol emoji, lampiran, dan tombol kirim `#008069`.
    - Quick Template Chips di atas input chat: `"📍 Sudah sampai di depan"` dan `"❤️ Ucapan selesai perawatan"`.
  - Menghapus label tagih/lunas yang menumpuk agar antarmuka kartu tugas lebih bersih dan fokus.
  - Mengganti tombol "Salin Info" menjadi tombol aksi cepat **"Infokan OTW"** (`Navigation2`) yang otomatis mengirimkan pesan konfirmasi perjalanan ke WhatsApp pasien dalam 1 klik.
  - Menghilangkan seluruh karakter em-dash (`—`) pada UI sesuai pedoman anti-slop `design.md`.
  - Menggunakan viewport stability `min-h-[100dvh]` untuk kenyamanan akses di browser mobile dan desktop.
- **Automatic Therapist Identity Signature (`src/routes/staff/today.subroute.ts`, `src/services/staff-reservation.service.ts`, `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menyisipkan tanda tangan identitas nama bidan terapis secara otomatis di baris paling bawah setiap pesan balasan lapangan (`\n\n~ [Nama Bidan]`).
  - Menghindari duplikasi jika pesan sudah mengandung tanda tangan.
  - Menampilkan badge indikator identitas pengirim di bawah kotak input chat portal terapis agar terapis mengetahui format pesan keluar.
- **Customizable OTW Template & Super Admin Editor (`src/config/followup-templates.ts`, `src/services/staff-reservation.service.ts`, `packages/admin-dashboard/src/pages/tenant/FollowUpTemplates.tsx`)**:
  - Menambahkan tipe template `STAFF_OTW` ke daftar template follow-up yang dapat diedit langsung oleh Super Admin.
  - Mendukung variabel dinamis `{patientName}`, `{therapistName}`, dan `{clinicName}` dengan fallback teks default bawaan.
  - Endpoint `GET /api/staff/otw-template` untuk merender template aktif sesuai pasien & staf yang bertugas.
- **Modern UI Feedback Modal Kit (`packages/admin-dashboard/src/components/common/UiFeedback.tsx`)**:
  - Merombak total tampilan modal konfirmasi dialog dan toast notifikasi:
  - Menghilangkan nuansa gelap/pink (`slate-950` / `pink-500`) dan menggantinya dengan tema elegan WhatsApp Light / Clean Emerald (`bg-white`, teks `#111b21`, aksen hijau `#008069`, dan backdrop bersih).
- **Mekanisme Pembayaran Lapangan & Upload Bukti Transaksi Ringan (`src/routes/staff/today.subroute.ts`, `src/services/staff-reservation.service.ts`, `packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menambahkan tombol **"Catat Bayar"** dan modal pembayaran interaktif untuk terapis:
    - Pilihan metode: **Tunai (Cash)** vs **Non-Tunai (Transfer / QRIS)**.
    - Upload foto bukti transfer/QRIS dengan kompresi otomatis di sisi browser (HTML5 Canvas maks 800px, JPEG 0.65, ~50 KB bukan HD untuk menghemat kapasitas storage server).
    - Endpoint `POST /api/staff/reservations/:id/payment` yang memperbarui status transaksi menjadi lunas, mencatat bukti pembayaran, dan mengirimkan pesan konfirmasi/struk resmi ke chat customer secara otomatis.
- **Penyatuan Portal Terapis Menjadi 2 Tab Interaktif (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menggabungkan tampilan **Tugas & Chat Hari Ini** dan **Jadwal Mendatang** dalam 2 Tab di halaman yang sama (`/admin/staff/today`).
  - Memungkinkan terapis beralih antara memproses kunjungan hari ini dan mengecek jadwal besok/lusa secara cepat tanpa reload halaman.

### Added — Unified Login & Role-Based Access Control (RBAC) Multirole

- **Database Model & Migrations (`prisma/schema.prisma`, `prisma/migrations/20260831000000_add_rbac_roles`)**:
  - Memperluas enum `StaffRole` dengan role baru: `ADMIN_CS` dan `ADVERTISER` (selain `THERAPIST`).
- **Backend Unified Login 2-Tahap (`src/routes/admin/auth.subroute.ts`, `src/routes/admin.route.ts`)**:
  - `POST /api/admin/auth/login`: Satu pintu login untuk semua peran. Menerima `identifier` (Email atau No. WhatsApp) + `password`.
  - Tahap A: Jika password cocok dengan `ADMIN_API_KEY`, terbitkan `admin_session` cookie dan kembalikan role `super_admin` dengan auto-redirect `/admin/overview`.
  - Tahap B: Jika identifier cocok dengan nomor telepon di tabel `staff` (terapis, admin CS, atau advertiser) dan lolos verifikasi bcrypt password, terbitkan `staff_session` cookie dan kembalikan role serta auto-redirect yang sesuai (`/admin/staff/today` untuk `therapist`, `/admin/overview` untuk `admin_cs` dan `advertiser`).
  - `GET /api/admin/auth/me`: Menyelesaikan sesi aktif baik dari cookie `admin_session` maupun `staff_session`.
  - `POST /api/admin/auth/logout`: Membersihkan sesi dan cookie `admin_session` serta `staff_session` secara bersamaan.
  - Middleware `admin.route.ts` preHandler: Mengizinkan cookie `staff_session` untuk peran `ADMIN_CS` dan `ADVERTISER` mengakses endpoint manajemen admin.
- **Frontend Single Source of Truth RBAC Config (`packages/admin-dashboard/src/config/rolePermissions.ts`)**:
  - Definisi peran `AppRole` (`super_admin`, `tenant_admin`, `admin_cs`, `advertiser`, `therapist`).
  - Matriks akses menu `ROLE_MENU_ACCESS` dan helper `hasAccess(role, path)` serta `getDefaultRedirect(role)`.
- **Frontend Unified UI & Dynamic Navigation (`packages/admin-dashboard`)**:
  - `Login.tsx`: Form login universal menerima Email Admin atau No. WhatsApp Staff, melakukan auto-redirect dinamis berdasarkan role yang dikembalikan server.
  - `Layout.tsx`: Menyaring menu sidebar admin secara dinamis sesuai role pengguna yang login, menampilkan nama & role badge di footer sidebar.
  - `ProtectedRoute.tsx`: Route guard memeriksa izin akses path per-role berdasarkan matriks RBAC dan redirect ke `/admin/unauthorized` jika tidak diizinkan.
  - `App.tsx`: Mengalihkan rute lama `/admin/staff/login` ke `/admin/login`, menambahkan alias rute `/staff`, `/terapis`, dan `/chat` ke portal terapis.
  - `StaffManagement.tsx`: Menambahkan opsi pemilihan peran (`THERAPIST`, `ADMIN_CS`, `ADVERTISER`) saat membuat akun staff baru.

### Added — Enriched Therapist Portal (Alamat Lengkap, Anak, Harga, & Navigasi Turn-by-Turn)

- **Backend Enriched Task Query (`src/services/staff-reservation.service.ts`)**:
  - Memperkaya interface `StaffTaskItem` dengan:
    - `address`: Kelurahan, Kecamatan, Kota, Jarak dari klinik dalam km, dan `fullText`.
    - `children`: Daftar nama anak/bayi dan usia saat ini (`rawAgeText`).
    - `pricing`: Rincian biaya treatment, ongkir, `totalFee`, dan status pembayaran (`LUNAS` jika ada `purchase_occurred_at`, atau `TAGIH_DI_TEMPAT`).
    - `navigationUrl`: Link navigasi turn-by-turn Google Maps (`https://www.google.com/maps/dir/?api=1&destination=lat,lng&travelmode=driving`).
    - `shareLocationText`: Teks format ringkas informasi kunjungan siap salin/share ke WhatsApp.
- **Frontend Mobile-First Task Card & Header (`packages/admin-dashboard/src/pages/staff/StaffToday.tsx`)**:
  - Menampilkan alamat lengkap dan badge jarak (mis. *2.5 km* dari klinik) pada setiap kartu tugas.
  - Menampilkan badge nama & usia anak (mis. *👶 Kenzo (6 bulan)*).
  - Menampilkan kotak breakdown biaya: Biaya Treatment + Ongkir = **Total Tagihan** serta badge status pembayaran (Lunas vs Tagih di Tempat).
  - Tombol aksi cepat: **Navigasi** (membuka navigasi rute Google Maps langsung) dan **Salin Info** (menyalin ringkasan tugas ke clipboard dengan feedback visual).
  - Integrasi preview media/gambar pada thread chat live dengan prop `MediaImage` yang aman.
- **Unit & Integration Tests (`tests/unit/unified-login.test.ts`, `tests/unit/role-permissions.test.ts`, `tests/unit/staff-auth-and-reservation.test.ts`)**:
  - 41/41 unit & integration test untuk seluruh flow auth, staff, RBAC, dan reservation query lulus 100%.

- **Database Model & Migrations (`prisma/schema.prisma`, `prisma/migrations/20260830000000_add_staff_access`)**:
  - Menambahkan enum `StaffRole { THERAPIST }`.
  - Menambahkan model `Staff` (`id`, `tenant_id`, `name`, `phone`, `password_hash`, `role`, `active`, `created_at`, `updated_at`) dengan index `[tenant_id, phone]`.
  - Menambahkan model `StaffSession` (`id`, `staff_id`, `token_hash`, `expires_at`, `created_at`) dengan TTL 12 jam dan index `[token_hash]`, `[staff_id]`, `[expires_at]`.
  - Menambahkan field relasi `assigned_staff_id` dan `assigned_staff Staff?` pada model `Reservation` dengan index `[assigned_staff_id]`.
- **Backend Service Layer (`src/utils/bcrypt.ts`, `src/services/staff-auth.service.ts`, `src/services/staff-reservation.service.ts`)**:
  - `bcrypt.ts`: wrapper hashing password dengan bcrypt salt rounds 12.
  - `StaffAuthService`: login dengan rate limit dan database-backed session token SHA-256, validasi sesi, logout, dan pencabutan sesi massal (`revokeAllSessions`).
  - `StaffReservationService`: query jadwal tugas harian terapis (`getTodayTasks`) dengan privasi masking nomor telepon pelanggan di level DB query, serta guard validasi kepemilikan percakapan (`assertConversationOwnedByStaffToday`).
  - Unit tests: `tests/unit/staff-auth-and-reservation.test.ts` (10/10 PASS).
- **Backend Routes & SSE Stream (`src/routes/staff.route.ts`, `src/routes/staff/auth.subroute.ts`, `src/routes/staff/today.subroute.ts`)**:
  - Endpoint auth staff: `POST /api/staff/auth/login` (rate limit 5 req/min), `POST /api/staff/auth/logout`, `GET /api/staff/auth/me`.
  - Endpoint portal staff: `GET /api/staff/today-tasks`, `GET /api/staff/conversations/:id/messages` (ownership-guarded), `POST /api/staff/conversations/:id/reply` (mengirim via gateway bot official tenant dengan audit logging identitas staff).
  - Endpoint SSE real-time: `GET /api/staff/live-chat/events` dengan filter server-side agar terapis hanya menerima event dari customer yang ditugaskan hari ini.
  - Integration tests: `tests/integration/staff-routes.test.ts` (11/11 PASS).
- **Admin Staff Management & Reservation Assignment API (`src/routes/admin/staff-management.subroute.ts`, `src/routes/admin/reservations.subroute.ts`)**:
  - CRUD Akun Staff: `GET /api/admin/staff`, `POST /api/admin/staff` (auto bcrypt), `PATCH /api/admin/staff/:id` (toggle status aktif / reset password dengan auto revocation sesi).
  - Penugasan Reservasi: `PATCH /api/admin/reservation/:id/assign-staff` dengan audit logging admin.
  - Integration tests: `tests/integration/admin-staff-management.test.ts` (6/6 PASS).
- **Frontend Staff Portal & Auth UI (`packages/admin-dashboard`)**:
  - `StaffAuthContext.tsx`: React Context terisolasi untuk autentikasi staff (cookie `staff_session`).
  - `StaffProtectedRoute.tsx`: Route guard untuk mengarahkan pengguna yang belum login ke portal staff.
  - `StaffLogin.tsx`: Halaman login mobile-first terapis bertema teal modern.
  - `StaffToday.tsx`: Portal tugas lapangan & Live Chat terapis dengan:
    - Ringkasan tugas harian (nama pasien, jam, jenis treatment).
    - Tombol petunjuk arah "Google Maps" langsung (`mapsUrl`).
    - Live Chat real-time via SSE `/api/staff/live-chat/events` dengan notifikasi audio beep Web Audio API & native browser notification.
    - Pengiriman balasan aman via gateway bot klinik dengan touch target ramah mobile (>= 44x44px).
- **Frontend Admin UI Staff Management & Assignment (`packages/admin-dashboard`)**:
  - `StaffManagement.tsx`: Halaman admin untuk mengelola staff, modal tambah staff, reset password, dan toggle nonaktif akun dengan modal konfirmasi `useUiFeedback`.
  - `Reservations.tsx`: Dropdown penugasan terapis di modal detail reservasi dan badge nama terapis di tabel list & card mobile.
  - `App.tsx`: Rute `/admin/staff/login`, `/admin/staff/today`, `/admin/staff-management`.
  - `Layout.tsx`: Menu navigasi "Staff & Terapis" di sidebar admin.

### Fixed — Fase 8: Anti Hard-Selling FAQ, Batch Follow-Up & Media Webhook (Phase 1-4 hardening)

- **Add Surabaya & Sidoarjo Major Apartments & Landmarks Geocoding Map & Set Haversine Circuity Factor to 1.60x (`src/config/landmarks.ts`, `src/integrations/google-maps/geocoding.ts`, `src/services/delivery.service.ts`, `.env`)**:
  - Menambahkan kamus pemetaan cepat untuk 30+ apartemen, mall, dan landmark besar di Surabaya & Sidoarjo (*CitraLand Vittorio, Gunawangsa Tidar/Manyar/MERR, Anderson Tower / Benson / Orchard / Tanglin / Pakuwon Mall, Klaska Residence, Grand Sungkono Lagoon, Grand Dharmahusada Lagoon, The Rosebay Graha Famili, Grand Shamaya, Apartemen Taman Melati, Kyo Society, One Icon Residence, Waterplace / Ascott, Taman Beverly, The Galaxy Residences, Metropolis Apartemen, Pavilion Permata, Puri Darmo, Puncak Kertajaya/Marina/Permai, CITO, Banjarmukti, Safira Garden, CitraGarden, Kahuripan Nirwana, Prospero, dll.*).
  - Mengupdate formula fallback pengali kelokan jarak *Haversine* (`HAVERSINE_CIRCUITY_FACTOR`) menjadi **1.60x** agar estimasi jarak tempuh perkotaan selaras dan akurat dengan rute jalan nyata berkendara (*OpenRouteService / Google Maps*).
  - Penambahan unit test `tests/unit/surabaya-apartments-geocoding.test.ts` (20/20 PASS).
- **Add Religious Neutrality & Mandatory Waalaikumsalam Response Prefix (`src/state-machine/utils/islamic-greeting-helper.ts`, `machine.ts`, `greeting.ts`, `persona.ts`)**:
  - Menghilangkan/mengurangi kata keagamaan seperti *"Alhamdulillah"* dari percakapan normal demi netralitas agama pelanggan yang majemuk.
  - Menambahkan deteksi sapaan Islami (`hasIslamicGreeting`, mis. *"assalamualaikum"*, *"assalamu'alaikum wr wb"*, *"ass"*, *"aslm"*, *"mikum"*).
  - Mengimplementasikan aturan **WAJIB menjawab "Waalaikumsalam Bunda"** di awal respon sebelum melanjutkan pesan / jawaban apa pun jika customer menyapa dengan Assalamualaikum.
  - Penambahan unit test `tests/unit/islamic-greeting-response.test.ts` (5/5 PASS).
- **Fix General Age Treatment Recommendation ("Untuk anak umur 17 bulan yg mana yaa") (`src/services/treatment-catalog.service.ts`, `src/state-machine/handlers/interest.ts`, `src/integrations/llm/generator.ts`)**:
  - Memperbaiki perilaku di mana customer yang hanya menanyakan rekomendasi treatment berdasarkan usia secara umum (tanpa keluhan sakit) keliru ditawari paket terapi penyakit (seperti *Pijat Pulih Ceria*, *Nebulizer*, *Sinar Moksa*).
  - Menambahkan filter `onlyGeneral` pada `getServicesByAge` jika pesan tidak mengandung keluhan medis / gejala sakit (`checkMedicalKeywords`), menyaring hanya treatment relaksasi & kebugaran standar (*Pijat Bayi Ceria*, *Pijat Kids Ceria*, *Pijat Lahap Juara*).
  - Menambahkan aturan prompt rule 9 pada AI Generator untuk mengarahkan pertanyaan usia umum ke treatment relaksasi/wellness dan melarang penawaran terapi sakit/nebulizer tanpa adanya keluhan dari customer.
  - Penambahan unit test `tests/unit/general-age-treatment-recommendation.test.ts` (3/3 PASS).
- **Upgrade POI & Housing Complex Geocoding Intelligence ("Banjarmukti Residence Sidoarjo") (`src/integrations/google-maps/geocoding.ts`)**:
  - Memperbaiki kelemahan di mana nama perumahan/POI spesifik (seperti *"banjarmukti Residence"*, *"safira garden"*, *"citragarden"*, *"puri surya jaya"*) yang dikirim bersama nama kota *"sidoarjo"* keliru dibajak oleh gate kecamatan sebagai input "hanya kecamatan", sehingga bot keliru menanyakan daftar kelurahan di Kecamatan Sidoarjo (Suko, Pekauman, Sidoklumpuk).
  - Menambahkan deteksi token perumahan/kompleks (`residence`, `regency`, `cluster`, `villa`, `apartemen`, `townhouse`, `mansion`, `estate`, `griya`, `graha`, dll.) dan token nama tempat bermakna (mis. `banjarmukti`). Sistem sekarang meneruskan nama perumahan ke pipeline Geocoding / LLM resolver sehingga berhasil dipetakan ke kelurahan presisi (**Kelurahan Banjarkemantren, Kec. Buduran, Sidoarjo**).
  - Penambahan unit test `tests/unit/poi-housing-geocoding.test.ts` (2/2 PASS) dan update few-shot prompt LLM geocoder.
- **Fix Clinic Location / Midwife Origin Inquiry ("Kalo boleh tau kakaknya darimana kak?") (`src/state-machine/utils/clinic-location-checker.ts`, `interest.ts`, `location.ts`, `generator.ts`, `nlu-classifier.service.ts`)**:
  - Memperbaiki bug di mana customer yang menanyakan lokasi klinik/asal bidan (e.g. *"Saya dari surabaya timur kak. Kalo boleh tau kakaknya darimana kak?"*) keliru dibalas dengan template penutup reservasi (*"Apakah Bunda tertarik untuk lanjut mengisi list reservasi..."*) alih-alih menjawab lokasi klinik.
  - Menambahkan detector `isAskingClinicLocation`, menyelaraskan intent `faq_question` pada NLU & question override guard di `interest.ts` & `location.ts`, serta menginjeksi FAQ lokasi fisik resmi: *"Kami berlokasi di daerah Waru (perbatasan Sidoarjo - Surabaya). Kami melayani sistem Homecare (panggilan langsung ke rumah), jadi tim bidan kami yang datang langsung ke rumah Bunda di area Surabaya & Sidoarjo"*.
  - Penambahan unit test `tests/unit/clinic-location-question.test.ts` (2/2 PASS) dan update integration suite `tests/integration/all-reported-user-scenarios.test.ts` (7/7 PASS).
- **Add Hold & Family Discussion Intent Handler ("Oke sbntr sy coba tnykan ya") (`src/state-machine/utils/need-time-checker.ts`, `location.ts`, `interest.ts`, `location-confirmation.ts`, `phrasing.service.ts`)**:
  - Menambahkan deteksi intensi jeda waktu dan diskusi keluarga (*need time / hold discussion*, e.g. *"Oke sbntr sy coba tnykan ya"*, *"tanya suami dulu ya"*, *"rembukan dulu"*, *"nanti saya kabari lagi"*, *"pikir2 dulu ya"*).
  - Ketika customer meminta waktu untuk berdiskusi, bot tidak lagi mendesak atau menagih ulang pertanyaan lokasi/ongkir/harga, melainkan membalas dengan hangat dan sabar: *"Baik Bunda, kami tunggu kabarnya ya bund 🤗 Santai saja yaa, nanti kalau sudah siap atau ada yang ingin ditanyakan lagi, langsung kabari kami kembali ya Bunda 😊🙏🏻"*.
  - Penambahan unit test `tests/unit/need-time-discussion.test.ts` (2/2 PASS) dan update integration suite `tests/integration/all-reported-user-scenarios.test.ts` (6/6 PASS).
- **Fix LLM Phrasing Translation Hallucination ("antimeminjamkannya") (`src/utils/language-sanitizer.ts` & `src/integrations/llm/phrasing.service.ts`)**:
  - Memperbaiki bug di mana Phrasing LLM saat memvariasikan template tanya kelurahan/lokasi menghalusinasikan kata *"ongkir"* menjadi istilah terjemahan aneh: *"biaya antimeminjamkannya"*.
  - Menambahkan fungsi `sanitizeHallucinatedTerms` pada `language-sanitizer.ts` dan constraint ketat pada `PhrasingService` untuk intent `ask_kelurahan_detail` & `ask_location` agar selalu mempertahankan istilah resmi (*"ongkir"* / *"ongkos kirim"*), serta otomatis membersihkan istilah terjemahan janggal.
- **Activate AI Router (Shadow Mode OFF) (`.env` & `src/config/ai-router-config.ts`)**:
  - Mengubah konfigurasi AI Router dari mode pengamat (*shadow mode*) menjadi mode aktif penuh (`AI_ROUTER_ENABLED=true`, `AI_ROUTER_SHADOW_MODE=false`).
  - Penambahan comprehensive integration test `tests/integration/all-reported-user-scenarios.test.ts` (5/5 PASS) untuk memvalidasi seluruh skenario percakapan nyata.
- **Fix Symptom & Consultation Inquiries Blocked by Mixed-Signal Regex (`src/state-machine/handlers/interest.ts`)**:
  - Memperbaiki bug di mana customer yang menceritakan kondisi/keluhan bayi dengan kata sambung dan negasi (seperti *"Iya bu bid nafasnya agak grok2 tapi tidak kayak pilek"*) diblokir keliru oleh regex `MIXED-SIGNAL DETECTION` dan dibalas pesan aneh: *"Maaf Bunda, sepertinya ada yang kurang tepat. Bunda ingin mengubah lokasi..."*.
  - Menghapus blok regex `MIXED-SIGNAL DETECTION` yang salah tempat di handler `interest.ts` agar pesan konsultasi medis, gejala si kecil, dan pertanyaan treatment diteruskan secara alami ke RAG & AI Response Generator (Bidan Yusi) dengan empati dan rekomendasi treatment yang tepat (seperti terapi nebulizer / pijat flu-batuk).
- **Increase AI Sandbox Simulator Timeout (`packages/admin-dashboard/src/pages/tenant/AiSandbox.tsx`)**:
  - Memperbaiki error `Error calling AI Generator: Koneksi server/database lambat (Timeout 45s)` pada AI Sandbox Simulator di Admin Dashboard.
  - Batas waktu tunggu HTTP fetch pada simulator ditingkatkan dari 45 detik (`45000ms`) menjadi 120 detik (`120000ms`) agar pipeline multi-stage LLM (NLU Classifier + AI Router + Geocoder reasoning + Response Generator) tidak dibatalkan prematur oleh frontend saat provider LLM sedang mengalami antrean lambat.
- **Fix Location Confirmation False Affirmation & Override Detection (`src/state-machine/handlers/location-confirmation.ts`)**:
  - Memperbaiki bug kritis di mana pesan koreksi alamat (seperti *"alamatnya Rumdis TNI AL Wonosari A132"*) keliru diklasifikasikan sebagai `affirmation` oleh NLU saat bot sedang menanyakan konfirmasi lokasi lama. Akibatnya, sistem sebelumnya keliru mempromosikan lokasi lama (*Pabean, Sedati 3.66 km*) alih-alih memproses alamat baru.
  - Menambahkan guard `isProvidingNewLocation`: jika pesan mengandung intensi atau entitas alamat baru, pesan tersebut **TIDAK AKAN PERNAH** dianggap sebagai afirmasi lokasi lama, melainkan langsung dialihkan (*override redirect*) ke `handleLocationState` untuk resolusi alamat baru.
- **Fix Geocoding Substring Hijacking & Action Prefix Stripping (`src/integrations/google-maps/geocoding.ts` & `src/state-machine/handlers/location.ts`)**: 
  - Memperbaiki bug di mana setiap alamat yang menyertakan nama kota/kabupaten di belakangnya (seperti *"Bungurasih tengah sidoarjo"*, *"Tropodo sidoarjo"*, *"Kutisari surabaya"*) dibajak keliru oleh gate kecamatan karena kata *"sidoarjo"* / *"surabaya"* mencocoki entri *Kecamatan Sidoarjo / Kecamatan Surabaya*. Kini gate memeriksa `hasAnyKelurahanInText` dan `isExactKecamatanName` sehingga jika teks memuat nama kelurahan riil (seperti *Bungurasih* di *Kec. Waru*), sistem langsung meresolusi kelurahan tersebut tanpa membajak ke Kecamatan Sidoarjo kota.
  - Memperbaiki bug di mana kata aksi percakapan di awal kalimat (seperti *"ganti ke..."*, *"ubah ke..."*, *"pindah ke..."*) sebelumnya diteruskan ke fuzzy gazetteer matcher, menyebabkan kata *"ganti"* keliru dicocokkan sebagai typo dari *Kelurahan Ganting (Kec. Gedangan)*. Kini `findBestGazetteerMatch` menggunakan `cleanText` yang telah membersihkan kata aksi percakapan.
  - Memperbaiki gate pencocokan kecamatan yang sebelumnya menggunakan `kecKey.includes(cleanNorm)`, yang menyebabkan nama kelurahan presisi (seperti *"Pabean"* di *Kecamatan Sedati, Sidoarjo*) dibajak keliru menjadi kecamatan luas yang namanya mengandung substring tersebut (*"Kecamatan Pabean Cantian, Surabaya"*).
  - Menambahkan normalisasi spasi pada `crossCheckGazetteer` agar variasi ejaan (seperti *"Bulak Banteng"* vs *"Bulakbanteng"*) dapat langsung terhubung ke koordinat presisi.
  - Memperbaiki `llmResolveLocation` dengan timeout 120s dan integrasi `callChatCompletionsWithFallback` serta penambahan contoh komplek landmark (seperti *"Rumdis TNI AL Wonosari"* -> *Bulakbanteng, Kenjeran*).
  - Penambahan unit test `tests/unit/sedati-pabean-geocoding.test.ts` (5/5 PASS).
- **Guard `treatmentNameForFollowUp` EKSEKUTIF (resolusi docs drift)** (`src/state-machine/handlers/interest.ts`): entri lama di changelog mengklaim guard `treatmentExplicitlyMentioned` sudah ada — ternyata tidak pernah di-implementasi. Kini diimplementasi: nama treatment untuk CTA follow-up HANYA diisi jika pesan customer mengandung **nama full katalog** (exact phrase nama tanpa kurung, lowercase via `getAllServices()`). Match parsial/fuzzy (mis. "pijat bayi" → "Pijat Bayi Ceria") dan entity NLU TIDAK dipakai — pertanyaan edukatif murni ("usia minimal berapa?") tidak lagi memaksa LLM menawarkan paket yang tidak ditanyakan (mis. "Paket Selapan").
- **Test anti-regresi** `tests/unit/faq-no-treatment-leak.test.ts` (baru, 6 kasus): pesan FAQ usia → arg ke-5 `generateFaqResponseWithDetails` undefined; pesan dengan nama FULL ("pijat bayi ceria...", "nebulizer itu buat apa ya?", "pijat lahap juara...") → nama bersih treatment terkirim.
- **Tighten deteksi ask_price** (`src/services/nlu-classifier.service.ts`, `src/state-machine/handlers/greeting.ts`, `src/services/price-answer.service.ts`): "usia berapa boleh pijat?"/"minimal berapa bulan?" bukan pertanyaan harga. Aturan: `berapa` hanya ask_price jika TANPA konteks usia (`usia|umur|minimal|berat|tinggi`); harga eksplisit & nominal `rb/ribu` bebas → harga; nominal bare `k` hanya jika ada kata harga. `isAskPrice` ikut mengecualikan `usia|umur`.
- **Fix regresi dual-intent location** (`src/state-machine/handlers/location.ts`): blok [DUAL INTENT LOCATION+FAQ] kini menghormati `skipFaqIntercept` — query lokasi murni ("Kalau ke wedoro ka ?" — tanda `?` hanya sopan-santun) tidak lagi dibelokkan ke pass kedua `handleInterestState` yang membuang info ongkir ke balasan generik.
- **Batch anti N+1 `checkAndSetLostCustomers`** (`src/services/follow-up.service.ts`): 1 query `reservation.findMany` dengan `created_at > min(sent_at)` menggantikan loop `findFirst` per follow-up; semantik **persis per follow-up** dipertahankan via filter in-memory `created_at > f.sent_at` (keputusan: bukan `thresholdDate`). Test tambahan: customer dengan reservasi setelah `sent_at` TIDAK di-mark lost.
- **Media berat async** (`src/routes/webhook.route.ts`, `src/integrations/waha/types.ts`): image tetap sinkron (Live Chat); video/audio/document kini diunduh **background fire-and-forget** (arsip ke storage, tidak dirender Live Chat, webhook tidak diblok). Tipe `videoMessage`/`audioMessage`/`documentMessage` ditambahkan ke `WahaMessagePayload`.
- **Guard wrapper console** (`src/utils/context.ts`): marker diganti `__contextWrapped` (namespaced) + wrapper mem-chain `.original` yang sudah ada — anti double-wrap/infinite recursion bila dipasang di atas `installLogBuffer` (urutan boot aman di `app.ts`).
- **Fix typo regex** (`src/state-machine/handlers/greeting.ts`): duplikat `jumat|jumat` di `regexHasAskSchedule` dihapus.

### Verifikasi Fase 8

- `npm run build` (tsc) exit 0.
- Vitest: 1274/1275 hijau — sisa kegagalan `tests/integration/bot-toggle-messaging-schema.test.ts` (butuh infra, gagal identik di baseline HEAD).
- Stres 50 sesi `test-50-same-opener.ts` (LLM asli, 2026-08-14): **0 raw JSON leak, 0 harga/promo/Rp di FAQ, 0 hard-sell CTA ("Mau coba..."/"mau treatment"), 0 "Paket Selapan", 0 eskalasi; 49/50 balasan terkirim (98%; 1 silent = pola LLM timeout pra-eksis, sebelumnya 2/10), 49/50 minta lokasi.**

### Fixed — Fase 1: Critical Bug Fixes (AI Chatbot Hardening)

- **FAQ cache poisoning lintas customer** (`src/services/faq-cache.service.ts`, `src/integrations/llm/generator.ts`): cache key kini memasukkan `isLocationKnown` + `additionalContextText` — konteks yang mengubah prompt (CTA "tanya lokasi" vs assumptive-close, fakta ongkir). Customer tanpa lokasi tidak lagi menerima jawaban cached milik customer yang sudah tahu lokasi.
- **Raw JSON leak di Phrasing Service** (`src/integrations/llm/phrasing.service.ts`): saat `JSON.parse` gagal, JSON mentah (`{"message": ...}`) tidak lagi dikirim ke customer — diekstrak via regex, sisanya jatuh ke template statis. Plain text non-JSON tetap dipakai.
- **Guard akses `choices[0].message.content`** (`generator.ts`, `intent.ts`, `phrasing.service.ts`): optional chaining + guard response kosong → masuk jalur fallback (soft-fallback / rule-based / template), tidak lagi `TypeError`.

### Fixed — Fase 2: Medical Detection Consolidation

- **Satu sumber keyword medis**: array ad-hoc di `src/integrations/llm/intent.ts` & `src/services/nlu-classifier.service.ts` dihapus — semua arah ke `checkMedicalKeywords` (config single source).
- **Word-boundary matching** (`src/config/medical-keywords.ts`): keyword pendek (≤6 huruf) dipakai dengan boundary + pengecualian frasa ("step by step") — "kaku" tidak match "kakun", "kuning" tidak match "kuningan".

### Added — Fase 3: LLM Gateway Abstraction

- **Helper terpusat** `src/integrations/llm/llm-gateway.ts`: `getLlmEndpointConfig` (resolve apiKey/baseUrl/model/timeout) + `callChatWithRetry` (retry/backoff transient) + re-export `extractJsonContent`. Menghilangkan getter `apiKey`/`baseUrl` duplikat di ai-router, intent, generator, phrasing, nlu-classifier, llm-evaluator.
- **Transient retry di `model-fallback.ts`**: 429/5xx/timeout pada model primary kini di-retry (default 2×, backoff eksponensial) sebelum masuk fallback chain — tidak lagi sekali gagal = langsung ganti model.
- **JSON extraction terpusat** di ai-router (`extractJsonContent`) — anti duplikasi fence-strip.

### Fixed — Fase 4: Tenant-Aware Model Registry

- **Registry per-tenant** (`src/config/ai-models.config.ts`): `Map<tenantId, Map<task, config>>` — load tenant B tidak menimpa tenant A; `getModelConfig`/`getAllTaskConfigs`/`updateTaskConfig` menerima `tenantId` (default `DEFAULT_TENANT_ID`).
- **`globalBotActive` per-tenant** via `isBotActive`/`setBotActive` — disable satu tenant tidak memengaruhi tenant lain (caller: `machine.ts`, `settings.subroute.ts`).

### Fixed — Fase 5: Error Handling Hardening

- **Helper `parsePositiveInt`/`parseNonNegativeNumber`** (`src/utils/env-numeric.ts`): fail-closed untuk env numerik (NaN/negatif/nol → fallback default). Diterapkan ke `llm-context`, `ai-router` (timeout), `llm-gateway`, `nlu-classifier`, `follow-up.service`, `llm-evaluator`.
- **Opener-tracker size cap** (`src/integrations/llm/opener-tracker.ts`): cap 500 conversation + evict LRU — tidak unbounded growth.
- **LLM evaluator ikut audit** (`src/services/llm-evaluator.service.ts`): panggilan evaluator kini tercatat di `llm_audit_logs` (task `AI_EVALUATION`), sukses & error.

### Fixed — Fase 6: Router Signal Cleanup

- **Flag eskalasi router di-honor** (`src/state-machine/machine.ts`): selain `UNKNOWN_REPEATED`, kini `MEDICAL_KEYWORD_SUSPECTED` & `SCHEDULE_REQUEST` ikut auto-escalate ke human handling di full mode (shadow mode tetap pasif).
- **Dead state branches** (`src/integrations/llm/ai-router.ts`): branch state yang tidak ada di enum Prisma (`AWAITING_CONFIRMATION`, `AWAITING_RESERVATION_DETAILS`) diganti state asli (`LOCATION_CONFIRMED`, `RESERVATION_SENT`) dengan alias untuk kompatibilitas caller lama.
- **`compareRouterDecisions`** kini membandingkan entity lokasi & treatment — kualitas ekstraksi terlihat di metrik shadow.
- **Bersihkan duplikasi**: duplikat `'baby spa'` dihapus; komentar `RESERVATION_NAME_RE` diperjelas (fallback lowercase sengaja tidak dipakai karena false positive).

### Fixed — Fase 7: Follow-up Engine Fixes

- **Idempotency `createNextTreatmentFollowUps`** (`src/services/follow-up.service.ts`): guard memakai `existing` (status PENDING/QUEUED) — pemanggilan ganda tidak membuat duplikat.
- **Anti-starvation `processDueFollowUps`**: `orderBy` deterministik (`scheduled_at ASC, created_at ASC`) — subset tidak lagi arbitrer per run.

### Verifikasi

- `npm run build` (tsc) exit 0.
- Test unit terkait (Fase 1-7) hijau: faq-cache, phrasing, generator safe-fallback, medical-keywords, model-fallback-chain, qa-nlu-fallback-security, ai-models-tenant, env-numeric, ai-router-engine, follow-up-engine, dan lain-lain.
- Catatan: kegagalan pre-existing di `timer.test.ts`, `waha-label-resilience.test.ts`, `daily-report.test.ts` (timeout) sudah dikonfirmasi identik tanpa perubahan fase ini.

---

## [Unreleased] - 2026-08-13

### Fixed — Sanitasi Teks Meta / Pengantar LLM Phrasing Engine
- **Masalah**: Pada pesan `ongkir_info` atau phrasing tertentu, model LLM terkadang mengikutsertakan teks pengantar meta (seperti *"Siapp, ini pesan variasi untuk ongkir_info dari fakta yang ada:\n\n---\n\n\"Wah dekat banget...\""*) yang ikut terkirim ke WhatsApp pelanggan.
- **Perbaikan**:
  - `src/integrations/llm/phrasing.service.ts`: Menambahkan pembersihan otomatis menggunakan regex untuk membuang teks pengantar meta (`Siapp, ini pesan variasi...`), pemisahr `---`, serta tanda petik pembungkus secara otomatis sebelum balasan dikirimkan.

### Fixed — Resilience LLM Response Generator (Fallback Plain Text Non-JSON)
- **Masalah**: UI hanya bisa mengekspor 1 tanggal sekaligus; user ingin input rentang tanggal (contoh: analisa mingguan) dalam satu file.
- **Perbaikan**:
  - `src/services/chat-export.service.ts`: refactor — `generateDay` + `loadDayData(date)` diekstrak, fungsi baru `generateRange(tenantId, startDate, endDate)` (maks 31 hari, validasi format & urutan tanggal) yang merender SATU file Markdown berisi tabel ringkasan per hari + transkrip blok per hari; `renderConversationBlocks` dipakai bersama oleh `buildDailyChatMarkdown` (output harian identik, unit test tetap hijau).
  - `src/routes/admin/export.subroute.ts`: `GET /api/admin/export/daily-chats` menerima `startDate` & `endDate` opsional (fallback `date`/hari ini tetap jalan); error validasi → HTTP 400 dengan pesan Bahasa Indonesia.
  - `src/services/chat-export.service.ts` `listExports()`: mengenali file rentang `daily-chats-YYYY-MM-DD-to-YYYY-MM-DD.md` (field `rangeEnd`).

### Added — Daily Chat Export: Rentang Tanggal (startDate & endDate)
- **Masalah**: UI hanya bisa mengekspor 1 tanggal sekaligus; user ingin input rentang tanggal (contoh: analisa mingguan) dalam satu file.
- **Perbaikan**:
  - `src/services/chat-export.service.ts`: refactor — `generateDay` + `loadDayData(date)` diekstrak, fungsi baru `generateRange(tenantId, startDate, endDate)` (maks 31 hari, validasi format & urutan tanggal) yang merender SATU file Markdown berisi tabel ringkasan per hari + transkrip blok per hari; `renderConversationBlocks` dipakai bersama oleh `buildDailyChatMarkdown` (output harian identik, unit test tetap hijau).
  - `src/routes/admin/export.subroute.ts`: `GET /api/admin/export/daily-chats` menerima `startDate` & `endDate` opsional (fallback `date`/hari ini tetap jalan); error validasi → HTTP 400 dengan pesan Bahasa Indonesia.
  - `src/services/chat-export.service.ts` `listExports()`: mengenali file rentang `daily-chats-YYYY-MM-DD-to-YYYY-MM-DD.md` (field `rangeEnd`).
  - `packages/admin-dashboard/src/pages/tenant/ChatExport.tsx`: input tanggal tunggal diganti dua input **Dari / Sampai** (max = hari ini), validasi urutan & batas 31 hari, file rentang tampil di daftar dengan label `tgl s/d tgl`.
- **Verifikasi**: `tsc` hijau; dashboard build OK; unit test `chat-export` 18/18 hijau; API live `?startDate=2026-08-10&endDate=2026-08-12` → `daily-chats-2026-08-10-to-2026-08-12.md` (12 percakapan/226 pesan, tabel per hari 4/153, 5/23, 3/50); rentang terbalik (`2026-08-12`→`2026-08-10`) → HTTP 400.
- **Catatan**: mengikuti pola `saveDayExport` (cron), generate manual tidak menulis file ke disk — daftar "File Ekspor Tersimpan" tetap kosong sampai cron diaktifkan.

### Fixed — Daily Chat Export: Feedback "0 Data" yang Menyesatkan
- **Masalah**: User generate export dan mendapat file kosong. Akar: (a) UI default ke tanggal hari ini yang memang belum ada percakapan customer asli, (b) mayoritas trafik adalah data QA/sandbox yang sengaja tidak diekspor — tidak ada penjelasan apa pun, file kosong langsung diunduh.
- **Verifikasi**: Endpoint `/api/admin/export/daily-chats` berfungsi normal — 08-10: 4 percakapan/153 pesan, 08-11: 5/23, 08-12: 3/50; 08-13 (hari ini): 0 percakapan real (valid, belum ada chat asli hari ini).
- **Perbaikan** (`packages/admin-dashboard/src/pages/tenant/ChatExport.tsx`):
  - Saat hasil 0 percakapan → toast penjelasan (bukan unduh file kosong): "tidak ada percakapan customer REAL; data QA/sandbox tidak diekspor; coba tanggal lain".
  - Teks bantuan di bawah input tanggal menyebut eksklusi sandbox (`is_sandbox_test`).
  - Toast sukses kini menampilkan jumlah percakapan & pesan.
- **Catatan**: cron harian (`ENABLE_CHAT_EXPORT_CRON=true` di server) belum diaktifkan → daftar "File Ekspor Tersimpan" kosong.

### Fixed — Dual Intent Handling (FAQ + Lokasi dalam 1 Pesan)
- **Masalah**: Ketika customer mengirimkan pesan yang memuat FAQ medis/treatment SEKALIGUS lokasi rumah (contoh: *"Apakah bisa pijt bapil untk anak usia 2 thn? saya di sawotratap"*), handler `greeting.ts` memotong pesan dan hanya mengirim teks lokasi ke `location.ts`. Selanjutnya `location.ts` mengabaikan FAQ (`skipFaqIntercept = true`) dan hanya fokus menghitung ongkir, sehingga pertanyaan medis customer diabaikan sama sekali.
- **Perbaikan**:
  - `src/state-machine/types.ts`: Menambahkan properti `extractedLocationForGeocode` dan `additionalContextText` pada `StateHandlerContext`.
  - `src/state-machine/handlers/greeting.ts`: Meneruskan `extractedLocationForGeocode` tanpa memotong/mengubah `incomingMessage.text.body` asli.
  - `src/integrations/llm/generator.ts`: Mengizinkan `LLMResponseGenerator` menerima `additionalContextText` (info ongkir) dan menginjeksinya ke system prompt `[INFORMASI TAMBAHAN ONGKIR / LOKASI]`, sehingga LLM secara otomatis menggabungkan jawaban FAQ medis + info ongkir + penutup CTA dalam 1 balasan natural.
  - `src/state-machine/handlers/location.ts` & `src/state-machine/handlers/interest.ts`: Menggabungkan alur kalkulasi ongkir dan jawaban FAQ saat `hasFaqIntent` terdeteksi pada pesan lokasi.

### Fixed — Atribusi Audit LLM (conversation_id & customer_phone) + Analisis Biaya per Bubble
- **Masalah**: 74% call LLM (NLU_ROUTING, NLU_CLASSIFICATION, INTENT_DETECTION — 602/819 baris `llm_audit_logs` 7 hari) tercatat `conversation_id = NULL` dan `customer_phone` palsu (`router-audit`/`nlu-audit`/`intent-audit`), sehingga biaya LLM tidak bisa diatribusikan ke bubble chat — jawaban "1 bubble = berapa call & Rp" tidak bisa dihitung akurat dari log.
- **Perbaikan** (atribusi opsional, backward-compatible):
  - `src/services/nlu-classifier.service.ts` — `classifyMessage(text, history, auditCtx?)` + interface `NluAuditContext`; audit NLU_CLASSIFICATION kini mencatat `conversation_id` & `customer_phone` asli.
  - `src/integrations/llm/ai-router.ts` — `AIRouterInput` + field opsional `conversationId`/`customerPhone`; audit NLU_ROUTING mencatat atribusi.
  - `src/integrations/llm/intent.ts` — `detectIntent(text, auditCtx?)` + interface `IntentAuditContext`; audit INTENT_DETECTION mencatat atribusi.
  - `src/state-machine/machine.ts` & `src/state-machine/handlers/interest.ts` — call-site meneruskan `conversation.id` & `customer.phone`.
- **Script analisis baru** `scripts/bubble-llm-cost-analysis.ts`: attach call LLM ke bubble OUTBOUND (window 120 detik, per-conversation; call tanpa `conversation_id` di-attach approximate global) → rata-rata call/bubble, Rp/bubble (real vs sandbox), top-10 termahal → konsol + `test-results/bubble-llm-cost-<ts>.md`.
- **Hasil 7 hari (2026-08-06 s/d 13)**: 373 bubble = 713 call (1,91 call/bubble) = Rp 3.344,98 (Rp 8,97/bubble); customer REAL 113 bubble = 54 call = Rp 85,61 (0,48 call/bubble, mayoritas template statis/bypass).
- **Tests**: build (`tsc`) lolos; 214 test terkait (nlu-classifier, ai-router-engine, qa-nlu-fallback-security, treatment-questions, e2e-chat-to-reservation, model-fallback-chain, phrasing-service, llm-generator-safe-fallback) hijau.

### Fixed — Treatment Context & Greedy Catalog Match
- **Masalah**: 
  1. Saat customer menanyakan treatment spesifik (misal Pijat Bayi Pulih Ceria) lalu memberikan lokasi, bot menggunakan template `TEMPLATES.ongkirInfo` yang diakhiri pertanyaan generik *"Jadi mau pilih treatment apa bunda?"*.
  2. Saat customer bertanya harga (*"Brp kak untk feenya?"*), fungsi `searchCatalogItems` melakukan *greedy match* pada 2 kata awal ("Pijat Bayi"), sehingga `"Pijat Bayi Ceria (Rileksasi)"` menduduki hasil pertama dan harganya keliru dikutip (Rp60.000, bukan Rp70.000 untuk Pulih Ceria).
- **Perbaikan**:
  - `src/services/treatment-catalog.service.ts`: Memisahkan pencarian menjadi `exactMatches` (nama cocok utuh) dan `partialMatches` (cocok 2 kata awal). `exactMatches` kini diprioritaskan penuh dan diurutkan dari nama terpanjang/terspesifik.
  - `src/config/persona.ts`: Menambahkan opsi `candidateTreatmentName` pada `TEMPLATES.ongkirInfo` agar pertanyaan penutup kontekstual (*"Jadi mau pilih treatment apa Bund untuk hari ini? Atau mau lanjut dijadwalkan \*[Nama Treatment]\*-nya? 🤗"*).
  - `src/state-machine/handlers/location.ts`: Memasukkan `conversation.last_discussed_treatment` ke dalam pembentukan balasan ongkir/lokasi.

### Fixed — Ejaan Desa Sawotratap (Gazetteer)
- **Masalah**: Desa di Kecamatan Gedangan, Kabupaten Sidoarjo tertulis salah sebagai "Sawotratas" (nama resmi: **Sawotratap**) di data gazetteer, sehingga pencocokan lokasi bisa gagal/mismatch.
- **Perbaikan**: `docs/gazetteer_excel.tsv:30` dan `src/config/surabaya_sidoarjo_subdistricts.json:201` — "Sawotratas" → "Sawotratap".

### Fixed — Unifikasi Greeting Header (Satu Sumber Kebenaran di `TEMPLATES`)
- **Masalah**: Ada **3 versi teks pembuka yang tidak sinkron** — (a) string hardcoded di `src/state-machine/handlers/greeting.ts:83` (*"Perkenalkan, saya Bidan Yusi **dari Kala Moms and Baby Spa**. ✨"*, dipakai jalur customer baru kirim lokasi), (b) `TEMPLATES.firstContactGreetingHeader()` di `src/config/persona.ts` dan (c) `TEMPLATES.greeting()` — sehingga balasan terlihat "tidak mematuhi" persona (header di handler vs header di template).
- **Perbaikan**:
  - `src/state-machine/handlers/greeting.ts:82` — intro hardcoded diganti `TEMPLATES.firstContactGreetingHeader() + '\n\n'`; import `getBrandIdentity` dihapus (tidak terpakai lagi).
  - `src/config/persona.ts` — teks header resmi diekstrak ke `buildFirstContactHeader()` (satu sumber kebenaran); `TEMPLATES.greeting()` disusun dari helper tersebut (DRY, output identik).
  - Hasil: semua jalur (lokasi, FAQ di awal chat, greeting default) memakai Varian persona "Kami melayani Treatment moms & Baby yang bisa langsung dipanggil ke rumah (Homecare)".
- **Unit Tests**: substring `'Perkenalkan, saya Bidan Yusi'` di `tests/unit/production_edge_cases.test.ts:953` & `tests/integration/control_center_ui.test.ts:221` tetap lolos (Varian B mengandung frase tersebut). Verifikasi 10 sesi `scripts/test-50-same-opener.ts --max=10` (LLM asli).

### Fixed — LLM Generator: Anti Raw-JSON Leak, Fallback Darurat Aman & Anti Hard-Sell CTA (+ Retry Tanpa response_format)
- **`src/integrations/llm/generator.ts`**:
  - Soft-fallback JSON parser TIDAK lagi mengembalikan raw text (sintaks kurung kurawal) ke customer saat respons LLM terpotong/max_tokens habis. Kini: ekstrak nilai `"answer"` via regex (`extractAnswerFromPartialJson`) → jika gagal, jatuh ke fallback darurat netral (bukan bocor `{ "reasoning": ... }`).
  - Prompt dihemat token: instruksi `reasoning` disingkat menjadi maksimal 1 kalimat / 15 kata (sebelumnya bebas panjang sehingga `answer` terpotong).
  - **Fallback darurat (`fallbackFaqResponse`) tidak lagi meng-echo teks RAG/KB mentah** (chunk generic bisa keliru secara medis, mis. pertanyaan usia minimal match ke chunk "bayi baru lahir sampai beberapa tahun"). Jalur catalog terstruktur (`[DATA TREATMENT]`) tetap dipertahankan (data faktual dari DB).
  - **⚠️ Skenario apology "mohon maaf sedang antrean chat" DIHAPUS (permintaan owner).** Saat AI gagal menghasilkan jawaban yang aman (LLM error / breaker open / fallback kosong), generator kini mengembalikan **jawaban kosong + `usedFallback:true`**, dan `interest.ts` **mengeskalasi senyap ke antrean human handling** (sama dengan pola "FAQ tidak terjawab") — tanpa mengirim pesan minta-coba-lagi ke customer. Queue lebih panjang diutamakan daripada skenario apology tersebut.
  - Prompt diperkuat dengan **ATURAN ANTI HARD-SELLING**: nama treatment di CTA hanya boleh disebut jika customer sedang membahasnya.
  - Panggilan LLM dibungkus **concurrency limiter** (anti 429 saat lonjakan/burst).
- **`src/integrations/llm/model-fallback.ts`** — **Retry Tanpa `response_format`** (ditemukan saat verifikasi stres): provider OpenAI-compatible tertentu MENOLAK argumen `response_format` (HTTP 400 "Unrecognized request argument supplied: response_format") sehingga SEMUA jalur LLM jatuh ke fallback. Kini bila request memuat `response_format` dan provider menolaknya, `callChatCompletionsWithFallback` mengulang sekali TANPA `response_format` (format JSON tetap dijamin via sistem prompt). Fix terpusat → menguntungkan semua pemanggil (generator, ai-router, intent, nlu-classifier, dll).
- **`src/utils/llm-concurrency.ts`** (baru): semaphore promise tanpa dependency eksternal, default `LLM_MAX_CONCURRENCY=4` (env `LLM_MAX_CONCURRENCY`).
- **`src/state-machine/handlers/interest.ts`**: `treatmentNameForFollowUp` hanya diisi jika nama treatment **dieksplisitkan customer** (guard `treatmentExplicitlyMentioned`) — mencegah CTA "Paket Selapan" dipaksakan saat customer hanya tanya FAQ umum. **Selain itu: jika `faqResult.answer` kosong → eskalasi senyap ke HUMAN_HANDLING (`shouldSendReply:false`), pengganti skenario apology "antrean".**
- **Unit Tests**: `tests/unit/llm-generator-safe-fallback.test.ts` (baru: fallback terpotong aman, regex extraction, limiter), `tests/unit/model-fallback-chain.test.ts` (+2: retry tanpa response_format & tidak ada retry pada error lain), `tests/unit/phrasing-service.test.ts` disesuaikan (fallback non-catalog → jawaban kosong). `tests/unit/treatment-questions.test.ts` & `tests/unit/e2e-chat-to-reservation.test.ts` dikoreksi: mock kini menarget `generateFaqResponseWithDetails` (method yang sebenarnya dipanggil `interest.ts`). `tests/unit/customer-memory.test.ts` & `tests/unit/faq-grounding.test.ts` disesuaikan: fallback tanpa data kini mengembalikan jawaban kosong (sinyal eskalasi). **Hasil verifikasi ulang stres 50 sesi (LLM asli): 0 JSON-leak, 48/50 (96%) jawaban presisi, 0 samar, 0 hard-sell CTA, 0 silent/eskalasi, 48/50 minta lokasi.**

### Added — Harness Uji Variasi Sesi Baru (Pesan Pembuka Sama)
- **`scripts/test-50-same-opener.ts`** (baru): jalankan **50 sesi percakapan terpisah** (fresh customer + conversation INITIAL + state machine per sesi, `is_sandbox_test=true`), masing-masing dibuka dengan pesan pembuka SAMA (`"Selamat sore. Saya ingin tanya untuk pijat bayi min. di usia brp ya?"`), lalu capture semua bubble yang benar-benar DITERIMA customer (via `RecordingWahaClient`). Opsi `--max=N`, `--offline` (fallback rule-based tanpa network). Default LLM asli dari `.env`.
- Output: konsol per-sesi (state, error, eskalasi) + ringkasan agregat + **`test-results/50-same-opener-<timestamp>.json` / `.md`**.
- Hasil run 50 (LLM asli, 2026-08-13): 0 error/silent/eskalasi; semua berakhir `AWAITING_LOCATION`. Temuan: **9/50 (18%) balasan bocor raw JSON internal LLM ke customer** (soft-fallback `generator.ts` saat respons tidak ter-parse → `{ "reasoning": ... }` terkirim apa adanya); hanya 7/50 jawaban presisi "minimal 2 minggu", 34/50 jawaban samar ("bayi baru lahir sampai beberapa tahun"); pertanyaan lokasi hanya muncul di 16/50 (32%); bubble pembuka 50/50 identik (template kaku).

### Added — Daily Chat Export (Markdown untuk Analisa AI)
- **`src/services/chat-export.service.ts`** (baru):
  - `buildDailyChatMarkdown()`: pure function generator Markdown terstruktur — header statistik harian, satu blok per percakapan (phone, nama, lokasi, transisi state, flag human-handling/eskalasi/review, jumlah UNKNOWN beruntun), dan transkrip kronologis dengan penanda peran (`USER` = pelanggan, `BOT` = balasan AI, `HUMAN_AGENT` = staf/manusia via sender_name).
  - Balasan BOT menyertakan skor LLM-as-judge (`ai_evaluations`) jika ada: `**BOT** (skor AI: 4/5)`.
  - `generateDay()` tenant-aware (wajib `tenantId`), filter rentang UTC harian, dan **mengecualikan customer QA/sandbox** (`is_sandbox_test=true`) agar analisa tidak tercemar data test.
  - `saveDayExport()` menulis file `daily-chats-YYYY-MM-DD.md` ke `storage/exports/` (env `CHAT_EXPORT_DIR`); `listExports()` mendaftar file tersimpan.
  - DB offline → degrade senyap (return `success:false`), tidak mengganggu produksi.
- **`src/routes/admin/export.subroute.ts`** (baru):
  - `GET /api/admin/export/daily-chats?date=YYYY-MM-DD&tenantId=` → generate konten Markdown on-the-fly + audit trail `CHAT_EXPORT_GENERATE`.
  - `GET /api/admin/export/daily-chats/list` → daftar file ekspor tersimpan.
  - Terdaftar di `src/routes/admin.route.ts` (di balik auth admin dual X-API-KEY/cookie yang sama).
- **Cron harian** (`src/services/cron.service.ts` `runDailyChatExport()` + gate di `src/app.ts`): `ENABLE_CHAT_EXPORT_CRON=true` (default false), interval `CHAT_EXPORT_INTERVAL_HOURS` (default 6 jam) — setiap siklus me-regenerate file hari berjalan.
- **Admin Dashboard** (`packages/admin-dashboard`):
  - Halaman baru `ChatExport.tsx` (route `/admin/chat-export`, nav "Daily Chat Export (AI)"): pilih tanggal → "Generate & Download .md" (Blob client-side, aman untuk auth cookie), tabel file tersimpan, dan contoh prompt analisa AI.
  - Rebuilt `dist/` (chunk `ChatExport-*.js`).
- **Unit Tests**: `tests/unit/chat-export.test.ts` (18 test: roleLabel, formatTime, formatLocalDate, parseDateRange, struktur markdown, HUMAN_AGENT labeling, skor AI, flag eskalasi/review, multi-line blockquote, empty day) 100% PASS.

---

## [1.13.0] - 2026-08-13

### Fixed & Enhanced
- **Forbidden English Words Sanitizer (`src/utils/language-sanitizer.ts` & `src/integrations/llm/generator.ts`)**: Menambahkan fungsi `sanitizeForbiddenEnglishWords` untuk membuang/mengganti kata bahasa Inggris terlarang yang bocor dari LLM (seperti `little one`, `little one-nya` -> `si kecil`, `baby` -> `bayi`, `mommy` -> `Bunda`, `schedule` -> `jadwal`) baik pada generasi LLM baru maupun pada hit FAQ Cache.
- **Location-Known Customer Field Fix (`src/state-machine/handlers/interest.ts`)**: Memperbaiki bug di mana `isLocationKnown` sebelumnya mengevaluasi `currentState !== INITIAL && currentState !== AWAITING_LOCATION` (yang bisa menghasilkan `true` walau alamat/kelurahan customer masih kosong). Sekarang `isLocationKnown` secara eksplisit memeriksa `Boolean(customer.kelurahan)` sehingga jika alamat rumah belum diisi, AI 100% dijamin selalu meminta alamat rumah (*"Kalau boleh tahu rumahnya di mana ya Bunda?"*).
- **RAG Leakage & Typo Sanitizer (`src/utils/language-sanitizer.ts` & `src/integrations/llm/generator.ts`)**: Menambahkan fungsi `sanitizeRagLeakage` untuk membuang potongan teks/typo yang bocor dari RAG secara otomatis (seperti `Bun.etails info di sini`, `details info`, atau `berdasarkan referensi dokumen di atas`) sebelum pesan dikirimkan ke pasien.
- **TypeScript Fix**: Perbaikan properti `ai_feedback` -> `feedback` pada `chat-export.service.ts`.
- **Unit Tests**: Penambahan pengujian unit `sanitizeRagLeakage` dan `sanitizeForbiddenEnglishWords` pada `tests/unit/language-sanitizer.test.ts` (100% PASS).

---

## [1.12.0] - 2026-08-12

### Changed & Fixed (Consolidated)
- **WAHA Client Optimization**: Presence Timeout Optimization (3s) & Non-Blocking stopTyping untuk mencegah delay pengiriman.
- **WAHA Resilience**: Retry mekanisme untuk error transien, rate limiter concurrent calls, dan resolusi JID / LID.
- **Customer Labels**: Sinkronisasi event-driven untuk label admin/hold ke kolom database, dan Admin Dashboard toggle.
- **LLM Timeout Optimization**: Meningkatkan batas timeout default panggilan LLM (`LLM_TIMEOUT_CHAT_MS`, `LLM_TIMEOUT_NLU_MS`, `LLM_TIMEOUT_ROUTER_MS`) dari 12s/15s menjadi **120.000ms (2 Menit)** untuk mencegah kegagalan prematur saat jaringan/database sedang lambat.
- **Smart FTS Search**: Pembersihan kata basa-basi/sapaan (`sanitizeQueryForFts`), normalisasi slang (`min.` -> `minimal`, `brp` -> `berapa`), serta fallback OR-based tsquery untuk menjamin pencarian Knowledge Base (FTS) tetap berhasil menemukan Chunk KB yang tepat dari pertanyaan percakapan.
- **Question Override Guard**: Mencegah frasa pertanyaan pembuka (seperti *"Saya ingin tanya..."*) ter-map salah ke intent `interested` akibat kata *"ingin"*, memastikannya selalu diproses sebagai `faq_question` agar dijawab dengan jelas sebelum penawaran reservasi.
- **Persona Prompt - Early Chat Location Inquiry**: Menambahkan instruksi wajib pada `BOT_PERSONA_PROMPT` & LLM Generator (`ctaInstruction`) agar pada pertanyaan di awal percakapan (saat alamat customer belum ada), AI selalu menutup balasan di akhir chat dengan menanyakan area/rumah tempat tinggal customer secara ramah (misal *"Kalau boleh tahu rumahnya di mana ya Bunda? Biar sekalian kami bantu cekkan ketersediaannya 😊"*), serta menegaskan larangan kata "lokasi".
- **Smart Age Matcher**: Deteksi otomatis ekspresi usia anak/bayi pada pesan customer (`parseAgeTextToMonths`) untuk re-mapping intent `other` -> `faq_question`, serta injeksi katalog rekomendasi treatment berbasis filter usia (`getServicesByAge`) secara akurat.
- **LLM CTA Location-Aware**: Instruksi CTA di akhir balasan AI sekarang bersyarat berdasarkan status `isLocationKnown` dari State Machine (bukan lagi diserahkan ke AI untuk menebak). Jika lokasi belum diketahui → wajib tanya rumah; jika sudah diketahui → tawarkan reservasi tanpa tanya ulang.
- **Anti-Halusinasi Brand**: Melarang AI menerjemahkan nama brand ke bahasa Inggris (misal "Mothers and Baby Spa") serta melarang kata-kata Inggris yang sering bocor ("little one", "baby", "mommy") dengan padanan Indonesia wajib.
- **Anti-Robot Phrasing**: Melarang penggunaan frasa kaku pembuka seperti "Berikut jawaban untuk pertanyaan bunda:" — AI wajib langsung menjawab ke inti dengan gaya ngobrol WhatsApp natural.
- **Ongkir CTA Fix**: Melarang AI menanyakan jadwal/waktu setelah info ongkir. AI wajib menutup dengan menanyakan pilihan treatment ("Jadi mau pilih treatment apa bunda?"), bukan jadwal ("kapan siap ditangani").
- **Fix Location-Known State Mapping (`greeting.ts`)**: Memperbaiki bug di mana `greeting.ts` sebelumnya memicu `handleInterestState` dengan meng-override `current_state` menjadi `AWAITING_INTEREST`. Hal ini menyebabkan LLM keliru menganggap alamat rumah customer sudah diketahui (`isLocationKnown = true`), sehingga LLM tidak menanyakan alamat rumah di akhir balasan.
- **Anti-Kata Buntung Persona Guard**: Penambahan aturan tata bahasa di persona prompt untuk mencegah LLM menghasilkan kata cacat/buntung (seperti *"kalau-nya"*, *"si-nya"*) akibat penghapusan kata bahasa Inggris yang dilarang. AI diwajibkan menggunakan struktur kalimat lengkap (*"kalau si kecil"*, *"kalau bayinya"*).
- **Geocoding Kecamatan Gate & Persona Template Fix (`src/integrations/google-maps/geocoding.ts` & `src/config/persona.ts`)**: Penambahan proteksi gate nama Kecamatan luas yang memiliki nama ganda (seperti *Tandes*, *Karangpilang*, *Rungkut*, *Gubeng*, *Wonokromo*, *Wiyung*, *Sawahan*, dll.) yang membawahi banyak kelurahan. Jika customer mengetik nama kecamatan tanpa kata kunci eksplisit `kelurahan`/`desa`/`kel`, geocoding mengembalikan `isPrecise: false` beserta daftar `ambiguityResults` kelurahan di kecamatan tersebut agar bot meminta detail kelurahan spesifik. Perbaikan template `askKelurahanAmbiguous` di `persona.ts` agar menyebutkan nama Kecamatan target (misal *"Kecamatan Tandes"*) beserta contoh kelurahan secara ramah (maksimal 3 contoh), tanpa menyebutkan nama kelurahan acak di judul atau mencetak seluruh daftar kelurahan secara panjang.

---

## [1.11.0] - 2026-08-02

### Added - AI Router Observability + UNKNOWN Repeated Escalation
- **`prisma/schema.prisma`**:
  - Model baru `AiRouterEvaluation` (tabel `ai_router_evaluations`): snapshot evaluasi router
    (llm_intent, llm_confidence, llm_used_fallback, legacy_intent, legacy_escalated,
    intent_match, escalation_match, mismatch_notes, response_time_ms).
  - Field `conversations.consecutive_unknown_count` (default 0).
  - Migration: `prisma/migrations/20260803000000_add_ai_router_evaluations/migration.sql`.
- **`src/services/ai-router-evaluation.service.ts`** (baru):
  - `logRouterEvaluation()`: tulis evaluasi router ke DB; gagal simpan di-swallow agar tidak mengganggu balasan customer.
  - `mapLegacyDecisionToIntent()`: translasi tipis keputusan legacy ke label intent; label `UNMAPPED` sengaja beda dari `UNKNOWN`.
  - `handleRouterResult()`: counter UNKNOWN berulang per conversation; >= 2x -> force eskalasi human (`escalation_reason=UNKNOWN_REPEATED`); reset saat intent lain terdeteksi.
- **`src/integrations/llm/ai-router.ts`**: enum `ESCALATION_REASONS` + `'UNKNOWN_REPEATED'`.
- **`src/state-machine/machine.ts`**:
  - Full-mode (non-shadow): UNKNOWN x2 berturut-turut -> eskalasi otomatis ke HUMAN_HANDLING (silent).
  - Shadow & full mode: evaluasi router di-log ke `ai_router_evaluations` per pesan.
- **`src/scripts/check-router-accuracy.ts`** (baru): cek akurasi shadow vs legacy; gate matikan shadow mode
  (escalation >= 98%, medical mismatch = 0 hard-zero, UNMAPPED < 5%).
- **Tests**: +17 test (log evaluasi, mapping legacy, counter UNKNOWN, e2e machine 2x UNKNOWN -> HUMAN_HANDLING). Total 525 test pass.

### Notes - Environment / Deploy
- `prisma generate` penuh kembali normal. Sempat ter-regenerate dengan `--no-engine` yang mengunci client ke
  URL `prisma://` (P6001, Accelerate-only) saat engine dll terkunci EPERM oleh proses berjalan; sudah digenerate
  ulang penuh setelah proses yang lock dimatikan. Runtime terverifikasi `P2021` (normal) bukan `P6001`.
- Migration `20260803000000_add_ai_router_evaluations` sudah di-deploy ke DB docker lokal; zero drift
  terverifikasi via `migrate diff --from-url`.
- Runbook deploy & jadwal monitoring shadow mode: `README.md` bagian "Deployment & Runbook Migration".
- Known issue pre-existing: `migrate diff --from-migrations` rusak oleh urutan enum `FollowUpStatus` di
  `20260801000000_add_failed_followup_status`. Lihat `docs/KNOWN_ISSUES.md`.

## [1.10.0] — 2026-08-02

### Added — Structured Children + Dynamic Age Engine
- **`prisma/schema.prisma`**:
  - Model baru `Child` (tabel `children`): per customer, relasi ke `Reservation`, key unik `(customer_id, name)` anti-duplikasi saat repeat order, multi-tenant (`tenant_id`).
  - Field: `name`, `birth_date` (estimasi dari teks usia), `age_months_at_registration`, `raw_age_text`.
  - Relasi `Customer.children[]` & `Reservation.children[]`.
  - Migration: `prisma/migrations/20260802000000_add_children/migration.sql`.
- **`src/utils/age-calculator.ts`** (baru):
  - `parseAgeTextToBirthDate()`: estimasi tanggal lahir dari teks usia Indonesia (`6 bulan`, `1 tahun 2 bulan`, `3 minggu`, `10 hari`, `2th`, `6 bulan 2 hari`).
  - `computeCurrentAge()`: usia DINAMIS terhadap hari ini (hari ini → `X bulan`, `<24 bulan` → `X tahun Y bulan`, `<1 bulan` → `X hari`), dari `birth_date` ATAU snapshot `age_months_at_registration` + `created_at`.
- **`src/services/child.service.ts`** (baru):
  - `upsertChildrenFromBabies()`: persist anak saat reservasi dibuat (DB offline → senyap).
  - `getChildrenWithCurrentAge()`: daftar anak customer dengan `current_age` realtime.
- **`src/state-machine/handlers/interest.ts`** & **`src/routes/admin.route.ts`**:
  - Panggil `childService.upsertChildrenFromBabies()` setelah reservasi dibuat.
  - `GET /api/admin/reservations` include `customer.children` + hitung `current_age` per anak.
- **`packages/admin-dashboard/src/pages/tenant/Reservations.tsx`**:
  - Modal Manage → section "Bayi / Anak (n)" prioritas dari `children` DB (usia realtime), tampil `nama · usia sekarang` + catatan `(saat booking: X)` jika berbeda.
  - Fallback lama: `baby_details` API → parse `raw_text`/`treatment_detail` client-side.
- **`packages/admin-dashboard/src/types/index.ts`**: type `ChildInfo` + `customer.children`.
- **Unit Tests**: `tests/unit/age-calculator.test.ts` (15 test) & `tests/unit/child-service.test.ts` (5 test) 100% PASS.

### Added — Baby Details di Reservation Detail (Manage Modal)
- **`src/utils/reservation-text-parser.ts`**:
  - `ParsedReservation.babies: BabyDetail[]` (nama + usia bayi/anak) — terstruktur, bukan string campur di treatmentDetail.
  - Mendukung **beberapa anak**: satu baris multi-nilai (`Rara, Riri` / `&` / `dan`), blok `Nama Bayi`/`Usia Bayi/Anak` berulang, dan usia dalam kurung (`Rara (6 bulan)`).
  - Helper baru `extractBabyDetails(rawText)` + `buildBabyDetails()` + `preprocessReservationText()` (refactor preprocessing supaya bisa dipakai mandiri tanpa parse penuh).
  - `treatmentDetail` kini memuat seluruh bayi (dipisah `|`) untuk multi-anak.
- **`src/routes/admin.route.ts`**:
  - `GET /api/admin/reservations` meng-enrich tiap reservasi dengan `baby_details` dari `raw_text` (kompatibel dengan data lama — tidak butuh kolom DB baru).
- **`packages/admin-dashboard/src/pages/tenant/Reservations.tsx`**:
  - Modal **Manage** → card "Patient Details" menampilkan daftar **Bayi / Anak (n)**: nama + umur per bayi.
- **`packages/admin-dashboard/src/types/index.ts`**: type `BabyDetail` + `Reservation.baby_details`.
- **Unit Tests**: `tests/unit/reservation-text-parser.test.ts` (+7 test: single bayi, 2 bayi satu baris, 2 bayi blok berulang, usia dalam kurung, `extractBabyDetails` inline/null).

### Added — AI Router Engine (Shadow-First, LLM Intent Classification)
- **`src/integrations/llm/ai-router.ts`** (baru):
  - Klasifikasi 11 intent (`GREETING`, `PROVIDE_LOCATION`, `ASK_FAQ`, `INTERESTED_IN_BOOKING`, `PROVIDE_RESERVATION_DETAILS`, `ASK_SPECIFIC_SCHEDULE`, `MEDICAL_CONCERN`, `CONFIRMATION`, `NEGATION`, `CHITCHAT`, `UNKNOWN`) + ekstraksi entitas (lokasi, treatment, nama, tanggal, jam).
  - Validasi output LLM dengan **Zod schema** (`AIRouterResponseSchema`) + **retry-once** dengan `buildRetryPrompt()` (hint field error ringkas, bukan raw stack trace).
  - **Anti prompt-injection** di system prompt: pesan pelanggan SELALU data, bukan instruksi. Diverifikasi unit test.
  - **Circuit breaker reuse** (`src/utils/circuit-breaker.ts`): CLOSED → OPEN → HALF_OPEN, cooldown 30s, window 10.
  - **Rule-based fallback** deterministik yang **re-use `MedicalDetectionService`** (SINGLE SOURCE OF TRUTH — tidak ada keyword list medis duplikat yang bisa divergen).
  - **CONTRACT ANTI-BYPASS gazetteer**: `location_mention` dari router HANYA kandidat teks, wajib di-resolve ulang via `geocodingService.geocodeText()` (threshold asli kelurahan 0.75 / kecamatan 0.82) — tidak pernah langsung jadi `confirmed_kelurahan`.
  - Feature flags: `AI_ROUTER_ENABLED` (aktifkan) & `AI_ROUTER_SHADOW_MODE` (log perbandingan LLM vs fallback legacy tanpa mengubah keputusan state).
- **`src/state-machine/machine.ts`**:
  - GATE 2.5: jalankan AI Router saat `AI_ROUTER_ENABLED=true`, share riwayat percakapan dengan NLU, expose `routerDecision` ke handler.
- **`src/state-machine/types.ts`**:
  - `StateHandlerContext.routerDecision?: AIRouterDecision`.
- **Unit Tests**:
  - `tests/unit/ai-router-engine.test.ts` (38 test cases 100% PASS): schema validation, state priority (AWAITING_LOCATION FAQ vs lokasi), affirmation signal (AFFIRM/DENY/MIXED/NONE + interjeksi), schedule escalation, medical fallback parity, reservation extraction, prompt injection (langsung + shadow mode), Zod retry-once, circuit breaker HALF_OPEN recovery, compareRouterDecisions, anti-bypass gazetteer, dan guard kelurahan-kosong menahan form reservasi di level state machine.

---

## [1.9.0] — 2026-08-01

### Fixed — Reservation Text Parser (Wrapped & Double-Spaced Labels)
- **`src/utils/reservation-text-parser.ts`**:
  - Preprocessor otomatis memecah label inline dan menyambungkan kata label yang terpotong di tengah baris (misal `Nama Bun\nda:` -> `Nama Bunda:`).
  - Normalisasi spasi ganda pada label dan section header (misal `Nama  Bunda:` terdeteksi sama dengan `Nama Bunda:`).
- **Unit Tests**:
  - `tests/unit/reservation-stress.test.ts` (30 variasi acak form reservasi 100% PASS).
  - `tests/unit/reservation-text-parser.test.ts` (+1 test case multiline wrapped form).

### Added — Personalized Treatment FAQ Follow-Up
- **`src/config/persona.ts`**:
  - `faqFollowUp` sekarang menerima nama treatment spesifik (misal `Sinar Moksa`) dan menghasilkan 4 variasi CTA natural secara acak (rotasi anti-bot).
- **`src/state-machine/handlers/interest.ts`**:
  - Ekstrak nama treatment dari NLU entity atau catalog match (dengan pembersihan suffix kurung) untuk di-inject ke `faqFollowUp`.
- **Unit Tests**:
  - `tests/unit/treatment-followup-personal.test.ts` (20 test cases 100% PASS).
  - `tests/unit/treatment-catalog-search.test.ts` (30 test cases dengan IDF scoring 100% PASS).

### Fixed — Persona Language Strictness & Brand Enforcement
- **`src/config/persona.ts`**:
  - Tambah aturan ketat: *"HANYA gunakan bahasa Indonesia. DILARANG menggunakan bahasa Inggris, Mandarin, Jepang, Arab..."* (mencegah keluarnya karakter Cina seperti "顺便").
  - Tambah aturan ejaan merek: *"Kala Moms and Baby Spa — EJAAN HARUS PERSIS."*

### Fixed — Sandbox UI Multiline Formatting & Input UX
- **`packages/admin-dashboard/src/pages/tenant/AiSandbox.tsx`**:
  - Render message content dengan `<div className="whitespace-pre-wrap break-words font-sans">` agar karakter `\n` dirender sebagai enter/ganti baris di browser.
  - Textarea input multi-line dengan dukungan `Enter` untuk kirim dan `Shift+Enter` untuk baris baru.
  - Tombol **Kirim** hijau lebih menonjol dengan indicator spinner loading.

### Fixed — CLI Simulator
- **`src/cli/chat-simulator.ts`**:
  - Mode input multi-line otomatis saat mengetik `Berikut list untuk reservasi` (mengumpulkan baris sampai baris kosong).
  - `/reset` sekarang menghapus lokasi confirmed dan pending secara total via `customerService.resetFullLocation()`.

### Test Suite Status
- **42 Test Files \| 391 Tests \| 100% PASS** ✅

---

## [1.8.0] — 2026-08-01

### Added — Fase 2 Scheduling & Follow-Up Engine & UI
- **`src/config/followup-templates.ts`**: Modul baru *Rolling Templates Engine* dengan 3 variasi pesan natural per stage (anti-bot pattern).
- **`src/services/follow-up.service.ts`**: `processDueFollowUps()` & `executeFollowUp()` memproses antrian follow-up `NO_PURCHASE` (+3, +7, +14 hari) dan `NEXT_TREATMENT` (+1, +2, +3 bulan) saat `scheduled_at <= NOW()`.
- **`src/services/cron.service.ts`**: `runFollowUpWorker()` runner periodik (interval 15 menit).
- **REST Endpoints Admin**:
  - `GET /api/admin/follow-ups` (Filter status, type, search)
  - `POST /api/admin/follow-ups/:id/send-now` (Kirim instan)
  - `PATCH /api/admin/follow-ups/:id/cancel` (Batalkan antrian)
  - `PATCH /api/admin/follow-ups/:id/reschedule` (Ubah tanggal/jam kirim)
- **UI React SPA**:
  - **`FollowUpQueue.tsx`**: Halaman baru `/admin/follow-ups` untuk memantau antrian & riwayat follow-up.
  - Tabel lengkap: `date_send`, `time_send`, Tipe & Stage, Nama Customer, No. HP, Kecamatan/Kelurahan, Rotasi Template, Status, Tombol Kirim/Reschedule/Cancel.
- **Unit Tests**:
  - **`tests/unit/follow-up-engine.test.ts`**: 5 unit test memvalidasi rotasi template, auto-cancel reservasi baru, pembuatan `NEXT_TREATMENT`, dan worker.
  - **Total test suite: 39 test files \| 337 tests \| 100% PASS** ✅

---

## [1.7.0] — 2026-07-31

### Added — UI Delivery Fee Tiering
- **`packages/admin-dashboard/src/pages/tenant/DeliveryTiers.tsx`**: Halaman baru untuk mengelola tarif ongkir homecare.
  - Editor tier jarak (maxDist, fee normal, potongan promo) dengan hitung net otomatis
  - Simulasi ongkir live — input jarak → tampilkan tier & yang dibayar customer
  - Validasi berurutan (maxDist harus naik), tombol quick-pick jarak (3/5/8/12/18/25 km)
  - Auto-sort sebelum simpan, tersimpan ke `delivery_tiers_custom.json`
- **Route**: `/admin/delivery` + menu sidebar "Delivery Fee".
- **Fix `Settings.tsx`**: Hapus banner "UI Demo Only (Belum Tersambung Backend)" — backend `/api/admin/delivery-tiers` sudah tersambung.

---

## [1.6.0] — 2026-07-31

### Added — LLM Geocoding Fallback
- **`src/integrations/google-maps/geocoding.ts`**: Tambah method `llmResolveLocation()` sebagai fallback saat gazetteer fuzzy match gagal (typo, dusun/RT, nama tidak umum).
- **Model**: DeepSeek V4 Flash via SumoPod (`AI_MODEL_NLU` env var).
- **Cross-check**: Hasil LLM di-validasi ke gazetteer untuk ambil koordinat exact.
- **DeepSeek reasoning support**: Handle `reasoning_content` field untuk reasoning models.
- **Guard conditions**: Input ≥ 3 karakter, API key tersedia, tidak dalam outage.
- **Circuit breaker**: Wrap LLM call untuk resilience.

### Added — NLU Model Configuration
- **`src/config/ai-models.config.ts`**: Tambah `AI_MODEL_NLU` env var untuk model NLU classification.
- **Default**: `deepseek-v4-flash` (cepat, murah, reasoning capability).

### Added — Documentation
- **`docs/DEAD_CODE_GOOGLE_MAPS.md`**: Dokumentasi kode Google Maps yang tidak terpakai dan opsi keputusan.
- **`opencode.json`**: Konfigurasi 9router untuk opencode.

### Changed — Geocoding Flow
- **Alur baru**: Gazetteer → LLM fallback → Minta detail (behavior lama).
- **Prioritas**: Gazetteer tetap utama untuk koordinat exact, LLM hanya untuk understanding.
- **Google Maps API**: Tidak diperlukan (gazetteer + LLM sudah cukup).

### Test Results
- **10 test cases**: 7/10 berhasil resolve lokasi via LLM fallback.
- **Akurasi koordinat**: Gazetteer ±10m vs LLM ±5km (hybrid approach optimal).

---

## [1.5.0] — 2026-07-25

### Fixed — Message Rewrite (Body Strip)
- **Bug `webhook.route.ts`**: Pesan `Promo[a7] halo bunda` sebelumnya masuk ke state machine **apa adanya** tanpa strip kode tracking. Sekarang setelah attribution block berhasil, kode `Promo[XX]` di-strip dari body: `"Promo[a7] halo bunda"` → `"halo bunda"`, `"Promo[a7]"` (saja) → fallback ke `"Halo"`.

### Fixed — Migration Side Effects (Kritis)
- **Bug `migration.service.ts`**: `commitApprovedRecords()` sebelumnya memanggil `customerService.getOrCreateCustomer()` tanpa bypass, yang secara otomatis men-trigger `followUpService.createNoPurchaseFollowUps()` untuk setiap legacy customer yang di-commit — perilaku yang salah karena mereka bukan lead baru.
- **Fix `customer.service.ts`**: Tambahkan parameter opsional `options?: { skipFollowUpScheduling?: boolean }` ke `getOrCreateCustomer()`. Guard melindungi blok `createNoPurchaseFollowUps` ketika flag aktif.
- **Fix `migration.service.ts`**: Panggil `getOrCreateCustomer()` dengan `{ skipFollowUpScheduling: true }` — legacy customer tidak akan pernah mendapat follow-up NO_PURCHASE.
- **Konfirmasi Google Calendar**: Audit kode mengkonfirmasi `prisma.reservation.create()` di migration service **tidak** memiliki hook Calendar otomatis — tidak ada perubahan diperlukan. Calendar hanya dipanggil eksplisit dari `admin.route.ts`.

### Changed — `generateTrackingCode()` Refactor
- **Renamed**: `generateShortCode()` → helper internal `_randomCode()` (tidak lagi di-export).
- **Export baru**: `generateTrackingCode(data, db)` — fungsi async yang melakukan insert-and-catch-conflict dengan retry-and-escalate.
- **Alphabet baru**: Hapus karakter ambigu `0`, `1`, `i`, `l`, `o` → tersisa **32 karakter** bersih (`abcdefghjkmnpqrstuvwxyz23456789`). Keyspace: 2-char = 1.024 | 3-char = 32.768 | 4-char = 1.048.576.
- **Alur escalate**: Gagal 5× di 2-char → naik ke 3-char → gagal 5× → naik ke 4-char (batas maks). Jika semua gagal → HTTP 503.
- **Concurrency-safe**: Tidak ada SELECT sebelum INSERT — DB UNIQUE constraint yang memutuskan, bukan aplikasi. Race condition antara 2 request bersamaan sudah aman secara atomik.
- **Fallback in-memory**: Tetap ada. DB offline → generate 2-char langsung tanpa loop.

### Added — New Test Coverage
- **`tests/unit/code-generation.test.ts`** (baru, 7 test):
  - ✅ Kode 2 karakter normal (mock DB kosong)
  - ✅ Alphabet bersih: tidak ada `0`,`1`,`i`,`l`,`o` dalam 1.000 sample
  - ✅ Escalate ke 3-char setelah 5× P2002 di 2-char
  - ✅ Escalate ke 4-char setelah 5× P2002 di 2-char + 5× di 3-char
  - ✅ Kode berbeda tiap retry
  - ✅ **Concurrent collision**: `Promise.all()` 2 request bersamaan → dua kode berbeda
  - ✅ **Latency benchmark**: p50 = `0.00ms`, worst-case = `0.06ms` (jauh di bawah budget 2 detik `go.html`)
- **`tests/unit/migration.test.ts`** (+2 test, total 5):
  - ✅ Setelah commit, `followUpService.createNoPurchaseFollowUps` = **zero calls**
  - ✅ Setelah commit, `googleCalendarService.createEvent` = **zero calls**

### Test Results
- **22 test files | 200 tests | 100% PASS** ✅

---

## [1.4.0] — 2026-07-24

### Added — WAHA Legacy Chat Migration Module
- **Model database `LegacyStaging`** dan **enum `StagingStatus`** (`PENDING`, `APPROVED`, `REJECTED`, `COMMITTED`) di `prisma/schema.prisma` sebagai staging area sebelum data customer lama masuk ke tabel utama.
- **`WahaClient.getChats()`** — method baru untuk menarik daftar seluruh room chat dari WAHA API (`GET /api/{session}/chats`).
- **`WahaClient.getMessages(chatId, limit)`** — method baru untuk menarik histori pesan dari room chat tertentu (`GET /api/{session}/messages`), beserta implementasi mock untuk mode unit test.
- **`src/services/migration.service.ts`** (file baru) — service utama yang menangani 3 fungsi:
  - `extractFromWaha()`: Tarik chat WAHA → filter grup (@g.us) → simpan hanya pesan teks → deteksi `leadCreatedAt` (pesan pertama) & `firstPurchaseAt` (form reservasi) → upsert ke `LegacyStaging`.
  - `updateStagingStatus(id, status)`: Approve / Reject / Reset status record staging.
  - `commitApprovedRecords()`: Commit massal — upsert `Customer` dengan status `'legacy'`, import pesan historis ke `Message` log dengan timestamp asli, buat `Reservation` (status `confirmed`) jika form reservasi terdeteksi.
- **4 endpoint admin baru** di `src/routes/admin.route.ts` (terproteksi `ADMIN_API_KEY`):
  - `POST /api/admin/migration/extract`
  - `GET /api/admin/migration/staging` (dengan pagination & filter status)
  - `PATCH /api/admin/migration/staging/:id`
  - `POST /api/admin/migration/commit`
- **`tests/unit/migration.test.ts`** (file baru) — 3 unit test menggunakan WAHA mock client.
- **Mock `legacyStaging`** dan **`message.findFirst`** ditambahkan ke `tests/setup.ts`.

### Fixed
- Mock `prisma.message.findFirst` yang hilang di `tests/setup.ts` yang menyebabkan `TypeError` saat migration test dijalankan.

### Test Results
- **21 test files | 191 tests | 100% PASS** ✅

---

## [1.3.0] — 2026-07-23

### Added — Ad Click Attribution & Meta Conversions API (CAPI)
- **`POST /api/tracking/click`** — endpoint penangkapan klik iklan dengan proteksi timing-safe token, rate-limiting, dan penolakan spoofing IP/UA.
- **Webhook interception `Promo[CODE]`** — pesan `Promo[XX]` dicocokkan ke record `AdClick` secara atomik; di-rewrite in-memory ke `'Halo'` untuk state machine; teks asli tersimpan di DB log.
- **`CapiService`** — E.164 normalization, SHA-256 hashing lowercase, circuit breaker, fire-and-forget `Lead` event saat konfirmasi reservasi.
- **Kode tracking 2 karakter alfanumerik** (1.296 kombinasi) untuk typing natural (contoh: `Promo[a7]`).
- **Cleanup otomatis `AdClick`** > 100 hari, dijalankan 1x sebulan setiap tanggal 1.

### Added — Click Catcher Microservice (`wa-click-catcher`)
- Proyek baru microservice super-ringan tanpa database.
- `public/go.html` dengan Meta Pixel, ekstraksi fbclid/UTM, timeout 2s fail-open, animasi loader premium, fallback no-JS.
- Fastify server dengan dynamic injection env var di request-time.
- Dockerfile dan README.md lengkap.

### Test Results
- **20 test files | 187 tests | 100% PASS** ✅

---

## [1.2.0] — 2026-07-22

### Added — Security Hardening & Edge Case Coverage
- Proteksi endpoint admin dengan `ADMIN_API_KEY` menggunakan `crypto.timingSafeEqual` + SHA-256.
- Auto-block customer untuk pola spam/abuse; manual block via endpoint admin; bot silent untuk customer blocked.
- Flag kata kasar dengan word-boundary match untuk review manual.
- Peredaman greeting "Halo Bunda" jika percakapan aktif < 48 jam.
- Label WAHA `"hold"` otomatis saat eskalasi ke human; auto-resume jika label dihapus admin.
- Deteksi lokasi dini dari pesan pertama customer.
- Proteksi form reservasi: tidak dikirim jika `customer.kelurahan` masih kosong.
- Reset otomatis lokasi `pending` setelah idle 24 jam.
- Filter pesan grup WhatsApp (`@g.us`) diabaikan tanpa respons.
- Dukungan alias sapaan `"bubid"`.

### Fixed
- Bug perkenalan diri yang terlewat saat lokasi dideteksi di pesan pertama.

### Test Results
- **19 test files | 183+ tests | 100% PASS** ✅

---

## [1.1.0] — 2026-07-21

### Added — Conversation Engine Core
- State machine: `NEW_LEAD` → `LOCATION_ASKED` → `LOCATION_PENDING_CONFIRM` → `LOCATION_CONFIRMED` → `INTERESTED` → `RESERVATION_SENT` → `RESERVATION_RECEIVED` → `HUMAN_HANDLING`.
- Sapaan otomatis + typing indicator simulasi perilaku manusia.
- Deteksi afirmasi/negasi kompleks termasuk mixed-signal.
- Fuzzy matching kelurahan dengan Sorensen-Dice similarity (threshold 0.80).
- Kalkulasi jarak via OpenRouteService, fallback Haversine.
- Tiering ongkir 7 level berdasarkan jarak dari klinik.
- FAQ engine tanpa mengganggu state aktif.
- Penangkapan koordinat share location native WhatsApp.
- Eskalasi ke human setelah 3x lokasi gagal di-resolve.
- Auto-release human handling setelah 6 jam tanpa respons agent.
- Antrian pesan FIFO per nomor customer, fallback in-memory jika Redis down.
- Kirim pricelist otomatis saat lokasi terkonfirmasi.
- Integrasi WAHA self-hosted.
- Persiapan arsitektur multi-tenant (`tenant_id` di semua tabel).

### Test Results
- **15 test files | 150+ tests | 100% PASS** ✅

---

## [1.0.0] — 2026-07-20

### Added — Initial Project Setup
- Inisialisasi proyek TypeScript: Fastify, Prisma ORM, Vitest, tsx.
- Skema database awal: `Customer`, `Reservation`, `Message`, `KnowledgeBase`, `FAQ`.
- WAHA client dasar (webhook receiver + send message).
- CLI Chat Simulator untuk testing lokal tanpa koneksi WhatsApp.
- Struktur folder: `src/routes/`, `src/services/`, `src/integrations/`, `tests/unit/`.
- `.env.example` dengan semua variable yang diperlukan.
