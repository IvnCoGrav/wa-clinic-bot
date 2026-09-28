import { describe, it, expect, beforeEach } from 'vitest';
import { filterMemoryByTenant, memoryReservations } from '../../src/routes/admin/stores';

/**
 * FASE 1.1 — Isolasi multi-tenant fallback in-memory.
 * Saat DB offline, endpoint reservasi memakai memoryReservations. Tanpa filter
 * tenant, admin Tenant B dapat melihat reservasi Tenant A (kebocoran lintas-tenant).
 */
describe('FASE 1.1 — filterMemoryByTenant (isolasi tenant fallback in-memory)', () => {
  beforeEach(() => {
    memoryReservations.clear();
  });

  it('hanya mengembalikan record milik tenant yang diminta', () => {
    memoryReservations.set('a1', { id: 'a1', tenant_id: 'tenant-a', treatment_detail: 'X' });
    memoryReservations.set('a2', { id: 'a2', tenant_id: 'tenant-a', treatment_detail: 'Y' });
    memoryReservations.set('b1', { id: 'b1', tenant_id: 'tenant-b', treatment_detail: 'Z' });

    const a = filterMemoryByTenant(memoryReservations.values(), 'tenant-a');
    const b = filterMemoryByTenant(memoryReservations.values(), 'tenant-b');

    expect(a).toHaveLength(2);
    expect(a.every((r) => r.tenant_id === 'tenant-a')).toBe(true);
    expect(b).toHaveLength(1);
    expect(b[0].id).toBe('b1');
  });

  it('tenant tak dikenal → array kosong (tidak bocor)', () => {
    memoryReservations.set('a1', { id: 'a1', tenant_id: 'tenant-a' });
    expect(filterMemoryByTenant(memoryReservations.values(), 'tenant-c')).toHaveLength(0);
  });

  it('record tanpa tenant_id DILARANG bocor ke tenant mana pun', () => {
    memoryReservations.set('x', { id: 'x' });
    expect(filterMemoryByTenant(memoryReservations.values(), 'tenant-a')).toHaveLength(0);
  });
});
