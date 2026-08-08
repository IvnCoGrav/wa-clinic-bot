import React, { useRef, useState } from 'react';
import { ImageIcon, Upload, Save, Trash2 } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';

interface Props {
  initialImageUrl: string | null;
  onSaved?: () => void;
}

export const PricelistImagePanel: React.FC<Props> = ({ initialImageUrl, onSaved }) => {
  const { toast } = useUiFeedback();
  const [urlMode, setUrlMode] = useState<boolean>(true);
  const [urlValue, setUrlValue] = useState<string>(initialImageUrl || '');
  const [selectedImage, setSelectedImage] = useState<{ file: File; preview: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>(initialImageUrl || '');
  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setUrlValue(initialImageUrl || '');
    setPreviewUrl(initialImageUrl || '');
  }, [initialImageUrl]);

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
        setPreviewUrl(res.data?.pricelistImageUrl || '');
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
    <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
      <h3 className="text-base font-bold text-white flex items-center space-x-2">
        <ImageIcon className="text-pink-400" />
        <span>Gambar Pricelist WhatsApp</span>
      </h3>
      <p className="text-xs text-slate-400 leading-relaxed">
        Gambar pricelist yang otomatis dikirim ke customer saat meminta daftar harga. Disimpan per-tenant di database.
      </p>

      {effectivePreview && (
        <div className="rounded-xl overflow-hidden border border-white/10 bg-slate-950 max-h-64 flex items-center justify-center">
          <img src={effectivePreview} alt="Pratinjau pricelist" className="max-h-64 object-contain" />
        </div>
      )}

      <div className="flex items-center space-x-2">
        <button
          onClick={() => setUrlMode(true)}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
            urlMode ? 'bg-pink-500 text-white' : 'bg-slate-900 text-slate-400 border border-white/10'
          }`}
        >
          Pakai URL
        </button>
        <button
          onClick={() => setUrlMode(false)}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
            !urlMode ? 'bg-pink-500 text-white' : 'bg-slate-900 text-slate-400 border border-white/10'
          }`}
        >
          Upload Gambar
        </button>
      </div>

      {urlMode ? (
        <div>
          <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">URL Gambar Pricelist</label>
          <input
            type="text"
            value={urlValue}
            onChange={(e) => {
              setUrlValue(e.target.value);
              setSelectedImage(null);
            }}
            placeholder="https://... atau /media/outbound/{tenant}/{file}"
            className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-pink-500"
          />
        </div>
      ) : (
        <div
          className="border-2 border-dashed border-white/15 rounded-xl p-6 text-center cursor-pointer hover:border-pink-500/50 transition"
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePickImage}
          />
          <Upload className="mx-auto text-slate-500 mb-2" size={20} />
          <p className="text-xs text-slate-400">
            {selectedImage ? selectedImage.file.name : 'Klik untuk pilih gambar pricelist (maks 8 MB)'}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <div className="flex space-x-2">
          <button
            onClick={handleRemove}
            disabled={saving}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 border border-white/10 text-slate-300 rounded-xl text-xs font-bold transition flex items-center space-x-2 disabled:opacity-50"
          >
            <Trash2 size={12} />
            <span>Reset ke Default</span>
          </button>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-2 disabled:opacity-50"
        >
          <Save size={12} />
          <span>{saving ? 'Menyimpan...' : 'Simpan Gambar Pricelist'}</span>
        </button>
      </div>
    </div>
  );
};