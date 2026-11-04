import React, { useEffect, useState, useCallback } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import {
  UserCheck,
  Calendar,
  Award,
  ChevronDown,
  ChevronUp,
  Download,
  RefreshCw,
  Users,
  ShieldCheck,
  AlertCircle,
  Clock,
  X,
  ExternalLink,
  Lock,
  ArrowRight,
  HelpCircle,
} from 'lucide-react';

interface StaffRetentionReportItem {
  staffId: string | null;
  staffName: string;
  cohortN: number;
  retainedN: number;
  retentionPct: number | null;
  benchmarkPct: number;
  retentionIndex: number | null;
  rawTier: 1 | 2 | 3 | null;
  finalTier: 1 | 2 | 3 | null;
  splitPct: number;
  status: 'OK' | 'INSUFFICIENT_SAMPLE' | 'SKIPPED';
  skipReason: string | null;
  downgradeStreak: number;
}

interface StaffRetentionReport {
  tenantId: string;
  periodYear: number;
  periodMonth: number;
  asOf: string;
  windowDays: number;
  poolStart: string;
  poolEnd: string;
  benchmarkPct: number;
  status: 'DRAFT' | 'PREVIEW' | 'FINAL';
  formulaVersion: string;
  items: StaffRetentionReportItem[];
}

interface DrilldownCustomerItem {
  customerId: string;
  customerName: string;
  customerPhone: string;
  firstVisitDate: string;
  lastVisitDate: string;
  totalVisits: number;
  isRetained: boolean;
  sameStaffVisits: number;
  otherStaffVisits: number;
}

interface RetentionTabProps {
  year: number;
  month: number;
}

export const RetentionTab: React.FC<RetentionTabProps> = ({ year, month }) => {
  const { toast, confirm } = useUiFeedback();
  const [loading, setLoading] = useState<boolean>(true);
  const [report, setReport] = useState<StaffRetentionReport | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<StaffRetentionReportItem | null>(null);
  const [drilldownLoading, setDrilldownLoading] = useState<boolean>(false);
  const [drilldownList, setDrilldownList] = useState<DrilldownCustomerItem[]>([]);
  const [showMethodNotes, setShowMethodNotes] = useState<boolean>(false);
  const [freezing, setFreezing] = useState<boolean>(false);

  // Fetch report data
  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ success: boolean; data: StaffRetentionReport }>(
        `/api/admin/staff-retention?year=${year}&month=${month}`
      );
      if (res.success && res.data) {
        setReport(res.data);
      }
    } catch (err: any) {
      toast(err.message || 'Gagal memuat data retensi staf.', 'error');
    } finally {
      setLoading(false);
    }
  }, [year, month, toast]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Open drilldown drawer for a staff member
  const handleOpenDrilldown = async (item: StaffRetentionReportItem) => {
    setSelectedStaff(item);
    setDrilldownLoading(true);
    setDrilldownList([]);
    try {
      const staffQuery = item.staffId ? `&staff_id=${item.staffId}` : '';
      const res = await apiRequest<{ success: boolean; data: DrilldownCustomerItem[] }>(
        `/api/admin/staff-retention/drilldown?year=${year}&month=${month}${staffQuery}`
      );
      if (res.success && res.data) {
        setDrilldownList(res.data);
      }
    } catch (err: any) {
      toast(err.message || 'Gagal memuat rincian pasien kohort.', 'error');
    } finally {
      setDrilldownLoading(false);
    }
  };

  // Close drilldown
  const handleCloseDrilldown = () => {
    setSelectedStaff(null);
    setDrilldownList([]);
  };

  // Freeze snapshot modal & action
  const handleFreezeSnapshot = async (targetStatus: 'PREVIEW' | 'FINAL') => {
    const isFinal = targetStatus === 'FINAL';
    const ok = await confirm({
      title: isFinal ? 'Kunci Snapshot FINAL Payroll?' : 'Simpan Snapshot PREVIEW?',
      message: isFinal
        ? `Snapshot FINAL untuk periode ${year}-${String(month).padStart(2, '0')} akan dibekukan sebagai dasar payroll. Data ini tidak akan dihitung ulang secara otomatis.`
        : `Snapshot PREVIEW periode ${year}-${String(month).padStart(2, '0')} akan disimpan untuk masa sanggahan dan review bidan.`,
      confirmText: isFinal ? 'Ya, Kunci Final' : 'Ya, Simpan Preview',
      danger: isFinal,
    });

    if (!ok) return;

    setFreezing(true);
    try {
      const res = await apiRequest<{ success: boolean; message: string; data: StaffRetentionReport }>(
        '/api/admin/staff-retention/snapshot',
        {
          method: 'POST',
          body: JSON.stringify({
            year,
            month,
            status: targetStatus,
          }),
        }
      );
      if (res.success) {
        toast(res.message || 'Snapshot berhasil dibekukan.', 'success');
        setReport(res.data);
      }
    } catch (err: any) {
      toast(err.message || 'Gagal menyimpan snapshot retensi.', 'error');
    } finally {
      setFreezing(false);
    }
  };

  // Export CSV of retention table
  const handleExportCsv = () => {
    if (!report || !report.items.length) {
      toast('Tidak ada data untuk diekspor.', 'info');
      return;
    }

    const headers = [
      'Bidan / Staf',
      'Kohort (n)',
      'Repeat',
      'Retensi (%)',
      'Benchmark (%)',
      'Indeks Retensi',
      'Tingkat (Tier)',
      'Split (%)',
      'Status',
      'Catatan',
    ];

    const rows = report.items.map((item) => [
      `"${item.staffName}"`,
      item.cohortN,
      item.retainedN,
      item.retentionPct !== null ? `${item.retentionPct}%` : '-',
      `${item.benchmarkPct}%`,
      item.retentionIndex !== null ? item.retentionIndex : '-',
      item.finalTier ? `Tier ${item.finalTier}` : '-',
      `${item.splitPct}%`,
      item.status,
      `"${item.skipReason || ''}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rekap-retensi-bidan-${year}-${String(month).padStart(2, '0')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const maskName = (name: string): string => {
    if (!name) return 'Bunda ***';
    const parts = name.trim().split(' ');
    if (parts.length === 1) {
      return parts[0].length > 3 ? `${parts[0].slice(0, 3)}***` : `${parts[0]}*`;
    }
    return `${parts[0]} ${parts[1].slice(0, 1)}***`;
  };

  const maskPhone = (phone: string): string => {
    if (!phone) return '08***';
    if (phone.includes('*')) return phone;
    if (phone.length < 7) return '08***';
    return `${phone.slice(0, 4)}****${phone.slice(-3)}`;
  };

  return (
    <div className="space-y-6">
      {/* 1. Header Banner: Status Periode & Kontrak Parameter */}
      <div className="bg-surface p-5 rounded-2xl border border-divider shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-bold text-ink">Skema Insentif Retensi Pasien 60 Hari</h2>
            {report && (
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider ${
                  report.status === 'FINAL'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                    : report.status === 'PREVIEW'
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                    : 'bg-fill-2 text-ink-2 border border-divider'
                }`}
              >
                {report.status === 'FINAL'
                  ? 'FINAL (TERKUNCI PAYROLL)'
                  : report.status === 'PREVIEW'
                  ? 'PREVIEW (MASA REVIEW)'
                  : 'DRAFT (INDIKATIF)'}
              </span>
            )}
          </div>
          {report && (
            <p className="text-xs text-ink-2 mt-1">
              Pool 6 Bulan Bergulir:{' '}
              <span className="font-semibold text-ink">
                {report.poolStart} s/d {report.poolEnd}
              </span>{' '}
              · Window Evaluasi: <span className="font-semibold text-ink">60 Hari</span> · Benchmark
              Klinik: <span className="font-semibold text-ink">{report.benchmarkPct}%</span>
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleFreezeSnapshot('PREVIEW')}
            disabled={freezing || loading}
            className="px-3 py-1.5 rounded-xl bg-surface border border-divider text-xs font-bold text-ink hover:bg-fill-1 transition shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Simpan angka snapshot preview untuk review bidan"
          >
            <Clock size={14} className="text-amber-500 dark:text-amber-400" />
            <span>Simpan Preview</span>
          </button>

          <button
            onClick={() => handleFreezeSnapshot('FINAL')}
            disabled={freezing || loading}
            className="px-3 py-1.5 rounded-xl bg-accent text-accent-ink text-xs font-bold hover:brightness-105 transition shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Kunci angka final untuk payroll"
          >
            <Lock size={14} />
            <span>Kunci Final Payroll</span>
          </button>

          <button
            onClick={handleExportCsv}
            disabled={loading || !report?.items.length}
            className="p-2 rounded-xl bg-surface border border-divider text-ink-2 hover:text-ink hover:bg-fill-1 transition shadow-xs cursor-pointer disabled:opacity-50"
            title="Unduh Rekap CSV"
          >
            <Download size={15} />
          </button>

          <button
            onClick={fetchReport}
            disabled={loading}
            className="p-2 rounded-xl bg-surface border border-divider text-ink-2 hover:text-ink hover:bg-fill-1 transition shadow-xs cursor-pointer disabled:opacity-50"
            title="Muat Ulang"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin text-accent' : ''} />
          </button>
        </div>
      </div>

      {/* 2. Tabel Peringkat & Performa Retensi */}
      <div className="bg-surface rounded-2xl border border-divider shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-divider flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Award size={18} className="text-accent" />
            <h3 className="font-bold text-ink text-base">Hasil Evaluasi Insentif per Bidan</h3>
          </div>
          <span className="text-xs text-ink-2">
            Ambang Tingkat: &lt;31,1% (50%) · 31,1–38,1% (55%) · ≥38,1% (60%)
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-ink-2">
            <RefreshCw size={24} className="animate-spin mx-auto text-accent mb-2" />
            <p className="text-sm">Menghitung analitik kohort retensi...</p>
          </div>
        ) : !report || report.items.length === 0 ? (
          <div className="p-12 text-center text-ink-2">
            <AlertCircle size={28} className="mx-auto text-amber-500 dark:text-amber-400 mb-2 opacity-80" />
            <p className="text-sm font-semibold">Belum ada data kunjungan valid pada periode ini.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-fill-1 text-ink-2 font-bold text-xs uppercase border-b border-divider">
                <tr>
                  <th className="py-3 px-4">Bidan / Staf</th>
                  <th className="py-3 px-4 text-center">Kohort (n)</th>
                  <th className="py-3 px-4 text-center">Repeat (≤60h)</th>
                  <th className="py-3 px-4 text-center">Retensi (%)</th>
                  <th className="py-3 px-4 text-center">Indeks</th>
                  <th className="py-3 px-4 text-center">Tingkat</th>
                  <th className="py-3 px-4 text-center">Split Hasil</th>
                  <th className="py-3 px-4">Status & Kelayakan</th>
                  <th className="py-3 px-4 text-right">Rincian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider font-medium">
                {report.items.map((item, idx) => {
                  const isParticipant = item.status === 'OK';
                  const isInsufficient = item.status === 'INSUFFICIENT_SAMPLE';

                  return (
                    <tr
                      key={item.staffId ?? `unassigned-${idx}`}
                      className="hover:bg-fill-1/50 transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center space-x-2.5">
                          <div className="h-8 w-8 rounded-full bg-accent/15 text-accent flex items-center justify-center font-bold text-xs shrink-0">
                            {item.staffName.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <span className="font-bold text-ink block">{item.staffName}</span>
                            {item.staffId === null && (
                              <span className="text-[11px] text-amber-600 dark:text-amber-400 block">
                                Perlu dilengkapi penugasan staf
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-center font-bold text-ink">
                        {item.cohortN}
                      </td>

                      <td className="py-3.5 px-4 text-center font-bold text-ink">
                        {item.retainedN}
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        {item.retentionPct !== null ? (
                          <span
                            className={`font-black ${
                              item.retentionPct >= 38.1
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : item.retentionPct >= 31.1
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {item.retentionPct}%
                          </span>
                        ) : (
                          <span className="text-ink-2">-</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-center font-bold text-ink">
                        {item.retentionIndex !== null ? item.retentionIndex.toFixed(2) : '-'}
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        {item.finalTier ? (
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-black ${
                              item.finalTier === 3
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                                : item.finalTier === 2
                                ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30'
                                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                            }`}
                          >
                            Tier {item.finalTier}
                          </span>
                        ) : (
                          <span className="text-ink-2 text-xs">-</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <span className="inline-block px-2.5 py-1 rounded-lg bg-surface border border-divider font-black text-ink">
                          {item.splitPct}:{100 - item.splitPct}
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        {isParticipant ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                            <ShieldCheck size={14} /> Peserta Aktif
                          </span>
                        ) : isInsufficient ? (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-bold">
                            <AlertCircle size={14} /> Sampel Kurang (&lt;40)
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded-md bg-fill-2 text-ink-2 text-xs">
                            {item.skipReason === 'OWNER_OR_NOT_ELIGIBLE'
                              ? 'Owner (Non-Peserta)'
                              : item.skipReason === 'VOLUME_SCHEME'
                              ? 'Skema Volume'
                              : item.skipReason === 'TENURE'
                              ? 'Masa Kerja &lt;4 Bln'
                              : item.skipReason === 'UNASSIGNED_STAFF'
                              ? 'Tanpa Bidan'
                              : 'Dikecualikan'}
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => handleOpenDrilldown(item)}
                          disabled={item.cohortN === 0}
                          className="px-2.5 py-1 rounded-lg bg-surface border border-divider text-xs font-bold text-ink hover:bg-fill-1 hover:border-accent transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                        >
                          <span>Pasien</span>
                          <ArrowRight size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3. Catatan Metode & Regulasi (Collapsible) */}
      <div className="bg-surface rounded-2xl border border-divider shadow-xs p-4 sm:p-5">
        <button
          onClick={() => setShowMethodNotes((prev) => !prev)}
          className="w-full flex items-center justify-between text-left font-bold text-ink text-sm cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <HelpCircle size={16} className="text-accent" />
            <span>Dasar Perhitungan & Regulasi Insentif (Kamus Aturan Bidan)</span>
          </div>
          {showMethodNotes ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {showMethodNotes && (
          <div className="mt-4 pt-4 border-t border-divider space-y-3 text-xs text-ink-2 leading-relaxed">
            <p>
              <strong className="text-ink">1. Satuan Kunjungan:</strong> Satu tanggal unik (WIB) per
              pasien dengan minimal satu reservasi <code>completed</code>. Dua reservasi pada hari
              yang sama dihitung 1 kunjungan.
            </p>
            <p>
              <strong className="text-ink">2. First-Touch Attribution:</strong> Retensi diatribusikan
              ke bidan yang melayani kunjungan pertama seumur hidup pasien. Pasien kembali dalam
              rentang 60 hari dihitung sebagai retensi sukses.
            </p>
            <p>
              <strong className="text-ink">3. Pool 6 Bulan Bergulir:</strong> Hanya mengevaluasi kohort
              pasien yang telah matang (kunjungan pertama minimal 60 hari yang lalu) untuk menjaga
              keadilan statistik.
            </p>
            <p>
              <strong className="text-ink">4. Hysteresis (Proteksi Penurunan):</strong> Kenaikan tier
              berlaku instan pada periode tersebut. Penurunan tier membutuhkan 2 periode berturut-turut
              di bawah ambang batas sebelum tingkat bagi hasil diturunkan.
            </p>
            <p>
              <strong className="text-ink">5. Soft Landing Periode Perdana:</strong> Untuk periode awal
              skema baru (hingga Februari 2027), ditetapkan tingkat bagi hasil minimum 55:45 sebagai
              masa transisi.
            </p>
          </div>
        )}
      </div>

      {/* 4. Drawer Drilldown Pasien Kohort */}
      {selectedStaff && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs transition-opacity animate-fadeIn">
          <div className="w-full max-w-2xl bg-surface h-full shadow-2xl flex flex-col border-l border-divider animate-slideLeft">
            {/* Drawer Header */}
            <div className="p-5 border-b border-divider flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-ink">
                  Daftar Pasien Kohort: {selectedStaff.staffName}
                </h3>
                <p className="text-xs text-ink-2 mt-0.5">
                  Verifikasi pasien pertama periode pool dan status keterulangan 60 hari.
                </p>
              </div>
              <button
                onClick={handleCloseDrilldown}
                className="p-1.5 rounded-lg text-ink-2 hover:text-ink hover:bg-fill-1 transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-fill-1 border border-divider">
                  <span className="text-[11px] font-bold text-ink-2 block">Total Pasien</span>
                  <span className="text-lg font-black text-ink">{drilldownList.length}</span>
                </div>
                <div className="p-3 rounded-xl bg-emerald-500/10 dark:bg-emerald-950/30 border border-emerald-500/20 dark:border-emerald-800/40">
                  <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 block">
                    Pasien Repeat
                  </span>
                  <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">
                    {drilldownList.filter((d) => d.isRetained).length}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-blue-500/10 dark:bg-blue-950/30 border border-blue-500/20 dark:border-blue-800/40">
                  <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400 block">
                    Ke Bidan Lain
                  </span>
                  <span className="text-lg font-black text-blue-600 dark:text-blue-400">
                    {drilldownList.filter((d) => d.otherStaffVisits > 0).length}
                  </span>
                </div>
              </div>

              {/* Table of Patients */}
              {drilldownLoading ? (
                <div className="p-12 text-center text-ink-2">
                  <RefreshCw size={24} className="animate-spin mx-auto text-accent mb-2" />
                  <p className="text-sm">Memuat data pasien kohort...</p>
                </div>
              ) : drilldownList.length === 0 ? (
                <div className="p-12 text-center text-ink-2">
                  <p className="text-sm">Tidak ada rincian pasien pada staf ini.</p>
                </div>
              ) : (
                <div className="border border-divider rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-fill-1 text-ink-2 font-bold uppercase border-b border-divider">
                      <tr>
                        <th className="py-2.5 px-3">Pasien</th>
                        <th className="py-2.5 px-3">Kunjungan Pertama</th>
                        <th className="py-2.5 px-3">Kunjungan Terakhir</th>
                        <th className="py-2.5 px-3 text-center">Total</th>
                        <th className="py-2.5 px-3 text-center">Repeat 60h</th>
                        <th className="py-2.5 px-3 text-center">Rotasi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-divider font-medium">
                      {drilldownList.map((cust) => (
                        <tr key={cust.customerId} className="hover:bg-fill-1/40">
                          <td className="py-2.5 px-3">
                            <span className="font-bold text-ink block">
                              {maskName(cust.customerName)}
                            </span>
                            <span className="text-[11px] text-ink-2">
                              {maskPhone(cust.customerPhone)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-ink">{cust.firstVisitDate}</td>
                          <td className="py-2.5 px-3 text-ink">{cust.lastVisitDate}</td>
                          <td className="py-2.5 px-3 text-center font-bold text-ink">
                            {cust.totalVisits}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {cust.isRetained ? (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold">
                                Ya
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-fill-2 text-ink-2 font-semibold">
                                Belum
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {cust.otherStaffVisits > 0 ? (
                              <span
                                className="text-[11px] font-bold text-blue-600 dark:text-blue-400"
                                title={`Sama: ${cust.sameStaffVisits}, Lain: ${cust.otherStaffVisits}`}
                              >
                                {cust.sameStaffVisits}S / {cust.otherStaffVisits}L
                              </span>
                            ) : (
                              <span className="text-[11px] text-ink-2">Setia</span>
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
      )}
    </div>
  );
};
