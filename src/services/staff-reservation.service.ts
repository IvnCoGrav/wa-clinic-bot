import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { calculateHaversineDistance, Coordinates } from '../utils/haversine';
import { clinicConfig } from '../config/clinic';
import { resolveTreatmentValue } from './capi.service';
import {
  getStaffChatWindowConfig,
  StaffChatWindowConfig,
} from '../config/staff-chat-window-config';

export interface StaffTaskChild {
  name: string;
  rawAgeText: string | null;
  birthDate: string | null;
}

export interface StaffTaskAddress {
  kelurahan: string | null;
  kecamatan: string | null;
  kota: string | null;
  lat?: number | null;
  lng?: number | null;
  distanceKm: number | null;
  estimatedMinutes?: number | null;
  fullText: string;
  distanceSource?: 'CLINIC' | 'PREVIOUS_PATIENT' | null;
  originName?: string | null;
  housePhotoUrl?: string | null;
  landmark?: string | null;
}

export interface StaffTaskPricing {
  treatmentFee: number;
  deliveryFee: number;
  totalFee: number;
  paymentStatus: 'LUNAS' | 'TAGIH_DI_TEMPAT';
  paymentStatusLabel: string;
}

export interface StaffTaskItem {
  reservationId: string;
  customerName: string | null;
  treatmentDetail: string | null;
  treatmentCategory: string | null;
  bookingDate: Date | null;
  status: string;
  otwSentAt?: Date | string | null;
  arrivedAt?: Date | string | null;
  conversationId: string | null;
  mapsUrl: string | null;
  navigationUrl: string | null;
  address: StaffTaskAddress;
  children: StaffTaskChild[];
  pricing: StaffTaskPricing;
  shareLocationText: string | null;
  customerProfilePictureUrl?: string | null;
  assignedStaff?: { id: string; name: string; role?: string } | null;
  customerStats?: {
    totalTreatments: number;
    ltv: number;
  };
  /**
   * Status jendela akses chat (server-driven, sumber kebenaran tunggal).
   * Frontend hanya merender; keputusan waktu tidak dihitung ulang di klien.
   */
  chatWindow?: {
    open: boolean;
    reason: ChatWindowReason;
    opensAt?: string | null;
    closesAt?: string | null;
  };
}

function buildAddressText(c: {
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
}): string {
  const parts: string[] = [];
  if (c.kelurahan) parts.push(`Kel. ${c.kelurahan}`);
  if (c.kecamatan) parts.push(`Kec. ${c.kecamatan}`);
  if (c.kota) parts.push(c.kota);
  return parts.join(', ') || 'Alamat belum tercatat lengkap';
}

/**
 * Menghitung estimasi durasi tempuh perjalanan sepeda motor (dalam menit).
 * Dikalibrasi dari benchmark rute nyata Google Maps: ~2.05 menit/km + buffer lampu merah/gang 2 menit.
 */
export function estimateTravelDurationMinutes(distanceKm: number | null): number | null {
  if (distanceKm == null || distanceKm <= 0) return null;
  return Math.max(3, Math.round(distanceKm * 2.05 + 2));
}

function buildShareText(
  name: string | null,
  address: string,
  treatment: string | null,
  mapsUrl: string | null,
  pricing: StaffTaskPricing
): string {
  const lines: string[] = [
    `📍 *TUGAS HOMECARE TERAPIS*`,
    `👤 Pasien: ${name || 'Bunda'}`,
    `🏠 Alamat: ${address}`,
  ];
  if (treatment) lines.push(`💆 Treatment: ${treatment}`);
  lines.push(`💰 Total Bayar: Rp ${pricing.totalFee.toLocaleString('id-ID')} (${pricing.paymentStatusLabel})`);
  if (mapsUrl) lines.push(`🗺️ Google Maps: ${mapsUrl}`);
  return lines.join('\n');
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Titik awal hari (00:00 WIB) untuk sebuah instant, dikembalikan sebagai Date UTC.
 * Dipakai sebagai batas absolut "ganti hari" (pergantian hari WIB).
 */
export function getWibStartOfDay(instant: Date = new Date()): Date {
  const wib = new Date(instant.getTime() + 7 * HOUR_MS);
  const y = wib.getUTCFullYear();
  const m = wib.getUTCMonth();
  const d = wib.getUTCDate();
  return new Date(Date.UTC(y, m, d, -7, 0, 0, 0));
}

export type ChatWindowReason =
  | 'SUPERVISOR'
  | 'OPEN'
  | 'NOT_YET_OPEN'
  | 'CLOSED_AFTER_COMPLETE'
  | 'PREVIOUS_DAY'
  | 'NO_ACTIVE_BOOKING';

export interface ChatWindowStatus {
  open: boolean;
  reason: ChatWindowReason;
  opensAt?: Date | null;
  closesAt?: Date | null;
}

/**
 * Evaluasi deterministik jendela akses chat untuk SATU jadwal (pure function).
 *
 * - Non-supervisor: terbuka mulai `openHoursBefore` jam sebelum jam treatment,
 *   tertutup `closeHoursAfter` jam setelah treatment diselesaikan, dan tertutup
 *   total saat pergantian hari WIB (00:00) — batas ganti hari menang atas +N jam.
 * - Supervisor: selalu terbuka (override).
 *
 * Sengaja bebas regex / pencocokan string; keputusan murni dari state waktu & jadwal.
 */
export function evaluateChatWindowForBooking(
  bookingDate: Date | string | null | undefined,
  options: {
    now?: Date;
    isSupervisor?: boolean;
    completedAt?: Date | string | null;
    config?: StaffChatWindowConfig;
  } = {}
): ChatWindowStatus {
  const now = options.now ? new Date(options.now) : new Date();
  if (options.isSupervisor) return { open: true, reason: 'SUPERVISOR' };

  const config = options.config || { openHoursBefore: 3, closeHoursAfter: 3 };

  if (!bookingDate) return { open: false, reason: 'NO_ACTIVE_BOOKING' };
  const booking = new Date(bookingDate);
  if (isNaN(booking.getTime())) return { open: false, reason: 'NO_ACTIVE_BOOKING' };

  // Batas ganti hari: jadwal dari hari sebelum hari ini WIB ditutup total.
  if (getWibStartOfDay(booking).getTime() < getWibStartOfDay(now).getTime()) {
    return { open: false, reason: 'PREVIOUS_DAY' };
  }

  const opensAt = new Date(booking.getTime() - config.openHoursBefore * HOUR_MS);
  if (now.getTime() < opensAt.getTime()) {
    return { open: false, reason: 'NOT_YET_OPEN', opensAt };
  }

  const completedAt = options.completedAt ? new Date(options.completedAt) : null;
  if (completedAt && !isNaN(completedAt.getTime())) {
    const closesAt = new Date(completedAt.getTime() + config.closeHoursAfter * HOUR_MS);
    if (now.getTime() > closesAt.getTime()) {
      return { open: false, reason: 'CLOSED_AFTER_COMPLETE', closesAt };
    }
    return { open: true, reason: 'OPEN', opensAt, closesAt };
  }

  return { open: true, reason: 'OPEN', opensAt };
}

export class StaffReservationService {
  /**
   * Menghitung rentang waktu 00:00:00 s/d 23:59:59 dalam zona waktu WIB untuk tanggal tertentu (hari ini, besok, atau spesifik YYYY-MM-DD).
   */
  static getWibDateRange(targetDateParam?: string): {
    startOfDay: Date;
    endOfDay: Date;
    dateStr: string;
    formattedDate: string;
    isToday: boolean;
    isTomorrow: boolean;
  } {
    const now = new Date();
    const wibMs = now.getTime() + 7 * 60 * 60 * 1000;
    const targetDate = new Date(wibMs);
    let isToday = true;
    let isTomorrow = false;
    if (targetDateParam === 'tomorrow') {
      targetDate.setUTCDate(targetDate.getUTCDate() + 1);
      isToday = false;
      isTomorrow = true;
    } else if (targetDateParam && targetDateParam !== 'today') {
      const match = targetDateParam.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (match) {
        const y = parseInt(match[1], 10);
        const m = parseInt(match[2], 10) - 1;
        const d = parseInt(match[3], 10);
        targetDate.setUTCFullYear(y, m, d);
        const todayWib = new Date(wibMs);
        const tomorrowWib = new Date(wibMs + 24 * 60 * 60 * 1000);
        const targetStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const todayStr = `${todayWib.getUTCFullYear()}-${String(todayWib.getUTCMonth() + 1).padStart(2, '0')}-${String(todayWib.getUTCDate()).padStart(2, '0')}`;
        const tomorrowStr = `${tomorrowWib.getUTCFullYear()}-${String(tomorrowWib.getUTCMonth() + 1).padStart(2, '0')}-${String(tomorrowWib.getUTCDate()).padStart(2, '0')}`;
        isToday = targetStr === todayStr;
        isTomorrow = targetStr === tomorrowStr;
      }
    }
    const targetYear = targetDate.getUTCFullYear();
    const targetMonth = targetDate.getUTCMonth();
    const targetDay = targetDate.getUTCDate();
    const startOfDay = new Date(Date.UTC(targetYear, targetMonth, targetDay, -7, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(targetYear, targetMonth, targetDay, 16, 59, 59, 999));
    const monthStr = String(targetMonth + 1).padStart(2, '0');
    const dayStr = String(targetDay).padStart(2, '0');
    const dateStr = `${targetYear}-${monthStr}-${dayStr}`;
    const displayDate = new Date(Date.UTC(targetYear, targetMonth, targetDay, 0, 0, 0));
    const formattedDate = displayDate.toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    return { startOfDay, endOfDay, dateStr, formattedDate, isToday, isTomorrow };
  }

  /**
   * Mengambil daftar tugas reservasi khusus milik staff ini untuk hari ini/besok/tanggal tertentu,
   * diperkaya dengan alamat, data anak/bayi, navigasi turn-by-turn Maps, rincian harga,
   * dan perhitungan jarak berantai sekuensial (Klinik -> Pasien 1 -> Pasien 2) via Haversine.
   * Catatan keamanan: Nomor HP customer SENGAJA TIDAK di-select dari database (masking layer).
   */
  static async getTodayTasks(
    staffId: string,
    tenantId = DEFAULT_TENANT_ID,
    scope: 'mine' | 'all' = 'mine',
    isSupervisor = false,
    targetDateParam?: string
  ): Promise<StaffTaskItem[]> {
    if (!staffId) return [];

    const { startOfDay, endOfDay } = this.getWibDateRange(targetDateParam);
    const now = new Date();
    const chatWindowConfig = await getStaffChatWindowConfig(tenantId);

    try {
      const whereCondition: any = {
        tenant_id: tenantId,
        booking_date: { gte: startOfDay, lte: endOfDay },
        status: { notIn: ['cancelled', 'rejected'] },
        customer: { is_sandbox_test: false },
      };

      if (scope !== 'all' || !isSupervisor) {
        whereCondition.assigned_staff_id = staffId;
      }

      const rows = await prisma.reservation.findMany({
        where: whereCondition,
        select: {
          id: true,
          treatment_detail: true,
          treatment_category: true,
          booking_date: true,
          status: true,
          purchase_value: true,
          purchase_occurred_at: true,
          updated_at: true,
          otw_sent_at: true,
          arrived_at: true,
          assigned_staff: {
            select: {
              id: true,
              name: true,
              role: true,
            },
          },
          customer: {
            select: {
              name: true,
              lat: true,
              lng: true,
              kelurahan: true,
              kecamatan: true,
              kota: true,
              distance_km: true,
              ongkir: true,
              preferences: true,
              profile_picture_url: true,
              children: {
                select: {
                  name: true,
                  raw_age_text: true,
                  birth_date: true,
                },
              },
              // phone: TIDAK di-select dari DB untuk privasi data customer
              ltv_cache: true,
              conversations: {
                select: { id: true },
                orderBy: { updated_at: 'desc' },
                take: 1,
              },
            },
          },
          children: {
            select: {
              name: true,
              raw_age_text: true,
              birth_date: true,
            },
          },
        },
        orderBy: { booking_date: 'asc' },
      });

      const circuityFactor = parseFloat(process.env.HAVERSINE_CIRCUITY_FACTOR || '1.60');
      let prevCoords: Coordinates = { lat: clinicConfig.lat, lng: clinicConfig.lng };
      let prevOriginName = 'Klinik';
      let isFirstPatient = true;

      return Promise.all(
        rows.map(async (r) => {
        const cust = r.customer;
        const lat = cust?.lat;
        const lng = cust?.lng;
        const mapsUrl = lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : null;
        const navigationUrl =
          lat && lng
            ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=two-wheeler`
            : null;
        const addressText = buildAddressText(cust || {});

        // Sequential Homecare Distance Calculation (Haversine 0-API call)
        let distanceKm: number | null = null;
        let distanceSource: 'CLINIC' | 'PREVIOUS_PATIENT' | null = null;
        let originName: string | null = null;

        if (typeof lat === 'number' && typeof lng === 'number') {
          const currentCoords: Coordinates = { lat, lng };
          if (isFirstPatient) {
            // Pasien #1: Dari Klinik ke Pasien #1
            distanceKm = cust?.distance_km ?? parseFloat((calculateHaversineDistance(prevCoords, currentCoords) * circuityFactor).toFixed(1));
            distanceSource = 'CLINIC';
            originName = clinicConfig.name || 'Klinik';
          } else {
            // Pasien #2, #3, dst: Dari Pasien Sebelumnya ke Pasien Sekarang
            const straightKm = calculateHaversineDistance(prevCoords, currentCoords);
            distanceKm = parseFloat((straightKm * circuityFactor).toFixed(1));
            distanceSource = 'PREVIOUS_PATIENT';
            originName = prevOriginName;
          }
          // Update waypoint untuk pasien berikutnya
          prevCoords = currentCoords;
          prevOriginName = cust?.name ? (cust.name.toLowerCase().startsWith('bunda') ? cust.name : `Bunda ${cust.name}`) : 'Pasien Sebelumnya';
          isFirstPatient = false;
        } else {
          // Jika pasien tidak punya koordinat, gunakan fallback distance_km jika ada
          distanceKm = cust?.distance_km ?? null;
          distanceSource = 'CLINIC';
          originName = clinicConfig.name || 'Klinik';
        }

        // Gabungkan children dari reservation dan customer profile (deduplicate by name)
        const combinedChildren = [...(r.children || []), ...(cust?.children || [])];
        const uniqueChildrenMap = new Map<string, StaffTaskChild>();
        for (const ch of combinedChildren) {
          if (ch?.name && !uniqueChildrenMap.has(ch.name)) {
            uniqueChildrenMap.set(ch.name, {
              name: ch.name,
              rawAgeText: ch.raw_age_text || null,
              birthDate: ch.birth_date ? ch.birth_date.toISOString() : null,
            });
          }
        }
        const childrenList = Array.from(uniqueChildrenMap.values());

        // Pricing calculation
        let treatmentFee = r.purchase_value || 0;
        if (treatmentFee <= 0 && r.treatment_detail) {
          const resolved = await resolveTreatmentValue(r.treatment_detail);
          if (resolved && resolved > 0) treatmentFee = resolved;
        }
        const deliveryFee = cust?.ongkir || 0;
        const totalFee = treatmentFee + deliveryFee;
        const isLunas = !!r.purchase_occurred_at;
        const paymentStatus: 'LUNAS' | 'TAGIH_DI_TEMPAT' = isLunas ? 'LUNAS' : 'TAGIH_DI_TEMPAT';
        const paymentStatusLabel = isLunas ? 'Lunas (Online/Transfer)' : 'Tagih di Tempat (Tunai/Transfer)';

        const pricing: StaffTaskPricing = {
          treatmentFee,
          deliveryFee,
          totalFee,
          paymentStatus,
          paymentStatusLabel,
        };

        return {
          reservationId: r.id,
          customerName: cust?.name || null,
          treatmentDetail: r.treatment_detail,
          treatmentCategory: r.treatment_category || null,
          bookingDate: r.booking_date,
          status: r.status,
          otwSentAt: (r as any).otw_sent_at || null,
          arrivedAt: (r as any).arrived_at || null,
          conversationId: cust?.conversations?.[0]?.id || null,
          mapsUrl,
          navigationUrl,
          address: {
            kelurahan: cust?.kelurahan || null,
            kecamatan: cust?.kecamatan || null,
            kota: cust?.kota || null,
            lat: cust?.lat ?? null,
            lng: cust?.lng ?? null,
            distanceKm,
            estimatedMinutes: estimateTravelDurationMinutes(distanceKm),
            distanceSource,
            originName,
            fullText: addressText,
            housePhotoUrl: (cust?.preferences as any)?.house_photo_url || null,
            landmark: (cust?.preferences as any)?.landmark || null,
          },
          children: childrenList,
          pricing,
          shareLocationText: buildShareText(
            cust?.name || null,
            addressText,
            r.treatment_detail,
            mapsUrl,
            pricing
          ),
          customerProfilePictureUrl: cust?.profile_picture_url || null,
          assignedStaff: (r as any).assigned_staff
            ? {
                id: (r as any).assigned_staff.id,
                name: (r as any).assigned_staff.name,
                role: (r as any).assigned_staff.role,
              }
            : null,
          customerStats: {
            totalTreatments: 1,
            ltv: (cust as any)?.ltv_cache > 0 ? (cust as any).ltv_cache : pricing.totalFee,
          },
          chatWindow: this.buildChatWindowForTask(
            r.booking_date,
            r.status,
            r.purchase_occurred_at,
            (r as any).updated_at,
            isSupervisor,
            chatWindowConfig,
            now
          ),
        };
      })
      );
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error fetching today tasks:', err.message);
      return [];
    }
  }

  /**
   * Serialisasi status jendela chat untuk payload task (server-driven).
   * Supervisor selalu 'open' agar UI tidak menonaktifkan tombol bagi pengawas.
   */
  private static buildChatWindowForTask(
    bookingDate: Date | null,
    status: string | null,
    purchaseOccurredAt: Date | null,
    updatedAt: Date | null,
    isSupervisor: boolean,
    config: StaffChatWindowConfig,
    now: Date
  ): StaffTaskItem['chatWindow'] {
    const isCompleted = ['completed', 'selesai'].includes((status || '').toLowerCase());
    const completedAt = isCompleted ? purchaseOccurredAt || updatedAt || null : null;
    const s = evaluateChatWindowForBooking(bookingDate, {
      now,
      isSupervisor,
      completedAt,
      config,
    });
    return {
      open: s.open,
      reason: s.reason,
      opensAt: s.opensAt ? s.opensAt.toISOString() : null,
      closesAt: s.closesAt ? s.closesAt.toISOString() : null,
    };
  }

  /**
   * Mengambil daftar jadwal reservasi masa depan (hari esok dan seterusnya) milik staff.
   * Bersifat jadwal saja (read-only), TIDAK memiliki akses atau menyertakan conversationId/chat.
   */
  static async getUpcomingSchedule(
    staffId: string,
    tenantId = DEFAULT_TENANT_ID,
    daysAhead = 30
  ): Promise<StaffTaskItem[]> {
    if (!staffId) return [];

    const { startOfDay: tomorrow } = this.getWibDateRange('tomorrow');
    const maxEnd = this.getWibDateRange(
      (() => {
        const d = new Date(tomorrow.getTime() + daysAhead * 24 * 60 * 60 * 1000);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      })()
    ).endOfDay;

    try {
      const rows = await prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          assigned_staff_id: staffId,
          booking_date: { gte: tomorrow, lte: maxEnd },
          status: { notIn: ['cancelled', 'rejected'] },
          customer: { is_sandbox_test: false },
        },
        select: {
          id: true,
          treatment_detail: true,
          treatment_category: true,
          booking_date: true,
          status: true,
          purchase_value: true,
          purchase_occurred_at: true,
          customer: {
            select: {
              name: true,
              lat: true,
              lng: true,
              kelurahan: true,
              kecamatan: true,
              kota: true,
              distance_km: true,
              ongkir: true,
              preferences: true,
              profile_picture_url: true,
              children: {
                select: {
                  name: true,
                  raw_age_text: true,
                  birth_date: true,
                },
              },
            },
          },
          children: {
            select: {
              name: true,
              raw_age_text: true,
              birth_date: true,
            },
          },
        },
        orderBy: { booking_date: 'asc' },
      });

      const circuityFactor = parseFloat(process.env.HAVERSINE_CIRCUITY_FACTOR || '1.60');
      let lastDateKey = '';
      let prevCoords: Coordinates = { lat: clinicConfig.lat, lng: clinicConfig.lng };
      let prevOriginName = 'Klinik';
      let isFirstPatientOfDay = true;

      return Promise.all(
        rows.map(async (r) => {
        const cust = r.customer;
        const lat = cust?.lat;
        const lng = cust?.lng;
        const mapsUrl = lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : null;
        const navigationUrl =
          lat && lng
            ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=two-wheeler`
            : null;
        const addressText = buildAddressText(cust || {});

        const dateKey = r.booking_date ? new Date(r.booking_date).toISOString().split('T')[0] : '';
        if (dateKey !== lastDateKey) {
          lastDateKey = dateKey;
          prevCoords = { lat: clinicConfig.lat, lng: clinicConfig.lng };
          prevOriginName = 'Klinik';
          isFirstPatientOfDay = true;
        }

        // Sequential Homecare Distance Calculation (Haversine 0-API call)
        let distanceKm: number | null = null;
        let distanceSource: 'CLINIC' | 'PREVIOUS_PATIENT' | null = null;
        let originName: string | null = null;

        if (typeof lat === 'number' && typeof lng === 'number') {
          const currentCoords: Coordinates = { lat, lng };
          if (isFirstPatientOfDay) {
            distanceKm = cust?.distance_km ?? parseFloat((calculateHaversineDistance(prevCoords, currentCoords) * circuityFactor).toFixed(1));
            distanceSource = 'CLINIC';
            originName = clinicConfig.name || 'Klinik';
          } else {
            const straightKm = calculateHaversineDistance(prevCoords, currentCoords);
            distanceKm = parseFloat((straightKm * circuityFactor).toFixed(1));
            distanceSource = 'PREVIOUS_PATIENT';
            originName = prevOriginName;
          }
          prevCoords = currentCoords;
          prevOriginName = cust?.name ? (cust.name.toLowerCase().startsWith('bunda') ? cust.name : `Bunda ${cust.name}`) : 'Pasien Sebelumnya';
          isFirstPatientOfDay = false;
        } else {
          distanceKm = cust?.distance_km ?? null;
          distanceSource = 'CLINIC';
          originName = clinicConfig.name || 'Klinik';
        }

        const combinedChildren = [...(r.children || []), ...(cust?.children || [])];
        const uniqueChildrenMap = new Map<string, StaffTaskChild>();
        for (const ch of combinedChildren) {
          if (ch?.name && !uniqueChildrenMap.has(ch.name)) {
            uniqueChildrenMap.set(ch.name, {
              name: ch.name,
              rawAgeText: ch.raw_age_text || null,
              birthDate: ch.birth_date ? ch.birth_date.toISOString() : null,
            });
          }
        }
        const childrenList = Array.from(uniqueChildrenMap.values());

        let treatmentFee = r.purchase_value || 0;
        if (treatmentFee <= 0 && r.treatment_detail) {
          const resolved = await resolveTreatmentValue(r.treatment_detail);
          if (resolved && resolved > 0) treatmentFee = resolved;
        }
        const deliveryFee = cust?.ongkir || 0;
        const totalFee = treatmentFee + deliveryFee;
        const isLunas = !!r.purchase_occurred_at;
        const paymentStatus: 'LUNAS' | 'TAGIH_DI_TEMPAT' = isLunas ? 'LUNAS' : 'TAGIH_DI_TEMPAT';
        const paymentStatusLabel = isLunas ? 'Lunas' : 'Tagih di Tempat';

        const pricing: StaffTaskPricing = {
          treatmentFee,
          deliveryFee,
          totalFee,
          paymentStatus,
          paymentStatusLabel,
        };

        return {
          reservationId: r.id,
          customerName: cust?.name || null,
          treatmentDetail: r.treatment_detail,
          treatmentCategory: r.treatment_category || null,
          bookingDate: r.booking_date,
          status: r.status,
          conversationId: null, // DILARANG: Tidak ada akses chat untuk jadwal masa depan
          mapsUrl,
          navigationUrl,
          address: {
            kelurahan: cust?.kelurahan || null,
            kecamatan: cust?.kecamatan || null,
            kota: cust?.kota || null,
            lat: cust?.lat ?? null,
            lng: cust?.lng ?? null,
            distanceKm,
            estimatedMinutes: estimateTravelDurationMinutes(distanceKm),
            distanceSource,
            originName,
            fullText: addressText,
            housePhotoUrl: (cust?.preferences as any)?.house_photo_url || null,
            landmark: (cust?.preferences as any)?.landmark || null,
          },
          children: childrenList,
          pricing,
          shareLocationText: null,
          customerProfilePictureUrl: cust?.profile_picture_url || null,
        };
      })
      );
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error fetching upcoming schedule:', err.message);
      return [];
    }
  }

  /**
   * Mengambil riwayat jadwal & treatment yang sudah selesai dilakukan oleh staff.
   * (Status COMPLETED atau pembayaran lunas atau tanggal sebelum hari ini).
   */
  static async getCompletedTasks(
    staffId: string,
    tenantId = DEFAULT_TENANT_ID,
    daysPast = 60
  ): Promise<StaffTaskItem[]> {
    if (!staffId) return [];

    const { startOfDay } = this.getWibDateRange('today');
    const minDate = new Date(startOfDay.getTime() - daysPast * 24 * 60 * 60 * 1000);
    const now = new Date();
    const chatWindowConfig = await getStaffChatWindowConfig(tenantId);

    try {
      const rows = await prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          assigned_staff_id: staffId,
          status: { notIn: ['cancelled', 'rejected'] },
          customer: { is_sandbox_test: false },
          OR: [
            { status: { in: ['completed', 'COMPLETED', 'selesai', 'SELESAI'] } },
            { purchase_occurred_at: { not: null } },
            {
              booking_date: {
                lt: startOfDay,
                gte: minDate,
              },
            },
          ],
        },
        select: {
          id: true,
          treatment_detail: true,
          treatment_category: true,
          booking_date: true,
          status: true,
          purchase_value: true,
          purchase_occurred_at: true,
          updated_at: true,
          otw_sent_at: true,
          arrived_at: true,
          payment_method: true,
          proof_url: true,
          customer: {
            select: {
              name: true,
              lat: true,
              lng: true,
              kelurahan: true,
              kecamatan: true,
              kota: true,
              distance_km: true,
              ongkir: true,
              preferences: true,
              profile_picture_url: true,
              children: {
                select: {
                  name: true,
                  raw_age_text: true,
                  birth_date: true,
                },
              },
              conversations: {
                select: { id: true },
                orderBy: { updated_at: 'desc' },
                take: 1,
              },
            },
          },
          children: {
            select: {
              name: true,
              raw_age_text: true,
              birth_date: true,
            },
          },
        },
        orderBy: { booking_date: 'desc' },
      });

      return Promise.all(
        rows.map(async (r) => {
        const cust = r.customer;
        const addressText = buildAddressText(cust || {});
        const mapsUrl =
          cust?.lat != null && cust?.lng != null
            ? `https://www.google.com/maps/search/?api=1&query=${cust.lat},${cust.lng}`
            : null;
        const navigationUrl =
          cust?.lat != null && cust?.lng != null
            ? `https://www.google.com/maps/dir/?api=1&destination=${cust.lat},${cust.lng}&travelmode=two-wheeler`
            : null;

        const distanceKm = cust?.distance_km ?? null;

        const combinedChildren = [...(r.children || []), ...(cust?.children || [])];
        const uniqueChildrenMap = new Map<string, StaffTaskChild>();
        for (const ch of combinedChildren) {
          if (ch?.name && !uniqueChildrenMap.has(ch.name)) {
            uniqueChildrenMap.set(ch.name, {
              name: ch.name,
              rawAgeText: ch.raw_age_text || null,
              birthDate: ch.birth_date ? ch.birth_date.toISOString() : null,
            });
          }
        }
        const childrenList = Array.from(uniqueChildrenMap.values());

        let treatmentFee = r.purchase_value || 0;
        if (treatmentFee <= 0 && r.treatment_detail) {
          const resolved = await resolveTreatmentValue(r.treatment_detail);
          if (resolved && resolved > 0) treatmentFee = resolved;
        }
        const deliveryFee = cust?.ongkir || 0;
        const totalFee = treatmentFee + deliveryFee;
        const isLunas = !!r.purchase_occurred_at || r.status === 'completed' || r.status === 'COMPLETED';
        const paymentStatus: 'LUNAS' | 'TAGIH_DI_TEMPAT' = isLunas ? 'LUNAS' : 'TAGIH_DI_TEMPAT';
        const paymentStatusLabel = isLunas ? 'Lunas (Selesai)' : 'Belum Lunas';

        const pricing: StaffTaskPricing = {
          treatmentFee,
          deliveryFee,
          totalFee,
          paymentStatus,
          paymentStatusLabel,
        };

        return {
          reservationId: r.id,
          customerName: cust?.name || null,
          treatmentDetail: r.treatment_detail,
          treatmentCategory: r.treatment_category || null,
          bookingDate: r.booking_date,
          status: r.status,
          otwSentAt: (r as any).otw_sent_at || null,
          arrivedAt: (r as any).arrived_at || null,
          conversationId: cust?.conversations?.[0]?.id || null,
          mapsUrl,
          navigationUrl,
          address: {
            kelurahan: cust?.kelurahan || null,
            kecamatan: cust?.kecamatan || null,
            kota: cust?.kota || null,
            lat: cust?.lat ?? null,
            lng: cust?.lng ?? null,
            distanceKm,
            estimatedMinutes: estimateTravelDurationMinutes(distanceKm),
            distanceSource: 'CLINIC',
            originName: 'Klinik',
            fullText: addressText,
            housePhotoUrl: (cust?.preferences as any)?.house_photo_url || null,
            landmark: (cust?.preferences as any)?.landmark || null,
          },
          children: childrenList,
          pricing,
          shareLocationText: null,
          customerProfilePictureUrl: cust?.profile_picture_url || null,
          chatWindow: this.buildChatWindowForTask(
            r.booking_date,
            r.status,
            r.purchase_occurred_at,
            (r as any).updated_at,
            false,
            chatWindowConfig,
            now
          ),
        };
      })
      );
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error fetching completed tasks:', err.message);
      return [];
    }
  }

  /**
   * Mengambil dan merender template pesan OTW (Menuju Lokasi) khusus tenant.
   * Mendukung kustomisasi dari Super Admin (`FollowUpTemplate` tipe `STAFF_OTW`).
   */
  static async getOtwMessageText(
    tenantId: string = DEFAULT_TENANT_ID,
    params: { patientName: string; therapistName: string }
  ): Promise<string> {
    try {
      // 1. Ambil template kustom tenant dari DB
      const customTpl = await prisma.followUpTemplate.findUnique({
        where: {
          tenant_id_type_variant: {
            tenant_id: tenantId,
            type: 'STAFF_OTW',
            variant: 1,
          },
        },
      });

      // 2. Ambil nama klinik tenant
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      });
      const clinicName = tenant?.name || 'Kala Spa Baby & Mom Homecare';

      let templateText = customTpl?.text;
      if (!templateText) {
        templateText = `Halo Bunda {patientName}, saya {therapistName} dari {clinicName} sudah bersiap dan sedang dalam perjalanan menuju ke lokasi Bunda ya. Mohon ditunggu ya Bunda 🙏🛵`;
      }

      // 3. Render placeholders
      return templateText
        .replace(/\{\{?patientName\}\}?/gi, params.patientName || 'Bunda')
        .replace(/\{\{?name\}\}?/gi, params.patientName || 'Bunda')
        .replace(/\{\{?therapistName\}\}?/gi, params.therapistName || 'Bidan Terapis')
        .replace(/\{\{?clinicName\}\}?/gi, clinicName);
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error rendering OTW template:', err.message);
      return `Halo Bunda ${params.patientName || 'Bunda'}, saya ${params.therapistName || 'Bidan Terapis'} dari klinik sudah bersiap dan sedang dalam perjalanan menuju ke lokasi Bunda ya. Mohon ditunggu ya Bunda 🙏🛵`;
    }
  }

  /**
   * Mencatat penyelesaian pembayaran transaksi homecare oleh terapis di lapangan.
   * Mendukung pembayaran Tunai (Cash) dan Non-Tunai (Transfer / QRIS) beserta upload bukti foto ringan (bukan HD).
   */
  static async recordPayment(params: {
    reservationId: string;
    staffId: string;
    staffName: string;
    tenantId?: string;
    paymentMethod: 'CASH' | 'TRANSFER' | 'QRIS';
    amount?: number;
    proofImageB64?: string;
    notes?: string;
    isSupervisor?: boolean;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    const {
      reservationId,
      staffId,
      staffName,
      tenantId = DEFAULT_TENANT_ID,
      paymentMethod,
      amount,
      proofImageB64,
      notes,
      isSupervisor = false,
    } = params;

    if (!reservationId || !staffId) {
      return { success: false, error: 'reservationId dan staffId wajib disertakan.' };
    }

    try {
      const reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
        include: {
          customer: {
            include: {
              conversations: {
                orderBy: { updated_at: 'desc' },
                take: 1,
              },
            },
          },
        },
      });

      if (!reservation) {
        return { success: false, error: 'Reservasi tidak ditemukan.' };
      }

      if (reservation.tenant_id !== tenantId) {
        return { success: false, error: 'Reservasi tidak ditemukan untuk klinik ini.' };
      }

      if (!isSupervisor && reservation.assigned_staff_id && reservation.assigned_staff_id !== staffId) {
        return { success: false, error: 'Anda tidak memiliki hak akses untuk reservasi ini.' };
      }

      // Kontrak: amount = total tunai di tangan terapis (treatment + ongkir) dari frontend pricing.totalFee
      const deliveryFee = (reservation as any).customer?.ongkir || 0;
      const totalCollected = amount != null ? amount : ((reservation as any).purchase_value || 0);
      // Nilai murni layanan yang disimpan di purchase_value agar tidak double-count saat read: totalFee = purchase_value + ongkir
      const pureTreatmentValue = amount != null ? Math.max(0, totalCollected - deliveryFee) : ((reservation as any).purchase_value || 0);
      const totalPaid = totalCollected;
      const now = new Date();

      // Simpan bukti foto transfer/QRIS jika ada (dikompres max 800px agar
      // ringan & hemat kuota MQL, tetap terbaca jelas)
      let proofUrl: string | null = null;
      if (proofImageB64 && proofImageB64.startsWith('data:image/')) {
        const { mediaService } = await import('./media.service');
        const matches = proofImageB64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        const rawB64 = matches ? matches[2] : proofImageB64;
        const resized = await mediaService.resizeImageToMax(Buffer.from(rawB64, 'base64'), 800);
        const saved = await mediaService.saveOutboundMedia({
          tenantId,
          imageB64: resized.toString('base64'),
          mimeType: 'image/jpeg',
          fileName: `proof-${reservationId}.jpg`,
        });
        proofUrl = saved.hdUrl;
      }

      // Update data Reservasi menjadi Lunas
      // Normalisasi status: 'confirmed' tidak standar, gunakan 'pending' atau 'approved'
      // berdasarkan auto_send_purchase_capi tenant.
      let purchaseReviewStatus: 'pending' | 'approved' = 'pending';
      let purchaseEventSentAt: Date | null = null;

      // Cek apakah tenant mengaktifkan auto-send CAPI
      try {
        const { prisma: dbClient } = await import('../db/client');
        const tenant = await dbClient.tenant.findUnique({ where: { id: tenantId } });
        const autoSend = (tenant as any)?.auto_send_purchase_capi === true;

        if (autoSend) {
          // Kirim CAPI event, jika sukses set 'approved'
          const { capiService } = await import('./capi.service');
          const customer = reservation.customer;
          const adClickResult = await dbClient.adClick.findFirst({
            where: { customerId: customer.id },
            orderBy: { createdAt: 'desc' },
          });

          const capiResult = await capiService.sendCapiEvent({
            eventName: 'Purchase',
            customer,
            adClick: adClickResult || undefined,
            value: totalPaid,
            currency: 'IDR',
            tenantId,
            eventTime: Math.floor(now.getTime() / 1000),
            customData: {
              source: 'STAFF_RECORD_PAYMENT',
              payment_method: paymentMethod,
            },
          });

          if (capiResult.success) {
            purchaseReviewStatus = 'approved';
            purchaseEventSentAt = new Date();
            console.log(`[STAFF CAPI] Purchase event sent successfully for reservation ${reservationId}`);
          } else {
            console.warn(`[STAFF CAPI] Purchase event failed for reservation ${reservationId}, status set to pending`);
          }
        }
      } catch (capiErr: any) {
        console.error(`[STAFF CAPI] Error sending CAPI event: ${capiErr.message}`);
        // Tetap lanjut dengan status 'pending' jika CAPI gagal
      }

      const updated = await prisma.reservation.update({
        where: { id: reservationId },
        data: {
          purchase_occurred_at: now,
          purchase_value: pureTreatmentValue,
          purchase_review_status: purchaseReviewStatus,
          purchase_event_sent_at: purchaseEventSentAt,
          status: 'completed',
          payment_method: paymentMethod,
          proof_url: proofUrl,
        },
      });

      // [FITUR NONAKTIF]: Pengiriman pesan konfirmasi pembayaran otomatis ke WhatsApp customer
      // dinonaktifkan atas arahan bisnis untuk mencegah pesan kaku/salah konteks (seperti template
      // bayi terkirim ke customer nifas/suami). Pencatatan pembayaran tetap tersimpan di database
      // dan audit log tanpa interupsi bot ke chat WhatsApp customer.

      // Sinkronkan nilai Lifetime Value (LTV) customer — idempoten, best-effort
      try {
        const { customerService } = await import('./customer.service');
        await customerService.recalculateCustomerLtv(reservation.customer_id, tenantId);
      } catch (ltvErr: any) {
        console.warn('[STAFF RESERVATION] Failed to recalculate customer LTV on payment:', ltvErr.message);
      }
      // MT-1.4: seam terpusat completed — dekopling REVIEW/NEXT (guard backdate + per-stage WIB) + reset V3
      try {
        const { reservationLifecycleService } = await import('./reservation-lifecycle.service');
        if (reservation.booking_date) {
          const existingSentReview = await (prisma as any).followUp?.findFirst?.({
            where: { reservation_id: reservationId, status: 'SENT' },
          });
          if (!existingSentReview) {
            await reservationLifecycleService.onReservationCompleted({
              customerId: reservation.customer_id,
              reservationId: reservation.id,
              bookingDate: reservation.booking_date,
              treatmentCategory: reservation.treatment_category,
              tenantId,
            });
          }
        }
      } catch (fuErr: any) {
        console.warn('[STAFF RESERVATION] Failed to trigger follow-up on payment:', fuErr.message);
      }

      // Audit log — amount = total riil di tangan, pureTreatmentValue tersimpan di purchase_value
      const { auditService } = await import('./audit.service');
      await auditService.logAdminAction({
        apiKey: 'STAFF_SESSION',
        adminIdentity: staffName,
        action: 'STAFF_RECORD_PAYMENT',
        targetId: reservationId,
        payload: {
          paymentMethod,
          amount: totalPaid,
          pureTreatmentValue,
          deliveryFee,
          proofUrl,
          notes,
        },
        tenantId,
      });

      return {
        success: true,
        data: {
          reservationId: updated.id,
          purchaseValue: updated.purchase_value,
          purchaseOccurredAt: updated.purchase_occurred_at,
          paymentMethod,
          proofUrl,
        },
      };
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error recording payment:', err.message);
      return { success: false, error: `Gagal mencatat pembayaran: ${err.message}` };
    }
  }

  /**
   * Guard kepemilikan: Memastikan bahwa percakapan yang diakses staff memang terhubung
   * ke customer yang memiliki reservasi tugas aktif hari ini yang ditugaskan ke staff tsb.
   * Khusus peran supervisor (SPV CS / Admin), diperbolehkan memantau semua percakapan aktif hari ini.
   */
  static async assertConversationOwnedByStaffToday(
    conversationId: string,
    staffId: string,
    tenantId = DEFAULT_TENANT_ID,
    isSupervisor = false
  ): Promise<boolean> {
    if (!conversationId || !staffId) return false;

    const now = new Date();

    try {
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { customer_id: true, tenant_id: true },
      });

      if (!conv || conv.tenant_id !== tenantId) return false;

      // Supervisor: akses penuh (override) selama percakapan milik tenant yang sama.
      if (isSupervisor) return true;

      // Ambil seluruh reservasi kandidat customer ini pada rentang relevan
      // (hari ini + N jam ke depan + hari lampau dekat), lalu evaluasi jendela
      // chat per-jadwal secara deterministik. Keputusan berbasis state waktu,
      // bukan pencocokan string.
      const config = await getStaffChatWindowConfig(tenantId);
      const lookaheadEnd = new Date(
        now.getTime() + Math.max(config.openHoursBefore, 1) * HOUR_MS + 24 * HOUR_MS
      );
      const lookbackStart = new Date(now.getTime() - (config.closeHoursAfter + 24) * HOUR_MS);

      const candidates = await prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          customer_id: conv.customer_id,
          assigned_staff_id: staffId,
          status: { notIn: ['cancelled', 'rejected'] },
          booking_date: { gte: lookbackStart, lte: lookaheadEnd },
        },
        select: {
          id: true,
          booking_date: true,
          status: true,
          purchase_occurred_at: true,
          updated_at: true,
        },
        orderBy: { booking_date: 'asc' },
      });

      if (!Array.isArray(candidates) || candidates.length === 0) return false;

      const isCompleted = (status: string | null | undefined) =>
        ['completed', 'selesai'].includes((status || '').toLowerCase());

      return candidates.some((r: any) => {
        // Waktu selesai: purchase_occurred_at (di-set atomik oleh recordPayment
        // bersama status='completed'); fallback updated_at bila null.
        const completedAt = isCompleted(r.status)
          ? r.purchase_occurred_at || r.updated_at || null
          : null;
        return evaluateChatWindowForBooking(r.booking_date, {
          now,
          isSupervisor: false,
          completedAt,
          config,
        }).open;
      });
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error asserting conversation ownership:', err.message);
      return false;
    }
  }

  /**
   * Mendelegasikan / mengganti staf terapis penanggung jawab tugas reservasi.
   * Hanya dapat dipanggil oleh role supervisor (SPV CS / Admin).
   */
  static async reassignTask(params: {
    reservationId: string;
    targetStaffId: string;
    supervisorStaffId: string;
    tenantId?: string;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    const {
      reservationId,
      targetStaffId,
      supervisorStaffId,
      tenantId = DEFAULT_TENANT_ID,
    } = params;

    if (!reservationId || !targetStaffId) {
      return { success: false, error: 'reservationId dan targetStaffId wajib diisi.' };
    }

    try {
      // Validasi staf target aktif
      const targetStaff = await prisma.staff.findFirst({
        where: { id: targetStaffId, tenant_id: tenantId, active: true },
        select: { id: true, name: true, role: true },
      });

      if (!targetStaff) {
        return { success: false, error: 'Staff terapis yang dituju tidak ditemukan atau tidak aktif.' };
      }

      // Validasi status & tenant — jadwal completed/cancelled/rejected tidak boleh didelegasi ulang
      const currentRes = await prisma.reservation.findUnique({
        where: { id: reservationId },
        select: { assigned_staff_id: true, status: true, tenant_id: true },
      });
      if (!currentRes) {
        return { success: false, error: 'Reservasi tidak ditemukan.' };
      }
      if ((currentRes as any).tenant_id !== tenantId) {
        return { success: false, error: 'Reservasi tidak ditemukan untuk klinik ini.' };
      }
      const currentStatus = ((currentRes as any).status || '').toLowerCase();
      if (['completed', 'cancelled', 'rejected'].includes(currentStatus)) {
        return {
          success: false,
          error: `Jadwal berstatus "${(currentRes as any).status}" tidak dapat didelegasikan ulang.`,
        };
      }
      const oldAssignedStaffId: string | null = (currentRes as any).assigned_staff_id || null;

      const updated = await prisma.reservation.update({
        where: { id: reservationId },
        data: {
          assigned_staff_id: targetStaffId,
        },
        select: {
          id: true,
          assigned_staff_id: true,
          customer: {
            select: { name: true },
          },
        },
      });

      try {
        const { staffNotificationService } = await import('./staff-notification.service');
        await staffNotificationService.sendReservationAssignmentNotification(reservationId, targetStaffId);
        if (oldAssignedStaffId && oldAssignedStaffId !== targetStaffId) {
          try { await staffNotificationService.sendTaskUnassignedNotification(reservationId, oldAssignedStaffId, targetStaff.name as string); } catch (_) {}
        }
      } catch (notifErr: any) {
        console.warn('[STAFF RESERVATION] Warning: could not send reassign notification:', notifErr.message);
      }

      // Audit trail mutasi staf — best-effort
      try {
        const { auditService } = await import('./audit.service');
        await auditService.logAdminAction({
          apiKey: 'STAFF_SESSION',
          adminIdentity: supervisorStaffId,
          action: 'STAFF_REASSIGN_TASK',
          targetId: reservationId,
          payload: { previousStaffId: oldAssignedStaffId, newStaffId: targetStaffId },
          tenantId,
        });
      } catch (_) {}

      return {
        success: true,
        data: {
          reservationId: updated.id,
          assignedStaff: targetStaff,
          customerName: updated.customer?.name || null,
        },
      };
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error reassigning task:', err.message);
      return { success: false, error: err.message || 'Gagal mendelegasikan tugas.' };
    }
  }

  /**
   * Memperbarui titik koordinat lokasi GPS, foto tampak depan rumah, dan catatan patokan
   * milik customer dari lapangan oleh terapis.
   * Otomatis mengompresi foto (max 800px) dan menghitung ulang jarak dari klinik.
   */
  static async updateCustomerLocation(params: {
    reservationId: string;
    staffId: string;
    staffName: string;
    tenantId?: string;
    lat?: number | null;
    lng?: number | null;
    housePhotoB64?: string | null;
    landmark?: string | null;
    isSupervisor?: boolean;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    const {
      reservationId,
      staffId,
      staffName,
      tenantId = DEFAULT_TENANT_ID,
      lat,
      lng,
      housePhotoB64,
      landmark,
      isSupervisor = false,
    } = params;

    if (!reservationId || !staffId) {
      return { success: false, error: 'reservationId dan staffId wajib disertakan.' };
    }

    const hasNewPhoto = !!housePhotoB64 && housePhotoB64.startsWith('data:image/');
    if (hasNewPhoto && (lat == null || lng == null)) {
      return { success: false, error: 'Foto rumah wajib disertai titik GPS (lat & lng). Kunci GPS dulu sebelum menyimpan foto.' };
    }

    try {
      const reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
        include: {
          customer: true,
        },
      });

      if (!reservation) {
        return { success: false, error: 'Reservasi tidak ditemukan.' };
      }

      if (reservation.tenant_id !== tenantId) {
        return { success: false, error: 'Reservasi tidak ditemukan untuk klinik ini.' };
      }

      if (!isSupervisor && reservation.assigned_staff_id && reservation.assigned_staff_id !== staffId) {
        return { success: false, error: 'Anda tidak memiliki hak akses untuk reservasi ini.' };
      }

      const customer = reservation.customer;
      if (!customer) {
        return { success: false, error: 'Data customer tidak ditemukan.' };
      }

      // Hitung ulang jarak dari klinik jika koordinat baru diberikan
      let distanceKm = customer.distance_km;
      const targetLat = lat ?? customer.lat;
      const targetLng = lng ?? customer.lng;

      let newOngkir: number | null = null;
      if (targetLat != null && targetLng != null) {
        // Validasi range koordinat Indonesia
        if (targetLat < -12 || targetLat > 7 || targetLng < 94 || targetLng > 142) {
          return { success: false, error: 'Koordinat GPS di luar wilayah Indonesia atau tidak valid.' };
        }

        const clinicCoords = { lat: clinicConfig.lat, lng: clinicConfig.lng };
        const { deliveryService } = await import('./delivery.service');
        const deliveryResult = await deliveryService.calculateDelivery(
          { lat: targetLat, lng: targetLng },
          clinicCoords,
          tenantId
        );
        distanceKm = deliveryResult.distanceKm;
        newOngkir = deliveryResult.promoPrice;

        // Skema kroscek 1: Tolak jika jarak dari klinik melenceng > 45 km (di luar area Surabaya-Sidoarjo-Gresik)
        const MAX_ALLOWED_DISTANCE_KM = 45;
        if (distanceKm > MAX_ALLOWED_DISTANCE_KM) {
          return {
            success: false,
            error: `Titik GPS terdeteksi berjarak ${distanceKm.toFixed(1)} km dari klinik (melenceng jauh di luar area jangkauan maksimal ${MAX_ALLOWED_DISTANCE_KM} km). Pastikan Anda sedang berada di lokasi rumah pasien.`,
          };
        }

        // Skema kroscek 2: Tolak jika pergeseran titik melenceng > 25 km dari data kelurahan/wilayah customer sebelumnya
        if (customer.distance_km && Math.abs(distanceKm - customer.distance_km) > 25) {
          return {
            success: false,
            error: `Titik GPS melenceng terlalu jauh (${Math.abs(distanceKm - customer.distance_km).toFixed(1)} km selisih) dari estimasi area ${customer.kelurahan || 'pasien'}. Pembaruan lokasi ditolak untuk mencegah salah alamat.`,
          };
        }
      }

      // Cek apakah koordinat baru berselisih > 1 km dari koordinat utama customer yang sudah ada
      let shouldUpdatePrimaryCoords = true;
      let diffFromOriginalKm: number | null = null;
      const baseLandmark = landmark !== undefined ? (landmark?.trim() || null) : ((customer.preferences as any)?.landmark || null);
      let finalLandmark = baseLandmark;

      if (lat != null && lng != null) {
        if (customer.lat != null && customer.lng != null) {
          diffFromOriginalKm = calculateHaversineDistance(
            { lat: customer.lat, lng: customer.lng },
            { lat, lng }
          );

          const isPreviousCoordEstimated =
            (customer as any).location_source === 'estimated_area' ||
            (customer.preferences as any)?.location_source === 'geocoding' ||
            (customer as any).share_location_sent === false;
          if (diffFromOriginalKm > 1.0 && !isPreviousCoordEstimated) {
            // Selisih > 1km & koordinat lama presisi: JANGAN ubah koordinat utama
            shouldUpdatePrimaryCoords = false;
            const gpsTag = `[📍 GPS Lapangan: ${lat.toFixed(6)}, ${lng.toFixed(6)} (+${diffFromOriginalKm.toFixed(1)}km)]`;
            finalLandmark = baseLandmark ? `${baseLandmark} ${gpsTag}` : gpsTag;
          } else {
            // Estimasi lama atau selisih <=1km: perbarui koordinat utama dengan GPS presisi
            shouldUpdatePrimaryCoords = true;
          }
        } else {
          // Belum punya koordinat sebelumnya: simpan sebagai koordinat utama
          shouldUpdatePrimaryCoords = true;
        }
      }

      let housePhotoUrl: string | null = (customer.preferences as any)?.house_photo_url || null;

      // Kompres, beri watermark GPS (lengkap dengan nama pengambil foto, Kelurahan & Kecamatan), dan simpan foto jika ada
      if (housePhotoB64 && housePhotoB64.startsWith('data:image/')) {
        const { mediaService } = await import('./media.service');
        const matches = housePhotoB64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        const rawB64 = matches ? matches[2] : housePhotoB64;
        const resized = await mediaService.resizeImageToMax(Buffer.from(rawB64, 'base64'), 800);
        const watermarked = await mediaService.overlayGpsBadge(resized, {
          lat: targetLat,
          lng: targetLng,
          customerName: customer.name || undefined,
          kelurahan: customer.kelurahan,
          kecamatan: customer.kecamatan,
          landmark: finalLandmark,
          staffName: staffName || undefined,
          takerName: staffName || undefined,
        });
        const saved = await mediaService.saveOutboundMedia({
          tenantId,
          imageB64: watermarked.toString('base64'),
          mimeType: 'image/jpeg',
          fileName: `house-${customer.id}.jpg`,
        });
        // Hemat storage: hapus file HD, hanya simpan thumbnail (~140 KB)
        if (saved.thumbUrl) {
          mediaService.deleteFile(saved.hdUrl);
          housePhotoUrl = saved.thumbUrl;
        } else {
          housePhotoUrl = saved.hdUrl;
        }
      }

      const currentPrefs = (customer.preferences as any) || {};
      const existingHistory: any[] = Array.isArray(currentPrefs.location_history) ? currentPrefs.location_history : [];
      const newHistoryEntry = (targetLat != null && targetLng != null && distanceKm != null)
        ? {
            source: 'FIELD_STAFF_GPS',
            lat: targetLat,
            lng: targetLng,
            staffName: staffName || 'Staff',
            distanceKm: typeof distanceKm === 'number' ? Number(distanceKm.toFixed(2)) : null,
            ongkir: newOngkir,
            updatedAt: new Date().toISOString(),
          }
        : null;
      const updatedPrefs = {
        ...currentPrefs,
        ...(housePhotoUrl ? { house_photo_url: housePhotoUrl } : {}),
        landmark: finalLandmark,
        ...(diffFromOriginalKm != null && diffFromOriginalKm > 1.0
          ? {
              field_gps_lat: lat,
              field_gps_lng: lng,
              field_gps_diff_km: Number(diffFromOriginalKm.toFixed(2)),
              field_gps_diverged: true,
            }
          : {}),
        location_updated_at: new Date().toISOString(),
        location_updated_by_staff_id: staffId,
        location_updated_by_staff_name: staffName,
        ...(newHistoryEntry ? { location_history: [...existingHistory.slice(-9), newHistoryEntry] } : {}),
      };

      const updatedCustomer = await prisma.customer.update({
        where: { id: customer.id },
        data: {
          ...(shouldUpdatePrimaryCoords && lat != null ? { lat } : {}),
          ...(shouldUpdatePrimaryCoords && lng != null ? { lng } : {}),
          ...(shouldUpdatePrimaryCoords && distanceKm != null ? { distance_km: distanceKm } : {}),
          ...(shouldUpdatePrimaryCoords && newOngkir != null ? { ongkir: newOngkir } : {}),
          ...(shouldUpdatePrimaryCoords && lat != null && lng != null
            ? { location_source: 'manual_staff' as const }
            : {}),
          preferences: updatedPrefs,
        },
      });

      // Audit log
      const { auditService } = await import('./audit.service');
      await auditService.logAdminAction({
        apiKey: 'STAFF_SESSION',
        adminIdentity: staffName,
        action: diffFromOriginalKm != null && diffFromOriginalKm > 1.0 ? 'STAFF_UPDATE_CUSTOMER_LOCATION_DIVERGED' : 'STAFF_UPDATE_CUSTOMER_LOCATION',
        targetId: customer.id,
        payload: {
          reservationId,
          submittedLat: lat,
          submittedLng: lng,
          primaryLat: updatedCustomer.lat,
          primaryLng: updatedCustomer.lng,
          distanceKm: updatedCustomer.distance_km,
          diffFromOriginalKm,
          diverged: diffFromOriginalKm != null && diffFromOriginalKm > 1.0,
          housePhotoUrl,
          landmark: finalLandmark,
        },
        tenantId,
      });

      const coordsUpdated = shouldUpdatePrimaryCoords && lat != null && lng != null;

      // Auto-sync Google Contacts (fire-and-forget)
      try {
        const { googleContactsService } = await import('./google-contacts.service');
        googleContactsService.syncCustomer(tenantId, customer.id, { trigger: 'chat' }).catch(() => {});
      } catch {}

      // Real-time SSE Broadcast ke Admin Dashboard & Rekan Staf
      try {
        const { getLiveChatHub } = await import('./live-chat-hub.service');
        getLiveChatHub().publish({
          type: 'customer.location_updated',
          tenantId,
          payload: {
            customerId: updatedCustomer.id,
            reservationId,
            staffId,
            staffName,
            lat: updatedCustomer.lat,
            lng: updatedCustomer.lng,
            submittedLat: lat,
            submittedLng: lng,
            coordsUpdated,
            diverged: diffFromOriginalKm != null && diffFromOriginalKm > 1.0,
            diffKm: diffFromOriginalKm != null ? Number(diffFromOriginalKm.toFixed(2)) : null,
            distanceKm: updatedCustomer.distance_km,
            ongkir: updatedCustomer.ongkir,
            landmark: finalLandmark,
            housePhotoUrl,
            updatedAt: new Date().toISOString(),
          },
        }).catch(() => {});
      } catch {}
      return {
        success: true,
        data: {
          customerId: updatedCustomer.id,
          lat: updatedCustomer.lat,
          lng: updatedCustomer.lng,
          distanceKm: updatedCustomer.distance_km,
          estimatedMinutes: estimateTravelDurationMinutes(updatedCustomer.distance_km),
          housePhotoUrl,
          landmark: finalLandmark,
          coordsUpdated,
          diverged: diffFromOriginalKm != null && diffFromOriginalKm > 1.0,
          diffKm: diffFromOriginalKm != null ? Number(diffFromOriginalKm.toFixed(2)) : null,
          message: (() => {
            if (diffFromOriginalKm != null && diffFromOriginalKm > 1.0) {
              return `Titik GPS lapangan berselisih ${diffFromOriginalKm.toFixed(1)} km (> 1 km). Koordinat utama customer dipertahankan, koordinat lapangan dicatat pada panduan ancer-ancer.`;
            }
            if (coordsUpdated) return 'Titik lokasi berhasil diperbarui.';
            return 'Catatan lokasi tersimpan (tanpa perubahan titik GPS).';
          })(),
        },
      };
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error updating customer location:', err.message);
      return { success: false, error: `Gagal memperbarui lokasi: ${err.message}` };
    }
  }

  /**
   * Mengambil informasi pembayaran klinik secara data-driven (QRIS & Rekening Bank).
   * Hirarki Otoritas:
   * 1. Database: `Tenant.settings.paymentInfo`
   * 2. Database: `ClinicPolicy` topic 'payment_methods'
   * 3. Fallback: Default safe clinic payment info
   */
  static async getPaymentInfo(tenantId = DEFAULT_TENANT_ID): Promise<{
    qrisImageUrl: string | null;
    bankAccounts: Array<{ bank: string; accountNumber: string; accountName: string }>;
    instructions?: string;
    customTemplate?: string | null;
  }> {
    try {
      // 1. Cek Tenant.settings.paymentInfo
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true, name: true },
      });

      const settings = (tenant?.settings as any) || {};
      if (settings.paymentInfo && typeof settings.paymentInfo === 'object') {
        const pInfo = settings.paymentInfo;
        return {
          qrisImageUrl: pInfo.qrisImageUrl || null,
          bankAccounts: Array.isArray(pInfo.bankAccounts) ? pInfo.bankAccounts : [],
          instructions: pInfo.instructions || undefined,
          customTemplate: typeof pInfo.customTemplate === 'string' ? pInfo.customTemplate : null,
        };
      }

      // 2. Cek ClinicPolicy topic 'payment_methods'
      const policy = await (prisma as any).clinicPolicy.findUnique({
        where: { tenant_id_topic: { tenant_id: tenantId, topic: 'payment_methods' } },
        select: { factual_summary: true, suggested_reply: true, is_active: true },
      });

      if (policy && policy.is_active && policy.factual_summary) {
        try {
          const parsed = JSON.parse(policy.factual_summary);
          if (parsed && (parsed.bankAccounts || parsed.qrisImageUrl)) {
            return {
              qrisImageUrl: parsed.qrisImageUrl || null,
              bankAccounts: Array.isArray(parsed.bankAccounts) ? parsed.bankAccounts : [],
              instructions: parsed.instructions || undefined,
              customTemplate: typeof parsed.customTemplate === 'string' ? parsed.customTemplate : null,
            };
          }
        } catch (_) {
          // Bukan JSON, lanjut ke fallback
        }
      }

      // 3. Fallback default data-driven dari data tenant
      return {
        qrisImageUrl: null,
        bankAccounts: [
          {
            bank: 'BCA',
            accountNumber: '1234567890',
            accountName: tenant?.name || 'Kala Moms and Baby Spa',
          },
        ],
      };
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error fetching payment info:', err.message);
      return {
        qrisImageUrl: null,
        bankAccounts: [],
      };
    }
  }

  /**
   * Mencatat waktu kedatangan bidan di depan rumah/lokasi pasien (ARRIVED).
   * Mengirim pesan cepat WhatsApp ke pasien secara otomatis dan mengupdate arrived_at di database.
   */
  static async recordArrival(params: {
    reservationId: string;
    staffId: string;
    tenantId: string;
    staffName?: string;
    isSupervisor?: boolean;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    const { reservationId, staffId, tenantId, staffName = 'Bidan Terapis', isSupervisor = false } = params;

    try {
      const reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
        include: {
          customer: {
            include: {
              conversations: {
                where: { tenant_id: tenantId },
                orderBy: { updated_at: 'desc' },
                take: 1,
              },
            },
          },
          assigned_staff: true,
        },
      });

      if (!reservation) {
        return { success: false, error: 'Reservasi tidak ditemukan.' };
      }

      if ((reservation as any).tenant_id !== tenantId) {
        return { success: false, error: 'Reservasi tidak ditemukan.' };
      }

      // Anti-IDOR: Hanya staf yang ditugaskan atau supervisor yang dapat mencatat kedatangan
      if (!isSupervisor) {
        const assigned = (reservation as any).assigned_staff_id;
        if (!assigned || assigned !== staffId) {
          return {
            success: false,
            error: 'Anda tidak memiliki hak akses untuk jadwal terapis lain.',
          };
        }
      }

      const statusLower = String((reservation as any).status || '').toLowerCase();
      if (['completed', 'cancelled', 'rejected'].includes(statusLower)) {
        return {
          success: false,
          error: `Kedatangan tidak dapat dicatat untuk jadwal berstatus "${(reservation as any).status}".`,
        };
      }

      const now = new Date();

      // 1. Update arrived_at di DB
      await prisma.reservation.update({
        where: { id: reservationId },
        data: {
          arrived_at: now,
        },
      });

      // 2. Kirim pesan WhatsApp otomatis bahwa bidan sudah sampai
      const conversation = (reservation as any).customer?.conversations?.[0];
      const patientName = (reservation as any).customer?.name || 'Bunda';
      const therapistName = (reservation as any).assigned_staff?.name || staffName;

      let waResult: any = null;
      if (conversation) {
        const { liveChatService } = await import('./live-chat.service');
        const arrivalText = `Halo ${patientName}, saya ${therapistName} sudah sampai di depan rumah/lokasi Bunda ya 🙏`;
        waResult = await liveChatService.sendAdminReply({
          conversationId: conversation.id,
          text: arrivalText,
          tenantId,
          adminName: therapistName,
          forceEscalate: true,
        });
      }

      // 3. Audit trail
      const { auditService } = await import('./audit.service');
      await auditService.logAdminAction({
        apiKey: 'STAFF_SESSION',
        adminIdentity: staffName,
        action: 'STAFF_ARRIVED',
        targetId: reservationId,
        payload: {
          conversationId: conversation?.id || null,
          arrivedAt: now.toISOString(),
        },
        tenantId,
      });

      return {
        success: true,
        data: {
          reservationId,
          arrivedAt: now,
          waResult,
        },
      };
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error recording arrival:', err.message);
      return { success: false, error: `Gagal mencatat kedatangan: ${err.message}` };
    }
  }

  /**
   * Menandai tindakan kunjungan telah selesai dilakukan oleh terapis di lapangan (COMPLETED).
   */
  static async completeTask(params: {
    reservationId: string;
    staffId: string;
    tenantId: string;
    staffName?: string;
    isSupervisor?: boolean;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    const { reservationId, staffId, tenantId, staffName = 'Bidan Terapis', isSupervisor = false } = params;
    try {
      const reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
      });

      if (!reservation || reservation.tenant_id !== tenantId) {
        return { success: false, error: 'Reservasi tidak ditemukan.' };
      }

      if (!isSupervisor && reservation.assigned_staff_id !== staffId) {
        return { success: false, error: 'Anda tidak memiliki akses untuk menyelesaikan jadwal terapis lain.' };
      }

      const updated = await prisma.reservation.update({
        where: { id: reservationId },
        data: { status: 'completed' },
      });

      const { auditService } = await import('./audit.service');
      await auditService.logAdminAction({
        apiKey: 'STAFF_SESSION',
        adminIdentity: staffName,
        action: 'STAFF_COMPLETE_VISIT',
        targetId: reservationId,
        tenantId,
      });

      // Real-time SSE Broadcast: tugas selesai
      try {
        const { getLiveChatHub } = await import('./live-chat-hub.service');
        getLiveChatHub().publish({
          type: 'staff.task_completed',
          tenantId,
          payload: {
            reservationId,
            staffId,
            staffName,
            customerId: reservation.customer_id,
            completedAt: new Date().toISOString(),
          },
        }).catch(() => {});
      } catch {}

      return { success: true, data: updated };
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error completing task:', err.message);
      return { success: false, error: `Gagal menyelesaikan kunjungan: ${err.message}` };
    }
  }

  /**
   * Mengirimkan informasi pembayaran resmi klinik (QRIS & rekening bank)
   * langsung ke nomor WhatsApp customer secara data-driven dan anti-duplikasi file.
   */
  static async sendPaymentInfo(params: {
    reservationId: string;
    staffId: string;
    tenantId: string;
    staffName?: string;
    isSupervisor?: boolean;
  }): Promise<{ success: boolean; data?: any; error?: string }> {
    const { reservationId, staffId, tenantId, staffName = 'Bidan Terapis', isSupervisor = false } = params;

    try {
      const reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
        include: {
          customer: {
            include: {
              conversations: {
                where: { tenant_id: tenantId },
                orderBy: { updated_at: 'desc' },
                take: 1,
              },
            },
          },
          assigned_staff: true,
        },
      });

      if (!reservation || reservation.tenant_id !== tenantId) {
        return { success: false, error: 'Reservasi tidak ditemukan.' };
      }

      // Anti-IDOR: Hanya staf yang ditugaskan atau supervisor yang dapat mengirim info pembayaran
      if (!isSupervisor) {
        const assigned = reservation.assigned_staff_id;
        if (!assigned || assigned !== staffId) {
          return {
            success: false,
            error: 'Anda tidak memiliki hak akses untuk jadwal terapis lain.',
          };
        }
      }

      const conversation = (reservation as any).customer?.conversations?.[0];
      if (!conversation) {
        return {
          success: false,
          error: 'Belum ada percakapan WhatsApp yang terhubung dengan customer ini.',
        };
      }

      // Ambil konfigurasi data-driven pembayaran klinik
      const paymentInfo = await this.getPaymentInfo(tenantId);
      const hasQris = !!paymentInfo.qrisImageUrl;
      const hasBank = Array.isArray(paymentInfo.bankAccounts) && paymentInfo.bankAccounts.length > 0;

      if (!hasQris && !hasBank) {
        return {
          success: false,
          error: 'Informasi pembayaran (QRIS / Rekening Bank) belum diatur di Pengaturan Klinik.',
        };
      }

      const patientName = reservation.customer?.name || 'Bunda';
      const therapistName = reservation.assigned_staff?.name || staffName;

      // Hitung rincian biaya
      const treatmentFee = typeof reservation.purchase_value === 'number' ? reservation.purchase_value : 0;
      const deliveryFee = typeof (reservation.customer as any)?.ongkir === 'number' ? (reservation.customer as any).ongkir : 0;
      const totalFee = treatmentFee + deliveryFee;

      // Susun pesan WhatsApp — data-driven: customTemplate dari DB (Tenant.settings.paymentInfo.customTemplate)
      const rawTemplate = (paymentInfo as any).customTemplate;
      const hasCustomTemplate = typeof rawTemplate === 'string' && rawTemplate.trim().length > 0;
      let fullText: string;
      if (hasCustomTemplate) {
        const daftarRekening = hasBank
          ? paymentInfo.bankAccounts.map((a) => `• *${a.bank}*: \`${a.accountNumber}\`\n  a.n. ${a.accountName}`).join('\n')
          : '-';
        const rincianBiaya = totalFee > 0
          ? (treatmentFee > 0 && deliveryFee > 0
            ? `Treatment: Rp ${treatmentFee.toLocaleString('id-ID')} + Ongkir: Rp ${deliveryFee.toLocaleString('id-ID')}`
            : `Total: Rp ${totalFee.toLocaleString('id-ID')}`)
          : '-';
        const keteranganQris = hasQris ? 'Barcode QRIS terlampir di atas untuk kemudahan scan pembayaran' : '-';
        const vars: Record<string, string> = {
          '{nama_pasien}': patientName,
          '{total_tagihan}': totalFee > 0 ? `Rp ${totalFee.toLocaleString('id-ID')}` : '-',
          '{rincian_biaya}': rincianBiaya,
          '{daftar_layanan}': reservation.treatment_detail || '-',
          '{daftar_rekening}': daftarRekening,
          '{keterangan_qris}': keteranganQris,
          '{petunjuk}': (paymentInfo.instructions || '').trim() || '-',
          '{nama_terapis}': therapistName,
        };
        fullText = rawTemplate;
        for (const [k, v] of Object.entries(vars)) {
          fullText = fullText.split(k).join(v);
        }
        // Variabel tak dikenal dibiarkan kosong tanpa error (hapus sisa placeholder {xxx})
        fullText = fullText.replace(/\{[a-z_]+\}/gi, '');
      } else {
        const lines: string[] = [
          `Halo Bunda ${patientName}, berikut informasi pembayaran resmi klinik:`,
        ];
        if (totalFee > 0) {
          lines.push('');
          lines.push(`💰 *Total Tagihan:* Rp ${totalFee.toLocaleString('id-ID')}`);
          if (treatmentFee > 0 && deliveryFee > 0) {
            lines.push(`_(Treatment: Rp ${treatmentFee.toLocaleString('id-ID')} + Ongkir: Rp ${deliveryFee.toLocaleString('id-ID')})_`);
          }
          if (reservation.treatment_detail) {
            lines.push(`📋 *Layanan:* ${reservation.treatment_detail}`);
          }
        }
        if (hasBank) {
          lines.push('');
          lines.push('🏦 *Transfer Bank Resmi Klinik:*');
          for (const acc of paymentInfo.bankAccounts) {
            lines.push(`• *${acc.bank}*: \`${acc.accountNumber}\``);
            lines.push(`  a.n. ${acc.accountName}`);
          }
        }
        if (hasQris) {
          lines.push('');
          lines.push('📱 _(Barcode QRIS terlampir di atas untuk kemudahan scan pembayaran)_');
        }
        if (paymentInfo.instructions && paymentInfo.instructions.trim()) {
          lines.push('');
          lines.push(`ℹ️ _${paymentInfo.instructions.trim()}_`);
        }
        lines.push('');
        lines.push('Mohon konfirmasi atau kirimkan bukti transfer ke sini setelah pembayaran ya Bunda. Terima kasih banyak 🙏');
        lines.push('');
        lines.push(`~ ${therapistName}`);
        fullText = lines.join('\n');
      }

      const { liveChatService } = await import('./live-chat.service');

      let sendResult: any = null;

      // Smart Caption Splitter: WhatsApp membatasi caption gambar maks 1024 karakter.
      if (hasQris && paymentInfo.qrisImageUrl) {
        if (fullText.length <= 1000) {
          // Muat dalam 1 pesan bergambar ber-caption
          sendResult = await liveChatService.sendAdminReply({
            conversationId: conversation.id,
            text: fullText,
            mediaUrl: paymentInfo.qrisImageUrl,
            mimeType: 'image/png',
            fileName: 'qris-klinik.png',
            tenantId,
            adminName: therapistName,
            forceEscalate: true,
          });
        } else {
          // Melebihi 1000 karakter: kirim QRIS terlebih dahulu, lalu rincian teks lengkap
          await liveChatService.sendAdminReply({
            conversationId: conversation.id,
            text: 'Barcode QRIS Resmi Klinik:',
            mediaUrl: paymentInfo.qrisImageUrl,
            mimeType: 'image/png',
            fileName: 'qris-klinik.png',
            tenantId,
            adminName: therapistName,
            forceEscalate: true,
          });

          sendResult = await liveChatService.sendAdminReply({
            conversationId: conversation.id,
            text: fullText,
            tenantId,
            adminName: therapistName,
            forceEscalate: true,
          });
        }
      } else {
        // Hanya teks rekening bank (tanpa QRIS)
        sendResult = await liveChatService.sendAdminReply({
          conversationId: conversation.id,
          text: fullText,
          tenantId,
          adminName: therapistName,
          forceEscalate: true,
        });
      }

      if (!sendResult.success) {
        return {
          success: false,
          error: sendResult.error?.message || 'Gagal mengirim informasi pembayaran ke WhatsApp.',
        };
      }

      // Audit Trail
      const { auditService } = await import('./audit.service');
      await auditService.logAdminAction({
        apiKey: 'STAFF_SESSION',
        adminIdentity: therapistName,
        action: 'STAFF_SEND_PAYMENT_INFO',
        targetId: reservationId,
        payload: {
          conversationId: conversation.id,
          hasQris,
          totalFee,
          bankAccountsCount: paymentInfo.bankAccounts.length,
        },
        tenantId,
      });

      return {
        success: true,
        data: {
          reservationId,
          sentAt: new Date(),
          hasQris,
          totalFee,
          waResult: sendResult,
        },
      };
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error sending payment info:', err.message);
      return { success: false, error: `Gagal mengirim info pembayaran: ${err.message}` };
    }
  }
}

