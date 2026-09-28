/**
 * persistent-cough-rash-redflag.test.ts — Red-flag komposit LINTAS-TURN (RF-06).
 *
 * Konteks: RF-06 adalah 2 turn terpisah —
 *   Turn 1: "Anak saya batuk udah 2 minggu gak sembuh-sembuh." (durasi kronis)
 *   Turn 2: "Terus tadi pagi muncul ruam merah kayak campak, demam dikit." (ruam+demam)
 * Detektor per-pesan tunggal TIDAK PERNAH melihat keduanya sekaligus, sehingga
 * gate medis stateless meloloskan kasus campak/TB anak (bug keselamatan).
 *
 * Perbaikan fondasional: detektor komposit sadar-riwayat. Bukan daftar kalimat
 * hafalan — hanya (a) durasi kuantitatif batuk >= 14 hari (parse angka), atau
 * (b) konjungsi batuk + ruam + demam/campak. Order-independent.
 *
 * Prinsip Adversarial (MANDATORY): parafrase nyata, negatif batas, typo ringan —
 * BUKAN hanya meniru kalimat verbatim RF-06.
 */
import { describe, it, expect } from 'vitest';
import { detectPersistentCoughRashEmergency } from '../../src/config/medical-keywords';
import { MedicalDetectionService } from '../../src/services/medical-detection.service';

const TURN1 = 'Anak saya batuk udah 2 minggu gak sembuh-sembuh.';
const TURN2 = 'Terus tadi pagi muncul ruam merah kayak campak, demam dikit.';

describe('detectPersistentCoughRashEmergency — komposit lintas-turn (RF-06)', () => {
  it('RF-06: turn kronis + turn ruam/demam (urutan apa pun) = HIGH', () => {
    const forward = detectPersistentCoughRashEmergency([TURN1, TURN2]);
    const reversed = detectPersistentCoughRashEmergency([TURN2, TURN1]);
    expect(forward.isEmergency).toBe(true);
    expect(forward.severity).toBe('HIGH');
    expect(reversed.isEmergency).toBe(true);
    expect(reversed.severity).toBe('HIGH');
  });

  it('satu teks gabungan kronis + ruam = HIGH', () => {
    const r = detectPersistentCoughRashEmergency(['batuk 2 minggu dan muncul ruam merah']);
    expect(r.isEmergency).toBe(true);
    expect(r.severity).toBe('HIGH');
  });

  it('batuk kronis + demam (tanpa ruam eksplisit) = HIGH', () => {
    const r = detectPersistentCoughRashEmergency(['batuk 3 minggu, anak demam terus']);
    expect(r.isEmergency).toBe(true);
  });

  it('batuk + ruam + takut campak (satu pesan) = HIGH', () => {
    const r = detectPersistentCoughRashEmergency([
      'Bayi saya batuk terus malah muncul bintik merah, takut campak.',
    ]);
    expect(r.isEmergency).toBe(true);
    expect(r.severity).toBe('HIGH');
  });

  it('batas negatif: batuk 3 hari + ruam popok ringan = BUKAN HIGH', () => {
    const r = detectPersistentCoughRashEmergency(['batuk 3 hari', 'ruam popok ringan']);
    expect(r.severity).not.toBe('HIGH');
  });

  it('negatif: ruam/demam tanpa batuk = BUKAN HIGH', () => {
    const r = detectPersistentCoughRashEmergency(['muncul ruam merah dan demam dikit']);
    expect(r.severity).not.toBe('HIGH');
  });

  it('positif SOP: batuk kronis (>=2 minggu) sendirian = HIGH (batuk-persisten-redflag)', () => {
    const r = detectPersistentCoughRashEmergency(['batuk 2 minggu tapi tidak ada ruam']);
    expect(r.isEmergency).toBe(true);
    expect(r.severity).toBe('HIGH');
  });

  it('negatif: batuk akut tanpa gejala penyerta = BUKAN HIGH', () => {
    const r = detectPersistentCoughRashEmergency(['batuk 3 hari saja, anak aktif ceria']);
    expect(r.severity).not.toBe('HIGH');
  });

  it('regresi CM-22: "bayi 3 bulan batuk pilek" = usia, BUKAN batuk kronis', () => {
    const r = detectPersistentCoughRashEmergency(['Anak saya (3 bulan) batuk pilek']);
    expect(r.isEmergency).toBe(false);
  });

  it('regresi: "anak umur 2 bulan batuk" = usia, BUKAN kronis', () => {
    const r = detectPersistentCoughRashEmergency(['anak umur 2 bulan batuk']);
    expect(r.isEmergency).toBe(false);
  });

  it('positif tetap: "batuk 2 minggu" (tanpa penanda usia) = kronis HIGH', () => {
    const r = detectPersistentCoughRashEmergency(['batuk 2 minggu']);
    expect(r.severity).toBe('HIGH');
  });

  it('negatif: "step by step" tidak memicu', () => {
    const r = detectPersistentCoughRashEmergency(['step by step saja bund']);
    expect(r.isEmergency).toBe(false);
  });

  it('input kosong/undefined aman', () => {
    expect(detectPersistentCoughRashEmergency([]).isEmergency).toBe(false);
    expect(detectPersistentCoughRashEmergency(['']).isEmergency).toBe(false);
  });
});

describe('MedicalDetectionService — gate sadar-riwayat (RF-06 end-to-end)', () => {
  it('turn 2 dengan riwayat turn 1 = HIGH (jalur produksi)', () => {
    const r = MedicalDetectionService.detectMedicalConcern(TURN2, [TURN1]);
    expect(r.isMedical).toBe(true);
    expect(r.severity).toBe('HIGH');
  });

  it('tanpa riwayat, turn ruam saja BUKAN HIGH (bukti riwayat load-bearing)', () => {
    const r = MedicalDetectionService.detectMedicalConcern(TURN2);
    expect(r.severity).not.toBe('HIGH');
  });

  it('negatif lintas-turn: batuk 3 hari + ruam popok ringan BUKAN HIGH', () => {
    const r = MedicalDetectionService.detectMedicalConcern('ruam popok ringan', ['batuk 3 hari']);
    expect(r.severity).not.toBe('HIGH');
  });

  it('tidak mengganggu RF-07 neonatus', () => {
    const r = MedicalDetectionService.detectMedicalConcern('Bayi baru lahir umur 10 hari kok demam ya Bun, suhu 38.2.');
    expect(r.severity).toBe('HIGH');
  });

  it('tidak mengganggu non-medis', () => {
    const r = MedicalDetectionService.detectMedicalConcern('halo bu, mau tanya jadwal pijat bayi', []);
    expect(r.isMedical).toBe(false);
    expect(r.severity).toBe('NONE');
  });
});
