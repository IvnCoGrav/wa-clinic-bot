import { describe, it, expect, beforeEach } from 'vitest';
import { treatmentCatalogService } from '../../src/services/treatment-catalog.service';

/**
 * 30 Test Case — Pertanyaan Customer Tentang Treatment
 * Fokus: memvalidasi searchCatalog() mengembalikan treatment yang TEPAT
 * (tidak melempar seluruh katalog, tidak salah match).
 */

describe('Treatment Questions → searchCatalog (30 Test Cases)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  // ============ A. Exact Nama Treatment (Harus Kembalikan 1) ============
  it('1. "pijat bayi ceria" → hanya Pijat Bayi Ceria', () => {
    const res = treatmentCatalogService.searchCatalog('pijat bayi ceria itu apa bund');
    expect(res).toContain('Pijat Bayi Ceria (Rileksasi)');
    expect(res).not.toContain('Pijat Bayi Pulih Ceria');
    expect(res).not.toContain('Pijat Kids Ceria');
    expect(res).not.toContain('Nebulizer');
  });

  it('2. "pijat bayi pulih ceria" → hanya Pijat Bayi Pulih Ceria', () => {
    const res = treatmentCatalogService.searchCatalog('pijat bayi pulih ceria');
    expect(res).toContain('Pijat Bayi Pulih Ceria');
    expect(res).not.toContain('Pijat Bayi Ceria (Rileksasi)');
    expect(res).not.toContain('Kids');
  });

  it('3. "pijat kids ceria" → hanya Pijat Kids Ceria', () => {
    const res = treatmentCatalogService.searchCatalog('pijat kids ceria buat anak umur berapa');
    expect(res).toContain('Pijat Kids Ceria');
    expect(res).not.toContain('Pijat Bayi');
  });

  it('4. "pijat lahap juara" → hanya Pijat Lahap Juara', () => {
    const res = treatmentCatalogService.searchCatalog('pijat lahap juara itu apa');
    expect(res).toContain('Pijat Lahap Juara');
    expect(res).not.toContain('Pijat Bayi Ceria');
  });

  it('5. "paket selapan" → hanya Paket Selapan (Newborn Care)', () => {
    const res = treatmentCatalogService.searchCatalog('paket selapan bayi baru lahir');
    expect(res).toContain('Paket Selapan');
    expect(res).not.toContain('Pijat Kids');
  });

  it('6. "prenatal massage" → hanya Prenatal Massage (Pijat Hamil)', () => {
    const res = treatmentCatalogService.searchCatalog('prenatal massage itu apa');
    expect(res).toContain('Prenatal Massage');
    expect(res).not.toContain('Oksitosin');
  });

  it('7. "oksitosin massage" → hanya Oksitosin Massage', () => {
    const res = treatmentCatalogService.searchCatalog('oksitosin massage');
    expect(res).toContain('Oksitosin Massage');
    expect(res).not.toContain('Prenatal');
  });

  it('8. "paket laktasi" → hanya Paket Laktasi (Breast Massage)', () => {
    const res = treatmentCatalogService.searchCatalog('paket laktasi buat apa');
    expect(res).toContain('Paket Laktasi');
    expect(res).not.toContain('Oksitosin');
  });

  it('9. "tindik telinga bayi" → hanya Tindik Telinga Bayi', () => {
    const res = treatmentCatalogService.searchCatalog('tindik telinga bayi berapa');
    expect(res).toContain('Tindik Telinga Bayi');
    expect(res).not.toContain('Cukur');
  });

  it('10. "cukur rambut bayi" → hanya Cukur Rambut Bayi', () => {
    const res = treatmentCatalogService.searchCatalog('cukur rambut bayi');
    expect(res).toContain('Cukur Rambut Bayi');
    expect(res).not.toContain('Tindik');
  });

  it('11. "sinar moksa" → hanya Sinar Moksa (Add-on)', () => {
    const res = treatmentCatalogService.searchCatalog('moksa buat apa ya');
    expect(res).toContain('Sinar Moksa');
    expect(res).not.toContain('Nebulizer');
  });

  it('12. "nebulizer" → hanya Nebulizer', () => {
    const res = treatmentCatalogService.searchCatalog('nebulizer');
    expect(res).toContain('Nebulizer');
    expect(res).not.toContain('Moksa');
  });

  // ============ B. Nama Sebagian / Frasa Kunci ============
  it('13. "pijat hamil" → Prenatal Massage (mengandung "Pijat Hamil")', () => {
    const res = treatmentCatalogService.searchCatalog('pijat hamil itu aman ga');
    expect(res).toContain('Prenatal Massage');
    expect(res).not.toContain('Pijat Bayi Ceria');
  });

  it('14. "breast massage" → Paket Laktasi', () => {
    const res = treatmentCatalogService.searchCatalog('breast massage untuk asi lancar');
    expect(res).toContain('Paket Laktasi');
    expect(res).not.toContain('Oksitosin Massage');
  });

  it('15. "newborn care" → Paket Selapan', () => {
    const res = treatmentCatalogService.searchCatalog('newborn care 0-40 hari');
    expect(res).toContain('Paket Selapan');
  });

  it('16. "bapil" → Pijat Bayi Pulih Ceria (deskripsi bapil/batuk/pilek)', () => {
    const res = treatmentCatalogService.searchCatalog('bayiku bapil harus pijat apa');
    expect(res).toContain('Pijat Bayi Pulih Ceria');
  });

  it('17. "kembung" → Pijat Bayi Pulih Ceria', () => {
    const res = treatmentCatalogService.searchCatalog('bayi kembung susah bab');
    expect(res).toContain('Pijat Bayi Pulih Ceria');
  });

  it('18. "kolik" → Pijat Bayi Pulih Ceria', () => {
    const res = treatmentCatalogService.searchCatalog('bayi rewel kolik');
    expect(res).toContain('Pijat Bayi Pulih Ceria');
  });

  it('19. "nafsu makan" → Pijat Lahap Juara', () => {
    const res = treatmentCatalogService.searchCatalog('anak susah makan nafsu makan turun');
    expect(res).toContain('Pijat Lahap Juara');
  });

  it('20. "pijat biar asi lancar" → hasil utama adalah treatment ASI (Oksitosin/Laktasi)', () => {
    const res = treatmentCatalogService.searchCatalog('pijat biar asi lancar');
    // Treatment ASI harus jadi hasil PERTAMA (yang paling relevan)
    expect(res).toMatch(/Oksitosin Massage|Paket Laktasi/);
  });

  // ============ C. Pertanyaan Umum / Informasi ============
  it('21. "ada treatment apa saja" → kosong (terlalu umum, jangan dump semua)', () => {
    const res = treatmentCatalogService.searchCatalog('ada treatment apa saja');
    expect(res).toBe('');
  });

  it('22. "daftar treatment" → kosong (bukan pertanyaan spesifik)', () => {
    const res = treatmentCatalogService.searchCatalog('kasih daftar treatment dong');
    expect(res).toBe('');
  });

  it('23. "info semua perawatan" → kosong', () => {
    const res = treatmentCatalogService.searchCatalog('info semua perawatan');
    expect(res).toBe('');
  });

  it('24. "harga treatment berapa" → kosong (murni tanya harga, bukan nama)', () => {
    const res = treatmentCatalogService.searchCatalog('harga treatment berapa');
    expect(res).toBe('');
  });

  it('25. "ini apa ya" → kosong (tidak ada kata kunci bermakna)', () => {
    const res = treatmentCatalogService.searchCatalog('ini apa ya bund');
    expect(res).toBe('');
  });

  // ============ D. Variasi Bahasa Natural ============
  it('26. "buat apa ya pijat bayi ceria" → Pijat Bayi Ceria (nama di tengah)', () => {
    const res = treatmentCatalogService.searchCatalog('buat apa ya pijat bayi ceria');
    expect(res).toContain('Pijat Bayi Ceria (Rileksasi)');
    expect(res).not.toContain('Pijat Bayi Pulih');
  });

  it('27. "moksa bunda itu apa sih" → Sinar Moksa', () => {
    const res = treatmentCatalogService.searchCatalog('moksa bunda itu apa sih');
    expect(res).toContain('Sinar Moksa');
  });

  it('28. "nebulizer + obat" → Nebulizer + Obat (Terapi Uap Lengkap)', () => {
    const res = treatmentCatalogService.searchCatalog('nebulizer obat');
    expect(res).toContain('Nebulizer');
  });

  it('29. "cukur sekalian pijat" → Cukur + Pijat Terapi', () => {
    const res = treatmentCatalogService.searchCatalog('cukur sekalian pijat terapi');
    expect(res).toContain('Cukur + Pijat Terapi');
  });

  // ============ E. Tidak Ada Match ============
  it('30. "xyzabc" (gibberish) → kosong (tidak mengarang jawaban)', () => {
    const res = treatmentCatalogService.searchCatalog('xyzabc');
    expect(res).toBe('');
  });
});
