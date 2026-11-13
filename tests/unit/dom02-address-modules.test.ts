import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as domain from '../../src/domain/customer-address';

/**
 * DOM-02 — modul buku alamat dipecah per tanggung jawab; file lama hanya
 * re-export agar seluruh pemanggil tetap kompatibel.
 */
const ROOT = process.cwd();

describe('DOM-02 struktur modul buku alamat', () => {
  it('customer-address.ts menjadi barrel tipis (<40 baris)', () => {
    const barrel = fs.readFileSync(path.join(ROOT, 'src/domain/customer-address.ts'), 'utf8');
    expect(barrel).toContain("export * from './customer-address/index'");
    expect(barrel.split(/\r?\n/).length).toBeLessThan(40);
  });

  it('submodul ada dan bertanggung jawab tunggal', () => {
    const base = path.join(ROOT, 'src/domain/customer-address');
    for (const file of ['types.ts', 'internal.ts', 'matching.ts', 'list.ts', 'tombstones.ts', 'index.ts']) {
      expect(fs.existsSync(path.join(base, file)), file).toBe(true);
    }
  });

  it('permukaan API lama tetap lengkap (re-export tidak memutus pemanggil)', () => {
    for (const fn of [
      'addressesMatch',
      'isRegionCompatible',
      'selectEnrichmentTarget',
      'normalizeAddressText',
      'buildAddressKey',
      'parseSavedAddresses',
      'buildAutoLabel',
      'ensureSinglePrimary',
      'reconcileAddressLists',
      'resolveActiveAddress',
      'removeAddressFromList',
      'upsertAddressIntoList',
      'parseAddressTombstones',
      'pruneAddressTombstones',
      'matchesTombstone',
      'removeMatchingTombstones',
      'wilayahTokenMatch',
      'normalizeAddressLabel',
    ]) {
      expect(typeof (domain as any)[fn], fn).toBe('function');
    }
    expect(domain.SavedCustomerAddressSchema).toBeDefined();
    expect(domain.AddressTombstoneSchema).toBeDefined();
    expect(domain.MAX_SAVED_ADDRESSES).toBe(10);
  });
});
