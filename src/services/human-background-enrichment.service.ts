import { DEFAULT_TENANT_ID } from '../config/tenant';
import { StateHandlerContext } from '../state-machine/types';
import { extractGoogleMapsUrls, resolveGoogleMapsUrl } from '../utils/google-maps-url-resolver';
import { parseAdminChatDistanceAndOngkir, parseAdminChatLocation } from '../utils/admin-chat-distance-parser';
import { resolveZipcode } from '../utils/gazetteer-zipcode-resolver';

const FILLER_RE = /^(oke\s+makasih|makasih|terima\s+kasih|matur\s+nuwun|thanks|thank\s+you|sip|ok|oke|siap|baik|iya|ya|boleh|nanti\s+ya|sebentar\s+cek\s+dulu|tanya\s+suami|wait|tunggu\s+sebentar)[.!]?$/i;

function isFillerOnly(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 3) return true;
  if (FILLER_RE.test(t)) return true;
  return false;
}

/**
 * Non-destruktif zipcode fill via Gazetteer.
 * Hanya mengisi jika customer belum punya zipcode/pending_zipcode.
 * Return zip yang ditemukan atau null.
 */
async function tryEnrichZipcodeViaGazetteer(
  customer: any,
  tenantId: string,
  textContext?: string | null
): Promise<string | null> {
  if (customer?.zipcode || customer?.pending_zipcode) return null;
  const kel = (customer?.kelurahan || customer?.pending_kelurahan || '') as string;
  const kec = (customer?.kecamatan || customer?.pending_kecamatan || '') as string;
  const kota = (customer?.kota || customer?.pending_kota || '') as string;
  // Gabungkan name/address/preferences untuk free-text fallback
  const prefs = (customer as any)?.preferences || {};
  const addrFromPrefs = (prefs.address || prefs.full_address || '') as string;
  const namePart = (customer?.name || '') as string;
  const combinedText = [textContext || '', namePart, addrFromPrefs].filter(Boolean).join(' ').trim();
  const gazZip = resolveZipcode({ kelurahan: kel, kecamatan: kec, kota, text: combinedText || namePart || addrFromPrefs });
  if (!gazZip) return null;
  try {
    const { prisma } = await import('../db/client');
    const existing = await prisma.customer.findUnique({ where: { id: customer.id }, select: { zipcode: true } });
    if (existing && !existing.zipcode) {
      await prisma.customer.update({ where: { id: customer.id }, data: { zipcode: gazZip } });
    } else if (!existing) {
      // memory fallback
      const { customerService } = await import('./customer.service');
      const mem = (customerService as any).getMemoryCustomers?.();
      if (mem) {
        for (const [, c] of mem.entries()) {
          if (c.id === customer.id && !c.zipcode) { c.zipcode = gazZip; break; }
        }
      }
    }
    console.log(`[HUMAN ENRICH ZIP] Gazetteer fill ${gazZip} for ${customer.phone} (kec=${kec || '-'}, text="${(combinedText || '').slice(0,40)}")`);
  } catch (_) {
    // best-effort, ignore
    try {
      const { customerService } = await import('./customer.service');
      const mem = (customerService as any).getMemoryCustomers?.();
      if (mem) {
        for (const [, c] of mem.entries()) if (c.id === customer.id && !c.zipcode) { c.zipcode = gazZip; break; }
      }
    } catch {}
  }
  // Mutate in-memory customer object agar caller lihat update langsung
  if (!customer.zipcode) customer.zipcode = gazZip;
  return gazZip;
}

export class HumanBackgroundEnrichmentService {
  /**
   * Passive Background Enrichment untuk pesan inbound dari customer saat mode Human Handling.
   */
  public enrichAsync(ctx: StateHandlerContext, tenantId?: string): void {
    const tid = tenantId || (ctx.customer as any)?.tenant_id || DEFAULT_TENANT_ID;
    void this.enrichSync(ctx, tid).catch((err: any) => {
      console.warn('[HUMAN ENRICH] async failed:', err?.message || err);
    });
  }

  /**
   * Passive Background Enrichment untuk pesan outbound dari Admin CS (ekstraksi jarak/ongkir dari chat CS).
   */
  public enrichFromAdminOutboundAsync(text: string, customerId: string, tenantId: string = DEFAULT_TENANT_ID): void {
    void this.enrichFromAdminOutbound(text, customerId, tenantId).catch((err: any) => {
      console.warn('[ADMIN OUTBOUND ENRICH] async failed:', err?.message || err);
    });
  }

  public async enrichFromAdminOutbound(
    text: string,
    customerId: string,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<{ enriched: boolean; reason: string }> {
    if (!text || !customerId) return { enriched: false, reason: 'empty_input' };

    const parsed = parseAdminChatDistanceAndOngkir(text);
    if (!parsed.isConfident && parsed.distanceKm === null && parsed.ongkir === null) {
      return { enriched: false, reason: 'no_admin_distance_info' };
    }

    try {
      const { customerService } = await import('./customer.service');
      const { deliveryService, getDeliveryTiersFromDb } = await import('./delivery.service');
      const customer = await customerService.getCustomerById(customerId, tenantId);
      if (!customer) return { enriched: false, reason: 'customer_not_found' };

      // Jika ada jarak tapi belum ada ongkir, hitung ongkir dari jarak via delivery tiers
      let effectiveOngkir = parsed.ongkir;
      if (parsed.distanceKm !== null && effectiveOngkir === null) {
        try {
          const tiers = await getDeliveryTiersFromDb(tenantId);
          const calc = deliveryService.calculateOngkirByDistance(parsed.distanceKm, tiers);
          effectiveOngkir = Math.max(0, calc.normalPrice - calc.promoDiscount);
        } catch (_) {}
      }

      // Jika customer belum memiliki kelurahan, selesaikan lokasi dengan prioritas:
      // P1 — lokasi yang disebut Admin di pesan outbound ini (geocode langsung, tanpa tebak riwayat).
      // P2 — riwayat inbound, dengan pesan pertanyaan dilewati (skip) + validasi kandidat.
      let resolvedLoc: any = null;
      if (!customer.kelurahan) {
        try {
          const { geocodingService } = await import('../integrations/google-maps/geocoding');
          const { isClinicLocationQuestion } = await import('../utils/location-classifier');
          const { EntityExtractor } = await import('./entity-extractor.service');

          const adminLoc = parseAdminChatLocation(text);
          if (adminLoc) {
            const geo = await geocodingService.geocodeText(adminLoc);
            if (geo.isPrecise && geo.lat != null && geo.lng != null) {
              resolvedLoc = geo;
            }
          }

          if (!resolvedLoc) {
            const { messageService } = await import('./message.service');
            const { conversationService } = await import('./conversation.service');
            const conv = await conversationService.getOrCreateConversation(customerId, tenantId);
            if (conv) {
              const msgs = await messageService.getRecentMessages(conv.id, 10, tenantId);

              for (let i = msgs.length - 1; i >= 0; i--) {
                const m = msgs[i];
                if (m.direction === 'INBOUND' && m.content) {
                  // Lewati pesan bertipe pertanyaan ("dimana", "tanya", "?") — bukan alamat.
                  if (isClinicLocationQuestion(m.content)) continue;
                  // 1. Coba deteksi deterministik dulu (0 API call, 0ms)
                  const det = EntityExtractor.preExtractDeterministic(m.content);
                  const locCandidate = det.locationText;
                  // 2. Validasi kandidat: tolak fragmen tanya yang lolos
                  if (locCandidate && !isClinicLocationQuestion(locCandidate)) {
                    const geo = await geocodingService.geocodeText(locCandidate);
                    if (geo.isPrecise && geo.lat != null && geo.lng != null) {
                      resolvedLoc = geo;
                      break;
                    }
                  }
                }
              }
            }
          }
        } catch (_) {}
      }

      // Gazetteer fallback untuk zipcode jika belum terisi
      let adminGazZip: string | null = null;
      if (!customer.zipcode && !customer.pending_zipcode) {
        const addrPref = (customer as any)?.preferences?.address || (customer as any)?.preferences?.full_address || '';
        adminGazZip = resolveZipcode({
          kelurahan: resolvedLoc?.kelurahan || customer.kelurahan || customer.pending_kelurahan || undefined,
          kecamatan: resolvedLoc?.kecamatan || customer.kecamatan || customer.pending_kecamatan || undefined,
          kota: resolvedLoc?.kota || customer.kota || customer.pending_kota || undefined,
          text: `${text} ${customer.name || ''} ${addrPref}`.trim(),
        });
      }

      // FASE 3 — RC-4 "estimasi admin ≠ fakta" (KNOWN_ISSUES #138 G3, tanpa migrasi DB):
      // - Customer dengan koordinat GPS presisi (share_location_sent + lat/lng) → jarak resmi
      //   dihitung ULANG dari koordinat via calculateDelivery; angka chat admin DIABAIKAN.
      // - Tanpa koordinat presisi → angka chat admin hanya ESTIMATE → disimpan di
      //   preferences.distance_estimate, kolom distance_km/ongkir resmi TIDAK disentuh.
      const hasPreciseGps =
        customer.share_location_sent === true && customer.lat != null && customer.lng != null;

      let distanceKm: number | undefined;
      let ongkir: number | undefined;
      let isOutOfCoverage: boolean;
      let isNativePin: boolean | undefined;

      if (hasPreciseGps) {
        let delivery: Awaited<ReturnType<typeof deliveryService.calculateDelivery>> | null = null;
        try {
          delivery = await deliveryService.calculateDelivery(
            { lat: Number(customer.lat), lng: Number(customer.lng) },
            undefined,
            tenantId
          );
        } catch (_) {}
        distanceKm = delivery?.distanceKm;
        ongkir = delivery?.ongkir;
        isOutOfCoverage = delivery?.isOutOfCoverage ?? customer.is_out_of_coverage ?? false;
        // isNativePin=true → loloskan penulisan jarak hasil-hitung-dari-koordinat melewati guard
        // preserveExactGps (jarak memang konsisten dengan koordinat GPS yang dipertahankan);
        // lat/lng TIDAK ikut dikirim sehingga koordinat presisi tetap utuh.
        isNativePin = true;
      } else {
        distanceKm = undefined;
        ongkir = undefined;
        // Chat admin bukan sumber fakta coverage → pertahankan flag yang sudah tercatat
        isOutOfCoverage = customer.is_out_of_coverage ?? false;
        const estimate = {
          km: parsed.distanceKm,
          ongkir: effectiveOngkir,
          by: 'admin_chat',
          at: new Date().toISOString(),
        };
        try {
          const { prisma } = await import('../db/client');
          const prefs = (customer.preferences as any) || {};
          await prisma.customer.update({
            where: { id: customerId },
            data: { preferences: { ...prefs, distance_estimate: estimate } } as any,
          });
        } catch (e: any) {
          console.warn('[ADMIN DISTANCE ESTIMATE] gagal simpan preferences:', e?.message || e);
        }
        console.log(
          `[ADMIN DISTANCE ESTIMATE] ${customer.phone}: km=${estimate.km}, ongkir=${estimate.ongkir} (angka chat admin, bukan fakta resmi)`
        );
      }

      await customerService.updateCustomerLocation(
        customerId,
        {
          kelurahan: resolvedLoc?.kelurahan || customer.kelurahan || undefined,
          kecamatan: resolvedLoc?.kecamatan || customer.kecamatan || undefined,
          kota: resolvedLoc?.kota || customer.kota || undefined,
          // Otoritas koordinat: customer GPS tidak menerima lat/lng hasil geocode teks admin
          ...(hasPreciseGps
            ? {}
            : {
                lat: resolvedLoc?.lat !== undefined ? resolvedLoc.lat : (customer.lat ?? undefined),
                lng: resolvedLoc?.lng !== undefined ? resolvedLoc.lng : (customer.lng ?? undefined),
              }),
          distanceKm,
          ongkir,
          isOutOfCoverage,
          ...(isNativePin !== undefined ? { isNativePin } : {}),
          zipcode: adminGazZip || resolvedLoc?.zipcode || undefined,
        },
        tenantId
      );

      console.log(
        `[ADMIN OUTBOUND ENRICH] Captured distance/ongkir for ${customer.phone}: distance=${parsed.distanceKm}km, ongkir=${effectiveOngkir}, location=${resolvedLoc?.kelurahan || customer.kelurahan || '-'}${adminGazZip ? ` zip=${adminGazZip}` : ''}, mode=${hasPreciseGps ? 'gps_recompute' : 'estimate'}`
      );
      return { enriched: true, reason: 'admin_chat_captured' };
    } catch (err: any) {
      console.warn('[ADMIN OUTBOUND ENRICH] failed:', err?.message || err);
      return { enriched: false, reason: 'error' };
    }
  }

  public async enrichSync(ctx: StateHandlerContext, tenantId: string = DEFAULT_TENANT_ID): Promise<{ enriched: boolean; reason: string }> {
    const customer: any = ctx.customer;
    const incomingMessage: any = ctx.incomingMessage;
    const incomingText: string = incomingMessage?.text?.body || '';
    const tid = tenantId || customer?.tenant_id || DEFAULT_TENANT_ID;

    try {
      // 1. PIN LOKASI ASLI WHATSAPP (type: 'location') — didelegasikan ke kontrak
      //    tunggal location-ingest.service: idempoten (retry/choke point ganda aman)
      //    dan kegagalan tulis meninggalkan audit LOCATION_INGEST_FAILED persisten
      //    (KNOWN_ISSUES #138 — kasus Bunda Agatha yang dulu ditelan console.warn).
      const { locationIngestService } = await import('./location-ingest.service');
      if (locationIngestService.isIncomingGpsPin(incomingMessage)) {
        const res = await locationIngestService.ingestGpsPin({ customer, incomingMessage, tenantId: tid });
        if (res.status === 'saved') return { enriched: true, reason: res.reason };
        if (res.status === 'error') return { enriched: false, reason: res.reason };
        if (res.reason !== 'invalid_coords') return { enriched: false, reason: res.reason };
        // invalid_coords → jatuh ke jalur teks berikutnya (kompatibilitas perilaku lama)
      }

      // 2. DETEKSI LINK GOOGLE MAPS DI DALAM CHAT ATAU ALAMAT (maps.app.goo.gl / goo.gl/maps)
      if (incomingText && incomingText.trim()) {
        try {
          const { resolveLocationFromUrl } = await import('./location-resolver.service');
          const { customerService } = await import('./customer.service');
          const res = await resolveLocationFromUrl(incomingText, tid);
          if (res.success && res.lat != null && res.lng != null) {
            // Provenance: koordinat presisi langsung dari URL (`url_coords`) = pin GPS asli
            // (invarian sticky-gps: "shareloc / link Maps" berstatus VERIFIED_GPS) → kunci GPS
            // + tandai share_location_sent. Teks tempat dari URL yang di-geocode
            // (`url_text_geocoded`) hanyalah area perkiraan → TIDAK dikunci sebagai GPS.
            const isNativePin = res.source === 'url_coords';
            await customerService.updateCustomerLocation(customer.id, {
              kelurahan: res.kelurahan,
              kecamatan: res.kecamatan,
              kota: res.kota,
              lat: res.lat,
              lng: res.lng,
              distanceKm: res.distanceKm,
              ongkir: res.ongkir,
              isOutOfCoverage: res.isOutOfCoverage,
              zipcode: res.zipcode,
              isNativePin,
            }, tid);
            if (isNativePin) {
              await customerService.markShareLocationSent(customer.id, tid);
            }
            console.log(`[HUMAN ENRICH] Google Maps link resolved for ${customer.phone}: ${res.distanceKm}km ongkir ${res.ongkir} (source: ${res.source})`);
            return { enriched: true, reason: 'google_maps_url' };
          }
        } catch {}
      }

      // 3. DETEKSI FORMULIR RESERVASI WHATSAPP
      if (incomingText && incomingText.trim()) {
        const { isReservationFormMessage, parseReservationText } = await import('../utils/reservation-text-parser');
        const isForm = isReservationFormMessage(incomingText);
        if (isForm) {
          const parsed = parseReservationText(incomingText);
          if (parsed.success && parsed.reservation) {
            const r = parsed.reservation;
            // Gazetteer ZIP enrichment untuk form (non-destruktif)
            if (!customer.zipcode && !customer.pending_zipcode) {
              const gazZip = resolveZipcode({
                kelurahan: (r as any).kelurahan || undefined,
                kecamatan: (r as any).kec || customer.kecamatan || customer.pending_kecamatan || undefined,
                kota: (r as any).kota || customer.kota || customer.pending_kota || undefined,
                text: `${customer.name || ''} ${r.address || ''} ${r.kec || ''} ${incomingText}`.trim(),
              });
              if (gazZip) {
                await tryEnrichZipcodeViaGazetteer(customer, tid, incomingText);
              }
            }
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
                      // Fallback zip dari Gazetteer jika geocode tidak bawa zip
                      let effectiveZip = resolved.zipcode as string | undefined;
                      if (!effectiveZip && !customer.zipcode && !customer.pending_zipcode) {
                        effectiveZip = resolveZipcode({
                          kelurahan: resolved.kelurahan || (r as any).kelurahan || undefined,
                          kecamatan: resolved.kecamatan || (r as any).kec || undefined,
                          kota: resolved.kota || (r as any).kota || undefined,
                          text: incomingText,
                        }) || undefined;
                      }
                      await customerService.updateCustomerLocation(customer.id, {
                        kelurahan: resolved.kelurahan,
                        kecamatan: resolved.kecamatan,
                        kota: resolved.kota,
                        lat: resolved.lat,
                        lng: resolved.lng,
                        distanceKm: delivery.distanceKm,
                        ongkir: delivery.ongkir,
                        isOutOfCoverage: delivery.isOutOfCoverage,
                        zipcode: effectiveZip,
                      }, tid);
                      if (effectiveZip && !customer.zipcode) customer.zipcode = effectiveZip;
                      console.log(`[HUMAN ENRICH] form location saved for ${customer.phone}: ${resolved.kelurahan} ${delivery.distanceKm}km`);
                      return { enriched: true, reason: 'form_location' };
                    } else {
                      console.log(`[HUMAN ENRICH] form geocode not precise for ${customer.phone}: "${query}" -> isPrecise=${resolved.isPrecise}`);
                      // Walau geocode tidak presisi, zip dari Gazetteer mungkin sudah terisi di atas
                      if (customer.zipcode) return { enriched: true, reason: 'form_zipcode_only' };
                    }
                  }
                } catch (e: any) {
                  console.warn('[HUMAN ENRICH] form geocode failed:', e.message);
                }
              } else {
                // Sudah punya lokasi tapi zip mungkin baru terisi via Gazetteer
                if (customer.zipcode) return { enriched: true, reason: 'form_zipcode_only' };
              }
            }
          }
        }
      }

      // 4. DETEKSI TEKS BEBAS ALAMAT / KELURAHAN

      // Gazetteer ZIP enrichment oportunistik untuk setiap teks inbound (non-destruktif)
      // Jalan bahkan jika sudah punya lat/lng — hanya mengisi zip yang masih kosong.
      if (incomingText && incomingText.trim() && !customer.zipcode && !customer.pending_zipcode) {
        const gazFreeEarly = resolveZipcode({
          kelurahan: customer.kelurahan || customer.pending_kelurahan || undefined,
          kecamatan: customer.kecamatan || customer.pending_kecamatan || undefined,
          kota: customer.kota || customer.pending_kota || undefined,
          text: `${incomingText} ${customer.name || ''}`.trim(),
        });
        if (gazFreeEarly) {
          await tryEnrichZipcodeViaGazetteer(customer, tid, incomingText);
          // Jika sudah punya koordinat lengkap, cukup save zip
          if (customer.lat != null && customer.lng != null && customer.distance_km != null) {
            return { enriched: true, reason: 'zipcode_gazetteer' };
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

      const { EntityExtractor } = await import('./entity-extractor.service');
      const history = (ctx as any).history || [];

      // RC-3 (Fase 3): coba ekstraksi DETERMINISTIK lebih dulu (0 token, 0 API call).
      // Saat mode HUMAN_HANDLING, customer sudah dipegang manusia — panggilan LLM
      // hanya membuang request (dan berisiko 400 saat provider mismatch). LLM
      // hanya dipanggil bila deterministik benar-benar tidak menemukan lokasi.
      const det = EntityExtractor.preExtractDeterministic(textForEnrich, incomingMessage);
      const detHasLocation = Boolean(det?.locationText && det.locationText.trim().length > 1);
      const detHasProvideIntent = (det?.intents || []).includes('provide_location');

      const extraction = (detHasLocation || detHasProvideIntent)
        ? {
            intents: det.intents || [],
            locationText: det.locationText || null,
            streetDetail: det.streetDetail || null,
          }
        : await EntityExtractor.extract(textForEnrich, {
            history,
            customerPhone: customer.phone,
            conversationId: ctx.conversation?.id,
            tenantId: tid,
            incomingMessage,
          });

      const hasLocation = Boolean(extraction.locationText && extraction.locationText.trim().length > 1);
      const hasProvideIntent = (extraction.intents || []).includes('provide_location');
      if (!hasLocation && !hasProvideIntent) {
        // Walau tidak ada intent lokasi, zip mungkin sudah ter-enrich via Gazetteer free-text di atas
        if (customer.zipcode) return { enriched: true, reason: 'zipcode_gazetteer' };
        return { enriched: false, reason: 'no_location_intent' };
      }
      const locationText = extraction.locationText || '';
      if (locationText.trim().length < 2) {
        if (customer.zipcode) return { enriched: true, reason: 'zipcode_gazetteer' };
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
        if (customer.zipcode) return { enriched: true, reason: 'zipcode_gazetteer' };
        return { enriched: false, reason: 'geocode_not_precise' };
      }

      if (customer.share_location_sent) {
        console.log(`[HUMAN ENRICH] text location skipped for ${customer.phone} — GPS pin already exists`);
        return { enriched: false, reason: 'gps_pin_guard' };
      }

      const { deliveryService } = await import('./delivery.service');
      const { customerService } = await import('./customer.service');
      const delivery = await deliveryService.calculateDelivery({ lat: resolved.lat, lng: resolved.lng }, undefined, tid);
      let effectiveTextZip = resolved.zipcode as string | undefined;
      if (!effectiveTextZip && !customer.zipcode && !customer.pending_zipcode) {
        effectiveTextZip = resolveZipcode({
          kelurahan: resolved.kelurahan || undefined,
          kecamatan: resolved.kecamatan || undefined,
          kota: resolved.kota || undefined,
          text: textForEnrich,
        }) || undefined;
      }
      await customerService.updateCustomerLocation(customer.id, {
        kelurahan: resolved.kelurahan,
        kecamatan: resolved.kecamatan,
        kota: resolved.kota,
        lat: resolved.lat,
        lng: resolved.lng,
        distanceKm: delivery.distanceKm,
        ongkir: delivery.ongkir,
        isOutOfCoverage: delivery.isOutOfCoverage,
        zipcode: effectiveTextZip,
      }, tid);
      if (effectiveTextZip && !customer.zipcode) customer.zipcode = effectiveTextZip;
      console.log(`[HUMAN ENRICH] text location saved for ${customer.phone}: ${resolved.kelurahan}, ${resolved.kecamatan} ${delivery.distanceKm}km ongkir ${delivery.ongkir}${effectiveTextZip ? ` zip=${effectiveTextZip}` : ''}`);
      return { enriched: true, reason: 'text_location' };
    } catch (err: any) {
      console.warn('[HUMAN ENRICH] failed:', err?.message || err);
      return { enriched: false, reason: 'error' };
    }
  }
}

export const humanBackgroundEnrichmentService = new HumanBackgroundEnrichmentService();
