import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { FAQChunk } from '../../types';
import { 
  BookOpen, 
  Plus, 
  UploadCloud, 
  HelpCircle, 
  FileText, 
  Check, 
  AlertCircle,
  AlertTriangle,
  Loader,
  Play,
  RefreshCw,
  Download,
  CheckCircle,
  Edit3,
  Save,
  X,
  Trash2,
  Sparkles
} from 'lucide-react';

export const KnowledgeBase: React.FC = () => {
  const { confirm } = useUiFeedback();
  const [chunks, setChunks] = useState<FAQChunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'chunks' | 'upload' | 'unanswered' | 'harvesting' | 'staging' | 'existing_use_case'>('chunks');
  
  // Toast Notification state
  const [toasts, setToasts] = useState<Array<{ id: string; type: 'success' | 'error' | 'info'; message: string }>>([]);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = Math.random().toString(36).substring(7);
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 2500);
  };

  // Form FAQ state
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Document uploader state
  const [docName, setDocName] = useState('');
  const [docContent, setDocContent] = useState('');
  const [uploadSubmitting, setUploadSubmitting] = useState(false);

  // Scraping/Harvesting state
  const [harvestJob, setHarvestJob] = useState<any>(null);
  const [harvestLoading, setHarvestLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ isSyncing: boolean }>({ isSyncing: false });
  const [localStats, setLocalStats] = useState<{ conversationCount: number }>({ conversationCount: 0 });

  // Staging FAQs state
  const [medicalStaging, setMedicalStaging] = useState<any[]>([]);
  const [generalStaging, setGeneralStaging] = useState<any[]>([]);
  const [stagingLoading, setStagingLoading] = useState(false);
  const [stagingTab, setStagingTab] = useState<'medical' | 'general'>('medical');
  const [editedQuestions, setEditedQuestions] = useState<Record<string, string>>({});
  const [editedAnswers, setEditedAnswers] = useState<Record<string, string>>({});

  // Existing Use Case / Duplicate Match state
  const [existingMatches, setExistingMatches] = useState<any[]>([]);
  const [editingChunkId, setEditingChunkId] = useState<string | null>(null);
  const [editingChunkTitle, setEditingChunkTitle] = useState('');
  const [editingChunkContent, setEditingChunkContent] = useState('');
  const [chunkSaveLoading, setChunkSaveLoading] = useState(false);

  // Unanswered logs state
  const [unansweredList, setUnansweredList] = useState<any[]>([]);
  const [unansweredLoading, setUnansweredLoading] = useState(false);
  const [activeUnansweredId, setActiveUnansweredId] = useState<string | null>(null);
  const [unansweredAnswer, setUnansweredAnswer] = useState('');

  const loadChunks = async () => {
    try {
      const data = await apiRequest('/api/admin/knowledge/chunks');
      const list = Array.isArray(data) ? data : (data?.data || []);
      setChunks(list);
    } catch (err) {
      console.error('Failed to load knowledge chunks:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChunks();
  }, []);

  // Poll status while PROCESSING
  useEffect(() => {
    let intervalId: any;
    if (harvestJob?.status === 'PROCESSING') {
      intervalId = setInterval(async () => {
        try {
          const res = await apiRequest('/api/admin/harvest/status');
          if (res?.data) setHarvestJob(res.data);
          if (res?.syncStatus) setSyncStatus(res.syncStatus);
          if (res?.localStats) setLocalStats(res.localStats);
        } catch (err) {
          console.error('Failed to poll harvest status:', err);
        }
      }, 3000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [harvestJob?.status]);

  // Load initial harvest job status on mount
  useEffect(() => {
    async function loadHarvestStatus() {
      try {
        const res = await apiRequest('/api/admin/harvest/status');
        if (res?.data) setHarvestJob(res.data);
        if (res?.syncStatus) setSyncStatus(res.syncStatus);
        if (res?.localStats) setLocalStats(res.localStats);
      } catch (err) {
        console.warn('Failed to load harvest status on mount:', err);
      }
    }
    loadHarvestStatus();
  }, []);

  const loadStagingData = async () => {
    setStagingLoading(true);
    try {
      const medRes = await apiRequest('/api/admin/medical-faq-staging');
      const genRes = await apiRequest('/api/admin/general-faq-staging');
      setMedicalStaging(medRes.data || []);
      setGeneralStaging(genRes.data || []);
      
      const qMap: Record<string, string> = {};
      const aMap: Record<string, string> = {};
      [...(medRes.data || []), ...(genRes.data || [])].forEach((item: any) => {
        qMap[item.id] = item.general_question || item.raw_question || '';
        aMap[item.id] = item.general_answer || item.bidan_raw_reply || item.raw_answer || '';
      });
      setEditedQuestions(prev => ({ ...prev, ...qMap }));
      setEditedAnswers(prev => ({ ...prev, ...aMap }));
    } catch (err) {
      console.error('Failed to load staging data:', err);
    } finally {
      setStagingLoading(false);
    }
  };

  const loadExistingMatches = async () => {
    setStagingLoading(true);
    try {
      const medRes = await apiRequest('/api/admin/medical-faq-staging?status=EXISTING_MATCH');
      const genRes = await apiRequest('/api/admin/general-faq-staging?status=EXISTING_MATCH');
      setExistingMatches([...(medRes.data || []), ...(genRes.data || [])]);
    } catch (err) {
      console.error('Failed to load existing matches:', err);
    } finally {
      setStagingLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'staging') {
      loadStagingData();
    } else if (activeTab === 'existing_use_case') {
      loadExistingMatches();
    }
  }, [activeTab]);

  const loadUnansweredData = async () => {
    setUnansweredLoading(true);
    try {
      const res = await apiRequest('/api/admin/knowledge/unanswered');
      setUnansweredList(res.data || []);
    } catch (err) {
      console.error('Failed to load unanswered questions:', err);
    } finally {
      setUnansweredLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'unanswered') {
      loadUnansweredData();
    }
  }, [activeTab]);

  const handleStartHarvest = async () => {
    setHarvestLoading(true);
    try {
      const res = await apiRequest('/api/admin/harvest/legacy-chat', {
        method: 'POST',
        body: JSON.stringify({ clearPreviousPending: true })
      });
      showToast(res.message || 'Scraping job started successfully!', 'info');
      const stats = await apiRequest('/api/admin/harvest/status');
      setHarvestJob(stats.data);
    } catch (err: any) {
      showToast(`Failed to start scraping: ${err.message}`, 'error');
    } finally {
      setHarvestLoading(false);
    }
  };

  const handleResetStaging = async () => {
    const ok = await confirm({
      title: 'Bersihkan Staging Lama yang Terbalik?',
      message: 'Ini akan menghapus kandidat FAQ PENDING lama yang terbalik dari pengikisan sebelumnya. Anda dapat menjalankan scraping baru yang sudah terurut dengan benar.',
      confirmText: 'Bersihkan Data Lama',
      cancelText: 'Batal',
      danger: true,
    });
    if (!ok) return;

    try {
      const res = await apiRequest('/api/admin/harvest/reset-staging', { method: 'POST' });
      showToast(res.message || 'Data staging terbalik berhasil dibersihkan.', 'success');
      loadStagingData();
    } catch (err: any) {
      showToast(`Gagal membersihkan staging: ${err.message}`, 'error');
    }
  };

  const handleDeleteAllStaging = async () => {
    const ok = await confirm({
      title: 'Hapus SELURUH Data Staging FAQ?',
      message: 'Seluruh kandidat FAQ medis dan umum di antrian Staging Reviewer akan dihapus secara PERMANEN. Lanjutkan?',
      confirmText: 'Hapus Semua Staging',
      cancelText: 'Batal',
      danger: true,
    });
    if (!ok) return;

    try {
      const res = await apiRequest('/api/admin/harvest/staging/all', { method: 'DELETE' });
      showToast(res.message || 'Seluruh data staging berhasil dihapus.', 'success');
      loadStagingData();
      loadExistingMatches();
    } catch (err: any) {
      showToast(`Gagal menghapus seluruh staging: ${err.message}`, 'error');
    }
  };

  const handleExportMarkdown = async () => {
    try {
      showToast('Menyiapkan berkas Markdown staging...', 'info');
      const response = await fetch('/api/admin/harvest/staging/export-md', {
        headers: {
          'x-admin-key': localStorage.getItem('admin_key') || '',
        },
      });

      if (!response.ok) {
        throw new Error('Gagal mengunduh berkas Markdown');
      }

      const text = await response.text();
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `staging-faq-export-${new Date().toISOString().split('T')[0]}.md`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      showToast('Berkas staging-faq-export.md berhasil diunduh!', 'success');
    } catch (err: any) {
      showToast(`Gagal export Markdown: ${err.message}`, 'error');
    }
  };

  const handleDownloadRawChatDump = async () => {
    try {
      showToast('Mengunduh berkas transkrip percakapan...', 'info');
      const response = await fetch('/api/admin/harvest/raw-file', {
        headers: {
          'x-admin-key': localStorage.getItem('admin_key') || '',
        },
      });

      if (!response.ok) {
        throw new Error('Berkas transkrip belum tersedia. Jalankan AI Chat Scraper terlebih dahulu.');
      }

      const text = await response.text();
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `raw_scraped_chats_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      showToast('Berkas raw_scraped_chats.json berhasil diunduh!', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const [analyzingStaging, setAnalyzingStaging] = useState(false);

  const handleAnalyzeStagingAI = async () => {
    try {
      setAnalyzingStaging(true);
      showToast('Memulai analisis DeepSeek AI untuk kandidat staging...', 'info');
      const res = await apiRequest('/api/admin/harvest/staging/analyze-ai', { method: 'POST' });
      showToast(res.message || 'Berhasil mengolah data staging dengan DeepSeek AI!', 'success');
      loadStagingData();
    } catch (err: any) {
      showToast(`Gagal analisa AI: ${err.message}`, 'error');
    } finally {
      setAnalyzingStaging(false);
    }
  };

  const handleStagingReview = async (id: string, type: 'medical' | 'general', status: 'APPROVED' | 'REJECTED') => {
    try {
      const body = {
        status,
        generalQuestion: editedQuestions[id],
        generalAnswer: editedAnswers[id],
      };
      
      await apiRequest(`/api/admin/${type}-faq-staging/${id}/review`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      
      showToast(
        status === 'APPROVED' ? 'Staging FAQ disetujui & disimpan ke FAQ!' : 'Staging FAQ ditolak.',
        status === 'APPROVED' ? 'success' : 'info'
      );
      loadStagingData();
      loadChunks();
    } catch (err: any) {
      showToast(`Failed to submit staging review: ${err.message}`, 'error');
    }
  };

  const handleResolveUnanswered = async (id: string) => {
    if (!unansweredAnswer.trim()) return;
    try {
      await apiRequest(`/api/admin/knowledge/unanswered/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ answer: unansweredAnswer })
      });
      showToast('Pertanyaan berhasil dijawab dan disimpan ke FAQ.', 'success');
      setUnansweredAnswer('');
      setActiveUnansweredId(null);
      loadUnansweredData();
      loadChunks();
    } catch (err: any) {
      showToast(`Gagal menyimpan jawaban: ${err.message}`, 'error');
    }
  };

  const handleSaveChunkEditFromMatch = async (chunkId: string) => {
    if (!editingChunkTitle.trim() || !editingChunkContent.trim() || chunkSaveLoading) return;
    setChunkSaveLoading(true);
    try {
      await apiRequest(`/api/admin/knowledge/chunks/${chunkId}`, {
        method: 'PUT',
        body: JSON.stringify({ title: editingChunkTitle, content: editingChunkContent })
      });
      showToast('FAQ existing berhasil diperbarui!', 'success');
      setEditingChunkId(null);
      loadExistingMatches();
      loadChunks();
    } catch (err: any) {
      showToast(`Gagal menyimpan perubahan FAQ: ${err.message}`, 'error');
    } finally {
      setChunkSaveLoading(false);
    }
  };

  const handleDeleteChunk = async (chunkId: string) => {
    const isConfirmed = await confirm({
      title: 'Hapus FAQ Chunk?',
      message: 'Apakah Anda yakin ingin menghapus FAQ Reference Chunk ini? Perubahan ini bersifat permanen.',
      confirmText: 'Ya, Hapus',
      danger: true,
    });
    if (!isConfirmed) return;
    try {
      await apiRequest(`/api/admin/knowledge/chunks/${chunkId}`, {
        method: 'DELETE'
      });
      showToast('FAQ Reference Chunk berhasil dihapus.', 'info');
      loadChunks();
    } catch (err: any) {
      showToast(`Gagal menghapus FAQ: ${err.message}`, 'error');
    }
  };

  const handleAddFaq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || !answer.trim()) return;

    setFormSubmitting(true);
    try {
      // Bulk import supports an array format
      await apiRequest('/api/admin/knowledge/faq', {
        method: 'POST',
        body: JSON.stringify({
          faqs: [{ question, answer }]
        })
      });
      showToast('FAQ added successfully!', 'success');
      setQuestion('');
      setAnswer('');
      loadChunks();
    } catch (err: any) {
      showToast(`Failed to add FAQ: ${err.message}`, 'error');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleUploadDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docName.trim() || !docContent.trim()) return;

    setUploadSubmitting(true);
    try {
      await apiRequest('/api/admin/knowledge/document', {
        method: 'POST',
        body: JSON.stringify({
          documentName: docName,
          content: docContent
        })
      });
      showToast('SOP document parsed and saved successfully!', 'success');
      setDocName('');
      setDocContent('');
      loadChunks();
    } catch (err: any) {
      showToast(`Failed to parse document: ${err.message}`, 'error');
    } finally {
      setUploadSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-[#111b21] flex items-center space-x-2">
          <BookOpen className="text-[#008069]" size={22} />
          <span>Knowledge Base Manager</span>
        </h2>
        <p className="text-xs text-[#667781] mt-0.5">Kelola data FAQ, SOP klinik, dan AI RAG references untuk respons otomatis WhatsApp</p>
      </div>

      {/* Tabs Menu */}
      <div className="flex flex-wrap gap-1 p-1 bg-white border border-[#e9edef] rounded-xl max-w-4xl shadow-xs">
        <button 
          onClick={() => setActiveTab('chunks')}
          className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${activeTab === 'chunks' ? 'bg-[#008069] text-white shadow-xs' : 'text-[#54656f] hover:text-[#111b21]'}`}
        >
          Reference Chunks ({chunks.length})
        </button>
        <button 
          onClick={() => setActiveTab('upload')}
          className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${activeTab === 'upload' ? 'bg-[#008069] text-white shadow-xs' : 'text-[#54656f] hover:text-[#111b21]'}`}
        >
          Add FAQ & Documents
        </button>
        <button 
          onClick={() => setActiveTab('harvesting')}
          className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${activeTab === 'harvesting' ? 'bg-[#008069] text-white shadow-xs' : 'text-[#54656f] hover:text-[#111b21]'}`}
        >
          AI Chat Scraper
        </button>
        <button 
          onClick={() => setActiveTab('staging')}
          className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${activeTab === 'staging' ? 'bg-[#008069] text-white shadow-xs' : 'text-[#54656f] hover:text-[#111b21]'}`}
        >
          Staging Reviewer ({medicalStaging.length + generalStaging.length})
        </button>
        <button 
          onClick={() => setActiveTab('existing_use_case')}
          className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${activeTab === 'existing_use_case' ? 'bg-[#008069] text-white shadow-xs' : 'text-[#54656f] hover:text-[#111b21]'}`}
        >
          Sudah Ada Use Case ({existingMatches.length})
        </button>
        <button 
          onClick={() => setActiveTab('unanswered')}
          className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${activeTab === 'unanswered' ? 'bg-[#008069] text-white shadow-xs' : 'text-[#54656f] hover:text-[#111b21]'}`}
        >
          Unanswered Log ({unansweredList.length})
        </button>
      </div>

      {/* Content View */}
      {activeTab === 'chunks' ? (
        <div className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader className="animate-spin text-[#008069]" size={32} />
            </div>
          ) : chunks.length === 0 ? (
            <div className="bg-white border border-[#e9edef] rounded-2xl p-12 text-center text-[#667781] text-xs shadow-xs">
              <BookOpen className="mx-auto text-[#8696a0] mb-3" size={36} />
              <p>Belum ada data knowledge base reference chunks yang tersimpan.</p>
              <button 
                onClick={() => setActiveTab('upload')} 
                className="mt-3 px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition shadow-xs"
              >
                + Tambah Knowledge Base
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {chunks.map((chunk) => {
                const isEditing = editingChunkId === chunk.id;
                return (
                  <div key={chunk.id} className="bg-white rounded-2xl p-5 border border-[#e9edef] shadow-xs flex flex-col justify-between space-y-3">
                    {isEditing ? (
                      <div className="space-y-3">
                        <div className="flex justify-between items-center pb-2 border-b border-[#e9edef]">
                          <span className="text-xs font-bold text-[#008069]">Edit FAQ Reference Chunk</span>
                          <span className="text-[10px] text-[#8696a0] font-mono">ID: {chunk.id.substring(0, 8)}</span>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-bold text-[#111b21]">Judul / Pertanyaan FAQ</label>
                          <input
                            type="text"
                            value={editingChunkTitle}
                            onChange={(e) => setEditingChunkTitle(e.target.value)}
                            className="w-full p-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-bold text-[#111b21]">Konten Jawaban Lengkap</label>
                          <textarea
                            rows={5}
                            value={editingChunkContent}
                            onChange={(e) => setEditingChunkContent(e.target.value)}
                            className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] leading-relaxed resize-none shadow-xs"
                          />
                        </div>
                        <div className="flex justify-end space-x-2 pt-2 border-t border-[#e9edef]">
                          <button
                            type="button"
                            onClick={() => setEditingChunkId(null)}
                            className="px-3 py-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] text-xs font-semibold transition"
                          >
                            Batal
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveChunkEditFromMatch(chunk.id)}
                            disabled={chunkSaveLoading}
                            className="px-3.5 py-1.5 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold transition flex items-center space-x-1 disabled:opacity-50 shadow-xs"
                          >
                            <Save size={13} />
                            <span>{chunkSaveLoading ? 'Menyimpan...' : 'Simpan FAQ'}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            chunk.source_type === 'FAQ' ? 'bg-purple-100 text-purple-800 border border-purple-200' : 'bg-sky-100 text-sky-800 border border-sky-200'
                          }`}>
                            {chunk.source_type}
                          </span>
                          <div className="flex items-center space-x-1.5">
                            <span className="text-[10px] text-[#8696a0] mr-1">
                              {new Date(chunk.created_at).toLocaleDateString()}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingChunkId(chunk.id);
                                setEditingChunkTitle(chunk.title);
                                setEditingChunkContent(chunk.content);
                              }}
                              className="px-2 py-1 rounded-lg bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] hover:text-[#111b21] text-[10px] font-bold transition flex items-center space-x-1 shadow-xs"
                              title="Edit FAQ Ini"
                            >
                              <Edit3 size={11} />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteChunk(chunk.id)}
                              className="p-1 rounded-lg bg-white hover:bg-rose-50 border border-[#d1d7db] text-rose-600 hover:text-rose-700 transition shadow-xs"
                              title="Hapus FAQ"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        <h4 className="font-bold text-[#111b21] text-xs leading-snug">{chunk.title}</h4>
                        <p className="text-xs text-[#54656f] leading-relaxed whitespace-pre-wrap">
                          {chunk.content}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : activeTab === 'upload' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* FAQ Uploader */}
          <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-4 shadow-xs">
            <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
              <HelpCircle className="text-[#008069]" size={16} />
              <span>Tambah FAQ Q&A Item</span>
            </h3>

            <form onSubmit={handleAddFaq} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-[#111b21]">Pertanyaan</label>
                <input
                  type="text"
                  required
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Contoh: Apakah bisa pijat bayi saat demam?"
                  className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-[#111b21]">Jawaban / Respons Lengkap</label>
                <textarea
                  required
                  rows={4}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Halo Bunda, untuk pijat bayi sebaiknya dihindari saat bayi demam tinggi ya bund..."
                  className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] resize-none leading-relaxed shadow-xs"
                />
              </div>

              <button
                type="submit"
                disabled={formSubmitting}
                className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs"
              >
                <Plus size={13} />
                <span>{formSubmitting ? 'Menyimpan...' : 'Tambah FAQ Chunk'}</span>
              </button>
            </form>
          </div>

          {/* SOP Document Chunk Parser */}
          <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-4 shadow-xs">
            <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
              <FileText className="text-[#008069]" size={16} />
              <span>Upload Dokumen SOP / Panduan</span>
            </h3>

            <form onSubmit={handleUploadDoc} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-[#111b21]">Nama Dokumen</label>
                <input
                  type="text"
                  required
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                  placeholder="SOP_Pijat_Bayi.txt"
                  className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-[#111b21]">Isi Dokumen (Raw Text)</label>
                <textarea
                  required
                  rows={4}
                  value={docContent}
                  onChange={(e) => setDocContent(e.target.value)}
                  placeholder="Tempel teks panduan / SOP klinik di sini. Sistem akan otomatis membagi dokumen menjadi potongan chunks terstruktur..."
                  className="w-full p-2.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] resize-none leading-relaxed shadow-xs"
                />
              </div>

              <button
                type="submit"
                disabled={uploadSubmitting}
                className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs"
              >
                <UploadCloud size={13} />
                <span>{uploadSubmitting ? 'Memproses Chunks...' : 'Parse & Import Dokumen'}</span>
              </button>
            </form>
          </div>

        </div>
      ) : activeTab === 'harvesting' ? (
        <div className="space-y-6">
          {/* Sync Status / Empty State Banners */}
          {syncStatus.isSyncing && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between text-xs text-amber-800 animate-pulse">
              <div className="flex items-center space-x-2">
                <Loader className="animate-spin text-amber-600 shrink-0" size={16} />
                <span>
                  <strong>Sinkronisasi riwayat WhatsApp sedang berlangsung di latar belakang...</strong> AI Chat Scraper
                  dikunci sementara hingga sinkronisasi selesai.
                </span>
              </div>
            </div>
          )}

          {!syncStatus.isSyncing && localStats.conversationCount === 0 && (
            <div className="p-4 bg-sky-50 border border-sky-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-sky-900">
              <div>
                <p className="font-bold text-sky-950">Database percakapan lokal masih kosong</p>
                <p className="text-sky-750 mt-0.5">
                  Jalankan "Sync Riwayat WhatsApp" di Live Chat Monitor terlebih dahulu untuk menyedot chat ke database lokal sebelum melakukan panen FAQ.
                </p>
              </div>
              <a
                href="/admin/live-chat"
                className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-bold transition shadow-xs whitespace-nowrap"
              >
                Buka Live Chat Monitor &rarr;
              </a>
            </div>
          )}

          <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-5 shadow-xs">
            <div className="flex justify-between items-start md:items-center pb-4 border-b border-[#e9edef] flex-col md:flex-row gap-3">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
                  <Download className="text-[#008069]" size={16} />
                  <span>AI Chat Scraper & Staging Harvester (Lokal)</span>
                </h3>
                <p className="text-xs text-[#667781] max-w-xl">
                  Ekstrak dialog tanya-jawab dari database lokal ({localStats.conversationCount} chat), bersihkan PII nomor HP secara otomatis, dan staging sebagai kandidat FAQ baru dengan DeepSeek AI.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleDownloadRawChatDump}
                  className="px-3 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs"
                  title="Unduh berkas JSON transkrip percakapan mentah (raw dump)"
                >
                  <FileText size={13} className="text-[#008069]" />
                  <span>Download Raw Dump (.json)</span>
                </button>
                <button
                  onClick={handleResetStaging}
                  className="px-3 py-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs"
                  title="Hapus data PENDING staging lama yang terbalik"
                >
                  <Trash2 size={13} />
                  <span>Reset Staging Terbalik</span>
                </button>
                <button
                  onClick={handleStartHarvest}
                  disabled={harvestJob?.status === 'PROCESSING' || harvestLoading || syncStatus.isSyncing || localStats.conversationCount === 0}
                  className="px-3.5 py-2 bg-[#008069] hover:bg-[#00a884] disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs"
                  title={
                    syncStatus.isSyncing
                      ? 'Sinkronisasi WhatsApp sedang berjalan'
                      : localStats.conversationCount === 0
                      ? 'Database percakapan lokal masih kosong'
                      : 'Mulai panen FAQ dari database lokal'
                  }
                >
                  {harvestJob?.status === 'PROCESSING' ? (
                    <>
                      <RefreshCw className="animate-spin" size={13} />
                      <span>Harvesting...</span>
                    </>
                  ) : (
                    <>
                      <Play size={13} />
                      <span>Mulai Scraping Chat</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* If there's an active or finished job, show progress & stats */}
            {harvestJob && harvestJob.status !== 'IDLE' && (
              <div className="space-y-4">
                
                {/* Progress bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-bold text-[#111b21]">
                    <span>Status Scraping: {harvestJob.status}</span>
                    <span className="text-[#008069]">{harvestJob.progressPercent}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#f0f2f5] overflow-hidden border border-[#e9edef]">
                    <div 
                      className="h-full bg-[#008069] transition-all duration-500 rounded-full"
                      style={{ width: `${harvestJob.progressPercent}%` }}
                    ></div>
                  </div>
                </div>

                {/* Stats cards grid */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef] text-center">
                    <span className="text-[10px] text-[#667781] font-bold block uppercase mb-0.5">Chats Scanned</span>
                    <span className="text-base font-bold text-[#111b21]">{harvestJob.totalChatsScanned}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef] text-center">
                    <span className="text-[10px] text-[#667781] font-bold block uppercase mb-0.5">Msgs Scanned</span>
                    <span className="text-base font-bold text-[#111b21]">{harvestJob.totalMessagesScanned}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef] text-center">
                    <span className="text-[10px] text-[#667781] font-bold block uppercase mb-0.5">General Staged</span>
                    <span className="text-base font-bold text-[#008069]">{harvestJob.generalStagedCount}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef] text-center">
                    <span className="text-[10px] text-[#667781] font-bold block uppercase mb-0.5">Medical Staged</span>
                    <span className="text-base font-bold text-purple-700">{harvestJob.medicalStagedCount}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef] text-center">
                    <span className="text-[10px] text-[#667781] font-bold block uppercase mb-0.5">Leads Extracted</span>
                    <span className="text-base font-bold text-sky-700">{harvestJob.legacyLeadsExtractedCount}</span>
                  </div>
                </div>

                {harvestJob.status === 'FAILED' && harvestJob.errorMessage && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-mono">
                    <span className="font-bold">Error:</span> {harvestJob.errorMessage}
                  </div>
                )}

                {harvestJob.status === 'COMPLETED' && (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center space-x-2">
                    <CheckCircle size={14} className="text-emerald-600" />
                    <span>Scraping percakapan selesai! Draf kandidat FAQ dapat ditinjau pada tab Staging Reviewer.</span>
                  </div>
                )}
              </div>
            )}

            {(!harvestJob || harvestJob.status === 'IDLE') && (
              <div className="text-center py-8 text-[#8696a0] text-xs">
                Belum ada proses scraping chat yang berjalan. Klik tombol di atas untuk memulai penarikan riwayat percakapan dari WAHA.
              </div>
            )}

          </div>
        </div>
      ) : activeTab === 'staging' ? (
        <div className="space-y-4">
          {/* Sub tabs for Staging Reviewer */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-[#e9edef] pb-2 gap-3">
            <div className="flex space-x-4">
              <button
                onClick={() => setStagingTab('medical')}
                className={`pb-2 text-xs font-bold transition-all relative ${stagingTab === 'medical' ? 'text-[#008069] font-extrabold' : 'text-[#54656f] hover:text-[#111b21]'}`}
              >
                Medical Staging ({medicalStaging.length})
                {stagingTab === 'medical' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#008069] rounded-full"></div>}
              </button>
              <button
                onClick={() => setStagingTab('general')}
                className={`pb-2 text-xs font-bold transition-all relative ${stagingTab === 'general' ? 'text-[#008069] font-extrabold' : 'text-[#54656f] hover:text-[#111b21]'}`}
              >
                General Staging ({generalStaging.length})
                {stagingTab === 'general' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#008069] rounded-full"></div>}
              </button>
            </div>

            {(medicalStaging.length > 0 || generalStaging.length > 0) && (
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={handleAnalyzeStagingAI}
                  disabled={analyzingStaging}
                  className="px-2.5 py-1.5 bg-[#e8f5f2] hover:bg-[#c2e7e0] border border-[#c2e7e0] text-[#008069] rounded-xl text-xs font-semibold transition flex items-center space-x-1 disabled:opacity-50 shadow-xs"
                  title="Olah dan rapikan seluruh draf staging dengan AI"
                >
                  <Sparkles size={12} className={analyzingStaging ? 'animate-spin text-[#008069]' : ''} />
                  <span>{analyzingStaging ? 'Menganalisis...' : 'Analisis AI'}</span>
                </button>
                <button
                  onClick={handleExportMarkdown}
                  className="px-2.5 py-1.5 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] rounded-xl text-xs font-semibold transition flex items-center space-x-1 shadow-xs"
                  title="Unduh seluruh kandidat staging dalam format Markdown (.md)"
                >
                  <Download size={12} />
                  <span>Export .md</span>
                </button>
                <button
                  onClick={handleDeleteAllStaging}
                  className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-xl text-xs font-semibold transition flex items-center space-x-1 shadow-xs"
                  title="Hapus seluruh kandidat staging secara permanen"
                >
                  <Trash2 size={12} />
                  <span>Hapus Semua</span>
                </button>
              </div>
            )}
          </div>

          {stagingLoading ? (
            <div className="flex justify-center py-12">
              <Loader className="animate-spin text-[#008069]" size={32} />
            </div>
          ) : (stagingTab === 'medical' ? medicalStaging : generalStaging).length === 0 ? (
            <div className="bg-white border border-[#e9edef] rounded-2xl p-12 text-center text-[#667781] text-xs shadow-xs">
              Tidak ada draf kandidat pada antrian staging ini.
            </div>
          ) : (
            <div className="space-y-4">
              {(stagingTab === 'medical' ? medicalStaging : generalStaging).map((item) => (
                <div key={item.id} className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-3 shadow-xs">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-[#e9edef] pb-2.5 gap-2">
                    <div className="flex items-center space-x-2 text-[10px] font-bold text-[#667781]">
                      <span className="text-[#008069]">PHONE: {item.customer_phone || item.phone || 'N/A'}</span>
                      <span>•</span>
                      <span>STAGED: {new Date(item.created_at).toLocaleString()}</span>
                    </div>
                    <div className="flex space-x-1.5">
                      <button
                        onClick={() => handleStagingReview(item.id, stagingTab, 'APPROVED')}
                        className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-semibold transition flex items-center space-x-1 shadow-xs"
                      >
                        <Check size={12} />
                        <span>Setujui & Simpan</span>
                      </button>
                      <button
                        onClick={() => handleStagingReview(item.id, stagingTab, 'REJECTED')}
                        className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold transition flex items-center space-x-1 shadow-xs"
                      >
                        <AlertCircle size={12} />
                        <span>Tolak</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Raw Message Log */}
                    <div className="p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-2">
                      <div>
                        <span className="text-[10px] text-[#008069] font-bold block uppercase mb-0.5">Pertanyaan Mentah</span>
                        <p className="text-xs text-[#111b21] italic">"{item.raw_question}"</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-purple-700 font-bold block uppercase mb-0.5">Jawaban Mentah</span>
                        <p className="text-xs text-[#54656f] italic">"{item.bidan_raw_reply || item.raw_answer || 'Tidak ada respons mentah'}"</p>
                      </div>
                    </div>

                    {/* General/Clean Editor */}
                    <div className="space-y-2.5">
                      <div className="space-y-1">
                        <label className="text-[10px] text-[#667781] font-bold uppercase">Judul Pertanyaan FAQ</label>
                        <input
                          type="text"
                          value={editedQuestions[item.id] || ''}
                          onChange={(e) => setEditedQuestions(prev => ({ ...prev, [item.id]: e.target.value }))}
                          className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] transition shadow-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-[#667781] font-bold uppercase">Konten Jawaban FAQ</label>
                        <textarea
                          rows={3}
                          value={editedAnswers[item.id] || ''}
                          onChange={(e) => setEditedAnswers(prev => ({ ...prev, [item.id]: e.target.value }))}
                          className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] transition leading-relaxed resize-none shadow-xs"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : activeTab === 'existing_use_case' ? (
        /* Tab: Sudah Ada Use Case */
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl bg-[#e8f5f2] border border-[#c2e7e0] text-[#008069] flex items-start space-x-3 text-xs shadow-xs">
            <CheckCircle className="flex-shrink-0 mt-0.5 text-[#008069]" size={16} />
            <div>
              <p className="font-bold">Pertanyaan Customer yang Sudah Memiliki FAQ Serupa (Match score ≥ 70%)</p>
              <p className="mt-0.5 text-xs text-[#111b21]">
                Sistem deduplikasi otomatis mendeteksi bahwa pertanyaan ini sudah tercakup oleh FAQ yang ada. Anda dapat langsung mengedit jawaban FAQ existing di bawah ini jika penjelasannya perlu diperbarui.
              </p>
            </div>
          </div>

          <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-4 shadow-xs">
            <div className="flex justify-between items-center pb-3 border-b border-[#e9edef]">
              <span className="text-xs font-bold text-[#111b21] uppercase">Daftar Pertanyaan Duplicate & Use Case Existing</span>
              <button 
                onClick={loadExistingMatches}
                className="p-1.5 text-[#667781] hover:text-[#111b21] rounded-lg hover:bg-[#f0f2f5]"
                title="Refresh Queue"
              >
                <RefreshCw size={13} className={stagingLoading ? 'animate-spin text-[#008069]' : ''} />
              </button>
            </div>

            {stagingLoading ? (
              <div className="flex justify-center py-12">
                <Loader className="animate-spin text-[#008069]" size={32} />
              </div>
            ) : existingMatches.length === 0 ? (
              <div className="text-center py-8 text-[#8696a0] text-xs">
                Tidak ada pertanyaan duplicate yang terdeteksi.
              </div>
            ) : (
              <div className="space-y-4">
                {existingMatches.map((item) => (
                  <div key={item.id} className="p-4 rounded-xl bg-[#f8fafc] border border-[#e9edef] space-y-3">
                    <div className="flex justify-between items-center border-b border-[#e9edef] pb-2">
                      <div className="flex items-center space-x-2 text-[10px] font-bold text-[#667781]">
                        <span className="text-[#008069]">CUSTOMER: {item.customer_phone || item.phone || 'N/A'}</span>
                        <span>•</span>
                        <span>DETERMINED: {new Date(item.created_at).toLocaleString()}</span>
                      </div>
                      <div className="px-2 py-0.5 rounded-full bg-[#e8f5f2] border border-[#c2e7e0] text-[#008069] text-[10px] font-bold">
                        SIMILARITY: {Math.round((item.matched_similarity || 0.75) * 100)}%
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Customer Original Question */}
                      <div className="p-3.5 rounded-xl bg-white border border-[#e9edef] space-y-1.5">
                        <span className="text-[10px] text-[#008069] font-bold block uppercase">Pertanyaan Customer Asli</span>
                        <p className="text-xs text-[#111b21] italic">"{item.raw_question}"</p>
                      </div>

                      {/* Matched FAQ Chunk with Direct Edit */}
                      <div className="p-3.5 rounded-xl bg-white border border-[#e9edef] space-y-2.5">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] text-emerald-800 font-bold uppercase">FAQ Existing yang Match</span>
                          {item.matchedChunk && editingChunkId !== item.matchedChunk.id && (
                            <button
                              onClick={() => {
                                setEditingChunkId(item.matchedChunk.id);
                                setEditingChunkTitle(item.matchedChunk.title);
                                setEditingChunkContent(item.matchedChunk.content);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#111b21] text-[10px] font-bold transition flex items-center space-x-1 shadow-xs"
                            >
                              <Edit3 size={11} />
                              <span>Edit FAQ Existing</span>
                            </button>
                          )}
                        </div>

                        {item.matchedChunk ? (
                          editingChunkId === item.matchedChunk.id ? (
                            <div className="space-y-2 pt-1">
                              <input
                                type="text"
                                value={editingChunkTitle}
                                onChange={(e) => setEditingChunkTitle(e.target.value)}
                                className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-1.5 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                              />
                              <textarea
                                rows={3}
                                value={editingChunkContent}
                                onChange={(e) => setEditingChunkContent(e.target.value)}
                                className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] resize-none shadow-xs"
                              />
                              <div className="flex space-x-2 justify-end">
                                <button
                                  onClick={() => setEditingChunkId(null)}
                                  className="px-2.5 py-1 rounded-lg bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] text-xs font-semibold"
                                >
                                  Batal
                                </button>
                                <button
                                  onClick={() => handleSaveChunkEditFromMatch(item.matchedChunk.id)}
                                  disabled={chunkSaveLoading}
                                  className="px-3 py-1 rounded-lg bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold shadow-xs"
                                >
                                  Simpan Perubahan
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <p className="text-xs font-bold text-[#111b21] mb-1">{item.matchedChunk.title}</p>
                              <p className="text-xs text-[#54656f] whitespace-pre-wrap">{item.matchedChunk.content}</p>
                            </div>
                          )
                        ) : (
                          <div className="text-xs text-[#8696a0] italic">
                            Data reference chunk match: [ID: {item.matched_chunk_id || 'N/A'}]
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Unanswered Log Panel */
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start space-x-3 text-xs shadow-xs">
            <HelpCircle className="flex-shrink-0 mt-0.5 text-amber-700" size={16} />
            <div>
              <p className="font-bold">Live Unanswered Questions (Log Pertanyaan Tertunda)</p>
              <p className="mt-0.5 text-xs text-amber-800">
                Pertanyaan-pertanyaan di bawah ini diajukan oleh customer asli tetapi bot tidak dapat menjawabnya (RAG low similarity) sehingga ter-eskalasi ke human. Isi jawaban di bawah untuk membalas customer dan menyimpannya langsung ke database FAQ secara real-time.
              </p>
            </div>
          </div>

          <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-4 shadow-xs">
            <div className="flex justify-between items-center pb-3 border-b border-[#e9edef]">
              <span className="text-xs font-bold text-[#111b21] uppercase">Log Pertanyaan Tertunda (Real-time Queue)</span>
              <button 
                onClick={loadUnansweredData}
                className="p-1.5 text-[#667781] hover:text-[#111b21] rounded-lg hover:bg-[#f0f2f5]"
                title="Refresh Queue"
              >
                <RefreshCw size={13} className={unansweredLoading ? 'animate-spin text-[#008069]' : ''} />
              </button>
            </div>

            {unansweredLoading ? (
              <div className="flex justify-center py-12">
                <Loader className="animate-spin text-[#008069]" size={32} />
              </div>
            ) : unansweredList.length === 0 ? (
              <div className="text-center py-8 text-[#8696a0] text-xs">
                Tidak ada pertanyaan tertunda yang butuh dijawab. Semua percakapan berjalan lancar!
              </div>
            ) : (
              <div className="space-y-3">
                {unansweredList.map((item) => (
                  <div key={item.id} className="p-4 rounded-xl bg-[#f8fafc] border border-[#e9edef] flex flex-col space-y-2.5">
                    <div className="flex justify-between items-start md:items-center flex-col md:flex-row gap-2 border-b border-[#e9edef] pb-2">
                      <div>
                        <span className="text-xs text-[#008069] font-bold block mb-0.5">Bunda {item.name} ({item.phone})</span>
                        <span className="text-[10px] text-[#8696a0]">Diajukan: {new Date(item.createdAt).toLocaleString()}</span>
                      </div>
                      {activeUnansweredId !== item.id && (
                        <button
                          onClick={() => {
                            setActiveUnansweredId(item.id);
                            setUnansweredAnswer('');
                          }}
                          className="px-3 py-1.5 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-semibold transition flex items-center space-x-1 shadow-xs"
                        >
                          <Plus size={12} />
                          <span>Jawab & Simpan ke FAQ</span>
                        </button>
                      )}
                    </div>

                    <div className="bg-white p-3 rounded-xl border border-[#e9edef]">
                      <p className="text-xs text-[#111b21]">"{item.question}"</p>
                    </div>

                    {activeUnansweredId === item.id && (
                      <div className="space-y-2.5 pt-2">
                        <div className="space-y-1">
                          <label className="text-[10px] text-[#667781] font-bold uppercase">Jawaban Bidan/Admin</label>
                          <textarea
                            rows={3}
                            placeholder="Tulis jawaban di sini... (Akan langsung terkirim ke customer dan disimpan ke FAQ)"
                            value={unansweredAnswer}
                            onChange={(e) => setUnansweredAnswer(e.target.value)}
                            className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] transition resize-none shadow-xs"
                          />
                        </div>
                        <div className="flex space-x-2 justify-end">
                          <button
                            onClick={() => setActiveUnansweredId(null)}
                            className="px-3 py-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] text-xs font-semibold transition"
                          >
                            Batal
                          </button>
                          <button
                            onClick={() => handleResolveUnanswered(item.id)}
                            className="px-3.5 py-1.5 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold transition flex items-center space-x-1 shadow-xs"
                          >
                            <Check size={12} />
                            <span>Kirim Jawaban</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Toast Notification Container */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col space-y-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`px-4 py-3 rounded-xl shadow-lg border text-xs font-bold pointer-events-auto transition-all ${
              t.type === 'success' 
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                : t.type === 'error' 
                  ? 'bg-rose-50 text-rose-800 border-rose-200' 
                  : 'bg-white text-[#111b21] border-[#e9edef]'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>

    </div>
  );
};
