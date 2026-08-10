import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { RefreshCw, Star, MessageSquare, DollarSign, Zap, Activity, Cpu } from 'lucide-react';

interface AiEvaluationEntry {
  id: string;
  message_id: string;
  customer_phone: string | null;
  message_text: string;
  ai_reasoning: string | null;
  score: number;
  feedback: string | null;
  created_at: string;
}

interface AiEvaluationsResponse {
  total: number;
  avgScore: number;
  minScore: number;
  maxScore: number;
  recent: AiEvaluationEntry[];
}

interface LlmAuditLogEntry {
  id: string;
  tenant_id: string;
  customer_phone: string;
  conversation_id: string | null;
  provider?: string | null;
  model_name: string;
  task_type: string;
  prompt_tokens: number;
  completion_tokens: number;
  cached_prompt_tokens?: number;
  cost_idr: number;
  created_at: string;
}

interface AiAuditSummaryResponse {
  days: number;
  totalLogs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCostIdr: number;
  recent: LlmAuditLogEntry[];
}

const scoreColor = (s: number) => {
  if (s >= 4) return 'text-emerald-400';
  if (s >= 3) return 'text-amber-400';
  return 'text-rose-400';
};

const getModelProvider = (log: LlmAuditLogEntry) => {
  return log.provider || 'LLM Provider';
};

const formatRupiah = (val: number) => {
  if (val == null || isNaN(val)) return 'Rp 0';
  return 'Rp ' + val.toLocaleString('id-ID', { maximumFractionDigits: 2 });
};

export const AiEvaluations: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'usage' | 'quality'>('usage');
  const [days, setDays] = useState(7);
  const [summary, setSummary] = useState<AiEvaluationsResponse | null>(null);
  const [auditSummary, setAuditSummary] = useState<AiAuditSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [evalRes, auditRes] = await Promise.all([
        apiRequest(`ai-evaluations?days=${days}&limit=100`).catch(() => null),
        apiRequest(`ai-audit-summary?days=${days}&limit=50`).catch(() => null),
      ]);
      if (evalRes?.data) setSummary(evalRes.data);
      if (auditRes?.data) setAuditSummary(auditRes.data);
    } catch (err: any) {
      console.warn('Gagal load AI metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [days]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-white flex items-center gap-2">
            <Cpu className="text-pink-400" size={24} />
            <span>AI Monitoring &amp; Usage Dashboard</span>
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Pantau pemakaian token, estimasi biaya (Rupiah), dan kualitas balasan AI secara real-time.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-xl bg-slate-900/80 border border-white/10 p-1">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  days === d ? 'bg-pink-500 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                {d} Hari
              </button>
            ))}
          </div>
          <button
            onClick={loadData}
            className="flex items-center gap-2 px-4 py-2 bg-pink-500 hover:bg-pink-600 rounded-xl text-xs font-bold text-white transition shadow shadow-pink-500/20"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-2 border-b border-white/10 pb-2">
        <button
          onClick={() => setActiveTab('usage')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
            activeTab === 'usage'
              ? 'bg-pink-500/10 border border-pink-500/30 text-pink-400'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <DollarSign size={16} />
          <span>Real-Time AI Usage &amp; Biaya (Rp)</span>
        </button>
        <button
          onClick={() => setActiveTab('quality')}
          className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
            activeTab === 'quality'
              ? 'bg-pink-500/10 border border-pink-500/30 text-pink-400'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Star size={16} />
          <span>Kualitas Balasan (LLM-as-Judge)</span>
        </button>
      </div>

      {/* TAB 1: REAL-TIME AI USAGE & COST */}
      {activeTab === 'usage' && (
        <div className="space-y-6">
          {/* Stat Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="rounded-2xl bg-emerald-500/5 border border-emerald-500/20 p-5">
              <p className="text-xs uppercase tracking-wider text-emerald-400 font-bold flex items-center gap-1.5">
                <DollarSign size={14} /> Total Est. Biaya (Rp)
              </p>
              <p className="text-3xl font-extrabold text-white mt-2">
                {formatRupiah(auditSummary?.totalCostIdr || 0)}
              </p>
              <p className="text-xs text-slate-400 mt-1">Estimasi biaya {days} hari terakhir</p>
            </div>

            <div className="rounded-2xl bg-pink-500/5 border border-pink-500/20 p-5">
              <p className="text-xs uppercase tracking-wider text-pink-400 font-bold flex items-center gap-1.5">
                <Zap size={14} /> Total Tokens
              </p>
              <p className="text-3xl font-extrabold text-white mt-2">
                {(auditSummary?.totalTokens || 0).toLocaleString('id-ID')}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                In: {(auditSummary?.totalPromptTokens || 0).toLocaleString('id-ID')} | Out:{' '}
                {(auditSummary?.totalCompletionTokens || 0).toLocaleString('id-ID')}
              </p>
            </div>

            <div className="rounded-2xl bg-indigo-500/5 border border-indigo-500/20 p-5">
              <p className="text-xs uppercase tracking-wider text-indigo-400 font-bold flex items-center gap-1.5">
                <Activity size={14} /> Total Panggilan AI
              </p>
              <p className="text-3xl font-extrabold text-white mt-2">
                {(auditSummary?.totalLogs || 0).toLocaleString('id-ID')}
              </p>
              <p className="text-xs text-slate-400 mt-1">Transaksi NLU, Routing &amp; Chat</p>
            </div>

            <div className="rounded-2xl bg-slate-900/60 border border-white/10 p-5">
              <p className="text-xs uppercase tracking-wider text-slate-400 font-bold">Rata-rata per Call</p>
              <p className="text-3xl font-extrabold text-white mt-2">
                {auditSummary?.totalLogs
                  ? formatRupiah(auditSummary.totalCostIdr / auditSummary.totalLogs)
                  : 'Rp 0'}
              </p>
              <p className="text-xs text-slate-500 mt-1">Biaya per eksekusi AI</p>
            </div>
          </div>

          {/* Audit Logs Table */}
          <div className="rounded-2xl bg-slate-900/60 border border-white/10 overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 text-sm font-bold text-white flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Activity size={16} className="text-pink-400" /> Audit Log Transaksi AI Terbaru ({auditSummary?.recent?.length || 0})
              </span>
              <span className="text-xs text-slate-500">Log tersimpan di tabel llm_audit_logs</span>
            </div>

            {!auditSummary || (auditSummary.recent || []).length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">
                Belum ada log transaksi AI tercatat dalam {days} hari terakhir.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-white/10 bg-slate-950/40">
                      <th className="px-5 py-3 font-bold">Waktu</th>
                      <th className="px-5 py-3 font-bold">Tugas / Task</th>
                      <th className="px-5 py-3 font-bold">Model AI</th>
                      <th className="px-5 py-3 font-bold">Customer Phone</th>
                      <th className="px-5 py-3 font-bold text-right">Tokens (In / Out)</th>
                      <th className="px-5 py-3 font-bold text-right">Biaya (Rp)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditSummary.recent.map((log) => (
                      <tr key={log.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                        <td className="px-5 py-3 text-xs text-slate-400 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' })}
                        </td>
                        <td className="px-5 py-3">
                          <span className="px-2 py-0.5 rounded bg-pink-500/10 border border-pink-500/20 text-pink-400 text-xs font-mono font-bold">
                            {log.task_type}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-200 font-mono font-medium">
                          <span className="text-[10px] text-pink-400 font-sans block font-semibold">
                            {getModelProvider(log)}
                          </span>
                          <span>{log.model_name}</span>
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-400 font-mono">
                          {log.customer_phone}
                        </td>
                        <td className="px-5 py-3 text-right text-xs font-mono text-slate-300">
                          <div className="flex items-center justify-end gap-1.5">
                            {log.cached_prompt_tokens && log.cached_prompt_tokens > 0 ? (
                              <span
                                className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full"
                                title={`Cache Hit (${log.cached_prompt_tokens} tokens)`}
                              >
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                <span>Hit</span>
                              </span>
                            ) : (
                              <span
                                className="flex items-center gap-1 text-[10px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded-full"
                                title="Cache Miss"
                              >
                                <span className="w-2 h-2 rounded-full bg-rose-500" />
                                <span>Miss</span>
                              </span>
                            )}
                            <span>{log.prompt_tokens} in / {log.completion_tokens} out</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right font-bold text-emerald-400 text-xs">
                          {formatRupiah(log.cost_idr)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: AI QUALITY SCORE (LLM-AS-JUDGE) */}
      {activeTab === 'quality' && (
        <div className="space-y-6">
          {!summary ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-pulse">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-20 bg-white/5 border border-white/10 rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-2xl bg-white/5 border border-white/10 p-5">
                <p className="text-xs uppercase tracking-wider text-slate-400 font-bold">Total Evaluated</p>
                <p className={`text-3xl font-extrabold mt-1 ${scoreColor(summary.avgScore)}`}>{summary.total}</p>
                <p className="text-xs text-slate-500 mt-1">Pesan yang dinilai dalam rentang ini</p>
              </div>

              <div className="rounded-2xl bg-white/5 border border-white/10 p-5">
                <p className="text-xs uppercase tracking-wider text-slate-400 font-bold">Skor Rata-rata</p>
                <p className={`text-3xl font-extrabold mt-1 ${scoreColor(summary.avgScore)}`}>
                  {summary.avgScore.toFixed(1)}
                </p>
                <p className="text-xs text-slate-500 mt-1">Skor 0-5 (&gt;3 = cukup baik)</p>
              </div>

              <div className="rounded-2xl bg-white/5 border border-white/10 p-5">
                <p className="text-xs uppercase tracking-wider text-slate-400 font-bold">Rentang Skor</p>
                <p className={`text-3xl font-extrabold mt-1 ${scoreColor(summary.avgScore)}`}>
                  {summary.minScore.toFixed(0)} – {summary.maxScore.toFixed(0)}
                </p>
                <p className="text-xs text-slate-500 mt-1">Skor terendah - tertinggi</p>
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-slate-900/60 border border-white/10 overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 text-sm font-bold text-white flex items-center gap-2">
              <MessageSquare size={16} className="text-pink-400" /> Evaluasi Terbaru ({days} hari terakhir)
            </div>
            {!summary || (summary.recent || []).length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">
                Belum ada evaluasi. Aktifkan <code className="text-slate-300">ENABLE_AI_EVAL_CRON=true</code> atau jalankan sample evaluation.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-white/10 bg-slate-950/40">
                      <th className="px-5 py-3 font-bold">Skor</th>
                      <th className="px-5 py-3 font-bold">Pesan (jawaban bot)</th>
                      <th className="px-5 py-3 font-bold">Alasan / Feedback</th>
                      <th className="px-5 py-3 font-bold text-right">Waktu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary.recent || []).map((e) => (
                      <tr key={e.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <Star
                                key={n}
                                size={14}
                                fill={n <= e.score ? 'currentColor' : 'none'}
                                className={n <= e.score ? scoreColor(e.score) : 'text-slate-700'}
                              />
                            ))}
                          </div>
                        </td>
                        <td className="px-5 py-3 max-w-xs">
                          <p className="text-slate-200 line-clamp-2">{e.message_text}</p>
                          {e.customer_phone && <p className="text-xs text-slate-500 mt-1">{e.customer_phone}</p>}
                        </td>
                        <td className="px-5 py-3 max-w-sm">
                          {e.feedback && <p className="text-xs text-slate-300 line-clamp-3">{e.feedback}</p>}
                          {e.ai_reasoning && (
                            <p className="text-xs text-slate-500 mt-1 italic line-clamp-2">
                              reasoning: {e.ai_reasoning}
                            </p>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right text-xs text-slate-500 whitespace-nowrap">
                          {new Date(e.created_at).toLocaleString('id-ID')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};