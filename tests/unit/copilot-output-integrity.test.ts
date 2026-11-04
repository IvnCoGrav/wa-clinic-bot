import { describe, it, expect } from 'vitest';
import {
  repairCopilotChatLinks,
  stripOrphanChatLinks,
  trimHangingSentence,
  stitchCopilotAnswer,
} from '../../src/services/copilot/copilot.service';

describe('Copilot output integrity (Fase 1)', () => {
  it('ID karangan/tidak ada → tautan tidak muncul atau diganti ID valid', () => {
    const rows = [
      { customerName: 'Bunda Ririn', conversationId: 'conv-ririn-123' },
      { customerName: 'Bunda Dewi', conversationId: 'conv-dewi-456' },
    ];

    // Kasus 1: ID karangan yang berasosiasi dengan pasien valid digantikan ID valid
    const answerWithName = '1. Bunda Ririn [Buka Chat](/admin/live-chat?conversationId=fake-hallucinated-id)';
    const out1 = repairCopilotChatLinks(answerWithName, rows);
    expect(out1).toContain('/admin/live-chat?conversationId=conv-ririn-123');
    expect(out1).not.toContain('fake-hallucinated-id');

    // Kasus 2: ID karangan tanpa asosiasi nama pasien dibuang (tidak dibiarkan lolos)
    const answerWithoutName = 'Chat tidak dikenal [Buka Chat](/admin/live-chat?conversationId=fake-hallucinated-id)';
    const out2 = repairCopilotChatLinks(answerWithoutName, rows);
    expect(out2).not.toContain('fake-hallucinated-id');
    expect(out2).not.toContain('/admin/live-chat?conversationId=');
  });

  it('Teks [Buka Chat](/ · [Buka Chat](...) → jadi satu tautan valid', () => {
    const rows = [
      { customerName: 'Bunda Agnes', conversationId: 'conv-agnes-789' },
    ];
    const malformed = '1. Bunda Agnes [Buka Chat](/ · [Buka Chat](/admin/live-chat?conversationId=conv-agnes-789)';
    const out = repairCopilotChatLinks(malformed, rows);

    expect(out).toBe('1. Bunda Agnes [Buka Chat](/admin/live-chat?conversationId=conv-agnes-789)');
    expect(out).not.toContain('[Buka Chat](/ ·');
    // Pastikan tidak ada karakter rusak U+00B7 di dalam link
    expect(out.match(/\[Buka Chat\]/g)?.length).toBe(1);
  });

  it('Jawaban berakhir "...konfirmasi booking L" → kalimat dipangkas/dilanjutkan, tidak menggantung', () => {
    // Single-line / paragraph: kalimat kedua terpotong di kata "L"
    const cutOffSingle = 'Bunda Ririn sudah terjadwal pukul 10.00 WIB. Sedangkan Bunda Dewi konfirmasi booking L';
    const trimmed1 = trimHangingSentence(cutOffSingle);
    expect(trimmed1).toBe('Bunda Ririn sudah terjadwal pukul 10.00 WIB.');

    // Multi-line list: item kedua terpotong
    const cutOffMulti = 'Berikut daftar pasien:\n1. Bunda Ririn jam 10.00 WIB.\n2. Bunda Dewi konfirmasi booking L';
    const trimmed2 = trimHangingSentence(cutOffMulti);
    expect(trimmed2).toBe('Berikut daftar pasien:\n1. Bunda Ririn jam 10.00 WIB.');
  });

  it('baris tautan yatim (tanpa nama pasien) dibuang, baris bernama tetap', () => {
    const answer = [
      '**Prioritas balas:**',
      '- Bunda Ririn - menunggu 20 menit [Buka Chat](/admin/live-chat?conversationId=conv-ririn)',
      '- [Buka Chat](/admin/live-chat?conversationId=conv-ririn)',
      '- [Buka Chat](/admin/live-chat?conversationId=conv-ririn)',
    ].join('\n');

    const out = stripOrphanChatLinks(answer);
    expect(out).toContain('Bunda Ririn');
    expect(out.match(/\[Buka Chat\]/g)?.length).toBe(1);
  });

  it('stitchCopilotAnswer merangkai kelanjutan teks tanpa pengulangan kata', () => {
    const part1 = 'Berikut jadwal hari ini:\n1. Bunda Ririn pukul 10.00 WIB.';
    const part2 = '\n2. Bunda Dewi pukul 14.00 WIB.';
    const stitched = stitchCopilotAnswer(part1, part2);

    expect(stitched).toContain('1. Bunda Ririn pukul 10.00 WIB.');
    expect(stitched).toContain('2. Bunda Dewi pukul 14.00 WIB.');

    // Pengulangan overlap di awal part2 dipangkas
    const overlap1 = 'Sedangkan Bunda Dewi masih menunggu konfirmasi';
    const overlap2 = 'konfirmasi booking dari admin.';
    const stitchedOverlap = stitchCopilotAnswer(overlap1, overlap2);
    expect(stitchedOverlap).toBe('Sedangkan Bunda Dewi masih menunggu konfirmasi booking dari admin.');
  });
});
