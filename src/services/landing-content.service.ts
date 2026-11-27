import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getBrandIdentity } from '../config/brand';

export interface LandingContent {  tenant_id: string;
  slug: string;
  title: string;
  landing_type: string;
  raw_html_content: string | null;
  events: string[];
  clinic_name: string;
  headline: string;
  subheadline: string;
  benefits: string[];
  faq: { question: string; answer: string }[];
  whatsapp_number: string;
  meta_pixel_id: string;
}

export interface PublicTenantDto {
  slug: string;
  title: string;
  structured_content: {
    clinic_name: string;
    headline: string;
    subheadline: string;
    benefits: string[];
  };
  brand: { name: string; logoUrl: string };
  whatsapp_number: string;
  faq: { question: string; answer: string }[];
}

/**
 * DTO publik: hanya field yang memang untuk pengunjung. HTML pra-sanitasi,
 * tenant_id, dan meta_pixel_id tidak boleh keluar dari endpoint anonim.
 */
export function toPublicTenantDto(content: LandingContent): PublicTenantDto {
  return {
    slug: content.slug,
    title: content.title,
    structured_content: {
      clinic_name: content.clinic_name,
      headline: content.headline,
      subheadline: content.subheadline,
      benefits: content.benefits,
    },
    brand: { name: content.clinic_name, logoUrl: '/admin/pwa-512x512.png' },
    whatsapp_number: String(content.whatsapp_number || '').replace(/\D/g, ''),
    faq: content.faq,
  };
}

const FALLBACK_HEADLINE = 'Solusi Pijat & Perawatan Bayi Profesional di Rumah Anda';
const FALLBACK_SUBHEADLINE = 'Bidan bersertifikasi resmi datang langsung ke lokasi Anda. Bebas macet, nyaman, & steril.';
const FALLBACK_BENEFITS = [
  'Terapis Bidan Terlatih & Certified Spa Specialist',
  'Peralatan Steril & Hygienic Standard Rumah Sakit',
  'Gratis Ongkir Layanan Home-Treatment hingga 5 km',
  'Bebas Pilih Jadwal Fleksibel Sesuai Kenyamanan Bunda',
];
const FALLBACK_FAQ = [
  {
    question: 'Bagaimana cara memesan layanan home-treatment?',
    answer: 'Cukup klik tombol "Chat via WhatsApp" di bawah ini. Customer Service kami akan langsung membantu menentukan lokasi & jadwal kunjungan.',
  },
  {
    question: 'Berapa jarak jangkauan layanan klinik?',
    answer: 'Kami melayani area home-treatment hingga jarak 30 km dari lokasi spa kami dengan ongkir terjangkau.',
  },
  {
    question: 'Apakah peralatan pijat bayi higienis?',
    answer: 'Ya, seluruh peralatan, minyak pijat alami, dan handuk disterilisasi sebelum dan sesudah setiap sesi perawatan.',
  },
];

export function defaultLandingContent(slug: string): LandingContent {
  return {
    tenant_id: DEFAULT_TENANT_ID,
    slug: slug || 'default',
    title: '',
    landing_type: 'STRUCTURED_JSON',
    raw_html_content: null,
    events: [],
    clinic_name: getBrandIdentity().businessName,
    headline: FALLBACK_HEADLINE,
    subheadline: FALLBACK_SUBHEADLINE,
    benefits: FALLBACK_BENEFITS,
    faq: FALLBACK_FAQ,
    whatsapp_number: process.env.DEFAULT_WHATSAPP_PHONE || '',
    // default-tenant boleh fallback env; dummy ID dihapus (isolasi multi-tenant).
    meta_pixel_id: process.env.FB_PIXEL_ID || '',
  };
}

// Konten landing di-resolve langsung dari DB setiap request (in-process, tanpa HTTP round-trip).
// Purge disediakan sebagai no-op yang siap dipakai bila cache ditambahkan di kemudian hari.
export function purgeLandingContentCache(_slug?: string): void {
  // no-op
}

/**
 * Kontak tenant default — sumber kebenaran terakhir untuk `/cta`.
 *
 * RC-CTA-01 (2026-11-15): link CTA iklan pernah kehilangan nomor tujuan
 * (`https://wa.me/?text=...`) karena `resolveLandingContent('default')` tidak
 * menemukan tenant (slug riil = `default-tenant`) sehingga jatuh ke konten
 * contoh/dev yang nomornya diambil dari env `DEFAULT_WHATSAPP_PHONE` (kosong).
 * Helper ini memastikan nomor & pixel selalu bisa diambil dari DB tenant.
 */
export interface TenantContactInfo {
  whatsapp_number: string;
  meta_pixel_id: string;
  greetings_text: string;
}

export async function resolveDefaultTenantContact(): Promise<TenantContactInfo> {
  try {
    const tenant: any = await prisma.tenant.findFirst({
      where: { OR: [{ id: DEFAULT_TENANT_ID }, { slug: DEFAULT_TENANT_ID }] },
      select: { whatsapp_number: true, meta_pixel_id: true, greetings_text: true, format_visit: true },
    });
    return {
      whatsapp_number: String(tenant?.whatsapp_number || '').trim(),
      meta_pixel_id: String(tenant?.meta_pixel_id || '').trim(),
      greetings_text: String(tenant?.greetings_text || tenant?.format_visit || '').trim(),
    };
  } catch {
    // DB offline / unit test: biarkan kosong, caller punya fallback env.
    return { whatsapp_number: '', meta_pixel_id: '', greetings_text: '' };
  }
}

export async function resolveLandingContent(
  slug: string,
  tenantId?: string | null
): Promise<LandingContent | null> {
  const normalized = (slug || '').toLowerCase();
  const scopedTenantId = typeof tenantId === 'string' && tenantId.trim() ? tenantId.trim() : null;

  let landing: any = null;
  try {
    landing = await prisma.landingPage.findFirst({
      where: {
        slug: normalized,
        is_active: true,
        ...(scopedTenantId ? { tenant_id: scopedTenantId } : {}),
      },
    });
  } catch (err: any) {
    console.warn(`[LANDING SLUG RESOLVE] LandingPage lookup gagal: ${err.message}`);
  }

  if (landing) {
    let tenantForLanding: any = null;
    try {
      tenantForLanding = await prisma.tenant.findUnique({
        where: { id: landing.tenant_id },
        select: { name: true, whatsapp_number: true, meta_pixel_id: true },
      });
    } catch (err: any) {
      console.warn(`[LANDING SLUG RESOLVE] Tenant fallback lookup gagal: ${err.message}`);
    }

    const landingJson = (landing.structured_content as any) || {};
    // Isolasi multi-tenant: env FB_PIXEL_ID HANYA untuk default-tenant; tenant lain
    // tanpa pixel DB mendapat '' (render tanpa pixel, bukan pinjam milik owner).
    const landingTenantId = landing.tenant_id || DEFAULT_TENANT_ID;

    return {
      tenant_id: landingTenantId,
      slug: landing.slug,
      title: landing.title || '',
      landing_type: landing.landing_type || 'RAW_HTML',
      raw_html_content: landing.html_content || null,
      events: landing.events || [],
      clinic_name: tenantForLanding?.name || landing.title || getBrandIdentity().businessName,
      headline: landingJson.headline || FALLBACK_HEADLINE,
      subheadline: landingJson.subheadline || FALLBACK_SUBHEADLINE,
      benefits: landingJson.benefits || FALLBACK_BENEFITS,
      faq: landingJson.faq || FALLBACK_FAQ,
      whatsapp_number:
        landing.whatsapp_number ||
        tenantForLanding?.whatsapp_number ||
        (landingTenantId === DEFAULT_TENANT_ID ? process.env.DEFAULT_WHATSAPP_PHONE || '' : ''),
      meta_pixel_id:
        landing.meta_pixel_id ||
        tenantForLanding?.meta_pixel_id ||
        (landingTenantId === DEFAULT_TENANT_ID ? process.env.FB_PIXEL_ID || '' : ''),
    };
  }

  let tenant: any = null;
  try {
    tenant = await prisma.tenant.findFirst({
      where: scopedTenantId ? { id: scopedTenantId } : { OR: [{ slug: normalized }, { id: normalized }] },
      select: {
        id: true,
        slug: true,
        name: true,
        whatsapp_number: true,
        meta_pixel_id: true,
        landing_type: true,
        landing_content: true,
        raw_html_content: true,
      },
    });

    if (!tenant) {
      // M-05: JANGAN fallback ke tenant pertama — slug tak dikenal harus 404,
      // bukan menyajikan landing milik tenant lain.
      return null;
    }
  } catch (err: any) {
    console.warn(`[LANDING SLUG RESOLVE] Tenant legacy lookup gagal: ${err.message}`);
  }

  if (tenant) {
    const landingJson = (tenant.landing_content as any) || {};
    const legacyTenantId = tenant.id || DEFAULT_TENANT_ID;
    return {
      tenant_id: legacyTenantId,
      slug: tenant.slug || normalized || 'default',
      title: tenant.name || '',
      landing_type: tenant.landing_type || 'STRUCTURED_JSON',
      raw_html_content: tenant.raw_html_content || null,
      events: [],
      clinic_name: tenant.name || landingJson.clinic_name || getBrandIdentity().businessName,
      headline: landingJson.headline || FALLBACK_HEADLINE,
      subheadline: landingJson.subheadline || FALLBACK_SUBHEADLINE,
      benefits: landingJson.benefits || FALLBACK_BENEFITS,
      faq: landingJson.faq || FALLBACK_FAQ,
      whatsapp_number:
        tenant.whatsapp_number ||
        landingJson.whatsapp_number ||
        (legacyTenantId === DEFAULT_TENANT_ID ? process.env.DEFAULT_WHATSAPP_PHONE || '' : ''),
      meta_pixel_id:
        tenant.meta_pixel_id ||
        landingJson.meta_pixel_id ||
        (legacyTenantId === DEFAULT_TENANT_ID ? process.env.FB_PIXEL_ID || '' : ''),
    };
  }

  return null;
}
