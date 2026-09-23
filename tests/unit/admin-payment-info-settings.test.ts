import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('Admin & Staff Payment Info Settings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('getPaymentInfo: should read paymentInfo from Tenant.settings when present', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: DEFAULT_TENANT_ID,
      name: 'Kala Spa Surabaya',
      settings: {
        paymentInfo: {
          qrisImageUrl: 'https://cdn.example.com/qris-kala.png',
          bankAccounts: [
            { bank: 'BCA', accountNumber: '8877665544', accountName: 'PT Kala Sejahtera' },
            { bank: 'Mandiri', accountNumber: '1122334455', accountName: 'PT Kala Sejahtera' },
          ],
          instructions: 'Harap konfirmasi transfer ke admin via chat',
        },
      },
    } as any);

    const result = await StaffReservationService.getPaymentInfo(DEFAULT_TENANT_ID);

    expect(result.qrisImageUrl).toBe('https://cdn.example.com/qris-kala.png');
    expect(result.bankAccounts).toHaveLength(2);
    expect(result.bankAccounts[0].bank).toBe('BCA');
    expect(result.bankAccounts[0].accountNumber).toBe('8877665544');
    expect(result.instructions).toBe('Harap konfirmasi transfer ke admin via chat');
  });

  it('getPaymentInfo: should fallback to ClinicPolicy payment_methods if Tenant.settings is empty', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: DEFAULT_TENANT_ID,
      name: 'Kala Spa Surabaya',
      settings: {},
    } as any);

    vi.mocked((prisma as any).clinicPolicy.findUnique).mockResolvedValueOnce({
      tenant_id: DEFAULT_TENANT_ID,
      topic: 'payment_methods',
      is_active: true,
      factual_summary: JSON.stringify({
        qrisImageUrl: 'https://cdn.example.com/policy-qris.png',
        bankAccounts: [
          { bank: 'BRI', accountNumber: '5566778899', accountName: 'Kala Spa' },
        ],
        instructions: 'Scan QRIS untuk pembayaran instan',
      }),
    } as any);

    const result = await StaffReservationService.getPaymentInfo(DEFAULT_TENANT_ID);

    expect(result.qrisImageUrl).toBe('https://cdn.example.com/policy-qris.png');
    expect(result.bankAccounts).toHaveLength(1);
    expect(result.bankAccounts[0].bank).toBe('BRI');
    expect(result.instructions).toBe('Scan QRIS untuk pembayaran instan');
  });

  it('getPaymentInfo: should return safe default bank account if no settings or policy exist', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: DEFAULT_TENANT_ID,
      name: 'Kala Moms and Baby Spa',
      settings: null,
    } as any);

    vi.mocked((prisma as any).clinicPolicy.findUnique).mockResolvedValueOnce(null);

    const result = await StaffReservationService.getPaymentInfo(DEFAULT_TENANT_ID);

    expect(result.qrisImageUrl).toBeNull();
    expect(result.bankAccounts).toHaveLength(1);
    expect(result.bankAccounts[0].bank).toBe('BCA');
    expect(result.bankAccounts[0].accountName).toBe('Kala Moms and Baby Spa');
  });
});
