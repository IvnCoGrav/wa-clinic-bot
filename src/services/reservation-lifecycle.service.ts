import { prisma } from '../db/client';
import { wahaClient } from '../integrations/waha/client';
import { BabyDetail } from '../utils/reservation-text-parser';

/**
 * ReservationLifecycleService — fungsi sentral untuk side-effect pasca-create reservasi.
 *
 * Mengumpulkan SEMUA aksi yang harus terjadi setelah sebuah reservasi berhasil dibuat
 * (dari chat customer, parse admin, maupun create manual admin):
 *   1. followUpService.onReservationCreated — scheduling/penjadwalan follow-up
 *   2. childService.upsertChildrenFromBabies — persist entitas bayi/anak
 *   3. Label lifecycle (Task 4) — 'pending payment' / 'repeat' / hapus 'new customer'
 *
 * Setiap efek bersifat best-effort: kegagalan salah satu tidak membatalkan yang lain,
 * dan tidak pernah melempar error ke pemanggil (agar operasi inti tetap sukses).
 */
export interface OnReservationCreatedParams {
  customerId: string;
  reservationId: string;
  tenantId: string;
  chatId: string; // format phone@c.us
  babies?: BabyDetail[];
  customerName?: string;
  kecamatan?: string;
  kota?: string;
  kelurahan?: string;
  address?: string;
}

export class ReservationLifecycleService {
  public async onReservationCreated(params: OnReservationCreatedParams): Promise<void> {
    const { customerId, reservationId, tenantId, chatId, babies = [], customerName, kecamatan, kota, kelurahan } = params;

    // 0. Update nama customer & alamat dari form reservasi ke database (agar sinkron ke Google Contacts & CAPI)
    try {
      const { customerService } = await import('./customer.service');
      const targetName = (customerName || '').trim();
      if (targetName && targetName.length > 1) {
        const cleanName = targetName.replace(/^(?:bunda|ibu|mama|mom|mbak|mas|kak|kakak|ny|ny\.)\s+/i, '').trim();
        if (cleanName && !['bunda', 'ibu', 'mama', 'mom', 'mbak', 'mas', 'kak', 'kakak', 'pasien', 'customer', '-'].includes(cleanName.toLowerCase())) {
          const effectiveKec = (kecamatan || '').trim();
          const contactFormattedName = `Bunda ${cleanName}${effectiveKec ? ` ${effectiveKec}` : ''}`.trim();
          await customerService.updateCustomerName(customerId, contactFormattedName, tenantId).catch(() => {});
        }
      }

      if (kecamatan || kota || kelurahan) {
        await customerService.updateCustomerLocation(customerId, {
          kecamatan: kecamatan?.trim() || undefined,
          kota: kota?.trim() || undefined,
          kelurahan: kelurahan?.trim() || undefined,
        }, tenantId).catch(() => {});
      }
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] updateCustomerName/Location failed:', err.message);
    }

    // 1. Follow-Up scheduling
    try {
      const { followUpService } = await import('./follow-up.service');
      await followUpService.onReservationCreated(customerId, reservationId, tenantId);
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] followUp.onReservationCreated failed:', err.message);
    }

    // 2. Persist child/baby entities (best-effort)
    try {
      const { childService } = await import('./child.service');
      await childService.upsertChildrenFromBabies({
        customerId,
        reservationId,
        tenantId,
        babies,
      });
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] childService.upsertChildrenFromBabies failed:', err.message);
    }

    // 3. Label lifecycle (Task 4) — hanya jika flag aktif
    if (process.env.ENABLE_LIFECYCLE_LABELS === 'true' && chatId) {
      await this.applyLifecycleLabels({ customerId, tenantId, chatId });
    }

    // 4. Google Contacts auto-sync (best-effort, berjalan setelah nama dan anak diperbarui)
    try {
      const { googleContactsService } = await import('./google-contacts.service');
      googleContactsService.syncCustomer(tenantId, customerId, { trigger: 'reservation' }).catch(() => {});
    } catch (err: any) {
      console.warn('[RESERVATION LIFECYCLE] googleContactsService.syncCustomer failed:', err?.message);
    }
  }

  /**
   * Terapkan label lifecycle pada chat:
   * - priorConfirmedCount > 0  → 'repeat'          (bukan 'pending payment')
   * - priorConfirmedCount === 0 → 'pending payment'
   * - selalu hapus 'new customer'
   * - TIDAK pernah melepas label 'legacy'
   * Semua best-effort (opsi label WA tidak pernah menggagalkan operasi inti).
   */
  private async applyLifecycleLabels(params: { customerId: string; tenantId: string; chatId: string }): Promise<void> {
    const { customerId, tenantId, chatId } = params;

    // Hitung reservasi confirmed/confirmed-sebelumnya milik customer (di luar reservasi barusan).
    let priorConfirmedCount = 0;
    try {
      priorConfirmedCount = await prisma.reservation.count({
        where: {
          customer_id: customerId,
          tenant_id: tenantId,
          status: 'confirmed',
        },
      });
    } catch (err: any) {
      // DB offline → default 0 (new customer path)
      console.warn('[LIFECYCLE LABEL] Could not count prior confirmed reservations:', err.message);
    }

    // Best-effort: satu operasi atomik (1x GET + 1x PUT) untuk semua perubahan label
    const remove: string[] = ['new customer'];
    const add: string[] = [];
    if (priorConfirmedCount > 0) {
      add.push('repeat');
      remove.push('pending payment');
    } else {
      add.push('pending payment');
    }
    wahaClient.batchUpdateLabels(chatId, { add, remove }).catch((err: any) =>
      console.warn('[LIFECYCLE LABEL] batchUpdateLabels failed:', err.message)
    );
    // Catatan: label 'legacy' dibiarkan tak tersentuh.
  }
}

export const reservationLifecycleService = new ReservationLifecycleService();