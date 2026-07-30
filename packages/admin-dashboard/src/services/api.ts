// API Client wrapper for sending requests to Fastify admin routes

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = endpoint.startsWith('/') ? endpoint : `/api/admin/${endpoint}`;
  
  // Make sure we include credentials for cookie session handling
  const mergedOptions: RequestInit = {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
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
