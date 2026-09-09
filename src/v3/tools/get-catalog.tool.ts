import { treatmentCatalogService, ClinicServiceItem } from '../../services/treatment-catalog.service';
import { TEMPLATES } from '../../config/persona';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

export interface GetCatalogInput {
  category?: 'BABY' | 'KIDS' | 'MOMS' | 'BOTH';
  childAgeMonths?: number;
  /** Usia kehamilan Ibu (minggu) bila pasien adalah Ibu Hamil (kategori MOMS). JANGAN diisi untuk bayi/anak. */
  gestationalWeeks?: number;
  /** Kondisi Ibu: Hamil, Paska Melahirkan/Nifas, atau Relaksasi Umum. */
  momStage?: 'PREGNANT' | 'POSTPARTUM' | 'GENERAL';
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
    description: 'WAJIB dipanggil untuk SETIAP pertanyaan keluhan fisik, ketersediaan perawatan, atau tanya harga. Mengambil daftar layanan/treatment resmi, harga asli, harga promo, durasi, dan rekomendasi terapi yang tepat berdasarkan usia anak atau keluhan/gejala. Rekomendasikan layanan dengan skor tertinggi dari hasil tool ini; DILARANG mengarang nama layanan di luar hasil tool.',
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
          description: 'Usia bayi/anak (bulan) jika pasien adalah bayi/anak. JANGAN diisi untuk kehamilan ibu.'
        },
        gestationalWeeks: {
          type: 'number',
          description: 'Usia kehamilan Ibu (minggu) jika pasien adalah Ibu Hamil (kategori MOMS).'
        },
        momStage: {
          type: 'string',
          enum: ['PREGNANT', 'POSTPARTUM', 'GENERAL'],
          description: 'Kondisi Ibu (Hamil, Paska Melahirkan/Nifas, atau Relaksasi Umum).'
        },
        symptoms: {
          type: 'array',
          items: { type: 'string' },
          description: 'Daftar keluhan klinis (berlaku universal untuk bayi maupun ibu).'
        },
        specificTreatmentName: {
          type: 'string',
          description: 'Nama treatment spesifik yang ditanyakan oleh customer (misal: "Pijat Bayi Ceria", "Pijat Bayi Pulih Ceria", "Cukur Rambut Bayi").'
        },
        inquirePrice: {
          type: 'boolean',
          description: 'Set true HANYA jika customer eksplisit menanyakan harga/biaya/tarif/ongkir/promo atau menyebutkan nominal angka (misal: "60rb ya", "harga berapa", "biayanya?"). WAJIB false untuk pertanyaan penjelasan cara kerja, khasiat, atau "gimana ya / seperti apa / maksudnya apa" (misal: "sinar moksa ini gmn ya") — itu BUKAN pertanyaan harga.'
        }
      }
    }
  }
};

export async function executeGetCatalog(input: GetCatalogInput, tenantId: string = DEFAULT_TENANT_ID): Promise<GetCatalogOutput> {
  const { category, childAgeMonths, gestationalWeeks, momStage, symptoms = [], specificTreatmentName, inquirePrice } = input;
  void gestationalWeeks;
  void momStage;
  // AI-First price grounding: nominal rupiah HANYA mengalir ke prompt LLM
  // bila LLM menilai customer butuh rincian harga (inquirePrice === true).
  const showPrices = inquirePrice === true;

  try {
    const allServices = treatmentCatalogService.getAllServices(true, tenantId);
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

    // 4. Rekomendasi SEMANTIK DINAMIS via service terpusat (Zero-Code Admin):
    // satu algoritma konsisten di seluruh codebase. Skor tertinggi ditandai
    // isRecommendedForSymptoms.
    const formattedTreatments: CatalogTreatmentDetail[] = filtered.map(item => {
      return {
        id: item.id,
        name: item.name,
        category: item.category,
        durationMinutes: item.durationMinutes,
        originalPrice: item.originalPrice,
        promoPrice: item.promoPrice,
        description: item.description,
        isRecommendedForSymptoms: false
      };
    });

    if ((symptoms || []).length > 0) {
      const recommended = treatmentCatalogService.recommendServiceBySymptoms(
        symptoms, childAgeMonths ?? null, category as any
      );
      if (recommended) {
        const hit = formattedTreatments.find((t) => t.id === recommended.id);
        if (hit) hit.isRecommendedForSymptoms = true;
        else {
          // Fallback: bila recommended tidak ada di filtered (mis. filter usia
          // menyempitkan pool), tandai kecocokan nama terdekat di filtered.
          const fallback = formattedTreatments.find((t) => t.name.toLowerCase() === recommended.name.toLowerCase());
          if (fallback) fallback.isRecommendedForSymptoms = true;
        }
      }
    }

    // Urutkan yang direkomendasikan di atas
    formattedTreatments.sort((a, b) => (b.isRecommendedForSymptoms ? 1 : 0) - (a.isRecommendedForSymptoms ? 1 : 0));

    const formatRp = (n: number): string => `Rp ${n.toLocaleString('id-ID')}`;

    // Alasan rekomendasi DINAMIS dari properti layanan teratas (nama + deskripsi
    // resmi dashboard). Nominal harga hanya disisipkan bila showPrices.
    let recommendationReason: string | undefined = undefined;
    const topService = formattedTreatments.find((t) => t.isRecommendedForSymptoms);
    if (topService) {
      const priceLine = showPrices
        ? ` promo ${formatRp(topService.promoPrice)} (normal ${formatRp(topService.originalPrice)}, durasi ${topService.durationMinutes} menit).`
        : '.';
      const moksa = allServices.find((s) => s.id.includes('moksa'));
      const topText = `${topService.name} ${topService.description}`.toLowerCase();
      const isRespiratory = /pernapasan|dahak|flu|bapil|pilek|batuk/i.test(topText);
      const comboLine = (showPrices && moksa && topService.id !== moksa.id && isRespiratory)
        ? ` Paket Combo ${topService.name} + Sinar Moksa total Promo ${formatRp(topService.promoPrice + moksa.promoPrice)} (normal ${formatRp(topService.originalPrice + moksa.originalPrice)}).`
        : '';
      recommendationReason = `Berdasarkan keluhan yang disampaikan (${symptoms.join(', ')}), layanan yang paling sesuai adalah ${topService.name}${priceLine} ${topService.description}${comboLine}`;
    }

    const summaryList = formattedTreatments.slice(0, 4).map(t =>
      showPrices
        ? `• *${t.name}*: Promo *${formatRp(t.promoPrice)}* (Normal *${formatRp(t.originalPrice)}*, ${t.durationMinutes} menit)\n  Rincian: ${t.description}`
        : `• *${t.name}*\n  Rincian: ${t.description}`
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
    console.error(JSON.stringify({ event: 'V3_TOOL_CATALOG_ERROR', tenantId, error: error.message, timestamp: new Date().toISOString() }));
    return {
      success: false,
      treatments: [],
      message: `Gagal mengambil katalog: ${error.message}`
    };
  }
}
