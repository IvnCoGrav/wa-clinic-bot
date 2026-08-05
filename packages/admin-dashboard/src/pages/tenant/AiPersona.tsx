import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { BRAND } from '../../config/brand';
import { 
  Volume2, 
  Save, 
  X, 
  HelpCircle, 
  AlertTriangle,
  Info,
  CheckCircle,
  FileText
} from 'lucide-react';

export const AiPersona: React.FC = () => {
  const [persona, setPersona] = useState('');
  const [maxCharsPerReply, setMaxCharsPerReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadPersona = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/admin/persona');
      setPersona(res.persona || '');
      setMaxCharsPerReply(res.maxCharsPerReply != null ? String(res.maxCharsPerReply) : '');
      setErrorMessage(null);
    } catch (err: any) {
      console.error('Failed to load persona:', err);
      setErrorMessage(err.message || 'Gagal memuat prompt AI Persona.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPersona();
  }, []);

  const handleSave = async () => {
    if (!persona.trim() || isSaving) return;
    setIsSaving(true);
    setSuccessMessage(null);
    setErrorMessage(null);
    try {
      await apiRequest('/api/admin/persona', {
        method: 'POST',
        body: JSON.stringify({
          persona,
          maxCharsPerReply: maxCharsPerReply.trim() === '' ? null : Number(maxCharsPerReply),
        }),
      });
      setSuccessMessage('Prompt AI Persona berhasil diperbarui secara live dan persisten!');
      // Hide message after 5 seconds
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      setErrorMessage(`Gagal menyimpan prompt: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center space-x-2">
            <Volume2 className="text-pink-500" />
            <span>AI Bot Persona Prompt Editor</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Ubah karakter, nada bicara (tone of voice), aturan klinis, dan cara menyapa customer yang digunakan oleh sistem AI WhatsApp.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={loading || isSaving || !persona.trim()}
          className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-black transition flex items-center space-x-1.5 shadow-lg shadow-pink-500/10 disabled:opacity-50"
        >
          <Save size={14} />
          <span>{isSaving ? 'Menyimpan...' : 'Simpan Persona'}</span>
        </button>
      </div>

      {successMessage && (
        <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-medium flex items-center space-x-2 animate-fadeIn">
          <CheckCircle size={16} />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-rose-400 text-xs font-medium flex items-center space-x-2 animate-fadeIn">
          <AlertTriangle size={16} />
          <span>{errorMessage}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-pink-500 border-t-transparent"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Main prompt editor */}
          <div className="lg:col-span-8 space-y-4">
            <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4 flex flex-col h-[600px]">
              <div className="flex justify-between items-center pb-3 border-b border-white/5">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1">
                  <FileText size={14} className="text-pink-400" />
                  <span>System Prompt Persona (Indonesian)</span>
                </span>
                <span className="text-[10px] text-slate-500">Karakter count: {persona.length}</span>
              </div>
              
              <textarea
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                className="flex-1 w-full p-4 bg-slate-950/70 border border-white/5 rounded-2xl text-xs text-slate-200 focus:outline-none focus:border-pink-500 leading-relaxed font-mono resize-none overflow-y-auto"
                placeholder="Tuliskan instruksi sistem persona di sini..."
              />
            </div>
          </div>

          {/* Guidelines & Advice panel */}
          <div className="lg:col-span-4 space-y-6">
            <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <FileText className="text-pink-400" />
                <span>Batas Balasan AI</span>
              </h3>
              <div className="space-y-2">
                <label className="block text-[11px] text-slate-400 font-medium">
                  Maksimal karakter per balasan AI (0 / kosong = tanpa limit)
                </label>
                <input
                  type="number"
                  min={0}
                  value={maxCharsPerReply}
                  onChange={(e) => setMaxCharsPerReply(e.target.value)}
                  placeholder="mis. 500"
                  className="w-full p-3 bg-slate-950/70 border border-white/5 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-pink-500"
                />
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Berlaku untuk balasan yang di-generate AI (bukan template pesan terstruktur). Balasan yang melebihi batas akan dipotong aman di akhir kalimat.
                </p>
              </div>
            </div>

            <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-6">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <Info className="text-pink-400" />
                <span>Panduan Edit Persona</span>
              </h3>
              
              <div className="space-y-4 text-xs text-slate-400 leading-relaxed">
                <div className="space-y-1">
                  <p className="font-bold text-white">1. Nada Bicara (Tone):</p>
                  <p className="text-slate-500">
                    Bot ${BRAND.businessName} meniru gaya bicara Bidan yang ramah, hangat, menggunakan sapaan akrab seperti "Bunda", dan diakhiri dengan emoji yang ramah.
                  </p>
                </div>
                
                <div className="space-y-1">
                  <p className="font-bold text-white">2. Aturan Medis & Gejala:</p>
                  <p className="text-slate-500">
                    Jangan berikan saran medis spesifik. Untuk keluhan sakit/demam tinggi, bot diinstruksikan untuk segera menyarankan pemeriksaan bidan/dokter terdekat.
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="font-bold text-white">3. Format Penawaran Ongkir:</p>
                  <p className="text-slate-500">
                    Sistem otomatis menghitung jarak dan menyisipkan ongkos kirim. Prompt harus menjaga bot agar selalu mengkonfirmasi lokasi sebelum memberikan detail reservasi.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-start space-x-2 text-[11px]">
                  <HelpCircle className="flex-shrink-0 mt-0.5" size={14} />
                  <span>
                    <strong>Penting:</strong> Perubahan prompt yang disimpan di sini akan langsung berlaku seketika pada chat masuk baru berikutnya secara live tanpa perlu merestart server.
                  </span>
                </div>
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
};
