import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, MapPin, Star, Trash2, Pencil, Check, Loader2, AlertTriangle, Plus } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';

/**
 * AddressBookDrawer — Buku Alamat pelanggan (multi-rumah) dalam Drawer. Fitur
 * pendukung dimodalkan di dalam modul induk CustomerDatabase (anti page-bloat):
 * Jadikan Utama / Ubah Label / Hapus kartu, semuanya lewat endpoint buku alamat
 * kanonis (`/api/admin/customers/:id/addresses*`). Hindari window.confirm/alert:
 * gunakan useUiFeedback.
 */

interface SavedAddress {
  id: string;
  label: string;
  address?: string | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  kota?: string | null;
  lat?: number | null;
  lng?: number | null;
  distanceKm?: number | null;
  ongkir?: number | null;
  isPrimary?: boolean;
}

export interface AddressBookDrawerProps {
  customer: { id: string; name?: string } | null;
  onClose: () => void;
  onChanged?: () => void;
}

function addrLine(a: SavedAddress): string {
  return [a.address, a.kelurahan, a.kecamatan, a.kota].filter(Boolean).join(', ') || 'Koordinat pin saja';
}

export const AddressBookDrawer: React.FC<AddressBookDrawerProps> = ({ customer, onClose, onChanged }) => {
  const { toast, confirm } = useUiFeedback();
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');

  // S-UX.3: Form Tambah Alamat Baru
  const [showAddForm, setShowAddForm] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newKelurahan, setNewKelurahan] = useState('');
  const [newKecamatan, setNewKecamatan] = useState('');
  const [newKota, setNewKota] = useState('');
  const [newIsPrimary, setNewIsPrimary] = useState(false);

  const customerId = customer?.id;

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      const res = await apiRequest<{ success: boolean; addresses: SavedAddress[] }>(
        `/api/admin/customers/${customerId}/addresses`,
        { forceFresh: true }
      );
      setAddresses(res?.addresses || []);
    } catch (err: any) {
      toast(err?.message || 'Gagal memuat buku alamat.', 'error');
      setAddresses([]);
    } finally {
      setLoading(false);
    }
  }, [customerId, toast]);

  useEffect(() => {
    if (customerId) load();
  }, [customerId, load]);

  const close = useCallback(() => {
    setEditingId(null);
    setShowAddForm(false);
    onClose();
  }, [onClose]);

  // S-UX.1: Keyboard accessibility (Escape key closes drawer or cancels active edits)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingId) {
          setEditingId(null);
        } else if (showAddForm) {
          setShowAddForm(false);
        } else {
          close();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingId, showAddForm, close]);

  if (!customer) return null;

  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) {
      toast('Label alamat wajib diisi (misal: Rumah Mertua, Kantor).', 'error');
      return;
    }
    if (!customerId) return;

    setIsAdding(true);
    try {
      await apiRequest(`/api/admin/customers/${customerId}/addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label,
          address: newAddress.trim() || undefined,
          kelurahan: newKelurahan.trim() || undefined,
          kecamatan: newKecamatan.trim() || undefined,
          kota: newKota.trim() || undefined,
          isPrimary: newIsPrimary,
        }),
      });
      toast(`Alamat "${label}" berhasil ditambahkan.`, 'success');
      setNewLabel('');
      setNewAddress('');
      setNewKelurahan('');
      setNewKecamatan('');
      setNewKota('');
      setNewIsPrimary(false);
      setShowAddForm(false);
      await load();
      onChanged?.();
    } catch (err: any) {
      toast(err?.message || 'Gagal menambahkan alamat.', 'error');
    } finally {
      setIsAdding(false);
    }
  };

  const handleSetDefault = async (card: SavedAddress) => {
    const ok = await confirm({
      title: 'Jadikan Alamat Utama',
      message: `Jadikan "${card.label}" alamat utama pelanggan? Alamat utama dipakai pencarian alamat baru berikutnya.`,
      confirmText: 'Jadikan Utama',
    });
    if (!ok) return;
    setBusyId(card.id);
    try {
      await apiRequest(`/api/admin/customers/${customerId}/addresses/${card.id}/default`, { method: 'PATCH' });
      toast(`"${card.label}" kini alamat utama.`, 'success');
      await load();
      onChanged?.();
    } catch (err: any) {
      toast(err?.message || 'Gagal mengubah alamat utama.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleRename = async (card: SavedAddress) => {
    const label = draftLabel.trim();
    if (!label) {
      toast('Label tidak boleh kosong.', 'error');
      return;
    }
    setBusyId(card.id);
    try {
      await apiRequest(`/api/admin/customers/${customerId}/addresses/${card.id}/label`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      toast('Label alamat diperbarui.', 'success');
      setEditingId(null);
      await load();
      onChanged?.();
    } catch (err: any) {
      toast(err?.message || 'Gagal mengubah label.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (card: SavedAddress) => {
    const ok = await confirm({
      title: 'Hapus Kartu Alamat',
      message: `Hapus "${card.label}" dari buku alamat? Kartu yang masih dipakai jadwal aktif tidak akan bisa dihapus.`,
      confirmText: 'Hapus',
      danger: true,
    });
    if (!ok) return;
    setBusyId(card.id);
    try {
      await apiRequest(`/api/admin/customers/${customerId}/addresses/${card.id}`, { method: 'DELETE' });
      toast('Kartu alamat dihapus.', 'success');
      await load();
      onChanged?.();
    } catch (err: any) {
      if (err?.status === 409) {
        const n = err?.data?.activeCount;
        toast(
          typeof n === 'number' && n > 0
            ? `Tidak bisa dihapus: dipakai ${n} jadwal aktif. Alihkan jadwalnya ke kartu lain dulu.`
            : err?.message || 'Tidak bisa dihapus karena dipakai jadwal aktif.',
          'error'
        );
      } else {
        toast(err?.message || 'Gagal menghapus kartu.', 'error');
      }
    } finally {
      setBusyId(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={close}>
      <div
        className="w-full sm:max-w-lg max-h-[85dvh] flex flex-col bg-white rounded-t-2xl sm:rounded-2xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Buku Alamat Pelanggan"
      >
        <div className="p-4 border-b border-[#e9edef] flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[#111b21]">Buku Alamat</h3>
            <p className="text-[11px] text-[#8696a0] truncate">
              {customer.name || 'Pelanggan'} — alamat multi-rumah tersimpan
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setShowAddForm((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#e8f5f2] text-[#008069] hover:bg-[#c2e7e0] text-xs font-semibold focus-visible:ring-2 focus-visible:ring-[#00a884] active:scale-[0.98] transition"
              aria-label="Tambah alamat baru"
            >
              <Plus size={15} />
              <span>Tambah</span>
            </button>
            <button
              onClick={close}
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl hover:bg-[#e9edef] focus-visible:ring-2 focus-visible:ring-[#00a884] active:scale-[0.98] transition"
              aria-label="Tutup buku alamat"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {showAddForm && (
          <form onSubmit={handleAddAddress} className="p-4 bg-[#f8fafc] border-b border-[#e9edef] space-y-2.5 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#111b21]">Tambah Alamat Baru</span>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="text-[11px] text-[#8696a0] hover:text-[#111b21]"
              >
                Batal
              </button>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#111b21] mb-1">
                Label <span className="text-red-500">*</span>
              </label>
              <input
                autoFocus
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="misal: Rumah Mertua / Kantor Suami"
                className="w-full px-2.5 py-1.5 text-xs border border-[#d1d7db] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#111b21] mb-1">Alamat Jalan</label>
              <input
                type="text"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder="Jl. Raya No. 123"
                className="w-full px-2.5 py-1.5 text-xs border border-[#d1d7db] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-[#8696a0] mb-0.5">Kelurahan</label>
                <input
                  type="text"
                  value={newKelurahan}
                  onChange={(e) => setNewKelurahan(e.target.value)}
                  placeholder="Kelurahan"
                  className="w-full px-2 py-1 text-xs border border-[#d1d7db] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#8696a0] mb-0.5">Kecamatan</label>
                <input
                  type="text"
                  value={newKecamatan}
                  onChange={(e) => setNewKecamatan(e.target.value)}
                  placeholder="Kecamatan"
                  className="w-full px-2 py-1 text-xs border border-[#d1d7db] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#8696a0] mb-0.5">Kota</label>
                <input
                  type="text"
                  value={newKota}
                  onChange={(e) => setNewKota(e.target.value)}
                  placeholder="Surabaya"
                  className="w-full px-2 py-1 text-xs border border-[#d1d7db] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="isPrimaryCheckbox"
                checked={newIsPrimary}
                onChange={(e) => setNewIsPrimary(e.target.checked)}
                className="h-3.5 w-3.5 text-[#008069] rounded border-[#d1d7db] focus:ring-[#00a884]"
              />
              <label htmlFor="isPrimaryCheckbox" className="text-xs text-[#111b21] cursor-pointer">
                Jadikan Alamat Utama
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1.5 text-xs text-[#54656f] hover:bg-[#e9edef] rounded-lg transition"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isAdding}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#008069] hover:bg-[#00a884] text-white text-xs font-semibold rounded-lg shadow-sm transition disabled:opacity-50"
              >
                {isAdding ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                <span>Simpan Alamat</span>
              </button>
            </div>
          </form>
        )}

        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="p-8 flex items-center justify-center text-[#8696a0]">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : addresses.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#8696a0] space-y-2">
              <MapPin size={22} className="mx-auto text-[#c2e7e0]" />
              <p>Belum ada alamat tersimpan.</p>
              <p className="text-[11px]">Alamat tersimpan otomatis saat customer menyebut lokasi rumahnya di chat.</p>
            </div>
          ) : (
            <ul>
              {addresses.map((card, i) => (
                <li key={card.id} className={`px-4 py-3 ${i > 0 ? 'border-t border-[#e9edef]' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {editingId === card.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            autoFocus
                            value={draftLabel}
                            onChange={(e) => setDraftLabel(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename(card);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            className="w-full px-2 py-1.5 text-xs border border-[#00a884] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40"
                            aria-label="Label alamat baru"
                          />
                          <button
                            onClick={() => handleRename(card)}
                            disabled={busyId === card.id}
                            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl bg-[#e8f5f2] text-[#008069] hover:bg-[#c2e7e0] focus-visible:ring-2 focus-visible:ring-[#00a884] active:scale-[0.98] transition disabled:opacity-50"
                            aria-label="Simpan label"
                          >
                            {busyId === card.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs font-semibold text-[#111b21] flex items-center gap-1.5">
                          <span className="truncate">
                            {card.label}
                            {card.isPrimary && (
                              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[#e8f5f2] text-[#008069] text-[10px] font-bold align-middle">
                                Utama
                              </span>
                            )}
                          </span>
                        </p>
                      )}
                      <p className="text-[11px] text-[#8696a0] mt-0.5 line-clamp-2">{addrLine(card)}</p>
                      <p className="text-[11px] text-[#8696a0] mt-0.5">
                        {card.ongkir != null ? `Ongkir Rp ${card.ongkir.toLocaleString('id-ID')}` : 'Ongkir belum dihitung'}
                        {card.kelurahan ? '' : ' · area belum lengkap'}
                      </p>
                    </div>
                    <div className="flex items-center shrink-0 -mr-1">
                      {!card.isPrimary && (
                        <button
                          onClick={() => handleSetDefault(card)}
                          disabled={busyId === card.id}
                          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-[#8696a0] hover:bg-amber-50 hover:text-amber-600 focus-visible:ring-2 focus-visible:ring-[#00a884] active:scale-[0.98] transition disabled:opacity-50"
                          title="Jadikan utama"
                          aria-label={`Jadikan ${card.label} alamat utama`}
                        >
                          {busyId === card.id ? <Loader2 size={15} className="animate-spin" /> : <Star size={15} />}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setEditingId(card.id);
                          setDraftLabel(card.label);
                        }}
                        disabled={busyId === card.id}
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-[#8696a0] hover:bg-sky-50 hover:text-sky-600 focus-visible:ring-2 focus-visible:ring-[#00a884] active:scale-[0.98] transition disabled:opacity-50"
                        title="Ubah label"
                        aria-label={`Ubah label ${card.label}`}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(card)}
                        disabled={busyId === card.id}
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-[#8696a0] hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-[#00a884] active:scale-[0.98] transition disabled:opacity-50"
                        title="Hapus kartu"
                        aria-label={`Hapus ${card.label}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-3 border-t border-[#e9edef] bg-[#f8fafc] flex items-start gap-2 text-[11px] text-[#8696a0] shrink-0">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <p>
            Perubahan di sini ikut dipakai chatbot & jadwal kunjungan. Hapus alamat utama akan memindahkan gelar
            "Utama" ke rumah yang paling baru dipakai.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
};
