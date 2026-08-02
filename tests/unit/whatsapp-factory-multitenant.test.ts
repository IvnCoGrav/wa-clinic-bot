import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveGatewayForTenant, getGateway, resetGateway, createTestGateway } from '../../src/integrations/whatsapp/factory';
import { WahaGatewayDriver } from '../../src/integrations/whatsapp/waha.driver';
import { WabaGatewayDriver } from '../../src/integrations/whatsapp/waba.driver';
import { prisma } from '../../src/db/client';

describe('Multi-Tenant Gateway Factory (Fase 3)', () => {
  beforeEach(() => {
    resetGateway();
    process.env.WABA_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
  });

  afterEach(() => {
    resetGateway();
    delete process.env.WABA_TOKEN_ENCRYPTION_KEY;
    vi.restoreAllMocks();
  });

  it('should return WAHA driver for tenant with WAHA provider', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: 'tenant_waha',
      slug: 'waha-clinic',
      name: 'WAHA Clinic',
      whatsapp_provider: 'WAHA',
      whatsapp_number: '6281',
    } as any);

    const gw = await resolveGatewayForTenant('tenant_waha');
    expect(gw).toBeInstanceOf(WahaGatewayDriver);
    expect(gw.providerType).toBe('WAHA');
  });

  it('should return WABA driver for tenant with WABA provider + encrypted token', async () => {
    const { encryptSecret } = await import('../../src/utils/encryption');
    const encryptedToken = encryptSecret('EAAWABA_secret_123');

    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: 'tenant_waba',
      slug: 'waba-clinic',
      name: 'WABA Clinic',
      whatsapp_provider: 'WABA',
      waba_phone_number_id: '123456789',
      waba_business_account_id: 'waba_biz_001',
      waba_access_token: encryptedToken,
      whatsapp_number: '6282',
    } as any);

    const gw = await resolveGatewayForTenant('tenant_waba');
    expect(gw).toBeInstanceOf(WabaGatewayDriver);
    expect(gw.providerType).toBe('WABA');
  });

  it('should fall back to WAHA if tenant provider is WABA but no token configured', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: 'tenant_partial',
      slug: 'partial',
      name: 'Partial',
      whatsapp_provider: 'WABA',
      waba_phone_number_id: null,
      waba_access_token: null,
      whatsapp_number: '6283',
    } as any);

    const gw = await resolveGatewayForTenant('tenant_partial');
    expect(gw).toBeInstanceOf(WahaGatewayDriver);
  });

  it('should fall back to WAHA if DB query throws', async () => {
    vi.mocked(prisma.tenant.findUnique).mockRejectedValueOnce(new Error('DB offline'));
    const gw = await resolveGatewayForTenant('tenant_unknown');
    expect(gw).toBeInstanceOf(WahaGatewayDriver);
  });

  it('should fall back to WAHA if decrypt fails', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: 'tenant_badtoken',
      slug: 'bad-token',
      name: 'Bad Token',
      whatsapp_provider: 'WABA',
      waba_phone_number_id: '123',
      waba_access_token: 'NOT_VALID_ENCRYPTED',
      whatsapp_number: '6284',
    } as any);

    const gw = await resolveGatewayForTenant('tenant_badtoken');
    expect(gw).toBeInstanceOf(WahaGatewayDriver);
  });

  it('should cache the resolved gateway per tenant', async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({
      id: 'tenant_cached',
      slug: 'cached',
      name: 'Cached',
      whatsapp_provider: 'WAHA',
      whatsapp_number: '6285',
    } as any);

    const gw1 = await resolveGatewayForTenant('tenant_cached');
    const gw2 = await resolveGatewayForTenant('tenant_cached');
    expect(gw1).toBe(gw2);
    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1);
  });

  it('getGateway synchronous fallback returns WAHA driver', () => {
    const gw = getGateway('any-tenant');
    expect(gw).toBeInstanceOf(WahaGatewayDriver);
  });

  it('createTestGateway should override factory resolution', async () => {
    const mockGw = { providerType: 'WAHA' } as any;
    createTestGateway(mockGw, 'tenant_mock');
    const gw = getGateway('tenant_mock');
    expect(gw).toBe(mockGw);
  });
});
