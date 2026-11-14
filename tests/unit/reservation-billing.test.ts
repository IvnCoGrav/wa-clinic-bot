import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/capi.service', () => ({
  resolveTreatmentValue: vi.fn(),
}));

import { resolveTreatmentValue } from '../../src/services/capi.service';
import { resolveReservationBilling } from '../../src/services/reservation-billing.service';

const mockedResolve = vi.mocked(resolveTreatmentValue);

describe('resolveReservationBilling — prioritas nilai layanan', () => {
  beforeEach(() => {
    mockedResolve.mockReset();
    mockedResolve.mockResolvedValue(undefined);
  });

  it('memakai purchase_value sebagai sumber utama (items & katalog diabaikan)', async () => {
    const billing = await resolveReservationBilling(
      { purchase_value: 250_000, items: [{ price: 999 }], treatment_detail: 'Baby Spa' },
      'tenant-a'
    );
    expect(billing.treatmentFee).toBe(250_000);
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it('jatuh ke total items[] saat purchase_value kosong', async () => {
    const billing = await resolveReservationBilling(
      { purchase_value: 0, items: [{ price: 120_000 }, { price: 80_000 }], treatment_detail: 'Paket' },
      'tenant-a'
    );
    expect(billing.treatmentFee).toBe(200_000);
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it('jatuh ke katalog saat purchase_value & items kosong, dengan tenantId diteruskan', async () => {
    mockedResolve.mockResolvedValueOnce(175_000);
    const billing = await resolveReservationBilling(
      { purchase_value: null, items: [], treatment_detail: 'Pijat Laktasi' },
      'tenant-klinik-b'
    );
    expect(billing.treatmentFee).toBe(175_000);
    expect(mockedResolve).toHaveBeenCalledWith('Pijat Laktasi', 'tenant-klinik-b');
  });

  it('tidak meneruskan nilai negatif/NaN ke total', async () => {
    const billing = await resolveReservationBilling(
      { purchase_value: -50_000, items: [{ price: -1 }, { price: NaN }], treatment_detail: null },
      'tenant-a'
    );
    expect(billing.treatmentFee).toBe(0);
    expect(billing.totalFee).toBe(0);
  });

  it('tetap aman bila resolusi katalog melempar error', async () => {
    mockedResolve.mockRejectedValueOnce(new Error('katalog rusak'));
    const billing = await resolveReservationBilling(
      { purchase_value: 0, treatment_detail: 'Treatment Tanpa Harga' },
      'tenant-a'
    );
    expect(billing.treatmentFee).toBe(0);
    expect(billing.totalFee).toBe(0);
  });
});

describe('resolveReservationBilling — ongkir & item count', () => {
  beforeEach(() => {
    mockedResolve.mockReset();
    mockedResolve.mockResolvedValue(undefined);
  });

  it('memakai snapshot delivery_fee di atas Customer.ongkir', async () => {
    const billing = await resolveReservationBilling(
      { purchase_value: 100_000, delivery_fee: 20_000, customer: { ongkir: 50_000 } },
      'tenant-a'
    );
    expect(billing.deliveryFee).toBe(20_000);
    expect(billing.totalFee).toBe(120_000);
  });

  it('fallback ke Customer.ongkir untuk baris lama tanpa snapshot', async () => {
    const billing = await resolveReservationBilling(
      { purchase_value: 100_000, delivery_fee: null, customer: { ongkir: 35_000 } },
      'tenant-a'
    );
    expect(billing.deliveryFee).toBe(35_000);
    expect(billing.totalFee).toBe(135_000);
  });

  it('ongkir 0 bila tidak ada data sama sekali', async () => {
    const billing = await resolveReservationBilling({ purchase_value: 100_000 }, 'tenant-a');
    expect(billing.deliveryFee).toBe(0);
    expect(billing.totalFee).toBe(100_000);
  });

  it('itemCount = jumlah baris items', async () => {
    const billing = await resolveReservationBilling(
      { purchase_value: 100_000, items: [{ price: 1 }, { price: 2 }, { price: 3 }] },
      'tenant-a'
    );
    expect(billing.itemCount).toBe(3);
  });

  it('itemCount = 1 untuk reservasi lama tanpa items tapi punya treatment_detail', async () => {
    const billing = await resolveReservationBilling(
      { purchase_value: 100_000, treatment_detail: 'Baby Spa' },
      'tenant-a'
    );
    expect(billing.itemCount).toBe(1);
  });
});

describe('resolveReservationBilling — diskon (tagihan kanonis)', () => {
  beforeEach(() => {
    mockedResolve.mockReset();
    mockedResolve.mockResolvedValue(undefined);
  });

  it('mengurangkan diskon dari layanan, bukan dari ongkir', async () => {
    const billing = await resolveReservationBilling(
      { purchase_value: 100_000, discount_amount: 10_000, delivery_fee: 20_000 },
      'tenant-a'
    );
    expect(billing.treatmentFee).toBe(100_000);
    expect(billing.discount).toBe(10_000);
    expect(billing.netFee).toBe(90_000);
    expect(billing.deliveryFee).toBe(20_000);
    expect(billing.totalFee).toBe(110_000);
  });

  it('diskon tidak boleh melebihi nilai layanan (clamp)', async () => {
    const billing = await resolveReservationBilling(
      { purchase_value: 50_000, discount_amount: 80_000, delivery_fee: 0 },
      'tenant-a'
    );
    expect(billing.discount).toBe(50_000);
    expect(billing.netFee).toBe(0);
    expect(billing.totalFee).toBe(0);
  });

  it('diskon negatif/NaN diabaikan', async () => {
    const billing = await resolveReservationBilling(
      { purchase_value: 50_000, discount_amount: -10_000, delivery_fee: 0 },
      'tenant-a'
    );
    expect(billing.discount).toBe(0);
    expect(billing.totalFee).toBe(50_000);
  });
});

describe('resolveReservationBilling — cache batch', () => {
  beforeEach(() => {
    mockedResolve.mockReset();
    mockedResolve.mockResolvedValue(90_000);
  });

  it('treatment_detail sama hanya diresolusi sekali per batch', async () => {
    const cache = new Map();
    const first = await resolveReservationBilling(
      { purchase_value: 0, treatment_detail: 'Baby Spa' },
      'tenant-a',
      cache
    );
    const second = await resolveReservationBilling(
      { purchase_value: 0, treatment_detail: '  baby spa ' },
      'tenant-a',
      cache
    );
    expect(first.treatmentFee).toBe(90_000);
    expect(second.treatmentFee).toBe(90_000);
    expect(mockedResolve).toHaveBeenCalledTimes(1);
  });

  it('tenant berbeda tidak berbagi cache meski detail sama', async () => {
    const cache = new Map();
    await resolveReservationBilling({ purchase_value: 0, treatment_detail: 'Baby Spa' }, 'tenant-a', cache);
    await resolveReservationBilling({ purchase_value: 0, treatment_detail: 'Baby Spa' }, 'tenant-b', cache);
    expect(mockedResolve).toHaveBeenCalledTimes(2);
  });
});

