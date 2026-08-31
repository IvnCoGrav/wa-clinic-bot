import fs from 'fs';
import path from 'path';

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let cachedGazetteerAreas: Map<string, string> | null = null;

export function getGazetteerAreas(): Map<string, string> {
  if (cachedGazetteerAreas) return cachedGazetteerAreas;
  const map = new Map<string, string>();
  try {
    const candidates = [
      path.join(process.cwd(), 'src', 'config', 'surabaya_sidoarjo_subdistricts.json'),
      path.join(process.cwd(), 'dist', 'config', 'surabaya_sidoarjo_subdistricts.json'),
      path.resolve(__dirname, '../config/surabaya_sidoarjo_subdistricts.json'),
      path.resolve(__dirname, '../../src/config/surabaya_sidoarjo_subdistricts.json'),
      path.resolve(__dirname, '../../../src/config/surabaya_sidoarjo_subdistricts.json'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        const data = JSON.parse(fs.readFileSync(c, 'utf-8'));
        for (const item of data) {
          if (item.Kelurahan_Desa) {
            const raw = item.Kelurahan_Desa.trim();
            const lower = raw.toLowerCase();
            if (lower.length >= 3 && !['surabaya', 'sidoarjo', 'desa', 'kota'].includes(lower)) {
              map.set(lower, raw);
            }
          }
          if (item.Kecamatan) {
            const raw = item.Kecamatan.trim();
            const lower = raw.toLowerCase();
            if (lower.length >= 3 && !['surabaya', 'sidoarjo', 'kota'].includes(lower)) {
              map.set(lower, raw);
            }
          }
        }
        break;
      }
    }
  } catch (_) {}
  cachedGazetteerAreas = map;
  return map;
}
