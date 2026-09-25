/**
 * location-helpers.ts — Pure helpers tanpa dependensi state (anti-circular).
 * Dipisah dari conversation-summarizer.ts agar goal-tracker.ts tidak perlu
 * mengimpor summarizer (yang mengimpor CustomerGoalSession dari goal-tracker).
 */

export function isAskedLocationRecently(history: Array<{ role: string; content: string }>): boolean {
  const recentAssistantMsgs = (history || []).filter((h) => h.role === 'assistant').slice(-2);
  return recentAssistantMsgs.some((m) => {
    const c = (m.content || '').toLowerCase();
    return c.includes('daerah atau kelurahan')
      || c.includes('kelurahan mana')
      || c.includes('rumahnya dimana')
      || c.includes('rumah bunda dimana')
      || c.includes('daerah mana')
      || c.includes('lokasi rumah')
      || c.includes('alamat rumah');
  });
}
