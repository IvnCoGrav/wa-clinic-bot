import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertMock, findManyMock } = vi.hoisted(() => ({
  upsertMock: vi.fn(),
  findManyMock: vi.fn(),
}));

vi.mock('../../src/db/client', () => ({
  prisma: {
    child: {
      upsert: upsertMock,
      findMany: findManyMock,
    },
  },
}));

import { childService } from '../../src/services/child.service';

describe('ChildService — persistensi anak per customer (atomik name_norm)', () => {
  beforeEach(() => {
    upsertMock.mockReset();
    findManyMock.mockReset();
  });

  it('upsert 2 anak dari daftar bayi (Rara, Riri) menggunakan customer_id_name_norm', async () => {
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
    expect(raraCall.where).toEqual({
      customer_id_name_norm: { customer_id: 'cust-1', name_norm: 'rara' },
    });
    expect(raraCall.create.name).toBe('Rara');
    expect(raraCall.create.name_norm).toBe('rara');
    expect(raraCall.create.customer_id).toBe('cust-1');
    expect(raraCall.create.reservation_id).toBe('res-1');
    expect(raraCall.create.first_reservation_id).toBe('res-1');
    expect(raraCall.create.last_reservation_id).toBe('res-1');
    expect(raraCall.create.birth_date).toBeInstanceOf(Date);
    expect(raraCall.create.raw_age_text).toBe('6 bulan');
    expect(raraCall.create.age_months_at_registration).toBe(5);

    // Pastikan update hanya menyentuh last_reservation_id dan tidak merusak first_reservation_id
    expect(raraCall.update.last_reservation_id).toBe('res-1');
    expect(raraCall.update.first_reservation_id).toBeUndefined();
    expect(raraCall.update.name_norm).toBeUndefined();
  });

  it('dedup atomik case-insensitive (Zayn vs zayn): where key identik', async () => {
    upsertMock.mockResolvedValue({ id: 'c1' });

    // Simulasi 2 panggilan paralel berurutan / konkuren
    await Promise.all([
      childService.upsertChildrenFromBabies({
        customerId: 'cust-1',
        reservationId: 'res-1',
        tenantId: 'default-tenant',
        babies: [{ name: 'Zayn', age: '14 bulan' }],
      }),
      childService.upsertChildrenFromBabies({
        customerId: 'cust-1',
        reservationId: 'res-2',
        tenantId: 'default-tenant',
        babies: [{ name: 'zayn', age: '15 bulan' }],
      }),
    ]);

    expect(upsertMock).toHaveBeenCalledTimes(2);

    const call1 = upsertMock.mock.calls[0][0];
    const call2 = upsertMock.mock.calls[1][0];

    expect(call1.where.customer_id_name_norm).toEqual({
      customer_id: 'cust-1',
      name_norm: 'zayn',
    });
    expect(call2.where.customer_id_name_norm).toEqual({
      customer_id: 'cust-1',
      name_norm: 'zayn',
    });

    // Panggilan kedua mengupdate last_reservation_id ke res-2 tanpa menyentuh first_reservation_id
    expect(call2.update.last_reservation_id).toBe('res-2');
    expect(call2.update.first_reservation_id).toBeUndefined();
  });

  it('nama dengan spasi berlebih dinormalisasi ke name_norm yang bersih', async () => {
    upsertMock.mockResolvedValue({ id: 'c1' });

    await childService.upsertChildrenFromBabies({
      customerId: 'cust-1',
      reservationId: 'res-1',
      tenantId: 'default-tenant',
      babies: [{ name: '   Kenzo   ', age: '1 tahun' }],
    });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const call = upsertMock.mock.calls[0][0];
    expect(call.where.customer_id_name_norm.name_norm).toBe('kenzo');
    expect(call.create.name).toBe('Kenzo');
    expect(call.create.name_norm).toBe('kenzo');
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

    expect(upsertMock).not.toHaveBeenCalled();
  });
});
