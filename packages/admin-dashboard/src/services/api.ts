// API Client wrapper for sending requests to Fastify admin routes

/** Query params untuk log atribusi klik iklan Meta (GET /api/admin/debug/meta-clicks). */
export interface MetaClicksParams {
  page?: number | string;
  pageSize?: number | string;
  search?: string;
  status?: 'all' | 'matched' | 'unmatched';
  utmCampaign?: string;
  startDate?: string;
  endDate?: string;
}

/** Rentang tanggal default backend bila tidak diisi: 30 hari terakhir. */
export function fetchMetaClicks<T = any>(params: MetaClicksParams = {}): Promise<T> {
  const q = new URLSearchParams();
  if (params.page !== undefined) q.set('page', String(params.page));
  if (params.pageSize !== undefined) q.set('pageSize', String(params.pageSize));
  if (params.search) q.set('search', params.search);
  if (params.status && params.status !== 'all') q.set('status', params.status);
  if (params.utmCampaign) q.set('utmCampaign', params.utmCampaign);
  if (params.startDate) q.set('startDate', params.startDate);
  if (params.endDate) q.set('endDate', params.endDate);
  const qs = q.toString();
  return apiRequest(`/api/admin/debug/meta-clicks${qs ? `?${qs}` : ''}`);
}

/** Ringkasan KPI atribusi & kesehatan CAPI (GET /api/admin/debug/meta-summary). */
export function fetchMetaSummary<T = any>(params: { startDate?: string; endDate?: string } = {}): Promise<T> {
  const q = new URLSearchParams();
  if (params.startDate) q.set('startDate', params.startDate);
  if (params.endDate) q.set('endDate', params.endDate);
  const qs = q.toString();
  return apiRequest(`/api/admin/debug/meta-summary${qs ? `?${qs}` : ''}`);
}

/** Live test koneksi Meta CAPI (POST /api/admin/debug/meta-capi-test). */
export function testCapiEvent<T = any>(body: {
  eventName?: string;
  value?: number;
  currency?: string;
  testEventCode?: string;
}): Promise<T> {
  return apiRequest('/api/admin/debug/meta-capi-test', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const url = endpoint.startsWith('/') ? endpoint : `/api/admin/${endpoint}`;
  const timeoutMs = options.timeoutMs ?? 15000; // Default 15s timeout
  
  const method = (options.method || 'GET').toUpperCase();
  const needsJsonBody = ['POST', 'PUT', 'PATCH'].includes(method);
  
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };

  let body = options.body;
  if (needsJsonBody && body === undefined && !headers['Content-Type']) {
    body = JSON.stringify({});
    headers['Content-Type'] = 'application/json';
  } else if (body !== undefined && body !== null && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const mergedOptions: RequestInit = {
    ...options,
    credentials: 'include',
    headers,
    signal: options.signal || controller.signal,
    ...(body !== undefined ? { body } : {}),
  };

  try {
    const response = await fetch(url, mergedOptions);
    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMsg = 'API request failed';
      try {
        const errorData = await response.json();
        errorMsg = errorData.message || errorData.error || errorMsg;
      } catch (_) {}
      const error = new Error(errorMsg) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    return response.json();
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Koneksi server/database lambat (Timeout ${Math.round(timeoutMs / 1000)}s). Silakan coba lagi.`);
    }
    throw err;
  }
}
