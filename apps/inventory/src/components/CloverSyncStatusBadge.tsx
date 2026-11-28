import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { cloverService, useCloverSyncStatus } from '../services/cloverService';

interface CloverSyncStatusBadgeProps {
  onOpenBridge?: () => void;
  compact?: boolean;
}

export function CloverSyncStatusBadge({
  onOpenBridge,
  compact = false,
}: CloverSyncStatusBadgeProps) {
  const sync = useCloverSyncStatus();

  useEffect(() => {
    // Perform an initial passive status check on first mount so the header reflects live credentials
    if (sync.state === 'idle' && !sync.configured && !sync.lastSyncedAt) {
      void cloverService.getStatus().catch(() => {});
    }
  }, [sync.state, sync.configured, sync.lastSyncedAt]);

  const isBusy = sync.state === 'checking' || sync.state === 'syncing';

  let label = 'Clover: Ready';
  let toneClasses =
    'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300';
  let Icon = CheckCircle2;

  if (isBusy) {
    label = sync.state === 'checking' ? 'Clover: Checking' : 'Clover: Syncing';
    toneClasses =
      'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300';
    Icon = RefreshCw;
  } else if (sync.state === 'error') {
    label = 'Clover: Error';
    toneClasses =
      'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-300';
    Icon = AlertTriangle;
  } else if (sync.state === 'unconfigured' || !sync.configured) {
    label = 'Clover: Setup';
    toneClasses =
      'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300';
    Icon = CloudOff;
  } else if (sync.state === 'synced') {
    label = 'Clover: Synced';
    toneClasses =
      'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300';
    Icon = Cloud;
  }

  const timeHint = sync.lastSyncedAt
    ? new Date(sync.lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;

  const tooltip = sync.lastError
    ? `Clover Sync Error: ${sync.lastError}`
    : sync.lastAction && timeHint
      ? `${sync.lastAction} at ${timeHint} (${sync.environment})`
      : sync.configured
        ? `Clover REST API v3 ready (${sync.environment} · ${sync.merchantIdMasked ?? 'connected'})`
        : 'Add CLOVER_MERCHANT_ID and CLOVER_API_TOKEN in Settings -> Secrets to sync with Clover POS';

  if (onOpenBridge) {
    return (
      <button
        type="button"
        onClick={onOpenBridge}
        data-testid="clover-sync-indicator"
        title={tooltip}
        aria-label={tooltip}
        className={`h-7 px-2 inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer hover:opacity-90 ${toneClasses}`}
      >
        <Icon className={`w-3 h-3 shrink-0 ${isBusy ? 'animate-spin' : ''}`} aria-hidden="true" />
        <span className={compact ? 'hidden sm:inline' : ''}>{label}</span>
      </button>
    );
  }

  return (
    <span
      data-testid="clover-sync-indicator"
      title={tooltip}
      className={`h-7 px-2.5 inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide rounded border whitespace-nowrap shrink-0 ${toneClasses}`}
    >
      <Icon className={`w-3 h-3 shrink-0 ${isBusy ? 'animate-spin' : ''}`} aria-hidden="true" />
      <span>{label}</span>
      {sync.lastAction && timeHint && !compact && (
        <span className="font-normal opacity-80 hidden md:inline">
          · {sync.lastAction} ({timeHint})
        </span>
      )}
    </span>
  );
}
