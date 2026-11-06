import { describe, expect, it } from 'vitest';
import { StaffOwnershipService } from '../../src/services/staff-ownership.service';

describe('StaffOwnershipService — komposisi', () => {
  it('merangkai owner, last, nama, dan status nonaktif', async () => {
    const fakePrisma = {
      reservation: {
        findMany: async () => [
          {
            customer_id: 'c1',
            status: 'completed',
            booking_date: new Date('2026-01-12T03:00:00.000Z'),
            assigned_staff_id: 's1',
            created_at: new Date('2026-01-12T03:00:00.000Z'),
            series_id: null,
            session_number: null,
            assigned_staff: { id: 's1', name: 'Bidan Hanifah', active: false },
          },
          {
            customer_id: 'c1',
            status: 'completed',
            booking_date: new Date('2026-02-03T03:00:00.000Z'),
            assigned_staff_id: 's2',
            created_at: new Date('2026-02-03T03:00:00.000Z'),
            series_id: null,
            session_number: null,
            assigned_staff: { id: 's2', name: 'Bidan Thabita', active: true },
          },
        ],
      },
    };
    const service = new StaffOwnershipService(fakePrisma as any);
    const map = await service.getByCustomerIds('default-tenant', ['c1']);
    const own = map.get('c1')!;
    expect(own.ownerStaffId).toBe('s1');
    expect(own.ownerStaffName).toBe('Bidan Hanifah');
    expect(own.lastStaffId).toBe('s2');
    expect(own.lastStaffName).toBe('Bidan Thabita');
    expect(own.hasRotation).toBe(true);
    expect(own.ownerInactive).toBe(true);
    expect(own.totalVisits).toBe(2);
  });
});

describe('StaffOwnershipService — fail-open', () => {
  it('DB offline → Map kosong, tidak throw', async () => {
    const service = new StaffOwnershipService();
    await expect(service.getByCustomerIds('default-tenant', ['c1'])).resolves.toBeInstanceOf(Map);
    const map = await service.getByCustomerIds('default-tenant', ['c1']);
    expect(map.size).toBe(0);
  });

  it('customerIds kosong → tidak query, Map kosong', async () => {
    const service = new StaffOwnershipService();
    const map = await service.getByCustomerIds('default-tenant', []);
    expect(map.size).toBe(0);
  });
});
