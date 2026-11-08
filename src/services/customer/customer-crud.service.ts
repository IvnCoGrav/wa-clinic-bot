import { prisma } from '../../db/client';
import { LocationSource } from '@prisma/client';
import { DEFAULT_TENANT_ID } from '../../config/tenant';
import { isDummyOrTestContact } from '../../utils/dummy-filter';
import { hasBypassLabel } from '../../utils/customer-bypass';
import { sanitizeKelurahanInput } from '../../utils/kelurahan-guard';
import { sanitizeCustomerNameForStorage, isValidChildName, isGenericCustomerName } from '../../utils/name-sanitizer';
import { normalizeHonorificPrefix } from '../../utils/customer-name-healing';
import {
  memoryCustomers,
  isTestRuntime,
  toNumberOrNull,
  isPreciseGps,
  CustomerNameSource,
  NAME_SOURCE_RANK,
  CustomerGroundTruth,
} from './shared';
import {
  syncSavedAddressFromLocation,
  syncActiveReservationsAfterLocationChange,
} from './customer-address.service';

export function getMemoryCustomers(): Map<string, any> {
  return memoryCustomers;
}

export function clearCustomerMemory(phone: string): void {
  memoryCustomers.delete(phone);
}

export async function setChatLabelFlag(
  phone: string,
  flag: 'is_admin_labeled' | 'is_hold_labeled',
  value: boolean
): Promise<void> {
  const raw = phone.replace(/\D/g, '');
  const clean = raw.startsWith('62') ? raw.slice(2) : raw.startsWith('0') ? raw.slice(1) : raw;
  const formats = [`62${clean}`, `0${clean}`, clean];

  try {
    await prisma.customer.updateMany({
      where: {
        phone: { in: formats },
      },
      data: {
        [flag]: value,
        labels_synced_at: new Date(),
      },
    });
  } catch (e) {
    if (!isTestRuntime()) {
      console.error('[CustomerService] setChatLabelFlag DB failed (fail-fast, no memory fallback in prod):', (e as Error)?.message);
      throw e;
    }
    for (const fmt of formats) {
      if (memoryCustomers.has(fmt)) {
        const cust = memoryCustomers.get(fmt);
        cust[flag] = value;
        cust.labels_synced_at = new Date();
      }
    }
  }
}

export async function markInternalStaffCustomer(
  phone: string,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<void> {
  try {
    const { normalizePhoneToE164 } = await import('../capi.service');
    const target = normalizePhoneToE164(phone);
    if (!target) return;
    const repo = (await import('../../repositories/customer.repository')).getCustomerRepository();
    const candidates: any[] = [];
    try {
      const byNorm = await prisma.customer.findMany({
        where: { tenant_id: tenantId },
        select: { id: true, phone: true, is_internal_staff: true },
      });
      if (Array.isArray(byNorm)) candidates.push(...byNorm);
    } catch {}
    for (const c of candidates) {
      if (normalizePhoneToE164(c?.phone || '') !== target) continue;
      if (c.is_internal_staff) continue;
      await repo.update(c.id, { is_internal_staff: true } as any);
    }
  } catch (err: any) {
    console.warn('[CustomerService] markInternalStaffCustomer error:', err?.message);
  }
}

export async function setLabelFlags(
  phone: string,
  flags: { isAdminLabeled?: boolean; isHoldLabeled?: boolean },
  tenantId: string
): Promise<void> {
  const data: any = { labels_synced_at: new Date() };
  if (flags.isAdminLabeled !== undefined) data.is_admin_labeled = flags.isAdminLabeled;
  if (flags.isHoldLabeled !== undefined) data.is_hold_labeled = flags.isHoldLabeled;

  const repo = (await import('../../repositories/customer.repository')).getCustomerRepository();
  await repo.updateManyByPhoneTenant(phone, tenantId, data);
  const cust = memoryCustomers.get(phone);
  if (cust) {
    if (flags.isAdminLabeled !== undefined) cust.is_admin_labeled = flags.isAdminLabeled;
    if (flags.isHoldLabeled !== undefined) cust.is_hold_labeled = flags.isHoldLabeled;
    cust.labels_synced_at = new Date();
  }

  if (flags.isAdminLabeled === true) {
    try {
      const repo2 = (await import('../../repositories/customer.repository')).getCustomerRepository();
      const rec = await repo2.findByPhone(phone, tenantId);
      if (rec?.id) {
        const { followUpService } = await import('../follow-up.service');
        await followUpService.skipFollowUpsForBypassCustomer(rec.id, tenantId);
      }
    } catch {}
  }
}

export async function getOrCreateCustomer(
  phone: string,
  name: string | undefined,
  tenantId: string,
  options?: { skipFollowUpScheduling?: boolean }
): Promise<any> {
  const repo = (await import('../../repositories/customer.repository')).getCustomerRepository();
  const isSandbox = isDummyOrTestContact(phone, name);
  const safeName = sanitizeCustomerNameForStorage(name);

  let customer = await repo.findByPhone(phone, tenantId);
  let isNewlyCreated = false;

  if (customer && (customer as any).deleted_at) {
    try {
      customer = await repo.update(customer.id, { deleted_at: null, status: 'active' } as any);
    } catch {}
  }

  if (!customer) {
    const rawPushName = typeof name === 'string' && name.trim() ? name.trim() : null;
    const isPushnameGeneric = !safeName || isGenericCustomerName(safeName, { strictPushnameGate: true });
    const initialName = isPushnameGeneric ? null : safeName;
    const initialSource = initialName ? 'pushname' : null;

    try {
      customer = await repo.create({
        tenant_id: tenantId,
        phone,
        name: initialName,
        name_source: initialSource,
        whatsapp_push_name: rawPushName,
        is_sandbox_test: isSandbox,
      });
      isNewlyCreated = true;
    } catch (createErr: any) {
      const code = createErr?.code || createErr?.cause?.code;
      if (code === 'P2002') {
        customer = await repo.findByPhone(phone, tenantId);
        if (!customer) throw createErr;
      } else {
        throw createErr;
      }
    }

    if (isNewlyCreated && customer && !options?.skipFollowUpScheduling && !isSandbox && !customer.is_admin_labeled && !hasBypassLabel(customer)) {
      try {
        const { followUpService } = await import('../follow-up.service');
        await followUpService.createNoPurchaseFollowUps(customer.id, tenantId);
      } catch (err) {
        console.error('[Customer Service] Failed to trigger follow-up creation:', err);
      }
    }
  } else if (!customer.is_sandbox_test && isSandbox) {
    try {
      customer = await repo.update(customer.id, { is_sandbox_test: true });
    } catch (_) {}
  }

  memoryCustomers.set(phone, customer);
  if (customer?.id) memoryCustomers.set(customer.id, customer);
  return customer;
}

export async function getCustomerById(customerId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<any> {
  const repo = (await import('../../repositories/customer.repository')).getCustomerRepository();
  try {
    const customer = await repo.findById(customerId, tenantId);
    if (customer) return customer;
  } catch (error) {
    console.warn('[Customer Service] getCustomerById DB error (fail-closed, cek cache baca):', (error as Error)?.message);
  }
  const memCust = memoryCustomers.get(customerId);
  if (memCust) {
    if (tenantId && memCust.tenant_id && memCust.tenant_id !== tenantId) return null;
    return memCust;
  }
  for (const [, cust] of memoryCustomers.entries()) {
    if (cust && cust.id === customerId && (!tenantId || cust.tenant_id === tenantId)) return cust;
  }
  return null;
}

export async function getCustomerByPhone(phone: string, tenantId: string): Promise<any> {
  const repo = (await import('../../repositories/customer.repository')).getCustomerRepository();
  try {
    const customer = await repo.findByPhone(phone, tenantId);
    return customer || memoryCustomers.get(phone) || null;
  } catch (error) {
    console.warn('[Customer Service] getCustomerByPhone DB error (fail-closed, cek cache baca):', (error as Error)?.message);
    return memoryCustomers.get(phone) || null;
  }
}

export async function updateCustomerName(
  customerId: string,
  name: string,
  tenantId: string,
  options?: { force?: boolean; source?: CustomerNameSource }
): Promise<any> {
  const source: CustomerNameSource = options?.force ? 'admin' : (options?.source ?? 'sync');
  const current = await getCustomerById(customerId, tenantId);

  const isAuthoritative = source === 'reservation' || source === 'admin';
  const safeName = sanitizeCustomerNameForStorage(name);
  const candidate = (safeName || '').trim();
  if (!candidate) return current;
  if (!isAuthoritative && isGenericCustomerName(candidate, { strictPushnameGate: true })) {
    return current;
  }

  const stored = (current?.name || '').trim();
  const storedRank = NAME_SOURCE_RANK[(current as any)?.name_source ?? 'unknown'] ?? 0;
  const incomingRank = NAME_SOURCE_RANK[source] ?? 0;
  const sameIdentity = stored.toLowerCase() === candidate.toLowerCase();
  const storedIsPlaceholder = !stored || isGenericCustomerName(stored);

  const allowed =
    source === 'admin' ||
    storedIsPlaceholder ||
    incomingRank > storedRank ||
    (incomingRank === storedRank && sameIdentity);

  if (!allowed) {
    console.log(
      `[CUSTOMER NAME SHIELD] tolak '${candidate}' (src=${source}) atas '${stored}' (src=${(current as any)?.name_source ?? 'unknown'}) customer=${customerId}`
    );
    return current;
  }

  const finalName = normalizeHonorificPrefix(candidate);

  try {
    const repo = (await import('../../repositories/customer.repository')).getCustomerRepository();
    const updated = await repo.update(customerId, {
      name: finalName,
      name_source: source,
    });
    for (const [, cust] of memoryCustomers.entries()) {
      if (cust && cust.id === customerId && cust.tenant_id === tenantId) {
        cust.name = finalName;
        cust.name_source = source;
      }
    }
    return updated;
  } catch (error) {
    for (const [, cust] of memoryCustomers.entries()) {
      if (cust && cust.id === customerId && cust.tenant_id === tenantId) {
        cust.name = finalName;
        cust.name_source = source;
        return cust;
      }
    }
    throw error;
  }
}

export async function mergeCustomerPreferences(
  customerId: string,
  tenantId: string,
  patch: Record<string, unknown>
): Promise<void> {
  const clean = Object.fromEntries(
    Object.entries(patch || {}).filter(([, value]) => value !== undefined)
  );
  if (Object.keys(clean).length === 0) return;

  const rawExec = (prisma as any).$executeRawUnsafe;
  if (typeof rawExec === 'function') {
    try {
      const affected = await rawExec.call(
        prisma,
        `UPDATE customers
            SET preferences = COALESCE(preferences, '{}'::jsonb) || $2::jsonb,
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $3`,
        customerId,
        JSON.stringify(clean),
        tenantId
      );
      if (typeof affected === 'number' && affected === 0) {
        throw new Error('CUSTOMER_PREFERENCES_UPDATE_NO_ROWS');
      }
      return;
    } catch (error) {
      if (!isTestRuntime()) {
        console.warn(
          '[CustomerService] mergeCustomerPreferences atomic merge gagal, fallback read-merge-write:',
          (error as Error)?.message
        );
      }
    }
  }

  const customer = await getCustomerById(customerId, tenantId);
  if (!customer) return;
  const repo = (await import('../../repositories/customer.repository')).getCustomerRepository();
  await repo.update(customerId, {
    preferences: { ...((customer.preferences as any) || {}), ...clean },
  } as any);
}

export async function updateCustomer(
  customerId: string,
  data: {
    name?: string;
    phone?: string;
    address?: string;
    kelurahan?: string | null;
    kecamatan?: string | null;
    kota?: string | null;
    zipcode?: string | null;
    landmark?: string | null;
    lat?: number | null;
    lng?: number | null;
    forceUpdateGps?: boolean;
    children?: Array<{
      id?: string;
      name: string;
      ageText?: string;
      raw_age_text?: string;
      birthDate?: string | null;
    }>;
  },
  tenantId: string
): Promise<any> {
  const needsPriorState =
    (data.lat != null && data.lng != null) ||
    data.kecamatan !== undefined ||
    data.kelurahan !== undefined ||
    data.kota !== undefined ||
    data.address !== undefined ||
    data.landmark !== undefined;
  const priorCustomer: any = needsPriorState
    ? await getCustomerById(customerId, tenantId)
    : null;
  const priorLat = toNumberOrNull(priorCustomer?.lat);
  const priorLng = toNumberOrNull(priorCustomer?.lng);
  const priorKelurahan = priorCustomer?.kelurahan ?? null;
  const priorKecamatan = priorCustomer?.kecamatan ?? null;
  const priorKota = priorCustomer?.kota ?? null;
  const priorIsPrecise = isPreciseGps(priorCustomer);
  const coordsProvided = data.lat != null && data.lng != null;
  const coordsChanged =
    coordsProvided &&
    (toNumberOrNull(data.lat) !== priorLat ||
      toNumberOrNull(data.lng) !== priorLng);

  const updateData: any = {};
  let redirectedAddressFromKelurahan: string | undefined;
  if (data.kelurahan !== undefined) {
    const safeKel = data.kelurahan === null ? null : sanitizeKelurahanInput(data.kelurahan);
    if (data.kelurahan !== null && safeKel === undefined) {
      redirectedAddressFromKelurahan = String(data.kelurahan).trim();
    } else {
      updateData.kelurahan = safeKel;
    }
  }
  if (data.kecamatan !== undefined) updateData.kecamatan = data.kecamatan;
  if (data.kota !== undefined) updateData.kota = data.kota;
  if (data.zipcode !== undefined) updateData.zipcode = data.zipcode;
  if (data.lat !== undefined) updateData.lat = toNumberOrNull(data.lat);
  if (data.lng !== undefined) updateData.lng = toNumberOrNull(data.lng);
  if (coordsProvided) {
    const preciseLockedLocal =
      !!priorCustomer && priorIsPrecise && !coordsChanged && !data.forceUpdateGps;
    if (!preciseLockedLocal) {
      updateData.location_source = LocationSource.manual_staff;
    }
  }

  if (data.phone !== undefined && data.phone.trim()) {
    let normalizedPhone = data.phone.replace(/\D/g, '');
    if (normalizedPhone.startsWith('0')) normalizedPhone = '62' + normalizedPhone.substring(1);
    updateData.phone = normalizedPhone;
  }

  const effectiveAddress = data.address !== undefined ? data.address : redirectedAddressFromKelurahan;
  if (effectiveAddress !== undefined || data.landmark !== undefined) {
    const currentPrefs = (priorCustomer?.preferences as any) || {};
    const newPrefs: any = { ...currentPrefs };
    if (effectiveAddress !== undefined) {
      newPrefs.address = effectiveAddress;
      newPrefs.full_address = effectiveAddress;
    }
    if (data.landmark !== undefined) {
      newPrefs.landmark = data.landmark;
      newPrefs.address_notes = data.landmark;
    }
    newPrefs.location_updated_at = new Date().toISOString();
    newPrefs.location_updated_by_staff_name = 'Admin CS';
    updateData.preferences = newPrefs;
  }

  try {
    const updated = await prisma.customer.update({
      where: { id: customerId },
      data: updateData,
      include: { children: true },
    });

    for (const [, cust] of memoryCustomers.entries()) {
      if (cust && cust.id === customerId && cust.tenant_id === tenantId) {
        Object.assign(cust, updateData);
      }
    }

    if (Array.isArray(data.children)) {
      const existingChildren = await prisma.child.findMany({
        where: { customer_id: customerId },
      });

      const incomingValidChildren = data.children.filter((c) => c.name && c.name.trim() && isValidChildName(c.name));
      const processedChildIds = new Set<string>();

      for (const childItem of incomingValidChildren) {
        const childName = childItem.name.trim();
        const nameNorm = childName.toLowerCase();
        const ageText = childItem.raw_age_text || childItem.ageText || null;
        const birthDate = childItem.birthDate ? new Date(childItem.birthDate) : null;

        const matchedExisting = childItem.id
          ? existingChildren.find((ec) => ec.id === childItem.id)
          : existingChildren.find((ec) => (ec.name_norm || ec.name.toLowerCase()) === nameNorm);

        if (matchedExisting) {
          processedChildIds.add(matchedExisting.id);
          await prisma.child.update({
            where: { id: matchedExisting.id },
            data: {
              name: childName,
              name_norm: nameNorm,
              raw_age_text: ageText,
              birth_date: birthDate,
            },
          });
        } else {
          const createdChild = await prisma.child.create({
            data: {
              tenant_id: tenantId,
              customer_id: customerId,
              name: childName,
              name_norm: nameNorm,
              raw_age_text: ageText,
              birth_date: birthDate,
            },
          });
          processedChildIds.add(createdChild.id);
        }
      }

      for (const ec of existingChildren) {
        if (!processedChildIds.has(ec.id)) {
          await prisma.child.delete({ where: { id: ec.id } }).catch(() => {});
        }
      }
    }

    import('../google-contacts.service')
      .then(({ googleContactsService }) => {
        googleContactsService.syncCustomer(tenantId, customerId, { trigger: 'chat' }).catch(() => {});
      })
      .catch(() => {});

    if (data.name !== undefined) {
      await updateCustomerName(customerId, data.name, tenantId, { source: 'admin', force: true }).catch(() => {});
    }
    const finalCustomer = await getCustomerById(customerId, tenantId);

    const explicitCoords = coordsProvided && (coordsChanged || !!data.forceUpdateGps);
    const preciseLocked =
      !!priorCustomer && priorIsPrecise && !coordsChanged && !data.forceUpdateGps;

    const norm = (v?: string | null) => (v || '').trim().toLowerCase();
    const newKecamatan = data.kecamatan !== undefined ? data.kecamatan : priorKecamatan;
    const kecamatanDrift =
      !!priorCustomer && norm(newKecamatan) !== norm(priorKecamatan);
    const hasCoords = coordsProvided ? true : (priorLat != null && priorLng != null);
    const needsGeocode = !explicitCoords && (!hasCoords || kecamatanDrift);
    const shouldRunRecalc =
      !!priorCustomer && !preciseLocked && (explicitCoords || needsGeocode);

    if (shouldRunRecalc) {
      try {
        let recalcLat: number | null = priorLat;
        let recalcLng: number | null = priorLng;
        let geocoded = false;

        if (explicitCoords) {
          recalcLat = data.lat as number;
          recalcLng = data.lng as number;
        } else {
          const kel = data.kelurahan !== undefined ? data.kelurahan : priorKelurahan;
          const kec = data.kecamatan !== undefined ? data.kecamatan : priorKecamatan;
          const kot = data.kota !== undefined ? data.kota : priorKota;
          const query = [kel, kec, kot].filter(Boolean).join(', ');
          if (query) {
            const { geocodingService } = await import('../../integrations/google-maps/geocoding');
            const geo = await geocodingService.geocodeText(query);
            if (geo.isPrecise && geo.lat != null && geo.lng != null) {
              recalcLat = geo.lat;
              recalcLng = geo.lng;
              geocoded = true;
            }
          }
        }

        if ((explicitCoords || geocoded) && recalcLat != null && recalcLng != null) {
          const { deliveryService } = await import('../delivery.service');
          const delivery = await deliveryService.calculateDelivery(
            { lat: recalcLat, lng: recalcLng },
            undefined,
            tenantId
          );
          const recalcPatch = {
            lat: recalcLat,
            lng: recalcLng,
            distance_km: delivery.distanceKm,
            ongkir: delivery.ongkir,
            is_out_of_coverage: delivery.isOutOfCoverage,
            location_source: LocationSource.manual_staff,
          };
          await prisma.customer.update({
            where: { id: customerId },
            data: recalcPatch,
          }).catch((e) => {
            console.error(
              '[CUSTOMER UPDATE] Gagal menulis hasil recalc jarak (data bisa basi):',
              customerId,
              (e as Error)?.message
            );
          });
          for (const [, cust] of memoryCustomers.entries()) {
            if (cust && cust.id === customerId && cust.tenant_id === tenantId) {
              Object.assign(cust, recalcPatch);
            }
          }
          console.log(`[CUSTOMER UPDATE] Auto-recalculated distance for ${customerId}: ${delivery.distanceKm} km, ongkir: ${delivery.ongkir}`);
        }
      } catch (err: any) {
        console.error('[CUSTOMER UPDATE] Auto-recalculate distance failed:', customerId, err?.message);
      }
    }

    const touchedLocation =
      data.kelurahan !== undefined || data.kecamatan !== undefined ||
      data.kota !== undefined || data.lat !== undefined || data.lng !== undefined;
    const currentCustomer = (await getCustomerById(customerId, tenantId)) || finalCustomer;
    if (touchedLocation && currentCustomer) {
      try {
        await syncSavedAddressFromLocation(currentCustomer, tenantId, {
          address: (data.address !== undefined ? data.address : (currentCustomer.preferences as any)?.address) || '',
          kelurahan: data.kelurahan !== undefined ? data.kelurahan : currentCustomer.kelurahan,
          kecamatan: data.kecamatan !== undefined ? data.kecamatan : currentCustomer.kecamatan,
          kota: data.kota !== undefined ? data.kota : currentCustomer.kota,
          lat: data.lat !== undefined ? toNumberOrNull(data.lat) : currentCustomer.lat,
          lng: data.lng !== undefined ? toNumberOrNull(data.lng) : currentCustomer.lng,
          distanceKm: currentCustomer.distance_km,
          ongkir: currentCustomer.ongkir,
          locationSource: currentCustomer.location_source,
        } as any, getCustomerById);
      } catch (syncErr) {
        console.warn('[CustomerService] updateCustomer saved-address sync failed (best-effort):', (syncErr as Error)?.message);
      }
      await syncActiveReservationsAfterLocationChange(customerId, tenantId);
    }

    return currentCustomer || updated;
  } catch (error) {
    try {
      const repo = (await import('../../repositories/customer.repository')).getCustomerRepository();
      await repo.update(customerId, updateData);
    } catch (_) {}

    for (const [phone, cust] of memoryCustomers.entries()) {
      if (cust.id === customerId && cust.tenant_id === tenantId) {
        Object.assign(cust, updateData);
        if (data.address !== undefined || data.landmark !== undefined) {
          cust.preferences = {
            ...(cust.preferences as any),
            ...(data.address !== undefined ? { address: data.address, full_address: data.address } : {}),
            ...(data.landmark !== undefined ? { landmark: data.landmark, address_notes: data.landmark } : {}),
            location_updated_at: new Date().toISOString(),
            location_updated_by_staff_name: 'Admin CS',
          };
        }
        if (Array.isArray(data.children)) {
          cust.children = data.children.map((c, idx) => ({
            id: c.id || `mock-child-${idx + 1}`,
            customer_id: customerId,
            tenant_id: tenantId,
            name: c.name,
            raw_age_text: c.raw_age_text || c.ageText || null,
            birth_date: c.birthDate || null,
            created_at: new Date(),
            updated_at: new Date(),
          }));
        }
        if (data.name !== undefined) {
          await updateCustomerName(customerId, data.name, tenantId, { source: 'admin', force: true }).catch(() => {});
        }
        return cust;
      }
    }
    return null;
  }
}

export async function blockCustomer(customerId: string, reason: string, tenantId: string): Promise<any> {
  try {
    return await prisma.customer.update({
      where: { id: customerId },
      data: {
        status: 'blocked',
        block_reason: reason,
        blocked_at: new Date(),
      },
    });
  } catch (error) {
    for (const [phone, cust] of memoryCustomers.entries()) {
      if (cust.id === customerId && cust.tenant_id === tenantId) {
        cust.status = 'blocked';
        cust.block_reason = reason;
        cust.blocked_at = new Date();
        return cust;
      }
    }
    throw new Error(`Customer ${customerId} not found for tenant ${tenantId}`);
  }
}

export async function unblockCustomer(customerId: string, tenantId: string): Promise<any> {
  try {
    return await prisma.customer.update({
      where: { id: customerId },
      data: {
        status: 'active',
        block_reason: null,
        blocked_at: null,
      },
    });
  } catch (error) {
    for (const [phone, cust] of memoryCustomers.entries()) {
      if (cust.id === customerId && cust.tenant_id === tenantId) {
        cust.status = 'active';
        cust.block_reason = null;
        cust.blocked_at = null;
        return cust;
      }
    }
    throw new Error(`Customer ${customerId} not found for tenant ${tenantId}`);
  }
}

export async function setAiOverride(customerId: string, tenantId: string, aiOverride: 'FORCE_ON' | 'FORCE_OFF' | null): Promise<any> {
  try {
    return await prisma.customer.update({
      where: { id: customerId },
      data: { ai_override: aiOverride },
    });
  } catch (error) {
    for (const [phone, cust] of memoryCustomers.entries()) {
      if (cust.id === customerId && cust.tenant_id === tenantId) {
        cust.ai_override = aiOverride;
        return cust;
      }
    }
    throw new Error(`Customer ${customerId} not found for tenant ${tenantId}`);
  }
}

export async function getCustomerGroundTruth(
  customerId: string,
  tenantId: string
): Promise<CustomerGroundTruth | null> {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        reservations: {
          where: { tenant_id: tenantId },
          orderBy: { created_at: 'desc' },
        },
      },
    });

    if (!customer) return null;

    const activeServices: string[] = [];
    const historicalServicesSet = new Set<string>();
    const now = new Date();

    for (const res of customer.reservations) {
      const serviceName = res.treatment_detail || res.treatment_category;
      if (!serviceName) continue;

      const st = (res.status || '').toLowerCase();
      if (st === 'cancelled') continue;

      const isFutureOrNullDate = !res.booking_date || new Date(res.booking_date) >= now;
      if (st === 'pending' || (st === 'confirmed' && isFutureOrNullDate)) {
        activeServices.push(serviceName);
      } else if (st === 'confirmed' && res.booking_date && new Date(res.booking_date) < now) {
        historicalServicesSet.add(serviceName);
      }
    }

    return {
      name: customer.name || null,
      activeServices,
      historicalServices: Array.from(historicalServicesSet),
      preferences: (customer.preferences as Record<string, any> | null) ?? undefined,
    };
  } catch (err: any) {
    console.warn('[Customer Service] getCustomerGroundTruth failed:', err?.message || err);
    return null;
  }
}

export async function syncProfilePictureInBackground(
  customerId: string,
  phone: string,
  tenantId: string,
  force = false
): Promise<void> {
  if (!phone) return;
  setImmediate(async () => {
    try {
      let shouldFetch = force;
      if (!force) {
        try {
          const customer = await prisma.customer.findUnique({
            where: { id: customerId },
            select: { profile_picture_updated_at: true, profile_picture_url: true },
          });
          if (!customer?.profile_picture_updated_at) {
            shouldFetch = true;
          } else {
            const ageMs = Date.now() - new Date(customer.profile_picture_updated_at).getTime();
            const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
            if (ageMs > THREE_DAYS_MS) {
              shouldFetch = true;
            }
          }
        } catch {
          const mem = memoryCustomers.get(phone);
          if (!mem?.profile_picture_updated_at) {
            shouldFetch = true;
          }
        }
      }

      if (shouldFetch) {
        const { resolveGatewayForTenant } = await import('../../integrations/whatsapp/factory');
        const gateway = await resolveGatewayForTenant(tenantId);
        if (gateway && typeof gateway.getProfilePicture === 'function') {
          const picUrl = await gateway.getProfilePicture(phone);
          await updateProfilePicture(customerId, phone, picUrl);
        }
      }
    } catch {}
  });
}

export async function updateProfilePicture(
  customerId: string,
  phone: string,
  profilePictureUrl: string | null
): Promise<void> {
  const now = new Date();
  try {
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        profile_picture_url: profilePictureUrl || null,
        profile_picture_updated_at: now,
      },
    });
  } catch {}
  const mem = memoryCustomers.get(phone);
  if (mem) {
    mem.profile_picture_url = profilePictureUrl || null;
    mem.profile_picture_updated_at = now;
  }
}
