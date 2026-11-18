import { randomUUID } from 'crypto';
import { prisma } from '../db/client';
import { memoryAdClicks } from '../routes/tracking.route';
import { capiService, getTenantCapiFormats, maskPhone } from './capi.service';
import { ctwaTextCatcherService } from './ctwa-text-catcher.service';
import { escapeRegex } from '../utils/regex-escape';
import type { AdReferral } from '../integrations/whatsapp/gateway.types';

/**
 * Ekstrak prefix tag sebelum `[` dari konfigurasi `Tenant.format_visit`
 * (mis. `Promo[%ID%]` → `'Promo'`, `Ref [%ID%]` → `'Ref'`, `[%ID%]` → `''`).
 */
function extractFormatVisitPrefix(formatVisit?: string): string {
  const raw = String(formatVisit || '').trim();
  const bracketIdx = raw.indexOf('[');
  if (bracketIdx <= 0) return '';
  return raw.slice(0, bracketIdx).trim();
}

export interface CustomerIdentity {
  id: string;
  phone: string;
  tenant_id?: string;
  [key: string]: unknown;
}

export interface MatchAdClickParams {
  bodyText: string;
  isNewCustomerRecord: boolean;
  customer: CustomerIdentity;
  tenantId: string;
  referral?: AdReferral;
  /** Timestamp pesan customer terakhir (state DB) — untuk guard idle > 24 jam pada fuzzy catcher. */
  lastCustomerMessageAt?: Date | string | null;
}

export interface MatchAdClickResult {
  matched: boolean;
  trackingCode?: string;
  ctwaClid?: string;
  strippedText: string;
  adClick?: Record<string, unknown> | null;
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

  const bracketMatch = bodyText ? bodyText.match(/\[\s*([\w\s-]{2,32}?)\s*\]/) : null;
  const rawBracketInner = bracketMatch ? bracketMatch[1].trim() : '';
  const trackingCode = rawBracketInner ? rawBracketInner.replace(/\s+/g, '') : undefined;
  const ctwaClid = referral?.ctwaClid;

  // A-003 (Data-Driven, anti-hardcode): evaluasi kecocokan prefix tag Direct CTWA dari `Tenant.format_visit`.
  // Di-cache per-call agar DB hanya diquery bila benar-benar dibutuhkan.
  let cachedVisitPrefix: string | null = null;
  const resolveConfiguredVisitPrefix = async (): Promise<string> => {
    if (cachedVisitPrefix !== null) return cachedVisitPrefix;
    const formats = await getTenantCapiFormats(tenantId);
    cachedVisitPrefix = extractFormatVisitPrefix(formats.formatVisit);
    return cachedVisitPrefix;
  };
  const isValidDirectCtwaTag = async (): Promise<boolean> => {
    if (!bracketMatch || bracketMatch.index === undefined || !rawBracketInner) return false;
    const prefix = await resolveConfiguredVisitPrefix();
    if (prefix) {
      const beforeBracket = bodyText.slice(0, bracketMatch.index).trimEnd();
      return new RegExp(`(?:^|\\s)${escapeRegex(prefix)}$`, 'i').test(beforeBracket);
    }
    // Tenant mengonfigurasi format_visit tanpa prefix (mis. "[%ID%]"):
    // izinkan hanya token kode tanpa spasi (mis. [IG-BABYSPA]), tetap tolak frasa bebas seperti [Pijat Bayi].
    return !/\s/.test(rawBracketInner);
  };

  let matched = false;
  let isNewlyLinked = false;
  let matchedAdClick: any = null;
  let fuzzyScore: number | undefined;
  let fuzzyCampaign: string | undefined;

  // 1. Priority 1: Native Click-to-WhatsApp (ctwa_clid) from Meta Referral payload (WABA)
  if (ctwaClid) {
    try {
      let existingAdClick: any = null;
      try {
        existingAdClick = await prisma.adClick.findUnique({
          where: { customerId: customer.id },
        });
      } catch {
        // Best-effort: bila DB offline atau unit test mock
      }

      if (existingAdClick) {
        const updated = await prisma.adClick.update({
          where: { id: existingAdClick.id },
          data: {
            ctwa_clid: ctwaClid,
            landingUrl: referral?.sourceUrl || existingAdClick.landingUrl || undefined,
            utmSource: referral?.sourceApp || existingAdClick.utmSource || 'meta',
            utmMedium: existingAdClick.utmMedium || 'ctwa',
            utmCampaign: referral?.sourceId || existingAdClick.utmCampaign || 'ctwa_direct',
            matchedAt: new Date(),
            phone: customer.phone,
          },
        });
        matched = true;
        isNewlyLinked = true;
        matchedAdClick = updated;
        console.log(`[ATTRIBUTION SUCCESS - CTWA REPEAT] Updated ctwa_clid ${ctwaClid} on existing customer ${maskPhone(customer.phone)}`);
      } else {
        const result = await prisma.adClick.create({
          data: {
            ctwa_clid: ctwaClid,
            landingUrl: referral?.sourceUrl || undefined,
            utmSource: referral?.sourceApp || 'meta',
            utmMedium: 'ctwa',
            utmCampaign: referral?.sourceId || 'ctwa_direct',
            matchedAt: new Date(),
            customerId: customer.id,
            tenant_id: tenantId,
            phone: customer.phone,
          },
        });
        matched = true;
        isNewlyLinked = true;
        matchedAdClick = result;
        console.log(`[ATTRIBUTION SUCCESS - CTWA] Linked ctwa_clid ${ctwaClid} to customer ${maskPhone(customer.phone)}`);
      }
    } catch (err: any) {
      console.error('[ATTRIBUTION ERROR - CTWA] Failed to link CTWA AdClick:', err.message);
    }
  }

  // 2. Priority 2: Text-based Promo Code match [IG-BABYSPA] / [64] (Website CTA & WAHA Direct CTWA)
  if (!matched && bracketMatch && trackingCode) {
    // Memory cache fallback (for unit tests / in-memory mode)
    if (memoryAdClicks && typeof memoryAdClicks.get === 'function') {
      const memClick = memoryAdClicks.get(trackingCode);
      const isExpired = memClick?.createdAt && (Date.now() - new Date(memClick.createdAt).getTime()) > 7 * 24 * 60 * 60 * 1000;
      if (memClick && !isExpired) {
        if (memClick.tenant_id && memClick.tenant_id !== tenantId) {
          console.warn(`[ATTRIBUTION ISOLATION] Memory click ${trackingCode} belongs to tenant ${memClick.tenant_id}, not ${tenantId}. Skipped.`);
        } else {
          if (!memClick.matchedAt) {
            memClick.matchedAt = new Date();
            memClick.customerId = customer.id;
            isNewlyLinked = true;
            console.log(`[ATTRIBUTION SUCCESS - MEMORY] Linked trackingCode ${trackingCode} to customer ${maskPhone(customer.phone)}`);
          }
          matched = true;
          matchedAdClick = memClick;
        }
      }
    }

    // Atomic DB update / link to avoid race conditions and P2002 on repeat customer
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const now = new Date();

      // Cek apakah customer sudah memiliki AdClick sebelumnya (mencegah P2002 @unique customerId)
      let existingAdClick: any = null;
      try {
        existingAdClick = await prisma.adClick.findUnique({
          where: { customerId: customer.id },
        });
      } catch {
        // Best-effort: bila DB offline atau unit test mock
      }

      if (existingAdClick) {
        // Customer sudah memiliki record AdClick.
        // 1. Cari apakah ada Web CTA AdClick yang belum di-claim dengan trackingCode ini
        let incomingClick: any = null;
        try {
          incomingClick = await prisma.adClick.findFirst({
            where: {
              trackingCode,
              ...(tenantId ? { tenant_id: tenantId } : {}),
              matchedAt: null,
              customerId: null,
              OR: [
                { expires_at: { gt: now } },
                { expires_at: null, createdAt: { gte: sevenDaysAgo } },
              ],
            },
          });
        } catch {
          // Best-effort
        }

        if (incomingClick) {
          // P0-2 (A-003): Hapus incomingClick LEBIH DULU sebelum update existingAdClick dalam transaksi atomik.
          // Schema AdClick memiliki @@unique([tenant_id, trackingCode]) dan @unique customerId;
          // update sebelum delete masih memicu P2002 karena incomingClick memegang trackingCode yang sama.
          const mergedData = {
            trackingCode: incomingClick.trackingCode || trackingCode,
            utmCampaign: incomingClick.utmCampaign || existingAdClick.utmCampaign,
            utmSource: incomingClick.utmSource || existingAdClick.utmSource,
            utmMedium: incomingClick.utmMedium || existingAdClick.utmMedium,
            fbclid: incomingClick.fbclid || existingAdClick.fbclid,
            fbc: incomingClick.fbc || existingAdClick.fbc,
            fbp: incomingClick.fbp || existingAdClick.fbp,
            landingUrl: incomingClick.landingUrl || existingAdClick.landingUrl,
            ipAddress: incomingClick.ipAddress || existingAdClick.ipAddress,
            userAgent: incomingClick.userAgent || existingAdClick.userAgent,
            matchedAt: new Date(),
            phone: customer.phone,
          };
          const updated = await prisma.$transaction(async (tx) => {
            await tx.adClick.delete({ where: { id: incomingClick.id } });
            return tx.adClick.update({
              where: { id: existingAdClick.id },
              data: mergedData,
            });
          });
          matched = true;
          isNewlyLinked = true;
          matchedAdClick = updated;
          console.log(`[ATTRIBUTION SUCCESS - WEB CTA REPEAT] Updated existing AdClick for customer ${maskPhone(customer.phone)} with trackingCode ${trackingCode}`);
        } else {
          // Direct CTWA atau klik lama: cek apakah campaign tag sama persis
          const isSameCampaign = existingAdClick.utmCampaign === trackingCode || existingAdClick.trackingCode === trackingCode;
          if (isSameCampaign) {
            matched = true;
            isNewlyLinked = false; // Sudah pernah ter-link, BUKAN touchpoint baru
            matchedAdClick = existingAdClick;
          } else if (await isValidDirectCtwaTag()) {
            // Repeat lead dengan campaign tag sesuai format_visit tenant -> update record
            const updated = await prisma.adClick.update({
              where: { id: existingAdClick.id },
              data: {
                utmCampaign: trackingCode,
                utmSource: 'whatsapp_direct',
                matchedAt: new Date(),
                phone: customer.phone,
              },
            });
            matched = true;
            isNewlyLinked = true;
            matchedAdClick = updated;
            console.log(`[ATTRIBUTION SUCCESS - DIRECT CTWA REPEAT] Updated campaign tag ${trackingCode} on customer ${maskPhone(customer.phone)}`);
          }
        }
      } else {
        // Customer baru tanpa AdClick -> Coba link ke Web CTA AdClick (trackingCode di query landing page)
        const updateResult = await prisma.adClick.updateMany({
          where: {
            trackingCode,
            ...(tenantId ? { tenant_id: tenantId } : {}),
            matchedAt: null,
            customerId: null,
            OR: [
              { expires_at: { gt: now } },
              { expires_at: null, createdAt: { gte: sevenDaysAgo } },
            ],
          },
          data: {
            matchedAt: new Date(),
            customerId: customer.id,
          },
        });

        if (updateResult.count === 1) {
          matched = true;
          isNewlyLinked = true;
          console.log(`[ATTRIBUTION SUCCESS - WEB CTA] Linked trackingCode ${trackingCode} to customer ${maskPhone(customer.phone)}`);
          matchedAdClick = await prisma.adClick.findFirst({
            where: { trackingCode, customerId: customer.id },
          });
        } else if (await isValidDirectCtwaTag()) {
          // Customer baru tanpa AdClick web, tetapi cocok format_visit tenant -> Buat record Direct CTWA.
          // Teks bracket arbitrer seperti [Pijat Bayi] TIDAK boleh membuat AdClick palsu.
          const uniqueTrackingCode = `ctwa_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
          try {
            const directAdClick = await prisma.adClick.create({
              data: {
                trackingCode: uniqueTrackingCode,
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
            console.log(`[ATTRIBUTION SUCCESS - DIRECT CTWA] Created direct AdClick for campaign tag ${trackingCode} (code: ${uniqueTrackingCode}) on customer ${maskPhone(customer.phone)}`);
          } catch (createErr: any) {
            console.warn('[ATTRIBUTION WARNING - DIRECT CTWA] Failed to create direct AdClick:', createErr.message);
          }
        }
      }
    } catch (err: any) {
      console.error('[ATTRIBUTION ERROR] Failed to update AdClick attribution:', err.message);
    }
  }

  // 3. Priority 3: CTWA Greeting Catcher (fuzzy multi-template + toleransi typo/slang).
  // Guard berbasis STATE (bukan pencocokan teks): hanya dievaluasi bila customer BARU,
  // percakapan IDLE > 24 jam, atau belum punya atribusi aktif. Mencegah pesan di tengah
  // konsultasi medis salah teratribusi. Teks TIDAK dimutilasi.
  if (!matched && bodyText && bodyText.trim().length > 0) {
    const IDLE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
    const lastTs = params.lastCustomerMessageAt ? new Date(params.lastCustomerMessageAt).getTime() : NaN;
    const isIdle = Number.isFinite(lastTs) ? Date.now() - lastTs > IDLE_THRESHOLD_MS : false;

    let hasExistingAttribution = false;
    let isRepeatCustomer = false;
    if (!isNewCustomerRecord) {
      try {
        const existing = await prisma.adClick.findUnique({ where: { customerId: customer.id } });
        if (existing) {
          hasExistingAttribution = Boolean(existing.ctwa_clid || existing.utmCampaign);
        }
      } catch {
        // Best-effort: DB offline / unit test mock → anggap belum ber-atribusi.
      }

      try {
        const resCount = await prisma.reservation.count({
          where: {
            customer_id: customer.id,
            ...(tenantId ? { tenant_id: tenantId } : {}),
            status: { in: ['confirmed', 'en_route', 'completed'] },
          },
        });
        isRepeatCustomer = resCount > 0;
      } catch {
        // Best-effort: DB offline / unit test mock
      }
    }

    // Fase 3.2: State-Gated Fuzzy CTWA Greeting Catcher
    // HANYA aktif jika:
    // 1. Customer BUKAN repeat customer (belum pernah memiliki reservasi closing/confirmed)
    // 2. Merupakan customer baru ATAU belum memiliki atribusi sama sekali ATAU percakapan sudah idle >24 jam
    const isEligibleForFuzzyMatch =
      !isRepeatCustomer &&
      (isNewCustomerRecord || !hasExistingAttribution || isIdle);

    if (isEligibleForFuzzyMatch) {
      try {
        const catchResult = await ctwaTextCatcherService.matchInboundText(bodyText, tenantId);
        if (catchResult?.matched) {
          const uniqueTrackingCode = `ctwa_fuzzy_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
          try {
            let existingAdClick: any = null;
            try {
              existingAdClick = await prisma.adClick.findUnique({
                where: { customerId: customer.id },
              });
            } catch {
              // Best-effort: bila DB offline atau unit test mock
            }

            let fuzzyClick: any = null;
            if (existingAdClick) {
              fuzzyClick = await prisma.adClick.update({
                where: { id: existingAdClick.id },
                data: {
                  utmCampaign: catchResult.campaignName || 'ctwa_fuzzy',
                  utmSource: catchResult.source || 'meta',
                  utmMedium: 'ctwa_fuzzy',
                  matchedAt: new Date(),
                  phone: customer.phone,
                },
              });
              console.log(
                `[ATTRIBUTION SUCCESS - CTWA FUZZY REPEAT] Updated campaign ${catchResult.campaignName} (score ${catchResult.effectiveScore.toFixed(2)}) on customer ${maskPhone(customer.phone)}`
              );
            } else {
              fuzzyClick = await prisma.adClick.create({
                data: {
                  trackingCode: uniqueTrackingCode,
                  utmCampaign: catchResult.campaignName || 'ctwa_fuzzy',
                  utmSource: catchResult.source || 'meta',
                  utmMedium: 'ctwa_fuzzy',
                  matchedAt: new Date(),
                  customerId: customer.id,
                  tenant_id: tenantId,
                  phone: customer.phone,
                },
              });
              console.log(
                `[ATTRIBUTION SUCCESS - CTWA FUZZY] Linked campaign ${catchResult.campaignName} (score ${catchResult.effectiveScore.toFixed(2)}) to customer ${maskPhone(customer.phone)}`
              );
            }
            matched = true;
            isNewlyLinked = true;
            matchedAdClick = fuzzyClick;
            fuzzyScore = catchResult.effectiveScore;
            fuzzyCampaign = catchResult.campaignName || undefined;
          } catch (createErr: any) {
            // DB offline pada test/fallback: pertahankan hasil match in-memory agar CAPI tetap bisa dinilai.
            matched = true;
            isNewlyLinked = true;
            matchedAdClick = matchedAdClick || {
              trackingCode: uniqueTrackingCode,
              utmCampaign: catchResult.campaignName,
              utmSource: catchResult.source,
              utmMedium: 'ctwa_fuzzy',
              matchedAt: new Date(),
              customerId: customer.id,
            };
            fuzzyScore = catchResult.effectiveScore;
            fuzzyCampaign = catchResult.campaignName || undefined;
            console.warn('[ATTRIBUTION WARNING - CTWA FUZZY] Failed to link AdClick:', createErr.message);
          }
        }
      } catch (fuzzyErr: any) {
        console.warn('[ATTRIBUTION WARNING - CTWA FUZZY] Catcher evaluation failed:', fuzzyErr.message);
      }
    }
  }

  // 4. Fire Meta CAPI 'Contact' event DENGAN GUARD MULTI-LAPIS (Idempotensi + 10s Debounce + 24h Cooldown)
  const phoneKey = (customer?.phone || '').replace(/\D/g, '');
  const isPaidTouch = Boolean(isNewlyLinked);
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
      console.log(`[CAPI GUARD] Skipped Contact event for ${maskPhone(phoneKey)}: concurrent burst lock active (< 10s).`);
    } else if (isIn24hCooldown && !isNewlyLinked) {
      console.log(`[CAPI GUARD] Skipped Contact event for ${maskPhone(phoneKey)}: 24h cooldown active.`);
    } else {
      contactBurstLock.set(phoneKey, now);
      if (isNewlyLinked) {
        contactCooldown24h.set(phoneKey, now);
      }

      try {
        capiService.sendCapiEvent({
          eventName: 'Contact',
          customer,
          adClick: matchedAdClick || undefined,
          tenantId,
          customData: {
            trackingCode: trackingCode || undefined,
            ctwaClid: ctwaClid || undefined,
            fuzzyScore: fuzzyScore !== undefined ? Number(fuzzyScore.toFixed(4)) : undefined,
            fuzzyCampaign: fuzzyCampaign || undefined,
            source: matched ? 'WHATSAPP_INBOUND_CTA' : 'WHATSAPP_INBOUND_ORGANIC',
            isPaidTouch,
          },
        }).catch((err) => console.error('[CAPI CONTACT ERROR]', err.message));
      } catch (capiErr: any) {

        console.error('[CAPI CONTACT ERROR]', capiErr.message);
      }
    }
  }

  // Calculate stripped text (removes configured prefix + [code] for AI processing)
  let strippedText = bodyText;
  if (bracketMatch && bodyText && (matched || (await isValidDirectCtwaTag()))) {
    const prefix = await resolveConfiguredVisitPrefix();
    const stripPattern = prefix
      ? new RegExp(`(?:${escapeRegex(prefix)}\\s*)?\\[\\s*([\\w\\s-]{2,32}?)\\s*\\]\\s*`, 'gi')
      : /\[\s*([\w\s-]{2,32}?)\s*\]\s*/gi;
    const stripped = bodyText.replace(stripPattern, '').trim();
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
