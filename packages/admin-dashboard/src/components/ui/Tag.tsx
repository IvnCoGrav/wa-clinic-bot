import React from 'react';

export interface TagProps {
  label: string;
  icon?: React.ReactNode;
  onRemove?: () => void;
  className?: string;
}

export const Tag: React.FC<TagProps> = ({
  label,
  icon,
  onRemove,
  className = '',
}) => {
  return (
    <span
      className={`inline-flex items-center gap-1 h-[22px] px-2 rounded-md bg-fill-1 text-ink-2 text-xs font-medium border border-divider select-none max-w-[160px] ${className}`}
      title={label}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="truncate">{label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hover:text-danger text-ink-3 ml-0.5 transition cursor-pointer"
          aria-label={`Hapus tag ${label}`}
        >
          ×
        </button>
      )}
    </span>
  );
};

export interface TagListProps {
  tags: string[];
  max?: number;
  className?: string;
  renderTag?: (tag: string, index: number) => React.ReactNode;
}

export const TagList: React.FC<TagListProps> = ({
  tags,
  max = 3,
  className = '',
  renderTag,
}) => {
  if (!tags || tags.length === 0) return null;

  const visible = tags.slice(0, max);
  const remaining = tags.length - max;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {visible.map((tag, i) =>
        renderTag ? (
          renderTag(tag, i)
        ) : (
          <Tag key={`${tag}-${i}`} label={tag} />
        )
      )}
      {remaining > 0 && (
        <span
          className="inline-flex items-center h-[22px] px-1.5 rounded-md bg-fill-1 text-ink-3 text-[11px] font-bold border border-divider select-none"
          title={`${remaining} tag lainnya`}
        >
          +{remaining}
        </span>
      )}
    </div>
  );
};
