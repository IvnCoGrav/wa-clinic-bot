import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import { reservationLifecycleService } from '../../src/services/reservation-lifecycle.service';
import { customerService } from '../../src/services/customer.service';
import { deliveryService } from '../../src/services/delivery.service';

/**
 * Audit Kasus Suko (Bunda Chris 6281390541340): form reservasi dengan
 * kecamatan placeholder ("-") + kota luas ("Sidoarjo") membuat fallback
 * Gazetteer mengunci koordinat ke sentroid Kecamatan Sidoarjo = Desa SUKO
 * (-7.44615,112.678558), padahal customer TIDAK menyebut Suko.
 *
 * Gerbang fondasional: bila hasil gazetteer hanya selevel 'kecamatan' DAN
 * teks yang dicari hanyalah nama kota kanonis (dataset), JANGAN kunci koordinat
 * (biarkan null). Berbasis DATA (matchedLevel + canonical cities), bukan
 * hafalan kalimat; nama orang dilarang dipakai sebagai query wilayah.
 */

const SUKO_SIDOARJO = { lat: -7.44615, lng: 112.678558 };

async function runLifecycle(params: Record<string, unknown>) {
  const updateSpy = vi
    .spyOn(customerService, 'updateCustomerLocation')
    .mockResolvedValue({} as any);
  vi.spyOn(customerService, 'getCustomerById').mockResolvedValue({
    id: 'cust-homonym',
    distance_km: null,
    lat: null,
    lng: null,
  } as any);

  await reservationLifecycleService.onReservationCreated({
    tenantId: 'default-tenant',
    customerId: 'cust-homonym',
    reservationId: 'res-homonym',
    chatId: '6281390541340@c.us',
    ...params,
  } as any);

  // Semua dependency jaringan disuntik-mock (geocodeText/delivery) dan gazetteer
  // sinkron, sehingga pipeline background selesai dalam mikrotask. Beri jendela
  // settle yang tetap, lalu periksa — termasuk kasus "TIDAK menulis" (gate
  // memblokir), yang tidak punya sinyal completion eksplisit.
  const settleDeadline = Date.now() + 600;
  while (Date.now() < settleDeadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
  const coordCalls = updateSpy.mock.calls.filter((c: any[]) => c[1]?.lat != null);
  return { updateSpy, coordCalls };
}

function isNearSuko(lat: number, lng: number): boolean {
  return Math.abs(lat - SUKO_SIDOARJO.lat) < 0.02 && Math.abs(lng - SUKO_SIDOARJO.lng) < 0.02;
}

describe('reservation-lifecycle — gerbang homonim kota luas (anti Suko)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    const { resetCustomerRepository } = await import('../../src/repositories/customer.repository');
    resetCustomerRepository();

    const { geocodingService } = await import('../../src/integrations/google-maps/geocoding');
    vi.spyOn(geocodingService, 'geocodeText').mockResolvedValue({
      isPrecise: false,
      lat: null,
      lng: null,
    } as any);

    vi.spyOn(deliveryService, 'calculateDelivery').mockResolvedValue({
      distanceKm: 4.2,
      ongkir: 0,
      normalPrice: 0,
      promoPrice: 0,
      isOutOfCoverage: false,
      isEstimated: false,
      freeTierKm: 5,
      maxCoverageKm: 30,
      messageTemplate: '',
    } as any);
  });

  it('kecamatan "-" + kota "Sidoarjo" → koordinat TIDAK dikunci ke Suko', async () => {
    const { coordCalls } = await runLifecycle({
      address: 'Jl. Kyai Hadi',
      kecamatan: '-',
      kota: 'Sidoarjo',
    });
    for (const call of coordCalls) {
      const { lat, lng } = call[1];
      expect(isNearSuko(lat, lng), `terkunci ke Suko: ${lat},${lng}`).toBe(false);
    }
  });

  it('kota "Surabaya" saja → koordinat TIDAK dikunci ke sentroid kecamatan', async () => {
    const { coordCalls } = await runLifecycle({ kota: 'Surabaya' });
    // Surabaya bukan nama kecamatan/kelurahan di dataset; tidak boleh menebak Suko.
    for (const call of coordCalls) {
      const { lat, lng } = call[1];
      expect(isNearSuko(lat, lng)).toBe(false);
    }
  });

  it('non-regresi: "buduran, Sidoarjo" tetap ter-resolve ke Buduran (bukan diblokir)', async () => {
    const { coordCalls } = await runLifecycle({
      address: 'Perum Banjarmukti Blok G6a',
      kecamatan: 'Buduran',
      kota: 'Sidoarjo',
    });
    expect(coordCalls.length).toBeGreaterThan(0);
    const { lat, lng } = coordCalls[0][1];
    expect(isNearSuko(lat, lng)).toBe(false);
    expect(lat).toBeLessThan(-7.4); // Buduran ~ -7.4279
  });

  it('non-regresi: kecamatan "Waru" eksplisit tetap boleh (bukan Suko)', async () => {
    const { coordCalls } = await runLifecycle({
      address: 'Jl. Kyai Hadi',
      kecamatan: 'Waru',
      kota: 'Sidoarjo',
    });
    for (const call of coordCalls) {
      const { lat, lng } = call[1];
      expect(isNearSuko(lat, lng)).toBe(false);
    }
  });

  it('semua field kosong/simbol → tidak crash (tetap best-effort)', async () => {
    await expect(
      runLifecycle({ kecamatan: '-', kota: '' })
    ).resolves.toBeDefined();
  });
});
