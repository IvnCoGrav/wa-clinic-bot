import { prisma } from '../db/client';
import { wahaClient } from '../integrations/waha/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';

export interface ProviderQrData {
  provider: 'WAHA';
  sessionId: string;
  status: string;
  qr: { mimetype: string; data: string } | null;
  qrExpiresInMs: number | null;
  message: string;
}

/**
 * Status WAHA selain SCAN_QR_CODE/WORKING yang berarti QR tidak tersedia.
 * UI tidak boleh berasumsi QR selalu ada — QR hanya muncul saat status === 'SCAN_QR_CODE'.
 */
export const WAHA_STATUS_WITHOUT_QR = ['FAILED', 'STOPPED', 'STOPPING', 'DISCONNECTED', 'UNKNOWN', 'STARTING', 'AUTHENTICATING'];

/**
 * Service tenant-aware untuk koneksi WhatsApp provider via QR.
 * Mengambil session id per-tenant (tenant.waha_session_id) dengan fallback env WAHA_SESSION
 * saat DB tidak tersedia (sesuai pola degrade service lain).
 */
export class WhatsappProviderService {
  private async resolveSessionId(tenantId: string): Promise<string> {
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (tenant?.waha_session_id) {
        return tenant.waha_session_id;
      }
    } catch (err: any) {
      console.warn(`[WhatsAppProvider] DB tidak tersedia, fallback ke WAHA_SESSION env: ${err.message}`);
    }
    return process.env.WAHA_SESSION || 'default';
  }

  private statusMessage(status: string): string {
    switch (status) {
      case 'FAILED':
        return 'Session WAHA gagal (FAILED). Periksa log WAHA dan restart session sebelum memindai QR.';
      case 'STOPPED':
        return 'Session WAHA belum berjalan (STOPPED). Mulai session terlebih dahulu untuk memunculkan QR.';
      case 'STOPPING':
        return 'Session WAHA sedang berhenti (STOPPING). Tunggu beberapa saat lalu coba lagi.';
      case 'STARTING':
        return 'Session WAHA sedang memulai (STARTING). QR akan muncul sebentar lagi.';
      case 'AUTHENTICATING':
        return 'Session WAHA sedang mengautentikasi (AUTHENTICATING).';
      case 'DISCONNECTED':
        return 'Server WAHA tidak dapat dijangkau (DISCONNECTED). Pastikan WAHA berjalan dan terhubung.';
      case 'WORKING':
        return 'Session WAHA aktif dan terhubung (WORKING).';
      default:
        return `Status session WAHA saat ini: ${status || 'UNKNOWN'}.`;
    }
  }

  /**
   * Mengambil status + QR (jika tersedia) untuk session tenant.
   * Read-only — tidak memulai session otomatis (idempotent untuk polling UI).
   * Skenario status non-QR (FAILED/STOPPED/DISCONNECTED/dll) → qr: null + pesan yang bisa di-render UI.
   */
  public async getQrForTenant(tenantId: string = DEFAULT_TENANT_ID): Promise<ProviderQrData> {
    const sessionId = await this.resolveSessionId(tenantId);

    let status: string;
    try {
      status = await wahaClient.getSessionStatus(sessionId);
    } catch (err: any) {
      status = 'DISCONNECTED';
    }

    if (status === 'SCAN_QR_CODE') {
      const qr = await wahaClient.getAuthQr(sessionId);
      if (!qr) {
        return {
          provider: 'WAHA',
          sessionId,
          status,
          qr: null,
          qrExpiresInMs: null,
          message: 'QR sedang tidak tersedia. Coba lagi dalam beberapa detik.',
        };
      }
      return {
        provider: 'WAHA',
        sessionId,
        status,
        qr,
        qrExpiresInMs: 20000,
        message: 'Pindai QR ini untuk menghubungkan session WhatsApp.',
      };
    }

    // WORKING dan semua status non-QR → qr: null (UI jangan menampilkan QR palsu)
    return {
      provider: 'WAHA',
      sessionId,
      status,
      qr: null,
      qrExpiresInMs: null,
      message: this.statusMessage(status),
    };
  }

  /**
   * Memulai session WAHA per-tenant secara eksplisit (POST .../session/start).
   * Dipakai tombol "Mulai session" di UI saat status STOPPED/STOPPING.
   */
  public async startSessionForTenant(tenantId: string = DEFAULT_TENANT_ID): Promise<ProviderQrData> {
    const sessionId = await this.resolveSessionId(tenantId);

    const startResult = await wahaClient.startSession(sessionId);
    let status: string;
    try {
      status = await wahaClient.getSessionStatus(sessionId);
    } catch (err: any) {
      status = 'DISCONNECTED';
    }

    if (startResult === 'FAILED') {
      return {
        provider: 'WAHA',
        sessionId,
        status,
        qr: null,
        qrExpiresInMs: null,
        message: 'Gagal memulai session WAHA. Periksa log WAHA dan coba lagi.',
      };
    }

    return this.getQrForTenant(tenantId);
  }
}

export const whatsappProviderService = new WhatsappProviderService();
