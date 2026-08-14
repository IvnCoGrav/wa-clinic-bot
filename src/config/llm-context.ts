/**
 * Konfigurasi konteks LLM — satu sumber jumlah riwayat percakapan yang dikirim
 * ke model (NLU classifier, AI router, dan generator). Dapat di-override via
 * env LLM_HISTORY_LIMIT. Lihat Fase 4.2 docs/HARDCODED_FIX_PLAN.md.
 */
import { parsePositiveInt } from '../utils/env-numeric';

export const LLM_HISTORY_LIMIT = parsePositiveInt(process.env.LLM_HISTORY_LIMIT, 6);
