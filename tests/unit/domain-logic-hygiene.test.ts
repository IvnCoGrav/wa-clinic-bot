import { describe, it, expect } from 'vitest';
import {
  isActiveReservation,
  activeReservationWhere,
  ACTIVE_RESERVATION_STATUSES,
} from '../../src/domain/reservation-status';
import {
  SavedCustomerAddressSchema,
  pruneAddressTombstones,
  type AddressTombstone,
} from '../../src/domain/customer-address';
import { resolveLocationAdequacy } from '../../src/domain/location-adequacy';
import { hasFreshSharelocToday, type VisitMessageLike } from '../../src/domain/dispatch-visit-context';
import { pickHealingWinner, type HealingCard } from '../../src/domain/address-healing';
import { buildReconciliationPlan } from '../../src/domain/address-reconciliation';
import { getPaymentDisplayStatus } from '../../src/domain/reservation-payment';
import { calculateRetention, type CohortCustomer } from '../../src/domain/staff-retention';

describe('Domain Logic Hygiene Tests (F4.2B: DOM-01..DOM-15)', () => {
  describe('DOM-11 & DOM-12: reservation-status', () => {
    it('isActiveReservation mendukung status case-insensitive (CONFIRMED / En_Route)', () => {
      const now = Date.now();
      expect(isActiveReservation({ status: 'CONFIRMED', booking_date: new Date(now) }, now)).toBe(true);
      expect(isActiveReservation({ status: 'En_Route', booking_date: new Date(now) }, now)).toBe(true);
      expect(isActiveReservation({ status: 'PENDING', booking_date: null }, now)).toBe(true);
      expect(isActiveReservation({ status: 'CANCELLED', booking_date: new Date(now) }, now)).toBe(false);
    });

    it('activeReservationWhere menurunkan status dari ACTIVE_RESERVATION_STATUSES', () => {
      const where = activeReservationWhere();
      const inClause = where.OR[0].status.in;
      expect(inClause).toEqual(ACTIVE_RESERVATION_STATUSES.filter((s) => s !== 'hold'));
    });
  });

  describe('DOM-09 & DOM-10: customer-address schema & tombstones', () => {
    it('SavedCustomerAddressSchema memparse kartu legacy tanpa createdAt / lastUsedAt', () => {
      const legacyCard = {
        id: 'addr-1',
        label: 'Rumah',
        address: 'Jl. Rungkut Asri No. 10',
      };
      const parsed = SavedCustomerAddressSchema.safeParse(legacyCard);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.createdAt).toBeDefined();
        expect(parsed.data.lastUsedAt).toBeDefined();
        expect(parsed.data.isPrimary).toBe(false);
      }
    });

    it('pruneAddressTombstones mengurutkan berdasarkan tanggal hapus sebelum memotong', () => {
      const tombstones: AddressTombstone[] = [
        { id: 't3', deletedAt: '2026-11-03T10:00:00Z', label: 'T3', reason: 'user_deleted' },
        { id: 't1', deletedAt: '2026-11-01T10:00:00Z', label: 'T1', reason: 'user_deleted' },
        { id: 't2', deletedAt: '2026-11-02T10:00:00Z', label: 'T2', reason: 'user_deleted' },
      ];
      const pruned = pruneAddressTombstones(tombstones, '2026-11-04T00:00:00Z', 90);
      expect(pruned.length).toBe(3);
      // Diurutkan dari lama ke baru
      expect(pruned.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    });
  });

  describe('DOM-05: location-adequacy staff verification check', () => {
    it('staffVerified tanpa koordinat verifikasi dan tanpa foto ditolak', () => {
      const res = resolveLocationAdequacy({
        rawAddress: 'Jl. Sedati No. 5',
        lat: -7.38,
        lng: 112.75,
        primaryAddressSource: 'manual_staff',
        staffVerified: true,
        staffVerifiedCoords: null,
        housePhotoUrl: null,
      });
      expect(res.source).not.toBe('manual_staff');
    });

    it('staffVerified dengan koordinat verifikasi yang cocok diterima', () => {
      const res = resolveLocationAdequacy({
        rawAddress: 'Jl. Sedati No. 5',
        lat: -7.38,
        lng: 112.75,
        primaryAddressSource: 'manual_staff',
        staffVerified: true,
        staffVerifiedCoords: { lat: -7.38005, lng: 112.75005 },
        housePhotoUrl: null,
      });
      expect(res.source).toBe('manual_staff');
      expect(res.isAdequate).toBe(true);
    });
  });

  describe('DOM-06: dispatch-visit-context inbound shareloc filter', () => {
    it('mengabaikan pesan outbound staf/bot yang memuat tag lokasi', () => {
      const today = new Date('2026-11-10T10:00:00Z');
      const dayStart = new Date('2026-11-10T00:00:00Z');
      const dayEnd = new Date('2026-11-10T23:59:59Z');

      const outboundMsg: VisitMessageLike = {
        direction: 'OUTBOUND',
        sender_type: 'bot',
        content: '[LOCATION: Lat -7.33, Lng 112.78]',
        created_at: today,
      };

      expect(hasFreshSharelocToday([outboundMsg], dayStart, dayEnd)).toBe(false);

      const inboundMsg: VisitMessageLike = {
        direction: 'INBOUND',
        sender_type: 'customer',
        content: '[LOCATION: Lat -7.33, Lng 112.78]',
        created_at: today,
      };

      expect(hasFreshSharelocToday([inboundMsg], dayStart, dayEnd)).toBe(true);
    });
  });

  describe('DOM-08 & DOM-15: address-healing winner coordinate enrichment & tie-break', () => {
    it('mempertahankan koordinat GPS dari gpsCard ke winner yang memiliki teks', () => {
      const gpsCard: HealingCard = {
        id: 'gps-1',
        address: '',
        lat: -7.3456,
        lng: 112.7890,
        distanceKm: 5.2,
        ongkir: 25000,
        location_source: 'gps_pin',
      };

      const olderCards: HealingCard[] = [
        {
          id: 'text-old',
          address: 'Jl. Rungkut Asri No. 1',
          lat: null,
          lng: null,
          last_used_at: '2026-10-01T00:00:00Z',
        },
        {
          id: 'text-newer',
          address: 'Jl. Rungkut Asri Timur No. 12',
          lat: null,
          lng: null,
          last_used_at: '2026-11-01T00:00:00Z',
        },
      ];

      const winnerResult = pickHealingWinner(gpsCard, olderCards);
      expect(winnerResult).not.toBeNull();
      // Winner harus kartu dengan teks terbaru (DOM-15 tie-break)
      expect(winnerResult?.winner.id).toBe('text-newer');
      // Winner harus diperkaya dengan koordinat GPS dari gpsCard (DOM-08)
      expect(winnerResult?.winner.lat).toBe(-7.3456);
      expect(winnerResult?.winner.lng).toBe(112.7890);
      expect(winnerResult?.winner.location_source).toBe('gps_pin');
      expect(winnerResult?.victim.id).toBe('gps-1');
    });
  });

  describe('DOM-07: address-reconciliation semantic match', () => {
    it('tidak menduplikasi baris tabel jika sudah cocok secara semantik dengan kartu JSON', () => {
      const jsonList = [
        {
          id: 'json-1',
          label: 'Rumah',
          address: 'Jl. Waru No. 10',
          kecamatan: 'Waru',
          kota: 'Sidoarjo',
          isPrimary: true,
          createdAt: '2026-11-01T00:00:00Z',
          lastUsedAt: '2026-11-01T00:00:00Z',
        },
      ];

      const tableRows = [
        {
          id: 'table-different-id',
          label: 'Rumah',
          address: 'Jl. Waru No. 10',
          kecamatan: 'Waru',
          kota: 'Sidoarjo',
          is_primary: false,
          created_at: '2026-11-02T00:00:00Z',
          last_used_at: '2026-11-02T00:00:00Z',
        },
      ];

      const plan = buildReconciliationPlan(jsonList, tableRows, new Set());
      // table-different-id tidak boleh diadopsi menjadi entri baru
      expect(plan.nextJson.length).toBe(1);
      expect(plan.adoptedIds.length).toBe(0);
    });
  });

  describe('DOM-13: reservation-payment display status', () => {
    it('mengenali status COMPLETED dan PAID case-insensitive', () => {
      expect(getPaymentDisplayStatus({ status: 'COMPLETED' })).toBe('SELESAI_BELUM_VERIFIKASI');
      expect(getPaymentDisplayStatus({ payment_status: 'PAID' })).toBe('LUNAS');
      expect(getPaymentDisplayStatus({ payment_status: 'lunas' })).toBe('LUNAS');
      expect(getPaymentDisplayStatus({ status: 'confirmed' })).toBe('TAGIH_DI_TEMPAT');
    });
  });

  describe('DOM-14: staff-retention with allStaffIds', () => {
    it('menangani staff dengan cohortN === 0 tanpa dead code', () => {
      const cohort: CohortCustomer[] = [
        {
          customerId: 'c1',
          originStaffId: 'staff-a',
          firstVisitDate: '2026-08-01',
          isRetained: true,
        },
      ];

      const policy = {
        benchmarkPct: 30,
        minSample: 5,
        splitTier1: 0.1,
        splitTier2: 0.15,
        splitTier3: 0.2,
        tier1MaxPct: 25,
        tier2MaxPct: 35,
      };

      const results = calculateRetention(cohort, policy, ['staff-a', 'staff-b']);
      expect(results.length).toBe(2);

      const staffB = results.find((r) => r.staffId === 'staff-b');
      expect(staffB).toBeDefined();
      expect(staffB?.cohortN).toBe(0);
      expect(staffB?.status).toBe('INSUFFICIENT_SAMPLE');
    });
  });
});
