import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getRollingFollowUpMessage, FollowUpTemplateType, FOLLOWUP_ROLLING_TEMPLATES, getRollingVariant, getWibDateKey } from '../config/followup-templates';
import { typingService } from './typing.service';
import { resolveGatewayForTenant } from '../integrations/whatsapp/factory';
import { wabaTemplateService } from './waba-template.service';
import { wabaConsentService } from './waba-consent.service';
import { parsePositiveInt } from '../utils/env-numeric';
import { isDummyOrTestContact } from '../utils/dummy-filter';
import { hasBypassLabel, checkCustomerBypass, buildNonBypassCustomerWhere, BYPASS_LABEL_PRISMA_IN } from '../utils/customer-bypass';
import {
  sanitizeCustomerNameForGreeting,
  formatGreetingBunda,
  formatBabyNamesForGreeting,
} from '../utils/name-sanitizer';

// Parameter batch/throttle follow-up â€” env-drivable (Fase 4.3 docs/HARDCODED_FIX_PLAN.md)
const FOLLOWUP_BATCH_LIMIT = parsePositiveInt(process.env.FOLLOWUP_BATCH_LIMIT, 20);
const FOLLOWUP_THROTTLE_BASE_MS = parsePositiveInt(process.env.FOLLOWUP_THROTTLE_BASE_MS, 1500);
const LOST_CUSTOMER_GRACE_DAYS = parsePositiveInt(process.env.LOST_CUSTOMER_GRACE_DAYS, 3);
const FOLLOWUP_RECENT_CHAT_COOLDOWN_HOURS = parsePositiveInt(process.env.FOLLOWUP_RECENT_CHAT_COOLDOWN_HOURS, 72);

// WINBACK_60D (re-engagement pelanggan dormant). Ambang dormansi & cooldown
// memakai basis last_message_at (termasuk outbound) supaya WINBACK tidak
// menyerobot rangkaian NEXT_TREATMENT yang masih berjalan (hingga +3 bulan).
const WINBACK_DORMANT_DAYS = parsePositiveInt(process.env.WINBACK_DORMANT_DAYS, 60);
const WINBACK_ENQUEUE_LIMIT = parsePositiveInt(process.env.WINBACK_ENQUEUE_LIMIT, 10);
const WINBACK_LOST_GRACE_DAYS = parsePositiveInt(process.env.WINBACK_LOST_GRACE_DAYS, 7);

// Offset hari jadwal NO_PURCHASE per stage (stage 1, 2, 3 â†’ +3, +7, +14 hari).
export const NO_PURCHASE_STAGE_DAYS: readonly number[] = [3, 7, 14];

// Alasan pembatalan kanonis (cancel_reason) â€” single source of truth agar konsisten lintas titik lifecycle.
export const CANCEL_REASON = {
  MANUAL_ADMIN: 'Dibatalkan manual oleh Admin',
  BULK_ADMIN: 'Dibatalkan massal oleh Admin',
  RESERVATION_CREATED: 'Customer membuat reservasi baru',
  RESERVATION_CANCELLED: 'Reservasi terkait dibatalkan',
  HAS_ACTIVE_RESERVATION: 'Customer sudah memiliki reservasi aktif',
  INBOUND_HAS_RESERVATION: 'Customer sudah memiliki reservasi',
  OVERDUE_48H: 'Jadwal kadaluarsa (>48 jam)',
  BYPASS_LABEL: 'Nomor berlabel Skip/Admin CS',
  WABA_TEMPLATE_NOT_APPROVED: 'Template WABA belum disetujui',
  WABA_NO_MARKETING_CONSENT: 'Customer belum opt-in marketing',
  EXPIRED_PENDING: 'Antrean PENDING kadaluarsa (tidak disetujui sebelum akhir hari jadwal)',
  NON_SERIOUS_STAGE3: 'Pengingat hari ke-14 hanya untuk kontak serius (MQL/legacy)',
} as const;

// Prioritas Tipe Follow-Up: NEXT_TREATMENT (Prioritas 1) lebih diutamakan daripada NO_PURCHASE (Prioritas 2)
export const FOLLOWUP_TYPE_PRIORITY: Record<string, number> = {
  NEXT_TREATMENT: 1, // Prioritas #1: Pasien pasca treatment / repeat order bernilai tinggi LTV
  NO_PURCHASE: 2,    // Prioritas #2: Lead baru yang belum pernah purchase
  WINBACK_60D: 3,    // Prioritas #3: Re-engagement kontak dormant MQL/legacy (>60 hari)
  REMINDER_H1: 4,
  REVIEW_H1_BABY: 5,
  REVIEW_H1_MOMS: 6,
};

export class FollowUpService {
  /**
   * Mengambil semua template follow-up dari database (dengan fallback ke hardcode default).
   * Jika DB tidak punya record untuk (type, variant), pakai template default.
   */
  public async getAllTemplates(tenantId: string = DEFAULT_TENANT_ID): Promise<Array<{
    id: string | null;
    type: string;
    variant: number;
    text: string;
    isDefault: boolean;
  }>> {
    try {
      const dbTemplates = await prisma.followUpTemplate.findMany({
        where: { tenant_id: tenantId },
        orderBy: [{ type: 'asc' }, { variant: 'asc' }],
      });

      // Merge dengan default
      const result: Array<{ id: string | null; type: string; variant: number; text: string; isDefault: boolean }> = [];
      for (const [type, variants] of Object.entries(FOLLOWUP_ROLLING_TEMPLATES)) {
        variants.forEach((fn, idx) => {
          const db = dbTemplates.find((t) => t.type === type && t.variant === idx + 1);
          result.push({
            id: db?.id || null,
            type,
            variant: idx + 1,
            text: db?.text || fn({ name: '{name}', time: '{time}', babyName: '{babyName}' }),
            isDefault: !db,
          });
        });
      }
      return result;
    } catch (err) {
      console.error('[FollowUp Service] Failed to load templates from DB, using defaults:', err);
      return Object.entries(FOLLOWUP_ROLLING_TEMPLATES).flatMap(([type, variants]) =>
        variants.map((fn, idx) => ({
          id: null,
          type,
          variant: idx + 1,
          text: fn({ name: '{name}', time: '{time}', babyName: '{babyName}' }),
          isDefault: true,
        }))
      );
    }
  }

  /**
   * Menyimpan template custom (upsert) untuk type + variant tertentu.
   */
  public async saveTemplate(
    type: string,
    variant: number,
    text: string,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<void> {
    try {
      await prisma.followUpTemplate.upsert({
        where: {
          tenant_id_type_variant: { tenant_id: tenantId, type, variant },
        },
        update: { text, updated_at: new Date() },
        create: { tenant_id: tenantId, type, variant, text },
      });
      console.log(`[FollowUp Service] Saved template ${type} variant ${variant}.`);
    } catch (err) {
      console.error('[FollowUp Service] Failed to save template:', err);
      throw err;
    }
  }

  /**
   * Menghapus template custom (kembali ke default hardcode).
   */
  public async resetTemplate(type: string, variant: number, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      await prisma.followUpTemplate.deleteMany({
        where: { tenant_id: tenantId, type, variant },
      });
      console.log(`[FollowUp Service] Reset template ${type} variant ${variant} to default.`);
    } catch (err) {
      console.error('[FollowUp Service] Failed to reset template:', err);
    }
  }

  /**
   * Mengambil daftar antrian follow-up dengan pagination, filter, search, dan sorting.
   */
  public async listFollowUps(
    tenantId: string = DEFAULT_TENANT_ID,
    options: {
      status?: string;
      type?: string;
      search?: string;
      dateFilter?: string;
      page?: number;
      pageSize?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    } = {}
  ): Promise<{
    data: any[];
    pagination: {
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
  }> {
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize || 20));
    const skip = (page - 1) * pageSize;

    const where: any = {
      tenant_id: tenantId,
    };

    if (options.status && options.status !== 'all') {
      where.status = options.status;
    }

    if (options.type && options.type !== 'all') {
      where.type = options.type;
    }

    if (options.dateFilter && options.dateFilter !== 'all') {
      const now = new Date();
      const nowWib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
      const year = nowWib.getUTCFullYear();
      const month = nowWib.getUTCMonth();
      const date = nowWib.getUTCDate();

      // Start of today in WIB (00:00:00 WIB)
      const startOfTodayUtc = new Date(Date.UTC(year, month, date, 0, 0, 0) - 7 * 60 * 60 * 1000);
      // End of today in WIB (23:59:59.999 WIB)
      const endOfTodayUtc = new Date(Date.UTC(year, month, date, 23, 59, 59, 999) - 7 * 60 * 60 * 1000);

      if (options.dateFilter === 'upcoming') {
        where.scheduled_at = { gte: startOfTodayUtc };
      } else if (options.dateFilter === 'today') {
        where.scheduled_at = { gte: startOfTodayUtc, lte: endOfTodayUtc };
      } else if (options.dateFilter === 'this_week') {
        const dayOfWeek = nowWib.getUTCDay(); // 0 is Sunday
        const daysToSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
        const endOfWeekUtc = new Date(Date.UTC(year, month, date + daysToSunday, 23, 59, 59, 999) - 7 * 60 * 60 * 1000);
        where.scheduled_at = { gte: startOfTodayUtc, lte: endOfWeekUtc };
      } else if (options.dateFilter === 'this_month') {
        const endOfMonthUtc = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999) - 7 * 60 * 60 * 1000);
        where.scheduled_at = { gte: startOfTodayUtc, lte: endOfMonthUtc };
      } else if (options.dateFilter === 'overdue') {
        where.scheduled_at = { lt: startOfTodayUtc };
      }
    }

    if (options.search) {
      const q = options.search.trim();
      where.customer = {
        OR: [
          { phone: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
        ],
      };
    }

    const sortOrder = options.sortOrder === 'desc' ? 'desc' : 'asc';
    let orderBy: any[] = [];

    switch (options.sortBy) {
      case 'scheduled_at':
        orderBy = [{ scheduled_at: sortOrder }, { created_at: 'desc' }];
        break;
      case 'created_at':
        orderBy = [{ created_at: sortOrder }];
        break;
      case 'status':
        orderBy = [{ status: sortOrder }, { scheduled_at: 'asc' }];
        break;
      case 'type':
        orderBy = [{ type: sortOrder }, { stage: sortOrder }, { scheduled_at: 'asc' }];
        break;
      case 'customer_name':
      case 'name':
        orderBy = [{ customer: { name: sortOrder } }, { scheduled_at: 'asc' }];
        break;
      default:
        orderBy = options.sortBy
          ? [{ [options.sortBy]: sortOrder }]
          : [{ scheduled_at: sortOrder }, { created_at: 'desc' }];
        break;
    }

    try {
      const [total, data] = await Promise.all([
        prisma.followUp.count({ where }),
        prisma.followUp.findMany({
          where,
          select: {
            id: true,
            customer_id: true,
            type: true,
            stage: true,
            custom_text: true,
            scheduled_at: true,
            sent_at: true,
            status: true,
            cancel_reason: true,
            created_at: true,
            updated_at: true,
            customer: {
              select: {
                id: true,
                name: true,
                phone: true,
                kelurahan: true,
                kecamatan: true,
                kota: true,
                status: true,
                is_sandbox_test: true,
                conversations: {
                  select: {
                    id: true,
                    last_message_at: true,
                    is_human_handling: true,
                  },
                  take: 1,
                  orderBy: { last_message_at: 'desc' },
                },
              },
            },
            reservation: {
              select: {
                id: true,
                booking_date: true,
                treatment_category: true,
                treatment_detail: true,
              },
            },
          },
          orderBy,
          skip,
          take: pageSize,
        }),
      ]);

      const enriched = (data as any[]).map((item: any) => ({
        ...item,
        variant: getRollingVariant(item.customer_id || item.customer?.id || '', item.scheduled_at),
      }));
      return {
        data: enriched,
        pagination: {
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize) || 1,
        },
      };
    } catch (err: any) {
      console.error('[FollowUp Service] Failed to list follow-ups:', err.message);
      return {
        data: [],
        pagination: {
          total: 0,
          page: 1,
          pageSize,
          totalPages: 1,
        },
      };
    }
  }

  /**
   * Dipanggil saat customer baru terdaftar di database.
   * Membuat 3 row follow-up PENDING tipe NO_PURCHASE (+3, +7, +14 hari) di antrian.
   */
  public async createNoPurchaseFollowUps(customerId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
    // 1. Skip kontak sandbox/dummy/bypass (best-effort, offline-safe).
    //    Keberadaan customer TIDAK menjadi gerbang: integritas FK ditegakkan DB dan
    //    setiap insert sudah ter-catch per-item; lookup null/DB-offline tetap lanjut
    //    agar degradasi offline utuh (kontrak: follow-up-schedule.test.ts).
    let customer: any = null;
    try {
      customer = await prisma.customer?.findUnique?.({
        where: { id: customerId },
        include: { labels: { include: { label: true } } },
      });
    } catch {}
    if (
      customer &&
      (customer.is_sandbox_test ||
        customer.is_admin_labeled ||
        hasBypassLabel(customer) ||
        isDummyOrTestContact(customer.phone, customer.name))
    ) {
      return;
    }
    if (await checkCustomerBypass({ customerId, tenantId })) {
      return;
    }

    // 2. Cek apakah customer sudah memiliki reservasi (pending, confirmed, atau completed)
    let hasReservation: any = null;
    try {
      hasReservation = await prisma.reservation?.findFirst?.({
        where: {
          customer_id: customerId,
          status: { in: ['pending', 'confirmed', 'en_route', 'completed'] },
        },
      });
    } catch {}
    if (hasReservation) {
      console.log(`[FollowUp Service] Customer ${customerId} already has reservation (${hasReservation.id}, status: ${hasReservation.status}). Skipping NO_PURCHASE creation.`);
      return;
    }

    // 3. Cek apakah sudah ada antrian NO_PURCHASE aktif (idempoten)
    let existing = null;
    try {
      existing = await prisma.followUp?.findFirst?.({
        where: {
          customer_id: customerId,
          type: 'NO_PURCHASE',
          tenant_id: tenantId,
          status: { in: ['PENDING', 'QUEUED'] },
        },
      });
    } catch {}
    if (existing) {
      return;
    }

    const stages = [1, 2, 3];
      const days = [3, 7, 14];
      
      await Promise.all(
        stages.map(async (stage, idx) => {
          const scheduledAt = new Date();
          scheduledAt.setDate(scheduledAt.getDate() + days[idx]);
          
          try {
            await prisma.followUp?.create?.({
              data: {
                tenant_id: tenantId,
                customer_id: customerId,
                type: 'NO_PURCHASE',
                stage,
                scheduled_at: scheduledAt,
                status: 'QUEUED',
              },
            });
          } catch (_) {}
        })
      );
      console.log(`[FollowUp Service] Queued NO_PURCHASE follow-ups for customer: ${customerId}`);
    } catch (err) {
      console.error('[FollowUp Service] Failed to create NO_PURCHASE follow-ups:', err);
    }
  }

  /**
   * Hitung waktu kirim pada jam operasional ramah 09:40 WIB (= 02:40 UTC)
   * untuk tanggal anchor + dayOffset hari kalender (mengikuti tanggal WIB).
   */
  private computeScheduleAtWib0940(anchor: Date, dayOffset: number): Date {
    const anchorWib = new Date(anchor.getTime() + 7 * 60 * 60 * 1000);
    const year = anchorWib.getUTCFullYear();
    const month = anchorWib.getUTCMonth();
    const day = anchorWib.getUTCDate();
    return new Date(Date.UTC(year, month, day + dayOffset, 2, 40, 0, 0));
  }

  /**
   * Event-Driven Last-Chat Sliding Window untuk follow-up NO_PURCHASE.
   *
   * Dipanggil saat customer mengirim pesan masuk (inbound) â€” best-effort &
   * non-blocking. Menggeser scheduled_at antrian NO_PURCHASE aktif agar selalu
   * relatif terhadap chat terakhir customer: stage 1/2/3 â†’ chatAt + 3/7/14 hari
   * pada pukul 09:40 WIB.
   *
   * Jika customer ternyata sudah punya reservasi aktif, antrian NO_PURCHASE
   * dibatalkan dengan cancel_reason yang jelas (bukan dibiarkan terkirim).
   *
   * Offline-safe: DB error â†’ tidak pernah melempar ke pemanggil.
   */
  public async rescheduleNoPurchaseOnInboundChat(
    customerId: string,
    tenantId: string = DEFAULT_TENANT_ID,
    chatAt: Date = new Date()
  ): Promise<{ rescheduled: number; cancelled: number }> {
    const empty = { rescheduled: 0, cancelled: 0 };
    try {
      const anchor = new Date(chatAt);
      if (isNaN(anchor.getTime())) return empty;

      // 1. Reservasi aktif â†’ batalkan antrian NO_PURCHASE dengan alasan eksplisit.
      let hasReservation: any = null;
      try {
        hasReservation = await prisma.reservation?.findFirst?.({
          where: {
            customer_id: customerId,
            status: { in: ['pending', 'confirmed', 'en_route', 'completed'] },
          },
        });
      } catch (_) {}
      if (hasReservation) {
        let cancelled = 0;
        try {
          const res = await prisma.followUp.updateMany({
            where: {
              customer_id: customerId,
              tenant_id: tenantId,
              type: 'NO_PURCHASE',
              status: { in: ['PENDING', 'QUEUED'] },
            },
            data: { status: 'CANCELLED', cancel_reason: CANCEL_REASON.INBOUND_HAS_RESERVATION, reservation_id: null },
          });
          cancelled = res?.count || 0;
        } catch (_) {}
        if (cancelled > 0) {
          console.log(`[FollowUp Service] Inbound chat: cancelled ${cancelled} NO_PURCHASE (customer ${customerId} has active reservation).`);
        }
        return { rescheduled: 0, cancelled };
      }

      // 2. Geser jadwal antrian NO_PURCHASE aktif relatif ke chat terakhir.
      let active: any[] = [];
      try {
        active = (await prisma.followUp.findMany({
          where: {
            customer_id: customerId,
            tenant_id: tenantId,
            type: 'NO_PURCHASE',
            status: { in: ['PENDING', 'QUEUED'] },
          },
          select: { id: true, stage: true, scheduled_at: true },
        })) || [];
      } catch (_) {
        return empty;
      }
      if (active.length === 0) return empty;

      let rescheduled = 0;
      for (const fu of active) {
        const stageIdx = Math.min(3, Math.max(1, fu.stage)) - 1;
        const scheduledAt = this.computeScheduleAtWib0940(anchor, NO_PURCHASE_STAGE_DAYS[stageIdx] ?? 14);
        try {
          await prisma.followUp.update({
            where: { id: fu.id },
            data: { scheduled_at: scheduledAt },
          });
          rescheduled++;
        } catch (_) {}
      }
      if (rescheduled > 0) {
        console.log(`[FollowUp Service] Inbound chat: slid ${rescheduled} NO_PURCHASE schedule(s) for customer ${customerId} from ${anchor.toISOString()}.`);
      }
      return { rescheduled, cancelled: 0 };
    } catch (err: any) {
      console.warn('[FollowUp Service] rescheduleNoPurchaseOnInboundChat failed:', err?.message || err);
      return empty;
    }
  }

  /**
   * Dipanggil saat reservasi baru dibuat (status pending).
   * Membatalkan semua follow-up pending/queued untuk customer ini karena
   * customer telah maju ke tahap reservasi.
   *
   * PENTING (single source of truth): method ini DILARANG menyentuh
   * `Reservation.is_repeat_order`. Kolom itu adalah domain eksklusif
   * `reservation-core.service.ts` (`computeIsRepeatOrder`) yang menurunkannya
   * dari ordinal riwayat `confirmed/en_route/completed`. Mutasi di sini pernah
   * menyebabkan transaksi PERTAMA pasien (order #1) salah tertandai repeat
   * order hanya karena follow-up NO_PURCHASE_1 masih aktif (lihat CHANGELOG).
   */
  public async onReservationCreated(customerId: string, reservationId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      let activeFollowUps: any[] = [];
      try {
        activeFollowUps = (await prisma.followUp?.findMany?.({
          where: {
            customer_id: customerId,
            status: { in: ['PENDING', 'QUEUED'] },
            tenant_id: tenantId,
          },
        })) || [];
      } catch (_) {}

      if (activeFollowUps && activeFollowUps.length > 0) {
        // Batalkan semua follow-up aktif tersebut
        try {
          await prisma.followUp?.updateMany?.({
            where: {
              id: { in: activeFollowUps.map(f => f.id) },
            },
            // Neutralkan reservation_id: baris CANCELLED tidak lagi terkait reservasi
            // aktif, menjaga invarian @@unique([tenant_id, reservation_id, type, stage]).
            data: { status: 'CANCELLED', cancel_reason: CANCEL_REASON.RESERVATION_CREATED, reservation_id: null },
          });
        } catch (_) {}
        console.log(`[FollowUp Service] Cancelled ${activeFollowUps.length} active follow-ups for customer: ${customerId} (reservation ${reservationId}).`);
      }
    } catch (err) {
      console.error('[FollowUp Service] Error handling reservation creation event:', err);
    }
  }

  /**
   * Dipanggil saat reservasi dikonfirmasi (CONFIRMED).
   * Membuat 1 row REMINDER_H1 (H-1 pukul 19:00 WIB) dan
   * 1 row REVIEW_H1_BABY / REVIEW_H1_MOMS (H+1 pukul 08:00 WIB) di antrian follow_ups.
   */
  public async createReservationFollowUps(params: {
    reservationId: string;
    customerId: string;
    bookingDate: Date;
    treatmentCategory?: string | null;
    tenantId?: string;
  }): Promise<void> {
    const {
      reservationId,
      customerId,
      bookingDate,
      treatmentCategory,
      tenantId = DEFAULT_TENANT_ID,
    } = params;

    try {
    // 1. Skip kontak sandbox/dummy/bypass (best-effort, offline-safe).
    //    Keberadaan customer TIDAK menjadi gerbang: integritas FK ditegakkan DB dan
    //    setiap insert sudah ter-catch per-item; lookup null/DB-offline tetap lanjut
    //    agar degradasi offline utuh (kontrak: follow-up-schedule.test.ts).
    let customer: any = null;
    try {
      customer = await prisma.customer?.findUnique?.({
        where: { id: customerId },
        include: { labels: { include: { label: true } } },
      });
    } catch {}
    if (
      customer &&
      (customer.is_sandbox_test ||
        customer.is_admin_labeled ||
        hasBypassLabel(customer) ||
        isDummyOrTestContact(customer.phone, customer.name))
    ) {
      return;
    }
    if (await checkCustomerBypass({ customerId, tenantId })) {
      return;
    }

      const bDate = new Date(bookingDate);
      if (isNaN(bDate.getTime())) return;

      const now = new Date();

      // 2. Hitung tanggal booking dalam zona waktu WIB (UTC+7)
      const bDateWib = new Date(bDate.getTime() + 7 * 60 * 60 * 1000);
      const year = bDateWib.getUTCFullYear();
      const month = bDateWib.getUTCMonth();
      const day = bDateWib.getUTCDate();

      // Reminder H-1 Malam pukul 19:00 WIB (= 12:00 UTC pada hari H-1)
      const reminderDate = new Date(Date.UTC(year, month, day - 1, 12, 0, 0, 0));

      let effectiveReminderDate: Date | null = reminderDate;
      if (reminderDate <= now) {
        // Jika booking dibuat mendadak (misal hari H pagi atau H-1 malam > 19:00 WIB),
        // jadwalkan segera jika booking_date masih di depan
        if (bDate.getTime() > now.getTime() + 15 * 60 * 1000) {
          effectiveReminderDate = new Date(now.getTime() + 2 * 60 * 1000);
        } else {
          effectiveReminderDate = null;
        }
      }

      // 3. Hitung waktu Review H+1 Pagi pukul 08:00 WIB (= 01:00 UTC pada hari H+1)
      const reviewDate = new Date(Date.UTC(year, month, day + 1, 1, 0, 0, 0));

      const isBaby = treatmentCategory === 'BABY' || treatmentCategory === 'BOTH';
      const reviewType = isBaby ? 'REVIEW_H1_BABY' : 'REVIEW_H1_MOMS';

      // 4. Jadwalkan Reminder H-1 Malam jika masih berlaku
      if (effectiveReminderDate) {
        let existingReminder = null;
        try {
          existingReminder = await prisma.followUp?.findFirst?.({
            where: {
              reservation_id: reservationId,
              type: 'REMINDER_H1',
              tenant_id: tenantId,
              status: { in: ['PENDING', 'QUEUED'] },
            },
          });
        } catch (_) {}

        if (!existingReminder) {
          try {
            await prisma.followUp?.create?.({
              data: {
                tenant_id: tenantId,
                customer_id: customerId,
                reservation_id: reservationId,
                type: 'REMINDER_H1',
                stage: 1,
                scheduled_at: effectiveReminderDate,
                status: 'PENDING',
              },
            });
            console.log(`[FollowUp Service] Created (POSTPONED) REMINDER_H1 for reservation: ${reservationId} at ${effectiveReminderDate.toISOString()}`);
          } catch (err: any) {
            console.warn('[FollowUp Service] Failed to create REMINDER_H1:', err.message);
          }
        }
      }

      // 5. Jadwalkan Review H+1 Pasca Treatment â€” guard backdate (MT-1.2):
      //    jika reviewDate lampau (booking backdated), skip agar tidak bikin row kedaluwarsa.
      if (reviewDate.getTime() <= now.getTime()) {
        console.log(`[FollowUp Service] Skipping ${reviewType} for reservation ${reservationId}: backdated (review ${reviewDate.toISOString()} <= now).`);
      } else {
        let existingReview = null;
        try {
          existingReview = await prisma.followUp?.findFirst?.({
            where: {
              reservation_id: reservationId,
              type: reviewType as any,
              tenant_id: tenantId,
              status: { in: ['PENDING', 'QUEUED'] },
            },
          });
        } catch (_) {}

        if (!existingReview) {
          try {
            await prisma.followUp?.create?.({
              data: {
                tenant_id: tenantId,
                customer_id: customerId,
                reservation_id: reservationId,
                type: reviewType as any,
                stage: 1,
                scheduled_at: reviewDate,
                status: 'PENDING',
              },
            });
            console.log(`[FollowUp Service] Created (POSTPONED) ${reviewType} for reservation: ${reservationId} at ${reviewDate.toISOString()}`);
          } catch (err: any) {
            console.warn(`[FollowUp Service] Failed to create ${reviewType}:`, err.message);
          }
        }
      }
    } catch (err: any) {
      console.error('[FollowUp Service] Failed to create reservation follow-ups:', err.message);
    }
  }

  /**
   * Membatalkan semua follow-up terkait reservasi tertentu saat reservasi dibatalkan/ditolak.
   */
  public async onReservationCancelled(reservationId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      await prisma.followUp?.updateMany?.({
        where: {
          reservation_id: reservationId,
          tenant_id: tenantId,
          status: { in: ['PENDING', 'QUEUED'] },
        },
        // Baris CANCELLED tetap tersimpan sebagai jejak historis, namun reservation_id
        // dinetralkan agar tidak menabrak unique (tenant_id, reservation_id, type, stage)
        // saat reservasi yang sama membuat follow-up pengganti.
        data: { status: 'CANCELLED', cancel_reason: CANCEL_REASON.RESERVATION_CANCELLED, reservation_id: null },
      });
      console.log(`[FollowUp Service] Cancelled follow-ups for reservation ${reservationId}`);
    } catch (err: any) {
      console.error('[FollowUp Service] Error cancelling follow-ups for reservation:', err.message);
    }
  }

  /**
   * Menyesuaikan jadwal reminder H-1 dan review H+1 saat reservasi di-reschedule.
   */
  public async onReservationRescheduled(
    reservationId: string,
    newBookingDate: Date,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<void> {
    try {
      const bDate = new Date(newBookingDate);
      if (isNaN(bDate.getTime())) return;

      const bDateWib = new Date(bDate.getTime() + 7 * 60 * 60 * 1000);
      const year = bDateWib.getUTCFullYear();
      const month = bDateWib.getUTCMonth();
      const day = bDateWib.getUTCDate();

      // Reminder H-1 Malam pukul 19:00 WIB (= 12:00 UTC pada hari H-1)
      const reminderDate = new Date(Date.UTC(year, month, day - 1, 12, 0, 0, 0));

      // Review H+1 Pagi pukul 08:00 WIB (= 01:00 UTC pada hari H+1)
      const reviewDate = new Date(Date.UTC(year, month, day + 1, 1, 0, 0, 0));

      // Update REMINDER_H1
      await prisma.followUp?.updateMany?.({
        where: {
          reservation_id: reservationId,
          type: 'REMINDER_H1',
          tenant_id: tenantId,
          status: { in: ['PENDING', 'QUEUED'] },
        },
        data: { scheduled_at: reminderDate },
      });

      // Update Review H+1
      await prisma.followUp?.updateMany?.({
        where: {
          reservation_id: reservationId,
          type: { in: ['REVIEW_H1_BABY', 'REVIEW_H1_MOMS'] },
          tenant_id: tenantId,
          status: { in: ['PENDING', 'QUEUED'] },
        },
        data: { scheduled_at: reviewDate },
      });

      console.log(`[FollowUp Service] Rescheduled follow-ups for reservation ${reservationId} to new date ${newBookingDate.toISOString()}`);
    } catch (err: any) {
      console.error('[FollowUp Service] Error rescheduling follow-ups for reservation:', err.message);
    }
  }

  /**
   * Hitung waktu kirim NEXT_TREATMENT pada 09:00 WIB untuk tanggal booking + offset bulan.
   * Normalisasi WIB agar konsisten lintas lingkungan (UTC host vs WIB).
   */
  private computeNextTreatmentAtWib0900(bookingDate: Date, monthOffset: number): Date {
    const bWib = new Date(bookingDate.getTime() + 7 * 60 * 60 * 1000);
    const y = bWib.getUTCFullYear();
    const m = bWib.getUTCMonth() + monthOffset;
    const d = bWib.getUTCDate();
    // 09:00 WIB = 02:00 UTC pada tanggal hasil (clamp day overflow via Date.UTC)
    return new Date(Date.UTC(y, m, d, 2, 0, 0, 0));
  }

  /**
   * Dipanggil saat reservasi dikonfirmasi/rescheduled/selesai.
   * Membuat hingga 3 row follow-up QUEUED tipe NEXT_TREATMENT (+1, +2, +3 bulan) di antrian.
   * Guard per-stage (MT-1.3): skip stage yang sudah lampau (scheduledAt <= now),
   * cek idempotensi per-stage termasuk SENT (jangan recreate stage 1 yang sudah SENT).
   * Status QUEUED (langsung masuk antrean kirim), konsisten dgn NO_PURCHASE — keputusan
   * pemilik: repeat-order pasien selesai auto-kirim tanpa perlu approval admin per-baris.
   */
  public async createNextTreatmentFollowUps(customerId: string, bookingDate: Date, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
    // 1. Skip kontak sandbox/dummy/bypass (best-effort, offline-safe).
    //    Keberadaan customer TIDAK menjadi gerbang: integritas FK ditegakkan DB dan
    //    setiap insert sudah ter-catch per-item; lookup null/DB-offline tetap lanjut
    //    agar degradasi offline utuh (kontrak: follow-up-schedule.test.ts).
    let customer: any = null;
    try {
      customer = await prisma.customer?.findUnique?.({
        where: { id: customerId },
        include: { labels: { include: { label: true } } },
      });
    } catch {}
    if (
      customer &&
      (customer.is_sandbox_test ||
        customer.is_admin_labeled ||
        hasBypassLabel(customer) ||
        isDummyOrTestContact(customer.phone, customer.name))
    ) {
      return;
    }
    if (await checkCustomerBypass({ customerId, tenantId })) {
      return;
    }

      const bDate = new Date(bookingDate);
      if (isNaN(bDate.getTime())) return;
      const now = new Date();

      let created = 0;
      let skippedPast = 0;
      let skippedExists = 0;

      for (const stage of [1, 2, 3] as const) {
        const scheduledAt = this.computeNextTreatmentAtWib0900(bDate, stage);
        if (scheduledAt.getTime() <= now.getTime()) {
          skippedPast++;
          continue;
        }

        // Per-stage idempotensi: cek PENDING/QUEUED/SENT agar tidak recreate stage yang sudah ada/terkirim
        let exists = null;
        try {
          exists = await prisma.followUp?.findFirst?.({
            where: {
              customer_id: customerId,
              type: 'NEXT_TREATMENT',
              stage,
              tenant_id: tenantId,
              status: { in: ['PENDING', 'QUEUED', 'SENT'] as any },
            },
          });
        } catch (_) {}
        if (exists) {
          skippedExists++;
          continue;
        }

        try {
          await prisma.followUp?.create?.({
            data: {
              tenant_id: tenantId,
              customer_id: customerId,
              type: 'NEXT_TREATMENT',
              stage,
              scheduled_at: scheduledAt,
              status: 'QUEUED',
            },
          });
          created++;
        } catch (_) {}
      }

      if (created > 0) {
        console.log(`[FollowUp Service] Queued ${created} NEXT_TREATMENT follow-up(s) for customer: ${customerId} (skipped ${skippedPast} past, ${skippedExists} existing).`);
      } else if (skippedExists > 0) {
        console.log(`[FollowUp Service] NEXT_TREATMENT follow-ups already exist for customer: ${customerId}. Skipping (idempotent per-stage).`);
      }
    } catch (err) {
      console.error('[FollowUp Service] Failed to create NEXT_TREATMENT follow-ups:', err);
    }
  }

  /**
   * Self-Healing Reconciler (Fase 2) â€” jaring pengaman harian.
   * Mencari customer completed tanpa antrean NEXT aktif dan menjadwalkan stage masa depan.
   * Kriteria (per-tenant, best-effort, offline-safe):
   *  - customer status != blocked, is_sandbox_test=false, is_admin_labeled=false, lolos hasBypassLabel/checkCustomerBypass/isDummyOrTestContact
   *  - punya reservasi completed dengan booking_date dalam 90 hari terakhir (max per customer)
   *  - tanpa reservasi aktif masa depan (pending/confirmed/hold, booking_date >= now)
   *  - tanpa NEXT_TREATMENT PENDING/QUEUED (SENT per-stage tidak menghalangi stage masa depan)
   * Aksi: createNextTreatmentFollowUps(maxBookingDate) â†’ hanya stage masa depan PENDING.
   */
  public async reconcileOrphanedCompletedFollowUps(tenantId: string = DEFAULT_TENANT_ID): Promise<{ reconciledCount: number; customerIds: string[] }> {
    const empty = { reconciledCount: 0, customerIds: [] as string[] };
    try {
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

      // 1. Ambil reservasi completed 90 hari terakhir (tenant-scoped)
      let completed: Array<{ customer_id: string; booking_date: Date | null }> = [];
      try {
        completed = (await prisma.reservation.findMany({
          where: {
            tenant_id: tenantId,
            status: 'completed',
            booking_date: { gte: ninetyDaysAgo, lte: now },
          },
          select: { customer_id: true, booking_date: true },
          orderBy: { booking_date: 'desc' },
        })) as any;
      } catch {
        return empty;
      }
      if (!completed || completed.length === 0) return empty;

      // Kelompokkan max booking_date per customer
      const maxByCustomer = new Map<string, Date>();
      for (const r of completed) {
        if (!r.customer_id || !r.booking_date) continue;
        const d = new Date(r.booking_date);
        if (isNaN(d.getTime())) continue;
        const cur = maxByCustomer.get(r.customer_id);
        if (!cur || d.getTime() > cur.getTime()) maxByCustomer.set(r.customer_id, d);
      }
      if (maxByCustomer.size === 0) return empty;

      const customerIds = Array.from(maxByCustomer.keys());

      // 2. Exclude yang punya reservasi aktif masa depan (pending/confirmed/hold, booking_date >= now)
      let activeFuture: Array<{ customer_id: string }> = [];
      try {
        activeFuture = (await prisma.reservation.findMany({
          where: {
            tenant_id: tenantId,
            customer_id: { in: customerIds },
            status: { in: ['pending', 'confirmed', 'en_route', 'hold'] },
            booking_date: { gte: now },
          },
          select: { customer_id: true },
        })) as any;
      } catch {}
      const hasActiveFuture = new Set((activeFuture || []).map((r) => r.customer_id));
      const candidates = customerIds.filter((id) => !hasActiveFuture.has(id));
      if (candidates.length === 0) return empty;

      // 3. Exclude yang sudah punya NEXT_TREATMENT PENDING/QUEUED (SENT tidak dihitung â€” per-stage guard akan skip stage SENT)
      let hasNext: Array<{ customer_id: string }> = [];
      try {
        hasNext = (await prisma.followUp.findMany({
          where: {
            tenant_id: tenantId,
            customer_id: { in: candidates },
            type: 'NEXT_TREATMENT',
            status: { in: ['PENDING', 'QUEUED'] as any },
          },
          select: { customer_id: true },
        })) as any;
      } catch {}
      const hasNextSet = new Set((hasNext || []).map((r) => r.customer_id));
      const orphaned = candidates.filter((id) => !hasNextSet.has(id));
      if (orphaned.length === 0) return empty;

      // 4. Filter bypass/sandbox/dummy/blocked (DB lesu â†’ filter best-effort, hilangkan yang jelas bypass)
      let filtered = orphaned;
      try {
        const customers = (await prisma.customer.findMany({
          where: { id: { in: orphaned } },
          select: { id: true, phone: true, name: true, status: true, is_sandbox_test: true, is_admin_labeled: true },
          // include labels untuk hasBypassLabel â€” best-effort via second query bila select tidak cukup
        })) as any[];
        // Secondary: load labels untuk hasBypassLabel (hanya bila customer ditemukan)
        let labelMap = new Map<string, any>();
        try {
          const withLabels = (await prisma.customer.findMany({
            where: { id: { in: orphaned } },
            include: { labels: { include: { label: true } } },
          })) as any[];
          for (const c of withLabels || []) labelMap.set(c.id, c);
        } catch {}
        filtered = [];
        for (const c of customers || []) {
          if (!c) continue;
          if (c.status === 'blocked' || c.is_sandbox_test || c.is_admin_labeled) continue;
          const withLabels = labelMap.get(c.id);
          if (withLabels && hasBypassLabel(withLabels)) continue;
          if (isDummyOrTestContact(c.phone, c.name)) continue;
          // checkCustomerBypass â€” async, best-effort
          try {
            // eslint-disable-next-line no-await-in-loop
            if (await checkCustomerBypass({ customerId: c.id, tenantId })) continue;
          } catch {}
          filtered.push(c.id);
        }
        // Jika customer query gagal total, fallback ke orphaned (reconciler tetap jalan)
        if ((customers || []).length === 0 && orphaned.length > 0) filtered = orphaned;
      } catch {}

      // 5. Buat NEXT per-stage (hanya masa depan, PENDING, SENT-aware ada di createNextTreatmentFollowUps)
      let reconciledCount = 0;
      const reconciledIds: string[] = [];
      for (const cid of filtered) {
        const maxDate = maxByCustomer.get(cid);
        if (!maxDate) continue;
        try {
          const before = await prisma.followUp.count({
            where: { tenant_id: tenantId, customer_id: cid, type: 'NEXT_TREATMENT', status: { in: ['PENDING', 'QUEUED', 'SENT'] as any } },
          }).catch(() => 0);
          await this.createNextTreatmentFollowUps(cid, maxDate, tenantId);
          const after = await prisma.followUp.count({
            where: { tenant_id: tenantId, customer_id: cid, type: 'NEXT_TREATMENT', status: { in: ['PENDING', 'QUEUED'] as any } },
          }).catch(() => 0);
          // Heuristik: jika after > 0 dan PENDING tercipta, hitung reconcile
          if (after > 0) {
            reconciledCount++;
            reconciledIds.push(cid);
          } else if (before === 0) {
            // Offline mock (count gagal) â€” tetap anggap reconcile attempted
            reconciledCount++;
            reconciledIds.push(cid);
          }
        } catch {}
      }

      if (reconciledCount > 0) {
        console.log(`[FollowUp Reconciler] Reconciled ${reconciledCount} orphaned completed customer(s) (tenant ${tenantId}).`);
      }
      return { reconciledCount, customerIds: reconciledIds };
    } catch (err: any) {
      console.warn('[FollowUp Reconciler] reconcileOrphanedCompletedFollowUps failed:', err?.message || err);
      return empty;
    }
  }

  /**
   * Manual Send (Approve & Send Now) â€” dipanggil dari Admin Dashboard.
   */
  public async sendNow(id: string, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    const fu = await prisma.followUp.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        customer: {
          include: {
            children: true,
          },
        },
      },
    });

    if (!fu) {
      throw new Error(`Follow-up #${id} tidak ditemukan.`);
    }

    if (fu.status === 'SENT') {
      throw new Error('Follow-up ini sudah pernah dikirim sebelumnya.');
    }

    const { whatsappProviderService } = await import('./whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(tenantId);
    if (isCutOff) {
      throw new Error('Koneksi outbound WhatsApp sedang diputus oleh Administrator (Cut-Off Darurat aktif).');
    }

    console.log(`[FollowUp Service] Manual Send Triggered by Admin for Follow-Up #${id} (${fu.customer?.phone})`);
    const success = await this.executeFollowUp(fu, tenantId);
    return success;
  }

  /**
   * Menjadwalkan follow-up tunggal ke antrian (status QUEUED).
   * Pesan akan dikirim otomatis oleh background worker saat waktu scheduled_at tiba.
   */
  public async queueFollowUp(id: string, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    const res = await prisma.followUp.updateMany({
      where: { id, tenant_id: tenantId, status: 'PENDING' },
      data: { status: 'QUEUED' },
    });
    console.log(`[FollowUp Service] Queued follow-up #${id} (status: QUEUED).`);
    return res.count > 0;
  }

  /**
   * Menjadwalkan seluruh follow-up PENDING ke antrian (status QUEUED).
   */
  public async bulkQueueFollowUps(tenantId: string = DEFAULT_TENANT_ID): Promise<number> {
    const res = await prisma.followUp.updateMany({
      where: { tenant_id: tenantId, status: 'PENDING' },
      data: { status: 'QUEUED' },
    });
    console.log(`[FollowUp Service] Bulk queued ${res.count} follow-ups to status QUEUED.`);
    return res.count;
  }

  /**
   * Cancel single follow-up.
   * `options.reason` opsional â€” tersimpan di cancel_reason agar admin tahu
   * mengapa antrian ini batal. Default: pembatalan manual oleh Admin.
   */
  public async cancelFollowUp(
    id: string,
    tenantId: string = DEFAULT_TENANT_ID,
    options: { reason?: string } = {}
  ): Promise<boolean> {
    const reason = (options.reason || '').trim() || CANCEL_REASON.MANUAL_ADMIN;
    const res = await prisma.followUp.updateMany({
      where: { id, tenant_id: tenantId },
      data: { status: 'CANCELLED', cancel_reason: reason, reservation_id: null },
    });
    return res.count > 0;
  }

  /**
   * Skip seluruh antrian follow-up aktif untuk customer bypass/admin.
   * Central seam Fase 1 â€” status kanonis SKIPPED + CANCEL_REASON.BYPASS_LABEL,
   * terisolasi tenant_id. Dipanggil dari label route & customer.service hook.
   */
  public async skipFollowUpsForBypassCustomer(
    customerId: string,
    tenantId: string = DEFAULT_TENANT_ID,
  ): Promise<number> {
    try {
      const res = await prisma.followUp.updateMany({
        where: {
          customer_id: customerId,
          tenant_id: tenantId,
          status: { in: ['PENDING', 'QUEUED'] },
        },
        data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.BYPASS_LABEL },
      });
      if (res.count > 0) {
        console.log(
          `[FollowUp Service] Auto-skipped ${res.count} active follow-ups for bypass customer ${customerId} (tenant ${tenantId})`,
        );
      }
      return res.count;
    } catch (err: any) {
      console.warn(
        `[FollowUp Service] Failed to skip follow-ups for bypass customer ${customerId}:`,
        err.message,
      );
      return 0;
    }
  }

  /**
   * Bulk cancel follow-ups (misal semua PENDING atau QUEUED).
   * `options.reason` opsional â€” default: pembatalan massal oleh Admin.
   */
  public async bulkCancelFollowUps(
    tenantId: string = DEFAULT_TENANT_ID,
    status: string = 'PENDING',
    options: { reason?: string } = {}
  ): Promise<number> {
    const reason = (options.reason || '').trim() || CANCEL_REASON.BULK_ADMIN;
    const res = await prisma.followUp.updateMany({
      where: { tenant_id: tenantId, status: status as any },
      data: { status: 'CANCELLED', cancel_reason: reason, reservation_id: null },
    });
    console.log(`[FollowUp Service] Bulk cancelled ${res.count} follow-ups with status ${status}.`);
    return res.count;
  }

  /**
   * Update follow-up (ubah tanggal, varian/stage, atau custom_text).
   */
  public async updateFollowUp(
    id: string,
    data: {
      scheduledAt?: Date;
      stage?: number;
      customText?: string | null;
    },
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<any> {
    const existing = await prisma.followUp.findFirst({
      where: { id, tenant_id: tenantId },
    });

    if (!existing) {
      throw new Error(`Follow-up #${id} tidak ditemukan.`);
    }

    const updateData: any = {};
    if (data.scheduledAt) updateData.scheduled_at = data.scheduledAt;
    if (typeof data.stage === 'number' && data.stage >= 1 && data.stage <= 3) {
      updateData.stage = data.stage;
    }
    if (data.customText !== undefined) {
      updateData.custom_text = data.customText ? data.customText.trim() : null;
    }

    return prisma.followUp.update({
      where: { id },
      data: updateData,
      include: {
        customer: true,
      },
    });
  }

  /**
   * Reschedule follow-up (ubah tanggal/jam jadwal kirim).
   */
  public async rescheduleFollowUp(id: string, newDate: Date, tenantId: string = DEFAULT_TENANT_ID): Promise<any> {
    return this.updateFollowUp(id, { scheduledAt: newDate }, tenantId);
  }

  /**
   * Majukan seluruh follow-up PENDING yang tanggalnya sebelum tanggal target (overdue)
   * dan jadwalkan merata dengan kuota maksimal per hari (default FOLLOWUP_MAX_PER_DAY, 40) pada jam kerja (09:00 - 16:30 WIB).
   */
  public async rescheduleOverdueFollowUps(
    tenantId: string = DEFAULT_TENANT_ID,
    options: {
      maxPerDay?: number;
      startDate?: Date;
    } = {}
  ): Promise<{
    rescheduledCount: number;
    daysCount: number;
    distribution: Record<string, number>;
  }> {
    const defaultMax = parsePositiveInt(process.env.FOLLOWUP_MAX_PER_DAY, 40);
    const maxPerDay = Math.max(1, options.maxPerDay || defaultMax);

    const now = new Date();
    const nowWib = new Date(now.getTime() + 7 * 60 * 60 * 1000);

    let startYear: number;
    let startMonth: number;
    let startDay: number;

    if (options.startDate) {
      const sWib = new Date(new Date(options.startDate).getTime() + 7 * 60 * 60 * 1000);
      startYear = sWib.getUTCFullYear();
      startMonth = sWib.getUTCMonth();
      startDay = sWib.getUTCDate();
    } else {
      startYear = nowWib.getUTCFullYear();
      startMonth = nowWib.getUTCMonth();
      startDay = nowWib.getUTCDate();
      // jika jam sekarang sudah >= 16:00 WIB, mulai dari besok pagi
      if (nowWib.getUTCHours() >= 16) {
        startDay += 1;
      }
    }

    // Jam 09:00 WIB = 02:00 UTC
    const baseCutoff = new Date(Date.UTC(startYear, startMonth, startDay, 2, 0, 0, 0));

    const overdueFollowUps = await prisma.followUp.findMany({
      where: {
        tenant_id: tenantId,
        type: { notIn: ['REMINDER_H1', 'REVIEW_H1_BABY', 'REVIEW_H1_MOMS'] },
        status: { in: ['PENDING', 'QUEUED'] },
        scheduled_at: { lt: baseCutoff },
        customer: buildNonBypassCustomerWhere() as any,
      },
      orderBy: [{ scheduled_at: 'asc' }, { created_at: 'asc' }],
    });

    if (overdueFollowUps.length === 0) {
      return { rescheduledCount: 0, daysCount: 0, distribution: {} };
    }

    // Urutkan overdue: NEXT_TREATMENT lebih diprioritaskan daripada NO_PURCHASE
    const sortedOverdue = [...overdueFollowUps].sort((a, b) => {
      const pA = FOLLOWUP_TYPE_PRIORITY[a.type] || 99;
      const pB = FOLLOWUP_TYPE_PRIORITY[b.type] || 99;
      if (pA !== pB) return pA - pB;
      return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    });

    const distribution: Record<string, number> = {};
    let currentDayIndex = 0;
    let countInCurrentDay = 0;

    // Distribusi merata sepanjang jam 09:00 - 16:30 WIB (450 menit)
    const stepMin = maxPerDay > 1 ? Math.floor(450 / maxPerDay) : 30;

    for (const fu of sortedOverdue) {
      if (countInCurrentDay >= maxPerDay) {
        currentDayIndex++;
        countInCurrentDay = 0;
      }

      const offsetMin = countInCurrentDay * stepMin;
      // 09:00 WIB + offsetMin = 02:00 UTC + offsetMin
      const targetDate = new Date(Date.UTC(startYear, startMonth, startDay + currentDayIndex, 2, offsetMin, 0, 0));

      await prisma.followUp.update({
        where: { id: fu.id },
        data: { scheduled_at: targetDate },
      });

      const dateStr = targetDate.toISOString().split('T')[0];
      distribution[dateStr] = (distribution[dateStr] || 0) + 1;
      countInCurrentDay++;
    }

    console.log(`[FollowUp Service] Rescheduled ${sortedOverdue.length} overdue follow-ups across ${currentDayIndex + 1} days (max ${maxPerDay}/day, interval ~${stepMin}m, NEXT_TREATMENT prioritized).`);
    return {
      rescheduledCount: sortedOverdue.length,
      daysCount: currentDayIndex + 1,
      distribution,
    };
  }

  /**
   * Dipanggil oleh CronWorker (misal setiap 15 menit) untuk mencari & mengeksekusi
   * follow-up yang waktunya sudah tiba (scheduled_at <= NOW()).
   * 
   * KEBIJAKAN PENJADWALAN & APPROVAL:
   * - Status 'QUEUED': Selalu diproses saat scheduled_at tiba, karena sudah disetujui / dijadwalkan oleh admin.
   * - Status 'PENDING': Hanya diproses otomatis jika AUTO_FOLLOWUP_ENABLED === 'true'.
   *   Jika AUTO_FOLLOWUP_ENABLED !== 'true', status PENDING menunggu admin mengklik "Jadwalkan" di Dashboard.
   */
  public async processDueFollowUps(tenantId: string = DEFAULT_TENANT_ID): Promise<number> {
    const { whatsappProviderService } = await import('./whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(tenantId);
    if (isCutOff) {
      console.log(`[FollowUp Worker] Outbound Cut-Off is ACTIVE for tenant ${tenantId}. Skipping follow-up execution until cut-off is deactivated.`);
      return 0;
    }

    const targetStatuses = process.env.AUTO_FOLLOWUP_ENABLED === 'true'
      ? ['QUEUED', 'PENDING']
      : ['QUEUED'];

    try {
      const now = new Date();

      // Kebijakan Pengguna: Follow-up yang masih PENDING dan belum disetujui / dijadwalkan oleh admin,
      // jika waktu jadwalnya sudah terlewat (scheduled_at < NOW()), otomatis dibatalkan (CANCELLED).
      try {
        // Grace period: JANGAN bunuh antrean PENDING di menit ke-1 setelah jam 09:00 WIB.
        // Hanya batalkan bila sudah melewati AKHIR HARI jadwalnya (scheduled_at < awal hari ini WIB),
        // dengan alasan kanonis tertera (bukan NULL seperti regresi sebelumnya).
        const nowWib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
        const startOfTodayWibUtc = new Date(
          Date.UTC(nowWib.getUTCFullYear(), nowWib.getUTCMonth(), nowWib.getUTCDate()) - 7 * 60 * 60 * 1000
        );
        const expiredPending = await prisma.followUp.updateMany({
          where: {
            tenant_id: tenantId,
            status: 'PENDING',
            scheduled_at: { lt: startOfTodayWibUtc },
          },
          data: { status: 'CANCELLED', cancel_reason: CANCEL_REASON.EXPIRED_PENDING },
        });
        if (expiredPending?.count && expiredPending.count > 0) {
          console.log(`[FollowUp Worker] Auto-cancelled ${expiredPending.count} expired PENDING follow-ups (schedule passed without admin approval).`);
        }
      } catch (pendingCancelErr: any) {
        console.warn('[FollowUp Worker] Failed to auto-cancel expired PENDING follow-ups:', pendingCancelErr.message);
      }

      // Self-Healing Prune Fase 2.1: bersihkan zombie PENDING/QUEUED milik kontak admin/bypass
      // sebelum batch â€” query terisolasi tenant, 1 updateMany, status kanonis SKIPPED.
      try {
        const pruned = await prisma.followUp.updateMany({
          where: {
            tenant_id: tenantId,
            status: { in: ['PENDING', 'QUEUED'] },
            OR: [
              { customer: { is_admin_labeled: true } },
              { customer: { is_sandbox_test: true } },
              { customer: { status: 'blocked' } },
              { customer: { labels: { some: { label: { name: { in: [...BYPASS_LABEL_PRISMA_IN] as unknown as string[] } } } } } },
            ],
          },
          data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.BYPASS_LABEL },
        });
        if (pruned.count > 0) {
          console.log(`[FollowUp Worker] Self-healing pruned ${pruned.count} zombie follow-ups for bypass/admin contacts (tenant ${tenantId}).`);
        }
      } catch (pruneErr: any) {
        console.warn('[FollowUp Worker] Prune zombie follow-ups error:', pruneErr.message);
      }

      const rawDueFollowUps = await prisma.followUp.findMany({
        where: {
          tenant_id: tenantId,
          type: { notIn: ['REMINDER_H1', 'REVIEW_H1_BABY', 'REVIEW_H1_MOMS'] },
          status: { in: targetStatuses as any },
          scheduled_at: { lte: now },
          customer: buildNonBypassCustomerWhere() as any,
        },
        include: {
          reservation: {
            select: {
              id: true,
              booking_date: true,
              treatment_category: true,
              treatment_detail: true,
            },
          },
          customer: {
            include: {
              children: true,
              labels: {
                include: { label: true },
              },
              conversations: {
                select: {
                  last_message_at: true,
                  is_human_handling: true,
                },
                take: 1,
                orderBy: { last_message_at: 'desc' },
              },
            },
          },
        },
        orderBy: [{ scheduled_at: 'asc' }, { created_at: 'asc' }],
        take: FOLLOWUP_BATCH_LIMIT,
      });

      // Urutkan due items berdasarkan prioritas bisnis: NEXT_TREATMENT (#1) > NO_PURCHASE (#2)
      const dueFollowUps = (rawDueFollowUps || []).sort((a, b) => {
        const pA = FOLLOWUP_TYPE_PRIORITY[a.type] || 99;
        const pB = FOLLOWUP_TYPE_PRIORITY[b.type] || 99;
        if (pA !== pB) return pA - pB;
        return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
      });

      if (!dueFollowUps || dueFollowUps.length === 0) {
        return 0;
      }

      console.log(`[FollowUp Worker] Found ${dueFollowUps.length} due follow-ups to process (${targetStatuses.join('/')} mode, scheduled_at <= now).`);
      let processed = 0;
      const cooldownHours = parsePositiveInt(process.env.FOLLOWUP_RECENT_CHAT_COOLDOWN_HOURS, 72);
      const cooldownMs = cooldownHours * 60 * 60 * 1000;

      for (const fu of dueFollowUps) {
        // Overdue Guard: Follow-up yang sudah terlewat > 48 jam ditandai SKIPPED agar tidak mengirim pesan basi
        if (fu.scheduled_at && (now.getTime() - new Date(fu.scheduled_at).getTime() > 48 * 60 * 60 * 1000)) {
          console.log(`[FollowUp Worker] FollowUp #${fu.id} for ${fu.customer?.phone} is SKIPPED (Overdue > 48h).`);
          await prisma.followUp.update({
            where: { id: fu.id },
            data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.OVERDUE_48H },
          });
          continue;
        }

        // Bypass Guard: Jangan kirim follow-up untuk customer berlabel Skip atau Admin CS
        if (fu.customer && (fu.customer.is_admin_labeled || hasBypassLabel(fu.customer))) {
          console.log(`[FollowUp Worker] FollowUp #${fu.id} for ${fu.customer?.phone} is SKIPPED (Bypass contact label).`);
          await prisma.followUp.update({
            where: { id: fu.id },
            data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.BYPASS_LABEL },
          });
          continue;
        }

        // Kebijakan Klinik: Follow-up Reminder H-1 dan Review H+1 di-postpone (ditunda pengirimannya sementara)
        if (fu.type === 'REMINDER_H1' || fu.type === 'REVIEW_H1_BABY' || fu.type === 'REVIEW_H1_MOMS') {
          console.log(`[FollowUp Worker] FollowUp #${fu.id} (${fu.type}) for ${fu.customer?.phone} is POSTPONED by clinic policy. Skipping automatic send.`);
          continue;
        }

        // Serious-Only Gate (state-based, bukan pencocokan teks): pengingat hari ke-14
        // (NO_PURCHASE stage 3) HANYA dikirim ke kontak berkualifikasi (MQL/legacy).
        // Kontak yang tidak pernah serius (tak cukup bubble / bukan legacy) dihentikan
        // di sini agar tidak boros & tidak memicu penandaan spam. Admin tetap bisa
        // kirim manual via sendNow (jalur override sengaja tidak digerbangi).
        if (
          fu.type === 'NO_PURCHASE' &&
          fu.stage >= 3 &&
          !(fu.customer?.is_mql || fu.customer?.is_legacy_source)
        ) {
          console.log(`[FollowUp Worker] FollowUp #${fu.id} (NO_PURCHASE stage 3) for ${fu.customer?.phone} is SKIPPED (bukan MQL/legacy).`);
          await prisma.followUp.update({
            where: { id: fu.id },
            data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.NON_SERIOUS_STAGE3 },
          });
          continue;
        }

        // Smart Context Guard: Jeda interaksi chat terakhir (cooldown)
        const lastConv = fu.customer?.conversations?.[0];
        const lastMsgAt = lastConv?.last_message_at ? new Date(lastConv.last_message_at) : null;
        if (lastMsgAt && (now.getTime() - lastMsgAt.getTime()) < cooldownMs) {
          const newScheduledAt = new Date(lastMsgAt.getTime() + cooldownMs);
          const targetWib = new Date(newScheduledAt.getTime() + 7 * 60 * 60 * 1000);
          const year = targetWib.getUTCFullYear();
          const month = targetWib.getUTCMonth();
          const date = targetWib.getUTCDate();
          // Jam 09:40 WIB = 02:40 UTC
          const adjustedDate = new Date(Date.UTC(year, month, date, 2, 40, 0, 0));

          const finalDate = adjustedDate.getTime() > now.getTime()
            ? adjustedDate
            : new Date(now.getTime() + 24 * 60 * 60 * 1000);

          try {
            await prisma.followUp.update({
              where: { id: fu.id },
              data: { scheduled_at: finalDate },
            });
          } catch (_) {}
          console.log(`[FollowUp Worker] FollowUp #${fu.id} (${fu.customer?.phone}) postponed to ${finalDate.toISOString()} due to recent chat at ${lastMsgAt.toISOString()} (cooldown: ${cooldownHours}h).`);
          continue;
        }

        const success = await this.executeFollowUp(fu, tenantId);
        if (success) processed++;
      }

      return processed;
    } catch (err) {
      console.error('[FollowUp Worker] Error processing due follow-ups:', err);
      return 0;
    }
  }

  /**
   * Umur anak dalam bulan PENUH (year/month diff, bukan floor /30 hari).
   */
  private ageInFullMonths(birthDate: Date, now: Date = new Date()): number {
    let m = (now.getFullYear() - birthDate.getFullYear()) * 12;
    m += now.getMonth() - birthDate.getMonth();
    if (now.getDate() < birthDate.getDate()) m -= 1;
    return Math.max(0, m);
  }

  /**
   * Tentukan template milestone utk follow-up NEXT_TREATMENT.
   * 1) Hanya NEXT_TREATMENT. 2) Butuh anak dgn birth_date.
   * 3) Kategori BABY dari reservasi terakhir customer.
   * 4) Umur bayi â‰ˆ milestone (3/6/9/12) dlm rentang Â±1 bulan (env MILESTONE_WINDOW_DAYS).
   */
  public async resolveMilestoneType(
    fu: any,
    tenantId: string
  ): Promise<FollowUpTemplateType | null> {
    if (fu.type !== 'NEXT_TREATMENT') return null;
    const child = fu.customer?.children?.[0];
    if (!child?.birth_date) return null;

    try {
      const lastRes = await prisma.reservation.findFirst({
        where: { customer_id: fu.customer_id, tenant_id: tenantId },
        orderBy: { created_at: 'desc' },
        select: { treatment_category: true },
      });
      if (!lastRes || lastRes.treatment_category !== 'BABY') return null;
    } catch {
      return null; // DB offline -> jangan blokir follow-up normal
    }

    const age = this.ageInFullMonths(child.birth_date);
    const windowMonths = parseInt(process.env.MILESTONE_WINDOW_DAYS || '15', 10) / 30;

    const milestones: Record<number, FollowUpTemplateType> = {
      3: 'MILESTONE_3M',
      6: 'MILESTONE_6M',
      9: 'MILESTONE_9M',
      12: 'MILESTONE_12M',
    };

    for (const t of Object.keys(milestones).map(Number)) {
      if (Math.abs(age - t) <= windowMonths) return milestones[t];
    }
    return null;
  }

  /**
   * Eksekusi satu unit pengiriman follow-up (dengan rolling template & status update)
   */
  public async executeFollowUp(fu: any, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    try {
      const { whatsappProviderService } = await import('./whatsapp-provider.service');
      const isCutOff = await whatsappProviderService.isOutboundCutOff(tenantId);
      if (isCutOff) {
        console.warn(`[FollowUp Service] Cannot execute follow-up #${fu.id} because Outbound Cut-Off is ACTIVE.`);
        return false;
      }

      if (!fu.customer || !fu.customer.phone) {
        await prisma.followUp.update({
          where: { id: fu.id },
          data: { status: 'FAILED' },
        });
        return false;
      }

      // Map DB type + stage -> Rolling Template Type. Milestone hijack duluan:
      // jika bayi tepat masuk milestone, ganti template (berlaku utk kedua gateway).
      const milestoneType = await this.resolveMilestoneType(fu, tenantId);
      let templateType: FollowUpTemplateType = 'NO_PURCHASE_1';
      if (milestoneType) {
        templateType = milestoneType;
        fu._milestone = true;
      } else if (fu.type === 'NO_PURCHASE') {
        // Auto-cancel jika customer ternyata sudah memiliki reservasi (pending/confirmed/completed)
        try {
          const res = await prisma.reservation.findFirst({
            where: {
              customer_id: fu.customer_id,
              tenant_id: tenantId,
              status: { in: ['pending', 'confirmed', 'en_route', 'completed'] },
            },
          });
          if (res) {
            console.log(`[FollowUp Worker] FollowUp #${fu.id} (${fu.customer?.phone}) is NO_PURCHASE but customer already has reservation (${res.id}, status: ${res.status}). Auto-cancelling.`);
            await prisma.followUp.update({
              where: { id: fu.id },
              data: { status: 'CANCELLED', cancel_reason: CANCEL_REASON.HAS_ACTIVE_RESERVATION, reservation_id: null },
            });
            return false;
          }
        } catch (_) {}

        templateType = `NO_PURCHASE_${Math.min(3, Math.max(1, fu.stage))}` as any;
      } else if (fu.type === 'NEXT_TREATMENT') {
        templateType = `NEXT_TREATMENT_${Math.min(3, Math.max(1, fu.stage))}` as any;
      } else if (fu.type === 'REMINDER_H1') {
        templateType = 'REMINDER_H1';
      } else if (fu.type === 'REVIEW_H1_BABY') {
        templateType = 'REVIEW_H1_BABY';
      } else if (fu.type === 'REVIEW_H1_MOMS') {
        templateType = 'REVIEW_H1_MOMS';
      } else if (fu.type === 'WINBACK_60D') {
        templateType = 'WINBACK_60D';
      }

      const cleanName = sanitizeCustomerNameForGreeting(fu.customer?.name);
      const greetingName = formatGreetingBunda(cleanName);
      const babyName = formatBabyNamesForGreeting(fu.customer?.children, null, { prefixDek: true });

      let timeStr = 'sesuai kesepakatan';
      if (fu.reservation?.booking_date) {
        const d = new Date(fu.reservation.booking_date);
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        timeStr = `${hours}:${minutes} WIB`;
      }

      // Provider-aware send: WABA â†’ HSM template + consent gatekeeper; WAHA â†’ rolling text (existing)
      const gateway = await resolveGatewayForTenant(tenantId);
      if (gateway.providerType === 'WABA') {
        return this.executeFollowUpWaba(fu, templateType, cleanName || 'Bunda', tenantId);
      }

      let messageText: string;

      const rollingVariant = getRollingVariant(fu.customer_id || fu.customer?.id || '', fu.scheduled_at);

      // 1. Prioritaskan teks kustom spesifik yang diedit admin untuk customer ini
      if (fu.custom_text && fu.custom_text.trim()) {
        messageText = fu.custom_text
          .replace(/Bunda\s*\{name\}/gi, greetingName)
          .replace(/\{name\}/g, cleanName || 'Bunda')
          .replace(/\{time\}/g, timeStr)
          .replace(/\{babyName\}/g, babyName)
          .replace(/Bunda\s+Bunda/gi, 'Bunda')
          .replace(/dek\s+dek\s+/gi, 'dek ')
          .replace(/dek\s+si kecil/gi, 'si kecil')
          .replace(/[^\S\r\n]{2,}/g, ' ') // Hanya rapikan spasi horizontal, enter/newline tetap aman
          .replace(/\n{3,}/g, '\n\n')     // Maksimal 2 newline berurutan (paragraf)
          .trim();
      } else {
        // 2. Cek apakah ada template custom di DB untuk type+rollingVariant (rotasi dinamis)
        try {
          const custom = await prisma.followUpTemplate.findFirst({
            where: { tenant_id: tenantId, type: templateType, variant: rollingVariant, is_active: true },
          });
          if (custom) {
            // Replacing placeholders in custom template with smart context
            messageText = custom.text
              .replace(/Bunda\s*\{name\}/gi, greetingName)
              .replace(/\{name\}/g, cleanName || 'Bunda')
              .replace(/\{time\}/g, timeStr)
              .replace(/\{babyName\}/g, babyName)
              .replace(/Bunda\s+Bunda/gi, 'Bunda')
              .replace(/dek\s+dek\s+/gi, 'dek ')
              .replace(/dek\s+si kecil/gi, 'si kecil')
              .replace(/[^\S\r\n]{2,}/g, ' ') // Hanya rapikan spasi horizontal, enter/newline tetap aman
              .replace(/\n{3,}/g, '\n\n')
              .trim();
          } else {
            const { text } = getRollingFollowUpMessage(templateType, {
              name: cleanName,
              babyName,
              time: timeStr,
              index: rollingVariant - 1,
            });
            messageText = text;
          }
        } catch (err) {
          // DB fallback -> gunakan default
          const { text } = getRollingFollowUpMessage(templateType, {
            name: cleanName,
            babyName,
            time: timeStr,
            index: rollingVariant - 1,
          });
          messageText = text;
        }
      }

      console.log(`[FollowUp Worker] Sending ${fu.type} Stage ${fu.stage} to ${fu.customer.phone} (${greetingName}, Baby: ${babyName})`);
      
      // Throttling acak antar customer (env: FOLLOWUP_THROTTLE_BASE_MS s/d +FOLLOWUP_THROTTLE_BASE_MS*10, default 5-15 detik)
      const isTest = process.env.NODE_ENV === 'test';
      if (!isTest) {
        const delay = Math.floor(Math.random() * FOLLOWUP_THROTTLE_BASE_MS * 10) + FOLLOWUP_THROTTLE_BASE_MS;
        await new Promise((r) => setTimeout(r, delay));
      }

      // Pre-log / Catat pesan follow-up ke percakapan Live Chat
      try {
        const { conversationService } = await import('./conversation.service');
        const { messageService } = await import('./message.service');
        const conv = await conversationService.getOrCreateConversation(fu.customer_id, tenantId);
        if (conv) {
          await messageService.logMessage({
            tenantId,
            conversationId: conv.id,
            direction: 'OUTBOUND',
            content: messageText,
            senderType: 'BOT',
            senderName: 'Bot (Follow-Up)',
          });
        }
      } catch (logErr: any) {
        console.warn('[FollowUp Worker] Failed to pre-log outbound message:', logErr.message);
      }

      const sendResult = await typingService.simulateHumanReply({
        chatId: fu.customer.phone,
        replyText: messageText,
        tenantId,
        singleBubble: true, // Follow-up selalu dikirim dalam 1 bubble utuh (tidak dipecah multi-bubble)
      });

      // FIX 173i-a: DILARANG menandai SENT bila kirim WAHA gagal. Sebelumnya
      // hasil kirim diabaikan → notifikasi customer yang gagal menjadi
      // "sukses palsu" yang tidak pernah diretry.
      if (!sendResult || (sendResult as any).success !== true) {
        const reason = (sendResult as any)?.error || 'simulateHumanReply returned success=false';
        console.error(`[FollowUp Worker] WAHA send failed for ${fu.id}: ${reason}`);
        try {
          await prisma.followUp.update({
            where: { id: fu.id },
            data: { status: 'FAILED' },
          });
        } catch (dbErr: any) {
          console.warn(`[FollowUp Worker] FollowUp FAILED status update warning:`, dbErr.message);
        }
        try {
          const { AlertService, AlertType, AlertSeverity } = await import('./alert.service');
          await new AlertService().notifyAlert({
            type: AlertType.FOLLOWUP_FAILED,
            severity: AlertSeverity.WARNING,
            message: `Follow-up WAHA gagal terkirim ke ${fu.customer?.phone} (type=${fu.type}).`,
            metadata: { tenantId, followUpId: fu.id, type: fu.type, reason },
          });
        } catch {}
        return false;
      }

      // Mark as SENT (hanya bila kirim benar-benar sukses)
      try {
        await prisma.followUp.update({
          where: { id: fu.id },
          data: {
            status: 'SENT',
            sent_at: new Date(),
          },
        });
      } catch (dbErr: any) {
        console.warn(`[FollowUp Worker] FollowUp status update warning:`, dbErr.message);
      }

      // Jika follow-up adalah REVIEW H+1, daftarkan follow-up NEXT_TREATMENT (+1, +2, +3 bulan)
      if (fu.type === 'REVIEW_H1_BABY' || fu.type === 'REVIEW_H1_MOMS') {
        try {
          const bookingDate = fu.reservation?.booking_date || new Date();
          await this.createNextTreatmentFollowUps(fu.customer_id, bookingDate, tenantId);
        } catch (_) {}
      }

      return true;
    } catch (err: any) {
      console.error(`[FollowUp Worker] Failed to send follow-up ${fu.id}:`, err.message);
      try {
        await prisma.followUp.update({
          where: { id: fu.id },
          data: { status: 'FAILED' },
        });
      } catch (_) {}
      return false;
    }
  }

  /**
   * Cabang WABA: kirim follow-up via HSM template (patuh regulasi Meta).
   * Gatekeeper consent: MARKETING wajib marketing_opt_in=true, selain itu SKIPPED.
   * Template yang belum APPROVED di-skip (PENDING/REJECTED/PAUSED) + log + alert admin.
   */
  private async executeFollowUpWaba(
    fu: any,
    templateType: FollowUpTemplateType,
    name: string,
    tenantId: string
  ): Promise<boolean> {
    try {
      const gateway = await resolveGatewayForTenant(tenantId);
      const variant = fu.variant ? Math.min(3, Math.max(1, fu.variant)) : getRollingVariant(fu.customer_id || fu.customer?.id || '', fu.scheduled_at);
      const mapping = await wabaTemplateService.getTemplateMapping(tenantId, templateType, variant);

      // 1. Template status: hanya APPROVED + is_active yang layak dikirim
      if (!wabaTemplateService.isUsable(mapping)) {
        console.warn(`[FollowUp WABA] Template ${templateType} status=${mapping.status} (tenant=${tenantId}). Skipped: NOT_APPROVED.`);
        await prisma.followUp.update({
          where: { id: fu.id },
          data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.WABA_TEMPLATE_NOT_APPROVED },
        });
        this.notifyTemplateNotApproved(tenantId, templateType, mapping.status);
        return false;
      }

      // 2. Consent gatekeeper: MARKETING wajib opt-in.
      if (mapping.category === 'MARKETING') {
        const consent = await wabaConsentService.canSendMarketing(fu.customer);
        if (!consent.allowed) {
          console.log(`[FollowUp WABA] Skipped ${templateType} to ${fu.customer.phone}: NO_OPT_IN (tenant=${tenantId}).`);
          await prisma.followUp.update({
            where: { id: fu.id },
            data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.WABA_NO_MARKETING_CONSENT },
          });
          return false;
        }
      }

      // 3. Kirim HSM template
      console.log(`[FollowUp WABA] Sending ${templateType} (${mapping.templateName}) to ${fu.customer.phone}`);
      const components = wabaTemplateService.buildBodyComponents({ name });
      const result = await gateway.sendTemplateMessage(
        fu.customer.phone,
        mapping.templateName,
        mapping.languageCode,
        components
      );

      if (result.success) {
        try {
          const { conversationService } = await import('./conversation.service');
          const { messageService } = await import('./message.service');
          const conv = await conversationService.getOrCreateConversation(fu.customer_id, tenantId);
          if (conv) {
            await messageService.logMessage({
              tenantId,
              conversationId: conv.id,
              direction: 'OUTBOUND',
              content: `[TEMPLATE: ${mapping.templateName}]`,
              waMessageId: result.messageId,
              senderType: 'BOT',
              senderName: 'Bot (Follow-Up WABA)',
            });
          }
        } catch (_) {}

        await prisma.followUp.update({
          where: { id: fu.id },
          data: { status: 'SENT', sent_at: new Date() },
        });
        return true;
      }

      console.error(`[FollowUp WABA] Send failed ${fu.id}:`, result.error?.message);
      await prisma.followUp.update({
        where: { id: fu.id },
        data: { status: 'FAILED' },
      });
      return false;
    } catch (err: any) {
      console.error(`[FollowUp WABA] Failed to send follow-up ${fu.id}:`, err.message);
      try {
        await prisma.followUp.update({
          where: { id: fu.id },
          data: { status: 'FAILED' },
        });
      } catch (_) {}
      return false;
    }
  }

  /**
   * Notifikasi admin saat template HSM belum APPROVED (PENDING/REJECTED/PAUSED)
   */
  private async notifyTemplateNotApproved(tenantId: string, templateType: string, status: string): Promise<void> {
    try {
      const { AlertService, AlertType, AlertSeverity } = await import('./alert.service');
      const alertService = new AlertService();
      await alertService.notifyAlert({
        type: AlertType.FOLLOWUP_FAILED,
        severity: AlertSeverity.WARNING,
        message: `[WABA TEMPLATE ${status}] Template ${templateType} belum APPROVED (tenant=${tenantId}). Follow-up WABA di-skip. Segera submit/verify template di Meta.`,
        metadata: { tenantId, templateType, status },
      });
    } catch (err: any) {
      console.error('[FollowUp WABA] Failed to notify template-not-approved alert:', err.message);
    }
  }

  /**
   * Hitung slot jadwal WINBACK_60D pada jam kerja 09:30–16:00 WIB, disisipkan ke
   * kuota harian GLOBAL (FOLLOWUP_MAX_PER_DAY, default 40) — tanpa kuota khusus
   * terpisah. Beban hari dihitung dari baris PENDING/QUEUED yang sudah ada.
   */
  private async buildWinbackScheduleSlots(tenantId: string, count: number, now: Date): Promise<Date[]> {
    const maxPerDay = parsePositiveInt(process.env.FOLLOWUP_MAX_PER_DAY, 40);
    const nowWib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const startY = nowWib.getUTCFullYear();
    const startM = nowWib.getUTCMonth();
    let startD = nowWib.getUTCDate();
    // Jika jam kerja hari ini sudah lewat (>= 16:00 WIB), mulai dari besok.
    if (nowWib.getUTCHours() >= 16) startD += 1;

    const startOfTodayUtc = new Date(
      Date.UTC(nowWib.getUTCFullYear(), nowWib.getUTCMonth(), nowWib.getUTCDate()) - 7 * 60 * 60 * 1000
    );

    let existing: Array<{ scheduled_at: Date }> = [];
    try {
      existing = (await prisma.followUp.findMany({
        where: {
          tenant_id: tenantId,
          status: { in: ['PENDING', 'QUEUED'] },
          scheduled_at: { gte: startOfTodayUtc },
        },
        select: { scheduled_at: true },
      })) as any;
    } catch {
      existing = [];
    }

    const loadByDate = new Map<string, number>();
    for (const e of existing || []) {
      if (!e?.scheduled_at) continue;
      const key = getWibDateKey(e.scheduled_at);
      if (key) loadByDate.set(key, (loadByDate.get(key) || 0) + 1);
    }

    const slots: Date[] = [];
    let dayIndex = 0;
    const step = Math.max(5, Math.floor(390 / maxPerDay)); // 09:30–16:00 = 390 menit

    for (let i = 0; i < count; i++) {
      // Cari hari pertama (mulai hari ini/besok) yang bebannya masih < kuota global.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const key = new Date(Date.UTC(startY, startM, startD + dayIndex)).toISOString().slice(0, 10);
        if ((loadByDate.get(key) || 0) < maxPerDay) break;
        dayIndex++;
      }
      const key = new Date(Date.UTC(startY, startM, startD + dayIndex)).toISOString().slice(0, 10);
      const slotIndex = loadByDate.get(key) || 0;
      const offset = Math.min(389, slotIndex * step);
      // 09:30 WIB = 02:30 UTC
      slots.push(new Date(Date.UTC(startY, startM, startD + dayIndex, 2, 30 + offset, 0, 0)));
      loadByDate.set(key, slotIndex + 1);
    }

    return slots;
  }

  /**
   * Generator antrean WINBACK_60D (re-engagement pelanggan dormant MQL/legacy).
   *
   * Kandidat = semua kondisi AND (tenant-scoped, offline-safe):
   *  - status 'active', belum dihapus, bukan sandbox/internal/admin-held/bypass
   *      (memakai seam kanonis buildNonBypassCustomerWhere + isDummyOrTestContact)
   *  - is_mql = true ATAU is_legacy_source = true
   *  - dormant: last_message_at (aktivitas apa pun, termasuk outbound) <= now - 60 hari
   *  - antrean kosong: tidak ada FollowUp PENDING/QUEUED tipe apa pun (guard
   *      deterministik anti-tumpang-tindih dengan rangkaian NEXT_TREATMENT)
   *  - tanpa jadwal depan: tidak ada Reservation booking_date >= now (kecuali cancelled)
   *  - idempoten: tidak ada WINBACK_60D non-cancelled dalam 60 hari terakhir
   *
   * Jadwal disisipkan ke kuota harian global pada jam kerja, status awal QUEUED.
   */
  public async enqueueDormantWinbackFollowUps(tenantId: string = DEFAULT_TENANT_ID): Promise<number> {
    try {
      const now = new Date();
      const dormantCutoff = new Date(now.getTime() - WINBACK_DORMANT_DAYS * 24 * 60 * 60 * 1000);

      const base = buildNonBypassCustomerWhere() as any;
      const candidates = (await prisma.customer.findMany({
        where: {
          tenant_id: tenantId,
          ...base,
          status: 'active',
          deleted_at: null,
          is_internal_staff: false,
          is_hold_labeled: false,
          OR: [{ is_mql: true }, { is_legacy_source: true }],
          conversations: { every: { last_message_at: { lte: dormantCutoff } } },
          follow_ups: {
            none: {
              OR: [
                { status: { in: ['PENDING', 'QUEUED'] } },
                {
                  type: 'WINBACK_60D',
                  status: { notIn: ['CANCELLED', 'SKIPPED'] },
                  created_at: { gte: dormantCutoff },
                },
              ],
            },
          },
          reservations: {
            none: { booking_date: { gte: now }, status: { not: 'cancelled' } },
          },
        },
        select: { id: true, phone: true, name: true },
        take: WINBACK_ENQUEUE_LIMIT,
      })) as any[];

      const filtered = (candidates || []).filter((c: any) => !isDummyOrTestContact(c.phone, c.name));
      if (filtered.length === 0) return 0;

      const schedule = await this.buildWinbackScheduleSlots(tenantId, filtered.length, now);

      let created = 0;
      for (let i = 0; i < filtered.length; i++) {
        try {
          await prisma.followUp.create({
            data: {
              tenant_id: tenantId,
              customer_id: filtered[i].id,
              type: 'WINBACK_60D',
              stage: 1,
              scheduled_at: schedule[i] || now,
              status: 'QUEUED',
            },
          });
          created++;
        } catch (_) {}
      }

      if (created > 0) {
        console.log(`[FollowUp Service] Queued ${created} WINBACK_60D follow-up(s) for tenant ${tenantId} (dormant >= ${WINBACK_DORMANT_DAYS} hari).`);
      }
      return created;
    } catch (err: any) {
      console.warn('[FollowUp Service] enqueueDormantWinbackFollowUps failed:', err?.message || err);
      return 0;
    }
  }

  /**
   * Mengecek customer yang statusnya 'active' dan telah dikirimi follow-up NEXT_TREATMENT Stage 3
   * lebih dari LOST_CUSTOMER_GRACE_DAYS hari yang lalu, serta tidak melakukan booking baru sejak saat itu.
   */
  public async checkAndSetLostCustomers(tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() - LOST_CUSTOMER_GRACE_DAYS);

      const sentStage3FollowUps = await prisma.followUp.findMany({
        where: {
          type: 'NEXT_TREATMENT',
          stage: 3,
          status: 'SENT',
          sent_at: { lte: thresholdDate },
          tenant_id: tenantId,
          customer: {
            status: 'active',
            is_sandbox_test: false,
          },
        },
        include: {
          customer: true,
        },
      });

      const minSentAt = sentStage3FollowUps
        .map((f) => f.sent_at)
        .filter((d): d is Date => !!d)
        .sort((a, b) => a.getTime() - b.getTime())[0];

      let recentReservations: Array<{ customer_id: string; created_at: Date }> = [];
      if (minSentAt) {
        recentReservations = await prisma.reservation.findMany({
          where: {
            customer_id: { in: sentStage3FollowUps.map((f) => f.customer_id) },
            created_at: { gt: minSentAt },
            tenant_id: tenantId,
          },
          select: { customer_id: true, created_at: true },
        });
      }

      const hasReservationAfterSentAt = new Map<string, boolean>();
      for (const f of sentStage3FollowUps) {
        const hasReservationAfterSent = recentReservations.some(
          (r) => r.customer_id === f.customer_id && r.created_at.getTime() > f.sent_at!.getTime()
        );
        hasReservationAfterSentAt.set(f.id, hasReservationAfterSent);
      }

      for (const f of sentStage3FollowUps) {
        const hasNewReservation = hasReservationAfterSentAt.get(f.id) === true;

        if (!hasNewReservation) {
          await prisma.customer.update({
            where: { id: f.customer_id },
            data: { status: 'lost' },
          });
          console.log(`[FollowUp Service] Customer ${f.customer_id} marked as 'lost' (no new reservation ${LOST_CUSTOMER_GRACE_DAYS} days after Stage 3 follow-up).`);
        }
      }

      // --- WINBACK_60D: grace period terpisah (default 7 hari) ---
      // Bila WINBACK_60D sudah SENT > WINBACK_LOST_GRACE_DAYS hari dan customer TIDAK
      // membalas (inbound setelah sent_at) DAN TIDAK membuat reservasi baru -> 'lost'.
      // Catatan: di sini inbound MEMANG dipakai, karena yang diukur adalah respons
      // SETELAH winback terkirim (bukan penentu dormansi awal).
      try {
        const winbackThreshold = new Date();
        winbackThreshold.setDate(winbackThreshold.getDate() - WINBACK_LOST_GRACE_DAYS);

        const sentWinbacksRaw = (await prisma.followUp.findMany({
          where: {
            type: 'WINBACK_60D',
            status: 'SENT',
            sent_at: { lte: winbackThreshold },
            tenant_id: tenantId,
            customer: { status: 'active', is_sandbox_test: false },
          },
          select: { id: true, customer_id: true, sent_at: true, type: true },
        })) as any[];

        // Guard tipe (defense-in-depth): query DB sudah memfilter type WINBACK_60D,
        // namun tetap saring di JS agar baris non-WINBACK tidak ikut terproses.
        const sentWinbacks = (sentWinbacksRaw || []).filter(
          (f) => !f?.type || f.type === 'WINBACK_60D'
        );

        const winbackCustomers = Array.from(
          new Set((sentWinbacks || []).map((f) => f?.customer_id).filter(Boolean))
        );

        if (winbackCustomers.length > 0) {
          const recentRes = (await prisma.reservation
            .findMany({
              where: {
                tenant_id: tenantId,
                customer_id: { in: winbackCustomers },
                created_at: { gte: winbackThreshold },
              },
              select: { customer_id: true, created_at: true },
            })
            .catch(() => [])) as any[];

          const convs = (await prisma.conversation
            .findMany({
              where: { tenant_id: tenantId, customer_id: { in: winbackCustomers } },
              select: { customer_id: true, last_customer_message_at: true },
            })
            .catch(() => [])) as any[];

          for (const f of sentWinbacks || []) {
            if (!f?.sent_at) continue;
            const sentMs = new Date(f.sent_at).getTime();
            const respondedViaReservation = (recentRes || []).some(
              (r) => r.customer_id === f.customer_id && new Date(r.created_at).getTime() > sentMs
            );
            const respondedViaChat = (convs || []).some(
              (c) =>
                c.customer_id === f.customer_id &&
                c.last_customer_message_at &&
                new Date(c.last_customer_message_at).getTime() > sentMs
            );
            if (respondedViaReservation || respondedViaChat) continue;

            try {
              await prisma.customer.update({
                where: { id: f.customer_id },
                data: { status: 'lost' },
              });
              console.log(`[FollowUp Service] Customer ${f.customer_id} marked as 'lost' (no response/reservation ${WINBACK_LOST_GRACE_DAYS} days after WINBACK_60D).`);
            } catch (_) {}
          }
        }
      } catch (wbErr: any) {
        console.warn('[FollowUp Service] WINBACK lost-check failed:', wbErr?.message || wbErr);
      }
    } catch (err) {
      console.error('[FollowUp Service] Error checking and setting lost customers:', err);
    }
  }
}

export const followUpService = new FollowUpService();
