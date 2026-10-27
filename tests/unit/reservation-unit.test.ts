import { describe, it, expect } from 'vitest';
import {
  unitKeyOf,
  isCommercialAnchor,
  assignUnitOrdinals,
  UnitRow,
} from '../../src/services/reservation-unit';

describe('Unit Komersial Kanonis (reservation-unit)', () => {
  it('unitKeyOf membedakan series vs single reservation', () => {
    expect(unitKeyOf({ id: 'res-1', series_id: null })).toBe('res:res-1');
    expect(unitKeyOf({ id: 'res-1', series_id: 'series-abc' })).toBe('series:series-abc');
  });

  it('isCommercialAnchor hanya mengizinkan sesi 1 atau reservasi tunggal', () => {
    // Single reservation (tanpa series)
    expect(isCommercialAnchor({ series_id: null, session_number: null })).toBe(true);

    // Series: Sesi 1 adalah anchor
    expect(isCommercialAnchor({ series_id: 'series-1', session_number: 1 })).toBe(true);

    // Series: Sesi 2..7 BUKAN anchor komersial
    for (let s = 2; s <= 7; s++) {
      expect(isCommercialAnchor({ series_id: 'series-1', session_number: s })).toBe(false);
    }
  });

  it('1. 7 sesi created_at IDENTIK → seluruh sesi mendapatkan ordinal 1 (satu unit komersial)', () => {
    const identicalTime = new Date('2026-10-27T08:00:00Z');
    const seriesRows: UnitRow[] = Array.from({ length: 7 }, (_, i) => ({
      id: `res-session-${i + 1}`,
      customer_id: 'cust-1',
      created_at: identicalTime,
      series_id: 'series-pack-1',
      session_number: i + 1,
    }));

    const ordinals = assignUnitOrdinals(seriesRows);

    // Semua sesi berada di bawah key yang sama 'series:series-pack-1'
    expect(ordinals.get('series:series-pack-1')).toBe(1);
    // Tidak ada key per individual reservation id untuk series
    expect(ordinals.has('res:res-session-1')).toBe(false);
  });

  it('2. Paket kedua dibuat belakangan → ordinal 2 untuk ke-7 sesi paket 2', () => {
    const t1 = new Date('2026-10-01T08:00:00Z');
    const t2 = new Date('2026-10-15T08:00:00Z');

    const pack1: UnitRow[] = Array.from({ length: 7 }, (_, i) => ({
      id: `pack1-res-${i + 1}`,
      customer_id: 'cust-1',
      created_at: t1,
      series_id: 'series-pack-1',
      session_number: i + 1,
    }));

    const pack2: UnitRow[] = Array.from({ length: 7 }, (_, i) => ({
      id: `pack2-res-${i + 1}`,
      customer_id: 'cust-1',
      created_at: t2,
      series_id: 'series-pack-2',
      session_number: i + 1,
    }));

    const all = [...pack1, ...pack2];
    const ordinals = assignUnitOrdinals(all);

    expect(ordinals.get('series:series-pack-1')).toBe(1);
    expect(ordinals.get('series:series-pack-2')).toBe(2);
  });

  it('3. Paket + reservasi tunggal campur → ordinal dihitung per urutan waktu unit komersial', () => {
    const t1 = new Date('2026-09-01T08:00:00Z'); // single order #1
    const t2 = new Date('2026-10-01T08:00:00Z'); // series 7 sessions #2
    const t3 = new Date('2026-11-01T08:00:00Z'); // single order #3

    const rows: UnitRow[] = [
      { id: 'single-1', customer_id: 'cust-1', created_at: t1, series_id: null },
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `series-res-${i + 1}`,
        customer_id: 'cust-1',
        created_at: t2,
        series_id: 'series-100',
        session_number: i + 1,
      })),
      { id: 'single-2', customer_id: 'cust-1', created_at: t3, series_id: null },
    ];

    const ordinals = assignUnitOrdinals(rows);

    expect(ordinals.get('res:single-1')).toBe(1);
    expect(ordinals.get('series:series-100')).toBe(2);
    expect(ordinals.get('res:single-2')).toBe(3);
  });

  it('4. Multi-customer isolation: ordinal masing-masing customer independen', () => {
    const t1 = new Date('2026-10-01T08:00:00Z');
    const t2 = new Date('2026-10-05T08:00:00Z');

    const rows: UnitRow[] = [
      { id: 'c1-res-1', customer_id: 'cust-A', created_at: t1, series_id: 'series-A' },
      { id: 'c2-res-1', customer_id: 'cust-B', created_at: t2, series_id: 'series-B' },
    ];

    const ordinals = assignUnitOrdinals(rows);

    // Keduanya order pertama bagi masing-masing customer
    expect(ordinals.get('series:series-A')).toBe(1);
    expect(ordinals.get('series:series-B')).toBe(1);
  });

  it('5. Determinisme input urutan acak (shuffle): hasil ordinal tetap identik', () => {
    const t1 = new Date('2026-09-01T08:00:00Z');
    const t2 = new Date('2026-10-01T08:00:00Z');
    const t3 = new Date('2026-11-01T08:00:00Z');

    const rows: UnitRow[] = [
      { id: 'r1', customer_id: 'cust-1', created_at: t1, series_id: 's-1', session_number: 1 },
      { id: 'r2', customer_id: 'cust-1', created_at: t1, series_id: 's-1', session_number: 2 },
      { id: 'r3', customer_id: 'cust-1', created_at: t2, series_id: null },
      { id: 'r4', customer_id: 'cust-1', created_at: t3, series_id: 's-2', session_number: 1 },
      { id: 'r5', customer_id: 'cust-1', created_at: t3, series_id: 's-2', session_number: 2 },
    ];

    const ordinalsNormal = assignUnitOrdinals(rows);

    // Shuffled version
    const shuffled = [rows[3], rows[0], rows[4], rows[1], rows[2]];
    const ordinalsShuffled = assignUnitOrdinals(shuffled);

    expect(ordinalsShuffled.get('series:s-1')).toBe(ordinalsNormal.get('series:s-1'));
    expect(ordinalsShuffled.get('res:r3')).toBe(ordinalsNormal.get('res:r3'));
    expect(ordinalsShuffled.get('series:s-2')).toBe(ordinalsNormal.get('series:s-2'));

    expect(ordinalsShuffled.get('series:s-1')).toBe(1);
    expect(ordinalsShuffled.get('res:r3')).toBe(2);
    expect(ordinalsShuffled.get('series:s-2')).toBe(3);
  });
});
