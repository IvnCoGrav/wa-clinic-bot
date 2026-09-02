import React, { useEffect, useState, useMemo } from 'react';
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
  Sparkles,
  Eye,
} from 'lucide-react';

interface QuickReply {
  id: string;
  tenant_id?: string;
  shortcut: string;
  title: string;
  content: string;
  category: string | null;
  created_at?: string;
  updated_at?: string;
}

const CATEGORIES = ['Semua', 'Pembayaran', 'Lokasi', 'Reservasi', 'Umum'];
const PLACEHOLDERS = [
  { tag: '{name}', label: 'Nama Customer' },
  { tag: '{phone}', label: 'No WhatsApp' },
  { tag: '{clinic_name}', label: 'Nama Klinik' },
  { tag: '{admin_name}', label: 'Nama Admin/Bidan' },
];

function interpolatePreview(content: string): string {
  return content
    .replace(/\{name\}/g, 'Bunda Retno')
    .replace(/\{phone\}/g, '628123456789')
    .replace(/\{clinic_name\}/g, BRAND.businessName)
    .replace(/\{admin_name\}/g, 'Kak Sinta');
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
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);

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

  useEffect(() => {
    load();
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
    setShowModal(true);
  };

  const openEdit = (it: QuickReply) => {
    setEditing(it);
    setFormShortcut(it.shortcut);
    setFormTitle(it.title);
    setFormContent(it.content);
    setFormCategory(it.category || 'Umum');
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
      if (editing) {
        await apiRequest(`/api/admin/quick-replies/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify({ shortcut: shortcutRaw, title: formTitle.trim(), content: formContent.trim(), category: formCategory }),
        });
        toast('Balasan cepat diperbarui.', 'success');
      } else {
        await apiRequest('/api/admin/quick-replies', {
          method: 'POST',
          body: JSON.stringify({ shortcut: shortcutRaw, title: formTitle.trim(), content: formContent.trim(), category: formCategory }),
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-[#e9edef] shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#e8f5f2] border border-[#c2e7e0] flex items-center justify-center text-[#008069]">
            <Zap size={22} />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#111b21]">Balasan Cepat (Quick Chat)</h2>
            <p className="text-xs text-[#54656f] mt-0.5">Ketik <code className="bg-[#f0f2f5] px-1 rounded text-[#008069]">/shortcut</code> di Live Chat untuk balasan instan dengan variabel dinamis.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="h-9 px-3 rounded-xl bg-white border border-[#d1d7db] text-xs font-semibold text-[#111b21] hover:bg-[#f0f2f5] flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={handleSeed} disabled={seeding} className="h-9 px-3 rounded-xl bg-white border border-amber-200 text-xs font-semibold text-amber-700 hover:bg-amber-50 flex items-center gap-1.5 disabled:opacity-50">
            <Sparkles size={14} /> {seeding ? 'Seeding...' : 'Seed Default'}
          </button>
          <button onClick={openCreate} className="h-9 px-4 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold flex items-center gap-1.5 shadow-xs">
            <Plus size={14} /> Tambah Template
          </button>
        </div>
      </div>

      {/* Variabel guide */}
      <div className="bg-gradient-to-r from-[#f0fdf4] to-[#e8f5f2] border border-[#c2e7e0] rounded-2xl p-4 shadow-xs flex flex-col sm:flex-row items-start justify-between gap-3">
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs font-bold text-[#111b21] mr-1">Variabel:</span>
          {PLACEHOLDERS.map((p) => (
            <span key={p.tag} className="inline-flex items-center bg-white px-2 py-1 rounded-xl border border-[#c2e7e0] text-xs shadow-xs">
              <code className="text-[#008069] font-mono font-bold mr-1">{p.tag}</code>
              <span className="text-[11px] text-[#54656f]">— {p.label}</span>
            </span>
          ))}
        </div>
        <span className="text-[11px] text-[#54656f] bg-white/70 px-2.5 py-1 rounded-xl border border-[#c2e7e0]/60">Contoh: <code className="text-[#008069]">Halo Bunda {'{name}'}!</code> → Halo Bunda Retno!</span>
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
                className={`h-8 px-3 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 ${isActive ? 'bg-[#008069] text-white shadow-sm' : 'bg-white border border-[#d1d7db] text-[#54656f] hover:bg-[#f0f2f5]'}`}
              >
                {cat === 'Semua' ? <Layers size={13} /> : <Tag size={13} />}
                {cat}
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${isActive ? 'bg-white/20' : 'bg-[#f0f2f5]'}`}>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="relative min-w-[220px] sm:max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8696a0]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari shortcut / judul / isi..." className="w-full h-9 pl-9 pr-8 bg-white border border-[#d1d7db] rounded-xl text-xs focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069]" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8696a0]"><X size={14} /></button>}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 bg-white border border-[#e9edef] rounded-2xl">
          <RefreshCw className="animate-spin text-[#008069] mb-2" size={28} /><p className="text-xs text-[#54656f]">Memuat balasan cepat...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-14 bg-white border border-[#e9edef] rounded-2xl">
          <Zap size={32} className="mx-auto text-[#8696a0] opacity-50 mb-2" /><p className="text-sm font-bold text-[#111b21]">Belum ada template</p><p className="text-xs text-[#667781] mt-1">Buat template pertama atau klik Seed Default untuk template bawaan klinik.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((it) => (
            <div key={it.id} className="bg-white border border-[#e9edef] rounded-2xl p-4 flex flex-col gap-3 hover:border-[#c2e7e0] hover:shadow-sm transition">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-2 py-1 rounded-lg bg-[#008069] text-white text-xs font-mono font-bold">/{it.shortcut}</span>
                  {it.category && <span className="px-2 py-0.5 rounded-full bg-[#f0f2f5] text-[#54656f] text-[10px] font-bold border border-[#e9edef]">{it.category}</span>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => openEdit(it)} className="p-1.5 rounded-lg bg-white border border-[#d1d7db] text-[#54656f] hover:text-[#008069] hover:border-[#008069]"><Edit2 size={13} /></button>
                  <button onClick={() => handleDelete(it)} className="p-1.5 rounded-lg bg-white border border-[#d1d7db] text-[#54656f] hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50"><Trash2 size={13} /></button>
                </div>
              </div>
              <div>
                <p className="text-sm font-bold text-[#111b21] truncate">{it.title}</p>
                <p className="text-xs text-[#54656f] line-clamp-3 whitespace-pre-wrap leading-relaxed mt-1 bg-[#f8fafc] border border-[#e9edef] rounded-xl p-2.5">{it.content}</p>
              </div>
              <div className="pt-2 border-t border-[#f0f2f5] flex items-center gap-1.5 text-[11px] text-[#8696a0]">
                <Eye size={12} /> Preview: <span className="text-[#54656f] line-clamp-1 truncate flex-1">{interpolatePreview(it.content).slice(0, 70)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl border border-[#e9edef] max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#e9edef] bg-[#f8fafc]">
              <h3 className="text-sm font-bold text-[#111b21] flex items-center gap-2"><Zap size={16} className="text-[#008069]" /> {editing ? 'Edit Balasan Cepat' : 'Tambah Balasan Cepat'}</h3>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-xl hover:bg-[#f0f2f5] text-[#8696a0]"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-[#111b21]">Shortcut <span className="text-rose-500">*</span></label>
                  <div className="flex items-center gap-1 mt-1">
                    <span className="px-2 py-2 bg-[#f0f2f5] border border-[#d1d7db] rounded-xl text-xs font-mono text-[#008069]">/</span>
                    <input value={formShortcut} onChange={(e) => setFormShortcut(e.target.value.replace(/^\//, '').toLowerCase().replace(/\s+/g, ''))} placeholder="rek" className="flex-1 h-9 px-3 bg-white border border-[#d1d7db] rounded-xl text-xs focus:outline-none focus:border-[#008069] font-mono" />
                  </div>
                  <p className="text-[10px] text-[#8696a0] mt-1">Huruf kecil, tanpa spasi. Contoh: /rek</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#111b21]">Kategori</label>
                  <select value={formCategory} onChange={(e) => setFormCategory(e.target.value)} className="w-full mt-1 h-9 px-2 bg-white border border-[#d1d7db] rounded-xl text-xs focus:outline-none focus:border-[#008069]">
                    <option>Pembayaran</option><option>Lokasi</option><option>Reservasi</option><option>Umum</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-[#111b21]">Judul <span className="text-rose-500">*</span></label>
                <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Contoh: Nomor Rekening BCA & Mandiri" className="w-full mt-1 h-9 px-3 bg-white border border-[#d1d7db] rounded-xl text-xs focus:outline-none focus:border-[#008069]" />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#111b21]">Isi Template <span className="text-rose-500">*</span></label>
                <div className="flex flex-wrap gap-1 mt-1.5 mb-1.5">
                  {PLACEHOLDERS.map((p) => (
                    <button key={p.tag} type="button" onClick={() => insertPlaceholder(p.tag)} className="px-2 py-1 bg-white border border-[#d1d7db] hover:border-[#008069] hover:bg-[#e8f5f2] text-[#008069] rounded-lg text-[11px] font-mono font-bold">+{p.tag}</button>
                  ))}
                </div>
                <textarea value={formContent} onChange={(e) => setFormContent(e.target.value)} rows={5} placeholder="Tulis template... gunakan {name} {clinic_name} dll." className="w-full p-3 bg-white border border-[#d1d7db] rounded-xl text-xs leading-relaxed focus:outline-none focus:border-[#008069] resize-none" />
              </div>
              <div className="bg-[#f8fafc] border border-[#e9edef] rounded-xl p-3">
                <p className="text-[11px] font-bold text-[#008069] flex items-center gap-1"><Eye size={12} /> Live Preview</p>
                <p className="text-xs text-[#111b21] whitespace-pre-wrap leading-relaxed mt-1">{formContent ? interpolatePreview(formContent) : <span className="text-[#8696a0] italic">Preview akan muncul di sini...</span> as any}</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#e9edef] bg-[#f8fafc]">
              <button onClick={() => setShowModal(false)} className="h-9 px-4 rounded-xl bg-white border border-[#d1d7db] text-xs font-semibold text-[#54656f] hover:bg-[#f0f2f5]">Batal</button>
              <button onClick={handleSave} disabled={saving} className="h-9 px-4 rounded-xl bg-[#008069] hover:bg-[#00a884] text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"><Save size={14} /> {saving ? 'Menyimpan...' : 'Simpan Template'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuickReplies;
