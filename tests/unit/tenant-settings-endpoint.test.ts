import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/db/client';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import { clearScopeCache } from '../../src/services/role-scope.service';
import {
  applyTenantSettingsPatch,
  parseTenantSettingsPatch,
} from '../../src/config/tenant-settings.config';
import {
  __clearClinicLocationCacheForTest,
  getClinicLocationAsync,
} from '../../src/config/clinic-location';
import { clearOperationalHoursCache } from '../../src/config/operational-hours';
import { clearStaffNotificationConfigCache } from '../../src/config/staff-notification-config';
import { __clearBrandCacheForTest, getBrandIdentityAsync } from '../../src/config/brand';

/**
 * Cfg-011 — endpoint tulis setelan tenant.
 *
 * Yang dijaga:
 * 1. Validasi ketat: kunci tak dikenal, tipe salah, dan nilai di luar batas
 *    ditolak dengan pesan per-field (bukan diteruskan ke JSON DB).
 * 2. PATCH hanya menyentuh section yang dikirim; setelan lain (aiConfig,
 *    integrationGuards, dll.) tetap utuh.
 * 3. Cache reader dibersihkan setelah PATCH → perubahan langsung terlihat.
 * 4. Tenant mengikuti header sesi, bukan body.
 * 5. Hanya Super Admin (staf operasional ditolak 403).
 */

const adminKey = 'test_admin_key_tenant_settings_cfg011';
const app = buildApp();

function resetCaches() {
  __clearClinicLocationCacheForTest();
  clearOperationalHoursCache();
  clearStaffNotificationConfigCache();
  __clearBrandCacheForTest();
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  process.env.ADMIN_API_KEY = adminKey;
  clearScopeCache();
  resetCaches();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetCaches();
});

describe('parseTenantSettingsPatch — validasi ketat', () => {
  it('menolak body bukan objek dan body kosong', () => {
    expect(parseTenantSettingsPatch(null).ok).toBe(false);
    expect(parseTenantSettingsPatch([]).ok).toBe(false);
    const empty = parseTenantSettingsPatch({});
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors.join(' ')).toMatch(/Tidak ada setelan/);
  });

  it('menolak kunci tak dikenal di level atas & section (anti tulis JSON bebas)', () => {
    const top = parseTenantSettingsPatch({ aiConfig: { model: 'x' } });
    expect(top.ok).toBe(false);
    if (!top.ok) expect(top.errors.join(' ')).toMatch(/aiConfig: kunci tidak dikenal/);

    const nested = parseTenantSettingsPatch({ clinicLocation: { radius: 5 } });
    expect(nested.ok).toBe(false);
    if (!nested.ok) expect(nested.errors.join(' ')).toMatch(/clinicLocation.radius: kunci tidak dikenal/);
  });

  it('menolak koordinat & batas jangkauan di luar batas aman', () => {
    const res = parseTenantSettingsPatch({
      clinicLocation: { lat: -91, lng: 181, name: '   ', maxCoverageKm: 0 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const joined = res.errors.join('\n');
      expect(joined).toMatch(/clinicLocation\.lat/);
      expect(joined).toMatch(/clinicLocation\.lng/);
      expect(joined).toMatch(/clinicLocation\.name/);
      expect(joined).toMatch(/clinicLocation\.maxCoverageKm/);
    }
  });

  it('menolak jam operasional tidak bulat atau start >= end', () => {
    const res = parseTenantSettingsPatch({
      operationalHours: { startHourWib: 9.5, endHourWib: 30 },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.join(' ')).toMatch(/startHourWib harus bilangan bulat/);
      expect(res.errors.join(' ')).toMatch(/endHourWib harus bilangan bulat/);
    }

    const inverted = parseTenantSettingsPatch({
      operationalHours: { startHourWib: 18, endHourWib: 8 },
    });
    expect(inverted.ok).toBe(false);
    if (!inverted.ok) expect(inverted.errors.join(' ')).toMatch(/lebih kecil dari endHourWib/);
  });

  it('menolak telegramEnabled non-boolean dan estimateTtlDays di luar 1-365', () => {
    expect(parseTenantSettingsPatch({ staffNotification: { telegramEnabled: 'ya' } }).ok).toBe(false);
    expect(parseTenantSettingsPatch({ deliverySettings: { estimateTtlDays: 0 } }).ok).toBe(false);
    expect(parseTenantSettingsPatch({ deliverySettings: { estimateTtlDays: 366 } }).ok).toBe(false);
    expect(parseTenantSettingsPatch({ deliverySettings: { estimateTtlDays: 1.5 } }).ok).toBe(false);
    expect(parseTenantSettingsPatch({ deliverySettings: { estimateTtlDays: 30 } }).ok).toBe(true);
  });

  it('styleTone: null/kosong berarti hapus override, teks panjang ditolak', () => {
    expect(parseTenantSettingsPatch({ copilot: { styleTone: null } })).toEqual({
      ok: true,
      patch: { copilot: { styleTone: null } },
    });
    expect(parseTenantSettingsPatch({ copilot: { styleTone: '   ' } })).toEqual({
      ok: true,
      patch: { copilot: { styleTone: null } },
    });
    expect(parseTenantSettingsPatch({ copilot: { styleTone: 'x'.repeat(501) } }).ok).toBe(false);
  });

  it('logoUrl hanya http(s) atau path relatif — javascript: ditolak', () => {
    expect(parseTenantSettingsPatch({ brand: { logoUrl: 'javascript:alert(1)' } }).ok).toBe(false);
    expect(parseTenantSettingsPatch({ brand: { logoUrl: '/media/logo.png' } }).ok).toBe(true);
    expect(parseTenantSettingsPatch({ brand: { logoUrl: 'https://cdn.example.com/logo.png' } }).ok).toBe(true);
  });

  it('menerima patch valid dan men-trim teks', () => {
    const res = parseTenantSettingsPatch({
      clinicLocation: { name: '  Klinik Waru  ', maxCoverageKm: 25 },
      brand: { businessName: '  Kala Moms  ' },
      staffNotification: { telegramEnabled: true },
    });
    expect(res).toEqual({
      ok: true,
      patch: {
        clinicLocation: { name: 'Klinik Waru', maxCoverageKm: 25 },
        brand: { businessName: 'Kala Moms' },
        staffNotification: { telegramEnabled: true },
      },
    });
  });
});

describe('applyTenantSettingsPatch', () => {
  it('mempertahankan setelan lain di Tenant.settings', () => {
    const current = {
      aiConfig: { routerModel: 'gpt-x' },
      integrationGuards: { ors: { dailyLimit: 50 } },
      clinicLocation: { lat: -7.3, lng: 112.7, name: 'Lama' },
    };
    const next = applyTenantSettingsPatch(current, {
      clinicLocation: { name: 'Baru' },
    });

    expect(next.aiConfig).toEqual({ routerModel: 'gpt-x' });
    expect(next.integrationGuards).toEqual({ ors: { dailyLimit: 50 } });
    expect(next.clinicLocation).toEqual({ lat: -7.3, lng: 112.7, name: 'Baru' });
    // Objek asli tidak dimutasi.
    expect(current.clinicLocation.name).toBe('Lama');
  });

  it('styleTone null menghapus override copilot, bukan menyimpan null', () => {
    const next = applyTenantSettingsPatch(
      { copilot: { styleTone: 'santai', extra: 1 } },
      { copilot: { styleTone: null } }
    );
    expect(next.copilot).toEqual({ extra: 1 });

    const emptied = applyTenantSettingsPatch({ copilot: { styleTone: 'santai' } }, { copilot: { styleTone: null } });
    expect(emptied.copilot).toBeUndefined();
  });

  it('tidak membuat section kosong saat hanya sebagian field dikirim', () => {
    const next = applyTenantSettingsPatch({}, { staffNotification: { telegramEnabled: false } });
    expect(next).toEqual({ staffNotification: { telegramEnabled: false } });
  });
});

describe('HTTP /api/admin/tenant-settings', () => {
  function installTenantStore(initial: Record<string, any> = {}) {
    const store: Record<string, any> = { settings: { ...initial }, where: undefined };
    vi.spyOn(prisma.tenant, 'findUnique').mockImplementation((async () => ({
      settings: store.settings,
    })) as any);
    vi.spyOn(prisma.tenant, 'update').mockImplementation((async (args: any) => {
      store.settings = args?.data?.settings ?? store.settings;
      store.where = args?.where;
      return { id: args?.where?.id } as any;
    }) as any);
    return store;
  }

  it('GET mengembalikan nilai efektif (default saat belum ada override)', async () => {
    installTenantStore();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/tenant-settings',
      headers: { 'x-api-key': adminKey },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.tenantId).toBe('default-tenant');
    expect(body.data.operationalHours).toMatchObject({ startHourWib: 8, endHourWib: 17, isFlexible: true });
    expect(body.data.staffNotification).toEqual({ telegramEnabled: false });
    expect(body.data.deliverySettings.estimateTtlDays).toBe(14);
    expect(body.data.copilot.styleTone).toBeNull();
    expect(typeof body.data.brand.businessName).toBe('string');
    expect(typeof body.data.clinicLocation.lat).toBe('number');
  });

  it('PATCH menyimpan section terkirim, mempertahankan aiConfig, & cache langsung terlihat', async () => {
    const store = installTenantStore({
      aiConfig: { routerModel: 'model-tetap' },
      clinicLocation: { lat: -7.31, lng: 112.71, name: 'Nama Lama' },
    });

    // Panaskan cache reader dengan nilai lama.
    const before = await getClinicLocationAsync('default-tenant');
    expect(before.name).toBe('Nama Lama');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/tenant-settings',
      headers: { 'x-api-key': adminKey },
      payload: { clinicLocation: { name: 'Klinik Cabang Waru' } },
    });

    expect(res.statusCode).toBe(200);
    expect(store.settings.aiConfig).toEqual({ routerModel: 'model-tetap' });
    expect(store.settings.clinicLocation).toMatchObject({
      lat: -7.31,
      lng: 112.71,
      name: 'Klinik Cabang Waru',
    });

    // Tanpa invalidasi cache, reader akan tetap mengembalikan "Nama Lama".
    const after = await getClinicLocationAsync('default-tenant');
    expect(after.name).toBe('Klinik Cabang Waru');
  });

  it('PATCH invalid mengembalikan 400 dengan daftar error dan tidak menulis DB', async () => {
    const store = installTenantStore({ aiConfig: { a: 1 } });
    const updateSpy = vi.spyOn(prisma.tenant, 'update');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/tenant-settings',
      headers: { 'x-api-key': adminKey },
      payload: { operationalHours: { startHourWib: 20, endHourWib: 5 } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
    expect(res.json().errors.join(' ')).toMatch(/startHourWib/);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(store.settings).toEqual({ aiConfig: { a: 1 } });
  });

  it('PATCH mengikuti tenant dari header, bukan body', async () => {
    const store = installTenantStore({});
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/tenant-settings',
      headers: { 'x-api-key': adminKey, 'x-tenant-id': 'tenant-b' },
      payload: { brand: { businessName: 'Brand Tenant B' } },
    });

    expect(res.statusCode).toBe(200);
    expect(store.where).toEqual({ id: 'tenant-b' });
    expect(store.settings.brand).toEqual({ businessName: 'Brand Tenant B' });
  });

  it('PATCH brand membuat reader brand tenant mengembalikan nilai baru', async () => {
    installTenantStore({});
    const before = await getBrandIdentityAsync('default-tenant');
    expect(before.businessName).not.toBe('Klinik Baru Cfg011');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/tenant-settings',
      headers: { 'x-api-key': adminKey },
      payload: { brand: { businessName: 'Klinik Baru Cfg011' } },
    });
    expect(res.statusCode).toBe(200);

    const after = await getBrandIdentityAsync('default-tenant');
    expect(after.businessName).toBe('Klinik Baru Cfg011');
  });
});

describe('RBAC — hanya Super Admin', () => {
  it('tanpa autentikasi → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/tenant-settings' });
    expect(res.statusCode).toBe(401);
  });

  it('sesi staf THERAPIST ditolak 403 untuk baca maupun tulis', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
      staff: {
        id: 'staff-123',
        tenant_id: 'default-tenant',
        name: 'Bidan Siti',
        phone: '628123456789',
        role: 'THERAPIST',
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
        telegram_chat_id: null,
      },
      session: {
        id: 'sess-123',
        staff_id: 'staff-123',
        token: 'valid_staff_token',
        expires_at: new Date(Date.now() + 86_400_000),
        created_at: new Date(),
      },
    } as any);

    const headers = {
      cookie: 'staff_session=valid_staff_token',
      'x-requested-with': 'XMLHttpRequest',
    };

    const read = await app.inject({ method: 'GET', url: '/api/admin/tenant-settings', headers });
    expect(read.statusCode).toBe(403);
    expect(read.json().code).toBe('FORBIDDEN_STAFF_ROLE');

    const write = await app.inject({
      method: 'PATCH',
      url: '/api/admin/tenant-settings',
      headers,
      payload: { brand: { businessName: 'Nope' } },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json().code).toBe('FORBIDDEN_STAFF_ROLE');
  });

  it('sesi staf SUPER_ADMIN diizinkan membaca', async () => {
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
      staff: {
        id: 'staff-super',
        tenant_id: 'default-tenant',
        name: 'Super Admin',
        phone: '628111111111',
        role: 'SUPER_ADMIN',
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
        telegram_chat_id: null,
      },
      session: {
        id: 'sess-super',
        staff_id: 'staff-super',
        token: 'super_staff_token',
        expires_at: new Date(Date.now() + 86_400_000),
        created_at: new Date(),
      },
    } as any);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/tenant-settings',
      headers: {
        cookie: 'staff_session=super_staff_token',
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });
});
