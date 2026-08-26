import { CustomerSlate, ExtractedEntities, DecisionResult } from './types';
import { SlateStore } from './slate-store';
import { TEMPLATES } from '../config/persona';

export class DecisionMatrix {
  /**
   * Evaluasi deterministik prioritas keputusan (0 token LLM, murni TypeScript).
   */
  public static async evaluate(
    slate: CustomerSlate,
    extraction: ExtractedEntities,
    context?: { tenantId?: string; incomingText?: string }
  ): Promise<DecisionResult> {
    const updatedSlate = SlateStore.updateSlateWithExtraction(slate, extraction);
    const rawText = (context?.incomingText || '').toLowerCase().trim();

    // =========================================================================
    // PRIORITY 1: DARURAT MEDIS KRITIS (Silent Handoff ke CS Manusia)
    // =========================================================================
    if (extraction.isMedicalEmergency || updatedSlate.medicalConcerns.length > 0) {
      updatedSlate.isHumanHandling = true;
      updatedSlate.humanHandlingReason = 'medical_concern';
      return {
        action: 'ESCALATE_HUMAN_EMERGENCY',
        reason: 'Customer mengeluhkan kondisi darurat medis fatal (kejang/tidak sadar/sesak berat).',
        updatedSlate,
        shouldSendPricelistImage: false,
      };
    }

    // =========================================================================
    // PRIORITY 2: SEDANG DITANGANI CS MANUSIA (CS Takeover Guard)
    // =========================================================================
    if (updatedSlate.isHumanHandling) {
      return {
        action: 'SILENT_HUMAN_ACTIVE',
        reason: 'Percakapan sedang dalam penanganan manual oleh CS.',
        updatedSlate,
        shouldSendPricelistImage: false,
      };
    }

    // =========================================================================
    // PRIORITY 3: IZIN BERTANYA / KONSULTASI AWAL
    // Sambut ramah secara terbuka, DILARANG menutup obrolan
    // =========================================================================
    const isConsultationInquiry = /\b(mau\s+tanya-?tanya|boleh\s+tanya|bisa\s+konsultasi|mau\s+konsultasi|tanya\s+dulu|konsul\s+dulu)\b/i.test(rawText);
    if (isConsultationInquiry && !rawText.includes('ongkir') && !rawText.includes('harga') && extraction.symptoms.length === 0) {
      const isIslamic = /\b(assalamu'?alaikum|assalamualaikum)\b/i.test(rawText);
      const greetingHeader = isIslamic ? 'Waalaikumsalam Bunda! ✨' : 'Halo Bunda! ✨';
      return {
        action: 'RESOLVE_LOCATION_AND_DELIVERY',
        reason: 'Customer izin konsultasi -> Sambut ramah dan tanyakan kebutuhan perawatan.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: `${greetingHeader}\nTentu boleh sekali, Bunda! 😊 Mau tanya seputar perawatan apa untuk si kecil atau Bunda? Silakan, kami siap bantu jelaskan yaa 🤗`,
      };
    }

    // =========================================================================
    // PRIORITY 4: PERTANYAAN KEBIJAKAN OPERASIONAL DETERMINISTIK (0 Token)
    // =========================================================================
    // A. Kebijakan Transport / Ongkir Multi-Anak
    if (/\b(2\s*anak|dua\s*anak|3\s*anak|bunda\s*(dan|\+)\s*(anak|bayi)|ongkir.*(1\s*kali|satu\s*kali|dihitung\s*satu))\b/i.test(rawText) && (rawText.includes('ongkir') || rawText.includes('transport'))) {
      return {
        action: 'RESOLVE_LOCATION_AND_DELIVERY',
        reason: 'Customer bertanya kebijakan ongkir multi-anak/treatment -> Kirim template resmi.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: TEMPLATES.multiChildTransportPolicy(),
      };
    }

    // B. Kebijakan Metode Pembayaran
    if (/\b(metode\s*pembayaran|bayar\s*lewat|bisa\s*transfer|bisa\s*cash|bisa\s*qris|bayar\s*di\s*tempat|cod)\b/i.test(rawText) && (rawText.includes('bayar') || rawText.includes('transfer') || rawText.includes('pembayaran'))) {
      return {
        action: 'RESOLVE_LOCATION_AND_DELIVERY',
        reason: 'Customer bertanya metode pembayaran -> Kirim template metode pembayaran resmi.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: TEMPLATES.paymentMethodPolicy(),
      };
    }

    // C. Kebijakan Kualifikasi Terapis (Bidan Resmi STR)
    if (/\b(terapisnya|bidan\s*(resmi|asli)?|punya\s*str|tersertifikasi|lulusan\s*kebidanan)\b/i.test(rawText) && (rawText.includes('terapis') || rawText.includes('bidan') || rawText.includes('str'))) {
      return {
        action: 'RESOLVE_LOCATION_AND_DELIVERY',
        reason: 'Customer bertanya kualifikasi bidan/terapis -> Kirim template kualifikasi resmi.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: TEMPLATES.therapistQualificationPolicy(),
      };
    }

    // D. Kebijakan Jangkauan Area Umum
    if (/\b(melayani\s*(daerah|area|wilayah)|jangkauan\s*(kemana|mana)|bisa\s*ke\s*mana\s*aja)\b/i.test(rawText) && !extraction.locationText) {
      return {
        action: 'RESOLVE_LOCATION_AND_DELIVERY',
        reason: 'Customer bertanya area jangkauan umum -> Kirim template coverage area.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: TEMPLATES.coverageAreaPolicy(),
      };
    }

    // =========================================================================
    // PRIORITY 5: RESOLUSI LOKASI BARU & KALKULASI ONGKIR DETERMINISTIK
    // Dipicu jika ada locationText baru DAN (lokasi belum terkonfirmasi ATAU ada pergantian lokasi eksplisit)
    // =========================================================================
    const hasNewLocationText = Boolean(extraction.locationText && extraction.locationText.trim().length > 0);
    const isExplicitLocationChange = /\b(ganti|pindah|salah|ubah|bukan\s+di|yang\s+bener)\b/i.test(rawText);
    const isUnconfirmedLocation = !updatedSlate.isLocationConfirmed;
    const shouldResolveLocation = hasNewLocationText && (isUnconfirmedLocation || isExplicitLocationChange);

    if (shouldResolveLocation) {
      try {
        const { geocodingService } = await import('../integrations/google-maps/geocoding');
        const { deliveryService } = await import('../services/delivery.service');

        const resolved = await geocodingService.geocodeText(extraction.locationText!);
        if (resolved.isPrecise && resolved.lat && resolved.lng) {
          const delivery = await deliveryService.calculateDelivery({ lat: resolved.lat, lng: resolved.lng });

          updatedSlate.kelurahan = resolved.kelurahan || extraction.locationText!;
          updatedSlate.kecamatan = resolved.kecamatan || null;
          updatedSlate.kota = resolved.kota || null;
          updatedSlate.lat = resolved.lat;
          updatedSlate.lng = resolved.lng;
          updatedSlate.distanceKm = Number(delivery.distanceKm.toFixed(2));
          updatedSlate.ongkirFee = delivery.normalPrice;
          updatedSlate.ongkirPromoFee = delivery.promoPrice;
          updatedSlate.isLocationConfirmed = true;
          updatedSlate.isOutOfCoverage = delivery.isOutOfCoverage;
          updatedSlate.projectedState = SlateStore.computeProjectedState(updatedSlate);

          if (delivery.isOutOfCoverage) {
            return {
              action: 'REJECT_OUT_OF_COVERAGE',
              reason: `Jarak lokasi (${updatedSlate.distanceKm} km) melebihi batas jangkauan layanan (maks 30 km).`,
              updatedSlate,
              shouldSendPricelistImage: false,
              deterministicTemplateReply: TEMPLATES.outOfCoverage({
                distanceKm: updatedSlate.distanceKm || 30,
              }),
            };
          }

          // Kirim pricelist image jika belum pernah terkirim
          const shouldSendPricelistImage = !updatedSlate.pricelistSent;
          if (shouldSendPricelistImage) {
            updatedSlate.pricelistSent = true;
          }

          // Jika customer HANYA mengirimkan lokasi murni (tanpa keluhan/tanya harga spesifik),
          // gunakan TEMPLATES.ongkirInfo deterministik resmi (SOP Kala Spa)
          const isPureLocationMessage = !extraction.intents.includes('consult_symptom') &&
            !extraction.intents.includes('ask_price') &&
            !extraction.intents.includes('ask_clinic_origin') &&
            extraction.symptoms.length === 0;

          if (isPureLocationMessage) {
            return {
              action: 'RESOLVE_LOCATION_AND_DELIVERY',
              reason: `Lokasi terkonfirmasi (${updatedSlate.kelurahan}, ${updatedSlate.distanceKm} km, ongkir promo Rp ${updatedSlate.ongkirPromoFee?.toLocaleString('id-ID')}) -> Kirim template ongkir resmi.`,
              updatedSlate,
              shouldSendPricelistImage,
              deterministicTemplateReply: TEMPLATES.ongkirInfo({
                distanceKm: updatedSlate.distanceKm || 0,
                normalPrice: updatedSlate.ongkirFee || 0,
                promoPrice: updatedSlate.ongkirPromoFee || 0,
              }),
            };
          }

          return {
            action: 'RESOLVE_LOCATION_AND_DELIVERY',
            reason: `Lokasi terkonfirmasi (${updatedSlate.kelurahan}, ${updatedSlate.distanceKm} km, ongkir promo Rp ${updatedSlate.ongkirPromoFee?.toLocaleString('id-ID')}).`,
            updatedSlate,
            shouldSendPricelistImage,
          };
        }
      } catch (geoErr: any) {
        console.warn('[DECISION MATRIX GEOCODING ERROR]', geoErr.message);
      }
    }

    // =========================================================================
    // PRIORITY 6: JANGKAUAN MELEBIHI BATAS WILAYAH (Out of Coverage)
    // =========================================================================
    if (updatedSlate.isOutOfCoverage) {
      return {
        action: 'REJECT_OUT_OF_COVERAGE',
        reason: 'Lokasi customer berada di luar wilayah operasional klinik.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: TEMPLATES.outOfCoverage({
          distanceKm: updatedSlate.distanceKm || 30,
        }),
      };
    }

    // =========================================================================
    // PRIORITY 7: FORM RESERVASI LENGKAP (Treatment Terpilih + Niat Booking)
    // =========================================================================
    const isBookingReady =
      updatedSlate.isLocationConfirmed &&
      Boolean(updatedSlate.selectedTreatmentName) &&
      (Boolean(updatedSlate.preferredDate) || extraction.intents.includes('request_booking'));

    if (isBookingReady) {
      try {
        const { fireCapiEvent } = await import('../services/capi.service');
        const { DEFAULT_TENANT_ID } = await import('../config/tenant');
        fireCapiEvent({
          eventName: 'InitiateCheckout',
          customer: { id: updatedSlate.customerId, phone: updatedSlate.phone } as any,
          tenantId: context?.tenantId || updatedSlate.tenantId || DEFAULT_TENANT_ID,
          customData: {
            source: 'BOT_FORM_SENT',
            treatment: updatedSlate.selectedTreatmentName || undefined,
          },
        });
      } catch (capiErr: any) {
        console.warn('[CAPI] InitiateCheckout (BOT_FORM_SENT) skipped in decision matrix:', capiErr.message);
      }

      const reservationForm = TEMPLATES.reservationFormRequest({
        name: updatedSlate.name || undefined,
        address: updatedSlate.streetDetail
          ? `${updatedSlate.streetDetail}, ${updatedSlate.kelurahan}`
          : updatedSlate.kelurahan || undefined,
        kecamatan: updatedSlate.kecamatan || undefined,
        kota: updatedSlate.kota || undefined,
        phone: updatedSlate.phone || undefined,
      });

      return {
        action: 'SEND_RESERVATION_FORM',
        reason: 'Informasi treatment dan jadwal lengkap -> Mengirim format reservasi.',
        updatedSlate,
        shouldSendPricelistImage: false,
        deterministicTemplateReply: reservationForm,
      };
    }

    // =========================================================================
    // PRIORITY 8: KONSULTASI / FAQ / PERCAKAPAN UMUM (Single-Pass AI Generator)
    // =========================================================================
    return {
      action: 'GENERATE_AI_RESPONSE',
      reason: 'Percakapan natural/konsultasi keluhan/tanya harga -> Generate via Single-Pass LLM.',
      updatedSlate,
      shouldSendPricelistImage: false,
    };
  }
}
