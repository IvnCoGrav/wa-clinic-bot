import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getRollingFollowUpMessage, FollowUpTemplateType, FOLLOWUP_ROLLING_TEMPLATES } from '../config/followup-templates';
import { typingService } from './typing.service';
import { resolveGatewayForTenant } from '../integrations/whatsapp/factory';
import { wabaTemplateService } from './waba-template.service';
import { wabaConsentService } from './waba-consent.service';
import { parsePositiveInt } from '../utils/env-numeric';
import { isDummyOrTestContact } from '../utils/dummy-filter';
import {
  sanitizeCustomerNameForGreeting,
  formatGreetingBunda,
  formatBabyNamesForGreeting,
} from '../utils/name-sanitizer';

// Parameter batch/throttle follow-up — env-drivable (Fase 4.3 docs/HARDCODED_FIX_PLAN.md)
const FOLLOWUP_BATCH_LIMIT = parsePositiveInt(process.env.FOLLOWUP_BATCH_LIMIT, 20);
const FOLLOWUP_THROTTLE_BASE_MS = parsePositiveInt(process.env.FOLLOWUP_THROTTLE_BASE_MS, 1500);
const LOST_CUSTOMER_GRACE_DAYS = parsePositiveInt(process.env.LOST_CUSTOMER_GRACE_DAYS, 3);
const FOLLOWUP_RECENT_CHAT_COOLDOWN_HOURS = parsePositiveInt(process.env.FOLLOWUP_RECENT_CHAT_COOLDOWN_HOURS, 72);

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
          include: {
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
                    last_message_at: true,
                    is_human_handling: true,
                  },
                  take: 1,
                  orderBy: { last_message_at: 'desc' },
                },
              },
            },
          },
          orderBy,
          skip,
          take: pageSize,
        }),
      ]);

      return {
        data,
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
      // 1. Verifikasi customer bukan akun sandbox/dummy test (offline-safe)
      try {
        const customer = await prisma.customer?.findUnique?.({ where: { id: customerId } });
        if (customer && (customer.is_sandbox_test || isDummyOrTestContact(customer.phone, customer.name))) {
          return;
        }
      } catch (_) {}

      // 2. Cek apakah sudah ada antrian NO_PURCHASE aktif (idempoten)
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
      } catch (_) {}

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
   * Dipanggil saat reservasi baru dibuat (status pending).
   * Membatalkan semua follow-up pending/queued untuk customer ini,
   * dan menandai is_repeat_order jika ada follow-up pending yang aktif.
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
        // Tandai reservasi ini sebagai repeat order
        try {
          await prisma.reservation?.update?.({
            where: { id: reservationId },
            data: { is_repeat_order: true },
          });
        } catch (_) {}

        // Batalkan semua follow-up aktif tersebut
        try {
          await prisma.followUp?.updateMany?.({
            where: {
              id: { in: activeFollowUps.map(f => f.id) },
            },
            data: { status: 'CANCELLED' },
          });
        } catch (_) {}
        console.log(`[FollowUp Service] Cancelled ${activeFollowUps.length} active follow-ups for customer: ${customerId}. Set is_repeat_order = true.`);
      }
    } catch (err) {
      console.error('[FollowUp Service] Error handling reservation creation event:', err);
    }
  }

  /**
   * Dipanggil saat reservasi dikonfirmasi/rescheduled/selesai.
   * Membuat 3 row follow-up PENDING tipe NEXT_TREATMENT (+1, +2, +3 bulan) di antrian.
   */
  public async createNextTreatmentFollowUps(customerId: string, bookingDate: Date, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      // 1. Verifikasi customer bukan akun sandbox/dummy test (offline-safe)
      try {
        const customer = await prisma.customer?.findUnique?.({ where: { id: customerId } });
        if (customer && (customer.is_sandbox_test || isDummyOrTestContact(customer.phone, customer.name))) {
          return;
        }
      } catch (_) {}

      // Idempotensi: jika sudah ada row NEXT_TREATMENT aktif untuk customer ini, jangan buat duplikat
      let existing = null;
      try {
        existing = await prisma.followUp?.findFirst?.({
          where: {
            customer_id: customerId,
            type: 'NEXT_TREATMENT',
            tenant_id: tenantId,
            status: { in: ['PENDING', 'QUEUED'] },
          },
        });
      } catch (_) {}

      if (existing) {
        console.log(`[FollowUp Service] NEXT_TREATMENT follow-ups already exist for customer: ${customerId}. Skipping (idempotent).`);
        return;
      }

      // Buat 3 stage follow-up (+1, +2, +3 bulan)
      const stages = [1, 2, 3];
      
      await Promise.all(
        stages.map(async (stage) => {
          const scheduledAt = new Date(bookingDate);
          scheduledAt.setMonth(scheduledAt.getMonth() + stage);
          
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
          } catch (_) {}
        })
      );
      console.log(`[FollowUp Service] Queued NEXT_TREATMENT follow-ups for customer: ${customerId}`);
    } catch (err) {
      console.error('[FollowUp Service] Failed to create NEXT_TREATMENT follow-ups:', err);
    }
  }

  /**
   * Manual Send (Approve & Send Now) — dipanggil dari Admin Dashboard.
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
   * Cancel single follow-up
   */
  public async cancelFollowUp(id: string, tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
    const res = await prisma.followUp.updateMany({
      where: { id, tenant_id: tenantId },
      data: { status: 'CANCELLED' },
    });
    return res.count > 0;
  }

  /**
   * Bulk cancel follow-ups (misal semua PENDING atau QUEUED)
   */
  public async bulkCancelFollowUps(tenantId: string = DEFAULT_TENANT_ID, status: string = 'PENDING'): Promise<number> {
    const res = await prisma.followUp.updateMany({
      where: { tenant_id: tenantId, status: status as any },
      data: { status: 'CANCELLED' },
    });
    console.log(`[FollowUp Service] Bulk cancelled ${res.count} follow-ups with status ${status}.`);
    return res.count;
  }

  /**
   * Reschedule follow-up (ubah tanggal/jam jadwal kirim).
   */
  public async rescheduleFollowUp(id: string, newDate: Date, tenantId: string = DEFAULT_TENANT_ID): Promise<any> {
    const existing = await prisma.followUp.findFirst({
      where: { id, tenant_id: tenantId },
    });

    if (!existing) {
      throw new Error(`Follow-up #${id} tidak ditemukan.`);
    }

    return prisma.followUp.update({
      where: { id },
      data: {
        scheduled_at: newDate,
      },
      include: {
        customer: true,
      },
    });
  }

  /**
   * Majukan seluruh follow-up PENDING yang tanggalnya sebelum tanggal target (overdue)
   * dan jadwalkan merata dengan kuota maksimal per hari (default: 10 pesan/hari) pada jam kerja (09:00 - 16:00 WIB).
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
    const maxPerDay = Math.max(1, options.maxPerDay || 10);

    let baseDate: Date;
    if (options.startDate) {
      baseDate = new Date(options.startDate);
    } else {
      baseDate = new Date();
      // jika jam sekarang sudah >= 16:00 WIB, mulai dari besok pagi
      const currentWibHour = (baseDate.getUTCHours() + 7) % 24;
      if (currentWibHour >= 16) {
        baseDate.setDate(baseDate.getDate() + 1);
      }
    }
    baseDate.setHours(9, 0, 0, 0);

    const overdueFollowUps = await prisma.followUp.findMany({
      where: {
        tenant_id: tenantId,
        status: 'PENDING',
        scheduled_at: { lt: baseDate },
      },
      orderBy: [{ scheduled_at: 'asc' }, { created_at: 'asc' }],
    });

    if (overdueFollowUps.length === 0) {
      return { rescheduledCount: 0, daysCount: 0, distribution: {} };
    }

    const distribution: Record<string, number> = {};
    let currentDayIndex = 0;
    let countInCurrentDay = 0;

    // Stagger hours during the day (09:00, 09:40, 10:20, 11:00, 11:40, 13:00, 13:40, 14:20, 15:00, 15:40)
    const slotMinutes = [0, 40, 80, 120, 160, 240, 280, 320, 360, 400];

    for (const fu of overdueFollowUps) {
      if (countInCurrentDay >= maxPerDay) {
        currentDayIndex++;
        countInCurrentDay = 0;
      }

      const targetDate = new Date(baseDate);
      targetDate.setDate(targetDate.getDate() + currentDayIndex);

      const offsetMin = slotMinutes[countInCurrentDay % slotMinutes.length] || (countInCurrentDay * 30);
      targetDate.setHours(9, 0, 0, 0);
      targetDate.setMinutes(targetDate.getMinutes() + offsetMin);

      await prisma.followUp.update({
        where: { id: fu.id },
        data: { scheduled_at: targetDate },
      });

      const dateStr = targetDate.toISOString().split('T')[0];
      distribution[dateStr] = (distribution[dateStr] || 0) + 1;
      countInCurrentDay++;
    }

    console.log(`[FollowUp Service] Rescheduled ${overdueFollowUps.length} overdue follow-ups across ${currentDayIndex + 1} days (max ${maxPerDay}/day).`);
    return {
      rescheduledCount: overdueFollowUps.length,
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
    const targetStatuses = process.env.AUTO_FOLLOWUP_ENABLED === 'true'
      ? ['QUEUED', 'PENDING']
      : ['QUEUED'];

    try {
      const now = new Date();
      const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

      const rawDueFollowUps = await prisma.followUp.findMany({
        where: {
          tenant_id: tenantId,
          status: { in: targetStatuses as any },
          scheduled_at: { lte: now },
          customer: {
            status: { not: 'blocked' },
            is_sandbox_test: false,
          },
        },
        include: {
          customer: {
            include: {
              children: true,
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
      const dueFollowUps = rawDueFollowUps || [];

      if (!dueFollowUps || dueFollowUps.length === 0) {
        return 0;
      }

      console.log(`[FollowUp Worker] Found ${dueFollowUps.length} due follow-ups to process (${targetStatuses.join('/')} mode, scheduled_at <= now).`);
      let processed = 0;
      const cooldownHours = parsePositiveInt(process.env.FOLLOWUP_RECENT_CHAT_COOLDOWN_HOURS, 72);
      const cooldownMs = cooldownHours * 60 * 60 * 1000;

      for (const fu of dueFollowUps) {
        // Anti-blast overdue protection: jika jadwal sudah terlewat lebih dari 48 jam, tandai SKIPPED
        if (fu.scheduled_at < fortyEightHoursAgo) {
          console.warn(`[FollowUp Worker] FollowUp #${fu.id} (${fu.customer?.phone}) is overdue (>48h). Marked as SKIPPED to prevent spam blast.`);
          await prisma.followUp.update({
            where: { id: fu.id },
            data: { status: 'SKIPPED' },
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
   * 4) Umur bayi ≈ milestone (3/6/9/12) dlm rentang ±1 bulan (env MILESTONE_WINDOW_DAYS).
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
        templateType = `NO_PURCHASE_${Math.min(3, Math.max(1, fu.stage))}` as any;
      } else if (fu.type === 'NEXT_TREATMENT') {
        templateType = `NEXT_TREATMENT_${Math.min(3, Math.max(1, fu.stage))}` as any;
      }

      const cleanName = sanitizeCustomerNameForGreeting(fu.customer?.name);
      const greetingName = formatGreetingBunda(cleanName);
      const babyName = formatBabyNamesForGreeting(fu.customer?.children, null, { prefixDek: true });

      // Provider-aware send: WABA → HSM template + consent gatekeeper; WAHA → rolling text (existing)
      const gateway = await resolveGatewayForTenant(tenantId);
      if (gateway.providerType === 'WABA') {
        return this.executeFollowUpWaba(fu, templateType, cleanName || 'Bunda', tenantId);
      }

      let messageText: string;

      // Cek apakah ada template custom di DB untuk type+variant ini
      try {
        const custom = await prisma.followUpTemplate.findFirst({
          where: { tenant_id: tenantId, type: templateType, variant: fu.stage, is_active: true },
        });
        if (custom) {
          // Replacing placeholders in custom template with smart context
          messageText = custom.text
            .replace(/Bunda\s*\{name\}/gi, greetingName)
            .replace(/\{name\}/g, cleanName || 'Bunda')
            .replace(/\{time\}/g, '')
            .replace(/\{babyName\}/g, babyName)
            .replace(/Bunda\s+Bunda/gi, 'Bunda')
            .replace(/dek\s+dek\s+/gi, 'dek ')
            .replace(/dek\s+si kecil/gi, 'si kecil')
            .replace(/\s{2,}/g, ' ')
            .trim();
        } else {
          const { text } = getRollingFollowUpMessage(templateType, {
            name: cleanName,
            babyName,
            index: fu.stage - 1,
          });
          messageText = text;
        }
      } catch (err) {
        // DB fallback -> gunakan default
        const { text } = getRollingFollowUpMessage(templateType, {
          name: cleanName,
          babyName,
          index: fu.stage - 1,
        });
        messageText = text;
      }

      console.log(`[FollowUp Worker] Sending ${fu.type} Stage ${fu.stage} to ${fu.customer.phone} (${greetingName}, Baby: ${babyName})`);
      
      // Throttling acak antar customer (env: FOLLOWUP_THROTTLE_BASE_MS s/d +FOLLOWUP_THROTTLE_BASE_MS*10, default 5-15 detik)
      const isTest = process.env.NODE_ENV === 'test';
      if (!isTest) {
        const delay = Math.floor(Math.random() * FOLLOWUP_THROTTLE_BASE_MS * 10) + FOLLOWUP_THROTTLE_BASE_MS;
        await new Promise((r) => setTimeout(r, delay));
      }

      await typingService.simulateHumanReply({
        chatId: fu.customer.phone,
        replyText: messageText,
      });

      // Mark as SENT
      await prisma.followUp.update({
        where: { id: fu.id },
        data: {
          status: 'SENT',
          sent_at: new Date(),
        },
      });

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
      const variant = Math.min(3, Math.max(1, fu.stage || 1));
      const mapping = await wabaTemplateService.getTemplateMapping(tenantId, templateType, variant);

      // 1. Template status: hanya APPROVED + is_active yang layak dikirim
      if (!wabaTemplateService.isUsable(mapping)) {
        console.warn(`[FollowUp WABA] Template ${templateType} status=${mapping.status} (tenant=${tenantId}). Skipped: NOT_APPROVED.`);
        await prisma.followUp.update({
          where: { id: fu.id },
          data: { status: 'SKIPPED' },
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
            data: { status: 'SKIPPED' },
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
    } catch (err) {
      console.error('[FollowUp Service] Error checking and setting lost customers:', err);
    }
  }
}

export const followUpService = new FollowUpService();
