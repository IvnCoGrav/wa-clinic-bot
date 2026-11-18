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

  it('2. AuditService.logAdminAction fail-soft ke default-tenant + log error bila caller untyped tidak memberi tenantId (tidak menjatuhkan route jadi 500)', async () => {
    const { vi } = await import('vitest');
    const { prisma } = await import('../../src/db/client');
    const { auditService } = await import('../../src/services/audit.service');
    const createSpy = vi.spyOn(prisma.auditLog, 'create').mockResolvedValueOnce({ id: 'audit-safe' } as any);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        (auditService as any).logAdminAction({
          action: 'TEST_NO_TENANT',
        })
      ).resolves.toBeUndefined();
      expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/tenantId kosong/i));
      expect((createSpy.mock.calls[0][0] as any).data.tenant_id).toBe('default-tenant');
    } finally {
      createSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it('3. ADVERSARIAL: menangani shared object non-circular, circular reference, BigInt bersarang, Date, Error bebas PII, dan JSON string tanpa double-encode', async () => {
    const { sanitizeAuditPayload } = await import('../../src/services/audit-payload-sanitizer');

    const shared = { label: 'same-ref', count: 2 };
    const cyclic: Record<string, any> = { id: 'cyc-1', phone: '081234567890' };
    cyclic.self = cyclic;

    const dbErr = Object.assign(new Error('Invalid phone 081299998888 for user'), { code: 'P2002' });
    const raw = {
      firstRef: shared,
      secondRef: shared,
      cyclic,
      nested: {
        bigId: BigInt('9007199254740993'),
        at: new Date('2026-11-18T10:00:00.000Z'),
        err: dbErr,
        nestedJsonString: '{"keep":"as-string"}',
      },
    };

    const sanitized = sanitizeAuditPayload('ADVERSARIAL_ACTION', raw);

    // A-003: shared object non-circular tidak boleh salah ditandai [CIRCULAR]
    expect(sanitized.firstRef).toEqual({ label: 'same-ref', count: 2 });
    expect(sanitized.secondRef).toEqual({ label: 'same-ref', count: 2 });

    // Circular reference terpotong aman & PII di dalamnya tetap dimask
    expect(sanitized.cyclic.self).toBe('[CIRCULAR]');
    expect(sanitized.cyclic.phone).toMatch(/^0812\*{4}7890$/);

    // A-004: BigInt bersarang terkonversi string sehingga JSON.stringify murni sukses
    expect(sanitized.nested.bigId).toBe('9007199254740993');
    expect(sanitized.nested.at).toBe('2026-11-18T10:00:00.000Z');
    expect(() => JSON.stringify(sanitized)).not.toThrow();

    // A-005: Error tidak boleh membocorkan message mentah (berpotensi PII)
    expect(sanitized.nested.err).toEqual({ name: 'Error', code: 'P2002' });
    expect(JSON.stringify(sanitized.nested.err)).not.toContain('081299998888');

    // N-8: string bersarang di dalam objek tetap bertipe string
    expect(typeof sanitized.nested.nestedJsonString).toBe('string');
    expect(sanitized.nested.nestedJsonString).toBe('{"keep":"as-string"}');

    // A-011 / N-2: string JSON di top-level diparsing & dikembalikan sebagai objek tersanitasi (anti double-encode)
    const fromTopJson = sanitizeAuditPayload('JSON_STR_ACTION', '{"phone":"081234567890","value":120000}');
    expect(typeof fromTopJson).toBe('object');
    expect(fromTopJson.phone).toMatch(/^0812\*{4}7890$/);
    expect(fromTopJson.value).toBe(120000);
  });
});
