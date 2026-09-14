import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock minimal prisma + service untuk meniru jalur reservations.subroute.ts sync customer
// Fokus: address TIDAK boleh jadi kolom, melainkan preferences.address

function buildCustUpdate(input: { address?: string; landmark?: string; kecamatan?: string; kota?: string; kelurahan?: string; customerName?: string; customerPhone?: string }, existing: any) {
  const { address, landmark, kecamatan, kota, kelurahan, customerName, customerPhone } = input as any;
  const custUpdate: any = {};
  if (customerName) custUpdate.name = customerName;
  if (customerPhone) custUpdate.phone = customerPhone.replace(/\D/g, '');
  if (kecamatan) custUpdate.kecamatan = kecamatan;
  if (kota) custUpdate.kota = kota;
  if (kelurahan) custUpdate.kelurahan = kelurahan;
  if (address || landmark) {
    const currentPrefs = (existing.customer?.preferences as any) || {};
    const nextPrefs: any = { ...currentPrefs };
    if (address) nextPrefs.address = address;
    if (landmark) nextPrefs.landmark = landmark;
    custUpdate.preferences = nextPrefs;
    if (address && !custUpdate.kelurahan && !(existing.customer as any)?.kelurahan) {
      custUpdate.kelurahan = String(address).substring(0, 100);
    }
  }
  return custUpdate;
}

describe('Fase 4 — Admin Update Reservation Safe Address (Anti-500)', () => {
  it('address disimpan ke preferences.address, bukan kolom address', () => {
    const existing = { customer: { preferences: { foo: 'bar' }, kelurahan: null } };
    const upd = buildCustUpdate({ address: 'Jl. Bumiarjo Gang 7 No.14B' }, existing);
    expect(upd.address).toBeUndefined();
    expect(upd.preferences.address).toBe('Jl. Bumiarjo Gang 7 No.14B');
    expect(upd.preferences.foo).toBe('bar');
    expect(upd.kelurahan).toBe('Jl. Bumiarjo Gang 7 No.14B');
  });

  it('address + landmark digabung tanpa saling timpa', () => {
    const existing = { customer: { preferences: { address: 'lama' }, kelurahan: 'Semampir' } };
    const upd = buildCustUpdate({ address: 'Jl. Baru 1', landmark: 'dekat masjid' }, existing);
    expect(upd.preferences.address).toBe('Jl. Baru 1');
    expect(upd.preferences.landmark).toBe('dekat masjid');
    expect(upd.kelurahan).toBeUndefined(); // sudah ada kelurahan → tidak timpa
  });

  it('tanpa address/landmark tidak menyentuh preferences', () => {
    const existing = { customer: { preferences: {} } };
    const upd = buildCustUpdate({ kecamatan: 'Sedati' }, existing);
    expect(upd.preferences).toBeUndefined();
    expect(upd.kecamatan).toBe('Sedati');
  });

  it('assigned_staff_id string kosong → null (FK-safe)', () => {
    const updateData: any = {};
    const assignedStaffId: any = '';
    updateData.assigned_staff_id = assignedStaffId || null;
    expect(updateData.assigned_staff_id).toBeNull();
    const assigned2: any = 'staff-uuid';
    const d2: any = {}; d2.assigned_staff_id = assigned2 || null;
    expect(d2.assigned_staff_id).toBe('staff-uuid');
  });
});
