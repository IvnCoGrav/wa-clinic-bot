import { describe, it, expect } from 'vitest';
import {
  executeGetCatalog,
  GET_CATALOG_TOOL_SCHEMA,
} from '../../src/v3/tools/get-catalog.tool';

/**
 * AI-First Tool Grounding: nominal rupiah hanya mengalir ke prompt LLM bila
 * inquirePrice === true. Tanpa itu, tool result bebas angka (LLM tidak
 * dipancing memuntahkan harga) — downstream tidak lagi memutilasi kalimat.
 * Offline: katalog in-memory, tanpa DB/network.
 */
describe('get_catalog_and_price — AI-First Price Grounding', () => {
  it('schema mengekspos parameter inquirePrice untuk LLM', () => {
    const props = (GET_CATALOG_TOOL_SCHEMA as any).function.parameters.properties;
    expect(props.inquirePrice).toBeDefined();
    expect(props.inquirePrice.type).toBe('boolean');
  });

  it('inquirePrice=false: message & summaryList bebas nominal Rp, tanpa suggestedPriceReply', async () => {
    const out = await executeGetCatalog({ symptoms: ['batuk', 'pilek'] });
    expect(out.success).toBe(true);
    expect(out.message).not.toMatch(/Rp\s*[\d.]+/);
    expect(out.message).not.toContain('Promo *Rp');
    expect(out.recommendationReason ?? '').not.toMatch(/Rp\s*[\d.]+/);
    expect(out.suggestedPriceReply).toBeUndefined();
    // Konteks non-harga tetap informatif: nama paket + rincian manfaat.
    expect(out.message).toContain('Pijat Bayi Pulih Ceria');
    expect(out.message).toContain('Catatan Rekomendasi');
    expect(out.message).not.toContain('ber-STR aktif');
  });

  it('inquirePrice=true: harga promo & normal dinamis + suggestedPriceReply terstruktur', async () => {
    const out = await executeGetCatalog({
      symptoms: ['batuk', 'pilek'],
      specificTreatmentName: 'Pulih Ceria',
      inquirePrice: true,
    });
    expect(out.success).toBe(true);
    expect(out.message).toMatch(/Rp\s*[\d.]+/);
    expect(out.message).toContain('Pijat Bayi Pulih Ceria');
    expect(out.suggestedPriceReply).toBeDefined();
    expect(out.suggestedPriceReply!).toMatch(/Rp\s*[\d.]+/);
  });

  it('inquirePrice=true pada relaksasi: konfirmasi nominal 60rb didukung data dinamis', async () => {
    const out = await executeGetCatalog({
      specificTreatmentName: 'Pijat Bayi Ceria',
      inquirePrice: true,
    });
    expect(out.success).toBe(true);
    expect(out.message).toMatch(/Rp\s*60\.000/);
    expect(out.suggestedPriceReply).toBeDefined();
  });

  it('tanpa gejala & tanpa inquirePrice: tidak ada harga bocor ke prompt', async () => {
    const out = await executeGetCatalog({ childAgeMonths: 1 });
    expect(out.success).toBe(true);
    expect(out.message).not.toMatch(/Rp\s*[\d.]+/);
    expect(out.suggestedPriceReply).toBeUndefined();
  });
});
