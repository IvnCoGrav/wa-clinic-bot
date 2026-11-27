import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { wahaClient } from '../../src/integrations/waha/client';

/**
 * F7 / M19-09 — `/ready` publik hanya boleh menyatakan status.
 * Detail dependency, status cron, dan keberadaan token tenant adalah informasi
 * internal; endpoint publik tidak boleh menjadi peta kegagalan sistem.
 */

const ROOT = path.resolve(__dirname, '../..');

describe('F7 — /ready minimal (M19-09)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([1] as any);
    vi.spyOn(wahaClient, 'getSessionStatus').mockResolvedValue('WORKING');
  });

  afterEach(() => {
    delete process.env.SEPARATE_WORKER;
    vi.restoreAllMocks();
  });

  it('respons sehat hanya berisi { status }, tanpa checks/cron/dependency', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body).toEqual({ status: 'READY' });
    expect(body.checks).toBeUndefined();
    expect(res.body).not.toContain('database');
    expect(res.body).not.toContain('waha');
    expect(res.body).not.toContain('cron');
  });

  it('respons tidak sehat tetap 503 dengan body minimal', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('Connection lost'));
    const res = await app.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'NOT_READY' });
    expect(res.body).not.toContain('Connection lost');
  });

  it('sumber /ready tidak menarik waba_access_token (secret) untuk probe', () => {
    const source = fs.readFileSync(path.join(ROOT, 'src/routes/health.route.ts'), 'utf-8');
    expect(source).not.toMatch(/waba_access_token:\s*true/);
    expect(source).not.toMatch(/select:[^}]*waba_access_token/s);
    // Keberadaan token dicek via COUNT di DB, tanpa menarik nilainya.
    expect(source).toMatch(/SELECT COUNT\(\*\)::int AS missing/);
  });
});
