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

    // Buat session baru di WAHA jika session belum pernah dibuat / baru saja di-disconnect
    try {
      const existing = await wahaClient.getSession(sessionId);
      if (!existing) {
        const config = this.buildDefaultSessionConfig();
        await wahaClient.createSession(sessionId, config);
      }
    } catch (err) {
      // ignore
    }

    const startResult = await wahaClient.startSession(sessionId);
    let status: string;
    try {
      status = await wahaClient.getSessionStatus(sessionId);
    } catch (err: any) {
      status = 'DISCONNECTED';
    }

    if (startResult === 'FAILED' && status !== 'SCAN_QR_CODE' && status !== 'WORKING') {
      return {
        provider: 'WAHA',
        sessionId,
        status,
        qr: null,
        qrExpiresInMs: null,
        message: 'Gagal memulai session WAHA. Periksa log WAHA atau klik Reset & Scan Ulang.',
      };
    }

    return this.getQrForTenant(tenantId);
  }

  /**
   * Membangun config default untuk session WAHA yang baru dibuat.
   * Webhook URL diambil dari env (per-tenant via env injection / infra), bukan di-hardcode.
   * Tidak dipakai bila session lama masih punya config (webhook dipertahankan).
   */
  private buildDefaultSessionConfig(): any {
    const defaultUrl = process.env.NODE_ENV === 'production' ? 'http://app:3000/webhook' : 'http://host.docker.internal:3000/webhook';
    const webhookUrl = process.env.WAHA_WEBHOOK_URL || defaultUrl;
    const secret = process.env.WAHA_WEBHOOK_SECRET || '';
    const webhook: any = {
      url: webhookUrl,
      events: ['session.status', 'message', 'label.chat.added', 'label.chat.deleted'],
      retries: {
        policy: 'constant',
        delaySeconds: 2,
        attempts: 15,
      },
    };
    // WAHA_WEBHOOK_SECRET (NODE_ENV=production wajib) → WAHA kirim header ini supaya
    // webhook.route.ts tidak menolak (401) request inbound. WAHA pakai schema
    // `customHeaders: [{ name, value }]` — field `headers` (object) tidak didukung.
    if (secret) {
      webhook.customHeaders = [{ name: 'X-Webhook-Secret', value: secret }];
    }
    return {
      noweb: {
        store: {
          enabled: true,
          fullSync: true,
        },
      },
      webhooks: [webhook],
    };
  }

  /**
   * Reset / re-pair session WAHA per-tenant (delete → create ulang → start).
   * Dipakai tombol "Reset Session" di UI saat status FAILED yang sudah-paired
   * tidak bisa di-recover hanya dengan start (Noise Handshake failure baileys).
   * Config webhook session lama dipertahankan agar bot tidak kehilangan webhook.
   */
  public async resetSessionForTenant(tenantId: string = DEFAULT_TENANT_ID): Promise<ProviderQrData> {
    const sessionId = await this.resolveSessionId(tenantId);

    // Pertahankan config session lama (termasuk webhooks) sebelum dihapus.
    let existingConfig: any;
    try {
      const current = await wahaClient.getSession(sessionId);
      existingConfig = current?.config;
    } catch (err: any) {
      existingConfig = undefined;
    }
    const newConfig = existingConfig && typeof existingConfig === 'object' ? existingConfig : this.buildDefaultSessionConfig();

    // 1. Hapus session lama (bersihkan kredensial yang korup).
    const deleted = await wahaClient.deleteSession(sessionId);

    // 2. Buat ulang session dengan config webhook yang dipertahankan.
    const created = await wahaClient.createSession(sessionId, newConfig);
    if (created === 'FAILED') {
      return {
        provider: 'WAHA',
        sessionId,
        status: 'FAILED',
        qr: null,
        qrExpiresInMs: null,
        message: 'Gagal membuat ulang session WAHA. Periksa log WAHA dan coba lagi.',
      };
    }

    // 3. Mulai session → memunculkan QR baru untuk scan ulang.
    return this.startSessionForTenant(tenantId);
  }

  /**
   * Menghentikan/Disconnect session WAHA per-tenant (POST .../session/disconnect).
   */
  public async disconnectSessionForTenant(tenantId: string = DEFAULT_TENANT_ID): Promise<ProviderQrData> {
    const sessionId = await this.resolveSessionId(tenantId);
    await wahaClient.stopSession(sessionId);
    await wahaClient.deleteSession(sessionId);

    let status: string;
    try {
      status = await wahaClient.getSessionStatus(sessionId);
    } catch (err: any) {
      status = 'STOPPED';
    }

    return {
      provider: 'WAHA',
      sessionId,
      status,
      qr: null,
      qrExpiresInMs: null,
      message: 'Session WAHA telah terputus (Disconnected). Klik Mulai Session / Scan QR untuk menghubungkan kembali.',
    };
  }
}

export const whatsappProviderService = new WhatsappProviderService();
