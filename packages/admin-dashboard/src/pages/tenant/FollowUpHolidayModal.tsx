import React, { useEffect, useState } from 'react';
import {
  CalendarOff,
  Coffee,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Clock,
  Sparkles,
  Info,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';

export interface FollowUpHolidayModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (isHolidayActive: boolean) => void;
}

export const FollowUpHolidayModal: React.FC<FollowUpHolidayModalProps> = ({
  open,
  onClose,
  onSaved,
}) => {
  const { toast } = useUiFeedback();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [autoRescheduleOnExit, setAutoRescheduleOnExit] = useState(true);

  const [currentState, setCurrentState] = useState<{ status: string; mode?: string } | null>(null);
  const [backlogCount, setBacklogCount] = useState(0);
  const [maxPerDay, setMaxPerDay] = useState(40);
  const [staleCapDays, setStaleCapDays] = useState(14);
  const [lastSummary, setLastSummary] = useState<any>(null);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('follow-ups/holiday-mode');
      if (res?.data) {
        const { config, state, backlogCount: bCount, maxPerDay: quota } = res.data;
        setEnabled(Boolean(config?.enabled));
        setStartDate(config?.startDate || '');
        setEndDate(config?.endDate || '');
        setReason(config?.reason || '');
        setAutoRescheduleOnExit(config?.autoRescheduleOnExit !== false);
        setCurrentState(state || null);
        setBacklogCount(bCount || 0);
        setMaxPerDay(typeof quota === 'number' && quota > 0 ? quota : 40);
        setStaleCapDays(typeof config?.staleCapDays === 'number' ? config.staleCapDays : 14);
        setLastSummary(config?.lastRescheduleSummary || null);
      }
    } catch (err: any) {
      toast(err.message || 'Gagal memuat status mode libur.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadStatus();
    }
  }, [open]);

  const handleSave = async () => {
    if (enabled && startDate && endDate && startDate > endDate) {
      toast('Tanggal mulai tidak boleh lebih besar dari tanggal selesai.', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        enabled,
        reason: reason.trim() || null,
        autoRescheduleOnExit,
        maxPerDay,
      };

      if (startDate && endDate) {
        payload.startDate = startDate;
        payload.endDate = endDate;
      } else {
        payload.startDate = null;
        payload.endDate = null;
      }

      const res = await apiRequest('follow-ups/holiday-mode', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const isNowActive = res?.data?.state?.status === 'active';
      toast(res.message || 'Pengaturan mode libur berhasil disimpan.', 'success');
      onSaved(isNowActive);
      onClose();
    } catch (err: any) {
      toast(err.message || 'Gagal menyimpan mode libur.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const isHolidayActive = currentState?.status === 'active';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2 text-ink font-bold">
          <Coffee size={18} className="text-warning" aria-hidden="true" />
          <span>Pengaturan Mode Libur Follow-Up</span>
        </span>
      }
    >
      <div className="p-6 space-y-5">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 text-ink-3 gap-2">
            <Loader2 size={24} className="animate-spin text-accent" />
            <p className="text-xs">Memuat konfigurasi mode libur...</p>
          </div>
        ) : (
          <>
            {/* Status Banner */}
            <div
              className={`p-4 rounded-xl border flex items-start gap-3 transition ${
                isHolidayActive
                  ? 'bg-warning-soft border-warning-line text-ink'
                  : 'bg-surface-2 border-divider text-ink-2'
              }`}
            >
              {isHolidayActive ? (
                <AlertTriangle size={20} className="text-warning shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 size={20} className="text-success shrink-0 mt-0.5" />
              )}
              <div className="flex-1 text-xs">
                <p className="font-bold text-sm">
                  {isHolidayActive ? 'Mode Libur SEDANG AKTIF' : 'Mode Libur Tidak Aktif'}
                </p>
                <p className="mt-1 leading-relaxed">
                  {isHolidayActive ? (
                    <>
                      Pengiriman pesan keluar dijeda. Jadwal overdue (&gt;48 jam) dilindungi agar tidak
                      hangus.
                      {backlogCount > 0 && (
                        <span className="block mt-1 font-semibold text-warning">
                          Saat ini terdapat {backlogCount} antrean pesan tertahan menunggu klinik buka
                          kembali.
                        </span>
                      )}
                    </>
                  ) : (
                    'Bot beroperasi normal mengirim pesan sesuai jam kerja operasional.'
                  )}
                </p>
              </div>
            </div>

            {/* Toggle Utama */}
            <div className="flex items-center justify-between p-4 bg-surface rounded-xl border border-divider">
              <div>
                <label
                  htmlFor="holiday-toggle"
                  className="font-bold text-sm text-ink block cursor-pointer"
                >
                  Aktifkan Mode Libur
                </label>
                <p className="text-xs text-ink-3 mt-0.5">
                  Nyalakan saat klinik tutup/cuti bersama agar bot tidak menghubungi customer.
                </p>
              </div>
              <input
                id="holiday-toggle"
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="w-5 h-5 accent-emerald-600 rounded cursor-pointer"
              />
            </div>

            {/* Rentang Tanggal */}
            <div className="space-y-3 p-4 bg-surface rounded-xl border border-divider">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-ink-3 flex items-center gap-1.5">
                  <Clock size={13} />
                  Rentang Tanggal Libur (Opsional)
                </span>
                {(startDate || endDate) && (
                  <button
                    type="button"
                    onClick={() => {
                      setStartDate('');
                      setEndDate('');
                    }}
                    className="text-xs text-accent hover:underline"
                  >
                    Reset Tanggal (Mode Manual)
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-ink-2 block mb-1">
                    Tanggal Mulai Libur
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-divider bg-surface text-ink focus:ring-1 focus:ring-accent outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-2 block mb-1">
                    Tanggal Selesai Libur
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full text-xs px-3 py-2 rounded-lg border border-divider bg-surface text-ink focus:ring-1 focus:ring-accent outline-none"
                  />
                </div>
              </div>
              <p className="text-[11px] text-ink-3">
                *Jika tanggal dikosongkan, sistem berjalan dalam mode ON/OFF manual (maksimal 30 hari).
                Jika tanggal diisi, sistem otomatis aktif dan mati sendiri sesuai rentang tanggal WIB.
              </p>
            </div>

            {/* Catatan / Alasan */}
            <div className="p-4 bg-surface rounded-xl border border-divider space-y-1.5">
              <label className="text-xs font-bold text-ink-2 block">
                Alasan / Catatan Libur (Opsional)
              </label>
              <input
                type="text"
                maxLength={200}
                placeholder="Contoh: Cuti Bersama Hari Raya Idul Fitri"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full text-xs px-3 py-2 rounded-lg border border-divider bg-surface text-ink focus:ring-1 focus:ring-accent outline-none"
              />
            </div>

            {/* Pencicilan Otomatis Pasca Libur (Anti-Blasting) */}
            <div className="p-4 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 rounded-xl space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRescheduleOnExit}
                  onChange={(e) => setAutoRescheduleOnExit(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600 rounded"
                />
                <span className="text-xs font-bold text-ink flex items-center gap-1.5">
                  <Sparkles size={13} className="text-accent" />
                  Cicil Antrean Pasca-Libur Otomatis (Maks {maxPerDay} Pesan/Hari)
                </span>
              </label>
              <p className="text-[11px] text-ink-2 leading-relaxed pl-6">
                Mencegah blasting menumpuk begitu libur selesai. Antrean tertahan akan dicicil merata
                pada jam operasional 09:00–16:30 WIB tanpa membuat tim CS kebanjiran chat.
              </p>
              <div className="flex items-center gap-2 pl-6 pt-1">
                <label htmlFor="holiday-quota" className="text-[11px] font-semibold text-ink-2">
                  Kuota harian
                </label>
                <input
                  id="holiday-quota"
                  type="number"
                  min={1}
                  max={200}
                  value={maxPerDay}
                  onChange={(e) => setMaxPerDay(Math.min(200, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                  className="w-20 text-xs px-2 py-1 rounded-lg border border-divider bg-surface text-ink focus:ring-1 focus:ring-accent outline-none"
                />
                <span className="text-[11px] text-ink-3">pesan/hari (tenant-aware)</span>
              </div>
            </div>

            {/* Summary Reschedule Terakhir */}
            {lastSummary && (
              <div className="text-[11px] text-ink-3 flex items-start gap-1.5 bg-surface-2 p-3 rounded-lg border border-divider">
                <Info size={14} className="shrink-0 text-accent mt-0.5" />
                <div>
                  <span className="font-semibold text-ink-2">Pencicilan Terakhir: </span>
                  {lastSummary.rescheduledCount} follow-up dijadwalkan ulang ke{' '}
                  {lastSummary.daysCount} hari buka{' '}
                  {lastSummary.staleCancelledCount > 0 &&
                    `(${lastSummary.staleCancelledCount} kadaluarsa >${staleCapDays} hari dibatalkan)`}
                  .
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal Actions */}
      <div className="p-4 bg-surface-2 border-t border-divider flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="px-4 py-2 text-xs font-semibold rounded-xl border border-divider hover:bg-fill-1 text-ink transition"
        >
          Batal
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || loading}
          className="px-4 py-2 text-xs font-bold rounded-xl bg-accent hover:bg-accent-hover text-on-solid transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
        >
          {saving && <Loader2 size={13} className="animate-spin" />}
          <span>Simpan Pengaturan</span>
        </button>
      </div>
    </Modal>
  );
};
