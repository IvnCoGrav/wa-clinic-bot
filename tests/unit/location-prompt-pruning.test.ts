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
    expect(buildLocationHierarchyBlock(undefined)).toBe(LOCATION_HIERARCHY_BLOCK);
    expect(buildLocationHierarchyBlock({} as any)).toBe(LOCATION_HIERARCHY_BLOCK);
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

  // Rule 2 — Strict Information Hiding (state-gated prompt pruning).
  it('lokasi ada + priceDiscussed BUKAN true → pin LARANG nominal ongkir disematkan', () => {
    const session: any = {
      location: { kelurahan: 'Tenggilis Mejoyo', kecamatan: 'Tenggilis Mejoyo', distanceKm: 12 },
    };
    const block = buildLocationHierarchyBlock(session);
    expect(block).toContain('DILARANG SEBUT NOMINAL ONGKIR/HARGA');
  });

  it('lokasi ada + priceDiscussed true → TANPA pin larangan nominal (mode transaksional)', () => {
    const session: any = {
      priceDiscussed: true,
      location: { kelurahan: 'Tenggilis Mejoyo', kecamatan: 'Tenggilis Mejoyo', distanceKm: 12 },
    };
    const block = buildLocationHierarchyBlock(session);
    expect(block).not.toContain('DILARANG SEBUT NOMINAL ONGKIR/HARGA');
  });
});
