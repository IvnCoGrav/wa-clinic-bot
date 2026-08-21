import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { 
  Headphones, 
  Save, 
  Copy, 
  Check, 
  Link as LinkIcon, 
  Sparkles,
  Info
} from 'lucide-react';

export const CustomerService: React.FC = () => {
  const { toast } = useUiFeedback();

  // Settings State
  const [csName, setCsName] = useState('Cs Yusi');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [formatVisit, setFormatVisit] = useState('Promo [%ID%]');
  const [formatCheckout, setFormatCheckout] = useState('list untuk reservasi :');
  const [formatPurchase, setFormatPurchase] = useState('Payment');
  const [formatValue, setFormatValue] = useState('Treatment = %VALUE%');
  const [landingDomain, setLandingDomain] = useState(window.location.origin);

  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Generator State
  const [divisi, setDivisi] = useState('Iklan Utama');
  const [greetingsText, setGreetingsText] = useState('ID [%ID%]\n\nHalo, saya tertarik dengan produknya. Boleh tanya-tanya dulu?');
  const [copied, setCopied] = useState(false);

  const loadCsConfig = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/admin/customer-service');
      if (res.data) {
        setCsName(res.data.csName || 'Cs Yusi');
        setWhatsappNumber(res.data.whatsappNumber || '');
        setFormatVisit(res.data.formatVisit || 'Promo[%ID%]');
        setGreetingsText(res.data.greetingsText || res.data.formatVisit || 'Promo [%ID%]');
        setFormatCheckout(res.data.formatCheckout || 'list untuk reservasi :');
        setFormatPurchase(res.data.formatPurchase || 'Payment');
        setFormatValue(res.data.formatValue || 'Treatment = %VALUE%');
        if (res.data.landingDomain) {
          setLandingDomain(res.data.landingDomain);
        }
      }
    } catch (err: any) {
      console.error('Failed to load CS config:', err);
      toast(`Gagal memuat konfigurasi CS: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCsConfig();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await apiRequest('/api/admin/customer-service', {
        method: 'POST',
        body: JSON.stringify({
          csName,
          whatsappNumber,
          formatVisit,
          greetingsText,
          formatCheckout,
          formatPurchase,
          formatValue,
          landingDomain,
        }),
      });
      toast('Konfigurasi Customer Service berhasil disimpan!', 'success');
    } catch (err: any) {
      toast(`Gagal menyimpan konfigurasi: ${err.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Generate Dynamic Clean CTA Link (Recommended)
  const generatedDynamicCtaLink = React.useMemo(() => {
    const baseUrl = (landingDomain || window.location.origin).replace(/\/$/, '');
    const cleanDivisi = encodeURIComponent(divisi.toLowerCase().replace(/\s+/g, '-'));
    return cleanDivisi ? `${baseUrl}/cta?divisi=${cleanDivisi}` : `${baseUrl}/cta`;
  }, [landingDomain, divisi]);

  // Generate Full Manual CTA Link (Legacy)
  const generatedCtaLink = React.useMemo(() => {
    const baseUrl = (landingDomain || window.location.origin).replace(/\/$/, '');
    const cleanDivisi = encodeURIComponent(divisi.toLowerCase().replace(/\s+/g, '-'));
    const encodedMsg = encodeURIComponent(greetingsText || formatVisit);
    const cleanPhone = whatsappNumber.replace(/\D/g, '');

    return `${baseUrl}/cta?divisi=${cleanDivisi}&phone=${cleanPhone}&msg=${encodedMsg}`;
  }, [landingDomain, divisi, greetingsText, formatVisit, whatsappNumber]);

  const handleCopyLink = (textToCopy: string, label: string = 'CTA') => {
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    toast(`Link ${label} berhasil disalin ke clipboard!`, 'success');
    setTimeout(() => setCopied(false), 3000);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#008069] border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center space-x-3 pb-2 border-b border-[#e9edef]">
        <div className="p-2.5 rounded-xl bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0]">
          <Headphones size={22} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-[#111b21]">Customer Service &amp; CTA Link Generator</h2>
          <p className="text-xs text-[#667781] mt-0.5">
            Pusat konfigurasi Customer Service dan pembuat CTA Link otomatis terhubung ke WhatsApp.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Panel 1: Settings Form */}
        <div className="bg-white p-5 space-y-4 rounded-2xl border border-[#e9edef] shadow-xs">
          <div className="flex items-center space-x-2 border-b border-[#e9edef] pb-3">
            <Sparkles size={16} className="text-[#008069]" />
            <h3 className="text-sm font-bold text-[#111b21]">Pengaturan Customer Service</h3>
          </div>

          <div className="space-y-3.5">
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#111b21]">Nama Customer Service</label>
              <input
                type="text"
                value={csName}
                onChange={(e) => setCsName(e.target.value)}
                placeholder="Cs Yusi"
                className="w-full bg-white border border-[#d1d7db] rounded-xl px-3.5 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs transition"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#111b21]">No WA (WhatsApp)</label>
              <input
                type="text"
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                placeholder="6285794210526"
                className="w-full bg-white border border-[#d1d7db] rounded-xl px-3.5 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs transition"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#111b21]">Format Visit (Pesan Awal Visit / Lead)</label>
              <textarea
                rows={2}
                value={formatVisit}
                onChange={(e) => setFormatVisit(e.target.value)}
                placeholder="Promo [%ID%]"
                className="w-full bg-white border border-[#d1d7db] rounded-xl p-2.5 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs transition"
              />
              <p className="text-[10px] text-[#8696a0]">Gunakan <code className="text-[#008069] font-mono font-semibold">[%ID%]</code> untuk penempatan posisi kode unik tracking.</p>
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#111b21]">Greetings Text (Pesan Pembuka WA)</label>
              <textarea
                rows={2}
                value={greetingsText}
                onChange={(e) => setGreetingsText(e.target.value)}
                placeholder="PROMO [%ID%]"
                className="w-full bg-white border border-[#d1d7db] rounded-xl p-2.5 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs transition"
              />
              <p className="text-[10px] text-[#8696a0] flex items-center space-x-1">
                <Info size={11} className="text-[#008069]" />
                <span>Gunakan <code className="text-[#008069] font-mono font-semibold">[%ID%]</code> untuk menyisipkan kode unik tracking otomatis.</span>
              </p>
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#111b21]">Format Checkout (Reservasi Form)</label>
              <textarea
                rows={2}
                value={formatCheckout}
                onChange={(e) => setFormatCheckout(e.target.value)}
                placeholder="list untuk reservasi :"
                className="w-full bg-white border border-[#d1d7db] rounded-xl p-2.5 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs transition"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#111b21]">Format Purchase (Label Pembayaran)</label>
              <textarea
                rows={2}
                value={formatPurchase}
                onChange={(e) => setFormatPurchase(e.target.value)}
                placeholder="Payment"
                className="w-full bg-white border border-[#d1d7db] rounded-xl p-2.5 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs transition"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#111b21]">Format Value (Label Treatment/Nilai)</label>
              <textarea
                rows={2}
                value={formatValue}
                onChange={(e) => setFormatValue(e.target.value)}
                placeholder="Treatment = %VALUE%"
                className="w-full bg-white border border-[#d1d7db] rounded-xl p-2.5 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs transition"
              />
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full flex items-center justify-center space-x-2 py-2.5 bg-[#008069] hover:bg-[#00a884] active:bg-[#006d59] font-semibold text-xs text-white rounded-xl shadow-xs transition disabled:opacity-50"
          >
            <Save size={14} />
            <span>{isSaving ? 'Menyimpan...' : 'Simpan Konfigurasi'}</span>
          </button>
        </div>

        {/* Panel 2: CTA Link Generator */}
        <div className="bg-white p-5 space-y-4 rounded-2xl border border-[#e9edef] shadow-xs self-start">
          <div className="space-y-3.5">
            <div className="flex items-center space-x-2 border-b border-[#e9edef] pb-3">
              <LinkIcon size={16} className="text-[#008069]" />
              <h3 className="text-sm font-bold text-[#111b21]">Generate CTA Link</h3>
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#111b21]">Divisi / Nama Kampanye</label>
              <input
                type="text"
                value={divisi}
                onChange={(e) => setDivisi(e.target.value)}
                placeholder="Iklan Treatment Bunda"
                className="w-full bg-white border border-[#d1d7db] rounded-xl px-3.5 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs transition"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#111b21]">Domain Landing Page / Base URL</label>
              <input
                type="text"
                value={landingDomain}
                onChange={(e) => setLandingDomain(e.target.value)}
                placeholder="https://example.com"
                className="w-full bg-white border border-[#d1d7db] rounded-xl px-3.5 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs transition"
              />
              <p className="text-[10px] text-[#8696a0]">
                Domain ini akan tersimpan ke database dan digunakan untuk membuat link CTA serta atribusi Meta CAPI.
              </p>
            </div>

            {/* Dynamic Clean Link (Recommended) */}
            <div className="space-y-1 bg-[#f0fdf4] p-3 rounded-xl border border-[#bbf7d0]">
              <div className="flex items-center justify-between">
                <label className="block text-[11px] font-bold text-[#15803d]">✨ Link Dinamis Singkat (Rekomendasi)</label>
                <span className="text-[10px] text-[#166534] font-medium">Otomatis Sync No CS & Pesan</span>
              </div>
              <textarea
                readOnly
                rows={2}
                value={generatedDynamicCtaLink}
                className="w-full bg-white border border-[#86efac] rounded-lg p-2 text-xs font-mono text-[#15803d] focus:outline-none resize-none select-all"
              />
              <p className="text-[10px] text-[#166534]">
                💡 Pakai link ini di landing page. Jika Anda ganti Nomor CS / Pesan di admin, semua landing page langsung ter-update otomatis tanpa ubah HTML.
              </p>
            </div>

            {/* Full Manual Link */}
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-[#111b21]">Link Manual (Hardcoded Phone/Msg)</label>
              <textarea
                readOnly
                rows={3}
                value={generatedCtaLink}
                className="w-full bg-[#f8fafc] border border-[#d1d7db] rounded-xl p-2.5 text-xs font-mono text-[#008069] focus:outline-none resize-none select-all"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleCopyLink(generatedDynamicCtaLink, 'Dinamis')}
                className="flex items-center justify-center space-x-1.5 py-2.5 bg-[#15803d] hover:bg-[#166534] font-semibold text-xs text-white rounded-xl shadow-xs transition"
              >
                {copied ? <Check size={14} className="text-white" /> : <Copy size={14} />}
                <span>Salin Link Dinamis</span>
              </button>
              <button
                onClick={() => handleCopyLink(generatedCtaLink, 'Manual')}
                className="flex items-center justify-center space-x-1.5 py-2.5 bg-[#008069] hover:bg-[#00a884] font-semibold text-xs text-white rounded-xl shadow-xs transition"
              >
                {copied ? <Check size={14} className="text-white" /> : <Copy size={14} />}
                <span>Salin Link Manual</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
