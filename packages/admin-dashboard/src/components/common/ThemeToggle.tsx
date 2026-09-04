import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

interface ThemeToggleProps {
  size?: number;
  className?: string;
}

/**
 * ThemeToggle — Tombol switcher ☀️/🌙 di kanan atas Header (desktop & mobile).
 * Memakai useTheme (toggle light↔dark), transisi rotasi halus, tooltip jelas.
 * Min tap area 36px (impeccable: tanpa target sentuh mungil).
 */
export const ThemeToggle: React.FC<ThemeToggleProps> = ({ size = 15, className = '' }) => {
  const { resolved, toggle } = useTheme();
  const isDark = resolved === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? 'Beralih ke Mode Terang (Light)' : 'Beralih ke Mode Gelap (Dark)'}
      aria-label={isDark ? 'Beralih ke mode terang' : 'Beralih ke mode gelap'}
      aria-pressed={isDark}
      className={`no-touch-min w-7 h-7 sm:w-8 sm:h-8 rounded-full border transition-all duration-200 active:scale-90 flex items-center justify-center cursor-pointer shadow-2xs aspect-square overflow-hidden ${
        isDark
          ? 'bg-[#2a3942] border-[#374248] text-amber-300 hover:bg-[#374248]'
          : 'bg-amber-50 border-amber-200 text-amber-600 hover:bg-amber-100'
      } ${className}`}
    >
      <span key={isDark ? 'moon' : 'sun'} className="animate-theme-icon flex items-center justify-center">
        {isDark ? <Moon size={size} /> : <Sun size={size} />}
      </span>
    </button>
  );
};
