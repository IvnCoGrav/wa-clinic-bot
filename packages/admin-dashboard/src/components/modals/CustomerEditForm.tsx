import React, { useState, useEffect } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { X, Save, Loader, MapPin, User, Mail, Phone, Home } from 'lucide-react';

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
    <div className="bg-white rounded-2xl border border-[#e9edef] overflow-hidden max-w-md w-full mx-auto">
      {/* Header */}
      <div className="p-4 border-b border-[#e9edef] bg-[#f8fafc] flex items-center justify-between">
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
      <form onSubmit={handleSubmit} className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
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

        {/* Koordinat GPS */}
        <div className="pt-2 border-t border-[#e9edef] space-y-3">
          <label className="block text-[11px] font-bold text-[#111b21] flex items-center space-x-1">
            <MapPin size={12} className="text-[#8696a0]" />
            <span>Koordinat GPS (Opsional)</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="block text-[10px] text-[#667781]">Latitude</label>
              <input
                type="text"
                value={formData.lat}
                onChange={(e) => handleChange('lat', e.target.value)}
                placeholder="-7.3488"
                className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs transition"
                disabled={saving || loading}
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[10px] text-[#667781]">Longitude</label>
              <input
                type="text"
                value={formData.lng}
                onChange={(e) => handleChange('lng', e.target.value)}
                placeholder="112.7516"
                className="w-full px-3 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs transition"
                disabled={saving || loading}
              />
            </div>
          </div>
          <p className="text-[10px] text-[#8696a0] italic">
            Isi jika ingin override titik koordinat manual. Kosongkan untuk pakai data existing.
          </p>
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
        <div className="flex space-x-2 pt-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={saving || loading}
            className="flex-1 py-2.5 px-4 rounded-xl border border-[#d1d7db] text-[#54656f] font-semibold text-xs hover:bg-[#f0f2f5] transition disabled:opacity-50"
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
                <span>Simpan</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};