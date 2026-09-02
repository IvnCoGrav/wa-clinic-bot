import { describe, it, expect } from 'vitest';
import { isReservationFormMessage, parseReservationText } from '../../src/utils/reservation-text-parser';

describe('Phase 5: Hybrid Free-form Reservation Parser & State Recovery', () => {
  describe('Task 5.1: Structured Colon Form Parsing', () => {
    const structuredForm = `Berikut list untuk reservasi : 
Nama Bunda : Siska
Alamat & Shareloc : Jl. Rungkut Asri Timur No. 15
Kec : Rungkut
Kota : Surabaya
No. Hp : 08123456789

Pilihan treatment (Baby & Kids)

Nama Bayi : Kenzo
Usia Bayi/Anak : 8 bulan
Treatment : Pijat Bayi Ceria`;

    it('should identify structured form message', () => {
      expect(isReservationFormMessage(structuredForm)).toBe(true);
    });

    it('should parse structured reservation form accurately', () => {
      const result = parseReservationText(structuredForm);
      expect(result.success).toBe(true);
      expect(result.reservation?.name).toBe('Siska');
      expect(result.reservation?.address).toContain('Rungkut Asri');
      expect(result.reservation?.kec).toBe('Rungkut');
      expect(result.reservation?.babies[0].name).toBe('Kenzo');
      expect(result.reservation?.babies[0].age).toBe('8 bulan');
    });
  });

  describe('Task 5.2: Free-form Conversational Paragraph Reservation Parsing', () => {
    const freeFormMsg1 = 'Mau booking buat anak saya Raffa usia 1 tahun, alamat Wisma Lidah Kulon Blok A no 12, besok rabu jam 10 ya bund';

    it('should recognize conversational booking message', () => {
      expect(isReservationFormMessage(freeFormMsg1)).toBe(true);
    });

    it('should extract entities from free-form conversational text (Name, Age, Address, Date)', () => {
      const result = parseReservationText(freeFormMsg1);
      expect(result.success).toBe(true);
      expect(result.reservation?.name).toBe('Raffa');
      expect(result.reservation?.address).toContain('Wisma Lidah Kulon');
      expect(result.reservation?.babies[0]?.name).toBe('Raffa');
      expect(result.reservation?.babies[0]?.age).toContain('1 tahun');
      expect(result.reservation?.treatmentDetail).toMatch(/Baby:|Pijat/);
    });

    const freeFormMsg2 = 'Pesan paket newborn untuk anak saya Arkana 2 bulan, alamat di Sedati Agung gang 3, hari Sabtu';

    it('should extract entities from newborn free-form booking', () => {
      const result = parseReservationText(freeFormMsg2);
      expect(result.success).toBe(true);
      expect(result.reservation?.name).toBe('Arkana');
      expect(result.reservation?.address).toContain('Sedati Agung');
      expect(result.reservation?.babies[0]?.age).toContain('2 bulan');
    });
  });

  describe('Task 5.3: Incomplete Free-form Messages Handled Gracefully', () => {
    it('should fail with missingFields when address is not provided', () => {
      const incomplete = 'Mau booking pijat bayi buat anak saya Kenzo 5 bulan';
      const result = parseReservationText(incomplete);
      expect(result.success).toBe(false);
      expect(result.missingFields).toContain('Alamat');
    });
  });
});
