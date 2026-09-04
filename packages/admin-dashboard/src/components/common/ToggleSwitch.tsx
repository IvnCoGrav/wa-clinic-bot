import React from 'react';
import { Loader2 } from 'lucide-react';

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  size?: 'sm' | 'md' | 'lg';
  label?: React.ReactNode;
  description?: React.ReactNode;
  showStatusBadge?: boolean;
  onLabel?: string;
  offLabel?: string;
  badgePlacement?: 'inline-right' | 'inline-left' | 'none';
  variant?: 'emerald' | 'indigo' | 'rose';
  id?: string;
  className?: string;
  title?: string;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  loading = false,
  size = 'md',
  label,
  description,
  showStatusBadge = true,
  onLabel = 'ON',
  offLabel = 'OFF',
  badgePlacement = 'inline-right',
  variant = 'emerald',
  id,
  className = '',
  title,
}) => {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !loading) {
      onChange(!checked);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!disabled && !loading) {
        onChange(!checked);
      }
    }
  };

  // Color variants for active state
  const activeBg = {
    emerald: 'bg-[#008069]',
    indigo: 'bg-indigo-600',
    rose: 'bg-rose-600',
  }[variant];

  const activeBadge = {
    emerald: 'bg-emerald-100 dark:bg-[#00a884]/20 text-emerald-800 dark:text-[#4ae3b5] border-emerald-300 dark:border-[#00a884]/40',
    indigo: 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-800 dark:text-indigo-300 border-indigo-300 dark:border-indigo-500/40',
    rose: 'bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-500/40',
  }[variant];

  // Size styling maps
  const trackSizes = {
    sm: 'w-8 h-4.5',
    md: 'w-11 h-6',
    lg: 'w-13 h-7',
  }[size];

  const thumbSizes = {
    sm: 'w-3.5 h-3.5',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
  }[size];

  const thumbTranslates = {
    sm: 'translate-x-3.5',
    md: 'translate-x-5',
    lg: 'translate-x-6',
  }[size];

  const badgeTextSizes = {
    sm: 'text-[10px] px-1.5 py-0.5',
    md: 'text-[11px] px-2 py-0.5',
    lg: 'text-xs px-2.5 py-1',
  }[size];

  const statusBadge = showStatusBadge && badgePlacement !== 'none' && (
    <span
      className={`inline-flex items-center gap-1 font-bold rounded-md border font-mono transition-colors uppercase select-none ${badgeTextSizes} ${
        checked
          ? activeBadge
          : 'bg-slate-100 dark:bg-[#2a3942] text-slate-600 dark:text-[#8696a0] border-slate-200 dark:border-[#374248]'
      }`}
    >
      {loading ? (
        <Loader2 size={size === 'sm' ? 10 : 12} className="animate-spin" />
      ) : (
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            checked
              ? variant === 'emerald'
                ? 'bg-[#008069]'
                : variant === 'indigo'
                ? 'bg-indigo-600'
                : 'bg-rose-600'
              : 'bg-slate-400'
          }`}
        />
      )}
      <span>{checked ? onLabel : offLabel}</span>
    </span>
  );

  return (
    <div
      className={`inline-flex items-center gap-2.5 ${
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
      onClick={!disabled && !loading ? handleClick : undefined}
      title={title}
    >
      {badgePlacement === 'inline-left' && statusBadge}

      {(label || description) && (
        <div className="flex flex-col">
          {label && (
            <label
              htmlFor={id}
              className={`text-xs font-bold text-[#111b21] dark:text-[#e9edef] select-none ${
                !disabled ? 'cursor-pointer' : ''
              }`}
            >
              {label}
            </label>
          )}
          {description && (
            <p className="text-[11px] text-[#667781] dark:text-[#8696a0] leading-relaxed select-none">
              {description}
            </p>
          )}
        </div>
      )}

      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled || loading}
        onKeyDown={handleKeyDown}
        className={`relative inline-flex flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#008069]/30 focus:ring-offset-1 ${trackSizes} ${
          checked ? activeBg : 'bg-[#cbd5e1] dark:bg-[#374248]'
        } ${disabled || loading ? 'cursor-not-allowed opacity-70' : ''}`}
      >
        <span className="sr-only">{checked ? onLabel : offLabel}</span>
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-flex items-center justify-center rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out ${thumbSizes} ${
            checked ? thumbTranslates : 'translate-x-0.5'
          }`}
        >
          {loading && (
            <Loader2
              size={size === 'sm' ? 8 : 10}
              className={`animate-spin ${
                checked ? 'text-[#008069]' : 'text-slate-400'
              }`}
            />
          )}
        </span>
      </button>

      {badgePlacement === 'inline-right' && statusBadge}
    </div>
  );
};
