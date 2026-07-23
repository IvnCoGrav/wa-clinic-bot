import { ConversationState } from '@prisma/client';
import { StateHandlerContext, StateHandlerResult } from '../types';
import { geocodingService } from '../../integrations/google-maps/geocoding';
import { deliveryService } from '../../services/delivery.service';
import { customerService } from '../../services/customer.service';
import { TEMPLATES } from '../../config/persona';
import { DEFAULT_TENANT_ID } from '../../config/tenant';

/**
 * Handler untuk state LOCATION_CONFIRMED:
 * Menanyakan konfirmasi lokasi hasil fuzzy-match tunggal kepada customer.
 * Mengimplementasikan aturan preseden ketat: Override > Mixed-Signal > Affirmative > Negative > Fallback.
 */
export async function handleLocationConfirmationState(ctx: StateHandlerContext): Promise<StateHandlerResult> {
  const { incomingMessage, customer, conversation } = ctx;
  const tenantId = ctx.tenantId || customer.tenant_id || DEFAULT_TENANT_ID;
  const userText = incomingMessage.text?.body || '';
  const lower = userText.toLowerCase().trim();

  // 1. OVERRIDE DETECTION (Prioritas Utama)
  // Pengecekan apakah customer langsung mengirim pin lokasi GPS atau mengetik alamat baru
  const isPin = incomingMessage.type === 'location' && incomingMessage.location;
  
  let geocodeRes = null;
  if (!isPin && userText) {
    geocodeRes = await geocodingService.geocodeText(userText);
  }

  const isOverride = isPin || (geocodeRes && (
    geocodeRes.isPrecise || 
    geocodeRes.isFuzzyMatch || 
    (geocodeRes.ambiguityResults && geocodeRes.ambiguityResults.length > 0) || 
    geocodeRes.kota
  ));

  if (isOverride) {
    console.log(`[LOCATION CONFIRMATION OVERRIDE] Customer sent new location input. Redirecting to handleLocationState.`);
    const { handleLocationState } = await import('./location');
    return handleLocationState(ctx);
  }

  const isAffirmative = /\b(iya|yup|ok|oke|bener|betul|lanjut|benar|yes|sip|gpp)\b/i.test(lower) || 
                        /^ya\b(?!\s*(ampun|elah|udah|deh|lord|allah|kali|gitu|begitu|tapi|bukan|salah|kok|sih))/i.test(lower) || 
                        lower.includes('👍');
  const isNegative = /\b(bukan|ga|gak|tidak|no|salah|enggak)\b/i.test(lower) || lower.includes('👎') || lower.includes('❌');

  if (isAffirmative && isNegative) {
    return {
      nextState: ConversationState.LOCATION_CONFIRMED,
      replyText: TEMPLATES.askClarifyMixedSignal(),
      shouldSendReply: true,
    };
  }

  // 3. AFFIRMATIVE CHECK -> Alur Promosi (Atomic Transaction)
  if (isAffirmative) {
    if (customer.pending_kelurahan && customer.pending_lat && customer.pending_lng) {
      console.log(`[PROMOTION START] Promoting pending location to confirmed for customer ${customer.id}`);
      
      const promoteResult = await customerService.promotePendingLocation(
        customer.id,
        {
          pending_kelurahan: customer.pending_kelurahan,
          pending_kecamatan: customer.pending_kecamatan || '',
          pending_kota: customer.pending_kota || '',
          pending_lat: customer.pending_lat,
          pending_lng: customer.pending_lng,
        },
        async (coords) => {
          return deliveryService.calculateDelivery(coords);
        },
        tenantId
      );

      if (promoteResult.success) {
        // Ambil data customer terupdate setelah commit transaksi
        const updatedCustomer = await customerService.getOrCreateCustomer(customer.phone, customer.name || undefined, tenantId);
        
        // JIKA Jarak di luar jangkauan (>30 km)
        if (updatedCustomer.is_out_of_coverage) {
          return {
            nextState: ConversationState.COMPLETED,
            replyText: TEMPLATES.outOfCoverage({ distanceKm: updatedCustomer.distance_km || 0 }),
            shouldSendReply: true,
          };
        }

        // Hitung detail ongkir normal & promo
        const delivery = await deliveryService.calculateDelivery({ lat: updatedCustomer.lat!, lng: updatedCustomer.lng! });

        return {
          nextState: ConversationState.AWAITING_INTEREST,
          replyText: TEMPLATES.ongkirInfo({
            distanceKm: delivery.distanceKm,
            normalPrice: delivery.normalPrice,
            promoPrice: delivery.promoPrice,
          }),
          shouldSendReply: true,
          sendPricelistImage: true,
        };
      } else {
        // Fallback jika transaksi gagal/calculateDelivery error di tengah jalan
        return {
          nextState: ConversationState.LOCATION_CONFIRMED,
          replyText: `Ada gangguan teknis sebentar bunda 🙏 mohon maaf, bisa diulangi sebutkan alamat Bunda kembali ya bund? 😊`,
          shouldSendReply: true,
        };
      }
    } else {
      return {
        nextState: ConversationState.AWAITING_LOCATION,
        replyText: TEMPLATES.askKelurahanDetail(),
        shouldSendReply: true,
      };
    }
  }

  // 4. NEGATIVE CHECK -> Bersihkan data pending dan minta input ulang kelurahan
  if (isNegative) {
    await customerService.clearPendingLocation(customer.id, tenantId);
    return {
      nextState: ConversationState.AWAITING_LOCATION,
      replyText: TEMPLATES.askKelurahanDetail(),
      shouldSendReply: true,
    };
  }

  // 5. NO-MATCH FALLBACK -> Ulangi pertanyaan konfirmasi
  if (customer.pending_kelurahan) {
    return {
      nextState: ConversationState.LOCATION_CONFIRMED,
      replyText: TEMPLATES.confirmLocationFailedRetry({
        kelurahan: customer.pending_kelurahan,
        kecamatan: customer.pending_kecamatan || '',
      }),
      shouldSendReply: true,
    };
  }

  return {
    nextState: ConversationState.AWAITING_LOCATION,
    replyText: TEMPLATES.askKelurahanDetail(),
    shouldSendReply: true,
  };
}
