import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import {
  WAHA_SECRET_HEADER,
  WAHA_TENANT_HEADER,
  buildWahaWebhookHeaders,
  deriveTenantWebhookSecret,
  resolveExpectedWebhookSecrets,
} from '../../src/config/waha-webhook-auth';
import { whatsappProviderService } from '../../src/services/whatsapp-provider.service';

/**
 * S-015 — secret webhook WAHA per tenant.
 *
 * Kontrak yang dijaga:
 * 1. Secret yang dipasang di config WAHA adalah TURUNAN per tenant, bukan
 *    global; bocornya satu session tidak membuka tenant lain.
 * 2. Header `X-Tenant-Id` hanya penanda verifikasi (tenant pesan tetap dari
 *    session id), dan secret tenant A tidak sah untuk tenant B.
 * 3. Secret global lama tetap diterima (kompatibilitas session yang belum
 *    di-sync ulang).
 */

const oldSecret = process.env.WAHA_WEBHOOK_SECRET;
const oldUnsigned = process.env.WAHA_WA_ALLOW_UNSIGNED_PLACEHOLDER;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WAHA_WEBHOOK_SECRET = 'global-test-secret';
  delete process.env.WAHA_ALLOW_UNSIGNED_WEBHOOK;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (oldSecret === undefined) delete process.env.WAHA_WEBHOOK_SECRET;
  else process.env.WAHA_WEBHOOK_SECRET = oldSecret;
  if (oldUnsigned === undefined) delete process.env.WAHA_WA_ALLOW_UNSIGNED_PLACEHOLDER;
});

describe('deriveTenantWebhookSecret', () => {
  it('deterministik, berbeda per tenant, dan bukan secret global', () => {
    const a1 = deriveTenantWebhookSecret('global-test-secret', 'tenant-a');
    const a2 = deriveTenantWebhookSecret('global-test-secret', 'tenant-a');
    const b = deriveTenantWebhookSecret('global-test-secret', 'tenant-b');

    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1).not.toBe('global-test-secret');
    expect(a1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('secret global berbeda menghasilkan turunan berbeda', () => {
    expect(deriveTenantWebhookSecret('secret-1', 'tenant-a')).not.toBe(
      deriveTenantWebhookSecret('secret-2', 'tenant-a')
    );
  });
});

describe('buildWahaWebhookHeaders', () => {
  it('memasang secret turunan tenant + penanda X-Tenant-Id', () => {
    const headers = buildWahaWebhookHeaders('global-test-secret', 'tenant-b');
    const byName = Object.fromEntries(headers.map((h) => [h.name, h.value]));

    expect(byName[WAHA_TENANT_HEADER]).toBe('tenant-b');
    expect(byName[WAHA_SECRET_HEADER]).toBe(deriveTenantWebhookSecret('global-test-secret', 'tenant-b'));
    expect(byName[WAHA_SECRET_HEADER]).not.toBe('global-test-secret');
  });

  it('tanpa secret → tidak ada header (mode unsigned ditangani route)', () => {
    expect(buildWahaWebhookHeaders(undefined, 'tenant-a')).toEqual([]);
    expect(buildWahaWebhookHeaders('   ', 'tenant-a')).toEqual([]);
    expect(buildWahaWebhookHeaders('global-test-secret', '')).toEqual([]);
  });
});

describe('resolveExpectedWebhookSecrets', () => {
  it('selalu menerima global (legacy) dan menambah turunan bila tenant dikirim', () => {
    expect(resolveExpectedWebhookSecrets('global-test-secret', undefined)).toEqual(['global-test-secret']);
    expect(resolveExpectedWebhookSecrets('global-test-secret', 'tenant-a')).toEqual([
      'global-test-secret',
      deriveTenantWebhookSecret('global-test-secret', 'tenant-a'),
    ]);
  });

  it('tanpa secret global → tidak ada yang sah', () => {
    expect(resolveExpectedWebhookSecrets('', 'tenant-a')).toEqual([]);
    expect(resolveExpectedWebhookSecrets(undefined, 'tenant-a')).toEqual([]);
  });
});

describe('config session WAHA per tenant', () => {
  it('session tenant B memasang secret turunan B, bukan secret global', () => {
    const config = (whatsappProviderService as any).buildDefaultSessionConfig('tenant-b');
    const headers: Array<{ name: string; value: string }> = config.webhooks[0].customHeaders;

    expect(headers).toEqual(
      expect.arrayContaining([
        { name: WAHA_TENANT_HEADER, value: 'tenant-b' },
        { name: WAHA_SECRET_HEADER, value: deriveTenantWebhookSecret('global-test-secret', 'tenant-b') },
      ])
    );
    expect(headers.map((h) => h.value)).not.toContain('global-test-secret');
  });

  it('session tenant berbeda memakai secret berbeda', () => {
    const a = (whatsappProviderService as any).buildDefaultSessionConfig('tenant-a');
    const b = (whatsappProviderService as any).buildDefaultSessionConfig('tenant-b');
    const secretA = a.webhooks[0].customHeaders.find((h: any) => h.name === WAHA_SECRET_HEADER).value;
    const secretB = b.webhooks[0].customHeaders.find((h: any) => h.name === WAHA_SECRET_HEADER).value;
    expect(secretA).not.toBe(secretB);
  });
});

describe('route /webhook memverifikasi secret per tenant', () => {
  const app = buildApp();
  const payload = { event: 'session.status', session: 'unknown-session', payload: { status: 'WORKING' } };

  it('secret salah → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'x-webhook-secret': 'secret-palsu', 'x-tenant-id': 'tenant-a' },
      payload,
    });
    expect(res.statusCode).toBe(401);
  });

  it('secret turunan tenant valid → tidak 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: {
        'x-webhook-secret': deriveTenantWebhookSecret('global-test-secret', 'tenant-b'),
        'x-tenant-id': 'tenant-b',
      },
      payload,
    });
    expect(res.statusCode).not.toBe(401);
  });

  it('secret turunan tenant lain → 401 (anti pemalsuan lintas tenant)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: {
        'x-webhook-secret': deriveTenantWebhookSecret('global-test-secret', 'tenant-b'),
        'x-tenant-id': 'tenant-a',
      },
      payload,
    });
    expect(res.statusCode).toBe(401);
  });

  it('secret global lama tetap diterima (session belum di-sync ulang)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: { 'x-webhook-secret': 'global-test-secret' },
      payload,
    });
    expect(res.statusCode).not.toBe(401);
  });
});
