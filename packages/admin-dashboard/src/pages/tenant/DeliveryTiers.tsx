import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
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
  maxDist: number;
  fee: number;
  promoDiscount: number;
}

export const DeliveryTiers: React.FC = () => {
  const [tiers, setTiers] = useState<DeliveryTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [previewKm, setPreviewKm] = useState(4.5);

  const loadTiers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest('/api/admin/delivery-tiers');
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
      const sorted = [...tiers].sort((a, b) => a.maxDist - b.maxDist);
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

  const updateTier = (idx: number, field: keyof DeliveryTier, value: number) => {
    const next = [...tiers];
    next[idx] = { ...next[idx], [field]: value };
    setTiers(next);
  };

  const addTier = () => {
    const lastMax = tiers.length > 0 ? Math.max(...tiers.map(t => t.maxDist)) : 0;
    setTiers([...tiers, { id: Date.now(), maxDist: lastMax + 5, fee: 30000, promoDiscount: 5000 }]);
  };

  const removeTier = (idx: number) => {
    setTiers(tiers.filter((_, i) => i !== idx));
  };

  const sortedTiers = [...tiers].sort((a, b) => a.maxDist - b.maxDist);

  // Cari tier yang berlaku untuk jarak tertentu
  const tierForDistance = (km: number) => {
    return sortedTiers.find(t => km <= t.maxDist) || null;
  };

  // Validasi: pastikan maxDist berurutan & tidak ada duplikat
  const validationIssues: string[] = [];
  for (let i = 1; i < sortedTiers.length; i++) {
    if (sortedTiers[i].maxDist <= sortedTiers[i - 1].maxDist) {
      validationIssues.push(`Tier "${sortedTiers[i].maxDist} km" harus lebih besar dari tier sebelumnya (${sortedTiers[i - 1].maxDist} km)`);
    }
  }
  const lastTier = sortedTiers[sortedTiers.length - 1];
  const hasOutOfCoverage = !!lastTier;

  const previewTier = tierForDistance(previewKm);
  const previewFee = previewTier ? previewTier.fee : null;
  const previewPromo = previewTier ? previewTier.promoDiscount : null;
  const previewNet = previewTier ? Math.max(0, previewTier.fee - previewTier.promoDiscount) : null;

  const formatRp = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white flex items-center space-x-3">
            <Truck className="text-pink-400" />
            <span>Delivery Fee Tiering</span>
          </h2>
          <p className="text-slate-400 mt-1">Kelola tarif ongkir homecare berdasarkan jarak dari klinik ke lokasi customer</p>
        </div>
        <button
          onClick={loadTiers}
          className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white transition flex items-center space-x-1"
          title="Reload dari server"
        >
          <RefreshCw size={14} />
          <span className="text-[10px] font-bold">Reload</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center space-x-2 text-xs">
          <AlertTriangle size={14} />
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto"><X size={12} /></button>
        </div>
      )}
      {success && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center space-x-2 text-xs">
          <Check size={14} />
          <span>{success}</span>
          <button onClick={() => setSuccess('')} className="ml-auto"><X size={12} /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* === LEFT: Tier table editor === */}
        <div className="lg:col-span-2 glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <Ruler className="text-pink-400" />
              <span>Daftar Tier Jarak</span>
            </h3>
            <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-bold">
              {tiers.length} tier aktif
            </span>
          </div>

          <div className="hidden md:grid grid-cols-12 gap-2 text-[9px] uppercase font-bold text-slate-500 px-2">
            <div className="col-span-2">Max Dist (km)</div>
            <div className="col-span-3">Ongkir Normal (Rp)</div>
            <div className="col-span-3">Potongan Promo (Rp)</div>
            <div className="col-span-3">Ongkir Net (Rp)</div>
            <div className="col-span-1"></div>
          </div>

          <div className="space-y-2">
            {sortedTiers.map((tier, idx) => {
              const net = Math.max(0, tier.fee - (tier.promoDiscount || 0));
              const prevMax = idx > 0 ? sortedTiers[idx - 1].maxDist : 0;
              return (
                <div key={tier.id} className="grid grid-cols-2 md:grid-cols-12 gap-2 items-center p-2 rounded-xl bg-slate-950/60 border border-white/5">
                  <div className="col-span-1 md:col-span-2">
                    <label className="md:hidden text-[9px] text-slate-500 block uppercase font-bold mb-1">Max Dist (km)</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={tier.maxDist}
                      onChange={(e) => updateTier(idx, 'maxDist', parseFloat(e.target.value) || 0)}
                      className="w-full p-2 bg-slate-900 border border-white/10 rounded-lg text-xs text-white"
                    />
                  </div>
                  <div className="col-span-1 md:col-span-3">
                    <label className="md:hidden text-[9px] text-slate-500 block uppercase font-bold mb-1">Normal (Rp)</label>
                    <input
                      type="number"
                      step="1000"
                      min="0"
                      value={tier.fee}
                      onChange={(e) => updateTier(idx, 'fee', parseInt(e.target.value) || 0)}
                      className="w-full p-2 bg-slate-900 border border-white/10 rounded-lg text-xs text-white"
                    />
                  </div>
                  <div className="col-span-1 md:col-span-3">
                    <label className="md:hidden text-[9px] text-slate-500 block uppercase font-bold mb-1">Promo (Rp)</label>
                    <input
                      type="number"
                      step="1000"
                      min="0"
                      value={tier.promoDiscount || 0}
                      onChange={(e) => updateTier(idx, 'promoDiscount', parseInt(e.target.value) || 0)}
                      className="w-full p-2 bg-slate-900 border border-white/10 rounded-lg text-xs text-white"
                    />
                  </div>
                  <div className="col-span-1 md:col-span-3">
                    <label className="md:hidden text-[9px] text-slate-500 block uppercase font-bold mb-1">Net</label>
                    <div className={`p-2 rounded-lg text-xs font-bold ${net === 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-pink-500/10 text-pink-300'}`}>
                      {net === 0 ? 'GRATIS' : formatRp(net)}
                    </div>
                  </div>
                  <div className="col-span-2 md:col-span-1 flex md:justify-end">
                    <button
                      onClick={() => removeTier(idx)}
                      className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white transition"
                      title="Hapus tier"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  {idx === 0 && (
                    <div className="col-span-2 md:col-span-12 text-[9px] text-emerald-400/80">
                      Jarak 0 – {prevMax} km: gratis ({prevMax === 0 ? 'belum ada tier minimum, jarak 0 langsung masuk tier ini' : ''})
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {validationIssues.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-start space-x-2 text-[10px]">
              <AlertTriangle className="flex-shrink-0 mt-0.5" size={14} />
              <div>
                <p className="font-bold">Terdapat masalah validasi:</p>
                <ul className="list-disc ml-4 mt-1 space-y-0.5">
                  {validationIssues.map((v, i) => <li key={i}>{v}</li>)}
                </ul>
              </div>
            </div>
          )}

          <div className="pt-2 flex justify-between">
            <button
              onClick={addTier}
              className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-[10px] font-bold text-slate-300 hover:text-white flex items-center space-x-1 transition"
            >
              <Plus size={12} />
              <span>Tambah Tier</span>
            </button>
            <button
              onClick={handleSave}
              disabled={saving || validationIssues.length > 0}
              className="px-5 py-2 bg-pink-500 hover:bg-pink-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold transition flex items-center space-x-1.5"
            >
              {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
              <span>{saving ? 'Menyimpan...' : 'Simpan Tier'}</span>
            </button>
          </div>
        </div>

        {/* === RIGHT: Live preview & simulasi === */}
        <div className="space-y-8">
          {/* Simulator Ongkir */}
          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <Coins className="text-pink-400" />
              <span>Simulasi Ongkir</span>
            </h3>
            <p className="text-xs text-slate-400">
              Masukkan jarak customer untuk melihat tier & ongkir yang berlaku.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Jarak dari klinik (km)</label>
              <div className="flex space-x-2">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={previewKm}
                  onChange={(e) => setPreviewKm(parseFloat(e.target.value) || 0)}
                  className="w-full p-2.5 bg-slate-950 border border-white/10 rounded-xl text-xs text-white"
                />
                <div className="flex space-x-1">
                  {[3, 5, 8, 12, 18, 25].map(km => (
                    <button
                      key={km}
                      onClick={() => setPreviewKm(km)}
                      className={`px-2 py-1 rounded-lg text-[9px] font-bold border transition ${previewKm === km ? 'bg-pink-500/20 border-pink-500/40 text-pink-300' : 'bg-white/5 border-white/10 text-slate-500 hover:text-slate-300'}`}
                    >
                      {km}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {previewTier ? (
              <div className="space-y-2 p-4 rounded-xl bg-slate-950 border border-white/5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Tier berlaku</span>
                  <span className="text-white font-semibold">≤ {previewTier.maxDist} km</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Ongkir normal</span>
                  <span className="text-white font-semibold">{previewFee === 0 ? 'GRATIS' : formatRp(previewFee!)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Potongan promo</span>
                  <span className="text-emerald-400 font-semibold">- {formatRp(previewPromo!)}</span>
                </div>
                <div className="border-t border-white/10 pt-2 mt-2 flex justify-between text-sm">
                  <span className="text-slate-300 font-bold">Yang dibayar customer</span>
                  <span className={previewNet === 0 ? 'text-emerald-400 font-extrabold' : 'text-pink-400 font-extrabold'}>
                    {previewNet === 0 ? 'GRATIS' : formatRp(previewNet!)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center space-x-2 text-xs">
                <AlertTriangle size={14} />
                <span>Di luar jangkauan ({previewKm} km melebihi tier maksimum {lastTier ? lastTier.maxDist : '-'} km)</span>
              </div>
            )}
          </div>

          {/* Info & peringatan */}
          <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-3">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <Info className="text-pink-400" />
              <span>Informasi</span>
            </h3>
            <ul className="space-y-2 text-[11px] text-slate-400 leading-relaxed">
              <li className="flex space-x-2">
                <span className="text-pink-400">•</span>
                <span>Jarak dihitung dari koordinat klinik <code className="text-slate-300">-7.34886, 112.751677</code></span>
              </li>
              <li className="flex space-x-2">
                <span className="text-pink-400">•</span>
                <span>Menggunakan OpenRouteService (ORS), fallback ke Haversine jika ORS gagal</span>
              </li>
              <li className="flex space-x-2">
                <span className="text-pink-400">•</span>
                <span>Perubahan tersimpan langsung di <code className="text-slate-300">delivery_tiers_custom.json</code> dan aktif tanpa restart</span>
              </li>
              {hasOutOfCoverage && (
                <li className="flex space-x-2">
                  <span className="text-pink-400">•</span>
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
