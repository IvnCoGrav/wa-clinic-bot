import { describe, it, expect } from 'vitest';
import {
  matchesSourceFilter,
  shouldReloadForSseEvent,
  shouldPreserveActiveChat,
  isSameConversation,
} from '../../packages/admin-dashboard/src/utils/livechatSourceFilter';

/**
 * #160 LiveChat blinking: SSE cross-mode thrashing.
 *
 * Akar: saat admin berada di filter Sandbox, event SSE untuk pasien WA asli
 * (mode real) tetap memicu `loadChats(true)` berulang → UI berkedip. Guard
 * deterministik: event hanya boleh memicu reload bila MODE-nya cocok dengan
 * filter aktif. Tidak ada pencocokan string/teks — murni boolean mode.
 */
describe('#160 LiveChat source-filter guard (SSE cross-mode thrashing)', () => {
  describe('matchesSourceFilter', () => {
    it('filter sandbox hanya menerima item sandbox', () => {
      expect(matchesSourceFilter({ isSandboxTest: true }, 'sandbox')).toBe(true);
      expect(matchesSourceFilter({ isSandboxTest: false }, 'sandbox')).toBe(false);
      expect(matchesSourceFilter({}, 'sandbox')).toBe(false);
    });

    it('filter real (all/unread/reservation) hanya menerima item non-sandbox', () => {
      for (const f of ['all', 'unread', 'reservation'] as const) {
        expect(matchesSourceFilter({ isSandboxTest: false }, f)).toBe(true);
        expect(matchesSourceFilter({ isSandboxTest: true }, f)).toBe(false);
        expect(matchesSourceFilter({}, f)).toBe(true);
      }
    });
  });

  describe('shouldReloadForSseEvent', () => {
    it('event real TIDAK memicu reload saat filter sandbox (anti-kedip)', () => {
      expect(shouldReloadForSseEvent({ isSandboxTest: false }, 'sandbox')).toBe(false);
    });

    it('event sandbox TIDAK memicu reload saat filter real', () => {
      expect(shouldReloadForSseEvent({ isSandboxTest: true }, 'all')).toBe(false);
      expect(shouldReloadForSseEvent({ isSandboxTest: true }, 'unread')).toBe(false);
    });

    it('event dengan mode cocok memicu reload', () => {
      expect(shouldReloadForSseEvent({ isSandboxTest: true }, 'sandbox')).toBe(true);
      expect(shouldReloadForSseEvent({ isSandboxTest: false }, 'all')).toBe(true);
    });

    it('payload tanpa isSandboxTest dianggap mode real (fail-open ke perilaku lama)', () => {
      expect(shouldReloadForSseEvent({}, 'sandbox')).toBe(false);
      expect(shouldReloadForSseEvent({}, 'all')).toBe(true);
    });
  });

  describe('shouldPreserveActiveChat (ghost chat leakage)', () => {
    it('chat aktif real TIDAK dipertahankan saat beralih ke sandbox', () => {
      expect(shouldPreserveActiveChat({ isSandboxTest: false }, 'sandbox')).toBe(false);
    });

    it('chat aktif sandbox dipertahankan saat filter sandbox', () => {
      expect(shouldPreserveActiveChat({ isSandboxTest: true }, 'sandbox')).toBe(true);
    });

    it('chat aktif real dipertahankan saat filter real', () => {
      expect(shouldPreserveActiveChat({ isSandboxTest: false }, 'all')).toBe(true);
    });
  });

  describe('isSameConversation (flash spinner)', () => {
    it('true bila id sama — jangan wipe bubble saat refresh', () => {
      expect(isSameConversation('conv-1', 'conv-1')).toBe(true);
    });
    it('false bila berbeda atau kosong — boleh wipe saat ganti percakapan', () => {
      expect(isSameConversation('conv-1', 'conv-2')).toBe(false);
      expect(isSameConversation('conv-1', null)).toBe(false);
      expect(isSameConversation(null, 'conv-2')).toBe(false);
    });
  });
});
