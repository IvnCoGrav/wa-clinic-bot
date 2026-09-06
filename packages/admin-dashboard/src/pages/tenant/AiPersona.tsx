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
  Info,
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
  Power,
  ArrowUp,
  ArrowDown
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

  // Few-Shot Exemplar States
  const [exemplars, setExemplars] = useState<FewShotExemplarItem[]>([]);
  const [exemplarsLoading, setExemplarsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExemplar, setEditingExemplar] = useState<FewShotExemplarItem | null>(null);
  const [formScenario, setFormScenario] = useState('');
  const [formCustomerMessage, setFormCustomerMessage] = useState('');
  const [formIdealResponse, setFormIdealResponse] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [isSubmittingModal, setIsSubmittingModal] = useState(false);

  const QUICK_TAGS = ['tanya_jadwal', 'tanya_harga', 'batuk_pilek', 'laktasi', 'metode_bayar', 'diskon_promo'];

  const parseTagsFromDraft = (raw: string): string[] =>
    raw
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

  const addFormTag = (tag: string) => {
    const clean = tag.trim().toLowerCase().replace(/^#/, '');
    if (!clean) return;
    const current = parseTagsFromDraft(formTags);
    if (current.includes(clean)) return;
    setFormTags(current.length > 0 ? `${current.join(', ')}, ${clean}` : clean);
  };

  const removeFormTag = (tag: string) => {
    const current = parseTagsFromDraft(formTags).filter((t) => t !== tag);
    setFormTags(current.join(', '));
  };

  useBodyScrollLock(isModalOpen);

  // Load Persona Prompt
  const loadPersona = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/admin/persona');
      setPersona(res.persona || '');
      setMaxCharsPerReply(res.maxCharsPerReply != null ? String(res.maxCharsPerReply) : '');
    } catch (err: any) {
      console.error('Failed to load persona:', err);
      toast('Gagal memuat prompt AI Persona: ' + err.message, 'error');
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
    try {
      await apiRequest('/api/admin/persona', {
        method: 'POST',
        body: JSON.stringify({
          persona,
          maxCharsPerReply: maxCharsPerReply.trim() === '' ? null : Number(maxCharsPerReply),
        }),
      });
      toast('Prompt AI Persona berhasil disimpan!', 'success');
    } catch (err: any) {
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

  const handleCloseModal = () => {
    setIsModalOpen(false);
  };

  // Save/Submit Modal
  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formScenario.trim() || !formCustomerMessage.trim() || !formIdealResponse.trim()) {
      toast('Skenario, Pesan Pasien, dan Respon Ideal wajib diisi!', 'error');
      return;
    }

    setIsSubmittingModal(true);
    const parsedTags = parseTagsFromDraft(formTags);

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

  // Move exemplar up/down in priority order (optimistic + persist via reorder API)
  const handleMoveExemplar = async (item: FewShotExemplarItem, direction: 'up' | 'down') => {
    const sorted = [...exemplars].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const idx = sorted.findIndex((e) => e.id === item.id);
    if (idx === -1) return;
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= sorted.length) return;

    const next = [...sorted];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    next.forEach((e, i) => (e.sortOrder = i + 1));
    setExemplars(next);

    try {
      const res = await apiRequest('/api/admin/few-shots/reorder', {
        method: 'PUT',
        body: JSON.stringify({ orderedIds: next.map((e) => e.id) }),
      });
      if (res.success && Array.isArray(res.data)) {
        setExemplars(res.data);
      }
    } catch (err: any) {
      setExemplars([...next].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
      toast('Gagal menyimpan urutan: ' + err.message, 'error');
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

  // Filtered exemplars for search + status
  const filteredExemplars = exemplars.filter((ex) => {
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && ex.isActive !== false) ||
      (statusFilter === 'inactive' && ex.isActive === false);
    if (!matchesStatus) return false;
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
  const inactiveCount = exemplars.length - activeCount;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#111b21] dark:text-white tracking-tight flex items-center space-x-2">
            <Volume2 className="text-[#008069]" size={22} />
            <span>AI Bot Persona & Percakapan Ideal</span>
          </h1>
          <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-0.5">
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
              className="px-3 py-2 bg-white dark:bg-[#202c33] border border-[#d1d7db] dark:border-[#374248] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#aebac1] rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs"
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
      <div className="flex border-b border-[#e9edef] dark:border-[#222e35] space-x-6">
        <button
          onClick={() => setActiveTab('prompt')}
          className={`pb-3 text-xs font-bold transition flex items-center space-x-2 relative ${
            activeTab === 'prompt' ? 'text-[#008069]' : 'text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white'
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
            activeTab === 'fewshots' ? 'text-[#008069]' : 'text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white'
          }`}
        >
          <MessageSquare size={15} />
          <span>Bank Contoh Chat (Few-Shot)</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 font-semibold">
            {activeCount} Aktif
          </span>
          {activeTab === 'fewshots' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#008069] rounded-t-full" />
          )}
        </button>
      </div>

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
                <div className="bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#222e35] rounded-2xl p-5 space-y-4 flex flex-col h-[600px] shadow-xs">
                  <div className="flex justify-between items-center pb-2.5 border-b border-[#e9edef] dark:border-[#222e35]">
                    <span className="text-xs font-bold text-[#111b21] dark:text-white uppercase tracking-wider flex items-center space-x-1.5">
                      <FileText size={14} className="text-[#008069]" />
                      <span>System Prompt Persona (Indonesian)</span>
                    </span>
                    <span className="text-[10px] text-[#8696a0]">Karakter: {persona.length}</span>
                  </div>

                  <textarea
                    value={persona}
                    onChange={(e) => setPersona(e.target.value)}
                    className="flex-1 w-full p-4 bg-[#f8fafc] dark:bg-[#202c33] border border-[#d1d7db] dark:border-[#374248] rounded-xl text-xs text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-[#008069] leading-relaxed font-mono resize-none overflow-y-auto shadow-xs"
                    placeholder="Tuliskan instruksi sistem persona di sini..."
                  />
                </div>
              </div>

              {/* Guidelines & Advice panel */}
              <div className="lg:col-span-4 space-y-6">
                <div className="bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#222e35] rounded-2xl p-5 space-y-3 shadow-xs">
                  <h3 className="text-sm font-bold text-[#111b21] dark:text-white flex items-center space-x-2">
                    <FileText className="text-[#008069]" size={16} />
                    <span>Batas Balasan AI</span>
                  </h3>
                  <div className="space-y-2">
                    <label className="block text-xs text-[#54656f] dark:text-[#aebac1] font-semibold">
                      Maksimal karakter per balasan AI (0 / kosong = tanpa limit)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={maxCharsPerReply}
                      onChange={(e) => setMaxCharsPerReply(e.target.value)}
                      placeholder="mis. 500"
                      className="w-full p-2.5 bg-white dark:bg-[#202c33] border border-[#d1d7db] dark:border-[#374248] rounded-xl text-xs text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-[#008069] shadow-xs"
                    />
                    <p className="text-[11px] text-[#8696a0] leading-relaxed">
                      Berlaku untuk balasan yang di-generate AI. Balasan yang melebihi batas akan dipotong aman di akhir kalimat.
                    </p>
                  </div>
                </div>

                <div className="bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#222e35] rounded-2xl p-5 space-y-4 shadow-xs">
                  <h3 className="text-sm font-bold text-[#111b21] dark:text-white flex items-center space-x-2">
                    <Info className="text-[#008069]" size={16} />
                    <span>Panduan Edit Persona</span>
                  </h3>

                  <div className="space-y-3 text-xs text-[#54656f] dark:text-[#aebac1] leading-relaxed">
                    <div className="space-y-0.5">
                      <p className="font-bold text-[#111b21] dark:text-white">1. Nada Bicara (Tone):</p>
                      <p className="text-[#667781] dark:text-[#8696a0]">
                        Bot {BRAND.businessName} meniru gaya bicara Bidan yang ramah, hangat, menggunakan sapaan akrab seperti "Bunda", dan diakhiri dengan emoji ramah.
                      </p>
                    </div>

                    <div className="space-y-0.5">
                      <p className="font-bold text-[#111b21] dark:text-white">2. Aturan Medis & Gejala:</p>
                      <p className="text-[#667781] dark:text-[#8696a0]">
                        Jangan berikan diagnosa medis kuratif. Terapkan pendekatan suportif & komplementer untuk melegakan ketidaknyamanan si kecil.
                      </p>
                    </div>

                    <div className="space-y-0.5">
                      <p className="font-bold text-[#111b21] dark:text-white">3. Format Penawaran Ongkir:</p>
                      <p className="text-[#667781] dark:text-[#8696a0]">
                        Sistem otomatis menghitung jarak. Prompt harus menjaga bot agar selalu mengkonfirmasi lokasi sebelum memberikan rincian harga.
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-amber-800 dark:text-amber-300 flex items-start space-x-2 text-xs">
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
          <div className="p-4 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/60 flex items-start space-x-3 text-xs text-[#2e7d32] dark:text-emerald-300">
            <Sparkles className="flex-shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" size={18} />
            <div className="space-y-1">
              <p className="font-bold text-emerald-950 dark:text-emerald-200">Cara Kerja Bank Contoh Chat (Few-Shot):</p>
              <p className="text-emerald-800 dark:text-emerald-300 leading-relaxed">
                Saat customer bertanya hal tertentu (misal: jadwal, batuk pilek, harga, atau diskon), sistem akan secara otomatis memilih 1–2 contoh dialog ideal di bawah ini yang paling cocok dan menyuplainya ke AI. AI akan <strong>meniru gaya bahasa, keramahan, dan alur solusinya</strong> secara presisi.
              </p>
            </div>
          </div>

          {/* Search + Filter Toolbar */}
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8696a0]" size={15} />
                <input
                  type="text"
                  placeholder="Cari skenario, pesan pasien, atau tag..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-white dark:bg-[#202c33] border border-[#d1d7db] dark:border-[#374248] rounded-xl text-xs text-[#111b21] dark:text-[#e9edef] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
                />
              </div>

              {/* Status Filter Pills */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition border ${
                    statusFilter === 'all'
                      ? 'bg-[#008069] border-[#008069] text-white'
                      : 'bg-white dark:bg-[#202c33] border-[#d1d7db] dark:border-[#374248] text-[#54656f] dark:text-[#aebac1] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]'
                  }`}
                >
                  Semua ({exemplars.length})
                </button>
                <button
                  onClick={() => setStatusFilter('active')}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition border ${
                    statusFilter === 'active'
                      ? 'bg-[#008069] border-[#008069] text-white'
                      : 'bg-white dark:bg-[#202c33] border-[#d1d7db] dark:border-[#374248] text-[#54656f] dark:text-[#aebac1] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]'
                  }`}
                >
                  Aktif ({activeCount})
                </button>
                <button
                  onClick={() => setStatusFilter('inactive')}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition border ${
                    statusFilter === 'inactive'
                      ? 'bg-[#008069] border-[#008069] text-white'
                      : 'bg-white dark:bg-[#202c33] border-[#d1d7db] dark:border-[#374248] text-[#54656f] dark:text-[#aebac1] hover:bg-[#f0f2f5] dark:hover:bg-[#2a3942]'
                  }`}
                >
                  Nonaktif ({inactiveCount})
                </button>
              </div>
            </div>

            <span className="text-xs text-[#667781] dark:text-[#8696a0] self-end sm:self-center">
              Menampilkan <strong>{filteredExemplars.length}</strong> dari {exemplars.length} contoh
            </span>
          </div>

          {/* Exemplars List */}
          {exemplarsLoading ? (
            <div className="flex justify-center items-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#008069] border-t-transparent"></div>
            </div>
          ) : filteredExemplars.length === 0 ? (
            <div className="bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#222e35] rounded-2xl p-12 text-center space-y-3">
              <MessageSquare className="mx-auto text-[#8696a0]" size={36} />
              <p className="text-sm font-bold text-[#111b21] dark:text-white">Tidak ada contoh percakapan yang cocok</p>
              <p className="text-xs text-[#667781] dark:text-[#8696a0] max-w-md mx-auto">
                {searchQuery || statusFilter !== 'all' ? 'Coba gunakan kata kunci pencarian atau filter status yang lain.' : 'Belum ada contoh chat. Klik tombol "+ Tambah Contoh Chat" untuk mulai menambahkan.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredExemplars.map((item, mapIdx) => (
                <div
                  key={item.id}
                  className={`bg-white dark:bg-[#111b21] border rounded-2xl p-4.5 space-y-3.5 shadow-xs transition flex flex-col justify-between ${
                    item.isActive !== false
                      ? 'border-[#e9edef] dark:border-[#222e35] hover:border-[#008069]/40 dark:hover:border-[#008069]/60'
                      : 'border-[#e9edef] dark:border-[#222e35] bg-gray-50/50 dark:bg-[#202c33]/40 opacity-70'
                  }`}
                >
                  {/* Top Bar: Scenario Title & Actions */}
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-[#008069] uppercase tracking-wider bg-emerald-50 dark:bg-emerald-900/40 px-2 py-0.5 rounded-md inline-block">
                          Skenario Kasus
                        </span>
                        <h4 className="text-xs font-bold text-[#111b21] dark:text-white leading-snug">{item.scenario}</h4>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center space-x-1 flex-shrink-0">
                        <div className="flex flex-col mr-0.5">
                          <button
                            onClick={() => handleMoveExemplar(item, 'up')}
                            disabled={mapIdx === 0}
                            className="p-0.5 text-[#54656f] dark:text-[#8696a0] hover:text-[#008069] hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] rounded transition disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Naikkan prioritas"
                            aria-label={`Naikkan prioritas ${item.scenario}`}
                          >
                            <ArrowUp size={11} />
                          </button>
                          <button
                            onClick={() => handleMoveExemplar(item, 'down')}
                            disabled={mapIdx === filteredExemplars.length - 1}
                            className="p-0.5 text-[#54656f] dark:text-[#8696a0] hover:text-[#008069] hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] rounded transition disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Turunkan prioritas"
                            aria-label={`Turunkan prioritas ${item.scenario}`}
                          >
                            <ArrowDown size={11} />
                          </button>
                        </div>
                        <button
                          onClick={() => handleToggleActive(item)}
                          className={`p-1.5 rounded-lg text-xs font-medium transition ${
                            item.isActive !== false
                              ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60'
                              : 'text-gray-500 dark:text-[#8696a0] bg-gray-100 dark:bg-[#202c33] hover:bg-gray-200 dark:hover:bg-[#2a3942]'
                          }`}
                          title={item.isActive !== false ? 'Nonaktifkan contoh' : 'Aktifkan contoh'}
                        >
                          <Power size={13} />
                        </button>
                        <button
                          onClick={() => handleOpenEditModal(item)}
                          className="p-1.5 text-[#54656f] dark:text-[#aebac1] hover:text-[#008069] hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] rounded-lg transition"
                          title="Edit contoh chat"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => handleDeleteExemplar(item)}
                          className="p-1.5 text-[#54656f] dark:text-[#aebac1] hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg transition"
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
                            className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-[#f0f2f5] dark:bg-[#202c33] text-[10px] font-medium text-[#54656f] dark:text-[#8696a0]"
                          >
                            <Tag size={10} className="text-[#8696a0]" />
                            <span>{t}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Chat Preview Dialogue */}
                  <div className="space-y-2 bg-[#f8fafc] dark:bg-[#202c33]/60 p-3 rounded-xl border border-[#e9edef] dark:border-[#222e35] text-xs">
                    {/* Customer Message */}
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-[#667781] dark:text-[#8696a0] flex items-center space-x-1">
                        <User size={11} />
                        <span>Pesan Masuk Pasien:</span>
                      </span>
                      <div className="bg-white dark:bg-[#202c33] p-2.5 rounded-lg border border-[#e2e8f0] dark:border-[#2a3942] text-[#111b21] dark:text-[#e9edef] italic text-[11px] leading-relaxed">
                        "{item.customerMessage}"
                      </div>
                    </div>

                    {/* Midwife Response */}
                    <div className="space-y-1 pt-1">
                      <span className="text-[10px] font-bold text-[#008069] flex items-center space-x-1">
                        <Sparkles size={11} />
                        <span>Balasan Ideal Bidan Yusi (Ditiru AI):</span>
                      </span>
                      <div className="bg-emerald-50/80 dark:bg-emerald-950/50 p-2.5 rounded-lg border border-emerald-200/80 dark:border-emerald-900/50 text-[#0f5132] dark:text-emerald-200 text-[11px] leading-relaxed font-medium">
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
          <div className="bg-white dark:bg-[#111b21] rounded-3xl border border-[#e9edef] dark:border-[#222e35] shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-[#e9edef] dark:border-[#222e35] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/40 text-[#008069]">
                  <MessageSquare size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#111b21] dark:text-white">
                    {editingExemplar ? 'Edit Contoh Percakapan' : 'Tambah Contoh Percakapan Ideal'}
                  </h3>
                  <p className="text-[11px] text-[#667781] dark:text-[#8696a0]">
                    Contoh dialog ini akan dipelajari oleh AI untuk merespons pertanyaan sejenis.
                  </p>
                </div>
              </div>
              <button
                onClick={handleCloseModal}
                className="p-2 text-[#8696a0] hover:text-[#111b21] dark:hover:text-white hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] rounded-xl transition"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body / Form */}
            <form onSubmit={handleSaveModal} className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              {/* Field 1: Skenario */}
              <div className="space-y-1.5">
                <label className="block font-bold text-[#111b21] dark:text-white">
                  Nama Skenario / Topik Kasus <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="mis. Pasien menanyakan promo diskon bundling"
                  value={formScenario}
                  onChange={(e) => setFormScenario(e.target.value)}
                  className="w-full p-2.5 bg-white dark:bg-[#202c33] border border-[#d1d7db] dark:border-[#374248] rounded-xl text-xs text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-[#008069] shadow-xs"
                />
              </div>

              {/* Field 2: Pesan Pasien */}
              <div className="space-y-1.5">
                <label className="block font-bold text-[#111b21] dark:text-white">
                  Pesan Masuk Pasien (Input Bunda) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder='mis. "Bisa minta diskon gak kak kalau ambil 2 paket?"'
                  value={formCustomerMessage}
                  onChange={(e) => setFormCustomerMessage(e.target.value)}
                  className="w-full p-2.5 bg-white dark:bg-[#202c33] border border-[#d1d7db] dark:border-[#374248] rounded-xl text-xs text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-[#008069] shadow-xs"
                />
              </div>

              {/* Field 3: Respon Ideal Bidan Yusi */}
              <div className="space-y-1.5">
                <label className="block font-bold text-[#111b21] dark:text-white">
                  Balasan Ideal Bidan Yusi (Contoh Jawaban Sempurna) <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="Tuliskan respon hangat, sopan, tenang, dan solutif khas Bidan Yusi..."
                  value={formIdealResponse}
                  onChange={(e) => setFormIdealResponse(e.target.value)}
                  className="w-full p-3 bg-white dark:bg-[#202c33] border border-[#d1d7db] dark:border-[#374248] rounded-xl text-xs text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-[#008069] leading-relaxed resize-none shadow-xs"
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-[#8696a0]">
                    Gunakan format WhatsApp: cetak tebal satu bintang <code className="text-emerald-700 dark:text-emerald-400">*teks*</code>, sapa "Bunda", gunakan kata "kami", dan akhiri dengan emoji hangat.
                  </p>
                  <span
                    className={`text-[10px] font-semibold whitespace-nowrap ${
                      formIdealResponse.length > 500
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-[#8696a0]'
                    }`}
                    title={formIdealResponse.length > 500 ? 'Respon terlalu panjang — contoh ini ikut masuk prompt AI setiap kali relevan, usahakan ringkas.' : ''}
                  >
                    {formIdealResponse.length} / 500 karakter
                  </span>
                </div>
              </div>

              {/* Field 4: Tag Pencocokan (chip editor) */}
              <div className="space-y-1.5">
                <label className="block font-bold text-[#111b21] dark:text-white">
                  Tag Intent / Kata Kunci (dipisahkan koma)
                </label>

                {parseTagsFromDraft(formTags).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {parseTagsFromDraft(formTags).map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#f0f2f5] dark:bg-[#202c33] text-[10px] font-medium text-[#54656f] dark:text-[#aebac1] border border-[#e9edef] dark:border-[#374248]"
                      >
                        <Tag size={10} className="text-[#8696a0]" />
                        {t}
                        <button
                          type="button"
                          onClick={() => removeFormTag(t)}
                          className="text-[#8696a0] hover:text-rose-600 transition ml-0.5"
                          aria-label={`Hapus tag ${t}`}
                          title={`Hapus tag ${t}`}
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <input
                  type="text"
                  placeholder="Ketik tag lalu tekan Enter / pisahkan koma, mis. diskon, promo, paket"
                  value={formTags}
                  onChange={(e) => setFormTags(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const current = parseTagsFromDraft(formTags);
                      if (current.length > 0) {
                        setFormTags(current.join(', '));
                      }
                    }
                  }}
                  className="w-full p-2.5 bg-white dark:bg-[#202c33] border border-[#d1d7db] dark:border-[#374248] rounded-xl text-xs text-[#111b21] dark:text-[#e9edef] focus:outline-none focus:border-[#008069] shadow-xs"
                />
                <p className="text-[11px] text-[#8696a0]">
                  Kata-kata kunci yang akan memicu sistem untuk memilih contoh dialog ini saat customer bertanya. Tekan <strong>Enter</strong> atau pisahkan dengan koma.
                </p>

                {/* Quick Suggested Tags */}
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  <span className="text-[10px] text-[#8696a0] self-center font-medium">Cepat:</span>
                  {QUICK_TAGS.map((q) => {
                    const active = parseTagsFromDraft(formTags).includes(q);
                    return (
                      <button
                        key={q}
                        type="button"
                        onClick={() => (active ? removeFormTag(q) : addFormTag(q))}
                        className={`px-2 py-1 rounded-md text-[10px] font-semibold border transition ${
                          active
                            ? 'bg-[#008069] border-[#008069] text-white'
                            : 'bg-[#f0f2f5] dark:bg-[#202c33] border-[#e9edef] dark:border-[#374248] text-[#54656f] dark:text-[#aebac1] hover:bg-[#e9edef] dark:hover:bg-[#2a3942]'
                        }`}
                      >
                        {active ? <Check size={10} className="inline mr-0.5" /> : <Plus size={10} className="inline mr-0.5" />}
                        {q}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Field 5: Status Aktif */}
              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="formIsActive"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="rounded border-[#d1d7db] dark:border-[#374248] text-[#008069] focus:ring-[#008069] h-4 w-4"
                />
                <label htmlFor="formIsActive" className="text-xs font-semibold text-[#111b21] dark:text-white cursor-pointer">
                  Aktifkan contoh dialog ini dalam sistem AI
                </label>
              </div>

              {/* Modal Footer */}
              <div className="pt-4 border-t border-[#e9edef] dark:border-[#222e35] flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 bg-[#f0f2f5] dark:bg-[#202c33] hover:bg-[#e9edef] dark:hover:bg-[#2a3942] text-[#54656f] dark:text-[#e9edef] rounded-xl text-xs font-semibold transition"
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
