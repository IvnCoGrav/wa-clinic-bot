/**
 * Potongan tampilan status dan metode pembayaran reservasi yang dipakai tabel,
 * kartu mobile, dan modal bukti pembayaran.
 */
import React from 'react';
import { StatusChip } from '../../components/ui/StatusChip';
import { reservationStatusToTone } from '../../utils/statusTone';
import { formatWib, formatWibClock } from '../../utils/dateWib';
import { extractDurationMinutes } from '../../utils/durationCalculator';
import { resolveChildAgeRows } from '../../utils/clinicalAge';
import { extractBabiesFromRawText } from '../../utils/reservationBabies';
import { Reservation } from '../../types';

export function getStatusBadge(status: string, rawText?: string | null) {
  if (status === 'archive') {
    return <StatusChip tone="neutral" label="🗄️ Diarsipkan" dot={false} />;
  }
  if (status === 'pending' && rawText && /\[SAME_DAY_REQUEST\]/i.test(rawText)) {
    return (
      <span className="px-2.5 py-0.5 rounded-full bg-danger text-on-solid text-xs font-bold shadow-2xs">
        ⏰ Hari Ini: Perlu Cek
      </span>
    );
  }
  const tone = reservationStatusToTone(status);
  const labels: Record<string, string> = {
    hold: '⏳ Hold',
    confirmed: '📅 Terjadwal',
    en_route: '🛵 Dalam Perjalanan',
    completed: '✅ Selesai',
    cancelled: '❌ Batal',
    pending: '⏳ Menunggu',
  };
  return <StatusChip tone={tone} label={labels[status] || '⏳ Hold'} dot={false} />;
}

export function getPaymentMethodLabel(method?: string | null): string {
  if (method === 'CASH') return 'Tunai';
  if (method === 'TRANSFER') return 'Transfer';
  if (method === 'QRIS') return 'QRIS';
  return '-';
}

/** Tanggal booking ringkas, mis. "12 Nov 09:30 - 10:30". */
export function formatBookingDate(dateStr: string | null | undefined, detail?: string | null): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const dayMonth = formatWib(d, { day: 'numeric', month: 'short' });
    const startTime = formatWibClock(d).replace('.', ':');
    const duration = extractDurationMinutes(detail);
    const endD = new Date(d.getTime() + duration * 60 * 1000);
    const endTime = formatWibClock(endD).replace('.', ':');
    return `${dayMonth} ${startTime} - ${endTime}`;
  } catch {
    return '';
  }
}

/** Baris anak dengan usia klinis seragam (cermin util engine). */
export function getBabyRows(res: Reservation | null): Array<{ name: string; age: string; regAge?: string }> {
  return resolveChildAgeRows(res as any, extractBabiesFromRawText);
}
