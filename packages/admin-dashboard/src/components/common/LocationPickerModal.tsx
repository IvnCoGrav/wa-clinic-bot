import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, MapPin, Navigation, Search, Camera, Image as ImageIcon, Loader } from 'lucide-react';
import { extractLatLngFromMapsUrl, getCurrentDeviceLocation, geocodeAddressWithNominatim } from '../../utils/geoUtils';
import { compressImageFile } from '../../utils/imageCompressor';
import { stampGpsWatermark } from '../../utils/imageWatermark';
import { useUiFeedback } from '../common/UiFeedback';

/**
 * LocationPickerModal — modal lokasi terpusat (Anti-Spaghetti).
 *
 * Mengonsolidasi pengambilan GPS device, parsing Google Maps URL, geocoding
 * Nominatim, kompresi foto rumah via Canvas, dan watermark GPS terstandar
 * yang sebelumnya diduplikasi di TodayTreatments, StaffToday, CustomerEditForm.
 *
 * Props minimal yang stabil; integrasi penuh per-konsumen dapat bertahap
 * (migrasi bertahap tidak memblokir build).
 */
export interface LocationPickerValue {
  lat: number | null;
  lng: number | null;
  accuracy?: number | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
  landmark?: string | null;
  housePhotoUrl?: string | null;
  mapsUrl?: string | null;
}

export interface LocationPickerModalProps {
  isOpen: boolean;
  value: LocationPickerValue;
  onChange: (next: LocationPickerValue) => void;
  onClose: () => void;
  onSave?: (value: LocationPickerValue) => Promise<void> | void;
  customerName?: string;
  takerName?: string;
  zIndex?: number;
}

export const LocationPickerModal: React.FC<LocationPickerModalProps> = ({
  isOpen,
  value,
  onChange,
  onClose,
  onSave,
  customerName,
  takerName,
  zIndex = 60,
}) => {
  const { toast } = useUiFeedback();
  const [mapsUrl, setMapsUrl] = useState(value.mapsUrl || '');
  const [lockingGps, setLockingGps] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [rawB64, setRawB64] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handlePasteMapsUrl = (url: string) => {
    setMapsUrl(url);
    const parsed = extractLatLngFromMapsUrl(url);
    if (parsed) {
      onChange({ ...value, lat: parsed.lat, lng: parsed.lng, mapsUrl: url });
      toast(`Koordinat terdeteksi: ${parsed.lat.toFixed(5)}, ${parsed.lng.toFixed(5)}`, 'success');
    }
  };

  const handleLockGps = async () => {
    setLockingGps(true);
    try {
      const loc = await getCurrentDeviceLocation(10000);
      onChange({ ...value, lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy });
      toast(`GPS terkunci ±${loc.accuracy}m`, 'success');
      if (rawB64) {
        const watermarked = await stampGpsWatermark(rawB64, {
          lat: loc.lat,
          lng: loc.lng,
          accuracy: loc.accuracy,
          kelurahan: value.kelurahan || null,
          kecamatan: value.kecamatan || null,
          landmark: value.landmark || null,
          customerName: customerName || undefined,
          takerName: takerName || undefined,
          staffName: takerName || undefined,
        });
        onChange({ ...value, lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy, housePhotoUrl: watermarked });
      }
    } catch (err: any) {
      toast(err.message || 'Gagal mengunci GPS', 'error');
    } finally {
      setLockingGps(false);
    }
  };

  const handleGeocode = async () => {
    const q = [value.kelurahan, value.kecamatan, value.kota].filter(Boolean).join(', ');
    if (!q || q.trim().length < 3) {
      toast('Isi kelurahan/kecamatan dulu', 'info');
      return;
    }
    setGeocoding(true);
    try {
      const res = await geocodeAddressWithNominatim(q);
      if (res) {
        onChange({ ...value, lat: res.lat, lng: res.lng });
        toast(`Titik ditemukan: ${res.displayName.slice(0, 60)}`, 'success');
      } else {
        toast('Alamat tidak ditemukan', 'info');
      }
    } catch {
      toast('Gagal geocoding', 'error');
    } finally {
      setGeocoding(false);
    }
  };

  const handlePhoto = async (file: File) => {
    setProcessingPhoto(true);
    try {
      const compressed = await compressImageFile(file, { maxWidth: 1000, maxHeight: 1000, quality: 0.75 });
      setRawB64(compressed.dataUrl);
      let finalUrl = compressed.dataUrl;
      if (value.lat && value.lng) {
        finalUrl = await stampGpsWatermark(compressed.dataUrl, {
          lat: value.lat,
          lng: value.lng,
          accuracy: value.accuracy ?? null,
          kelurahan: value.kelurahan || null,
          kecamatan: value.kecamatan || null,
          landmark: value.landmark || null,
          customerName: customerName || undefined,
          takerName: takerName || undefined,
          staffName: takerName || undefined,
        });
      }
      onChange({ ...value, housePhotoUrl: finalUrl });
      toast('Foto rumah dimuat', 'success');
    } catch {
      toast('Gagal memproses foto', 'error');
    } finally {
      setProcessingPhoto(false);
    }
  };

  const handleSave = async () => {
    if (onSave) await onSave(value);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn" style={{ zIndex }} onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl border border-[#e9edef] p-4 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#e9edef] pb-3">
          <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2"><MapPin size={16} className="text-[#008069]" /> Pilih Lokasi & Foto Rumah</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5]"><X size={16} /></button>
        </div>

        <div className="space-y-3">
          <label className="text-xs font-bold text-[#111b21]">Link Google Maps (tempel shareloc)</label>
          <div className="flex gap-2">
            <input value={mapsUrl} onChange={(e) => handlePasteMapsUrl(e.target.value)} placeholder="https://maps.google.com/..." className="flex-1 px-3 py-2 border border-[#d1d7db] rounded-xl text-xs" />
            <button onClick={handleGeocode} disabled={geocoding} className="px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs font-semibold hover:bg-[#f0f2f5] flex items-center gap-1">
              {geocoding ? <Loader size={12} className="animate-spin" /> : <Search size={12} />} Cari Alamat
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-[#667781] font-bold">Latitude</label>
              <input value={value.lat ?? ''} onChange={(e) => onChange({ ...value, lat: e.target.value ? parseFloat(e.target.value) : null })} placeholder="-7.34" className="w-full px-3 py-2 border border-[#d1d7db] rounded-xl text-xs" />
            </div>
            <div>
              <label className="text-[11px] text-[#667781] font-bold">Longitude</label>
              <input value={value.lng ?? ''} onChange={(e) => onChange({ ...value, lng: e.target.value ? parseFloat(e.target.value) : null })} placeholder="112.75" className="w-full px-3 py-2 border border-[#d1d7db] rounded-xl text-xs" />
            </div>
          </div>

          <button onClick={handleLockGps} disabled={lockingGps} className="w-full py-2.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5">
            <Navigation size={13} /> {lockingGps ? 'Mengunci GPS...' : value.accuracy ? `GPS ±${value.accuracy}m (kunci ulang)` : 'Gunakan Lokasi Saat Ini (GPS)'}
          </button>

          <div className="space-y-2">
            <label className="text-xs font-bold text-[#111b21]">Foto Rumah {processingPhoto && <span className="text-[11px] text-[#008069] animate-pulse">Memproses...</span>}</label>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhoto(f); }} />
            <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhoto(f); }} />
            {value.housePhotoUrl ? (
              <div className="relative rounded-xl overflow-hidden border border-[#e9edef] max-h-48 flex items-center justify-center bg-black/5">
                <img src={value.housePhotoUrl} alt="Rumah" className="object-contain max-h-48" />
                <button onClick={() => onChange({ ...value, housePhotoUrl: null })} className="absolute top-2 right-2 p-1.5 rounded-full bg-rose-600 text-white hover:bg-rose-700"><X size={12} /></button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => cameraRef.current?.click()} disabled={processingPhoto} className="py-3 rounded-xl bg-emerald-50 border-2 border-dashed border-emerald-300 text-emerald-700 text-xs font-bold flex flex-col items-center gap-1"><Camera size={18} /> Ambil Kamera</button>
                <button onClick={() => galleryRef.current?.click()} disabled={processingPhoto} className="py-3 rounded-xl bg-slate-50 border-2 border-dashed border-slate-300 text-slate-700 text-xs font-bold flex flex-col items-center gap-1"><ImageIcon size={18} /> Pilih Galeri</button>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-[#e9edef]">
          <button onClick={onClose} className="px-4 py-2 border border-[#d1d7db] rounded-xl text-xs font-semibold">Batal</button>
          <button onClick={handleSave} className="px-5 py-2 bg-[#008069] text-white rounded-xl text-xs font-bold hover:bg-[#00a884]">Simpan Lokasi</button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default LocationPickerModal;
