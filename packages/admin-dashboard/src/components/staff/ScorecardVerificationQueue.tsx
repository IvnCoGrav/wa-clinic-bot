import React, { useEffect, useState } from 'react';
import { CheckCircle2, MessageSquare, RefreshCw, XCircle } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { FIELD_TEXTAREA_BASE } from '../ui/Fields';

interface EvidenceItem {
  id: string;
  source: string;
  evidenceAt: string;
  observedMinutes: number | null;
  confidence: number | null;
  reviewStatus: string;
  message: { id: string; content: string; createdAt: string } | null;
  reservation: {
    id: string;
    bookingDate: string | null;
    customerName: string | null;
    staffName: string | null;
  };
}

type PendingReview = { item: EvidenceItem; action: 'APPROVE' | 'REJECT' };

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

export const ScorecardVerificationQueue: React.FC = () => {
  const { toast } = useUiFeedback();
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingReview | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest(
        '/api/admin/staff-scorecard/evidence?status=NEEDS_REVIEW&limit=50'
      );
      if (res?.success) {
        setItems(Array.isArray(res.data) ? res.data : []);
      } else {
        setError(res?.error || 'Gagal memuat antrean verifikasi.');
      }
    } catch (err: any) {
      setError(err?.message || 'Gagal memuat antrean verifikasi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openReview = (item: EvidenceItem, action: 'APPROVE' | 'REJECT') => {
    setPending({ item, action });
    setNote('');
  };

  const closeReview = () => {
    if (submitting) return;
    setPending(null);
    setNote('');
  };

  const submitReview = async () => {
    if (!pending) return;
    const trimmed = note.trim();

    if (pending.action === 'REJECT' && !trimmed) {
      toast('Catatan wajib diisi saat menolak bukti.', 'error');
      return;
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
        await load();
      } else {
        toast(res?.error || 'Gagal menyimpan keputusan.', 'error');
      }
    } catch (err: any) {
      toast(err?.message || 'Gagal menyimpan keputusan.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-surface border border-divider rounded-2xl p-5 shadow-xs space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink flex items-center gap-2">
            <MessageSquare size={18} className="text-accent" />
            Verifikasi Bukti Keterlambatan
          </h2>
          <p className="text-xs text-ink-3 mt-0.5">
            Bukti dari pesan customer belum dihitung sampai disetujui. Tolak jika pesannya bukan
            soal menunggu bidan.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-fill-1 text-ink-2 border border-divider">
            {items.length} menunggu
          </span>
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} />}
            loading={loading}
            onClick={load}
          >
            Muat ulang
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-danger-soft border border-danger-line text-[11px] text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-ink-3">Memuat antrean…</p>
      ) : items.length === 0 ? (
        <div className="p-6 rounded-xl bg-fill-1 border border-divider text-center text-xs text-ink-3">
          Tidak ada bukti yang menunggu verifikasi.
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
                </div>
              </div>

              <blockquote className="text-xs text-ink-2 bg-surface border-l-2 border-accent/40 rounded-r-lg px-3 py-2">
                {item.message
                  ? `“${item.message.content}”`
                  : '(isi pesan tidak tersedia — mungkin sudah terhapus retensi)'}
              </blockquote>

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

      <Modal
        open={!!pending}
        onClose={closeReview}
        title={pending?.action === 'APPROVE' ? 'Setujui Bukti' : 'Tolak Bukti'}
        subtitle={
          pending
            ? `${pending.item.reservation.customerName || 'Customer'} · ${formatWib(
                pending.item.reservation.bookingDate
              )} · +${pending.item.observedMinutes ?? 0} menit`
            : undefined
        }
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={closeReview} disabled={submitting}>
              Batal
            </Button>
            <Button
              variant={pending?.action === 'APPROVE' ? 'primary' : 'danger'}
              loading={submitting}
              onClick={submitReview}
            >
              {pending?.action === 'APPROVE' ? 'Setujui' : 'Tolak'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {pending?.item.message && (
            <blockquote className="text-xs text-ink-2 bg-fill-1 border-l-2 border-accent/40 rounded-r-lg px-3 py-2">
              “{pending.item.message.content}”
            </blockquote>
          )}
          <label className="text-xs font-bold text-ink">
            Catatan {pending?.action === 'REJECT' ? '(wajib)' : '(opsional)'}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={
              pending?.action === 'REJECT'
                ? 'Contoh: pesan tentang jadwal berikutnya, bukan menunggu bidan.'
                : 'Catatan tambahan untuk audit (opsional).'
            }
            className={FIELD_TEXTAREA_BASE}
          />
        </div>
      </Modal>
    </div>
  );
};
