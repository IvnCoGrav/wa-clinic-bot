import { FastifyRequest } from 'fastify';
import { DEFAULT_TENANT_ID } from '../../../config/tenant';

/**
 * Status kunci API + katalog resmi per gateway (sumber tunggal untuk GET & PATCH
 * provider — cegah drift respons antar endpoint).
 */
export function buildProvidersStatus(activeProvider: string) {
  const kenariKeyConfigured = Boolean(process.env.KENARI_API_KEY || (activeProvider === 'KENARI' && process.env.LLM_API_KEY));
  const sumopodKeyConfigured = Boolean(process.env.SUMOPOD_API_KEY || (activeProvider === 'SUMOPOD' && process.env.LLM_API_KEY));
  return {
    kenari: {
      name: 'Kenari AI (Cadangan)',
      baseUrl: (process.env.KENARI_BASE_URL || 'https://kenari.id/v1').replace(/\/$/, ''),
      defaultModel: process.env.KENARI_DEFAULT_MODEL || 'deepseek-v4-1-flash',
      models: ['deepseek-v4-1-flash', 'gemini-2-5-flash-lite', 'muse-spark-1-3-contributor'],
      configured: kenariKeyConfigured,
    },
    sumopod: {
      name: 'SumoPod AI (Utama)',
      baseUrl: (process.env.SUMOPOD_BASE_URL || 'https://ai.sumopod.com/v1').replace(/\/$/, ''),
      defaultModel: process.env.SUMOPOD_DEFAULT_MODEL || 'glm-5.3-flash',
      models: ['glm-5.3-flash', 'MiniMax-M2.7-highspeed', 'qwen3.7-flash-2026-07-15', 'gpt-4o-mini', 'deepseek-v4-flash-0731:netra'],
      configured: sumopodKeyConfigured,
    },
    deepseekDirect: {
      name: 'DeepSeek Direct (Last Fallback)',
      baseUrl: (process.env.LLM_FALLBACK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, ''),
      defaultModel: 'deepseek-chat',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      configured: Boolean(process.env.LLM_FALLBACK_API_KEY),
    },
  };
}

export const inMemoryConversationBehavior: Record<string, { enabled: boolean; minHours: number }> = {};

export function resolveTenantId(request: FastifyRequest): string {
  return (request as any).tenantId || DEFAULT_TENANT_ID;
}
