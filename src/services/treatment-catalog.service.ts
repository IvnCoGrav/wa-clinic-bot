import fs from 'fs';
import path from 'path';

export type TreatmentCategoryType = 'BABY' | 'KIDS' | 'MOMS' | 'BOTH';

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
    ageTier: { minAgeMonths: 0, maxAgeMonths: 24, label: '0 - 24 Bulan' },
    durationMinutes: 40,
    originalPrice: 90000,
    promoPrice: 70000,
    description: 'Pijat terapi khusus bayi flu, batuk, pilek, rewel, susah BAB, kembung atau kolik dengan menggunakan double aromaterapi dan titik pijat khusus.',
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
   * Filter layanan bayi/anak berdasarkan usia (dalam bulan)
   */
  public getServicesByAge(ageInMonths: number): ClinicServiceItem[] {
    return this.getAllServices().filter((s) => {
      if (s.category === 'MOMS') return false;
      const { minAgeMonths, maxAgeMonths } = s.ageTier;
      if (ageInMonths < minAgeMonths) return false;
      if (maxAgeMonths !== null && ageInMonths > maxAgeMonths) return false;
      return true;
    });
  }

  /**
   * Menambahkan atau meng-update data layanan baru
   */
  public upsertService(service: ClinicServiceItem): ClinicServiceItem {
    serviceCatalog.set(service.id, service);
    saveServices();
    return service;
  }

  /**
   * Menghapus layanan
   */
  public deleteService(id: string): boolean {
    const deleted = serviceCatalog.delete(id);
    if (deleted) {
      saveServices();
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
   * Mencari treatment yang relevan dengan pertanyaan customer berdasarkan kata kunci.
   * Return daftar layanan yang nama/deskripsinya mengandung kata kunci dari pertanyaan.
   * Scoring: match pada NAMA treatment diberi bobot lebih tinggi daripada match pada deskripsi.
   * Berguna agar bot TIDAK melempar seluruh katalog saat customer tanya satu treatment spesifik.
   */
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

    // Scoring: nama treatment +3, deskripsi +1, usia +0.5
    const scored = services
      .map((s) => {
        const nameLower = s.name.toLowerCase();
        const descLower = s.description.toLowerCase();
        const ageLower = s.ageTier.label.toLowerCase();
        let score = 0;
        for (const k of keywords) {
          if (nameLower.includes(k)) score += 3;
          if (descLower.includes(k)) score += 1;
          if (ageLower.includes(k)) score += 0.5;
        }
        return { s, score };
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
