import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_MAX_INBOUND_AGE_SECONDS,
  classifyStaleInbound,
  computeInboundAgeSeconds,
  hasInboundBypassFlag,
  logInboundWithoutReply,
  resolveInboundBypass,
  resolveMaxInboundAgeSeconds,
} from '../../src/services/ingress/inbound-guard.service';
import { customerService } from '../../src/services/customer.service';
import { conversationService } from '../../src/services/conversation.service';
import { messageService } from '../../src/services/message.service';

const NOW = Date.UTC(2026, 10, 13, 12, 0, 0); // 2026-11-13T12:00:00Z

describe('ING-10 — guard ingress bersama (WAHA + WABA)', () => {
  const prevEnv = process.env.MAX_INBOUND_MESSAGE_AGE_SECONDS;

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.MAX_INBOUND_MESSAGE_AGE_SECONDS;
    else process.env.MAX_INBOUND_MESSAGE_AGE_SECONDS = prevEnv;
  });

  describe('computeInboundAgeSeconds', () => {
    it('menerima epoch detik dan milidetik dengan hasil sama', () => {
      const seconds = Math.floor(NOW / 1000) - 10;
      expect(computeInboundAgeSeconds(seconds, NOW)).toBe(10);
      expect(computeInboundAgeSeconds(seconds * 1000, NOW)).toBe(10);
      expect(computeInboundAgeSeconds(String(seconds), NOW)).toBe(10);
    });

    it('timestamp tidak valid / kosong → null (tidak pernah dianggap basi)', () => {
      for (const bad of [null, undefined, '', 0, -5, 'abc', NaN]) {
        expect(computeInboundAgeSeconds(bad as any, NOW)).toBeNull();
      }
    });

    it('timestamp masa depan → umur negatif (bukan basi)', () => {
      const future = Math.floor(NOW / 1000) + 60;
      expect(computeInboundAgeSeconds(future, NOW)).toBe(-60);
      expect(classifyStaleInbound({ timestamp: future, maxAgeSeconds: 180, nowMs: NOW }).stale).toBe(false);
    });
  });

  describe('resolveMaxInboundAgeSeconds', () => {
    it('default 300 saat env kosong, 0 saat nilai tidak valid', () => {
      const prev = process.env.MAX_INBOUND_MESSAGE_AGE_SECONDS;
      delete process.env.MAX_INBOUND_MESSAGE_AGE_SECONDS;
      try {
        expect(resolveMaxInboundAgeSeconds(undefined)).toBe(DEFAULT_MAX_INBOUND_AGE_SECONDS);
        expect(resolveMaxInboundAgeSeconds('')).toBe(DEFAULT_MAX_INBOUND_AGE_SECONDS);
      } finally {
        if (prev === undefined) delete process.env.MAX_INBOUND_MESSAGE_AGE_SECONDS;
        else process.env.MAX_INBOUND_MESSAGE_AGE_SECONDS = prev;
      }
      expect(resolveMaxInboundAgeSeconds('abc')).toBe(0);
      expect(resolveMaxInboundAgeSeconds('180')).toBe(180);
      expect(resolveMaxInboundAgeSeconds(0)).toBe(0);
    });

    it('membaca env saat argumen tidak diberikan', () => {
      process.env.MAX_INBOUND_MESSAGE_AGE_SECONDS = '45';
      expect(resolveMaxInboundAgeSeconds()).toBe(45);
    });
  });

  describe('classifyStaleInbound', () => {
    const staleTs = Math.floor(NOW / 1000) - 3600;

    it('pesan segar → proceed', () => {
      const freshTs = Math.floor(NOW / 1000) - 10;
      expect(classifyStaleInbound({ timestamp: freshTs, maxAgeSeconds: 180, nowMs: NOW })).toEqual({
        stale: false,
        action: 'proceed',
        reason: 'fresh',
        ageSeconds: 10,
      });
    });

    it('tepat di ambang (age === max) masih dianggap segar', () => {
      const ts = Math.floor(NOW / 1000) - 180;
      expect(classifyStaleInbound({ timestamp: ts, maxAgeSeconds: 180, nowMs: NOW }).stale).toBe(false);
    });

    it('guard dimatikan (maxAge 0) → proceed meski sangat tua', () => {
      const res = classifyStaleInbound({ timestamp: staleTs, maxAgeSeconds: 0, nowMs: NOW });
      expect(res.action).toBe('proceed');
      expect(res.stale).toBe(false);
    });

    it('pesan basi biasa → log_only', () => {
      const res = classifyStaleInbound({ timestamp: staleTs, maxAgeSeconds: 180, nowMs: NOW });
      expect(res).toMatchObject({ stale: true, action: 'log_only', reason: 'stale' });
    });

    it('GPS/shareloc basi → tetap proceed (prioritas tertinggi)', () => {
      const res = classifyStaleInbound({
        timestamp: staleTs,
        maxAgeSeconds: 180,
        isGpsShare: true,
        isReservationForm: true,
        isImage: true,
        nowMs: NOW,
      });
      expect(res).toMatchObject({ stale: true, action: 'proceed', reason: 'gps_share' });
    });

    it('form reservasi basi → proceed (di atas gambar)', () => {
      const res = classifyStaleInbound({
        timestamp: staleTs,
        maxAgeSeconds: 180,
        isReservationForm: true,
        isImage: true,
        nowMs: NOW,
      });
      expect(res).toMatchObject({ stale: true, action: 'proceed', reason: 'reservation_form' });
    });

    it('gambar basi → log_only dengan alasan image (media tetap disimpan)', () => {
      const res = classifyStaleInbound({
        timestamp: staleTs,
        maxAgeSeconds: 180,
        isImage: true,
        nowMs: NOW,
      });
      expect(res).toMatchObject({ stale: true, action: 'log_only', reason: 'image' });
    });

    it('menggunakan env bila maxAgeSeconds tidak diberikan', () => {
      process.env.MAX_INBOUND_MESSAGE_AGE_SECONDS = '180';
      expect(classifyStaleInbound({ timestamp: staleTs, nowMs: NOW }).stale).toBe(true);
      process.env.MAX_INBOUND_MESSAGE_AGE_SECONDS = '99999';
      expect(classifyStaleInbound({ timestamp: staleTs, nowMs: NOW }).stale).toBe(false);
    });
  });

  describe('hasInboundBypassFlag / resolveInboundBypass', () => {
    it('mengenali flag kolom dan berbagai bentuk label', () => {
      expect(hasInboundBypassFlag({ is_admin_labeled: true })).toBe(true);
      expect(hasInboundBypassFlag({ labels: [{ label: { name: 'Skip' } }] })).toBe(true);
      expect(hasInboundBypassFlag({ labels: [{ name: 'Admin CS' }] })).toBe(true);
      expect(hasInboundBypassFlag({ labels: ['hold', 'skip'] })).toBe(true);
      expect(hasInboundBypassFlag({ is_admin_labeled: false, labels: [{ label: { name: 'MQL (Hot Lead)' } }] })).toBe(false);
      expect(hasInboundBypassFlag(null)).toBe(false);
    });

    it('customer ber-flag → true tanpa perlu DB; customer biasa → false', async () => {
      await expect(
        resolveInboundBypass({ customer: { id: 'c1', is_admin_labeled: true }, phone: '62811', tenantId: 'default-tenant' })
      ).resolves.toBe(true);
      await expect(
        resolveInboundBypass({ customer: { id: 'c2', is_admin_labeled: false, labels: [] }, phone: '62812', tenantId: 'default-tenant' })
      ).resolves.toBe(false);
      await expect(resolveInboundBypass({ phone: '62813', tenantId: 'default-tenant' })).resolves.toBe(false);
    });
  });

  describe('logInboundWithoutReply', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('membuat customer+konservasi bila belum dimuat lalu mencatat INBOUND', async () => {
      const customer = { id: 'cust-1', phone: '628111' } as any;
      const conversation = { id: 'conv-1' } as any;
      const getCustomer = vi.spyOn(customerService, 'getOrCreateCustomer').mockResolvedValue(customer);
      const getConversation = vi.spyOn(conversationService, 'getOrCreateConversation').mockResolvedValue(conversation);
      const log = vi.spyOn(messageService, 'logMessage').mockResolvedValue(undefined as any);

      const res = await logInboundWithoutReply({
        tenantId: 'default-tenant',
        phone: '628111',
        contactName: 'Bunda Tes',
        content: 'halo',
        waMessageId: 'wamid.1',
        payloadRaw: { foo: 'bar' },
        isHistorical: true,
        skipMqlEvaluation: true,
      });

      expect(res).toEqual({ customerId: 'cust-1', conversationId: 'conv-1' });
      expect(getCustomer).toHaveBeenCalledWith('628111', 'Bunda Tes', 'default-tenant');
      expect(getConversation).toHaveBeenCalledWith('cust-1', 'default-tenant');
      expect(log).toHaveBeenCalledWith({
        tenantId: 'default-tenant',
        conversationId: 'conv-1',
        direction: 'INBOUND',
        content: 'halo',
        waMessageId: 'wamid.1',
        payloadRaw: { foo: 'bar' },
        isHistorical: true,
        skipMqlEvaluation: true,
      });
    });

    it('memakai customer/konservasi yang sudah dimuat tanpa lookup ulang', async () => {
      const getCustomer = vi.spyOn(customerService, 'getOrCreateCustomer');
      const getConversation = vi.spyOn(conversationService, 'getOrCreateConversation');
      const log = vi.spyOn(messageService, 'logMessage').mockResolvedValue(undefined as any);

      await logInboundWithoutReply({
        tenantId: 'default-tenant',
        phone: '628222',
        customer: { id: 'cust-2' },
        conversation: { id: 'conv-2' },
        content: 'tes',
      });

      expect(getCustomer).not.toHaveBeenCalled();
      expect(getConversation).not.toHaveBeenCalled();
      // Flag opsional TIDAK boleh ikut sebagai key undefined (kontrak argumen bersih).
      expect(log).toHaveBeenCalledWith({
        tenantId: 'default-tenant',
        conversationId: 'conv-2',
        direction: 'INBOUND',
        content: 'tes',
      });
    });
  });
});
