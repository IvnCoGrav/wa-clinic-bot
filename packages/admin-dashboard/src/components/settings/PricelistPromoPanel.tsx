import React, { useEffect, useState } from 'react';
import { Gift, Save, Plus, Trash2, Image as ImageIcon, Loader2 } from 'lucide-react';
import { apiRequest } from '../../services/api';
import { useUiFeedback } from '../common/UiFeedback';
import { ToggleSwitch } from '../common/ToggleSwitch';

interface PromoRule {
  title: string;
  body: string;
}

interface PromoConfig {
  enabled: boolean;
  delaySeconds: number;
  discountPercent: number;
  instagramAccount: string;
  badgeTitle: string;
  badgeSubtitle: string;
  modalTitle: string;
  modalDescription: string;
  rules: PromoRule[];
  claimMessageTemplate: string;
}

export const PricelistPromoPanel: React.FC = () => {
  const { toast } = useUiFeedback();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Logo Brand
  const [brandLogoUrl, setBrandLogoUrl] = useState('');

  // Promo Config
  const [enabled, setEnabled] = useState(false);
  const [delaySeconds, setDelaySeconds] = useState(5);
  const [discountPercent, setDiscountPercent] = useState(10);
  const [instagramAccount, setInstagramAccount] = useState('');
  const [badgeTitle, setBadgeTitle] = useState('');
  const [badgeSubtitle, setBadgeSubtitle] = useState('');
  const [modalTitle, setModalTitle] = useState('');
  const [modalDescription, setModalDescription] = useState('');
  const [rules, setRules] = useState<PromoRule[]>([]);
  const [claimMessageTemplate, setClaimMessageTemplate] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/admin/settings/pricelist-promo');
      if (res && res.success && res.data) {
        const promo: PromoConfig = res.data.promo || {};
        setEnabled(Boolean(promo.enabled));
        setDelaySeconds(promo.delaySeconds ?? 5);
        setDiscountPercent(promo.discountPercent ?? 10);
        setInstagramAccount(promo.instagramAccount || '');
        setBadgeTitle(promo.badgeTitle || '');
        setBadgeSubtitle(promo.badgeSubtitle || '');
        setModalTitle(promo.modalTitle || '');
        setModalDescription(promo.modalDescription || '');
        setRules(Array.isArray(promo.rules) ? promo.rules : []);
        setClaimMessageTemplate(promo.claimMessageTemplate || '');
        setBrandLogoUrl(res.data.brandLogoUrl || '');
      }
    } catch (err: any) {
      toast(`Gagal memuat pengaturan promo: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddRule = () => {
    setRules([...rules, { title: '', body: '' }]);
  };

  const handleUpdateRule = (index: number, field: 'title' | 'body', value: string) => {
    const updated = [...rules];
    updated[index] = { ...updated[index], [field]: value };
    setRules(updated);
  };

  const handleRemoveRule = (index: number) => {
    setRules(rules.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (brandLogoUrl.trim()) {
      const isValid = /^https?:\/\//i.test(brandLogoUrl.trim()) || /^\/assets\/[a-zA-Z0-9._-]+$/i.test(brandLogoUrl.trim());
      if (!isValid) {
        toast('URL Logo harus diawali https://, http:// atau /assets/...', 'error');
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        brandLogoUrl: brandLogoUrl.trim() || null,
        promo: {
          enabled,
          delaySeconds: Number(delaySeconds) || 0,
          discountPercent: Number(discountPercent) || 0,
          instagramAccount: instagramAccount.replace(/^@/, '').trim(),
          badgeTitle: badgeTitle.trim(),
          badgeSubtitle: badgeSubtitle.trim(),
          modalTitle: modalTitle.trim(),
          modalDescription: modalDescription.trim(),
          rules: rules.filter((r) => r.title.trim() || r.body.trim()),
          claimMessageTemplate: claimMessageTemplate.trim(),
        },
      };

      const res = await apiRequest('/api/admin/settings/pricelist-promo', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      if (res && res.success) {
        toast(res.message || 'Pengaturan promo dan logo berhasil disimpan.', 'success');
        await loadData();
      } else {
        toast(res?.error || 'Gagal menyimpan pengaturan.', 'error');
      }
    } catch (err: any) {
      toast(`Gagal menyimpan pengaturan: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] rounded-2xl p-6 shadow-xs flex items-center justify-center space-x-3 text-[#667781] dark:text-[#8696a0]">
        <Loader2 className="w-5 h-5 animate-spin text-[#008069]" />
        <span className="text-sm">Memuat pengaturan promo &amp; logo pricelist...</span>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] rounded-2xl p-5 md:p-6 shadow-xs space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#e9edef] dark:border-[#2a3942] pb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-[#e8f5f2] text-[#008069] border border-[#c2e7e0]">
            <Gift size={20} />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#111b21] dark:text-[#e9edef]">Logo &amp; Penawaran Promo Pricelist</h3>
            <p className="text-xs text-[#667781] dark:text-[#8696a0]">
              Atur logo brand dan promo diskon interaktif pada landing page publik (/pricelist).
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center justify-center px-4 py-2.5 min-h-[44px] bg-[#008069] hover:bg-[#006a57] text-white text-sm font-semibold rounded-xl shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed space-x-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save size={16} />}
          <span>{saving ? 'Menyimpan...' : 'Simpan Perubahan'}</span>
        </button>
      </div>

      {/* Bagian 1: Logo Brand Publik */}
      <div className="space-y-3">
        <label className="block text-xs font-bold uppercase tracking-wider text-[#41525d] dark:text-[#8696a0]">
          Logo Brand Publik (/pricelist)
        </label>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex-1 w-full">
            <input
              type="text"
              value={brandLogoUrl}
              onChange={(e) => setBrandLogoUrl(e.target.value)}
              placeholder="Contoh: /assets/kala-logo.svg atau https://..."
              className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#f0f2f5] dark:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] rounded-xl text-[#111b21] dark:text-[#e9edef] focus:outline-hidden focus:ring-2 focus:ring-[#008069] transition"
            />
            <p className="text-xs text-[#667781] dark:text-[#8696a0] mt-1.5 leading-relaxed">
              Path aset lokal (misal: <code className="bg-[#f0f2f5] px-1 py-0.5 rounded text-[#111b21] dark:text-[#e9edef]">/assets/kala-logo.svg</code>) atau URL gambar publik. Kosongkan untuk menggunakan inisial monogram otomatis dari nama bisnis.
            </p>
          </div>

          {/* Logo Preview */}
          <div className="flex items-center gap-2">
            <div className="w-12 h-12 rounded-xl border border-[#e9edef] dark:border-[#2a3942] bg-[#fafafa] dark:bg-[#202c33] flex items-center justify-center overflow-hidden shrink-0">
              {brandLogoUrl ? (
                <img
                  src={brandLogoUrl}
                  alt="Logo Preview"
                  className="w-10 h-10 object-contain"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <ImageIcon className="text-[#aebac1]" size={20} />
              )}
            </div>
            <button
              type="button"
              onClick={() => setBrandLogoUrl('/assets/kala-logo.svg')}
              className="text-xs text-[#008069] hover:underline px-2 py-1 min-h-[44px] flex items-center"
            >
              Gunakan Logo Kala
            </button>
          </div>
        </div>
      </div>

      {/* Bagian 2: Promosi Diskon Melayang */}
      <div className="pt-4 border-t border-[#e9edef] dark:border-[#2a3942] space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-[#111b21] dark:text-[#e9edef]">Badge &amp; Pop-up Promo Diskon</h4>
            <p className="text-xs text-[#667781] dark:text-[#8696a0]">
              Aktifkan penawaran diskon melayang (floating badge) yang mengarahkan customer ke WhatsApp.
            </p>
          </div>
          <ToggleSwitch
            checked={enabled}
            onChange={setEnabled}
            label={enabled ? 'Promo Aktif' : 'Promo Nonaktif'}
          />
        </div>

        {enabled && (
          <div className="space-y-4 pt-2">
            {/* Row 1: Parameter Teknis */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#41525d] dark:text-[#8696a0] mb-1">
                  Delay Tampil (Detik)
                </label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={delaySeconds}
                  onChange={(e) => setDelaySeconds(Number(e.target.value))}
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#f0f2f5] dark:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] rounded-xl text-[#111b21] dark:text-[#e9edef] focus:outline-hidden focus:ring-2 focus:ring-[#008069]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#41525d] dark:text-[#8696a0] mb-1">
                  Diskon (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(Number(e.target.value))}
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#f0f2f5] dark:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] rounded-xl text-[#111b21] dark:text-[#e9edef] focus:outline-hidden focus:ring-2 focus:ring-[#008069]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#41525d] dark:text-[#8696a0] mb-1">
                  Akun Instagram (Tanpa @)
                </label>
                <input
                  type="text"
                  value={instagramAccount}
                  onChange={(e) => setInstagramAccount(e.target.value)}
                  placeholder="kalababyspa"
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#f0f2f5] dark:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] rounded-xl text-[#111b21] dark:text-[#e9edef] focus:outline-hidden focus:ring-2 focus:ring-[#008069]"
                />
              </div>
            </div>

            {/* Row 2: Badge Teks */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#41525d] dark:text-[#8696a0] mb-1">
                  Judul Badge Melayang
                </label>
                <input
                  type="text"
                  value={badgeTitle}
                  onChange={(e) => setBadgeTitle(e.target.value)}
                  placeholder="Spesial Diskon 10%"
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#f0f2f5] dark:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] rounded-xl text-[#111b21] dark:text-[#e9edef] focus:outline-hidden focus:ring-2 focus:ring-[#008069]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#41525d] dark:text-[#8696a0] mb-1">
                  Subjudul Badge
                </label>
                <input
                  type="text"
                  value={badgeSubtitle}
                  onChange={(e) => setBadgeSubtitle(e.target.value)}
                  placeholder="Follow IG &amp; Klaim Promo"
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#f0f2f5] dark:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] rounded-xl text-[#111b21] dark:text-[#e9edef] focus:outline-hidden focus:ring-2 focus:ring-[#008069]"
                />
              </div>
            </div>

            {/* Row 3: Modal Teks */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#41525d] dark:text-[#8696a0] mb-1">
                  Judul Pop-up Modal
                </label>
                <input
                  type="text"
                  value={modalTitle}
                  onChange={(e) => setModalTitle(e.target.value)}
                  placeholder="Syarat &amp; Ketentuan Promo"
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#f0f2f5] dark:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] rounded-xl text-[#111b21] dark:text-[#e9edef] focus:outline-hidden focus:ring-2 focus:ring-[#008069]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#41525d] dark:text-[#8696a0] mb-1">
                  Deskripsi Singkat Modal
                </label>
                <input
                  type="text"
                  value={modalDescription}
                  onChange={(e) => setModalDescription(e.target.value)}
                  placeholder="Ikuti langkah berikut untuk mendapatkan potongan harga treatment"
                  className="w-full min-h-[44px] px-3 py-2 text-sm bg-[#f0f2f5] dark:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] rounded-xl text-[#111b21] dark:text-[#e9edef] focus:outline-hidden focus:ring-2 focus:ring-[#008069]"
                />
              </div>
            </div>

            {/* Row 4: Aturan Promo (Rules Editor) */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-[#41525d] dark:text-[#8696a0]">
                  Daftar Syarat &amp; Ketentuan ({rules.length})
                </label>
                <button
                  type="button"
                  onClick={handleAddRule}
                  className="inline-flex items-center space-x-1.5 text-xs text-[#008069] font-semibold hover:bg-[#e8f5f2] px-3 py-2 min-h-[44px] rounded-xl transition"
                >
                  <Plus size={14} />
                  <span>Tambah Syarat</span>
                </button>
              </div>

              {rules.length === 0 ? (
                <div className="p-4 border border-dashed border-[#e9edef] rounded-xl text-center text-xs text-[#667781] dark:text-[#8696a0]">
                  Belum ada syarat promo. Klik "Tambah Syarat" di atas.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {rules.map((rule, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 bg-[#f8faf9] dark:bg-[#202c33] p-3 rounded-xl border border-[#e9edef] dark:border-[#2a3942]"
                    >
                      <span className="w-6 h-6 rounded-full bg-[#e8f5f2] text-[#008069] text-xs font-bold flex items-center justify-center shrink-0 mt-2">
                        {idx + 1}
                      </span>
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={rule.title}
                          onChange={(e) => handleUpdateRule(idx, 'title', e.target.value)}
                          placeholder="Judul syarat (misal: Follow Instagram)"
                          className="w-full min-h-[44px] px-3 py-2 text-xs bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] rounded-lg text-[#111b21] dark:text-[#e9edef] focus:outline-hidden focus:ring-2 focus:ring-[#008069]"
                        />
                        <input
                          type="text"
                          value={rule.body}
                          onChange={(e) => handleUpdateRule(idx, 'body', e.target.value)}
                          placeholder="Rincian (misal: Follow akun resmi kami)"
                          className="w-full min-h-[44px] px-3 py-2 text-xs bg-white dark:bg-[#111b21] border border-[#e9edef] dark:border-[#2a3942] rounded-lg text-[#111b21] dark:text-[#e9edef] focus:outline-hidden focus:ring-2 focus:ring-[#008069]"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveRule(idx)}
                        className="p-2 text-[#667781] dark:text-[#8696a0] hover:text-[#ea0038] hover:bg-red-50 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center transition"
                        title="Hapus aturan ini"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Row 5: Template Pesan Klaim WA */}
            <div className="space-y-1.5 pt-2">
              <label className="block text-xs font-semibold text-[#41525d] dark:text-[#8696a0]">
                Template Pesan WhatsApp Saat Klaim Promo
              </label>
              <textarea
                rows={3}
                value={claimMessageTemplate}
                onChange={(e) => setClaimMessageTemplate(e.target.value)}
                placeholder="Halo, saya ingin klaim promo diskon {discount}% setelah follow IG @{instagram}. Mohon info jadwal treatment yang tersedia."
                className="w-full px-3 py-2 text-sm bg-[#f0f2f5] dark:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] rounded-xl text-[#111b21] dark:text-[#e9edef] focus:outline-hidden focus:ring-2 focus:ring-[#008069] leading-relaxed"
              />
              <p className="text-xs text-[#667781] dark:text-[#8696a0]">
                Gunakan tag variabel <code className="bg-[#f0f2f5] px-1 py-0.5 rounded text-[#111b21] dark:text-[#e9edef]">{'{discount}'}</code> untuk persentase diskon dan <code className="bg-[#f0f2f5] px-1 py-0.5 rounded text-[#111b21] dark:text-[#e9edef]">{'{instagram}'}</code> untuk nama akun Instagram.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
