import React from 'react';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'neutral' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center font-medium rounded-xl transition duration-150 active:scale-[0.98] select-none focus-ring disabled:opacity-50 disabled:pointer-events-none cursor-pointer';

  const sizeStyles = {
    sm: 'text-xs px-2.5 py-1.5 min-h-[32px] gap-1.5',
    md: 'text-xs px-3.5 py-2 min-h-[38px] gap-2',
    lg: 'text-sm px-4 py-2.5 min-h-[44px] gap-2.5',
  }[size];

  const variantStyles = {
    primary: 'bg-accent text-accent-ink hover:bg-accent-hover active:bg-accent-pressed shadow-xs',
    secondary: 'bg-accent-soft text-accent hover:bg-accent-soft/80 active:bg-accent-soft/90',
    neutral: 'bg-fill-1 text-ink hover:bg-fill-2 active:bg-fill-2 border border-divider',
    ghost: 'text-ink-2 hover:text-ink hover:bg-fill-1 active:bg-fill-2',
    danger: 'bg-danger-soft text-danger hover:bg-danger-line/40 border border-danger-line active:bg-danger-line/60',
  }[variant];

  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`}
    >
      {loading ? (
        <Loader2 size={size === 'sm' ? 14 : 16} className="animate-spin shrink-0" />
      ) : (
        icon && <span className="shrink-0">{icon}</span>
      )}
      {children}
    </button>
  );
};
