import { describe, it, expect } from 'vitest';
import { ContextGrounder } from '../../../src/v3/agent/pipeline/context-grounder';
import type { CustomerGoalSession } from '../../../src/v3/state/goal-tracker';

/**
 * TAHAP 2 — Context Schedule & Duration Governance (sesi 951450).
 *
 * Menguji bahwa buildContextSummary:
 * 1. Anti-todong usia saat negosiasi jadwal (Rule 4)
 * 2. Statement-only durasi tanpa todong treatment (Kondisi C)
 * 3. Anti-amnesia: tidak menanyakan data yang sudah ada
 */

const baseSession: CustomerGoalSession = {
  customerName: 'Bunda Sari',
  genderGreeting: 'Bunda',
};

describe('Context Schedule & Duration Governance (TAHAP 2)', () => {
  // ─── 1. Anti-Todong Usia Saat Negosiasi Jadwal ───

  describe('Anti-age solicitation saat jadwal (Rule 4)', () => {
    it('customer sebut hari → janganDiulang memuat larangan tanya usia', () => {
      const summary = ContextGrounder.buildContextSummary(
        baseSession,
        'Senin bisa kak?',
        [{ role: 'user', content: 'Halo kak' }, { role: 'assistant', content: 'Halo Bunda!' }]
      );
      expect(summary).toContain('usia');
      expect(summary).toContain('DILARANG');
    });

    it('yangPerluDijawab memuat aturan 4 (dilarang menodong usia)', () => {
      const summary = ContextGrounder.buildContextSummary(
        baseSession,
        'Besok ada slot gak?',
        []
      );
      expect(summary).toContain('DILARANG menanyakan usia');
    });

    it('customer tanya "jadwal sabtu" → fokus pada konfirmasi cek jadwal, bukan usia', () => {
      const summary = ContextGrounder.buildContextSummary(
        baseSession,
        'Jadwal sabtu ada?',
        [{ role: 'assistant', content: 'Rumah Bunda di daerah mana ya?' }]
      );
      expect(summary).toContain('cekkan/infokan');
      expect(summary.toLowerCase()).not.toMatch(/menanyakan usia.*si kecil.*karena.*bunda.*menyebutkan hari/);
    });
  });

  // ─── 2. Statement-Only Durasi (Kondisi C) ───

  describe('Statement-only durasi (Kondisi C)', () => {
    it('customer tanya durasi → yangPerluDijawab statement-only, tanpa pertanyaan', () => {
      const summary = ContextGrounder.buildContextSummary(
        baseSession,
        'Untuk pijat bayi biasanya brp menit kak',
        []
      );
      expect(summary).toContain('STATEMENT-ONLY');
      expect(summary).toContain('TUTUP TANPA PERTANYAAN');
    });

    it('janganDiulang memuat larangan "mau rencana ambil treatment apa"', () => {
      const summary = ContextGrounder.buildContextSummary(
        baseSession,
        'Pijat bayi berapa lama durasinya?',
        []
      );
      expect(summary).toContain('mau rencana ambil treatment apa');
    });

    it('durasi + nominal (komposit) → paket belum dipilih, tidak menodong jadwal', () => {
      const summary = ContextGrounder.buildContextSummary(
        baseSession,
        '100rb berapa menit pijetnya',
        []
      );
      // Karena ada nominal token → masuk branch komposit, bukan branch durasi murni
      expect(summary).toContain('nominal');
    });
  });

  // ─── 3. Anti-Amnesia & Cool-Off ───

  describe('Anti-amnesia & cool-off', () => {
    it('lokasi baru ditanya assistant (keyword "rumahnya dimana") → cool-off terpicu, ada larangan tanya ulang', () => {
      // Cool-off (conversation-summarizer.ts:206) hanya untuk user yang BELUM menjawab lokasi
      // (userAnsweredLocation → skip by-design, fokus lanjut ke kelurahan). Skenario: user alihkan ke harga.
      const summary = ContextGrounder.buildContextSummary(
        baseSession,
        'Harganya berapa kak',
        [
          { role: 'assistant', content: 'Kalau boleh tahu rumahnya dimana ya Bunda?' },
          { role: 'user', content: 'Harganya berapa kak' },
        ]
      );
      // Cool-off terpicu → ada larangan tanya ulang lokasi di janganDiulang
      expect(summary).toContain('alamat/kelurahan rumah Bunda lagi');
    });

    it('jadwal baru ditanya assistant → janganDiulang memuat larangan tanya ulang', () => {
      const summary = ContextGrounder.buildContextSummary(
        baseSession,
        'Oke kak',
        [
          { role: 'assistant', content: 'Rencana mau kami bantu jadwalkan di hari apa ya Bunda?' },
          { role: 'user', content: 'Oke kak' },
        ]
      );
      expect(summary).toContain('hari apa');
    });
  });

  // ─── 4. Kecamatan vs Kelurahan Governance ───

  describe('Kecamatan vs Kelurahan routing', () => {
    it('lokasi sudah ada di session → sudahDibahas memuat lokasi', () => {
      const summary = ContextGrounder.buildContextSummary(
        { ...baseSession, location: { kelurahan: 'Sedati', distanceKm: 10 } as any },
        'Di Sedati kak',
        []
      );
      expect(summary).toContain('Lokasi');
      expect(summary).toContain('Sedati');
    });

    it('kelurahan + treatment sudah ada di session → sudahDibahas memuat keduanya', () => {
      const summary = ContextGrounder.buildContextSummary(
        { ...baseSession, selectedTreatment: 'Pijat Bayi Ceria', location: { kelurahan: 'Pepe', distanceKm: 5 } as any },
        'Sedati Pepe',
        []
      );
      expect(summary).toContain('Treatment');
      expect(summary).toContain('Pijat Bayi Ceria');
      expect(summary).toContain('Lokasi');
    });
  });
});
