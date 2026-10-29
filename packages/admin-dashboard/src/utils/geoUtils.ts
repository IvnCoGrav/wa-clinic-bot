/**
 * geoUtils.ts
 * Utilitas lokasi, parsing tautan Google Maps, Geolocation, dan pemetaan navigasi.
 */

export interface ParsedCoordinates {
  lat: number;
  lng: number;
}

/**
 * Mengekstrak koordinat Latitude & Longitude dari berbagai format tautan Google Maps / teks shareloc.
 * Mendukung format:
 * - https://maps.google.com/?q=-7.348812,112.751623
 * - https://www.google.com/maps/@-7.348812,112.751623,17z
 * - https://www.google.com/maps/place/.../@-7.348812,112.751623,17z
 * - https://www.google.com/maps/search/?api=1&query=-7.348812,112.751623
 * - Format teks koordinat mentah: "-7.348812, 112.751623" atau "-7.348812 112.751623"
 */
export function extractLatLngFromMapsUrl(input: string): ParsedCoordinates | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  // 1. Cek format koordinat mentah: "-7.348812, 112.751623" atau "-7.348812,112.751623"
  const rawCoordsMatch = trimmed.match(/^(-?\d{1,3}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)$/);
  if (rawCoordsMatch) {
    const lat = parseFloat(rawCoordsMatch[1]);
    const lng = parseFloat(rawCoordsMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  // 2. Cek query parameter ?q=lat,lng atau ?query=lat,lng atau ?ll=lat,lng
  const queryMatch = trimmed.match(/[?&](?:q|query|ll|daddr)=(-?\d{1,3}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)/i);
  if (queryMatch) {
    const lat = parseFloat(queryMatch[1]);
    const lng = parseFloat(queryMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  // 3. Cek format path URL Google Maps: /@-7.348812,112.751623
  const atMatch = trimmed.match(/@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if (atMatch) {
    const lat = parseFloat(atMatch[1]);
    const lng = parseFloat(atMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  // 4. Cek format /place/.../data=...!3d-7.348812!4d112.751623
  const protoMatch = trimmed.match(/!3d(-?\d{1,3}(?:\.\d+)?)(?:.*?)!4d(-?\d{1,3}(?:\.\d+)?)/);
  if (protoMatch) {
    const lat = parseFloat(protoMatch[1]);
    const lng = parseFloat(protoMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  // 5. Cek regex umum koordinat di dalam URL apapun
  const generalMatch = trimmed.match(/(-?\d{1,2}\.\d{4,9})[,\s]+(1\d{2}\.\d{4,9})/);
  if (generalMatch) {
    const lat = parseFloat(generalMatch[1]);
    const lng = parseFloat(generalMatch[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  return null;
}

function isValidLatLng(lat: number, lng: number): boolean {
  return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Jarak Haversine dalam kilometer (1 desimal) — single source untuk dashboard.
 * Konsolidasi dari duplikat lokal di CreateReservationModal (Anti-Spaghetti).
 */
export function calculateHaversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

/**
 * Estimasi waktu tempuh bidan (motor) berdasarkan jarak garis lurus (Haversine).
 * Kalibrasi seragam dengan rekomendasi slot (CreateReservationModal) dan backend:
 * 2.05 menit/km + 3 menit buffer, minimum 5 menit.
 */
export function estimateTravelMinutesKm(distanceKm: number): number {
  return Math.max(5, Math.round(distanceKm * 2.05 + 3));
}

/**
 * Batas jendela pengiriman info OTW:
 * H-120 menit (2 jam sebelum jadwal) s/d toleransi H+15 menit setelah jadwal.
 * Diselaraskan identik dengan validasi backend (today.subroute.ts).
 */
export const OTW_OPEN_MINUTES_BEFORE = 120;
export const OTW_GRACE_MINUTES_AFTER = 15;

/**
 * Jendela pre-warm GPS (60 menit sebelum jadwal s/d 120 menit setelah jadwal).
 * Memanaskan cache lokasi perangkat bidan secara senyap sebelum keberangkatan.
 */
export const GPS_WARMUP_MINUTES = 60;

export type OtwGateReason = 'ok' | 'too_early' | 'expired' | 'invalid';

/**
 * Evaluasi gerbang waktu pengiriman pesan OTW secara deterministik.
 * Membandingkan milidetik mentah (bukan Math.round) agar boundary identik dengan backend.
 */
export function getOtwGate(
  bookingDateIso: string | Date | null | undefined,
  nowMs: number = Date.now()
): { allowed: boolean; reason: OtwGateReason; minutesUntil: number | null } {
  const t = bookingDateIso ? new Date(bookingDateIso).getTime() : NaN;
  if (!Number.isFinite(t)) return { allowed: false, reason: 'invalid', minutesUntil: null };
  const diffMs = t - nowMs;
  const minutesUntil = Math.round(diffMs / 60000);
  if (diffMs > OTW_OPEN_MINUTES_BEFORE * 60000) return { allowed: false, reason: 'too_early', minutesUntil };
  if (diffMs < -OTW_GRACE_MINUTES_AFTER * 60000) return { allowed: false, reason: 'expired', minutesUntil };
  return { allowed: true, reason: 'ok', minutesUntil };
}

/**
 * Menit menuju jadwal booking (bisa negatif bila sudah lewat). Murni.
 * @returns selisih menit (dibulatkan); null bila tanggal tidak valid.
 */
export function minutesUntilBooking(bookingDateIso: string | Date | null | undefined, nowMs: number = Date.now()): number | null {
  if (!bookingDateIso) return null;
  const t = new Date(bookingDateIso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((t - nowMs) / 60000);
}

/**
 * True bila booking berada dalam jendela pre-warm GPS (<= GPS_WARMUP_MINUTES
 * ke depan, s/d 120 menit lewat). Murni (tanpa I/O) agar mudah diuji.
 */
export function isWithinGpsWarmupWindow(
  bookingDateIso: string | Date | null | undefined,
  nowMs: number = Date.now(),
  windowMinutes: number = GPS_WARMUP_MINUTES
): boolean {
  const mins = minutesUntilBooking(bookingDateIso, nowMs);
  if (mins == null) return false;
  return mins <= windowMinutes && mins >= -120;
}

/**
 * Format jam WIB "HH:MM" dari sebuah instant + offset menit (untuk estimasi tiba).
 */
export function formatWibClock(date?: Date | null, addMinutes = 0): string {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '00:00';
  const wib = new Date(date.getTime() + addMinutes * 60000 + 7 * 3600000);
  return `${String(wib.getUTCHours()).padStart(2, '0')}:${String(wib.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * Cek apakah gap waktu antar kunjungan cukup untuk waktu tempuh.
 * Mengembalikan null jika koordinat tidak lengkap (tidak bisa hitung).
 * Mengembalikan object { sufficient: boolean, requiredMinutes: number, availableMinutes: number, distanceKm: number } jika bisa dihitung.
 */
export function checkTravelTimeSufficiency(
  fromLat: number | null | undefined,
  fromLng: number | null | undefined,
  toLat: number | null | undefined,
  toLng: number | null | undefined,
  availableGapMinutes: number
): { sufficient: boolean; requiredMinutes: number; availableMinutes: number; distanceKm: number } | null {
  if (fromLat == null || fromLng == null || toLat == null || toLng == null) {
    return null;
  }
  const distanceKm = calculateHaversineKm(fromLat, fromLng, toLat, toLng);
  const requiredMinutes = estimateTravelMinutesKm(distanceKm);
  return {
    sufficient: availableGapMinutes >= requiredMinutes,
    requiredMinutes,
    availableMinutes: availableGapMinutes,
    distanceKm,
  };
}

export type LocationSourceKind = 'gps_pin' | 'estimated_area' | 'manual_staff';

/**
 * Memetakan berbagai bentuk format lokasi (string, preferences, customer)
 * menjadi kategori kanonikal: 'manual_staff' | 'gps_pin' | 'estimated_area' | null.
 * Single source of truth di dashboard selaras dengan backend `resolveLocationSource`.
 */
export function resolveEffectiveLocationSource(
  input?: string | {
    location_source?: string | null;
    effective_location_source?: string | null;
    source?: string | null;
    preferences?: {
      location_source?: string | null;
      source?: string | null;
      [key: string]: any;
    } | null;
    [key: string]: any;
  } | null
): LocationSourceKind | null {
  if (!input) return null;

  if (typeof input === 'string') {
    const raw = input.trim();
    if (raw === 'manual_staff' || raw === 'FIELD_STAFF_GPS') return 'manual_staff';
    if (raw === 'gps_pin' || raw === 'bidan_shareloc' || raw === 'customer_shareloc' || raw === 'url_coords') return 'gps_pin';
    if (raw === 'estimated_area' || raw === 'geocoding' || raw === 'url_text_geocoded' || raw === 'gazetteer' || raw === 'db_coords') return 'estimated_area';
    return null;
  }

  if (input.effective_location_source) {
    return resolveEffectiveLocationSource(input.effective_location_source);
  }

  const col = input.location_source;
  if (col === 'manual_staff' || col === 'gps_pin' || col === 'estimated_area') {
    return col;
  }

  const pref = input.preferences?.location_source || input.preferences?.source || input.source;
  if (pref) {
    return resolveEffectiveLocationSource(pref);
  }

  return null;
}

export function isPreciseLocationSource(source?: string | null): boolean {
  return source === 'gps_pin';
}

export interface LocationBadgeConfig {
  source: LocationSourceKind | null;
  label: string;
  badgeClass: string;
  dotColor: string;
}

/**
 * Single source of truth pemetaan badge lokasi untuk seluruh dashboard
 * (LiveChat, CustomerDatabase, StaffToday, MapTab).
 */
export function getLocationBadgeConfig(
  customerOrSource?: any,
  explicitLabel?: string | null
): LocationBadgeConfig {
  const source = resolveEffectiveLocationSource(customerOrSource);
  const rawPref = typeof customerOrSource === 'object' && customerOrSource !== null
    ? (customerOrSource.preferences?.location_source || customerOrSource.preferences?.source || customerOrSource.source)
    : null;

  if (source === 'manual_staff') {
    return {
      source: 'manual_staff',
      label: explicitLabel || '📍 Terverifikasi Staf',
      badgeClass: 'bg-success-soft text-success border-success-line',
      dotColor: 'rgb(var(--c-accent))',
    };
  }

  if (source === 'gps_pin') {
    const isCustomerShareloc = rawPref === 'customer_shareloc';
    return {
      source: 'gps_pin',
      label: explicitLabel || (isCustomerShareloc ? '🔵 Shareloc Customer' : '📍 Titik Presisi'),
      badgeClass: isCustomerShareloc
        ? 'bg-info-soft text-info border-info-line'
        : 'bg-bubble-out text-accent border-accent/30',
      dotColor: isCustomerShareloc ? 'rgb(var(--c-info))' : 'rgb(var(--c-accent))',
    };
  }

  if (source === 'estimated_area') {
    const isDbCoords = rawPref === 'db_coords';
    return {
      source: 'estimated_area',
      // REVISI-1 Tahap 4.1: label jujur — titik DB bukan pin GPS rumah.
      label: explicitLabel || (isDbCoords ? '🟡 Estimasi (Titik DB)' : '⚪ Estimasi Wilayah'),
      badgeClass: isDbCoords
        ? 'bg-warning-soft text-warning border-warning-line'
        : 'bg-surface-2 text-ink border-divider',
      dotColor: isDbCoords ? 'rgb(var(--c-warning))' : 'rgb(var(--c-ink-2))',
    };
  }

  return {
    source: null,
    label: explicitLabel || '⚪ Estimasi Wilayah',
    badgeClass: 'bg-surface-2 text-ink border-divider',
    dotColor: 'rgb(var(--c-ink-2))',
  };
}

/**
 * Insiden Bidan tersasar (2026-09-30): titik NON-presisi (`manual_staff`/
 * `estimated_area`/belum diketahui) DILARANG membuka Google Maps langsung —
 * WAJIB lewat gerbang konfirmasi pra-navigasi. Hanya `gps_pin` yang presisi.
 * Murni & deterministik (berbasis state provenance, bukan tebakan teks).
 */
export function needsNavigationPreflight(source?: string | null): boolean {
  return source !== 'gps_pin';
}

/**
 * Menghasilkan URL navigasi Google Maps yang selalu valid dengan fallback berjenjang.
 *
 * `locationSource` (opsional): bila titik NON-presisi (`manual_staff`/
 * `estimated_area`) DAN ada `fallbackText` (alamat lengkap), `destination`
 * memakai TEKS alamat agar Google Maps memandu ke klaster/blok perumahan —
/**
 * Memeriksa apakah teks alamat merupakan alamat jalan/perumahan spesifik
 * (memuat nomor, blok, jalan, dsb) dan bukan sekadar nama kelurahan/kecamatan umum.
 */
export function isSpecificStreetAddress(text?: string | null): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < 5) return false;
  // Satu kata tanpa angka (misal "Bohar", "Taman") -> nama wilayah umum, bukan alamat jalan
  if (!trimmed.includes(' ') && !/\d/.test(trimmed)) return false;
  // Memuat penanda jalan / perumahan / kluster / blok
  if (/\b(?:jl|jalan|gang|gg|blok|no|nomor|rt|rw|perum|perumahan|komplek|cluster|tower|dusun|kavling|kav)\b/i.test(trimmed)) {
    return true;
  }
  // Memuat angka (nomor rumah, RT/RW, blok)
  if (/\d/.test(trimmed)) return true;
  // Teks majemuk dengan detail (minimal 4 kata)
  const parts = trimmed.split(/[,;\s]+/).filter(Boolean);
  return parts.length >= 4;
}

/**
 * Link navigasi Google Maps motor (two-wheeler).
 * - gps_pin: SELALU memakai koordinat lat,lng presisi.
 * - manual_staff/estimated_area: HANYA memakai teks alamat bila teks merupakan alamat
 *   jalan/perumahan spesifik (isSpecificStreetAddress). Teks nama desa/kelurahan umum
 *   (seperti "Bohar") TIDAK BOLEH membuang koordinat lat,lng.
 */
export function getGoogleMapsDirectionUrl(
  lat?: number | null,
  lng?: number | null,
  fallbackText?: string | null,
  locationSource?: string | null
): string {
  const isNonPrecise = locationSource === 'manual_staff' || locationSource === 'estimated_area';
  const hasText = !!fallbackText && fallbackText.trim().length > 0;
  const hasSpecificText = hasText && isSpecificStreetAddress(fallbackText);
  if (isNonPrecise && hasSpecificText) {
    const query = new URLSearchParams({ api: '1', destination: fallbackText!.trim(), travelmode: 'two-wheeler' });
    return `https://www.google.com/maps/dir/?${query.toString()}`;
  }
  if (lat != null && lng != null && isValidLatLng(lat, lng)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=two-wheeler`;
  }
  if (hasText) {
    const query = new URLSearchParams({ api: '1', destination: fallbackText!.trim(), travelmode: 'two-wheeler' });
    return `https://www.google.com/maps/dir/?${query.toString()}`;
  }
  // Default search ke Surabaya/Sidoarjo jika kosong
  return `https://www.google.com/maps/search/?api=1&query=Sidoarjo`;
}

/**
 * Membaca posisi GPS perangkat terkini dengan akurasi tinggi dan promise.
 */
export function getCurrentDeviceLocation(timeoutMs = 10000): Promise<{ lat: number; lng: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Browser / Perangkat Anda tidak mendukung fitur GPS Geolocation.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        });
      },
      (err) => {
        let msg = 'Gagal mengakses GPS perangkat.';
        if (err.code === err.PERMISSION_DENIED) {
          msg = 'Izin akses lokasi GPS ditolak oleh browser / perangkat. Mohon izinkan akses lokasi di pengaturan browser.';
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          msg = 'Sinyal GPS tidak tersedia saat ini. Pastikan Anda berada di area terbuka.';
        } else if (err.code === err.TIMEOUT) {
          msg = 'Waktu pencarian sinyal GPS habis. Coba kunci GPS sekali lagi.';
        }
        reject(new Error(msg));
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 0,
      }
    );
  });
}

/**
 * Pre-warm GPS keberangkatan (plan 2026-10-04, Silent Depart-Capture).
 *
 * Masalah: pada klik "Navigasi", `getCurrentDeviceLocation` adalah tembakan
 * dingin (`maximumAge: 0`) yang sering time-out karena prompt izin browser
 * tertinggal di tab background setelah Bidan dilempar ke Google Maps → titik
 * awal Bidan & ETA ke pasien hilang (SLA). Solusi: panaskan cache lokasi secara
 * pasif SEBELUM tombol diklik, lalu saat klik pakai cache segar (0 dtk) atau
 * balapan one-shot pendek. Silent total: tanpa popup/toast ke Bidan; gagal →
 * `null` (fail-open, WA OTW tetap terkirim tanpa koordinat).
 *
 * Ambang operasional global (selaras `GPS_ACCURACY_MAX_M` backend &
 * `MIN_ACCURACY_M` hook telemetry). TODO(tenant-aware): kategori konstanta
 * operasional, bukan data bisnis per-tenant.
 */
export const DEPART_GPS_MAX_AGE_MS = 60_000;
export const DEPART_GPS_MAX_ACCURACY_M = 100;
export const DEPART_GPS_FAST_MS = 2000;

let departCache: { lat: number; lng: number; accuracy: number; at: number } | null = null;
let departWatchId: number | null = null;

/**
 * Mulai pemanasan cache GPS pasif (idempoten). Aman dipanggil berkali-kali;
 * hanya satu watch aktif. Browser tanpa `watchPosition` → diam (no-op).
 */
export function startDepartGpsWarmup(): void {
  if (departWatchId != null) return;
  if (typeof navigator === 'undefined' || !navigator.geolocation?.watchPosition) return;
  try {
    departWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = Math.round(pos.coords.accuracy);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(accuracy)) return;
        // Drift indoor (akurasi buruk) → jangan kotori cache.
        if (accuracy > DEPART_GPS_MAX_ACCURACY_M) return;
        departCache = { lat, lng, accuracy, at: Date.now() };
      },
      () => {
        /* silent: izin ditolak / sinyal hilang tidak mengganggu Bidan */
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 }
    );
  } catch {
    departWatchId = null;
  }
}

/** Hentikan pemanasan GPS pasif & lepas watch (privasi + baterai). */
export function stopDepartGpsWarmup(): void {
  if (departWatchId != null) {
    try {
      navigator.geolocation.clearWatch(departWatchId);
    } catch {
      /* noop */
    }
  }
  departWatchId = null;
}

/**
 * Ambil posisi keberangkatan untuk dikirim bersama OTW.
 * - Cache segar (≤ `DEPART_GPS_MAX_AGE_MS`) → langsung (0 dtk, menjaga aktivasi klik).
 * - Cache basi/kosong → balapan one-shot ≤ `fastMs` (default 2 dtk; masih dalam
 *   jendela user-activation browser sehingga pop-up Google Maps tidak diblokir).
 * - Gagal / akurasi > `DEPART_GPS_MAX_ACCURACY_M` → `null` (tidak throw, fail-open).
 */
export async function getDepartPositionFast(
  fastMs: number = DEPART_GPS_FAST_MS
): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  if (departCache && Date.now() - departCache.at <= DEPART_GPS_MAX_AGE_MS) {
    return { lat: departCache.lat, lng: departCache.lng, accuracy: departCache.accuracy };
  }
  try {
    const pos = await getCurrentDeviceLocation(fastMs);
    if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) return null;
    if (pos.accuracy > DEPART_GPS_MAX_ACCURACY_M) return null;
    departCache = { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, at: Date.now() };
    return pos;
  } catch {
    return null;
  }
}

/**
 * Geocoding gratis via OpenStreetMap Nominatim untuk mencari koordinat dari teks alamat / kelurahan.
 */
export async function geocodeAddressWithNominatim(
  query: string
): Promise<{ lat: number; lng: number; displayName: string } | null> {
  if (!query || query.trim().length < 3) return null;

  try {
    const formattedQuery = query.includes('Surabaya') || query.includes('Sidoarjo') || query.includes('Jawa Timur')
      ? query
      : `${query}, Sidoarjo, Jawa Timur, Indonesia`;

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(formattedQuery)}&limit=1`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const item = data[0];
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lon);
      if (isValidLatLng(lat, lng)) {
        return {
          lat,
          lng,
          displayName: item.display_name,
        };
      }
    }
  } catch (err) {
    console.warn('[geoUtils] Geocoding failed:', err);
  }
  return null;
}
