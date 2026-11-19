import { describe, it, expect } from 'vitest';
import {
  parseFollowUpHolidayConfig,
  parseFollowUpHolidayInput,
  resolveFollowUpHolidayState,
  clampScheduledAtToPostHoliday,
  countWibDaysBetween,
} from '../../src/config/followup-scheduling';

describe('Follow-Up Holiday State & Scheduling Pure Contract Tests', () => {
  it('1. config korup/kosong menghasilkan default aman yang fail-safe', () => {
    const fromNull = parseFollowUpHolidayConfig(null);
    expect(fromNull.enabled).toBe(false);
    expect(fromNull.startDate).toBeNull();
    expect(fromNull.endDate).toBeNull();
    expect(fromNull.staleCapDays).toBe(14);
    expect(fromNull.autoRescheduleOnExit).toBe(true);

    const fromEmpty = parseFollowUpHolidayConfig({});
    expect(fromEmpty.enabled).toBe(false);

    const fromString = parseFollowUpHolidayConfig('invalid-json');
    expect(fromString.enabled).toBe(false);
  });

  it('1b. config legacy: string "false" tidak dianggap aktif dan manualActivatedAt invalid diabaikan', () => {
    const cfg = parseFollowUpHolidayConfig({ enabled: 'false', manualActivatedAt: 'bukan-tanggal' });
    expect(cfg.enabled).toBe(false);
    expect(cfg.manualActivatedAt).toBeNull();

    const cfgTrue = parseFollowUpHolidayConfig({ enabled: 'true' });
    expect(cfgTrue.enabled).toBe(true);
  });

  it('2. parser input memvalidasi input enabled, tanggal, dan rentang secara ketat', () => {
    // Valid input
    const valid = parseFollowUpHolidayInput({
      enabled: true,
      startDate: '2026-12-24',
      endDate: '2026-12-26',
      reason: 'Cuti Bersama Akhir Tahun',
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.value.enabled).toBe(true);
      expect(valid.value.startDate).toBe('2026-12-24');
      expect(valid.value.endDate).toBe('2026-12-26');
      expect(valid.value.reason).toBe('Cuti Bersama Akhir Tahun');
    }

    // startDate > endDate ditolak
    const invalidOrder = parseFollowUpHolidayInput({
      enabled: true,
      startDate: '2026-12-28',
      endDate: '2026-12-24',
    });
    expect(invalidOrder.ok).toBe(false);
    if (!invalidOrder.ok) {
      expect(invalidOrder.errors.some((e) => e.includes('tidak boleh lebih besar'))).toBe(true);
    }

    // Tanggal invalid kalender (misal 31 Februari) ditolak
    const invalidDate = parseFollowUpHolidayInput({
      enabled: true,
      startDate: '2026-02-31',
      endDate: '2026-03-05',
    });
    expect(invalidDate.ok).toBe(false);
    if (!invalidDate.ok) {
      expect(invalidDate.errors.some((e) => e.includes('tidak valid'))).toBe(true);
    }

    // Rentang > 60 hari ditolak
    const tooLong = parseFollowUpHolidayInput({
      enabled: true,
      startDate: '2026-01-01',
      endDate: '2026-04-01',
    });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) {
      expect(tooLong.errors.some((e) => e.includes('Rentang libur maksimal 60 hari'))).toBe(true);
    }

    // Hanya startDate tanpa endDate ditolak
    const singleDate = parseFollowUpHolidayInput({
      enabled: true,
      startDate: '2026-12-24',
    });
    expect(singleDate.ok).toBe(false);
    if (!singleDate.ok) {
      expect(singleDate.errors.some((e) => e.includes('wajib diisi berpasangan'))).toBe(true);
    }
  });

  it('3. resolveFollowUpHolidayState: enabled=false selalu inactive', () => {
    const cfg = parseFollowUpHolidayConfig({ enabled: false });
    const now = new Date('2026-12-25T10:00:00+07:00');
    expect(resolveFollowUpHolidayState(cfg, now)).toEqual({ status: 'inactive' });
  });

  it('4. resolveFollowUpHolidayState: mode rentang tanggal (24-26 Des)', () => {
    const cfg = parseFollowUpHolidayConfig({
      enabled: true,
      startDate: '2026-12-24',
      endDate: '2026-12-26',
      autoRescheduleOnExit: true,
    });

    // 23 Des 10:00 WIB -> inactive (belum libur)
    const before = new Date('2026-12-23T10:00:00+07:00');
    expect(resolveFollowUpHolidayState(cfg, before)).toEqual({ status: 'inactive' });

    // 24 Des 09:00 WIB -> active (hari pertama libur)
    const day1 = new Date('2026-12-24T09:00:00+07:00');
    expect(resolveFollowUpHolidayState(cfg, day1)).toEqual({ status: 'active', mode: 'range' });

    // 26 Des 23:59 WIB (16:59 UTC) -> active (menit terakhir libur)
    const dayEnd = new Date('2026-12-26T23:59:00+07:00');
    expect(resolveFollowUpHolidayState(cfg, dayEnd)).toEqual({ status: 'active', mode: 'range' });

    // 27 Des 00:01 WIB -> exit_pending (libur usai, butuh reschedule)
    const after = new Date('2026-12-27T00:01:00+07:00');
    expect(resolveFollowUpHolidayState(cfg, after)).toEqual({
      status: 'exit_pending',
      exitEndDate: '2026-12-26',
    });

    // Setelah lastRescheduledAt dicatat sama dengan endDate -> inactive
    const cfgRescheduled = parseFollowUpHolidayConfig({
      ...cfg,
      lastRescheduledAt: '2026-12-26',
    });
    expect(resolveFollowUpHolidayState(cfgRescheduled, after)).toEqual({ status: 'inactive' });
  });

  it('5. resolveFollowUpHolidayState: autoRescheduleOnExit=false tidak memicu exit_pending', () => {
    const cfg = parseFollowUpHolidayConfig({
      enabled: true,
      startDate: '2026-12-24',
      endDate: '2026-12-26',
      autoRescheduleOnExit: false,
    });
    const after = new Date('2026-12-27T09:00:00+07:00');
    expect(resolveFollowUpHolidayState(cfg, after)).toEqual({ status: 'inactive' });
  });

  it('6. resolveFollowUpHolidayState: mode manual tanpa tanggal aktif terus hingga batas 30 hari', () => {
    const cfg = parseFollowUpHolidayConfig({
      enabled: true,
      startDate: null,
      endDate: null,
      manualActivatedAt: '2026-11-01T02:00:00.000Z', // 1 Nov 2026
    });

    // Hari ke-10 -> active (manual)
    const day10 = new Date('2026-11-10T10:00:00+07:00');
    expect(resolveFollowUpHolidayState(cfg, day10)).toEqual({ status: 'active', mode: 'manual' });

    // Hari ke-31 -> manual_expired (proteksi 30 hari auto-exit)
    const day31 = new Date('2026-12-03T10:00:00+07:00');
    expect(resolveFollowUpHolidayState(cfg, day31)).toEqual({ status: 'manual_expired' });
  });

  it('7. clampScheduledAtToPostHoliday: menggeser jadwal yang jatuh di masa libur ke hari pertama buka', () => {
    const cfg = parseFollowUpHolidayConfig({
      enabled: true,
      startDate: '2026-12-24',
      endDate: '2026-12-26',
      windowStartMinWib: 540, // 09:00 WIB = 02:00 UTC
    });

    // Jadwal jatuh pada 25 Des 10:00 WIB
    const holidaySchedule = new Date('2026-12-25T10:00:00+07:00');
    const clamped = clampScheduledAtToPostHoliday(holidaySchedule, cfg);

    // Harus tergeser ke 27 Des 2026 pukul 09:00 WIB (02:00 UTC)
    expect(clamped.toISOString()).toBe('2026-12-27T02:00:00.000Z');

    // Jadwal di luar libur (23 Des) tidak berubah
    const normalSchedule = new Date('2026-12-23T10:00:00+07:00');
    expect(clampScheduledAtToPostHoliday(normalSchedule, cfg)).toEqual(normalSchedule);
  });
});
