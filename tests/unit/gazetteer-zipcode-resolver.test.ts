import { describe, it, expect, beforeEach } from 'vitest';
import { resolveZipcode, __resetGazetteerResolverCache } from '../../src/utils/gazetteer-zipcode-resolver';

describe('Gazetteer Zipcode Resolver', () => {
  beforeEach(() => {
    __resetGazetteerResolverCache();
  });

  it('precise kelurahan+kecamatan lookup', () => {
    expect(resolveZipcode({ kelurahan: 'Sawotratap', kecamatan: 'Gedangan' })).toBe('61254');
    expect(resolveZipcode({ kelurahan: 'Keputih', kecamatan: 'Sukolilo' })).toBe('60111');
    expect(resolveZipcode({ kelurahan: 'keputih', kecamatan: 'sukolilo' })).toBe('60111'); // case-insensitive
  });

  it('kecamatan fallback representative', () => {
    expect(resolveZipcode({ kecamatan: 'Gedangan' })).toBe('61254');
    expect(resolveZipcode({ kecamatan: 'Sedati' })).toBe('61253');
    expect(resolveZipcode({ kecamatan: 'Waru' })).toBe('61256');
    expect(resolveZipcode({ kecamatan: 'Rungkut' })).toBe('60293');
    expect(resolveZipcode({ kecamatan: 'Lakarsantri' })).toBe('60213');
    expect(resolveZipcode({ kecamatan: 'Wonokromo' })).toBe('60243'); // override tie-break
  });

  it('free-text entity match dari nama/alamat', () => {
    expect(resolveZipcode({ text: 'Bunda Retno Gedangan' })).toBe('61254');
    expect(resolveZipcode({ text: 'Bunda Dynda Sedati' })).toBe('61253');
    expect(resolveZipcode({ text: 'Bunda Biyan Wonokromo' })).toBe('60243');
    expect(resolveZipcode({ text: 'Sawotratap Gedangan Sidoarjo' })).toBe('61254');
  });

  it('returns null for unknown location', () => {
    expect(resolveZipcode({ text: 'Bunda Sari Jakarta Pusat' })).toBeNull();
    expect(resolveZipcode({})).toBeNull();
    expect(resolveZipcode({ text: '' })).toBeNull();
  });

  it('kota-only tidak menghasilkan false positive', () => {
    // hanya kota surabaya/sidoarjo tanpa kec/kel tidak boleh match
    expect(resolveZipcode({ kota: 'Surabaya' })).toBeNull();
  });
});
