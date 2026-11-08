import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../db/client';
import { customerService } from '../../../services/customer.service';
import { auditService } from '../../../services/audit.service';
import { LocationSource } from '@prisma/client';
import { tenantOf } from '../route-helpers';
import { relinkActiveReservationsForCard } from './shared';

export async function registerCustomerLocationRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/admin/customers/:id/refresh-location
   * Refresh & Hitung Ulang Lokasi, Jarak & Ongkir berdasar hierarki validitas (Bidan → Customer → DB → Geocoding)
   */
  fastify.post(
    '/api/admin/customers/:id/refresh-location',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const tenantId = tenantOf(request);
      try {
        const performedBy = (request as any).adminIdentity || (request as any).adminSession?.adminIdentity || 'Admin';
        const result = await customerService.refreshCustomerLocationAndOngkir(id, tenantId, performedBy);
        if (!result.success) {
          return reply.status(400).send({ success: false, error: result.error });
        }
        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: performedBy,
          action: 'CUSTOMER_LOCATION_REFRESHED',
          targetId: id,
          payload: result.data,
          ipAddress: request.ip,
          tenantId,
        });
        const ongkirStr = new Intl.NumberFormat('id-ID').format(result.data!.ongkir);
        return reply.status(200).send({
          success: true,
          data: result.data,
          message: `Lokasi & ongkir berhasil dimutakhirkan berdasarkan ${result.data!.sourceLabel} (Jarak: ${result.data!.distanceKm.toFixed(2)} km, Ongkir: Rp ${ongkirStr}).`,
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * PUT /api/admin/customers/:id/location
   * Admin memperbarui foto rumah, catatan patokan, dan/atau titik koordinat GPS customer.
   */
  fastify.put(
    '/api/admin/customers/:id/location',
    { bodyLimit: 12 * 1024 * 1024 },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          housePhotoB64?: string | null;
          landmark?: string | null;
          lat?: number | null;
          lng?: number | null;
          removePhoto?: boolean;
          /** Bila diisi, perubahan landmark/GPS ditulis ke KARTU ini (bukan profil root). */
          customerAddressId?: string | null;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const tenantId = tenantOf(request);
      const { housePhotoB64, landmark, lat, lng, removePhoto, customerAddressId } = request.body || {};

      try {
        const customer = await customerService.getCustomerById(id, tenantId);

        if (!customer) {
          return reply.status(404).send({ success: false, error: 'Customer tidak ditemukan.' });
        }

        // Mode KARTU: admin mengedit panduan lokasi rumah tertentu (multi-rumah).
        // Tanpa mode ini, titik GPS rumah kedua menimpa koordinat profil root →
        // jadwal rumah lain ikut bergeser (insiden multi-alamat 2026-11-05).
        let targetCard: any = null;
        if (customerAddressId) {
          const cards = await customerService.getSavedAddresses(id, tenantId).catch(() => []);
          targetCard = (Array.isArray(cards) ? cards : []).find((c: any) => c?.id === customerAddressId) || null;
          if (!targetCard) {
            return reply.status(404).send({
              success: false,
              code: 'CUSTOMER_ADDRESS_NOT_FOUND',
              error: 'Kartu alamat tidak ditemukan pada buku alamat customer ini.',
            });
          }
        }

        const { mediaService } = await import('../../../services/media.service');

        const hasNewPhoto = !!housePhotoB64 && housePhotoB64.startsWith('data:image/');
        const preLat = targetCard ? targetCard.lat : customer.lat;
        const preLng = targetCard ? targetCard.lng : customer.lng;
        const targetLatPre = lat !== undefined ? lat : preLat;
        const targetLngPre = lng !== undefined ? lng : preLng;
        if (hasNewPhoto && (targetLatPre == null || targetLngPre == null)) {
          return reply.status(400).send({ success: false, error: 'Foto rumah wajib disertai koordinat GPS. Isi titik GPS dulu sebelum menyimpan foto.' });
        }

        let housePhotoUrl: string | null = (customer.preferences as any)?.house_photo_url || null;

        let distanceKm = targetCard ? targetCard.distanceKm : customer.distance_km;
        let newOngkir: number | null = null;
        const targetLat = lat !== undefined ? lat : preLat;
        const targetLng = lng !== undefined ? lng : preLng;

        if (targetLat != null && targetLng != null) {
          // Validasi range koordinat Indonesia
          if (targetLat < -12 || targetLat > 7 || targetLng < 94 || targetLng > 142) {
            return reply.status(400).send({ success: false, error: 'Koordinat GPS di luar wilayah Indonesia atau tidak valid.' });
          }

          const { clinicConfig } = await import('../../../config/clinic');
          const clinicCoords = { lat: clinicConfig.lat, lng: clinicConfig.lng };
          const { deliveryService } = await import('../../../services/delivery.service');
          const deliveryResult = await deliveryService.calculateDelivery(
            { lat: targetLat, lng: targetLng },
            clinicCoords,
            tenantId
          );
          distanceKm = deliveryResult.distanceKm;
          newOngkir = deliveryResult.promoPrice;

          // Skema kroscek 1: Tolak jika jarak dari klinik melenceng > 45 km (di luar area jangkauan)
          const MAX_ALLOWED_DISTANCE_KM = 45;
          if (distanceKm > MAX_ALLOWED_DISTANCE_KM) {
            return reply.status(400).send({
              success: false,
              error: `Titik GPS terdeteksi berjarak ${distanceKm.toFixed(1)} km dari klinik (melenceng jauh di luar area jangkauan maksimal ${MAX_ALLOWED_DISTANCE_KM} km). Pastikan titik koordinat berada di lokasi rumah pasien.`,
            });
          }

          // Skema kroscek 2: Tolak jika pergeseran titik melenceng > 25 km dari data kelurahan/wilayah sebelumnya
          const distanceBaseline = targetCard ? targetCard.distanceKm : customer.distance_km;
          if (distanceBaseline && Math.abs(distanceKm - distanceBaseline) > 25) {
            return reply.status(400).send({
              success: false,
              error: `Titik GPS melenceng terlalu jauh (${Math.abs(distanceKm - distanceBaseline).toFixed(1)} km selisih) dari estimasi area ${(targetCard ? targetCard.kelurahan : customer.kelurahan) || 'pasien'}. Pembaruan lokasi ditolak untuk mencegah salah alamat.`,
            });
          }
        }

        // Cek selisih jarak dengan koordinat awal (Haversine > 1km)
        let shouldUpdatePrimaryCoords = true;
        let diffFromOriginalKm: number | null = null;
        const baseLandmark = landmark !== undefined
          ? (landmark?.trim() || null)
          : (targetCard ? targetCard.landmark : ((customer.preferences as any)?.landmark || null));
        let finalLandmark = baseLandmark;

        if (lat !== undefined && lng !== undefined && lat != null && lng != null) {
          if (preLat != null && preLng != null) {
            const { calculateHaversineDistance } = await import('../../../utils/haversine');
            diffFromOriginalKm = calculateHaversineDistance(
              { lat: preLat, lng: preLng },
              { lat, lng }
            );

            // Admin CS otoritas tertinggi: selalu simpan koordinat primer (hapus limit 1km)
            shouldUpdatePrimaryCoords = true;
            if (diffFromOriginalKm != null && diffFromOriginalKm > 1.0) {
              const gpsTag = `[📍 GPS Lapangan: ${lat.toFixed(6)}, ${lng.toFixed(6)} (+${diffFromOriginalKm.toFixed(1)}km)]`;
              finalLandmark = baseLandmark ? `${baseLandmark} ${gpsTag}` : gpsTag;
            }
          } else {
            shouldUpdatePrimaryCoords = true;
          }
        }

        if (removePhoto) {
          // Hapus kedua file (HD + thumb) dari disk, bukan cuma null-kan DB
          const existingUrl = (customer.preferences as any)?.house_photo_url;
          if (existingUrl) {
            mediaService.deleteFile(existingUrl);
            const match = existingUrl.match(/^\/media\/(outbound|inbound)\/([^/]+)\/([^/]+)$/);
            if (match) {
              const thumbFile = match[3].replace(/(\.\w+)$/, '_thumb$1');
              const thumbUrl = `/media/${match[1]}/${match[2]}/${thumbFile}`;
              mediaService.deleteFile(thumbUrl);
            }
          }
          housePhotoUrl = null;
        } else if (housePhotoB64 && housePhotoB64.startsWith('data:image/')) {
          const rawB64 = housePhotoB64.replace(/^data:image\/[^;]+;base64,/, '');
          const resized = await mediaService.resizeImageToMax(Buffer.from(rawB64, 'base64'), 800);
          const adminName = (request as any).adminSession?.adminIdentity || 'Admin Klinik';
          const { getBrandIdentityAsync } = await import('../../../config/brand');
          const brandTenantId = (customer as any).tenant_id || tenantId;
          const brand = await getBrandIdentityAsync(brandTenantId);
          const watermarked = await mediaService.overlayGpsBadge(resized, {
            lat: targetLat,
            lng: targetLng,
            customerName: (customer as any).name || undefined,
            customerHonorific: brand.addressTermForCustomer,
            kelurahan: targetCard ? targetCard.kelurahan : customer.kelurahan,
            kecamatan: targetCard ? targetCard.kecamatan : customer.kecamatan,
            landmark: baseLandmark,
            takerName: adminName,
            staffName: adminName,
            brandName: brand.businessName,
          });
          const saved = await mediaService.saveOutboundMedia({
            tenantId,
            imageB64: watermarked.toString('base64'),
            mimeType: 'image/jpeg',
            fileName: `house-${customer.id}.jpg`,
          });
          // Simpan HD 800px ber-watermark agar teks tajam; retensi 30 hari
          // (deleteExpiredMedia → updateMediaRefsAfterHdDelete) menurunkan ke thumb.
          housePhotoUrl = saved.hdUrl;
        }

        const currentPrefs = (customer.preferences as any) || {};
        const existingHistory: any[] = Array.isArray(currentPrefs.location_history) ? currentPrefs.location_history : [];
        const newHistoryEntry = (targetLat != null && targetLng != null && distanceKm != null)
          ? {
              source: 'ADMIN_GPS',
              lat: targetLat,
              lng: targetLng,
              staffName: (request as any).adminIdentity || 'Admin CS',
              distanceKm: typeof distanceKm === 'number' ? Number(distanceKm.toFixed(2)) : null,
              ongkir: newOngkir,
              updatedAt: new Date().toISOString(),
            }
          : null;

        const coordsChanged =
          lat !== undefined && lng !== undefined && lat != null && lng != null &&
          (lat !== preLat || lng !== preLng);

        let updatedCustomer: any = customer;
        if (targetCard) {
          // Mode KARTU: tulis landmark/GPS ke kartu rumah yang dipilih. Profil
          // root TIDAK disentuh agar rumah lain tidak ikut bergeser.
          try {
            const entry = await customerService.upsertSavedAddress(
              customer.id,
              {
                id: targetCard.id,
                label: targetCard.label,
                address: targetCard.address,
                kelurahan: targetCard.kelurahan,
                kecamatan: targetCard.kecamatan,
                kota: targetCard.kota,
                lat: targetLat ?? null,
                lng: targetLng ?? null,
                distanceKm: typeof distanceKm === 'number' ? distanceKm : (targetCard.distanceKm ?? null),
                ongkir: typeof newOngkir === 'number' ? newOngkir : (targetCard.ongkir ?? null),
                landmark: finalLandmark,
                locationSource: (targetCard.locationSource ?? targetCard.location_source ?? LocationSource.manual_staff) as any,
                isPrimary: Boolean(targetCard.isPrimary ?? targetCard.is_primary),
              },
              tenantId
            );
            if (entry) targetCard = { ...targetCard, ...entry };
            if (coordsChanged) {
              await relinkActiveReservationsForCard({
                tenantId,
                customerId: customer.id,
                cardId: targetCard.id,
                fee: typeof newOngkir === 'number' ? newOngkir : (targetCard.ongkir ?? null),
              });
            }
          } catch (cardErr: any) {
            console.error('[ADMIN CUSTOMER] Gagal memperbarui kartu alamat:', cardErr?.message);
            return reply.status(500).send({ success: false, error: cardErr?.message || 'Gagal memperbarui kartu alamat.' });
          }
        } else if (coordsChanged) {
          try {
            updatedCustomer = await customerService.updateCustomerLocation(
              customer.id,
              {
                kelurahan: customer.kelurahan ?? undefined,
                kecamatan: customer.kecamatan ?? undefined,
                kota: customer.kota ?? undefined,
                lat: lat ?? undefined,
                lng: lng ?? undefined,
                locationSource: LocationSource.manual_staff,
                forceUpdateGps: true,
              },
              tenantId
            );
            if (!updatedCustomer) updatedCustomer = customer;
          } catch (seamErr: any) {
            console.error('[ADMIN CUSTOMER] Seam lokasi gagal:', seamErr.message);
            return reply.status(500).send({ success: false, error: seamErr.message });
          }
        }

        // Media/foto + landmark: patch preferences SAJA (tanpa kolom lokasi).
        let updatedPrefs: any = null;
        try {
          const seamPrefs = (updatedCustomer.preferences as any) || {};
          const seamHistory: any[] = Array.isArray(seamPrefs.location_history) ? seamPrefs.location_history : [];
          const mergedPrefs = {
            ...seamPrefs,
            house_photo_url: housePhotoUrl,
            // Mode kartu: landmark milik kartu — jangan menimpa landmark profil root.
            landmark: targetCard ? (seamPrefs.landmark ?? null) : finalLandmark,
            ...(!targetCard && diffFromOriginalKm != null && diffFromOriginalKm > 1.0
              ? {
                  field_gps_lat: lat,
                  field_gps_lng: lng,
                  field_gps_diff_km: Number(diffFromOriginalKm.toFixed(2)),
                  field_gps_diverged: true,
                }
              : {}),
            location_updated_at: new Date().toISOString(),
            location_updated_by_staff_name: (request as any).adminIdentity || 'Admin CS',
            ...(!targetCard && newHistoryEntry ? { location_history: [...seamHistory.slice(-9), newHistoryEntry] } : {}),
          };
          try {
            const patched = await prisma.customer.update({
              where: { id: customer.id },
              data: { preferences: mergedPrefs },
            });
            updatedCustomer = { ...updatedCustomer, preferences: (patched as any).preferences ?? mergedPrefs };
          } catch {
            updatedCustomer.preferences = mergedPrefs;
            updatedCustomer.updated_at = new Date();
            const mem = customerService.getMemoryCustomers();
            mem.set(updatedCustomer.phone || customer.phone, updatedCustomer);
          }
          updatedPrefs = mergedPrefs;
        } catch (prefErr: any) {
          console.error('[ADMIN CUSTOMER] Patch media gagal:', prefErr.message);
          return reply.status(500).send({ success: false, error: prefErr.message });
        }

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'ADMIN_UPDATE_CUSTOMER_LOCATION',
          targetId: id,
          payload: {
            lat: updatedCustomer.lat,
            lng: updatedCustomer.lng,
            distanceKm: updatedCustomer.distance_km,
            housePhotoUrl,
            landmark,
          },
          ipAddress: request.ip,
          tenantId,
        });

        return reply.status(200).send({
          success: true,
          data: {
            id: updatedCustomer.id,
            lat: updatedCustomer.lat,
            lng: updatedCustomer.lng,
            distance_km: updatedCustomer.distance_km,
            house_photo_url: housePhotoUrl,
            landmark: targetCard ? (targetCard.landmark ?? null) : (updatedPrefs.landmark || null),
            preferences: updatedPrefs,
            customer_address_id: targetCard?.id || null,
            card: targetCard || null,
          },
        });
      } catch (err: any) {
        console.error('[ADMIN CUSTOMER] Error updating location:', err.message);
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * POST /api/admin/customers/resolve-location
   * Resolve Google Maps URL or geocode address text to coordinates + delivery info.
   * Body: { url?: string; text?: string }
   * Returns: { success, lat, lng, kelurahan, kecamatan, kota, distanceKm, ongkir, isOutOfCoverage, formattedAddress, addressQueryUsed }
   */
  fastify.post(
    '/api/admin/customers/resolve-location',
    async (
      request: FastifyRequest<{
        Body: { url?: string; text?: string };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = tenantOf(request);
      const { url, text } = request.body || {};

      if (!url && !text) {
        return reply.status(400).send({ success: false, error: 'url atau text wajib diisi' });
      }

      try {
        let result: any = null;

        if (url) {
          const { resolveLocationFromUrl, extractGoogleMapsUrls } = await import('../../../services/location-resolver.service');
          const extracted = extractGoogleMapsUrls(url);
          const cleanUrl = extracted.length > 0 ? extracted[0] : url.trim();
          result = await resolveLocationFromUrl(cleanUrl, tenantId);
        } else if (text) {
          const { geocodingService } = await import('../../../integrations/google-maps/geocoding');
          const { deliveryService } = await import('../../../services/delivery.service');
          const geo = await geocodingService.geocodeText(text);
          if (geo.isPrecise && geo.lat != null && geo.lng != null) {
            const delivery = await deliveryService.calculateDelivery(
              { lat: geo.lat, lng: geo.lng },
              undefined,
              tenantId
            );
            result = {
              success: true,
              source: 'geocoding',
              sourceLabel: '📍 Geocoding Teks',
              lat: geo.lat,
              lng: geo.lng,
              kelurahan: geo.kelurahan,
              kecamatan: geo.kecamatan,
              kota: geo.kota,
              distanceKm: delivery.distanceKm,
              ongkir: delivery.ongkir,
              isOutOfCoverage: delivery.isOutOfCoverage,
              zipcode: geo.zipcode,
              formattedAddress: geo.formattedAddress,
            };
          }
        }

        if (!result?.success) {
          return reply.status(400).send({ success: false, error: result?.error || 'Gagal resolve lokasi' });
        }

        return reply.status(200).send({ success: true, data: result });
      } catch (err: any) {
        console.error('[ADMIN CUSTOMER] Error resolve-location:', err.message);
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );
}
