import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import {
  Database,
  Cloud,
  Download,
  Upload,
  RefreshCw,
  Clock,
  HardDrive,
  AlertTriangle,
  FileCheck,
  Calendar,
  ExternalLink
} from 'lucide-react';

interface BackupItem {
  id: string;
  name: string;
  sizeBytes: number;
  createdAt: string;
  source: 'local' | 'google_drive';
  webViewLink?: string;
}

export const DatabaseBackupPanel: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [loading, setLoading] = useState(true);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [uploadingToDrive, setUploadingToDrive] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const fetchBackups = async () => {
    try {
      setLoading(true);
      const res = await apiRequest<{ success: boolean; data: { backups: BackupItem[] } }>(
        '/api/admin/backup/list'
      );
      if (res.success && res.data) {
        setBackups(res.data.backups || []);
      }
    } catch (err: any) {
      console.warn('Gagal memuat riwayat backup:', err?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const handleCreateAndDownload = async () => {
    try {
      setCreatingBackup(true);
      const res = await apiRequest<{
        success: boolean;
        message: string;
        data: { fileName: string };
      }>('/api/admin/backup/create', {
        method: 'POST',
        body: JSON.stringify({ uploadToDrive: false }),
      });

      if (res.success && res.data?.fileName) {
        toast('Backup Berhasil Dibuat! Mengunduh file ke komputer...', 'success');

        // Trigger direct browser download
        const downloadUrl = `/api/admin/backup/download/${res.data.fileName}`;
        window.open(downloadUrl, '_blank');
        fetchBackups();
      } else {
        toast(res.message || 'Gagal membuat backup di server.', 'error');
      }
    } catch (err: any) {
      toast(err?.message || 'Gagal membuat backup.', 'error');
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleBackupToDrive = async () => {
    try {
      setUploadingToDrive(true);
      const res = await apiRequest<{
        success: boolean;
        message: string;
        data: { fileName: string; driveFile?: { id: string } };
      }>('/api/admin/backup/create', {
        method: 'POST',
        body: JSON.stringify({ uploadToDrive: true }),
      });

      if (res.success) {
        toast('Backup Google Drive Berhasil! File tersimpan di Google Drive.', 'success');
        fetchBackups();
      } else {
        toast(res.message || 'Pastikan akun Google sudah terhubung di Google Contacts.', 'error');
      }
    } catch (err: any) {
      toast(err?.message || 'Gagal upload backup ke Google Drive.', 'error');
    } finally {
      setUploadingToDrive(false);
    }
  };

  const handleRestore = async (fileName: string) => {
    const isApproved = await confirm({
      title: 'Konfirmasi Pemulihan Database',
      message: `PERINGATAN: Anda akan memulihkan database dari file backup "${fileName}". Data saat ini akan diselaraskan dengan data backup. Apakah Anda yakin ingin melanjutkan?`,
      confirmText: 'Ya, Pulihkan Sekarang',
      cancelText: 'Batal',
      danger: true,
    });

    if (!isApproved) return;

    try {
      setRestoring(true);
      const res = await apiRequest<{
        success: boolean;
        message: string;
        data?: { tablesRestored: number };
      }>('/api/admin/backup/restore', {
        method: 'POST',
        body: JSON.stringify({ fileName }),
      });

      if (res.success) {
        toast(res.message || 'Database berhasil dipulihkan dengan aman.', 'success');
      } else {
        toast(res.message || 'Format file backup tidak sesuai.', 'error');
      }
    } catch (err: any) {
      toast(err?.message || 'Terjadi kesalahan sistem saat pemulihan.', 'error');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header Panel */}
      <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Auto-Backup & Pemulihan Database</h2>
            <p className="text-sm text-slate-500">
              Backup otomatis mingguan ke Google Drive, unduh file `.sql.gz`, dan restore data aman.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchBackups}
            disabled={loading}
            className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200"
            title="Refresh Riwayat"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Banner Jadwal Mingguan */}
        <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-100 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Calendar className="w-5 h-5 text-indigo-600 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-indigo-950">Jadwal Auto-Backup Mingguan Aktif</h4>
              <p className="text-xs text-indigo-700 mt-0.5">
                Sistem otomatis membackup database dan mengunggahnya ke Google Drive setiap <strong>Senin pukul 02:00 WIB</strong> (Retensi 8 backup terakhir / ~2 bulan).
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={handleBackupToDrive}
              disabled={uploadingToDrive}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50"
            >
              {uploadingToDrive ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Cloud className="w-3.5 h-3.5" />
              )}
              <span>Backup ke Drive Sekarang</span>
            </button>
            <button
              onClick={handleCreateAndDownload}
              disabled={creatingBackup}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50"
            >
              {creatingBackup ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>📥 Unduh .sql.gz</span>
            </button>
          </div>
        </div>

        {/* Tabel Riwayat File Backup */}
        <div>
          <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-slate-500" />
            <span>Riwayat File Backup Tersedia</span>
          </h3>

          {loading ? (
            <div className="p-8 text-center text-slate-500 bg-slate-50 rounded-lg border border-slate-200">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-400" />
              <p className="text-xs">Memuat daftar file backup...</p>
            </div>
          ) : backups.length === 0 ? (
            <div className="p-8 text-center text-slate-500 bg-slate-50 rounded-lg border border-slate-200">
              <FileCheck className="w-8 h-8 mx-auto mb-2 text-slate-400" />
              <p className="text-sm font-medium text-slate-700">Belum ada file backup di server</p>
              <p className="text-xs text-slate-500 mt-1">
                Klik tombol "Unduh .sql.gz" atau "Backup ke Drive" di atas untuk membuat file backup pertama Anda.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Nama File Backup</th>
                    <th className="py-3 px-4">Tanggal Dibuat</th>
                    <th className="py-3 px-4">Ukuran</th>
                    <th className="py-3 px-4">Lokasi Penyimpanan</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  {backups.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-mono font-medium text-slate-900">
                        {item.name}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {formatDate(item.createdAt)}
                      </td>
                      <td className="py-3 px-4 font-medium">
                        {formatFileSize(item.sizeBytes)}
                      </td>
                      <td className="py-3 px-4">
                        {item.source === 'google_drive' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <Cloud className="w-3 h-3" />
                            Google Drive
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                            <HardDrive className="w-3 h-3" />
                            Server Lokal
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right space-x-2">
                        {item.source === 'local' && (
                          <a
                            href={`/api/admin/backup/download/${item.name}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-slate-700 hover:text-slate-900 hover:bg-slate-200 bg-slate-100 rounded border border-slate-300 font-medium transition-colors"
                          >
                            <Download className="w-3 h-3" />
                            <span>Unduh</span>
                          </a>
                        )}
                        {item.webViewLink && (
                          <a
                            href={item.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-indigo-700 hover:text-indigo-900 hover:bg-indigo-100 bg-indigo-50 rounded border border-indigo-200 font-medium transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span>Buka Drive</span>
                          </a>
                        )}
                        {item.source === 'local' && (
                          <button
                            onClick={() => handleRestore(item.name)}
                            disabled={restoring}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-rose-700 hover:text-rose-900 hover:bg-rose-100 bg-rose-50 rounded border border-rose-200 font-medium transition-colors disabled:opacity-50"
                          >
                            <Upload className="w-3 h-3" />
                            <span>Restore</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
