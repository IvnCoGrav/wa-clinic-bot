import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { RefreshCw, Star, MessageSquare } from 'lucide-react';

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

const scoreColor = (s: number) => {
  if (s >= 4) return 'text-emerald-400';
  if (s >= 3) return 'text-amber-400';
  return 'text-rose-400';
};

export const AiEvaluations: React.FC = () => {
  const [days, setDays] = useState(7);
  const [summary, setSummary] = useState<AiEvaluationsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiRequest(`ai-evaluations?days=${days}&limit=100`);
      setSummary(res?.data || { total: 0, avgScore: 0, minScore: 0, maxScore: 0, recent: [] });
    } catch (err: any) {
      console.warn('Gagal load ai-evaluations:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [days]);

  const StatCard = ({ label, value, hint }: { label: string; value: number; hint: string }) => (
    <div className="rounded-2xl bg-white/5 border border-white/10 p-5">
      <p className="text-xs uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-3xl font-extrabold mt-1 ${scoreColor(value)}`}>{value.toFixed(1)}</p>
      <p className="text-xs text-slate-500 mt-1">{hint}</p>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">AI Quality Evaluation</h2>
          <p className="text-sm text-slate-400">
            Tren skor LLM-as-Judge atas balasan bot — cron 6 jam, tabel <code className="text-pink-400">AiEvaluation</code> terpisah dari router.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-xl bg-white/5 border border-white/10 p-1">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition ${days === d ? 'bg-pink-500 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            onClick={load}
            className="flex items-center gap-2 px-3 py-2 bg-pink-500 hover:bg-pink-600 rounded-xl text-xs font-bold text-white transition"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {!summary ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-pulse">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 bg-white/5 border border-white/10 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Total Evaluated" value={summary.total} hint="Pesan yang dinilai dalam rentang ini" />
          <StatCard label="Skor Rata-rata" value={summary.avgScore} hint="0-5, >3 = cukup baik" />
          <div className="flex items-center justify-between gap-1 rounded-2xl bg-white/5 border border-white/10 p-5">
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-400">Rentang</p>
              <p className={`text-2xl font-extrabold mt-1 ${scoreColor(summary.avgScore)}`}>
                {summary.minScore.toFixed(0)} – {summary.maxScore.toFixed(0)}
              </p>
              <p className="text-xs text-slate-500 mt-1">min – max</p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white/5 border border-white/10 overflow-hidden">
        <div className="px-5 py-3 border-b border-white/10 text-sm font-bold text-slate-300 flex items-center gap-2">
          <MessageSquare size={16} /> Evaluasi Terbaru (<code>{days}</code> hari terakhir)
        </div>
        {!summary || (summary.recent || []).length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            Belum ada evaluasi. Aktifkan <code className="text-slate-300">ENABLE_AI_EVAL_CRON=true</code> atau jalankan <code className="text-slate-300">sampleAndEvaluate</code>.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-white/5">
                <th className="px-5 py-3">Skor</th>
                <th className="px-5 py-3">Pesan (jawaban bot)</th>
                <th className="px-5 py-3">Alasan / Feedback</th>
                <th className="px-5 py-3 text-right">Waktu</th>
              </tr>
            </thead>
            <tbody>
              {(summary.recent || []).map((e) => (
                <tr key={e.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} size={14} fill={n <= e.score ? 'currentColor' : 'none'}
                          className={n <= e.score ? scoreColor(e.score) : 'text-slate-700'} />
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3 max-w-xs">
                    <p className="text-slate-200 line-clamp-2">{e.message_text}</p>
                    {e.customer_phone && <p className="text-xs text-slate-500 mt-1">{e.customer_phone}</p>}
                  </td>
                  <td className="px-5 py-3 max-w-sm">
                    {e.feedback && <p className="text-xs text-slate-300 line-clamp-3">{e.feedback}</p>}
                    {e.ai_reasoning && <p className="text-xs text-slate-500 mt-1 italic line-clamp-2">reasoning: {e.ai_reasoning}</p>}
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-slate-500 whitespace-nowrap">
                    {new Date(e.created_at).toLocaleString('id-ID')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};