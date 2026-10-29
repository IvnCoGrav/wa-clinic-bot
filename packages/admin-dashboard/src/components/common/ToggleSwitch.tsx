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
    emerald: 'bg-accent',
    indigo: 'bg-info',
    rose: 'bg-danger',
  }[variant];

  const activeBadge = {
    emerald: 'bg-accent-soft text-accent border-accent/40',
    indigo: 'bg-info-soft text-info border-info-line',
    rose: 'bg-danger-soft text-danger border-danger-line',
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
          : 'bg-fill-1 text-ink-3 border-divider'
      }`}
    >
      {loading ? (
        <Loader2 size={size === 'sm' ? 10 : 12} className="animate-spin" />
      ) : (
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            checked
              ? variant === 'emerald'
                ? 'bg-accent'
                : variant === 'indigo'
                ? 'bg-info'
                : 'bg-danger'
              : 'bg-ink-3'
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
              className={`text-xs font-bold text-ink select-none ${
                !disabled ? 'cursor-pointer' : ''
              }`}
            >
              {label}
            </label>
          )}
          {description && (
            <p className="text-[11px] text-ink-3 leading-relaxed select-none">
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
        className={`relative inline-flex flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 ease-out focus:outline-none focus:ring-2 focus:ring-accent/40 focus:ring-offset-1 ${trackSizes} ${
          checked ? activeBg : 'bg-fill-2 border border-divider'
        } ${disabled || loading ? 'cursor-not-allowed opacity-70' : ''}`}
      >
        <span className="sr-only">{checked ? onLabel : offLabel}</span>
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-flex items-center justify-center rounded-full bg-white shadow-xs ring-0 transition-transform duration-150 ease-out ${thumbSizes} ${
            checked ? thumbTranslates : 'translate-x-0.5'
          }`}
        >
          {loading && (
            <Loader2
              size={size === 'sm' ? 8 : 10}
              className={`animate-spin ${
                checked ? 'text-accent' : 'text-ink-3'
              }`}
            />
          )}
        </span>
      </button>

      {badgePlacement === 'inline-right' && statusBadge}
    </div>
  );
};
