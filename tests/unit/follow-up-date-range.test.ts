import { describe, it, expect } from 'vitest';
import { buildScheduledAtRange } from '../../src/services/follow-up.service';

describe('buildScheduledAtRange (FollowUp Date Range Filter WIB)', () => {
  it('returns null for all or undefined filter', () => {
    expect(buildScheduledAtRange('all')).toBeNull();
    expect(buildScheduledAtRange(undefined)).toBeNull();
    expect(buildScheduledAtRange('')).toBeNull();
  });

  it('calculates this_week correctly on a Wednesday', () => {
    // 2026-11-04 is Wednesday. In WIB (UTC+7), 10:00 WIB = 03:00 UTC.
    const refWednesday = new Date('2026-11-04T03:00:00.000Z');
    const range = buildScheduledAtRange('this_week', refWednesday);
    expect(range).not.toBeNull();

    // Monday of this week is 2026-11-02 00:00:00 WIB -> 2026-11-01 17:00:00 UTC
    expect(range!.gte?.toISOString()).toBe('2026-11-01T17:00:00.000Z');

    // Sunday of this week is 2026-11-08 23:59:59.999 WIB -> 2026-11-08 16:59:59.999 UTC
    expect(range!.lte?.toISOString()).toBe('2026-11-08T16:59:59.999Z');
  });

  it('calculates this_week correctly on a Sunday (edge case: Sunday is end of week in Indonesia)', () => {
    // 2026-11-08 is Sunday. In WIB: 20:00 WIB = 13:00 UTC.
    const refSunday = new Date('2026-11-08T13:00:00.000Z');
    const range = buildScheduledAtRange('this_week', refSunday);
    expect(range).not.toBeNull();

    // Monday of this week must still be 2026-11-02 00:00:00 WIB
    expect(range!.gte?.toISOString()).toBe('2026-11-01T17:00:00.000Z');

    // Sunday of this week must be 2026-11-08 23:59:59.999 WIB
    expect(range!.lte?.toISOString()).toBe('2026-11-08T16:59:59.999Z');
  });

  it('calculates this_week correctly on a Monday (edge case: Monday is start of week)', () => {
    // 2026-11-02 is Monday. In WIB: 08:00 WIB = 01:00 UTC.
    const refMonday = new Date('2026-11-02T01:00:00.000Z');
    const range = buildScheduledAtRange('this_week', refMonday);
    expect(range).not.toBeNull();

    expect(range!.gte?.toISOString()).toBe('2026-11-01T17:00:00.000Z');
    expect(range!.lte?.toISOString()).toBe('2026-11-08T16:59:59.999Z');
  });

  it('calculates this_month correctly starting from the 1st of the month at 00:00 WIB', () => {
    // 2026-11-15 is mid November.
    const refMidNov = new Date('2026-11-15T05:00:00.000Z');
    const range = buildScheduledAtRange('this_month', refMidNov);
    expect(range).not.toBeNull();

    // 1st of November 00:00:00 WIB -> 2026-10-31 17:00:00 UTC
    expect(range!.gte?.toISOString()).toBe('2026-10-31T17:00:00.000Z');

    // 30th of November 23:59:59.999 WIB -> 2026-11-30 16:59:59.999 UTC
    expect(range!.lte?.toISOString()).toBe('2026-11-30T16:59:59.999Z');
  });

  it('calculates today range (start of day to end of day in WIB)', () => {
    // 2026-11-06 14:00 WIB -> 2026-11-06 07:00 UTC
    const refNow = new Date('2026-11-06T07:00:00.000Z');
    const range = buildScheduledAtRange('today', refNow);
    expect(range).not.toBeNull();

    // Start of 2026-11-06 WIB = 2026-11-05 17:00:00 UTC
    expect(range!.gte?.toISOString()).toBe('2026-11-05T17:00:00.000Z');
    // End of 2026-11-06 WIB = 2026-11-06 16:59:59.999 UTC
    expect(range!.lte?.toISOString()).toBe('2026-11-06T16:59:59.999Z');
  });

  it('calculates upcoming range (gte start of today in WIB)', () => {
    const refNow = new Date('2026-11-06T07:00:00.000Z');
    const range = buildScheduledAtRange('upcoming', refNow);
    expect(range).not.toBeNull();
    expect(range!.gte?.toISOString()).toBe('2026-11-05T17:00:00.000Z');
    expect(range!.lte).toBeUndefined();
  });

  it('calculates overdue range (lt start of today in WIB)', () => {
    const refNow = new Date('2026-11-06T07:00:00.000Z');
    const range = buildScheduledAtRange('overdue', refNow);
    expect(range).not.toBeNull();
    expect(range!.lt?.toISOString()).toBe('2026-11-05T17:00:00.000Z');
  });
});
