import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { calculateHaversineDistance, Coordinates } from '../../utils/haversine';
import { clinicConfig } from '../../config/clinic';
import { resolveTreatmentValue } from '../capi.service';
import { resolveDeliveryFeeSnapshot } from '../reservation-core.service';
import {
  getStaffChatWindowConfig,
  StaffChatWindowConfig,
} from '../../config/staff-chat-window-config';
import {
  StaffTaskItem,
  StaffTaskPricing,
} from './types';
import {
  selectTaskChildren,
  buildMapsUrls,
  buildAddressText,
  buildEffectiveTaskAddress,
  resolveLocationSource,
  estimateTravelDurationMinutes,
  buildShareText,
  evaluateChatWindowForBooking,
} from './task-builder';

export const PRIVACY_NEAR_CLINIC_KM = 1.5;

/**
 * Menghitung rentang waktu 00:00:00 s/d 23:59:59 dalam zona waktu WIB untuk tanggal tertentu (hari ini, besok, atau spesifik YYYY-MM-DD).
 */
export function getWibDateRange(targetDateParam?: string): {
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
 * Serialisasi status jendela chat untuk payload task (server-driven).
 * Supervisor selalu 'open' agar UI tidak menonaktifkan tombol bagi pengawas.
 */
function buildChatWindowForTask(
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
 * Mengambil daftar tugas reservasi khusus milik staff ini untuk hari ini/besok/tanggal tertentu,
 * diperkaya dengan alamat, data anak/bayi, navigasi turn-by-turn Maps, rincian harga,
 * dan perhitungan jarak berantai sekuensial (Klinik -> Pasien 1 -> Pasien 2) via Haversine.
 * Catatan keamanan: Nomor HP customer SENGAJA TIDAK di-select dari database (masking layer).
 */
export async function getTodayTasks(
  staffId: string,
  tenantId = DEFAULT_TENANT_ID,
  scope: 'mine' | 'all' = 'mine',
  isSupervisor = false,
  targetDateParam?: string
): Promise<StaffTaskItem[]> {
  if (!staffId) return [];

  const { startOfDay, endOfDay } = getWibDateRange(targetDateParam);
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
        payment_method: true,
        proof_url: true,
        receipt_amount: true,
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
            location_source: true,
            distance_km: true,
            ongkir: true,
            preferences: true,
            profile_picture_url: true,
            admin_notes: true,
            children: {
              select: {
                name: true,
                raw_age_text: true,
                birth_date: true,
                age_months_at_registration: true,
                created_at: true,
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
            age_months_at_registration: true,
            created_at: true,
          },
        },
        customer_address: true,
      },
      orderBy: { booking_date: 'asc' },
    });

    const circuityFactor = parseFloat(process.env.HAVERSINE_CIRCUITY_FACTOR || '1.60');

    // Fase 1.1/1.2: itinerary berantai dihitung SEKALI, SEKUENSIAL, dan per-terapis.
    type ItineraryEntry = {
      distanceKm: number | null;
      distanceSource: 'CLINIC' | 'PREVIOUS_PATIENT' | null;
      originName: string | null;
    };
    const itineraryById = new Map<string, ItineraryEntry>();
    {
      const { deliveryService } = await import('../delivery.service');
      const trackerByStaff = new Map<
        string,
        { coords: Coordinates; originName: string; isFirst: boolean }
      >();
      for (const r of rows) {
        const c = r.customer;
        const addr = (r as any).customer_address;
        const staffKey = (r as any).assigned_staff?.id || 'unassigned';
        const tracker = trackerByStaff.get(staffKey) || {
          coords: { lat: clinicConfig.lat, lng: clinicConfig.lng },
          originName: clinicConfig.name || 'Klinik',
          isFirst: true,
        };
        const lat = addr?.lat ?? c?.lat;
        const lng = addr?.lng ?? c?.lng;

        if (typeof lat !== 'number' || typeof lng !== 'number') {
          itineraryById.set(r.id, {
            distanceKm: addr?.distance_km ?? c?.distance_km ?? null,
            distanceSource: 'CLINIC',
            originName: clinicConfig.name || 'Klinik',
          });
          continue;
        }

        const currentCoords: Coordinates = { lat, lng };
        if (tracker.isFirst) {
          let dist: number | null = addr?.distance_km ?? c?.distance_km ?? null;
          if (dist == null) {
            try {
              const calc = await deliveryService.calculateDelivery({ lat, lng }, undefined, tenantId);
              if (typeof calc?.distanceKm === 'number') dist = calc.distanceKm;
            } catch (e: any) {
              console.warn(`[STAFF ITINERARY] calculateDelivery gagal untuk reservasi ${r.id}, pakai fallback Haversine: ${e?.message || e}`);
            }
          }
          if (dist == null) {
            dist = parseFloat((calculateHaversineDistance(tracker.coords, currentCoords) * circuityFactor).toFixed(1));
          }
          itineraryById.set(r.id, {
            distanceKm: dist,
            distanceSource: 'CLINIC',
            originName: clinicConfig.name || 'Klinik',
          });
        } else {
          const straightKm = calculateHaversineDistance(tracker.coords, currentCoords);
          itineraryById.set(r.id, {
            distanceKm: parseFloat((straightKm * circuityFactor).toFixed(1)),
            distanceSource: 'PREVIOUS_PATIENT',
            originName: tracker.originName,
          });
        }
        tracker.coords = currentCoords;
        tracker.originName = c?.name
          ? c.name.toLowerCase().startsWith('bunda')
            ? c.name
            : `Bunda ${c.name}`
          : 'Pasien Sebelumnya';
        tracker.isFirst = false;
        trackerByStaff.set(staffKey, tracker);
      }
    }

    return Promise.all(
      rows.map(async (r) => {
        const cust = r.customer;
        const addr = (r as any).customer_address;
        const effectiveAddr = buildEffectiveTaskAddress(addr, cust);
        const addrHasCoords =
          effectiveAddr?.lat != null && effectiveAddr?.lng != null;
        const lat = (addrHasCoords ? effectiveAddr?.lat : undefined) ?? cust?.lat;
        const lng = (addrHasCoords ? effectiveAddr?.lng : undefined) ?? cust?.lng;
        const addressText = buildAddressText(effectiveAddr || {});
        const locationSource = addrHasCoords
          ? resolveLocationSource(effectiveAddr) || resolveLocationSource(cust)
          : resolveLocationSource(cust) || resolveLocationSource(effectiveAddr);
        const { mapsUrl, navigationUrl } = buildMapsUrls(lat, lng, locationSource, addressText);

        const itinerary = itineraryById.get(r.id) || {
          distanceKm: cust?.distance_km ?? null,
          distanceSource: 'CLINIC' as const,
          originName: clinicConfig.name || 'Klinik',
        };
        const distanceKm = itinerary.distanceKm;
        const distanceSource = itinerary.distanceSource;
        const originName = itinerary.originName;

        const childrenList = selectTaskChildren(r.children, cust?.children);

        let treatmentFee = r.purchase_value || 0;
        if (treatmentFee <= 0 && r.treatment_detail) {
          const resolved = await resolveTreatmentValue(r.treatment_detail);
          if (resolved && resolved > 0) treatmentFee = resolved;
        }
        const deliveryFee = resolveDeliveryFeeSnapshot({ ...(r as any), customer: cust ?? (r as any).customer });
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
          paymentMethod: (r as any).payment_method ?? null,
          proofUrl: (r as any).proof_url ?? null,
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
            kelurahan: effectiveAddr?.kelurahan || cust?.kelurahan || null,
            kecamatan: effectiveAddr?.kecamatan || cust?.kecamatan || null,
            kota: effectiveAddr?.kota || cust?.kota || null,
            lat: lat ?? null,
            lng: lng ?? null,
            distanceKm,
            estimatedMinutes: estimateTravelDurationMinutes(distanceKm),
            distanceSource,
            originName,
            fullText: addressText,
            housePhotoUrl: (cust?.preferences as any)?.house_photo_url || null,
            landmark: (effectiveAddr as any)?.landmark || (cust?.preferences as any)?.landmark || null,
            addressDetail: (effectiveAddr as any)?.address || (cust?.preferences as any)?.address || (cust?.preferences as any)?.full_address || null,
            locationSource,
            addressSource: (effectiveAddr as any)?.address_source ?? null,
            addressUpdatedAt: (effectiveAddr as any)?.address_updated_at ?? null,
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
          adminNotes: (cust as any)?.admin_notes || null,
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
          chatWindow: buildChatWindowForTask(
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
 * Mengambil daftar jadwal reservasi masa depan (hari esok dan seterusnya) milik staff.
 * Bersifat jadwal saja (read-only), TIDAK memiliki akses atau menyertakan conversationId/chat.
 */
export async function getUpcomingSchedule(
  staffId: string,
  tenantId = DEFAULT_TENANT_ID,
  daysAhead = 30
): Promise<StaffTaskItem[]> {
  if (!staffId) return [];

  const { startOfDay: tomorrow } = getWibDateRange('tomorrow');
  const maxEnd = getWibDateRange(
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
        payment_method: true,
        proof_url: true,
        receipt_amount: true,
        customer: {
          select: {
            name: true,
            lat: true,
            lng: true,
            kelurahan: true,
            kecamatan: true,
            kota: true,
            location_source: true,
            distance_km: true,
            ongkir: true,
            preferences: true,
            profile_picture_url: true,
            admin_notes: true,
            children: {
              select: {
                name: true,
                raw_age_text: true,
                birth_date: true,
                age_months_at_registration: true,
                created_at: true,
              },
            },
          },
        },
        children: {
          select: {
            name: true,
            raw_age_text: true,
            birth_date: true,
            age_months_at_registration: true,
            created_at: true,
          },
        },
        customer_address: true,
      },
      orderBy: { booking_date: 'asc' },
    });

    const circuityFactor = parseFloat(process.env.HAVERSINE_CIRCUITY_FACTOR || '1.60');

    type ItineraryEntry = {
      distanceKm: number | null;
      distanceSource: 'CLINIC' | 'PREVIOUS_PATIENT' | null;
      originName: string | null;
    };
    const itineraryById = new Map<string, ItineraryEntry>();
    {
      const { deliveryService } = await import('../delivery.service');
      const trackerByKey = new Map<
        string,
        { coords: Coordinates; originName: string; isFirst: boolean }
      >();
      for (const r of rows) {
        const c = r.customer;
        const addr = (r as any).customer_address;
        const staffKey = (r as any).assigned_staff?.id || 'unassigned';
        const dateKey = r.booking_date ? new Date(r.booking_date).toISOString().split('T')[0] : '';
        const chainKey = `${staffKey}::${dateKey}`;
        const tracker = trackerByKey.get(chainKey) || {
          coords: { lat: clinicConfig.lat, lng: clinicConfig.lng },
          originName: clinicConfig.name || 'Klinik',
          isFirst: true,
        };
        const lat = addr?.lat ?? c?.lat;
        const lng = addr?.lng ?? c?.lng;

        if (typeof lat !== 'number' || typeof lng !== 'number') {
          itineraryById.set(r.id, {
            distanceKm: addr?.distance_km ?? c?.distance_km ?? null,
            distanceSource: 'CLINIC',
            originName: clinicConfig.name || 'Klinik',
          });
          continue;
        }

        const currentCoords: Coordinates = { lat, lng };
        if (tracker.isFirst) {
          let dist: number | null = addr?.distance_km ?? c?.distance_km ?? null;
          if (dist == null) {
            try {
              const calc = await deliveryService.calculateDelivery({ lat, lng }, undefined, tenantId);
              if (typeof calc?.distanceKm === 'number') dist = calc.distanceKm;
            } catch (e: any) {
              console.warn(`[STAFF ITINERARY] calculateDelivery gagal untuk reservasi ${r.id}, pakai fallback Haversine: ${e?.message || e}`);
            }
          }
          if (dist == null) {
            dist = parseFloat((calculateHaversineDistance(tracker.coords, currentCoords) * circuityFactor).toFixed(1));
          }
          itineraryById.set(r.id, {
            distanceKm: dist,
            distanceSource: 'CLINIC',
            originName: clinicConfig.name || 'Klinik',
          });
        } else {
          const straightKm = calculateHaversineDistance(tracker.coords, currentCoords);
          itineraryById.set(r.id, {
            distanceKm: parseFloat((straightKm * circuityFactor).toFixed(1)),
            distanceSource: 'PREVIOUS_PATIENT',
            originName: tracker.originName,
          });
        }
        tracker.coords = currentCoords;
        tracker.originName = c?.name
          ? c.name.toLowerCase().startsWith('bunda')
            ? c.name
            : `Bunda ${c.name}`
          : 'Pasien Sebelumnya';
        tracker.isFirst = false;
        trackerByKey.set(chainKey, tracker);
      }
    }

    return Promise.all(
      rows.map(async (r) => {
        const cust = r.customer;
        const addr = (r as any).customer_address;
        const effectiveAddr = buildEffectiveTaskAddress(addr, cust);
        const addrHasCoords =
          effectiveAddr?.lat != null && effectiveAddr?.lng != null;
        const lat = (addrHasCoords ? effectiveAddr?.lat : undefined) ?? cust?.lat;
        const lng = (addrHasCoords ? effectiveAddr?.lng : undefined) ?? cust?.lng;
        const addressText = buildAddressText(effectiveAddr || {});
        const locationSource = addrHasCoords
          ? resolveLocationSource(effectiveAddr) || resolveLocationSource(cust)
          : resolveLocationSource(cust) || resolveLocationSource(effectiveAddr);
        const { mapsUrl, navigationUrl } = buildMapsUrls(lat, lng, locationSource, addressText);

        const itinerary = itineraryById.get(r.id) || {
          distanceKm: cust?.distance_km ?? null,
          distanceSource: 'CLINIC' as const,
          originName: clinicConfig.name || 'Klinik',
        };
        const distanceKm = itinerary.distanceKm;
        const distanceSource = itinerary.distanceSource;
        const originName = itinerary.originName;

        const childrenList = selectTaskChildren(r.children, cust?.children);

        let treatmentFee = r.purchase_value || 0;
        if (treatmentFee <= 0 && r.treatment_detail) {
          const resolved = await resolveTreatmentValue(r.treatment_detail);
          if (resolved && resolved > 0) treatmentFee = resolved;
        }
        const deliveryFee = resolveDeliveryFeeSnapshot({ ...(r as any), customer: cust ?? (r as any).customer });
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
          paymentMethod: (r as any).payment_method ?? null,
          proofUrl: (r as any).proof_url ?? null,
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
            kelurahan: effectiveAddr?.kelurahan || cust?.kelurahan || null,
            kecamatan: effectiveAddr?.kecamatan || cust?.kecamatan || null,
            kota: effectiveAddr?.kota || cust?.kota || null,
            lat: lat ?? null,
            lng: lng ?? null,
            distanceKm,
            estimatedMinutes: estimateTravelDurationMinutes(distanceKm),
            distanceSource,
            originName,
            fullText: addressText,
            housePhotoUrl: (cust?.preferences as any)?.house_photo_url || null,
            landmark: (effectiveAddr as any)?.landmark || (cust?.preferences as any)?.landmark || null,
            addressDetail: (effectiveAddr as any)?.address || (cust?.preferences as any)?.address || (cust?.preferences as any)?.full_address || null,
            locationSource,
            addressSource: (effectiveAddr as any)?.address_source ?? null,
            addressUpdatedAt: (effectiveAddr as any)?.address_updated_at ?? null,
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
export async function getCompletedTasks(
  staffId: string,
  tenantId = DEFAULT_TENANT_ID,
  daysPast = 60
): Promise<StaffTaskItem[]> {
  if (!staffId) return [];

  const { startOfDay } = getWibDateRange('today');
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
        receipt_amount: true,
        customer: {
          select: {
            name: true,
            lat: true,
            lng: true,
            kelurahan: true,
            kecamatan: true,
            kota: true,
            location_source: true,
            distance_km: true,
            ongkir: true,
            preferences: true,
            profile_picture_url: true,
            admin_notes: true,
            children: {
              select: {
                name: true,
                raw_age_text: true,
                birth_date: true,
                age_months_at_registration: true,
                created_at: true,
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
            age_months_at_registration: true,
            created_at: true,
          },
        },
        customer_address: true,
      },
      orderBy: { booking_date: 'desc' },
    });

    return Promise.all(
      rows.map(async (r) => {
        const cust = r.customer;
        const addr = (r as any).customer_address;
        const effectiveAddr = buildEffectiveTaskAddress(addr, cust);
        const addrHasCoords =
          effectiveAddr?.lat != null && effectiveAddr?.lng != null;
        const lat = (addrHasCoords ? effectiveAddr?.lat : undefined) ?? cust?.lat;
        const lng = (addrHasCoords ? effectiveAddr?.lng : undefined) ?? cust?.lng;
        const addressText = buildAddressText(effectiveAddr || {});
        const locationSource = addrHasCoords
          ? resolveLocationSource(effectiveAddr) || resolveLocationSource(cust)
          : resolveLocationSource(cust) || resolveLocationSource(effectiveAddr);
        const { mapsUrl, navigationUrl } = buildMapsUrls(lat, lng, locationSource, addressText);

        const distanceKm = cust?.distance_km ?? null;
        const childrenList = selectTaskChildren(r.children, cust?.children);

        let treatmentFee = r.purchase_value || 0;
        if (treatmentFee <= 0 && r.treatment_detail) {
          const resolved = await resolveTreatmentValue(r.treatment_detail);
          if (resolved && resolved > 0) treatmentFee = resolved;
        }
        const deliveryFee = resolveDeliveryFeeSnapshot({ ...(r as any), customer: cust ?? (r as any).customer });
        const totalFee = treatmentFee + deliveryFee;
        // pada riwayat selesai (lihat implementation_plan revisi audit).
        const isLunas = Boolean(r.purchase_occurred_at);
        const paymentStatus: 'LUNAS' | 'TAGIH_DI_TEMPAT' = isLunas ? 'LUNAS' : 'TAGIH_DI_TEMPAT';
        const paymentStatusLabel = isLunas ? 'Lunas (Selesai)' : 'Belum Lunas';

        const pricing: StaffTaskPricing = {
          treatmentFee,
          deliveryFee,
          totalFee,
          paymentStatus,
          paymentStatusLabel,
          paymentMethod: (r as any).payment_method ?? null,
          proofUrl: (r as any).proof_url ?? null,
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
            kelurahan: effectiveAddr?.kelurahan || cust?.kelurahan || null,
            kecamatan: effectiveAddr?.kecamatan || cust?.kecamatan || null,
            kota: effectiveAddr?.kota || cust?.kota || null,
            lat: lat ?? null,
            lng: lng ?? null,
            distanceKm,
            estimatedMinutes: estimateTravelDurationMinutes(distanceKm),
            distanceSource: 'CLINIC',
            originName: 'Klinik',
            fullText: addressText,
            housePhotoUrl: (cust?.preferences as any)?.house_photo_url || null,
            landmark: (effectiveAddr as any)?.landmark || (cust?.preferences as any)?.landmark || null,
            addressDetail: (effectiveAddr as any)?.address || (cust?.preferences as any)?.address || (cust?.preferences as any)?.full_address || null,
            locationSource,
            addressSource: (effectiveAddr as any)?.address_source ?? null,
            addressUpdatedAt: (effectiveAddr as any)?.address_updated_at ?? null,
          },
          children: childrenList,
          pricing,
          shareLocationText: null,
          customerProfilePictureUrl: cust?.profile_picture_url || null,
          chatWindow: buildChatWindowForTask(
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
