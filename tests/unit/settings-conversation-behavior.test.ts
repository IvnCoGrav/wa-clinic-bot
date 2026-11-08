import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app';

describe('Settings Conversation Behavior Ghost Config (Task 0.10)', () => {
  const app = buildApp();
  const adminKey = 'test_admin_key_conv_behavior';

  beforeEach(() => {
    process.env.ADMIN_API_KEY = adminKey;
  });

  it('should persist conversation behavior updates so subsequent GET returns updated values (no fake 200)', async () => {
    // Kirim update konfigurasi baru
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/admin/conversation-behavior',
      headers: {
        'x-api-key': adminKey,
      },
      payload: {
        idleGreeting: {
          enabled: false,
          minHours: 48,
        },
      },
    });

    // Jika endpoint belum diimplementasikan, wajib 501 Not Implemented (fail-closed).
    // Jika 200 OK, maka data WAJIB benar-benar tersimpan ke DB.
    if (patchRes.statusCode === 501) {
      expect(patchRes.statusCode).toBe(501);
      return;
    }

    expect(patchRes.statusCode).toBe(200);

    // Ambil ulang konfigurasi lewat GET
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/admin/conversation-behavior',
      headers: {
        'x-api-key': adminKey,
      },
    });

    expect(getRes.statusCode).toBe(200);
    const body = getRes.json();

    // Pada kode lama di settings.subroute.ts:1802-1838:
    // PATCH hanya me-return echo objek tanpa menulis ke DB.
    // GET selalu mengembalikan nilai statis hardcode { enabled: true, minHours: 24 }.
    // Sehingga body.data.idleGreeting.minHours tetap 24 (gagal karena tidak tersimpan!).
    expect(body.data?.idleGreeting?.enabled).toBe(false);
    expect(body.data?.idleGreeting?.minHours).toBe(48);
  });
});
