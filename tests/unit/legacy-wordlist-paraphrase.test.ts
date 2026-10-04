import { describe, it, expect } from 'vitest';
import { detectVisitTimeQuestion } from '../../src/v3/agent/pipeline/guardrail-pipeline';
import {
  hasBookingCommitSignal,
  isConsultativeUserText,
  isAvailabilityInquiryText,
  DAY_EVIDENCE_WORDS,
} from '../../src/utils/date-confirmation';
import { extractFastIntents } from '../../src/v3/agent/persona';

/**
 * Fase 3 — kontrak ketahanan parafrase untuk daftar kata/sinyal LAMA.
 * Tujuan: mengunci perilaku yang diharapkan pada ragam bahasa nyata (typo,
 * slang, tanpa '?', urutan beda). Ini murni TES — kode lama DILARANG diubah
 * di fase ini; temuan celah dicatat ke docs/KNOWN_ISSUES.md, bukan dipatch
 * di sini.
 */
const has = (arr: string[], x: string): boolean => arr.includes(x);

describe('Fase 3 — legacy wordlist paraphrase resilience', () => {
  describe('detectVisitTimeQuestion', () => {
    it('menangkap ragam pertanyaan JAM (true)', () => {
      for (const t of ['mau jam berapa ya', 'jam berapa enaknya', 'pukul berapa bisa', 'konfirmasi jam kunjungan', 'jam kedatangan']) {
        expect(detectVisitTimeQuestion(t), t).toBe(true);
      }
    });
    it('tidak false-positive pada pertanyaan hari/topik lain (false)', () => {
      for (const t of ['hari apa ya bunda', 'besok bisa', 'jam operasional berapa', 'mau treatment apa']) {
        expect(detectVisitTimeQuestion(t), t).toBe(false);
      }
    });
  });

  describe('hasBookingCommitSignal', () => {
    it('menangkap ragam komitmen (true)', () => {
      for (const t of ['mau ambil yang ceria', 'boleh deh yang itu', 'sesuai rekomendasi', 'yang tadi aja', 'ambil yang tadi', 'saya booking sekarang']) {
        expect(hasBookingCommitSignal(t), t).toBe(true);
      }
    });
    it('tidak menganggap pertanyaan/penundaan sebagai komitmen (false)', () => {
      for (const t of ['berapa harganya', 'apakah bisa', 'nanti saya pikir dulu', 'boleh tanya dulu?']) {
        expect(hasBookingCommitSignal(t), t).toBe(false);
      }
    });
  });

  describe('isConsultativeUserText', () => {
    it('konsultasi murni (true)', () => {
      for (const t of ['ini bisa untuk asi?', 'oksitosin itu apa ya?', 'boleh dipijat gak?']) {
        expect(isConsultativeUserText(t), t).toBe(true);
      }
    });
    it('bukan konsultasi bila komitmen/hari (false)', () => {
      for (const t of ['mau ambil yang ceria', 'besok bisa?']) {
        expect(isConsultativeUserText(t), t).toBe(false);
      }
    });
  });

  describe('isAvailabilityInquiryText', () => {
    it('pertanyaan ketersediaan tanpa ? (true)', () => {
      for (const t of ['sabtu jam 10 kosong gak', 'ada slot besok', 'masih ada jadwal?']) {
        expect(isAvailabilityInquiryText(t), t).toBe(true);
      }
    });
    it('bukan pertanyaan ketersediaan (false)', () => {
      for (const t of ['mau ambil pijat ceria', 'terima kasih ya']) {
        expect(isAvailabilityInquiryText(t), t).toBe(false);
      }
    });
  });

  describe('extractFastIntents — harga vs durasi/usia', () => {
    it('mendeteksi ask_price pada ragam nominal/biaya (true)', () => {
      for (const t of ['harganya berapa?', 'brp biayanya', 'pijat ceria berapa', '60rb dapat apa', 'ongkir ke waru brp']) {
        expect(has(extractFastIntents(t), 'ask_price'), t).toBe(true);
      }
    });
    it('BUKAN harga saat satuan non-moneter (false)', () => {
      for (const t of ['berapa menit pijatnya', 'usia berapa minimal boleh', 'hamil berapa minggu']) {
        expect(has(extractFastIntents(t), 'ask_price'), t).toBe(false);
      }
    });
  });

  describe('DAY_EVIDENCE_WORDS seam', () => {
    it('memuat hari & penanda relatif (tanpa daftar baru)', () => {
      expect(DAY_EVIDENCE_WORDS).toContain('selasa');
      expect(DAY_EVIDENCE_WORDS).toContain('besok');
      expect(DAY_EVIDENCE_WORDS).toContain('hari ini');
    });
  });
});
