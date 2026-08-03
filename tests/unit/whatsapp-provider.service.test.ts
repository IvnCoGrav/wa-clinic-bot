import { describe, it, expect, beforeEach, vi } from 'vitest';
import { whatsappProviderService } from '../../src/services/whatsapp-provider.service';
import { wahaClient } from '../../src/integrations/waha/client';
import { prisma } from '../../src/db/client';

describe('WhatsappProviderService — getQrForTenant / startSessionForTenant', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.WAHA_SESSION;
  });

  it('SCAN_QR_CODE + QR tersedia → return qr + qrExpiresInMs', async () => {
    const statusSpy = vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValue('SCAN_QR_CODE');
    vi.spyOn(wahaClient, 'getAuthQr').mockResolvedValue({ mimetype: 'image/png', data: 'QUJD' });

    const result = await whatsappProviderService.getQrForTenant('default-tenant');

    expect(result.provider).toBe('WAHA');
    expect(result.status).toBe('SCAN_QR_CODE');
    expect(result.qr).toEqual({ mimetype: 'image/png', data: 'QUJD' });
    expect(result.qrExpiresInMs).toBe(20000);
    expect(result.message).toContain('Pindai QR');
    expect(statusSpy).toHaveBeenCalledWith('default');
  });

  it('SCAN_QR_CODE tapi QR tidak tersedia → qr null + pesan coba lagi', async () => {
    vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValue('SCAN_QR_CODE');
    vi.spyOn(wahaClient, 'getAuthQr').mockResolvedValue(null);

    const result = await whatsappProviderService.getQrForTenant();

    expect(result.qr).toBeNull();
    expect(result.message).toContain('tidak tersedia');
  });

  it('WORKING → qr null + pesan aktif', async () => {
    vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValue('WORKING');

    const result = await whatsappProviderService.getQrForTenant();

    expect(result.status).toBe('WORKING');
    expect(result.qr).toBeNull();
    expect(result.message).toContain('aktif');
  });

  // User reminder Stage 1: UI TIDAK boleh mengasumsikan QR selalu tersedia.
  // Setiap status selain SCAN_QR_CODE/WORKING harus menghasilkan qr: null + pesan yang bisa di-render.
  it.each(['FAILED', 'STOPPED', 'STOPPING', 'DISCONNECTED', 'UNKNOWN', 'STARTING', 'AUTHENTICATING'])(
    'status %s → qr null + pesan informatif (bukan asumsi QR)',
    async (status) => {
      vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValue(status);

      const result = await whatsappProviderService.getQrForTenant();

      expect(result.status).toBe(status);
      expect(result.qr).toBeNull();
      expect(result.qrExpiresInMs).toBeNull();
      expect(result.message.length).toBeGreaterThan(0);
    }
  );

  it('FAILED → pesan menyebut FAILED dan menyarankan restart', async () => {
    vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValue('FAILED');

    const result = await whatsappProviderService.getQrForTenant();

    expect(result.message).toContain('FAILED');
    expect(result.message).toContain('restart');
  });

  it('STOPPED → pesan menyebut STOPPED dan saran mulai session', async () => {
    vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValue('STOPPED');

    const result = await whatsappProviderService.getQrForTenant();

    expect(result.message).toContain('STOPPED');
  });

  it('session id diambil dari tenant.waha_session_id (tenant-aware)', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({ waha_session_id: 'tenant-b' } as any);
    const statusSpy = vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValue('SCAN_QR_CODE');
    vi.spyOn(wahaClient, 'getAuthQr').mockResolvedValue({ mimetype: 'image/png', data: 'QUJD' });

    const result = await whatsappProviderService.getQrForTenant('default-tenant');

    expect(result.sessionId).toBe('tenant-b');
    expect(statusSpy).toHaveBeenCalledWith('tenant-b');
  });

  it('DB offline → fallback ke env WAHA_SESSION', async () => {
    process.env.WAHA_SESSION = 'env-session';
    const statusSpy = vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValue('WORKING');

    const result = await whatsappProviderService.getQrForTenant();

    expect(result.sessionId).toBe('env-session');
    expect(statusSpy).toHaveBeenCalledWith('env-session');
  });

  it('DB offline tanpa env WAHA_SESSION → fallback "default"', async () => {
    vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValue('WORKING');

    const result = await whatsappProviderService.getQrForTenant();

    expect(result.sessionId).toBe('default');
  });

  it('getSessionStatus melempar error → status DISCONNECTED', async () => {
    vi.spyOn(wahaClient, 'getSessionStatus').mockRejectedValue(new Error('boom'));

    const result = await whatsappProviderService.getQrForTenant();

    expect(result.status).toBe('DISCONNECTED');
    expect(result.qr).toBeNull();
  });

  it('startSessionForTenant sukses → status WORKING', async () => {
    vi.spyOn(wahaClient, 'startSession').mockResolvedValue('STARTED');
    vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValue('WORKING');

    const result = await whatsappProviderService.startSessionForTenant();

    expect(result.status).toBe('WORKING');
    expect(result.qr).toBeNull();
  });

  it('startSessionForTenant gagal → message Gagal memulai', async () => {
    vi.spyOn(wahaClient, 'startSession').mockResolvedValue('FAILED');
    vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValue('STOPPED');

    const result = await whatsappProviderService.startSessionForTenant();

    expect(result.message).toContain('Gagal memulai');
  });
});
