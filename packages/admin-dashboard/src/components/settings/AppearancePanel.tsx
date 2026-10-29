import React from 'react';
import { Sun, Moon, MonitorSmartphone, Check, Palette } from 'lucide-react';
import { useTheme, type ThemePreference } from '../../contexts/ThemeContext';

const OPTIONS: Array<{
  value: ThemePreference;
  icon: any;
  title: string;
  desc: string;
}> = [
  { value: 'light', icon: Sun, title: 'Terang', desc: 'Tema putih standar medis' },
  { value: 'dark', icon: Moon, title: 'Gelap', desc: 'Tema hitam WhatsApp Web' },
  { value: 'system', icon: MonitorSmartphone, title: 'Otomatis', desc: 'Mengikuti pengaturan perangkat' },
];

/**
 * AppearancePanel — Kartu Pengaturan Tampilan & Tema di Operational Settings.
 * 3 opsi visual: Terang (Light), Gelap (Dark), Otomatis (System).
 * Preferensi per-browser via ThemeContext (localStorage) — bukan data bisnis,
 * sehingga tidak perlu tenant-aware / kolom DB.
 */
export const AppearancePanel: React.FC = () => {
  const { preference, setPreference } = useTheme();

  return (
    <div className="bg-surface border border-divider rounded-2xl p-5 space-y-4 shadow-xs">
      <h3 className="text-sm font-bold text-ink flex items-center space-x-2">
        <Palette className="text-accent" size={16} />
        <span>Tampilan &amp; Tema</span>
      </h3>
      <p className="text-xs text-ink-3">
        Pilih tema warna dashboard. Berlaku instan di perangkat ini tanpa perlu login ulang.
      </p>

      <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Pilihan tema tampilan">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = preference === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setPreference(opt.value)}
              className={`relative flex flex-col items-center gap-1.5 p-3.5 rounded-2xl border-2 transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 cursor-pointer min-h-[104px] justify-center ${
                active
                  ? 'border-accent dark:border-accent bg-accent-soft shadow-xs'
                  : 'border-divider bg-surface hover:border-divider dark:hover:border-accent/40 hover:bg-surface-2 dark:hover:bg-fill-2'
              }`}
            >
              {active && (
                <span className="absolute top-2 right-2 h-5 w-5 rounded-full bg-accent text-white flex items-center justify-center">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
              <Icon
                size={22}
                className={active ? 'text-accent' : 'text-ink-3'}
              />
              <span
                className={`text-xs font-bold ${
                  active ? 'text-accent' : 'text-ink'
                }`}
              >
                {opt.title}
              </span>
              <span className="text-[10px] text-ink-3 leading-tight text-center">
                {opt.desc}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
