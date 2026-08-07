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
    <div className="glass-panel border border-white/5 rounded-2xl p-6 space-y-4">
      <h3 className="text-base font-bold text-white flex items-center space-x-2">
        <Smartphone className="text-pink-400" />
        <span>Install App (PWA)</span>
      </h3>
      <p className="text-xs text-slate-400 leading-relaxed">
        Pasang dashboard admin sebagai aplikasi di layar utama HP/Desktop agar akses lebih cepat, seperti aplikasi native.
      </p>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          onClick={handleInstallClick}
          className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-pink-500/10 hover:bg-pink-500/20 border border-pink-500/30 text-pink-300 text-xs font-bold transition shadow-sm"
        >
          <Smartphone size={14} />
          <span>Install App Dashboard</span>
        </button>
        <span className="text-[10px] text-slate-500">
          Gunakan ikon menu browser (&hellip;) → "Tambahkan ke Layar Utama", atau gunakan tombol di atas.
        </span>
      </div>

      {/* PWA Install Guide Modal */}
      {showInstallModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl p-6 space-y-5 shadow-2xl relative">
            <button
              onClick={() => setShowInstallModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X size={20} />
            </button>

            <div>
              <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                <Smartphone size={20} className="text-pink-400" />
                <span>Install Admin App ke Layar Utama</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">Akses cepat dashboard langsung seperti aplikasi HP/Desktop</p>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <div className="p-3 bg-slate-950 rounded-xl border border-white/5 space-y-1.5">
                <p className="font-bold text-pink-300">📱 Android / Chrome / Edge:</p>
                <p className="text-slate-400 leading-relaxed">
                  Buka menu browser titik tiga (⋮) di pojok atas, lalu pilih <strong className="text-white">"Tambahkan ke Layar Utama"</strong> atau <strong className="text-white">"Install Aplikasi"</strong>.
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-white/5 space-y-1.5">
                <p className="font-bold text-pink-300">🍎 iPhone / Safari:</p>
                <p className="text-slate-400 leading-relaxed">
                  Tekan tombol Bagikan (<Share2 size={12} className="inline text-slate-300" />) di navigasi bawah Safari, lalu pilih <strong className="text-white">"Tambah ke Layar Utama"</strong>.
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowInstallModal(false)}
                className="w-full py-2 bg-pink-500 hover:bg-pink-600 text-white font-bold text-xs rounded-xl transition"
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