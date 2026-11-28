import React, { useEffect, useRef, useState } from 'react';
import { validateNumericPatch } from '../utils/inventoryRules';

interface InlineNumericCellProps {
  field: 'price' | 'cost' | 'quantity';
  value: number | null;
  itemLabel: string;
  onCommit: (nextValue: number | null) => Promise<void>;
  prefix?: string;
  highlightMissing?: boolean;
}

export function InlineNumericCell({
  field,
  value,
  itemLabel,
  onCommit,
  prefix = '',
  highlightMissing = false,
}: InlineNumericCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEdit = () => {
    setDraft(value === null ? '' : field === 'quantity' ? String(value) : value.toFixed(2));
    setError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const submitEdit = async () => {
    const check = validateNumericPatch(field, draft);
    if (!check.valid) {
      setError(check.error);
      return;
    }

    if (check.value === value) {
      setEditing(false);
      setError(null);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onCommit(check.value);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  if (editing) {
    return (
      <div className="relative flex flex-col items-end">
        <input
          ref={inputRef}
          type="text"
          inputMode={field === 'quantity' ? 'numeric' : 'decimal'}
          aria-label={`Edit ${field} for ${itemLabel}`}
          value={draft}
          disabled={saving}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onBlur={() => void submitEdit()}
          onKeyDown={handleKeyDown}
          className={`w-[68px] h-8 px-1.5 text-right font-mono tabular-nums text-xs rounded border bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 ${
            error
              ? 'border-red-500 focus:ring-red-500'
              : 'border-blue-600 focus:ring-blue-600'
          }`}
        />
        {error && (
          <span
            role="alert"
            className="absolute top-9 right-0 z-20 px-2 py-1 text-[11px] font-sans whitespace-nowrap rounded bg-red-600 text-white shadow"
          >
            {error}
          </span>
        )}
      </div>
    );
  }

  const display =
    value === null
      ? '—'
      : field === 'quantity'
        ? String(value)
        : `${prefix}${value.toFixed(2)}`;

  return (
    <button
      type="button"
      onClick={startEdit}
      aria-label={`Edit ${field} for ${itemLabel} (current: ${display})`}
      className={`w-full min-h-[34px] px-1.5 py-1 text-right font-mono tabular-nums text-xs rounded border border-transparent hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 transition-colors cursor-text ${
        value === null && highlightMissing
          ? 'text-amber-700 dark:text-amber-400 font-semibold'
          : 'text-slate-900 dark:text-slate-100'
      }`}
      title="Click to edit inline (Enter to save, Esc to cancel)"
    >
      {display}
    </button>
  );
}
