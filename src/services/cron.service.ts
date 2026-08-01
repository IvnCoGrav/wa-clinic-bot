import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { TEMPLATES } from '../config/persona';
import { typingService } from './typing.service';
import { followUpService } from './follow-up.service';

export class CronService {
  /**
   * Menjalankan pekerjaan pengingat pagi Hari-H & Follow-Up H+1 (biasanya dijalankan jam 06:00)
   */
  public async runMorningJobs(): Promise<void> {
    try {
      console.log('[Cron Service] Starting Morning Jobs...');
      await this.sendMorningReminders();
      await this.sendYesterdayReviewsAndScheduleNextFollowups();
      await followUpService.checkAndSetLostCustomers(DEFAULT_TENANT_ID);
      await this.cleanupOldAdClicks();
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
   * Mengirim reminder untuk reservasi hari ini dengan laju pengiriman throttled (Priority Safety Bypass)
   */
  private async sendMorningReminders(): Promise<void> {
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

      const customerName = res.customer.name || 'Bunda';
      const timeStr = this.formatTime(res.booking_date);

      const messageText = TEMPLATES.morningReminder({
        name: customerName,
        time: timeStr,
      });

      console.log(`[Cron Service] Sending morning reminder to ${res.customer.phone} (${customerName})`);
      await typingService.simulateHumanReply({
        chatId: res.customer.phone,
        replyText: messageText,
      });
    }
  }

  /**
   * Mengirim review H+1 jam 07:00 untuk reservasi kemarin,
   * dan mendaftarkan follow-up NEXT_TREATMENT (+1, +2, +3 bulan)
   */
  private async sendYesterdayReviewsAndScheduleNextFollowups(): Promise<void> {
    const startOfYesterday = new Date();
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    startOfYesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date();
    endOfYesterday.setDate(endOfYesterday.getDate() - 1);
    endOfYesterday.setHours(23, 59, 59, 999);

    const yesterdayReservations = await prisma.reservation.findMany({
      where: {
        status: 'confirmed',
        booking_date: {
          gte: startOfYesterday,
          lte: endOfYesterday,
        },
        tenant_id: DEFAULT_TENANT_ID,
      },
      include: { customer: true },
    });

    console.log(`[Cron Service] Found ${yesterdayReservations.length} confirmed reservations completed yesterday.`);

    for (const res of yesterdayReservations) {
      if (!res.customer || !res.booking_date) continue;

      const customerName = res.customer.name || 'Bunda';
      let messageText = '';

      // 1. Tentukan template review berdasarkan kategori
      if (res.treatment_category === 'BABY' || res.treatment_category === 'BOTH') {
        let babyName = 'Adek';
        if (res.raw_text) {
          const match = res.raw_text.match(/Nama Bayi\s*:\s*([^\n]+)/i);
          if (match && match[1]) {
            babyName = match[1].trim();
          }
        }
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
      console.log(`[Cron Service] Sending H+1 review to ${res.customer.phone} (${customerName})`);
      await typingService.simulateHumanReply({
        chatId: res.customer.phone,
        replyText: messageText,
      });

      // 3. Daftarkan 3 row follow_ups NEXT_TREATMENT (+1, +2, +3 bulan)
      await followUpService.createNextTreatmentFollowUps(res.customer_id, res.booking_date, DEFAULT_TENANT_ID);
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
   * Me-release trackingCode dari record AdClick yang berumur > 100 hari dan tidak menghasilkan penjualan 
   * (belum/tidak confirm, atau customer berstatus lost).
   * CATATAN ARSITEKTUR (REKONSILIASI ROI):
   * Record AdClick TIDAK di-hard-delete agar histori atribusi iklan (fbclid, fbp, fbc, UTMs) 
   * tetap tersimpan permanen untuk pelaporan ROI & performa kampanye. Hanya trackingCode-nya 
   * yang di-set ke NULL (released) agar kode alfanumerik 2-4 karakter dapat digunakan kembali.
   */
  public async cleanupOldAdClicks(force = false): Promise<void> {
    try {
      const today = new Date();
      // Hanya jalankan pada tanggal 1 setiap bulan (kecuali dipaksa/dalam test environment)
      if (today.getDate() !== 1 && !force && process.env.NODE_ENV !== 'test') {
        return;
      }

      const hundredDaysAgo = new Date();
      hundredDaysAgo.setDate(hundredDaysAgo.getDate() - 100);

      // 1. Release trackingCode for unmatched clicks older than 100 days
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

      // 2. Release trackingCode for matched clicks older than 100 days where customer status is 'lost' or has no confirmed reservation
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
    } catch (err) {
      console.error('[Cron Service] Failed to cleanup/release old tracking codes:', err);
    }
  }
}


export const cronService = new CronService();
