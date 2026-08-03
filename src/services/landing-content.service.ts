import { prisma } from '../db/client';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getBrandIdentity } from '../config/brand';

export interface LandingContent {
  tenant_id: string;
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
    meta_pixel_id: process.env.FB_PIXEL_ID || '123456789012345',
  };
}

// Konten landing di-resolve langsung dari DB setiap request (in-process, tanpa HTTP round-trip).
// Purge disediakan sebagai no-op yang siap dipakai bila cache ditambahkan di kemudian hari.
export function purgeLandingContentCache(_slug?: string): void {
  // no-op
}

export async function resolveLandingContent(slug: string): Promise<LandingContent | null> {
  const normalized = (slug || '').toLowerCase();

  let landing: any = null;
  try {
    landing = await prisma.landingPage.findFirst({
      where: { slug: normalized, is_active: true },
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

    return {
      tenant_id: landing.tenant_id || DEFAULT_TENANT_ID,
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
      whatsapp_number: landing.whatsapp_number || tenantForLanding?.whatsapp_number || process.env.DEFAULT_WHATSAPP_PHONE || '',
      meta_pixel_id: landing.meta_pixel_id || tenantForLanding?.meta_pixel_id || process.env.FB_PIXEL_ID || '123456789012345',
    };
  }

  let tenant: any = null;
  try {
    tenant = await prisma.tenant.findFirst({
      where: { OR: [{ slug: normalized }, { id: normalized }] },
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
  } catch (err: any) {
    console.warn(`[LANDING SLUG RESOLVE] Tenant legacy lookup gagal: ${err.message}`);
  }

  if (tenant) {
    const landingJson = (tenant.landing_content as any) || {};
    return {
      tenant_id: tenant.id || DEFAULT_TENANT_ID,
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
      whatsapp_number: tenant.whatsapp_number || landingJson.whatsapp_number || process.env.DEFAULT_WHATSAPP_PHONE || '',
      meta_pixel_id: tenant.meta_pixel_id || landingJson.meta_pixel_id || process.env.FB_PIXEL_ID || '123456789012345',
    };
  }

  return null;
}
