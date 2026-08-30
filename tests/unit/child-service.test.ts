import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsertMock = vi.fn();
const findManyMock = vi.fn();

vi.mock('../../src/db/client', () => ({
  prisma: {
    child: {
      upsert: upsertMock,
      findMany: findManyMock,
    },
  },
}));

import { childService } from '../../src/services/child.service';

describe('ChildService — persistensi anak per customer', () => {
  beforeEach(() => {
    upsertMock.mockReset();
    findManyMock.mockReset();
  });

  it('upsert 2 anak dari daftar bayi (Rara, Riri)', async () => {
    upsertMock.mockResolvedValue({ id: 'c1' });

    await childService.upsertChildrenFromBabies({
      customerId: 'cust-1',
      reservationId: 'res-1',
      tenantId: 'default-tenant',
      babies: [
        { name: 'Rara', age: '6 bulan' },
        { name: 'Riri', age: '2 tahun' },
      ],
    });

    expect(upsertMock).toHaveBeenCalledTimes(2);

    const raraCall = upsertMock.mock.calls[0][0];
    expect(raraCall.where).toEqual({ customer_id_name: { customer_id: 'cust-1', name: 'Rara' } });
    expect(raraCall.create.name).toBe('Rara');
    expect(raraCall.create.customer_id).toBe('cust-1');
    expect(raraCall.create.reservation_id).toBe('res-1');
    expect(raraCall.create.birth_date).toBeInstanceOf(Date);
    expect(raraCall.create.raw_age_text).toBe('6 bulan');
    expect(raraCall.create.age_months_at_registration).toBe(5);
  });

  it('anak tanpa nama / nama "-" dilewati', async () => {
    upsertMock.mockResolvedValue({ id: 'c1' });
    await childService.upsertChildrenFromBabies({
      customerId: 'cust-1',
      reservationId: 'res-1',
      tenantId: 'default-tenant',
      babies: [{ name: '-', age: '6 bulan' }, { name: '   ', age: '' }],
    });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('babies kosong → tidak memanggil DB', async () => {
    await childService.upsertChildrenFromBabies({
      customerId: 'cust-1',
      reservationId: 'res-1',
      tenantId: 'default-tenant',
      babies: [],
    });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('getChildrenWithCurrentAge menghitung current_age realtime', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'child-1',
        name: 'Rara',
        birth_date: new Date('2026-02-02T00:00:00.000Z'),
        raw_age_text: '6 bulan',
        age_months_at_registration: 6,
        created_at: new Date('2026-02-02T00:00:00.000Z'),
      },
    ]);

    const children = await childService.getChildrenWithCurrentAge('cust-1', new Date('2026-08-02T00:00:00.000Z'));
    expect(children).toHaveLength(1);
    expect(children[0].name).toBe('Rara');
    expect(children[0].current_age).toBe('6 bulan');
  });

  it('DB error → senyap, return []', async () => {
    findManyMock.mockRejectedValue(new Error('Database offline'));
    const children = await childService.getChildrenWithCurrentAge('cust-1');
    expect(children).toEqual([]);
  });
});
