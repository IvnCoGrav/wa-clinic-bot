import { describe, it, expect, beforeEach } from 'vitest';
import { FastResponseGate } from '../../src/v3/agent/pipeline/fast-response-gate';
import {
  __setMemoryCatchers,
  __clearMemoryCatchers,
} from '../../src/services/ctwa-text-catcher.service';
import { TEMPLATES } from '../../src/config/persona';

/**
 * Fase 3 (Revisi Turn-0): FastResponseGate membalas statis hanya bila lolos
 * filter bahaya + (CTWA ketat ATAU sapaan generik). Negatif bahaya wajib
 * handled:false (diteruskan ke LLM/tool).
 */
const gate = (text: string, isFollowUp = false) => FastResponseGate.check({
  tenantId: 'default-tenant',
  conversationId: 'conv-1',
  phone: '6281111111111',
  incomingText: text,
  originalText: text,
  cleanIncomingText: text,
  skipDbLogging: true,
  isFollowUp,
  session: { genderGreeting: 'Bunda' } as any,
  currentSystemPrompt: '',
  fewShotExemplars: [],
});

describe('Turn-0 CTWA / generic greeting fast-gate (revisi)', () => {
  beforeEach(() => __clearMemoryCatchers());

  it('CTWA exact match (keyakinan tinggi) → balasan statis', async () => {
    __setMemoryCatchers('default-tenant', [{
      id: 'cat-1', tenant_id: 'default-tenant', campaign_name: 'ADS-IG',
      source: 'instagram', medium: 'ctwa',
      greetings: ['Hallo Bu Bidan, Saya mau booking home service. Bagaimana Caranya ?'],
      anchor_keywords: ['booking'], similarity_threshold: 0.7, is_active: true, notes: null,
    }]);
    const res = await gate('Hallo Bu Bidan, Saya mau booking home service. Bagaimana Caranya ?');
    expect(res.handled).toBe(true);
    if (res.handled) {
      expect(res.output.replyText).toContain('Bidan Yusi');
      expect(res.output.executedTools).toEqual([]);
    }
  });

  it('sapaan generik non-CTWA → balasan statis', async () => {
    const res = await gate('Halo Bu Bidan');
    expect(res.handled).toBe(true);
    if (res.handled) expect(res.output.replyText).toBe(TEMPLATES.greeting({ isIslamic: false }));
  });

  it('salam Islami generik → balasan statis "Waalaikumsalam"', async () => {
    const res = await gate('Assalamualaikum Bu Bidan');
    expect(res.handled).toBe(true);
    if (res.handled) expect(res.output.replyText.startsWith('Waalaikumsalam Bunda')).toBe(true);
  });

  it('NEGATIF bahaya: keluhan medis → handled false (ke LLM)', async () => {
    const res = await gate('Halo bu bidan anak saya batuk pilek 3 hari');
    expect(res.handled).toBe(false);
  });

  it('NEGATIF bahaya: lokasi presisi → handled false (ke geocoder/tool)', async () => {
    const res = await gate('Halo mau booking untuk daerah Tropodo Waru');
    expect(res.handled).toBe(false);
  });

  it('NEGATIF bahaya: harga spesifik → handled false (ke katalog)', async () => {
    const res = await gate('Halo berapa harga paket selapan?');
    expect(res.handled).toBe(false);
  });

  it('NEGATIF bahaya: jadwal spesifik → handled false (ke cek jadwal)', async () => {
    const res = await gate('Halo besok sabtu jam 10 pagi bisa homecare?');
    expect(res.handled).toBe(false);
  });

  it('follow-up tidak pernah dibalas statis oleh gate ini', async () => {
    const res = await gate('Halo Bu Bidan', true);
    expect(res.handled).toBe(false);
  });
});
