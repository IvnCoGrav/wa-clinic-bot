import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { BRAND } from '../../config/brand';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { 
  Volume2, 
  Save, 
  X, 
  HelpCircle, 
  AlertTriangle,
  Info,
  CheckCircle,
  FileText,
  MessageSquare,
  Plus,
  Edit2,
  Trash2,
  RotateCcw,
  Sparkles,
  Search,
  Tag,
  User,
  Check,
  Power
} from 'lucide-react';

export interface FewShotExemplarItem {
  id: string;
  tenantId?: string;
  scenario: string;
  tags: string[];
  customerMessage: string;
  idealResponse: string;
  isActive?: boolean;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

export const AiPersona: React.FC = () => {
  const { toast, confirm } = useUiFeedback();

  // Tab State: 'prompt' | 'fewshots'
  const [activeTab, setActiveTab] = useState<'prompt' | 'fewshots'>('prompt');

  // Persona Prompt States
  const [persona, setPersona] = useState('');
  const [maxCharsPerReply, setMaxCharsPerReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Few-Shot Exemplar States
  const [exemplars, setExemplars] = useState<FewShotExemplarItem[]>([]);
  const [exemplarsLoading, setExemplarsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExemplar, setEditingExemplar] = useState<FewShotExemplarItem | null>(null);
  const [formScenario, setFormScenario] = useState('');
  const [formCustomerMessage, setFormCustomerMessage] = useState('');
  const [formIdealResponse, setFormIdealResponse] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [isSubmittingModal, setIsSubmittingModal] = useState(false);

  useBodyScrollLock(isModalOpen);

  // Load Persona Prompt
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

  // Load Few-Shot Exemplars
  const loadExemplars = async () => {
    setExemplarsLoading(true);
    try {
      const res = await apiRequest('/api/admin/few-shots');
      if (res.success && Array.isArray(res.data)) {
        setExemplars(res.data);
      }
    } catch (err: any) {
      console.error('Failed to load few-shots:', err);
      toast('Gagal memuat bank contoh chat: ' + err.message, 'error');
    } finally {
      setExemplarsLoading(false);
    }
  };

  useEffect(() => {
    loadPersona();
    loadExemplars();
  }, []);

  // Save Persona Prompt
  const handleSavePersona = async () => {
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
      toast('Prompt AI Persona berhasil disimpan!', 'success');
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      setErrorMessage(`Gagal menyimpan prompt: ${err.message}`);
      toast('Gagal menyimpan persona: ' + err.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Open Create Modal
  const handleOpenCreateModal = () => {
    setEditingExemplar(null);
    setFormScenario('');
    setFormCustomerMessage('');
    setFormIdealResponse('');
    setFormTags('');
    setFormIsActive(true);
    setIsModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (item: FewShotExemplarItem) => {
    setEditingExemplar(item);
    setFormScenario(item.scenario);
    setFormCustomerMessage(item.customerMessage);
    setFormIdealResponse(item.idealResponse);
    setFormTags(item.tags ? item.tags.join(', ') : '');
    setFormIsActive(item.isActive !== false);
    setIsModalOpen(true);
  };

  // Save/Submit Modal
  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formScenario.trim() || !formCustomerMessage.trim() || !formIdealResponse.trim()) {
      toast('Skenario, Pesan Pasien, dan Respon Ideal wajib diisi!', 'error');
      return;
    }

    setIsSubmittingModal(true);
    const parsedTags = formTags
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    try {
      if (editingExemplar) {
        // Update
        const res = await apiRequest(`/api/admin/few-shots/${editingExemplar.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            scenario: formScenario.trim(),
            customerMessage: formCustomerMessage.trim(),
            idealResponse: formIdealResponse.trim(),
            tags: parsedTags,
            isActive: formIsActive,
          }),
        });
        if (res.success && res.data) {
          setExemplars((prev) => prev.map((item) => (item.id === editingExemplar.id ? res.data : item)));
          toast('Contoh percakapan berhasil diperbarui!', 'success');
        }
      } else {
        // Create
        const res = await apiRequest('/api/admin/few-shots', {
          method: 'POST',
          body: JSON.stringify({
            scenario: formScenario.trim(),
            customerMessage: formCustomerMessage.trim(),
            idealResponse: formIdealResponse.trim(),
            tags: parsedTags,
            isActive: formIsActive,
          }),
        });
        if (res.success && res.data) {
          setExemplars((prev) => [...prev, res.data]);
          toast('Contoh percakapan baru berhasil ditambahkan!', 'success');
        }
      }
      setIsModalOpen(false);
    } catch (err: any) {
      toast('Gagal menyimpan contoh percakapan: ' + err.message, 'error');
    } finally {
      setIsSubmittingModal(false);
    }
  };

  // Toggle Active Status
  const handleToggleActive = async (item: FewShotExemplarItem) => {
    const newStatus = !item.isActive;
    try {
      const res = await apiRequest(`/api/admin/few-shots/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: newStatus }),
      });
      if (res.success && res.data) {
        setExemplars((prev) => prev.map((ex) => (ex.id === item.id ? res.data : ex)));
        toast(`Contoh percakapan ${newStatus ? 'diaktifkan' : 'dinonaktifkan'}.`, 'info');
      }
    } catch (err: any) {
      toast('Gagal mengubah status: ' + err.message, 'error');
    }
  };

  // Delete Exemplar
  const handleDeleteExemplar = async (item: FewShotExemplarItem) => {
    const ok = await confirm({
      title: 'Hapus Contoh Percakapan',
      message: `Yakin ingin menghapus contoh skenario "${item.scenario}"?`,
      confirmText: 'Ya, Hapus',
      cancelText: 'Batal',
      danger: true,
    });

    if (!ok) return;

    try {
      const res = await apiRequest(`/api/admin/few-shots/${item.id}`, {
        method: 'DELETE',
      });
      if (res.success) {
        setExemplars((prev) => prev.filter((ex) => ex.id !== item.id));
        toast('Contoh percakapan berhasil dihapus.', 'success');
      }
    } catch (err: any) {
      toast('Gagal menghapus contoh percakapan: ' + err.message, 'error');
    }
  };

  // Reset to Defaults
  const handleResetDefaults = async () => {
    const ok = await confirm({
      title: 'Reset ke Default SOP',
      message: 'Apakah Anda yakin ingin mereset seluruh contoh chat ke default SOP klinik bawaan sistem?',
      confirmText: 'Ya, Reset',
      cancelText: 'Batal',
      danger: true,
    });

    if (!ok) return;

    try {
      const res = await apiRequest('/api/admin/few-shots/reset-defaults', {
        method: 'POST',
      });
      if (res.success && Array.isArray(res.data)) {
        setExemplars(res.data);
        toast('Bank contoh percakapan berhasil di-reset ke default SOP klinik!', 'success');
      }
    } catch (err: any) {
      toast('Gagal mereset: ' + err.message, 'error');
    }
  };

  // Filtered exemplars for search
  const filteredExemplars = exemplars.filter((ex) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      ex.scenario.toLowerCase().includes(q) ||
      ex.customerMessage.toLowerCase().includes(q) ||
      ex.idealResponse.toLowerCase().includes(q) ||
      (ex.tags && ex.tags.some((t) => t.toLowerCase().includes(q)))
    );
  });

  const activeCount = exemplars.filter((e) => e.isActive !== false).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#111b21] tracking-tight flex items-center space-x-2">
            <Volume2 className="text-[#008069]" size={22} />
            <span>AI Bot Persona & Percakapan Ideal</span>
          </h1>
          <p className="text-xs text-[#667781] mt-0.5">
            Atur karakter, nada bicara (tone of voice), aturan klinis, dan bank contoh dialog yang digunakan oleh sistem AI WhatsApp.
          </p>
        </div>

        {activeTab === 'prompt' && (
          <button
            onClick={handleSavePersona}
            disabled={loading || isSaving || !persona.trim()}
            className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
          >
            <Save size={14} />
            <span>{isSaving ? 'Menyimpan...' : 'Simpan Persona'}</span>
          </button>
        )}

        {activeTab === 'fewshots' && (
          <div className="flex items-center space-x-2">
            <button
              onClick={handleResetDefaults}
              className="px-3 py-2 bg-white border border-[#d1d7db] hover:bg-[#f0f2f5] text-[#54656f] rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs"
              title="Reset ke daftar contoh bawaan SOP klinik"
            >
              <RotateCcw size={13} />
              <span>Reset SOP</span>
            </button>
            <button
              onClick={handleOpenCreateModal}
              className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs"
            >
              <Plus size={14} />
              <span>Tambah Contoh Chat</span>
            </button>
          </div>
        )}
      </div>

      {/* Tabs Switcher */}
      <div className="flex border-b border-[#e9edef] space-x-6">
        <button
          onClick={() => setActiveTab('prompt')}
          className={`pb-3 text-xs font-bold transition flex items-center space-x-2 relative ${
            activeTab === 'prompt' ? 'text-[#008069]' : 'text-[#667781] hover:text-[#111b21]'
          }`}
        >
          <FileText size={15} />
          <span>System Persona & Rules</span>
          {activeTab === 'prompt' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#008069] rounded-t-full" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('fewshots')}
          className={`pb-3 text-xs font-bold transition flex items-center space-x-2 relative ${
            activeTab === 'fewshots' ? 'text-[#008069]' : 'text-[#667781] hover:text-[#111b21]'
          }`}
        >
          <MessageSquare size={15} />
          <span>Bank Contoh Chat (Few-Shot)</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-semibold">
            {activeCount} Aktif
          </span>
          {activeTab === 'fewshots' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#008069] rounded-t-full" />
          )}
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

      {/* ========================================================================= */}
      {/* TAB 1: SYSTEM PROMPT PERSONA                                             */}
      {/* ========================================================================= */}
      {activeTab === 'prompt' && (
        <>
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
                        Jangan berikan diagnosa medis kuratif. Terapkan pendekatan suportif & komplementer untuk melegakan ketidaknyamanan si kecil.
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
        </>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: FEW-SHOT EXEMPLAR BANK (BANK CONTOH CHAT)                          */}
      {/* ========================================================================= */}
      {activeTab === 'fewshots' && (
        <div className="space-y-5">
          {/* Info Banner */}
          <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-100 flex items-start space-x-3 text-xs text-[#2e7d32]">
            <Sparkles className="flex-shrink-0 text-emerald-600 mt-0.5" size={18} />
            <div className="space-y-1">
              <p className="font-bold text-emerald-950">Cara Kerja Bank Contoh Chat (Few-Shot):</p>
              <p className="text-emerald-800 leading-relaxed">
                Saat customer bertanya hal tertentu (misal: jadwal, batuk pilek, harga, atau diskon), sistem akan secara otomatis memilih 1–2 contoh dialog ideal di bawah ini yang paling cocok dan menyuplainya ke AI. AI akan <strong>meniru gaya bahasa, keramahan, dan alur solusinya</strong> secara presisi.
              </p>
            </div>
          </div>

          {/* Search Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8696a0]" size={15} />
              <input
                type="text"
                placeholder="Cari skenario, pesan pasien, atau tag..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
              />
            </div>
            <span className="text-xs text-[#667781] self-end sm:self-center">
              Menampilkan <strong>{filteredExemplars.length}</strong> dari {exemplars.length} contoh
            </span>
          </div>

          {/* Exemplars List */}
          {exemplarsLoading ? (
            <div className="flex justify-center items-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#008069] border-t-transparent"></div>
            </div>
          ) : filteredExemplars.length === 0 ? (
            <div className="bg-white border border-[#e9edef] rounded-2xl p-12 text-center space-y-3">
              <MessageSquare className="mx-auto text-[#8696a0]" size={36} />
              <p className="text-sm font-bold text-[#111b21]">Tidak ada contoh percakapan yang cocok</p>
              <p className="text-xs text-[#667781] max-w-md mx-auto">
                {searchQuery ? 'Coba gunakan kata kunci pencarian yang lain.' : 'Belum ada contoh chat. Klik tombol "+ Tambah Contoh Chat" untuk mulai menambahkan.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredExemplars.map((item) => (
                <div
                  key={item.id}
                  className={`bg-white border rounded-2xl p-4.5 space-y-3.5 shadow-xs transition flex flex-col justify-between ${
                    item.isActive !== false ? 'border-[#e9edef] hover:border-[#008069]/40' : 'border-[#e9edef] bg-gray-50/50 opacity-70'
                  }`}
                >
                  {/* Top Bar: Scenario Title & Actions */}
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-[#008069] uppercase tracking-wider bg-emerald-50 px-2 py-0.5 rounded-md inline-block">
                          Skenario Kasus
                        </span>
                        <h4 className="text-xs font-bold text-[#111b21] leading-snug">{item.scenario}</h4>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center space-x-1 flex-shrink-0">
                        <button
                          onClick={() => handleToggleActive(item)}
                          className={`p-1.5 rounded-lg text-xs font-medium transition ${
                            item.isActive !== false
                              ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                              : 'text-gray-500 bg-gray-100 hover:bg-gray-200'
                          }`}
                          title={item.isActive !== false ? 'Nonaktifkan contoh' : 'Aktifkan contoh'}
                        >
                          <Power size={13} />
                        </button>
                        <button
                          onClick={() => handleOpenEditModal(item)}
                          className="p-1.5 text-[#54656f] hover:text-[#008069] hover:bg-[#f0f2f5] rounded-lg transition"
                          title="Edit contoh chat"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => handleDeleteExemplar(item)}
                          className="p-1.5 text-[#54656f] hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                          title="Hapus contoh chat"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Tag Chips */}
                    {item.tags && item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {item.tags.map((t, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-[#f0f2f5] text-[10px] font-medium text-[#54656f]"
                          >
                            <Tag size={10} className="text-[#8696a0]" />
                            <span>{t}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Chat Preview Dialogue */}
                  <div className="space-y-2 bg-[#f8fafc] p-3 rounded-xl border border-[#e9edef] text-xs">
                    {/* Customer Message */}
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-[#667781] flex items-center space-x-1">
                        <User size={11} />
                        <span>Pesan Masuk Pasien:</span>
                      </span>
                      <div className="bg-white p-2.5 rounded-lg border border-[#e2e8f0] text-[#111b21] italic text-[11px] leading-relaxed">
                        "{item.customerMessage}"
                      </div>
                    </div>

                    {/* Midwife Response */}
                    <div className="space-y-1 pt-1">
                      <span className="text-[10px] font-bold text-[#008069] flex items-center space-x-1">
                        <Sparkles size={11} />
                        <span>Balasan Ideal Bidan Yusi (Ditiru AI):</span>
                      </span>
                      <div className="bg-emerald-50/80 p-2.5 rounded-lg border border-emerald-200/80 text-[#0f5132] text-[11px] leading-relaxed font-medium">
                        {item.idealResponse}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL FORM: TAMBAH / EDIT CONTOH PERCAKAPAN                               */}
      {/* ========================================================================= */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-[#e9edef] shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-[#e9edef] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-xl bg-emerald-50 text-[#008069]">
                  <MessageSquare size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#111b21]">
                    {editingExemplar ? 'Edit Contoh Percakapan' : 'Tambah Contoh Percakapan Ideal'}
                  </h3>
                  <p className="text-[11px] text-[#667781]">
                    Contoh dialog ini akan dipelajari oleh AI untuk merespons pertanyaan sejenis.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 text-[#8696a0] hover:text-[#111b21] hover:bg-[#f0f2f5] rounded-xl transition"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body / Form */}
            <form onSubmit={handleSaveModal} className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              {/* Field 1: Skenario */}
              <div className="space-y-1.5">
                <label className="block font-bold text-[#111b21]">
                  Nama Skenario / Topik Kasus <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="mis. Pasien menanyakan promo diskon bundling"
                  value={formScenario}
                  onChange={(e) => setFormScenario(e.target.value)}
                  className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                />
              </div>

              {/* Field 2: Pesan Pasien */}
              <div className="space-y-1.5">
                <label className="block font-bold text-[#111b21]">
                  Pesan Masuk Pasien (Input Bunda) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder='mis. "Bisa minta diskon gak kak kalau ambil 2 paket?"'
                  value={formCustomerMessage}
                  onChange={(e) => setFormCustomerMessage(e.target.value)}
                  className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                />
              </div>

              {/* Field 3: Respon Ideal Bidan Yusi */}
              <div className="space-y-1.5">
                <label className="block font-bold text-[#111b21]">
                  Balasan Ideal Bidan Yusi (Contoh Jawaban Sempurna) <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="Tuliskan respon hangat, sopan, tenang, dan solutif khas Bidan Yusi..."
                  value={formIdealResponse}
                  onChange={(e) => setFormIdealResponse(e.target.value)}
                  className="w-full p-3 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] leading-relaxed resize-none shadow-xs"
                />
                <p className="text-[11px] text-[#8696a0]">
                  Gunakan format WhatsApp: cetak tebal satu bintang <code className="text-emerald-700">*teks*</code>, sapa "Bunda", gunakan kata "kami", dan akhiri dengan emoji hangat.
                </p>
              </div>

              {/* Field 4: Tag Pencocokan */}
              <div className="space-y-1.5">
                <label className="block font-bold text-[#111b21]">
                  Tag Intent / Kata Kunci (Dipisahkan koma)
                </label>
                <input
                  type="text"
                  placeholder="mis. diskon, promo, potongan, paket, nawar"
                  value={formTags}
                  onChange={(e) => setFormTags(e.target.value)}
                  className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                />
                <p className="text-[11px] text-[#8696a0]">
                  Kata-kata kunci yang akan memicu sistem untuk memilih contoh dialog ini saat customer bertanya.
                </p>
              </div>

              {/* Field 5: Status Aktif */}
              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="formIsActive"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="rounded border-[#d1d7db] text-[#008069] focus:ring-[#008069] h-4 w-4"
                />
                <label htmlFor="formIsActive" className="text-xs font-semibold text-[#111b21] cursor-pointer">
                  Aktifkan contoh dialog ini dalam sistem AI
                </label>
              </div>

              {/* Modal Footer */}
              <div className="pt-4 border-t border-[#e9edef] flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-[#f0f2f5] hover:bg-[#e9edef] text-[#54656f] rounded-xl text-xs font-semibold transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingModal}
                  className="px-5 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
                >
                  <Save size={14} />
                  <span>{isSubmittingModal ? 'Menyimpan...' : 'Simpan Contoh'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
