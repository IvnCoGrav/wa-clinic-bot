import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { apiRequest } from '../../services/api';
import {
  Bug,
  RefreshCw,
  Server,
  BrainCircuit,
  MessageSquare,
  Phone,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert,
  Cpu,
  Terminal,
  type LucideIcon,
} from 'lucide-react';

type TabId = 'system' | 'router' | 'logs' | 'messages' | 'conversations';

const TABS: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: 'system', label: 'System Overview', icon: Server },
  { id: 'router', label: 'AI Router', icon: BrainCircuit },
  { id: 'logs', label: 'Logs', icon: Terminal },
  { id: 'messages', label: 'Message Trace', icon: MessageSquare },
  { id: 'conversations', label: 'Conversations', icon: Phone },
];

const fmtTime = (iso?: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'medium' });
};

const pct = (v: number | null) => (v === null ? 'N/A' : `${v.toFixed(2)}%`);

function StatCard({ label, value, tone = 'default', sub }: { label: string; value: React.ReactNode; tone?: 'ok' | 'warn' | 'err' | 'default'; sub?: string }) {
  const toneCls =
    tone === 'ok' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : tone === 'err' ? 'text-rose-400' : 'text-slate-100';
  return (
    <div className="glass-panel rounded-2xl p-4 flex flex-col gap-1">
      <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-2xl font-bold ${toneCls}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500 truncate">{sub}</p>}
    </div>
  );
}

function SectionHeader({ title, onRefresh, loading, auto }: { title: string; onRefresh: () => void; loading: boolean; auto?: boolean }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">{title}</h3>
      <div className="flex items-center gap-3">
        {auto && <span className="text-[11px] text-slate-500">auto-refresh 5s</span>}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-2 rounded-lg bg-white/5 hover:bg-pink-500/10 text-slate-300 hover:text-pink-400 transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>
  );
}

function ErrNote({ note }: { note?: string }) {
  if (!note) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2 mb-3">
      <AlertTriangle size={14} />
      <span>{note}</span>
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
        ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
      }`}
    >
      {ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
      {label}
    </span>
  );
}

// ---------------------------------------------------------------- System
interface SystemInfo {
  process: { uptimeSeconds: number; uptimeHuman: string; nodeVersion: string; pid: number; memoryMb: { rss: number; heapUsed: number; heapTotal: number }; platform: string };
  database: { status: string; detail?: string };
  featureFlags: Array<{ key: string; label: string; value: boolean | 'unset' }>;
  secretKeysPresent: string[];
  counts: { customers: number | null; conversations: number | null; messages: number | null; reservations: number | null; followUps: number | null; aiRouterEvaluations: number | null };
  aiRouter: { enabled: boolean; shadowMode: boolean; circuitState: string };
  logBuffer: { installed: boolean; stats: Record<string, number> };
}

function SystemSection() {
  const [data, setData] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/admin/debug/system');
      setData(res.data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Gagal memuat info sistem');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dbOk = data?.database.status === 'CONNECTED';
  const circuit = data?.aiRouter.circuitState || 'CLOSED';

  return (
    <div className="space-y-4">
      <SectionHeader title="System Overview" onRefresh={load} loading={loading} />
      {error && <ErrNote note={error} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Uptime" value={data?.process.uptimeHuman || '-'} sub={data ? `since boot ${data.process.uptimeSeconds}s` : undefined} />
        <StatCard label="Node / PID" value={data?.process.nodeVersion || '-'} sub={data ? `PID ${data.process.pid} · ${data.process.platform}` : undefined} />
        <StatCard
          label="Memory RSS"
          value={data ? `${data.process.memoryMb.rss} MB` : '-'}
          sub={data ? `heap ${data.process.memoryMb.heapUsed}/${data.process.memoryMb.heapTotal} MB` : undefined}
        />
        <StatCard
          label="Database"
          value={dbOk ? 'CONNECTED' : data?.database.status || '-'}
          tone={dbOk ? 'ok' : 'err'}
          sub={!dbOk ? data?.database.detail : undefined}
        />
        <StatCard label="Customers" value={data?.counts.customers ?? '-'} />
        <StatCard label="Conversations" value={data?.counts.conversations ?? '-'} />
        <StatCard label="Messages" value={data?.counts.messages ?? '-'} />
        <StatCard label="AI Router Evaluations" value={data?.counts.aiRouterEvaluations ?? '-'} />
      </div>

      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <h4 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <Cpu size={15} className="text-pink-400" /> AI Router & Feature Flags
        </h4>
        <div className="flex flex-wrap gap-2">
          <Badge ok={!!data?.aiRouter.enabled} label={`AI_ROUTER_ENABLED=${data?.aiRouter.enabled ? 'ON' : 'OFF'}`} />
          <Badge ok={!!data?.aiRouter.shadowMode} label={`SHADOW_MODE=${data?.aiRouter.shadowMode ? 'ON' : 'OFF'}`} />
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
              circuit === 'CLOSED'
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : circuit === 'HALF_OPEN'
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}
          >
            <Activity size={11} /> Circuit: {circuit}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-white/5">
                <th className="py-2 pr-4">Flag</th>
                <th className="py-2 pr-4">Fungsi</th>
                <th className="py-2">Nilai</th>
              </tr>
            </thead>
            <tbody>
              {data?.featureFlags.map((f) => (
                <tr key={f.key} className="border-b border-white/5 last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs text-slate-300">{f.key}</td>
                  <td className="py-2 pr-4 text-xs text-slate-400">{f.label}</td>
                  <td className="py-2">
                    {f.value === 'unset' ? (
                      <span className="text-slate-600 text-xs">unset</span>
                    ) : (
                      <Badge ok={f.value === true} label={String(f.value)} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.secretKeysPresent.length > 0 && (
          <p className="text-[11px] text-slate-500">
            <ShieldAlert size={11} className="inline mr-1" />
            Secret keys terpasang tapi disembunyikan: {data.secretKeysPresent.join(', ')}
          </p>
        )}
        <p className="text-[11px] text-slate-500">
          Log buffer: {data?.logBuffer.installed ? 'aktif' : 'tidak terpasang'} · log={data?.logBuffer.stats.log ?? 0} warn={data?.logBuffer.stats.warn ?? 0} error={data?.logBuffer.stats.error ?? 0}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- AI Router
interface RouterSummary {
  days: number;
  allTotal: number;
  mappedTotal: number;
  intentMatch: number;
  escalationMatch: number;
  unmapped: number;
  intentMatchRate: number | null;
  escalationMatchRate: number | null;
  unmappedRate: number | null;
  medicalMismatches: Array<{ message_text: string; llm_intent: string | null; legacy_intent: string; created_at: string }>;
  recentEvaluations: Array<{
    id: string;
    created_at: string;
    current_state: string;
    message_text: string;
    llm_intent: string | null;
    legacy_intent: string;
    intent_match: boolean;
    escalation_match: boolean;
    llm_used_fallback: boolean;
    mismatch_notes: string | null;
    response_time_ms: number | null;
  }>;
  dbNote?: string;
}

function RouterSection() {
  const [data, setData] = useState<RouterSummary | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest(`/api/admin/debug/ai-router?days=${days}`);
      setData(res.data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Gagal memuat ringkasan AI Router');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const escOk = data ? (data.escalationMatchRate ?? 0) >= 98 : false;
  const medOk = data ? data.medicalMismatches.length === 0 : false;
  const unmappedOk = data ? (data.unmappedRate ?? 100) < 5 : false;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {[1, 3, 7, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                days === d ? 'bg-pink-500 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
        <SectionHeader title={`Akurasi AI Router (${days} hari)`} onRefresh={load} loading={loading} />
      </div>
      {error && <ErrNote note={error} />}
      {data?.dbNote && <ErrNote note={data.dbNote} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Evaluasi" value={data?.allTotal ?? '-'} />
        <StatCard label="Intent Match" value={pct(data?.intentMatchRate ?? null)} sub={`${data?.intentMatch ?? 0}/${data?.mappedTotal ?? 0} (excl UNMAPPED)`} />
        <StatCard label="Escalation Match" value={pct(data?.escalationMatchRate ?? null)} tone={escOk ? 'ok' : 'warn'} />
        <StatCard label="UNMAPPED Rate" value={pct(data?.unmappedRate ?? null)} tone={unmappedOk ? 'ok' : 'warn'} sub={`target < 5%`} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge ok={escOk} label={`Gate 1: escalation ≥ 98% (${escOk ? 'PASS' : 'FAIL'})`} />
        <Badge ok={medOk} label={`Gate 2: medical mismatch = 0 (${medOk ? 'PASS' : 'FAIL'})`} />
        <Badge ok={unmappedOk} label={`Gate 3: UNMAPPED < 5% (${unmappedOk ? 'PASS' : 'FAIL'})`} />
      </div>

      <div className={`glass-panel rounded-2xl p-5 ${medOk ? '' : 'border border-rose-500/40'}`}>
        <h4 className="text-sm font-bold text-slate-200 flex items-center gap-2 mb-3">
          <AlertTriangle size={15} className={medOk ? 'text-emerald-400' : 'text-rose-400'} />
          Mismatch MEDICAL_CONCERN (wajib 0 sebelum matikan shadow mode)
        </h4>
        {medOk ? (
          <p className="text-xs text-emerald-400">Tidak ada mismatch terkait MEDICAL_CONCERN — aman.</p>
        ) : (
          <div className="space-y-2">
            {data?.medicalMismatches.map((m, i) => (
              <div key={i} className="flex items-start gap-3 bg-rose-500/5 border border-rose-500/20 rounded-xl px-3 py-2 text-xs">
                <XCircle size={14} className="text-rose-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-slate-200 truncate">{m.message_text}</p>
                  <p className="text-slate-500">
                    LLM: <span className="text-rose-300">{m.llm_intent ?? 'N/A'}</span> · Legacy: <span className="text-rose-300">{m.legacy_intent}</span> · {fmtTime(m.created_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="glass-panel rounded-2xl p-5">
        <h4 className="text-sm font-bold text-slate-200 mb-3">Evaluasi Terbaru</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left uppercase tracking-wider text-slate-500 border-b border-white/5">
                <th className="py-2 pr-3">Waktu</th>
                <th className="py-2 pr-3">State</th>
                <th className="py-2 pr-3">Pesan</th>
                <th className="py-2 pr-3">LLM</th>
                <th className="py-2 pr-3">Legacy</th>
                <th className="py-2 pr-3">Intent ✓</th>
                <th className="py-2 pr-3">Esc ✓</th>
                <th className="py-2 pr-3">Fallback</th>
                <th className="py-2">ms</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recentEvaluations ?? []).length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4 text-center text-slate-500">Belum ada data evaluasi.</td>
                </tr>
              )}
              {data?.recentEvaluations.map((e) => (
                <tr key={e.id} className="border-b border-white/5 last:border-0">
                  <td className="py-2 pr-3 whitespace-nowrap text-slate-400">{fmtTime(e.created_at)}</td>
                  <td className="py-2 pr-3 text-slate-400">{e.current_state}</td>
                  <td className="py-2 pr-3 text-slate-300 max-w-[200px] truncate" title={e.message_text}>{e.message_text}</td>
                  <td className="py-2 pr-3">{e.llm_intent ?? <span className="text-slate-600">N/A</span>}</td>
                  <td className="py-2 pr-3">{e.legacy_intent}</td>
                  <td className="py-2 pr-3">{e.intent_match ? <CheckCircle2 size={14} className="text-emerald-400" /> : <XCircle size={14} className="text-rose-400" />}</td>
                  <td className="py-2 pr-3">{e.escalation_match ? <CheckCircle2 size={14} className="text-emerald-400" /> : <XCircle size={14} className="text-rose-400" />}</td>
                  <td className="py-2 pr-3">{e.llm_used_fallback ? <span className="text-amber-400">yes</span> : <span className="text-slate-500">no</span>}</td>
                  <td className="py-2 text-slate-400">{e.response_time_ms ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Logs
interface LogEntry {
  id: number;
  ts: string;
  level: 'log' | 'info' | 'warn' | 'error';
  msg: string;
}

function LogsSection() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [installed, setInstalled] = useState(true);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [level, setLevel] = useState<'all' | 'log' | 'info' | 'warn' | 'error'>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(`/api/admin/debug/logs?limit=300&level=${level}`);
      setEntries(res.data.entries || []);
      setInstalled(res.data.installed !== false);
      setStats(res.data.stats || {});
      setLoading(false);
    } catch (err) {
      setLoading(false);
    }
  }, [level]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const levelColor = (l: string) =>
    l === 'error' ? 'text-rose-400' : l === 'warn' ? 'text-amber-400' : l === 'info' ? 'text-sky-400' : 'text-slate-400';

  return (
    <div className="space-y-4">
      <SectionHeader title="Log Buffer (in-memory)" onRefresh={load} loading={loading} auto />
      {!installed && <ErrNote note="Log buffer belum terpasang — restart server agar console log tertangkap." />}
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'error', 'warn', 'info', 'log'] as const).map((l) => (
          <button
            key={l}
            onClick={() => setLevel(l)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              level === l ? 'bg-pink-500 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
          >
            {l.toUpperCase()} {l !== 'all' && <span className="opacity-70">({stats[l] ?? 0})</span>}
          </button>
        ))}
      </div>
      <div className="glass-panel rounded-2xl p-4 max-h-[70vh] overflow-y-auto font-mono text-xs">
        {entries.length === 0 && <p className="text-slate-500">Belum ada log.</p>}
        {entries.map((e) => (
          <div key={e.id} className="flex gap-3 border-b border-white/5 py-1.5 last:border-0">
            <span className="text-slate-600 whitespace-nowrap">{new Date(e.ts).toLocaleTimeString('id-ID')}</span>
            <span className={`w-12 shrink-0 uppercase ${levelColor(e.level)}`}>{e.level}</span>
            <span className="text-slate-300 whitespace-pre-wrap break-all">{e.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Messages
interface MessageTraceEntry {
  id: string;
  created_at: string;
  direction: string;
  content: string;
  wa_message_id: string | null;
  customerPhone: string | null;
  customerName: string | null;
}

function MessagesSection() {
  const [data, setData] = useState<{ entries: MessageTraceEntry[]; dbNote?: string }>({ entries: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/admin/debug/messages?limit=80');
      setData(res.data);
    } catch (err) {
      setData({ entries: [], dbNote: 'Gagal memuat trace pesan' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <SectionHeader title="Message Trace (terbaru)" onRefresh={load} loading={loading} />
      {data.dbNote && <ErrNote note={data.dbNote} />}
      <div className="glass-panel rounded-2xl p-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left uppercase tracking-wider text-slate-500 border-b border-white/5">
              <th className="py-2 pr-3">Waktu</th>
              <th className="py-2 pr-3">Arah</th>
              <th className="py-2 pr-3">Customer</th>
              <th className="py-2 pr-3">WA Msg ID</th>
              <th className="py-2">Konten</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-slate-500">Belum ada pesan.</td>
              </tr>
            )}
            {data.entries.map((m) => (
              <tr key={m.id} className="border-b border-white/5 last:border-0 align-top">
                <td className="py-2 pr-3 whitespace-nowrap text-slate-400">{fmtTime(m.created_at)}</td>
                <td className="py-2 pr-3">
                  {m.direction === 'INBOUND' ? (
                    <span className="inline-flex items-center gap-1 text-emerald-400"><Activity size={11} /> IN</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-sky-400"><MessageSquare size={11} /> OUT</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-slate-300">
                  {m.customerName || '?'}
                  <span className="block text-slate-500">{m.customerPhone}</span>
                </td>
                <td className="py-2 pr-3 font-mono text-[10px] text-slate-500 max-w-[100px] truncate" title={m.wa_message_id ?? ''}>{m.wa_message_id ?? '-'}</td>
                <td className="py-2 text-slate-300 whitespace-pre-wrap break-all max-w-[420px]">{m.content}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Conversations
interface ConversationTraceEntry {
  id: string;
  current_state: string;
  is_human_handling: boolean;
  human_handling_since: string | null;
  escalation_reason: string | null;
  consecutive_unknown_count: number;
  location_attempts: number;
  last_message_at: string;
  customerPhone: string | null;
  customerName: string | null;
}

function ConversationsSection() {
  const [data, setData] = useState<{ entries: ConversationTraceEntry[]; dbNote?: string }>({ entries: [] });
  const [loading, setLoading] = useState(true);
  const [escFilter, setEscFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/admin/debug/conversations?limit=80');
      setData(res.data);
    } catch (err) {
      setData({ entries: [], dbNote: 'Gagal memuat trace conversation' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reasonOptions = useMemo(
    () => Array.from(new Set(data.entries.map((e) => e.escalation_reason).filter((r): r is string => Boolean(r)))).sort(),
    [data.entries]
  );

  const filteredEntries = useMemo(() => {
    if (escFilter === 'all') return data.entries;
    if (escFilter === 'none') return data.entries.filter((e) => !e.escalation_reason);
    return data.entries.filter((e) => e.escalation_reason === escFilter);
  }, [data.entries, escFilter]);

  return (
    <div className="space-y-4">
      <SectionHeader title="Conversation State Trace (terbaru)" onRefresh={load} loading={loading} />
      {data.dbNote && <ErrNote note={data.dbNote} />}
      <div className="flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wider text-slate-500">Filter Eskalasi</label>
        <select
          value={escFilter}
          onChange={(e) => setEscFilter(e.target.value)}
          className="px-2 py-1 bg-slate-950 border border-white/10 rounded-lg text-xs text-white"
        >
          <option value="all">Semua</option>
          <option value="none">Tanpa eskalasi</option>
          {reasonOptions.map((r) => (
            <option key={r} value={r}>
              {r === 'LEGACY_AI_SCOPE_DISABLED' ? 'LEGACY_AI_SCOPE_DISABLED (AI scope)' : r}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-slate-600">{filteredEntries.length} / {data.entries.length} baris</span>
      </div>
      <div className="glass-panel rounded-2xl p-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left uppercase tracking-wider text-slate-500 border-b border-white/5">
              <th className="py-2 pr-3">Customer</th>
              <th className="py-2 pr-3">State</th>
              <th className="py-2 pr-3">Human Handling</th>
              <th className="py-2 pr-3">Eskalasi</th>
              <th className="py-2 pr-3">UNKNOWN×</th>
              <th className="py-2 pr-3">Lokasi Gagal</th>
              <th className="py-2">Aktivitas Terakhir</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-slate-500">Belum ada conversation.</td>
              </tr>
            )}
            {filteredEntries.map((c) => (
              <tr key={c.id} className="border-b border-white/5 last:border-0">
                <td className="py-2 pr-3 text-slate-300">
                  {c.customerName || '?'}
                  <span className="block text-slate-500">{c.customerPhone}</span>
                </td>
                <td className="py-2 pr-3">
                  <span className="px-2 py-0.5 rounded-full bg-white/5 text-slate-300 border border-white/10 text-[10px]">{c.current_state}</span>
                </td>
                <td className="py-2 pr-3">{c.is_human_handling ? <Badge ok label="HUMAN" /> : <span className="text-slate-600">bot</span>}</td>
                <td className="py-2 pr-3 text-slate-400">{c.escalation_reason || '-'}</td>
                <td className="py-2 pr-3">
                  {c.consecutive_unknown_count > 0 ? (
                    <span className="text-amber-400 font-bold">{c.consecutive_unknown_count}</span>
                  ) : (
                    <span className="text-slate-600">0</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-slate-400">{c.location_attempts}</td>
                <td className="py-2 text-slate-400 whitespace-nowrap">{fmtTime(c.last_message_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Page
export const Debug: React.FC = () => {
  const [tab, setTab] = useState<TabId>('system');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Bug size={20} className="text-pink-400" /> System Debug
          </h2>
          <p className="text-sm text-slate-500">Observability, tracing & maintenance — semua read-only.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-white/5 pb-3">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                active ? 'bg-gradient-to-r from-pink-500/20 to-violet-500/10 border-l-4 border-pink-500 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
              }`}
            >
              <Icon size={16} className={active ? 'text-pink-400' : 'text-slate-400'} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'system' && <SystemSection />}
      {tab === 'router' && <RouterSection />}
      {tab === 'logs' && <LogsSection />}
      {tab === 'messages' && <MessagesSection />}
      {tab === 'conversations' && <ConversationsSection />}

      <p className="text-[11px] text-slate-600">
        <Clock size={11} className="inline mr-1" />
        Debug page data diambil langsung dari server via /api/admin/debug/* — read-only, tidak ada mutasi.
      </p>
    </div>
  );
};

export default Debug;
