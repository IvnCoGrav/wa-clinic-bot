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
  CheckCheck,
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
          <h1 className="text-xl font-bold text-ink tracking-tight flex items-center space-x-2">
            <Database className="text-accent" size={22} />
            <span>Migrasi & Seeding Riwayat Chat</span>
          </h1>
          <p className="text-xs text-ink-3 mt-0.5">
            Ekstrak data kontak, form reservasi, dan LTV dari database lokal ke antrean staging CRM.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={loadStagingData}
            disabled={loading}
            className="p-2 rounded-xl bg-surface border border-divider text-ink-2 hover:bg-fill-1 hover:text-ink transition shadow-xs disabled:opacity-50"
            title="Refresh antrean staging"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin text-accent' : ''} />
          </button>
        </div>
      </div>

      {/* Sync Status / Empty State Banners */}
      {syncStatus.isSyncing && (
        <div className="p-3.5 bg-warning-soft border border-warning-line rounded-2xl flex items-center justify-between text-xs text-warning animate-pulse">
          <div className="flex items-center space-x-2">
            <Loader className="animate-spin text-warning shrink-0" size={16} />
            <span>
              <strong>Sinkronisasi riwayat WhatsApp sedang berlangsung di latar belakang...</strong> Ekstraksi data
              dikunci sementara hingga sinkronisasi selesai agar data lengkap.
            </span>
          </div>
        </div>
      )}

      {!syncStatus.isSyncing && localStats.conversationCount === 0 && (
        <div className="p-4 bg-info-soft border border-info-line rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-info">
          <div>
            <p className="font-bold text-info">Database percakapan lokal masih kosong</p>
            <p className="text-info mt-0.5">
              Jalankan "Sync Riwayat WhatsApp" di Live Chat Monitor terlebih dahulu untuk menyedot chat ke database lokal.
            </p>
          </div>
          <a
            href="/admin/live-chat"
            className="px-3.5 py-1.5 bg-info hover:bg-info-hover text-on-solid rounded-xl font-bold transition shadow-xs whitespace-nowrap"
          >
            Buka Live Chat Monitor &rarr;
          </a>
        </div>
      )}

      {/* Control Banner Card */}
      <div className="bg-surface border border-divider rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          {/* Left info */}
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <FileText size={16} className="text-accent" />
              <h3 className="font-bold text-sm text-ink">Ekstraksi & Parsing Form Reservasi (Lokal)</h3>
            </div>
            <p className="text-xs text-ink-3 max-w-xl leading-relaxed">
              Ekstraktor memindai seluruh riwayat pesan di database lokal ({localStats.conversationCount} percakapan, {localStats.messageCount} pesan), mendeteksi form pemesanan layanan, nama anak/bayi, dan menghitung estimasi LTV pelanggan tanpa membebani WhatsApp.
            </p>
          </div>

          {/* Right action controls */}
          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-start lg:justify-end">
            <button
              onClick={handleRunExtraction}
              disabled={extracting || syncStatus.isSyncing || localStats.conversationCount === 0}
              className="px-4 py-2.5 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
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
              className="px-4 py-2.5 bg-info hover:bg-info-hover text-on-solid rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
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
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-fill-1 rounded-2xl w-fit text-xs">
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
                  ? 'bg-surface text-ink shadow-xs'
                  : 'text-ink-2 hover:text-ink'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  statusFilter === tab.key
                    ? 'bg-accent-soft text-accent'
                    : 'bg-fill-2 text-ink-3'
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
            className="px-3.5 py-2 bg-success hover:bg-success-hover text-on-solid rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
            title="Setujui seluruh kontak yang memiliki form reservasi & nilai transaksi sekaligus"
          >
            {bulkApproving ? <Loader size={13} className="animate-spin" /> : <CheckCheck size={13} />}
            <span>Approve Semua yang Ada Reservasi ({statusCounts.PENDING_WITH_RESERVATION})</span>
          </button>
        )}
      </div>

      {/* Sub-Filter, Search & Sorting Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        {/* Sub-Filter: Semua vs Pembeli vs Prospek */}
        <div className="flex items-center space-x-2 text-xs">
          <span className="text-[11px] font-semibold text-ink-3">Filter:</span>
          <div className="flex items-center space-x-1 bg-fill-1 p-0.5 rounded-xl">
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
                    ? 'bg-surface text-ink shadow-2xs font-bold'
                    : 'text-ink-2 hover:text-ink'
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" size={14} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama, HP, lokasi..."
              className="w-full pl-8 pr-3 py-1.5 bg-fill-1 focus:bg-surface border border-transparent focus:border-accent rounded-xl text-xs outline-none transition"
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
              className="px-2.5 py-1.5 bg-fill-1 border border-transparent focus:border-accent rounded-xl text-xs font-medium text-ink outline-none cursor-pointer"
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
      <div className="bg-surface border border-divider rounded-2xl overflow-hidden shadow-xs">
        {loading ? (
          <div className="flex justify-center items-center py-20">
            <Loader className="animate-spin text-accent" size={32} />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-ink-3 text-xs">
            <Database className="mx-auto text-ink-3 mb-2" size={32} />
            <p className="font-bold text-ink">Tidak ada data staging dengan status {statusFilter}</p>
            <p className="text-[11px] text-ink-3 mt-1">
              Klik tombol "Mulai Ekstraksi Chat" di atas untuk memindai room chat WhatsApp.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-divider bg-surface-2 text-ink-3 font-bold uppercase text-[10px] tracking-wider select-none">
                  {/* Sortable Header: Kontak */}
                  <th
                    onClick={() => handleSort('name')}
                    className="py-3 px-4 cursor-pointer hover:bg-fill-1 transition"
                    title="Klik untuk mengurutkan berdasarkan nama / kontak"
                  >
                    <div className="flex items-center space-x-1.5">
                      <span>Kontak / Customer</span>
                      {sortBy === 'name' ? (
                        sortOrder === 'asc' ? (
                          <ArrowUp size={12} className="text-accent" />
                        ) : (
                          <ArrowDown size={12} className="text-accent" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="text-ink-3 opacity-50 hover:opacity-100" />
                      )}
                    </div>
                  </th>

                  {/* Sortable Header: LTV */}
                  <th
                    onClick={() => handleSort('ltv')}
                    className="py-3 px-4 cursor-pointer hover:bg-fill-1 transition"
                    title="Klik untuk mengurutkan berdasarkan nominal LTV"
                  >
                    <div className="flex items-center space-x-1.5">
                      <span>LTV</span>
                      {sortBy === 'ltv' ? (
                        sortOrder === 'asc' ? (
                          <ArrowUp size={12} className="text-accent" />
                        ) : (
                          <ArrowDown size={12} className="text-accent" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="text-ink-3 opacity-50 hover:opacity-100" />
                      )}
                    </div>
                  </th>

                  {/* Sortable Header: Chat Pertama */}
                  <th
                    onClick={() => handleSort('leadCreatedAt')}
                    className="py-3 px-4 cursor-pointer hover:bg-fill-1 transition"
                    title="Klik untuk mengurutkan berdasarkan waktu pesan pertama"
                  >
                    <div className="flex items-center space-x-1.5">
                      <span>Chat Pertama</span>
                      {sortBy === 'leadCreatedAt' ? (
                        sortOrder === 'asc' ? (
                          <ArrowUp size={12} className="text-accent" />
                        ) : (
                          <ArrowDown size={12} className="text-accent" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="text-ink-3 opacity-50 hover:opacity-100" />
                      )}
                    </div>
                  </th>

                  {/* Sortable Header: Form Reservasi */}
                  <th
                    onClick={() => handleSort('firstPurchaseAt')}
                    className="py-3 px-4 cursor-pointer hover:bg-fill-1 transition"
                    title="Klik untuk mengurutkan berdasarkan waktu reservasi"
                  >
                    <div className="flex items-center space-x-1.5">
                      <span>Form Reservasi & Treatment</span>
                      {sortBy === 'firstPurchaseAt' ? (
                        sortOrder === 'asc' ? (
                          <ArrowUp size={12} className="text-accent" />
                        ) : (
                          <ArrowDown size={12} className="text-accent" />
                        )
                      ) : (
                        <ArrowUpDown size={11} className="text-ink-3 opacity-50 hover:opacity-100" />
                      )}
                    </div>
                  </th>

                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {items.map((item) => {
                  const res = item.extractedReservationJson;
                  const ltvValue = item.ltv ?? res?.payment?.totalPrice ?? (item.firstPurchaseAt ? 70000 : 0);
                  return (
                    <tr key={item.id} className="hover:bg-surface-2 transition">
                      {/* Kontak */}
                      <td className="py-3.5 px-4 font-medium">
                        <p className="font-bold text-ink">{item.name || 'Bunda Customer'}</p>
                        <p className="text-xs text-ink-3 font-mono mt-0.5">{item.phoneNumber}</p>
                        <span className="text-[10px] text-ink-3">
                          {item.rawMessagesCount} pesan tercatat
                        </span>
                      </td>

                      {/* LTV */}
                      <td className="py-3.5 px-4">
                        <div>
                          <p className="font-bold font-mono text-accent text-xs">
                            Rp {ltvValue.toLocaleString('id-ID')}
                          </p>
                          {res?.payment?.ongkir ? (
                            <p className="text-[10px] text-ink-3">
                              (ongkir Rp {res.payment.ongkir.toLocaleString('id-ID')})
                            </p>
                          ) : item.extractedLocation ? (
                            <p className="text-[10px] text-ink-3 truncate max-w-[130px]" title={item.extractedLocation}>
                              {item.extractedLocation}
                            </p>
                          ) : null}
                        </div>
                      </td>

                      {/* Chat Pertama */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-ink-2">
                        <p className="font-semibold text-ink">
                          {item.leadCreatedAt
                            ? new Date(item.leadCreatedAt).toLocaleDateString('id-ID', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })
                            : '-'}
                        </p>
                        <p className="text-[10px] text-ink-3">
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
                              <span className="px-1.5 py-0.5 rounded bg-accent-soft border border-divider text-accent text-[10px] font-bold">
                                {res.treatmentCategory || 'BABY'}
                              </span>
                              <span className="font-semibold text-ink truncate max-w-[160px]" title={res.treatmentDetail}>
                                {res.treatmentDetail || 'Layanan Spa'}
                              </span>
                            </div>
                            {res.bookingDate && (
                              <p className="text-[10px] text-ink-3 flex items-center space-x-1">
                                <Calendar size={10} />
                                <span>Jadwal: {new Date(res.bookingDate).toLocaleDateString('id-ID')}</span>
                              </p>
                            )}
                            {res.address && (
                              <p className="text-[10px] text-ink-3 truncate max-w-[200px]" title={res.address}>
                                Alamat: {res.address}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-ink-3 italic text-[11px]">Tidak ada form reservasi</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            item.status === 'APPROVED'
                              ? 'bg-success-soft text-success border border-success-line'
                              : item.status === 'COMMITTED'
                              ? 'bg-info-soft text-info border border-info-line'
                              : item.status === 'REJECTED'
                              ? 'bg-danger-soft text-danger border border-danger-line'
                              : 'bg-warning-soft text-warning border border-warning-line'
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
                            className="p-1.5 rounded-lg bg-fill-1 hover:bg-fill-2 text-ink-2 transition"
                            title="Lihat Histori Pesan Mentah"
                          >
                            <FileText size={13} />
                          </button>

                          {item.status === 'PENDING' && (
                            <>
                              <button
                                onClick={() => handleUpdateStatus(item.id, 'APPROVED')}
                                className="px-2.5 py-1 rounded-lg bg-success-soft hover:bg-success-line text-success border border-success-line text-xs font-semibold transition flex items-center space-x-1"
                                title="Setujui data ini untuk dimasukkan ke database"
                              >
                                <Check size={12} />
                                <span>Approve</span>
                              </button>

                              <button
                                onClick={() => handleUpdateStatus(item.id, 'REJECTED')}
                                className="px-2 py-1 rounded-lg bg-danger-soft hover:bg-danger-line text-danger border border-danger-line text-xs font-semibold transition"
                                title="Tolak data ini"
                              >
                                <X size={12} />
                              </button>
                            </>
                          )}

                          {item.status === 'APPROVED' && (
                            <button
                              onClick={() => handleUpdateStatus(item.id, 'PENDING')}
                              className="px-2 py-1 rounded-lg bg-surface border border-divider text-ink-2 text-xs font-semibold hover:bg-fill-1 transition"
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
            className="bg-surface border border-divider rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-divider bg-surface-2 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-sm text-ink">
                  Riwayat Pesan: {selectedRawItem.name || selectedRawItem.phoneNumber}
                </h3>
                <p className="text-[11px] text-ink-3">{selectedRawItem.phoneNumber}</p>
              </div>
              <button
                onClick={() => setSelectedRawItem(null)}
                className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-fill-2 transition"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-2.5 bg-surface-2 flex-1">
              {!selectedRawItem.rawMessagesJson || selectedRawItem.rawMessagesJson.length === 0 ? (
                <p className="text-center py-8 text-xs text-ink-3">Tidak ada pesan teks tersimpan.</p>
              ) : (
                selectedRawItem.rawMessagesJson.map((msg: any, idx: number) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl text-xs space-y-1 ${
                      msg.fromMe
                        ? 'bg-bubble-out text-ink ml-6 border border-accent/20'
                        : 'bg-surface text-ink mr-6 border border-divider shadow-2xs'
                    }`}
                  >
                    <div className="flex justify-between items-center text-[10px] text-ink-3">
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

            <div className="p-3 border-t border-divider bg-surface-2 flex justify-end">
              <button
                onClick={() => setSelectedRawItem(null)}
                className="px-4 py-2 bg-surface hover:bg-fill-2 border border-divider text-ink rounded-xl text-xs font-semibold transition shadow-xs"
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
