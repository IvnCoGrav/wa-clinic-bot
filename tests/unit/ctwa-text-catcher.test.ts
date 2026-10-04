import { describe, it, expect, beforeEach } from 'vitest';
import {
  ctwaTextCatcherService,
  matchInboundText,
  __setMemoryCatchers,
  __clearMemoryCatchers,
  anchorPasses,
  HIGH_CONFIDENCE_ANCHOR_BYPASS,
} from '../../src/services/ctwa-text-catcher.service';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function catcher(over: Partial<any> = {}) {
  return {
    id: 'c1',
    tenant_id: TENANT_A,
    campaign_name: 'IG-BABYSPA',
    source: 'instagram',
    medium: 'ctwa',
    greetings: ['Halo Bidan, saya mau tanya promo Baby Spa Surabaya'],
    anchor_keywords: ['baby spa'],
    similarity_threshold: 0.7,
    is_active: true,
    notes: null,
    ...over,
  };
}

describe('ctwa-text-catcher.service', () => {
  beforeEach(() => {
    __clearMemoryCatchers();
  });

  it('exact match → 100% / matched', async () => {
    __setMemoryCatchers(TENANT_A, [catcher()]);
    const res = await matchInboundText('Halo Bidan, saya mau tanya promo Baby Spa Surabaya', TENANT_A);
    expect(res?.matched).toBe(true);
    expect(res?.similarityScore).toBe(1.0);
    expect(res?.campaignName).toBe('IG-BABYSPA');
  });

  it('typo + slang WhatsApp nyata → tetap match via kredit anchor', async () => {
    __setMemoryCatchers(TENANT_A, [catcher()]);
    const res = await matchInboundText('halo min mau tny prmo baby spa sby', TENANT_A);
    expect(res?.matched).toBe(true);
    expect(res?.anchorCheckPassed).toBe(true);
    expect(res?.anchorBypassed).toBe(false);
    // Skor mentah rendah (slang berat), tetapi kredit anchor mendorongnya lolos ambang.
    expect(res!.similarityScore).toBeGreaterThan(0.4);
    expect(res!.similarityScore).toBeLessThan(0.6);
    expect(res!.effectiveScore).toBeGreaterThanOrEqual(0.7);
  });

  it('variasi pemotongan kata → match', async () => {
    __setMemoryCatchers(TENANT_A, [catcher()]);
    const res = await matchInboundText('halo saya mau tanya promo baby spa', TENANT_A);
    expect(res?.matched).toBe(true);
  });

  it('urutan kata dibalik → match (Jaccard menolong)', async () => {
    __setMemoryCatchers(TENANT_A, [catcher()]);
    const res = await matchInboundText('promo baby spa surabaya mau tanya halo', TENANT_A);
    expect(res?.matched).toBe(true);
  });

  it('emoji & caps → match', async () => {
    __setMemoryCatchers(TENANT_A, [catcher()]);
    const res = await matchInboundText('HALO BUNDA 🙏 MAU TANYA PROMO BABY SPA SURABAYA', TENANT_A);
    expect(res?.matched).toBe(true);
  });

  it('pesan organik tanpa anchor → DITOLAK (anti false-positive)', async () => {
    __setMemoryCatchers(TENANT_A, [catcher()]);
    const res = await matchInboundText('Halo admin, mau tanya jadwal klinik buka jam berapa?', TENANT_A);
    expect(res?.matched).toBe(false);
    expect(res?.anchorCheckPassed).toBe(false);
  });

  it('pesan organik yang memuat anchor tapi singkat → tetap DITOLAK (kredit belum cukup)', async () => {
    __setMemoryCatchers(TENANT_A, [catcher()]);
    const res = await matchInboundText('berapa harga baby spa ya', TENANT_A);
    expect(res?.anchorCheckPassed).toBe(true);
    expect(res!.effectiveScore).toBeLessThan(0.7);
    expect(res?.matched).toBe(false);
  });

  it('bila anchor kosong → guard anchor dilewati (catcher generik)', async () => {
    __setMemoryCatchers(TENANT_A, [catcher({ anchor_keywords: [], campaign_name: 'GENERIK' })]);
    const res = await matchInboundText('halo saya mau tanya promo baby spa surabaya', TENANT_A);
    expect(res?.anchorCheckPassed).toBe(true);
    expect(res?.matched).toBe(true);
  });

  it('multi-template → pilih skor tertinggi', async () => {
    __setMemoryCatchers(TENANT_A, [
      catcher({
        greetings: [
          'Halo Bidan, saya mau tanya jadwal treatment',
          'Halo Bidan, saya mau tanya promo Baby Spa Surabaya',
        ],
      }),
    ]);
    const res = await matchInboundText('Halo Bidan, saya mau tanya promo Baby Spa Surabaya', TENANT_A);
    expect(res?.templateIndex).toBe(1);
    expect(res?.similarityScore).toBe(1.0);
    expect(res?.diagnostics.length).toBe(2);
  });

  it('isolasi tenant: kampanye tenant A tidak cocok di tenant B', async () => {
    __setMemoryCatchers(TENANT_A, [catcher()]);
    __setMemoryCatchers(TENANT_B, []);
    const res = await matchInboundText('Halo Bidan, saya mau tanya promo Baby Spa Surabaya', TENANT_B);
    expect(res).toBeNull();
  });

  it('threshold boundary (catcher generik tanpa anchor): match di 0.70, tolak di 0.95', async () => {
    __setMemoryCatchers(TENANT_A, [catcher({ anchor_keywords: [], similarity_threshold: 0.7 })]);
    const low = await matchInboundText('halo saya mau tanya promo baby spa', TENANT_A);
    expect(low?.similarityScore).toBeGreaterThan(0.7);
    expect(low?.similarityScore).toBeLessThan(0.95);
    expect(low?.matched).toBe(true);

    __setMemoryCatchers(TENANT_A, [catcher({ anchor_keywords: [], similarity_threshold: 0.95 })]);
    const high = await matchInboundText('halo saya mau tanya promo baby spa', TENANT_A);
    expect(high?.matched).toBe(false);
  });

  it('input terlalu pendek → null (cegah "hi/ok" teratribusi)', async () => {
    __setMemoryCatchers(TENANT_A, [catcher()]);
    expect(await matchInboundText('hi', TENANT_A)).toBeNull();
    expect(await matchInboundText('ok', TENANT_A)).toBeNull();
  });

  it('tidak ada catcher aktif → null', async () => {
    __setMemoryCatchers(TENANT_A, []);
    expect(await matchInboundText('halo mau tanya promo baby spa', TENANT_A)).toBeNull();
  });

  it('anchorPasses: frasa berbatas kata (bukan substring) & toleran urutan', () => {
    expect(anchorPasses('promo baby spa surabaya', ['baby spa'])).toBe(true);
    expect(anchorPasses('spa baby promo', ['baby spa'])).toBe(true);
    expect(anchorPasses('babyoil spa', ['baby spa'])).toBe(false);
    expect(anchorPasses('apa saja', [])).toBe(true);
  });

  it('bypass anchor hanya saat skor sangat tinggi', async () => {
    // Anchor sengaja tidak ada di input, tetapi teks nyaris identik dengan template.
    __setMemoryCatchers(TENANT_A, [
      catcher({
        greetings: ['halo bidan saya mau tanya promo perawatan ibu hamil'],
        anchor_keywords: ['baby spa'],
        similarity_threshold: 0.7,
      }),
    ]);
    const res = await matchInboundText('halo bidan saya mau tanya promo perawatan ibu hamil', TENANT_A);
    expect(res?.similarityScore).toBe(1.0);
    expect(res?.anchorBypassed).toBe(true);
    expect(res?.anchorCheckPassed).toBe(false);
    expect(res?.matched).toBe(true);
    expect(HIGH_CONFIDENCE_ANCHOR_BYPASS).toBe(0.85);
  });

  it('matchInboundText melempar bila tenantId kosong (fail-closed)', async () => {
    await expect(matchInboundText('halo mau tanya promo', '')).rejects.toThrow(/tenantId/);
  });

  it('namespace service mengekspos API yang sama', async () => {
    __setMemoryCatchers(TENANT_A, [catcher()]);
    const res = await ctwaTextCatcherService.matchInboundText('promo baby spa surabaya', TENANT_A);
    expect(res?.matched).toBe(true);
  });
});
