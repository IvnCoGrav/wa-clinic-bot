import { describe, it, expect } from 'vitest';
import {
  parseRelativeIndonesianDayDate,
  extractScheduleFromMessages,
} from '../../packages/admin-dashboard/src/utils/chatScheduleExtractor';

describe('parseRelativeIndonesianDayDate — Parser Nama Hari Relatif', () => {
  it('"Sabtu depan" dari Sabtu 17-10-2026 → 24 Oktober 2026 (+7 hari)', () => {
    const base = new Date('2026-10-17T12:00:00+07:00'); // Sabtu
    const result = parseRelativeIndonesianDayDate('Sabtu depan boleh', base);
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(9); // Oktober (0-indexed)
    expect(result?.getDate()).toBe(24);
  });

  it('"Senin depan" dari Kamis 15-10-2026 → 26 Oktober 2026 (pekan berikutnya)', () => {
    const base = new Date('2026-10-15T12:00:00+07:00'); // Kamis
    const result = parseRelativeIndonesianDayDate('klo senin depan bisa kak?', base);
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(9);
    expect(result?.getDate()).toBe(26);
  });

  it('"Senin" tanpa modifier dari Kamis 15-10-2026 → 19 Oktober 2026 (Senin terdekat, +4 hari)', () => {
    const base = new Date('2026-10-15T12:00:00+07:00'); // Kamis
    const result = parseRelativeIndonesianDayDate('bisa hari senin ya', base);
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(9);
    expect(result?.getDate()).toBe(19);
  });

  it('"Minggu ini ya" dari Jumat 16-10-2026 → 18 Oktober 2026 (+2 hari)', () => {
    const base = new Date('2026-10-16T12:00:00+07:00'); // Jumat
    const result = parseRelativeIndonesianDayDate('minggu ini ya bun', base);
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(9);
    expect(result?.getDate()).toBe(18);
  });

  it('"Jumat nanti" dari Selasa 13-10-2026 → 16 Oktober 2026 (+3 hari)', () => {
    const base = new Date('2026-10-13T12:00:00+07:00'); // Selasa
    const result = parseRelativeIndonesianDayDate('mau jumat nanti jam 10', base);
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(9);
    expect(result?.getDate()).toBe(16);
  });

  it('Variasi nama hari non-standar: "jum at" & "ahad"', () => {
    const base = new Date('2026-10-13T12:00:00+07:00'); // Selasa
    const jumat = parseRelativeIndonesianDayDate('bisa jum at ya', base);
    expect(jumat?.getDate()).toBe(16);

    const ahad = parseRelativeIndonesianDayDate('ahad besok', base);
    expect(ahad?.getDate()).toBe(18);
  });

  it('Teks tanpa nama hari → null', () => {
    const base = new Date('2026-10-17T12:00:00+07:00');
    expect(parseRelativeIndonesianDayDate('halo kak mau tanya harga', base)).toBeNull();
  });
});

describe('extractScheduleFromMessages — Integrasi Nama Hari Relatif', () => {
  it('Bunda Yuni: chat "Sabtu depan boleh" dari Sabtu 17-10-2026 menghasilkan tanggal 24 Oktober 2026', () => {
    const baseDate = new Date('2026-10-17T02:08:45Z'); // Sabtu 17 Okt 2026 09:08 WIB
    const messages = [
      {
        direction: 'OUTBOUND',
        content: 'Halo Bunda Yuni! Mau lanjut treatment lagi? minggu depan masih ada slot',
        created_at: '2026-10-17T02:08:45Z',
      },
      {
        direction: 'INBOUND',
        content: 'Sabtu depan boleh',
        created_at: '2026-10-17T02:12:32Z',
      },
    ];

    const extracted = extractScheduleFromMessages(messages, {}, [], null, { now: baseDate });
    expect(extracted.bookingDate).not.toBeNull();
    expect(extracted.bookingDate?.getDate()).toBe(24);
    expect(extracted.bookingDate?.getMonth()).toBe(9); // Oktober
    expect(extracted.dateDisplay).toContain('24 Oktober 2026');
    expect(extracted.isDateFromFallback).toBeFalsy();
  });
});
