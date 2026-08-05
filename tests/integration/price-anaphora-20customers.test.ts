import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setupOfflineEnv,
  createAnaphoraScenario,
  seedAssistantMessage,
  runTurn,
  joinedReply,
  CapturingWAHAClient,
  AnaphoraScenario,
} from './helpers/chat-harness';

setupOfflineEnv();

// Mock modul WAHA client supaya pengiriman gambar pricelist tidak kena HTTP beneran
// (jalan offline cepat & deterministik) — sendImage direkam untuk assertion.
const mocks = vi.hoisted(() => ({
  sendImage: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/integrations/waha/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/integrations/waha/client')>();
  // Jangan spread instance (metode class ada di prototype → hilang). Mutasi langsung
  // instance singleton & override sendImage; metode lain (addLabel dll) tetap utuh.
  Object.assign(actual.wahaClient, { sendImage: mocks.sendImage });
  return actual;
});

import { wahaClient } from '../../src/integrations/waha/client';

let custCounter = 0;
function nextPhone(): string {
  return `62812000000${String(custCounter++).padStart(4, '0')}`;
}

describe('PRICE ANAPHORA — 20 simulasi chat customer berbeda', () => {
  beforeEach(() => {
    mocks.sendImage.mockClear();
  });

  // =====================================================================
  // A. 14 SKENARIO SUKSES: "berapa itu?" + riwayat rekomendasi bot → harga SPESIFIK
  // =====================================================================
  const successCases: Array<{
    q: string;
    seeds: string[];
    expectName: string;
    expectPrice: string;
  }> = [
    {
      q: 'berapa itu bund ?',
      seeds: ['Kami rekomendasikan Pijat Bayi Pulih Ceria untuk bunda.'],
      expectName: 'Pijat Bayi Pulih Ceria',
      expectPrice: 'Rp70.000',
    },
    {
      q: 'harganya berapa ya bun?',
      seeds: ['Pijat Bayi Ceria cocok buat si kecil.'],
      expectName: 'Pijat Bayi Ceria',
      expectPrice: 'Rp60.000',
    },
    {
      q: 'itu berapa kak?',
      seeds: ['Untuk bunda bisa coba Pijat Lahap Juara.'],
      expectName: 'Pijat Lahap Juara',
      expectPrice: 'Rp70.000',
    },
    {
      q: 'berapa ya bu?',
      seeds: ['Pijat Kids Ceria buat anak 2-7 tahun.'],
      expectName: 'Pijat Kids Ceria',
      expectPrice: 'Rp90.000',
    },
    {
      q: 'kalo itu berapa?',
      seeds: ['Kami sarankan Pijat Bayi Pulih Ceria buat bapil.'],
      expectName: 'Pijat Bayi Pulih Ceria',
      expectPrice: 'Rp70.000',
    },
    {
      q: 'itu tadi berapa?',
      seeds: ['Pijat Bayi Ceria sudah cukup bunda.'],
      expectName: 'Pijat Bayi Ceria',
      expectPrice: 'Rp60.000',
    },
    {
      q: 'berapa dong bund?',
      seeds: ['Pijat Lahap Juara bantu nafsu makan.'],
      expectName: 'Pijat Lahap Juara',
      expectPrice: 'Rp70.000',
    },
    {
      q: 'itu berapa harganya bun?',
      seeds: ['Pijat Kids Ceria sangat recommended.'],
      expectName: 'Pijat Kids Ceria',
      expectPrice: 'Rp90.000',
    },
    {
      q: 'berapa itu bund?',
      seeds: ['Kami punya Pijat Bayi Ceria', 'Atau Pijat Kids Ceria juga bisa'],
      expectName: 'Pijat Kids Ceria',
      expectPrice: 'Rp90.000',
    },
    {
      q: 'itu berapa ya bund?',
      seeds: ['Treatmentnya adalah (Pijat Bayi Pulih Ceria) bunda.'],
      expectName: 'Pijat Bayi Pulih Ceria',
      expectPrice: 'Rp70.000',
    },
    {
      q: 'berapa itu bund ?',
      seeds: ['Pijat Lahap Juara tersedia.'],
      expectName: 'Pijat Lahap Juara',
      expectPrice: 'Rp70.000',
    },
    {
      q: 'kalau yang itu berapa bun?',
      seeds: ['Pijat Bayi Ceria mulai dari promo.'],
      expectName: 'Pijat Bayi Ceria',
      expectPrice: 'Rp60.000',
    },
    {
      q: 'itu harganya berapa?',
      seeds: ['Pijat Kids Ceria bisa di-book.'],
      expectName: 'Pijat Kids Ceria',
      expectPrice: 'Rp90.000',
    },
    {
      q: 'itu berapa ya bun?',
      seeds: ['Bisa pilih Pijat Bayi Pulih Ceria.'],
      expectName: 'Pijat Bayi Pulih Ceria',
      expectPrice: 'Rp70.000',
    },
  ];

  successCases.forEach((tc, idx) => {
    it(`[${idx + 1}/20] anaphora: "${tc.q}" → ${tc.expectPrice} (${tc.expectName})`, async () => {
      const scenario = await createAnaphoraScenario(nextPhone(), `Bunda Tes ${idx + 1}`);
      for (const s of tc.seeds) await seedAssistantMessage(scenario.conversation.id, s);

      await runTurn(scenario, tc.q);

      const reply = joinedReply(scenario.client);
      expect(reply).toContain(tc.expectPrice);
      expect(reply).toContain(tc.expectName);
      expect(reply).not.toContain('pricelist dari kami');
      expect(mocks.sendImage).not.toHaveBeenCalled();
    });
  });

  // =====================================================================
  // B. 6 SKENARIO REGRESI / EDGE
  // =====================================================================

  it('[15/20] tanpa riwayat → pricelist generik, BUKAN harga spesifik', async () => {
    const scenario = await createAnaphoraScenario(nextPhone(), 'Bunda Tanpa Riwayat');

    await runTurn(scenario, 'berapa itu bund ?');

    const reply = joinedReply(scenario.client);
    expect(reply).toContain('pricelist dari kami');
    expect(reply).not.toMatch(/Rp\s?\d/);
    expect(mocks.sendImage).toHaveBeenCalled();
  });

  it('[16/20] pricelist sudah terkirim + anaphora → harga spesifik tanpa kirim ulang gambar', async () => {
    const scenario = await createAnaphoraScenario(nextPhone(), 'Bunda Sudah Kirim');
    scenario.customer.pricelist_sent = true;
    await seedAssistantMessage(scenario.conversation.id, 'Kami rekomendasikan Pijat Bayi Pulih Ceria.');

    await runTurn(scenario, 'berapa itu bund ?');

    const reply = joinedReply(scenario.client);
    expect(reply).toContain('Rp70.000');
    expect(reply).toContain('Pijat Bayi Pulih Ceria');
    expect(mocks.sendImage).not.toHaveBeenCalled();
  });

  it('[17/20] nama treatment eksplisit tanpa riwayat → harga langsung (direct-search)', async () => {
    const scenario = await createAnaphoraScenario(nextPhone(), 'Bunda Eksplisit');

    await runTurn(scenario, 'pijat bayi pulih ceria harganya berapa?');

    const reply = joinedReply(scenario.client);
    expect(reply).toContain('Rp70.000');
    expect(reply).toContain('Pijat Bayi Pulih Ceria');
    expect(reply).not.toContain('pricelist dari kami');
  });

  it('[18/20] "jam buka berapa?" → BUKAN jawaban harga (guard jadwal)', async () => {
    const scenario = await createAnaphoraScenario(nextPhone(), 'Bunda Jam Buka');
    await seedAssistantMessage(scenario.conversation.id, 'Kami rekomendasikan Pijat Bayi Pulih Ceria.');

    let sentTexts: string[] = [];
    try {
      await runTurn(scenario, 'jam buka berapa?');
      sentTexts = scenario.client.sentTexts;
    } catch {
      // bila di-escalate senyap, tanpa balasan — tetap valid (bukan harga)
    }

    const reply = sentTexts.join('\n');
    expect(reply).not.toMatch(/Rp\s?\d/);
    expect(mocks.sendImage).not.toHaveBeenCalled();
  });

  it('[19/20] pesan assistant terbaru tanpa treatment, yg lebih lama ada → resolve dari yg lama', async () => {
    const scenario = await createAnaphoraScenario(nextPhone(), 'Bunda Riwayat Campur');
    await seedAssistantMessage(scenario.conversation.id, 'Kami ada Pijat Bayi Ceria ya bund');
    await seedAssistantMessage(scenario.conversation.id, 'Sama-sama kak');

    await runTurn(scenario, 'itu berapa ya bund?');

    const reply = joinedReply(scenario.client);
    expect(reply).toContain('Rp60.000');
    expect(reply).toContain('Pijat Bayi Ceria');
    expect(reply).not.toContain('pricelist dari kami');
  });

  it('[20/20] minta pricelist ulang ("tidak terkirim") → force kirim ulang gambar walau ada kandidat', async () => {
    const scenario = await createAnaphoraScenario(nextPhone(), 'Bunda Pricelist Hilang');
    scenario.customer.pricelist_sent = true;
    await seedAssistantMessage(scenario.conversation.id, 'Kami rekomendasikan Pijat Bayi Pulih Ceria.');

    await runTurn(scenario, 'pricelist tidak terkirim bund');

    const reply = joinedReply(scenario.client);
    expect(reply).toContain('pricelist dari kami');
    expect(mocks.sendImage).toHaveBeenCalled();
  });
});

describe('CTA CONSENT — afirmasi setelah "Mau coba X bunda ?" → form reservasi', () => {
  beforeEach(() => {
    mocks.sendImage.mockClear();
  });

  const ctaConsentCases: Array<{ cta: string; reply: string }> = [
    { cta: 'Mau coba Prenatal Massage bunda ?', reply: 'boleh bund' },
    { cta: 'Mau coba Pijat Bayi Ceria bunda ?', reply: 'iya kak' },
    { cta: 'Mau coba Oksitosin Massage bunda ?', reply: 'mau dong' },
    // kata afirmasi yang TIDAK dikenali legacy rule-based (gas/siap/insya allah/lanjut)
    // → membuktikan yang menangkap adalah GATE CTA, bukan path intent biasa.
    { cta: 'Mau coba Pijat Lahap Juara bunda ?', reply: 'gas bund' },
    { cta: 'Mau coba Pijat Bayi Pulih Ceria bunda ?', reply: 'siap kak' },
    { cta: 'Mau coba Breast + Oksitoksin Fullbody Massage bunda ?', reply: 'insya allah bund' },
    { cta: 'Mau coba Pijat Kids Ceria bunda ?', reply: 'lanjut bun' },
  ];

  ctaConsentCases.forEach((tc, idx) => {
    it(`[CTA+${idx + 1}] "${tc.cta}" → "${tc.reply}" → form reservasi`, async () => {
      const scenario = await createAnaphoraScenario(nextPhone(), `Bunda CTA ${idx + 1}`);
      await seedAssistantMessage(scenario.conversation.id, tc.cta);

      await runTurn(scenario, tc.reply);

      const reply = joinedReply(scenario.client);
      expect(reply).toContain('Berikut list untuk reservasi');
      expect(reply).not.toContain('tertarik untuk lanjut mengisi');
    });
  });

  it('[CTA-] "ga jadi deh" setelah CTA → BUKAN form (negasi)', async () => {
    const scenario = await createAnaphoraScenario(nextPhone(), 'Bunda CTA Negasi');
    await seedAssistantMessage(scenario.conversation.id, 'Mau coba Prenatal Massage bunda ?');

    await runTurn(scenario, 'ga jadi deh bund');

    const reply = joinedReply(scenario.client);
    expect(reply).not.toContain('Berikut list untuk reservasi');
  });

  it('[CTA-] tanya harga setelah CTA → tetap jawab harga, bukan form', async () => {
    const scenario = await createAnaphoraScenario(nextPhone(), 'Bunda CTA Harga');
    await seedAssistantMessage(scenario.conversation.id, 'Mau coba Prenatal Massage bunda ?');

    await runTurn(scenario, 'harga prenatal berapa?');

    const reply = joinedReply(scenario.client);
    expect(reply).toMatch(/Rp\s?\d/);
    expect(reply).not.toContain('Berikut list untuk reservasi');
  });

  it('[CTA-] jadwal setelah CTA → BUKAN form (blocker jadwal)', async () => {
    const scenario = await createAnaphoraScenario(nextPhone(), 'Bunda CTA Jadwal');
    await seedAssistantMessage(scenario.conversation.id, 'Mau coba Prenatal Massage bunda ?');

    await runTurn(scenario, 'hari senin bisa?');

    const reply = joinedReply(scenario.client);
    expect(reply).not.toContain('Berikut list untuk reservasi');
  });

  it('[CTA-] pesan terakhir BUKAN CTA → afirmasi tetap lewat intent biasa', async () => {
    const scenario = await createAnaphoraScenario(nextPhone(), 'Bunda Non CTA');
    await seedAssistantMessage(scenario.conversation.id, 'Pijat Bayi Ceria cocok buat si kecil.');

    await runTurn(scenario, 'boleh bund');

    const reply = joinedReply(scenario.client);
    // tanpa CTA, "boleh bund" offline terdeteksi intent interested → form (perilaku lama, bukan gate)
    expect(reply).toContain('Berikut list untuk reservasi');
  });
});

// Menjaga agar helper type dipakai (impor murni type tidak ikut bundle saat runtime check).
void CapturingWAHAClient;
void AnaphoraScenario;
void wahaClient;
