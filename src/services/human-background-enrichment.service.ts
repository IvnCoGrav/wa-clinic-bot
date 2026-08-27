import { DEFAULT_TENANT_ID } from '../config/tenant';
import { StateHandlerContext } from '../state-machine/types';

const FILLER_RE = /^(oke\s+makasih|makasih|terima\s+kasih|matur\s+nuwun|thanks|thank\s+you|sip|ok|oke|siap|baik|iya|ya|boleh|nanti\s+ya|sebentar\s+cek\s+dulu|tanya\s+suami|wait|tunggu\s+sebentar)[.!]?$/i;

function isFillerOnly(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 3) return true;
  if (FILLER_RE.test(t)) return true;
  return false;
}

export class HumanBackgroundEnrichmentService {
  public enrichAsync(ctx: StateHandlerContext, tenantId?: string): void {
    const tid = tenantId || (ctx.customer as any)?.tenant_id || DEFAULT_TENANT_ID;
    void this.enrichSync(ctx, tid).catch((err: any) => {
      console.warn('[HUMAN ENRICH] async failed:', err?.message || err);
    });
  }

  public async enrichSync(ctx: StateHandlerContext, tenantId: string = DEFAULT_TENANT_ID): Promise<{ enriched: boolean; reason: string }> {
    const customer: any = ctx.customer;
    const incomingMessage: any = ctx.incomingMessage;
    const incomingText: string = incomingMessage?.text?.body || '';
    const tid = tenantId || customer?.tenant_id || DEFAULT_TENANT_ID;

    try {
      if (incomingMessage?.type === 'location' && incomingMessage.location) {
        const lat = Number(incomingMessage.location.latitude);
        const lng = Number(incomingMessage.location.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
          const { geocodingService } = await import('../integrations/google-maps/geocoding');
          const { deliveryService } = await import('./delivery.service');
          const { customerService } = await import('./customer.service');
          const resolved = await geocodingService.reverseGeocode(lat, lng);
          const delivery = await deliveryService.calculateDelivery({ lat, lng }, undefined, tid);
          await customerService.updateCustomerLocation(customer.id, {
            kelurahan: resolved.kelurahan,
            kecamatan: resolved.kecamatan,
            kota: resolved.kota,
            lat,
            lng,
            distanceKm: delivery.distanceKm,
            ongkir: delivery.ongkir,
            isOutOfCoverage: delivery.isOutOfCoverage,
            zipcode: resolved.zipcode,
            isNativePin: true,
          }, tid);
          await customerService.markShareLocationSent(customer.id, tid);
          console.log(`[HUMAN ENRICH] GPS pin saved for ${customer.phone}: ${delivery.distanceKm}km ongkir ${delivery.ongkir}`);
          return { enriched: true, reason: 'gps_pin' };
        }
      }

      if (incomingText && incomingText.trim()) {
        const { isReservationFormMessage, parseReservationText } = await import('../utils/reservation-text-parser');
        const isForm = isReservationFormMessage(incomingText);
        if (isForm) {
          const parsed = parseReservationText(incomingText);
          if (parsed.success && parsed.reservation) {
            const r = parsed.reservation;
            const parts = [r.address, r.kec, r.kota].filter(Boolean).join(', ');
            const query = parts.length >= 3 ? parts : [r.kec, r.kota].filter(Boolean).join(', ') || r.address || parts;
            if (query) {
              const needsLocation = customer.lat == null || customer.lng == null || customer.distance_km == null;
              if (needsLocation) {
                try {
                  const { geocodingService } = await import('../integrations/google-maps/geocoding');
                  const { deliveryService } = await import('./delivery.service');
                  const { customerService } = await import('./customer.service');
                  if (customer.share_location_sent) {
                    console.log(`[HUMAN ENRICH] form geocode skipped for ${customer.phone} — GPS pin already exists`);
                  } else {
                    const resolved = await geocodingService.geocodeText(query);
                    if (resolved.isPrecise && resolved.lat != null && resolved.lng != null) {
                      const delivery = await deliveryService.calculateDelivery({ lat: resolved.lat, lng: resolved.lng }, undefined, tid);
                      await customerService.updateCustomerLocation(customer.id, {
                        kelurahan: resolved.kelurahan,
                        kecamatan: resolved.kecamatan,
                        kota: resolved.kota,
                        lat: resolved.lat,
                        lng: resolved.lng,
                        distanceKm: delivery.distanceKm,
                        ongkir: delivery.ongkir,
                        isOutOfCoverage: delivery.isOutOfCoverage,
                        zipcode: resolved.zipcode,
                      }, tid);
                      console.log(`[HUMAN ENRICH] form location saved for ${customer.phone}: ${resolved.kelurahan} ${delivery.distanceKm}km`);
                      return { enriched: true, reason: 'form_location' };
                    } else {
                      console.log(`[HUMAN ENRICH] form geocode not precise for ${customer.phone}: "${query}" -> isPrecise=${resolved.isPrecise}`);
                    }
                  }
                } catch (e: any) {
                  console.warn('[HUMAN ENRICH] form geocode failed:', e.message);
                }
              }
            }
          }
        }
      }

      const textForEnrich = incomingText?.trim() || '';
      if (!textForEnrich || isFillerOnly(textForEnrich)) {
        return { enriched: false, reason: 'filler_or_empty' };
      }

      if (customer.lat != null && customer.lng != null && customer.distance_km != null) {
        return { enriched: false, reason: 'already_has_location' };
      }

      const { EntityExtractor } = await import('../slot-engine/entity-extractor');
      const history = (ctx as any).history || [];
      const extraction = await EntityExtractor.extract(textForEnrich, {
        history,
        customerPhone: customer.phone,
        conversationId: ctx.conversation?.id,
        tenantId: tid,
        incomingMessage,
      });

      const hasLocation = Boolean(extraction.locationText && extraction.locationText.trim().length > 1);
      const hasProvideIntent = (extraction.intents || []).includes('provide_location');
      if (!hasLocation && !hasProvideIntent) {
        return { enriched: false, reason: 'no_location_intent' };
      }
      const locationText = extraction.locationText || '';
      if (locationText.trim().length < 2) {
        return { enriched: false, reason: 'location_too_short' };
      }

      const compositeAddress = [extraction.streetDetail, extraction.locationText].filter(Boolean).join(', ');
      const rawText = textForEnrich;
      const candidateQuery = compositeAddress.length > 5
        ? compositeAddress
        : (rawText && (/\b(kel|kelurahan|desa|ds|jl|jalan|gang|gg|perum|no)\b/i.test(rawText) || rawText.length > (extraction.locationText?.length || 0)))
          ? rawText
          : extraction.locationText || rawText;

      const { geocodingService } = await import('../integrations/google-maps/geocoding');
      const resolved = await geocodingService.geocodeText(candidateQuery);
      if (!resolved.isPrecise || resolved.lat == null || resolved.lng == null) {
        console.log(`[HUMAN ENRICH] geocode not precise for ${customer.phone}: "${candidateQuery}" -> isPrecise=${resolved.isPrecise}`);
        return { enriched: false, reason: 'geocode_not_precise' };
      }

      if (customer.share_location_sent) {
        console.log(`[HUMAN ENRICH] text location skipped for ${customer.phone} — GPS pin already exists`);
        return { enriched: false, reason: 'gps_pin_guard' };
      }

      const { deliveryService } = await import('./delivery.service');
      const { customerService } = await import('./customer.service');
      const delivery = await deliveryService.calculateDelivery({ lat: resolved.lat, lng: resolved.lng }, undefined, tid);
      await customerService.updateCustomerLocation(customer.id, {
        kelurahan: resolved.kelurahan,
        kecamatan: resolved.kecamatan,
        kota: resolved.kota,
        lat: resolved.lat,
        lng: resolved.lng,
        distanceKm: delivery.distanceKm,
        ongkir: delivery.ongkir,
        isOutOfCoverage: delivery.isOutOfCoverage,
        zipcode: resolved.zipcode,
      }, tid);
      console.log(`[HUMAN ENRICH] text location saved for ${customer.phone}: ${resolved.kelurahan}, ${resolved.kecamatan} ${delivery.distanceKm}km ongkir ${delivery.ongkir}`);
      return { enriched: true, reason: 'text_location' };
    } catch (err: any) {
      console.warn('[HUMAN ENRICH] failed:', err?.message || err);
      return { enriched: false, reason: 'error' };
    }
  }
}

export const humanBackgroundEnrichmentService = new HumanBackgroundEnrichmentService();
