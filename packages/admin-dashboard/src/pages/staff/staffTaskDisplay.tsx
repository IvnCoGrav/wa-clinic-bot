/**
 * Potongan tampilan tugas terapis yang dipakai ulang di kartu daftar dan modal
 * detail. Isinya sengaja murni presentasi: badge status alamat, chip koreksi
 * alamat, dan pemetaan kategori treatment ke ikon/warna.
 */
import { AlertTriangle, Baby, Heart, RefreshCw, Smile, User } from 'lucide-react';
import { getLocationBadgeConfig } from '../../utils/geoUtils';

/**
 * Badge deterministik status akurasi koordinat pada kartu tugas terapis.
 * Sumber: `location_source` dari server (state, bukan tebakan klien).
 * Tujuan: terapis tahu apakah titik = pin rumah presisi atau estimasi wilayah
 * (wajib minta shareloc/patokan), mencegah terapis tersasar.
 */
export function AccuracyBadge({ source }: { source?: string | null }) {
  const badge = getLocationBadgeConfig(source);
  if (!badge.source) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold ${badge.badgeClass} px-1.5 py-0.5 rounded-md`}
      title={
        badge.source === 'gps_pin'
          ? 'Titik koordinat presisi dari pin GPS / shareloc pasien.'
          : badge.source === 'manual_staff'
            ? 'Titik koordinat diverifikasi oleh bidan/staf di lapangan.'
            : 'Titik masih estimasi wilayah (belum ada pin GPS rumah). Konfirmasi shareloc/patokan ke pasien sebelum berangkat.'
      }
    >
      {badge.source === 'estimated_area' ? <AlertTriangle size={10} /> : null}
      {badge.label}
    </span>
  );
}

/**
 * Chip transparansi: seberapa baru alamat tugas dikoreksi (server-driven
 * `address_updated_at`, bukan tebakan klien). Hanya tampil < 24 jam agar staf
 * tahu koreksi profil terbaru sudah terserap; alamat basi tidak berisik.
 */
export function AddressUpdatedAtChip({ updatedAt }: { updatedAt?: string | null }) {
  if (!updatedAt) return null;
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return null;
  const hours = (Date.now() - ts) / 36e5;
  if (hours < 0 || hours >= 24) return null;
  const label = hours < 1 ? 'kurang dari 1 jam' : `${Math.floor(hours)} jam`;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold text-warning bg-warning-soft border border-warning-line px-1.5 py-0.5 rounded-md"
      title="Alamat pelanggan dikoreksi (via chat/staf) dan sudah terserap ke tugas ini."
    >
      <RefreshCw size={10} />
      {`Alamat diperbarui ${label} lalu`}
    </span>
  );
}

/** Pemetaan kategori treatment ke ikon, warna, dan label yang dipakai UI. */
export function getCategoryIcon(category: string | null) {
  const cat = (category || '').toUpperCase();
  if (cat === 'BABY') {
    return {
      icon: <Baby size={18} className="text-info" />,
      bg: 'bg-info-soft border-info-line text-info',
      badge: 'bg-info-soft text-info border-info-line',
      borderAccent: 'border-l-sky-500 bg-info-soft/20',
      label: 'Baby Spa',
    };
  }
  if (cat === 'MOMS') {
    return {
      icon: <Heart size={18} className="text-violet" />,
      bg: 'bg-violet-soft border-violet-line text-violet',
      badge: 'bg-violet-soft text-violet border-violet-line',
      borderAccent: 'border-l-purple-500 bg-violet-soft/20',
      label: 'Moms Spa',
    };
  }
  if (cat === 'BOTH' || cat === 'KIDS') {
    return {
      icon: <Smile size={18} className="text-success" />,
      bg: 'bg-success-soft border-success-line text-success',
      badge: 'bg-success-soft text-success border-success-line',
      borderAccent: 'border-l-emerald-500 bg-success-soft/20',
      label: 'Moms & Baby',
    };
  }
  return {
    icon: <User size={18} className="text-success" />,
    bg: 'bg-teal-100 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800/40 text-teal-700 dark:text-accent',
    badge: 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-accent border-teal-200 dark:border-teal-800/40',
    borderAccent: 'border-l-teal-500 bg-teal-50/20 dark:bg-teal-950/20',
    label: 'Treatment',
  };
}
