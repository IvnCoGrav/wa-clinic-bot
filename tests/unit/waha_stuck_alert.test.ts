import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest';
import { wahaClient } from '../../src/integrations/waha/client';
import { AlertService, AlertType, AlertSeverity } from '../../src/services/alert.service';
import { QueueService } from '../../src/services/queue.service';
import { WahaMonitorService } from '../../src/services/waha-monitor.service';

describe('WAHA Session Stuck Starting Alert Unit Tests', () => {
  let mockAlertService: any;
  let mockQueueService: any;
  let monitor: WahaMonitorService;
  let getStatusSpy: MockInstance;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.THRESHOLD_STUCK_STARTING_MINUTES = '5';
    process.env.NODE_ENV = 'test';

    // Mock AlertService notifyAlert
    mockAlertService = {
      notifyAlert: vi.fn().mockResolvedValue({ sent: true, throttled: false, channel: 'console' }),
    };

    // Mock QueueService pause/resume
    mockQueueService = {
      pauseQueue: vi.fn().mockResolvedValue(undefined),
      resumeQueue: vi.fn().mockResolvedValue(undefined),
    };

    // Instantiate service using mocks
    WahaMonitorService.setMockInstance(null);
    monitor = WahaMonitorService.getInstance(
      mockAlertService as unknown as AlertService,
      mockQueueService as unknown as QueueService
    );

    // Spy on WAHA Client getSessionStatus
    getStatusSpy = vi.spyOn(wahaClient, 'getSessionStatus');
  });

  it('1. Sesi baru STARTING di bawah threshold tidak memicu alert', async () => {
    getStatusSpy.mockResolvedValue('STARTING');

    // Polling pertama: mencatat startingTimestamp
    const status1 = await monitor.checkStatus();
    expect(status1).toBe('STARTING');
    expect(monitor.getStartingTimestamp()).toBeGreaterThan(0);
    expect(mockAlertService.notifyAlert).not.toHaveBeenCalled();

    // Polling kedua: selisih waktu 2 menit (di bawah threshold 5 menit)
    const originalNow = Date.now;
    const fakeTime = originalNow() + 2 * 60 * 1000;
    global.Date.now = vi.fn().mockReturnValue(fakeTime);

    const status2 = await monitor.checkStatus();
    expect(status2).toBe('STARTING');
    expect(mockAlertService.notifyAlert).not.toHaveBeenCalled();

    // Kembalikan Date.now
    global.Date.now = originalNow;
  });

  it('2. Sesi tetap STARTING melebihi threshold (5 menit) memicu alert CRITICAL', async () => {
    getStatusSpy.mockResolvedValue('STARTING');

    // Polling pertama: mencatat timestamp awal
    await monitor.checkStatus();
    expect(monitor.getStartingTimestamp()).toBeGreaterThan(0);

    // Maju 6 menit kemudian
    const originalNow = Date.now;
    const fakeTime = originalNow() + 6 * 60 * 1000;
    global.Date.now = vi.fn().mockReturnValue(fakeTime);

    const status2 = await monitor.checkStatus();
    expect(status2).toBe('STARTING');

    // Alert harus terpanggil
    expect(mockAlertService.notifyAlert).toHaveBeenCalledTimes(1);
    expect(mockAlertService.notifyAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: AlertType.WAHA_SESSION_STUCK_STARTING,
        severity: AlertSeverity.CRITICAL,
      })
    );
    expect(monitor.getIsStuckAlertActive()).toBe(true);

    // Kembalikan Date.now
    global.Date.now = originalNow;
  });

  it('3. Transisi sukses ke WORKING sebelum threshold mereset tracking timer', async () => {
    getStatusSpy.mockResolvedValue('STARTING');

    // Mulai starting
    await monitor.checkStatus();
    expect(monitor.getStartingTimestamp()).toBeGreaterThan(0);

    // Status berubah menjadi WORKING
    getStatusSpy.mockResolvedValue('WORKING');
    await monitor.checkStatus();

    // Tracking timer harus di-reset menjadi null
    expect(monitor.getStartingTimestamp()).toBeNull();
    expect(monitor.getIsStuckAlertActive()).toBe(false);
    expect(mockAlertService.notifyAlert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: AlertType.WAHA_SESSION_STUCK_STARTING,
      })
    );
  });

  it('4. Status transisi ke SCAN_QR_CODE mereset starting timer', async () => {
    getStatusSpy.mockResolvedValue('STARTING');

    // Mulai starting
    await monitor.checkStatus();
    expect(monitor.getStartingTimestamp()).toBeGreaterThan(0);

    // Status berubah menjadi SCAN_QR_CODE
    getStatusSpy.mockResolvedValue('SCAN_QR_CODE');
    await monitor.checkStatus();

    // Timer dibersihkan
    expect(monitor.getStartingTimestamp()).toBeNull();
    expect(mockAlertService.notifyAlert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: AlertType.WAHA_SESSION_STUCK_STARTING,
      })
    );
  });

  it('5. Sesi terputus (WORKING -> DISCONNECTED) memicu pauseQueue & alert WAHA_DISCONNECTED', async () => {
    // Sesi aktif awal
    monitor.setLastKnownStatus('WORKING');
    getStatusSpy.mockResolvedValue('DISCONNECTED');

    await monitor.checkStatus();

    // Harus memicu pauseQueue
    expect(mockQueueService.pauseQueue).toHaveBeenCalledTimes(1);
  });

  it('6. Sesi tersambung kembali (DISCONNECTED -> WORKING) memicu resumeQueue', async () => {
    // Sesi terputus awal
    monitor.setLastKnownStatus('DISCONNECTED');
    getStatusSpy.mockResolvedValue('WORKING');

    await monitor.checkStatus();

    // Harus memicu resumeQueue
    expect(mockQueueService.resumeQueue).toHaveBeenCalledTimes(1);
  });
});
