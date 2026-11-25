import { lazy, Suspense, useEffect, useRef } from "react";
import { KEG_BRANDS } from "../lib/keg-brands";

const KegRequestForm = lazy(() =>
  import("./KegRequestForm").then((m) => ({ default: m.KegRequestForm })),
);

type KegModalProps = {
  open: boolean;
  onClose: () => void;
  openerRef?: React.RefObject<HTMLElement | null>;
};

export function KegModal({ open, onClose, openerRef }: KegModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = openerRef?.current ?? null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !modalRef.current) return;
      const items = Array.from(
        modalRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !modalRef.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !modalRef.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [open, onClose, openerRef]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keg-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          autoFocus
          aria-label="Close keg inquiry"
          className="close"
          onClick={onClose}
        >
          ×
        </button>
        <p className="eyebrow">Keg inquiry</p>
        <h2 id="keg-title">Let’s plan your keg.</h2>
        <Suspense
          fallback={
            <p role="status" className="text-sm text-slate-400">
              Loading form…
            </p>
          }
        >
          <KegRequestForm
            brands={KEG_BRANDS}
            siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY || ""}
            onClose={onClose}
          />
        </Suspense>
      </div>
    </div>
  );
}
