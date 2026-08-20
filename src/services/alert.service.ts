import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { sanitizeLogPayload } from '../utils/logger-sanitizer';

dotenv.config();

export enum AlertSeverity {
  CRITICAL = 'CRITICAL',
  WARNING = 'WARNING',
  INFO = 'INFO',
}

export enum AlertType {
  REDIS_OFFLINE = 'REDIS_OFFLINE',
  DATABASE_OFFLINE = 'DATABASE_OFFLINE',
  WAHA_DISCONNECTED = 'WAHA_DISCONNECTED',
  WAHA_SESSION_STUCK_STARTING = 'WAHA_SESSION_STUCK_STARTING',
  THIRD_PARTY_OUTAGE = 'THIRD_PARTY_OUTAGE',
  LLM_API_FAILURE = 'LLM_API_FAILURE',
  QUEUE_BACKLOG_HIGH = 'QUEUE_BACKLOG_HIGH',
  DISK_USAGE_HIGH = 'DISK_USAGE_HIGH',
  MEMORY_USAGE_HIGH = 'MEMORY_USAGE_HIGH',
  SECURITY_BREACH_ATTEMPT = 'SECURITY_BREACH_ATTEMPT',
  MEDICAL_EMERGENCY_HIGH = 'MEDICAL_EMERGENCY_HIGH',
  MEDICAL_CONCERN_MEDIUM = 'MEDICAL_CONCERN_MEDIUM',
  FOLLOWUP_FAILED = 'FOLLOWUP_FAILED',
  WABA_MESSAGE_FAILED = 'WABA_MESSAGE_FAILED',
  DAILY_OPS_REPORT = 'DAILY_OPS_REPORT',
  PENDING_PURCHASE_MODERATION = 'PENDING_PURCHASE_MODERATION',
  QUEUE_JOB_FAILED = 'QUEUE_JOB_FAILED',
  CS_ESCALATION = 'CS_ESCALATION',
}


export interface AlertPayload {
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  provider?: 'ORS' | 'Google Maps' | 'Meta CAPI' | string;
  metadata?: Record<string, any>;
  rawMessage?: boolean;
  tenantId?: string;
  botToken?: string;
  chatId?: string;
  messageThreadId?: number | string;
}

export class AlertService {
  private lastAlertTimes: Map<string, number> = new Map();
  private cooldownMs: number;
  private emergencyLogPath: string;

  constructor(cooldownMs = 5 * 60 * 1000) {
    this.cooldownMs = cooldownMs;
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      try {
        fs.mkdirSync(logsDir, { recursive: true });
      } catch (err) {
        // Ignore fallback dir error in test environments
      }
    }
    this.emergencyLogPath = path.join(logsDir, 'emergency_alerts.log');
  }

  /**
   * Generates a throttling key per trigger type & provider (if THIRD_PARTY_OUTAGE)
   */
  private getCooldownKey(payload: AlertPayload): string {
    if (payload.type === AlertType.THIRD_PARTY_OUTAGE && payload.provider) {
      return `${payload.type}:${payload.provider}`;
    }
    return payload.type;
  }

  /**
   * Triggers a system alert with per-trigger throttling and emergency fallback logging.
   */
  public async notifyAlert(payload: AlertPayload): Promise<{ sent: boolean; throttled?: boolean; channel: 'telegram' | 'emergency_file' | 'console' }> {
    const key = this.getCooldownKey(payload);
    const now = Date.now();
    const lastTime = this.lastAlertTimes.get(key) || 0;

    // 1. Throttling Check per Trigger Type
    if (payload.type !== AlertType.DAILY_OPS_REPORT && now - lastTime < this.cooldownMs && process.env.NODE_ENV !== 'test') {
      return { sent: false, throttled: true, channel: 'console' };
    }

    this.lastAlertTimes.set(key, now);

    const sanitizedMeta = payload.metadata ? sanitizeLogPayload(payload.metadata) : undefined;
    const formattedLog = `[${payload.severity} ALERT] [${payload.type}${payload.provider ? `:${payload.provider}` : ''}] ${payload.message}`;

    console.warn(`\n🚨 ${formattedLog}`, sanitizedMeta ? JSON.stringify(sanitizedMeta) : '');

    // 2. Try Dispatch via Telegram Bot API
    let botToken = payload.botToken || process.env.TELEGRAM_BOT_TOKEN;
    let chatId = payload.chatId || process.env.TELEGRAM_CHAT_ID;
    let messageThreadId = payload.messageThreadId ? Number(payload.messageThreadId) : undefined;

    // Check Tenant Database for per-tenant Telegram credentials & topic routing if tenantId provided
    if (payload.tenantId && (messageThreadId === undefined || isNaN(messageThreadId))) {
      try {
        const { prisma } = await import('../db/client');
        const tenant = await prisma.tenant.findUnique({ where: { id: payload.tenantId } });
        if (tenant) {
          if (!botToken && tenant.telegram_bot_token) botToken = tenant.telegram_bot_token;
          if (!chatId && tenant.telegram_chat_id) chatId = tenant.telegram_chat_id;

          if (payload.type === AlertType.DAILY_OPS_REPORT && tenant.telegram_topic_daily_report) {
            const parsed = parseInt(tenant.telegram_topic_daily_report, 10);
            if (!isNaN(parsed)) messageThreadId = parsed;
          } else if (
            (payload.type === AlertType.MEDICAL_EMERGENCY_HIGH ||
              payload.type === AlertType.MEDICAL_CONCERN_MEDIUM ||
              payload.type === AlertType.PENDING_PURCHASE_MODERATION) &&
            tenant.telegram_topic_medical_alerts
          ) {
            const parsed = parseInt(tenant.telegram_topic_medical_alerts, 10);
            if (!isNaN(parsed)) messageThreadId = parsed;
          } else if (tenant.telegram_topic_system_errors) {
            const parsed = parseInt(tenant.telegram_topic_system_errors, 10);
            if (!isNaN(parsed)) messageThreadId = parsed;
          }
        }
      } catch {
        // Fallback silently if DB is unreachable
      }
    }

    // Support combined Chat ID format: "-1001234567890:42" or "-1001234567890/42" or "-1001234567890#42"
    if (typeof chatId === 'string' && (chatId.includes(':') || chatId.includes('/') || chatId.includes('#'))) {
      const delimiter = chatId.includes(':') ? ':' : chatId.includes('/') ? '/' : '#';
      const [baseChatId, threadPart] = chatId.split(delimiter);
      if (baseChatId && threadPart) {
        chatId = baseChatId.trim();
        const parsedThread = parseInt(threadPart.trim(), 10);
        if (!isNaN(parsedThread)) {
          messageThreadId = parsedThread;
        }
      }
    }

    // Auto-resolve category-specific topic ID from environment variables if not explicitly provided
    if (messageThreadId === undefined || isNaN(messageThreadId)) {
      if (payload.type === AlertType.DAILY_OPS_REPORT) {
        const topicStr = process.env.TELEGRAM_TOPIC_DAILY_REPORT || process.env.TELEGRAM_TOPIC_REPORTS;
        if (topicStr && !isNaN(parseInt(topicStr, 10))) {
          messageThreadId = parseInt(topicStr, 10);
        }
      } else if (
        payload.type === AlertType.MEDICAL_EMERGENCY_HIGH ||
        payload.type === AlertType.MEDICAL_CONCERN_MEDIUM ||
        payload.type === AlertType.PENDING_PURCHASE_MODERATION
      ) {
        const topicStr = process.env.TELEGRAM_TOPIC_MEDICAL_ALERTS || process.env.TELEGRAM_TOPIC_EMERGENCY;
        if (topicStr && !isNaN(parseInt(topicStr, 10))) {
          messageThreadId = parseInt(topicStr, 10);
        }
      } else {
        // System outages, server errors, waha disconnect, etc.
        const topicStr = process.env.TELEGRAM_TOPIC_SYSTEM_ERRORS || process.env.TELEGRAM_TOPIC_ERRORS || process.env.TELEGRAM_TOPIC_ALERTS;
        if (topicStr && !isNaN(parseInt(topicStr, 10))) {
          messageThreadId = parseInt(topicStr, 10);
        }
      }
    }

    if (botToken && chatId) {
      try {
        let text = '';
        if (payload.rawMessage) {
          text = payload.message;
        } else {
          text = `🚨 *[${payload.severity}] ${payload.type}*\n${payload.message}\n${payload.provider ? `*Provider:* ${payload.provider}\n` : ''}\`\`\`json\n${JSON.stringify(sanitizedMeta || {}, null, 2)}\n\`\`\``;
        }

        const bodyPayload: any = { chat_id: chatId, text, parse_mode: 'Markdown' };
        if (messageThreadId !== undefined && !isNaN(messageThreadId)) {
          bodyPayload.message_thread_id = messageThreadId;
        }

        let response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyPayload),
        });

        // Fallback retry tanpa parse_mode jika terjadi entity parsing error (HTTP 400)
        if (!response.ok && response.status === 400 && bodyPayload.parse_mode) {
          delete bodyPayload.parse_mode;
          response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyPayload),
          });
        }

        if (response.ok) {
          return { sent: true, throttled: false, channel: 'telegram' };
        } else {
          const errBody = await response.text().catch(() => '');
          console.error(`[AlertService] Telegram API error (${response.status}): ${errBody}`);
        }
      } catch (err: any) {
        console.error(`[AlertService] Telegram dispatch failed: ${err.message}. Falling back to emergency file log.`);
      }
    }

    // 3. Fallback Channel: Emergency Append-Only Log File
    this.writeEmergencyFileLog(formattedLog, sanitizedMeta);
    return { sent: true, throttled: false, channel: 'emergency_file' };
  }

  private writeEmergencyFileLog(logText: string, metadata?: any): void {
    try {
      const entry = `[${new Date().toISOString()}] ${logText} ${metadata ? JSON.stringify(metadata) : ''}\n`;
      fs.appendFileSync(this.emergencyLogPath, entry, { encoding: 'utf8' });
    } catch (err) {
      console.error('[CRITICAL ALERT FALLBACK FILE WRITE FAILED]', err);
    }
  }

  /**
   * Resets cooldown map (used for unit testing)
   */
  public clearCooldowns(): void {
    this.lastAlertTimes.clear();
  }
}

export const alertService = new AlertService();
