import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../../services/api';
import { 
  Send, 
  Terminal, 
  Eye, 
  Search, 
  Activity, 
  Cpu, 
  AlertOctagon,
  Sparkles,
  Edit3,
  Save,
  X
} from 'lucide-react';

interface ChatMessage {
  sender: 'user' | 'bot';
  content: string;
  timestamp: Date;
  isError?: boolean;
}

export const AiSandbox: React.FC = () => {
  const [sandboxPhone, setSandboxPhone] = useState<string>(() => {
    let stored = sessionStorage.getItem('sandbox_phone');
    if (!stored) {
      stored = '6289999' + Math.floor(100000 + Math.random() * 900000);
      sessionStorage.setItem('sandbox_phone', stored);
    }
    return stored;
  });

  const [messages, setMessages] = useState<ChatMessage[]>([
    { sender: 'bot', content: `Halo Bunda! Saya asisten AI Kala Moms & Baby Spa (Sesi Baru ${sandboxPhone.substring(7)}). Silakan coba kirim pertanyaan di bawah untuk menguji respon RAG & Persona saya! 🌸`, timestamp: new Date() }
  ]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Simulated outage toggle
  const [sumoPodOutage, setSumoPodOutage] = useState(false);

  // Inspector state
  const [inspectorData, setInspectorData] = useState<any>({
    query: '',
    chunks: [],
    systemPrompt: `Kamu adalah asisten chat ramah dari Kala Moms & Baby Spa...`,
    latencyMs: 0
  });

  // Edit chunk states
  const [editingChunkId, setEditingChunkId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingContent, setEditingContent] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [editingPersona, setEditingPersona] = useState(false);
  const [personaText, setPersonaText] = useState('');
  const [personaLoading, setPersonaLoading] = useState(false);

  const loadPersona = async () => {
    try {
      const res = await apiRequest('/api/admin/persona');
      setPersonaText(res.persona || '');
      setInspectorData((prev: any) => ({ ...prev, systemPrompt: res.persona || prev.systemPrompt }));
    } catch (err) {
      console.error('Failed to load persona:', err);
    }
  };

  useEffect(() => {
    loadPersona();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleNewCleanSession = () => {
    const newPhone = '6289999' + Math.floor(100000 + Math.random() * 900000);
    sessionStorage.setItem('sandbox_phone', newPhone);
    setSandboxPhone(newPhone);
    setMessages([
      { sender: 'bot', content: `Sesi simulator baru dimulai (ID: ${newPhone.substring(7)})! Customer baru, state bersih dari INITIAL 🌸`, timestamp: new Date() }
    ]);
  };

  const handleStartEdit = (chunk: any) => {
    setEditingChunkId(chunk.id || chunk.title); // Use chunk.id, fallback to title
    setEditingTitle(chunk.title);
    setEditingContent(chunk.content);
  };

  const handleCancelEdit = () => {
    setEditingChunkId(null);
    setEditingTitle('');
    setEditingContent('');
  };
  const handleSaveEdit = async (chunkId: string) => {
    if (!editingTitle.trim() || !editingContent.trim() || editLoading) return;

    const isConfirmed = window.confirm(
      "⚠️ PERINGATAN:\n\nPerubahan ini bersifat PERMANEN dan langsung disimpan ke database utama (tabel KnowledgeChunk).\n\nIni akan memengaruhi jawaban AI Bot untuk seluruh customer asli Anda di WhatsApp produksi.\n\nApakah Anda yakin ingin menyimpan perubahan ini?"
    );
    if (!isConfirmed) return;

    setEditLoading(true);
    try {
      await apiRequest(`/api/admin/knowledge/chunks/${chunkId}`, {
        method: 'PUT',
        body: JSON.stringify({ title: editingTitle, content: editingContent })
      });
      
      // Update inspector local state
      setInspectorData((prev: any) => ({
        ...prev,
        chunks: prev.chunks.map((c: any) => 
          (c.id === chunkId || c.title === chunkId) ? { ...c, title: editingTitle, content: editingContent } : c
        )
      }));
      setEditingChunkId(null);
    } catch (err: any) {
      alert(`Failed to save chunk: ${err.message}`);
    } finally {
      setEditLoading(false);
    }
  };

  const handleSavePersona = async () => {
    if (!personaText.trim() || personaLoading) return;
    const isConfirmed = window.confirm(
      "⚠️ PERINGATAN:\n\nPerubahan ini bersifat PERMANEN dan langsung mengubah SYSTEM PERSONA PROMPT bot AI Anda secara live.\n\nIni akan memengaruhi cara bot merespon seluruh chat customer asli Anda di WhatsApp produksi.\n\nApakah Anda yakin ingin menyimpan perubahan persona ini?"
    );
    if (!isConfirmed) return;

    setPersonaLoading(true);
    try {
      await apiRequest('/api/admin/persona', {
        method: 'POST',
        body: JSON.stringify({ persona: personaText })
      });
      setEditingPersona(false);
      setInspectorData((prev: any) => ({ ...prev, systemPrompt: personaText }));
    } catch (err: any) {
      alert(`Gagal menyimpan perubahan persona: ${err.message}`);
    } finally {
      setPersonaLoading(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || loading) return;

    const userText = inputText;
    setInputText('');
    
    // Append user message
    const newMsg: ChatMessage = { sender: 'user', content: userText, timestamp: new Date() };
    setMessages(prev => [...prev, newMsg]);
    setLoading(true);

    const startTime = Date.now();

    try {
      const data = await apiRequest('/api/admin/sandbox/chat', {
        method: 'POST',
        body: JSON.stringify({ text: userText, simulateOutage: sumoPodOutage, sandboxPhone })
      });

      const endTime = Date.now();
      
      setMessages(prev => [...prev, {
        sender: 'bot',
        content: data.answer || 'Maaf, saya tidak mengerti maksud Bunda.',
        timestamp: new Date(),
        isError: Boolean(data.llmError)
      }]);

      setInspectorData({
        query: data.query || userText,
        chunks: data.chunks || [],
        systemPrompt: `TUGAS UTAMA: Jawab pertanyaan customer tentang informasi/FAQ moms & baby spa berdasarkan Referensi Dokumen...`,
        latencyMs: endTime - startTime,
        error: data.llmError || null
      });
    } catch (err: any) {
      setMessages(prev => [...prev, {
        sender: 'bot',
        content: `Error calling AI Generator: ${err.message}`,
        timestamp: new Date(),
        isError: true
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white flex items-center space-x-3">
            <Terminal className="text-pink-400" />
            <span>AI Sandbox Simulator</span>
          </h2>
          <p className="text-slate-400">Test AI response, inspect vector retrieval, and simulate server failure conditions</p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleNewCleanSession}
            className="px-3.5 py-2 bg-pink-500/10 hover:bg-pink-500 text-pink-400 hover:text-white border border-pink-500/20 rounded-xl text-xs font-bold transition flex items-center space-x-1.5"
            title="Start new isolated sandbox customer session"
          >
            <Sparkles size={14} />
            <span>Mulai Sesi Bersih Baru</span>
          </button>

          {/* SumoPod Outage Toggle */}
          <div className="flex items-center space-x-3 bg-slate-900/60 border border-white/5 px-4 py-2 rounded-xl">
            <span className="text-xs font-semibold text-slate-300">Simulate SumoPod Outage</span>
            <button
              onClick={() => setSumoPodOutage(!sumoPodOutage)}
              className={`w-11 h-6 rounded-full transition-all relative ${sumoPodOutage ? 'bg-rose-500' : 'bg-slate-700'}`}
            >
              <div className={`absolute top-1 left-1 bg-white h-4 w-4 rounded-full transition-all ${sumoPodOutage ? 'translate-x-5' : ''}`}></div>
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Chat Simulator panel */}
        <div className="glass-panel border border-white/5 rounded-2xl p-6 flex flex-col h-[520px] justify-between">
          <div className="flex items-center justify-between pb-3 border-b border-white/5 mb-4">
            <span className="text-sm font-bold text-white flex items-center space-x-1.5">
              <Sparkles size={16} className="text-pink-400" />
              <span>Simulated WhatsApp Chat</span>
            </span>

            {sumoPodOutage ? (
              <span className="px-2.5 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-bold animate-pulse flex items-center space-x-1">
                <AlertOctagon size={10} />
                <span>LLM API OUTAGE</span>
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                AI Agent Active
              </span>
            )}
          </div>

          {/* Messages list */}
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 mb-4">
            {messages.map((msg, idx) => (
              <div 
                key={idx} 
                className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[80%] rounded-2xl p-4 text-xs leading-relaxed ${
                  msg.sender === 'user' 
                    ? 'bg-pink-500 text-white rounded-tr-none'
                    : msg.isError 
                      ? 'bg-rose-500/10 border border-rose-500/25 text-rose-400 rounded-tl-none font-medium'
                      : 'bg-slate-800 text-slate-100 rounded-tl-none border border-white/5'
                }`}>
                  <p>{msg.content}</p>
                  <span className="block text-[8px] text-slate-500 mt-2 text-right">
                    {msg.timestamp.toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-800/80 border border-white/5 rounded-2xl rounded-tl-none p-4 text-xs flex items-center space-x-2 text-slate-400">
                  <div className="h-1.5 w-1.5 bg-slate-400 rounded-full animate-bounce"></div>
                  <div className="h-1.5 w-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                  <div className="h-1.5 w-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Form input */}
          <form onSubmit={handleSend} className="flex space-x-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Ask about treatments, locations, or scheduling..."
              className="flex-1 p-3 bg-slate-950 border border-white/5 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="p-3 bg-pink-500 hover:bg-pink-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center justify-center"
            >
              <Send size={14} />
            </button>
          </form>
        </div>

        {/* RAG Inspector Panel */}
        <div className="glass-panel border border-white/5 rounded-2xl p-6 h-[520px] overflow-y-auto space-y-6">
          <div className="flex items-center space-x-2 pb-3 border-b border-white/5">
            <Eye className="text-pink-400" />
            <h3 className="text-base font-bold text-white">RAG Chunks & Prompt Inspector</h3>
          </div>

          {inspectorData.query ? (
            <div className="space-y-5">
              
              {/* Query & Latency metrics */}
              <div className="flex justify-between items-center text-xs">
                <div className="flex items-center space-x-1.5">
                  <Search size={14} className="text-slate-400" />
                  <span className="text-slate-400">Search Query:</span>
                  <span className="font-semibold text-white truncate max-w-xs">"{inspectorData.query}"</span>
                </div>
                <div className="flex items-center space-x-1 text-slate-500">
                  <Activity size={14} />
                  <span>{inspectorData.latencyMs} ms</span>
                </div>
              </div>

              {/* Error log if outage */}
              {inspectorData.error && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-mono">
                  <span className="font-bold">Error:</span> {inspectorData.error}
                </div>
              )}

              {/* Reference Chunks section */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-400 block uppercase">Vector Chunks Retrieved ({inspectorData.chunks?.length || 0})</span>
                <div className="space-y-3">
                  {inspectorData.chunks?.map((chunk: any, i: number) => {
                    const chunkId = chunk.id || chunk.title;
                    const isEditing = editingChunkId === chunkId;
                    return (
                      <div key={i} className="p-4 rounded-xl bg-slate-950 border border-white/5 space-y-3">
                        {isEditing ? (
                          <div className="space-y-3">
                            <div className="space-y-1">
                              <label className="text-[10px] text-slate-500 font-semibold">Chunk Title</label>
                              <input
                                type="text"
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                className="w-full p-2 rounded-lg bg-slate-900 border border-white/10 text-xs text-white focus:outline-none focus:border-pink-500"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] text-slate-500 font-semibold">Chunk Content</label>
                              <textarea
                                rows={4}
                                value={editingContent}
                                onChange={(e) => setEditingContent(e.target.value)}
                                className="w-full p-2 rounded-lg bg-slate-900 border border-white/10 text-xs text-white focus:outline-none focus:border-pink-500 leading-relaxed font-sans"
                              />
                            </div>
                            <div className="flex space-x-2 justify-end pt-1">
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-[10px] font-bold transition flex items-center space-x-1"
                              >
                                <X size={12} />
                                <span>Cancel</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveEdit(chunkId)}
                                disabled={editLoading}
                                className="px-2.5 py-1.5 rounded-lg bg-pink-500 hover:bg-pink-600 text-white text-[10px] font-bold transition flex items-center space-x-1 disabled:opacity-50"
                              >
                                <Save size={12} />
                                <span>{editLoading ? 'Saving...' : 'Save'}</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-bold text-pink-400">{chunk.title}</span>
                              <div className="flex items-center space-x-3">
                                <span className="text-[10px] text-slate-600 font-mono">Similarity: {(chunk.score || 0.85).toFixed(2)}</span>
                                <button
                                  type="button"
                                  onClick={() => handleStartEdit(chunk)}
                                  className="p-1 rounded bg-white/5 hover:bg-pink-500/10 text-slate-400 hover:text-pink-400 transition"
                                  title="Edit Chunk"
                                >
                                  <Edit3 size={11} />
                                </button>
                              </div>
                            </div>
                            <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
                              {chunk.content}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {(!inspectorData.chunks || inspectorData.chunks.length === 0) && (
                    <div className="text-xs text-slate-600 py-2">
                      No vector chunks retrieved for current query.
                    </div>
                  )}
                </div>
              </div>

              {/* System Persona prompt */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-slate-400 block uppercase flex items-center space-x-1">
                    <Cpu size={12} />
                    <span>Active System Persona Prompt</span>
                  </span>
                  {!editingPersona ? (
                    <button
                      type="button"
                      onClick={() => setEditingPersona(true)}
                      className="px-2 py-1 rounded bg-white/5 hover:bg-pink-500/10 text-slate-400 hover:text-pink-400 text-[10px] font-bold transition flex items-center space-x-1"
                    >
                      <Edit3 size={10} />
                      <span>Edit Persona</span>
                    </button>
                  ) : (
                    <div className="flex space-x-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPersona(false);
                          setPersonaText(inspectorData.systemPrompt || '');
                        }}
                        className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-300 text-[10px] font-bold transition flex items-center space-x-1"
                      >
                        <X size={10} />
                        <span>Cancel</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleSavePersona}
                        disabled={personaLoading}
                        className="px-2 py-1 rounded bg-pink-500 hover:bg-pink-600 text-white text-[10px] font-bold transition flex items-center space-x-1 disabled:opacity-50"
                      >
                        <Save size={10} />
                        <span>{personaLoading ? 'Saving...' : 'Save'}</span>
                      </button>
                    </div>
                  )}
                </div>

                {editingPersona ? (
                  <textarea
                    rows={12}
                    value={personaText}
                    onChange={(e) => setPersonaText(e.target.value)}
                    className="w-full p-3 rounded-xl bg-slate-950 border border-white/10 text-[10px] text-white focus:outline-none focus:border-pink-500 leading-relaxed font-mono"
                  />
                ) : (
                  <pre className="p-3 bg-slate-950 border border-white/5 rounded-xl text-[10px] text-slate-500 font-mono overflow-auto max-h-40 whitespace-pre-wrap leading-relaxed">
                    {inspectorData.systemPrompt}
                  </pre>
                )}
              </div>

            </div>
          ) : (
            <div className="h-full flex flex-col justify-center items-center text-center text-slate-600 text-xs py-20">
              <Eye size={36} className="mb-3 text-slate-700" />
              <p>Type and send a message in the chat simulator to inspect live retrieval variables here.</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
