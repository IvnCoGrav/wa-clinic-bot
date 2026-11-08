/**
 * copilotStatus.ts — label status progres deterministik untuk panel AI Copilot.
 *
 * Latar: satu turn Copilot (GLM-5.3 Flash & budget 5 menit) bisa memakan
 * puluhan detik hingga beberapa menit untuk analisis mendalam multi-step.
 * Fungsi murni ini memetakan LAMA MENUNGGU (ms) → tahap + label bergilir,
 * proporsional hingga 300 detik, supaya proses terasa aktif bekerja.
 *
 * Murni & deterministik (tanpa I/O) — mudah diuji offline. Label generik
 * (bukan data bisnis), aman lintas-tenant.
 */

export type CopilotStage = 'searching' | 'reasoning' | 'drafting' | 'polishing' | 'finalizing';

export interface CopilotStatus {
  stage: CopilotStage;
  label: string;
}

interface StatusStep {
  /** Ambang atas (ms, eksklusif) untuk tahap ini. */
  untilMs: number;
  stage: CopilotStage;
  label: string;
}

/**
 * Tangga status proporsional 300 detik (5 menit).
 * Memberi umpan balik visual berjenjang saat server sedang melakukan multi-step tool call.
 */
export const COPILOT_STATUS_STEPS: readonly StatusStep[] = [
  { untilMs: 10_000, stage: 'searching', label: 'Mencari data di database…' },
  { untilMs: 45_000, stage: 'reasoning', label: 'Menganalisis data…' },
  { untilMs: 120_000, stage: 'drafting', label: 'Menyusun jawaban…' },
  { untilMs: 240_000, stage: 'polishing', label: 'Merapikan ringkasan…' },
  { untilMs: Infinity, stage: 'finalizing', label: 'Menunggu model (GLM-5.3)…' },
] as const;

/**
 * Petakan elapsed ms → status. Nilai negatif / NaN diperlakukan sebagai 0
 * (fail-safe, tidak pernah melempar).
 */
export function getCopilotStatus(elapsedMs: number): CopilotStatus {
  const ms = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const step = COPILOT_STATUS_STEPS.find((s) => ms < s.untilMs) || COPILOT_STATUS_STEPS[COPILOT_STATUS_STEPS.length - 1];
  return { stage: step.stage, label: step.label };
}

/** Detik bulat untuk ditampilkan di samping label (mis. "12s"). */
export function formatElapsedSeconds(elapsedMs: number): string {
  const ms = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  return `${Math.floor(ms / 1000)}s`;
}

export type CopilotRunStatus = 'idle' | 'running' | 'done' | 'error';

export interface CopilotBadge {
  kind: 'none' | 'spinner' | 'dot' | 'warn';
  label: string; // untuk aria-label
}

/**
 * Petakan status Copilot, unread state, dan visibilitas panel ke badge indikator.
 * Menentukan apakah tombol Copilot menampilkan spinner, badge titik merah, warning, atau bersih.
 */
export function resolveCopilotBadge(input: {
  status: CopilotRunStatus;
  hasUnread: boolean;
  panelOpen: boolean;
}): CopilotBadge {
  if (input.status === 'running') {
    return { kind: 'spinner', label: 'AI Copilot sedang memproses…' };
  }
  if (input.status === 'error') {
    return { kind: 'warn', label: 'Copilot mengalami kendala' };
  }
  if (input.status === 'done' && input.hasUnread && !input.panelOpen) {
    return { kind: 'dot', label: 'Jawaban Copilot baru tersedia' };
  }
  return { kind: 'none', label: 'AI Copilot' };
}
