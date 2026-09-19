import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { DeliveryFastPath } from '../../../src/v3/agent/pipeline/delivery-fast-path';
import { executeCalculateDelivery } from '../../../src/v3/tools/calculate-delivery.tool';
import { V3AgentRunner } from '../../../src/v3/agent/agent-runner';
import { TEMPLATES } from '../../../src/config/persona';

vi.mock('axios');

/**
 * Gerbang Deterministik Balasan Lokasi Murni (Deterministic Fast SOP):
 * giliran yang HANYA menjawab lokasi via calculate_delivery dibalas dengan
 * suggestedTemplateReply resmi tanpa Call 2 LLM. Giliran campuran (keluhan /
 * jadwal / paket / trauma / vaksin) WAJIB fail-open ke Call 2.
 */
describe('DeliveryFastPath gate (pure function)', () => {
  const stub = (template: any, success = true) => ([{
    name: 'calculate_delivery',
    args: { locationText: 'bungurasih' },
    result: {
      success, kelurahan: 'Bungurasih', kecamatan: 'Waru',
      distanceKm: 5.51, ongkirNormal: 15000, ongkirPromo: 5000,
      suggestedTemplateReply: template,
      message: 'Area Bungurasih masuk dalam area jangkauan layanan homecare Bidan kami (5.51 km).',
    },
  }] as any);

  const SOP = 'Jika dilihat dari jaraknya kurang lebih 5.5 km. Dari pricelist kami di jarak ini ada tambahan ongkir *Rp 15.000* tetapi karna bulan ini ada promo, kami bisa kasih bunda ongkir menjadi *Rp 5.000* saja bunda. Jadi bisa ya bunda';

  it.each([
    'bungurasih',
    'bungurasih kak',
    'Bungurasih Sidoarjo ya kak',
    'di bungurasih kak',
  ])('lokasi murni "%s" + template → eligible', (text) => {
    const r = DeliveryFastPath.evaluate({ executedTools: stub(SOP), cleanIncomingText: text, isFollowUp: true });
    expect(r.eligible).toBe(true);
    expect(r.reply).toContain('Jika dilihat dari jaraknya');
  });

  it('tanya ongkir eksplisit "bungurasih berapa?" → eligible (jawaban ongkir tepat)', () => {
    const r = DeliveryFastPath.evaluate({ executedTools: stub(SOP), cleanIncomingText: 'bungurasih berapa?', isFollowUp: true });
    expect(r.eligible).toBe(true);
  });

  it.each([
    'bungurasih kak, ada pijat bapil?',
    'bungurasih, bayiku demam',
    'bungurasih, anak rewel terus',
  ])('keluhan medis "%s" → fail-open Call 2', (text) => {
    const r = DeliveryFastPath.evaluate({ executedTools: stub(SOP), cleanIncomingText: text, isFollowUp: true });
    expect(r.eligible).toBe(false);
  });

  it.each([
    'bungurasih, besok bisa?',
    'bungurasih kak, kapan jadwal kosong?',
    'kalau sekarang apakah bisa ke bungurasih?',
  ])('pertanyaan jadwal "%s" → fail-open Call 2', (text) => {
    const r = DeliveryFastPath.evaluate({ executedTools: stub(SOP), cleanIncomingText: text, isFollowUp: true });
    expect(r.eligible).toBe(false);
  });

  it('durasi "bungurasih, durasi pijat berapa menit?" → fail-open Call 2', () => {
    const r = DeliveryFastPath.evaluate({ executedTools: stub(SOP), cleanIncomingText: 'bungurasih, durasi pijat berapa menit?', isFollowUp: true });
    expect(r.eligible).toBe(false);
  });

  it('sinyal vaksin & trauma → fail-open Call 2', () => {
    expect(DeliveryFastPath.evaluate({ executedTools: stub(SOP), cleanIncomingText: 'bungurasih, anak habis imunisasi boleh pijat?', isFollowUp: true }).eligible).toBe(false);
    expect(DeliveryFastPath.evaluate({ executedTools: stub(SOP), cleanIncomingText: 'bungurasih, bayi jatuh dari kasur', isFollowUp: true }).eligible).toBe(false);
  });

  it('sebutan nama katalog "bungurasih, ada paket laktasi?" → fail-open Call 2', () => {
    const r = DeliveryFastPath.evaluate({ executedTools: stub(SOP), cleanIncomingText: 'bungurasih, ada paket laktasi?', isFollowUp: true });
    expect(r.eligible).toBe(false);
  });

  it('tanpa template (wilayah luas generik) → fail-open Call 2', () => {
    const r = DeliveryFastPath.evaluate({ executedTools: stub(undefined, false), cleanIncomingText: 'bungurasih', isFollowUp: true });
    expect(r.eligible).toBe(false);
  });

  it('multi-tool (delivery + katalog) → fail-open Call 2', () => {
    const tools = [...stub(SOP), { name: 'get_catalog_and_price', args: {}, result: { success: true, treatments: [] } }] as any;
    const r = DeliveryFastPath.evaluate({ executedTools: tools, cleanIncomingText: 'bungurasih kak, ada pijat bapil?', isFollowUp: true });
    expect(r.eligible).toBe(false);
  });

  it('Turn-0: header sapaan resmi di-prepend; follow-up: template telanjang', () => {
    const turn0 = DeliveryFastPath.evaluate({ executedTools: stub(SOP), cleanIncomingText: 'bungurasih kak', isFollowUp: false });
    expect(turn0.eligible).toBe(true);
    expect(turn0.reply).toContain('Perkenalkan, saya Bidan Yusi');
    expect(turn0.reply).toContain('Jika dilihat dari jaraknya');
    const follow = DeliveryFastPath.evaluate({ executedTools: stub(SOP), cleanIncomingText: 'bungurasih kak', isFollowUp: true });
    expect(follow.reply).not.toContain('Perkenalkan, saya Bidan Yusi');
  });

  it('salam Islami Turn-0 → header Waalaikumsalam', () => {
    const r = DeliveryFastPath.evaluate({ executedTools: stub(SOP), cleanIncomingText: 'assalamualaikum, saya di bungurasih', isFollowUp: false });
    expect(r.eligible).toBe(true);
    expect(r.reply.startsWith('Waalaikumsalam Bunda')).toBe(true);
  });
});

describe('Tool enrichment: cabang ambigu membawa suggestedTemplateReply', () => {
  it('"Menganti Gresik" (kecamatan luas) → template minta kelurahan, tanpa nominal', async () => {
    const res = await executeCalculateDelivery({ locationText: 'Menganti Gresik' });
    expect(res.isPrecise).toBe(false);
    expect(res.suggestedTemplateReply).toMatch(/kelurahan/i);
    expect(res.suggestedTemplateReply).not.toMatch(/Rp\s*[\d.]+/);
  });

  it('"Driyorejo Gresik" (kecamatan) → template minta kelurahan', async () => {
    const res = await executeCalculateDelivery({ locationText: 'Driyorejo Gresik' });
    expect(res.isPrecise).toBe(false);
    expect(res.suggestedTemplateReply).toMatch(/kelurahan/i);
  });
});

describe('Agent-runner integration: bypass Call 2 pada lokasi murni', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const call1Delivery = (locationText: string) => ({
    data: {
      choices: [{
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call-d1',
            type: 'function',
            function: { name: 'calculate_delivery', arguments: JSON.stringify({ locationText }) },
          }],
        },
      }],
    },
  });

  it('pure "bungurasih kak" (follow-up) → tepat 1 axios call, balasan template, tanpa basecamp', async () => {
    (axios.post as any).mockResolvedValueOnce(call1Delivery('bungurasih kak'));
    const result = await V3AgentRunner.processMessage({
      customerId: 'mock-fast-1',
      conversationId: 'mock-fast-conv-1',
      phone: '6287777777711',
      chatId: '6287777777711@c.us',
      incomingText: 'bungurasih kak',
      history: [
        { role: 'user', content: 'halo' },
        { role: 'assistant', content: TEMPLATES.greeting({ isIslamic: false }) },
      ],
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(result.replyText).toContain('Jika dilihat dari jaraknya');
    expect(result.replyText.toLowerCase()).not.toContain('basecamp');
    expect(result.executedTools.map((t) => t.name)).toEqual(['calculate_delivery']);
  });

  it('compound "bungurasih kak, ada pijat bapil?" → Call 2 tetap jalan (fail-open)', async () => {
    (axios.post as any)
      .mockResolvedValueOnce(call1Delivery('bungurasih kak'))
      .mockResolvedValueOnce({ data: { choices: [{ message: { role: 'assistant', content: 'MOCK CALL2 REPLY' } }] } });
    const result = await V3AgentRunner.processMessage({
      customerId: 'mock-fast-2',
      conversationId: 'mock-fast-conv-2',
      phone: '6287777777722',
      chatId: '6287777777722@c.us',
      incomingText: 'bungurasih kak, ada pijat bapil?',
      history: [
        { role: 'user', content: 'halo' },
        { role: 'assistant', content: TEMPLATES.greeting({ isIslamic: false }) },
      ],
    });
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(result.replyText).toContain('MOCK CALL2 REPLY');
  });
});
