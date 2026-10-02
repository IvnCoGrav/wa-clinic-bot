import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { FastifyInstance } from 'fastify';
import { StaffAuthService } from '../../src/services/staff-auth.service';
import { prisma } from '../../src/db/client';
import { queueService } from '../../src/services/queue.service';
import { liveChatService } from '../../src/services/live-chat.service';
import { StaffReservationService } from '../../src/services/staff-reservation.service';
import { staffTripTrackingService } from '../../src/services/staff-trip-tracking.service';

const ADMIN_KEY = 'test_admin_key_otw_depart';
const TENANT = 'default-tenant';
const STAFF_ID = 'staff-otw-1';
const RES_ID = 'res-otw-1';

/**
 * Plan 2026-09-30 (kontrol keberangkatan) — POST /api/staff/reservations/:id/otw
 * dengan payload keberangkatan: pesan diperkaya ETA/lokasi + status → en_route.
 * Adversarial: guard otorisasi, status terminal, dan kompatibilitas mundur.
 */
describe('POST /otw — kontrol keberangkatan (en_route + ETA)', () => {
  let app: FastifyInstance;

  const staffSession = {
    id: 'session-otw-1',
    staff_id: STAFF_ID,
    token_hash: 'hash',
    created_at: new Date(),
    expires_at: new Date(Date.now() + 3600000),
    revoked_at: null,
    staff: {
      id: STAFF_ID,
      name: 'Bidan Dewi',
      phone: '08123456789',
      password_hash: 'hash',
      role: 'THERAPIST' as any,
      active: true,
      tenant_id: TENANT,
      created_at: new Date(),
      updated_at: new Date(),
    },
  };

  const reservationRow = {
    id: RES_ID,
    tenant_id: TENANT,
    status: 'confirmed',
    assigned_staff_id: STAFF_ID,
    otw_sent_at: null,
    arrived_at: null,
    booking_date: new Date(Date.now() + 30 * 60 * 1000), // 30 mnt lagi (dalam jendela)
    customer: {
      id: 'cust-otw',
      name: 'Bunda Rina',
      lat: -7.28,
      lng: 112.74,
      conversations: [{ id: 'conv-otw', tenant_id: TENANT }],
    },
    assigned_staff: { name: 'Bidan Dewi' },
  };

  beforeAll(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    process.env.HUMANIZER_ENABLED = 'false';
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await queueService.close();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    staffTripTrackingService.clearAll();
    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue(staffSession as any);
    vi.spyOn(liveChatService, 'sendAdminReply').mockResolvedValue({ success: true } as any);
    vi.mocked(prisma.reservation.update).mockResolvedValue({ id: RES_ID, status: 'en_route' } as any);
  });

  const staffHeaders = { cookie: 'staff_session=valid_token' };

  it('markEnRoute + ETA → update status en_route & otw_sent_at dalam satu update', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce(reservationRow as any);
    const res = await app.inject({
      method: 'POST',
      url: `/api/staff/reservations/${RES_ID}/otw`,
      headers: staffHeaders,
      payload: { customText: '', markEnRoute: true, etaMinutes: 12, arrivalWib: '09:42', lat: -7.3, lng: 112.7 },
    });
    expect(res.statusCode).toBe(200);
    const updateArg = vi.mocked(prisma.reservation.update).mock.calls.at(-1)![0] as any;
    expect(updateArg.data.status).toBe('en_route');
    expect(updateArg.data.otw_sent_at).toBeInstanceOf(Date);
    const body = JSON.parse(res.body);
    expect(body.data.status).toBe('en_route');
  });

  it('TANPA markEnRoute → perilaku lama (hanya otw_sent_at, status tak diubah)', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce(reservationRow as any);
    const res = await app.inject({
      method: 'POST',
      url: `/api/staff/reservations/${RES_ID}/otw`,
      headers: staffHeaders,
      payload: { customText: '' },
    });
    expect(res.statusCode).toBe(200);
    const updateArg = vi.mocked(prisma.reservation.update).mock.calls.at(-1)![0] as any;
    expect(updateArg.data.status).toBeUndefined();
    expect(updateArg.data.otw_sent_at).toBeInstanceOf(Date);
  });

  it('status terminal (completed) → 400, DILARANG update', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      ...reservationRow,
      status: 'completed',
    } as any);
    const res = await app.inject({
      method: 'POST',
      url: `/api/staff/reservations/${RES_ID}/otw`,
      headers: staffHeaders,
      payload: { customText: '', markEnRoute: true },
    });
    expect(res.statusCode).toBe(400);
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it('terapis bukan pemilik jadwal → 403 (anti-IDOR)', async () => {
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce({
      ...reservationRow,
      assigned_staff_id: 'staff-lain',
    } as any);
    const res = await app.inject({
      method: 'POST',
      url: `/api/staff/reservations/${RES_ID}/otw`,
      headers: staffHeaders,
      payload: { customText: '', markEnRoute: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('tanpa sesi → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/staff/reservations/${RES_ID}/otw`,
      payload: { customText: '', markEnRoute: true },
    });
    expect(res.statusCode).toBe(401);
  });

  it('FASE 1: OTW dengan koordinat → trip memory CS terisi (bukan blind spot)', async () => {
    staffTripTrackingService.clearAll();
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce(reservationRow as any);
    const res = await app.inject({
      method: 'POST',
      url: `/api/staff/reservations/${RES_ID}/otw`,
      headers: staffHeaders,
      payload: { customText: '', markEnRoute: true, etaMinutes: 12, arrivalWib: '09:42', lat: -7.3, lng: 112.7 },
    });
    expect(res.statusCode).toBe(200);
    const trip = staffTripTrackingService.getTrip(TENANT, RES_ID);
    expect(trip).not.toBeNull();
    expect(trip?.lat).toBe(-7.3);
    expect(trip?.lng).toBe(112.7);
  });

  it('FASE 1: OTW tanpa koordinat → trip memory tetap kosong (kompatibel mundur)', async () => {
    staffTripTrackingService.clearAll();
    vi.mocked(prisma.reservation.findUnique).mockResolvedValueOnce(reservationRow as any);
    const res = await app.inject({
      method: 'POST',
      url: `/api/staff/reservations/${RES_ID}/otw`,
      headers: staffHeaders,
      payload: { customText: '' },
    });
    expect(res.statusCode).toBe(200);
    expect(staffTripTrackingService.getTrip(TENANT, RES_ID)).toBeNull();
  });
});

describe('getOtwMessageText — pesan OTW bersih (tanpa estimasi ke customer) & anti Default Clinic', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('default template OTW → pesan bersih dan hangat "Saya sudah...", tanda tangan rapi', async () => {
    vi.mocked(prisma.followUpTemplate.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ name: 'Kala Moms and Baby Spa' } as any);
    const text = await StaffReservationService.getOtwMessageText(TENANT, {
      patientName: 'Rina',
      therapistName: 'Dewi',
    });
    expect(text).toContain('Halo Bunda Rina 😊');
    expect(text).toContain('Saya sudah dalam perjalanan menuju rumah Bunda untuk treatmentnya yaa 🚗💨');
    expect(text).toContain('Mohon ditunggu, Bun. Sampai bertemu sebentar lagi 🤍');
    expect(text).toContain('~ Dewi');
    expect(text).not.toContain('Estimasi tiba');
    expect(text).not.toContain('Titik berangkat');
  });

  it('dengan ETA + lokasi dari GPS → pesan customer TETAP BERSIH tanpa blok estimasi/lokasi otomatis', async () => {
    vi.mocked(prisma.followUpTemplate.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ name: 'Kala Moms and Baby Spa' } as any);
    const text = await StaffReservationService.getOtwMessageText(TENANT, {
      patientName: 'vivin',
      therapistName: 'Bidan Thabita',
      etaMinutes: 6,
      arrivalWib: '10:43',
      departMapsUrl: 'https://maps.google.com/?q=-7.2608,112.7523',
    });
    // Pesan customer tidak memberikan harapan palsu estimasi atau landmark acak
    expect(text).toContain('Halo Bunda vivin 😊');
    expect(text).toContain('Saya sudah dalam perjalanan menuju rumah Bunda untuk treatmentnya yaa 🚗💨');
    expect(text).toContain('Mohon ditunggu, Bun. Sampai bertemu sebentar lagi 🤍');
    expect(text).not.toContain('Estimasi tiba');
    expect(text).not.toContain('Titik berangkat');
    expect(text).not.toContain('Grand City');
    // Tanda tangan tetap di baris paling bawah.
    const lines = text.split('\n').filter((l) => l.trim());
    expect(lines[lines.length - 1]).toBe('~ Bidan Thabita');
  });

  it('anti-dummy: nama Default Clinic otomatis disanitasi menjadi Kala Moms and Baby Spa', async () => {
    vi.mocked(prisma.followUpTemplate.findUnique).mockResolvedValue({
      text: 'Halo Bunda {patientName}, saya {therapistName} dari {clinicName} sudah OTW ya 🙏',
    } as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ name: 'Default Clinic' } as any);
    const text = await StaffReservationService.getOtwMessageText(TENANT, {
      patientName: 'Rina',
      therapistName: 'Bidan Ayu',
    });
    expect(text).not.toContain('Default Clinic');
    expect(text).toContain('Kala Moms and Baby Spa');
  });

  it('template admin dengan placeholder {etaMinutes} eksplisit → disubstitusi tanpa duplikasi', async () => {
    vi.mocked(prisma.followUpTemplate.findUnique).mockResolvedValue({
      text: 'Halo {patientName}, saya OTW. ETA {etaMinutes} menit ({arrivalWib}).',
    } as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ name: 'Kala Moms and Baby Spa' } as any);
    const text = await StaffReservationService.getOtwMessageText(TENANT, {
      patientName: 'Rina',
      therapistName: 'Dewi',
      etaMinutes: 12,
      arrivalWib: '09:42',
    });
    expect(text).toContain('ETA 12 menit (09:42)');
    expect(text).not.toContain('Titik berangkat Bidan:');
  });

  it('ADVERSARIAL privasi: template kustom ber-placeholder {departMapsUrl} tidak bocor bila dari rumah', async () => {
    vi.mocked(prisma.followUpTemplate.findUnique).mockResolvedValue({
      text: 'Halo {patientName}, saya OTW. Lokasi: {departMapsUrl}',
    } as any);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ name: 'Kala Moms and Baby Spa' } as any);
    const text = await StaffReservationService.getOtwMessageText(TENANT, {
      patientName: 'Rina',
      therapistName: 'Dewi',
      departMapsUrl: 'https://maps.google.com/?q=-7.2,112.6',
      departLat: -7.2,
      departLng: 112.6,
    });
    expect(text).not.toContain('-7.2,112.6');
    expect(text).toContain('Lokasi:');
  });
});
