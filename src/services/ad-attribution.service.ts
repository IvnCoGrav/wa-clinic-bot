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

// In-memory cache untuk mencegah race condition / burst call Contact dari multiple incoming bubbles
const contactBurstLock = new Map<string, number>();
const contactCooldown24h = new Map<string, number>();

function pruneCooldownMap(map: Map<string, number>, maxAgeMs: number) {
  const now = Date.now();
  for (const [key, timestamp] of map.entries()) {
    if (now - timestamp > maxAgeMs) {
      map.delete(key);
    }
  }
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

  const promoMatch = bodyText ? bodyText.match(/(?:Promo\s*)?\[\s*([\w\s-]{2,32}?)\s*\]/i) : null;
  const trackingCode = promoMatch ? promoMatch[1].replace(/\s+/g, '') : undefined;
  const ctwaClid = referral?.ctwaClid;

  let matched = false;
  let isNewlyLinked = false;
  let matchedAdClick: any = null;

  // 1. Priority 1: Native Click-to-WhatsApp (ctwa_clid) from Meta Referral payload (WABA)
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
      isNewlyLinked = true;
      matchedAdClick = result;
      console.log(`[ATTRIBUTION SUCCESS - CTWA] Linked ctwa_clid ${ctwaClid} to customer ${customer.phone}`);
    } catch (err: any) {
      console.error('[ATTRIBUTION ERROR - CTWA] Failed to create CTWA AdClick:', err.message);
    }
  }

  // 2. Priority 2: Text-based Promo Code regex match [IG-BABYSPA] / [64] (Website CTA & WAHA Direct CTWA)
  if (!matched && promoMatch && trackingCode) {
    // Memory cache fallback (for unit tests / in-memory mode)
    if (memoryAdClicks && typeof memoryAdClicks.get === 'function') {
      const memClick = memoryAdClicks.get(trackingCode);
      if (memClick) {
        if (!memClick.matchedAt) {
          memClick.matchedAt = new Date();
          memClick.customerId = customer.id;
          isNewlyLinked = true;
          console.log(`[ATTRIBUTION SUCCESS - MEMORY] Linked trackingCode ${trackingCode} to customer ${customer.phone}`);
        }
        matched = true;
        matchedAdClick = memClick;
      }
    }

    // Atomic DB updateMany to avoid race conditions on website /cta clicks
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
        isNewlyLinked = true;
        console.log(`[ATTRIBUTION SUCCESS - WEB CTA] Linked trackingCode ${trackingCode} to customer ${customer.phone}`);
        matchedAdClick = await prisma.adClick.findFirst({
          where: { trackingCode, customerId: customer.id },
        });
      } else {
        // Cek apakah sudah pernah ter-link ke customer ini sebelumnya (misal repeat chat dengan kode yang sama)
        const alreadyLinked = await prisma.adClick.findFirst({
          where: { trackingCode, customerId: customer.id },
        });
        if (alreadyLinked) {
          matched = true;
          isNewlyLinked = false; // ⚠️ Sudah pernah ter-link, BUKAN touchpoint baru
          matchedAdClick = alreadyLinked;
        } else {
          // Direct WAHA CTWA lead (tanpa lewat website /cta) -> Otomatis buat record AdClick baru
          try {
            const directAdClick = await prisma.adClick.create({
              data: {
                trackingCode,
                utmCampaign: trackingCode,
                utmSource: 'whatsapp_direct',
                matchedAt: new Date(),
                customerId: customer.id,
                tenant_id: tenantId,
                phone: customer.phone,
              },
            });
            matched = true;
            isNewlyLinked = true;
            matchedAdClick = directAdClick;
            console.log(`[ATTRIBUTION SUCCESS - DIRECT CTWA] Created direct AdClick for campaign tag ${trackingCode} on customer ${customer.phone}`);
          } catch (createErr: any) {
            console.warn('[ATTRIBUTION WARNING - DIRECT CTWA] Failed to create direct AdClick:', createErr.message);
          }
        }
      }
    } catch (err: any) {
      console.error('[ATTRIBUTION ERROR] Failed to update AdClick attribution:', err.message);
    }
  }

  // 3. Fire Meta CAPI 'Contact' event DENGAN GUARD MULTI-LAPIS (Idempotensi + 10s Debounce + 24h Cooldown)
  const phoneKey = (customer?.phone || '').replace(/\D/g, '');
  const isNewTouchpoint = isNewlyLinked || isNewCustomerRecord;

  if (isNewTouchpoint && phoneKey) {
    const now = Date.now();
    pruneCooldownMap(contactBurstLock, 10_000);
    pruneCooldownMap(contactCooldown24h, 24 * 60 * 60 * 1000);

    const lastBurst = contactBurstLock.get(phoneKey);
    const last24h = contactCooldown24h.get(phoneKey);

    const isBursting = lastBurst && now - lastBurst < 10_000;
    const isIn24hCooldown = last24h && now - last24h < 24 * 60 * 60 * 1000;

    if (isBursting) {
      console.log(`[CAPI GUARD] Skipped Contact event for ${phoneKey}: concurrent burst lock active (< 10s).`);
    } else if (isIn24hCooldown && !isNewlyLinked) {
      console.log(`[CAPI GUARD] Skipped Contact event for ${phoneKey}: 24h cooldown active.`);
    } else {
      contactBurstLock.set(phoneKey, now);
      contactCooldown24h.set(phoneKey, now);

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
  }

  // Calculate stripped text (removes Promo[code] / [IG-BABYSPA] prefix/suffix for AI processing)
  let strippedText = bodyText;
  if (promoMatch && bodyText) {
    const stripped = bodyText.replace(/(?:Promo\s*)?\[\s*([\w\s-]{2,32}?)\s*\]\s*/gi, '').trim();
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
