import React, { useState, useEffect } from 'react';
import { useUiFeedback } from '../common/UiFeedback';
import { 
  X, 
  Save, 
  Loader, 
  User, 
  Phone, 
  Home, 
  Crosshair, 
  Search, 
  Link2, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp, 
  Baby,
  Plus,
  Trash2
} from 'lucide-react';
import { extractLatLngFromMapsUrl, getCurrentDeviceLocation, geocodeAddressWithNominatim } from '../../utils/geoUtils';

export interface EditableChildItem {
  id?: string;
  name: string;
  ageText: string;
  birthDate?: string | null;
}

interface CustomerEditFormProps {
  customer: {
    id: string;
    name: string | null;
    phone: string;
    address?: string | null;
    kelurahan: string | null;
    kecamatan: string | null;
    kota: string | null;
    zipcode: string | null;
    landmark: string | null;
    lat: number | null;
    lng: number | null;
    children?: Array<{
      id?: string;
      name: string;
      raw_age_text?: string | null;
      ageText?: string | null;
      birth_date?: string | null;
      birthDate?: string | null;
    }>;
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
    phone: customer.phone || '',
    address: customer.address || customer.preferences?.address || customer.preferences?.full_address || '',
    kelurahan: customer.kelurahan || '',
    kecamatan: customer.kecamatan || '',
    kota: customer.kota || '',
    zipcode: customer.zipcode || '',
    landmark: customer.landmark || customer.preferences?.landmark || customer.preferences?.address_notes || '',
    lat: customer.lat !== null && customer.lat !== undefined ? String(customer.lat) : '',
    lng: customer.lng !== null && customer.lng !== undefined ? String(customer.lng) : '',
  });

  const [children, setChildren] = useState<EditableChildItem[]>(() => {
    const rawList = customer.children || customer.preferences?.children || [];
    if (Array.isArray(rawList) && rawList.length > 0) {
      return rawList.map((c: any) => ({
        id: c.id,
        name: c.name || '',
        ageText: c.raw_age_text || c.ageText || '',
        birthDate: c.birth_date ? new Date(c.birth_date).toISOString().split('T')[0] : (c.birthDate || ''),
      }));
    }
    return [];
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
      phone: customer.phone || '',
      address: customer.address || customer.preferences?.address || customer.preferences?.full_address || '',
      kelurahan: customer.kelurahan || '',
      kecamatan: customer.kecamatan || '',
      kota: customer.kota || '',
      zipcode: customer.zipcode || '',
      landmark: customer.landmark || customer.preferences?.landmark || customer.preferences?.address_notes || '',
      lat: customer.lat !== null && customer.lat !== undefined ? String(customer.lat) : '',
      lng: customer.lng !== null && customer.lng !== undefined ? String(customer.lng) : '',
    });

    const rawList = customer.children || customer.preferences?.children || [];
    if (Array.isArray(rawList) && rawList.length > 0) {
      setChildren(
        rawList.map((c: any) => ({
          id: c.id,
          name: c.name || '',
          ageText: c.raw_age_text || c.ageText || '',
          birthDate: c.birth_date ? new Date(c.birth_date).toISOString().split('T')[0] : (c.birthDate || ''),
        }))
      );
    } else {
      setChildren([]);
    }
  }, [customer]);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddChild = () => {
    setChildren((prev) => [
      ...prev,
      {
        name: '',
        ageText: '',
        birthDate: '',
      },
    ]);
  };

  const handleChildChange = (index: number, field: keyof EditableChildItem, value: string) => {
    setChildren((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleRemoveChild = (index: number) => {
    setChildren((prev) => prev.filter((_, i) => i !== index));
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
    const addressQuery = [formData.address, formData.kelurahan, formData.kecamatan, formData.kota]
      .filter(Boolean)
      .join(', ');
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
      message: 'Yakin ingin menyimpan perubahan profil customer dan data anak ini?',
      confirmText: 'Ya, Simpan',
      cancelText: 'Batal',
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      const payload = {
        name: formData.name.trim() || null,
        phone: formData.phone.trim() || customer.phone,
        address: formData.address.trim() || null,
        kelurahan: formData.kelurahan.trim() || null,
        kecamatan: formData.kecamatan.trim() || null,
        kota: formData.kota.trim() || null,
        zipcode: formData.zipcode.trim() || null,
        landmark: formData.landmark.trim() || null,
        lat: formData.lat ? parseFloat(formData.lat) : null,
        lng: formData.lng ? parseFloat(formData.lng) : null,
        children: children
          .filter((c) => c.name && c.name.trim().length > 0)
          .map((c) => ({
            id: c.id,
            name: c.name.trim(),
            raw_age_text: c.ageText?.trim() || null,
            ageText: c.ageText?.trim() || null,
            birthDate: c.birthDate || null,
          })),
      };

      await onSave(payload);
    } catch (err: any) {
      toast(`Gagal menyimpan: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    onCancel();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fadeIn" onClick={handleCancel}>
      <div
        className="bg-white rounded-2xl sm:rounded-3xl border border-[#e9edef] overflow-hidden w-full max-w-xl max-h-[92vh] flex flex-col shadow-2xl animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-[#e9edef] bg-[#f8fafc] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-xl bg-[#e8f5f2] border border-[#c2e7e0] flex items-center justify-center text-[#008069]">
              <User size={18} />
            </div>
            <div>
              <h3 className="font-bold text-[#111b21] text-sm">Edit Data Customer & Anak</h3>
              <p className="text-[11px] text-[#667781]">Perbarui profil bunda, kontak, alamat, dan data anak/pasien</p>
            </div>
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
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-5 overflow-y-auto flex-1 text-xs">
          {/* Section 1: Profil Bunda & Kontak */}
          <div className="p-3.5 bg-[#f8fafc] border border-[#e9edef] rounded-2xl space-y-3">
            <h4 className="font-bold text-[#111b21] text-xs flex items-center space-x-1.5 uppercase tracking-wider">
              <User size={13} className="text-[#008069]" />
              <span>Data Bunda & Kontak</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-[#111b21]">Nama Lengkap Bunda</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="Contoh: Bunda Sari Waru"
                  className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-2xs transition"
                  disabled={saving || loading}
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-[#111b21] flex items-center space-x-1">
                  <Phone size={11} className="text-[#008069]" />
                  <span>No. WhatsApp</span>
                </label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  placeholder="Contoh: 08123456789 atau 628123456789"
                  className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] font-mono placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-2xs transition"
                  disabled={saving || loading}
                />
              </div>
            </div>
          </div>

          {/* Section 2: Data Bayi / Anak (Dynamic List) */}
          <div className="p-3.5 bg-[#f0fdf4] border border-[#bbf7d0] rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-[#166534] text-xs flex items-center space-x-1.5 uppercase tracking-wider">
                <Baby size={14} className="text-[#16a34a]" />
                <span>Data Pasien (Bayi / Anak)</span>
              </h4>
              <button
                type="button"
                onClick={handleAddChild}
                className="px-2.5 py-1 bg-white hover:bg-[#dcfce7] border border-[#86efac] text-[#166534] rounded-lg text-[11px] font-bold transition flex items-center space-x-1 shadow-2xs cursor-pointer"
              >
                <Plus size={12} />
                <span>Tambah Anak</span>
              </button>
            </div>

            {children.length === 0 ? (
              <div className="p-4 bg-white/80 border border-dashed border-[#86efac] rounded-xl text-center">
                <p className="text-[11px] text-[#4b5563]">Belum ada data anak terdaftar.</p>
                <button
                  type="button"
                  onClick={handleAddChild}
                  className="mt-1.5 text-[11px] text-[#16a34a] font-bold hover:underline inline-flex items-center space-x-1 cursor-pointer"
                >
                  <Plus size={12} />
                  <span>+ Tambah Data Anak Sekarang</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {children.map((child, idx) => (
                  <div key={child.id || `child-row-${idx}`} className="p-3 bg-white border border-[#bbf7d0] rounded-xl space-y-2 relative shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-[#15803d] uppercase tracking-wider">
                        Anak #{idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveChild(idx)}
                        className="p-1 text-rose-500 hover:bg-rose-50 rounded-md transition cursor-pointer"
                        title="Hapus data anak ini"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="block text-[10px] font-semibold text-[#374151]">Nama Bayi / Anak</label>
                        <input
                          type="text"
                          value={child.name}
                          onChange={(e) => handleChildChange(idx, 'name', e.target.value)}
                          placeholder="Contoh: Adek Kenzo"
                          className="w-full px-2.5 py-1.5 bg-[#fcfdfd] border border-[#d1d7db] rounded-lg text-xs text-[#111b21] focus:outline-none focus:border-[#16a34a]"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[10px] font-semibold text-[#374151]">Usia / Umur</label>
                        <input
                          type="text"
                          value={child.ageText}
                          onChange={(e) => handleChildChange(idx, 'ageText', e.target.value)}
                          placeholder="Contoh: 6 bulan / 2 tahun"
                          className="w-full px-2.5 py-1.5 bg-[#fcfdfd] border border-[#d1d7db] rounded-lg text-xs text-[#111b21] focus:outline-none focus:border-[#16a34a]"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 3: Alamat Lengkap & Area */}
          <div className="p-3.5 bg-[#f8fafc] border border-[#e9edef] rounded-2xl space-y-3">
            <h4 className="font-bold text-[#111b21] text-xs flex items-center space-x-1.5 uppercase tracking-wider">
              <Home size={13} className="text-[#008069]" />
              <span>Alamat Lengkap & Wilayah</span>
            </h4>

            {/* Alamat Lengkap */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#111b21]">Alamat Lengkap (Jalan, RT/RW, No. Rumah)</label>
              <textarea
                rows={2}
                value={formData.address}
                onChange={(e) => handleChange('address', e.target.value)}
                placeholder="Contoh: Jl. Gayungsari Timur No. 12 RT 03 RW 01"
                className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-2xs transition"
                disabled={saving || loading}
              />
            </div>

            {/* Kelurahan & Kecamatan */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-[#111b21]">Kelurahan / Desa</label>
                <input
                  type="text"
                  value={formData.kelurahan}
                  onChange={(e) => handleChange('kelurahan', e.target.value)}
                  placeholder="Contoh: Waru"
                  className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-2xs transition"
                  disabled={saving || loading}
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-[#111b21]">Kecamatan</label>
                <input
                  type="text"
                  value={formData.kecamatan}
                  onChange={(e) => handleChange('kecamatan', e.target.value)}
                  placeholder="Contoh: Waru"
                  className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-2xs transition"
                  disabled={saving || loading}
                />
              </div>
            </div>

            {/* Kota & Patokan */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-[#111b21]">Kota / Kabupaten</label>
                <input
                  type="text"
                  value={formData.kota}
                  onChange={(e) => handleChange('kota', e.target.value)}
                  placeholder="Contoh: Sidoarjo atau Surabaya"
                  className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-2xs transition"
                  disabled={saving || loading}
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-[#111b21]">Patokan Rumah (Ciri Bangunan / Pagar)</label>
                <input
                  type="text"
                  value={formData.landmark}
                  onChange={(e) => handleChange('landmark', e.target.value)}
                  placeholder="Contoh: Pagar hitam samping masjid"
                  className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-2xs transition"
                  disabled={saving || loading}
                />
              </div>
            </div>
          </div>

          {/* Section 4: Asisten Titik Koordinat GPS & Google Maps */}
          <div className="p-3.5 bg-[#f8fafc] border border-[#e9edef] rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-[#111b21] text-xs flex items-center space-x-1.5 uppercase tracking-wider">
                <Crosshair size={13} className="text-[#008069]" />
                <span>Titik Koordinat GPS (Untuk Rute & Ongkir)</span>
              </h4>
              <span className="text-[10px] text-[#667781] font-mono">
                {formData.lat && formData.lng ? 'TERHUBUNG' : 'BELUM ADA'}
              </span>
            </div>

            {/* Smart Paste Maps URL */}
            <div className="space-y-1">
              <label className="block text-[10px] font-semibold text-[#54656f] flex items-center gap-1">
                <Link2 size={11} className="text-[#008069]" />
                <span>Tempel Link Google Maps (Shareloc WA / Maps)</span>
              </label>
              <div className="flex space-x-1.5">
                <input
                  type="text"
                  value={mapsUrlInput}
                  onChange={(e) => handlePasteMapsUrl(e.target.value)}
                  placeholder="https://maps.google.com/?q=-7.3488,112.7516"
                  className="flex-1 px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-2xs transition"
                />
              </div>
            </div>

            {/* Quick Actions: Lock GPS & Geocode */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleLockGps}
                disabled={gettingGps}
                className="py-2 px-3 bg-white hover:bg-[#e8f5f2] border border-[#c2e7e0] text-[#008069] rounded-xl text-[11px] font-bold transition flex items-center justify-center space-x-1.5 shadow-2xs disabled:opacity-50 cursor-pointer"
              >
                {gettingGps ? <Loader size={12} className="animate-spin" /> : <Crosshair size={12} />}
                <span>{gettingGps ? 'Mengunci GPS...' : 'Kunci GPS Perangkat'}</span>
              </button>

              <button
                type="button"
                onClick={handleGeocodeFromAddress}
                disabled={geocoding}
                className="py-2 px-3 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] rounded-xl text-[11px] font-bold transition flex items-center justify-center space-x-1.5 shadow-2xs disabled:opacity-50 cursor-pointer"
              >
                {geocoding ? <Loader size={12} className="animate-spin" /> : <Search size={12} />}
                <span>{geocoding ? 'Mencari...' : 'Cari Titik Alamat'}</span>
              </button>
            </div>

            {/* Current Coordinate Badge */}
            {formData.lat && formData.lng ? (
              <div className="p-2.5 bg-[#d9fdd3]/70 border border-[#00a884]/40 rounded-xl flex items-center justify-between text-xs text-[#008069]">
                <div className="flex items-center space-x-1.5 font-mono font-bold">
                  <CheckCircle2 size={14} className="text-[#008069] shrink-0" />
                  <span>Titik: {parseFloat(formData.lat).toFixed(6)}, {parseFloat(formData.lng).toFixed(6)}</span>
                  {gpsAccuracy && <span className="text-[10px] text-[#54656f] font-normal">(±{gpsAccuracy}m)</span>}
                </div>
                <button
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, lat: '', lng: '' }))}
                  className="text-[10px] text-rose-600 hover:underline font-semibold cursor-pointer"
                >
                  Hapus
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-[#8696a0] italic">
                Belum ada titik koordinat. Gunakan tombol di atas atau tempel link Maps.
              </p>
            )}

            {/* Collapsible Manual Input */}
            <div>
              <button
                type="button"
                onClick={() => setShowManualCoords(!showManualCoords)}
                className="text-[11px] text-[#54656f] hover:text-[#111b21] font-semibold flex items-center gap-1 transition cursor-pointer"
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
                      className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-2xs transition"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] text-[#667781]">Longitude</label>
                    <input
                      type="text"
                      value={formData.lng}
                      onChange={(e) => handleChange('lng', e.target.value)}
                      placeholder="112.7516"
                      className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-2xs transition"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex space-x-2 pt-2 border-t border-[#e9edef] bg-[#f8fafc] -mx-4 sm:-mx-5 -mb-4 sm:-mb-5 p-4 mt-2 sticky bottom-0">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving || loading}
              className="flex-1 py-2.5 px-4 rounded-xl border border-[#d1d7db] text-[#54656f] font-semibold text-xs hover:bg-[#f0f2f5] transition disabled:opacity-50 bg-white shadow-2xs cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving || loading}
              className="flex-1 py-2.5 px-4 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white font-semibold text-xs flex items-center justify-center space-x-1.5 transition shadow-2xs disabled:opacity-50 cursor-pointer"
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