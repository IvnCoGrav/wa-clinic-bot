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
}


export interface AlertPayload {
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  provider?: 'ORS' | 'Google Maps' | 'Meta CAPI' | string;
  metadata?: Record<string, any>;
  rawMessage?: boolean;
  botToken?: string;
  chatId?: string;
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
  public async notifyAlert(payload: AlertPayload): Promise<{ sent: boolean; throttled: boolean; channel: 'telegram' | 'emergency_file' | 'console' }> {
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
    const botToken = payload.botToken || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = payload.chatId || process.env.TELEGRAM_CHAT_ID;

    if (botToken && chatId) {
      try {
        let text = '';
        if (payload.rawMessage) {
          text = payload.message;
        } else {
          text = `🚨 *[${payload.severity}] ${payload.type}*\n${payload.message}\n${payload.provider ? `*Provider:* ${payload.provider}\n` : ''}\`\`\`json\n${JSON.stringify(sanitizedMeta || {}, null, 2)}\n\`\`\``;
        }
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
        });

        if (response.ok) {
          return { sent: true, throttled: false, channel: 'telegram' };
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
