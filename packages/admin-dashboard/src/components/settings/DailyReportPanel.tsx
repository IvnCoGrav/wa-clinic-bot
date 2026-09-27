import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  Clock,
  Send,
  Save,
  AlertCircle,
  CheckCircle,
  KeyRound,
  MessageSquare,
  Users,
  ExternalLink,
  RefreshCw,
  Sparkles,
  Layers,
  HelpCircle,
  Moon,
  Phone,
  X,
  Plus,
  History,
} from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { ToggleSwitch } from '../common/ToggleSwitch';

export const DailyReportPanel: React.FC = () => {
  const { toast } = useUiFeedback();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [reportHour, setReportHour] = useState(7);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramBotTokenConfigured, setTelegramBotTokenConfigured] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramPairingToken, setTelegramPairingToken] = useState('');
  const [telegramDirectLink, setTelegramDirectLink] = useState('');
  const [telegramGroupLink, setTelegramGroupLink] = useState('');
  const [telegramBotUsername, setTelegramBotUsername] = useState('KalaReport_bot');
  const [telegramTopicDailyReport, setTelegramTopicDailyReport] = useState('');
  const [telegramTopicSystemErrors, setTelegramTopicSystemErrors] = useState('');
  const [telegramTopicMedicalAlerts, setTelegramTopicMedicalAlerts] = useState('');
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // Fase 2r — Nightly Watchdog state
  const [nightlyEnabled, setNightlyEnabled] = useState(false);
  const [nightlyHour, setNightlyHour] = useState(21);
  const [adminNumbers, setAdminNumbers] = useState<string[]>([]);
  const [numberInput, setNumberInput] = useState('');
  const [waProvider, setWaProvider] = useState<'WAHA' | 'WABA'>('WAHA');
  const [channels, setChannels] = useState<string[]>(['TELEGRAM']);
  const [savingNightly, setSavingNightly] = useState(false);
  const [testingNightly, setTestingNightly] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchNightlySettings();
  }, []);

  const fetchNightlySettings = async () => {
    try {
      const res = await apiRequest<{
        success: boolean;
        data: {
          nightlyReportEnabled: boolean;
          nightlyReportHour: number;
          adminWhatsappNumbers: string[];
          notificationChannels: string[];
          whatsappProvider: 'WAHA' | 'WABA';
        };
      }>('/api/admin/settings/notifications');
      if (res.success && res.data) {
        setNightlyEnabled(res.data.nightlyReportEnabled);
        setNightlyHour(res.data.nightlyReportHour ?? 21);
        setAdminNumbers(res.data.adminWhatsappNumbers || []);
        setChannels(res.data.notificationChannels || ['TELEGRAM']);
        setWaProvider(res.data.whatsappProvider || 'WAHA');
      }
    } catch (err: any) {
      // senyap — panel nightly bersifat pelengkap
    }
  };

  const addNumber = () => {
    const raw = numberInput.trim();
    if (!raw) return;
    let cleaned = raw.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = '62' + cleaned.slice(1);
    else if (cleaned.startsWith('8')) cleaned = '62' + cleaned;
    if (cleaned.length < 8) {
      toast('Nomor tidak valid.', 'error');
      return;
    }
    if (adminNumbers.includes(cleaned)) {
      setNumberInput('');
      return;
    }
    setAdminNumbers((prev) => [...prev, cleaned]);
    setNumberInput('');
  };

  const removeNumber = (num: string) => {
    setAdminNumbers((prev) => prev.filter((n) => n !== num));
  };

  const toggleChannel = (ch: string) => {
    setChannels((prev) => (prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]));
  };

  const handleSaveNightly = async () => {
    setSavingNightly(true);
    try {
      const res = await apiRequest<{ success: boolean; message?: string }>('/api/admin/settings/notifications', {
        method: 'PUT',
        body: JSON.stringify({
          nightlyReportEnabled: nightlyEnabled,
          nightlyReportHour: nightlyHour,
          adminWhatsappNumbers: adminNumbers,
          notificationChannels: channels,
        }),
      });
      if (res.success) {
        toast(res.message || 'Pengaturan notifikasi disimpan', 'success');
        fetchNightlySettings();
      }
    } catch (err: any) {
      toast(err.message || 'Gagal menyimpan pengaturan notifikasi', 'error');
    } finally {
      setSavingNightly(false);
    }
  };

  const handleTestNightly = async () => {
    setTestingNightly(true);
    try {
      const res = await apiRequest<{ success: boolean; message?: string; data?: any[] }>('/api/admin/settings/notifications/test', {
        method: 'POST',
      });
      toast(res.message || (res.success ? 'Pesan uji coba terkirim' : 'Uji coba gagal/di-skip'), res.success ? 'success' : 'error');
      if (showLogs) fetchLogs();
    } catch (err: any) {
      toast(err.message || 'Gagal mengirim uji coba', 'error');
    } finally {
      setTestingNightly(false);
    }
  };

  const fetchLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await apiRequest<{ success: boolean; data: any[] }>('/api/admin/settings/notifications/logs');
      setLogs(res.data || []);
    } catch {
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  };

  const toggleLogs = () => {
    const next = !showLogs;
    setShowLogs(next);
    if (next) fetchLogs();
  };

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{
        success: boolean;
        data: {
          enabled: boolean;
          reportHour: number;
          telegramBotToken?: string;
          telegramBotTokenConfigured?: boolean;
          telegramChatId: string;
          telegramPairingToken?: string;
          telegramDirectLink?: string;
          telegramGroupLink?: string;
          telegramBotUsername?: string;
          telegramTopicDailyReport?: string;
          telegramTopicSystemErrors?: string;
          telegramTopicMedicalAlerts?: string;
          telegramConfigured: boolean;
        };
      }>('/api/admin/settings/daily-report');
      if (res.success && res.data) {
        setEnabled(res.data.enabled);
        setReportHour(res.data.reportHour);
        setTelegramBotToken(res.data.telegramBotToken || '');
        setTelegramBotTokenConfigured(Boolean(res.data.telegramBotTokenConfigured));
        setTelegramChatId(res.data.telegramChatId || '');
        setTelegramPairingToken(res.data.telegramPairingToken || '');
        setTelegramDirectLink(res.data.telegramDirectLink || '');
        setTelegramGroupLink(res.data.telegramGroupLink || '');
        setTelegramBotUsername(res.data.telegramBotUsername || 'KalaReport_bot');
        setTelegramTopicDailyReport(res.data.telegramTopicDailyReport || '');
        setTelegramTopicSystemErrors(res.data.telegramTopicSystemErrors || '');
        setTelegramTopicMedicalAlerts(res.data.telegramTopicMedicalAlerts || '');
        setTelegramConfigured(res.data.telegramConfigured);
      }
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateToken = async () => {
    setRegenerating(true);
    try {
      const res = await apiRequest<{
        success: boolean;
        message?: string;
        data?: {
          pairingToken: string;
          directLink: string;
          groupLink: string;
        };
      }>('/api/admin/settings/telegram/regenerate-token', {
        method: 'POST',
      });
      if (res.success && res.data) {
        setTelegramPairingToken(res.data.pairingToken);
        setTelegramDirectLink(res.data.directLink);
        setTelegramGroupLink(res.data.groupLink);
        toast(res.message || 'Token pairing baru berhasil dibuat', 'success');
      }
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setRegenerating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiRequest<{
        success: boolean;
        message?: string;
      }>('/api/admin/settings/daily-report', {
        method: 'PUT',
        body: JSON.stringify({
          enabled,
          reportHour,
          telegramBotToken,
          telegramChatId,
          telegramTopicDailyReport,
          telegramTopicSystemErrors,
          telegramTopicMedicalAlerts,
        }),
      });
      if (res.success) {
        toast(res.message || 'Pengaturan berhasil disimpan', 'success');
        fetchSettings();
      }
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTestSend = async () => {
    setTesting(true);
    try {
      const res = await apiRequest<{ success: boolean; message?: string }>('/api/admin/settings/daily-report/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramBotToken,
          telegramChatId,
        }),
      });
      if (res.success) {
        toast(res.message || 'Pesan uji coba (data dummy) berhasil dikirim ke Telegram', 'success');
      }
    } catch (err: any) {
      toast(err.message || 'Gagal mengirim pesan uji coba', 'error');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-5 shadow-xs">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
          <BarChart3 className="text-[#008069]" size={16} />
          <span>Laporan Operasional Harian &amp; Notifikasi Telegram</span>
        </h3>
        {telegramConfigured ? (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle size={11} className="text-emerald-600" />
            <span>Telegram Terhubung ({telegramChatId})</span>
          </span>
        ) : (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
            <AlertCircle size={11} className="text-amber-600" />
            <span>Telegram Belum Terhubung</span>
          </span>
        )}
      </div>

      <p className="text-xs text-[#667781] leading-relaxed">
        Kirim ringkasan performa operasional (Sales, Omzet, Customer Baru, Atribusi Iklan, &amp; Kesehatan Bot) secara otomatis ke Telegram setiap pagi tanpa perlu konfigurasi teknis yang rumit.
      </p>

      {loading ? (
        <div className="py-6 text-xs text-[#8696a0] animate-pulse text-center">Memuat konfigurasi laporan harian...</div>
      ) : (
        <div className="space-y-4 pt-1">
          {/* 1-Click Zero-Setup Pairing Section */}
          <div className="bg-emerald-50/40 border border-emerald-200 rounded-2xl p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Sparkles size={15} className="text-[#008069]" />
                <span className="text-xs font-bold text-[#111b21]">Koneksi 1-Klik Instan (Zero-Setup)</span>
              </div>
              <button
                type="button"
                onClick={fetchSettings}
                title="Perbarui status koneksi"
                className="text-[11px] text-[#008069] hover:text-[#00a884] flex items-center space-x-1 font-semibold transition"
              >
                <RefreshCw size={11} />
                <span>Cek Status</span>
              </button>
            </div>

            <p className="text-[11px] text-[#54656f] leading-relaxed">
              Pilih tujuan penerimaan laporan. Anda cukup mengklik tombol di bawah dan menekan tombol <b>START / Tambahkan</b> di Telegram:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <a
                href={telegramDirectLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 bg-white hover:bg-emerald-50/60 border border-emerald-200 rounded-xl transition shadow-2xs group"
              >
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 text-[#008069] flex items-center justify-center font-bold">
                    <MessageSquare size={16} />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-[#111b21] block group-hover:text-[#008069]">
                      Chat Pribadi (DM)
                    </span>
                    <span className="text-[10px] text-[#8696a0]">Laporan langsung ke akun Anda</span>
                  </div>
                </div>
                <ExternalLink size={13} className="text-[#008069] group-hover:translate-x-0.5 transition-transform" />
              </a>

              <a
                href={telegramGroupLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 bg-white hover:bg-emerald-50/60 border border-emerald-200 rounded-xl transition shadow-2xs group"
              >
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center font-bold">
                    <Users size={16} />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-[#111b21] block group-hover:text-[#008069]">
                      Grup Telegram / Tim
                    </span>
                    <span className="text-[10px] text-[#8696a0]">Laporan ke grup bersama staff</span>
                  </div>
                </div>
                <ExternalLink size={13} className="text-[#008069] group-hover:translate-x-0.5 transition-transform" />
              </a>
            </div>

            {/* Forum / Topics Quick Guide */}
            <div className="p-3 bg-white rounded-xl border border-emerald-200/80 text-[11px] text-[#54656f] space-y-1.5 shadow-2xs">
              <div className="font-bold text-[#111b21] flex items-center space-x-1">
                <Layers size={13} className="text-[#008069]" />
                <span>Panduan Sub-Topik (Forum Topics):</span>
              </div>
              <p className="text-[10.5px] leading-relaxed text-[#54656f]">
                Jika bot dimasukkan ke grup dengan banyak topik, cukup buka topik yang diinginkan lalu ketik perintah berikut:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 pt-1 text-[10px] font-mono">
                <div className="bg-[#f8fafc] p-2 rounded-lg border border-[#e9edef]">
                  <span className="font-bold text-[#008069]">/set_daily_report</span>
                  <div className="text-[#8696a0] text-[9px] font-sans">Topik Laporan Harian</div>
                </div>
                <div className="bg-[#f8fafc] p-2 rounded-lg border border-[#e9edef]">
                  <span className="font-bold text-[#008069]">/set_error_alerts</span>
                  <div className="text-[#8696a0] text-[9px] font-sans">Topik Error Sistem</div>
                </div>
                <div className="bg-[#f8fafc] p-2 rounded-lg border border-[#e9edef]">
                  <span className="font-bold text-[#008069]">/set_medical_alerts</span>
                  <div className="text-[#8696a0] text-[9px] font-sans">Topik Eskalasi Medis</div>
                </div>
              </div>
            </div>
          </div>

          {/* Schedule Settings */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef]">
            <div>
              <span className="text-xs font-bold text-[#111b21] block">Aktifkan Jadwal Cron Otomatis</span>
              <span className="text-xs text-[#667781]">Kirim notifikasi ringkasan otomatis setiap hari di jam terpilih</span>
            </div>
            <ToggleSwitch
              checked={enabled}
              onChange={(next) => setEnabled(next)}
              onLabel="ON (AKTIF)"
              offLabel="OFF (NONAKTIF)"
              size="md"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-bold text-[#111b21] block flex items-center space-x-1">
              <Clock size={12} className="text-[#008069]" />
              <span>Jam Pengiriman (WIB, 00-23)</span>
            </label>
            <input
              type="number"
              min={0}
              max={23}
              value={reportHour}
              onChange={(e) => setReportHour(parseInt(e.target.value, 10) || 0)}
              className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
            />
            <span className="text-[10px] text-[#8696a0] block">
              Default: Jam 07:00 WIB (merangkum data jam 00:00 - 23:59 WIB hari sebelumnya).
            </span>
          </div>

          {/* Advanced Manual Settings Toggle */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs text-[#008069] hover:underline font-semibold flex items-center space-x-1"
            >
              <HelpCircle size={13} />
              <span>{showAdvanced ? 'Sembunyikan Pengaturan Manual (Lanjutan)' : 'Tampilkan Pengaturan Manual / Custom Bot (Lanjutan)'}</span>
            </button>
          </div>

          {showAdvanced && (
            <div className="p-4 bg-[#f8fafc] border border-[#e9edef] rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#111b21]">Konfigurasi Token &amp; Chat ID Manual</span>
                <button
                  type="button"
                  onClick={handleRegenerateToken}
                  disabled={regenerating}
                  className="text-[10px] text-rose-600 hover:text-rose-700 font-semibold"
                >
                  {regenerating ? 'Membuat...' : 'Reset Token Pairing'}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-[#111b21] block flex items-center space-x-1">
                    <KeyRound size={12} className="text-[#008069]" />
                    <span>Telegram Bot Token (BYOB / Custom)</span>
                  </label>
                  <input
                    type="password"
                    value={telegramBotToken}
                    onChange={(e) => setTelegramBotToken(e.target.value)}
                    placeholder={telegramBotTokenConfigured ? '•••••• tersimpan — biarkan kosong untuk mempertahankan' : '123456789:ABCdefGHIjklMNOpqrsTUVwxyZ...'}
                    className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
                  />
                  <span className="text-[10px] text-[#8696a0] block">
                    Kosongkan untuk menggunakan bot resmi default (@{telegramBotUsername}).
                  </span>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-[#111b21] block flex items-center space-x-1">
                    <MessageSquare size={12} className="text-[#008069]" />
                    <span>Telegram Chat ID Terdaftar</span>
                  </label>
                  <input
                    type="text"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    placeholder="-1001234567890 atau ID Chat Pribadi"
                    className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
                  />
                  <span className="text-[10px] text-[#8696a0] block">
                    Diisi otomatis oleh tombol 1-Klik, atau isi manual jika diperlukan.
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#54656f]">Topic ID Laporan</label>
                  <input
                    type="text"
                    value={telegramTopicDailyReport}
                    onChange={(e) => setTelegramTopicDailyReport(e.target.value)}
                    placeholder="contoh: 42"
                    className="w-full bg-white border border-[#d1d7db] rounded-xl px-2.5 py-1.5 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#54656f]">Topic ID Error Server</label>
                  <input
                    type="text"
                    value={telegramTopicSystemErrors}
                    onChange={(e) => setTelegramTopicSystemErrors(e.target.value)}
                    placeholder="contoh: 50"
                    className="w-full bg-white border border-[#d1d7db] rounded-xl px-2.5 py-1.5 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#54656f]">Topic ID Eskalasi Medis</label>
                  <input
                    type="text"
                    value={telegramTopicMedicalAlerts}
                    onChange={(e) => setTelegramTopicMedicalAlerts(e.target.value)}
                    placeholder="contoh: 65"
                    className="w-full bg-white border border-[#d1d7db] rounded-xl px-2.5 py-1.5 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={handleTestSend}
              disabled={testing}
              title="Kirim notifikasi simulasi berisi data dummy untuk menguji integrasi Telegram tanpa mempengaruhi riwayat laporan harian"
              className="px-3.5 py-2 bg-white hover:bg-[#f0f2f5] text-[#111b21] rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 border border-[#d1d7db] shadow-xs"
            >
              <Send size={12} className="text-[#008069]" />
              <span>{testing ? 'Mengirim Simulasi...' : 'Tes Kirim (Data Dummy)'}</span>
            </button>

            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 shadow-xs"
            >
              <Save size={12} />
              <span>{saving ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
            </button>
          </div>
        </div>
      )}

      {/* ================= Fase 2r — Nightly Watchdog ================= */}
      <div className="border-t border-[#e9edef] pt-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
            <Moon className="text-indigo-600" size={16} />
            <span>Laporan Malam (Nightly Watchdog) — 21:00 WIB</span>
          </h3>
          <button
            type="button"
            onClick={toggleLogs}
            className="text-[11px] text-[#008069] hover:text-[#00a884] flex items-center space-x-1 font-semibold"
          >
            <History size={12} />
            <span>{showLogs ? 'Sembunyikan Riwayat' : 'Riwayat Pengiriman'}</span>
          </button>
        </div>

        <p className="text-xs text-[#667781] leading-relaxed">
          Rekap pengawasan malam: chat belum dibalas, tanya jadwal belum booking, dan jadwal terkonfirmasi besok.
          Dikirim otomatis ke Telegram (dan WhatsApp bila diaktifkan &amp; provider = WAHA).
        </p>

        <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#f8fafc] border border-[#e9edef]">
          <div>
            <span className="text-xs font-bold text-[#111b21] block">Aktifkan Laporan Malam</span>
            <span className="text-xs text-[#667781]">Kirim otomatis setiap malam pada jam terpilih</span>
          </div>
          <ToggleSwitch
            checked={nightlyEnabled}
            onChange={(next) => setNightlyEnabled(next)}
            onLabel="ON"
            offLabel="OFF"
            size="md"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold text-[#111b21] block flex items-center space-x-1">
            <Clock size={12} className="text-indigo-600" />
            <span>Jam Pengiriman (WIB, 0-23)</span>
          </label>
          <input
            type="number"
            min={0}
            max={23}
            value={nightlyHour}
            onChange={(e) => setNightlyHour(parseInt(e.target.value, 10) || 0)}
            className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069]"
          />
        </div>

        {/* Kanal */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-bold text-[#111b21] block">Kanal Notifikasi</span>
          <div className="flex flex-wrap gap-2">
            {['TELEGRAM', 'WHATSAPP'].map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => toggleChannel(ch)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition ${
                  channels.includes(ch)
                    ? 'bg-[#008069] text-white border-[#008069]'
                    : 'bg-white text-[#54656f] border-[#d1d7db] hover:border-[#008069]'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>
        </div>

        {/* Nomor WA Admin (khusus WAHA) */}
        {channels.includes('WHATSAPP') && (
          <div className="space-y-2 p-3.5 rounded-xl bg-amber-50/50 border border-amber-200">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#111b21] flex items-center space-x-1">
                <Phone size={12} className="text-amber-600" />
                <span>Nomor WhatsApp Admin</span>
              </span>
              {waProvider === 'WABA' && (
                <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-200">
                  Provider WABA → WA di-skip (pakai Telegram)
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {adminNumbers.map((num) => (
                <span key={num} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-amber-200 text-[11px] font-mono text-[#111b21]">
                  {num}
                  <button type="button" onClick={() => removeNumber(num)} className="text-rose-500 hover:text-rose-700">
                    <X size={11} />
                  </button>
                </span>
              ))}
              {adminNumbers.length === 0 && <span className="text-[11px] text-[#8696a0] italic">Belum ada nomor.</span>}
            </div>
            <div className="flex gap-2">
              <input
                type="tel"
                value={numberInput}
                onChange={(e) => setNumberInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNumber(); } }}
                placeholder="08xx / 628xx / +62 8xx"
                className="flex-1 bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] focus:outline-none focus:border-[#008069]"
              />
              <button
                type="button"
                onClick={addNumber}
                className="px-3 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold flex items-center gap-1"
              >
                <Plus size={12} /> Tambah
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={handleTestNightly}
            disabled={testingNightly}
            className="px-3.5 py-2 bg-white hover:bg-[#f0f2f5] text-[#111b21] rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 border border-[#d1d7db]"
          >
            <Send size={12} className="text-indigo-600" />
            <span>{testingNightly ? 'Mengirim...' : '🧪 Kirim Uji Coba'}</span>
          </button>
          <button
            type="button"
            onClick={handleSaveNightly}
            disabled={savingNightly}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50"
          >
            <Save size={12} />
            <span>{savingNightly ? 'Menyimpan...' : 'Simpan Laporan Malam'}</span>
          </button>
        </div>

        {showLogs && (
          <div className="border border-[#e9edef] rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-[#f8fafc] border-b border-[#e9edef] text-[11px] font-bold text-[#111b21] flex items-center justify-between">
              <span>Riwayat Pengiriman (100 terakhir)</span>
              <button type="button" onClick={fetchLogs} className="text-[#008069] hover:text-[#00a884] flex items-center gap-1">
                <RefreshCw size={11} /> Refresh
              </button>
            </div>
            {loadingLogs ? (
              <div className="p-4 text-center text-xs text-[#8696a0] animate-pulse">Memuat riwayat...</div>
            ) : logs.length === 0 ? (
              <div className="p-4 text-center text-xs text-[#8696a0]">Belum ada riwayat pengiriman.</div>
            ) : (
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-[#f8fafc] text-[#667781] sticky top-0">
                    <tr>
                      <th className="text-left px-2.5 py-1.5 font-bold">Waktu</th>
                      <th className="text-left px-2.5 py-1.5 font-bold">Kanal</th>
                      <th className="text-left px-2.5 py-1.5 font-bold">Penerima</th>
                      <th className="text-left px-2.5 py-1.5 font-bold">Tipe</th>
                      <th className="text-left px-2.5 py-1.5 font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0f2f5]">
                    {logs.map((l) => (
                      <tr key={l.id}>
                        <td className="px-2.5 py-1.5 whitespace-nowrap text-[#54656f]">
                          {new Date(l.sent_at).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
                        </td>
                        <td className="px-2.5 py-1.5 font-semibold text-[#111b21]">{l.channel}</td>
                        <td className="px-2.5 py-1.5 font-mono text-[#54656f]">{l.recipient}</td>
                        <td className="px-2.5 py-1.5 text-[#54656f]">{l.notification_type}</td>
                        <td className="px-2.5 py-1.5">
                          <span className={`px-1.5 py-0.5 rounded font-bold ${
                            l.status === 'SENT' ? 'bg-emerald-100 text-emerald-700'
                              : l.status === 'SKIPPED' ? 'bg-amber-100 text-amber-700'
                              : 'bg-rose-100 text-rose-700'
                          }`}>
                            {l.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
