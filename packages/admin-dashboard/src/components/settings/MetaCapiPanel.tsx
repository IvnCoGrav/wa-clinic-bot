import React from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, KeyRound, ShieldCheck, Check, FileClock, ArrowRight } from 'lucide-react';
import { ToggleSwitch } from '../common/ToggleSwitch';

interface Props {
  metaPixelId: string;
  setMetaPixelId: (val: string) => void;
  capiAccessToken: string;
  setCapiAccessToken: (val: string) => void;
  capiConfigured: boolean;
  capiSource: string;
  savingCapi: boolean;
  handleSaveCapi: () => void;
  autoSendPurchaseCapi: boolean;
  savingPurchaseModeration: boolean;
  handleTogglePurchaseModeration: (val: boolean) => void;
  metaPurchasePolicy?: string;
  savingPurchasePolicy?: boolean;
  handleSavePurchasePolicy?: (val: string) => void;
}

export const MetaCapiPanel: React.FC<Props> = ({
  metaPixelId,
  setMetaPixelId,
  capiAccessToken,
  setCapiAccessToken,
  capiConfigured,
  capiSource,
  savingCapi,
  handleSaveCapi,
  autoSendPurchaseCapi,
  savingPurchaseModeration,
  handleTogglePurchaseModeration,
  metaPurchasePolicy,
  savingPurchasePolicy,
  handleSavePurchasePolicy,
}) => {
  return (
    <div className="bg-surface border border-divider rounded-2xl p-5 space-y-4 shadow-xs">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink flex items-center space-x-2">
          <BarChart3 className="text-accent" size={16} />
          <span>Meta Pixel &amp; CAPI (Konversi Iklan Meta)</span>
        </h3>
        <span
          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
            capiConfigured ? 'bg-success-soft text-success border border-success-line' : 'bg-fill-1 text-ink border border-divider'
          }`}
        >
          {capiConfigured ? `CONFIGURED (${capiSource.toUpperCase()})` : 'NOT CONFIGURED'}
        </span>
      </div>

      <p className="text-xs text-ink-3 leading-relaxed">
        Integrasi Conversion API (CAPI) Meta untuk mengirim event konversi (Lead &amp; Purchase) secara server-side ke Meta Ads Manager.
      </p>

      <div className="rounded-xl bg-accent-soft dark:bg-accent-soft border border-emerald-200 dark:border-accent/30 px-3 py-2.5 text-[11px] text-accent dark:text-success leading-relaxed">
        <span className="font-bold text-ink">Atribusi iklan Click-to-WhatsApp (CTWA):</span> agar
        konversi dari iklan WhatsApp teratribusi benar, isi juga{' '}
        <span className="font-semibold">Business Account ID</span> di{' '}
        <span className="font-semibold">WhatsApp Provider → tab WABA</span>. Field itu dipakai lintas
        provider (WAHA/WABA) untuk mengirim event CTWA dengan envelope Business Messaging Meta. Bila
        dikosongkan, sistem tetap jalan dalam mode kompatibel (event dikirim sebagai chat biasa).
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-ink flex items-center space-x-1">
            <BarChart3 size={11} className="text-accent" />
            <span>Meta Pixel ID</span>
          </label>
          <input
            type="text"
            value={metaPixelId}
            onChange={(e) => setMetaPixelId(e.target.value)}
            placeholder="mis. 123456789012345"
            className="w-full bg-surface border border-divider rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent shadow-xs"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold text-ink flex items-center space-x-1">
            <ShieldCheck size={11} className="text-accent" />
            <span>CAPI Access Token (Meta Conversion API)</span>
          </label>
          <input
            type="password"
            value={capiAccessToken}
            onChange={(e) => setCapiAccessToken(e.target.value)}
            placeholder={capiConfigured ? '•••••••• (kosongkan bila tidak diubah)' : 'EAA... Meta CAPI Access Token'}
            className="w-full bg-surface border border-divider rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent shadow-xs"
          />
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <button
          onClick={handleSaveCapi}
          disabled={savingCapi}
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl text-xs font-semibold transition flex items-center space-x-1.5 disabled:opacity-50 shadow-xs"
        >
          <span>{savingCapi ? 'Menyimpan CAPI...' : 'Simpan Kredensial CAPI'}</span>
        </button>
      </div>

      {/* Moderasi Event Purchase Meta CAPI (Outlier Filter Queue) */}
      <div className="border-t border-divider pt-4 mt-2">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-bold text-ink flex items-center space-x-1.5">
            <FileClock className="text-accent" size={14} />
            <span>Moderasi Purchase Meta (CAPI)</span>
          </h4>
          <Link
            to="/admin/meta-capi-queue"
            className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-surface hover:bg-fill-1 border border-divider text-ink text-xs font-semibold transition shadow-xs"
          >
            <span>Buka Meta CAPI Queue</span>
            <ArrowRight size={11} />
          </Link>
        </div>
        <p className="text-xs text-ink-3 leading-relaxed mb-3">
          Jika OFF, transaksi pembayaran ditahan di queue moderasi (Pending Review) sampai disetujui admin —
          mencegah data outlier terkirim ke Meta.
        </p>
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-surface-2 border border-divider opacity-90">
          <div className="pr-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-ink">Auto-send Purchase CAPI</span>
              <span className="text-[10px] bg-success-soft text-success font-semibold px-2 py-0.5 rounded-full">
                Queue-First
              </span>
            </div>
            <p className="text-xs text-ink-3 mt-0.5">
              Seluruh transaksi pembayaran kini diproses via antrean moderasi CAPI demi akurasi data &amp; anti-duplikasi.
            </p>
          </div>
          <ToggleSwitch
            checked={false}
            onChange={() => {}}
            disabled={true}
            loading={false}
            onLabel="ON (AUTO-SEND)"
            offLabel="OFF (QUEUE-FIRST)"
            size="md"
            title="Kebijakan Queue-First: seluruh event melalui moderasi antrean CAPI"
          />
        </div>
      </div>

      {/* Kebijakan Atribusi Repeat Purchase Meta CAPI */}
      <div className="border-t border-divider pt-4 mt-2 space-y-2">
        <h4 className="text-xs font-bold text-ink flex items-center space-x-1.5">
          <ShieldCheck className="text-accent" size={14} />
          <span>Kebijakan Repeat Purchase (Anti-Distorsi CAC)</span>
        </h4>
        <p className="text-xs text-ink-3 leading-relaxed">
          Pilih bagaimana sistem memproses repeat purchase (pelanggan lama) ke Meta CAPI. Mode Dual Event
          direkomendasikan: sinyal pelanggan lama tetap terkirim tanpa mengotori metrik akuisisi (CAC).
        </p>

        <div className="grid grid-cols-1 gap-2 pt-1">
          {[
            {
              id: 'DUAL_EVENT',
              title: 'Dual Event (Disarankan)',
              badge: 'Retention Tracking',
              desc: 'Order pertama dikirim sebagai Purchase (target optimasi akuisisi). Repeat order dikirim sebagai Custom Event ReturningCustomerPurchase, sehingga sinyal LTV tetap terkirim tanpa mengotori CAC.',
            },
            {
              id: 'SUPPRESS_REPEAT',
              title: 'Akuisisi Murni (Tanpa Sinyal Repeat)',
              badge: 'CAC Protection',
              desc: 'Repeat order tidak dikirim sama sekali ke Meta. Metrik CAC bersih, tetapi sinyal pembeli lama dan potensi LTV hilang dari optimizer.',
            },
            {
              id: 'ALL_WITH_TAG',
              title: 'Kirim Semua + opt_out=true',
              badge: 'Atribusi saja',
              desc: 'Semua order dikirim sebagai Purchase, repeat order ditandai opt_out=true. Catatan: opt_out hanya mengeluarkan event dari optimasi delivery — event tetap dihitung di laporan atribusi.',
            },
          ].map((opt) => (
            <label
              key={opt.id}
              onClick={() => handleSavePurchasePolicy && handleSavePurchasePolicy(opt.id)}
              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                (metaPurchasePolicy || 'DUAL_EVENT') === opt.id
                  ? 'border-accent bg-success-soft'
                  : 'border-divider bg-surface hover:bg-surface-2'
              }`}
            >
              <input
                type="radio"
                name="metaPurchasePolicy"
                value={opt.id}
                checked={(metaPurchasePolicy || 'DUAL_EVENT') === opt.id}
                onChange={() => {}}
                disabled={savingPurchasePolicy}
                className="mt-0.5 text-accent focus:ring-accent"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-ink">{opt.title}</span>
                  <span className="text-[10px] bg-fill-1 text-ink font-semibold px-2 py-0.2 rounded">
                    {opt.badge}
                  </span>
                </div>
                <p className="text-[11px] text-ink-3 mt-0.5 leading-relaxed">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
};
