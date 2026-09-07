/**
 * Utility untuk parsing dan sanitasi string treatment dari jadwal/reservasi
 * Menghilangkan artefak buffer waktu seperti `[Total 55m + Buffer 20m = 75m]`
 * dan mengekstrak nama layanan murni agar tidak terbelah menjadi item dummy.
 */

export interface ParsedTreatmentItem {
  instanceId: string;
  serviceId?: string;
  name: string;
  category: 'BABY' | 'MOMS' | 'BOTH' | 'KIDS' | 'BUNDLE' | 'ADD_ON';
  durationMinutes: number;
  price: number;
  isAddon: boolean;
  assignedChildIndex?: number;
}

/**
 * Menghapus metadata buffer waktu dan total durasi dari string reservasi
 * Contoh: "Pijat Bayi Ceria [40m] + Sinar Moksa [15m] [Total 55m + Buffer 20m = 75m]"
 * Menjadi: "Pijat Bayi Ceria [40m] + Sinar Moksa [15m]"
 */
export function stripBufferMetadata(rawTreatmentStr?: string | null): string {
  if (!rawTreatmentStr) return '';
  return rawTreatmentStr
    // Hapus pola buffer waktu [Total 55m + Buffer 20m = 75m] atau variasi serupa
    .replace(/\s*\[Total\s+\d+m(?:\s*\+\s*Buffer\s+\d+m)?\s*=\s*\d+m\]/gi, '')
    // Hapus [Admin Manual] prefix jika ada
    .replace(/^\[Admin\s*Manual\]\s*/i, '')
    // Hapus kategori prefix jika ada (misal "BABY: " atau "BOTH: ")
    .replace(/^(?:BABY|MOMS|BOTH|KIDS|BUNDLE):\s*/i, '')
    .trim();
}

/**
 * Membersihkan nama layanan individual dari tag durasi inline
 * Contoh: "Pijat Bayi Ceria (Rileksasi) [40m]" -> "Pijat Bayi Ceria (Rileksasi)"
 */
export function cleanTreatmentName(itemStr: string): string {
  if (!itemStr) return '';
  return itemStr
    .replace(/\s*\[\d+m(?:\s*Addon)?\]/gi, '')
    .replace(/\s*\([^)]*anak[^)]*\)/gi, '')
    .trim();
}

/**
 * Memeriksa apakah nama layanan merupakan layanan Add-on
 */
export function isAddonServiceName(name: string): boolean {
  const lower = (name || '').toLowerCase();
  return (
    lower.includes('moksa') ||
    lower.includes('moxa') ||
    lower.includes('addon') ||
    lower.includes('add-on') ||
    lower.includes('tambahan') ||
    lower.includes('taping') ||
    lower.includes('kinesio') ||
    lower.includes('ear candle') ||
    lower.includes('nebulizer') ||
    lower.includes('potong kuku') ||
    lower.includes('tindik')
  );
}

/**
 * Penanda layanan bundle/paket — kandidat yang memuat kata ini HANYA dipilih bila
 * teks customer eksplisit memuat kata bundle yang sama ("selapan", "cukur", ...).
 * Mencegah "pijat ceria" salah cocok ke "Paket Selapan (Cukur + Pijat Ceria)".
 */
const BUNDLE_MARKERS = ['paket', 'selapan', 'cukur', 'bundle', 'bundling', 'hemat', 'komplit', 'lengkap'];

/**
 * Alias slang → token katalog ("oksifull" → oksitosin + full).
 */
const SERVICE_TOKEN_ALIASES: Record<string, string[]> = {
  oksifull: ['oksitosin', 'full'],
  oksitoksin: ['oksitosin'],
  oksi: ['oksitosin'],
  moksa: ['moksa'],
};

function significantTokens(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

function expandTokenAliases(tokens: string[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    const alias = SERVICE_TOKEN_ALIASES[t];
    if (alias) out.push(...alias);
    else out.push(t);
  }
  return out;
}

/**
 * Satu token query cocok ke token kandidat bila sama persis ATAU substring dua arah
 * (mis. "full"/"body" vs "fullbody"). Batas minimal 4 huruf agar tidak noisy.
 */
function tokenHits(queryTok: string, candTok: string): boolean {
  if (queryTok === candTok) return true;
  if (queryTok.length >= 4 && candTok.length >= 4 && (candTok.includes(queryTok) || queryTok.includes(candTok))) return true;
  return false;
}

/**
 * Intelligent matching: teks bebas customer ("pijat ceria", "oksitosin full body",
 * "oksifull") → item katalog yang tepat ("Pijat Bayi Ceria (Rileksasi)",
 * "Oksitosin Massage Fullbody"), BUKAN bundle ("Paket Selapan...").
 *
 * Skor = cakupan token query (shared/query) dengan tie-break spesifisitas
 * (shared/kandidat). Kandidat bundle-ish yang tidak disebut eksplisit customer
 * hanya dipakai sebagai fallback terakhir.
 */
export function matchCatalogService(
  query: string | null | undefined,
  catalog: Array<{
    id?: string;
    name: string;
    price?: number;
    promoPrice?: number;
    originalPrice?: number;
    category?: string;
    durationMinutes?: number;
  }> = []
): any | null {
  const qRaw = (query || '').trim();
  if (!qRaw || !catalog || catalog.length === 0) return null;

  // 1. Exact match selalu menang (nama resmi utuh).
  const qLower = qRaw.toLowerCase();
  const exact = catalog.find((c) => (c.name || '').toLowerCase().trim() === qLower);
  if (exact) return exact;

  // 2. Token overlap scoring.
  const qToks = expandTokenAliases(significantTokens(qRaw));
  if (qToks.length === 0) return null;
  const qExplicitBundle = BUNDLE_MARKERS.some(
    (m) => qToks.includes(m) || qLower.includes(m)
  );

  let best: any = null;
  let bestCoverage = -1;
  let bestSpecificity = -1;
  let fallbackBundle: any = null;

  for (const c of catalog) {
    const cToks = significantTokens(c.name || '');
    if (cToks.length === 0) continue;
    const shared = qToks.filter((qt) => cToks.some((ct) => tokenHits(qt, ct))).length;
    if (shared === 0) continue;
    const isBundleish = BUNDLE_MARKERS.some((m) => (c.name || '').toLowerCase().includes(m));
    if (isBundleish && !qExplicitBundle) {
      if (!fallbackBundle) fallbackBundle = c;
      continue;
    }
    const coverage = shared / qToks.length;
    const specificity = shared / cToks.length;
    if (coverage > bestCoverage || (coverage === bestCoverage && specificity > bestSpecificity)) {
      best = c;
      bestCoverage = coverage;
      bestSpecificity = specificity;
    }
  }

  return best || fallbackBundle;
}

/**
 * Mengekstrak daftar layanan murni dari string detail reservasi,
 * lalu mencocokkannya ke katalog database (jika tersedia) untuk mendapatkan harga & durasi riil.
 */
export function parseTreatmentItemsFromRaw(
  rawTreatmentStr: string | null | undefined,
  catalog: Array<{
    id?: string;
    name: string;
    price?: number;
    promoPrice?: number;
    originalPrice?: number;
    category?: string;
    durationMinutes?: number;
  }> = []
): ParsedTreatmentItem[] {
  const stripped = stripBufferMetadata(rawTreatmentStr);
  if (!stripped) return [];

  // Pecah berdasarkan tanda plus (+) antar layanan
  const parts = stripped
    .split(/\s*\+\s*/)
    .map((s) => s.trim())
    .filter((s) => {
      if (!s) return false;
      // Jangan masukkan string buffer yang mungkin tersisa
      const lower = s.toLowerCase();
      if (lower.startsWith('buffer') || lower.includes('buffer') || lower.startsWith('total')) return false;
      return true;
    });

  if (parts.length === 0) return [];

  const catalogMap = new Map<string, any>();
  catalog.forEach((c) => {
    catalogMap.set(c.name.toLowerCase().trim(), c);
    if (c.id) catalogMap.set(c.id.toLowerCase().trim(), c);
  });

  return parts.map((part, idx) => {
    const pureName = cleanTreatmentName(part);
    const matched = catalogMap.get(pureName.toLowerCase()) ||
      matchCatalogService(pureName, catalog);

    const isAddon = isAddonServiceName(pureName);
    let category: 'BABY' | 'MOMS' | 'BOTH' | 'KIDS' | 'BUNDLE' | 'ADD_ON' = isAddon ? 'ADD_ON' : 'BABY';

    if (matched?.category) {
      category = matched.category as any;
    } else if (/mom|hamil|laktasi|nifas|breast|oksitosin/i.test(pureName)) {
      category = 'MOMS';
    }

    const price = matched ? Number(matched.promoPrice ?? matched.price ?? matched.originalPrice ?? 60000) : 60000;
    const duration = matched ? Number(matched.durationMinutes || 40) : (part.match(/\[(\d+)m/)?.[1] ? parseInt(part.match(/\[(\d+)m/)![1], 10) : 40);

    return {
      instanceId: `inst-${idx}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      serviceId: matched?.id || `custom-${pureName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: matched?.name || pureName || part,
      category,
      durationMinutes: duration,
      price,
      isAddon,
      assignedChildIndex: 0,
    };
  });
}
