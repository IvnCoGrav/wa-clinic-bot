import { treatmentCatalogService, ClinicServiceItem } from '../../services/treatment-catalog.service';
import { TEMPLATES } from '../../config/persona';

export interface GetCatalogInput {
  category?: 'BABY' | 'KIDS' | 'MOMS' | 'BOTH';
  childAgeMonths?: number;
  symptoms?: string[];
  specificTreatmentName?: string;
  /**
   * Sinyal intensi harga dari LLM (AI-First): true bila customer menanyakan
   * harga/biaya/tarif/ongkir/promo atau menyebutkan nominal ("60rb ya",
   * "harga berapa"). False bila hanya konsultasi keluhan / kecocokan usia.
   * Harga nominal HANYA dialirkan ke prompt bila true.
   */
  inquirePrice?: boolean;
}

export interface CatalogTreatmentDetail {
  id: string;
  name: string;
  category: string;
  durationMinutes: number;
  originalPrice: number;
  promoPrice: number;
  description: string;
  isRecommendedForSymptoms?: boolean;
}

export interface GetCatalogOutput {
  success: boolean;
  treatments: CatalogTreatmentDetail[];
  recommendationReason?: string;
  suggestedPriceReply?: string;
  message: string;
}

export const GET_CATALOG_TOOL_SCHEMA = {
  type: 'function',
  function: {
    name: 'get_catalog_and_price',
    description: 'Mengambil daftar layanan/treatment resmi, harga asli, harga promo, durasi, dan rekomendasi terapi yang tepat berdasarkan usia anak atau keluhan/gejala.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['BABY', 'KIDS', 'MOMS', 'BOTH'],
          description: 'Kategori sasaran treatment: BABY (0-24 bln), KIDS (2-10 thn), MOMS (Ibu hamil/nifas/relaksasi), atau BOTH (Paket Mom & Baby).'
        },
        childAgeMonths: {
          type: 'number',
          description: 'Usia bayi/anak dalam hitungan bulan jika diketahui (misal: 6 untuk 6 bulan, 0.5 untuk 2 minggu).'
        },
        symptoms: {
          type: 'array',
          items: { type: 'string' },
          description: 'Daftar keluhan bayi/anak yang disebutkan customer (misal: ["batuk", "pilek", "flu", "rewel", "nangis terus", "susah tidur", "kembung", "kolik", "susah makan"]).'
        },
        specificTreatmentName: {
          type: 'string',
          description: 'Nama treatment spesifik yang ditanyakan oleh customer (misal: "Pijat Bayi Ceria", "Pijat Bayi Pulih Ceria", "Cukur Rambut Bayi").'
        },
        inquirePrice: {
          type: 'boolean',
          description: 'Set true jika customer menanyakan harga/biaya/tarif/ongkir, bertanya promo, atau menyebutkan nominal angka tertentu (misal: "60rb ya", "harga berapa", "biayanya?"). Set false jika customer hanya berkonsultasi keluhan atau menanyakan kecocokan usia.'
        }
      }
    }
  }
};

export async function executeGetCatalog(input: GetCatalogInput): Promise<GetCatalogOutput> {
  const { category, childAgeMonths, symptoms = [], specificTreatmentName, inquirePrice } = input;
  // AI-First price grounding: nominal rupiah HANYA mengalir ke prompt LLM
  // bila LLM menilai customer butuh rincian harga (inquirePrice === true).
  const showPrices = inquirePrice === true;

  try {
    const allServices = treatmentCatalogService.getAllServices(true);
    let filtered: ClinicServiceItem[] = [...allServices];

    // 1. Filter kategori
    if (category) {
      filtered = filtered.filter(s => s.category === category || (category === 'BABY' && s.category === 'BUNDLE'));
    }

    // 2. Filter usia jika ada
    if (childAgeMonths !== undefined && childAgeMonths !== null) {
      filtered = filtered.filter(s => {
        const tier = s.ageTier;
        if (!tier) return true;
        if (tier.minAgeMonths > childAgeMonths) return false;
        if (tier.maxAgeMonths !== null && tier.maxAgeMonths < childAgeMonths) return false;
        return true;
      });
    }

    // 3. Pencarian nama spesifik jika customer menanyakan paket tertentu
    if (specificTreatmentName && specificTreatmentName.trim()) {
      const query = specificTreatmentName.toLowerCase();
      const matched = filtered.filter(s => s.name.toLowerCase().includes(query) || s.description.toLowerCase().includes(query));
      if (matched.length > 0) {
        filtered = matched;
      }
    }

    // 4. Rekomendasi berdasarkan keluhan / gejala
    let recommendationReason: string | undefined = undefined;
    const hasFluOrDigestiveSymptoms = symptoms.some(s => /flu|pilek|batuk|kembung|kolik|sembelit|susah bab|rewel|nangis terus/i.test(s));
    const hasSleepOrRelaxationInquiry = symptoms.some(s => /susah tidur|gelisah|lelah|capek/i.test(s));
    const hasEatingIssues = symptoms.some(s => /gtm|susah makan|nafsu makan/i.test(s));

    const formattedTreatments: CatalogTreatmentDetail[] = filtered.map(item => {
      let isRecommended = false;
      if (hasFluOrDigestiveSymptoms && item.id.includes('pulih-ceria')) {
        isRecommended = true;
      } else if (hasEatingIssues && item.id.includes('lahap-juara')) {
        isRecommended = true;
      } else if (hasSleepOrRelaxationInquiry && item.id.includes('baby-massage-ceria')) {
        isRecommended = true;
      }

      return {
        id: item.id,
        name: item.name,
        category: item.category,
        durationMinutes: item.durationMinutes,
        originalPrice: item.originalPrice,
        promoPrice: item.promoPrice,
        description: item.description,
        isRecommendedForSymptoms: isRecommended
      };
    });

    // Urutkan yang direkomendasikan di atas
    formattedTreatments.sort((a, b) => (b.isRecommendedForSymptoms ? 1 : 0) - (a.isRecommendedForSymptoms ? 1 : 0));

    const formatRp = (n: number): string => `Rp ${n.toLocaleString('id-ID')}`;
    const findTarget = (idFragment: string): CatalogTreatmentDetail | undefined =>
      formattedTreatments.find((t) => t.id.includes(idFragment));

    // Rekomendasi berbasis data katalog DINAMIS (Anti-Hardcode): nominal harga
    // hanya disisipkan bila showPrices. Tanpa itu, fokus pada protokol medis,
    // manfaat stimulasi, dan rincian perawatan.
    if (hasFluOrDigestiveSymptoms || (specificTreatmentName && /pulih|bapil|batuk|pilek|kembung/i.test(specificTreatmentName))) {
      const target = findTarget('pulih-ceria');
      const priceLine = target && showPrices
        ? ` promo ${formatRp(target.promoPrice)} (normal ${formatRp(target.originalPrice)}, durasi ${target.durationMinutes} menit).`
        : '.';
      const moksa = allServices.find((s) => s.id.includes('moksa'));
      const comboLine = target && moksa && showPrices
        ? ` Paket Combo Pulih Ceria + Sinar Moksa total Promo ${formatRp(target.promoPrice + moksa.promoPrice)} (normal ${formatRp(target.originalPrice + moksa.originalPrice)}).`
        : '';
      recommendationReason = `Untuk keluhan flu/batuk/pilek/kembung/rewel, paket yang paling tepat adalah Pijat Bayi Pulih Ceria (Terapi Bapil/Kembung)${priceLine}\n\nRincian yang didapatkan si kecil:\n1. Pijat stimulasi seluruh tubuh (full body massage bayi) oleh Bidan kami\n2. Terapi akupresur titik pernapasan (dada & punggung) khusus melegakan batuk/flu\n3. Penggunaan double aromaterapi / balsem herbal khusus bayi\n4. Opsi Tambahan (Add-on): Sinar Moksa (terapi sinar hangat inframerah ${moksa?.durationMinutes ?? 15} menit${showPrices && moksa ? `, promo +${formatRp(moksa.promoPrice)}` : ''}) untuk membantu mengencerkan dahak & lendir.${comboLine}`;
    } else if (hasEatingIssues) {
      const target = findTarget('lahap-juara');
      const priceLine = target && showPrices
        ? ` promo ${formatRp(target.promoPrice)} (normal ${formatRp(target.originalPrice)}, ${target.durationMinutes} menit).`
        : '.';
      recommendationReason = `Untuk keluhan susah makan / GTM, paket yang tepat adalah Pijat Lahap Juara${priceLine} Mencakup pijat relaksasi dan stimulasi titik pencernaan untuk nafsu makan.`;
    } else if (hasSleepOrRelaxationInquiry) {
      const target = findTarget('baby-massage-ceria');
      const priceLine = target && showPrices
        ? ` sangat cocok promo ${formatRp(target.promoPrice)} (normal ${formatRp(target.originalPrice)}, ${target.durationMinutes} menit).`
        : ' sangat cocok.';
      recommendationReason = `Untuk membantu si kecil lebih rileks dan tidur nyenyak, paket Pijat Bayi Ceria (Rileksasi)${priceLine} Mencakup pijat relaksasi seluruh tubuh bayi sehat.`;
    }

    const summaryList = formattedTreatments.slice(0, 4).map(t =>
      showPrices
        ? `• *${t.name}*: Promo *${formatRp(t.promoPrice)}* (Normal *${formatRp(t.originalPrice)}*, ${t.durationMinutes} menit)\n  Rincian: ${t.description}`
        : `• *${t.name}* (${t.durationMinutes} menit)\n  Rincian: ${t.description}`
    ).join('\n');

    let suggestedPriceReply: string | undefined = undefined;
    if (showPrices && (formattedTreatments.length === 1 || specificTreatmentName)) {
      const target = formattedTreatments[0];
      if (target) {
        suggestedPriceReply = TEMPLATES.priceInfo({
          name: target.name,
          durationMinutes: target.durationMinutes,
          normalPrice: target.originalPrice,
          promoPrice: target.promoPrice,
        });
      }
    }

    return {
      success: true,
      treatments: formattedTreatments.slice(0, 5),
      recommendationReason,
      suggestedPriceReply,
      message: `Ditemukan ${formattedTreatments.length} treatment yang sesuai:\n${summaryList}${recommendationReason ? `\n\nCatatan Rekomendasi: ${recommendationReason}` : ''}${suggestedPriceReply ? `\n\nFormat Penyampaian Harga Bidan Yusi yang Disarankan:\n"${suggestedPriceReply}"` : ''}`
    };
  } catch (error: any) {
    console.error('[V3 TOOL CATALOG ERROR]', error);
    return {
      success: false,
      treatments: [],
      message: `Gagal mengambil katalog: ${error.message}`
    };
  }
}
