import { describe, expect, it } from 'vitest';
import { resolveOwnershipBadge } from '../../packages/admin-dashboard/src/utils/staffOwnershipBadge';

const base = {
  ownerStaffId: 's1',
  ownerStaffName: 'Bidan Hanifah',
  ownerSince: '2026-01-12',
  lastStaffId: 's1',
  lastStaffName: 'Bidan Hanifah',
  lastVisitDate: '2026-02-03',
  totalVisits: 5,
  hasRotation: false,
  ownerInactive: false,
};

describe('resolveOwnershipBadge', () => {
  it('null + showNew=false → tidak tampil', () => {
    expect(resolveOwnershipBadge(null).show).toBe(false);
  });

  it('null + showNew=true → Pasien baru', () => {
    const model = resolveOwnershipBadge(null, { showNew: true });
    expect(model.show).toBe(true);
    expect(model.label).toBe('Pasien baru');
    expect(model.tone).toBe('neutral');
  });

  it('pemilik aktif tanpa rotasi → violet', () => {
    const model = resolveOwnershipBadge(base);
    expect(model.tone).toBe('violet');
    expect(model.label).toContain('Hanifah');
  });

  it('rotasi → amber dan menyebut bidan terakhir', () => {
    const model = resolveOwnershipBadge({ ...base, hasRotation: true, lastStaffName: 'Bidan Thabita' });
    expect(model.tone).toBe('amber');
    expect(model.label).toContain('Thabita');
  });

  it('pemilik nonaktif → gray + (nonaktif)', () => {
    const model = resolveOwnershipBadge({ ...base, ownerInactive: true });
    expect(model.tone).toBe('gray');
    expect(model.label).toContain('nonaktif');
  });

  it('kunjungan ada tapi owner tidak tercatat → gray', () => {
    const model = resolveOwnershipBadge({ ...base, ownerStaffId: null, ownerStaffName: null });
    expect(model.tone).toBe('gray');
    expect(model.label).toBe('Bidan belum tercatat');
  });

  it('compact memakai nama pendek', () => {
    const model = resolveOwnershipBadge(base, { compact: true });
    expect(model.label).toBe('Hanifah');
  });
});
