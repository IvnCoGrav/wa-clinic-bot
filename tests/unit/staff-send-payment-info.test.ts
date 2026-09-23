import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import { liveChatService } from '../../src/services/live-chat.service';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

describe('StaffReservationService.sendPaymentInfo', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should send QRIS image and bank details via liveChatService.sendAdminReply with mediaUrl', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      id: 'res-101',
      tenant_id: DEFAULT_TENANT_ID,
      assigned_staff_id: 'staff-1',
      treatment_detail: 'Pijat Bayi Batuk Pilek',
      purchase_value: 150000,
      customer: {
        name: 'Bunda Sarah',
        ongkir: 20000,
        conversations: [
          { id: 'conv-101', tenant_id: DEFAULT_TENANT_ID },
        ],
      },
      assigned_staff: { id: 'staff-1', name: 'Bidan Rina' },
    } as any);

    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: DEFAULT_TENANT_ID,
      name: 'Kala Spa Surabaya',
      settings: {
        paymentInfo: {
          qrisImageUrl: '/media/outbound/default-tenant/qris-kala.png',
          bankAccounts: [
            { bank: 'BCA', accountNumber: '8877665544', accountName: 'PT Kala Sejahtera' },
          ],
          instructions: 'Mohon konfirmasi transfer ke admin via chat',
        },
      },
    } as any);

    const sendAdminReplySpy = vi.spyOn(liveChatService, 'sendAdminReply').mockResolvedValueOnce({
      success: true,
      messageId: 'msg-999',
    } as any);

    const result = await StaffReservationService.sendPaymentInfo({
      reservationId: 'res-101',
      staffId: 'staff-1',
      tenantId: DEFAULT_TENANT_ID,
      staffName: 'Bidan Rina',
      isSupervisor: false,
    });

    expect(result.success).toBe(true);
    expect(result.data?.hasQris).toBe(true);
    expect(result.data?.totalFee).toBe(170000);

    expect(sendAdminReplySpy).toHaveBeenCalledTimes(1);
    const callArgs = sendAdminReplySpy.mock.calls[0][0];
    expect(callArgs.conversationId).toBe('conv-101');
    expect(callArgs.mediaUrl).toBe('/media/outbound/default-tenant/qris-kala.png');
    expect(callArgs.text).toContain('Bunda Sarah');
    expect(callArgs.text).toContain('Rp 170.000');
    expect(callArgs.text).toContain('8877665544');
    expect(callArgs.text).toContain('~ Bidan Rina');
    expect(callArgs.forceEscalate).toBe(true);
  });

  it('should send text-only payment info when QRIS is not uploaded', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      id: 'res-102',
      tenant_id: DEFAULT_TENANT_ID,
      assigned_staff_id: 'staff-1',
      treatment_detail: 'Baby Massage Relaxing',
      purchase_value: 120000,
      customer: {
        name: 'Bunda Maya',
        ongkir: 15000,
        conversations: [
          { id: 'conv-102', tenant_id: DEFAULT_TENANT_ID },
        ],
      },
      assigned_staff: { id: 'staff-1', name: 'Bidan Rina' },
    } as any);

    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: DEFAULT_TENANT_ID,
      name: 'Kala Spa Surabaya',
      settings: {
        paymentInfo: {
          qrisImageUrl: null,
          bankAccounts: [
            { bank: 'Mandiri', accountNumber: '1122334455', accountName: 'Kala Spa' },
          ],
        },
      },
    } as any);

    const sendAdminReplySpy = vi.spyOn(liveChatService, 'sendAdminReply').mockResolvedValueOnce({
      success: true,
      messageId: 'msg-998',
    } as any);

    const result = await StaffReservationService.sendPaymentInfo({
      reservationId: 'res-102',
      staffId: 'staff-1',
      tenantId: DEFAULT_TENANT_ID,
      staffName: 'Bidan Rina',
      isSupervisor: false,
    });

    expect(result.success).toBe(true);
    expect(result.data?.hasQris).toBe(false);
    expect(result.data?.totalFee).toBe(135000);

    expect(sendAdminReplySpy).toHaveBeenCalledTimes(1);
    const callArgs = sendAdminReplySpy.mock.calls[0][0];
    expect(callArgs.mediaUrl).toBeUndefined();
    expect(callArgs.text).toContain('Mandiri');
    expect(callArgs.text).toContain('1122334455');
  });

  it('should enforce Anti-IDOR and reject staff trying to send payment for another therapist reservation', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      id: 'res-103',
      tenant_id: DEFAULT_TENANT_ID,
      assigned_staff_id: 'staff-99', // assigned to someone else
      customer: {
        name: 'Bunda Sarah',
        conversations: [{ id: 'conv-103' }],
      },
    } as any);

    const result = await StaffReservationService.sendPaymentInfo({
      reservationId: 'res-103',
      staffId: 'staff-1', // current staff
      tenantId: DEFAULT_TENANT_ID,
      staffName: 'Bidan Rina',
      isSupervisor: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('hak akses');
  });

  it('should fail if no WhatsApp conversation is connected to the customer', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      id: 'res-104',
      tenant_id: DEFAULT_TENANT_ID,
      assigned_staff_id: 'staff-1',
      customer: {
        name: 'Bunda Sarah',
        conversations: [], // no conversation
      },
    } as any);

    const result = await StaffReservationService.sendPaymentInfo({
      reservationId: 'res-104',
      staffId: 'staff-1',
      tenantId: DEFAULT_TENANT_ID,
      staffName: 'Bidan Rina',
      isSupervisor: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('percakapan WhatsApp');
  });

  it('should render customTemplate with all 8 placeholders substituted', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      id: 'res-201',
      tenant_id: DEFAULT_TENANT_ID,
      assigned_staff_id: 'staff-1',
      treatment_detail: 'Pijat Laktasi',
      purchase_value: 200000,
      customer: {
        name: 'Bunda Sari',
        ongkir: 25000,
        conversations: [{ id: 'conv-201', tenant_id: DEFAULT_TENANT_ID }],
      },
      assigned_staff: { id: 'staff-1', name: 'Bidan Rina' },
    } as any);

    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: DEFAULT_TENANT_ID,
      name: 'Kala Spa',
      settings: {
        paymentInfo: {
          qrisImageUrl: '/media/outbound/qris.png',
          bankAccounts: [{ bank: 'BCA', accountNumber: '999888', accountName: 'PT Kala' }],
          instructions: 'Konfirmasi ke admin',
          customTemplate: 'Halo {nama_pasien} tagihan {total_tagihan} rincian {rincian_biaya} layanan {daftar_layanan} rekening {daftar_rekening} qris {keterangan_qris} petunjuk {petunjuk} terapis {nama_terapis} end',
        },
      },
    } as any);

    const spy = vi.spyOn(liveChatService, 'sendAdminReply').mockResolvedValueOnce({ success: true } as any);
    const result = await StaffReservationService.sendPaymentInfo({
      reservationId: 'res-201', staffId: 'staff-1', tenantId: DEFAULT_TENANT_ID, staffName: 'Bidan Rina', isSupervisor: false,
    });
    expect(result.success).toBe(true);
    const text = spy.mock.calls[0][0].text as string;
    expect(text).toContain('Bunda Sari');
    expect(text).toContain('Rp 225.000');
    expect(text).toContain('Pijat Laktasi');
    expect(text).toContain('999888');
    expect(text).toContain('Bidan Rina');
    expect(text).not.toContain('{nama_pasien}');
    expect(text).not.toContain('{total_tagihan}');
  });

  it('should fallback to default layout when customTemplate is null/empty', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      id: 'res-202',
      tenant_id: DEFAULT_TENANT_ID,
      assigned_staff_id: 'staff-1',
      treatment_detail: 'Baby Spa',
      purchase_value: 100000,
      customer: {
        name: 'Bunda Maya', ongkir: 10000,
        conversations: [{ id: 'conv-202', tenant_id: DEFAULT_TENANT_ID }],
      },
      assigned_staff: { id: 'staff-1', name: 'Bidan Rina' },
    } as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: DEFAULT_TENANT_ID, name: 'Kala', settings: { paymentInfo: { qrisImageUrl: null, bankAccounts: [{ bank: 'BRI', accountNumber: '111', accountName: 'Kala' }], customTemplate: '' } },
    } as any);
    const spy = vi.spyOn(liveChatService, 'sendAdminReply').mockResolvedValueOnce({ success: true } as any);
    const result = await StaffReservationService.sendPaymentInfo({
      reservationId: 'res-202', staffId: 'staff-1', tenantId: DEFAULT_TENANT_ID, staffName: 'Bidan Rina', isSupervisor: false,
    });
    expect(result.success).toBe(true);
    expect(spy.mock.calls[0][0].text).toContain('Bunda Maya');
    expect(spy.mock.calls[0][0].text).toContain('Rp 110.000');
  });

  it('should replace missing placeholder values without error (graceful empty)', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      id: 'res-203',
      tenant_id: DEFAULT_TENANT_ID,
      assigned_staff_id: 'staff-1',
      treatment_detail: null,
      purchase_value: 0,
      customer: {
        name: 'Bunda N',
        ongkir: 0,
        conversations: [{ id: 'conv-203', tenant_id: DEFAULT_TENANT_ID }],
      },
      assigned_staff: { id: 'staff-1', name: 'Bidan Rina' },
    } as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: DEFAULT_TENANT_ID, name: 'Kala', settings: { paymentInfo: { qrisImageUrl: null, bankAccounts: [{ bank: 'BCA', accountNumber: '222', accountName: 'Kala' }], customTemplate: 'Hai {nama_pasien} layanan {daftar_layanan} total {total_tagihan}' } },
    } as any);
    const spy = vi.spyOn(liveChatService, 'sendAdminReply').mockResolvedValueOnce({ success: true } as any);
    const result = await StaffReservationService.sendPaymentInfo({
      reservationId: 'res-203', staffId: 'staff-1', tenantId: DEFAULT_TENANT_ID, staffName: 'Bidan Rina', isSupervisor: false,
    });
    expect(result.success).toBe(true);
    const text = spy.mock.calls[0][0].text as string;
    expect(text).toContain('Bunda N');
    expect(text).not.toContain('{daftar_layanan}');
  });
});
