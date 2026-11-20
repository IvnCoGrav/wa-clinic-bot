import React, { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  MessageSquare,
  RefreshCw,
  Users,
  XCircle,
} from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { FIELD_INPUT_BASE, FIELD_TEXTAREA_BASE } from '../ui/Fields';
import { formatMonthYearWib } from '../../utils/dateWib';

interface ContextMessage {
  id: string;
  content: string;
  createdAt: string;
  direction: string | null;
  senderType: string | null;
  isAnchor: boolean;
}

interface EvidenceItem {
  id: string;
  source: string;
  evidenceAt: string;
  observedMinutes: number | null;
  confidence: number | null;
  reviewStatus: string;
  conversationId: string | null;
  message: { id: string; content: string; createdAt: string } | null;
  context: ContextMessage[];
  reservation: {
    id: string;
    bookingDate: string | null;
    customerName: string | null;
    staffName: string | null;
    staffId: string | null;
  };
}

interface ImpactItem {
  staffId: string;
  staffName: string;
  pending: number;
  current: {
    punctualityPct: number | null;
    score: number | null;
    grade: string | null;
    coveragePct: number;
  };
  projected: {
    punctualityPct: number | null;
    score: number | null;
    grade: string | null;
    coveragePct: number;
  };
}

type PendingReview = { item: EvidenceItem; action: 'APPROVE' | 'REJECT' };

interface ThreadMessage {
  id: string;
  content: string;
  createdAt: string;
  direction: string | null;
  senderType: string | null;
  isAnchor: boolean;
}

interface ThreadData {
  conversationId: string;
  anchorId: string;
  messages: ThreadMessage[];
  customerName: string | null;
  staffName: string | null;
  bookingDate: string | null;
}

interface ThreadState {
  item: EvidenceItem;
  data: ThreadData | null;
  loading: boolean;
  error: string | null;
}

const REJECT_REASONS = [
  'Bukan soal menunggu bidan',
  'Soal jadwal berikutnya',
  'Salah customer',
  'Pesan di luar konteks',
  'Bukti tidak jelas',
];

const APPROVE_REASONS = [
  'Customer jelas menunggu bidan',
  'Bukti sesuai keterlambatan',
  'Sudah dikonfirmasi ke bidan',
  'Pesan valid',
];

const PAGE_SIZE = 15;

function formatWib(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(1).replace('.', ',')}%`;
}

function gradeClass(grade: string | null): string {
  switch (grade) {
    case 'A':
      return 'bg-success-soft text-success border-success-line';
    case 'B':
      return 'bg-accent-soft text-accent border-accent/30';
    case 'C':
      return 'bg-warning-soft text-warning border-warning-line';
    case 'D':
      return 'bg-caution-soft text-caution border-caution-line';
    case 'E':
      return 'bg-danger-soft text-danger border-danger-line';
    default:
      return 'bg-fill-1 text-ink-2 border-divider';
  }
}

function monthBounds(year: number, month: number): { from: string; to: string } {
  const pad = (value: number) => String(value).padStart(2, '0');
  const from = new Date(`${year}-${pad(month)}-01T00:00:00+07:00`);
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const nextStart = new Date(`${next.y}-${pad(next.m)}-01T00:00:00+07:00`);
  return {
    from: from.toISOString(),
    to: new Date(nextStart.getTime() - 1).toISOString(),
  };
}

function currentPeriod(): { year: number; month: number } {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const [year, month] = key.split('-').map(Number);
  return { year, month };
}

function senderLabel(message: ContextMessage): string {
  const sender = String(message.senderType || '').toLowerCase();
  if (sender === 'customer') return 'Customer';
  if (sender === 'bot') return 'Bot';
  if (sender === 'admin' || sender === 'human' || sender === 'staff') return 'Admin/Bidan';
  if (sender === 'internal_note') return 'Catatan internal';
  if (message.direction === 'INBOUND') return 'Customer';
  if (message.direction === 'OUTBOUND') return 'Klinik';
  return 'Pesan';
}

export const ScorecardVerificationQueue: React.FC = () => {
  const { toast } = useUiFeedback();
  const initial = currentPeriod();
  const [period, setPeriod] = useState(initial);
  const [staffId, setStaffId] = useState('');
  const [onlyScored, setOnlyScored] = useState(true);
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [impact, setImpact] = useState<ImpactItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingReview | null>(null);
  const [note, setNote] = useState('');
  const [observedMinutes, setObservedMinutes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [thread, setThread] = useState<ThreadState | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  const loadImpact = async (target = period) => {
    try {
      const res = await apiRequest(
        `/api/admin/staff-scorecard/evidence/impact?year=${target.year}&month=${target.month}`,
        { forceFresh: true }
      );
      setImpact(res?.success && Array.isArray(res.data) ? res.data : []);
    } catch {
      // Preview bersifat pelengkap; jangan blokir antrean.
      setImpact([]);
    }
  };

  const loadPage = async (mode: 'reset' | 'more') => {
    if (mode === 'reset') setLoading(true);
    else setLoadingMore(true);
    setError(null);

    try {
      const bounds = monthBounds(period.year, period.month);
      const params = new URLSearchParams({
        status: 'NEEDS_REVIEW',
        limit: String(PAGE_SIZE),
        offset: String(mode === 'reset' ? 0 : items.length),
        onlyScored: String(onlyScored),
        from: bounds.from,
        to: bounds.to,
      });
      if (staffId) params.set('staffId', staffId);

      const res = await apiRequest(
        `/api/admin/staff-scorecard/evidence?${params.toString()}`,
        { forceFresh: true }
      );
      if (!res?.success) {
        throw new Error(res?.error || 'Gagal memuat antrean verifikasi.');
      }
      const nextItems: EvidenceItem[] = Array.isArray(res.data) ? res.data : [];
      setItems((prev) => (mode === 'reset' ? nextItems : [...prev, ...nextItems]));
      setTotal(Number(res.meta?.total ?? nextItems.length));
    } catch (err: any) {
      setError(err?.message || 'Gagal memuat antrean verifikasi.');
      if (mode === 'reset') {
        setItems([]);
        setTotal(0);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void loadPage('reset');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.year, period.month, staffId, onlyScored]);

  useEffect(() => {
    void loadImpact();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period.year, period.month]);

  const openReview = (item: EvidenceItem, action: 'APPROVE' | 'REJECT') => {
    setPending({ item, action });
    setNote('');
    setObservedMinutes(item.observedMinutes != null ? String(item.observedMinutes) : '');
  };

  const closeReview = () => {
    if (submitting) return;
    setPending(null);
    setNote('');
    setObservedMinutes('');
  };

  const openThread = async (item: EvidenceItem) => {
    setThread({ item, data: null, loading: true, error: null });
    try {
      const res = await apiRequest(
        `/api/admin/staff-scorecard/evidence/${item.id}/thread?limit=60`,
        { forceFresh: true }
      );
      if (!res?.success) {
        throw new Error(res?.error || 'Gagal memuat percakapan.');
      }
      setThread({ item, data: res.data as ThreadData, loading: false, error: null });
    } catch (err: any) {
      setThread({
        item,
        data: null,
        loading: false,
        error: err?.message || 'Gagal memuat percakapan.',
      });
    }
  };

  const closeThread = () => setThread(null);

  const reviewFromThread = (action: 'APPROVE' | 'REJECT') => {
    if (!thread) return;
    const item = thread.item;
    setThread(null);
    openReview(item, action);
  };

  useEffect(() => {
    if (thread?.data) {
      anchorRef.current?.scrollIntoView({ block: 'center' });
    }
  }, [thread?.data]);

  const submitReview = async () => {
    if (!pending) return;
    const trimmed = note.trim();

    if (pending.action === 'REJECT' && !trimmed) {
      toast('Pilih alasan atau isi catatan saat menolak bukti.', 'error');
      return;
    }

    let minutes: number | undefined;
    if (pending.action === 'APPROVE' && observedMinutes.trim() !== '') {
      const parsed = Number(observedMinutes);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1440) {
        toast('Selisih waktu harus antara 0 dan 1440 menit.', 'error');
        return;
      }
      minutes = Math.round(parsed);
    }

    setSubmitting(true);
    try {
      const res = await apiRequest(
        `/api/admin/staff-scorecard/evidence/${pending.item.id}/review`,
        {
          method: 'POST',
          body: JSON.stringify({
            action: pending.action,
            note: trimmed || null,
            ...(minutes !== undefined ? { observedMinutes: minutes } : {}),
          }),
        }
      );

      if (res?.success) {
        toast(
          pending.action === 'APPROVE'
            ? 'Bukti disetujui dan akan masuk perhitungan.'
            : 'Bukti ditolak dan tidak masuk perhitungan.',
          'success'
        );
        setPending(null);
        setNote('');
        setObservedMinutes('');
        await Promise.all([loadPage('reset'), loadImpact()]);
      } else {
        toast(res?.error || 'Gagal menyimpan keputusan.', 'error');
      }
    } catch (err: any) {
      toast(err?.message || 'Gagal menyimpan keputusan.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const staffOptions = impact.map((row) => ({ id: row.staffId, name: row.staffName }));
  const impacted = impact.filter((row) => row.pending > 0);
  const years = [initial.year, initial.year - 1];

  return (
    <div className="bg-surface border border-divider rounded-2xl p-5 shadow-xs space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink flex items-center gap-2">
            <MessageSquare size={18} className="text-accent" />
            Verifikasi Bukti Keterlambatan
          </h2>
          <p className="text-xs text-ink-3 mt-0.5 max-w-2xl">
            Bukti dari pesan customer belum dihitung sampai disetujui. Baca konteks percakapan;
            tolak jika pesannya bukan soal menunggu bidan. Keputusan bersifat final.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-fill-1 text-ink-2 border border-divider">
            {total} menunggu
          </span>
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} />}
            loading={loading}
            onClick={() => {
              void loadPage('reset');
              void loadImpact();
            }}
          >
            Muat ulang
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 pb-3 border-b border-divider">
        <label className="text-[11px] font-bold text-ink-2">
          Bidan
          <select
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            className="mt-1 block min-w-[10rem] px-2.5 py-1.5 rounded-lg bg-surface border border-divider text-xs text-ink focus:outline-none focus:border-accent"
          >
            <option value="">Semua bidan dinilai</option>
            {staffOptions.map((staff) => (
              <option key={staff.id} value={staff.id}>
                {staff.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-[11px] font-bold text-ink-2">
          Bulan
          <select
            value={period.month}
            onChange={(e) => setPeriod((prev) => ({ ...prev, month: Number(e.target.value) }))}
            className="mt-1 block px-2.5 py-1.5 rounded-lg bg-surface border border-divider text-xs text-ink focus:outline-none focus:border-accent"
          >
            {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
              <option key={month} value={month}>
                {formatMonthYearWib(period.year, month - 1).split(' ')[0]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-[11px] font-bold text-ink-2">
          Tahun
          <select
            value={period.year}
            onChange={(e) => setPeriod((prev) => ({ ...prev, year: Number(e.target.value) }))}
            className="mt-1 block px-2.5 py-1.5 rounded-lg bg-surface border border-divider text-xs text-ink focus:outline-none focus:border-accent"
          >
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-[11px] text-ink-2 select-none pb-1.5">
          <input
            type="checkbox"
            checked={!onlyScored}
            onChange={(e) => setOnlyScored(!e.target.checked)}
            className="h-3.5 w-3.5 rounded border-divider text-accent focus:ring-accent"
          />
          Tampilkan staf non-penilaian
        </label>

        <span className="ml-auto text-[11px] text-ink-3 flex items-center gap-1 pb-1.5">
          <CalendarDays size={13} />
          {formatMonthYearWib(period.year, period.month - 1)}
        </span>
      </div>

      {impacted.length > 0 && (
        <div className="rounded-xl border border-accent/30 bg-accent-soft/40 p-3 space-y-2">
          <div className="text-[11px] font-bold text-ink flex items-center gap-1.5">
            <Users size={14} className="text-accent" />
            Dampak jika semua bukti bulan ini disetujui
            <span className="font-normal text-ink-3">(preview, belum mengubah nilai)</span>
          </div>
          <div className="space-y-1.5">
            {impacted.map((row) => (
              <div
                key={row.staffId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-2"
              >
                <span className="font-bold text-ink min-w-[7rem]">{row.staffName}</span>
                <span className="px-1.5 py-0.5 rounded-full bg-surface border border-divider text-[10px] font-bold">
                  {row.pending} menunggu
                </span>
                <span>
                  Ketepatan {formatPct(row.current.punctualityPct)} →{' '}
                  <b className="text-ink">{formatPct(row.projected.punctualityPct)}</b>
                </span>
                <span className="flex items-center gap-1">
                  Grade
                  <span
                    className={`px-1.5 py-0.5 rounded-md border text-[10px] font-bold ${gradeClass(
                      row.current.grade
                    )}`}
                  >
                    {row.current.grade || '—'}
                  </span>
                  →
                  <span
                    className={`px-1.5 py-0.5 rounded-md border text-[10px] font-bold ${gradeClass(
                      row.projected.grade
                    )}`}
                  >
                    {row.projected.grade || '—'}
                  </span>
                </span>
                <span>
                  Cakupan {formatPct(row.current.coveragePct)} →{' '}
                  <b className="text-ink">{formatPct(row.projected.coveragePct)}</b>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-danger-soft border border-danger-line text-[11px] text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-ink-3">Memuat antrean…</p>
      ) : items.length === 0 ? (
        <div className="p-6 rounded-xl bg-fill-1 border border-divider text-center text-xs text-ink-3">
          Tidak ada bukti yang menunggu verifikasi pada filter ini.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="border border-divider rounded-xl p-3.5 bg-surface-2 space-y-2.5"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink truncate">
                    {item.reservation.customerName || 'Customer'}
                  </p>
                  <p className="text-[11px] text-ink-3">
                    {item.reservation.staffName || 'Bidan'} ·{' '}
                    {formatWib(item.reservation.bookingDate)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-fill-1 text-ink-2 border border-divider">
                    {item.source}
                  </span>
                  {item.observedMinutes != null && (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-danger-soft text-danger border border-danger-line">
                      +{item.observedMinutes} mnt
                    </span>
                  )}
                  {item.confidence != null && (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-fill-1 text-ink-3 border border-divider">
                      keyakinan {Math.round(item.confidence * 100)}%
                    </span>
                  )}
                  {item.conversationId && (
                    <button
                      type="button"
                      onClick={() => void openThread(item)}
                      className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-surface text-accent border border-accent/30 hover:bg-accent-soft inline-flex items-center gap-1"
                    >
                      <MessageSquare size={11} />
                      Buka chat
                    </button>
                  )}
                </div>
              </div>

              {item.context.length > 0 ? (
                <div className="rounded-xl border border-divider bg-surface px-3 py-2 space-y-1.5 max-h-60 overflow-y-auto">
                  {item.context.map((message) => (
                    <div
                      key={message.id}
                      className={
                        message.isAnchor
                          ? 'rounded-r-lg border-l-2 border-accent bg-accent-soft/50 px-2 py-1'
                          : 'px-2 py-1'
                      }
                    >
                      <div className="text-[9px] text-ink-3 flex items-center gap-1">
                        <span className="font-bold">{senderLabel(message)}</span>
                        <span>·</span>
                        <span>{formatWib(message.createdAt)}</span>
                        {message.isAnchor && (
                          <span className="ml-1 text-accent font-bold">PESAN BUKTI</span>
                        )}
                      </div>
                      <div className="text-[11px] text-ink-2 break-words whitespace-pre-wrap">
                        {message.content}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <blockquote className="text-xs text-ink-2 bg-surface border-l-2 border-accent/40 rounded-r-lg px-3 py-2">
                  {item.message
                    ? `“${item.message.content}”`
                    : '(isi pesan tidak tersedia — mungkin sudah terhapus retensi)'}
                </blockquote>
              )}

              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  icon={<XCircle size={14} />}
                  onClick={() => openReview(item, 'REJECT')}
                >
                  Tolak
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<CheckCircle2 size={14} />}
                  onClick={() => openReview(item, 'APPROVE')}
                >
                  Setujui
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
          <span className="text-[11px] text-ink-3">
            Menampilkan {items.length} dari {total} bukti
          </span>
          {items.length < total && (
            <Button
              variant="secondary"
              size="sm"
              loading={loadingMore}
              onClick={() => void loadPage('more')}
            >
              Muat {Math.min(PAGE_SIZE, Math.max(total - items.length, 0))} lagi
            </Button>
          )}
        </div>
      )}

      <Modal
        open={!!pending}
        onClose={closeReview}
        title={pending?.action === 'APPROVE' ? 'Setujui Bukti' : 'Tolak Bukti'}
      >
        <div className="space-y-3">
          <p className="text-xs text-ink-2">
            {pending?.action === 'APPROVE'
              ? 'Bukti akan masuk perhitungan ketepatan waktu bidan. Keputusan tidak dapat diubah.'
              : 'Bukti tidak akan masuk perhitungan. Pilih alasan cepat atau tulis catatan.'}
          </p>

          {pending?.action === 'APPROVE' && (
            <label className="text-xs font-bold text-ink block">
              Selisih waktu (menit)
              <input
                type="number"
                min={0}
                max={1440}
                step={1}
                value={observedMinutes}
                onChange={(e) => setObservedMinutes(e.target.value)}
                className={`mt-1 ${FIELD_INPUT_BASE} max-w-[8rem]`}
              />
              <span className="block mt-1 text-[10px] font-normal text-ink-3">
                Ubah bila bukti menunjukkan selisih berbeda. Di atas ambang bukti chat dihitung
                telat; ≤ ambang tidak dihitung telat.
              </span>
            </label>
          )}

          <div className="space-y-1.5">
            <span className="text-xs font-bold text-ink">
              Alasan cepat {pending?.action === 'REJECT' ? '' : '(opsional)'}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(pending?.action === 'REJECT' ? REJECT_REASONS : APPROVE_REASONS).map((reason) => {
                const selected = note === reason;
                const activeClass =
                  pending?.action === 'REJECT'
                    ? 'bg-danger-soft text-danger border-danger-line'
                    : 'bg-accent-soft text-accent border-accent/30';
                return (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setNote(reason)}
                    className={`px-2 py-1 rounded-full text-[10px] font-bold border transition ${
                      selected
                        ? activeClass
                        : 'bg-fill-1 text-ink-2 border-divider hover:bg-fill-2'
                    }`}
                  >
                    {reason}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="text-xs font-bold text-ink block">
            Catatan {pending?.action === 'REJECT' ? '(wajib)' : '(opsional)'}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className={`mt-1 ${FIELD_TEXTAREA_BASE}`}
              placeholder={
                pending?.action === 'APPROVE'
                  ? 'Contoh: customer jelas menanyakan keberadaan bidan.'
                  : 'Contoh: pesan soal jadwal berikutnya, bukan menunggu bidan.'
              }
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeReview} disabled={submitting}>
              Batal
            </Button>
            <Button
              variant={pending?.action === 'APPROVE' ? 'primary' : 'danger'}
              loading={submitting}
              onClick={() => void submitReview()}
            >
              {pending?.action === 'APPROVE' ? 'Setujui' : 'Tolak'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!thread}
        onClose={closeThread}
        size="lg"
        title={`Percakapan — ${
          thread?.data?.customerName || thread?.item.reservation.customerName || 'Customer'
        }`}
      >
        {thread?.loading && <p className="text-xs text-ink-3">Memuat percakapan…</p>}

        {thread?.error && (
          <div className="p-3 rounded-xl bg-danger-soft border border-danger-line text-[11px] text-danger">
            {thread.error}
          </div>
        )}

        {thread?.data && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-3">
              <span className="font-bold text-ink-2">
                {thread.data.staffName || thread.item.reservation.staffName || 'Bidan'}
              </span>
              <span>·</span>
              <span>{formatWib(thread.data.bookingDate || thread.item.reservation.bookingDate)}</span>
              <span>·</span>
              <span>{thread.data.messages.length} pesan</span>
            </div>

            <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
              {thread.data.messages.map((message) => {
                const outbound = message.direction === 'OUTBOUND';
                return (
                  <div
                    key={message.id}
                    ref={message.isAnchor ? anchorRef : undefined}
                    className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2 border ${
                        message.isAnchor
                          ? 'bg-accent-soft border-accent ring-1 ring-accent/40'
                          : outbound
                            ? 'bg-fill-1 border-divider'
                            : 'bg-surface-2 border-divider'
                      }`}
                    >
                      <div className="text-[9px] text-ink-3 flex items-center gap-1">
                        <span className="font-bold">{senderLabel(message)}</span>
                        <span>·</span>
                        <span>{formatWib(message.createdAt)}</span>
                        {message.isAnchor && (
                          <span className="ml-1 text-accent font-bold">PESAN BUKTI</span>
                        )}
                      </div>
                      <div className="text-[11px] text-ink whitespace-pre-wrap break-words mt-0.5">
                        {message.content}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" onClick={closeThread}>
                Tutup
              </Button>
              <Button
                variant="danger"
                size="sm"
                icon={<XCircle size={14} />}
                onClick={() => reviewFromThread('REJECT')}
              >
                Tolak
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<CheckCircle2 size={14} />}
                onClick={() => reviewFromThread('APPROVE')}
              >
                Setujui
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ScorecardVerificationQueue;
