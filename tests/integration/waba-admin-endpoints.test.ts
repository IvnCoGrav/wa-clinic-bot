import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { resetGateway } from '../../src/integrations/whatsapp/factory';
import { wahaClient } from '../../src/integrations/waha/client';

vi.mock('../../src/integrations/waha/client', () => ({
  wahaClient: {
    getSessionStatus: vi.fn(),
  },
}));

describe('WABA Admin Endpoints (Fase 5)', () => {
  const app = buildApp();

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(wahaClient.getSessionStatus).mockResolvedValue('WORKING');
    resetGateway();
    process.env.ADMIN_API_KEY = 'test_admin_key_999';
    process.env.WABA_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
  });

  it('GET /api/admin/whatsapp-provider returns provider status + templates', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: 'default-tenant',
      slug: 'default-tenant',
      name: 'Default Clinic',
      whatsapp_provider: 'WAHA',
      waha_session_id: 'default',
      waba_phone_number_id: null,
      waba_access_token: null,
    } as any);
    vi.mocked(prisma.wabaTemplate.findMany).mockResolvedValueOnce([] as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/whatsapp-provider',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.provider).toBe('WAHA');
    expect(body.data.wahaStatus).toBe('WORKING');
    expect(body.data.waba.configured).toBe(false);
    expect(Array.isArray(body.data.templates)).toBe(true);
    expect(body.data.templates.length).toBeGreaterThanOrEqual(9);
  });

  it('GET /api/admin/whatsapp-provider masks token but reports configured when present', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: 'default-tenant',
      slug: 'default-tenant',
      name: 'Default Clinic',
      whatsapp_provider: 'WABA',
      waha_session_id: 'default',
      waba_phone_number_id: '123456789',
      waba_business_account_id: 'waba_biz',
      waba_access_token: 'ENCRYPTED_TOKEN',
      waba_webhook_verify_token: 'secret',
    } as any);
    vi.mocked(prisma.wabaTemplate.findMany).mockResolvedValueOnce([
      {
        id: 't1', tenant_id: 'default-tenant', type: 'NO_PURCHASE_1', variant: 1,
        template_name: 'kala_followup_1', category: 'MARKETING', language_code: 'id',
        status: 'APPROVED', is_active: true,
      },
    ] as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/whatsapp-provider',
      headers: { 'x-api-key': 'test_admin_key_999' },
    });

    const body = JSON.parse(res.body);
    expect(body.data.provider).toBe('WABA');
    expect(body.data.waba.configured).toBe(true);
    expect(body.data.waba.hasAccessToken).toBe(true);
    const noPurchase = body.data.templates.find((t: any) => t.type === 'NO_PURCHASE_1');
    expect(noPurchase.isDefault).toBe(false);
    expect(noPurchase.templateName).toBe('kala_followup_1');
  });

  it('PATCH /api/admin/whatsapp-provider encrypts token and toggles provider', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: 'default-tenant', slug: 'default-tenant', name: 'Default Clinic',
      whatsapp_provider: 'WAHA',
    } as any);
    vi.mocked(prisma.tenant.update).mockResolvedValueOnce({
      id: 'default-tenant', slug: 'default-tenant', name: 'Default Clinic',
      whatsapp_provider: 'WABA', waha_session_id: 'default',
      waba_phone_number_id: '123', waba_access_token: 'ENCRYPTED_XYZ',
    } as any);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/whatsapp-provider',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: {
        provider: 'WABA',
        waba_phone_number_id: '123',
        waba_access_token: 'EAAsecret_token',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.provider).toBe('WABA');

    const updateArg = vi.mocked(prisma.tenant.update).mock.calls[0][0] as any;
    expect(updateArg.data.whatsapp_provider).toBe('WABA');
    expect(updateArg.data.waba_access_token.length).toBeGreaterThan(40);
    expect(updateArg.data.waba_access_token).not.toBe('EAAsecret_token');
  });

  it('PATCH /api/admin/whatsapp-provider rejects invalid provider value', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/whatsapp-provider',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: { provider: 'TELEGRAM' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/admin/waba-templates upserts template mapping per tenant', async () => {
    vi.mocked(prisma.wabaTemplate.upsert).mockResolvedValueOnce({} as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/waba-templates',
      headers: { 'x-api-key': 'test_admin_key_999' },
      payload: {
        type: 'NEXT_TREATMENT_2',
        variant: 2,
        templateName: 'kala_next_tx_2',
        category: 'MARKETING',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
    expect(prisma.wabaTemplate.upsert).toHaveBeenCalledTimes(1);
  });
});
