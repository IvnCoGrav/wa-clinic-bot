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
  if (s >= 4) return 'text-success';
  if (s >= 3) return 'text-warning';
  return 'text-danger';
};

const getModelProvider = (log: LlmAuditLogEntry) => {
  return log.provider || 'LLM Provider';
};

const formatRupiah = (val: number) => {
  if (val == null || isNaN(val)) return 'Rp 0';
  return 'Rp ' + val.toLocaleString('id-ID', { maximumFractionDigits: 2 });
};

/**
 * Parser feedback LLM-as-Judge data-driven (tanpa hardcode 5 kunci dimensi).
 * Format produsen: `[dimensi {<JSON>}[ gagal: a,b| semua dimensi lulus]] <feedback_text>`
 * - Ekstrak JSON dalam string secara dinamis via pencarian bracket (bukan regex hafalan)
 * - Ambang lulus default score >=4 (aproksimasi persona-rubric; ambang eksak ada di backend)
 * - Degradasi anggun: bila parse gagal → kembalikan raw sebagai text tanpa badge
 */
export function parseJudgeFeedback(feedback: string | null): { dims: Array<{ key: string; score: number; pass: boolean }>; text: string; raw: string } {
  const raw = feedback || '';
  if (!raw) return { dims: [], text: '', raw };
  const start = raw.indexOf('{');
  const end = raw.indexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return { dims: [], text: raw, raw };
  }
  const jsonStr = raw.slice(start, end + 1);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { dims: [], text: raw, raw };
  }
  const dims: Array<{ key: string; score: number; pass: boolean }> = [];
  for (const [k, v] of Object.entries(parsed)) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    // Aproksimasi ambang: >=4 lulus (backend persona-rubric: warmth/format 3, golden/grounding/pronoun 4)
    dims.push({ key: k, score: n, pass: n >= 4 });
  }
  // Teks bersih setelah "]"
  const bracketClose = raw.indexOf(']', end);
  const text = bracketClose !== -1 ? raw.slice(bracketClose + 1).trim() : raw.slice(end + 1).trim();
  return { dims, text: text || raw, raw };
}

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
          <h2 className="text-xl font-bold text-ink flex items-center gap-2">
            <Cpu className="text-accent" size={22} />
            <span>AI Monitoring &amp; Usage Dashboard</span>
          </h2>
          <p className="text-xs text-ink-3 mt-0.5">
            Pantau pemakaian token, estimasi biaya (Rupiah), dan kualitas balasan AI secara real-time.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-xl bg-surface border border-divider p-1 shadow-xs">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-bold transition touch-manipulation ${
                  days === d ? 'bg-accent text-accent-ink shadow-xs' : 'text-ink-2 hover:text-ink'
                }`}
                style={{ touchAction: 'manipulation' }}
              >
                {d} Hari
              </button>
            ))}
          </div>
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] bg-white hover:bg-fill-1 dark:bg-surface border border-divider rounded-xl text-xs font-semibold text-ink transition shadow-xs touch-manipulation"
            style={{ touchAction: 'manipulation' }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin text-accent' : 'text-ink-3'} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-2 border-b border-divider pb-2">
        <button
          onClick={() => setActiveTab('usage')}
          className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
            activeTab === 'usage'
              ? 'bg-accent-soft border border-divider text-accent'
              : 'text-ink-2 hover:text-ink'
          }`}
        >
          <DollarSign size={15} />
          <span>Real-Time AI Usage &amp; Biaya (Rp)</span>
        </button>
        <button
          onClick={() => setActiveTab('quality')}
          className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
            activeTab === 'quality'
              ? 'bg-accent-soft border border-divider text-accent'
              : 'text-ink-2 hover:text-ink'
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
            <div className="rounded-2xl bg-surface border border-divider p-4 shadow-xs">
              <p className="text-[11px] uppercase tracking-wider text-accent font-bold flex items-center gap-1.5">
                <DollarSign size={13} /> Total Est. Biaya (Rp)
              </p>
              <p className="text-2xl font-bold text-ink mt-1.5">
                {formatRupiah(auditSummary?.totalCostIdr || 0)}
              </p>
              <p className="text-[11px] text-ink-3 mt-0.5">Estimasi biaya {days} hari terakhir</p>
            </div>

            <div className="rounded-2xl bg-surface border border-divider p-4 shadow-xs">
              <p className="text-[11px] uppercase tracking-wider text-info font-bold flex items-center gap-1.5">
                <Zap size={13} /> Total Tokens
              </p>
              <p className="text-2xl font-bold text-ink mt-1.5">
                {(auditSummary?.totalTokens || 0).toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-ink-3 mt-0.5">
                In: {(auditSummary?.totalPromptTokens || 0).toLocaleString('id-ID')} | Out:{' '}
                {(auditSummary?.totalCompletionTokens || 0).toLocaleString('id-ID')}
              </p>
            </div>

            <div className="rounded-2xl bg-surface border border-divider p-4 shadow-xs">
              <p className="text-[11px] uppercase tracking-wider text-violet font-bold flex items-center gap-1.5">
                <Activity size={13} /> Total Panggilan AI
              </p>
              <p className="text-2xl font-bold text-ink mt-1.5">
                {(auditSummary?.totalLogs || 0).toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-ink-3 mt-0.5">Transaksi NLU, Routing &amp; Chat</p>
            </div>

            <div className="rounded-2xl bg-surface border border-divider p-4 shadow-xs">
              <p className="text-[11px] uppercase tracking-wider text-ink-2 font-bold">Rata-rata per Call</p>
              <p className="text-2xl font-bold text-ink mt-1.5">
                {auditSummary?.totalLogs
                  ? formatRupiah(auditSummary.totalCostIdr / auditSummary.totalLogs)
                  : 'Rp 0'}
              </p>
              <p className="text-[11px] text-ink-3 mt-0.5">Biaya per eksekusi AI</p>
            </div>
          </div>

          {/* Audit Logs Table */}
          <div className="rounded-2xl bg-surface border border-divider overflow-hidden shadow-xs">
            <div className="px-5 py-3.5 border-b border-divider text-xs font-bold text-ink uppercase flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Activity size={14} className="text-accent" /> Audit Log Transaksi AI Terbaru ({auditSummary?.recent?.length || 0})
              </span>
              <span className="text-[10px] text-ink-3">Log tersimpan di tabel llm_audit_logs</span>
            </div>

            {!auditSummary || (auditSummary.recent || []).length === 0 ? (
              <div className="p-8 text-center text-xs text-ink-3">
                Belum ada log transaksi AI tercatat dalam {days} hari terakhir.
              </div>
            ) : (
              <>
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-ink-3 border-b border-divider bg-surface-2">
                      <th className="px-4 py-2.5 font-bold">Waktu</th>
                      <th className="px-4 py-2.5 font-bold">Tugas / Task</th>
                      <th className="px-4 py-2.5 font-bold">Model AI</th>
                      <th className="px-4 py-2.5 font-bold">Customer Phone</th>
                      <th className="px-4 py-2.5 font-bold text-right">Tokens (In / Out)</th>
                      <th className="px-4 py-2.5 font-bold text-right">Biaya (Rp)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-divider">
                    {auditSummary.recent.map((log) => (
                      <tr key={log.id} className="hover:bg-surface-2 transition-colors">
                        <td className="px-4 py-2.5 text-ink-3 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' })}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="px-2 py-0.5 rounded-full bg-accent-soft border border-divider text-accent text-[10px] font-mono font-bold">
                            {log.task_type}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-ink">
                          <span className="text-[10px] text-ink-3 font-sans block font-semibold">
                            {getModelProvider(log)}
                          </span>
                          <span>{log.model_name}</span>
                        </td>
                        <td className="px-4 py-2.5 text-ink-3 font-mono">
                          {log.customer_phone}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-ink-2">
                          <div className="flex items-center justify-end gap-1.5">
                            {log.cached_prompt_tokens && log.cached_prompt_tokens > 0 ? (
                              <span
                                className="flex items-center gap-1 text-[10px] text-success bg-success-soft border border-success-line px-1.5 py-0.5 rounded-full"
                                title={`Cache Hit (${log.cached_prompt_tokens} tokens)`}
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                                <span>Hit</span>
                              </span>
                            ) : (
                              <span
                                className="flex items-center gap-1 text-[10px] text-danger bg-danger-soft border border-danger-line px-1.5 py-0.5 rounded-full"
                                title="Cache Miss"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-danger" />
                                <span>Miss</span>
                              </span>
                            )}
                            <span>{log.prompt_tokens} in / {log.completion_tokens} out</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold text-accent">
                          {formatRupiah(log.cost_idr)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="block sm:hidden divide-y divide-divider">
                {auditSummary.recent.map((log) => (
                  <div key={log.id} className="p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded-full bg-accent-soft border border-divider text-accent text-[10px] font-mono font-bold">
                        {log.task_type}
                      </span>
                      <span className="text-[10px] text-ink-3">{new Date(log.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </div>
                    <div className="text-xs font-mono text-ink">
                      <span className="text-[10px] text-ink-3 font-sans font-semibold">{getModelProvider(log)} — </span>
                      {log.model_name}
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono text-ink-3">{log.customer_phone}</span>
                      <span className="font-bold text-accent">{formatRupiah(log.cost_idr)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-ink-2">
                      {log.cached_prompt_tokens && log.cached_prompt_tokens > 0 ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-danger" />
                      )}
                      <span>{log.prompt_tokens} in / {log.completion_tokens} out</span>
                    </div>
                  </div>
                ))}
              </div>
              </>
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
                <div key={i} className="h-20 bg-surface border border-divider rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-2xl bg-surface border border-divider p-4 shadow-xs">
                <p className="text-[11px] uppercase tracking-wider text-ink-3 font-bold">Total Evaluated</p>
                <p className={`text-2xl font-bold mt-1 ${scoreColor(summary.avgScore)}`}>{summary.total}</p>
                <p className="text-[11px] text-ink-3 mt-0.5">Pesan yang dinilai dalam rentang ini</p>
              </div>

              <div className="rounded-2xl bg-surface border border-divider p-4 shadow-xs">
                <p className="text-[11px] uppercase tracking-wider text-ink-3 font-bold">Skor Rata-rata</p>
                <p className={`text-2xl font-bold mt-1 ${scoreColor(summary.avgScore)}`}>
                  {summary.avgScore.toFixed(1)}
                </p>
                <p className="text-[11px] text-ink-3 mt-0.5">Skor 0-5 (&gt;3 = cukup baik)</p>
              </div>

              <div className="rounded-2xl bg-surface border border-divider p-4 shadow-xs">
                <p className="text-[11px] uppercase tracking-wider text-ink-3 font-bold">Rentang Skor</p>
                <p className={`text-2xl font-bold mt-1 ${scoreColor(summary.avgScore)}`}>
                  {summary.minScore.toFixed(0)} – {summary.maxScore.toFixed(0)}
                </p>
                <p className="text-[11px] text-ink-3 mt-0.5">Skor terendah - tertinggi</p>
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-surface border border-divider overflow-hidden shadow-xs">
            <div className="px-5 py-3.5 border-b border-divider text-xs font-bold text-ink uppercase flex items-center gap-1.5">
              <MessageSquare size={14} className="text-accent" /> Evaluasi Terbaru ({days} hari terakhir)
            </div>
            {!summary || (summary.recent || []).length === 0 ? (
              <div className="p-8 text-center text-xs text-ink-3">
                Belum ada evaluasi. Aktifkan <code className="text-ink bg-fill-1 dark:bg-surface px-1 py-0.5 rounded">ENABLE_AI_EVAL_CRON=true</code> atau jalankan sample evaluation.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-ink-3 border-b border-divider bg-surface-2">
                      <th className="px-4 py-2.5 font-bold">Skor</th>
                      <th className="px-4 py-2.5 font-bold">Pesan (jawaban bot)</th>
                      <th className="px-4 py-2.5 font-bold">Alasan / Feedback</th>
                      <th className="px-4 py-2.5 font-bold text-right">Waktu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-divider">
                    {(summary.recent || []).map((e) => (
                      <tr key={e.id} className="hover:bg-surface-2 transition-colors">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <Star
                                key={n}
                                size={13}
                                fill={n <= e.score ? 'currentColor' : 'none'}
                                className={n <= e.score ? scoreColor(e.score) : 'text-strong'}
                              />
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 max-w-xs">
                          <p className="text-ink line-clamp-2">{e.message_text}</p>
                          {e.customer_phone && <p className="text-[10px] text-ink-3 mt-0.5">{e.customer_phone}</p>}
                        </td>
                        <td className="px-4 py-2.5 max-w-sm">
                          {(() => {
                            const parsed = parseJudgeFeedback(e.feedback);
                            return (
                              <>
                                {parsed.dims.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mb-1.5">
                                    {parsed.dims.map((d) => (
                                      <span
                                        key={d.key}
                                        className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${d.pass ? 'bg-success-soft text-success border-success-line' : 'bg-danger-soft text-danger border-danger-line'}`}
                                        title={`${d.key}: ${d.score}`}
                                      >
                                        {d.key}:{d.score}{d.pass ? '✓' : '✗'}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {parsed.text ? (
                                  <p className="text-ink-2 line-clamp-3">{parsed.text}</p>
                                ) : e.feedback ? (
                                  <p className="text-ink-2 line-clamp-3">{e.feedback}</p>
                                ) : null}
                              </>
                            );
                          })()}
                          {e.ai_reasoning && (
                            <p className="text-[10px] text-ink-3 mt-0.5 italic line-clamp-2">
                              reasoning: {e.ai_reasoning}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right text-ink-3 whitespace-nowrap">
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