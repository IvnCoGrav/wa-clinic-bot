import React from 'react';

export interface ChartSeriesToggleItem {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  shape?: 'line' | 'bar' | 'area';
  disabled?: boolean;
  disabledReason?: string;
}

export interface ChartSeriesToggleProps {
  items: ChartSeriesToggleItem[];
  visible: Record<string, boolean>;
  onToggle: (key: string) => void;
  className?: string;
}

export const ChartSeriesToggle: React.FC<ChartSeriesToggleProps> = ({
  items,
  visible,
  onToggle,
  className = '',
}) => {
  return (
    <div
      role="group"
      aria-label="Filter visibilitas seri grafik"
      className={`flex items-center gap-1.5 flex-wrap ${className}`}
    >
      {items.map((it) => {
        const isVisible = !!visible[it.key];
        const isDisabled = !!it.disabled;

        return (
          <button
            key={it.key}
            type="button"
            aria-pressed={isVisible}
            disabled={isDisabled}
            title={isDisabled ? it.disabledReason : `Klik untuk ${isVisible ? 'sembunyikan' : 'tampilkan'} ${it.label}`}
            onClick={() => onToggle(it.key)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition select-none border cursor-pointer ${
              isDisabled
                ? 'opacity-40 cursor-not-allowed bg-surface-2 border-divider text-ink-3'
                : isVisible
                ? 'bg-surface border-divider text-ink shadow-2xs hover:border-accent'
                : 'bg-surface-2 border-transparent text-ink-3 hover:text-ink hover:border-divider'
            }`}
          >
            {/* Visual Indicator Swatch */}
            <span
              aria-hidden="true"
              className="inline-flex items-center justify-center w-3 h-3 shrink-0"
            >
              {it.dashed ? (
                <span
                  className="w-3 border-t-2 border-dashed"
                  style={{
                    borderColor: isVisible && !isDisabled ? it.color : 'rgb(var(--c-ink-3))',
                  }}
                />
              ) : it.shape === 'bar' ? (
                <span
                  className="w-2.5 h-2.5 rounded-xs"
                  style={{
                    backgroundColor: isVisible && !isDisabled ? it.color : 'rgb(var(--c-ink-3))',
                  }}
                />
              ) : (
                <span
                  className="w-3 h-0.5 rounded-full"
                  style={{
                    backgroundColor: isVisible && !isDisabled ? it.color : 'rgb(var(--c-ink-3))',
                  }}
                />
              )}
            </span>

            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
};
