import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client';
import { customerService } from '../../services/customer.service';
import { auditService } from '../../services/audit.service';
import { tenantOf } from './route-helpers';
import { normalizePhoneID } from '../../utils/phone-normalizer';
import { getClinicLocationAsync } from '../../config/clinic-location';

export async function customersExportRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/customers/stats
   * Phase 3: Stats terpisah — cached 60s, tidak memblok list query.
   */
  fastify.get('/api/admin/customers/stats', async (request, reply) => {
    try {
      const tenantId = tenantOf(request);
      const stats = await customerService.getCustomerStats(tenantId);
      return reply
        .header('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
        .status(200)
        .send({ success: true, stats });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/admin/customers/audience-export
   * Unduh daftar nomor pasien (format internasional 62..., tanpa 0/+) untuk
   * Custom Audience Meta. Nomor WA klinik sering tidak cocok dengan akun FB/IG
   * pasien, sehingga upload daftar ini adalah lapis exclusion kedua di Ads Manager.
   */
  fastify.get(
    '/api/admin/customers/audience-export',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
          keyGenerator: (req) => `${req.ip}|${(req as any).tenantId || 'no-tenant'}`,
        },
      },
    },
    async (request, reply) => {
      const staffRole = (request as any).staffRole;
      if (staffRole && staffRole !== 'SUPER_ADMIN') {
        return reply.status(403).send({
          success: false,
          error: 'Export audience hanya tersedia untuk Super Admin.',
          code: 'FORBIDDEN_STAFF_ROLE',
        });
      }

      try {
        const tenantId = tenantOf(request);
        const rows = await prisma.customer.findMany({
          where: {
            tenant_id: tenantId,
            deleted_at: null,
            is_sandbox_test: false,
            is_internal_staff: false,
          },
          select: { phone: true },
          orderBy: { created_at: 'desc' },
        });

        const phones = Array.from(
          new Set(
            rows
              .map((row) => normalizePhoneID(row.phone))
              .filter((phone) => /^62\d{8,15}$/.test(phone))
          )
        );

        const csv = ['phone', ...phones].join('\n');
        const stamp = new Date().toISOString().slice(0, 10);
        const exportedAt = new Date().toISOString();

        try {
          const tenantRow = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
          });
          const mergedSettings: any = {
            ...(((tenantRow as any)?.settings as any) || {}),
            metaAudienceLastExportAt: exportedAt,
            metaAudienceLastExportCount: phones.length,
          };
          await prisma.tenant.update({
            where: { id: tenantId },
            data: { settings: mergedSettings },
          });
        } catch (persistErr: any) {
          console.warn(`[AUDIENCE EXPORT] Gagal persist metaAudienceLastExportAt: ${persistErr?.message}`);
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'CUSTOMER_AUDIENCE_EXPORT',
          targetId: tenantId,
          payload: { rowCount: phones.length, tenantId },
          ipAddress: request.ip,
          tenantId,
        });

        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="meta-audience-${tenantId}-${stamp}.csv"`)
          .header('Cache-Control', 'no-store')
          .header('X-Total-Rows', String(phones.length))
          .status(200)
          .send(csv);
      } catch (err: any) {
        return reply.status(500).send({
          success: false,
          error: err.message || 'Gagal mengekspor audience Meta.',
        });
      }
    }
  );

  /**
   * GET /api/admin/customers/audience-export/meta
   * Metadata kapan terakhir audience Meta diexport (untuk UI).
   */
  fastify.get('/api/admin/customers/audience-export/meta', async (request, reply) => {
    try {
      const tenantId = tenantOf(request);
      const tenantRow = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { settings: true },
      });
      const settings: any = (tenantRow as any)?.settings || {};
      return reply.status(200).send({
        success: true,
        data: {
          lastExportAt: settings.metaAudienceLastExportAt ?? null,
          lastExportCount:
            typeof settings.metaAudienceLastExportCount === 'number'
              ? settings.metaAudienceLastExportCount
              : null,
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/admin/customers/map-points
   */
  const SURABAYA_RAYA_BBOX = { minLat: -7.90, maxLat: -6.75, minLng: 112.10, maxLng: 113.15 };
  const AREA_KEYWORDS = ['surabaya', 'sidoarjo', 'gresik', 'sby', 'sda'];

  const isWithinServiceArea = (c: any): boolean => {
    const areaText = `${c.kota || ''} ${c.kecamatan || ''}`.toLowerCase();
    if (AREA_KEYWORDS.some((w) => areaText.includes(w))) return true;
    if (typeof c.distance_km === 'number' && c.distance_km <= 35) return true;
    if (typeof c.lat === 'number' && typeof c.lng === 'number') {
      return (
        c.lat >= SURABAYA_RAYA_BBOX.minLat &&
        c.lat <= SURABAYA_RAYA_BBOX.maxLat &&
        c.lng >= SURABAYA_RAYA_BBOX.minLng &&
        c.lng <= SURABAYA_RAYA_BBOX.maxLng
      );
    }
    return false;
  };

  fastify.get(
    '/api/admin/customers/map-points',
    async (
      request: FastifyRequest<{
        Querystring: { kota?: string; scope?: string; includeCentroids?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = tenantOf(request);
        const kota = request.query?.kota?.trim();
        const showAll = request.query?.scope === 'all';
        const includeCentroids = request.query?.includeCentroids !== 'false';

        const qualifiedFilter = {
          OR: [
            { is_mql: true },
            { reservations: { some: { status: { notIn: ['cancelled', 'rejected'] } } } },
          ],
        };
        const coordsRows = await prisma.customer.findMany({
          where: {
            tenant_id: tenantId,
            is_sandbox_test: false,
            lat: { not: null },
            lng: { not: null },
            ...qualifiedFilter,
            ...(kota ? { kota: { contains: kota, mode: 'insensitive' } } : {}),
          },
          select: {
            id: true,
            name: true,
            phone: true,
            lat: true,
            lng: true,
            kota: true,
            kecamatan: true,
            kelurahan: true,
            status: true,
            is_mql: true,
            is_out_of_coverage: true,
            distance_km: true,
            location_source: true,
            preferences: true,
            reservations: {
              where: { status: { notIn: ['cancelled', 'rejected'] } },
              select: { id: true },
              take: 1,
            },
          },
          take: 5000,
        });

        const clinic = await getClinicLocationAsync(tenantId);
        const { haversineKm } = await import('../../utils/gazetteer');
        let points: any[] = coordsRows
          .filter(
            (c: any) =>
              typeof c.lat === 'number' &&
              typeof c.lng === 'number' &&
              c.lat >= -90 &&
              c.lat <= 90 &&
              c.lng >= -180 &&
              c.lng <= 180
          )
          .map((c: any) => {
            let dist = typeof c.distance_km === 'number' ? c.distance_km : null;
            if (dist == null && clinic && typeof clinic.lat === 'number' && typeof clinic.lng === 'number') {
              dist = Math.round(haversineKm(clinic.lat, clinic.lng, c.lat, c.lng) * 10) / 10;
            }
            const isOutOfCoverage =
              c.is_out_of_coverage ??
              (typeof clinic?.maxCoverageKm === 'number' && dist != null ? dist > clinic.maxCoverageKm : false);
            const prefs = (c.preferences as any) || {};
            let effectiveSource = c.location_source;
            if (!effectiveSource) {
              if (prefs.location_updated_by_staff_name || prefs.location_updated_by_staff_id || prefs.field_gps_lat) {
                effectiveSource = 'manual_staff';
              } else if (prefs.source === 'geocoding' || prefs.location_source === 'geocoding') {
                effectiveSource = 'estimated_area';
              } else {
                effectiveSource = 'gps_pin';
              }
            }
            return {
              ...c,
              distance_km: dist,
              is_out_of_coverage: isOutOfCoverage,
              location_source: effectiveSource,
              has_reservation: Array.isArray(c.reservations) && c.reservations.length > 0,
              reservations: undefined,
              preferences: undefined,
              is_estimated_centroid: false,
            };
          });

        if (!showAll) {
          points = points.filter(isWithinServiceArea);
        }

        if (includeCentroids) {
          try {
            const nullRows = await prisma.customer.findMany({
              where: {
                tenant_id: tenantId,
                is_sandbox_test: false,
                lat: null,
                ...qualifiedFilter,
                ...(kota ? { kota: { contains: kota, mode: 'insensitive' } } : {}),
              },
              select: {
                id: true,
                name: true,
                phone: true,
                kota: true,
                kecamatan: true,
                kelurahan: true,
                status: true,
                is_mql: true,
                is_out_of_coverage: true,
                distance_km: true,
                location_source: true,
                reservations: {
                  where: { status: { notIn: ['cancelled', 'rejected'] } },
                  select: { id: true },
                  take: 1,
                },
              },
              take: 5000,
            });

            const clinic = await getClinicLocationAsync(tenantId);
            const { getGazetteerCoordinates, haversineKm } = await import('../../utils/gazetteer');
            const { isValidAreaName } = await import('../../utils/wilayah-normalizer');

            for (const c of nullRows) {
              const kelurahan = isValidAreaName(c.kelurahan) ? c.kelurahan : null;
              const kecamatan = isValidAreaName(c.kecamatan) ? c.kecamatan : null;
              if (!kelurahan) continue;

              let gaz = null;
              if (kelurahan && kecamatan) {
                gaz = getGazetteerCoordinates(`${kelurahan} ${kecamatan}`);
              }
              if (!gaz) {
                gaz = getGazetteerCoordinates(kelurahan || kecamatan || '');
              }
              if (!gaz || !Number.isFinite(gaz.lat) || !Number.isFinite(gaz.lng)) continue;
              const dist = Math.round(haversineKm(clinic.lat, clinic.lng, gaz.lat, gaz.lng) * 10) / 10;
              const isOutOfCoverage = typeof clinic.maxCoverageKm === 'number' && dist > clinic.maxCoverageKm;
              const centroidPoint: any = {
                id: c.id,
                name: c.name,
                phone: c.phone,
                lat: gaz.lat,
                lng: gaz.lng,
                kota: c.kota || gaz.kota,
                kecamatan: c.kecamatan || gaz.kecamatan,
                kelurahan: c.kelurahan || gaz.kelurahan,
                status: c.status,
                is_mql: c.is_mql,
                has_reservation: Array.isArray(c.reservations) && c.reservations.length > 0,
                is_out_of_coverage: isOutOfCoverage,
                distance_km: dist,
                location_source: 'estimated_area',
                is_estimated_centroid: true,
              };
              if (showAll || isWithinServiceArea(centroidPoint)) {
                points.push(centroidPoint);
              }
            }
          } catch (centroidErr: any) {
            console.warn('[map-points] sentroid gagal:', centroidErr?.message);
          }
        }

        points = points.filter((p: any) => p.has_reservation || p.is_mql === true);

        return reply
          .header('Cache-Control', 'private, max-age=15, stale-while-revalidate=60')
          .status(200)
          .send({
            success: true,
            points,
            total: points.length,
            clinic: {
              lat: clinic.lat,
              lng: clinic.lng,
              name: clinic.name,
              maxCoverageKm: clinic.maxCoverageKm,
              rings: [5, 15, clinic.maxCoverageKm],
            },
          });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );
}
