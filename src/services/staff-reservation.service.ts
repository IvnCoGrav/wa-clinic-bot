import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { calculateHaversineDistance, Coordinates } from '../utils/haversine';
import { clinicConfig } from '../config/clinic';

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
    const wibNow = new Date(wibMs);
    let targetYear = wibNow.getUTCFullYear();
    let targetMonth = wibNow.getUTCMonth();
    let targetDay = wibNow.getUTCDate();

    let isToday = true;
    let isTomorrow = false;

    if (targetDateParam === 'tomorrow') {
      targetDay += 1;
      isToday = false;
      isTomorrow = true;
    } else if (targetDateParam && targetDateParam !== 'today') {
      const match = targetDateParam.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (match) {
        targetYear = parseInt(match[1], 10);
        targetMonth = parseInt(match[2], 10) - 1;
        targetDay = parseInt(match[3], 10);

        const nowDayStr = `${wibNow.getUTCFullYear()}-${String(wibNow.getUTCMonth() + 1).padStart(2, '0')}-${String(wibNow.getUTCDate()).padStart(2, '0')}`;
        const tomorrowWib = new Date(wibMs + 24 * 60 * 60 * 1000);
        const tomorrowDayStr = `${tomorrowWib.getUTCFullYear()}-${String(tomorrowWib.getUTCMonth() + 1).padStart(2, '0')}-${String(tomorrowWib.getUTCDate()).padStart(2, '0')}`;

        isToday = targetDateParam === nowDayStr;
        isTomorrow = targetDateParam === tomorrowDayStr;
      }
    }

    // 00:00:00.000 WIB dinyatakan dalam UTC adalah jam -7
    const startOfDay = new Date(Date.UTC(targetYear, targetMonth, targetDay, -7, 0, 0, 0));
    const endOfDay = new Date(Date.UTC(targetYear, targetMonth, targetDay, 16, 59, 59, 999));

    const displayDate = new Date(Date.UTC(targetYear, targetMonth, targetDay, 0, 0, 0));
    const formattedDate = displayDate.toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });

    const monthStr = String(targetMonth + 1).padStart(2, '0');
    const dayStr = String(targetDay).padStart(2, '0');
    const dateStr = `${targetYear}-${monthStr}-${dayStr}`;

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

    try {
      const whereCondition: any = {
        tenant_id: tenantId,
        booking_date: { gte: startOfDay, lte: endOfDay },
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
              reservations: {
                where: { status: { notIn: ['cancelled', 'rejected'] } },
                select: {
                  id: true,
                  purchase_value: true,
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
        orderBy: { booking_date: 'asc' },
      });

      const circuityFactor = parseFloat(process.env.HAVERSINE_CIRCUITY_FACTOR || '1.60');
      let prevCoords: Coordinates = { lat: clinicConfig.lat, lng: clinicConfig.lng };
      let prevOriginName = 'Klinik';
      let isFirstPatient = true;

      return rows.map((r) => {
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
        const treatmentFee = r.purchase_value || 0;
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
            totalTreatments: (cust?.reservations?.length ?? 0) > 0 ? (cust?.reservations?.length ?? 1) : 1,
            ltv: (cust?.reservations || []).reduce((acc: number, curr: any) => acc + (curr.purchase_value || 0), 0) || pricing.totalFee,
          },
        };
      });
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error fetching today tasks:', err.message);
      return [];
    }
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

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const maxDate = new Date(tomorrow);
    maxDate.setDate(maxDate.getDate() + daysAhead);
    maxDate.setHours(23, 59, 59, 999);

    try {
      const rows = await prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          assigned_staff_id: staffId,
          booking_date: { gte: tomorrow, lte: maxDate },
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

      return rows.map((r) => {
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

        const treatmentFee = r.purchase_value || 0;
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
      });
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

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const minDate = new Date();
    minDate.setDate(minDate.getDate() - daysPast);
    minDate.setHours(0, 0, 0, 0);

    try {
      const rows = await prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          assigned_staff_id: staffId,
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

      return rows.map((r) => {
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

        const treatmentFee = r.purchase_value || 0;
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
          conversationId: null,
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
        };
      });
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

      const totalPaid = amount ?? reservation.purchase_value ?? 0;
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
      const updated = await prisma.reservation.update({
        where: { id: reservationId },
        data: {
          purchase_occurred_at: now,
          purchase_value: totalPaid,
          purchase_review_status: 'confirmed',
          status: 'completed',
          payment_method: paymentMethod,
          proof_url: proofUrl,
        },
      });

      // Kirim konfirmasi pembayaran otomatis ke chat customer jika ada percakapan aktif
      const conversationId = reservation.customer?.conversations?.[0]?.id;
      if (conversationId) {
        const methodLabel = paymentMethod === 'CASH' ? 'Tunai' : paymentMethod === 'QRIS' ? 'QRIS' : 'Transfer';
        const receiptText = `✅ *PEMBAYARAN DITERIMA*\n\nTerima kasih Bunda ${reservation.customer?.name || ''}! Pembayaran sebesar *Rp ${totalPaid.toLocaleString('id-ID')}* (${methodLabel}) telah berhasil diterima dan dicatat.\n\nSemoga adik lekas sehat, ceria, dan tumbuh kembangnya optimal ya Bunda! 🙏🥰✨\n\n~ ${staffName}`;

        try {
          const { liveChatService } = await import('./live-chat.service');
          await liveChatService.sendAdminReply({
            conversationId,
            text: receiptText,
            tenantId,
            adminName: staffName,
            // Konfirmasi pembayaran oleh terapis juga menandakan percakapan
            // ditangani manusia → bot tidak membalas lagi setelahnya.
            forceEscalate: true,
          });
        } catch (chatErr: any) {
          console.error('[STAFF RESERVATION] Error sending receipt chat message:', chatErr.message);
        }
      }

      // Audit log
      const { auditService } = await import('./audit.service');
      await auditService.logAdminAction({
        apiKey: 'STAFF_SESSION',
        adminIdentity: staffName,
        action: 'STAFF_RECORD_PAYMENT',
        targetId: reservationId,
        payload: {
          paymentMethod,
          amount: totalPaid,
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

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    try {
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { customer_id: true, tenant_id: true },
      });

      if (!conv || conv.tenant_id !== tenantId) return false;

      if (isSupervisor) {
        const anyToday = await prisma.reservation.findFirst({
          where: {
            tenant_id: tenantId,
            customer_id: conv.customer_id,
            booking_date: { gte: startOfDay, lte: endOfDay },
          },
          select: { id: true },
        });
        if (anyToday) return true;
      }

      const owns = await prisma.reservation.findFirst({
        where: {
          tenant_id: tenantId,
          customer_id: conv.customer_id,
          assigned_staff_id: staffId,
          booking_date: { gte: startOfDay, lte: endOfDay },
        },
        select: { id: true },
      });

      return !!owns;
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

      // Kirim notifikasi push ke staf terapis yang baru ditugaskan (jika ada layanan notifikasi)
      try {
        const { staffNotificationService } = await import('./staff-notification.service');
        await staffNotificationService.sendReservationAssignmentNotification(reservationId, targetStaffId);
      } catch (notifErr: any) {
        console.warn('[STAFF RESERVATION] Warning: could not send reassign notification:', notifErr.message);
      }

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

      if (targetLat != null && targetLng != null) {
        // Validasi range koordinat Indonesia
        if (targetLat < -12 || targetLat > 7 || targetLng < 94 || targetLng > 142) {
          return { success: false, error: 'Koordinat GPS di luar wilayah Indonesia atau tidak valid.' };
        }

        const clinicCoords = { lat: clinicConfig.lat, lng: clinicConfig.lng };
        distanceKm = calculateHaversineDistance(clinicCoords, { lat: targetLat, lng: targetLng });

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

          if (diffFromOriginalKm > 1.0) {
            // Selisih > 1km: JANGAN ubah koordinat utama (Customer.lat & Customer.lng)
            // Simpan koordinat revisi di catatan ancer-ancer / patokan & preferences
            shouldUpdatePrimaryCoords = false;
            const gpsTag = `[📍 GPS Lapangan: ${lat.toFixed(6)}, ${lng.toFixed(6)} (+${diffFromOriginalKm.toFixed(1)}km)]`;
            finalLandmark = baseLandmark ? `${baseLandmark} ${gpsTag}` : gpsTag;
          } else {
            // Selisih <= 1km: Koreksi presisi posisi pagar/rumah
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
        housePhotoUrl = saved.hdUrl;
      }

      const currentPrefs = (customer.preferences as any) || {};
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
      };

      const updatedCustomer = await prisma.customer.update({
        where: { id: customer.id },
        data: {
          ...(shouldUpdatePrimaryCoords && lat != null ? { lat } : {}),
          ...(shouldUpdatePrimaryCoords && lng != null ? { lng } : {}),
          ...(shouldUpdatePrimaryCoords && distanceKm != null ? { distance_km: distanceKm } : {}),
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
          diverged: diffFromOriginalKm != null && diffFromOriginalKm > 1.0,
          diffKm: diffFromOriginalKm != null ? Number(diffFromOriginalKm.toFixed(2)) : null,
          message:
            diffFromOriginalKm != null && diffFromOriginalKm > 1.0
              ? `Titik GPS lapangan berselisih ${diffFromOriginalKm.toFixed(1)} km (> 1 km). Koordinat utama customer dipertahankan, koordinat lapangan dicatat pada panduan ancer-ancer.`
              : 'Titik lokasi berhasil diperbarui.',
        },
      };
    } catch (err: any) {
      console.error('[STAFF RESERVATION] Error updating customer location:', err.message);
      return { success: false, error: `Gagal memperbarui lokasi: ${err.message}` };
    }
  }
}
