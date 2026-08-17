import React, { useState, useMemo } from 'react';
import { User } from 'lucide-react';

export interface CustomerAvatarProps {
  src?: string | null;
  name?: string | null;
  phone?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  indicator?: React.ReactNode;
}

const COLOR_PALETTES = [
  { bg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  { bg: 'bg-teal-500/20 text-teal-300 border-teal-500/30' },
  { bg: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
  { bg: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  { bg: 'bg-pink-500/20 text-pink-300 border-pink-500/30' },
  { bg: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
  { bg: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  { bg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
  { bg: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  { bg: 'bg-violet-500/20 text-violet-300 border-violet-500/30' },
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
          alt={name || phone || 'Profile Picture'}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className={`${sizeConfig.box} rounded-full object-cover border border-white/10 shadow-sm transition-transform duration-200 hover:scale-105 bg-slate-800`}
        />
      ) : (
        <div
          className={`${sizeConfig.box} rounded-full flex items-center justify-center border select-none transition-transform duration-200 hover:scale-105 shadow-sm ${palette.bg} ${sizeConfig.text}`}
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
