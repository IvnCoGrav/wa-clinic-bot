import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getOperationalHours } from '../config/operational-hours';
import { wibMonthBoundsUtc, shiftWibMonth } from '../utils/wib-time';
import { resolveReservationBilling, type CatalogPriceCache } from './reservation-billing.service';
import { responseCacheService } from './response-cache.service';
import {
  buildTreatmentHeatmap,
  type HeatmapReservationInput,
  type HeatmapScope,
  type TreatmentHeatmapResponse,
} from '../domain/treatment-heatmap';

const CACHE_TTL_SECONDS = 30;
const VALID_SCOPES: HeatmapScope[] = ['weekly', 'monthly', 'multi'];

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

/**
 * Service Treatment Heatmap — satu query agregasi per-request.
 *
 * Definisi metrik (disepakati): warna sel = jumlah reservasi berstatus
 * `completed`; reservasi mendatang/batal TIDAK dihitung. Omzet memakai seam
 * kanonis `resolveReservationBilling` (purchase_value + ongkir).
 */
export class TreatmentHeatmapService {
  static async getHeatmap(
    tenantId: string = DEFAULT_TENANT_ID,
    year?: number,
    month?: number,
    scope: HeatmapScope = 'weekly',
    monthCount = 3
  ): Promise<TreatmentHeatmapResponse> {
    const nowWib = new Date(Date.now() + 7 * 3600 * 1000);
    const resolvedYear = Number.isInteger(Number(year)) ? Number(year) : nowWib.getUTCFullYear();
    const resolvedMonth = Number.isInteger(Number(month)) ? Number(month) : nowWib.getUTCMonth() + 1;
    const resolvedScope: HeatmapScope = VALID_SCOPES.includes(scope) ? scope : 'weekly';
    const requestedMonths = Number(monthCount);
    const resolvedCount = Math.min(
      12,
      Math.max(1, Math.floor(Number.isFinite(requestedMonths) ? requestedMonths : 3))
    );

    const selectedBounds = wibMonthBoundsUtc(resolvedYear, resolvedMonth);
    if (!selectedBounds) badRequest(`Periode tidak valid: ${resolvedYear}-${resolvedMonth}`);
    if (!VALID_SCOPES.includes(scope)) badRequest(`Scope tidak valid: ${scope}`);

    const cacheKey = `analytics:heatmap:${tenantId}:${resolvedYear}:${resolvedMonth}:${resolvedScope}:${resolvedCount}`;
    const cached = responseCacheService.get<TreatmentHeatmapResponse>(cacheKey);
    if (cached) return cached;

    const { start, end } =
      resolvedScope === 'multi'
        ? (() => {
            const first = shiftWibMonth(resolvedYear, resolvedMonth, -(resolvedCount - 1));
            const firstBounds = wibMonthBoundsUtc(first.year, first.month) as { start: Date };
            return { start: firstBounds.start, end: selectedBounds!.end };
          })()
        : { start: selectedBounds!.start, end: selectedBounds!.end };

    let rows: any[] = [];
    let excludedNonCompleted = 0;
    try {
      rows = await prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          status: 'completed',
          booking_date: { gte: start, lte: end },
        },
        select: {
          id: true,
          booking_date: true,
          status: true,
          purchase_value: true,
          delivery_fee: true,
          treatment_detail: true,
          customer: { select: { ongkir: true } },
          items: { select: { price: true } },
        },
        orderBy: { booking_date: 'asc' },
      });
    } catch (err) {
      console.warn('[TREATMENT-HEATMAP] DB fetch fallback:', err);
      rows = [];
    }

    try {
      excludedNonCompleted = await prisma.reservation.count({
        where: {
          tenant_id: tenantId,
          status: { not: 'completed' },
          booking_date: { gte: start, lte: end },
        },
      });
    } catch {
      excludedNonCompleted = 0;
    }

    const hours = await getOperationalHours(tenantId);
    const catalogCache: CatalogPriceCache = new Map();
    const reservations: HeatmapReservationInput[] = [];
    for (const row of rows) {
      const billing = await resolveReservationBilling(row, tenantId, catalogCache);
      reservations.push({
        id: row.id,
        bookingDate: row.booking_date || null,
        status: row.status,
        revenue: billing.totalFee,
        itemCount: billing.itemCount,
      });
    }

    const result = buildTreatmentHeatmap({
      year: resolvedYear,
      month: resolvedMonth,
      scope: resolvedScope,
      monthCount: resolvedCount,
      hours: { startHourWib: hours.startHourWib, endHourWib: hours.endHourWib },
      reservations,
      excludedNonCompleted,
    });

    responseCacheService.set(cacheKey, result, CACHE_TTL_SECONDS);
    return result;
  }
}
