import { wahaClient } from '../integrations/waha/client';
import { AlertService, AlertType, AlertSeverity } from './alert.service';
import { QueueService, queueService as singletonQueueService } from './queue.service';

export class WahaMonitorService {
  private static instance: WahaMonitorService | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  private startingTimestamp: number | null = null;
  private lastKnownStatus: string | null = null;
  private alertService: AlertService;
  private queueService: QueueService;
  private isStuckAlertActive: boolean = false;
  private consecutiveFailures: number = 0;

  private constructor(alertService?: AlertService, queueService?: QueueService) {
    this.alertService = alertService || new AlertService();
    this.queueService = queueService || singletonQueueService;
  }

  public static getInstance(alertService?: AlertService, queueService?: QueueService): WahaMonitorService {
    if (!WahaMonitorService.instance) {
      WahaMonitorService.instance = new WahaMonitorService(alertService, queueService);
    }
    return WahaMonitorService.instance;
  }

  // Public setter for unit tests to bypass singleton cache if needed
  public static setMockInstance(instance: WahaMonitorService | null): void {
    WahaMonitorService.instance = instance;
  }

  /**
   * Mulai background polling daemon
   */
  public start(intervalMs = 30000): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(async () => {
      await this.checkStatus();
    }, intervalMs);
  }

  /**
   * Hentikan background polling
   */
  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.startingTimestamp = null;
    this.lastKnownStatus = null;
    this.isStuckAlertActive = false;
    this.consecutiveFailures = 0;
  }

  /**
   * Getter untuk monitoring state (diperlukan untuk unit testing)
   */
  public getStartingTimestamp(): number | null {
    return this.startingTimestamp;
  }

  public setStartingTimestamp(timestamp: number | null): void {
    this.startingTimestamp = timestamp;
  }

  public getLastKnownStatus(): string | null {
    return this.lastKnownStatus;
  }

  public setLastKnownStatus(status: string | null): void {
    this.lastKnownStatus = status;
  }

  public getIsStuckAlertActive(): boolean {
    return this.isStuckAlertActive;
  }

  /**
   * Inti dari logika pengecekan status
   */
  public async checkStatus(): Promise<string> {
    try {
      const status = await wahaClient.getSessionStatus();
      await this.evaluateStatusChange(status);
      return status;
    } catch (err: any) {
      console.error('[WAHA MONITOR] Failed to retrieve status:', err.message);
      await this.evaluateStatusChange('DISCONNECTED');
      return 'DISCONNECTED';
    }
  }

  public async evaluateStatusChange(currentStatus: string): Promise<void> {
    const thresholdMinutes = parseInt(process.env.THRESHOLD_STUCK_STARTING_MINUTES || '5', 10);
    const thresholdMs = thresholdMinutes * 60 * 1000;

    // 1. Deteksi Stuck di STARTING
    if (currentStatus === 'STARTING') {
      if (!this.startingTimestamp) {
        this.startingTimestamp = Date.now();
      } else {
        const duration = Date.now() - this.startingTimestamp;
        if (duration >= thresholdMs && !this.isStuckAlertActive) {
          this.isStuckAlertActive = true;
          const sessionName = process.env.WAHA_SESSION || 'default';
          await this.alertService.notifyAlert({
            type: AlertType.WAHA_SESSION_STUCK_STARTING,
            severity: AlertSeverity.CRITICAL,
            message: `⚠️ WAHA session '${sessionName}' stuck di STARTING selama ${thresholdMinutes} menit. Kemungkinan penyebab: client-fingerprint rejection (versi WhatsApp Web internal NOWEB usang - lihat WAHA_NOWEB_WA_VERSION_FORCE), atau versi WAHA perlu di-upgrade. Cek versi WAHA server saat ini dan bandingkan dengan changelog resmi.`,
          });
        }
      }
    } else {
      // Jika status berubah dari STARTING ke WORKING atau SCAN_QR_CODE, matikan timer & flag
      if (currentStatus === 'WORKING' || currentStatus === 'SCAN_QR_CODE') {
        this.startingTimestamp = null;
        this.isStuckAlertActive = false;
      }
    }

    // 2. Deteksi transisi untuk pause/resume queue (WAHA_DISCONNECTED)
    const disconnectThreshold = parseInt(process.env.WAHA_DISCONNECT_THRESHOLD || '2', 10);
    const isPaused = typeof this.queueService?.isQueuePaused === 'function' ? this.queueService.isQueuePaused() : false;

    if (currentStatus !== 'WORKING') {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= disconnectThreshold && !isPaused) {
        console.warn(`[WAHA MONITOR] Session not WORKING (${currentStatus}) for ${this.consecutiveFailures} consecutive checks (threshold ${disconnectThreshold}). Pausing message queue.`);
        await this.queueService.pauseQueue();
      } else if (!isPaused) {
        console.warn(`[WAHA MONITOR] Session not WORKING (${currentStatus}) check ${this.consecutiveFailures}/${disconnectThreshold}. Waiting for next check before pausing queue.`);
      }
    } else {
      // currentStatus === 'WORKING'
      this.consecutiveFailures = 0;
      if (isPaused) {
        console.log(`[WAHA MONITOR] Session returned to WORKING. Resuming message queue.`);
        await this.queueService.resumeQueue();
      }
    }

    this.lastKnownStatus = currentStatus;
  }
}
