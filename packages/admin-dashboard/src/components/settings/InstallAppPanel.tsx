import React, { useState, useEffect } from 'react';
import { Smartphone, Share2, X } from 'lucide-react';

export const InstallAppPanel: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallModal, setShowInstallModal] = useState<boolean>(false);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      setShowInstallModal(true);
    }
  };

  return (
    <div className="bg-surface border border-divider rounded-2xl p-5 space-y-4 shadow-xs">
      <h3 className="text-sm font-bold text-ink flex items-center space-x-2">
        <Smartphone className="text-accent" size={16} />
        <span>Install App (PWA)</span>
      </h3>
      <p className="text-xs text-ink-3 leading-relaxed">
        Pasang dashboard admin sebagai aplikasi di layar utama HP/Desktop agar akses lebih cepat, seperti aplikasi native.
      </p>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          onClick={handleInstallClick}
          className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-accent-soft hover:bg-accent-soft dark:hover:bg-accent/25 border border-divider dark:border-accent/30 text-accent text-xs font-bold transition shadow-xs"
        >
          <Smartphone size={14} />
          <span>Install App Dashboard</span>
        </button>
        <span className="text-xs text-ink-3">
          Gunakan ikon menu browser (&hellip;) → "Tambahkan ke Layar Utama", atau gunakan tombol di atas.
        </span>
      </div>

      {/* PWA Install Guide Modal */}
      {showInstallModal && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4"
          onClick={() => setShowInstallModal(false)}
        >
          <div
            className="w-full max-w-md bg-surface border border-divider rounded-2xl p-6 space-y-5 shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowInstallModal(false)}
              className="absolute top-4 right-4 text-ink-3 hover:text-ink"
            >
              <X size={20} />
            </button>

            <div>
              <h3 className="text-base font-bold text-ink flex items-center space-x-2">
                <Smartphone size={18} className="text-accent" />
                <span>Install Admin App ke Layar Utama</span>
              </h3>
              <p className="text-xs text-ink-3 mt-0.5">Akses cepat dashboard langsung seperti aplikasi HP/Desktop</p>
            </div>

            <div className="space-y-3 text-xs text-ink">
              <div className="p-3 bg-surface-2 rounded-xl border border-divider space-y-1">
                <p className="font-bold text-accent">📱 Android / Chrome / Edge:</p>
                <p className="text-xs text-ink-3 leading-relaxed">
                  Buka menu browser titik tiga (⋮) di pojok atas, lalu pilih <strong className="text-ink">"Tambahkan ke Layar Utama"</strong> atau <strong className="text-ink">"Install Aplikasi"</strong>.
                </p>
              </div>

              <div className="p-3 bg-surface-2 rounded-xl border border-divider space-y-1">
                <p className="font-bold text-accent">🍎 iPhone / Safari:</p>
                <p className="text-xs text-ink-3 leading-relaxed">
                  Tekan tombol Bagikan (<Share2 size={12} className="inline text-ink-3" />) di navigasi bawah Safari, lalu pilih <strong className="text-ink">"Tambah ke Layar Utama"</strong>.
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowInstallModal(false)}
                className="w-full py-2 bg-accent hover:bg-accent-hover text-accent-ink font-semibold text-xs rounded-xl transition shadow-xs"
              >
                Saya Mengerti
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};