import { describe, it, expect } from 'vitest';
import {
  shouldLogAuthAccess,
  extractSessionTokenPrefix8,
  buildAuthAccessLogEntry,
} from '../../src/utils/auth-access-log';

/**
 * Observabilitas jalur auth (KNOWN_ISSUES #143): forensic 401 vs 503 harus
 * mungkin dilakukan dari log. Kontrak: hanya 401/503 pada jalur auth/admin/staff
 * yang dicatat; token penuh DILARANG bocor (hanya hash prefix-8).
 */
describe('auth-access-log', () => {
  describe('shouldLogAuthAccess', () => {
    it('mencatat 401 & 503 pada endpoint auth eksplisit', () => {
      expect(shouldLogAuthAccess('/api/admin/auth/me', 401)).toBe(true);
      expect(shouldLogAuthAccess('/api/staff/auth/restore', 503)).toBe(true);
    });

    it('mencatat 401/503 pada rute admin/staff (preHandler auth)', () => {
      expect(shouldLogAuthAccess('/api/admin/settings', 401)).toBe(true);
      expect(shouldLogAuthAccess('/api/staff/today-tasks', 503)).toBe(true);
    });

    it('TIDAK mencatat status selain 401/503', () => {
      expect(shouldLogAuthAccess('/api/admin/auth/me', 200)).toBe(false);
      expect(shouldLogAuthAccess('/api/admin/settings', 500)).toBe(false);
      expect(shouldLogAuthAccess('/api/admin/settings', 429)).toBe(false);
    });

    it('TIDAK mencatat rute non-admin/staff meski 401/503', () => {
      expect(shouldLogAuthAccess('/webhook', 401)).toBe(false);
      expect(shouldLogAuthAccess('/api/webhook/waba', 503)).toBe(false);
      expect(shouldLogAuthAccess('/health', 401)).toBe(false);
    });
  });

  describe('extractSessionTokenPrefix8', () => {
    it('meng-hash token admin_session menjadi prefix-8 hex', () => {
      const prefix = extractSessionTokenPrefix8('admin_session=rahasia123; other=x');
      expect(prefix).toMatch(/^[0-9a-f]{8}$/);
      expect(prefix).not.toContain('rahasia');
    });

    it('meng-hash token staff_session', () => {
      const prefix = extractSessionTokenPrefix8('staff_session=abcxyz');
      expect(prefix).toMatch(/^[0-9a-f]{8}$/);
    });

    it('mengembalikan undefined bila tidak ada cookie sesi', () => {
      expect(extractSessionTokenPrefix8('foo=bar')).toBeUndefined();
      expect(extractSessionTokenPrefix8('')).toBeUndefined();
      expect(extractSessionTokenPrefix8(undefined)).toBeUndefined();
    });
  });

  describe('buildAuthAccessLogEntry', () => {
    it('menghasilkan entri JSON-aman: token & IP mentah TIDAK pernah muncul', () => {
      const entry = buildAuthAccessLogEntry(
        {
          method: 'GET',
          path: '/api/admin/auth/me',
          statusCode: 503,
          latencyMs: 12.7,
          cookieHeader: 'admin_session=TOKEN_RAHASIA',
          ip: '103.20.30.40',
          reqId: 'req-1',
        },
        new Date('2026-09-28T10:00:00.000Z')
      );

      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain('TOKEN_RAHASIA');
      expect(serialized).not.toContain('103.20.30.40');
      expect(entry.signal).toBe('503');
      expect(entry.status).toBe(503);
      expect(entry.latencyMs).toBe(13);
      expect(entry.sessionHashPrefix8).toMatch(/^[0-9a-f]{8}$/);
      expect(entry.ipHashPrefix8).toMatch(/^[0-9a-f]{8}$/);
      expect(entry.ts).toBe('2026-09-28T10:00:00.000Z');
      expect(entry.event).toBe('AUTH_ACCESS');
    });

    it('401 → signal "401"', () => {
      const entry = buildAuthAccessLogEntry({
        method: 'GET',
        path: '/api/staff/auth/me',
        statusCode: 401,
        latencyMs: 3,
      });
      expect(entry.signal).toBe('401');
      expect(entry.sessionHashPrefix8).toBeUndefined();
    });
  });
});
