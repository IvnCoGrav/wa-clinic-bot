import React from 'react';

export const FIELD_INPUT_BASE =
  'w-full bg-surface-2 border border-divider text-ink placeholder:text-ink-3 rounded-xl text-xs px-3 py-2 transition duration-150 focus:outline-none focus:border-strong focus:ring-1 focus:ring-accent/40 shadow-2xs disabled:opacity-60 disabled:cursor-not-allowed';

export const FIELD_INPUT_SURFACE =
  'w-full bg-surface border border-divider text-ink placeholder:text-ink-3 rounded-xl text-xs px-3 py-2 transition duration-150 focus:outline-none focus:border-strong focus:ring-1 focus:ring-accent/40 shadow-2xs disabled:opacity-60 disabled:cursor-not-allowed';

export const FIELD_TEXTAREA_BASE =
  'w-full bg-surface-2 border border-divider text-ink placeholder:text-ink-3 rounded-xl text-xs px-3 py-2 transition duration-150 focus:outline-none focus:border-strong focus:ring-1 focus:ring-accent/40 shadow-2xs resize-none disabled:opacity-60 disabled:cursor-not-allowed';

export const FIELD_SELECT_BASE =
  'w-full bg-surface-2 border border-divider text-ink rounded-xl text-xs px-3 py-2 transition duration-150 focus:outline-none focus:border-strong focus:ring-1 focus:ring-accent/40 shadow-2xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed';

export interface FieldBaseProps {
  label?: string;
  hint?: string;
  error?: string;
  invalid?: boolean;
  variant?: 'surface' | 'surface-2';
}

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    FieldBaseProps {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, invalid, variant = 'surface-2', className = '', id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    const hasError = invalid || !!error;
    const bgClass = variant === 'surface' ? 'bg-surface' : 'bg-surface-2';

    return (
      <div className="w-full space-y-1">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-semibold text-ink-2">
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          {...props}
          className={`w-full ${bgClass} border text-ink placeholder:text-ink-3 rounded-xl text-xs px-3 py-2 transition duration-150 focus:outline-none focus:ring-1 ${
            hasError
              ? 'border-danger focus:border-danger focus:ring-danger/30'
              : 'border-divider focus:border-strong focus:ring-accent/40'
          } ${className}`}
        />
        {error && <p className="text-[11px] font-medium text-danger">{error}</p>}
        {hint && !error && <p className="text-[11px] text-ink-3">{hint}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    FieldBaseProps {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, hint, error, invalid, variant = 'surface-2', className = '', id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    const hasError = invalid || !!error;
    const bgClass = variant === 'surface' ? 'bg-surface' : 'bg-surface-2';

    return (
      <div className="w-full space-y-1">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-semibold text-ink-2">
            {label}
          </label>
        )}
        <textarea
          id={inputId}
          ref={ref}
          {...props}
          className={`w-full ${bgClass} border text-ink placeholder:text-ink-3 rounded-xl text-xs px-3 py-2 transition duration-150 focus:outline-none focus:ring-1 resize-none ${
            hasError
              ? 'border-danger focus:border-danger focus:ring-danger/30'
              : 'border-divider focus:border-strong focus:ring-accent/40'
          } ${className}`}
        />
        {error && <p className="text-[11px] font-medium text-danger">{error}</p>}
        {hint && !error && <p className="text-[11px] text-ink-3">{hint}</p>}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement>,
    FieldBaseProps {
  options?: Array<{ label: string; value: string | number }>;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, hint, error, invalid, variant = 'surface-2', className = '', id, options, children, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    const hasError = invalid || !!error;
    const bgClass = variant === 'surface' ? 'bg-surface' : 'bg-surface-2';

    return (
      <div className="w-full space-y-1">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-semibold text-ink-2">
            {label}
          </label>
        )}
        <select
          id={inputId}
          ref={ref}
          {...props}
          className={`w-full ${bgClass} border text-ink rounded-xl text-xs px-3 py-2 transition duration-150 focus:outline-none focus:ring-1 cursor-pointer ${
            hasError
              ? 'border-danger focus:border-danger focus:ring-danger/30'
              : 'border-divider focus:border-strong focus:ring-accent/40'
          } ${className}`}
        >
          {options
            ? options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))
            : children}
        </select>
        {error && <p className="text-[11px] font-medium text-danger">{error}</p>}
        {hint && !error && <p className="text-[11px] text-ink-3">{hint}</p>}
      </div>
    );
  }
);
Select.displayName = 'Select';
