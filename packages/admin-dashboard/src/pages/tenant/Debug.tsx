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
