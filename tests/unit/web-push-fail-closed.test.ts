import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import webpush from 'web-push';
import { WebPushService } from '../../src/services/web-push.service';

describe('FN-05: WebPushService Fail-Closed in Production', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('di mode production (NODE_ENV=production): melempar error fail-closed jika VAPID ENV tidak disetel', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    (WebPushService as any).instance = null;

    expect(() => {
      WebPushService.getInstance();
    }).toThrow(/VAPID_PUBLIC_KEY dan VAPID_PRIVATE_KEY wajib dikonfigurasi.*production/i);
  });

  it('di mode production (NODE_ENV=production): berhasil start saat VAPID ENV tersedia lengkap', async () => {
    const validKeys = webpush.generateVAPIDKeys();
    process.env.NODE_ENV = 'production';
    process.env.VAPID_PUBLIC_KEY = validKeys.publicKey;
    process.env.VAPID_PRIVATE_KEY = validKeys.privateKey;

    (WebPushService as any).instance = null;
    const instance = WebPushService.getInstance();
    expect(instance.getPublicKey()).toBe(validKeys.publicKey);
  });
});
