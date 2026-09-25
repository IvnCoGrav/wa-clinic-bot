import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  formatContactName,
  normalizePhoneForGoogle,
  buildContactNotes,
  extractContactPhoneAndName,
  splitImportedContactName,
} from '../../src/services/google-contacts-formatter';
import { classifyImportedAreaTag } from '../../src/services/google-contacts.service';
import { googleOAuthClientManager } from '../../src/integrations/google-contacts/google-oauth.client';
import { googleContactsService } from '../../src/services/google-contacts.service';

// Mock DB
const findUniqueIntegrationMock = vi.fn();
const upsertIntegrationMock = vi.fn();
const updateIntegrationMock = vi.fn();
const createIntegrationMock = vi.fn();
const findUniqueCustomerMock = vi.fn();
const findFirstCustomerMock = vi.fn();
const findManyCustomerMock = vi.fn();
const countCustomerMock = vi.fn();
const updateCustomerMock = vi.fn();
const createCustomerMock = vi.fn();

vi.mock('../../src/db/client', () => ({
  prisma: {
    tenantGoogleIntegration: {
      findUnique: (...args: any[]) => findUniqueIntegrationMock(...args),
      upsert: (...args: any[]) => upsertIntegrationMock(...args),
      update: (...args: any[]) => updateIntegrationMock(...args),
      create: (...args: any[]) => createIntegrationMock(...args),
    },
    customer: {
      findUnique: (...args: any[]) => findUniqueCustomerMock(...args),
      findFirst: (...args: any[]) => findFirstCustomerMock(...args),
      findMany: (...args: any[]) => findManyCustomerMock(...args),
      count: (...args: any[]) => countCustomerMock(...args),
      update: (...args: any[]) => updateCustomerMock(...args),
      create: (...args: any[]) => createCustomerMock(...args),
    },
  },
}));

describe('Google Contacts Integration Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Formatter & Normalizer', () => {
    it('normalizes various phone number formats to E.164', () => {
      expect(normalizePhoneForGoogle('081234567890')).toBe('+6281234567890');
      expect(normalizePhoneForGoogle('6281234567890')).toBe('+6281234567890');
      expect(normalizePhoneForGoogle('+6281234567890')).toBe('+6281234567890');
      expect(normalizePhoneForGoogle('0812-3456-7890@c.us')).toBe('+6281234567890');
      expect(normalizePhoneForGoogle('81234567890')).toBe('+6281234567890');
    });

    it('formats contact name with child name and default template', () => {
      const res = formatContactName(
        {
          name: 'Bunda Alisa',
          phone: '081234567890',
          children: [{ name: 'Rayyan' }],
        },
        null,
        '{{name}} - {{child_name}}'
      );

      expect(res.displayName).toBe('Bunda Alisa - Rayyan');
      // Anti-hyphen: pemisah " - " memisahkan nama murni vs penanda (bukan split kata)
      expect(res.givenName).toBe('Bunda Alisa');
      expect(res.familyName).toBe('Rayyan');
    });

    it('removes dangling hyphen when child name is missing', () => {
      const res = formatContactName(
        {
          name: 'Bunda Citra',
          phone: '081234567890',
          children: [],
        },
        null,
        '{{name}} - {{child_name}}'
      );

      expect(res.displayName).toBe('Bunda Citra');
      expect(res.givenName).toBe('Bunda');
      expect(res.familyName).toBe('Citra');
    });

    it('supports custom template tags with kelurahan and kecamatan', () => {
      const res = formatContactName(
        {
          name: 'Ibu Maya',
          phone: '081234567890',
          kota: 'Surabaya',
          kecamatan: 'Mulyorejo',
          kelurahan: 'Kalisari',
          children: [{ name: 'Kimi' }],
        },
        null,
        '{{name}} - {{child_name}} ({{kelurahan}}, {{kecamatan}})'
      );

      expect(res.displayName).toBe('Ibu Maya - Kimi (Kalisari, Mulyorejo)');
      expect(res.givenName).toBe('Ibu Maya');
      expect(res.familyName).toBe('Kimi (Kalisari, Mulyorejo)');
    });

    it('cleans up empty location tags cleanly', () => {
      const res = formatContactName(
        {
          name: 'Ibu Maya',
          phone: '081234567890',
          kota: 'Surabaya',
          kecamatan: '',
          kelurahan: '',
          children: [],
        },
        null,
        '{{name}} - {{child_name}} ({{kelurahan}}, {{kecamatan}})'
      );

      expect(res.displayName).toBe('Ibu Maya');
    });

    it('builds structured notes with child and address info', () => {
      const notes = buildContactNotes({
        id: 'cust-123',
        name: 'Bunda Lani',
        phone: '081234567890',
        kota: 'Surabaya',
        kecamatan: 'Mulyorejo',
        kelurahan: 'Kalisari',
        children: [{ name: 'Kenzo', birth_date: new Date('2024-01-15') }],
        latestReservation: { service_name: 'Baby Massage + Bath' },
      });

      expect(notes).toContain('ID: cust-123');
      expect(notes).toContain('WhatsApp: +6281234567890');
      expect(notes).toContain('Kenzo (Lahir: 2024-01-15)');
      expect(notes).toContain('Alamat: Kalisari, Mulyorejo, Surabaya');
      expect(notes).toContain('Reservasi Terakhir: Baby Massage + Bath');
    });

    it('extracts contact details from Google Person payload', () => {
      const person = {
        resourceName: 'people/c999',
        etag: '%etag999',
        names: [{ displayName: 'Bunda Sarah', metadata: { primary: true } }],
        phoneNumbers: [{ value: '081299887766' }],
        biographies: [{ value: 'Alamat: Mulyorejo' }],
      };

      const extracted = extractContactPhoneAndName(person);
      expect(extracted).not.toBeNull();
      expect(extracted?.name).toBe('Bunda Sarah');
      expect(extracted?.phone).toBe('+6281299887766');
      expect(extracted?.resourceName).toBe('people/c999');
      expect(extracted?.notes).toBe('Alamat: Mulyorejo');
    });

    it('ignores contacts without phone numbers in extractContactPhoneAndName', () => {
      const person = {
        resourceName: 'people/c1000',
        names: [{ displayName: 'Hanya Email' }],
        phoneNumbers: [],
      };

      const extracted = extractContactPhoneAndName(person);
      expect(extracted).toBeNull();
    });

    // Matriks adversarial integritas penamaan (audit 2026-09-24): nama satu kata,
    // fallback kecamatan, minus gantung, spasi template acak, anti-duplikat dual-tag.
    it('TC-01: single-word name tidak menempelkan minus di familyName', () => {
      const res = formatContactName(
        { name: 'Desy', phone: '081234567890', kelurahan: 'Bulakbanteng' },
        null,
        '{{name}} - {{kelurahan}}'
      );
      expect(res.displayName).toBe('Desy - Bulakbanteng');
      expect(res.givenName).toBe('Desy');
      expect(res.familyName).toBe('Bulakbanteng');
      expect(res.familyName).not.toContain('-');
    });

    it('TC-02: kelurahan NULL fallback cerdas ke kecamatan', () => {
      const res = formatContactName(
        { name: 'Bunda Retno', phone: '081234567890', kecamatan: 'Gedangan' },
        null,
        '{{name}} - {{kelurahan}}'
      );
      expect(res.displayName).toBe('Bunda Retno - Gedangan');
      expect(res.givenName).toBe('Bunda Retno');
      expect(res.familyName).toBe('Gedangan');
    });

    it('TC-03: kelurahan & kecamatan NULL tanpa minus gantung', () => {
      const res = formatContactName(
        { name: 'Bunda Citra', phone: '081234567890' },
        null,
        '{{name}} - {{kelurahan}}'
      );
      expect(res.displayName).toBe('Bunda Citra');
      expect(res.displayName).not.toMatch(/-\s*$/);
    });

    it('TC-04: nama NULL memakai 4 digit akhir telepon', () => {
      const res = formatContactName(
        { name: null, phone: '081803220432', kelurahan: 'Cemandi' },
        null,
        '{{name}} - {{kelurahan}}'
      );
      expect(res.displayName).toBe('Pelanggan 0432 - Cemandi');
      expect(res.givenName).toBe('Pelanggan 0432');
      expect(res.familyName).toBe('Cemandi');
    });

    it('TC-04b: template spasi acak tetap resolusi bersih', () => {
      const res = formatContactName(
        { name: 'Desy', phone: '081234567890', kelurahan: 'Bulakbanteng' },
        null,
        '{{ name }}  -  {{ kelurahan }}'
      );
      expect(res.displayName).toBe('Desy - Bulakbanteng');
    });

    it('TC-04c: anti-duplikat saat template memuat kelurahan DAN kecamatan', () => {
      const res = formatContactName(
        { name: 'Bunda Retno', phone: '081234567890', kecamatan: 'Gedangan' },
        null,
        '{{name}} - {{kelurahan}}, {{kecamatan}}'
      );
      // Separator koma template dipertahankan; yang dilarang hanya duplikat nilai
      expect(res.displayName).toBe('Bunda Retno, Gedangan');
      expect(res.displayName).not.toContain('Gedangan, Gedangan');
    });

    it('TC-06: tag anak hilang bersih tanpa kurung kosong', () => {
      const res = formatContactName(
        { name: 'Bunda Maya', phone: '081234567890', kelurahan: 'Mulyorejo', children: [] },
        null,
        '{{name}} - {{child_name}} ({{kelurahan}})'
      );
      expect(res.displayName).toBe('Bunda Maya (Mulyorejo)');
      expect(res.displayName).not.toContain('()');
    });

    // Isolasi impor dua arah: belah komposit + klasifikasi gazetteer
    it('TC-08: impor "Bunda Sari - Waru" terisolasi nama + kecamatan', () => {
      const split = splitImportedContactName('Bunda Sari - Waru');
      expect(split.cleanName).toBe('Bunda Sari');
      expect(split.areaTag).toBe('Waru');
      const area = classifyImportedAreaTag(split.areaTag);
      expect(area.kecamatan).toBe('Waru');
    });

    it('TC-05b: impor "Pelanggan 8247 - Manukan Kulon" → kelurahan resmi gazetteer', () => {
      const split = splitImportedContactName('Pelanggan 8247 - Manukan Kulon');
      expect(split.cleanName).toBe('Pelanggan 8247');
      const area = classifyImportedAreaTag(split.areaTag);
      expect(area.kelurahan).toBe('Manukan Kulon');
      expect(area.kecamatan).toBe('Tandes');
    });

    it('TC-08b: nama tanpa delimiter lolos utuh, tag tak dikenal → kelurahan', () => {
      expect(splitImportedContactName('Bunda Sari')).toEqual({ cleanName: 'Bunda Sari', areaTag: null });
      expect(splitImportedContactName('')).toEqual({ cleanName: '', areaTag: null });
      expect(classifyImportedAreaTag(null)).toEqual({});
      expect(classifyImportedAreaTag('Kawasan Tak Dikenal XYZ').kelurahan).toBe('Kawasan Tak Dikenal XYZ');
    });
  });

  describe('OAuth Client Manager (SEC-AUDIT-10: HMAC state, fail-closed)', () => {
    beforeEach(() => {
      process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id';
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';
      process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://klinik.test/oauth/callback';
      process.env.GOOGLE_OAUTH_STATE_SECRET = 'test_state_secret_10';
      process.env.ADMIN_API_KEY = 'test_admin_key_oauth';
    });

    it('roundtrip generateAuthUrl → parseState mengembalikan tenantId', () => {
      const url = googleOAuthClientManager.generateAuthUrl('tenant-abc');
      const state = new URL(url).searchParams.get('state')!;
      expect(state).toContain('.');
      expect(googleOAuthClientManager.parseState(state)).toEqual({ tenantId: 'tenant-abc' });
    });

    it('state format lama tanpa signature DITOLAK (bukan fallback)', () => {
      const legacy = Buffer.from(JSON.stringify({ tenantId: 'tenant-abc', timestamp: 12345678 })).toString('base64');
      expect(() => googleOAuthClientManager.parseState(legacy)).toThrow(/state/i);
    });

    it('state dengan tenantId yang diutak-atik DITOLAK (signature mismatch)', () => {
      const url = googleOAuthClientManager.generateAuthUrl('tenant-abc');
      const state = new URL(url).searchParams.get('state')!;
      const [encoded] = state.split('.');
      const forgedPayload = Buffer.from(
        JSON.stringify({ tenantId: 'tenant-korban', timestamp: Date.now(), nonce: 'x' })
      ).toString('base64url');
      // Serang dengan signature asli tapi payload palsu
      const forged = `${forgedPayload}.${state.split('.')[1]}`;
      expect(encoded).toBeTruthy();
      expect(() => googleOAuthClientManager.parseState(forged)).toThrow(/signature/i);
    });

    it('state kadaluarsa DITOLAK', () => {
      const secret = 'test_state_secret_10';
      const old = Buffer.from(
        JSON.stringify({ tenantId: 'tenant-abc', timestamp: Date.now() - 60 * 60 * 1000, nonce: 'y' })
      ).toString('base64url');
      const sig = crypto.createHmac('sha256', secret).update(old).digest('hex');
      expect(() => googleOAuthClientManager.parseState(`${old}.${sig}`)).toThrow(/expir/i);
    });

    it('state kosong / sampah DITOLAK', () => {
      expect(() => googleOAuthClientManager.parseState(undefined)).toThrow();
      expect(() => googleOAuthClientManager.parseState('invalid_base64_%%%')).toThrow();
    });
  });

  describe('Google Contacts Service', () => {
    it('returns status correctly when tenant has no integration', async () => {
      findUniqueIntegrationMock.mockResolvedValue(null);
      countCustomerMock.mockResolvedValue(0);

      const status = await googleContactsService.getIntegrationStatus('default-tenant');
      expect(status.isConnected).toBe(false);
      expect(status.isEnabled).toBe(false);
      expect(status.totalSyncedCustomers).toBe(0);
    });

    it('skips sync when customer is sandbox QA test', async () => {
      findUniqueIntegrationMock.mockResolvedValue({
        tenant_id: 'default-tenant',
        is_enabled: true,
        refresh_token: 'valid_refresh_token',
      });

      findUniqueCustomerMock.mockResolvedValue({
        id: 'cust-sandbox-1',
        phone: '081234567890',
        name: 'QA Tester',
        is_sandbox_test: true,
        children: [],
        reservations: [],
      });

      const res = await googleContactsService.syncCustomer('default-tenant', 'cust-sandbox-1');
      expect(res.success).toBe(true);
      expect(res.action).toBe('skipped');
    });

    it('skips sync when tenant integration is disabled', async () => {
      findUniqueIntegrationMock.mockResolvedValue({
        tenant_id: 'default-tenant',
        is_enabled: false,
        refresh_token: 'valid_refresh_token',
      });

      const res = await googleContactsService.syncCustomer('default-tenant', 'cust-1');
      expect(res.success).toBe(true);
      expect(res.action).toBe('skipped');
    });
  });
});
