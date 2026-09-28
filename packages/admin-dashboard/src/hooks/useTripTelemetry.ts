import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '../services/api';

/**
 * Pemancar telemetry perjalanan terapis (OTW) ke backend internal CS.
 *
 * Prinsip:
 * - Hemat baterai & kuota: `watchPosition` + throttle kirim 25 detik (bukan tiap
 *   update GPS), plus interval fallback bila `watchPosition` tidak tersedia.
 * - Silent-fail: sinyal hilang di jalan tidak memunculkan popup yang mengganggu
 *   Bidan (hanya state `lastError` internal untuk indikator halus).
 * - Privasi: `stopTelemetry()` menghentikan watch + interval + melepas wakeLock
 *   dan memanggil `POST /api/staff/trip/stop`.
 * - Wake Lock bersifat best-effort (tidak didukung iOS Safari → diabaikan).
 */

const SEND_INTERVAL_MS = 25_000;
const MIN_ACCURACY_M = 200;

export interface TelemetryStatus {
  active: boolean;
  reservationId: string | null;
  lastSentAt: number | null;
  lastError: string | null;
}

export function useTripTelemetry() {
  const [status, setStatus] = useState<TelemetryStatus>({
    active: false,
    reservationId: null,
    lastSentAt: null,
    lastError: null,
  });

  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<any>(null);
  const activeRef = useRef(false);
  const visibilityHandlerRef = useRef<(() => void) | null>(null);
  const lastPayloadRef = useRef<{ lat: number; lng: number; speed?: number | null; heading?: number | null; accuracy?: number | null } | null>(null);
  const lastSentAtRef = useRef<number>(0);
  const reservationIdRef = useRef<string | null>(null);

  const requestWakeLock = useCallback(async () => {
    try {
      const nav: any = typeof navigator !== 'undefined' ? navigator : null;
      if (nav?.wakeLock?.request && !wakeLockRef.current) {
        wakeLockRef.current = await nav.wakeLock.request('screen');
        wakeLockRef.current?.addEventListener?.('release', () => {
          wakeLockRef.current = null;
        });
      }
    } catch {
      wakeLockRef.current = null;
    }
  }, []);

  const removeVisibilityHandler = useCallback(() => {
    if (visibilityHandlerRef.current && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', visibilityHandlerRef.current);
    }
    visibilityHandlerRef.current = null;
  }, []);

  const flush = useCallback(async (force = false) => {
    const reservationId = reservationIdRef.current;
    const payload = lastPayloadRef.current;
    if (!reservationId || !payload) return;
    const now = Date.now();
    if (!force && now - lastSentAtRef.current < SEND_INTERVAL_MS - 1000) return;
    lastSentAtRef.current = now;
    try {
      await apiRequest('/api/staff/telemetry', {
        method: 'POST',
        body: JSON.stringify({ reservationId, ...payload }),
      });
      setStatus((prev) => ({ ...prev, lastSentAt: now, lastError: null }));
    } catch (err: any) {
      // Silent-fail: jangan ganggu Bidan yang sedang menyetir.
      setStatus((prev) => ({ ...prev, lastError: err?.message || 'gagal kirim' }));
    }
  }, []);

  const stopTelemetry = useCallback(async () => {
    const reservationId = reservationIdRef.current;
    activeRef.current = false;
    removeVisibilityHandler();
    if (watchIdRef.current != null && typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        navigator.geolocation.clearWatch(watchIdRef.current);
      } catch {}
    }
    watchIdRef.current = null;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch {}
      wakeLockRef.current = null;
    }
    lastPayloadRef.current = null;
    reservationIdRef.current = null;
    setStatus({ active: false, reservationId: null, lastSentAt: null, lastError: null });
    if (reservationId) {
      try {
        await apiRequest('/api/staff/trip/stop', {
          method: 'POST',
          body: JSON.stringify({ reservationId }),
        });
      } catch {}
    }
  }, [removeVisibilityHandler]);

  const startTelemetry = useCallback(
    async (reservationId: string) => {
      if (!reservationId) return;
      // Restart bersih bila sudah aktif untuk reservasi lain.
      if (reservationIdRef.current && reservationIdRef.current !== reservationId) {
        await stopTelemetry();
      }
      reservationIdRef.current = reservationId;
      setStatus({ active: true, reservationId, lastSentAt: null, lastError: null });

      const onPosition = (pos: GeolocationPosition) => {
        const { latitude, longitude, speed, heading, accuracy } = pos.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        // Tolak drift akurasi buruk (indoor) agar tidak mencemari geofence.
        if (accuracy != null && accuracy > MIN_ACCURACY_M) return;
        lastPayloadRef.current = {
          lat: latitude,
          lng: longitude,
          speed: speed != null && Number.isFinite(speed) ? speed : null,
          heading: heading != null && Number.isFinite(heading) ? heading : null,
          accuracy: accuracy != null && Number.isFinite(accuracy) ? accuracy : null,
        };
        flush(false);
      };

      const onError = () => {
        setStatus((prev) => ({ ...prev, lastError: 'gps_unavailable' }));
      };

      if (typeof navigator !== 'undefined' && navigator.geolocation?.watchPosition) {
        watchIdRef.current = navigator.geolocation.watchPosition(onPosition, onError, {
          enableHighAccuracy: true,
          maximumAge: 10_000,
          timeout: 20_000,
        });
      } else if (typeof navigator !== 'undefined' && navigator.geolocation?.getCurrentPosition) {
        navigator.geolocation.getCurrentPosition(onPosition, onError, { enableHighAccuracy: true });
      }

      // Interval pengiriman tetap 25 detik (fallback bila watchPosition di-throttle OS).
      intervalRef.current = setInterval(() => flush(true), SEND_INTERVAL_MS);

      // Wake Lock best-effort: cegah layar mati di holder motor (Android).
      activeRef.current = true;
      await requestWakeLock();

      // Re-acquire: browser melepas wake lock saat tab disembunyikan. Ambil ulang
      // begitu tab kembali visible agar layar HP tidak mati di perjalanan.
      removeVisibilityHandler();
      const onVisibility = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible' && activeRef.current) {
          requestWakeLock();
        }
      };
      visibilityHandlerRef.current = onVisibility;
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibility);
      }
    },
    [flush, stopTelemetry, requestWakeLock, removeVisibilityHandler]
  );

  // Bersihkan total saat komponen unmount (privasi).
  useEffect(() => {
    return () => {
      activeRef.current = false;
      if (visibilityHandlerRef.current && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', visibilityHandlerRef.current);
      }
      if (watchIdRef.current != null && typeof navigator !== 'undefined' && navigator.geolocation) {
        try {
          navigator.geolocation.clearWatch(watchIdRef.current);
        } catch {}
      }
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (wakeLockRef.current) {
        try {
          wakeLockRef.current.release();
        } catch {}
      }
    };
  }, []);

  return { status, startTelemetry, stopTelemetry };
}
