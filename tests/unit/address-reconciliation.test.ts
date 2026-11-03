import { describe, it, expect } from 'vitest';
import { buildReconciliationPlan, tableRowToSaved } from '../../src/domain/address-reconciliation';

const NOW = '2026-11-03T10:00:00.000Z';

const card = (o: any = {}) => ({
  id: 'a',
  label: 'Rumah A',
  address: 'Jl. A 1',
  kelurahan: 'Waru',
  kecamatan: 'Waru',
  kota: 'Sidoarjo',
  lat: null,
  lng: null,
  distanceKm: null,
  ongkir: null,
  landmark: null,
  locationSource: null,
  isPrimary: true,
  createdAt: NOW,
  lastUsedAt: NOW,
  ...o,
});

const row = (o: any = {}) => ({
  id: 'a',
  label: 'Rumah A',
  address: 'Jl. A 1',
  kelurahan: 'Waru',
  kecamatan: 'Waru',
  kota: 'Sidoarjo',
  lat: null,
  lng: null,
  distance_km: null,
  ongkir: null,
  landmark: null,
  location_source: null,
  is_primary: true,
  created_at: NOW,
  last_used_at: NOW,
  ...o,
});

describe('buildReconciliationPlan — JSON <-> tabel customer_addresses', () => {
  it('R1. baris yatim yang dipakai reservasi → DIADOPSI, primary ikut tabel', () => {
    const plan = buildReconciliationPlan(
      [card({ id: 'a', isPrimary: false })],
      [row({ id: 'a', is_primary: false }), row({ id: 'orphan', is_primary: true, label: 'Rumah Orphan' })],
      new Set(['orphan'])
    );
    expect(plan.adoptedIds).toEqual(['orphan']);
    expect(plan.deletedIds).toEqual([]);
    expect(plan.nextJson.map((x) => x.id).sort()).toEqual(['a', 'orphan']);
    expect(plan.primaryId).toBe('orphan');
    expect(plan.nextJson.find((x) => x.id === 'orphan')?.isPrimary).toBe(true);
  });

  it('R2. baris yatim TANPA reservasi → DIHAPUS dari tabel', () => {
    const plan = buildReconciliationPlan(
      [card({ id: 'a' })],
      [row({ id: 'a' }), row({ id: 'ghost', is_primary: false })],
      new Set()
    );
    expect(plan.deletedIds).toEqual(['ghost']);
    expect(plan.adoptedIds).toEqual([]);
    expect(plan.nextJson.map((x) => x.id)).toEqual(['a']);
  });

  it('R3. kartu JSON-only tetap ada di rencana upsert, primary tabel dipertahankan', () => {
    const plan = buildReconciliationPlan(
      [card({ id: 'a' }), card({ id: 'json-only', isPrimary: false })],
      [row({ id: 'a', is_primary: true })],
      new Set()
    );
    expect(plan.nextJson.map((x) => x.id).sort()).toEqual(['a', 'json-only']);
    expect(plan.primaryId).toBe('a');
    expect(plan.nextJson.filter((x) => x.isPrimary)).toHaveLength(1);
  });

  it('R4. JSON kosong + baris tabel → adopsi yang dipakai reservasi, hapus sisanya', () => {
    const plan = buildReconciliationPlan(
      [],
      [row({ id: 'used', is_primary: true }), row({ id: 'unused', is_primary: false })],
      new Set(['used'])
    );
    expect(plan.adoptedIds).toEqual(['used']);
    expect(plan.deletedIds).toEqual(['unused']);
    expect(plan.nextJson.map((x) => x.id)).toEqual(['used']);
    expect(plan.primaryId).toBe('used');
  });

  it('R5. tanpa drift → tidak ada adopsi/penghapusan dan primary tetap', () => {
    const plan = buildReconciliationPlan([card({ id: 'a' })], [row({ id: 'a' })], new Set());
    expect(plan.adoptedIds).toEqual([]);
    expect(plan.deletedIds).toEqual([]);
    expect(plan.nextJson).toHaveLength(1);
    expect(plan.primaryId).toBe('a');
  });

  it('R6. konflik primary: tabel menang atas JSON (sumber operasional)', () => {
    const plan = buildReconciliationPlan(
      [card({ id: 'json-primary', isPrimary: true }), card({ id: 'table-primary', isPrimary: false })],
      [row({ id: 'json-primary', is_primary: false }), row({ id: 'table-primary', is_primary: true })],
      new Set()
    );
    expect(plan.primaryId).toBe('table-primary');
    expect(plan.nextJson.find((x) => x.id === 'table-primary')?.isPrimary).toBe(true);
    expect(plan.nextJson.find((x) => x.id === 'json-primary')?.isPrimary).toBe(false);
  });

  it('R7. normalisasi baris tabel snake_case → camelCase', () => {
    const saved = tableRowToSaved(
      row({ id: 'x', label: '  Rumah X  ', address: 'Jl. X', distance_km: 3.2, ongkir: 15000, location_source: 'gps_pin' })
    );
    expect(saved.id).toBe('x');
    expect(saved.label).toBe('Rumah X');
    expect(saved.address).toBe('Jl. X');
    expect(saved.distanceKm).toBe(3.2);
    expect(saved.ongkir).toBe(15000);
    expect(saved.locationSource).toBe('gps_pin');
  });
});
