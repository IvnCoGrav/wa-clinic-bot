import React from 'react';
import { AlertCircle, CheckCheck, CheckCircle2, XCircle } from 'lucide-react';

interface ReservationStatusIconProps {
  status?: string | null;
  /** `purchase_occurred_at` — dipakai untuk membedakan "Terjadwal" vs "Terjadwal • Lunas". */
  paid?: boolean;
  className?: string;
}

interface StatusVisual {
  /** Teks asli — wajib ada sebagai tooltip & `aria-label`, bukan sekadar ikon. */
  label: string;
  icon: React.ReactNode;
  pillClass: string;
}

/**
 * Status reservasi sebagai **ikon saja** di kartu kalender (F-33).
 *
 * Sebelumnya markup status ditulis dua kali (Harian & Mingguan) dengan teks
 * "Terjadwal" / "Pending" yang memakan lebar kartu di HP. Komponen ini menjadi
 * satu-satunya sumber tampilan status kalender.
 *
 * Aturan:
 * - `hold` **tetap teks "HOLD"** — status paling kritis, tidak boleh bergantung
 *   pada hafalan ikon.
 * - `confirmed` → centang satu; `confirmed` + sudah bayar → centang ganda
 *   (makna "Lunas" tidak hilang walau teksnya dibuang).
 * - `pending`/lainnya → ikon peringatan.
 *
 * Semua bentuk ikon wajib membawa `aria-label` + `title` berisi teks aslinya
 * agar informasi tidak hilang untuk pembaca layar dan desktop (hover).
 */
export const ReservationStatusIcon: React.FC<ReservationStatusIconProps> = ({
  status,
  paid = false,
  className = '',
}) => {
  const visual = resolveStatusVisual(status, paid);

  if (!visual) return null;

  if (status === 'hold') {
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-black bg-amber-500 text-slate-950 ring-1 ring-amber-300 dark:ring-amber-300/60 shadow-2xs shrink-0 ${className}`}
        title={visual.label}
      >
        HOLD
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={visual.label}
      title={visual.label}
      className={`inline-flex items-center justify-center p-0.5 rounded-full ring-1 shrink-0 ${visual.pillClass} ${className}`}
    >
      {visual.icon}
    </span>
  );
};

function resolveStatusVisual(status?: string | null, paid = false): StatusVisual | null {
  switch (status) {
    case 'hold':
      return {
        label: 'HOLD — slot ditahan sementara',
        icon: null,
        pillClass: '',
      };
    case 'confirmed':
      return paid
        ? {
            label: 'Terjadwal • Lunas',
            icon: <CheckCheck size={11} aria-hidden="true" />,
            pillClass: 'bg-emerald-600/10 dark:bg-emerald-950/30 text-emerald-700 dark:text-[#00a884] ring-emerald-500/30',
          }
        : {
            label: 'Terjadwal',
            icon: <CheckCircle2 size={11} aria-hidden="true" />,
            pillClass: 'bg-emerald-600/10 dark:bg-emerald-950/30 text-emerald-700 dark:text-[#00a884] ring-emerald-500/30',
          };
    case 'completed':
      return {
        label: 'Selesai',
        icon: <CheckCircle2 size={11} aria-hidden="true" />,
        pillClass: 'bg-slate-500/10 dark:bg-slate-500/20 text-slate-600 dark:text-[#aebac1] ring-slate-400/30',
      };
    case 'cancelled':
      return {
        label: 'Batal',
        icon: <XCircle size={11} aria-hidden="true" />,
        pillClass: 'bg-rose-600/10 dark:bg-rose-950/30 text-rose-700 dark:text-[#fb7185] ring-rose-500/30',
      };
    case 'pending':
      return {
        label: 'Pending — menunggu konfirmasi',
        icon: <AlertCircle size={11} aria-hidden="true" />,
        pillClass: 'bg-amber-600/10 dark:bg-amber-950/30 text-amber-700 dark:text-[#f59e0b] ring-amber-500/30',
      };
    default:
      return status
        ? {
            label: status,
            icon: <AlertCircle size={11} aria-hidden="true" />,
            pillClass: 'bg-amber-600/10 dark:bg-amber-950/30 text-amber-700 dark:text-[#f59e0b] ring-amber-500/30',
          }
        : null;
  }
}
