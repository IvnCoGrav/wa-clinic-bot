import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ContextGrounder } from '../../../src/v3/agent/pipeline/context-grounder';

/**
 * Phase 3 — Internal label "Tanya Jadwal": 100% database, ZERO WAHA API call.
 * Guard executable atas Mandat Larangan Menyentuh Label WAHA.
 */
describe('Internal Label Tanya Jadwal (zero WAHA)', () => {
  it('"Untuk jumat besok apakah bisa?" -> sinyal jadwal TERDETEKSI', () => {
    expect(ContextGrounder.hasScheduleSignal('Untuk jumat besok apakah bisa?')).toBe(true);
  });

  it('"Hari sabtu bisa?" -> sinyal jadwal TERDETEKSI', () => {
    expect(ContextGrounder.hasScheduleSignal('Hari sabtu bisa kak?')).toBe(true);
  });

  it('"bayi 3 minggu" -> BUKAN sinyal jadwal (minggu = usia, bukan hari)', () => {
    expect(ContextGrounder.hasScheduleSignal('bayi saya umur 3 minggu')).toBe(false);
  });

  it('tanya harga murni -> BUKAN sinyal jadwal', () => {
    expect(ContextGrounder.hasScheduleSignal('harganya berapa ya?')).toBe(false);
  });

  // Audit 315036 — sinyal waktu-sekarang + adversarial keluhan.
  it('"kalau sekarang apakah bisa ?" -> sinyal jadwal TERDETEKSI', () => {
    expect(ContextGrounder.hasScheduleSignal('kalau sekarang apakah bisa ?')).toBe(true);
  });

  it('"hari ini bisa jam berapa?" -> sinyal jadwal TERDETEKSI', () => {
    expect(ContextGrounder.hasScheduleSignal('hari ini bisa jam berapa?')).toBe(true);
  });

  it('"ready jam berapa?" -> sinyal jadwal TERDETEKSI', () => {
    expect(ContextGrounder.hasScheduleSignal('ready jam berapa?')).toBe(true);
  });

  it('"batuknya kambuh sekarang" -> BUKAN sinyal jadwal (keluhan, bukan slot)', () => {
    expect(ContextGrounder.hasScheduleSignal('batuknya kambuh sekarang')).toBe(false);
  });

  it('assignInternalScheduleLabel offline-safe (tidak throw saat DB offline)', async () => {
    await expect(
      ContextGrounder.assignInternalScheduleLabel('conv-test-123', 'default-tenant')
    ).resolves.toBeUndefined();
  });

  it('pipeline TIDAK memanggil WAHA label API (addLabel/removeLabel)', () => {
    const runnerSrc = fs.readFileSync(
      path.join(__dirname, '../../../src/v3/agent/agent-runner.ts'),
      'utf-8'
    );
    expect(runnerSrc).not.toContain('addLabel');
    expect(runnerSrc).not.toContain('removeLabel');
    // Logika pelabelan internal (DB customerLabel) tinggal di Stage 1 —
    // tetap 100% database, zero WAHA API.
    const grounderSrc = fs.readFileSync(
      path.join(__dirname, '../../../src/v3/agent/pipeline/context-grounder.ts'),
      'utf-8'
    );
    expect(grounderSrc).not.toContain('addLabel');
    expect(grounderSrc).not.toContain('removeLabel');
    expect(grounderSrc).toContain('customerLabel');
  });
});
