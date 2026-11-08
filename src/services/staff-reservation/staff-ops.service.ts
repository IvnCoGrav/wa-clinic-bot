import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { calculateHaversineDistance } from '../../utils/haversine';
import { clinicConfig } from '../../config/clinic';
import {
  reservationStatusService,
  InvalidTransitionError,
  PrematureCompletionError,
} from '../reservation-status.service';
import { getStaffChatWindowConfig } from '../../config/staff-chat-window-config';
import {
  STAFF_VERIFIED_LOCATION_LABEL,
  estimateTravelDurationMinutes,
  evaluateChatWindowForBooking,
  HOUR_MS,
} from './task-builder';
import { getArrivalMessageText } from './staff-trip-messages.service';

/**
 * Guard kepemilikan: Memastikan bahwa percakapan yang diakses staff memang terhubung
 * ke customer yang memiliki reservasi tugas aktif hari ini yang ditugaskan ke staff tsb.
 * Khusus peran supervisor (SPV CS / Admin), diperbolehkan memantau semua percakapan aktif hari ini.
 */
export async function assertConversationOwnedByStaffToday(
  conversationId: string,
  staffId: string,
  tenantId = DEFAULT_TENANT_ID,
  isSupervisor = false
): Promise<boolean> {
  if (!conversationId || !staffId) return false;

  const now = new Date();

  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { customer_id: true, tenant_id: true },
    });

    if (!conv || conv.tenant_id !== tenantId) return false;

    // Supervisor: akses penuh (override) selama percakapan milik tenant yang sama.
    if (isSupervisor) return true;

    const config = await getStaffChatWindowConfig(tenantId);
    const lookaheadEnd = new Date(
      now.getTime() + Math.max(config.openHoursBefore, 1) * HOUR_MS + 24 * HOUR_MS
    );
    const lookbackStart = new Date(now.getTime() - (config.closeHoursAfter + 24) * HOUR_MS);

    const candidates = await prisma.reservation.findMany({
      where: {
        tenant_id: tenantId,
        customer_id: conv.customer_id,
        assigned_staff_id: staffId,
        status: { notIn: ['cancelled', 'rejected'] },
        booking_date: { gte: lookbackStart, lte: lookaheadEnd },
      },
      select: {
        id: true,
        booking_date: true,
        status: true,
        purchase_occurred_at: true,
        updated_at: true,
      },
      orderBy: { booking_date: 'asc' },
    });

    if (!Array.isArray(candidates) || candidates.length === 0) return false;

    const isCompleted = (status: string | null | undefined) =>
      ['completed', 'selesai'].includes((status || '').toLowerCase());

    return candidates.some((r: any) => {
      const completedAt = isCompleted(r.status)
        ? r.purchase_occurred_at || r.updated_at || null
        : null;
      return evaluateChatWindowForBooking(r.booking_date, {
        now,
        isSupervisor: false,
        completedAt,
        config,
      }).open;
    });
  } catch (err: any) {
    console.error('[STAFF RESERVATION] Error asserting conversation ownership:', err.message);
    return false;
  }
}

/**
 * Mendelegasikan / mengganti staf terapis penanggung jawab tugas reservasi.
 * Hanya dapat dipanggil oleh role supervisor (SPV CS / Admin).
 */
export async function reassignTask(params: {
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
    const targetStaff = await prisma.staff.findFirst({
      where: { id: targetStaffId, tenant_id: tenantId, active: true },
      select: { id: true, name: true, role: true },
    });

    if (!targetStaff) {
      return { success: false, error: 'Staff terapis yang dituju tidak ditemukan atau tidak aktif.' };
    }

    const currentRes = await prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { assigned_staff_id: true, status: true, tenant_id: true },
    });
    if (!currentRes) {
      return { success: false, error: 'Reservasi tidak ditemukan.' };
    }
    if ((currentRes as any).tenant_id !== tenantId) {
      return { success: false, error: 'Reservasi tidak ditemukan untuk klinik ini.' };
    }
    const currentStatus = ((currentRes as any).status || '').toLowerCase();
    if (['completed', 'cancelled', 'rejected'].includes(currentStatus)) {
      return {
        success: false,
        error: `Jadwal berstatus "${(currentRes as any).status}" tidak dapat didelegasikan ulang.`,
      };
    }
    const oldAssignedStaffId: string | null = (currentRes as any).assigned_staff_id || null;

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

    try {
      const { staffNotificationService } = await import('../staff-notification.service');
      await staffNotificationService.sendReservationAssignmentNotification(reservationId, targetStaffId);
      staffNotificationService.triggerPreVisitBriefIfImminent(reservationId, currentRes.tenant_id || DEFAULT_TENANT_ID);
      if (oldAssignedStaffId && oldAssignedStaffId !== targetStaffId) {
        try { await staffNotificationService.sendTaskUnassignedNotification(reservationId, oldAssignedStaffId, targetStaff.name as string); } catch (_) {}
      }
    } catch (notifErr: any) {
      console.warn('[STAFF RESERVATION] Warning: could not send reassign notification:', notifErr.message);
    }

    try {
      const { auditService } = await import('../audit.service');
      await auditService.logAdminAction({
        apiKey: 'STAFF_SESSION',
        adminIdentity: supervisorStaffId,
        action: 'STAFF_REASSIGN_TASK',
        targetId: reservationId,
        payload: { previousStaffId: oldAssignedStaffId, newStaffId: targetStaffId },
        tenantId,
      });
    } catch (_) {}

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
export async function updateCustomerLocation(params: {
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
}): Promise<{ success: boolean; data?: any; error?: string }> {
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

    let distanceKm = customer.distance_km;
    const targetLat = lat ?? customer.lat;
    const targetLng = lng ?? customer.lng;

    let newOngkir: number | null = null;
    if (targetLat != null && targetLng != null) {
      if (targetLat < -12 || targetLat > 7 || targetLng < 94 || targetLng > 142) {
        return { success: false, error: 'Koordinat GPS di luar wilayah Indonesia atau tidak valid.' };
      }

      const clinicCoords = { lat: clinicConfig.lat, lng: clinicConfig.lng };
      const { deliveryService } = await import('../delivery.service');
      const deliveryResult = await deliveryService.calculateDelivery(
        { lat: targetLat, lng: targetLng },
        clinicCoords,
        tenantId
      );
      distanceKm = deliveryResult.distanceKm;
      newOngkir = deliveryResult.promoPrice;

      const MAX_ALLOWED_DISTANCE_KM = 45;
      if (distanceKm > MAX_ALLOWED_DISTANCE_KM) {
        return {
          success: false,
          error: `Titik GPS terdeteksi berjarak ${distanceKm.toFixed(1)} km dari klinik (melenceng jauh di luar area jangkauan maksimal ${MAX_ALLOWED_DISTANCE_KM} km). Pastikan Anda sedang berada di lokasi rumah pasien.`,
        };
      }

      if (customer.distance_km && Math.abs(distanceKm - customer.distance_km) > 25) {
        return {
          success: false,
          error: `Titik GPS melenceng terlalu jauh (${Math.abs(distanceKm - customer.distance_km).toFixed(1)} km selisih) dari estimasi area ${customer.kelurahan || 'pasien'}. Pembaruan lokasi ditolak untuk mencegah salah alamat.`,
        };
      }
    }

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

        const isPreviousCoordEstimated =
          (customer as any).location_source === 'estimated_area' ||
          (customer.preferences as any)?.location_source === 'geocoding' ||
          (customer as any).share_location_sent === false;
        if (diffFromOriginalKm > 1.0 && !isPreviousCoordEstimated) {
          shouldUpdatePrimaryCoords = false;
          const gpsTag = `[📍 GPS Lapangan: ${lat.toFixed(6)}, ${lng.toFixed(6)} (+${diffFromOriginalKm.toFixed(1)}km)]`;
          finalLandmark = baseLandmark ? `${baseLandmark} ${gpsTag}` : gpsTag;
        } else {
          shouldUpdatePrimaryCoords = true;
        }
      } else {
        shouldUpdatePrimaryCoords = true;
      }
    }

    let housePhotoUrl: string | null = (customer.preferences as any)?.house_photo_url || null;

    if (housePhotoB64 && housePhotoB64.startsWith('data:image/')) {
      const { mediaService } = await import('../media.service');
      const { getBrandIdentityAsync } = await import('../../config/brand');
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
    const newHistoryEntry = (targetLat != null && targetLng != null && distanceKm != null)
      ? {
          source: isPrimaryUpdated ? 'manual_staff' : 'FIELD_STAFF_GPS',
          raw_source: 'FIELD_STAFF_GPS',
          sourceLabel: isPrimaryUpdated ? STAFF_VERIFIED_LOCATION_LABEL : '📍 GPS Lapangan (Diverged)',
          lat: targetLat,
          lng: targetLng,
          staffName: staffName || 'Staff',
          distanceKm: typeof distanceKm === 'number' ? Number(distanceKm.toFixed(2)) : null,
          ongkir: newOngkir,
          ...(typeof accuracyM === 'number' ? { accuracyM: Math.round(accuracyM) } : {}),
          updatedAt: new Date().toISOString(),
        }
      : null;
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
      ...(typeof accuracyM === 'number' ? { location_accuracy_m: accuracyM } : {}),
      ...(isPrimaryUpdated
        ? {
            location_source: 'manual_staff',
            location_source_label: STAFF_VERIFIED_LOCATION_LABEL,
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

    const { auditService } = await import('../audit.service');
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

    const coordsUpdated = shouldUpdatePrimaryCoords && lat != null && lng != null;

    try {
      const { googleContactsService } = await import('../google-contacts.service');
      googleContactsService.syncCustomer(tenantId, customer.id, { trigger: 'chat' }).catch(() => {});
    } catch {}

    try {
      const { getLiveChatHub } = await import('../live-chat-hub.service');
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
          diverged: diffFromOriginalKm != null && diffFromOriginalKm > 1.0,
          diffKm: diffFromOriginalKm != null ? Number(diffFromOriginalKm.toFixed(2)) : null,
          distanceKm: updatedCustomer.distance_km,
          ongkir: updatedCustomer.ongkir,
          landmark: finalLandmark,
          housePhotoUrl,
          updatedAt: new Date().toISOString(),
        },
      }).catch(() => {});
    } catch {}

    try {
      const { syncActiveReservationsForCustomer } = await import('../reservation-address-sync.service');
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
        diverged: diffFromOriginalKm != null && diffFromOriginalKm > 1.0,
        diffKm: diffFromOriginalKm != null ? Number(diffFromOriginalKm.toFixed(2)) : null,
        message: (() => {
          if (diffFromOriginalKm != null && diffFromOriginalKm > 1.0) {
            return `Titik GPS lapangan berselisih ${diffFromOriginalKm.toFixed(1)} km (> 1 km). Koordinat utama customer dipertahankan, koordinat lapangan dicatat pada panduan ancer-ancer.`;
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

/**
 * Mencatat waktu kedatangan bidan di depan rumah/lokasi pasien (ARRIVED).
 * Mengirim pesan cepat WhatsApp ke pasien secara otomatis dan mengupdate arrived_at di database.
 */
export async function recordArrival(params: {
  reservationId: string;
  staffId: string;
  tenantId: string;
  staffName?: string;
  isSupervisor?: boolean;
  skipWhatsApp?: boolean;
}): Promise<{ success: boolean; data?: any; error?: string }> {
  const { reservationId, staffId, tenantId, staffName = 'Bidan Terapis', isSupervisor = false, skipWhatsApp = false } = params;

  try {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        customer: {
          include: {
            conversations: {
              where: { tenant_id: tenantId },
              orderBy: { updated_at: 'desc' },
              take: 1,
            },
          },
        },
        assigned_staff: true,
      },
    });

    if (!reservation) {
      return { success: false, error: 'Reservasi tidak ditemukan.' };
    }

    if ((reservation as any).tenant_id !== tenantId) {
      return { success: false, error: 'Reservasi tidak ditemukan.' };
    }

    if (!isSupervisor) {
      const assigned = (reservation as any).assigned_staff_id;
      if (!assigned || assigned !== staffId) {
        return {
          success: false,
          error: 'Anda tidak memiliki hak akses untuk jadwal terapis lain.',
        };
      }
    }

    const statusLower = String((reservation as any).status || '').toLowerCase();
    if (['completed', 'cancelled', 'rejected'].includes(statusLower)) {
      return {
        success: false,
        error: `Kedatangan tidak dapat dicatat untuk jadwal berstatus "${(reservation as any).status}".`,
      };
    }

    const now = new Date();

    const otwMs = (reservation as any).otw_sent_at
      ? new Date((reservation as any).otw_sent_at).getTime()
      : 0;
    const isRapid = otwMs > 0 && now.getTime() - otwMs < 3 * 60 * 1000;

    await prisma.reservation.update({
      where: { id: reservationId },
      data: {
        arrived_at: now,
      },
    });

    const conversation = (reservation as any).customer?.conversations?.[0];
    const rawPatientName = (reservation as any).customer?.name || 'Bunda';
    const therapistName = (reservation as any).assigned_staff?.name || staffName;

    let waResult: any = null;
    if (conversation && !isRapid && !skipWhatsApp) {
      const { liveChatService } = await import('../live-chat.service');
      const arrivalText = await getArrivalMessageText(tenantId, {
        patientName: rawPatientName,
        therapistName,
      });
      waResult = await liveChatService.sendAdminReply({
        conversationId: conversation.id,
        text: arrivalText,
        tenantId,
        adminName: therapistName,
        forceEscalate: true,
      });
    }

    const { auditService } = await import('../audit.service');
    await auditService.logAdminAction({
      apiKey: 'STAFF_SESSION',
      adminIdentity: staffName,
      action: 'STAFF_ARRIVED',
      targetId: reservationId,
      payload: {
        conversationId: conversation?.id || null,
        arrivedAt: now.toISOString(),
        arrivalWaSuppressed: isRapid || skipWhatsApp,
        otwSentAt: (reservation as any).otw_sent_at ? new Date((reservation as any).otw_sent_at).toISOString() : null,
      },
      tenantId,
    });

    return {
      success: true,
      data: {
        reservationId,
        arrivedAt: now,
        waResult,
        arrivalWaSuppressed: isRapid || skipWhatsApp,
      },
    };
  } catch (err: any) {
    console.error('[STAFF RESERVATION] Error recording arrival:', err.message);
    return { success: false, error: `Gagal mencatat kedatangan: ${err.message}` };
  }
}

/**
 * Menandai tindakan kunjungan telah selesai dilakukan oleh terapis di lapangan (COMPLETED).
 */
export async function completeTask(params: {
  reservationId: string;
  staffId: string;
  tenantId: string;
  staffName?: string;
  isSupervisor?: boolean;
  forceUnpaid?: boolean;
}): Promise<{
  success: boolean;
  data?: any;
  error?: string;
  requiresPayment?: boolean;
  paymentStatus?: 'LUNAS' | 'TAGIH_DI_TEMPAT';
}> {
  const {
    reservationId,
    staffId,
    tenantId,
    staffName = 'Bidan Terapis',
    isSupervisor = false,
    forceUnpaid = false,
  } = params;
  try {
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
    });

    if (!reservation || reservation.tenant_id !== tenantId) {
      return { success: false, error: 'Reservasi tidak ditemukan.' };
    }

    if (!isSupervisor && (!reservation.assigned_staff_id || reservation.assigned_staff_id !== staffId)) {
      return { success: false, error: 'Anda tidak memiliki akses untuk menyelesaikan jadwal terapis lain atau reservasi belum memiliki bidan.' };
    }

    if (reservation.status === 'cancelled' || reservation.status === 'rejected') {
      return { success: false, error: `Reservasi berstatus ${reservation.status} tidak dapat diselesaikan.` };
    }

    const isPaid = !!reservation.purchase_occurred_at;
    if (!isPaid && !forceUnpaid) {
      return {
        success: false,
        requiresPayment: true,
        paymentStatus: 'TAGIH_DI_TEMPAT',
        error: 'Pembayaran pasien belum dicatat. Catat pembayaran terlebih dahulu sebelum menyelesaikan kunjungan.',
      };
    }

    let updated: any;
    try {
      const applied = await reservationStatusService.applyTransition(reservation, {
        to: 'completed',
        allowUnassignedStaff: isSupervisor,
      });
      if (!applied.ok) {
        return { success: false, error: 'Reservasi belum memiliki bidan yang ditugaskan.' };
      }
      updated = applied.reservation;
    } catch (err: any) {
      if (err instanceof InvalidTransitionError) {
        return { success: false, error: `Transisi status tidak valid: ${err.message}` };
      }
      if (err instanceof PrematureCompletionError) {
        return { success: false, error: err.message };
      }
      throw err;
    }

    try {
      const { reservationLifecycleService } = await import('../reservation-lifecycle.service');
      if (reservation.booking_date) {
        await reservationLifecycleService.onReservationCompleted({
          customerId: reservation.customer_id,
          reservationId: reservation.id,
          bookingDate: reservation.booking_date,
          treatmentCategory: reservation.treatment_category,
          tenantId,
        });
      } else {
        console.warn(`[STAFF RESERVATION] completeTask: reservasi ${reservation.id} completed tanpa booking_date, sheets sync dilewati`);
      }
    } catch (lcErr: any) {
      console.warn('[STAFF RESERVATION] completeTask lifecycle warning:', lcErr?.message);
    }

    const { auditService } = await import('../audit.service');
    const completionAuditPayload: Record<string, unknown> = {};
    if (!isPaid && forceUnpaid) {
      completionAuditPayload.forcedUnpaid = true;
      completionAuditPayload.paymentStatus = 'TAGIH_DI_TEMPAT';
    }
    if (isSupervisor && !reservation.assigned_staff_id) {
      completionAuditPayload.supervisorOverrideUnassigned = true;
      completionAuditPayload.overrideBy = staffId;
    }

    await auditService.logAdminAction({
      apiKey: 'STAFF_SESSION',
      adminIdentity: staffName,
      action: !isPaid && forceUnpaid ? 'STAFF_COMPLETE_VISIT_UNPAID' : 'STAFF_COMPLETE_VISIT',
      targetId: reservationId,
      tenantId,
      ...(Object.keys(completionAuditPayload).length > 0
        ? { payload: completionAuditPayload }
        : {}),
    });

    try {
      const { getLiveChatHub } = await import('../live-chat-hub.service');
      getLiveChatHub().publish({
        type: 'staff.task_completed',
        tenantId,
        payload: {
          reservationId,
          staffId,
          staffName,
          customerId: reservation.customer_id,
          completedAt: new Date().toISOString(),
        },
      }).catch(() => {});
    } catch {}

    return { success: true, data: updated };
  } catch (err: any) {
    console.error('[STAFF RESERVATION] Error completing task:', err.message);
    return { success: false, error: `Gagal menyelesaikan kunjungan: ${err.message}` };
  }
}
