import { reservationCoreService } from '../../services/reservation-core.service';
import { BabyDetail } from '../../utils/reservation-text-parser';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { parseIndonesianDate, applyBookingTimeToDate } from '../../utils/indonesian-date-parser';
import { buildCustomerReservationIntake } from '../../services/reservation-intake';
import { treatmentCatalogService } from '../../services/treatment-catalog.service';
import { GoalTracker } from '../state/goal-tracker';

/** C.1 (audit #199): true bila alamat memuat detail presisi (bukan sekadar kota luas). */
function hasPreciseLocationDetail(address: string): boolean {
  if (!address || !address.trim()) return false;
  const lower = address.toLowerCase().trim();
  const cities = ['surabaya', 'sidoarjo', 'gresik', 'sby', 'sda'];
  let s = lower;
  const prefixes = ['rumah d ', 'rumah di ', 'daerah ', 'wilayah ', 'di ', 'ke ', 'kecamatan ', 'kec ', 'kota ', 'kabupaten '];
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const p of prefixes) {
      if (s.startsWith(p)) { s = s.slice(p.length).trim(); stripped = true; break; }
    }
  }
  const parts = s.split(/[^a-z0-9]+/).filter(Boolean);
  const directions = ['barat', 'timur', 'selatan', 'utara', 'pusat'];
  // Hanya nama kota (atau kota + arah) → tidak presisi.
  if (cities.includes(s)) return false;
  if (parts.length === 2 && cities.includes(parts[0]) && directions.includes(parts[1])) return false;
  // Ada koma, angka rumah, atau >1 token selain kota → dianggap presisi.
  return parts.length >= 1;
}

export interface SaveReservationChild {
  name?: string;
  ageMonths?: number;
}

export interface SaveReservationInput {
  customerId: string;
  chatId: string;
  customerName?: string;
  treatmentName: string;
  /** Layanan tambahan untuk multi-treatment / multi-pasien (Mom+Baby, 2 anak). */
  additionalTreatments?: string[];
  bookingDate: string;
  bookingTime?: string;
  childName?: string;
  childAgeMonths?: number;
  /** Daftar anak untuk reservasi multi-pasien (otomatis jadi babies). */
  children?: SaveReservationChild[];
  /** Usia kehamilan ibu (minggu) bila pasien adalah ibu hamil — first-class, bukan usia anak. */
  gestationalWeeks?: number;
  /** Kondisi ibu: Hamil, Paska Melahirkan/Nifas, Menyusui, atau Relaksasi Umum. */
  momStage?: 'PREGNANT' | 'POSTPARTUM' | 'BREASTFEEDING' | 'GENERAL';
  /** Keluhan/catatan ibu untuk bidan & admin (mis. "capek, kaki bengkak"). */
  momNotes?: string;
  notes?: string;
  tenantId?: string;
  /**
   * Alamat lengkap kunjungan homecare (nama jalan / nomor rumah / patokan).
   * Wajib terisi detail jalan untuk booking valid (validation gate).
   */
  address?: string;
  /**
   * ID percakapan untuk validation gate (nama & alamat dari session).
   * Bila tidak diisi, gate dilewati (kompatibilitas pemanggilan langsung/test).
   */
  conversationId?: string;
  /**
   * Audit 833178 (anti-halusinasi hari): teks pesan USER terkini (riwayat
   * inbound + pesan masuk) untuk verifikasi bahwa hari/tanggal di bookingDate
   * benar-benar DISEBUT customer — BUKAN karangan LLM. Diisi agent-runner via
   * tool-registry; kosong = gate dilewati (kompatibilitas test langsung).
   */
  dayMentionEvidence?: string[];
  /**
   * Alamat tersimpan (buku alamat) yang dijadikan titik kunjungan — disuntik
   * pipeline deterministik dari sesi (activeSavedAddress), BUKAN argumen LLM.
   * Ditulis sebagai tag `[SAVED_ADDR id=... label=...]` di ekor raw_text.
   */
  savedAddress?: { id?: string; label?: string };
  /** Snapshot nominal ongkir (dari sesi) untuk kolom Reservation.delivery_fee. */
  deliveryFee?: number;
}

/**
 * Otoritas tunggal verifikasi kesepakatan hari diekstrak ke src/utils/date-confirmation.ts
 * untuk dipakai bersama oleh State Machine (tool gating) & save-reservation.tool (defense-in-depth).
 */
import {
  DAY_EVIDENCE_WORDS,
  SAME_DAY_EVIDENCE_ALIASES,
  isSameDayRequestText,
  isPastBookingDateText,
  verifyDayMentioned,
} from '../../utils/date-confirmation';

export {
  DAY_EVIDENCE_WORDS,
  SAME_DAY_EVIDENCE_ALIASES,
  isSameDayRequestText,
  isPastBookingDateText,
  verifyDayMentioned,
};

export interface SaveReservationOutput {
  success: boolean;
  reservationId?: string;
  summary: string;
  message: string;
  /**
   * Audit 337101 (same-day dispatch trap): true bila booking diminta untuk
   * hari ini — Call 2 wajib memakai copy ekspektasi-aman (tanpa janji OTW).
   */
  isSameDay?: boolean;
  /**
   * @deprecated Gate penolakan booking dihapus (aturan 21: alamat wilayah sesi
   * sudah cukup; kelengkapan via form reservasi). Selalu undefined — dipertahankan
   * agar konsumen lama tidak rusak.
   */
  needsInfo?: string[];
}

/** Penanda alamat jalan detail (data-driven includes, tanpa regex). */
const STREET_DETAIL_MARKERS = [
  'jalan', 'jl ', 'jln ', 'gang', 'gg ', 'nomor', 'no ', 'no.', 'nomer',
  'rt ', 'rt/', 'rw ', 'rw/', 'blok', 'perum', 'residence', 'cluster',
  'regency', 'villa', 'apartemen', 'patokan', 'depan', 'samping', 'belakang',
  'sebelah', 'dekat',
];

/** True bila alamat memuat detail jalan/nomor rumah/patokan (bukan sekadar desa). */
export function hasStreetDetail(address: string | undefined): boolean {
  const lower = (address || '').toLowerCase();
  if (!lower || lower.trim().length < 6) return false;
  if (STREET_DETAIL_MARKERS.some((m) => lower.includes(m))) return true;
  // Nomor rumah: ada digit dan panjang cukup ("Kedungkendo 12", "Waru no 5")
  const hasDigit = lower.includes('0') || lower.includes('1') || lower.includes('2')
    || lower.includes('3') || lower.includes('4') || lower.includes('5')
    || lower.includes('6') || lower.includes('7') || lower.includes('8') || lower.includes('9');
  return hasDigit && lower.trim().length >= 8;
}

/** Nama generik/placeholder yang TIDAK sah sebagai nama Bunda (data-driven). */
const GENERIC_CUSTOMER_NAMES = [
  'bunda', 'ibu', 'bapak', 'kak', 'sandbox customer', 'customer', 'pasien', '-', 'bu', 'null',
];

/** True bila nama belum lengkap/sah untuk booking homecare. */
export function isGenericCustomerName(name: string | undefined): boolean {
  const trimmed = (name || '').trim();
  if (trimmed.length < 2) return true;
  const lower = trimmed.toLowerCase();
  if (lower.includes('*')) return true;
  return GENERIC_CUSTOMER_NAMES.some((g) => lower === g);
}

/**
 * Batas usia anak untuk label klinis NIFAS (audit Turn 8: ibu dari anak
 * usia 2 tahun BUKAN pasien nifas — masa nifas ±40–60 hari pasca persalinan).
 * TODO(tenant-aware): ambang klinis idealnya dari kebijakan per-tenant di DB
 * (mis. tabel ClinicPolicy) — konstanta sementara agar guard fail-closed
 * langsung aktif; tercatat di docs/KNOWN_ISSUES.md.
 */
export const POSTPARTUM_MAX_CHILD_AGE_MONTHS = 2;

/** Pure (testable): true bila momStage POSTPARTUM sah ditulis untuk usia anak tertua ini. */
export function isPostpartumStageValid(eldestChildAgeMonths: number | null | undefined): boolean {
  if (eldestChildAgeMonths == null) return true; // usia tak diketahui → jangan tolak, cukup grounding
  return eldestChildAgeMonths <= POSTPARTUM_MAX_CHILD_AGE_MONTHS;
}

export const SAVE_RESERVATION_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'save_reservation',
    description: 'Mencatat jadwal booking/reservasi treatment homecare yang telah disepakati bersama customer ke database klinik (status langsung terjadwal/confirmed). Dipanggil bila hari/tanggal dan treatment sudah disepakati — nama Bunda dan alamat detail jalan TIDAK wajib di tahap chat (dilengkapi via form reservasi). Alamat wilayah sesi (desa/kelurahan dari perhitungan ongkir) sudah cukup. Mendukung multi-treatment & multi-pasien (Mom+Baby, 2 anak): isi additionalTreatments dan children bila ada lebih dari 1 layanan/pasien.',
    parameters: {
      type: 'object',
      properties: {
        customerName: {
          type: 'string',
          description: 'Nama orang tua / customer (misal: "Bunda Rina", "Bapak Naufal").'
        },
        treatmentName: {
          type: 'string',
          description: 'Nama paket treatment utama yang dipilih (misal: "Pijat Bayi Pulih Ceria", "Pijat Bayi Ceria").'
        },
        additionalTreatments: {
          type: 'array',
          items: { type: 'string' },
          description: 'Daftar layanan tambahan untuk multi-treatment/multi-pasien (misal: ["Oksitosin Massage Fullbody", "Cukur Rambut Bayi"]). Otomatis menjadikan kategori BUNDLE.'
        },
        children: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Nama anak (opsional).' },
              ageMonths: { type: 'number', description: 'Usia anak dalam bulan (opsional).' }
            }
          },
          description: 'Daftar anak untuk reservasi multi-pasien (misal: Adik 2 bulan + Kakak 36 bulan). Masing-masing tersimpan ke tabel children.'
        },
        bookingDate: {
          type: 'string',
          description: 'Tanggal atau hari kunjungan yang EKSPLISIT DISEBUTKAN OLEH CUSTOMER di chat (misal: "Sabtu, 5 September 2026", "Besok pagi"). DILARANG KERAS memanggil tool ini jika customer belum menyebutkan hari/tanggal sama sekali di chat (misal customer baru bilang "saya ambil treatment nya")! DILARANG menebak atau mengarang hari sendiri (misal mengarang "Besok") — tool ini memverifikasi jejak hari di riwayat dan MENOLAK pemanggilan tanpa bukti!'
        },
        bookingTime: {
          type: 'string',
          description: 'Jam kunjungan yang diinginkan (misal: "10.00 WIB", "09.00", "Sore jam 14.00").'
        },
        childName: {
          type: 'string',
          description: 'Nama si kecil / bayi (opsional).'
        },
        childAgeMonths: {
          type: 'number',
          description: 'Usia si kecil dalam bulan (opsional). JANGAN diisi dengan usia kehamilan ibu.'
        },
        gestationalWeeks: {
          type: 'number',
          description: 'Usia kehamilan ibu dalam minggu (mis. 38) bila pasien adalah ibu hamil.'
        },
        momStage: {
          type: 'string',
          enum: ['PREGNANT', 'POSTPARTUM', 'BREASTFEEDING', 'GENERAL'],
          description: 'Kondisi ibu (Hamil, Paska Melahirkan/Nifas, Menyusui/Laktasi, atau Relaksasi Umum).'
        },
        momNotes: {
          type: 'string',
          description: 'Keluhan/catatan ibu untuk bidan & admin (mis. "capek, kaki bengkak").'
        },
        notes: {
          type: 'string',
          description: 'Catatan tambahan seperti keluhan khusus, patokan rumah, dll. (opsional).'
        },
        address: {
          type: 'string',
          description: 'Alamat kunjungan homecare bila sudah diketahui (mis. "Jl Mawar no 12, Kedungkendo"). Opsional — alamat wilayah sesi sudah cukup; detail dilengkapi via form reservasi.'
        },
        commitment: {
          type: 'string',
          enum: ['EXPLORING', 'CONSIDERING', 'COMMITTED'],
          description: 'Penilaian SEMANTIK atas seluruh percakapan: EXPLORING (bertanya/menjelajah), CONSIDERING (menimbang/minat), COMMITTED (sudah memutuskan mengambil layanan). Berdasarkan makna & konteks.'
        }
      },
      required: ['treatmentName', 'bookingDate']
    }
  }
};

/**
 * Resolver kategori treatment data-driven (tanpa tebakan regex):
 * 1. Cocokkan setiap nama layanan ke master TreatmentCatalogService (tenant-aware),
 *    ambil category resmi item yang cocok.
 * 2. Multi-treatment Mom+Baby (atau flag isMulti) → BOTH.
 * 3. Fallback bila tidak ada yang cocok di katalog: entity pasien terstruktur
 *    (momStage/gestationalWeeks vs babies/children).
 */
export function resolveTreatmentCategory(
  treatmentNames: string[],
  opts: {
    tenantId?: string;
    momStage?: 'PREGNANT' | 'POSTPARTUM' | 'BREASTFEEDING' | 'GENERAL';
    gestationalWeeks?: number;
    hasChildren?: boolean;
    isMulti?: boolean;
  } = {}
): 'BABY' | 'KIDS' | 'MOMS' | 'BOTH' {
  const names = (treatmentNames || []).map((t) => String(t || '').trim().toLowerCase()).filter(Boolean);
  const matchedCategories = new Set<string>();
  try {
    const catalog = treatmentCatalogService.getAllServices(true, opts.tenantId || DEFAULT_TENANT_ID);
    for (const q of names) {
      const hit = catalog.find((s) => s.name.toLowerCase() === q)
        || catalog.find((s) => s.name.toLowerCase().includes(q) || q.includes(s.name.toLowerCase()));
      if (hit?.category) matchedCategories.add(hit.category);
    }
  } catch (_) {}
  const hasMomCat = matchedCategories.has('MOMS') || [...matchedCategories].some((c) => c.includes('MOMS'));
  const hasBabyCat = matchedCategories.has('BABY');
  const hasKidsCat = matchedCategories.has('KIDS');
  const hasMomEntity = Boolean(opts.momStage || opts.gestationalWeeks != null);
  if (opts.isMulti && ((hasMomCat || hasMomEntity) && (hasBabyCat || hasKidsCat || opts.hasChildren))) return 'BOTH';
  if (hasMomCat && !hasBabyCat && !hasKidsCat) return 'MOMS';
  if ((hasBabyCat || hasKidsCat) && !hasMomCat) return hasKidsCat && !hasBabyCat ? 'KIDS' : 'BABY';
  if (hasMomCat && (hasBabyCat || hasKidsCat)) return 'BOTH';
  // Fallback entity pasien terstruktur (layanan tidak dikenal di katalog)
  if (hasMomEntity && opts.hasChildren) return 'BOTH';
  if (hasMomEntity) return 'MOMS';
  return 'BABY';
}

/**
 * Hitung subtotal promo semua layanan yang dibooking dari master katalog.
 * Mengembalikan null bila tidak ada layanan yang cocok (pemanggil memakai fallback).
 */
export function calcBookedSubtotal(
  treatmentNames: string[],
  tenantId: string = DEFAULT_TENANT_ID
): { subtotalPromo: number; subtotalNormal: number; matched: number } {
  let subtotalPromo = 0;
  let subtotalNormal = 0;
  let matched = 0;
  try {
    const catalog = treatmentCatalogService.getAllServices(true, tenantId);
    for (const qRaw of treatmentNames || []) {
      const q = String(qRaw || '').trim().toLowerCase();
      if (!q) continue;
      const hit = catalog.find((s) => s.name.toLowerCase() === q)
        || catalog.find((s) => s.name.toLowerCase().includes(q) || q.includes(s.name.toLowerCase()));
      if (hit) {
        matched++;
        subtotalPromo += hit.promoPrice;
        subtotalNormal += hit.originalPrice;
      }
    }
  } catch (_) {}
  return { subtotalPromo, subtotalNormal, matched };
}

export async function executeSaveReservation(input: SaveReservationInput): Promise<SaveReservationOutput> {
  const {
    customerId,
    chatId,
    customerName,
    treatmentName,
    additionalTreatments = [],
    bookingDate,
    bookingTime,
    childName,
    childAgeMonths,
    children = [],
    gestationalWeeks,
    momStage,
    momNotes,
    notes,
    address,
    conversationId,
    dayMentionEvidence,
    tenantId = DEFAULT_TENANT_ID
  } = input;

  // Audit 833178 — Day Evidence Gate: verifikasi SEBELUM tulis DB apa pun.
  // Gagal = success:false + arahan tanya hari (reservasi TIDAK tercatat).
  const dayGateError = verifyDayMentioned(bookingDate, dayMentionEvidence);
  if (dayGateError) {
    console.warn(JSON.stringify({ event: 'V3_TOOL_RESERVATION_DAY_GATE_REJECTED', tenantId, bookingDate, timestamp: new Date().toISOString() }));
    return {
      success: false,
      summary: 'Hari/tanggal belum ditentukan oleh customer',
      message: dayGateError,
    };
  }

  // Audit 310995 — Temporal Gate (fail-closed): tolak tanggal yang sudah
  // berlalu. Parser menggulir masa lalu ke masa depan secara SENYAP (mis.
  // "18 Agustus 2026" saat kini September 2026 → 2027), sehingga tervalidasi
  // tanpa ini akan menyimpan tanggal yang salah. Wajib konfirmasi ulang.
  if (isPastBookingDateText(bookingDate)) {
    console.warn(JSON.stringify({ event: 'V3_TOOL_RESERVATION_PAST_DATE_REJECTED', tenantId, bookingDate, timestamp: new Date().toISOString() }));
    return {
      success: false,
      summary: 'Tanggal kunjungan sudah terlewat',
      message: `Permintaan jadwal kunjungan pada "${bookingDate}" tidak dapat diproses karena tanggal tersebut sudah berlalu dari kalender hari ini. Mohon tanyakan kembali kepada Bunda tanggal dan bulan yang dimaksud untuk kami bantu cekkan jadwalnya.`,
    };
  }

  try {
    // ── Pengayaan data sesi (tanpa penolakan — aturan 21) ──
    // Alamat wilayah sesi (desa/kelurahan dari perhitungan ongkir) sudah cukup
    // untuk pencatatan awal; nama Bunda & detail jalan dilengkapi via form
    // reservasi. Tool TIDAK PERNAH menolak booking karena data belum lengkap.
    let effectiveName = (customerName && customerName.trim()) || '';
    let effectiveAddress = (address && address.trim()) || '';
    let gateSession: any = null;
    if (conversationId) {
      try {
        gateSession = await GoalTracker.getGoalSession(conversationId, tenantId);
        if (!effectiveName && gateSession.customerName && !isGenericCustomerName(gateSession.customerName)) {
          effectiveName = gateSession.customerName;
        }
        if (!effectiveAddress) {
          const loc = gateSession.location;
          effectiveAddress = loc?.rawText
            || [loc?.kelurahan, loc?.kecamatan, loc?.kota].filter(Boolean).join(', ')
            || '';
        }
      } catch (_) {}
    }
    // C.1: lokasi presisi bila ada kelurahan/kecamatan/kota terstruktur di sesi.
    const structuredPrecise = Boolean(
      gateSession?.location?.kelurahan || gateSession?.location?.kecamatan || gateSession?.location?.kota
    );

    // Fail-closed Prasyarat Lokasi (Homecare Clinic Safety):
    // Jika conversationId ada dan effectiveAddress kosong (tidak ada alamat fisik
    // maupun wilayah/kelurahan dari sesi), TOLAK reservasi dan arahkan asisten
    // untuk menanyakan lokasi/daerah terlebih dahulu (Aturan Emas 5a).
    if (conversationId && !effectiveAddress) {
      console.warn(JSON.stringify({
        event: 'V3_TOOL_RESERVATION_LOCATION_MISSING',
        tenantId,
        conversationId,
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        summary: 'Lokasi customer belum diketahui',
        message: 'Lokasi/wilayah Bunda belum diketahui. Untuk layanan homecare, tanyakan terlebih dahulu daerah/kelurahan/kecamatan rumah Bunda dengan ramah agar tim Bidan dapat memastikan jangkauan dan ketersediaan rute.',
      };
    }

    // C.1 (audit #199): alamat efektif hanyalah nama KOTA LUAS (mis. "Surabaya")
    // tanpa kelurahan/kecamatan presisi → TAHAN reservasi (jangan kunci jadwal
    // dengan rute yang tak terverifikasi). Bila hanya sampai sini, catat untuk
    // admin (notifikasi in-app) agar bisa ditindaklanjuti, lalu minta detail.
    if (conversationId && !structuredPrecise && !hasPreciseLocationDetail(effectiveAddress)) {
      console.warn(JSON.stringify({
        event: 'V3_TOOL_RESERVATION_LOCATION_IMPRECISE',
        tenantId,
        conversationId,
        addressPreview: effectiveAddress.slice(0, 60),
        timestamp: new Date().toISOString(),
      }));
      try {
        const { notificationDeliveryService } = await import('../../services/notification-delivery.service');
        await notificationDeliveryService.send({
          tenantId,
          channel: 'SYSTEM',
          recipient: 'admin',
          type: 'ALERT_URGENT',
          title: 'Reservasi tertahan: lokasi terlalu luas',
          messageContent: `Percakapan ${conversationId} mencoba booking dengan lokasi hanya "${effectiveAddress}" (belum ada kelurahan/kecamatan presisi). Mohon follow-up.`,
          metadata: { conversationId, address: effectiveAddress },
        });
      } catch { /* notifikasi best-effort — jangan menggagalkan arah balasan */ }
      return {
        success: false,
        summary: 'Lokasi terlalu luas',
        message: `Lokasi "${effectiveAddress}" masih terlalu luas untuk mengunci jadwal homecare. Tanyakan dengan ramah kelurahan/desa atau patokan terdekat agar tim Bidan dapat memastikan rute dan jadwalnya.`,
      };
    }

    // Validasi medis momStage (fail-closed): POSTPARTUM DILARANG ditulis ke
    // rekam reservasi bila anak tertua sudah lewat masa nifas (mis. balita
    // 2 tahun) — turunkan ke GENERAL agar label "Paska Salin/Nifas" tak
    // menempel pada ibu yang bukan pasien nifas. Usia tak diketahui → lolos.
    const knownAges: number[] = children.length > 0
      ? children.map((c) => c.ageMonths).filter((n): n is number => typeof n === 'number')
      : (typeof childAgeMonths === 'number' ? [childAgeMonths] : []);
    const eldestChildAgeMonths: number | null = knownAges.length > 0 ? Math.max(...knownAges) : null;
    const effectiveMomStage =
      momStage === 'POSTPARTUM' && !isPostpartumStageValid(eldestChildAgeMonths) ? undefined : momStage;
    if (momStage === 'POSTPARTUM' && effectiveMomStage === undefined) {
      console.warn(JSON.stringify({ event: 'V3_TOOL_RESERVATION_POSTPARTUM_DOWNGRADED', tenantId, eldestChildAgeMonths, timestamp: new Date().toISOString() }));
    }

    // Multi-treatment / multi-pasien: gabung semua layanan; kategori otomatis BOTH bila multi.
    const extraClean = (additionalTreatments || []).map((t) => String(t || '').trim()).filter(Boolean);
    const allTreatments = [treatmentName, ...extraClean.filter((t) => t.toLowerCase() !== treatmentName.toLowerCase())];

    // Validasi layanan add-on: add-on tidak boleh dipesan berdiri sendiri tanpa main treatment
    const addonValidation = treatmentCatalogService.validateReservationTreatments(allTreatments);
    if (!addonValidation.valid) {
      console.warn(JSON.stringify({
        event: 'V3_TOOL_RESERVATION_ADDON_ONLY_REJECTED',
        tenantId,
        allTreatments,
        error: addonValidation.error,
        timestamp: new Date().toISOString(),
      }));
      return {
        success: false,
        summary: 'Layanan add-on memerlukan layanan utama',
        message: `${addonValidation.error || 'Layanan tambahan tidak dapat dipesan sendiri.'} Mohon tanyakan kepada Bunda paket treatment utama yang diinginkan (misal Pijat Bayi Ceria/Pulih Ceria atau Oksitosin) untuk digabungkan dengan layanan tersebut ya.`,
      };
    }

    const isMulti = allTreatments.length > 1 || children.length > 1;
    const treatmentDetail = allTreatments.join(' + ');
    // Kategori data-driven dari master katalog (tanpa tebakan regex):
    const treatmentCategory = resolveTreatmentCategory(allTreatments, {
      tenantId,
      momStage: effectiveMomStage || undefined,
      gestationalWeeks: gestationalWeeks ?? undefined,
      hasChildren: children.length > 0 || Boolean(childName),
      isMulti,
    });

    const babies: BabyDetail[] = children.length > 0
      ? children.map((c, i) => ({ name: c.name || `Anak ${i + 1}`, age: c.ageMonths != null ? `${c.ageMonths} bulan` : '0 bulan' }))
      : (childName
        ? [{ name: childName, age: childAgeMonths ? `${childAgeMonths} bulan` : '0 bulan' }]
        : []);

    const parsedResult = parseIndonesianDate(bookingDate);
    let parsedDate = parsedResult.date;
    // Fase 2R: terapkan jam booking eksplisit (WIB → UTC) secara terpusat
    if (bookingTime && typeof bookingTime === 'string' && bookingTime.trim()) {
      parsedDate = applyBookingTimeToDate(parsedDate, bookingTime);
    }

    // Audit 337101 (same-day dispatch trap): permintaan hari ini DILARANG
    // dijanjikan kedatangan langsung (slot & rute belum terverifikasi admin).
    // #157a: kontrak intake kanonis di seam `reservation-intake` (same-day →
    // pending + [SAME_DAY_REQUEST] + requestId) — SAMA dengan jalur form WA,
    // tanpa duplikasi logika.
    const intake = buildCustomerReservationIntake({
      tenantId,
      customerId,
      treatmentDetail,
      bookingDate: parsedDate,
      sameDayText: isSameDayRequestText(bookingDate),
    });
    const isSameDay = intake.isSameDay;

    // Persistensi momProfile ke catatan reservasi (raw_text) agar bidan & admin
    // mengetahui usia kehamilan pasien — tanpa migrasi kolom baru (pola notes→raw_text).
    const momLines: string[] = [];
    if (gestationalWeeks != null) momLines.push(`Usia Kehamilan: ${gestationalWeeks} minggu`);
    if (effectiveMomStage) {
      const stageLabel = effectiveMomStage === 'PREGNANT' ? 'Ibu Hamil' : effectiveMomStage === 'POSTPARTUM' ? 'Paska Salin/Nifas' : effectiveMomStage === 'BREASTFEEDING' ? 'Ibu Menyusui/Laktasi' : 'Relaksasi Umum';
      momLines.push(`Kondisi Ibu: ${stageLabel}`);
    }
    if (momNotes) momLines.push(`Keluhan Bunda: ${momNotes}`);
    if (notes) momLines.push(`Catatan: ${notes}`);
    const momRawSuffix = momLines.length > 0 ? `\n${momLines.join('\n')}` : '';
    const addressSuffix = effectiveAddress ? `\nAlamat: ${effectiveAddress}` : '';
    // Buku alamat (Fase 3): tag identitas alamat tersimpan di ekor raw_text.
    // Admin mengandalkan id ini untuk menemukan entri saved_addresses saat
    // re-map alamat — tanpa kolom baru (Opsi A).
    const savedAddrSuffix =
      input.savedAddress?.id
        ? `\n[SAVED_ADDR id=${input.savedAddress.id}${input.savedAddress.label ? ` label=${input.savedAddress.label}` : ''}]`
        : '';
    const effectiveRawText = `[V3_NATIVE_AGENT_TOOL] ${treatmentDetail} | ${bookingDate}${bookingTime ? ' ' + bookingTime : ''} | ${effectiveName || '-'}${momRawSuffix}${addressSuffix}${savedAddrSuffix}`;

    // purchase_value = murni subtotal promo layanan (tanpa ongkir).
    // Ongkir tercatat terpisah di Customer.ongkir — mencegah double-ongkir
    // saat staff menghitung totalFee = treatmentFee (purchase_value) + deliveryFee (ongkir).
    const { subtotalPromo } = calcBookedSubtotal(allTreatments, tenantId);
    const purchaseValue = subtotalPromo > 0 ? subtotalPromo : null;

    const result = await reservationCoreService.saveReservation({
      tenantId,
      customerId,
      chatId,
      treatmentCategory: treatmentCategory as any,
      treatmentDetail,
      bookingDate: parsedDate,
      rawText: isSameDay ? `${intake.sameDayTag}\n${effectiveRawText}` : effectiveRawText,
      babies,
      customerName: effectiveName || customerName,
      address: effectiveAddress || undefined,
      purchaseValue,
      source: 'AGENT',
      status: intake.status,
      // Snapshot ongkir (Fase 3 buku alamat): idempoten per-reservasi, fallback
      // resolver membaca Customer.ongkir bila null.
      deliveryFee: input.deliveryFee,
      customerAddressId: input.savedAddress?.id || null,
      // Stage 7 (R6): idempotency key stabil untuk retry webhook yang sama.
      // FIX 173f: sertakan JAM WIB (HH:MM) agar dua booking treatment sama pada
      // slot BERBEDA (pagi & sore) tidak saling menimpa via short-circuit
      // idempoten. Tanggal memakai kanonis WIB (bukan UTC slice) agar stabil
      // di sekitar tengah malam WIB. (#157a: disatukan di reservation-intake.)
      requestId: intake.requestId,
    });

    const summary = `Reservasi ${treatmentDetail} untuk ${effectiveName || 'Bunda'} pada ${bookingDate} berhasil dicatat (${isSameDay ? 'menunggu cek jadwal hari ini' : 'terjadwal'}).`;

    // KB-4 (2026-09-30): bila customer tidak menyebut jam kunjungan, sistem
    // memakai default pukul 09.00 WIB dari parser — WAJIB diberi tahu ke
    // customer dalam balasan agar tidak menjadi janji sepihak yang salah.
    const bookingTimeExplicit = !!(bookingTime && typeof bookingTime === 'string' && bookingTime.trim());
    const defaultTimeNote = bookingTimeExplicit
      ? ''
      : ' Jam kunjungan belum disebutkan, jadi kami catat pukul 09.00 WIB ya Bunda. Kalau mau jam lain, silakan beri tahu kami 🙏';

    return {
      success: true,
      reservationId: result.reservation?.id,
      summary,
      isSameDay,
      // Copy ekspektasi-aman (audit 694493): transparan tanpa klaim finalisasi
      // sepihak — permintaan ditampung untuk dicek slot oleh tim Bidan.
      message: isSameDay
        ? 'Kalau hari ini kemungkinan jadwal kami penuh bunda. Untuk memastikan, kami coba cek jadwal dulu ya bund 😊🙏'
        : `Permintaan jadwal kunjungan ${treatmentDetail} pada hari ${bookingDate} sudah kami tampung ya Bunda 😊 Untuk ketersediaan slot pastinya, kami bantu cekkan ketersediaan jadwal tim Bidan kami dulu ya Bunda 🙏 Nanti segera kami kabari ya bund 🤗${defaultTimeNote}`
    };
  } catch (error: any) {
    console.error(JSON.stringify({ event: 'V3_TOOL_RESERVATION_ERROR', tenantId, error: error.message, timestamp: new Date().toISOString() }));
    // KB-3: kuota kapasitas harian penuh → arahkan jadwal ke hari lain (tanpa
    // mengklaim slot tersedia). Pesan tetap ramah & actionable untuk asisten.
    if (error?.code === 'CAPACITY_EXCEEDED') {
      return {
        success: false,
        summary: 'Kapasitas jadwal hari itu penuh',
        message: `Untuk tanggal tersebut, jadwal tim Bidan kami sudah penuh ya Bunda. Mohon tawarkan Bunda tanggal atau hari lain agar kami bantu cekkan ketersediaannya 😊`,
      };
    }
    return {
      success: false,
      summary: 'Gagal mencatat reservasi',
      message: `Error mencatat reservasi: ${error.message}`
    };
  }
}
