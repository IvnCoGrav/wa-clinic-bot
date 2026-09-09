import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker, isInfrastructureError } from '../../src/utils/circuit-breaker';

describe('Circuit Breaker — Error Classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isInfrastructureError', () => {
    it('mengenali HTTP 500 sebagai error infrastruktur', () => {
      const err = { response: { status: 500 } };
      expect(isInfrastructureError(err)).toBe(true);
    });

    it('mengenali HTTP 502 sebagai error infrastruktur', () => {
      const err = { response: { status: 502 } };
      expect(isInfrastructureError(err)).toBe(true);
    });

    it('mengenali HTTP 429 (rate limit) sebagai error infrastruktur', () => {
      const err = { response: { status: 429 } };
      expect(isInfrastructureError(err)).toBe(true);
    });

    it('mengenali ECONNREFUSED sebagai error infrastruktur', () => {
      const err = { code: 'ECONNREFUSED' };
      expect(isInfrastructureError(err)).toBe(true);
    });

    it('mengenali ENOTFOUND sebagai error infrastruktur', () => {
      const err = { code: 'ENOTFOUND' };
      expect(isInfrastructureError(err)).toBe(true);
    });

    it('mengenali ETIMEDOUT sebagai error infrastruktur', () => {
      const err = { code: 'ETIMEDOUT' };
      expect(isInfrastructureError(err)).toBe(true);
    });

    it('mengenali ECONNABORTED sebagai error infrastruktur', () => {
      const err = { code: 'ECONNABORTED' };
      expect(isInfrastructureError(err)).toBe(true);
    });

    it('mengenali error dengan message timeout sebagai error infrastruktur', () => {
      const err = { message: 'Connection timeout after 5000ms' };
      expect(isInfrastructureError(err)).toBe(true);
    });

    it('mengenali HTTP 400 (Bad Request) sebagai BUKAN error infrastruktur', () => {
      const err = { response: { status: 400 } };
      expect(isInfrastructureError(err)).toBe(false);
    });

    it('mengenali HTTP 401 (Unauthorized) sebagai BUKAN error infrastruktur', () => {
      const err = { response: { status: 401 } };
      expect(isInfrastructureError(err)).toBe(false);
    });

    it('mengenali HTTP 403 (Forbidden) sebagai BUKAN error infrastruktur', () => {
      const err = { response: { status: 403 } };
      expect(isInfrastructureError(err)).toBe(false);
    });

    it('mengenali HTTP 404 (Not Found) sebagai BUKAN error infrastruktur', () => {
      const err = { response: { status: 404 } };
      expect(isInfrastructureError(err)).toBe(false);
    });

    it('mengenali HTTP 422 (Unprocessable) sebagai BUKAN error infrastruktur', () => {
      const err = { response: { status: 422 } };
      expect(isInfrastructureError(err)).toBe(false);
    });

    it('mengasumsikan infrastruktur jika tidak ada status/code', () => {
      const err = { message: 'Unknown error' };
      expect(isInfrastructureError(err)).toBe(true);
    });
  });

  describe('CircuitBreaker — 4xx tidak memicu trip', () => {
    it('10x HTTP 400 tidak memicu trip (circuit tetap CLOSED)', async () => {
      let callCount = 0;
      const mockRequest = vi.fn().mockImplementation(async () => {
        callCount++;
        const error: any = new Error(`Bad Request ${callCount}`);
        error.response = { status: 400, data: { error: 'Invalid timestamp' } };
        throw error;
      });

      const mockFallback = vi.fn().mockResolvedValue({ fallback: true });

      const breaker = new CircuitBreaker(mockRequest, mockFallback, {
        name: 'Test 4xx No Trip',
        failureThreshold: 0.5,
        slidingWindowSize: 10,
      });

      // Jalankan 10x request yang gagal dengan 400
      for (let i = 0; i < 10; i++) {
        try {
          await breaker.execute('test-arg');
        } catch {
          // 400 errors di-rethrow
        }
      }

      // Circuit harus tetap CLOSED (tidak trip)
      expect(breaker.getState()).toBe('CLOSED');
      // Fallback tidak boleh dipanggil (karena 400 di-rethrow)
      expect(mockFallback).not.toHaveBeenCalled();
    });

    it('HTTP 400 meneruskan error asli ke pemanggil', async () => {
      const mockRequest = vi.fn().mockImplementation(async () => {
        const error: any = new Error('Event timestamp too old');
        error.response = { status: 400, data: { error: { code: 2804003 } } };
        throw error;
      });

      const mockFallback = vi.fn().mockResolvedValue({ fallback: true });

      const breaker = new CircuitBreaker(mockRequest, mockFallback, {
        name: 'Test 400 Passthrough',
      });

      let caughtError: any = null;
      try {
        await breaker.execute('test-arg');
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError.response.status).toBe(400);
      expect(caughtError.message).toBe('Event timestamp too old');
      expect(mockFallback).not.toHaveBeenCalled();
    });
  });

  describe('CircuitBreaker — 5xx memicu trip', () => {
    it('6x HTTP 500 memicu trip (circuit menjadi OPEN)', async () => {
      let callCount = 0;
      const mockRequest = vi.fn().mockImplementation(async () => {
        callCount++;
        const error: any = new Error(`Server Error ${callCount}`);
        error.response = { status: 500 };
        throw error;
      });

      const mockFallback = vi.fn().mockResolvedValue({ fallback: true });

      const breaker = new CircuitBreaker(mockRequest, mockFallback, {
        name: 'Test 5xx Trip',
        failureThreshold: 0.5,
        slidingWindowSize: 5, // Ukuran window kecil agar cepat trip
      });

      // Jalankan 5x request yang gagal dengan 500 (100% failure rate > 50% threshold)
      for (let i = 0; i < 5; i++) {
        await breaker.execute('test-arg');
      }

      // Circuit harus OPEN setelah 5x failure (100% > 50% threshold)
      expect(breaker.getState()).toBe('OPEN');
      // Fallback harus dipanggil
      expect(mockFallback).toHaveBeenCalledTimes(5);
    });

    it('Network error memicu trip', async () => {
      const mockRequest = vi.fn().mockRejectedValue({ code: 'ECONNREFUSED' });
      const mockFallback = vi.fn().mockResolvedValue({ fallback: true });

      const breaker = new CircuitBreaker(mockRequest, mockFallback, {
        name: 'Test Network Trip',
        failureThreshold: 0.5,
        slidingWindowSize: 5, // Ukuran window kecil agar cepat trip
      });

      for (let i = 0; i < 5; i++) {
        await breaker.execute('test-arg');
      }

      expect(breaker.getState()).toBe('OPEN');
    });
  });

  describe('CircuitBreaker — Mixed errors', () => {
    it('400 tidak dihitung, 500 dihitung dalam sliding window', async () => {
      let callCount = 0;
      const mockRequest = vi.fn().mockImplementation(async () => {
        callCount++;
        const error: any = new Error(`Error ${callCount}`);
        // 400 pertama, lalu 500
        error.response = { status: callCount === 1 ? 400 : 500 };
        throw error;
      });

      const mockFallback = vi.fn().mockResolvedValue({ fallback: true });

      const breaker = new CircuitBreaker(mockRequest, mockFallback, {
        name: 'Test Mixed Errors',
        failureThreshold: 0.5,
        slidingWindowSize: 5, // Ukuran window kecil agar cepat trip
      });

      // Request pertama: 400 (tidak dihitung) - di-rethrow
      try {
        await breaker.execute('test-arg');
      } catch {}

      // Request 2-6: 500 (dihitung, 5 failures dari 5 requests = 100%)
      for (let i = 0; i < 5; i++) {
        await breaker.execute('test-arg');
      }

      // Circuit harus OPEN (5 failures dari 5 requests = 100% > 50% threshold)
      expect(breaker.getState()).toBe('OPEN');
    });
  });
});
