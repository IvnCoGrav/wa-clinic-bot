import { describe, it, expect } from 'vitest';
import { validateFactualClaims } from '../../src/v3/guardrails/factual-claim-validator';
import { OutputSanitizer } from '../../src/v3/guardrails/sanitizer';

/**
 * Alur SOP vaksinasi (sesi simulator 446090):
 * - Anjuran vaksin via get_clinic_policy_faq ATAU artikel knowledge vaksin → VALID (akhir deadlock D2↔D3).
 * - Karangan tanpa grounding → INVALID (tetap eskalasi senyap).
 * - Balasan eskalasi '' DILARANG ditimpa sanitizer menjadi sapaan Turn-0
 *   (kontrak: runner hanya memanggil fallback bila !isEscalated && shouldSendReply).
 */
describe('Vaccine SOP flow (deadlock D2/D3 + anti-hijack eskalasi)', () => {
  const policyTools = () => [{ name: 'get_clinic_policy_faq', args: { topic: 'post_vaccine_rules' }, result: { success: true } }];
  const searchTools = (chunks: any[]) => [{ name: 'search_knowledge_faq', args: {}, result: { success: true, chunks } }];
  const vaccineChunks = [{ title: 'Apakah bayi yang baru divaksin boleh dipijat?', content: 'Setelah vaksin si kecil sebaiknya diistirahatkan selama 2-3 hari terlebih dahulu sebelum dipijat, Bunda.' }];

  const reply =
    'Setelah vaksin atau imunisasi, si kecil sebaiknya diistirahatkan selama 2-3 hari terlebih dahulu sebelum dipijat ya Bunda 😊 ' +
    'Pijat juga sangat aman jika dilakukan SEBELUM jadwal imunisasi.';

  it('vaksin via get_clinic_policy_faq → lolos D2 dan D3', () => {
    const res = validateFactualClaims(reply, policyTools(), []);
    expect(res.isValid).toBe(true);
  });

  it('vaksin via retrievedChunks pre-grounding → lolos D2 dan D3', () => {
    const res = validateFactualClaims(reply, [], vaccineChunks);
    expect(res.isValid).toBe(true);
  });

  it('vaksin via search_knowledge_faq berisi vaksin → lolos D2 dan D3', () => {
    const res = validateFactualClaims(reply, searchTools(vaccineChunks), []);
    expect(res.isValid).toBe(true);
  });

  it('karangan vaksin tanpa grounding apa pun → tetap INVALID (jalur eskalasi)', () => {
    const res = validateFactualClaims(reply, [], []);
    expect(res.isValid).toBe(false);
    expect(res.violations.join(' ')).toMatch(/vaksin|kebijakan/i);
  });

  it("isValidReply('') === false — bukti risiko hijack bila guard eskalasi absen", () => {
    // Sanitizer benar menolak string kosong; karena itu agent-runner WAJIB
    // mem-bypass fallback saat isEscalated (kontrak: replyText '' tetap '').
    expect(OutputSanitizer.isValidReply('')).toBe(false);
  });
});
