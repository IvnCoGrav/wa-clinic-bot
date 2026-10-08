import { describe, it, expect } from 'vitest';
import { extractScheduleFromMessages, isNegotiatedScheduleCommitted } from '../../packages/admin-dashboard/src/utils/chatScheduleExtractor';
import { matchCatalogService } from '../../packages/admin-dashboard/src/utils/treatmentStringParser';

/**
 * Uji adversarial multi-frasa untuk perbaikan audit:
 * - Negosiasi jam reverse-chronological (bukan match pesan terlama).
 * - Matcher katalog anti-substring ("cukur rambut" ≠ paket Selapan).
 * - Otoritas bundle dari metadata DB (category/serviceType), bukan kata hafalan.
 */
describe('Chat Schedule Extractor — Negotiation & Catalog (adversarial)', () => {
  const catalog = [
    { id: 'cukur', name: 'Kala Baby – Cukur Rambut', promoPrice: 25000, originalPrice: 30000, category: 'BABY', durationMinutes: 15 },
    { id: 'ceria75', name: 'Kala Kids – Pijat Ceria', promoPrice: 75000, category: 'KIDS', durationMinutes: 40, ageTier: { minAgeMonths: 24, maxAgeMonths: 48, label: '2 - 4 Tahun' } },
    { id: 'ceria80', name: 'Kala Kids – Pijat Ceria', promoPrice: 80000, category: 'KIDS', durationMinutes: 40, ageTier: { minAgeMonths: 48, maxAgeMonths: 72, label: '4 - 6 Tahun' } },
    { id: 'selapan', name: 'Kala Bundle Selapan (Cukur + Pijat Ceria)', promoPrice: 80000, category: 'BUNDLE', durationMinutes: 75 },
  ];

  it('prioritaskan jam negosiasi TERKINI, bukan tawaran lama bot', () => {
    const messages = [
      { direction: 'OUTBOUND', content: 'Slot yang tersedia jam 09.00-09.30 ya Bunda' },
      { direction: 'INBOUND', content: 'klo jam 10 gmna kak?' },
      { direction: 'OUTBOUND', content: 'Bisa Bunda jam 10.00' },
    ];
    const extracted = extractScheduleFromMessages(messages, { name: 'Linda Nur', phone: '628111' }, catalog);
    expect(extracted.timeDisplay).toBe('10.00');
  });

  it('reverse scan tetap mengenali rentang jam terbaru', () => {
    const messages = [
      { direction: 'OUTBOUND', content: 'Ada slot jam 08.00-08.30' },
      { direction: 'INBOUND', content: 'mending jam 13.00-13.30 deh kak' },
    ];
    const extracted = extractScheduleFromMessages(messages, { name: 'Bunda' }, catalog);
    expect(extracted.timeDisplay).toBe('13.00-13.30');
  });

  it('reverse scan tetap mengenali jam + keterangan waktu (pagi/siang/sore)', () => {
    const messages = [
      { direction: 'OUTBOUND', content: 'Bisa jam 09.00 pagi bun' },
      { direction: 'INBOUND', content: 'boleh jam 4 sore?' },
    ];
    const extracted = extractScheduleFromMessages(messages, { name: 'Bunda' }, catalog);
    expect(extracted.timeDisplay).toBe('16.00');
  });

  it('"cukur rambut" → layanan satuan Cukur Rambut 25k, BUKAN Bundle Selapan 80k', () => {
    const matched = matchCatalogService('cukur rambut', catalog);
    expect(matched?.name).toBe('Kala Baby – Cukur Rambut');
    expect(matched?.promoPrice).toBe(25000);
  });

  it('"mau cukur aja" tetap tidak memicu bundle', () => {
    const matched = matchCatalogService('mau cukur aja', catalog);
    expect(matched?.name).not.toContain('Bundle');
  });

  it('"paket selapan" eksplisit tetap memilih bundle (otoritas marker eksplisit)', () => {
    const matched = matchCatalogService('paket selapan', catalog);
    expect(matched?.name).toContain('Bundle');
  });

  it('"pijat ceria" tidak salah cocok ke bundle', () => {
    const matched = matchCatalogService('pijat ceria', catalog);
    expect(matched?.name).not.toContain('Bundle');
    expect(matched?.name).toContain('Pijat Ceria');
  });
});

describe('isNegotiatedScheduleCommitted (adversarial multi-phrase MT-3.2)', () => {
  const dummySchedule = {
    bookingDate: new Date('2026-10-15T02:00:00Z'),
    dateDisplay: 'Kamis, 15 Oktober 2026',
    timeDisplay: '07.30',
    treatmentName: 'Kala Baby – Pijat Ceria',
    treatmentPrice: 70000,
    treatmentCategory: 'BABY' as const,
    childName: 'Adik',
    childAge: '3 bulan',
    babies: [],
    bundaName: 'Bunda',
    phone: '628123',
    address: 'Jl. Melati',
    kecamatan: 'Sukomanunggal',
    kota: 'Surabaya',
    distanceKm: 5,
    ongkir: 10000,
    discount: 0,
    isExtractedFromChat: true,
    confidenceScore: 0.95,
    hasExplicitReservationForm: false,
  };

  it('positif: negosiasi slot jam 07.30 dijawab user "oke deal 07.30"', () => {
    const messages = [
      { direction: 'INBOUND', content: 'Minggu depan tgl 4 pagi ya kak' },
      { direction: 'OUTBOUND', content: 'slot 07.30 bisa?' },
      { direction: 'INBOUND', content: 'oke deal 07.30' },
    ];
    expect(isNegotiatedScheduleCommitted(messages, dummySchedule)).toBe(true);
  });

  it('positif: user setuju "bisa, deal jam 9"', () => {
    const messages = [
      { direction: 'INBOUND', content: 'besok sabtu jam 9 bisa?' },
      { direction: 'OUTBOUND', content: 'bisa bunda, kami keep jam 9 ya' },
      { direction: 'INBOUND', content: 'bisa, deal jam 9' },
    ];
    expect(isNegotiatedScheduleCommitted(messages, dummySchedule)).toBe(true);
  });

  it('positif: flow Karina — user minta pagi, bot tawarkan 07.30, user konfirmasi afirmatif "Oke"', () => {
    const messages = [
      { direction: 'INBOUND', content: 'Minggu depan tgl 4 pagi ya kak' },
      { direction: 'OUTBOUND', content: 'Untuk pagi ada bunda, kami ada slot jam 07.30-08.00. Bagaimana bund? 🤗' },
      { direction: 'INBOUND', content: 'Oke' },
    ];
    expect(isNegotiatedScheduleCommitted(messages, dummySchedule)).toBe(true);
  });

  it('negatif: hanya kata "oke" saja TANPA jadwal booking yang ter-ekstrak', () => {
    const messages = [{ direction: 'INBOUND', content: 'oke' }];
    expect(isNegotiatedScheduleCommitted(messages, null)).toBe(false);
    expect(isNegotiatedScheduleCommitted(messages, { ...dummySchedule, bookingDate: null })).toBe(false);
  });

  it('negatif: user hanya bertanya "berapa harganya?" tanpa komitmen jadwal', () => {
    const messages = [
      { direction: 'OUTBOUND', content: 'Slot 07.30 tersedia bun' },
      { direction: 'INBOUND', content: 'berapa harganya?' },
    ];
    expect(isNegotiatedScheduleCommitted(messages, dummySchedule)).toBe(false);
  });

  it('negatif: tawaran bot TANPA jawaban inbound dari user (customer belum balas)', () => {
    const messages = [
      { direction: 'INBOUND', content: 'bisa pijat bayi?' },
      { direction: 'OUTBOUND', content: 'slot 07.30 bisa bun?' },
    ];
    expect(isNegotiatedScheduleCommitted(messages, dummySchedule)).toBe(false);
  });

  it('negatif: user menanyakan lokasi/ongkir "ongkir ke rungkut berapa ya"', () => {
    const messages = [
      { direction: 'OUTBOUND', content: 'Slot jam 10 tersedia ya' },
      { direction: 'INBOUND', content: 'ongkir ke rungkut berapa ya' },
    ];
    expect(isNegotiatedScheduleCommitted(messages, dummySchedule)).toBe(false);
  });

  it('positif: tag question santun "Oke jam 9 ya?" tetap diterima sebagai komitmen', () => {
    const messages = [
      { direction: 'OUTBOUND', content: 'Slot jam 09.00 tersedia ya Bunda' },
      { direction: 'INBOUND', content: 'Oke jam 9 ya?' },
    ];
    expect(isNegotiatedScheduleCommitted(messages, dummySchedule)).toBe(true);
  });

  it('positif: konfirmasi santun "Boleh jam 10 ya bun?" tetap diterima sebagai komitmen', () => {
    const messages = [
      { direction: 'OUTBOUND', content: 'Bisa jam 10 Bunda' },
      { direction: 'INBOUND', content: 'Boleh jam 10 ya bun?' },
    ];
    expect(isNegotiatedScheduleCommitted(messages, dummySchedule)).toBe(true);
  });

  it('negatif: murni tanya ketersediaan slot "ada slot jam 9?" ditolak (belum komitmen)', () => {
    const messages = [
      { direction: 'OUTBOUND', content: 'Halo Bunda, mau ambil perawatan apa?' },
      { direction: 'INBOUND', content: 'ada slot jam 9?' },
    ];
    expect(isNegotiatedScheduleCommitted(messages, dummySchedule)).toBe(false);
  });

  it('negatif: keraguan "jam 9 bisa gak ya?" ditolak (belum komitmen)', () => {
    const messages = [
      { direction: 'OUTBOUND', content: 'Pijat bayi tersedia hari minggu' },
      { direction: 'INBOUND', content: 'jam 9 bisa gak ya?' },
    ];
    expect(isNegotiatedScheduleCommitted(messages, dummySchedule)).toBe(false);
  });
});

