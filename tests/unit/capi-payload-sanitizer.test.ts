import { describe, it, expect } from 'vitest';
import { parseReservationText, isPlaceholderText } from '../../src/utils/reservation-text-parser';
import { cleanTreatmentList, isPlaceholderTreatment } from '../../packages/admin-dashboard/src/pages/tenant/MetaCapiQueue';

describe('CAPI Payload & Reservation Form Sanitizer', () => {
  it('should identify template placeholder phrases correctly with isPlaceholderText', () => {
    expect(isPlaceholderText('(Mohon bisa diisi Bunda 😊)')).toBe(true);
    expect(isPlaceholderText('Mohon bisa diisi Bunda')).toBe(true);
    expect(isPlaceholderText('(Jika hamil)')).toBe(true);
    expect(isPlaceholderText('(Jika ada)')).toBe(true);
    expect(isPlaceholderText('(Opsional)')).toBe(true);
    expect(isPlaceholderText('tidak ada')).toBe(true);
    expect(isPlaceholderText('tdk ada')).toBe(true);
    expect(isPlaceholderText('-')).toBe(true);
    expect(isPlaceholderText('')).toBe(true);
    expect(isPlaceholderText(null)).toBe(true);

    // Real treatment names should not be placeholder
    expect(isPlaceholderText('Pijat Bayi Ceria')).toBe(false);
    expect(isPlaceholderText('Pijat Hamil Relaxing')).toBe(false);
    expect(isPlaceholderText('Breast & Oksitosin Massage')).toBe(false);
  });

  it('should parse form with unfilled Moms template placeholder without creating fake Moms treatment', () => {
    const rawForm = `
*List untuk reservasi :*
Nama Bunda : (Mohon bisa diisi Bunda 😊)
No Hp : 089675128793
Alamat & Shareloc : Jl. Pagesangan Indah No. 12
Kec : Pagesangan
Kota : Surabaya
Hari & Tanggal : Sabtu, 22 Agustus 2026

*Pilihan treatment (Baby & kids) :*
Nama Bayi : Hasbi
Usia Bayi/Anak : 2 bulan
Treatment : Pijat Bayi Ceria

*Pilihan treatment (Moms & Nifas) :*
Usia Kehamilan (Jika hamil) : (Mohon bisa diisi Bunda 😊)
Treatment : (Mohon bisa diisi Bunda 😊)
`;

    const result = parseReservationText(rawForm);
    expect(result.success).toBe(true);
    expect(result.reservation).toBeDefined();

    // Nama Bunda kosong tapi nama bayi ada -> nama customer jadi Hasbi
    expect(result.reservation?.name).toBe('Hasbi');
    expect(result.reservation?.treatmentCategory).toBe('BABY');
    expect(result.reservation?.treatmentDetail).toContain('Pijat Bayi Ceria');
    // Moms treatment should NOT exist
    expect(result.reservation?.treatmentDetail).not.toContain('Mohon bisa diisi');
    expect(result.reservation?.treatmentDetail).not.toContain('Moms:');
  });

  it('should clean treatment list in dashboard and exclude placeholder texts', () => {
    const detailWithPlaceholder = 'Baby: Pijat Bayi Ceria (Bayi: Hasbi, Usia: 2 bulan) | Moms: Mohon bisa diisi Bunda 😊 (Kehamilan: -)';
    const cleaned = cleanTreatmentList(detailWithPlaceholder);

    expect(cleaned).toEqual(['Pijat Bayi Ceria']);
    expect(cleaned).not.toContain('Mohon Bisa Diisi Bunda 😊');
    expect(cleaned.length).toBe(1);
  });

  it('should correctly handle multi-treatment lists without placeholders', () => {
    const detailBoth = 'Baby: Pijat Bayi Ceria (Bayi: Hasbi, Usia: 2bln) | Moms: Breast & Oksitosin Massage (Kehamilan: -)';
    const cleaned = cleanTreatmentList(detailBoth);

    expect(cleaned).toEqual(['Pijat Bayi Ceria', 'Breast & Oksitosin Massage']);
    expect(cleaned.length).toBe(2);
  });
});
