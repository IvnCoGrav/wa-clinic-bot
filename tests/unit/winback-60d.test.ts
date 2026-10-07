import { describe, it, expect, beforeEach, vi } from 'vitest';
import { followUpService } from '../../src/services/follow-up.service';
import { getRollingFollowUpMessage, FOLLOWUP_ROLLING_TEMPLATES } from '../../src/config/followup-templates';
import { prisma } from '../../src/db/client';
import { DEFAULT_TENANT_ID } from '../../src/config/tenant';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('WINBACK_60D — Re-engagement Pelanggan Dormant (>60 hari)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Template rolling (3 varian)', () => {
    it('menyediakan tepat 3 varian distinct dengan substitusi nama & anak', () => {
      const templates = FOLLOWUP_ROLLING_TEMPLATES.WINBACK_60D;
      expect(templates.length).toBe(3);

      const v = [0, 1, 2].map((index) =>
        getRollingFollowUpMessage('WINBACK_60D', { name: 'Sari', babyName: 'dek Rose', index })
      );
      expect(v[0].text).not.toBe(v[1].text);
      expect(v[1].text).not.toBe(v[2].text);
      expect(v[0].text).not.toBe(v[2].text);
      for (const item of v) {
        expect(item.text).toContain('Bunda Sari');
        expect(item.text).toContain('dek Rose');
        expect(item.templateIndex).toBeGreaterThanOrEqual(1);
        expect(item.templateIndex).toBeLessThanOrEqual(3);
      }
    });

    it('fallback ke "Bunda" & "si kecil" saat nama/anak kosong tanpa duplikasi "Bunda Bunda"', () => {
      const t = getRollingFollowUpMessage('WINBACK_60D', { name: '', index: 0 });
      expect(t.text).toContain('Bunda');
      expect(t.text).toContain('si kecil');
      expect(t.text).not.toMatch(/Bunda\s+Bunda/i);
    });
  });

  describe('enqueueDormantWinbackFollowUps', () => {
    it('membuat baris QUEUED tipe WINBACK_60D stage 1 pada jam kerja untuk kandidat', async () => {
      vi.spyOn(prisma.customer, 'findMany').mockResolvedValueOnce([
        { id: 'c1', phone: '628111000111', name: 'Bunda A' },
        { id: 'c2', phone: '628111000222', name: 'Bunda B' },
      ] as any);
      // Beban hari kosong.
      vi.spyOn(prisma.followUp, 'findMany').mockResolvedValueOnce([] as any);
      const createSpy = vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);

      const n = await followUpService.enqueueDormantWinbackFollowUps(DEFAULT_TENANT_ID);

      expect(n).toBe(2);
      expect(createSpy).toHaveBeenCalledTimes(2);
      const first = createSpy.mock.calls[0][0].data as any;
      expect(first.type).toBe('WINBACK_60D');
      expect(first.stage).toBe(1);
      expect(first.status).toBe('QUEUED');
      expect(first.tenant_id).toBe(DEFAULT_TENANT_ID);
      // 09:30 WIB = 02:30 UTC.
      expect(first.scheduled_at.getUTCHours()).toBe(2);
      expect(first.scheduled_at.getUTCMinutes()).toBe(30);
    });

    it('query kandidat tenant-scoped + guard dormant/antrean/reservasi/MQL-legacy', async () => {
      vi.spyOn(prisma.customer, 'findMany').mockResolvedValueOnce([] as any);
      vi.spyOn(prisma.followUp, 'findMany').mockResolvedValueOnce([] as any);

      await followUpService.enqueueDormantWinbackFollowUps(DEFAULT_TENANT_ID);

      const where = (prisma.customer.findMany as any).mock.calls.at(-1)[0].where;
      expect(where.tenant_id).toBe(DEFAULT_TENANT_ID);
      expect(where.status).toBe('active');
      expect(where.deleted_at).toBeNull();
      expect(where.OR).toEqual([
        {
          reservations: { some: { status: 'completed' } },
          follow_ups: { some: { type: 'NEXT_TREATMENT', stage: 3, status: 'SENT' } },
        },
        {
          is_mql: true,
          follow_ups: { some: { type: 'NO_PURCHASE', stage: 3, status: 'SENT' } },
        },
      ]);
      expect(where.conversations?.every?.last_message_at?.lte).toBeInstanceOf(Date);
      // Guard antrean kosong + idempotensi WINBACK 60 hari.
      expect(where.follow_ups?.none).toBeDefined();
      // Guard jadwal depan (Opsi 3).
      expect(where.reservations?.none?.booking_date?.gte).toBeInstanceOf(Date);
      expect(where.reservations?.none?.status?.not).toBe('cancelled');
    });

    it('tidak membuat baris bila tidak ada kandidat', async () => {
      vi.spyOn(prisma.customer, 'findMany').mockResolvedValueOnce([] as any);
      vi.spyOn(prisma.followUp, 'findMany').mockResolvedValueOnce([] as any);
      const createSpy = vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);

      const n = await followUpService.enqueueDormantWinbackFollowUps(DEFAULT_TENANT_ID);

      expect(n).toBe(0);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('menyaring kontak dummy/test dari kandidat', async () => {
      vi.spyOn(prisma.customer, 'findMany').mockResolvedValueOnce([
        { id: 'cd', phone: '628999900001', name: 'Dummy Number' }, // simulator test
        { id: 'c-real', phone: '628111000333', name: 'Bunda Real' },
      ] as any);
      vi.spyOn(prisma.followUp, 'findMany').mockResolvedValueOnce([] as any);
      const createSpy = vi.spyOn(prisma.followUp, 'create').mockResolvedValue({} as any);

      const n = await followUpService.enqueueDormantWinbackFollowUps(DEFAULT_TENANT_ID);

      expect(n).toBe(1);
      expect(createSpy.mock.calls[0][0].data.customer_id).toBe('c-real');
    });
  });

  describe('checkAndSetLostCustomers — auto-lost WINBACK_60D (grace 7 hari)', () => {
    const sentAt = new Date(Date.now() - 8 * DAY_MS); // > 7 hari

    function mockSentWinbackChain(winback: any[]) {
      const fuFind = vi.spyOn(prisma.followUp, 'findMany');
      fuFind.mockResolvedValueOnce([] as any); // NEXT_TREATMENT stage 3 → kosong
      fuFind.mockResolvedValueOnce([] as any); // NO_PURCHASE stage 3 (kohort baru H8) → kosong
      fuFind.mockResolvedValueOnce(winback as any); // WINBACK_60D SENT
    }

    it('menandai lost bila tidak ada respons inbound maupun reservasi baru', async () => {
      mockSentWinbackChain([{ id: 'w1', customer_id: 'cust-w', sent_at: sentAt }]);
      vi.spyOn(prisma.reservation, 'findMany').mockResolvedValue([] as any);
      vi.spyOn(prisma.conversation, 'findMany').mockResolvedValue([
        { customer_id: 'cust-w', last_customer_message_at: null },
      ] as any);
      const upd = vi.spyOn(prisma.customer, 'update').mockResolvedValue({} as any);

      await followUpService.checkAndSetLostCustomers(DEFAULT_TENANT_ID);

      expect(upd).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cust-w' }, data: { status: 'lost' } })
      );
    });

    it('TIDAK menandai lost bila customer membalas inbound setelah sent_at', async () => {
      mockSentWinbackChain([{ id: 'w2', customer_id: 'cust-chat', sent_at: sentAt }]);
      vi.spyOn(prisma.reservation, 'findMany').mockResolvedValue([] as any);
      vi.spyOn(prisma.conversation, 'findMany').mockResolvedValue([
        { customer_id: 'cust-chat', last_customer_message_at: new Date(sentAt.getTime() + 60 * 60 * 1000) },
      ] as any);
      const upd = vi.spyOn(prisma.customer, 'update').mockResolvedValue({} as any);

      await followUpService.checkAndSetLostCustomers(DEFAULT_TENANT_ID);

      expect(upd).not.toHaveBeenCalled();
    });

    it('TIDAK menandai lost bila ada reservasi baru setelah sent_at', async () => {
      mockSentWinbackChain([{ id: 'w3', customer_id: 'cust-res', sent_at: sentAt }]);
      vi.spyOn(prisma.reservation, 'findMany').mockResolvedValue([
        { customer_id: 'cust-res', created_at: new Date(sentAt.getTime() + 60 * 60 * 1000) },
      ] as any);
      vi.spyOn(prisma.conversation, 'findMany').mockResolvedValue([] as any);
      const upd = vi.spyOn(prisma.customer, 'update').mockResolvedValue({} as any);

      await followUpService.checkAndSetLostCustomers(DEFAULT_TENANT_ID);

      expect(upd).not.toHaveBeenCalled();
    });
  });
});
