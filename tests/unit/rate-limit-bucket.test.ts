import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';

describe('Rate Limit Bucket & Trust Proxy Hardening (Task 0.9)', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = 'real_valid_admin_key_for_testing';
  });

  it('should NOT allow fake x-api-key to create arbitrary new buckets and bypass IP rate limiting', async () => {
    const app = buildApp();
    // max di mode test adalah 100 request/menit
    const maxRequests = 105;
    let hitRateLimit429 = false;

    for (let i = 0; i < maxRequests; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          // Setiap request mengirimkan fake x-api-key acak yang berbeda
          'x-api-key': `fake_random_key_${i}_${Math.random()}`,
        },
      });

      if (res.statusCode === 429) {
        hitRateLimit429 = true;
        break;
      }
    }

    // Pada kode lama di app.ts:159-163, setiap apiKey acak menghasilkan bucket baru:
    // `${apiKey}-${clientIp}`, sehingga attacker bisa kirim jutaan request tanpa pernah 429.
    // Pada Fase 1 ID 1.4.2, fake x-api-key WAJIB jatuh ke bucket IP -> harus terkena 429!
    expect(hitRateLimit429).toBe(true);
  });
});
