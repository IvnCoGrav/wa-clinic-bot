import { describe, it, expect } from 'vitest';
import { OutputSanitizer } from '../../../src/v3/guardrails/sanitizer';
import { getMaxCharsPerReply } from '../../../src/config/persona';

/**
 * Regresi adversarial sesi 381894 (anti-mutilasi semantik sanitizer):
 * LLM menghasilkan 1006/837 chars utuh, sanitizer lama (500) memenggal di
 * index 212/390 dan meninggalkan header menggantung "...untuk si kecil:".
 */
const KATALOG_TURN_3 =
  'Area Surabaya cukup luas ya Bunda, jadi kalau boleh tahu rumah Bunda di kelurahan atau perumahan mana? Biar kami bisa bantu cekkan jarak dan ongkir.\n\n' +
  'Untuk treatment, ada beberapa pilihan menarik untuk si kecil: \n\n' +
  '1. *Pijat Bayi Ceria Newborn* — Pijat relaksasi untuk membantu tidur lebih nyenyak, meredakan kelelahan, dan membuat tubuh lebih rileks (Promo *Rp 60.000*, normal *Rp 80.000*).\n   \n' +
  '2. *Pijat Bayi Ceria (Rileksasi)* — Pijat relaksasi untuk bayi aktif merangkak/berjalan agar tidur nyenyak dan meredakan pegal (Promo *Rp 70.000*, normal *Rp 80.000*).\n\n' +
  '3. *Pijat Bayi Pulih Ceria (Terapi Bapil/Kembung)* — Terapi khusus untuk batuk, pilek, flu, atau kembung dengan aromaterapi & akupresur (Promo *Rp 75.000*, normal *Rp 100.000*).\n\n' +
  '4. *Pijat Lahap Juara (< 2 thn)* — Pijat stimulasi pencernaan untuk membantu meningkatkan nafsu makan si kecil (Promo *Rp 75.000*, normal *Rp 100.000*).\n\n' +
  'Apakah saat ini si kecil ada keluhan seperti batuk, pilek, atau kembung, Bunda? Atau ingin pijat sehat relaksasi saja? 🤗';

describe('Sanitizer anti-mutilasi katalog (sesi 381894)', () => {
  it('katalog 4 paket (~1000 chars) utuh pada plafon default/katalog', () => {
    expect(KATALOG_TURN_3.length).toBeGreaterThan(900);
    // Default umum 1200: utuh tanpa potong.
    expect(OutputSanitizer.truncateToMaxChars(KATALOG_TURN_3).length).toBe(KATALOG_TURN_3.length);
    const viaPipeline = OutputSanitizer.cleanOutboundReply(KATALOG_TURN_3, 'biayanya brp? treatment apa saja?', true, {
      tenantId: 'default-tenant',
      isCatalogContext: true,
    });
    // Tetap memuat seluruh paket + pertanyaan penutup (tidak terpenggal).
    expect(viaPipeline).toContain('Pijat Lahap Juara');
    expect(viaPipeline).toContain('Apakah saat ini si kecil ada keluhan');
  });

  it('over-limit TIDAK PERNAH berakhir menggantung di titik dua', () => {
    const filler = 'x '.repeat(900);
    const text = KATALOG_TURN_3 + ' ' + filler;
    const out = OutputSanitizer.truncateToMaxChars(text, 500);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.trimEnd().endsWith(':')).toBe(false);
    expect(/(untuk si kecil)\s*:?\s*$/i.test(out.trimEnd())).toBe(false);
  });

  it('potongan daftar bernomor jatuh di akhir item lengkap, bukan kepala daftar', () => {
    const out = OutputSanitizer.truncateToMaxChars(KATALOG_TURN_3, 500);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.trimEnd().endsWith(':')).toBe(false);
    // Item lengkap terakhir sebelum batas dipertahankan (item 1 Newborn utuh
    // hingga titik penutupnya — bukan mundur ke pra-header, bukan gantung di ':').
    expect(out).toContain('Pijat Bayi Ceria Newborn');
    expect(out.trimEnd().endsWith('.')).toBe(true);
    expect(out.length).toBeGreaterThan(250);
  });

  it('blank-line ber-spasi "\\n   \\n" dinormalisasi sebelum hitung batas', () => {
    const withIndent = 'Paragraf pembuka yang cukup panjang agar melewati seratus karakter batas minimal pemotongan paragraf ya Bunda 😊\n   \nIsi lanjutan yang tidak boleh bocor ke hasil potong. ' + 'y '.repeat(600);
    const out = OutputSanitizer.truncateToMaxChars(withIndent, 300);
    expect(out).not.toContain('Isi lanjutan');
    expect(out.length).toBeLessThanOrEqual(300);
  });

  it('resolusi plafon tenant-aware: eksplisit > DB > default 1200/1500', () => {
    expect(OutputSanitizer.DEFAULT_MAX_CHARS).toBe(1200);
    expect(OutputSanitizer.CATALOG_MAX_CHARS).toBe(1500);
    expect(OutputSanitizer.resolveMaxChars(undefined)).toBe(1200);
    expect(OutputSanitizer.resolveMaxChars({ isCatalogContext: true })).toBe(1500);
    expect(OutputSanitizer.resolveMaxChars(700)).toBe(700);
    expect(OutputSanitizer.resolveMaxChars({ maxChars: 700, isCatalogContext: true })).toBe(700);
    // DB offline (mock menolak) → getMaxCharsPerReply null → jatuh ke default, tanpa crash.
    expect(getMaxCharsPerReply('tenant-tak-ada-381894')).toBeNull();
    expect(OutputSanitizer.resolveMaxChars({ tenantId: 'tenant-tak-ada-381894' })).toBe(1200);
    expect(OutputSanitizer.resolveMaxChars({ tenantId: 'tenant-tak-ada-381894', isCatalogContext: true })).toBe(1500);
  });
});
