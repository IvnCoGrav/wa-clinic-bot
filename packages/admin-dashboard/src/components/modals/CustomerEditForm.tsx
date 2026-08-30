import React, { useState, useEffect } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { 
  X, 
  Save, 
  Loader, 
  MapPin, 
  User, 
  Mail, 
  Phone, 
  Home, 
  Crosshair, 
  Navigation, 
  Search, 
  Link2, 
  ExternalLink, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp, 
  Sparkles 
} from 'lucide-react';
import { extractLatLngFromMapsUrl, getCurrentDeviceLocation, geocodeAddressWithNominatim, getGoogleMapsDirectionUrl } from '../../utils/geoUtils';

interface CustomerEditFormProps {
  customer: {
    id: string;
    name: string | null;
    phone: string;
    kelurahan: string | null;
    kecamatan: string | null;
    kota: string | null;
    zipcode: string | null;
    landmark: string | null;
    lat: number | null;
    lng: number | null;
    preferences?: any;
  };
  onSave: (data: any) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

export const CustomerEditForm: React.FC<CustomerEditFormProps> = ({
  customer,
  onSave,
  onCancel,
  loading = false,
}) => {
  const { toast, confirm } = useUiFeedback();
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: customer.name || '',
    kelurahan: customer.kelurahan || '',
    kecamatan: customer.kecamatan || '',
    kota: customer.kota || '',
    zipcode: customer.zipcode || '',
    landmark: customer.landmark || '',
    lat: customer.lat !== null ? String(customer.lat) : '',
    lng: customer.lng !== null ? String(customer.lng) : '',
  });

  // Smart Coordinate Assistant states
  const [mapsUrlInput, setMapsUrlInput] = useState('');
  const [gettingGps, setGettingGps] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [showManualCoords, setShowManualCoords] = useState(false);

  useEffect(() => {
    setFormData({
      name: customer.name || '',
      kelurahan: customer.kelurahan || '',
      kecamatan: customer.kecamatan || '',
      kota: customer.kota || '',
      zipcode: customer.zipcode || '',
      landmark: customer.landmark || '',
      lat: customer.lat !== null ? String(customer.lat) : '',
      lng: customer.lng !== null ? String(customer.lng) : '',
    });
  }, [customer]);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Smart Maps URL Parser
  const handlePasteMapsUrl = (val: string) => {
    setMapsUrlInput(val);
    if (!val || val.trim().length < 5) return;

    const parsed = extractLatLngFromMapsUrl(val);
    if (parsed) {
      setFormData((prev) => ({
        ...prev,
        lat: parsed.lat.toFixed(6),
        lng: parsed.lng.toFixed(6),
      }));
      setGpsAccuracy(null);
      toast('✓ Koordinat berhasil diekstrak dari link Google Maps! 📍', 'success');
    }
  };

  // Kunci GPS Perangkat Sekarang
  const handleLockGps = async () => {
    setGettingGps(true);
    try {
      const loc = await getCurrentDeviceLocation(10000);
      setFormData((prev) => ({
        ...prev,
        lat: loc.lat.toFixed(6),
        lng: loc.lng.toFixed(6),
      }));
      setGpsAccuracy(loc.accuracy);
      toast(`✓ Titik GPS berhasil dikunci (Akurasi: ±${loc.accuracy}m)! 📍`, 'success');
    } catch (err: any) {
      toast(err.message || 'Gagal mengunci GPS.', 'error');
    } finally {
      setGettingGps(false);
    }
  };

  // Cari Koordinat dari Alamat via Geocoding
  const handleGeocodeFromAddress = async () => {
    const addressQuery = [formData.kelurahan, formData.kecamatan, formData.kota].filter(Boolean).join(', ');
    if (!addressQuery || addressQuery.trim().length < 3) {
      toast('Isi nama Kelurahan atau Kecamatan terlebih dahulu untuk mencari titik.', 'info');
      return;
    }

    setGeocoding(true);
    try {
      const res = await geocodeAddressWithNominatim(addressQuery);
      if (res) {
        setFormData((prev) => ({
          ...prev,
          lat: res.lat.toFixed(6),
          lng: res.lng.toFixed(6),
        }));
        setGpsAccuracy(null);
        toast(`✓ Titik koordinat ditemukan untuk ${formData.kelurahan || formData.kecamatan}! 📍`, 'success');
      } else {
        toast('Titik tidak ditemukan untuk alamat ini. Coba tempel link Google Maps.', 'info');
      }
    } catch {
      toast('Gagal mencari titik alamat.', 'error');
    } finally {
      setGeocoding(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const confirmed = await confirm({
      title: 'Simpan Perubahan?',
      message: 'Yakin ingin menyimpan perubahan profil customer ini?',
      confirmText: 'Ya, Simpan',
      cancelText: 'Batal',
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      const payload = {
        name: formData.name.trim() || null,
        kelurahan: formData.kelurahan.trim() || null,
        kecamatan: formData.kecamatan.trim() || null,
        kota: formData.kota.trim() || null,
        zipcode: formData.zipcode.trim() || null,
        landmark: formData.landmark.trim() || null,
        lat: formData.lat ? parseFloat(formData.lat) : null,
        lng: formData.lng ? parseFloat(formData.lng) : null,
      };

      await onSave(payload);
      toast('Profil customer berhasil diperbarui!', 'success');
    } catch (err: any) {
      toast(`Gagal menyimpan: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (Object.values(formData).some((v) => v !== '')) {
      confirm({
        title: 'Batalkan Edit?',
        message: 'Perubahan yang belum disimpan akan hilang. Lanjutkan?',
        confirmText: 'Ya, Batalkan',
        cancelText: 'Kembali',
        danger: true,
      }).then((confirmed) => {
        if (confirmed) onCancel();
      });
    } else {
      onCancel();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fadeIn" onClick={handleCancel}>
      <div
        className="bg-white rounded-2xl sm:rounded-3xl border border-[#e9edef] overflow-hidden w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-[#e9edef] bg-[#f8fafc] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <User size={18} className="text-[#008069]" />
            <h3 className="font-bold text-[#111b21] text-sm">Edit Profil Customer</h3>
          </div>
          <button
            onClick={handleCancel}
            disabled={saving || loading}
            className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#e9edef] transition disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto flex-1">
        {/* Nama */}
        <div className="space-y-1">
          <label className="block text-[11px] font-bold text-[#111b21] flex items-center space-x-1">
            <User size={12} className="text-[#8696a0]" />
            <span>Nama Lengkap</span>
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => handleChange('name', e.target.value)}
            placeholder="Contoh: Bunda Sari Waru"
            className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs transition"
            disabled={saving || loading}
          />
        </div>

        {/* Alamat - Kelurahan */}
        <div className="space-y-1">
          <label className="block text-[11px] font-bold text-[#111b21] flex items-center space-x-1">
            <MapPin size={12} className="text-[#8696a0]" />
            <span>Kelurahan</span>
          </label>
          <input
            type="text"
            value={formData.kelurahan}
            onChange={(e) => handleChange('kelurahan', e.target.value)}
            placeholder="Contoh: Waru"
            className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs transition"
            disabled={saving || loading}
          />
        </div>

        {/* Alamat - Kecamatan */}
        <div className="space-y-1">
          <label className="block text-[11px] font-bold text-[#111b21] flex items-center space-x-1">
            <MapPin size={12} className="text-[#8696a0]" />
            <span>Kecamatan</span>
          </label>
          <input
            type="text"
            value={formData.kecamatan}
            onChange={(e) => handleChange('kecamatan', e.target.value)}
            placeholder="Contoh: Waru"
            className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs transition"
            disabled={saving || loading}
          />
        </div>

        {/* Alamat - Kota */}
        <div className="space-y-1">
          <label className="block text-[11px] font-bold text-[#111b21] flex items-center space-x-1">
            <Home size={12} className="text-[#8696a0]" />
            <span>Kota / Kabupaten</span>
          </label>
          <input
            type="text"
            value={formData.kota}
            onChange={(e) => handleChange('kota', e.target.value)}
            placeholder="Contoh: Sidoarjo"
            className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs transition"
            disabled={saving || loading}
          />
        </div>

        {/* Kode Pos */}
        <div className="space-y-1">
          <label className="block text-[11px] font-bold text-[#111b21] flex items-center space-x-1">
            <Mail size={12} className="text-[#8696a0]" />
            <span>Kode Pos</span>
          </label>
          <input
            type="text"
            value={formData.zipcode}
            onChange={(e) => handleChange('zipcode', e.target.value)}
            placeholder="Contoh: 61256"
            className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs transition"
            disabled={saving || loading}
          />
        </div>

        {/* Patokan / Landmark */}
        <div className="space-y-1">
          <label className="block text-[11px] font-bold text-[#111b21] flex items-center space-x-1">
            <MapPin size={12} className="text-[#8696a0]" />
            <span>Patokan / Catatan Alamat</span>
          </label>
          <textarea
            value={formData.landmark}
            onChange={(e) => handleChange('landmark', e.target.value)}
            placeholder="Contoh: Pagar hitam gerbang kayu, seberang masjid, samping toko berkah"
            rows={2}
            className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs transition resize-none"
            disabled={saving || loading}
          />
        </div>

        {/* Smart Koordinat GPS Section (Anti-Hapal Koordinat) */}
        <div className="pt-3 border-t border-[#e9edef] space-y-3 bg-[#f8fafc] -mx-4 p-4 rounded-2xl">
          <div className="flex items-center justify-between">
            <label className="block text-[11px] font-bold text-[#111b21] flex items-center space-x-1.5">
              <Sparkles size={13} className="text-[#008069]" />
              <span>Titik Lokasi GPS Rumah Pasien</span>
            </label>
            {formData.lat && formData.lng && (
              <a
                href={getGoogleMapsDirectionUrl(parseFloat(formData.lat), parseFloat(formData.lng))}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-bold text-[#008069] hover:underline inline-flex items-center gap-1"
              >
                <span>Lihat di Maps</span>
                <ExternalLink size={11} />
              </a>
            )}
          </div>

          {/* Assistant 1: Tempel Link Google Maps */}
          <div className="space-y-1">
            <label className="block text-[10px] font-semibold text-[#54656f] flex items-center gap-1">
              <Link2 size={11} className="text-[#008069]" />
              <span>Tempel Link Shareloc / Google Maps Pasien:</span>
            </label>
            <input
              type="text"
              value={mapsUrlInput}
              onChange={(e) => handlePasteMapsUrl(e.target.value)}
              placeholder="Paste link Google Maps / shareloc di sini..."
              className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-2xs"
            />
          </div>

          {/* Assistant 2: Tombol Cepat GPS & Geocode */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleLockGps}
              disabled={gettingGps}
              className="py-2.5 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-[#008069] border border-emerald-300 text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer shadow-2xs active:scale-[0.98]"
            >
              <Crosshair size={13} className={gettingGps ? 'animate-spin' : ''} />
              <span>{gettingGps ? 'Mengunci GPS...' : '📍 Kunci GPS Saya'}</span>
            </button>

            <button
              type="button"
              onClick={handleGeocodeFromAddress}
              disabled={geocoding}
              className="py-2.5 px-3 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-300 text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer shadow-2xs active:scale-[0.98]"
            >
              <Search size={13} className={geocoding ? 'animate-spin' : ''} />
              <span>{geocoding ? 'Mencari...' : '🔍 Cari dari Alamat'}</span>
            </button>
          </div>

          {/* Coordinate Status Badge */}
          {formData.lat && formData.lng ? (
            <div className="p-2.5 bg-[#d9fdd3]/70 border border-[#00a884]/40 rounded-xl flex items-center justify-between text-xs text-[#008069]">
              <div className="flex items-center space-x-1.5 font-mono font-bold">
                <CheckCircle2 size={14} className="text-[#008069] shrink-0" />
                <span>Titik: {parseFloat(formData.lat).toFixed(6)}, {parseFloat(formData.lng).toFixed(6)}</span>
                {gpsAccuracy && <span className="text-[10px] text-[#54656f]">(±{gpsAccuracy}m)</span>}
              </div>
              <button
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, lat: '', lng: '' }))}
                className="text-[10px] text-rose-600 hover:underline font-semibold"
              >
                Hapus
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-[#8696a0] italic">
              Belum ada titik koordinat. Gunakan tombol di atas atau tempel link Maps.
            </p>
          )}

          {/* Collapsible Manual Input (Jika Dibutuhkan) */}
          <div>
            <button
              type="button"
              onClick={() => setShowManualCoords(!showManualCoords)}
              className="text-[11px] text-[#54656f] hover:text-[#111b21] font-semibold flex items-center gap-1 transition"
            >
              <span>{showManualCoords ? 'Sembunyikan Input Manual' : 'Input Koordinat Manual (Angka)'}</span>
              {showManualCoords ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            {showManualCoords && (
              <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-[#e9edef]">
                <div className="space-y-1">
                  <label className="block text-[10px] text-[#667781]">Latitude</label>
                  <input
                    type="text"
                    value={formData.lat}
                    onChange={(e) => handleChange('lat', e.target.value)}
                    placeholder="-7.3488"
                    className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs transition"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-[10px] text-[#667781]">Longitude</label>
                  <input
                    type="text"
                    value={formData.lng}
                    onChange={(e) => handleChange('lng', e.target.value)}
                    placeholder="112.7516"
                    className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs transition"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Phone (read-only) */}
        <div className="pt-2 border-t border-[#e9edef] bg-[#f8fafc] p-3 rounded-xl">
          <label className="block text-[10px] text-[#667781] font-semibold mb-1 flex items-center space-x-1">
            <Phone size={11} className="text-[#8696a0]" />
            <span>No. WhatsApp (Tidak bisa diubah)</span>
          </label>
          <p className="font-mono text-xs text-[#111b21]">{customer.phone}</p>
        </div>

          {/* Actions */}
          <div className="flex space-x-2 pt-2 border-t border-[#e9edef] bg-[#f8fafc] -mx-4 -mb-4 p-4 mt-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving || loading}
              className="flex-1 py-2.5 px-4 rounded-xl border border-[#d1d7db] text-[#54656f] font-semibold text-xs hover:bg-[#f0f2f5] transition disabled:opacity-50 bg-white"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving || loading}
              className="flex-1 py-2.5 px-4 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white font-semibold text-xs flex items-center justify-center space-x-1.5 transition shadow-xs disabled:opacity-50"
            >
              {saving || loading ? (
                <>
                  <Loader size={14} className="animate-spin" />
                  <span>Menyimpan...</span>
                </>
              ) : (
                <>
                  <Save size={14} />
                  <span>Simpan Perubahan</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};