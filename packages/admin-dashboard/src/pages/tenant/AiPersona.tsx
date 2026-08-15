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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#111b21] tracking-tight flex items-center space-x-2">
            <Volume2 className="text-[#008069]" size={22} />
            <span>AI Bot Persona Prompt Editor</span>
          </h1>
          <p className="text-xs text-[#667781] mt-0.5">
            Ubah karakter, nada bicara (tone of voice), aturan klinis, dan cara menyapa customer yang digunakan oleh sistem AI WhatsApp.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={loading || isSaving || !persona.trim()}
          className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
        >
          <Save size={14} />
          <span>{isSaving ? 'Menyimpan...' : 'Simpan Persona'}</span>
        </button>
      </div>

      {successMessage && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center space-x-2">
          <CheckCircle size={16} className="text-emerald-600" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center space-x-2">
          <AlertTriangle size={16} className="text-rose-600" />
          <span>{errorMessage}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#008069] border-t-transparent"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Main prompt editor */}
          <div className="lg:col-span-8 space-y-4">
            <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-4 flex flex-col h-[600px] shadow-xs">
              <div className="flex justify-between items-center pb-2.5 border-b border-[#e9edef]">
                <span className="text-xs font-bold text-[#111b21] uppercase tracking-wider flex items-center space-x-1.5">
                  <FileText size={14} className="text-[#008069]" />
                  <span>System Prompt Persona (Indonesian)</span>
                </span>
                <span className="text-[10px] text-[#8696a0]">Karakter: {persona.length}</span>
              </div>
              
              <textarea
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                className="flex-1 w-full p-4 bg-[#f8fafc] border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] leading-relaxed font-mono resize-none overflow-y-auto shadow-xs"
                placeholder="Tuliskan instruksi sistem persona di sini..."
              />
            </div>
          </div>

          {/* Guidelines & Advice panel */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-3 shadow-xs">
              <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
                <FileText className="text-[#008069]" size={16} />
                <span>Batas Balasan AI</span>
              </h3>
              <div className="space-y-2">
                <label className="block text-xs text-[#54656f] font-semibold">
                  Maksimal karakter per balasan AI (0 / kosong = tanpa limit)
                </label>
                <input
                  type="number"
                  min={0}
                  value={maxCharsPerReply}
                  onChange={(e) => setMaxCharsPerReply(e.target.value)}
                  placeholder="mis. 500"
                  className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                />
                <p className="text-[11px] text-[#8696a0] leading-relaxed">
                  Berlaku untuk balasan yang di-generate AI. Balasan yang melebihi batas akan dipotong aman di akhir kalimat.
                </p>
              </div>
            </div>

            <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-4 shadow-xs">
              <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
                <Info className="text-[#008069]" size={16} />
                <span>Panduan Edit Persona</span>
              </h3>
              
              <div className="space-y-3 text-xs text-[#54656f] leading-relaxed">
                <div className="space-y-0.5">
                  <p className="font-bold text-[#111b21]">1. Nada Bicara (Tone):</p>
                  <p className="text-[#667781]">
                    Bot {BRAND.businessName} meniru gaya bicara Bidan yang ramah, hangat, menggunakan sapaan akrab seperti "Bunda", dan diakhiri dengan emoji ramah.
                  </p>
                </div>
                
                <div className="space-y-0.5">
                  <p className="font-bold text-[#111b21]">2. Aturan Medis & Gejala:</p>
                  <p className="text-[#667781]">
                    Jangan berikan diagnosa medis. Untuk keluhan sakit/demam tinggi, bot diinstruksikan untuk segera menyarankan pemeriksaan dokter/bidan terdekat.
                  </p>
                </div>

                <div className="space-y-0.5">
                  <p className="font-bold text-[#111b21]">3. Format Penawaran Ongkir:</p>
                  <p className="text-[#667781]">
                    Sistem otomatis menghitung jarak. Prompt harus menjaga bot agar selalu mengkonfirmasi lokasi sebelum memberikan rincian harga.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 flex items-start space-x-2 text-xs">
                  <HelpCircle className="flex-shrink-0 mt-0.5 text-amber-600" size={14} />
                  <span>
                    <strong>Penting:</strong> Perubahan prompt yang disimpan akan langsung aktif pada pesan masuk baru berikutnya secara real-time.
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
