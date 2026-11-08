import { computeCurrentAge } from '../../utils/age-calculator';
import { addressesMatch } from '../../domain/customer-address';
import { StaffChatWindowConfig } from '../../config/staff-chat-window-config';
import {
  StaffTaskChild,
  StaffTaskPricing,
  SelectableChild,
  ChatWindowStatus,
} from './types';

/**
 * Fase 1.1: Sumber anak untuk kartu tugas terapis.
 *
 * `r.children` (relasi via `reservation_id`) = anak yang BENAR-BENAR didaftarkan
 * pada reservasi ini → sumber kebenaran. `cust.children` = SEMUA anak pada profil
 * customer → dipakai HANYA sebagai fallback untuk reservasi lama yang belum
 * mengaitkan anak (relasi reservasi kosong). Tanpa gating ini, kartu 1 booking
 * menampilkan seluruh anak customer (mis. Budi 2th & Ani 6bln padahal booking Ani).
 *
 * Dedupe dinormalkan (trim + collapse spasi + lowercase) karena nama sama bisa
 * datang dari dua relasi; anak kembar bernama identik tetap digabung sesuai
 * constraint DB `@@unique([customer_id, name])`.
 */
export function selectTaskChildren(
  reservationChildren: SelectableChild[] | null | undefined,
  customerChildren: SelectableChild[] | null | undefined
): StaffTaskChild[] {
  const reservationList = (reservationChildren || []).filter((c) => !!c?.name);
  const source = reservationList.length > 0 ? reservationList : customerChildren || [];

  const map = new Map<string, StaffTaskChild>();
  for (const ch of source) {
    const name = String(ch?.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase().replace(/\s+/g, ' ');
    if (map.has(key)) continue;
    const bd = ch?.birth_date;
    const birthDate = bd ? (bd instanceof Date ? bd.toISOString() : new Date(bd).toISOString()) : null;
    map.set(key, {
      name,
      rawAgeText: ch?.raw_age_text || null,
      birthDate,
      currentAge: computeCurrentAge({
        birthDate: bd ? (bd instanceof Date ? bd : new Date(bd)) : null,
        ageMonthsAtRegistration: ch?.age_months_at_registration ?? null,
        registeredAt: (ch as any)?.created_at ?? null,
        rawAgeText: ch?.raw_age_text || null,
      }),
    });
  }
  return Array.from(map.values());
}

/**
 * Apakah nilai kolom `kelurahan` sebenarnya bukan nama kelurahan, melainkan
 * detail alamat jalan/perumahan (data lama sempat tercemar). Bila demikian,
 * JANGAN diberi prefix "Kel." (menyesatkan terapis: "Kel. Jalan ...").
 */
export function looksLikeStreetAddress(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if (/^(?:jalan|jl\.?|gang|gg\.?|komplek|perum|dusun|desa|blok|rt\.?|rw\.?)\b/.test(v)) return true;
  // Nomor rumah/blok ("... No 12", "... 12B") → kemungkinan alamat, bukan kelurahan.
  return /\bno\.?\s*\d+|\b\d+\s*[a-z]?\b/.test(v);
}

/**
 * Fase 165d: sumber TUNGGAL URL peta kartu tugas (dulu diduplikasi di
 * getTodayTasks / getUpcomingSchedule / getCompletedTasks dengan format
 * "maps.google.com/?q=" vs "maps/search/?api=1&query=" yang divergen).
 *
 * Insiden Bidan tersasar (2026-09-30): untuk titik NON-presisi
 * (`manual_staff`/`estimated_area`), koordinat hanya menunjuk area umum
 * perumahan → Google Maps memandu ke gang/blok salah. Bila ada teks alamat
 * lengkap, `navigationUrl` memakai TEKS alamat sebagai `destination` (Google
 * Maps memandu ke klaster/blok). Titik `gps_pin` dan pemanggil lama tanpa
 * `locationSource` tetap byte-identik dengan perilaku semula.
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

export function buildMapsUrls(
  lat?: number | null,
  lng?: number | null,
  locationSource?: string | null,
  fullAddress?: string | null
): { mapsUrl: string | null; navigationUrl: string | null } {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { mapsUrl: null, navigationUrl: null };
  }
  const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
  const useAddressText =
    (locationSource === 'manual_staff' || locationSource === 'estimated_area') &&
    typeof fullAddress === 'string' &&
    isSpecificStreetAddress(fullAddress);
  if (useAddressText) {
    // Bangun via URLSearchParams (anti-template rapuh + encoding aman).
    const query = new URLSearchParams({ api: '1', destination: fullAddress!.trim(), travelmode: 'two-wheeler' });
    return { mapsUrl, navigationUrl: `https://www.google.com/maps/dir/?${query.toString()}` };
  }
  return {
    mapsUrl,
    navigationUrl: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=two-wheeler`,
  };
}

export function buildAddressText(c: {
  address?: string | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
  preferences?: any;
}): string {
  const pref = (c.preferences as any) || {};
  const addressDetail = String((c as any).address || pref.address || pref.full_address || '').trim();
  const parts: string[] = [];
  if (addressDetail) parts.push(addressDetail);
  const kel = (c.kelurahan || '').trim();
  if (kel && !addressDetail.toLowerCase().includes(kel.toLowerCase())) {
    // Guard data-cemar: nilai kelurahan berbentuk nama jalan/nomor rumah tidak
    // diberi prefix "Kel." agar tidak menyesatkan (mis. "Kel. Jalan Melati No 5").
    parts.push(looksLikeStreetAddress(kel) ? kel : `Kel. ${kel}`);
  }
  if (c.kecamatan) parts.push(`Kec. ${c.kecamatan}`);
  if (c.kota) parts.push(c.kota);
  return parts.join(', ') || 'Alamat belum tercatat lengkap';
}

/**
 * REVISI-1 Tahap 2.2: konstruktor TUNGGAL alamat efektif kartu tugas.
 * Dipakai getTodayTasks / getUpcomingSchedule / getCompletedTasks (dulu tiga
 * salinan inline yang divergen).
 *
 * Bug yang diperbaiki ("penghapusan diam-diam"): `preferences.address` ditimpa
 * `addr.address` mentah — bila entri alamat reservasi kosong, teks jalan yang
 * tersimpan di profil customer terhapus. Kini jatuh-bertingkat (baris reservasi
 * → preferences → kolom customers) + trim, berlaku untuk `address` maupun
 * turunan preferences-nya. Geometri (lat/lng/distance) tetap milik baris
 * reservasi; label sumber ditangani FIX 2026-10-11 di bawah.
 */
export function buildEffectiveTaskAddress(addr: any, cust: any): any {
  if (!addr) return cust;
  const prefs = (cust?.preferences as any) || {};
  const fallbackAddress = String(
    (addr as any)?.address || prefs.address || (cust as any)?.address || ''
  ).trim();

  // RC-3 (Fase 4): bila `addr` (kartu reservasi) & PROFIL customer merujuk rumah
  // yang SAMA (`addressesMatch`) DAN koreksi profil lebih baru
  // (preferences.location_updated_at > addr.last_used_at/created_at) → pakai
  // teks+koordinat profil (koreksi terbaru). Rumah BEDA → tetap `addr` (alamat
  // yang disepakati booking). Tanpa timestamp → perilaku lama byte-identik.
  let useProfile = false;
  try {
    const sameHouse = addressesMatch(
      { address: addr?.address, kelurahan: addr?.kelurahan, kecamatan: addr?.kecamatan, kota: addr?.kota, lat: addr?.lat, lng: addr?.lng },
      { address: prefs.address, kelurahan: cust?.kelurahan, kecamatan: cust?.kecamatan, kota: cust?.kota, lat: cust?.lat, lng: cust?.lng }
    );
    const profTs = prefs.location_updated_at ? Date.parse(prefs.location_updated_at) : NaN;
    const addrTs = Date.parse((addr as any)?.last_used_at || (addr as any)?.created_at || '');
    if (sameHouse && Number.isFinite(profTs) && Number.isFinite(addrTs) && profTs > addrTs) {
      useProfile = true;
    }
  } catch { /* pure predicate; abaikan bila bentuk tak terduga */ }

  const chosenAddress = useProfile && prefs.address ? String(prefs.address).trim() : fallbackAddress;
  // Provenance transparansi (R2): dari mana email alamat tugas berasal — `card`
  // (kartu buku alamat saat booking) atau `profile` (koreksi profil lebih baru).
  // Timestamp = waktu terakhir sumber terpilih diperbarui.
  const addressSource = useProfile ? 'profile' : 'card';
  const addressUpdatedAt = (useProfile ? prefs.location_updated_at : (addr as any)?.last_used_at || (addr as any)?.created_at) ?? null;
  return {
    address: chosenAddress,
    kelurahan: useProfile ? (cust?.kelurahan ?? addr.kelurahan) : addr.kelurahan,
    kecamatan: useProfile ? (cust?.kecamatan ?? addr.kecamatan) : addr.kecamatan,
    kota: useProfile ? (cust?.kota ?? addr.kota) : addr.kota,
    lat: useProfile ? (cust?.lat ?? addr.lat) : addr.lat,
    lng: useProfile ? (cust?.lng ?? addr.lng) : addr.lng,
    distance_km: useProfile ? (cust?.distance_km ?? addr.distance_km) : addr.distance_km,
    ongkir: useProfile ? (cust?.ongkir ?? addr.ongkir) : addr.ongkir,
    landmark: addr.landmark,
    location_source: useProfile ? (cust?.location_source ?? addr.location_source) : addr.location_source,
    address_source: addressSource,
    address_updated_at: addressUpdatedAt,
    preferences: {
      ...prefs,
      address: chosenAddress,
      landmark: addr.landmark || prefs.landmark,
    },
  };
}

/**
 * Derivasi TUNGGAL sumber akurasi koordinat untuk kartu terapis (server-driven).
 */
export const STAFF_VERIFIED_LOCATION_LABEL = '📍 Terverifikasi Staf';

/**
 * Resolver sumber lokasi tunggal (Single Source of Truth).
 * Urutan (deterministik, berbasis state — bukan tebakan teks):
 *   1. Kolom `location_source` (kanonis).
 *   2. `preferences.location_source`/`preferences.source` (provenance jalur
 *      enrich/refresh) → dinormalkan ke makna yang sama.
 *   3. Penanda edit staf → manual_staff.
 *   4. `share_location_sent` + koordinat valid → gps_pin (data lama).
 *   5. Tidak diketahui → null (netral: DILARANG menampilkan badge "presisi"
 *      palsu; lebih baik tanpa badge daripada menyesatkan terapis).
 */
export function resolveLocationSource(
  c: any
): 'gps_pin' | 'estimated_area' | 'manual_staff' | null {
  if (!c) return null;
  const col = c.location_source;
  if (col === 'gps_pin' || col === 'estimated_area' || col === 'manual_staff') return col;

  const pref = (c.preferences as any) || {};
  const src = pref.location_source || pref.source;
  if (src === 'bidan_shareloc' || src === 'customer_shareloc' || src === 'url_coords') return 'gps_pin';
  if (src === 'geocoding' || src === 'url_text_geocoded' || src === 'gazetteer') return 'estimated_area';
  if (src === 'manual_staff' || src === 'FIELD_STAFF_GPS') return 'manual_staff';

  if (pref.location_updated_by_staff_name || pref.location_updated_by_staff_id || pref.field_gps_lat) {
    return 'manual_staff';
  }
  if (c.share_location_sent === true && c.lat != null && c.lng != null) return 'gps_pin';
  return null;
}

/**
 * Menghitung estimasi durasi tempuh perjalanan sepeda motor (dalam menit).
 * Dikalibrasi dari benchmark rute nyata Google Maps: ~2.05 menit/km + buffer lampu merah/gang 2 menit.
 */
export function estimateTravelDurationMinutes(distanceKm: number | null): number | null {
  if (distanceKm == null || distanceKm <= 0) return null;
  return Math.max(3, Math.round(distanceKm * 2.05 + 2));
}

export function buildShareText(
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

export const HOUR_MS = 60 * 60 * 1000;

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

  const config = options.config || { openHoursBefore: 3, closeHoursAfter: 1 };

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
