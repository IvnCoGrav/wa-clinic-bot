import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from './tenant';

/**
 * humanizer-bubble.config.ts — konfigurasi pemecah bubble per tenant.
 *
 * Latar (W-010): `typing.service.ts` dulu memakai daftar frasa bisnis hardcode
 * ("mohon bisa diisi", "berikut list untuk reservasi", label lama
 * "Alamat & Shareloc") untuk mendeteksi form reservasi. Itu rapuh dan
 * melanggar mandat data-driven: frasa bisnis berubah tanpa deploy kode.
 *
 * Kontrak baru:
 * - Deteksi form bersifat STRUKTURAL (baris `Label : nilai`, blok field, judul
 *   pendek di atasnya) — tidak butuh daftar frasa bisnis.
 * - Tenant hanya dapat menambah PEMISAH label/nilai yang tidak lazim (mis. "="
 *   atau "—") lewat `Tenant.settings.humanizerBubble.extraSeparators`.
 *   Tidak ada data bisnis di kode; default kosong = pemisah ":" saja.
 */

export interface HumanizerBubbleConfig {
  /** Pemisah label↔nilai tambahan khas tenant (":" selalu aktif). */
  extraSeparators: string[];
}

export const EMPTY_HUMANIZER_BUBBLE_CONFIG: HumanizerBubbleConfig = {
  extraSeparators: [],
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const configCache = new Map<string, { config: HumanizerBubbleConfig; expiresAt: number }>();

function parseConfig(raw: unknown): HumanizerBubbleConfig {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_HUMANIZER_BUBBLE_CONFIG };
  const separators = Array.isArray((raw as any).extraSeparators)
    ? (raw as any).extraSeparators
        .filter((s: unknown) => typeof s === 'string' && s.trim().length > 0)
        .map((s: string) => s.trim())
        .slice(0, 5)
    : [];
  return {
    extraSeparators: separators.filter((s: string) => s.length <= 3),
  };
}

/**
 * Ambil konfigurasi bubble humanizer tenant. DB offline / belum dikonfigurasi
 * → konfigurasi kosong (deteksi struktural tetap berjalan).
 */
export async function getHumanizerBubbleConfig(
  tenantId: string = DEFAULT_TENANT_ID
): Promise<HumanizerBubbleConfig> {
  const cached = configCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.config;

  let resolved: HumanizerBubbleConfig = { ...EMPTY_HUMANIZER_BUBBLE_CONFIG };
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    resolved = parseConfig((tenant?.settings as any)?.humanizerBubble);
  } catch (err: any) {
    console.warn(
      `[HumanizerBubbleConfig] Gagal memuat konfigurasi tenant '${tenantId}', memakai default struktural:`,
      err?.message || err
    );
  }

  configCache.set(tenantId, { config: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
  return resolved;
}

/** Hapus cache (dipanggil setelah admin mengubah settings tenant). */
export function clearHumanizerBubbleConfigCache(tenantId?: string): void {
  if (tenantId) configCache.delete(tenantId);
  else configCache.clear();
}

export { parseConfig as parseHumanizerBubbleConfig };
