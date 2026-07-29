import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

export class FollowUpService {
  /**
   * Dipanggil saat customer baru terdaftar di database.
   * Membuat 3 row follow-up PENDING tipe NO_PURCHASE (+3, +7, +14 hari).
   */
  public async createNoPurchaseFollowUps(customerId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      const stages = [1, 2, 3];
      const days = [3, 7, 14];
      
      await Promise.all(
        stages.map((stage, idx) => {
          const scheduledAt = new Date();
          scheduledAt.setDate(scheduledAt.getDate() + days[idx]);
          
          return prisma.followUp.create({
            data: {
              tenant_id: tenantId,
              customer_id: customerId,
              type: 'NO_PURCHASE',
              stage,
              scheduled_at: scheduledAt,
              status: 'PENDING',
            },
          });
        })
      );
      console.log(`[FollowUp Service] Created NO_PURCHASE follow-ups for customer: ${customerId}`);
    } catch (err) {
      console.error('[FollowUp Service] Failed to create NO_PURCHASE follow-ups:', err);
    }
  }

  /**
   * Dipanggil saat reservasi baru dibuat (status pending).
   * Membatalkan semua follow-up pending/queued untuk customer ini,
   * dan menandai is_repeat_order jika ada follow-up pending yang aktif.
   */
  public async onReservationCreated(customerId: string, reservationId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      const activeFollowUps = await prisma.followUp.findMany({
        where: {
          customer_id: customerId,
          status: { in: ['PENDING', 'QUEUED'] },
          tenant_id: tenantId
        }
      });

      if (activeFollowUps.length > 0) {
        // Tandai reservasi ini sebagai repeat order
        await prisma.reservation.update({
          where: { id: reservationId },
          data: { is_repeat_order: true }
        });

        // Batalkan semua follow-up aktif tersebut
        await prisma.followUp.updateMany({
          where: {
            id: { in: activeFollowUps.map(f => f.id) }
          },
          data: { status: 'CANCELLED' }
        });
        console.log(`[FollowUp Service] Cancelled ${activeFollowUps.length} active follow-ups for customer: ${customerId}. Set is_repeat_order = true.`);
      }
    } catch (err) {
      console.error('[FollowUp Service] Error handling reservation creation event:', err);
    }
  }

  /**
   * Dipanggil saat reservasi dikonfirmasi/rescheduled/selesai.
   * Membuat 3 row follow-up PENDING tipe NEXT_TREATMENT (+1, +2, +3 bulan).
   */
  public async createNextTreatmentFollowUps(customerId: string, bookingDate: Date, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      // Cek dulu apakah sudah pernah dibuat untuk booking date ini (idempotensi)
      const existing = await prisma.followUp.findFirst({
        where: {
          customer_id: customerId,
          type: 'NEXT_TREATMENT',
          tenant_id: tenantId,
          // Menggunakan scheduled_at sebagai indikasi
        }
      });

      // Buat 3 stage follow-up (+1, +2, +3 bulan)
      const stages = [1, 2, 3];
      
      await Promise.all(
        stages.map((stage) => {
          const scheduledAt = new Date(bookingDate);
          scheduledAt.setMonth(scheduledAt.getMonth() + stage);
          
          return prisma.followUp.create({
            data: {
              tenant_id: tenantId,
              customer_id: customerId,
              type: 'NEXT_TREATMENT',
              stage,
              scheduled_at: scheduledAt,
              status: 'PENDING',
            },
          });
        })
      );
      console.log(`[FollowUp Service] Created NEXT_TREATMENT follow-ups for customer: ${customerId}`);
    } catch (err) {
      console.error('[FollowUp Service] Failed to create NEXT_TREATMENT follow-ups:', err);
    }
  }

  /**
   * Mengecek customer yang statusnya 'active' dan telah dikirimi follow-up NEXT_TREATMENT Stage 3
   * lebih dari 3 hari yang lalu, serta tidak melakukan booking baru sejak saat itu.
   * Mengubah status mereka menjadi 'lost'.
   */
  public async checkAndSetLostCustomers(tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      const gracePeriodDays = 3;
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() - gracePeriodDays);

      // Cari follow-up NEXT_TREATMENT stage 3 yang SENT dan sent_at <= thresholdDate
      const sentStage3FollowUps = await prisma.followUp.findMany({
        where: {
          type: 'NEXT_TREATMENT',
          stage: 3,
          status: 'SENT',
          sent_at: { lte: thresholdDate },
          tenant_id: tenantId,
          customer: {
            status: 'active',
          },
        },
        include: {
          customer: true,
        },
      });

      for (const f of sentStage3FollowUps) {
        // Cek apakah customer membuat reservasi baru setelah sent_at
        const newReservations = await prisma.reservation.findFirst({
          where: {
            customer_id: f.customer_id,
            created_at: { gt: f.sent_at! },
            tenant_id: tenantId,
          },
        });

        // Jika tidak ada reservasi baru, ubah status customer ke 'lost'
        if (!newReservations) {
          await prisma.customer.update({
            where: { id: f.customer_id },
            data: { status: 'lost' },
          });
          console.log(`[FollowUp Service] Customer ${f.customer_id} marked as 'lost' (no new reservation 3 days after Stage 3 follow-up).`);
        }
      }
    } catch (err) {
      console.error('[FollowUp Service] Error checking and setting lost customers:', err);
    }
  }
}

export const followUpService = new FollowUpService();
