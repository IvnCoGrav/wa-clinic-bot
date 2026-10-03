import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { TEMPLATES } from '../config/persona';
import { typingService } from './typing.service';
import { followUpService } from './follow-up.service';
import {
  sanitizeCustomerNameForGreeting,
  formatBabyNamesForGreeting,
} from '../utils/name-sanitizer';

export class CronService {
  /**
   * Menjalankan pekerjaan pengingat pagi Hari-H & Follow-Up H+1 (biasanya dijalankan jam 06:00)
   */
  public async runMorningJobs(): Promise<void> {
    try {
      console.log('[Cron Service] Starting Morning Jobs...');
      const { getAllTenantIds } = await import('./media.service');
      const tenantIds = await getAllTenantIds();
      for (const tenantId of tenantIds) {
        try {
          const wb = await followUpService.enqueueDormantWinbackFollowUps(tenantId);
          if (wb > 0) console.log(`[Cron] Queued ${wb} WINBACK_60D follow-ups (tenant ${tenantId}).`);
        } catch (e: any) {
          console.warn('[Cron] enqueueDormantWinbackFollowUps failed:', e?.message);
        }
        await followUpService.processDueFollowUps(tenantId);
        try {
          const rec = await followUpService.reconcileOrphanedCompletedFollowUps(tenantId);
          if (rec.reconciledCount > 0) console.log(`[Cron] Reconciled ${rec.reconciledCount} orphaned NEXT_TREATMENT (tenant ${tenantId}).`);
        } catch (e: any) {
          console.warn('[Cron] reconcileOrphanedCompletedFollowUps failed:', e?.message);
        }
        await followUpService.checkAndSetLostCustomers(tenantId);
        await this.checkPendingPurchaseModerationAlerts(tenantId);
        const { staffNotificationService } = await import('./staff-notification.service');
        await staffNotificationService.sendAllStaffMorningBriefings(tenantId);
      }
      await this.cleanupOldAdClicks();
      await this.purgeOldLegacyStaging();

      console.log('[Cron Service] Morning Jobs Completed successfully.');
    } catch (err) {
      console.error('[Cron Service] Error running morning jobs:', err);
    }
  }

  /**
   * Worker periodik (misal 15 menit sekali) untuk memproses antrian Follow-Up PENDING
   */
  public async runFollowUpWorker(): Promise<void> {
    try {
      const { getAllTenantIds } = await import('./media.service');
      const tenantIds = await getAllTenantIds();
      let total = 0;
      for (const tenantId of tenantIds) {
        total += await followUpService.processDueFollowUps(tenantId);
      }
      if (total > 0) console.log(`[Cron Service] FollowUp Worker processed ${total} messages.`);
    } catch (err) {
      console.error('[Cron Service] Error running FollowUp worker:', err);
    }
  }

  /**
   * Label reconciliation (Task 7) — re-sync label WA vs status DB.
   * Best-effort; dipanggil dari boot app.ts via setInterval (gated oleh
   * ENABLE_LABEL_RECONCILIATION_CRON).
   */
  public async runLabelReconciliation(): Promise<void> {
    try {
      const { labelReconciliationService } = await import('./label-reconciliation.service');
      const { getAllTenantIds } = await import('./media.service');
      const tenantIds = await getAllTenantIds();
      let driftsFound = 0, driftsFixed = 0;
      for (const tenantId of tenantIds) {
        const r = await labelReconciliationService.reconcileLabels(tenantId);
        driftsFound += r.driftsFound || 0;
        driftsFixed += r.driftsFixed || 0;
      }
      console.log(`[Cron Service] Label reconciliation complete (drifts found: ${driftsFound}, fixed: ${driftsFixed}).`);
    } catch (err) {
      console.error('[Cron Service] Error running label reconciliation:', err);
    }
  }

  /**
   * Media Cleanup — hapus file media Live Chat (outbound & inbound) yang umurnya
   * melebihi media_retention_days per tenant (fallback env MEDIA_RETENTION_DAYS).
   * Dipanggil dari boot app.ts via setInterval (gated ENABLE_MEDIA_CLEANUP_CRON).
   */
  public async runMediaCleanup(): Promise<void> {
    try {
      const { mediaService, getAllTenantIds } = await import('./media.service');
      const tenants = await getAllTenantIds();
      let removed = 0;
      for (const tenantId of tenants) {
        const retention = await mediaService.getRetentionDays(tenantId);
        removed += await mediaService.deleteExpiredMedia(tenantId, retention);
      }
      if (removed > 0) {
        console.log(`[Cron Service] Media cleanup selesai (${removed} file kadaluarsa dihapus).`);
      }
    } catch (err) {
      console.error('[Cron Service] Error running media cleanup:', (err as Error).message);
    }
  }

  /**
   * Retensi pesan (teks chat) — hapus record messages yang umurnya melebihi
   * message_retention_days per tenant (fallback env MESSAGE_RETENTION_DAYS).
   * File media (thumb) yang hanya dirujuk pesan terhapus ikut dibersihkan.
   * Customer & conversation (data CRM) tetap dipertahankan.
   */
  public async runMessageRetentionCleanup(): Promise<void> {
    try {
      const { mediaService, getAllTenantIds } = await import('./media.service');
      const tenants = await getAllTenantIds();
      let deleted = 0;
      let mediaFiles = 0;
      for (const tenantId of tenants) {
        const retention = await mediaService.getMessageRetentionDays(tenantId);
        const res = await mediaService.deleteExpiredMessages(tenantId, retention);
        deleted += res.deleted;
        mediaFiles += res.mediaFiles;
      }
      if (deleted > 0 || mediaFiles > 0) {
        console.log(`[Cron Service] Message retention selesai (${deleted} pesan > retensi dihapus, ${mediaFiles} file media dibersihkan).`);
      }
    } catch (err) {
      console.error('[Cron Service] Error running message retention cleanup:', (err as Error).message);
    }
  }

  /**
   * Daily Chat Export — regenerate file markdown `daily-chats-YYYY-MM-DD.md`
   * (percakapan hari ini) untuk analisa AI kualitas balasan bot.
   * Best-effort: DB offline → silent, tidak mengganggu produksi.
   * Di-trigger dari boot app.ts via setInterval (gated ENABLE_CHAT_EXPORT_CRON).
   */
  public async runDailyChatExport(): Promise<void> {
    try {
      const { chatExportService, formatLocalDate } = await import('./chat-export.service');
      const today = formatLocalDate();
      const result = await chatExportService.saveDayExport(DEFAULT_TENANT_ID, today);
      if (result.success) {
        console.log(
          `[Cron Service] Daily chat export selesai (${today}): ${result.stats.totalConversations} percakapan, ${result.stats.totalMessages} pesan → ${result.fileName}`
        );
      } else {
        console.warn(`[Cron Service] Daily chat export gagal (${today}): ${result.error}`);
      }
    } catch (err) {
      console.error('[Cron Service] Error running daily chat export:', (err as Error).message);
    }
  }

  /**
   * Mengirim reminder untuk reservasi hari ini dengan laju pengiriman throttled (Priority Safety Bypass)
   */
  private async sendMorningReminders(): Promise<void> {
    const { whatsappProviderService } = await import('./whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(DEFAULT_TENANT_ID);
    if (isCutOff) {
      console.log(`[Cron Service] Outbound Cut-Off is ACTIVE. Skipping morning reminders.`);
      return;
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const todayReservations = await prisma.reservation.findMany({
      where: {
        status: 'confirmed',
        booking_date: {
          gte: startOfToday,
          lte: endOfToday,
        },
        tenant_id: DEFAULT_TENANT_ID,
      },
      include: { customer: true },
    });

    console.log(`[Cron Service] Found ${todayReservations.length} confirmed reservations for today.`);

    // Urutkan berdasarkan booking_date ASCENDING
    todayReservations.sort((a, b) => {
      if (!a.booking_date || !b.booking_date) return 0;
      return a.booking_date.getTime() - b.booking_date.getTime();
    });

    let accumulatedDelayMs = 0;

    for (const res of todayReservations) {
      if (!res.customer || !res.booking_date) continue;

      const now = new Date();
      const timeToTreatment = res.booking_date.getTime() - now.getTime();

      // Estimasi waktu kirim dengan safety buffer (max jitter 45s + 5s typing simulation)
      const maxJitter = 45000;
      const typingTime = 5000;
      const estimatedDuration = maxJitter + typingTime;

      // Pengaman Prioritas: jika delay antrian terakumulasi melebihi waktu dimulainya treatment, bypass throttle!
      const shouldBypassThrottle = (accumulatedDelayMs + estimatedDuration) >= timeToTreatment;

      if (!shouldBypassThrottle) {
        // Throttling normal: jeda acak 20-45 detik
        const isTest = process.env.NODE_ENV === 'test';
        const jitter = isTest ? 1 : Math.floor(Math.random() * (45000 - 20000 + 1)) + 20000;

        console.log(`[Cron Service] Throttling morning reminder: waiting for ${jitter / 1000}s`);
        await new Promise((resolve) => setTimeout(resolve, jitter));
        accumulatedDelayMs += jitter;
      } else {
        console.log(`[Cron Service] Bypassing throttle for urgent reminder: booking at ${res.booking_date.toISOString()}`);
      }

      const customerName = sanitizeCustomerNameForGreeting(res.customer.name);
      const timeStr = this.formatTime(res.booking_date);

      const messageText = TEMPLATES.morningReminder({
        name: customerName,
        time: timeStr,
      });

      console.log(`[Cron Service] Sending morning reminder to ${res.customer.phone} (${customerName || 'Bunda'})`);
      const targetTenantId = res.tenant_id || DEFAULT_TENANT_ID;

      // Pre-log pesan reminder ke tabel messages untuk Live Chat
      try {
        const { conversationService } = await import('./conversation.service');
        const { messageService } = await import('./message.service');
        const conv = await conversationService.getOrCreateConversation(res.customer_id, targetTenantId);
        if (conv) {
          await messageService.logMessage({
            tenantId: targetTenantId,
            conversationId: conv.id,
            direction: 'OUTBOUND',
            content: messageText,
            senderType: 'BOT',
            senderName: 'Bot (Morning Reminder)',
          });
        }
      } catch (logErr: any) {
        console.warn('[Cron Service] Failed to log morning reminder to messages:', logErr.message);
      }

      await typingService.simulateHumanReply({
        chatId: res.customer.phone,
        replyText: messageText,
        tenantId: targetTenantId,
      });
    }
  }

  /**
   * @deprecated MT-1.5 — REVIEW_H1 dipostpone permanen (follow-up.service processDueFollowUps skip REMINDER/REVIEW),
   * dan NEXT_TREATMENT kini dijadwalkan via reservationLifecycleService.onReservationCompleted (dekopling dari REVIEW).
   * Method ini dead-code (tidak dipanggil runMorningJobs); dipertahankan stub agar tidak break import, lihat KNOWN_ISSUES.
   * Jika H+1 diaktifkan kembali, wire ulang secara eksplisit dan hapus deprecasi ini.
   */
  private async sendYesterdayReviewsAndScheduleNextFollowups(): Promise<void> {
    const { whatsappProviderService } = await import('./whatsapp-provider.service');
    const isCutOff = await whatsappProviderService.isOutboundCutOff(DEFAULT_TENANT_ID);
    if (isCutOff) {
      console.log(`[Cron Service] Outbound Cut-Off is ACTIVE. Skipping yesterday reviews.`);
      return;
    }

    const startOfYesterday = new Date();
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    startOfYesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date();
    endOfYesterday.setDate(endOfYesterday.getDate() - 1);
    endOfYesterday.setHours(23, 59, 59, 999);

    const yesterdayReservations = await prisma.reservation.findMany({
      where: {
        // `completed` ikut dihitung: admin yang menandai Treatment Selesai di
        // hari-H tidak boleh membuat review H+1 hilang (kanonis patient-lifecycle).
        status: { in: ['confirmed', 'en_route', 'completed'] },
        booking_date: {
          gte: startOfYesterday,
          lte: endOfYesterday,
        },
        tenant_id: DEFAULT_TENANT_ID,
      },
      include: {
        customer: {
          include: { children: true },
        },
      },
    });

    console.log(`[Cron Service] Found ${yesterdayReservations.length} confirmed/completed reservations booked yesterday.`);

    for (const res of yesterdayReservations) {
      if (!res.customer || !res.booking_date) continue;

      const customerName = sanitizeCustomerNameForGreeting(res.customer.name);
      let messageText = '';

      // 1. Tentukan template review berdasarkan kategori
      if (res.treatment_category === 'BABY' || res.treatment_category === 'BOTH') {
        const babyName = formatBabyNamesForGreeting(res.customer.children, res.raw_text, { prefixDek: true });
        messageText = TEMPLATES.followUpReviewBaby({
          name: customerName,
          babyName,
        });
      } else {
        // MOMS
        messageText = TEMPLATES.followUpReviewMoms({
          name: customerName,
        });
      }

      // 2. Kirim pesan review H+1
      console.log(`[Cron Service] Sending H+1 review to ${res.customer.phone} (${customerName || 'Bunda'}, Baby: ${res.treatment_category === 'MOMS' ? '-' : 'bayi'})`);
      const targetTenantId = res.tenant_id || DEFAULT_TENANT_ID;

      // Pre-log pesan review H+1 ke tabel messages untuk Live Chat
      try {
        const { conversationService } = await import('./conversation.service');
        const { messageService } = await import('./message.service');
        const conv = await conversationService.getOrCreateConversation(res.customer_id, targetTenantId);
        if (conv) {
          await messageService.logMessage({
            tenantId: targetTenantId,
            conversationId: conv.id,
            direction: 'OUTBOUND',
            content: messageText,
            senderType: 'BOT',
            senderName: 'Bot (Review H+1)',
          });
        }
      } catch (logErr: any) {
        console.warn('[Cron Service] Failed to log H+1 review to messages:', logErr.message);
      }

      await typingService.simulateHumanReply({
        chatId: res.customer.phone,
        replyText: messageText,
        tenantId: targetTenantId,
      });

      // 3. [MT-1.5] NEXT_TREATMENT dinetralkan — sudah dijadwalkan via onReservationCompleted (seam terpusat).
      //     Jika H+1 diaktifkan kembali, panggil reservationLifecycleService.onReservationCompleted di sini.
      void followUpService;
    }
  }

  /**
   * Helper format Date ke string HH:MM
   */
  private formatTime(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  /**
   * Memeriksa status session WAHA secara berkala. Jika session terputus/down,
   * log warning kritis dan simpan status/kirim notifikasi alert ke slack/telegram.
   */
  public async monitorWahaSession(): Promise<void> {
    try {
      const { wahaClient } = await import('../integrations/waha/client');
      const status = await wahaClient.getSessionStatus();
      console.log(`[Cron Service] WAHA Session Status check: ${status}`);

      if (status !== 'WORKING') {
        console.error(`[CRITICAL ALERT] WAHA Session is offline/down! Status: ${status}`);
        
        // Simulasi pengiriman alert ke Slack/Telegram webhook
        const webhookUrl = process.env.ALERT_WEBHOOK_URL;
        if (webhookUrl) {
          const axios = (await import('axios')).default;
          await axios.post(webhookUrl, {
            text: `⚠️ [CRITICAL ALERT] WAHA Session is offline/down! Status: ${status}. Silakan periksa koneksi WhatsApp Web atau lakukan scan ulang QR code.`,
          }).catch(err => {
            console.error('[Alert Sender] Failed to send webhook alert:', err.message);
          });
        }
      }
    } catch (err: any) {
      console.error('[Cron Service] Error monitoring WAHA session:', err.message);
    }
  }

  /**
/**
   * LLM-as-Judge — evaluasi kualitas balasan bot otomatis untuk SEMUA tenant.
   * Idempoten & best-effort: DB/LLM down → silent, tidak pernah mengganggu produksi.
   * Di-trigger dari boot app.ts via setInterval (gated ENABLE_AI_EVAL_CRON).
   */
  public async runQualityEvaluation(): Promise<void> {
    try {
      const { llmEvaluatorService } = await import('./llm-evaluator.service');
      const { getAllTenantIds } = await import('./media.service');
      const tenants = await getAllTenantIds();
      const samplingPercent = parseInt(process.env.AI_EVAL_SAMPLING_PERCENT || '10', 10);
      let evaluated = 0;
      for (const tenantId of tenants) {
        evaluated += await llmEvaluatorService.sampleAndEvaluate(tenantId, samplingPercent);
      }
      if (evaluated > 0) {
        console.log(`[Cron Service] AI quality evaluation selesai (${evaluated} pesan dievaluasi).`);
      }
    } catch (err) {
      console.error('[Cron Service] Error running AI quality evaluation:', (err as Error).message);
    }
  }

  /**
   * Me-release trackingCode dari record AdClick yang berumur > 100 hari dan tidak menghasilkan penjualan 
   * (belum/tidak confirm, atau customer berstatus lost).
   * CATATAN ARSITEKTUR (REKONSILIASI ROI):
   * Record AdClick TIDAK di-hard-delete agar histori atribusi iklan (fbclid, fbp, fbc, UTMs) 
   * tetap tersimpan permanen untuk pelaporan ROI & performa kampanye. Hanya trackingCode-nya 
   * yang di-set ke NULL (released) agar kode alfanumerik 2-4 karakter dapat digunakan kembali.
   */
  public async cleanupOldAdClicks(force = false): Promise<void> {
    try {
      // 1. HARD DELETE: Hapus klik iklan yang tidak sampai ke WhatsApp (hanya ATC / click catcher) > 7 hari (1 minggu)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const deletedAbandoned = await prisma.adClick.deleteMany({
        where: {
          createdAt: { lt: sevenDaysAgo },
          matchedAt: null,
          customerId: null,
        },
      });

      if (deletedAbandoned.count > 0) {
        console.log(`[Cron Service] Deleted ${deletedAbandoned.count} abandoned ad clicks (>7 days old with no WhatsApp chat).`);
      }

      // 2. SOFT RELEASE: Dijalankan tiap tanggal 1 untuk mendaur ulang trackingCode > 100 hari (data atribusi tetap tersimpan)
      const today = new Date();
      if (today.getDate() === 1 || force || process.env.NODE_ENV === 'test') {
        const hundredDaysAgo = new Date();
        hundredDaysAgo.setDate(hundredDaysAgo.getDate() - 100);

        const releaseUnmatched = await prisma.adClick.updateMany({
          where: {
            createdAt: { lt: hundredDaysAgo },
            matchedAt: null,
            trackingCode: { not: null },
          },
          data: {
            trackingCode: null,
          },
        });

        const releaseMatchedLostOrNoSales = await prisma.adClick.updateMany({
          where: {
            createdAt: { lt: hundredDaysAgo },
            matchedAt: { not: null },
            trackingCode: { not: null },
            customer: {
              OR: [
                { status: 'lost' },
                {
                  reservations: {
                    none: {
                      status: 'confirmed',
                    },
                  },
                },
              ],
            },
          },
          data: {
            trackingCode: null,
          },
        });

        const totalReleased = releaseUnmatched.count + releaseMatchedLostOrNoSales.count;
        if (totalReleased > 0) {
          console.log(`[Cron Service] Released ${totalReleased} old tracking codes (>100 days old with no sales/lost status) while preserving ROI attribution history.`);
        }
      }
    } catch (err) {
      console.error('[Cron Service] Failed to cleanup/release old tracking codes:', err);
    }
  }

  /**
   * Purge data histori chat di tabel LegacyStaging yang sudah berstatus COMMITTED atau REJECTED 
   * dan lebih tua dari 30 hari untuk mencegah DB bloat.
   */
  public async purgeOldLegacyStaging(): Promise<void> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const deleted = await prisma.legacyStaging.deleteMany({
        where: {
          status: { in: ['COMMITTED', 'REJECTED'] },
          createdAt: { lt: thirtyDaysAgo },
        },
      });

      if (deleted.count > 0) {
        console.log(`[Cron Service] Successfully purged ${deleted.count} old committed/rejected legacy staging records (>30 days).`);
      }
    } catch (err: any) {
      console.error('[Cron Service] Failed to purge old legacy staging records:', err.message || err);
    }
  }

  /**
   * P1.4 Auto-Approve Guard — Memeriksa reservasi berstatus `pending` review
   * yang sudah berumur >24 jam dan mengirimkan notifikasi alert Telegram.
   */
  public async checkPendingPurchaseModerationAlerts(tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      const pendingCount = await prisma.reservation.count({
        where: {
          tenant_id: tenantId,
          purchase_review_status: 'pending',
          purchase_occurred_at: { lt: twentyFourHoursAgo },
        },
      });

      if (pendingCount > 0) {
        const { alertService, AlertType, AlertSeverity } = await import('./alert.service');
        await alertService.notifyAlert({
          type: AlertType.PENDING_PURCHASE_MODERATION,
          severity: AlertSeverity.WARNING,
          message: `[CAPI MODERATION ALERT] Ada ${pendingCount} data Purchase CAPI yang tertahan (pending review >24 jam). Mohon periksa Dashboard Advertiser.`,
          metadata: { pendingCount, thresholdHours: 24 },
        });
      }
    } catch (err: any) {
      console.error('[Cron Service] Failed to check pending purchase moderation alerts:', err.message || err);
    }
  }

  /**
   * Pulse alert (Fase 4): sapuan periodik percakapan yang melewati SLA tanpa balasan
   * admin nyata → tandai is_frustrated. Berbasis STATE/SLA (bukan keyword), mencakup
   * semua provider (WAHA/WABA). Best-effort: DB offline → silent.
   */
  public async runFrustrationSweep(): Promise<void> {
    try {
      const { frustrationSignalService } = await import('./frustration-signal.service');
      const { getAllTenantIds } = await import('./media.service');
      const tenants = await getAllTenantIds();
      let flagged = 0;
      for (const tenantId of tenants) {
        flagged += await frustrationSignalService.sweep(tenantId);
      }
      if (flagged > 0) {
        console.log(`[Cron Service] Frustration sweep: ${flagged} percakapan ditandai butuh respon segera.`);
      }
    } catch (err) {
      console.error('[Cron Service] Error running frustration sweep:', (err as Error).message);
    }
  }

  /**
   * Fase 5r — Pre-Visit Brief: kirim kartu ringkasan pasien ke bidan H-30 menit.
   * Berbasis jendela waktu (now+20..35 mnt) + idempoten via pre_visit_brief_sent_at.
   */
  public async runPreVisitBriefSweep(): Promise<void> {
    try {
      const { staffNotificationService } = await import('./staff-notification.service');
      const { getAllTenantIds } = await import('./media.service');
      const tenants = await getAllTenantIds();
      let sent = 0;
      for (const tenantId of tenants) {
        sent += await staffNotificationService.sweepPreVisitBriefs(tenantId);
      }
      if (sent > 0) {
        console.log(`[Cron Service] Pre-visit brief terkirim: ${sent} kartu.`);
      }
    } catch (err) {
      console.error('[Cron Service] Error running pre-visit brief sweep:', (err as Error).message);
    }
  }

  /**
   * KB-1 (2026-09-30) — Auto-expire reservasi `hold` yang dibuat SEBELUM awal
   * hari WIB ini (kebijakan pemilik: hold berlaku sampai tengah malam WIB hari
   * pembuatan). Berbasis `created_at`, bukan `booking_date`, sehingga hold masa
   * depan pun kedaluwarsa (sebelumnya membeku tanpa batas). Tenant-scoped,
   * best-effort: DB offline → silent.
   */
  public async runExpiredHoldSweep(): Promise<void> {
    try {
      const { getAllTenantIds } = await import('./media.service');
      const tenantIds = await getAllTenantIds();
      let expired = 0;
      for (const tenantId of tenantIds) {
        try {
          // Batas awal hari ini WIB (hold yang dibuat sebelum ini = kedaluwarsa).
          const nowWib = new Date(Date.now() + 7 * 60 * 60 * 1000);
          const startOfTodayWibUtc = new Date(
            Date.UTC(nowWib.getUTCFullYear(), nowWib.getUTCMonth(), nowWib.getUTCDate(), 0, 0, 0, 0) - 7 * 60 * 60 * 1000
          );
          const res = await prisma.reservation.updateMany({
            where: {
              tenant_id: tenantId,
              status: 'hold',
              created_at: { lt: startOfTodayWibUtc },
            },
            data: { status: 'cancelled' },
          });
          expired += res?.count || 0;
        } catch (e: any) {
          console.warn(`[Cron Service] Expired hold sweep tenant ${tenantId} skipped:`, e?.message);
        }
      }
      if (expired > 0) console.log(`[Cron Service] Hold kedaluwarsa (lewat tengah malam WIB) di-expire: ${expired} reservasi.`);
    } catch (err) {
      console.error('[Cron Service] Error running expired hold sweep:', (err as Error).message);
    }
  }

  /**
   * A5 — Sapuan slot jadwal bertumpuk (double-booked / tumpang waktu).
   * PERINGATAN DINI ke admin (bukan blokir keras). Tenant-scoped,
   * best-effort: DB offline → silent. Mirrors runExpiredHoldSweep.
   */
  public async runSlotOverlapSweep(): Promise<void> {
    try {
      const { getAllTenantIds } = await import('./media.service');
      const { sweepOverlappingSlots } = await import('./slot-overlap.service');
      const tenantIds = await getAllTenantIds();
      let groups = 0;
      let reservations = 0;
      let deduped = 0;
      for (const tenantId of tenantIds) {
        try {
          const res = await sweepOverlappingSlots(tenantId);
          groups += res.overlappingGroups;
          reservations += res.reservationCount;
          if (res.deduped) deduped++;
        } catch (e: any) {
          console.warn(`[Cron Service] Slot overlap sweep tenant ${tenantId} skipped:`, e?.message);
        }
      }
      if (groups > 0) {
        console.log(
          `[Cron Service] Slot overlap sweep: ${groups} grup bertumpuk (${reservations} reservasi). Alarm didedup: ${deduped}.`
        );
      }
    } catch (err) {
      console.error('[Cron Service] Error running slot overlap sweep:', (err as Error).message);
    }
  }

  /**
   * #162e: Auto-close sesi perjalanan terapis yang jadwalnya sudah lewat
   * (jadwal + durasi + grace 1 jam). Mencegah sesi "terlupa" tetap aktif sampai TTL.
   * Tenant-scoped; tutup = clearTrip + siarkan `staff.trip_closed`.
   */
  public async runTripAutoCloseSweep(): Promise<void> {
    try {
      const { staffTripTrackingService, isTripScheduleExpired } = await import('./staff-trip-tracking.service');
      const { prisma } = await import('../db/client');
      const { getLiveChatHub } = await import('./live-chat-hub.service');
      const active = staffTripTrackingService.listActiveTrips();
      if (active.length === 0) return;
      let closed = 0;
      for (const trip of active) {
        try {
          const res = await prisma.reservation.findFirst({
            where: { id: trip.reservationId, tenant_id: trip.tenantId },
            select: { booking_date: true, duration_minutes: true },
          });
          if (!res) continue;
          if (!isTripScheduleExpired(res.booking_date, res.duration_minutes)) continue;
          staffTripTrackingService.clearTrip(trip.tenantId, trip.reservationId);
          closed++;
          getLiveChatHub()
            .publish({
              type: 'staff.trip_closed',
              tenantId: trip.tenantId,
              payload: { reservationId: trip.reservationId, staffId: trip.staffId, reason: 'schedule_expired' },
            })
            .catch(() => {});
        } catch (e: any) {
          console.warn(`[Cron Service] Trip auto-close skip ${trip.reservationId}:`, e?.message);
        }
      }
      if (closed > 0) console.log(`[Cron Service] Sesi perjalanan terapis auto-closed: ${closed}.`);
    } catch (err) {
      console.error('[Cron Service] Error running trip auto-close sweep:', (err as Error).message);
    }
  }

  /**
   * Buffer penugasan terapis: kirim notifikasi yang sudah melewati jendela 5 menit.
   * Persisten via kolom assignment_pending_at/assignment_notified_at.
   */
  public async runAssignmentNotificationSweep(): Promise<void> {
    try {
      const { staffNotificationService } = await import('./staff-notification.service');
      const { getAllTenantIds } = await import('./media.service');
      const tenants = await getAllTenantIds();
      let sent = 0;
      for (const tenantId of tenants) {
        sent += await staffNotificationService.sweepPendingAssignmentNotifications(tenantId);
      }
      if (sent > 0) {
        console.log(`[Cron Service] Notifikasi penugasan terapis terkirim: ${sent}.`);
      }
    } catch (err) {
      console.error('[Cron Service] Error running assignment notification sweep:', (err as Error).message);
    }
  }

  /**
   * Auto-Backup Mingguan ke Google Drive (Dijalankan setiap Senin jam 02:00 WIB)
   */
  public async runWeeklyBackup(tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
    try {
      console.log('[Cron Service] 📦 Starting Weekly Auto-Backup to Google Drive...');
      const { backupService } = await import('./backup.service');
      const dump = await backupService.createDatabaseDump(tenantId);
      const driveFile = await backupService.uploadToGoogleDrive(tenantId, dump.filePath);
      if (driveFile) {
        console.log(`[Cron Service] ☁️ Weekly Auto-Backup uploaded to Google Drive: ${driveFile.name} (${driveFile.id})`);
      } else {
        console.log(`[Cron Service] 💾 Weekly Auto-Backup saved locally: ${dump.fileName} (${dump.sizeBytes} bytes)`);
      }
    } catch (err: any) {
      console.error('[Cron Service] ❌ Error running weekly backup:', err?.message);
    }
  }
}

export const cronService = new CronService();
