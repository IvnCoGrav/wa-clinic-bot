// API Client wrapper for sending requests to Fastify admin routes

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = endpoint.startsWith('/') ? endpoint : `/api/admin/${endpoint}`;
  
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

  const mergedOptions: RequestInit = {
    ...options,
    credentials: 'include',
    headers,
    ...(body !== undefined ? { body } : {}),
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
