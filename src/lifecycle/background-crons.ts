import { trackInterval } from './interval-registry';

/** Helper: jalankan fn sekali dengan jitter acak 0-30 detik, lalu setInterval normal.
 *  Mencegah semua cron start bareng saat boot (thundering herd). */
export function trackIntervalStaggered(fn: () => Promise<void>, intervalMs: number): NodeJS.Timeout {
  const jitter = Math.floor(Math.random() * 30_000); // 0-30 detik
  const starter = setTimeout(() => {
    fn().catch(() => {});
    trackInterval(fn, intervalMs);
  }, jitter);
  return starter;
}

/**
 * Registrasi terpusat seluruh background cron, worker & sweeps operasional klinik.
 * Dipanggil oleh:
 * 1. src/app.ts (mode monolith / SEPARATE_WORKER !== 'true')
 * 2. src/worker.ts (mode separated worker / SEPARATE_WORKER === 'true')
 */
export function startBackgroundCrons(): void {
  // Start label reconciliation cron (Task 7 / flag: ENABLE_LABEL_RECONCILIATION_CRON)
  if (process.env.ENABLE_LABEL_RECONCILIATION_CRON === 'true') {
    const intervalHours = parseInt(process.env.LABEL_RECONCILIATION_INTERVAL_HOURS || '4', 10);
    import('../services/cron.service').then(({ CronService }) => {
      const cron = new CronService();
      trackInterval(() => cron.runLabelReconciliation(), intervalHours * 60 * 60 * 1000);
      console.log(`🏷️ Label reconciliation cron started (every ${intervalHours}h)`);
    }).catch(e => console.error('[LABEL RECONCILIATION START ERROR]', e));
  }

  // Start Google Sheets sync worker (Fase 3): proses outbox antrean rekapan.
  // Default AKTIF; jalankan sekali saat boot untuk self-healing backlog.
  if (process.env.ENABLE_SHEETS_SYNC_CRON !== 'false') {
    const sheetsIntervalMinutes = parseInt(process.env.SHEETS_SYNC_INTERVAL_MINUTES || '3', 10);
    import('../services/cron.service').then(({ CronService }) => {
      const cron = new CronService();
      cron.runSheetsSyncWorker().catch(e => console.warn('[SHEETS SYNC BOOT WARNING]', (e as Error).message));
      trackIntervalStaggered(() => cron.runSheetsSyncWorker(), sheetsIntervalMinutes * 60 * 1000);
      console.log(`📊 Google Sheets sync worker started (every ${sheetsIntervalMinutes}m, staggered)`);
    }).catch(e => console.error('[SHEETS SYNC START ERROR]', e));
  }

  // Start media cleanup cron (hapus file media Live Chat yang melebihi retensi)
  if (process.env.ENABLE_MEDIA_CLEANUP_CRON !== 'false') {
    const intervalHours = parseInt(process.env.MEDIA_CLEANUP_INTERVAL_HOURS || '24', 10);
    import('../services/cron.service').then(({ CronService }) => {
      const cron = new CronService();
      cron.runMediaCleanup().catch(e => console.warn('[MEDIA CLEANUP BOOT WARNING]', (e as Error).message));
      trackInterval(() => cron.runMediaCleanup(), intervalHours * 60 * 60 * 1000);
      console.log(`🖼️ Media cleanup cron started (every ${intervalHours}h)`);
    }).catch(e => console.error('[MEDIA CLEANUP START ERROR]', e));
  }

  // Start message retention cron (hapus record chat teks yang melebihi retensi)
  if (process.env.ENABLE_MESSAGE_RETENTION_CRON === 'true') {
    const intervalHours = parseInt(process.env.MESSAGE_RETENTION_INTERVAL_HOURS || '24', 10);
    import('../services/cron.service').then(({ CronService }) => {
      const cron = new CronService();
      trackInterval(() => cron.runMessageRetentionCleanup(), intervalHours * 60 * 60 * 1000);
      console.log(`🧾 Message retention cron started (every ${intervalHours}h)`);
    }).catch(e => console.error('[MESSAGE RETENTION START ERROR]', e));
  }

  // Staff session housekeeping — hapus sesi kedaluarsa tiap 24 jam (ringan, tanpa gate)
  trackInterval(() => {
    import('../services/staff-auth.service').then(({ StaffAuthService }) => {
      StaffAuthService.cleanExpiredSessions().catch(() => {});
    }).catch(() => {});
  }, 24 * 60 * 60 * 1000);
  console.log('🧹 Staff session cleanup cron registered (every 24h)');

  // Fase 5r: Pre-Visit Brief bidan (H-30 menit). Default aktif; env 'false' menonaktifkan.
  if (process.env.ENABLE_PRE_VISIT_BRIEF !== 'false') {
    const intervalMinutes = parseInt(process.env.PRE_VISIT_BRIEF_INTERVAL_MINUTES || '10', 10);
    import('../services/cron.service').then(({ CronService }) => {
      const cron = new CronService();
      trackIntervalStaggered(() => cron.runPreVisitBriefSweep(), intervalMinutes * 60 * 1000);
      console.log(`📋 Pre-Visit Brief cron started (every ${intervalMinutes}m, staggered)`);
    }).catch(e => console.error('[PRE-VISIT BRIEF START ERROR]', e));
  }

  // Fase 4.2: Auto-expire reservasi hold yang tanggal kunjungannya sudah lewat.
  if (process.env.ENABLE_EXPIRED_HOLD_SWEEP !== 'false') {
    const intervalHours = parseInt(process.env.EXPIRED_HOLD_SWEEP_INTERVAL_HOURS || '6', 10);
    import('../services/cron.service').then(({ CronService }) => {
      const cron = new CronService();
      trackInterval(() => cron.runExpiredHoldSweep(), intervalHours * 60 * 60 * 1000);
      console.log(`♻️ Expired hold sweep cron started (every ${intervalHours}h)`);
    }).catch(e => console.error('[EXPIRED HOLD SWEEP START ERROR]', e));
  }

  // R0.1 — Daily Invariant Monitor (READ-ONLY). Default aktif; env 'false' menonaktifkan.
  if (process.env.ENABLE_INVARIANT_MONITOR !== 'false') {
    const intervalHours = parseInt(process.env.INVARIANT_MONITOR_INTERVAL_HOURS || '24', 10);
    import('../services/daily-invariant-monitor.service').then(({ runDailyInvariantMonitor }) => {
      trackInterval(() => runDailyInvariantMonitor(), intervalHours * 60 * 60 * 1000);
      console.log(`🔎 Invariant monitor cron started (every ${intervalHours}h)`);
    }).catch(e => console.error('[INVARIANT MONITOR START ERROR]', e));
  }

  // A5 — Sapuan slot jadwal bertumpuk (peringatan dini ke admin, bukan blokir).
  if (process.env.ENABLE_SLOT_OVERLAP_SWEEP !== 'false') {
    const intervalMinutes = Math.max(1, Number(process.env.SLOT_OVERLAP_SWEEP_INTERVAL_MINUTES ?? 15) || 15);
    import('../services/cron.service').then(({ CronService }) => {
      const cron = new CronService();
      trackIntervalStaggered(() => cron.runSlotOverlapSweep(), intervalMinutes * 60 * 1000);
      console.log(`🔀 Slot overlap sweep cron started (every ${intervalMinutes}m, staggered)`);
    }).catch(e => console.error('[SLOT OVERLAP SWEEP START ERROR]', e));
  }

  // #162e: Auto-close sesi perjalanan terapis yang jadwalnya sudah lewat. Default aktif.
  if (process.env.ENABLE_TRIP_AUTOCLOSE_SWEEP !== 'false') {
    const intervalMinutes = parseInt(process.env.TRIP_AUTOCLOSE_SWEEP_INTERVAL_MINUTES || '15', 10);
    import('../services/cron.service').then(({ CronService }) => {
      const cron = new CronService();
      trackIntervalStaggered(() => cron.runTripAutoCloseSweep(), intervalMinutes * 60 * 1000);
      console.log(`🛣️ Trip auto-close sweep cron started (every ${intervalMinutes}m, staggered)`);
    }).catch(e => console.error('[TRIP AUTOCLOSE SWEEP START ERROR]', e));
  }

  // Buffer notifikasi penugasan terapis (5 menit). Default aktif; env 'false' menonaktifkan.
  if (process.env.ENABLE_ASSIGNMENT_NOTIF_SWEEP !== 'false') {
    const intervalMinutes = parseInt(process.env.ASSIGNMENT_NOTIF_SWEEP_INTERVAL_MINUTES || '2', 10);
    import('../services/cron.service').then(({ CronService }) => {
      const cron = new CronService();
      trackIntervalStaggered(() => cron.runAssignmentNotificationSweep(), intervalMinutes * 60 * 1000);
      console.log(`🔔 Assignment notification sweep cron started (every ${intervalMinutes}m, staggered)`);
    }).catch(e => console.error('[ASSIGNMENT NOTIF SWEEP START ERROR]', e));
  }

  // Pulse alert (Fase 4): sapuan percakapan melewati SLA → tandai butuh respon segera.
  if (process.env.ENABLE_FRUSTRATION_SWEEP !== 'false') {
    const intervalMinutes = parseInt(process.env.FRUSTRATION_SWEEP_INTERVAL_MINUTES || '5', 10);
    import('../services/cron.service').then(({ CronService }) => {
      const cron = new CronService();
      trackIntervalStaggered(() => cron.runFrustrationSweep(), intervalMinutes * 60 * 1000);
      console.log(`🚨 Frustration sweep cron started (every ${intervalMinutes}m, staggered)`);
    }).catch(e => console.error('[FRUSTRATION SWEEP START ERROR]', e));
  }

  // Nightly Watchdog (Fase 2r): laporan pengawasan malam 21:00 WIB.
  import('../services/nightly-watchdog.service').then(({ nightlyWatchdogService }) => {
    import('../services/notification-delivery.service').then(({ notificationDeliveryService }) => {
      import('../services/media.service').then(({ getAllTenantIds }) => {
        import('../db/client').then(({ prisma }) => {
          const lastNightlyRunDate = new Map<string, string>();
          trackInterval(async () => {
            try {
              const nowUtc = new Date();
              const wib = new Date(nowUtc.getTime() + 7 * 60 * 60 * 1000);
              const wibHour = wib.getUTCHours();
              const wibMinute = wib.getUTCMinutes();
              const todayStr = wib.toISOString().slice(0, 10);
              const tenantIds = await getAllTenantIds();
              for (const tId of tenantIds) {
                const tenant = await prisma.tenant.findUnique({ where: { id: tId } }).catch(() => null);
                if (!tenant || !tenant.nightly_report_enabled) continue;
                const targetHour = tenant.nightly_report_hour ?? 21;
                const targetMinute = tenant.nightly_report_minute ?? 0;
                const reached = wibHour > targetHour || (wibHour === targetHour && wibMinute >= targetMinute);
                if (!reached) continue;
                if (lastNightlyRunDate.get(tId) === todayStr) continue;
                lastNightlyRunDate.set(tId, todayStr);

                const data = await nightlyWatchdogService.generate(tId);
                const dashboardUrl = process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3000';
                const message = nightlyWatchdogService.formatMessage(tenant.name || tId, data, dashboardUrl);

                const channels = (tenant.notification_channels && tenant.notification_channels.length > 0)
                  ? tenant.notification_channels
                  : ['TELEGRAM'];

                if (channels.includes('TELEGRAM') && tenant.telegram_chat_id) {
                  await notificationDeliveryService.send({
                    tenantId: tId,
                    channel: 'TELEGRAM',
                    recipient: tenant.telegram_chat_id,
                    type: 'NIGHTLY_WATCHDOG',
                    title: 'Laporan Malam Operasional',
                    messageContent: message,
                    reportDate: data.reportDateStr,
                    idempotencyKey: `${tId}:NIGHTLY_WATCHDOG:${data.reportDateStr}`,
                    metadata: { summary: data.summary },
                  });
                }

                if (channels.includes('WHATSAPP')) {
                  for (const num of tenant.admin_whatsapp_numbers || []) {
                    await notificationDeliveryService.send({
                      tenantId: tId,
                      channel: 'WHATSAPP',
                      recipient: num,
                      type: 'NIGHTLY_WATCHDOG',
                      title: 'Laporan Malam Operasional',
                      messageContent: message,
                      reportDate: data.reportDateStr,
                      metadata: { summary: data.summary, recipientNumber: num },
                    });
                  }
                }
              }
            } catch (err: any) {
              console.error('[NIGHTLY WATCHDOG CRON ERROR]', err?.message);
            }
          }, 15 * 60 * 1000);
          console.log('🌙 Nightly Watchdog cron registered (checks every 15m, target 21:00 WIB)');
        }).catch(() => {});
      }).catch(() => {});
    }).catch(() => {});
  }).catch(e => console.error('[NIGHTLY WATCHDOG START ERROR]', e));

  // Start LLM-as-Judge AI quality evaluation cron (interval 6 jam default)
  if (process.env.ENABLE_AI_EVAL_CRON === 'true') {
    const intervalHours = parseInt(process.env.AI_EVAL_INTERVAL_HOURS || '6', 10);
    import('../services/cron.service').then(({ CronService }) => {
      const cron = new CronService();
      trackInterval(() => cron.runQualityEvaluation(), intervalHours * 60 * 60 * 1000);
      console.log(`🧪 AI quality evaluation cron started (every ${intervalHours}h)`);
    }).catch(e => console.error('[AI EVAL START ERROR]', e));
  }

  // Start daily chat export cron (regenerate file markdown harian untuk analisa AI)
  if (process.env.ENABLE_CHAT_EXPORT_CRON === 'true') {
    const intervalHours = parseInt(process.env.CHAT_EXPORT_INTERVAL_HOURS || '6', 10);
    import('../services/cron.service').then(({ CronService }) => {
      const cron = new CronService();
      trackInterval(() => cron.runDailyChatExport(), intervalHours * 60 * 60 * 1000);
      console.log(`📤 Daily chat export cron started (every ${intervalHours}h)`);
    }).catch(e => console.error('[CHAT EXPORT START ERROR]', e));
  }

  // Start Daily Ops Report cron
  import('../services/daily-report.service').then(({ dailyReportService }) => {
    import('../db/client').then(({ prisma }) => {
      import('../services/media.service').then(({ getAllTenantIds }) => {
        trackInterval(async () => {
          try {
            const nowUtc = new Date();
            const wibTime = new Date(nowUtc.getTime() + (7 * 60 * 60 * 1000));
            const currentWibHour = wibTime.getUTCHours();
            
            const envEnabled = process.env.ENABLE_DAILY_REPORT_CRON === 'true';
            const envHour = parseInt(process.env.DAILY_REPORT_HOUR || '7', 10);
            
            const tenants = await getAllTenantIds();
            for (const tId of tenants) {
              const tenant = await prisma.tenant.findUnique({ where: { id: tId } });
              const isEnabled = tenant ? (tenant.daily_report_enabled || envEnabled) : envEnabled;
              const targetHour = tenant ? (tenant.daily_report_hour ?? envHour) : envHour;
              
              if (isEnabled && currentWibHour === targetHour) {
                await dailyReportService.sendDailyReport(tId);
              }
            }
          } catch (err: any) {
            console.error('[DAILY REPORT CRON ERROR]', err.message);
          }
        }, 30 * 60 * 1000);
        console.log(`📈 Daily Ops Report cron background worker started (checking every 30m WIB)`);
      }).catch(() => {});
    }).catch(() => {});
  }).catch(e => console.error('[DAILY REPORT START ERROR]', e));

  // Start Follow-Up Queue Worker & Morning Jobs (setiap 15 menit & pagi 06:00 WIB)
  import('../services/cron.service').then(({ CronService }) => {
    const cron = new CronService();
    
    if (process.env.ENABLE_FOLLOWUP_WORKER === 'true') {
      const followUpIntervalMinutes = parseInt(process.env.FOLLOWUP_WORKER_INTERVAL_MINUTES || '15', 10);
      trackInterval(() => cron.runFollowUpWorker(), followUpIntervalMinutes * 60 * 1000);
      console.log(`⏱️ Follow-Up Queue worker started (every ${followUpIntervalMinutes}m)`);
    } else {
      console.log(`🛑 Follow-Up Worker is DISABLED (ENABLE_FOLLOWUP_WORKER is not 'true')`);
    }

    let lastMorningRunDate = '';
    let lastWeeklyBackupRunDate = '';
    trackInterval(async () => {
      try {
        const nowUtc = new Date();
        const wibTime = new Date(nowUtc.getTime() + 7 * 60 * 60 * 1000);
        const wibHour = wibTime.getUTCHours();
        const wibDay = wibTime.getUTCDay();
        const todayDateStr = wibTime.toISOString().slice(0, 10);

        if (wibHour === 6 && lastMorningRunDate !== todayDateStr) {
          lastMorningRunDate = todayDateStr;
          await cron.runMorningJobs();
        }

        if (wibDay === 1 && wibHour === 2 && lastWeeklyBackupRunDate !== todayDateStr) {
          lastWeeklyBackupRunDate = todayDateStr;
          await cron.runWeeklyBackup();
        }
      } catch (err: any) {
        console.error('[CRON SCHEDULE ERROR]', err.message);
      }
    }, 15 * 60 * 1000);
    console.log(`🌅 Morning Jobs (06:00 WIB) & Weekly Backup (Senin 02:00 WIB) cron registered`);
  }).catch(e => console.error('[CRON SERVICE START ERROR]', e));
}
