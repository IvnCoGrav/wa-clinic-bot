import React, { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { ExternalIntegrationModal } from '../../components/modals/ExternalIntegrationModal';
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
      metaPixelId: formMetaPixelId.trim() || undefined,
      whatsappNumber: formWhatsappNumber.trim() || undefined,
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Globe className="text-pink-400" size={22} />
            Landing Page
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Kelola banyak landing page per tenant. Upload file HTML mentah (bukan builder visual) atau gunakan template sistem.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg bg-white/5 hover:bg-pink-500/10 text-slate-300 hover:text-pink-400 transition disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={openAddModal}
            className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow-lg shadow-pink-500/10"
          >
            <Plus size={14} />
            <span>Tambah Landing Page</span>
          </button>
        </div>
      </div>

      {/* Card integrasi LP eksternal */}
      <div className="glass-panel border border-white/5 rounded-2xl p-5 space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Link2 className="text-sky-400" size={18} />
              <span>Integrasi Landing Page Eksternal</span>
            </h3>
            <p className="text-[10px] text-slate-400">
              Hubungkan Landing Page luar (WordPress / Elementor / HTML) ke atribusi iklan &amp; WhatsApp. Script disajikan langsung oleh bot.
            </p>
          </div>
          <button
            onClick={() => setIsExternalModalOpen(true)}
            className="px-3 py-2 bg-white/5 hover:bg-pink-500/10 border border-white/10 text-slate-300 hover:text-pink-300 rounded-xl text-[10px] font-bold transition flex items-center gap-1.5"
          >
            <BookOpen size={14} />
            <span>Lihat Panduan Integrasi</span>
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-[260px] flex items-center gap-2 bg-slate-950/70 border border-white/10 rounded-xl px-3 py-2">
            <Code size={14} className="text-pink-400 flex-shrink-0" />
            <input
              readOnly
              value={scriptSnippet}
              onFocus={(e) => e.target.select()}
              className="w-full bg-transparent text-[11px] font-mono text-emerald-300 focus:outline-none"
            />
          </div>
          <button
            onClick={handleCopyScript}
            className={`px-3 py-2 rounded-xl text-[10px] font-bold transition flex items-center gap-1.5 border ${
              copiedScript
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : 'bg-white/5 text-slate-300 border-white/10 hover:bg-pink-500/10 hover:text-pink-300'
            }`}
          >
            {copiedScript ? <Check size={14} /> : <Copy size={14} />}
            <span>{copiedScript ? 'Tersalin!' : 'Salin Script'}</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <RefreshCw className="animate-spin text-pink-500" size={36} />
        </div>
      ) : landings.length === 0 ? (
        <div className="glass-panel border border-white/5 rounded-2xl py-16 text-center text-xs text-slate-500">
          Belum ada landing page. Klik "Tambah Landing Page" untuk mulai.
        </div>
      ) : (
        <div className="glass-panel border border-white/5 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/5 bg-slate-900/40">
                  <th className="px-4 py-3 text-[9px] uppercase font-black text-slate-500">Landing</th>
                  <th className="px-4 py-3 text-[9px] uppercase font-black text-slate-500">Tipe</th>
                  <th className="px-4 py-3 text-[9px] uppercase font-black text-slate-500">Events Pixel</th>
                  <th className="px-4 py-3 text-[9px] uppercase font-black text-slate-500">Pixel</th>
                  <th className="px-4 py-3 text-[9px] uppercase font-black text-slate-500">Status</th>
                  <th className="px-4 py-3 text-[9px] uppercase font-black text-slate-500 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {landings.map((item) => {
                  const isStructured = item.landingType === 'STRUCTURED_JSON';
                  return (
                    <tr
                      key={item.id}
                      className={`border-b border-white/5 hover:bg-white/[0.03] transition-colors ${!item.isActive ? 'opacity-50' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-bold text-white text-xs flex items-center gap-2">
                          {isStructured && <LayoutTemplate size={13} className="text-sky-400" />}
                          <span>{item.title || '(tanpa judul)'}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          /{item.slug}
                          {item.sizeBytes > 0 && <span className="text-slate-600"> · {(item.sizeBytes / 1024).toFixed(1)} KB</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                            isStructured
                              ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          }`}
                        >
                          {isStructured ? 'Template Sistem' : 'HTML Kustom'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {item.events.length === 0 ? (
                          <span className="text-[9px] text-slate-600">PageView saja</span>
                        ) : (
                          <div className="flex flex-wrap gap-1 max-w-[220px]">
                            {item.events.map((ev) => (
                              <span
                                key={ev}
                                className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 text-[8px] font-bold"
                              >
                                {ev}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {item.hasPixelOverride ? (
                          <span className="text-[10px] font-bold text-amber-300">Override</span>
                        ) : (
                          <span className="text-[10px] text-slate-500">Sistem</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleActive(item)}
                          className={`px-2 py-1 rounded text-[9px] font-black transition flex items-center gap-1.5 ${
                            item.isActive
                              ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                              : 'bg-slate-500/10 text-slate-400 hover:bg-slate-500/20'
                          }`}
                          title={item.isActive ? 'Klik untuk nonaktifkan' : 'Klik untuk aktifkan'}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${item.isActive ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                          {item.isActive ? 'Aktif' : 'Nonaktif'}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {item.previewUrl && (
                            <a
                              href={item.previewUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-emerald-500/10 text-slate-300 hover:text-emerald-400 transition"
                              title="Lihat landing page"
                            >
                              <Eye size={14} />
                            </a>
                          )}
                          <button
                            onClick={() => openEditModal(item)}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-pink-500/10 text-slate-300 hover:text-pink-400 transition"
                            title="Edit"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(item)}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-rose-500/10 text-slate-300 hover:text-rose-400 transition"
                            title="Hapus"
                          >
                            <Trash2 size={14} />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="glass-panel border border-white/10 rounded-2xl w-full max-w-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-slate-900/50">
              <h3 className="font-bold text-white text-sm">
                {editing ? `Edit Landing: ${editing.title}` : 'Tambah Landing Page Baru'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4 max-h-[560px] overflow-y-auto">
              {fileError && (
                <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
                  <AlertTriangle size={14} />
                  <span>{fileError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-bold block">Judul Landing Page</label>
                  <input
                    type="text"
                    required
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="Contoh: Promo Baby Massage"
                    className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-pink-500/50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-bold block">Slug (URL)</label>
                  <input
                    type="text"
                    required
                    value={formSlug}
                    onChange={(e) => setFormSlug(normalizeSlug(e.target.value))}
                    placeholder="promo-baby"
                    className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-pink-500/50"
                  />
                  {formSlug && (
                    <p className="text-[9px] text-slate-500 font-mono truncate">
                      {previewBaseUrl}/
                      <span className="text-pink-400">{formSlug}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] text-slate-400 uppercase font-bold block">Konten</label>
                <button
                  type="button"
                  onClick={() => setFormUseCustomHtml(!formUseCustomHtml)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition ${
                    formUseCustomHtml
                      ? 'border-pink-500/40 bg-pink-500/10'
                      : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {formUseCustomHtml ? <FileCode2 size={18} className="text-pink-400" /> : <LayoutTemplate size={18} className="text-sky-400" />}
                    <div>
                      <div className="text-xs font-bold text-white">
                        {formUseCustomHtml ? 'HTML Kustom (RAW_HTML)' : 'Template Sistem (STRUCTURED_JSON)'}
                      </div>
                      <div className="text-[9px] text-slate-500 mt-0.5">
                        {formUseCustomHtml
                          ? 'File HTML disanitasi 17-layer & disajikan apa adanya.'
                          : 'Template bawaan (teks terstruktur), tanpa upload file.'}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`w-9 h-5 rounded-full transition relative ${
                      formUseCustomHtml ? 'bg-pink-500' : 'bg-slate-600'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                        formUseCustomHtml ? 'left-4.5 right-0.5' : 'left-0.5'
                      }`}
                      style={{ left: formUseCustomHtml ? '1.125rem' : '0.125rem' }}
                    />
                  </span>
                </button>

                {formUseCustomHtml && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-[10px] font-bold text-slate-300 hover:text-white flex items-center gap-1.5 transition"
                      >
                        <Upload size={12} />
                        <span>Upload File .html</span>
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".html,.htm,text/html"
                        className="hidden"
                        onChange={handleFile}
                      />
                      <span className={byteLength(formHtml) > MAX_HTML_BYTES ? 'text-rose-400 font-bold' : 'text-slate-500'}>
                        {(byteLength(formHtml) / 1024).toFixed(1)} / 500 KB
                      </span>
                    </div>
                    <textarea
                      value={formHtml}
                      onChange={(e) => setFormHtml(e.target.value)}
                      spellCheck={false}
                      placeholder="Tempel atau tulis HTML di sini. Wajib ada elemen <a id='wa-cta'> untuk tombol chat WhatsApp."
                      className="w-full h-[180px] p-3 bg-slate-950 border border-white/10 rounded-xl text-[11px] font-mono text-slate-200 focus:outline-none focus:border-pink-500/50 resize-y"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-bold block">
                    Override Meta Pixel ID <span className="text-slate-600 normal-case">(kosongkan = pakai sistem)</span>
                  </label>
                  <input
                    type="text"
                    value={formMetaPixelId}
                    onChange={(e) => setFormMetaPixelId(e.target.value)}
                    placeholder="Contoh: 123456789012345"
                    className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-pink-500/50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 uppercase font-bold block">
                    Override No. WhatsApp <span className="text-slate-600 normal-case">(kosongkan = pakai sistem)</span>
                  </label>
                  <input
                    type="text"
                    value={formWhatsappNumber}
                    onChange={(e) => setFormWhatsappNumber(e.target.value)}
                    placeholder="Contoh: 628123456789"
                    className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-pink-500/50"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] text-slate-400 uppercase font-bold block">
                  Events Pixel Browser <span className="text-slate-600 normal-case">(PageView selalu di-fire)</span>
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
                        className={`px-2 py-1 rounded-lg text-[9px] font-bold border transition disabled:cursor-not-allowed ${
                          active
                            ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                            : 'bg-white/[0.03] text-slate-500 border-white/10 hover:text-slate-300'
                        }`}
                      >
                        {active && !locked && <Check size={9} className="inline mr-1" />}
                        {ev}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[9px] text-slate-600">
                  ViewContent &amp; Search di-fire saat halaman dibuka (setelah PageView). Lead, Purchase, dll di-fire saat klik CTA sebelum redirect.
                </p>
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="formIsActive"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="rounded bg-slate-950 border-white/10 text-pink-500 focus:ring-pink-500/20"
                />
                <label htmlFor="formIsActive" className="text-xs text-slate-300 font-semibold cursor-pointer">
                  Aktifkan landing page ini (aktif = bisa diakses via slug)
                </label>
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl text-xs font-bold transition flex items-center space-x-1"
                >
                  <X size={14} />
                  <span>Batal</span>
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-pink-500 hover:bg-pink-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-black transition flex items-center space-x-1"
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
      <div className="glass-panel border border-white/5 rounded-2xl p-5 space-y-3">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <ShieldCheck className="text-pink-400" size={18} />
          <span>Aturan Upload</span>
        </h3>
        <ul className="space-y-2 text-[10px] text-slate-400 list-none">
          <li className="flex items-start gap-2">
            <Info size={12} className="flex-shrink-0 mt-0.5 text-pink-400" />
            <span>Maksimal <b>500 KB</b> per file HTML.</span>
          </li>
          <li className="flex items-start gap-2">
            <MousePointerClick size={12} className="flex-shrink-0 mt-0.5 text-pink-400" />
            <span>Wajib ada elemen <b>&lt;a id="wa-cta"&gt;</b> — tombol chat WhatsApp yang ditangani otomatis.</span>
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck size={12} className="flex-shrink-0 mt-0.5 text-pink-400" />
            <span>Dilarang: <b>script, iframe, object, embed, form, input</b>. HTML disanitasi 17-layer.</span>
          </li>
          <li className="flex items-start gap-2">
            <Info size={12} className="flex-shrink-0 mt-0.5 text-pink-400" />
            <span>Meta Pixel &amp; tracking click otomatis di-inject ke halaman. Events per landing dipilih di editor.</span>
          </li>
          <li className="flex items-start gap-2">
            <Info size={12} className="flex-shrink-0 mt-0.5 text-pink-400" />
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
