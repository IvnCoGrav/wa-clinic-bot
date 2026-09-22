import { describe, it, expect } from 'vitest';
import { ToolExecutionPipeline } from '../../../src/v3/agent/pipeline/tool-pipeline';
import { extractFastIntents } from '../../../src/v3/agent/persona';

/**
 * Carry-over intent ongkir berbasis STATE (revisi fondasional 2026-09-18).
 *
 * Draf lama mendeteksi "perbandingan lokasi" via daftar frasa
 * (`startsWith('kalau ke')` dst.) — itu verbatim sentence matching yang
 * dilarang Mandat Anti-Overfitting. Revisi ini menyandarkan pada state sesi:
 * `session.priceDiscussed` (mode transaksional) + adanya lokasi di sesi.
 *
 * Karena sandarannya state, hasilnya INVARIAN terhadap parafrase.
 */
describe('ToolExecutionPipeline — Carry-Over Ongkir Berbasis State', () => {
  it('ON saat priceDiscussed=true & sesi punya kelurahan', () => {
    const session = { priceDiscussed: true, location: { kelurahan: 'Kenjeran' } } as any;
    expect(ToolExecutionPipeline.shouldCarryOverDeliveryFee(session)).toBe(true);
  });

  it('ON saat priceDiscussed=true & sesi punya kecamatan (tanpa kelurahan)', () => {
    const session = { priceDiscussed: true, location: { kecamatan: 'Waru' } } as any;
    expect(ToolExecutionPipeline.shouldCarryOverDeliveryFee(session)).toBe(true);
  });

  it('OFF saat priceDiscussed bukan true', () => {
    const session = { location: { kelurahan: 'Kenjeran' } } as any;
    expect(ToolExecutionPipeline.shouldCarryOverDeliveryFee(session)).toBe(false);
  });

  it('OFF saat lokasi belum ada', () => {
    const session = { priceDiscussed: true } as any;
    expect(ToolExecutionPipeline.shouldCarryOverDeliveryFee(session)).toBe(false);
  });

  it('OFF saat lokasi ada tapi kosong (kelurahan string kosong)', () => {
    const session = { priceDiscussed: true, location: { kelurahan: '' } } as any;
    expect(ToolExecutionPipeline.shouldCarryOverDeliveryFee(session)).toBe(false);
  });

  it('OFF untuk session undefined/null (tidak crash)', () => {
    expect(ToolExecutionPipeline.shouldCarryOverDeliveryFee(undefined)).toBe(false);
    expect(ToolExecutionPipeline.shouldCarryOverDeliveryFee(null as any)).toBe(false);
  });

  it('INVARIAN parafrase: hasil sama untuk beragam kalimat (karena sandaran state)', () => {
    const session = { priceDiscussed: true, location: { kelurahan: 'Bungurasih' } } as any;
    // State sama -> hasil harus sama, apa pun "teks"-nya (teks tidak dipakai).
    const results = ['kalau ke bungurasih', 'bungurasih berapa?', 'nah klo ke bungurasih min', 'ke daerah bungurasih']
      .map(() => ToolExecutionPipeline.shouldCarryOverDeliveryFee(session));
    expect(results.every((r) => r === true)).toBe(true);
  });
});

/**
 * Fase 3 (2026-09-18) — Semantik interogatif "berapa": default adalah
 * pertanyaan HARGA, kecuali terikat satuan non-moneter (durasi/usia/kuantitas/
 * jarak). Mengganti whitelist hafalan kata-biaya yang rapuh.
 */
describe('NLU — Semantik Interogatif "berapa"', () => {
  it('"ke kenjeran berapa" -> ask_price (akar bug: sebelumnya tidak terdeteksi)', () => {
    expect(extractFastIntents('ke kenjeran berapa')).toContain('ask_price');
  });

  it('"kalau ke bungurasih berapa" -> ask_price', () => {
    expect(extractFastIntents('kalau ke bungurasih berapa')).toContain('ask_price');
  });

  it('"pijat bayi berapa" -> ask_price', () => {
    expect(extractFastIntents('pijat bayi berapa')).toContain('ask_price');
  });

  it('"berapa" telanjang -> ask_price', () => {
    expect(extractFastIntents('berapa')).toContain('ask_price');
  });

  it('"berapa biaya pijat" -> ask_price (kata biaya eksplisit)', () => {
    expect(extractFastIntents('berapa biaya pijat')).toContain('ask_price');
  });

  it('"berapa bulan minimal usia anak" -> TIDAK ask_price (satuan usia)', () => {
    const intents = extractFastIntents('berapa bulan minimal usia anak');
    expect(intents).not.toContain('ask_price');
  });

  it('"pijatnya berapa menit" -> ask_duration, TIDAK ask_price (satuan durasi)', () => {
    const intents = extractFastIntents('pijatnya berapa menit');
    expect(intents).toContain('ask_duration');
    expect(intents).not.toContain('ask_price');
  });

  it('"berapa lama pijatnya" -> ask_duration, TIDAK ask_price', () => {
    const intents = extractFastIntents('berapa lama pijatnya');
    expect(intents).toContain('ask_duration');
    expect(intents).not.toContain('ask_price');
  });

  it('"berapa km jaraknya" -> TIDAK ask_price (satuan jarak)', () => {
    expect(extractFastIntents('berapa km jaraknya')).not.toContain('ask_price');
  });

  it('"berapa anak boleh ikut" -> TIDAK ask_price (satuan kuantitas)', () => {
    expect(extractFastIntents('berapa anak boleh ikut')).not.toContain('ask_price');
  });

  it('"berapa sih harganya" -> ask_price (filler "sih" tetap harga)', () => {
    expect(extractFastIntents('berapa sih harganya')).toContain('ask_price');
  });

  it('"saya di sedati" -> TIDAK ask_price (pure lokasi, tanpa berapa)', () => {
    expect(extractFastIntents('saya di sedati')).not.toContain('ask_price');
  });

  it('"jam berapa bisa datang?" -> ask_schedule, TIDAK ask_duration, TIDAK ask_price', () => {
    const intents = extractFastIntents('jam berapa bisa datang?');
    expect(intents).toContain('ask_schedule');
    expect(intents).not.toContain('ask_duration');
    expect(intents).not.toContain('ask_price');
  });

  it('"pijatnya berapa jam ya?" -> ask_duration, TIDAK ask_price', () => {
    const intents = extractFastIntents('pijatnya berapa jam ya?');
    expect(intents).toContain('ask_duration');
    expect(intents).not.toContain('ask_price');
  });

  it('"brp jam perawatannya?" -> ask_duration, TIDAK ask_price', () => {
    const intents = extractFastIntents('brp jam perawatannya?');
    expect(intents).toContain('ask_duration');
    expect(intents).not.toContain('ask_price');
  });
});
