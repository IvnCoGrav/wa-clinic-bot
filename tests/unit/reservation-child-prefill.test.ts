import { describe, it, expect } from 'vitest';
import {
  mapChildrenToBabyInputs,
  isChildSelected,
  toggleChildSelection,
} from '../../packages/admin-dashboard/src/utils/reservationChildPrefill';

const children = [
  { name: 'Audrey', current_age: '11 bulan 21 hari', raw_age_text: '11 bln' },
  { name: '  Ahan  ', raw_age_text: '3 bulan' },
  { name: '', current_age: '2 bulan' },
];

describe('reservationChildPrefill — data anak reusable (KNOWN #340)', () => {
  it('memetakan children menjadi input nama + usia, mengabaikan nama kosong', () => {
    const out = mapChildrenToBabyInputs(children as any);
    expect(out).toEqual([
      { name: 'Audrey', ageText: '11 bulan 21 hari' },
      { name: 'Ahan', ageText: '3 bulan' },
    ]);
  });

  it('children kosong / bukan array → array kosong', () => {
    expect(mapChildrenToBabyInputs(null)).toEqual([]);
    expect(mapChildrenToBabyInputs(undefined)).toEqual([]);
    expect(mapChildrenToBabyInputs({} as any)).toEqual([]);
  });

  it('isChildSelected tidak sensitif huruf & spasi', () => {
    expect(isChildSelected([{ name: 'audrey', ageText: 'x' }], children[0] as any)).toBe(true);
    expect(isChildSelected([{ name: 'Ahan', ageText: 'x' }], children[1] as any)).toBe(true);
    expect(isChildSelected([{ name: 'Budi', ageText: 'x' }], children[0] as any)).toBe(false);
  });

  it('toggle menambah anak yang belum dipilih', () => {
    const out = toggleChildSelection([], children[0] as any);
    expect(out).toEqual([{ name: 'Audrey', ageText: '11 bulan 21 hari' }]);
  });

  it('toggle menghapus anak yang sudah dipilih', () => {
    const out = toggleChildSelection([{ name: 'Audrey', ageText: 'x' }], children[0] as any);
    expect(out).toEqual([]);
  });
});
