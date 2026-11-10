import { describe, it, expect, beforeEach } from 'vitest';
import { memoryReservations, memoryLandings, MAX_MEMORY_RESERVATIONS, MAX_MEMORY_LANDINGS } from '../../src/routes/admin/stores';

describe('Admin Stores Bounded Memory FIFO (API-06)', () => {
  beforeEach(() => {
    memoryReservations.clear();
    memoryLandings.clear();
  });

  it('evicts oldest reservations when exceeding MAX_MEMORY_RESERVATIONS (1000)', () => {
    expect(MAX_MEMORY_RESERVATIONS).toBe(1000);

    // Insert 1005 items
    for (let i = 1; i <= 1005; i++) {
      memoryReservations.set(`res_${i}`, { id: `res_${i}`, customerName: `Cust ${i}` } as any);
    }

    // Size must be capped at 1000
    expect(memoryReservations.size).toBe(1000);

    // res_1 to res_5 must have been evicted (FIFO)
    expect(memoryReservations.has('res_1')).toBe(false);
    expect(memoryReservations.has('res_2')).toBe(false);
    expect(memoryReservations.has('res_5')).toBe(false);

    // res_6 and res_1005 must be present
    expect(memoryReservations.has('res_6')).toBe(true);
    expect(memoryReservations.has('res_1005')).toBe(true);
  });

  it('evicts oldest landings when exceeding MAX_MEMORY_LANDINGS (500)', () => {
    expect(MAX_MEMORY_LANDINGS).toBe(500);

    // Insert 505 items
    for (let i = 1; i <= 505; i++) {
      memoryLandings.set(`land_${i}`, { id: `land_${i}`, slug: `slug-${i}` } as any);
    }

    // Size must be capped at 500
    expect(memoryLandings.size).toBe(500);

    // land_1 to land_5 must have been evicted (FIFO)
    expect(memoryLandings.has('land_1')).toBe(false);
    expect(memoryLandings.has('land_5')).toBe(false);

    // land_6 and land_505 must be present
    expect(memoryLandings.has('land_6')).toBe(true);
    expect(memoryLandings.has('land_505')).toBe(true);
  });
});
