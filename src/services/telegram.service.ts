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
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    let token = tenant?.telegram_pairing_token;
    if (!token) {
      token = `PAIR_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      try {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: { telegram_pairing_token: token },
        });
      } catch (err: any) {
        // If race condition on unique token, fallback to fetch again
        const fresh = await prisma.tenant.findUnique({ where: { id: tenantId } });
        token = fresh?.telegram_pairing_token || token;
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
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { telegram_pairing_token: newToken },
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
  }): Promise<{ ok: boolean; description?: string }> {
    const botToken = params.botToken || process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return { ok: false, description: 'Telegram Bot Token not configured' };
    }

    try {
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

      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const resJson: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error(`[TelegramService] Send error (${response.status}):`, resJson);
        return { ok: false, description: resJson?.description || response.statusText };
      }

      return { ok: true };
    } catch (err: any) {
      console.error(`[TelegramService] Dispatch exception: ${err.message}`);
      return { ok: false, description: err.message };
    }
  }
}

export const telegramService = new TelegramService();
