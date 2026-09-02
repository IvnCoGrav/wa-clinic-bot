import { extractDurationMinutes } from './durationCalculator';

/**
 * Shared UI Formatter — Single Source of Truth untuk pembersihan treatment_detail
 * Mendukung: prefix kategori (Baby/Moms/Kids/Both/Bundle), kurung verbose (Bayi/Usia/Kehamilan), tag durasi [Total ...], pemisah + atau |
 */
export function getCleanTreatmentName(detail: string | null | undefined): string {
  if (!detail) return 'Layanan Perawatan';
  const sesiMatch = detail.match(/\[Sesi[^\]]*\]/i);
  const sesiTag = sesiMatch ? ` ${sesiMatch[0]}` : '';
  let main = detail.split('[Total')[0].trim();
  main = main.replace(/\[Sesi[^\]]*\]/gi, '').trim();
  const parts = main.split(/\s*(?:\+|\|)\s*/);
  const cleaned = parts
    .map((p) => {
      p = p.replace(/^(Baby|Kids|MOMS|BOTH|BUNDLE):\s*/i, '');
      p = p.replace(/\([^)]*\)/g, '').trim();
      p = p.replace(/\[[^\]]*\]/g, '').trim();
      p = p.replace(/\bUsia:\s*[^,)]+/gi, '').trim();
      p = p.replace(/\bKehamilan:\s*[^,)]+/gi, '').trim();
      p = p.replace(/\s{2,}/g, ' ').trim();
      p = p.replace(/^[.,|+\-\s]+|[.,|+\-\s]+$/g, '').trim();
      if (!p) return '';
      return p
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
        .replace(/\bPijat\b/gi, 'Pijat')
        .replace(/\bOksitosin\b/gi, 'Oksitosin');
    })
    .filter(Boolean);
  const base = cleaned.join(' + ') || 'Layanan Perawatan';
  return (base + sesiTag).trim();
}

export function getTotalDurationLabel(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const m = detail.match(/\[Total[^\]]*=\s*([^\]]+)\]/i) || detail.match(/\[Total\s+([^\]]+)\]/i);
  if (m) return `Total ${m[1].trim()}`;
  const dur = extractDurationMinutes(detail);
  if (dur) return `Total ${dur} menit`;
  return null;
}

export { extractDurationMinutes };
