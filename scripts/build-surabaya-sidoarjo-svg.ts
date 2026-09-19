import fs from 'fs';
import path from 'path';

const GEO_URL = 'https://raw.githubusercontent.com/JfrAziz/indonesia-district/master/id35_jawa_timur/id35_jawa_timur_district.geojson';
const ROOT_DIR = 'c:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot';
const OUT_DIR = path.join(ROOT_DIR, 'packages/admin-dashboard/public/geo');

interface GeoFeature {
  type: string;
  properties: {
    country_code: string;
    province: string;
    regency: string;
    district: string;
    village: string;
    village_code?: string;
    district_code?: string;
    [key: string]: any;
  };
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: any[];
  };
}

const DECIMAL = 4;
const snap = (v: number) => Number(v.toFixed(DECIMAL));
const GRID = 0.0002; // ~22m: kedua sisi boundary yang terdigitalisasi ulang (~10m offset) menyatu di grid ini
const MIN_VLINE = 0.00015; // toleransi DP untuk border (~17m)
const VILLAGE_SIMPLIFY_DEG = 0.0015; // min jarak antar titik poligon kelurahan

const cellKey = (lng: number, lat: number) => `${Math.round(lng / GRID)}:${Math.round(lat / GRID)}`;

/** Simplifikasi ring (min-grid-step) realistis untuk gap antar titik. */
function simplifyRing(ring: number[][], minDeg = VILLAGE_SIMPLIFY_DEG): number[][] {
  const out: number[][] = [];
  for (const p of ring) {
    const r = [snap(p[0]), snap(p[1])];
    if (out.length === 0) {
      out.push(r);
    } else {
      const last = out[out.length - 1];
      if (Math.hypot(r[0] - last[0], r[1] - last[1]) >= minDeg) {
        out.push(r);
      }
    }
  }
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < minDeg) out.pop();
  }
  return out.length >= 3 ? out : ring.map((p) => [snap(p[0]), snap(p[1])]);
}

/** Douglas-Peucker untuk meratakan polylines border pasca-dissolve. */
function dp(pts: number[][], eps: number): number[][] {
  if (pts.length <= 2) return pts;
  let maxD = -1;
  let idx = 0;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const denom = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-12;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / denom;
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps) {
    const l = dp(pts.slice(0, idx + 1), eps);
    const r = dp(pts.slice(idx), eps);
    return [...l.slice(0, -1), ...r];
  }
  return [a, b];
}

function exteriorRingOf(f: GeoFeature): number[][] | null {
  const geo = f.geometry as any;
  const polys = geo.type === 'MultiPolygon' ? geo.coordinates : [geo.coordinates];
  for (const poly of polys) {
    if (Array.isArray(poly) && poly.length && Array.isArray(poly[0]) && Array.isArray(poly[0][0])) {
      return poly[0] as number[][];
    }
  }
  return null;
}

async function main() {
  const t0 = Date.now();
  console.log('[BUILD GEO] Kompilasi batas topologis Sby & Sda (grid-snap dissolve)...');
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const res = await fetch(GEO_URL);
  if (!res.ok) throw new Error(`Gagal mengunduh GeoJSON: ${res.status} ${res.statusText}`);
  const fullData = (await res.json()) as { features: GeoFeature[] };
  console.log(`[BUILD GEO] Data diunduh. Total fitur: ${fullData.features.length}`);

  const sbySda = fullData.features.filter((f) => {
    const reg = (f.properties?.regency || '').toLowerCase();
    return reg.includes('surabaya') || reg.includes('sidoarjo');
  });
  console.log(`[BUILD GEO] Surabaya & Sidoarjo: ${sbySda.length} kelurahan/desa.`);

  const regencyLabel = (f: GeoFeature) =>
    f.properties.regency.includes('Surabaya') ? 'Surabaya' : 'Sidoarjo';

  // ---- 1. Snap ring ke grid + kumpulkan edge multiset ---- //
  const rings: { regency: string; district: string; village: string; pts: string[] }[] = [];
  const cellCoord = new Map<string, [number, number]>(); // node grid -> koordinat perwakilan

  for (const f of sbySda) {
    const reg = regencyLabel(f);
    const dist = f.properties.district || '';
    const village = f.properties.village || '';
    const ring = exteriorRingOf(f);
    if (!ring) continue;
    const pts: string[] = [];
    let prev: string | null = null;
    for (const [lng, lat] of ring) {
      const c = cellKey(lng, lat);
      if (c !== prev) {
        pts.push(c);
        prev = c;
      }
      if (!cellCoord.has(c)) cellCoord.set(c, [snap(lng), snap(lat)]);
    }
    if (pts.length > 1 && pts[0] === pts[pts.length - 1]) pts.pop();
    rings.push({ regency: reg, district: dist, village, pts });
  }
  console.log(`[BUILD GEO] Ring: ${rings.length} | node grid unik: ${cellCoord.size}`);

  // edge multiset: kunci edge undirected -> daftar owner ring
  const edgeMap = new Map<string, { ringIdx: number; a: string; b: string }[]>();
  for (let ri = 0; ri < rings.length; ri++) {
    const p = rings[ri];
    for (let i = 0; i < p.pts.length; i++) {
      const a = p.pts[i];
      const b = p.pts[(i + 1) % p.pts.length];
      if (a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (!edgeMap.has(k)) edgeMap.set(k, []);
      edgeMap.get(k)!.push({ ringIdx: ri, a, b });
    }
  }
  console.log(`[BUILD GEO] Edge unik pasca grid-snap: ${edgeMap.size}`);

  // ---- 2. Dissolve: klasifikasi per edge berdasarkan owner pair ---- //
  // 1 owner → perimeter terluar kesatuan → regency border
  // 2+ owner: sama kecamatan → internal (dibuang); beda kecamatan = beda kotkab → regency; beda kecamatan = sama kotkab → district
  const cls = new Map<string, 'reg' | 'dis' | 'drop'>();
  for (const [k, owners] of edgeMap) {
    if (owners.length === 1) {
      cls.set(k, 'reg');
      continue;
    }
    const ring = (i: number) => rings[owners[i].ringIdx];
    const dists = new Set(owners.map((_, i) => ring(i).district));
    const regs = new Set(owners.map((_, i) => ring(i).regency));
    if (dists.size === 1) cls.set(k, 'drop');
    else if (regs.size === 1) cls.set(k, 'dis');
    else cls.set(k, 'reg');
  }
  let cReg = 0;
  let cDis = 0;
  let cDrop = 0;
  for (const c of cls.values()) {
    if (c === 'reg') cReg++;
    else if (c === 'dis') cDis++;
    else cDrop++;
  }
  console.log(`[BUILD GEO] Klasifikasi → regency: ${cReg}, district: ${cDis}, internal dibuang: ${cDrop}`);

  // ---- 3. Stitch: rangkai per rantai degree-2, stop di junction ---- //
  const nodeDeg = new Map<string, number>();
  const nodeAdj = new Map<string, Set<string>>();
  for (const [k] of edgeMap) {
    if (cls.get(k) === 'drop') continue;
    const [A, B] = k.split('|');
    for (const n of [A, B]) {
      nodeDeg.set(n, (nodeDeg.get(n) || 0) + 1);
      if (!nodeAdj.has(n)) nodeAdj.set(n, new Set());
      nodeAdj.get(n)!.add(k);
    }
  }

  const used = new Set<string>();
  const lines: string[][] = [];
  for (const [k] of edgeMap) {
    if (cls.get(k) === 'drop' || used.has(k)) continue;
    used.add(k);
    const [A, B] = k.split('|');
    const line: string[] = [A, B];
    const extend = (head: string, atStart: boolean) => {
      for (;;) {
        if ((nodeDeg.get(head) | 0) !== 2) break;
        const candidates = [...(nodeAdj.get(head) || [])].filter((e) => !used.has(e) && e !== k);
        if (candidates.length !== 1) break;
        const ne = candidates[0];
        used.add(ne);
        const [a2, b2] = ne.split('|');
        const nn = a2 === head ? b2 : a2;
        if (atStart) line.unshift(nn);
        else line.push(nn);
        head = nn;
        if (nn === A || nn === B) break;
      }
    };
    extend(A, true);
    extend(B, false);
    const clean: string[] = [];
    for (const n of line) if (clean[clean.length - 1] !== n) clean.push(n);
    lines.push(clean);
  }

  // ---- 4. Konversi node → lonlat, simplifikasi DP, filter fragmen kecil ---- //
  const toLL = (ln: string[]) => ln.map((n) => cellCoord.get(n) || [0, 0]);
  const regPolylines: number[][][] = [];
  const disPolylines: number[][][] = [];
  for (const ln of lines) {
    if (ln.length < 2) continue;
    const t = { reg: 0, dis: 0 };
    for (let i = 0; i < ln.length - 1; i++) {
      const a = ln[i];
      const b = ln[i + 1];
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (cls.get(k) === 'reg') t.reg++;
      else t.dis++;
    }
    const arr = dp(toLL(ln), MIN_VLINE);
    if (arr.length < 2) continue;
    if (t.reg > t.dis) regPolylines.push(arr);
    else disPolylines.push(arr);
  }
  const MIN_LINE_PTS = 4;
  const regKept = regPolylines.filter((l) => l.length > MIN_LINE_PTS);
  const disKept = disPolylines.filter((l) => l.length > MIN_LINE_PTS);
  console.log(`[BUILD GEO] Polylines → regency: ${regKept.length}, district: ${disKept.length} (total ${regKept.length + disKept.length})`);

  // ---- 5. Features village (ring disederhanakan) ---- //
  const villageFeatures: any[] = [];
  for (const f of sbySda) {
    const meta = {
      regency: regencyLabel(f),
      district: f.properties.district || '',
      village: f.properties.village || '',
      level: 'village',
    };
    const geo = f.geometry as any;
    let geom: any;
    if (geo.type === 'Polygon') {
      const ringsGeom = geo.coordinates.map((r: number[][]) => simplifyRing(r));
      geom = { type: 'Polygon', coordinates: ringsGeom };
    } else {
      geom = {
        type: 'MultiPolygon',
        coordinates: geo.coordinates.map((poly: number[][][]) => poly.map((r: number[][]) => simplifyRing(r))),
      };
    }
    villageFeatures.push({ type: 'Feature', properties: meta, geometry: geom });
  }

  const borderFeatures = [
    {
      type: 'Feature',
      properties: { level: 'regency_border', name: 'Perbatasan Kota/Kabupaten' },
      geometry: { type: 'MultiLineString', coordinates: regKept },
    },
    {
      type: 'Feature',
      properties: { level: 'district_border', name: 'Perbatasan Kecamatan' },
      geometry: { type: 'MultiLineString', coordinates: disKept },
    },
  ];

  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  const ringsOf = (f: any) => (f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates.flat(1));
  for (const f of villageFeatures)
    for (const r of ringsOf(f) as number[][]) {
      for (const [lng, lat] of r) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      }
    }
  const padding = 0.015;

  const geoJsonObj = {
    type: 'FeatureCollection',
    metadata: {
      source: 'HDX-BPS-2020 (JfrAziz/indonesia-district) + dissolve grid-snap 22m',
      totalDistricts: new Set(sbySda.map((f) => `${regencyLabel(f)}|${f.properties.district}`)).size,
      bbox: {
        minLat: Number((minLat - padding).toFixed(5)),
        maxLat: Number((maxLat + padding).toFixed(5)),
        minLng: Number((minLng - padding).toFixed(5)),
        maxLng: Number((maxLng + padding).toFixed(5)),
      },
      generatedAt: new Date().toISOString(),
    },
    features: [...villageFeatures, ...borderFeatures],
  };

  const geoJsonPath = path.join(OUT_DIR, 'surabaya-sidoarjo.geojson');
  const json = JSON.stringify(geoJsonObj);
  fs.writeFileSync(geoJsonPath, json, 'utf-8');
  console.log(`[BUILD GEO] GeoJSON tersimpan: ${geoJsonPath} (${(Buffer.byteLength(json) / 1024).toFixed(1)} KB)`);

  fs.writeFileSync(path.join(OUT_DIR, 'geo-metadata.json'), JSON.stringify(geoJsonObj.metadata, null, 2), 'utf-8');
  console.log(`[BUILD GEO] Selesai dalam ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('[BUILD GEO] Error:', err);
  process.exit(1);
});