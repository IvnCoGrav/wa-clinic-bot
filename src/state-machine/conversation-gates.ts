import { ConversationState } from '@prisma/client';

/**
 * conversation-gates.ts — Otoritas tunggal keputusan gerbang inbound (PLAN 8 FASE 3).
 *
 * Masalah yang diselesaikan: keputusan domain (`out_of_domain`/`complaint`/`human_agent`)
 * ada di DUA tempat (`machine.ts` dan `agent-runner.ts`) dengan logika inline masing-masing.
 * Kini satu fungsi murni `evaluateDomainGate` dipakai kedua pemanggil.
 *
 * Desain:
 *  - Fungsi `evaluate*` MURNI (tanpa I/O, tanpa side-effect) → mudah di-unit-test.
 *  - Pengumpulan input (deteksi medis, FAQ exemption, hitung reservasi) dan eksekusi
 *    side-effect (eskalasi DB, alert) tetap di pemanggil (machine.ts) — bukan di sini.
 *  - Form reservasi deterministik SENGAJA tidak dimigrasikan (jalur bypass-LLM,
 *    lihat PLAN 8 Mikro-Task 3.1 tabel G3).
 */

export type GateAction = 'continue' | 'silent_escalate';

export interface GateVerdict {
  action: GateAction;
  /** Alasan eskalasi untuk CS/admin (mis. 'out_of_domain', 'medical_concern'). */
  reason?: string;
  /** Catatan manusia-terbaca untuk antrean CS. */
  note?: string;
}

/** Intent yang memaksa eskalasi sunyi + reason tercatat untuk CS/admin. */
export const SILENT_ESCALATE_REASONS: Record<string, { reason: string; note: string }> = {
  out_of_domain: {
    reason: 'out_of_domain',
    note: 'Topik di luar layanan klinik (out_of_domain) — diteruskan ke tim manusia',
  },
  complaint: {
    reason: 'complaint',
    note: 'Keluhan eksplisit terhadap layanan — diteruskan ke tim manusia',
  },
  human_agent: {
    reason: 'manual_request',
    note: 'Permintaan bicara dengan manusia — diteruskan ke tim manusia',
  },
};

/**
 * Gerbang domain: cocokkan daftar intent pra-ekstraksi terhadap SILENT_ESCALATE_REASONS.
 * Murni — tidak ada I/O.
 */
export function evaluateDomainGate(preExtractedIntents: string[] | undefined | null): GateVerdict {
  const matched = (preExtractedIntents || []).find((i) => SILENT_ESCALATE_REASONS[i]);
  if (!matched) return { action: 'continue' };
  const { reason, note } = SILENT_ESCALATE_REASONS[matched];
  return { action: 'silent_escalate', reason, note };
}

export interface MedicalGateInput {
  /** Hasil deteksi medis (dari MedicalDetectionService). */
  isMedical: boolean;
  severity?: string;
  detectedSymptoms?: string[];
  /** Boleh dikecualikan bila ada FAQ medis resmi untuk customer baru tanpa riwayat. */
  allowFaqExemption: boolean;
  /** Kategori & status FAQ yang cocok (bila ada). */
  faqCategory?: string;
  faqStatus?: string;
}

/**
 * Gerbang medis: putuskan eskalasi vs lanjut berdasarkan hasil deteksi +
 * kelayakan pengecualian FAQ. Murni — pengumpulan input (deteksi, query FAQ,
 * hitung reservasi) dan side-effect (eskalasi DB, alert) dilakukan pemanggil.
 */
export function evaluateMedicalGate(input: MedicalGateInput): GateVerdict {
  if (!input.isMedical) return { action: 'continue' };

  const exempted =
    input.allowFaqExemption && input.faqCategory === 'medical' && input.faqStatus === 'APPROVED';
  if (exempted) return { action: 'continue' };

  return {
    action: 'silent_escalate',
    reason: 'medical_concern',
    note: `Kondisi medis terdeteksi (Severity: ${input.severity || 'UNKNOWN'})`,
  };
}

/** State yang harus diset conversation saat eskalasi sunyi (kontrak tunggal). */
export function silentEscalateState(): { is_human_handling: boolean; current_state: ConversationState } {
  return { is_human_handling: true, current_state: ConversationState.HUMAN_HANDLING };
}
