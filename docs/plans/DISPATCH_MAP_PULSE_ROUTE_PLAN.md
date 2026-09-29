# Implementation Plan — Pulse Bullet Bidan + Garis Rute (Peta Perjalanan, Live Chat)

> **STATUS: Fase 1 + 2 SELESAI dieksekusi (2026-09-29, disetujui user).** Fase 3 (mobile) tetap OPEN.
> Verifikasi: test 12/12, `tsc` 0 error, dashboard build hijau, `animate-ping` + garis ter-generate di dist.
>
> Keputusan desain terkunci (sesuai diskusi): peta **tetap pisah** (use case beda),
> **tanpa** library/endpoint/halaman baru, **tanpa** call ORS. Semua reuse fitur existing.

## §0. Fakta terverifikasi (bukan klaim)

| Fakta | Bukti (`file:line`) |
|---|---|
| Peta perjalanan = `DispatchMapModal`, tile OSM statis, tanpa Leaflet | `packages/admin-dashboard/src/components/livechat/DispatchMapModal.tsx:1-10` |
| Marker statis digambar di baris 122–135 (titik hijau Bidan, merah pasien) | sama, baris 122–135 |
| Modal TIDAK menerima info kesegaran (props: `open/onClose/therapist/customer/areaName/staffName` saja) | sama, baris 12–19 |
| Util proyeksi murni `dispatchMap.ts` (`computeMapView` → pixel `x/y`), tanpa DOM | `packages/admin-dashboard/src/utils/dispatchMap.ts:102-158` |
| `computeMapView` hanya dipakai `DispatchMapModal`; modal hanya dipakai `LiveChatDispatchWidget` | grep 2026-09-29 (2 file) |
| Kesegaran sudah dihitung widget: `isFresh = lastUpdateSec < 60` | `packages/admin-dashboard/src/components/livechat/LiveChatDispatchWidget.tsx:67` |
| Widget memanggil modal TANPA freshness (baris 193–204) | sama |
| Legenda existing: hijau = Motor Bidan, merah = Rumah Pasien | `DispatchMapModal.tsx:96-106` |
| Test proyeksi existing (pola TDD yang dipakai ulang) | `tests/unit/dispatch-map-projection.test.ts` (105 baris) |
| Widget hanya tampil di `xl` (`hidden xl:flex`) | `packages/admin-dashboard/src/pages/tenant/LiveChatMonitor.tsx:5430` |
| Data realtime existing: SSE `staff.telemetry_updated`, endpoint `GET /api/admin/dispatch/trip/:id`, Haversine lokal (0 ORS) | terverifikasi sesi sebelumnya |

## §1. Fase 0 — Baseline gate (wajib hijau dulu)

- [ ] `0.1` Terminal (root repo): `npx vitest run tests/unit/dispatch-map-projection.test.ts` → hijau.
- [ ] `0.2` Terminal (`packages/admin-dashboard`): `npm run build` → hijau.
- [ ] `0.3` Jika salah satu merah → STOP, laporkan, jangan lanjut.

## §2. Fase 1 — Geometri rute + predikat pulse (murni, TDD) — file: `packages/admin-dashboard/src/utils/dispatchMap.ts` + `tests/unit/dispatch-map-projection.test.ts`

Prinsip: semua keputusan geometri di util murni (testable), komponen hanya render.

**Micro-task 1.1 — tambah tipe (append setelah `MapMarker`, ±baris 26):**
```ts
export interface MapRouteSegment { x1: number; y1: number; x2: number; y2: number; }
/** Setengah diameter dot marker px (w-3.5 = 14px) — anchor garis ke pusat dot. */
export const ROUTE_DOT_RADIUS_PX = 7;
```

**Micro-task 1.2 — tambah field ke `MapView` (±baris 28–35):**
```ts
route: MapRouteSegment | null;
```

**Micro-task 1.3 — hitung rute di `computeMapView` (setelah `outMarkers`, ±baris 142–148), sebelum `return`:**
```ts
const therapistMark = outMarkers.find((m) => m.kind === 'therapist');
const customerMark = outMarkers.find((m) => m.kind === 'customer');
let route: MapRouteSegment | null = null;
if (therapistMark && customerMark) {
  const dx = therapistMark.x - customerMark.x;
  const dy = therapistMark.y - customerMark.y;
  if (dx * dx + dy * dy >= 1) {
    route = {
      x1: therapistMark.x, y1: therapistMark.y - ROUTE_DOT_RADIUS_PX,
      x2: customerMark.x, y2: customerMark.y - ROUTE_DOT_RADIUS_PX,
    };
  }
}
```
Lalu: early-return `[]` (±baris 110) tambah `route: null`; return akhir (±baris 150–157) tambah `route,`.

**Micro-task 1.4 — predikat pulse (append akhir file, dekat `tileUrl` ±baris 161):**
```ts
/**
 * Marker Bidan boleh berdenyut hanya bila: titik Bidan ADA dan data live
 * (segar). Data basi → titik diam (konsisten dengan dot status widget).
 */
export function shouldPulseTherapistMarker(hasTherapist: boolean, isLive: boolean): boolean {
  return hasTherapist && isLive;
}
```

**Micro-task 1.5 — test (append `describe` baru di `tests/unit/dispatch-map-projection.test.ts`, pola import existing baris 1–14):**
- `route menghubungkan dua marker`: therapist `{lat:-7.345,lng:112.74}`, customer `{lat:-7.354,lng:112.741}`, `600x360` → `route` tidak null; `(x1,y1)` = marker therapist − 7px di y; `(x2,y2)` = marker customer − 7px di y; semua dalam `[0,600]x[0,360]`.
- `route null bila hanya 1 marker`: hanya therapist → `route` null, marker tetap 1.
- `route null bila titik identik`: dua titik sama persis → `route` null (degenerate).
- `route null bila input kosong`: `computeMapView([], [], 600, 360).route` null.
- `shouldPulseTherapistMarker`: `(true,true)→true`; `(true,false)→false`; `(false,true)→false`.
- Adversarial: input rusak (NaN/garis lintang di luar rentang) → tidak throw, `route` null.

**Gate Fase 1:** `npx vitest run tests/unit/dispatch-map-projection.test.ts` hijau + `npx tsc --noEmit` (root) hijau. Dilarang lanjut bila merah.

## §3. Fase 2 — Wiring UI (tanpa library baru; Tailwind `animate-ping` built-in)

**Micro-task 2.1 — prop kesegaran (`DispatchMapModal.tsx`, interface ±baris 12–19, tambah setelah `staffName`):**
```tsx
/** True bila posisi Bidan segar (< 60 dtk). Default false → marker statis (kompatibel mundur). */
isLive?: boolean;
```
Destructure (±baris 21–28): tambah `isLive = false,`.
Di dalam komponen, setelah `const hasAny` (±baris 58): `const therapistLive = isLive && view.markers.some((m) => m.kind === 'therapist');`

**Micro-task 2.2 — overlay garis rute (setelah blok tiles `view.tiles.map`, sebelum blok `view.markers.map`, di dalam `hasAny`):**
```tsx
{view.route && (
  <svg className="absolute inset-0 pointer-events-none" width={view.width} height={view.height} aria-hidden="true">
    <line x1={view.route.x1} y1={view.route.y1} x2={view.route.x2} y2={view.route.y2}
      stroke="#059669" strokeWidth={2.5} strokeDasharray="7 6" strokeLinecap="round" opacity={0.85} />
  </svg>
)}
```

**Micro-task 2.3 — pulse pada dot Bidan (ganti isi marker, ±baris 129–133):**
```tsx
<span className={`relative block w-3.5 h-3.5 rounded-full border-2 border-white shadow-md ${
  m.kind === 'therapist' ? 'bg-emerald-500' : 'bg-rose-500'
}`}>
  {m.kind === 'therapist' && therapistLive && (
    <span className="absolute -inset-1 rounded-full bg-emerald-400/50 animate-ping" aria-hidden="true" />
  )}
</span>
```

**Micro-task 2.4 — legenda jujur (di blok legenda ±baris 96–106, tambah satu baris):**
```tsx
<span className="flex items-center gap-1">
  <span className="inline-block w-4 border-t-2 border-dashed border-emerald-600" /> Garis lurus ke pasien (bukan rute jalan)
</span>
```
Dan ubah label hijau menjadi: `Motor Bidan{therapistLive ? ' (live)' : ''}` — gunakan variabel yang sudah ada agar tidak duplikasi logika.

**Micro-task 2.5 — teruskan kesegaran dari widget (`LiveChatDispatchWidget.tsx`, pemanggilan modal ±baris 193–204):** tambah prop `isLive={isFresh}` (variabel `isFresh` sudah ada di baris 67 — reuse, bukan hitung ulang).

**Gate Fase 2:**
- `cd packages/admin-dashboard && npm run build` → hijau (wajib; `tsc` termasuk di dalamnya).
- Checklist visual manual (tidak bisa otomatis): buka modal dengan data segar → dot hijau berdenyut + garis putus-putus ke titik merah; dengan data basi → dot diam, tanpa denyut; hanya 1 titik → tanpa garis, tanpa error.
- Dilarang `window.confirm/alert`; tidak ada file/halaman/rute baru.

## §4. Fase 3 — Widget di tablet/HP (OPSIONAL, gate terpisah)

Risiko: mengubah `hidden xl:flex` (`LiveChatMonitor.tsx:5430`) menyentuh layout kolom chat + sidebar di layar kecil; butuh cek visual di HP asli + tidak boleh menambah halaman/rute baru (mandat anti-bloat). **Tidak termasuk eksekusi default.** Minta persetujuan eksplisit + hasil cek HP bila ingin dilanjutkan.

## §5. Batasan jujur (dicatat, bukan disembunyikan)

- Garis = **lurus (Haversine)**, bukan rute jalan. Rute aspal butuh ORS/Google + rate-limit (di luar scope; jangan ditambahkan diam-diam).
- Tile OSM: tunduk kebijakan penggunaan tile.openstreetmap.org (sudah dipakai existing).
- Posisi trip = in-memory (hilang saat restart, single-instance) — batasan existing #162a, tidak diubah plan ini.

## §6. Deploy & regresi

- UI ini di-serve dari `packages/admin-dashboard/dist` → setelah merge wajib **rebuild dashboard + restart bot** (runbook monorepo).
- Regression gate: Fase 1 (vitest file + `tsc` root) → Fase 2 (dashboard build + checklist visual). Full suite backend tidak tersentuh file ini; bila executor meragukan, jalankan `npx vitest run tests/unit/dispatch-map-projection.test.ts` ulang sebagai bukti.

## §7. Confirmation Gate — STOP DI SINI

Jangan eksekusi Fase 1–3 sebelum user mengetik persetujuan eksplisit untuk plan ini. Khusus Fase 3 butuh persetujuan terpisah.
