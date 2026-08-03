import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { isPureIdleGreeting } from '../../src/state-machine/utils/idle-greeting';
import { IdleGreetingConfigService } from '../../src/config/idle-greeting.config';

describe('isPureIdleGreeting', () => {
  const twoDaysAgo = () => new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const oneHourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

  beforeEach(() => {
    vi.restoreAllMocks();
    IdleGreetingConfigService.clearCache();
    delete process.env.IDLE_GREETING_ENABLED;
    delete process.env.IDLE_GREETING_MIN_HOURS;
  });

  afterEach(() => {
    delete process.env.IDLE_GREETING_ENABLED;
    delete process.env.IDLE_GREETING_MIN_HOURS;
  });

  it('sapaan murni + idle >= min_hours (default 36 jam) → true', () => {
    expect(isPureIdleGreeting({ messageText: 'halo', lastMessageAt: twoDaysAgo() })).toBe(true);
    expect(isPureIdleGreeting({ messageText: 'hai bubid', lastMessageAt: twoDaysAgo() })).toBe(true);
    expect(isPureIdleGreeting({ messageText: 'halo bunda', lastMessageAt: twoDaysAgo() })).toBe(true);
  });

  it('idle < min_hours → false (belum cukup lama)', () => {
    expect(isPureIdleGreeting({ messageText: 'halo', lastMessageAt: oneHourAgo() })).toBe(false);
  });

  it('tidak ada lastMessageAt → false (percakapan baru)', () => {
    expect(isPureIdleGreeting({ messageText: 'halo', lastMessageAt: null })).toBe(false);
    expect(isPureIdleGreeting({ messageText: 'halo', lastMessageAt: undefined })).toBe(false);
  });

  it('bukan sapaan murni (ada kata spesifik) → false meskipun idle lama', () => {
    expect(isPureIdleGreeting({ messageText: 'halo berapa harga pijat', lastMessageAt: twoDaysAgo() })).toBe(false);
    expect(isPureIdleGreeting({ messageText: 'halo mau booking', lastMessageAt: twoDaysAgo() })).toBe(false);
    expect(isPureIdleGreeting({ messageText: 'halo, rumah saya di surabaya', lastMessageAt: twoDaysAgo() })).toBe(false);
  });

  it('bukan sapaan sama sekali → false', () => {
    expect(isPureIdleGreeting({ messageText: 'pijat bayi apa ya', lastMessageAt: twoDaysAgo() })).toBe(false);
    expect(isPureIdleGreeting({ messageText: 'terima kasih', lastMessageAt: twoDaysAgo() })).toBe(false);
  });

  it('NLU intent greeting tanpa intent spesifik → true', () => {
    expect(isPureIdleGreeting({ messageText: 'halo', lastMessageAt: twoDaysAgo(), nluIntents: ['greeting'] })).toBe(true);
  });

  it('NLU greeting + intent spesifik (ask_price) → false', () => {
    expect(
      isPureIdleGreeting({ messageText: 'halo', lastMessageAt: twoDaysAgo(), nluIntents: ['greeting', 'ask_price'] })
    ).toBe(false);
  });

  it('NLU tidak mendeteksi greeting → jatuh ke regex fallback', () => {
    expect(
      isPureIdleGreeting({ messageText: 'halo bunda', lastMessageAt: twoDaysAgo(), nluIntents: ['off_topic'] })
    ).toBe(true);
  });

  it('IDLE_GREETING_ENABLED=false → false walau idle lama', () => {
    process.env.IDLE_GREETING_ENABLED = 'false';
    expect(isPureIdleGreeting({ messageText: 'halo', lastMessageAt: twoDaysAgo() })).toBe(false);
  });

  it('IDLE_GREETING_MIN_HOURS env mengubah ambang', () => {
    process.env.IDLE_GREETING_MIN_HOURS = '1';
    // 2 jam idle ≥ 1 jam ambang
    const twoHoursAgo = () => new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(isPureIdleGreeting({ messageText: 'halo', lastMessageAt: twoHoursAgo() })).toBe(true);
  });

  it('sapaan "halo" pada percakapan yang sedang sangat aktif (idle pendek) → false', () => {
    expect(isPureIdleGreeting({ messageText: 'halo', lastMessageAt: new Date() })).toBe(false);
  });
});
