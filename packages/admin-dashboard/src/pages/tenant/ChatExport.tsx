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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#e9edef]">
        <div>
          <h2 className="text-xl font-bold text-[#111b21] flex items-center gap-2">
            <FileText className="text-[#008069]" size={22} />
            <span>Daily Chat Export (Analisa AI)</span>
          </h2>
          <p className="text-xs text-[#667781] mt-0.5">
            Ekspor percakapan harian ke file Markdown terstruktur — mudah dibaca AI untuk menilai kualitas balasan bot vs balasan staf manusia.
          </p>
        </div>
        <button
          onClick={loadFiles}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-[#f0f2f5] border border-[#d1d7db] rounded-xl text-xs font-semibold text-[#111b21] transition shadow-xs self-start sm:self-auto"
        >
          <RefreshCw size={13} className="text-[#008069]" />
          <span>Refresh Daftar</span>
        </button>
      </div>

      {/* Generate card */}
      <div className="rounded-2xl bg-white border border-[#e9edef] p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex-1 space-y-2">
            <label className="text-[11px] uppercase font-bold text-[#111b21] flex items-center gap-1.5">
              <CalendarDays size={13} className="text-[#008069]" /> <span>Rentang Tanggal Ekspor</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="space-y-1">
                <span className="block text-[10px] text-[#8696a0]">Dari</span>
                <input
                  type="date"
                  value={startDate}
                  max={endDate || localToday()}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full md:w-44 px-3.5 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                />
              </div>
              <span className="text-[#8696a0] text-xs mt-4">s/d</span>
              <div className="space-y-1">
                <span className="block text-[10px] text-[#8696a0]">Sampai</span>
                <input
                  type="date"
                  value={endDate}
                  max={localToday()}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full md:w-44 px-3.5 py-2 bg-white border border-[#d1d7db] rounded-xl text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                />
              </div>
            </div>
            <p className="text-xs text-[#667781] mt-1">
              Semua pesan (pelanggan, BOT, dan staf) pada rentang tersebut akan diekspor dalam satu file
              Markdown, maksimal 31 hari.{' '}
              <span className="text-amber-700 font-medium">
                Hanya customer asli — data QA/sandbox tidak ikut diekspor.
              </span>
            </p>
          </div>
          <button
            onClick={() => generate()}
            disabled={loading}
            className="flex items-center justify-center gap-1.5 px-5 py-2.5 bg-[#008069] hover:bg-[#00a884] disabled:opacity-50 rounded-xl text-xs font-semibold text-white transition shadow-xs"
          >
            <Download size={13} className={loading ? 'animate-pulse' : ''} />
            <span>{loading ? 'Memproses...' : 'Generate & Download .md'}</span>
          </button>
        </div>
      </div>

      {/* Tip analisa AI */}
      <div className="rounded-2xl bg-purple-50 border border-purple-200 p-4 shadow-xs">
        <p className="text-xs text-purple-900 leading-relaxed flex items-start gap-2">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-purple-700" />
          <span>
            File dapat langsung di-upload ke AI (ChatGPT/Gemini/Claude) dengan prompt, contoh:{' '}
            <code className="text-purple-900 bg-purple-100 px-1.5 py-0.5 rounded font-mono text-[11px]">
              "Analisa transkrip ini, tandai balasan BOT yang kaku/tidak natural, bandingkan dengan
              balasan HUMAN_AGENT, dan sarankan perbaikan persona."
            </code>
          </span>
        </p>
      </div>

      {/* Recent files */}
      <div className="rounded-2xl bg-white border border-[#e9edef] overflow-hidden shadow-xs">
        <div className="px-5 py-3.5 border-b border-[#e9edef] bg-[#f8fafc] text-xs font-bold text-[#111b21] flex items-center justify-between">
          <span className="flex items-center gap-2">
            <FileText size={15} className="text-[#008069]" /> File Ekspor Tersimpan ({files?.length || 0})
          </span>
          <span className="text-xs text-[#8696a0]">Folder: storage/exports</span>
        </div>
        {!files || files.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#8696a0]">
            Belum ada file ekspor tersimpan. Gunakan tombol di atas untuk generate manual, atau aktifkan
            <code className="text-[#111b21] ml-1 font-mono">ENABLE_CHAT_EXPORT_CRON=true</code> di server.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] uppercase font-bold text-[#667781] border-b border-[#e9edef] bg-[#f8fafc]">
                  <th className="px-5 py-3">Tanggal</th>
                  <th className="px-5 py-3">File</th>
                  <th className="px-5 py-3 text-right">Ukuran</th>
                  <th className="px-5 py-3 text-right">Diperbarui</th>
                  <th className="px-5 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {(files || []).map((f) => (
                  <tr key={f.fileName} className="border-b border-[#e9edef] last:border-0 hover:bg-[#f8fafc] transition-colors">
                    <td className="px-5 py-3 font-mono text-xs text-[#111b21] whitespace-nowrap font-medium">
                      {f.rangeEnd ? `${f.date} s/d ${f.rangeEnd}` : f.date}
                    </td>
                    <td className="px-5 py-3 text-xs text-[#667781] font-mono">{f.fileName}</td>
                    <td className="px-5 py-3 text-right text-xs text-[#667781]">{formatBytes(f.sizeBytes)}</td>
                    <td className="px-5 py-3 text-right text-xs text-[#8696a0] whitespace-nowrap">
                      {new Date(f.updatedAt).toLocaleString('id-ID')}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => generate(f.date, f.rangeEnd || f.date)}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#e8f5f2] border border-[#c2e7e0] text-[#008069] hover:bg-[#d0ece7] disabled:opacity-50 rounded-lg text-xs font-semibold transition shadow-xs"
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
          <div className="px-5 py-2.5 text-[11px] text-[#8696a0] border-t border-[#e9edef] bg-[#f8fafc]">
            File hari ini di-regenerate setiap kali halaman di-load supaya selalu aktual.
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatExport;