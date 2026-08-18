import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { Pagination } from '../../components/common/Pagination';
import {
  Database,
  RefreshCw,
  Play,
  CheckCircle,
  FileText,
  MapPin,
  Calendar,
  Check,
  X,
  Loader,
  Sparkles,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';

interface StagingItem {
  id: string;
  tenantId: string;
  phoneNumber: string;
  name: string | null;
  extractedLocation: string | null;
  leadCreatedAt: string;
  firstPurchaseAt: string | null;
  extractedReservationJson: any | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMMITTED';
  rawMessagesCount: number;
  rawMessagesJson: any[];
  createdAt: string;
  updatedAt: string;
  ltv?: number;
}

const formatSafeTimestamp = (ts: any): string => {
  if (!ts) return '-';
  let num = typeof ts === 'string' && !isNaN(Number(ts)) ? Number(ts) : ts;
  if (typeof num === 'number') {
    if (num < 10000000000) {
      num = num * 1000;
    }
    const d = new Date(num);
    return isNaN(d.getTime()) ? '-' : d.toLocaleString('id-ID');
  }
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '-' : d.toLocaleString('id-ID');
};

export const ChatMigration: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<StagingItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'APPROVED' | 'COMMITTED' | 'REJECTED'>('COMMITTED');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Process States
  const [extracting, setExtracting] = useState(false);
  const [committing, setCommitting] = useState(false);

  const [statusCounts, setStatusCounts] = useState<{
    PENDING: number;
    APPROVED: number;
    COMMITTED: number;
    REJECTED: number;
    PENDING_WITH_RESERVATION?: number;
  }>({ PENDING: 0, APPROVED: 0, COMMITTED: 0, REJECTED: 0, PENDING_WITH_RESERVATION: 0 });

  // Sub-Filter: Semua vs Hanya yang Ada Reservasi (Pembeli) vs Hanya Prospek
  const [purchaseFilter, setPurchaseFilter] = useState<'ALL' | 'PURCHASED' | 'INQUIRY'>('ALL');
  const [bulkApproving, setBulkApproving] = useState(false);

  // Sorting & Search States
  const [sortBy, setSortBy] = useState<'leadCreatedAt' | 'firstPurchaseAt' | 'name' | 'phoneNumber' | 'rawMessagesCount' | 'ltv'>('leadCreatedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');

  const [syncStatus, setSyncStatus] = useState<{
    isSyncing: boolean;
    status?: string;
    syncedChats?: number;
    totalChats?: number;
  }>({ isSyncing: false });

  const [localStats, setLocalStats] = useState<{
    conversationCount: number;
    messageCount: number;
  }>({ conversationCount: 0, messageCount: 0 });

  // Raw Messages Modal
  const [selectedRawItem, setSelectedRawItem] = useState<StagingItem | null>(null);

  useEffect(() => {
    loadStagingData();
  }, [statusFilter, page, purchaseFilter, sortBy, sortOrder]);

  const handleSort = (field: 'leadCreatedAt' | 'firstPurchaseAt' | 'name' | 'phoneNumber' | 'rawMessagesCount' | 'ltv') => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder(field === 'name' || field === 'phoneNumber' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadStagingData();
  };

  const loadStagingData = async () => {
    setLoading(true);
    try {
      const hasResParam =
        purchaseFilter === 'PURCHASED'
          ? '&hasReservation=true'
          : purchaseFilter === 'INQUIRY'
          ? '&hasReservation=false'
          : '';
      const sortParam = `&sortBy=${sortBy}&sortOrder=${sortOrder}`;
      const searchParam = search.trim() ? `&search=${encodeURIComponent(search.trim())}` : '';

      const res = await apiRequest<{
        success: boolean;
        data: StagingItem[];
        total: number;
        page: number;
        totalPages: number;
        statusCounts?: {
          PENDING: number;
          APPROVED: number;
          COMMITTED: number;
          REJECTED: number;
          PENDING_WITH_RESERVATION?: number;
        };
        syncStatus?: {
          isSyncing: boolean;
          status?: string;
          syncedChats?: number;
          totalChats?: number;
        };
        localStats?: {
          conversationCount: number;
          messageCount: number;
        };
      }>(`/api/admin/migration/staging?status=${statusFilter}&page=${page}&limit=20${hasResParam}${sortParam}${searchParam}`);

      if (res && res.success) {
        setItems(res.data || []);
        setTotalPages(res.totalPages || 1);
        setTotalCount(res.total || 0);
        if (res.statusCounts) {
          setStatusCounts(res.statusCounts);
        }
        if (res.syncStatus) {
          setSyncStatus(res.syncStatus);
        }
        if (res.localStats) {
          setLocalStats(res.localStats);
        }
      }
    } catch (err: any) {
      toast('Gagal memuat data staging: ' + (err.message || 'Kesalahan jaringan'), 'error');
    } finally {
      setLoading(false);
    }
  };

  // Bulk Approve All Pending Contacts With Reservation Form
  const handleBulkApprovePurchases = async () => {
    const count = statusCounts.PENDING_WITH_RESERVATION || 0;
    if (count === 0) {
      toast('Tidak ada kontak dengan form reservasi di antrean Pending.', 'info');
      return;
    }

    const ok = await confirm({
      title: 'Setujui Semua Kontak yang Ada Reservasi?',
      message: `Sistem akan mengubah status seluruh ${count} kontak yang memiliki form reservasi dan nilai transaksi menjadi APPROVED secara otomatis.`,
      confirmText: `Setujui ${count} Data Pembeli`,
      cancelText: 'Batal',
    });

    if (!ok) return;

    setBulkApproving(true);
    try {
      const res = await apiRequest<{ success: boolean; count: number; message: string }>(
        '/api/admin/migration/staging/bulk-approve-purchases',
        {
          method: 'POST',
        }
      );

      if (res && res.success) {
        toast(res.message, 'success');
        loadStagingData();
      } else {
        toast('Gagal melakukan persetujuan massal.', 'error');
      }
    } catch (err: any) {
      toast('Gagal persetujuan massal: ' + err.message, 'error');
    } finally {
      setBulkApproving(false);
    }
  };

  // Trigger Chat Extraction from Local DB
  const handleRunExtraction = async () => {
    if (syncStatus.isSyncing) {
      toast('Sinkronisasi riwayat chat WhatsApp sedang berjalan. Harap tunggu hingga selesai.', 'error');
      return;
    }

    if (localStats.conversationCount === 0) {
      toast('Database lokal masih kosong. Silakan jalankan Sync Riwayat WhatsApp di Live Chat Monitor terlebih dahulu.', 'error');
      return;
    }

    const ok = await confirm({
      title: 'Mulai Ekstraksi Riwayat Chat Lokal?',
      message: `Sistem akan memindai seluruh ${localStats.conversationCount} percakapan di database lokal dan mengekstrak form reservasi ke antrean staging. Proses ini instan dan tidak membebani WhatsApp.`,
      confirmText: 'Mulai Ekstraksi',
      cancelText: 'Batal',
    });

    if (!ok) return;

    setExtracting(true);
    try {
      const res = await apiRequest<{ success: boolean; count: number; message: string; emptyDatabase?: boolean }>(
        '/api/admin/migration/extract',
        {
          method: 'POST',
        }
      );

      if (res && res.success) {
        toast(`Berhasil mengekstrak ${res.count} data kontak riwayat chat ke antrean staging.`, 'success');
        loadStagingData();
      } else {
        toast(res?.message || 'Gagal mengekstrak data percakapan.', 'error');
      }
    } catch (err: any) {
      toast('Gagal menjalankan ekstraksi: ' + (err.message || 'Kesalahan server'), 'error');
    } finally {
      setExtracting(false);
    }
  };

  // Update Status Staging (Approve/Reject)
  const handleUpdateStatus = async (id: string, newStatus: 'APPROVED' | 'REJECTED' | 'PENDING') => {
    try {
      const res = await apiRequest<{ success: boolean }>(
        `/api/admin/migration/staging/${id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: newStatus }),
        }
      );

      if (res && res.success) {
        toast(`Status kontak berhasil diubah menjadi ${newStatus}.`, 'success');
        setItems((prev) => prev.filter((it) => it.id !== id));
      }
    } catch (err: any) {
      toast('Gagal mengubah status: ' + err.message, 'error');
    }
  };

  // Commit Approved Records to Active DB
  const handleCommitApproved = async () => {
    const ok = await confirm({
      title: 'Commit Data yang Telah Disetujui?',
      message:
        'Semua kontak dengan status APPROVED akan disuntikkan ke database pelanggan utama sebagai status "legacy", beserta riwayat pesan dan data reservasi awalnya.',
      confirmText: 'Commit ke Database',
      cancelText: 'Batal',
    });

    if (!ok) return;

    setCommitting(true);
    try {
      const res = await apiRequest<{ success: boolean; committedCount: number; message?: string }>(
        '/api/admin/migration/commit',
        {
          method: 'POST',
        }
      );

      if (res && res.success) {
        toast(`Sukses menyuntikkan ${res.committedCount} kontak legacy ke database aktif!`, 'success');
        loadStagingData();
      } else {
        toast(res?.message || 'Gagal melakukan commit data ke database.', 'error');
      }
    } catch (err: any) {
      toast('Gagal melakukan commit: ' + err.message, 'error');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Description */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#111b21] tracking-tight flex items-center space-x-2">
            <Database className="text-[#008069]" size={22} />
            <span>Migrasi & Seeding Riwayat Chat</span>
          </h1>
          <p className="text-xs text-[#667781] mt-0.5">
            Ekstrak data kontak, form reservasi, dan LTV dari database lokal ke antrean staging CRM.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={loadStagingData}
            disabled={loading}
            className="p-2 rounded-xl bg-white border border-[#d1d7db] text-[#54656f] hover:bg-[#f0f2f5] hover:text-[#111b21] transition shadow-xs disabled:opacity-50"
            title="Refresh antrean staging"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin text-[#008069]' : ''} />
          </button>
        </div>
      </div>

      {/* Sync Status / Empty State Banners */}
      {syncStatus.isSyncing && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between text-xs text-amber-800 animate-pulse">
          <div className="flex items-center space-x-2">
            <Loader className="animate-spin text-amber-600 shrink-0" size={16} />
            <span>
              <strong>Sinkronisasi riwayat WhatsApp sedang berlangsung di latar belakang...</strong> Ekstraksi data
              dikunci sementara hingga sinkronisasi selesai agar data lengkap.
            </span>
          </div>
        </div>
      )}

      {!syncStatus.isSyncing && localStats.conversationCount === 0 && (
        <div className="p-4 bg-sky-50 border border-sky-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-sky-900">
          <div>
            <p className="font-bold text-sky-950">Database percakapan lokal masih kosong</p>
            <p className="text-sky-750 mt-0.5">
              Jalankan "Sync Riwayat WhatsApp" di Live Chat Monitor terlebih dahulu untuk menyedot chat ke database lokal.
            </p>
          </div>
          <a
            href="/admin/live-chat"
            className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-bold transition shadow-xs whitespace-nowrap"
          >
            Buka Live Chat Monitor &rarr;
          </a>
        </div>
      )}

      {/* Control Banner Card */}
      <div className="bg-white border border-[#e9edef] rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          {/* Left info */}
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <Sparkles size={16} className="text-[#008069]" />
              <h3 className="font-bold text-sm text-[#111b21]">Ekstraksi & Parsing Form Reservasi (Lokal)</h3>
            </div>
            <p className="text-xs text-[#667781] max-w-xl leading-relaxed">
              Ekstraktor memindai seluruh riwayat pesan di database lokal ({localStats.conversationCount} percakapan, {localStats.messageCount} pesan), mendeteksi form pemesanan layanan, nama anak/bayi, dan menghitung estimasi LTV pelanggan tanpa membebani WhatsApp.
            </p>
          </div>

          {/* Right action controls */}
          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-start lg:justify-end">
            <button
              onClick={handleRunExtraction}
              disabled={extracting || syncStatus.isSyncing || localStats.conversationCount === 0}
              className="px-4 py-2.5 bg-[#008069] hover:bg-[#00a884] text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
              title={
                syncStatus.isSyncing
                  ? 'Sinkronisasi sedang berjalan di latar belakang'
                  : localStats.conversationCount === 0
                  ? 'Database lokal masih kosong'
                  : 'Mulai ekstraksi instan dari database lokal'
              }
            >
              {extracting ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
              <span>{extracting ? 'Mengekstrak...' : 'Mulai Ekstraksi Chat'}</span>
            </button>

            <button
              onClick={handleCommitApproved}
              disabled={committing}
              className="px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
            >
              {committing ? <Loader size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              <span>{committing ? 'Menyimpan...' : 'Commit Data Approved'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filter Tabs & Bulk Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        {/* Status Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-[#f0f2f5] rounded-2xl w-fit text-xs">
          {[
            { key: 'COMMITTED', label: 'Selesai Masuk DB (Committed)', count: statusCounts.COMMITTED },
            { key: 'PENDING', label: 'Perlu Review (Pending)', count: statusCounts.PENDING },
            { key: 'APPROVED', label: 'Disetujui (Approved)', count: statusCounts.APPROVED },
            { key: 'REJECTED', label: 'Ditolak (Rejected)', count: statusCounts.REJECTED },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setStatusFilter(tab.key as any);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center space-x-1.5 ${
                statusFilter === tab.key
                  ? 'bg-white text-[#111b21] shadow-xs'
                  : 'text-[#54656f] hover:text-[#111b21]'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  statusFilter === tab.key
                    ? 'bg-[#e8f5f2] text-[#008069]'
                    : 'bg-[#e2e8f0] text-[#64748b]'
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Bulk Action for Pending with Reservation */}
        {statusFilter === 'PENDING' && (statusCounts.PENDING_WITH_RESERVATION || 0) > 0 && (
          <button
            onClick={handleBulkApprovePurchases}
            disabled={bulkApproving}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
            title="Setujui seluruh kontak yang memiliki form reservasi & nilai transaksi sekaligus"
          >
            {bulkApproving ? <Loader size={13} className="animate-spin" /> : <Sparkles size={13} />}
            <span>Approve Semua yang Ada Reservasi ({statusCounts.PENDING_WITH_RESERVATION})</span>
          </button>
        )}
      </div>

      {/* Sub-Filter, Search & Sorting Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        {/* Sub-Filter: Semua vs Pembeli vs Prospek */}
        <div className="flex items-center space-x-2 text-xs">
          <span className="text-[11px] font-semibold text-[#667781]">Filter:</span>
          <div className="flex items-center space-x-1 bg-[#f0f2f5] p-0.5 rounded-xl">
            {[
              { key: 'ALL', label: 'Semua Kontak' },
              { key: 'PURCHASED', label: '🎯 Pembeli (Ada Reservasi)' },
              { key: 'INQUIRY', label: '💬 Prospek Saja' },
            ].map((sub) => (
              <button
                key={sub.key}
                onClick={() => {
                  setPurchaseFilter(sub.key as any);
                  setPage(1);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                  purchaseFilter === sub.key
                    ? 'bg-white text-[#111b21] shadow-2xs font-bold'
                    : 'text-[#54656f] hover:text-[#111b21]'
                }`}
              >
                {sub.label}
              </button>
            ))}
          </div>
        </div>

        {/* Search & Sort Dropdown */}
        <div className="flex items-center space-x-2 w-full md:w-auto">
          {/* Search Box */}
          <form onSubmit={handleSearchSubmit} className="relative flex-1 md:w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0]" size={14} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama, HP, lokasi..."
              className="w-full pl-8 pr-3 py-1.5 bg-[#f0f2f5] focus:bg-white border border-transparent focus:border-[#008069] rounded-xl text-xs outline-none transition"
            />
          </form>

          {/* Quick Sort Dropdown */}
          <div className="flex items-center space-x-1 text-xs">
            <select
              value={`${sortBy}-${sortOrder}`}
              onChange={(e) => {
                const [f, o] = e.target.value.split('-');
                setSortBy(f as any);
                setSortOrder(o as any);
                setPage(1);
              }}
              className="px-2.5 py-1.5 bg-[#f0f2f5] border border-transparent focus:border-[#008069] rounded-xl text-xs font-medium text-[#111b21] outline-none cursor-pointer"
            >
              <option value="leadCreatedAt-desc">🕒 Chat Pertama: Terkini</option>
              <option value="leadCreatedAt-asc">🕒 Chat Pertama: Terlama</option>
              <option value="ltv-desc">💰 LTV: Tertinggi</option>
              <option value="ltv-asc">💰 LTV: Terendah</option>
              <option value="name-asc">🔤 Nama: A → Z</option>
              <option value="name-desc">🔤 Nama: Z → A</option>
              <option value="rawMessagesCount-desc">💬 Pesan: Terbanyak</option>
              <option value="rawMessagesCount-asc">💬 Pesan: Tersedikit</option>
              <option value="firstPurchaseAt-desc">🎯 Reservasi: Terkini</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table & Staging Content */}
      <div className="bg-white border border-[#e9edef] rounded-2xl overflow-hidden shadow-xs">
        {loading ? (
          <div className="flex justify-center items-center py-20">
            <Loader className="animate-spin text-[#008069]" size={32} />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-[#667781] text-xs">
            <Database className="mx-auto text-[#8696a0] mb-2" size={32} />
            <p className="font-bold text-[#111b21]">Tidak ada data staging dengan status {statusFilter}</p>
            <p className="text-[11px] text-[#8696a0] mt-1">
              Klik tombol "Mulai Ekstraksi Chat" di atas untuk memindai room chat WhatsApp.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#e9edef] bg-[#f8fafc] text-[#667781] font-bold uppercase text-[10px] tracking-wider select-none">
                  {/* Sortable Header: Kontak */}
                  <th
                    onClick={() => handleSort('name')}
                    className="py-3 px-4 cursor-pointer hover:bg-[#edf2f7] transition"
                    title="Klik untuk mengurutkan berdasarkan nama / kontak"
                  >
                    <div className="flex items-center space-x-1.5">
                      <span>Kontak / Customer</span>
                      {sortBy === 'name' ? (
                        sortOrder === 'asc' ? (
                          <ArrowUp size={12} className="text-[#008069]" />
                        ) : (
                          <ArrowDown size={12} className="text-[#008069]" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="text-[#a0aec0] opacity-50 hover:opacity-100" />
                      )}
                    </div>
                  </th>

                  {/* Sortable Header: LTV */}
                  <th
                    onClick={() => handleSort('ltv')}
                    className="py-3 px-4 cursor-pointer hover:bg-[#edf2f7] transition"
                    title="Klik untuk mengurutkan berdasarkan nominal LTV"
                  >
                    <div className="flex items-center space-x-1.5">
                      <span>LTV</span>
                      {sortBy === 'ltv' ? (
                        sortOrder === 'asc' ? (
                          <ArrowUp size={12} className="text-[#008069]" />
                        ) : (
                          <ArrowDown size={12} className="text-[#008069]" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="text-[#a0aec0] opacity-50 hover:opacity-100" />
                      )}
                    </div>
                  </th>

                  {/* Sortable Header: Chat Pertama */}
                  <th
                    onClick={() => handleSort('leadCreatedAt')}
                    className="py-3 px-4 cursor-pointer hover:bg-[#edf2f7] transition"
                    title="Klik untuk mengurutkan berdasarkan waktu pesan pertama"
                  >
                    <div className="flex items-center space-x-1.5">
                      <span>Chat Pertama</span>
                      {sortBy === 'leadCreatedAt' ? (
                        sortOrder === 'asc' ? (
                          <ArrowUp size={12} className="text-[#008069]" />
                        ) : (
                          <ArrowDown size={12} className="text-[#008069]" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="text-[#a0aec0] opacity-50 hover:opacity-100" />
                      )}
                    </div>
                  </th>

                  {/* Sortable Header: Form Reservasi */}
                  <th
                    onClick={() => handleSort('firstPurchaseAt')}
                    className="py-3 px-4 cursor-pointer hover:bg-[#edf2f7] transition"
                    title="Klik untuk mengurutkan berdasarkan waktu reservasi"
                  >
                    <div className="flex items-center space-x-1.5">
                      <span>Form Reservasi & Treatment</span>
                      {sortBy === 'firstPurchaseAt' ? (
                        sortOrder === 'asc' ? (
                          <ArrowUp size={12} className="text-[#008069]" />
                        ) : (
                          <ArrowDown size={12} className="text-[#008069]" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="text-[#a0aec0] opacity-50 hover:opacity-100" />
                      )}
                    </div>
                  </th>

                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e9edef]">
                {items.map((item) => {
                  const res = item.extractedReservationJson;
                  const ltvValue = item.ltv ?? res?.payment?.totalPrice ?? (item.firstPurchaseAt ? 70000 : 0);
                  return (
                    <tr key={item.id} className="hover:bg-[#f8fafc] transition">
                      {/* Kontak */}
                      <td className="py-3.5 px-4 font-medium">
                        <p className="font-bold text-[#111b21]">{item.name || 'Bunda Customer'}</p>
                        <p className="text-xs text-[#667781] font-mono mt-0.5">{item.phoneNumber}</p>
                        <span className="text-[10px] text-[#8696a0]">
                          {item.rawMessagesCount} pesan tercatat
                        </span>
                      </td>

                      {/* LTV */}
                      <td className="py-3.5 px-4">
                        <div>
                          <p className="font-bold font-mono text-[#008069] text-xs">
                            Rp {ltvValue.toLocaleString('id-ID')}
                          </p>
                          {res?.payment?.ongkir ? (
                            <p className="text-[10px] text-[#8696a0]">
                              (ongkir Rp {res.payment.ongkir.toLocaleString('id-ID')})
                            </p>
                          ) : item.extractedLocation ? (
                            <p className="text-[10px] text-[#8696a0] truncate max-w-[130px]" title={item.extractedLocation}>
                              {item.extractedLocation}
                            </p>
                          ) : null}
                        </div>
                      </td>

                      {/* Chat Pertama */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-[#54656f]">
                        <p className="font-semibold text-[#111b21]">
                          {item.leadCreatedAt
                            ? new Date(item.leadCreatedAt).toLocaleDateString('id-ID', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })
                            : '-'}
                        </p>
                        <p className="text-[10px] text-[#8696a0]">
                          {item.leadCreatedAt
                            ? new Date(item.leadCreatedAt).toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : ''}
                        </p>
                      </td>

                      {/* Form Reservasi & Treatment */}
                      <td className="py-3.5 px-4 max-w-xs">
                        {res ? (
                          <div className="space-y-1">
                            <div className="flex items-center space-x-1.5">
                              <span className="px-1.5 py-0.5 rounded bg-[#e8f5f2] border border-[#c2e7e0] text-[#008069] text-[10px] font-bold">
                                {res.treatmentCategory || 'BABY'}
                              </span>
                              <span className="font-semibold text-[#111b21] truncate max-w-[160px]" title={res.treatmentDetail}>
                                {res.treatmentDetail || 'Layanan Spa'}
                              </span>
                            </div>
                            {res.bookingDate && (
                              <p className="text-[10px] text-[#667781] flex items-center space-x-1">
                                <Calendar size={10} />
                                <span>Jadwal: {new Date(res.bookingDate).toLocaleDateString('id-ID')}</span>
                              </p>
                            )}
                            {res.address && (
                              <p className="text-[10px] text-[#8696a0] truncate max-w-[200px]" title={res.address}>
                                Alamat: {res.address}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-[#8696a0] italic text-[11px]">Tidak ada form reservasi</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            item.status === 'APPROVED'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              : item.status === 'COMMITTED'
                              ? 'bg-sky-100 text-sky-800 border border-sky-200'
                              : item.status === 'REJECTED'
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : 'bg-amber-100 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end space-x-1.5">
                          {/* Raw Messages Button */}
                          <button
                            onClick={() => setSelectedRawItem(item)}
                            className="p-1.5 rounded-lg bg-[#f0f2f5] hover:bg-[#e2e8f0] text-[#54656f] transition"
                            title="Lihat Histori Pesan Mentah"
                          >
                            <FileText size={13} />
                          </button>

                          {item.status === 'PENDING' && (
                            <>
                              <button
                                onClick={() => handleUpdateStatus(item.id, 'APPROVED')}
                                className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-semibold transition flex items-center space-x-1"
                                title="Setujui data ini untuk dimasukkan ke database"
                              >
                                <Check size={12} />
                                <span>Approve</span>
                              </button>

                              <button
                                onClick={() => handleUpdateStatus(item.id, 'REJECTED')}
                                className="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold transition"
                                title="Tolak data ini"
                              >
                                <X size={12} />
                              </button>
                            </>
                          )}

                          {item.status === 'APPROVED' && (
                            <button
                              onClick={() => handleUpdateStatus(item.id, 'PENDING')}
                              className="px-2 py-1 rounded-lg bg-white border border-[#d1d7db] text-[#54656f] text-xs font-semibold hover:bg-[#f0f2f5] transition"
                              title="Kembalikan ke status Pending"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {!loading && items.length > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            label={`Menampilkan ${items.length} dari total ${totalCount} record staging`}
          />
        )}
      </div>

      {/* Raw Messages Viewer Modal */}
      {selectedRawItem && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setSelectedRawItem(null)}
        >
          <div
            className="bg-white border border-[#e9edef] rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-[#e9edef] bg-[#f8fafc] flex justify-between items-center">
              <div>
                <h3 className="font-bold text-sm text-[#111b21]">
                  Riwayat Pesan: {selectedRawItem.name || selectedRawItem.phoneNumber}
                </h3>
                <p className="text-[11px] text-[#667781]">{selectedRawItem.phoneNumber}</p>
              </div>
              <button
                onClick={() => setSelectedRawItem(null)}
                className="p-1.5 rounded-lg text-[#8696a0] hover:text-[#111b21] hover:bg-[#e9edef] transition"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2.5 bg-[#f8fafc] flex-1">
              {!selectedRawItem.rawMessagesJson || selectedRawItem.rawMessagesJson.length === 0 ? (
                <p className="text-center py-8 text-xs text-[#8696a0]">Tidak ada pesan teks tersimpan.</p>
              ) : (
                selectedRawItem.rawMessagesJson.map((msg: any, idx: number) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl text-xs space-y-1 ${
                      msg.fromMe
                        ? 'bg-[#d9fdd3] text-[#111b21] ml-6 border border-[#00a884]/20'
                        : 'bg-white text-[#111b21] mr-6 border border-[#e9edef] shadow-2xs'
                    }`}
                  >
                    <div className="flex justify-between items-center text-[10px] text-[#667781]">
                      <span className="font-bold">{msg.fromMe ? 'Bot / Admin' : 'Customer'}</span>
                      {msg.timestamp && (
                        <span>{formatSafeTimestamp(msg.timestamp)}</span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.body}</p>
                  </div>
                ))
              )}
            </div>

            <div className="p-3 border-t border-[#e9edef] bg-[#f8fafc] flex justify-end">
              <button
                onClick={() => setSelectedRawItem(null)}
                className="px-4 py-2 bg-white hover:bg-[#e9edef] border border-[#d1d7db] text-[#111b21] rounded-xl text-xs font-semibold transition shadow-xs"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
