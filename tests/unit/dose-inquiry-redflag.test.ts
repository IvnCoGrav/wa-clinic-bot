/**
 * dose-inquiry-redflag.test.ts — Red-flag pertanyaan dosis obat/vitamin (RF-08).
 *
 * Konteks: "Boleh gak kasih obat batuk buat bayi 3 bulan? Sehari berapa sendok?"
 * adalah pertanyaan dosis obat kimia untuk bayi. Bot menjawab benar (menolak +
 * rujuk dokter), tetapi gate medis deterministik TIDAK mengenalinya sehingga
 * tidak dieskalasi ke HUMAN_HANDLING (kontrak Tier5 red-flag).
 *
 * Perbaikan fondasional: detektor KOMPOSIT order-independent (mengikuti keluarga
 * detectNeonatalFeverEmergency / detectPersistentCoughRashEmergency) — konjungsi
 * "konteks obat" × "satuan/penanda dosis", BUKAN regex adjacency fixed-order
 * hafalan kalimat. Pengecualian konteks masak (resep/sendok makan) menutup
 * false-positive.
 *
 * Prinsip Adversarial (MANDATORY): parafrase nyata, negatif batas, typo ringan.
 */
import { describe, it, expect } from 'vitest';
import { detectDoseInquiryConcern } from '../../src/config/medical-keywords';
import { MedicalDetectionService } from '../../src/services/medical-detection.service';

describe('detectDoseInquiryConcern — komposit konteks-obat × dosis (RF-08)', () => {
  it('RF-08 verbatim: obat batuk bayi 3 bulan + "sehari berapa sendok" = concern', () => {
    const r = detectDoseInquiryConcern('Boleh gak kasih obat batuk buat bayi 3 bulan? Sehari berapa sendok?');
    expect(r.isConcern).toBe(true);
  });

  it('adversarial parafrase dosis (urutan & gaya beragam) = concern', () => {
    const variants = [
      'Terus vitamin C buat dia dosisnya berapa?',
      'paracetamol bayi 5 bulan berapa ml ya bu?',
      'berapa tetes vitamin D untuk newborn?',
      'obat demam anak 1 tahun berapa mg?',
      'takaran obat cacing buat anak 2 tahun berapa?',
      'minum obat batuknya sehari berapa kali ya',
      'sirup paracetamol buat adek 8 bulan, dosisnya?',
      'vitamin drops nya berapa tetes sehari',
    ];
    for (const t of variants) {
      expect(detectDoseInquiryConcern(t).isConcern, `text="${t}"`).toBe(true);
    }
  });

  it('negatif batas: konteks masak / tanpa konteks obat = BUKAN concern', () => {
    const negatives = [
      'resep masakan rendang berapa sendok makan?',
      'berapa sendok makan nasi untuk bayi 1 tahun',
      'vitamin C untuk ibunya berapa harganya?',
      'obat batuk alami gimana ya bun?',
      'harga obat batuk di apotek berapa?',
      'berapa lama efek obat batuk?',
      'saya masak pakai sendok makan biasa',
      'obat batuk untuk anak ada di pricelist?',
    ];
    for (const t of negatives) {
      expect(detectDoseInquiryConcern(t).isConcern, `text="${t}"`).toBe(false);
    }
  });

  it('MedicalDetectionService: pertanyaan dosis menjadi isMedical=true (bukan NONE)', () => {
    const r = MedicalDetectionService.detectMedicalConcern(
      'Terus vitamin C buat dia dosisnya berapa?',
      ['Boleh gak kasih obat batuk buat bayi 3 bulan? Sehari berapa sendok?']
    );
    expect(r.isMedical).toBe(true);
    expect(r.severity).not.toBe('NONE');
  });

  it('MedicalDetectionService: teks non-medis tetap NONE (anti-regresi)', () => {
    const r = MedicalDetectionService.detectMedicalConcern('pijat bayi ceria berapa harganya?');
    expect(r.isMedical).toBe(false);
    expect(r.severity).toBe('NONE');
  });
});
