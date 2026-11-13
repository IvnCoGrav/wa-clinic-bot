import React from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}

/**
 * Judul halaman tunggal (h1) untuk seluruh dashboard.
 * Alasan: 18 halaman sebelumnya memakai h2 sebagai judul, sehingga outline
 * dokumen tidak konsisten dan pembaca layar kehilangan landmark judul.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  actions,
  meta,
  className = '',
}) => (
  <div className={`flex flex-wrap items-start justify-between gap-3 mb-4 ${className}`}>
    <div className="min-w-0">
      <h1 className="text-xl font-bold tracking-tight text-ink truncate">{title}</h1>
      {subtitle && <p className="text-xs text-ink-2 mt-0.5">{subtitle}</p>}
      {meta}
    </div>
    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
  </div>
);
