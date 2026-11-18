import { DEFAULT_TENANT_ID } from '../config/tenant';
import { prisma } from '../db/client';
import { LocationSource } from '@prisma/client';
import { getCustomerRepository } from '../repositories/customer.repository';
import { pickGpsTier, type GpsCandidate } from '../domain/gps-tier';
import { STAFF_VERIFIED_LOCATION_LABEL } from '../domain/location-source';

export interface RefreshCustomerLocationResult {
  success: boolean;
  data?: {
    customerId: string;
    source: 'bidan_shareloc' | 'customer_shareloc' | 'db_coords' | 'geocoding' | 'url_coords' | 'url_text_geocoded' | 'manual_staff';
    sourceLabel: string;
    lat: number;
    lng: number;
    distanceKm: number;
    ongkir: number;
    isOutOfCoverage: boolean;
    kelurahan?: string | null;
    kecamatan?: string | null;
    kota?: string | null;
    refreshedAt: string;
    refreshedBy?: string;
  };
  error?: string;
}

/**
 * Refresh & Hitung Ulang Lokasi, Jarak & Ongkir Customer (Hierarchy of Truth)
 * Tier1 (Bidan/Staff outbound GPS) → Tier2 (Customer inbound GPS) → Tier3 (DB lat/lng) → Tier4 (Geocoding kelurahan/kecamatan)
 */
export async function refreshCustomerLocationAndOngkir(
  customerId: string,
  tenantId: string = DEFAULT_TENANT_ID,
  performedBy?: string,
  customerGetter?: (id: string, tid?: string) => Promise<any>,
  memoryCustomersGetter?: () => Map<string, any>
): Promise<RefreshCustomerLocationResult> {
  try {
    const customer = customerGetter
      ? await customerGetter(customerId, tenantId)
      : await getCustomerRepository().findById(customerId, tenantId);
    if (!customer) return { success: false, error: 'Customer tidak ditemukan' };

    // Deep scan messages
    let messages: any[] = [];
    try {
      const convs = await prisma.conversation.findMany({
        where: { customer_id: customerId, tenant_id: tenantId },
        select: { id: true },
      });
      if (convs.length > 0) {
        const ids = convs.map((c) => c.id);
        messages = await prisma.message.findMany({
          where: { conversation_id: { in: ids }, tenant_id: tenantId },
          orderBy: { created_at: 'asc' },
        });
      }
    } catch (_) {
      // fallback memory: try messageService
      try {
        const { messageService } = await import('./message.service');
        const { conversationService } = await import('./conversation.service');
        const conv = await conversationService.getOrCreateConversation(customerId, tenantId);
        if (conv) messages = await messageService.getRecentMessages(conv.id, 1000, tenantId);
      } catch {}
    }

    const isBidanSender = (msg: any): boolean => {
      const st = (msg.sender_type || '').toUpperCase();
      const name = (msg.sender_name || '').toLowerCase();
      return ['STAFF', 'ADMIN', 'HUMAN', 'BIDAN'].includes(st) || name.includes('bidan') || name.includes('staff') || name.includes('admin');
    };

    const extractFromPayloadRaw = (msg: any): { lat: number; lng: number; detail: string } | null => {
      const loc = msg.payload_raw?.location || msg.payloadRaw?.location;
      if (loc && loc.latitude != null && loc.longitude != null) {
        const lat = Number(loc.latitude);
        const lng = Number(loc.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) return { lat, lng, detail: 'payload_raw.location' };
      }
      return null;
    };

    const extractFromText = (text: string): { lat: number; lng: number; detail: string } | null => {
      if (!text) return null;
      // [LOCATION SHARE: Lat -7.x, Lng 112.x] or [Shared Location: -7.x, 112.x]
      const re1 = /\[LOCATION\s+SHARE:\s*Lat\s*(-?\d+\.\d+)\s*,\s*Lng\s*(-?\d+\.\d+)\s*\]/i;
      const m1 = text.match(re1);
      if (m1) return { lat: parseFloat(m1[1]), lng: parseFloat(m1[2]), detail: 'text [LOCATION SHARE]' };
      const re2 = /\[Shared\s+Location:\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]/i;
      const m2 = text.match(re2);
      if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]), detail: 'text [Shared Location]' };
      // Try Google Maps URL extraction (sync part)
      try {
        const { extractGoogleMapsUrls, extractCoordinatesFromUrlString } = require('../utils/google-maps-url-resolver');
        const urls: string[] = extractGoogleMapsUrls(text);
        for (const u of urls) {
          const c = extractCoordinatesFromUrlString(u);
          if (c) return { lat: c.lat, lng: c.lng, detail: `url ${u.slice(0, 40)}` };
        }
      } catch {}
      return null;
    };

    let tier1Candidate: { lat: number; lng: number; detail: string; msg: any } | null = null;
    let tier2Candidate: { lat: number; lng: number; detail: string; msg: any } | null = null;

    // Scan from newest to oldest to prioritize latest valid shareloc within tier
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const content: string = msg.content || '';
      const payloadCoords = extractFromPayloadRaw(msg);
      const textCoords = !payloadCoords ? extractFromText(content) : null;
      let coords = payloadCoords || textCoords;
      // Try async shortlink resolve if still no coords but contains google maps url
      if (!coords && content && /maps\.app\.goo\.gl|google\.[a-z.]+\/maps/i.test(content)) {
        try {
          const { extractGoogleMapsUrls, resolveLocationFromUrl } = await import('./location-resolver.service');
          const urls = extractGoogleMapsUrls(content);
          for (const u of urls) {
            const res = await resolveLocationFromUrl(u, tenantId);
            if (res.success && res.lat != null && res.lng != null) {
              coords = { lat: res.lat, lng: res.lng, detail: `resolved ${u.slice(0, 40)}` };
              (coords as any).resolverResult = res;
              break;
            }
          }
        } catch {}
      }
      if (!coords) continue;

      // Plan v2.1 (4.1): Tolak bila koordinat adalah lokasi klinik sendiri yang dibagikan staf
      try {
        const { getClinicLocationAsync } = await import('../config/clinic-location');
        const clinicLoc = await getClinicLocationAsync(tenantId);
        if (clinicLoc?.lat != null && clinicLoc?.lng != null) {
          const { calculateHaversineDistance } = await import('../utils/haversine');
          const distClinicM = calculateHaversineDistance(
            { lat: clinicLoc.lat, lng: clinicLoc.lng },
            { lat: coords.lat, lng: coords.lng }
          ) * 1000;
          if (distClinicM < 150) {
            continue;
          }
        }
      } catch {}

      // Plan v2.1 (4.1): Hapus `|| msg.direction === 'OUTBOUND'`; tier1 hanya untuk pesan staf/bidan (bukan BOT)
      const isBidan = isBidanSender(msg);
      const isBot = (msg.sender_type || '').toUpperCase() === 'BOT' || (msg.sender_type || '').toUpperCase() === 'SYSTEM';
      if (isBidan && !isBot && msg.direction === 'OUTBOUND') {
        if (!tier1Candidate) tier1Candidate = { ...coords, msg };
      } else if (msg.direction === 'INBOUND') {
        if (!tier2Candidate) tier2Candidate = { ...coords, msg };
      } else if (isBidan && !isBot && !tier1Candidate) {
        tier1Candidate = { ...coords, msg };
      }
      if (tier1Candidate && tier2Candidate) break;
    }

    let chosen: { lat: number; lng: number; source: 'bidan_shareloc' | 'customer_shareloc' | 'db_coords' | 'geocoding' | 'url_coords' | 'url_text_geocoded' | 'manual_staff'; sourceLabel: string; detail: string } | null = null;

    const tierCandidates: GpsCandidate[] = [];
    if (tier1Candidate) {
      tierCandidates.push({ source: 'bidan_shareloc', lat: tier1Candidate.lat, lng: tier1Candidate.lng, at: String(tier1Candidate.msg?.created_at ?? '') });
    }
    if (tier2Candidate) {
      tierCandidates.push({ source: 'customer_shareloc', lat: tier2Candidate.lat, lng: tier2Candidate.lng, at: String(tier2Candidate.msg?.created_at ?? '') });
    }
    const pickedTier = pickGpsTier(tierCandidates);

    if (pickedTier?.source === 'bidan_shareloc' && tier1Candidate) {
      chosen = { lat: tier1Candidate.lat, lng: tier1Candidate.lng, source: 'bidan_shareloc', sourceLabel: '📍 Titik dari Chat', detail: tier1Candidate.detail };
    } else if (pickedTier?.source === 'customer_shareloc' && tier2Candidate) {
      chosen = { lat: tier2Candidate.lat, lng: tier2Candidate.lng, source: 'customer_shareloc', sourceLabel: '📍 Titik dari Chat', detail: tier2Candidate.detail };
    } else if (customer.lat != null && customer.lng != null) {
      const isManualStaff = customer.location_source === LocationSource.manual_staff || (customer.location_source as any) === 'manual_staff';
      chosen = {
        lat: Number(customer.lat),
        lng: Number(customer.lng),
        source: isManualStaff ? 'manual_staff' : 'db_coords',
        sourceLabel: isManualStaff ? STAFF_VERIFIED_LOCATION_LABEL : '🟡 Estimasi (Titik DB)',
        detail: isManualStaff ? 'Manual Staff (Presisi Terverifikasi)' : 'DB lat/lng',
      };
    } else {
      // Tier4: geocoding kelurahan/kecamatan/kota
      const kel = customer.kelurahan || customer.pending_kelurahan || (customer.preferences as any)?.address || '';
      const kec = customer.kecamatan || customer.pending_kecamatan || '';
      const kota = customer.kota || customer.pending_kota || '';
      const query = [kel, kec, kota].filter(Boolean).join(', ') || (customer.preferences as any)?.full_address || '';
      if (!query) return { success: false, error: 'Tidak ada koordinat atau alamat untuk direfresh' };
      try {
        const { geocodingService } = await import('../integrations/google-maps/geocoding');
        const geo = await geocodingService.geocodeText(query, tenantId);
        if (geo.isPrecise && geo.lat != null && geo.lng != null) {
          chosen = { lat: geo.lat, lng: geo.lng, source: 'geocoding', sourceLabel: '⚪ Estimasi Wilayah', detail: `geocoding ${query}` };
        } else {
          try {
            const { getGazetteerCoordinates } = await import('../utils/gazetteer');
            const hit = getGazetteerCoordinates(query);
            if (hit) chosen = { lat: hit.lat, lng: hit.lng, source: 'geocoding', sourceLabel: '⚪ Estimasi Wilayah', detail: `gazetteer centroid ${query}` };
          } catch {}
          if (!chosen) return { success: false, error: `Geocoding tidak presisi untuk "${query}"` };
        }
      } catch (e: any) {
        return { success: false, error: `Geocoding gagal: ${e.message}` };
      }
    }

    // Calculate delivery & reverse geocode untuk kelurahan/kecamatan/kota
    const { deliveryService } = await import('./delivery.service');
    const delivery = await deliveryService.calculateDelivery({ lat: chosen.lat, lng: chosen.lng }, undefined, tenantId);

    let resolvedAdmin: any = {};
    const resolverResult = (chosen as any).resolverResult;
    if (resolverResult && (resolverResult.kelurahan || resolverResult.kecamatan || resolverResult.kota)) {
      resolvedAdmin = {
        kelurahan: resolverResult.kelurahan,
        kecamatan: resolverResult.kecamatan,
        kota: resolverResult.kota,
        zipcode: resolverResult.zipcode,
        formattedAddress: resolverResult.formattedAddress,
      };
    } else {
      try {
        const { geocodingService } = await import('../integrations/google-maps/geocoding');
        const hint = {
          preferredKelurahan: customer.kelurahan,
          preferredKecamatan: customer.kecamatan,
          addressTextHint: (customer.preferences as any)?.address || (customer.preferences as any)?.full_address || '',
        };
        resolvedAdmin = await geocodingService.reverseGeocode(chosen.lat, chosen.lng, hint, tenantId);
      } catch {}
    }

    const nowIso = new Date().toISOString();
    const existingPrefs = (customer.preferences as any) || {};
    const history: any[] = Array.isArray(existingPrefs.location_history) ? existingPrefs.location_history : [];
    const newHistoryEntry = {
      source: chosen.source,
      sourceLabel: chosen.sourceLabel,
      lat: chosen.lat,
      lng: chosen.lng,
      distanceKm: delivery.distanceKm,
      ongkir: delivery.ongkir,
      detail: chosen.detail,
      refreshedBy: performedBy || 'Admin',
      refreshedAt: nowIso,
    };

    const isCustomerPin = chosen.source === 'customer_shareloc' || chosen.source === 'url_coords';
    const isStaffPin = chosen.source === 'bidan_shareloc';
    const isPinSourceChosen = isCustomerPin || isStaffPin; // presisi (D4), tapi bukan konfirmasi customer

    // Persist atomically
    const { location_source_label: _dropLabel, ...prefsWithoutLabel } = existingPrefs;
    try {
      await getCustomerRepository().update(
        customerId,
        {
          lat: chosen.lat,
          lng: chosen.lng,
          distance_km: delivery.distanceKm,
          ongkir: delivery.ongkir,
          is_out_of_coverage: delivery.isOutOfCoverage,
          share_location_sent: isCustomerPin ? true : customer.share_location_sent,
          location_source:
            isPinSourceChosen
              ? LocationSource.gps_pin
              : chosen.source === 'manual_staff'
                ? LocationSource.manual_staff
                : chosen.source === 'geocoding' || chosen.source === 'url_text_geocoded'
                  ? LocationSource.estimated_area
                  : (customer.location_source as LocationSource | null) ?? LocationSource.estimated_area,
          kelurahan: (resolvedAdmin.isEstimatedCentroid && customer.kecamatan && resolvedAdmin.kecamatan && String(resolvedAdmin.kecamatan).trim().toLowerCase() !== String(customer.kecamatan).trim().toLowerCase())
            ? (customer.kelurahan || resolvedAdmin.kelurahan)
            : (resolvedAdmin.kelurahan || customer.kelurahan),
          kecamatan: (resolvedAdmin.isEstimatedCentroid && customer.kecamatan && resolvedAdmin.kecamatan && String(resolvedAdmin.kecamatan).trim().toLowerCase() !== String(customer.kecamatan).trim().toLowerCase())
            ? customer.kecamatan
            : (resolvedAdmin.kecamatan || customer.kecamatan),
          kota: resolvedAdmin.kota || customer.kota,
          zipcode: resolvedAdmin.zipcode || customer.zipcode,
          preferences: {
            ...prefsWithoutLabel,
            location_source: chosen.source,
            location_refreshed_at: nowIso,
            refreshed_by: performedBy,
            source_detail: chosen.detail,
            location_history: [...history.slice(-9), newHistoryEntry],
            location_updated_at: nowIso,
            location_updated_by_staff_name: performedBy || 'Admin',
            ...(isCustomerPin ? { pin_from_customer_at: nowIso } : {}),
            ...(isStaffPin ? { pin_from_staff_at: nowIso } : {}),
          },
        },
        tenantId
      );
    } catch (dbErr) {
      // memory fallback
      const memCustomers = memoryCustomersGetter ? memoryCustomersGetter() : null;
      const mem = memCustomers ? (memCustomers.get(customer.phone) || memCustomers.get(customerId)) : null;
      if (mem) {
        Object.assign(mem, {
          lat: chosen.lat,
          lng: chosen.lng,
          distance_km: delivery.distanceKm,
          ongkir: delivery.ongkir,
          is_out_of_coverage: delivery.isOutOfCoverage,
          kelurahan: resolvedAdmin.kelurahan || mem.kelurahan,
          kecamatan: resolvedAdmin.kecamatan || mem.kecamatan,
          kota: resolvedAdmin.kota || mem.kota,
          zipcode: resolvedAdmin.zipcode || mem.zipcode,
          preferences: {
            ...prefsWithoutLabel,
            location_source: chosen.source,
            location_refreshed_at: nowIso,
            refreshed_by: performedBy,
            source_detail: chosen.detail,
            location_history: [...history.slice(-9), newHistoryEntry],
            location_updated_at: nowIso,
            ...(isCustomerPin ? { pin_from_customer_at: nowIso } : {}),
            ...(isStaffPin ? { pin_from_staff_at: nowIso } : {}),
          },
          updated_at: new Date(),
        });
        if (isCustomerPin) mem.share_location_sent = true;
        mem.location_source =
          isPinSourceChosen
            ? LocationSource.gps_pin
            : chosen.source === 'manual_staff'
              ? LocationSource.manual_staff
              : chosen.source === 'geocoding' || chosen.source === 'url_text_geocoded'
                ? LocationSource.estimated_area
                : mem.location_source ?? LocationSource.estimated_area;
      }
    }

    // Auto-sync Google Contacts & live chat hub
    try {
      const { googleContactsService } = await import('./google-contacts.service');
      googleContactsService.syncCustomer(tenantId, customerId, { trigger: 'chat' }).catch(() => {});
    } catch {}
    try {
      const { getLiveChatHub } = await import('./live-chat-hub.service');
      getLiveChatHub().publish({ type: 'conversation.updated', tenantId, payload: { event: 'customer:location_refreshed', customerId, ...newHistoryEntry } }).catch(() => {});
    } catch {}

    return {
      success: true,
      data: {
        customerId,
        source: chosen.source,
        sourceLabel: chosen.sourceLabel,
        lat: chosen.lat,
        lng: chosen.lng,
        distanceKm: delivery.distanceKm,
        ongkir: delivery.ongkir,
        isOutOfCoverage: delivery.isOutOfCoverage,
        kelurahan: resolvedAdmin.kelurahan || customer.kelurahan || null,
        kecamatan: resolvedAdmin.kecamatan || customer.kecamatan || null,
        kota: resolvedAdmin.kota || customer.kota || null,
        refreshedAt: nowIso,
        refreshedBy: performedBy,
      },
    };
  } catch (e: any) {
    return { success: false, error: e.message || 'Gagal refresh lokasi' };
  }
}
