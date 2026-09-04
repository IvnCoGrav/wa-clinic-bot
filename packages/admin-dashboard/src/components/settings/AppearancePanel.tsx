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
    <div className="bg-white dark:bg-[#202c33] border border-[#e9edef] dark:border-[#2a3942] rounded-2xl p-5 space-y-4 shadow-xs">
      <h3 className="text-sm font-bold text-[#111b21] dark:text-[#e9edef] flex items-center space-x-2">
        <Palette className="text-[#008069] dark:text-[#00a884]" size={16} />
        <span>Tampilan &amp; Tema</span>
      </h3>
      <p className="text-xs text-[#667781] dark:text-[#8696a0]">
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
              className={`relative flex flex-col items-center gap-1.5 p-3.5 rounded-2xl border-2 transition-all duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#008069]/40 cursor-pointer min-h-[104px] justify-center ${
                active
                  ? 'border-[#008069] dark:border-[#00a884] bg-[#e8f5f2] dark:bg-[#00a884]/15 shadow-xs'
                  : 'border-[#e9edef] dark:border-[#2a3942] bg-white dark:bg-[#111b21] hover:border-[#c2e7e0] dark:hover:border-[#00a884]/40 hover:bg-[#f8fafc] dark:hover:bg-[#2a3942]'
              }`}
            >
              {active && (
                <span className="absolute top-2 right-2 h-5 w-5 rounded-full bg-[#008069] dark:bg-[#00a884] text-white flex items-center justify-center">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
              <Icon
                size={22}
                className={active ? 'text-[#008069] dark:text-[#00a884]' : 'text-[#8696a0]'}
              />
              <span
                className={`text-xs font-bold ${
                  active ? 'text-[#008069] dark:text-[#00a884]' : 'text-[#111b21] dark:text-[#e9edef]'
                }`}
              >
                {opt.title}
              </span>
              <span className="text-[10px] text-[#667781] dark:text-[#8696a0] leading-tight text-center">
                {opt.desc}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
