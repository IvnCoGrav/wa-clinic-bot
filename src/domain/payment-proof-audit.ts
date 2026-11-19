/**
 * payment-proof-audit.ts
 *
 * Klasifikasi MURNI (tanpa I/O) untuk audit bukti pembayaran reservasi.
 * Dipakai oleh skrip read-only `src/scripts/audit-payment-proof-gaps.ts`
 * dan unit test `tests/unit/payment-proof-audit.test.ts`.
 *
 * Catatan: modul ini TIDAK menulis apa pun ke database. Semua keputusan
 * hanya membaca nilai yang sudah diberikan pemanggil (anti side-effect).
 */

export const PAYMENT_PROOF_FINDING = {
  /** Belum ada bukti transfer DAN belum tercatat lunas. */
  MISSING_PROOF: 'MISSING_PROOF',
  /** Sudah tercatat lunas tetapi tidak ada berkas bukti. */
  PAID_WITHOUT_PROOF: 'PAID_WITHOUT_PROOF',
  /** `proof_url` ada, tetapi berkas fisiknya tidak ditemukan di storage. */
  PROOF_FILE_MISSING: 'PROOF_FILE_MISSING',
  /** `proof_url` menunjuk folder media chat yang terkena retensi/prune. */
  PROOF_IN_PRUNABLE_STORAGE: 'PROOF_IN_PRUNABLE_STORAGE',
  /** Nominal bukti transfer tidak sama dengan tagihan kanonis. */
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  /** Reservasi tanpa tanggal atau di luar jendela pencocokan otomatis. */
  OUTSIDE_MATCH_WINDOW: 'OUTSIDE_MATCH_WINDOW',
} as const;

export type PaymentProofFindingCode =
  (typeof PAYMENT_PROOF_FINDING)[keyof typeof PAYMENT_PROOF_FINDING];

export type AuditSeverity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface ReservationAuditInput {
  status: string;
  bookingDate: Date | null;
  proofUrl: string | null;
  purchaseOccurredAt: Date | null;
  receiptAmount: number | null;
  /** Tagihan kanonis: purchase_value - diskon + ongkir (GROSS). */
  expectedTotal: number;
  paymentMethod: string | null;
  /** null = tidak diperiksa (mis. bukan file lokal). */
  proofFileExists: boolean | null;
  windowBeforeDays: number;
  windowAfterDays: number;
  now: Date;
}

export interface ReservationAuditResult {
  codes: PaymentProofFindingCode[];
  severity: AuditSeverity;
  notes: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_STATUSES = new Set(['cancelled', 'rejected']);
const SEVERITY_RANK: Record<AuditSeverity, number> = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

function maxSeverity(a: AuditSeverity, b: AuditSeverity): AuditSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function daysFromNow(date: Date, now: Date): number {
  return (date.getTime() - now.getTime()) / DAY_MS;
}

/**
 * Status terminal (cancelled/rejected) sengaja diabaikan: tidak relevan untuk
 * audit bukti bayar dan akan menghasilkan noise besar di laporan.
 */
export function classifyReservationForAudit(
  input: ReservationAuditInput
): ReservationAuditResult {
  const notes: string[] = [];
  const codes: PaymentProofFindingCode[] = [];
  let severity: AuditSeverity = 'NONE';

  if (TERMINAL_STATUSES.has(String(input.status || '').toLowerCase())) {
    return { codes, severity, notes: ['SKIPPED_TERMINAL_STATUS'] };
  }

  const hasProof = Boolean(input.proofUrl && input.proofUrl.trim());
  const isPaid = Boolean(input.purchaseOccurredAt);
  const method = (input.paymentMethod || '').trim().toUpperCase();
  const isCash = method === 'CASH' || method === 'TUNAI';

  // 1. Berkas hilang / folder prunable.
  if (hasProof) {
    if (input.proofFileExists === false) {
      codes.push(PAYMENT_PROOF_FINDING.PROOF_FILE_MISSING);
      severity = maxSeverity(severity, 'HIGH');
      notes.push('Berkas bukti tidak ditemukan di storage.');
    }
    if (input.proofUrl!.startsWith('/media/inbound/')) {
      codes.push(PAYMENT_PROOF_FINDING.PROOF_IN_PRUNABLE_STORAGE);
      severity = maxSeverity(severity, 'HIGH');
      notes.push('Bukti berada di folder inbound (retensi media chat, default 30 hari).');
    }
  }

  // 2. Sudah lunas tetapi tanpa bukti.
  if (isPaid && !hasProof) {
    if (isCash) {
      codes.push(PAYMENT_PROOF_FINDING.PAID_WITHOUT_PROOF);
      severity = maxSeverity(severity, 'LOW');
      notes.push('Pembayaran tunai tanpa bukti transfer (wajar).');
    } else {
      codes.push(PAYMENT_PROOF_FINDING.PAID_WITHOUT_PROOF);
      severity = maxSeverity(severity, 'MEDIUM');
      notes.push('Tercatat lunas non-tunai tetapi tidak ada berkas bukti.');
    }
  }

  // 3. Belum ada bukti dan belum lunas.
  if (!hasProof && !isPaid) {
    codes.push(PAYMENT_PROOF_FINDING.MISSING_PROOF);
    severity = maxSeverity(severity, 'MEDIUM');

    if (!input.bookingDate) {
      codes.push(PAYMENT_PROOF_FINDING.OUTSIDE_MATCH_WINDOW);
      severity = maxSeverity(severity, 'MEDIUM');
      notes.push('Reservasi tanpa tanggal: hanya bisa dicocokkan lewat fallback terakhir.');
    } else {
      const diff = daysFromNow(input.bookingDate, input.now);
      const inWindow =
        diff >= -Math.abs(input.windowBeforeDays) && diff <= Math.abs(input.windowAfterDays);
      if (!inWindow) {
        codes.push(PAYMENT_PROOF_FINDING.OUTSIDE_MATCH_WINDOW);
        severity = maxSeverity(severity, 'MEDIUM');
        notes.push(
          `Di luar jendela pencocokan (${diff.toFixed(1)} hari; window -${input.windowBeforeDays}/+${input.windowAfterDays}).`
        );
      }
    }
  }

  // 4. Nominal bukti vs tagihan kanonis.
  const receipt = Number(input.receiptAmount);
  if (Number.isFinite(receipt) && receipt > 0 && input.expectedTotal > 0) {
    if (Math.round(receipt) !== Math.round(input.expectedTotal)) {
      codes.push(PAYMENT_PROOF_FINDING.AMOUNT_MISMATCH);
      severity = maxSeverity(severity, 'MEDIUM');
      notes.push(
        `Nominal bukti Rp ${Math.round(receipt)} != tagihan Rp ${Math.round(input.expectedTotal)}.`
      );
    }
  }

  return { codes, severity, notes };
}

/** Ringkasan agregat untuk laporan. */
export function summarizeAuditFindings(
  rows: Array<{ severity: AuditSeverity; codes: PaymentProofFindingCode[] }>
): { total: number; bySeverity: Record<AuditSeverity, number>; byCode: Record<string, number> } {
  const bySeverity: Record<AuditSeverity, number> = {
    NONE: 0,
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
  };
  const byCode: Record<string, number> = {};

  for (const row of rows) {
    bySeverity[row.severity] += 1;
    for (const code of row.codes) {
      byCode[code] = (byCode[code] || 0) + 1;
    }
  }

  return { total: rows.length, bySeverity, byCode };
}
