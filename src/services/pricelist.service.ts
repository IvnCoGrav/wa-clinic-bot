/**
 * pricelist.service.ts
 * Transformer data katalog klinis (Single Source of Truth: tabel `clinic_services`
 * via treatmentCatalogService) menjadi payload siap-render untuk landing page
 * pricelist (dinamis & tenant-aware).
 *
 * Prinsip:
 * - 100% data-driven: TIDAK ada nama layanan/tarif/nomor WA yang di-hardcode.
 * - Chrome UI (ikon, judul seksi, meta) diturunkan dari kategori katalog + brand
 *   tenant; bukan data bisnis. Prefix nama layanan dibersihkan secara GENERIK
 *   (turunan brand.businessName + kata kategori), bukan daftar string hafalan.
 * - Gagal baca DB tidak pernah melempar: treatmentCatalogService sinkron dari
 *   cache memori; metadata tenant/brand best-effort dengan fallback aman.
 */

import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { BrandIdentity, getBrandIdentityAsync } from '../config/brand';
import { treatmentCatalogService, ClinicServiceItem, TreatmentCategoryType } from './treatment-catalog.service';

export type PricelistVariantTuple = [age: number | string, promo: number, orig: number];

export interface PricelistItem {
  /** id layanan katalog (primary/base) */
  id: string;
  /** nama tampil (prefix brand/kategori dibersihkan) */
  n: string;
  /** deskripsi singkat (opsional) */
  d?: string;
  /** durasi menit (maksimum antar varian) */
  t: number;
  /** kata kunci pencarian deterministik (lowercase, unik) */
  k: string;
  /** varian usia: [labelSasaran, hargaPromo, hargaNormal] */
  v: PricelistVariantTuple[];
}

export interface PricelistSection {
  id: string;
  tab: string;
  icon: string;
  title: string;
  meta: string;
  note: string;
  items: PricelistItem[];
}

export interface PricelistPayload {
  tenantId: string;
  slug: string;
  brand: BrandIdentity;
  whatsapp_number: string;
  sections: PricelistSection[];
}

/**
 * Metadata chrome per kategori katalog. `stripWords` = kata kategori yang ikut
 * dibersihkan dari nama tampil (chrome kategori, bukan data bisnis layanan).
 */
const SECTION_META: Record<string, { id: string; icon: string; label: string; meta: string; note: string; stripWords: string[] }> = {
  BABY: {
    id: 'baby',
    icon: '👶',
    label: 'Baby',
    meta: 'Usia 0–24 bulan',
    note: 'Ketuk tarif usia bayi yang sesuai untuk lanjut konsultasi jadwal.',
    stripWords: ['Baby'],
  },
  KIDS: {
    id: 'kids',
    icon: '👧',
    label: 'Kids',
    meta: 'Usia 2–8 tahun',
    note: 'Seluruh terapis membawa minyak hypoallergenic & alat steril.',
    stripWords: ['Kids'],
  },
  MOMS: {
    id: 'moms',
    icon: '🤰',
    label: 'Moms',
    meta: 'Ibu hamil, bersalin & menyusui',
    note: 'Seluruh treatment dilakukan dengan posisi aman sesuai SOP kebidanan.',
    stripWords: ['Mom', 'Moms'],
  },
  BUNDLE: {
    id: 'bundle',
    icon: '🎁',
    label: 'Bundle',
    meta: 'Paket hemat & tradisi',
    note: 'Lebih hemat dibanding memesan layanan satuan.',
    stripWords: ['Bundle'],
  },
  ADD_ON: {
    id: 'addon',
    icon: '➕',
    label: 'Terapi (Add-on)',
    meta: 'Terapi penunjang',
    note: 'Paling efektif diambil bersamaan dengan paket pijat bayi atau anak.',
    stripWords: ['Terapi', 'Add-on', 'Addon'],
  },
  BOTH: {
    id: 'both',
    icon: '👨‍👩‍👧',
    label: 'Keluarga',
    meta: 'Ibu & anak',
    note: '',
    stripWords: ['Family', 'Keluarga'],
  },
};

const SECTION_ORDER: TreatmentCategoryType[] = ['BABY', 'KIDS', 'MOMS', 'BUNDLE', 'ADD_ON', 'BOTH'];

/** Token pertama businessName (mis. "Kala" dari "Kala Moms and Baby Spa"). */
export function brandPrefixOf(businessName: string | undefined | null): string {
  const first = (businessName || '').trim().split(/\s+/)[0] || '';
  return first.length >= 2 ? first : '';
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Bersihkan prefix nama layanan secara generik & deterministik:
 * 1. Buang token brand (turunan businessName) berulang di awal.
 * 2. Buang kata kategori/section (chrome) di awal.
 * 3. Buang pemisah struktural di awal ( – | - | : ).
 * 4. Bila tersisa "Kualifikasi – Nama" dan kualifikasi ≤3 kata, ambil nama inti.
 */
export function toDisplayName(rawName: string, brandPrefix: string, stripWords: string[]): string {
  let n = (rawName || '').trim();
  const prefixes = [brandPrefix, ...stripWords].filter(Boolean) as string[];

  let changed = true;
  let guard = 0;
  while (changed && guard < 12) {
    changed = false;
    guard++;
    for (const p of prefixes) {
      const re = new RegExp('^' + escapeRegExp(p) + '\\b[\\s\\-–—:]*', 'i');
      if (re.test(n)) {
        n = n.replace(re, '');
        changed = true;
      }
    }
    const sep = n.match(/^[\s\-–—:]+/);
    if (sep) {
      n = n.slice(sep[0].length);
      changed = true;
    }
  }

  const m = n.match(/^([^–—]{1,40}?)\s*[–—]\s*(.+)$/);
  if (m && m[1].trim() && m[1].trim().split(/\s+/).length <= 3) {
    n = m[2].trim();
  }

  const cleaned = n.replace(/\s+/g, ' ').trim();
  return cleaned || (rawName || '').trim();
}

/** Kata kunci pencarian deterministik dari nama + label usia + deskripsi. */
export function buildKeywords(name: string, ageLabels: string[], description: string): string {
  const text = [name, ...ageLabels, description || ''].join(' ').toLowerCase();
  const tokens = text
    .replace(/\[(bundle|addon)[^\]]*\]/gi, ' ')
    .split(/[^a-z0-9]+/g)
    .filter((w) => w.length >= 2);
  return Array.from(new Set(tokens)).join(' ');
}

interface RawVariant {
  label: string;
  promo: number;
  orig: number;
  minAge: number;
  maxAge: number | null;
  duration: number;
}

interface RawItem {
  id: string;
  baseName: string;
  rawName: string;
  description: string;
  variants: RawVariant[];
  order: number;
}

function sanitizeNumbers(promo: number, orig: number): [number, number] {
  const p = Number.isFinite(promo) ? Math.max(0, Math.round(promo)) : 0;
  const o = Number.isFinite(orig) ? Math.max(0, Math.round(orig)) : 0;
  // Harga normal tidak boleh lebih murah dari promo (cegah diskon negatif di UI).
  return [p, o < p ? p : o];
}

/**
 * Transformasi daftar layanan aktif menjadi seksi-seksi UI.
 * Diekspor agar dapat diuji unit tanpa DB/route.
 */
export function buildSections(services: ClinicServiceItem[], brandPrefix: string): PricelistSection[] {
  const byCategory = new Map<TreatmentCategoryType, RawItem[]>();

  services.forEach((s, idx) => {
    const category = (s.category || 'BABY') as TreatmentCategoryType;
    const meta = SECTION_META[category] || SECTION_META.BABY;
    const display = toDisplayName(s.name, brandPrefix, meta.stripWords);
    const [promo, orig] = sanitizeNumbers(s.promoPrice, s.originalPrice);
    const list = byCategory.get(category) || [];
    list.push({
      id: s.id,
      baseName: display,
      rawName: s.name,
      description: (s.description || '').trim(),
      variants: [
        {
          label: (s.ageTier?.label || '').trim() || 'Umum',
          promo,
          orig,
          minAge: Number.isFinite(s.ageTier?.minAgeMonths) ? s.ageTier.minAgeMonths : 0,
          maxAge: s.ageTier?.maxAgeMonths ?? null,
          duration: Number.isFinite(s.durationMinutes) ? s.durationMinutes : 0,
        },
      ],
      order: idx,
    });
    byCategory.set(category, list);
  });

  const sections: PricelistSection[] = [];

  for (const category of SECTION_ORDER) {
    const rawList = byCategory.get(category);
    if (!rawList || rawList.length === 0) continue;
    const meta = SECTION_META[category];

    const items = mergeVariants(rawList);

    sections.push({
      id: meta.id,
      tab: `${meta.icon} ${meta.label}`,
      icon: meta.icon,
      title: brandPrefix ? `${brandPrefix} ${meta.label}` : meta.label,
      meta: meta.meta,
      note: meta.note,
      items,
    });
  }

  return sections;
}

/**
 * Gabungkan varian usia:
 * 1. Nama tampil identik → satu kartu (mis. "Pijat Ceria" 3 tingkat usia KIDS).
 * 2. Nama tampil A adalah prefix kata dari B DAN label usia B belum ada di A
 *    → gabung B ke A (mis. "Pijat Ceria" + "Pijat Ceria Newborn").
 *    Guard label-unik mencegah penggabungan layanan berbeda (mis. "Induksi
 *    Massage" vs "Induksi Massage Fullbody" yang berbagi label usia sama).
 */
function mergeVariants(rawList: RawItem[]): PricelistItem[] {
  const groups: RawItem[] = [];
  const byName = new Map<string, RawItem>();

  for (const item of rawList) {
    const key = item.baseName.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      existing.variants.push(...item.variants);
      existing.description = existing.description || item.description;
    } else {
      const clone: RawItem = { ...item, variants: [...item.variants] };
      byName.set(key, clone);
      groups.push(clone);
    }
  }

  const merged: RawItem[] = [];
  const consumed = new Set<RawItem>();
  for (const a of groups) {
    if (consumed.has(a)) continue;
    const aName = a.baseName.toLowerCase();
    for (const b of groups) {
      if (b === a || consumed.has(b)) continue;
      const bName = b.baseName.toLowerCase();
      if (!bName.startsWith(aName + ' ')) continue;
      const aLabels = new Set(a.variants.map((v) => v.label));
      const distinct = b.variants.some((v) => !aLabels.has(v.label));
      if (!distinct) continue;
      a.variants.push(...b.variants);
      a.description = a.description || b.description;
      consumed.add(b);
    }
  }

  // Filter di akhir agar urutan asli katalog terjaga (group panjang yang
  // dikonsumsi grup-prefix pendek tetap terhapus meski diproses lebih dulu).
  for (const g of groups) {
    if (!consumed.has(g)) merged.push(g);
  }

  return merged.map((item) => {
    const sorted = [...item.variants].sort((x, y) => {
      if (x.minAge !== y.minAge) return x.minAge - y.minAge;
      const xm = x.maxAge === null ? Number.MAX_SAFE_INTEGER : x.maxAge;
      const ym = y.maxAge === null ? Number.MAX_SAFE_INTEGER : y.maxAge;
      return xm - ym;
    });
    const duration = sorted.reduce((acc, v) => Math.max(acc, v.duration || 0), 0);
    const item_: PricelistItem = {
      id: item.id,
      n: item.baseName,
      t: duration,
      k: buildKeywords(item.baseName, sorted.map((v) => v.label), item.description),
      v: sorted.map((v) => [v.label, v.promo, v.orig] as PricelistVariantTuple),
    };
    if (item.description) item_.d = item.description;
    return item_;
  });
}

/** Nomor WA: Tenant DB → fallback eksplisit (LandingPage) → env. */
async function resolveWhatsappNumber(tenantId: string, fallback?: string): Promise<string> {
  let tenantNumber = '';
  try {
    const tenant = await (prisma as any).tenant.findUnique({
      where: { id: tenantId },
      select: { whatsapp_number: true },
    });
    tenantNumber = (tenant?.whatsapp_number || '').trim();
  } catch {
    tenantNumber = '';
  }
  return tenantNumber || (fallback || '').trim() || process.env.DEFAULT_WHATSAPP_PHONE || '';
}

/**
 * Payload pricelist lengkap & tenant-aware untuk landing page / API publik.
 */
export async function getPricelistPayload(
  tenantId: string = DEFAULT_TENANT_ID,
  opts: { slug?: string; whatsappFallback?: string } = {}
): Promise<PricelistPayload> {
  let services: ClinicServiceItem[] = [];
  try {
    services = treatmentCatalogService.getAllServices(true, tenantId) || [];
  } catch {
    services = [];
  }

  const brand = await getBrandIdentityAsync(tenantId);
  const whatsapp_number = await resolveWhatsappNumber(tenantId, opts.whatsappFallback);
  const brandPrefix = brandPrefixOf(brand.businessName);

  return {
    tenantId,
    slug: opts.slug || 'default',
    brand,
    whatsapp_number,
    sections: buildSections(services, brandPrefix),
  };
}

/**
 * Serialisasi aman untuk injeksi ke dalam tag <script type="application/json">.
 * Escape `<`, `>`, `&`, U+2028, U+2029 → cegah breakout `</script>` (XSS) bila
 * deskripsi/nama layanan dari DB mengandung markup.
 */
export function serializePayloadForHtml(payload: PricelistPayload): string {
  return JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
