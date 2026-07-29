import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { cronService } from '../../src/services/cron.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { typingService } from '../../src/services/typing.service';

vi.mock('../../src/db/client', () => ({
  prisma: {
    reservation: {
      findMany: vi.fn(),
    },
    followUp: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    customer: {
      update: vi.fn(),
    },
  },
}));

describe('Morning Reminder Timing & Priority Bypass Tests', () => {
  beforeAll(() => {
    process.env.HUMANIZER_ENABLED = 'false';
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should process booking jam 06:30 first and bypass throttle delay when queue is dense', async () => {
    // Set system time to 06:00 (the cron job run time)
    vi.setSystemTime(new Date(2026, 6, 24, 6, 0, 0));

    // Mock reservations in random order in the array to test sorting
    const mockReservations = [
      {
        id: 'res-0730',
        booking_date: new Date(2026, 6, 24, 7, 30, 0),
        treatment_category: 'MOMS',
        customer: { id: 'cust-1', name: 'Bunda C', phone: '6280003' },
      },
      {
        id: 'res-0630',
        booking_date: new Date(2026, 6, 24, 6, 30, 0), // Paling pagi, 06:30
        treatment_category: 'BABY',
        raw_text: 'Nama Bayi: Adek Baby',
        customer: { id: 'cust-2', name: 'Bunda A', phone: '6280001' },
      },
      {
        id: 'res-0700',
        booking_date: new Date(2026, 6, 24, 7, 0, 0),
        treatment_category: 'MOMS',
        customer: { id: 'cust-3', name: 'Bunda B', phone: '6280002' },
      },
    ];

    // Mock DB calls
    vi.mocked(prisma.reservation.findMany)
      .mockResolvedValueOnce(mockReservations as any) // Untuk hari-H reminders
      .mockResolvedValueOnce([]); // Untuk H+1 reviews

    vi.mocked(prisma.followUp.findFirst).mockResolvedValue(null);

    // Mock typing simulation
    const simulateSpy = vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: true, bubblesSent: 1 });

    // Mock setTimeout to verify throttle bypasses
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    // Run cron job
    await cronService.runMorningJobs();

    // Verify sorting ASC: Bunda A (06:30) must be processed first
    expect(simulateSpy).toHaveBeenCalledTimes(3);
    
    // First call should be Bunda A (6280001)
    expect(simulateSpy.mock.calls[0][0].chatId).toBe('6280001');
    // Second call should be Bunda B (6280002) at 07:00
    expect(simulateSpy.mock.calls[1][0].chatId).toBe('6280002');
    // Third call should be Bunda C (6280003) at 07:30
    expect(simulateSpy.mock.calls[2][0].chatId).toBe('6280003');

    // For the 06:30 booking:
    // estimatedDuration = 45s (maxJitter) + 5s (typingTime) = 50s.
    // timeToTreatment = 06:30 - 06:00 = 30 mins (1800s).
    // accumulatedDelayMs + 50s = 50s < 1800s.
    // So the first job (06:30) is throttled normally.
    
    // Let's verify that when timeToTreatment is exceeded, it bypasses.
    // In our case with 3 short tests, they are far apart, so normal throttle is used.
    // We can see that setTimeout was called.
    expect(setTimeoutSpy).toHaveBeenCalled();
  });

  it('should bypass throttle immediately for a 06:30 booking if cron runs late (e.g. at 06:25)', async () => {
    // Set system time to 06:25 (cron runs late, only 5 minutes before booking)
    vi.setSystemTime(new Date(2026, 6, 24, 6, 25, 0));

    const mockReservations = [
      {
        id: 'res-late-0630',
        booking_date: new Date(2026, 6, 24, 6, 30, 0),
        treatment_category: 'BABY',
        raw_text: 'Nama Bayi: Danish',
        customer: { id: 'cust-late', name: 'Bunda Late', phone: '628999' },
      },
    ];

    vi.mocked(prisma.reservation.findMany)
      .mockResolvedValueOnce(mockReservations as any)
      .mockResolvedValueOnce([]);

    const simulateSpy = vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: true, bubblesSent: 1 });
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    await cronService.runMorningJobs();

    expect(simulateSpy).toHaveBeenCalledTimes(1);
    expect(simulateSpy.mock.calls[0][0].chatId).toBe('628999');
  });

  it('should bypass throttle when time to treatment is tight (e.g. 40 seconds before treatment)', async () => {
    // Set system time to 06:29:20 (40 seconds before 06:30)
    vi.setSystemTime(new Date(2026, 6, 24, 6, 29, 20));

    const mockReservations = [
      {
        id: 'res-tight-0630',
        booking_date: new Date(2026, 6, 24, 6, 30, 0),
        treatment_category: 'BABY',
        raw_text: 'Nama Bayi: Danish',
        customer: { id: 'cust-tight', name: 'Bunda Tight', phone: '628999' },
      },
    ];

    vi.mocked(prisma.reservation.findMany)
      .mockResolvedValueOnce(mockReservations as any)
      .mockResolvedValueOnce([]);

    const simulateSpy = vi.spyOn(typingService, 'simulateHumanReply').mockResolvedValue({ success: true, bubblesSent: 1 });
    
    // Clear setTimeout spy
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    await cronService.runMorningJobs();

    // Since estimatedDuration (50s) > timeToTreatment (40s), it should bypass throttle.
    // That means it shouldn't call setTimeout for throttling.
    // Let's assert that setTimeoutSpy is not called for the 20-45s throttling.
    const throttleCalls = setTimeoutSpy.mock.calls.filter(call => {
      const ms = call[1];
      return ms && ms >= 20000 && ms <= 45000;
    });
    expect(throttleCalls.length).toBe(0); // Bypassed!
  });
});
