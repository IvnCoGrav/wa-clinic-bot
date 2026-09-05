import { CustomerSlate, ExtractedEntities, GroundingPackage } from './types';
import { SlateStore } from './slate-store';
import { treatmentCatalogService } from '../services/treatment-catalog.service';
import { knowledgeBaseService } from '../services/knowledge.service';
import { DEFAULT_TENANT_ID } from '../config/tenant';
import { getBrandIdentity } from '../config/brand';

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

    // Jika customer menyebut add-on (moksa/sinar/nebulizer) secara eksplisit, sertakan katalog Add-on secara dinamis
    const mentionsAddon =
      /\b(moksa|moxa|sinar|nebulizer|nebuliser|add[-\s]?on)\b/i.test(inputLower) ||
      (slate.selectedTreatmentName || '').toLowerCase().includes('moksa') ||
      (slate.selectedTreatmentName || '').toLowerCase().includes('sinar') ||
      (slate.selectedTreatmentName || '').toLowerCase().includes('nebulizer') ||
      (extraction.treatmentReferenced || '').toLowerCase().includes('moksa') ||
      (extraction.treatmentReferenced || '').toLowerCase().includes('sinar') ||
      (extraction.treatmentReferenced || '').toLowerCase().includes('nebulizer');
    if (mentionsAddon) {
      const addonPool = allServices.filter((s) => s.isAddon && s.isActive);
      // Filter dinamis berdasarkan keyword yang disebut, tanpa hardcode nama paket spesifik
      const hasMoksa = /\b(moksa|moxa|sinar)\b/i.test(inputLower) || (slate.selectedTreatmentName || '').toLowerCase().includes('moksa') || (extraction.treatmentReferenced || '').toLowerCase().includes('moksa') || (slate.selectedTreatmentName || '').toLowerCase().includes('sinar') || (extraction.treatmentReferenced || '').toLowerCase().includes('sinar');
      const hasNebul = /\b(nebulizer|nebuliser)\b/i.test(inputLower) || (slate.selectedTreatmentName || '').toLowerCase().includes('nebulizer') || (extraction.treatmentReferenced || '').toLowerCase().includes('nebulizer');
      let relevantAddons = addonPool;
      if (hasMoksa && !hasNebul) {
        relevantAddons = addonPool.filter((s) => s.name.toLowerCase().includes('moksa') || s.name.toLowerCase().includes('moxa') || s.name.toLowerCase().includes('sinar'));
        if (relevantAddons.length === 0) relevantAddons = addonPool;
      } else if (hasNebul && !hasMoksa) {
        relevantAddons = addonPool.filter((s) => s.name.toLowerCase().includes('nebulizer'));
        if (relevantAddons.length === 0) relevantAddons = addonPool;
      }
      const combinedAddon = [...filteredServices, ...relevantAddons];
      const seenAddon = new Set<string>();
      filteredServices = combinedAddon.filter((s) => {
        if (seenAddon.has(s.id)) return false;
        seenAddon.add(s.id);
        return true;
      });
    }

    // Prioritaskan treatment yang sudah dipilih — hanya jika kompatibel dengan usia baru (cegah stale Kids untuk Baby 16 bulan)
    let effectiveSelectedTreatment: string | null = slate.selectedTreatmentName || extraction.treatmentReferenced || null;
    if (effectiveSelectedTreatment && slate.childAgeMonths !== null) {
      const allForCheck = treatmentCatalogService.getAllServices();
      const matchedForCheck = allForCheck.find((s) => s.name.toLowerCase() === effectiveSelectedTreatment!.toLowerCase() || effectiveSelectedTreatment!.toLowerCase().includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(effectiveSelectedTreatment!.toLowerCase()));
      if (matchedForCheck) {
        const compat = treatmentCatalogService.filterServicesByAudience([matchedForCheck], { ageMonths: slate.childAgeMonths });
        if (compat.length === 0) {
          // Treatment lama tidak kompatibel dengan usia baru → jangan prioritaskan, biarkan filteredServices age-filtered yang menentukan
          effectiveSelectedTreatment = null;
        }
      } else {
        const lower = effectiveSelectedTreatment.toLowerCase();
        if ((slate.childAgeCategory === 'BABY' && lower.includes('kids')) || (slate.childAgeCategory === 'KIDS' && lower.includes('bayi ceria') && !lower.includes('kids'))) {
          effectiveSelectedTreatment = null;
        }
      }
    }
    if (effectiveSelectedTreatment) {
      const effLower = effectiveSelectedTreatment.toLowerCase();
      const effParts = effLower.split('+').map((p) => p.trim()).filter(Boolean);
      filteredServices.sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const aClean = aName.replace(/\s*\([^)]*\)/g, '').trim();
        const bClean = bName.replace(/\s*\([^)]*\)/g, '').trim();
        const aMatch = effParts.some((part) => aName.includes(part) || aClean.includes(part) || part.includes(aClean)) || aName.includes(effLower) || effLower.includes(aClean);
        const bMatch = effParts.some((part) => bName.includes(part) || bClean.includes(part) || part.includes(bClean)) || bName.includes(effLower) || effLower.includes(bClean);
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        return 0;
      });
    } else if ((slate.symptoms && slate.symptoms.length > 0) || (extraction.symptoms && extraction.symptoms.length > 0)) {
      const symptomQuery = [...(slate.symptoms || []), ...(extraction.symptoms || [])].join(' ');
      const ranked = treatmentCatalogService.searchCatalogItems(symptomQuery);
      if (ranked.length > 0) {
        const rankMap = new Map(ranked.map((s, idx) => [s.id, idx]));
        filteredServices.sort((a, b) => {
          const aRank = rankMap.has(a.id) ? rankMap.get(a.id)! : 999;
          const bRank = rankMap.has(b.id) ? rankMap.get(b.id)! : 999;
          if (aRank !== bRank) return aRank - bRank;
          return 0;
        });
      }
      // Jika TANPA keluhan yang cocok di DB, biarkan urutan katalog default (relaksasi di atas)
    }

    const maxItems = mentionsMoms || mentionsAddon ? 7 : 5;
    const filteredCatalog = filteredServices.slice(0, maxItems).map((s) => ({
      name: s.name,
      category: s.category,
      ageTierLabel: (s as any).ageTier?.label || '',
      durationMinutes: s.durationMinutes,
      promoPrice: s.promoPrice,
      originalPrice: (s as any).originalPrice,
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

    // 3. FAKTA ASAL KLINIK & HOMEBASE (dinamis dari Brand Identity)
    const brand = getBrandIdentity();
    const clinicFacts = {
      homebase: (brand as any).homebase || 'Waru, Sidoarjo',
      coverage: (brand as any).coverage || 'Surabaya & Sidoarjo (Homecare - Bidan datang langsung ke rumah Bunda)',
      brandName: brand.businessName,
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

    const isMaternalCareTopic =
      /\b(nifas|laktasi|asi|oksitosin|breast|payudara|bengkak|pelancar\s*asi|memperlancar\s*asi|lancar\s*asi)\b/i.test(inputLower) ||
      Boolean(targetTreatment && /\b(nifas|laktasi|oksitosin|breast)\b/i.test(targetTreatment));

    if (isMaternalCareTopic) {
      const maternalNote = `Panduan Khusus Perawatan Ibu Nifas & Laktasi: Di pricelist kami, perawatan untuk ibu nifas/menyusui tersedia dalam 2 pilihan utama: *Oksitosin Massage Fullbody* (fokus relaksasi punggung/leher & rangsang hormon oksitosin ASI) dan *Paket Laktasi (Breast Massage)* (fokus penanganan payudara bengkak/ASI tersumbat). Jika customer mencari 'Pijat Nifas' di pricelist atau ingin relaksasi + pelancar ASI, terangkan kedua opsi ini dengan ramah dan tawarkan untuk dijadwalkan.`;
      customerPreferencesText = customerPreferencesText ? `${customerPreferencesText}\n${maternalNote}` : maternalNote;
    }

    const effectiveTreatment =
      extraction.treatmentReferenced ||
      slate.selectedTreatmentName ||
      (allSymptoms.length > 0 ? 'Pijat Bayi Pulih Ceria' : null);
    const effectiveDate = extraction.preferredDateText || slate.preferredDate;

    // Info kombinasi dinamis: jika treatment mengandung "+" (mis. "Pulih Ceria + Sinar Moksa"), hitung total promo/ normal dari katalog secara dinamis tanpa hardcode nominal
    let comboPricingNote: string | null = null;
    if (effectiveTreatment && effectiveTreatment.includes('+')) {
      const parts = effectiveTreatment.split('+').map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const matched = parts
          .map((part) => {
            const lowerPart = part.toLowerCase();
            return allServices.find((s) => {
              const nameLower = s.name.toLowerCase();
              const cleanName = nameLower.replace(/\s*\([^)]*\)/g, '').trim();
              return nameLower.includes(lowerPart) || cleanName.includes(lowerPart) || lowerPart.includes(cleanName);
            });
          })
          .filter((s): s is typeof allServices[number] => !!s);
        if (matched.length >= 2) {
          const totalPromo = matched.reduce((sum, s) => sum + (s.promoPrice || 0), 0);
          const totalNormal = matched.reduce((sum, s) => sum + (s.originalPrice || 0), 0);
          const breakdown = matched.map((s) => `${s.name} Rp ${s.promoPrice.toLocaleString('id-ID')}`).join(' + ');
          const ongkirNote = slate.ongkirPromoFee !== null ? ` + Ongkir Rp ${(slate.ongkirPromoFee || 0).toLocaleString('id-ID')} = Rp ${(totalPromo + (slate.ongkirPromoFee || 0)).toLocaleString('id-ID')} total` : '';
          comboPricingNote = `Info Kombinasi Dinamis: Paket "${effectiveTreatment}" total promo Rp ${totalPromo.toLocaleString('id-ID')} (normal Rp ${totalNormal.toLocaleString('id-ID')}), rincian: ${breakdown}${ongkirNote}. Hitung presisi dari katalog aktif, jangan tebak nominal.`;
        }
      }
    } else if (effectiveTreatment && /pulih.*moksa|moksa.*pulih|pulih.*sinar|sinar.*pulih/i.test(effectiveTreatment)) {
      const pulih = allServices.find((s) => s.name.toLowerCase().includes('pulih ceria') && s.isActive);
      const moksa = allServices.find((s) => (s.name.toLowerCase().includes('moksa') || s.name.toLowerCase().includes('sinar')) && s.isAddon && s.isActive);
      if (pulih && moksa) {
        const totalPromo = (pulih.promoPrice || 0) + (moksa.promoPrice || 0);
        const totalNormal = (pulih.originalPrice || 0) + (moksa.originalPrice || 0);
        const ongkirNote = slate.ongkirPromoFee !== null ? ` + Ongkir Rp ${(slate.ongkirPromoFee || 0).toLocaleString('id-ID')} = Rp ${(totalPromo + (slate.ongkirPromoFee || 0)).toLocaleString('id-ID')} total` : '';
        comboPricingNote = `Info Kombinasi Dinamis: Paket "${pulih.name} + ${moksa.name}" total promo Rp ${totalPromo.toLocaleString('id-ID')} (normal Rp ${totalNormal.toLocaleString('id-ID')}), rincian: ${pulih.name} Rp ${pulih.promoPrice.toLocaleString('id-ID')} + ${moksa.name} Rp ${moksa.promoPrice.toLocaleString('id-ID')}${ongkirNote}.`;
      }
    }

    // 5b. STATUS DATA TERKONFIRMASI (ANTI-AMNESIA GROUND TRUTH LOCK)
    const confirmedDataItems: string[] = [];
    if (effectiveTreatment) {
      confirmedDataItems.push(`• Treatment Terpilih: *${effectiveTreatment}*`);
    }
    if (effectiveDate) {
      confirmedDataItems.push(`• Jadwal/Hari Kunjungan: *${effectiveDate}*`);
    }
    if (slate.isLocationConfirmed && slate.kelurahan) {
      const distInfo = slate.distanceKm ? ` (~${slate.distanceKm} km, ongkir: ${slate.ongkirPromoFee === 0 ? 'GRATIS' : `Rp ${(slate.ongkirPromoFee || 0).toLocaleString('id-ID')}`})` : '';
      confirmedDataItems.push(`• Lokasi Rumah: *${slate.kelurahan}*${distInfo}`);
    }
    if (slate.childAgeMonths !== null) {
      confirmedDataItems.push(`• Usia Anak: *${slate.childAgeMonths} bulan*`);
    }

    const lockedHeader = confirmedDataItems.length > 0
      ? `⚠️ DATA TERKONFIRMASI (SUMBER KEBENARAN MUTLAK - DILARANG DITANYAKAN ULANG):\n${confirmedDataItems.join('\n')}`
      : '';

    if (effectiveDate || extraction.intents.includes('ask_schedule')) {
      const targetDate = effectiveDate || 'jadwal yang ditanyakan';
      const targetTreatmentName = effectiveTreatment || null;
      const locationNote = slate.isLocationConfirmed && slate.kelurahan
        ? targetTreatmentName
          ? `Lokasi Bunda sudah terkonfirmasi di ${slate.kelurahan}. Informasikan jarak dan estimasi ongkir promo ke ${slate.kelurahan}, lalu konfirmasi jadwal ${targetDate} untuk *${targetTreatmentName}* dan bantu proses reservasinya. DILARANG KERAS menanyakan lagi "di hari apa" atau menanyakan alamat rumah!`
          : `Lokasi Bunda sudah terkonfirmasi di ${slate.kelurahan}. Informasikan jarak dan estimasi ongkir promo ke ${slate.kelurahan}, lalu konfirmasi jadwal ${targetDate} dan bantu proses reservasinya. DILARANG KERAS menanyakan alamat rumah!`
        : `Sampaikan dengan ramah bahwa ketersediaan jadwal Bidan sedang kami bantu cekkan, dan tanyakan daerah/kelurahan rumah Bunda agar bisa sekalian kami cek jarak dan ongkirnya.`;
      const scheduleNote = targetTreatmentName
        ? `Preferensi Jadwal Customer: Bunda menanyakan ketersediaan jadwal untuk ${targetDate} (Treatment: *${targetTreatmentName}*). ${locationNote}`
        : `Preferensi Jadwal Customer: Bunda menanyakan ketersediaan jadwal untuk ${targetDate}. ${locationNote}`;
      customerPreferencesText = customerPreferencesText ? `${customerPreferencesText}\n${scheduleNote}` : scheduleNote;
    }

    if (lockedHeader) {
      customerPreferencesText = customerPreferencesText ? `${lockedHeader}\n\n${customerPreferencesText}` : lockedHeader;
    }

    if (comboPricingNote) {
      customerPreferencesText = customerPreferencesText ? `${customerPreferencesText}\n${comboPricingNote}` : comboPricingNote;
    }

    // 6. SLOT YANG MASIH KURANG (HANYA tanyakan 1 hal berikutnya)
    const missingSlots = SlateStore.getMissingCriticalSlots(slate);
    const missingSlotsToPrompt = missingSlots[0] || null;

    // 7. PRE-FILLED RESERVATION FORM GENERATOR
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

    // Alih kelola form ke Admin: JANGAN suntik template form reservasi ke prompt LLM
    // saat booking-ready — form dikirim Admin manusia via dashboard setelah cek jadwal.
    // (suggestedPreFilledForm sengaja selalu null; LLM Call 2 tidak boleh menempel form panjang.)
    const suggestedPreFilledForm: string | null = null;

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
