import React, { useRef, useState } from 'react';
import { ImageIcon, Upload, Save, Trash2 } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';

interface Props {
  initialImageUrl: string | null;
  initialThumbUrl?: string | null;
  onSaved?: () => void;
}

export const PricelistImagePanel: React.FC<Props> = ({ initialImageUrl, initialThumbUrl, onSaved }) => {
  const { toast } = useUiFeedback();
  const [urlMode, setUrlMode] = useState<boolean>(true);
  const [urlValue, setUrlValue] = useState<string>(initialImageUrl || '');
  const [selectedImage, setSelectedImage] = useState<{ file: File; preview: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>(initialThumbUrl || initialImageUrl || '');
  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setUrlValue(initialImageUrl || '');
    setPreviewUrl(initialThumbUrl || initialImageUrl || '');
  }, [initialImageUrl, initialThumbUrl]);

  const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
      reader.readAsDataURL(file);
    });

  const handlePickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Hanya file gambar yang didukung.', 'error');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast('Gambar maksimal 8 MB.', 'error');
      return;
    }
    const preview = URL.createObjectURL(file);
    setSelectedImage({ file, preview });
    setUrlMode(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, any> = {};
      if (selectedImage) {
        const imageB64 = await fileToDataUrl(selectedImage.file);
        body.imageB64 = imageB64;
        body.mimeType = selectedImage.file.type || 'image/jpeg';
        body.fileName = selectedImage.file.name;
      } else {
        body.imageUrl = urlValue.trim() || null;
        if (body.imageUrl !== null && !/^https?:\/\//i.test(body.imageUrl) && !body.imageUrl.startsWith('/media/outbound/')) {
          toast('URL harus berupa http/https atau path /media/outbound/...', 'error');
          return;
        }
      }
      const res = await apiRequest('/api/admin/settings/pricelist-image', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      if (res && res.success) {
        toast(res.message || 'Gambar pricelist berhasil disimpan.', 'success');
setSelectedImage(null);
        setUrlValue(res.data?.pricelistImageUrl || '');
        setPreviewUrl(res.data?.pricelistThumbUrl || res.data?.pricelistImageUrl || '');
        onSaved?.();
      }
    } catch (err: any) {
      toast(`Gagal menyimpan gambar pricelist: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    setSelectedImage(null);
    setUrlValue('');
    setPreviewUrl('');
  };

  const handleRemove = async () => {
    setSaving(true);
    try {
      const res = await apiRequest('/api/admin/settings/pricelist-image', {
        method: 'PUT',
        body: JSON.stringify({ imageUrl: null }),
      });
      if (res && res.success) {
        toast('Gambar pricelist di-reset ke default.', 'success');
        handleClear();
        onSaved?.();
      }
    } catch (err: any) {
      toast(`Gagal reset gambar pricelist: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const effectivePreview = selectedImage?.preview || previewUrl;

  return (
    <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-4 shadow-xs">
      <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
        <ImageIcon className="text-[#008069]" size={16} />
        <span>Gambar Pricelist WhatsApp</span>
      </h3>
      <p className="text-xs text-[#667781] leading-relaxed">
        Gambar pricelist yang otomatis dikirim ke customer saat meminta daftar harga layanan. File HD asli disimpan di server; pratinjau dashboard memakai versi ringan.
      </p>

      {effectivePreview && (
        <div className="rounded-xl overflow-hidden border border-[#e9edef] bg-[#f8fafc] max-h-64 flex items-center justify-center p-2 shadow-xs">
          <img src={effectivePreview} alt="Pratinjau pricelist" className="max-h-60 object-contain rounded-lg" />
        </div>
      )}

      <div className="flex items-center space-x-1.5">
        <button
          onClick={() => setUrlMode(true)}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-xs ${
            urlMode ? 'bg-[#008069] text-white' : 'bg-white text-[#54656f] border border-[#d1d7db] hover:bg-[#f0f2f5]'
          }`}
        >
          Pakai URL
        </button>
        <button
          onClick={() => setUrlMode(false)}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-xs ${
            !urlMode ? 'bg-[#008069] text-white' : 'bg-white text-[#54656f] border border-[#d1d7db] hover:bg-[#f0f2f5]'
          }`}
        >
          Upload Gambar
        </button>
      </div>

      {urlMode ? (
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-[#111b21] block">URL Gambar Pricelist</label>
          <input
            type="text"
            value={urlValue}
            onChange={(e) => {
              setUrlValue(e.target.value);
              setSelectedImage(null);
            }}
            placeholder="https://... atau /media/outbound/{tenant}/{file}"
            className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
          />
        </div>
      ) : (
        <div
          className="border-2 border-dashed border-[#d1d7db] rounded-xl p-6 text-center cursor-pointer hover:border-[#008069] hover:bg-[#e8f5f2]/20 transition"
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePickImage}
          />
          <Upload className="mx-auto text-[#008069] mb-2" size={22} />
          <p className="text-xs text-[#111b21] font-semibold">
            {selectedImage ? selectedImage.file.name : 'Klik untuk pilih gambar pricelist (maks 8 MB)'}
          </p>
          <p className="text-[10px] text-[#8696a0] mt-0.5">Format JPG, PNG, atau WEBP</p>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <div className="flex space-x-2">
          <button
            onClick={handleRemove}
            disabled={saving}
            className="px-3.5 py-2 bg-white hover:bg-rose-50 border border-[#d1d7db] hover:border-rose-200 text-[#54656f] hover:text-rose-700 rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 shadow-xs"
          >
            <Trash2 size={12} />
            <span>Reset ke Default</span>
          </button>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 shadow-xs"
        >
          <Save size={12} />
          <span>{saving ? 'Menyimpan...' : 'Simpan Gambar Pricelist'}</span>
        </button>
      </div>
    </div>
  );
};