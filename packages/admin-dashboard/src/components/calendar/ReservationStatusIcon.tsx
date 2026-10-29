import React from 'react';
import { AlertCircle, CheckCheck, CheckCircle2, Navigation, XCircle } from 'lucide-react';
import { toneRingClass } from '../../lib/statusTones';
import { reservationStatusToTone } from '../../utils/statusTone';
import { normalizeReservationStatus } from '../../utils/reservationStatus';

interface ReservationStatusIconProps {
  status?: string | null;
  /**
   * Status pembayaran (`purchase_occurred_at`).
   * - `true`  → pembayaran tercatat ("Lunas").
   * - `false` → sistem YAKIN belum lunas (mis. invoice menandai tagihan terbuka).
   * - `undefined` → tidak diketahui (kolom kosong di DB BUKAN berarti belum lunas).
   */
  paid?: boolean;
  className?: string;
}

interface StatusVisual {
  /** Teks asli — wajib ada sebagai tooltip & `aria-label`, bukan sekadar ikon. */
  label: string;
  icon: React.ReactNode;
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
 * Warna TIDAK ditentukan di sini: seluruhnya berasal dari `reservationStatusToTone`
 * + `TONE_STYLES`, agar tidak ada dua sumber kebenaran warna status.
 *
 * Semua bentuk ikon wajib membawa `aria-label` + `title` berisi teks aslinya
 * agar informasi tidak hilang untuk pembaca layar dan desktop (hover).
 */
export const ReservationStatusIcon: React.FC<ReservationStatusIconProps> = ({
  status,
  paid,
  className = '',
}) => {
  const visual = resolveStatusVisual(status, paid);

  if (!visual) return null;

  if (normalizeReservationStatus(status) === 'hold') {
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-black bg-warning text-on-solid ring-1 ring-warning-line shadow-2xs shrink-0 ${className}`}
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
      className={`inline-flex items-center justify-center p-0.5 rounded-full ring-1 shrink-0 ${toneRingClass(reservationStatusToTone(status, paid))} ${className}`}
    >
      {visual.icon}
    </span>
  );
};

function resolveStatusVisual(status?: string | null, paid?: boolean): StatusVisual | null {
  const norm = normalizeReservationStatus(status);

  switch (norm) {
    case 'hold':
      return { label: 'HOLD — slot ditahan sementara', icon: null };
    case 'en_route':
    case 'on_the_way':
    case 'otw':
      return { label: 'Menuju lokasi pasien', icon: <Navigation size={11} aria-hidden="true" /> };
    case 'confirmed':
      return paid
        ? { label: 'Terjadwal • Lunas', icon: <CheckCheck size={11} aria-hidden="true" /> }
        : { label: 'Terjadwal', icon: <CheckCircle2 size={11} aria-hidden="true" /> };
    case 'completed':
      if (paid) return { label: 'Selesai • Lunas', icon: <CheckCheck size={11} aria-hidden="true" /> };
      if (paid === false) return { label: 'Selesai • Belum lunas', icon: <CheckCircle2 size={11} aria-hidden="true" /> };
      return { label: 'Selesai', icon: <CheckCircle2 size={11} aria-hidden="true" /> };
    case 'cancelled':
      return { label: 'Batal', icon: <XCircle size={11} aria-hidden="true" /> };
    case 'rejected':
      return { label: 'Ditolak', icon: <XCircle size={11} aria-hidden="true" /> };
    case 'pending':
      return { label: 'Pending — menunggu konfirmasi', icon: <AlertCircle size={11} aria-hidden="true" /> };
    default:
      return norm ? { label: status ?? norm, icon: <AlertCircle size={11} aria-hidden="true" /> } : null;
  }
}
