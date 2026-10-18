import { describe, it, expect } from 'vitest';
import { splitImageCaption } from '../../src/services/caption-splitter';

describe('Smart Caption Splitter (caption-splitter.ts)', () => {
  it('handles empty or null text gracefully', () => {
    expect(splitImageCaption(undefined)).toEqual({ imageCaption: undefined, followUpTexts: [] });
    expect(splitImageCaption(null)).toEqual({ imageCaption: undefined, followUpTexts: [] });
    expect(splitImageCaption('')).toEqual({ imageCaption: undefined, followUpTexts: [] });
    expect(splitImageCaption('   ')).toEqual({ imageCaption: undefined, followUpTexts: [] });
  });

  it('keeps caption intact when text length <= threshold (1000 chars)', () => {
    const text = 'Berikut barcode QRIS resmi klinik kami ya Bunda. Terima kasih banyak 🙏';
    const result = splitImageCaption(text, 1000);
    expect(result.imageCaption).toBe(text);
    expect(result.followUpTexts).toHaveLength(0);

    const exact1000 = 'A'.repeat(1000);
    const result1000 = splitImageCaption(exact1000, 1000);
    expect(result1000.imageCaption).toBe(exact1000);
    expect(result1000.followUpTexts).toHaveLength(0);
  });

  it('splits long text (>1000 chars, e.g. 1400 chars) into imageCaption and followUpTexts at paragraph boundary', () => {
    const part1 = 'Halo Bunda Retno! Berikut rincian pembayaran layanan homecare klinik Kala Moms & Baby Spa.\n\n' + 'Rincian Treatment: Paket Pulih Ceria + Pijat Bayi Sehat.\n'.repeat(20);
    const part2 = '\n\n🏦 *Daftar Rekening Resmi:*\n• BCA: 1234567890 a.n Kala\n• Mandiri: 9876543210 a.n Kala\n\nMohon transfer sesuai nominal ya Bunda.';
    const fullText = part1 + part2;
    expect(fullText.length).toBeGreaterThan(1000);

    const result = splitImageCaption(fullText, 1000);
    expect(result.imageCaption).toBeDefined();
    expect(result.imageCaption!.length).toBeLessThanOrEqual(1000);
    expect(result.followUpTexts.length).toBeGreaterThanOrEqual(1);

    // Pastikan konten part 2 masuk ke followUpTexts
    const combinedFollowUp = result.followUpTexts.join('\n\n');
    expect(combinedFollowUp).toContain('Daftar Rekening Resmi');
    expect(combinedFollowUp).toContain('1234567890');
  });

  it('handles long continuous text without newlines by cutting at word space or threshold', () => {
    const longWords = 'Kata '.repeat(300); // ~1500 chars
    const result = splitImageCaption(longWords, 1000);
    expect(result.imageCaption!.length).toBeLessThanOrEqual(1000);
    expect(result.followUpTexts.length).toBeGreaterThanOrEqual(1);
    expect(result.imageCaption!.length + result.followUpTexts[0].length).toBeGreaterThanOrEqual(1400);
  });
});
