import { describe, it, expect } from 'vitest';
import { verifyDayMentioned, isPostpartumStageValid } from '../../../src/v3/tools/save-reservation.tool';

/**
 * Fase 2' — Fail-closed kontrak tool save_reservation (lapis Tool Contract).
 * Pertanyaan ketersediaan slot ("Bisa hari X?", "Tgl 18 bisa?") BUKAN
 * kesepakatan booking final — tanpa daftar frasa tanya baru, hanya memakai
 * tanda baca "?" + status evidence per-pesan ( Toehold: bukti hari yang
 * seluruhnya berasal dari kalimat tanya = belum sepakat ).
 */
describe('Day gate fail-closed: pertanyaan slot vs kesepakatan (Fase 2)', () => {
  it('MENOLAK bila bukti hari hanya dari kalimat tanya slot (Turn 7)', () => {
    const err = verifyDayMentioned('Selasa, 18 Agustus 2026', [
      'Saya mau janjian pijat balita usia 2 tahun',
      'Bisa hari selasa depan? Tgl 18 agustus?',
    ]);
    expect(err).not.toBeNull();
    expect(err as string).toMatch(/pengecekan ketersediaan/i);
  });

  it('MENOLAK pola "oke" setelah pertanyaan slot (ack tanpa bukti non-tanya)', () => {
    const err = verifyDayMentioned('Selasa, 18 Agustus 2026', [
      'Bisa hari selasa depan? Tgl 18 agustus?',
      'oke',
    ]);
    expect(err).not.toBeNull();
  });

  it('MELOLOSKAN pernyataan tegas tanpa tanda tanya', () => {
    expect(verifyDayMentioned('hari selasa', ['Baik saya ambil hari selasa'])).toBeNull();
    expect(verifyDayMentioned('Selasa, 18 Agustus 2026', ['Jadi tanggal 18 agustus ya'])).toBeNull();
  });

  it('MELOLOSKAN bila ada satu saja bukti non-tanya di samping pertanyaan', () => {
    expect(
      verifyDayMentioned('hari sabtu', ['Bisa hari sabtu?', 'Ya jadi sabtu ya'])
    ).toBeNull();
  });

  it('kompatibilitas: tanpa evidence gate lewat (pemanggilan langsung/test)', () => {
    expect(verifyDayMentioned('hari sabtu', [])).toBeNull();
    expect(verifyDayMentioned('hari sabtu', undefined)).toBeNull();
  });
});

describe('Guard medis momStage POSTPARTUM (Fase 2)', () => {
  it('balita 24 bulan BUKAN nifas → invalid', () => {
    expect(isPostpartumStageValid(24)).toBe(false);
  });

  it('bayi baru lahir (0-2 bulan) → valid', () => {
    expect(isPostpartumStageValid(0)).toBe(true);
    expect(isPostpartumStageValid(1)).toBe(true);
    expect(isPostpartumStageValid(2)).toBe(true);
  });

  it('usia tak diketahui → lolos (jangan tolak, cukup grounding)', () => {
    expect(isPostpartumStageValid(null)).toBe(true);
    expect(isPostpartumStageValid(undefined)).toBe(true);
  });
});
