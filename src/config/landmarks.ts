/**
 * landmarks.ts
 * Kamus pemetaan Landmark, Apartemen, Mall, dan Perumahan Populer
 * di Surabaya dan Sidoarjo ke Kelurahan & Kecamatan resmi beserta koordinat presisi.
 *
 * CFG-09: Data statis 800 baris dipisahkan ke landmarks.data.json agar kode runtime
 * tetap modular, ringan, dan data dapat diperbarui tanpa mengubah kode TypeScript.
 */

import fs from 'fs';
import path from 'path';

export interface LandmarkEntry {
  name: string;
  patterns: RegExp[];
  kelurahan: string;
  kecamatan: string;
  kota: string;
  lat?: number;
  lng?: number;
}

interface RawLandmarkEntry {
  name: string;
  patterns: Array<{ source: string; flags: string }>;
  kelurahan: string;
  kecamatan: string;
  kota: string;
  lat?: number;
  lng?: number;
}

function resolveLandmarksDataPath(): string {
  const localDistOrSrc = path.join(__dirname, 'landmarks.data.json');
  if (fs.existsSync(localDistOrSrc)) return localDistOrSrc;
  const projectSrc = path.join(process.cwd(), 'src', 'config', 'landmarks.data.json');
  if (fs.existsSync(projectSrc)) return projectSrc;
  const projectDist = path.join(process.cwd(), 'dist', 'config', 'landmarks.data.json');
  if (fs.existsSync(projectDist)) return projectDist;
  return localDistOrSrc;
}

export function loadLandmarks(): LandmarkEntry[] {
  try {
    const dataPath = resolveLandmarksDataPath();
    if (fs.existsSync(dataPath)) {
      const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8')) as RawLandmarkEntry[];
      return raw.map((item) => ({
        name: item.name,
        patterns: item.patterns.map((p) => new RegExp(p.source, p.flags)),
        kelurahan: item.kelurahan,
        kecamatan: item.kecamatan,
        kota: item.kota,
        lat: item.lat,
        lng: item.lng,
      }));
    }
  } catch (err: any) {
    console.warn('[LANDMARKS] Failed to load landmarks.data.json, fallback empty:', err?.message);
  }
  return [];
}

export const POPULAR_LANDMARKS: LandmarkEntry[] = loadLandmarks();

export function findPopularLandmark(text: string): LandmarkEntry | null {
  if (!text) return null;
  const normalized = text.toLowerCase();
  for (const entry of POPULAR_LANDMARKS) {
    for (const pattern of entry.patterns) {
      if (pattern.test(normalized)) {
        return entry;
      }
    }
  }
  return null;
}

// =========================================================================
// KORIDOR ARTERI (Plan 6 FASE 3, Issue #21)
// Nama jalan arteri populer yang disebut TANPA awalan "Jl." — dipetakan ke
// kelurahan/kecamatan induk agar ter-resolve tanpa menodong customer.
// =========================================================================

export interface ArteryCorridor {
  /** Frasa kanonis ternormalisasi (lowercase, spasi tunggal). */
  key: string;
  kelurahan: string;
  kecamatan: string;
}

export const ARTERY_CORRIDORS: ArteryCorridor[] = [
  { key: 'klampis jaya', kelurahan: 'Klampis Ngasem', kecamatan: 'Sukolilo' },
  { key: 'bronggalan', kelurahan: 'Pacar Keling', kecamatan: 'Tambaksari' },
  { key: 'kertajaya', kelurahan: 'Kertajaya', kecamatan: 'Gubeng' },
  { key: 'mayjen sungkono', kelurahan: 'Gunung Sari', kecamatan: 'Dukuh Pakis' },
  { key: 'hr muhammad', kelurahan: 'Pradah Kalikendal', kecamatan: 'Dukuh Pakis' },
  { key: 'dharmahusada', kelurahan: 'Mojo', kecamatan: 'Gubeng' },
  { key: 'raya darmo', kelurahan: 'Darmo', kecamatan: 'Wonokromo' },
  { key: 'tropodo', kelurahan: 'Tropodo', kecamatan: 'Waru' },
  { key: 'pepelegi', kelurahan: 'Pepelegi', kecamatan: 'Waru' },
  { key: 'pondok jati', kelurahan: 'Pagerwojo', kecamatan: 'Buduran' },
  // Agenda 1 Fase 4: koridor Surabaya Selatan & perbatasan Waru.
  { key: 'kutisari', kelurahan: 'Kutisari', kecamatan: 'Tenggilis Mejoyo' },
  { key: 'kendangsari', kelurahan: 'Kendangsari', kecamatan: 'Tenggilis Mejoyo' },
  { key: 'panjang jiwo', kelurahan: 'Panjang Jiwo', kecamatan: 'Tenggilis Mejoyo' },
  { key: 'pondok tjandra', kelurahan: 'Tambaksumur', kecamatan: 'Waru' },
  { key: 'pondok candra', kelurahan: 'Tambaksumur', kecamatan: 'Waru' },
  { key: 'rewwin', kelurahan: 'Wedoro', kecamatan: 'Waru' },
];

const ARTERY_SORTED = [...ARTERY_CORRIDORS].sort((a, b) => b.key.length - a.key.length);

/**
 * Resolve teks lokasi ke koridor arteri (atau null). Murni data — tanpa I/O.
 */
export function resolveArteryCorridor(text: string): ArteryCorridor | null {
  if (!text || typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  const normalized = ' ' + lower.replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  const words = new Set(lower.split(/[^a-z0-9]+/).filter(Boolean));
  if (!lower.trim()) return null;
  for (const c of ARTERY_SORTED) {
    if (c.key.includes(' ')) {
      if (normalized.includes(' ' + c.key + ' ')) return c;
    } else if (words.has(c.key)) {
      return c;
    }
  }
  return null;
}
