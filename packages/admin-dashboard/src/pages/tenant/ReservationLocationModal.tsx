/**
 * Modal admin untuk memperbarui titik GPS, foto rumah, dan patokan reservasi.
 *
 * Presentasi murni: state koordinat dan foto tetap di halaman induk karena
 * proses simpan memperbarui daftar reservasi dan memakai geolokasi perangkat.
 */
import React, { useRef } from 'react';
import {
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Crosshair,
  ExternalLink,
  Link2,
  Loader,
  MapPin,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { getGoogleMapsDirectionUrl } from '../../utils/geoUtils';
import { Reservation } from '../../types';

interface ReservationLocationModalProps {
  task: Reservation;
  lat: string;
  lng: string;
  landmark: string;
  housePhotoB64: string | null;
  removePhoto: boolean;
  showManualCoords: boolean;
  gettingGps: boolean;
  geocoding: boolean;
  mapsResolving: boolean;
  mapsUrlInput: string;
  gpsAccuracy: number | null;
  saving: boolean;
  onClose: () => void;
  onGetGps: () => void;
  onPasteMapsUrl: (url: string) => void;
  onGeocodeAddress: () => void;
  onPickPhoto: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onLatChange: (value: string) => void;
  onLngChange: (value: string) => void;
  onLandmarkChange: (value: string) => void;
  onPhotoChange: (dataUrl: string | null) => void;
  onRemovePhotoChange: (remove: boolean) => void;
  onToggleManual: () => void;
}

export const ReservationLocationModal: React.FC<ReservationLocationModalProps> = ({
  task,
  lat,
  lng,
  landmark,
  housePhotoB64,
  removePhoto,
  showManualCoords,
  gettingGps,
  geocoding,
  mapsResolving,
  mapsUrlInput,
  gpsAccuracy,
  saving,
  onClose,
  onGetGps,
  onPasteMapsUrl,
  onGeocodeAddress,
  onPickPhoto,
  onSave,
  onLatChange,
  onLngChange,
  onLandmarkChange,
  onPhotoChange,
  onRemovePhotoChange,
  onToggleManual,
}) => {
  const adminHouseFileInputRef = useRef<HTMLInputElement>(null);

  return (
  <Modal
    open
    onClose={() => onClose()}
    size="md"
    title={
      <span className="flex items-center gap-2">
        <MapPin size={20} className="text-accent" aria-hidden="true" />
        <span>Edit Panduan Lokasi & Foto Rumah</span>
      </span>
    }
    subtitle={`${task.customer?.name || 'Bunda'} (${task.customer?.phone || '-'})`}
  >

        {/* Info Alamat Pasien */}
        <div className="p-3 rounded-2xl bg-surface-2 border border-divider text-xs text-ink-2 space-y-1">
          <span className="text-[10px] font-bold text-ink-3 uppercase tracking-wider block">
            Alamat Rumah:
          </span>
          <p className="text-xs text-ink font-medium leading-snug">
            {(() => {
              const cardId = (task as any).customer_address_id;
              const prefs = task.customer?.preferences as any;
              const card = (Array.isArray(prefs?.saved_addresses) ? prefs.saved_addresses : [])
                .find((a: any) => a?.id === cardId) || null;
              if (card) {
                return [card.address, card.kelurahan, card.kecamatan, card.kota].filter(Boolean).join(', ') || 'Titik koordinat belum diisi';
              }
              const cust = task.customer;
              return cust?.kelurahan
                ? `${cust.kelurahan}, ${cust.kecamatan}, ${cust.kota}`
                : 'Alamat belum tercatat lengkap';
            })()}
          </p>
        </div>

        {/* Bagian 1: Foto Depan Rumah */}
        <div className="space-y-2">
          <span className="block text-xs font-bold text-ink">
            1. Foto Tampak Depan Rumah:
          </span>

          <input
            type="file"
            ref={adminHouseFileInputRef}
            accept="image/*"
            onChange={onPickPhoto}
            className="hidden"
          />

          {housePhotoB64 && !removePhoto ? (
            <div className="relative rounded-2xl overflow-hidden border border-divider bg-black/5 flex items-center justify-center max-h-48">
              <img
                src={housePhotoB64}
                alt="Tampak Depan Rumah"
                className="object-contain max-h-48 w-auto rounded-xl"
              />
              <div className="absolute top-2 right-2 flex gap-1">
                <button
                  type="button"
                  onClick={() => adminHouseFileInputRef.current?.click()}
                  className="p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition shadow-xs cursor-pointer"
                  title="Ganti foto"
                >
                  <Camera size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onRemovePhotoChange(true);
                    onPhotoChange(null);
                  }}
                  className="p-1.5 rounded-full bg-danger text-on-solid hover:bg-danger-hover transition shadow-xs cursor-pointer"
                  title="Hapus foto"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => adminHouseFileInputRef.current?.click()}
              className="w-full py-4 border-2 border-dashed border-divider hover:border-accent rounded-2xl flex flex-col items-center justify-center text-xs text-ink-3 hover:text-accent transition bg-surface-2 cursor-pointer"
            >
              <Upload size={20} className="mb-1 text-accent" />
              <span className="font-semibold text-ink">Unggah Foto Depan Rumah</span>
              <span className="text-[10px] text-ink-3">Pilih gambar dari komputer / galeri (maks 12 MB)</span>
            </button>
          )}
        </div>

        {/* Bagian 2: Catatan Patokan */}
        <div className="space-y-1.5">
          <label htmlFor="edit-loc-landmark" className="block text-xs font-bold text-ink">
            2. Catatan Patokan / Ancer-ancer Rumah:
          </label>
          <textarea
            id="edit-loc-landmark"
            rows={2}
            value={landmark}
            onChange={(e) => onLandmarkChange(e.target.value)}
            placeholder="Contoh: Pagar hitam gerbang kayu, seberang masjid, samping toko berkah"
            className="w-full px-3.5 py-2.5 bg-surface border border-divider rounded-xl text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent transition shadow-xs resize-none"
          />
        </div>

        {/* Bagian 3: Smart Koordinat GPS Rumah Pasien */}
        <div className="space-y-3 bg-surface-2 -mx-4 p-4 rounded-2xl border border-divider">
          <div className="flex items-center justify-between">
            <span className="block text-xs font-bold text-ink flex items-center space-x-1.5">
              <Crosshair size={13} className="text-accent" />
              <span>3. Titik Lokasi GPS Rumah Pasien:</span>
            </span>
            {lat && lng && (
              <a
                href={getGoogleMapsDirectionUrl(parseFloat(lat), parseFloat(lng), landmark || null)}
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
            <label htmlFor="edit-loc-maps-url" className="block text-[10px] font-semibold text-ink-2 flex items-center gap-1">
              <Link2 size={11} className="text-accent" />
              <span>Tempel Link Shareloc / Google Maps Pasien:</span>
            </label>
            <div className="flex space-x-1.5">
              <input
                id="edit-loc-maps-url"
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
                className="px-3 py-2 bg-surface hover:bg-accent-soft border border-divider text-accent rounded-xl text-xs font-bold transition flex items-center gap-1 shadow-2xs disabled:opacity-50 cursor-pointer"
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
              aria-label="Gunakan lokasi saat ini"
              type="button"
              onClick={onGetGps}
              disabled={gettingGps}
              className="py-2.5 px-3 rounded-xl bg-success-soft hover:bg-success-line text-accent border border-success-line text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer shadow-2xs active:scale-[0.98]"
            >
              <Crosshair size={13} className={gettingGps ? 'animate-spin' : ''} />
              <span>{gettingGps ? 'Mengunci...' : ' Kunci GPS Saya'}</span>
            </button>

            <button
              aria-label="Cari"
              type="button"
              onClick={onGeocodeAddress}
              disabled={geocoding}
              className="py-2.5 px-3 rounded-xl bg-info-soft hover:bg-info-line text-info border border-info-line text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer shadow-2xs active:scale-[0.98]"
            >
              <Search size={13} className={geocoding ? 'animate-spin' : ''} />
              <span>{geocoding ? 'Mencari...' : ' Cari dari Alamat'}</span>
            </button>
          </div>

          {/* Coordinate Status Badge */}
          {lat && lng ? (
            <div className="p-2.5 bg-bubble-out/70 border border-accent/40 rounded-xl flex items-center justify-between text-xs text-accent">
              <div className="flex items-center space-x-1.5 font-mono font-bold">
                <CheckCircle2 size={14} className="text-accent shrink-0" />
                <span>Titik: {parseFloat(lat).toFixed(6)}, {parseFloat(lng).toFixed(6)}</span>
                {gpsAccuracy && <span className="text-[10px] text-ink-2">(±{gpsAccuracy}m)</span>}
              </div>
              <button
                type="button"
                onClick={() => {
                  onLatChange('');
                  onLngChange('');
                }}
                className="text-[10px] text-danger hover:underline font-semibold"
              >
                Hapus
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-ink-3 italic">
              Belum ada titik koordinat. Gunakan tombol di atas atau tempel link Maps.
            </p>
          )}

          {/* Collapsible Manual Coordinates */}
          <div>
            <button
              type="button"
              onClick={() => onToggleManual()}
              className="text-[11px] text-ink-2 hover:text-ink font-semibold flex items-center gap-1 transition"
            >
              <span>{showManualCoords ? 'Sembunyikan Input Manual' : 'Input Koordinat Manual (Angka)'}</span>
              {showManualCoords ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            {showManualCoords && (
              <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-divider">
                <div className="space-y-1">
                  <label htmlFor="edit-loc-lat" className="block text-[10px] text-ink-3">Latitude</label>
                  <input
                    id="edit-loc-lat"
                    type="text"
                    value={lat}
                    onChange={(e) => onLatChange(e.target.value)}
                    placeholder="-7.3488"
                    className="w-full px-3 py-2 bg-surface border border-divider rounded-xl text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent transition"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="edit-loc-lng" className="block text-[10px] text-ink-3">Longitude</label>
                  <input
                    id="edit-loc-lng"
                    type="text"
                    value={lng}
                    onChange={(e) => onLngChange(e.target.value)}
                    placeholder="112.7516"
                    className="w-full px-3 py-2 bg-surface border border-divider rounded-xl text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent transition"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex justify-end space-x-2 pt-3 border-t border-divider">
          <button
            type="button"
            onClick={() => onClose()}
            disabled={saving}
            className="px-4 py-2.5 rounded-xl border border-divider text-xs font-semibold text-ink-2 hover:bg-fill-1 transition cursor-pointer"
          >
            Batal
          </button>
          <button
            aria-label="Tandai"
            type="button"
            onClick={onSave}
            disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-ink text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
          >
            {saving ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                <span>Menyimpan...</span>
              </>
            ) : (
              <>
                <Check size={14} />
                <span>Simpan Panduan Rumah</span>
              </>
            )}
          </button>
        </div>
  </Modal>
  );
};
