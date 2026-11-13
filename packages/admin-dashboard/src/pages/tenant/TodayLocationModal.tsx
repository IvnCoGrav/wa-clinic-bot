/**
 * Modal panduan dan pembaruan lokasi pasien untuk dashboard tenant.
 *
 * Presentasi murni: state GPS, foto, dan simpan tetap di halaman induk karena
 * prosesnya memperbarui daftar tugas dan memakai geolokasi perangkat.
 */
import React, { useRef } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Crosshair,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  Loader,
  MapPin,
  Maximize2,
  Pencil,
  Search,
  X,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { getGoogleMapsDirectionUrl } from '../../utils/geoUtils';
import { TreatmentTask } from './todayTreatmentsTypes';

export interface LocationCoords {
  lat: number;
  lng: number;
  accuracy?: number;
}

interface TodayLocationModalProps {
  task: TreatmentTask;
  mode: 'view' | 'edit';
  hasSavedLocData: boolean;
  coords: LocationCoords | null;
  gettingGps: boolean;
  gpsError: string | null;
  geocoding: boolean;
  mapsResolving: boolean;
  mapsUrlInput: string;
  showManualCoords: boolean;
  housePhotoB64: string | null;
  landmark: string;
  processingPhoto: boolean;
  saving: boolean;
  onClose: () => void;
  onModeChange: (mode: 'view' | 'edit') => void;
  onGetGps: () => void;
  onPasteMapsUrl: (url: string) => void;
  onGeocodeAddress: () => void;
  onProcessPhoto: (file: File) => void;
  onCoordsChange: (
    next: LocationCoords | null | ((prev: LocationCoords | null) => LocationCoords | null)
  ) => void;
  onToggleManual: () => void;
  onRemoveHousePhoto: () => void;
  onLandmarkChange: (value: string) => void;
  onShowImage: (url: string | null) => void;
  onSave: (e: React.FormEvent) => void;
}

export const TodayLocationModal: React.FC<TodayLocationModalProps> = ({
  task,
  mode,
  hasSavedLocData,
  coords,
  gettingGps,
  gpsError,
  geocoding,
  mapsResolving,
  mapsUrlInput,
  showManualCoords,
  housePhotoB64,
  landmark,
  processingPhoto,
  saving,
  onClose,
  onModeChange,
  onGetGps,
  onPasteMapsUrl,
  onGeocodeAddress,
  onProcessPhoto,
  onCoordsChange,
  onToggleManual,
  onRemoveHousePhoto,
  onLandmarkChange,
  onShowImage,
  onSave,
}) => {
  const locHouseCameraInputRef = useRef<HTMLInputElement>(null);
  const locHouseGalleryInputRef = useRef<HTMLInputElement>(null);

  return (
  <Modal
    open
    onClose={() => onClose()}
    size="md"
    bodyClassName="p-0 overflow-hidden flex-1 flex flex-col min-h-0"
    title={
      <span className="flex items-center gap-2">
        <MapPin size={20} className="text-accent" aria-hidden="true" />
        <span>{mode === 'view' ? 'Panduan Lokasi Tersimpan' : 'Update Lokasi & Foto Rumah'}</span>
      </span>
    }
    subtitle={task.customerName || 'Pasien'}
  >

        {mode === 'view' ? (
          <div className="flex-1 overflow-y-auto p-5 space-y-4 text-left overscroll-contain">
            {/* Foto Rumah Tersimpan */}
            {task.address.housePhotoUrl ? (
              <div className="relative rounded-2xl overflow-hidden border border-divider bg-black/5 flex items-center justify-center max-h-56 group">
                <img
                  src={task.address.housePhotoUrl}
                  alt="Foto Rumah"
                  className="object-contain max-h-56 w-auto rounded-xl"
                />
                <button
                  type="button"
                  onClick={() => onShowImage(task.address.housePhotoUrl!)}
                  className="absolute bottom-2.5 right-2.5 px-3 py-1.5 rounded-xl bg-black/70 text-white text-xs font-semibold hover:bg-black/90 transition shadow-md flex items-center gap-1.5 cursor-pointer"
                >
                  <Maximize2 size={13} />
                  <span>Lihat Penuh</span>
                </button>
              </div>
            ) : (
              <div className="p-5 rounded-2xl border-2 border-dashed border-divider bg-surface-2 text-center text-xs text-ink-3 space-y-1">
                <ImageIcon size={24} className="mx-auto text-ink-3" />
                <p>Belum ada foto tampak depan rumah</p>
              </div>
            )}

            {/* Info Titik GPS */}
            {task.address.lat && task.address.lng ? (
              <div className="p-3.5 bg-bubble-out/70 border border-accent/40 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-xs font-bold text-accent dark:text-ink">
                    <CheckCircle2 size={15} className="text-accent" />
                    <span>Titik GPS Terkunci</span>
                  </div>
                  <a
                    href={getGoogleMapsDirectionUrl(task.address.lat, task.address.lng, task.address.fullText || task.address.kelurahan || null)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 rounded-lg bg-accent text-accent-ink text-[11px] font-bold hover:bg-accent transition inline-flex items-center gap-1 shadow-2xs"
                  >
                    <span>Buka Maps</span>
                    <ExternalLink size={11} />
                  </a>
                </div>
                <p className="text-xs font-mono text-ink bg-white/80 dark:bg-black/30 px-2.5 py-1.5 rounded-xl border border-accent/20">
                  {task.address.lat.toFixed(6)}, {task.address.lng.toFixed(6)}
                </p>
              </div>
            ) : (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-xl text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2">
                <AlertTriangle size={15} className="shrink-0 text-warning" />
                <span>Belum ada titik GPS presisi untuk pasien ini.</span>
              </div>
            )}

            {/* Info Patokan */}
            {task.address.landmark && (
              <div className="p-3.5 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/40 rounded-2xl space-y-1">
                <span className="text-[10px] font-bold text-sky-800 dark:text-info uppercase tracking-wider block">
                  Patokan / Ciri Rumah:
                </span>
                <p className="text-xs font-medium text-ink">
                  {task.address.landmark}
                </p>
              </div>
            )}

            {/* Info Alamat Tercatat */}
            <div className="p-3 rounded-xl bg-surface-2 dark:bg-surface-2 border border-divider text-xs text-ink-2 space-y-1">
              <span className="text-[10px] font-bold text-ink-3 uppercase tracking-wider block">
                Alamat Tercatat:
              </span>
              <p className="text-xs text-ink font-medium leading-snug">
                {task.address.fullText || `${task.address.kelurahan || ''}, ${task.address.kecamatan || ''}`}
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-divider">
              <button
                type="button"
                onClick={() => onClose()}
                className="px-4 py-2.5 rounded-xl border border-divider text-xs font-semibold text-ink-2 hover:bg-fill-1 transition cursor-pointer"
              >
                Tutup
              </button>
              <button
                type="button"
                onClick={() => onModeChange('edit')}
                className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-ink text-xs font-bold transition flex items-center space-x-1.5 shadow-xs cursor-pointer active:scale-95"
              >
                <Pencil size={13} />
                <span>Edit / Perbarui Data</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSave} className="flex-1 overflow-y-auto p-5 space-y-4 text-left overscroll-contain">
            {hasSavedLocData && (
              <button
                type="button"
                onClick={() => onModeChange('view')}
                className="text-xs font-bold text-accent hover:underline flex items-center gap-1 cursor-pointer mb-1"
              >
                <ArrowLeft size={13} />
                <span>Kembali ke Panduan Tersimpan</span>
              </button>
            )}

            <div className="space-y-1.5">
              <label htmlFor="loc-landmark" className="block text-xs font-bold text-ink">Patokan Rumah (Landmark):</label>
              <input
                id="loc-landmark"
                type="text"
                value={landmark}
                onChange={(e) => onLandmarkChange(e.target.value)}
                placeholder="Contoh: Pagar hitam, depan pos satpam blok C..."
                className="w-full bg-surface border border-divider rounded-xl p-3 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent shadow-xs"
              />
            </div>

            {/* Smart GPS & Maps Link Section */}
            <div className="space-y-3 bg-surface-2 dark:bg-surface-2 -mx-5 p-5 rounded-2xl border border-divider">
              <div className="flex items-center justify-between">
                <span className="block text-xs font-bold text-ink flex items-center space-x-1.5">
                  <Crosshair size={13} className="text-accent" />
                  <span>Kunci Titik GPS Pasien:</span>
                </span>
                {coords && (
                  <a
                    href={getGoogleMapsDirectionUrl(coords.lat, coords.lng, landmark || task?.address?.fullText || null)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-bold text-accent hover:underline inline-flex items-center gap-1"
                  >
                    <span>Lihat Maps</span>
                    <ExternalLink size={11} />
                  </a>
                )}
              </div>

              {/* Assistant 1: Tempel Link Maps */}
              <div className="space-y-1">
                <label htmlFor="loc-maps-url" className="block text-[10px] font-semibold text-ink-2 flex items-center gap-1">
                  <Link2 size={11} className="text-accent" />
                  <span>Tempel Link Shareloc / Google Maps Pasien:</span>
                </label>
                <div className="flex space-x-1.5">
                  <input
                    type="text"
                    value={mapsUrlInput}
                    onChange={(e) => onPasteMapsUrl(e.target.value)}
                    placeholder="Paste link Google Maps / shareloc di sini..."
                    className="flex-1 px-3 py-2 bg-surface border border-divider rounded-xl text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent shadow-2xs"
                  />
                  <button
                    type="button"
                    onClick={() => onPasteMapsUrl(mapsUrlInput)}
                    disabled={mapsResolving || !mapsUrlInput.trim()}
                    className="px-3 py-2 bg-surface hover:bg-accent-soft dark:hover:bg-fill-2 border border-divider text-accent rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-2xs disabled:opacity-50 cursor-pointer"
                    title="Cari koordinat dari tautan"
                  >
                    {mapsResolving ? <Loader size={12} className="animate-spin" /> : <Search size={12} />}
                    <span>Cek</span>
                  </button>
                </div>
                {mapsResolving && (
                  <p className="text-[11px] text-accent flex items-center gap-1.5 animate-pulse mt-1">
                    <Loader size={12} className="animate-spin" />
                    <span>Sedang mengurai tautan Google Maps...</span>
                  </p>
                )}
              </div>

              {/* Assistant 2: Tombol Cepat GPS & Geocode */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onGetGps()}
                  disabled={gettingGps}
                  className="py-2.5 px-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 text-accent border border-emerald-300 dark:border-emerald-800/40 text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer shadow-2xs active:scale-[0.98]"
                >
                  <Crosshair size={13} className={gettingGps ? 'animate-spin' : ''} />
                  <span>{gettingGps ? 'Mengunci...' : ' Kunci GPS Saya'}</span>
                </button>

                <button
                  aria-label="Cari"
                  type="button"
                  onClick={onGeocodeAddress}
                  disabled={geocoding}
                  className="py-2.5 px-3 rounded-xl bg-sky-50 dark:bg-sky-950/30 hover:bg-sky-100 dark:hover:bg-sky-950/50 text-sky-800 dark:text-info border border-sky-300 dark:border-sky-800/40 text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer shadow-2xs active:scale-[0.98]"
                >
                  <Search size={13} className={geocoding ? 'animate-spin' : ''} />
                  <span>{geocoding ? 'Mencari...' : ' Cari dari Alamat'}</span>
                </button>
              </div>

              {/* Coordinate Status Badge */}
              {coords ? (
                <div className="p-2.5 bg-bubble-out/70 border border-accent/40 rounded-xl flex items-center justify-between text-xs text-accent">
                  <div className="flex items-center space-x-1.5 font-mono font-bold">
                    <CheckCircle2 size={14} className="text-accent shrink-0" />
                    <span>Titik: {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}</span>
                    {coords.accuracy && <span className="text-[10px] text-ink-2">(±{coords.accuracy}m)</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => onCoordsChange(null)}
                    className="text-[10px] text-rose-600 dark:text-danger hover:underline font-semibold"
                  >
                    Hapus
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-ink-3 italic">
                  Belum ada titik koordinat. Gunakan tombol di atas atau tempel link Maps.
                </p>
              )}

              {gpsError && (
                <p className="text-[11px] text-rose-600 dark:text-danger bg-rose-50 dark:bg-rose-950/30 p-2 rounded-lg border border-rose-200 dark:border-rose-800/40">
                  {gpsError}
                </p>
              )}

              {/* Collapsible Manual Coordinates */}
              <div>
                <button
                  type="button"
                  onClick={() => onToggleManual()}
                  className="text-[11px] text-ink-2 hover:text-ink dark:hover:text-ink font-semibold flex items-center gap-1 transition"
                >
                  <span>{showManualCoords ? 'Sembunyikan Input Manual' : 'Input Koordinat Manual (Angka)'}</span>
                  {showManualCoords ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>

                {showManualCoords && (
                  <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-divider">
                    <div className="space-y-1">
                      <label htmlFor="loc-lat" className="block text-[10px] text-ink-3">Latitude</label>
                      <input
                        id="loc-lat"
                        type="text"
                        value={coords?.lat ?? ''}
                        onChange={(e) => {
                          const val = e.target.value ? parseFloat(e.target.value) : 0;
                          onCoordsChange((prev) => ({ lat: val, lng: prev?.lng || 0 }));
                        }}
                        placeholder="-7.3488"
                        className="w-full px-3 py-2 bg-surface border border-divider rounded-xl text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent transition"
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="loc-lng" className="block text-[10px] text-ink-3">Longitude</label>
                      <input
                        id="loc-lng"
                        type="text"
                        value={coords?.lng ?? ''}
                        onChange={(e) => {
                          const val = e.target.value ? parseFloat(e.target.value) : 0;
                          onCoordsChange((prev) => ({ lat: prev?.lat || 0, lng: val }));
                        }}
                        placeholder="112.7516"
                        className="w-full px-3 py-2 bg-surface border border-divider rounded-xl text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent transition"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Foto Rumah dengan Pilihan Eksplisit Kamera / Galeri */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="block text-xs font-bold text-ink">Foto Tampak Depan Rumah:</span>
                {processingPhoto && (
                  <span className="text-[11px] text-accent font-medium animate-pulse">
                    Mengompres foto...
                  </span>
                )}
              </div>

              {/* Dual Hidden Inputs: 1 for Direct Camera, 1 for Gallery File */}
              <input
                type="file"
                ref={locHouseCameraInputRef}
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onProcessPhoto(file);
                }}
                className="hidden"
              />
              <input
                type="file"
                ref={locHouseGalleryInputRef}
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onProcessPhoto(file);
                }}
                className="hidden"
              />

              {housePhotoB64 ? (
                <div className="relative rounded-2xl overflow-hidden border border-divider bg-black/5 flex items-center justify-center max-h-48">
                  <img src={housePhotoB64} alt="Rumah" className="object-contain max-h-48 w-auto rounded-xl" />
                  <div className="absolute top-2 right-2 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onShowImage(housePhotoB64)}
                      className="p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition shadow-md cursor-pointer"
                      title="Zoom Foto"
                    >
                      <Maximize2 size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveHousePhoto()}
                      className="p-1.5 rounded-full bg-danger text-on-solid hover:bg-danger-hover transition shadow-md cursor-pointer"
                      title="Hapus Foto"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => locHouseCameraInputRef.current?.click()}
                    disabled={processingPhoto}
                    className="py-3.5 px-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 border-2 border-dashed border-emerald-300 dark:border-emerald-800/40 text-accent text-xs font-bold transition flex flex-col items-center justify-center gap-1.5 cursor-pointer shadow-xs active:scale-[0.98]"
                  >
                    <Camera size={20} className="text-accent" />
                    <span>Ambil Kamera</span>
                    <span className="text-[10px] text-ink-2 font-normal">Buka kamera HP langsung</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => locHouseGalleryInputRef.current?.click()}
                    disabled={processingPhoto}
                    className="py-3.5 px-3 rounded-2xl bg-slate-50 dark:bg-surface-2 hover:bg-slate-100 dark:hover:bg-fill-2 border-2 border-dashed border-slate-300 dark:border-divider text-slate-700 dark:text-ink-2 text-xs font-bold transition flex flex-col items-center justify-center gap-1.5 cursor-pointer shadow-xs active:scale-[0.98]"
                  >
                    <ImageIcon size={20} className="text-ink-2" />
                    <span>Pilih Galeri</span>
                    <span className="text-[10px] text-ink-3 font-normal">Dari album foto / file</span>
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-divider">
              <button
                type="button"
                onClick={() => (hasSavedLocData ? onModeChange('view') : onClose())}
                className="px-4 py-2.5 rounded-xl border border-divider text-xs font-semibold text-ink-2 hover:bg-fill-1 transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-ink text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50 cursor-pointer active:scale-95"
              >
                {saving ? <span>Menyimpan...</span> : <span>Simpan Lokasi</span>}
              </button>
            </div>
          </form>
        )}
  </Modal>
  );
};
