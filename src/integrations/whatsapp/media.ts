import axios from 'axios';
import { CircuitBreaker } from '../../utils/circuit-breaker';
import { GRAPH_API_VERSION, GRAPH_API_BASE_URL } from './graph.constants';

const MEDIA_TIMEOUT_MS = 5000;

export const wabaMediaBreaker = new CircuitBreaker(
  async (url: string, accessToken: string) => {
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: MEDIA_TIMEOUT_MS,
    });
    return response.data;
  },
  async () => null,
  { failureThreshold: 0.5, slidingWindowSize: 5, cooldownPeriodMs: 30000 }
);

/**
 * Resolve URL unduhan media WABA dari media ID via Meta Graph API.
 * GET /{media-id} → { url, mime_type }.
 * Best-effort: kegagalan (offline/rate-limit) mengembalikan null, tidak throw.
 */
export async function resolveWabaMediaUrl(
  mediaId: string,
  accessToken: string,
  baseUrl: string = GRAPH_API_BASE_URL
): Promise<{ url: string; mimeType?: string } | null> {
  if (!mediaId || !accessToken) return null;
  const endpoint = `${baseUrl}/${GRAPH_API_VERSION}/${mediaId}`;
  try {
    const data = await wabaMediaBreaker.execute(endpoint, accessToken);
    if (data?.url) {
      return { url: data.url, mimeType: data.mime_type };
    }
    return null;
  } catch (err: any) {
    console.warn(`[WABA MEDIA] Gagal resolve media ${mediaId}: ${err.message}`);
    return null;
  }
}
