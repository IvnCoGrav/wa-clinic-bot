import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, MapPin } from 'lucide-react';
import { computeFleetView, tileUrl, type LatLng } from '../../utils/dispatchMap';

/**
 * Modal peta sebaran armada harian (plan 2026-10-02, Fase 4).
 *
 * Presentational + murni: memetakan seluruh titik pasien hari ini dengan pin
 * berkode warna status. TANPA dependency baru — memakai engine raster tile OSM
 * (`dispatchMap.ts`). Garis yang digambar adalah garis LURUS, bukan rute jalan.
 */

export interface FleetMapTask {
  reservationId: string;
  customerName: string | null;
  staffName?: string | null;
  timeLabel?: string | null;
  status: string;
  lat: number | null | undefined;
  lng: number | null | undefined;
}

export interface FleetMapModalProps {
  open: boolean;
  onClose: () => void;
  tasks: FleetMapTask[];
}

type FleetBucket = 'completed' | 'en_route' | 'waiting';

function bucketOf(status: string): FleetBucket {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'completed';
  if (s === 'en_route' || s === 'on_the_way') return 'en_route';
  return 'waiting';
}

const BUCKET_COLOR: Record<FleetBucket, string> = {
  completed: '#059669',
  en_route: '#d97706',
  waiting: '#7c3aed',
};

const BUCKET_LABEL: Record<FleetBucket, string> = {
  completed: 'Selesai',
  en_route: 'Perjalanan',
  waiting: 'Menunggu',
};

export const FleetMapModal: React.FC<FleetMapModalProps> = ({ open, onClose, tasks }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 640, h: 400 });
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => setDims({ w: el.clientWidth || 640, h: el.clientHeight || 400 });
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [open]);

  // Titik valid untuk proyeksi + indeks asal agar marker terhubung ke task.
  const validTasks = useMemo(
    () => tasks.filter((t) => Number.isFinite(Number(t.lat)) && Number.isFinite(Number(t.lng))),
    [tasks]
  );

  const view = useMemo(() => {
    const pts = validTasks.map((t) => ({ lat: Number(t.lat), lng: Number(t.lng) }) as LatLng);
    return computeFleetView(pts, dims.w, dims.h);
  }, [validTasks, dims.w, dims.h]);

  const selectedTask = useMemo(
    () => (selected ? tasks.find((t) => t.reservationId === selected) || null : null),
    [selected, tasks]
  );

  if (!open) return null;

  return (
    <div
      data-modal-active="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-[#111b21]">Peta Sebaran Hari Ini</h3>
            <p className="text-[11px] text-[#667781]">
              {validTasks.length} dari {tasks.length} titik pasien memiliki koordinat.
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

        <div className="flex items-center gap-3 px-4 py-2 text-[11px] text-[#54656f] flex-wrap">
          {(['completed', 'en_route', 'waiting'] as FleetBucket[]).map((b) => (
            <span key={b} className="flex items-center gap-1">
              <span
                className="w-2.5 h-2.5 rounded-full inline-block"
                style={{ backgroundColor: BUCKET_COLOR[b] }}
              />
              {BUCKET_LABEL[b]}
            </span>
          ))}
          <span className="ml-auto text-[10px] text-[#8696a0]">Pin bukan rute jalan · zoom {view.zoom}</span>
        </div>

        <div ref={containerRef} className="relative flex-1 min-h-[400px] bg-[#f0f2f5] overflow-hidden">
          {validTasks.length > 0 ? (
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
              {view.markers.map((m) => {
                const task = validTasks[m.index];
                if (!task) return null;
                const bucket = bucketOf(task.status);
                const isSel = selected === task.reservationId;
                return (
                  <button
                    key={task.reservationId}
                    type="button"
                    onClick={() => setSelected(isSel ? null : task.reservationId)}
                    className="absolute"
                    style={{ left: m.x, top: m.y, transform: 'translate(-50%, -100%)' }}
                    title={`${task.customerName || 'Pasien'} · ${BUCKET_LABEL[bucket]}`}
                  >
                    <span
                      className={`relative block rounded-full border-2 border-white shadow-md ${
                        isSel ? 'w-5 h-5 ring-2 ring-[#111b21]/30' : 'w-3.5 h-3.5'
                      }`}
                      style={{ backgroundColor: BUCKET_COLOR[bucket] }}
                    />
                  </button>
                );
              })}
              <div className="absolute bottom-0 right-0 px-1 text-[9px] text-[#54656f] bg-white/70">
                © OpenStreetMap
              </div>
            </>
          ) : (
            <div className="h-full min-h-[400px] flex items-center justify-center text-xs text-[#667781]">
              Belum ada titik pasien dengan koordinat pada tanggal ini.
            </div>
          )}

          {selectedTask && (
            <div className="absolute top-2 left-2 bg-white rounded-xl shadow-lg border border-[#e9edef] px-3 py-2 text-xs max-w-[240px]">
              <p className="font-bold text-[#111b21] truncate">{selectedTask.customerName || 'Pasien'}</p>
              <p className="text-[#54656f] flex items-center gap-1">
                <MapPin size={11} className="text-[#008069]" />
                {selectedTask.staffName || 'Belum ditugaskan'}
              </p>
              <p className="text-[#54656f]">
                {selectedTask.timeLabel || '-'} · {BUCKET_LABEL[bucketOf(selectedTask.status)]}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FleetMapModal;
