import { prisma } from '../db/client';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

export interface TelegramLinks {
  pairingToken: string;
  botUsername: string;
  directLink: string;
  groupLink: string;
  isConfigured: boolean;
  chatId: string | null;
  topicDailyReport: string | null;
  topicSystemErrors: string | null;
  topicMedicalAlerts: string | null;
}

export class TelegramService {
  /**
   * Get or generate a persistent pairing token for a tenant
   */
  async getTenantPairingInfo(tenantId: string): Promise<TelegramLinks> {
    let tenant = await prisma.tenant
      .findUnique({
        where: { id: tenantId },
      })
      .catch(() => null);

    let token = tenant?.telegram_pairing_token;
    if (!token) {
      token = `PAIR_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      try {
        tenant = await prisma.tenant.upsert({
          where: { id: tenantId },
          create: {
            id: tenantId,
            slug: tenantId,
            name: `Tenant ${tenantId}`,
            telegram_pairing_token: token,
          },
          update: {
            telegram_pairing_token: token,
          },
        });
      } catch (err: any) {
        // If race condition on unique token or DB issue, fallback to fetch again
        const fresh = await prisma.tenant.findUnique({ where: { id: tenantId } }).catch(() => null);
        token = fresh?.telegram_pairing_token || token;
        tenant = fresh || tenant;
      }
    }

    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'KalaReport_bot';
    const cleanUsername = botUsername.replace(/^@/, '');

    const directLink = `https://t.me/${cleanUsername}?start=${token}`;
    const groupLink = `https://t.me/${cleanUsername}?startgroup=${token}`;

    return {
      pairingToken: token,
      botUsername: cleanUsername,
      directLink,
      groupLink,
      isConfigured: Boolean(tenant?.telegram_chat_id),
      chatId: tenant?.telegram_chat_id || null,
      topicDailyReport: tenant?.telegram_topic_daily_report || null,
      topicSystemErrors: tenant?.telegram_topic_system_errors || null,
      topicMedicalAlerts: tenant?.telegram_topic_medical_alerts || null,
    };
  }

  /**
   * Regenerate a new pairing token for a tenant (e.g. if previous token was compromised)
   */
  async regeneratePairingToken(tenantId: string): Promise<TelegramLinks> {
    const newToken = `PAIR_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    await prisma.tenant
      .upsert({
        where: { id: tenantId },
        create: {
          id: tenantId,
          slug: tenantId,
          name: `Tenant ${tenantId}`,
          telegram_pairing_token: newToken,
        },
        update: {
          telegram_pairing_token: newToken,
        },
      })
      .catch((err: any) => {
        console.warn(`[TelegramService] Failed to upsert regenerated token:`, err.message);
      });
    return this.getTenantPairingInfo(tenantId);
  }

  /**
   * Send a message to a Telegram chat/topic
   */
  async sendMessage(params: {
    botToken?: string;
    chatId: string | number;
    messageThreadId?: string | number;
    text: string;
    parseMode?: 'Markdown' | 'HTML';
    /** I-008: override untuk test (default dari env / 8 dtk). */
    __testOptions?: { timeoutMs?: number; maxRetries?: number; retryDelayMs?: number };
  }): Promise<{ ok: boolean; description?: string }> {
    const botToken = params.botToken || process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return { ok: false, description: 'Telegram Bot Token not configured' };
    }

    const timeoutMs =
      params.__testOptions?.timeoutMs ??
      Number.parseInt(process.env.TELEGRAM_TIMEOUT_MS || '8000', 10);
    const maxRetries = params.__testOptions?.maxRetries ?? 2;
    const retryDelayMs = params.__testOptions?.retryDelayMs ?? 500;

    const body: any = {
      chat_id: params.chatId,
      text: params.text,
      parse_mode: params.parseMode || 'Markdown',
    };

    if (params.messageThreadId) {
      const threadNum = Number(params.messageThreadId);
      if (!isNaN(threadNum)) {
        body.message_thread_id = threadNum;
      }
    }

    let lastDescription = 'Telegram send failed';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // I-008: timeout eksplisit — fetch tanpa batas bisa menggantung worker.
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });

        const resJson: any = await response.json().catch(() => ({}));
        if (response.ok) return { ok: true };

        lastDescription = resJson?.description || response.statusText || `HTTP ${response.status}`;

        // 429: hormati retry_after dari Telegram; 5xx: backoff eksponensial.
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt === maxRetries) {
          console.error(`[TelegramService] Send error (${response.status}):`, resJson);
          return { ok: false, description: lastDescription };
        }

        const retryAfterSec = Number(resJson?.parameters?.retry_after);
        const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? Math.min(retryAfterSec * 1000, 5000)
          : retryDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      } catch (err: any) {
        lastDescription = err?.message || String(err);
        // Timeout/abort juga layak retry terbatas.
        if (attempt === maxRetries) break;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * Math.pow(2, attempt)));
      }
    }

    console.error(`[TelegramService] Dispatch failed: ${lastDescription}`);
    return { ok: false, description: lastDescription };
  }
}

export const telegramService = new TelegramService();
