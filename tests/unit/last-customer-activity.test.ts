import { describe, it, expect } from 'vitest';
import { getLastCustomerActivityMs } from '../../src/services/conversation.service';

/**
 * Fase C1 (Rencana Perbaikan Opsi C) — SATU definisi "jam aktivitas customer".
 *
 * Akar masalah R2: tiga pembaca memakai tiga definisi waktu berbeda.
 * - machine.ts:252 idle reset pakai last_message_at (ikut pesan bot)
 * - conversation.service.ts:798 bolehKirimProaktif prioritasnya terbalik
 * - ai-scope-gate.service.ts:50 sudah benar
 *
 * Test ini mengunci kontrak fungsi kanonis: aktivitas customer = pesan MASUK
 * terakhir (last_customer_message_at), dengan fallback ke last_message_at hanya
 * bila kolom baru belum terisi (data lawas).
 */
describe('Fase C1 — getLastCustomerActivityMs (satu definisi jam aktivitas customer)', () => {
  it('memakai last_customer_message_at bila tersedia', () => {
    const cust = new Date('2026-10-05T10:00:00Z');
    const anyMsg = new Date('2026-10-06T12:00:00Z');
    expect(getLastCustomerActivityMs({ last_customer_message_at: cust, last_message_at: anyMsg }))
      .toBe(cust.getTime());
  });

  it('fallback ke last_message_at bila kolom customer kosong (data lawas)', () => {
    const anyMsg = new Date('2026-10-04T08:00:00Z');
    expect(getLastCustomerActivityMs({ last_customer_message_at: null, last_message_at: anyMsg }))
      .toBe(anyMsg.getTime());
  });

  it('menerima string ISO (payload JSON dari DB)', () => {
    expect(getLastCustomerActivityMs({ last_customer_message_at: '2026-10-05T10:00:00.000Z', last_message_at: null }))
      .toBe(new Date('2026-10-05T10:00:00.000Z').getTime());
  });

  it('mengembalikan 0 bila keduanya kosong', () => {
    expect(getLastCustomerActivityMs({ last_customer_message_at: null, last_message_at: null })).toBe(0);
    expect(getLastCustomerActivityMs({})).toBe(0);
  });

  it('tidak pernah mengembalikan NaN untuk objek kosong / undefined', () => {
    expect(getLastCustomerActivityMs(undefined as any)).toBe(0);
  });

  it('memprioritaskan customer meski nilai bot lebih baru (anti pesan bot menghidupkan chat tidur)', () => {
    const cust = new Date('2026-09-01T00:00:00Z');
    const botFollowUp = new Date('2026-10-06T15:00:00Z');
    const got = getLastCustomerActivityMs({ last_customer_message_at: cust, last_message_at: botFollowUp });
    expect(got).toBe(cust.getTime());
    expect(got).not.toBe(botFollowUp.getTime());
  });
});
