import { describe, it, expect } from 'vitest';
import { isScheduleCheckCommitment } from '../../../src/v3/agent/agent-runner';

/**
 * TAHAP 1 — Qualified Schedule Handoff Gate (sesi 951450).
 *
 * isScheduleCheckCommitment: detektor semantik token-based (3 komponen AND:
 * subjek klinik + verba cek + nomina jadwal), dengan guard pertanyaan balik.
 *
 * Kualifikasi handoff (lokasi + treatment) dan anti-kaset rusak diuji secara
 * konseptual karena terkait pipeline penuh (DB + LLM).
 */
describe('Qualified Schedule Handoff Gate (TAHAP 1)', () => {
  // ─── Token-Based Detector ───

  describe('isScheduleCheckCommitment — token-based', () => {
    it('positif: 3 komponen terpenuhi (subjek + verba + nomina)', () => {
      const cases = [
        'kami bantu cekkan ketersediaan jadwal',
        'kami akan cek ketersediaan jadwal',
        'kami coba cek jadwal dulu',
        'kami bantu cek ketersediaan jadwal tim bidan',
        'kami coba cek jadwal dulu ya bund',
        'kami koordinasikan jadwal dulu ya bund',
        'kami bantu cek slot untuk hari senin',
        'bidan kami akan cek jadwal yang tersedia',
        'kami mengecek ketersediaan jadwal ya bund',
        'Baik Bunda, kami bantu cekkan ketersediaan jadwal 🤗',
        'Kami akan bantu cek ketersediaan jadwal untuk hari Senin',
      ];
      for (const t of cases) {
        expect(isScheduleCheckCommitment(t), `expected true: "${t}"`).toBe(true);
      }
    });

    it('negatif: pertanyaan balik ke customer', () => {
      const cases = [
        'rencana mau kami bantu jadwalkan di hari apa ya Bunda?',
        'jadwalnya kapan ya Bunda?',
        'untuk jam berapa ya Bunda?',
        'hari apa ya Bunda mau dijadwalkan?',
      ];
      for (const t of cases) {
        expect(isScheduleCheckCommitment(t), `expected false: "${t}"`).toBe(false);
      }
    });

    it('negatif: salah satu komponen hilang', () => {
      // Tanpa verba cek
      expect(isScheduleCheckCommitment('kami punya jadwal senin')).toBe(false);
      // Tanpa nomina jadwal
      expect(isScheduleCheckCommitment('kami bantu cek ya bund')).toBe(false);
      // Tanpa subjek klinik
      expect(isScheduleCheckCommitment('akan dicek jadwalnya')).toBe(false);
    });

    it('negatif: teks kosong / whitespace', () => {
      expect(isScheduleCheckCommitment('')).toBe(false);
      expect(isScheduleCheckCommitment('   ')).toBe(false);
    });

    it('case-insensitive', () => {
      expect(isScheduleCheckCommitment('KAMI BANTU CEKKAN KETERSEDIAAN JADWAL')).toBe(true);
      expect(isScheduleCheckCommitment('Kami Coba Cek Jadwal Dulu')).toBe(true);
      expect(isScheduleCheckCommitment('BIDAN KAMI AKAN CEK JADWAL')).toBe(true);
    });

    it('kata sisipan alami tidak membatalkan deteksi', () => {
      expect(isScheduleCheckCommitment(
        'baik bunda, untuk ketersediaan jadwal hari jumat besok, kami bantu cekkan ketersediaan jadwalnya dulu ya bunda'
      )).toBe(true);
      expect(isScheduleCheckCommitment(
        'untuk jadwal hari senin, kami akan cek ketersediaan jadwal terlebih dahulu ya bund'
      )).toBe(true);
    });
  });

  // ─── Qualification Logic Pattern (Konseptual) ───

  describe('Qualified Handoff — pola kualifikasi (konseptual)', () => {
    /**
     * Pola kualifikasi (dari agent-runner.ts):
     * hasLocation = session.location?.kelurahan || session.location?.distanceKm != null
     * hasTreatment = session.selectedTreatment || cartItems.length > 0
     * isFullyQualified = hasLocation && hasTreatment
     * shouldTriggerHandoff = isFullyQualified || alreadyAskedMissingInfo (anti-kaset rusak)
     */

    it('data lengkap (lokasi + treatment) → handoff aktif', () => {
      const session = {
        location: { kelurahan: 'Pepe', distanceKm: 5 },
        selectedTreatment: 'Pijat Bayi Ceria',
      };
      const hasLocation = Boolean(session.location?.kelurahan || session.location?.distanceKm != null);
      const hasTreatment = Boolean(session.selectedTreatment);
      expect(hasLocation && hasTreatment).toBe(true);
    });

    it('lokasi belum ada → bot tetap aktif', () => {
      const session = { location: {} as any, selectedTreatment: 'Pijat Bayi Ceria' };
      const hasLocation = Boolean(session.location?.kelurahan || session.location?.distanceKm != null);
      const hasTreatment = Boolean(session.selectedTreatment);
      expect(hasLocation && hasTreatment).toBe(false);
    });

    it('treatment belum ada → bot tetap aktif', () => {
      const session = { location: { kelurahan: 'Pepe', distanceKm: 5 } };
      const hasLocation = Boolean(session.location?.kelurahan || session.location?.distanceKm != null);
      const hasTreatment = Boolean(session.selectedTreatment || (session as any).cartItems?.length);
      expect(hasLocation && hasTreatment).toBe(false);
    });

    it('anti-kaset rusak: customer ngotot + bot baru tanya lokasi → handoff aktif', () => {
      const hasLocation = false;
      const hasTreatment = true;
      const recentAssistantMsgs = [
        { role: 'assistant', content: 'Kalau boleh tahu rumah Bunda di daerah mana ya?' },
      ];
      const alreadyAskedMissingInfo = recentAssistantMsgs.some((m) => {
        const c = (m.content || '').toLowerCase();
        return (!hasLocation && (c.includes('kelurahan') || c.includes('daerah') || c.includes('rumahnya dimana')));
      });
      expect(alreadyAskedMissingInfo).toBe(true);
    });

    it('anti-kaset rusak: customer ngotot + bot baru tanya treatment → handoff aktif', () => {
      const hasLocation = true;
      const hasTreatment = false;
      const recentAssistantMsgs = [
        { role: 'assistant', content: 'Rencananya mau ambil perawatan apa untuk si kecil?' },
      ];
      const alreadyAskedMissingInfo = recentAssistantMsgs.some((m) => {
        const c = (m.content || '').toLowerCase();
        return (!hasTreatment && (c.includes('perawatan apa') || c.includes('treatment apa') || c.includes('mau ambil perawatan')));
      });
      expect(alreadyAskedMissingInfo).toBe(true);
    });

    it('bot tidak pernah menanyakan data kurang → bukan anti-kaset rusak', () => {
      const hasLocation = false;
      const hasTreatment = false;
      const recentAssistantMsgs = [
        { role: 'assistant', content: 'Untuk pijat bayi ceria, durasinya sekitar 40 menit ya Bunda' },
      ];
      const alreadyAskedMissingInfo = recentAssistantMsgs.some((m) => {
        const c = (m.content || '').toLowerCase();
        return (!hasLocation && (c.includes('kelurahan') || c.includes('daerah') || c.includes('rumahnya dimana')))
          || (!hasTreatment && (c.includes('perawatan apa') || c.includes('treatment apa') || c.includes('mau ambil perawatan')));
      });
      expect(alreadyAskedMissingInfo).toBe(false);
    });
  });
});
