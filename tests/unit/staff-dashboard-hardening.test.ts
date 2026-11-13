import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Guard statis untuk item dashboard yang tidak punya test runner UI:
 * S-02 (outbox PII), S-06 (consent GPS), S-08 (template/ambang), S-09 (status
 * jujur & input login), Cfg-015 (hardcode brand/tenant).
 */
const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const outbox = read('packages/admin-dashboard/src/pages/staff/useStaffFailedOutbox.ts');
const staffAuth = read('packages/admin-dashboard/src/contexts/StaffAuthContext.tsx');
const staffToday = read('packages/admin-dashboard/src/pages/staff/StaffToday.tsx');
const geoUtils = read('packages/admin-dashboard/src/utils/geoUtils.ts');
const staffReservation = read('src/services/staff-reservation.service.ts');
const quickReplies = read('src/routes/staff/quick-replies.subroute.ts');
const staffLogin = read('packages/admin-dashboard/src/pages/staff/StaffLogin.tsx');
const layout = read('packages/admin-dashboard/src/components/common/Layout.tsx');
const watermark = read('packages/admin-dashboard/src/utils/imageWatermark.ts');
const api = read('packages/admin-dashboard/src/services/api.ts');
const createReservation = read('packages/admin-dashboard/src/components/calendar/CreateReservationModal.tsx');
const brandContext = read('packages/admin-dashboard/src/contexts/BrandContext.tsx');

describe('S-02 outbox PII', () => {
  it('outbox memakai sessionStorage + TTL + tanpa gambar, dan dibersihkan saat logout', () => {
    expect(outbox).toContain('sessionStorage.setItem');
    expect(outbox).toContain('OUTBOX_TTL_MS');
    expect(outbox).toContain('image: null');
    expect(outbox).not.toContain('localStorage.setItem(FAILED_OUTBOX_KEY');
    expect(staffAuth).toContain("sessionStorage.removeItem('staff_failed_outbox_v2')");
  });
});

describe('S-06 GPS warm-up', () => {
  it('warm-up hanya berjalan setelah consent eksplisit dan cache dibersihkan saat stop', () => {
    expect(staffToday).toContain('staff_gps_warmup_consent_v1');
    expect(staffToday).toContain('hasDepartWindowTask && gpsWarmupConsent === \'granted\'');
    expect(staffToday).toContain('Izinkan aplikasi memakai lokasi di latar');
    expect(geoUtils).toMatch(/export function stopDepartGpsWarmup[\s\S]*departCache = null/);
  });
});

describe('S-08 template & ambang operasional', () => {
  it('ambang jarak memakai jangkauan tenant, bukan konstanta 45 km', () => {
    expect(staffReservation).toContain('clinicLoc.maxCoverageKm');
    expect(staffReservation).toContain('getClinicLocationAsync(tenantId)');
    expect(staffReservation).not.toContain('const MAX_ALLOWED_DISTANCE_KM = 45;');
  });

  it('quick reply staf dibaca dari DB per tenant', () => {
    expect(quickReplies).toContain('quickReply.findMany');
    expect(quickReplies).toContain('tenant_id: tenantId');
  });
});

describe('S-09 status jujur & input login', () => {
  it('kedatangan tidak mengklaim pesan terkirim bila WhatsApp gagal/ditekan', () => {
    expect(staffToday).toContain('res.data?.waResult');
    expect(staffToday).toContain('arrivalWaSuppressed');
    expect(staffToday).toContain('GAGAL dikirim');
  });

  it('input login memakai text-base (>=16px) agar iOS tidak zoom', () => {
    const matches = staffLogin.match(/text-base[^"]*focus:outline-none/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(staffLogin).not.toMatch(/text-sm[^"]*focus:outline-none/);
  });
});

describe('Cfg-015 hardcode brand/tenant', () => {
  it('Layout memakai brand tenant, bukan "KALA SPA"', () => {
    expect(layout).toContain('brandLabel');
    expect(layout).not.toContain('KALA SPA');
  });

  it('watermark tidak lagi menanam brand tertentu', () => {
    expect(watermark).toContain('brandText');
    expect(watermark).not.toContain('KALA MOMS & BABY');
  });

  it('header tenant tidak hardcode default-tenant; brand dari API; klinik dari tenant-settings', () => {
    expect(api).not.toContain("headers['x-tenant-id'] = 'default-tenant'");
    expect(brandContext).toContain('/api/admin/settings');
    expect(createReservation).toContain('/api/admin/tenant-settings');
  });
});
