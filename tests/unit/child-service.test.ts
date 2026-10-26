import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsertMock = vi.fn();
const findManyMock = vi.fn();
const findFirstMock = vi.fn();
const updateMock = vi.fn();

vi.mock('../../src/db/client', () => ({
  prisma: {
    child: {
      upsert: upsertMock,
      findMany: findManyMock,
      findFirst: findFirstMock,
      update: updateMock,
    },
  },
}));

import { childService } from '../../src/services/child.service';

describe('ChildService — persistensi anak per customer', () => {
  beforeEach(() => {
    upsertMock.mockReset();
    findManyMock.mockReset();
    findFirstMock.mockReset();
    updateMock.mockReset();
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

  it('anak duplikat beda kapitalisasi (Zayn vs zayn) diarahkan ke update child eksisting tanpa baris baru', async () => {
    findFirstMock.mockResolvedValue({
      id: 'existing-zayn-id',
      name: 'Zayn',
      reservation_id: 'res-old',
      birth_date: new Date('2025-07-03'),
      age_months_at_registration: 14,
      raw_age_text: '14 bulan',
    });
    updateMock.mockResolvedValue({ id: 'existing-zayn-id' });

    await childService.upsertChildrenFromBabies({
      customerId: 'cust-1',
      reservationId: 'res-new',
      tenantId: 'default-tenant',
      babies: [{ name: 'zayn', age: '15 bulan' }],
    });

    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        customer_id: 'cust-1',
        name: { equals: 'zayn', mode: 'insensitive' },
      },
    });
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-zayn-id' },
        data: expect.objectContaining({
          reservation_id: 'res-new',
          raw_age_text: '15 bulan',
        }),
      })
    );
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('placeholder form formulir (Bayi 1, Bayi 2, Bayi 3, Anak 1) ditolak dari tabel children', async () => {
    await childService.upsertChildrenFromBabies({
      customerId: 'cust-1',
      reservationId: 'res-1',
      tenantId: 'default-tenant',
      babies: [
        { name: 'Bayi 1', age: '1 bulan' },
        { name: 'Bayi 2', age: '5 tahun' },
        { name: 'Bayi 3', age: '3 thn' },
        { name: 'Anak 1', age: '2 tahun' },
      ],
    });

    expect(findFirstMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('entitas ibu hamil/nifas atau instruksi medis ditolak dari tabel children', async () => {
    await childService.upsertChildrenFromBabies({
      customerId: 'cust-1',
      reservationId: 'res-1',
      tenantId: 'default-tenant',
      babies: [
        { name: 'Bella', age: 'hamil 37-38 minggu' },
        { name: 'Farida', age: 'hamil 27 minggu' },
        { name: 'zayyan boleh nebul k', age: '4 bulan' },
      ],
    });

    expect(findFirstMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
