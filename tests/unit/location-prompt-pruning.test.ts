import { describe, it, expect } from 'vitest';
import {
  LOCATION_HIERARCHY_BLOCK,
  buildLocationHierarchyBlock,
} from '../../src/v3/agent/prompt/phases/location-rules.phase';
import { ContextGrounder } from '../../src/v3/agent/pipeline/context-grounder';

/**
 * State-Gated Prompt Pruning (Rule 16): begitu lokasi tersimpan di sesi,
 * cabang instruksi tanya-lokasi DICABUT dari prompt dan diganti pin permanen.
 */
describe('location prompt pruning — state-gated', () => {
  it('tanpa lokasi: blok kanonis byte-identik', () => {
    // Default (tanpa sinyal transaksional) = MODE KONSULTASI (RC-1): blok
    // lokasi-belum-diketahui sadar-mode, BUKAN lagi blok kanonis mentah.
    const blockNoSession = buildLocationHierarchyBlock(undefined);
    expect(blockNoSession).toContain('HIERARKI & ALUR MENJAWAB');
    expect(blockNoSession).not.toMatch(/cekkan jarak pasti dan ongkir promonya/i);
    // Mode transaksional eksplisit = blok kanonis (dengan janji cek ongkir).
    expect(buildLocationHierarchyBlock({ priceDiscussed: true } as any)).toBe(LOCATION_HIERARCHY_BLOCK);
    expect(buildLocationHierarchyBlock({} as any)).not.toMatch(/cekkan jarak pasti dan ongkir promonya/i);
  });

  it('lokasi diketahui: cabang tanya-lokasi dicabut + pin permanen', () => {
    const session: any = {
      location: {
        rawText: 'Waru',
        kelurahan: 'Kedungrejo',
        kecamatan: 'Waru',
        kota: 'Sidoarjo',
        distanceKm: 4,
      },
    };
    const block = buildLocationHierarchyBlock(session);
    expect(block).toContain('LOKASI SUDAH TERKONFIRMASI');
    expect(block).toContain('Kedungrejo');
    expect(block).not.toContain('WAJIB dahulukan menanyakan daerah rumah');
  });

  it('buildContextSummary menyematkan pin lokasi di baris teratas', () => {
    const session: any = {
      location: { kelurahan: 'Kedungrejo', kecamatan: 'Waru', distanceKm: 4 },
    };
    const summary = ContextGrounder.buildContextSummary(session, 'halo', []);
    const pinIdx = summary.indexOf('[LOKASI TERKUNCI]');
    expect(pinIdx).toBeGreaterThanOrEqual(0);
    expect(summary.indexOf('[RINGKASAN KONTEKS')).toBeGreaterThan(pinIdx);
    expect(summary).toContain('Kedungrejo');
  });

  it('tanpa lokasi: tidak ada pin palsu', () => {
    const summary = ContextGrounder.buildContextSummary({} as any, 'halo', []);
    expect(summary).not.toContain('[LOKASI TERKUNCI]');
  });

  // Kontrak sesi 779408: lokasi presisi diketahui → jarak & ongkir promo BOLEH
  // disampaikan. Yang tetap dilarang adalah menyebut HARGA PAKET/treatment bila
  // customer belum menanyakan biaya (Rule 2 untuk harga treatment).
  it('lokasi ada + priceDiscussed BUKAN true → pin larangan HARGA PAKET (bukan ongkir) disematkan', () => {
    const session: any = {
      location: { kelurahan: 'Tenggilis Mejoyo', kecamatan: 'Tenggilis Mejoyo', distanceKm: 12 },
    };
    const block = buildLocationHierarchyBlock(session);
    expect(block).toContain('DILARANG menyebutkan nominal HARGA PAKET perawatan');
    expect(block).toContain('ONGKIR PROMO');
    expect(block).not.toContain('DILARANG SEBUT NOMINAL ONGKIR/HARGA');
  });

  it('lokasi ada + priceDiscussed true → TANPA pin larangan nominal', () => {
    const session: any = {
      priceDiscussed: true,
      location: { kelurahan: 'Tenggilis Mejoyo', kecamatan: 'Tenggilis Mejoyo', distanceKm: 12 },
    };
    const block = buildLocationHierarchyBlock(session);
    expect(block).not.toContain('DILARANG SEBUT NOMINAL ONGKIR/HARGA');
    expect(block).not.toContain('DILARANG menyebutkan nominal HARGA PAKET');
  });
});

/**
 * RC-1 (sesi 535222): template penanganan KECAMATAN LUAS tidak boleh menjanjikan
 * "cek ongkir" bila customer BELUM menanyakan biaya (mode konsultasi). Janji itu
 * adalah pelanggaran Information Hiding (Rule 2) di lapisan prompt.
 */
describe('location hierarchy — mode-aware broad district (RC-1)', () => {
  it('mode konsultasi (priceDiscussed bukan true): cabang kecamatan TIDAK menjanjikan cek ongkir', () => {
    const block = buildLocationHierarchyBlock(undefined);
    // Tidak boleh ada janji "cekkan ... ongkir promo" pada kondisi konsultasi.
    expect(block).not.toMatch(/cekkan jarak pasti dan ongkir promonya/i);
    expect(block).not.toMatch(/cekkan jarak dan ongkir promonya/i);
  });

  it('mode transaksional (priceDiscussed true): cabang kecamatan BOLEH menjanjikan cek ongkir', () => {
    const block = buildLocationHierarchyBlock({ priceDiscussed: true } as any);
    expect(block).toMatch(/ongkir promonya/i);
  });
});
