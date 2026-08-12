import { contextStorage } from './context';

export type StageName =
  | 'INCOMING'
  | 'INTENT'
  | 'GENERATE'
  | 'TYPING'
  | 'OUTBOUND'
  | 'HANDOVER'
  | 'ERROR';

const STAGE_EMOJIS: Record<StageName, string> = {
  INCOMING: '📥',
  INTENT: '🧠',
  GENERATE: '🤖',
  TYPING: '💬',
  OUTBOUND: '🚀',
  HANDOVER: '👤',
  ERROR: '❌',
};

const STAGE_LABELS: Record<StageName, string> = {
  INCOMING: 'PESAN MASUK',
  INTENT: 'ANALISIS INTENT',
  GENERATE: 'GENERATE BALASAN',
  TYPING: 'JEDA MENGETIK',
  OUTBOUND: 'PESAN TERKIRIM',
  HANDOVER: 'ESKALASI ADMIN',
  ERROR: 'TERJADI ERROR',
};

/**
 * Memeriksa apakah aplikasi berjalan dalam mode log ringkas (LOG_LEVEL=simple).
 * Default ke 'simple' bila LOG_LEVEL tidak diset atau bernilai 'simple'.
 */
export function isSimpleLogMode(): boolean {
  if (process.env.NODE_ENV === 'test') {
    return false;
  }
  const level = (process.env.LOG_LEVEL || 'simple').toLowerCase();
  return level === 'simple';
}

/**
 * Mencetak log tahap (Stage Progress) yang bersih, terstruktur, dan mudah dibaca di terminal.
 */
export function stageLog(stage: StageName, detail: string, phone?: string): void {
  const emoji = STAGE_EMOJIS[stage] || '📌';
  const label = STAGE_LABELS[stage] || stage;
  const store = contextStorage.getStore();
  const targetPhone = phone || store?.phone || '';
  const phoneTag = targetPhone ? ` [${targetPhone}]` : '';

  const message = `[STAGE: ${stage}] ${emoji} ${label}${phoneTag} ── ${detail}`;

  const originalLog = (console.log as any).original || console.log;
  originalLog(message);
}
