import { describe, it, expect } from 'vitest';
import {
  extractScheduleFromMessages,
  filterActiveSessionMessages,
  isNegotiatedScheduleCommitted,
} from '../../packages/admin-dashboard/src/utils/chatScheduleExtractor';

describe('filterActiveSessionMessages — Isolasi Jendela Sesi Aktif', () => {
  it('hanya menyertakan pesan dalam 72 jam dari timestamp pesan terbaru', () => {
    const messages = [
      { created_at: '2026-08-17T10:00:00Z', content: 'pesan 2 bulan lalu' },
      { created_at: '2026-10-15T08:00:00Z', content: 'pesan 2 hari lalu' },
      { created_at: '2026-10-17T09:00:00Z', content: 'pesan hari ini' },
    ];
    const filtered = filterActiveSessionMessages(messages, 72);
    expect(filtered.length).toBe(2);
    expect(filtered.some((m) => m.content === 'pesan 2 bulan lalu')).toBe(false);
    expect(filtered.some((m) => m.content === 'pesan 2 hari lalu')).toBe(true);
    expect(filtered.some((m) => m.content === 'pesan hari ini')).toBe(true);
  });

  it('pesan tanpa created_at dianggap terkini (FMEA safety)', () => {
    const messages = [
      { created_at: '2026-08-17T10:00:00Z', content: 'lama' },
      { content: 'tanpa timestamp' },
      { created_at: '2026-10-17T09:00:00Z', content: 'terkini' },
    ];
    const filtered = filterActiveSessionMessages(messages, 72);
    expect(filtered.some((m) => m.content === 'tanpa timestamp')).toBe(true);
    expect(filtered.some((m) => m.content === 'lama')).toBe(false);
  });

  it('jika seluruh pesan tidak memiliki timestamp, fallback slice(-15)', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({ content: `pesan ${i + 1}` }));
    const filtered = filterActiveSessionMessages(messages, 72);
    expect(filtered.length).toBe(15);
    expect(filtered[0].content).toBe('pesan 6');
  });
});

describe('Kasus Bunda Yuni — Isolasi Jam 2 Bulan Lalu & Hari Relatif', () => {
  const baseDate = new Date('2026-10-17T02:15:00Z'); // Sabtu 17 Okt 2026 09:15 WIB
  const customer = {
    name: 'Bunda Yuni~ Winosari',
    phone: '6281999493778',
    reservations: [
      {
        id: 'res-agustus',
        status: 'completed',
        booking_date: '2026-08-17T12:00:00Z',
        treatment_detail: 'Combination: Pijat Lahap/Pulih Ceria, Pijat Moksa (Pasien: Alen & Alin)',
        purchase_value: 70000,
        treatment_category: 'BOTH',
      },
    ],
  };

  const messages = [
    // Pesan dari 2 bulan lalu (Agustus 2026)
    {
      direction: 'OUTBOUND',
      content: 'Selamat Malam bunda Yuni! Besok kami akan menuju rumah bunda, kemungkinan akan tiba di jam 10.00-10.30.',
      created_at: '2026-08-17T13:44:20Z',
    },
    {
      direction: 'INBOUND',
      content: 'ok mba',
      created_at: '2026-08-17T13:45:00Z',
    },
    // Pesan baru hari ini (17 Oktober 2026)
    {
      direction: 'OUTBOUND',
      content: 'Halo Bunda Yuni! Nggak terasa sudah 2 bulan nih. Boleh kami bantu aturkan jadwalnya?',
      created_at: '2026-10-17T02:08:45Z',
    },
    {
      direction: 'INBOUND',
      content: 'Sabtu depan boleh',
      created_at: '2026-10-17T02:12:32Z',
    },
  ];

  it('ekstraksi jadwal mengisolasi jam Agustus dan menghitung tanggal ke Sabtu pekan depan', () => {
    const extracted = extractScheduleFromMessages(messages, customer, [], null, { now: baseDate });

    // 1. Tanggal WAJIB dihitung ke Sabtu depan (24 Oktober 2026)
    expect(extracted.bookingDate).not.toBeNull();
    expect(extracted.bookingDate?.getDate()).toBe(24);
    expect(extracted.bookingDate?.getMonth()).toBe(9); // Oktober (0-indexed)
    expect(extracted.isDateFromFallback).toBeFalsy();

    // 2. Jam dari pesan 17 Agustus (10.00-10.30) DILARANG tersedot!
    expect(extracted.timeDisplay).not.toBe('10.00-10.30');
    // Waktu jatuh ke fallback default
    expect(extracted.isTimeFromFallback).toBe(true);

    // 3. Treatment diserap dari riwayat dan ditandai isTreatmentFromHistory
    expect(extracted.treatmentName).toContain('Pijat Lahap');
    expect(extracted.isTreatmentFromHistory).toBe(true);

    // 4. isNegotiatedScheduleCommitted HARUS bernilai false (karena jam belum disepakati di sesi aktif)
    const isCommitted = isNegotiatedScheduleCommitted(messages, extracted);
    expect(isCommitted).toBe(false);
  });
});
