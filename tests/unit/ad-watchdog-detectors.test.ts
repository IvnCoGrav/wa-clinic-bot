import { describe, it, expect } from 'vitest';
import {
  gateOperationalHours,
  listSignals,
  diagnose,
  evaluate,
  formatMessage,
  DEFAULT_AD_WATCHDOG_SETTINGS,
  AdWatchdogSettings,
} from '../../src/services/ad-watchdog.service';
import { FunnelMetrics } from '../../src/services/ad-funnel-metrics.service';

describe('AdWatchdog Detectors, Precedence & Formatting', () => {
  const cfg: AdWatchdogSettings = {
    ...DEFAULT_AD_WATCHDOG_SETTINGS,
    enabled: true,
  };

  const createMetrics = (overrides: Partial<FunnelMetrics> = {}): FunnelMetrics => ({
    paidViews: 50,
    uniquePaidClicks: 8,
    paidAgedClicks: 5,
    paidMatchedLeads: 4,
    inboundChats: 6,
    ctr: 0.16,
    ...overrides,
  });

  describe('gateOperationalHours', () => {
    it('mengizinkan saat jam kerja (08:00 - 20:59 WIB)', () => {
      // 08:00 WIB = 01:00 UTC
      const date0800Wib = new Date('2026-11-06T01:00:00.000Z');
      expect(gateOperationalHours(date0800Wib, cfg)).toBe(true);

      // 14:30 WIB = 07:30 UTC
      const date1430Wib = new Date('2026-11-06T07:30:00.000Z');
      expect(gateOperationalHours(date1430Wib, cfg)).toBe(true);

      // 20:59 WIB = 13:59 UTC
      const date2059Wib = new Date('2026-11-06T13:59:00.000Z');
      expect(gateOperationalHours(date2059Wib, cfg)).toBe(true);
    });

    it('menolak saat di luar jam kerja (< 08:00 atau >= 21:00 WIB)', () => {
      // 07:59 WIB = 00:59 UTC
      const date0759Wib = new Date('2026-11-06T00:59:00.000Z');
      expect(gateOperationalHours(date0759Wib, cfg)).toBe(false);

      // 21:00 WIB = 14:00 UTC
      const date2100Wib = new Date('2026-11-06T14:00:00.000Z');
      expect(gateOperationalHours(date2100Wib, cfg)).toBe(false);

      // 02:00 WIB = 19:00 UTC (kemarin)
      const date0200Wib = new Date('2026-11-05T19:00:00.000Z');
      expect(gateOperationalHours(date0200Wib, cfg)).toBe(false);
    });
  });

  describe('Anomaly Signals', () => {
    it('mendeteksi INSTRUMENTATION_SUSPECT saat chat ada, klik ada, tapi matching nol', () => {
      const m = createMetrics({
        paidViews: 40,
        uniquePaidClicks: 5,
        paidAgedClicks: 4,
        paidMatchedLeads: 0, // Nol atribusi
        inboundChats: 5,     // Chat nyata ada
      });

      const signals = listSignals(m, 40, cfg);
      expect(signals).toContain('INSTRUMENTATION_SUSPECT');

      const result = evaluate(m, 40, cfg, new Date('2026-11-06T07:00:00Z'));
      expect(result.status).toBe('ALERT');
      expect(result.primarySignal).toBe('INSTRUMENTATION_SUSPECT');
      expect(result.hypotheses.some((h) => h.includes('JANGAN matikan iklan'))).toBe(true);
    });

    it('mendeteksi TOTAL_SILENCE saat klik ada tapi 0 pesan masuk', () => {
      const m = createMetrics({
        paidViews: 40,
        uniquePaidClicks: 6,
        paidAgedClicks: 5,   // >= minAgedClicks (3)
        paidMatchedLeads: 0,
        inboundChats: 0,     // Total silence
      });

      const signals = listSignals(m, 40, cfg);
      expect(signals).toContain('TOTAL_SILENCE');

      const result = evaluate(m, 40, cfg, new Date('2026-11-06T07:00:00Z'));
      expect(result.status).toBe('ALERT');
      expect(result.primarySignal).toBe('TOTAL_SILENCE');
      expect(result.hypotheses.some((h) => h.includes('0 pesan yang masuk'))).toBe(true);
    });

    it('mendeteksi LOW_TRAFFIC saat paidViews turun drastis di bawah 50% baseline jam-sama', () => {
      const baseline = 60; // 60 views biasanya tercapai di jam ini
      const m = createMetrics({
        paidViews: 20,       // <= 0.5 * 60 = 30 views
        uniquePaidClicks: 3,
        paidAgedClicks: 1,
        paidMatchedLeads: 1,
        inboundChats: 2,
        ctr: 0.15,
      });

      const signals = listSignals(m, baseline, cfg);
      expect(signals).toContain('LOW_TRAFFIC');

      const result = evaluate(m, baseline, cfg, new Date('2026-11-06T07:00:00Z'));
      expect(result.status).toBe('ALERT');
      expect(result.primarySignal).toBe('LOW_TRAFFIC');
      expect(result.hypotheses.some((h) => h.includes('turun drastis dibanding baseline'))).toBe(true);
    });

    it('mendeteksi LOW_CTR saat kunjungan cukup (>= 30) tapi CTR < 4%', () => {
      const m = createMetrics({
        paidViews: 50,
        uniquePaidClicks: 1, // CTR = 1/50 = 0.02 (< 0.04)
        ctr: 0.02,
        paidAgedClicks: 1,
        paidMatchedLeads: 1,
        inboundChats: 1,
      });

      const signals = listSignals(m, 40, cfg);
      expect(signals).toContain('LOW_CTR');

      const result = evaluate(m, 40, cfg, new Date('2026-11-06T07:00:00Z'));
      expect(result.status).toBe('ALERT');
      expect(result.primarySignal).toBe('LOW_CTR');
      expect(result.hypotheses.some((h) => h.includes('sangat rendah'))).toBe(true);
    });

    it('mengembalikan status OK bila semua metrik sehat', () => {
      const m = createMetrics({
        paidViews: 50,
        uniquePaidClicks: 8,
        paidAgedClicks: 5,
        paidMatchedLeads: 4,
        inboundChats: 5,
        ctr: 0.16,
      });

      const result = evaluate(m, 45, cfg, new Date('2026-11-06T07:00:00Z'));
      expect(result.status).toBe('OK');
      expect(result.primarySignal).toBe('OK');
      expect(result.formattedMessage).toBe('');
    });
  });

  describe('Precedence Hierarchy', () => {
    it('INSTRUMENTATION_SUSPECT mengalahkan sinyal lainnya', () => {
      // Kondisi yang memicu INSTRUMENTATION_SUSPECT sekaligus LOW_CTR
      const m = createMetrics({
        paidViews: 100,
        uniquePaidClicks: 3, // CTR 3% (< 4%)
        ctr: 0.03,
        paidAgedClicks: 3,
        paidMatchedLeads: 0, // matching 0
        inboundChats: 4,     // inbound chat >= 3
      });

      const signals = listSignals(m, 90, cfg);
      expect(signals).toContain('INSTRUMENTATION_SUSPECT');
      expect(signals).toContain('LOW_CTR');

      const result = evaluate(m, 90, cfg, new Date('2026-11-06T07:00:00Z'));
      expect(result.primarySignal).toBe('INSTRUMENTATION_SUSPECT');
    });

    it('TOTAL_SILENCE mengalahkan LOW_TRAFFIC', () => {
      const baseline = 70;
      const m = createMetrics({
        paidViews: 25,       // LOW_TRAFFIC (25 <= 0.5 * 70)
        uniquePaidClicks: 4,
        paidAgedClicks: 4,
        paidMatchedLeads: 0,
        inboundChats: 0,     // TOTAL_SILENCE
        ctr: 0.16,
      });

      const signals = listSignals(m, baseline, cfg);
      expect(signals).toContain('TOTAL_SILENCE');
      expect(signals).toContain('LOW_TRAFFIC');

      const result = evaluate(m, baseline, cfg, new Date('2026-11-06T07:00:00Z'));
      expect(result.primarySignal).toBe('TOTAL_SILENCE');
    });

    it('LOW_TRAFFIC mengalahkan LOW_CTR', () => {
      const baseline = 80;
      const m = createMetrics({
        paidViews: 35,       // LOW_TRAFFIC (35 <= 0.5 * 80)
        uniquePaidClicks: 1, // LOW_CTR (1/35 = 0.028 < 0.04)
        ctr: 0.028,
        paidAgedClicks: 1,
        paidMatchedLeads: 1,
        inboundChats: 1,
      });

      const signals = listSignals(m, baseline, cfg);
      expect(signals).toContain('LOW_TRAFFIC');
      expect(signals).toContain('LOW_CTR');

      const result = evaluate(m, baseline, cfg, new Date('2026-11-06T07:00:00Z'));
      expect(result.primarySignal).toBe('LOW_TRAFFIC');
    });
  });

  describe('Boundary Conditions', () => {
    it('tidak menembak LOW_CTR bila paidViews < minViews (29 vs 30)', () => {
      // 29 views, 0 klik (CTR 0)
      const m29 = createMetrics({ paidViews: 29, uniquePaidClicks: 0, ctr: 0 });
      expect(listSignals(m29, 30, cfg)).not.toContain('LOW_CTR');

      // 30 views, 0 klik (CTR 0) -> harus tembak LOW_CTR
      const m30 = createMetrics({ paidViews: 30, uniquePaidClicks: 0, ctr: 0 });
      expect(listSignals(m30, 30, cfg)).toContain('LOW_CTR');
    });

    it('tidak menembak TOTAL_SILENCE bila agedClicks < minAgedClicks (2 vs 3)', () => {
      const mAged2 = createMetrics({ paidAgedClicks: 2, inboundChats: 0 });
      expect(listSignals(mAged2, 30, cfg)).not.toContain('TOTAL_SILENCE');

      const mAged3 = createMetrics({ paidAgedClicks: 3, inboundChats: 0 });
      expect(listSignals(mAged3, 30, cfg)).toContain('TOTAL_SILENCE');
    });

    it('CTR tepat di threshold (0.040 vs 0.039)', () => {
      const mUnder = createMetrics({ paidViews: 100, uniquePaidClicks: 3, ctr: 0.039 });
      expect(listSignals(mUnder, 100, cfg)).toContain('LOW_CTR');

      const mExact = createMetrics({ paidViews: 100, uniquePaidClicks: 4, ctr: 0.04 });
      expect(listSignals(mExact, 100, cfg)).not.toContain('LOW_CTR');
    });
  });

  describe('Message Formatting', () => {
    it('memformat pesan dengan informasi lengkap dan batasan baris <= 15', () => {
      const m = createMetrics({
        paidViews: 64,
        uniquePaidClicks: 6,
        paidAgedClicks: 4,
        paidMatchedLeads: 2,
        inboundChats: 2,
        ctr: 0.094,
      });

      const message = formatMessage(
        {
          primarySignal: 'TOTAL_SILENCE',
          metrics: m,
          baselineViews: 60,
          hypotheses: diagnose('TOTAL_SILENCE'),
        },
        'Kala Baby Spa',
        new Date('2026-11-06T07:30:00Z')
      );

      expect(message).toContain('🚨 [WATCHDOG IKLAN] Kebocoran Total: Klik Ada tapi Chat Nol');
      expect(message).toContain('Kala Baby Spa');
      expect(message).toContain('Kunjungan Iklan (*Paid Views*): 64 (Baseline: 60)');
      expect(message).toContain('Klik Tombol WA (*Unique Clicks*): 6 (CTR: 9.4%)');
      expect(message).toContain('Klik Terkonfirmasi Matched: 2 lead');
      expect(message).toContain('Klik Tertunda Tanpa Chat (>20m): 4');
      expect(message).toContain('Chat Masuk Nyata (*Inbound Customers*): 2');

      const lineCount = message.split('\n').length;
      expect(lineCount).toBeLessThanOrEqual(15);
    });
  });
});
