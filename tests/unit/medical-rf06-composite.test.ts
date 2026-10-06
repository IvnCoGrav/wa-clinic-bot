import { describe, it, expect } from 'vitest';
import { MedicalDetectionService } from '../../src/services/medical-detection.service';
import { detectPersistentCoughRashEmergency } from '../../src/config/medical-keywords';

/**
 * Regresi RF-06 — red-flag KOMPOSIT batuk-ruam-demam lintas turn.
 *
 * Konteks (audit harness T1): RF-06 ("batuk 2 minggu" + "ruam merah kayak
 * campak + demam") tampak "tidak dieskalasi" saat dijalankan harness offline.
 * Investigasi membuktikan detektor bekerja BENAR bila riwayat lintas-turn
 * tersedia; kegagalan hanya muncul saat riwayat KOSONG (mis. DB offline →
 * `getRecentMessages` kosong). Test ini mengunci perilaku benar + batasannya.
 */
describe('MedicalDetectionService — red-flag komposit RF-06', () => {
  const t1 = 'Anak saya batuk udah 2 minggu gak sembuh-sembuh.';
  const t2 = 'Terus tadi pagi muncul ruam merah kayak campak, demam dikit.';

  it('dengan riwayat lintas-turn → HIGH (batuk kronis + ruam + demam)', () => {
    const r = MedicalDetectionService.detectMedicalConcern(t2, [t1]);
    expect(r.severity).toBe('HIGH');
    expect(r.detectedSymptoms.join(' ')).toMatch(/batuk|ruam|demam/i);
  });

  it('detektor komposit order-independent (urutan teks dibalik tetap HIGH)', () => {
    const r = detectPersistentCoughRashEmergency([t2, t1]);
    expect(r.isEmergency).toBe(true);
    expect(r.severity).toBe('HIGH');
  });

  it('batuk akut jinak tanpa ruam/demam → BUKAN emergency (anti false-positive)', () => {
    const r = detectPersistentCoughRashEmergency(['Bayi 3 bulan batuk pilek sejak kemarin.']);
    expect(r.isEmergency).toBe(false);
  });

  it('ruam jinak (popok) dinetralkan → tidak memicu (batuk akut)', () => {
    const r = detectPersistentCoughRashEmergency(['Batuk kemarin, ruam popok kemerahan.']);
    expect(r.isEmergency).toBe(false);
  });

  it('batuk kronis >=14 hari SENDIRI saja → memicu (red-flag durasi)', () => {
    const r = detectPersistentCoughRashEmergency(['Batuk udah 2 minggu belum sembuh.']);
    expect(r.isEmergency).toBe(true);
  });

  it('FIX-2 imbuhan "batuknya" dikenali (sebelumnya meleset kata-utuh)', () => {
    const r = detectPersistentCoughRashEmergency(['Batuknya udah 2 minggu belum sembuh.']);
    expect(r.isEmergency).toBe(true);
  });

  it('FIX-3 "anak batuk 2 minggu" → DURASI, bukan usia anak (tidak disaring)', () => {
    const r = detectPersistentCoughRashEmergency(['Anak batuk udah 2 minggu belum sembuh.']);
    expect(r.isEmergency).toBe(true);
  });

  it('GUARD tetap: "bayi 3 bulan batuk pilek" → 3 bulan = USIA, bukan kronis', () => {
    const r = detectPersistentCoughRashEmergency(['Bayi 3 bulan batuk pilek.']);
    expect(r.isEmergency).toBe(false);
  });

  it('GUARD tetap: "bayi saya 3 bulan batuk" → usia disaring, bukan kronis', () => {
    const r = detectPersistentCoughRashEmergency(['Bayi saya 3 bulan batuk pilek.']);
    expect(r.isEmergency).toBe(false);
  });

  it('BATASAN diketahui: tanpa riwayat, sinyal terbagi turn → NONE (butuh history non-kosong)', () => {
    // Mendokumentasikan bahwa jaring keselamatan komposit bergantung pada riwayat.
    const r = MedicalDetectionService.detectMedicalConcern(t2, []);
    expect(r.severity).toBe('NONE');
  });
});
