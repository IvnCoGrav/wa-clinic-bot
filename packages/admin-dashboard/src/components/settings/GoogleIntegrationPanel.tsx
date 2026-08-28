import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { ToggleSwitch } from '../common/ToggleSwitch';
import {
  Contact,
  Cloud,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Unlink,
  Save,
  Sparkles,
  ExternalLink,
  Info,
  Download,
  Upload,
  Calendar,
  HardDrive,
  Database,
  ShieldCheck,
  FileCheck
} from 'lucide-react';

interface GoogleStatus {
  isConfiguredOnPlatform: boolean;
  isConnected: boolean;
  isEnabled: boolean;
  connectedEmail: string | null;
  autoSyncOnChat: boolean;
  autoSyncOnReserve: boolean;
  namingTemplate: string;
  contactLabel: string | null;
  lastSyncedAt: string | null;
  totalSyncedCustomers: number;
}

interface BackupItem {
  id: string;
  name: string;
  sizeBytes: number;
  createdAt: string;
  source: 'local' | 'google_drive';
  webViewLink?: string;
}

export const GoogleIntegrationPanel: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'contacts' | 'backup'>('contacts');

  // Google Status State
  const [status, setStatus] = useState<GoogleStatus | null>(null);

  // Form states for Contacts
  const [namingTemplate, setNamingTemplate] = useState('{{name}} - {{child_name}}');
  const [contactLabel, setContactLabel] = useState('Pasien Klinik');
  const [autoSyncOnChat, setAutoSyncOnChat] = useState(true);
  const [autoSyncOnReserve, setAutoSyncOnReserve] = useState(true);
  const [isEnabled, setIsEnabled] = useState(true);

  // Backups State
  const [backups, setBackups] = useState<BackupItem[]>([]);

  // Action Loading States
  const [savingSettings, setSavingSettings] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [importingContacts, setImportingContacts] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [fetchingAuthUrl, setFetchingAuthUrl] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [uploadingToDrive, setUploadingToDrive] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await apiRequest<{ success: boolean; data: GoogleStatus }>(
        '/api/admin/integrations/google/status'
      );
      if (res.success && res.data) {
        setStatus(res.data);
        setNamingTemplate(res.data.namingTemplate || '{{name}} - {{child_name}}');
        setContactLabel(res.data.contactLabel || 'Pasien Klinik');
        setAutoSyncOnChat(res.data.autoSyncOnChat ?? true);
        setAutoSyncOnReserve(res.data.autoSyncOnReserve ?? true);
        setIsEnabled(res.data.isEnabled ?? true);
      }
    } catch (err: any) {
      console.warn('Gagal memuat status Google:', err?.message);
    }
  };

  const fetchBackups = async () => {
    try {
      const res = await apiRequest<{ success: boolean; data: { backups: BackupItem[] } }>(
        '/api/admin/backup/list'
      );
      if (res.success && res.data) {
        setBackups(res.data.backups || []);
      }
    } catch (err: any) {
      console.warn('Gagal memuat daftar backup:', err?.message);
    }
  };

  const loadAllData = async () => {
    setLoading(true);
    await Promise.all([fetchStatus(), fetchBackups()]);
    setLoading(false);
  };

  useEffect(() => {
    loadAllData();
  }, []);

  const handleConnectGoogle = async () => {
    try {
      setFetchingAuthUrl(true);
      const res = await apiRequest<{ success: boolean; data: { authUrl: string } }>(
        '/api/admin/integrations/google/auth-url'
      );

      if (res.success && res.data?.authUrl) {
        window.location.href = res.data.authUrl;
      } else {
        toast('Gagal mendapatkan URL login Google OAuth. Periksa konfigurasi server.', 'error');
      }
    } catch (err: any) {
      toast(err?.message || 'Koneksi ke server gagal.', 'error');
    } finally {
      setFetchingAuthUrl(false);
    }
  };

  const handleDisconnect = async () => {
    const isApproved = await confirm({
      title: 'Putuskan Akun Google?',
      message:
        'Fitur sinkronisasi Google Contacts dan Auto-Backup ke Google Drive akan dinonaktifkan hingga Anda menghubungkannya kembali. Lanjutkan?',
      confirmText: 'Ya, Putuskan',
      cancelText: 'Batal',
      danger: true,
    });

    if (!isApproved) return;

    try {
      setDisconnecting(true);
      const res = await apiRequest<{ success: boolean; message: string }>(
        '/api/admin/integrations/google/disconnect',
        { method: 'POST' }
      );

      if (res.success) {
        toast('Akun Google berhasil diputuskan.', 'info');
        loadAllData();
      } else {
        toast(res.message || 'Gagal memutuskan akun Google.', 'error');
      }
    } catch (err: any) {
      toast(err?.message || 'Terjadi kesalahan.', 'error');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSaveSettings = async () => {
    try {
      setSavingSettings(true);
      const res = await apiRequest<{ success: boolean; message: string }>(
        '/api/admin/integrations/google/settings',
        {
          method: 'PUT',
          body: JSON.stringify({
            namingTemplate,
            contactLabel,
            autoSyncOnChat,
            autoSyncOnReserve,
            isEnabled,
          }),
        }
      );

      if (res.success) {
        toast('Pengaturan Google Contacts berhasil disimpan.', 'success');
        fetchStatus();
      } else {
        toast(res.message || 'Gagal menyimpan pengaturan.', 'error');
      }
    } catch (err: any) {
      toast(err?.message || 'Terjadi kesalahan saat menyimpan.', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSyncAllCustomers = async () => {
    const isApproved = await confirm({
      title: 'Kirim Semua Pasien ke Google Contacts?',
      message:
        'Sistem akan mengirim/memperbarui seluruh data pasien di database ke buku kontak Google HP Anda dengan format penamaan yang dipilih. Lanjutkan?',
      confirmText: 'Ya, Kirim Sekarang',
      cancelText: 'Batal',
    });

    if (!isApproved) return;

    try {
      setSyncingAll(true);
      const res = await apiRequest<{
        success: boolean;
        message: string;
        data?: { total: number; synced: number; failed: number };
      }>('/api/admin/integrations/google/sync-all', { method: 'POST' });

      if (res.success) {
        toast(
          `Sinkronisasi selesai! Berhasil: ${res.data?.synced || 0}, Gagal: ${res.data?.failed || 0}.`,
          'success'
        );
        fetchStatus();
      } else {
        toast(res.message || 'Gagal menyinkronkan seluruh kontak.', 'error');
      }
    } catch (err: any) {
      toast(err?.message || 'Terjadi kesalahan saat sinkronisasi massal.', 'error');
    } finally {
      setSyncingAll(false);
    }
  };

  const handleImportContacts = async () => {
    const isApproved = await confirm({
      title: 'Tarik & Samakan Kontak dari Google?',
      message:
        'Sistem akan membaca seluruh kontak di akun Google/HP Anda. Nomor yang sudah ada akan ditautkan ID Google-nya, dan nomor baru akan dibuatkan data pasien. Lanjutkan?',
      confirmText: 'Ya, Tarik Sekarang',
      cancelText: 'Batal',
    });

    if (!isApproved) return;

    try {
      setImportingContacts(true);
      const res = await apiRequest<{
        success: boolean;
        message: string;
        data?: { totalGoogle: number; importedNew: number; linkedExisting: number };
      }>('/api/admin/integrations/google/import', { method: 'POST' });

      if (res.success) {
        toast(
          `Impor selesai! Total di Google: ${res.data?.totalGoogle || 0} | Ditautkan: ${res.data?.linkedExisting || 0} | Pasien Baru: ${res.data?.importedNew || 0}`,
          'success'
        );
        fetchStatus();
      } else {
        toast(res.message || 'Gagal menarik kontak dari Google.', 'error');
      }
    } catch (err: any) {
      toast(err?.message || 'Terjadi kesalahan saat menarik kontak.', 'error');
    } finally {
      setImportingContacts(false);
    }
  };

  const [uploadingBackupFile, setUploadingBackupFile] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.sql.gz') && !file.name.endsWith('.sql') && !file.name.endsWith('.json.gz')) {
      toast('Format file tidak didukung. Harap pilih file .sql.gz, .sql, atau .json.gz', 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const isApproved = await confirm({
      title: 'Konfirmasi Upload & Restore Database',
      message: `PERINGATAN: Anda memilih file "${file.name}" (${formatFileSize(file.size)}). Sistem akan mengunggah dan langsung MEMULIHKAN seluruh database klinik (pasien, reservasi, catalog, staff, AI config) dari file ini. Apakah Anda yakin ingin melanjutkan?`,
      confirmText: 'Ya, Upload & Pulihkan Sekarang',
      cancelText: 'Batal',
      danger: true,
    });

    if (!isApproved) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    try {
      setUploadingBackupFile(true);
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Data = reader.result as string;
          toast('Sedang mengunggah file backup ke server...', 'info');
          const uploadRes = await apiRequest<{
            success: boolean;
            message: string;
            data?: { fileName: string };
          }>('/api/admin/backup/upload-file', {
            method: 'POST',
            body: JSON.stringify({
              fileName: file.name,
              fileBase64: base64Data,
            }),
          });

          if (!uploadRes.success || !uploadRes.data?.fileName) {
            toast(uploadRes.message || 'Gagal mengunggah file backup.', 'error');
            setUploadingBackupFile(false);
            return;
          }

          // Langsung jalankan proses Restore
          toast('File terunggah. Memulai pemulihan database...', 'info');
          const restoreRes = await apiRequest<{
            success: boolean;
            message: string;
            data?: { tablesRestored: number };
          }>('/api/admin/backup/restore', {
            method: 'POST',
            body: JSON.stringify({ fileName: uploadRes.data.fileName }),
          });

          if (restoreRes.success) {
            toast(restoreRes.message || 'Database berhasil dipulihkan secara penuh!', 'success');
            fetchBackups();
            fetchStatus();
          } else {
            toast(restoreRes.message || 'Format file backup tidak sesuai.', 'error');
          }
        } catch (err: any) {
          toast(err?.message || 'Gagal memproses restore backup.', 'error');
        } finally {
          setUploadingBackupFile(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.onerror = () => {
        toast('Gagal membaca file dari komputer.', 'error');
        setUploadingBackupFile(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      toast(err?.message || 'Terjadi kesalahan saat upload.', 'error');
      setUploadingBackupFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
        toast('Backup Google Drive Berhasil! File tersimpan di folder Kala Clinic Bot Backups.', 'success');
        fetchBackups();
      } else {
        toast(res.message || 'Gagal mengunggah backup ke Google Drive.', 'error');
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
        fetchBackups();
        fetchStatus();
      } else {
        toast(res.message || 'Format file backup tidak sesuai.', 'error');
      }
    } catch (err: any) {
      toast(err?.message || 'Terjadi kesalahan sistem saat pemulihan.', 'error');
    } finally {
      setRestoring(false);
    }
  };

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

  const previewName = namingTemplate
    .replace('{{name}}', 'Bunda Maya')
    .replace('{{child_name}}', 'Baby Arka')
    .replace('{{phone}}', '+6281234567890')
    .replace('{{kelurahan}}', 'Mulyorejo')
    .replace('{{kecamatan}}', 'Mulyorejo')
    .replace('{{kota}}', 'Surabaya');

  return (
    <div className="bg-white rounded-2xl shadow-xs border border-[#e9edef] overflow-hidden">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".sql.gz,.sql,.gz,.json.gz"
        className="hidden"
      />
      {/* Header Utama Card */}
      <div className="p-5 sm:p-6 border-b border-[#e9edef] flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#f8fafc]">
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-emerald-50 text-[#008069] rounded-xl border border-emerald-200/80 shadow-xs">
            <Cloud className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-[#111b21]">Integrasi Akun Google &amp; Backup Database</h2>
              {status?.isConnected ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Terhubung ({status.connectedEmail})
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                  Google Belum Terhubung
                </span>
              )}
            </div>
            <p className="text-xs text-[#667781] mt-0.5">
              1 Akun Google untuk <strong>Google Contacts</strong> &amp; <strong>Google Drive</strong>, atau kelola <strong>Backup &amp; Restore Database</strong> secara mandiri.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!status?.isConnected ? (
            <button
              onClick={handleConnectGoogle}
              disabled={fetchingAuthUrl}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold shadow-xs transition-all disabled:opacity-50"
            >
              {fetchingAuthUrl ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>Hubungkan Akun Google</span>
            </button>
          ) : (
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-rose-200 text-rose-700 hover:bg-rose-50 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 shadow-xs"
            >
              {disconnecting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
              <span>Putuskan Akun</span>
            </button>
          )}
          <button
            onClick={loadAllData}
            disabled={loading}
            className="p-2 text-[#54656f] hover:text-[#111b21] hover:bg-[#f0f2f5] rounded-xl transition-colors border border-[#d1d7db] shadow-xs"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Body Card */}
      <div className="p-5 sm:p-6">
        {/* Tab Navigasi Sub-Layanan */}
        <div className="flex border-b border-[#e9edef] gap-4 sm:gap-6 text-xs sm:text-sm font-semibold mb-6 overflow-x-auto">
          <button
            onClick={() => setActiveTab('contacts')}
            className={`pb-3 flex items-center gap-2 transition-colors relative whitespace-nowrap ${
              activeTab === 'contacts'
                ? 'text-[#008069] font-bold border-b-2 border-[#008069]'
                : 'text-[#54656f] hover:text-[#111b21]'
            }`}
          >
            <Contact className="w-4 h-4" />
            <span>1. Google Contacts (Buku Telepon HP)</span>
            <span className="px-2 py-0.5 bg-[#f0f2f5] text-[#54656f] text-[11px] rounded-full">
              {status?.totalSyncedCustomers || 0} Pasien
            </span>
          </button>

          <button
            onClick={() => setActiveTab('backup')}
            className={`pb-3 flex items-center gap-2 transition-colors relative whitespace-nowrap ${
              activeTab === 'backup'
                ? 'text-[#008069] font-bold border-b-2 border-[#008069]'
                : 'text-[#54656f] hover:text-[#111b21]'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>2. Backup Database &amp; Restore</span>
            {status?.isConnected ? (
              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 text-[11px] rounded-full font-semibold border border-emerald-200">
                Drive Aktif
              </span>
            ) : (
              <span className="px-2 py-0.5 bg-[#f0f2f5] text-[#54656f] text-[11px] rounded-full font-medium">
                Lokal / Mandiri
              </span>
            )}
          </button>
        </div>

        {/* TAB 1: GOOGLE CONTACTS */}
        {activeTab === 'contacts' && (
          <div>
            {!status?.isConnected ? (
              <div className="bg-[#f8fafc] border border-[#e9edef] rounded-2xl p-8 text-center space-y-4 shadow-xs">
                <div className="w-14 h-14 bg-white rounded-2xl shadow-xs border border-[#e9edef] flex items-center justify-center mx-auto text-[#008069]">
                  <Contact className="w-7 h-7" />
                </div>
                <div className="max-w-md mx-auto space-y-1.5">
                  <h3 className="text-base font-bold text-[#111b21]">
                    Hubungkan Akun Google untuk Sinkronisasi Kontak
                  </h3>
                  <p className="text-xs text-[#667781] leading-relaxed">
                    Auto-save nama pasien, tag wilayah, dan nama anak ke buku telepon HP Anda secara otomatis saat customer chat atau reservasi.
                  </p>
                </div>

                <div className="pt-1">
                  <button
                    onClick={handleConnectGoogle}
                    disabled={fetchingAuthUrl}
                    className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#008069] hover:bg-[#00a884] text-white text-xs sm:text-sm font-semibold rounded-xl shadow-xs transition-all disabled:opacity-50"
                  >
                    {fetchingAuthUrl ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    <span>Hubungkan dengan Akun Google (1-Klik)</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Tombol Aksi Impor / Ekspor Kontak */}
                <div className="bg-[#f8fafc] border border-[#e9edef] rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xs">
                  <div className="space-y-0.5 text-center sm:text-left">
                    <h4 className="text-xs font-bold text-[#111b21]">Sinkronisasi Data Kontak Dua Arah</h4>
                    <p className="text-[11px] text-[#667781]">
                      Tarik kontak lama dari HP ke bot, atau kirim seluruh pasien database ke HP Anda.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-center">
                    <button
                      onClick={handleImportContacts}
                      disabled={importingContacts}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-[#f0f2f5] text-[#111b21] border border-[#d1d7db] text-xs font-semibold rounded-xl shadow-xs transition-colors disabled:opacity-50"
                    >
                      {importingContacts ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5 text-[#008069]" />}
                      <span>Tarik Kontak dari Google</span>
                    </button>
                    <button
                      onClick={handleSyncAllCustomers}
                      disabled={syncingAll}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#008069] hover:bg-[#00a884] text-white text-xs font-semibold rounded-xl shadow-xs transition-colors disabled:opacity-50"
                    >
                      {syncingAll ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      <span>Kirim Semua Pasien ke Google</span>
                    </button>
                  </div>
                </div>

                {/* Form Konfigurasi Format Nama */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[11px] font-bold text-[#111b21] mb-1.5">
                        Format Penamaan Kontak Google:
                      </label>
                      <input
                        type="text"
                        value={namingTemplate}
                        onChange={(e) => setNamingTemplate(e.target.value)}
                        placeholder="{{name}} - {{child_name}} ({{kelurahan}}, {{kecamatan}})"
                        className="w-full text-xs font-mono px-3.5 py-2 bg-white border border-[#d1d7db] rounded-xl text-[#111b21] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
                      />
                      <p className="text-[11px] text-[#667781] mt-1.5 leading-relaxed">
                        Tag tersedia: <code className="text-[#008069] bg-emerald-50 px-1 py-0.5 rounded font-mono font-bold">{"{{name}}"}</code>, <code className="text-[#008069] bg-emerald-50 px-1 py-0.5 rounded font-mono font-bold">{"{{child_name}}"}</code>, <code className="text-[#008069] bg-emerald-50 px-1 py-0.5 rounded font-mono font-bold">{"{{kelurahan}}"}</code>, <code className="text-[#008069] bg-emerald-50 px-1 py-0.5 rounded font-mono font-bold">{"{{kecamatan}}"}</code>, <code className="text-[#008069] bg-emerald-50 px-1 py-0.5 rounded font-mono font-bold">{"{{kota}}"}</code>, <code className="text-[#008069] bg-emerald-50 px-1 py-0.5 rounded font-mono font-bold">{"{{phone}}"}</code>.
                      </p>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-[#111b21] mb-1.5">
                        Label Grup Kontak di Google Contacts:
                      </label>
                      <input
                        type="text"
                        value={contactLabel}
                        onChange={(e) => setContactLabel(e.target.value)}
                        placeholder="Pasien Klinik"
                        className="w-full text-xs px-3.5 py-2 bg-white border border-[#d1d7db] rounded-xl text-[#111b21] focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069] shadow-xs"
                      />
                    </div>

                    {/* Auto-sync Switches */}
                    <div className="space-y-2.5 pt-2 border-t border-[#e9edef]">
                      <div className="flex items-center justify-between p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef]">
                        <div>
                          <span className="text-xs font-bold text-[#111b21] block">Auto-Sync Saat Chat Pertama (MQL)</span>
                          <span className="text-[11px] text-[#667781]">Simpan kontak otomatis saat chat masuk</span>
                        </div>
                        <ToggleSwitch
                          checked={autoSyncOnChat}
                          onChange={(next) => setAutoSyncOnChat(next)}
                          onLabel="ON (AKTIF)"
                          offLabel="OFF (NONAKTIF)"
                          size="md"
                        />
                      </div>

                      <div className="flex items-center justify-between p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef]">
                        <div>
                          <span className="text-xs font-bold text-[#111b21] block">Auto-Sync Saat Booking Reservasi</span>
                          <span className="text-[11px] text-[#667781]">Perbarui kontak saat reservasi dibuat</span>
                        </div>
                        <ToggleSwitch
                          checked={autoSyncOnReserve}
                          onChange={(next) => setAutoSyncOnReserve(next)}
                          onLabel="ON (AKTIF)"
                          offLabel="OFF (NONAKTIF)"
                          size="md"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Live Preview Box */}
                  <div className="space-y-3">
                    <label className="block text-[11px] font-bold text-[#111b21]">
                      Live Preview Nama Kontak di HP:
                    </label>
                    <div className="p-4 bg-[#f8fafc] border border-[#e9edef] rounded-2xl space-y-2.5 shadow-xs">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[#008069]">
                        <Contact className="w-4 h-4" />
                        <span>Buku Kontak Telepon HP</span>
                      </div>
                      <div className="p-3 bg-white rounded-xl border border-[#d1d7db] shadow-2xs space-y-1">
                        <div className="text-xs text-[#8696a0]">Nama Tampilan Kontak:</div>
                        <div className="text-sm font-bold text-[#111b21] font-mono">
                          {previewName || '(Nama Kosong)'}
                        </div>
                      </div>
                      <div className="text-[11px] text-[#54656f] flex items-center justify-between px-1">
                        <span>Nomor Telepon:</span>
                        <span className="font-semibold text-[#111b21]">+62 812-3456-7890</span>
                      </div>
                      <div className="text-[11px] text-[#54656f] flex items-center justify-between px-1">
                        <span>Grup Label Google:</span>
                        <span className="font-semibold text-[#111b21]">{contactLabel || 'Tidak ada label'}</span>
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        onClick={handleSaveSettings}
                        disabled={savingSettings}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-[#008069] hover:bg-[#00a884] text-white text-xs font-semibold rounded-xl shadow-xs transition-colors disabled:opacity-50"
                      >
                        {savingSettings ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        <span>Simpan Pengaturan Format</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: BACKUP DATABASE & RESTORE */}
        {activeTab === 'backup' && (
          <div className="space-y-6">
            {/* Action Bar Pembuatan & Upload Backup */}
            <div className="bg-[#f8fafc] border border-[#e9edef] rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-emerald-50 text-[#008069] border border-emerald-200 mt-0.5 shrink-0">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-[#111b21]">
                    {status?.isConnected ? 'Auto-Backup Google Drive & Backup Lokal' : 'Manajemen Backup Database (Lokal & Mandiri)'}
                  </h4>
                  <p className="text-[11px] text-[#667781] mt-0.5 leading-relaxed">
                    {status?.isConnected ? (
                      <>Database otomatis di-backup ke Google Drive setiap <strong>Senin pukul 02:00 WIB</strong> ke folder <code>📁 Kala Clinic Bot Backups</code>.</>
                    ) : (
                      <>Anda dapat membuat backup baru, mengunduh file <code>.sql.gz</code>, atau mengunggah file backup lama dari komputer untuk <strong>langsung di-restore</strong>.</>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingBackupFile || restoring}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-xl shadow-xs transition-colors disabled:opacity-50"
                  title="Upload file .sql.gz / .sql dan langsung pulihkan database"
                >
                  {uploadingBackupFile || restoring ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  <span>Upload &amp; Restore File</span>
                </button>
                {status?.isConnected ? (
                  <button
                    onClick={handleBackupToDrive}
                    disabled={uploadingToDrive}
                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-[#008069] hover:bg-[#00a884] text-white text-xs font-semibold rounded-xl shadow-xs transition-colors disabled:opacity-50"
                  >
                    {uploadingToDrive ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5" />}
                    <span>Backup ke Drive</span>
                  </button>
                ) : (
                  <button
                    onClick={handleConnectGoogle}
                    disabled={fetchingAuthUrl}
                    className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-semibold rounded-xl shadow-2xs transition-colors disabled:opacity-50"
                  >
                    {fetchingAuthUrl ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-[#008069]" />}
                    <span>Hubungkan Drive</span>
                  </button>
                )}
                <button
                  onClick={handleCreateAndDownload}
                  disabled={creatingBackup}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white hover:bg-[#f0f2f5] text-[#111b21] border border-[#d1d7db] text-xs font-semibold rounded-xl shadow-xs transition-colors disabled:opacity-50"
                >
                  {creatingBackup ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5 text-[#008069]" />}
                  <span>Unduh .sql.gz</span>
                </button>
              </div>
            </div>

            {/* Tabel Riwayat File Backup */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-[#111b21] flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-[#008069]" />
                  <span>Daftar File Backup Tersedia ({backups.length} file)</span>
                </h3>
                <button
                  onClick={fetchBackups}
                  className="text-[11px] text-[#008069] hover:underline font-semibold flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Refresh List</span>
                </button>
              </div>

              {backups.length === 0 ? (
                <div className="p-8 text-center text-[#54656f] bg-[#f8fafc] rounded-2xl border border-[#e9edef]">
                  <FileCheck className="w-8 h-8 mx-auto mb-2 text-[#8696a0]" />
                  <p className="text-xs font-semibold text-[#111b21]">Belum ada file backup di server</p>
                  <p className="text-[11px] text-[#667781] mt-0.5">
                    Klik tombol "Upload &amp; Restore File" untuk memulihkan dari file komputer Anda, atau "Unduh .sql.gz" untuk membuat backup baru.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto border border-[#e9edef] rounded-2xl shadow-xs">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#f8fafc] text-[#54656f] font-bold border-b border-[#e9edef]">
                      <tr>
                        <th className="py-3 px-4">Nama File Backup</th>
                        <th className="py-3 px-4">Tanggal Pembuatan</th>
                        <th className="py-3 px-4">Ukuran</th>
                        <th className="py-3 px-4">Penyimpanan</th>
                        <th className="py-3 px-4 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#e9edef] text-[#111b21] bg-white">
                      {backups.map((item) => (
                        <tr key={item.id} className="hover:bg-[#f8fafc] transition-colors">
                          <td className="py-3 px-4 font-mono font-medium text-[#111b21]">
                            {item.name}
                          </td>
                          <td className="py-3 px-4 text-[#54656f]">
                            {formatDate(item.createdAt)}
                          </td>
                          <td className="py-3 px-4 font-semibold text-[#111b21]">
                            {formatFileSize(item.sizeBytes)}
                          </td>
                          <td className="py-3 px-4">
                            {item.source === 'google_drive' ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                <Cloud className="w-3.5 h-3.5 text-emerald-600" />
                                Google Drive
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#f0f2f5] text-[#54656f] border border-[#d1d7db]">
                                <HardDrive className="w-3.5 h-3.5" />
                                Server Lokal
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                            {item.source === 'local' && (
                              <a
                                href={`/api/admin/backup/download/${item.name}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[#111b21] hover:bg-[#f0f2f5] bg-white rounded-lg border border-[#d1d7db] text-[11px] font-semibold transition-colors shadow-2xs"
                              >
                                <Download className="w-3 h-3 text-[#008069]" />
                                <span>Unduh</span>
                              </a>
                            )}
                            {item.webViewLink && (
                              <a
                                href={item.webViewLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[#008069] hover:bg-emerald-50 bg-emerald-50/50 rounded-lg border border-emerald-200 text-[11px] font-semibold transition-colors shadow-2xs"
                              >
                                <ExternalLink className="w-3 h-3" />
                                <span>Buka Drive</span>
                              </a>
                            )}
                            {item.source === 'local' && (
                              <button
                                onClick={() => handleRestore(item.name)}
                                disabled={restoring}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-rose-700 hover:bg-rose-100 bg-rose-50 rounded-lg border border-rose-200 text-[11px] font-semibold transition-colors disabled:opacity-50 shadow-2xs"
                              >
                                <Upload className="w-3 h-3" />
                                <span>Restore Database</span>
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
        )}
      </div>
    </div>
  );
};
