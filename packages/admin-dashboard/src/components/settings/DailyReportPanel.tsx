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
    <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-white flex items-center space-x-2">
          <BarChart3 className="text-pink-400" />
          <span>Laporan Operasional Harian (Daily Ops Report)</span>
        </h3>
        {telegramConfigured ? (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle size={10} />
            <span>Telegram Terkonfigurasi</span>
          </span>
        ) : (
          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertCircle size={10} />
            <span>Telegram Belum Terkonfigurasi</span>
          </span>
        )}
      </div>

      <p className="text-xs text-slate-400 leading-relaxed">
        Kirim ringkasan performa operasional (Sales, Omzet, Customer Baru, Atribusi Iklan, &amp; Kesehatan Bot) secara otomatis ke Telegram setiap pagi.
      </p>

      {loading ? (
        <div className="py-4 text-xs text-slate-500 animate-pulse">Memuat konfigurasi laporan harian...</div>
      ) : (
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-white/5">
            <div>
              <span className="text-xs font-bold text-slate-200 block">Aktifkan Pengiriman Otomatis</span>
              <span className="text-[10px] text-slate-500">Kirim notifikasi ringkasan otomatis setiap hari di jam terpilih</span>
            </div>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-4 h-4 text-pink-500 rounded focus:ring-pink-500 cursor-pointer"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1 flex items-center space-x-1">
                <KeyRound size={12} className="text-pink-400" />
                <span>Telegram Bot Token</span>
              </label>
              <input
                type="password"
                value={telegramBotToken}
                onChange={(e) => setTelegramBotToken(e.target.value)}
                placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyZ..."
                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-pink-500"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                Token dari BotFather Telegram. Kosongkan untuk memakai fallback env `TELEGRAM_BOT_TOKEN`.
              </span>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1 flex items-center space-x-1">
                <MessageSquare size={12} className="text-pink-400" />
                <span>Telegram Chat ID</span>
              </label>
              <input
                type="text"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                placeholder="-1001234567890 atau ID Chat/Group"
                className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-pink-500"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                ID Chat/Grup Telegram target laporan. Kosongkan untuk memakai fallback env `TELEGRAM_CHAT_ID`.
              </span>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1 flex items-center space-x-1">
              <Clock size={12} className="text-pink-400" />
              <span>Jam Pengiriman (WIB, 00-23)</span>
            </label>
            <input
              type="number"
              min={0}
              max={23}
              value={reportHour}
              onChange={(e) => setReportHour(parseInt(e.target.value, 10) || 0)}
              className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-pink-500"
            />
            <span className="text-[10px] text-slate-500 mt-1 block">
              Default: Jam 07:00 WIB (merangkum data jam 00:00 - 23:59 WIB hari sebelumnya).
            </span>
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              onClick={handleTestSend}
              disabled={testing}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition flex items-center space-x-2 disabled:opacity-50 border border-white/10"
            >
              <Send size={12} className="text-pink-400" />
              <span>{testing ? 'Mengirim...' : 'Tes Kirim Sekarang'}</span>
            </button>

            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-2 disabled:opacity-50"
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
