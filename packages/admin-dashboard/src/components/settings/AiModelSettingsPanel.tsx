import React, { useEffect, useState } from 'react';
import { Bot, Save, RefreshCw, Sparkles, Check, HelpCircle } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';

export interface AiTaskModelConfig {
  task: string;
  provider: string;
  modelName: string;
  description: string;
  maxTokens: number;
  temperature: number;
  confidenceThreshold?: number;
}

const PRESET_MODELS: Record<string, string[]> = {
  Kenari: ['deepseek-v4-1-flash', 'deepseek-v4-pro', 'qwen3-8-flash', 'qwen3-7-plus', 'minimax-m2-7', 'step-3-7-flash:free'],
  OpenAI: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
  MiniMax: ['MiniMax-M2.7-highspeed', 'abab6.5s-chat', 'MiniMax-Text-01'],
  DeepSeek: ['deepseek-chat', 'deepseek-coder', 'deepseek-v4-flash'],
  Groq: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
  Anthropic: ['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022'],
};

const TASK_LABELS: Record<string, { label: string; badge: string }> = {
  INTENT_CLASSIFICATION: { label: 'Slot Extractor & NLU Parsing', badge: '🎰 Extractor (Call 1)' },
  CHAT_REPLY: { label: 'Balasan Chat Persona (Bidan Yusi)', badge: '💬 Generator (Call 2 / FAQ)' },
  CHAT_REPLY_DEEP: { label: 'Konsultasi Klinis Multi-Gejala', badge: '🧠 Deep Generator' },
  AI_VERIFIER: { label: 'QC Evaluator (Quality Verifier)', badge: '🛡️ Verifier' },
  SUMMARIZATION: { label: 'Ringkasan Chat & Konteks Pasien', badge: '📝 Summarizer' },
  HARVESTING: { label: 'Ekstraksi Arsip Chat History', badge: '🌾 Harvester' },
  PII_SCRUBBING: { label: 'Sanitasi Data Pribadi (PII)', badge: '🔒 Privacy' },
};

export const AiModelSettingsPanel: React.FC = () => {
  const { toast } = useUiFeedback();
  const [configs, setConfigs] = useState<AiTaskModelConfig[]>([]);
  const [activeProvider, setActiveProvider] = useState<'KENARI' | 'SUMOPOD'>('KENARI');
  const [providersStatus, setProvidersStatus] = useState<any>(null);
  const [switchingProvider, setSwitchingProvider] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingTask, setSavingTask] = useState<string | null>(null);

  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/admin/ai-models');
      if (res.success) {
        if (Array.isArray(res.data)) {
          setConfigs(res.data.filter((c: AiTaskModelConfig) => c.task !== 'MEDICAL_CHECK'));
        }
        if (res.activeProvider) {
          setActiveProvider(res.activeProvider);
        }
        if (res.providersStatus) {
          setProvidersStatus(res.providersStatus);
        }
      }
    } catch (err: any) {
      toast('Gagal memuat konfigurasi model AI: ' + (err.message || err), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchProvider = async (target: 'KENARI' | 'SUMOPOD') => {
    if (target === activeProvider || switchingProvider) return;
    setSwitchingProvider(true);
    try {
      const res = await apiRequest('/api/admin/ai-models/provider', {
        method: 'PATCH',
        body: JSON.stringify({ provider: target }),
      });
      if (res.success) {
        setActiveProvider(target);
        if (Array.isArray(res.configs)) {
          setConfigs(res.configs.filter((c: AiTaskModelConfig) => c.task !== 'MEDICAL_CHECK'));
        }
        toast(res.message || `Provider LLM berhasil diubah ke ${target}!`, 'success');
      } else {
        toast(res.error || 'Gagal mengubah provider AI', 'error');
      }
    } catch (err: any) {
      toast('Gagal mengubah provider: ' + (err.message || err), 'error');
    } finally {
      setSwitchingProvider(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  const handleChange = (task: string, field: keyof AiTaskModelConfig, value: any) => {
    setConfigs((prev) =>
      prev.map((item) => (item.task === task ? { ...item, [field]: value } : item))
    );
  };

  const handleSave = async (item: AiTaskModelConfig) => {
    setSavingTask(item.task);
    try {
      const res = await apiRequest(`/api/admin/ai-models/${item.task}`, {
        method: 'PATCH',
        body: JSON.stringify({
          provider: item.provider,
          modelName: item.modelName,
          maxTokens: Number(item.maxTokens),
          temperature: Number(item.temperature),
        }),
      });
      if (res.success) {
        toast(`Konfigurasi AI untuk task "${item.task}" berhasil disimpan!`, 'success');
      } else {
        toast(res.error || 'Gagal menyimpan konfigurasi model AI', 'error');
      }
    } catch (err: any) {
      toast('Gagal menyimpan: ' + (err.message || err), 'error');
    } finally {
      setSavingTask(null);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-[#e9edef] p-6 shadow-sm">
      <div className="flex items-center justify-between pb-4 border-b border-[#e9edef] mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-[#00a884] flex items-center justify-center">
            <Bot size={22} />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#111b21]">Konfigurasi Model AI Per-Tugas</h2>
            <p className="text-xs text-[#667781]">
              Pilih provider dan nama model AI yang digunakan untuk setiap tahapan bot (Slot Extractor, Balasan Chat, QC).
            </p>
          </div>
        </div>
        <button
          onClick={fetchConfigs}
          disabled={loading}
          className="p-2 text-[#667781] hover:text-[#111b21] hover:bg-[#f0f2f5] rounded-lg transition-colors"
          title="Segarkan data"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Provider Switcher Card (Kenari vs SumoPod) */}
      <div className="mb-6 p-4 rounded-xl bg-[#f8fafc] border border-[#e2e8f0]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-[#00a884]" />
              <span className="text-sm font-bold text-[#111b21]">Pilih Provider Utama (One-Click Switch)</span>
            </div>
            <p className="text-xs text-[#667781] mt-0.5">
              Ganti provider dan model utama bot secara instan antara Kenari dan SumoPod.
            </p>
          </div>
          {switchingProvider && (
            <span className="inline-flex items-center gap-1 text-xs text-[#00a884] font-medium">
              <RefreshCw size={12} className="animate-spin" /> Mengganti provider...
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Option: Kenari AI */}
          <button
            type="button"
            disabled={switchingProvider}
            onClick={() => handleSwitchProvider('KENARI')}
            className={`p-3.5 rounded-xl border text-left transition-all relative flex flex-col justify-between ${
              activeProvider === 'KENARI'
                ? 'border-[#00a884] bg-emerald-50/50 shadow-xs ring-1 ring-[#00a884]'
                : 'border-[#d1d7db] bg-white hover:border-slate-400 opacity-80 hover:opacity-100'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <span className="text-base">🦜</span>
                <div>
                  <span className="text-xs font-bold text-[#111b21] block">Kenari AI</span>
                  <span className="text-[10px] text-[#667781] font-mono">https://kenari.id/v1</span>
                </div>
              </div>
              {activeProvider === 'KENARI' ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#00a884] text-white">
                  <Check size={10} /> Aktif
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-[#667781]">
                  Pilih
                </span>
              )}
            </div>
            <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
              <span className="text-[#667781]">
                Model: <strong className="text-[#111b21] font-mono">deepseek-v4-1-flash</strong>
              </span>
              <span className={`text-[10px] ${providersStatus?.kenari?.configured ? 'text-emerald-700 font-semibold' : 'text-slate-500'}`}>
                {providersStatus?.kenari?.configured ? '● Key Tersambung' : '○ Key di .env'}
              </span>
            </div>
          </button>

          {/* Option: SumoPod AI */}
          <button
            type="button"
            disabled={switchingProvider}
            onClick={() => handleSwitchProvider('SUMOPOD')}
            className={`p-3.5 rounded-xl border text-left transition-all relative flex flex-col justify-between ${
              activeProvider === 'SUMOPOD'
                ? 'border-[#00a884] bg-emerald-50/50 shadow-xs ring-1 ring-[#00a884]'
                : 'border-[#d1d7db] bg-white hover:border-slate-400 opacity-80 hover:opacity-100'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <span className="text-base">⚡</span>
                <div>
                  <span className="text-xs font-bold text-[#111b21] block">SumoPod AI</span>
                  <span className="text-[10px] text-[#667781] font-mono">https://ai.sumopod.com/v1</span>
                </div>
              </div>
              {activeProvider === 'SUMOPOD' ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#00a884] text-white">
                  <Check size={10} /> Aktif
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-[#667781]">
                  Pilih
                </span>
              )}
            </div>
            <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
              <span className="text-[#667781]">
                Model: <strong className="text-[#111b21] font-mono">deepseek-v4-flash</strong>
              </span>
              <span className={`text-[10px] ${providersStatus?.sumopod?.configured ? 'text-emerald-700 font-semibold' : 'text-slate-500'}`}>
                {providersStatus?.sumopod?.configured ? '● Key Tersambung' : '○ Key di .env'}
              </span>
            </div>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs text-[#8696a0]">
          <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-[#00a884]" />
          Memuat konfigurasi model AI...
        </div>
      ) : (
        <div className="space-y-4">
          {configs.map((cfg) => {
            const taskMeta = TASK_LABELS[cfg.task] || { label: cfg.task, badge: cfg.task };
            const isSaving = savingTask === cfg.task;
            const presetList = PRESET_MODELS[cfg.provider] || [];

            return (
              <div
                key={cfg.task}
                className="p-4 rounded-xl border border-[#e9edef] hover:border-emerald-200 bg-[#f8fafc] transition-all"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-[#111b21]">{taskMeta.label}</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        {taskMeta.badge}
                      </span>
                    </div>
                    <p className="text-xs text-[#667781] mt-0.5">{cfg.description}</p>
                  </div>
                  <button
                    onClick={() => handleSave(cfg)}
                    disabled={isSaving}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50 self-start md:self-auto"
                  >
                    {isSaving ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" /> Menyimpan...
                      </>
                    ) : (
                      <>
                        <Save size={14} /> Simpan
                      </>
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                  {/* Provider Selection */}
                  <div>
                    <label className="block text-[11px] font-semibold text-[#667781] mb-1">Provider AI</label>
                    <select
                      value={cfg.provider}
                      onChange={(e) => {
                        const newProvider = e.target.value;
                        const defaultModelForProvider = PRESET_MODELS[newProvider]?.[0] || cfg.modelName;
                        handleChange(cfg.task, 'provider', newProvider);
                        handleChange(cfg.task, 'modelName', defaultModelForProvider);
                      }}
                      className="w-full bg-white border border-[#d1d7db] rounded-lg px-3 py-2 text-[#111b21] focus:outline-none focus:border-[#00a884]"
                    >
                      <option value="Kenari">Kenari (https://kenari.id)</option>
                      <option value="MiniMax">MiniMax (Highspeed & Hemat)</option>
                      <option value="OpenAI">OpenAI</option>
                      <option value="DeepSeek">DeepSeek</option>
                      <option value="Groq">Groq</option>
                      <option value="Anthropic">Anthropic</option>
                    </select>
                  </div>

                  {/* Model Name Input */}
                  <div>
                    <label className="block text-[11px] font-semibold text-[#667781] mb-1">Nama Model</label>
                    <div className="space-y-1">
                      <input
                        type="text"
                        value={cfg.modelName}
                        onChange={(e) => handleChange(cfg.task, 'modelName', e.target.value)}
                        placeholder="contoh: MiniMax-M2.7-highspeed"
                        className="w-full bg-white border border-[#d1d7db] rounded-lg px-3 py-2 text-[#111b21] font-mono text-xs focus:outline-none focus:border-[#00a884]"
                      />
                      {presetList.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {presetList.map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => handleChange(cfg.task, 'modelName', m)}
                              className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                cfg.modelName === m
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300 font-semibold'
                                  : 'bg-white text-[#667781] border-[#e9edef] hover:bg-slate-50'
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Temperature */}
                  <div>
                    <label className="block text-[11px] font-semibold text-[#667781] mb-1">
                      Temperature ({cfg.temperature})
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={cfg.temperature}
                      onChange={(e) => handleChange(cfg.task, 'temperature', parseFloat(e.target.value))}
                      className="w-full accent-[#00a884] h-2 bg-slate-200 rounded-lg cursor-pointer mt-2"
                    />
                    <span className="text-[10px] text-[#8696a0]">
                      {cfg.temperature <= 0.2 ? 'Sangat Presisi / Kaku' : cfg.temperature >= 0.7 ? 'Kreatif / Fleksibel' : 'Seimbang'}
                    </span>
                  </div>

                  {/* Max Tokens */}
                  <div>
                    <label className="block text-[11px] font-semibold text-[#667781] mb-1">Max Tokens</label>
                    <input
                      type="number"
                      value={cfg.maxTokens}
                      onChange={(e) => handleChange(cfg.task, 'maxTokens', parseInt(e.target.value, 10) || 512)}
                      className="w-full bg-white border border-[#d1d7db] rounded-lg px-3 py-2 text-[#111b21] focus:outline-none focus:border-[#00a884]"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
