import { describe, expect, it } from 'vitest';
import {
  STAFF_COLOR_PALETTE,
  UNASSIGNED_STAFF_COLOR,
  getStaffColor,
  shortStaffLabel,
} from '../../packages/admin-dashboard/src/utils/staffColors';
import { resolveStaffId } from '../../packages/admin-dashboard/src/utils/resolveStaffName';

const staffList = [
  { id: 'st-1', name: 'Bidan Ani' },
  { id: 'st-2', name: 'Bidan Budi' },
  { id: 'st-3', name: 'Bidan Citra' },
];

describe('resolveStaffId', () => {
  it('mengutamakan relasi hasil join backend', () => {
    expect(
      resolveStaffId({ assigned_staff: { id: 'rel-1' }, assigned_staff_id: 'fk-1' })
    ).toBe('rel-1');
  });

  it('mendukung varian camelCase dari serialisasi', () => {
    expect(resolveStaffId({ assignedStaff: { id: 'rel-2' } })).toBe('rel-2');
    expect(resolveStaffId({ assignedStaffId: 'fk-2' })).toBe('fk-2');
    expect(resolveStaffId({ staffId: 'fk-3' })).toBe('fk-3');
  });

  it('jatuh ke FK bila relasi tidak membawa id', () => {
    expect(resolveStaffId({ assigned_staff: { name: 'Ani' }, assigned_staff_id: 'fk-9' })).toBe(
      'fk-9'
    );
  });

  it('mengembalikan null untuk sumber kosong / string kosong', () => {
    expect(resolveStaffId(null)).toBeNull();
    expect(resolveStaffId(undefined)).toBeNull();
    expect(resolveStaffId({})).toBeNull();
    expect(resolveStaffId({ assigned_staff_id: '' })).toBeNull();
    expect(resolveStaffId({ assigned_staff: {} })).toBeNull();
  });

  it('tidak crash untuk tipe data salah', () => {
    expect(resolveStaffId({ assigned_staff: null, assigned_staff_id: 0 })).toBeNull();
    expect(resolveStaffId({ staffId: { nested: true } as unknown as string })).toBeTruthy();
  });
});

describe('getStaffColor', () => {
  it('memberi warna netral bila reservasi belum punya bidan', () => {
    expect(getStaffColor(null, staffList)).toBe(UNASSIGNED_STAFF_COLOR);
    expect(getStaffColor(undefined, staffList)).toBe(UNASSIGNED_STAFF_COLOR);
    expect(getStaffColor('', staffList)).toBe(UNASSIGNED_STAFF_COLOR);
  });

  it('mengikuti urutan daftar staff (bukan hash)', () => {
    expect(getStaffColor('st-1', staffList)).toBe(STAFF_COLOR_PALETTE[0]);
    expect(getStaffColor('st-2', staffList)).toBe(STAFF_COLOR_PALETTE[1]);
    expect(getStaffColor('st-3', staffList)).toBe(STAFF_COLOR_PALETTE[2]);
  });

  it('menjamin warna berbeda untuk setiap bidan (sampai sepanjang palet)', () => {
    const many = Array.from({ length: STAFF_COLOR_PALETTE.length }, (_, i) => ({
      id: `st-${i}`,
      name: `Bidan ${i}`,
    }));
    const dots = many.map((s) => getStaffColor(s.id, many).dot);
    expect(new Set(dots).size).toBe(STAFF_COLOR_PALETTE.length);
  });

  it('membungkus palet bila bidan melebihi jumlah warna', () => {
    const many = Array.from({ length: STAFF_COLOR_PALETTE.length + 2 }, (_, i) => ({
      id: `st-${i}`,
      name: `Bidan ${i}`,
    }));
    const last = many.length - 1;
    expect(getStaffColor(many[last].id, many)).toBe(
      STAFF_COLOR_PALETTE[last % STAFF_COLOR_PALETTE.length]
    );
  });

  it('stabil (deterministik) bila daftar staff belum dimuat', () => {
    const a = getStaffColor('unknown-staff-id', []);
    const b = getStaffColor('unknown-staff-id', null);
    const c = getStaffColor('unknown-staff-id', undefined);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(STAFF_COLOR_PALETTE).toContain(a);
  });

  it('tetap memberi warna palet untuk bidan nonaktif yang tidak ada di daftar', () => {
    const color = getStaffColor('st-nonaktif', staffList);
    expect(STAFF_COLOR_PALETTE).toContain(color);
  });

  it('tahan terhadap entri daftar yang korup (null / tanpa id)', () => {
    const dirty = [null, { name: 'Tanpa ID' }, { id: 'st-2', name: 'Budi' }] as unknown as Array<{
      id: string;
    }>;
    expect(getStaffColor('st-2', dirty)).toBe(STAFF_COLOR_PALETTE[2]);
  });

  it('setiap tema membawa kelas kartu, badge, dan titik legenda', () => {
    for (const theme of [...STAFF_COLOR_PALETTE, UNASSIGNED_STAFF_COLOR]) {
      expect(theme.card.length).toBeGreaterThan(0);
      expect(theme.badge.length).toBeGreaterThan(0);
      expect(theme.dot.length).toBeGreaterThan(0);
      // Kelas dark mode wajib ada agar tidak menyilaukan di tema gelap.
      expect(theme.card).toContain('dark:bg-');
      expect(theme.dot).toContain('dark:bg-');
    }
  });

  it('tidak memakai kelas Tailwind rusak (garis miring ganda)', () => {
    for (const theme of [...STAFF_COLOR_PALETTE, UNASSIGNED_STAFF_COLOR]) {
      expect(theme.card).not.toMatch(/\/\d+\/\d+/);
      expect(theme.badge).not.toMatch(/\/\d+\/\d+/);
    }
  });
});

describe('shortStaffLabel', () => {
  it('mengambil kata pertama', () => {
    expect(shortStaffLabel('Bidan Ani Suryani')).toBe('Bidan');
  });

  it('memberi label cadangan untuk nama kosong', () => {
    expect(shortStaffLabel(null)).toBe('Tanpa nama');
    expect(shortStaffLabel('   ')).toBe('Tanpa nama');
  });
});
