/**
 * domain/types.ts — Definisi tipe domain kanonis (PLAN 8 FASE 6).
 *
 * Masalah: `CustomerGoalSession`, `CartItem`, `ChildState`, `BookingState`,
 * `LocationState`, `MomProfileState`, `RecipientScope`, dll. terduplikasi di
 * 3 file (`goal-tracker.ts`, `cart-manager.ts`, `patient-extractor.ts`) dan
 * SUDAH DRIFT (mis. `BookingState` versi cart-manager tidak punya
 * `pendingScheduleCheck`).
 *
 * Solusi: satu sumber kebenaran di sini (diambil dari versi goal-tracker yang
 * paling lengkap). Ketiga file state mengimpor + mengekspor ulang dari sini
 * sehingga seluruh import path lama tetap berfungsi (zero breakage).
 *
 * Modul ini MURNI tipe + 1 konstanta — dilarang mengimpor modul state/service
 * apa pun (anti circular import).
 */

export interface LocationState {
  rawText: string;
  kelurahan?: string;
  kecamatan?: string;
  kota?: string;
  distanceKm?: number;
  ongkirNormal?: number;
  ongkirPromo?: number;
  isOutOfCoverage?: boolean;
}

export interface ChildState {
  id?: string;
  name?: string;
  /** Label penerima: 'Adik' | 'Kakak' | 'Si Kecil'. */
  roleLabel?: string;
  ageMonths?: number;
  symptoms: string[];
}

/** Subjek layanan multi-audience (Moms & Baby Spa): ibu, bayi, anak, atau keduanya. */
export type TargetAudienceType = 'MOMS' | 'BABY' | 'KIDS' | 'BOTH';

/** Kondisi klinis ibu: hamil, paska salin/nifas, menyusui, atau relaksasi umum. */
export type MomStage = 'PREGNANT' | 'POSTPARTUM' | 'BREASTFEEDING' | 'GENERAL';

/** Data klinis ibu (first-class, terpisah dari data anak — anti kontaminasi silang). */
export interface MomProfileState {
  stage?: MomStage;
  /** Usia kehamilan dalam minggu (misal: 38 untuk "uk 38 weeks"). */
  gestationalWeeks?: number;
  /** Durasi paska salin (misal: "2 minggu") — teks bebas dari customer. */
  postpartumPeriod?: string;
  /** Keluhan ibu (misal: pegal, kaki bengkak, capek, asi). */
  complaints: string[];
}

export interface BookingState {
  preferredDate?: string;
  preferredTime?: string;
  reservationId?: string;
  isConfirmed: boolean;
  /**
   * Skema human handling pasca-reservasi (sesi 462651): true bila reservasi
   * tercatat dan ketersediaan masih menunggu verifikasi staf. Mengaktifkan
   * acknowledgement gate di agent-runner (1x closing + handoff, anti loop).
   */
  needsStaffVerification?: boolean;
  /** True bila closing pasca-reservasi sudah dikirim (ack berikutnya senyap). */
  handoffClosingSent?: boolean;
  /**
   * Audit 337101 (anti CTA-looping): waktu yang DIMINTA customer
   * ("sekarang"/"hari ini"/nama hari) — dicatat saat sinyal jadwal terdeteksi
   * walau reservasi BELUM dibuat. Berbeda dari preferredDate (kesepakatan
   * yang sudah dikonfirmasi alur reservasi). Dipakai context-aware CTA.
   */
  requestedTimeHint?: string;
  /**
   * Plan 7 (Audit 216683): true bila customer meminta pengecekan ketersediaan
   * hari/slot jadwal dan sistem menunggu konfirmasi admin/staf (anti holding stall loop).
   */
  pendingScheduleCheck?: boolean;
}

/** Satu item layanan di keranjang (multi-item cart, deterministik). */
export interface CartItem {
  name: string;
  price: number;
  promoPrice?: number;
  type: 'PRIMARY' | 'ADDON' | 'SERVICE';
  category?: 'BABY' | 'KIDS' | 'MOMS' | 'BUNDLE' | 'ADDON';
  /** Label penerima tampil: 'Si Kecil', 'Adik (2 bln)', 'Kakak (3 th)', 'Bunda'. */
  recipientLabel?: string;
  recipientScope?: RecipientScope;
}

/** Lifecycle fakta ongkir: UNQUOTED → QUOTED (disampaikan) → CONFIRMED (lanjut booking). */
export type OngkirStatus = 'UNQUOTED' | 'QUOTED' | 'CONFIRMED';

export interface CustomerGoalSession {
  customerName?: string;
  genderGreeting: 'Bunda' | 'Bapak';
  location?: LocationState;
  /** Subjek layanan: MOMS (ibu), BABY/KIDS (anak), BOTH (Mom & Baby bundle). */
  targetAudience?: TargetAudienceType;
  /** Profil klinis ibu (kehamilan/nifas/relaksasi) — first-class, bukan childProfile. */
  momProfile?: MomProfileState;
  /** Profil anak pertama (backward compat). Multi-anak memakai `children`. */
  childProfile?: ChildState;
  /** Daftar anak (Adik/Kakak). childProfile selalu mirror children[0]. */
  children?: ChildState[];
  /**
   * Gerbang disambiguasi multi-anak (sesi 214956): true bila 2 usia anak
   * berbeda terdeteksi TANPA konfirmasi eksplisit ("anak saya 2" / label
   * peran Adik-Kakak). Selama true, LLM WAJIB bertanya konfirmasi lembut
   * sebelum mengunci total biaya (lihat mandat grounding). Dibersihkan saat
   * customer memberi sinyal jumlah eksplisit.
   */
  isMultiChildUnconfirmed?: boolean;
  selectedTreatment?: string;
  booking?: BookingState;
  cartItems?: CartItem[];
  /**
   * Plan regresi Fase 3 (pemisahan konsultasi vs transaksi): riwayat nama
   * layanan resmi yang sedang/telah DIKONSULTASIKAN (tanya khasiat, cara
   * kerja, kecocokan, durasi) — TERPISAH dari cartItems (transaksi).
   * Diisi deterministik oleh CartManager.syncCartItems; dibaca tool katalog
   * (closingIntent) agar tak menanyakan keluhan/paket berulang.
   */
  discussedTreatments?: string[];
  ongkirStatus?: OngkirStatus;
  totalPrice?: number;
  /**
   * Rule 5 (Active User Commitment Gate, sticky): true bila customer PERNAH
   * menyampaikan verba komitmen booking eksplisit ("deal", "fix", "booking",
   * "jadwalkan", "ambil", "mau yang itu", ...) di sesi ini. Bersifat lengket
   * (tidak di-reset oleh turn lanjutan) karena alur nyata: customer menyetujui
   * komitmen di satu turn, lalu MENJAWAB pertanyaan hari asisten di turn
   * berikutnya tanpa mengulang verba komitmen. save_reservation hanya boleh
   * dibuka bila flag ini true (via isDateConfirmed + gate masker).
   */
  bookingCommitConfirmed?: boolean;
  /**
   * Audit 854065 (MODE KONSULTASI vs TRANSASIONAL): true bila customer sudah
   * pernah bertanya harga/total di sesi ini. Mengontrol eksposur angka total
   * resmi di grounding prompt (disembunyikan selama konsultasi murni).
   */
  priceDiscussed?: boolean;
  /**
   * Fase E: penghitung form reservasi tak lengkap berurutan. Direset ke 0
   * saat form valid masuk; mencapai 2 → form tak lengkap berikutnya
   * dieskalasi sunyi (anti loop minta-lengkapi selamanya).
   */
  formRetryCount?: number;
  /** Kontraindikasi demam: true bila suhu ≥ ambang ClinicPolicy (default 37.8°C). */
  feverContraindication?: boolean;
  /**
   * ST6 (RC-05): verdict komitmen TERAKHIR dari Call 1 (persisten lintas turn).
   * Dipakai `syncCartItems` turn berikutnya sebagai gerbang anti-bocor: selama
   * verdict terakhir EXPLORING dan tidak ada sinyal komitmen baru, cart tidak
   * diisi ulang dari riwayat konsultasi.
   */
  lastCommitment?: CommitmentLevel;
}

/** Scope penerima layanan: satu anak yang sama vs pasien berbeda. */
export type RecipientScope = 'MOMS' | 'CHILD_1' | 'CHILD_2' | 'GENERAL';

/**
 * ST6 (Audit RC-05) — Tingkat komitmen customer pada satu giliran percakapan.
 * Ditentukan oleh SEMANTIK percakapan (Call 1 LLM yang sudah membaca history),
 * BUKAN oleh pencocokan string/tanda baca. Murni tipe — tanpa logika.
 *
 * - `EXPLORING`   : bertanya/bercerita/menjelajah (konsultasi). Cart DILARANG berubah.
 * - `CONSIDERING` : minat/menimbang, belum memutuskan. Cart DILARANG berubah.
 * - `COMMITTED`   : memutuskan mengambil layanan (komitmen aktif). Cart BOLEH berubah.
 */
export type CommitmentLevel = 'EXPLORING' | 'CONSIDERING' | 'COMMITTED';

/**
 * ST6 (Audit RC-05) — Interpretasi satu giliran percakapan dari Call 1.
 * Menjadi kontrak data antara pemahaman LLM dan konsumen deterministik
 * (CartManager, tool-masker). Guardrail deterministik tetap berlaku sebagai
 * PAGAR STATE (mis. save_reservation butuh COMMITTED), bukan sebagai otak.
 */
export interface TurnInterpretation {
  /** Tingkat komitmen pada giliran ini. */
  commitment: CommitmentLevel;
  /** ID layanan katalog yang benar-benar dirujuk/dipilih pada giliran ini (opsional). */
  referencedServiceIds?: string[];
  /** True bila customer meminta berbicara dengan manusia/admin (prioritas tertinggi). */
  handoffRequested?: boolean;
}


/**
 * Kata generik domain klinik — DILARANG menjadi token tunggal unik penentu
 * fuzzy matching. Mencegah sapaan bot ("Treatment moms & Baby...") memicu
 * phantom cart item via satu kata umum yang kebetulan unik di katalog.
 */
export const GENERIC_CLINIC_TOKENS = new Set([
  'treatment', 'treatments', 'layanan', 'service', 'services', 'homecare',
  'perawatan', 'terapi', 'therapy', 'pijat', 'massage', 'paket',
  'bunda', 'bayi', 'baby', 'anak', 'moms', 'klinik',
  // Kosakata kategori/usia generik (audit Turn 6): "balita usia 2 tahun"
  // BUKAN penanda paket spesifik — DILARANG mengunci layanan hanya dari ini.
  'balita', 'usia', 'umur', 'tahun', 'bulan', 'toddler',
]);
