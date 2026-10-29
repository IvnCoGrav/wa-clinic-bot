import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../../components/common/UiFeedback';
import { Tag, Plus, Edit2, Trash2, Loader, RefreshCw, Users, Check } from 'lucide-react';

interface LabelItem {
  id: string;
  name: string;
  color: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
  _count?: { customers: number };
  is_system?: boolean;
}

const PRESET_COLORS = [
  '#008069', // WA Green / Emerald
  '#0284c7', // Sky Blue
  '#2563eb', // Royal Blue
  '#7c3aed', // Purple / Violet
  '#db2777', // Pink / Rose
  '#dc2626', // Red
  '#d97706', // Amber / Orange
  '#059669', // Teal
  '#475569', // Slate Gray
  '#831843', // Wine / Maroon
];

export const CustomerLabels: React.FC = () => {
  const { toast, confirm } = useUiFeedback();
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<LabelItem | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#008069');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadLabels();
  }, []);

  const loadLabels = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/admin/labels');
      if (res?.success && Array.isArray(res.data)) {
        setLabels(res.data);
      } else if (Array.isArray(res)) {
        setLabels(res);
      }
    } catch (err: any) {
      toast(err.message || 'Gagal memuat daftar label.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCreate = () => {
    setEditingLabel(null);
    setName('');
    setColor('#008069');
    setDescription('');
    setModalOpen(true);
  };

  const handleOpenEdit = (label: LabelItem) => {
    setEditingLabel(label);
    setName(label.name);
    setColor(label.color || '#008069');
    setDescription(label.description || '');
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast('Nama label wajib diisi.', 'error');
      return;
    }

    setSaving(true);
    try {
      if (editingLabel) {
        // Update
        const res = await apiRequest(`/api/admin/labels/${editingLabel.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: name.trim(),
            color: color.trim(),
            description: description.trim() || null,
          }),
        });
        if (res?.success) {
          toast(`Label "${name}" berhasil diperbarui.`, 'success');
          setModalOpen(false);
          loadLabels();
        } else {
          toast(res?.error || 'Gagal mengupdate label.', 'error');
        }
      } else {
        // Create
        const res = await apiRequest('/api/admin/labels', {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            color: color.trim(),
            description: description.trim() || null,
          }),
        });
        if (res?.success) {
          toast(`Label "${name}" berhasil dibuat.`, 'success');
          setModalOpen(false);
          loadLabels();
        } else {
          toast(res?.error || 'Gagal membuat label.', 'error');
        }
      }
    } catch (err: any) {
      toast(err.message || 'Terjadi kesalahan.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (label: LabelItem) => {
    if (label.is_system) {
      toast(`Label "${label.name}" merupakan bawaan sistem dan tidak dapat dihapus.`, 'error');
      return;
    }

    const isConfirmed = await confirm({
      title: 'Hapus Label Customer',
      message: `Apakah Anda yakin ingin menghapus label "${label.name}"?\nLabel ini akan dilepas dari ${label._count?.customers || 0} customer.`,
      confirmText: 'Hapus Label',
      danger: true,
    });

    if (!isConfirmed) return;

    try {
      const res = await apiRequest(`/api/admin/labels/${label.id}`, {
        method: 'DELETE',
      });
      if (res?.success) {
        toast(`Label "${label.name}" berhasil dihapus.`, 'success');
        loadLabels();
      } else {
        toast(res?.error || 'Gagal menghapus label.', 'error');
      }
    } catch (err: any) {
      toast(err.message || 'Gagal menghapus label.', 'error');
    }
  };

  const handleSeedDefaults = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/admin/labels/seed-defaults', { method: 'POST' });
      if (res?.success && Array.isArray(res.data)) {
        setLabels(res.data);
        toast('Label bawaan sistem (Hold, Admin CS, Skip, Pending Payment, dll) berhasil dimuat.', 'success');
      }
    } catch (err: any) {
      toast(err.message || 'Gagal memuat label bawaan.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink tracking-tight flex items-center space-x-2">
            <Tag className="text-accent" size={22} />
            <span>Customer Labels</span>
          </h1>
          <p className="text-xs text-ink-3 mt-0.5">
            Kelola master label dan kategori khusus untuk menandai customer di Live Chat & Database.
          </p>
        </div>
        <div className="flex items-center space-x-2 flex-wrap gap-y-2">
          <button
            onClick={loadLabels}
            disabled={loading}
            className="p-2 rounded-xl bg-surface border border-divider hover:bg-fill-1 text-ink-2 transition shadow-xs disabled:opacity-50"
            title="Refresh Label"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin text-accent' : ''} />
          </button>
          <button
            onClick={handleSeedDefaults}
            disabled={loading}
            className="px-3 py-2 bg-surface border border-divider hover:bg-fill-1 text-ink rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 shadow-xs disabled:opacity-50"
            title="Muat label bawaan sistem (Hold, Admin CS, Skip, Pending Payment, dll)"
          >
            <Tag size={13} className="text-accent" />
            <span>Muat Label Bawaan</span>
          </button>
          <button
            onClick={handleOpenCreate}
            className="px-3.5 py-2 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs active:scale-95"
          >
            <Plus size={15} />
            <span>Tambah Label</span>
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center items-center py-20">
          <Loader className="animate-spin text-accent" size={32} />
        </div>
      ) : labels.length === 0 ? (
        <div className="bg-surface border border-divider rounded-2xl p-12 text-center text-ink-3 text-xs shadow-xs">
          <Tag className="mx-auto text-ink-3 mb-3" size={40} />
          <p className="font-bold text-ink text-sm">Belum Ada Label</p>
          <p className="text-ink-3 max-w-sm mx-auto mt-1">
            Klik tombol di bawah untuk memuat label bawaan (Hold, Admin CS, Skip, Pending Payment, Repeat Order, Medis, dll) atau buat label kustom baru.
          </p>
          <div className="flex items-center justify-center space-x-3 mt-4">
            <button
              onClick={handleSeedDefaults}
              className="px-4 py-2 bg-surface border border-divider hover:bg-fill-1 text-ink rounded-xl text-xs font-bold transition inline-flex items-center space-x-1.5 shadow-xs"
            >
              <Tag size={14} className="text-accent" />
              <span>Muat Label Bawaan</span>
            </button>
            <button
              onClick={handleOpenCreate}
              className="px-4 py-2 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl text-xs font-bold transition inline-flex items-center space-x-1.5 shadow-xs"
            >
              <Plus size={14} />
              <span>Buat Label Kustom</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {labels.map((label) => (
            <div
              key={label.id}
              className="bg-surface border border-divider hover:border-divider dark:hover:border-accent rounded-2xl p-4 transition shadow-xs flex flex-col justify-between space-y-3"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-2.5 min-w-0">
                  <span
                    className="w-4 h-4 rounded-full border border-black/10 shrink-0"
                    style={{ backgroundColor: label.color }}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h3 className="text-sm font-bold text-ink truncate">{label.name}</h3>
                      {label.is_system && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-fill-1 text-ink-2 border border-divider" title="Label bawaan sistem yang dilindungi">
                          Bawaan Sistem
                        </span>
                      )}
                    </div>
                    <span
                      className="inline-block mt-1 px-2 py-0.5 rounded-md text-[10px] font-bold text-white shadow-2xs"
                      style={{ backgroundColor: label.color }}
                    >
                      {label.name}
                    </span>
                    {label.description && (
                      <p className="text-[11px] text-ink-3 mt-1.5 line-clamp-2 leading-relaxed">
                        {label.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-1 shrink-0 ml-2">
                  <button
                    onClick={() => handleOpenEdit(label)}
                    className="p-1.5 rounded-lg text-ink-3 hover:text-accent hover:bg-fill-1 transition"
                    title="Edit Label"
                  >
                    <Edit2 size={14} />
                  </button>
                  {label.is_system ? (
                    <span
                      className="p-1.5 text-ink-3 cursor-not-allowed"
                      title="Label bawaan sistem tidak dapat dihapus demi keamanan fitur"
                    >
                      <Trash2 size={14} className="opacity-40" />
                    </span>
                  ) : (
                    <button
                      onClick={() => handleDelete(label)}
                      className="p-1.5 rounded-lg text-ink-3 hover:text-danger hover:bg-danger-soft transition"
                      title="Hapus Label"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-divider text-[11px] text-ink-3">
                <span className="flex items-center space-x-1">
                  <Users size={12} className="text-ink-3" />
                  <span>{label._count?.customers || 0} customer ditandai</span>
                </span>
                <span className="font-mono text-[10px] text-ink-3">{label.color}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
          <div className="bg-surface border border-divider text-ink rounded-2xl w-full max-w-md p-6 shadow-xl space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-divider">
              <h3 className="text-sm font-bold text-ink flex items-center space-x-2">
                <Tag size={16} className="text-accent" />
                <span>{editingLabel ? 'Edit Label Customer' : 'Tambah Label Baru'}</span>
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                className="text-ink-3 hover:text-ink text-xs font-semibold p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-ink mb-1">
                  Nama Label <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: VIP Mom, Follow Up Medis, dll."
                  className="w-full bg-surface border border-divider rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent shadow-xs transition"
                  autoFocus
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink mb-1">
                  Deskripsi Label <span className="text-ink-3 font-normal">(Opsional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Keterangan singkat fungsi / arti label..."
                  rows={2}
                  className="w-full bg-surface border border-divider rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent shadow-xs transition resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-ink mb-1.5">
                  Pilih Warna Label
                </label>
                <div className="flex flex-wrap gap-2 mb-2.5">
                  {PRESET_COLORS.map((c) => (
                    <button
                      type="button"
                      key={c}
                      onClick={() => setColor(c)}
                      className={`w-7 h-7 rounded-full flex items-center justify-center transition border ${
                        color.toLowerCase() === c.toLowerCase()
                          ? 'ring-2 ring-offset-1 ring-ink scale-110'
                          : 'hover:scale-105 border-black/10'
                      }`}
                      style={{ backgroundColor: c }}
                      title={c}
                    >
                      {color.toLowerCase() === c.toLowerCase() && (
                        <Check size={13} className="text-white drop-shadow-xs" />
                      )}
                    </button>
                  ))}
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-8 h-8 rounded-lg cursor-pointer border border-divider p-0.5"
                  />
                  <input
                    type="text"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    placeholder="#008069"
                    className="flex-1 px-3 py-1.5 border border-divider rounded-xl text-xs font-mono focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              {/* Preview Badge */}
              <div className="p-3 bg-fill-1 rounded-xl border border-divider flex items-center justify-between">
                <span className="text-xs text-ink-3">Preview Tampilan:</span>
                <span
                  className="px-2.5 py-1 rounded-md text-xs font-bold text-white shadow-xs"
                  style={{ backgroundColor: color }}
                >
                  {name.trim() || 'Label Preview'}
                </span>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-divider">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={saving}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-ink-2 hover:bg-fill-1 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving || !name.trim()}
                  className="px-4 py-2 bg-accent hover:bg-accent disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs"
                >
                  {saving && <Loader size={13} className="animate-spin" />}
                  <span>{saving ? 'Menyimpan...' : editingLabel ? 'Simpan Perubahan' : 'Tambah Label'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
