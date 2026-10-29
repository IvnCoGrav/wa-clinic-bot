import React, { useEffect, useState, useMemo, useRef } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { BRAND } from '../../config/brand';
import {
  Zap,
  Plus,
  Edit2,
  Trash2,
  Search,
  RefreshCw,
  X,
  Save,
  Layers,
  Tag,
  Database,
  Eye,
  QrCode,
  Image as ImageIcon,
  UploadCloud,
  AlertCircle,
  FileText,
} from 'lucide-react';
import { compressImageFile, resolveCompressProfile } from '../../utils/imageCompressor';

interface QuickReply {
  id: string;
  tenant_id?: string;
  shortcut: string;
  title: string;
  content: string;
  category: string | null;
  media_type?: 'NONE' | 'CUSTOM_IMAGE' | 'QRIS' | 'PRICELIST' | null;
  image_url?: string | null;
  mime_type?: string | null;
  created_at?: string;
  updated_at?: string;
}

const CATEGORIES = ['Semua', 'Pembayaran', 'Lokasi', 'Reservasi', 'Umum'];
const PLACEHOLDERS = [
  { tag: '{name}', label: 'Nama Customer' },
  { tag: '{phone}', label: 'No WhatsApp' },
  { tag: '{kec}', label: 'Kecamatan' },
  { tag: '{kota}', label: 'Kota' },
  { tag: '{alamat}', label: 'Alamat / Kelurahan' },
  { tag: '{clinic_name}', label: 'Nama Klinik' },
  { tag: '{admin_name}', label: 'Nama Admin/Bidan' },
  { tag: '{bank_accounts}', label: 'Daftar Rekening Bank' },
  { tag: '{petunjuk}', label: 'Petunjuk Pembayaran' },
];



function interpolatePreview(content: string, pInfo?: any): string {
  let text = content
    .replace(/\{(?:name|nama|nama_bunda)\}/gi, 'Bunda Retno')
    .replace(/\{(?:phone|hp|no_hp)\}/gi, '628123456789')
    .replace(/\{(?:kec|kecamatan)\}/gi, 'Rungkut')
    .replace(/\{kota\}/gi, 'Surabaya')
    .replace(/\{(?:alamat|address)\}/gi, 'Jl. Rungkut Asri Timur No. 12')
    .replace(/\{clinic_name\}/gi, BRAND.businessName)
    .replace(/\{admin_name\}/gi, 'Kak Sinta');

  if (pInfo?.bankAccounts && Array.isArray(pInfo.bankAccounts) && pInfo.bankAccounts.length > 0) {
    const bAcc = pInfo.bankAccounts.map((a: any) => `• *${a.bank}*: \`${a.accountNumber}\`\n  a.n ${a.accountName}`).join('\n');
    text = text.replace(/\{bank_accounts\}/g, bAcc);
  } else {
    text = text.replace(/\{bank_accounts\}/g, '• *BCA*: `1234567890`\n  a.n Kala Moms & Baby Spa');
  }
  text = text.replace(/\{petunjuk\}/g, pInfo?.instructions?.trim() || 'Mohon konfirmasi atau kirimkan bukti transfer');
  return text;
}

export const QuickReplies: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Semua');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<QuickReply | null>(null);
  const [formShortcut, setFormShortcut] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formCategory, setFormCategory] = useState('Umum');
  const [formMediaType, setFormMediaType] = useState<'NONE' | 'CUSTOM_IMAGE' | 'QRIS' | 'PRICELIST'>('NONE');
  const [customImageFile, setCustomImageFile] = useState<File | null>(null);
  const [customImagePreview, setCustomImagePreview] = useState<string | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<{
    qrisImageUrl?: string | null;
    bankAccounts?: Array<{ bank: string; accountNumber: string; accountName: string }>;
    instructions?: string;
  } | null>(null);
  const [pricelistImageUrl, setPricelistImageUrl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res: any = await apiRequest('/api/admin/quick-replies');
      const data = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      setItems(data);
    } catch (err: any) {
      toast(`Gagal memuat balasan cepat: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadPaymentInfo = async () => {
    try {
      const res: any = await apiRequest('/api/admin/settings/payment-info');
      const data = res?.data || res;
      if (data) setPaymentInfo(data);
    } catch (_) {}
  };

  const loadPricelistImage = async () => {
    try {
      const res: any = await apiRequest('/api/admin/settings/pricelist-image');
      const d = res?.data || res;
      setPricelistImageUrl(d?.pricelistImageUrl || null);
    } catch (_) {}
  };

  useEffect(() => {
    load();
    loadPaymentInfo();
    loadPricelistImage();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((it) => {
      if (categoryFilter !== 'Semua' && (it.category || 'Umum') !== categoryFilter) return false;
      if (!q) return true;
      return (
        it.shortcut.toLowerCase().includes(q) ||
        it.title.toLowerCase().includes(q) ||
        it.content.toLowerCase().includes(q)
      );
    });
  }, [items, search, categoryFilter]);

  const openCreate = () => {
    setEditing(null);
    setFormShortcut('');
    setFormTitle('');
    setFormContent('');
    setFormCategory('Umum');
    setFormMediaType('NONE');
    setCustomImageFile(null);
    setCustomImagePreview(null);
    setShowModal(true);
  };

  const openEdit = (it: QuickReply) => {
    setEditing(it);
    setFormShortcut(it.shortcut);
    setFormTitle(it.title);
    setFormContent(it.content);
    setFormCategory(it.category || 'Umum');
    setFormMediaType(it.media_type === 'PRICELIST' ? 'PRICELIST' : it.media_type === 'QRIS' ? 'QRIS' : it.media_type === 'CUSTOM_IMAGE' ? 'CUSTOM_IMAGE' : 'NONE');
    setCustomImageFile(null);
    setCustomImagePreview(it.image_url || null);
    setShowModal(true);
  };

  const handleSave = async () => {
    const shortcutRaw = formShortcut.trim().replace(/^\//, '').toLowerCase();
    if (!shortcutRaw || !formTitle.trim() || !formContent.trim()) {
      toast('Shortcut, judul, dan isi wajib diisi.', 'error');
      return;
    }
    setSaving(true);
    try {
      let imageB64: string | undefined = undefined;
      let mimeType: string | undefined = undefined;
      let fileName: string | undefined = undefined;

      if (formMediaType === 'CUSTOM_IMAGE' && customImageFile) {
        const p = resolveCompressProfile('chat');
        const c = await compressImageFile(customImageFile, { maxWidth: p.maxWidth, maxHeight: p.maxHeight, quality: p.quality });
        imageB64 = c.dataUrl;
        mimeType = 'image/jpeg';
        fileName = customImageFile.name.replace(/\.\w+$/, '') + '.jpg';
      }

      const payload: any = {
        shortcut: shortcutRaw,
        title: formTitle.trim(),
        content: formContent.trim(),
        category: formCategory,
        media_type: formMediaType,
        image_url: formMediaType === 'CUSTOM_IMAGE' ? (customImagePreview || null) : null,
        imageB64,
        mimeType,
        fileName,
      };

      if (editing) {
        await apiRequest(`/api/admin/quick-replies/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        toast('Balasan cepat diperbarui.', 'success');
      } else {
        await apiRequest('/api/admin/quick-replies', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast('Balasan cepat dibuat.', 'success');
      }
      setShowModal(false);
      await load();
    } catch (err: any) {
      toast(err.message || 'Gagal menyimpan.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (it: QuickReply) => {
    const ok = await confirm({
      title: `Hapus /${it.shortcut}?`,
      message: `Template "${it.title}" akan dihapus permanen.`,
      confirmText: 'Ya, Hapus',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiRequest(`/api/admin/quick-replies/${it.id}`, { method: 'DELETE' });
      toast(`Balasan /${it.shortcut} dihapus.`, 'success');
      await load();
    } catch (err: any) {
      toast(err.message || 'Gagal menghapus.', 'error');
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      await apiRequest('/api/admin/quick-replies/seed-defaults', { method: 'POST' });
      toast('Template bawaan klinik berhasil di-seed.', 'success');
      await load();
    } catch (err: any) {
      toast(err.message || 'Gagal seed.', 'error');
    } finally {
      setSeeding(false);
    }
  };

  const insertPlaceholder = (tag: string) => {
    setFormContent((prev) => prev + tag);
  };

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-16">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-surface p-5 rounded-2xl border border-divider shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-soft border border-divider flex items-center justify-center text-accent">
            <Zap size={22} />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-ink">Balasan Cepat (Quick Chat)</h2>
            <p className="text-xs text-ink-2 mt-0.5">Ketik <code className="bg-fill-1 px-1 rounded text-accent">/shortcut</code> di Live Chat untuk balasan instan dengan variabel & media dinamis.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="h-9 px-3 rounded-xl bg-surface border border-divider text-xs font-semibold text-ink hover:bg-fill-1 flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={handleSeed} disabled={seeding} className="h-9 px-3 rounded-xl bg-surface border border-warning-line text-xs font-semibold text-warning hover:bg-warning-soft flex items-center gap-1.5 disabled:opacity-50">
            <Database size={14} /> {seeding ? 'Seeding...' : 'Seed Default'}
          </button>
          <button onClick={openCreate} className="h-9 px-4 rounded-xl bg-accent hover:bg-accent-hover text-accent-ink text-xs font-bold flex items-center gap-1.5 shadow-xs">
            <Plus size={14} /> Tambah Template
          </button>
        </div>
      </div>

      {/* Variabel guide */}
      <div className="bg-surface-2 border border-divider rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row items-start justify-between gap-3">
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs font-bold text-ink mr-1">Variabel:</span>
          {PLACEHOLDERS.map((p) => (
            <span key={p.tag} className="inline-flex items-center bg-surface px-2 py-1 rounded-xl border border-divider text-xs shadow-xs">
              <code className="text-accent font-mono font-bold mr-1">{p.tag}</code>
              <span className="text-[11px] text-ink-2">— {p.label}</span>
            </span>
          ))}
        </div>
        <span className="text-[11px] text-ink-2 bg-surface/70 px-2.5 py-1 rounded-xl border border-divider/60">Contoh: <code className="text-accent">Halo Bunda {'{name}'}!</code> → Halo Bunda Retno!</span>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {CATEGORIES.map((cat) => {
            const isActive = categoryFilter === cat;
            const count = cat === 'Semua' ? items.length : items.filter((i) => (i.category || 'Umum') === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`h-8 px-3 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 ${isActive ? 'bg-accent text-accent-ink shadow-sm' : 'bg-surface border border-divider dark:border-divider text-ink-2 hover:bg-fill-1'}`}
              >
                {cat === 'Semua' ? <Layers size={13} /> : <Tag size={13} />}
                {cat}
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${isActive ? 'bg-white/20' : 'bg-fill-1'}`}>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="relative min-w-[220px] sm:max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari shortcut / judul / isi..." className="w-full h-9 pl-9 pr-8 bg-surface border border-divider text-ink placeholder:text-ink-3 rounded-xl text-xs focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3"><X size={14} /></button>}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 bg-surface border border-divider rounded-2xl">
          <RefreshCw className="animate-spin text-accent mb-2" size={28} /><p className="text-xs text-ink-2">Memuat balasan cepat...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-14 bg-surface border border-divider rounded-2xl">
          <Zap size={32} className="mx-auto text-ink-3 opacity-50 mb-2" /><p className="text-sm font-bold text-ink">Belum ada template</p><p className="text-xs text-ink-3 mt-1">Buat template pertama atau klik Seed Default untuk template bawaan klinik.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((it) => (
            <div key={it.id} className="bg-surface border border-divider rounded-2xl p-4 flex flex-col gap-3 hover:border-divider dark:hover:border-accent/40 hover:shadow-sm transition">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                  <span className="px-2 py-1 rounded-lg bg-accent text-accent-ink text-xs font-mono font-bold">/{it.shortcut}</span>
                  {it.category && <span className="px-2 py-0.5 rounded-full bg-fill-1 text-ink-2 text-[10px] font-bold border border-divider">{it.category}</span>}
                  {it.media_type === 'QRIS' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success-soft text-success text-[10px] font-bold border border-success-line">
                      <QrCode size={11} /> QRIS
                    </span>
                  )}
                  {it.media_type === 'PRICELIST' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success-soft text-success text-[10px] font-bold border border-success-line">
                      <FileText size={11} /> Pricelist
                    </span>
                  )}
                  {(it.media_type === 'CUSTOM_IMAGE' || (!it.media_type && it.image_url)) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-info-soft text-info text-[10px] font-bold border border-info-line">
                      <ImageIcon size={11} /> Gambar
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openEdit(it)} className="p-1.5 rounded-lg bg-surface border border-divider text-ink-2 hover:text-accent hover:border-accent"><Edit2 size={13} /></button>
                  <button onClick={() => handleDelete(it)} className="p-1.5 rounded-lg bg-surface border border-divider text-ink-2 hover:text-danger hover:border-danger-line hover:bg-danger-soft"><Trash2 size={13} /></button>
                </div>
              </div>

              {it.image_url && (
                <div className="flex items-center gap-2.5 p-2 bg-surface-2 border border-divider rounded-xl">
                  <img
                    src={it.image_url}
                    alt={it.title}
                    className="w-11 h-11 rounded-lg object-contain border border-divider bg-surface shrink-0 p-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold text-ink truncate">
                      {it.media_type === 'QRIS' ? 'Barcode QRIS Resmi' : it.media_type === 'PRICELIST' ? 'Pricelist Resmi' : 'Lampiran Gambar'}
                    </p>
                    <p className="text-[10px] text-ink-3 truncate">Otomatis dilampirkan ke chat</p>
                  </div>
                </div>
              )}

              <div>
                <p className="text-sm font-bold text-ink truncate">{it.title}</p>
                <p className="text-xs text-ink-2 line-clamp-3 whitespace-pre-wrap leading-relaxed mt-1 bg-surface-2 border border-divider rounded-xl p-2.5">{it.content}</p>
              </div>
              <div className="pt-2 border-t border-divider dark:border-divider flex items-center gap-1.5 text-[11px] text-ink-3">
                <Eye size={12} /> Preview: <span className="text-ink-2 line-clamp-1 truncate flex-1">{interpolatePreview(it.content, paymentInfo).slice(0, 70)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-surface rounded-2xl w-full max-w-lg shadow-2xl border border-divider max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-divider bg-surface-2">
              <h3 className="text-sm font-bold text-ink flex items-center gap-2"><Zap size={16} className="text-accent" /> {editing ? 'Edit Balasan Cepat' : 'Tambah Balasan Cepat'}</h3>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-xl hover:bg-fill-1 text-ink-3"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-ink">Shortcut <span className="text-danger">*</span></label>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="px-2 py-2 bg-fill-1 border border-divider rounded-xl text-xs font-mono text-accent">/</span>
                    <input value={formShortcut} onChange={(e) => setFormShortcut(e.target.value.replace(/^\//, '').toLowerCase().replace(/\s+/g, ''))} placeholder="qris" className="flex-1 h-9 px-3 bg-surface border border-divider text-ink rounded-xl text-xs focus:outline-none focus:border-accent font-mono" />
                  </div>
                  <p className="text-[10px] text-ink-3 mt-1">Huruf kecil, tanpa spasi. Contoh: /qris</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink">Kategori</label>
                  <select value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className="w-full mt-1 h-9 px-2 bg-surface border border-divider text-ink rounded-xl text-xs focus:outline-none focus:border-accent">
                    <option>Pembayaran</option><option>Lokasi</option><option>Reservasi</option><option>Umum</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-ink">Judul <span className="text-danger">*</span></label>
                <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Contoh: Pembayaran QRIS & Rekening Resmi" className="w-full mt-1 h-9 px-3 bg-surface border border-divider text-ink rounded-xl text-xs focus:outline-none focus:border-accent" />
              </div>

              {/* Pilihan Lampiran Media */}
              <div>
                <label className="text-xs font-semibold text-ink block mb-1.5">Tipe Lampiran Media</label>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormMediaType('NONE')}
                    className={`p-2.5 rounded-xl border text-left transition flex flex-col gap-1 ${
                      formMediaType === 'NONE'
                        ? 'bg-accent-soft border-accent text-accent'
                        : 'bg-surface border-divider text-ink-2 hover:bg-surface-2 dark:hover:bg-fill-2'
                    }`}
                  >
                    <span className="text-xs font-bold flex items-center gap-1.5">
                      <Zap size={13} /> Teks Saja
                    </span>
                    <span className="text-[10px] text-ink-3">Tanpa gambar</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setFormMediaType('QRIS');
                      if (!formContent.trim()) {
                        setFormContent(
                          'Berikut barcode QRIS & rekening resmi kami ya Bunda {name} ✨\n\n' +
                          '{bank_accounts}\n\n' +
                          '{petunjuk}\n\n' +
                          'Mohon kirimkan bukti transfer ke sini setelah pembayaran ya. Terima kasih 🙏'
                        );
                      }
                    }}
                    className={`p-2.5 rounded-xl border text-left transition flex flex-col gap-1 ${
                      formMediaType === 'QRIS'
                        ? 'bg-accent-soft border-accent text-accent'
                        : 'bg-surface border-divider text-ink-2 hover:bg-surface-2 dark:hover:bg-fill-2'
                    }`}
                  >
                    <span className="text-xs font-bold flex items-center gap-1.5">
                      <QrCode size={13} /> QRIS Resmi
                    </span>
                    <span className="text-[10px] text-ink-3">SSOT Pembayaran</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setFormMediaType('PRICELIST');
                      if (!formContent.trim()) {
                        setFormContent(
                          'Berikut pricelist dan daftar treatment lengkap di {clinic_name} ya Bunda {name} ✨\n\n' +
                          'Silakan dilihat-lihat terlebih dahulu, jika ada keluhan si kecil atau ingin konsultasi treatment yang cocok, boleh kabari kami ya Bunda 🙏'
                        );
                      }
                    }}
                    className={`p-2.5 rounded-xl border text-left transition flex flex-col gap-1 ${
                      formMediaType === 'PRICELIST'
                        ? 'bg-accent-soft border-accent text-accent'
                        : 'bg-surface border-divider text-ink-2 hover:bg-surface-2 dark:hover:bg-fill-2'
                    }`}
                  >
                    <span className="text-xs font-bold flex items-center gap-1.5">
                      <FileText size={13} /> Pricelist Resmi
                    </span>
                    <span className="text-[10px] text-ink-3">SSOT Pricelist</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormMediaType('CUSTOM_IMAGE')}
                    className={`p-2.5 rounded-xl border text-left transition flex flex-col gap-1 ${
                      formMediaType === 'CUSTOM_IMAGE'
                        ? 'bg-accent-soft border-accent text-accent'
                        : 'bg-surface border-divider text-ink-2 hover:bg-surface-2 dark:hover:bg-fill-2'
                    }`}
                  >
                    <span className="text-xs font-bold flex items-center gap-1.5">
                      <ImageIcon size={13} /> Gambar Kustom
                    </span>
                    <span className="text-[10px] text-ink-3">Upload brosur/foto</span>
                  </button>
                </div>
              </div>

              {/* Panel Media QRIS */}
              {formMediaType === 'QRIS' && (
                <div className="p-3 bg-surface-2 border border-divider rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-ink flex items-center gap-1.5">
                      <QrCode size={14} className="text-accent" /> Preview Barcode QRIS Resmi
                    </span>
                    <span className="text-[10px] bg-success-soft text-accent px-2 py-0.5 rounded-full font-bold border border-success-line">
                      Terkait Settings Pembayaran
                    </span>
                  </div>
                  {paymentInfo?.qrisImageUrl ? (
                    <div className="flex items-center gap-3">
                      <img
                        src={paymentInfo.qrisImageUrl}
                        alt="QRIS Klinik"
                        className="w-16 h-16 object-contain rounded-lg border border-divider bg-surface p-1"
                      />
                      <div className="text-[11px] text-ink-2 space-y-1">
                        <p className="font-semibold text-ink">Barcode QRIS aktif terdeteksi.</p>
                        <p className="text-[10px] text-ink-3">Gambar ini otomatis dilampirkan saat shortcut dikirim di Live Chat.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-2.5 bg-warning-soft border border-warning-line rounded-lg text-warning text-[11px] flex items-start gap-2">
                      <AlertCircle size={15} className="shrink-0 mt-0.5 text-warning" />
                      <div>
                        <p className="font-bold">QRIS belum diunggah di Settings Pembayaran.</p>
                        <p className="text-[10px] text-warning mt-0.5">
                          Shortcut tetap dapat digunakan dan mengirim teks rekening. Unggah QRIS di menu Settings → Pembayaran untuk melampirkan barcode gambar secara otomatis.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Panel Media PRICELIST */}
              {formMediaType === 'PRICELIST' && (
                <div className="p-3 bg-surface-2 border border-divider rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-ink flex items-center gap-1.5">
                      <FileText size={14} className="text-accent" /> Preview Pricelist Resmi
                    </span>
                    <span className="text-[10px] bg-success-soft text-accent px-2 py-0.5 rounded-full font-bold border border-success-line">
                      Terkait Settings Pricelist
                    </span>
                  </div>
                  {pricelistImageUrl ? (
                    <div className="flex items-center gap-3">
                      <img
                        src={pricelistImageUrl}
                        alt="Pricelist Klinik"
                        className="w-16 h-16 object-contain rounded-lg border border-divider bg-surface p-1"
                      />
                      <div className="text-[11px] text-ink-2 space-y-1">
                        <p className="font-semibold text-ink">Brosur Pricelist aktif terdeteksi.</p>
                        <p className="text-[10px] text-ink-3">Gambar ini otomatis dilampirkan saat shortcut dikirim di Live Chat.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-2.5 bg-warning-soft border border-warning-line rounded-lg text-warning text-[11px] flex items-start gap-2">
                      <AlertCircle size={15} className="shrink-0 mt-0.5 text-warning" />
                      <div>
                        <p className="font-bold">Pricelist belum diunggah di menu Settings → Pricelist.</p>
                        <p className="text-[10px] text-warning mt-0.5">
                          Shortcut tetap dapat digunakan dan mengirim teks katalog. Unggah gambar pricelist di Settings → Pricelist untuk melampirkan brosur secara otomatis.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Panel Media Gambar Kustom */}
              {formMediaType === 'CUSTOM_IMAGE' && (
                <div className="p-3 bg-surface-2 border border-divider rounded-xl space-y-2">
                  <label className="text-xs font-bold text-ink flex items-center gap-1.5">
                    <ImageIcon size={14} className="text-accent" /> Upload Gambar / Brosur (Maks 8 MB)
                  </label>
                  {customImagePreview ? (
                    <div className="flex items-center gap-3">
                      <img
                        src={customImagePreview}
                        alt="Preview"
                        className="w-16 h-16 object-contain rounded-lg border border-divider bg-surface p-1"
                      />
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <p className="text-xs font-semibold text-ink truncate">
                          {customImageFile ? customImageFile.name : 'Gambar tersimpan'}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="text-[11px] px-2.5 py-1 rounded-lg bg-surface border border-divider text-ink-2 hover:bg-fill-1 font-semibold"
                          >
                            Ganti Gambar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomImageFile(null);
                              setCustomImagePreview(null);
                            }}
                            className="text-[11px] px-2.5 py-1 rounded-lg bg-danger-soft border border-danger-line text-danger hover:bg-danger-line font-semibold"
                          >
                            Hapus
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-divider hover:border-accent rounded-xl p-4 text-center cursor-pointer transition bg-surface"
                    >
                      <UploadCloud size={24} className="mx-auto text-ink-3 mb-1" />
                      <p className="text-xs font-bold text-ink">Klik untuk memilih gambar</p>
                      <p className="text-[10px] text-ink-3 mt-0.5">PNG, JPG, WEBP hingga 8 MB</p>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 8 * 1024 * 1024) {
                        toast('Ukuran gambar maksimal 8 MB.', 'error');
                        return;
                      }
                      setCustomImageFile(file);
                      setCustomImagePreview(URL.createObjectURL(file));
                    }}
                  />
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-ink">Isi Template <span className="text-danger">*</span></label>
                <div className="flex flex-wrap gap-1 mt-1.5 mb-1.5">
                  {PLACEHOLDERS.map((p) => (
                    <button key={p.tag} type="button" onClick={() => insertPlaceholder(p.tag)} className="px-2 py-1 bg-surface border border-divider hover:border-accent hover:bg-accent-soft text-accent rounded-lg text-[11px] font-mono font-bold">+{p.tag}</button>
                  ))}
                </div>
                <textarea value={formContent} onChange={(e) => setFormContent(e.target.value)} rows={5} placeholder="Tulis template... gunakan {name} {clinic_name} {bank_accounts} dll." className="w-full p-3 bg-surface border border-divider rounded-xl text-xs leading-relaxed focus:outline-none focus:border-accent resize-none" />
              </div>

              <div className="bg-surface-2 border border-divider rounded-xl p-3">
                <p className="text-[11px] font-bold text-accent flex items-center gap-1"><Eye size={12} /> Live Preview</p>
                <p className="text-xs text-ink whitespace-pre-wrap leading-relaxed mt-1">{formContent ? interpolatePreview(formContent, paymentInfo) : <span className="text-ink-3 italic">Preview akan muncul di sini...</span> as any}</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-divider bg-surface-2">
              <button onClick={() => setShowModal(false)} className="h-9 px-4 rounded-xl bg-surface border border-divider text-xs font-semibold text-ink-2 hover:bg-fill-1">Batal</button>
              <button onClick={handleSave} disabled={saving} className="h-9 px-4 rounded-xl bg-accent hover:bg-accent-hover text-accent-ink text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"><Save size={14} /> {saving ? 'Menyimpan...' : 'Simpan Template'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuickReplies;
