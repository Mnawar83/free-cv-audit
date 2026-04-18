export default function Toast({ type = 'info', message }) {
  if (!message) return null;
  const palettes = {
    info: 'border-blue-400/40 bg-blue-500/10 text-blue-100',
    error: 'border-red-400/40 bg-red-500/10 text-red-100',
    success: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100',
  };

  return (
    <div role="status" aria-live="polite" className={`rounded border px-4 py-3 text-sm ${palettes[type]}`}>
      {message}
    </div>
  );
}
