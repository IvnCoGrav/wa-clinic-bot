import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
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
  Trash2
} from 'lucide-react';

export const KnowledgeBase: React.FC = () => {
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
          const stats = await apiRequest('/api/admin/harvest/status');
          setHarvestJob(stats.data);
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
        const stats = await apiRequest('/api/admin/harvest/status');
        setHarvestJob(stats.data);
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
        body: JSON.stringify({})
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
    if (!window.confirm('Apakah Anda yakin ingin menghapus FAQ Reference Chunk ini? Perubahan ini bersifat permanen.')) return;
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
      alert('FAQ added successfully!');
      setQuestion('');
      setAnswer('');
      loadChunks();
    } catch (err: any) {
      alert(`Failed to add FAQ: ${err.message}`);
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
      alert('SOP document parsed and saved successfully!');
      setDocName('');
      setDocContent('');
      loadChunks();
    } catch (err: any) {
      alert(`Failed to parse document: ${err.message}`);
    } finally {
      setUploadSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white">Knowledge Base Manager</h2>
        <p className="text-slate-400">Manage FAQ questions and upload SOP documents for AI reference context</p>
      </div>

      {/* Tabs Menu */}
      <div className="flex space-x-2 p-1 bg-slate-900/60 border border-white/5 rounded-xl max-w-4xl">
        <button 
          onClick={() => setActiveTab('chunks')}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${activeTab === 'chunks' ? 'bg-pink-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}
        >
          Reference Chunks ({chunks.length})
        </button>
        <button 
          onClick={() => setActiveTab('upload')}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${activeTab === 'upload' ? 'bg-pink-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}
        >
          Add FAQ & Documents
        </button>
        <button 
          onClick={() => setActiveTab('harvesting')}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${activeTab === 'harvesting' ? 'bg-pink-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}
        >
          AI Chat Scraper
        </button>
        <button 
          onClick={() => setActiveTab('staging')}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${activeTab === 'staging' ? 'bg-pink-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}
        >
          Staging Reviewer ({medicalStaging.length + generalStaging.length})
        </button>
        <button 
          onClick={() => setActiveTab('existing_use_case')}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${activeTab === 'existing_use_case' ? 'bg-pink-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}
        >
          Sudah Ada Use Case ({existingMatches.length})
        </button>
        <button 
          onClick={() => setActiveTab('unanswered')}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${activeTab === 'unanswered' ? 'bg-pink-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}
        >
          Unanswered Log ({unansweredList.length})
        </button>
      </div>

      {/* Content View */}
      {activeTab === 'chunks' ? (
        <div className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader className="animate-spin text-pink-500" size={32} />
            </div>
          ) : chunks.length === 0 ? (
            <div className="glass-panel border border-white/5 rounded-2xl p-12 text-center text-slate-500 text-sm">
              <BookOpen className="mx-auto text-slate-600 mb-3" size={36} />
              <p>No knowledge base reference chunks loaded yet.</p>
              <button 
                onClick={() => setActiveTab('upload')} 
                className="mt-4 px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition"
              >
                Add Knowledge Now
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {chunks.map((chunk) => {
                const isEditing = editingChunkId === chunk.id;
                return (
                  <div key={chunk.id} className="glass-card rounded-2xl p-6 border border-white/5 flex flex-col justify-between space-y-4">
                    {isEditing ? (
                      <div className="space-y-4">
                        <div className="flex justify-between items-center pb-2 border-b border-white/5">
                          <span className="text-xs font-bold text-pink-400">Edit FAQ Reference Chunk</span>
                          <span className="text-[10px] text-slate-500 font-mono">ID: {chunk.id.substring(0, 8)}</span>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs text-slate-400 font-semibold">Judul / Pertanyaan FAQ</label>
                          <input
                            type="text"
                            value={editingChunkTitle}
                            onChange={(e) => setEditingChunkTitle(e.target.value)}
                            className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-pink-500"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs text-slate-400 font-semibold">Konten Jawaban Lengkap</label>
                          <textarea
                            rows={5}
                            value={editingChunkContent}
                            onChange={(e) => setEditingChunkContent(e.target.value)}
                            className="w-full p-3 bg-slate-950 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-pink-500 leading-relaxed font-sans"
                          />
                        </div>
                        <div className="flex justify-end space-x-2 pt-2">
                          <button
                            type="button"
                            onClick={() => setEditingChunkId(null)}
                            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition flex items-center space-x-1"
                          >
                            <X size={14} />
                            <span>Batal</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveChunkEditFromMatch(chunk.id)}
                            disabled={chunkSaveLoading}
                            className="px-3 py-1.5 rounded-lg bg-pink-500 hover:bg-pink-600 text-white text-xs font-bold transition flex items-center space-x-1 disabled:opacity-50"
                          >
                            <Save size={14} />
                            <span>{chunkSaveLoading ? 'Menyimpan...' : 'Simpan FAQ'}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            chunk.source_type === 'FAQ' ? 'bg-purple-500/10 text-purple-400' : 'bg-blue-500/10 text-blue-400'
                          }`}>
                            {chunk.source_type}
                          </span>
                          <div className="flex items-center space-x-2">
                            <span className="text-[10px] text-slate-500 mr-1">
                              {new Date(chunk.created_at).toLocaleDateString()}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingChunkId(chunk.id);
                                setEditingChunkTitle(chunk.title);
                                setEditingChunkContent(chunk.content);
                              }}
                              className="px-2 py-1 rounded bg-white/5 hover:bg-pink-500/10 text-slate-400 hover:text-pink-400 text-[10px] font-bold transition flex items-center space-x-1"
                              title="Edit FAQ Ini"
                            >
                              <Edit3 size={11} />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteChunk(chunk.id)}
                              className="p-1 rounded bg-white/5 hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 transition"
                              title="Hapus FAQ"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>
                        <h4 className="font-bold text-white text-sm leading-snug">{chunk.title}</h4>
                        <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* FAQ Uploader */}
          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-6">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <HelpCircle className="text-pink-400" />
              <span>Add FAQ Q&A Item</span>
            </h3>

            <form onSubmit={handleAddFaq} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-semibold">Question</label>
                <input
                  type="text"
                  required
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Apakah bisa pijat bayi saat demam?"
                  className="w-full p-3 bg-slate-950 border border-white/5 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-semibold">Answer Response</label>
                <textarea
                  required
                  rows={4}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Halo Bunda, untuk pijat bayi sebaiknya dihindari saat bayi demam tinggi ya bund..."
                  className="w-full p-3 bg-slate-950 border border-white/5 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={formSubmitting}
                className="px-4 py-2.5 bg-pink-500 hover:bg-pink-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center space-x-2"
              >
                <Plus size={14} />
                <span>{formSubmitting ? 'Saving...' : 'Add FAQ Chunk'}</span>
              </button>
            </form>
          </div>

          {/* SOP Document Chunk Parser */}
          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-6">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <FileText className="text-pink-400" />
              <span>Upload SOP / PDF Chunker</span>
            </h3>

            <form onSubmit={handleUploadDoc} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-semibold">Document Name</label>
                <input
                  type="text"
                  required
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                  placeholder="SOP_Pijat_Kala_Spa.txt"
                  className="w-full p-3 bg-slate-950 border border-white/5 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-semibold">Document Content (Raw Text)</label>
                <textarea
                  required
                  rows={4}
                  value={docContent}
                  onChange={(e) => setDocContent(e.target.value)}
                  placeholder="Paste rules/regulations or SOP descriptions here. The system will automatically chunk and save this text..."
                  className="w-full p-3 bg-slate-950 border border-white/5 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={uploadSubmitting}
                className="px-4 py-2.5 bg-pink-500 hover:bg-pink-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center space-x-2"
              >
                <UploadCloud size={14} />
                <span>{uploadSubmitting ? 'Processing Chunks...' : 'Parse & Import Document'}</span>
              </button>
            </form>
          </div>

        </div>
      ) : activeTab === 'harvesting' ? (
        <div className="space-y-6">
          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-6">
            <div className="flex justify-between items-start md:items-center pb-4 border-b border-white/5 flex-col md:flex-row gap-4">
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white flex items-center space-x-2">
                  <Download className="text-pink-400" />
                  <span>AI Chat Scraper & Staging Harvester</span>
                </h3>
                <p className="text-xs text-slate-400 max-w-xl">
                  Scrape historical WhatsApp chats from WAHA, scrub PII automatically, filter junk messages, and stage them as training FAQ candidates.
                </p>
              </div>

              <button
                onClick={handleStartHarvest}
                disabled={harvestJob?.status === 'PROCESSING' || harvestLoading}
                className="px-4 py-2.5 bg-pink-500 hover:bg-pink-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5"
              >
                {harvestJob?.status === 'PROCESSING' ? (
                  <>
                    <RefreshCw className="animate-spin" size={14} />
                    <span>Harvesting...</span>
                  </>
                ) : (
                  <>
                    <Play size={14} />
                    <span>Start Scraping Chats</span>
                  </>
                )}
              </button>
            </div>

            {/* If there's an active or finished job, show progress & stats */}
            {harvestJob && harvestJob.status !== 'IDLE' && (
              <div className="space-y-6">
                
                {/* Progress bar */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-300">Scraping Progress: {harvestJob.status}</span>
                    <span className="text-pink-400">{harvestJob.progressPercent}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden border border-white/5">
                    <div 
                      className="h-full bg-gradient-to-r from-pink-500 to-violet-500 transition-all duration-500"
                      style={{ width: `${harvestJob.progressPercent}%` }}
                    ></div>
                  </div>
                </div>

                {/* Stats cards grid */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="p-4 rounded-xl bg-slate-950 border border-white/5 text-center">
                    <span className="text-[10px] text-slate-500 font-bold block uppercase mb-1">Chats Scanned</span>
                    <span className="text-lg font-bold text-white">{harvestJob.totalChatsScanned}</span>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-950 border border-white/5 text-center">
                    <span className="text-[10px] text-slate-500 font-bold block uppercase mb-1">Msgs Scanned</span>
                    <span className="text-lg font-bold text-white">{harvestJob.totalMessagesScanned}</span>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-950 border border-white/5 text-center">
                    <span className="text-[10px] text-slate-500 font-bold block uppercase mb-1">General Staged</span>
                    <span className="text-lg font-bold text-emerald-400">{harvestJob.generalStagedCount}</span>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-950 border border-white/5 text-center">
                    <span className="text-[10px] text-slate-500 font-bold block uppercase mb-1">Medical Staged</span>
                    <span className="text-lg font-bold text-violet-400">{harvestJob.medicalStagedCount}</span>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-950 border border-white/5 text-center">
                    <span className="text-[10px] text-slate-500 font-bold block uppercase mb-1">Leads Extracted</span>
                    <span className="text-lg font-bold text-pink-400">{harvestJob.legacyLeadsExtractedCount}</span>
                  </div>
                </div>

                {harvestJob.status === 'FAILED' && harvestJob.errorMessage && (
                  <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-mono">
                    <span className="font-bold">Error:</span> {harvestJob.errorMessage}
                  </div>
                )}

                {harvestJob.status === 'COMPLETED' && (
                  <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center space-x-2">
                    <CheckCircle size={14} />
                    <span>Chat scraping completed successfully! Staged FAQ items can be reviewed under the "3-Table Staging Reviewer" control panel.</span>
                  </div>
                )}
              </div>
            )}

            {(!harvestJob || harvestJob.status === 'IDLE') && (
              <div className="text-center py-10 text-slate-500 text-xs">
                No scraping jobs executed in this session. Click the button above to begin fetching history from WAHA.
              </div>
            )}

          </div>
        </div>
      ) : activeTab === 'staging' ? (
        <div className="space-y-6">
          {/* Sub tabs for Staging Reviewer */}
          <div className="flex border-b border-white/5 space-x-6">
            <button
              onClick={() => setStagingTab('medical')}
              className={`pb-3 text-xs font-bold transition-all relative ${stagingTab === 'medical' ? 'text-pink-400 font-extrabold' : 'text-slate-400 hover:text-white'}`}
            >
              Medical Staging ({medicalStaging.length})
              {stagingTab === 'medical' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-pink-500 rounded-full"></div>}
            </button>
            <button
              onClick={() => setStagingTab('general')}
              className={`pb-3 text-xs font-bold transition-all relative ${stagingTab === 'general' ? 'text-pink-400 font-extrabold' : 'text-slate-400 hover:text-white'}`}
            >
              General Staging ({generalStaging.length})
              {stagingTab === 'general' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-pink-500 rounded-full"></div>}
            </button>
          </div>

          {stagingLoading ? (
            <div className="flex justify-center py-12">
              <Loader className="animate-spin text-pink-500" size={32} />
            </div>
          ) : (stagingTab === 'medical' ? medicalStaging : generalStaging).length === 0 ? (
            <div className="glass-panel border border-white/5 rounded-2xl p-12 text-center text-slate-500 text-xs">
              No pending candidates in this staging queue. Run the AI Chat Scraper to harvest new candidates.
            </div>
          ) : (
            <div className="space-y-6">
              {(stagingTab === 'medical' ? medicalStaging : generalStaging).map((item) => (
                <div key={item.id} className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-white/5 pb-3 gap-2">
                    <div className="flex items-center space-x-2 text-[10px] font-bold text-slate-400">
                      <span className="text-pink-400">PHONE: {item.customer_phone || item.phone || 'N/A'}</span>
                      <span>•</span>
                      <span>STAGED AT: {new Date(item.created_at).toLocaleString()}</span>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleStagingReview(item.id, stagingTab, 'APPROVED')}
                        className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-white border border-emerald-500/20 rounded-xl text-[10px] font-bold transition flex items-center space-x-1"
                      >
                        <Check size={10} />
                        <span>Approve & Save</span>
                      </button>
                      <button
                        onClick={() => handleStagingReview(item.id, stagingTab, 'REJECTED')}
                        className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white border border-rose-500/20 rounded-xl text-[10px] font-bold transition flex items-center space-x-1"
                      >
                        <AlertCircle size={10} />
                        <span>Reject</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Raw Message Log */}
                    <div className="p-4 rounded-xl bg-slate-950/60 border border-white/5 space-y-3">
                      <div>
                        <span className="text-[10px] text-pink-400 font-bold block uppercase mb-1">Raw Scanned Question</span>
                        <p className="text-xs text-slate-300 italic">"{item.raw_question}"</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-violet-400 font-bold block uppercase mb-1">Raw Scanned Reply</span>
                        <p className="text-xs text-slate-300 italic">"{item.bidan_raw_reply || item.raw_answer || 'No raw reply'}"</p>
                      </div>
                    </div>

                    {/* General/Clean Editor */}
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 font-bold uppercase">Edited Question (FAQ Title)</label>
                        <input
                          type="text"
                          value={editedQuestions[item.id] || ''}
                          onChange={(e) => setEditedQuestions(prev => ({ ...prev, [item.id]: e.target.value }))}
                          className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-pink-500 transition"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 font-bold uppercase">Edited Answer (FAQ Content)</label>
                        <textarea
                          rows={3}
                          value={editedAnswers[item.id] || ''}
                          onChange={(e) => setEditedAnswers(prev => ({ ...prev, [item.id]: e.target.value }))}
                          className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-pink-500 transition"
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
        <div className="space-y-6">
          <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-300 flex items-start space-x-3 text-sm">
            <CheckCircle className="flex-shrink-0 mt-0.5 text-violet-400" size={20} />
            <div>
              <p className="font-bold">Pertanyaan Customer yang Sudah Memiliki FAQ Serupa (Match score ≥ 70%)</p>
              <p className="mt-1 text-xs text-violet-300/80">
                Sistem deduplikasi otomatis mendeteksi bahwa pertanyaan-pertanyaan ini sudah tercakup oleh FAQ resmi yang ada. Anda dapat langsung mengedit jawaban FAQ existing di bawah ini jika perjelasannya perlu diperbarui.
              </p>
            </div>
          </div>

          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
            <div className="flex justify-between items-center pb-4 border-b border-white/5">
              <span className="text-sm font-bold text-white">Daftar Pertanyaan Duplicate & Use Case Existing</span>
              <button 
                onClick={loadExistingMatches}
                className="p-1 text-slate-400 hover:text-white"
                title="Refresh Queue"
              >
                <RefreshCw size={14} className={stagingLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            {stagingLoading ? (
              <div className="flex justify-center py-12">
                <Loader className="animate-spin text-pink-500" size={32} />
              </div>
            ) : existingMatches.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-xs">
                Tidak ada pertanyaan duplicate yang terdeteksi sejauh ini.
              </div>
            ) : (
              <div className="space-y-6">
                {existingMatches.map((item) => (
                  <div key={item.id} className="p-5 rounded-2xl bg-slate-950 border border-white/5 space-y-4">
                    <div className="flex justify-between items-center border-b border-white/5 pb-3">
                      <div className="flex items-center space-x-2 text-[10px] font-bold text-slate-400">
                        <span className="text-pink-400">CUSTOMER: {item.customer_phone || item.phone || 'N/A'}</span>
                        <span>•</span>
                        <span>DETERMINED AT: {new Date(item.created_at).toLocaleString()}</span>
                      </div>
                      <div className="px-2.5 py-1 rounded-full bg-violet-500/20 border border-violet-500/40 text-violet-300 text-[10px] font-extrabold">
                        SIMILARITY SCORE: {Math.round((item.matched_similarity || 0.75) * 100)}%
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Customer Original Question */}
                      <div className="p-4 rounded-xl bg-slate-900/60 border border-white/5 space-y-2">
                        <span className="text-[10px] text-pink-400 font-bold block uppercase">Pertanyaan Customer Asli</span>
                        <p className="text-xs text-slate-200 italic">"{item.raw_question}"</p>
                      </div>

                      {/* Matched FAQ Chunk with Direct Edit */}
                      <div className="p-4 rounded-xl bg-slate-900/60 border border-white/5 space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] text-emerald-400 font-bold uppercase">FAQ Existing yang Match</span>
                          {item.matchedChunk && editingChunkId !== item.matchedChunk.id && (
                            <button
                              onClick={() => {
                                setEditingChunkId(item.matchedChunk.id);
                                setEditingChunkTitle(item.matchedChunk.title);
                                setEditingChunkContent(item.matchedChunk.content);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-pink-500/20 hover:bg-pink-500 text-pink-300 hover:text-white border border-pink-500/30 text-[10px] font-bold transition flex items-center space-x-1"
                            >
                              <Edit3 size={10} />
                              <span>Edit FAQ Existing</span>
                            </button>
                          )}
                        </div>

                        {item.matchedChunk ? (
                          editingChunkId === item.matchedChunk.id ? (
                            <div className="space-y-3 pt-1">
                              <input
                                type="text"
                                value={editingChunkTitle}
                                onChange={(e) => setEditingChunkTitle(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white"
                              />
                              <textarea
                                rows={3}
                                value={editingChunkContent}
                                onChange={(e) => setEditingChunkContent(e.target.value)}
                                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                              />
                              <div className="flex space-x-2 justify-end">
                                <button
                                  onClick={() => setEditingChunkId(null)}
                                  className="px-2.5 py-1 rounded-lg bg-white/5 text-slate-400 text-xs"
                                >
                                  Batal
                                </button>
                                <button
                                  onClick={() => handleSaveChunkEditFromMatch(item.matchedChunk.id)}
                                  disabled={chunkSaveLoading}
                                  className="px-3 py-1 rounded-lg bg-pink-500 text-white text-xs font-bold"
                                >
                                  Simpan Perubahan
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <p className="text-xs font-bold text-white mb-1">{item.matchedChunk.title}</p>
                              <p className="text-xs text-slate-300 whitespace-pre-wrap">{item.matchedChunk.content}</p>
                            </div>
                          )
                        ) : (
                          <div className="text-xs text-slate-500 italic">
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
        <div className="space-y-6">
          <div className="p-4 rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-400 flex items-start space-x-3 text-sm">
            <HelpCircle className="flex-shrink-0 mt-0.5" size={20} />
            <div>
              <p className="font-bold">Live Unanswered Questions (Log Pertanyaan Tertunda)</p>
              <p className="mt-1 text-xs text-pink-500/80">
                Pertanyaan-pertanyaan di bawah ini diajukan oleh customer asli tetapi bot tidak dapat menjawabnya (RAG low similarity) sehingga ter-eskalasi ke human. Isi jawaban di bawah untuk membalas customer dan menyimpannya langsung ke database FAQ secara real-time.
              </p>
            </div>
          </div>

          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
            <div className="flex justify-between items-center pb-4 border-b border-white/5">
              <span className="text-sm font-bold text-white">Log Pertanyaan Tertunda (Real-time Queue)</span>
              <button 
                onClick={loadUnansweredData}
                className="p-1 text-slate-400 hover:text-white"
                title="Refresh Queue"
              >
                <RefreshCw size={14} className={unansweredLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            {unansweredLoading ? (
              <div className="flex justify-center py-12">
                <Loader className="animate-spin text-pink-500" size={32} />
              </div>
            ) : unansweredList.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-xs">
                Tidak ada pertanyaan tertunda yang butuh dijawab. Semua percakapan berjalan lancar!
              </div>
            ) : (
              <div className="space-y-4">
                {unansweredList.map((item) => (
                  <div key={item.id} className="p-4 rounded-xl bg-slate-950 border border-white/5 flex flex-col space-y-3">
                    <div className="flex justify-between items-start md:items-center flex-col md:flex-row gap-2 border-b border-white/5 pb-2">
                      <div>
                        <span className="text-[10px] text-pink-400 font-bold block mb-0.5">Bunda {item.name} ({item.phone})</span>
                        <span className="text-[9px] text-slate-500">Diajukan pada: {new Date(item.createdAt).toLocaleString()}</span>
                      </div>
                      {activeUnansweredId !== item.id && (
                        <button
                          onClick={() => {
                            setActiveUnansweredId(item.id);
                            setUnansweredAnswer('');
                          }}
                          className="px-3 py-1.5 rounded-lg bg-pink-500 hover:bg-pink-600 text-white text-xs font-bold transition flex items-center space-x-1"
                        >
                          <Plus size={12} />
                          <span>Jawab & Simpan ke FAQ</span>
                        </button>
                      )}
                    </div>

                    <div className="bg-slate-900/60 p-3 rounded-lg border border-white/5">
                      <p className="text-xs text-slate-300">"{item.question}"</p>
                    </div>

                    {activeUnansweredId === item.id && (
                      <div className="space-y-3 pt-2">
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 font-bold uppercase">Jawaban Bidan/Admin</label>
                          <textarea
                            rows={3}
                            placeholder="Tulis jawaban di sini... (Akan langsung terkirim ke customer dan disimpan ke FAQ)"
                            value={unansweredAnswer}
                            onChange={(e) => setUnansweredAnswer(e.target.value)}
                            className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-pink-500 transition"
                          />
                        </div>
                        <div className="flex space-x-2 justify-end">
                          <button
                            onClick={() => setActiveUnansweredId(null)}
                            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 text-slate-400 hover:text-white text-xs transition"
                          >
                            Batal
                          </button>
                          <button
                            onClick={() => handleResolveUnanswered(item.id)}
                            className="px-3 py-1.5 rounded-lg bg-pink-500 hover:bg-pink-600 text-white text-xs font-bold transition flex items-center space-x-1"
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
                ? 'bg-emerald-500 text-white border-emerald-400' 
                : t.type === 'error' 
                  ? 'bg-rose-500 text-white border-rose-400' 
                  : 'bg-slate-800 text-white border-white/20'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>

    </div>
  );
};
