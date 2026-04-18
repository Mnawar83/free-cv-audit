import { useEffect, useRef } from 'react';

export default function Modal({ open, title, description, onClose, children }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const root = ref.current;
    const selectors = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusable = Array.from(root.querySelectorAll(selectors));
    focusable[0]?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && focusable.length > 1) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/70 p-4" role="presentation" onMouseDown={onClose}>
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby="modal-description"
        className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="modal-title" className="text-lg font-semibold">{title}</h2>
        {description ? <p id="modal-description" className="mt-1 text-sm text-slate-300">{description}</p> : null}
        <div className="mt-4">{children}</div>
        <button type="button" className="mt-5 rounded bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600" onClick={onClose}>
          Close
        </button>
      </section>
    </div>
  );
}
