import { prisma } from '../db/client';
import { combinedSimilarity, normalizeForMatch } from '../utils/similarity';

/**
 * CTWA Greeting Catcher Service (tenant-aware, zero-dependency).
 *
 * Mencocokkan kalimat pembuka iklan Click-to-WhatsApp (multi-template) ke nama
 * kampanye saat metadata referral Meta hilang di jalan, dengan toleransi typo &
 * slang WhatsApp. Seluruh template & kata kunci jangkar bersumber dari DB
 * (`ctwa_campaign_catchers`), TIDAK ada kamus/daftar kata bisnis di kode.
 *
 * Prinsip:
 * - Guard berbasis SKOR + ANCHOR (bukan pencocokan string harfiah).
 * - Fallback in-memory saat DB offline (test offline tetap deterministik).
 * - Fail-open ke caller: error DB tidak pernah melempar ke webhook.
 */

export interface CtwaCatcherRow {
  id: string;
  tenant_id: string;
  campaign_name: string;
  source: string;
  medium: string;
  greetings: string[];
  anchor_keywords: string[];
  similarity_threshold: number;
  is_active: boolean;
  notes?: string | null;
}

export interface CtwaCatcherDiagnostic {
  template: string;
  score: number;
}

export interface CtwaCatcherMatchResult {
  matched: boolean;
  campaignName: string | null;
  source: string | null;
  medium: string | null;
  /** Skor kemiripan mentah (0.0–1.0) — dilaporkan apa adanya untuk diagnostik jujur. */
  similarityScore: number;
  /** Skor efektif = similarity + kredit anchor (dipakai melawan threshold). */
  effectiveScore: number;
  anchorCheckPassed: boolean;
  /** true bila guard anchor diloloskan karena skor sangat tinggi (bukan karena anchor cocok). */
  anchorBypassed: boolean;
  templateIndex: number;
  catcherId: string | null;
  diagnostics: CtwaCatcherDiagnostic[];
}

/** Ambang bypass anchor saat skor kemiripan sangat tinggi (konstanta algoritmik, bukan data bisnis). */
export const HIGH_CONFIDENCE_ANCHOR_BYPASS = 0.85;
/**
 * Kredit skor saat anchor cocok. Anchor = penanda kampanye yang dideklarasikan
 * admin (data-driven); kehadirannya menaikkan skor efektif agar variasi
 * typo/slang non-anchor tetap lolos ambang, tanpa menurunkan ambang global.
 * Slider threshold di dashboard tetap mengendalikan sensitivitas tradeoff.
 */
export const ANCHOR_MATCH_CREDIT = 0.30;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MIN_INPUT_CHARS = 4;
const THRESHOLD_MIN = 0.5;
const THRESHOLD_MAX = 0.95;

const cache = new Map<string, { at: number; rows: CtwaCatcherRow[] }>();

// Sumber fallback in-memory saat DB offline (diisi oleh __setMemoryCatchers pada test).
const memoryCatchers = new Map<string, CtwaCatcherRow[]>();

export function __setMemoryCatchers(tenantId: string, rows: CtwaCatcherRow[]): void {
  memoryCatchers.set(tenantId, rows);
  cache.delete(tenantId);
}

export function __clearMemoryCatchers(): void {
  memoryCatchers.clear();
  cache.clear();
}

/** Invalidasi cache (dipanggil admin API tiap CREATE/UPDATE/DELETE). */
export function invalidateCtwaCatcherCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

function clampThreshold(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0.7;
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, n));
}

async function getActiveCatchers(tenantId: string): Promise<CtwaCatcherRow[]> {
  const cached = cache.get(tenantId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rows;

  try {
    const rows = await prisma.ctwaCampaignCatcher.findMany({
      where: { tenant_id: tenantId, is_active: true },
      orderBy: { created_at: 'asc' },
    });
    const mapped: CtwaCatcherRow[] = (rows as any[]).map((r) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      campaign_name: r.campaign_name,
      source: r.source,
      medium: r.medium,
      greetings: Array.isArray(r.greetings) ? r.greetings : [],
      anchor_keywords: Array.isArray(r.anchor_keywords) ? r.anchor_keywords : [],
      similarity_threshold: r.similarity_threshold,
      is_active: r.is_active,
      notes: r.notes ?? null,
    }));
    cache.set(tenantId, { at: Date.now(), rows: mapped });
    return mapped;
  } catch {
    // DB offline → fallback in-memory (jangan cache; memori adalah sumber mutakhir di mode ini)
    return memoryCatchers.get(tenantId) || [];
  }
}

/**
 * Cek apakah input mengandung minimal 1 anchor keyword.
 * Berbasis frasa berbatas kata (bukan substring mentah), toleran urutan kata.
 */
export function anchorPasses(inputNorm: string, anchors: string[]): boolean {
  if (!anchors || anchors.length === 0) return true;
  const padded = ` ${inputNorm} `;
  return anchors.some((anchor) => {
    const na = normalizeForMatch(anchor);
    if (!na) return false;
    if (padded.includes(` ${na} `)) return true;
    const tokens = na.split(' ').filter(Boolean);
    if (tokens.length > 1) {
      return tokens.every((t) => padded.includes(` ${t} `));
    }
    return false;
  });
}

/**
 * Evaluasi teks inbound terhadap seluruh catcher aktif tenant.
 * Mengembalikan hasil kandidat terbaik (matched atau tidak), atau null bila
 * tidak ada catcher / input terlalu pendek untuk dicocokkan.
 */
export async function matchInboundText(
  text: string,
  tenantId: string
): Promise<CtwaCatcherMatchResult | null> {
  if (!tenantId) throw new Error('matchInboundText requires tenantId');
  const inputNorm = normalizeForMatch(text || '');
  if (inputNorm.replace(/ /g, '').length < MIN_INPUT_CHARS) return null;

  const catchers = await getActiveCatchers(tenantId);
  if (!catchers.length) return null;

  let best: CtwaCatcherMatchResult | null = null;

  for (const catcher of catchers) {
    const diagnostics: CtwaCatcherDiagnostic[] = [];
    let bestScore = 0;
    let bestIndex = -1;

    catcher.greetings.forEach((template, index) => {
      const score = combinedSimilarity(inputNorm, template);
      diagnostics.push({ template, score });
      if (bestIndex === -1 || score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    if (bestIndex === -1) continue;

    const threshold = clampThreshold(catcher.similarity_threshold);
    const anchorConfigured = (catcher.anchor_keywords || []).length > 0;
    const anchorOk = anchorConfigured && anchorPasses(inputNorm, catcher.anchor_keywords || []);
    const anchorBypassed = anchorConfigured && !anchorOk && bestScore >= HIGH_CONFIDENCE_ANCHOR_BYPASS;
    // Guard: catcher ber-anchor wajib memenuhi anchor (atau bypass skor tinggi);
    // catcher tanpa anchor tidak punya guard (andalkan similarity penuh).
    const guardOk = !anchorConfigured || anchorOk || anchorBypassed;
    // Kredit anchor HANYA saat anchor benar-benar diset & cocok — bukan untuk catcher generik.
    const effectiveScore = anchorOk ? Math.min(1, bestScore + ANCHOR_MATCH_CREDIT) : bestScore;
    const matched = guardOk && effectiveScore >= threshold;

    if (!best || bestScore > best.similarityScore) {
      best = {
        matched,
        campaignName: catcher.campaign_name,
        source: catcher.source,
        medium: catcher.medium,
        similarityScore: bestScore,
        effectiveScore,
        anchorCheckPassed: !anchorConfigured || anchorOk,
        anchorBypassed,
        templateIndex: bestIndex,
        catcherId: catcher.id,
        diagnostics,
      };
    }
  }

  return best;
}

export const ctwaTextCatcherService = {
  matchInboundText,
  invalidateCache: invalidateCtwaCatcherCache,
  // Diekspos untuk unit test offline.
  __setMemoryCatchers,
  __clearMemoryCatchers,
  anchorPasses,
};
