/**
 * Utilitas usia klinis seragam (frontend) — cermin dari engine backend
 * `src/utils/age-calculator.ts`. Satu sumber format agar tidak ada lagi
 * label mati seperti "36hr" / "23bln" di seluruh dashboard.
 */

export interface MomGestationalInfo {
  isPregnant: boolean;
  currentWeeks?: number;
  stageLabel: string;
}

const DAY_MS = 1000 * 60 * 60 * 24;

function daysBetween(from: Date, to: Date): number {
  if (!from || !to || to < from) return 0;
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

function monthsBetween(from: Date, to: Date): number {
  if (!from || !to || to < from) return 0;
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/**
 * Format usia klinis seragam, presisi hari terhadap `today`:
 * - < 30 hari            → "X hari"
 * - 30 hari s/d 2 tahun  → "X bulan Y hari" (Y dihilangkan bila 0)
 * - > 2 tahun            → "X tahun Y bulan" (Y dihilangkan bila 0)
 * Mengembalikan '' bila tanggal tidak valid.
 */
export function formatClinicalAge(birthDate: string | Date | null | undefined, today: Date = new Date()): string {
  if (!birthDate) return '';
  const d = birthDate instanceof Date ? birthDate : new Date(birthDate);
  if (isNaN(d.getTime())) return '';

  const totalDays = daysBetween(d, today);
  if (totalDays <= 0) return 'Baru lahir';
  if (totalDays < 30) return `${totalDays} hari`;

  const months = monthsBetween(d, today);
  if (totalDays < 730) {
    if (months < 1) return `${totalDays} hari`;
    const remDays = daysBetween(addMonths(d, months), today);
    return remDays > 0 ? `${months} bulan ${remDays} hari` : `${months} bulan`;
  }

  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  return remMonths > 0 ? `${years} tahun ${remMonths} bulan` : `${years} tahun`;
}

/** Emoji + label badge Moms dari `mom_gestational_info` (deterministik backend). */
export function momGestationalBadge(info?: MomGestationalInfo | null): string {
  if (!info || !info.stageLabel) return '';
  const emoji = info.isPregnant ? '🤰' : '🤱';
  return `${emoji} ${info.stageLabel}`;
}

export interface ChildAgeRow {
  name: string;
  age: string;
  regAge?: string;
}

/**
 * Resolusi baris anak dengan usia klinis seragam — urutan prioritas:
 * children (current_age) → baby_details → ekstraksi raw_text.
 * `birthDateFallback`/`formatFromBirth` dipakai saat backend belum mengirim current_age.
 */
export function resolveChildAgeRows(
  res: {
    customer?: { children?: Array<{ name: string; current_age?: string; raw_age_text?: string | null; birth_date?: string | null }> } | null;
    baby_details?: Array<{ name: string; age: string }>;
    raw_text?: string | null;
    treatment_detail?: string | null;
  } | null,
  extractFromRaw?: (rawText: string | null | undefined, detail?: string | null) => Array<{ name: string; age: string }>
): ChildAgeRow[] {
  if (!res) return [];
  const children = res.customer?.children;
  if (children && children.length > 0) {
    return children.map((c) => {
      const live = c.current_age || formatClinicalAge(c.birth_date);
      return { name: c.name, age: live || c.raw_age_text || '', regAge: c.raw_age_text || undefined };
    });
  }
  const bd = res.baby_details;
  if (bd && bd.length > 0) return bd.map((b) => ({ name: b.name, age: b.age }));
  if (extractFromRaw) return extractFromRaw(res.raw_text, res.treatment_detail).map((b) => ({ name: b.name, age: b.age }));
  return [];
}
