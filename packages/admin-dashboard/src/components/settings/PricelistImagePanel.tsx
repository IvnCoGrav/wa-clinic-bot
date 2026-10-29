import React, { useRef, useState } from 'react';
import { ImageIcon, Upload, Save, Trash2, Eye, X } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';

interface Props {
  initialImageUrl: string | null;
  onSaved?: () => void;
}

export const PricelistImagePanel: React.FC<Props> = ({ initialImageUrl, onSaved }) => {
  const { toast } = useUiFeedback();
  const [selectedImage, setSelectedImage] = useState<{ file: File; preview: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSave = async () => {
    if (!selectedImage) {
      toast('Pilih gambar pricelist terlebih dahulu.', 'error');
      return;
    }
    setSaving(true);
    try {
      const imageB64 = await fileToDataUrl(selectedImage.file);
      const res = await apiRequest('/api/admin/settings/pricelist-image', {
        method: 'PUT',
        body: JSON.stringify({
          imageB64,
          mimeType: selectedImage.file.type || 'image/jpeg',
          fileName: selectedImage.file.name,
        }),
      });
      if (res && res.success) {
        toast(res.message || 'Gambar pricelist berhasil disimpan.', 'success');
        setSelectedImage(null);
        onSaved?.();
      }
    } catch (err: any) {
      toast(`Gagal menyimpan gambar pricelist: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
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
        setSelectedImage(null);
        onSaved?.();
      }
    } catch (err: any) {
      toast(`Gagal reset gambar pricelist: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] rounded-2xl p-5 space-y-4 shadow-xs">
      <h3 className="text-sm font-bold text-[#111b21] dark:text-[#e9edef] flex items-center space-x-2">
        <ImageIcon className="text-[#008069]" size={16} />
        <span>Gambar Pricelist WhatsApp</span>
      </h3>
      <p className="text-xs text-[#667781] dark:text-[#8696a0] leading-relaxed">
        Gambar pricelist yang otomatis dikirim ke customer saat meminta daftar harga layanan. File HD asli disimpan &amp; dikirim tanpa kompresi.
      </p>

      {initialImageUrl && (
        <button
          onClick={() => setViewOpen(true)}
          className="w-full px-4 py-2.5 bg-[#f8fafc] dark:bg-[#202c33] hover:bg-[#e8f5f2]/60 dark:hover:bg-[#2a3942] border border-[#e9edef] dark:border-[#2a3942] rounded-xl text-xs font-semibold text-[#111b21] dark:text-[#e9edef] transition flex items-center justify-center space-x-1.5 shadow-xs"
        >
          <Eye size={14} className="text-[#008069]" />
          <span>Lihat Gambar Pricelist HD</span>
        </button>
      )}

      <div
        className="border-2 border-dashed border-[#d1d7db] dark:border-[#2a3942] hover:border-[#008069] rounded-xl p-6 text-center cursor-pointer hover:bg-[#e8f5f2]/20 dark:hover:bg-[#202c33]/50 transition bg-[#fafafa] dark:bg-[#111b21]"
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
        <p className="text-xs text-[#111b21] dark:text-[#e9edef] font-semibold">
          {selectedImage ? selectedImage.file.name : 'Klik untuk pilih gambar pricelist (maks 8 MB)'}
        </p>
        <p className="text-[10px] text-[#8696a0] mt-0.5">Format JPG, PNG, atau WEBP</p>
      </div>

      <div className="flex items-center justify-between pt-1">
        <button
          onClick={handleRemove}
          disabled={saving}
          className="px-3.5 py-2 bg-white dark:bg-[#202c33] hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-[#d1d7db] dark:border-[#2a3942] hover:border-rose-200 dark:hover:border-rose-900/50 text-[#54656f] dark:text-[#8696a0] hover:text-rose-700 dark:hover:text-rose-400 rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 shadow-xs"
        >
          <Trash2 size={12} />
          <span>Reset Default</span>
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !selectedImage}
          className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 shadow-xs"
        >
          <Save size={12} />
          <span>{saving ? 'Menyimpan...' : 'Simpan Gambar'}</span>
        </button>
      </div>

      {viewOpen && initialImageUrl && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4"
          onClick={() => setViewOpen(false)}
        >
          <div
            className="bg-white dark:bg-[#111b21] rounded-2xl sm:rounded-3xl border border-[#e9edef] dark:border-[#2a3942] shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden animate-fadeIn"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-[#e9edef] dark:border-[#2a3942] flex items-center justify-between bg-[#f8fafc] dark:bg-[#111b21]">
              <div>
                <h4 className="text-sm font-bold text-[#111b21] dark:text-[#e9edef]">Gambar Pricelist (HD)</h4>
                <p className="text-[11px] text-[#667781] dark:text-[#8696a0]">Tampilan resolusi penuh yang diterima pelanggan di WhatsApp</p>
              </div>
              <button
                onClick={() => setViewOpen(false)}
                className="text-[#54656f] hover:text-[#111b21] dark:text-[#e9edef] p-1.5 rounded-lg hover:bg-[#f0f2f5] transition"
                title="Tutup Modal"
              >
                <X size={18} />
              </button>
            </div>
            <div className="overflow-auto flex-1 p-4 flex items-center justify-center bg-[#f0f2f5] dark:bg-[#0b141a]">
              <img src={initialImageUrl} alt="Gambar pricelist" className="max-h-[65vh] object-contain rounded-xl shadow-xs border border-[#e9edef]" />
            </div>
            <div className="p-3 border-t border-[#e9edef] dark:border-[#2a3942] flex justify-end bg-white dark:bg-[#111b21]">
              <button
                onClick={() => setViewOpen(false)}
                className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition shadow-xs"
              >
                Tutup Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
