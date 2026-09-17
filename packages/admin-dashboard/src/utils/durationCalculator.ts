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
/**
 * Buang metadata audiens terstruktur dari `treatment_detail` DB
 * ("Baby: X (Bayi: nama, Usia: y) | Moms: Z (Kehamilan: w)") agar tidak
 * terhitung sebagai item layanan hantu.
 */
function stripStructuredMetadata(text: string): string {
  let s = text;
  for (let i = 0; i < 3; i++) {
    s = s.replace(/\(\s*(?:bayi|anak|pasien|kehamilan|usia)\s*:[^()]*\)/gi, ' ');
  }
  s = s.replace(/\b(?:baby|moms|kids|combination|pasien|bayi|anak|balita)\s*:/gi, ' ');
  s = s.replace(/\|/g, ' + ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Pecah item pada pemisah + , & dan — hanya di kedalaman kurung 0. */
function splitTopLevelItems(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0) {
      if (ch === '+' || ch === ',' || ch === '&') {
        out.push(current);
        current = '';
        continue;
      }
      if (ch === ' ') {
        if (/^ dan\s/.test(text.slice(i).toLowerCase())) {
          out.push(current);
          current = '';
          i += 3;
          continue;
        }
      }
    }
    current += ch;
  }
  out.push(current);
  return out
    .map((s) => s.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 2);
}

export function extractDurationMinutes(detail?: string | null): number {
  if (!detail || typeof detail !== 'string') return 60;

  const text = stripStructuredMetadata(detail.trim());
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

  // 6. Bundling multi-item: bedakan layanan utama vs add-on secara semantik
  // (bukan `items.length * 60 + 15` yang mengasumsikan SEMUA item = 60 menit).
  // - Add-on (moksa/cukur/tindik 15m, nebulizer 20m) TIDAK menambah buffer kunjungan.
  // - Buffer transisi 15m hanya bila ADA >= 2 layanan utama dalam satu kunjungan.
  // Catatan lapisan: util ini presentasi tanpa akses katalog tenant; nilai otoritatif
  // tetap kolom DB `duration_minutes` (lihat resolveReservationDuration) yang kini
  // selalu terisi dari katalog backend.
  const items = splitTopLevelItems(text);
  if (items.length > 1) {
    const isAddonItem = (s: string) => {
      const lower = s.toLowerCase();
      return lower.includes('moksa') || lower.includes('moxa') || lower.includes('cukur') ||
        lower.includes('tindik') || lower.includes('nebulizer') || lower.includes('add-on') ||
        lower.includes('addon');
    };
    let sum = 0;
    let mainCount = 0;
    for (const item of items) {
      if (isAddonItem(item)) {
        sum += item.toLowerCase().includes('nebulizer') ? 20 : 15;
      } else {
        sum += 60;
        mainCount++;
      }
    }
    if (mainCount >= 2) sum += 15;
    return Math.min(300, sum);
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
 * Durasi efektif sebuah reservasi: utamakan kolom `duration_minutes` dari DB
 * (diisi saat Quick Hold / Buat Reservasi Manual), fallback ke parsing teks
 * `treatment_detail` agar data lama tetap tampil benar.
 */
export function resolveReservationDuration(res: { duration_minutes?: number | null; treatment_detail?: string | null }): number {
  const stored = Number((res as any)?.duration_minutes);
  if (isFinite(stored) && stored > 0) return Math.min(480, Math.round(stored));
  return extractDurationMinutes(res?.treatment_detail);
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
