import { describe, it, expect, vi, afterEach } from 'vitest';
import { GoalTracker } from '../../src/v3/state/goal-tracker';
import { buildLocationHierarchyBlock, LOCATION_HIERARCHY_BLOCK } from '../../src/v3/agent/prompt/phases/location-rules.phase';
import { executeCalculateDelivery } from '../../src/v3/tools/calculate-delivery.tool';
import { deliveryService } from '../../src/services/delivery.service';
import { validateToolArgs } from '../../src/v3/tools/tool-schemas';

/**
 * Gerbang regresi FASE 3 — Buku Alamat Multi-Rumah (docs/plans/MULTI_ADDRESS_SUPPORT_REVISI-1_PLAN.md)
 *
 * Aturan emas yang diuji (anti-tambal-sulam, deterministik):
 * 1. State-Gated Prompt Pruning: `saved_addresses.length > 1` menulis blok
 *    `[ALAMAT TERSIMPAN CUSTOMER]`; `<= 1` → perilaku lama BYTE-IDENTIK.
 *    Ongkir di blok HANYA bila `priceDiscussed === true` (Rule 2).
 * 2. Tool `calculate_delivery['savedAddressId']`: koordinat tersimpan dipakai
 *    LANGSUNG (tanpa geocoding ulang) — validasi kepemilikan via pipeline.
 *    Kontrak skema: `locationText` ATAU `savedAddressId` wajib (zod refine).
 * 3. Fee-hiding tetap berlaku di jalur buku alamat.
 */
describe('Fase 3 — prompt pruning multi-address (State-Gated)', () => {
  const multiSession = {
    customerName: 'Ibu Sari',
    genderGreeting: 'Bunda',
    location: { kelurahan: 'Rungkut Menanggal', kecamatan: 'Rungkut', kota: 'Surabaya', distanceKm: 6.2 },
    priceDiscussed: true,
    savedAddresses: [
      { id: 'addr-rumah', label: 'Rumah Utama', address: 'Jl. Rungkut Asri', kelurahan: 'Rungkut Menanggal', kecamatan: 'Rungkut', kota: 'Surabaya', ongkir: 15000, isPrimary: true },
      { id: 'addr-mertua', label: 'Rumah Mertua', address: 'Jl. Kerto Menanggal', kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo', ongkir: 22000 },
    ],
  } as any;

  it('tanpa savedAddresses → TIDAK ada blok [ALAMAT TERSIMPAN CUSTOMER] (perilaku lama)', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      customerName: 'Ibu Sari',
      genderGreeting: 'Bunda',
      location: { kelurahan: 'Rungkut Menanggal', kecamatan: 'Rungkut', kota: 'Surabaya' },
    } as any);
    expect(text).not.toMatch(/ALAMAT TERSIMPAN CUSTOMER/);
  });

  it('1 alamat tersimpan → TIDAK mengaktifkan blok multi-rumah', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({
      ...multiSession,
      savedAddresses: [multiSession.savedAddresses[0]],
    });
    expect(text).not.toMatch(/ALAMAT TERSIMPAN CUSTOMER/);
  });

  it('multi-alamat + priceDiscussed → blok bernomor memuat label, area, dan ongkir nominal', () => {
    const text = GoalTracker.formatGoalSessionForPrompt(multiSession);
    expect(text).toMatch(/ALAMAT TERSIMPAN CUSTOMER — 2 rumah/);
    expect(text).toMatch(/1\. Rumah Utama( \[utama\])?: Rungkut Menanggal, Rungkut, Surabaya \(Ongkir: Rp 15\.000\)/);
    expect(text).toMatch(/2\. Rumah Mertua: Waru, Waru, Sidoarjo \(Ongkir: Rp 22\.000\)/);
  });

  it('multi-alamat + mode konsultasi (priceDiscussed false) → ongkir TIDAK bocor ke blok', () => {
    const text = GoalTracker.formatGoalSessionForPrompt({ ...multiSession, priceDiscussed: false });
    expect(text).toMatch(/ALAMAT TERSIMPAN CUSTOMER/);
    expect((text.match(/Ongkir:/g) || []).length).toBe(0);
    expect(text).not.toMatch(/Rp\s*[\d.]+/);
  });

  it('lokasi belum diketahui + multi-alamat → cabang tanya-alamat-dari-nol DICABUT, diganti konfirmasi pilihan', () => {
    const block = buildLocationHierarchyBlock({
      priceDiscussed: false,
      savedAddresses: [{ id: 'a', label: 'Rumah Utama' }, { id: 'b', label: 'Rumah Mertua' }],
    });
    expect(block).toMatch(/ALAMAT TERSIMPAN — MULTI-RUMAH/);
    expect(block).toMatch(/Mana rumah yang dipakai/i);
    expect(block).not.toMatch(/Kalau boleh tahu rumah Bunda di kelurahan/i);
  });

  it('lokasi diketahui + multi-alamat → pin MULTI-RUMAH aktif (tidak menimpa tanpa pilihan eksplisit)', () => {
    const block = buildLocationHierarchyBlock({
      location: { kelurahan: 'Rungkut Menanggal', kecamatan: 'Rungkut', kota: 'Surabaya', distanceKm: 6.2 },
      savedAddresses: [{ id: 'a', label: 'Rumah Utama' }, { id: 'b', label: 'Rumah Mertua' }],
    });
    expect(block).toMatch(/MULTI-RUMAH/);
    expect(block).toMatch(/konfirmasi dulu rumah mana/i);
  });

  it('single/0 alamat → buildLocationHierarchyBlock BYTE-IDENTIK dengan baseline', () => {
    expect(buildLocationHierarchyBlock({ priceDiscussed: true } as any)).toBe(LOCATION_HIERARCHY_BLOCK);
    const knownBaseline = buildLocationHierarchyBlock({
      location: { kelurahan: 'Rungkut Menanggal', kecamatan: 'Rungkut', kota: 'Surabaya', distanceKm: 6.2 },
    });
    const withOne = buildLocationHierarchyBlock({
      location: { kelurahan: 'Rungkut Menanggal', kecamatan: 'Rungkut', kota: 'Surabaya', distanceKm: 6.2 },
      savedAddresses: [{ id: 'a', label: 'Rumah Utama' }],
    });
    expect(withOne).toBe(knownBaseline);
  });
});

describe('Fase 3 — tool calculate_delivery: alamat tersimpan (deterministik, tanpa geocoding ulang)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('savedAddress valid → hitung dari koordinat tersimpan, panggil deliveryService TANPA teks lokasi', async () => {
    const spy = vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue({
      distanceKm: 4.2,
      ongkir: 15000,
      normalPrice: 15000,
      promoPrice: 15000,
      isOutOfCoverage: false,
      maxCoverageKm: 30,
      freeTierKm: 5,
      messageTemplate: '',
    } as any);

    const res = await executeCalculateDelivery({
      locationText: '',
      savedAddressId: 'addr-mertua',
      savedAddress: {
        id: 'addr-mertua',
        label: 'Rumah Mertua',
        address: 'Jl. Kerto Menanggal',
        kelurahan: 'Waru',
        kecamatan: 'Waru',
        kota: 'Sidoarjo',
        lat: -7.3564,
        lng: 112.7733,
      },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ lat: -7.3564, lng: 112.7733 }, undefined, expect.anything());
    expect(res.success).toBe(true);
    expect(res.isPrecise).toBe(true);
    expect(res.distanceKm).toBeCloseTo(4.2, 5);
    expect(res.ongkirPromo).toBe(15000);
    expect(res.message).toMatch(/Rumah Mertua/);
  });

  it('savedAddress out-of-coverage → status jangkauan tegas, nominal disembunyikan dari payload', async () => {
    vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue({
      distanceKm: 45,
      ongkir: 0,
      normalPrice: 0,
      promoPrice: 0,
      isOutOfCoverage: true,
      maxCoverageKm: 30,
      freeTierKm: 5,
      messageTemplate: '',
    } as any);

    const res = await executeCalculateDelivery({
      locationText: '',
      savedAddressId: 'addr-jauh',
      savedAddress: { id: 'addr-jauh', label: 'Rumah Jauh', kelurahan: 'Pelemwatu', kecamatan: 'Menganti', kota: 'Gresik', lat: -7.2, lng: 112.3 },
    });

    expect(res.isOutOfCoverage).toBe(true);
    expect(res.ongkirPromo).toBeUndefined();
    expect(res.distanceKm).toBeUndefined();
    expect(res.message).not.toMatch(/Rp\s*[\d.]+/);
  });

  it('fee-hiding kontrak 779408: savedAddress presisi + dalam jangkauan → nominal DIBUKA (bukan centroid)', async () => {
    vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue({
      distanceKm: 4.2,
      ongkir: 15000,
      normalPrice: 15000,
      promoPrice: 15000,
      isOutOfCoverage: false,
      maxCoverageKm: 30,
      freeTierKm: 5,
      messageTemplate: '',
    } as any);

    const res = await executeCalculateDelivery({
      locationText: '',
      savedAddressId: 'addr-rumah',
      savedAddress: { id: 'addr-rumah', label: 'Rumah Utama', kelurahan: 'Waru', kecamatan: 'Waru', kota: 'Sidoarjo', lat: -7.35, lng: 112.77 },
    });

    expect(res.success).toBe(true);
    expect(res.isOutOfCoverage).toBe(false);
    // Koordinat tersimpan = titik presisi (setara URL/join-lokasi) → nominal sah
    // di template, legitimasi sama dengan jalur link (sesi 779408).
    expect(res.suggestedTemplateReply).toMatch(/Rp\s*[\d.]+/);
    expect(res.suggestedTemplateReply).toMatch(/Rumah|Ongkir|promo/i);
  });
});

describe('Fase 3 — kontrak skema calculate_delivery (zod refine)', () => {
  it('tanpa locationText & tanpa savedAddressId → DITOLAK', () => {
    const v = validateToolArgs('calculate_delivery', {});
    expect(v.success).toBe(false);
  });

  it('cukup savedAddressId → SAH (pilihan alamat tersimpan)', () => {
    const v = validateToolArgs('calculate_delivery', { savedAddressId: 'addr-mertua' });
    expect(v.success).toBe(true);
    if (v.success) expect(v.data.savedAddressId).toBe('addr-mertua');
  });

  it('cukup locationText → SAH (jalur normal)', () => {
    const v = validateToolArgs('calculate_delivery', { locationText: 'Waru' });
    expect(v.success).toBe(true);
  });
});