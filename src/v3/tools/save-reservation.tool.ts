import { reservationCoreService } from '../../services/reservation-core.service';
import { BabyDetail } from '../../utils/reservation-text-parser';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { parseIndonesianDate } from '../../utils/indonesian-date-parser';
import { treatmentCatalogService } from '../../services/treatment-catalog.service';
import { GoalTracker } from '../state/goal-tracker';

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
  /** Kondisi ibu: Hamil, Paska Melahirkan/Nifas, atau Relaksasi Umum. */
  momStage?: 'PREGNANT' | 'POSTPARTUM' | 'GENERAL';
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
}

export interface SaveReservationOutput {
  success: boolean;
  reservationId?: string;
  summary: string;
  message: string;
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
          description: 'Tanggal atau hari kunjungan yang diinginkan (misal: "Sabtu, 5 September 2026", "Besok pagi").'
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
          enum: ['PREGNANT', 'POSTPARTUM', 'GENERAL'],
          description: 'Kondisi ibu (Hamil, Paska Melahirkan/Nifas, atau Relaksasi Umum).'
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
    momStage?: 'PREGNANT' | 'POSTPARTUM' | 'GENERAL';
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
  if (opts.isMulti) return 'BOTH';
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
    tenantId = DEFAULT_TENANT_ID
  } = input;

  try {
    // ── Pengayaan data sesi (tanpa penolakan — aturan 21) ──
    // Alamat wilayah sesi (desa/kelurahan dari perhitungan ongkir) sudah cukup
    // untuk pencatatan awal; nama Bunda & detail jalan dilengkapi via form
    // reservasi. Tool TIDAK PERNAH menolak booking karena data belum lengkap.
    let effectiveName = (customerName && customerName.trim()) || '';
    let effectiveAddress = (address && address.trim()) || '';
    if (conversationId && (!effectiveName || !effectiveAddress)) {
      try {
        const gateSession = await GoalTracker.getGoalSession(conversationId, tenantId);
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

    // Multi-treatment / multi-pasien: gabung semua layanan; kategori otomatis BOTH bila multi.
    const extraClean = (additionalTreatments || []).map((t) => String(t || '').trim()).filter(Boolean);
    const allTreatments = [treatmentName, ...extraClean.filter((t) => t.toLowerCase() !== treatmentName.toLowerCase())];
    const isMulti = allTreatments.length > 1 || children.length > 1;
    const treatmentDetail = allTreatments.join(' + ');
    // Kategori data-driven dari master katalog (tanpa tebakan regex):
    const treatmentCategory = resolveTreatmentCategory(allTreatments, {
      tenantId,
      momStage: momStage || undefined,
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
    const parsedDate = parsedResult.date;

    // Persistensi momProfile ke catatan reservasi (raw_text) agar bidan & admin
    // mengetahui usia kehamilan pasien — tanpa migrasi kolom baru (pola notes→raw_text).
    const momLines: string[] = [];
    if (gestationalWeeks != null) momLines.push(`Usia Kehamilan: ${gestationalWeeks} minggu`);
    if (momStage) {
      const stageLabel = momStage === 'PREGNANT' ? 'Ibu Hamil' : momStage === 'POSTPARTUM' ? 'Paska Salin/Nifas' : 'Relaksasi Umum';
      momLines.push(`Kondisi Ibu: ${stageLabel}`);
    }
    if (momNotes) momLines.push(`Keluhan Bunda: ${momNotes}`);
    if (notes) momLines.push(`Catatan: ${notes}`);
    const momRawSuffix = momLines.length > 0 ? `\n${momLines.join('\n')}` : '';
    const addressSuffix = effectiveAddress ? `\nAlamat: ${effectiveAddress}` : '';
    const effectiveRawText = `[V3_NATIVE_AGENT_TOOL] ${treatmentDetail} | ${bookingDate}${bookingTime ? ' ' + bookingTime : ''} | ${effectiveName || '-'}${momRawSuffix}${addressSuffix}`;

    // purchaseValue terstruktur: subtotal promo katalog + ongkir promo session.
    // Tidak lagi null — staff & CAPI memakai nilai ini sebagai nilai transaksi.
    const { subtotalPromo } = calcBookedSubtotal(allTreatments, tenantId);
    let ongkirPromo = 0;
    if (conversationId) {
      try {
        const purchaseSession = await GoalTracker.getGoalSession(conversationId, tenantId);
        ongkirPromo = purchaseSession.location?.ongkirPromo ?? 0;
      } catch (_) {}
    }
    const purchaseValue = subtotalPromo > 0 ? subtotalPromo + ongkirPromo : null;

    const result = await reservationCoreService.saveReservation({
      tenantId,
      customerId,
      chatId,
      treatmentCategory: treatmentCategory as any,
      treatmentDetail,
      bookingDate: parsedDate,
      rawText: effectiveRawText,
      babies,
      customerName: effectiveName || customerName,
      address: effectiveAddress || undefined,
      purchaseValue,
      source: 'AGENT',
      status: 'confirmed',
    });

    const summary = `Reservasi ${treatmentDetail} untuk ${effectiveName || 'Bunda'} pada ${bookingDate} berhasil dicatat (terjadwal).`;

    return {
      success: true,
      reservationId: result.reservation?.id,
      summary,
      message: `${summary} Jadwal akan kami bantu konfirmasi dan siap dijadwalkan ya Bunda 😊🙏`
    };
  } catch (error: any) {
    console.error(JSON.stringify({ event: 'V3_TOOL_RESERVATION_ERROR', tenantId, error: error.message, timestamp: new Date().toISOString() }));
    return {
      success: false,
      summary: 'Gagal mencatat reservasi',
      message: `Error mencatat reservasi: ${error.message}`
    };
  }
}
