import { z } from 'zod';
import { prisma } from '../db/client';
import { getWibNow, startOfTodayWib, formatWibDateYYYYMMDD, formatWibTime } from '../utils/wib-time';
import { adFunnelMetricsService, FunnelMetrics } from './ad-funnel-metrics.service';
import { AlertService, AlertType, AlertSeverity } from './alert.service';

// ── 1. Skema Konfigurasi Tenant ──────────────────────────────────────────────
export const AdWatchdogSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  activeStartHourWib: z.number().int().min(0).max(23).default(8),
  activeEndHourWib: z.number().int().min(0).max(23).default(21),
  minViews: z.number().int().positive().default(30),
  minCtr: z.number().min(0).max(1).default(0.04),
  minAgedClicks: z.number().int().positive().default(3),
  graceMinutes: z.number().int().positive().default(20),
  cooldownMinutes: z.number().int().positive().default(180),
  baselineDays: z.number().int().positive().default(7),
  lowTrafficRatio: z.number().min(0).max(1).default(0.5),
  paidMediums: z.array(z.string()).default(['cpc', 'paid', 'ctwa', 'ctwa_fuzzy']),
  telegramTopicId: z.number().int().nullable().default(null),
});

export type AdWatchdogSettings = z.infer<typeof AdWatchdogSettingsSchema>;

export const DEFAULT_AD_WATCHDOG_SETTINGS: AdWatchdogSettings = {
  enabled: false,
  activeStartHourWib: 8,
  activeEndHourWib: 21,
  minViews: 30,
  minCtr: 0.04,
  minAgedClicks: 3,
  graceMinutes: 20,
  cooldownMinutes: 180,
  baselineDays: 7,
  lowTrafficRatio: 0.5,
  paidMediums: ['cpc', 'paid', 'ctwa', 'ctwa_fuzzy'],
  telegramTopicId: null,
};

// In-memory cache untuk settings tenant (TTL 5 menit)
const settingsCache = new Map<string, { at: number; settings: AdWatchdogSettings }>();
const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateSettingsCache(tenantId?: string): void {
  if (tenantId) settingsCache.delete(tenantId);
  else settingsCache.clear();
}

export async function loadAdWatchdogSettings(tenantId: string): Promise<AdWatchdogSettings> {
  const cached = settingsCache.get(tenantId);
  if (cached && Date.now() - cached.at < SETTINGS_CACHE_TTL_MS) {
    return cached.settings;
  }

  try {
    const tenantModel = (prisma as any).tenant;
    if (!tenantModel || typeof tenantModel.findUnique !== 'function') {
      return DEFAULT_AD_WATCHDOG_SETTINGS;
    }

    const findRes = tenantModel.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const tenant = (findRes && typeof findRes.catch === 'function')
      ? await findRes.catch(() => null)
      : (findRes ? await findRes : null);

    const rawSettings = (tenant?.settings as Record<string, any>)?.adWatchdog;
    if (!rawSettings || typeof rawSettings !== 'object') {
      settingsCache.set(tenantId, { at: Date.now(), settings: DEFAULT_AD_WATCHDOG_SETTINGS });
      return DEFAULT_AD_WATCHDOG_SETTINGS;
    }

    const parseResult = AdWatchdogSettingsSchema.safeParse(rawSettings);
    if (!parseResult.success) {
      console.warn(`[AdWatchdog] Invalid settings for tenant ${tenantId}, fallback to default:`, parseResult.error.issues);
      return DEFAULT_AD_WATCHDOG_SETTINGS;
    }

    settingsCache.set(tenantId, { at: Date.now(), settings: parseResult.data });
    return parseResult.data;
  } catch (err: any) {
    console.warn(`[AdWatchdog] Failed to load settings for tenant ${tenantId}:`, err?.message || err);
    return DEFAULT_AD_WATCHDOG_SETTINGS;
  }
}

// ── 2. Definisi Sinyal & Evaluasi Murni ───────────────────────────────────────
export type AnomalySignal =
  | 'INSTRUMENTATION_SUSPECT'
  | 'TOTAL_SILENCE'
  | 'LOW_TRAFFIC'
  | 'LOW_CTR'
  | 'OK';

export interface WatchdogEvaluationResult {
  status: 'ALERT' | 'OK';
  primarySignal: AnomalySignal;
  allSignals: AnomalySignal[];
  metrics: FunnelMetrics;
  baselineViews: number;
  hypotheses: string[];
  formattedMessage: string;
}

export function gateOperationalHours(now: Date, cfg: AdWatchdogSettings): boolean {
  const wib = getWibNow(now);
  const hour = wib.getUTCHours();
  return hour >= cfg.activeStartHourWib && hour < cfg.activeEndHourWib;
}

export function listSignals(
  metrics: FunnelMetrics,
  baselineViews: number,
  cfg: AdWatchdogSettings
): AnomalySignal[] {
  const signals: AnomalySignal[] = [];

  // 1. INSTRUMENTATION_SUSPECT: Chat masuk ada, atribusi nol
  if (
    metrics.paidAgedClicks >= cfg.minAgedClicks &&
    metrics.inboundChats >= cfg.minAgedClicks &&
    metrics.paidMatchedLeads === 0
  ) {
    signals.push('INSTRUMENTATION_SUSPECT');
  }

  // 2. TOTAL_SILENCE: Tidak ada chat sama sekali
  if (
    metrics.paidAgedClicks >= cfg.minAgedClicks &&
    metrics.inboundChats === 0
  ) {
    signals.push('TOTAL_SILENCE');
  }

  // 3. LOW_TRAFFIC: Kunjungan turun drastis dibanding baseline jam-sama 7 hari
  if (
    baselineViews >= cfg.minViews &&
    metrics.paidViews <= cfg.lowTrafficRatio * baselineViews &&
    baselineViews - metrics.paidViews >= 10
  ) {
    signals.push('LOW_TRAFFIC');
  }

  // 4. LOW_CTR: Trafik ada, klik tombol CTA sangat rendah (< minCtr)
  if (
    metrics.paidViews >= cfg.minViews &&
    metrics.ctr < cfg.minCtr &&
    metrics.paidViews - metrics.uniquePaidClicks >= 5
  ) {
    signals.push('LOW_CTR');
  }

  return signals;
}

export function diagnose(signal: AnomalySignal): string[] {
  switch (signal) {
    case 'INSTRUMENTATION_SUSPECT':
      return [
        'Ada chat masuk dari pelanggan, namun tidak ada yang terhubung dengan kode pelacakan.',
        'Kemungkinan skrip external-tracker.js di landing page tidak menyertakan tracking code.',
        'Atau pelanggan menghapus tag [kode] di kolom chat WhatsApp.',
        'REKOMENDASI: JANGAN matikan iklan. Periksa integrasi tracker di landing page lebih dulu.',
      ];
    case 'TOTAL_SILENCE':
      return [
        'Pengunjung mengklik tombol WhatsApp, tetapi 0 pesan yang masuk ke WhatsApp klinik.',
        'Kemungkinan nomor tujuan WhatsApp di tombol landing page salah/berganti.',
        'Atau pengunjung membatalkan niat chat saat aplikasi WhatsApp terbuka.',
        'REKOMENDASI: Uji coba klik tombol WA di landing page dari ponsel Anda sekarang.',
      ];
    case 'LOW_TRAFFIC':
      return [
        'Kunjungan landing page dari iklan turun drastis dibanding baseline jam yang sama 7 hari terakhir.',
        'Kemungkinan delivery iklan Meta sedang melambat, saldo habis, atau status iklan ditolak/learning.',
        'REKOMENDASI: Cek status kampanye dan saldo di Meta Ads Manager.',
      ];
    case 'LOW_CTR':
      return [
        'Trafik landing page masuk, tetapi rasio pengunjung yang mengklik tombol WhatsApp sangat rendah.',
        'Kemungkinan tombol WhatsApp tidak terlihat jelas di layar ponsel (*below the fold*).',
        'Atau Meta mengalokasikan anggaran ke penempatan murah dengan banyak klik tidak sengaja (*accidental clicks*).',
        'REKOMENDASI: Periksa penempatan iklan (*Placement*) di Meta Ads dan tata letak tombol di landing page.',
      ];
    default:
      return ['Corong iklan beroperasi dalam batas normal.'];
  }
}

export function formatMessage(
  result: { primarySignal: AnomalySignal; metrics: FunnelMetrics; baselineViews: number; hypotheses: string[] },
  tenantName: string,
  now: Date
): string {
  const timeStr = formatWibTime(now);
  const dateStr = formatWibDateYYYYMMDD(now);
  const m = result.metrics;
  const ctrPct = (m.ctr * 100).toFixed(1);

  const titleMap: Record<AnomalySignal, string> = {
    INSTRUMENTATION_SUSPECT: '⚠️ [WATCHDOG IKLAN] Dugaan Masalah Pelacakan / Atribusi',
    TOTAL_SILENCE: '🚨 [WATCHDOG IKLAN] Kebocoran Total: Klik Ada tapi Chat Nol',
    LOW_TRAFFIC: '📉 [WATCHDOG IKLAN] Penurunan Trafik Iklan Abnormal',
    LOW_CTR: '⚠️ [WATCHDOG IKLAN] Rasio Klik Tombol WA Sangat Rendah',
    OK: '✅ [WATCHDOG IKLAN] Normal',
  };

  const title = titleMap[result.primarySignal] || '⚠️ [WATCHDOG IKLAN] Peringatan Corong';

  const lines = [
    title,
    `Klinik: *${tenantName}* (${dateStr} pukul ${timeStr} WIB)`,
    '',
    '📊 *Metrik Hari Berjalan (sejak 08:00 WIB):*',
    `• Kunjungan Iklan (*Paid Views*): ${m.paidViews}${result.baselineViews > 0 ? ` (Baseline: ${result.baselineViews})` : ''}`,
    `• Klik Tombol WA (*Unique Clicks*): ${m.uniquePaidClicks} (CTR: ${ctrPct}%)`,
    `• Klik Terkonfirmasi Matched: ${m.paidMatchedLeads} lead`,
    `• Klik Tertunda Tanpa Chat (>20m): ${m.paidAgedClicks}`,
    `• Chat Masuk Nyata (*Inbound Customers*): ${m.inboundChats}`,
    '',
    '🔍 *Diagnosa & Rekomendasi:*',
    ...result.hypotheses.map((h) => `• ${h}`),
  ];

  return lines.slice(0, 15).join('\n');
}

export function evaluate(
  metrics: FunnelMetrics,
  baselineViews: number,
  cfg: AdWatchdogSettings,
  now: Date
): WatchdogEvaluationResult {
  const allSignals = listSignals(metrics, baselineViews, cfg);

  // Presedensi ketat: hanya 1 sinyal prioritas tertinggi
  let primarySignal: AnomalySignal = 'OK';
  if (allSignals.includes('INSTRUMENTATION_SUSPECT')) {
    primarySignal = 'INSTRUMENTATION_SUSPECT';
  } else if (allSignals.includes('TOTAL_SILENCE')) {
    primarySignal = 'TOTAL_SILENCE';
  } else if (allSignals.includes('LOW_TRAFFIC')) {
    primarySignal = 'LOW_TRAFFIC';
  } else if (allSignals.includes('LOW_CTR')) {
    primarySignal = 'LOW_CTR';
  }

  const hypotheses = diagnose(primarySignal);
  const formattedMessage = primarySignal !== 'OK'
    ? formatMessage({ primarySignal, metrics, baselineViews, hypotheses }, 'Kala Baby Spa', now)
    : '';

  return {
    status: primarySignal !== 'OK' ? 'ALERT' : 'OK',
    primarySignal,
    allSignals,
    metrics,
    baselineViews,
    hypotheses,
    formattedMessage,
  };
}

// ── 3. Orkestrator Runner & Cooldown ─────────────────────────────────────────
export interface CheckAndNotifyResult {
  sent: boolean;
  signal?: AnomalySignal;
  reason?: string;
}

export async function checkAndNotify(
  tenantId: string,
  now: Date = new Date(),
  injectedMetrics?: FunnelMetrics,
  injectedBaseline?: number
): Promise<CheckAndNotifyResult> {
  const cfg = await loadAdWatchdogSettings(tenantId);
  if (!cfg.enabled) {
    return { sent: false, reason: 'DISABLED' };
  }

  if (!gateOperationalHours(now, cfg)) {
    return { sent: false, reason: 'OUTSIDE_HOURS' };
  }

  // Hitung metrik hari ini sejak awal hari WIB
  const windowStart = startOfTodayWib(now);
  const metrics = injectedMetrics || (await adFunnelMetricsService.computeFunnelMetrics(
    tenantId,
    { start: windowStart, end: now },
    {
      now,
      graceMinutes: cfg.graceMinutes,
      paidMediums: cfg.paidMediums,
    }
  ));

  if (!metrics) {
    return { sent: false, reason: 'METRICS_UNAVAILABLE' };
  }

  const baselineViews = injectedBaseline !== undefined
    ? injectedBaseline
    : await adFunnelMetricsService.computeBaselineWindow(
        tenantId,
        cfg.activeStartHourWib,
        now,
        cfg.baselineDays
      );

  const evalResult = evaluate(metrics, baselineViews, cfg, now);
  if (evalResult.status === 'OK') {
    return { sent: false, signal: 'OK', reason: 'STATUS_OK' };
  }

  // Cek Cooldown & Idempotency via AdminNotificationLog
  const notifModel = (prisma as any).adminNotificationLog;
  const cooldownCutoff = new Date(now.getTime() - cfg.cooldownMinutes * 60 * 1000);

  if (notifModel && typeof notifModel.findFirst === 'function') {
    try {
      const recentAlert = await notifModel.findFirst({
        where: {
          tenant_id: tenantId,
          notification_type: 'AD_FUNNEL_ANOMALY',
          sent_at: { gte: cooldownCutoff },
        },
      });

      if (recentAlert) {
        return { sent: false, signal: evalResult.primarySignal, reason: 'COOLDOWN_ACTIVE' };
      }
    } catch {
      // Fail-open: jika cek log gagal, lanjutkan delivery alert
    }
  }

  // Ambil nama tenant untuk format pesan
  let tenantName = 'Kala Baby Spa';
  try {
    const tPromise = (prisma as any).tenant?.findUnique?.({
      where: { id: tenantId },
      select: { name: true },
    });
    const t = (tPromise && typeof tPromise.catch === 'function')
      ? await tPromise.catch(() => null)
      : (tPromise ? await tPromise : null);
    if (t?.name) tenantName = t.name;
  } catch {}

  const finalMessage = formatMessage(
    {
      primarySignal: evalResult.primarySignal,
      metrics: evalResult.metrics,
      baselineViews: evalResult.baselineViews,
      hypotheses: evalResult.hypotheses,
    },
    tenantName,
    now
  );

  const wibDateStr = formatWibDateYYYYMMDD(now);
  const currentHourStr = String(getWibNow(now).getUTCHours()).padStart(2, '0');
  const idempotencyKey = `${tenantId}:AD_FUNNEL_ANOMALY:${evalResult.primarySignal}:${wibDateStr}:${currentHourStr}`;

  // Catat ke AdminNotificationLog (dengan proteksi unique constraint P2002)
  if (notifModel && typeof notifModel.create === 'function') {
    try {
      await notifModel.create({
        data: {
          tenant_id: tenantId,
          channel: 'TELEGRAM',
          recipient: 'telegram_alert',
          notification_type: 'AD_FUNNEL_ANOMALY',
          report_date: wibDateStr,
          idempotency_key: idempotencyKey,
          title: `[WATCHDOG] ${evalResult.primarySignal}`,
          message_content: finalMessage,
          status: 'SENT',
          metadata: {
            metrics: evalResult.metrics,
            primarySignal: evalResult.primarySignal,
            allSignals: evalResult.allSignals,
            baselineViews: evalResult.baselineViews,
          },
        },
      });
    } catch (createErr: any) {
      if (createErr?.code === 'P2002') {
        // Idempotency collision: alert untuk jam/sinyal ini sudah pernah dicatat
        return { sent: false, signal: evalResult.primarySignal, reason: 'IDEMPOTENCY_CLAIMED' };
      }
    }
  }

  // Kirim via AlertService
  try {
    const alertService = new AlertService();
    const severity = evalResult.primarySignal === 'TOTAL_SILENCE' ? AlertSeverity.CRITICAL : AlertSeverity.WARNING;

    await alertService.notifyAlert({
      type: AlertType.AD_FUNNEL_ANOMALY,
      severity,
      message: finalMessage,
      tenantId,
      rawMessage: true,
      messageThreadId: cfg.telegramTopicId || undefined,
      metadata: {
        metrics: evalResult.metrics,
        primarySignal: evalResult.primarySignal,
        allSignals: evalResult.allSignals,
      },
    });

    return { sent: true, signal: evalResult.primarySignal };
  } catch (alertErr: any) {
    console.error('[AdWatchdog] Failed to dispatch alert:', alertErr?.message || alertErr);
    return { sent: false, signal: evalResult.primarySignal, reason: 'DELIVERY_FAILED' };
  }
}

export const adWatchdogService = {
  loadAdWatchdogSettings,
  invalidateSettingsCache,
  gateOperationalHours,
  listSignals,
  diagnose,
  formatMessage,
  evaluate,
  checkAndNotify,
};
