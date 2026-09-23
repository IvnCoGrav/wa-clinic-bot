import dotenv from 'dotenv';
dotenv.config();

/**
 * Cek apakah Tool-Masking Shadow Mode aktif.
 * Default: false (langsung enforce mode aktif, tanpa shadow mode — sistem
 * belum live ke klien; evaluasi pasif digantikan gate deterministik).
 */
export function isToolMaskingShadowMode(): boolean {
  return process.env.TOOL_MASKING_SHADOW_MODE === 'true';
}

/**
 * Cek apakah Tool-Masking Enforce Mode aktif (Direct Enforce).
 * Default: true (aktif secara default; nonaktif hanya jika TOOL_MASKING_ENFORCE
 * disetel eksplisit 'false', mis. untuk pengujian shadow).
 */
export function isToolMaskingEnforced(): boolean {
  return process.env.TOOL_MASKING_ENFORCE !== 'false';
}


