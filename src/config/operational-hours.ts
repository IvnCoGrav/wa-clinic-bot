import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

/**
 * Jam operasional klinis per-tenant (data-driven dari ClinicPolicy topik
 * 'operational_hours_and_booking'), dengan fallback default terdokumentasi.
 *
 * PENTING (keputusan produk): jam operasional TIDAK mengikat. Booking di luar
 * jam TETAP diizinkan asalkan ada bidan yang menyanggupi — fungsi ini HANYA
 * menandai `isOutsideHours` agar sistem memberi ekspektasi + badge dashboard,
 * BUKAN menolak reservasi.
 */
export interface OperationalHours {
  startHourWib: number;
  endHourWib: number;
  isFlexible: true;
}

const DEFAULT_OPERATIONAL_HOURS: OperationalHours = {
  startHourWib: 8,
  endHourWib: 17,
  isFlexible: true,
};

const hoursCache = new Map<string, { hours: OperationalHours; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Ambil jam operasional (WIB) per-tenant. Prioritas:
 * 1. Cache in-memory
 * 2. `Tenant.settings.operationalHours` ({ startHourWib, endHourWib })
 * 3. ClinicPolicy topik 'operational_hours_and_booking' (ekstraksi jam dari teks)
 * 4. Default 08:00–17:00 WIB
 */
export async function getOperationalHours(tenantId: string = DEFAULT_TENANT_ID): Promise<OperationalHours> {
  const cached = hoursCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.hours;

  let resolved: OperationalHours = { ...DEFAULT_OPERATIONAL_HOURS };

  try {
    const tenant = await (prisma as any).tenant?.findUnique?.({
      where: { id: tenantId },
      select: { settings: true },
    });
    const override = (tenant?.settings as any)?.operationalHours;
    if (override && typeof override === 'object') {
      const s = Number(override.startHourWib);
      const e = Number(override.endHourWib);
      if (Number.isInteger(s) && s >= 0 && s <= 23 && Number.isInteger(e) && e >= 0 && e <= 23 && s < e) {
        resolved = { startHourWib: s, endHourWib: e, isFlexible: true };
        hoursCache.set(tenantId, { hours: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
        return resolved;
      }
    }

    const policy = await (prisma as any).clinicPolicy?.findUnique?.({
      where: { tenant_id_topic: { tenant_id: tenantId, topic: 'operational_hours_and_booking' } },
      select: { factual_summary: true, is_active: true },
    });
    if (policy?.is_active && policy?.factual_summary) {
      const match = String(policy.factual_summary).match(/(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})/);
      if (match) {
        const s = parseInt(match[1], 10);
        const e = parseInt(match[3], 10);
        if (!isNaN(s) && !isNaN(e) && s >= 0 && s <= 23 && e >= 0 && e <= 23 && s < e) {
          resolved = { startHourWib: s, endHourWib: e, isFlexible: true };
        }
      }
    }
  } catch {
    // DB offline → default terdokumentasi.
  }

  hoursCache.set(tenantId, { hours: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
  return resolved;
}

/** Jam (0–23) pada zona WIB untuk sebuah Date. */
export function getWibHour(date: Date): number {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return wib.getUTCHours();
}

/**
 * True bila `bookingDate` (UTC Date) berada di LUAR jam operasional WIB.
 * Klinis: menandai, bukan menolak (jam fleksibel).
 */
export function isOutsideOperationalHours(bookingDate: Date | null | undefined, hours: OperationalHours): boolean {
  if (!bookingDate || isNaN(bookingDate.getTime())) return false;
  const h = getWibHour(bookingDate);
  return h < hours.startHourWib || h >= hours.endHourWib;
}

/** Hapus cache (mis. setelah admin mengubah pengaturan jam). */
export function clearOperationalHoursCache(tenantId?: string): void {
  if (tenantId) hoursCache.delete(tenantId);
  else hoursCache.clear();
}
