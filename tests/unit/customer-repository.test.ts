import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PostgresCustomerRepository,
  InMemoryCustomerRepository,
  getCustomerRepository,
  setCustomerRepository,
  resetCustomerRepository,
} from '../../src/repositories/customer.repository';
import { prisma } from '../../src/db/client';

/**
 * PLAN 8 FASE 5a — Repository seam customer.
 * Membuktikan: produksi fail-closed (throw, tanpa objek fiktif), test double eksplisit.
 *
 * Catatan: tests/setup.ts me-mock prisma global (selalu reject). Test ini
 * menimpa per-kasus via vi.mocked agar perilaku sukses dapat diverifikasi.
 */

describe('FASE 5a — customer repository', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCustomerRepository();
  });

  it('default adapter adalah Postgres (produksi)', () => {
    expect(getCustomerRepository()).toBeInstanceOf(PostgresCustomerRepository);
  });

  it('Postgres: DB error DILEMPAR (fail-closed), tanpa objek fiktif', async () => {
    vi.mocked(prisma.customer.findFirst).mockRejectedValue(new Error('Database offline'));
    const repo = new PostgresCustomerRepository();
    await expect(repo.findByPhone('6281', 't')).rejects.toThrow('Database offline');
  });

  it('Postgres: create null → throw (bukan return null diam-diam)', async () => {
    vi.mocked(prisma.customer.create).mockResolvedValue(null as any);
    const repo = new PostgresCustomerRepository();
    await expect(repo.create({ tenant_id: 't', phone: '6281' })).rejects.toThrow();
  });

  it('Postgres: tenant mismatch → null (isolasi tenant)', async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({ id: 'c1', tenant_id: 'other' } as any);
    const repo = new PostgresCustomerRepository();
    expect(await repo.findById('c1', 't')).toBeNull();
  });

  it('Postgres: tenant cocok → record', async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue({ id: 'c1', tenant_id: 't' } as any);
    const repo = new PostgresCustomerRepository();
    expect(await repo.findById('c1', 't')).not.toBeNull();
  });

  it('InMemory: CRUD penuh tanpa I/O', async () => {
    const repo = new InMemoryCustomerRepository();
    const created = await repo.create({ tenant_id: 't', phone: '6281', name: 'Bunda' });
    expect(created.id).toMatch(/^cust_/);
    expect(await repo.findByPhone('6281', 't')).not.toBeNull();
    expect(await repo.findById(created.id, 't')).not.toBeNull();
    const updated = await repo.update(created.id, { kota: 'Sidoarjo' });
    expect(updated.kota).toBe('Sidoarjo');
  });

  it('InMemory: update id tak dikenal → throw (bukan diam)', async () => {
    const repo = new InMemoryCustomerRepository();
    await expect(repo.update('nope', {})).rejects.toThrow();
  });

  it('set/reset: wiring eksplisit untuk test', () => {
    const mem = new InMemoryCustomerRepository();
    setCustomerRepository(mem);
    expect(getCustomerRepository()).toBe(mem);
    resetCustomerRepository();
    expect(getCustomerRepository()).toBeInstanceOf(PostgresCustomerRepository);
  });

  it('isolasi tenant: phone sama di tenant berbeda TIDAK saling terlihat', async () => {
    const repo = new InMemoryCustomerRepository();
    await repo.create({ tenant_id: 'tenant-a', phone: '6281' });
    expect(await repo.findByPhone('6281', 'tenant-b')).toBeNull();
    expect(await repo.findByPhone('6281', 'tenant-a')).not.toBeNull();
  });

  it('updateManyByPhoneTenant: hanya tenant yang diminta yang ter-update', async () => {
    const repo = new InMemoryCustomerRepository();
    await repo.create({ tenant_id: 'tenant-a', phone: '6281' });
    await repo.create({ tenant_id: 'tenant-b', phone: '6281' });
    const n = await repo.updateManyByPhoneTenant('6281', 'tenant-a', { is_hold_labeled: true });
    expect(n).toBe(1);
    expect((await repo.findByPhone('6281', 'tenant-a'))?.is_hold_labeled).toBe(true);
    expect((await repo.findByPhone('6281', 'tenant-b'))?.is_hold_labeled).not.toBe(true);
  });

  it('Postgres updateManyByPhoneTenant mendelegasikan ke prisma dengan filter tenant', async () => {
    const spy = vi.mocked(prisma.customer.updateMany).mockResolvedValue({ count: 1 } as any);
    const repo = new PostgresCustomerRepository();
    expect(await repo.updateManyByPhoneTenant('6281', 'tenant-a', { is_hold_labeled: true })).toBe(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phone: '6281', tenant_id: 'tenant-a' } })
    );
  });
});
