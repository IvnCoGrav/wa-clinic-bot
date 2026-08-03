import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { verifyMetaSignature } from '../../src/integrations/whatsapp/signature';
import { wabaTenantService } from '../../src/services/waba-tenant.service';
import { resolveWabaMediaUrl } from '../../src/integrations/whatsapp/media';
import { resolveTreatmentValue, capiService, decryptCapiToken } from '../../src/services/capi.service';
import { encryptSecret } from '../../src/utils/encryption';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('verifyMetaSignature — raw body (X-Hub-Signature-256)', () => {
  const appSecret = 'meta_app_secret_123';

  it('should verify signature computed over exact raw bytes', () => {
    // Body dengan whitespace & urutan kunci non-kanonik — JSON.parse lalu
    // re-stringify akan mengubah bytes dan membuat HMAC mismatch.
    const rawBody = Buffer.from('{"object":"whatsapp_business_account","entry":[{"id":"1"}]}');
    const hmac = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const signature = `sha256=${hmac}`;

    expect(verifyMetaSignature(rawBody, signature, appSecret)).toBe(true);
  });

  it('should reject when re-stringified body used instead of raw bytes', () => {
    const rawBody = Buffer.from('{\n  "object": "whatsapp_business_account",\n  "entry": [{"id": "1"}]\n}');
    const parsed = JSON.parse(rawBody.toString('utf8'));
    const restringified = Buffer.from(JSON.stringify(parsed)); // bytes berubah

    const hmacRaw = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const hmacRestringified = crypto.createHmac('sha256', appSecret).update(restringified).digest('hex');

    expect(hmacRaw).not.toBe(hmacRestringified);
    expect(verifyMetaSignature(restringified, `sha256=${hmacRaw}`, appSecret)).toBe(false);
  });

  it('should reject malformed signature header', () => {
    const rawBody = Buffer.from('{}');
    expect(verifyMetaSignature(rawBody, 'nothash', appSecret)).toBe(false);
  });

  it('should bypass when appSecret is mock_secret (test/dev)', () => {
    const rawBody = Buffer.from('{}');
    expect(verifyMetaSignature(rawBody, undefined, 'mock_secret')).toBe(true);
  });
});

describe('wabaTenantService.resolveTenantByPhoneNumberId', () => {
  beforeEach(() => {
    vi.resetModules();
    wabaTenantService.resetCache();
  });

  it('should resolve tenant by matching phone_number_id', async () => {
    const { prisma } = await import('../../src/db/client');
    vi.mocked(prisma.tenant.findFirst).mockResolvedValueOnce({ id: 'tenant-waba-1' } as any);

    const tenantId = await wabaTenantService.resolveTenantByPhoneNumberId('PHONE_ID_ABC');
    expect(tenantId).toBe('tenant-waba-1');
    expect(prisma.tenant.findFirst).toHaveBeenCalledWith({
      where: { waba_phone_number_id: 'PHONE_ID_ABC' },
      select: { id: true },
    });
  });

  it('should fallback to default tenant when phone_number_id unknown', async () => {
    const { prisma } = await import('../../src/db/client');
    vi.mocked(prisma.tenant.findFirst).mockResolvedValueOnce(null);

    const tenantId = await wabaTenantService.resolveTenantByPhoneNumberId('UNKNOWN_PNID');
    expect(tenantId).toBe('default-tenant');
  });

  it('should fallback to default tenant when DB offline', async () => {
    const { prisma } = await import('../../src/db/client');
    vi.mocked(prisma.tenant.findFirst).mockRejectedValueOnce(new Error('Database offline'));

    const tenantId = await wabaTenantService.resolveTenantByPhoneNumberId('PNID_OFFLINE');
    expect(tenantId).toBe('default-tenant');
  });

  it('should return default tenant for empty input', async () => {
    const tenantId = await wabaTenantService.resolveTenantByPhoneNumberId(undefined);
    expect(tenantId).toBe('default-tenant');
  });
});

describe('resolveWabaMediaUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should return media URL from Graph API', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { url: 'https://lookaside.fbsbx.com/whatsapp/media_id_987', mime_type: 'image/jpeg' },
      status: 200,
    });

    const result = await resolveWabaMediaUrl('media_id_987', 'test_token');
    expect(result?.url).toContain('lookaside.fbsbx.com');
    expect(result?.mimeType).toBe('image/jpeg');
    const callUrl = mockedAxios.get.mock.calls[0][0] as string;
    expect(callUrl).toContain('/v25.0/media_id_987');
  });

  it('should return null on Graph API failure', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));
    const result = await resolveWabaMediaUrl('media_id_987', 'test_token');
    expect(result).toBeNull();
  });

  it('should return null when mediaId or token missing', async () => {
    expect(await resolveWabaMediaUrl('', 'token')).toBeNull();
    expect(await resolveWabaMediaUrl('mid', '')).toBeNull();
  });
});

describe('resolveTreatmentValue', () => {
  it('should return promoPrice for exact treatment name match', async () => {
    const value = await resolveTreatmentValue('Pijat Bayi Ceria (Rileksasi)');
    expect(value).toBe(60000);
  });

  it('should return undefined for unknown treatment', async () => {
    const value = await resolveTreatmentValue('Perawatan misterius tidak dikenal');
    expect(value).toBeUndefined();
  });

  it('should return undefined for empty input', async () => {
    expect(await resolveTreatmentValue(undefined)).toBeUndefined();
    expect(await resolveTreatmentValue('')).toBeUndefined();
  });
});

describe('CapiService — tenant-aware credentials', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should use tenant meta_pixel_id & meta_capi_access_token from DB', async () => {
    const { prisma } = await import('../../src/db/client');
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: 'tenant-x',
      meta_pixel_id: 'PIXEL_TENANT_1',
      meta_capi_access_token: 'EAA_legacy_token_tenant_1', // legacy plaintext (EAA)
    } as any);

    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });

    await capiService.sendCapiEvent({
      eventName: 'Lead',
      customer: { phone: '081234567890' },
      adClick: { ipAddress: '1.2.3.4', userAgent: 'UA', fbp: '_fbp', fbc: '_fbc', landingUrl: 'https://x.id' },
      tenantId: 'tenant-x',
    });

    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({ where: { id: 'tenant-x' } });
    const url = mockedAxios.post.mock.calls[0][0] as string;
    expect(url).toContain('PIXEL_TENANT_1/events');
    expect(url).toContain('access_token=EAA_legacy_token_tenant_1');
  });

  it('should fallback to env credentials when tenant has no config', async () => {
    const { prisma } = await import('../../src/db/client');
    vi.mocked(prisma.tenant.findUnique).mockResolvedValueOnce({
      id: 'tenant-y',
      meta_pixel_id: null,
      meta_capi_access_token: null,
    } as any);

    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: {} });
    const prevPixel = process.env.FB_PIXEL_ID;
    const prevToken = process.env.FB_CAPI_ACCESS_TOKEN;
    process.env.FB_PIXEL_ID = 'PIXEL_ENV';
    process.env.FB_CAPI_ACCESS_TOKEN = 'TOKEN_ENV';

    try {
      await capiService.sendCapiEvent({
        eventName: 'Lead',
        customer: { phone: '081234567890' },
        adClick: { ipAddress: '1.2.3.4' },
        tenantId: 'tenant-y',
      });
      const url = mockedAxios.post.mock.calls[0][0] as string;
      expect(url).toContain('PIXEL_ENV/events');
      expect(url).toContain('access_token=TOKEN_ENV');
    } finally {
      process.env.FB_PIXEL_ID = prevPixel;
      process.env.FB_CAPI_ACCESS_TOKEN = prevToken;
    }
  });
});

describe('decryptCapiToken', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.WABA_TOKEN_ENCRYPTION_KEY = 'b'.repeat(64);
  });

  it('should decrypt encrypted token back to original', () => {
    const encrypted = encryptSecret('EAA_capi_token_asli');
    expect(decryptCapiToken(encrypted)).toBe('EAA_capi_token_asli');
  });

  it('should pass through legacy plaintext token (EAA...)', () => {
    expect(decryptCapiToken('EAA_legacy_plain')).toBe('EAA_legacy_plain');
  });

  it('should return null for empty input', () => {
    expect(decryptCapiToken('')).toBeNull();
    expect(decryptCapiToken(undefined as any)).toBeNull();
  });

  it('should return null for non-token non-decryptable string', () => {
    expect(decryptCapiToken('bukan token dan bukan encrypted')).toBeNull();
  });
});
