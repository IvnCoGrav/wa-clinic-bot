import React, { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { ExternalIntegrationModal } from '../../components/modals/ExternalIntegrationModal';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';
import {
  Globe,
  Plus,
  Edit3,
  Trash2,
  Upload,
  Save,
  Eye,
  FileCode2,
  AlertTriangle,
  Info,
  RefreshCw,
  ShieldCheck,
  MousePointerClick,
  Check,
  X,
  LayoutTemplate,
  Code,
  Copy,
  Link2,
  BookOpen,
} from 'lucide-react';

interface LandingListItem {
  id: string;
  slug: string;
  title: string;
  landingType: string;
  hasHtml: boolean;
  sizeBytes: number;
  events: string[];
  hasPixelOverride: boolean;
  whatsappNumber: string;
  isActive: boolean;
  previewUrl: string;
}

interface LandingDetail extends LandingListItem {
  rawHtmlContent: string;
  metaPixelId: string;
}

const EVENT_OPTIONS = [
  'PageView',
  'ViewContent',
  'Search',
  'Lead',
  'Purchase',
  'InitiateCheckout',
  'AddToCart',
  'CompleteRegistration',
  'Contact',
  'StartTrial',
  'Subscribe',
  'CustomizeProduct',
];

const MAX_HTML_BYTES = 500 * 1024;

const byteLength = (text: string) => new TextEncoder().encode(text).length;

const normalizeSlug = (raw: string) =>
  raw
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/(^-|-$)/g, '');

export const LandingPage: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [landings, setLandings] = useState<LandingListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<LandingDetail | null>(null);
  const [saving, setSaving] = useState(false);

  // Modal & card integrasi LP eksternal
  const [isExternalModalOpen, setIsExternalModalOpen] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  // Form states
  const [formTitle, setFormTitle] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formUseCustomHtml, setFormUseCustomHtml] = useState(false);
  const [formHtml, setFormHtml] = useState('');
  const [formMetaPixelId, setFormMetaPixelId] = useState('');
  const [formWhatsappNumber, setFormWhatsappNumber] = useState('');
  const [formEvents, setFormEvents] = useState<string[]>(['PageView']);
  const [formIsActive, setFormIsActive] = useState(true);
  const [fileError, setFileError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/admin/landings');
      const list = Array.isArray(res) ? res : (res?.data || []);
      setLandings(list);
    } catch (err: any) {
      toast(`Gagal memuat daftar landing page: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openAddModal = () => {
    setEditing(null);
    setFormTitle('');
    setFormSlug('');
    setFormUseCustomHtml(false);
    setFormHtml('');
    setFormMetaPixelId('');
    setFormWhatsappNumber('');
    setFormEvents(['PageView']);
    setFormIsActive(true);
    setFileError('');
    setIsModalOpen(true);
  };

  const openEditModal = async (item: LandingListItem) => {
    setEditing(null);
    setFormTitle(item.title);
    setFormSlug(item.slug);
    setFormUseCustomHtml(item.hasHtml);
    setFormHtml('');
    setFormMetaPixelId('');
    setFormWhatsappNumber(item.whatsappNumber);
    setFormEvents(item.events?.length ? item.events : ['PageView']);
    setFormIsActive(item.isActive);
    setFileError('');
    setIsModalOpen(true);

    try {
      const res = await apiRequest(`/api/admin/landings/${item.id}`);
      const detail = res?.data as LandingDetail;
      if (detail) {
        setEditing(detail);
        setFormHtml(detail.rawHtmlContent || '');
        setFormMetaPixelId(detail.metaPixelId || '');
      }
    } catch (err: any) {
      toast(`Gagal memuat detail landing: ${err.message}`, 'error');
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError('');
    const file = e.target.files?.[0];
    if (!file) return;

    if (!/\.html?$/i.test(file.name)) {
      setFileError('File harus berformat .html atau .htm');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      if (byteLength(text) > MAX_HTML_BYTES) {
        setFileError(`File terlalu besar (maksimal ${Math.round(MAX_HTML_BYTES / 1024)} KB).`);
        return;
      }
      setFormHtml(text);
      setFormUseCustomHtml(true);
      toast(`File "${file.name}" dimuat ke editor (${(byteLength(text) / 1024).toFixed(1)} KB).`, 'info');
    };
    reader.onerror = () => setFileError('Gagal membaca file. Coba lagi.');
    reader.readAsText(file);
    e.target.value = '';
  };

  const toggleEvent = (ev: string) => {
    if (ev === 'PageView') return;
    setFormEvents((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      toast('Judul wajib diisi.', 'error');
      return;
    }
    if (!formSlug.trim()) {
      toast('Slug wajib diisi.', 'error');
      return;
    }
    if (formUseCustomHtml) {
      const sizeBytes = byteLength(formHtml);
      if (sizeBytes > MAX_HTML_BYTES) {
        toast(`HTML terlalu besar (${(sizeBytes / 1024).toFixed(1)} KB, maksimal 500 KB).`, 'error');
        return;
      }
      if (!formHtml.trim()) {
        toast('HTML tidak boleh kosong saat memilih template kustom.', 'error');
        return;
      }
    }

    const payload = {
      title: formTitle,
      slug: normalizeSlug(formSlug),
      html: formUseCustomHtml ? formHtml : null,
      metaPixelId: formMetaPixelId.trim() ? formMetaPixelId.trim() : null,
      whatsappNumber: formWhatsappNumber.trim() ? formWhatsappNumber.trim() : null,
      events: formEvents,
      isActive: formIsActive,
    };

    setSaving(true);
    try {
      if (editing) {
        const res = await apiRequest(`/api/admin/landings/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        toast(res?.message || 'Landing page berhasil diperbarui.', 'success');
      } else {
        const res = await apiRequest('/api/admin/landings', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast(res?.message || 'Landing page berhasil dibuat.', 'success');
      }
      setIsModalOpen(false);
      await load();
    } catch (err: any) {
      toast(`Gagal menyimpan landing page: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: LandingListItem) => {
    const ok = await confirm({
      title: 'Hapus Landing Page?',
      message: `Yakin ingin menghapus landing "${item.title}" (/${item.slug})? Aksi ini tidak bisa dibatalkan.`,
      confirmText: 'Ya, Hapus',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await apiRequest(`/api/admin/landings/${item.id}`, { method: 'DELETE' });
      toast(res?.message || 'Landing page berhasil dihapus.', 'success');
      await load();
    } catch (err: any) {
      toast(`Gagal menghapus landing page: ${err.message}`, 'error');
    }
  };

  const handleToggleActive = async (item: LandingListItem) => {
    try {
      const res = await apiRequest(`/api/admin/landings/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      toast(res?.message || 'Status landing diperbarui.', 'success');
      await load();
    } catch (err: any) {
      toast(`Gagal mengubah status: ${err.message}`, 'error');
    }
  };

  const previewBaseUrl = landings[0]?.previewUrl
    ? landings[0].previewUrl.replace(/\/[^/]+$/, '')
    : window.location.origin;

  const scriptSnippet = `<script src="${window.location.origin.replace(/\/$/, '')}/assets/external-tracker.js" defer></script>`;

  const handleCopyScript = async () => {
    try {
      await navigator.clipboard.writeText(scriptSnippet);
    } catch {
      toast('Gagal menyalin kode.', 'error');
      return;
    }
    setCopiedScript(true);
    toast('Script embed disalin ke clipboard!', 'success');
    setTimeout(() => setCopiedScript(false), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-divider">
        <div>
          <h2 className="text-xl font-bold text-ink flex items-center gap-2">
            <Globe className="text-accent" size={22} />
            <span>Landing Page</span>
          </h2>
          <p className="text-xs text-ink-3 mt-0.5">
            Kelola banyak landing page per tenant. Upload file HTML mentah atau gunakan template sistem bawaan.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="p-2 rounded-xl bg-surface hover:bg-fill-1 border border-divider text-ink-2 hover:text-ink transition shadow-xs disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin text-accent' : ''} />
          </button>
          <button
            onClick={openAddModal}
            className="px-3.5 py-2 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs"
          >
            <Plus size={14} />
            <span>Tambah Landing Page</span>
          </button>
        </div>
      </div>

      {/* Card integrasi LP eksternal */}
      <div className="bg-surface border border-divider rounded-2xl p-5 space-y-3 shadow-xs">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-ink flex items-center gap-2">
              <Link2 className="text-accent" size={16} />
              <span>Integrasi Landing Page Eksternal</span>
            </h3>
            <p className="text-xs text-ink-3">
              Hubungkan Landing Page luar (WordPress / Elementor / HTML) ke atribusi iklan &amp; WhatsApp. Script disajikan langsung oleh bot.
            </p>
          </div>
          <button
            onClick={() => setIsExternalModalOpen(true)}
            className="px-3 py-1.5 bg-surface hover:bg-fill-1 border border-divider text-ink rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs"
          >
            <BookOpen size={13} className="text-accent" />
            <span>Lihat Panduan Integrasi</span>
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap pt-1">
          <div className="flex-1 min-w-[260px] flex items-center gap-2 bg-surface-2 border border-divider rounded-xl px-3 py-2">
            <Code size={14} className="text-accent flex-shrink-0" />
            <input
              readOnly
              value={scriptSnippet}
              onFocus={(e) => e.target.select()}
              className="w-full bg-transparent text-xs font-mono text-accent focus:outline-none"
            />
          </div>
          <button
            onClick={handleCopyScript}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs border ${
              copiedScript
                ? 'bg-success-soft text-success border-success-line'
                : 'bg-surface text-ink border-divider hover:bg-fill-1'
            }`}
          >
            {copiedScript ? <Check size={14} /> : <Copy size={14} />}
            <span>{copiedScript ? 'Tersalin!' : 'Salin Script'}</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <RefreshCw className="animate-spin text-accent" size={32} />
        </div>
      ) : landings.length === 0 ? (
        <div className="bg-surface border border-divider rounded-2xl py-16 text-center text-xs text-ink-3 shadow-xs">
          Belum ada landing page. Klik "Tambah Landing Page" untuk mulai.
        </div>
      ) : (
        <div className="bg-surface border border-divider rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-divider bg-surface-2">
                  <th className="px-4 py-3 text-[11px] uppercase font-bold text-ink-3">Landing</th>
                  <th className="px-4 py-3 text-[11px] uppercase font-bold text-ink-3">Tipe</th>
                  <th className="px-4 py-3 text-[11px] uppercase font-bold text-ink-3">Events Pixel</th>
                  <th className="px-4 py-3 text-[11px] uppercase font-bold text-ink-3">Pixel</th>
                  <th className="px-4 py-3 text-[11px] uppercase font-bold text-ink-3">Status</th>
                  <th className="px-4 py-3 text-[11px] uppercase font-bold text-ink-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {landings.map((item) => {
                  const isStructured = item.landingType === 'STRUCTURED_JSON';
                  return (
                    <tr
                      key={item.id}
                      className={`border-b border-divider hover:bg-surface-2 transition-colors ${!item.isActive ? 'opacity-50' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-bold text-ink text-xs flex items-center gap-2">
                          {isStructured && <LayoutTemplate size={13} className="text-info" />}
                          <span>{item.title || '(tanpa judul)'}</span>
                        </div>
                        <div className="text-xs text-ink-3 font-mono mt-0.5">
                          /{item.slug}
                          {item.sizeBytes > 0 && <span className="text-ink-3"> · {(item.sizeBytes / 1024).toFixed(1)} KB</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            isStructured
                              ? 'bg-info-soft text-info border border-info-line'
                              : 'bg-success-soft text-success border border-success-line'
                          }`}
                        >
                          {isStructured ? 'Template Sistem' : 'HTML Kustom'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {item.events.length === 0 ? (
                          <span className="text-xs text-ink-3">PageView saja</span>
                        ) : (
                          <div className="flex flex-wrap gap-1 max-w-[220px]">
                            {item.events.map((ev) => (
                              <span
                                key={ev}
                                className="px-2 py-0.5 rounded-full bg-violet-soft text-violet border border-violet-line text-[10px] font-bold"
                              >
                                {ev}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {item.hasPixelOverride ? (
                          <span className="text-xs font-bold text-warning">Override</span>
                        ) : (
                          <span className="text-xs text-ink-3">Sistem</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ToggleSwitch
                          checked={item.isActive}
                          onChange={() => handleToggleActive(item)}
                          size="sm"
                          onLabel="Aktif"
                          offLabel="Nonaktif"
                          title={item.isActive ? 'Klik untuk nonaktifkan' : 'Klik untuk aktifkan'}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {item.previewUrl && (
                            <a
                              href={item.previewUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-lg bg-surface hover:bg-fill-1 border border-divider text-ink-2 hover:text-accent transition shadow-xs"
                              title="Lihat landing page"
                            >
                              <Eye size={13} />
                            </a>
                          )}
                          <button
                            onClick={() => openEditModal(item)}
                            className="p-1.5 rounded-lg bg-surface hover:bg-fill-1 border border-divider text-ink-2 hover:text-accent transition shadow-xs"
                            title="Edit"
                          >
                            <Edit3 size={13} />
                          </button>
                          <button
                            onClick={() => handleDelete(item)}
                            className="p-1.5 rounded-lg bg-surface hover:bg-danger-soft border border-divider hover:border-danger-line text-ink-2 hover:text-danger transition shadow-xs"
                            title="Hapus"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Editor */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fadeIn"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="bg-surface border border-divider rounded-2xl w-full max-w-2xl overflow-hidden flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-divider flex justify-between items-center bg-surface-2">
              <h3 className="font-bold text-ink text-sm">
                {editing ? `Edit Landing: ${editing.title}` : 'Tambah Landing Page Baru'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-ink-3 hover:text-ink">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4 max-h-[560px] overflow-y-auto">
              {fileError && (
                <div className="flex items-center gap-2 text-xs text-danger bg-danger-soft border border-danger-line rounded-xl px-3 py-2">
                  <AlertTriangle size={14} className="text-danger" />
                  <span>{fileError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[11px] text-ink uppercase font-bold block">Judul Landing Page</label>
                  <input
                    type="text"
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="Contoh: Promo Baby Massage"
                    className="w-full p-2.5 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-ink uppercase font-bold block">Slug (URL)</label>
                  <input
                    type="text"
                    required
                    value={formSlug}
                    onChange={(e) => setFormSlug(normalizeSlug(e.target.value))}
                    placeholder="promo-baby"
                    className="w-full p-2.5 bg-surface border border-divider rounded-xl text-xs text-ink font-mono focus:outline-none focus:border-accent shadow-xs"
                  />
                  {formSlug && (
                    <p className="text-[10px] text-ink-3 font-mono truncate">
                      {previewBaseUrl}/
                      <span className="text-accent font-bold">{formSlug}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] text-ink uppercase font-bold block">Konten</label>
                <button
                  type="button"
                  onClick={() => setFormUseCustomHtml(!formUseCustomHtml)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition shadow-xs ${
                    formUseCustomHtml
                      ? 'border-accent bg-accent-soft'
                      : 'border-divider bg-surface hover:bg-surface-2'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {formUseCustomHtml ? <FileCode2 size={18} className="text-accent" /> : <LayoutTemplate size={18} className="text-info" />}
                    <div>
                      <div className="text-xs font-bold text-ink">
                        {formUseCustomHtml ? 'HTML Kustom (RAW_HTML)' : 'Template Sistem (STRUCTURED_JSON)'}
                      </div>
                      <div className="text-[10px] text-ink-3 mt-0.5">
                        {formUseCustomHtml
                          ? 'File HTML disanitasi 17-layer & disajikan apa adanya.'
                          : 'Template bawaan (teks terstruktur), tanpa upload file.'}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`w-9 h-5 rounded-full transition relative ${
                      formUseCustomHtml ? 'bg-accent' : 'bg-divider'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-surface transition-all ${
                        formUseCustomHtml ? 'left-4.5 right-0.5' : 'left-0.5'
                      }`}
                      style={{ left: formUseCustomHtml ? '1.125rem' : '0.125rem' }}
                    />
                  </span>
                </button>

                {formUseCustomHtml && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1.5 bg-surface border border-divider hover:bg-fill-1 rounded-lg text-xs font-semibold text-ink flex items-center gap-1.5 transition shadow-xs"
                      >
                        <Upload size={12} className="text-accent" />
                        <span>Upload File .html</span>
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".html,.htm,text/html"
                        className="hidden"
                        onChange={handleFile}
                      />
                      <span className={`text-xs ${byteLength(formHtml) > MAX_HTML_BYTES ? 'text-danger font-bold' : 'text-ink-3'}`}>
                        {(byteLength(formHtml) / 1024).toFixed(1)} / 500 KB
                      </span>
                    </div>
                    <textarea
                      value={formHtml}
                      onChange={(e) => setFormHtml(e.target.value)}
                      spellCheck={false}
                      placeholder="Tempel atau tulis HTML di sini. Wajib ada elemen <a id='wa-cta'> untuk tombol chat WhatsApp."
                      className="w-full h-[180px] p-3 bg-surface border border-divider rounded-xl text-xs font-mono text-ink focus:outline-none focus:border-accent resize-y shadow-xs"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[11px] text-ink uppercase font-bold block">
                    Override Meta Pixel ID <span className="text-ink-3 normal-case">(kosongkan = pakai sistem)</span>
                  </label>
                  <input
                    type="text"
                    value={formMetaPixelId}
                    onChange={(e) => setFormMetaPixelId(e.target.value)}
                    placeholder="Contoh: 123456789012345"
                    className="w-full p-2.5 bg-surface border border-divider rounded-xl text-xs text-ink font-mono focus:outline-none focus:border-accent shadow-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-ink uppercase font-bold block">
                    Override No. WhatsApp <span className="text-ink-3 normal-case">(kosongkan = pakai sistem)</span>
                  </label>
                  <input
                    type="text"
                    value={formWhatsappNumber}
                    onChange={(e) => setFormWhatsappNumber(e.target.value)}
                    placeholder="Contoh: 628123456789"
                    className="w-full p-2.5 bg-surface border border-divider rounded-xl text-xs text-ink font-mono focus:outline-none focus:border-accent shadow-xs"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] text-ink uppercase font-bold block">
                  Events Pixel Browser <span className="text-ink-3 normal-case">(PageView selalu di-fire)</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {EVENT_OPTIONS.map((ev) => {
                    const active = formEvents.includes(ev);
                    const locked = ev === 'PageView';
                    return (
                      <button
                        key={ev}
                        type="button"
                        onClick={() => toggleEvent(ev)}
                        disabled={locked}
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition disabled:cursor-not-allowed shadow-xs ${
                          active
                            ? 'bg-violet-soft text-violet border-violet-line'
                            : 'bg-surface text-ink-3 border-divider hover:bg-surface-2'
                        }`}
                      >
                        {active && !locked && <Check size={10} className="inline mr-1 text-violet" />}
                        {ev}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-ink-3">
                  ViewContent &amp; Search di-fire saat halaman dibuka (setelah PageView). Lead, Purchase, dll di-fire saat klik CTA sebelum redirect.
                </p>
              </div>

              <div className="pt-2">
                <div className="flex items-center justify-between p-3 rounded-xl bg-surface-2 border border-divider">
                  <div>
                    <span className="text-xs font-bold text-ink block">Status Landing Page</span>
                    <span className="text-[11px] text-ink-3">Landing page aktif dapat diakses publik via slug URL</span>
                  </div>
                  <ToggleSwitch
                    checked={formIsActive}
                    onChange={(next) => setFormIsActive(next)}
                    size="sm"
                    onLabel="Aktif"
                    offLabel="Nonaktif"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-divider">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-surface hover:bg-fill-1 border border-divider text-ink rounded-xl text-xs font-semibold transition flex items-center space-x-1 shadow-xs"
                >
                  <X size={14} />
                  <span>Batal</span>
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-accent hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-semibold transition flex items-center space-x-1 shadow-xs"
                >
                  {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                  <span>{saving ? 'Menyimpan...' : editing ? 'Simpan Perubahan' : 'Buat Landing Page'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Aturan upload */}
      <div className="bg-surface border border-divider rounded-2xl p-5 space-y-3 shadow-xs">
        <h3 className="text-sm font-bold text-ink flex items-center gap-2">
          <ShieldCheck className="text-accent" size={16} />
          <span>Aturan Upload</span>
        </h3>
        <ul className="space-y-2 text-xs text-ink-3 list-none">
          <li className="flex items-start gap-2">
            <Info size={13} className="flex-shrink-0 mt-0.5 text-accent" />
            <span>Maksimal <strong className="text-ink">500 KB</strong> per file HTML.</span>
          </li>
          <li className="flex items-start gap-2">
            <MousePointerClick size={13} className="flex-shrink-0 mt-0.5 text-accent" />
            <span>Wajib ada elemen <code className="text-accent font-mono font-bold">&lt;a id="wa-cta"&gt;</code> — tombol chat WhatsApp yang ditangani otomatis.</span>
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck size={13} className="flex-shrink-0 mt-0.5 text-accent" />
            <span>Dilarang: <strong className="text-ink">script, iframe, object, embed, form, input</strong>. HTML disanitasi 17-layer.</span>
          </li>
          <li className="flex items-start gap-2">
            <Info size={13} className="flex-shrink-0 mt-0.5 text-accent" />
            <span>Meta Pixel &amp; tracking click otomatis di-inject ke halaman. Events per landing dipilih di editor.</span>
          </li>
          <li className="flex items-start gap-2">
            <Info size={13} className="flex-shrink-0 mt-0.5 text-accent" />
            <span>Perubahan tampil di preview hingga cache klik (TTL 5 menit) — atau instan via purge.</span>
          </li>
        </ul>
      </div>

      {/* Modal panduan integrasi LP eksternal */}
      {isExternalModalOpen && (
        <ExternalIntegrationModal open onClose={() => setIsExternalModalOpen(false)} />
      )}
    </div>
  );
};

