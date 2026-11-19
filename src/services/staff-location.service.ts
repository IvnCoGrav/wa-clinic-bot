import { prisma } from '../db/client';
import { calculateHaversineDistance } from '../utils/haversine';
import { getClinicLocationAsync } from '../config/clinic-location';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { estimateTravelDurationMinutes } from '../utils/travel-duration';
import { STAFF_VERIFIED_LOCATION_LABEL, FIELD_VERIFIED_LOCATION_LABEL } from '../domain/location-source';
import { deriveFieldVerification } from '../domain/location-trust';

export interface UpdateCustomerLocationParams {
  reservationId: string;
  staffId: string;
  staffName: string;
  tenantId?: string;
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
  housePhotoB64?: string | null;
  landmark?: string | null;
  isSupervisor?: boolean;
}

export interface UpdateCustomerLocationResult {
  success: boolean;
  data?: any;
  error?: string;
}

const MOVE_CONFIRMATION_THRESHOLD_KM = 0.150;

export class StaffLocationService {
  /**
   * Memperbarui titik koordinat lokasi GPS, foto tampak depan rumah, dan catatan patokan
   * milik customer dari lapangan oleh terapis.
   * Otomatis mengompresi foto (max 800px) dan menghitung ulang jarak dari klinik.
   *
   * Plan v2.1/v2.2:
   * - Foto rumah WAJIB untuk pengakuan status field_verified (dengan akurasi GPS <= 50m).
   * - Bila konflik > 150m dari pin pasien lama, tandai diverged + needs_move_confirmation, jangan diam-diam mengabaikan.
   * - Jangan menimpa pin presisi hanya karena ada foto baru pada rumah yang sama.
   */
  static async updateCustomerLocation(params: UpdateCustomerLocationParams): Promise<UpdateCustomerLocationResult> {
    const {
      reservationId,
      staffId,
      staffName,
      tenantId = DEFAULT_TENANT_ID,
      lat,
      lng,
      accuracyM,
      housePhotoB64,
      landmark,
      isSupervisor = false,
    } = params;

    if (!reservationId || !staffId) {
      return { success: false, error: 'reservationId dan staffId wajib disertakan.' };
    }

    if (lat != null && lng != null && typeof accuracyM === 'number' && accuracyM > 50) {
      return {
        success: false,
        error: `Akurasi sinyal GPS perangkat kurang presisi (±${Math.round(accuracyM)}m, melebihi batas toleransi maksimal 50m). Mohon aktifkan GPS akurasi tinggi atau tunggu beberapa saat di area terbuka sebelum mengunci titik lokasi.`,
      };
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

      if (!isSupervisor && (!reservation.assigned_staff_id || reservation.assigned_staff_id !== staffId)) {
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

        // S-08: titik & batas jangkauan klinik mengikuti tenant (bukan env global/45 km hardcode).
        const clinicLoc = await getClinicLocationAsync(tenantId);
        const clinicCoords = { lat: clinicLoc.lat, lng: clinicLoc.lng };
        const { deliveryService } = await import('./delivery.service');
        const deliveryResult = await deliveryService.calculateDelivery(
          { lat: targetLat, lng: targetLng },
          clinicCoords,
          tenantId
        );
        distanceKm = deliveryResult.distanceKm;
        newOngkir = deliveryResult.promoPrice;

        // Skema kroscek 1: Tolak jika jarak dari klinik melampaui jangkauan tenant.
        const MAX_ALLOWED_DISTANCE_KM =
          Number.isFinite(clinicLoc.maxCoverageKm) && clinicLoc.maxCoverageKm > 0
            ? clinicLoc.maxCoverageKm
            : 45;
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

      // Cek apakah koordinat baru berselisih dari koordinat utama customer yang sudah ada
      let shouldUpdatePrimaryCoords = true;
      let diffFromOriginalKm: number | null = null;
      const baseLandmark = landmark !== undefined ? (landmark?.trim() || null) : ((customer.preferences as any)?.landmark || null);
      let finalLandmark = baseLandmark;

      const isPreviousCoordEstimated =
        (customer as any).location_source === 'estimated_area' ||
        (customer.preferences as any)?.location_source === 'geocoding' ||
        (customer as any).share_location_sent === false ||
        customer.lat == null ||
        customer.lng == null;

      if (lat != null && lng != null) {
        if (customer.lat != null && customer.lng != null) {
          diffFromOriginalKm = calculateHaversineDistance(
            { lat: customer.lat, lng: customer.lng },
            { lat, lng }
          );

          if (!isPreviousCoordEstimated) {
            // Plan v2.1: Koordinat lama sudah presisi (pin pasien/bidan)
            if (diffFromOriginalKm <= MOVE_CONFIRMATION_THRESHOLD_KM) {
              // Pada rumah yang sama (selisih <= 150m):
              // "Jangan menimpa pin hanya karena ada foto."
              // Bila ada foto baru, pertahankan pin asli pasien sebagai koordinat navigasi utama
              // Bila tanpa foto (kunci GPS manual staf biasa), perbarui ke manual_staff
              if (hasNewPhoto) {
                shouldUpdatePrimaryCoords = false;
              } else {
                shouldUpdatePrimaryCoords = true;
              }
            } else {
              // Konflik > 150m dari pin pasien: JANGAN diam-diam mengabaikan atau menimpa pin
              // Tandai diverged dan butuh konfirmasi pindah rumah
              shouldUpdatePrimaryCoords = false;
              const gpsTag = `[📍 GPS Lapangan: ${lat.toFixed(6)}, ${lng.toFixed(6)} (+${diffFromOriginalKm.toFixed(2)}km)]`;
              finalLandmark = baseLandmark ? `${baseLandmark} ${gpsTag}` : gpsTag;
            }
          } else {
            // Estimasi lama (geocoding/wilayah): GPS lapangan presisi diperbarui menjadi titik utama
            shouldUpdatePrimaryCoords = true;
          }
        } else {
          // Belum punya koordinat sebelumnya: simpan sebagai koordinat utama
          shouldUpdatePrimaryCoords = true;
        }
      }

      let housePhotoUrl: string | null = (customer.preferences as any)?.house_photo_url || null;

      // Kompres, beri watermark GPS tenant-aware, dan simpan foto jika ada.
      // - brand/honorific dari DB tenant (bukan hardcode).
      // - Watermark memakai patokan mentah (baseLandmark) agar tag GPS internal
      //   [📍 GPS Lapangan: ...] yang disimpan di DB tidak menduplikasi baris patokan.
      // - Simpan HD 800px ber-watermark sebagai housePhotoUrl agar teks tajam;
      //   lifecycle retensi/prune (media.service) yang menurunkan ke thumb setelah 30 hari.
      if (housePhotoB64 && housePhotoB64.startsWith('data:image/')) {
        const { mediaService } = await import('./media.service');
        const { getBrandIdentityAsync } = await import('../config/brand');
        const matches = housePhotoB64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        const rawB64 = matches ? matches[2] : housePhotoB64;
        const resized = await mediaService.resizeImageToMax(Buffer.from(rawB64, 'base64'), 800);
        const brand = await getBrandIdentityAsync(tenantId);
        const watermarked = await mediaService.overlayGpsBadge(resized, {
          lat: targetLat,
          lng: targetLng,
          customerName: customer.name || undefined,
          customerHonorific: brand.addressTermForCustomer,
          kelurahan: customer.kelurahan,
          kecamatan: customer.kecamatan,
          landmark: baseLandmark,
          staffName: staffName || undefined,
          takerName: staffName || undefined,
          brandName: brand.businessName,
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
      const existingHistory: any[] = Array.isArray(currentPrefs.location_history) ? currentPrefs.location_history : [];
      const isPrimaryUpdated = shouldUpdatePrimaryCoords && lat != null && lng != null;

      // F5 (A-006/A-007): field_verified hanya dari bukti lapangan nyata (foto + GPS segar + akurasi + rumah sama).
      const needsMoveConfirmation = Boolean(
        diffFromOriginalKm != null && diffFromOriginalKm > MOVE_CONFIRMATION_THRESHOLD_KM && !isPreviousCoordEstimated
      );
      const isFieldVerified = deriveFieldVerification({
        housePhotoUrl,
        accuracyM: typeof accuracyM === 'number' ? accuracyM : null,
        hasFreshFieldGps: hasNewPhoto && lat != null && lng != null,
        sameLocation: diffFromOriginalKm == null || diffFromOriginalKm <= MOVE_CONFIRMATION_THRESHOLD_KM || isPreviousCoordEstimated,
        preferences: currentPrefs,
        purchaseCount: (customer as any).purchase_count ?? 0,
      }).verified;

      const newHistoryEntry = (targetLat != null && targetLng != null && distanceKm != null)
        ? {
            source: isFieldVerified ? 'field_verified' : (isPrimaryUpdated ? 'manual_staff' : 'FIELD_STAFF_GPS'),
            raw_source: 'FIELD_STAFF_GPS',
            sourceLabel: isFieldVerified
              ? FIELD_VERIFIED_LOCATION_LABEL
              : (isPrimaryUpdated ? STAFF_VERIFIED_LOCATION_LABEL : '📍 GPS Lapangan (Diverged)'),
            lat: targetLat,
            lng: targetLng,
            staffId,
            staffName: staffName || 'Staff',
            distanceKm: typeof distanceKm === 'number' ? Number(distanceKm.toFixed(2)) : null,
            ongkir: newOngkir,
            photoUrl: housePhotoUrl,
            isFieldVerified,
            ...(typeof accuracyM === 'number' ? { accuracyM: Math.round(accuracyM) } : {}),
            updatedAt: new Date().toISOString(),
          }
        : null;
      const updatedPrefs = {
        ...currentPrefs,
        ...(housePhotoUrl ? { house_photo_url: housePhotoUrl } : {}),
        landmark: finalLandmark,
        ...(needsMoveConfirmation
          ? {
              field_gps_lat: lat,
              field_gps_lng: lng,
              field_gps_diff_km: Number(diffFromOriginalKm!.toFixed(3)),
              field_gps_diverged: true,
              needs_move_confirmation: true,
              move_confirmation_reason: `Titik GPS staf berjarak ${Math.round(diffFromOriginalKm! * 1000)} m dari pin lokasi customer. Kemungkinan pasien pindah rumah.`,
              address_point_updated_at: new Date().toISOString(),
            }
          : {}),
        ...(isFieldVerified ? { field_verified: true } : {}),
        ...(typeof accuracyM === 'number' ? { location_accuracy_m: accuracyM } : {}),
        ...(isPrimaryUpdated
          ? {
              location_source: 'manual_staff',
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

      if (reservation.customer_address_id) {
        try {
          await prisma.customerAddress.update({
            where: { id: reservation.customer_address_id },
            data: {
              ...(landmark !== undefined ? { landmark: baseLandmark } : {}),
              ...(shouldUpdatePrimaryCoords && lat != null ? { lat } : {}),
              ...(shouldUpdatePrimaryCoords && lng != null ? { lng } : {}),
              ...(shouldUpdatePrimaryCoords && distanceKm != null ? { distance_km: distanceKm } : {}),
              ...(shouldUpdatePrimaryCoords && newOngkir != null ? { ongkir: newOngkir } : {}),
              // last_used_at TIDAK diubah oleh verifikasi koordinat (resolver/itinerary bergantung padanya).
            },
          });
        } catch {}
      }

      // Audit log
      const { auditService } = await import('./audit.service');
      await auditService.logAdminAction({
        tenantId,
        apiKey: 'STAFF_SESSION',
        adminIdentity: staffName,
        action: needsMoveConfirmation ? 'STAFF_UPDATE_CUSTOMER_LOCATION_DIVERGED' : 'STAFF_UPDATE_CUSTOMER_LOCATION',
        targetId: customer.id,
        payload: {
          reservationId,
          submittedLat: lat,
          submittedLng: lng,
          primaryLat: updatedCustomer.lat,
          primaryLng: updatedCustomer.lng,
          distanceKm: updatedCustomer.distance_km,
          diffFromOriginalKm,
          diverged: needsMoveConfirmation,
          needsMoveConfirmation,
          housePhotoUrl,
          landmark: finalLandmark,
        },
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
            diverged: needsMoveConfirmation,
            needsMoveConfirmation,
            diffKm: diffFromOriginalKm != null ? Number(diffFromOriginalKm.toFixed(3)) : null,
            distanceKm: updatedCustomer.distance_km,
            ongkir: updatedCustomer.ongkir,
            landmark: finalLandmark,
            housePhotoUrl,
            updatedAt: new Date().toISOString(),
          },
        }).catch(() => {});
      } catch {}

      // Seam kanonis: selaraskan seluruh jadwal aktif ke alamat terbaru
      // (anti ghost-address lintas rezim penulis lokasi). Best-effort.
      try {
        const { syncActiveReservationsForCustomer } = await import('./reservation-address-sync.service');
        await syncActiveReservationsForCustomer({ tenantId, customerId: customer.id });
      } catch (syncErr: any) {
        console.warn('[STAFF RESERVATION] active reservation sync skipped (best-effort):', syncErr?.message);
      }

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
          diverged: needsMoveConfirmation,
          needsMoveConfirmation,
          diffKm: diffFromOriginalKm != null ? Number(diffFromOriginalKm.toFixed(3)) : null,
          message: (() => {
            if (needsMoveConfirmation && diffFromOriginalKm != null) {
              return `Titik GPS lapangan berselisih ${Math.round(diffFromOriginalKm * 1000)} m dari titik tersimpan. Titik lama dipertahankan dan menunggu konfirmasi pindah rumah.`;
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
}
