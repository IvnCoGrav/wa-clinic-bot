import { describe, it, expect } from 'vitest';
import { FastResponseGate } from '../../src/v3/agent/pipeline/fast-response-gate';

/**
 * A-012: foto tanpa caption tidak boleh langsung dijawab "sudah disimpan
 * untuk Bidan" bila belum ada konteks kunjungan — bisa jadi pertanyaan
 * produk/keluhan. Tanpa konteks, gate harus menyerahkan ke triage.
 */
describe('Fast gate image — butuh konteks kunjungan (A-012)', () => {
  const baseArgs = (session: any) => ({
    tenantId: 'default-tenant',
    conversationId: 'conv-img',
    phone: '628111',
    incomingText: '[IMAGE]',
    cleanIncomingText: '[IMAGE]',
    isFollowUp: false,
    session,
    currentSystemPrompt: 'system',
    fewShotExemplars: [],
    skipDbLogging: true,
  });

  it('tanpa konteks booking → handled false (lanjut triage)', async () => {
    const res = await FastResponseGate.check(baseArgs({ genderGreeting: 'Bunda' }) as any);
    expect(res.handled).toBe(false);
  });

  it('dengan reservationId → ack statis boleh (foto panduan kunjungan)', async () => {
    const res = await FastResponseGate.check(
      baseArgs({ genderGreeting: 'Bunda', booking: { reservationId: 'res-1' } }) as any
    );
    expect(res.handled).toBe(true);
    if (res.handled) {
      expect(res.output.replyText).toContain('simpan');
    }
  });
});
