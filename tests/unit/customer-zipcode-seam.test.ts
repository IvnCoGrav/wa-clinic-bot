import { describe, it, expect, beforeEach, vi } from 'vitest';
import { customerService } from '../../src/services/customer.service';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('customerService.updateCustomerZipcodeIfEmpty — seam kanonis zipcode', () => {
  beforeEach(() => {
    customerService.getMemoryCustomers().clear();
    vi.clearAllMocks();
  });

  it('mengisi zipcode hanya bila kolom masih kosong (non-destruktif)', async () => {
    vi.mocked(prisma.customer.updateMany).mockResolvedValue({ count: 1 } as any);

    const ok = await customerService.updateCustomerZipcodeIfEmpty(
      'cust-zip-1',
      '61254',
      DEFAULT_TENANT_ID
    );

    expect(ok).toBe(true);
    expect(prisma.customer.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'cust-zip-1',
        tenant_id: DEFAULT_TENANT_ID,
        OR: [{ zipcode: null }, { zipcode: '' }],
      },
      data: { zipcode: '61254' },
    });
  });

  it('tidak menimpa zipcode yang sudah ada (count 0)', async () => {
    vi.mocked(prisma.customer.updateMany).mockResolvedValue({ count: 0 } as any);

    const ok = await customerService.updateCustomerZipcodeIfEmpty(
      'cust-zip-2',
      '61254',
      DEFAULT_TENANT_ID
    );

    expect(ok).toBe(false);
  });

  it('fallback memori saat DB offline (test runtime)', async () => {
    vi.mocked(prisma.customer.updateMany).mockRejectedValue(new Error('Database offline'));
    const mem = customerService.getMemoryCustomers();
    mem.set('cust-zip-3', {
      id: 'cust-zip-3',
      tenant_id: DEFAULT_TENANT_ID,
      zipcode: null,
    });

    const ok = await customerService.updateCustomerZipcodeIfEmpty(
      'cust-zip-3',
      '61256',
      DEFAULT_TENANT_ID
    );

    expect(ok).toBe(true);
    expect(mem.get('cust-zip-3')?.zipcode).toBe('61256');
  });

  it('menolak kode pos tidak valid tanpa menyentuh DB', async () => {
    const ok = await customerService.updateCustomerZipcodeIfEmpty(
      'cust-zip-4',
      'abc',
      DEFAULT_TENANT_ID
    );

    expect(ok).toBe(false);
    expect(prisma.customer.updateMany).not.toHaveBeenCalled();
  });

  it('tidak menimpa zipcode memori yang sudah ada', async () => {
    vi.mocked(prisma.customer.updateMany).mockRejectedValue(new Error('Database offline'));
    const mem = customerService.getMemoryCustomers();
    mem.set('cust-zip-5', {
      id: 'cust-zip-5',
      tenant_id: DEFAULT_TENANT_ID,
      zipcode: '60111',
    });

    const ok = await customerService.updateCustomerZipcodeIfEmpty(
      'cust-zip-5',
      '61254',
      DEFAULT_TENANT_ID
    );

    expect(ok).toBe(false);
    expect(mem.get('cust-zip-5')?.zipcode).toBe('60111');
  });
});
