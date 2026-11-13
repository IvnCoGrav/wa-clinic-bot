/**
 * Modal panduan lokasi pasien: foto tampak depan rumah, titik GPS, dan patokan.
 *
 * Komponen ini presentasi murni. Pengambilan GPS, kompresi foto, dan simpan ke
 * server tetap di halaman induk karena menyentuh state daftar tugas dan alur
 * chat. Dengan begitu tombol Back dan warmup GPS tidak berubah perilakunya.
 */
import React, { useRef } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Crosshair,
  ExternalLink,
  Image as ImageIcon,
  MapPin,
  Maximize2,
  Navigation,
  Pencil,
  RefreshCw,
  X,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { StaffTask } from './staffTaskTypes';

export interface LocationCoords {
  lat: number;
  lng: number;
  accuracy?: number;
}

interface StaffLocationModalProps {
  task: StaffTask;
  mode: 'view' | 'edit';
  hasSavedLocData: boolean;
  coords: LocationCoords | null;
  housePhotoB64: string | null;
  landmark: string;
  gettingGps: boolean;
  gpsAttemptInfo: string | null;
  processingPhoto: boolean;
  submitting: boolean;
  onClose: () => void;
  onModeChange: (mode: 'view' | 'edit') => void;
  onGetGps: () => void;
  onPickPhoto: (file: File) => void;
  onRemovePhoto: () => void;
  onLandmarkChange: (value: string) => void;
  onShowSavedPhoto: (url: string) => void;
  onSave: () => void;
}

export const StaffLocationModal: React.FC<StaffLocationModalProps> = ({
  task,
  mode,
  hasSavedLocData,
  coords,
  housePhotoB64,
  landmark,
  gettingGps,
  gpsAttemptInfo,
  processingPhoto,
  submitting,
  onClose,
  onModeChange,
  onGetGps,
  onPickPhoto,
  onRemovePhoto,
  onLandmarkChange,
  onShowSavedPhoto,
  onSave,
}) => {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <MapPin size={18} className="text-accent" aria-hidden="true" />
          <span>{mode === 'view' ? 'Panduan Lokasi Tersimpan' : 'Update Lokasi & Foto Rumah'}</span>
        </span>
      }
      subtitle={task.customerName || 'Customer'}
    >
      {mode === 'view' ? (
        <div className="space-y-4">
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
                onClick={() => onShowSavedPhoto(task.address.housePhotoUrl as string)}
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
          {task.address.lat != null && task.address.lng != null ? (
            <div className="p-3.5 bg-bubble-out/70 border border-accent/40 rounded-2xl space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5 text-xs font-bold text-accent">
                  <CheckCircle2 size={15} className="text-accent" />
                  <span>Titik GPS Terkunci</span>
                </div>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${task.address.lat},${task.address.lng}&travelmode=two-wheeler`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 rounded-lg bg-accent text-on-solid text-[11px] font-bold hover:bg-accent-hover transition inline-flex items-center gap-1 shadow-2xs"
                >
                  <span>Buka Maps</span>
                  <ExternalLink size={11} />
                </a>
              </div>
              <p className="text-xs font-mono text-ink bg-white/80 px-2.5 py-1.5 rounded-xl border border-accent/20">
                {task.address.lat.toFixed(6)}, {task.address.lng.toFixed(6)}
              </p>
            </div>
          ) : (
            <div className="p-3 bg-warning-soft border border-warning-line rounded-xl text-xs text-warning flex items-center gap-2">
              <AlertTriangle size={15} className="shrink-0 text-warning" />
              <span>Belum ada titik GPS presisi untuk pasien ini.</span>
            </div>
          )}

          {/* Info Patokan */}
          {task.address.landmark && (
            <div className="p-3.5 bg-info-soft border border-info-line rounded-2xl space-y-1">
              <span className="text-[10px] font-bold text-info uppercase tracking-wider block">
                Patokan / Ciri Rumah:
              </span>
              <p className="text-xs font-medium text-ink">{task.address.landmark}</p>
            </div>
          )}

          {/* Info Alamat Pasien */}
          <div className="p-3 rounded-xl bg-surface-2 border border-divider text-xs text-ink-2 space-y-1">
            <span className="text-[10px] font-bold text-ink-2 uppercase tracking-wider block">
              Alamat Tercatat:
            </span>
            <p className="text-xs text-ink font-medium leading-snug">{task.address.fullText}</p>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-2 pt-3 border-t border-divider">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-divider text-xs font-semibold text-ink-2 hover:bg-fill-1 transition"
            >
              Tutup
            </button>
            <button
              type="button"
              onClick={() => onModeChange('edit')}
              className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-on-solid text-xs font-bold transition flex items-center space-x-1.5 shadow-xs active:scale-95"
            >
              <Pencil size={13} />
              <span>Edit / Perbarui Panduan</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
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

          {/* Info Alamat Pasien */}
          <div className="p-3 rounded-xl bg-surface-2 border border-divider text-xs text-ink-2 space-y-1">
            <span className="text-[10px] font-bold text-ink-2 uppercase tracking-wider block">
              Alamat Tercatat:
            </span>
            <p className="text-xs text-ink font-medium leading-snug">{task.address.fullText}</p>
          </div>

          {/* Bagian 1: Koordinat GPS Otomatis */}
          <div className="space-y-2">
            <span className="block text-xs font-bold text-ink">1. Titik Koordinat GPS Rumah Pasien:</span>

            <button
              type="button"
              onClick={onGetGps}
              disabled={gettingGps}
              className="w-full min-h-[46px] py-2.5 px-3 rounded-xl bg-accent hover:bg-accent-hover text-on-solid text-xs font-bold transition flex items-center justify-center space-x-2 shadow-xs active:scale-95 disabled:opacity-50"
            >
              {gettingGps ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                  <span>{gpsAttemptInfo || 'Mendeteksi Satelit GPS (Target ≤ 10m)...'}</span>
                </>
              ) : (
                <>
                  <Crosshair size={14} />
                  <span>Gunakan Titik GPS HP Saya Sekarang</span>
                </>
              )}
            </button>

            {coords ? (
              <div
                className={`p-2.5 rounded-xl border text-xs flex items-center justify-between transition ${
                  (coords.accuracy ?? 999) <= 10
                    ? 'bg-bubble-out/70 border-accent/30 text-accent'
                    : 'bg-warning-soft border-warning-line text-warning'
                }`}
              >
                <div>
                  <div className="font-bold flex items-center gap-1">
                    {(coords.accuracy ?? 999) <= 10 ? (
                      <>
                        <CheckCircle2 size={13} className="text-accent" />
                        <span>GPS Sangat Akurat (≤10m)</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle size={13} className="text-warning" />
                        <span>Akurasi Cukup (±{coords.accuracy}m)</span>
                      </>
                    )}
                  </div>
                  <div className="font-mono text-[11px] text-ink-2 mt-0.5">
                    {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
                    {coords.accuracy ? ` (Akurasi: ±${coords.accuracy}m)` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onGetGps}
                    disabled={gettingGps}
                    className="p-1.5 rounded-lg bg-surface border border-divider hover:bg-fill-1 text-ink-2 text-[11px] font-semibold flex items-center gap-1 shadow-xs"
                    title="Kunci Ulang GPS"
                  >
                    <RefreshCw size={11} className={gettingGps ? 'animate-spin' : ''} />
                    <span>Ulang</span>
                  </button>
                  <a
                    href={`https://maps.google.com/?q=${coords.lat},${coords.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg bg-surface text-accent border border-accent/30 hover:bg-accent-soft text-xs font-semibold flex items-center gap-1 shadow-xs"
                    title="Cek di Google Maps"
                  >
                    <Navigation size={12} />
                    <span>Cek</span>
                  </a>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-ink-3 italic">
                * Berdirilah di luar pagar/depan rumah pasien lalu tekan tombol GPS di atas (target akurasi ≤ 10m).
              </p>
            )}
          </div>

          {/* Bagian 2: Foto Tampak Depan Rumah */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="block text-xs font-bold text-ink">2. Foto Tampak Depan Rumah:</span>
              {processingPhoto && (
                <span className="text-[10px] text-accent font-medium animate-pulse">Mengompres foto...</span>
              )}
            </div>

            {/* Dua input tersembunyi: kamera langsung dan galeri. */}
            <input
              type="file"
              ref={cameraInputRef}
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickPhoto(f);
              }}
              className="hidden"
            />
            <input
              type="file"
              ref={galleryInputRef}
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickPhoto(f);
              }}
              className="hidden"
            />

            {housePhotoB64 ? (
              <div className="relative rounded-2xl overflow-hidden border border-divider bg-black/5 flex items-center justify-center max-h-48">
                <img
                  src={housePhotoB64}
                  alt="Tampak Depan Rumah"
                  className="object-contain max-h-48 w-auto rounded-xl"
                />
                <div className="absolute top-2 right-2 flex gap-1">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition"
                    title="Foto ulang kamera"
                    aria-label="Foto ulang dengan kamera"
                  >
                    <Camera size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={onRemovePhoto}
                    className="p-1.5 rounded-full bg-danger text-on-solid hover:bg-danger-hover transition"
                    title="Hapus foto"
                    aria-label="Hapus foto rumah"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={processingPhoto}
                  className="min-h-[46px] py-3 px-3 rounded-2xl bg-success-soft hover:bg-success-line border-2 border-dashed border-success-line text-accent text-xs font-bold transition flex flex-col items-center justify-center gap-1 cursor-pointer shadow-xs active:scale-[0.98]"
                >
                  <Camera size={18} className="text-accent" />
                  <span>Buka Kamera</span>
                  <span className="text-[10px] text-ink-2 font-normal">Foto depan rumah</span>
                </button>

                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={processingPhoto}
                  className="min-h-[46px] py-3 px-3 rounded-2xl bg-surface-2 hover:bg-fill-2 border-2 border-dashed border-strong text-ink text-xs font-bold transition flex flex-col items-center justify-center gap-1 cursor-pointer shadow-xs active:scale-[0.98]"
                >
                  <ImageIcon size={18} className="text-ink-2" />
                  <span>Pilih Galeri</span>
                  <span className="text-[10px] text-ink-3 font-normal">Dari album foto</span>
                </button>
              </div>
            )}
          </div>

          {/* Bagian 3: Patokan Landmark */}
          <div className="space-y-1.5">
            <span className="block text-xs font-bold text-ink">3. Catatan Patokan / Ancer-ancer Rumah:</span>
            <input
              type="text"
              value={landmark}
              onChange={(e) => onLandmarkChange(e.target.value)}
              placeholder="Contoh: Pagar hitam, samping toko berkah, seberang masjid"
              className="w-full px-3.5 py-2.5 bg-surface border border-divider rounded-xl text-[16px] sm:text-sm text-ink placeholder-ink-3 focus:outline-none focus:border-accent transition shadow-xs"
            />
          </div>

          {/* Tombol Simpan */}
          <div className="flex justify-end space-x-2 pt-3 border-t border-divider">
            <button
              type="button"
              onClick={() => (hasSavedLocData ? onModeChange('view') : onClose())}
              disabled={submitting}
              className="px-4 py-2.5 rounded-xl border border-divider text-xs font-semibold text-ink-2 hover:bg-fill-1 transition"
            >
              Batal
            </button>
            <button
              aria-label="Tandai selesai"
              type="button"
              onClick={onSave}
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-on-solid text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                  <span>Menyimpan...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={14} />
                  <span>Simpan Pembaruan Lokasi</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};
