import React, { useState, useMemo } from 'react';
import { User } from 'lucide-react';

export interface CustomerAvatarProps {
  src?: string | null;
  name?: string | null;
  phone?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  indicator?: React.ReactNode;
  alt?: string;
}

const COLOR_PALETTES = [
  { bg: 'bg-success/20 text-success border-success/30' },
  { bg: 'bg-success/20 text-success border-success/30' },
  { bg: 'bg-info/20 text-info border-info/30' },
  { bg: 'bg-violet/20 text-violet border-violet/30' },
  { bg: 'bg-danger/20 text-danger border-danger/30' },
  { bg: 'bg-danger/20 text-danger border-danger/30' },
  { bg: 'bg-warning/20 text-warning border-warning/30' },
  { bg: 'bg-info/20 text-info border-info/30' },
  { bg: 'bg-info/20 text-info border-info/30' },
  { bg: 'bg-violet/20 text-violet border-violet/30' },
];

function getInitials(name?: string | null, phone?: string | null): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (phone) {
    const clean = phone.replace(/[^0-9]/g, '');
    if (clean.length >= 2) {
      return clean.slice(-2);
    }
  }
  return '';
}

function getPalette(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % COLOR_PALETTES.length;
  return COLOR_PALETTES[index];
}

const SIZE_MAP = {
  xs: { box: 'w-6 h-6', text: 'text-[10px]', iconSize: 12 },
  sm: { box: 'w-8 h-8', text: 'text-xs', iconSize: 14 },
  md: { box: 'w-10 h-10', text: 'text-sm font-semibold', iconSize: 18 },
  lg: { box: 'w-12 h-12', text: 'text-base font-bold', iconSize: 22 },
  xl: { box: 'w-14 h-14', text: 'text-lg font-bold', iconSize: 26 },
};

export const CustomerAvatar: React.FC<CustomerAvatarProps> = ({
  src,
  name,
  phone,
  size = 'md',
  className = '',
  indicator,
  alt,
}) => {
  const [imgError, setImgError] = useState(false);
  const sizeConfig = SIZE_MAP[size] || SIZE_MAP.md;

  const initials = useMemo(() => getInitials(name, phone), [name, phone]);
  const palette = useMemo(() => getPalette(name || phone || 'customer'), [name, phone]);

  const showImage = !!src && !imgError;

  return (
    <div className={`relative inline-flex flex-shrink-0 ${sizeConfig.box} ${className}`}>
      {showImage ? (
        <img
          src={src!}
          alt={alt ?? ''}
          aria-hidden={alt !== undefined && alt !== '' ? undefined : true}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className={`${sizeConfig.box} rounded-full object-cover border border-white/10 shadow-sm transition-transform duration-200 hover:scale-105 bg-fill-2 select-none pointer-events-none`}
        />
      ) : (
        <div
          className={`${sizeConfig.box} rounded-full flex items-center justify-center border select-none transition-transform duration-200 hover:scale-105 shadow-sm ${palette.bg} ${sizeConfig.text}`}
          aria-hidden="true"
        >
          {initials ? initials : <User size={sizeConfig.iconSize} />}
        </div>
      )}
      {indicator && (
        <div className="absolute -bottom-0.5 -right-0.5">
          {indicator}
        </div>
      )}
    </div>
  );
};
