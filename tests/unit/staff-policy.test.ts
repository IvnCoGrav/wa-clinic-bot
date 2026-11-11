import { describe, it, expect } from 'vitest';
import {
  validateStaffPassword,
  normalizeStaffRole,
  BUILTIN_STAFF_ROLES,
} from '../../src/utils/staff-policy';

/** S-012: kebijakan password staf — murni, tanpa DB. */
describe('Kebijakan password & role staf (S-012)', () => {
  it('menolak password pendek / tanpa huruf / tanpa angka', () => {
    expect(validateStaffPassword('Ab1').ok).toBe(false);
    expect(validateStaffPassword('abcdefgh').ok).toBe(false);
    expect(validateStaffPassword('12345678').ok).toBe(false);
    expect(validateStaffPassword('').ok).toBe(false);
    expect(validateStaffPassword(undefined).ok).toBe(false);
  });

  it('menerima password minimal 8 karakter dengan huruf + angka', () => {
    expect(validateStaffPassword('Secret12345').ok).toBe(true);
    expect(validateStaffPassword('bidan2026').ok).toBe(true);
  });

  it('menolak password melebihi batas bcrypt (72)', () => {
    expect(validateStaffPassword('A1' + 'x'.repeat(80)).ok).toBe(false);
  });

  it('normalisasi role aman (tidak bebas karakter)', () => {
    expect(normalizeStaffRole(' therapist ')).toBe('THERAPIST');
    expect(normalizeStaffRole('admin cs')).toBe('ADMIN_CS');
    expect(BUILTIN_STAFF_ROLES.has('SUPER_ADMIN')).toBe(true);
  });
});
