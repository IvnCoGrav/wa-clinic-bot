import fs from 'fs';
import path from 'path';
import { parseAgeTextToMonths } from '../utils/age-calculator';
import { checkMedicalKeywords } from '../config/medical-keywords';

export type TreatmentCategoryType = 'BABY' | 'KIDS' | 'MOMS' | 'BOTH' | 'BUNDLE' | 'ADD_ON';

export type ClinicServiceType = 'STANDARD' | 'BUNDLE' | 'ADD_ON';

export interface AgeTier {
  minAgeMonths: number;        // Batas minimal usia (dalam bulan), misal 0
  maxAgeMonths: number | null; // Batas maksimal usia (dalam bulan), null jika tidak ada batas (misal > 24 bulan atau dewasa)
  label: string;               // Label deskriptif kelompok usia (misal: "0 - 6 Bulan", "> 24 Bulan", "Ibu Hamil / Nifas")
}

export interface ClinicServiceItem {
  id: string;                  // Identifier unik treatment, misal: "baby-massage-0-6"
  name: string;                // Nama layanan/treatment
  category: TreatmentCategoryType;
  serviceType?: ClinicServiceType; // STANDARD | BUNDLE | ADD_ON
  bundleItemIds?: string[];    // Daftar ID layanan eksisting yang digabungkan (minimal 2 untuk bundle)
  isAddon?: boolean;           // Menandakan bahwa layanan ini add-on (tidak bisa berdiri sendiri)
  ageTier: AgeTier;
  durationMinutes: number;     // Durasi pengerjaan treatment (dalam menit)
  originalPrice: number;       // Harga Asli (Rp)
  promoPrice: number;          // Harga Promo / Khusus (Rp)
  description: string;         // Deskripsi detail & manfaat treatment
  isActive: boolean;           // Status keaktifan layanan
}

const SERVICES_FILE = path.join(process.cwd(), 'services_custom.json');

const serviceCatalog: Map<string, ClinicServiceItem> = new Map();

// Default data catalog
export const DEFAULT_CLINIC_SERVICES: ClinicServiceItem[] = [
  {
    id: 'baby-massage-ceria',
    name: 'Pijat Bayi Ceria (Rileksasi)',
    category: 'BABY',
    serviceType: 'STANDARD',
    ageTier: { minAgeMonths: 0, maxAgeMonths: 24, label: '0 - 24 Bulan' },
    durationMinutes: 40,
    originalPrice: 80000,
    promoPrice: 60000,
    description: 'Pijat relaksasi untuk membantu bayi tidur lebih nyenyak, mengurangi kelelahan, dan membuat tubuh bayi lebih rileks.',
    isActive: true,
  },
  {
    id: 'baby-massage-pulih-ceria',
    name: 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)',
    category: 'BABY',
    serviceType: 'STANDARD',
    ageTier: { minAgeMonths: 0.5, maxAgeMonths: 24, label: 'Minimal 2 Minggu (0.5 - 24 Bulan)' },
    durationMinutes: 40,
    originalPrice: 90000,
    promoPrice: 70000,
    description: 'Pijat terapi minimal usia 2 minggu khusus bayi flu, batuk, pilek, rewel, susah BAB, kembung atau kolik dengan menggunakan double aromaterapi.',
    isActive: true,
  },
  {
    id: 'baby-massage-lahap-juara',
    name: 'Pijat Lahap Juara (Nafsu Makan)',
    category: 'BABY',
    serviceType: 'STANDARD',
    ageTier: { minAgeMonths: 0, maxAgeMonths: 24, label: '0 - 24 Bulan' },
    durationMinutes: 40,
    originalPrice: 95000,
    promoPrice: 75000,
    description: 'Pijat khusus untuk membantu meningkatkan nafsu makan si kecil dan menjaga kebugaran tubuh.',
    isActive: true,
  },
  {
    id: 'baby-cukur',
    name: 'Cukur Rambut Bayi',
    category: 'BABY',
    serviceType: 'STANDARD',
    ageTier: { minAgeMonths: 0, maxAgeMonths: 12, label: 'Bayi 0 - 12 Bulan' },
    durationMinutes: 15,
    originalPrice: 30000,
    promoPrice: 25000,
    description: 'Layanan mencukur rambut bayi dengan alat steril / milik customer sendiri secara bersih.',
    isActive: true,
  },
  {
    id: 'baby-tindik',
    name: 'Tindik Telinga Bayi',
    category: 'BABY',
    serviceType: 'STANDARD',
    ageTier: { minAgeMonths: 0, maxAgeMonths: 12, label: 'Bayi 0 - 12 Bulan' },
    durationMinutes: 15,
    originalPrice: 70000,
    promoPrice: 50000,
    description: 'Layanan tindik telinga bayi secara manual menggunakan anting steril langsung secara aman.',
    isActive: true,
  },
  {
    id: 'kids-massage-2-4th',
    name: 'Pijat Kids Ceria (Usia 2-4 th)',
    category: 'KIDS',
    serviceType: 'STANDARD',
    ageTier: { minAgeMonths: 24, maxAgeMonths: 48, label: '2 - 4 Tahun' },
    durationMinutes: 45,
    originalPrice: 90000,
    promoPrice: 70000,
    description: 'Pijat relaksasi tubuh anak usia 2 hingga 4 tahun untuk meredakan kelelahan dan mendukung kenyamanan tumbuh kembang.',
    isActive: true,
  },
  {
    id: 'kids-massage-4-6th',
    name: 'Pijat Kids Ceria (Usia >4-6 th)',
    category: 'KIDS',
    serviceType: 'STANDARD',
    ageTier: { minAgeMonths: 48, maxAgeMonths: 72, label: '4 - 6 Tahun' },
    durationMinutes: 45,
    originalPrice: 100000,
    promoPrice: 80000,
    description: 'Pijat relaksasi tubuh anak usia di atas 4 hingga 6 tahun untuk meredakan kelelahan setelah beraktivitas aktif.',
    isActive: true,
  },
  {
    id: 'kids-massage-6-8th',
    name: 'Pijat Kids Ceria (Usia >6-8 th)',
    category: 'KIDS',
    serviceType: 'STANDARD',
    ageTier: { minAgeMonths: 72, maxAgeMonths: 96, label: '6 - 8 Tahun' },
    durationMinutes: 45,
    originalPrice: 110000,
    promoPrice: 90000,
    description: 'Pijat relaksasi tubuh anak usia 6 sampai 8 tahun untuk mendukung pertumbuhan tulang dan otot yang sehat.',
    isActive: true,
  },
  {
    id: 'kids-massage-ceria',
    name: 'Pijat Kids Ceria',
    category: 'KIDS',
    serviceType: 'STANDARD',
    ageTier: { minAgeMonths: 24, maxAgeMonths: 96, label: '2 - 8 Tahun' },
    durationMinutes: 45,
    originalPrice: 110000,
    promoPrice: 90000,
    description: 'Pijat relaksasi tubuh anak untuk mendukung pertumbuhan tulang dan otot yang sehat serta meredakan kelelahan setelah beraktivitas.',
    isActive: true,
  },
  {
    id: 'moms-prenatal-massage',
    name: 'Prenatal Massage (Pijat Hamil)',
    category: 'MOMS',
    serviceType: 'STANDARD',
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Hamil (Trimester 2 & 3)' },
    durationMinutes: 60,
    originalPrice: 125000,
    promoPrice: 100000,
    description: 'Pijat aman khusus ibu hamil usia kandungan di atas 12 minggu untuk meredakan pegal di punggung, pinggang, kaki bengkak, serta mengurangi stres.',
    isActive: true,
  },
  {
    id: 'moms-paket-laktasi',
    name: 'Paket Laktasi (Breast Massage)',
    category: 'MOMS',
    serviceType: 'STANDARD',
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Menyusui' },
    durationMinutes: 40,
    originalPrice: 70000,
    promoPrice: 50000,
    description: 'Pijat area payudara untuk memperlancar sumbatan ASI dan meningkatkan produksi ASI secara optimal.',
    isActive: true,
  },
  {
    id: 'moms-oksitosin-partial',
    name: 'Oksitosin Massage Non-Fullbody',
    category: 'MOMS',
    serviceType: 'STANDARD',
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Menyusui' },
    durationMinutes: 40,
    originalPrice: 70000,
    promoPrice: 50000,
    description: 'Pijat punggung parsial untuk merangsang produksi ASI.',
    isActive: true,
  },
  {
    id: 'moms-oksitosin-fullbody',
    name: 'Oksitosin Massage Fullbody',
    category: 'MOMS',
    serviceType: 'STANDARD',
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Pasca Melahirkan / Nifas' },
    durationMinutes: 60,
    originalPrice: 130000,
    promoPrice: 105000,
    description: 'Pijat punggung dan leher fullbody untuk membantu merangsang hormon oksitosin sehingga produksi ASI lebih lancar dan badan ibu lebih rileks.',
    isActive: true,
  },
  {
    id: 'moms-perineum-massage',
    name: 'Perineum Massage',
    category: 'MOMS',
    serviceType: 'STANDARD',
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Hamil Trimester 3' },
    durationMinutes: 30,
    originalPrice: 60000,
    promoPrice: 45000,
    description: 'Pijat area perineum khusus ibu hamil trimester 3 untuk meningkatkan elastisitas otot dan membantu kelancaran persalinan normal.',
    isActive: true,
  },
  {
    id: 'moms-induksi-massage',
    name: 'Induksi Massage',
    category: 'MOMS',
    serviceType: 'STANDARD',
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Hamil Aterm (37+ Minggu)' },
    durationMinutes: 40,
    originalPrice: 70000,
    promoPrice: 50000,
    description: 'Pijat stimulasi titik akupresur khusus untuk membantu merangsang kontraksi dan proses induksi alami persalinan pada usia kehamilan aterm.',
    isActive: true,
  },
  {
    id: 'moms-induksi-fullbody',
    name: 'Induksi Massage Fullbody',
    category: 'MOMS',
    serviceType: 'STANDARD',
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Hamil Aterm (37+ Minggu)' },
    durationMinutes: 60,
    originalPrice: 130000,
    promoPrice: 105000,
    description: 'Pijat relaksasi seluruh tubuh dipadukan dengan titik stimulasi induksi alami untuk ibu hamil menjelang HPL.',
    isActive: true,
  },
  {
    id: 'moms-prenatal-yoga',
    name: 'Prenatal Yoga',
    category: 'MOMS',
    serviceType: 'STANDARD',
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Hamil (Trimester 2 & 3)' },
    durationMinutes: 45,
    originalPrice: 70000,
    promoPrice: 50000,
    description: 'Sesi latihan pernapasan, postur, dan peregangan yoga hamil dipandu bidan bersertifikasi untuk mempersiapkan fisik dan mental persalinan.',
    isActive: true,
  },
  {
    id: 'add-on-sinar-moksa',
    name: 'Sinar Moksa (Add-on)',
    category: 'ADD_ON',
    serviceType: 'ADD_ON',
    isAddon: true,
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Semua Usia' },
    durationMinutes: 15,
    originalPrice: 15000,
    promoPrice: 10000,
    description: '[ADDON] Terapi tambahan sinar inframerah (moksa) hangat untuk membantu mengencerkan dahak, lendir ingus, dan melegakan pernapasan.',
    isActive: true,
  },
  {
    id: 'add-on-nebulizer',
    name: 'Nebulizer (Terapi Uap Add-on)',
    category: 'ADD_ON',
    serviceType: 'ADD_ON',
    isAddon: true,
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Semua Usia' },
    durationMinutes: 20,
    originalPrice: 50000,
    promoPrice: 35000,
    description: '[ADDON] Terapi uap nebulizer tambahan untuk melegakan tenggorokan dan mengencerkan dahak.',
    isActive: true,
  },
  {
    id: 'add-on-nebulizer-obat',
    name: 'Nebulizer + Obat (Terapi Uap Lengkap)',
    category: 'ADD_ON',
    serviceType: 'ADD_ON',
    isAddon: true,
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Semua Usia' },
    durationMinutes: 20,
    originalPrice: 85000,
    promoPrice: 65000,
    description: '[ADDON] Terapi uap nebulizer lengkap dengan obat khusus untuk meredakan batuk pilek dan sesak napas.',
    isActive: true,
  },
  {
    id: 'baby-cukur-pijat-terapi',
    name: 'Cukur + Pijat Terapi',
    category: 'BUNDLE',
    serviceType: 'BUNDLE',
    bundleItemIds: ['baby-cukur', 'baby-massage-pulih-ceria'],
    ageTier: { minAgeMonths: 0, maxAgeMonths: 12, label: 'Bayi 0 - 12 Bulan' },
    durationMinutes: 55,
    originalPrice: 95000,
    promoPrice: 85000,
    description: '[BUNDLE:baby-cukur,baby-massage-pulih-ceria] Paket hemat kombinasi cukur rambut bayi dan pijat terapi bayi.',
    isActive: true,
  },
  {
    id: 'baby-paket-selapan',
    name: 'Paket Selapan (Cukur + Pijat Ceria)',
    category: 'BUNDLE',
    serviceType: 'BUNDLE',
    bundleItemIds: ['baby-cukur', 'baby-massage-ceria'],
    ageTier: { minAgeMonths: 0, maxAgeMonths: 2, label: 'Newborn (0 - 40 Hari)' },
    durationMinutes: 55,
    originalPrice: 85000,
    promoPrice: 80000,
    description: '[BUNDLE:baby-cukur,baby-massage-ceria] Pijat khusus bayi baru lahir (newborn) usia 0-40 hari dikombinasikan dengan cukur rambut bayi.',
    isActive: true,
  },
  {
    id: 'bundle-laktasi-oksitosin',
    name: 'Paket Laktasi (Breast + Oksitosin)',
    category: 'BUNDLE',
    serviceType: 'BUNDLE',
    bundleItemIds: ['moms-paket-laktasi', 'moms-oksitosin-partial'],
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Menyusui' },
    durationMinutes: 75,
    originalPrice: 100000,
    promoPrice: 80000,
    description: '[BUNDLE:moms-paket-laktasi,moms-oksitosin-partial] Paket hemat kombinasi pijat payudara (laktasi) dan pijat oksitosin untuk melancarkan ASI.',
    isActive: true,
  },
  {
    id: 'bundle-pra-kelahiran-lengkap',
    name: 'Paket Pra Kelahiran Lengkap (Perineum + Yoga + Breast)',
    category: 'BUNDLE',
    serviceType: 'BUNDLE',
    bundleItemIds: ['moms-perineum-massage', 'moms-prenatal-yoga', 'moms-paket-laktasi'],
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Hamil Trimester 3' },
    durationMinutes: 105,
    originalPrice: 185000,
    promoPrice: 135000,
    description: '[BUNDLE:moms-perineum-massage,moms-prenatal-yoga,moms-paket-laktasi] Paket persiapan persalinan lengkap mencakup pijat perineum, prenatal yoga, dan pijat laktasi.',
    isActive: true,
  },
  {
    id: 'bundle-yoga-breast',
    name: 'Paket Pra Kelahiran (Yoga + Breast)',
    category: 'BUNDLE',
    serviceType: 'BUNDLE',
    bundleItemIds: ['moms-prenatal-yoga', 'moms-paket-laktasi'],
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Hamil Trimester 3' },
    durationMinutes: 80,
    originalPrice: 100000,
    promoPrice: 80000,
    description: '[BUNDLE:moms-prenatal-yoga,moms-paket-laktasi] Kombinasi relaksasi yoga hamil dan stimulasi laktasi persiapan menyusui.',
    isActive: true,
  },
  {
    id: 'bundle-perineum-yoga',
    name: 'Paket Pra Kelahiran (Perineum + Yoga)',
    category: 'BUNDLE',
    serviceType: 'BUNDLE',
    bundleItemIds: ['moms-perineum-massage', 'moms-prenatal-yoga'],
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Hamil Trimester 3' },
    durationMinutes: 75,
    originalPrice: 95000,
    promoPrice: 80000,
    description: '[BUNDLE:moms-perineum-massage,moms-prenatal-yoga] Kombinasi peregangan panggul yoga hamil dan pemijatan elastisitas perineum.',
    isActive: true,
  },
  {
    id: 'bundle-perineum-breast',
    name: 'Paket Pra Kelahiran (Perineum + Breast)',
    category: 'BUNDLE',
    serviceType: 'BUNDLE',
    bundleItemIds: ['moms-perineum-massage', 'moms-paket-laktasi'],
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Hamil Trimester 3' },
    durationMinutes: 70,
    originalPrice: 95000,
    promoPrice: 80000,
    description: '[BUNDLE:moms-perineum-massage,moms-paket-laktasi] Perawatan persiapan persalinan untuk melenturkan perineum dan merangsang produksi ASI.',
    isActive: true,
  },
  {
    id: 'moms-laktasi-oksitosin-full',
    name: 'Breast + Oksitoksin Fullbody Massage',
    category: 'BUNDLE',
    serviceType: 'BUNDLE',
    bundleItemIds: ['moms-paket-laktasi', 'moms-oksitosin-fullbody'],
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Menyusui / Nifas' },
    durationMinutes: 75,
    originalPrice: 200000,
    promoPrice: 155000,
    description: '[BUNDLE:moms-paket-laktasi,moms-oksitosin-fullbody] Paket hemat kombinasi pijat laktasi (payudara) dan oksitosin massage fullbody untuk relaksasi maksimal dan kelancaran ASI.',
    isActive: true,
  }
];

// Inisialisasi map katalog
export function loadServices() {
  try {
    if (fs.existsSync(SERVICES_FILE)) {
      const data = fs.readFileSync(SERVICES_FILE, 'utf-8');
      const list: ClinicServiceItem[] = JSON.parse(data);
      serviceCatalog.clear();
      list.forEach((item) => serviceCatalog.set(item.id, item));
    } else {
      fs.writeFileSync(SERVICES_FILE, JSON.stringify(DEFAULT_CLINIC_SERVICES, null, 2));
      serviceCatalog.clear();
      DEFAULT_CLINIC_SERVICES.forEach((item) => serviceCatalog.set(item.id, item));
    }
  } catch (err) {
    console.error('Failed to load clinic services from file:', err);
    serviceCatalog.clear();
    DEFAULT_CLINIC_SERVICES.forEach((item) => serviceCatalog.set(item.id, item));
  }
}

export function saveServices() {
  try {
    const list = Array.from(serviceCatalog.values());
    fs.writeFileSync(SERVICES_FILE, JSON.stringify(list, null, 2));
    return true;
  } catch (err) {
    console.error('Failed to save clinic services to file:', err);
    return false;
  }
}

/**
 * Load services dari database per tenant (SaaS-ready).
 * Sumber kebenaran: tabel clinic_services. Fallback: file services_custom.json.
 */
export async function loadServicesFromDb(tenantId: string): Promise<void> {
  try {
    const { prisma } = await import('../db/client');
    const dbServices = await prisma.clinicService.findMany({
      where: { tenant_id: tenantId },
      orderBy: { sort_order: 'asc' },
    });

    if (dbServices.length > 0) {
      serviceCatalog.clear();
      dbServices.forEach((s) => {
        let bundleItemIds: string[] | undefined = undefined;
        let isAddon = s.category === 'ADD_ON';
        let desc = s.description;

        // Parse meta tags from description if present
        const bundleMatch = desc.match(/\[BUNDLE:([^\]]+)\]/);
        if (bundleMatch) {
          bundleItemIds = bundleMatch[1].split(',').map((id) => id.trim()).filter(Boolean);
          desc = desc.replace(/\[BUNDLE:[^\]]+\]\s*/g, '').trim();
        }

        if (desc.includes('[ADDON]')) {
          isAddon = true;
          desc = desc.replace(/\[ADDON\]\s*/g, '').trim();
        }

        const cat = s.category as TreatmentCategoryType;
        const sType: ClinicServiceType = 
          cat === 'BUNDLE' || (bundleItemIds && bundleItemIds.length >= 2) ? 'BUNDLE' :
          cat === 'ADD_ON' || isAddon ? 'ADD_ON' : 'STANDARD';

        serviceCatalog.set(s.service_id, {
          id: s.service_id,
          name: s.name,
          category: cat,
          serviceType: sType,
          bundleItemIds,
          isAddon: sType === 'ADD_ON' || isAddon,
          ageTier: {
            minAgeMonths: s.min_age_months,
            maxAgeMonths: s.max_age_months,
            label: s.age_label,
          },
          durationMinutes: s.duration_minutes,
          originalPrice: s.original_price,
          promoPrice: s.promo_price,
          description: desc,
          isActive: s.is_active,
        });
      });
      return;
    }

    // Tidak ada data di DB -> seed dari file/default lalu simpan
    const source = Array.from(serviceCatalog.values());
    if (source.length === 0) {
      console.warn(`[SEED] Catalog treatment kosong untuk tenant ${tenantId}; seeding dari DEFAULT_CLINIC_SERVICES (code default, ${DEFAULT_CLINIC_SERVICES.length} layanan). Set harga/layanan via admin API / DB untuk produksi.`);
      DEFAULT_CLINIC_SERVICES.forEach((item) => serviceCatalog.set(item.id, item));
    }
    await saveServicesToDb(tenantId);
  } catch (err) {
    console.warn('[TREATMENT CATALOG] DB unavailable, using file/default:', (err as Error).message);
  }
}

/**
 * Simpan services ke database per tenant (SaaS-ready).
 * Juga update file services_custom.json (legacy compat).
 */
export async function saveServicesToDb(tenantId: string): Promise<boolean> {
  try {
    const { prisma } = await import('../db/client');
    const list = Array.from(serviceCatalog.values());

    await prisma.clinicService.deleteMany({ where: { tenant_id: tenantId } });
    await prisma.clinicService.createMany({
      data: list.map((s, idx) => {
        let metaDesc = s.description;
        if (s.bundleItemIds && s.bundleItemIds.length > 0 && !metaDesc.includes('[BUNDLE:')) {
          metaDesc = `[BUNDLE:${s.bundleItemIds.join(',')}] ${metaDesc}`;
        }
        if (s.isAddon && !metaDesc.includes('[ADDON]')) {
          metaDesc = `[ADDON] ${metaDesc}`;
        }

        return {
          tenant_id: tenantId,
          service_id: s.id,
          name: s.name,
          category: s.category,
          min_age_months: s.ageTier.minAgeMonths,
          max_age_months: s.ageTier.maxAgeMonths,
          age_label: s.ageTier.label,
          duration_minutes: s.durationMinutes,
          original_price: s.originalPrice,
          promo_price: s.promoPrice,
          description: metaDesc,
          is_active: s.isActive,
          sort_order: idx,
        };
      }),
    });

    // Legacy compat
    saveServices();
    return true;
  } catch (err) {
    console.error('[TREATMENT CATALOG] Failed to save to DB:', (err as Error).message);
    return saveServices();
  }
}

// Initial load
loadServices();

export class TreatmentCatalogService {
  /**
   * Mengambil semua daftar layanan/treatment yang aktif
   */
  public getAllServices(onlyActive = true): ClinicServiceItem[] {
    const list = Array.from(serviceCatalog.values());
    if (onlyActive) {
      return list.filter((s) => s.isActive);
    }
    return list;
  }

  /**
   * Mengambil detail layanan berdasarkan ID
   */
  public getServiceById(id: string): ClinicServiceItem | undefined {
    return serviceCatalog.get(id);
  }

  /**
   * Cek apakah sebuah layanan merupakan layanan Add-on (tidak bisa berdiri sendiri)
   */
  public isAddonService(serviceOrId: ClinicServiceItem | string): boolean {
    const s = typeof serviceOrId === 'string' ? this.getServiceById(serviceOrId) : serviceOrId;
    if (!s) {
      if (typeof serviceOrId === 'string') {
        const idLower = serviceOrId.toLowerCase();
        return (
          idLower.startsWith('add-on') ||
          idLower.startsWith('addon') ||
          idLower.includes('moksa') ||
          idLower.includes('nebulizer')
        );
      }
      return false;
    }
    if (s.isAddon === true || s.category === 'ADD_ON' || s.serviceType === 'ADD_ON') {
      return true;
    }
    const nameLower = (s.name || '').toLowerCase();
    const idLower = (s.id || '').toLowerCase();
    return (
      idLower.startsWith('add-on') ||
      idLower.startsWith('addon') ||
      nameLower.includes('(add-on)') ||
      nameLower.includes('(addon)') ||
      nameLower.includes('add-on') ||
      nameLower.includes('addon')
    );
  }

  /**
   * Cek apakah sebuah layanan merupakan Paket Bundle (gabungan 2+ layanan eksisting)
   */
  public isBundleService(serviceOrId: ClinicServiceItem | string): boolean {
    const s = typeof serviceOrId === 'string' ? this.getServiceById(serviceOrId) : serviceOrId;
    if (!s) return false;
    return (
      s.category === 'BUNDLE' ||
      s.serviceType === 'BUNDLE' ||
      (Array.isArray(s.bundleItemIds) && s.bundleItemIds.length >= 2)
    );
  }

  /**
   * Mengambil komponen layanan yang menyusun suatu bundle
   */
  public getBundleComponents(bundleOrId: ClinicServiceItem | string): ClinicServiceItem[] {
    const s = typeof bundleOrId === 'string' ? this.getServiceById(bundleOrId) : bundleOrId;
    if (!s || !Array.isArray(s.bundleItemIds) || s.bundleItemIds.length === 0) {
      return [];
    }
    return s.bundleItemIds
      .map((id) => this.getServiceById(id))
      .filter((item): item is ClinicServiceItem => item !== undefined);
  }

  /**
   * Validasi aturan bisnis Paket Bundle:
   * 1. Wajib menggabungkan minimal 2 layanan eksisting yang valid di katalog.
   * 2. Layanan penyusun tidak boleh rekursif / bundle bersarang.
   * 3. Harga Bundle (promoPrice atau originalPrice) WAJIB LEBIH MURAH dari total harga normal layanan penyusunnya.
   */
  public validateBundle(bundleData: Partial<ClinicServiceItem>): {
    valid: boolean;
    error?: string;
    calculatedOriginalPrice?: number;
    calculatedDuration?: number;
    componentNames?: string[];
  } {
    const bundleItemIds = bundleData.bundleItemIds || [];
    if (!Array.isArray(bundleItemIds) || bundleItemIds.length < 2) {
      return {
        valid: false,
        error: 'Paket Bundle wajib menggabungkan minimal 2 layanan eksisting.',
      };
    }

    // Pastikan tidak ada duplikasi ID
    const uniqueIds = Array.from(new Set(bundleItemIds));
    if (uniqueIds.length !== bundleItemIds.length) {
      return {
        valid: false,
        error: 'Layanan penyusun bundle tidak boleh duplikat.',
      };
    }

    // Periksa apakah semua komponen ada di katalog
    const components: ClinicServiceItem[] = [];
    for (const id of bundleItemIds) {
      if (bundleData.id && id === bundleData.id) {
        return {
          valid: false,
          error: 'Bundle tidak boleh mereferensikan dirinya sendiri.',
        };
      }
      const item = this.getServiceById(id);
      if (!item) {
        return {
          valid: false,
          error: `Layanan penyusun dengan ID "${id}" tidak ditemukan dalam katalog.`,
        };
      }
      if (this.isBundleService(item)) {
        return {
          valid: false,
          error: `Layanan "${item.name}" adalah sebuah bundle. Bundle tidak boleh disusun dari bundle lain.`,
        };
      }
      components.push(item);
    }

    const calculatedOriginalPrice = components.reduce((sum, c) => sum + (c.originalPrice || 0), 0);
    const calculatedDuration = components.reduce((sum, c) => sum + (c.durationMinutes || 0), 0);
    const componentNames = components.map((c) => c.name);

    // Bundle price (promoPrice jika ada, atau originalPrice) wajib lebih murah dari total calculatedOriginalPrice
    const bundleEffectivePrice = bundleData.promoPrice !== undefined ? bundleData.promoPrice : bundleData.originalPrice;

    if (bundleEffectivePrice !== undefined && bundleEffectivePrice >= calculatedOriginalPrice) {
      return {
        valid: false,
        error: `Harga Bundle (Rp ${bundleEffectivePrice.toLocaleString('id-ID')}) harus lebih murah dari total harga normal layanan penyusunnya (Rp ${calculatedOriginalPrice.toLocaleString('id-ID')}).`,
        calculatedOriginalPrice,
        calculatedDuration,
        componentNames,
      };
    }

    return {
      valid: true,
      calculatedOriginalPrice,
      calculatedDuration,
      componentNames,
    };
  }

  /**
   * Validasi aturan bisnis Layanan Add-on pada Reservasi:
   * Layanan Add-on TIDAK BISA berdiri sendiri. Reservasi wajib memiliki minimal satu layanan utama.
   */
  public validateReservationTreatments(treatmentIdsOrNames: string[]): {
    valid: boolean;
    error?: string;
  } {
    if (!treatmentIdsOrNames || treatmentIdsOrNames.length === 0) {
      return { valid: true };
    }

    let hasMainService = false;
    let hasAddonService = false;

    for (const idOrName of treatmentIdsOrNames) {
      const trimmed = idOrName.trim();
      if (!trimmed) continue;
      const s = this.getServiceById(trimmed) || 
        this.getAllServices(false).find((item) => item.name.toLowerCase() === trimmed.toLowerCase());

      const isAddon = s ? this.isAddonService(s) : this.isAddonService(trimmed);
      if (isAddon) {
        hasAddonService = true;
      } else {
        hasMainService = true;
      }
    }

    if (hasAddonService && !hasMainService) {
      return {
        valid: false,
        error: 'Layanan add-on tidak bisa berdiri sendiri. Harap sertakan minimal satu layanan utama.',
      };
    }

    return { valid: true };
  }

  /**
   * Filter layanan berdasarkan kategori ('BABY', 'KIDS', 'MOMS', 'BOTH', 'BUNDLE', 'ADD_ON')
   */
  public getServicesByCategory(category: TreatmentCategoryType): ClinicServiceItem[] {
    if (category === 'BUNDLE') {
      return this.getAllServices().filter((s) => this.isBundleService(s));
    }
    if (category === 'ADD_ON') {
      return this.getAllServices().filter((s) => this.isAddonService(s));
    }
    return this.getAllServices().filter((s) => s.category === category || s.category === 'BOTH');
  }

  /**
   * Filter layanan bayi/anak berdasarkan usia (dalam bulan).
   * @param ageInMonths Usia bayi/anak dalam bulan
   * @param onlyGeneral Jika true, hanya kembalikan treatment relaksasi/wellness umum (tanpa terapi sakit/alat medis addon)
   */
  public getServicesByAge(ageInMonths: number, onlyGeneral = false): ClinicServiceItem[] {
    return this.getAllServices().filter((s) => {
      if (s.category === 'MOMS') return false;
      const { minAgeMonths, maxAgeMonths } = s.ageTier;
      if (ageInMonths < minAgeMonths) return false;
      if (maxAgeMonths !== null && ageInMonths > maxAgeMonths) return false;

      // Jika general only (tidak ada keluhan sakit), filter out terapi flu/batuk/alat medis add-on
      if (onlyGeneral) {
        const lowerName = s.name.toLowerCase();
        const isTherapyOrAddon = lowerName.includes('terapi') || 
                                 lowerName.includes('pulih') || 
                                 lowerName.includes('nebulizer') || 
                                 lowerName.includes('moksa') ||
                                 lowerName.includes('add-on') ||
                                 lowerName.includes('tindik') ||
                                 lowerName.includes('cukur');
        if (isTherapyOrAddon) return false;
      }

      return true;
    });
  }

  /**
   * Menambahkan atau meng-update data layanan baru (sync ke DB per tenant)
   */
  public upsertService(service: ClinicServiceItem, tenantId: string = 'default-tenant'): ClinicServiceItem {
    serviceCatalog.set(service.id, service);
    saveServices();
    // Fire-and-forget sinkronisasi ke DB (SaaS-ready)
    saveServicesToDb(tenantId).catch((e) => console.warn('[TREATMENT CATALOG] upsert DB sync failed:', (e as Error).message));
    return service;
  }

  /**
   * Menghapus layanan (sync ke DB per tenant)
   */
  public deleteService(id: string, tenantId: string = 'default-tenant'): boolean {
    const deleted = serviceCatalog.delete(id);
    if (deleted) {
      saveServices();
      saveServicesToDb(tenantId).catch((e) => console.warn('[TREATMENT CATALOG] delete DB sync failed:', (e as Error).message));
    }
    return deleted;
  }

  /**
   * Format ringkasan katalog harga & promo menjadi teks bersih untuk WhatsApp / LLM
   * @param includePrice true (default) sertakan harga; false untuk konteks LLM (harga dikelola terpisah)
   */
  public formatCatalogText(includePrice = true): string {
    const services = this.getAllServices();
    return services
      .map((s) => {
        const isBundle = this.isBundleService(s);
        const isAddon = this.isAddonService(s);
        const bundleComponents = isBundle ? this.getBundleComponents(s) : [];
        const bundleInfo = bundleComponents.length > 0
          ? `  Termasuk Layanan: ${bundleComponents.map((c) => c.name).join(' + ')}\n`
          : '';
        const addonInfo = isAddon ? `  Tipe: Layanan Tambahan (Add-on - Wajib digabung layanan utama)\n` : '';

        const priceLine = includePrice
          ? `  Harga Normal: Rp${s.originalPrice.toLocaleString('id-ID')} | Promo: Rp${s.promoPrice.toLocaleString('id-ID')}\n`
          : '';
        return `• *${s.name}*${isBundle ? ' [Paket Bundle Hemat]' : isAddon ? ' [Add-on]' : ''}\n${bundleInfo}${addonInfo}  Usia: ${s.ageTier.label}\n  Durasi: ${s.durationMinutes} menit\n${priceLine}  Deskripsi: ${s.description}`;
      })
      .join('\n\n');
  }

  /**
   * Format data treatment TERSTRUKTUR untuk injeksi sebagai konteks LLM (bukan jawaban jadi).
   * Berbeda dari formatCatalogText (yang berformat bullet "• *Nama*") — blok ini memaksa LLM
   * menyusun kalimat rekomendasi sendiri dari fakta, menghindari LLM meniru format katalog kaku.
   * TANPA harga (harga dikelola terpisah — cegah halusinasi harga).
   */
  public formatCatalogData(services: ClinicServiceItem[]): string {
    return services
      .filter((s) => s.isActive)
      .map((s) =>
        `[DATA TREATMENT]\n` +
        `Nama: ${s.name}\n` +
        `Kategori: ${s.category}\n` +
        `Usia/Target: ${s.ageTier.label}\n` +
        `Durasi: ${s.durationMinutes} menit\n` +
        `Deskripsi: ${s.description}`
      )
      .join('\n\n');
  }

  /**
   * Filter layanan secara ketat berdasarkan target audiens (BABY, KIDS, MOMS) dan rentang usia.
   * Mencegah rekomendasi silang (contoh: Prenatal Yoga untuk anak 3 tahun).
   */
  public filterServicesByAudience(
    services: ClinicServiceItem[],
    context: {
      ageMonths?: number | null;
      audienceIntent?: 'BABY' | 'KIDS' | 'MOMS' | 'GENERAL';
      isMaternalKeyword?: boolean;
    }
  ): ClinicServiceItem[] {
    const { ageMonths, audienceIntent, isMaternalKeyword } = context;

    // 1. Context Kehamilan / Maternal / Ibu Hamil / Nifas
    if (audienceIntent === 'MOMS' || isMaternalKeyword) {
      return services.filter(
        (s) => s.category === 'MOMS' || s.category === 'BOTH' || (s.category === 'BUNDLE' && (s.id.includes('moms') || s.id.includes('laktasi') || s.id.includes('kelahiran')))
      );
    }

    // 2. Context Usia Anak / Bayi (dalam bulan)
    if (ageMonths != null && ageMonths > 0) {
      return services.filter((s) => {
        // Blokir mutlak kategori MOMS jika mencari untuk anak
        if (s.category === 'MOMS') return false;
        if (s.category === 'BUNDLE' && (s.id.includes('moms') || s.id.includes('laktasi') || s.id.includes('kelahiran'))) return false;

        const minAge = s.ageTier?.minAgeMonths ?? 0;
        const maxAge = s.ageTier?.maxAgeMonths ?? null;

        if (ageMonths < minAge) return false;
        if (maxAge !== null && ageMonths > maxAge) return false;

        if (ageMonths >= 24) {
          // Usia anak >= 2 tahun (24 bulan)
          return s.category === 'KIDS' || s.category === 'BOTH' || (s.category === 'BUNDLE' && !s.id.includes('moms') && !s.id.includes('laktasi')) || (s.category === 'BABY' && (maxAge === null || maxAge >= ageMonths));
        } else {
          // Usia bayi < 2 tahun
          return s.category === 'BABY' || s.category === 'BOTH' || (s.category === 'BUNDLE' && !s.id.includes('moms') && !s.id.includes('laktasi') && !s.id.includes('kelahiran'));
        }
      });
    }

    // 3. Audience KIDS
    if (audienceIntent === 'KIDS') {
      return services.filter((s) => s.category === 'KIDS' || s.category === 'BOTH' || (s.category === 'BUNDLE' && !s.id.includes('moms') && !s.id.includes('laktasi')));
    }

    // 4. Audience BABY
    if (audienceIntent === 'BABY') {
      return services.filter(
        (s) => s.category === 'BABY' || s.category === 'BOTH' || s.category === 'ADD_ON' || (s.category === 'BUNDLE' && !s.id.includes('moms') && !s.id.includes('laktasi') && !s.id.includes('kelahiran'))
      );
    }

    return services;
  }

  /**
   * Cari treatment yang relevan dengan pertanyaan customer dan kembalikan array item terstruktur.
   * Logika scoring sama persis dengan searchCatalog (exact-name priority, lalu IDF keyword top-2),
   * TAPI mengembalikan data mentah — biarkan pembentuk jawaban (LLM/fallback) yang menyusun kalimat.
   */
  public searchCatalogItems(userText: string): ClinicServiceItem[] {
    const rawQ = userText.toLowerCase();
    // Bersihkan partikel pembuka koreksi / anaphora (misal "maksud saya yang paket newborn" -> "paket newborn")
    const q = rawQ
      .replace(/\b(?:maksud\s*(?:saya|ku|e|kami|sy)|bukan(?:\s+yang\s+itu)?[,\s]+(?:maksud(?:ku|saya)?\s+)?)\s*(?:yang\s+)?/i, '')
      .trim() || rawQ;
    const allServices = this.getAllServices();

    const ageMonths = parseAgeTextToMonths(userText);
    const isMaternal = /\b(hamil|bumil|prenatal|nifas|laktasi|menyusui|trimester|oksitosin|induksi|postpartum|payudara|breast)\b/i.test(userText);
    const isKidKeyword = /\b(anak|kids|balita|paud|tk|bocah)\b/i.test(userText);
    const isBabyKeyword = /\b(bayi|baby|newborn|selapan|infant)\b/i.test(userText);

    let audienceIntent: 'BABY' | 'KIDS' | 'MOMS' | 'GENERAL' = 'GENERAL';
    if (isMaternal) {
      audienceIntent = 'MOMS';
    } else if (ageMonths !== null) {
      audienceIntent = ageMonths >= 24 ? 'KIDS' : 'BABY';
    } else if (isKidKeyword) {
      audienceIntent = 'KIDS';
    } else if (isBabyKeyword) {
      audienceIntent = 'BABY';
    }

    // Filter awal berdasarkan audience / age tier untuk mencegah halusinasi silang
    const services = this.filterServicesByAudience(allServices, {
      ageMonths,
      audienceIntent,
      isMaternalKeyword: isMaternal,
    });

    // 1. Exact Phrase Match & Bigram Phrase Match pada Nama Treatment
    const exactMatches: ClinicServiceItem[] = [];
    const partialMatches: ClinicServiceItem[] = [];

    for (const s of services) {
      if (!s.isActive) continue;
      const cleanName = s.name.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
      const fullName = s.name.toLowerCase();
      const nameParts = cleanName.split(/\s+/);

      if (q.includes(cleanName) || fullName.includes(q.trim()) || (q.length >= 4 && cleanName.includes(q.trim()))) {
        exactMatches.push(s);
      } else if (nameParts.length >= 2) {
        const twoWordPhrase = `${nameParts[0]} ${nameParts[1]}`;
        if (twoWordPhrase.length >= 5 && q.includes(twoWordPhrase)) {
          partialMatches.push(s);
        }
      }
    }

    if (exactMatches.length > 0) {
      // Prioritaskan exact matches, urutkan berdasarkan panjang nama terpanjang (terspesifik dulu)
      return exactMatches.sort((a, b) => b.name.length - a.name.length);
    }

    if (partialMatches.length > 0) {
      return partialMatches;
    }

    // 2. Smart Age & Category Matching
    const hasMedical = checkMedicalKeywords(userText).isMedical;
    if (ageMonths !== null && !hasMedical) {
      const isMassage = /\b(pijat|mijat|pijet|urut|massage)\b/i.test(q);
      const isSpa = /\b(spa|bubble|mandi|berendam)\b/i.test(q);
      const ageServices = this.getServicesByAge(ageMonths, true);

      if (isMassage && !isSpa) {
        let massageServices = ageServices.filter((s) => s.name.toLowerCase().includes('pijat') || s.name.toLowerCase().includes('massage'));
        if (ageMonths >= 24) {
          // Usia 2 tahun ke atas: utamakan KIDS
          massageServices.sort((a, b) => (b.category === 'KIDS' ? 1 : 0) - (a.category === 'KIDS' ? 1 : 0));
        } else {
          // Usia di bawah 2 tahun: utamakan BABY
          massageServices.sort((a, b) => (b.category === 'BABY' ? 1 : 0) - (a.category === 'BABY' ? 1 : 0));
        }
        if (massageServices.length > 0) {
          return [massageServices[0]];
        }
      } else if (isSpa) {
        const spaServices = ageServices.filter((s) => s.name.toLowerCase().includes('spa') || s.name.toLowerCase().includes('bubble'));
        if (spaServices.length > 0) {
          return [spaServices[0]];
        }
      } else if (ageServices.length > 0) {
        return [ageServices[0]];
      }
    }

    // 3. Fallback Keyword Scoring (sama dengan searchCatalog)
    // Synonym expansion: istilah colloquial → keyword yang ada di catalog
    const SYNONYMS: Record<string, string> = {
      'bumil': 'hamil',           // ibu hamil
      'bapil': 'batuk pilek',     // batuk pilek
      'asi': 'laktasi',           // produksi ASI
      'menyusui': 'laktasi',      // ibu menyusui
      'hamil': 'hamil',           // canonical
      'prenatal': 'hamil',        // prenatal massage
      'oksitosin': 'oksitosin',   // sudah ada di nama
      'nifas': 'pasca melahirkan', // masa nifas
      'bayi': 'bayi',             // baby
      'kids': 'anak',             // kids
      'balita': 'anak',           // balita = anak
      'kembung': 'kembung',       // sudah ada di nama
      'kolik': 'kembung',         // bayi kolik
      'newborn': 'selapan newborn', // newborn care
      'selapan': 'selapan newborn', // paket selapan
    };

    const stopwords = new Set([
      'ini', 'itu', 'sini', 'situ', 'mana', 'gimana', 'siapa',
      'yang', 'apa', 'berapa', 'bung', 'bund', 'bunda', 'bun', 'ya', 'dong', 'kak', 'min', 'mbak', 'mas',
      'saya', 'untuk', 'dengan', 'dan', 'atau', 'dari', 'ke', 'di', 'ada', 'bisa', 'mau', 'ingin', 'bagaimana',
      'kenapa', 'apakah', 'treatment', 'perawatan', 'tentang', 'info', 'informasi', 'detail', 'tolong',
      'ciri', 'cirinya', 'khasiat', 'manfaat', 'fungsi', 'fungsinya', 'sih', 'nih', 'lho', 'kan',
      'juga', 'saja', 'aja', 'semua', 'daftar', 'list', 'please',
      'pijat', // generic, semua treatment ada kata "pijat" → skip dari scoring
    ]);
    
    const rawKeywords = q
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9]/gi, ''))
      .filter((w) => w.length >= 3 && !stopwords.has(w));

    // Expand synonyms: setiap keyword yang ada di SYNONYMS → tambahkan expanded keyword
    const expandedKeywords = new Set<string>();
    for (const kw of rawKeywords) {
      expandedKeywords.add(kw);
      const synonym = SYNONYMS[kw];
      if (synonym) {
        // Split multi-word synonyms (e.g. "batuk pilek" → ["batuk", "pilek"])
        for (const part of synonym.split(/\s+/)) {
          if (part.length >= 3) {
            expandedKeywords.add(part);
          }
        }
      }
    }

    const keywords = Array.from(expandedKeywords);

    if (keywords.length === 0) {
      return [];
    }

    const df = new Map<string, number>();
    for (const k of keywords) {
      const count = services.filter((s) =>
        s.name.toLowerCase().includes(k) || s.description.toLowerCase().includes(k)
      ).length;
      df.set(k, count > 0 ? count : 1);
    }

    const scored = services
      .map((s) => {
        const nameLower = s.name.toLowerCase();
        const descLower = s.description.toLowerCase();
        const ageLower = s.ageTier.label.toLowerCase();
        let rawScore = 0;
        for (const k of keywords) {
          if (nameLower.includes(k)) rawScore += 3;
          if (descLower.includes(k)) rawScore += 1;
          if (ageLower.includes(k)) rawScore += 0.5;
        }
        let idfScore = 0;
        for (const k of keywords) {
          if (nameLower.includes(k)) idfScore += 3 / (df.get(k) || 1);
          if (descLower.includes(k)) idfScore += 1 / (df.get(k) || 1);
          if (ageLower.includes(k)) idfScore += 0.5 / (df.get(k) || 1);
        }
        return { s, score: idfScore > 0 ? idfScore : rawScore };
      })
      .filter((c) => c.score > 0);

    if (scored.length === 0) {
      return [];
    }

    const maxScore = Math.max(...scored.map((c) => c.score));
    return scored
      .filter((c) => c.score >= maxScore * 0.85)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((c) => c.s);
  }


  public searchCatalog(userText: string, includePrice = false): string {
    const q = userText.toLowerCase();
    const services = this.getAllServices();

    // 1. PRIORITAS UTAMA: Exact Phrase Match pada Nama Treatment
    // Jika customer sebut nama treatment spesifik (misal "pijat bayi ceria"), kembalikan HANYA 1 treatment itu.
    const exactNameMatch = services.find((s) => {
      // Ambil nama tanpa kurung, misal "Pijat Bayi Ceria (Rileksasi)" -> "pijat bayi ceria"
      const cleanName = s.name.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
      const strippedQ = q.replace(/\b(ini|itu|sini|situ|mana|gimana|apa|ya|bund|bunda|bun|berapa|dong|kak|min|mbak|mas)\b/gi, '').replace(/[^a-z0-9\s]/gi, '').trim();
      return (cleanName.length >= 4 && q.includes(cleanName)) || (strippedQ.length >= 4 && cleanName.includes(strippedQ));
    });

    if (exactNameMatch) {
      const priceLine = includePrice
        ? `  Harga Normal: Rp${exactNameMatch.originalPrice.toLocaleString('id-ID')} | Promo: Rp${exactNameMatch.promoPrice.toLocaleString('id-ID')}\n`
        : '';
      return `• *${exactNameMatch.name}*\n  Usia: ${exactNameMatch.ageTier.label}\n  Durasi: ${exactNameMatch.durationMinutes} menit\n${priceLine}  Deskripsi: ${exactNameMatch.description}`;
    }

    // 2. Fallback Keyword Scoring
    const stopwords = new Set([
      'ini', 'itu', 'sini', 'situ', 'mana', 'gimana', 'siapa',
      'yang', 'apa', 'berapa', 'bung', 'bund', 'bunda', 'bun', 'ya', 'dong', 'kak', 'min', 'mbak', 'mas',
      'saya', 'untuk', 'dengan', 'dan', 'atau', 'dari', 'ke', 'di', 'ada', 'bisa', 'mau', 'ingin', 'bagaimana',
      'kenapa', 'apakah', 'treatment', 'perawatan', 'tentang', 'info', 'informasi', 'detail', 'tolong',
      'ciri', 'cirinya', 'khasiat', 'manfaat', 'fungsi', 'fungsinya', 'sih', 'nih', 'lho', 'kan',
      'juga', 'saja', 'aja', 'semua', 'daftar', 'list', 'please',
      'pijat', // generic, semua treatment ada kata "pijat" → skip dari scoring
    ]);
    const keywords = q
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9]/gi, ''))
      .filter((w) => w.length >= 3 && !stopwords.has(w));

    if (keywords.length === 0) {
      return '';
    }

    // Hitung document frequency per keyword (berapa service yang mengandung kata itu).
    // Kata yang muncul di banyak service (misal "pijat") dianggap generik → bobot kecil.
    // Kata langka (misal "asi", "lancar") lebih spesifik → bobot besar (IDF).
    const df = new Map<string, number>();
    for (const k of keywords) {
      const count = services.filter((s) =>
        s.name.toLowerCase().includes(k) || s.description.toLowerCase().includes(k)
      ).length;
      df.set(k, count > 0 ? count : 1);
    }

    // Scoring: match nama +3, deskripsi +1, usia +0.5; lalu kalikan dengan 1/df (IDF)
    const scored = services
      .map((s) => {
        const nameLower = s.name.toLowerCase();
        const descLower = s.description.toLowerCase();
        const ageLower = s.ageTier.label.toLowerCase();
        let rawScore = 0;
        for (const k of keywords) {
          if (nameLower.includes(k)) rawScore += 3;
          if (descLower.includes(k)) rawScore += 1;
          if (ageLower.includes(k)) rawScore += 0.5;
        }
        // IDF: kalikan skor per kata dengan 1/df, gabungkan
        let idfScore = 0;
        for (const k of keywords) {
          if (nameLower.includes(k)) idfScore += 3 / (df.get(k) || 1);
          if (descLower.includes(k)) idfScore += 1 / (df.get(k) || 1);
          if (ageLower.includes(k)) idfScore += 0.5 / (df.get(k) || 1);
        }
        return { s, score: idfScore > 0 ? idfScore : rawScore };
      })
      .filter((c) => c.score > 0);

    if (scored.length === 0) {
      return '';
    }

    // Ambil hanya yang skor tertinggi (threshold ketat >= maxScore * 0.85, max 2 items)
    const maxScore = Math.max(...scored.map((c) => c.score));
    const top = scored
      .filter((c) => c.score >= maxScore * 0.85)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    return top
      .map(({ s }) => {
        const priceLine = includePrice
          ? `  Harga Normal: Rp${s.originalPrice.toLocaleString('id-ID')} | Promo: Rp${s.promoPrice.toLocaleString('id-ID')}\n`
          : '';
        return `• *${s.name}*\n  Usia: ${s.ageTier.label}\n  Durasi: ${s.durationMinutes} menit\n${priceLine}  Deskripsi: ${s.description}`;
      })
      .join('\n\n');
  }
}

export const treatmentCatalogService = new TreatmentCatalogService();
