import { describe, it, expect } from 'vitest';

/**
 * Task 0.9 — Kontrak Sanitasi Payload Audit Log & Redaksi PII (Fase 3 Contract)
 * Status: MERAH sebelum implementasi Fase 3 (A-015 / A-008).
 */
describe('Task 0.9: Audit Payload Sanitizer Contract (Fase 3)', () => {
  it('1. Modul sanitizeAuditPayload harus ada dan meredaksi PII tanpa merusak nilai komersial', async () => {
    // Fase 3 membuat src/services/audit-payload-sanitizer.ts
    const sanitizerModule = await import('../../src/services/audit-payload-sanitizer');
    expect(typeof (sanitizerModule as any).sanitizeAuditPayload).toBe('function');

    const rawPayload = {
      phone: '081234567890',
      name: 'Bunda Siti Aminah',
      address: 'Jl. Rungkut Asri Timur No. 15, Surabaya',
      rawText: 'List untuk reservasi : Nama Bunda: Siti Aminah...',
      apiKey: 'ADMIN_SECRET_KEY_123',
      // Commercial fields yang WAJIB dipertahankan
      value: 150000,
      purchase_occurred_at: '2026-11-18T10:00:00.000Z',
      event_id: 'pur_default-tenant_res-123',
      events_received: 1,
      fbtrace_id: 'fb_trace_abc',
    };

    const sanitized = (sanitizerModule as any).sanitizeAuditPayload('APPROVE_PURCHASE_EVENT', rawPayload);

    // PII diredaksi / dimask
    expect(sanitized.phone).not.toBe('081234567890');
    expect(sanitized.phone).toMatch(/^0812\*{4}7890$/);
    expect(sanitized.address).toBe('[REDACTED]');
    expect(sanitized.rawText).toBe('[REDACTED]');
    expect(sanitized.apiKey).toBe('[REDACTED]');

    // Commercial data utuh
    expect(sanitized.value).toBe(150000);
    expect(sanitized.purchase_occurred_at).toBe('2026-11-18T10:00:00.000Z');
    expect(sanitized.event_id).toBe('pur_default-tenant_res-123');
    expect(sanitized.events_received).toBe(1);
    expect(sanitized.fbtrace_id).toBe('fb_trace_abc');
  });

  it('2. AuditService.logAdminAction wajib menolak pemanggilan tanpa tenantId', async () => {
    const { auditService } = await import('../../src/services/audit.service');
    // Fase 3 mewajibkan tenantId pada interface AuditLogData (compile-time & runtime guard)
    await expect(
      (auditService as any).logAdminAction({
        action: 'TEST_NO_TENANT',
        // tenantId sengaja ditiadakan untuk menguji guard
      })
    ).rejects.toThrow(/tenantId wajib/i);
  });
});
