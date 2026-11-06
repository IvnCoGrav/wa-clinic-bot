import { describe, it, expect } from 'vitest';
import { resolveWahaSessionKey } from '../../src/services/waha-history-sync.service';

/**
 * Regresi AUDIT #316 FASE 3 (K-03): sync history tidak boleh memakai session
 * WAHA global bila tenant punya session sendiri.
 */
describe('resolveWahaSessionKey — session WAHA per tenant', () => {
  it('tenant dengan waha_session_id memakai session miliknya', () => {
    expect(resolveWahaSessionKey('cabang-b', 'default')).toBe('cabang-b');
  });

  it('tenant tanpa session jatuh ke env (perilaku single-tenant lama)', () => {
    expect(resolveWahaSessionKey(null, 'default')).toBe('default');
    expect(resolveWahaSessionKey(undefined, 'klinik-utama')).toBe('klinik-utama');
    expect(resolveWahaSessionKey('   ', 'klinik-utama')).toBe('klinik-utama');
  });

  it('keduanya kosong → "default" (tidak pernah string kosong)', () => {
    expect(resolveWahaSessionKey('', '')).toBe('default');
    expect(resolveWahaSessionKey(null, undefined)).toBe('default');
  });

  it('tidak pernah mengembalikan session tenant lain saat tenant punya session', () => {
    // Simulasi request tenant B: session env milik tenant A tidak boleh menang.
    expect(resolveWahaSessionKey('tenant-b-session', 'tenant-a-session')).toBe('tenant-b-session');
  });
});
