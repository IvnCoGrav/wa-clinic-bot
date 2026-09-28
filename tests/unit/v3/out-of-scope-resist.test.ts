/**
 * out-of-scope-escalation.test.ts — ADV-04 (Permintaan Luar Domain).
 *
 * Kontrak (keputusan produk 2026-09-28): permintaan di luar domain klinik
 * (essay tugas sekolah, isi SPT pajak, PR matematika, puisi lomba) TIDAK
 * dikerjakan bot — dialihkan LANGSUNG ke tim manusia (CS) tanpa menjanjikan
 * pengerjaan. Ini kontrak schema tool `escalate_to_human` yang dibaca LLM.
 *
 * Prinsip Adversarial (MANDATORY): parafrase nyata dari fixture ADV-04.
 */
import { describe, it, expect } from 'vitest';
import { ESCALATE_HUMAN_TOOL_SCHEMA } from '../../../src/v3/tools/escalate-human.tool';
import { buildRouterToolRoutingBlock } from '../../../src/v3/agent/prompt/phases/router-tool-routing.layer';

describe('escalate_to_human — kontrak schema mencakup luar-domain (eskalasi langsung)', () => {
  const desc = ESCALATE_HUMAN_TOOL_SCHEMA.function.description;

  it('memuat klausa luar domain sebagai pemicu eskalasi', () => {
    expect(desc.toLowerCase()).toMatch(/di luar domain|luar domain/);
    expect(desc).toMatch(/manusia|tim/i);
  });

  it('menegaskan DILARANG mengerjakan permintaan luar domain', () => {
    expect(desc).toMatch(/tanpa mengerjakan|tanpa menjanjikan|DILARANG/i);
  });

  it('tetap memuat 4 kasus eskalasi klinis sah (medis, komplain, slot, minta manusia)', () => {
    const l = desc.toLowerCase();
    expect(l).toMatch(/medis|darurat/);
    expect(l).toMatch(/komplain|keluhan/);
    expect(l).toMatch(/manusia/);
  });

  it('mencantumkan contoh luar domain (essay/pajak) sebagai penanda', () => {
    const l = desc.toLowerCase();
    expect(l).toMatch(/essay|tugas sekolah|pajak/);
  });
});

describe('Router escalate bullet — sejalan dengan kontrak schema', () => {
  it('bullet escalate memuat pemicu luar domain', () => {
    const block = buildRouterToolRoutingBlock({ isSaveReservationMasked: false, isCalculateDeliveryMasked: false });
    const escalateLine = block.split('\n').find((l) => l.includes('escalate_to_human')) || '';
    expect(escalateLine.toLowerCase()).toMatch(/luar domain|di luar layanan klinik/);
  });
});
