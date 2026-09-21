import React, { useEffect, useState } from 'react';
import { Bot, Save, RefreshCw, Sparkles, Check, ChevronDown, ChevronUp, Beaker, RotateCcw, Zap } from 'lucide-react';
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

// === Preset 1-Klik (diselaraskan dengan AI_PRESET_PROFILES backend) ===
// Server utama = SumoPod. KENAPA 3 KINERJA:
//  1) Kilat & Hemat  = 95% chat harian butuh cepat+murah (MiniMax 90% off).
//  2) Mendalam       = keluhan multi-gejala butuh penalaran DeepSeek netra.
//  3) Disiplin Qwen  = kasus rawan format butuh model paling tertib aturan.
const PRESET_CARDS = [
  {
    id: 'FAST_ECONOMICAL',
    title: 'Mode Kilat & Hemat (Default Rekomendasi Klinik)',
    star: true,
    model: 'MiniMax-M2.7-highspeed (SumoPod Utama)',
    modelKey: 'MiniMax-M2.7-highspeed',
    deepKey: 'deepseek-v4-flash-0731:netra',
    provider: 'SUMOPOD' as const,
    speed: 'Super Kilat (~1.1s)',
    charm: 'Bidan Ramah & Luwes',
    cost: 'Paling Ekonomis 90% off',
    note: 'Cocok untuk 95% operasional harian',
    icon: '⚡',
  },
  {
    id: 'DEEP_REASONING',
    title: 'Mode Konsultasi Mendalam (Deep Clinical Reasoning)',
    star: false,
    model: 'deepseek-v4-flash-0731:netra (SumoPod)',
    modelKey: 'deepseek-v4-flash-0731:netra',
    deepKey: 'deepseek-v4-flash-0731:netra',
    provider: 'SUMOPOD' as const,
    speed: 'Sedang (~2.4s)',
    charm: 'Analisis: Keluhan Medis Kompleks',
    cost: 'Hemat 80% off',
    note: 'Empati & elaborasi jawaban tinggi',
    icon: '🧠',
  },
  {
    id: 'DISCIPLINED_QWEN',
    title: 'Mode Alternatif Disiplin Format',
    star: false,
    model: 'qwen3.7-flash-2026-07-15 (SumoPod)',
    modelKey: 'qwen3.7-flash-2026-07-15',
    deepKey: 'qwen3.7-flash-2026-07-15',
    provider: 'SUMOPOD' as const,
    speed: 'Cepat (~1.3s)',
    charm: 'Singkat & Sangat Tertib',
    cost: 'Ekonomis',
    note: 'Karakter disiplin aturan',
    icon: '🛡️',
  },
];

// Katalog live per 2026-09-21 — wajib sama dengan SUMOPOD_CATALOG / KENARI_CATALOG backend.
const SUMOPOD_MODELS = ['glm-5.3-flash', 'MiniMax-M2.7-highspeed', 'qwen3.7-flash-2026-07-15', 'gpt-4o-mini', 'deepseek-v4-flash-0731:netra'];
const KENARI_MODELS = ['deepseek-v4-1-flash', 'gemini-2-5-flash-lite', 'muse-spark-1-3-contributor'];

// Kartu Mode Darurat Kenari — hanya dirender saat activeProvider === 'KENARI'
// (derive mengembalikan 'FAILOVER_SUMOPOD' yang tak ada di PRESET_CARDS).
const FAILOVER_CARD = {
  id: 'FAILOVER_SUMOPOD',
  title: 'Mode Cadangan / Darurat (Kenari)',
  star: false,
  model: 'DeepSeek-V4.1-Flash (Kenari Cadangan)',
  modelKey: 'deepseek-v4-1-flash',
  deepKey: 'deepseek-v4-1-flash',
  provider: 'KENARI' as const,
  speed: 'Stabil (~1.1s)',
  charm: 'Bidan Ramah & Luwes',
  cost: 'Standar',
  note: 'Jalur cadangan aktif bila SumoPod utama gangguan',
  icon: '🛟',
};

// Resolve definisi preset by id (termasuk kartu failover di luar PRESET_CARDS).
const resolvePresetDef = (presetId: string) =>
  presetId === FAILOVER_CARD.id
    ? FAILOVER_CARD
    : PRESET_CARDS.find((p) => p.id === presetId);

const TASK_LABELS: Record<string, { label: string; badge: string }> = {
  INTENT_CLASSIFICATION: { label: 'Slot Extractor & NLU Parsing', badge: '🎰 Extractor (Call 1)' },
  CHAT_REPLY: { label: 'Balasan Chat Persona (Bidan Yusi)', badge: '💬 Generator (Call 2 / FAQ)' },
  CHAT_REPLY_DEEP: { label: 'Konsultasi Klinis Multi-Gejala', badge: '🧠 Deep Generator' },
  AI_VERIFIER: { label: 'QC Evaluator (Quality Verifier)', badge: '🛡️ Verifier' },
  SUMMARIZATION: { label: 'Ringkasan Chat & Konteks Pasien', badge: '📝 Summarizer' },
  HARVESTING: { label: 'Ekstraksi Arsip Chat History', badge: '🌾 Harvester' },
  PII_SCRUBBING: { label: 'Sanitasi Data Pribadi (PII)', badge: '🔒 Privacy' },
};

type TestScenario = 'flu' | 'price' | 'schedule';

export const AiModelSettingsPanel: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [configs, setConfigs] = useState<AiTaskModelConfig[]>([]);
  const [activeProvider, setActiveProvider] = useState<'KENARI' | 'SUMOPOD'>('SUMOPOD');
  const [providersStatus, setProvidersStatus] = useState<any>(null);
  const [switchingProvider, setSwitchingProvider] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingAll, setSavingAll] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string>('FAST_ECONOMICAL');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [initialSnapshot, setInitialSnapshot] = useState<string>('');

  // Mini simulator state
  const [testingScenario, setTestingScenario] = useState<TestScenario | null>(null);
  const [testResult, setTestResult] = useState<null | { success: boolean; latencyMs?: number; replySnippet?: string; error?: string; tokenEstimate?: number; modelUsed?: string; providerUsed?: string }>(null);

  // Pencocokan preset ketat: model di luar 3 profil standar (mis. glm-5.3-flash,
  // gpt-4o-mini) = 'CUSTOM', bukan dipaksa FAST_ECONOMICAL.
  const derivePresetFromConfigs = (cfgs: AiTaskModelConfig[], provider: string): string => {
    const chat = cfgs.find((c) => c.task === 'CHAT_REPLY');
    if (!chat) return 'FAST_ECONOMICAL';
    const m = (chat.modelName || '').toLowerCase();
    // Server cadangan Kenari: hanya deepseek-v4-1-flash yang profil standar (failover).
    if (provider === 'KENARI') {
      return m === 'deepseek-v4-1-flash' ? 'FAILOVER_SUMOPOD' : 'CUSTOM';
    }
    if (m === 'minimax-m2.7-highspeed') return 'FAST_ECONOMICAL';
    if (m.includes('netra') || m === 'deepseek-v4-flash') return 'DEEP_REASONING';
    if (m.includes('qwen3.7') || m === 'qwen3-8-flash') return 'DISCIPLINED_QWEN';
    return 'CUSTOM';
  };

  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/admin/ai-models');
      if (res.success) {
        const filtered = Array.isArray(res.data) ? res.data.filter((c: AiTaskModelConfig) => c.task !== 'MEDICAL_CHECK') : [];
        setConfigs(filtered);
        const prov = res.activeProvider || 'SUMOPOD';
        setActiveProvider(prov);
        setSelectedPreset(derivePresetFromConfigs(filtered, prov));
        if (res.providersStatus) setProvidersStatus(res.providersStatus);
        setInitialSnapshot(JSON.stringify({ configs: filtered, provider: prov }));
        setDirty(false);
      }
    } catch (err: any) {
      toast('Gagal memuat konfigurasi model AI: ' + (err.message || err), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  const markDirty = () => setDirty(true);

  const handleSwitchProvider = async (target: 'KENARI' | 'SUMOPOD') => {
    if (target === activeProvider || switchingProvider) return;
    // Proteksi anti-data-loss: beralih server membatalkan editan yang belum disimpan.
    if (dirty) {
      const ok = await confirm({
        title: 'Perubahan Belum Disimpan!',
        message: `Anda memiliki perubahan konfigurasi yang belum disimpan. Beralih ke Server ${target === 'SUMOPOD' ? 'Utama (SumoPod)' : 'Cadangan (Kenari)'} sekarang akan membatalkan perubahan tersebut. Lanjutkan?`,
        confirmText: 'Beralih & Batalkan Perubahan',
        cancelText: 'Kembali',
        danger: true,
      });
      if (!ok) return;
    }
    setSwitchingProvider(true);
    try {
      const res = await apiRequest('/api/admin/ai-models/provider', {
        method: 'PATCH',
        body: JSON.stringify({ provider: target }),
      });
      if (res.success) {
        setActiveProvider(target);
        if (res.providersStatus) setProvidersStatus(res.providersStatus);
        if (Array.isArray(res.configs)) {
          const filtered = res.configs.filter((c: AiTaskModelConfig) => c.task !== 'MEDICAL_CHECK');
          setConfigs(filtered);
          setSelectedPreset(derivePresetFromConfigs(filtered, target));
          setInitialSnapshot(JSON.stringify({ configs: filtered, provider: target }));
        }
        setTestResult(null);
        setDirty(false);
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

  const handleSelectPreset = (presetId: string) => {
    const preset = resolvePresetDef(presetId);
    const isFailover = presetId === 'FAILOVER_SUMOPOD';
    setSelectedPreset(presetId);
    setTestResult(null);
    // Apply preset lokal: update CHAT_REPLY, CHAT_REPLY_DEEP, SUMMARIZATION tanpa save ke server dulu
    // Utama = SumoPod, Failover (id FAILOVER_SUMOPOD) = Kenari cadangan.
    const providerLabel = isFailover ? 'Kenari' : 'SumoPod';
    const modelKey = preset?.modelKey || 'MiniMax-M2.7-highspeed';
    const deepKey = (preset as any)?.deepKey || preset?.modelKey || modelKey;
    setConfigs((prev) =>
      prev.map((c) => {
        if (c.task === 'CHAT_REPLY') return { ...c, provider: providerLabel, modelName: modelKey };
        if (c.task === 'CHAT_REPLY_DEEP') return { ...c, provider: providerLabel, modelName: deepKey };
        if (c.task === 'SUMMARIZATION') return { ...c, provider: providerLabel, modelName: modelKey };
        return c;
      })
    );
    if (isFailover && activeProvider !== 'KENARI') setActiveProvider('KENARI');
    if (!isFailover && activeProvider !== 'SUMOPOD') {
      // Preset utama selalu di SumoPod — switch visual back ke SumoPod
      setActiveProvider('SUMOPOD');
    }
    setDirty(true);
  };

  const handleChangeAdvanced = (task: string, field: keyof AiTaskModelConfig, value: any) => {
    setConfigs((prev) => {
      const next = prev.map((item) => (item.task === task ? { ...item, [field]: value } : item));
      // Sinkronisasi preset: ganti model/provider manual → preset dicocokkan ulang,
      // jatuh ke Mode Kustom bila di luar profil standar. Hasil simulator lama dibuang.
      if (field === 'modelName' || field === 'provider') {
        setSelectedPreset(derivePresetFromConfigs(next, activeProvider));
        setTestResult(null);
      }
      return next;
    });
    setDirty(true);
  };

  const handleSaveAll = async () => {
    setSavingAll(true);
    try {
      const payload = {
        presetId: selectedPreset,
        configs: configs.map((c) => ({
          task: c.task,
          provider: c.provider,
          modelName: c.modelName,
          maxTokens: Number(c.maxTokens),
          temperature: Number(c.temperature),
          ...(c.confidenceThreshold !== undefined ? { confidenceThreshold: Number(c.confidenceThreshold) } : {}),
        })),
      };
      const res = await apiRequest('/api/admin/ai-models/batch', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (res.success) {
        const filtered = Array.isArray(res.data) ? res.data.filter((c: AiTaskModelConfig) => c.task !== 'MEDICAL_CHECK') : configs;
        if (filtered.length) setConfigs(filtered);
        if (res.activeProvider) setActiveProvider(res.activeProvider);
        // persisted:false = DB gagal tulis (mis. DB down) — JANGAN anggap tersimpan.
        if (res.persisted === false) {
          setDirty(true);
          toast(res.warning || res.message || 'GAGAL tersimpan ke database — perubahan hanya di memori. Coba lagi.', 'error');
        } else {
          setInitialSnapshot(JSON.stringify({ configs: filtered, provider: res.activeProvider || activeProvider }));
          setDirty(false);
          toast(res.message || 'Konfigurasi AI berhasil disimpan! ✨', 'success');
        }
      } else {
        toast(res.error || 'Gagal menyimpan konfigurasi', 'error');
      }
    } catch (err: any) {
      toast('Gagal menyimpan: ' + (err.message || err), 'error');
    } finally {
      setSavingAll(false);
    }
  };

  const handleResetDefaults = async () => {
    const ok = await confirm({
      title: 'Kembalikan ke Rekomendasi Default?',
      message: 'Seluruh konfigurasi AI akan dikembalikan ke setelan emas klinik (Mode Kilat & Hemat). Tindakan ini akan menimpa perubahan yang belum disimpan.',
      confirmText: 'Ya, Kembalikan',
      cancelText: 'Batal',
      danger: true,
    });
    if (!ok) return;
    setResetting(true);
    try {
      const res = await apiRequest('/api/admin/ai-models/reset-defaults', { method: 'POST' });
      if (res.success) {
        const filtered = Array.isArray(res.data) ? res.data.filter((c: AiTaskModelConfig) => c.task !== 'MEDICAL_CHECK') : [];
        setConfigs(filtered);
        setTestResult(null);
        setActiveProvider(res.activeProvider || 'SUMOPOD');
        setSelectedPreset('FAST_ECONOMICAL');
        setInitialSnapshot(JSON.stringify({ configs: filtered, provider: res.activeProvider || 'SUMOPOD' }));
        setDirty(false);
        setTestResult(null);
        toast(res.message || 'Berhasil dikembalikan ke default!', 'success');
      } else {
        toast(res.error || 'Gagal reset', 'error');
      }
    } catch (err: any) {
      toast('Gagal reset: ' + (err.message || err), 'error');
    } finally {
      setResetting(false);
    }
  };

  const handleTestScenario = async (scenario: TestScenario) => {
    setTestingScenario(scenario);
    setTestResult(null);
    // Cari model aktif: hero CHAT_REPLY
    const chatCfg = configs.find((c) => c.task === 'CHAT_REPLY');
    try {
      const res = await apiRequest('/api/admin/ai-models/test', {
        method: 'POST',
        body: JSON.stringify({
          provider: activeProvider,
          modelName: chatCfg?.modelName,
          sampleScenario: scenario,
        }),
      });
      if (res.success) {
        setTestResult({ success: true, latencyMs: res.latencyMs, replySnippet: res.replySnippet, tokenEstimate: res.tokenEstimate, modelUsed: res.modelUsed, providerUsed: res.providerUsed });
      } else {
        setTestResult({ success: false, error: res.error || 'Gagal menguji model' });
      }
    } catch (err: any) {
      setTestResult({ success: false, error: err.message || String(err) });
    } finally {
      setTestingScenario(null);
    }
  };

  const heroChat = configs.find((c) => c.task === 'CHAT_REPLY');
  const heroModels = activeProvider === 'SUMOPOD' ? SUMOPOD_MODELS : KENARI_MODELS;

  return (
    <div className="bg-white dark:bg-[#111b21] rounded-xl border border-[#e9edef] dark:border-[#222e35] p-0 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-[#e9edef] dark:border-[#222e35]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-[#1a2a24] text-[#00a884] flex items-center justify-center">
            <Bot size={22} />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-[#111b21] dark:text-white">🤖 Pusat Kendali Model AI Bot (WhatsApp Response)</h2>
            <p className="text-xs text-[#667781] dark:text-[#8696a0]">Kelola karakter & kecepatan Bidan Yusi dengan 1 klik — tanpa istilah teknis membingungkan.</p>
          </div>
        </div>
        <button
          onClick={fetchConfigs}
          disabled={loading}
          className="p-2.5 text-[#667781] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-white hover:bg-[#f0f2f5] dark:hover:bg-[#202c33] rounded-xl transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          title="Segarkan data"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Status Server */}
      <div className="px-4 sm:px-6 py-4 bg-[#f8fafc] dark:bg-[#0a1014] border-b border-[#e9edef] dark:border-[#222e35]">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} className="text-[#00a884]" />
          <span className="text-xs font-bold text-[#111b21] dark:text-white tracking-wide">🩺 STATUS SERVER</span>
          {switchingProvider && (
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-[#00a884] font-medium">
              <RefreshCw size={12} className="animate-spin" /> Mengganti provider...
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            disabled={switchingProvider}
            onClick={() => handleSwitchProvider('SUMOPOD')}
            className={`p-3.5 rounded-xl border text-left transition-all min-h-[48px] flex flex-col justify-between ${
              activeProvider === 'SUMOPOD'
                ? 'border-[#00a884] bg-emerald-50/70 dark:bg-[#1a2a24] shadow-xs ring-1 ring-[#00a884]'
                : 'border-[#d1d7db] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34] hover:border-slate-400 opacity-90 hover:opacity-100'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <span className="text-base">⚡</span>
                <div>
                  <span className="text-xs font-bold text-[#111b21] dark:text-white block">Server Utama (SumoPod)</span>
                  <span className="text-[10px] text-[#667781] dark:text-[#8696a0] font-mono">https://ai.sumopod.com/v1</span>
                </div>
              </div>
              {activeProvider === 'SUMOPOD' ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#00a884] text-white">● Aktif</span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-[#202c33] text-[#667781] dark:text-[#8696a0]">Pilih</span>
              )}
            </div>
            <div className="flex items-center justify-between text-[11px] pt-1">
              <span className={providersStatus?.sumopod?.configured ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-slate-500 dark:text-[#8696a0]'}>
                {providersStatus?.sumopod?.configured ? '🟢 Kunci API Terhubung' : '○ Key di .env'}
              </span>
              <span className="text-[11px] text-[#667781] dark:text-[#8696a0]">Latensi P50: 1.1s • 5 model resmi</span>
            </div>
          </button>
          <button
            type="button"
            disabled={switchingProvider}
            onClick={() => handleSwitchProvider('KENARI')}
            className={`p-3.5 rounded-xl border text-left transition-all min-h-[48px] flex flex-col justify-between ${
              activeProvider === 'KENARI'
                ? 'border-[#00a884] bg-emerald-50/70 dark:bg-[#1a2a24] shadow-xs ring-1 ring-[#00a884]'
                : 'border-[#d1d7db] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34] hover:border-slate-400 opacity-90 hover:opacity-100'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <span className="text-base">🦜</span>
                <div>
                  <span className="text-xs font-bold text-[#111b21] dark:text-white block">Server Cadangan (Kenari)</span>
                  <span className="text-[10px] text-[#667781] dark:text-[#8696a0] font-mono">https://kenari.id/v1</span>
                </div>
              </div>
              {activeProvider === 'KENARI' ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#00a884] text-white">● Aktif</span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-[#202c33] text-[#667781] dark:text-[#8696a0]">Pilih</span>
              )}
            </div>
            <div className="flex items-center justify-between text-[11px] pt-1">
              <span className={providersStatus?.kenari?.configured ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-slate-500 dark:text-[#8696a0]'}>
                {providersStatus?.kenari?.configured ? '🟢 Kunci API Terhubung' : '○ Key di .env'}
              </span>
              <span className="text-[11px] text-[#667781] dark:text-[#8696a0]">Auto-failover siaga bila SumoPod gangguan</span>
            </div>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs text-[#8696a0] dark:text-[#667781]">
          <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-[#00a884]" />
          Memuat konfigurasi model AI...
        </div>
      ) : (
        <>
          {/* Section 1: Pilih Mode Kerja Bot (1-Click Presets) */}
          <div className="px-4 sm:px-6 py-5">
            <h3 className="text-sm font-bold text-[#111b21] dark:text-white flex items-center gap-2 mb-3">
              <Zap size={16} className="text-amber-500" /> PILIH MODE KERJA BOT (1-CLICK PRESETS)
            </h3>
            <div className="grid grid-cols-1 gap-3">
              {PRESET_CARDS.map((preset) => {
                const isSelected = selectedPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset.id)}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all min-h-[48px] ${
                      isSelected
                        ? 'border-[#00a884] bg-emerald-50/50 dark:bg-[#1a2a24] ring-1 ring-[#00a884]'
                        : 'border-[#e9edef] dark:border-[#2a3942] bg-[#f8fafc] dark:bg-[#1f2c34] hover:border-emerald-200 dark:hover:border-[#00a884]/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <span className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? 'border-[#00a884] bg-[#00a884]' : 'border-[#d1d7db] dark:border-[#2a3942] bg-white dark:bg-[#111b21]'}`}>
                          {isSelected && <Check size={12} className="text-white" />}
                        </span>
                        <div>
                          <div className="text-sm font-bold text-[#111b21] dark:text-white flex items-center gap-1">
                            {preset.title} {preset.star && <span className="text-amber-500">⭐</span>}
                          </div>
                          <div className="text-xs text-[#667781] dark:text-[#8696a0] mt-0.5">Model: <strong className="text-[#111b21] dark:text-white font-mono">{preset.model}</strong></div>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-white dark:bg-[#0a1014] border border-[#e9edef] dark:border-[#222e35] text-[#111b21] dark:text-white">
                              {preset.icon} {preset.speed}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-white dark:bg-[#0a1014] border border-[#e9edef] dark:border-[#222e35] text-[#111b21] dark:text-white">
                              💬 {preset.charm}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-white dark:bg-[#0a1014] border border-[#e9edef] dark:border-[#222e35] text-[#111b21] dark:text-white">
                              💰 {preset.cost}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#8696a0] dark:text-[#667781] mt-1">{preset.note}</div>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
              {/* Kartu Mode Darurat — hanya saat server cadangan Kenari aktif */}
              {activeProvider === 'KENARI' && (() => {
                const preset = FAILOVER_CARD;
                const isSelected = selectedPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset.id)}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all min-h-[48px] ${
                      isSelected
                        ? 'border-[#00a884] bg-emerald-50/50 dark:bg-[#1a2a24] ring-1 ring-[#00a884]'
                        : 'border-[#e9edef] dark:border-[#2a3942] bg-[#f8fafc] dark:bg-[#1f2c34] hover:border-emerald-200 dark:hover:border-[#00a884]/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <span className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? 'border-[#00a884] bg-[#00a884]' : 'border-[#d1d7db] dark:border-[#2a3942] bg-white dark:bg-[#111b21]'}`}>
                          {isSelected && <Check size={12} className="text-white" />}
                        </span>
                        <div>
                          <div className="text-sm font-bold text-[#111b21] dark:text-white flex items-center gap-1">
                            {preset.title}
                          </div>
                          <div className="text-xs text-[#667781] dark:text-[#8696a0] mt-0.5">Model: <strong className="text-[#111b21] dark:text-white font-mono">{preset.model}</strong></div>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-white dark:bg-[#0a1014] border border-[#e9edef] dark:border-[#222e35] text-[#111b21] dark:text-white">
                              {preset.icon} {preset.speed}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-white dark:bg-[#0a1014] border border-[#e9edef] dark:border-[#222e35] text-[#111b21] dark:text-white">
                              💬 {preset.charm}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-white dark:bg-[#0a1014] border border-[#e9edef] dark:border-[#222e35] text-[#111b21] dark:text-white">
                              💰 {preset.cost}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#8696a0] dark:text-[#667781] mt-1">{preset.note}</div>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })()}
              {/* Indikator Mode Kustom — model/parameter manual di luar preset standar */}
              {selectedPreset === 'CUSTOM' && (
                <div className="w-full text-left p-4 rounded-xl border-2 border-dashed border-[#d1d7db] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34] min-h-[48px]">
                  <div className="text-sm font-bold text-[#111b21] dark:text-white flex items-center gap-1">
                    🎛️ Mode Kustom (Manual)
                  </div>
                  <div className="text-xs text-[#667781] dark:text-[#8696a0] mt-0.5">
                    Model dan parameter disesuaikan secara manual di luar preset standar klinik. Pilihan ini tidak akan ditimpa saat menyimpan.
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Hero Card: Model Balasan Chat Utama */}
          {heroChat && (
            <div className="px-4 sm:px-6 pb-4">
              <div className="p-4 rounded-xl border border-[#00a884]/30 bg-gradient-to-br from-emerald-50 to-white dark:from-[#1a2a24] dark:to-[#111b21] dark:border-[#00a884]/20">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#00a884] text-white">💬 Hero</span>
                  <span className="text-xs font-bold text-[#111b21] dark:text-white">Model Balasan WhatsApp Bidan Yusi</span>
                  <span className="ml-auto text-[10px] text-[#667781] dark:text-[#8696a0]">Aktif merespons chat pasien</span>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                  <div className="flex-1">
                    <div className="text-sm font-mono font-bold text-[#111b21] dark:text-white">{heroChat.modelName}</div>
                    <div className="text-xs text-[#667781] dark:text-[#8696a0] mt-0.5">Provider: <strong className="text-[#111b21] dark:text-white">{heroChat.provider}</strong> • Temp: {heroChat.temperature} • MaxTokens: {heroChat.maxTokens}</div>
                  </div>
                  <select
                    value={heroChat.modelName}
                    onChange={(e) => handleChangeAdvanced('CHAT_REPLY', 'modelName', e.target.value)}
                    className="w-full sm:w-56 bg-white dark:bg-[#0a1014] border border-[#d1d7db] dark:border-[#2a3942] rounded-xl px-3 py-2.5 text-xs font-mono text-[#111b21] dark:text-white focus:outline-none focus:border-[#00a884] min-h-[48px]"
                  >
                    {heroModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Mini Simulator */}
          <div className="px-4 sm:px-6 py-4 border-t border-[#e9edef] dark:border-[#222e35] bg-[#f8fafc] dark:bg-[#0a1014]">
            <div className="flex items-center gap-2 mb-3">
              <Beaker size={16} className="text-[#00a884]" />
              <h3 className="text-xs font-bold text-[#111b21] dark:text-white tracking-wide">🧪 UJI RESPON MODEL SEBELUM MENYIMPAN (MINI SIMULATOR 1 DETIK)</h3>
            </div>
            <p className="text-xs text-[#667781] dark:text-[#8696a0] mb-3">Uji skenario pasien — lihat balasan & latensi nyata sebelum menyentuh chat WhatsApp asli:</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {(['flu','price','schedule'] as TestScenario[]).map((sc) => {
                const labels: Record<TestScenario,string> = { flu: '🤧 Tanya Bapil', price: '💰 Tanya Harga', schedule: '📅 Tanya Jadwal' };
                const isTesting = testingScenario === sc;
                return (
                  <button
                    key={sc}
                    type="button"
                    disabled={!!testingScenario}
                    onClick={() => handleTestScenario(sc)}
                    className={`px-4 py-2.5 rounded-xl text-xs font-semibold border transition-all min-h-[48px] min-w-[48px] ${
                      isTesting
                        ? 'bg-amber-50 dark:bg-[#2a2414] border-amber-200 dark:border-amber-700/50 text-amber-700 dark:text-amber-300'
                        : 'bg-white dark:bg-[#1f2c34] border-[#d1d7db] dark:border-[#2a3942] text-[#111b21] dark:text-white hover:border-[#00a884] hover:bg-emerald-50 dark:hover:bg-[#1a2a24]'
                    }`}
                  >
                    {isTesting ? <span className="inline-flex items-center gap-1"><RefreshCw size={12} className="animate-spin" /> Menghubungi model AI...</span> : labels[sc]}
                  </button>
                );
              })}
            </div>
            {/* Pulse loading */}
            {testingScenario && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-[#2a2414] border border-amber-200 dark:border-amber-900/30 text-xs text-amber-800 dark:text-amber-200 animate-pulse">
                Menghubungi model AI... mohon tunggu 1–2 detik ⏳
              </div>
            )}
            {testResult && !testingScenario && (
              <div className={`p-3 rounded-xl border text-xs ${testResult.success ? 'bg-emerald-50 dark:bg-[#14261f] border-emerald-200 dark:border-emerald-900/40 text-[#111b21] dark:text-white' : 'bg-red-50 dark:bg-[#2a1414] border-red-200 dark:border-red-900/40 text-red-800 dark:text-red-200'}`}>
                {testResult.success ? (
                  <>
                    <div className="font-semibold flex items-center gap-1 mb-1">✅ Model Berfungsi Normal {testResult.latencyMs !== undefined && <span className="ml-1 px-1.5 py-0.5 rounded bg-white dark:bg-[#0a1014] border text-[11px] font-mono">Latensi: {(testResult.latencyMs!/1000).toFixed(2)} detik • Token: {testResult.tokenEstimate ?? '-'} • {testResult.modelUsed} ({testResult.providerUsed})</span>}</div>
                    <div className="bg-white dark:bg-[#0a1014] rounded-lg p-2.5 border border-[#e9edef] dark:border-[#222e35] text-[#111b21] dark:text-white leading-relaxed">
                      Bidan Yusi: &quot;{testResult.replySnippet}&quot;
                    </div>
                  </>
                ) : (
                  <><span className="font-semibold">❌ Gagal:</span> {testResult.error}</>
                )}
              </div>
            )}
            {!testResult && !testingScenario && (
              <div className="p-3 rounded-xl bg-white dark:bg-[#1f2c34] border border-dashed border-[#d1d7db] dark:border-[#2a3942] text-xs text-[#8696a0] dark:text-[#667781] text-center">
                Klik salah satu skenario di atas untuk melihat preview balasan Bidan Yusi ✨
              </div>
            )}
          </div>

          {/* Collapsible Advanced */}
          <div className="px-4 sm:px-6 py-3 border-t border-[#e9edef] dark:border-[#222e35]">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between gap-2 px-3 py-3 rounded-xl bg-white dark:bg-[#1f2c34] border border-[#e9edef] dark:border-[#2a3942] text-xs font-semibold text-[#111b21] dark:text-white hover:bg-[#f8fafc] dark:hover:bg-[#202c33] transition-colors min-h-[48px]"
            >
              <span className="flex items-center gap-2">{showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />} ⚙️ Pengaturan Teknis Lanjutan (NLU Extractor, QC Verifier, Summarizer)</span>
              <span className="text-[11px] text-[#667781] dark:text-[#8696a0]">{showAdvanced ? 'Tutup' : 'Buka'}</span>
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-3">
                {/* Sugesti katalog resmi — cegah typo nama model, tetap fleksibel untuk kustom */}
                <datalist id="ai-model-suggestions">
                  {SUMOPOD_MODELS.map((m) => (
                    <option key={`sumopod-${m}`} value={m}>SumoPod (Utama) — {m}</option>
                  ))}
                  {KENARI_MODELS.map((m) => (
                    <option key={`kenari-${m}`} value={m}>Kenari (Cadangan) — {m}</option>
                  ))}
                  <option value="gpt-4o-mini">OpenAI (NLU) — gpt-4o-mini</option>
                  <option value="deepseek-chat">DeepSeek Direct — deepseek-chat</option>
                </datalist>
                {configs.map((cfg) => {
                  const meta = TASK_LABELS[cfg.task] || { label: cfg.task, badge: cfg.task };
                  const isChatHero = cfg.task === 'CHAT_REPLY';
                  // Proteksi Call 1 NLU: INTENT_CLASSIFICATION terkunci ke OpenAI gpt-4o-mini
                  // demi P50 1.8s — provider tidak boleh diganti dari UI.
                  const isNluLocked = cfg.task === 'INTENT_CLASSIFICATION';
                  return (
                    <div key={cfg.task} className={`p-3 rounded-xl border ${isChatHero ? 'border-[#00a884]/30 bg-emerald-50/30 dark:bg-[#1a2a24]/50' : 'border-[#e9edef] dark:border-[#222e35] bg-[#f8fafc] dark:bg-[#1f2c34]'} transition-all`}>
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="text-xs font-bold text-[#111b21] dark:text-white">{meta.label}</span>
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-[#143d2f] text-emerald-800 dark:text-emerald-300">{meta.badge}</span>
                        {isChatHero && <span className="text-[10px] text-[#00a884] font-semibold">— Hero (disinkron preset)</span>}
                        {isNluLocked && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-[#2a2414] text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-700/50">🔒 Terkunci ke OpenAI gpt-4o-mini demi P50 1.8s</span>}
                      </div>
                      <p className="text-[11px] text-[#667781] dark:text-[#8696a0] mb-2">{cfg.description}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                        <div>
                          <label className="block text-[11px] font-semibold text-[#667781] dark:text-[#8696a0] mb-1">Provider AI</label>
                          <select
                            value={cfg.provider}
                            disabled={isNluLocked}
                            onChange={(e) => handleChangeAdvanced(cfg.task, 'provider', e.target.value)}
                            className="w-full bg-white dark:bg-[#0a1014] border border-[#d1d7db] dark:border-[#2a3942] rounded-lg px-3 py-2.5 text-[#111b21] dark:text-white focus:outline-none focus:border-[#00a884] min-h-[44px] disabled:opacity-60"
                          >
                            <option value="SumoPod">SumoPod (Server Utama Klinik)</option>
                            <option value="Kenari">Kenari (Server Cadangan)</option>
                            <option value="OpenAI">OpenAI (Server NLU)</option>
                            <option value="DeepSeek">DeepSeek (Direct Fallback)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-[#667781] dark:text-[#8696a0] mb-1">Nama Model</label>
                          <input
                            type="text"
                            value={cfg.modelName}
                            list="ai-model-suggestions"
                            onChange={(e) => handleChangeAdvanced(cfg.task, 'modelName', e.target.value)}
                            placeholder="Pilih dari katalog resmi"
                            className="w-full bg-white dark:bg-[#0a1014] border border-[#d1d7db] dark:border-[#2a3942] rounded-lg px-3 py-2.5 text-[#111b21] dark:text-white font-mono text-xs focus:outline-none focus:border-[#00a884] min-h-[44px]"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-[#667781] dark:text-[#8696a0] mb-1">Temperature ({cfg.temperature})</label>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={cfg.temperature}
                            onChange={(e) => handleChangeAdvanced(cfg.task, 'temperature', parseFloat(e.target.value))}
                            className="w-full accent-[#00a884] h-2 bg-slate-200 dark:bg-[#2a3942] rounded-lg cursor-pointer mt-2"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-[#667781] dark:text-[#8696a0] mb-1">Max Tokens</label>
                          <input
                            type="number"
                            value={cfg.maxTokens}
                            onChange={(e) => handleChangeAdvanced(cfg.task, 'maxTokens', parseInt(e.target.value, 10) || 512)}
                            className="w-full bg-white dark:bg-[#0a1014] border border-[#d1d7db] dark:border-[#2a3942] rounded-lg px-3 py-2.5 text-[#111b21] dark:text-white focus:outline-none focus:border-[#00a884] min-h-[44px]"
                          />
                        </div>
                        {cfg.confidenceThreshold !== undefined && (
                          <div>
                            <label className="block text-[11px] font-semibold text-[#667781] dark:text-[#8696a0] mb-1">
                              Confidence Threshold ({Number(cfg.confidenceThreshold).toFixed(2)})
                            </label>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.05"
                              value={cfg.confidenceThreshold}
                              onChange={(e) => handleChangeAdvanced(cfg.task, 'confidenceThreshold', parseFloat(e.target.value))}
                              className="w-full accent-[#00a884] h-2 bg-slate-200 dark:bg-[#2a3942] rounded-lg cursor-pointer mt-2"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="px-4 sm:px-6 py-4 border-t border-[#e9edef] dark:border-[#222e35] bg-white dark:bg-[#111b21] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetDefaults}
                disabled={resetting || savingAll}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl border border-[#d1d7db] dark:border-[#2a3942] bg-white dark:bg-[#1f2c34] text-[#111b21] dark:text-white text-xs font-semibold hover:bg-slate-50 dark:hover:bg-[#202c33] transition-colors disabled:opacity-50 min-h-[48px]"
              >
                {resetting ? <RefreshCw size={14} className="animate-spin" /> : <RotateCcw size={14} />} Kembalikan ke Rekomendasi Default
              </button>
            </div>
            <div className="flex flex-col items-stretch sm:items-end gap-1.5 flex-1">
              <button
                type="button"
                onClick={handleSaveAll}
                disabled={savingAll || resetting || !dirty}
                className={`inline-flex items-center justify-center gap-1.5 px-6 py-3 rounded-xl text-xs font-bold shadow-sm dark:shadow-none transition-all min-h-[48px] ${
                  dirty ? 'bg-[#00a884] hover:bg-[#008f6f] text-white shadow-emerald-200 dark:shadow-none' : 'bg-slate-200 dark:bg-[#2a3942] text-[#667781] dark:text-[#8696a0] cursor-not-allowed'
                } disabled:opacity-60`}
              >
                {savingAll ? (<><RefreshCw size={14} className="animate-spin" /> Menyimpan...</>) : (<><Save size={14} /> 💾 Simpan Semua Perubahan</>)}
              </button>
              <span className="text-[11px] text-[#667781] dark:text-[#8696a0] text-center sm:text-right">
                ✨ Perubahan langsung aktif pada pesan WhatsApp berikutnya tanpa perlu restart {dirty && <span className="text-amber-600 dark:text-amber-400 font-semibold">• Ada perubahan belum disimpan</span>}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
