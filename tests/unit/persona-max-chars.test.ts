import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import fs from 'fs';
import { LLMResponseGenerator } from '../../src/integrations/llm/generator';
import {
  truncateToMaxChars,
  getMaxCharsPerReply,
  savePersonaToDb,
  BOT_PERSONA_PROMPT,
  updatePersonaInMemoryAndFile,
} from '../../src/config/persona';
import { faqCacheService } from '../../src/services/faq-cache.service';

/**
 * Unit test fitur "Maksimal karakter per balasan AI" (persona config).
 *
 * DB mock di setup.ts selalu reject ("Database offline"), jadi savePersonaToDb
 * berjalan lewat jalur fallback (update in-memory cache + file) — cocok utk
 * menguji cache & truncation tanpa DB.
 */

const TENANT = 'unit-max-chars';
const ORIGINAL_PERSONA = BOT_PERSONA_PROMPT;

describe('truncateToMaxChars (potong aman di akhir kalimat)', () => {
  it('null / undefined / 0 / negatif → teks apa adanya', () => {
    const text = 'Bunda, ini jawaban panjang. Berlanjut ya bund.';
    expect(truncateToMaxChars(text, null)).toBe(text);
    expect(truncateToMaxChars(text, undefined)).toBe(text);
    expect(truncateToMaxChars(text, 0)).toBe(text);
    expect(truncateToMaxChars(text, -5)).toBe(text);
  });

  it('teks lebih pendek dari batas → tidak diubah', () => {
    const text = 'Pendek sekali.';
    expect(truncateToMaxChars(text, 500)).toBe(text);
  });

  it('teks kosong → kosong', () => {
    expect(truncateToMaxChars('', 10)).toBe('');
  });

  it('memotong di akhir kalimat terakhir sebelum batas (tidak di tengah kalimat)', () => {
    const text = 'Kalimat satu ini panjang banget. Kalimat kedua ini juga panjang. Kalimat ketiga ini panjang juga.';
    const max = 50;
    const result = truncateToMaxChars(text, max);
    expect(result.length).toBeLessThanOrEqual(max);
    expect(result.endsWith('.')).toBe(true);
    expect(result.endsWith(' Kalimat ')).toBe(false);
  });

  it('fallback ke spasi terakhir bila tidak ada tanda baca', () => {
    const text = 'a'.repeat(30) + ' ' + 'b'.repeat(30);
    const result = truncateToMaxChars(text, 40);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result.trim().endsWith('b')).toBe(false);
    expect(result.trim().length).toBe(30);
  });

  it('tidak pernah memotong di tengah kata (selalu berakhir di pemisah)', () => {
    const text = 'satu dua tiga empat lima enam tujuh';
    const result = truncateToMaxChars(text, 9);
    expect(result).toBe('satu dua');
  });
});

describe('getMaxCharsPerReply (cache per tenant)', () => {
  beforeEach(() => {
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    updatePersonaInMemoryAndFile(ORIGINAL_PERSONA);
  });

  it('default (belum di-set) → null', () => {
    expect(getMaxCharsPerReply(TENANT)).toBeNull();
  });

  it('savePersonaToDb dengan maxChars → cache terbaca ulang', async () => {
    await savePersonaToDb('Persona test', TENANT, 500);
    expect(getMaxCharsPerReply(TENANT)).toBe(500);
  });

  it('savePersonaToDb maxChars=null → limit dinonaktifkan', async () => {
    await savePersonaToDb('Persona test', TENANT, null);
    expect(getMaxCharsPerReply(TENANT)).toBeNull();
  });

  it('savePersonaToDb tanpa maxChars → cache tidak berubah', async () => {
    await savePersonaToDb('Persona test', TENANT, 300);
    expect(getMaxCharsPerReply(TENANT)).toBe(300);

    await savePersonaToDb('Persona test v2', TENANT);
    expect(getMaxCharsPerReply(TENANT)).toBe(300);
  });
});

describe('LLM generator enforcement', () => {
  const longTextAnswer = 'Bunda, jawaban ini sengaja dibuat panjang supaya melebihi batas maksimal karakter. '.repeat(20).trim();
  const longTextJSON = JSON.stringify({
    reasoning: 'test',
    answer: longTextAnswer
  });

  beforeEach(() => {
    process.env.LLM_API_KEY = 'non-mock-test-key';
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    faqCacheService.clearMemoryCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    updatePersonaInMemoryAndFile(ORIGINAL_PERSONA);
  });

  it('system prompt memuat instruksi BATAS KARAKTER saat dikonfigurasi + jawaban ter-truncate aman', async () => {
    await savePersonaToDb('Persona test', TENANT, 500);

    let capturedBody: any = null;
    const postSpy = vi.spyOn(axios, 'post').mockImplementation(async (_url: any, body: any) => {
      capturedBody = body;
      return { status: 200, data: { choices: [{ message: { content: longTextJSON } }] } };
    });

    const generator = new LLMResponseGenerator();
    const result = await generator.generateFaqResponse('berapa harganya?', [], undefined, TENANT);

    expect(postSpy).toHaveBeenCalledTimes(1);
    const systemContent = capturedBody.messages[0].content as string;
    expect(systemContent).toContain('BATAS KARAKTER');
    expect(systemContent).toContain('500 karakter');

    expect(result.length).toBeLessThanOrEqual(500);
    expect(result.endsWith('.')).toBe(true);
  });

  it('tanpa batas (null) → jawaban panjang tetap utuh', async () => {
    await savePersonaToDb('Persona test', TENANT, null);

    const postSpy = vi.spyOn(axios, 'post').mockImplementation(async (_url: any, _body: any) => {
      return { status: 200, data: { choices: [{ message: { content: longTextJSON } }] } };
    });

    const generator = new LLMResponseGenerator();
    const result = await generator.generateFaqResponse('berapa harganya?', [], undefined, TENANT);

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(result).toBe(longTextAnswer);
  });
});
