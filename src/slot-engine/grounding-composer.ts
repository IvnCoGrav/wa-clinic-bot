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
    const inputLower = (context?.customerInput || '').toLowerCase();
    const mentionsMoms =
      /\b(ibu|moms?|bunda|laktasi|oksitosin|nifas|hamil|melahirkan|payudara|pijat ibu|relaksasi ibu)\b/i.test(inputLower) ||
      (slate.selectedTreatmentName || '').toLowerCase().includes('laktasi') ||
      (slate.selectedTreatmentName || '').toLowerCase().includes('oksitosin') ||
      (slate.selectedTreatmentName || '').toLowerCase().includes('moms') ||
      (extraction.treatmentReferenced || '').toLowerCase().includes('laktasi') ||
      (extraction.treatmentReferenced || '').toLowerCase().includes('oksitosin');

    let filteredServices = slate.childAgeMonths !== null
      ? treatmentCatalogService.filterServicesByAudience(allServices, { ageMonths: slate.childAgeMonths })
      : allServices.filter((s) => s.isActive && !s.isAddon);

    // Jika customer menanyakan layanan ibu/moms atau bundling, sertakan katalog Moms
    if (mentionsMoms) {
      const momsServices = allServices.filter((s) => s.category === 'MOMS' && s.isActive);
      const combined = [...filteredServices, ...momsServices];
      const seen = new Set<string>();
      filteredServices = combined.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });
    }

    // Prioritaskan treatment yang sudah dipilih atau sesuai gejala (misal Pulih Ceria) di urutan pertama
    const effectiveSelectedTreatment = slate.selectedTreatmentName || extraction.treatmentReferenced;
    if (effectiveSelectedTreatment) {
      filteredServices.sort((a, b) => {
        const aMatch = a.name.toLowerCase().includes(effectiveSelectedTreatment.toLowerCase());
        const bMatch = b.name.toLowerCase().includes(effectiveSelectedTreatment.toLowerCase());
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        return 0;
      });
    } else if ((slate.symptoms && slate.symptoms.length > 0) || (extraction.symptoms && extraction.symptoms.length > 0)) {
      filteredServices.sort((a, b) => {
        const aMatch = a.name.toLowerCase().includes('pulih');
        const bMatch = b.name.toLowerCase().includes('pulih');
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        return 0;
      });
    }

    const maxItems = mentionsMoms ? 6 : 5;
    const filteredCatalog = filteredServices.slice(0, maxItems).map((s) => ({
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
    const allSymptoms = Array.from(new Set([...(slate.symptoms || []), ...(extraction.symptoms || [])]));
    const targetTreatment = slate.selectedTreatmentName || extraction.treatmentReferenced;
    const isSwitchingToBaby = /\b(untuk\s+baby|buat\s+baby|baby\s+aja|anak\s+aja|buat\s+anak|bayi\s+aja)\b/i.test(inputLower);

    if (allSymptoms.length > 0 || (targetTreatment && targetTreatment.toLowerCase().includes('pulih'))) {
      const treatmentName = targetTreatment || 'Pijat Bayi Pulih Ceria';
      const switchNote = isSwitchingToBaby
        ? ' Customer mengonfirmasi memilih perawatan untuk baby saja, langsung arahkan ke *Pijat Bayi Pulih Ceria* (terapi flu) dan tanyakan jadwal kunjungannya.'
        : '';
      customerPreferencesText = `Catatan Medis Khusus: Pasien memiliki keluhan/gejala (${allSymptoms.join(', ') || 'keluhan fisik'}). Rekomendasi mutlak: *${treatmentName}*.${switchNote} DILARANG MEREKOMENDASIKAN PIJAT BIASA/CERIA UMUM jika pasien memiliki keluhan batuk, pilek, grok-grok, kembung, kolik, atau rewel!`;
    } else if (slate.medicalConcerns && slate.medicalConcerns.length > 0) {
      customerPreferencesText = `Catatan Medis Khusus: ${slate.medicalConcerns.join(', ')}`;
    }

    // 6. SLOT YANG MASIH KURANG (HANYA tanyakan 1 hal berikutnya)
    const missingSlots = SlateStore.getMissingCriticalSlots(slate);
    const missingSlotsToPrompt = missingSlots[0] || null;

    // 7. PRE-FILLED RESERVATION FORM GENERATOR
    const effectiveTreatment =
      extraction.treatmentReferenced ||
      slate.selectedTreatmentName ||
      (allSymptoms.length > 0 ? 'Pijat Bayi Pulih Ceria' : null);
    const effectiveDate = extraction.preferredDateText || slate.preferredDate;
    const intentsList = extraction.intents || [];
    const hasExplicitBookingIntent = Boolean(
      intentsList.includes('request_booking') ||
      (effectiveDate && (intentsList.includes('ask_schedule') || intentsList.includes('select_treatment') || intentsList.includes('affirmation') || intentsList.includes('chitchat') || intentsList.includes('consult_symptom'))) ||
      (effectiveDate && effectiveTreatment)
    );
    const isBookingReady = Boolean(
      slate.isLocationConfirmed &&
      effectiveTreatment &&
      hasExplicitBookingIntent
    );

    let suggestedPreFilledForm: string | null = null;
    if (isBookingReady) {
      const { TEMPLATES } = await import('../config/persona');
      let treatmentBaby: string | undefined = undefined;
      let treatmentMoms: string | undefined = undefined;

      if (effectiveTreatment) {
        if (mentionsMoms) {
          treatmentBaby = effectiveTreatment.includes('Pijat') ? effectiveTreatment : 'Pijat Bayi Ceria';
          treatmentMoms = 'Bundling Pijat Laktasi + Oksitosin';
        } else {
          treatmentBaby = effectiveTreatment;
        }
      }

      suggestedPreFilledForm = TEMPLATES.reservationFormRequest({
        name: slate.name || undefined,
        address: slate.streetDetail
          ? `${slate.streetDetail}, ${slate.kelurahan}`
          : slate.kelurahan || undefined,
        kecamatan: slate.kecamatan || undefined,
        kota: slate.kota || undefined,
        phone: slate.phone || undefined,
        bookingDate: effectiveDate || undefined,
        treatmentBaby,
        treatmentMoms,
        babyAge: slate.childAgeMonths !== null ? `${slate.childAgeMonths} bulan` : undefined,
      });
    }

    const durationSummaryText = treatmentCatalogService.getServiceDurationSummary();
    const operationalFactsText = '• Homebase & Layanan: Homecare Waru Sidoarjo (Surabaya & Sidoarjo maks 30 km)\n• Hari & Jam Operasional: Buka Setiap Hari (Senin - Minggu 08.00 - 17.00 WIB)\n• Tenaga Medis: Bidan Profesional Lulusan Kebidanan & Bersertifikat STR Aktif\n• Pembayaran: Transfer Bank (BCA, Mandiri, BRI), QRIS Universal, Cash di Tempat';

    return {
      filteredCatalog,
      deliveryFacts,
      clinicFacts,
      durationSummaryText,
      operationalFactsText,
      symptomsDiscussed: slate.symptoms,
      missingSlotsToPrompt,
      relevantFaqs: relevantFaqs.length > 0 ? relevantFaqs : undefined,
      customerPreferencesText,
      isBookingReady,
      suggestedPreFilledForm,
    };
  }
}
