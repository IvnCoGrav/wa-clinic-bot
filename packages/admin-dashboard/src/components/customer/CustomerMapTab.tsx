import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { RefreshCw, MapPin, AlertTriangle } from 'lucide-react';
import { useUiFeedback } from '../common/UiFeedback';
import {
  fetchCustomerMapPoints,
  MapPoint,
  ClinicMapMeta,
} from '../../services/api';
import { loadLeaflet } from '../../utils/leafletLoader';
import {
  computeSpatialMetrics,
  filterPointsByCity,
  filterPointsByStatus,
  markerColor,
  normalizeCity,
  SpatialStatus,
  uniqueCities,
} from '../../utils/customerMapUtils';

export interface CustomerMapTabProps {
  onSelectCustomer?: (customerId: string) => void;
}

const DEFAULT_CENTER: [number, number] = [-7.35084, 112.72892];
const DEFAULT_ZOOM = 11;
// Bounding box Surabaya Raya + Gresik (longgar agar panning tidak terasa 'dikunci'):
// Southwest (Porong/Krian/Mojokerto) to Northeast (Gresik Utara/Selat Madura)
const SURABAYA_RAYA_BOUNDS: [[number, number], [number, number]] = [
  [-7.90, 112.10],
  [-6.75, 113.15],
];
const RING_COLORS = ['#008069', '#2563eb', '#e11d48'];

function getGoogleMapsDirectionUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

function escapeHtml(str: string): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const CustomerMapTab: React.FC<CustomerMapTabProps> = ({ onSelectCustomer }) => {
  const { toast } = useUiFeedback();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const clusterRef = useRef<any>(null);
  const basecampLayerRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const boundaryLayerRef = useRef<any>(null);
  const boundaryGeoRef = useRef<any>(null);
  const hasInitialFittedRef = useRef(false);

  const [points, setPoints] = useState<MapPoint[]>([]);
  const [clinic, setClinic] = useState<ClinicMapMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kotaFilter, setKotaFilter] = useState<string>('');
  const [showAllCities, setShowAllCities] = useState(false);
  const [showRadius, setShowRadius] = useState(true);
  const [mapMode, setMapMode] = useState<'streets' | 'area'>('streets');
  const [leafletFailed, setLeafletFailed] = useState(false);
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<SpatialStatus>>(new Set());

  const toggleStatus = (status: SpatialStatus) => {
    setHiddenStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const [mapReady, setMapReady] = useState(false);

  const kotaOptions = useMemo(() => uniqueCities(points), [points]);
  const cityFiltered = useMemo(
    () => filterPointsByCity(points, kotaFilter),
    [points, kotaFilter]
  );
  const allowedStatuses = useMemo(
    () =>
      new Set<SpatialStatus>(
        (['active', 'mql', 'other', 'out_of_coverage'] as SpatialStatus[]).filter(
          (s) => !hiddenStatuses.has(s)
        )
      ),
    [hiddenStatuses]
  );
  const visiblePoints = useMemo(
    () => filterPointsByStatus(cityFiltered, allowedStatuses),
    [cityFiltered, allowedStatuses]
  );
  const metrics = useMemo(
    () => computeSpatialMetrics(visiblePoints),
    [visiblePoints]
  );

  const loadPoints = useCallback(
    async (allCities: boolean, fresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchCustomerMapPoints(
          undefined,
          allCities ? 'all' : undefined,
          { fresh }
        );
        setPoints(res.points || []);
        setClinic(res.clinic || null);
        if (fresh) {
          hasInitialFittedRef.current = false;
        }
      } catch (err: any) {
        const msg = err?.message || 'Gagal memuat titik sebaran pelanggan.';
        setError(msg);
        toast(msg, 'error');
      } finally {
        setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    loadPoints(showAllCities);
  }, [showAllCities, loadPoints]);

  useEffect(() => {
    let disposed = false;
    let createdMap: any = null;

    const initMap = async () => {
      try {
        await loadLeaflet();
      } catch {
        if (!disposed) setLeafletFailed(true);
        return;
      }

      if (disposed || !mapContainerRef.current || mapRef.current) return;

      const L = (window as any).L;
      if (!L) {
        if (!disposed) setLeafletFailed(true);
        return;
      }

      const map = L.map(mapContainerRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        minZoom: 10,
        maxZoom: 18,
        maxBounds: SURABAYA_RAYA_BOUNDS,
        maxBoundsViscosity: 0.3,
        zoomControl: true,
        attributionControl: false,
      });

      if (!map.getPane('boundaryPane')) {
        const bp = map.createPane('boundaryPane');
        bp.style.zIndex = '250';
      }

      // Basemap CartoDB Positron (Light, bersih, jalan/nama wilayah jelas)
      const tileLayer = L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        {
          minZoom: 10,
          maxZoom: 18,
          attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
          subdomains: 'abcd',
        }
      );
      tileLayer.addTo(map);
      tileLayerRef.current = tileLayer;

      // FeatureGroup standar Leaflet (mendukung getBounds dan circleMarker presisi)
      const markersLayer = L.featureGroup();
      map.addLayer(markersLayer);

      createdMap = map;
      mapRef.current = map;
      clusterRef.current = markersLayer;

      // Invalidate size setelah DOM siap (mencegah koordinat NaN)
      setTimeout(() => {
        if (!disposed && map) {
          try {
            map.invalidateSize();
          } catch {}
        }
      }, 150);

      if (!disposed) setMapReady(true);
    };

    initMap();

    return () => {
      disposed = true;
      const toRemove = createdMap || mapRef.current;
      if (toRemove) {
        try {
          toRemove.remove();
        } catch {}
      }
      if (mapRef.current === toRemove) {
        mapRef.current = null;
        clusterRef.current = null;
        tileLayerRef.current = null;
        boundaryLayerRef.current = null;
      }
    };
  }, []);

  // Preload GeoJSON boundary sekali saat peta siap (mode bebas), mencegah blank flash saat toggle Area Vektor
  useEffect(() => {
    if (!mapReady) return;
    let cancelled = false;
    const loadGeo = async () => {
      try {
        let res = await fetch('/admin/geo/surabaya-sidoarjo.geojson');
        if (!res.ok) {
          res = await fetch('/geo/surabaya-sidoarjo.geojson');
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const geoData = await res.json();
        if (!cancelled) boundaryGeoRef.current = geoData;
      } catch (e) {
        console.error('Gagal memuat boundary geojson:', e);
      }
    };
    loadGeo();
    return () => {
      cancelled = true;
    };
  }, [mapReady]);

  // Mode Tampilan Peta: Peta Jalan (CartoDB) vs Area Vektor (Batas Sby & Sda Murni)
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const L = (window as any).L;
    if (!L) return;

    if (mapMode === 'streets') {
      if (boundaryLayerRef.current && map.hasLayer(boundaryLayerRef.current)) {
        try {
          map.removeLayer(boundaryLayerRef.current);
        } catch {}
      }
      if (!tileLayerRef.current) {
        tileLayerRef.current = L.tileLayer(
          'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
          {
            minZoom: 10,
            maxZoom: 18,
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
            subdomains: 'abcd',
          }
        );
      }
      if (!map.hasLayer(tileLayerRef.current)) {
        tileLayerRef.current.addTo(map);
      }
    } else {
      // Area Vektor Mode (Batas wilayah bergradasi: Hijau Kota, Orange Kecamatan, Biru pudar Kelurahan)
      if (tileLayerRef.current && map.hasLayer(tileLayerRef.current)) {
        try {
          map.removeLayer(tileLayerRef.current);
        } catch {}
      }

      if (!boundaryLayerRef.current) {
        const geoData = boundaryGeoRef.current;
        if (!geoData) return;
        const bLayer = L.geoJSON(geoData, {
          pane: 'boundaryPane',
          style: (feature: any) => {
            const level = feature?.properties?.level;
            if (level === 'regency_border') {
              // Kota / Kabupaten: Hijau tebal tegas
              return {
                color: '#008069',
                weight: 3.2,
                opacity: 0.95,
                fill: false,
                interactive: false,
              };
            }
            if (level === 'district_border') {
              // Kecamatan: Orange sedang
              return {
                color: '#f97316',
                weight: 1.8,
                opacity: 0.85,
                fill: false,
                interactive: false,
              };
            }
            // Kelurahan / Desa: poligon putih tegas di atas kertas abu muda
            return {
              fillColor: '#ffffff',
              fillOpacity: 0.95,
              color: '#cbd5e1',
              weight: 0.9,
              opacity: 0.9,
              dashArray: undefined,
              interactive: true,
            };
          },
          onEachFeature: (feature: any, layer: any) => {
            const p = feature?.properties;
            // Border garis (regency/district): NON-interaktif mutlak — jangan pernah
            // menangkap pointer di atas tooltip poligon kelurahan (antisipasi flicker lagi).
            if (p && p.level !== 'village') {
              if (layer && typeof layer.getElement === 'function') {
                layer.on('add', () => {
                  const el = layer.getElement();
                  if (el) el.style.pointerEvents = 'none';
                });
              }
              return;
            }
            if (p && p.level === 'village') {
              layer.bindTooltip(
                `<div style="font-family:inherit;font-size:11px;line-height:1.4">` +
                  `<b style="color:#0369a1">${escapeHtml(p.village || 'Kelurahan')}</b><br/>` +
                  `<span style="color:#64748b">Kec. ${escapeHtml(p.district || '')} · ${escapeHtml(p.regency || '')}</span>` +
                `</div>`,
                { sticky: true, direction: 'auto' }
              );
              layer.on({
                mouseover: (e: any) => {
                  e.target.setStyle({
                    fillColor: '#e0f2fe',
                    fillOpacity: 0.95,
                    color: '#0284c7',
                    weight: 1.6,
                    opacity: 1,
                    dashArray: undefined,
                  });
                },
                mouseout: () => {
                  bLayer.resetStyle(layer);
                },
              });
            }
          },
        });
        boundaryLayerRef.current = bLayer;
      }
      if (boundaryLayerRef.current && !map.hasLayer(boundaryLayerRef.current)) {
        boundaryLayerRef.current.addTo(map);
      }
    }
  }, [mapReady, mapMode]);

  // Render Titik Pelanggan
  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (!mapReady || !map || !cluster) return;

    const L = (window as any).L;
    cluster.clearLayers();

    visiblePoints.forEach((p) => {
      const color = markerColor(p);
      const estimated = p.is_estimated_centroid === true;
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: estimated ? 7 : 6,
        color: estimated ? color : '#ffffff',
        weight: estimated ? 2 : 1.5,
        dashArray: estimated ? '4 3' : undefined,
        fillColor: color,
        fillOpacity: estimated ? 0.5 : 0.9,
      });
      const name = escapeHtml((p.name || 'Pelanggan').trim());
      const area = escapeHtml(
        [p.kecamatan, normalizeCity(p.kota)].filter(Boolean).join(', ') || '-'
      );
      const phone = escapeHtml(p.phone || '');

      const statusLabel = p.is_out_of_coverage
        ? 'Di luar jangkauan'
        : p.is_mql
          ? 'MQL'
          : p.status && p.status !== 'active'
            ? 'Status lain'
            : 'Aktif';
      const accuracy = estimated ? '⚪ Estimasi Wilayah' : '📍 GPS Akurat';
      const distanceText =
        typeof p.distance_km === 'number'
          ? `<div style="color:#667781">📏 Jarak: ${p.distance_km} km dari Basecamp</div>`
          : '';

      const detailBtn =
        onSelectCustomer && p.id
          ? `<button type="button" data-customer-id="${escapeHtml(p.id)}"
               style="display:block;width:100%;margin-top:8px;padding:6px;border:none;border-radius:8px;
                      background:#008069;color:#fff;font-weight:600;font-size:11px;cursor:pointer">
               Lihat Detail Pelanggan
             </button>`
          : '';
      marker.bindPopup(
        `<div style="font-family:inherit;font-size:12px;line-height:1.5;min-width:180px">
          <div style="font-weight:700;color:#111b21;margin-bottom:2px">${name}</div>
          <div style="color:#667781">${area}</div>
          <div style="color:#667781">${phone}</div>
          <div style="display:inline-block;margin-top:4px;padding:1px 6px;border-radius:6px;background:#f0f2f5;color:${color};font-weight:600">${statusLabel}</div>
          <div style="color:#667781;margin-top:2px">${accuracy}</div>
          ${distanceText}
          <a href="${getGoogleMapsDirectionUrl(p.lat, p.lng)}" target="_blank" rel="noopener noreferrer"
             style="display:inline-block;margin-top:6px;color:#008069;font-weight:600">Navigasi &rarr;</a>
          ${detailBtn}
        </div>`
      );
      cluster.addLayer(marker);
    });

    // ONLY auto-fit bounds on initial mount or when city filter/refresh is explicitly triggered.
    // Switching mapMode ('streets' <-> 'area') or status pills MUST NOT reset zoom/pan!
    if (!hasInitialFittedRef.current) {
      if (visiblePoints.length > 0) {
        try {
          map.invalidateSize();
          const bounds = cluster.getBounds();
          if (bounds && typeof bounds.isValid === 'function' && bounds.isValid()) {
            if (clinic && typeof clinic.lat === 'number' && typeof clinic.lng === 'number'
              && (!kotaFilter || normalizeCity(kotaFilter) === 'sidoarjo')) {
              bounds.extend([clinic.lat, clinic.lng]);
            }
            map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
            hasInitialFittedRef.current = true;
          } else {
            map.setView([clinic?.lat ?? DEFAULT_CENTER[0], clinic?.lng ?? DEFAULT_CENTER[1]], DEFAULT_ZOOM);
            hasInitialFittedRef.current = true;
          }
        } catch {
          map.setView([clinic?.lat ?? DEFAULT_CENTER[0], clinic?.lng ?? DEFAULT_CENTER[1]], DEFAULT_ZOOM);
          hasInitialFittedRef.current = true;
        }
      } else if (clinic) {
        map.setView([clinic.lat, clinic.lng], DEFAULT_ZOOM);
      }
    }
  }, [mapReady, visiblePoints, onSelectCustomer, clinic, kotaFilter]);

  // Basecamp klinik + lingkaran radius jangkauan
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !clinic) return;

    const L = (window as any).L;
    if (basecampLayerRef.current) {
      try {
        map.removeLayer(basecampLayerRef.current);
      } catch {}
      basecampLayerRef.current = null;
    }

    const group = L.layerGroup();
    const rings: number[] = Array.isArray(clinic.rings) && clinic.rings.length > 0
      ? clinic.rings
      : [5, 15, clinic.maxCoverageKm];

    rings.forEach((km, i) => {
      L.circle([clinic.lat, clinic.lng], {
        radius: km * 1000,
        color: RING_COLORS[i % RING_COLORS.length],
        weight: 1.5,
        fillColor: RING_COLORS[i % RING_COLORS.length],
        fillOpacity: showRadius ? 0.05 : 0,
        opacity: showRadius ? 0.7 : 0,
        interactive: false,
      }).addTo(group);
    });

    const basecamp = L.circleMarker([clinic.lat, clinic.lng], {
      radius: 9,
      color: '#ffffff',
      weight: 2.5,
      fillColor: '#e11d48',
      fillOpacity: 1,
    });
    basecamp.bindPopup(
      `<div style="font-family:inherit;font-size:12px;line-height:1.5;min-width:160px">
        <div style="font-weight:700;color:#111b21">${escapeHtml(clinic.name)}</div>
        <div style="color:#667781">Basecamp Klinik</div>
        <div style="color:#667781">Jangkauan maks ${clinic.maxCoverageKm} km</div>
        <a href="${getGoogleMapsDirectionUrl(clinic.lat, clinic.lng)}" target="_blank" rel="noopener noreferrer"
           style="display:inline-block;margin-top:6px;color:#008069;font-weight:600">Navigasi &rarr;</a>
      </div>`
    );
    basecamp.addTo(group);
    if (typeof basecamp.bindTooltip === 'function') {
      basecamp.bindTooltip(escapeHtml(clinic.name), { permanent: true, direction: 'right', offset: [10, 0] });
    }

    group.addTo(map);
    basecampLayerRef.current = group;
  }, [mapReady, clinic, showRadius]);

  // Delegasi klik tombol detail di dalam popup
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const container = map.getContainer?.() as HTMLElement | undefined;
    if (!container) return;
    const handlePopupClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest?.('[data-customer-id]') as HTMLElement | null;
      const id = target?.getAttribute('data-customer-id');
      if (id) onSelectCustomer?.(id);
    };
    container.addEventListener('click', handlePopupClick);
    return () => container.removeEventListener('click', handlePopupClick);
  }, [mapReady, onSelectCustomer]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#111b21] tracking-tight flex items-center space-x-2">
            <MapPin className="text-[#008069]" size={22} />
            <span>Sebaran Pelanggan</span>
          </h1>
          <p className="text-xs text-[#667781] mt-0.5">
            Peta sebaran pelanggan interaktif dengan pilihan Peta Jalan dan Area Vektor (Surabaya & Sidoarjo). Klik titik lalu tekan "Lihat Detail Pelanggan".
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {/* Switcher Mode Peta */}
          <div className="inline-flex rounded-xl bg-white border border-[#d1d7db] p-0.5 shadow-xs text-xs font-semibold">
            <button
              type="button"
              onClick={() => setMapMode('streets')}
              className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                mapMode === 'streets' ? 'bg-[#008069] text-white shadow-xs' : 'text-[#54656f] hover:text-[#111b21]'
              }`}
              title="Tampilkan peta jalan CartoDB"
            >
              Peta Jalan
            </button>
            <button
              type="button"
              onClick={() => setMapMode('area')}
              className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                mapMode === 'area' ? 'bg-[#008069] text-white shadow-xs' : 'text-[#54656f] hover:text-[#111b21]'
              }`}
              title="Tampilkan siluet area batas wilayah Surabaya & Sidoarjo tanpa jalan"
            >
              Area Vektor
            </button>
          </div>

          <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[#d1d7db] text-[#54656f] text-xs font-semibold shadow-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showRadius}
              onChange={(e) => setShowRadius(e.target.checked)}
              className="accent-[#008069]"
            />
            <span>Tampilkan Radius</span>
          </label>
          <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[#d1d7db] text-[#54656f] text-xs font-semibold shadow-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showAllCities}
              onChange={(e) => {
                hasInitialFittedRef.current = false;
                setShowAllCities(e.target.checked);
              }}
              className="accent-[#008069]"
            />
            <span>Semua wilayah</span>
          </label>
          <select
            value={kotaFilter}
            onChange={(e) => {
              hasInitialFittedRef.current = false;
              setKotaFilter(e.target.value);
            }}
            className="px-3 py-1.5 rounded-xl bg-white border border-[#d1d7db] text-[#111b21] text-xs font-semibold shadow-xs focus:outline-none focus:border-[#008069]"
          >
            <option value="">Semua Kota</option>
            {kotaOptions.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              hasInitialFittedRef.current = false;
              loadPoints(showAllCities, true);
            }}
            disabled={loading}
            className="px-3 py-1.5 rounded-xl bg-white border border-[#d1d7db] text-[#54656f] hover:bg-[#f0f2f5] hover:text-[#111b21] transition shadow-xs disabled:opacity-50 flex items-center space-x-1.5 text-xs font-semibold cursor-pointer"
            title="Refresh titik peta"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin text-[#008069]' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Ringkasan KPI Spasial */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white p-3.5 rounded-xl border border-[#e9edef] shadow-xs">
          <span className="text-[11px] font-bold text-[#667781] uppercase tracking-wider">Total Terpetakan</span>
          <p className="text-lg font-bold text-[#111b21] mt-1">{metrics.totalPoints} titik</p>
          <span className="text-[10px] text-[#667781]">{metrics.preciseCount} presisi · {metrics.estimatedCount} estimasi</span>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-[#e9edef] shadow-xs">
          <span className="text-[11px] font-bold text-[#667781] uppercase tracking-wider">Keterjangkauan</span>
          <p className="text-lg font-bold text-[#008069] mt-1">{metrics.inCoveragePercent}%</p>
          <span className="text-[10px] text-[#667781]">{metrics.inCoverageCount} dalam · {metrics.outOfCoverageCount} luar</span>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-[#e9edef] shadow-xs">
          <span className="text-[11px] font-bold text-[#667781] uppercase tracking-wider">Rata-rata Jarak</span>
          <p className="text-lg font-bold text-[#111b21] mt-1">
            {metrics.averageDistanceKm != null ? `${metrics.averageDistanceKm} km` : '-'}
          </p>
          <span className="text-[10px] text-[#667781]">dari basecamp</span>
        </div>
        <div className="bg-white p-3.5 rounded-xl border border-[#e9edef] shadow-xs">
          <span className="text-[11px] font-bold text-[#667781] uppercase tracking-wider">Top Wilayah</span>
          {metrics.topKecamatan.length > 0 ? (
            <p className="text-[11px] font-semibold text-[#111b21] mt-1 leading-snug">
              {metrics.topKecamatan.map((k, i) => `${i + 1}. ${k.name} (${k.count})`).join(' · ')}
            </p>
          ) : (
            <p className="text-lg font-bold text-[#111b21] mt-1">-</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#667781]">
        {([
          { key: 'active' as SpatialStatus, label: 'Aktif', color: '#008069' },
          { key: 'mql' as SpatialStatus, label: 'MQL', color: '#2563eb' },
          { key: 'other' as SpatialStatus, label: 'Status lain', color: '#f59e0b' },
          { key: 'out_of_coverage' as SpatialStatus, label: 'Di luar jangkauan', color: '#94a3b8' },
        ]).map((item) => {
          const hidden = hiddenStatuses.has(item.key);
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => toggleStatus(item.key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition cursor-pointer font-semibold ${
                hidden ? 'opacity-40 line-through bg-[#f0f2f5] border-[#d1d7db]' : 'bg-white border-[#d1d7db]'
              }`}
              title={hidden ? `Tampilkan ${item.label}` : `Sembunyikan ${item.label}`}
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: item.color, display: 'inline-block' }} />
              {item.label}
            </button>
          );
        })}
        <span className="flex items-center gap-1.5 px-2.5 py-1">
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ border: '2px dashed #008069', display: 'inline-block' }}
          />
          Estimasi wilayah
        </span>
        {clinic && (
          <span className="flex items-center gap-1.5 px-2.5 py-1">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#e11d48', display: 'inline-block' }} />
            Basecamp
          </span>
        )}
        {mapMode === 'area' && (
          <div className="flex items-center gap-2.5 px-2.5 py-1 bg-[#f8fafc] border border-[#e2e8f0] rounded-full text-[11px] font-medium text-[#475569]">
            <span className="font-bold text-[#111b21]">Batas:</span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-1 rounded-xs bg-[#008069] inline-block" />
              Kota (Hijau)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 rounded-xs bg-[#f97316] inline-block" />
              Kecamatan (Orange)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-white border border-[#cbd5e1] inline-block" />
              Kelurahan (Putih)
            </span>
          </div>
        )}
        <span className="ml-auto font-semibold">{visiblePoints.length} titik tampil</span>
      </div>

      {leafletFailed ? (
        <div className="bg-white border border-[#e9edef] rounded-2xl p-8 text-center">
          <AlertTriangle className="mx-auto text-amber-500 mb-2" size={28} />
          <p className="text-sm font-semibold text-[#111b21]">Peta gagal dimuat</p>
          <p className="text-xs text-[#667781] mt-1">
            Pustaka peta (CDN) tidak dapat diakses. Periksa koneksi internet lalu coba lagi.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-[#e9edef] rounded-2xl overflow-hidden shadow-xs relative">
          <div
            ref={mapContainerRef}
            style={{
              height: '540px',
              width: '100%',
              background: mapMode === 'area' ? '#f1f5f9' : '#eef1f4',
            }}
          />
          {loading && (
            <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-10">
              <RefreshCw className="animate-spin text-[#008069]" size={24} />
            </div>
          )}
          {!loading && visiblePoints.length === 0 && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none z-10">
              <MapPin className="text-[#94a3b8] mb-2" size={28} />
              <p className="text-sm font-semibold text-[#111b21]">Tidak ada titik untuk ditampilkan</p>
              <p className="text-xs text-[#667781] mt-1">
                {kotaFilter
                  ? 'Coba pilih kota lain atau reset filter.'
                  : 'Titik muncul setelah pelanggan membagikan lokasi atau admin mengisi koordinat.'}
              </p>
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center z-10">
              <AlertTriangle className="text-red-500 mb-2" size={28} />
              <p className="text-sm font-semibold text-[#111b21]">{error}</p>
              <button
                onClick={() => loadPoints(showAllCities, true)}
                className="mt-3 px-3 py-1.5 rounded-xl bg-[#008069] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw size={13} /> Coba lagi
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CustomerMapTab;
