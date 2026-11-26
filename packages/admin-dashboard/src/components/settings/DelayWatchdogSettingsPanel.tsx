import React, { useEffect, useState } from 'react';
import { AlertCircle, Clock, Plus, Trash, Save, Send, ShieldCheck, MapPin } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';

interface DelayWatchdogState {
  toleranceMinutes: number;
  criticalExtraMinutes: number;
  maxPrevOriginGapHours: number;
  adminRecipients: string[];
}

const DEFAULT_WATCHDOG: DelayWatchdogState = {
  toleranceMinutes: 30,
  criticalExtraMinutes: 15,
  maxPrevOriginGapHours: 3,
  adminRecipients: [],
};

function maskPhoneNumber(phone: string): string {
  if (!phone || phone.length < 8) return phone;
  const prefix = phone.slice(0, 4);
  const suffix = phone.slice(-4);
  return `${prefix}****${suffix}`;
}

export const DelayWatchdogSettingsPanel: React.FC = () => {
  const { toast } = useUiFeedback();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [settings, setSettings] = useState<DelayWatchdogState>(DEFAULT_WATCHDOG);
  const [newRecipient, setNewRecipient] = useState('');
  const [showMasked, setShowMasked] = useState(true);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ success: boolean; data?: { delayWatchdog?: Partial<DelayWatchdogState> } }>(
        '/api/admin/tenant-settings'
      );
      if (res?.success && res.data?.delayWatchdog) {
        setSettings({
          toleranceMinutes: res.data.delayWatchdog.toleranceMinutes ?? 30,
          criticalExtraMinutes: res.data.delayWatchdog.criticalExtraMinutes ?? 15,
          maxPrevOriginGapHours: res.data.delayWatchdog.maxPrevOriginGapHours ?? 3,
          adminRecipients: Array.isArray(res.data.delayWatchdog.adminRecipients)
            ? res.data.delayWatchdog.adminRecipients
            : [],
        });
      }
    } catch (err: any) {
      toast(`Gagal memuat setelan: ${err?.message || err}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleAddRecipient = () => {
    const raw = newRecipient.trim();
    if (!raw) return;
    if (settings.adminRecipients.length >= 5) {
      toast('Maksimal 5 nomor admin yang dapat didaftarkan.', 'error');
      return;
    }
    // Cek format minimal nomor telepon
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) {
      toast('Nomor telepon tidak valid (harus 9-15 digit).', 'error');
      return;
    }
    if (settings.adminRecipients.includes(raw)) {
      toast('Nomor ini sudah ada dalam daftar penerima.', 'error');
      return;
    }
    setSettings((prev) => ({
      ...prev,
      adminRecipients: [...prev.adminRecipients, raw],
    }));
    setNewRecipient('');
  };

  const handleRemoveRecipient = (index: number) => {
    setSettings((prev) => ({
      ...prev,
      adminRecipients: prev.adminRecipients.filter((_, i) => i !== index),
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiRequest<{ success: boolean; error?: string; errors?: string[] }>(
        '/api/admin/tenant-settings',
        {
          method: 'PATCH',
          body: JSON.stringify({
            delayWatchdog: {
              toleranceMinutes: settings.toleranceMinutes,
              criticalExtraMinutes: settings.criticalExtraMinutes,
              maxPrevOriginGapHours: settings.maxPrevOriginGapHours,
              adminRecipients: settings.adminRecipients,
            },
          }),
        }
      );
      if (res?.success) {
        toast('Pengaturan Delay Watchdog berhasil disimpan!', 'success');
        await loadSettings();
      } else {
        const msg = res?.errors?.join(', ') || res?.error || 'Gagal menyimpan pengaturan.';
        toast(msg, 'error');
      }
    } catch (err: any) {
      toast(`Error saat menyimpan: ${err?.message || err}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    if (settings.adminRecipients.length === 0) {
      toast('Simpan nomor admin terlebih dahulu sebelum mengirim tes.', 'error');
      return;
    }
    setTesting(true);
    try {
      const res = await apiRequest<{ success: boolean; recipientCount?: number; error?: string }>(
        '/api/admin/tenant-settings/test-delay-notify',
        { method: 'POST', body: JSON.stringify({}) }
      );
      if (res?.success) {
        toast(`Pesan tes berhasil dikirim ke ${res.recipientCount || 1} nomor admin!`, 'success');
      } else {
        toast(res?.error || 'Gagal mengirim pesan tes.', 'error');
      }
    } catch (err: any) {
      toast(`Error saat kirim tes: ${err?.message || err}`, 'error');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 rounded-2xl bg-surface border border-divider shadow-xs text-xs text-ink-2">
        Memuat pengaturan Delay Watchdog...
      </div>
    );
  }

  return (
    <div className="p-5 rounded-2xl bg-surface border border-divider shadow-xs space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-divider pb-4">
        <div>
          <h2 className="text-sm font-bold text-ink flex items-center gap-2">
            <Clock size={16} className="text-warning" />
            <span>Peringatan Dini Keterlambatan Bidan (Departure Watchdog)</span>
          </h2>
          <p className="text-xs text-ink-2 mt-0.5 leading-relaxed">
            Mendeteksi potensi keterlambatan jadwal bidan secara otomatis dan mengirimkan notifikasi eskalasi
            ke nomor WhatsApp resmi Admin / CS.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSendTest}
            disabled={testing || saving || settings.adminRecipients.length === 0}
            className="px-3 py-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Kirim pesan uji coba ke seluruh nomor admin terdaftar"
          >
            <Send size={12} />
            <span>{testing ? 'Mengirim...' : 'Kirim Tes'}</span>
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-3.5 py-1.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-ink font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
          >
            <Save size={13} />
            <span>{saving ? 'Menyimpan...' : 'Simpan'}</span>
          </button>
        </div>
      </div>

      {/* Ambang & Parameter */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink flex items-center gap-1">
            <span>Toleransi Keterlambatan (Menit)</span>
          </label>
          <input
            type="number"
            min={1}
            max={180}
            value={settings.toleranceMinutes}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                toleranceMinutes: Math.max(1, parseInt(e.target.value, 10) || 1),
              }))
            }
            className="w-full p-2.5 rounded-xl bg-fill-1 border border-divider text-xs text-ink focus:outline-none focus:border-accent"
          />
          <p className="text-[11px] text-ink-3">
            Batas waktu (default 30m) untuk memicu peringatan <strong>Warning</strong> (amber).
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink flex items-center gap-1">
            <span>Tambahan Critical (Menit)</span>
          </label>
          <input
            type="number"
            min={0}
            max={120}
            value={settings.criticalExtraMinutes}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                criticalExtraMinutes: Math.max(0, parseInt(e.target.value, 10) || 0),
              }))
            }
            className="w-full p-2.5 rounded-xl bg-fill-1 border border-divider text-xs text-ink focus:outline-none focus:border-accent"
          />
          <p className="text-[11px] text-ink-3">
            Extra menit di atas toleransi untuk meningkatkan status ke <strong>Critical</strong> (merah).
            Total: {settings.toleranceMinutes + settings.criticalExtraMinutes} menit.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink flex items-center gap-1">
            <span>Batas Jeda Pasien (Jam)</span>
          </label>
          <input
            type="number"
            min={1}
            max={12}
            value={settings.maxPrevOriginGapHours}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                maxPrevOriginGapHours: Math.max(1, parseInt(e.target.value, 10) || 1),
              }))
            }
            className="w-full p-2.5 rounded-xl bg-fill-1 border border-divider text-xs text-ink focus:outline-none focus:border-accent"
          />
          <p className="text-[11px] text-ink-3">
            Batas jeda waktu (default 3 jam) untuk memakai alamat pasien sebelumnya sebagai titik awal.
          </p>
        </div>
      </div>

      {/* Penerima Notifikasi WhatsApp Admin */}
      <div className="space-y-3 pt-2 border-t border-divider">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold text-ink flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-accent" />
              <span>Nomor WhatsApp Penerima Notifikasi Admin / CS (Maks. 5)</span>
            </h3>
            <p className="text-[11px] text-ink-2 mt-0.5">
              Notifikasi keterlambatan dari bidan akan dikirimkan otomatis ke nomor ini (format: 08xx atau 628xx).
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowMasked(!showMasked)}
            className="text-[11px] text-accent hover:underline cursor-pointer"
          >
            {showMasked ? 'Tampilkan Lengkap' : 'Samarkan Nomor'}
          </button>
        </div>

        {/* Input Tambah Nomor */}
        <div className="flex items-center gap-2 max-w-md">
          <input
            type="text"
            placeholder="Contoh: 081234567890"
            value={newRecipient}
            onChange={(e) => setNewRecipient(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddRecipient();
              }
            }}
            disabled={settings.adminRecipients.length >= 5}
            className="flex-1 p-2 rounded-xl bg-fill-1 border border-divider text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={handleAddRecipient}
            disabled={!newRecipient.trim() || settings.adminRecipients.length >= 5}
            className="px-3 py-2 rounded-xl bg-surface hover:bg-fill-1 border border-divider text-ink font-semibold text-xs transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
          >
            <Plus size={12} />
            <span>Tambah</span>
          </button>
        </div>

        {/* List Nomor Terdaftar */}
        <div className="space-y-1.5">
          {settings.adminRecipients.length === 0 ? (
            <div className="p-3 rounded-xl bg-fill-1 border border-divider text-ink-3 text-xs italic">
              Belum ada nomor admin yang terdaftar. Notifikasi keterlambatan belum dapat dikirimkan.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {settings.adminRecipients.map((phone, idx) => (
                <div
                  key={phone + idx}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface border border-divider text-xs text-ink shadow-2xs"
                >
                  <span className="font-mono text-[11px]">
                    {showMasked ? maskPhoneNumber(phone) : phone}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveRecipient(idx)}
                    className="text-ink-3 hover:text-danger transition cursor-pointer"
                    title="Hapus nomor ini"
                  >
                    <Trash size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
