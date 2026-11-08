import { prisma } from '../../db/client';
import { LocationSource } from '@prisma/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { sanitizeKelurahanInput } from '../../utils/kelurahan-guard';
import { splitWilayahComposite } from '../../utils/wilayah-normalizer';
import {
  SavedCustomerAddress,
  UpsertSavedAddressInput,
  AddressTombstone,
  parseSavedAddresses,
  upsertAddressIntoList,
  ensureSinglePrimary,
  resolveActiveAddress as resolveActiveAddressFromList,
  removeAddressFromList,
  parseAddressTombstones,
  pruneAddressTombstones,
  matchesTombstone,
  removeMatchingTombstones,
  buildAddressKey,
  selectEnrichmentTarget,
  reconcileAddressLists,
} from '../../domain/customer-address';
import { ACTIVE_RESERVATION_STATUSES, isActiveReservation } from '../../domain/reservation-status';
import { STAFF_VERIFIED_LOCATION_LABEL } from '../staff-reservation.service';
import { pickGpsTier, GpsCandidate } from '../location-ingest.service';
import { memoryCustomers, isTestRuntime, toNumberOrNull, isPreciseGps } from './shared';

const addressBookLocks = new Map<string, Promise<unknown>>();

export async function withAddressBookLock<T>(customerId: string, fn: () => Promise<T>): Promise<T> {
  const key = `address-book:${customerId}`;
  const previous = addressBookLocks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(fn);
  const settled = run.catch(() => undefined);
  addressBookLocks.set(key, settled);
  try {
    return await run;
  } finally {
    if (addressBookLocks.get(key) === settled) addressBookLocks.delete(key);
  }
}

/** Normalisasi baris Prisma `customer_addresses` → kontrak domain camelCase. */
export function mapCanonicalAddressRow(row: any): SavedCustomerAddress {
  return {
    id: row.id,
    label: row.label ?? 'Rumah',
    address: row.address ?? '',
    kelurahan: row.kelurahan ?? null,
    kecamatan: row.kecamatan ?? null,
    kota: row.kota ?? null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    distanceKm: row.distance_km ?? null,
    ongkir: row.ongkir ?? null,
    landmark: row.landmark ?? null,
    locationSource: row.location_source ?? null,
    isPrimary: Boolean(row.is_primary),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : new Date().toISOString(),
  } as SavedCustomerAddress;
}

/**
 * Baca baris tabel kanonis. `null` = DB tidak tersedia.
 */
export async function readCanonicalAddressRows(
  customerId: string,
  tenantId: string
): Promise<SavedCustomerAddress[] | null> {
  try {
    if (typeof (prisma as any).customerAddress?.findMany !== 'function') return null;
    const rows = await prisma.customerAddress.findMany({
      where: { tenant_id: tenantId, customer_id: customerId },
      orderBy: [{ is_primary: 'desc' }, { last_used_at: 'desc' }],
    });
    return (rows || []).map((row: any) => mapCanonicalAddressRow(row));
  } catch {
    return null;
  }
}

/** Daftar alamat efektif: kanonis (tabel) ∪ cache (preferences), tanpa duplikat. */
export async function canonicalAddressListFor(customer: any, tenantId: string): Promise<SavedCustomerAddress[]> {
  const fromPreferences = parseSavedAddresses(customer?.preferences);
  if (!customer?.id) return fromPreferences;
  const fromTable = await readCanonicalAddressRows(customer.id, tenantId);
  if (!fromTable || fromTable.length === 0) return fromPreferences;
  return reconcileAddressLists(fromTable, fromPreferences);
}

/**
 * Tulis daftar alamat ke preferences via seam repository.
 */
export async function persistSavedAddresses(
  customer: any,
  tenantId: string,
  list: SavedCustomerAddress[],
  nowIso: string,
  tombstones?: AddressTombstone[]
): Promise<void> {
  const patch: Record<string, unknown> = {
    saved_addresses: list,
    saved_addresses_updated_at: nowIso,
    ...(tombstones !== undefined ? { address_tombstones: tombstones } : {}),
  };
  const newPrefs = { ...((customer?.preferences as any) || {}), ...patch };

  let persistedAtomically = false;
  const rawExec = (prisma as any).$executeRawUnsafe;
  if (typeof rawExec === 'function') {
    try {
      const affected = await rawExec.call(
        prisma,
        `UPDATE customers
            SET preferences = COALESCE(preferences, '{}'::jsonb) || $2::jsonb,
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $3`,
        customer.id,
        JSON.stringify(patch),
        tenantId
      );
      if (typeof affected === 'number' && affected === 0) {
        throw new Error('CUSTOMER_PREFERENCES_UPDATE_NO_ROWS');
      }
      persistedAtomically = true;
      customer.preferences = newPrefs;
    } catch (error) {
      if (!isTestRuntime()) {
        console.warn(
          '[CustomerService] persistSavedAddresses atomic merge gagal, fallback read-merge-write:',
          (error as Error)?.message
        );
      }
    }
  }

  if (!persistedAtomically) {
    try {
      const repo = (await import('../../repositories/customer.repository')).getCustomerRepository();
      await repo.update(customer.id, { preferences: newPrefs });
      customer.preferences = newPrefs;
    } catch (error) {
      if (!isTestRuntime()) {
        console.error('[CustomerService] persistSavedAddresses DB failed (fail-fast):', (error as Error)?.message);
        throw error;
      }
      for (const cust of memoryCustomers.values()) {
        if (cust.id === customer.id && cust.tenant_id === tenantId) {
          cust.preferences = newPrefs;
        }
      }
      customer.preferences = newPrefs;
    }
  }

  // Dual-write ke tabel relasional customer_addresses
  try {
    if (typeof (prisma as any).customerAddress?.upsert === 'function') {
      for (const addr of list) {
        await prisma.customerAddress.upsert({
          where: { id: addr.id },
          create: {
            id: addr.id,
            tenant_id: tenantId,
            customer_id: customer.id,
            label: addr.label,
            address: addr.address || '',
            kelurahan: addr.kelurahan ?? null,
            kecamatan: addr.kecamatan ?? null,
            kota: addr.kota ?? null,
            lat: addr.lat ?? null,
            lng: addr.lng ?? null,
            distance_km: addr.distanceKm ?? null,
            ongkir: addr.ongkir != null ? Math.round(addr.ongkir) : null,
            landmark: addr.landmark ?? null,
            location_source: addr.locationSource ?? null,
            is_primary: Boolean(addr.isPrimary),
            created_at: new Date(addr.createdAt),
            last_used_at: new Date(addr.lastUsedAt),
          },
          update: {
            label: addr.label,
            address: addr.address || '',
            kelurahan: addr.kelurahan ?? null,
            kecamatan: addr.kecamatan ?? null,
            kota: addr.kota ?? null,
            lat: addr.lat ?? null,
            lng: addr.lng ?? null,
            distance_km: addr.distanceKm ?? null,
            ongkir: addr.ongkir != null ? Math.round(addr.ongkir) : null,
            landmark: addr.landmark ?? null,
            location_source: addr.locationSource ?? null,
            is_primary: Boolean(addr.isPrimary),
            last_used_at: new Date(addr.lastUsedAt),
          },
        }).catch(() => {});
      }
    }
  } catch {
    // Best-effort dual-write
  }
}

/**
 * Sinkronkan sebuah lokasi tulis ke buku alamat (dipakai seam update lokasi).
 */
export async function syncSavedAddressFromLocation(
  customer: any,
  tenantId: string,
  loc: UpsertSavedAddressInput & { isPrimary?: boolean },
  getCustomerByIdFn: (id: string, tenantId: string) => Promise<any>
): Promise<void> {
  if (!customer?.id) return;
  return withAddressBookLock(customer.id, async () => {
    const fresh = await getCustomerByIdFn(customer.id, tenantId);
    if (!fresh) return;
    const tombstones = parseAddressTombstones(fresh.preferences);
    if (tombstones.some((t) => matchesTombstone(t, loc))) {
      return;
    }
    const list = await canonicalAddressListFor(fresh, tenantId);
    const nowIso = new Date().toISOString();
    const target = selectEnrichmentTarget(list, loc);
    const { list: nextList } = upsertAddressIntoList(
      list,
      target ? { ...loc, id: target.id } : loc,
      nowIso
    );
    await persistSavedAddresses(fresh, tenantId, nextList, nowIso);
    customer.preferences = fresh.preferences;
  });
}

/**
 * Selaraskan jadwal aktif ke alamat pelanggan terkini setelah lokasi berubah.
 */
export async function syncActiveReservationsAfterLocationChange(customerId: string, tenantId: string): Promise<void> {
  try {
    const { syncActiveReservationsForCustomer } = await import('../reservation-address-sync.service');
    await syncActiveReservationsForCustomer({ tenantId, customerId });
  } catch (e) {
    console.error('[CustomerService] active reservation sync FAILED:', {
      customerId,
      message: (e as Error)?.message,
    });
  }
}

/**
 * Baca daftar alamat tersimpan customer.
 */
export async function getSavedAddresses(
  customerId: string,
  tenantId: string,
  getCustomerByIdFn: (id: string, tenantId: string) => Promise<any>
): Promise<SavedCustomerAddress[]> {
  const customer = await getCustomerByIdFn(customerId, tenantId);
  if (!customer) return [];
  return canonicalAddressListFor(customer, tenantId);
}

/**
 * Tambah/perbarui satu alamat tersimpan.
 */
export async function upsertSavedAddress(
  customerId: string,
  input: UpsertSavedAddressInput,
  tenantId: string,
  getCustomerByIdFn: (id: string, tenantId: string) => Promise<any>
): Promise<SavedCustomerAddress | null> {
  return withAddressBookLock(customerId, async () => {
    const customer = await getCustomerByIdFn(customerId, tenantId);
    if (!customer) return null;
    const list = await canonicalAddressListFor(customer, tenantId);
    const nowIso = new Date().toISOString();
    const { list: nextList, entry } = upsertAddressIntoList(list, input, nowIso);
    const existingTombstones = parseAddressTombstones(customer.preferences);
    const nextTombstones = removeMatchingTombstones(existingTombstones, input);
    await persistSavedAddresses(customer, tenantId, nextList, nowIso, nextTombstones);
    return entry;
  });
}

/**
 * Tambah alamat baru dari admin UI.
 */
export async function addSavedAddress(
  customerId: string,
  input: UpsertSavedAddressInput,
  tenantId: string,
  getCustomerByIdFn: (id: string, tenantId: string) => Promise<any>
): Promise<SavedCustomerAddress> {
  if (!input.label || !input.label.trim()) {
    throw new Error('Label alamat wajib diisi');
  }
  const entry = await upsertSavedAddress(customerId, input, tenantId, getCustomerByIdFn);
  if (!entry) {
    throw new Error('Customer tidak ditemukan');
  }
  return entry;
}

/** Tetapkan alamat utama (primary). */
export async function setDefaultAddress(
  customerId: string,
  addressId: string,
  tenantId: string,
  getCustomerByIdFn: (id: string, tenantId: string) => Promise<any>
): Promise<void> {
  return withAddressBookLock(customerId, async () => {
    const customer = await getCustomerByIdFn(customerId, tenantId);
    if (!customer) return;
    const list = await canonicalAddressListFor(customer, tenantId);
    if (!list.some((a) => a.id === addressId)) return;
    const nowIso = new Date().toISOString();
    const next = ensureSinglePrimary(list, addressId).map((a) =>
      a.id === addressId ? { ...a, lastUsedAt: nowIso } : a
    );
    await persistSavedAddresses(customer, tenantId, next, nowIso);
  });
}

/** Resolusi alamat aktif: primary menang, fallback lastUsedAt terbaru. */
export async function resolveActiveSavedAddress(
  customerId: string,
  tenantId: string,
  getCustomerByIdFn: (id: string, tenantId: string) => Promise<any>
): Promise<SavedCustomerAddress | null> {
  const list = await getSavedAddresses(customerId, tenantId, getCustomerByIdFn);
  return resolveActiveAddressFromList(list);
}

/** Hapus kartu dari buku alamat. */
export async function deleteSavedAddress(
  customerId: string,
  addressId: string,
  tenantId: string,
  getCustomerByIdFn: (id: string, tenantId: string) => Promise<any>
): Promise<{ deleted: boolean; activeCount: number }> {
  return withAddressBookLock(customerId, async () => {
    const customer = await getCustomerByIdFn(customerId, tenantId);
    if (!customer) return { deleted: false, activeCount: 0 };
    const list = await canonicalAddressListFor(customer, tenantId);
    const target = list.find((a) => a.id === addressId);
    if (!target) return { deleted: false, activeCount: 0 };

    let rows: any[] = [];
    try {
      rows = await prisma.reservation.findMany({
        where: {
          tenant_id: tenantId,
          customer_id: customerId,
          customer_address_id: addressId,
          status: { in: ACTIVE_RESERVATION_STATUSES },
        },
      });
    } catch (error) {
      console.error('[CustomerService] deleteSavedAddress guard query failed (fail-closed):', (error as Error)?.message);
      throw error;
    }
    const activeCount = (rows || []).filter((r: any) => isActiveReservation(r)).length;
    if (activeCount > 0) return { deleted: false, activeCount };

    const nowIso = new Date().toISOString();
    const { list: nextList } = removeAddressFromList(list, addressId);

    const existingTombstones = parseAddressTombstones(customer.preferences);
    const newTombstone: AddressTombstone = {
      address: target.address ?? null,
      kelurahan: target.kelurahan ?? null,
      kecamatan: target.kecamatan ?? null,
      kota: target.kota ?? null,
      lat: target.lat ?? null,
      lng: target.lng ?? null,
      deletedAt: nowIso,
    };
    const nextTombstones = pruneAddressTombstones([...existingTombstones, newTombstone], nowIso);

    await persistSavedAddresses(customer, tenantId, nextList, nowIso, nextTombstones);

    try {
      if (typeof (prisma as any).customerAddress?.deleteMany === 'function') {
        await prisma.customerAddress.deleteMany({
          where: { id: addressId, customer_id: customerId, tenant_id: tenantId },
        });
      }
    } catch (error) {
      console.warn('[CustomerService] ADDR_BOOK_DELETE_TABLE_FAILED:', {
        customerId,
        addressId,
        message: (error as Error)?.message,
      });
    }
    return { deleted: true, activeCount: 0 };
  });
}

/**
 * Update detail data lokasi dan ongkir customer
 */
export async function updateCustomerLocation(
  customerId: string,
  data: {
    address?: string;
    kelurahan?: string;
    kecamatan?: string;
    kota?: string;
    lat?: number;
    lng?: number;
    distanceKm?: number;
    ongkir?: number;
    isOutOfCoverage?: boolean;
    zipcode?: string;
    isNativePin?: boolean;
    locationSource?: LocationSource;
    isEstimatedCentroid?: boolean;
    labelSource?: 'boundary' | 'centroid' | 'user_stated' | 'manual_staff';
    forceUpdateGps?: boolean;
    savedAddressId?: string;
  },
  tenantId: string,
  getCustomerByIdFn: (id: string, tenantId: string) => Promise<any>
): Promise<any> {
  const safeKelurahanRaw = data.kelurahan;
  let safeKelurahan = safeKelurahanRaw !== undefined
    ? sanitizeKelurahanInput(safeKelurahanRaw)
    : undefined;
  let safeKecamatan = data.kecamatan?.trim() || undefined;

  if (safeKecamatan && /[,/;]/.test(safeKecamatan)) {
    const split = splitWilayahComposite(safeKecamatan);
    if (split.kecamatan) {
      safeKecamatan = split.kecamatan;
      if (!safeKelurahan && split.kelurahan) {
        safeKelurahan = split.kelurahan;
      }
      if (!data.kota && split.kota) {
        data.kota = split.kota;
      }
    }
  }
  try {
    const existing = await prisma.customer.findFirst({
      where: { id: customerId, tenant_id: tenantId },
    });
    if (!existing) {
      throw new Error(`Customer ${customerId} not found for tenant ${tenantId}`);
    }

    const savedEntry = data.savedAddressId
      ? parseSavedAddresses(existing.preferences).find((a) => a.id === data.savedAddressId)
      : undefined;
    if (savedEntry) {
      data = {
        ...data,
        kelurahan: savedEntry.kelurahan ?? data.kelurahan,
        kecamatan: savedEntry.kecamatan ?? data.kecamatan,
        kota: savedEntry.kota ?? data.kota,
        lat: savedEntry.lat ?? data.lat,
        lng: savedEntry.lng ?? data.lng,
        distanceKm: savedEntry.distanceKm ?? data.distanceKm,
        ongkir: savedEntry.ongkir ?? data.ongkir,
        locationSource: (savedEntry.locationSource as LocationSource | null) ?? data.locationSource,
      };
    }
    const explicitMove = data.forceUpdateGps === true || Boolean(savedEntry);

    const isNewGpsInput = data.isNativePin === true || data.locationSource === LocationSource.gps_pin;
    const preserveExactGps = isPreciseGps(existing) && !isNewGpsInput && !explicitMove;

    const effectiveLat = preserveExactGps
      ? existing.lat
      : data.lat !== undefined
        ? toNumberOrNull(data.lat)
        : existing.lat;
    const effectiveLng = preserveExactGps
      ? existing.lng
      : data.lng !== undefined
        ? toNumberOrNull(data.lng)
        : existing.lng;
    const effectiveDistance = preserveExactGps
      ? existing.distance_km
      : data.distanceKm !== undefined
        ? data.distanceKm
        : existing.distance_km;
    const effectiveOngkir = preserveExactGps
      ? existing.ongkir
      : data.ongkir !== undefined
        ? data.ongkir
        : existing.ongkir;

    const effectiveSource: LocationSource | undefined = preserveExactGps
      ? (existing.location_source as LocationSource | null) ?? undefined
      : data.locationSource
        ? data.locationSource
        : data.isNativePin
          ? LocationSource.gps_pin
          : data.lat !== undefined || data.lng !== undefined
            ? LocationSource.estimated_area
            : undefined;

    let finalKelurahan = safeKelurahan ?? existing.kelurahan;
    let finalKecamatan = safeKecamatan ?? existing.kecamatan;
    let labelConflict: any = null;

    const isCentroidEstimate = (data as any)?.isEstimatedCentroid === true || (data as any)?.labelSource === 'centroid';
    const hasExistingKec = Boolean(existing.kecamatan && existing.kecamatan.trim());

    if (isCentroidEstimate && hasExistingKec && !explicitMove && safeKecamatan) {
      const normKec = (s?: string | null) => String(s ?? '').trim().toLowerCase();
      if (normKec(safeKecamatan) !== normKec(existing.kecamatan)) {
        console.warn(`[LABEL GUARD] Centroid estimate (${safeKecamatan}) rejected against existing customer region (${existing.kecamatan}) for customer ${customerId}`);
        finalKecamatan = existing.kecamatan;
        finalKelurahan = existing.kelurahan ?? safeKelurahan ?? null;
        labelConflict = {
          existingKecamatan: existing.kecamatan,
          rejectedCentroidKecamatan: safeKecamatan,
          rejectedCentroidKelurahan: safeKelurahan,
          detectedAt: new Date().toISOString(),
        };
      }
    }

    const updated = await prisma.customer.update({
      where: { id: customerId },
      data: {
        kelurahan: finalKelurahan,
        kecamatan: finalKecamatan,
        kota: data.kota ?? existing.kota,
        lat: effectiveLat,
        lng: effectiveLng,
        distance_km: effectiveDistance,
        ongkir: effectiveOngkir,
        is_out_of_coverage: data.isOutOfCoverage ?? false,
        zipcode: data.zipcode ?? existing.zipcode,
        ...(effectiveSource !== undefined ? { location_source: effectiveSource } : {}),
      },
    });

    try {
      const prevPrefs = (existing.preferences as any) || {};
      const hist: any[] = Array.isArray(prevPrefs.location_history) ? prevPrefs.location_history : [];
      const safeKota = data.kota ?? existing.kota;
      const entry = {
        kelurahan: safeKelurahan ?? existing.kelurahan,
        kecamatan: safeKecamatan ?? existing.kecamatan,
        kota: safeKota,
        lat: effectiveLat,
        lng: effectiveLng,
        distance_km: effectiveDistance,
        ongkir: effectiveOngkir,
        source: effectiveSource || existing.location_source || null,
        timestamp: new Date().toISOString(),
      };
      const rawAddr = (data as any)?.address?.trim();
      await prisma.customer.update({
        where: { id: customerId },
        data: {
          preferences: {
            ...prevPrefs,
            ...(rawAddr ? { address: rawAddr, full_address: rawAddr } : {}),
            ...(labelConflict ? { address_label_conflict: labelConflict } : {}),
            location_history: [...hist.slice(-9), entry],
            location_updated_at: new Date().toISOString(),
          } as any,
        },
      });
    } catch {}
    try {
      const { auditService } = await import('../audit.service');
      await auditService.logAdminAction({
        apiKey: 'SYSTEM',
        adminIdentity: 'SYSTEM_LOCATION_SEAM',
        action: 'CUSTOMER_LOCATION_UPDATE',
        targetId: customerId,
        payload: { kelurahan: safeKelurahan, kecamatan: safeKecamatan, lat: effectiveLat, lng: effectiveLng },
        tenantId,
      } as any).catch(() => {});
    } catch {}

    if (safeKelurahan || safeKecamatan) {
      import('../google-contacts.service')
        .then(({ googleContactsService }) => {
          googleContactsService.syncCustomer(tenantId, customerId, { trigger: 'chat' }).catch(() => {});
        })
        .catch(() => {});
    }

    try {
      const safeKota = data.kota ?? existing.kota;
      const existingCards = parseSavedAddresses(existing.preferences);
      const singleCard = existingCards.length === 1 ? existingCards[0] : null;
      const prevAddress = (data as any)?.address?.trim()
        || singleCard?.address
        || (existing.preferences as any)?.address
        || '';
      const writeLoc = savedEntry
        ? {
            address: prevAddress,
            kelurahan: safeKelurahan ?? existing.kelurahan,
            kecamatan: safeKecamatan ?? existing.kecamatan,
            kota: safeKota,
            lat: effectiveLat,
            lng: effectiveLng,
            distanceKm: effectiveDistance,
            ongkir: effectiveOngkir,
            locationSource: (effectiveSource as any) ?? 'manual_staff',
            isPrimary: true,
          }
        : preserveExactGps
          ? {
              kelurahan: safeKelurahan ?? existing.kelurahan,
              kecamatan: safeKecamatan ?? existing.kecamatan,
              kota: safeKota,
              lat: data.lat ?? null,
              lng: data.lng ?? null,
              distanceKm: data.distanceKm ?? null,
              ongkir: data.ongkir ?? null,
              locationSource: 'estimated_area' as const,
            }
          : {
              address: prevAddress,
              kelurahan: safeKelurahan ?? existing.kelurahan,
              kecamatan: safeKecamatan ?? existing.kecamatan,
              kota: safeKota,
              lat: effectiveLat,
              lng: effectiveLng,
              distanceKm: effectiveDistance,
              ongkir: effectiveOngkir,
              locationSource: (effectiveSource as any) ?? undefined,
              isPrimary: true,
            };
      const hasLoc = Boolean(
        safeKelurahan || safeKecamatan || safeKota || data.lat !== undefined || data.lng !== undefined || savedEntry
      );
      if (hasLoc) await syncSavedAddressFromLocation(existing, tenantId, writeLoc as any, getCustomerByIdFn);
    } catch (syncErr) {
      console.warn('[CustomerService] syncSavedAddressFromLocation failed (best-effort):', (syncErr as Error)?.message);
    }

    await syncActiveReservationsAfterLocationChange(customerId, tenantId);

    return updated;
  } catch (error) {
    if (!isTestRuntime()) {
      console.error('[CustomerService] updateCustomerLocation DB failed (fail-fast):', (error as Error)?.message);
      throw error;
    }
    for (const [phone, cust] of memoryCustomers.entries()) {
      if (cust.id === customerId && cust.tenant_id === tenantId) {
        const savedEntry = data.savedAddressId
          ? parseSavedAddresses(cust.preferences).find((a) => a.id === data.savedAddressId)
          : undefined;
        const d = savedEntry
          ? {
              ...data,
              kelurahan: savedEntry.kelurahan ?? data.kelurahan,
              kecamatan: savedEntry.kecamatan ?? data.kecamatan,
              kota: savedEntry.kota ?? data.kota,
              lat: savedEntry.lat ?? data.lat,
              lng: savedEntry.lng ?? data.lng,
              distanceKm: savedEntry.distanceKm ?? data.distanceKm,
              ongkir: savedEntry.ongkir ?? data.ongkir,
              locationSource: (savedEntry.locationSource as LocationSource | null) ?? data.locationSource,
            }
          : data;
        const explicitMove = d.forceUpdateGps === true || Boolean(savedEntry);
        const isNewGpsInput = d.isNativePin === true || d.locationSource === LocationSource.gps_pin;
        const preserveGps = isPreciseGps(cust) && !isNewGpsInput && !explicitMove;
        const effLat = preserveGps ? cust.lat : (d.lat !== undefined ? (toNumberOrNull(d.lat) ?? cust.lat) : cust.lat);
        const effLng = preserveGps ? cust.lng : (d.lng !== undefined ? (toNumberOrNull(d.lng) ?? cust.lng) : cust.lng);
        const effDist = preserveGps ? cust.distance_km : (d.distanceKm !== undefined ? d.distanceKm : cust.distance_km);
        const effOngkir = preserveGps ? cust.ongkir : (d.ongkir !== undefined ? d.ongkir : cust.ongkir);
        const effSource = preserveGps
          ? cust.location_source
          : d.locationSource
            ? d.locationSource
            : d.isNativePin
              ? LocationSource.gps_pin
              : (d.lat !== undefined || d.lng !== undefined)
                ? LocationSource.estimated_area
                : cust.location_source;
        const currentPrefs = (cust.preferences as any) || {};
        if ((d as any)?.address) {
          currentPrefs.address = (d as any).address;
          currentPrefs.full_address = (d as any).address;
        }
        let memSafeKel = savedEntry?.kelurahan ?? safeKelurahan ?? cust.kelurahan;
        let memSafeKec = savedEntry?.kecamatan ?? safeKecamatan ?? cust.kecamatan;
        const memSafeKota = savedEntry?.kota ?? d.kota ?? cust.kota;

        const isMemCentroidEstimate = (d as any)?.isEstimatedCentroid === true || (d as any)?.labelSource === 'centroid';
        const hasMemExistingKec = Boolean(cust.kecamatan && cust.kecamatan.trim());
        if (isMemCentroidEstimate && hasMemExistingKec && !explicitMove && safeKecamatan) {
          const normKec = (s?: string | null) => String(s ?? '').trim().toLowerCase();
          if (normKec(safeKecamatan) !== normKec(cust.kecamatan)) {
            memSafeKec = cust.kecamatan;
            memSafeKel = cust.kelurahan || safeKelurahan;
            currentPrefs.address_label_conflict = {
              existingKecamatan: cust.kecamatan,
              rejectedCentroidKecamatan: safeKecamatan,
              rejectedCentroidKelurahan: safeKelurahan,
              detectedAt: new Date().toISOString(),
            };
          }
        }
        Object.assign(cust, {
          kelurahan: memSafeKel,
          kecamatan: memSafeKec,
          kota: memSafeKota,
          lat: effLat,
          lng: effLng,
          distance_km: effDist,
          ongkir: effOngkir,
          is_out_of_coverage: d.isOutOfCoverage ?? cust.is_out_of_coverage,
          zipcode: d.zipcode !== undefined ? d.zipcode : cust.zipcode,
          ...(effSource !== undefined ? { location_source: effSource } : {}),
          preferences: currentPrefs,
          updated_at: new Date(),
        });
        if (d.isNativePin) cust.share_location_sent = true;
        try {
          const existingCards = parseSavedAddresses(cust.preferences);
          const singleCard = existingCards.length === 1 ? existingCards[0] : null;
          const prevAddress = (d as any)?.address || singleCard?.address || (cust.preferences as any)?.address || '';
          const writeLoc = savedEntry
            ? {
                address: prevAddress,
                kelurahan: memSafeKel,
                kecamatan: memSafeKec,
                kota: memSafeKota,
                lat: effLat,
                lng: effLng,
                distanceKm: effDist,
                ongkir: effOngkir,
                locationSource: (effSource as any) ?? 'manual_staff',
                isPrimary: true,
              }
            : preserveGps
              ? {
                  kelurahan: memSafeKel,
                  kecamatan: memSafeKec,
                  kota: memSafeKota,
                  lat: d.lat ?? null,
                  lng: d.lng ?? null,
                  distanceKm: d.distanceKm ?? null,
                  ongkir: d.ongkir ?? null,
                  locationSource: 'estimated_area' as const,
                }
              : {
                  address: prevAddress,
                  kelurahan: memSafeKel,
                  kecamatan: memSafeKec,
                  kota: memSafeKota,
                  lat: effLat,
                  lng: effLng,
                  distanceKm: effDist,
                  ongkir: effOngkir,
                  locationSource: (effSource as any) ?? undefined,
                  isPrimary: true,
                };
          const hasLoc = Boolean(
            memSafeKel || memSafeKec || memSafeKota || d.lat !== undefined || d.lng !== undefined || savedEntry
          );
          if (hasLoc) await syncSavedAddressFromLocation(cust, tenantId, writeLoc as any, getCustomerByIdFn);
        } catch (syncErr) {
          console.warn('[CustomerService] sync (mem) failed (best-effort):', (syncErr as Error)?.message);
        }
        await syncActiveReservationsAfterLocationChange(customerId, tenantId);
        return cust;
      }
    }
    return null;
  }
}

export async function updateCustomerPendingLocation(
  customerId: string,
  data: {
    kelurahan?: string | null;
    kecamatan?: string | null;
    kota?: string | null;
    lat?: number | null;
    lng?: number | null;
    zipcode?: string | null;
  },
  tenantId: string
): Promise<any> {
  try {
    const existing = await prisma.customer.findFirst({
      where: { id: customerId, tenant_id: tenantId },
    });
    if (!existing) {
      throw new Error(`Customer ${customerId} not found for tenant ${tenantId}`);
    }

    return await prisma.customer.update({
      where: { id: customerId },
      data: {
        pending_kelurahan: data.kelurahan,
        pending_kecamatan: data.kecamatan,
        pending_kota: data.kota,
        pending_lat: toNumberOrNull(data.lat),
        pending_lng: toNumberOrNull(data.lng),
        pending_zipcode: data.zipcode,
      },
    });
  } catch (error) {
    for (const [phone, cust] of memoryCustomers.entries()) {
      if (cust.id === customerId && cust.tenant_id === tenantId) {
        Object.assign(cust, {
          pending_kelurahan: data.kelurahan !== undefined ? data.kelurahan : cust.pending_kelurahan,
          pending_kecamatan: data.kecamatan !== undefined ? data.kecamatan : cust.pending_kecamatan,
          pending_kota: data.kota !== undefined ? data.kota : cust.pending_kota,
          pending_lat: toNumberOrNull(data.lat) ?? cust.pending_lat,
          pending_lng: toNumberOrNull(data.lng) ?? cust.pending_lng,
          pending_zipcode: data.zipcode !== undefined ? data.zipcode : cust.pending_zipcode,
          updated_at: new Date(),
        });
        return cust;
      }
    }
    return null;
  }
}

export async function clearPendingLocation(customerId: string, tenantId: string): Promise<any> {
  return updateCustomerPendingLocation(
    customerId,
    {
      kelurahan: null,
      kecamatan: null,
      kota: null,
      lat: null,
      lng: null,
      zipcode: null,
    },
    tenantId
  );
}

export async function resetFullLocation(customerId: string, tenantId: string): Promise<any> {
  try {
    return await prisma.customer.update({
      where: { id: customerId },
      data: {
        kelurahan: null,
        kecamatan: null,
        kota: null,
        lat: null,
        lng: null,
        zipcode: null,
        distance_km: null,
        ongkir: null,
        is_out_of_coverage: false,
        pending_kelurahan: null,
        pending_kecamatan: null,
        pending_kota: null,
        pending_lat: null,
        pending_lng: null,
        pending_zipcode: null,
      },
    });
  } catch (error) {
    for (const [phone, cust] of memoryCustomers.entries()) {
      if (cust.id === customerId && cust.tenant_id === tenantId) {
        Object.assign(cust, {
          kelurahan: null,
          kecamatan: null,
          kota: null,
          lat: null,
          lng: null,
          zipcode: null,
          distance_km: null,
          ongkir: null,
          is_out_of_coverage: false,
          pending_kelurahan: null,
          pending_kecamatan: null,
          pending_kota: null,
          pending_lat: null,
          pending_lng: null,
          pending_zipcode: null,
          updated_at: new Date(),
        });
        return cust;
      }
    }
    throw new Error(`Customer ${customerId} not found for tenant ${tenantId}`);
  }
}

export async function promotePendingLocation(
  customerId: string,
  pendingData: {
    pending_kelurahan: string;
    pending_kecamatan: string;
    pending_kota: string;
    pending_lat: number;
    pending_lng: number;
    pending_zipcode?: string | null;
  },
  deliveryCalculator: (coords: { lat: number; lng: number }) => Promise<{
    distanceKm: number;
    ongkir: number;
    isOutOfCoverage: boolean;
  }>,
  tenantId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const pendingLat = toNumberOrNull(pendingData.pending_lat);
    const pendingLng = toNumberOrNull(pendingData.pending_lng);
    if (pendingLat === null || pendingLng === null) {
      return { success: false, error: 'Koordinat pending tidak valid (bukan angka).' };
    }

    const delivery = await deliveryCalculator({
      lat: pendingLat,
      lng: pendingLng,
    });

    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.customer.findFirst({
          where: { id: customerId, tenant_id: tenantId },
        });
        if (!existing) {
          throw new Error(`Customer ${customerId} not found for tenant ${tenantId}`);
        }

        const preservePendingGps = isPreciseGps(existing);

        await tx.customer.update({
          where: { id: customerId },
          data: {
            kelurahan: pendingData.pending_kelurahan,
            kecamatan: pendingData.pending_kecamatan,
            kota: pendingData.pending_kota,
            ...(preservePendingGps
              ? {}
              : {
                  lat: pendingLat,
                  lng: pendingLng,
                  zipcode: pendingData.pending_zipcode || null,
                  distance_km: delivery.distanceKm,
                  ongkir: delivery.ongkir,
                  is_out_of_coverage: delivery.isOutOfCoverage,
                }),

            pending_kelurahan: null,
            pending_kecamatan: null,
            pending_kota: null,
            pending_lat: null,
            pending_lng: null,
            pending_zipcode: null,
          },
        });
      });
      return { success: true };
    } catch (dbError) {
      console.warn('[PROMOTE FALLBACK] Database transaction failed, using in-memory promotion fallback.');
      let found = false;
      for (const [phone, cust] of memoryCustomers.entries()) {
        if (cust.id === customerId && cust.tenant_id === tenantId) {
          const preservePendingGps = isPreciseGps(cust);
          Object.assign(cust, {
            kelurahan: pendingData.pending_kelurahan,
            kecamatan: pendingData.pending_kecamatan,
            kota: pendingData.pending_kota,
            ...(preservePendingGps
              ? {}
              : {
                  lat: pendingLat,
                  lng: pendingLng,
                  zipcode: pendingData.pending_zipcode || null,
                  distance_km: delivery.distanceKm,
                  ongkir: delivery.ongkir,
                  is_out_of_coverage: delivery.isOutOfCoverage,
                }),

            pending_kelurahan: null,
            pending_kecamatan: null,
            pending_kota: null,
            pending_lat: null,
            pending_lng: null,
            pending_zipcode: null,
            updated_at: new Date(),
          });
          found = true;
          break;
        }
      }
      if (found) {
        return { success: true };
      }
      throw dbError;
    }
  } catch (error) {
    console.error('[PROMOTE TRANSACTION ERROR] Failed to promote pending location:', error);
    return { success: false, error: (error as Error).message };
  }
}

export async function markShareLocationSent(customerId: string, tenantId: string): Promise<any> {
  try {
    const updated = await prisma.customer.update({
      where: { id: customerId },
      data: { share_location_sent: true },
    });
    memoryCustomers.set(updated.phone, updated);
    return updated;
  } catch (error) {
    const cust = Array.from(memoryCustomers.values()).find(
      (c) => c.id === customerId && c.tenant_id === tenantId
    );
    if (cust) {
      cust.share_location_sent = true;
      cust.updated_at = new Date();
    }
    return cust;
  }
}

export async function refreshCustomerLocationAndOngkir(
  customerId: string,
  tenantId: string = DEFAULT_TENANT_ID,
  performedBy?: string,
  getCustomerByIdFn?: (id: string, tenantId: string) => Promise<any>
): Promise<{
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
}> {
  try {
    const customer = getCustomerByIdFn
      ? await getCustomerByIdFn(customerId, tenantId)
      : await prisma.customer.findFirst({ where: { id: customerId, tenant_id: tenantId } });
    if (!customer) return { success: false, error: 'Customer tidak ditemukan' };

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
      try {
        const { messageService } = await import('../message.service');
        const { conversationService } = await import('../conversation.service');
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
      const re1 = /\[LOCATION\s+SHARE:\s*Lat\s*(-?\d+\.\d+)\s*,\s*Lng\s*(-?\d+\.\d+)\s*\]/i;
      const m1 = text.match(re1);
      if (m1) return { lat: parseFloat(m1[1]), lng: parseFloat(m1[2]), detail: 'text [LOCATION SHARE]' };
      const re2 = /\[Shared\s+Location:\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]/i;
      const m2 = text.match(re2);
      if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]), detail: 'text [Shared Location]' };
      try {
        const { extractGoogleMapsUrls, extractCoordinatesFromUrlString } = require('../../utils/google-maps-url-resolver');
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

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const content: string = msg.content || '';
      const payloadCoords = extractFromPayloadRaw(msg);
      const textCoords = !payloadCoords ? extractFromText(content) : null;
      let coords = payloadCoords || textCoords;
      if (!coords && content && /maps\.app\.goo\.gl|google\.[a-z.]+\/maps/i.test(content)) {
        try {
          const { extractGoogleMapsUrls, resolveLocationFromUrl } = await import('../location-resolver.service');
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
      const isBidan = isBidanSender(msg) || msg.direction === 'OUTBOUND';
      if (isBidan && msg.direction === 'OUTBOUND') {
        if (!tier1Candidate) tier1Candidate = { ...coords, msg };
      } else if (msg.direction === 'INBOUND') {
        if (!tier2Candidate) tier2Candidate = { ...coords, msg };
      } else if (isBidan && !tier1Candidate) {
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
      chosen = { lat: tier1Candidate.lat, lng: tier1Candidate.lng, source: 'bidan_shareloc', sourceLabel: '📍 Terverifikasi Bidan (Paling Valid)', detail: tier1Candidate.detail };
    } else if (pickedTier?.source === 'customer_shareloc' && tier2Candidate) {
      chosen = { lat: tier2Candidate.lat, lng: tier2Candidate.lng, source: 'customer_shareloc', sourceLabel: '🔵 Shareloc Customer', detail: tier2Candidate.detail };
    } else if (customer.lat != null && customer.lng != null) {
      const isManualStaff = customer.location_source === LocationSource.manual_staff || (customer.location_source as any) === 'manual_staff';
      chosen = {
        lat: Number(customer.lat),
        lng: Number(customer.lng),
        source: isManualStaff ? 'manual_staff' : 'db_coords',
        sourceLabel: isManualStaff ? STAFF_VERIFIED_LOCATION_LABEL : '🟡 Koordinat Tersimpan',
        detail: isManualStaff ? 'Manual Staff (Presisi Terverifikasi)' : 'DB lat/lng',
      };
    } else {
      const kel = customer.kelurahan || customer.pending_kelurahan || (customer.preferences as any)?.address || '';
      const kec = customer.kecamatan || customer.pending_kecamatan || '';
      const kota = customer.kota || customer.pending_kota || '';
      const query = [kel, kec, kota].filter(Boolean).join(', ') || (customer.preferences as any)?.full_address || '';
      if (!query) return { success: false, error: 'Tidak ada koordinat atau alamat untuk direfresh' };
      try {
        const { geocodingService } = await import('../../integrations/google-maps/geocoding');
        const geo = await geocodingService.geocodeText(query);
        if (geo.isPrecise && geo.lat != null && geo.lng != null) {
          chosen = { lat: geo.lat, lng: geo.lng, source: 'geocoding', sourceLabel: '⚪ Estimasi Wilayah', detail: `geocoding ${query}` };
        } else {
          try {
            const { getGazetteerCoordinates } = await import('../../utils/gazetteer');
            const hit = getGazetteerCoordinates(query);
            if (hit) chosen = { lat: hit.lat, lng: hit.lng, source: 'geocoding', sourceLabel: '⚪ Estimasi Wilayah', detail: `gazetteer centroid ${query}` };
          } catch {}
          if (!chosen) return { success: false, error: `Geocoding tidak presisi untuk "${query}"` };
        }
      } catch (e: any) {
        return { success: false, error: `Geocoding gagal: ${e.message}` };
      }
    }

    const { deliveryService } = await import('../delivery.service');
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
        const { geocodingService } = await import('../../integrations/google-maps/geocoding');
        const hint = {
          preferredKelurahan: customer.kelurahan,
          preferredKecamatan: customer.kecamatan,
          addressTextHint: (customer.preferences as any)?.address || (customer.preferences as any)?.full_address || '',
        };
        resolvedAdmin = await geocodingService.reverseGeocode(chosen.lat, chosen.lng, hint);
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

    const isPinSourceChosen =
      chosen.source === 'bidan_shareloc' || chosen.source === 'customer_shareloc' || chosen.source === 'url_coords';

    try {
      await prisma.customer.update({
        where: { id: customerId },
        data: {
          lat: chosen.lat,
          lng: chosen.lng,
          distance_km: delivery.distanceKm,
          ongkir: delivery.ongkir,
          is_out_of_coverage: delivery.isOutOfCoverage,
          share_location_sent: isPinSourceChosen ? true : customer.share_location_sent,
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
            ...existingPrefs,
            location_source: chosen.source,
            location_source_label: chosen.sourceLabel,
            location_refreshed_at: nowIso,
            refreshed_by: performedBy,
            source_detail: chosen.detail,
            location_history: [...history.slice(-9), newHistoryEntry],
            location_updated_at: nowIso,
            location_updated_by_staff_name: performedBy || 'Admin',
          },
        },
      });
    } catch (dbErr) {
      const mem = memoryCustomers.get(customer.phone) || memoryCustomers.get(customerId);
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
            ...existingPrefs,
            location_source: chosen.source,
            location_source_label: chosen.sourceLabel,
            location_refreshed_at: nowIso,
            refreshed_by: performedBy,
            source_detail: chosen.detail,
            location_history: [...history.slice(-9), newHistoryEntry],
            location_updated_at: nowIso,
          },
          updated_at: new Date(),
        });
        if (isPinSourceChosen) mem.share_location_sent = true;
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

    try {
      const { googleContactsService } = await import('../google-contacts.service');
      googleContactsService.syncCustomer(tenantId, customerId, { trigger: 'chat' }).catch(() => {});
    } catch {}
    try {
      const { getLiveChatHub } = await import('../live-chat-hub.service');
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

export async function getLastDeliveryFee(customerId: string, tenantId?: string): Promise<number | null> {
  try {
    const last = await prisma.reservation.findFirst({
      where: {
        customer_id: customerId,
        ...(tenantId ? { tenant_id: tenantId } : {}),
        status: { not: 'cancelled' },
        delivery_fee: { not: null },
      },
      orderBy: { created_at: 'desc' },
      select: { delivery_fee: true },
    });
    const snapshot = (last as any)?.delivery_fee;
    if (typeof snapshot === 'number' && snapshot >= 0) return snapshot;
  } catch {}
  try {
    const cust = await prisma.customer.findFirst({
      where: { id: customerId, ...(tenantId ? { tenant_id: tenantId } : {}) },
      select: {
        ongkir: true,
        preferences: true,
        lat: true,
        lng: true,
        kelurahan: true,
        kecamatan: true,
        kota: true,
      },
    });
    if (cust) {
      const prefs = (cust.preferences as any) || {};

      const estimate = prefs.distance_estimate;
      if (estimate && typeof estimate === 'object') {
        const expiresAtMs = estimate.expires_at ? Date.parse(String(estimate.expires_at)) : NaN;
        const notExpired = Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();
        const active = resolveActiveAddressFromList(parseSavedAddresses(prefs));
        const activeKey = active
          ? buildAddressKey(active)
          : buildAddressKey({
              lat: (cust as any).lat,
              lng: (cust as any).lng,
              address: prefs.address ?? prefs.full_address,
              kelurahan: (cust as any).kelurahan,
              kecamatan: (cust as any).kecamatan,
              kota: (cust as any).kota,
            });
        const sameAddress = Boolean(estimate.address_key) && estimate.address_key === activeKey;
        const estOngkir = estimate.ongkir;
        if (notExpired && sameAddress && typeof estOngkir === 'number' && !isNaN(estOngkir) && estOngkir >= 0) {
          return estOngkir;
        }
      }

      const active = resolveActiveAddressFromList(parseSavedAddresses(prefs));
      if (typeof active?.ongkir === 'number' && !isNaN(active.ongkir) && active.ongkir >= 0) {
        return active.ongkir;
      }

      const legacy = (cust as any)?.ongkir;
      if (typeof legacy === 'number' && legacy >= 0) return legacy;
    }
  } catch {}
  return null;
}
