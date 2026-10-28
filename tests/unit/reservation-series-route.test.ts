import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';
import { FastifyInstance } from 'fastify';

const ADMIN_KEY = 'test_admin_key_series_route';
const HEADERS = {
  'x-api-key': ADMIN_KEY,
  'x-tenant-id': DEFAULT_TENANT_ID,
  'content-type': 'application/json',
};

describe('Admin Reservation Series Route Tests [P3.2]', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('menolak dengan 400 jika totalSessions < 2', async () => {
    app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation-series',
      headers: HEADERS,
      payload: {
        customerId: 'cust-123',
        treatmentName: 'Paket Terapi',
        totalSessions: 1, // Kurang dari 2
        sessions: [{ sessionNumber: 1, bookingDate: '2026-11-01T02:00:00.000Z' }],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error).toContain('totalSessions (min 2)');
  });

  it('menolak dengan 400 jika totalSessions bukan integer valid (string acak atau floating point)', async () => {
    app = buildApp();
    await app.ready();

    // Floating point
    const resFloat = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation-series',
      headers: HEADERS,
      payload: {
        customerId: 'cust-123',
        treatmentName: 'Paket Terapi',
        totalSessions: 2.5,
        sessions: [{ sessionNumber: 1, bookingDate: '2026-11-01T02:00:00.000Z' }],
      },
    });
    expect(resFloat.statusCode).toBe(400);

    // String non-numeric
    const resString = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation-series',
      headers: HEADERS,
      payload: {
        customerId: 'cust-123',
        treatmentName: 'Paket Terapi',
        totalSessions: 'dua_sesi',
        sessions: [{ sessionNumber: 1, bookingDate: '2026-11-01T02:00:00.000Z' }],
      },
    });
    expect(resString.statusCode).toBe(400);
  });

  it('menolak dengan 400 jika array sessions kosong', async () => {
    app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/reservation-series',
      headers: HEADERS,
      payload: {
        customerId: 'cust-123',
        treatmentName: 'Paket Terapi',
        totalSessions: 3,
        sessions: [], // Kosong
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(false);
    expect(body.error).toContain('sessions wajib diisi');
  });
});
