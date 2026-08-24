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
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Header Utama Card */}
      <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
        <div className="flex items-center gap-3.5">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-100/80 shadow-xs">
            <Cloud className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-800">Integrasi Akun Google</h2>
              {status?.isConnected ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Terhubung ({status.connectedEmail})
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Belum Terhubung
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              1 Akun Google untuk 2 Layanan Utama: <strong>Google Contacts</strong> (Buku Telepon HP) &amp; <strong>Google Drive</strong> (Auto-Backup Mingguan).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {status?.isConnected && (
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-rose-200 text-rose-600 hover:bg-rose-50 hover:border-rose-300 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {disconnecting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
              <span>Putuskan Akun</span>
            </button>
          )}
          <button
            onClick={loadAllData}
            disabled={loading}
            className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Body Card */}
      <div className="p-6">
        {/* KONDISI 1: JIKA BELUM TERHUBUNG GMAIL */}
        {!status?.isConnected ? (
          <div className="bg-gradient-to-br from-indigo-50/60 via-slate-50 to-blue-50/40 border border-indigo-100 rounded-2xl p-8 text-center space-y-5">
            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-indigo-100 flex items-center justify-center mx-auto text-indigo-600">
              <Cloud className="w-8 h-8" />
            </div>
            <div className="max-w-md mx-auto space-y-2">
              <h3 className="text-base font-bold text-slate-800">
                Hubungkan Akun Google Klinik Anda
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Hubungkan akun Google dalam 1 klik untuk langsung mengaktifkan 2 fitur otomatis:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left pt-2">
                <div className="p-3 bg-white rounded-xl border border-slate-200/80 shadow-2xs">
                  <div className="flex items-center gap-2 text-xs font-bold text-indigo-950">
                    <Contact className="w-4 h-4 text-indigo-600" />
                    <span>Google Contacts</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                    Auto-save pasien saat MQL &amp; reservasi dengan tag wilayah.
                  </p>
                </div>
                <div className="p-3 bg-white rounded-xl border border-slate-200/80 shadow-2xs">
                  <div className="flex items-center gap-2 text-xs font-bold text-indigo-950">
                    <Database className="w-4 h-4 text-indigo-600" />
                    <span>Google Drive Backup</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                    Auto-backup database mingguan setiap Senin pukul 02:00 WIB.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <button
                onClick={handleConnectGoogle}
                disabled={fetchingAuthUrl}
                className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-all hover:shadow-md disabled:opacity-50"
              >
                {fetchingAuthUrl ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                <span>🚀 Hubungkan dengan Akun Google (1-Klik)</span>
              </button>
            </div>
          </div>
        ) : (
          /* KONDISI 2: JIKA SUDAH TERHUBUNG GMAIL */
          <div className="space-y-6">
            {/* Tab Navigasi Sub-Layanan */}
            <div className="flex border-b border-slate-200 gap-6 text-sm font-medium">
              <button
                onClick={() => setActiveTab('contacts')}
                className={`pb-3 flex items-center gap-2 transition-colors relative ${
                  activeTab === 'contacts'
                    ? 'text-indigo-600 font-bold border-b-2 border-indigo-600'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Contact className="w-4 h-4" />
                <span>1. Google Contacts (Buku Telepon HP)</span>
                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[11px] rounded-full">
                  {status.totalSyncedCustomers} Pasien
                </span>
              </button>

              <button
                onClick={() => setActiveTab('backup')}
                className={`pb-3 flex items-center gap-2 transition-colors relative ${
                  activeTab === 'backup'
                    ? 'text-indigo-600 font-bold border-b-2 border-indigo-600'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Database className="w-4 h-4" />
                <span>2. Google Drive Auto-Backup &amp; Restore</span>
                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[11px] rounded-full font-semibold">
                  Mingguan Aktif
                </span>
              </button>
            </div>

            {/* TAB 1: GOOGLE CONTACTS */}
            {activeTab === 'contacts' && (
              <div className="space-y-6">
                {/* Tombol Aksi Impor / Ekspor Kontak */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="space-y-0.5 text-center sm:text-left">
                    <h4 className="text-xs font-bold text-slate-800">Sinkronisasi Data Kontak Dua Arah</h4>
                    <p className="text-[11px] text-slate-500">
                      Tarik kontak lama dari HP ke bot, atau kirim seluruh pasien database ke HP Anda.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-center">
                    <button
                      onClick={handleImportContacts}
                      disabled={importingContacts}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold rounded-lg shadow-2xs transition-colors disabled:opacity-50"
                    >
                      {importingContacts ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      <span>📥 Tarik Kontak dari Google</span>
                    </button>
                    <button
                      onClick={handleSyncAllCustomers}
                      disabled={syncingAll}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-semibold rounded-lg shadow-2xs transition-colors disabled:opacity-50"
                    >
                      {syncingAll ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      <span>📤 Kirim Semua Pasien ke Google</span>
                    </button>
                  </div>
                </div>

                {/* Form Konfigurasi Format Nama */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Format Penamaan Kontak Google:
                      </label>
                      <input
                        type="text"
                        value={namingTemplate}
                        onChange={(e) => setNamingTemplate(e.target.value)}
                        placeholder="{{name}} - {{child_name}} ({{kelurahan}}, {{kecamatan}})"
                        className="w-full text-xs font-mono px-3 py-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">
                        Tag tersedia: <code className="text-indigo-600">{"{{name}}"}</code>, <code className="text-indigo-600">{"{{child_name}}"}</code>, <code className="text-indigo-600">{"{{kelurahan}}"}</code>, <code className="text-indigo-600">{"{{kecamatan}}"}</code>, <code className="text-indigo-600">{"{{kota}}"}</code>, <code className="text-indigo-600">{"{{phone}}"}</code>.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Label Grup Kontak di Google Contacts:
                      </label>
                      <input
                        type="text"
                        value={contactLabel}
                        onChange={(e) => setContactLabel(e.target.value)}
                        placeholder="Pasien Klinik"
                        className="w-full text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>

                    {/* Auto-sync Switches */}
                    <div className="space-y-2.5 pt-2 border-t border-slate-200">
                      <div className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-slate-200">
                        <div>
                          <span className="text-xs font-bold text-slate-800 block">Auto-Sync Saat Chat Pertama (MQL)</span>
                          <span className="text-[11px] text-slate-500">Simpan kontak otomatis saat chat masuk</span>
                        </div>
                        <ToggleSwitch
                          checked={autoSyncOnChat}
                          onChange={(next) => setAutoSyncOnChat(next)}
                          variant="indigo"
                          onLabel="ON (AKTIF)"
                          offLabel="OFF (NONAKTIF)"
                          size="sm"
                        />
                      </div>

                      <div className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-slate-200">
                        <div>
                          <span className="text-xs font-bold text-slate-800 block">Auto-Sync Saat Booking Reservasi</span>
                          <span className="text-[11px] text-slate-500">Perbarui kontak saat reservasi dibuat</span>
                        </div>
                        <ToggleSwitch
                          checked={autoSyncOnReserve}
                          onChange={(next) => setAutoSyncOnReserve(next)}
                          variant="indigo"
                          onLabel="ON (AKTIF)"
                          offLabel="OFF (NONAKTIF)"
                          size="sm"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Live Preview Box */}
                  <div className="space-y-3">
                    <label className="block text-xs font-bold text-slate-700">
                      Live Preview Nama Kontak di HP:
                    </label>
                    <div className="p-4 bg-slate-900 text-white rounded-xl space-y-2 border border-slate-800">
                      <div className="flex items-center gap-2 text-[11px] text-slate-400">
                        <Contact className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Buku Kontak Google Phone</span>
                      </div>
                      <div className="text-sm font-semibold text-emerald-400 font-mono">
                        {previewName || '(Nama Kosong)'}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Nomor Telepon: <span className="text-slate-200">+62 812-3456-7890</span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Grup Label: <span className="text-slate-200">{contactLabel || 'Tidak ada label'}</span>
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        onClick={handleSaveSettings}
                        disabled={savingSettings}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50"
                      >
                        {savingSettings ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        <span>Simpan Pengaturan Format</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: GOOGLE DRIVE BACKUP */}
            {activeTab === 'backup' && (
              <div className="space-y-6">
                {/* Banner Jadwal Mingguan */}
                <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-100 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <Calendar className="w-5 h-5 text-indigo-600 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-bold text-indigo-950">Auto-Backup Mingguan Aktif</h4>
                      <p className="text-[11px] text-indigo-700 mt-0.5">
                        Database otomatis di-backup &amp; diunggah ke Google Drive setiap <strong>Senin pukul 02:00 WIB</strong> ke folder <code>📁 Kala Clinic Bot Backups</code> (Retensi 8 file terakhir / ~2 bulan).
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                      onClick={handleBackupToDrive}
                      disabled={uploadingToDrive}
                      className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50"
                    >
                      {uploadingToDrive ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5" />}
                      <span>Backup ke Drive Sekarang</span>
                    </button>
                    <button
                      onClick={handleCreateAndDownload}
                      disabled={creatingBackup}
                      className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50"
                    >
                      {creatingBackup ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      <span>📥 Unduh .sql.gz</span>
                    </button>
                  </div>
                </div>

                {/* Tabel Riwayat File Backup */}
                <div>
                  <h3 className="text-xs font-bold text-slate-800 mb-3 flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-slate-500" />
                    <span>Daftar File Backup Tersedia (Google Drive &amp; Server)</span>
                  </h3>

                  {backups.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 bg-slate-50 rounded-lg border border-slate-200">
                      <FileCheck className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                      <p className="text-xs font-semibold text-slate-700">Belum ada file backup di server</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Klik tombol "Unduh .sql.gz" atau "Backup ke Drive" di atas untuk membuat file backup pertama Anda.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                          <tr>
                            <th className="py-2.5 px-3.5">Nama File Backup</th>
                            <th className="py-2.5 px-3.5">Tanggal Pembuatan</th>
                            <th className="py-2.5 px-3.5">Ukuran</th>
                            <th className="py-2.5 px-3.5">Penyimpanan</th>
                            <th className="py-2.5 px-3.5 text-right">Aksi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-slate-700">
                          {backups.map((item) => (
                            <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                              <td className="py-2.5 px-3.5 font-mono font-medium text-slate-900">
                                {item.name}
                              </td>
                              <td className="py-2.5 px-3.5 text-slate-600">
                                {formatDate(item.createdAt)}
                              </td>
                              <td className="py-2.5 px-3.5 font-medium">
                                {formatFileSize(item.sizeBytes)}
                              </td>
                              <td className="py-2.5 px-3.5">
                                {item.source === 'google_drive' ? (
                                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <Cloud className="w-3 h-3" />
                                    Google Drive
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                                    <HardDrive className="w-3 h-3" />
                                    Server Lokal
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3.5 text-right space-x-1.5">
                                {item.source === 'local' && (
                                  <a
                                    href={`/api/admin/backup/download/${item.name}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 px-2 py-1 text-slate-700 hover:text-slate-900 hover:bg-slate-200 bg-slate-100 rounded border border-slate-300 text-[11px] font-medium transition-colors"
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
                                    className="inline-flex items-center gap-1 px-2 py-1 text-indigo-700 hover:text-indigo-900 hover:bg-indigo-100 bg-indigo-50 rounded border border-indigo-200 text-[11px] font-medium transition-colors"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    <span>Buka Drive</span>
                                  </a>
                                )}
                                {item.source === 'local' && (
                                  <button
                                    onClick={() => handleRestore(item.name)}
                                    disabled={restoring}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-rose-700 hover:text-rose-900 hover:bg-rose-100 bg-rose-50 rounded border border-rose-200 text-[11px] font-medium transition-colors disabled:opacity-50"
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
            )}
          </div>
        )}
      </div>
    </div>
  );
};
