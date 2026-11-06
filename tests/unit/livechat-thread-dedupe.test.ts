import { describe, it, expect } from 'vitest';
import { dedupeThreadMessages } from '../../packages/admin-dashboard/src/utils/livechatThread';

/**
 * Regresi AUDIT LIVECHAT #316: dedupe lama membuang pesan sah yang identik
 * dalam <2 detik. Dedupe yang benar hanya berdasarkan id / wa_message_id.
 */
describe('dedupeThreadMessages', () => {
  it('mempertahankan dua pesan identik beruntun dengan ID berbeda', () => {
    const result = dedupeThreadMessages([
      { id: 'm1', wa_message_id: 'wa1', content: 'Ya', created_at: '2026-11-06T02:00:00.000Z' },
      { id: 'm2', wa_message_id: 'wa2', content: 'Ya', created_at: '2026-11-06T02:00:01.000Z' },
    ]);
    expect(result).toHaveLength(2);
  });

  it('membuang duplikat ID internal yang sama', () => {
    const result = dedupeThreadMessages([
      { id: 'm1', wa_message_id: 'wa1' },
      { id: 'm1', wa_message_id: 'wa1-other' },
    ]);
    expect(result).toHaveLength(1);
  });

  it('membuang duplikat wa_message_id yang sama (ID lokal berbeda)', () => {
    const result = dedupeThreadMessages([
      { id: 'm1', wa_message_id: 'wa1' },
      { id: 'm2', wa_message_id: 'wa1' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('m1');
  });

  it('mempertahankan pesan tanpa ID (tidak boleh hilang)', () => {
    const result = dedupeThreadMessages([
      { id: null, wa_message_id: null },
      { id: null, wa_message_id: null },
    ]);
    expect(result).toHaveLength(2);
  });

  it('input kosong/null → array kosong (fail-safe)', () => {
    expect(dedupeThreadMessages([])).toEqual([]);
    expect(dedupeThreadMessages(null)).toEqual([]);
    expect(dedupeThreadMessages(undefined)).toEqual([]);
  });
});
