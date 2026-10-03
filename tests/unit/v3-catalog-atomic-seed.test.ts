import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import { prisma } from '../../src/db/client';
import { saveDeliveryTiersToDb } from '../../src/services/delivery.service';
import { saveServicesToDb } from '../../src/services/treatment-catalog.service';

/**
 * D.1 (audit #199) — seed katalog/tier WAJIB atomik (delete+create dalam satu
 * transaksi) agar tidak ada state "kosong/setengah" bila proses terputus.
 * CATATAN: fs.writeFileSync di-mock agar test TIDAK menimpa file tier asli
 * (pelajaran: test yang menulis disk dapat merusak test lain).
 */
describe('D.1 — seed katalog/tier atomik', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saveDeliveryTiersToDb memakai $transaction (bukan delete/create terpisah)', async () => {
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined as any);
    const txSpy = vi.mocked(prisma.$transaction).mockResolvedValueOnce([] as any);
    await saveDeliveryTiersToDb([{ id: 1, maxDist: 5, fee: 0, promoDiscount: 0 } as any]);
    expect(txSpy).toHaveBeenCalledTimes(1);
    const arg = txSpy.mock.calls[0][0];
    expect(Array.isArray(arg)).toBe(true);
    expect((arg as any[]).length).toBe(2);
  });

  it('saveServicesToDb memakai $transaction', async () => {
    const txSpy = vi.mocked(prisma.$transaction).mockResolvedValueOnce([] as any);
    await saveServicesToDb('default-tenant');
    expect(txSpy).toHaveBeenCalledTimes(1);
    const arg = txSpy.mock.calls[0][0];
    expect(Array.isArray(arg)).toBe(true);
    expect((arg as any[]).length).toBe(2);
  });
});
