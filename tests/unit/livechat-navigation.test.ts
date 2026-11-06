import { describe, it, expect } from 'vitest';
import { resolveUrlViewTransition } from '../../packages/admin-dashboard/src/utils/livechatNavigation';

/**
 * Regresi AUDIT LIVECHAT #316 / T-08: transisi view harus berbasis URL,
 * bukan state history karangan atau sessionStorage.
 */
describe('resolveUrlViewTransition', () => {
  it('URL baru punya conversationId → buka thread', () => {
    expect(resolveUrlViewTransition(null, 'conv-1')).toBe('open');
    expect(resolveUrlViewTransition('conv-0', 'conv-1')).toBe('open');
  });

  it('conversationId hilang dari URL → kembali ke daftar (back)', () => {
    expect(resolveUrlViewTransition('conv-1', null)).toBe('close');
    expect(resolveUrlViewTransition('conv-1', undefined)).toBe('close');
    expect(resolveUrlViewTransition('conv-1', '')).toBe('close');
  });

  it('perubahan param non-percakapan saat di daftar → view tidak berubah', () => {
    // mis. buka ?action=export dari daftar
    expect(resolveUrlViewTransition(null, null)).toBe('none');
    expect(resolveUrlViewTransition(undefined, null)).toBe('none');
  });

  it('tidak pernah menutup chat hanya karena URL di-render ulang dengan id yang sama', () => {
    expect(resolveUrlViewTransition('conv-1', 'conv-1')).toBe('open');
  });
});
