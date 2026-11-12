import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../../src/db/client';
import {
  GoogleCalendarService,
  buildCalendarEventId,
  resolveEventDurationMinutes,
  DEFAULT_EVENT_DURATION_MINUTES,
} from '../../src/services/google-calendar.service';
import {
  getGoogleCalendarConfig,
  parseGoogleCalendarConfig,
  clearGoogleCalendarConfigCache,
} from '../../src/config/google-calendar.config';
import { __clearBrandCacheForTest } from '../../src/config/brand';

/**
 * I-006 — sinkronisasi Google Calendar.
 *
 * Kontrak yang dijaga:
 * 1. Kalender tujuan PER TENANT (bukan satu kalender global env).
 * 2. Idempoten: ID event deterministik dari reservation.id; retry tidak
 *    membuat event ganda; 409 dari Google berarti "sudah ada" = sukses.
 * 3. Durasi memakai `duration_minutes` reservasi, bukan asumsi 60 menit.
 * 4. Brand judul/deskripsi mengikuti tenant.
 * 5. Tenant yang dimatikan (`enabled:false`) tidak menyentuh kalender.
 */

type SettingsMap = Record<string, any>;

function mockTenantSettings(map: SettingsMap) {
  vi.spyOn(prisma.tenant, 'findUnique').mockImplementation((async (args: any) => {
    const id = args?.where?.id;
    return { settings: map[id] ?? {} } as any;
  }) as any);
}

function fakeClient(overrides: Record<string, any> = {}) {
  return {
    events: {
      insert: vi.fn(async () => ({ data: { id: 'event-123' } })),
      get: vi.fn(async () => ({ data: { id: 'existing-event' } })),
      update: vi.fn(async () => ({ data: {} })),
      delete: vi.fn(async () => ({ data: {} })),
      ...overrides,
    },
  };
}

const reservationBase = {
  id: 'cm3reservation0001',
  tenant_id: 'tenant-a',
  booking_date: new Date('2026-11-20T02:00:00.000Z'),
  treatment_detail: 'Pijat Bayi',
  duration_minutes: 90,
};

beforeEach(() => {
  vi.restoreAllMocks();
  clearGoogleCalendarConfigCache();
  __clearBrandCacheForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearGoogleCalendarConfigCache();
  __clearBrandCacheForTest();
});

describe('parseGoogleCalendarConfig', () => {
  it('default: aktif + kalender fallback env saat tanpa konfigurasi', () => {
    expect(parseGoogleCalendarConfig(null, 'primary')).toEqual({ enabled: true, calendarId: 'primary' });
    expect(parseGoogleCalendarConfig(undefined, 'kalender-env')).toEqual({
      enabled: true,
      calendarId: 'kalender-env',
    });
  });

  it('menerima calendarId & enabled yang sah, menolak nilai aneh', () => {
    expect(parseGoogleCalendarConfig({ enabled: false, calendarId: '  tim@group.calendar.google.com ' }, 'primary')).toEqual({
      enabled: false,
      calendarId: 'tim@group.calendar.google.com',
    });
    expect(parseGoogleCalendarConfig({ calendarId: '' }, 'primary').calendarId).toBe('primary');
    expect(parseGoogleCalendarConfig({ calendarId: 'a\nb' }, 'primary').calendarId).toBe('primary');
    expect(parseGoogleCalendarConfig({ calendarId: 'x'.repeat(321) }, 'primary').calendarId).toBe('primary');
    expect(parseGoogleCalendarConfig({ enabled: 'ya' }, 'primary').enabled).toBe(true);
  });
});

describe('getGoogleCalendarConfig (tenant-aware)', () => {
  it('membaca kalender per tenant dari Tenant.settings.googleCalendar', async () => {
    mockTenantSettings({
      'tenant-a': { googleCalendar: { calendarId: 'cal-tenant-a' } },
      'tenant-b': { googleCalendar: { calendarId: 'cal-tenant-b', enabled: false } },
    });

    await expect(getGoogleCalendarConfig('tenant-a', 'primary')).resolves.toEqual({
      enabled: true,
      calendarId: 'cal-tenant-a',
    });
    await expect(getGoogleCalendarConfig('tenant-b', 'primary')).resolves.toEqual({
      enabled: false,
      calendarId: 'cal-tenant-b',
    });
  });

  it('DB offline → fallback env, sinkronisasi tetap aktif', async () => {
    // tests/setup.ts: semua query Prisma reject "Database offline".
    await expect(getGoogleCalendarConfig('tenant-offline', 'kalender-env')).resolves.toEqual({
      enabled: true,
      calendarId: 'kalender-env',
    });
  });

  it('cache per tenant mencegah query berulang; clear memaksa baca ulang', async () => {
    const spy = vi.spyOn(prisma.tenant, 'findUnique').mockResolvedValue({ settings: {} } as any);
    await getGoogleCalendarConfig('tenant-cache', 'primary');
    await getGoogleCalendarConfig('tenant-cache', 'primary');
    expect(spy).toHaveBeenCalledTimes(1);

    clearGoogleCalendarConfigCache('tenant-cache');
    await getGoogleCalendarConfig('tenant-cache', 'primary');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('durasi event', () => {
  it('memakai duration_minutes reservasi', () => {
    expect(resolveEventDurationMinutes({ ...reservationBase, duration_minutes: 90 })).toBe(90);
  });

  it('nilai tidak sah → default 60 menit', () => {
    for (const value of [null, undefined, 0, -30, 5, 5000, NaN]) {
      expect(
        resolveEventDurationMinutes({ ...reservationBase, duration_minutes: value as any })
      ).toBe(DEFAULT_EVENT_DURATION_MINUTES);
    }
  });
});

describe('buildCalendarEventId (idempotensi)', () => {
  it('deterministik dan hanya memakai charset base32hex [a-v0-9]', () => {
    const a = buildCalendarEventId('cm3reservation0001');
    const b = buildCalendarEventId('cm3reservation0001');
    expect(a).toBe(b);
    expect(a).toMatch(/^resv[a-v0-9]+$/);
    expect(buildCalendarEventId('cm3reservation0002')).not.toBe(a);
    expect(buildCalendarEventId('')).toBeNull();
    expect(buildCalendarEventId(undefined)).toBeNull();
  });
});

describe('GoogleCalendarService.createEvent', () => {
  it('mode mock: ID deterministik, bukan timestamp acak', async () => {
    mockTenantSettings({ 'tenant-a': {} });
    const service = new GoogleCalendarService({ calendarClient: null, isConfigured: false });

    const first = await service.createEvent(reservationBase, 'Bunda A', 'tenant-a');
    const second = await service.createEvent(reservationBase, 'Bunda A', 'tenant-a');

    expect(first).toBe(second);
    expect(first).toContain(buildCalendarEventId(reservationBase.id)!);
  });

  it('memakai kalender tenant, durasi 90 menit, dan brand tenant', async () => {
    mockTenantSettings({
      'tenant-a': {
        googleCalendar: { calendarId: 'cal-tenant-a' },
        brand: { businessName: 'Klinik Sehat A' },
      },
    });
    const client = fakeClient();
    const service = new GoogleCalendarService({ calendarClient: client, isConfigured: true });

    const id = await service.createEvent(reservationBase, 'Bunda A', 'tenant-a');
    expect(id).toBe('event-123');

    const call = client.events.insert.mock.calls[0][0];
    expect(call.calendarId).toBe('cal-tenant-a');
    expect(call.requestBody.id).toBe(buildCalendarEventId(reservationBase.id));
    expect(call.requestBody.summary).toContain('Klinik Sehat A');
    expect(call.requestBody.description).toContain('Klinik Sehat A');
    expect(call.requestBody.start.dateTime).toBe('2026-11-20T02:00:00.000Z');
    expect(call.requestBody.end.dateTime).toBe('2026-11-20T03:30:00.000Z');
  });

  it('retry dengan reservasi sama memakai ID event yang sama (tidak membuat event ganda)', async () => {
    mockTenantSettings({ 'tenant-a': {} });
    const client = fakeClient();
    const service = new GoogleCalendarService({ calendarClient: client, isConfigured: true });

    await service.createEvent(reservationBase, 'Bunda A', 'tenant-a');
    await service.createEvent(reservationBase, 'Bunda A', 'tenant-a');

    expect(client.events.insert).toHaveBeenCalledTimes(2);
    const [first, second] = client.events.insert.mock.calls.map((c: any) => c[0].requestBody.id);
    expect(first).toBe(second);
  });

  it('409 duplicate dari Google = sukses idempoten (ambil event lama, tanpa event baru)', async () => {
    mockTenantSettings({ 'tenant-a': {} });
    const client = fakeClient({
      insert: vi.fn(async () => {
        throw Object.assign(new Error('The requested identifier already exists.'), { code: 409 });
      }),
    });
    const service = new GoogleCalendarService({ calendarClient: client, isConfigured: true });

    const id = await service.createEvent(reservationBase, 'Bunda A', 'tenant-a');

    expect(id).toBe('existing-event');
    expect(client.events.insert).toHaveBeenCalledTimes(1);
    expect(client.events.get).toHaveBeenCalledWith({
      calendarId: 'primary',
      eventId: buildCalendarEventId(reservationBase.id),
    });
  });

  it('tenant dimatikan → tidak menyentuh kalender sama sekali', async () => {
    mockTenantSettings({ 'tenant-mati': { googleCalendar: { enabled: false, calendarId: 'cal-x' } } });
    const client = fakeClient();
    const service = new GoogleCalendarService({ calendarClient: client, isConfigured: true });

    const id = await service.createEvent({ ...reservationBase, tenant_id: 'tenant-mati' }, 'Bunda', 'tenant-mati');

    expect(id).toBe('');
    expect(client.events.insert).not.toHaveBeenCalled();
  });

  it('tanggal tidak sah → error jelas, bukan event tanggal 1970', async () => {
    mockTenantSettings({ 'tenant-a': {} });
    const service = new GoogleCalendarService({ calendarClient: fakeClient(), isConfigured: true });

    await expect(
      service.createEvent({ ...reservationBase, booking_date: 'bukan-tanggal' }, 'Bunda', 'tenant-a')
    ).rejects.toThrow(/invalid/i);
  });
});

describe('GoogleCalendarService.updateEvent & deleteEvent', () => {
  it('update memakai kalender tenant + durasi reservasi', async () => {
    mockTenantSettings({ 'tenant-b': { googleCalendar: { calendarId: 'cal-tenant-b' } } });
    const client = fakeClient();
    const service = new GoogleCalendarService({ calendarClient: client, isConfigured: true });

    await service.updateEvent('event-9', { ...reservationBase, tenant_id: 'tenant-b' }, 'Bunda B', 'tenant-b');

    const call = client.events.update.mock.calls[0][0];
    expect(call.calendarId).toBe('cal-tenant-b');
    expect(call.eventId).toBe('event-9');
    expect(call.requestBody.start.dateTime).toBe('2026-11-20T02:00:00.000Z');
    expect(call.requestBody.end.dateTime).toBe('2026-11-20T03:30:00.000Z');
  });

  it('delete memakai kalender tenant yang benar', async () => {
    mockTenantSettings({ 'tenant-b': { googleCalendar: { calendarId: 'cal-tenant-b' } } });
    const client = fakeClient();
    const service = new GoogleCalendarService({ calendarClient: client, isConfigured: true });

    await service.deleteEvent('event-9', 'tenant-b');

    expect(client.events.delete).toHaveBeenCalledWith({
      calendarId: 'cal-tenant-b',
      eventId: 'event-9',
    });
  });

  it('tenant dimatikan → update/delete no-op', async () => {
    mockTenantSettings({ 'tenant-mati': { googleCalendar: { enabled: false } } });
    const client = fakeClient();
    const service = new GoogleCalendarService({ calendarClient: client, isConfigured: true });

    await service.updateEvent('event-9', reservationBase, 'Bunda', 'tenant-mati');
    await service.deleteEvent('event-9', 'tenant-mati');

    expect(client.events.update).not.toHaveBeenCalled();
    expect(client.events.delete).not.toHaveBeenCalled();
  });
});
