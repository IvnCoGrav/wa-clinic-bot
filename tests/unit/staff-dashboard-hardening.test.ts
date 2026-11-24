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
const staffLocation = read('src/services/staff-location.service.ts');
const quickReplies = read('src/routes/staff/quick-replies.subroute.ts');
const staffLogin = read('packages/admin-dashboard/src/pages/staff/StaffLogin.tsx');
const layout = read('packages/admin-dashboard/src/components/common/Layout.tsx');
const watermark = read('packages/admin-dashboard/src/utils/imageWatermark.ts');
const api = read('packages/admin-dashboard/src/services/api.ts');
const createReservation = read('packages/admin-dashboard/src/components/calendar/CreateReservationModal.tsx');
const brandContext = read('packages/admin-dashboard/src/contexts/BrandContext.tsx');
const authContext = read('packages/admin-dashboard/src/contexts/AuthContext.tsx');
const uiFeedback = read('packages/admin-dashboard/src/components/common/UiFeedback.tsx');

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
  it('warm-up hanya berjalan bila izin lokasi browser sudah granted (tanpa banner consent)', () => {
    // Revisi 2026-11-23: banner consent in-app dihapus atas keputusan pemilik.
    // Consent tunggal = prompt native browser saat Bidan menekan "Navigasi".
    expect(staffToday).toContain('isGeolocationPermissionGranted');
    expect(staffToday).not.toContain('staff_gps_warmup_consent_v1');
    expect(staffToday).not.toContain('Izinkan aplikasi memakai lokasi di latar');
    expect(geoUtils).toContain('navigator.permissions');
    expect(geoUtils).toMatch(/export function stopDepartGpsWarmup[\s\S]*departCache = null/);
  });
});

describe('Kartu tugas & QRIS (audit UX 2026-11-23)', () => {
  const taskCard = read('packages/admin-dashboard/src/pages/staff/StaffTodayTaskCard.tsx');

  it('baris biaya hanya ikon + nominal (tanpa label "Biaya:" / "ongkir")', () => {
    expect(taskCard).not.toContain('(ongkir ');
    expect(taskCard).not.toContain('<span>Biaya:</span>');
    expect(taskCard).toContain('formatRupiah(task.pricing.totalFee)');
  });

  it('tombol bayar tidak mengulang nominal', () => {
    expect(taskCard).not.toContain('Catat Bayar (');
    expect(taskCard).toContain('<span>Bayar</span>');
  });

  it('QRIS lightbox di atas dialog (z-dialog-top) & tidak menumpuk modal pembayaran', () => {
    expect(staffToday).toContain('z-dialog-top');
    expect(staffToday).not.toContain('z-[150]');
    const start = staffToday.indexOf('const handleOpenQrisFast');
    const end = staffToday.indexOf('const handleRevokeMessage');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(staffToday.slice(start, end)).not.toContain('setPaymentModalTask');
  });

  it('pulse eskalasi memakai animasi merah, bukan opacity yang memutihkan kartu', () => {
    expect(taskCard).toContain('animate-delay-pulse');
    expect(taskCard).not.toContain('animate-pulse');
    // Ambang eskalasi mengikuti level server (tenant-aware), bukan hardcode 60 menit.
    expect(taskCard).toContain("task.delay?.level === 'critical'");
  });

  it('tidak ada aksi manual "Infokan Keterlambatan" (notifikasi dikirim otomatis)', () => {
    expect(taskCard).not.toContain('Infokan Keterlambatan!');
    expect(staffToday).not.toContain('DelayNotifyModal');
    expect(staffToday).not.toContain('handleOpenDelayNotify');
  });

  it('menampilkan batas jam berangkat preventif (Berangkat sebelum HH:MM)', () => {
    expect(taskCard).toContain('Berangkat sebelum ');
    expect(taskCard).toContain('departureDeadlineWib');
    expect(taskCard).toContain('showPreventiveDepartureHint');
    expect(taskCard).not.toContain('Notifikasi admin otomatis');
  });

  it('hanya baris filter status yang sticky di daftar tugas', () => {
    expect(staffToday).toContain('sticky top-0 z-10 bg-surface/95 backdrop-blur');
    expect(staffToday).not.toContain('p-3 bg-surface border-b border-divider dark:border-divider space-y-2.5 sticky');
  });
});

describe('S-08 template & ambang operasional', () => {
  it('ambang jarak memakai jangkauan tenant, bukan konstanta 45 km', () => {
    // Logika update lokasi staf diekstrak ke staff-location.service.ts (refactor plan v2.1)
    const locationLogic = `${staffReservation}\n${staffLocation}`;
    expect(locationLogic).toContain('clinicLoc.maxCoverageKm');
    expect(locationLogic).toContain('getClinicLocationAsync(tenantId)');
    expect(locationLogic).not.toContain('const MAX_ALLOWED_DISTANCE_KM = 45;');
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

describe('Logout portal staf — dual-context & lapisan dialog', () => {
  it('memakai satu handler kanonis, membersihkan kedua context, lalu redirect keras', () => {
    expect(staffToday).toContain('handleLogout');
    expect(staffToday).toContain('staffLogout({ server: false })');
    expect(staffToday).toContain('adminLogout({ awaitServer: true })');
    expect(staffToday).toContain("window.location.replace('/admin/login')");
    expect(staffToday).not.toContain('const logout = staff ? staffLogout : adminLogout;');
    expect(staffToday).not.toMatch(/\blogout\(\);/);
  });

  it('logout server memakai keepalive + batas waktu saat redirect keras', () => {
    expect(authContext).toContain('awaitServer');
    expect(authContext).toContain('keepalive');
    expect(staffAuth).toContain('server?: boolean');
  });

  it('dialog konfirmasi berada di lapisan z-dialog-top', () => {
    expect(uiFeedback).toContain('z-dialog-top');
    expect(uiFeedback).not.toMatch(/modal-backdrop fixed inset-0 z-dialog flex/);
  });
});
