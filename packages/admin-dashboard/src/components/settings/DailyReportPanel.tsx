import React, { useState, useEffect } from 'react';
import { BarChart3, Clock, Send, Save, AlertCircle, CheckCircle, KeyRound, MessageSquare } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';

export const DailyReportPanel: React.FC = () => {
  const { toast } = useUiFeedback();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [reportHour, setReportHour] = useState(7);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

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
          telegramConfigured: boolean;
        };
      }>('/api/admin/settings/daily-report');
      if (res.success && res.data) {
        setEnabled(res.data.enabled);
        setReportHour(res.data.reportHour);
        setTelegramBotToken(res.data.telegramBotToken || '');
        setTelegramChatId(res.data.telegramChatId || '');
        setTelegramConfigured(res.data.telegramConfigured);
      }
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiRequest<{
        success: boolean;
        message?: string;
        data?: { telegramBotToken: string; telegramChatId: string };
      }>('/api/admin/settings/daily-report', {
        method: 'PUT',
        body: JSON.stringify({
          enabled,
          reportHour,
          telegramBotToken,
          telegramChatId,
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
      });
      if (res.success) {
        toast(res.message || 'Laporan harian berhasil dikirim ke Telegram', 'success');
      }
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-white border border-[#e9edef] rounded-2xl p-5 space-y-4 shadow-xs">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
          <BarChart3 className="text-[#008069]" size={16} />
          <span>Laporan Operasional Harian (Daily Ops Report)</span>
        </h3>
        {telegramConfigured ? (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle size={11} className="text-emerald-600" />
            <span>Telegram Terkonfigurasi</span>
          </span>
        ) : (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
            <AlertCircle size={11} className="text-amber-600" />
            <span>Telegram Belum Terkonfigurasi</span>
          </span>
        )}
      </div>

      <p className="text-xs text-[#667781] leading-relaxed">
        Kirim ringkasan performa operasional (Sales, Omzet, Customer Baru, Atribusi Iklan, &amp; Kesehatan Bot) secara otomatis ke Telegram setiap pagi.
      </p>

      {loading ? (
        <div className="py-4 text-xs text-[#8696a0] animate-pulse">Memuat konfigurasi laporan harian...</div>
      ) : (
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef]">
            <div>
              <span className="text-xs font-bold text-[#111b21] block">Aktifkan Pengiriman Otomatis</span>
              <span className="text-xs text-[#667781]">Kirim notifikasi ringkasan otomatis setiap hari di jam terpilih</span>
            </div>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-4 h-4 text-[#008069] rounded focus:ring-[#008069] cursor-pointer"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-[#111b21] block flex items-center space-x-1">
                <KeyRound size={12} className="text-[#008069]" />
                <span>Telegram Bot Token</span>
              </label>
              <input
                type="password"
                value={telegramBotToken}
                onChange={(e) => setTelegramBotToken(e.target.value)}
                placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyZ..."
                className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
              />
              <span className="text-[10px] text-[#8696a0] block">
                Token dari BotFather Telegram. Kosongkan untuk memakai fallback env `TELEGRAM_BOT_TOKEN`.
              </span>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-[#111b21] block flex items-center space-x-1">
                <MessageSquare size={12} className="text-[#008069]" />
                <span>Telegram Chat ID</span>
              </label>
              <input
                type="text"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                placeholder="-1001234567890 atau ID Chat/Group"
                className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] placeholder-[#8696a0] focus:outline-none focus:border-[#008069] shadow-xs"
              />
              <span className="text-[10px] text-[#8696a0] block">
                ID Chat/Grup Telegram target laporan. Kosongkan untuk memakai fallback env `TELEGRAM_CHAT_ID`.
              </span>
            </div>
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

          <div className="flex items-center justify-between pt-2">
            <button
              onClick={handleTestSend}
              disabled={testing}
              className="px-3.5 py-2 bg-white hover:bg-[#f0f2f5] text-[#111b21] rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 border border-[#d1d7db] shadow-xs"
            >
              <Send size={12} className="text-[#008069]" />
              <span>{testing ? 'Mengirim...' : 'Tes Kirim Sekarang'}</span>
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
