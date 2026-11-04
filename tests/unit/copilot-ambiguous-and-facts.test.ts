import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  queryReservationsByFilter,
  queryRevenue,
  queryUnrepliedChats,
} from '../../src/services/copilot/copilot-tools';
import { buildSummarizePrompt, buildLabeledToolRows } from '../../src/services/copilot/copilot.service';
import { prisma } from '../../src/db/client';

describe('Copilot Ambiguity Handling & Code-Computed Facts (Fase 5)', () => {
  const tenantId = 'test-tenant';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('5.1 & 5.2 — Deteksi Ambigu & Jalur Klarifikasi', () => {
    it('"Terapis A" dengan 0 reservasi tetapi ada kandidat staf -> ambiguous: true + daftar candidates', async () => {
      // 0 reservasi ditemukan dengan nama "A"
      vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([]);
      // Daftar staf aktif yang ada
      vi.spyOn(prisma.staff, 'findMany').mockResolvedValueOnce([
        { id: 's-1', name: 'Bidan Thabita', active: true },
        { id: 's-2', name: 'Bidan Anisa', active: true },
        { id: 's-3', name: 'Bidan Yusi', active: true },
      ] as any);

      const result = await queryReservationsByFilter.run(tenantId, { staffName: 'A' });

      expect(result.count).toBe(0);
      expect(result.ambiguous).toBe(true);
      expect(result.candidates).toEqual(['Bidan Thabita', 'Bidan Anisa']);
    });

    it('buildSummarizePrompt mewajibkan klarifikasi jika ambiguous: true', () => {
      const prompt = buildSummarizePrompt('Jadwal terapis A', '[]', null);
      expect(prompt).toContain('ATURAN KLARIFIKASI (AMBIGU)');
      expect(prompt).toContain('WAJIB meminta klarifikasi kepada admin');
    });
  });

  describe('5.3 — Angka Dihitung di Kode (summaryFacts)', () => {
    it('queryRevenue menghitung netRevenue, paidAmount, dan pendingAmount secara deterministik', async () => {
      // Data simulasi:
      // Hari 1 (2 Nov): purchase 400.000, delivery 50.000, receipt 200.000 (net: 450.000, paid: 200.000, pending: 250.000)
      // Hari 2 (3 Nov): purchase 285.000, delivery 60.000, receipt 115.000 (net: 345.000, paid: 115.000, pending: 230.000)
      // Total: revenue 795.000, paid 315.000, pending 480.000
      vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([
        {
          id: 'res-1',
          booking_date: new Date('2026-11-02T10:00:00Z'),
          treatment_detail: 'Layanan 1',
          purchase_value: 275000,
          delivery_fee: 40000,
          discount_amount: 0,
          receipt_amount: 200000,
          purchase_occurred_at: new Date('2026-11-02T11:00:00Z'),
        },
        {
          id: 'res-2',
          booking_date: new Date('2026-11-03T14:00:00Z'),
          treatment_detail: 'Layanan 2',
          purchase_value: 410000,
          delivery_fee: 70000,
          discount_amount: 0,
          receipt_amount: 115000,
          purchase_occurred_at: null,
        },
      ] as any);

      const result = await queryRevenue.run(tenantId, { dateFrom: '2026-11-02', dateTo: '2026-11-03' });

      expect(result.summaryFacts).toBeDefined();
      expect(result.summaryFacts.netRevenue).toBe(795000);
      expect(result.summaryFacts.paidAmount).toBe(315000);
      expect(result.summaryFacts.pendingAmount).toBe(480000);

      // Baris TOTAL juga memuat angka yang sama
      const totalRow = result.rows.find((r: any) => r.bucket === 'TOTAL');
      expect(totalRow).toBeDefined();
      expect(totalRow.netRevenue).toBe(795000);
      expect(totalRow.paidAmount).toBe(315000);
      expect(totalRow.pendingAmount).toBe(480000);
    });

    it('queryUnrepliedChats menghitung totalUnreplied dan waitingOver15Min secara deterministik', async () => {
      const now = Date.now();
      vi.spyOn(prisma.conversation, 'findMany').mockResolvedValueOnce([
        {
          id: 'c-1',
          customer: { id: 'cust-1', name: 'Bunda Sarah', phone: '6281234567801' },
          messages: [{ direction: 'INBOUND', content: 'Halo', created_at: new Date(now - 20 * 60000) }],
        },
        {
          id: 'c-2',
          customer: { id: 'cust-2', name: 'Bunda Dewi', phone: '6281234567802' },
          messages: [{ direction: 'INBOUND', content: 'Tanya jadwal', created_at: new Date(now - 5 * 60000) }],
        },
      ] as any);

      const result = await queryUnrepliedChats.run(tenantId, {});
      expect(result.summaryFacts).toBeDefined();
      expect(result.summaryFacts.totalUnreplied).toBe(2);
      expect(result.summaryFacts.waitingOver15Min).toBe(1);
    });
  });

  describe('5.4 — Larang Alarm Palsu Bentrok Jadwal', () => {
    it('dua jadwal di jam yang sama tetapi terapis berbeda BUKAN tabrakan (hasCollision: false)', async () => {
      vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([
        {
          id: 'res-yusi',
          booking_date: new Date('2026-11-04T08:00:00Z'), // 15:00 WIB
          assigned_staff: { name: 'Bidan Yusi' },
          customer: { name: 'Bunda A', phone: '62811' },
        },
        {
          id: 'res-thabita',
          booking_date: new Date('2026-11-04T08:00:00Z'), // 15:00 WIB
          assigned_staff: { name: 'Bidan Thabita' },
          customer: { name: 'Bunda B', phone: '62822' },
        },
      ] as any);

      const result = await queryReservationsByFilter.run(tenantId, { date: '2026-11-04' });
      expect(result.summaryFacts.hasCollision).toBe(false);
      expect(result.summaryFacts.scheduleCollisions).toHaveLength(0);
    });

    it('dua jadwal di jam yang sama pada terapis yang SAMA terdeteksi sebagai tabrakan nyata', async () => {
      vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([
        {
          id: 'res-1',
          booking_date: new Date('2026-11-04T08:00:00Z'), // 15:00 WIB
          assigned_staff: { name: 'Bidan Yusi' },
          customer: { name: 'Bunda A', phone: '62811' },
        },
        {
          id: 'res-2',
          booking_date: new Date('2026-11-04T08:00:00Z'), // 15:00 WIB
          assigned_staff: { name: 'Bidan Yusi' },
          customer: { name: 'Bunda B', phone: '62822' },
        },
      ] as any);

      const result = await queryReservationsByFilter.run(tenantId, { date: '2026-11-04' });
      expect(result.summaryFacts.hasCollision).toBe(true);
      expect(result.summaryFacts.scheduleCollisions).toHaveLength(1);
      expect(result.summaryFacts.scheduleCollisions[0].staff).toBe('Bidan Yusi');
    });
  });

  describe('Integritas Labeled Rows ke Summarize Prompt', () => {
    it('buildLabeledToolRows membawa summaryFacts, ambiguous, dan candidates ke prompt', () => {
      const collected = [
        {
          tool: 'query_reservations_by_filter',
          rows: [],
          ambiguous: true,
          candidates: ['Bidan Thabita', 'Bidan Anisa'],
          summaryFacts: { totalReservations: 0, hasCollision: false },
        },
      ];

      const labeled = buildLabeledToolRows(collected as any);
      expect(labeled).toContain('"ambiguous":true');
      expect(labeled).toContain('Bidan Thabita');
      expect(labeled).toContain('Bidan Anisa');
      expect(labeled).toContain('"summaryFacts"');
    });
  });
});
