import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import {
  Contact,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Unlink,
  Save,
  Sparkles,
  ExternalLink,
  Info,
  Download
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

export const GoogleContactsPanel: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<GoogleStatus | null>(null);

  // Form states
  const [namingTemplate, setNamingTemplate] = useState('{{name}} - {{child_name}}');
  const [contactLabel, setContactLabel] = useState('Pasien Klinik');
  const [autoSyncOnChat, setAutoSyncOnChat] = useState(true);
  const [autoSyncOnReserve, setAutoSyncOnReserve] = useState(true);
  const [isEnabled, setIsEnabled] = useState(true);

  // Action states
  const [savingSettings, setSavingSettings] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [importingContacts, setImportingContacts] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [fetchingAuthUrl, setFetchingAuthUrl] = useState(false);

  const fetchStatus = async () => {
    try {
      setLoading(true);
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
      toast(err.message || 'Gagal memuat status integrasi Google Contacts.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleConnectGoogle = async () => {
    try {
      setFetchingAuthUrl(true);
      const res = await apiRequest<{ success: boolean; data?: { authUrl: string }; error?: string }>(
        '/api/admin/integrations/google/auth-url'
      );
      if (res.success && res.data?.authUrl) {
        window.location.href = res.data.authUrl;
      } else {
        toast(res.error || 'Gagal mendapatkan URL otorisasi Google.', 'error');
      }
    } catch (err: any) {
      toast(err.message || 'Terjadi kesalahan saat memulai autentikasi Google.', 'error');
    } finally {
      setFetchingAuthUrl(false);
    }
  };

  const handleSaveSettings = async () => {
    try {
      setSavingSettings(true);
      const res = await apiRequest<{ success: boolean; message?: string; error?: string }>(
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
        toast(res.error || 'Gagal menyimpan pengaturan Google Contacts.', 'error');
      }
    } catch (err: any) {
      toast(err.message || 'Terjadi kesalahan saat menyimpan pengaturan.', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleImportContacts = async () => {
    const confirmed = await confirm({
      title: 'Tarik & Samakan Kontak dari Google Contacts?',
      message:
        'Sistem akan menarik seluruh kontak yang ada di akun Google Contacts Anda dan menyelaraskannya dengan database pasien bot. Pasien yang sudah ada akan ditautkan, dan kontak baru akan ditambahkan ke database.',
      confirmText: 'Tarik Kontak Sekarang',
      cancelText: 'Batal',
    });

    if (!confirmed) return;

    try {
      setImportingContacts(true);
      const res = await apiRequest<{
        success: boolean;
        message?: string;
        data?: {
          totalFetched: number;
          newlyCreated: number;
          updatedExisting: number;
          skippedNoPhone: number;
        };
        error?: string;
      }>('/api/admin/integrations/google/import', {
        method: 'POST',
      });

      if (res.success) {
        toast(res.message || 'Berhasil menarik seluruh kontak dari Google Contacts.', 'success');
        fetchStatus();
      } else {
        toast(res.error || 'Terjadi kendala saat menarik kontak dari Google.', 'error');
      }
    } catch (err: any) {
      toast(err.message || 'Gagal menarik kontak dari Google Contacts.', 'error');
    } finally {
      setImportingContacts(false);
    }
  };

  const handleSyncAll = async () => {
    const confirmed = await confirm({
      title: 'Sinkronkan Semua Kontak?',
      message:
        'Sistem akan menyinkronkan seluruh database pelanggan ke Google Contacts di akun yang terhubung. Proses ini berjalan di background.',
      confirmText: 'Mulai Sinkronisasi',
      cancelText: 'Batal',
    });

    if (!confirmed) return;

    try {
      setSyncingAll(true);
      const res = await apiRequest<{
        success: boolean;
        message?: string;
        data?: { total: number; success: number; failed: number };
        error?: string;
      }>('/api/admin/integrations/google/sync-all', {
        method: 'POST',
      });

      if (res.success) {
        toast(res.message || 'Seluruh data kontak berhasil disinkronisasi ke Google Contacts.', 'success');
        fetchStatus();
      } else {
        toast(res.error || 'Terjadi kendala saat melakukan sinkronisasi kontak.', 'error');
      }
    } catch (err: any) {
      toast(err.message || 'Gagal melakukan sinkronisasi massal.', 'error');
    } finally {
      setSyncingAll(false);
    }
  };

  const handleDisconnect = async () => {
    const confirmed = await confirm({
      title: 'Putus Koneksi Google Contacts?',
      message:
        'Bot tidak akan lagi menyinkronkan kontak pasien baru ke akun Google ini. Anda dapat menghubungkannya kembali kapan saja.',
      confirmText: 'Putus Koneksi',
      cancelText: 'Batal',
      danger: true,
    });

    if (!confirmed) return;

    try {
      setDisconnecting(true);
      const res = await apiRequest<{ success: boolean; message?: string; error?: string }>(
        '/api/admin/integrations/google/disconnect',
        {
          method: 'POST',
        }
      );
      if (res.success) {
        toast(res.message || 'Koneksi akun Google berhasil diputus.', 'info');
        fetchStatus();
      } else {
        toast(res.error || 'Terjadi kesalahan saat memutus koneksi.', 'error');
      }
    } catch (err: any) {
      toast(err.message || 'Gagal memutus koneksi.', 'error');
    } finally {
      setDisconnecting(false);
    }
  };

  // Kalkulasi live preview format penamaan kontak
  const getLivePreview = () => {
    let preview = namingTemplate;
    preview = preview.replace(/{{\s*name\s*}}/gi, 'Bunda Alisa');
    preview = preview.replace(/{{\s*child_name\s*}}/gi, 'Rayyan');
    preview = preview.replace(/{{\s*phone\s*}}/gi, '+6281234567890');
    preview = preview.replace(/{{\s*kelurahan\s*}}/gi, 'Kalisari');
    preview = preview.replace(/{{\s*kecamatan\s*}}/gi, 'Mulyorejo');
    preview = preview.replace(/{{\s*(kota|city)\s*}}/gi, 'Surabaya');
    return preview.replace(/\s+/g, ' ').trim();
  };

  if (loading) {
    return (
      <div className="bg-white border border-[#e9edef] rounded-2xl p-6 shadow-xs flex items-center justify-center space-x-2 text-xs text-[#667781]">
        <RefreshCw className="animate-spin text-[#008069]" size={16} />
        <span>Memuat status integrasi Google Contacts...</span>
      </div>
    );
  }

  return (
    <div className="bg-white border border-[#e9edef] rounded-2xl p-6 space-y-6 shadow-xs">
      {/* Header Panel */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#f0f2f5] pb-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
            <Contact size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#111b21] flex items-center space-x-2">
              <span>Google Contacts Integration (Buku Kontak HP)</span>
              {status?.isConnected && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 size={10} className="mr-1" /> Terhubung
                </span>
              )}
            </h3>
            <p className="text-xs text-[#667781]">
              Otomatis simpan dan sinkronkan data kontak pasien WhatsApp ke Google Contacts di HP klinik.
            </p>
          </div>
        </div>

        {/* Status Badge & Disconnect */}
        {status?.isConnected && (
          <div className="flex items-center space-x-2">
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50"
            >
              <Unlink size={13} />
              <span>{disconnecting ? 'Memutus...' : 'Putus Akun'}</span>
            </button>
          </div>
        )}
      </div>

      {/* State 1: Belum Terhubung (1-Click Connect Button) */}
      {!status?.isConnected ? (
        <div className="bg-gradient-to-r from-blue-50/50 to-indigo-50/50 border border-blue-100 rounded-2xl p-6 text-center space-y-4">
          <div className="max-w-md mx-auto space-y-2">
            <h4 className="text-sm font-bold text-[#111b21]">
              Sambungkan Akun Google / Gmail Klinik Anda
            </h4>
            <p className="text-xs text-[#667781] leading-relaxed">
              Setelah terhubung, nama pasien yang chat dan melakukan reservasi akan otomatis muncul di buku telepon HP Anda tanpa perlu simpan manual satu per satu.
            </p>
          </div>

          <div className="pt-2">
            <button
              onClick={handleConnectGoogle}
              disabled={fetchingAuthUrl}
              className="inline-flex items-center space-x-2.5 px-5 py-2.5 bg-white hover:bg-gray-50 text-[#111b21] border border-gray-300 rounded-xl text-xs font-bold shadow-sm transition hover:shadow-md active:scale-98 disabled:opacity-50 cursor-pointer"
            >
              {/* Google G Logo SVG */}
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>{fetchingAuthUrl ? 'Membuka Google Login...' : 'Hubungkan dengan Akun Google'}</span>
              <ExternalLink size={13} className="text-gray-400" />
            </button>
          </div>

          <div className="flex items-center justify-center space-x-1.5 text-[11px] text-[#8696a0]">
            <Info size={12} />
            <span>Hanya memerlukan 1 kali klik izin kontak. Tanpa konfigurasi API yang rumit.</span>
          </div>
        </div>
      ) : (
        /* State 2: Sudah Terhubung (Pengaturan & Sinkronisasi) */
        <div className="space-y-6">
          {/* Akun Info Card */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-[#f8fafc] border border-[#e9edef] rounded-xl p-4">
            <div>
              <div className="text-[11px] font-semibold text-[#8696a0]">Akun Google Terhubung</div>
              <div className="text-xs font-bold text-[#111b21] truncate mt-0.5">
                {status.connectedEmail || 'Email Akun Terhubung'}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-[#8696a0]">Total Kontak Tersinkron</div>
              <div className="text-xs font-bold text-emerald-600 mt-0.5">
                {status.totalSyncedCustomers} Pasien
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-[#8696a0]">Sinkronisasi Terakhir</div>
              <div className="text-xs font-semibold text-[#111b21] mt-0.5">
                {status.lastSyncedAt
                  ? new Date(status.lastSyncedAt).toLocaleString('id-ID', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                  : 'Belum pernah sync'}
              </div>
            </div>
          </div>

          {/* Pengaturan Format Penamaan & Trigger */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Kolom Kiri: Template Penamaan */}
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-bold text-[#111b21] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                  <span>Format Penamaan Kontak</span>
                  <span className="text-[10px] font-normal text-[#8696a0]">
                    Tag: <code>{`{{name}}`}</code>, <code>{`{{child_name}}`}</code>, <code>{`{{kelurahan}}`}</code>, <code>{`{{kecamatan}}`}</code>, <code>{`{{kota}}`}</code>
                  </span>
                </label>
                <input
                  type="text"
                  value={namingTemplate}
                  onChange={(e) => setNamingTemplate(e.target.value)}
                  placeholder="{{name}} - {{child_name}} ({{kelurahan}}, {{kecamatan}})"
                  className="w-full bg-white border border-[#d1d7db] rounded-xl px-3 py-2 text-xs text-[#111b21] focus:outline-none focus:border-[#008069] shadow-xs"
                />
              </div>

              {/* Live Preview Box */}
              <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-xl p-3 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 flex items-center space-x-1">
                  <Sparkles size={11} />
                  <span>Preview Tampilan di Kontak HP:</span>
                </div>
                <div className="text-xs font-bold text-[#111b21] bg-white border border-emerald-100 rounded-lg px-2.5 py-1.5 shadow-2xs">
                  {getLivePreview()}
                </div>
              </div>
            </div>

            {/* Kolom Kanan: Otomatisasi & Triggers */}
            <div className="space-y-3">
              <div className="text-xs font-bold text-[#111b21]">Trigger Sinkronisasi Otomatis</div>

              <label className="flex items-center justify-between p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef] cursor-pointer hover:bg-gray-50 transition">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-[#111b21]">
                    Sinkron Otomatis (MQL / Chat Nama / Lokasi)
                  </div>
                  <div className="text-[11px] text-[#667781]">
                    Otomatis buat/update kontak saat prospek mencapai MQL, menyebut nama, atau mengirimkan lokasi kelurahan/kecamatan.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={autoSyncOnChat}
                  onChange={(e) => setAutoSyncOnChat(e.target.checked)}
                  className="w-4 h-4 text-[#008069] rounded focus:ring-[#008069] cursor-pointer ml-3"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl bg-[#f8fafc] border border-[#e9edef] cursor-pointer hover:bg-gray-50 transition">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-[#111b21]">
                    Sinkron Saat Reservasi Terbuat
                  </div>
                  <div className="text-[11px] text-[#667781]">
                    Update kontak dengan data treatment dan tanggal booking terbaru.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={autoSyncOnReserve}
                  onChange={(e) => setAutoSyncOnReserve(e.target.checked)}
                  className="w-4 h-4 text-[#008069] rounded focus:ring-[#008069] cursor-pointer ml-3"
                />
              </label>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-[#f0f2f5]">
            <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
              {/* Tombol Tarik Kontak dari Google (Inbound Sync) */}
              <button
                onClick={handleImportContacts}
                disabled={importingContacts || syncingAll}
                className="w-full sm:w-auto px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-xs font-semibold transition flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
              >
                <Download size={13} className={importingContacts ? 'animate-bounce' : ''} />
                <span>{importingContacts ? 'Menarik Kontak Google...' : '📥 Tarik & Samakan Kontak dari Google'}</span>
              </button>

              {/* Tombol Sinkronisasi Massal ke Google (Outbound Sync) */}
              <button
                onClick={handleSyncAll}
                disabled={syncingAll || importingContacts}
                className="w-full sm:w-auto px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-semibold transition flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw size={13} className={syncingAll ? 'animate-spin' : ''} />
                <span>{syncingAll ? 'Sedang Mengirim...' : '📤 Kirim Semua Pasien ke Google'}</span>
              </button>
            </div>

            {/* Tombol Simpan Pengaturan */}
            <button
              onClick={handleSaveSettings}
              disabled={savingSettings}
              className="w-full sm:w-auto px-5 py-2 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-semibold transition flex items-center justify-center space-x-1.5 disabled:opacity-50 shadow-xs cursor-pointer"
            >
              <Save size={13} />
              <span>{savingSettings ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
