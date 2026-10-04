import { describe, it, expect, beforeEach } from 'vitest';
import {
  getGreetingTemplateRaw,
  renderGreeting,
  resolveGreetingText,
  invalidateGreetingTemplateCache,
} from '../../src/services/greeting-template.service';
import { TEMPLATES } from '../../src/config/persona';

/**
 * Fase 2 (Revisi Turn-0): template sapaan DB-driven, tenant-aware, dengan
 * fallback aman. Offline (DB down) → fallback wajib identik template lama.
 */
describe('greeting-template.service', () => {
  beforeEach(() => invalidateGreetingTemplateCache());

  it('renderGreeting: ganti penanda aman tanpa sisa {{...}}', () => {
    const out = renderGreeting('{{greeting}} Bunda, saya {{nama}} dari klinik.', { isIslamic: true, customerName: 'Lyaa' });
    expect(out).toBe('Waalaikumsalam Bunda, saya Lyaa dari klinik.');
    expect(out).not.toContain('{{');
  });

  it('renderGreeting: nama kosong → fallback "Bunda"', () => {
    expect(renderGreeting('Halo {{customerName}}', {})).toBe('Halo Bunda');
  });

  it('renderGreeting: penanda tak dikenal dibersihkan (anti bocor template)', () => {
    expect(renderGreeting('Halo {{foo}} Bunda', {})).toBe('Halo Bunda');
  });

  it('DB offline → fallback = TEMPLATES.greeting (non-Islami)', async () => {
    const raw = await getGreetingTemplateRaw('default-tenant');
    expect(raw).toBeNull();
    const text = await resolveGreetingText('default-tenant', { isIslamic: false });
    expect(text).toBe(TEMPLATES.greeting({ isIslamic: false }));
  });

  it('DB offline → fallback Islami memakai Waalaikumsalam', async () => {
    const text = await resolveGreetingText('default-tenant', { isIslamic: true });
    expect(text.startsWith('Waalaikumsalam Bunda')).toBe(true);
  });
});
