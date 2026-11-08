import { prisma } from '../../db/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { calculateHaversineDistance } from '../../utils/haversine';
import { getClinicLocationAsync } from '../../config/clinic-location';
import { resolveHumanAreaName } from '../staff-trip-tracking.service';
import { getRollingFollowUpMessage, getRollingVariant } from '../../config/followup-templates';
import { sanitizeCustomerNameForGreeting } from '../../utils/name-sanitizer';
import { ensureStaffSignature } from '../../utils/staff-signature';
import { getBrandIdentityAsync } from '../../config/brand';
import { PRIVACY_NEAR_CLINIC_KM } from './staff-tasks.service';

/**
 * Helper internal untuk mendapatkan nama klinik yang sah dan manusiawi:
 * 1. Prioritas per-tenant via Tenant.settings.brand.businessName
 * 2. Fallback tenant.name dari database
 * 3. Jaring pengaman deterministik: bila bernilai "Default Clinic" / kosong -> fallback "Kala Moms and Baby Spa"
 */
export async function resolveClinicName(tenantId: string = DEFAULT_TENANT_ID): Promise<string> {
  const FALLBACK_NAME = 'Kala Moms and Baby Spa';
  try {
    const brand = await getBrandIdentityAsync(tenantId);
    if (brand?.businessName && !/default[\s_-]*clinic/i.test(brand.businessName)) {
      return brand.businessName.trim();
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    if (tenant?.name && !/default[\s_-]*clinic/i.test(tenant.name)) {
      return tenant.name.trim();
    }
  } catch {
    // offline / DB error fallback
  }
  return FALLBACK_NAME;
}

/**
 * Render terpadu pesan perjalanan terapis (OTW / tiba di lokasi):
 * 1. Sanitasi nama pasien (anti-sapaan ganda "Bunda Bunda") + fallback "Bunda".
 * 2. Substitusi placeholder template tenant (data-driven, bisa diedit Super Admin).
 * 3. Jaring pengaman deterministik `Bunda Bunda` -> `Bunda`.
 * 4. Sanitasi deterministik nama dummy "Default Clinic"
 * 5. Sematkan tanda tangan `~ [Nama Terapis]` di baris paling bawah (idempoten).
 *
 * Placeholder OPSIONAL: `{etaMinutes}`, `{arrivalWib}`, `{departMapsUrl}`.
 * Bila tak diberikan → diganti string kosong (template lama tetap valid; tak ada placeholder menggantung).
 */
export function renderStaffTripMessage(
  templateText: string,
  params: {
    patientName: string;
    therapistName: string;
    clinicName: string;
    etaMinutes?: number | null;
    arrivalWib?: string | null;
    departMapsUrl?: string | null;
  }
): string {
  const cleanName = sanitizeCustomerNameForGreeting(params.patientName || '') || 'Bunda';
  const therapistName = (params.therapistName || '').trim() || 'Bidan Terapis';
  const clinicName = (!params.clinicName || /default[\s_-]*clinic/i.test(params.clinicName))
    ? 'Kala Moms and Baby Spa'
    : params.clinicName.trim();

  const rendered = templateText
    .replace(/\{\{?patientName\}\}?/gi, cleanName)
    .replace(/\{\{?name\}\}?/gi, cleanName)
    .replace(/\{\{?therapistName\}\}?/gi, therapistName)
    .replace(/\{\{?clinicName\}\}?/gi, clinicName)
    .replace(/\{\{?etaMinutes\}\}?/gi, params.etaMinutes != null ? String(params.etaMinutes) : '')
    .replace(/\{\{?arrivalWib\}\}?/gi, params.arrivalWib || '')
    .replace(/\{\{?departMapsUrl\}\}?/gi, params.departMapsUrl || '')
    .replace(/Bunda\s+Bunda/gi, 'Bunda')
    // Sanitasi deterministik nama dummy "Default Clinic"
    .replace(/\bDefault\s+Clinic\b/gi, clinicName)
    .trim();
  return ensureStaffSignature(rendered, therapistName);
}

/**
 * Sisipkan blok estimasi/lokasi ke pesan OTW (plan 2026-09-30). Deterministik:
 * hanya ditambahkan bila data tersedia; tanda tangan tetap di baris paling bawah.
 * Bila template admin SUDAH memakai placeholder `{etaMinutes}`/`{arrivalWib}`/
 * `{departMapsUrl}`, blok TIDAK ditambahkan (anti-duplikasi).
 */
export function appendEtaBlock(
  message: string,
  params: {
    etaMinutes?: number | null;
    arrivalWib?: string | null;
    departMapsUrl?: string | null;
    departAreaText?: string | null;
  }
): string {
  const hasEta = params.etaMinutes != null || !!params.arrivalWib;
  const hasLoc = !!params.departMapsUrl;
  const hasArea = !hasLoc && !!params.departAreaText;
  if (!hasEta && !hasLoc && !hasArea) return message;

  const lines: string[] = [];
  if (hasEta) {
    const parts: string[] = [];
    if (params.arrivalWib) parts.push(`Estimasi tiba ±${params.arrivalWib} WIB`);
    if (params.etaMinutes != null) parts.push(`~${params.etaMinutes} menit perjalanan`);
    lines.push(`⏱️ ${parts.join(' ')}`);
  }
  if (hasLoc) lines.push(`📍 Titik berangkat Bidan: ${params.departMapsUrl}`);
  else if (hasArea) lines.push(`📍 Berangkat menuju lokasi Bunda (${params.departAreaText})`);
  const block = lines.join('\n');

  // Sematkan sebelum tanda tangan (baris terakhir `~ Nama`), bila ada.
  const sigMatch = message.match(/\n~ .+$/);
  if (sigMatch && sigMatch.index != null) {
    const head = message.slice(0, sigMatch.index);
    const sig = message.slice(sigMatch.index);
    return `${head}\n${block}${sig}`;
  }
  return `${message}\n${block}`;
}

/**
 * Gerbang privasi domisili Bidan (plan 2026-10-02).
 *
 * Bila terapis berangkat dari luar radius klinik (rumah/kost pribadi), URL
 * koordinat presisi disembunyikan dan diganti nama area manusiawi. URL hanya
 * dikirim bila titik berangkat berada di sekitar klinik.
 *
 * Tenant-aware: koordinat pembanding dari `getClinicLocationAsync` (overlay
 * `Tenant.settings.clinicLocation`), bukan env global langsung.
 * Fail-open: koordinat clinic/berangkat tak valid → biarkan URL apa adanya.
 */
export async function resolveDepartureShare(
  tenantId: string,
  params: { departMapsUrl?: string | null; departLat?: number | null; departLng?: number | null }
): Promise<{ shareUrl: string | null; areaText: string | null }> {
  const url = params.departMapsUrl || null;
  if (!url) return { shareUrl: null, areaText: null };

  const lat = Number(params.departLat);
  const lng = Number(params.departLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { shareUrl: url, areaText: null };
  }

  try {
    const clinic = await getClinicLocationAsync(tenantId);
    const distanceKm = calculateHaversineDistance(
      { lat, lng },
      { lat: clinic.lat, lng: clinic.lng }
    );
    if (distanceKm <= PRIVACY_NEAR_CLINIC_KM) {
      return { shareUrl: url, areaText: null };
    }
    return { shareUrl: null, areaText: resolveHumanAreaName(lat, lng) };
  } catch {
    return { shareUrl: url, areaText: null };
  }
}

/**
 * Mengambil dan merender template pesan OTW (Menuju Lokasi) khusus tenant.
 * Mendukung kustomisasi dari Super Admin (`FollowUpTemplate` tipe `STAFF_OTW`).
 *
 * Sesuai mandat bisnis: pesan customer TIDAK boleh menambahkan estimasi tiba (ETA)
 * atau nama landmark otomatis karena dapat memberikan harapan palsu / kebingungan
 * pada pasien. Pesan dikirim secara personal & hangat dari Bidan ("Saya sudah...").
 */
export async function getOtwMessageText(
  tenantId: string = DEFAULT_TENANT_ID,
  params: {
    patientName: string;
    therapistName: string;
    etaMinutes?: number | null;
    arrivalWib?: string | null;
    departMapsUrl?: string | null;
    departLat?: number | null;
    departLng?: number | null;
  }
): Promise<string> {
  const therapistName = (params.therapistName || '').trim() || 'Bidan Terapis';

  const departure = await resolveDepartureShare(tenantId, {
    departMapsUrl: params.departMapsUrl,
    departLat: params.departLat,
    departLng: params.departLng,
  });
  const effectiveParams = {
    ...params,
    departMapsUrl: departure.shareUrl,
    departAreaText: departure.areaText,
  };

  try {
    const customTpl = await prisma.followUpTemplate.findUnique({
      where: {
        tenant_id_type_variant: {
          tenant_id: tenantId,
          type: 'STAFF_OTW',
          variant: 1,
        },
      },
    });

    const clinicName = await resolveClinicName(tenantId);

    const templateText =
      customTpl?.text ||
      `Halo Bunda {patientName} 😊\n\nSaya sudah dalam perjalanan menuju rumah Bunda untuk treatmentnya yaa 🚗💨\nMohon ditunggu, Bun. Sampai bertemu sebentar lagi 🤍`;

    return renderStaffTripMessage(templateText, {
      patientName: params.patientName,
      therapistName,
      clinicName,
      etaMinutes: params.etaMinutes,
      arrivalWib: params.arrivalWib,
      departMapsUrl: effectiveParams.departMapsUrl,
    });
  } catch (err: any) {
    console.error('[STAFF RESERVATION] Error rendering OTW template:', err.message);
    return renderStaffTripMessage(
      `Halo Bunda {patientName} 😊\n\nSaya sudah dalam perjalanan menuju rumah Bunda untuk treatmentnya yaa 🚗💨\nMohon ditunggu, Bun. Sampai bertemu sebentar lagi 🤍`,
      { patientName: params.patientName, therapistName, clinicName: 'Kala Moms and Baby Spa' }
    );
  }
}

/**
 * Mengambil dan merender template pesan "Sudah Sampai" (kedatangan terapis).
 * Data-driven: template bisa dikustom Super Admin (`FollowUpTemplate` tipe
 * `STAFF_ARRIVAL`) — sama seperti `STAFF_OTW`, tanpa hardcode di kode.
 */
export async function getArrivalMessageText(
  tenantId: string = DEFAULT_TENANT_ID,
  params: { patientName: string; therapistName: string }
): Promise<string> {
  const therapistName = (params.therapistName || '').trim() || 'Bidan Terapis';
  try {
    const customTpl = await prisma.followUpTemplate.findUnique({
      where: {
        tenant_id_type_variant: {
          tenant_id: tenantId,
          type: 'STAFF_ARRIVAL',
          variant: 1,
        },
      },
    });

    const clinicName = await resolveClinicName(tenantId);

    const templateText =
      customTpl?.text ||
      `Halo Bunda {patientName}, saya {therapistName} dari {clinicName} sudah sampai di depan rumah/lokasi Bunda ya 🙏`;

    return renderStaffTripMessage(templateText, {
      patientName: params.patientName,
      therapistName,
      clinicName,
    });
  } catch (err: any) {
    console.error('[STAFF RESERVATION] Error rendering arrival template:', err.message);
    return renderStaffTripMessage(
      `Halo Bunda {patientName}, saya {therapistName} sudah sampai di depan rumah/lokasi Bunda ya 🙏`,
      { patientName: params.patientName, therapistName, clinicName: 'Kala Moms and Baby Spa' }
    );
  }
}

/**
 * Merender pesan status perjalanan terapis untuk CS (jawaban siap kirim saat
 * pasien bertanya "sudah sampai mana?"). Data-driven: nama area & ETA di-inject
 * dari state trip; template bisa dikustom Super Admin (`STAFF_TRIP_STATUS`).
 */
export async function getTripStatusMessageText(
  tenantId: string = DEFAULT_TENANT_ID,
  params: { patientName: string; areaName?: string | null; etaMinutes?: number | null; variantKey?: string }
): Promise<string> {
  const cleanName = sanitizeCustomerNameForGreeting(params.patientName || '');
  const areaName = (params.areaName || '').trim() || 'perjalanan menuju lokasi';
  const etaMinutes = params.etaMinutes != null && Number.isFinite(Number(params.etaMinutes))
    ? String(Math.max(1, Math.round(Number(params.etaMinutes))))
    : 'beberapa';
  try {
    const variant = (getRollingVariant(params.variantKey || params.patientName || '', new Date()) || 1);
    const customTpl = await prisma.followUpTemplate.findUnique({
      where: {
        tenant_id_type_variant: { tenant_id: tenantId, type: 'STAFF_TRIP_STATUS', variant },
      },
    });
    if (customTpl?.text) {
      return customTpl.text
        .replace(/\{\{?name\}\}?/gi, cleanName || 'Bunda')
        .replace(/\{\{?patientName\}\}?/gi, cleanName || 'Bunda')
        .replace(/\{\{?areaName\}\}?/gi, areaName)
        .replace(/\{\{?etaMinutes\}\}?/gi, etaMinutes);
    }
    return getRollingFollowUpMessage('STAFF_TRIP_STATUS', {
      name: cleanName,
      areaName,
      etaMinutes,
      index: variant - 1,
    }).text;
  } catch (err: any) {
    console.error('[STAFF RESERVATION] Error rendering trip status template:', err.message);
    return getRollingFollowUpMessage('STAFF_TRIP_STATUS', {
      name: cleanName,
      areaName,
      etaMinutes,
      index: 0,
    }).text;
  }
}

/**
 * Merender draf pesan pemberitahuan keterlambatan Bidan ke pasien (siap kirim CS).
 * Data-driven: estimasi menit & jam tiba di-inject; template bisa dikustom Super
 * Admin (`STAFF_TRIP_DELAY`). Nama template TIDAK hardcode di frontend.
 */
export async function getTripDelayMessageText(
  tenantId: string = DEFAULT_TENANT_ID,
  params: { patientName: string; delayMinutes?: number | null; arrivalTime?: string | null; variantKey?: string }
): Promise<string> {
  const cleanName = sanitizeCustomerNameForGreeting(params.patientName || '');
  const delayMinutes =
    params.delayMinutes != null && Number.isFinite(Number(params.delayMinutes))
      ? String(Math.max(1, Math.round(Number(params.delayMinutes))))
      : 'beberapa';
  const arrivalTime = (params.arrivalTime || '').trim() || 'sebentar lagi';
  try {
    const variant = getRollingVariant(params.variantKey || params.patientName || '', new Date()) || 1;
    const customTpl = await prisma.followUpTemplate.findUnique({
      where: {
        tenant_id_type_variant: { tenant_id: tenantId, type: 'STAFF_TRIP_DELAY', variant },
      },
    });
    if (customTpl?.text) {
      return customTpl.text
        .replace(/\{\{?name\}\}?/gi, cleanName || 'Bunda')
        .replace(/\{\{?patientName\}\}?/gi, cleanName || 'Bunda')
        .replace(/\{\{?delayMinutes\}\}?/gi, delayMinutes)
        .replace(/\{\{?arrivalTime\}\}?/gi, arrivalTime);
    }
    return getRollingFollowUpMessage('STAFF_TRIP_DELAY', {
      name: cleanName,
      delayMinutes,
      arrivalTime,
      index: variant - 1,
    }).text;
  } catch (err: any) {
    console.error('[STAFF RESERVATION] Error rendering trip delay template:', err.message);
    return getRollingFollowUpMessage('STAFF_TRIP_DELAY', {
      name: cleanName,
      delayMinutes,
      arrivalTime,
      index: 0,
    }).text;
  }
}
