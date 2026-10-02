/**
 * copilotStatus.ts — label status progres deterministik untuk panel AI Copilot.
 *
 * Latar: satu turn Copilot (otak Hermes) bisa memakan puluhan detik karena
 * beberapa panggilan LLM sekuensial. Indikator statis "Menganalisis data..."
 * membuat admin mengira sistem menggantung/error. Fungsi murni ini memetakan
 * LAMA MENUNGGU (ms) → tahap + label bergilir, supaya proses terasa bekerja.
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
 * Tangga status. Ambang disusun dari pola latensi nyata: 1 panggilan Hermes
 * ±5–18 dtk; loop 3 panggilan bisa melewati 60 dtk. Angka dapat disetel tanpa
 * mengubah pemanggil.
 */
export const COPILOT_STATUS_STEPS: readonly StatusStep[] = [
  { untilMs: 6_000, stage: 'searching', label: 'Mencari data di database…' },
  { untilMs: 15_000, stage: 'reasoning', label: 'Menganalisis & menghubungkan data…' },
  { untilMs: 30_000, stage: 'drafting', label: 'Menyusun jawaban…' },
  { untilMs: 50_000, stage: 'polishing', label: 'Merapikan ringkasan…' },
  { untilMs: Infinity, stage: 'finalizing', label: 'Hampir selesai, menunggu model…' },
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
