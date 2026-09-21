/**
 * Sinkronkan tarif Kenari live ke `src/config/kenari-pricing.snapshot.json`.
 *
 * Kenari memublikasikan tarif via `GET https://kenari.id/v1/models` TANPA API key
 * (unit: `micro_idr_per_1m_tokens`). Snapshot di-commit agar estimator cost tetap
 * akurat meski request ini tak tersedia saat runtime (offline-safe, dipakai tests).
 *
 * Jalankan: `npx tsx scripts/sync-pricing.ts`
 * Model dengan `free: true` (kuota tak berbayar) dicatat tarif 0 (moneter).
 */

import * as fs from 'fs';
import * as path from 'path';

/** Model yang dipakai aplikasi (katalog Kenari cadangan) — hanya 3 model resmi + legacy snapshot. */
const TRACKED_MODELS = [
  'deepseek-v4-1-flash',
  'gemini-2-5-flash-lite',
  'muse-spark-1-3-contributor',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'qwen3-8-flash',
  'qwen3-7-plus',
  'minimax-m2-7',
  'step-3-7-flash',
  'step-3-7-flash:free',
];

const SNAPSHOT_PATH = path.resolve(__dirname, '../src/config/kenari-pricing.snapshot.json');

interface KenariModel {
  id: string;
  free?: boolean;
  pricing?: {
    input?: number;
    cache_read?: number;
    output?: number;
    unit?: string;
  };
}

async function main(): Promise<void> {
  let data;
  try {
    const res = await fetch('https://kenari.id/v1/models', { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as { data?: KenariModel[] };
  } catch (err) {
    console.error('[sync-pricing] Gagal fetch Kenari live — snapshot TIDAK diubah:', err);
    process.exit(1);
  }

  const models: Record<string, { inputPer1M: number; cacheHitPer1M: number; outputPer1M: number }> = {};
  for (const id of TRACKED_MODELS) {
    const m = (data?.data || []).find((x) => x.id === id);
    if (!m?.pricing) {
      console.warn(`[sync-pricing] Model tidak ada di katalog live (dipertahankan dari snapshot lama): ${id}`);
      continue;
    }
    const free = m.free === true;
    models[id] = {
      inputPer1M: free ? 0 : (m.pricing.input || 0) / 1e6,
      cacheHitPer1M: free ? 0 : (m.pricing.cache_read || 0) / 1e6,
      outputPer1M: free ? 0 : (m.pricing.output || 0) / 1e6,
    };
  }

  if (Object.keys(models).length === 0) {
    console.error('[sync-pricing] Tidak ada model yang cocok — batalkan, jangan timpa snapshot.');
    process.exit(1);
  }

  const snapshot = {
    source: 'https://kenari.id/v1/models (publik, tanpa API key)',
    unit: 'IDR per 1M token (micro_idr / 1e6)',
    note: 'model free=true => tarif 0 (moneter)',
    fetchedAt: new Date().toISOString(),
    models,
  };

  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log(`[sync-pricing] Snapshot ditulis: ${SNAPSHOT_PATH}`);
  for (const [id, r] of Object.entries(models)) {
    console.log(`  ${id}: in ${r.inputPer1M} / hit ${r.cacheHitPer1M} / out ${r.outputPer1M} (Rp per 1M)`);
  }
}

main().catch((err) => {
  console.error('[sync-pricing] Gagal:', err);
  process.exit(1);
});