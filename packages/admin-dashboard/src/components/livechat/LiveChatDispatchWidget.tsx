import React, { useState } from 'react';
import { Copy, Map, RefreshCw, AlertTriangle, Phone, Radar } from 'lucide-react';
import { useUiFeedback } from '../common/UiFeedback';
import { DispatchMapModal } from './DispatchMapModal';

/**
 * Widget pemantauan perjalanan terapis untuk Admin CS (sidebar Live Chat).
 * Murni presentational + fetch via props; semua data dari
 * `GET /api/admin/dispatch/trip/:reservationId` (server-side, tenant-aware).
 */

export interface DispatchTripData {
  reservationId: string;
  status?: string;
  otwSentAt?: string | null;
  arrivedAt?: string | null;
  staffName?: string | null;
  staffPhone?: string | null;
  trip: {
    lat: number;
    lng: number;
    speed?: number | null;
    heading?: number | null;
    accuracy?: number | null;
    areaName: string;
    updatedAt: number;
    lastUpdateSec: number;
  } | null;
  customerCoords?: { lat: number | null; lng: number | null };
  remainingKm?: number | null;
  etaMinutes?: number | null;
  isStalledOutsideTarget?: boolean;
  geofenceReason?: string | null;
  geofenceDistanceM?: number | null;
  /** Prediksi keterlambatan (server-computed, murni). */
  delayStatus?: {
    isDelayed: boolean;
    level: 'none' | 'warning' | 'critical';
    delayMinutes: number;
    estimatedArrivalIso: string;
    formattedArrivalWib: string;
    reason: 'OK' | 'NO_SCHEDULE' | 'NO_ETA';
  } | null;
  readyText?: string;
  /** Draf pesan pemberitahuan keterlambatan (DB-driven, siap salin). */
  delayText?: string;
}

export interface LiveChatDispatchWidgetProps {
  data: DispatchTripData | null;
  loading?: boolean;
  staffName?: string | null;
  onRefresh?: () => void;
  onContactStaff?: () => void;
}

function formatStale(sec: number | null | undefined): string {
  if (sec == null) return 'belum ada data';
  if (sec < 60) return 'baru saja';
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  return `${h} jam lalu`;
}

export const LiveChatDispatchWidget: React.FC<LiveChatDispatchWidgetProps> = ({
  data,
  loading,
  staffName,
  onRefresh,
  onContactStaff,
}) => {
  const { toast } = useUiFeedback();
  const [mapOpen, setMapOpen] = useState(false);

  const trip = data?.trip || null;
  // Passive auto-tracking: tampil bila ada data trip meski `otwSentAt` belum
  // dicatat (Bidan belum klik OTW manual, tetapi telemetry sudah jalan H-30m).
  const isActive = !!data && (!!data.otwSentAt || trip != null) && !data.arrivedAt;
  const isFresh = trip != null && trip.lastUpdateSec < 60;
  const delay = data?.delayStatus || null;
  const isDelayed = !!delay?.isDelayed;

  const copyReadyText = async () => {
    const text = (data?.readyText || '').trim();
    if (!text) {
      toast('Teks jawaban belum tersedia.', 'error');
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback legacy (bukan window.alert/confirm).
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast('Teks jawaban disalin ke clipboard.', 'success');
    } catch {
      toast('Gagal menyalin teks jawaban.', 'error');
    }
  };

  const copyDelayText = async () => {
    const text = (data?.delayText || '').trim();
    if (!text) {
      toast('Draf pesan keterlambatan belum tersedia.', 'error');
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast('Draf pesan keterlambatan disalin ke clipboard.', 'success');
    } catch {
      toast('Gagal menyalin draf pesan keterlambatan.', 'error');
    }
  };

  if (!isActive) return null;

  const speedKmh = trip?.speed != null ? Math.max(0, trip.speed * 3.6) : null;

  return (
    <div className="rounded-xl border border-[#e9edef] bg-white shadow-xs p-3 space-y-3">
      {isDelayed && (
        <div
          className={`rounded-lg border px-2.5 py-2 text-[11px] space-y-1.5 ${
            delay?.level === 'critical'
              ? 'border-red-300 bg-red-50 text-red-800'
              : 'border-amber-300 bg-amber-50 text-amber-800'
          }`}
        >
          <div className="flex items-start gap-1.5 font-semibold">
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0 animate-pulse" />
            <span>
              Bidan{staffName ? ` ${staffName}` : ''} diprediksi terlambat {delay?.delayMinutes} menit
              {delay?.formattedArrivalWib ? ` (estimasi tiba ±${delay.formattedArrivalWib} WIB)` : ''}.
            </span>
          </div>
          <button
            type="button"
            onClick={copyDelayText}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#008069] bg-[#d9fdd3] hover:bg-[#cbf7c3] border border-[#00a884]/30 rounded-md px-2 py-1"
          >
            <Copy size={12} /> Salin Pesan Keterlambatan Pasien
          </button>
        </div>
      )}

      {data?.isStalledOutsideTarget && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800 space-y-1.5">
          <div className="flex items-start gap-1.5 font-semibold">
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
            <span>
              Perhatian CS: Bidan{staffName ? ` ${staffName}` : ''} terdeteksi berhenti di luar komplek pasien
              {data?.geofenceDistanceM != null ? ` (~${data.geofenceDistanceM} m)` : ''}. Kemungkinan salah jalan atau
              tertahan tembok pembatas. Silakan konfirmasi arah ke Bidan.
            </span>
          </div>
          <button
            type="button"
            onClick={onContactStaff}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-md px-2 py-1"
          >
            <Phone size={12} /> Hubungi Bidan
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold text-[#111b21]">
          <Radar size={14} className={isFresh ? 'text-emerald-600' : 'text-amber-500'} />
          <span>Pemantauan Perjalanan</span>
        </div>
        <div className="flex items-center gap-1">
          <span
            className={`w-2 h-2 rounded-full ${isFresh ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`}
            title={isFresh ? 'Data terupdate < 1 menit' : 'Data mungkin tertunda'}
          />
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="p-1 rounded-md hover:bg-gray-100 text-[#54656f]"
              title="Muat ulang"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          )}
        </div>
      </div>

      {trip ? (
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-[#111b21]">{trip.areaName}</p>
          <p className="text-[10px] text-[#667781]">Update {formatStale(trip.lastUpdateSec)}</p>
          <div className="grid grid-cols-3 gap-2 pt-1">
            <div className="rounded-lg bg-[#f0f2f5] px-2 py-1.5 text-center">
              <p className="text-[10px] text-[#667781]">Sisa</p>
              <p className="text-xs font-bold text-[#111b21]">
                {data?.remainingKm != null ? `${data.remainingKm} km` : '-'}
              </p>
            </div>
            <div className="rounded-lg bg-[#f0f2f5] px-2 py-1.5 text-center">
              <p className="text-[10px] text-[#667781]">Laju</p>
              <p className="text-xs font-bold text-[#111b21]">
                {speedKmh != null ? `${Math.round(speedKmh)} km/j` : '-'}
              </p>
            </div>
            <div className="rounded-lg bg-[#f0f2f5] px-2 py-1.5 text-center">
              <p className="text-[10px] text-[#667781]">ETA</p>
              <p className="text-xs font-bold text-[#111b21]">
                {data?.etaMinutes != null ? `${data.etaMinutes} mnt` : '-'}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-[#667781]">
          {data?.otwSentAt
            ? 'Bidan OTW, menunggu sinyal lokasi pertama...'
            : 'Pemantauan otomatis aktif, menunggu sinyal lokasi pertama...'}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={copyReadyText}
          className="flex-1 inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold text-[#008069] bg-[#d9fdd3] hover:bg-[#cbf7c3] border border-[#00a884]/30 rounded-lg px-2 py-2"
        >
          <Copy size={13} /> Salin Teks Jawaban Pasien
        </button>
        <button
          type="button"
          onClick={() => setMapOpen(true)}
          className="inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold text-[#54656f] bg-[#f0f2f5] hover:bg-[#e9edef] border border-[#e9edef] rounded-lg px-2 py-2"
          title="Lihat peta"
        >
          <Map size={13} /> Peta
        </button>
      </div>

      <DispatchMapModal
        open={mapOpen}
        onClose={() => setMapOpen(false)}
        therapist={trip ? { lat: trip.lat, lng: trip.lng } : null}
        customer={
          data?.customerCoords && data.customerCoords.lat != null && data.customerCoords.lng != null
            ? { lat: data.customerCoords.lat, lng: data.customerCoords.lng }
            : null
        }
        areaName={trip?.areaName}
        staffName={staffName}
        isLive={isFresh}
      />
    </div>
  );
};

export default LiveChatDispatchWidget;
