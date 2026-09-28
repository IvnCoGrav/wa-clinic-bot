/**
 * reservation-date-mismatch-note.test.ts — 152c (catatan staf tanggal tak sinkron).
 *
 * Kontrak: form reservasi dengan nama hari BERTENTANGAN dengan tanggal numerik
 * (mis. "jumat 28 Juli 2026" padahal 28 Juli 2026 = Selasa) tetap disimpan,
 * TETAPI parser menandai `dateMismatch` + `writtenDay`/`actualDay` agar
 * `machine.ts` menyertakan CATATAN PERINGATAN ke staf. Slip ±1 hari (typo umum)
 * sudah diselaraskan parser → BUKAN mismatch.
 *
 * Prinsip Adversarial (MANDATORY): hari konsisten, slip ±1, tanpa nama hari,
 * dan kontradiksi berat — bukan hanya satu kalimat verbatim.
 */
import { describe, it, expect } from 'vitest';
import { parseReservationText } from '../../../src/utils/reservation-text-parser';

function form(dateLine: string): string {
  return [
    'Berikut list untuk reservasi :',
    '',
    `Hari dan tanggal : ${dateLine}`,
    'Nama Bunda: Yosefin',
    'Alamat & Shareloc : alana, Tambakoso',
    'Kec : Waru',
    'Kota : Kabupaten Sidoarjo',
    '',
    'Pilihan treatment (bayi & Kids)',
    '',
    'Nama Bayi : Annabeth',
    'Usia Bayi/Anak : 1 bulan',
    'Treatment : pijat bayi ceria',
  ].join('\n');
}

describe('152c — deteksi hari vs tanggal tidak sinkron', () => {
  it('kontradiksi berat ("jumat 28 Juli 2026" = Selasa) → dateMismatch true', () => {
    const r = parseReservationText(form('jumat 28 Juli 2026'));
    expect(r.success).toBe(true);
    expect(r.reservation?.dateMismatch).toBe(true);
    expect(r.reservation?.writtenDay).toBe('jumat');
    expect(r.reservation?.actualDay).toBe('selasa');
  });

  it('hari KONSISTEN ("selasa 28 Juli 2026") → bukan mismatch', () => {
    const r = parseReservationText(form('selasa 28 Juli 2026'));
    expect(r.reservation?.dateMismatch).toBe(false);
  });

  it('slip ±1 hari ("senin 28 Juli 2026") diselaraskan parser → bukan mismatch', () => {
    // 28 Juli 2026 = Selasa; "senin" (1 hari sebelum) = typo umum → snap, bukan mismatch.
    const r = parseReservationText(form('senin 28 Juli 2026'));
    expect(r.reservation?.dateMismatch).toBe(false);
  });

  it('tanpa nama hari → bukan mismatch', () => {
    const r = parseReservationText(form('28 Juli 2026'));
    expect(r.reservation?.dateMismatch).toBe(false);
  });

  it('tanggal konsisten lain ("rabu 1 Juli 2026") → bukan mismatch', () => {
    const r = parseReservationText(form('rabu 1 Juli 2026'));
    expect(r.reservation?.dateMismatch).toBe(false);
  });
});
