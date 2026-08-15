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
  if (s >= 4) return 'text-emerald-600';
  if (s >= 3) return 'text-amber-600';
  return 'text-rose-600';
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[#111b21] flex items-center gap-2">
            <Cpu className="text-[#008069]" size={22} />
            <span>AI Monitoring &amp; Usage Dashboard</span>
          </h2>
          <p className="text-xs text-[#667781] mt-0.5">
            Pantau pemakaian token, estimasi biaya (Rupiah), dan kualitas balasan AI secara real-time.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-xl bg-white border border-[#d1d7db] p-1 shadow-xs">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                  days === d ? 'bg-[#008069] text-white shadow-xs' : 'text-[#54656f] hover:text-[#111b21]'
                }`}
              >
                {d} Hari
              </button>
            ))}
          </div>
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] rounded-xl text-xs font-semibold text-[#111b21] transition shadow-xs"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin text-[#008069]' : 'text-[#667781]'} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-2 border-b border-[#e9edef] pb-2">
        <button
          onClick={() => setActiveTab('usage')}
          className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
            activeTab === 'usage'
              ? 'bg-[#e8f5f2] border border-[#c2e7e0] text-[#008069]'
              : 'text-[#54656f] hover:text-[#111b21]'
          }`}
        >
          <DollarSign size={15} />
          <span>Real-Time AI Usage &amp; Biaya (Rp)</span>
        </button>
        <button
          onClick={() => setActiveTab('quality')}
          className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
            activeTab === 'quality'
              ? 'bg-[#e8f5f2] border border-[#c2e7e0] text-[#008069]'
              : 'text-[#54656f] hover:text-[#111b21]'
          }`}
        >
          <Star size={15} />
          <span>Kualitas Balasan (LLM-as-Judge)</span>
        </button>
      </div>

      {/* TAB 1: REAL-TIME AI USAGE & COST */}
      {activeTab === 'usage' && (
        <div className="space-y-6">
          {/* Stat Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="rounded-2xl bg-white border border-[#e9edef] p-4 shadow-xs">
              <p className="text-[11px] uppercase tracking-wider text-[#008069] font-bold flex items-center gap-1.5">
                <DollarSign size={13} /> Total Est. Biaya (Rp)
              </p>
              <p className="text-2xl font-bold text-[#111b21] mt-1.5">
                {formatRupiah(auditSummary?.totalCostIdr || 0)}
              </p>
              <p className="text-[11px] text-[#8696a0] mt-0.5">Estimasi biaya {days} hari terakhir</p>
            </div>

            <div className="rounded-2xl bg-white border border-[#e9edef] p-4 shadow-xs">
              <p className="text-[11px] uppercase tracking-wider text-sky-700 font-bold flex items-center gap-1.5">
                <Zap size={13} /> Total Tokens
              </p>
              <p className="text-2xl font-bold text-[#111b21] mt-1.5">
                {(auditSummary?.totalTokens || 0).toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-[#8696a0] mt-0.5">
                In: {(auditSummary?.totalPromptTokens || 0).toLocaleString('id-ID')} | Out:{' '}
                {(auditSummary?.totalCompletionTokens || 0).toLocaleString('id-ID')}
              </p>
            </div>

            <div className="rounded-2xl bg-white border border-[#e9edef] p-4 shadow-xs">
              <p className="text-[11px] uppercase tracking-wider text-purple-700 font-bold flex items-center gap-1.5">
                <Activity size={13} /> Total Panggilan AI
              </p>
              <p className="text-2xl font-bold text-[#111b21] mt-1.5">
                {(auditSummary?.totalLogs || 0).toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-[#8696a0] mt-0.5">Transaksi NLU, Routing &amp; Chat</p>
            </div>

            <div className="rounded-2xl bg-white border border-[#e9edef] p-4 shadow-xs">
              <p className="text-[11px] uppercase tracking-wider text-[#54656f] font-bold">Rata-rata per Call</p>
              <p className="text-2xl font-bold text-[#111b21] mt-1.5">
                {auditSummary?.totalLogs
                  ? formatRupiah(auditSummary.totalCostIdr / auditSummary.totalLogs)
                  : 'Rp 0'}
              </p>
              <p className="text-[11px] text-[#8696a0] mt-0.5">Biaya per eksekusi AI</p>
            </div>
          </div>

          {/* Audit Logs Table */}
          <div className="rounded-2xl bg-white border border-[#e9edef] overflow-hidden shadow-xs">
            <div className="px-5 py-3.5 border-b border-[#e9edef] text-xs font-bold text-[#111b21] uppercase flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Activity size={14} className="text-[#008069]" /> Audit Log Transaksi AI Terbaru ({auditSummary?.recent?.length || 0})
              </span>
              <span className="text-[10px] text-[#8696a0]">Log tersimpan di tabel llm_audit_logs</span>
            </div>

            {!auditSummary || (auditSummary.recent || []).length === 0 ? (
              <div className="p-8 text-center text-xs text-[#8696a0]">
                Belum ada log transaksi AI tercatat dalam {days} hari terakhir.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-[#667781] border-b border-[#e9edef] bg-[#f8fafc]">
                      <th className="px-4 py-2.5 font-bold">Waktu</th>
                      <th className="px-4 py-2.5 font-bold">Tugas / Task</th>
                      <th className="px-4 py-2.5 font-bold">Model AI</th>
                      <th className="px-4 py-2.5 font-bold">Customer Phone</th>
                      <th className="px-4 py-2.5 font-bold text-right">Tokens (In / Out)</th>
                      <th className="px-4 py-2.5 font-bold text-right">Biaya (Rp)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e9edef]">
                    {auditSummary.recent.map((log) => (
                      <tr key={log.id} className="hover:bg-[#f8fafc] transition-colors">
                        <td className="px-4 py-2.5 text-[#667781] whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' })}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="px-2 py-0.5 rounded-full bg-[#e8f5f2] border border-[#c2e7e0] text-[#008069] text-[10px] font-mono font-bold">
                            {log.task_type}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[#111b21]">
                          <span className="text-[10px] text-[#667781] font-sans block font-semibold">
                            {getModelProvider(log)}
                          </span>
                          <span>{log.model_name}</span>
                        </td>
                        <td className="px-4 py-2.5 text-[#667781] font-mono">
                          {log.customer_phone}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-[#54656f]">
                          <div className="flex items-center justify-end gap-1.5">
                            {log.cached_prompt_tokens && log.cached_prompt_tokens > 0 ? (
                              <span
                                className="flex items-center gap-1 text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full"
                                title={`Cache Hit (${log.cached_prompt_tokens} tokens)`}
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                                <span>Hit</span>
                              </span>
                            ) : (
                              <span
                                className="flex items-center gap-1 text-[10px] text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full"
                                title="Cache Miss"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
                                <span>Miss</span>
                              </span>
                            )}
                            <span>{log.prompt_tokens} in / {log.completion_tokens} out</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold text-[#008069]">
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
                <div key={i} className="h-20 bg-white border border-[#e9edef] rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-2xl bg-white border border-[#e9edef] p-4 shadow-xs">
                <p className="text-[11px] uppercase tracking-wider text-[#667781] font-bold">Total Evaluated</p>
                <p className={`text-2xl font-bold mt-1 ${scoreColor(summary.avgScore)}`}>{summary.total}</p>
                <p className="text-[11px] text-[#8696a0] mt-0.5">Pesan yang dinilai dalam rentang ini</p>
              </div>

              <div className="rounded-2xl bg-white border border-[#e9edef] p-4 shadow-xs">
                <p className="text-[11px] uppercase tracking-wider text-[#667781] font-bold">Skor Rata-rata</p>
                <p className={`text-2xl font-bold mt-1 ${scoreColor(summary.avgScore)}`}>
                  {summary.avgScore.toFixed(1)}
                </p>
                <p className="text-[11px] text-[#8696a0] mt-0.5">Skor 0-5 (&gt;3 = cukup baik)</p>
              </div>

              <div className="rounded-2xl bg-white border border-[#e9edef] p-4 shadow-xs">
                <p className="text-[11px] uppercase tracking-wider text-[#667781] font-bold">Rentang Skor</p>
                <p className={`text-2xl font-bold mt-1 ${scoreColor(summary.avgScore)}`}>
                  {summary.minScore.toFixed(0)} – {summary.maxScore.toFixed(0)}
                </p>
                <p className="text-[11px] text-[#8696a0] mt-0.5">Skor terendah - tertinggi</p>
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-white border border-[#e9edef] overflow-hidden shadow-xs">
            <div className="px-5 py-3.5 border-b border-[#e9edef] text-xs font-bold text-[#111b21] uppercase flex items-center gap-1.5">
              <MessageSquare size={14} className="text-[#008069]" /> Evaluasi Terbaru ({days} hari terakhir)
            </div>
            {!summary || (summary.recent || []).length === 0 ? (
              <div className="p-8 text-center text-xs text-[#8696a0]">
                Belum ada evaluasi. Aktifkan <code className="text-[#111b21] bg-[#f0f2f5] px-1 py-0.5 rounded">ENABLE_AI_EVAL_CRON=true</code> atau jalankan sample evaluation.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-[#667781] border-b border-[#e9edef] bg-[#f8fafc]">
                      <th className="px-4 py-2.5 font-bold">Skor</th>
                      <th className="px-4 py-2.5 font-bold">Pesan (jawaban bot)</th>
                      <th className="px-4 py-2.5 font-bold">Alasan / Feedback</th>
                      <th className="px-4 py-2.5 font-bold text-right">Waktu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e9edef]">
                    {(summary.recent || []).map((e) => (
                      <tr key={e.id} className="hover:bg-[#f8fafc] transition-colors">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <Star
                                key={n}
                                size={13}
                                fill={n <= e.score ? 'currentColor' : 'none'}
                                className={n <= e.score ? scoreColor(e.score) : 'text-[#d1d7db]'}
                              />
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 max-w-xs">
                          <p className="text-[#111b21] line-clamp-2">{e.message_text}</p>
                          {e.customer_phone && <p className="text-[10px] text-[#8696a0] mt-0.5">{e.customer_phone}</p>}
                        </td>
                        <td className="px-4 py-2.5 max-w-sm">
                          {e.feedback && <p className="text-[#54656f] line-clamp-3">{e.feedback}</p>}
                          {e.ai_reasoning && (
                            <p className="text-[10px] text-[#8696a0] mt-0.5 italic line-clamp-2">
                              reasoning: {e.ai_reasoning}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[#8696a0] whitespace-nowrap">
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