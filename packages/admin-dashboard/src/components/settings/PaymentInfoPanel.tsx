import React, { useEffect, useRef, useState } from 'react';
import { QrCode, Upload, Save, Trash2, Eye, Plus, X, CreditCard, Building2, HelpCircle } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';

interface BankAccount {
  bank: string;
  accountNumber: string;
  accountName: string;
}

interface PaymentInfoData {
  qrisImageUrl: string | null;
  bankAccounts: BankAccount[];
  instructions?: string;
  customTemplate?: string | null;
}

const STANDARD_PAYMENT_TEMPLATE = `Halo Bunda {nama_pasien}, berikut informasi pembayaran resmi klinik:

💰 *Total Tagihan:* {total_tagihan}
_{rincian_biaya}_
📋 *Layanan:* {daftar_layanan}

🏦 *Transfer Bank Resmi Klinik:*
{daftar_rekening}

📱 _{keterangan_qris}_

ℹ️ _{petunjuk}_

Mohon konfirmasi atau kirimkan bukti transfer ke sini setelah pembayaran ya Bunda. Terima kasih banyak 🙏

~ {nama_terapis}`;

const TEMPLATE_VARS: Array<{ tag: string; label: string }> = [
  { tag: '{nama_pasien}', label: 'Nama Pasien' },
  { tag: '{total_tagihan}', label: 'Total Tagihan' },
  { tag: '{rincian_biaya}', label: 'Rincian Biaya' },
  { tag: '{daftar_layanan}', label: 'Daftar Layanan' },
  { tag: '{daftar_rekening}', label: 'Daftar Rekening' },
  { tag: '{keterangan_qris}', label: 'Keterangan QRIS' },
  { tag: '{petunjuk}', label: 'Petunjuk' },
  { tag: '{nama_terapis}', label: 'Nama Terapis' },
];

export const PaymentInfoPanel: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [qrisImageUrl, setQrisImageUrl] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<{ file: File; preview: string } | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [instructions, setInstructions] = useState<string>('');
  const [customTemplate, setCustomTemplate] = useState<string>('');
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const templateRef = useRef<HTMLTextAreaElement>(null);

  const loadPaymentInfo = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/admin/settings/payment-info');
      const data: PaymentInfoData = res?.data || res;
      if (data) {
        setQrisImageUrl(data.qrisImageUrl || null);
        setBankAccounts(Array.isArray(data.bankAccounts) ? data.bankAccounts : []);
        setInstructions(data.instructions || '');
        setCustomTemplate(typeof data.customTemplate === 'string' ? data.customTemplate : '');
      }
    } catch (err: any) {
      console.warn('Gagal memuat info pembayaran:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPaymentInfo();
  }, []);

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
      toast('Hanya file gambar (PNG, JPG, WEBP) yang didukung.', 'error');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast('Ukuran gambar maksimal 8 MB.', 'error');
      return;
    }
    const preview = URL.createObjectURL(file);
    setSelectedImage({ file, preview });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAddBankAccount = () => {
    setBankAccounts((prev) => [
      ...prev,
      { bank: 'BCA', accountNumber: '', accountName: '' },
    ]);
  };

  const handleUpdateBankAccount = (index: number, field: keyof BankAccount, value: string) => {
    setBankAccounts((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleRemoveBankAccount = (index: number) => {
    setBankAccounts((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleRemoveQris = async () => {
    const ok = await confirm({
      title: 'Hapus Gambar QRIS?',
      message: 'Gambar barcode QRIS akan dihapus dari pengaturan pembayaran klinik.',
      confirmText: 'Hapus QRIS',
      cancelText: 'Batal',
      danger: true,
    });
    if (!ok) return;

    setSelectedImage(null);
    setQrisImageUrl(null);
  };

  const insertTemplateVar = (tag: string) => {
    const el = templateRef.current;
    if (!el) {
      setCustomTemplate((prev) => (prev ? `${prev} ${tag}` : tag));
      return;
    }
    const start = el.selectionStart ?? customTemplate.length;
    const end = el.selectionEnd ?? customTemplate.length;
    const next = `${customTemplate.slice(0, start)}${tag}${customTemplate.slice(end)}`;
    setCustomTemplate(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + tag.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const buildPreview = (tpl: string): string => {
    if (!tpl.trim()) {
      let p = STANDARD_PAYMENT_TEMPLATE;
      p = p.split('{nama_pasien}').join('Bunda Sari');
      p = p.split('{total_tagihan}').join('Rp 170.000');
      p = p.split('{rincian_biaya}').join('Treatment: Rp 150.000 + Ongkir: Rp 20.000');
      p = p.split('{daftar_layanan}').join('Pijat Bayi 60 menit');
      p = p.split('{daftar_rekening}').join('• BCA: 8877665544 a.n. PT Kala Sejahtera');
      p = p.split('{keterangan_qris}').join('Barcode QRIS terlampir di atas');
      p = p.split('{petunjuk}').join(instructions.trim() || 'Mohon cantumkan nama pasien pada berita transfer');
      p = p.split('{nama_terapis}').join('Bidan Rina');
      return p;
    }
    const vars: Record<string, string> = {
      '{nama_pasien}': 'Bunda Sari',
      '{total_tagihan}': 'Rp 170.000',
      '{rincian_biaya}': 'Treatment: Rp 150.000 + Ongkir: Rp 20.000',
      '{daftar_layanan}': 'Pijat Bayi 60 menit',
      '{daftar_rekening}': bankAccounts.length ? bankAccounts.map((a) => `• ${a.bank}: ${a.accountNumber} a.n. ${a.accountName || '-'}`).join('\n') : '• BCA: 8877665544 a.n. PT Kala Sejahtera',
      '{keterangan_qris}': qrisImageUrl ? 'Barcode QRIS terlampir di atas' : '-',
      '{petunjuk}': instructions.trim() || '-',
      '{nama_terapis}': 'Bidan Rina',
    };
    let out = tpl;
    for (const [k, v] of Object.entries(vars)) out = out.split(k).join(v);
    return out.replace(/\{[a-z_]+\}/gi, '');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let imageB64: string | undefined = undefined;
      let mimeType: string | undefined = undefined;
      let fileName: string | undefined = undefined;

      if (selectedImage) {
        imageB64 = await fileToDataUrl(selectedImage.file);
        mimeType = selectedImage.file.type || 'image/png';
        fileName = selectedImage.file.name;
      }

      // Validasi sederhana rekening bank
      const validAccounts = bankAccounts
        .map((b) => ({
          bank: b.bank.trim(),
          accountNumber: b.accountNumber.trim(),
          accountName: b.accountName.trim(),
        }))
        .filter((b) => b.bank && b.accountNumber);

      const payload: any = {
        bankAccounts: validAccounts,
        instructions: instructions.trim() || undefined,
        customTemplate: customTemplate.trim() ? customTemplate : null,
      };

      if (imageB64) {
        payload.imageB64 = imageB64;
        payload.mimeType = mimeType;
        payload.fileName = fileName;
      } else {
        payload.qrisImageUrl = qrisImageUrl;
      }

      const res = await apiRequest('/api/admin/settings/payment-info', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      if (res && res.success) {
        toast(res.message || 'Pengaturan pembayaran berhasil disimpan!', 'success');
        setSelectedImage(null);
        await loadPaymentInfo();
      } else {
        toast(`Gagal menyimpan: ${res?.error || 'Terjadi kesalahan'}`, 'error');
      }
    } catch (err: any) {
      toast(`Gagal menyimpan: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const activeQrisDisplay = selectedImage?.preview || qrisImageUrl;

  if (loading) {
    return (
      <div className="bg-white border border-[#e9edef] rounded-2xl p-6 shadow-xs flex items-center justify-center space-x-2 text-[#667781]">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#008069] border-t-transparent" />
        <span className="text-xs">Memuat pengaturan pembayaran klinik...</span>
      </div>
    );
  }

  return (
    <div className="bg-white border border-[#e9edef] rounded-2xl p-5 sm:p-6 space-y-6 shadow-xs text-left">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-[#e9edef] pb-4">
        <div className="space-y-1">
          <h3 className="text-sm sm:text-base font-bold text-[#111b21] flex items-center space-x-2">
            <CreditCard className="text-[#008069]" size={18} />
            <span>Pengaturan Pembayaran &amp; QRIS Klinik</span>
          </h3>
          <p className="text-xs text-[#667781] leading-relaxed max-w-2xl">
            Konfigurasi barcode QRIS resmi dan nomor rekening klinik. Data ini tampil secara otomatis di aplikasi Bidan Terapis Lapangan saat mencatat pembayaran pasien di tempat.
          </p>
        </div>
      </div>

      {/* SECTION 1: QRIS Image Barcode */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-[#111b21] flex items-center gap-1.5">
            <QrCode size={15} className="text-[#008069]" />
            <span>Barcode QRIS Resmi Klinik</span>
          </label>
          {activeQrisDisplay && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#d9fdd3] text-[#008069] border border-[#00a884]/30">
              {selectedImage ? 'Preview Gambar Baru' : 'QRIS Aktif'}
            </span>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handlePickImage}
        />

        {activeQrisDisplay ? (
          <div className="flex flex-col sm:flex-row items-center gap-4 p-4 bg-[#f8fafc] rounded-2xl border border-[#e9edef]">
            <div
              onClick={() => setLightboxOpen(true)}
              className="relative w-36 h-36 bg-white p-2 rounded-xl border border-[#d1d7db] shadow-xs cursor-pointer group flex-shrink-0 flex items-center justify-center hover:border-[#008069] transition"
              title="Ketuk untuk memperbesar barcode"
            >
              <img
                src={activeQrisDisplay}
                alt="Barcode QRIS"
                className="w-full h-full object-contain rounded-lg group-hover:scale-105 transition-transform"
              />
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 rounded-xl transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1">
                <Eye size={14} />
                <span>Lihat</span>
              </div>
            </div>

            <div className="space-y-2 flex-1 text-center sm:text-left min-w-0">
              <p className="text-xs font-bold text-[#111b21]">
                {selectedImage ? selectedImage.file.name : 'QRIS Klinik Terdaftar'}
              </p>
              <p className="text-[11px] text-[#667781] leading-relaxed">
                Barcode ini dapat diperbesar ke layar penuh oleh bidan di lokasi agar pasien dapat memindai langsung menggunakan e-wallet (GoPay, OVO, Dana, ShopeePay) maupun m-banking.
              </p>
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-xs font-semibold text-[#111b21] flex items-center gap-1.5 shadow-xs active:scale-95 transition"
                >
                  <Upload size={13} />
                  <span>Ganti Gambar</span>
                </button>
                <button
                  type="button"
                  onClick={handleRemoveQris}
                  className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-semibold text-rose-700 flex items-center gap-1.5 shadow-xs active:scale-95 transition"
                >
                  <Trash2 size={13} />
                  <span>Hapus QRIS</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="p-6 border-2 border-dashed border-[#d1d7db] hover:border-[#008069] bg-[#f8fafc] rounded-2xl flex flex-col items-center justify-center cursor-pointer transition group text-center space-y-2"
          >
            <div className="h-12 w-12 rounded-2xl bg-white text-[#008069] flex items-center justify-center border border-[#e9edef] shadow-xs group-hover:scale-105 transition-transform">
              <Upload size={22} />
            </div>
            <div>
              <p className="text-xs font-bold text-[#111b21] group-hover:text-[#008069] transition">
                Pilih atau Tarik Foto Barcode QRIS ke Sini
              </p>
              <p className="text-[11px] text-[#667781] mt-0.5">
                Mendukung format PNG, JPG, atau WEBP (Maksimal 8 MB)
              </p>
            </div>
          </div>
        )}
      </div>

      {/* SECTION 2: Bank Accounts */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-xs font-bold text-[#111b21] flex items-center gap-1.5">
              <Building2 size={15} className="text-[#008069]" />
              <span>Rekening Bank Resmi Klinik</span>
            </label>
            <p className="text-[11px] text-[#667781] mt-0.5">
              Daftar rekening bank untuk pembayaran transfer oleh pasien.
            </p>
          </div>
          <button
            type="button"
            onClick={handleAddBankAccount}
            className="px-3 py-1.5 rounded-xl bg-[#e8f5f2] hover:bg-[#d0ece7] text-[#008069] border border-[#c2e7e0] text-xs font-bold flex items-center gap-1.5 shadow-2xs active:scale-95 transition"
          >
            <Plus size={13} />
            <span>Tambah Rekening</span>
          </button>
        </div>

        {bankAccounts.length === 0 ? (
          <div className="py-6 px-4 text-center bg-[#f8fafc] rounded-2xl border border-[#e9edef] text-xs text-[#667781] space-y-1">
            <p className="font-semibold text-[#111b21]">Belum ada rekening bank yang ditambahkan</p>
            <p className="text-[11px]">Klik "Tambah Rekening" di atas untuk mendaftarkan nomor rekening klinik.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {bankAccounts.map((acc, idx) => (
              <div
                key={idx}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2 p-3 bg-[#f8fafc] rounded-2xl border border-[#e9edef] items-end"
              >
                <div className="sm:col-span-3 space-y-1">
                  <label className="text-[10px] uppercase font-bold text-[#667781]">Nama Bank</label>
                  <input
                    type="text"
                    placeholder="Contoh: BCA / Mandiri / BRI"
                    value={acc.bank}
                    onChange={(e) => handleUpdateBankAccount(idx, 'bank', e.target.value)}
                    className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
                  />
                </div>

                <div className="sm:col-span-4 space-y-1">
                  <label className="text-[10px] uppercase font-bold text-[#667781]">Nomor Rekening</label>
                  <input
                    type="text"
                    placeholder="Contoh: 1234567890"
                    value={acc.accountNumber}
                    onChange={(e) => handleUpdateBankAccount(idx, 'accountNumber', e.target.value)}
                    className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs font-mono font-semibold text-[#008069] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
                  />
                </div>

                <div className="sm:col-span-4 space-y-1">
                  <label className="text-[10px] uppercase font-bold text-[#667781]">Atas Nama (Pemilik)</label>
                  <input
                    type="text"
                    placeholder="Contoh: PT Klinik Kala Sejahtera"
                    value={acc.accountName}
                    onChange={(e) => handleUpdateBankAccount(idx, 'accountName', e.target.value)}
                    className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
                  />
                </div>

                <div className="sm:col-span-1 flex justify-end pb-0.5">
                  <button
                    type="button"
                    onClick={() => handleRemoveBankAccount(idx)}
                    className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 transition flex items-center justify-center shadow-xs"
                    title="Hapus Rekening"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SECTION 3: Instructions & Notes */}
      <div className="space-y-1.5 pt-2">
        <label className="text-xs font-bold text-[#111b21] flex items-center gap-1.5">
          <HelpCircle size={14} className="text-[#008069]" />
          <span>Petunjuk / Catatan Pembayaran Pasien (Opsional)</span>
        </label>
        <textarea
          rows={2}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Contoh: Harap mencantumkan nama pasien pada berita transfer. Bukti transfer wajib diunggah oleh terapis."
          className="w-full p-3 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] resize-none shadow-xs"
        />
      </div>

      {/* SECTION 4: Template Pesan WhatsApp Kustom (data-driven) */}
      <div className="space-y-3 pt-2 border-t border-[#e9edef]">
        <div className="space-y-1">
          <label className="text-xs font-bold text-[#111b21] flex items-center gap-1.5">
            <span className="text-[#008069]">📝</span>
            <span>Template Pesan WhatsApp (Kustomisasi Copywriting)</span>
          </label>
          <p className="text-[11px] text-[#667781] leading-relaxed">
            Kosongkan untuk memakai template standar sistem. Gunakan placeholder di bawah — akan diganti otomatis saat kirim ke pasien. Klik chip untuk sisipkan di posisi kursor.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TEMPLATE_VARS.map((v) => (
            <button
              key={v.tag}
              type="button"
              onClick={() => insertTemplateVar(v.tag)}
              className="px-2.5 py-1 rounded-full bg-[#e8f5f2] hover:bg-[#d0ece7] border border-[#c2e7e0] text-[11px] font-semibold text-[#008069] transition active:scale-95"
              title={`Sisipkan ${v.tag}`}
            >
              {v.tag}
            </button>
          ))}
        </div>
        <textarea
          ref={templateRef}
          rows={10}
          value={customTemplate}
          onChange={(e) => setCustomTemplate(e.target.value)}
          placeholder={STANDARD_PAYMENT_TEMPLATE}
          className="w-full p-3 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#b0bec5] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] resize-y shadow-xs font-mono leading-relaxed min-h-[180px]"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCustomTemplate(STANDARD_PAYMENT_TEMPLATE)}
            className="px-3 py-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-xs font-semibold text-[#111b21] shadow-xs active:scale-95 transition"
          >
            Muat Template Standar
          </button>
          <button
            type="button"
            onClick={() => setCustomTemplate('')}
            className="px-3 py-1.5 rounded-xl bg-[#f8fafc] hover:bg-[#f0f2f5] border border-[#e9edef] text-xs font-semibold text-[#667781] shadow-xs active:scale-95 transition"
          >
            Gunakan Default Sistem
          </button>
        </div>
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold text-[#111b21]">Live Preview (simulasi pesan WhatsApp):</p>
          <pre className="w-full p-3 bg-[#f8fafc] border border-[#e9edef] rounded-xl text-xs text-[#111b21] whitespace-pre-wrap break-words leading-relaxed font-sans max-h-[320px] overflow-auto">
            {buildPreview(customTemplate)}
          </pre>
        </div>
      </div>

      {/* Submit Button */}
      <div className="pt-2 flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="px-5 py-2.5 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50 active:scale-95"
        >
          {saving ? (
            <>
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>Menyimpan...</span>
            </>
          ) : (
            <>
              <Save size={14} />
              <span>Simpan Pengaturan Pembayaran</span>
            </>
          )}
        </button>
      </div>

      {/* Lightbox Modal */}
      {lightboxOpen && activeQrisDisplay && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-fadeIn"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl flex flex-col items-center space-y-4 animate-modalScaleUp text-center relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setLightboxOpen(false)}
              className="absolute top-3 right-3 p-2 rounded-full bg-[#f0f2f5] hover:bg-[#e9edef] text-[#54656f] transition"
            >
              <X size={18} />
            </button>
            <h4 className="font-bold text-base text-[#111b21]">Preview Barcode QRIS</h4>
            <div className="p-3 bg-white rounded-2xl border border-[#e9edef] shadow-inner">
              <img
                src={activeQrisDisplay}
                alt="QRIS Preview"
                className="w-64 h-64 sm:w-72 sm:h-72 object-contain"
              />
            </div>
            <button
              type="button"
              onClick={() => setLightboxOpen(false)}
              className="w-full py-2.5 rounded-xl bg-[#008069] text-white text-xs font-bold hover:bg-[#00a884] transition"
            >
              Tutup Preview
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
