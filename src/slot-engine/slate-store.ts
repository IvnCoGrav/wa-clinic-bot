import { ConversationState } from '@prisma/client';
import { StateHandlerContext } from '../state-machine/types';
import { CustomerSlate, ExtractedEntities } from './types';
import { prisma } from '../db/client';

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

    const isLocationConfirmed = Boolean(customer.kelurahan && customer.lat && customer.lng);
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
      lat: customer.lat || null,
      lng: customer.lng || null,
      streetDetail: preferences.streetDetail || null,
      distanceKm: preferences.distanceKm || null,
      ongkirFee: preferences.ongkirFee || null,
      ongkirPromoFee: preferences.ongkirPromoFee || null,
      isLocationConfirmed,
      isOutOfCoverage: Boolean(preferences.isOutOfCoverage),

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

    slate.projectedState = this.computeProjectedState(slate);
    return slate;
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
