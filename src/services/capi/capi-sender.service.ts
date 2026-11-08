import axios from 'axios';
import crypto from 'crypto';
import { ParamBuilder, PII_DATA_TYPE } from 'capi-param-builder-nodejs';
import { GRAPH_API_VERSION, GRAPH_API_BASE_URL } from '../../integrations/whatsapp/graph.constants';
import { isDummyOrTestContact } from '../../utils/dummy-filter';
import { hasBypassLabel, checkCustomerBypass } from '../../utils/customer-bypass';
import { prisma } from '../../db/client';
import {
  capiBreaker,
  normalizePhoneToE164,
  maskPhone,
  parseCapiValue,
  formatMetaFbc,
  buildDeterministicPurchaseEventId,
} from './capi-utils';
import {
  resolveTenantCapiCredentials,
  resolveCanonicalLandingUrl,
  resolveNewVsRepeatContext,
  getTenantMetaPurchasePolicy,
  normalizeCapiMatchingGeo,
} from './tenant-config';
import {
  MetaPurchasePolicy,
  SendCapiEventParams,
  SendCapiEventResult,
  TestCapiConnectionParams,
  TestCapiConnectionResult,
} from './types';

export class CapiService {
  private organicContactCooldown = new Map<string, number>();
  private paidContactCooldown = new Map<string, { timestamp: number; campaignKey?: string }>();
  private checkoutCooldown = new Map<string, number>();

  public __clearCooldowns(): void {
    this.organicContactCooldown.clear();
    this.paidContactCooldown.clear();
    this.checkoutCooldown.clear();
  }

  /**
   * Mengirimkan server-side event ke Meta Conversions API (CAPI).
   */
  public async sendCapiEvent(params: SendCapiEventParams): Promise<SendCapiEventResult> {
    const {
      eventName,
      customer,
      adClick,
      value,
      currency,
      tenantId,
      customData,
      eventTime,
      eventId,
      customUserData,
      customEventId,
      reservationId,
    } = params;

    // 1. Meta CAPI Sandbox / Dummy Test Guard & Non-Customer Bypass Guard (Skip / Admin CS)
    const isPageViewEvent = eventName === 'PageView';
    if (
      !isPageViewEvent &&
      (customer?.is_sandbox_test ||
        customer?.is_internal_staff ||
        isDummyOrTestContact(customer?.phone, customer?.name, customer?.is_sandbox_test) ||
        customer?.is_admin_labeled === true ||
        hasBypassLabel(customer) ||
        (await checkCustomerBypass({ customerId: customer?.id, phone: customer?.phone, tenantId })))
    ) {
      console.log(
        `[CAPI GUARD] Skipped sending ${eventName} to Meta CAPI for sandbox/dummy/bypass/internal-staff contact (skip/admin cs): ${maskPhone(
          customer?.phone
        )}`
      );
      return { success: false, message: 'Skipped: Sandbox, dummy test, or non-customer bypass contact (skip/admin cs)' };
    }

    // 1b. Centralized Event Cooldown Guard (Anti-Burst & Idempotency)
    const phoneKey = (customer?.phone || '').replace(/\D/g, '');
    const isPaidTouch = Boolean(
      customData?.isPaidTouch ||
        adClick?.ctwa_clid ||
        adClick?.trackingCode ||
        (customer as any)?.adClick?.trackingCode ||
        (customer as any)?.adClick?.ctwa_clid
    );
    const campaignKey = adClick?.utmCampaign || adClick?.adId || (customer as any)?.adClick?.utmCampaign || '';
    if (phoneKey) {
      const now = Date.now();
      if (eventName === 'Contact') {
        if (isPaidTouch) {
          const lastPaid = this.paidContactCooldown.get(phoneKey);
          if (
            lastPaid &&
            now - lastPaid.timestamp < 24 * 60 * 60 * 1000 &&
            (!campaignKey || lastPaid.campaignKey === campaignKey)
          ) {
            console.log(`[CAPI GUARD] Skipped Contact event for ${maskPhone(phoneKey)}: Centralized 24h paid cooldown active.`);
            return { success: false, message: 'Skipped: Paid Contact event 24h cooldown active' };
          }
          this.paidContactCooldown.set(phoneKey, { timestamp: now, campaignKey });
        } else {
          const lastOrganic = this.organicContactCooldown.get(phoneKey);
          if (lastOrganic && now - lastOrganic < 24 * 60 * 60 * 1000) {
            console.log(
              `[CAPI GUARD] Skipped Contact event for ${maskPhone(phoneKey)}: Centralized 24h organic cooldown active.`
            );
            return { success: false, message: 'Skipped: Organic Contact event 24h cooldown active' };
          }
          this.organicContactCooldown.set(phoneKey, now);
        }
      } else if (eventName === 'InitiateCheckout') {
        const lastSent = this.checkoutCooldown.get(phoneKey);
        if (lastSent && now - lastSent < 60 * 60 * 1000) {
          console.log(
            `[CAPI GUARD] Skipped InitiateCheckout event for ${maskPhone(phoneKey)}: Centralized 1h cooldown active.`
          );
          return { success: false, message: 'Skipped: InitiateCheckout event 1h cooldown active' };
        }
        this.checkoutCooldown.set(phoneKey, now);
      }
    }

    let effectiveAdClick = adClick || (customer as any)?.adClick;
    let fullCustomer = customer;
    if (customer?.id || customer?.phone) {
      try {
        const { prisma: dbPrisma } = await import('../../db/client');
        const dbCust = await dbPrisma.customer.findFirst({
          where: {
            ...(customer.id ? { id: customer.id } : { phone: customer.phone }),
            ...(tenantId ? { tenant_id: tenantId } : {}),
          },
        });
        if (dbCust) {
          fullCustomer = { ...dbCust, ...customer };
        }
        if (!effectiveAdClick && (fullCustomer?.id || fullCustomer?.phone)) {
          effectiveAdClick = await dbPrisma.adClick.findFirst({
            where: {
              ...(tenantId ? { tenant_id: tenantId } : {}),
              OR: [
                ...(fullCustomer?.id ? [{ customerId: fullCustomer.id }] : []),
                ...(fullCustomer?.phone ? [{ phone: fullCustomer.phone }] : []),
              ],
            },
            orderBy: [{ matchedAt: 'desc' }, { createdAt: 'desc' }],
          });
        }
      } catch {}
    }

    const isPaid = !!effectiveAdClick;

    // 2. Tenant-aware credentials
    const { pixelId, accessToken } = await resolveTenantCapiCredentials(tenantId);

    if (!pixelId || !accessToken) {
      console.warn(
        `[CAPI WARNING] CAPI credentials missing for tenant ${tenantId || '(tanpa tenantId)'}: FB_PIXEL_ID=${
          pixelId ? 'configured' : 'missing'
        }, FB_CAPI_ACCESS_TOKEN=${accessToken ? 'configured' : 'missing'}`
      );
      return { success: false, message: `Skipped: Credentials missing for tenant ${tenantId || 'unknown'}` };
    }

    let tenantRecord: any = null;
    if (tenantId) {
      try {
        tenantRecord = await prisma.tenant.findUnique({ where: { id: tenantId } });
      } catch {}
    }
    const tenantSettings = (tenantRecord?.settings as any) || {};
    const matchingGeo = normalizeCapiMatchingGeo(tenantSettings.capiMatchingGeo);

    try {
      // 2. NORMALIZE & HASH PII menggunakan Meta ParamBuilder
      const builder = new ParamBuilder();
      const rawPhone = fullCustomer?.phone || effectiveAdClick?.phone || '';
      const normalizedPhone = normalizePhoneToE164(rawPhone);
      const hashedPhone = builder.getNormalizedAndHashedPII(normalizedPhone, PII_DATA_TYPE.PHONE);

      let hashedFn: string | undefined;
      let hashedLn: string | undefined;
      let rawName = (fullCustomer?.name || fullCustomer?.pushName || effectiveAdClick?.name || '').trim();

      const lowerRaw = rawName.toLowerCase();
      const isRawGeneric =
        !rawName || ['bunda', 'ibu', 'mama', 'mom', 'mbak', 'mas', 'kak', 'kakak', 'ny', 'pasien', 'customer', '-'].includes(lowerRaw);
      if (isRawGeneric && fullCustomer?.id) {
        try {
          const { prisma: dbPrisma } = await import('../../db/client');
          const latestRes = await dbPrisma.reservation.findFirst({
            where: {
              customer_id: fullCustomer.id,
              status: { not: 'cancelled' },
              ...(tenantId ? { tenant_id: tenantId } : {}),
            },
            orderBy: { created_at: 'desc' },
          });
          if (latestRes?.raw_text) {
            const { parseReservationText } = await import('../../utils/reservation-text-parser');
            const pr = parseReservationText(latestRes.raw_text);
            if (pr.success && pr.reservation?.name) {
              rawName = pr.reservation.name;
            }
          }
        } catch {}
      }

      if (rawName) {
        const cleanedName = rawName
          .replace(/^(?:bunda|ibu|mama|mom|mbak|mas|kak|kakak|ny|ny\.|mrs|mrs\.)\s+/i, '')
          .replace(/\([^)]*\)/g, '')
          .replace(/[^\p{L}\s'-]/gu, '')
          .replace(/\s+/g, ' ')
          .trim();
        const lowerClean = cleanedName.toLowerCase();
        const isGenericAlone = ['bunda', 'ibu', 'mama', 'mom', 'mbak', 'mas', 'kak', 'kakak', 'pasien', 'customer', '-'].includes(
          lowerClean
        );
        if (cleanedName && !isGenericAlone && cleanedName.length > 1) {
          const parts = cleanedName.split(/\s+/);
          const firstName = parts[0];
          if (firstName && firstName.length > 1) {
            hashedFn = builder.getNormalizedAndHashedPII(firstName, PII_DATA_TYPE.FIRST_NAME) || undefined;
            const lastName = parts.length > 1 ? parts.slice(1).join(' ') : undefined;
            if (lastName && lastName.length > 1) {
              hashedLn = builder.getNormalizedAndHashedPII(lastName, PII_DATA_TYPE.LAST_NAME) || undefined;
            }
          }
        }
      }

      let hashedExternalId: string | undefined;
      const rawExternalId = fullCustomer?.id ? String(fullCustomer.id) : undefined;
      if (rawExternalId) {
        hashedExternalId = builder.getNormalizedAndHashedPII(rawExternalId, PII_DATA_TYPE.EXTERNAL_ID) || undefined;
      }

      let hashedCity: string | undefined;
      let hashedState: string | undefined;
      let hashedZip: string | undefined;
      let hashedCountry: string | undefined;
      let hashedGender: string | undefined;

      const rawCity = (fullCustomer?.kota || fullCustomer?.pending_kota || '').trim();
      if (rawCity) {
        hashedCity = builder.getNormalizedAndHashedPII(rawCity, PII_DATA_TYPE.CITY) || undefined;
      }
      hashedState = builder.getNormalizedAndHashedPII(matchingGeo.state, PII_DATA_TYPE.STATE) || undefined;
      let rawZip = (fullCustomer?.zipcode || fullCustomer?.pending_zipcode || '').trim();
      let gazetteerZip: string | null = null;
      if (!rawZip) {
        try {
          const { resolveZipcode } = await import('../../utils/gazetteer-zipcode-resolver');
          const prefs = (fullCustomer as any)?.preferences || {};
          const addrText = (prefs.address || prefs.full_address || (fullCustomer as any)?.address || '').trim();
          const nameText = (fullCustomer?.name || '').trim();
          const gazInput = {
            kelurahan: (fullCustomer?.kelurahan || fullCustomer?.pending_kelurahan || '') as string,
            kecamatan: (fullCustomer?.kecamatan || fullCustomer?.pending_kecamatan || '') as string,
            kota: (fullCustomer?.kota || fullCustomer?.pending_kota || '') as string,
            text: `${nameText} ${addrText}`.trim(),
          };
          gazetteerZip = resolveZipcode(gazInput);
          if (gazetteerZip) {
            rawZip = gazetteerZip;
            const custId = fullCustomer?.id;
            if (custId) {
              void (async () => {
                try {
                  const { prisma: p } = await import('../../db/client');
                  const existing = await p.customer.findUnique({ where: { id: custId }, select: { zipcode: true } });
                  if (existing && !existing.zipcode) {
                    await p.customer.update({ where: { id: custId }, data: { zipcode: gazetteerZip } });
                    console.log(`[CAPI ZIP ENRICH] Persisted gazetteer zip ${gazetteerZip} for customer ${custId}`);
                  }
                } catch (e: any) {
                  try {
                    const { customerService } = await import('../customer.service');
                    const mem = (customerService as any).getMemoryCustomers?.();
                    if (mem) {
                      for (const [, c] of mem.entries()) {
                        if (c.id === custId && !c.zipcode) {
                          c.zipcode = gazetteerZip;
                          break;
                        }
                      }
                    }
                  } catch {}
                }
              })();
            }
            console.log(
              `[CAPI] zp enriched via Gazetteer: ${gazetteerZip} (kec=${gazInput.kecamatan || '-'}, text="${gazInput.text.slice(
                0,
                40
              )}")`
            );
          }
        } catch (e) {}
      }
      if (rawZip) {
        hashedZip = builder.getNormalizedAndHashedPII(rawZip, PII_DATA_TYPE.ZIP_CODE) || undefined;
      }
      hashedCountry = builder.getNormalizedAndHashedPII(matchingGeo.country, PII_DATA_TYPE.COUNTRY) || undefined;

      const treatmentText = (
        (customData?.treatment || '') +
        ' ' +
        (customData?.content_name || '') +
        ' ' +
        (fullCustomer?.last_discussed_treatment || '')
      ).toLowerCase();
      const isMomsTreatment =
        customData?.treatmentCategory === 'MOMS' ||
        customData?.treatmentCategory === 'BOTH' ||
        treatmentText.includes('moms') ||
        treatmentText.includes('ibu') ||
        treatmentText.includes('hamil') ||
        treatmentText.includes('laktasi') ||
        treatmentText.includes('nifas') ||
        treatmentText.includes('postpartum');

      if (isMomsTreatment) {
        hashedGender = builder.getNormalizedAndHashedPII('f', PII_DATA_TYPE.GENDER) || undefined;
      }

      const mockCookies: Record<string, string> = {};
      if (effectiveAdClick?.fbp) mockCookies._fbp = effectiveAdClick.fbp;
      if (effectiveAdClick?.fbc) mockCookies._fbc = effectiveAdClick.fbc;
      if (effectiveAdClick?.ipAddress) mockCookies._fbi = effectiveAdClick.ipAddress;

      const mockQueries: Record<string, string> = {};
      if (effectiveAdClick?.fbclid) mockQueries.fbclid = effectiveAdClick.fbclid;

      let host = 'localhost';
      try {
        if (effectiveAdClick?.landingUrl) {
          host = new URL(effectiveAdClick.landingUrl).hostname;
        }
      } catch {}

      builder.processRequest(
        host,
        mockQueries,
        mockCookies,
        null,
        effectiveAdClick?.ipAddress || null,
        effectiveAdClick?.ipAddress || null
      );

      const rawFbc = builder.getFbc() || effectiveAdClick?.fbc || effectiveAdClick?.fbclid;
      const fbcTs = effectiveAdClick?.createdAt ? new Date(effectiveAdClick.createdAt).getTime() : Date.now();
      const fbc = formatMetaFbc(rawFbc, fbcTs);
      const fbp = builder.getFbp() || effectiveAdClick?.fbp;
      const clientIp = builder.getClientIpAddress() || effectiveAdClick?.ipAddress;

      // 3. CONSTRUCT USER DATA
      const userData: any = {};
      if (hashedPhone) userData.ph = [hashedPhone];
      if (hashedFn) userData.fn = [hashedFn];
      if (hashedLn) userData.ln = [hashedLn];
      if (hashedExternalId) userData.external_id = [hashedExternalId];
      if (hashedCity) userData.ct = [hashedCity];
      if (hashedState) userData.st = [hashedState];
      if (hashedZip) userData.zp = [hashedZip];
      if (hashedCountry) userData.country = [hashedCountry];
      if (hashedGender) userData.ge = [hashedGender];
      if (clientIp) userData.client_ip_address = clientIp;
      if (effectiveAdClick?.userAgent) userData.client_user_agent = effectiveAdClick.userAgent;
      if (fbc) userData.fbc = fbc;
      if (fbp) userData.fbp = fbp;

      const isCtwaBusinessMessaging = Boolean(effectiveAdClick?.ctwa_clid);
      if (isCtwaBusinessMessaging) {
        userData.ctwa_clid = effectiveAdClick.ctwa_clid;
      }

      // 4. CONSTRUCT EVENT DATA payload
      let wabaBusinessAccountId = '';
      let tenantDomain = ((tenantRecord as any)?.landing_domain as string | undefined || '').trim();
      if (!tenantDomain) {
        const fallbackDomain =
          typeof tenantSettings.capiFallbackLandingDomain === 'string'
            ? tenantSettings.capiFallbackLandingDomain.trim()
            : '';
        if (fallbackDomain) tenantDomain = fallbackDomain;
      }
      wabaBusinessAccountId = String(((tenantRecord as any)?.waba_business_account_id || '')).trim();

      const eventSourceUrlFromAdClick = resolveCanonicalLandingUrl(effectiveAdClick?.landingUrl, tenantDomain);
      const isWebsiteEvent = eventName === 'PageView';
      let eventSourceUrl = eventSourceUrlFromAdClick;
      if (!eventSourceUrl && isWebsiteEvent && tenantDomain) {
        try {
          const parsedDomain = new URL(tenantDomain.startsWith('http') ? tenantDomain : `https://${tenantDomain}`);
          eventSourceUrl = `${parsedDomain.origin}${parsedDomain.pathname && parsedDomain.pathname !== '/' ? parsedDomain.pathname : '/'}`;
        } catch {}
      }

      const useBusinessMessaging = isCtwaBusinessMessaging && Boolean(wabaBusinessAccountId);
      if (isCtwaBusinessMessaging && !wabaBusinessAccountId) {
        console.warn(
          `[CAPI CTWA] ctwa_clid ada untuk tenant ${tenantId || '(tanpa tenantId)'} tetapi ` +
            `waba_business_account_id belum dikonfigurasi — memakai action_source 'chat' (envelope business_messaging tidak lengkap).`
        );
      }
      if (useBusinessMessaging) {
        userData.whatsapp_business_account_id = wabaBusinessAccountId;
      }

      // 4a. TEMPORAL GUARD
      const META_7DAY_LIMIT_SEC = 604800;
      const nowSec = Math.floor(Date.now() / 1000);
      let effectiveEventTime = eventTime ?? nowSec;
      const originalEventTime = effectiveEventTime;
      const eventAgeSec = nowSec - effectiveEventTime;

      if (eventAgeSec > META_7DAY_LIMIT_SEC) {
        console.warn(
          `[CAPI TEMPORAL GUARD] event_time ${effectiveEventTime} melampaui batas 7 hari Meta ` +
            `(usia ${Math.floor(eventAgeSec / 86400)} hari). Dijepit ke waktu sekarang agar konversi tetap diterima Meta.`
        );
        effectiveEventTime = nowSec;
      } else if (effectiveEventTime > nowSec + 120) {
        console.warn(
          `[CAPI TEMPORAL GUARD] event_time ${effectiveEventTime} berada di masa depan ` +
            `(selisih ${effectiveEventTime - nowSec} detik). Dijepit ke waktu sekarang agar tidak ditolak Meta.`
        );
        effectiveEventTime = nowSec;
      }

      const eventData: any = {
        event_name: eventName,
        event_time: effectiveEventTime,
        event_source_url: eventSourceUrl,
        action_source: useBusinessMessaging ? 'business_messaging' : isWebsiteEvent ? 'website' : 'chat',
        user_data: userData,
        custom_data: {
          ...(customData || {}),
          delivery_category: 'home_delivery',
          traffic_source: isPaid ? 'paid' : 'organic',
          ...(effectiveEventTime !== originalEventTime ? { original_event_time: originalEventTime } : {}),
          ...(effectiveAdClick?.utmSource ? { utm_source: effectiveAdClick.utmSource } : {}),
          ...(effectiveAdClick?.utmMedium ? { utm_medium: effectiveAdClick.utmMedium } : {}),
          ...(effectiveAdClick?.utmCampaign ? { utm_campaign: effectiveAdClick.utmCampaign } : {}),
        },
      };

      if (useBusinessMessaging) {
        eventData.messaging_channel = 'whatsapp';
      }
      if (customEventId) {
        eventData.event_id = customEventId;
      } else if (eventId) {
        eventData.event_id = eventId;
      } else if (eventName === 'Purchase') {
        if (reservationId) {
          eventData.event_id = buildDeterministicPurchaseEventId(tenantId, reservationId);
        } else {
          let anchorSec: number | undefined;
          if (typeof eventTime === 'number') {
            anchorSec = eventTime;
          } else {
            const anchorRaw = effectiveAdClick?.createdAt || fullCustomer?.created_at || customer?.created_at;
            if (anchorRaw) {
              try {
                const ts = new Date(anchorRaw as any).getTime();
                if (!Number.isNaN(ts)) anchorSec = Math.floor(ts / 1000);
              } catch {}
            }
          }
          eventData.event_id = `${effectiveAdClick?.trackingCode || 'org'}_pur_${customer.id}_${anchorSec ?? originalEventTime}`;
        }
      } else if (effectiveAdClick?.trackingCode) {
        eventData.event_id = effectiveAdClick.trackingCode;
      } else if (effectiveAdClick?.ctwa_clid) {
        eventData.event_id = `ctwa_${effectiveAdClick.ctwa_clid.slice(0, 20)}_${customer.id}`;
      } else {
        eventData.event_id = `org_${customer.id}_${eventName.toLowerCase()}_${Math.floor(Date.now() / 1000)}`;
      }

      if (customUserData && typeof customUserData === 'object') {
        Object.assign(userData, customUserData);
      }

      const parsedVal = parseCapiValue(value, customData?.allowZero === true);
      if (parsedVal !== undefined) {
        eventData.custom_data.value = parsedVal;
        eventData.custom_data.currency = currency || 'IDR';
      }

      // Resolusi New vs Repeat HANYA untuk Purchase
      if (eventName === 'Purchase') {
        const explicitRepeat = customData?.is_repeat_order;
        const explicitOrderNumber = customData?.order_number;
        const newVsRepeat = await resolveNewVsRepeatContext({
          customerId: fullCustomer?.id || customer?.id,
          tenantId,
          reservationId,
        });
        const isRepeat = typeof explicitRepeat === 'boolean' ? explicitRepeat : newVsRepeat.isRepeat;
        eventData.custom_data.is_repeat_order = isRepeat;
        eventData.custom_data.customer_type = isRepeat ? 'repeat' : 'new';
        eventData.custom_data.order_number =
          typeof explicitOrderNumber === 'number' ? explicitOrderNumber : newVsRepeat.orderNumber;
        eventData.custom_data.prior_orders_count = newVsRepeat.priorCount;

        if (reservationId) {
          eventData.custom_data.order_id = String(reservationId);
        }

        const dbIsRepeat = newVsRepeat.isRepeat;
        if (typeof explicitRepeat === 'boolean' && explicitRepeat !== dbIsRepeat) {
          console.warn(
            `[CAPI] Admin override is_repeat_order=${explicitRepeat} (DB=${dbIsRepeat}) — customer_segmentation mengikuti DB.`
          );
        }
        eventData.custom_data.customer_segmentation = dbIsRepeat
          ? 'existing_customer_to_business'
          : 'new_customer_to_business';

        const forceSend = customData?.force_send_repeat_purchase === true;
        const policy = dbIsRepeat ? await getTenantMetaPurchasePolicy(tenantId) : 'SUPPRESS_REPEAT';

        if (dbIsRepeat && !forceSend) {
          if (policy === 'SUPPRESS_REPEAT') {
            console.log(
              `[CAPI POLICY GUARD] Purchase event for repeat customer ${maskPhone(
                customer?.phone
              )} SUPPRESSED per tenant acquisition policy (${policy}).`
            );
            return {
              success: true,
              skipped: true,
              policy,
              message: 'Repeat purchase suppressed (CAC protection).',
            };
          }
          if (policy === 'DUAL_EVENT') {
            console.log(
              `[CAPI POLICY] Transforming Purchase to ReturningCustomerPurchase for repeat customer ${maskPhone(
                customer?.phone
              )}.`
            );
            eventData.event_name = 'ReturningCustomerPurchase';
            if (eventData.event_id && !customEventId) {
              eventData.event_id = `returning_${eventData.event_id}`;
            }
          } else {
            console.log(
              `[CAPI POLICY] Tagging Purchase with opt_out=true for repeat customer ${maskPhone(customer?.phone)}.`
            );
            eventData.opt_out = true;
          }
        }
        if (forceSend && dbIsRepeat) {
          console.warn(`[CAPI POLICY] force_send_repeat_purchase override by admin for ${maskPhone(customer?.phone)}`);
        }
      }

      delete eventData.custom_data?.force_send_repeat_purchase;
      delete eventData.custom_data?.allowZero;

      const payload = {
        data: [eventData],
      };

      const url = `${GRAPH_API_BASE_URL}/${GRAPH_API_VERSION}/${pixelId}/events?access_token=${accessToken}`;

      console.log(`[CAPI] Sending event ${eventName} to Meta for customer ${maskPhone(customer.phone)}`);

      // 5. EXECUTE VIA CIRCUIT BREAKER
      const response: any = await capiBreaker.execute(url, payload);

      if (response?.isFallback) {
        console.error(
          `[CAPI FALLBACK] Event ${eventName} untuk customer ${maskPhone(
            customer.phone
          )} TIDAK terkirim ke Meta (circuit breaker fallback aktif).`
        );
        return { success: false, message: 'Circuit breaker fallback: event tidak terkirim' };
      }

      if (response && response.status === 200) {
        console.log(`[CAPI SUCCESS] Successfully sent event ${eventName} to Meta CAPI.`);
        return {
          success: true,
          status: response.status,
          fbtrace_id: response.data?.fbtrace_id,
          events_received: response.data?.events_received,
          metaResponse: response.data,
          sentPayload: payload,
          pixelId,
        };
      } else {
        console.error(`[CAPI FAILURE] Meta responded with status ${response?.status || 'unknown'}:`, response?.data);
        return {
          success: false,
          status: response?.status,
          message: `Status code ${response?.status || 'unknown'}`,
          metaResponse: response?.data,
          sentPayload: payload,
          pixelId,
        };
      }
    } catch (error: any) {
      console.error(`[CAPI ERROR] Conversions API failed silently:`, error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * LIVE TEST CAPI
   */
  public async testCapiConnection(params: TestCapiConnectionParams): Promise<TestCapiConnectionResult> {
    const { pixelId, accessToken, source } = await resolveTenantCapiCredentials(params.tenantId);

    const pixelIdConfigured = Boolean(pixelId);
    const tokenConfigured = Boolean(accessToken);

    if (!pixelId || !accessToken) {
      return {
        success: false,
        status: null,
        message: `Kredensial CAPI tidak lengkap (Pixel ID ${pixelIdConfigured ? 'OK' : 'MISSING'}, Access Token ${
          tokenConfigured ? 'OK' : 'MISSING'
        }). Konfigurasi dulu di Operational Settings.`,
        pixelIdConfigured,
        tokenConfigured,
        source,
      };
    }

    const eventName = params.eventName || 'Contact';
    const builder = new ParamBuilder();
    const testNormalizedPhone = '6288888888888';
    const hashedPhone = builder.getNormalizedAndHashedPII(testNormalizedPhone, PII_DATA_TYPE.PHONE);
    const hashedFn = builder.getNormalizedAndHashedPII('Tester', PII_DATA_TYPE.FIRST_NAME);
    const hashedCountry = builder.getNormalizedAndHashedPII('id', PII_DATA_TYPE.COUNTRY);

    const eventData: any = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: `capi_test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      action_source: 'chat',
      user_data: {
        ph: hashedPhone ? [hashedPhone] : undefined,
        fn: hashedFn ? [hashedFn] : undefined,
        country: hashedCountry ? [hashedCountry] : undefined,
        client_ip_address: params.ipAddress || '127.0.0.1',
        client_user_agent: params.userAgent || 'Admin CAPI Test Connection',
      },
      custom_data: {
        traffic_source: 'test',
      },
    };
    if (params.value !== undefined && params.value !== null && !Number.isNaN(Number(params.value))) {
      eventData.custom_data.value = Number(params.value);
      eventData.custom_data.currency = params.currency || 'IDR';
    }
    if (params.testEventCode && params.testEventCode.trim()) {
      eventData.test_event_code = params.testEventCode.trim();
    }

    const payload = { data: [eventData] };
    const url = `${GRAPH_API_BASE_URL}/${GRAPH_API_VERSION}/${pixelId}/events?access_token=${accessToken}`;

    console.log(`[CAPI TEST] Sending test ${eventName} event to Meta (pixel ${pixelId})...`);

    try {
      const response = await axios.post(url, payload, { timeout: 10000 });
      return {
        success: true,
        status: response.status,
        message: `Event test '${eventName}' diterima Meta (HTTP ${response.status}). Kredensial valid.`,
        responseBody: response.data,
        pixelIdConfigured,
        tokenConfigured,
        source,
      };
    } catch (err: any) {
      const status = err?.response?.status || null;
      const errorBody = err?.response?.data?.error || null;
      const metaErrorCode = errorBody?.code;
      const metaErrorSubcode = errorBody?.error_subcode;

      let hint = '';
      if (metaErrorCode === 190) {
        hint = ' → Access Token invalid/expired. Rotate token di Operational Settings.';
      } else if (metaErrorCode === 100) {
        hint = ' → Kemungkinan Pixel ID salah atau parameter tidak valid.';
      } else if (metaErrorCode === 10) {
        hint = ' → Access token tidak memiliki izin untuk pixel ini.';
      }

      return {
        success: false,
        status,
        message: `${errorBody?.message || err?.message || 'Gagal menghubungi Meta Graph API'}${hint}`,
        metaErrorCode,
        metaErrorSubcode,
        responseBody: errorBody,
        pixelIdConfigured,
        tokenConfigured,
        source,
      };
    }
  }
}

export const capiService = new CapiService();

/**
 * Fire-and-forget helper: kirim event CAPI jika customer punya atribusi adClick
 */
export function fireCapiEvent(params: {
  eventName: string;
  customer: any;
  adClick?: any;
  value?: number;
  currency?: string;
  tenantId?: string;
  customData?: Record<string, any>;
  eventTime?: number;
}): void {
  capiService.sendCapiEvent(params).catch((err) => {
    console.error(`[CAPI ERROR] Failed to send ${params.eventName} event:`, err.message);
  });
}
