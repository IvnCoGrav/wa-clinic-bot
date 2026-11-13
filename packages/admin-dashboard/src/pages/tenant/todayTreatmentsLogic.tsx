/**
 * Helper tampilan dan waktu untuk daftar treatment harian tenant.
 */
import React from 'react';
import { Baby, Heart, Smile, User } from 'lucide-react';
import { parseTreatmentItems } from '../../utils/durationCalculator';
import { formatWibClock } from '../../utils/dateWib';
import { TreatmentTask } from './todayTreatmentsTypes';

/** Ikon, badge, dan aksen kategori treatment. */
export function getCategoryIcon(category: string | null) {
  const cat = (category || '').toUpperCase();
  if (cat === 'BABY') {
    return {
      icon: <Baby size={15} className="text-info" />,
      badge: 'bg-info-soft border-info-line text-info',
      borderAccent: 'border-l-4 border-l-sky-500',
      label: 'Baby Spa',
    };
  }
  if (cat === 'MOMS') {
    return {
      icon: <Heart size={15} className="text-violet" />,
      badge: 'bg-violet-soft border-violet-line text-violet',
      borderAccent: 'border-l-4 border-l-purple-500',
      label: 'Moms Spa',
    };
  }
  if (cat === 'BOTH' || cat === 'KIDS') {
    return {
      icon: <Smile size={15} className="text-success" />,
      badge: 'bg-success-soft border-success-line text-success',
      borderAccent: 'border-l-4 border-l-emerald-500',
      label: 'Moms & Baby',
    };
  }
  return {
    icon: <User size={15} className="text-success" />,
    badge: 'bg-success-soft border-success-line text-success',
    borderAccent: 'border-l-4 border-l-teal-500',
    label: 'Treatment',
  };
}

/** Apakah jam booking + durasi layanan sudah lewat (tanpa buffer perjalanan). */
export function isTaskPastTime(task: TreatmentTask): boolean {
  if (!task.bookingDate) return false;
  const startTime = new Date(task.bookingDate).getTime();
  if (isNaN(startTime)) return false;
  const parsed = parseTreatmentItems(task.treatmentDetail);
  const durationMinutes = parsed.totalMinutes > 0 ? parsed.totalMinutes : 60;
  return Date.now() >= startTime + durationMinutes * 60 * 1000;
}

/** Jam mulai dalam WIB, mis. "09:30". */
export function formatTime(isoString: string | null): string {
  if (!isoString) return '--:--';
  try {
    return formatWibClock(new Date(isoString));
  } catch {
    return '--:--';
  }
}

/** Rentang jam mulai sampai selesai, mis. "09:30 - 10:30". */
export function formatTimeRange(isoString: string | null, totalDurationMinutes?: number): string {
  if (!isoString) return '--:--';
  try {
    const start = new Date(isoString);
    const duration = totalDurationMinutes && totalDurationMinutes > 0 ? totalDurationMinutes : 60;
    const end = new Date(start.getTime() + duration * 60 * 1000);
    return `${formatWibClock(start)} - ${formatWibClock(end)}`;
  } catch {
    return '--:--';
  }
}
