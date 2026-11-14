import { getCleanTreatmentName } from './treatmentFormatter';
import { formatWib, formatWibClock } from './dateWib';

export interface ReservationHistorySummary {
  title: string;
  schedule: string;
  meta: string;
}

/**
 * Ringkasan satu baris riwayat reservasi untuk modal customer.
 *
 * Sumber field mengikuti payload `GET /api/admin/customers/:id`:
 * - nama layanan: `treatment_detail` (fallback `raw_text`) — TIDAK ada `treatment_name`
 * - jadwal: `booking_date` (DateTime) — TIDAK ada `booking_time`
 * - pelengkap: `assigned_staff.name`, `purchase_value`
 */
export function buildReservationHistorySummary(r: any): ReservationHistorySummary {
  const title = getCleanTreatmentName(r?.treatment_detail || r?.raw_text);

  const dateLabel = formatWib(r?.booking_date, { dateStyle: 'medium' });
  const clockLabel = formatWibClock(r?.booking_date).replace('.', ':');
  const schedule = dateLabel
    ? clockLabel
      ? `${dateLabel} • ${clockLabel}`
      : dateLabel
    : 'Tanpa jadwal';

  const staffName = r?.assigned_staff?.name || r?.assigned_staff_name || '';
  const value = Number(r?.purchase_value);
  const valueLabel = Number.isFinite(value) && value > 0
    ? `Rp ${value.toLocaleString('id-ID')}`
    : '';
  const meta = [staffName, valueLabel].filter(Boolean).join(' · ');

  return { title, schedule, meta };
}
