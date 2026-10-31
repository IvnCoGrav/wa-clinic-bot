/**
 * reservation-archive.service.ts
 *
 * Layanan tunggal (single seam) untuk pengarsipan, pemulihan, dan pembersihan
 * berkala reservasi klinik. Mencegah kehilangan data permanen akibat aksi hapus
 * staf/admin dan memastikan integritas data (LTV, audit log, follow-up).
 */

import { prisma } from '../db/client';
import { googleCalendarService } from './google-calendar.service';
import { staffNotificationService } from './staff-notification.service';
import { followUpService } from './follow-up.service';
import { customerService } from './customer.service';
import { auditService } from './audit.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';

export interface ArchiveReservationParams {
  id: string;
  tenantId: string;
  actor?: string;
  apiKey?: string;
  reason?: string;
  ipAddress?: string;
}

export interface RestoreReservationParams {
  archiveId: string;
  tenantId: string;
  actor?: string;
  apiKey?: string;
  ipAddress?: string;
}

export interface ListArchivesParams {
  tenantId: string;
  limit?: number;
  offset?: number;
  search?: string;
  includeRestored?: boolean;
}

export class ReservationArchiveService {
  /**
   * Menyusun snapshot JSONB lengkap dari reservasi sebelum dipindahkan ke arsip.
   */
  public async buildSnapshot(id: string, tenantId: string) {
    const reservation = await prisma.reservation.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        customer: true,
        items: true,
        follow_ups: true,
        children: true,
        assigned_staff: true,
      },
    });

    if (!reservation) {
      return null;
    }

    return {
      schemaVersion: 1,
      reservation: {
        id: reservation.id,
        tenant_id: reservation.tenant_id,
        customer_id: reservation.customer_id,
        treatment_category: reservation.treatment_category,
        treatment_detail: reservation.treatment_detail,
        booking_date: reservation.booking_date,
        status: reservation.status,
        raw_text: reservation.raw_text,
        request_id: reservation.request_id,
        assigned_staff_id: reservation.assigned_staff_id,
        purchase_value: reservation.purchase_value,
        delivery_fee: reservation.delivery_fee,
        discount_amount: reservation.discount_amount,
        payment_method: reservation.payment_method,
        proof_url: reservation.proof_url,
        receipt_reference: reservation.receipt_reference,
        receipt_amount: reservation.receipt_amount,
        is_repeat_order: reservation.is_repeat_order,
        customer_address_id: reservation.customer_address_id,
        created_at: reservation.created_at,
        updated_at: reservation.updated_at,
      },
      customer: reservation.customer
        ? {
            id: reservation.customer.id,
            name: reservation.customer.name,
            phone: reservation.customer.phone,
            kelurahan: reservation.customer.kelurahan,
            kecamatan: reservation.customer.kecamatan,
            kota: reservation.customer.kota,
          }
        : null,
      items: (reservation.items || []).map((it) => ({
        id: it.id,
        tenant_id: it.tenant_id,
        service_id: it.service_id,
        custom_name: it.custom_name,
        price: it.price,
        duration_minutes: it.duration_minutes,
      })),
      children: (reservation.children || []).map((ch) => ({
        id: ch.id,
        name: ch.name,
      })),
      followUps: (reservation.follow_ups || []).map((f) => ({
        id: f.id,
        stage: f.stage,
        status: f.status,
        scheduled_at: f.scheduled_at,
      })),
    };
  }

  /**
   * Mengarsipkan reservasi secara aman:
   * 1. Menjalankan efek samping eksternal (Google Calendar, Notifikasi Staf)
   * 2. Transaksi atomic: simpan arsip JSONB -> unlink children -> delete row reservasi
   * 3. Efek pasca-transaksi: batalkan follow-up, hitung ulang LTV, log audit detail
   */
  public async archiveReservation(params: ArchiveReservationParams) {
    const { id, tenantId, actor, apiKey, reason, ipAddress } = params;

    const existing = await prisma.reservation.findFirst({
      where: { id, tenant_id: tenantId },
      include: { customer: true, items: true, follow_ups: true, children: true },
    });

    if (!existing) {
      throw new Error('Reservation not found');
    }

    // 1. Batalkan event di Google Calendar jika ada (sebelum transaksi)
    if (existing.google_calendar_event_id) {
      try {
        await googleCalendarService.deleteEvent(existing.google_calendar_event_id);
      } catch (err: any) {
        console.error('[ArchiveService] Google Calendar Event deletion failed:', err?.message);
      }
    }

    // 2. Beri notifikasi ke staf yang ditugaskan jika ada (sebelum data dihapus dari tabel utama)
    if (existing.assigned_staff_id) {
      try {
        await staffNotificationService.sendReservationCancelledNotification(
          id,
          existing.assigned_staff_id,
          reason || 'Dibatalkan dan dipindahkan ke arsip'
        );
      } catch (err: any) {
        console.warn('[ArchiveService] Gagal mengirim notifikasi pembatalan ke staf:', err?.message);
      }
    }

    // Bangun snapshot
    const snapshot = await this.buildSnapshot(id, tenantId);
    if (!snapshot) {
      throw new Error('Gagal membangun snapshot reservasi');
    }

    const retentionDays = parseInt(process.env.RESERVATION_ARCHIVE_RETENTION_DAYS || '60', 10);
    const restoreUntil = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

    // 3. Jalankan transaksi database
    const archiveRecord = await prisma.$transaction(async (tx) => {
      // Simpan ke tabel arsip
      const archive = await tx.reservationArchive.create({
        data: {
          tenant_id: tenantId,
          reservation_id: existing.id,
          customer_id: existing.customer_id,
          customer_phone: existing.customer?.phone || null,
          customer_name: existing.customer?.name || null,
          booking_date: existing.booking_date,
          status: existing.status,
          treatment_detail: existing.treatment_detail,
          purchase_value: existing.purchase_value,
          reason: reason || null,
          archived_by: actor || null,
          archived_at: new Date(),
          restore_until: restoreUntil,
          payload: snapshot as any,
        },
      });

      // Unlink relasi anak dari tabel reservasi yang dihapus
      await tx.child.updateMany({
        where: { reservation_id: id },
        data: { reservation_id: null },
      });

      // Hapus baris reservasi asli
      await tx.reservation.delete({
        where: { id },
      });

      return archive;
    });

    // 4. Efek pasca transaksi
    try {
      await followUpService.onReservationCancelled(id, existing.tenant_id || tenantId);
    } catch (_) {}

    await customerService
      .recalculateCustomerLtv(existing.customer_id, existing.tenant_id || tenantId)
      .catch(() => {});

    await auditService.logAdminAction({
      apiKey: apiKey || 'ADMIN',
      adminIdentity: actor || 'ADMIN_MANUAL',
      action: 'ARCHIVE_RESERVATION',
      targetId: id,
      payload: {
        archiveId: archiveRecord.id,
        reservationId: id,
        customerId: existing.customer_id,
        customerName: existing.customer?.name || null,
        customerPhone: existing.customer?.phone || null,
        treatmentDetail: existing.treatment_detail,
        purchaseValue: existing.purchase_value,
        bookingDate: existing.booking_date,
        reason: reason || null,
        restoreUntil,
      },
      ipAddress,
    });

    return {
      success: true,
      archiveId: archiveRecord.id,
      restoreUntil,
      message: 'Reservasi berhasil diarsipkan.',
    };
  }

  /**
   * Memulihkan reservasi dari arsip kembali ke tabel reservations.
   */
  public async restoreReservation(params: RestoreReservationParams) {
    const { archiveId, tenantId, actor, apiKey, ipAddress } = params;

    const archive = await prisma.reservationArchive.findFirst({
      where: {
        id: archiveId,
        tenant_id: tenantId,
      },
    });

    if (!archive) {
      throw new Error('Arsip reservasi tidak ditemukan.');
    }

    if (archive.restored_at) {
      throw new Error('Reservasi ini sudah pernah dipulihkan sebelumnya.');
    }

    if (new Date(archive.restore_until).getTime() < Date.now()) {
      throw new Error('Masa retensi arsip telah habis (kedaluwarsa). Reservasi tidak dapat dipulihkan.');
    }

    const payload: any = typeof archive.payload === 'string' ? JSON.parse(archive.payload) : archive.payload;
    const resData = payload.reservation;

    if (!resData || !resData.id) {
      throw new Error('Format snapshot arsip tidak valid.');
    }

    // Cek apakah reservasi sudah ada di tabel reservations (idempotency)
    const existingActive = await prisma.reservation.findFirst({
      where: { id: resData.id },
    });
    if (existingActive) {
      throw new Error('Reservasi dengan ID ini sudah aktif di database.');
    }

    await prisma.$transaction(async (tx) => {
      // 1. Pulihkan data reservasi
      await tx.reservation.create({
        data: {
          id: resData.id,
          tenant_id: resData.tenant_id || tenantId,
          customer_id: resData.customer_id,
          treatment_category: resData.treatment_category,
          treatment_detail: resData.treatment_detail,
          booking_date: resData.booking_date ? new Date(resData.booking_date) : null,
          status: resData.status || 'hold',
          raw_text: resData.raw_text,
          request_id: resData.request_id || null,
          assigned_staff_id: resData.assigned_staff_id || null,
          purchase_value: resData.purchase_value || null,
          delivery_fee: resData.delivery_fee || null,
          discount_amount: resData.discount_amount || null,
          payment_method: resData.payment_method || null,
          proof_url: resData.proof_url || null,
          receipt_reference: resData.receipt_reference || null,
          receipt_amount: resData.receipt_amount || null,
          is_repeat_order: Boolean(resData.is_repeat_order),
          customer_address_id: resData.customer_address_id || null,
          created_at: resData.created_at ? new Date(resData.created_at) : new Date(),
        },
      });

      // 2. Pulihkan items jika ada
      if (Array.isArray(payload.items) && payload.items.length > 0) {
        for (const it of payload.items) {
          try {
            await tx.reservationItem.create({
              data: {
                id: it.id,
                tenant_id: it.tenant_id || tenantId,
                reservation_id: resData.id,
                service_id: it.service_id || null,
                custom_name: it.custom_name || it.treatment_name || 'Layanan',
                price: it.price || 0,
                duration_minutes: it.duration_minutes || null,
              },
            });
          } catch (_) {}
        }
      }

      // 3. Relink relasi anak
      if (Array.isArray(payload.children) && payload.children.length > 0) {
        const childIds = payload.children.map((c: any) => c.id).filter(Boolean);
        if (childIds.length > 0) {
          try {
            await tx.child.updateMany({
              where: { id: { in: childIds } },
              data: { reservation_id: resData.id },
            });
          } catch (_) {}
        }
      }

      // 4. Tandai arsip sebagai telah dipulihkan
      await tx.reservationArchive.update({
        where: { id: archive.id },
        data: { restored_at: new Date() },
      });
    });

    // 5. Hitung ulang LTV
    await customerService
      .recalculateCustomerLtv(resData.customer_id, resData.tenant_id || tenantId)
      .catch(() => {});

    // 6. Log audit
    await auditService.logAdminAction({
      apiKey: apiKey || 'ADMIN',
      adminIdentity: actor || 'ADMIN_MANUAL',
      action: 'RESTORE_RESERVATION_FROM_ARCHIVE',
      targetId: resData.id,
      payload: {
        archiveId: archive.id,
        reservationId: resData.id,
        customerId: resData.customer_id,
        restoredBy: actor,
      },
      ipAddress,
    });

    return {
      success: true,
      reservationId: resData.id,
      message: 'Reservasi berhasil dipulihkan dari arsip.',
    };
  }

  /**
   * Mengambil daftar arsip reservasi berdasarkan tenant dan parameter filter.
   */
  public async listArchives(params: ListArchivesParams) {
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const offset = Math.max(0, params.offset || 0);

    const where: any = {
      tenant_id: params.tenantId || DEFAULT_TENANT_ID,
    };

    if (!params.includeRestored) {
      where.restored_at = null;
    }

    if (params.search && params.search.trim()) {
      const q = params.search.trim();
      where.OR = [
        { customer_name: { contains: q, mode: 'insensitive' } },
        { customer_phone: { contains: q } },
        { treatment_detail: { contains: q, mode: 'insensitive' } },
        { reason: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.reservationArchive.count({ where }),
      prisma.reservationArchive.findMany({
        where,
        orderBy: { archived_at: 'desc' },
        skip: offset,
        take: limit,
      }),
    ]);

    return {
      total,
      items,
      limit,
      offset,
    };
  }

  /**
   * Menghapus arsip yang telah melewati tanggal restore_until (retensi habis).
   * Dijalankan secara otomatis oleh cron harian.
   */
  public async purgeExpired(tenantId?: string): Promise<number> {
    const where: any = {
      restore_until: { lt: new Date() },
      restored_at: null,
    };

    if (tenantId) {
      where.tenant_id = tenantId;
    }

    let totalPurged = 0;
    while (true) {
      const expiredBatch = await prisma.reservationArchive.findMany({
        where,
        select: { id: true },
        take: 500,
      });

      if (expiredBatch.length === 0) break;

      const ids = expiredBatch.map((r) => r.id);
      const res = await prisma.reservationArchive.deleteMany({
        where: { id: { in: ids } },
      });

      totalPurged += res.count;
      if (res.count < 500) break;
    }

    if (totalPurged > 0) {
      await auditService
        .logAdminAction({
          apiKey: 'SYSTEM_CRON',
          adminIdentity: 'SYSTEM_CRON',
          action: 'PURGE_RESERVATION_ARCHIVE',
          targetId: 'reservation_archives',
          payload: { purgedCount: totalPurged, tenantId: tenantId || 'ALL' },
        })
        .catch(() => {});
    }

    return totalPurged;
  }
}

export const reservationArchiveService = new ReservationArchiveService();
