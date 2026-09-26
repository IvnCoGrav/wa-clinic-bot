import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app';

/**
 * Fase 3c (issue #136): rate-limit GET /cta.
 * /cta adalah endpoint publik yang membuat baris AdClick + fallback PageView —
 * tanpa batas, satu IP bisa membanjiri `ad_clicks`/`landing_page_views` (data poison).
 * Kontrak: maksimal 60 request/menit/IP (sejajar /api/tracking/click), lebih → 429.
 */
describe('CTA Rate Limit (Fase 3c)', () => {
  it('GET /cta > 60 req/menit per IP → 429 dengan Retry-After', async () => {
    const app = buildApp();
    const statuses: number[] = [];
    let first429: any = null;

    for (let i = 0; i < 62; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/cta?phone=6281234567890',
        headers: { 'user-agent': 'Mozilla/5.0 (Android 14)' },
      });
      statuses.push(res.statusCode);
      if (res.statusCode === 429 && !first429) first429 = res;
    }

    const ok = statuses.filter((s) => s === 200).length;
    const limited = statuses.filter((s) => s === 429).length;
    expect(ok).toBe(60);
    expect(limited).toBe(2);
    expect(first429).toBeTruthy();
    expect(first429.headers['retry-after']).toBeDefined();
  }, 30_000);
});
