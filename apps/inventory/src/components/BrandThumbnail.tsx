import { useEffect, useState } from 'react';
import { getBrandInitials } from '../utils/inventoryRules';

interface BrandThumbnailProps {
  logoUrl: string | null;
  brand: string;
  itemName: string;
  size?: 'sm' | 'md' | 'lg';
}

const PALETTE = [
  'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
  'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200',
  'bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200',
];

function hashBrand(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % PALETTE.length;
}

const SIZE_CLASSES = {
  sm: 'w-8 h-8 text-[11px]',
  md: 'w-11 h-11 text-xs',
  lg: 'w-16 h-16 text-base',
};

export function BrandThumbnail({
  logoUrl,
  brand,
  itemName,
  size = 'sm',
}: BrandThumbnailProps) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [logoUrl]);

  const initials = getBrandInitials(brand, itemName);
  const colorClass = PALETTE[hashBrand(brand || itemName)];

  if (logoUrl && !imgFailed) {
    return (
      <div
        className={`${SIZE_CLASSES[size]} shrink-0 rounded border border-slate-200 dark:border-slate-700 bg-white overflow-hidden flex items-center justify-center`}
      >
        <img
          src={logoUrl}
          alt={`${brand || itemName} brand mark`}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      aria-label={`${brand || itemName} initials ${initials}`}
      className={`${SIZE_CLASSES[size]} ${colorClass} shrink-0 rounded border border-slate-300/70 dark:border-slate-700 font-display font-semibold tracking-tight flex items-center justify-center select-none`}
      title={brand ? `${brand} (No logo loaded)` : 'No brand logo loaded'}
    >
      {initials}
    </div>
  );
}
