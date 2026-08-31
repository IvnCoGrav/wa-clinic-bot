/**
 * durationCalculator.ts
 * Utilitas terpusat untuk menghitung durasi total reservasi (termasuk buffer)
 * dan memformat nama treatment secara bersih untuk tampilan kartu kalender.
 */

/**
 * Mengekstrak durasi total reservasi dalam satuan menit (termasuk waktu buffer).
 * Mendukung berbagai format string `treatment_detail`:
 * - "[Total 120m + Buffer 15m = 135m]" -> 135
 * - "[Total 45m + Buffer 15m = 60m]"  -> 60
 * - "[Total 60m + Buffer 15m = 75m]"  -> 75
 * - "[Total 120m + Buffer 15m]"        -> 135
 * - "[Total 90m]"                      -> 90
 * - "Pijat Bayi [60m] + Buffer [15m]"  -> 75
 * - "60 menit + 15 menit buffer"       -> 75
 */
export function extractDurationMinutes(detail?: string | null): number {
  if (!detail || typeof detail !== 'string') return 60;

  const text = detail.trim();
  if (!text) return 60;

  // 1. Tag eksplisit hasil perhitungan dengan buffer:
  // Contoh: "[Total 120m + Buffer 15m = 135m]" atau "[Total = 135m]" atau "= 135m]"
  const equalsMatch = text.match(/=\s*(\d+)\s*(?:m|menit|mins?)\b/i);
  if (equalsMatch && equalsMatch[1]) {
    const num = parseInt(equalsMatch[1], 10);
    if (!isNaN(num) && num > 0) return num;
  }

  // 2. Tag eksplisit Total + Buffer tanpa tanda sama dengan:
  // Contoh: "[Total 120m + Buffer 15m]" atau "Total 60m + Buffer 15m"
  const totalBufferMatch = text.match(/Total\s*(\d+)\s*m?\s*\+\s*Buffer\s*(\d+)\s*m?/i);
  if (totalBufferMatch && totalBufferMatch[1] && totalBufferMatch[2]) {
    const pure = parseInt(totalBufferMatch[1], 10);
    const buf = parseInt(totalBufferMatch[2], 10);
    if (!isNaN(pure) && !isNaN(buf) && (pure + buf) > 0) {
      return pure + buf;
    }
  }

  // 3. Tag eksplisit Total tunggal:
  // Contoh: "[Total 120m]" atau "[Total 90 mins]"
  const totalMatch = text.match(/\[\s*Total\s*(\d+)\s*(?:m|menit|mins?)\b/i);
  if (totalMatch && totalMatch[1]) {
    const num = parseInt(totalMatch[1], 10);
    if (!isNaN(num) && num > 0) return num;
  }

  // 4. Jika ada tag [XXm] terpisah untuk treatment dan buffer:
  // Misal: "Pijat Bayi [60m] + Buffer [15m]"
  const bracketMatches = text.match(/\[\s*(\d+)\s*(?:m|menit|mins?)\b/gi);
  if (bracketMatches && bracketMatches.length > 0) {
    let sum = 0;
    for (const b of bracketMatches) {
      const num = parseInt(b.replace(/\D/g, ''), 10);
      if (num > 0 && num <= 360) sum += num;
    }
    if (sum > 0) return sum;
  }

  // 5. Penjumlahan semua menit eksplisit dalam teks (misal: "60 menit + 15 menit buffer")
  const minMatches = text.match(/(\d+)\s*(?:menit|mins?|m\b)/gi);
  if (minMatches && minMatches.length > 0) {
    let sum = 0;
    for (const m of minMatches) {
      const num = parseInt(m.replace(/\D/g, ''), 10);
      if (num > 0 && num <= 360) sum += num;
    }
    if (sum > 0) return sum;
  }

  // 6. Deteksi bundling paket dengan pemisah '+' atau '&' atau 'dan'
  const items = text.split(/\s*(?:\+|\b(?:dan|&)\b)\s*/i).filter((s) => s.trim().length > 2);
  if (items.length > 1) {
    // 60m per treatment + 15m buffer
    return Math.min(300, items.length * 60 + 15);
  }

  // 7. Estimasi durasi dari kata kunci paket layanan
  const lower = text.toLowerCase();
  if (lower.includes('nifas') || lower.includes('hamil') || lower.includes('moms') || lower.includes('paket')) {
    return 90; // 75m treatment + 15m buffer
  }

  // 8. Default fallback layanan standar (45m/60m)
  return 60;
}

/**
 * Membersihkan rincian treatment agar tag summary durasi/buffer internal
 * tidak mengotori nama layanan pada kartu kalender.
 */
export function cleanTreatmentDetailForDisplay(detail?: string | null, category?: string | null): string {
  if (!detail) return category || 'Layanan Perawatan';
  return detail
    .replace(/\[\s*(?:Total\s*)?[^\]]*Buffer[^\]]*\]/gi, '')
    .replace(/\[\s*Total\s*\d+\s*m?\s*\+\s*Buffer\s*\d+\s*m?\s*=\s*\d+\s*m?\s*\]/gi, '')
    .replace(/\[\s*Total\s*=\s*\d+\s*m?\s*\]/gi, '')
    .replace(/\[\s*Total\s*\d+\s*m?\s*\]/gi, '')
    .trim() || detail;
}
