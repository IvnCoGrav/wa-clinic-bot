import { DEFAULT_TENANT_ID } from '../config/tenant';

/**
 * treatment-value.service.ts — Resolusi nilai/harga treatment dari katalog tenant.
 *
 * Dipisahkan dari `capi.service.ts`: pengetahuan katalog layanan bukan milik
 * pengiriman event Meta. Modul ini murni membaca katalog in-memory tenant
 * (tanpa DB langsung) sehingga bisa dipakai billing, analitik, dan CAPI.
 */

/**
 * Mencari harga (promoPrice ?? originalPrice) treatment di katalog berdasarkan
 * treatment_detail / raw text reservasi. Best-effort: tak ditemukan → undefined
 * (event dikirim tanpa value). Dipakai event Purchase CAPI.
 */
/**
 * Helpers data-driven katalog — tanpa hardcode harga/nama layanan.
 * Pencocokan berbasis katalog aktif per-tenant (treatmentCatalogService).
 */
function normalizeForMatch(s: string): string {
  return (s || '').toLowerCase().replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

function findCatalogPrice(term: string, catalogServices: any[], nameOnly: boolean = false): number | undefined {
  if (!term || !term.trim()) return undefined;
  const q = term.trim().toLowerCase();
  const qNorm = normalizeForMatch(q);
  if (!catalogServices || catalogServices.length === 0) return undefined;
  const genericStop = new Set(['perawatan','misterius','tidak','dikenal','treatment','homecare','pijat','massage','layanan','tanya','paket','konsultasi']);
  const sorted = [...catalogServices].sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));
  for (const s of sorted) {
    const raw = (s.name || '').toLowerCase().trim();
    const norm = normalizeForMatch(s.name || '');
    if (raw && (q === raw || qNorm === norm)) return s.promoPrice ?? s.originalPrice;
    if (norm && norm.length >= 5 && (q.includes(norm) || qNorm.includes(norm))) return s.promoPrice ?? s.originalPrice;
    if (raw && raw.length >= 5 && (q.includes(raw) || raw === q)) return s.promoPrice ?? s.originalPrice;
    if (!nameOnly) {
      const desc = (s.description || '').toLowerCase();
      if (desc && q.length >= 8 && desc.includes(q) && !genericStop.has(q)) return s.promoPrice ?? s.originalPrice;
    }
  }
  // Token-overlap fallback untuk alias informal — pilih layanan dengan skor kecocokan token tertinggi
  const qTokens = q.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  const filteredTokens = qTokens.filter((t) => !genericStop.has(t));
  if (filteredTokens.length > 0) {
    let best: any = null;
    let bestScore = -1;
    let bestLen = Infinity;
    for (const s of catalogServices) {
      const nameTokens = (s.name || '').toLowerCase().split(/[^a-z0-9]+/).filter((t: string) => t.length >= 3);
      const descTokens = !nameOnly ? (s.description || '').toLowerCase().split(/[^a-z0-9]+/).filter((t: string) => t.length >= 3) : [];
      let score = 0;
      for (const tok of filteredTokens) {
        if (nameTokens.includes(tok) || (s.name || '').toLowerCase().includes(tok)) {
          score += 2;
        } else if (!nameOnly && (descTokens.includes(tok) || (s.description || '').toLowerCase().includes(tok))) {
          // Penalti bundle untuk match deskripsi saja (prefer layanan STANDARD untuk keluhan/gejala)
          const isBundle = s.category === 'BUNDLE' || s.serviceType === 'BUNDLE';
          score += isBundle ? 0.5 : 1;
        }
      }
      if (score > 0) {
        const nameLen = (s.name || '').length;
        if (score > bestScore || (score === bestScore && nameLen < bestLen)) {
          best = s;
          bestScore = score;
          bestLen = nameLen;
        }
      }
    }
    if (best) return best.promoPrice ?? best.originalPrice;
  }
  return undefined;
}

/**
 * Mencari harga (promoPrice ?? originalPrice) treatment di katalog berdasarkan
 * treatment_detail / raw text reservasi.
 * Mendukung pencocokan alias, bundle kombinasi, multi-item compounding, dan kategori fallback.
 */
export async function resolveTreatmentValue(treatmentDetail: string | null | undefined, tenantId: string = DEFAULT_TENANT_ID): Promise<number | undefined> {
  if (!treatmentDetail || !treatmentDetail.trim()) return undefined;
  try {
    let catalogServices: any[] = [];
    try {
      const { treatmentCatalogService } = await import('./treatment-catalog.service');
      catalogServices = treatmentCatalogService.getAllServices(false, tenantId);
    } catch {}

    // Bersihkan durasi [xxm], kurung bayi/usia/kehamilan, dan template placeholder
    const cleanStr = treatmentDetail
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\((?:bayi|anak|kehamilan|usia|umur)[^)]*\)/gi, ' ')
      .replace(/\((?:mohon|jika|opsional|optional)[^)]*\)/gi, ' ')
      .trim();

    const cleanLower = cleanStr.toLowerCase();

    // 1. Direct bundle match data-driven: bila cleanStr cocok nama bundle katalog → pakai harga bundle
    const bundlePool = catalogServices.filter((s: any) => s.category === 'BUNDLE' || s.serviceType === 'BUNDLE' || s.bundleItemIds);
    const bundlePrice = findCatalogPrice(cleanStr, bundlePool, true);
    if (bundlePrice !== undefined) return bundlePrice;
    // Juga cek cleanLower mengandung nama bundle panjang (mis. "paket selapan")
    for (const b of [...bundlePool].sort((a: any, c: any) => (c.name?.length || 0) - (a.name?.length || 0))) {
      const bNorm = normalizeForMatch(b.name || '');
      if (bNorm.length >= 5 && cleanLower.includes(bNorm)) return b.promoPrice ?? b.originalPrice;
    }

    // 2. Pecah multi-treatment (berdasarkan '|', '\n', '+', '&', 'dan', atau koma)
    const segments = cleanStr
      .split(/[|\n]/g)
      .map((s) => s.trim())
      .filter(Boolean);

    let totalCalculated = 0;
    let matchedAny = false;

    for (const segment of segments) {
      // Hapus prefix seperti "Baby:", "Moms:", "Kids:", "Treatment:", "Pilihan treatment (Baby & Kids) :"
      const cleanedSegment = segment
        .replace(/^(?:Baby|Moms|Kids|Treatment|Pilihan treatment\s*(?:\([^)]*\))?)\s*:\s*/i, '')
        .trim();

      if (!cleanedSegment) continue;

      // Cek apakah segment ini memiliki sub-item dengan '+' atau 'dan' atau '&'
      const subItems = cleanedSegment
        .split(/\s*(?:\+|\bdan\b|\&)\s*/i)
        .map((x) => x.trim())
        .filter((x) => x.length >= 2 && !x.startsWith('('));

      // Jika ada subItems (misal: "Pijat Bayi Pulih Ceria + Sinar Moksa")
      if (subItems.length > 1) {
        // Guard: hanya anggap subItems bila pemisah '+', '&' eksplisit — hindari split kata 'dan' di dalam nama tunggal
        const hasExplicitSeparator = /\+|\&/.test(cleanedSegment);
        // Jika hanya 'dan' tanpa '+'/'&', verifikasi tiap sub adalah nama katalog valid sebelum sum
        let subSum = 0;
        let subMatched = false;
        let allSubValid = true;
        for (const sub of subItems) {
          const p = findCatalogPrice(sub, catalogServices);
          if (p !== undefined && p > 0) {
            subSum += p;
            subMatched = true;
          } else {
            allSubValid = false;
          }
        }
        if (subMatched && subSum > 0 && (hasExplicitSeparator || allSubValid)) {
          totalCalculated += subSum;
          matchedAny = true;
          continue;
        }
      }

      // Single item match pada segment — longest-match katalog
      const price = findCatalogPrice(cleanedSegment, catalogServices);
      if (price !== undefined && price > 0) {
        totalCalculated += price;
        matchedAny = true;
      }
    }

    if (matchedAny && totalCalculated > 0) {
      return totalCalculated;
    }

    // 3. Fallback pencocokan langsung pada seluruh teks
    const directPrice = findCatalogPrice(cleanStr, catalogServices);
    if (directPrice !== undefined && directPrice > 0) {
      return directPrice;
    }

    // 4. Fallback berbasis Kategori — data-driven: prefer layanan "Ceria"/generik, baru min
    const pickCategoryFallback = (cat: string): number | undefined => {
      const pool = catalogServices.filter((s: any) => (s.category || '').toUpperCase() === cat && s.serviceType !== 'ADD_ON' && s.category !== 'ADD_ON');
      if (pool.length === 0) return undefined;
      // Prefer ceria/relaksasi untuk BABY/KIDS, prenatal untuk MOMS
      const preferKeywords: Record<string, string[]> = { BABY: ['ceria', 'newborn'], KIDS: ['ceria'], MOMS: ['hamil', 'prenatal', 'laktasi'] };
      const kws = preferKeywords[cat] || [];
      for (const kw of kws) {
        const hit = pool.find((s: any) => (s.name || '').toLowerCase().includes(kw));
        if (hit) return hit.promoPrice ?? hit.originalPrice;
      }
      const vals = pool.map((s: any) => s.promoPrice ?? s.originalPrice).filter((v: any) => typeof v === 'number' && v > 0);
      if (vals.length === 0) return undefined;
      return Math.min(...vals);
    };
    if (cleanLower.includes('moms') || cleanLower.includes('ibu') || cleanLower.includes('hamil') || cleanLower.includes('nifas') || cleanLower.includes('laktasi')) {
      // D.2 (audit #199): DILARANG fallback angka baku. Bila kategori tidak
      // ketemu di katalog, kembalikan undefined (Meta terima event tanpa nilai)
      // daripada mengirim nominal salah.
      return pickCategoryFallback('MOMS');
    }
    if (cleanLower.includes('kids') || cleanLower.includes('anak')) {
      return pickCategoryFallback('KIDS');
    }
    if (cleanLower.includes('baby') || cleanLower.includes('bayi')) {
      return pickCategoryFallback('BABY');
    }


    return undefined;
  } catch {
    return undefined;
  }
}
