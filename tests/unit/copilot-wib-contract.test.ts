import { describe, it, expect, vi } from 'vitest';
import { queryReservationsByFilter } from '../../src/services/copilot/copilot-tools';
import {
  stripInternalIds,
  buildSummarizePrompt,
  buildDegradedAnswer,
} from '../../src/services/copilot/copilot.service';
import { prisma } from '../../src/db/client';

describe('Copilot WIB Contract (Fase 2)', () => {
  it('queryReservationsByFilter mengonversi booking_date 10:00Z ke 17:00 WIB deterministik', async () => {
    const mockFindMany = vi.spyOn(prisma.reservation, 'findMany').mockResolvedValueOnce([
      {
        id: 'res-1',
        customer: {
          id: 'cust-1',
          name: 'Bunda Anjani',
          phone: '628123456789',
          conversations: [{ id: 'conv-1' }],
        },
        treatment_detail: 'Pregnant Massage',
        treatment_category: 'MOM',
        booking_date: new Date('2026-11-04T10:00:00.000Z'),
        status: 'confirmed',
        assigned_staff: { name: 'Bidan Yusi' },
      },
    ] as any);

    const result = await queryReservationsByFilter.run('default-tenant', { date: '2026-11-04' });
    expect(result.count).toBe(1);
    const row = result.rows[0];

    // Harus berformat WIB YYYY-MM-DD dan HH:mm
    expect(row.bookingDateWib).toBe('2026-11-04');
    expect(row.bookingTimeWib).toBe('17:00');
    // Field mentah bookingDate tidak boleh ada agar LLM tidak salah baca 10:00 UTC
    expect((row as any).bookingDate).toBeUndefined();

    mockFindMany.mockRestore();
  });

  it('stripInternalIds membersihkan ID internal dan mencegah kebocoran bookingDate mentah', () => {
    const rawRows = [
      {
        id: 'res-123',
        customerId: 'cust-456',
        customerName: 'Bunda Anjani',
        bookingDateWib: '2026-11-04',
        bookingTimeWib: '17:00',
        bookingDate: '2026-11-04T10:00:00.000Z',
      },
    ];

    const cleaned = stripInternalIds(rawRows);
    expect(cleaned[0].id).toBeUndefined();
    expect(cleaned[0].customerId).toBeUndefined();
    expect(cleaned[0].bookingDateWib).toBe('2026-11-04');
    expect(cleaned[0].bookingTimeWib).toBe('17:00');
    expect(cleaned[0].bookingDate).toBeUndefined();
  });

  it('buildSummarizePrompt menginstruksikan LLM hanya menyebut jam dari field *Wib', () => {
    const prompt = buildSummarizePrompt('Siapa pasien jam 10?', '[]', null);
    expect(prompt).toContain('PANDUAN WAKTU (WIB)');
    expect(prompt).toContain('*Wib');
    expect(prompt).toContain('DILARANG KERAS membaca atau menghitung dari timestamp UTC mentah');
  });

  it('buildDegradedAnswer menyajikan format jam WIB (17:00 WIB)', () => {
    const collected = [
      {
        tool: 'query_reservations_by_filter',
        rows: [
          {
            customerName: 'Bunda Anjani',
            treatment: 'Pregnant Massage',
            bookingDateWib: '2026-11-04',
            bookingTimeWib: '17:00',
            status: 'confirmed',
          },
        ],
      },
    ];

    const answer = buildDegradedAnswer(collected);
    expect(answer).toContain('17:00 WIB');
    expect(answer).not.toContain('10:00');
  });
});
