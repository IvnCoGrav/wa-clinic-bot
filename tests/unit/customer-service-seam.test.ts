import { describe, it, expect, vi, beforeEach } from 'vitest';
import { customerService } from '../../src/services/customer.service';
import { getCustomerRepository, setCustomerRepository, InMemoryCustomerRepository } from '../../src/repositories/customer.repository';
import { prisma } from '../../src/db/client';

describe('D-02 / CCL-02: Customer mutations routed via CustomerRepository seam', () => {
  let memRepo: InMemoryCustomerRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    memRepo = new InMemoryCustomerRepository();
    setCustomerRepository(memRepo);
  });

  it('updateCustomerName memanggil repository seam dan memperbarui store', async () => {
    const created = await memRepo.create({
      tenant_id: 'tenant-a',
      phone: '628123456789',
      name: 'Bunda Lama',
    });

    const updateSpy = vi.spyOn(memRepo, 'update');
    const updated = await customerService.updateCustomerName(created.id, 'Bunda Baru', 'tenant-a', { force: true });

    expect(updateSpy).toHaveBeenCalledWith(
      created.id,
      expect.objectContaining({ name: 'Bunda Baru' }),
      'tenant-a'
    );
    expect(updated.name).toBe('Bunda Baru');
  });

  it('blockCustomer dan unblockCustomer memanggil repository seam dengan tenantId', async () => {
    const created = await memRepo.create({
      tenant_id: 'tenant-a',
      phone: '628123456789',
      name: 'Bunda Test',
    });

    const updateSpy = vi.spyOn(memRepo, 'update');
    await customerService.blockCustomer(created.id, 'Spamming', 'tenant-a');

    expect(updateSpy).toHaveBeenCalledWith(
      created.id,
      expect.objectContaining({ status: 'blocked', block_reason: 'Spamming' }),
      'tenant-a'
    );

    await customerService.unblockCustomer(created.id, 'tenant-a');
    expect(updateSpy).toHaveBeenCalledWith(
      created.id,
      expect.objectContaining({ status: 'active', block_reason: null }),
      'tenant-a'
    );
  });

  it('markShareLocationSent memanggil repository seam dengan tenantId', async () => {
    const created = await memRepo.create({
      tenant_id: 'tenant-a',
      phone: '628123456789',
      name: 'Bunda Test',
    });

    const updateSpy = vi.spyOn(memRepo, 'update');
    await customerService.markShareLocationSent(created.id, 'tenant-a');

    expect(updateSpy).toHaveBeenCalledWith(
      created.id,
      expect.objectContaining({ share_location_sent: true }),
      'tenant-a'
    );
  });
});
