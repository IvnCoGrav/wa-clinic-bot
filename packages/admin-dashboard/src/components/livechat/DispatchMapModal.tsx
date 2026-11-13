import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Navigation, RefreshCw, AlertTriangle, Copy, Check } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { computeMapView, tileUrl, shouldPulseTherapistMarker, type LatLng } from '../../utils/dispatchMap';

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
  /** True bila posisi Bidan segar (< 60 dtk). Default false → marker statis (kompatibel mundur). */
  isLive?: boolean;
}

export const DispatchMapModal: React.FC<DispatchMapModalProps> = ({
  open,
  onClose,
  therapist,
  customer,
  areaName,
  staffName,
  isLive = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopyCoord = () => {
    const targetCoord = customer ? `${customer.lat.toFixed(6)}, ${customer.lng.toFixed(6)}` : null;
    if (!targetCoord) return;
    navigator.clipboard.writeText(targetCoord);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
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
  const therapistLive = shouldPulseTherapistMarker(
    view.markers.some((m) => m.kind === 'therapist'),
    isLive
  );
  const routeUrl =
    therapist && customer
      ? `https://www.google.com/maps/dir/?api=1&origin=${therapist.lat.toFixed(5)},${therapist.lng.toFixed(5)}&destination=${customer.lat.toFixed(5)},${customer.lng.toFixed(5)}`
      : therapist
        ? `https://www.google.com/maps/search/?api=1&query=${therapist.lat.toFixed(5)},${therapist.lng.toFixed(5)}`
        : customer
          ? `https://www.google.com/maps/search/?api=1&query=${customer.lat.toFixed(5)},${customer.lng.toFixed(5)}`
          : '#';

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      bodyClassName="p-0 overflow-hidden flex-1 flex flex-col min-h-0"
      title="Peta Perjalanan Bidan"
      subtitle={`${staffName ? `${staffName} · ` : ''}${areaName || 'Lokasi terkini'}`}
    >

        {!therapist && customer && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-300">
            <AlertTriangle size={13} className="shrink-0 text-amber-600 dark:text-amber-400" />
            <span>Bidan belum membagikan lokasi GPS aktif. Menampilkan titik koordinat rumah pasien.</span>
          </div>
        )}

        <div className="flex items-center gap-3 px-4 py-2 text-[11px] text-ink-2 border-b border-divider bg-surface-2">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-success inline-block" /> Motor Bidan{therapistLive ? ' (live)' : ''}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-danger inline-block" /> Rumah Pasien
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-4 border-t-2 border-dashed border-success" /> Garis lurus ke pasien (bukan rute jalan)
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-ink-3">
            <RefreshCw size={10} /> zoom {view.zoom}
          </span>
        </div>

        <div ref={containerRef} className="relative flex-1 min-h-[360px] bg-app overflow-hidden">
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
              {view.route && (
                <svg
                  className="absolute inset-0 pointer-events-none"
                  width={view.width}
                  height={view.height}
                  aria-hidden="true"
                >
                  <line
                    x1={view.route.x1}
                    y1={view.route.y1}
                    x2={view.route.x2}
                    y2={view.route.y2}
                    stroke="rgb(var(--c-accent))"
                    strokeWidth={2.5}
                    strokeDasharray="7 6"
                    strokeLinecap="round"
                    opacity={0.85}
                  />
                </svg>
              )}
              {view.markers.map((m, i) => (
                <div
                  key={`${m.kind}-${i}`}
                  className="absolute"
                  style={{ left: m.x, top: m.y, transform: 'translate(-50%, -100%)' }}
                  title={m.kind === 'therapist' ? 'Motor Bidan' : 'Rumah Pasien'}
                >
                  <span
                    className={`relative block w-3.5 h-3.5 rounded-full border-2 border-white shadow-md ${
                      m.kind === 'therapist' ? 'bg-success' : 'bg-danger'
                    }`}
                  >
                    {m.kind === 'therapist' && therapistLive && (
                      <span className="absolute -inset-1 rounded-full bg-success/50 animate-ping" aria-hidden="true" />
                    )}
                  </span>
                </div>
              ))}
              <div className="absolute bottom-0 right-0 px-1 text-[9px] text-ink-2 bg-surface/70">
                © OpenStreetMap
              </div>
            </>
          ) : (
            <div className="h-full min-h-[360px] flex items-center justify-center text-xs text-ink-2">
              Koordinat belum tersedia.
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-divider bg-surface flex items-center justify-between gap-2">
          {customer ? (
            <button
              aria-label="Salin koordinat GPS pasien"
              type="button"
              onClick={handleCopyCoord}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-divider hover:bg-fill-1 text-ink transition active:scale-95 cursor-pointer shadow-2xs"
              title="Salin koordinat GPS pasien"
            >
              {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
              <span>{copied ? 'Tersalin!' : 'Salin Koordinat'}</span>
            </button>
          ) : <div />}

          <a
            href={routeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border transition ${
              hasAny
                ? 'text-accent bg-bubble-out border-accent/30 hover:bg-accent-soft'
                : 'text-ink-3 bg-fill-1 border-divider pointer-events-none'
            }`}
          >
            <Navigation size={13} />
            Rute di Google Maps
            <ExternalLink size={12} />
          </a>
        </div>
    </Modal>
  );
};

export default DispatchMapModal;
