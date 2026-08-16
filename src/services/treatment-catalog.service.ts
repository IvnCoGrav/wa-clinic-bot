import fs from 'fs';
import path from 'path';
import { parseAgeTextToMonths } from '../utils/age-calculator';
import { checkMedicalKeywords } from '../config/medical-keywords';

export type TreatmentCategoryType = 'BABY' | 'KIDS' | 'MOMS' | 'BOTH' | 'BUNDLE';

export interface AgeTier {
  minAgeMonths: number;        // Batas minimal usia (dalam bulan), misal 0
  maxAgeMonths: number | null; // Batas maksimal usia (dalam bulan), null jika tidak ada batas (misal > 24 bulan atau dewasa)
  label: string;               // Label deskriptif kelompok usia (misal: "0 - 6 Bulan", "> 24 Bulan", "Ibu Hamil / Nifas")
}

export interface ClinicServiceItem {
  id: string;                  // Identifier unik treatment, misal: "baby-massage-0-6"
  name: string;                // Nama layanan/treatment
  category: TreatmentCategoryType;
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
// Default data catalog
export const DEFAULT_CLINIC_SERVICES: ClinicServiceItem[] = [
  {
    id: 'baby-massage-ceria',
    name: 'Pijat Bayi Ceria (Rileksasi)',
    category: 'BABY',
    ageTier: { minAgeMonths: 0.5, maxAgeMonths: 24, label: 'Minimal 2 Minggu (0.5 - 24 Bulan)' },
    durationMinutes: 40,
    originalPrice: 80000,
    promoPrice: 60000,
    description: 'Pijat relaksasi minimal usia 2 minggu untuk membantu bayi tidur lebih nyenyak, mengurangi kelelahan, dan membuat tubuh bayi lebih rileks.',
    isActive: true,
  },
  {
    id: 'baby-massage-pulih-ceria',
    name: 'Pijat Bayi Pulih Ceria (Terapi Bapil / Kembung)',
    category: 'BABY',
    ageTier: { minAgeMonths: 0.5, maxAgeMonths: 24, label: 'Minimal 2 Minggu (0.5 - 24 Bulan)' },
    durationMinutes: 40,
    originalPrice: 90000,
    promoPrice: 70000,
    description: 'Pijat terapi minimal usia 2 minggu khusus bayi flu, batuk, pilek, rewel, susah BAB, kembung atau kolik dengan menggunakan double aromaterapi.',
    isActive: true,
  },
  {
    id: 'kids-massage-ceria',
    name: 'Pijat Kids Ceria',
    category: 'KIDS',
    ageTier: { minAgeMonths: 24, maxAgeMonths: 84, label: '2 - 7 Tahun' },
    durationMinutes: 45,
    originalPrice: 110000,
    promoPrice: 90000,
    description: 'Pijat relaksasi tubuh anak untuk mendukung pertumbuhan tulang dan otot yang sehat serta meredakan kelelahan setelah beraktivitas.',
    isActive: true,
  },
  {
    id: 'baby-massage-lahap-juara',
    name: 'Pijat Lahap Juara (Nafsu Makan)',
    category: 'BABY',
    ageTier: { minAgeMonths: 0, maxAgeMonths: 24, label: '0 - 24 Bulan' },
    durationMinutes: 40,
    originalPrice: 90000,
    promoPrice: 70000,
    description: 'Pijat khusus untuk membantu meningkatkan nafsu makan si kecil dan menjaga kebugaran tubuh.',
    isActive: true,
  },
  {
    id: 'baby-paket-selapan',
    name: 'Paket Selapan (Newborn Care)',
    category: 'BABY',
    ageTier: { minAgeMonths: 0, maxAgeMonths: 2, label: 'Newborn (0 - 40 Hari)' },
    durationMinutes: 45,
    originalPrice: 100000,
    promoPrice: 80000,
    description: 'Pijat khusus bayi baru lahir (newborn) usia 0-40 hari untuk merangsang pertumbuhan awal, kebugaran, dan relaksasi setelah lahir.',
    isActive: true,
  },
  {
    id: 'moms-prenatal-massage',
    name: 'Prenatal Massage (Pijat Hamil)',
    category: 'MOMS',
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Hamil (Trimester 2 & 3)' },
    durationMinutes: 60,
    originalPrice: 130000,
    promoPrice: 105000,
    description: 'Pijat aman khusus ibu hamil usia kandungan di atas 12 minggu untuk meredakan pegal di punggung, pinggang, kaki bengkak, serta mengurangi stres.',
    isActive: true,
  },
  {
    id: 'moms-oksitosin-fullbody',
    name: 'Oksitosin Massage Fullbody',
    category: 'MOMS',
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Pasca Melahirkan / Nifas' },
    durationMinutes: 60,
    originalPrice: 130000,
    promoPrice: 105000,
    description: 'Pijat punggung dan leher fullbody untuk membantu merangsang hormon oksitosin sehingga produksi ASI lebih lancar dan badan ibu lebih rileks.',
    isActive: true,
  },
  {
    id: 'moms-oksitosin-partial',
    name: 'Oksitosin Massage Non-Fullbody',
    category: 'MOMS',
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Menyusui' },
    durationMinutes: 40,
    originalPrice: 70000,
    promoPrice: 50000,
    description: 'Pijat punggung parsial untuk merangsang produksi ASI.',
    isActive: true,
  },
  {
    id: 'moms-paket-laktasi',
    name: 'Paket Laktasi (Breast Massage)',
    category: 'MOMS',
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Menyusui' },
    durationMinutes: 45,
    originalPrice: 100000,
    promoPrice: 80000,
    description: 'Pijat area payudara untuk memperlancar sumbatan ASI dan meningkatkan produksi ASI secara optimal.',
    isActive: true,
  },
  {
    id: 'moms-laktasi-oksitosin-full',
    name: 'Breast + Oksitoksin Fullbody Massage',
    category: 'MOMS',
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Ibu Menyusui / Nifas' },
    durationMinutes: 75,
    originalPrice: 190000,
    promoPrice: 155000,
    description: 'Paket kombinasi pijat laktasi (payudara) dan oksitosin massage fullbody untuk relaksasi maksimal dan kelancaran ASI.',
    isActive: true,
  },
  {
    id: 'baby-tindik',
    name: 'Tindik Telinga Bayi',
    category: 'BABY',
    ageTier: { minAgeMonths: 0, maxAgeMonths: 12, label: 'Bayi 0 - 12 Bulan' },
    durationMinutes: 15,
    originalPrice: 70000,
    promoPrice: 50000,
    description: 'Layanan tindik telinga bayi secara manual menggunakan anting steril langsung secara aman.',
    isActive: true,
  },
  {
    id: 'baby-cukur',
    name: 'Cukur Rambut Bayi',
    category: 'BABY',
    ageTier: { minAgeMonths: 0, maxAgeMonths: 12, label: 'Bayi 0 - 12 Bulan' },
    durationMinutes: 15,
    originalPrice: 25000,
    promoPrice: 15000,
    description: 'Layanan mencukur rambut bayi dengan alat steril / milik customer sendiri secara bersih.',
    isActive: true,
  },
  {
    id: 'baby-cukur-pijat-terapi',
    name: 'Cukur + Pijat Terapi',
    category: 'BABY',
    ageTier: { minAgeMonths: 0, maxAgeMonths: 12, label: 'Bayi 0 - 12 Bulan' },
    durationMinutes: 55,
    originalPrice: 115000,
    promoPrice: 85000,
    description: 'Paket hemat kombinasi cukur rambut bayi dan pijat terapi bayi.',
    isActive: true,
  },
  {
    id: 'add-on-sinar-moksa',
    name: 'Sinar Moksa (Add-on)',
    category: 'BOTH',
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Semua Usia' },
    durationMinutes: 15,
    originalPrice: 15000,
    promoPrice: 10000,
    description: 'Terapi tambahan sinar inframerah (moksa) hangat untuk membantu mengencerkan dahak, lendir ingus, dan melegakan pernapasan.',
    isActive: true,
  },
  {
    id: 'add-on-nebulizer',
    name: 'Nebulizer (Terapi Uap Add-on)',
    category: 'BABY',
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Semua Usia' },
    durationMinutes: 20,
    originalPrice: 50000,
    promoPrice: 35000,
    description: 'Terapi uap nebulizer tambahan untuk melegakan tenggorokan dan mengencerkan dahak.',
    isActive: true,
  },
  {
    id: 'add-on-nebulizer-obat',
    name: 'Nebulizer + Obat (Terapi Uap Lengkap)',
    category: 'BABY',
    ageTier: { minAgeMonths: 0, maxAgeMonths: null, label: 'Semua Usia' },
    durationMinutes: 20,
    originalPrice: 85000,
    promoPrice: 65000,
    description: 'Terapi uap nebulizer lengkap dengan obat khusus untuk meredakan batuk pilek dan sesak napas.',
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
        serviceCatalog.set(s.service_id, {
          id: s.service_id,
          name: s.name,
          category: s.category as TreatmentCategoryType,
          ageTier: {
            minAgeMonths: s.min_age_months,
            maxAgeMonths: s.max_age_months,
            label: s.age_label,
          },
          durationMinutes: s.duration_minutes,
          originalPrice: s.original_price,
          promoPrice: s.promo_price,
          description: s.description,
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
      data: list.map((s, idx) => ({
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
        description: s.description,
        is_active: s.isActive,
        sort_order: idx,
      })),
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
   * Filter layanan berdasarkan kategori ('BABY', 'KIDS', 'MOMS', 'BOTH')
   */
  public getServicesByCategory(category: TreatmentCategoryType): ClinicServiceItem[] {
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
        const priceLine = includePrice
          ? `  Harga Normal: Rp${s.originalPrice.toLocaleString('id-ID')} | Promo: Rp${s.promoPrice.toLocaleString('id-ID')}\n`
          : '';
        return `• *${s.name}*\n  Usia: ${s.ageTier.label}\n  Durasi: ${s.durationMinutes} menit\n${priceLine}  Deskripsi: ${s.description}`;
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
   * Cari treatment yang relevan dengan pertanyaan customer dan kembalikan array item terstruktur.
   * Logika scoring sama persis dengan searchCatalog (exact-name priority, lalu IDF keyword top-2),
   * TAPI mengembalikan data mentah — biarkan pembentuk jawaban (LLM/fallback) yang menyusun kalimat.
   */
  public searchCatalogItems(userText: string): ClinicServiceItem[] {
    const q = userText.toLowerCase();
    const services = this.getAllServices();

    // 1. Exact Phrase Match & Bigram Phrase Match pada Nama Treatment
    // Dipisahkan antara Exact Match (nama cocok utuh) dan Partial Match (2 kata awal cocok)
    // agar nama spesifik (misal "Pijat Bayi Pulih Ceria") tidak kalah/tercampur dengan nama yang lebih umum ("Pijat Bayi Ceria").
    const exactMatches: ClinicServiceItem[] = [];
    const partialMatches: ClinicServiceItem[] = [];

    for (const s of services) {
      if (!s.isActive) continue;
      const cleanName = s.name.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
      const nameParts = cleanName.split(/\s+/);

      if (q.includes(cleanName) || cleanName.includes(q.trim())) {
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
    const ageMonths = parseAgeTextToMonths(userText);
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
    };

    const stopwords = new Set([
      'yang', 'itu', 'apa', 'berapa', 'bung', 'bund', 'bunda', 'bun', 'ya', 'dong', 'kak', 'min', 'mbak', 'mas',
      'saya', 'untuk', 'dengan', 'dan', 'atau', 'dari', 'ke', 'di', 'ada', 'bisa', 'mau', 'ingin', 'bagaimana',
      'kenapa', 'apakah', 'treatment', 'perawatan', 'tentang', 'info', 'informasi', 'detail', 'tolong',
      'ciri', 'cirinya', 'khasiat', 'manfaat', 'fungsi', 'fungsinya', 'sih', 'nih', 'lho', 'kan', 'nih',
      'mau', 'dong', 'ya', 'bund', 'juga', 'saja', 'aja', 'semua', 'daftar', 'list', 'please', 'tolong',
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
      return q.includes(cleanName) || cleanName.includes(q.replace(/(itu|apa|ya|bund|bunda|berapa|dong|kak|min)\b/gi, '').trim());
    });

    if (exactNameMatch) {
      const priceLine = includePrice
        ? `  Harga Normal: Rp${exactNameMatch.originalPrice.toLocaleString('id-ID')} | Promo: Rp${exactNameMatch.promoPrice.toLocaleString('id-ID')}\n`
        : '';
      return `• *${exactNameMatch.name}*\n  Usia: ${exactNameMatch.ageTier.label}\n  Durasi: ${exactNameMatch.durationMinutes} menit\n${priceLine}  Deskripsi: ${exactNameMatch.description}`;
    }

    // 2. Fallback Keyword Scoring
    const stopwords = new Set([
      'yang', 'itu', 'apa', 'berapa', 'bung', 'bund', 'bunda', 'ya', 'dong', 'kak', 'min', 'mbak', 'mas',
      'saya', 'untuk', 'dengan', 'dan', 'atau', 'dari', 'ke', 'di', 'ada', 'bisa', 'mau', 'ingin', 'bagaimana',
      'kenapa', 'apakah', 'treatment', 'perawatan', 'tentang', 'info', 'informasi', 'detail', 'tolong',
      'ciri', 'cirinya', 'khasiat', 'manfaat', 'fungsi', 'fungsinya', 'sih', 'nih', 'lho', 'kan', 'nih',
      'mau', 'dong', 'ya', 'bund', 'juga', 'saja', 'aja', 'semua', 'daftar', 'list', 'please', 'tolong',
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
