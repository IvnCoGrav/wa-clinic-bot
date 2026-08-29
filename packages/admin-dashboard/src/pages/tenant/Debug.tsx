import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
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
  ShieldCheck,
  Cpu,
  Terminal,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Trash2,
  Download,
  Pause,
  Play,
  Filter,
  Layers,
  ArrowRight,
  HelpCircle,
  Zap,
  CheckCheck,
  type LucideIcon,
} from 'lucide-react';

type TabId = 'system' | 'router' | 'llm' | 'logs' | 'messages' | 'conversations';

const TABS: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: 'system', label: 'System Overview', icon: Server },
  { id: 'router', label: 'AI Router', icon: BrainCircuit },
  { id: 'llm', label: '🧠 LLM Execution Logs', icon: Sparkles },
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
    tone === 'ok' ? 'text-[#008069]' : tone === 'warn' ? 'text-amber-700' : tone === 'err' ? 'text-rose-600' : 'text-[#111b21]';
  return (
    <div className="bg-white border border-[#e9edef] rounded-2xl p-4 flex flex-col gap-1 shadow-xs">
      <p className="text-[11px] uppercase font-bold text-[#667781] tracking-wider">{label}</p>
      <p className={`text-2xl font-extrabold ${toneCls}`}>{value}</p>
      {sub && <p className="text-xs text-[#8696a0] truncate">{sub}</p>}
    </div>
  );
}

function SectionHeader({ title, onRefresh, loading, auto }: { title: string; onRefresh: () => void; loading: boolean; auto?: boolean }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2">{title}</h3>
      <div className="flex items-center gap-3">
        {auto && <span className="text-xs text-[#8696a0]">auto-refresh 5s</span>}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-2 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-[#54656f] hover:text-[#111b21] transition shadow-xs disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin text-[#008069]' : ''} />
        </button>
      </div>
    </div>
  );
}

function ErrNote({ note }: { note?: string }) {
  if (!note) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2 mb-3 shadow-xs">
      <AlertTriangle size={14} className="text-amber-600 shrink-0" />
      <span>{note}</span>
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
        ok ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-rose-100 text-rose-800 border border-rose-200'
      }`}
    >
      {ok ? <CheckCircle2 size={11} className="text-emerald-600" /> : <XCircle size={11} className="text-rose-600" />}
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

      <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-4 shadow-xs">
        <h4 className="text-xs font-bold text-[#111b21] flex items-center gap-2">
          <Cpu size={15} className="text-[#008069]" /> <span>AI Router &amp; Feature Flags</span>
        </h4>
        <div className="flex flex-wrap gap-2">
          <Badge ok={!!data?.aiRouter.enabled} label={`AI_ROUTER_ENABLED=${data?.aiRouter.enabled ? 'ON' : 'OFF'}`} />
          <Badge ok={!!data?.aiRouter.shadowMode} label={`SHADOW_MODE=${data?.aiRouter.shadowMode ? 'ON' : 'OFF'}`} />
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border ${
              circuit === 'CLOSED'
                ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                : circuit === 'HALF_OPEN'
                ? 'bg-amber-100 text-amber-800 border-amber-200'
                : 'bg-rose-100 text-rose-800 border-rose-200'
            }`}
          >
            <Activity size={11} /> Circuit: {circuit}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] uppercase font-bold text-[#667781] border-b border-[#e9edef] bg-[#f8fafc]">
                <th className="py-2.5 px-3">Flag</th>
                <th className="py-2.5 px-3">Fungsi</th>
                <th className="py-2.5 px-3">Nilai</th>
              </tr>
            </thead>
            <tbody>
              {data?.featureFlags.map((f) => (
                <tr key={f.key} className="border-b border-[#e9edef] last:border-0 hover:bg-[#f8fafc] transition-colors">
                  <td className="py-2.5 px-3 font-mono text-xs text-[#111b21] font-semibold">{f.key}</td>
                  <td className="py-2.5 px-3 text-xs text-[#667781]">{f.label}</td>
                  <td className="py-2.5 px-3">
                    {f.value === 'unset' ? (
                      <span className="text-[#8696a0] text-xs">unset</span>
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
          <p className="text-xs text-[#8696a0]">
            <ShieldAlert size={12} className="inline mr-1 text-amber-600" />
            Secret keys terpasang tapi disembunyikan: {data.secretKeysPresent.join(', ')}
          </p>
        )}
        <p className="text-xs text-[#8696a0]">
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
        <div className="flex items-center gap-1.5 bg-white border border-[#e9edef] rounded-xl p-1 shadow-xs">
          {[1, 3, 7, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                days === d ? 'bg-[#008069] text-white shadow-xs' : 'text-[#667781] hover:text-[#111b21]'
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

      <div className={`bg-white border rounded-2xl p-5 shadow-xs ${medOk ? 'border-[#e9edef]' : 'border-rose-300 bg-rose-50/40'}`}>
        <h4 className="text-xs font-bold text-[#111b21] flex items-center gap-2 mb-3">
          <AlertTriangle size={15} className={medOk ? 'text-[#008069]' : 'text-rose-600'} />
          <span>Mismatch MEDICAL_CONCERN (wajib 0 sebelum matikan shadow mode)</span>
        </h4>
        {medOk ? (
          <p className="text-xs text-emerald-700 font-medium">Tidak ada mismatch terkait MEDICAL_CONCERN — aman.</p>
        ) : (
          <div className="space-y-2">
            {data?.medicalMismatches.map((m, i) => (
              <div key={i} className="flex items-start gap-3 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 text-xs shadow-xs">
                <XCircle size={14} className="text-rose-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[#111b21] font-semibold truncate">{m.message_text}</p>
                  <p className="text-[#667781] text-[11px] mt-0.5">
                    LLM: <span className="text-rose-700 font-bold">{m.llm_intent ?? 'N/A'}</span> · Legacy: <span className="text-rose-700 font-bold">{m.legacy_intent}</span> · {fmtTime(m.created_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-[#e9edef] rounded-2xl p-5 shadow-xs">
        <h4 className="text-xs font-bold text-[#111b21] mb-3">Evaluasi Terbaru</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left uppercase font-bold text-[#667781] border-b border-[#e9edef] bg-[#f8fafc]">
                <th className="py-2.5 px-3">Waktu</th>
                <th className="py-2.5 px-3">State</th>
                <th className="py-2.5 px-3">Pesan</th>
                <th className="py-2.5 px-3">LLM</th>
                <th className="py-2.5 px-3">Legacy</th>
                <th className="py-2.5 px-3">Intent ✓</th>
                <th className="py-2.5 px-3">Esc ✓</th>
                <th className="py-2.5 px-3">Fallback</th>
                <th className="py-2.5 px-3">ms</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recentEvaluations ?? []).length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4 text-center text-[#8696a0]">Belum ada data evaluasi.</td>
                </tr>
              )}
              {data?.recentEvaluations.map((e) => (
                <tr key={e.id} className="border-b border-[#e9edef] last:border-0 hover:bg-[#f8fafc] transition-colors">
                  <td className="py-2.5 px-3 whitespace-nowrap text-[#667781]">{fmtTime(e.created_at)}</td>
                  <td className="py-2.5 px-3 text-[#111b21] font-mono">{e.current_state}</td>
                  <td className="py-2.5 px-3 text-[#111b21] max-w-[200px] truncate" title={e.message_text}>{e.message_text}</td>
                  <td className="py-2.5 px-3 font-semibold">{e.llm_intent ?? <span className="text-[#8696a0]">N/A</span>}</td>
                  <td className="py-2.5 px-3 text-[#667781]">{e.legacy_intent}</td>
                  <td className="py-2.5 px-3">{e.intent_match ? <CheckCircle2 size={14} className="text-emerald-600" /> : <XCircle size={14} className="text-rose-600" />}</td>
                  <td className="py-2.5 px-3">{e.escalation_match ? <CheckCircle2 size={14} className="text-emerald-600" /> : <XCircle size={14} className="text-rose-600" />}</td>
                  <td className="py-2.5 px-3">{e.llm_used_fallback ? <span className="text-amber-700 font-bold">yes</span> : <span className="text-[#8696a0]">no</span>}</td>
                  <td className="py-2.5 px-3 text-[#667781]">{e.response_time_ms ?? '-'}</td>
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
      const res = await apiRequest(`/api/admin/debug/logs?limit=150&level=${level}`, { timeoutMs: 6000 });
      if (res && res.data) {
        setEntries(res.data.entries || []);
        setInstalled(res.data.installed !== false);
        setStats(res.data.stats || {});
      }
    } catch {
      // Degrade gracefully
    } finally {
      setLoading(false);
    }
  }, [level]);

  useEffect(() => {
    let mounted = true;
    load();
    const t = setInterval(() => {
      if (mounted && document.visibilityState === 'visible') {
        load();
      }
    }, 10000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, [load]);

  const levelColor = (l: string) =>
    l === 'error' ? 'text-rose-700 font-bold' : l === 'warn' ? 'text-amber-700 font-bold' : l === 'info' ? 'text-[#008069] font-bold' : 'text-[#667781]';

  return (
    <div className="space-y-4">
      <SectionHeader title="Log Buffer (in-memory)" onRefresh={load} loading={loading} auto />
      {!installed && <ErrNote note="Log buffer belum terpasang — restart server agar console log tertangkap." />}
      <div className="flex flex-wrap items-center gap-1.5 bg-white border border-[#e9edef] rounded-xl p-1 w-fit shadow-xs">
        {(['all', 'error', 'warn', 'info', 'log'] as const).map((l) => (
          <button
            key={l}
            onClick={() => setLevel(l)}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
              level === l ? 'bg-[#008069] text-white shadow-xs' : 'text-[#667781] hover:text-[#111b21]'
            }`}
          >
            {l.toUpperCase()} {l !== 'all' && <span className="opacity-70">({stats[l] ?? 0})</span>}
          </button>
        ))}
      </div>
      <div className="bg-white border border-[#e9edef] rounded-2xl p-4 max-h-[70vh] overflow-y-auto font-mono text-xs shadow-xs space-y-1">
        {entries.length === 0 && <p className="text-[#8696a0]">Belum ada log.</p>}
        {entries.map((e) => (
          <div key={e.id} className="flex gap-3 border-b border-[#e9edef] py-1.5 last:border-0">
            <span className="text-[#8696a0] whitespace-nowrap">{new Date(e.ts).toLocaleTimeString('id-ID')}</span>
            <span className={`w-12 shrink-0 uppercase ${levelColor(e.level)}`}>{e.level}</span>
            <span className="text-[#111b21] whitespace-pre-wrap break-all">{e.msg}</span>
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
      <div className="bg-white border border-[#e9edef] rounded-2xl p-4 overflow-x-auto shadow-xs">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left uppercase font-bold text-[#667781] border-b border-[#e9edef] bg-[#f8fafc]">
              <th className="py-2.5 px-3">Waktu</th>
              <th className="py-2.5 px-3">Arah</th>
              <th className="py-2.5 px-3">Customer</th>
              <th className="py-2.5 px-3">WA Msg ID</th>
              <th className="py-2.5 px-3">Konten</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-[#8696a0]">Belum ada pesan.</td>
              </tr>
            )}
            {data.entries.map((m) => (
              <tr key={m.id} className="border-b border-[#e9edef] last:border-0 align-top hover:bg-[#f8fafc] transition-colors">
                <td className="py-2.5 px-3 whitespace-nowrap text-[#667781]">{fmtTime(m.created_at)}</td>
                <td className="py-2.5 px-3">
                  {m.direction === 'INBOUND' ? (
                    <span className="inline-flex items-center gap-1 text-[#008069] font-bold"><Activity size={11} /> IN</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-sky-700 font-bold"><MessageSquare size={11} /> OUT</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-[#111b21] font-semibold">
                  {m.customerName || '?'}
                  <span className="block text-[#667781] font-mono text-[11px] font-normal">{m.customerPhone}</span>
                </td>
                <td className="py-2.5 px-3 font-mono text-[10px] text-[#8696a0] max-w-[100px] truncate" title={m.wa_message_id ?? ''}>{m.wa_message_id ?? '-'}</td>
                <td className="py-2.5 px-3 text-[#111b21] whitespace-pre-wrap break-all max-w-[420px]">{m.content}</td>
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
        <label className="text-[11px] uppercase font-bold text-[#667781]">Filter Eskalasi</label>
        <select
          value={escFilter}
          onChange={(e) => setEscFilter(e.target.value)}
          className="px-2.5 py-1.5 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
        >
          <option value="all">Semua</option>
          <option value="none">Tanpa eskalasi</option>
          {reasonOptions.map((r) => (
            <option key={r} value={r}>
              {r === 'LEGACY_AI_SCOPE_DISABLED' ? 'LEGACY_AI_SCOPE_DISABLED (AI scope)' : r}
            </option>
          ))}
        </select>
        <span className="text-xs text-[#8696a0]">{filteredEntries.length} / {data.entries.length} baris</span>
      </div>
      <div className="bg-white border border-[#e9edef] rounded-2xl p-4 overflow-x-auto shadow-xs">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left uppercase font-bold text-[#667781] border-b border-[#e9edef] bg-[#f8fafc]">
              <th className="py-2.5 px-3">Customer</th>
              <th className="py-2.5 px-3">State</th>
              <th className="py-2.5 px-3">Human Handling</th>
              <th className="py-2.5 px-3">Eskalasi</th>
              <th className="py-2.5 px-3">UNKNOWN×</th>
              <th className="py-2.5 px-3">Lokasi Gagal</th>
              <th className="py-2.5 px-3">Aktivitas Terakhir</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-[#8696a0]">Belum ada conversation.</td>
              </tr>
            )}
            {filteredEntries.map((c) => (
              <tr key={c.id} className="border-b border-[#e9edef] last:border-0 hover:bg-[#f8fafc] transition-colors">
                <td className="py-2.5 px-3 text-[#111b21] font-semibold">
                  {c.customerName || '?'}
                  <span className="block text-[#667781] font-mono text-[11px] font-normal">{c.customerPhone}</span>
                </td>
                <td className="py-2.5 px-3">
                  <span className="px-2 py-0.5 rounded-full bg-[#f8fafc] text-[#111b21] border border-[#d1d7db] text-[10px] font-mono font-medium">{c.current_state}</span>
                </td>
                <td className="py-2.5 px-3">{c.is_human_handling ? <Badge ok label="HUMAN" /> : <span className="text-[#8696a0]">bot</span>}</td>
                <td className="py-2.5 px-3 text-[#667781]">{c.escalation_reason || '-'}</td>
                <td className="py-2.5 px-3">
                  {c.consecutive_unknown_count > 0 ? (
                    <span className="text-amber-700 font-bold">{c.consecutive_unknown_count}</span>
                  ) : (
                    <span className="text-[#8696a0]">0</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-[#667781]">{c.location_attempts}</td>
                <td className="py-2.5 px-3 text-[#667781] whitespace-nowrap">{fmtTime(c.last_message_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- LLM Execution Logs
interface LlmLogEntry {
  id: string;
  timestamp: string;
  flowType:
    | 'CHATBOT_AUTO'
    | 'COPILOT_DRAFT'
    | 'CLINICAL_ESCALATION'
    | 'REASONING_ONLY'
    | 'NLU_CLASSIFICATION'
    | 'AI_ROUTER'
    | 'AI_VERIFIER'
    | 'PHRASING'
    | 'SLOT_EXTRACTOR'
    | 'SLOT_GENERATOR'
    | 'SLOT_FAST_FAQ';
  customerPhone?: string;
  customerName?: string;
  customerInput: string;
  bubbleCorrelationId?: string;
  promptPayload?: any;
  reasoning: string | null;
  rawReasoning?: string | null;
  groundTruthUsed?: any;
  contextSummary?: string;
  finalReply: string;
  confidenceScore?: number;
  modelUsed?: string;
  durationMs?: number;
  status: 'SUCCESS' | 'FALLBACK' | 'ERROR';
}

interface GroupedBubbleChat {
  correlationId: string;
  timestamp: string;
  customerInput: string;
  customerName?: string;
  aiCalls: LlmLogEntry[];
}

interface GroupedCustomerLlmLogs {
  customerPhone: string;
  customerName: string;
  totalBubbles: number;
  totalAiCalls: number;
  latestTimestamp: string;
  bubbles: GroupedBubbleChat[];
}

const getFlowBadge = (flowType: string) => {
  switch (flowType) {
    case 'NLU_CLASSIFICATION':
      return { label: '1. NLU Intent & Entitas', short: 'NLU', icon: '🔍', cls: 'bg-cyan-50 text-cyan-800 border-cyan-200' };
    case 'AI_ROUTER':
      return { label: '2. AI Router Decision', short: 'ROUTER', icon: '🧭', cls: 'bg-indigo-50 text-indigo-800 border-indigo-200' };
    case 'CHATBOT_AUTO':
      return { label: '3. RAG Generator', short: 'GENERATOR', icon: '🤖', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
    case 'AI_VERIFIER':
      return { label: '4. AI QC Verifier', short: 'QC VERIFIER', icon: '🛡️', cls: 'bg-amber-50 text-amber-900 border-amber-300' };
    case 'COPILOT_DRAFT':
      return { label: 'AI Copilot Draft', short: 'COPILOT', icon: '💡', cls: 'bg-purple-50 text-purple-800 border-purple-200' };
    case 'PHRASING':
      return { label: '5. Persona Phrasing', short: 'PHRASING', icon: '✍️', cls: 'bg-teal-50 text-teal-800 border-teal-200' };
    case 'SLOT_EXTRACTOR':
      return { label: 'Slot Extractor', short: 'SLOT EXT', icon: '🎰', cls: 'bg-violet-50 text-violet-800 border-violet-200' };
    case 'SLOT_GENERATOR':
      return { label: 'Slot Generator', short: 'SLOT GEN', icon: '🎯', cls: 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200' };
    case 'SLOT_FAST_FAQ':
      return { label: 'Fast-Track FAQ (1-Call)', short: 'FAST FAQ', icon: '⚡', cls: 'bg-amber-50 text-amber-900 border-amber-300' };
    case 'CLINICAL_ESCALATION':
      return { label: 'Clinical Escalation', short: 'ESCALATE', icon: '🚨', cls: 'bg-rose-50 text-rose-800 border-rose-200' };
    default:
      return { label: flowType, short: flowType, icon: '⚡', cls: 'bg-slate-50 text-slate-800 border-slate-200' };
  }
};

function formatPhoneDisplay(phone?: string): string {
  if (!phone || phone === 'Unknown / General' || phone === 'unknown') return 'Umum / Tidak Dikenal';
  const clean = phone.replace(/[^\d+]/g, '');
  if (clean.startsWith('+')) return clean;
  if (clean.startsWith('62')) return `+${clean.slice(0, 2)} ${clean.slice(2, 5)}-${clean.slice(5, 9)}-${clean.slice(9)}`;
  return `+${clean}`;
}

function LlmLogsSection() {
  const { toast, confirm } = useUiFeedback();
  const [groupedData, setGroupedData] = useState<GroupedCustomerLlmLogs[]>([]);
  const [flatLogs, setFlatLogs] = useState<LlmLogEntry[]>([]);
  const [viewMode, setViewMode] = useState<'grouped' | 'flat'>('grouped');
  const [loading, setLoading] = useState(true);
  const [autoSync, setAutoSync] = useState(true);
  const [flowFilter, setFlowFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Accordion & detail states
  const [expandedPhones, setExpandedPhones] = useState<Record<string, boolean>>({});
  const [expandedBubbles, setExpandedBubbles] = useState<Record<string, boolean>>({});
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadLogs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [groupedRes, flatRes] = await Promise.allSettled([
        apiRequest(`/api/admin/debug/llm-grouped-logs?limit=300&flow=${flowFilter}`),
        apiRequest(`/api/admin/debug/llm-logs?limit=150&flow=${flowFilter}`),
      ]);

      if (groupedRes.status === 'fulfilled' && groupedRes.value?.data) {
        const data = groupedRes.value.data;
        setGroupedData(Array.isArray(data) ? data : []);
        // Auto-expand first customer on initial load if nothing expanded
        if (Array.isArray(data) && data.length > 0 && Object.keys(expandedPhones).length === 0) {
          setExpandedPhones({ [data[0].customerPhone]: true });
          if (data[0].bubbles?.length > 0) {
            setExpandedBubbles({ [data[0].bubbles[0].correlationId]: true });
          }
        }
      }

      if (flatRes.status === 'fulfilled' && flatRes.value?.data) {
        setFlatLogs(Array.isArray(flatRes.value.data) ? flatRes.value.data : []);
      }
    } catch (err) {
      console.warn('Gagal memuat LLM execution logs:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [flowFilter, expandedPhones]);

  useEffect(() => {
    loadLogs(false);
  }, [flowFilter]);

  // Polling interval (silent auto-sync)
  useEffect(() => {
    if (!autoSync) return;
    const interval = setInterval(() => {
      loadLogs(true);
    }, 6000);
    return () => clearInterval(interval);
  }, [autoSync, loadLogs]);

  const togglePhone = (phone: string) => {
    setExpandedPhones((prev) => ({ ...prev, [phone]: !prev[phone] }));
  };

  const toggleBubble = (corrId: string) => {
    setExpandedBubbles((prev) => ({ ...prev, [corrId]: !prev[corrId] }));
  };

  const toggleDetail = (key: string) => {
    setExpandedDetails((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleAllAccordions = (expand: boolean) => {
    if (!expand) {
      setExpandedPhones({});
      setExpandedBubbles({});
      return;
    }
    const newPhones: Record<string, boolean> = {};
    const newBubbles: Record<string, boolean> = {};
    for (const cust of groupedData) {
      newPhones[cust.customerPhone] = true;
      for (const b of cust.bubbles) {
        newBubbles[b.correlationId] = true;
      }
    }
    setExpandedPhones(newPhones);
    setExpandedBubbles(newBubbles);
  };

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleClearBuffer = async () => {
    const ok = await confirm({
      title: 'Hapus Buffer Log LLM',
      message: 'Apakah Anda yakin ingin mengosongkan semua riwayat LLM execution logs di memori? Log yang terhapus tidak dapat dikembalikan.',
      confirmText: 'Hapus Buffer',
      cancelText: 'Batal',
      danger: true,
    });
    if (!ok) return;

    try {
      const res = await apiRequest('/api/admin/debug/llm-logs', { method: 'DELETE' });
      if (res.success) {
        setGroupedData([]);
        setFlatLogs([]);
        setExpandedPhones({});
        setExpandedBubbles({});
        toast('Buffer LLM execution logs berhasil dikosongkan.', 'success');
      }
    } catch (err: any) {
      toast(err?.message || 'Gagal mengosongkan buffer log.', 'error');
    }
  };

  const handleExportJson = () => {
    const dataToExport = viewMode === 'grouped' ? groupedData : flatLogs;
    const jsonStr = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `llm_execution_logs_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Filter grouped data
  const filteredGrouped = useMemo(() => {
    let list = groupedData;

    // Filter by Status
    if (statusFilter !== 'all') {
      list = list
        .map((cust) => {
          const matchingBubbles = cust.bubbles
            .map((b) => ({
              ...b,
              aiCalls: b.aiCalls.filter((c) => c.status === statusFilter),
            }))
            .filter((b) => b.aiCalls.length > 0);
          return matchingBubbles.length > 0 ? { ...cust, bubbles: matchingBubbles } : null;
        })
        .filter((c): c is GroupedCustomerLlmLogs => c !== null);
    }

    // Filter by Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list
        .map((cust) => {
          const matchPhone = cust.customerPhone.toLowerCase().includes(q);
          const matchName = cust.customerName.toLowerCase().includes(q);
          const matchingBubbles = cust.bubbles.filter((b) => {
            const matchInput = b.customerInput.toLowerCase().includes(q);
            const matchCalls = b.aiCalls.some(
              (call) =>
                (call.reasoning && call.reasoning.toLowerCase().includes(q)) ||
                (call.rawReasoning && call.rawReasoning.toLowerCase().includes(q)) ||
                (call.finalReply && call.finalReply.toLowerCase().includes(q)) ||
                (call.modelUsed && call.modelUsed.toLowerCase().includes(q))
            );
            return matchInput || matchCalls;
          });

          if (matchPhone || matchName) {
            return cust;
          }
          if (matchingBubbles.length > 0) {
            return { ...cust, bubbles: matchingBubbles };
          }
          return null;
        })
        .filter((c): c is GroupedCustomerLlmLogs => c !== null);
    }

    return list;
  }, [groupedData, statusFilter, searchQuery]);

  // Aggregate stats
  const totalCustomers = groupedData.length;
  const totalBubbles = groupedData.reduce((acc, c) => acc + c.totalBubbles, 0);
  const totalAiSteps = groupedData.reduce((acc, c) => acc + c.totalAiCalls, 0);

  return (
    <div className="space-y-4">
      {/* Top Header with Live Indicator & Action Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-[#e9edef] shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-extrabold text-[#111b21] flex items-center gap-2">
              <span>🧠 Dedicated LLM Execution Tracing</span>
            </h3>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
              autoSync ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${autoSync ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
              {autoSync ? 'Auto-Sync 6s' : 'Jeda'}
            </span>
          </div>
          <p className="text-xs text-[#667781] mt-0.5">
            Observability alur penuh: <span className="font-semibold text-[#111b21]">NLU Intent ➔ AI Router ➔ RAG Generator ➔ QC Verifier</span>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setAutoSync(!autoSync)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition shadow-xs ${
              autoSync
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
            title={autoSync ? 'Jeda Sinkronisasi Otomatis' : 'Aktifkan Sinkronisasi Otomatis'}
          >
            {autoSync ? <Pause size={13} className="text-emerald-700" /> : <Play size={13} className="text-slate-600" />}
            <span>{autoSync ? 'Pause' : 'Play'}</span>
          </button>

          <button
            onClick={() => loadLogs(false)}
            disabled={loading}
            className="px-3 py-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-xs font-bold text-[#111b21] transition shadow-xs flex items-center gap-1.5 disabled:opacity-50"
            title="Refresh Manual"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin text-[#008069]' : 'text-slate-600'} />
            <span>Refresh</span>
          </button>

          <button
            onClick={handleExportJson}
            disabled={groupedData.length === 0}
            className="px-3 py-1.5 rounded-xl bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] text-xs font-bold text-[#111b21] transition shadow-xs flex items-center gap-1.5 disabled:opacity-50"
            title="Export Debug Data as JSON"
          >
            <Download size={13} className="text-slate-600" />
            <span>Export JSON</span>
          </button>

          <button
            onClick={handleClearBuffer}
            disabled={groupedData.length === 0}
            className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-bold text-rose-700 transition shadow-xs flex items-center gap-1.5 disabled:opacity-40"
            title="Hapus / Reset Buffer LLM Logs"
          >
            <Trash2 size={13} />
            <span>Reset Buffer</span>
          </button>
        </div>
      </div>

      {/* Aggregate Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-white border border-[#e9edef] rounded-xl p-3 flex items-center gap-3 shadow-2xs">
          <div className="w-8 h-8 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700">
            <Phone size={15} />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Pasien Aktif</p>
            <p className="text-base font-extrabold text-slate-900">{totalCustomers}</p>
          </div>
        </div>

        <div className="bg-white border border-[#e9edef] rounded-xl p-3 flex items-center gap-3 shadow-2xs">
          <div className="w-8 h-8 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-700">
            <MessageSquare size={15} />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Bubble Diproses</p>
            <p className="text-base font-extrabold text-slate-900">{totalBubbles}</p>
          </div>
        </div>

        <div className="bg-white border border-[#e9edef] rounded-xl p-3 flex items-center gap-3 shadow-2xs">
          <div className="w-8 h-8 rounded-lg bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-700">
            <BrainCircuit size={15} />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Total AI Steps</p>
            <p className="text-base font-extrabold text-purple-900">{totalAiSteps}</p>
          </div>
        </div>

        <div className="bg-white border border-[#e9edef] rounded-xl p-3 flex items-center gap-3 shadow-2xs">
          <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
            <ShieldCheck size={15} />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">QC Verifier Active</p>
            <p className="text-base font-extrabold text-amber-900">4 Pilar Aktif</p>
          </div>
        </div>
      </div>

      {/* Filter Controls & Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 bg-white p-3 rounded-2xl border border-[#e9edef] shadow-xs">
        {/* Flow Filters */}
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'all', label: 'Semua Flow' },
            { id: 'NLU_CLASSIFICATION', label: '🔍 1. NLU Intent' },
            { id: 'AI_ROUTER', label: '🧭 2. AI Router' },
            { id: 'CHATBOT_AUTO', label: '🤖 3. Generator' },
            { id: 'AI_VERIFIER', label: '🛡️ 4. QC Verifier' },
            { id: 'PHRASING', label: '✍️ 5. Phrasing' },
            { id: 'COPILOT_DRAFT', label: '💡 Copilot' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFlowFilter(f.id)}
              className={`px-2.5 py-1 rounded-xl text-xs font-bold transition shadow-2xs ${
                flowFilter === f.id
                  ? 'bg-[#008069] text-white border border-[#008069]'
                  : 'bg-white text-[#54656f] border border-[#d1d7db] hover:bg-[#f0f2f5]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Status Filter, Search & View Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-xl bg-white border border-[#d1d7db] text-xs font-semibold text-[#111b21] focus:outline-none focus:border-[#008069] shadow-2xs"
          >
            <option value="all">Semua Status</option>
            <option value="SUCCESS">✅ SUCCESS</option>
            <option value="FALLBACK">⚠️ FALLBACK</option>
            <option value="ERROR">❌ ERROR</option>
          </select>

          {/* Search Box */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nomor, reasoning, teks..."
            className="w-full sm:w-44 px-3 py-1.5 rounded-xl bg-white border border-[#d1d7db] text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-2xs"
          />

          {/* View Switcher */}
          <div className="flex bg-[#e9edef] p-0.5 rounded-xl text-xs font-bold shrink-0">
            <button
              onClick={() => setViewMode('grouped')}
              className={`px-2.5 py-1 rounded-lg transition ${
                viewMode === 'grouped' ? 'bg-white text-[#008069] shadow-xs' : 'text-[#667781]'
              }`}
            >
              Pohon 3-Level
            </button>
            <button
              onClick={() => setViewMode('flat')}
              className={`px-2.5 py-1 rounded-lg transition ${
                viewMode === 'flat' ? 'bg-white text-[#008069] shadow-xs' : 'text-[#667781]'
              }`}
            >
              Flat Feed
            </button>
          </div>

          {/* Quick Expand All Toggle */}
          {viewMode === 'grouped' && (
            <button
              type="button"
              onClick={() => {
                const anyOpen = Object.keys(expandedPhones).length > 0;
                toggleAllAccordions(!anyOpen);
              }}
              className="px-2 py-1.5 rounded-xl bg-white border border-[#d1d7db] hover:bg-slate-50 text-[11px] font-semibold text-slate-700 transition"
              title="Buka / Tutup Semua Accordion"
            >
              {Object.keys(expandedPhones).length > 0 ? 'Tutup Semua' : 'Buka Semua'}
            </button>
          )}
        </div>
      </div>

      {/* VIEW MODE 1: HIERARCHICAL 3-LEVEL PIPELINE VIEW */}
      {viewMode === 'grouped' && (
        <div className="space-y-3">
          {filteredGrouped.length === 0 ? (
            <div className="bg-white border border-[#e9edef] rounded-2xl p-10 text-center text-xs text-[#8696a0] shadow-xs">
              {searchQuery ? 'Tidak ada riwayat chat/LLM yang cocok dengan pencarian.' : 'Belum ada eksekusi LLM yang tercatat di buffer.'}
            </div>
          ) : (
            filteredGrouped.map((cust) => {
              const isPhoneExpanded = !!expandedPhones[cust.customerPhone];

              return (
                <div
                  key={cust.customerPhone}
                  className="bg-white border border-[#e9edef] hover:border-[#b4ded5] rounded-2xl shadow-xs transition overflow-hidden text-left"
                >
                  {/* LEVEL 1: CUSTOMER HEADER */}
                  <div
                    onClick={() => togglePhone(cust.customerPhone)}
                    className="p-4 bg-[#f8fafc] hover:bg-[#f0f4f7] cursor-pointer flex items-center justify-between gap-3 border-b border-[#e9edef] select-none"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#e8f5f2] border border-[#008069]/30 flex items-center justify-center text-[#008069] font-bold text-xs shadow-2xs">
                        <Phone size={15} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-extrabold text-sm text-[#111b21]">
                            {cust.customerName || 'Pasien'}
                          </span>
                          <span className="font-mono text-xs text-[#008069] bg-white px-2 py-0.5 rounded-md border border-[#b4ded5] font-semibold">
                            {formatPhoneDisplay(cust.customerPhone)}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#8696a0] mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span>{cust.totalBubbles} Percakapan Masuk</span>
                          <span>•</span>
                          <span>{cust.totalAiCalls} Panggilan AI</span>
                          <span>•</span>
                          <span>Aktivitas Terakhir: {fmtTime(cust.latestTimestamp)}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <span className="text-xs font-bold text-[#008069] bg-[#e8f5f2] px-3 py-1 rounded-full border border-[#008069]/20 hidden sm:inline-block">
                        {cust.totalBubbles} Percakapan
                      </span>
                      {isPhoneExpanded ? <ChevronDown size={18} className="text-[#667781]" /> : <ChevronRight size={18} className="text-[#667781]" />}
                    </div>
                  </div>

                  {/* LEVEL 2: CHAT BUBBLES WITH PIPELINE STEPPERS */}
                  {isPhoneExpanded && (
                    <div className="p-4 space-y-3.5 bg-[#fdfefe]">
                      {cust.bubbles.map((bubble, bIdx) => {
                        const isBubbleExpanded = !!expandedBubbles[bubble.correlationId];
                        const totalBubbleDuration = bubble.aiCalls.reduce((acc, c) => acc + (c.durationMs || 0), 0);
                        const lastModel = bubble.aiCalls[bubble.aiCalls.length - 1]?.modelUsed;
                        const qcStep = bubble.aiCalls.find((c) => c.flowType === 'AI_VERIFIER');

                        return (
                          <div
                            key={bubble.correlationId}
                            className="border border-[#e2e8f0] rounded-2xl bg-white shadow-xs overflow-hidden transition"
                          >
                            {/* BUBBLE HEADER WITH PIPELINE PREVIEW */}
                            <div
                              onClick={() => toggleBubble(bubble.correlationId)}
                              className="p-3.5 bg-white hover:bg-slate-50 cursor-pointer flex flex-col gap-2.5 border-b border-slate-100 select-none"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-2.5">
                                  <div className="p-1.5 rounded-lg bg-sky-100 text-sky-800 shrink-0 mt-0.5">
                                    <MessageSquare size={14} />
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs font-extrabold text-slate-900">
                                        Bubble #{bIdx + 1}: &ldquo;{bubble.customerInput}&rdquo;
                                      </span>
                                    </div>
                                    <span className="text-[10px] font-mono text-slate-500 mt-0.5 block">
                                      Waktu Masuk: {fmtTime(bubble.timestamp)}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  {totalBubbleDuration > 0 && (
                                    <span className="text-[10px] font-mono font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                                      ⏱️ Total {totalBubbleDuration}ms
                                    </span>
                                  )}
                                  {isBubbleExpanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                                </div>
                              </div>

                              {/* PIPELINE STEPPER VISUALIZATION */}
                              <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-100/80">
                                {bubble.aiCalls.map((step, sIdx) => {
                                  const badge = getFlowBadge(step.flowType);
                                  const isSuccess = step.status === 'SUCCESS';
                                  const isFallback = step.status === 'FALLBACK';

                                  return (
                                    <React.Fragment key={step.id || sIdx}>
                                      <div className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border ${badge.cls}`}>
                                        <span>{badge.icon}</span>
                                        <span>{badge.short}</span>
                                        <span className={`w-1.5 h-1.5 rounded-full ml-0.5 ${
                                          isSuccess ? 'bg-emerald-500' : isFallback ? 'bg-amber-500' : 'bg-rose-500'
                                        }`} />
                                      </div>
                                      {sIdx < bubble.aiCalls.length - 1 && (
                                        <ArrowRight size={11} className="text-slate-300 shrink-0" />
                                      )}
                                    </React.Fragment>
                                  );
                                })}

                                {qcStep && (
                                  <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                                    qcStep.reasoning?.includes('VIOLATION')
                                      ? 'bg-amber-50 text-amber-900 border-amber-300'
                                      : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  }`}>
                                    {qcStep.reasoning?.includes('VIOLATION') ? '⚠️ QC: Terkoreksi' : '🛡️ QC: Lolos Aman'}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* LEVEL 3: INDIVIDUAL AI CALLS (TAILORED DETAIL CARDS) */}
                            {isBubbleExpanded && (
                              <div className="p-4 bg-slate-50/60 space-y-3.5">
                                {bubble.aiCalls.map((call, cIdx) => {
                                  const badge = getFlowBadge(call.flowType);
                                  const displayReasoning = call.rawReasoning || call.reasoning || 'Tidak ada reasoning teks terpisah.';
                                  const detailKey = `${call.id || cIdx}_detail`;
                                  const isDetailOpen = !!expandedDetails[detailKey];

                                  return (
                                    <div
                                      key={call.id || cIdx}
                                      className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3"
                                    >
                                      {/* AI Step Header Bar */}
                                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${badge.cls} flex items-center gap-1`}>
                                            <span>{badge.icon}</span>
                                            <span>{badge.label}</span>
                                          </span>

                                          {call.modelUsed && (
                                            <span className="text-[10px] font-mono text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200 font-semibold">
                                              {call.modelUsed}
                                            </span>
                                          )}

                                          {call.durationMs !== undefined && (
                                            <span className="text-[10px] font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                                              ⏱️ {call.durationMs}ms
                                            </span>
                                          )}

                                          {call.confidenceScore !== undefined && (
                                            <span className="text-[10px] font-mono text-cyan-800 bg-cyan-50 px-2 py-0.5 rounded-md border border-cyan-200 font-bold">
                                              Confidence: {Math.round(call.confidenceScore * 100)}%
                                            </span>
                                          )}
                                        </div>

                                        <div className="flex items-center gap-2">
                                          <span
                                            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                                              call.status === 'SUCCESS'
                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                : call.status === 'FALLBACK'
                                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                                            }`}
                                          >
                                            {call.status}
                                          </span>

                                          <button
                                            type="button"
                                            onClick={() => copyText(call.id, JSON.stringify(call, null, 2))}
                                            className="text-[10px] font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 bg-slate-50 hover:bg-slate-100 px-2 py-0.5 rounded border border-slate-200"
                                            title="Salin JSON Langkah Ini"
                                          >
                                            {copiedId === call.id ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                                            <span>{copiedId === call.id ? 'Tersalin' : 'JSON'}</span>
                                          </button>
                                        </div>
                                      </div>

                                      {/* STEP BODY BY FLOW TYPE */}

                                      {/* FLOW TYPE 1: NLU_CLASSIFICATION */}
                                      {call.flowType === 'NLU_CLASSIFICATION' && (
                                        <div className="space-y-2.5 text-xs">
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                            <div className="bg-sky-50/70 border border-sky-200 rounded-xl p-3">
                                              <span className="text-[10px] font-bold text-sky-800 uppercase tracking-wider block mb-1">
                                                💬 Input Teks Customer
                                              </span>
                                              <p className="text-sky-950 font-medium">{call.customerInput || '-'}</p>
                                            </div>

                                            <div className="bg-cyan-50/70 border border-cyan-200 rounded-xl p-3">
                                              <span className="text-[10px] font-bold text-cyan-800 uppercase tracking-wider block mb-1">
                                                🎯 Intent &amp; Entitas Terdeteksi
                                              </span>
                                              <p className="text-cyan-950 font-bold">{call.finalReply || '-'}</p>
                                              {call.groundTruthUsed?.extractedEntities && (
                                                <div className="mt-1.5 flex flex-wrap gap-1">
                                                  {Object.entries(call.groundTruthUsed.extractedEntities).map(([k, v]) => (
                                                    <span key={k} className="text-[10px] font-mono bg-white text-cyan-900 px-1.5 py-0.5 rounded border border-cyan-200">
                                                      {k}: {String(v)}
                                                    </span>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          </div>

                                          {call.reasoning && (
                                            <div className="bg-purple-50/60 border border-purple-200 rounded-xl p-3">
                                              <span className="text-[10px] font-bold text-purple-800 uppercase tracking-wider block mb-1">
                                                🧠 NLU Reasoning Note
                                              </span>
                                              <p className="text-purple-950 text-[11px] font-mono">{call.reasoning}</p>
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {/* FLOW TYPE 2: AI_ROUTER */}
                                      {call.flowType === 'AI_ROUTER' && (
                                        <div className="space-y-2.5 text-xs">
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                            <div className="bg-sky-50/70 border border-sky-200 rounded-xl p-3">
                                              <span className="text-[10px] font-bold text-sky-800 uppercase tracking-wider block mb-1">
                                                💬 Snapshot State &amp; Pesan
                                              </span>
                                              <p className="text-sky-950 font-medium">{call.customerInput || '-'}</p>
                                            </div>

                                            <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3">
                                              <span className="text-[10px] font-bold text-indigo-800 uppercase tracking-wider block mb-1">
                                                🧭 Keputusan Rute AI
                                              </span>
                                              <p className="text-indigo-950 font-bold">{call.finalReply || '-'}</p>
                                              {call.groundTruthUsed?.shadowMatch !== undefined && (
                                                <span className={`inline-block mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                                  call.groundTruthUsed.shadowMatch
                                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                                    : 'bg-amber-50 text-amber-900 border-amber-200'
                                                }`}>
                                                  Shadow Mode: {call.groundTruthUsed.shadowMatch ? '✅ Cocok dengan Rule' : '⚠️ Berbeda dari Rule'}
                                                </span>
                                              )}
                                            </div>
                                          </div>

                                          {call.reasoning && (
                                            <div className="bg-purple-50/60 border border-purple-200 rounded-xl p-3">
                                              <span className="text-[10px] font-bold text-purple-800 uppercase tracking-wider block mb-1">
                                                🧠 Alasan Rute (Reasoning)
                                              </span>
                                              <p className="text-purple-950 text-[11px] font-mono">{call.reasoning}</p>
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {/* FLOW TYPE 3: CHATBOT_AUTO & COPILOT_DRAFT */}
                                      {(call.flowType === 'CHATBOT_AUTO' || call.flowType === 'COPILOT_DRAFT') && (
                                        <div className="space-y-2.5 text-xs">
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                            <div className="bg-sky-50/70 border border-sky-200 rounded-xl p-3">
                                              <span className="text-[10px] font-bold text-sky-800 uppercase tracking-wider block mb-1">
                                                💬 Pertanyaan / Prompt Masuk
                                              </span>
                                              <p className="text-sky-950 font-medium whitespace-pre-wrap">{call.customerInput || '-'}</p>
                                            </div>

                                            <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3">
                                              <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block mb-1">
                                                📚 Ground Truth &amp; KB Chunks
                                              </span>
                                              {call.groundTruthUsed?.contextChunks ? (
                                                <div className="space-y-1">
                                                  <span className="text-[11px] font-semibold text-amber-900">
                                                    {call.groundTruthUsed.contextChunks.length} Referensi KB Digunakan:
                                                  </span>
                                                  <div className="flex flex-wrap gap-1">
                                                    {call.groundTruthUsed.contextChunks.map((chunk: string, idx: number) => (
                                                      <span key={idx} className="text-[10px] font-mono bg-white text-amber-900 px-1.5 py-0.5 rounded border border-amber-200">
                                                        {chunk}
                                                      </span>
                                                    ))}
                                                  </div>
                                                </div>
                                              ) : (
                                                <p className="text-amber-800/80 italic text-[11px]">Konteks standar persona.</p>
                                              )}
                                            </div>
                                          </div>

                                          {/* Full AI Reasoning & Chain-of-Thought */}
                                          <div className="bg-purple-50/70 border border-purple-200 rounded-xl p-3.5 space-y-2">
                                            <div className="flex items-center justify-between border-b border-purple-200/60 pb-1.5">
                                              <span className="text-[10px] font-extrabold text-purple-900 uppercase tracking-wider flex items-center gap-1.5">
                                                <BrainCircuit size={13} className="text-purple-600" />
                                                <span>🔍 AI Reasoning &amp; Chain-of-Thought Lengkap</span>
                                              </span>
                                              <button
                                                type="button"
                                                onClick={() => copyText(call.id, displayReasoning)}
                                                className="text-[11px] font-semibold text-purple-700 hover:text-purple-950 flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-purple-200 shadow-2xs"
                                              >
                                                {copiedId === call.id ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                                                <span>{copiedId === call.id ? 'Tersalin!' : 'Salin Reasoning'}</span>
                                              </button>
                                            </div>
                                            <pre className="text-purple-950 font-mono text-[11px] whitespace-pre-wrap leading-relaxed overflow-x-auto max-h-64">
                                              {displayReasoning}
                                            </pre>
                                          </div>

                                          {/* Final Reply */}
                                          <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 space-y-1">
                                            <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">
                                              ✉️ Balasan Akhir (Outbound Reply)
                                            </span>
                                            <p className="text-emerald-950 font-medium whitespace-pre-wrap">{call.finalReply || '-'}</p>
                                          </div>
                                        </div>
                                      )}

                                      {/* FLOW TYPE 4: AI_VERIFIER (QC) */}
                                      {call.flowType === 'AI_VERIFIER' && (
                                        <div className="space-y-2.5 text-xs">
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                            {/* QC Status & Violations */}
                                            <div className="bg-amber-50/80 border border-amber-300 rounded-xl p-3 space-y-1">
                                              <span className="text-[10px] font-bold text-amber-900 uppercase tracking-wider block">
                                                🛡️ Evaluasi 4 Pilar QC Verifier
                                              </span>
                                              <p className="text-amber-950 font-bold text-[11px]">{call.reasoning || '-'}</p>
                                            </div>

                                            {/* Final QC Verdict Reply */}
                                            <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-3 space-y-1">
                                              <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">
                                                ✉️ Output Draf Terverifikasi / Terkoreksi
                                              </span>
                                              <p className="text-emerald-950 font-medium whitespace-pre-wrap">{call.finalReply || '-'}</p>
                                            </div>
                                          </div>

                                          {/* Raw QC Reasoning */}
                                          {call.rawReasoning && (
                                            <div className="bg-purple-50/70 border border-purple-200 rounded-xl p-3 space-y-1.5">
                                              <div className="flex items-center justify-between border-b border-purple-200/60 pb-1">
                                                <span className="text-[10px] font-bold text-purple-900 uppercase tracking-wider">
                                                  🔍 Raw QC JSON Output
                                                </span>
                                                <button
                                                  type="button"
                                                  onClick={() => copyText(`${call.id}_raw`, call.rawReasoning || '')}
                                                  className="text-[10px] font-semibold text-purple-700 flex items-center gap-1 bg-white px-1.5 py-0.5 rounded border border-purple-200"
                                                >
                                                  {copiedId === `${call.id}_raw` ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                                                  <span>Salin</span>
                                                </button>
                                              </div>
                                              <pre className="text-purple-950 font-mono text-[10px] whitespace-pre-wrap overflow-x-auto max-h-48">
                                                {call.rawReasoning}
                                              </pre>
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {/* FLOW TYPE 5: PHRASING */}
                                      {call.flowType === 'PHRASING' && (
                                        <div className="space-y-2.5 text-xs">
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                            {/* Acuan & Fakta Template */}
                                            <div className="bg-teal-50/70 border border-teal-200 rounded-xl p-3 space-y-1">
                                              <span className="text-[10px] font-bold text-teal-800 uppercase tracking-wider block">
                                                📝 Template Acuan & Fakta
                                              </span>
                                              <p className="text-teal-950 font-medium whitespace-pre-wrap">{call.customerInput || '-'}</p>
                                              {call.groundTruthUsed && (
                                                <div className="pt-1.5 border-t border-teal-200/60 text-[10px] text-teal-800 font-mono">
                                                  Fakta: {JSON.stringify(call.groundTruthUsed)}
                                                </div>
                                              )}
                                            </div>

                                            {/* Output Variasi Natural */}
                                            <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 space-y-1">
                                              <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">
                                                ✍️ Hasil Variasi Natural Persona
                                              </span>
                                              <p className="text-emerald-950 font-medium whitespace-pre-wrap">{call.finalReply || '-'}</p>
                                            </div>
                                          </div>
                                        </div>
                                      )}

                                      {/* FLOW TYPE: SLOT_EXTRACTOR, SLOT_GENERATOR & SLOT_FAST_FAQ */}
                                      {(call.flowType === 'SLOT_EXTRACTOR' || call.flowType === 'SLOT_GENERATOR' || call.flowType === 'SLOT_FAST_FAQ') && (
                                        <div className="space-y-2.5 text-xs">
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                            <div className="bg-violet-50/70 border border-violet-200 rounded-xl p-3 space-y-1">
                                              <span className="text-[10px] font-bold text-violet-800 uppercase tracking-wider block">
                                                🎰 Input Pasien / Slot State
                                              </span>
                                              <p className="text-violet-950 font-medium whitespace-pre-wrap">{call.customerInput || '-'}</p>
                                            </div>
                                            <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 space-y-1">
                                              <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">
                                                🎯 Output Keputusan Slot / Balasan
                                              </span>
                                              <p className="text-emerald-950 font-medium whitespace-pre-wrap">{call.finalReply || '-'}</p>
                                            </div>
                                          </div>

                                          {/* Reasoning Ringkas */}
                                          {call.reasoning && (
                                            <div className="bg-purple-50/80 border border-purple-200 rounded-xl p-3 space-y-1">
                                              <span className="text-[10px] font-bold text-purple-900 uppercase tracking-wider block">
                                                🧠 AI Reasoning & Context Analysis
                                              </span>
                                              <p className="text-purple-950 font-medium text-xs whitespace-pre-wrap">{call.reasoning}</p>
                                            </div>
                                          )}

                                          {/* Ground Truth / Fakta DB */}
                                          {call.groundTruthUsed && Object.keys(call.groundTruthUsed).length > 0 && (
                                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1">
                                              <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider block">
                                                📊 Ground Truth / Fakta DB Terinjeksi
                                              </span>
                                              <pre className="text-slate-800 font-mono text-[10px] whitespace-pre-wrap overflow-x-auto max-h-36">
                                                {typeof call.groundTruthUsed === 'string'
                                                  ? call.groundTruthUsed
                                                  : JSON.stringify(call.groundTruthUsed, null, 2)}
                                              </pre>
                                            </div>
                                          )}

                                          {/* Raw LLM JSON / Output */}
                                          {call.rawReasoning && (
                                            <div className="bg-slate-900 text-slate-100 rounded-xl p-3 space-y-1.5 shadow-inner">
                                              <div className="flex items-center justify-between border-b border-slate-700 pb-1.5">
                                                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider font-mono">
                                                  🔍 Raw LLM Output (JSON / Text)
                                                </span>
                                                <button
                                                  type="button"
                                                  onClick={() => copyText(`${call.id}_raw`, call.rawReasoning || '')}
                                                  className="text-[10px] font-semibold text-slate-300 hover:text-white flex items-center gap-1 bg-slate-800 px-2 py-0.5 rounded border border-slate-700 transition-colors"
                                                >
                                                  {copiedId === `${call.id}_raw` ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                                                  <span>Salin</span>
                                                </button>
                                              </div>
                                              <pre className="text-slate-200 font-mono text-[10px] whitespace-pre-wrap overflow-x-auto max-h-56">
                                                {call.rawReasoning}
                                              </pre>
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {/* GENERIC FALLBACK FOR OTHER FLOW TYPES */}
                                      {call.flowType !== 'NLU_CLASSIFICATION' &&
                                        call.flowType !== 'AI_ROUTER' &&
                                        call.flowType !== 'CHATBOT_AUTO' &&
                                        call.flowType !== 'COPILOT_DRAFT' &&
                                        call.flowType !== 'AI_VERIFIER' &&
                                        call.flowType !== 'PHRASING' &&
                                        call.flowType !== 'SLOT_EXTRACTOR' &&
                                        call.flowType !== 'SLOT_GENERATOR' &&
                                        call.flowType !== 'SLOT_FAST_FAQ' && (
                                          <div className="space-y-2.5 text-xs">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1">
                                                <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider block">
                                                  📥 Input
                                                </span>
                                                <p className="text-slate-900 font-medium whitespace-pre-wrap">{call.customerInput || '-'}</p>
                                              </div>
                                              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1">
                                                <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider block">
                                                  📤 Output
                                                </span>
                                                <p className="text-slate-900 font-medium whitespace-pre-wrap">{call.finalReply || '-'}</p>
                                              </div>
                                            </div>
                                            {call.reasoning && (
                                              <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-purple-950 font-mono text-[11px] whitespace-pre-wrap">
                                                {call.reasoning}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* VIEW MODE 2: FLAT TIMELINE FEED */}
      {viewMode === 'flat' && (
        <div className="space-y-3">
          {flatLogs.length === 0 ? (
            <div className="bg-white border border-[#e9edef] rounded-2xl p-10 text-center text-xs text-[#8696a0] shadow-xs">
              Belum ada log LLM flat tercatat.
            </div>
          ) : (
            flatLogs.map((log) => {
              const badge = getFlowBadge(log.flowType);
              const displayReasoning = log.rawReasoning || log.reasoning || '-';

              return (
                <div key={log.id} className="bg-white border border-[#e9edef] hover:border-slate-300 rounded-2xl p-4 shadow-xs space-y-3 text-left transition">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#f0f2f5] pb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${badge.cls} flex items-center gap-1`}>
                        <span>{badge.icon}</span>
                        <span>{badge.label}</span>
                      </span>
                      <span className="text-xs font-bold text-[#111b21]">
                        {log.customerName || formatPhoneDisplay(log.customerPhone)}
                      </span>
                      {log.modelUsed && (
                        <span className="text-[10px] font-mono text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200 font-semibold">
                          {log.modelUsed}
                        </span>
                      )}
                      {log.durationMs !== undefined && (
                        <span className="text-[10px] font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                          ⏱️ {log.durationMs}ms
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-[#8696a0]">{fmtTime(log.timestamp)}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          log.status === 'SUCCESS'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : log.status === 'FALLBACK'
                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {log.status}
                      </span>
                    </div>
                  </div>

                  {log.customerInput && (
                    <div className="bg-sky-50/70 border border-sky-200 rounded-xl p-3">
                      <span className="text-[10px] font-bold text-sky-800 uppercase block mb-1">Input / Prompt</span>
                      <p className="text-sky-950 text-xs font-medium whitespace-pre-wrap">{log.customerInput}</p>
                    </div>
                  )}

                  <div className="bg-purple-50/60 border border-purple-200 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-purple-800 uppercase block">Reasoning &amp; CoT</span>
                      <button
                        type="button"
                        onClick={() => copyText(log.id, displayReasoning)}
                        className="text-[10px] font-semibold text-purple-700 flex items-center gap-1 bg-white px-1.5 py-0.5 rounded border border-purple-200"
                      >
                        {copiedId === log.id ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                        <span>Salin</span>
                      </button>
                    </div>
                    <pre className="text-purple-950 font-mono text-[11px] whitespace-pre-wrap overflow-x-auto max-h-48">{displayReasoning}</pre>
                  </div>

                  <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3">
                    <span className="text-[10px] font-bold text-emerald-800 uppercase block mb-1">Output Akhir</span>
                    <p className="text-emerald-950 font-medium text-xs whitespace-pre-wrap">{log.finalReply || '-'}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Page
export const Debug: React.FC = () => {
  const [tab, setTab] = useState<TabId>('system');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#e9edef]">
        <div>
          <h2 className="text-xl font-bold text-[#111b21] flex items-center gap-2">
            <Bug size={22} className="text-[#008069]" /> <span>System Debug</span>
          </h2>
          <p className="text-xs text-[#667781] mt-0.5">Observability, tracing &amp; maintenance — semua read-only.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-[#e9edef] pb-3">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
                active
                  ? 'bg-[#e8f5f2] border-l-4 border-[#008069] text-[#008069] font-bold shadow-xs'
                  : 'text-[#667781] hover:bg-white hover:text-[#111b21]'
              }`}
            >
              <Icon size={15} className={active ? 'text-[#008069]' : 'text-[#8696a0]'} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {tab === 'system' && <SystemSection />}
      {tab === 'router' && <RouterSection />}
      {tab === 'llm' && <LlmLogsSection />}
      {tab === 'logs' && <LogsSection />}
      {tab === 'messages' && <MessagesSection />}
      {tab === 'conversations' && <ConversationsSection />}

      <p className="text-xs text-[#8696a0]">
        <Clock size={11} className="inline mr-1" />
        Debug page data diambil langsung dari server via /api/admin/debug/* — read-only, tidak ada mutasi.
      </p>
    </div>
  );
};

export default Debug;
