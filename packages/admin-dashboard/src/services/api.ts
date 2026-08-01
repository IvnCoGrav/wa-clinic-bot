// API Client wrapper for sending requests to Fastify admin routes

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = endpoint.startsWith('/') ? endpoint : `/api/admin/${endpoint}`;
  
  // Hanya set Content-Type: application/json jika ada body.
  // Kalau tidak ada body (misal PATCH cancel/delete), jangan set —
  // fetch akan reject kalau Content-Type json tapi body kosong.
  const hasBody = options.body !== undefined && options.body !== null;
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  if (hasBody && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const mergedOptions: RequestInit = {
    ...options,
    credentials: 'include',
    headers,
  };

  const response = await fetch(url, mergedOptions);

  if (!response.ok) {
    let errorMsg = 'API request failed';
    try {
      const errorData = await response.json();
      errorMsg = errorData.message || errorData.error || errorMsg;
    } catch (_) {}
    throw new Error(errorMsg);
  }

  return response.json();
}
