import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatContactName,
  normalizePhoneForGoogle,
  buildContactNotes,
  extractContactPhoneAndName,
} from '../../src/services/google-contacts-formatter';
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
      expect(res.givenName).toBe('Bunda');
      expect(res.familyName).toBe('Alisa - Rayyan');
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
      expect(res.givenName).toBe('Ibu');
      expect(res.familyName).toBe('Maya - Kimi (Kalisari, Mulyorejo)');
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
  });

  describe('OAuth Client Manager', () => {
    it('parses base64 state parameter correctly', () => {
      const payload = { tenantId: 'tenant-abc', timestamp: 12345678 };
      const stateStr = Buffer.from(JSON.stringify(payload)).toString('base64');

      const parsed = googleOAuthClientManager.parseState(stateStr);
      expect(parsed.tenantId).toBe('tenant-abc');
    });

    it('falls back to default tenant when state is invalid', () => {
      const parsed = googleOAuthClientManager.parseState('invalid_base64_%%%');
      expect(parsed.tenantId).toBe('default-tenant');
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
