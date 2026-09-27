import { prisma } from '../db/client';
import { normalizePhoneToE164 } from './capi.service';

export type NotificationChannel = 'WHATSAPP' | 'TELEGRAM' | 'SYSTEM';

export type NotificationType =
  | 'NIGHTLY_WATCHDOG'
  | 'DAILY_BRIEFING'
  | 'ALERT_URGENT'
  | 'TEST_SIMULATION';

export interface SendNotificationParams {
  tenantId: string;
  channel: NotificationChannel;
  /** Nomor WA (format bebas, dinormalisasi ke E.164) atau chat_id Telegram. */
  recipient: string;
  type: NotificationType;
  title: string;
  messageContent: string;
  /** Tanggal WIB "YYYY-MM-DD" untuk tampilan/filter log. Default: hari ini WIB. */
  reportDate?: string;
  /**
   * Kunci idempotensi cron anti-spam (mis. `${tenant}:${type}:${date}`).
   * Bila diisi dan sudah ada log SENT untuk key ini, pengiriman di-skip.
   * Bila kosong (test/resend), selalu dikirim.
   */
  idempotencyKey?: string;
  metadata?: Record<string, any>;
}

export interface SendNotificationResult {
  success: boolean;
  logId: string | null;
  status: 'SENT' | 'FAILED' | 'SKIPPED' | 'ALREADY_SENT';
  channel: NotificationChannel;
  error?: string;
}

// In-memory fallback saat DB offline (pola repo: degradasi senyap, tidak melempar).
const memoryNotificationLogs: any[] = [];

/** Tanggal WIB "YYYY-MM-DD" dari sebuah Date (default: sekarang). */
export function formatReportDateWib(date: Date = new Date()): string {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const d = String(wib.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * NotificationDeliveryService — pipa pengiriman notifikasi admin tenant-aware.
 *
 * Kontrak fondasional (Fase 1r):
 * - Nomor WA dinormalisasi E.164 via `normalizePhoneToE164` (reuse, tanpa regex baru).
 * - Pengiriman WA HANYA via gateway tenant (`resolveGatewayForTenant`), tidak langsung WAHA.
 * - WABA proaktif di luar 24h window diblokir Meta → SKIPPED (fallback Telegram/in-app),
 *   BUKAN dianggap gagal (tidak silent-drop, tetap tercatat di log).
 * - Idempotensi cron via `idempotencyKey` (unique nullable) → cegah dobel saat restart.
 * - Selalu menulis log SENT/FAILED/SKIPPED; tidak pernah melempar ke pemanggil (cron-safe).
 */
export class NotificationDeliveryService {
  public async send(params: SendNotificationParams): Promise<SendNotificationResult> {
    const {
      tenantId,
      channel,
      type,
      title,
      messageContent,
      metadata,
      idempotencyKey,
    } = params;

    const reportDate = params.reportDate || formatReportDateWib();
    const recipient = this.normalizeRecipient(channel, params.recipient);

    // 1. Idempotensi: sudah pernah SENT untuk key ini → skip (anti-spam cron).
    if (idempotencyKey) {
      const existing = await this.findExistingByIdempotencyKey(idempotencyKey);
      if (existing && existing.status === 'SENT') {
        return {
          success: true,
          logId: existing.id,
          status: 'ALREADY_SENT',
          channel,
        };
      }
    }

    // 2. Kirim sesuai kanal.
    let status: SendNotificationResult['status'] = 'SENT';
    let errorMessage: string | undefined;

    try {
      if (channel === 'WHATSAPP') {
        const outcome = await this.sendWhatsApp(tenantId, recipient, messageContent);
        status = outcome.status;
        errorMessage = outcome.error;
      } else if (channel === 'TELEGRAM') {
        const outcome = await this.sendTelegram(tenantId, recipient, messageContent);
        status = outcome.status;
        errorMessage = outcome.error;
      } else {
        // SYSTEM: hanya dicatat (in-app / audit), tanpa pengiriman eksternal.
        status = 'SENT';
      }
    } catch (err: any) {
      status = 'FAILED';
      errorMessage = err?.message || String(err);
    }

    // 3. Tulis log (best-effort; DB offline → memory fallback, tidak melempar).
    const logId = await this.writeLog({
      tenantId,
      channel,
      recipient,
      type,
      reportDate,
      idempotencyKey,
      title,
      messageContent,
      status,
      errorMessage,
      metadata,
    });

    return {
      success: status === 'SENT',
      logId,
      status,
      channel,
      error: errorMessage,
    };
  }

  /** Normalisasi penerima: WA → E.164; kanal lain dibiarkan apa adanya. */
  private normalizeRecipient(channel: NotificationChannel, recipient: string): string {
    if (channel === 'WHATSAPP') {
      return normalizePhoneToE164(recipient);
    }
    return (recipient || '').trim();
  }

  private async sendWhatsApp(
    tenantId: string,
    recipientE164: string,
    text: string
  ): Promise<{ status: 'SENT' | 'FAILED' | 'SKIPPED'; error?: string }> {
    if (!recipientE164) {
      return { status: 'FAILED', error: 'Nomor WhatsApp tujuan kosong/tidak valid.' };
    }

    const { resolveGatewayForTenant } = await import('../integrations/whatsapp/factory');
    const gateway = await resolveGatewayForTenant(tenantId);

    // WABA proaktif (di luar 24h window) butuh template HSM approved → jangan kirim
    // free-form (akan ditolak Meta). SKIPPED = bukan gagal; fallback Telegram/in-app.
    if (gateway.providerType === 'WABA') {
      return {
        status: 'SKIPPED',
        error: 'WABA tidak mendukung pesan proaktif free-form di luar 24h window. Gunakan Telegram atau template HSM.',
      };
    }

    const result = await gateway.sendTextMessage(recipientE164, text);
    if (result.success) return { status: 'SENT' };
    return {
      status: 'FAILED',
      error: result.error?.message || result.error?.code || 'Gagal mengirim pesan WhatsApp.',
    };
  }

  private async sendTelegram(
    tenantId: string,
    chatId: string,
    text: string
  ): Promise<{ status: 'SENT' | 'FAILED' | 'SKIPPED'; error?: string }> {
    if (!chatId) {
      return { status: 'FAILED', error: 'Chat ID Telegram kosong.' };
    }

    const { alertService, AlertType, AlertSeverity } = await import('./alert.service');
    const result = await alertService.notifyAlert({
      type: AlertType.DAILY_OPS_REPORT,
      severity: AlertSeverity.INFO,
      message: text,
      rawMessage: true,
      tenantId,
      chatId,
      metadata: { notificationType: 'NIGHTLY_WATCHDOG' },
    });

    if (result.channel === 'telegram' && result.sent) return { status: 'SENT' };
    return {
      status: 'FAILED',
      error: `Telegram dispatch gagal (dialihkan ke ${result.channel}).`,
    };
  }

  private async findExistingByIdempotencyKey(key: string): Promise<{ id: string; status: string } | null> {
    try {
      const row = await prisma.adminNotificationLog.findUnique({
        where: { idempotency_key: key },
        select: { id: true, status: true },
      });
      return row || null;
    } catch {
      const mem = memoryNotificationLogs.find((l) => l.idempotency_key === key);
      return mem ? { id: mem.id, status: mem.status } : null;
    }
  }

  private async writeLog(data: {
    tenantId: string;
    channel: NotificationChannel;
    recipient: string;
    type: NotificationType;
    reportDate: string;
    idempotencyKey?: string;
    title: string;
    messageContent: string;
    status: string;
    errorMessage?: string;
    metadata?: Record<string, any>;
  }): Promise<string | null> {
    const payload = {
      tenant_id: data.tenantId,
      channel: data.channel,
      recipient: data.recipient,
      notification_type: data.type,
      report_date: data.reportDate,
      idempotency_key: data.idempotencyKey || null,
      title: data.title,
      message_content: data.messageContent,
      status: data.status,
      error_message: data.errorMessage || null,
      metadata: data.metadata || undefined,
    };

    try {
      const created = await prisma.adminNotificationLog.create({ data: payload });
      return created?.id || null;
    } catch (err: any) {
      // P2002 = idempotency_key duplikat → balapan cron; perlakukan sebagai sudah tercatat.
      if (err?.code === 'P2002') {
        const existing = data.idempotencyKey
          ? await this.findExistingByIdempotencyKey(data.idempotencyKey)
          : null;
        return existing?.id || null;
      }
      // DB offline → memory fallback (pola repo), jangan gagalkan pemanggil.
      const memId = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      memoryNotificationLogs.push({ id: memId, sent_at: new Date(), ...payload });
      console.warn('[NotificationDelivery] DB offline — log disimpan di memori:', err?.message);
      return memId;
    }
  }

  /** Untuk test: akses store memori. */
  public getMemoryLogs(): any[] {
    return memoryNotificationLogs;
  }

  public clearMemoryLogs(): void {
    memoryNotificationLogs.length = 0;
  }
}

export const notificationDeliveryService = new NotificationDeliveryService();
