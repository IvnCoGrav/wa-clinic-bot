import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, ExternalLink, Navigation, RefreshCw } from 'lucide-react';
import { computeMapView, tileUrl, type LatLng } from '../../utils/dispatchMap';

/**
 * Modal peta ringan untuk CS: membandingkan titik motor Bidan (hijau) vs titik
 * rumah pasien (merah). TANPA dependency baru (tanpa Leaflet / Google Maps API
 * berbayar) — merender raster tile OpenStreetMap (Web Mercator) via util murni
 * `dispatchMap.ts`, sehingga kedua titik presisi.
 */

export interface DispatchMapModalProps {
  open: boolean;
  onClose: () => void;
  therapist: { lat: number; lng: number } | null;
  customer: { lat: number; lng: number } | null;
  areaName?: string | null;
  staffName?: string | null;
}

export const DispatchMapModal: React.FC<DispatchMapModalProps> = ({
  open,
  onClose,
  therapist,
  customer,
  areaName,
  staffName,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 600, h: 360 });

  useEffect(() => {
    if (!open) return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => setDims({ w: el.clientWidth || 600, h: el.clientHeight || 360 });
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [open]);

  const view = useMemo(() => {
    const pts = [therapist, customer].filter(Boolean) as LatLng[];
    const markers = [
      therapist ? { point: therapist, kind: 'therapist' as const } : null,
      customer ? { point: customer, kind: 'customer' as const } : null,
    ].filter(Boolean) as Array<{ point: LatLng; kind: 'therapist' | 'customer' }>;
    return computeMapView(pts, markers, dims.w, dims.h);
  }, [therapist, customer, dims.w, dims.h]);

  if (!open) return null;

  const hasAny = !!(therapist || customer);
  const routeUrl =
    therapist && customer
      ? `https://www.google.com/maps/dir/?api=1&origin=${therapist.lat.toFixed(5)},${therapist.lng.toFixed(5)}&destination=${customer.lat.toFixed(5)},${customer.lng.toFixed(5)}`
      : therapist
        ? `https://www.google.com/maps/search/?api=1&query=${therapist.lat.toFixed(5)},${therapist.lng.toFixed(5)}`
        : customer
          ? `https://www.google.com/maps/search/?api=1&query=${customer.lat.toFixed(5)},${customer.lng.toFixed(5)}`
          : '#';

  return (
    <div
      data-modal-active="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-[#111b21]">Peta Perjalanan Bidan</h3>
            <p className="text-[11px] text-[#667781] truncate">
              {staffName ? `${staffName} · ` : ''}
              {areaName || 'Lokasi terkini'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-[#54656f]"
            aria-label="Tutup"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-3 px-4 py-2 text-[11px] text-[#54656f]">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Motor Bidan
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" /> Rumah Pasien
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-[#8696a0]">
            <RefreshCw size={10} /> zoom {view.zoom}
          </span>
        </div>

        <div ref={containerRef} className="relative flex-1 min-h-[360px] bg-[#f0f2f5] overflow-hidden">
          {hasAny ? (
            <>
              {view.tiles.map((t) => (
                <img
                  key={`${t.z}-${t.x}-${t.y}`}
                  src={tileUrl(t)}
                  alt=""
                  draggable={false}
                  loading="lazy"
                  className="absolute select-none"
                  style={{ left: t.left, top: t.top, width: 256, height: 256 }}
                />
              ))}
              {view.markers.map((m, i) => (
                <div
                  key={`${m.kind}-${i}`}
                  className="absolute"
                  style={{ left: m.x, top: m.y, transform: 'translate(-50%, -100%)' }}
                  title={m.kind === 'therapist' ? 'Motor Bidan' : 'Rumah Pasien'}
                >
                  <span
                    className={`block w-3.5 h-3.5 rounded-full border-2 border-white shadow-md ${
                      m.kind === 'therapist' ? 'bg-emerald-500' : 'bg-rose-500'
                    }`}
                  />
                </div>
              ))}
              <div className="absolute bottom-0 right-0 px-1 text-[9px] text-[#54656f] bg-white/70">
                © OpenStreetMap
              </div>
            </>
          ) : (
            <div className="h-full min-h-[360px] flex items-center justify-center text-xs text-[#667781]">
              Koordinat belum tersedia.
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-end">
          <a
            href={routeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border ${
              hasAny
                ? 'text-[#008069] bg-[#d9fdd3] border-[#00a884]/30 hover:bg-[#cbf7c3]'
                : 'text-gray-400 bg-gray-100 border-gray-200 pointer-events-none'
            }`}
          >
            <Navigation size={13} />
            Rute di Google Maps
            <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </div>
  );
};

export default DispatchMapModal;
