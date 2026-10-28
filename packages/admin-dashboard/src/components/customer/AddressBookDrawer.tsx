import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  MapPin,
  Star,
  Trash2,
  Pencil,
  Check,
  Loader2,
  AlertTriangle,
  Plus,
  Navigation,
  Search,
} from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { useMapsShortlinkResolver } from '../../hooks/useMapsShortlinkResolver';
import { geocodeAddressWithNominatim, calculateHaversineKm } from '../../utils/geoUtils';
import { calculateOngkirFromTiers, type DeliveryTierItem } from '../../utils/deliveryTierCalculator';

/**
 * AddressBookDrawer — Buku Alamat pelanggan (multi-rumah) dalam Drawer.
 * Fitur:
 * - Tambah Alamat Baru & Edit Alamat Lengkap (D-1/Fase 2)
 * - Alat Lokasi Cerdas: Resolver link Google Maps / shareloc & Nominatim Geocoding
 * - Hitung jarak & estimasi ongkir otomatis via delivery-tiers
 * - Jadikan Utama / Hapus kartu via seam kanonis
 */

const MAX_ADDRESS_LABEL_LENGTH = 60;

const CLINIC_COORDS = {
  lat: -7.34886,
  lng: 112.751677,
};

export interface SavedAddress {
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
  landmark?: string | null;
  locationSource?: string | null;
  isPrimary?: boolean;
}

export interface AddressBookDrawerProps {
  customer: { id: string; name?: string } | null;
  onClose: () => void;
  onChanged?: () => void;
  initialEditingCardId?: string | null;
}

function addrLine(a: SavedAddress): string {
  return [a.address, a.kelurahan, a.kecamatan, a.kota].filter(Boolean).join(', ') || 'Koordinat pin saja';
}

export const AddressBookDrawer: React.FC<AddressBookDrawerProps> = ({
  customer,
  onClose,
  onChanged,
  initialEditingCardId,
}) => {
  const { toast, confirm } = useUiFeedback();
  const { resolve: resolveMapsUrl, isResolving: isResolvingMaps } = useMapsShortlinkResolver();

  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Delivery Tiers dari DB (SaaS-Ready)
  const [deliveryTiers, setDeliveryTiers] = useState<DeliveryTierItem[]>([]);

  // S-UX.3: Form Tambah Alamat Baru
  const [showAddForm, setShowAddForm] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newKelurahan, setNewKelurahan] = useState('');
  const [newKecamatan, setNewKecamatan] = useState('');
  const [newKota, setNewKota] = useState('');
  const [newLandmark, setNewLandmark] = useState('');
  const [newLat, setNewLat] = useState<number | null>(null);
  const [newLng, setNewLng] = useState<number | null>(null);
  const [newDistanceKm, setNewDistanceKm] = useState<number | null>(null);
  const [newOngkir, setNewOngkir] = useState<number | null>(null);
  const [newMapsUrl, setNewMapsUrl] = useState('');
  const [newIsPrimary, setNewIsPrimary] = useState(false);
  const [isGeocodingAdd, setIsGeocodingAdd] = useState(false);

  // Fase 2: Form Edit Alamat Lengkap
  const [editingAddress, setEditingAddress] = useState<SavedAddress | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [editLabel, setEditLabel] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editKelurahan, setEditKelurahan] = useState('');
  const [editKecamatan, setEditKecamatan] = useState('');
  const [editKota, setEditKota] = useState('');
  const [editLandmark, setEditLandmark] = useState('');
  const [editLat, setEditLat] = useState<number | null>(null);
  const [editLng, setEditLng] = useState<number | null>(null);
  const [editDistanceKm, setEditDistanceKm] = useState<number | null>(null);
  const [editOngkir, setEditOngkir] = useState<number | null>(null);
  const [editMapsUrl, setEditMapsUrl] = useState('');
  const [isGeocodingEdit, setIsGeocodingEdit] = useState(false);

  const customerId = customer?.id;

  // Load delivery tiers
  useEffect(() => {
    apiRequest('/api/admin/delivery-tiers')
      .then((res: any) => {
        const list = Array.isArray(res) ? res : res?.data || [];
        if (Array.isArray(list) && list.length > 0) {
          setDeliveryTiers(list);
        }
      })
      .catch(() => {});
  }, []);

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

  // Buka edit form otomatis jika initialEditingCardId diberikan
  useEffect(() => {
    if (initialEditingCardId && addresses.length > 0) {
      const target = addresses.find((a) => a.id === initialEditingCardId);
      if (target) {
        startEditing(target);
      }
    }
  }, [initialEditingCardId, addresses]);

  const close = useCallback(() => {
    setEditingAddress(null);
    setShowAddForm(false);
    onClose();
  }, [onClose]);

  // Keyboard accessibility (Escape key closes drawer or cancels active forms)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingAddress) {
          setEditingAddress(null);
        } else if (showAddForm) {
          setShowAddForm(false);
        } else {
          close();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingAddress, showAddForm, close]);

  if (!customer) return null;

  // Helper hitung jarak & ongkir dari koordinat
  const updateDistanceAndOngkir = (
    lat: number,
    lng: number,
    setter: (dist: number, ongkir: number) => void
  ) => {
    const km = calculateHaversineKm(CLINIC_COORDS.lat, CLINIC_COORDS.lng, lat, lng);
    const roundedKm = Math.round(km * 10) / 10;
    const calc = calculateOngkirFromTiers(roundedKm, deliveryTiers);
    setter(roundedKm, calc.netOngkir);
  };

  // Mulai mode edit
  const startEditing = (card: SavedAddress) => {
    setShowAddForm(false);
    setEditingAddress(card);
    setEditLabel(card.label || '');
    setEditAddress(card.address || '');
    setEditKelurahan(card.kelurahan || '');
    setEditKecamatan(card.kecamatan || '');
    setEditKota(card.kota || '');
    setEditLandmark(card.landmark || '');
    setEditLat(typeof card.lat === 'number' ? card.lat : null);
    setEditLng(typeof card.lng === 'number' ? card.lng : null);
    setEditDistanceKm(typeof card.distanceKm === 'number' ? card.distanceKm : null);
    setEditOngkir(typeof card.ongkir === 'number' ? card.ongkir : null);
    setEditMapsUrl('');
  };

  // Urai Link Google Maps untuk Form Tambah
  const handleResolveMapsAdd = async (urlStr: string) => {
    const res = await resolveMapsUrl(urlStr);
    if (res && typeof res.lat === 'number' && typeof res.lng === 'number') {
      setNewLat(res.lat);
      setNewLng(res.lng);
      if (res.formattedAddress && !newAddress) setNewAddress(res.formattedAddress);
      if (res.kelurahan && !newKelurahan) setNewKelurahan(res.kelurahan);
      if (res.kecamatan && !newKecamatan) setNewKecamatan(res.kecamatan);
      if (res.kota && !newKota) setNewKota(res.kota);
      updateDistanceAndOngkir(res.lat, res.lng, (dist, ongkir) => {
        setNewDistanceKm(dist);
        setNewOngkir(ongkir);
      });
    }
  };

  // Urai Link Google Maps untuk Form Edit
  const handleResolveMapsEdit = async (urlStr: string) => {
    const res = await resolveMapsUrl(urlStr);
    if (res && typeof res.lat === 'number' && typeof res.lng === 'number') {
      setEditLat(res.lat);
      setEditLng(res.lng);
      if (res.formattedAddress && !editAddress) setEditAddress(res.formattedAddress);
      if (res.kelurahan && !editKelurahan) setEditKelurahan(res.kelurahan);
      if (res.kecamatan && !editKecamatan) setEditKecamatan(res.kecamatan);
      if (res.kota && !editKota) setEditKota(res.kota);
      updateDistanceAndOngkir(res.lat, res.lng, (dist, ongkir) => {
        setEditDistanceKm(dist);
        setEditOngkir(ongkir);
      });
    }
  };

  // Geocoding Nominatim Tambah
  const handleGeocodeAdd = async () => {
    const query = [newAddress, newKelurahan, newKecamatan, newKota].filter(Boolean).join(', ');
    if (!query || query.length < 3) {
      toast('Isi alamat/kelurahan/kecamatan terlebih dahulu.', 'error');
      return;
    }
    setIsGeocodingAdd(true);
    try {
      const geo = await geocodeAddressWithNominatim(query);
      if (geo && geo.lat && geo.lng) {
        setNewLat(geo.lat);
        setNewLng(geo.lng);
        updateDistanceAndOngkir(geo.lat, geo.lng, (dist, ongkir) => {
          setNewDistanceKm(dist);
          setNewOngkir(ongkir);
        });
        toast(`Titik ditemukan: ${geo.displayName.slice(0, 35)}...`, 'success');
      } else {
        toast('Koordinat tidak ditemukan via geocoding.', 'error');
      }
    } catch (err: any) {
      toast(err?.message || 'Gagal mencari koordinat.', 'error');
    } finally {
      setIsGeocodingAdd(false);
    }
  };

  // Geocoding Nominatim Edit
  const handleGeocodeEdit = async () => {
    const query = [editAddress, editKelurahan, editKecamatan, editKota].filter(Boolean).join(', ');
    if (!query || query.length < 3) {
      toast('Isi alamat/kelurahan/kecamatan terlebih dahulu.', 'error');
      return;
    }
    setIsGeocodingEdit(true);
    try {
      const geo = await geocodeAddressWithNominatim(query);
      if (geo && geo.lat && geo.lng) {
        setEditLat(geo.lat);
        setEditLng(geo.lng);
        updateDistanceAndOngkir(geo.lat, geo.lng, (dist, ongkir) => {
          setEditDistanceKm(dist);
          setEditOngkir(ongkir);
        });
        toast(`Titik ditemukan: ${geo.displayName.slice(0, 35)}...`, 'success');
      } else {
        toast('Koordinat tidak ditemukan via geocoding.', 'error');
      }
    } catch (err: any) {
      toast(err?.message || 'Gagal mencari koordinat.', 'error');
    } finally {
      setIsGeocodingEdit(false);
    }
  };

  // Submit Tambah Alamat
  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) {
      toast('Label alamat wajib diisi (misal: Rumah Mertua, Kantor).', 'error');
      return;
    }
    if (label.length > MAX_ADDRESS_LABEL_LENGTH) {
      toast(`Label maksimal ${MAX_ADDRESS_LABEL_LENGTH} karakter.`, 'error');
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
          landmark: newLandmark.trim() || undefined,
          lat: newLat,
          lng: newLng,
          distanceKm: newDistanceKm,
          ongkir: newOngkir,
          isPrimary: newIsPrimary,
        }),
      });
      toast(`Alamat "${label}" berhasil ditambahkan.`, 'success');
      setNewLabel('');
      setNewAddress('');
      setNewKelurahan('');
      setNewKecamatan('');
      setNewKota('');
      setNewLandmark('');
      setNewLat(null);
      setNewLng(null);
      setNewDistanceKm(null);
      setNewOngkir(null);
      setNewMapsUrl('');
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

  // Submit Edit Alamat (PUT)
  const handleUpdateAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAddress || !customerId) return;

    const label = editLabel.trim();
    if (!label) {
      toast('Label alamat wajib diisi.', 'error');
      return;
    }
    if (label.length > MAX_ADDRESS_LABEL_LENGTH) {
      toast(`Label maksimal ${MAX_ADDRESS_LABEL_LENGTH} karakter.`, 'error');
      return;
    }

    // Konfirmasi bila koordinat berubah
    const coordsChanged =
      (typeof editLat === 'number' && editLat !== editingAddress.lat) ||
      (typeof editLng === 'number' && editLng !== editingAddress.lng);

    if (coordsChanged) {
      const ok = await confirm({
        title: 'Perbarui Koordinat Kartu?',
        message: 'Perubahan koordinat kartu akan ikut memperbarui jadwal aktif yang menggunakan rumah ini.',
        confirmText: 'Ya, Perbarui',
      });
      if (!ok) return;
    }

    setIsUpdating(true);
    try {
      await apiRequest(`/api/admin/customers/${customerId}/addresses/${editingAddress.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label,
          address: editAddress.trim() || undefined,
          kelurahan: editKelurahan.trim() || null,
          kecamatan: editKecamatan.trim() || null,
          kota: editKota.trim() || null,
          landmark: editLandmark.trim() || null,
          lat: editLat,
          lng: editLng,
          distanceKm: editDistanceKm,
          ongkir: editOngkir,
        }),
      });
      toast(`Alamat "${label}" berhasil diperbarui.`, 'success');
      setEditingAddress(null);
      await load();
      onChanged?.();
    } catch (err: any) {
      toast(err?.message || 'Gagal memperbarui alamat.', 'error');
    } finally {
      setIsUpdating(false);
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
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={close}
    >
      <div
        className="w-full sm:max-w-lg max-h-[90dvh] flex flex-col bg-white dark:bg-[#111b21] dark:border dark:border-[#202c33] rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Buku Alamat Pelanggan"
      >
        <div className="p-4 border-b border-[#e9edef] dark:border-[#202c33] flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[#111b21] dark:text-[#e9edef]">Buku Alamat</h3>
            <p className="text-[11px] text-[#8696a0] truncate">
              {customer.name || 'Pelanggan'} — alamat multi-rumah tersimpan
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => {
                setEditingAddress(null);
                setShowAddForm((prev) => !prev);
              }}
              className="min-h-[44px] inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#e8f5f2] text-[#008069] hover:bg-[#c2e7e0] dark:bg-[#00a884]/20 dark:text-[#00a884] text-xs font-semibold focus-visible:ring-2 focus-visible:ring-[#00a884] active:scale-[0.98] transition"
              aria-label="Tambah alamat baru"
            >
              <Plus size={15} />
              <span>Tambah</span>
            </button>
            <button
              onClick={close}
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl hover:bg-[#e9edef] dark:hover:bg-[#202c33] text-[#54656f] dark:text-[#8696a0] focus-visible:ring-2 focus-visible:ring-[#00a884] active:scale-[0.98] transition"
              aria-label="Tutup buku alamat"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Form Edit Alamat Lengkap (Fase 2) */}
        {editingAddress && (
          <form
            onSubmit={handleUpdateAddress}
            className="p-4 bg-[#f0f9f6] dark:bg-[#182229] border-b border-[#c2e7e0] dark:border-[#202c33] space-y-2.5 shrink-0 max-h-[60dvh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#008069] dark:text-[#00a884] flex items-center gap-1.5">
                <Pencil size={13} />
                Edit Alamat: {editingAddress.label}
              </span>
              <button
                type="button"
                onClick={() => setEditingAddress(null)}
                className="text-[11px] text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#e9edef] py-1 px-2"
              >
                Batal
              </button>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#111b21] dark:text-[#e9edef] mb-1">
                Label <span className="text-red-500">*</span>
              </label>
              <input
                autoFocus
                type="text"
                value={editLabel}
                maxLength={MAX_ADDRESS_LABEL_LENGTH}
                onChange={(e) => setEditLabel(e.target.value)}
                placeholder="misal: Rumah Mertua / Kantor Suami"
                className="w-full px-2.5 py-1.5 text-xs border border-[#d1d7db] dark:border-[#2a3942] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40 bg-white dark:bg-[#202c33] dark:text-[#e9edef]"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#111b21] dark:text-[#e9edef] mb-1">Alamat Jalan</label>
              <input
                type="text"
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
                placeholder="Jl. Raya No. 123"
                className="w-full px-2.5 py-1.5 text-xs border border-[#d1d7db] dark:border-[#2a3942] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40 bg-white dark:bg-[#202c33] dark:text-[#e9edef]"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-[#8696a0] mb-0.5">Kelurahan</label>
                <input
                  type="text"
                  value={editKelurahan}
                  onChange={(e) => setEditKelurahan(e.target.value)}
                  placeholder="Kelurahan"
                  className="w-full px-2 py-1 text-xs border border-[#d1d7db] dark:border-[#2a3942] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40 bg-white dark:bg-[#202c33] dark:text-[#e9edef]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#8696a0] mb-0.5">Kecamatan</label>
                <input
                  type="text"
                  value={editKecamatan}
                  onChange={(e) => setEditKecamatan(e.target.value)}
                  placeholder="Kecamatan"
                  className="w-full px-2 py-1 text-xs border border-[#d1d7db] dark:border-[#2a3942] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40 bg-white dark:bg-[#202c33] dark:text-[#e9edef]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#8696a0] mb-0.5">Kota</label>
                <input
                  type="text"
                  value={editKota}
                  onChange={(e) => setEditKota(e.target.value)}
                  placeholder="Surabaya"
                  className="w-full px-2 py-1 text-xs border border-[#d1d7db] dark:border-[#2a3942] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40 bg-white dark:bg-[#202c33] dark:text-[#e9edef]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] text-[#8696a0] mb-0.5">Landmark / Patokan Rumah</label>
              <input
                type="text"
                value={editLandmark}
                onChange={(e) => setEditLandmark(e.target.value)}
                placeholder="Pagar hitam depan pos satpam"
                className="w-full px-2.5 py-1 text-xs border border-[#d1d7db] dark:border-[#2a3942] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40 bg-white dark:bg-[#202c33] dark:text-[#e9edef]"
              />
            </div>

            {/* Alat Lokasi Cerdas (Micro-Task 2.2) */}
            <div className="p-2.5 bg-white dark:bg-[#202c33] border border-[#d1d7db] dark:border-[#2a3942] rounded-xl space-y-2">
              <span className="text-[11px] font-semibold text-[#111b21] dark:text-[#e9edef] flex items-center gap-1">
                <Navigation size={12} className="text-[#008069]" />
                Titik GPS & Alat Lokasi
              </span>

              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={editMapsUrl}
                  onChange={(e) => setEditMapsUrl(e.target.value)}
                  placeholder="Tempel link Google Maps / shareloc..."
                  className="flex-1 px-2 py-1 text-xs border border-[#d1d7db] dark:border-[#2a3942] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40 bg-white dark:bg-[#111b21] dark:text-[#e9edef]"
                />
                <button
                  type="button"
                  disabled={isResolvingMaps || !editMapsUrl.trim()}
                  onClick={() => handleResolveMapsEdit(editMapsUrl)}
                  className="min-h-[44px] px-2.5 py-1 bg-[#e8f5f2] text-[#008069] hover:bg-[#c2e7e0] text-xs font-medium rounded-lg transition disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {isResolvingMaps ? <Loader2 size={13} className="animate-spin" /> : <Navigation size={13} />}
                  <span>Urai</span>
                </button>
                <button
                  type="button"
                  disabled={isGeocodingEdit}
                  onClick={handleGeocodeEdit}
                  className="min-h-[44px] px-2.5 py-1 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-[#111b21] dark:text-[#e9edef] dark:hover:bg-[#2a3942] text-xs font-medium rounded-lg transition disabled:opacity-50 inline-flex items-center gap-1"
                  title="Cari koordinat dari kelurahan/kecamatan via Nominatim"
                >
                  {isGeocodingEdit ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                  <span>Cari</span>
                </button>
              </div>

              {editLat != null && editLng != null ? (
                <div className="flex items-center justify-between text-[11px] text-[#54656f] dark:text-[#8696a0] bg-[#f8fafc] dark:bg-[#111b21] px-2 py-1 rounded-lg">
                  <span>GPS: {editLat.toFixed(5)}, {editLng.toFixed(5)}</span>
                  <span>{editDistanceKm != null ? `${editDistanceKm} km` : ''} {editOngkir != null ? `• Rp ${editOngkir.toLocaleString('id-ID')}` : ''}</span>
                </div>
              ) : (
                <p className="text-[10px] text-[#8696a0]">Koordinat belum disetel (ongkir belum dihitung).</p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditingAddress(null)}
                className="min-h-[44px] px-3 py-1.5 text-xs text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#202c33] rounded-lg transition"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isUpdating}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-1.5 bg-[#008069] hover:bg-[#00a884] text-white text-xs font-semibold rounded-lg shadow-sm transition disabled:opacity-50"
              >
                {isUpdating ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                <span>Perbarui Alamat</span>
              </button>
            </div>
          </form>
        )}

        {/* Form Tambah Alamat Baru */}
        {showAddForm && !editingAddress && (
          <form
            onSubmit={handleAddAddress}
            className="p-4 bg-[#f8fafc] dark:bg-[#182229] border-b border-[#e9edef] dark:border-[#202c33] space-y-2.5 shrink-0 max-h-[60dvh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#111b21]">Tambah Alamat Baru</span>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="text-[11px] text-[#8696a0] hover:text-[#111b21] py-1 px-2"
              >
                Batal
              </button>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#111b21] dark:text-[#e9edef] mb-1">
                Label <span className="text-red-500">*</span>
              </label>
              <input
                autoFocus
                type="text"
                value={newLabel}
                maxLength={MAX_ADDRESS_LABEL_LENGTH}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="misal: Rumah Mertua / Kantor Suami"
                className="w-full px-2.5 py-1.5 text-xs border border-[#d1d7db] dark:border-[#2a3942] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40 bg-white dark:bg-[#202c33] dark:text-[#e9edef]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#111b21] dark:text-[#e9edef] mb-1">Alamat Jalan</label>
              <input
                type="text"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder="Jl. Raya No. 123"
                className="w-full px-2.5 py-1.5 text-xs border border-[#d1d7db] dark:border-[#2a3942] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40 bg-white dark:bg-[#202c33] dark:text-[#e9edef]"
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
                  className="w-full px-2 py-1 text-xs border border-[#d1d7db] dark:border-[#2a3942] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40 bg-white dark:bg-[#202c33] dark:text-[#e9edef]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#8696a0] mb-0.5">Kecamatan</label>
                <input
                  type="text"
                  value={newKecamatan}
                  onChange={(e) => setNewKecamatan(e.target.value)}
                  placeholder="Kecamatan"
                  className="w-full px-2 py-1 text-xs border border-[#d1d7db] dark:border-[#2a3942] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40 bg-white dark:bg-[#202c33] dark:text-[#e9edef]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#8696a0] mb-0.5">Kota</label>
                <input
                  type="text"
                  value={newKota}
                  onChange={(e) => setNewKota(e.target.value)}
                  placeholder="Surabaya"
                  className="w-full px-2 py-1 text-xs border border-[#d1d7db] dark:border-[#2a3942] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40 bg-white dark:bg-[#202c33] dark:text-[#e9edef]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] text-[#8696a0] mb-0.5">Landmark / Patokan Rumah</label>
              <input
                type="text"
                value={newLandmark}
                onChange={(e) => setNewLandmark(e.target.value)}
                placeholder="Pagar hitam depan pos satpam"
                className="w-full px-2.5 py-1 text-xs border border-[#d1d7db] dark:border-[#2a3942] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40 bg-white dark:bg-[#202c33] dark:text-[#e9edef]"
              />
            </div>

            {/* Alat Lokasi Cerdas (Micro-Task 2.2) */}
            <div className="p-2.5 bg-white dark:bg-[#202c33] border border-[#d1d7db] dark:border-[#2a3942] rounded-xl space-y-2">
              <span className="text-[11px] font-semibold text-[#111b21] dark:text-[#e9edef] flex items-center gap-1">
                <Navigation size={12} className="text-[#008069]" />
                Titik GPS & Alat Lokasi
              </span>

              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={newMapsUrl}
                  onChange={(e) => setNewMapsUrl(e.target.value)}
                  placeholder="Tempel link Google Maps / shareloc..."
                  className="flex-1 px-2 py-1 text-xs border border-[#d1d7db] dark:border-[#2a3942] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00a884]/40 bg-white dark:bg-[#111b21] dark:text-[#e9edef]"
                />
                <button
                  type="button"
                  disabled={isResolvingMaps || !newMapsUrl.trim()}
                  onClick={() => handleResolveMapsAdd(newMapsUrl)}
                  className="min-h-[44px] px-2.5 py-1 bg-[#e8f5f2] text-[#008069] hover:bg-[#c2e7e0] text-xs font-medium rounded-lg transition disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {isResolvingMaps ? <Loader2 size={13} className="animate-spin" /> : <Navigation size={13} />}
                  <span>Urai</span>
                </button>
                <button
                  type="button"
                  disabled={isGeocodingAdd}
                  onClick={handleGeocodeAdd}
                  className="min-h-[44px] px-2.5 py-1 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-[#111b21] dark:text-[#e9edef] dark:hover:bg-[#2a3942] text-xs font-medium rounded-lg transition disabled:opacity-50 inline-flex items-center gap-1"
                  title="Cari koordinat dari kelurahan/kecamatan via Nominatim"
                >
                  {isGeocodingAdd ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                  <span>Cari</span>
                </button>
              </div>

              {newLat != null && newLng != null ? (
                <div className="flex items-center justify-between text-[11px] text-[#54656f] dark:text-[#8696a0] bg-[#f8fafc] dark:bg-[#111b21] px-2 py-1 rounded-lg">
                  <span>GPS: {newLat.toFixed(5)}, {newLng.toFixed(5)}</span>
                  <span>{newDistanceKm != null ? `${newDistanceKm} km` : ''} {newOngkir != null ? `• Rp ${newOngkir.toLocaleString('id-ID')}` : ''}</span>
                </div>
              ) : (
                <p className="text-[10px] text-[#8696a0]">Koordinat belum disetel (ongkir belum dihitung).</p>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="isPrimaryCheckbox"
                checked={newIsPrimary}
                onChange={(e) => setNewIsPrimary(e.target.checked)}
                className="h-3.5 w-3.5 text-[#008069] rounded border-[#d1d7db] focus:ring-[#00a884]"
              />
              <label htmlFor="isPrimaryCheckbox" className="text-xs text-[#111b21] dark:text-[#e9edef] cursor-pointer">
                Jadikan Alamat Utama
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="min-h-[44px] px-3 py-1.5 text-xs text-[#54656f] dark:text-[#8696a0] hover:bg-[#e9edef] dark:hover:bg-[#202c33] rounded-lg transition"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isAdding}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-1.5 bg-[#008069] hover:bg-[#00a884] text-white text-xs font-semibold rounded-lg shadow-sm transition disabled:opacity-50"
              >
                {isAdding ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                <span>Simpan Alamat</span>
              </button>
            </div>
          </form>
        )}

        {/* Daftar Kartu Alamat */}
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
                <li key={card.id} className={`px-4 py-3 ${i > 0 ? 'border-t border-[#e9edef] dark:border-[#202c33]' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-[#111b21] dark:text-[#e9edef] flex items-center gap-1.5">
                        <span className="truncate">
                          {card.label}
                          {card.isPrimary && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-[#e8f5f2] text-[#008069] dark:bg-[#00a884]/20 dark:text-[#00a884] text-[10px] font-bold align-middle">
                              Utama
                            </span>
                          )}
                        </span>
                      </p>
                      <p className="text-[11px] text-[#8696a0] mt-0.5 line-clamp-2">{addrLine(card)}</p>
                      {card.landmark && (
                        <p className="text-[10px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 rounded px-1.5 py-0.5 mt-1 inline-block">
                          Patokan: {card.landmark}
                        </p>
                      )}
                      <p className="text-[11px] text-[#8696a0] mt-0.5">
                        {card.ongkir != null ? `Ongkir Rp ${card.ongkir.toLocaleString('id-ID')}` : 'Ongkir belum dihitung'}
                        {card.distanceKm != null ? ` (${card.distanceKm} km)` : ''}
                        {card.kelurahan ? '' : ' • area belum lengkap'}
                      </p>
                    </div>
                    <div className="flex items-center shrink-0 -mr-1">
                      {!card.isPrimary && (
                        <button
                          onClick={() => handleSetDefault(card)}
                          disabled={busyId === card.id}
                          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-[#8696a0] hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-950/30 focus-visible:ring-2 focus-visible:ring-[#00a884] active:scale-[0.98] transition disabled:opacity-50"
                          title="Jadikan utama"
                          aria-label={`Jadikan ${card.label} alamat utama`}
                        >
                          {busyId === card.id ? <Loader2 size={15} className="animate-spin" /> : <Star size={15} />}
                        </button>
                      )}
                      {/* Tombol Pensil: Buka Form Edit Alamat Lengkap (Micro-Task 2.1) */}
                      <button
                        onClick={() => startEditing(card)}
                        disabled={busyId === card.id}
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-[#8696a0] hover:bg-sky-50 hover:text-sky-600 dark:hover:bg-sky-950/30 focus-visible:ring-2 focus-visible:ring-[#00a884] active:scale-[0.98] transition disabled:opacity-50"
                        title="Edit alamat lengkap"
                        aria-label={`Edit alamat ${card.label}`}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(card)}
                        disabled={busyId === card.id}
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-[#8696a0] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 focus-visible:ring-2 focus-visible:ring-[#00a884] active:scale-[0.98] transition disabled:opacity-50"
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

        <div className="p-3 border-t border-[#e9edef] dark:border-[#202c33] bg-[#f8fafc] dark:bg-[#182229] flex items-start gap-2 text-[11px] text-[#8696a0] shrink-0">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />
          <p>
            Perubahan koordinat kartu akan otomatis memperbarui ongkir dan jadwal kunjungan aktif yang terhubung.
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
};
