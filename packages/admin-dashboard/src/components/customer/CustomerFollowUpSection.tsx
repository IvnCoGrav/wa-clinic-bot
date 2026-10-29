import React, { useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { Calendar, Clock, Send, XCircle, Pencil, Rocket, ChevronDown, ChevronUp, Eye, EyeOff, AlertCircle, CheckCircle2, X } from 'lucide-react';

export interface FollowUpItem {
  id: string;
  type: string;
  stage: number;
  status: string;
  scheduled_at: string;
  sent_at?: string | null;
  cancel_reason?: string | null;
  custom_text?: string | null;
  created_at?: string;
  reservation?: {
    id: string;
    booking_date?: string | null;
    treatment_category?: string | null;
    treatment_detail?: string | null;
  } | null;
}

interface Props {
  customerId: string;
  customerPhone?: string | null;
  customerName?: string | null;
  followUps: FollowUpItem[];
  onRefresh: () => void | Promise<void>;
}

const TYPE_LABELS: Record<string, string> = {
  REMINDER_H1: 'Pengingat Jadwal H-1',
  REVIEW_H1_BABY: 'Review H+1 Pasca Terapi Bayi',
  REVIEW_H1_MOMS: 'Review H+1 Pasca Terapi Bunda',
  NO_PURCHASE: 'Follow-Up No-Purchase',
  NEXT_TREATMENT: 'Pengingat Perawatan Rutin',
};

const STATUS_STYLES: Record<string, string> = {
  QUEUED: 'bg-info-soft text-info border-info-line',
  PENDING: 'bg-warning-soft text-warning border-warning-line',
  SENT: 'bg-success-soft text-success border-success-line',
  CANCELLED: 'bg-fill-1 text-ink-2 border-divider',
  FAILED: 'bg-danger-soft text-danger border-danger-line',
  SKIPPED: 'bg-fill-1 text-ink-2 border-divider',
};

function humanizeType(type: string, stage: number): string {
  const base = TYPE_LABELS[type] || type.replace(/_/g, ' ');
  if (type === 'NO_PURCHASE') {
    const days = [3, 7, 14][stage - 1] || stage;
    return `${base} Tahap ${stage} (H+${days})`;
  }
  if (type === 'NEXT_TREATMENT') {
    return `${base} Bulan ${stage}`;
  }
  if (stage && stage > 1 && !['NO_PURCHASE', 'NEXT_TREATMENT'].includes(type)) {
    return `${base} • Tahap ${stage}`;
  }
  return base;
}

function formatWibRelative(dateStr: string, status: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const dWib = new Date(d.getTime() + 7 * 3600000);
  const nowWib = new Date(now.getTime() + 7 * 3600000);
  const dKey = dWib.toISOString().slice(0, 10);
  const nowKey = nowWib.toISOString().slice(0, 10);
  const tomorrow = new Date(nowWib);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = tomorrow.toISOString().slice(0, 10);
  const yesterday = new Date(nowWib);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);
  const time = dWib.toISOString().slice(11, 16);
  const datePart = dWib.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  const overdue = d.getTime() < now.getTime() && (status === 'PENDING' || status === 'QUEUED');
  if (overdue) return `Terlewat • ${datePart}, ${time} WIB`;
  if (dKey === nowKey) return `Hari ini, ${time} WIB`;
  if (dKey === tomorrowKey) return `Besok, ${time} WIB`;
  if (dKey === yesterdayKey) return `Kemarin, ${time} WIB`;
  return `${datePart}, ${time} WIB`;
}

function toLocalDatetimeInput(wibIso: string): string {
  const d = new Date(wibIso);
  if (isNaN(d.getTime())) return '';
  // Convert UTC stored scheduled_at to WIB local datetime-local (Asia/Jakarta UTC+7)
  const wib = new Date(d.getTime() + 7 * 3600000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${wib.getUTCFullYear()}-${pad(wib.getUTCMonth() + 1)}-${pad(wib.getUTCDate())}T${pad(wib.getUTCHours())}:${pad(wib.getUTCMinutes())}`;
}

function fromLocalDatetimeInput(localStr: string): string {
  // localStr is "YYYY-MM-DDTHH:mm" in WIB, convert to UTC ISO
  const [datePart, timePart] = localStr.split('T');
  if (!datePart || !timePart) return localStr;
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  // WIB = UTC+7 => UTC = WIB -7h
  const utc = new Date(Date.UTC(y, m - 1, d, hh, mm, 0, 0) - 7 * 3600000);
  return utc.toISOString();
}

export const CustomerFollowUpSection: React.FC<Props> = ({ customerId, followUps, onRefresh }) => {
  const { toast, confirm } = useUiFeedback();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editing, setEditing] = useState<FollowUpItem | null>(null);
  const [editScheduledAt, setEditScheduledAt] = useState('');
  const [editCustomText, setEditCustomText] = useState('');
  const [editStage, setEditStage] = useState<number>(1);
  const [saving, setSaving] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [queueingId, setQueueingId] = useState<string | null>(null);

  const active = (followUps || []).filter((f) => f.status === 'QUEUED' || f.status === 'PENDING');
  const history = (followUps || []).filter((f) => ['SENT', 'CANCELLED', 'FAILED', 'SKIPPED'].includes(f.status));

  const handleSendNow = async (id: string) => {
    const ok = await confirm({
      title: 'Kirim Follow-Up Sekarang?',
      message: 'Pesan follow-up akan langsung dikirim ke WhatsApp customer via gateway aktif (WAHA/WABA). Lanjutkan?',
      confirmText: 'Ya, Kirim Sekarang',
      cancelText: 'Batal',
    });
    if (!ok) return;
    setSendingId(id);
    try {
      const res: any = await apiRequest(`/api/admin/follow-ups/${id}/send-now`, { method: 'POST' });
      if (res?.success || res?.message) {
        toast('Follow-up berhasil dikirim!', 'success');
        await onRefresh();
      } else if (res?.error) {
        toast(res.error, 'error');
      } else {
        toast('Follow-up dikirim.', 'success');
        await onRefresh();
      }
    } catch (e: any) {
      toast(e?.message || 'Gagal mengirim follow-up', 'error');
    } finally {
      setSendingId(null);
    }
  };

  const handleQueue = async (id: string) => {
    setQueueingId(id);
    try {
      await apiRequest(`/api/admin/follow-ups/${id}/queue`, { method: 'POST' });
      toast('Follow-up dijadwalkan (QUEUED).', 'success');
      await onRefresh();
    } catch (e: any) {
      toast(e?.message || 'Gagal menjadwalkan', 'error');
    } finally {
      setQueueingId(null);
    }
  };

  const handleCancel = async (id: string) => {
    setCancellingId(id);
    setCancelReason('');
  };

  const submitCancel = async () => {
    if (!cancellingId) return;
    const id = cancellingId;
    setSaving(true);
    try {
      await apiRequest(`/api/admin/follow-ups/${id}/cancel`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: cancelReason || undefined }),
      });
      toast('Follow-up dibatalkan.', 'success');
      setCancellingId(null);
      setCancelReason('');
      await onRefresh();
    } catch (e: any) {
      toast(e?.message || 'Gagal membatalkan', 'error');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (fu: FollowUpItem) => {
    setEditing(fu);
    setEditScheduledAt(toLocalDatetimeInput(fu.scheduled_at));
    setEditCustomText(fu.custom_text || '');
    setEditStage(fu.stage || 1);
  };

  const submitEdit = async () => {
    if (!editing) return;
    if (!editScheduledAt) {
      toast('Tanggal/jam wajib diisi', 'error');
      return;
    }
    setSaving(true);
    try {
      const iso = fromLocalDatetimeInput(editScheduledAt);
      await apiRequest(`/api/admin/follow-ups/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          scheduledAt: iso,
          stage: editStage,
          customText: editCustomText ? editCustomText : null,
        }),
      });
      toast('Follow-up diperbarui.', 'success');
      setEditing(null);
      await onRefresh();
    } catch (e: any) {
      toast(e?.message || 'Gagal memperbarui', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 bg-surface border border-divider rounded-2xl space-y-3 shadow-2xs">
      <div className="flex items-center justify-between">
        <h4 className="font-bold text-xs text-ink flex items-center gap-1.5">
          <Clock size={14} className="text-accent" />
          <span>Antrean Follow-Up ({active.length} aktif)</span>
        </h4>
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="text-[11px] font-semibold text-accent hover:text-accent-hover flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-accent-soft transition"
          >
            {historyOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            <span>Riwayat ({history.length})</span>
          </button>
        )}
      </div>

      {active.length === 0 ? (
        <div className="p-3 bg-surface-2 border border-divider rounded-xl text-center">
          <p className="text-xs text-ink-2">Tidak ada jadwal follow-up aktif untuk customer ini.</p>
          <p className="text-[11px] text-ink-3 mt-1">Follow-up otomatis akan dibuat setelah reservasi atau jika customer belum purchase.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {active.map((fu) => {
            const isExpanded = expandedId === fu.id;
            const overdue = new Date(fu.scheduled_at).getTime() < Date.now();
            return (
              <div key={fu.id} className={`rounded-xl border p-3 space-y-2 ${overdue ? 'border-warning-line bg-warning-soft/40' : 'border-divider bg-surface-2'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-bold text-ink">{humanizeType(fu.type, fu.stage)}</span>
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_STYLES[fu.status] || 'bg-fill-1 text-ink border-divider'}`}>
                        {fu.status}
                      </span>
                      {overdue && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-warning-soft text-warning border border-warning-line">Terlewat</span>}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 text-[11px] text-ink-2">
                      <Calendar size={11} className="shrink-0" />
                      <span className="font-medium">{formatWibRelative(fu.scheduled_at, fu.status)}</span>
                    </div>
                    {fu.reservation && (
                      <p className="text-[11px] text-ink-2 mt-1 truncate">
                        Terkait reservasi: {fu.reservation.treatment_detail || fu.reservation.treatment_category || fu.reservation.id.slice(0, 8)} •{' '}
                        {fu.reservation.booking_date ? new Date(fu.reservation.booking_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : fu.id)}
                    className="p-1.5 rounded-lg hover:bg-surface border border-transparent hover:border-divider text-ink-2 transition shrink-0"
                    title={isExpanded ? 'Sembunyikan' : 'Lihat pesan'}
                  >
                    {isExpanded ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>

                {isExpanded && (
                  <div className="p-2.5 bg-surface border border-divider rounded-xl text-xs leading-relaxed whitespace-pre-wrap">
                    {fu.custom_text ? (
                      <p className="text-ink">{fu.custom_text}</p>
                    ) : (
                      <p className="text-ink-2 italic">Pratinjau template default: {humanizeType(fu.type, fu.stage)} — teks akan dirender saat pengiriman (varian rolling 1..3).</p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {fu.status === 'PENDING' && (
                    <button
                      type="button"
                      onClick={() => handleQueue(fu.id)}
                      disabled={queueingId === fu.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface border border-accent/20 text-accent hover:bg-accent-soft text-xs font-semibold transition disabled:opacity-50"
                    >
                      <Clock size={12} />
                      {queueingId === fu.id ? 'Menjadwalkan...' : 'Jadwalkan'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleSendNow(fu.id)}
                    disabled={sendingId === fu.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-bold transition disabled:opacity-50 shadow-xs"
                  >
                    <Rocket size={12} />
                    {sendingId === fu.id ? 'Mengirim...' : 'Kirim Sekarang'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(fu)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface border border-divider hover:bg-fill-1 text-ink text-xs font-semibold transition"
                  >
                    <Pencil size={12} />
                    Edit / Reschedule
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCancel(fu.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface border border-danger-line hover:bg-danger-soft text-danger text-xs font-semibold transition"
                  >
                    <XCircle size={12} />
                    Batalkan
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {historyOpen && history.length > 0 && (
        <div className="pt-2 border-t border-divider space-y-2">
          <h5 className="text-[11px] font-bold text-ink-2 uppercase tracking-wider flex items-center gap-1">
            <CheckCircle2 size={12} />
            Riwayat ({history.length})
          </h5>
          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {history.map((fu) => (
              <div key={fu.id} className="p-2.5 rounded-xl border border-divider bg-surface flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-ink">{humanizeType(fu.type, fu.stage)}</span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_STYLES[fu.status] || ''}`}>{fu.status}</span>
                  </div>
                  <p className="text-[11px] text-ink-2 mt-0.5">
                    {fu.status === 'SENT' && fu.sent_at ? `Terkirim ${new Date(fu.sent_at).toLocaleString('id-ID')}` : `Jadwal ${formatWibRelative(fu.scheduled_at, fu.status)}`}
                  </p>
                  {fu.cancel_reason && <p className="text-[11px] text-danger mt-0.5">Alasan: {fu.cancel_reason}</p>}
                </div>
                <span className="text-[10px] text-ink-3 shrink-0">{fu.stage ? `Tahap ${fu.stage}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cancel reason modal inline */}
      {cancellingId && (
        <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-xs flex items-center justify-center p-4" onClick={() => setCancellingId(null)}>
          <div className="bg-surface rounded-2xl w-full max-w-md p-4 space-y-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h5 className="font-bold text-sm text-ink flex items-center gap-1.5"><AlertCircle size={16} className="text-danger" /> Batalkan Follow-Up</h5>
              <button onClick={() => setCancellingId(null)} className="p-1 rounded-lg hover:bg-fill-1"><X size={16} /></button>
            </div>
            <p className="text-xs text-ink-2">Alasan pembatalan (opsional) akan disimpan di <code>cancel_reason</code>:</p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Mis. Customer sudah reservasi manual, salah jadwal, dll."
              className="w-full p-2.5 border border-strong rounded-xl text-xs focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setCancellingId(null)} className="px-4 py-2 bg-surface border border-strong rounded-xl text-xs font-semibold">Batal</button>
              <button onClick={submitCancel} disabled={saving} className="px-4 py-2 bg-danger hover:bg-danger-hover text-on-solid rounded-xl text-xs font-bold disabled:opacity-50">
                {saving ? 'Membatalkan...' : 'Ya, Batalkan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit / Reschedule modal */}
      {editing && (
        <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-xs flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-surface rounded-2xl w-full max-w-md p-4 space-y-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h5 className="font-bold text-sm text-ink flex items-center gap-1.5"><Pencil size={16} className="text-accent" /> Edit Follow-Up</h5>
              <button onClick={() => setEditing(null)} className="p-1 rounded-lg hover:bg-fill-1"><X size={16} /></button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-ink block mb-1">Tipe</label>
                <p className="p-2.5 bg-surface-2 border border-divider rounded-xl text-ink-2">{humanizeType(editing.type, editing.stage)}</p>
              </div>
              <div>
                <label className="font-semibold text-ink block mb-1">Tahap (Stage 1..3)</label>
                <select value={editStage} onChange={(e) => setEditStage(Number(e.target.value))} className="w-full p-2.5 bg-surface border border-strong rounded-xl text-xs focus:outline-none focus:border-accent">
                  <option value={1}>Tahap 1</option>
                  <option value={2}>Tahap 2</option>
                  <option value={3}>Tahap 3</option>
                </select>
              </div>
              <div>
                <label className="font-semibold text-ink block mb-1">Jadwal Kirim (WIB)</label>
                <input
                  type="datetime-local"
                  value={editScheduledAt}
                  onChange={(e) => setEditScheduledAt(e.target.value)}
                  className="w-full p-2.5 bg-surface border border-strong rounded-xl text-xs focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                />
                <p className="text-[11px] text-ink-3 mt-1">Disimpan sebagai UTC, ditampilkan WIB.</p>
              </div>
              <div>
                <label className="font-semibold text-ink block mb-1">Custom Text (opsional)</label>
                <textarea
                  value={editCustomText}
                  onChange={(e) => setEditCustomText(e.target.value)}
                  placeholder="Kosongkan untuk pakai template default rolling"
                  className="w-full p-2.5 bg-surface border border-strong rounded-xl text-xs focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                  rows={4}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 bg-surface border border-strong rounded-xl text-xs font-semibold">Batal</button>
              <button onClick={submitEdit} disabled={saving} className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-xl text-xs font-bold disabled:opacity-50 flex items-center gap-1.5">
                <Send size={12} />
                {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
