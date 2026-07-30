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
  CheckCircle
} from 'lucide-react';

export const KnowledgeBase: React.FC = () => {
  const [chunks, setChunks] = useState<FAQChunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'chunks' | 'upload' | 'unanswered' | 'harvesting'>('chunks');
  
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

  const loadChunks = async () => {
    try {
      const data = await apiRequest('/api/admin/knowledge/chunks');
      setChunks(data || []);
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
          setHarvestJob(stats);
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
        setHarvestJob(stats);
      } catch (err) {
        console.warn('Failed to load harvest status on mount:', err);
      }
    }
    loadHarvestStatus();
  }, []);

  const handleStartHarvest = async () => {
    setHarvestLoading(true);
    try {
      const res = await apiRequest('/api/admin/harvest/legacy-chat', {
        method: 'POST',
        body: JSON.stringify({})
      });
      alert(res.message || 'Scraping job started successfully!');
      // Refresh status immediately
      const stats = await apiRequest('/api/admin/harvest/status');
      setHarvestJob(stats);
    } catch (err: any) {
      alert(`Failed to start scraping: ${err.message}`);
    } finally {
      setHarvestLoading(false);
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
      <div className="flex space-x-2 p-1 bg-slate-900/60 border border-white/5 rounded-xl max-w-xl">
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
          onClick={() => setActiveTab('unanswered')}
          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all ${activeTab === 'unanswered' ? 'bg-pink-500 text-white shadow' : 'text-slate-400 hover:text-white'}`}
        >
          Unanswered Log
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
              {chunks.map((chunk) => (
                <div key={chunk.id} className="glass-card rounded-2xl p-6 border border-white/5 flex flex-col justify-between space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        chunk.source_type === 'FAQ' ? 'bg-purple-500/10 text-purple-400' : 'bg-blue-500/10 text-blue-400'
                      }`}>
                        {chunk.source_type}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {new Date(chunk.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <h4 className="font-bold text-white text-sm line-clamp-1">{chunk.title}</h4>
                    <p className="text-xs text-slate-400 line-clamp-4 leading-relaxed whitespace-pre-wrap">
                      {chunk.content}
                    </p>
                  </div>
                </div>
              ))}
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
      ) : (
        /* Unanswered Log with Notice */
        <div className="space-y-6">
          {/* Out of scope alert banner */}
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-start space-x-3 text-sm">
            <AlertTriangle className="flex-shrink-0 mt-0.5" size={20} />
            <div>
              <p className="font-bold">Fitur Log Pertanyaan Tidak Terjawab (Unanswered Questions)</p>
              <p className="mt-1 text-xs text-amber-500/80">
                ⚠️ **PEMBERITAHUAN:** Fitur ini saat ini berada dalam status mockup UI. Menunggu pembuatan endpoint backend write-back ke KnowledgeChunk.
              </p>
            </div>
          </div>

          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
            <div className="flex justify-between items-center pb-4 border-b border-white/5">
              <span className="text-sm font-bold text-white">Log Pertanyaan Tertunda (Offline Mock)</span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400">Mock Data</span>
            </div>

            <div className="space-y-3">
              {[
                { phone: '081299991223', question: 'Apakah ada paket hemat untuk bayi kembar usia 3 bulan?' },
                { phone: '081928374650', question: 'Apakah bidan Yusi melayani homecare di luar Surabaya Timur?' }
              ].map((item, idx) => (
                <div key={idx} className="p-4 rounded-xl bg-slate-950 border border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <span className="text-[10px] text-pink-400 font-bold block mb-1">Customer: {item.phone}</span>
                    <p className="text-xs text-slate-300">"{item.question}"</p>
                  </div>
                  <button 
                    disabled 
                    className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 text-slate-500 text-xs cursor-not-allowed"
                    title="Menunggu endpoint backend write-back"
                  >
                    Jawab & Simpan ke FAQ
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
