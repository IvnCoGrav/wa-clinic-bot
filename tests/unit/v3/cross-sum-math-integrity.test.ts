import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { validateNumericFacts } from '../../../src/v3/guardrails/numeric-fact-validator';
import { attemptNumericReprompt } from '../../../src/v3/agent/pipeline/guardrail-pipeline';

vi.mock('axios');

/**
 * Phase 2+5 (sesi 214956) — Integritas matematika cross-sum:
 * 75k + 105k + 15k WAJIB 195k. Total parsial (120k) ditolak saat keranjang
 * multi-item; koreksi via re-prompt bersih (TANPA mutilasi regex).
 */
const MULTI_SESSION = {
  cartItems: [
    { price: 95000, promoPrice: 75000 },
    { price: 130000, promoPrice: 105000 },
  ],
  location: { ongkirPromo: 15000, ongkirNormal: 25000 },
};

describe('Cross-Sum Math Integrity (sesi 214956)', () => {
  it('total parsial 120k DITOLAK saat keranjang 2 item + pesan menyebut total resmi', () => {
    const reply =
      'Untuk Adik *Rp 75.000* dan Bunda *Rp 105.000* ditambah ongkir *Rp 15.000*, totalnya menjadi *Rp 120.000* ya Bunda.';
    const res = validateNumericFacts(reply, [], { tenantId: 'default-tenant', session: MULTI_SESSION as any });
    expect(res.isValid).toBe(false);
    expect(res.violations.length).toBeGreaterThan(0);
    expect(res.violations.join(' ')).toContain('195.000');
    expect(res.expectedTotals).toContain(195000);
  });

  it('total resmi 195k DITERIMA (komponen + total penuh sah)', () => {
    const reply =
      'Untuk Adik *Rp 75.000* dan Bunda *Rp 105.000* ditambah ongkir *Rp 15.000*, totalnya menjadi *Rp 195.000* ya Bunda.';
    const res = validateNumericFacts(reply, [], { tenantId: 'default-tenant', session: MULTI_SESSION as any });
    expect(res.isValid).toBe(true);
  });

  it('keranjang 1 item: kombo layanan+ongkir tetap sah (tanpa false positive)', () => {
    const reply = 'Oksitosin *Rp 105.000* + ongkir *Rp 15.000* = *Rp 120.000* ya Bunda.';
    const res = validateNumericFacts(reply, [], {
      tenantId: 'default-tenant',
      session: {
        cartItems: [{ price: 130000, promoPrice: 105000 }],
        location: { ongkirPromo: 15000, ongkirNormal: 25000 },
      } as any,
    });
    expect(res.isValid).toBe(true);
  });

  it('validator TIDAK PERNAH memutilasi teks (murni pelaporan)', () => {
    const reply = 'Totalnya *Rp 120.000* ya Bunda.';
    const before = String(reply);
    validateNumericFacts(reply, [], { tenantId: 'default-tenant', session: MULTI_SESSION as any });
    expect(reply).toBe(before);
  });

  it('attemptNumericReprompt: mengembalikan teks susunan ulang + memanggil LLM sekali', async () => {
    (axios.post as any).mockResolvedValueOnce({
      data: { choices: [{ message: { content: 'Total resmi *Rp 195.000* ya Bunda.' } }] },
    });
    const addUsage = vi.fn();
    const auditUsage = vi.fn();
    const out = await attemptNumericReprompt({
      tenantId: 'default-tenant',
      phone: '6281',
      conversationId: 'conv-x',
      baseUrl: 'https://unit.test/v1',
      apiKey: 'k',
      selectedModel: 'm',
      basePayload: { model: 'm', temperature: 0.65 },
      messages: [{ role: 'system', content: 'sys' }],
      violations: ['Nominal Rp 120.000 tidak sesuai total resmi.'],
      expectedTotals: [195000],
      addUsage,
      auditUsage,
    });
    expect(out).toContain('195.000');
    expect(axios.post).toHaveBeenCalledTimes(1);
    const sentBody = (axios.post as any).mock.calls[0][1];
    const lastMsg = sentBody.messages[sentBody.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toContain('KOREKSI FAKTA ANGKA');
    expect(lastMsg.content).toContain('195.000');
    expect(addUsage).toHaveBeenCalled();
    expect(auditUsage).toHaveBeenCalled();
  });

  it('attemptNumericReprompt: balasan kosong -> null (fallback swap mengambil alih)', async () => {
    (axios.post as any).mockResolvedValueOnce({ data: { choices: [{ message: { content: '   ' } }] } });
    const out = await attemptNumericReprompt({
      tenantId: 'default-tenant',
      phone: '6281',
      conversationId: 'conv-x',
      baseUrl: 'https://unit.test/v1',
      apiKey: 'k',
      selectedModel: 'm',
      basePayload: { model: 'm', temperature: 0.65 },
      messages: [],
      violations: ['x'],
      expectedTotals: [],
      addUsage: vi.fn(),
      auditUsage: vi.fn(),
    });
    expect(out).toBeNull();
  });
});
