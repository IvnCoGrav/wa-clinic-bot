import React from 'react';

export interface MetricBasisBadgeProps {
  label?: string;
  basis?: 'booking_date' | 'created_at' | 'all_time' | string;
  statusFilter?: string;
  includesPending?: boolean;
  includesUpcoming?: boolean;
  includesDeliveryFee?: boolean;
  isEstimate?: boolean;
  className?: string;
}

export const MetricBasisBadge: React.FC<MetricBasisBadgeProps> = ({
  label,
  basis,
  statusFilter,
  includesPending,
  includesUpcoming,
  includesDeliveryFee,
  isEstimate,
  className = '',
}) => {
  // Tentukan teks tampilan ringkas
  let badgeText = label;
  if (!badgeText) {
    if (basis === 'booking_date') badgeText = 'Basis Jadwal Treatment';
    else if (basis === 'created_at') badgeText = 'Basis Tgl Dibuat (Cohort)';
    else if (basis === 'all_time') badgeText = 'Basis All-Time';
    else badgeText = 'Basis Standar';
  }

  // Tentukan rincian tooltip
  const details: string[] = [];
  if (label) details.push(label);
  if (basis) {
    details.push(
      basis === 'booking_date'
        ? 'Tanggal reservasi (booking_date)'
        : basis === 'created_at'
        ? 'Tanggal pembuatan booking (created_at)'
        : `Basis: ${basis}`
    );
  }
  if (statusFilter) details.push(`Filter: ${statusFilter}`);
  if (includesPending !== undefined) {
    details.push(includesPending ? 'Termasuk tagihan' : 'Hanya lunas');
  }
  if (includesUpcoming !== undefined) {
    details.push(includesUpcoming ? 'Termasuk jadwal mendatang' : 'Tanpa jadwal mendatang');
  }
  if (includesDeliveryFee !== undefined) {
    details.push(includesDeliveryFee ? 'Termasuk ongkir' : 'Tanpa ongkir');
  }
  if (isEstimate) {
    details.push('Nilai estimasi (fallback katalog)');
  }

  const tooltip = details.join(' • ');

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-info-soft text-info border-info-line select-none ${className}`}
      title={tooltip}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-info animate-pulse" />
      <span>{badgeText}</span>
    </span>
  );
};
