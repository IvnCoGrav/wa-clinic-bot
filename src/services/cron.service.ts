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
      await followUpService.processDueFollowUps(DEFAULT_TENANT_ID);
      await followUpService.checkAndSetLostCustomers(DEFAULT_TENANT_ID);
      await this.cleanupOldAdClicks();
      await this.purgeOldLegacyStaging();
      await this.checkPendingPurchaseModerationAlerts();

      // Kirim Morning Briefing Jadwal ke Telegram pribadi seluruh Bidan/Terapis yang bertugas hari ini
      const { staffNotificationService } = await import('./staff-notification.service');
      await staffNotificationService.sendAllStaffMorningBriefings(DEFAULT_TENANT_ID);

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
      const processed = await followUpService.processDueFollowUps(DEFAULT_TENANT_ID);
      if (processed > 0) {
        console.log(`[Cron Service] FollowUp Worker processed ${processed} messages.`);
      }
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
      const result = await labelReconciliationService.reconcileLabels(DEFAULT_TENANT_ID);
      console.log(`[Cron Service] Label reconciliation complete (drifts found: ${result.driftsFound}, fixed: ${result.driftsFixed}).`);
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
  public async checkPendingPurchaseModerationAlerts(): Promise<void> {
    try {
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      const pendingCount = await prisma.reservation.count({
        where: {
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
