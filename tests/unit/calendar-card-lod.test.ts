import { describe, expect, it } from 'vitest';
import {
  DAY_CARD_LOD,
  computeDayCardLod,
} from '../../packages/admin-dashboard/src/utils/calendarCardLod';

/**
 * F-32: isi kartu Harian lebih tinggi dari kotaknya, sehingga `overflow-hidden`
 * memotong elemen terakhir — yaitu nama bidan.
 *
 * Invariant yang dijaga test ini:
 * 1. Nama bidan (baris paling bawah) **tidak pernah** digating oleh LOD.
 * 2. Elemen yang dibuang lebih dulu adalah yang prioritasnya paling rendah:
 *    detail treatment → area.
 * 3. Ambang aman untuk tinggi kartu nyata pada ketiga level zoom.
 */
describe('computeDayCardLod', () => {
  // Tinggi kartu nyata: heightPx = max(minCardHeight, duration/60 × hourHeight − 4)
  const TINGGI_SLOT_60_MENIT = {
    compact: 48, // hourHeight 52, minCardHeight 36
    normal: 86, // hourHeight 90, minCardHeight 52
    detailed: 146, // hourHeight 150, minCardHeight 52
  };

  it('slot 60 menit di zoom normal tetap menampilkan area', () => {
    expect(computeDayCardLod(TINGGI_SLOT_60_MENIT.normal).showArea).toBe(true);
  });

  it('slot 60 menit di zoom normal TIDAK memaksa detail treatment tampil', () => {
    // Bukan bug: detail dibuang lebih dulu agar baris bidan tidak terpotong.
    expect(computeDayCardLod(TINGGI_SLOT_60_MENIT.normal).showDetail).toBe(false);
  });

  it('zoom detailed menampilkan detail + area', () => {
    const lod = computeDayCardLod(TINGGI_SLOT_60_MENIT.detailed);
    expect(lod.showDetail).toBe(true);
    expect(lod.showArea).toBe(true);
  });

  it('kartu pendek (zoom compact) hanya menyisakan nama + jam + bidan', () => {
    const lod = computeDayCardLod(TINGGI_SLOT_60_MENIT.compact);
    expect(lod.showDetail).toBe(false);
    expect(lod.showArea).toBe(false);
  });

  it('membuang detail LEBIH DULU daripada area (urutan prioritas)', () => {
    // Cari titik di mana area sudah tampil tapi detail belum.
    const areaOnly = DAY_CARD_LOD.AREA_MIN_PX;
    expect(computeDayCardLod(areaOnly).showArea).toBe(true);
    expect(computeDayCardLod(areaOnly).showDetail).toBe(false);
  });

  it('ambang area lebih rendah dari ambang detail (tidak mungkin terbalik)', () => {
    expect(DAY_CARD_LOD.AREA_MIN_PX).toBeLessThan(DAY_CARD_LOD.DETAIL_MIN_PX);
  });

  it('tidak ada properti yang menggate baris bidan', () => {
    const lod = computeDayCardLod(0) as Record<string, unknown>;
    expect(Object.keys(lod).sort()).toEqual(['showArea', 'showDetail']);
    expect('showStaff' in lod).toBe(false);
  });

  it('tahan terhadap tinggi tidak wajar / kosong', () => {
    expect(computeDayCardLod(null)).toEqual({ showArea: false, showDetail: false });
    expect(computeDayCardLod(undefined)).toEqual({ showArea: false, showDetail: false });
    expect(computeDayCardLod(NaN)).toEqual({ showArea: false, showDetail: false });
    expect(computeDayCardLod(-10)).toEqual({ showArea: false, showDetail: false });
    expect(computeDayCardLod(Infinity).showArea).toBe(true);
  });
});
