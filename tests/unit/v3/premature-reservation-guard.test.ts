import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/reservation-core.service', () => ({
  reservationCoreService: {
    saveReservation: vi.fn(async () => ({
      reservation: { id: 'res-guard-1' },
      isNew: true,
      isUpdate: false,
    })),
  },
  ReservationConflictError: class ReservationConflictError extends Error {},
}));

import {
  executeSaveReservation,
  verifyDayMentioned,
} from '../../../src/v3/tools/save-reservation.tool';
import { reservationCoreService } from '../../../src/services/reservation-core.service';

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Phase 3+5 (audit 833178) — Day Evidence Gate: "Besok" karangan tanpa jejak
 * di pesan user DITOLAK sebelum tulis DB; hari yang disebut user LOLOS.
 */
describe('verifyDayMentioned (pure)', () => {
  it('"Besok" karangan tanpa jejak -> pesan penolakan', () => {
    const err = verifyDayMentioned('Besok', ['tidak ada, saya ambil treatment nya']);
    expect(err).not.toBeNull();
    expect(err!).toMatch(/DILARANG/);
  });

  it('"besok" disebut user -> lolos (null)', () => {
    expect(verifyDayMentioned('Besok pagi', ['kalau besok apakah bisa?'])).toBeNull();
  });

  it('"sabtu" disebut user -> lolos; "minggu" usia (3 minggu) -> tetap tolak', () => {
    expect(verifyDayMentioned('Sabtu', ['hari sabtu bisa kak?'])).toBeNull();
    expect(verifyDayMentioned('Minggu', ['bayi saya umur 3 minggu'])).not.toBeNull();
    expect(verifyDayMentioned('Minggu', ['hari minggu bisa?'])).toBeNull();
  });

  it('tanpa evidence (kompatibilitas) -> lolos', () => {
    expect(verifyDayMentioned('Besok', undefined)).toBeNull();
    expect(verifyDayMentioned('Besok', [])).toBeNull();
  });

  it('bookingDate kosong + evidence ada -> tolak', () => {
    expect(verifyDayMentioned('', ['saya ambil treatment nya'])).not.toBeNull();
  });
});

describe('executeSaveReservation day gate (no DB write on reject)', () => {
  const base = {
    customerId: 'cust-guard',
    chatId: '628123@c.us',
    treatmentName: 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)',
    tenantId: 'default-tenant',
  } as any;

  it('halusinasi "Besok" tanpa jejak -> success:false + DB TAK ditulis', async () => {
    const out = await executeSaveReservation({
      ...base,
      bookingDate: 'Besok',
      dayMentionEvidence: ['tidak ada, saya ambil treatment nya'],
    });
    expect(out.success).toBe(false);
    expect(out.message).toMatch(/DILARANG/);
    expect(vi.mocked(reservationCoreService.saveReservation)).not.toHaveBeenCalled();
  });

  it('"sabtu" disebut user -> success:true + DB ditulis', async () => {
    const out = await executeSaveReservation({
      ...base,
      bookingDate: 'Sabtu',
      dayMentionEvidence: ['kalau hari sabtu bisa kak?'],
    });
    expect(out.success).toBe(true);
    expect(vi.mocked(reservationCoreService.saveReservation)).toHaveBeenCalledTimes(1);
  });
});
