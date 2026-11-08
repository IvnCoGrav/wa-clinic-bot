import React from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, KeyRound, ShieldCheck, Check, FileClock, ArrowRight } from 'lucide-react';

interface Props {
  metaPixelId: string;
  setMetaPixelId: (val: string) => void;
  capiAccessToken: string;
  setCapiAccessToken: (val: string) => void;
  capiConfigured: boolean;
  capiSource: string;
  savingCapi: boolean;
  handleSaveCapi: () => void;
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
          {capiConfigured ? `Terhubung (${capiSource === 'db' ? 'Database' : 'ENV'})` : 'Belum Konfigurasi'}
        </span>
      </div>

      <p className="text-xs text-ink-3 leading-relaxed">
        Integrasikan Meta Conversions API (CAPI) untuk melacak event konversi (Purchase &amp; Contact) secara server-side.
        Kredensial disimpan terenkripsi per-tenant di database.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
        <div>
          <label className="block text-xs font-semibold text-ink-2 mb-1.5 flex items-center space-x-1">
            <BarChart3 size={12} className="text-accent" />
            <span>Meta Pixel ID (Dataset ID)</span>
          </label>
          <input
            type="text"
            value={metaPixelId}
            onChange={(e) => setMetaPixelId(e.target.value)}
            placeholder="Contoh: 123456789012345"
            className="w-full px-3 py-2 bg-surface-2 border border-divider rounded-xl text-xs text-ink placeholder:text-ink-4 focus:outline-hidden focus:border-accent font-mono transition"
          />
          <p className="text-[11px] text-ink-4 mt-1">Ditemukan di Meta Events Manager → Data Sources → Pixel ID.</p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink-2 mb-1.5 flex items-center space-x-1">
            <KeyRound size={12} className="text-accent" />
            <span>CAPI Access Token</span>
          </label>
          <input
            type="password"
            value={capiAccessToken}
            onChange={(e) => setCapiAccessToken(e.target.value)}
            placeholder="EAAB... (System User Access Token)"
            className="w-full px-3 py-2 bg-surface-2 border border-divider rounded-xl text-xs text-ink placeholder:text-ink-4 focus:outline-hidden focus:border-accent font-mono transition"
          />
          <p className="text-[11px] text-ink-4 mt-1">Token System User permanen dari Meta Business Manager.</p>
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

      {/* Moderasi Event Purchase Meta CAPI (Queue-First Standard) */}
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
        <p className="text-xs text-ink-3 leading-relaxed">
          Seluruh transaksi pembayaran diproses melalui antrean moderasi CAPI (Queue-First) demi akurasi data &amp; anti-duplikasi sebelum dikirimkan ke Meta.
        </p>
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
              desc: 'Seluruh repeat order tetap dikirim sebagai Purchase standar, tetapi disematkan flag data_processing_options agar Meta tidak menghitungnya ke agregat kampanye baru.',
            },
          ].map((pol) => {
            const isSelected = (metaPurchasePolicy || 'DUAL_EVENT') === pol.id;
            return (
              <label
                key={pol.id}
                onClick={() => handleSavePurchasePolicy && handleSavePurchasePolicy(pol.id)}
                className={`flex items-start justify-between p-3 rounded-xl border cursor-pointer transition text-left ${
                  isSelected
                    ? 'border-accent bg-accent-soft'
                    : 'border-divider hover:border-divider-strong bg-surface-2'
                }`}
              >
                <div className="flex items-start space-x-2.5">
                  <input
                    type="radio"
                    name="metaPurchasePolicy"
                    value={pol.id}
                    checked={isSelected}
                    onChange={() => handleSavePurchasePolicy && handleSavePurchasePolicy(pol.id)}
                    disabled={savingPurchasePolicy}
                    className="mt-0.5 text-accent focus:ring-accent"
                  />
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-ink">{pol.title}</span>
                      <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded-md bg-fill-1 text-ink-2">
                        {pol.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-ink-3 mt-0.5 leading-relaxed">{pol.desc}</p>
                  </div>
                </div>
                {isSelected && <Check size={14} className="text-accent shrink-0 mt-0.5 ml-2" />}
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
};
