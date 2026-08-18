import { describe, it, expect } from 'vitest';
import {
  parseCurrencyValue,
  parsePaymentSection,
  parseIndonesianDate,
  extractTransactionsFromTranscript,
} from '../../src/utils/conversation-transaction-extractor';

describe('Conversation Transaction Extractor Unit Tests', () => {
  describe('1. parseCurrencyValue Normalizer', () => {
    it('should parse standard formatted numbers with dots', () => {
      expect(parseCurrencyValue('130.000')).toBe(130000);
      expect(parseCurrencyValue('145.000')).toBe(145000);
      expect(parseCurrencyValue('60.000')).toBe(60000);
    });

    it('should convert shorthand "rb" and "k" to thousands', () => {
      expect(parseCurrencyValue('70rb')).toBe(70000);
      expect(parseCurrencyValue('25rb')).toBe(25000);
      expect(parseCurrencyValue('15k')).toBe(15000);
      expect(parseCurrencyValue('95 rb')).toBe(95000);
    });

    it('should multiply isolated numbers <= 500 by 1000', () => {
      expect(parseCurrencyValue('70')).toBe(70000);
      expect(parseCurrencyValue('95')).toBe(95000);
      expect(parseCurrencyValue('105')).toBe(105000);
      expect(parseCurrencyValue('145')).toBe(145000);
    });

    it('should handle zero or invalid gracefully', () => {
      expect(parseCurrencyValue('')).toBe(0);
      expect(parseCurrencyValue(null)).toBe(0);
      expect(parseCurrencyValue('-')).toBe(0);
    });
  });

  describe('2. parsePaymentSection Formats', () => {
    it('should parse Standard Line-by-Line format', () => {
      const text = `
Payment : 
Treatment = 130.000 
Ongkir 12km = 25.000
Promo ongkir = -10.000
*Total = 145.000*
      `;
      const res = parsePaymentSection(text);
      expect(res.treatmentPrice).toBe(130000);
      expect(res.ongkir).toBe(25000);
      expect(res.promo).toBe(10000);
      expect(res.totalPrice).toBe(145000);
    });

    it('should parse Equation Format: Total = 70rb + ongkir 25rb = 95rb', () => {
      const text = `
Pembayaran : 
Total = 70rb + ongkir  25rb  = 95rb 
      `;
      const res = parsePaymentSection(text);
      expect(res.treatmentPrice).toBe(70000);
      expect(res.ongkir).toBe(25000);
      expect(res.totalPrice).toBe(95000);
    });

    it('should parse Equation Format: Total = 60.000 + ongkir 20.000 = *80.000*', () => {
      const text = `
Total = 60.000 + ongkir 20.000 = *80.000*
      `;
      const res = parsePaymentSection(text);
      expect(res.treatmentPrice).toBe(60000);
      expect(res.ongkir).toBe(20000);
      expect(res.totalPrice).toBe(80000);
    });

    it('should parse Multi-Service Equation: Total = 100 + 70 + ongkir 15rb = *185.000*', () => {
      const text = `
Untuk Total = 100 + 70 + ongkir 15rb = *185.000* ya bunda 🤗🙏
      `;
      const res = parsePaymentSection(text);
      expect(res.treatmentPrice).toBe(170000);
      expect(res.ongkir).toBe(15000);
      expect(res.totalPrice).toBe(185000);
    });

    it('should reconcile missing treatment price from total and ongkir', () => {
      const text = `
Ongkir = 25.000
Total = 95.000
      `;
      const res = parsePaymentSection(text);
      expect(res.ongkir).toBe(25000);
      expect(res.totalPrice).toBe(95000);
      expect(res.treatmentPrice).toBe(70000);
    });
  });

  describe('3. parseIndonesianDate', () => {
    it('should parse Indonesian date string with day and time', () => {
      const d = parseIndonesianDate('Rabu, 12 agustus 26 jam 12.30');
      expect(d).toBeInstanceOf(Date);
      expect(d?.getUTCFullYear()).toBe(2026);
      expect(d?.getUTCMonth()).toBe(7); // Agustus (0-indexed 7)
      expect(d?.getUTCDate()).toBe(12);
    });

    it('should parse date with full month name', () => {
      const d = parseIndonesianDate('Kamis, 31 Juli 2026 jam 14.00');
      expect(d).toBeInstanceOf(Date);
      expect(d?.getUTCFullYear()).toBe(2026);
      expect(d?.getUTCMonth()).toBe(6); // Juli (0-indexed 6)
      expect(d?.getUTCDate()).toBe(31);
    });
  });

  describe('4. extractTransactionsFromTranscript', () => {
    it('should extract valid filled form and ignore empty templates', () => {
      const transcriptSample = `
## #1. Jeanetta — \`6281233285194\`

- **Nama Kontak**: Jeanetta
- **Nomor WhatsApp**: \`6281233285194\`

### 💬 Riwayat Percakapan:

> **🤖 [BOT AI]** \`[17/08/2026, 20.44.24]\`
> Berikut reservasi 🐣
> 
> Hari dan tanggal :  Rabu, 12 agustus 26 jam 12.30
> Nama Bunda:  jeanetta
> Alamat & Shareloc : jl kertajaya 4/16
> Kec : gubeng
> Kota : surabaya
> No. Hp : 081233285194
> 
> Pilihan treatment (Baby & Kids)
> 
> Nama Bayi : owen & briell
> Usia Bayi/Anak : 2 bln & 3 thn
> Treatment : bayi kids ceria
> 
> Payment : 
> Treatment = 130.000 
> Ongkir 12km = 25.000
> Promo ongkir = -10.000
> *Total = 145.000*

## #2. Template Kosong — \`6283830002010\`

> **🤖 [BOT AI]**
> Berikut list untuk reservasi
> Hari dan tanggal:
> Nama Bunda:
> Alamat & Shareloc :
> Kec :
> No Hp :
      `;

      const result = extractTransactionsFromTranscript(transcriptSample);
      expect(result.length).toBe(1);
      expect(result[0].customerPhone).toBe('6281233285194');
      expect(result[0].customerName).toBe('jeanetta');
      expect(result[0].babyName).toBe('owen & briell');
      expect(result[0].treatmentPrice).toBe(130000);
      expect(result[0].ongkir).toBe(25000);
      expect(result[0].promo).toBe(10000);
      expect(result[0].totalPrice).toBe(145000);
    });
  });
});
