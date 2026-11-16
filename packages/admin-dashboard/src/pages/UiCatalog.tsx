import React, { useState } from 'react';
import {
  Layers,
  Sparkles,
  Smartphone,
  Monitor,
  CheckCircle2,
  AlertTriangle,
  Info,
  Calendar,
  Users,
  Search,
  Plus,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Tag as TagIcon
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import { Input, Textarea, Select } from '../components/ui/Fields';
import { FormErrorSummary } from '../components/ui/FormErrorSummary';
import { KpiCard } from '../components/ui/KpiCard';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState, SkeletonRows } from '../components/ui/StateViews';
import { StatusChip, type StatusTone } from '../components/ui/StatusChip';
import { Table, THead, TR, TH, TD } from '../components/ui/Table';
import { Tag, TagList } from '../components/ui/Tag';
import { ToggleSwitch } from '../components/common/ToggleSwitch';
import { ThemeToggle } from '../components/common/ThemeToggle';
import { Pagination } from '../components/common/Pagination';
import { CustomerAvatar } from '../components/common/CustomerAvatar';
import { useUiFeedback } from '../components/common/UiFeedback';

/**
 * UiCatalog (Dev-Only Gallery — ADR 0004)
 * Katalog hidup seluruh komponen UI/UX primitif dan pattern bersama di dashboard admin.
 * Membantu developer dan AI agent melihat, menguji, dan menggunakan kembali (reuse) komponen yang ada.
 */
export const UiCatalog: React.FC = () => {
  const feedback = useUiFeedback();
  const [activeTab, setActiveTab] = useState<'primitives' | 'patterns' | 'states' | 'all'>('all');
  const [deviceFrame, setDeviceFrame] = useState<'desktop' | 'mobile'>('desktop');
  const [demoModalOpen, setDemoModalOpen] = useState(false);
  const [toggleStateA, setToggleStateA] = useState(true);
  const [toggleStateB, setToggleStateB] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [tags, setTags] = useState(['Pasien VIP', 'Follow-up Cepat', 'Homecare']);

  const handleShowConfirm = async () => {
    const ok = await feedback.confirm({
      title: 'Konfirmasi Tindakan',
      message: 'Apakah Anda yakin ingin mengeksekusi aksi ini? Komponen ini menggunakan useUiFeedback kanonis (bukan window.confirm).',
      confirmText: 'Ya, Lanjutkan',
      cancelText: 'Batal',
      danger: true
    });
    if (ok) {
      feedback.toast('Aksi berhasil dikonfirmasi!', 'success');
    } else {
      feedback.toast('Aksi dibatalkan.', 'info');
    }
  };

  const tonesList: StatusTone[] = [
    'success',
    'info',
    'warning',
    'caution',
    'danger',
    'neutral'
  ];

  return (
    <div className="min-h-screen bg-app font-sans text-primary">
      {/* Dev-Only Top Navigation Bar */}
      <header className="sticky top-0 z-40 border-b border-subtle bg-surface px-6 py-3 shadow-xs">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-contrast shadow-xs">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-primary">
                  UI Component Catalog & Design System
                </h1>
                <span className="rounded-full bg-emerald-500/10 dark:bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 dark:border-emerald-500/30">
                  DEV-ONLY • ADR 0004
                </span>
              </div>
              <p className="text-xs text-secondary">
                Galeri hidup komponen primitif (<code className="font-mono">src/components/ui</code>) & pattern bersama (<code className="font-mono">src/components/common</code>).
              </p>
            </div>
          </div>

          {/* Controls: Tabs, Device Switcher, Theme */}
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg bg-subtle/50 p-1 text-xs font-medium">
              <button
                onClick={() => setActiveTab('all')}
                className={`rounded-md px-3 py-1.5 transition ${activeTab === 'all' ? 'bg-surface text-accent shadow-xs font-semibold' : 'text-secondary hover:text-primary'}`}
              >
                Semua
              </button>
              <button
                onClick={() => setActiveTab('primitives')}
                className={`rounded-md px-3 py-1.5 transition ${activeTab === 'primitives' ? 'bg-surface text-accent shadow-xs font-semibold' : 'text-secondary hover:text-primary'}`}
              >
                Primitives (UI)
              </button>
              <button
                onClick={() => setActiveTab('patterns')}
                className={`rounded-md px-3 py-1.5 transition ${activeTab === 'patterns' ? 'bg-surface text-accent shadow-xs font-semibold' : 'text-secondary hover:text-primary'}`}
              >
                Patterns (Common)
              </button>
              <button
                onClick={() => setActiveTab('states')}
                className={`rounded-md px-3 py-1.5 transition ${activeTab === 'states' ? 'bg-surface text-accent shadow-xs font-semibold' : 'text-secondary hover:text-primary'}`}
              >
                State Views
              </button>
            </div>

            <div className="flex rounded-lg border border-subtle bg-surface p-1">
              <button
                onClick={() => setDeviceFrame('desktop')}
                title="Desktop View"
                className={`rounded p-1.5 transition ${deviceFrame === 'desktop' ? 'bg-accent text-accent-contrast' : 'text-secondary hover:text-primary'}`}
              >
                <Monitor className="h-4 w-4" />
              </button>
              <button
                onClick={() => setDeviceFrame('mobile')}
                title="Mobile View (360px)"
                className={`rounded p-1.5 transition ${deviceFrame === 'mobile' ? 'bg-accent text-accent-contrast' : 'text-secondary hover:text-primary'}`}
              >
                <Smartphone className="h-4 w-4" />
              </button>
            </div>

            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Canvas Body */}
      <main className={`mx-auto p-6 transition duration-300 ${deviceFrame === 'mobile' ? 'max-w-[400px] border-x border-subtle shadow-xl bg-app min-h-screen my-4 rounded-xl' : 'max-w-7xl'}`}>
        {deviceFrame === 'mobile' && (
          <div className="mb-4 rounded-md bg-amber-500/10 dark:bg-amber-500/20 p-2 text-center text-xs font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/20 dark:border-amber-500/30">
            📱 Preview Frame Ponsel (360px - 400px)
          </div>
        )}

        {/* 1. BUTTONS */}
        {(activeTab === 'all' || activeTab === 'primitives') && (
          <section className="mb-10">
            <div className="mb-4 flex items-center justify-between border-b border-subtle pb-2">
              <div>
                <h2 className="text-lg font-bold text-primary">Button</h2>
                <p className="text-xs text-secondary">
                  Gunakan untuk semua aksi klik. Pilih varian lewat prop <code className="font-mono">variant</code>, dilarang membuat tombol ad-hoc.
                </p>
              </div>
              <span className="text-xs font-mono text-secondary">src/components/ui/Button.tsx</span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader title="Variant: Primary" />
                <CardBody className="space-y-2">
                  <Button variant="primary" onClick={() => feedback.toast('Primary clicked', 'info')}>Default</Button>
                  <Button variant="primary" icon={<Sparkles className="h-4 w-4" />}>With Icon</Button>
                  <Button variant="primary" loading>Loading</Button>
                  <Button variant="primary" disabled>Disabled</Button>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Variant: Secondary" />
                <CardBody className="space-y-2">
                  <Button variant="secondary" onClick={() => feedback.toast('Secondary clicked', 'info')}>Default</Button>
                  <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />}>With Icon</Button>
                  <Button variant="secondary" loading>Loading</Button>
                  <Button variant="secondary" disabled>Disabled</Button>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Variant: Danger" />
                <CardBody className="space-y-2">
                  <Button variant="danger" onClick={() => feedback.toast('Danger clicked', 'error')}>Default</Button>
                  <Button variant="danger" icon={<AlertTriangle className="h-4 w-4" />}>With Icon</Button>
                  <Button variant="danger" loading>Loading</Button>
                  <Button variant="danger" disabled>Disabled</Button>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Variant: Ghost & Neutral" />
                <CardBody className="space-y-2">
                  <Button variant="ghost">Ghost Default</Button>
                  <Button variant="ghost" disabled>Ghost Disabled</Button>
                  <Button variant="neutral">Neutral Default</Button>
                  <Button variant="neutral" disabled>Neutral Disabled</Button>
                </CardBody>
              </Card>
            </div>
          </section>
        )}

        {/* 2. FIELDS & INPUTS */}
        {(activeTab === 'all' || activeTab === 'primitives') && (
          <section className="mb-10">
            <div className="mb-4 flex items-center justify-between border-b border-subtle pb-2">
              <div>
                <h2 className="text-lg font-bold text-primary">Fields (Input, Textarea, Select)</h2>
                <p className="text-xs text-secondary">
                  Gunakan untuk semua input form. Mendukung label, hint, error message, dan ref forward.
                </p>
              </div>
              <span className="text-xs font-mono text-secondary">src/components/ui/Fields.tsx</span>
            </div>

            <Card>
              <CardBody className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Input
                    label="Nama Pasien"
                    placeholder="Contoh: Ny. Kartika"
                    hint="Nama lengkap sesuai data registrasi"
                  />
                </div>
                <div>
                  <Input
                    label="Nomor WhatsApp"
                    placeholder="08123456789"
                    error="Format nomor telepon tidak valid"
                  />
                </div>
                <div>
                  <Input
                    label="Status Akun (Disabled)"
                    value="Aktif (Terverifikasi)"
                    disabled
                  />
                </div>
                <div>
                  <Select
                    label="Pilih Layanan Treatment"
                    options={[
                      { value: 'pijat-bayi', label: 'Pijat Bayi Sehat (60 min)' },
                      { value: 'laktasi', label: 'Konsultasi Laktasi (45 min)' },
                      { value: 'post-partum', label: 'Paket Pemulihan Nifas' },
                    ]}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Textarea
                    label="Catatan Khusus Bidan"
                    placeholder="Tuliskan catatan keluhan atau instruksi kunjungan..."
                    rows={3}
                  />
                </div>
              </CardBody>
            </Card>

            <div className="mt-4">
              <FormErrorSummary
                issues={[
                  { field: 'phone', message: 'Nomor WhatsApp wajib diisi' },
                  { field: 'address', message: 'Alamat kunjungan harus menyertakan kelurahan/kecamatan' }
                ]}
              />
            </div>
          </section>
        )}

        {/* 3. STATUS CHIPS & TAGS */}
        {(activeTab === 'all' || activeTab === 'primitives') && (
          <section className="mb-10">
            <div className="mb-4 flex items-center justify-between border-b border-subtle pb-2">
              <div>
                <h2 className="text-lg font-bold text-primary">StatusChip & Tag</h2>
                <p className="text-xs text-secondary">
                  Visualisasi status reservasi, tiket layanan, dan label kategori pasien.
                </p>
              </div>
              <span className="text-xs font-mono text-secondary">src/components/ui/StatusChip.tsx</span>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Card>
                <CardHeader title="Semua StatusChip Tone" />
                <CardBody className="flex flex-wrap gap-2">
                  {tonesList.map((tn) => (
                    <StatusChip key={tn} tone={tn} label={tn.toUpperCase()} />
                  ))}
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Tag & TagList" />
                <CardBody className="space-y-4">
                  <TagList
                    tags={tags}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Tag label="Default Tag" />
                    <Tag label="Removable Tag" onRemove={() => feedback.toast('Tag dihapus', 'info')} />
                    <Tag label="Tag Bersama Ikon" icon={<TagIcon className="h-3 w-3" />} />
                  </div>
                </CardBody>
              </Card>
            </div>
          </section>
        )}

        {/* 4. KPI CARDS & TABLES */}
        {(activeTab === 'all' || activeTab === 'primitives') && (
          <section className="mb-10">
            <div className="mb-4 flex items-center justify-between border-b border-subtle pb-2">
              <div>
                <h2 className="text-lg font-bold text-primary">KpiCard & Table</h2>
                <p className="text-xs text-secondary">
                  Menampilkan metrik bisnis utama dan representasi data tabular yang seragam.
                </p>
              </div>
              <span className="text-xs font-mono text-secondary">src/components/ui/KpiCard.tsx</span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
              <KpiCard
                label="Total Reservasi Bulan Ini"
                value="248"
                delta={{ value: '14.5%', direction: 'up', label: 'vs bulan lalu' }}
                icon={<Calendar className="h-5 w-5" />}
                hint="vs bulan lalu (216)"
              />
              <KpiCard
                label="Pasien Baru (MQL)"
                value="92"
                delta={{ value: '8.2%', direction: 'up', label: 'vs target' }}
                icon={<Users className="h-5 w-5" />}
                hint="Tingkat konversi 78%"
              />
              <KpiCard
                label="Tingkat Pembatalan"
                value="3.2%"
                delta={{ value: '1.1%', direction: 'down', label: 'membaik' }}
                icon={<AlertTriangle className="h-5 w-5" />}
                hint="Dalam batas target operasional"
              />
            </div>

            <Table>
              <THead>
                <TR>
                  <TH>ID</TH>
                  <TH>Nama Pasien</TH>
                  <TH>Layanan</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Aksi</TH>
                </TR>
              </THead>
              <tbody>
                <TR>
                  <TD className="font-mono text-xs">#RES-1042</TD>
                  <TD className="font-medium">Ny. Cindy Maharani</TD>
                  <TD>Pijat Bayi Sehat</TD>
                  <TD><StatusChip tone="success" label="CONFIRMED" /></TD>
                  <TD className="text-right"><Button variant="ghost" size="sm">Detail</Button></TD>
                </TR>
                <TR>
                  <TD className="font-mono text-xs">#RES-1043</TD>
                  <TD className="font-medium">Ny. Kartika Putri</TD>
                  <TD>Konsultasi Laktasi</TD>
                  <TD><StatusChip tone="info" label="IN PROGRESS" /></TD>
                  <TD className="text-right"><Button variant="ghost" size="sm">Detail</Button></TD>
                </TR>
                <TR>
                  <TD className="font-mono text-xs">#RES-1044</TD>
                  <TD className="font-medium">Ny. Dina Salsabila</TD>
                  <TD>Paket Pemulihan Nifas</TD>
                  <TD><StatusChip tone="neutral" label="COMPLETED" /></TD>
                  <TD className="text-right"><Button variant="ghost" size="sm">Detail</Button></TD>
                </TR>
              </tbody>
            </Table>
          </section>
        )}

        {/* 5. PATTERNS & FEEDBACK */}
        {(activeTab === 'all' || activeTab === 'patterns') && (
          <section className="mb-10">
            <div className="mb-4 flex items-center justify-between border-b border-subtle pb-2">
              <div>
                <h2 className="text-lg font-bold text-primary">Common Patterns (Feedback, Switches, Modals)</h2>
                <p className="text-xs text-secondary">
                  Gunakan <code className="font-mono">useUiFeedback()</code> untuk toast dan dialog konfirmasi (DILARANG window.confirm/alert).
                </p>
              </div>
              <span className="text-xs font-mono text-secondary">src/components/common/UiFeedback.tsx</span>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <Card>
                <CardHeader title="UiFeedback Triggers" />
                <CardBody className="space-y-3">
                  <p className="text-xs text-secondary">Klik tombol berikut untuk menguji banner toast dan dialog konfirmasi modal:</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => feedback.toast('Pesan informasi sistem', 'info')}>Toast Info</Button>
                    <Button variant="primary" onClick={() => feedback.toast('Data reservasi berhasil disimpan!', 'success')}>Toast Success</Button>
                    <Button variant="danger" onClick={() => feedback.toast('Gagal terhubung ke gateway WhatsApp', 'error')}>Toast Error</Button>
                    <Button variant="neutral" onClick={handleShowConfirm}>Uji Dialog Konfirmasi</Button>
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="ToggleSwitch & Avatars" />
                <CardBody className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">Notifikasi WhatsApp Otomatis</div>
                      <div className="text-xs text-secondary">Kirim pengingat H-1 ke pasien</div>
                    </div>
                    <ToggleSwitch checked={toggleStateA} onChange={setToggleStateA} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">Mode Siaga Bidan (On-Call)</div>
                      <div className="text-xs text-secondary">Aktifkan routing darurat</div>
                    </div>
                    <ToggleSwitch checked={toggleStateB} onChange={setToggleStateB} />
                  </div>
                  <div className="pt-2 border-t border-subtle flex items-center gap-3">
                    <CustomerAvatar name="Bidan Rina" size="md" />
                    <div>
                      <div className="text-sm font-semibold">Bidan Rina S.Tr.Keb</div>
                      <div className="text-xs text-secondary">Spesialis Laktasi & Pijat Bayi</div>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </div>

            <div className="mt-6 flex items-center justify-between">
              <Button variant="secondary" onClick={() => setDemoModalOpen(true)}>Buka Demo Modal</Button>
              <Pagination
                page={currentPage}
                totalPages={5}
                onPageChange={setCurrentPage}
              />
            </div>

            <Modal
              open={demoModalOpen}
              onClose={() => setDemoModalOpen(false)}
              title="Demo Dialog Modal Kanonis"
            >
              <div className="space-y-3">
                <p className="text-sm text-secondary">
                  Ini adalah komponen <code className="font-mono">Modal.tsx</code> kanonis. Mendukung animasi backdrop, escape key, focus trapping, dan responsive sizing.
                </p>
                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="secondary" onClick={() => setDemoModalOpen(false)}>Tutup</Button>
                  <Button variant="primary" onClick={() => { setDemoModalOpen(false); feedback.toast('Modal dikonfirmasi!', 'success'); }}>Selesai</Button>
                </div>
              </div>
            </Modal>
          </section>
        )}

        {/* 6. STATE VIEWS */}
        {(activeTab === 'all' || activeTab === 'states') && (
          <section className="mb-10">
            <div className="mb-4 flex items-center justify-between border-b border-subtle pb-2">
              <div>
                <h2 className="text-lg font-bold text-primary">State Views (Loading, Empty, Error, Skeleton)</h2>
                <p className="text-xs text-secondary">
                  Representasi seragam saat data sedang dimuat, kosong, atau terjadi kegagalan sistem.
                </p>
              </div>
              <span className="text-xs font-mono text-secondary">src/components/ui/StateViews.tsx</span>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <Card>
                <CardHeader title="EmptyState & ErrorState" />
                <CardBody className="space-y-6">
                  <EmptyState
                    title="Tidak Ada Jadwal Hari Ini"
                    description="Belum ada reservasi baru yang dijadwalkan untuk bidan hari ini."
                    action={<Button variant="primary" size="sm">Buat Jadwal Baru</Button>}
                  />
                  <div className="border-t border-subtle pt-4">
                    <ErrorState
                      title="Gagal Memuat Data Analytics"
                      description="Terjadi gangguan saat mengambil metrik dari database."
                      onRetry={() => feedback.toast('Mencoba memuat ulang...', 'info')}
                    />
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="LoadingState & SkeletonRows" />
                <CardBody className="space-y-6">
                  <LoadingState label="Mengambil riwayat percakapan..." />
                  <div className="border-t border-subtle pt-4">
                    <p className="text-xs text-secondary mb-2">Skeleton Loading Placeholder:</p>
                    <SkeletonRows rows={4} />
                  </div>
                </CardBody>
              </Card>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default UiCatalog;
