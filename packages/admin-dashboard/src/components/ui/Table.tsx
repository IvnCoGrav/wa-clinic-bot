import React from 'react';

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  containerClassName?: string;
}

export const Table: React.FC<TableProps> = ({
  className = '',
  containerClassName = '',
  children,
  ...props
}) => {
  return (
    <div className={`w-full overflow-x-auto ${containerClassName}`}>
      <table {...props} className={`w-full text-left border-collapse text-xs ${className}`}>
        {children}
      </table>
    </div>
  );
};

export interface TableHeaderProps extends React.HTMLAttributes<HTMLTableSectionElement> {}

export const THead: React.FC<TableHeaderProps> = ({ className = '', children, ...props }) => {
  return (
    <thead {...props} className={`border-b border-divider bg-surface-2 ${className}`}>
      {children}
    </thead>
  );
};

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  hoverable?: boolean;
  selected?: boolean;
}

export const TR: React.FC<TableRowProps> = ({
  hoverable = true,
  selected = false,
  className = '',
  children,
  ...props
}) => {
  return (
    <tr
      {...props}
      className={`border-b border-divider transition-colors duration-100 ${
        selected
          ? 'bg-accent-soft'
          : hoverable
          ? 'hover:bg-fill-1'
          : ''
      } ${className}`}
    >
      {children}
    </tr>
  );
};

export interface TableHeadCellProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
}

export const TH: React.FC<TableHeadCellProps> = ({
  numeric = false,
  className = '',
  children,
  ...props
}) => {
  return (
    <th
      {...props}
      className={`px-3.5 py-2.5 font-bold text-ink-3 text-[11px] uppercase tracking-wider ${
        numeric ? 'text-right' : 'text-left'
      } ${className}`}
    >
      {children}
    </th>
  );
};

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
}

export const TD: React.FC<TableCellProps> = ({
  numeric = false,
  className = '',
  children,
  ...props
}) => {
  return (
    <td
      {...props}
      className={`px-3.5 py-3 text-ink ${
        numeric ? 'text-right num' : 'text-left'
      } ${className}`}
    >
      {children}
    </td>
  );
};
