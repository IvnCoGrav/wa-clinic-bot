import { describe, it, expect } from 'vitest';
import { liveChatService } from '../../src/services/live-chat.service';
import {
  isEnRouteStatus,
  isConfirmedFamilyStatus,
  normalizeReservationStatus,
} from '../../packages/admin-dashboard/src/utils/reservationStatus';

/**
 * Regresi insiden radar OTW (Bunda Karina):
 * Reservasi berstatus `en_route` (dipicu tombol OTW Bidan) DULU tersingkir dari
 * ringkasan Live Chat karena `live-chat.service.ts` membandingkan literal
 * `status === 'confirmed'`. Akibatnya `activeConfirmedReservation` = null →
 * `dispatchReservationId` = null → widget Radar OTW & peta CS hilang total.
 *
 * Test ini mengunci kontrak domain `CONFIRMED_FAMILY_STATUSES = ['confirmed','en_route']`
 * dan helper dashboard agar tidak regresi ke literal tunggal.
 */

const serialize = (c: any) => (liveChatService as any).serialize(c);

function conv(reservations: any[], overrides: any = {}) {
  return {
    id: 'conv-karina',
    customer_id: 'cust-karina',
    current_state: 'INITIAL',
    updated_at: new Date('2026-10-03T08:00:00+07:00'),
    messages: [],
    customer: {
      id: 'cust-karina',
      name: 'Bunda Karina',
      phone: '6283831464608',
      preferences: { address: 'Jl. Melati 10' },
      children: [],
      reservations,
      ...(overrides.customer || {}),
    },
    ...overrides,
  };
}

const EN_ROUTE_RES = {
  id: '12e2f62b-280a-4789-9f92-8059e1eb1780',
  status: 'en_route',
  booking_date: new Date('2026-10-03T09:00:00+07:00'),
  treatment_category: 'BABY',
  treatment_detail: 'Kala Baby – Pijat Ceria',
  otw_sent_at: new Date('2026-10-03T08:40:00+07:00'),
  arrived_at: null,
};

describe('LiveChat: reservasi en_route tetap terhitung sebagai jadwal aktif', () => {
  it('en_route → hasUpcomingBooking true + activeConfirmedReservation terisi status asli', () => {
    const out: any = serialize(conv([EN_ROUTE_RES]));
    expect(out.hasUpcomingBooking).toBe(true);
    expect(out.activeConfirmedReservation).toBeTruthy();
    expect(out.activeConfirmedReservation.id).toBe(EN_ROUTE_RES.id);
    expect(out.activeConfirmedReservation.status).toBe('en_route');
  });

  it('OTW tanpa GPS (otw_sent_at ada, arrived_at null) tetap membawa otw_sent_at untuk dispatch', () => {
    const out: any = serialize(conv([EN_ROUTE_RES]));
    const r = out.activeConfirmedReservation;
    expect(r).toBeTruthy();
    expect(r.otw_sent_at).toBe(EN_ROUTE_RES.otw_sent_at.toISOString());
    expect(r.arrived_at).toBeNull();
  });

  it('confirmed (backward-compat) tetap dianggap jadwal aktif', () => {
    const out: any = serialize(conv([{ ...EN_ROUTE_RES, id: 'res-conf', status: 'confirmed', otw_sent_at: null }]));
    expect(out.hasUpcomingBooking).toBe(true);
    expect(out.activeConfirmedReservation.status).toBe('confirmed');
  });

  it('memilih reservasi en_route meski ada reservasi completed lebih dulu', () => {
    const out: any = serialize(
      conv([
        { ...EN_ROUTE_RES, id: 'res-done', status: 'completed', arrived_at: new Date() },
        EN_ROUTE_RES,
      ])
    );
    expect(out.activeConfirmedReservation.id).toBe(EN_ROUTE_RES.id);
  });
});

describe('LiveChat: status non-jadwal tidak memicu radar/banner', () => {
  it.each(['completed', 'cancelled', 'rejected'])('status %s → hasUpcomingBooking false & activeConfirmed null', (status) => {
    const out: any = serialize(conv([{ ...EN_ROUTE_RES, status }]));
    expect(out.hasUpcomingBooking).toBe(false);
    expect(out.activeConfirmedReservation).toBeNull();
  });

  it('pending → hasPendingBooking true tapi bukan upcoming booking', () => {
    const out: any = serialize(conv([{ ...EN_ROUTE_RES, id: 'res-pending', status: 'pending', otw_sent_at: null }]));
    expect(out.hasPendingBooking).toBe(true);
    expect(out.hasUpcomingBooking).toBe(false);
    expect(out.activeConfirmedReservation).toBeNull();
    expect(out.activePendingReservation.id).toBe('res-pending');
  });

  it('hold masih aktif → hasActiveHold true', () => {
    const out: any = serialize(conv([{ id: 'h-1', status: 'hold', booking_date: new Date(Date.now() + 3600_000) }]));
    expect(out.hasActiveHold).toBe(true);
  });

  it('hold kedaluwarsa (>2 jam) → hasActiveHold false', () => {
    const out: any = serialize(conv([{ id: 'h-old', status: 'hold', booking_date: new Date(Date.now() - 3 * 3600_000) }]));
    expect(out.hasActiveHold).toBe(false);
  });
});

describe('LiveChat: adversarial resilience (data kotor / kosong)', () => {
  it('tanpa reservasi → semua flag false, tidak crash', () => {
    const out: any = serialize(conv([]));
    expect(out.hasUpcomingBooking).toBe(false);
    expect(out.activeConfirmedReservation).toBeNull();
    expect(out.activeHoldReservation).toBeNull();
    expect(out.activePendingReservation).toBeNull();
  });

  it('status null/undefined tidak crash dan tidak dihitung aktif', () => {
    const out: any = serialize(conv([{ id: 'r-null', status: null, booking_date: null }, { id: 'r-undef' }]));
    expect(out.hasUpcomingBooking).toBe(false);
    expect(out.activeConfirmedReservation).toBeNull();
  });

  it('harus tetap case-sensitive pada nilai DB kanonik lowercase (status uppercase tidak bocor)', () => {
    // DB menyimpan lowercase; kontrak domain case-sensitive by design.
    const out: any = serialize(conv([{ ...EN_ROUTE_RES, status: 'EN_ROUTE' }]));
    expect(out.hasUpcomingBooking).toBe(false);
  });
});

describe('Dashboard helper reservationStatus (anti-drift literal otw vs en_route)', () => {
  it('isEnRouteStatus mengenali en_route + alias + case-insensitive + spasi', () => {
    for (const s of ['en_route', 'EN_ROUTE', ' on_the_way ', 'otw']) {
      expect(isEnRouteStatus(s)).toBe(true);
    }
  });

  it('isEnRouteStatus menolak confirmed/completed/null/undefined/string kosong', () => {
    for (const s of ['confirmed', 'completed', 'pending', 'hold', '', null, undefined]) {
      expect(isEnRouteStatus(s)).toBe(false);
    }
  });

  it('isConfirmedFamilyStatus mencakup confirmed + en_route saja', () => {
    expect(isConfirmedFamilyStatus('confirmed')).toBe(true);
    expect(isConfirmedFamilyStatus('en_route')).toBe(true);
    expect(isConfirmedFamilyStatus('pending')).toBe(false);
    expect(isConfirmedFamilyStatus(null)).toBe(false);
  });

  it('normalizeReservationStatus aman untuk nilai null/undefined', () => {
    expect(normalizeReservationStatus(null)).toBe('');
    expect(normalizeReservationStatus(undefined)).toBe('');
    expect(normalizeReservationStatus(' En_Route ')).toBe('en_route');
  });
});
