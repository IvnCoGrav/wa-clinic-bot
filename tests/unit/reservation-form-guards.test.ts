import { describe, it, expect } from 'vitest';
import {
  buildAutoPopulateKey,
  buildSlotTargetKey,
  buildBabiesContentKey,
  shouldRunGuard,
} from '../../packages/admin-dashboard/src/utils/reservationFormGuards';

describe('reservationFormGuards — anti render-churn form reservasi (KNOWN #341)', () => {
  it('kunci auto-populate memakai id stabil, bukan identitas objek', () => {
    expect(buildAutoPopulateKey('cust-1', 'cust-1')).toBe('cust-1');
    expect(buildAutoPopulateKey(undefined, 'cust-2')).toBe('cust-2');
    expect(buildAutoPopulateKey(null, null)).toBe('');
  });

  it('shouldRunGuard hanya true bila kunci berubah & tidak kosong', () => {
    expect(shouldRunGuard(null, 'cust-1')).toBe(true);
    expect(shouldRunGuard('cust-1', 'cust-1')).toBe(false);
    expect(shouldRunGuard('cust-1', '')).toBe(false);
  });

  it('kunci slot identik untuk objek berbeda dengan isi sama', () => {
    const a = { date: '2026-11-20', hour: 9, staffId: 's1' };
    const b = { date: '2026-11-20', hour: 9, staffId: 's1' };
    expect(buildSlotTargetKey(a)).toBe(buildSlotTargetKey(b));
    expect(buildSlotTargetKey(a)).not.toBe(buildSlotTargetKey({ ...a, hour: 10 }));
  });

  it('kunci konten anak tidak berubah meski array baru dengan isi sama', () => {
    const a = buildBabiesContentKey([{ name: 'Audrey', ageText: '11 bulan' }]);
    const b = buildBabiesContentKey([{ name: ' audrey ', ageText: '11 BULAN' }]);
    expect(a).toBe(b);
    expect(a).not.toBe(buildBabiesContentKey([{ name: 'Ahan', ageText: '3 bulan' }]));
  });

  it('kunci anak kosong untuk null/undefined', () => {
    expect(buildBabiesContentKey(null)).toBe('');
    expect(buildBabiesContentKey(undefined)).toBe('');
    expect(buildBabiesContentKey([])).toBe('');
  });
});
