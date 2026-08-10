import { prisma } from '../db/client';
import { memoryAdClicks } from '../routes/tracking.route';
import { capiService } from './capi.service';

export interface MatchAdClickParams {
  bodyText: string;
  isNewCustomerRecord: boolean;
  customer: any;
  tenantId: string;
  referral?: {
    ctwaClid?: string;
    sourceUrl?: string;
    sourceType?: string;
    headline?: string;
    body?: string;
  };
}

export interface MatchAdClickResult {
  matched: boolean;
  trackingCode?: string;
  ctwaClid?: string;
  strippedText: string;
  adClick?: any;
}

/**
 * Shared service for matching AdClick attribution across WAHA & WABA webhooks.
 * Encapsulates regex matching, CTWA referral handling, memory & DB atomic updates,
 * text stripping, and firing Meta CAPI 'Contact' events.
 */
export async function matchAdClickAndFireContact(
  params: MatchAdClickParams
): Promise<MatchAdClickResult> {
  const { bodyText, isNewCustomerRecord, customer, tenantId, referral } = params;

  const promoMatch = bodyText ? bodyText.match(/(?:Promo\s*)?\[(\w{2,4})\]/i) : null;
  const trackingCode = promoMatch ? promoMatch[1] : undefined;
  const ctwaClid = referral?.ctwaClid;

  let matched = false;
  let matchedAdClick: any = null;

  if (isNewCustomerRecord) {
    // 1. Priority 1: Native Click-to-WhatsApp (ctwa_clid) from Meta Referral payload
    if (ctwaClid) {
      try {
        const result = await prisma.adClick.create({
          data: {
            ctwa_clid: ctwaClid,
            landingUrl: referral?.sourceUrl || undefined,
            matchedAt: new Date(),
            customerId: customer.id,
            tenant_id: tenantId,
            phone: customer.phone,
          },
        });
        matched = true;
        matchedAdClick = result;
        console.log(`[ATTRIBUTION SUCCESS - CTWA] Linked ctwa_clid ${ctwaClid} to new customer ${customer.phone}`);
      } catch (err: any) {
        console.error('[ATTRIBUTION ERROR - CTWA] Failed to create CTWA AdClick:', err.message);
      }
    }

    // 2. Priority 2: Text-based Promo Code regex match [a7x9]
    if (!matched && promoMatch && trackingCode) {
      // Memory cache fallback (for unit tests / in-memory mode)
      if (memoryAdClicks && typeof memoryAdClicks.get === 'function') {
        const memClick = memoryAdClicks.get(trackingCode);
        if (memClick) {
          if (!memClick.matchedAt) {
            memClick.matchedAt = new Date();
            memClick.customerId = customer.id;
            console.log(`[ATTRIBUTION SUCCESS - MEMORY] Linked trackingCode ${trackingCode} to customer ${customer.phone}`);
          }
        }
      }

      // Atomic DB updateMany to avoid race conditions
      try {
        const updateResult = await prisma.adClick.updateMany({
          where: {
            trackingCode,
            matchedAt: null,
          },
          data: {
            matchedAt: new Date(),
            customerId: customer.id,
          },
        });

        if (updateResult.count === 1) {
          matched = true;
          console.log(`[ATTRIBUTION SUCCESS] Linked trackingCode ${trackingCode} to new customer ${customer.phone}`);
          matchedAdClick = await prisma.adClick.findFirst({
            where: { trackingCode, customerId: customer.id },
          });
        }
      } catch (err: any) {
        console.error('[ATTRIBUTION ERROR] Failed to update AdClick attribution:', err.message);
      }
    }

    // 3. Fire Meta CAPI 'Contact' event for all new customers (Paid or Organic)
    try {
      capiService.sendCapiEvent({
        eventName: 'Contact',
        customer,
        adClick: matchedAdClick || undefined,
        tenantId,
        customData: {
          trackingCode: trackingCode || undefined,
          ctwaClid: ctwaClid || undefined,
          source: matched ? 'WHATSAPP_INBOUND_CTA' : 'WHATSAPP_INBOUND_ORGANIC',
        },
      }).catch((err) => console.error('[CAPI CONTACT ERROR]', err.message));
    } catch (capiErr: any) {
      console.error('[CAPI CONTACT ERROR]', capiErr.message);
    }
  }

  // Calculate stripped text (removes Promo[code] prefix/suffix for AI processing)
  let strippedText = bodyText;
  if (promoMatch && bodyText) {
    const stripped = bodyText.replace(/(?:Promo\s*)?\[\w{2,4}\]\s*/gi, '').trim();
    strippedText = stripped || 'Halo';
  }

  return {
    matched,
    trackingCode,
    ctwaClid,
    strippedText,
    adClick: matchedAdClick,
  };
}
