import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { V3AgentRunner } from '../../../src/v3/agent/agent-runner';

/**
 * Phase 3 — Internal label "Tanya Jadwal": 100% database, ZERO WAHA API call.
 * Guard executable atas Mandat Larangan Menyentuh Label WAHA.
 */
describe('Internal Label Tanya Jadwal (zero WAHA)', () => {
  it('"Untuk jumat besok apakah bisa?" -> sinyal jadwal TERDETEKSI', () => {
    expect(V3AgentRunner.hasScheduleSignal('Untuk jumat besok apakah bisa?')).toBe(true);
  });

  it('"Hari sabtu bisa?" -> sinyal jadwal TERDETEKSI', () => {
    expect(V3AgentRunner.hasScheduleSignal('Hari sabtu bisa kak?')).toBe(true);
  });

  it('"bayi 3 minggu" -> BUKAN sinyal jadwal (minggu = usia, bukan hari)', () => {
    expect(V3AgentRunner.hasScheduleSignal('bayi saya umur 3 minggu')).toBe(false);
  });

  it('tanya harga murni -> BUKAN sinyal jadwal', () => {
    expect(V3AgentRunner.hasScheduleSignal('harganya berapa ya?')).toBe(false);
  });

  // Audit 315036 — sinyal waktu-sekarang + adversarial keluhan.
  it('"kalau sekarang apakah bisa ?" -> sinyal jadwal TERDETEKSI', () => {
    expect(V3AgentRunner.hasScheduleSignal('kalau sekarang apakah bisa ?')).toBe(true);
  });

  it('"hari ini bisa jam berapa?" -> sinyal jadwal TERDETEKSI', () => {
    expect(V3AgentRunner.hasScheduleSignal('hari ini bisa jam berapa?')).toBe(true);
  });

  it('"ready jam berapa?" -> sinyal jadwal TERDETEKSI', () => {
    expect(V3AgentRunner.hasScheduleSignal('ready jam berapa?')).toBe(true);
  });

  it('"batuknya kambuh sekarang" -> BUKAN sinyal jadwal (keluhan, bukan slot)', () => {
    expect(V3AgentRunner.hasScheduleSignal('batuknya kambuh sekarang')).toBe(false);
  });

  it('assignInternalScheduleLabel offline-safe (tidak throw saat DB offline)', async () => {
    await expect(
      V3AgentRunner.assignInternalScheduleLabel('conv-test-123', 'default-tenant')
    ).resolves.toBeUndefined();
  });

  it('agent-runner TIDAK memanggil WAHA label API (addLabel/removeLabel)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../src/v3/agent/agent-runner.ts'),
      'utf-8'
    );
    expect(src).not.toContain('addLabel');
    expect(src).not.toContain('removeLabel');
    expect(src).toContain('customerLabel');
  });
});
