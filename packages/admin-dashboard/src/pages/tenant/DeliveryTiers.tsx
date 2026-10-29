import React, { useEffect, useState } from 'react';
import { apiRequest, refreshApi } from '../../services/api';
import {
  Truck,
  Plus,
  Trash2,
  Check,
  X,
  Save,
  AlertTriangle,
  Info,
  RefreshCw,
  Ruler,
  Coins,
  Percent
} from 'lucide-react';

interface DeliveryTier {
  id: number;
  maxDist: number | '';
  fee: number | '';
  promoDiscount: number | '';
}

export const DeliveryTiers: React.FC = () => {
  const [tiers, setTiers] = useState<DeliveryTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [previewKm, setPreviewKm] = useState(4.5);

  const loadTiers = async (opts: { forceFresh?: boolean } = {}) => {
    setLoading(true);
    setError('');
    try {
      // Tombol Reload WAJIB bypass cache SWR 15s (forceFresh) agar admin tidak
      // pernah melihat data basi saat sengaja menyegarkan.
      const res = opts.forceFresh
        ? await refreshApi('/api/admin/delivery-tiers')
        : await apiRequest('/api/admin/delivery-tiers');
      const list = Array.isArray(res) ? res : (res?.data || []);
      setTiers(list);
    } catch (err: any) {
      setError(`Gagal load tier: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTiers();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const sanitized = tiers.map(t => ({
        ...t,
        maxDist: Number(t.maxDist) || 0,
        fee: Number(t.fee) || 0,
        promoDiscount: Number(t.promoDiscount) || 0,
      }));
      const sorted = sanitized.sort((a, b) => a.maxDist - b.maxDist);
      await apiRequest('/api/admin/delivery-tiers', {
        method: 'POST',
        body: JSON.stringify({ tiers: sorted })
      });
      setTiers(sorted);
      setSuccess('Tiering ongkir berhasil disimpan ke server!');
    } catch (err: any) {
      setError(`Gagal simpan: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const updateTier = (idx: number, field: keyof DeliveryTier, value: number | '') => {
    const next = [...tiers];
    next[idx] = { ...next[idx], [field]: value };
    setTiers(next);
  };

  const addTier = () => {
    const lastMax = tiers.length > 0 ? Math.max(...tiers.map(t => Number(t.maxDist) || 0)) : 0;
    setTiers([...tiers, { id: Date.now(), maxDist: lastMax + 5, fee: 30000, promoDiscount: 5000 }]);
  };

  const removeTier = (idx: number) => {
    setTiers(tiers.filter((_, i) => i !== idx));
  };

  const sortedTiers = [...tiers].sort((a, b) => (Number(a.maxDist) || 0) - (Number(b.maxDist) || 0));

  // Cari tier yang berlaku untuk jarak tertentu
  const tierForDistance = (km: number) => {
    return sortedTiers.find(t => km <= (Number(t.maxDist) || 0)) || null;
  };

  // Validasi: pastikan maxDist berurutan & tidak ada duplikat
  const validationIssues: string[] = [];
  for (let i = 1; i < sortedTiers.length; i++) {
    if ((Number(sortedTiers[i].maxDist) || 0) <= (Number(sortedTiers[i - 1].maxDist) || 0)) {
      validationIssues.push(`Tier "${sortedTiers[i].maxDist} km" harus lebih besar dari tier sebelumnya (${sortedTiers[i - 1].maxDist} km)`);
    }
  }
  const lastTier = sortedTiers[sortedTiers.length - 1];
  const hasOutOfCoverage = !!lastTier;

  const previewTier = tierForDistance(previewKm);
  const previewFee = previewTier ? Number(previewTier.fee) || 0 : null;
  const previewPromo = previewTier ? Number(previewTier.promoDiscount) || 0 : null;
  const previewNet = previewTier ? Math.max(0, (Number(previewTier.fee) || 0) - (Number(previewTier.promoDiscount) || 0)) : null;

  const formatRp = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-ink flex items-center space-x-2">
            <Truck className="text-accent" size={22} />
            <span>Delivery Fee Tiering</span>
          </h2>
          <p className="text-xs text-ink-3 mt-0.5">Kelola tarif ongkir homecare berdasarkan jarak dari klinik ke lokasi customer</p>
        </div>
        <button
          onClick={() => loadTiers({ forceFresh: true })}
          className="px-3.5 py-2 rounded-xl bg-surface hover:bg-fill-1 border border-divider text-ink transition flex items-center space-x-1.5 shadow-xs"
          title="Reload dari server"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin text-accent' : 'text-ink-3'} />
          <span className="text-xs font-semibold">Reload</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-danger-soft border border-danger-line text-danger flex items-center space-x-2 text-xs">
          <AlertTriangle size={14} />
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto p-1 rounded hover:bg-danger-line"><X size={12} /></button>
        </div>
      )}
      {success && (
        <div className="p-3 rounded-xl bg-success-soft border border-success-line text-success flex items-center space-x-2 text-xs">
          <Check size={14} />
          <span>{success}</span>
          <button onClick={() => setSuccess('')} className="ml-auto p-1 rounded hover:bg-success-line"><X size={12} /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* === LEFT: Tier table editor === */}
        <div className="lg:col-span-2 bg-surface border border-divider rounded-2xl p-5 space-y-4 shadow-xs">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-ink flex items-center space-x-2">
              <Ruler className="text-accent" size={16} />
              <span>Daftar Tier Jarak</span>
            </h3>
            <span className="px-2.5 py-0.5 rounded-full bg-accent-soft border border-divider text-accent text-[10px] font-bold">
              {tiers.length} tier aktif
            </span>
          </div>

          <div className="hidden md:grid grid-cols-12 gap-2 text-[10px] uppercase font-bold text-ink-3 px-2">
            <div className="col-span-2">Max Dist (km)</div>
            <div className="col-span-3">Ongkir Normal (Rp)</div>
            <div className="col-span-3">Potongan Promo (Rp)</div>
            <div className="col-span-3">Ongkir Net (Rp)</div>
            <div className="col-span-1"></div>
          </div>

          <div className="space-y-2">
            {sortedTiers.map((tier, idx) => {
              const net = Math.max(0, (Number(tier.fee) || 0) - (Number(tier.promoDiscount) || 0));
              const prevMax = idx > 0 ? (Number(sortedTiers[idx - 1].maxDist) || 0) : 0;
              return (
                <div key={tier.id} className="grid grid-cols-2 md:grid-cols-12 gap-2 items-center p-2.5 rounded-xl bg-surface-2 border border-divider">
                  <div className="col-span-1 md:col-span-2">
                    <label className="md:hidden text-[9px] text-ink-3 block uppercase font-bold mb-1">Max Dist (km)</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={tier.maxDist}
                      onChange={(e) => updateTier(idx, 'maxDist', e.target.value === '' ? '' : parseFloat(e.target.value))}
                      placeholder="0"
                      className="w-full p-2 bg-surface border border-divider rounded-lg text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
                    />
                  </div>
                  <div className="col-span-1 md:col-span-3">
                    <label className="md:hidden text-[9px] text-ink-3 block uppercase font-bold mb-1">Normal (Rp)</label>
                    <input
                      type="number"
                      step="1000"
                      min="0"
                      value={tier.fee}
                      onChange={(e) => updateTier(idx, 'fee', e.target.value === '' ? '' : parseInt(e.target.value))}
                      placeholder="0"
                      className="w-full p-2 bg-surface border border-divider rounded-lg text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
                    />
                  </div>
                  <div className="col-span-1 md:col-span-3">
                    <label className="md:hidden text-[9px] text-ink-3 block uppercase font-bold mb-1">Promo (Rp)</label>
                    <input
                      type="number"
                      step="1000"
                      min="0"
                      value={tier.promoDiscount}
                      onChange={(e) => updateTier(idx, 'promoDiscount', e.target.value === '' ? '' : parseInt(e.target.value))}
                      placeholder="0"
                      className="w-full p-2 bg-surface border border-divider rounded-lg text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
                    />
                  </div>
                  <div className="col-span-1 md:col-span-3">
                    <label className="md:hidden text-[9px] text-ink-3 block uppercase font-bold mb-1">Net</label>
                    <div className={`p-2 rounded-lg text-xs font-bold ${net === 0 ? 'bg-success-soft text-success border border-success-line' : 'bg-accent-soft text-accent border border-divider'}`}>
                      {net === 0 ? 'GRATIS' : formatRp(net)}
                    </div>
                  </div>
                  <div className="col-span-2 md:col-span-1 flex md:justify-end">
                    <button
                      onClick={() => removeTier(idx)}
                      className="p-1.5 rounded-lg bg-surface hover:bg-danger-soft border border-divider text-danger hover:text-danger transition shadow-xs"
                      title="Hapus tier"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {idx === 0 && (
                    <div className="col-span-2 md:col-span-12 text-[10px] text-success">
                      Jarak 0 – {prevMax} km: gratis ({prevMax === 0 ? 'belum ada tier minimum, jarak 0 langsung masuk tier ini' : ''})
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {validationIssues.length > 0 && (
            <div className="p-3 rounded-xl bg-warning-soft border border-warning-line text-warning flex items-start space-x-2 text-xs">
              <AlertTriangle className="flex-shrink-0 mt-0.5" size={14} />
              <div>
                <p className="font-bold">Terdapat masalah validasi:</p>
                <ul className="list-disc ml-4 mt-1 space-y-0.5">
                  {validationIssues.map((v, i) => <li key={i}>{v}</li>)}
                </ul>
              </div>
            </div>
          )}

          <div className="pt-2 flex justify-between items-center border-t border-divider">
            <button
              onClick={addTier}
              className="px-3 py-2 bg-surface hover:bg-fill-1 border border-divider rounded-xl text-xs font-semibold text-ink flex items-center space-x-1 transition shadow-xs"
            >
              <Plus size={13} />
              <span>Tambah Tier</span>
            </button>
            <button
              onClick={handleSave}
              disabled={saving || validationIssues.length > 0}
              className="px-4 py-2 bg-accent hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-xs"
            >
              {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
              <span>{saving ? 'Menyimpan...' : 'Simpan Tier'}</span>
            </button>
          </div>
        </div>

        {/* === RIGHT: Live preview & simulasi === */}
        <div className="space-y-6">
          {/* Simulator Ongkir */}
          <div className="bg-surface border border-divider rounded-2xl p-5 space-y-4 shadow-xs">
            <h3 className="text-sm font-bold text-ink flex items-center space-x-2">
              <Coins className="text-accent" size={16} />
              <span>Simulasi Ongkir</span>
            </h3>
            <p className="text-xs text-ink-3">
              Masukkan jarak customer untuk melihat tier & ongkir yang berlaku.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs text-ink-3 font-semibold">Jarak dari klinik (km)</label>
              <div className="flex space-x-2">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={previewKm}
                  onChange={(e) => setPreviewKm(parseFloat(e.target.value) || 0)}
                  className="w-full p-2 bg-surface border border-divider rounded-xl text-xs text-ink focus:outline-none focus:border-accent shadow-xs"
                />
                <div className="flex space-x-1">
                  {[3, 5, 8, 12, 18, 25].map(km => (
                    <button
                      key={km}
                      onClick={() => setPreviewKm(km)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition ${previewKm === km ? 'bg-accent-soft border-accent text-accent' : 'bg-surface border-divider text-ink-2 hover:bg-fill-1'}`}
                    >
                      {km}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {previewTier ? (
              <div className="space-y-2 p-3.5 rounded-xl bg-surface-2 border border-divider">
                <div className="flex justify-between text-xs">
                  <span className="text-ink-3">Tier berlaku</span>
                  <span className="text-ink font-bold">≤ {previewTier.maxDist} km</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-ink-3">Ongkir normal</span>
                  <span className="text-ink font-bold">{previewFee === 0 ? 'GRATIS' : formatRp(previewFee || 0)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-ink-3">Potongan promo</span>
                  <span className="text-success font-bold">- {formatRp(previewPromo || 0)}</span>
                </div>
                <div className="border-t border-divider pt-2 mt-2 flex justify-between text-xs font-bold">
                  <span className="text-ink">Yang dibayar customer</span>
                  <span className={previewNet === 0 ? 'text-success font-extrabold' : 'text-accent font-extrabold text-sm'}>
                    {previewNet === 0 ? 'GRATIS' : formatRp(previewNet || 0)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-warning-soft border border-warning-line text-warning flex items-center space-x-2 text-xs">
                <AlertTriangle size={14} />
                <span>Di luar jangkauan ({previewKm} km melebihi tier maksimum {lastTier ? lastTier.maxDist : '-'} km)</span>
              </div>
            )}
          </div>

          {/* Info & peringatan */}
          <div className="bg-surface border border-divider rounded-2xl p-5 space-y-3 shadow-xs">
            <h3 className="text-sm font-bold text-ink flex items-center space-x-2">
              <Info className="text-accent" size={16} />
              <span>Informasi</span>
            </h3>
            <ul className="space-y-2 text-xs text-ink-2 leading-relaxed">
              <li className="flex space-x-2">
                <span className="text-accent font-bold">•</span>
                <span>Jarak dihitung dari koordinat klinik <code className="bg-fill-1 px-1 py-0.5 rounded text-ink font-mono text-[11px]">-7.34886, 112.751677</code></span>
              </li>
              <li className="flex space-x-2">
                <span className="text-accent font-bold">•</span>
                <span>Menggunakan OpenRouteService (ORS), fallback ke Haversine jika ORS gagal</span>
              </li>
              <li className="flex space-x-2">
                <span className="text-accent font-bold">•</span>
                <span>Perubahan tersimpan langsung di database dan aktif tanpa restart</span>
              </li>
              {hasOutOfCoverage && (
                <li className="flex space-x-2">
                  <span className="text-accent font-bold">•</span>
                  <span>Jarak &gt; {lastTier.maxDist} km = di luar jangkauan (tidak dilayani)</span>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeliveryTiers;
