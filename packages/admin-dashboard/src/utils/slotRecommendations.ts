import { calculateHaversineKm } from './geoUtils';
import { getWibHoursAndMinutes, getWibDateKey } from './dateWib';

export interface SlotRecommendation {
  startTime: string;
  departureTime: string;
  arrivalTime: string;
  endTime: string;
  staffId: string;
  staffName: string;
  distanceKm: number;
  travelMinutes: number;
  originDesc: string;
  score: number;
}

export interface RecommendStaffItem {
  id: string;
  name: string;
  active?: boolean;
  role?: string;
}

export interface RecommendReservationItem {
  id: string;
  assigned_staff_id?: string | null;
  booking_date?: Date | string | null;
  duration_minutes?: number | null;
  customer?: {
    name?: string | null;
    kelurahan?: string | null;
    lat?: number | null;
    lng?: number | null;
  } | null;
}

export interface RecommendSlotsParams {
  targetStaffList: RecommendStaffItem[];
  staffBookingsForDate: RecommendReservationItem[];
  custLat: number;
  custLng: number;
  bookingDate: string; // YYYY-MM-DD
  nowWib?: { hours: number; minutes: number; todayStr?: string };
  totalDurationMinutes: number;
  mode?: 'create' | 'edit';
  currentReservationId?: string;
  candidateSlots?: string[];
  clinicCoords?: { lat: number; lng: number; name?: string };
}

export const DEFAULT_CLINIC_COORDS = {
  lat: -7.34886,
  lng: 112.751677,
  name: 'Kala Moms and Baby Spa (Klinik)',
};

export const DEFAULT_CANDIDATE_SLOTS = [
  '08:30', '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '13:00', '13:30', '14:00',
  '14:30', '15:00', '15:30', '16:00', '16:30',
];

export function formatMinutesToTime(totalMinutes: number): string {
  const normalized = ((Math.floor(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * recommendSlots — Fungsi murni komputasi rekomendasi slot terapis (Micro-Task 4.4).
 * Memperhitungkan koordinat kartu terpilih (D-4), jarak Haversine, timeline perjalanan,
 * pencegahan bentrok jadwal, dan kuota maksimal 6 rekomendasi unik teratas.
 */
export function recommendSlots(params: RecommendSlotsParams): SlotRecommendation[] {
  const {
    targetStaffList,
    staffBookingsForDate,
    custLat,
    custLng,
    bookingDate,
    nowWib,
    totalDurationMinutes,
    mode,
    currentReservationId,
    candidateSlots = DEFAULT_CANDIDATE_SLOTS,
    clinicCoords = DEFAULT_CLINIC_COORDS,
  } = params;

  if (!targetStaffList || targetStaffList.length === 0) {
    return [];
  }

  // Waktu WIB hari ini
  const todayStr = nowWib?.todayStr || getWibDateKey(new Date());
  const isToday = bookingDate === todayStr;

  let nowMinutes = 0;
  if (nowWib) {
    nowMinutes = nowWib.hours * 60 + nowWib.minutes;
  } else {
    const { hours: nowH, minutes: nowM } = getWibHoursAndMinutes(new Date());
    nowMinutes = nowH * 60 + nowM;
  }

  const results: SlotRecommendation[] = [];

  for (const staff of targetStaffList) {
    // Filter booking milik staf pada tanggal ini
    const staffBookings = (staffBookingsForDate || [])
      .filter((r) => {
        if (!r.booking_date) return false;
        if (mode === 'edit' && currentReservationId && r.id === currentReservationId) return false;
        return r.assigned_staff_id === staff.id;
      })
      .sort((a, b) => new Date(a.booking_date!).getTime() - new Date(b.booking_date!).getTime());

    for (const slotTime of candidateSlots) {
      const [slotH, slotM] = slotTime.split(':').map(Number);
      const slotStartMinutes = slotH * 60 + slotM;
      const slotEndMinutes = slotStartMinutes + totalDurationMinutes;

      // Guard 1: Jika hari ini, jangan rekomendasikan jam yang sudah lewat / kurang dari 15 menit dari sekarang
      if (isToday && slotStartMinutes <= nowMinutes + 15) {
        continue;
      }

      // Check overlap dengan booking yang ada
      let hasConflict = false;
      let prevBooking: RecommendReservationItem | null = null;
      let nextBooking: RecommendReservationItem | null = null;

      for (const b of staffBookings) {
        const { hours: bH, minutes: bM } = getWibHoursAndMinutes(b.booking_date! ?? undefined);
        const bStartMinutes = bH * 60 + bM;
        const bDuration = b.duration_minutes || 60;
        const bEndMinutes = bStartMinutes + bDuration;

        // Direct slot overlap
        if (slotStartMinutes < bEndMinutes && slotEndMinutes > bStartMinutes) {
          hasConflict = true;
          break;
        }

        if (bEndMinutes <= slotStartMinutes) {
          prevBooking = b;
        }
        if (bStartMinutes >= slotEndMinutes && !nextBooking) {
          nextBooking = b;
        }
      }

      if (hasConflict) continue;

      // Calculate travel distance from origin (Clinic or Prev Patient)
      let originLat = clinicCoords.lat;
      let originLng = clinicCoords.lng;
      let originDesc = clinicCoords.name || 'Klinik';

      if (prevBooking) {
        const prevCust = prevBooking.customer;
        if (prevCust?.lat && prevCust?.lng) {
          originLat = prevCust.lat;
          originLng = prevCust.lng;
          originDesc = `Pasien Ny. ${prevCust.name || 'Sebelumnya'} (${prevCust.kelurahan || 'Sidoarjo'})`;
        } else {
          originDesc = `Pasien Ny. ${prevCust?.name || 'Sebelumnya'}`;
        }
      }

      const distanceKm = calculateHaversineKm(originLat, originLng, custLat, custLng);
      const travelMinutes = Math.max(5, Math.round(distanceKm * 2.05 + 3));
      const prepMinutes = 10; // Waktu bidan tiba lebih awal untuk persiapan

      // Calculate Arrival & Departure Timeline
      const plannedDepartureMinutes = slotStartMinutes - travelMinutes - prepMinutes;
      const plannedArrivalMinutes = slotStartMinutes - prepMinutes;

      // If midwife has prior booking, departure cannot be earlier than previous booking end
      if (prevBooking) {
        const { hours: pbH, minutes: pbM } = getWibHoursAndMinutes(prevBooking.booking_date! ?? undefined);
        const prevEndMinutes = pbH * 60 + pbM + (prevBooking.duration_minutes || 60);
        if (plannedDepartureMinutes < prevEndMinutes) {
          continue; // Midwife hasn't finished prior patient yet!
        }
      } else {
        // First booking of the day: departure from clinic cannot be earlier than clinic start (08:00 = 480 mins)
        if (plannedDepartureMinutes < 480) {
          continue;
        }
      }

      // Jika reservasi hari ini, waktu keberangkatan bidan tidak boleh sudah lewat dari jam sekarang
      if (isToday && plannedDepartureMinutes <= nowMinutes) {
        continue;
      }

      // If midwife has next booking, verify she can travel to next booking on time
      if (nextBooking) {
        const { hours: nbH, minutes: nbM } = getWibHoursAndMinutes(nextBooking.booking_date! ?? undefined);
        const nextStartMinutes = nbH * 60 + nbM;
        const nextCust = nextBooking.customer;
        const nextLat = nextCust?.lat || clinicCoords.lat;
        const nextLng = nextCust?.lng || clinicCoords.lng;
        const toNextDistanceKm = calculateHaversineKm(custLat, custLng, nextLat, nextLng);
        const toNextTravelMinutes = Math.max(5, Math.round(toNextDistanceKm * 2.05 + 3));

        if (slotEndMinutes + toNextTravelMinutes + 10 > nextStartMinutes) {
          continue; // Cannot arrive at next booking in time!
        }
      }

      // Score: closer distance gets higher priority
      const score = Math.max(1, 100 - distanceKm * 5);

      results.push({
        startTime: slotTime,
        departureTime: formatMinutesToTime(plannedDepartureMinutes),
        arrivalTime: formatMinutesToTime(plannedArrivalMinutes),
        endTime: formatMinutesToTime(slotEndMinutes),
        staffId: staff.id,
        staffName: staff.name,
        distanceKm: Math.round(distanceKm * 10) / 10,
        travelMinutes,
        originDesc,
        score,
      });
    }
  }

  // Sort by earliest time and best distance score
  results.sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    return a.distanceKm - b.distanceKm;
  });

  // Pick up to 6 distinct recommendations across available therapists
  const topRecs: SlotRecommendation[] = [];
  const seenStaffSlots = new Set<string>();
  for (const r of results) {
    const key = `${r.startTime}-${r.staffId}`;
    if (!seenStaffSlots.has(key) && topRecs.length < 6) {
      seenStaffSlots.add(key);
      topRecs.push(r);
    }
  }

  return topRecs;
}
