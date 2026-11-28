import { CheckCircle2, AlertCircle, X } from 'lucide-react';

export interface ToastMessage {
  id: number;
  tone: 'success' | 'error';
  text: string;
}

interface ToastBannerProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

export function ToastBanner({ toast, onDismiss }: ToastBannerProps) {
  if (!toast) return null;

  const isError = toast.tone === 'error';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-16 right-4 sm:right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium shadow-lg transition-opacity max-w-[90vw] sm:max-w-md ${
        isError
          ? 'bg-red-50 border-red-300 text-red-900 dark:bg-red-950 dark:border-red-800 dark:text-red-100'
          : 'bg-slate-900 border-slate-800 text-white dark:bg-slate-100 dark:border-slate-200 dark:text-slate-950'
      }`}
    >
      {isError ? (
        <AlertCircle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 dark:text-emerald-600" aria-hidden="true" />
      )}
      <span>{toast.text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="ml-1 p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
      >
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
