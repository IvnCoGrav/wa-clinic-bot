import { describe, it, expect } from 'vitest';
import { ContextGrounder } from '../../../src/v3/agent/pipeline/context-grounder';
import { CustomerGoalSession, GoalTracker } from '../../../src/v3/state/goal-tracker';

describe('RequestedTimeHint & PendingScheduleCheck Latch (Plan 7)', () => {
  it('extractTimeHint: mengenali hari biasa, weekday, dan nama hari', () => {
    expect(ContextGrounder.extractTimeHint('bisa hari biasa sore?')).toBe('hari biasa');
    expect(ContextGrounder.extractTimeHint('kalau weekday ada slot?')).toBe('weekday');
    expect(ContextGrounder.extractTimeHint('minggu pagi ready kak?')).toBe('minggu');
    expect(ContextGrounder.extractTimeHint('hari jumat jam 10')).toBe('jumat');
  });

  it('applySessionLatches: memperbarui requestedTimeHint jika customer mengganti hari', async () => {
    const convId = 'conv-test-latch-1';
    const tenantId = 'default-tenant';

    let session: CustomerGoalSession = {
      genderGreeting: 'Bunda',
      location: {
        rawText: 'Semampir',
        kelurahan: 'Semampir',
        distanceKm: 5,
      },
      booking: {
        isConfirmed: false,
        requestedTimeHint: 'minggu',
      },
    };

    // Customer mengganti hari ke hari biasa sore
    const updated = await ContextGrounder.applySessionLatches(
      session,
      'kalau hari biasa sore jam 5 bisa min?',
      convId,
      tenantId
    );

    expect(updated.booking?.requestedTimeHint).toBe('hari biasa');
    expect(updated.booking?.pendingScheduleCheck).toBe(true);
  });
});
