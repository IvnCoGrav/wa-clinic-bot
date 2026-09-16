import { describe, it, expect } from 'vitest';
import { GoalTracker } from '../../../src/v3/state/goal-tracker';
import { isAskedLocationRecently } from '../../../src/v3/state/conversation-summarizer';

describe('Location Prompt Grounding Sync & Cool-Off (anti-kaset rusak)', () => {
  it('isAskedLocationRecently mendeteksi berbagai variasi sapaan pembuka lokasi', () => {
    expect(isAskedLocationRecently([
      { role: 'assistant', content: 'Perkenalkan saya Bidan Yusi. Kalau boleh tau rumahnya dimana ya Bunda? 😊' }
    ])).toBe(true);

    expect(isAskedLocationRecently([
      { role: 'assistant', content: 'Rumah Bunda di daerah mana ya? Biar kami bantu cekkan.' }
    ])).toBe(true);

    expect(isAskedLocationRecently([
      { role: 'assistant', content: 'Untuk keluhan batuk pilek kami sarankan Pijat Pulih Ceria ya Bunda.' }
    ])).toBe(false);
  });

  it('formatGoalSessionForPrompt mencetak instruksi cool-off bila lokasi baru saja ditanyakan', () => {
    const session: any = {
      genderGreeting: 'Bunda',
      customerName: 'Bunda Test',
      location: null,
      cartItems: [],
    };

    const history = [
      { role: 'user', content: 'halo kak' },
      { role: 'assistant', content: 'Perkenalkan, saya Bidan Yusi... Kalau boleh tau rumahnya dimana ya Bunda? 😊' },
      { role: 'user', content: 'yg untuk kembung apa kak' },
    ];

    const promptText = GoalTracker.formatGoalSessionForPrompt(session, { history });

    expect(promptText).toContain('• Lokasi: Belum diketahui');
    expect(promptText).not.toContain('Perlu ditanyakan kelurahan/kecamatannya');
    expect(promptText).toContain('Sudah ditanyakan di pesan sebelumnya — JANGAN menanyakan lokasi lagi');
  });

  it('formatGoalSessionForPrompt mencetak instruksi normal jika lokasi belum pernah ditanyakan', () => {
    const session: any = {
      genderGreeting: 'Bunda',
      customerName: 'Bunda Test',
      location: null,
      cartItems: [],
    };

    const history = [
      { role: 'user', content: 'halo kak' },
    ];

    const promptText = GoalTracker.formatGoalSessionForPrompt(session, { history });

    expect(promptText).toContain('• Lokasi: Belum diketahui (Perlu ditanyakan kelurahan/kecamatannya)');
  });

  it('formatGoalSessionForPrompt mencetak status SUDAH DIKETAHUI jika lokasi ada', () => {
    const session: any = {
      genderGreeting: 'Bunda',
      customerName: 'Bunda Test',
      location: {
        kelurahan: 'Kutisari',
        kecamatan: 'Tenggilis Mejoyo',
        kota: 'Surabaya',
        distanceKm: 5,
      },
      cartItems: [],
    };

    const promptText = GoalTracker.formatGoalSessionForPrompt(session);

    expect(promptText).toContain('STATUS: SUDAH DIKETAHUI - DILARANG TANYA ALAMAT LAGI!');
  });
});
