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
  const [activeTab, setActiveTab] = useState<'prompt' | 'sections' | 'fewshots'>('prompt');

  // 4-Section Prompt Config States
  const [personalityTone, setPersonalityTone] = useState('');
  const [answeringHierarchy, setAnsweringHierarchy] = useState('');
  const [negativeConstraints, setNegativeConstraints] = useState('');
  const [medicalOverclaimRules, setMedicalOverclaimRules] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [promptConfigSource, setPromptConfigSource] = useState<'active' | 'legacy' | 'default'>('default');
  const [promptConfigLoading, setPromptConfigLoading] = useState(false);
  const [isSavingPromptConfig, setIsSavingPromptConfig] = useState(false);

  // Persona Prompt States
  const [persona, setPersona] = useState('');
  const [maxCharsPerReply, setMaxCharsPerReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Few-Shot Exemplar States
  const [exemplars, setExemplars] = useState<FewShotExemplarItem[]>([]);
  const [exemplarsLoading, setExemplarsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'needs-review'>('all');

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

  // Load 4-Section Prompt Config
  const loadPromptConfig = async () => {
    setPromptConfigLoading(true);
    try {
      const res = await apiRequest('/api/admin/persona/prompt-config');
      if (res && res.config) {
        setPersonalityTone(res.config.personalityTone || '');
        setAnsweringHierarchy(res.config.answeringHierarchy || '');
        setNegativeConstraints(res.config.negativeConstraints || '');
        setMedicalOverclaimRules(res.config.medicalOverclaimRules || '');
      }
      setPromptConfigSource(res?.source || 'default');
    } catch (err: any) {
      console.error('Failed to load 4-section prompt config:', err);
      toast('Gagal memuat 4-section prompt config: ' + err.message, 'error');
    } finally {
      setPromptConfigLoading(false);
    }
  };

  const handleSavePromptConfig = async () => {
    if (
      !personalityTone.trim() ||
      !answeringHierarchy.trim() ||
      !negativeConstraints.trim() ||
      !medicalOverclaimRules.trim()
    ) {
      toast('Semua 4 section wajib diisi dan tidak boleh kosong.', 'info');
      return;
    }

    const confirmed = await confirm({
      title: 'Simpan Konfigurasi 4-Section Prompt?',
      message:
        'Konfigurasi 4-section ini akan menjadi versi aktif di database dan diprioritaskan di atas persona string legacy.',
      confirmText: 'Ya, Simpan & Aktifkan',
      cancelText: 'Batal',
    });
    if (!confirmed) return;

    setIsSavingPromptConfig(true);
    try {
      const res = await apiRequest('/api/admin/persona/prompt-config', {
        method: 'PUT',
        body: JSON.stringify({
          personalityTone,
          answeringHierarchy,
          negativeConstraints,
          medicalOverclaimRules,
          changeSummary: changeSummary.trim() || undefined,
        }),
      });
      if (res && res.success) {
        setPromptConfigSource('active');
        toast(res.message || 'Konfigurasi 4-section berhasil disimpan!', 'success');
        setChangeSummary('');
      } else {
        toast(res?.error || 'Gagal menyimpan konfigurasi', 'error');
      }
    } catch (err: any) {
      console.error('Failed to save prompt config:', err);
      toast(err.message || 'Gagal menyimpan konfigurasi', 'error');
    } finally {
      setIsSavingPromptConfig(false);
    }
  };

  useEffect(() => {
    loadPersona();
    loadExemplars();
    loadPromptConfig();
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

  // Pulihkan Contoh SOP Klinik (additive: contoh kustom tidak dihapus)
  const handleResetDefaults = async () => {
    const ok = await confirm({
      title: 'Pulihkan Contoh SOP Klinik',
      message: 'Contoh SOP bawaan sistem akan diperbarui/dilengkapi. Contoh kustom yang sudah Anda buat tetap dipertahankan. Lanjutkan?',
      confirmText: 'Ya, Pulihkan',
      cancelText: 'Batal',
      danger: false,
    });

    if (!ok) return;

    try {
      const res = await apiRequest('/api/admin/few-shots/reset-defaults', {
        method: 'POST',
      });
      if (res.success && Array.isArray(res.data)) {
        setExemplars(res.data);
        toast('Contoh SOP klinik berhasil dipulihkan (contoh kustom tetap dipertahankan).', 'success');
      }
    } catch (err: any) {
      toast('Gagal memulihkan: ' + err.message, 'error');
    }
  };

  // Filtered exemplars for search + status
  const filteredExemplars = exemplars.filter((ex) => {
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && ex.isActive !== false) ||
      (statusFilter === 'inactive' && ex.isActive === false) ||
      // PLAN 9 FASE 9.3: antrean review usulan gaya dari harvest livechat.
      (statusFilter === 'needs-review' &&
        ex.isActive === false &&
        ex.tags && ex.tags.some((t) => t.toLowerCase() === 'needs-review'));
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
          <h1 className="text-xl font-bold text-ink dark:text-white tracking-tight flex items-center space-x-2">
            <Volume2 className="text-accent" size={22} />
            <span>AI Bot Persona & Percakapan Ideal</span>
          </h1>
          <p className="text-xs text-ink-3 mt-0.5">
            Atur karakter, nada bicara (tone of voice), aturan klinis, dan bank contoh dialog yang digunakan oleh sistem AI WhatsApp.
          </p>
        </div>

        {activeTab === 'prompt' && (
          <button
            onClick={handleSavePersona}
            disabled={loading || isSaving || !persona.trim()}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
          >
            <Save size={14} />
            <span>{isSaving ? 'Menyimpan...' : 'Simpan Persona'}</span>
          </button>
        )}

        {activeTab === 'sections' && (
          <div className="flex items-center space-x-2">
            <button
              onClick={loadPromptConfig}
              disabled={promptConfigLoading || isSavingPromptConfig}
              className="px-3 py-2 bg-surface border border-divider hover:bg-fill-1 text-ink-2 rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs"
              title="Muat ulang dari server"
            >
              <RotateCcw size={13} />
              <span>Muat Ulang</span>
            </button>
            <button
              onClick={handleSavePromptConfig}
              disabled={promptConfigLoading || isSavingPromptConfig}
              className="px-4 py-2 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
            >
              <Save size={14} />
              <span>{isSavingPromptConfig ? 'Menyimpan...' : 'Simpan 4-Section'}</span>
            </button>
          </div>
        )}

        {activeTab === 'fewshots' && (
          <div className="flex items-center space-x-2">
            <button
              onClick={handleResetDefaults}
              className="px-3 py-2 bg-surface border border-divider hover:bg-fill-1 text-ink-2 rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs"
              title="Pulihkan contoh SOP bawaan klinik (contoh kustom tetap dipertahankan)"
            >
              <RotateCcw size={13} />
              <span>Pulihkan SOP</span>
            </button>
            <button
              onClick={handleOpenCreateModal}
              className="px-4 py-2 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs"
            >
              <Plus size={14} />
              <span>Tambah Contoh Chat</span>
            </button>
          </div>
        )}
      </div>

      {/* Tabs Switcher */}
      <div className="flex border-b border-divider space-x-6">
        <button
          onClick={() => setActiveTab('prompt')}
          className={`pb-3 text-xs font-bold transition flex items-center space-x-2 relative ${
            activeTab === 'prompt' ? 'text-accent' : 'text-ink-3 hover:text-ink dark:hover:text-white'
          }`}
        >
          <FileText size={15} />
          <span>System Persona (Legacy)</span>
          {activeTab === 'prompt' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('sections')}
          className={`pb-3 text-xs font-bold transition flex items-center space-x-2 relative ${
            activeTab === 'sections' ? 'text-accent' : 'text-ink-3 hover:text-ink dark:hover:text-white'
          }`}
        >
          <FileText size={15} />
          <span>Advanced 4-Section Prompt</span>
          {promptConfigSource === 'active' && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-accent font-semibold">
              Aktif
            </span>
          )}
          {promptConfigSource === 'legacy' && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-warning font-semibold">
              Legacy Bridge
            </span>
          )}
          {activeTab === 'sections' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('fewshots')}
          className={`pb-3 text-xs font-bold transition flex items-center space-x-2 relative ${
            activeTab === 'fewshots' ? 'text-accent' : 'text-ink-3 hover:text-ink dark:hover:text-white'
          }`}
        >
          <MessageSquare size={15} />
          <span>Bank Contoh Chat (Few-Shot)</span>
          <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-accent font-semibold">
            {activeCount} Aktif
          </span>
          {activeTab === 'fewshots' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full" />
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
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Main prompt editor */}
              <div className="lg:col-span-8 space-y-4">
                <div className="bg-surface border border-divider rounded-2xl p-5 space-y-4 flex flex-col h-[600px] shadow-xs">
                  <div className="flex justify-between items-center pb-2.5 border-b border-divider">
                    <span className="text-xs font-bold text-ink dark:text-white uppercase tracking-wider flex items-center space-x-1.5">
                      <FileText size={14} className="text-accent" />
                      <span>System Prompt Persona (Indonesian)</span>
                    </span>
                    <span className="text-[10px] text-ink-3">Karakter: {persona.length}</span>
                  </div>

                  <textarea
                    value={persona}
                    onChange={(e) => setPersona(e.target.value)}
                    className="flex-1 w-full p-4 bg-surface-2 border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent leading-relaxed font-mono resize-none overflow-y-auto shadow-xs"
                    placeholder="Tuliskan instruksi sistem persona di sini..."
                  />
                </div>
              </div>

              {/* Guidelines & Advice panel */}
              <div className="lg:col-span-4 space-y-6">
                <div className="bg-surface border border-divider rounded-2xl p-5 space-y-3 shadow-xs">
                  <h3 className="text-sm font-bold text-ink dark:text-white flex items-center space-x-2">
                    <FileText className="text-accent" size={16} />
                    <span>Batas Balasan AI</span>
                  </h3>
                  <div className="space-y-2">
                    <label className="block text-xs text-ink-2 font-semibold">
                      Maksimal karakter per balasan AI (0 / kosong = tanpa limit)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={maxCharsPerReply}
                      onChange={(e) => setMaxCharsPerReply(e.target.value)}
                      placeholder="mis. 500"
                      className="w-full p-2.5 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
                    />
                    <p className="text-[11px] text-ink-3 leading-relaxed">
                      Berlaku untuk balasan yang di-generate AI. Balasan yang melebihi batas akan dipotong aman di akhir kalimat.
                    </p>
                  </div>
                </div>

                <div className="bg-surface border border-divider rounded-2xl p-5 space-y-4 shadow-xs">
                  <h3 className="text-sm font-bold text-ink dark:text-white flex items-center space-x-2">
                    <Info className="text-accent" size={16} />
                    <span>Panduan Edit Persona</span>
                  </h3>

                  <div className="space-y-3 text-xs text-ink-2 leading-relaxed">
                    <div className="space-y-0.5">
                      <p className="font-bold text-ink dark:text-white">1. Nada Bicara (Tone):</p>
                      <p className="text-ink-3">
                        Bot {BRAND.businessName} meniru gaya bicara Bidan yang ramah, hangat, menggunakan sapaan akrab seperti "Bunda", dan diakhiri dengan emoji ramah.
                      </p>
                    </div>

                    <div className="space-y-0.5">
                      <p className="font-bold text-ink dark:text-white">2. Aturan Medis & Gejala:</p>
                      <p className="text-ink-3">
                        Jangan berikan diagnosa medis kuratif. Terapkan pendekatan suportif & komplementer untuk melegakan ketidaknyamanan si kecil.
                      </p>
                    </div>

                    <div className="space-y-0.5">
                      <p className="font-bold text-ink dark:text-white">3. Format Penawaran Ongkir:</p>
                      <p className="text-ink-3">
                        Sistem otomatis menghitung jarak. Prompt harus menjaga bot agar selalu mengkonfirmasi lokasi sebelum memberikan rincian harga.
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-amber-800 dark:text-warning flex items-start space-x-2 text-xs">
                      <HelpCircle className="flex-shrink-0 mt-0.5 text-warning" size={14} />
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
      {/* TAB 2: ADVANCED 4-SECTION PROMPT CONFIG                                   */}
      {/* ========================================================================= */}
      {activeTab === 'sections' && (
        <div className="space-y-6">
          {/* Warning Banner */}
          <div className="p-4 rounded-2xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 flex items-start space-x-3 text-xs text-amber-900 dark:text-amber-200">
            <Info className="flex-shrink-0 text-amber-600 dark:text-warning mt-0.5" size={18} />
            <div className="space-y-1">
              <p className="font-bold text-amber-950 dark:text-amber-100">
                Prioritas Otoritas Prompt (Anti Split-Brain):
              </p>
              <p className="text-amber-800 dark:text-warning leading-relaxed">
                Menyimpan konfigurasi 4-Section ini akan membuat versi baru di database. Konfigurasi 4-section aktif <strong>secara otomatis menjadi prioritas utama</strong> pada AI Engine V3, mengesampingkan prompt single-string legacy di tab sebelah.{' '}
                {promptConfigSource === 'active' && 'Saat ini konfigurasi 4-Section KUSTOM aktif.'}
                {promptConfigSource === 'legacy' && 'Belum ada 4-Section aktif. Engine memakai bridge persona legacy sebagai Personality & Tone; section lain memakai default klinik.'}
                {promptConfigSource === 'default' && 'Belum ada konfigurasi 4-Section aktif; seluruh section memakai default klinik.'}
              </p>
            </div>
          </div>

          {promptConfigLoading ? (
            <div className="flex justify-center items-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Section 1 */}
              <div className="bg-surface border border-divider rounded-2xl p-5 space-y-3 shadow-xs">
                <div className="flex justify-between items-center pb-2 border-b border-divider">
                  <span className="text-xs font-bold text-ink dark:text-white uppercase tracking-wider flex items-center space-x-1.5">
                    <FileText size={14} className="text-accent" />
                    <span>1. Personality & Tone (Gaya Bahasa, Sapaan & Karakter Bidan)</span>
                  </span>
                  <span className="text-[10px] text-ink-3">Karakter: {personalityTone.length}</span>
                </div>
                <textarea
                  rows={7}
                  value={personalityTone}
                  onChange={(e) => setPersonalityTone(e.target.value)}
                  className="w-full p-4 bg-surface-2 border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent leading-relaxed font-mono resize-y shadow-xs"
                  placeholder="Gaya bicara hangat, santai, partikel WhatsApp, emoji lembut..."
                />
              </div>

              {/* Section 2 */}
              <div className="bg-surface border border-divider rounded-2xl p-5 space-y-3 shadow-xs">
                <div className="flex justify-between items-center pb-2 border-b border-divider">
                  <span className="text-xs font-bold text-ink dark:text-white uppercase tracking-wider flex items-center space-x-1.5">
                    <FileText size={14} className="text-accent" />
                    <span>2. Answering Hierarchy (Alur & Prioritas Menjawab)</span>
                  </span>
                  <span className="text-[10px] text-ink-3">Karakter: {answeringHierarchy.length}</span>
                </div>
                <textarea
                  rows={7}
                  value={answeringHierarchy}
                  onChange={(e) => setAnsweringHierarchy(e.target.value)}
                  className="w-full p-4 bg-surface-2 border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent leading-relaxed font-mono resize-y shadow-xs"
                  placeholder="Prioritas jawab pertanyaan dulu, cek FAQ asal klinik, penanganan keluhan fisik..."
                />
              </div>

              {/* Section 3 */}
              <div className="bg-surface border border-divider rounded-2xl p-5 space-y-3 shadow-xs">
                <div className="flex justify-between items-center pb-2 border-b border-divider">
                  <span className="text-xs font-bold text-ink dark:text-white uppercase tracking-wider flex items-center space-x-1.5">
                    <FileText size={14} className="text-accent" />
                    <span>3. Negative Constraints (Batasan Mutlak & Aturan Emas)</span>
                  </span>
                  <span className="text-[10px] text-ink-3">Karakter: {negativeConstraints.length}</span>
                </div>
                <textarea
                  rows={9}
                  value={negativeConstraints}
                  onChange={(e) => setNegativeConstraints(e.target.value)}
                  className="w-full p-4 bg-surface-2 border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent leading-relaxed font-mono resize-y shadow-xs"
                  placeholder="Maksimal 2-3 kalimat, dilarang sebut harga/durasi tanpa ditanya, anti-todong jadwal..."
                />
              </div>

              {/* Section 4 */}
              <div className="bg-surface border border-divider rounded-2xl p-5 space-y-3 shadow-xs">
                <div className="flex justify-between items-center pb-2 border-b border-divider">
                  <span className="text-xs font-bold text-ink dark:text-white uppercase tracking-wider flex items-center space-x-1.5">
                    <FileText size={14} className="text-accent" />
                    <span>4. Medical Overclaim Rules (Batasan Klaim Medis)</span>
                  </span>
                  <span className="text-[10px] text-ink-3">Karakter: {medicalOverclaimRules.length}</span>
                </div>
                <textarea
                  rows={5}
                  value={medicalOverclaimRules}
                  onChange={(e) => setMedicalOverclaimRules(e.target.value)}
                  className="w-full p-4 bg-surface-2 border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent leading-relaxed font-mono resize-y shadow-xs"
                  placeholder="Perawatan bersifat komplementer/suportif, larangan garansi pasti sembuh..."
                />
              </div>

              {/* Change summary & bottom save */}
              <div className="bg-surface border border-divider rounded-2xl p-5 space-y-4 shadow-xs">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-ink dark:text-white">
                    Catatan Perubahan Versi (Opsional untuk Riwayat Audit)
                  </label>
                  <input
                    type="text"
                    value={changeSummary}
                    onChange={(e) => setChangeSummary(e.target.value)}
                    placeholder="mis. Penyesuaian aturan durasi pijat bayi & nada sapaan ramah"
                    className="w-full p-2.5 bg-surface-2 border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
                  />
                </div>

                <div className="flex justify-end items-center space-x-3 pt-2 border-t border-divider">
                  <button
                    onClick={loadPromptConfig}
                    disabled={promptConfigLoading || isSavingPromptConfig}
                    className="px-4 py-2 bg-surface border border-divider hover:bg-fill-1 text-ink-2 rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs"
                  >
                    <RotateCcw size={14} />
                    <span>Muat Ulang</span>
                  </button>
                  <button
                    onClick={handleSavePromptConfig}
                    disabled={promptConfigLoading || isSavingPromptConfig}
                    className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
                  >
                    <Save size={14} />
                    <span>{isSavingPromptConfig ? 'Menyimpan Versi Baru...' : 'Simpan 4-Section (Live Version)'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: FEW-SHOT EXEMPLAR BANK (BANK CONTOH CHAT)                          */}
      {/* ========================================================================= */}
      {activeTab === 'fewshots' && (
        <div className="space-y-5">
          {/* Info Banner */}
          <div className="p-4 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/60 flex items-start space-x-3 text-xs text-success dark:text-accent">
            <Info className="flex-shrink-0 text-emerald-600 dark:text-accent mt-0.5" size={18} />
            <div className="space-y-1">
              <p className="font-bold text-emerald-950 dark:text-emerald-200">Cara Kerja Bank Contoh Chat (Few-Shot):</p>
              <p className="text-emerald-800 dark:text-accent leading-relaxed">
                Saat customer bertanya hal tertentu (misal: jadwal, batuk pilek, harga, atau diskon), sistem akan secara otomatis memilih 1–2 contoh dialog ideal di bawah ini yang paling cocok dan menyuplainya ke AI. AI akan <strong>meniru gaya bahasa, keramahan, dan alur solusinya</strong> secara presisi.
              </p>
            </div>
          </div>

          {/* Search + Filter Toolbar */}
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" size={15} />
                <input
                  type="text"
                  placeholder="Cari skenario, pesan pasien, atau tag..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-surface border border-divider rounded-xl text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent shadow-xs"
                />
              </div>

              {/* Status Filter Pills */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition border ${
                    statusFilter === 'all'
                      ? 'bg-accent border-accent text-white'
                      : 'bg-surface border-divider text-ink-2 hover:bg-fill-1'
                  }`}
                >
                  Semua ({exemplars.length})
                </button>
                <button
                  onClick={() => setStatusFilter('active')}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition border ${
                    statusFilter === 'active'
                      ? 'bg-accent border-accent text-white'
                      : 'bg-surface border-divider text-ink-2 hover:bg-fill-1'
                  }`}
                >
                  Aktif ({activeCount})
                </button>
                <button
                  onClick={() => setStatusFilter('inactive')}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition border ${
                    statusFilter === 'inactive'
                      ? 'bg-accent border-accent text-white'
                      : 'bg-surface border-divider text-ink-2 hover:bg-fill-1'
                  }`}
                >
                  Nonaktif ({inactiveCount})
                </button>
                <button
                  onClick={() => setStatusFilter('needs-review')}
                  title="Usulan gaya dari jawaban admin (harvest livechat) yang menunggu review"
                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition border ${
                    statusFilter === 'needs-review'
                      ? 'bg-warning border-warning text-on-solid'
                      : 'bg-surface border-divider text-ink-2 hover:bg-fill-1'
                  }`}
                >
                  Perlu Review ({exemplars.filter((e) => e.isActive === false && e.tags && e.tags.some((t) => t.toLowerCase() === 'needs-review')).length})
                </button>
              </div>
            </div>

            <span className="text-xs text-ink-3 self-end sm:self-center">
              Menampilkan <strong>{filteredExemplars.length}</strong> dari {exemplars.length} contoh
            </span>
          </div>

          {/* Exemplars List */}
          {exemplarsLoading ? (
            <div className="flex justify-center items-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent"></div>
            </div>
          ) : filteredExemplars.length === 0 ? (
            <div className="bg-surface border border-divider rounded-2xl p-12 text-center space-y-3">
              <MessageSquare className="mx-auto text-ink-3" size={36} />
              <p className="text-sm font-bold text-ink dark:text-white">Tidak ada contoh percakapan yang cocok</p>
              <p className="text-xs text-ink-3 max-w-md mx-auto">
                {searchQuery || statusFilter !== 'all' ? 'Coba gunakan kata kunci pencarian atau filter status yang lain.' : 'Belum ada contoh chat. Klik tombol "+ Tambah Contoh Chat" untuk mulai menambahkan.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredExemplars.map((item, mapIdx) => (
                <div
                  key={item.id}
                  className={`bg-surface border rounded-2xl p-4.5 space-y-3.5 shadow-xs transition flex flex-col justify-between ${
                    item.isActive !== false
                      ? 'border-divider hover:border-accent/40 dark:hover:border-accent/60'
                      : 'border-divider bg-gray-50/50 dark:bg-fill-1/40 opacity-70'
                  }`}
                >
                  {/* Top Bar: Scenario Title & Actions */}
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-accent uppercase tracking-wider bg-emerald-50 dark:bg-emerald-900/40 px-2 py-0.5 rounded-md inline-block">
                          Skenario Kasus
                        </span>
                        <h4 className="text-xs font-bold text-ink dark:text-white leading-snug">{item.scenario}</h4>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center space-x-1 flex-shrink-0">
                        <div className="flex flex-col mr-0.5">
                          <button
                            onClick={() => handleMoveExemplar(item, 'up')}
                            disabled={mapIdx === 0}
                            className="p-0.5 text-ink-2 hover:text-accent hover:bg-fill-1 rounded transition disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Naikkan prioritas"
                            aria-label={`Naikkan prioritas ${item.scenario}`}
                          >
                            <ArrowUp size={11} />
                          </button>
                          <button
                            onClick={() => handleMoveExemplar(item, 'down')}
                            disabled={mapIdx === filteredExemplars.length - 1}
                            className="p-0.5 text-ink-2 hover:text-accent hover:bg-fill-1 rounded transition disabled:opacity-30 disabled:cursor-not-allowed"
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
                              ? 'text-emerald-700 dark:text-accent bg-emerald-50 dark:bg-emerald-900/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60'
                              : 'text-gray-500 dark:text-ink-3 bg-gray-100 dark:bg-fill-1 hover:bg-gray-200 dark:hover:bg-fill-2'
                          }`}
                          title={item.isActive !== false ? 'Nonaktifkan contoh' : 'Aktifkan contoh'}
                        >
                          <Power size={13} />
                        </button>
                        <button
                          onClick={() => handleOpenEditModal(item)}
                          className="p-1.5 text-ink-2 hover:text-accent hover:bg-fill-1 rounded-lg transition"
                          title="Edit contoh chat"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => handleDeleteExemplar(item)}
                          className="p-1.5 text-ink-2 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg transition"
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
                            className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-fill-1 text-[10px] font-medium text-ink-2"
                          >
                            <Tag size={10} className="text-ink-3" />
                            <span>{t}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Chat Preview Dialogue */}
                  <div className="space-y-2 bg-surface-2/60 p-3 rounded-xl border border-divider text-xs">
                    {/* Customer Message */}
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-ink-3 flex items-center space-x-1">
                        <User size={11} />
                        <span>Pesan Masuk Pasien:</span>
                      </span>
                      <div className="bg-surface p-2.5 rounded-lg border border-divider dark:border-divider text-ink italic text-[11px] leading-relaxed">
                        "{item.customerMessage}"
                      </div>
                    </div>

                    {/* Midwife Response */}
                    <div className="space-y-1 pt-1">
                      <span className="text-[10px] font-bold text-accent flex items-center space-x-1">
                        <MessageSquare size={11} />
                        <span>Balasan Ideal Bidan Yusi (Ditiru AI):</span>
                      </span>
                      <div className="bg-emerald-50/80 dark:bg-emerald-950/50 p-2.5 rounded-lg border border-emerald-200/80 dark:border-emerald-900/50 text-success dark:text-emerald-200 text-[11px] leading-relaxed font-medium">
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
          <div className="bg-surface rounded-3xl border border-divider shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-divider flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/40 text-accent">
                  <MessageSquare size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-ink dark:text-white">
                    {editingExemplar ? 'Edit Contoh Percakapan' : 'Tambah Contoh Percakapan Ideal'}
                  </h3>
                  <p className="text-[11px] text-ink-3">
                    Contoh dialog ini akan dipelajari oleh AI untuk merespons pertanyaan sejenis.
                  </p>
                </div>
              </div>
              <button
                onClick={handleCloseModal}
                className="p-2 text-ink-3 hover:text-ink dark:hover:text-white hover:bg-fill-1 rounded-xl transition"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body / Form */}
            <form onSubmit={handleSaveModal} className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              {/* Field 1: Skenario */}
              <div className="space-y-1.5">
                <label className="block font-bold text-ink dark:text-white">
                  Nama Skenario / Topik Kasus <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="mis. Pasien menanyakan promo diskon bundling"
                  value={formScenario}
                  onChange={(e) => setFormScenario(e.target.value)}
                  className="w-full p-2.5 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
                />
              </div>

              {/* Field 2: Pesan Pasien */}
              <div className="space-y-1.5">
                <label className="block font-bold text-ink dark:text-white">
                  Pesan Masuk Pasien (Input Bunda) <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder='mis. "Bisa minta diskon gak kak kalau ambil 2 paket?"'
                  value={formCustomerMessage}
                  onChange={(e) => setFormCustomerMessage(e.target.value)}
                  className="w-full p-2.5 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
                />
              </div>

              {/* Field 3: Respon Ideal Bidan Yusi */}
              <div className="space-y-1.5">
                <label className="block font-bold text-ink dark:text-white">
                  Balasan Ideal Bidan Yusi (Contoh Jawaban Sempurna) <span className="text-danger">*</span>
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="Tuliskan respon hangat, sopan, tenang, dan solutif khas Bidan Yusi..."
                  value={formIdealResponse}
                  onChange={(e) => setFormIdealResponse(e.target.value)}
                  className="w-full p-3 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent leading-relaxed resize-none shadow-xs"
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-ink-3">
                    Gunakan format WhatsApp: cetak tebal satu bintang <code className="text-emerald-700 dark:text-accent">*teks*</code>, sapa "Bunda", gunakan kata "kami", dan akhiri dengan emoji hangat.
                  </p>
                  <span
                    className={`text-[10px] font-semibold whitespace-nowrap ${
                      formIdealResponse.length > 500
                        ? 'text-amber-600 dark:text-warning'
                        : 'text-ink-3'
                    }`}
                    title={formIdealResponse.length > 500 ? 'Respon terlalu panjang — contoh ini ikut masuk prompt AI setiap kali relevan, usahakan ringkas.' : ''}
                  >
                    {formIdealResponse.length} / 500 karakter
                  </span>
                </div>
              </div>

              {/* Field 4: Tag Pencocokan (chip editor) */}
              <div className="space-y-1.5">
                <label className="block font-bold text-ink dark:text-white">
                  Tag Intent / Kata Kunci (dipisahkan koma)
                </label>

                {parseTagsFromDraft(formTags).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {parseTagsFromDraft(formTags).map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-fill-1 text-[10px] font-medium text-ink-2 border border-divider dark:border-divider"
                      >
                        <Tag size={10} className="text-ink-3" />
                        {t}
                        <button
                          type="button"
                          onClick={() => removeFormTag(t)}
                          className="text-ink-3 hover:text-danger transition ml-0.5"
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
                  className="w-full p-2.5 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
                />
                <p className="text-[11px] text-ink-3">
                  Kata-kata kunci yang akan memicu sistem untuk memilih contoh dialog ini saat customer bertanya. Tekan <strong>Enter</strong> atau pisahkan dengan koma.
                </p>

                {/* Quick Suggested Tags */}
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  <span className="text-[10px] text-ink-3 self-center font-medium">Cepat:</span>
                  {QUICK_TAGS.map((q) => {
                    const active = parseTagsFromDraft(formTags).includes(q);
                    return (
                      <button
                        key={q}
                        type="button"
                        onClick={() => (active ? removeFormTag(q) : addFormTag(q))}
                        className={`px-2 py-1 rounded-md text-[10px] font-semibold border transition ${
                          active
                            ? 'bg-accent border-accent text-white'
                            : 'bg-fill-1 border-divider dark:border-divider text-ink-2 hover:bg-fill-2 dark:hover:bg-fill-2'
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
                  className="rounded border-divider text-accent focus:ring-accent h-4 w-4"
                />
                <label htmlFor="formIsActive" className="text-xs font-semibold text-ink dark:text-white cursor-pointer">
                  Aktifkan contoh dialog ini dalam sistem AI
                </label>
              </div>

              {/* Modal Footer */}
              <div className="pt-4 border-t border-divider flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 bg-fill-1 hover:bg-fill-2 dark:hover:bg-fill-2 text-ink-2 dark:text-ink rounded-xl text-xs font-semibold transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingModal}
                  className="px-5 py-2 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
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
