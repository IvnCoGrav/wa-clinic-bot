import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isBypassLabelName, isSystemLabelName, hasBypassLabel, checkCustomerBypass } from '../../src/utils/customer-bypass';
import { capiService } from '../../src/services/capi.service';
import { followUpService, CANCEL_REASON } from '../../src/services/follow-up.service';
import { prisma } from '../../src/db/client';

describe('Customer Bypass Label Engine (Skip & Admin CS)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. isBypassLabelName & isSystemLabelName Matchers', () => {
    it('harus mengenali semua variasi nama label Skip', () => {
      expect(isBypassLabelName('Skip')).toBe(true);
      expect(isBypassLabelName('skip')).toBe(true);
      expect(isBypassLabelName('SKIP')).toBe(true);
      expect(isBypassLabelName('skip customer')).toBe(true);
      expect(isBypassLabelName('kontak skip')).toBe(true);
    });

    it('harus mengenali semua variasi nama label Admin CS', () => {
      expect(isBypassLabelName('Admin (CS)')).toBe(true);
      expect(isBypassLabelName('Admin CS')).toBe(true);
      expect(isBypassLabelName('admin cs')).toBe(true);
      expect(isBypassLabelName('admin-cs')).toBe(true);
      expect(isBypassLabelName('admin_cs')).toBe(true);
      expect(isBypassLabelName('Admin')).toBe(true);
      expect(isBypassLabelName('admin')).toBe(true);
    });

    it('TIDAK boleh mem-bypass label normal bisnis klinis', () => {
      expect(isBypassLabelName('Pending Payment')).toBe(false);
      expect(isBypassLabelName('Repeat Order')).toBe(false);
      expect(isBypassLabelName('New Customer')).toBe(false);
      expect(isBypassLabelName('Medical Emergency')).toBe(false);
      expect(isBypassLabelName('Unresolved FAQ')).toBe(false);
      expect(isBypassLabelName('MQL (Hot Lead)')).toBe(false);
      expect(isBypassLabelName('VIP Mom')).toBe(false);
    });

    it('harus mengenali label bawaan sistem yang dilindungi dari delete', () => {
      expect(isSystemLabelName('Hold')).toBe(true);
      expect(isSystemLabelName('Admin (CS)')).toBe(true);
      expect(isSystemLabelName('Admin CS')).toBe(true);
      expect(isSystemLabelName('Skip')).toBe(true);
      expect(isSystemLabelName('Pending Payment')).toBe(true);
      expect(isSystemLabelName('Repeat Order')).toBe(true);
      expect(isSystemLabelName('New Customer')).toBe(true);
      expect(isSystemLabelName('Medical Emergency')).toBe(true);
      expect(isSystemLabelName('Unresolved FAQ')).toBe(true);
      expect(isSystemLabelName('MQL (Hot Lead)')).toBe(true);

      // Label kustom tidak boleh dianggap sistem
      expect(isSystemLabelName('VIP Treatment')).toBe(false);
      expect(isSystemLabelName('Promo Akhir Tahun')).toBe(false);
    });
  });

  describe('2. hasBypassLabel in-memory detection', () => {
    it('mendeteksi customer dengan is_admin_labeled: true', () => {
      const cust = { phone: '62811223344', is_admin_labeled: true };
      expect(hasBypassLabel(cust)).toBe(true);
    });

    it('mendeteksi customer dengan relasi labels Prisma berisikan Skip', () => {
      const cust = {
        phone: '62811223344',
        is_admin_labeled: false,
        labels: [{ label: { name: 'Skip' } }],
      };
      expect(hasBypassLabel(cust)).toBe(true);
    });

    it('mendeteksi customer dengan relasi labels Prisma berisikan Admin (CS)', () => {
      const cust = {
        phone: '62811223344',
        is_admin_labeled: false,
        labels: [{ label: { name: 'Admin (CS)' } }],
      };
      expect(hasBypassLabel(cust)).toBe(true);
    });

    it('mendeteksi input array string label langsung', () => {
      expect(hasBypassLabel(['Repeat Order', 'Skip'])).toBe(true);
      expect(hasBypassLabel(['New Customer', 'Pending Payment'])).toBe(false);
    });

    it('mengembalikan false untuk customer normal tanpa label bypass', () => {
      const cust = {
        phone: '62811223344',
        is_admin_labeled: false,
        labels: [{ label: { name: 'New Customer' } }, { label: { name: 'Repeat Order' } }],
      };
      expect(hasBypassLabel(cust)).toBe(false);
    });
  });

  describe('3. Meta CAPI Guard Bypass', () => {
    it('sendCapiEvent menolak mengirim event jika customer berlabel Skip', async () => {
      const customer = {
        id: 'cust_skip_1',
        phone: '6281234567801',
        name: 'Internal Skip Tester',
        labels: [{ label: { name: 'Skip' } }],
      };

      const res = await capiService.sendCapiEvent({
        eventName: 'Contact',
        customer,
        tenantId: 'default-tenant',
      });

      expect(res.success).toBe(false);
      expect(res.message).toContain('bypass contact');
    });

    it('sendCapiEvent menolak mengirim event jika customer memiliki is_admin_labeled=true', async () => {
      const customer = {
        id: 'cust_admin_1',
        phone: '6281234567802',
        name: 'Staff Admin CS',
        is_admin_labeled: true,
      };

      const res = await capiService.sendCapiEvent({
        eventName: 'Purchase',
        customer,
        value: 250000,
        tenantId: 'default-tenant',
      });

      expect(res.success).toBe(false);
      expect(res.message).toContain('bypass contact');
    });
  });

  describe('4. Follow-Up Creation Bypass', () => {
    it('createNoPurchaseFollowUps tidak membuat row follow-up untuk customer berlabel Skip', async () => {
      const createSpy = vi.spyOn(prisma.followUp, 'create');

      // Mock customer dengan label Skip
      vi.mocked(prisma.customer.findUnique).mockResolvedValueOnce({
        id: 'cust_skip_2',
        phone: '6281234567803',
        name: 'Tester Skip',
        is_admin_labeled: false,
        is_sandbox_test: false,
        labels: [{ label: { name: 'Skip' } }],
      } as any);

      await followUpService.createNoPurchaseFollowUps('cust_skip_2', 'default-tenant');
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('createNextTreatmentFollowUps tidak membuat row follow-up untuk customer berlabel Admin CS', async () => {
      const createSpy = vi.spyOn(prisma.followUp, 'create');

      vi.mocked(prisma.customer.findUnique).mockResolvedValueOnce({
        id: 'cust_admin_2',
        phone: '6281234567804',
        name: 'Bidan Kala',
        is_admin_labeled: true,
        is_sandbox_test: false,
        labels: [],
      } as any);

      await followUpService.createNextTreatmentFollowUps('cust_admin_2', new Date(), 'default-tenant');
      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe('5. Follow-Up Worker Execution Bypass', () => {
    it('processDueFollowUps mengubah status item ke SKIPPED jika customer berlabel bypass', async () => {
      const updateSpy = vi.spyOn(prisma.followUp, 'update').mockResolvedValueOnce({} as any);

      const mockDueItem = {
        id: 'fu_due_bypass_1',
        type: 'NO_PURCHASE',
        status: 'QUEUED',
        scheduled_at: new Date(Date.now() - 10000),
        customer: {
          id: 'cust_bypass_due',
          phone: '6281234567805',
          is_admin_labeled: true,
          labels: [{ label: { name: 'Admin (CS)' } }],
        },
      };

      vi.mocked(prisma.followUp.findMany).mockResolvedValueOnce([mockDueItem] as any);

      await followUpService.processDueFollowUps('default-tenant');

      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'fu_due_bypass_1' },
          data: { status: 'SKIPPED', cancel_reason: CANCEL_REASON.BYPASS_LABEL },
        })
      );
    });
  });
});
