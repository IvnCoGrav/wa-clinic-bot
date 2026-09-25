import fs from 'fs';
import path from 'path';
import { parseAgeTextToMonths } from '../utils/age-calculator';
import { checkMedicalKeywords } from '../config/medical-keywords';
import { DEFAULT_TENANT_ID } from '../config/tenant';
// Taksonomi usia kanonis (modul murni, tanpa dependensi service → tanpa cycle).
import {
  CHILD_CATEGORY_AGE_THRESHOLD_MONTHS,
  PatientProfileExtractor,
} from '../v3/state/patient-extractor';

export type TreatmentCategoryType = 'BABY' | 'KIDS' | 'MOMS' | 'BOTH' | 'BUNDLE' | 'ADD_ON';

export type ClinicServiceType = 'STANDARD' | 'BUNDLE' | 'ADD_ON';

/** Audiens kanonis layanan (plan regresi Fase 2, data-driven). */
export type ServiceAudience = 'MOMS' | 'BABY' | 'KIDS' | 'BOTH' | 'GENERAL';

/**
 * Resolusi audiens layanan dari METADATA katalog (plan regresi Fase 2).
 * - Kategori langsung (MOMS/BABY/KIDS/BOTH/ADD_ON) dipetakan 1:1.
 * - BUNDLE diderivasi dari KOMPOSISI komponennya (bundleItemIds → kategori
 *   komponen via lookup): semua-MOMS → MOMS, semua-BABY → BABY, dst.;
 *   campuran ibu+anak → BOTH. Tanpa lookup → GENERAL (netral, aman).
 * DILARANG menghafal substring ID/nama ('moms'/'laktasi'/'kelahiran') —
 * layanan baru (ID apa pun) otomatis terklasifikasi dari komposisinya.
 */
export function resolveServiceAudience(
  service: { category?: string | null; bundleItemIds?: string[] | null },
  lookup?: (id: string) => { category?: string | null } | undefined,
): ServiceAudience {
  const cat = (service?.category || '').toUpperCase();
  if (cat === 'MOMS') return 'MOMS';
  if (cat === 'BABY') return 'BABY';
  if (cat === 'KIDS') return 'KIDS';
  if (cat === 'BOTH') return 'BOTH';
  if (cat === 'ADD_ON' || cat === 'ADDON') return 'GENERAL';
  if (cat === 'BUNDLE' || ((service?.bundleItemIds || []).length > 0)) {
    const compCats = new Set<string>();
    if (lookup) {
      for (const cid of service?.bundleItemIds || []) {
        const c = lookup((cid || '').toLowerCase());
        const cc = (c?.category || '').toUpperCase();
        if (cc === 'MOMS' || cc === 'BABY' || cc === 'KIDS' || cc === 'BOTH') compCats.add(cc);
      }
    }
    if (compCats.size === 0) return 'GENERAL';
    const hasMoms = compCats.has('MOMS') || compCats.has('BOTH');
    const hasBaby = compCats.has('BABY') || compCats.has('BOTH');
    const hasKids = compCats.has('KIDS') || compCats.has('BOTH');
    if (hasMoms && !hasBaby && !hasKids) return 'MOMS';
    if (hasBaby && !hasMoms && !hasKids) return 'BABY';
    if (hasKids && !hasMoms && !hasBaby) return 'KIDS';
    return 'BOTH';
  }
  return 'GENERAL';
}

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
  totalSessions?: number;      // null = single visit, 14 = paket 14 sesi
  sessionScheduleType?: string; // "manual" = admin atur jam per sesi
}

const SERVICES_FILE = path.join(process.cwd(), 'services_custom.json');

// Struktur: Map<tenantId, Map<serviceId, ClinicServiceItem>>
const tenantServiceCatalog: Map<string, Map<string, ClinicServiceItem>> = new Map();

/** Helper untuk mendapatkan atau membuat catalog map per-tenant */
function getTenantCatalog(tenantId: string = DEFAULT_TENANT_ID): Map<string, ClinicServiceItem> {
  let cat = tenantServiceCatalog.get(tenantId);
  if (!cat) {
    cat = new Map<string, ClinicServiceItem>();
    tenantServiceCatalog.set(tenantId, cat);
  }
  return cat;
}

// Backwards-compat: alias untuk default tenant (dipakai legacy code tanpa tenantId)
const serviceCatalog: Map<string, ClinicServiceItem> = getTenantCatalog(DEFAULT_TENANT_ID);

// Default data catalog
export const DEFAULT_CLINIC_SERVICES: ClinicServiceItem[] = [
  {
    "id": "baby-cukur",
    "name": "Kala Baby – Cukur Rambut",
    "category": "BABY",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": 12,
      "label": "0 - 12 Bulan"
    },
    "durationMinutes": 15,
    "originalPrice": 35000,
    "promoPrice": 25000,
    "description": "Cukur gundul/bersih rambut bayi menggunakan alat steril atau milik customer sendiri.",
    "isActive": true
  },
  {
    "id": "moms-oksitosin-partial",
    "name": "Oksitosin Massage Non-Fullbody",
    "category": "MOMS",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "Ibu Menyusui"
    },
    "durationMinutes": 40,
    "originalPrice": 90000,
    "promoPrice": 75000,
    "description": "Pijat punggung, leher & bahu untuk merangsang hormon oksitosin dan memperlancar aliran ASI.",
    "isActive": false
  },
  {
    "id": "baby-mandi",
    "name": "Kala Baby – Memandikan Bayi",
    "category": "BABY",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": 24,
      "label": "0 - 24 Bulan"
    },
    "durationMinutes": 25,
    "originalPrice": 40000,
    "promoPrice": 30000,
    "description": "Memandikan bayi secara higienis, lembut, dan steril oleh bidan langsung di rumah.",
    "isActive": true
  },
  {
    "id": "moms-relaksasi",
    "name": "Pijat Relaksasi Ibu (Women Relaxation Massage)",
    "category": "MOMS",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "Khusus Wanita / Ibu"
    },
    "durationMinutes": 60,
    "originalPrice": 110000,
    "promoPrice": 85000,
    "description": "Pijat relaksasi seluruh tubuh untuk wanita/ibu yang lelah beraktivitas harian.",
    "isActive": false
  },
  {
    "id": "baby-cukur-pijat-terapi",
    "name": "Cukur + Pijat Terapi",
    "category": "BUNDLE",
    "serviceType": "BUNDLE",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": 12,
      "label": "Bayi 0 - 12 Bulan"
    },
    "durationMinutes": 55,
    "originalPrice": 135000,
    "promoPrice": 90000,
    "description": "[BUNDLE:baby-cukur,baby-massage-pulih-ceria] Paket hemat kombinasi cukur rambut bayi dan pijat terapi bayi.",
    "isActive": false,
    "bundleItemIds": [
      "baby-cukur",
      "baby-massage-pulih-ceria"
    ]
  },
  {
    "id": "baby-tindik",
    "name": "Kala Baby – Tindik Telinga",
    "category": "BABY",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": 12,
      "label": "0 - 12 Bulan"
    },
    "durationMinutes": 15,
    "originalPrice": 70000,
    "promoPrice": 50000,
    "description": "Tindik telinga higienis & aman oleh bidan langsung dengan anting steril.",
    "isActive": true
  },
  {
    "id": "custom-kids-spa",
    "name": "Custom Kids Bubble Spa",
    "category": "KIDS",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 12,
      "maxAgeMonths": 48,
      "label": "1 - 4 Tahun"
    },
    "durationMinutes": 60,
    "originalPrice": 160000,
    "promoPrice": 130000,
    "description": "Layanan mandi berbusa dan pijat relaksasi anak.",
    "isActive": false
  },
  {
    "id": "baby-massage-ceria-newborn",
    "name": "Kala Baby – Pijat Ceria Newborn",
    "category": "BABY",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": 6,
      "label": "0 - 6 Bulan"
    },
    "durationMinutes": 40,
    "originalPrice": 80000,
    "promoPrice": 60000,
    "description": "Pijat relaksasi untuk membantu tidur lebih nyenyak, meredakan kelelahan, dan membuat tubuh lebih rileks.",
    "isActive": true
  },
  {
    "id": "baby-massage-ceria",
    "name": "Kala Baby – Pijat Ceria",
    "category": "BABY",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 7,
      "maxAgeMonths": 24,
      "label": "7 - 24 Bulan"
    },
    "durationMinutes": 40,
    "originalPrice": 80000,
    "promoPrice": 70000,
    "description": "Pijat relaksasi tubuh bayi usia aktif merangkak/berjalan untuk meredakan pegal, tidur nyenyak & stimulasi motorik.",
    "isActive": true
  },
  {
    "id": "baby-massage-pulih-ceria",
    "name": "Kala Baby – Pijat Pulih Ceria",
    "category": "BABY",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 7,
      "maxAgeMonths": 24,
      "label": "7 - 24 Bulan"
    },
    "durationMinutes": 40,
    "originalPrice": 100000,
    "promoPrice": 75000,
    "description": "Terapi khusus batuk, pilek, flu, rewel, susah BAB, kembung/kolik dengan double aromaterapi & titik akupresur.",
    "isActive": true
  },
  {
    "id": "baby-massage-lahap-juara",
    "name": "Kala Baby – Pijat Lahap",
    "category": "BABY",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": 24,
      "label": "0 - 24 Bulan"
    },
    "durationMinutes": 40,
    "originalPrice": 100000,
    "promoPrice": 75000,
    "description": "Pijat stimulasi pencernaan dan nafsu makan untuk membantu mengatasi anak GTM (Gerakan Tutup Mulut), sulit makan, susah makan, dan meningkatkan kebugaran tubuh si kecil.",
    "isActive": true
  },
  {
    "id": "NewBorn",
    "name": "Kala Newborn – Paket Pendampingan 14 Sesi",
    "category": "BABY",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": 6,
      "label": "0 - 6 Bulan"
    },
    "durationMinutes": 120,
    "originalPrice": 700000,
    "promoPrice": 600000,
    "description": "Paket pendampingan intensif ibu & newborn pasca lahir selama 14 sesi (perawatan tali pusat, memandikan, jemur, pijat).",
    "isActive": true
  },
  {
    "id": "kids-massage-2-4th",
    "name": "Kala Kids – Pijat Ceria",
    "category": "KIDS",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 24,
      "maxAgeMonths": 48,
      "label": "2 - 4 Tahun"
    },
    "durationMinutes": 40,
    "originalPrice": 85000,
    "promoPrice": 75000,
    "description": "Pijat kebugaran & relaksasi anak toddler untuk meredakan pegal dan meningkatkan kualitas tidur.",
    "isActive": true
  },
  {
    "id": "kids-massage-4-6th",
    "name": "Kala Kids – Pijat Ceria",
    "category": "KIDS",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 48,
      "maxAgeMonths": 72,
      "label": "4 - 6 Tahun"
    },
    "durationMinutes": 40,
    "originalPrice": 90000,
    "promoPrice": 80000,
    "description": "Pijat kebugaran & relaksasi anak usia pra-sekolah setelah aktif beraktivitas.",
    "isActive": true
  },
  {
    "id": "kids-massage-6-8th",
    "name": "Kala Kids – Pijat Ceria",
    "category": "KIDS",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 72,
      "maxAgeMonths": 96,
      "label": "6 - 8 Tahun"
    },
    "durationMinutes": 40,
    "originalPrice": 100000,
    "promoPrice": 90000,
    "description": "Pijat relaksasi & kebugaran anak usia sekolah untuk melemaskan otot tegang dan pegal.",
    "isActive": true
  },
  {
    "id": "baby-massage-lahap-juara-gt2",
    "name": "Kala Kids – Pijat Lahap",
    "category": "KIDS",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 24,
      "maxAgeMonths": 96,
      "label": "2 - 8 Tahun"
    },
    "durationMinutes": 40,
    "originalPrice": 110000,
    "promoPrice": 80000,
    "description": "Pijat stimulasi pencernaan & titik akupresur penambah nafsu makan untuk membantu mengatasi anak GTM (Gerakan Tutup Mulut), sulit makan, susah makan, pada anak usia di atas 2 tahun.",
    "isActive": true
  },
  {
    "id": "kids-pulih-2-4th",
    "name": "Kala Kids – Pijat Pulih Ceria",
    "category": "KIDS",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 24,
      "maxAgeMonths": 48,
      "label": "2 - 4 Tahun"
    },
    "durationMinutes": 40,
    "originalPrice": 100000,
    "promoPrice": 85000,
    "description": "Terapi khusus batuk, pilek, bapil, flu, kembung, sembelit untuk anak usia 2-4 tahun dengan akupresur & aromaterapi.",
    "isActive": true
  },
  {
    "id": "kids-pulih-4-6th",
    "name": "Kala Kids – Pijat Pulih Ceria",
    "category": "KIDS",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 48,
      "maxAgeMonths": 72,
      "label": "4 - 6 Tahun"
    },
    "durationMinutes": 40,
    "originalPrice": 110000,
    "promoPrice": 90000,
    "description": "Terapi khusus batuk, pilek, bapil, flu, kembung, sembelit untuk anak usia 4-6 tahun dengan akupresur & aromaterapi.",
    "isActive": true
  },
  {
    "id": "kids-pulih-6-8th",
    "name": "Kala Kids – Pijat Pulih Ceria",
    "category": "KIDS",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 72,
      "maxAgeMonths": 96,
      "label": "6 - 8 Tahun"
    },
    "durationMinutes": 40,
    "originalPrice": 120000,
    "promoPrice": 100000,
    "description": "Terapi khusus batuk, pilek, bapil, flu, kembung, sembelit untuk anak usia 6-8 tahun dengan akupresur & aromaterapi.",
    "isActive": true
  },
  {
    "id": "moms-prenatal-yoga",
    "name": "Kala Mom – Prenatal Gentle Yoga",
    "category": "MOMS",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "Trimester 2 & 3"
    },
    "durationMinutes": 30,
    "originalPrice": 70000,
    "promoPrice": 50000,
    "description": "Latihan peregangan, pernapasan, dan postur lembut untuk mempersiapkan tubuh menghadapi persalinan.",
    "isActive": true
  },
  {
    "id": "moms-perineum-massage",
    "name": "Kala Mom – Perineum Massage",
    "category": "MOMS",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "Min. 34-36 Minggu"
    },
    "durationMinutes": 30,
    "originalPrice": 70000,
    "promoPrice": 50000,
    "description": "Pijat elastisitas area perineum menjelang persalinan normal untuk meminimalkan robekan jalan lahir.",
    "isActive": true
  },
  {
    "id": "moms-oksitosin",
    "name": "Kala Mom – Oksitosin Massage (Punggung)",
    "category": "MOMS",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "Ibu Menyusui"
    },
    "durationMinutes": 40,
    "originalPrice": 90000,
    "promoPrice": 75000,
    "description": "Pijat punggung, leher & bahu untuk merangsang hormon oksitosin dan memperlancar aliran ASI.",
    "isActive": true
  },
  {
    "id": "moms-paket-laktasi",
    "name": "Kala Mom – Laktasi & Breast Care",
    "category": "MOMS",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "Ibu Menyusui"
    },
    "durationMinutes": 40,
    "originalPrice": 110000,
    "promoPrice": 85000,
    "description": "Perawatan payudara untuk melancarkan sumbatan ASI, meredakan payudara bengkak & stimulasi ASI.",
    "isActive": true
  },
  {
    "id": "moms-prenatal-massage",
    "name": "Kala Mom – Prenatal Massage",
    "category": "MOMS",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "Trimester 2 & 3"
    },
    "durationMinutes": 60,
    "originalPrice": 120000,
    "promoPrice": 90000,
    "description": "Pijat khusus ibu hamil posisi miring aman untuk meredakan pegal pinggang, kaki bengkak & relaksasi.",
    "isActive": true
  },
  {
    "id": "moms-postpartum-massage",
    "name": "Kala Mom – Postpartum Recovery Massage",
    "category": "MOMS",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "Normal / SC"
    },
    "durationMinutes": 60,
    "originalPrice": 130000,
    "promoPrice": 100000,
    "description": "Pijat pemulihan stamina tubuh ibu pasca persalinan, melancarkan peredaran darah dan relaksasi.",
    "isActive": true
  },
  {
    "id": "moms-oksitosin-fullbody",
    "name": "Kala Mom – Oksitosin Massage (Full Body)",
    "category": "MOMS",
    "serviceType": "STANDARD",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "Ibu Menyusui"
    },
    "durationMinutes": 60,
    "originalPrice": 140000,
    "promoPrice": 105000,
    "description": "Pijat relaksasi seluruh tubuh dipadukan dengan stimulasi oksitosin untuk kelancaran ASI.",
    "isActive": true
  },
  {
    "id": "baby-paket-selapan",
    "name": "Kala Bundle Selapan – Cukur + Pijat Ceria",
    "category": "BUNDLE",
    "serviceType": "BUNDLE",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": 12,
      "label": "Bayi 0 - 12 Bulan"
    },
    "durationMinutes": 55,
    "originalPrice": 115000,
    "promoPrice": 80000,
    "description": "[BUNDLE:baby-cukur,baby-massage-ceria] Paket tradisi selapanan: cukur rambut steril + pijat bayi ceria relaksasi.",
    "isActive": true,
    "bundleItemIds": [
      "baby-cukur",
      "baby-massage-ceria"
    ]
  },
  {
    "id": "baby-paket-selapan-terapi",
    "name": "Kala Bundle Selapan – Cukur + Pijat Pulih Ceria",
    "category": "BUNDLE",
    "serviceType": "BUNDLE",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": 12,
      "label": "Bayi 0 - 12 Bulan"
    },
    "durationMinutes": 55,
    "originalPrice": 135000,
    "promoPrice": 90000,
    "description": "[BUNDLE:baby-cukur,baby-massage-pulih-ceria] Paket selapanan saat bayi sedang batuk pilek/kembung: cukur steril + pijat terapi pulih ceria.",
    "isActive": true,
    "bundleItemIds": [
      "baby-cukur",
      "baby-massage-pulih-ceria"
    ]
  },
  {
    "id": "baby-paket-selapan-full",
    "name": "Kala Bundle Selapan Full – Cukur + Ceria + Mandi",
    "category": "BUNDLE",
    "serviceType": "BUNDLE",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": 12,
      "label": "Bayi 0 - 12 Bulan"
    },
    "durationMinutes": 80,
    "originalPrice": 155000,
    "promoPrice": 100000,
    "description": "[BUNDLE:baby-cukur,baby-massage-ceria,baby-mandi] Paket lengkap selapanan: cukur gundul steril + pijat ceria + memandikan bayi bersih & harum.",
    "isActive": true,
    "bundleItemIds": [
      "baby-cukur",
      "baby-massage-ceria",
      "baby-mandi"
    ]
  },
  {
    "id": "baby-paket-selapan-terapi-full",
    "name": "Kala Bundle Selapan Full – Cukur + Pulih Ceria + Mandi",
    "category": "BUNDLE",
    "serviceType": "BUNDLE",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": 12,
      "label": "Bayi 0 - 12 Bulan"
    },
    "durationMinutes": 80,
    "originalPrice": 175000,
    "promoPrice": 110000,
    "description": "[BUNDLE:baby-cukur,baby-massage-pulih-ceria,baby-mandi] Paket komplit saat selapanan bayi bapil/kembung: cukur + pijat pulih ceria + memandikan bayi.",
    "isActive": true,
    "bundleItemIds": [
      "baby-cukur",
      "baby-massage-pulih-ceria",
      "baby-mandi"
    ]
  },
  {
    "id": "bundle-perineum-yoga",
    "name": "Kala Bundle Pra-Kelahiran – Perineum + Yoga",
    "category": "BUNDLE",
    "serviceType": "BUNDLE",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "Ibu Hamil (34-36 mgg)"
    },
    "durationMinutes": 60,
    "originalPrice": 140000,
    "promoPrice": 85000,
    "description": "[BUNDLE:moms-perineum-massage,moms-prenatal-yoga] Kombinasi pijat perineum + gentle yoga untuk kelenturan jalan lahir dan stamina persalinan.",
    "isActive": true,
    "bundleItemIds": [
      "moms-perineum-massage",
      "moms-prenatal-yoga"
    ]
  },
  {
    "id": "bundle-yoga-breast",
    "name": "Kala Bundle Pra-Kelahiran – Yoga + Breast Care",
    "category": "BUNDLE",
    "serviceType": "BUNDLE",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "Ibu Hamil (Min. 36 mgg)"
    },
    "durationMinutes": 70,
    "originalPrice": 180000,
    "promoPrice": 85000,
    "description": "[BUNDLE:moms-prenatal-yoga,moms-paket-laktasi] Gentle yoga kehamilan + perawatan payudara untuk persiapan kelahiran dan menyusui.",
    "isActive": true,
    "bundleItemIds": [
      "moms-prenatal-yoga",
      "moms-paket-laktasi"
    ]
  },
  {
    "id": "bundle-perineum-breast",
    "name": "Kala Bundle Pra-Kelahiran – Perineum + Breast Care",
    "category": "BUNDLE",
    "serviceType": "BUNDLE",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "Ibu Hamil (Min. 36 mgg)"
    },
    "durationMinutes": 70,
    "originalPrice": 180000,
    "promoPrice": 85000,
    "description": "[BUNDLE:moms-perineum-massage,moms-paket-laktasi] Kombinasi pijat perineum + persiapan laktasi dini menjelang hari persalinan.",
    "isActive": true,
    "bundleItemIds": [
      "moms-perineum-massage",
      "moms-paket-laktasi"
    ]
  },
  {
    "id": "bundle-pra-kelahiran-lengkap",
    "name": "Kala Bundle Pra-Kelahiran Lengkap (3-in-1)",
    "category": "BUNDLE",
    "serviceType": "BUNDLE",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "Ibu Hamil (Min. 36 mgg)"
    },
    "durationMinutes": 100,
    "originalPrice": 250000,
    "promoPrice": 150000,
    "description": "[BUNDLE:moms-perineum-massage,moms-prenatal-yoga,moms-paket-laktasi] Paket 3-in-1 persiapan persalinan & menyusui paling komplit: Perineum + Yoga + Breast Care.",
    "isActive": true,
    "bundleItemIds": [
      "moms-perineum-massage",
      "moms-prenatal-yoga",
      "moms-paket-laktasi"
    ]
  },
  {
    "id": "bundle-mom-baby-ceria",
    "name": "Kala Bundle Duo – Mom & Baby Ceria Newborn",
    "category": "BUNDLE",
    "serviceType": "BUNDLE",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "1 Ibu + 1 Bayi"
    },
    "durationMinutes": 100,
    "originalPrice": 190000,
    "promoPrice": 150000,
    "description": "[BUNDLE:moms-prenatal-massage,baby-massage-ceria-newborn] Pijat relaksasi ibu + Pijat Ceria Newborn dalam 1 sesi kunjungan bidan.",
    "isActive": true,
    "bundleItemIds": [
      "moms-prenatal-massage",
      "baby-massage-ceria-newborn"
    ]
  },
  {
    "id": "bundle-laktasi-oksitosin",
    "name": "Kala Bundle – Laktasi Booster (Breast + Oksitosin Punggung)",
    "category": "BUNDLE",
    "serviceType": "BUNDLE",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "Ibu Menyusui"
    },
    "durationMinutes": 80,
    "originalPrice": 200000,
    "promoPrice": 140000,
    "description": "[BUNDLE:moms-paket-laktasi,moms-oksitosin] Kombinasi breast care massage + pijat oksitosin punggung untuk booster kelancaran ASI maksimal.",
    "isActive": true,
    "bundleItemIds": [
      "moms-paket-laktasi",
      "moms-oksitosin"
    ]
  },
  {
    "id": "moms-laktasi-oksitosin-full",
    "name": "Kala Bundle – Laktasi Total (Breast + Oksitosin Full Body)",
    "category": "BUNDLE",
    "serviceType": "BUNDLE",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "Ibu Menyusui"
    },
    "durationMinutes": 100,
    "originalPrice": 250000,
    "promoPrice": 155000,
    "description": "[BUNDLE:moms-paket-laktasi,moms-oksitosin-fullbody] Breast care + pijat oksitosin seluruh badan (full body) untuk relaksasi total ibu menyusui.",
    "isActive": true,
    "bundleItemIds": [
      "moms-paket-laktasi",
      "moms-oksitosin-fullbody"
    ]
  },
  {
    "id": "add-on-sinar-moksa",
    "name": "Kala Terapi – Infrared (Sinar Moksa)",
    "category": "ADD_ON",
    "serviceType": "ADD_ON",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "Bayi & Anak"
    },
    "durationMinutes": 15,
    "originalPrice": 25000,
    "promoPrice": 15000,
    "description": "[ADDON] Terapi hangat infra merah/moksa alami untuk melegakan pernapasan batuk pilek dan menghangatkan tubuh.",
    "isActive": true,
    "isAddon": true
  },
  {
    "id": "add-on-nebulizer",
    "name": "Kala Terapi – Nebulizer Saline",
    "category": "ADD_ON",
    "serviceType": "ADD_ON",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "Bayi & Anak"
    },
    "durationMinutes": 20,
    "originalPrice": 45000,
    "promoPrice": 35000,
    "description": "[ADDON] Terapi inhalasi/penguapan dengan cairan saline steril untuk mengencerkan lendir dan dahak.",
    "isActive": true,
    "isAddon": true
  },
  {
    "id": "add-on-nebulizer-obat",
    "name": "Kala Terapi – Nebulizer + Obat",
    "category": "ADD_ON",
    "serviceType": "ADD_ON",
    "ageTier": {
      "minAgeMonths": 0,
      "maxAgeMonths": null,
      "label": "Bayi & Anak"
    },
    "durationMinutes": 20,
    "originalPrice": 60000,
    "promoPrice": 50000,
    "description": "[ADDON] Terapi inhalasi/penguapan dengan obat bronkodilator/pengencer dahak sesuai resep/indikasi dokter.",
    "isActive": true,
    "isAddon": true
  }
];

// Inisialisasi map katalog (default tenant)
export function loadServices() {
  const catalog = getTenantCatalog(DEFAULT_TENANT_ID);
  try {
    if (fs.existsSync(SERVICES_FILE)) {
      const data = fs.readFileSync(SERVICES_FILE, 'utf-8');
      const list: ClinicServiceItem[] = JSON.parse(data);
      catalog.clear();
      list.forEach((item) => catalog.set(item.id, item));
    } else {
      fs.writeFileSync(SERVICES_FILE, JSON.stringify(DEFAULT_CLINIC_SERVICES, null, 2));
      catalog.clear();
      DEFAULT_CLINIC_SERVICES.forEach((item) => catalog.set(item.id, item));
    }
  } catch (err) {
    console.error('Failed to load clinic services from file:', err);
    catalog.clear();
    DEFAULT_CLINIC_SERVICES.forEach((item) => catalog.set(item.id, item));
  }
}

export function saveServices() {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return true;
  }
  try {
    const catalog = getTenantCatalog(DEFAULT_TENANT_ID);
    const list = Array.from(catalog.values());
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

    const targetCatalog = getTenantCatalog(tenantId);
    targetCatalog.clear(); // ✅ HANYA menghapus cache milik tenant yang bersangkutan!

    if (dbServices.length > 0) {
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

        targetCatalog.set(s.service_id, {
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
          totalSessions: s.total_sessions ?? undefined,
          sessionScheduleType: s.session_schedule_type ?? undefined,
        });
      });
      return;
    }

    // Tidak ada data di DB -> seed dari file/default lalu simpan
    const source = Array.from(targetCatalog.values());
    if (source.length === 0) {
      console.warn(`[SEED] Catalog treatment kosong untuk tenant ${tenantId}; seeding dari DEFAULT_CLINIC_SERVICES (code default, ${DEFAULT_CLINIC_SERVICES.length} layanan). Set harga/layanan via admin API / DB untuk produksi.`);
      DEFAULT_CLINIC_SERVICES.forEach((item) => targetCatalog.set(item.id, item));
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
    const catalog = getTenantCatalog(tenantId);
    const list = Array.from(catalog.values());

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
  public getAllServices(onlyActive = true, tenantId: string = DEFAULT_TENANT_ID): ClinicServiceItem[] {
    const catalog = getTenantCatalog(tenantId);
    const list = Array.from(catalog.values());
    if (onlyActive) {
      return list.filter((s) => s.isActive);
    }
    return list;
  }

  /**
   * Mengambil detail layanan berdasarkan ID
   */
  public getServiceById(id: string, tenantId: string = DEFAULT_TENANT_ID): ClinicServiceItem | undefined {
    return getTenantCatalog(tenantId).get(id);
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
   * Resolusi durasi kanonis sebuah `treatment_detail` (Single Source of Truth).
   * Aturan (tanpa asumsi flat 60 menit, tanpa nama pasien):
   * 1. Tag eksplisit ([Total XXm], `= XXm]`, `[XXm]` terpisah, "NN menit") diprioritaskan.
   * 2. Teks gabungan (+, &, dan, koma) dipecah per item dan dicocokkan ke katalog
   *    tenant (durasi resmi per item; add-on tanpa buffer tambahan).
   * 3. Total = jumlah durasi item + buffer transisi 20 menit per kunjungan
   *    bila ada minimal satu layanan utama (selaras bukti DB
   *    "[Total 55m + Buffer 20m = 75m]" & STAFF_BUFFER 20m di reservation-core).
   */
  public resolveCanonicalDuration(treatmentDetail: string | null | undefined, tenantId: string = DEFAULT_TENANT_ID): number {
    return this.resolveDurationBreakdown(treatmentDetail, tenantId).totalMinutes;
  }

  /**
   * Rincian resolusi durasi (untuk keputusan tulis DB): membedakan item yang
   * benar-benar cocok katalog dari teks tak dikenali. `confident=false` berarti
   * angka total hanyalah estimasi tampilan dan TIDAK BOLEH dipersist sebagai
   * durasi resmi (anti-fabrikasi data).
   */
  public resolveDurationBreakdown(
    treatmentDetail: string | null | undefined,
    tenantId: string = DEFAULT_TENANT_ID
  ): { totalMinutes: number; matchedItemIds: string[]; unmatchedItems: string[]; usedExplicitTag: boolean; confident: boolean } {
    const fallback = { totalMinutes: 60, matchedItemIds: [] as string[], unmatchedItems: [] as string[], usedExplicitTag: false, confident: false };
    if (!treatmentDetail || typeof treatmentDetail !== 'string' || !treatmentDetail.trim()) return fallback;
    const raw = treatmentDetail.trim();
    const text = this.stripStructuredMetadata(raw);

    // 1. Tag eksplisit hasil perhitungan (paling otoritatif, dihitung dari katalog saat dibuat).
    const equalsMatch = text.match(/=\s*(\d+)\s*(?:m|menit|mins?)\b/i);
    if (equalsMatch && equalsMatch[1]) {
      const num = parseInt(equalsMatch[1], 10);
      if (!isNaN(num) && num > 0) return { totalMinutes: Math.min(480, num), matchedItemIds: [], unmatchedItems: [], usedExplicitTag: true, confident: true };
    }
    const totalBufferMatch = text.match(/Total\s*(\d+)\s*m?\s*\+\s*Buffer\s*(\d+)\s*m?/i);
    if (totalBufferMatch && totalBufferMatch[1] && totalBufferMatch[2]) {
      const pure = parseInt(totalBufferMatch[1], 10);
      const buf = parseInt(totalBufferMatch[2], 10);
      if (!isNaN(pure) && !isNaN(buf) && pure + buf > 0) return { totalMinutes: Math.min(480, pure + buf), matchedItemIds: [], unmatchedItems: [], usedExplicitTag: true, confident: true };
    }
    const totalMatch = text.match(/\[\s*Total\s*(\d+)\s*(?:m|menit|mins?)\b/i);
    if (totalMatch && totalMatch[1]) {
      const num = parseInt(totalMatch[1], 10);
      if (!isNaN(num) && num > 0) return { totalMinutes: Math.min(480, num), matchedItemIds: [], unmatchedItems: [], usedExplicitTag: true, confident: true };
    }
    const bracketMatches = text.match(/\[\s*(\d+)\s*(?:m|menit|mins?)\b/gi);
    if (bracketMatches && bracketMatches.length > 0) {
      let sum = 0;
      for (const b of bracketMatches) {
        const num = parseInt(b.replace(/\D/g, ''), 10);
        if (num > 0 && num <= 360) sum += num;
      }
      if (sum > 0) return { totalMinutes: Math.min(480, sum), matchedItemIds: [], unmatchedItems: [], usedExplicitTag: true, confident: true };
    }
    const minMatches = text.match(/(\d+)\s*(?:menit|mins?|m\b)/gi);
    if (minMatches && minMatches.length > 0) {
      let sum = 0;
      for (const m of minMatches) {
        const num = parseInt(m.replace(/\D/g, ''), 10);
        if (num > 0 && num <= 360) sum += num;
      }
      if (sum > 0) return { totalMinutes: Math.min(480, sum), matchedItemIds: [], unmatchedItems: [], usedExplicitTag: true, confident: true };
    }

    const items = this.splitTopLevelItems(text);
    if (items.length === 0) return { ...fallback, totalMinutes: 60 };

    const VISIT_BUFFER_MINUTES = 20;
    interface ResolvedItem { id: string; durationMinutes: number; isAddon: boolean; isBundle: boolean; componentIds: string[] }
    const matchedServices: ResolvedItem[] = [];
    const unmatchedItems: string[] = [];

    for (const item of items) {
      const matched = this.matchCatalogItem(item, tenantId);
      if (matched) {
        matchedServices.push({
          id: matched.id,
          durationMinutes: matched.durationMinutes,
          isAddon: this.isAddonService(matched),
          isBundle: this.isBundleService(matched),
          componentIds: matched.bundleItemIds || [],
        });
      } else if (this.isAddonKeyword(item)) {
        // Keyword add-on tanpa entri katalog: hanya durasi add-on, tanpa buffer kunjungan.
        matchedServices.push({
          id: item.toLowerCase().includes('nebulizer') ? '__addon_nebulizer__' : '__addon_generic__',
          durationMinutes: item.toLowerCase().includes('nebulizer') ? 20 : 15,
          isAddon: true,
          isBundle: false,
          componentIds: [],
        });
      } else {
        unmatchedItems.push(item);
      }
    }

    // Anti double-count: (a) id duplikat dihitung sekali; (b) komponen bundle yang
    // juga tampil sebagai item mandiri dibuang karena durasinya sudah termasuk bundle.
    const unique: ResolvedItem[] = [];
    const seenIds = new Set<string>();
    for (const s of matchedServices) {
      if (seenIds.has(s.id)) continue;
      seenIds.add(s.id);
      unique.push(s);
    }
    const bundleComponentIds = new Set<string>();
    for (const s of unique) {
      if (s.isBundle) for (const cid of s.componentIds) bundleComponentIds.add(cid);
    }
    const resolved = unique.filter((s) => !bundleComponentIds.has(s.id));

    let sum = 0;
    let hasMain = false;
    let hasBundle = false;
    for (const s of resolved) {
      sum += s.durationMinutes;
      if (s.isBundle) hasBundle = true;
      else if (!s.isAddon) hasMain = true;
    }
    if (unmatchedItems.length > 0) {
      sum += unmatchedItems.length * 60;
      hasMain = true;
    }

    // Buffer kunjungan hanya untuk layanan utama non-bundle (bundle = durasi penuh kunjungan).
    if (hasMain && !hasBundle) sum += VISIT_BUFFER_MINUTES;
    const totalMinutes = Math.min(480, Math.max(15, sum));
    return {
      totalMinutes,
      matchedItemIds: resolved.map((s) => s.id),
      unmatchedItems,
      usedExplicitTag: false,
      confident: resolved.length > 0 && unmatchedItems.length === 0,
    };
  }


  /**
   * Buang metadata audiens dari format `treatment_detail` DB
   * ("Baby: X (Bayi: nama, Usia: y) | Moms: Z (Kehamilan: w)").
   */
  public stripStructuredMetadata(text: string): string {
    let s = text;
    for (let i = 0; i < 3; i++) {
      s = s.replace(/\(\s*(?:bayi|anak|pasien|kehamilan|usia)\s*:[^()]*\)/gi, ' ');
    }
    s = s.replace(/\b(?:baby|moms|kids|combination|pasien|bayi|anak|balita)\s*:/gi, ' ');
    s = s.replace(/\|/g, ' + ');
    return s.replace(/\s+/g, ' ').trim();
  }

  /** Pecah item pada pemisah + , & dan — HANYA di kedalaman tanda kurung 0. */
  public splitTopLevelItems(text: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      if (depth === 0) {
        if (ch === '+' || ch === ',' || ch === '&') {
          out.push(current);
          current = '';
          continue;
        }
        if (ch === ' ') {
          const rest = text.slice(i).toLowerCase();
          if (/^ dan\s/.test(rest)) {
            out.push(current);
            current = '';
            i += 3;
            continue;
          }
        }
      }
      current += ch;
    }
    out.push(current);
    return out.map((s) => s.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim()).filter((s) => s.length > 2);
  }

  /**
   * Pencocokan satu item teks ke katalog tenant (normalisasi alfanumerik +
   * buang token add-on agar "Sinar Moksa" cocok ke "Sinar Moksa (Add-on)").
   */
  /**
   * Pencocokan keyakinan (dipakai resolusi durasi). Kandidat harus memuat SEMUA
   * token bermakna item (isi kurung & alias linguistik dinormalisasi); pemenang =
   * surplus token paling sedikit (paling spesifik), tie-break non-bundle.
   *
   * Sifat yang diinginkan: tahan urutan kata ("Pijat Ceria Bayi" → "Pijat Bayi
   * Ceria") dan menolak fragmen acak ("breast" tidak mengunci bundle besar).
   * Double-count dicegah di pemanggil dengan pemisah item yang benar (`splitTopLevelItems`).
   */
  // Fase 3R: helper tokenisasi generik (dipakai untuk nama + deskripsi)
  private catalogWordTokensRaw(text: string | null | undefined): Set<string> {
    const cleaned = (text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const alias: Record<string, string> = {
      rileksasi: 'relaksasi', rileks: 'relaksasi', pijet: 'pijat', moxa: 'moksa',
      kidz: 'kids', baby: 'bayi', oksitoksin: 'oksitosin', oksifull: 'oksitosin', therapist: 'terapi',
    };
    const stop = new Set(['addon', 'add', 'on', 'dan', 'the', 'paket', 'spa', 'treatment', 'layanan']);
    return new Set(cleaned.split(' ').map((w) => alias[w] || w).filter((w) => w.length >= 3 && !stop.has(w) && !/^\d+$/.test(w)));
  }

  private getServiceCombinedTokens(s: ClinicServiceItem): Set<string> {
    const nameTokens = this.catalogWordTokensRaw(s.name);
    const descTokens = this.catalogWordTokensRaw(s.description || '');
    return new Set([...nameTokens, ...descTokens]);
  }

  public matchCatalogItem(itemText: string, tenantId: string = DEFAULT_TENANT_ID): ClinicServiceItem | undefined {
    const itemTokens = this.catalogWordTokens(itemText);
    // Butuh >= 2 token bermakna: kata tunggal generik ("breast", "body") tidak boleh
    // mengunci layanan utama (dicegah sebagai add-on / unmatched oleh pemanggil).
    if (itemTokens.size < 2) return undefined;
    const normItemKey = this.normalizeCatalogKey(itemText);
    let best: ClinicServiceItem | undefined;
    let bestKey: [number, number, number] | undefined;
    for (const s of this.getAllServices(true, tenantId)) {
      // Fase 3R: data-driven — cocokkan terhadap gabungan nama + deskripsi klinis DB
      const svcTokens = this.getServiceCombinedTokens(s);
      if (svcTokens.size < itemTokens.size) continue;
      let containsAll = true;
      for (const t of itemTokens) {
        if (!svcTokens.has(t)) { containsAll = false; break; }
      }
      if (!containsAll) continue;
      // Prioritas 1: teks item adalah bagian nama katalog utuh (mis. "Prenatal Massage"
      // ⊂ "Prenatal Massage (Pijat Hamil)") — paling dapat dipercaya.
      // Fase 3R: penalti bundle sebelum surplus agar "pijet bapil" → Pulih Ceria (STANDARD) bukan bundle hemat.
      const normSvc = this.normalizeCatalogKey(this.stripParenthetical(s.name));
      const isNamedSubset = normItemKey.length >= 4 && normSvc.includes(normItemKey);
      const isAddon = (s as any).isAddon || s.category === 'ADD_ON';
      const surplus = svcTokens.size - itemTokens.size + (isAddon ? 100 : 0);
      const bundlePenalty = s.category === 'BUNDLE' ? 1 : 0;
      const key: [number, number, number] = [isNamedSubset ? 0 : 1, bundlePenalty, surplus];
      if (!bestKey || key[0] < bestKey[0] ||
          (key[0] === bestKey[0] && key[1] < bestKey[1]) ||
          (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] < bestKey[2])) {
        bestKey = key;
        best = s;
      }
    }
    return best;
  }

  /** Buang isi tanda kurung dari nama layanan sebelum pencocokan substring. */
  private stripParenthetical(name: string | null | undefined): string {
    return (name || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Token kata bermakna dari nama layanan: buang isi kurung, token add-on, kata
   * pendek, dan normalisasi alias linguistik (typo/varian lazim customer).
   */
  private catalogWordTokens(name: string | null | undefined): Set<string> {
    const cleaned = (name || '')
      .toLowerCase()
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ');
    const alias: Record<string, string> = {
      rileksasi: 'relaksasi',
      rileks: 'relaksasi',
      pijet: 'pijat',
      moxa: 'moksa',
      kidz: 'kids',
      baby: 'bayi',
      oksitoksin: 'oksitosin',
      oksifull: 'oksitosin',
      therapist: 'terapi',
    };
    const stop = new Set(['addon', 'add', 'on', 'dan', 'the', 'paket', 'spa', 'treatment', 'layanan', 'kala']);

    // Catatan: "massage" DIPERTAHANKAN sebagai token bermakna (mis. membedakan
    // "Prenatal Massage" dari "Prenatal Yoga").
    return new Set(
      cleaned
        .split(' ')
        .map((w) => alias[w] || w)
        .filter((w) => w.length >= 3 && !stop.has(w) && !/^\d+$/.test(w))
    );
  }

  private normalizeCatalogKey(name: string | null | undefined): string {
    return (name || '')
      .toLowerCase()
      .replace(/^kala\s+(?:baby|kids|mom|bundle|terapi)?\s*[–-]?\s*/gi, '')
      .replace(/\(add-?on\)|\[add-?on\]/g, '')
      .replace(/[^a-z0-9]/g, '')
      .replace(/addon/g, '')
      .replace(/kala/g, '');
  }

  private isAddonKeyword(itemText: string): boolean {
    const lower = (itemText || '').toLowerCase();
    return lower.includes('moksa') || lower.includes('moxa') || lower.includes('cukur') ||
      lower.includes('tindik') || lower.includes('nebulizer') || lower.includes('add-on') ||
      lower.includes('addon');
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
    if (category === 'BOTH') {
      // Fondasional: BOTH = union ibu+anak — tidak ada layanan berkategori BOTH di DB
      return this.getAllServices().filter((s) => s.category === 'BABY' || s.category === 'KIDS' || s.category === 'MOMS' || s.category === 'BUNDLE' || s.category === 'BOTH');
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
    getTenantCatalog(tenantId).set(service.id, service);
    // Also sync default alias if tenant is default
    if (tenantId === DEFAULT_TENANT_ID) serviceCatalog.set(service.id, service);
    saveServices();
    // Fire-and-forget sinkronisasi ke DB (SaaS-ready)
    saveServicesToDb(tenantId).catch((e) => console.warn('[TREATMENT CATALOG] upsert DB sync failed:', (e as Error).message));
    return service;
  }

  /**
   * Menghapus layanan (sync ke DB per tenant)
   */
  public deleteService(id: string, tenantId: string = 'default-tenant'): boolean {
    const deleted = getTenantCatalog(tenantId).delete(id);
    if (tenantId === DEFAULT_TENANT_ID) serviceCatalog.delete(id);
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
      audienceIntent?: 'BABY' | 'KIDS' | 'MOMS' | 'BOTH' | 'GENERAL';
      isMaternalKeyword?: boolean;
    }
  ): ClinicServiceItem[] {
    const { ageMonths, audienceIntent, isMaternalKeyword } = context;
    // Plan regresi Fase 2: klasifikasi bundle dari KOMPOSISI komponen
    // (data katalog per-tenant), bukan hafalan substring ID. Lookup dibangun
    // dari array services yang sedang difilter — layanan baru otomatis ikut.
    const byId = new Map((services || []).map((s) => [(s?.id || '').toLowerCase(), s]));
    const audienceOf = (s: ClinicServiceItem): ServiceAudience =>
      resolveServiceAudience(s, (id) => byId.get(id));
    const isMomBundle = (s: ClinicServiceItem): boolean => audienceOf(s) === 'MOMS';

    // 1. Context Kehamilan / Maternal / Ibu Hamil / Nifas
    if (audienceIntent === 'MOMS' || isMaternalKeyword) {
      return services.filter(
        (s) => s.category === 'MOMS' || s.category === 'BOTH' || (s.category === 'BUNDLE' && isMomBundle(s))
      );
    }

    // 2. Context Usia Anak / Bayi (dalam bulan)
    if (ageMonths != null && ageMonths > 0) {
      return services.filter((s) => {
        // Blokir mutlak kategori MOMS (termasuk bundle ber-audiens ibu)
        // jika mencari untuk anak.
        if (s.category === 'MOMS') return false;
        if (s.category === 'BUNDLE' && isMomBundle(s)) return false;

        const minAge = s.ageTier?.minAgeMonths ?? 0;
        const maxAge = s.ageTier?.maxAgeMonths ?? null;

        if (ageMonths < minAge) return false;
        if (maxAge !== null && ageMonths > maxAge) return false;

        if (ageMonths >= CHILD_CATEGORY_AGE_THRESHOLD_MONTHS) {
          // Usia anak >= 2 tahun (24 bulan)
          return s.category === 'KIDS' || s.category === 'BOTH' || (s.category === 'BUNDLE' && !isMomBundle(s)) || (s.category === 'BABY' && (maxAge === null || maxAge >= ageMonths));
        } else {
          // Usia bayi < 2 tahun
          return s.category === 'BABY' || s.category === 'BOTH' || (s.category === 'BUNDLE' && !isMomBundle(s));
        }
      });
    }

    // 3. Audience KIDS
    if (audienceIntent === 'KIDS') {
      return services.filter((s) => s.category === 'KIDS' || s.category === 'BOTH' || (s.category === 'BUNDLE' && !isMomBundle(s)));
    }

    // 4. Audience BABY
    if (audienceIntent === 'BABY') {
      return services.filter(
        (s) => s.category === 'BABY' || s.category === 'BOTH' || s.category === 'ADD_ON' || (s.category === 'BUNDLE' && !isMomBundle(s))
      );
    }

    // 5. Audience BOTH (fondasional: union ibu+anak, bukan fallthrough)
    if (audienceIntent === 'BOTH') {
      return services.filter(
        (s) => s.category === 'BABY' || s.category === 'KIDS' || s.category === 'MOMS' || s.category === 'BOTH' || s.category === 'BUNDLE' || s.category === 'ADD_ON'
      );
    }

    return services;
  }

  /**
   * Rekomendasi dinamis berdasarkan gejala/keluhan: cocokkan token gejala ke
   * `${name} ${description}` seluruh layanan aktif (isActive). Skor nama +4,
   * deskripsi +2. Filter usia bila diketahui. Nilai tertinggi menang.
   * Zero-Code Admin: layanan baru otomatis ikut tanpa koding.
   */
  public recommendServiceBySymptoms(
    symptoms: string[],
    ageMonths?: number | null,
    category?: TreatmentCategoryType,
    tenantId: string = DEFAULT_TENANT_ID
  ): ClinicServiceItem | undefined {
    const rawText = (symptoms || []).join(' ').toLowerCase();
    const tokens = rawText
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2);
    if (tokens.length === 0) return undefined;
    let pool = this.getAllServices(true, tenantId);
    if (category) {
      if (category === 'BOTH') {
        // Fondasional: BOTH = union ibu+anak, bukan filter kategori 'BOTH' (tidak ada layanan BOTH di DB)
        pool = pool.filter((s) => s.category === 'BABY' || s.category === 'KIDS' || s.category === 'MOMS' || s.category === 'BUNDLE' || s.category === 'BOTH');
      } else {
        pool = pool.filter((s) => s.category === category || s.category === 'BOTH');
      }
    }
    if (ageMonths != null && ageMonths > 0) {
      pool = this.filterServicesByAudience(pool, { ageMonths });
    }
    pool = pool.filter((s) => s.isActive);
    if (pool.length === 0) return undefined;

    const CORE_COMPLAINT_NOUNS = new Set([
      'makan', 'lahap', 'gtm', 'asi', 'menyusu',
      'bab', 'sembelit', 'feses', 'konstipasi',
      'batuk', 'pilek', 'bapil', 'flu', 'dahak', 'lendir', 'grok',
      'kembung', 'kolik', 'begah', 'gas',
      'tidur', 'rewel', 'begadang', 'terjaga',
      'pegal', 'relaksasi', 'lelah', 'capek',
    ]);
    const CLINICAL_MODIFIERS = new Set([
      'susah', 'kurang', 'tidak', 'sering', 'jarang', 'agak', 'mulai', 'berat',
    ]);

    let best: ClinicServiceItem | undefined;
    let bestScore = 0;
    for (const item of pool) {
      const nameLower = item.name.toLowerCase();
      const descLower = (item.description || '').toLowerCase();
      const haystack = `${nameLower} ${descLower}`;
      let score = 0;

      for (const tok of tokens) {
        // Generic "anak" DILARANG membajak skor usia spesifik bila usia belum diketahui
        if (tok === 'anak' && (ageMonths == null || ageMonths <= 0)) continue;
        if (nameLower.includes(tok)) score += 4;
        else if (descLower.includes(tok)) score += 2;
      }

      for (const tok of tokens) {
        if (tok === 'anak' && (ageMonths == null || ageMonths <= 0)) continue;
        if (CORE_COMPLAINT_NOUNS.has(tok)) {
          if (haystack.includes(tok)) score += 4;
        } else if (!CLINICAL_MODIFIERS.has(tok)) {
          if (haystack.includes(tok)) score += 3;
        } else {
          if (haystack.includes(tok)) score += 1;
        }
      }

      const phrasePatterns = [
        'susah makan', 'sulit makan', 'gtm', 'anak gtm',
        'susah bab', 'nafsu makan', 'tidak nafsu makan',
        'susah tidur', 'kembung perut', 'batuk pilek', 'batuk dahak',
        'rewel menangis', 'pegal lelah', 'pilek flu',
      ];
      // Audit simulator (Bapil -> Cukur Selapan): normalisasi tanda baca agar
      // "batuk, pilek" (koma di deskripsi katalog) tetap cocok dengan frasa
      // "batuk pilek". Normalisasi teknis tanda baca, bukan hafalan semantik.
      const normText = rawText.replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
      const normHaystack = haystack.replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
      for (const phrase of phrasePatterns) {
        if (normText.includes(phrase) && normHaystack.includes(phrase)) {
          score += 8;
        }
      }

      // Clinical dominance (keputusan user): keluhan medis MURNI tanpa indikasi
      // cukur/rambut/tindik/paket → terapi tunggal WAJIB menang atas kombo.
      // Paket kombo (BUNDLE) didenda; terapi tunggal penanda-terapi dibonus —
      // keduanya murni dari metadata katalog (category/nama), tanpa daftar nama.
      const wantsShaveOrBundle = /(cukur|rambut|gundul|tindik|paket|selapan)/.test(normText);
      const isBundleService = (item.category || '').toUpperCase() === 'BUNDLE'
        || /paket|\+/.test(nameLower);
      if (!wantsShaveOrBundle && isBundleService) {
        score -= 10;
      }
      const isSingleTherapy = (item.category === 'BABY' || item.category === 'KIDS')
        && /terapi|pulih/.test(nameLower);
      if (isSingleTherapy && tokens.some((t) => CORE_COMPLAINT_NOUNS.has(t) && normHaystack.includes(t))) {
        score += 5;
      }

      if (score > bestScore) { bestScore = score; best = item; }
      else if (score === bestScore && score > 0 && best) {
        const bestIsKids = (best.category || '').toUpperCase() === 'KIDS';
        const itemIsBaby = (item.category || '').toUpperCase() === 'BABY';
        if (bestIsKids && itemIsBaby && (ageMonths == null || ageMonths <= 0)) {
          best = item;
        }
      }
    }
    return bestScore > 0 ? best : undefined;
  }

  /** Paket relaksasi umum untuk bayi sehat (tanpa keluhan): ambil layanan BABY/KIDS relaksasi pertama, filter usia bila tersedia (391501 Fase 2). */
  public getDefaultRelaxationService(
    category?: TreatmentCategoryType,
    ageMonthsOrTenantId?: number | string | null,
    tenantId: string = DEFAULT_TENANT_ID
  ): ClinicServiceItem | undefined {
    // Backward-compat: panggilan lama getDefaultRelaxationService(cat, tenantIdString)
    let ageMonths: number | null = null;
    let resolvedTenantId = tenantId;
    if (typeof ageMonthsOrTenantId === 'string') {
      resolvedTenantId = ageMonthsOrTenantId;
    } else if (typeof ageMonthsOrTenantId === 'number' && Number.isFinite(ageMonthsOrTenantId)) {
      ageMonths = ageMonthsOrTenantId;
    }
    // Jika argumen ke-3 disediakan sebagai tenantId eksplisit, pakai itu.
    if (typeof tenantId === 'string' && tenantId !== DEFAULT_TENANT_ID && typeof ageMonthsOrTenantId === 'number') {
      resolvedTenantId = tenantId;
    }
    let pool = this.getAllServices(true, resolvedTenantId).filter((s) => s.isActive);
    // Plan Fase 2.3 + Fase 1 BOTH: kategori difilter data-driven, BOTH = union ibu+anak
    if (category === 'MOMS') {
      pool = pool.filter((s) => s.category === 'MOMS' || s.category === 'BOTH');
    } else if (category === 'KIDS') {
      pool = pool.filter((s) => s.category === 'KIDS' || s.category === 'BOTH');
    } else if (category === 'BABY') {
      pool = pool.filter((s) => s.category === 'BABY' || s.category === 'BOTH');
    } else if (category === 'BOTH') {
      // Fondasional: BOTH = union — tidak boleh jatuh ke pool BABY saja (regresi ibu dapat rekomendasi bayi)
      pool = pool.filter((s) => s.category === 'BABY' || s.category === 'KIDS' || s.category === 'MOMS' || s.category === 'BUNDLE' || s.category === 'BOTH');
    }
    // 391501: saring usia data-driven bila tersedia
    if (ageMonths != null && Number.isFinite(ageMonths)) {
      const filtered = pool.filter((s) => {
        const min = s.ageTier?.minAgeMonths ?? 0;
        const max = s.ageTier?.maxAgeMonths;
        if (ageMonths! < min) return false;
        if (max != null && ageMonths! > max) return false;
        return true;
      });
      if (filtered.length > 0) pool = filtered;
    }
    // Heuristik nama (data-driven dari pool yang sudah terfilter kategori):
    // "relaks" untuk ibu, "ceria" non-terapi untuk bayi; fallback aman = pool[0]
    // (pool sudah benar kategorinya — TIDAK ADA lagi fallback memaksa BABY).
    return pool.find((s) => s.name.toLowerCase().includes('relaks') && !s.name.toLowerCase().includes('pulih'))
      || pool.find((s) => s.name.toLowerCase().includes('prenatal massage'))
      || pool.find((s) => s.name.toLowerCase().includes('ceria') && !s.name.toLowerCase().includes('pulih'))
      || pool[0];
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
      audienceIntent = PatientProfileExtractor.resolveChildAgeCategory(ageMonths) ?? 'GENERAL';
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
      const unbrandedName = cleanName.replace(/^kala\s+(?:baby|kids|mom|bundle|terapi)\s*[–-]\s*/i, '').trim();
      const fullName = s.name.toLowerCase();
      const parenMatch = s.name.match(/\(([^)]+)\)/);
      const parenAlias = parenMatch ? parenMatch[1].toLowerCase().trim() : '';
      const nameParts = cleanName.split(/\s+/);
      const unbrandedParts = unbrandedName.split(/\s+/);

      if (
        q.includes(cleanName) ||
        fullName.includes(q.trim()) ||
        (q.length >= 4 && cleanName.includes(q.trim())) ||
        (unbrandedName.length >= 4 && (q.includes(unbrandedName) || unbrandedName.includes(q.trim()))) ||
        (parenAlias.length >= 4 && (q.includes(parenAlias) || parenAlias.includes(q.trim()))) ||
        (q.includes('newborn') && cleanName.includes('selapan'))
      ) {
        exactMatches.push(s);
      } else if (nameParts.length >= 2 || unbrandedParts.length >= 2) {
        const twoWordPhrase = nameParts.length >= 2 ? `${nameParts[0]} ${nameParts[1]}` : '';
        const unbrandedTwoWord = unbrandedParts.length >= 2 ? `${unbrandedParts[0]} ${unbrandedParts[1]}` : '';
        if ((twoWordPhrase.length >= 5 && q.includes(twoWordPhrase)) || (unbrandedTwoWord.length >= 5 && q.includes(unbrandedTwoWord))) {
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
        if (ageMonths >= CHILD_CATEGORY_AGE_THRESHOLD_MONTHS) {
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
      'saya', 'untuk', 'buat', 'bikin', 'bagi', 'guna', 'dengan', 'dan', 'atau', 'dari', 'ke', 'di', 'ada', 'bisa', 'mau', 'ingin', 'bagaimana',
      'kenapa', 'apakah', 'treatment', 'perawatan', 'tentang', 'info', 'informasi', 'detail', 'tolong',
      'ciri', 'cirinya', 'khasiat', 'manfaat', 'fungsi', 'fungsinya', 'sih', 'nih', 'lho', 'kan',
      'juga', 'saja', 'aja', 'semua', 'daftar', 'list', 'please',
      'pijat', // generic, semua treatment ada kata "pijat" → skip dari scoring
      'kala',
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

    const strippedQ = q.replace(/\b(ini|itu|sini|situ|mana|gimana|apa|ya|bund|bunda|bun|berapa|dong|kak|min|mbak|mas)\b/gi, '').replace(/[^a-z0-9\s]/gi, '').trim();

    // 1. PRIORITAS UTAMA: Exact Phrase Match pada Nama Treatment
    // Jika customer sebut nama treatment spesifik (misal "pijat bayi ceria"), kembalikan HANYA 1 treatment itu.
    let exactNameMatch = services.find((s) => {
      // Ambil nama tanpa kurung, misal "Pijat Bayi Ceria (Rileksasi)" -> "pijat bayi ceria"
      const cleanName = s.name.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
      const unbrandedName = cleanName.replace(/^kala\s+(?:baby|kids|mom|bundle|terapi)\s*[–-]\s*/i, '').trim();
      return (
        (cleanName.length >= 4 && q.includes(cleanName)) ||
        (strippedQ.length >= 4 && cleanName.includes(strippedQ)) ||
        (unbrandedName.length >= 4 && q.includes(unbrandedName)) ||
        (strippedQ.length >= 4 && unbrandedName.includes(strippedQ))
      );
    });

    if (!exactNameMatch) {
      exactNameMatch = this.matchCatalogItem(strippedQ || q);
    }

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
      'saya', 'untuk', 'buat', 'bikin', 'bagi', 'guna', 'dengan', 'dan', 'atau', 'dari', 'ke', 'di', 'ada', 'bisa', 'mau', 'ingin', 'bagaimana',
      'kenapa', 'apakah', 'treatment', 'perawatan', 'tentang', 'info', 'informasi', 'detail', 'tolong',
      'ciri', 'cirinya', 'khasiat', 'manfaat', 'fungsi', 'fungsinya', 'sih', 'nih', 'lho', 'kan',
      'juga', 'saja', 'aja', 'semua', 'daftar', 'list', 'please',
      'pijat', // generic, semua treatment ada kata "pijat" → skip dari scoring
      'kala',
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

  /**
   * Menghasilkan ringkasan durasi dinamis dari seluruh layanan aktif
   */
  public getServiceDurationSummary(): string {
    const services = this.getAllServices().filter((s) => s.isActive && !s.isAddon);
    return services
      .map((s) => `  * ${s.name} (${s.ageTier.label}): ~${s.durationMinutes} menit`)
      .join('\n');
  }

  /**
   * Pencocokan nominal harga (sesi 973126, data-driven tenant-aware):
   * kembalikan layanan aktif yang harga promo ATAU harga normalnya sama
   * dengan targetPrice (toleransi opsional, default exact-match).
   * Sumber 100% dari katalog DB per-tenant — tanpa daftar harga hafalan.
   */
  public findServicesByPrice(
    targetPrice: number,
    tolerance = 0,
    tenantId: string = DEFAULT_TENANT_ID
  ): ClinicServiceItem[] {
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) return [];
    const tol = Number.isFinite(tolerance) && tolerance >= 0 ? tolerance : 0;
    return this.getAllServices(true, tenantId).filter((s) => {
      const promoHit = typeof s.promoPrice === 'number'
        && Math.abs(s.promoPrice - targetPrice) <= tol;
      const normalHit = typeof s.originalPrice === 'number'
        && Math.abs(s.originalPrice - targetPrice) <= tol;
      return promoHit || normalHit;
    });
  }

  /**
   * Mencocokkan keluhan gejala customer ke layanan yang relevan di katalog secara dinamis
   */
  public matchServicesBySymptoms(symptoms: string[]): ClinicServiceItem[] {
    if (!symptoms || symptoms.length === 0) return [];
    const all = this.getAllServices().filter((s) => s.isActive && !s.isAddon);
    const symLower = symptoms.map((s) => s.toLowerCase());
    // Plan regresi Fase 2: lookup komposisi bundle dari data katalog —
    // pengganti hafalan `name.includes('laktasi')`.
    const byIdSym = new Map(all.map((s) => [(s?.id || '').toLowerCase(), s]));
    const audienceOfSym = (s: ClinicServiceItem): ServiceAudience =>
      resolveServiceAudience(s, (id) => byIdSym.get(id));

    const scored = all.map((service) => {
      let score = 0;
      const text = `${service.name} ${service.description}`.toLowerCase();
      for (const sym of symLower) {
        if (text.includes(sym)) score += 2;
        if (sym.includes('batuk') || sym.includes('pilek') || sym.includes('flu') || sym.includes('grok')) {
          if (service.name.toLowerCase().includes('pulih')) score += 3;
        }
        if (sym.includes('nafsu') || sym.includes('gtm') || sym.includes('makan')) {
          if (service.name.toLowerCase().includes('lahap')) score += 3;
        }
        if (sym.includes('laktasi') || sym.includes('asi') || sym.includes('oksitosin')) {
          if (service.category === 'MOMS' || audienceOfSym(service) === 'MOMS') score += 3;
        }
      }
      return { service, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.service);
  }
}

export const treatmentCatalogService = new TreatmentCatalogService();
