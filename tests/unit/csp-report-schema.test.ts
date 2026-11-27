import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';
import { clampReportField } from '../../src/routes/landing.route';

describe('CSP report schema/clamp', () => {
  beforeEach(() => {
    process.env.ADMIN_API_KEY = 'test_admin_key_csp';
  });

  it('clampReportField memotong string panjang dan menolak tipe aneh', () => {
    expect(clampReportField('a'.repeat(5000)).length).toBe(512);
    expect(clampReportField({ evil: true })).toBe('unknown');
    expect(clampReportField(['a'])).toBe('unknown');
    expect(clampReportField(42)).toBe('42');
    expect(clampReportField('   ')).toBe('unknown');
  });

  it('endpoint menerima body besar (di bawah bodyLimit) tanpa menggemakan isinya', async () => {
    const app = buildApp();
    const huge = 'x'.repeat(100 * 1024);
    const res = await app.inject({
      method: 'POST',
      url: '/api/csp-report',
      headers: { 'content-type': 'application/csp-report' },
      payload: JSON.stringify({
        'csp-report': {
          'document-uri': `https://app.example.com/page?x=${huge}`,
          'blocked-uri': huge,
          'violated-directive': huge,
        },
      }),
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).not.toContain(huge.slice(0, 100));
    await app.close();
  });

  it('body melebihi bodyLimit ditolak sebelum handler (413)', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/csp-report',
      headers: { 'content-type': 'application/csp-report' },
      payload: 'x'.repeat(1200 * 1024),
    });
    expect(res.statusCode).toBe(413);
    await app.close();
  });

  it('body berbentuk array/objek aneh tidak membuat 500', async () => {
    const app = buildApp();
    for (const payload of [{}, [], { 'csp-report': [] }, { 'csp-report': 'string' }]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/csp-report',
        headers: { 'content-type': 'application/csp-report' },
        payload: JSON.stringify(payload),
      });
      expect(res.statusCode).toBe(204);
    }
    await app.close();
  });
});
