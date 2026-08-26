import { CustomerSlate, ExtractedEntities, GroundingPackage } from './types';
import { SlateStore } from './slate-store';
import { treatmentCatalogService } from '../services/treatment-catalog.service';
import { knowledgeBaseService } from '../services/knowledge.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';

export class GroundingComposer {
  /**
   * Merakit paket fakta grounding yang kaya dan presisi (Token Diet + RAG Lokal) untuk LLM Generator.
   */
  public static async compose(
    slate: CustomerSlate,
    extraction: ExtractedEntities,
    context?: {
      customerInput?: string;
      tenantId?: string;
    }
  ): Promise<GroundingPackage> {
    const tenantId = context?.tenantId || slate.tenantId || DEFAULT_TENANT_ID;

    // 1. TOKEN DIET: Ambil katalog layanan yang sah untuk usia anak pasien + DURASI MENIT
    const allServices = treatmentCatalogService.getAllServices();
    const filteredServices = slate.childAgeMonths !== null
      ? treatmentCatalogService.filterServicesByAudience(allServices, { ageMonths: slate.childAgeMonths })
      : allServices.filter((s) => s.isActive && !s.isAddon);

    const filteredCatalog = filteredServices.slice(0, 5).map((s) => ({
      name: s.name,
      category: s.category,
      promoPrice: s.promoPrice,
      durationMinutes: s.durationMinutes,
      description: s.description,
    }));

    // 2. FAKTA ONGKIR PASTI (dari hasil hitungan Maps)
    const deliveryFacts = slate.distanceKm !== null && slate.kelurahan
      ? {
          distanceKm: slate.distanceKm,
          ongkirNormal: slate.ongkirFee,
          ongkirPromo: slate.ongkirPromoFee,
          kelurahan: slate.kelurahan,
        }
      : null;

    // 3. FAKTA ASAL KLINIK & HOMEBASE
    const clinicFacts = {
      homebase: 'Waru, Sidoarjo',
      coverage: 'Surabaya & Sidoarjo (Homecare - Bidan datang langsung ke rumah Bunda)',
    };

    // 4. RAG LOKAL: Query Top-2 Chunk FAQ Relevan dari PostgreSQL knowledge_chunks
    let relevantFaqs: Array<{ title: string; content: string }> = [];
    const queryText = context?.customerInput || '';
    if (queryText.trim().length > 0) {
      try {
        const chunks = await knowledgeBaseService.searchRelevantChunks(queryText, 2, tenantId);
        if (chunks && chunks.length > 0) {
          relevantFaqs = chunks.map((c) => ({
            title: c.title,
            content: c.content,
          }));
        }
      } catch (err: any) {
        console.warn('[GROUNDING COMPOSER] FAQ RAG query skipped:', err.message);
      }
    }

    // 5. PREFERENSI & CATATAN MEDIS KHUSUS
    let customerPreferencesText: string | null = null;
    if (slate.medicalConcerns && slate.medicalConcerns.length > 0) {
      customerPreferencesText = `Catatan Medis Khusus: ${slate.medicalConcerns.join(', ')}`;
    }

    // 6. SLOT YANG MASIH KURANG (HANYA tanyakan 1 hal berikutnya)
    const missingSlots = SlateStore.getMissingCriticalSlots(slate);
    const missingSlotsToPrompt = missingSlots[0] || null;

    return {
      filteredCatalog,
      deliveryFacts,
      clinicFacts,
      symptomsDiscussed: slate.symptoms,
      missingSlotsToPrompt,
      relevantFaqs: relevantFaqs.length > 0 ? relevantFaqs : undefined,
      customerPreferencesText,
    };
  }
}
