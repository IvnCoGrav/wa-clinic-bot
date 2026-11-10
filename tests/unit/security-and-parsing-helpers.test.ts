import { describe, it, expect } from 'vitest';
import { checkDestructiveSafety } from '../../src/utils/destructive-guard';
import { parsePositiveInt, parseNonNegativeNumber } from '../../src/utils/env-numeric';
import { extractPinCoordinates } from '../../src/utils/pin-coordinates';
import { resolveExtForSave } from '../../src/utils/media-kind';
import { isDeepSeekPeakHour } from '../../src/utils/cost-calculator';
import { createMonotonicSseSequencer } from '../../src/utils/sse-sequence';
import { extractWahaLocation } from '../../src/utils/waha-location-parser';
import { normalizePhoneID, normalizePhoneToE164 } from '../../src/utils/phone-normalizer';

describe('UTL-25: Security & Parsing Helper Unit Tests', () => {
  describe('destructive-guard', () => {
    it('blokir eksekusi di lingkungan produksi (fail-closed)', () => {
      expect(() => {
        checkDestructiveSafety({ nodeEnv: 'production' });
      }).toThrow(/blocked in production/i);
    });

    it('blokir database remote tanpa flag --force-nonlocal', () => {
      expect(() => {
        checkDestructiveSafety({
          nodeEnv: 'development',
          dbUrl: 'postgresql://user:pass@db.production-cloud.com:5432/clinic',
          argv: ['node', 'cleanup.js'],
        });
      }).toThrow(/non-local host/i);
    });

    it('mengizinkan database localhost pada non-prod', () => {
      const res = checkDestructiveSafety({
        nodeEnv: 'development',
        dbUrl: 'postgresql://postgres:pass@localhost:5432/clinic',
        argv: ['node', 'cleanup.js', '--confirm'],
      });
      expect(res.isConfirmed).toBe(true);
      expect(res.isDryRun).toBe(false);
      expect(res.host).toBe('localhost');
    });

    it('mengizinkan database remote jika --force-nonlocal disertakan', () => {
      const res = checkDestructiveSafety({
        nodeEnv: 'test',
        dbUrl: 'postgresql://user:pass@10.0.0.5:5432/clinic',
        argv: ['node', 'cleanup.js', '--force-nonlocal'],
      });
      expect(res.isDryRun).toBe(true);
    });
  });

  describe('env-numeric', () => {
    it('parsePositiveInt mengembalikan fallback untuk NaN, nol, negatif, atau desimal', () => {
      expect(parsePositiveInt('42', 10)).toBe(42);
      expect(parsePositiveInt('0', 10)).toBe(10);
      expect(parsePositiveInt('-5', 10)).toBe(10);
      expect(parsePositiveInt('3.14', 10)).toBe(10);
      expect(parsePositiveInt('abc', 10)).toBe(10);
      expect(parsePositiveInt(undefined, 10)).toBe(10);
      expect(parsePositiveInt('', 10)).toBe(10);
    });

    it('parseNonNegativeNumber mengizinkan nol dan angka desimal positif', () => {
      expect(parseNonNegativeNumber('0', 10)).toBe(0);
      expect(parseNonNegativeNumber('3.14', 10)).toBe(3.14);
      expect(parseNonNegativeNumber('-0.1', 10)).toBe(10);
      expect(parseNonNegativeNumber('invalid', 10)).toBe(10);
      expect(parseNonNegativeNumber(undefined, 10)).toBe(10);
    });
  });

  describe('pin-coordinates', () => {
    it('mengekstrak koordinat dari format canonical WhatsApp', () => {
      const coords = extractPinCoordinates('[LOCATION: Lat -7.331234, Lng 112.686543]');
      expect(coords).not.toBeNull();
      expect(coords?.lat).toBeCloseTo(-7.331234, 5);
      expect(coords?.lng).toBeCloseTo(112.686543, 5);
    });

    it('mengekstrak koordinat telanjang dua angka desimal', () => {
      const coords = extractPinCoordinates('Lokasi kami di -7.3456, 112.7890 tolong konfirmasi');
      expect(coords).not.toBeNull();
      expect(coords?.lat).toBeCloseTo(-7.3456, 4);
      expect(coords?.lng).toBeCloseTo(112.7890, 4);
    });

    it('menolak bilangan bulat atau sinyal harga/rupiah', () => {
      expect(extractPinCoordinates('jadwal jam 10, 11 ya')).toBeNull();
      expect(extractPinCoordinates('total biaya Rp 75.000, 100.000')).toBeNull();
    });

    it('menolak koordinat di luar rentang sah bumi', () => {
      expect(extractPinCoordinates('-95.1234, 112.5678')).toBeNull();
      expect(extractPinCoordinates('-7.1234, 195.5678')).toBeNull();
    });
  });

  describe('media-kind', () => {
    it('mendukung ekstensi modern AVIF, HEIC, WebP, dan SVG', () => {
      expect(resolveExtForSave('image/avif')).toBe('avif');
      expect(resolveExtForSave('image/heic')).toBe('heic');
      expect(resolveExtForSave('image/heif')).toBe('heic');
      expect(resolveExtForSave('image/svg+xml')).toBe('svg');
      expect(resolveExtForSave('image/webp')).toBe('webp');
      expect(resolveExtForSave('image/png')).toBe('png');
      expect(resolveExtForSave('image/jpeg')).toBe('jpg');
    });
  });

  describe('cost-calculator peak hour weekday check', () => {
    it('menganggap weekend (Sabtu & Minggu) selalu off-peak', () => {
      // 2026-08-22 adalah Sabtu, jam 10:00 WIB (03:00 UTC)
      const saturday = new Date('2026-08-22T03:00:00Z');
      expect(isDeepSeekPeakHour(saturday)).toBe(false);

      // 2026-08-23 adalah Minggu, jam 10:00 WIB (03:00 UTC)
      const sunday = new Date('2026-08-23T03:00:00Z');
      expect(isDeepSeekPeakHour(sunday)).toBe(false);

      // 2026-08-24 adalah Senin, jam 10:00 WIB (03:00 UTC) -> Peak
      const monday = new Date('2026-08-24T03:00:00Z');
      expect(isDeepSeekPeakHour(monday)).toBe(true);
    });
  });

  describe('sse-sequence monotonic sequencer', () => {
    it('peek() mengembalikan null sebelum next() dipanggil', () => {
      const seq = createMonotonicSseSequencer(100);
      expect(seq.peek()).toBeNull();
      const first = seq.next();
      expect(first).toBe('101');
      expect(seq.peek()).toBe('101');
    });
  });

  describe('waha-location-parser', () => {
    it('menolak koordinat (0,0) atau di luar rentang', () => {
      const zero = extractWahaLocation({
        type: 'location',
        location: { latitude: 0, longitude: 0 },
      });
      expect(zero.hasRealLocation).toBe(false);

      const invalid = extractWahaLocation({
        type: 'location',
        location: { latitude: 120, longitude: 200 },
      });
      expect(invalid.hasRealLocation).toBe(false);

      const valid = extractWahaLocation({
        type: 'location',
        location: { latitude: -7.33, longitude: 112.78 },
      });
      expect(valid.hasRealLocation).toBe(true);
    });
  });

  describe('phone-normalizer', () => {
    it('membersihkan suffix WhatsApp @c.us dan device :12', () => {
      expect(normalizePhoneID('08123456789:12@c.us')).toBe('628123456789');
      expect(normalizePhoneID('628123456789@s.whatsapp.net')).toBe('628123456789');
      expect(normalizePhoneToE164('08123456789')).toBe('628123456789');
      expect(normalizePhoneID('8123456789')).toBe('628123456789');
    });
  });
});
