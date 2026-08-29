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
export function fetchMetaSummary<T = any>(params: { startDate?: string; endDate?: string; utmCampaign?: string; search?: string } = {}): Promise<T> {
  const q = new URLSearchParams();
  if (params.startDate) q.set('startDate', params.startDate);
  if (params.endDate) q.set('endDate', params.endDate);
  if (params.utmCampaign) q.set('utmCampaign', params.utmCampaign);
  if (params.search) q.set('search', params.search);
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

/** Kirim manual event CAPI dengan nomor HP dan data customer (POST /api/admin/debug/meta-manual-send). */
export function sendManualCapiEvent<T = any>(body: {
  phone: string;
  name?: string;
  treatment?: string;
  eventName: string;
  value?: number;
  currency?: string;
  testEventCode?: string;
}): Promise<T> {
  return apiRequest('/api/admin/debug/meta-manual-send', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Riwayat manual event yang dikirimkan (GET /api/admin/debug/meta-manual-history). */
export function fetchManualCapiHistory<T = any>(): Promise<T> {
  return apiRequest('/api/admin/debug/meta-manual-history');
}

interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

const memoryApiCache = new Map<string, CacheEntry>();

export function clearApiCache(prefix?: string) {
  if (!prefix) {
    memoryApiCache.clear();
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith('apiCache:')) sessionStorage.removeItem(key);
      }
    } catch {}
    return;
  }
  for (const key of memoryApiCache.keys()) {
    if (key.startsWith(prefix) || key.includes(prefix)) {
      memoryApiCache.delete(key);
    }
  }
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('apiCache:') && (key.includes(prefix) || key.startsWith(`apiCache:${prefix}`))) {
        sessionStorage.removeItem(key);
      }
    }
  } catch {}
}

export function getCachedApiResponse<T = any>(endpoint: string): T | null {
  const url = endpoint.startsWith('/') ? endpoint : `/api/admin/${endpoint}`;
  const entry = memoryApiCache.get(url);
  if (entry) return entry.data as T;
  try {
    const raw = sessionStorage.getItem(`apiCache:${url}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.data) {
        memoryApiCache.set(url, parsed);
        return parsed.data as T;
      }
    }
  } catch {}
  return null;
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit & { timeoutMs?: number; useCache?: boolean; ttlMs?: number; forceFresh?: boolean; retryCount?: number } = {}
): Promise<T> {
  const url = endpoint.startsWith('/') ? endpoint : `/api/admin/${endpoint}`;
  const method = (options.method || 'GET').toUpperCase();
  const isGet = method === 'GET';

  // Invalidate cache on write operations
  if (!isGet) {
    clearApiCache();
  }

  // SWR Cache check for GET requests: Instant 0ms response
  const shouldCache = options.useCache !== false && isGet;
  const ttlMs = options.ttlMs ?? 15000; // 15s default freshness

  if (shouldCache && !options.forceFresh) {
    let cached = memoryApiCache.get(url);
    if (!cached) {
      try {
        const raw = sessionStorage.getItem(`apiCache:${url}`);
        if (raw) {
          cached = JSON.parse(raw);
          if (cached) memoryApiCache.set(url, cached);
        }
      } catch {}
    }
    if (cached && Date.now() - cached.timestamp < (cached.ttlMs || ttlMs)) {
      return cached.data as T;
    }
  }

  const timeoutMs = options.timeoutMs ?? 15000; // Default 15s timeout
  const needsJsonBody = ['POST', 'PUT', 'PATCH'].includes(method);
  
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };

  let body = options.body;
  if (needsJsonBody && body === undefined && !headers['Content-Type']) {
    body = JSON.stringify({});
    headers['Content-Type'] = 'application/json';
  } else if (body !== undefined && body !== null) {
    if (typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
      body = JSON.stringify(body);
    }
    if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const mergedOptions: RequestInit = {
    ...options,
    cache: (options as any).cache ?? 'no-store',
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

    const data = await response.json();
    if (shouldCache) {
      const cacheObj = {
        data,
        timestamp: Date.now(),
        ttlMs,
      };
      memoryApiCache.set(url, cacheObj);
      try {
        sessionStorage.setItem(`apiCache:${url}`, JSON.stringify(cacheObj));
      } catch {}
    }
    return data;
  } catch (err: any) {
    clearTimeout(timeoutId);

    // Stale-While-Revalidate Fallback: Jika koneksi sempat drop / sleep, gunakan data cache yang ada
    if (isGet) {
      const fallbackCache = getCachedApiResponse<T>(url);
      if (fallbackCache) {
        console.warn(`[API] Serving stale cached response for ${url} due to network timeout.`);
        return fallbackCache;
      }
    }

    // Auto-retry 1x on network transient abort
    const retries = options.retryCount ?? 0;
    if (retries < 1 && isGet && (err.name === 'AbortError' || err.message?.includes('Failed to fetch'))) {
      return apiRequest<T>(endpoint, { ...options, retryCount: retries + 1, timeoutMs: 20000 });
    }

    if (err.name === 'AbortError') {
      throw new Error(`Koneksi server/database lambat (Timeout ${Math.round(timeoutMs / 1000)}s). Silakan coba lagi.`);
    }
    throw err;
  }
}
