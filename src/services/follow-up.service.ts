import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getRollingFollowUpMessage, FollowUpTemplateType, FOLLOWUP_ROLLING_TEMPLATES } from '../config/followup-templates';
import { typingService } from './typing.service';
import { resolveGatewayForTenant } from '../integrations/whatsapp/factory';
import { wabaTemplateService } from './waba-template.service';
import { wabaConsentService } from './waba-consent.service';
import { parsePositiveInt } from '../utils/env-numeric';

// Parameter batch/throttle follow-up — env-drivable (Fase 4.3 docs/HARDCODED_FIX_PLAN.md)
const FOLLOWUP_BATCH_LIMIT = parsePositiveInt(process.env.FOLLOWUP_BATCH_LIMIT, 20);
const FOLLOWUP_THROTTLE_BASE_MS = parsePositiveInt(process.env.FOLLOWUP_THROTTLE_BASE_MS, 1500);
const LOST_CUSTOMER_GRACE_DAYS = parsePositiveInt(process.env.LOST_CUSTOMER_GRACE_DAYS, 3);

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
      // Idempotensi: jika sudah ada row NEXT_TREATMENT aktif (belum terkirim) untuk
      // customer ini, jangan buat duplikat (pemanggilan ganda / retry cron).
      const existing = await prisma.followUp.findFirst({
        where: {
          customer_id: customerId,
          type: 'NEXT_TREATMENT',
          tenant_id: tenantId,
          status: { in: ['PENDING', 'QUEUED'] },
        },
      });

      if (existing) {
        console.log(`[FollowUp Service] NEXT_TREATMENT follow-ups already exist for customer: ${customerId}. Skipping (idempotent).`);
        return;
      }

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
   * Dipanggil oleh CronWorker (misal setiap 15 menit) untuk mencari & mengeksekusi
   * follow-up PENDING yang waktunya sudah tiba (scheduled_at <= NOW()).
   */
  public async processDueFollowUps(tenantId: string = DEFAULT_TENANT_ID): Promise<number> {
    try {
      const now = new Date();
      const dueFollowUps = await prisma.followUp.findMany({
        where: {
          tenant_id: tenantId,
          status: 'PENDING',
          scheduled_at: { lte: now },
          customer: {
            status: { not: 'blocked' },
          },
        },
        include: {
          customer: {
            include: {
              children: true,
            },
          },
        },
        // Order deterministik (anti-starvation): paling lama jatuh tempo diproses
        // lebih dulu; tanpa orderBy, subset arbitrer tiap run bisa membuat customer
        // tertentu kelaparan selamanya.
        orderBy: [{ scheduled_at: 'asc' }, { created_at: 'asc' }],
        take: FOLLOWUP_BATCH_LIMIT, // Batch limit per execution (env FOLLOWUP_BATCH_LIMIT)
      });

      if (dueFollowUps.length === 0) {
        return 0;
      }

      console.log(`[FollowUp Worker] Found ${dueFollowUps.length} due follow-ups to process.`);
      let processed = 0;

      for (const fu of dueFollowUps) {
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

      const name = fu.customer.name || 'Bunda';

      // Provider-aware send: WABA → HSM template + consent gatekeeper; WAHA → rolling text (existing)
      const gateway = await resolveGatewayForTenant(tenantId);
      if (gateway.providerType === 'WABA') {
        return this.executeFollowUpWaba(fu, templateType, name, tenantId);
      }

      let messageText: string;

      // Cek apakah ada template custom di DB untuk type+variant ini
      try {
        const custom = await prisma.followUpTemplate.findFirst({
          where: { tenant_id: tenantId, type: templateType, variant: fu.stage, is_active: true },
        });
        if (custom) {
          // Replacing placeholders in custom template
          messageText = custom.text
            .replace(/\{name\}/g, name)
            .replace(/\{time\}/g, '')
            .replace(/\{babyName\}/g, 'si kecil');
        } else {
          const { text } = getRollingFollowUpMessage(templateType, {
            name,
            index: fu.stage - 1,
          });
          messageText = text;
        }
      } catch (err) {
        // DB fallback -> gunakan default
        const { text } = getRollingFollowUpMessage(templateType, {
          name,
          index: fu.stage - 1,
        });
        messageText = text;
      }

      console.log(`[FollowUp Worker] Sending ${fu.type} Stage ${fu.stage} to ${fu.customer.phone} (${name})`);
      
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
      // Kategori diambil dari mapping DB (kategori template yang benar-benar
      // di-approve Meta), bukan dari tipe follow-up.
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

      // Error 131026: di luar 24h window / teks bebas ditolak → sudah pakai HSM, tetap gagal
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
   * Notifikasi admin saat template HSM belum APPROVED (PENDING/REJECTED/PAUSED),
   * sehingga admin segera submit/verifikasi template di Meta.
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
   * Mengubah status mereka menjadi 'lost'.
   */
  public async checkAndSetLostCustomers(tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() - LOST_CUSTOMER_GRACE_DAYS);

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
          console.log(`[FollowUp Service] Customer ${f.customer_id} marked as 'lost' (no new reservation ${LOST_CUSTOMER_GRACE_DAYS} days after Stage 3 follow-up).`);
        }
      }
    } catch (err) {
      console.error('[FollowUp Service] Error checking and setting lost customers:', err);
    }
  }
}

export const followUpService = new FollowUpService();
