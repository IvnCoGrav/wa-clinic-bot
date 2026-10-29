import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
}

export const Card: React.FC<CardProps> = ({
  hoverable = false,
  className = '',
  children,
  ...props
}) => {
  return (
    <div
      {...props}
      className={`bg-surface border border-divider rounded-xl shadow-2xs transition duration-150 ${
        hoverable ? 'hover:border-strong hover:shadow-xs' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
};

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export const CardHeader: React.FC<CardHeaderProps> = ({
  title,
  subtitle,
  action,
  className = '',
  children,
  ...props
}) => {
  return (
    <div
      {...props}
      className={`px-4 py-3 sm:px-5 sm:py-3.5 border-b border-divider flex items-center justify-between gap-3 ${className}`}
    >
      {children ? (
        children
      ) : (
        <>
          <div className="min-w-0">
            {title && <h3 className="text-sm font-bold text-ink truncate">{title}</h3>}
            {subtitle && <p className="text-xs text-ink-2 mt-0.5">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </>
      )}
    </div>
  );
};

export interface CardBodyProps extends React.HTMLAttributes<HTMLDivElement> {}

export const CardBody: React.FC<CardBodyProps> = ({
  className = '',
  children,
  ...props
}) => {
  return (
    <div {...props} className={`p-4 sm:p-5 ${className}`}>
      {children}
    </div>
  );
};
