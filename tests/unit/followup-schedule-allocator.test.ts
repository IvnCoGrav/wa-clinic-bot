import { describe, it, expect, vi } from 'vitest';
import {
  allocateFollowUpSlots,
  getWibMinutes,
  loadFollowUpDailyLoad,
  loadFollowUpDailyLoadDetailed,
} from '../../src/services/followup-schedule-allocator';

describe('FollowUp Schedule Allocator Unit Tests', () => {
  describe('getWibMinutes', () => {
    it('menghitung menit WIB deterministik dari tanggal UTC (+7 jam)', () => {
      // 02:30 UTC = 09:30 WIB = 9 * 60 + 30 = 570 menit
      const d1 = new Date('2026-12-25T02:30:00.000Z');
      expect(getWibMinutes(d1)).toBe(570);

      // 00:00 UTC = 07:00 WIB = 420 menit
      const d2 = new Date('2026-12-25T00:00:00.000Z');
      expect(getWibMinutes(d2)).toBe(420);
    });
  });

  describe('allocateFollowUpSlots', () => {
    it('mengembalikan array kosong jika count <= 0', () => {
      const slots = allocateFollowUpSlots({
        count: 0,
        maxPerDay: 40,
        startDateWib: { year: 2026, month: 11, day: 25 },
      });
      expect(slots).toEqual([]);
    });

    it('mengalokasikan slot merata pada jendela kerja default (09:00 - 16:30 WIB)', () => {
      const slots = allocateFollowUpSlots({
        count: 3,
        maxPerDay: 40,
        windowStartMinWib: 540, // 09:00
        windowEndMinWib: 990,   // 16:30
        startDateWib: { year: 2026, month: 11, day: 25 }, // 25 Des 2026
      });

      expect(slots.length).toBe(3);
      // Slot 1: 09:00 WIB = 02:00 UTC
      expect(slots[0].toISOString()).toBe('2026-12-25T02:00:00.000Z');
      // Step: floor(450 / 40) = 11 menit. Slot 2: 09:11 WIB = 02:11 UTC
      expect(slots[1].toISOString()).toBe('2026-12-25T02:11:00.000Z');
      // Slot 3: 09:22 WIB = 02:22 UTC
      expect(slots[2].toISOString()).toBe('2026-12-25T02:22:00.000Z');
    });

    it('memperhitungkan beban existing (loadByDate) dan membatasi per hari <= maxPerDay', () => {
      const load = new Map<string, number>();
      load.set('2026-12-25', 38); // Hari ini sisa 2 slot dari maxPerDay 40

      const slots = allocateFollowUpSlots({
        count: 5,
        maxPerDay: 40,
        startDateWib: { year: 2026, month: 11, day: 25 },
        loadByDate: load,
      });

      expect(slots.length).toBe(5);
      // 2 slot di 25 Des (index 38 & 39)
      expect(slots[0].toISOString().slice(0, 10)).toBe('2026-12-25');
      expect(slots[1].toISOString().slice(0, 10)).toBe('2026-12-25');
      // 3 slot meluber ke 26 Des
      expect(slots[2].toISOString().slice(0, 10)).toBe('2026-12-26');
      expect(slots[3].toISOString().slice(0, 10)).toBe('2026-12-26');
      expect(slots[4].toISOString().slice(0, 10)).toBe('2026-12-26');

      // Beban di loadByDate ter-update
      expect(load.get('2026-12-25')).toBe(40);
      expect(load.get('2026-12-26')).toBe(3);
    });

    it('melewati tanggal yang terdaftar di skipDateKeys', () => {
      const skipDates = new Set<string>(['2026-12-25', '2026-12-26']);

      const slots = allocateFollowUpSlots({
        count: 2,
        maxPerDay: 40,
        startDateWib: { year: 2026, month: 11, day: 25 },
        skipDateKeys: skipDates,
      });

      expect(slots.length).toBe(2);
      // Tanggal 25 & 26 Des dilewati, mendarat di 27 Des
      expect(slots[0].toISOString().slice(0, 10)).toBe('2026-12-27');
      expect(slots[1].toISOString().slice(0, 10)).toBe('2026-12-27');
    });

    it('firstDayMinStartWib mencegah slot masa lalu pada hari pertama', () => {
      const slots = allocateFollowUpSlots({
        count: 2,
        maxPerDay: 40,
        startDateWib: { year: 2026, month: 11, day: 25 },
        windowStartMinWib: 540,  // 09:00 WIB
        windowEndMinWib: 990,    // 16:30 WIB
        firstDayMinStartWib: 780 // Jam 13:00 WIB
      });

      expect(slots.length).toBe(2);
      // Slot 1 mulai dari 13:00 WIB = 06:00 UTC
      expect(slots[0].toISOString()).toBe('2026-12-25T06:00:00.000Z');
      // Slot 2: 13:11 WIB = 06:11 UTC
      expect(slots[1].toISOString()).toBe('2026-12-25T06:11:00.000Z');
    });

    it('jika firstDayMinStartWib >= windowEndMinWib, lewati hari pertama ke hari kedua', () => {
      const slots = allocateFollowUpSlots({
        count: 2,
        maxPerDay: 40,
        startDateWib: { year: 2026, month: 11, day: 25 },
        windowStartMinWib: 540,
        windowEndMinWib: 990,     // 16:30 WIB
        firstDayMinStartWib: 1000 // 16:40 WIB (sudah tutup)
      });

      expect(slots.length).toBe(2);
      // Hari pertama dilewati karena jam operasional sudah habis
      expect(slots[0].toISOString().slice(0, 10)).toBe('2026-12-26');
      expect(slots[0].toISOString()).toBe('2026-12-26T02:00:00.000Z'); // 09:00 WIB
    });

    it('kuota > kapasitas jendela tidak menghasilkan slot duplikat di 16:29', () => {
      const slots = allocateFollowUpSlots({
        count: 100,
        maxPerDay: 100,
        startDateWib: { year: 2026, month: 11, day: 25 },
        windowStartMinWib: 540,
        windowEndMinWib: 990,
      });

      expect(slots.length).toBe(100);
      const unique = new Set(slots.map((d) => d.toISOString()));
      expect(unique.size).toBe(100);
      // Kapasitas jendela = floor(450/5) = 90 slot/hari.
      const day1 = slots.filter((d) => d.toISOString().startsWith('2026-12-25'));
      const day2 = slots.filter((d) => d.toISOString().startsWith('2026-12-26'));
      expect(day1.length).toBe(90);
      expect(day2.length).toBe(10);
    });

    it('mengisi celah kosong pada hari yang sudah memiliki antrean (tidak menumpuk)', () => {
      const occupied = new Map<string, Set<number>>();
      occupied.set('2026-12-25', new Set([540, 551])); // 09:00 dan 09:11 sudah terisi

      const slots = allocateFollowUpSlots({
        count: 2,
        maxPerDay: 40,
        startDateWib: { year: 2026, month: 11, day: 25 },
        windowStartMinWib: 540,
        windowEndMinWib: 990,
        loadByDate: new Map([['2026-12-25', 2]]),
        occupiedMinutesByDate: occupied,
      });

      expect(slots[0].toISOString()).toBe('2026-12-25T02:22:00.000Z'); // 09:22 WIB
      expect(slots[1].toISOString()).toBe('2026-12-25T02:33:00.000Z'); // 09:33 WIB
    });
  });

  describe('loadFollowUpDailyLoad', () => {
    it('mengisi map beban harian dari prisma findMany fallback', async () => {
      const mockPrisma = {
        followUp: {
          findMany: vi.fn().mockResolvedValue([
            { scheduled_at: new Date('2026-12-25T02:00:00.000Z') }, // 25 Des WIB
            { scheduled_at: new Date('2026-12-25T05:00:00.000Z') }, // 25 Des WIB
            { scheduled_at: new Date('2026-12-26T02:00:00.000Z') }, // 26 Des WIB
          ]),
        },
      };

      const load = await loadFollowUpDailyLoad('tenant-test', new Date('2026-12-25T00:00:00.000Z'), mockPrisma);
      expect(load.get('2026-12-25')).toBe(2);
      expect(load.get('2026-12-26')).toBe(1);
    });

    it('fail-safe mengembalikan map kosong bila database offline/error', async () => {
      const mockPrisma = {
        followUp: {
          findMany: vi.fn().mockRejectedValue(new Error('DB offline')),
        },
      };

      const load = await loadFollowUpDailyLoad('tenant-test', new Date('2026-12-25T00:00:00.000Z'), mockPrisma);
      expect(load.size).toBe(0);
    });

    it('loadFollowUpDailyLoadDetailed menyimpan jumlah dan menit slot terpakai', async () => {
      const mockPrisma = {
        followUp: {
          findMany: vi.fn().mockResolvedValue([
            { scheduled_at: new Date('2026-12-25T02:00:00.000Z') }, // 09:00 WIB
            { scheduled_at: new Date('2026-12-25T02:11:00.000Z') }, // 09:11 WIB
            { scheduled_at: new Date('2026-12-26T02:00:00.000Z') }, // 09:00 WIB
          ]),
        },
      };

      const { counts, occupiedMinutes } = await loadFollowUpDailyLoadDetailed(
        'tenant-test',
        new Date('2026-12-25T00:00:00.000Z'),
        mockPrisma
      );

      expect(counts.get('2026-12-25')).toBe(2);
      expect(counts.get('2026-12-26')).toBe(1);
      expect(occupiedMinutes.get('2026-12-25')?.has(540)).toBe(true);
      expect(occupiedMinutes.get('2026-12-25')?.has(551)).toBe(true);
    });
  });
});
