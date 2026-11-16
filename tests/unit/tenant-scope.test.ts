import { describe, it, expect } from 'vitest';
import { tenantScopedRow } from '../../src/utils/tenant-scope';

/**
 * Gerbang isolasi tenant kanonis (S2-1).
 * Adversarial: memastikan tidak ada kebocoran lintas tenant pada semua bentuk
 * baris (null, tanpa tenant_id, tenant sama, tenant berbeda, guard nonaktif).
 */
describe('tenantScopedRow — isolasi tenant pembacaan baris', () => {
  const row = { id: 'row-1', tenant_id: 'tenant-a' };

  it('baris null/undefined → null', () => {
    expect(tenantScopedRow(null, 'tenant-a')).toBeNull();
    expect(tenantScopedRow(undefined, 'tenant-a')).toBeNull();
  });

  it('tenant cocok → objek yang sama (tanpa clone)', () => {
    const result = tenantScopedRow(row, 'tenant-a');
    expect(result).toBe(row);
  });

  it('tenant berbeda → null (anti-bocor lintas tenant)', () => {
    expect(tenantScopedRow(row, 'tenant-b')).toBeNull();
  });

  it('tenantId pemanggil kosong → guard nonaktif, baris dikembalikan (perilaku lama)', () => {
    expect(tenantScopedRow(row, '')).toBe(row);
  });

  it('baris data lama tanpa tenant_id → dikembalikan', () => {
    const legacy = { id: 'row-legacy' };
    expect(tenantScopedRow(legacy, 'tenant-a')).toBe(legacy);
  });

  it('tenant_id baris null/string kosong → tidak dapat dibuktikan tenant lain, dikembalikan', () => {
    expect(tenantScopedRow({ id: 'r', tenant_id: null }, 'tenant-a')).not.toBeNull();
    expect(tenantScopedRow({ id: 'r', tenant_id: '' }, 'tenant-a')).not.toBeNull();
  });

  it('baris dengan field lain tetap utuh dan tidak termutasi', () => {
    const full = { id: 'r', tenant_id: 'tenant-a', name: 'Bunda', closed_at: null };
    const result = tenantScopedRow(full, 'tenant-a');
    expect(result).toEqual({ id: 'r', tenant_id: 'tenant-a', name: 'Bunda', closed_at: null });
    expect(full.tenant_id).toBe('tenant-a');
  });
});
