import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';

/**
 * M-06 — `/cta` tidak boleh memakai X-Forwarded-For kiri (bisa dipalsukan klien).
 * Fix: memakai `request.ip` yang mengikuti trustProxy (hop proxy tepercaya).
 *
 * Test ini mensimulasikan topologi produksi: Caddy berada di jaringan 10/8
 * (proxy tepercaya), sedangkan koneksi langsung dari luar bukan proxy.
 */
describe('CTA IP attribution anti-spoof (M-06)', () => {
  let app: any;
  let buildApp: any;
  let memoryAdClicks: Map<string, any>;

  beforeAll(async () => {
    process.env.TRUST_PROXY_CIDRS = '10.0.0.0/8';
    ({ buildApp } = await import('../../src/app'));
    ({ memoryAdClicks } = await import('../../src/routes/tracking.route'));
    app = buildApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    memoryAdClicks.clear();
    process.env.ADMIN_API_KEY = 'test_admin_key_m06';
    process.env.DEFAULT_WHATSAPP_PHONE = '6281234567890';
    vi.mocked(prisma.tenant.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);
  });

  it('X-Forwarded-For palsu tidak dipakai sebagai IP pelanggan', async () => {
    const landing = 'https://kalababyspa.online/reservasionline?utm_source=ig';
    const res = await app.inject({
      method: 'GET',
      url: `/cta?landing_url=${encodeURIComponent(landing)}&fbclid=SPOOF-TEST`,
      headers: {
        'user-agent': 'Mozilla/5.0 (Linux; Android 13)',
        // Klien mengaku berasal dari IP ini — harus DIABAIKAN karena peer bukan proxy tepercaya.
        'x-forwarded-for': '9.9.9.9',
      },
    });

    expect(res.statusCode).toBe(200);
    const entries = Array.from(memoryAdClicks.entries());
    expect(entries.length).toBeGreaterThan(0);
    const [, record] = entries[0];
    expect(record.ipAddress).not.toBe('9.9.9.9');
    expect(['127.0.0.1', '::1', '::ffff:127.0.0.1']).toContain(record.ipAddress);
  });
});
