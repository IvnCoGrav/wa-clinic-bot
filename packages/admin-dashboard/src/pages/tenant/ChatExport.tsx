import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { Download, FileText, RefreshCw, CalendarDays, Sparkles } from 'lucide-react';

interface ExportFile {
  fileName: string;
  date: string;
  rangeEnd?: string;
  sizeBytes: number;
  updatedAt: string;
}

interface ExportResultData {
  date: string;
  fileName: string;
  content: string;
  stats: {
    totalConversations: number;
    totalMessages: number;
    humanHandled: number;
    escalated: number;
    flaggedReview: number;
  };
}

const localToday = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
};

const downloadMarkdown = (fileName: string, content: string) => {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export const ChatExport: React.FC = () => {
  const { toast } = useUiFeedback();
  const [startDate, setStartDate] = useState<string>(localToday());
  const [endDate, setEndDate] = useState<string>(localToday());
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<ExportFile[]>([]);

  const loadFiles = async () => {
    try {
      const res = await apiRequest('/api/admin/export/daily-chats/list');
      setFiles(res?.data || []);
    } catch (err: any) {
      console.warn('Gagal load daftar file ekspor:', err);
    }
  };

  useEffect(() => {
    loadFiles();
  }, []);

  const rangeDays = () => {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  };

  const generate = async (targetStart = startDate, targetEnd = endDate) => {
    if (!targetStart || !targetEnd) {
      toast('Pilih rentang tanggal terlebih dahulu.', 'error');
      return;
    }
    if (targetStart > targetEnd) {
      toast('Tanggal mulai harus sebelum atau sama dengan tanggal akhir.', 'error');
      return;
    }
    const days = Math.round(
      (new Date(`${targetEnd}T00:00:00`).getTime() - new Date(`${targetStart}T00:00:00`).getTime()) / 86400000
    ) + 1;
    if (days > 31) {
      toast('Rentang maksimal 31 hari. Persempit rentang tanggal.', 'error');
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest(
        `/api/admin/export/daily-chats?startDate=${targetStart}&endDate=${targetEnd}`,
        { timeoutMs: 120000 }
      );
      const data: ExportResultData = res?.data;
      if (!data?.content) {
        toast('Tidak ada percakapan pada rentang tanggal tersebut.', 'info');
        return;
      }
      if (data.stats.totalConversations === 0) {
        toast(
          `Rentang ${targetStart} s/d ${targetEnd} tidak ada percakapan customer REAL. Catatan: data QA/sandbox sengaja tidak diekspor. Coba pilih rentang lain yang ada percakapan aslinya.`,
          'info'
        );
        return;
      }
      downloadMarkdown(data.fileName, data.content);
      toast(
        `Ekspor ${data.fileName} berhasil: ${data.stats.totalConversations} percakapan, ${data.stats.totalMessages} pesan.`,
        'success'
      );
      loadFiles();
    } catch (err: any) {
      toast(err.message || 'Gagal men-generate ekspor chat.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const filesWithoutToday = (files || []).filter(
    (f) => f.date !== startDate || f.rangeEnd !== endDate
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-white flex items-center gap-2">
            <FileText className="text-pink-400" size={24} />
            <span>Daily Chat Export (Analisa AI)</span>
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Ekspor percakapan harian ke file Markdown terstruktur — mudah dibaca AI untuk menilai
            kualitas balasan bot vs balasan manusia.
          </p>
        </div>
        <button
          onClick={loadFiles}
          className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold text-slate-300 transition"
        >
          <RefreshCw size={14} />
          <span>Refresh Daftar</span>
        </button>
      </div>

      {/* Generate card */}
      <div className="rounded-2xl bg-slate-900/60 border border-white/10 p-6">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex-1">
            <label className="text-xs uppercase tracking-wider text-slate-400 font-bold flex items-center gap-1.5">
              <CalendarDays size={14} /> Rentang Tanggal Ekspor
            </label>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <div>
                <span className="block text-[10px] text-slate-500 mb-1">Dari</span>
                <input
                  type="date"
                  value={startDate}
                  max={endDate || localToday()}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full md:w-44 px-4 py-2.5 bg-slate-950/80 border border-white/10 rounded-xl text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-pink-500/40"
                />
              </div>
              <span className="text-slate-500 text-sm mt-4">s/d</span>
              <div>
                <span className="block text-[10px] text-slate-500 mb-1">Sampai</span>
                <input
                  type="date"
                  value={endDate}
                  max={localToday()}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full md:w-44 px-4 py-2.5 bg-slate-950/80 border border-white/10 rounded-xl text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-pink-500/40"
                />
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Semua pesan (pelanggan, BOT, dan staf manusia) pada rentang tersebut akan diekspor dalam satu file
              Markdown, maksimal 31 hari.{' '}
              <span className="text-amber-400/90">
                Hanya customer asli — data QA/sandbox (is_sandbox_test) tidak ikut diekspor.
              </span>
            </p>
          </div>
          <button
            onClick={() => generate()}
            disabled={loading}
            className="flex items-center justify-center gap-2 px-6 py-2.5 bg-pink-500 hover:bg-pink-600 disabled:opacity-50 rounded-xl text-xs font-bold text-white transition shadow shadow-pink-500/20"
          >
            <Download size={14} className={loading ? 'animate-pulse' : ''} />
            <span>{loading ? 'Memproses...' : 'Generate & Download .md'}</span>
          </button>
        </div>
      </div>

      {/* Tip analisa AI */}
      <div className="rounded-2xl bg-violet-500/5 border border-violet-500/20 p-5">
        <p className="text-xs text-violet-300/90 leading-relaxed flex items-start gap-2">
          <Sparkles size={14} className="mt-0.5 shrink-0" />
          <span>
            File dapat langsung di-upload ke AI (ChatGPT/Gemini/Claude) dengan prompt, contoh:{' '}
            <code className="text-violet-200 bg-violet-500/10 px-1.5 py-0.5 rounded">
              "Analisa transkrip ini, tandai balasan BOT yang kaku/tidak natural, bandingkan dengan
              balasan HUMAN_AGENT, dan sarankan perbaikan persona."
            </code>
          </span>
        </p>
      </div>

      {/* Recent files */}
      <div className="rounded-2xl bg-slate-900/60 border border-white/10 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 text-sm font-bold text-white flex items-center justify-between">
          <span className="flex items-center gap-2">
            <FileText size={16} className="text-pink-400" /> File Ekspor Tersimpan ({files?.length || 0})
          </span>
          <span className="text-xs text-slate-500">Folder: storage/exports (cron harian otomatis)</span>
        </div>
        {!files || files.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            Belum ada file ekspor tersimpan. Gunakan tombol di atas untuk generate manual, atau aktifkan
            <code className="text-slate-300 ml-1">ENABLE_CHAT_EXPORT_CRON=true</code> di server.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-white/10 bg-slate-950/40">
                  <th className="px-5 py-3 font-bold">Tanggal</th>
                  <th className="px-5 py-3 font-bold">File</th>
                  <th className="px-5 py-3 font-bold text-right">Ukuran</th>
                  <th className="px-5 py-3 font-bold text-right">Diperbarui</th>
                  <th className="px-5 py-3 font-bold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {(files || []).map((f) => (
                  <tr key={f.fileName} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3 font-mono text-xs text-slate-200 whitespace-nowrap">
                      {f.rangeEnd ? `${f.date} s/d ${f.rangeEnd}` : f.date}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-400 font-mono">{f.fileName}</td>
                    <td className="px-5 py-3 text-right text-xs text-slate-400">{formatBytes(f.sizeBytes)}</td>
                    <td className="px-5 py-3 text-right text-xs text-slate-500 whitespace-nowrap">
                      {new Date(f.updatedAt).toLocaleString('id-ID')}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => generate(f.date, f.rangeEnd || f.date)}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-pink-500/10 border border-pink-500/30 text-pink-400 hover:bg-pink-500/20 disabled:opacity-50 rounded-lg text-xs font-bold transition"
                      >
                        <Download size={12} />
                        <span>Download</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filesWithoutToday.length > 0 && (
          <div className="px-5 py-2.5 text-[11px] text-slate-600">
            File hari ini di-regenerate setiap kali halaman di-load supaya selalu aktual.
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatExport;