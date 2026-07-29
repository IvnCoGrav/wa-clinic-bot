import { describe, it, expect, beforeEach, vi } from 'vitest';
import { alertService, AlertType, AlertSeverity } from '../../src/services/alert.service';
import fs from 'fs';
import path from 'path';

describe('AlertService — 8 Triggers, Sub-Tags, Per-Trigger Throttling & Fallback Channel', () => {
  beforeEach(() => {
    alertService.clearCooldowns();
    vi.restoreAllMocks();
  });

  // --- 8 INDIVIDUAL TRIGGER TEST CASES ---
  it('1. Trigger REDIS_OFFLINE: should log critical alert when Redis connection fails', async () => {
    const res = await alertService.notifyAlert({
      type: AlertType.REDIS_OFFLINE,
      severity: AlertSeverity.CRITICAL,
      message: 'Redis connection lost',
    });
    expect(res.sent).toBe(true);
    expect(res.throttled).toBe(false);
  });

  it('2. Trigger DATABASE_OFFLINE: should log critical alert when Postgres is unreachable', async () => {
    const res = await alertService.notifyAlert({
      type: AlertType.DATABASE_OFFLINE,
      severity: AlertSeverity.CRITICAL,
      message: 'Postgres transaction failed',
    });
    expect(res.sent).toBe(true);
  });

  it('3. Trigger WAHA_DISCONNECTED: should log critical alert when WAHA session drops', async () => {
    const res = await alertService.notifyAlert({
      type: AlertType.WAHA_DISCONNECTED,
      severity: AlertSeverity.CRITICAL,
      message: 'WAHA session status changed to STOPPED',
    });
    expect(res.sent).toBe(true);
  });

  it('4. Trigger THIRD_PARTY_OUTAGE (ORS): should log warning with ORS provider tag', async () => {
    const res = await alertService.notifyAlert({
      type: AlertType.THIRD_PARTY_OUTAGE,
      severity: AlertSeverity.WARNING,
      provider: 'ORS',
      message: 'OpenRouteService API timeout 10s',
    });
    expect(res.sent).toBe(true);
  });

  it('5. Trigger THIRD_PARTY_OUTAGE (Google Maps): should log warning with Google Maps provider tag', async () => {
    const res = await alertService.notifyAlert({
      type: AlertType.THIRD_PARTY_OUTAGE,
      severity: AlertSeverity.WARNING,
      provider: 'Google Maps',
      message: 'Google Maps Geocoding rate-limit exceeded',
    });
    expect(res.sent).toBe(true);
  });

  it('6. Trigger THIRD_PARTY_OUTAGE (Meta CAPI): should log warning with Meta CAPI provider tag', async () => {
    const res = await alertService.notifyAlert({
      type: AlertType.THIRD_PARTY_OUTAGE,
      severity: AlertSeverity.WARNING,
      provider: 'Meta CAPI',
      message: 'Meta CAPI Graph API 500 error',
    });
    expect(res.sent).toBe(true);
  });

  it('7. Trigger LLM_API_FAILURE: should log warning for LLM timeout (separate from quota)', async () => {
    const res = await alertService.notifyAlert({
      type: AlertType.LLM_API_FAILURE,
      severity: AlertSeverity.WARNING,
      message: 'SumoPod LLM endpoint request timeout after 15s',
    });
    expect(res.sent).toBe(true);
  });

  it('8. Trigger QUEUE_BACKLOG_HIGH: should log warning when queue depth exceeds threshold', async () => {
    const res = await alertService.notifyAlert({
      type: AlertType.QUEUE_BACKLOG_HIGH,
      severity: AlertSeverity.WARNING,
      message: 'Queue depth currently at 65 pending messages',
    });
    expect(res.sent).toBe(true);
  });

  it('9. Trigger DISK_USAGE_HIGH: should log critical alert when disk usage exceeds 85%', async () => {
    const res = await alertService.notifyAlert({
      type: AlertType.DISK_USAGE_HIGH,
      severity: AlertSeverity.CRITICAL,
      message: 'Server disk usage at 91%',
    });
    expect(res.sent).toBe(true);
  });

  it('10. Trigger MEMORY_USAGE_HIGH: should log critical alert when RAM usage exceeds 85%', async () => {
    const res = await alertService.notifyAlert({
      type: AlertType.MEMORY_USAGE_HIGH,
      severity: AlertSeverity.CRITICAL,
      message: 'Server RAM usage at 89%',
    });
    expect(res.sent).toBe(true);
  });

  it('11. Trigger SECURITY_BREACH_ATTEMPT: should log critical alert on unauthorized access', async () => {
    const res = await alertService.notifyAlert({
      type: AlertType.SECURITY_BREACH_ATTEMPT,
      severity: AlertSeverity.CRITICAL,
      message: 'Webhook secret signature invalid',
    });
    expect(res.sent).toBe(true);
  });

  // --- THROTTLING & FALLBACK TESTS ---
  it('12. Throttling: should throttle per trigger-type independently in production mode', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const res1 = await alertService.notifyAlert({
      type: AlertType.REDIS_OFFLINE,
      severity: AlertSeverity.CRITICAL,
      message: 'Redis down first time',
    });
    expect(res1.sent).toBe(true);

    // Duplicate alert type within 5 min -> throttled
    const res1Repeat = await alertService.notifyAlert({
      type: AlertType.REDIS_OFFLINE,
      severity: AlertSeverity.CRITICAL,
      message: 'Redis down second time',
    });
    expect(res1Repeat.throttled).toBe(true);
    expect(res1Repeat.sent).toBe(false);

    // Different alert type -> NOT throttled (independent per-trigger cooldown)
    const res2Different = await alertService.notifyAlert({
      type: AlertType.DATABASE_OFFLINE,
      severity: AlertSeverity.CRITICAL,
      message: 'Postgres down',
    });
    expect(res2Different.sent).toBe(true);
    expect(res2Different.throttled).toBe(false);

    process.env.NODE_ENV = origEnv;
  });

  it('13. Fallback Channel: should fall back to emergency alert log file when Telegram is unconfigured/fails', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;

    const emergencyPath = path.join(process.cwd(), 'logs', 'emergency_alerts.log');
    if (fs.existsSync(emergencyPath)) {
      fs.unlinkSync(emergencyPath);
    }

    const res = await alertService.notifyAlert({
      type: AlertType.THIRD_PARTY_OUTAGE,
      severity: AlertSeverity.WARNING,
      message: 'CAPI API Connection Error',
      provider: 'Meta CAPI',
      metadata: { phone: '628123456789' }, // Will be sanitized in log
    });

    expect(res.channel).toBe('emergency_file');
    expect(fs.existsSync(emergencyPath)).toBe(true);

    const logContent = fs.readFileSync(emergencyPath, 'utf8');
    expect(logContent).toContain('THIRD_PARTY_OUTAGE:Meta CAPI');
    expect(logContent).toContain('628***'); // PII sanitized!
  });
});
