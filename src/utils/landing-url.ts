/**
 * event_source_url Meta CAPI tidak boleh sepenuhnya dikendalikan klien.
 * Jika nilai yang dikirim berasal dari host yang sama dengan domain tenant,
 * pertahankan; selain itu pakai origin kanonis tenant.
 */
export function trustLandingUrlForCapi(candidate: unknown, tenantDomain: unknown): string {
  const domain = typeof tenantDomain === 'string' ? tenantDomain.trim() : '';
  const raw = typeof candidate === 'string' ? candidate.trim() : '';
  if (!domain) return raw;
  try {
    const allowed = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
    if (raw) {
      const parsed = new URL(raw);
      if (parsed.host.toLowerCase() === allowed.host.toLowerCase()) return raw;
    }
    return `${allowed.protocol}//${allowed.host}`;
  } catch {
    return raw;
  }
}
