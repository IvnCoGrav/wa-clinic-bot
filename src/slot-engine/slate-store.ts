import { ConversationState } from '@prisma/client';
import { StateHandlerContext } from '../state-machine/types';
import { CustomerSlate, ExtractedEntities } from './types';
import { prisma } from '../db/client';
import { getGazetteerAreas, escapeRegex } from '../utils/gazetteer';

export class SlateStore {
  /**
   * Membangun CustomerSlate dari context percakapan & snapshot database.
   */
  public static hydrateSlate(ctx: StateHandlerContext): CustomerSlate {
    const { customer, conversation } = ctx;
    const preferences = (customer as any).preferences || {};

    const rawAge = (customer as any).age_months ?? preferences.childAgeMonths ?? null;
    const childAgeMonths = typeof rawAge === 'number' ? rawAge : null;

    let childAgeCategory: 'BABY' | 'KIDS' | 'MOMS' | null = null;
    if (childAgeMonths !== null) {
      childAgeCategory = childAgeMonths <= 24 ? 'BABY' : 'KIDS';
    }

    const distanceKm = customer.distance_km ?? preferences.distanceKm ?? null;
    const ongkirPromoFee = customer.ongkir ?? preferences.ongkirPromoFee ?? preferences.ongkirFee ?? null;
    const ongkirFee = preferences.ongkirFee ?? ongkirPromoFee ?? null;
    const isOutOfCoverage = customer.is_out_of_coverage ?? Boolean(preferences.isOutOfCoverage);

    const isLocationConfirmed = Boolean(
      (customer.kelurahan && (customer.lat != null || distanceKm != null)) ||
      (customer.lat != null && customer.lng != null)
    );
    const symptoms: string[] = Array.isArray(preferences.symptoms) ? preferences.symptoms : [];

    const slate: CustomerSlate = {
      customerId: customer.id,
      phone: customer.phone,
      name: customer.name || null,
      tenantId: ctx.tenantId || customer.tenant_id,
      conversationId: conversation.id,

      kelurahan: customer.kelurahan || null,
      kecamatan: customer.kecamatan || null,
      kota: customer.kota || null,
      lat: customer.lat ?? null,
      lng: customer.lng ?? null,
      streetDetail: preferences.streetDetail || null,
      distanceKm,
      ongkirFee,
      ongkirPromoFee,
      isLocationConfirmed,
      isOutOfCoverage,

      childAgeMonths,
      childAgeCategory,
      symptoms,
      medicalConcerns: [],

      selectedTreatmentName: conversation.last_discussed_treatment || preferences.selectedTreatmentName || null,
      preferredDate: preferences.preferredDate || null,
      preferredTime: preferences.preferredTime || null,

      pricelistSent: Boolean(customer.pricelist_sent),
      reservationFormSent: Boolean(
        ctx.history?.some(
          (h) =>
            h.role === 'assistant' &&
            (h.content.includes('Format Reservasi') ||
              h.content.includes('Format Booking') ||
              h.content.includes('Nama Bunda:') ||
              h.content.includes('Nama Anak:'))
        )
      ),
      isHumanHandling: Boolean(conversation.is_human_handling),
      humanHandlingReason: conversation.escalation_reason || null,
      lastInteractionAt: conversation.last_message_at || new Date(),
      projectedState: conversation.current_state || ConversationState.AWAITING_LOCATION,
    };

    // 1b. Passive Ground Truth Harvesting dari riwayat pesan jika data penting belum terisi
    if (ctx.history && ctx.history.length > 0) {
      this.harvestGroundTruthFromHistorySync(slate, ctx.history);
    }

    slate.projectedState = this.computeProjectedState(slate);
    return slate;
  }

  /**
   * Ekstraksi informasi fakta (Ground Truth) secara pasif dari riwayat pesan sebelumnya.
   * 0 Token, < 1ms, murni deterministik.
   */
  public static harvestGroundTruthFromHistorySync(
    slate: CustomerSlate,
    history: Array<{ role: 'user' | 'assistant'; content: string }>
  ): boolean {
    let modified = false;

    // 1. Ekstraksi Admin Outbound (jarak & ongkir yang sudah dikutip oleh CS)
    if (slate.distanceKm === null || slate.ongkirPromoFee === null) {
      try {
        const { parseAdminChatDistanceAndOngkir } = require('../utils/admin-chat-distance-parser');
        for (let i = history.length - 1; i >= 0; i--) {
          const msg = history[i];
          if (msg.role === 'assistant') {
            const parsed = parseAdminChatDistanceAndOngkir(msg.content);
            if (parsed.isConfident && (parsed.distanceKm !== null || parsed.ongkir !== null)) {
              if (parsed.distanceKm !== null && slate.distanceKm === null) {
                slate.distanceKm = parsed.distanceKm;
                modified = true;
              }
              if (parsed.ongkir !== null && slate.ongkirPromoFee === null) {
                slate.ongkirPromoFee = parsed.ongkir;
                slate.ongkirFee = parsed.normalOngkir || parsed.ongkir;
                modified = true;
              }
              break;
            }
          }
        }
      } catch (_) {}
    }

    // 2. Ekstraksi User Inbound (nama wilayah / kelurahan yang sudah diinfokan customer)
    if (!slate.kelurahan) {
      const gazetteer = getGazetteerAreas();
      for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg.role === 'user') {
          const clean = msg.content.toLowerCase().trim()
            .replace(/^(?:saya\s+)?(?:di|daerah|ke|posisi|area)\s+/i, '')
            .replace(/\s+(?:aja|saja|bund|bunda|kak|sis|ya|kakak|mba|mbak|bu|bidan)$/i, '')
            .trim();
          if (clean && gazetteer.has(clean)) {
            slate.kelurahan = gazetteer.get(clean)!;
            modified = true;
            break;
          } else {
            for (const [areaLower, areaOrig] of gazetteer.entries()) {
              const reg = new RegExp(`\\b${escapeRegex(areaLower)}\\b`, 'i');
              if (reg.test(msg.content)) {
                slate.kelurahan = areaOrig;
                modified = true;
                break;
              }
            }
            if (slate.kelurahan) break;
          }
        }
      }
    }

    // 3. Treatment yang pernah dibahas di history (HANYA DARI PESAN CUSTOMER)
    if (!slate.selectedTreatmentName) {
      const treatmentKeywords = [
        { key: 'oksitosin', name: 'Pijat Oksitosin' },
        { key: 'laktasi', name: 'Pijat Laktasi' },
        { key: 'pulih ceria', name: 'Pijat Bayi Pulih Ceria' },
        { key: 'batuk', name: 'Pijat Bayi Pulih Ceria' },
        { key: 'pilek', name: 'Pijat Bayi Pulih Ceria' },
        { key: 'grok', name: 'Pijat Bayi Pulih Ceria' },
        { key: 'kolik', name: 'Pijat Bayi Kolik & Sembelit' },
        { key: 'sembelit', name: 'Pijat Bayi Kolik & Sembelit' },
        { key: 'tumbuh ceria', name: 'Pijat Bayi Tumbuh Ceria' },
        { key: 'bayi ceria', name: 'Pijat Bayi Ceria' },
        { key: 'pijat bayi', name: 'Pijat Bayi Ceria' },
        { key: 'pijat hamil', name: 'Pijat Relaksasi Ibu Hamil' },
        { key: 'pijat nifas', name: 'Pijat Relaksasi Ibu Nifas' },
      ];
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role !== 'user') continue;
        const lower = history[i].content.toLowerCase();
        for (const t of treatmentKeywords) {
          if (lower.includes(t.key)) {
            slate.selectedTreatmentName = t.name;
            modified = true;
            break;
          }
        }
        if (slate.selectedTreatmentName) break;
      }
    }

    if (slate.kelurahan && (slate.distanceKm !== null || slate.lat !== null)) {
      slate.isLocationConfirmed = true;
    }

    return modified;
  }

  /**
   * Menggabungkan entitas hasil ekstraksi NLU ke dalam CustomerSlate secara aman.
   */
  public static updateSlateWithExtraction(
    slate: CustomerSlate,
    extraction: ExtractedEntities
  ): CustomerSlate {
    const updated: CustomerSlate = { ...slate };

    // 1. Update Nama jika customer memperkenalkan diri
    if (extraction.customerName && !updated.name) {
      updated.name = extraction.customerName;
    }

    // 2. Update Usia Anak & Kategori
    if (extraction.childAgeMonths !== null && extraction.childAgeMonths > 0) {
      updated.childAgeMonths = extraction.childAgeMonths;
      updated.childAgeCategory = extraction.childAgeMonths <= 24 ? 'BABY' : 'KIDS';
    }

    // 3. Update Keluhan/Gejala Pasien (Append tanpa duplikasi)
    if (extraction.symptoms && extraction.symptoms.length > 0) {
      const existing = new Set(updated.symptoms);
      for (const s of extraction.symptoms) {
        existing.add(s.toLowerCase().trim());
      }
      updated.symptoms = Array.from(existing);
    }

    // 4. Update Detail Jalan / Gang Rumah
    if (extraction.streetDetail) {
      updated.streetDetail = extraction.streetDetail;
    }

    // 5. Update Treatment yang Dipilih
    if (extraction.treatmentReferenced) {
      updated.selectedTreatmentName = extraction.treatmentReferenced;
    }

    // 6. Update Waktu Reservasi
    if (extraction.preferredDateText) {
      updated.preferredDate = extraction.preferredDateText;
    }
    if (extraction.preferredTimeText) {
      updated.preferredTime = extraction.preferredTimeText;
    }

    // 7. Update Darurat Medis
    if (extraction.isMedicalEmergency) {
      updated.isHumanHandling = true;
      updated.humanHandlingReason = 'medical_concern';
      updated.medicalConcerns = extraction.symptoms;
    }

    updated.projectedState = this.computeProjectedState(updated);
    return updated;
  }

  /**
   * Proyeksikan status state machine lama untuk menjamin kompatibilitas 100% dengan Admin Dashboard.
   */
  public static computeProjectedState(slate: CustomerSlate): ConversationState {
    if (slate.isHumanHandling) {
      return ConversationState.HUMAN_HANDLING;
    }
    if (slate.selectedTreatmentName && (slate.preferredDate || slate.preferredTime)) {
      return ConversationState.RESERVATION_SENT;
    }
    if (slate.isLocationConfirmed) {
      return ConversationState.AWAITING_INTEREST;
    }
    return ConversationState.AWAITING_LOCATION;
  }

  /**
   * Mendapatkan daftar slot kritis yang masih kosong secara berurutan.
   */
  public static getMissingCriticalSlots(
    slate: CustomerSlate
  ): ('LOCATION' | 'AGE' | 'TREATMENT_CHOICE' | 'RESERVATION_DETAILS')[] {
    const missing: ('LOCATION' | 'AGE' | 'TREATMENT_CHOICE' | 'RESERVATION_DETAILS')[] = [];

    if (!slate.isLocationConfirmed) {
      missing.push('LOCATION');
    }
    if (slate.childAgeMonths === null && !slate.selectedTreatmentName) {
      missing.push('AGE');
    }
    if (!slate.selectedTreatmentName) {
      missing.push('TREATMENT_CHOICE');
    }
    if (!slate.preferredDate) {
      missing.push('RESERVATION_DETAILS');
    }

    return missing;
  }

  /**
   * Menyimpan update Slate kembali ke database Prisma.
   */
  public static async persistSlate(slate: CustomerSlate, prismaClient = prisma): Promise<void> {
    try {
      const preferences = {
        childAgeMonths: slate.childAgeMonths,
        childAgeCategory: slate.childAgeCategory,
        symptoms: slate.symptoms,
        streetDetail: slate.streetDetail,
        distanceKm: slate.distanceKm,
        ongkirFee: slate.ongkirFee,
        ongkirPromoFee: slate.ongkirPromoFee,
        isOutOfCoverage: slate.isOutOfCoverage,
        selectedTreatmentName: slate.selectedTreatmentName,
        preferredDate: slate.preferredDate,
        preferredTime: slate.preferredTime,
        reservationFormSent: slate.reservationFormSent,
      };

      await prismaClient.customer.update({
        where: { id: slate.customerId },
        data: {
          name: slate.name || undefined,
          kelurahan: slate.kelurahan || undefined,
          kecamatan: slate.kecamatan || undefined,
          kota: slate.kota || undefined,
          lat: slate.lat || undefined,
          lng: slate.lng || undefined,
          distance_km: slate.distanceKm ?? undefined,
          ongkir: slate.ongkirPromoFee ?? slate.ongkirFee ?? undefined,
          is_out_of_coverage: slate.isOutOfCoverage ?? undefined,
          pricelist_sent: slate.pricelistSent,
          preferences,
        },
      });

      await prismaClient.conversation.update({
        where: { id: slate.conversationId },
        data: {
          current_state: slate.projectedState,
          is_human_handling: slate.isHumanHandling,
          escalation_reason: slate.humanHandlingReason || undefined,
          last_discussed_treatment: slate.selectedTreatmentName || undefined,
          last_message_at: new Date(),
        },
      });
    } catch (err: any) {
      console.warn('[SLATE PERSIST WARN]', err.message);
    }
  }
}
