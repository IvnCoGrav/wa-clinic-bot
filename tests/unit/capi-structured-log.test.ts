import { describe, it, expect } from 'vitest';
import {
  formatStructuredCapiEventLog,
  parseStructuredCapiEventLog,
  StructuredCapiEventLog,
} from '../../src/services/capi.helpers';

describe('Task 0.3: Structured CAPI Event Log Parser', () => {
  it('harus memformat dan mem-parse log terstruktur [CAPI EVENT] dengan benar', () => {
    const entry: StructuredCapiEventLog = {
      event: 'Purchase',
      event_id: 'pur_default-tenant_res-123',
      tenant: 'default-tenant',
      status: 200,
      events_received: 1,
      fbtrace_id: 'trace_abc123',
      source: 'ADMIN_MODERATION_APPROVE',
      skipped: false,
      degraded: false,
    };

    const formatted = formatStructuredCapiEventLog(entry);
    expect(formatted).toContain('[CAPI EVENT]');
    expect(formatted).toContain('pur_default-tenant_res-123');

    const parsed = parseStructuredCapiEventLog(formatted);
    expect(parsed).toEqual(entry);
  });

  it('wajib bebas dari seluruh field PII (phone, name, address, ip, userAgent)', () => {
    const entry: StructuredCapiEventLog = {
      event: 'Contact',
      event_id: 'ctwa_12345_cust1',
      tenant: 'default-tenant',
      status: 200,
      events_received: 1,
      fbtrace_id: 'trace_xyz789',
      source: 'WHATSAPP_INBOUND_CTA',
      skipped: false,
      degraded: false,
    };

    const formatted = formatStructuredCapiEventLog(entry);
    const parsed = parseStructuredCapiEventLog(formatted) as any;

    expect(parsed.phone).toBeUndefined();
    expect(parsed.name).toBeUndefined();
    expect(parsed.address).toBeUndefined();
    expect(parsed.client_ip_address).toBeUndefined();
    expect(parsed.client_user_agent).toBeUndefined();
    expect(parsed.user_data).toBeUndefined();
  });

  it('harus mengembalikan null untuk string log biasa non-[CAPI EVENT]', () => {
    const line = '[CAPI SUCCESS] Successfully sent event Purchase to Meta CAPI.';
    expect(parseStructuredCapiEventLog(line)).toBeNull();
  });
});
