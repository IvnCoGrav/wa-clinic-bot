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
  const [whatsappNumber, setWhatsappNumber] = useState('6287751148065');
  const [formatVisit, setFormatVisit] = useState('Promo [%ID%]');
  const [formatCheckout, setFormatCheckout] = useState('list untuk reservasi :');
  const [formatPurchase, setFormatPurchase] = useState('Payment');
  const [formatValue, setFormatValue] = useState('Treatment = %VALUE%');

  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Generator State
  const [divisi, setDivisi] = useState('Iklan Utama');
  const [subdomain, setSubdomain] = useState(window.location.origin);
  const [greetingsText, setGreetingsText] = useState('ID [%ID%]\n\nHalo, saya tertarik dengan produknya. Boleh tanya-tanya dulu?');
  const [copied, setCopied] = useState(false);

  const loadCsConfig = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/admin/customer-service');
      if (res.data) {
        setCsName(res.data.csName || 'Cs Yusi');
        setWhatsappNumber(res.data.whatsappNumber || '6287751148065');
        setFormatVisit(res.data.formatVisit || 'Promo[%ID%]');
        setFormatCheckout(res.data.formatCheckout || 'list untuk reservasi :');
        setFormatPurchase(res.data.formatPurchase || 'Payment');
        setFormatValue(res.data.formatValue || 'Treatment = %VALUE%');
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
          formatCheckout,
          formatPurchase,
          formatValue,
        }),
      });
      toast('Konfigurasi Customer Service berhasil disimpan!', 'success');
    } catch (err: any) {
      toast(`Gagal menyimpan konfigurasi: ${err.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Generate CTA Link
  const generatedCtaLink = React.useMemo(() => {
    const baseUrl = subdomain.replace(/\/$/, '');
    const cleanDivisi = encodeURIComponent(divisi.toLowerCase().replace(/\s+/g, '-'));
    const encodedMsg = encodeURIComponent(greetingsText);
    const cleanPhone = whatsappNumber.replace(/\D/g, '');

    return `${baseUrl}/cta?divisi=${cleanDivisi}&phone=${cleanPhone}&msg=${encodedMsg}`;
  }, [subdomain, divisi, greetingsText, whatsappNumber]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(generatedCtaLink);
    setCopied(true);
    toast('CTA Link berhasil disalin ke clipboard!', 'success');
    setTimeout(() => setCopied(false), 3000);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-pink-500 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center space-x-3 border-b border-white/5 pb-5">
        <div className="p-3 rounded-xl bg-pink-500/10 text-pink-400 border border-pink-500/20">
          <Headphones size={24} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-100">Customer Service & CTA Link Generator</h2>
          <p className="text-xs text-slate-400">
            Pusat konfigurasi Customer Service dan pembuat CTA Link otomatis terhubung ke WhatsApp.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Panel 1: Settings Form */}
        <div className="glass-panel p-6 space-y-5 rounded-2xl border border-white/10">
          <div className="flex items-center space-x-2 border-b border-white/5 pb-3">
            <Sparkles size={18} className="text-pink-400" />
            <h3 className="font-semibold text-slate-200">Pengaturan Customer Service</h3>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Nama Customer Service</label>
              <input
                type="text"
                value={csName}
                onChange={(e) => setCsName(e.target.value)}
                placeholder="Cs Yusi"
                className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-pink-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">No WA</label>
              <input
                type="text"
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                placeholder="6285794210526"
                className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-pink-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Format Visit (Pesan Awal Visit / Lead)</label>
              <textarea
                rows={3}
                value={formatVisit}
                onChange={(e) => setFormatVisit(e.target.value)}
                placeholder="Promo [%ID%]"
                className="w-full bg-slate-900/60 border border-white/10 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-pink-500 transition"
              />
              <p className="text-[11px] text-slate-400 mt-1">Gunakan <code className="text-pink-400 font-mono">[%ID%]</code> untuk penempatan posisi kode unik tracking.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Format Checkout (Reservasi Form)</label>
              <textarea
                rows={2}
                value={formatCheckout}
                onChange={(e) => setFormatCheckout(e.target.value)}
                placeholder="list untuk reservasi :"
                className="w-full bg-slate-900/60 border border-white/10 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-pink-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Format Purchase (Label Pembayaran)</label>
              <textarea
                rows={2}
                value={formatPurchase}
                onChange={(e) => setFormatPurchase(e.target.value)}
                placeholder="Payment"
                className="w-full bg-slate-900/60 border border-white/10 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-pink-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Format Value (Label Treatment/Nilai)</label>
              <textarea
                rows={2}
                value={formatValue}
                onChange={(e) => setFormatValue(e.target.value)}
                placeholder="Treatment = %VALUE%"
                className="w-full bg-slate-900/60 border border-white/10 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-pink-500 transition"
              />
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full flex items-center justify-center space-x-2 py-3 bg-pink-500 hover:bg-pink-600 active:bg-pink-700 font-bold text-sm text-white rounded-xl shadow-lg transition disabled:opacity-50"
          >
            <Save size={16} />
            <span>{isSaving ? 'Menyimpan...' : 'Simpan Konfigurasi'}</span>
          </button>
        </div>

        {/* Panel 2: CTA Link Generator */}
        <div className="glass-panel p-6 space-y-5 rounded-2xl border border-white/10 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center space-x-2 border-b border-white/5 pb-3">
              <LinkIcon size={18} className="text-violet-400" />
              <h3 className="font-semibold text-slate-200">Generate CTA Link</h3>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Divisi / Nama Kampanye</label>
              <input
                type="text"
                value={divisi}
                onChange={(e) => setDivisi(e.target.value)}
                placeholder="Iklan Madu ABC"
                className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-violet-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Subdomain / Domain Base</label>
              <input
                type="text"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value)}
                placeholder="https://gass.abriastore.my.id"
                className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-violet-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Greetings Text (Pesan Pembuka WA)</label>
              <textarea
                rows={3}
                value={greetingsText}
                onChange={(e) => setGreetingsText(e.target.value)}
                className="w-full bg-slate-900/60 border border-white/10 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-violet-500 transition"
              />
              <p className="text-[11px] text-slate-400 mt-1 flex items-center space-x-1">
                <Info size={12} />
                <span>Gunakan <code className="text-pink-400 font-mono">[%ID%]</code> untuk menyisipkan kode unik tracking otomatis.</span>
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Generated CTA Link</label>
              <textarea
                readOnly
                rows={3}
                value={generatedCtaLink}
                className="w-full bg-slate-950/80 border border-violet-500/30 rounded-xl p-3 text-xs font-mono text-violet-300 focus:outline-none resize-none select-all"
              />
            </div>
          </div>

          <button
            onClick={handleCopyLink}
            className="w-full flex items-center justify-center space-x-2 py-3 bg-violet-600 hover:bg-violet-700 active:bg-violet-800 font-bold text-sm text-white rounded-xl shadow-lg transition"
          >
            {copied ? <Check size={16} className="text-emerald-300" /> : <Copy size={16} />}
            <span>{copied ? 'Tersealin!' : 'Copy to Clipboard'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
