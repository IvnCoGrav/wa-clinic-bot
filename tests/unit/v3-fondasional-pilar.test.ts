import { describe, it, expect } from 'vitest';
import { extractFastIntents } from '../../src/v3/agent/persona';
import { validateNumericFacts } from '../../src/v3/guardrails/numeric-fact-validator';
import { parseReservationText } from '../../src/utils/reservation-text-parser';
import { executeCalculateDelivery } from '../../src/v3/tools/calculate-delivery.tool';

/**
 * Master Implementation Plan — verifikasi per pilar (Agent V3).
 * Offline, tanpa DB/network (fallback in-memory aktif via tests/setup.ts).
 */
describe('Pilar 1 — Intent disambiguation (berapa mingguan BUKAN harga)', () => {
  it('"Berapa minggu minimal usia kehamilan untuk pijat induksi?" → ask_price TIDAK aktif', () => {
    const intents = extractFastIntents('Berapa minggu minimal usia kehamilan untuk pijat induksi?');
    expect(intents).not.toContain('ask_price');
  });

  it('"Berapa bulan bayi boleh dipijat?" → ask_price TIDAK aktif', () => {
    expect(extractFastIntents('Berapa bulan bayi boleh dipijat?')).not.toContain('ask_price');
  });

  it('"Harganya berapa kak?" → ask_price aktif', () => {
    expect(extractFastIntents('Harganya berapa kak?')).toContain('ask_price');
  });

  it('slang "Hrga brp y kak??" → ask_price tetap aktif (tanpa regex)', () => {
    expect(extractFastIntents('Hrga brp y kak??')).toContain('ask_price');
  });

  it('konfirmasi nominal "Pijat baby relaksi 60rb ya" → ask_price aktif', () => {
    expect(extractFastIntents('Pijat baby relaksi 60rb ya')).toContain('ask_price');
  });

  it('"cukurnya gimana" (tanya model) → ask_price TIDAK aktif', () => {
    expect(extractFastIntents('cukurnya gimana')).not.toContain('ask_price');
  });
});

describe('Pilar 3 — Composite numeric validator (tanpa hardcode Rp 10.000)', () => {
  const treatmentTool = {
    name: 'get_catalog_and_price',
    result: {
      treatments: [{ name: 'Pijat Bayi Pulih Ceria', promoPrice: 70000, originalPrice: 90000 }],
    },
  };
  const deliveryTool = {
    name: 'calculate_delivery',
    result: { success: true, ongkirPromo: 15000, ongkirNormal: 25000 },
  };

  it('total layanan + ongkir (70rb + 15rb = 85rb) → VALID', () => {
    const r = validateNumericFacts(
      'Total perawatannya Rp 70.000 ditambah ongkir Rp 15.000 menjadi Rp 85.000 ya Bunda',
      [treatmentTool, deliveryTool] as any
    );
    expect(r.isValid).toBe(true);
  });

  it('combo layanan + add-on katalog dinamis (70rb + 10rb = 80rb) → VALID', () => {
    const r = validateNumericFacts(
      'Paketnya Rp 70.000 ditambah Sinar Moksa Rp 10.000 total Rp 80.000 ya Bunda',
      [treatmentTool] as any
    );
    expect(r.isValid).toBe(true);
  });

  it('nominal liar (Rp 999.000) → tetap DITOLAK', () => {
    const r = validateNumericFacts('Totalnya Rp 999.000 ya Bunda', [treatmentTool, deliveryTool] as any);
    expect(r.isValid).toBe(false);
  });

  it('session.totalPrice & cartItems ikut mengotorisasi', () => {
    const r = validateNumericFacts('Total keseluruhannya Rp 85.000 ya Bunda', [treatmentTool] as any, {
      session: {
        totalPrice: 85000,
        cartItems: [{ price: 70000, promoPrice: 70000 }],
        location: { ongkirPromo: 15000, ongkirNormal: 25000 },
      },
    });
    expect(r.isValid).toBe(true);
  });
});

describe('Pilar 4 — Reservation persistence momProfile', () => {
  const form = [
    'Berikut list untuk reservasi:',
    'Nama Bunda: Rina',
    'No HP: 081234567890',
    'Alamat: Jl Mawar 1',
    'Kec: Waru',
    'Kota: Sidoarjo',
    'Pilihan Treatment (Moms & Nifas):',
    'Usia Kehamilan: 38 weeks',
    'Treatment: Induksi Massage Fullbody',
    'Jadwal Treatment: Besok pagi',
  ].join('\n');

  it('usia kehamilan tersimpan utuh di parsed.momProfile (tidak dibuang)', () => {
    const res = parseReservationText(form);
    expect(res.success).toBe(true);
    expect(res.reservation?.momProfile?.gestationalWeeks).toContain('38');
    expect(res.reservation?.treatmentCategory).toBe('MOMS');
  });

  it('usia kehamilan TIDAK bocor ke babies', () => {
    const res = parseReservationText(form);
    const babyText = JSON.stringify(res.reservation?.babies || []);
    expect(babyText).not.toContain('38');
  });
});

describe('Pilar 5 — Hierarchical geocoding tanpa regex hafalan', () => {
  it('"surabaya barat" → wilayah luas deterministik (tanpa nominal)', async () => {
    const res = await executeCalculateDelivery({ locationText: 'surabaya barat' });
    expect(res.success).toBe(false);
    expect(res.isPrecise).toBe(false);
    expect(res.message).toMatch(/luas/i);
    expect(res.message).not.toMatch(/Rp\s*[\d.]+/);
  });

  it('"Medan" → deterministik tanpa throw (out-of-coverage / minta detail, tanpa ongkir halusinasi)', async () => {
    const res = await executeCalculateDelivery({ locationText: 'Medan' });
    expect(typeof res.success).toBe('boolean');
    if (res.isOutOfCoverage) {
      expect(res.message).toMatch(/jangkauan/i);
    } else {
      expect(res.message).not.toMatch(/Rp\s*[\d.]+/);
    }
  });

  it('"SBY barat kk" → deterministik tanpa throw', async () => {
    const res = await executeCalculateDelivery({ locationText: 'SBY barat kk' });
    expect(typeof res.success).toBe('boolean');
    expect(typeof res.isPrecise).toBe('boolean');
  });
});
