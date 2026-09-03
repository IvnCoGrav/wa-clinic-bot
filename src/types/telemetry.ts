/**
 * Telemetri Kualitas AI — skema data per turn
 * Overhead target <2ms (hanya hitung string & simpan di memori)
 */

export interface TurnQualityMetrics {
  conversationId: string;
  customerPhone: string;
  tenantId: string;
  timestamp: number; // Date.now()
  rawLlmReply: string | null;
  sanitizedReply: string | null;
  mutilationRatio: number; // 0..1
  isSilentDrop: boolean;
  isUnjustifiedRsqr: boolean;
  nluErrorCode: string | null; // 'HTTP_400' | 'HTTP_401' | 'JSON_TRUNCATED' | null
  isJsonTruncated: boolean;
  latencyMs: number;
  modelName?: string;
}

export interface AiHealthSummary {
  windowHours: number;
  totalTurns: number;
  silentDropRate: number; // SDR %
  unjustifiedRsqrRate: number; // %
  sanitizerMutilationRate: number; // SMR %
  nluErrorRate: number; // %
  p50LatencyMs: number;
  p90LatencyMs: number;
  p95LatencyMs: number;
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  perModelLatency?: Record<string, { p50: number; p90: number; p95: number; count: number }>;
  generatedAt: string;
}

export type HealthStatus = AiHealthSummary['status'];
