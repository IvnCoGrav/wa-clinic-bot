import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { NotificationDeliveryService } from '../../src/services/notification-delivery.service';

/**
 * I-009: saat cron mengirim ulang notifikasi yang sebelumnya FAILED dan
 * pengiriman ulang BERHASIL, baris log idempotensi wajib diperbarui menjadi
 * SENT. Sebelumnya P2002 hanya mengembalikan id lama → status FAILED permanen
 * dan cron mengirim ulang tanpa henti.
 */
describe('NotificationDeliveryService — resend idempotensi (I-009)', () => {
  const svc: any = new NotificationDeliveryService();
  const base = {
    tenantId: 'tenant-1',
    channel: 'WHATSAPP',
    recipient: '628111',
    type: 'ALERT_URGENT',
    reportDate: '2026-11-10',
    title: 'Alert',
    messageContent: 'Isi',
    idempotencyKey: 'key-1',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resend sukses memperbarui baris FAILED menjadi SENT', async () => {
    vi.spyOn(prisma.adminNotificationLog, 'findUnique').mockResolvedValue({ id: 'log-1', status: 'FAILED' } as any);
    vi.spyOn(prisma.adminNotificationLog, 'create').mockRejectedValue(
      Object.assign(new Error('duplicate'), { code: 'P2002' })
    );
    const updateSpy = vi.spyOn(prisma.adminNotificationLog, 'update').mockResolvedValue({} as any);

    const id = await svc.writeLog({ ...base, status: 'SENT' });

    expect(id).toBe('log-1');
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0]).toMatchObject({
      where: { id: 'log-1' },
      data: { status: 'SENT' },
    });
  });

  it('TIDAK menurunkan status SENT yang sudah ada menjadi FAILED', async () => {
    vi.spyOn(prisma.adminNotificationLog, 'findUnique').mockResolvedValue({ id: 'log-1', status: 'SENT' } as any);
    vi.spyOn(prisma.adminNotificationLog, 'create').mockRejectedValue(
      Object.assign(new Error('duplicate'), { code: 'P2002' })
    );
    const updateSpy = vi.spyOn(prisma.adminNotificationLog, 'update').mockResolvedValue({} as any);

    await svc.writeLog({ ...base, status: 'FAILED' });

    expect(updateSpy).not.toHaveBeenCalled();
  });
});
