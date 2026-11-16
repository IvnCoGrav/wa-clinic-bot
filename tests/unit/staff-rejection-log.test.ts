import { describe, it, expect, beforeEach, vi } from 'vitest';
import { logStaffRejection } from '../../src/utils/staff-rejection-log';
import { buildApp } from '../../src/app';
import { StaffAuthService } from '../../src/services/staff-auth.service';

describe('Staff Rejection Observability Tests (F5)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('memformat console.warn terstruktur dengan prefix [STAFF REJECTION]', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logStaffRejection({
      endpoint: 'POST /api/staff/reservations/:id/payment',
      staffId: 'staff-thabita',
      staffName: 'Bidan Thabita',
      tenantId: 'default-tenant',
      targetId: 'res-123',
      reason: 'Nominal tidak sesuai tagihan',
      payload: { expected: 120000, received: 100000 },
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[STAFF REJECTION] endpoint=POST /api/staff/reservations/:id/payment staffId=staff-thabita staffName=Bidan Thabita tenantId=default-tenant targetId=res-123 reason="Nominal tidak sesuai tagihan"')
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('payload={"expected":120000,"received":100000}')
    );
  });

  it('menggunakan fallback default saat field opsional kosong', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logStaffRejection({
      endpoint: 'POST /api/staff/update-location',
      reason: 'reservationId wajib disertakan.',
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[STAFF REJECTION] endpoint=POST /api/staff/update-location staffId=anonymous staffName=unknown tenantId=default targetId=- reason="reservationId wajib disertakan."')
    );
  });

  it('penolakan HTTP 400 di rute staf memicu logStaffRejection', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = buildApp();

    vi.spyOn(StaffAuthService, 'validateSession').mockResolvedValue({
      id: 'sess-1',
      token_hash: 'hash',
      staff_id: 'staff-thabita',
      expires_at: new Date(Date.now() + 3600000),
      revoked_at: null,
      staff: {
        id: 'staff-thabita',
        name: 'Bidan Thabita',
        phone: '083172360876',
        password_hash: 'hash',
        role: 'THERAPIST' as any,
        active: true,
        tenant_id: 'default-tenant',
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/staff/reservations/res-xyz/payment',
      headers: { cookie: 'staff_session=valid-token' },
      payload: {}, // Kosong -> paymentMethod missing
    });

    expect(res.statusCode).toBe(400);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[STAFF REJECTION] endpoint=POST /api/staff/reservations/:id/payment staffId=staff-thabita staffName=Bidan Thabita')
    );
  });
});
