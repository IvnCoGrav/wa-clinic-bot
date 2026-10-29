/**
 * statusTones.ts — Single Source of Truth kelas warna untuk setiap `StatusTone`.
 *
 * Sebelumnya pemetaan tone → kelas ditulis ulang di beberapa tempat
 * (`StatusChip`, `ReservationStatusIcon`), sehingga satu status bisa tampil
 * berbeda warna antar komponen. Semua komponen status WAJIB mengambil kelas
 * dari sini.
 *
 * Semua nilai memakai token semantik (`index.css`), sehingga otomatis benar di
 * mode terang maupun gelap tanpa perlu pasangan `dark:`.
 */

/** Nada semantik status. Definisi tipe ada di sini agar tidak ada impor melingkar. */
export type StatusTone = 'success' | 'info' | 'warning' | 'caution' | 'danger' | 'neutral';

export interface ToneStyle {
  /** Latar chip/badge. */
  bg: string;
  /** Warna teks & ikon di dalam chip. */
  text: string;
  /** Garis tepi chip. */
  line: string;
  /** Warna ring (untuk komponen yang memakai `ring-1` alih-alih border). */
  ring: string;
  /** Warna titik indikator. */
  dot: string;
}

export const TONE_STYLES: Record<StatusTone, ToneStyle> = {
  success: {
    bg: 'bg-success-soft',
    text: 'text-success',
    line: 'border-success-line',
    ring: 'ring-success-line',
    dot: 'bg-success',
  },
  info: {
    bg: 'bg-info-soft',
    text: 'text-info',
    line: 'border-info-line',
    ring: 'ring-info-line',
    dot: 'bg-info',
  },
  warning: {
    bg: 'bg-warning-soft',
    text: 'text-warning',
    line: 'border-warning-line',
    ring: 'ring-warning-line',
    dot: 'bg-warning',
  },
  caution: {
    bg: 'bg-caution-soft',
    text: 'text-caution',
    line: 'border-caution-line',
    ring: 'ring-caution-line',
    dot: 'bg-caution',
  },
  danger: {
    bg: 'bg-danger-soft',
    text: 'text-danger',
    line: 'border-danger-line',
    ring: 'ring-danger-line',
    dot: 'bg-danger',
  },
  neutral: {
    bg: 'bg-neutral-soft',
    text: 'text-neutral',
    line: 'border-divider',
    ring: 'ring-divider',
    dot: 'bg-neutral',
  },
};

/** Kelas chip lengkap: latar + teks + garis tepi. */
export const toneChipClass = (tone: StatusTone): string => {
  const s = TONE_STYLES[tone] || TONE_STYLES.neutral;
  return `${s.bg} ${s.text} ${s.line}`;
};

/** Kelas pill ber-ring (tanpa border): latar + teks + ring. */
export const toneRingClass = (tone: StatusTone): string => {
  const s = TONE_STYLES[tone] || TONE_STYLES.neutral;
  return `${s.bg} ${s.text} ${s.ring}`;
};
