import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * PLAN 8 FASE 2b — coverage config data-driven.
 * Wilayah cakupan dibaca dari env (CSV), fallback ke default historis.
 */

const ORIG_ENV = { ...process.env };

async function loadCoverage() {
  vi.resetModules();
  return await import('../../src/config/coverage');
}

describe('FASE 2b — coverage config', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.COVERAGE_CITIES;
    delete process.env.COVERAGE_INSIDE_REGIONS;
    delete process.env.OUTSIDE_CITIES;
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
    vi.resetModules();
  });

  it('default: daftar historis dipakai bila env kosong', async () => {
    const cov = await loadCoverage();
    expect(cov.getCoverageCities()).toEqual(['surabaya', 'sidoarjo', 'gresik', 'sby', 'sda']);
    expect(cov.getInsideRegions()).toContain('jawa timur');
    expect(cov.getOutsideCities()).toContain('tuban');
  });

  it('env COVERAGE_CITIES menimpa default', async () => {
    process.env.COVERAGE_CITIES = 'Surabaya, Sidoarjo, Mojokerto';
    const cov = await loadCoverage();
    expect(cov.getCoverageCities()).toEqual(['surabaya', 'sidoarjo', 'mojokerto']);
  });

  it('adversarial: env kosong/spasi → fallback default, bukan array kosong', async () => {
    process.env.COVERAGE_CITIES = '   ';
    const cov = await loadCoverage();
    expect(cov.getCoverageCities()).toEqual(['surabaya', 'sidoarjo', 'gresik', 'sby', 'sda']);
  });

  it('adversarial: entri kosong di tengah CSV dibuang', async () => {
    process.env.OUTSIDE_CITIES = 'malang,, jakarta ,';
    const cov = await loadCoverage();
    expect(cov.getOutsideCities()).toEqual(['malang', 'jakarta']);
  });

  it('DEFAULT_COVERAGE mendokumentasikan nilai default', async () => {
    const cov = await loadCoverage();
    expect(cov.DEFAULT_COVERAGE.cities).toContain('surabaya');
  });
});
