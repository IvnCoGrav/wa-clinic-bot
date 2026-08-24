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

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{
        success: boolean;
        data: {
          enabled: boolean;
          reportHour: number;
          telegramBotToken: string;
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
          <div className="bg-linear-to-r from-[#f0fdf4] to-[#f8fafc] border border-emerald-200 rounded-2xl p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Sparkles size={15} className="text-emerald-600" />
                <span className="text-xs font-bold text-[#111b21]">Koneksi 1-Klik Instan (Zero-Setup)</span>
              </div>
              <button
                type="button"
                onClick={fetchSettings}
                title="Perbarui status koneksi"
                className="text-[11px] text-emerald-700 hover:text-emerald-900 flex items-center space-x-1 font-medium transition"
              >
                <RefreshCw size={11} />
                <span>Cek Status</span>
              </button>
            </div>

            <p className="text-[11px] text-[#475569] leading-relaxed">
              Pilih tujuan penerimaan laporan. Anda cukup mengklik tombol di bawah dan menekan tombol <b>START / Tambahkan</b> di Telegram:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <a
                href={telegramDirectLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 bg-white hover:bg-emerald-50 border border-emerald-300 rounded-xl transition shadow-2xs group"
              >
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                    <MessageSquare size={16} />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-[#111b21] block group-hover:text-emerald-700">
                      Chat Pribadi (DM)
                    </span>
                    <span className="text-[10px] text-[#64748b]">Laporan langsung ke akun Anda</span>
                  </div>
                </div>
                <ExternalLink size={13} className="text-emerald-600 group-hover:translate-x-0.5 transition-transform" />
              </a>

              <a
                href={telegramGroupLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 bg-white hover:bg-emerald-50 border border-emerald-300 rounded-xl transition shadow-2xs group"
              >
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                    <Users size={16} />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-[#111b21] block group-hover:text-emerald-700">
                      Grup Telegram / Tim
                    </span>
                    <span className="text-[10px] text-[#64748b]">Laporan ke grup bersama staff</span>
                  </div>
                </div>
                <ExternalLink size={13} className="text-emerald-600 group-hover:translate-x-0.5 transition-transform" />
              </a>
            </div>

            {/* Forum / Topics Quick Guide */}
            <div className="p-3 bg-white/80 rounded-xl border border-emerald-100 text-[11px] text-[#475569] space-y-1.5">
              <div className="font-bold text-[#1e293b] flex items-center space-x-1">
                <Layers size={13} className="text-emerald-600" />
                <span>Panduan Sub-Topik (Forum Topics):</span>
              </div>
              <p className="text-[10.5px] leading-relaxed">
                Jika bot dimasukkan ke grup dengan banyak topik, cukup buka topik yang diinginkan lalu ketik perintah berikut:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 pt-1 text-[10px] font-mono">
                <div className="bg-[#f1f5f9] p-1.5 rounded-lg border border-[#e2e8f0]">
                  <span className="font-bold text-[#0f172a]">/set_daily_report</span>
                  <div className="text-[#64748b] text-[9px] font-sans">Topik Laporan Harian</div>
                </div>
                <div className="bg-[#f1f5f9] p-1.5 rounded-lg border border-[#e2e8f0]">
                  <span className="font-bold text-[#0f172a]">/set_error_alerts</span>
                  <div className="text-[#64748b] text-[9px] font-sans">Topik Error Sistem</div>
                </div>
                <div className="bg-[#f1f5f9] p-1.5 rounded-lg border border-[#e2e8f0]">
                  <span className="font-bold text-[#0f172a]">/set_medical_alerts</span>
                  <div className="text-[#64748b] text-[9px] font-sans">Topik Eskalasi Medis</div>
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
              className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
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
                  className="text-[10px] text-red-600 hover:text-red-700 font-medium"
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
                    placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyZ..."
                    className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
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
                    className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
                  />
                  <span className="text-[10px] text-[#8696a0] block">
                    Diisi otomatis oleh tombol 1-Klik, atau isi manual jika diperlukan.
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#475569]">Topic ID Laporan</label>
                  <input
                    type="text"
                    value={telegramTopicDailyReport}
                    onChange={(e) => setTelegramTopicDailyReport(e.target.value)}
                    placeholder="contoh: 42"
                    className="w-full bg-white border border-[#d1d7db] rounded-lg px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#475569]">Topic ID Error Server</label>
                  <input
                    type="text"
                    value={telegramTopicSystemErrors}
                    onChange={(e) => setTelegramTopicSystemErrors(e.target.value)}
                    placeholder="contoh: 50"
                    className="w-full bg-white border border-[#d1d7db] rounded-lg px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#475569]">Topic ID Eskalasi Medis</label>
                  <input
                    type="text"
                    value={telegramTopicMedicalAlerts}
                    onChange={(e) => setTelegramTopicMedicalAlerts(e.target.value)}
                    placeholder="contoh: 65"
                    className="w-full bg-white border border-[#d1d7db] rounded-lg px-2.5 py-1.5 text-xs"
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
    </div>
  );
};
