import { staffDisplayName, staffShortName } from './resolveStaffName';

export interface StaffOwnership {
  ownerStaffId: string | null;
  ownerStaffName: string | null;
  ownerSince: string | null;
  lastStaffId: string | null;
  lastStaffName: string | null;
  lastVisitDate: string | null;
  totalVisits: number;
  hasRotation: boolean;
  ownerInactive?: boolean;
}

export type OwnershipTone = 'violet' | 'amber' | 'gray' | 'neutral';

export interface OwnershipBadgeModel {
  show: boolean;
  label: string;
  tone: OwnershipTone;
  tooltip: string;
}

export function formatOwnershipDate(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });
}

export function resolveOwnershipBadge(
  ownership: StaffOwnership | null | undefined,
  opts?: { compact?: boolean; showNew?: boolean }
): OwnershipBadgeModel {
  const compact = opts?.compact ?? false;
  if (!ownership) {
    return {
      show: opts?.showNew === true,
      label: 'Pasien baru',
      tone: 'neutral',
      tooltip: 'Belum ada kunjungan selesai — belum ada bidan pemilik.',
    };
  }

  const ownerFull = ownership.ownerStaffName ? staffDisplayName(ownership.ownerStaffName) : '';
  const ownerShort = ownership.ownerStaffName ? staffShortName(ownership.ownerStaffName) : '';
  const lastFull = ownership.lastStaffName ? staffDisplayName(ownership.lastStaffName) : '';
  const lastShort = ownership.lastStaffName ? staffShortName(ownership.lastStaffName) : '';
  const ownerLabel = compact ? ownerShort : ownerFull;
  const lastLabel = compact ? lastShort : lastFull;

  if (!ownership.ownerStaffId && ownership.totalVisits > 0) {
    return {
      show: true,
      label: 'Bidan belum tercatat',
      tone: 'gray',
      tooltip: 'Ada kunjungan selesai, tetapi bidan pada kunjungan pertama belum tercatat.',
    };
  }

  if (!ownership.ownerStaffId) {
    return {
      show: opts?.showNew === true,
      label: 'Pasien baru',
      tone: 'neutral',
      tooltip: 'Belum ada kunjungan selesai — belum ada bidan pemilik.',
    };
  }

  const since = formatOwnershipDate(ownership.ownerSince);
  const lastDate = formatOwnershipDate(ownership.lastVisitDate);

  if (ownership.ownerInactive) {
    return {
      show: true,
      label: `${ownerLabel} (nonaktif)`,
      tone: 'gray',
      tooltip: `Pemilik retensi: ${ownerFull} — sejak ${since}. Staf sudah nonaktif.`,
    };
  }

  if (ownership.hasRotation && lastLabel) {
    return {
      show: true,
      label: compact ? `${ownerLabel} · ${lastLabel}` : `${ownerLabel} · terakhir ${lastLabel}`,
      tone: 'amber',
      tooltip: `Pemilik retensi: ${ownerFull} — sejak ${since}. Terakhir ditangani ${lastFull || '-'} (${lastDate}).`,
    };
  }

  return {
    show: true,
    label: compact ? ownerLabel : `Milik ${ownerLabel}`,
    tone: 'violet',
    tooltip: `Pemilik retensi: ${ownerFull} — sejak ${since}. ${ownership.totalVisits} kunjungan.`,
  };
}
